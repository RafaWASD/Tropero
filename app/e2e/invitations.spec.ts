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

import type { Page } from '@playwright/test';

import { test, expect, applyEnvShim } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishment,
  seedEstablishmentWithRodeo,
  seedRodeo,
  seedInvitation,
  setUserPhone,
  getLatestInvitationToken,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, waitForOnboarding, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * Acepta la invitación (fase 'confirm') tolerando el guard OFFLINE de las Edge Functions de equipo
 * (R7.1/R9.2): tras una carga fresca / login, el socket de PowerSync tarda unos segundos en conectar
 * y `accept_invitation` (edge ONLINE-only) fast-falla con "Necesitás conexión…" hasta entonces. El
 * botón "Reintentar" re-dispara el accept — exactamente lo que haría un usuario real cuando vuelve la
 * conexión. Reintentamos hasta aterrizar en home (saludo único).
 *
 * NO enmascara el bug del loop: si el RootGate re-ruteara a /invite tras aceptar (el bug), la pantalla
 * quedaría en 'confirm' (botón "Aceptar invitación"), NUNCA en 'error' (botón "Reintentar") ni en home
 * → este helper no clickea nada más, agota los reintentos y falla. El loop sigue siendo detectable.
 */
async function acceptInvitationUntilHome(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Aceptar invitación' }).click();
  const greeting = page.getByText(/¡Hola.*👋/);
  const retry = page.getByRole('button', { name: 'Reintentar' });
  for (let i = 0; i < 25; i++) {
    if (await greeting.isVisible().catch(() => false)) return;
    if (await retry.isVisible().catch(() => false)) await retry.click().catch(() => {});
    await page.waitForTimeout(1_000);
  }
  // Último intento: assert real (falla con contexto si nunca aterrizó — incluido el caso loop).
  await expect(greeting).toBeVisible({ timeout: 15_000 });
}

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
  // Este test ejercita el flujo de usuario real IN-APP: el invitado abre /invite por navegación
  // (botón "Pegar link de invitación" del wizard) y PEGA el link (lo que te pasaron por WhatsApp).
  // El path de goto('/invite?token=') en carga fresca con sesión activa —que ANTES loopeaba— está
  // cubierto por el test "bug 1" más abajo (ya arreglado: no se persiste el token mientras auth carga).
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

