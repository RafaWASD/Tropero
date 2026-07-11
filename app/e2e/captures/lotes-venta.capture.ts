// e2e/captures/lotes-venta.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029) del
// delta A `lotes-venta` (spec 02, triage demo-facundo-padre 2026-07-10): lotes OPERABLES — baja en tanda
// (venta/descarte) desde el lote + sugerencia post-tacto de las vacías.
//
// Recorre los flujos del feature y saca capturas NOMBRADAS de cada estado clave a __shots__/lotes-venta/:
//   01 — sugerencia post-tacto: sheet 'terminated' con "Encontramos {N} vacías…" (conteo) + "Elegir lote"/"Ahora no".
//   02 — vista del lote con la acción "Vender / Descartar".
//   03 — modo selección: checkbox por AnimalRow + "Todos" + contador + CTA "Registrar salida (N)".
//   04 — form de venta (datos comunes): motivo Venta + fecha común + precio/peso comunes (es-AR, coma decimal).
//   04b — form de venta (override + irreversibilidad): una fila BatchSaleAnimalRow con override + aviso "no se
//        puede deshacer" + CTA "Registrar salida".
//   05 — post-venta: el lote con MENOS cabezas (el vendido salió).
//   06 — SugerenciaVaciasSheet en modo "crear lote nuevo" con el default "Descarte".
//
// Setup BLE mock (flag __RAFAQ_BLE_E2E__, fuera de prod) para el flujo de tacto (01/06). Viewport mobile
// 412×915 (contexto propio, mismo patrón que vacunas-checklist.capture.ts). NO corras esto en `pnpm e2e`
// (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/lotes-venta.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedManagementGroup,
  seedReproductiveServiceEvent,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoLoteGroup } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'lotes-venta');

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Captura NOMBRADA tras un breve settle de layout (el llamador ya asertó visible el elemento clave). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

async function markBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
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

