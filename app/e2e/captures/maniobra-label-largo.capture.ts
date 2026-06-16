// e2e/captures/maniobra-label-largo.capture.ts — CAPTURAS para el veto del leader (🔴 manga, web táctil)
// de la ROBUSTEZ a LABELS LARGOS de MODO MANIOBRAS (spec 03).
//
// El label de `tacto_vaquillona` es "Tacto de aptitud reproductiva" (~29 chars), más largo que la mayoría
// de los labels (se le sacó el "(vaquillonas)" — redundante con el header de la carga, y se cortaba al final).
// Estas capturas (a 360 y 412 px, context hasTouch + mobile)
// verifican que NINGUNA superficie que renderiza `maneuverLabel(...)` en una sola línea overflowea con el
// label largo y que, en la LÍNEA DE MANIOBRA de la carga rápida, el contador "· N de M" SIEMPRE queda
// visible (el label elipsa con "…" en vez de empujar el contador fuera de pantalla):
//   (1) lista de maniobras del wizard (etapa 2) con tacto_vaquillona elegida → label largo en la fila.
//   (2) carga rápida en el paso tacto_vaquillona → línea "Tacto de aptitud reproductiva · 1 de 2".
//
// Las capturas se guardan en tests/modo-maniobra/ con nombres claros (wizard-vaquillona-<w>.png,
// maniobra-line-vaquillona-<w>.png).
//
// Setup espejado de maniobra-elegir.spec.ts: rodeo "Cría hembras" (0018 habilita tacto_vaquillona por
// default) + hembra categoría vaquillona con caravana electrónica (EID) → se identifica por bastonazo del
// MockAdapter (flag __RAFAQ_BLE_E2E__, fuera de prod). tacto_vaquillona + pesaje → la secuencia tiene 2
// pasos → la línea muestra "· 1 de 2" (el contador importa tanto como el nombre largo).

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'modo-maniobra');
const WIDTHS = [360, 412] as const;

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Marca el flag de E2E del bastón (mock) antes del bundle. */
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

for (const width of WIDTHS) {
  test(`capturas label largo (tacto_vaquillona) @ ${width}px`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    await applyEnvShim(page);
    await markBle(page);

    try {
      const user = await createTestUser(`cap-label-largo-${width}`);
      await setUserPhone(user.id, '1123456789');
      const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, `Campo Label ${width}`, {
        rodeoName: 'Cría hembras',
        rodeoRawName: true,
      });
      const eid = makeEid();
      const visual = '0385';
      await seedAnimal(establishmentId, rodeoId, {
        tag: eid,
        visualAlt: visual,
        sex: 'female',
        categoryCode: 'vaquillona',
      });

      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);

      // El animal baja por la stream (visible en la lista = sincronizado al SQLite local).
      await gotoAnimales(page);
      await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

      // ── WIZARD etapa 2: elegir tacto_vaquillona (+ pesaje, para la secuencia de 2 pasos). ──
      await page.goto('/maniobra/jornada');
      await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
      await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('pool-row-tacto_vaquillona')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
      await page.getByTestId('pool-row-tacto_vaquillona').click();
      await page.getByTestId('pool-row-pesaje').click();
      await expect(page.getByTestId('selected-row-1')).toBeVisible();
      // (1) Captura de la LISTA del wizard con el label largo de tacto_vaquillona en su fila seleccionada.
      await page.screenshot({ path: path.join(SHOT_DIR, `wizard-vaquillona-${width}.png`) });

      await page.getByRole('button', { name: /^Continuar/ }).click();
      await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();

      // Hero adaptativo (M2.1): con el mock conectable arranca en ConnectHero → conectamos → ScanHero.
      await connectMock(page);
      await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });

      // ── CARGA RÁPIDA: bastonazo → found → auto-avance al paso tacto_vaquillona (· 1 de 2). ──
      await bastonazo(page, eid);
      await expect(page.getByText('· 1 de 2', { exact: true })).toBeVisible({ timeout: 30_000 });
      // La línea de maniobra muestra el label LARGO; el contador "· 1 de 2" debe quedar visible (no empujado
      // fuera de pantalla). Los 3 bloques de aptitud confirman que estamos en el paso de tacto vaquillona.
      await expect(page.getByRole('button', { name: 'APTA', exact: true })).toBeVisible({ timeout: 15_000 });
      // (2) Captura de la LÍNEA DE MANIOBRA con el label largo elipsado + el contador visible.
      await page.screenshot({ path: path.join(SHOT_DIR, `maniobra-line-vaquillona-${width}.png`) });
    } finally {
      await ctx.close();
    }
  });
}
