// e2e/maniobra-elegir.spec.ts — red de seguridad de las 3 pantallas de "elegir un valor" de MODO MANIOBRAS
// (spec 03 M3.2a): TACTO VAQUILLONA (apta/no_apta/diferida, R6.3), CONDICIÓN CORPORAL (stepper 1–5 step
// 0,25, R6.6) y DIENTES (+ prompt CUT, R6.7/R6.8).
//
// Recorre una jornada con las 3 maniobras sobre una vaquillona (hembra adulta → el prompt CUT aplica):
//   tacto vaquillona → APTA · condición corporal stepper → 3,25 · dientes → 1/2 (boca de descarte) → prompt
//   CUT → Marcar CUT. Verifica server-side (oráculos service_role): heifer_fitness='apta' con session_id,
//   condition_score=3.25 con session_id, teeth_state='1/2' + is_cut=true + category_override=true +
//   category_id = la categoría CUT del sistema.
//
// + un test que prueba que el prompt CUT NO aparece para un TERNERO (R6.8): una boca de descarte en una
//   ternera registra el teeth_state directo, sin sheet, sin marcar CUT.
//
// Capturas 412×915: tacto-vaquillona (3 bloques), condicion-corporal (stepper), dientes (bloques),
// dientes-cut-prompt (sheet) → design/maniobra-elegir/.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  waitForServerVaquillonaWithSession,
  waitForServerConditionScoreWithSession,
  waitForServerTeethState,
  getCategoryCodeById,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'design', 'maniobra-elegir');

test.afterAll(async () => {
  await cleanupAll();
});

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/**
 * Arranca una jornada con las 3 maniobras de M3.2a (tacto vaquillona + condición corporal + dientes), en
 * ese orden de selección (= orden de la secuencia, R5.14), y aterriza en la identificación.
 */
