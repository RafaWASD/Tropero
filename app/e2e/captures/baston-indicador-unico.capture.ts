// e2e/captures/baston-indicador-unico.capture.ts — CAPTURAS para el veto visual del leader
// (Gate 2.5, ADR-029) de la unidad «el indicador del bastón sale de la banda de los CTA».
//
// Qué cambió, y por lo tanto qué hay que poder vetar mirando:
//   1. **EL INDICADOR SE MUDÓ**: del borde inferior (donde cruzaba los CTA a ancho completo) a ARRIBA A
//      LA DERECHA, DEBAJO de la fila del header. Y cambió de forma: es un **círculo** con el ícono solo,
//      permanente, que **se estira a pill** con el texto cuando el estado CAMBIA y vuelve solo.
//   2. En las pantallas que ya muestran el estado (chip del header de "Animales", card de `/baston`) o que
//      ya usan esa banda (vista de grupo, header de identidad de la manga, Reportes), **no aparece**.
//   3. El estado lo lleva el **ícono** (bluetooth / conectado / buscando / alerta) y el color lo refuerza:
//      NO se distingue solo por color (WCAG 1.4.1 — y ~8 % de los varones no distingue rojo-verde).
//
// Shots a __shots__/baston-indicador-unico/:
//   01 — "Más", **PILL EXPANDIDA** (el aviso, recién llegado de la pantalla de conexión).
//   02 — "Más", **CÍRCULO** (el reposo, a los 5 s). 01 vs 02 es el veto de las DOS formas.
//   03 — banda AMPLIADA del círculo sobre el header de "Más": el aire contra la fila de arriba.
//   04 — "Inicio", **PILL EXPANDIDA**: el caso que importa (la fila del header está LLENA — switch,
//        wordmark y avatar) y el indicador queda DEBAJO, sin tocarlos.
//   05 — "Inicio", **CÍRCULO** al lado del saludo.
//   06 — alta (`crear-animal`), **CÍRCULO**: la pantalla con el contenido MÁS pegado arriba de las que el
//        indicador visita (el "Paso N de 4" + su barra de puntos arranca apenas debajo del título). Sirve
//        para vetar el caso apretado: MEDIDO, el círculo queda por DEBAJO de los puntos y no los toca — la
//        fila del header de esta pantalla es más baja que la de la home, así que el anclaje (que despeja la
//        más alta) sobra acá.
//   07 — "Animales": el chip del header manda y el chrome se calla (la supresión, sin nada en la esquina).
//   08 — RECORTE AMPLIADO del único roce que queda: en "Más", el borde de abajo del círculo y el borde
//        de arriba de la card de "Perfil" se tocan por ~2 px. No tapa nada legible; se captura para que
//        el veto sea sobre los píxeles.
//
// ⚠️ La ausencia de un elemento no se ve en una captura suelta: 07 se lee CONTRA 01/02.
// ⚠️ El estirado es una animación de 220 ms; las capturas son estados, no el recorrido.
//
// Viewport mobile 412×915, contexto propio con `hasTouch`. NO corre en `pnpm e2e` (es un `.capture.ts`):
//   pnpm exec playwright test e2e/captures/baston-indicador-unico.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoTab } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-indicador-unico');
const STICK_ROW_NAME = /^Bastón: .+ Abrí la pantalla de conexión del bastón$/;
/** Lo que dura el aviso antes de volver al círculo (`MORPH_EXPANDED_MS`) + aire. */
const COLLAPSE_WAIT_MS = 5_000;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Caja del indicador (para asertar la FORMA antes de sacar la foto: círculo ⇔ ancho == alto). */
async function indicatorBox(page: Page) {
  const box = await page.getByTestId('stick-status-pill').boundingBox();
  if (!box) throw new Error('el indicador no tiene caja');
  return box;
}

/**
 * Espera a que el estirado TERMINE y devuelve la caja.
 *
 * El oráculo no es "es más ancho que alto" —eso ya es cierto a los 60 ms de una animación de 220— sino
 * **que no quede contenido recortado**: `scrollWidth <= clientWidth`. Es exactamente lo que hay que poder
 * vetar en la foto (la primera versión de esta captura salió con "Conectado" cortado justo por esto: el
 * screenshot cayó a mitad de la animación y la aserción de "ancho > alto" lo dejó pasar).
 */
async function waitForExpanded(page: Page) {
  await expect(async () => {
    const fits = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stick-status-pill"]') as HTMLElement | null;
      if (!el) return false;
      return el.scrollWidth <= el.clientWidth + 1 && el.clientWidth > el.clientHeight + 20;
    });
    expect(fits, 'el indicador todavía no terminó de estirarse (o recorta el texto)').toBe(true);
  }).toPass({ timeout: 10_000 });
  return indicatorBox(page);
}

/** Las DOS marcas del bastón (E2E + DEMO) ANTES del bundle → simulador → el indicador puede estar vivo. */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__MITROPERO_BLE_E2E__ = true;
    w.__MITROPERO_BLE_DEMO__ = true;
  });
}

