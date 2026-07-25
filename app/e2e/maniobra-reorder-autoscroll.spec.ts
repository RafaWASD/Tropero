// e2e/maniobra-reorder-autoscroll.spec.ts — REGRESIÓN del auto-scroll del drag de reorder (spec 03 R1.12).
//
// BUG (Raf, device iOS, 2026-07-25): en la etapa 2 del wizard ("Elegí las maniobras"), mantener apretado el
// grip de una maniobra cerca del borde inferior de la pantalla disparaba el auto-scroll y scrolleaba la
// página hasta el FONDO DE TODO el contenido (pool de no-seleccionadas + custom + "Detalle de la tanda" +
// CTA) — la lista que estabas ordenando desaparecía de pantalla. El auto-scroll solo tenía tope hacia
// ARRIBA (offset ≥ 0); hacia abajo corría hasta el final del contenido.
//
// FIX: el frame callback mide la REGIÓN de seleccionadas (`measure()` en el UI thread) y solo scrollea
// mientras quede región por revelar (`autoScrollDelta`, puro y testeado en unit).
//
// ORÁCULO de este spec (lo que CAE sin el fix): con una selección que ENTRA ENTERA en el viewport, agarrar
// el grip de la última fila y sostenerlo en la banda de borde inferior NO debe mover el scroll — y las
// seleccionadas siguen a la vista. Antes del fix, ese mismo gesto llevaba `scrollTop` al fondo del
// contenido (cientos de px) y las filas seleccionadas se iban de pantalla.
//
// ANTI-FALSO-VERDE: "no scrolleó" también sería cierto si el gesto Pan NUNCA se hubiera activado. Por eso
// cada caso mide ADEMÁS, con el dedo todavía abajo, el estado BURBUJA de la fila arrastrada (zIndex 50 +
// escala 1.04 que el useAnimatedStyle escribe recién cuando el Pan activa) — y el caso 1 fija primero el
// control en reposo. El verde significa "arrastré de verdad y NO scrolleó", no "no pasó nada".
//
// El veredicto en DEVICE (iOS/Android, gesto real con el dedo) es de Raf (ADR-029): acá se cubre el WIRING
// (region ref + measure + clamp) en web, que es donde la suite puede ejercitar el gesto.

import { test, expect, type Page } from './helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Offset de scroll (px) del ScrollView de la jornada, leído del DOM real. */
async function scrollTopOf(page: Page): Promise<number> {
  return page.getByTestId('jornada-scroll').evaluate((el) => (el as HTMLElement).scrollTop);
}

/** Lleva el ScrollView de la jornada a un offset concreto (0 = arriba de todo). */
async function scrollJornadaTo(page: Page, offset: number): Promise<void> {
  await page.getByTestId('jornada-scroll').evaluate((el, y) => {
    (el as HTMLElement).scrollTop = y;
  }, offset);
  await page.waitForTimeout(120);
}

/** Alto scrolleable restante del ScrollView de la jornada (scrollHeight − clientHeight). */
async function maxScrollOf(page: Page): Promise<number> {
  return page
    .getByTestId('jornada-scroll')
    .evaluate((el) => (el as HTMLElement).scrollHeight - (el as HTMLElement).clientHeight);
}

/**
 * Índice de la ÚLTIMA fila cuyo grip está a la vista DENTRO del rect del ScrollView (lo que el operario
 * puede agarrar sin scrollear). El bounding box del DOM ignora el clipping del ScrollView → una fila
 * "visible" según el window puede caer bajo el CTA pinneado y el click iría al CTA, no al grip.
 */
async function lastVisibleHandleIndex(page: Page, total: number): Promise<number> {
  const scroller = await page.getByTestId('jornada-scroll').boundingBox();
  if (!scroller) throw new Error('jornada-scroll sin boundingBox');
  for (let i = total - 1; i >= 0; i -= 1) {
    const box = await page.getByTestId(`drag-handle-${i}`).boundingBox();
    if (box && box.y >= scroller.y && box.y + box.height <= scroller.y + scroller.height) return i;
  }
  throw new Error('ningún grip visible');
}

