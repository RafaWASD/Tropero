// e2e/captures/reportes-spike.capture.ts — CAPTURAS del DESIGN SPIKE de REPORTES (spec 07 Stream C —
// FRONTEND) para el veto del leader (design-review) ANTES de mostrárselo a Raf.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts). Capturas del veto 🟡 densidad mixta en WEB TÁCTIL REAL (memoria
// reference_rn_web_pitfalls: el mouse sintético de Desktop ENMASCARA el touch → context con `hasTouch:true`
// + `isMobile:true`). La pantalla es 100% MOCK (`reportes-spike`, en DEV_WEB_ROUTES → el RootGate NO la
// rebota a sign-in) y usa los MISMOS componentes que la tab Reportes real → no necesita seed/login.
//
// ESTADOS clave × dos anchos (360 y 412):
//   (a) kpis-<w>.png     — KPIs del rodeo poblados (preñez/parición + CCL + cruce con nacimientos + peso).
//   (b) sesion-<w>.png   — resumen de una sesión (conteo por tipo de evento + marco temporal).
//   (c) alertas-<w>.png  — las 2 alertas (dosis vencida + sin pesar) con ítems accionables.
//   (d) vacio-<w>.png    — estado vacío (rodeo sin datos aún) + alertas resueltas (empty positivo).
//   (e) offline-<w>.png  — estado online-only sin conexión ("necesitás conexión").
//   (f) config-<w>.png   — rodeo sin estación de servicio (invita a configurar).
// + ANTI-RECORTE de descendentes (títulos con g/j/p/q/y: "Preñez", "Jornada", "Reproductivo",
//   "Configurá la estación de servicio") por bounding-box.
//
// Salida: tests/stream-c/  (gitignoreado).
//
// Para correrla:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/reportes-spike.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'stream-c');
const WIDTHS = [360, 412] as const;

/** Espera a que el bundle monte y la pantalla del spike esté visible (post-splash), por un ancla. */
async function gotoSpike(page: Page, route: string, anchor: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByText(anchor, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Verifica que NINGÚN <Text> que contenga `frag` se RECORTE en su caja (memoria
 * feedback_descender_clipping: g/j/p/q/y se cortan si el lineHeight no matchea el fontSize). Mide
 * scrollHeight vs clientHeight del nodo de texto. Tolerancia 1px (sub-pixel rounding de rn-web).
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
  test(`capturas spike reportes (web táctil) @ ${width}px`, async ({ browser }) => {
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
      // ── (a) KPIs poblados (preñez/parición + CCL + cruce + peso) ──
      await gotoSpike(page, '/reportes-spike?variant=kpis', 'Reproductivo');
      await expect(page.getByText('Preñez', { exact: true })).toBeVisible();
      await expect(page.getByText('Parición', { exact: true })).toBeVisible();
      // Denominador explícito visible (R7.5.5).
      await expect(page.getByText('41 preñadas / 46 servidas', { exact: false })).toBeVisible();
      // CCL + cruce.
      await expect(page.getByText('Distribución de preñez', { exact: false })).toBeVisible();
      await expect(page.getByText('Al tacto', { exact: false })).toBeVisible();
      await expect(page.getByText('Nacimientos', { exact: false })).toBeVisible();
      await assertTextNotClipped(page, 'Preñez');
      await assertTextNotClipped(page, 'Reproductivo');
      await page.screenshot({ path: path.join(SHOT_DIR, `kpis-${width}.png`), fullPage: true });

      // ── (b) Resumen de sesión ──
      await gotoSpike(page, '/reportes-spike?variant=sesion', 'Jornada');
      await expect(page.getByText('46 animales intervenidos', { exact: false })).toBeVisible();
      await expect(page.getByText('Pesajes', { exact: true })).toBeVisible();
      await assertTextNotClipped(page, 'Jornada');
      await page.screenshot({ path: path.join(SHOT_DIR, `sesion-${width}.png`), fullPage: true });

      // ── (c) Alertas con ítems ──
      await gotoSpike(page, '/reportes-spike?variant=alertas', 'Dosis vencidas');
      await expect(page.getByText('Animales sin pesar', { exact: true })).toBeVisible();
      await expect(page.getByText('Nunca pesado', { exact: false })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `alertas-${width}.png`), fullPage: true });

      // ── (d) Vacío (sin datos) + alertas resueltas (empty positivo) ──
      await gotoSpike(page, '/reportes-spike?variant=vacio', 'Sin datos de esta campaña');
      await expect(page.getByText('No hay dosis vencidas', { exact: false })).toBeVisible();
      await expect(page.getByText('Todos al día', { exact: false })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `vacio-${width}.png`), fullPage: true });

      // ── (e) Offline (online-only) ──
      await gotoSpike(page, '/reportes-spike?variant=offline', 'Necesitás conexión');
      await expect(page.getByText('Reintentar', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `offline-${width}.png`), fullPage: true });

      // ── (f) Configurar estación de servicio ──
      await gotoSpike(page, '/reportes-spike?variant=config', 'Configurá la estación de servicio');
      await expect(page.getByText('Configurar servicio', { exact: false })).toBeVisible();
      await assertTextNotClipped(page, 'Configurá la estación de servicio');
      await page.screenshot({ path: path.join(SHOT_DIR, `config-${width}.png`), fullPage: true });

      // ── (g) Comparativa de 2 sesiones (delta por tipo de evento + peso) ──
      await gotoSpike(page, '/reportes-spike?variant=comparar', 'Comparar');
      await expect(page.getByText('Eventos por tipo', { exact: true })).toBeVisible();
      await expect(page.getByText('Peso por categoría', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `comparar-${width}.png`), fullPage: true });
    } finally {
      await ctx.close();
    }
  });
}
