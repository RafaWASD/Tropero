// e2e/maniobra-spike.spec.ts — CAPTURA del DESIGN SPIKE de MODO MANIOBRAS (spec 03 M2.0) para el veto
// del leader con la skill design-review.
//
// NO es un test de la Fase 6 (E2E formal): son las capturas en 412×915 (viewport del project) que el
// leader vetea ANTES de mostrar a Raf (manga-crítico). Las pantallas del spike son 100% MOCK (sin
// servicios/BLE/PowerSync/auth): se alcanzan DIRECTO por URL en web porque están en DEV_WEB_ROUTES
// (app/_layout.tsx) → el RootGate NO las rebota a sign-in. Por eso, a diferencia de los otros specs,
// este NO necesita createTestUser/seed/cleanup.
//
// Capturas:
//   1) /maniobra/paso  — PESAJE: display + teclado numérico gigante + CTA Confirmar
//      → design/maniobra-spike/paso.png
//
// AS-BUILT M2.2 (2026-06-14): la captura de la CARGA RÁPIDA binaria (Tacto PREÑADA/VACÍA) DEJÓ de vivir
// acá — `/maniobra/carga` ya NO es el spike mock, es el FRAME REAL (autenticado, requiere
// sessionId+profileId). El flujo real (identify→carga→tacto→pesaje→resumen→siguiente) + sus capturas
// (incluido el paso de tacto del TactoStep) viven en `maniobra-carga.spec.ts`. Acá queda solo el spike
// de PESAJE (`/maniobra/paso`), aún mock, como referencia visual hasta que M3 lo cablee.
//
// Además MIDE la densidad (R12.5): el % del alto útil (viewport menos el header de identidad) que
// ocupa el teclado. Lo loguea por consola para el reporte del implementer.
//
// Para correrla:  cd app && pnpm e2e:build && pnpm exec playwright test e2e/maniobra-spike.spec.ts

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';

const OUT_DIR = path.join(__dirname, '..', '..', 'design', 'maniobra-spike');

/** Espera a que el bundle monte y la pantalla del spike esté visible (post-splash), por un ancla. */
async function gotoSpike(page: Page, route: string, anchor: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByText(anchor, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Mide la fracción del ALTO ÚTIL (viewport - header de identidad) que ocupan los CONTROLES DE ACCIÓN
 * (border-to-border, R12.5). Mide los <div>s REALES de los controles (no el texto centrado adentro,
 * que subestima): cada control de acción lleva `testID="<testId>"` (react-native-web → data-testid).
 * Tomamos la unión [min(top), max(bottom)] de todos sus boxes. El header de identidad lleva fondo
 * $surface; su bottom marca el inicio del alto útil (R12.5: alto útil = viewport menos header + safe-
 * area; el padding inferior del safe-area queda DENTRO del rango de acción porque los controles se
 * extienden hasta él).
 */
async function measureDensity(
  page: Page,
  testId: string,
): Promise<{ viewport: number; headerBottom: number; usable: number; actionTop: number; actionBottom: number; pct: number }> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('viewport no disponible');

  const SURFACE_RGB = 'rgb(248, 246, 241)'; // $surface = #F8F6F1 (fondo del header de identidad)

  const res = await page.evaluate(
    ({ testId, surfaceRgb }) => {
      const norm = (c: string) => c.replace(/\s+/g, '');
      let actionTop = Infinity;
      let actionBottom = -Infinity;
      for (const el of Array.from(document.querySelectorAll(`[data-testid="${testId}"]`))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.height < 8) continue;
        actionTop = Math.min(actionTop, r.top);
        actionBottom = Math.max(actionBottom, r.bottom);
      }
      // Header de identidad: el bloque $surface más alto en la franja superior (top < 80).
      let headerBottom = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const e = el as HTMLElement;
        const r = e.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (norm(getComputedStyle(e).backgroundColor) === norm(surfaceRgb) && r.top < 80) {
          headerBottom = Math.max(headerBottom, r.bottom);
        }
      }
      return { actionTop, actionBottom, headerBottom };
    },
    { testId, surfaceRgb: SURFACE_RGB },
  );

  if (!Number.isFinite(res.actionTop) || !Number.isFinite(res.actionBottom)) {
    throw new Error(`no se ubicaron controles con testID="${testId}"`);
  }
  const headerBottom = res.headerBottom > 0 ? res.headerBottom : 51;
  const usable = viewport.height - headerBottom;
  const actionHeight = res.actionBottom - res.actionTop;
  const pct = (actionHeight / usable) * 100;
  return { viewport: viewport.height, headerBottom, usable, actionTop: res.actionTop, actionBottom: res.actionBottom, pct };
}

test('captura: PESAJE (teclado numérico gigante + CTA Confirmar) + densidad', async ({ page }) => {
  await gotoSpike(page, '/maniobra/paso', 'Confirmar');

  // Anclas: identidad, el display de peso (mock '385' + 'kg'), las teclas gigantes y el CTA.
  await expect(page.getByText('ARG 4721', { exact: true })).toBeVisible();
  await expect(page.getByText('385', { exact: true })).toBeVisible();
  await expect(page.getByText('kg', { exact: true })).toBeVisible();
  await expect(page.getByText('Confirmar', { exact: true })).toBeVisible();
  // Las teclas: el '1' (esquina sup-izq) y el '0' (última fila) confirman el teclado.
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('0', { exact: true }).first()).toBeVisible();

  // Captura SIEMPRE antes del assert (idem carga).
  await page.screenshot({ path: path.join(OUT_DIR, 'paso.png') });

  // Densidad (R12.5): el teclado numérico + el CTA (ambos testID="action-zone") miden border-to-border
  // y se reparten el alto útil.
  const d = await measureDensity(page, 'action-zone');
  // eslint-disable-next-line no-console
  console.log(
    `[densidad paso] viewport=${d.viewport} headerBottom=${Math.round(d.headerBottom)} usable=${Math.round(d.usable)} ` +
      `accion=[${Math.round(d.actionTop)}..${Math.round(d.actionBottom)}] → ${d.pct.toFixed(1)}% del alto útil`,
  );
  expect(d.pct).toBeGreaterThanOrEqual(60);
});
