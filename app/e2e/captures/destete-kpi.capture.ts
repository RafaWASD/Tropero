// e2e/captures/destete-kpi.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta #10
// "%DESTETE: RPC nueva rodeo_weaning_kpi" (spec 07, RWK.1–RWK.9). Recorre los CINCO estados de la card de
// Destete y saca CAPTURAS NOMBRADAS de cada uno a `e2e/captures/__shots__/destete-kpi/NN-estado.png` para que
// el leader las vete (design-review) y se las muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del delta vive en
// la suite backend `supabase/tests/reports/run.cjs` (TR.11: los 4 estados + weaned/pending_weaning + mellizos
// + wrap + IDOR) y en la unit pura `app/src/utils/reports-format.test.ts` (weaningCardView); este archivo SOLO
// captura estados.
//
// POR QUÉ EL SPIKE (no seed/login): la card real (`(tabs)/reportes.tsx`) consume la RPC gateada contra el
// remoto y forzar los 5 estados exigiría sembrar rodeos con distintos `service_months` + partos + destetes con
// fechas relativas (caro y frágil). El spike (`app/reportes-spike.tsx`, DEV_WEB_ROUTES → el RootGate NO lo
// rebota a sign-in) expone una VARIANTE `?variant=destete-*` por estado, renderizando la card con datos MOCK a
// través de los MISMOS componentes de producción (weaningCardView + KpiCard + InfoNote) → lo que se vetea acá
// ES lo que se ve en la tab real. La `page` fixture de ./helpers/fixtures aplica el env-shim del bundle web sola.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/destete-kpi.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/destete-kpi/  (gitignoreado — app/.gitignore + ADR-029 §Artefactos).
// NOTA: el capture NO depende de la migración 0118 (usa el spike MOCK), así que se puede correr sin el apply.
//
// Estados capturados (RWK.8.1):
//   01-ok-con-porcentaje   — status 'ok': el %destete + "N destetados / M servidas" (D1, sin leyenda).
//   02-not-weaning-season  — "todavía no empezó el destete" (weaned=0, D3): NO 0% prematuro.
//   03-no-service-months   — "sin meses de servicio configurados" (service_months vacío/NULL, D5): NO 0%.
//   04-not-applicable-12m  — "no aplica (servicio todo el año)" (servicio continuo 12 meses, D5).
//   05-ok-con-leyenda      — status 'ok' + la leyenda D4 "todavía hay crías sin destetar…" (pending>0).
// + ANTI-RECORTE de descendentes (RWK.8.2) sobre "Destete", "todavía no empezó el destete",
//   "sin meses de servicio configurados" (memoria feedback_descender_clipping: p/q/g/j/y).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

// Path RELATIVO a app/ (cwd de Playwright) → resuelve a app/e2e/captures/__shots__/destete-kpi/.
// page.screenshot crea los dirs padre solos.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'destete-kpi');

/**
 * Saca una captura NOMBRADA tras un breve settle de layout (la card no anima, pero el mount del bundle y el
 * layout del ScrollView pueden dejar un frame en vuelo). El llamador asegura un expect(...).toBeVisible() del
 * texto clave ANTES de invocar esto (per ADR-029).
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * Navega a una variante del spike y espera a que la sección "Reproductivo" (el ReportSectionHeader que
 * envuelve la card de Destete) esté visible → el bundle montó y la card está renderizada.
 */
async function gotoDestete(page: Page, variant: string): Promise<void> {
  await page.goto(`/reportes-spike?variant=${variant}`);
  await expect(page.getByText('Reproductivo', { exact: true })).toBeVisible({ timeout: 30_000 });
  // La card de Destete vive en su propio KpiRow full-width → el label "Destete" confirma el render.
  await expect(page.getByText('Destete', { exact: true })).toBeVisible();
}

/**
 * Verifica que NINGÚN <Text> que contenga `frag` se RECORTE en su caja (memoria feedback_descender_clipping:
 * g/j/p/q/y se cortan si el lineHeight no matchea el fontSize). Mide scrollHeight vs clientHeight del nodo hoja
 * de texto. Tolerancia 1px (sub-pixel rounding de rn-web).
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

test('captura delta #10 %destete: los 5 estados de la card de Destete (ok / sin-destete / sin-meses / 12m / leyenda)', async ({
  page,
}) => {
  test.setTimeout(180_000);

  // ── 01 — status 'ok': muestra el %destete + el detalle "N destetados / M servidas" (D1, sin leyenda). ──
  await gotoDestete(page, 'destete-ok');
  // 40 destetados / 46 servidas = 86,96 % → redondea a 87 % (coma decimal es-AR, sin decimal superfluo).
  await expect(page.getByText('87 %', { exact: true })).toBeVisible();
  await expect(page.getByText('40 destetados / 46 servidas', { exact: false })).toBeVisible();
  // Sin leyenda D4 (pendingWeaning=0).
  await expect(page.getByText(/todavía hay crías sin destetar/)).toHaveCount(0);
  await assertTextNotClipped(page, 'Destete');
  await shot(page, '01-ok-con-porcentaje');

  // ── 02 — 'not_weaning_season': "todavía no empezó el destete" en lugar de un 0% prematuro (D3). ──
  await gotoDestete(page, 'destete-sin-destete');
  await expect(page.getByText('todavía no empezó el destete', { exact: false })).toBeVisible();
  await assertTextNotClipped(page, 'Destete');
  await assertTextNotClipped(page, 'todavía no empezó el destete');
  await shot(page, '02-not-weaning-season');

  // ── 03 — 'no_service_months': "sin meses de servicio configurados" en lugar de un 0% engañoso (D5). ──
  await gotoDestete(page, 'destete-sin-meses');
  await expect(page.getByText('sin meses de servicio configurados', { exact: false })).toBeVisible();
  await assertTextNotClipped(page, 'Destete');
  await assertTextNotClipped(page, 'sin meses de servicio configurados');
  await shot(page, '03-no-service-months');

  // ── 04 — 'not_applicable_12m': "no aplica (servicio todo el año)" (servicio continuo 12 meses, D5). ──
  await gotoDestete(page, 'destete-12m');
  await expect(page.getByText('no aplica (servicio todo el año)', { exact: false })).toBeVisible();
  await assertTextNotClipped(page, 'Destete');
  await shot(page, '04-not-applicable-12m');

  // ── 05 — status 'ok' + leyenda D4: quedan crías al pie sin destetar (pendingWeaning>0). ──
  await gotoDestete(page, 'destete-leyenda');
  // 28 destetados / 46 servidas = 60,87 % → 60,9 %.
  await expect(page.getByText('60,9 %', { exact: true })).toBeVisible();
  await expect(page.getByText('28 destetados / 46 servidas', { exact: false })).toBeVisible();
  await expect(
    page.getByText('todavía hay crías sin destetar, esto puede afectar el dato', { exact: false }),
  ).toBeVisible();
  await assertTextNotClipped(page, 'todavía hay crías sin destetar');
  await shot(page, '05-ok-con-leyenda');
});