async function startSessionTresElegir(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // El pool con las 3 maniobras prueba que el rodeo_data_config (cría habilita tacto_vaquillona/
  // condicion_corporal/dientes por default, 0018) ya bajó al SQLite local. Dwell para asentar el sync.
  await expect(page.getByTestId('pool-row-tacto_vaquillona')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('pool-row-tacto_vaquillona').click();
  await page.getByTestId('pool-row-condicion_corporal').click();
  await page.getByTestId('pool-row-dientes').click();
  await expect(page.getByTestId('selected-row-2')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Hero adaptativo (M2.1): con el mock conectable, el estado inicial es ConnectHero. Conectamos el mock →
  // pasa a ScanHero ("Acercá el bastón"), el camino conectado que este flujo asume.
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Arranca una jornada SOLO con dientes (foco en el gate del prompt CUT, sin acoplar a las otras). */
async function startSessionDientes(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('pool-row-dientes').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Hero adaptativo (M2.1): con el mock conectable, el estado inicial es ConnectHero. Conectamos el mock →
  // pasa a ScanHero ("Acercá el bastón"), el camino conectado que este flujo asume.
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── Flujo completo: las 3 maniobras de "elegir" sobre una vaquillona, con persistencia + CUT. ──
test('elegir: tacto vaquillona (apta) + condición corporal (3,25) + dientes (1/2 → CUT) persisten con session_id', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m32a-full');
  await setUserPhone(user.id, '1123456789');
  // Identidad LIMPIA para las capturas (rodeo "Cría hembras" sin prefijo e2e + caravana "0420"). Vaquillona
  // (hembra adulta) → el prompt CUT aplica (no es ternera).
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Elegir M32a', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0420';
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: visual,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionTresElegir(page);

  // Bastonazo → found → auto-avance a la carga rápida REAL.
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 3', { exact: true })).toBeVisible({ timeout: 30_000 });

  // ── TACTO VAQUILLONA (· 1 de 3): los 3 bloques de aptitud → APTA. ──
  await expect(page.getByRole('button', { name: 'APTA', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'NO APTA', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DIFERIDA', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'tacto-vaquillona.png') });
  await page.getByRole('button', { name: 'APTA', exact: true }).click();

  // ── CONDICIÓN CORPORAL (· 2 de 3): stepper arranca en 3,00 → + una vez → 3,25 → Confirmar. ──
  await expect(page.getByText('· 2 de 3', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('score-display').getByText('3,00', { exact: true })).toBeVisible();
  await page.getByTestId('score-plus').click();
  await expect(page.getByTestId('score-display').getByText('3,25', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'condicion-corporal.png') });
  await page.getByRole('button', { name: 'Confirmar condición corporal' }).click();

  // ── DIENTES (· 3 de 3): los bloques del enum → 1/2 (boca de descarte). ──
  await expect(page.getByText('· 3 de 3', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('teeth-block-boca_llena')).toBeVisible();
  await expect(page.getByTestId('teeth-block-1/2')).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'dientes.png') });
  await page.getByTestId('teeth-block-1/2').click();

  // ── PROMPT CUT (R6.8): la boca 1/2 sobre una vaquillona dispara el sheet → Marcar CUT. ──
  await expect(page.getByTestId('cut-prompt-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('¿Marcar como CUT?', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'dientes-cut-prompt.png') });
  await page.getByRole('button', { name: 'Marcar como CUT' }).click();

  // ── RESUMEN: las 3 maniobras con su valor. ──
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Apta', { exact: true })).toBeVisible();
  await expect(page.getByText('3,25', { exact: true })).toBeVisible();
  await expect(page.getByText('1/2 · CUT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── PERSISTENCIA VERIFICABLE server-side (R5.11). ──
  const vq = await waitForServerVaquillonaWithSession(profileId, 'apta');
  const cs = await waitForServerConditionScoreWithSession(profileId, 3.25);
  // Mismo session_id (los 3 en la misma jornada).
  expect(vq.sessionId).toBe(cs.sessionId);
  // Dientes (propiedad) + CUT: teeth_state='1/2' + is_cut + override + category_id = la CUT del sistema.
  const teeth = await waitForServerTeethState(profileId, '1/2', { expectCut: true });
  expect(teeth.isCut).toBe(true);
  expect(teeth.categoryOverride).toBe(true);
  expect(await getCategoryCodeById(teeth.categoryId)).toBe('cut');
});

// ── El prompt CUT NO aparece para un TERNERO (R6.8): boca de descarte en ternera → registra sin CUT. ──
test('dientes: el prompt CUT NO aparece para un ternero (R6.8)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('m32a-calf');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Ternera M32a');
  const eid = makeEid();
  const visual = `${RUN_TAG}-CALF`;
  // TERNERA REAL → birth_date reciente (< 1 año) para que la categoría (server Y espejo C6) sea 'ternera':
  // sin birth_date el espejo deriva 'vaquillona' (default conservador, RT2.4.6) y el gate del prompt CUT no
  // la reconocería como ternera. Una ternera de campo SIEMPRE tiene fecha de nacimiento → el seed es fiel.
  const recentBirth = new Date();
  recentBirth.setMonth(recentBirth.getMonth() - 6); // 6 meses → ternera (< 1 año)
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: visual,
    sex: 'female',
    categoryCode: 'ternera',
    birthDate: recentBirth.toISOString().slice(0, 10),
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionDientes(page);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Elegir sin_dientes (boca de descarte) → NO debe abrirse el sheet (es ternera). Va directo al resumen.
  await expect(page.getByTestId('teeth-block-sin_dientes')).toBeVisible();
  await page.getByTestId('teeth-block-sin_dientes').click();

  // El prompt CUT NO aparece: el flujo avanza DIRECTO al resumen (si el sheet hubiera salido, el resumen
  // no aparecería). Llegar al resumen es la prueba positiva de que el gate de R6.8 saltó el prompt.
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('cut-prompt-sheet')).toHaveCount(0);
  await expect(page.getByText('Sin dientes', { exact: true })).toBeVisible();
  await expect(page.getByText('Sin dientes · CUT', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Server: teeth_state='sin_dientes' SIN CUT (is_cut sigue false; no se marcó descarte a una ternera).
  const teeth = await waitForServerTeethState(profileId, 'sin_dientes', { expectCut: false });
  expect(teeth.isCut).toBe(false);
});
