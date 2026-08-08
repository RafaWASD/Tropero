// e2e/captures/campanas-congeladas.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta
// "CAMPAÑAS CONGELADAS: los reportes cerrados son una foto" (spec 07, RCC.14.1/14.2). Recorre los NUEVE
// estados de la barra de campaña + las dos hojas de confirmación y saca CAPTURAS NOMBRADAS a
// `e2e/captures/__shots__/campanas-congeladas/NN-estado.png` para que el leader las vete (design-review) y
// se las muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del delta vive
// en la suite backend `supabase/tests/reports/run.cjs` (TR.12–TR.21) y en la unit pura
// `app/src/utils/reports-format.test.ts` (`campaignStateView`); este archivo SOLO captura estados.
//
// POR QUÉ EL SPIKE (no seed/login): la barra real (`(tabs)/reportes.tsx`) consume `rodeo_campaign_status`
// contra el remoto, y forzar los 9 estados exigiría sembrar campañas cerradas/reabiertas/a-medias con
// fechas relativas (caro, frágil, y encima las migraciones 0127-0130 todavía NO están aplicadas). El spike
// (`app/reportes-spike.tsx`, DEV_WEB_ROUTES → el RootGate no lo rebota a sign-in) expone una VARIANTE
// `?variant=campana-*` por estado, renderizando con datos MOCK a través de los MISMOS componentes de
// producción (`campaignStateView` + `CampaignStateBar` + `CampaignCloseSheet`) → lo que se vetea acá ES lo
// que se ve en la tab real.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/campanas-congeladas.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/campanas-congeladas/ (gitignoreado — app/.gitignore + ADR-029).
// NOTA: el capture NO depende de las migraciones 0127-0130 (usa el spike MOCK) → corre antes del apply.
//
// Estados capturados (design §10):
//   01-campana-en-curso            — el número es VIVO: "Campaña en curso" + "Cerrar campaña".
//   02-campana-sugerencia-cierre   — D1: el ciclo terminó → la app SUGIERE cerrar.
//   03-campana-confirmacion-cierre — RCC.10.7.b: ciclo completo → UN TOQUE, sin fricción extra.
//   04-campana-confirmacion-incompleta — F8/RCC.10.7.a: la lista de lo que falta + la SEGUNDA acción.
//   05-campana-cerrada             — "Campaña cerrada" + "Foto del dd/mm/aaaa" (RCC.10.1).
//   06-campana-cerrada-a-medias    — F8: el badge + qué faltaba al cerrar (RCC.10.11).
//   07-campana-datos-nuevos        — DL10: llegó un dato de la campaña después de la foto.
//   08-campana-cierre-masivo       — RCC.10.6: el resultado por rodeo (cerrados / incompletos).
//   09-campana-sin-permiso         — RCC.10.8: sin botones, pero el aviso de "a medias" SÍ se ve.
//   10-campana-desconocida         — H-1: el estado EN VUELO. No afirma ni "en curso" ni "cerrada".
// + ANTI-RECORTE de descendentes (RCC.14.2) sobre "Campaña cerrada", "Campaña cerrada a medias",
//   "Cerrar campaña", "Reabrir campaña", "Cerrar igual con estos datos incompletos" y "Hay datos nuevos sin
//   reflejar en la foto" (memoria feedback_descender_clipping: p/q/g/j/y).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'campanas-congeladas');

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Navega a una variante del spike y espera a que la BARRA DE CAMPAÑA esté montada. */
async function gotoCampana(page: Page, variant: string): Promise<void> {
  await page.goto(`/reportes-spike?variant=${variant}`);
  await expect(page.getByTestId('campaign-state-bar')).toBeVisible({ timeout: 30_000 });
}

/**
 * Contraste WCAG del texto de un elemento contra su fondo EFECTIVO (subiendo por los ancestros hasta el
 * primer background no transparente). Devuelve el número medido; el caller asserta el umbral. La regla del
 * repo es AA (4.5:1 para texto normal, 3:1 para ≥18,66px/bold) y ya hubo un caso de `$textFaint` a 13 px
 * dando 3,92:1 — por eso esto se MIDE en el capture en vez de confiar en el token.
 */
async function contrastOf(page: Page, testId: string): Promise<{ fg: string; bg: string; ratio: number; px: number }> {
  return page.evaluate((id) => {
    const rgb = (s: string): [number, number, number] => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return [255, 255, 255];
      const p = m[1].split(',').map((x) => parseFloat(x));
      return [p[0], p[1], p[2]];
    };
    const lum = (c: [number, number, number]) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el) return { fg: 'n/a', bg: 'n/a', ratio: 0, px: 0 };
    const cs = getComputedStyle(el);
    let node: HTMLElement | null = el;
    let bg = 'rgba(0, 0, 0, 0)';
    while (node) {
      const b = getComputedStyle(node).backgroundColor;
      if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; }
      node = node.parentElement;
    }
    const l1 = lum(rgb(cs.color));
    const l2 = lum(rgb(bg));
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return { fg: cs.color, bg, ratio: (hi + 0.05) / (lo + 0.05), px: parseFloat(cs.fontSize) };
  }, testId);
}

