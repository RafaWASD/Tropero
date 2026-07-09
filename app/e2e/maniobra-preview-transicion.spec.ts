// e2e/maniobra-preview-transicion.spec.ts — preview de transición de categoría OFFLINE (spec 03 R8.4).
//
// El operario debe VER, en el RESUMEN del animal, el cambio de categoría que el server aplicará al
// sincronizar, ANTES de subir. Caso canónico R8.1: un TACTO POSITIVO sobre una VAQUILLONA la transiciona a
// VAQUILLONA PREÑADA. Display-only (el server es la verdad); reusa el espejo C6 computeCategoryCode.
//
// Flujo: jornada SOLO TACTO en un rodeo de cría (prenez habilitada) → bastonazo a una vaquillona →
// carga rápida → PREÑADA → CABEZA → RESUMEN → asserta que el banner `summary-category-preview` está
// visible con el destino ("Vaquillona preñada") + "Se actualiza al sincronizar.". Y el caso negativo: un
// tacto VACÍO no muestra el banner (no hay transición).

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
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

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Arranca una jornada SOLO TACTO (rodeo de cría → prenez habilitada) y aterriza en la identificación. */
async function startSessionTacto(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // El pool con tacto prueba que el rodeo_data_config ya está en el SQLite local. Dwell para que el sync
  // (rodeo_data_config + categories_by_system del catálogo del preview) se asiente antes de la carga rápida.
  await expect(page.getByTestId('pool-row-tacto')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('pool-row-tacto').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── Caso canónico (R8.1): tacto+ sobre vaquillona → el resumen anticipa "Vaquillona preñada". ──
test('preview de transición: tacto+ sobre vaquillona muestra "Vaquillona preñada" en el resumen (R8.4)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('r84-prenada');
  await setUserPhone(user.id, '1123456789');
  // B2: rodeo con 3 meses de servicio → el tacto ofrece el sub-paso de tamaño (CABEZA/CUERPO/COLA). Este test
  // toca CABEZA para un tacto+ → necesita el sub-paso (un rodeo sin configurar iría directo, DD-PSC-2).
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Preview R84', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10, 11, 12],
  });
  const eid = makeEid();
  const visual = '0410';
  // VAQUILLONA (sin override) → el espejo C6 la muestra "Vaquillona"; el tacto+ la transicionará a preñada.
  await seedAnimal(establishmentId, rodeoId, {
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

  await startSessionTacto(page);
  await bastonazo(page, eid);
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Carga rápida: header con la categoría ACTUAL (Vaquillona) + el paso de tacto.
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Cría hembras · Vaquillona', { exact: true })).toBeVisible();
  await expect(page.getByText('PREÑADA', { exact: true })).toBeVisible();

  // Tacto PREÑADA → CABEZA (large = positivo).
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).click();
  await page.getByRole('button', { name: 'CABEZA', exact: true }).click();

  // RESUMEN: el banner de preview anticipa la transición que el server aplicará al sincronizar.
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  const banner = page.getByTestId('summary-category-preview');
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Vaquillona preñada', { exact: true })).toBeVisible();
  await expect(banner.getByText('Se actualiza al sincronizar.', { exact: true })).toBeVisible();
  // El FROM (categoría actual) también está en el banner.
  await expect(banner.getByText(/Categoría: Vaquillona/)).toBeVisible();
  // Captura para el veto visual (descendentes ñ/p/q/g de "Vaquillona preñada" no recortados).
  await page.screenshot({
    path: path.join(__dirname, '..', '..', 'design', 'maniobra-carga', 'resumen-preview-transicion.png'),
  });
});

// ── Caso negativo: tacto VACÍO → no hay transición → el banner NO aparece. ──
test('preview de transición: tacto VACÍO no muestra el banner (sin transición, R8.4)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('r84-vacia');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Preview Vacia R84');
  const eid = makeEid();
  const visual = `${RUN_TAG}-V`;
  await seedAnimal(establishmentId, rodeoId, {
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

  await startSessionTacto(page);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Tacto VACÍA → no transiciona (no positivo).
  await page.getByRole('button', { name: 'VACÍA', exact: true }).click();

  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Vacía', { exact: true })).toBeVisible();
  // El banner de preview NO debe aparecer (no hubo transición de categoría).
  await expect(page.getByTestId('summary-category-preview')).toHaveCount(0);
});
