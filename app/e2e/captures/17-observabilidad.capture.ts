// e2e/captures/17-observabilidad.capture.ts — CAPTURAS del Gate 2.5 (ADR-029) de la feature 17.
//
// ⚠️ NO es regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`). Se dispara a mano:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/17-observabilidad.capture.ts --config playwright.capture.config.ts
//
// La ÚNICA UI que agrega la feature 17 es el fallback es-AR del RootErrorBoundary ("Algo salió mal" +
// "Reintentar", R2.2). Se captura vía el spike `observabilidad-spike` (DEV_WEB_ROUTES → el RootGate NO lo
// rebota a sign-in), que renderiza EL MISMO `RootErrorBoundaryFallback` que producción (no un espejo). El
// crash-test real (R2.6) está gated a development/preview → oculto en el env 'e2e' de la captura, por eso
// se usa el spike y no el trigger.
//
// Estados capturados (× 360 y 412):
//   01-fallback-error-<w>.png — el fallback del ErrorBoundary (título + copy + botón Reintentar).
// + ANTI-RECORTE del descendente: "Algo salió mal" tiene la `g` de "Algo" → se verifica bounding-box.
//
// Salida: e2e/captures/__shots__/17-observabilidad/ (gitignored).

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', '17-observabilidad');
const WIDTHS = [360, 412] as const;

async function gotoSpike(page: Page, anchor: string): Promise<void> {
  await page.goto('/observabilidad-spike');
  await expect(page.getByText(anchor, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
}

/** Verifica que ningún <Text> con `frag` se recorte (g/j/p/q/y sin lineHeight matcheado). Tol 1px. */
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
  test(`capturas fallback RootErrorBoundary @ ${width}px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    // El context propio NO hereda el auto-shim de la fixture `page` → lo aplicamos a mano ANTES del goto.
    await applyEnvShim(page);

    try {
      await gotoSpike(page, 'Algo salió mal');
      await expect(page.getByText('Algo salió mal', { exact: true })).toBeVisible();
      await expect(page.getByText('Reintentar', { exact: true })).toBeVisible();
      // La `g` de "Algo" no se recorta (lineHeight="$8" matcheando fontSize="$8").
      await assertTextNotClipped(page, 'Algo salió mal');
      await page.screenshot({ path: path.join(SHOT_DIR, `01-fallback-error-${width}.png`), fullPage: true });
    } finally {
      await ctx.close();
    }
  });
}
