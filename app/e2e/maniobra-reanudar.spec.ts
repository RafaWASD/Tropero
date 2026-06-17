// e2e/maniobra-reanudar.spec.ts — REANUDACIÓN de la jornada en el landing de MODO MANIOBRAS
// (spec 03 M4, R10.5/R10.6). El landing (`app/app/maniobra.tsx`) chequea si hay una jornada ABIERTA
// (getActiveSession, lectura local) y, si la hay, ofrece RETOMARLA con una tarjeta prominente. Si el
// operario toca "Nueva jornada" con una abierta (R10.6: una sola jornada activa por dispositivo), un sheet
// de confirmación le ofrece CERRAR la abierta y empezar una nueva, o retomar la abierta.
//
// Cómo se crea la jornada abierta: arrancando una de verdad desde el wizard (createSession CRUD-plano
// offline → vive en el SQLite local al instante → getActiveSession la ve) y volviendo al landing. Mismo
// patrón de seed/login que maniobra-identify/maniobra-wizard.
//
// Escenarios:
//   (a) jornada abierta → tarjeta "Retomar la jornada de hoy" → tap → identificación de ESA sesión (R10.5).
//   (b) "Nueva jornada" con abierta → NuevaJornadaConfirmSheet → "Empezar una nueva" → cierra la abierta
//       (oráculo SERVER waitForServerSessionClosed) + va al wizard (R10.6/R10.7).
//   (c) "Nueva jornada" SIN abierta → va DIRECTO al wizard (sin sheet) — regresión del camino de siempre.
//   (d) "Nueva jornada" con abierta → sheet → "Retomar la abierta" → identificación de la abierta (R10.6).

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  waitForServerActiveSessionId,
  waitForServerActiveSessionCount,
  waitForServerSessionClosed,
  readServerSessionStatus,
  readServerActiveSessionIds,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Arranca con la marca de E2E del bastón SETEADA antes del bundle → mode='mock' (igual que identify). */
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
 * Completa el wizard de jornada DESDE la etapa 1 ("Elegí el rodeo", ya visible): elige el primer rodeo +
 * Pesaje → "Arrancar jornada" → aterriza en la identificación → la sesión queda ABIERTA (status='active')
 * en el SQLite local (createSession cierra ANTES todas las activas del establishment → invariante ≤1).
 */
async function completeWizardFromStage1(page: Page): Promise<void> {
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

/**
 * Arranca una jornada REAL desde el wizard (navega a `/maniobra/jornada` + completa) → la sesión queda
 * ABIERTA (status='active') en el SQLite local. NO toca el landing.
 */
async function startSessionViaWizard(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await completeWizardFromStage1(page);
}

// (a) jornada abierta → tarjeta "Retomar la jornada de hoy" → tap → identificación de ESA sesión (R10.5).
test('(a) con una jornada abierta el landing ofrece RETOMARLA → tap lleva a la identificación', async ({ page }) => {
  const user = await createTestUser('m4-resume');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo M4 Resume');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Sin jornada abierta todavía: el landing NO muestra la tarjeta de retomar.
  await gotoLanding(page);
  await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toHaveCount(0);

  // Arrancamos una jornada de verdad → queda abierta (local) y sube al server.
  await startSessionViaWizard(page);
  const sessionId = await waitForServerActiveSessionId(establishmentId);

  // Volvemos al landing → ahora SÍ ofrece retomar la jornada abierta (R10.5).
  await gotoLanding(page);
  const resumeCard = page.getByRole('button', { name: 'Retomar la jornada de hoy' });
  await expect(resumeCard).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toBeVisible();

  // Tap en la tarjeta → la identificación de ESA sesión (el hero de la manga vuelve a aparecer).
  await resumeCard.click();
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });
  // La jornada sigue ABIERTA (retomar NO la cierra).
  expect(await readServerSessionStatus(sessionId)).toBe('active');
});

// (b) "Nueva jornada" con abierta → sheet → "Empezar una nueva" → wizard → al ARRANCAR, createSession cierra
// la abierta (R10.6/R10.7) y queda EXACTAMENTE 1 activa (la nueva). El cierre lo hace createSession (único
// camino de cierre, sin doble-close), NO un closeSession explícito en el sheet.
test('(b) "Nueva jornada" con una abierta → "Empezar una nueva" → al arrancar, la abierta queda cerrada y queda 1 activa (la nueva)', async ({ page }) => {
  const user = await createTestUser('m4-startnew');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo M4 StartNew');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  await startSessionViaWizard(page);
  const oldSessionId = await waitForServerActiveSessionId(establishmentId);

  await gotoLanding(page);
  await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Tocar "Nueva jornada" con una abierta → NO va directo al wizard: abre el sheet de confirmación (R10.6).
  await page.getByRole('button', { name: 'Nueva jornada', exact: true }).click();
  await expect(page.getByTestId('nueva-jornada-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Ya tenés una jornada abierta', { exact: true })).toBeVisible();

  // "Empezar una nueva" → navega al wizard (etapa 1). La abierta NO se cierra todavía (lo hace createSession
  // al arrancar). Completamos el wizard → createSession cierra TODAS las activas ANTES de insertar la nueva.
  await page.getByRole('button', { name: 'Empezar una nueva', exact: true }).click();
  await completeWizardFromStage1(page);

  // ORÁCULO SERVER: la jornada que estaba abierta quedó CERRADA de verdad — R10.7.
  await waitForServerSessionClosed(oldSessionId);
  // INVARIANTE R10.6: tras arrancar, queda EXACTAMENTE 1 activa (la nueva, distinta de la vieja).
  await waitForServerActiveSessionCount(establishmentId, 1);
  const activeIds = await readServerActiveSessionIds(establishmentId);
  expect(activeIds).toHaveLength(1);
  expect(activeIds[0]).not.toBe(oldSessionId);
});

// (c) "Nueva jornada" SIN abierta → va DIRECTO al wizard (sin sheet) — regresión del camino de siempre.
test('(c) "Nueva jornada" SIN jornada abierta va directo al wizard (sin sheet)', async ({ page }) => {
  const user = await createTestUser('m4-direct');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo M4 Direct');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  await gotoLanding(page);
  // No hay jornada abierta → ni tarjeta de retomar.
  await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toHaveCount(0);

  // "Nueva jornada" → DIRECTO al wizard (NO se abre el sheet de confirmación).
  await page.getByRole('button', { name: 'Nueva jornada', exact: true }).click();
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('nueva-jornada-sheet')).toHaveCount(0);
});

// (d) "Nueva jornada" con abierta → sheet → "Retomar la abierta" → identificación de la abierta (R10.6).
test('(d) "Nueva jornada" con una abierta → confirmar → "Retomar la abierta" lleva a la identificación', async ({ page }) => {
  const user = await createTestUser('m4-resume-sheet');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo M4 ResumeSheet');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  await startSessionViaWizard(page);
  const sessionId = await waitForServerActiveSessionId(establishmentId);

  await gotoLanding(page);
  // Esperamos a que getActiveSession resuelva (la tarjeta de retomar es la señal de que openSession se
  // cargó) ANTES de tocar "Nueva jornada"; si no, el handler vería openSession=null y iría directo al wizard.
  await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Nueva jornada', exact: true }).click();
  await expect(page.getByTestId('nueva-jornada-sheet')).toBeVisible({ timeout: 10_000 });

  // "Retomar la abierta" → la identificación de la jornada abierta (NO la cierra, NO arranca otra).
  await page.getByRole('button', { name: 'Retomar la abierta', exact: true }).click();
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await readServerSessionStatus(sessionId)).toBe('active');
});
