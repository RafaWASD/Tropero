// e2e/invitations.spec.ts — loop de 2 CUENTAS para invitaciones de equipo (spec 01, Fase 5 / B.1.3).
//
// ⚠️ DESHABILITADO con test.fixme(): el FRONTEND de invitaciones AÚN NO ESTÁ COMMITEADO en este
// branch (Más → Equipo es un stub "Próximamente"; /invite y AcceptInvitation no existen todavía).
// HABILITAR tras commitear B.1.3 (frontend de invitaciones): sacar el `.fixme` (pasarlo a
// `test(...)`) y ajustar los selectores a la UI real de invitaciones/miembros que se construya.
//
// El loop que modela (cuando B.1.3 exista):
//   Contexto A (DUEÑO):  login → Más → Equipo → "Invitar" → elegir rol → generar/copiar el LINK.
//   Contexto B (INVITADO): pega el link en /invite → "Aceptar invitación".
//   Contexto A: refresca Equipo y VE al nuevo miembro en la lista.
//
// Usa DOS browser.newContext() (sesiones independientes) sobre el mismo build web — el patrón que
// el playwright.config ya soporta. Ambos usuarios namespaced + limpiados en afterAll.

import { test, expect, applyEnvShim } from './helpers/fixtures';
import { createTestUser, seedEstablishment, setUserPhone, cleanupAll, RUN_TAG } from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// Loop completo dueño↔invitado. FIXME hasta B.1.3 (frontend de invitaciones no commiteado).
test.fixme(
  'loop 2 cuentas: el dueño invita por link y el invitado acepta; el dueño ve al miembro',
  async ({ browser }) => {
    // ── Setup de fixtures ───────────────────────────────────────────────────────
    const owner = await createTestUser('owner');
    const invitee = await createTestUser('invitee', 'Vet Invitado');
    await setUserPhone(owner.id, '1123456789');
    await setUserPhone(invitee.id, '1198765432');
    const fieldName = `${RUN_TAG} Campo Equipo`;
    await seedEstablishment(owner.id, 'Campo Equipo');

    // ── Contexto A: el DUEÑO genera el link de invitación ─────────────────────────
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await applyEnvShim(pageA); // shim de env del bundle web (ver fixtures.ts)
    await pageA.goto('/');
    await signIn(pageA, owner);
    await waitForHome(pageA);

    // Más → Equipo → Invitar. (Selectores TENTATIVOS — ajustar a la UI real de B.1.3.)
    await pageA.getByText('Más', { exact: true }).first().click();
    await pageA.getByText('Miembros e invitaciones').click();
    await pageA.getByRole('button', { name: /Invitar/ }).click();
    // Elegir rol (ej. veterinario) y generar el link.
    await pageA.getByRole('button', { name: /Veterinari/ }).click();
    await pageA.getByRole('button', { name: /Generar|Crear invitaci/ }).click();

    // Copiar el link: lo leemos del campo/elemento que lo muestre. (Selector TENTATIVO.)
    const inviteLink = await pageA.getByTestId('invite-link').inputValue();
    expect(inviteLink).toContain('/invite');

    // ── Contexto B: el INVITADO acepta el link ────────────────────────────────────
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await applyEnvShim(pageB); // shim de env del bundle web (ver fixtures.ts)
    await pageB.goto('/');
    await signIn(pageB, invitee);
    // Pega el link (o navega a /invite?token=…). (Flujo TENTATIVO — ajustar a B.1.3.)
    const url = new URL(inviteLink);
    await pageB.goto(`${url.pathname}${url.search}`);
    await pageB.getByRole('button', { name: /Aceptar invitaci/ }).click();
    // El invitado aterriza en el campo (ahora es miembro): su home muestra el campo.
    await expect(pageB.getByText(fieldName, { exact: true })).toBeVisible({ timeout: 15_000 });

    // ── Contexto A: el DUEÑO ve al nuevo miembro ──────────────────────────────────
    await pageA.reload();
    await pageA.getByText('Más', { exact: true }).first().click();
    await pageA.getByText('Miembros e invitaciones').click();
    await expect(pageA.getByText('Vet Invitado')).toBeVisible({ timeout: 15_000 });

    await ctxA.close();
    await ctxB.close();
  },
);
