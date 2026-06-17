// e2e/maniobra-single-active.spec.ts — INVARIANTE ≤1 SESIÓN ACTIVA POR ESTABLISHMENT (spec 03 R10.6).
//
// BUG (diagnosticado por el leader, confirmado en la DB): R10.6 dice "una sola sesión activa por dispositivo
// a la vez", pero nada lo enforzaba. Cada "Arrancar jornada" hacía createSession (INSERT de una `session`
// active) SIN cerrar las anteriores, y "Salir sin terminar" deja la sesión active → se ACUMULABAN sesiones
// active huérfanas. Síntoma: tras "Terminar jornada" (que cierra la actual), getActiveSession (ORDER BY
// started_at DESC LIMIT 1) devolvía la SIGUIENTE activa huérfana → la tarjeta "Retomar la jornada de hoy"
// seguía apareciendo → parecía que "no terminó".
//
// FIX: createSession cierra TODAS las activas del establishment ANTES de insertar la nueva (closeActiveSessions,
// único punto de enforcement). Tras cualquier createSession queda EXACTAMENTE 1 activa (la nueva).
//
// Este e2e parte del estado del bug (N>1 activas, que el cliente post-fix NUNCA puede generar) sembrando 2
// sesiones activas DIRECTO en el server (service_role), las espera sincronizar al SQLite local (proxy: la
// tarjeta de retomar aparece → la stream ya bajó las filas), arranca UNA jornada nueva desde el wizard y
// verifica con un ORÁCULO SERVER que quedó EXACTAMENTE 1 activa (la nueva, distinta de las 2 sembradas).
// Luego "Terminar jornada" sobre esa → 0 activas → ya no hay huérfana que reaparezca.

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedActiveSession,
  setUserPhone,
  waitForServerActiveSessionCount,
  readServerActiveSessionIds,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Arranca con la marca de E2E del bastón SETEADA antes del bundle → mode='mock' (igual que reanudar). */
async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

/** Abre el landing de MODO MANIOBRAS por deep-link y espera el header + el CTA "Nueva jornada". */
async function gotoLanding(page: Page): Promise<void> {
  await page.goto('/maniobra');
  await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Nueva jornada', exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * Completa el wizard de jornada DESDE la etapa 1 (elige el primer rodeo + Pesaje → "Arrancar jornada") →
 * aterriza en la identificación → la sesión nueva queda ABIERTA (createSession cerró antes todas las activas).
 */
async function arrancarJornada(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Aterrizó en la identificación (sin conectar el bastón → ConnectHero "Conectá el bastón" en web).
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('con 2 sesiones activas pre-existentes, arrancar una nueva deja EXACTAMENTE 1 activa (la nueva); terminar → 0', async ({ page }) => {
  const user = await createTestUser('m4-single-active');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Single Active');

  // ── Estado del bug: 2 sesiones activas huérfanas en el server (started_at distintos para un orden claro).
  const seeded1 = await seedActiveSession(establishmentId, rodeoId, { startedAt: '2026-06-16T07:00:00Z' });
  const seeded2 = await seedActiveSession(establishmentId, rodeoId, { startedAt: '2026-06-16T08:00:00Z' });
  // Sanity (server): efectivamente partimos de 2 activas.
  await waitForServerActiveSessionCount(establishmentId, 2);

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // El landing ve la sesión activa más reciente sincronizada → ofrece RETOMARLA. Que la tarjeta aparezca es
  // el proxy de que la stream YA bajó las sesiones al SQLite local (el primer sync, global, terminó) → cuando
  // arranquemos la nueva, closeActiveSessions tendrá AMBAS filas locales para cerrar.
  await gotoLanding(page);
  await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toBeVisible({ timeout: 30_000 });

  // ── Arrancamos una jornada NUEVA desde el wizard → createSession cierra las 2 activas ANTES de insertar.
  await arrancarJornada(page);

  // ── ORÁCULO SERVER (invariante R10.6): queda EXACTAMENTE 1 activa, y NO es ninguna de las 2 sembradas.
  await waitForServerActiveSessionCount(establishmentId, 1);
  const activeAfterStart = await readServerActiveSessionIds(establishmentId);
  expect(activeAfterStart).toHaveLength(1);
  expect(activeAfterStart[0]).not.toBe(seeded1);
  expect(activeAfterStart[0]).not.toBe(seeded2);

  // ── "Terminar jornada" sobre la única activa (la nueva) → cierra → 0 activas → ya no reaparece huérfana.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Terminar jornada', exact: true }).click();
  await expect(page.getByText('Jornada terminada', { exact: true })).toBeVisible({ timeout: 10_000 });

  // ORÁCULO SERVER: 0 sesiones activas → al volver al landing NO hay huérfana que ofrezca retomar.
  await waitForServerActiveSessionCount(establishmentId, 0);

  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await waitForHome(page);

  // El landing ya NO ofrece retomar (no quedan activas) — el síntoma del bug desaparece.
  await gotoLanding(page);
  await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toHaveCount(0);
});
