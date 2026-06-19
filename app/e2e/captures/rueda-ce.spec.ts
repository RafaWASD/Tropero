// e2e/captures/rueda-ce.spec.ts — CAPTURAS del DESIGN SPIKE de la RUEDA de CIRCUNFERENCIA ESCROTAL
// (spec 03 M6-C.0) para el veto del leader (design-review) ANTES de mostrárselo a Raf.
//
// ⚠️ NO es un test de la Fase 6 (E2E formal): son capturas para el veto 🔴 manga en WEB TÁCTIL REAL
// (memoria reference_rn_web_pitfalls: el mouse sintético de Desktop ENMASCARA el touch → un context con
// `hasTouch:true` + `isMobile:true` y se interactúa con `touchscreen.tap()` / drags táctiles). La pantalla
// es 100% MOCK (sin servicios/BLE/PowerSync/auth): se alcanza DIRECTO por URL en web porque está en
// DEV_WEB_ROUTES (app/_layout.tsx) → el RootGate NO la rebota a sign-in. Por eso NO necesita seed/cleanup.
//
// Capturas (a 360 y 412 px, viewport mobile, hasTouch):
//   1) REPOSO: campo editable "36,5 cm" (hero primario, bordeado + ícono de teclado) + rueda con GRADIENTE
//      de tamaño (centro enfatizado vs vecinos chicos/atenuados) + edad secundaria + confirm gigante.
//   2) INPUT ENFOCADO: el campo editable activo (borde $primary) con el teclado del dispositivo abierto —
//      muestra que tocar el campo abre el teclado para tipear los cm a mano (fix-loop v2).
//   3) MID-FLING: tras un drag táctil de la rueda asentado en un ".5" — el campo refleja el nuevo valor
//      (muestra la rueda inercial + la sincronía rueda→campo + que el ".5" no se recorta).
//   4) SHEET de edad abierto (rueda de meses, mismo idiom) — el control secundario de edad.
// + MIDE la densidad (R12.5): el % del alto útil que ocupan la card de la rueda + el confirm.
//
// Salida: tests/modo-maniobra/  (rueda-ce-reposo-<w>.png, rueda-ce-input-<w>.png, rueda-ce-fling-<w>.png,
//         rueda-ce-edad-<w>.png).
//
// Para correrla:  cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/rueda-ce.spec.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'modo-maniobra');
const WIDTHS = [360, 412] as const;

/** Espera a que el bundle monte y la pantalla del spike esté visible (post-splash), por un ancla. */
async function gotoSpike(page: Page, route: string, anchor: string): Promise<void> {
  await page.goto(route);
  await expect(page.getByText(anchor, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Mide la fracción del ALTO ÚTIL (viewport - header de identidad $surface) que ocupan los controles de
 * acción border-to-border (R12.5). Mide los <div>s reales de `confirm-step` + la card de la rueda (la
 * card es el contenedor $surface con flex:1; tomamos el rango [min(top de la card+confirm), max(bottom)]).
 * Espejo de measureDensity de maniobra-spike.spec.ts, pero acá la "zona de acción" la marca el testID del
 * confirm + el de la rueda.
 */
async function measureDensity(page: Page): Promise<{ pct: number; usable: number; actionHeight: number }> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('viewport no disponible');
  const SURFACE_RGB = 'rgb(248, 246, 241)'; // $surface = #F8F6F1 (fondo del header de identidad)

  const res = await page.evaluate(
    ({ surfaceRgb }) => {
      const norm = (c: string) => c.replace(/\s+/g, '');
      let actionTop = Infinity;
      let actionBottom = -Infinity;
      // La rueda (ce-wheel) y el confirm (confirm-step) marcan el rango de acción.
      for (const id of ['ce-wheel', 'ce-display', 'confirm-step', 'age-control']) {
        for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.height < 8) continue;
          actionTop = Math.min(actionTop, r.top);
          actionBottom = Math.max(actionBottom, r.bottom);
        }
      }
      // Header de identidad: el bloque $surface más alto en la franja superior (top < 120).
      let headerBottom = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const e = el as HTMLElement;
        const r = e.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        if (norm(getComputedStyle(e).backgroundColor) === norm(surfaceRgb) && r.top < 120) {
          headerBottom = Math.max(headerBottom, r.bottom);
        }
      }
      return { actionTop, actionBottom, headerBottom };
    },
    { surfaceRgb: SURFACE_RGB },
  );

  if (!Number.isFinite(res.actionTop) || !Number.isFinite(res.actionBottom)) {
    throw new Error('no se ubicaron los controles de la rueda/confirm');
  }
  const headerBottom = res.headerBottom > 0 ? res.headerBottom : 51;
  const usable = viewport.height - headerBottom;
  const actionHeight = res.actionBottom - res.actionTop;
  return { pct: (actionHeight / usable) * 100, usable, actionHeight };
}

