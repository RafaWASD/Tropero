// e2e/maniobra-tap-wheel.spec.ts — TAP-TO-SELECT en la RUEDA INERCIAL (delta #16 sobre spec 03, RTW.7.1).
//
// REGRESIÓN de la INTERACCIÓN tap→snap: tapear una celda VISIBLE no central del drum ANIMA + snapea la rueda
// hasta centrar ese valor y dispara el MISMO onValueChange que el drag → el campo espejo `ce-input` cambia al
// valor de la celda tapeada. Es la interacción, no solo el estado: una captura estática no muestra el tap→snap
// (por eso hay E2E además del capture del Gate 2.5). Cubre RTW.1.2/1.3 (tap no central anima+snap+notifica),
// RTW.1.4 (tap de la celda central = no-op de valor) y RTW.5.2 (el tap no cierra la pantalla ni doble-dispara).
//
// Web TÁCTIL REAL (memoria reference_rn_web_pitfalls: el mouse sintético de Playwright Desktop ENMASCARA el
// touch → context PROPIO con hasTouch:true + isMobile:true; se tapea con locator.tap()). Corre sobre el SPIKE
// /maniobra/rueda-ce (en DEV_WEB_ROUTES → alcanzable directo en web SIN auth/seed/cleanup); la instancia real
// de CE hereda el mismo WheelPicker. Importa test/expect/applyEnvShim de ./helpers/fixtures
// (reference_e2e_fixtures_import). El context propio NO hereda el auto-shim de la fixture `page` → applyEnvShim
// a mano ANTES del goto (si no, el bundle web de producción crashea por EXPO_PUBLIC_* faltantes).
//
// La rueda de CE arranca en 36 cm (índice 32 de la grilla 20–50/0,5). Celdas VISIBLES = índice centrado ±2
// (CONTEXT_CELLS=2). testID por celda = `ce-wheel-cell-<i>` (i = índice ABSOLUTO en la grilla; sigue al valor,
// no a la posición en pantalla): cell-32 ↔ 36 cm, cell-33 ↔ 36,5, cell-34 ↔ 37, cell-30 ↔ 35.

import { test, expect, applyEnvShim } from './helpers/fixtures';
import type { Page } from '@playwright/test';

/** Abre el spike y confirma el reposo inicial (36 cm en el campo espejo). */
async function gotoSpike(page: Page): Promise<void> {
  await page.goto('/maniobra/rueda-ce');
  await expect(page.getByText('Confirmar', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ce-wheel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ce-input')).toHaveValue('36'); // reposo mock inicial (36 cm).
}

test('TAP: tapear una celda visible no central de la rueda de CE la selecciona (anima+snap+onValueChange)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);

  try {
    await gotoSpike(page);
    const ceInput = page.getByTestId('ce-input');

    // (1) TAP de una celda VISIBLE NO central: índice 34 (37 cm, DOS celdas arriba del centro 36). La rueda
    // anima + snapea hasta centrar 37 y el campo espejo cambia al valor tapeado (RTW.1.2/RTW.1.3).
    await page.getByTestId('ce-wheel-cell-34').tap();
    await expect(ceInput).toHaveValue('37');

    // (2) RE-SELECCIÓN desde el nuevo centro: centrada en 37 (índice 34), las visibles son 32–36. Tapear el
    // índice 33 (36,5 cm, una celda arriba del nuevo centro) re-selecciona → el campo pasa a "36,5" (es-AR).
    await page.getByTestId('ce-wheel-cell-33').tap();
    await expect(ceInput).toHaveValue('36,5');

    // (3) NO-OP de la celda CENTRAL (RTW.1.4): ahora centrada en 36,5 (índice 33). Tapear la PROPIA celda
    // central NO cambia el valor (no re-dispara onValueChange espurio). El wait deja pasar un cambio espurio
    // si lo hubiera antes de re-assertar.
    await page.getByTestId('ce-wheel-cell-33').tap();
    await page.waitForTimeout(400);
    await expect(ceInput).toHaveValue('36,5');

    // (4) El tap NO cerró la pantalla ni disparó tap-through (RTW.5.2): seguimos en el spike con la rueda y el
    // confirm visibles (la rueda de CE es inline, no en un sheet → el tap del cell no descarta nada).
    await expect(page.getByText('Confirmar', { exact: true })).toBeVisible();
    await expect(page.getByTestId('ce-wheel')).toBeVisible();

    // (5) TAP hacia ABAJO (celda por debajo del centro): centrada en 36,5 (índice 33), tapear el índice 31
    // (35,5 cm, dos abajo) baja el valor → confirma que el tap funciona en ambas direcciones.
    await page.getByTestId('ce-wheel-cell-31').tap();
    await expect(ceInput).toHaveValue('35,5');
  } finally {
    await ctx.close();
  }
});