/** Alto real del área tappable de un control (Fitts / target mínimo). */
async function tapHeight(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  return box ? box.height : 0;
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

test('captura delta campañas congeladas: los 9 estados de la campaña (en curso / cerrada / a medias / datos nuevos / confirmaciones)', async ({
  page,
}) => {
  test.setTimeout(240_000);

  // ── 01 — EN CURSO: el número es vivo y se dice explícitamente (RCC.10.2). ──
  await gotoCampana(page, 'campana-en-curso');
  await expect(page.getByText('Campaña en curso', { exact: true })).toBeVisible();
  await expect(page.getByText('Los números se actualizan con cada dato nuevo')).toBeVisible();
  await expect(page.getByTestId('campaign-close-btn')).toBeVisible();
  // el hint de la sección repite el estado para que siga visible al scrollear.
  await expect(page.getByText(/Campaña 2025 · en curso · base servidas/)).toBeVisible();
  await assertTextNotClipped(page, 'Campaña en curso');
  await assertTextNotClipped(page, 'Cerrar campaña');
  await shot(page, '01-campana-en-curso');

  // ── 02 — SUGERENCIA (D1): el ciclo se completó → la app avisa. ──
  await gotoCampana(page, 'campana-sugerencia');
  await expect(page.getByText('El ciclo de esta campaña está completo. ¿La cerrás?')).toBeVisible();
  await expect(page.getByTestId('campaign-close-btn')).toBeVisible();
  await assertTextNotClipped(page, 'El ciclo de esta campaña está completo');
  await shot(page, '02-campana-sugerencia-cierre');

  // ── 03 — CONFIRMACIÓN con el ciclo COMPLETO (RCC.10.7.b): un solo toque, sin fricción extra. ──
  await page.goto('/reportes-spike?variant=campana-confirmacion');
  await expect(page.getByTestId('campaign-confirm-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Vas a cerrar la campaña 2025 de Servicio Invierno.')).toBeVisible();
  await expect(page.getByText(/Podés reabrirla mientras no cierres la campaña 2026/)).toBeVisible();
  await expect(page.getByTestId('campaign-confirm-primary')).toBeVisible();
  // con el ciclo completo NO aparece ni la lista de faltantes ni la segunda acción.
  await expect(page.getByTestId('campaign-confirm-missing')).toHaveCount(0);
  await expect(page.getByTestId('campaign-confirm-ack')).toHaveCount(0);
  await assertTextNotClipped(page, 'Cerrar campaña');
  await shot(page, '03-campana-confirmacion-cierre');

  // ── 04 — CONFIRMACIÓN REFORZADA (F8/RCC.10.7.a): enumera qué falta + segunda acción separada. ──
  await page.goto('/reportes-spike?variant=campana-confirmacion-incompleta');
  await expect(page.getByTestId('campaign-confirm-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('El ciclo de esta campaña no terminó')).toBeVisible();
  await expect(page.getByText('2 preñadas sin parir', { exact: true })).toBeVisible();
  await expect(page.getByText('5 crías sin destetar', { exact: true })).toBeVisible();
  await expect(page.getByTestId('campaign-confirm-ack')).toBeVisible();
  // Gate 2.5: tras el rechazo del server, el intento SIN reconocimiento —el que está garantizado que vuelve
  // a fallar— NO se ofrece, y no queda ningún control con peso de primario compitiendo con él.
  await expect(page.getByTestId('campaign-confirm-primary')).toHaveCount(0);
  await assertTextNotClipped(page, 'Cerrar igual con estos datos incompletos');
  await assertTextNotClipped(page, 'El ciclo de esta campaña no terminó');
  await shot(page, '04-campana-confirmacion-incompleta');

  // ── 05 — CERRADA: es una FOTO, con su fecha en es-AR (RCC.10.1). ──
  await gotoCampana(page, 'campana-cerrada');
  await expect(page.getByText('Campaña cerrada', { exact: true })).toBeVisible();
  await expect(page.getByText('Foto del 14/03/2026 · la cerró Facundo')).toBeVisible();
  await expect(page.getByTestId('campaign-reopen-btn')).toBeVisible();
  await expect(page.getByText(/Campaña 2025 · foto · base servidas/)).toBeVisible();
  // Gate 2.5: reabrir es raro y semi-destructivo → BAJA jerarquía. No puede ser el elemento interactivo más
  // grande de la tarjeta, pero sí tiene que seguir siendo alcanzable (target ≥ 44 dp con el hitSlop).
  const reopenH = await tapHeight(page, 'campaign-reopen-btn');
  const barBox = await page.getByTestId('campaign-state-bar').boundingBox();
  expect(reopenH, `alto del target de reabrir: ${reopenH}`).toBeGreaterThanOrEqual(40);
  expect(reopenH).toBeLessThan((barBox?.height ?? 0) / 2);
  // Contraste medido del detalle ("Foto del …"): tiene que ser AA, y en un tono NEUTRO — el detalle de una
  // campaña cerrada no es un estado de alerta.
  const cDetail = await contrastOf(page, 'campaign-state-detail');
  // eslint-disable-next-line no-console
  console.log(`[contraste] detalle ${cDetail.fg} sobre ${cDetail.bg} @${cDetail.px}px = ${cDetail.ratio.toFixed(2)}:1`);
  expect(cDetail.ratio, `contraste del detalle: ${cDetail.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  await assertTextNotClipped(page, 'Campaña cerrada');
  await assertTextNotClipped(page, 'Reabrir campaña');
  await assertTextNotClipped(page, 'Foto del 14/03/2026');
  await shot(page, '05-campana-cerrada');

  // ── 06 — CERRADA A MEDIAS (F8/RCC.10.11): lo dice, y dice QUÉ faltaba al cerrar. ──
  await gotoCampana(page, 'campana-cerrada-a-medias');
  await expect(page.getByText('Campaña cerrada a medias', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Se cerró con 2 preñadas sin parir · 5 crías sin destetar. Los números no incluyen eso.'),
  ).toBeVisible();
  await assertTextNotClipped(page, 'Campaña cerrada a medias');
  await assertTextNotClipped(page, 'Se cerró con 2 preñadas sin parir');
  for (const id of ['campaign-state-title', 'campaign-state-detail', 'campaign-state-notice']) {
    const c = await contrastOf(page, id);
    // eslint-disable-next-line no-console
    console.log(`[contraste] ${id} ${c.fg} sobre ${c.bg} @${c.px}px = ${c.ratio.toFixed(2)}:1`);
    expect(c.ratio, `${id}: ${c.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
  await shot(page, '06-campana-cerrada-a-medias');

  // ── 07 — DATOS NUEVOS (DL10): llegó un dato de la campaña después de la foto. ──
  await gotoCampana(page, 'campana-datos-nuevos');
  await expect(
    page.getByText('Hay datos nuevos sin reflejar en la foto. Reabrí la campaña para incorporarlos.'),
  ).toBeVisible();
  await expect(page.getByTestId('campaign-reopen-btn')).toBeVisible();
  await assertTextNotClipped(page, 'Hay datos nuevos sin reflejar en la foto');
  await shot(page, '07-campana-datos-nuevos');

  // ── 08 — CIERRE MASIVO (RCC.10.6): el resultado POR RODEO, con la falla parcial visible. ──
  await page.goto('/reportes-spike?variant=campana-cierre-masivo');
  await expect(page.getByTestId('campaign-confirm-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('campaign-bulk-result')).toBeVisible();
  await expect(page.getByText('Se cerraron 3 rodeos')).toBeVisible();
  await expect(page.getByText('Vaquillonas: 3 crías sin destetar')).toBeVisible();
  // Ya corrió la primera pasada (3 cerrados, 1 rechazado por ciclo incompleto): lo que se ofrece ahora es
  // la SEGUNDA pasada acotada a ese rodeo (RCC.5.10.a), no volver a intentar los 4.
  await expect(page.getByTestId('campaign-confirm-bulk')).toHaveCount(0);
  await expect(page.getByTestId('campaign-confirm-bulk-ack')).toBeVisible();
  await assertTextNotClipped(page, 'Cerrar igual el rodeo incompleto');
  await shot(page, '08-campana-cierre-masivo');

  // ── 10 — TODAVÍA NO SE SABE: el estado que la barra tiene mientras `rodeo_campaign_status` está en vuelo
  // (primera carga) o cuando falló. NO dice "en curso" ni "cerrada", no pone fecha y no ofrece acciones: el
  // título no puede calificar unos números que todavía no sabe si son una foto (H-1 del reviewer). El hint
  // de la sección se calla por el mismo motivo. ──
  await gotoCampana(page, 'campana-desconocida');
  await expect(page.getByTestId('campaign-state-title')).toHaveText('Campaña');
  await expect(page.getByText('Campaña en curso', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Campaña cerrada', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('campaign-state-detail')).toHaveCount(0);
  await expect(page.getByTestId('campaign-close-btn')).toHaveCount(0);
  await expect(page.getByTestId('campaign-reopen-btn')).toHaveCount(0);
  await expect(page.getByText(/Campaña 2025 · base servidas/)).toBeVisible();
  await assertTextNotClipped(page, 'Campaña');
  await shot(page, '10-campana-desconocida');

  // ── 09 — SIN PERMISO (RCC.10.8): sin acciones, pero el aviso de "a medias" SÍ se ve (RCC.10.11). ──
  await gotoCampana(page, 'campana-sin-permiso');
  await expect(page.getByText('Campaña cerrada a medias', { exact: true })).toBeVisible();
  await expect(page.getByText('Se cerró con 5 crías sin destetar. Los números no incluyen eso.')).toBeVisible();
  await expect(page.getByTestId('campaign-reopen-btn')).toHaveCount(0);
  await expect(page.getByTestId('campaign-close-btn')).toHaveCount(0);
  await shot(page, '09-campana-sin-permiso');
});
