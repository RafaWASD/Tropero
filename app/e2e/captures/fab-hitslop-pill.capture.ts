// e2e/captures/fab-hitslop-pill.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// de la unidad «el FAB de Maniobra le roba los taps a la banda de arriba del nav» (bugfix 🔴).
//
// Qué cambió, y por lo tanto qué hay que poder vetar mirando:
//   1. El `hitSlop.top` del FAB SE SACÓ. **Invisible en una captura** (un target no se pinta) → lo verifica
//      `e2e/fab-target-geometry.spec.ts` midiendo cajas, y `src/utils/nav-target-bands.test.ts` desde los
//      tokens. Acá se documenta la consecuencia que SÍ se ve: el aire entre el pill y el pico del FAB.
//   2. El pill subió: de ~10 dp de aire al círculo a ~20. Sigue midiendo lo que mide su contenido (~33 dp)
//      y sigue siendo INFORMATIVO — el intento de volverlo tocable se revirtió (ver el shot 06).
//   3. El título de la sección de "Más" pasó de "Bastón" a "Dispositivos".
//
// Shots a __shots__/fab-hitslop-pill/:
//   01 — el pill VIVO sobre el tab "Más" (pantalla completa): la banda inferior entera, para ver el aire
//        contra el pico del FAB y que el pill no pise el nav ni el contenido.
//   02 — BANDA ampliada pill + FAB + bottom-nav (el veto de la separación, que es el corazón del fix).
//   04 — la sección "Dispositivos" del tab "Más" (pantalla completa): la UBICACIÓN + el título nuevo.
//   05 — BANDA de la sección "Dispositivos" + su fila (el veto del rótulo).
//   06 — el tab **Inicio**: el indicador YA NO está sobre "Ir a Animales". Hasta el 2026-08-06 este shot
//        era la evidencia de la superposición (por qué el pill no podía ser tocable); desde que el
//        indicador se mudó arriba a la derecha, documenta lo contrario — y la aserción se dio vuelta, así
//        que si vuelve a caer sobre el CTA la captura se pone roja.
//
// ⚠️ LÍMITE DECLARADO: en web `hitSlop` es NO-OP (react-native-web 0.21.2 no lo implementa en `Pressable`),
// así que NINGUNA captura puede mostrar el bug ni su ausencia. Lo que estas capturas vetan es el DISEÑO
// resultante (aire, superposición, rótulo); la corrección del target la prueban los guards.
//
// ⚠️ NO hay shot de estado de PRESS: el pill no es tocable. En la versión previa de esta unidad SÍ lo
// había, y sirvió — falsificó el `pressStyle` copiado del `ActionRow` (reposo y press salían de 16.079 y
// 16.070 bytes, indistinguibles, porque `$bg` sobre `$surface` son 2 puntos de luminancia). El estado de
// press hay que capturarlo, no suponerlo; queda anotado para el próximo que agregue una afordancia.
//
// Viewport mobile 412×915, contexto propio con `hasTouch`. NO corre en `pnpm e2e` (es un `.capture.ts`);
// lo dispara el leader:
//   pnpm exec playwright test e2e/captures/fab-hitslop-pill.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect } from '../helpers/fixtures';
import type { Page, Locator } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoTab } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** a11y de la fila "Bastón" del tab "Más" (el estado va DENTRO del nombre accesible). */
const STICK_ROW_NAME = /^Bastón: .+ Abrí la pantalla de conexión del bastón$/;

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'fab-hitslop-pill');

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Banda vertical de ancho completo entre dos elementos (componente puntual, no la pantalla entera). */
async function shotBand(page: Page, name: string, topLoc: Locator, bottomLoc: Locator, pad = 16): Promise<void> {
  await page.waitForTimeout(200);
  const top = await topLoc.boundingBox();
  const bottom = await bottomLoc.boundingBox();
  if (!top || !bottom) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
    return;
  }
  const y = Math.max(0, top.y - pad);
  const height = Math.min(915 - y, bottom.y + bottom.height + pad - y);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), clip: { x: 0, y, width: 412, height } });
}

/** Las DOS marcas del bastón (E2E + DEMO) ANTES del bundle → simulador → el pill puede estar vivo. */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__RAFAQ_BLE_DEMO__ = true;
  });
}

