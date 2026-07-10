// e2e/captures/paricion-fix.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta #8
// "%PARICIÓN fix del 0% + lógica de meses de parto" (spec 07, RPF.1–RPF.8). Recorre los CINCO estados de
// la card de Parición y saca CAPTURAS NOMBRADAS de cada uno a
// `e2e/captures/__shots__/paricion-fix/NN-estado.png` para que el leader las vete (design-review) y se las
// muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del delta vive
// en la suite backend `supabase/tests/reports/run.cjs` (TR.4b: los 4 estados + pending_pregnant) y en la
// unit pura `app/src/utils/reports-format.test.ts` (calvingCardView); este archivo SOLO captura estados.
//
// POR QUÉ EL SPIKE (no seed/login): la card real (`(tabs)/reportes.tsx`) consume la RPC gateada contra el
// remoto y forzar los 5 estados exigiría sembrar 5 rodeos con distintos `service_months` + fechas relativas
// (caro y frágil). El spike (`app/reportes-spike.tsx`, DEV_WEB_ROUTES → el RootGate NO lo rebota a sign-in)
// expone una VARIANTE `?variant=paricion-*` por estado, renderizando la card con datos MOCK a través de los
// MISMOS componentes de producción (calvingCardView + KpiCard + InfoNote) → lo que se vetea acá ES lo que se
// ve en la tab real. La `page` fixture de ./helpers/fixtures aplica el env-shim del bundle web sola.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/paricion-fix.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/paricion-fix/  (gitignoreado — app/.gitignore + ADR-029 §Artefactos).
//
// Estados capturados (RPF.7.1):
//   01-ok-con-porcentaje   — status 'ok': el %parición + "N paridas / M servidas" (D1/D2, sin leyenda).
//   02-not-calving-season  — "Todavía no es época de parición" (antes de la ventana +9, D2): NO 0% prematuro.
//   03-no-service-months   — "Sin meses de servicio configurados" (service_months vacío/NULL, D3): NO 0%.
//   04-not-applicable-12m  — "No aplica (servicio todo el año)" (servicio continuo 12 meses, D5).
//   05-ok-con-leyenda      — status 'ok' + la leyenda D4 "Todavía hay vacas que no parieron…" (pending>0).
// + ANTI-RECORTE de descendentes (RPF.7.2) sobre "Parición", "Todavía no es época de parición",
//   "Sin meses de servicio configurados" (memoria feedback_descender_clipping: p/q/g/j/y).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

// Path RELATIVO a app/ (cwd de Playwright) → resuelve a app/e2e/captures/__shots__/paricion-fix/.
// page.screenshot crea los dirs padre solos.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'paricion-fix');

/**
 * Saca una captura NOMBRADA tras un breve settle de layout (la card no anima, pero el mount del bundle y el
 * layout del ScrollView pueden dejar un frame en vuelo). El llamador asegura un expect(...).toBeVisible()
 * del texto clave ANTES de invocar esto (per ADR-029).
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * Navega a una variante del spike y espera a que la sección "Reproductivo" (el ReportSectionHeader que
 * envuelve la card de Parición) esté visible → el bundle montó y la card está renderizada.
 */
async function gotoParicion(page: Page, variant: string): Promise<void> {
  await page.goto(`/reportes-spike?variant=${variant}`);
  await expect(page.getByText('Reproductivo', { exact: true })).toBeVisible({ timeout: 30_000 });
  // La card de Parición vive en la fila Preñez | Parición → el label "Parición" confirma el render.
  await expect(page.getByText('Parición', { exact: true })).toBeVisible();
}

/**
 * Verifica que NINGÚN <Text> que contenga `frag` se RECORTE en su caja (memoria
 * feedback_descender_clipping: g/j/p/q/y se cortan si el lineHeight no matchea el fontSize). Mide
 * scrollHeight vs clientHeight del nodo hoja de texto. Tolerancia 1px (sub-pixel rounding de rn-web).
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

test('captura delta #8 %parición: los 5 estados de la card de Parición (ok / fuera-ventana / sin-meses / 12m / leyenda)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  // ── 01 — status 'ok': muestra el %parición + el detalle "N paridas / M servidas" (D1/D2, sin leyenda). ──
  await gotoParicion(page, 'paricion-ok');
  // 38 paridas / 46 servidas = 82,6 % (coma decimal es-AR).
  await expect(page.getByText('82,6 %', { exact: true })).toBeVisible();
  await expect(page.getByText('38 paridas / 46 servidas', { exact: false })).toBeVisible();
  // Sin leyenda D4 (pendingPregnant=0).
  await expect(page.getByText(/Todavía hay vacas que no parieron/)).toHaveCount(0);
  await assertTextNotClipped(page, 'Parición');
  await shot(page, '01-ok-con-porcentaje');

  // ── 02 — 'not_calving_season': "Todavía no es época de parición" en lugar de un 0% prematuro (D2). ──
  await gotoParicion(page, 'paricion-fuera-ventana');
  await expect(page.getByText('Todavía no es época de parición', { exact: false })).toBeVisible();
  await assertTextNotClipped(page, 'Parición');
  await assertTextNotClipped(page, 'Todavía no es época de parición');
  await shot(page, '02-not-calving-season');

  // ── 03 — 'no_service_months': "Sin meses de servicio configurados" en lugar de un 0% engañoso (D3). ──
  await gotoParicion(page, 'paricion-sin-meses');
  await expect(page.getByText('Sin meses de servicio configurados', { exact: false })).toBeVisible();
  await assertTextNotClipped(page, 'Parición');
  await assertTextNotClipped(page, 'Sin meses de servicio configurados');
  await shot(page, '03-no-service-months');

  // ── 04 — 'not_applicable_12m': "No aplica (servicio todo el año)" (servicio continuo 12 meses, D5). ──
  await gotoParicion(page, 'paricion-12m');
  await expect(page.getByText('No aplica (servicio todo el año)', { exact: false })).toBeVisible();
  await assertTextNotClipped(page, 'Parición');
  await shot(page, '04-not-applicable-12m');

  // ── 05 — status 'ok' + leyenda D4: quedan preñadas sin parto contado (pendingPregnant>0). ──
  await gotoParicion(page, 'paricion-leyenda');
  // 30 paridas / 46 servidas = 65,2 %.
  await expect(page.getByText('65,2 %', { exact: true })).toBeVisible();
  await expect(page.getByText('30 paridas / 46 servidas', { exact: false })).toBeVisible();
  await expect(
    page.getByText('Todavía hay vacas que no parieron, esto puede afectar el dato', { exact: false }),
  ).toBeVisible();
  await assertTextNotClipped(page, 'Todavía hay vacas que no parieron');
  await shot(page, '05-ok-con-leyenda');
});