test('capturas: el indicador arriba a la derecha, en sus dos formas @ 412×915', async ({ browser }) => {
  test.setTimeout(240_000);
  // `deviceScaleFactor: 3`: el layout es el mismo (412×915 CSS) pero los PNG salen a 3×, que es lo que
  // hace vetables los recortes chicos (el shot 08 mide 132×90 CSS).
  const ctx = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    // Nombre LARGO a propósito: con "E2E" el saludo de la home termina en x≈215 y la banda parece libre.
    // Con 16 caracteres llega hasta donde vive el indicador — que es el caso que hay que poder vetar.
    const user = await createTestUser('cap-indunico', 'Maximiliano-José Etchegoyen');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Indicador Unico');
    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // Conexión VIVA por la ruta del operario (un `page.goto` remontaría el provider y la apagaría).
    const stickRow = page.getByRole('button', { name: STICK_ROW_NAME });
    await gotoTab(page, 'Más', stickRow);
    await stickRow.click();
    await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('demo-simulate')).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await page.getByTestId('demo-simulate').click();
      await expect(page.getByLabel(/^Caravana \d{15} DEMO$/).first()).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByText('Bastón conectado', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    // En `/baston` el indicador está callado: la card de la pantalla ya dice el estado.
    await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);

    // ── (01) "Más": la PILL, recién llegando ────────────────────────────────────────────────────────
    // Al volver, el indicador APARECE (en `/baston` estaba suprimido) y esa aparición es una noticia → se
    // estira. Se asserta la forma antes de la foto: si saliera un círculo, la captura mentiría.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 15_000 });
    const expanded = await waitForExpanded(page);
    expect(expanded.width, 'el shot 01 documenta la PILL: salió un círculo').toBeGreaterThan(expanded.height + 20);
    await shot(page, '01-mas-pill-expandida');

    // ── (02) "Más": el CÍRCULO, en reposo ───────────────────────────────────────────────────────────
    await page.waitForTimeout(COLLAPSE_WAIT_MS);
    const collapsed = await indicatorBox(page);
    expect(Math.round(collapsed.width), 'el shot 02 documenta el CÍRCULO: no volvió solo').toBe(
      Math.round(collapsed.height),
    );
    await shot(page, '02-mas-circulo-en-reposo');

    // ── (03) La banda de arriba, ampliada: el círculo DEBAJO de la fila del header ─────────────────
    await page.screenshot({
      path: path.join(SHOT_DIR, '03-banda-header-mas.png'),
      clip: { x: 0, y: 0, width: 412, height: Math.round(collapsed.y + collapsed.height + 24) },
    });

    // ── (04)/(05) "Inicio": la fila del header está LLENA (switch · RAFAQ · avatar) ────────────────
    // Se pasa por "Animales" —que reclama el lugar, así que el indicador se apaga— y al volver a Inicio
    // vuelve a aparecer: esa reaparición es, de nuevo, una noticia → pill. Es una ruta REAL de operario,
    // no un truco de test.
    const searchBar = page.getByLabel('Buscar animal por caravana o número', { exact: true });
    await gotoTab(page, 'Animales', searchBar);
    await expect(page.getByTestId('ble-connection-chip')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);
    // ── (07) La supresión: el chip del header manda y la esquina queda limpia ──────────────────────
    await shot(page, '07-animales-el-chip-manda');

    // El AMORTIGUADOR ANTI-PARPADEO, actuando: una misma noticia no se repite antes de
    // `MORPH_MIN_GAP_MS` (8 s). Sin esta espera el indicador reaparece en Inicio ya como círculo —
    // medido: la primera versión de esta captura falló justo acá con ancho 40—. O sea que la espera no
    // es un `sleep` de conveniencia: es la prueba de que saltar entre pantallas NO re-anuncia.
    await page.waitForTimeout(9_000);

    await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 20_000 });
    const homeExpanded = await waitForExpanded(page);
    expect(homeExpanded.width, 'el shot 04 documenta la PILL en Inicio').toBeGreaterThan(homeExpanded.height + 20);
    expect(
      Math.round(homeExpanded.x + homeExpanded.width),
      'la pill se sale de la pantalla: tiene que crecer hacia la IZQUIERDA',
    ).toBeLessThanOrEqual(412 - 18);
    await shot(page, '04-inicio-pill-expandida');

    await page.waitForTimeout(COLLAPSE_WAIT_MS);
    await shot(page, '05-inicio-circulo-junto-al-saludo');

    // ── (08) EL ROCE DE "MÁS", AMPLIADO ───────────────────────────────────────────────────────────
    // El único contacto que quedó en las pantallas que NO reclaman: el borde inferior del círculo llega a
    // y=106 y la card de "Perfil" arranca en y≈104, o sea se tocan por ~2 px. No tapa nada legible (es el
    // borde de la card), pero un roce puede leerse como un defecto de alineación — así que se captura
    // AMPLIADO para que el veto sea sobre píxeles y no sobre mi descripción.
    await gotoTab(page, 'Más', stickRow);
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(COLLAPSE_WAIT_MS);
    const enMas = await indicatorBox(page);
    await page.screenshot({
      path: path.join(SHOT_DIR, '08-mas-roce-con-la-card-ampliado.png'),
      clip: {
        x: Math.round(enMas.x) - 90,
        y: Math.round(enMas.y) - 26,
        width: Math.round(enMas.width) + 108,
        height: Math.round(enMas.height) + 52,
      },
    });

    // ── (06) Alta: el caso más APRETADO (contenido pegado arriba) — y aun así el círculo despeja ──
    await gotoTab(page, 'Animales', searchBar);
    await page.getByRole('button', { name: /Dar de alta/ }).first().click();
    await expect(page.getByText(/^Paso \d de 4$/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(COLLAPSE_WAIT_MS);
    await shot(page, '06-alta-circulo-caso-apretado');
  } finally {
    await ctx.close();
  }
});