// ─── FLUJO 1 — BAJA EN TANDA desde el lote (02, 03, 04, 04b, 05) ─────────────────────────────────────
test('capturas baja en tanda (vender/descartar) @ 412px', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBle(page);

  try {
    const user = await createTestUser('cap-lote-venta');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Venta', {
      rodeoName: 'Cría hembras',
      rodeoRawName: true,
    });
    const grupo = await seedManagementGroup(establishmentId, 'Venta noviembre', { rawName: true });
    const idvA = '0471';
    const idvB = '0472';
    const pA = await seedAnimal(establishmentId, rodeoId, { idv: idvA, sex: 'female', categoryCode: 'multipara' });
    const pB = await seedAnimal(establishmentId, rodeoId, { idv: idvB, sex: 'female', categoryCode: 'multipara' });
    {
      const { error } = await admin.from('animal_profiles').update({ management_group_id: grupo.id }).in('id', [pA, pB]);
      if (error) throw new Error(`seed assign lote: ${error.message}`);
    }

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // (02) Vista del lote con la acción "Vender / Descartar".
    await gotoLoteGroup(page, grupo.name);
    await expect(page.getByText(idvA, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(idvB, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('lote-vender-descartar')).toBeVisible();
    await shot(page, '02-lote-vender-descartar');

    // (03) Modo selección: tildar UNA vaca → checkbox + "Todos" + "1 seleccionado" + CTA "Registrar salida (1)".
    await page.getByTestId('lote-vender-descartar').click();
    await expect(page.getByText('Elegí los animales', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('checkbox', { name: new RegExp(idvA) }).first().click();
    await expect(page.getByText('1 seleccionado', { exact: true })).toBeVisible();
    await expect(page.getByTestId('lote-registrar-salida')).toBeVisible();
    await shot(page, '03-modo-seleccion');

    // ── Form de venta: motivo Venta → datos comunes (es-AR) + un override. ──
    await page.getByTestId('lote-registrar-salida').click();
    await expect(page.getByText('¿Qué pasó con estos animales?', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Venta', exact: true }).click();
    await expect(page.getByText('Vas a dar de baja', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Datos comunes: precio 250000 + peso 385,5 (coma decimal es-AR). La fecha ya viene en HOY por default.
    await page.getByLabel('Precio por animal en $ (opcional)', { exact: true }).fill('250000');
    await page.getByLabel('Peso por animal en kg (opcional)', { exact: true }).fill('385,5');

    // (04) Form con motivo Venta + fecha común + precio/peso comunes (vista superior del form).
    await shot(page, '04-form-venta');

    // Expandir la fila del animal → cargar un override de precio (300000) → mostrar aviso irreversibilidad.
    await page.getByTestId(`batch-row-${pA}`).click();
    await page.getByTestId(`batch-row-${pA}-price`).fill('300000');
    await expect(page.getByText('Esta acción no se puede deshacer', { exact: true })).toBeVisible();
    // Scroll a la fila override para que el frame muestre override + aviso + CTA.
    await page.getByTestId(`batch-row-${pA}-price`).scrollIntoViewIfNeeded();
    await shot(page, '04b-form-venta-override');

    // (05) Registrar la salida → volver al lote con MENOS cabezas (la vaca A salió; queda B).
    await page.getByTestId('venta-registrar-salida').click();
    await expect(page.getByTestId('lote-vender-descartar')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(idvB, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(idvA, { exact: true })).toHaveCount(0, { timeout: 20_000 });
    await shot(page, '05-post-venta');
  } finally {
    await ctx.close();
  }
});

// ─── FLUJO 2 — SUGERENCIA post-tacto de las vacías (01, 06) ──────────────────────────────────────────
test('capturas sugerencia post-tacto de vacías @ 412px', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBle(page);

  try {
    const user = await createTestUser('cap-vacias');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Vacías', {
      rodeoName: 'Cría hembras',
      rodeoRawName: true,
      serviceMonths: [10], // 1 mes → VACÍA va directo al resumen (sin sub-paso de tamaño)
    });
    const eid = makeEid();
    const idv = '0555';
    const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv, sex: 'female', categoryCode: 'multipara' });
    await seedReproductiveServiceEvent(profileId); // SERVIDA → aplica el tacto de preñez

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await gotoAnimales(page);
    await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

    // ── Jornada con TACTO → bastonazo → VACÍA → confirmar. ──
    await page.goto('/maniobra/jornada');
    await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pool-row-tacto')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta
    await page.getByTestId('pool-row-tacto').click();
    await expect(page.getByTestId('selected-row-0')).toBeVisible();
    await page.getByRole('button', { name: /^Continuar/ }).click();
    await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
    await connectMock(page);
    await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });

    await bastonazo(page, eid);
    await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'VACÍA', exact: true }).click();
    await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
    await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

    // ── ‹ → Terminar jornada → sugerencia de vacías (conteo). ──
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400); // settle del fetch local de vacías (fetchSessionEmptyFemales)
    await page.getByRole('button', { name: 'Terminar jornada', exact: true }).click();
    await expect(page.getByText('Jornada terminada', { exact: true })).toBeVisible({ timeout: 10_000 });

    // (01) Sugerencia post-tacto con el conteo + acciones "Elegir lote"/"Ahora no".
    await expect(page.getByTestId('sugerencia-vacias')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Encontramos\s*1\s*vaca vacía/)).toBeVisible();
    await shot(page, '01-sugerencia-post-tacto');

    // (06) SugerenciaVaciasSheet en modo "crear lote nuevo" con el default "Descarte".
    await page.getByRole('button', { name: 'Elegir lote', exact: true }).click();
    await expect(page.getByTestId('sugerencia-vacias-sheet')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('sugerencia-vacias-crear-nuevo').click();
    await expect(page.getByTestId('sugerencia-vacias-nombre')).toHaveValue('Descarte');
    await shot(page, '06-sugerencia-crear-lote');
  } finally {
    await ctx.close();
  }
});
