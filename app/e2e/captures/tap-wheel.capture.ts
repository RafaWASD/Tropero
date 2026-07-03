// e2e/captures/tap-wheel.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta TAP-TO-SELECT en la
// RUEDA INERCIAL (#16 sobre spec 03, RTW.7.2). Recorre el drum de circunferencia escrotal y saca CAPTURAS
// NOMBRADAS del ESTADO del drum ANTES y DESPUÉS de tapear una celda visible (evidencia visual del snap al
// valor tapeado) → el leader las vete (design-review) antes de la Puerta 2.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts). La RED DE REGRESIÓN del tap vive en e2e/maniobra-tap-wheel.spec.ts
// (la interacción tap→snap asertada). Este archivo SOLO captura estados.
//
// Web TÁCTIL REAL (memoria reference_rn_web_pitfalls: el mouse sintético de Playwright Desktop ENMASCARA el
// touch → context PROPIO con hasTouch:true + isMobile:true; se tapea con locator.tap()). Pantalla 100% MOCK
// (spike /maniobra/rueda-ce en DEV_WEB_ROUTES → sin auth/seed/cleanup). El context propio NO hereda el
// auto-shim de la fixture `page` → applyEnvShim a mano ANTES del goto.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/tap-wheel.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/tap-wheel/  (gitignoreado — ver app/.gitignore + ADR-029 §Artefactos).

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';

// Path RELATIVO a app/ (cwd de Playwright). page.screenshot crea los dirs padre solos.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'tap-wheel');
const WIDTHS = [360, 412] as const;

/** Espera a que el bundle monte y el spike esté visible (post-splash) con el reposo mock (36 cm). */
async function gotoSpike(page: Page): Promise<void> {
  await page.goto('/maniobra/rueda-ce');
  await expect(page.getByText('Confirmar', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ce-wheel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ce-input')).toHaveValue('36');
}

/** Captura NOMBRADA tras un breve settle de layout (deja asentar la animación del snap del tap). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

for (const width of WIDTHS) {
  test(`capturas tap-to-select rueda CE (web táctil) @ ${width}px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width, height: 915 } });
    const page = await ctx.newPage();
    await applyEnvShim(page);

    try {
      await gotoSpike(page);
      const ceInput = page.getByTestId('ce-input');

      // (01) ANTES del tap: drum en reposo centrado en 36 cm (el campo espejo muestra "36").
      await shot(page, `01-drum-antes-36-${width}`);

      // (02) DESPUÉS de tapear la celda visible de 37 cm (índice 34, dos arriba del centro): la rueda animó +
      // snapeó hasta centrar 37 → el valor centrado CAMBIÓ (evidencia del tap→snap). El campo espejo confirma.
      await page.getByTestId('ce-wheel-cell-34').tap();
      await expect(ceInput).toHaveValue('37');
      await shot(page, `02-drum-despues-tap-37-${width}`);

      // (03) DESPUÉS de tapear la celda de 36,5 cm (índice 33, una arriba del nuevo centro 37): el drum snapea
      // a un valor ".5" → muestra que la selección por tap aterriza EXACTO en la media-celda sin recortar.
      await page.getByTestId('ce-wheel-cell-33').tap();
      await expect(ceInput).toHaveValue('36,5');
      await shot(page, `03-drum-despues-tap-36-5-${width}`);
    } finally {
      await ctx.close();
    }
  });
}
