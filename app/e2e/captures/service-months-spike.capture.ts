// e2e/captures/service-months-spike.capture.ts — CAPTURAS del DESIGN SPIKE del SELECTOR DE MESES de
// servicio del rodeo (spec 03 Stream B / B1, RE-ITERACIÓN con CONTIGÜIDAD POR CONSTRUCCIÓN) para el veto
// del leader (design-review) ANTES de mostrárselo a Raf.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts). Son capturas del veto 🔴 form-de-wizard en WEB TÁCTIL REAL
// (memoria reference_rn_web_pitfalls: el mouse sintético de Desktop ENMASCARA el touch → context con
// `hasTouch:true` + `isMobile:true`). La pantalla es 100% MOCK (sin servicios/RPC/outbox/auth): se alcanza
// DIRECTO por URL porque está en DEV_WEB_ROUTES (app/_layout.tsx) → el RootGate NO la rebota a sign-in. Por
// eso NO necesita seed/cleanup.
//
// 🔑 Constraint nuevo (Raf 2026-06-23): UN período CONTIGUO por rodeo, con WRAP de fin de año. La grilla es
// un selector "inicio → fin" (2 taps): imposible armar un set disjunto. Estas capturas vetan ese flujo.
//
// CUATRO ESTADOS clave × dos anchos (360 y 412):
//   (a) alta-primavera-<w>.png       — ALTA con primavera (Oct/Nov/Dic) pre-tildada (RPSC.2.2), label
//                                      "Oct → Dic · 3 meses".
//   (b) edicion-sin-config-<w>.png   — EDICIÓN de un rodeo SIN configurar: banner "sin configurar" + ningún
//                                      mes en el run + atajos sin resaltar (RPSC.3.2).
//   (c) custom-wrap-<w>.png          — período con WRAP ya cerrado (Nov → Ene): label "Nov → Ene · 3 meses"
//                                      (orden de SERVICIO, no min/max — load-bearing del modelo) (RPSC.2.3).
//   (d) intermedio-<w>.png           — estado INTERMEDIO de selección: inicio tocado (chip anchor) +
//                                      resumen-guía "Tocá el mes de fin · Empezó en …" (RPSC.2.8).
// + verificación TÁCTIL de la CONTIGÜIDAD POR CONSTRUCCIÓN (inicio → fin rellena el run hacia adelante con
//   wrap) + ANTI-RECORTE de descendentes del título por bounding-box (el título tiene '¿','q','j','g').
//
// Salida: tests/stream-b/  (gitignoreado).
//
// Para correrla:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/service-months-spike.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'stream-b');
const WIDTHS = [360, 412] as const;

