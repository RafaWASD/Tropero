// e2e/maniobra-skip-paso.spec.ts — red de seguridad del SALTEAR de MODO MANIOBRA (spec 03 R5.15, delta
// `skip-por-paso-v2`, Puerta 2 demo-facundo-padre).
//
// Cubre el REDISEÑO del skip pedido por Raf en la Puerta 2:
//   (1) SKIP POR-PASO (primario): saltear un paso (aptitud) → el animal SIGUE en el próximo paso del MISMO
//       animal (pesaje), sin obligar a cargar el salteado; el resumen muestra "Salteado" y el pesaje persiste.
//   (2) SKIP ANIMAL-ENTERO (secundario, overflow "⋯"): descarta lo cargado + vuelve a identificar SIN contar
//       el animal (el progreso sigue en "0 hoy").
//
// Setup: rodeo "Cría hembras" (0018 habilita tacto_vaquillona + pesaje por default) + hembra vaquillona con
// EID → identificación por bastonazo del MockAdapter (flag __RAFAQ_BLE_E2E__, fuera de prod). Secuencia
// tacto_vaquillona + pesaje → 2 pasos. La secuencia de skip por-paso pica el 1er paso y verifica que el
// frame avanza al 2do del mismo animal.

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  waitForServerWeightEventWithSession,
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

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function connectMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Arranca una jornada con tacto_vaquillona + pesaje (ambas habilitadas en cría) → aterriza en el scan hero. */
async function startSessionAptitudPesaje(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-tacto_vaquillona')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
  // Orden de selección = orden de la secuencia (R5.14): aptitud primero, pesaje después.
  await page.getByTestId('pool-row-tacto_vaquillona').click();
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-1')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await connectMock(page);
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Teclea un peso entero en el keypad de PesajeStep (dígito por dígito). */
async function typeWeight(page: Page, kg: string): Promise<void> {
  for (const d of kg) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// ── (1) SKIP POR-PASO: saltear el 1er paso → el animal sigue en el 2do → "Salteado" en el resumen ──
test('skip por-paso: saltear la aptitud → el MISMO animal sigue en pesaje → resumen muestra "Salteado", el pesaje persiste', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('skip-paso-1');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Skip Paso', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0385';
  await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'female', categoryCode: 'vaquillona' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionAptitudPesaje(page);

  // Bastonazo → paso 1 (tacto de aptitud, · 1 de 2). El header trae la afordancia PRIMARIA de skip por-paso.
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('skip-step')).toBeVisible({ timeout: 15_000 });
  // El botón NOMBRA la maniobra que se saltea (skipStepButtonLabel('tacto_vaquillona') = "Saltear aptitud").
  await expect(page.getByText('Saltear aptitud', { exact: true })).toBeVisible();
  // La secundaria (saltar animal, overflow "⋯") también está.
  await expect(page.getByTestId('skip-animal')).toBeVisible();

  // Saltear ESE paso (aptitud) SIN elegir apta/no_apta → el frame avanza al SIGUIENTE paso del MISMO animal.
  await page.getByTestId('skip-step').click();
  await expect(page.getByText('· 2 de 2', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
  // El animal NO se abandonó: la caravana visual "0385" sigue en el header (mismo animal).
  await expect(page.getByText('0385', { exact: true })).toBeVisible();

  // Cargar el pesaje (400) → resumen.
  await typeWeight(page, '400');
  await page.getByRole('button', { name: 'Confirmar peso' }).click();

  // El resumen muestra "Salteado" para el paso salteado (decisión tomada, no "Sin cargar") + el pesaje.
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Salteado', { exact: true })).toBeVisible();
  await expect(page.getByText('400 kg', { exact: true })).toBeVisible();

  // Confirmar el animal → siguiente animal + el pesaje persiste con session_id (el paso salteado no escribió
  // ningún reproductive_events: persistManeuverEvent con skipped no persiste — cubierto por el unit).
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });
  await waitForServerWeightEventWithSession(establishmentId, 400);
});

// ── (2) SKIP ANIMAL-ENTERO (secundario): descarta lo cargado + vuelve a identificar SIN contar el animal ──
test('skip animal (secundario, overflow): descarta lo cargado y vuelve a identificar sin contar el animal', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('skip-paso-2');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Skip Animal', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0386';
  await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'female', categoryCode: 'vaquillona' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionAptitudPesaje(page);

  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 2', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Cargar la aptitud (APTA) → datos parciales (1 maniobra) → avanza al pesaje (· 2 de 2).
  await page.getByRole('button', { name: 'APTA', exact: true }).click();
  await expect(page.getByText('· 2 de 2', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Saltar el ANIMAL entero desde el overflow "⋯" (secundario) → SkipAnimalSheet con AVISO de descarte.
  await page.getByTestId('skip-animal').click();
  await expect(page.getByTestId('skip-animal-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Se descarta lo cargado/)).toBeVisible();

  // Confirmar → descarta lo cargado + vuelve al identify-first del PRÓXIMO animal.
  await page.getByTestId('skip-animal-confirm').click();
  await connectMock(page);
  await expect(page.getByTestId('skip-animal-sheet')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Saltar el animal NO lo cuenta: el progreso de la jornada sigue en "0 hoy".
  await expect(page.getByText('0 hoy', { exact: true })).toBeVisible({ timeout: 15_000 });
});
