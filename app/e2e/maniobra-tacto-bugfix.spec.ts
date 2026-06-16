// e2e/maniobra-tacto-bugfix.spec.ts — red de seguridad de los 2 bugs de la pantalla de TACTO que reportó
// Raf en testing en vivo (web), spec 03:
//
//   (1) "OTRA CARAVANA": la búsqueda MANUAL por substring (LIKE '%texto%') que devolvía UN solo match NO
//       exacto auto-avanzaba a ESE animal (su caravana sólo CONTENÍA el texto) → se cargaba la caravana
//       EQUIVOCADA. FIX: el auto-avance manual exige match EXACTO (idv/visual/tag === texto). Un único
//       match por substring → PICKER de confirmación (no se auto-carga el equivocado). El idv/visual
//       EXACTO sigue auto-avanzando (camino rápido de manga).
//
//   (2) "NO AVANZA": al tapear PREÑADA/VACÍA no pasaba nada y sin feedback, porque el error del write LOCAL
//       de la maniobra se TRAGABA (`void captureAndAdvance` sin try/catch ni chequeo del ServiceResult).
//       FIX: fail-closed — si el persist local FALLA, se SUPERFICIA un banner accionable es-AR (R5.7/R10.8)
//       y NO se avanza; el reintento (tocar de nuevo) procede. La falla se inyecta determinísticamente con
//       una marca SOLO-E2E (window.__RAFAQ_MANEUVER_FAULT__, fuera de la superficie de prod).
//
// Cómo se llega: jornada con TACTO (rodeo de cría → habilitado) → /maniobra/identificar. El bastonazo (mock
// bajo __RAFAQ_BLE_E2E__) o la búsqueda manual aterrizan en /maniobra/carga con el sessionId+profileId reales.

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  waitForServerTactoWithSession,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Arranca la app con la marca de E2E del bastón (mock) seteada antes del bundle. */
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

/** Arranca una jornada de manga con TACTO (habilitada en cría) y aterriza en la identificación. */
async function startSessionTacto(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-tacto')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
  await page.getByTestId('pool-row-tacto').click();
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

async function manualSearch(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(query);
  await page.getByRole('button', { name: 'Buscar animal' }).click();
}

// ── BUG (1) "OTRA CARAVANA": substring single match NO auto-avanza — pide confirmación; el operario lo
//    confirma → carga sobre el animal CORRECTO. + el match EXACTO sí auto-avanza (camino rápido). ──
test('(1) substring manual NO auto-carga la caravana equivocada → picker de confirmación → carga sobre la elegida', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('tbug-wrong');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tacto Wrong', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  // ÚNICO animal: idv "1428". El operario teclea "42" (su caravana "1428" CONTIENE "42" como substring).
  await seedAnimal(establishmentId, rodeoId, { idv: '1428', visualAlt: 'X-1428', sex: 'female', categoryCode: 'vaquillona' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText('1428', { exact: true }).first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2000);

  await startSessionTacto(page);

  // Teclear "42" → NO auto-avanza: aparece el picker de confirmación (no se carga la caravana equivocada).
  await manualSearch(page, '42');
  await expect(page.getByText('¿Cuál es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No hay ninguna caravana/)).toBeVisible();
  // NO está en el paso de tacto (no se auto-cargó).
  await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toHaveCount(0);
  // El operario CONFIRMA tocando el candidato → ahora sí carga sobre él (el animal correcto que eligió).
  await page.getByText('X-1428', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toBeVisible({ timeout: 20_000 });
  // El header muestra la caravana del animal ELEGIDO (X-1428), no "42".
  await expect(page.getByText('X-1428', { exact: true })).toBeVisible();
});

test('(1b) match EXACTO por idv → auto-avance directo a la carga (camino rápido preservado)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('tbug-exact');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tacto Exact', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const visual = '0385';
  await seedAnimal(establishmentId, rodeoId, { idv: '385', visualAlt: visual, sex: 'female', categoryCode: 'vaquillona' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: false }).first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2000);

  await startSessionTacto(page);
  // Tecleo EXACTO del idv "385" → auto-avance directo (sin picker) al paso de tacto del animal correcto.
  await manualSearch(page, '385');
  await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('0385', { exact: true })).toBeVisible();
});

// ── BUG (2) "NO AVANZA": el persist falla → el error se SUPERFICIA (no se traga) y NO se avanza; el
//    reintento (tocar de nuevo) procede y avanza al resumen + persiste server-side. ──
test('(2) persist falla → banner de error visible + NO avanza; reintento → avanza al resumen y persiste', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('tbug-fail');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tacto Fail', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: `${RUN_TAG}-FAIL`,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(`${RUN_TAG}-FAIL`, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  await startSessionTacto(page);

  // ARMAR la falla de persistencia inyectada (solo-e2e): la PRÓXIMA captura fallará una vez.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_MANEUVER_FAULT__ = true;
  });

  // Bastonazo → carga rápida. Paso de tacto: tapear VACÍA → el persist falla → banner + NO avanza.
  await bastonazo(page, eid);
  await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'VACÍA', exact: true }).click();
  // El error se SUPERFICIA (antes se tragaba) y NO se avanza: seguimos en el paso de tacto.
  await expect(page.getByTestId('maneuver-capture-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/No se pudo guardar la maniobra/)).toBeVisible();
  await expect(page.getByText('Revisá la carga', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toBeVisible();

  // REINTENTO: la falla era de un intento (se desarmó) → tapear VACÍA de nuevo AVANZA al resumen.
  await page.getByRole('button', { name: 'VACÍA', exact: true }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Vacía', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // El tacto del reintento aterrizó en el server con session_id (persistencia REAL end-to-end).
  await waitForServerTactoWithSession(profileId, 'empty');
});