/** Espera a que el bundle monte y la pantalla del spike esté visible (post-splash), por un ancla. */
async function gotoSpike(page: Page, route: string, anchor: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByText(anchor, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/** Tap táctil en el centro del bounding-box de un testID (web táctil real, no mouse sintético). */
async function tapTestId(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`sin boundingBox para ${testId}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Verifica que NINGÚN <Text> que contenga el título se RECORTE en su caja (memoria
 * feedback_descender_clipping: g/j/p/q/y + '¿' se cortan si el lineHeight no matchea el fontSize). Mide
 * el scrollHeight vs clientHeight del nodo que contiene el texto del título: si el contenido desborda la
 * caja por abajo, el descendente se está recortando. Tolerancia 1px (sub-pixel rounding de rn-web).
 */
async function assertTitleNotClipped(page: Page, titleFragment: string): Promise<void> {
  const clipped = await page.evaluate((frag) => {
    const nodes = Array.from(document.querySelectorAll('div, span'));
    for (const el of nodes) {
      const e = el as HTMLElement;
      // El nodo de texto exacto (sin hijos-elemento) que contiene el fragmento del título.
      if (e.children.length === 0 && (e.textContent || '').includes(frag)) {
        if (e.scrollHeight > e.clientHeight + 1) {
          return { found: true, scrollH: e.scrollHeight, clientH: e.clientHeight };
        }
      }
    }
    return { found: false };
  }, titleFragment);
  expect(clipped.found, `título recortado (scrollHeight>clientHeight): ${JSON.stringify(clipped)}`).toBe(false);
}

const TITLE_FRAGMENT = '¿En qué meses hace servicio';

for (const width of WIDTHS) {
  test(`capturas spike selector de meses contiguo (web táctil) @ ${width}px`, async ({ browser }) => {
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
      // ── (a) ALTA con primavera pre-tildada (RPSC.2.2) + label "Oct → Dic · 3 meses" ──
      await gotoSpike(page, '/maniobra/service-months-spike?state=alta', 'Crear rodeo · meses de servicio');
      await expect(page.getByText(TITLE_FRAGMENT, { exact: false }).first()).toBeVisible();
      await expect(page.getByTestId('service-months-grid')).toBeVisible();
      // Primavera en el run: Oct/Nov/Dic seleccionados (aria-pressed), Ene fuera; atajo Primavera activo.
      await expect(page.getByTestId('month-chip-10')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-11')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-12')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-1')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('shortcut-primavera')).toHaveAttribute('aria-pressed', 'true');
      // El resumen EN VIVO muestra el período + el conteo (Nielsen #1).
      await expect(page.getByTestId('service-months-summary-detail')).toHaveText('Oct → Dic · 3 meses');
      // NO debe verse el banner "sin configurar" en el alta.
      await expect(page.getByTestId('service-months-unconfigured')).toHaveCount(0);
      await assertTitleNotClipped(page, TITLE_FRAGMENT);
      await page.screenshot({ path: path.join(SHOT_DIR, `alta-primavera-${width}.png`) });

      // ── (b) EDICIÓN sin configurar (RPSC.3.2) ──
      await gotoSpike(page, '/maniobra/service-months-spike?state=edicion', 'Editar rodeo · meses de servicio');
      await expect(page.getByTestId('service-months-unconfigured')).toBeVisible();
      await expect(page.getByText('Todavía sin configurar.', { exact: false })).toBeVisible();
      // Ningún mes en el run y ningún atajo resaltado ("sin configurar" ≠ "ninguno").
      await expect(page.getByTestId('month-chip-10')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('shortcut-ninguno')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('shortcut-primavera')).toHaveAttribute('aria-pressed', 'false');
      // El resumen muestra el estado "sin configurar" (no un período).
      await expect(page.getByTestId('service-months-summary-detail')).toHaveText('Todavía sin configurar');
      await assertTitleNotClipped(page, TITLE_FRAGMENT);
      await page.screenshot({ path: path.join(SHOT_DIR, `edicion-sin-config-${width}.png`) });

      // ── (c) CUSTOM con WRAP ya cerrado (Nov → Ene, RPSC.2.3) ──
      await gotoSpike(page, '/maniobra/service-months-spike?state=custom', 'Crear rodeo · período con wrap');
      await expect(page.getByTestId('month-chip-11')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-12')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-1')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-10')).toHaveAttribute('aria-pressed', 'false');
      // El label expresa el WRAP en ORDEN DE SERVICIO (Nov → Ene), no min/max (Ene → Dic) — load-bearing.
      await expect(page.getByTestId('service-months-summary-detail')).toHaveText('Nov → Ene · 3 meses');
      // Período custom → ningún atajo resaltado.
      await expect(page.getByTestId('shortcut-primavera')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('shortcut-ninguno')).toHaveAttribute('aria-pressed', 'false');
      await assertTitleNotClipped(page, TITLE_FRAGMENT);
      await page.screenshot({ path: path.join(SHOT_DIR, `custom-wrap-${width}.png`) });

      // ── (d) ESTADO INTERMEDIO: inicio tocado, esperando el fin (RPSC.2.8) ──
      // Partimos de "sin configurar" para que el chip anchor no se confunda con un run previo.
      await gotoSpike(page, '/maniobra/service-months-spike?state=edicion', 'Editar rodeo · meses de servicio');
      await tapTestId(page, 'month-chip-10'); // toco el INICIO (Oct) → entra en estado anchor
      // El resumen pasa a modo GUÍA ("Tocá el mes de fin · Empezó en Oct").
      await expect(page.getByText('Tocá el mes de fin del período', { exact: false })).toBeVisible();
      await expect(page.getByTestId('service-months-summary-detail')).toHaveText('Empezó en Oct');
      // El chip de inicio NO se reporta como "selected" (es anchor, no run cerrado): aria-pressed false +
      // el matiz va en el aria-label (web → 'aria-label').
      await expect(page.getByTestId('month-chip-10')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('month-chip-10')).toHaveAttribute('aria-label', /inicio del per/i);
      await assertTitleNotClipped(page, TITLE_FRAGMENT);
      await page.screenshot({ path: path.join(SHOT_DIR, `intermedio-${width}.png`) });

      // ── CONTIGÜIDAD POR CONSTRUCCIÓN (táctil): inicio Oct → fin Dic rellena Oct/Nov/Dic ──
      await tapTestId(page, 'month-chip-12'); // toco el FIN (Dic) → cierra el run hacia adelante
      await expect(page.getByTestId('month-chip-10')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-11')).toHaveAttribute('aria-pressed', 'true'); // ¡el del medio se rellenó!
      await expect(page.getByTestId('month-chip-12')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('service-months-summary-detail')).toHaveText('Oct → Dic · 3 meses');

      // ── WRAP por construcción (táctil): inicio Nov → fin Ene rellena Nov/Dic/Ene (no Ene..Nov) ──
      await tapTestId(page, 'month-chip-11'); // 3er tap → REINICIA el período en Nov (anchor)
      await expect(page.getByTestId('service-months-summary-detail')).toHaveText('Empezó en Nov');
      await tapTestId(page, 'month-chip-1'); // fin Ene → wrap Nov-Dic-Ene
      await expect(page.getByTestId('month-chip-11')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-12')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-1')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('month-chip-2')).toHaveAttribute('aria-pressed', 'false'); // NO se pasó de largo
      await expect(page.getByTestId('service-months-summary-detail')).toHaveText('Nov → Ene · 3 meses');
    } finally {
      await ctx.close();
    }
  });
}