/**
 * Estado "BURBUJA" (levantado) de la fila `index`, leído del DOM real: mientras el Pan está ACTIVO, el
 * `useAnimatedStyle` de la fila sube su `zIndex` a 50 y la escala a LIFT_SCALE (1.04); en reposo son 1 y 1.
 * Es la PRUEBA de que el gesto TOMÓ — sin ella, un test que solo afirma "no scrolleó" pasaría igual si el
 * Pan nunca se hubiera activado (que es el falso verde que este oráculo cierra).
 *
 * El estilo animado vive en el `Animated.View` que ENVUELVE la card (el testID está en la card) → subimos
 * unos pocos ancestros y nos quedamos con el máximo de cada métrica.
 */
async function liftStateOf(page: Page, index: number): Promise<{ zIndex: number; scaleX: number }> {
  return page.getByTestId(`selected-row-${index}`).evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    let zIndex = 0;
    let scaleX = 1;
    for (let i = 0; i < 3 && node; i += 1) {
      const cs = getComputedStyle(node);
      const z = Number.parseInt(cs.zIndex, 10);
      if (Number.isFinite(z)) zIndex = Math.max(zIndex, z);
      if (cs.transform && cs.transform !== 'none') {
        const m = new DOMMatrixReadOnly(cs.transform);
        scaleX = Math.max(scaleX, m.a);
      }
      node = node.parentElement;
    }
    return { zIndex, scaleX };
  });
}

/**
 * Agarra el grip de la fila `index`, lo arrastra hasta la banda de borde INFERIOR del viewport y lo
 * SOSTIENE ahí (sin soltar) los `holdMs` — que es lo que hace correr el auto-scroll frame a frame.
 * Devuelve, medidos DURANTE el hold (antes de soltar): el `scrollTop` y el estado burbuja de la fila
 * arrastrada (que acredita que el Pan se activó de verdad).
 */
