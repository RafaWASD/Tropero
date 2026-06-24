// e2e/captures/tacto-spike.capture.ts — CAPTURAS del DESIGN SPIKE del TACTO DE PREÑEZ CONFIGURABLE
// (spec 03 Stream B / B2, RPSC.4 / RPSC.5) para el veto del leader (design-review) ANTES de mostrárselo
// a Raf.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts). Son capturas del veto 🔴 manga en WEB TÁCTIL REAL (memoria
// reference_rn_web_pitfalls: el mouse sintético de Desktop ENMASCARA el touch → context con `hasTouch:true`
// + `isMobile:true`). La pantalla es 100% MOCK (sin servicios/RPC/jornada/auth): se alcanza DIRECTO por URL
// porque está en DEV_WEB_ROUTES (app/_layout.tsx) → el RootGate NO la rebota a sign-in. Por eso NO necesita
// seed/cleanup.
//
// VARIANTES clave × dos anchos (360 y 412):
//   (a) tacto-2bloques-<w>.png       — rodeo de 2 MESES: al marcar PREÑADA, sub-paso de tamaño con DOS
//                                      bloques (CABEZA/COLA, sin CUERPO) (RPSC.5.3). ← LA que Raf quiere ver.
//   (b) tacto-3bloques-<w>.png       — rodeo de 3 MESES: PREÑADA → TRES bloques (CABEZA/CUERPO/COLA) (RPSC.5.4).
//   (c) tacto-binario-1mes-<w>.png   — rodeo de 1 MES: el binario PREÑADA/VACÍA; al marcar PREÑADA NO se
//                                      abre sub-paso de tamaño (persiste directo, DD-PSC-2) (RPSC.5.2).
//   (d) config-si-<w>.png            — config "¿medir tamaño?" con sugerido SÍ (rodeo de 3 meses) (RPSC.4.2).
//   (e) config-no-<w>.png            — config "¿medir tamaño?" con sugerido NO (rodeo sin configurar) (RPSC.4.4).
// + ANTI-RECORTE de descendentes ("PREÑADA" con ñ; el título del config "¿Medir tamaño de preñez?" con
//   '¿','g','ñ') por bounding-box.
//
// Salida: tests/stream-b/  (gitignoreado).
//
// Para correrla:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/tacto-spike.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'stream-b');
const WIDTHS = [360, 412] as const;