// ── Bug 1: LOOP al abrir /invite?token= en carga FRESCA con sesión activa ──────────────────────────
//
// Repro exacto del backlog (2026-06-01): con el usuario YA logueado, un `goto('/invite?token=')`
// recarga el SPA → auth arranca en 'loading'. El BUG: invite.tsx veía isAuthed=false y PERSISTÍA el
// token; tras aceptar, el RootGate re-ruteaba de vuelta a /invite por ese token persistido (loop
// confirm→accept→confirm). El FIX: mientras auth carga NO se persiste (fase 'resolving'); se espera a
// que auth RESUELVA. Aceptar → home, sin volver a /invite.
//
// Este test FALLARÍA sin el fix: tras aceptar, el RootGate re-rutearía a /invite → el saludo de la
// home desaparecería (o nunca aparece) y reaparecería "Aceptar invitación".
test('bug 1: /invite?token= en carga fresca con sesión ACTIVA → aceptar → home, NO loopea', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const owner = await createTestUser('b1owner');
  const invitee = await createTestUser('b1invitee', 'Invitado Loop');
  await setUserPhone(owner.id, '1123456789');
  await setUserPhone(invitee.id, '1198765432');
  const { establishmentId } = await seedEstablishmentWithRodeo(owner.id, 'Campo Loop');
  const fieldName = `${RUN_TAG} Campo Loop`;
  // Invitación bearer directa (email null) — cualquier user logueado con el link la acepta.
  const token = await seedInvitation(establishmentId, owner.id, { role: 'veterinarian' });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await applyEnvShim(page);

  // 1) Login IN-APP → la sesión queda RESUELTA y PERSISTIDA (localStorage). El invitado no tiene
  //    campos aún → aterriza en el wizard de onboarding.
  await page.goto('/');
  await signIn(page, invitee);
  await waitForOnboarding(page);

  // 2) CARGA FRESCA de /invite?token= sobre esa sesión persistida (reload del SPA → auth vuelve a
  //    'loading' momentáneamente). Es el repro EXACTO del loop.
  await page.goto(`/invite?token=${encodeURIComponent(token)}`);

  // Authed (tras resolver) → fase 'confirm', NUNCA 'auth_required'.
  await expect(page.getByRole('button', { name: 'Aceptar invitación' })).toBeVisible({ timeout: 30_000 });
  await acceptInvitationUntilHome(page);

  // 3) Aterriza en la HOME del campo (oráculo POSITIVO por elemento exclusivo del destino: el saludo
  //    "¡Hola …! 👋" + el nombre del campo en el switch del header).
  await expect(page.getByText(fieldName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // 4) NO loopea: tras un settle generoso seguimos en la home (con el bug, el RootGate ya habría
  //    re-ruteado a /invite → el saludo desaparecería, la URL sería /invite y volvería el botón
  //    "Aceptar invitación"). El oráculo primario es la ESTABILIDAD del destino; el chequeo de URL y
  //    la ausencia del botón de /invite son defensivos (secundarios) y solo aplican tras route-change.
  await page.waitForTimeout(2_500);
  await expect(page.getByText(/¡Hola.*👋/)).toBeVisible();
  await expect(page).not.toHaveURL(/\/invite(\?|$)/);
  await expect(page.getByRole('button', { name: 'Aceptar invitación' })).toHaveCount(0);

  await ctx.close();
});

// ── Regresión: el path DESLOGUEADO (auth_required → persiste → login → vuelve a /invite → acepta) ──
//
// Garantiza que el fix del loop NO rompió el camino legítimo de R5.13: un destinatario SIN sesión
// abre el link → se registra/loguea → el RootGate re-rutea a /invite con el token persistido → acepta.
// El guard one-shot del RootGate evita el loop en este path. (Pasa antes y después del fix; es un
// candado de no-regresión del gating de auth.)
test('deslogueado: /invite?token= → auth_required (persiste) → login → vuelve a /invite → aceptar → home', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const owner = await createTestUser('b2owner');
  const invitee = await createTestUser('b2invitee', 'Invitado Desloga');
  await setUserPhone(owner.id, '1123456789');
  await setUserPhone(invitee.id, '1198765432');
  const { establishmentId } = await seedEstablishmentWithRodeo(owner.id, 'Campo Desloga');
  const fieldName = `${RUN_TAG} Campo Desloga`;
  const token = await seedInvitation(establishmentId, owner.id, { role: 'veterinarian' });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await applyEnvShim(page);

  // 1) SIN sesión (contexto fresco) → /invite?token= → fase 'auth_required' (persiste el token, R5.13).
  //    /invite es PUBLIC_ROUTE → el RootGate NO rebota al login; el invitado ve el prompt de sumarse.
  await page.goto(`/invite?token=${encodeURIComponent(token)}`);
  await expect(
    page.getByRole('button', { name: 'Ya tengo cuenta · Iniciar sesión' }),
  ).toBeVisible({ timeout: 30_000 });

  // 2) "Ya tengo cuenta" → sign-in → login del invitado. (El token ya quedó persistido; no se pasa
  //    por param: el RootGate lo recupera del store al pasar el gate de auth.)
  await page.getByRole('button', { name: 'Ya tengo cuenta · Iniciar sesión' }).click();
  await signIn(page, invitee);

  // 3) Tras login, el RootGate lee el token PERSISTIDO y re-rutea a /invite (R5.13) → fase 'confirm'.
  await expect(page.getByRole('button', { name: 'Aceptar invitación' })).toBeVisible({ timeout: 30_000 });
  await acceptInvitationUntilHome(page);

  // 4) Acepta → home del campo (el guard one-shot del RootGate evita el loop en este path también).
  await expect(page.getByText(fieldName, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByText(/¡Hola.*👋/)).toBeVisible();
  await expect(page).not.toHaveURL(/\/invite(\?|$)/);

  await ctx.close();
});