async function dragHandleToBottomEdgeAndHold(
  page: Page,
  index: number,
  holdMs: number,
): Promise<{ scrolled: number; lift: { zIndex: number; scaleX: number } }> {
  const handle = page.getByTestId(`drag-handle-${index}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`drag-handle-${index} sin boundingBox`);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('sin viewportSize');

  const x = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  // Pasos chicos: cruzar el umbral de activación (activeOffsetY 8px) y llegar a la banda de borde inferior
  // (EDGE_ZONE del viewport del ScrollView) como lo haría un dedo.
  const yTarget = viewport.height - 10;
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x, y0 + ((yTarget - y0) * i) / steps);
    await page.waitForTimeout(16);
  }
  // HOLD: el dedo queda quieto en la banda de borde → el frame callback es el único que puede mover el
  // scroll. Acá es donde el bug se manifestaba (la página volaba al fondo).
  await page.waitForTimeout(holdMs);
  const scrolled = await scrollTopOf(page);
  // Con el dedo TODAVÍA abajo: leemos el estado burbuja (el gesto sigue activo).
  const lift = await liftStateOf(page, index);
  await page.mouse.up();
  return { scrolled, lift };
}

test('R1.12 — el auto-scroll del drag NO se pasa de la región de seleccionadas', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('reorder-autoscroll');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Reorder AutoScroll');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible({ timeout: 30_000 });

  // 4 seleccionadas (4 × ROW_HEIGHT = 320px) → la región ENTRA ENTERA en el viewport del ScrollView, pero
  // debajo quedan el pool + el "Detalle de la tanda" (contenido de sobra para que el bug tuviera a dónde
  // irse: sin el fix el scroll se iba al fondo de TODO eso).
  for (const key of ['pesaje', 'tacto', 'condicion_corporal', 'dientes']) {
    await page.getByTestId(`pool-row-${key}`).click();
  }
  await expect(page.getByTestId('selected-row-3')).toBeVisible();
  // Precondición del caso: arrancamos arriba de todo y hay contenido por debajo (el scroll PUEDE moverse).
  expect(await scrollTopOf(page)).toBe(0);
  const maxScroll = await maxScrollOf(page);
  expect(maxScroll).toBeGreaterThan(100);

  // CONTROL en reposo (antes de tocar nada): la fila NO está levantada. Fija la línea de base del oráculo
  // de gesto de abajo — si estos valores ya fueran los de "levantada", el assert no probaría nada.
  const atRest = await liftStateOf(page, 3);
  expect(atRest.zIndex, `en reposo la fila no debe estar levantada: ${JSON.stringify(atRest)}`).toBeLessThan(50);
  expect(atRest.scaleX).toBeLessThan(1.02);

  // Agarramos el grip de la ÚLTIMA seleccionada y lo sostenemos en el borde inferior ~1s.
  const { scrolled, lift } = await dragHandleToBottomEdgeAndHold(page, 3, 1000);

  // ORÁCULO 1 — EL GESTO TOMÓ: durante el hold la fila está LEVANTADA (zIndex 50 + escala 1.04, que solo
  // los escribe el useAnimatedStyle cuando el Pan ACTIVÓ y seteó activeKey). Sin esto, el assert de "no
  // scrolleó" pasaría también si el drag nunca se hubiera activado — verde por la razón equivocada.
  expect(lift.zIndex, `el Pan no se activó (fila sin levantar): ${JSON.stringify(lift)}`).toBeGreaterThanOrEqual(50);
  expect(lift.scaleX, `la fila arrastrada no escaló (burbuja): ${JSON.stringify(lift)}`).toBeGreaterThan(1.02);

  // ORÁCULO 2 — la región ya está entera a la vista → el auto-scroll no tiene nada que revelar → NO se movió.
  // (Sin el fix: `scrolled` ≈ maxScroll.)
  expect(scrolled).toBeLessThan(24);
  // Y lo que importa en UX: las seleccionadas siguen en pantalla (Nielsen #1).
  await expect(page.getByTestId('selected-row-0')).toBeInViewport();
  await expect(page.getByTestId('selected-row-3')).toBeInViewport();
});

test('R1.12 — con la región MÁS ALTA que el viewport, el auto-scroll revela lo que falta y FRENA ahí', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('reorder-autoscroll-larga');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Reorder Larga');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible({ timeout: 30_000 });

  // 9 seleccionadas (9 × 80 = 720px) → la región NO entra en el viewport, y ADEMÁS queda pool + custom +
  // "Detalle de la tanda" + CTA por debajo. Revelar el resto de la región es LEGÍTIMO (el operario tiene
  // que ver dónde va a caer lo que arrastra); pasarse de ahí es el bug.
  const SELECTED = 9;
  for (let i = 0; i < SELECTED; i += 1) {
    await page.getByTestId(/^pool-row-/).first().click();
    await expect(page.getByTestId(`selected-row-${i}`)).toBeVisible();
  }
  expect(await page.getByTestId(/^pool-row-/).count()).toBeGreaterThan(0);
  // Los clicks de Playwright scrollean para alcanzar la fila del pool → volvemos arriba de todo, que es
  // desde donde el operario agarra el grip.
  await scrollJornadaTo(page, 0);
  expect(await scrollTopOf(page)).toBe(0);
  const maxScroll = await maxScrollOf(page);

  // Agarramos el grip de la última fila QUE SE VE (lo que haría el operario) y sostenemos abajo.
  const grabbed = await lastVisibleHandleIndex(page, SELECTED);
  expect(grabbed).toBeLessThan(SELECTED - 1); // hay región oculta por debajo: el auto-scroll TIENE que correr
  const { scrolled, lift } = await dragHandleToBottomEdgeAndHold(page, grabbed, 1200);

  // El gesto TOMÓ (la fila quedó levantada durante el hold): el scroll que medimos abajo es del auto-scroll
  // del drag, no de otra cosa.
  expect(lift.zIndex, `el Pan no se activó (fila sin levantar): ${JSON.stringify(lift)}`).toBeGreaterThanOrEqual(50);

  // ORÁCULO doble:
  //  (a) reveló lo que faltaba de la región → la última fila quedó a la vista (si el clamp fuera "no
  //      scrollees nunca" o "frená cuando el ítem toca su bound", esto caería);
  await expect(page.getByTestId(`selected-row-${SELECTED - 1}`)).toBeInViewport();
  //  (b) y FRENÓ ahí: no siguió hasta el fondo de todo el contenido (que es lo que hacía el bug).
  expect(scrolled).toBeGreaterThan(0);
  expect(scrolled).toBeLessThan(maxScroll - 60);
});