/** Espera a que el bundle monte y la pantalla del spike esté visible (post-splash), por un ancla. */
async function gotoSpike(page: Page, route: string, anchor: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByText(anchor, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
}

/** Tap táctil en el centro del bounding-box de un texto exacto (web táctil real, no mouse sintético). */
async function tapText(page: Page, text: string): Promise<void> {
  const box = await page.getByText(text, { exact: true }).boundingBox();
  if (!box) throw new Error(`sin boundingBox para "${text}"`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Verifica que NINGÚN <Text> que contenga `frag` se RECORTE en su caja (memoria
 * feedback_descender_clipping: g/j/p/q/y + 'ñ' + '¿' se cortan si el lineHeight no matchea el fontSize).
 * Mide scrollHeight vs clientHeight del nodo de texto. Tolerancia 1px (sub-pixel rounding de rn-web).
 */
async function assertTextNotClipped(page: Page, frag: string): Promise<void> {
  const clipped = await page.evaluate((f) => {
    const nodes = Array.from(document.querySelectorAll('div, span'));
    for (const el of nodes) {
      const e = el as HTMLElement;
      if (e.children.length === 0 && (e.textContent || '').includes(f)) {
        if (e.scrollHeight > e.clientHeight + 1) {
          return { found: true, scrollH: e.scrollHeight, clientH: e.clientHeight };
        }
      }
    }
    return { found: false };
  }, frag);
  expect(clipped.found, `texto recortado (scrollHeight>clientHeight): ${JSON.stringify(clipped)}`).toBe(false);
}

for (const width of WIDTHS) {
  test(`capturas spike tacto configurable (web táctil) @ ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    // El context propio (browser.newContext) NO hereda el auto-shim de la fixture `page` → lo aplicamos a
    // mano ANTES del goto (si no, el bundle web de producción crashea por las EXPO_PUBLIC_* faltantes).
    await applyEnvShim(page);

    try {
      // ── (a) RODEO DE 2 MESES → PREÑADA → 2 bloques (CABEZA/COLA) ── ← LA que Raf quiere ver
      await gotoSpike(page, '/maniobra/tacto-spike?variant=two', 'Tacto · rodeo de 2 meses');
      // El binario PREÑADA/VACÍA NO se rediseña (RPSC.5.1). "PREÑADA" sin recorte (ñ).
      await expect(page.getByText('PREÑADA', { exact: true })).toBeVisible();
      await expect(page.getByText('VACÍA', { exact: true })).toBeVisible();
      await assertTextNotClipped(page, 'PREÑADA');
      // Tocamos PREÑADA → abre el sub-paso de tamaño con DOS bloques (cabeza/cola, sin cuerpo).
      await tapText(page, 'PREÑADA');
      await expect(page.getByText('CABEZA', { exact: true })).toBeVisible();
      await expect(page.getByText('COLA', { exact: true })).toBeVisible();
      await expect(page.getByText('CUERPO', { exact: true })).toHaveCount(0); // 2 meses → SIN cuerpo
      await page.screenshot({ path: path.join(SHOT_DIR, `tacto-2bloques-${width}.png`) });
      // Mapeo 1:1 end-to-end (RPSC.5.6): tocar COLA persiste 'small'.
      await tapText(page, 'COLA');
      await expect(page.getByTestId('tacto-confirmed-status')).toHaveText('confirmado: small');

      // ── (b) RODEO DE 3 MESES → PREÑADA → 3 bloques (CABEZA/CUERPO/COLA) — control ──
      await gotoSpike(page, '/maniobra/tacto-spike?variant=three', 'Tacto · rodeo de 3 meses');
      await tapText(page, 'PREÑADA');
      await expect(page.getByText('CABEZA', { exact: true })).toBeVisible();
      await expect(page.getByText('CUERPO', { exact: true })).toBeVisible();
      await expect(page.getByText('COLA', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `tacto-3bloques-${width}.png`) });

      // ── (c) RODEO DE 1 MES → binario; PREÑADA va DIRECTO sin sub-paso de tamaño (DD-PSC-2) ──
      await gotoSpike(page, '/maniobra/tacto-spike?variant=none', 'Tacto · rodeo de 1 mes');
      await expect(page.getByText('PREÑADA', { exact: true })).toBeVisible();
      await expect(page.getByText('VACÍA', { exact: true })).toBeVisible();
      await assertTextNotClipped(page, 'PREÑADA');
      // Captura del binario ANTES de tocar (el estado que se ve en un rodeo de 1 mes).
      await page.screenshot({ path: path.join(SHOT_DIR, `tacto-binario-1mes-${width}.png`) });
      // Verificación: al tocar PREÑADA NO aparece el sub-paso de tamaño Y persiste directo 'large'
      // (DD-PSC-2 — no es ni vacío ni nada: es una preñez positiva sin tamaño).
      await tapText(page, 'PREÑADA');
      await expect(page.getByText('CABEZA', { exact: true })).toHaveCount(0);
      await expect(page.getByText('CUERPO', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('tacto-confirmed-status')).toHaveText('confirmado: large');

      // ── (d) CONFIG "¿medir tamaño?" con sugerido SÍ (rodeo de 3 meses) ──
      await gotoSpike(page, '/maniobra/tacto-spike?variant=config-yes', 'Config tacto · sugerido SÍ');
      await expect(page.getByTestId('tacto-config-sheet')).toBeVisible();
      await expect(page.getByText('¿Medir tamaño de preñez?', { exact: false })).toBeVisible();
      // El sugerido derivado del rodeo es VISIBLE y explícito (RPSC.4.2).
      await expect(page.getByText('Sugerido: SÍ', { exact: false })).toBeVisible();
      await expect(page.getByText('3 meses de servicio', { exact: false })).toBeVisible();
      // El segmentado pre-selecciona SÍ (aria-pressed) y permite override de un toque.
      await expect(page.getByTestId('tacto-config-yes')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('tacto-config-no')).toHaveAttribute('aria-pressed', 'false');
      await assertTextNotClipped(page, '¿Medir tamaño de preñez?');
      await page.screenshot({ path: path.join(SHOT_DIR, `config-si-${width}.png`) });
      // Override de un toque: tocar NO invierte la selección (RPSC.4.3).
      await tapText(page, 'NO');
      await expect(page.getByTestId('tacto-config-no')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('tacto-config-yes')).toHaveAttribute('aria-pressed', 'false');

      // ── (e) CONFIG "¿medir tamaño?" con sugerido NO (rodeo sin configurar, RPSC.4.4) ──
      await gotoSpike(page, '/maniobra/tacto-spike?variant=config-no', 'Config tacto · sin configurar');
      await expect(page.getByTestId('tacto-config-sheet')).toBeVisible();
      await expect(page.getByText('Sugerido: NO', { exact: false })).toBeVisible();
      await expect(page.getByText('todavía no tiene meses de servicio', { exact: false })).toBeVisible();
      // Pre-selecciona NO.
      await expect(page.getByTestId('tacto-config-no')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('tacto-config-yes')).toHaveAttribute('aria-pressed', 'false');
      await assertTextNotClipped(page, '¿Medir tamaño de preñez?');
      await page.screenshot({ path: path.join(SHOT_DIR, `config-no-${width}.png`) });
    } finally {
      await ctx.close();
    }
  });
}
