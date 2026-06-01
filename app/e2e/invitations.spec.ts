// e2e/invitations.spec.ts — loop de 2 CUENTAS para invitaciones de equipo (spec 01, Fase 5 / B.1.3).
//
// El frontend de invitaciones ya está commiteado (B.1.3, commit 876614a): Más → Equipo
// ("Miembros e invitaciones") → "Invitar" → elegir rol → "Generar link de invitación"; el invitado
// abre `/invite?token=…` y "Aceptar invitación"; el dueño refresca Equipo y ve al miembro.
//
// El loop que modela:
//   Contexto A (DUEÑO):  login → home → Más → Equipo → "Invitar" → elegir rol "Veterinario" →
//                        "Generar link de invitación".
//   (token): en vez de scrapear el ShareLink (el accept_url se trunca con ellipsis en el DOM), lo
//            leemos de la DB con el admin client (invitations por establishment_id, service_role) —
//            MÁS ESTABLE. El invitado navega a /invite?token=<token>.
//   Contexto B (INVITADO): logueado → /invite?token=… → fase 'confirm' → "Aceptar invitación" →
//                        aterriza en la home del campo (ahora es miembro).
//   Contexto A: refresca → Más → Equipo → VE a "Vet Invitado" en la lista de miembros.
//
// Usa DOS browser.newContext() (sesiones independientes) sobre el mismo build web — el patrón que
// el playwright.config ya soporta. Ambos usuarios namespaced + limpiados en afterAll.

import { test, expect, applyEnvShim } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishment,
  seedRodeo,
  setUserPhone,
  getLatestInvitationToken,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, waitForOnboarding, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// El loop tiene 2 logins + un round-trip al edge invite_user + accept → damos aire al timeout.
test.setTimeout(120_000);

test('loop 2 cuentas: el dueño invita por link y el invitado acepta; el dueño ve al miembro', async ({
  browser,
}) => {
  // ── Setup de fixtures ───────────────────────────────────────────────────────
  const owner = await createTestUser('owner');
  const invitee = await createTestUser('invitee', 'Vet Invitado');
  await setUserPhone(owner.id, '1123456789');
  await setUserPhone(invitee.id, '1198765432');
  const fieldName = `${RUN_TAG} Campo Equipo`;
  const estId = await seedEstablishment(owner.id, 'Campo Equipo');
  // C1: sin rodeo, el RootGate bloquea con el wizard de rodeo → ni el owner ni el invitado llegan a
  // home. Un rodeo en el campo destraba el aterrizaje de ambos (el invitado lo hereda al aceptar).
  await seedRodeo(estId);

  // ── Contexto A: el DUEÑO genera el link de invitación ─────────────────────────
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await applyEnvShim(pageA); // shim de env del bundle web (ver fixtures.ts)
  await pageA.goto('/');
  await signIn(pageA, owner);
  await waitForHome(pageA);

  // Más → Equipo ("Miembros e invitaciones") → Invitar.
  await gotoTab(pageA, 'Más', pageA.getByText('Miembros e invitaciones', { exact: true }));
  await pageA.getByText('Miembros e invitaciones', { exact: true }).click();

  // Pantalla "Equipo": botón "Invitar" (owner). Se ubica por su aria-label "Invitar miembro".
  await expect(pageA.getByRole('button', { name: 'Invitar miembro' })).toBeVisible({
    timeout: 15_000,
  });
  await pageA.getByRole('button', { name: 'Invitar miembro' }).click();

  // Pantalla "Invitar al equipo": elegir rol (radio "Veterinario") + generar el link.
  await expect(pageA.getByRole('radio', { name: 'Veterinario' })).toBeVisible({ timeout: 15_000 });
  await pageA.getByRole('radio', { name: 'Veterinario' }).click();
  await pageA.getByRole('button', { name: 'Generar link de invitación' }).click();

  // Vista de éxito "Listo, compartí el link" (el ShareLink renderiza el accept_url).
  await expect(pageA.getByText('Listo, compartí el link', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // Token: leído de la DB (service_role) — más estable que scrapear el link truncado del DOM.
  const token = await getLatestInvitationToken(estId);
  expect(token.length).toBeGreaterThan(0);

  // ── Contexto B: el INVITADO acepta el link ────────────────────────────────────
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await applyEnvShim(pageB); // shim de env del bundle web (ver fixtures.ts)
  await pageB.goto('/');
  await signIn(pageB, invitee);
  // ESPERAMOS a que la sesión del invitado RESUELVA antes de ir a /invite: sin campos, el invitado
  // aterriza en /onboarding (wizard). Si navegáramos a /invite ANTES de que auth propague, el
  // invite.tsx vería isAuthed=false y mostraría la fase 'auth_required' (Registrarme/Iniciar sesión)
  // en vez de 'confirm' → no aparecería "Aceptar invitación".
  await waitForOnboarding(pageB);
  // Ahora autenticado → al navegar a /invite con el token entra en fase 'confirm' (sin preview,
  // hallazgo RLS #3). /invite es FASE5_DESTINATION → el RootGate no lo rebota a onboarding.
  // El invitado abre /invite por NAVEGACIÓN IN-APP (botón "Pegar link de invitación" del wizard) y
  // PEGA el link. Importante: NO usamos pageB.goto('/invite?token=…') — un goto recarga el SPA y, en
  // el primer render, la sesión todavía está 'loading' (isAuthed=false) → invite.tsx arranca en la
  // fase 'auth_required' y PERSISTE el token (R5.13). Luego, al aceptar, el RootGate vería ese token
  // persistido y re-rutearía de vuelta a /invite (loop confirm→accept→confirm). Pegar el link desde
  // dentro de la app (sin reload) mantiene isAuthed=true → fase 'confirm' directa, sin persistir el
  // token → sin loop. Es además el flujo de usuario real (pegar el link que te pasaron por WhatsApp).
  await pageB.getByRole('button', { name: 'Pegar link de invitación' }).click();
  const inviteLink = `https://app.rafq.ar/invite?token=${encodeURIComponent(token)}`;
  await expect(pageB.getByLabel('Link de invitación', { exact: true })).toBeVisible({ timeout: 15_000 });
  await pageB.getByLabel('Link de invitación', { exact: true }).fill(inviteLink);
  await pageB.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Authed + token pegado → fase 'confirm' (sin preview, hallazgo RLS #3).
  await expect(pageB.getByRole('button', { name: 'Aceptar invitación' })).toBeVisible({
    timeout: 30_000,
  });
  await pageB.getByRole('button', { name: 'Aceptar invitación' }).click();

  // Tras aceptar OK → refreshEstablishments(estId) + router.replace('/(tabs)') → home del campo.
  await waitForHome(pageB);
  // El invitado ahora ve el campo en el switch del header de su home.
  await expect(pageB.getByText(fieldName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // ── Contexto A: el DUEÑO ve al nuevo miembro ──────────────────────────────────
  await pageA.goto('/');
  await waitForHome(pageA);
  await gotoTab(pageA, 'Más', pageA.getByText('Miembros e invitaciones', { exact: true }));
  await pageA.getByText('Miembros e invitaciones', { exact: true }).click();
  // La lista de miembros (owner ve a TODOS por RLS owner-céntrica) incluye al invitado por nombre.
  await expect(pageA.getByText('Vet Invitado', { exact: true })).toBeVisible({ timeout: 15_000 });

  await ctxA.close();
  await ctxB.close();
});
