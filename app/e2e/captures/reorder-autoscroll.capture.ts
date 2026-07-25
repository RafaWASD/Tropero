// e2e/captures/reorder-autoscroll.capture.ts — CAPTURAS del veto visual (Gate 2.5, ADR-029) del bugfix del
// AUTO-SCROLL ACOTADO del drag de reorder (spec 03 R1.12, etapa 2 del wizard de jornada).
//
// El bug NO es un estado estático: es lo que pasa MIENTRAS sostenés el grip en el borde inferior. Por eso
// cada captura se saca CON EL DEDO APRETADO (mouse.down, sin soltar) en la banda de borde — que es el
// instante exacto en el que antes la página volaba al fondo y las seleccionadas desaparecían.
//
//   01-region-entra-reposo      — 4 seleccionadas (la región ENTRA entera en el viewport), sin drag.
//   02-region-entra-drag-borde  — MISMO caso, sosteniendo el grip de la última en el borde inferior:
//                                 la lista sigue a la vista y el scroll NO se movió (antes: fondo de todo).
//   03-region-larga-reposo      — 9 seleccionadas (la región NO entra en el viewport), sin drag.
//   04-region-larga-drag-borde  — sosteniendo el grip en el borde: el auto-scroll SÍ corre (revelar es
//                                 legítimo) pero FRENA con la última fila a la vista y con aire, sin
//                                 seguir hasta el pool / "Detalle de la tanda" / CTA.
//   05-region-larga-tope        — misma jornada, sosteniendo el grip contra el borde SUPERIOR: frena con
//                                 la primera fila + su aire a la vista (no sigue subiendo).
//
// Los .png van a e2e/captures/__shots__/reorder-autoscroll/ (gitignored). Corrida:
//   pnpm exec playwright test e2e/captures/reorder-autoscroll.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, expect, type Page } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(__dirname, '__shots__', 'reorder-autoscroll');

/** Etapa 2 del wizard, con el pool ya bajado del sync. */
async function gotoStage2(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible({ timeout: 30_000 });
}

/** Lleva el ScrollView de la jornada a un offset concreto (0 = arriba de todo, Infinity = al fondo). */
async function scrollJornadaTo(page: Page, offset: number): Promise<void> {
  await page.getByTestId('jornada-scroll').evaluate((el, y) => {
    (el as HTMLElement).scrollTop = y;
  }, offset);
  await page.waitForTimeout(120);
}

/**
 * Índice de la ÚLTIMA fila cuyo grip está a la vista (la que el operario puede agarrar sin scrollear).
 * "A la vista" = dentro del rect del ScrollView, NO del window: la lista está clippeada por el ScrollView
 * (el CTA es un sibling pinneado abajo), y el boundingBox del DOM ignora ese clipping — una fila "visible"
 * según el window puede caer bajo el CTA y el click iría al CTA, no al grip.
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
 * Agarra el grip de la fila `index` y lo sostiene (SIN soltar) en la banda de borde indicada.
 * OJO: el grip tiene que estar VISIBLE (es lo que haría el operario). NO se usa
 * `scrollIntoViewIfNeeded` porque CENTRA el elemento (scrollea de más) y falsearía la captura.
 */
async function holdHandleAtEdge(page: Page, index: number, edge: 'top' | 'bottom'): Promise<void> {
  const handle = page.getByTestId(`drag-handle-${index}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`drag-handle-${index} sin boundingBox`);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('sin viewportSize');
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const yTarget = edge === 'bottom' ? viewport.height - 10 : 10;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(x, y0 + ((yTarget - y0) * i) / 12);
    await page.waitForTimeout(16);
  }
  // Sostener: el auto-scroll corre (o no) solo, frame a frame. 1,2 s alcanza para que llegue a su tope.
  await page.waitForTimeout(1200);
}

test('capturas del auto-scroll acotado del drag de reorder', async ({ page }) => {
  test.setTimeout(240_000);
  const user = await createTestUser('cap-reorder-autoscroll');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Reorder', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── Caso A: la región ENTRA entera en el viewport (el caso que reportó Raf) ─────────────────────
  await gotoStage2(page);
  for (const key of ['pesaje', 'tacto', 'condicion_corporal', 'dientes']) {
    await page.getByTestId(`pool-row-${key}`).click();
  }
  await expect(page.getByTestId('selected-row-3')).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, '01-region-entra-reposo.png') });

  await holdHandleAtEdge(page, 3, 'bottom');
  await page.screenshot({ path: path.join(SHOT_DIR, '02-region-entra-drag-borde.png') });
  await page.mouse.up();

  // ── Caso B: la región NO entra (todas las maniobras del rodeo) → el auto-scroll revela y FRENA ──
  await gotoStage2(page);
  // 9 seleccionadas (9 × 80 = 720px > viewport) DEJANDO pool + "Detalle de la tanda" + CTA por debajo:
  // así la captura discrimina el fix (con el bug, el auto-scroll se comía también todo eso).
  for (let i = 0; i < 9; i += 1) {
    // Siempre el primero del pool: al sumarse sube a las seleccionadas y el pool se corre. Esperamos a que
    // la fila aterrice antes del siguiente click (la lista se re-arma con springs).
    await page.getByTestId(/^pool-row-/).first().click();
    await expect(page.getByTestId(`selected-row-${i}`)).toBeVisible();
  }
  const selected = await page.getByTestId(/^selected-row-/).count();
  expect(selected).toBe(9);
  expect(await page.getByTestId(/^pool-row-/).count()).toBeGreaterThan(0);
  await scrollJornadaTo(page, 0);
  await page.screenshot({ path: path.join(SHOT_DIR, '03-region-larga-reposo.png') });

  // Agarramos el grip de la ÚLTIMA fila VISIBLE (la que el operario tiene a mano cerca del borde) y lo
  // sostenemos abajo: el auto-scroll revela lo que falta de la región y FRENA con la última fila + aire.
  await holdHandleAtEdge(page, await lastVisibleHandleIndex(page, selected), 'bottom');
  await page.screenshot({ path: path.join(SHOT_DIR, '04-region-larga-drag-borde.png') });
  await page.mouse.up();

  // Borde SUPERIOR: desde el fondo, sosteniendo el grip arriba, frena con la PRIMERA fila + aire a la vista.
  await scrollJornadaTo(page, 10_000);
  await holdHandleAtEdge(page, await lastVisibleHandleIndex(page, selected), 'top');
  await page.screenshot({ path: path.join(SHOT_DIR, '05-region-larga-tope.png') });
  await page.mouse.up();
});