for (const width of WIDTHS) {
  test(`capturas spike rueda CE (web táctil) @ ${width}px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    // El context propio (browser.newContext) NO hereda el auto-shim de la fixture `page` → lo aplicamos
    // a mano ANTES del goto (si no, el bundle web de producción crashea por las EXPO_PUBLIC_* faltantes).
    await applyEnvShim(page);

    try {
      await gotoSpike(page, '/maniobra/rueda-ce', 'Confirmar');

      // Anclas de la pantalla en reposo: identidad, línea de maniobra, campo editable, edad, confirm.
      await expect(page.getByText('ARG 0512', { exact: true })).toBeVisible();
      await expect(page.getByText('Circunferencia escrotal', { exact: true }).first()).toBeVisible();
      // El CAMPO editable "36 cm" (hero primario, input bordeado). El valor vive en el <input> (testID ce-input).
      await expect(page.getByTestId('ce-display')).toBeVisible();
      await expect(page.getByTestId('ce-input')).toHaveValue('36');
      await expect(page.getByText('cm', { exact: true }).first()).toBeVisible();
      // Edad secundaria prellenada "≈ 24 meses".
      await expect(page.getByText('≈ 24 meses', { exact: true })).toBeVisible();
      await expect(page.getByText('Confirmar', { exact: true })).toBeVisible();

      // (1) REPOSO (campo editable + rueda con gradiente de tamaño + edad + confirm).
      await page.screenshot({ path: path.join(SHOT_DIR, `rueda-ce-reposo-${width}.png`) });

      // (2) INPUT ENFOCADO + teclado abierto: tap en el campo → foco (borde $primary) + teclado del
      // dispositivo. Tipeamos "38,5" CARACTER A CARACTER (pressSequentially: un keystroke por vez, así el
      // input CONTROLADO de react-native-web procesa cada onChangeText sin dropear chars — fill() los
      // pierde con inputs controlados). El input enfocado + el valor tipeado muestran la affordance de
      // edición manual (en web el teclado nativo del SO no se renderiza en el screenshot, pero el inputmode
      // decimal está activo: el <input> es `inputmode="decimal"`).
      const ceInput = page.getByTestId('ce-input');
      await ceInput.tap();
      await expect(ceInput).toBeFocused();
      // selectTextOnFocus seleccionó el seed "36" → Backspace lo limpia antes de tipear el valor nuevo.
      await page.keyboard.press('Backspace');
      await ceInput.pressSequentially('38,5', { delay: 40 });
      await expect(ceInput).toHaveValue('38,5');
      await page.screenshot({ path: path.join(SHOT_DIR, `rueda-ce-input-${width}.png`) });
      // Blur → commit: la rueda se snapea a 38,5 y el campo vuelve al display canónico (sincronía campo→rueda).
      await page.getByText('Circunferencia escrotal', { exact: true }).first().tap();
      await page.waitForTimeout(500);
      await expect(ceInput).toHaveValue('38,5');

      // Densidad (R12.5): la card de la rueda + el confirts se reparten ≥60% del alto útil.
      const d = await measureDensity(page);
      // eslint-disable-next-line no-console
      console.log(
        `[densidad rueda-ce @${width}] usable=${Math.round(d.usable)} accion=${Math.round(d.actionHeight)} → ${d.pct.toFixed(1)}% del alto útil`,
      );
      expect(d.pct).toBeGreaterThanOrEqual(60);

      // (3) MID-FLING: movemos la rueda hacia abajo en valores (scroll del drum) y capturamos asentado en
      // un ".5" (probar que NO se recorta). En react-native-web la ScrollView es un div con overflow-y
      // dentro del contenedor testID. Lo localizamos y lo scrolleamos (equivalente al asentamiento de un
      // fling táctil) — el snapToInterval CSS + el onScroll del componente actualizan el campo editable.
      const moved = await page.evaluate(() => {
        const host = document.querySelector('[data-testid="ce-wheel"]');
        if (!host) return null;
        // El scroller es el descendiente con overflow scrollable y scrollHeight > clientHeight.
        const candidates = Array.from(host.querySelectorAll('div')) as HTMLElement[];
        const scroller = candidates.find((d) => {
          const s = getComputedStyle(d);
          return /(auto|scroll)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 4;
        });
        if (!scroller) return null;
        // +6 celdas (64px c/u) → desde 38,5 (tipeado arriba) sube 3 cm a 41,5. Cae justo en una celda (snap
        // exacto) y es un ".5" → la captura prueba que ningún ".5" se recorta ni lo cruzan las líneas.
        scroller.scrollTop = scroller.scrollTop + 64 * 6;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        return scroller.scrollTop;
      });
      await page.waitForTimeout(700); // deja asentar el snap + el re-render del campo editable
      // eslint-disable-next-line no-console
      console.log(`[fling rueda-ce @${width}] scrollTop=${moved}`);
      // El campo editable refleja el nuevo valor centrado (sincronía rueda→campo), asentado en un ".5".
      await expect(page.getByTestId('ce-input')).toHaveValue('41,5');
      // (3) FLING ASENTADO en un ".5" (el campo refleja el nuevo valor; la rueda fue arrastrada).
      await page.screenshot({ path: path.join(SHOT_DIR, `rueda-ce-fling-${width}.png`) });

      // (4) SHEET de edad: tap en el control de edad → rueda de meses.
      await page.getByTestId('age-control').tap();
      await expect(page.getByText('Edad del toro', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('age-wheel')).toBeVisible();
      await expect(page.getByText('Usar esta edad', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `rueda-ce-edad-${width}.png`) });
    } finally {
      await ctx.close();
    }
  });
}