test('capturas del aire pill↔FAB + la sección "Dispositivos" @ 412×915', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    const user = await createTestUser('cap-fabpill');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo FAB Pill');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // (04) El tab "Más" con la sección renombrada. Pantalla COMPLETA: lo que se veta es el RÓTULO nuevo
    // y que la sección siga donde estaba (después de Perfil, antes de "Campo activo").
    const stickRow = page.getByRole('button', { name: STICK_ROW_NAME });
    await gotoTab(page, 'Más', stickRow);
    await expect(page.getByText('Dispositivos', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Sin conectar', { exact: true })).toBeVisible();
    await shot(page, '04-mas-seccion-dispositivos');

    // (05) La banda título + fila: el título ya no repite el nombre de su única fila.
    await shotBand(page, '05-banda-seccion-dispositivos', page.getByText('Dispositivos', { exact: true }), stickRow);

    // Dejar la conexión VIVA (por la fila → /baston → lectura simulada → chevron de vuelta). Es la ruta
    // del operario; un `page.goto` remontaría el provider raíz y apagaría la conexión.
    await stickRow.click();
    await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('demo-simulate')).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await page.getByTestId('demo-simulate').click();
      await expect(page.getByLabel(/^Caravana \d{15} DEMO$/).first()).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(stickRow).toBeVisible({ timeout: 20_000 });

    const pill = page.getByTestId('stick-status-pill');
    await expect(pill).toBeVisible({ timeout: 15_000 });

    // (01) El pill vivo sobre "Más", pantalla completa.
    await shot(page, '01-pill-vivo-sobre-mas');

    // (02) LA BANDA DEL FIX: pill + aire + FAB + bottom-nav. Es la captura que hay que mirar de cerca —
    // el aire pill↔círculo pasó de ~10 dp a ~20. Se recorta desde arriba del pill hasta el borde inferior.
    const box = await pill.boundingBox();
    if (!box) throw new Error('el pill no tiene caja');
    const y = Math.max(0, box.y - 24);
    await page.screenshot({
      path: path.join(SHOT_DIR, '02-banda-pill-vs-fab.png'),
      clip: { x: 0, y, width: 412, height: 915 - y },
    });

    // (06) LA EVIDENCIA DE POR QUÉ EL PILL NO PUEDE SER TOCABLE. Sobre el tab Inicio el pill se superpone
    // al CTA "Ir a Animales". Con `pointerEvents="none"` el toque lo ATRAVIESA y llega al CTA, que es lo
    // correcto; con el `onPress` que se probó y se revirtió, ese mismo toque se lo llevaba `/baston`. Se
    // asierta primero la superposición: si un día el layout cambia y dejan de solaparse, esta captura
    // dejaría de documentar lo que dice documentar.
    await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
    await expect(pill).toBeVisible({ timeout: 20_000 });
    // ⚠️ RECONCILIADO 2026-08-06 (unidad «el indicador sale de la banda de los CTA»): el indicador SE MUDÓ
    // arriba a la derecha, así que ya NO se superpone a "Ir a Animales". Este shot documentaba la
    // superposición (la evidencia de por qué no podía ser tocable); ahora documenta su AUSENCIA, que es el
    // arreglo. La aserción se da vuelta en vez de borrarse: si algún día el indicador vuelve a caer sobre
    // un CTA, esta captura se pone roja en lugar de sacar una foto que nadie mira.
    const overlap = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="stick-status-pill"]')?.getBoundingClientRect();
      const cta = [...document.querySelectorAll('[role="button"],button,a[href]')].find((e) =>
        (e.getAttribute('aria-label') ?? e.textContent ?? '').includes('Ir a Animales'),
      );
      if (!p || !cta) return null;
      const c = cta.getBoundingClientRect();
      return p.left < c.right && p.right > c.left && p.top < c.bottom && p.bottom > c.top;
    });
    expect(
      overlap,
      'el indicador volvió a superponerse a "Ir a Animales": es la banda de la que lo sacamos (el CTA a ' +
        'ancho completo la cruza por diseño). Ver `progress/impl_pill-arriba-derecha.md`.',
    ).toBe(false);
    await shot(page, '06-el-indicador-ya-no-pisa-el-cta-de-inicio');
  } finally {
    await ctx.close();
  }
});
