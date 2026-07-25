// e2e/sheet-teclado.spec.ts — REGRESIÓN del BUG 🔴 MANGA "el teclado tapa TODO el bottom sheet"
// (Raf, device iOS): al enfocar el input del sheet "Vacunación" (etapa 2 del wizard) solo quedaba visible
// el TÍTULO — input, chips, "+", sugerencias y los DOS CTAs caían debajo del teclado.
//
// Fix: primitivo `BottomSheetShell` (src/components/BottomSheetShell.tsx) — backdrop con guard anti
// click-huérfano + header fijo / body scroll / footer fijo + KeyboardAvoidingView + condensación con el
// teclado arriba + X de cierre SIEMPRE en el header. Migró los 4 sheets con input de texto.
//
// ── QUÉ SE PUEDE VERIFICAR EN WEB Y QUÉ NO (honestidad de cobertura, ADR-029) ─────────────────────────
// react-native-web NO monta teclado virtual: `Keyboard` nunca emite → `useKeyboardVisible()` queda false →
// la CONDENSACIÓN (ocultar descripción + CTA secundario) NO es observable acá. Esa decisión está cubierta
// por unit (`src/utils/sheet-shell.test.ts`) y su veredicto visual es DEVICE (Raf).
// Lo que SÍ se verifica acá, y es regresión real:
//   1. ENTER en el sheet multi (vacunas) AGREGA el chip y NO cierra el teclado ni el sheet → se pueden
//      cargar 3 vacunas seguidas sin reabrir el teclado (el input conserva el FOCO). Antes: returnKeyType
//      'done' + blurOnSubmit por default → blur en cada Enter.
//   2. El INPUT va ARRIBA de los chips → agregar vacunas no lo empuja fuera de la vista.
//   3. Con POCO ALTO ÚTIL (viewport 412×420 ≈ lo que queda visible con el teclado abierto en un teléfono):
//      título + input + CTA primario siguen TODOS dentro del viewport, sin recorte por arriba. Es el
//      oráculo de layout del caso "teclado arriba" que web sí puede ejercitar.
//   4. La X del header cierra cada sheet (afordancia nueva; con el teclado arriba es la única salida).
// El guard anti click-huérfano del scrim (movido al primitivo) sigue cubierto por
// e2e/maniobra-config-sheet-race.spec.ts, que corre tal cual.

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Alto útil que queda con el teclado abierto en un teléfono (≈45% de la pantalla). */
const KEYBOARD_UP_VIEWPORT = { width: 412, height: 420 } as const;
const FULL_VIEWPORT = { width: 412, height: 915 } as const;

/** Afirma que el elemento está DENTRO del viewport visible (ni recortado por arriba ni por abajo). */
async function expectInsideViewport(page: Page, testId: string, label: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  const size = page.viewportSize();
  if (!box) throw new Error(`sin boundingBox para ${label} (${testId})`);
  if (!size) throw new Error('sin viewportSize');
  expect(box.y, `${label}: recortado por arriba`).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height, `${label}: cae debajo del viewport`).toBeLessThanOrEqual(size.height + 1);
}

/**
 * Y del input "Nueva opción" en coordenadas de CONTENIDO del body scrolleable del sheet (no de pantalla):
 * `top del input − top del viewport + scrollTop`. Es la métrica que aísla "el input no se mueve al agregar
 * opciones": las coordenadas de pantalla cambian por cosas ajenas al layout (el sheet crece hacia arriba —
 * está anclado abajo — y Playwright scrollea el elemento a la vista antes de cada click).
 */
async function optionInputContentY(page: Page): Promise<number> {
  return page.getByTestId('custom-field-option-input').evaluate((el) => {
    const scroller = document.querySelector('[data-testid="custom-field-scroll"]');
    if (!(scroller instanceof HTMLElement)) throw new Error('sin custom-field-scroll');
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  });
}

/** Lleva el wizard hasta la etapa 2 con Vacunación elegida y ABRE el sheet de preconfig. */
async function openVacunacionSheet(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByTestId('selected-body-0').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
}

test('sheet de vacunas: Enter agrega SIN perder el teclado, el input queda arriba de los chips, y con poco alto útil el título + input + CTA siguen visibles', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('sheet-teclado-vac');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Sheet Teclado');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await openVacunacionSheet(page);

  const input = page.getByTestId('maneuver-config-input');

  // ── (1) TRES vacunas seguidas con Enter: cada una agrega su chip, limpia el input y CONSERVA EL FOCO ──
  // (con el foco vivo el teclado del SO NO se baja → no hay que reabrirlo por vacuna). Antes del fix, el
  // Enter blureaba el input (returnKeyType 'done' + blurOnSubmit por default de un input de una línea).
  for (const vacuna of ['Brucelosis', 'Aftosa', 'Carbunclo']) {
    await input.click();
    await input.fill(vacuna);
    await input.press('Enter');
    await expect(page.getByTestId(`config-chip-${vacuna}`)).toBeVisible({ timeout: 5_000 });
    await expect(input).toHaveValue('');
    await expect(input, `el foco se perdió tras agregar ${vacuna}`).toBeFocused();
    // El sheet NO se cerró con el Enter (sigue vivo para seguir cargando).
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible();
  }

  // ── (2) El INPUT está ARRIBA de los chips (agregar no lo empuja fuera de la vista) ──
  const inputBox = await input.boundingBox();
  const chipBox = await page.getByTestId('config-chip-Carbunclo').boundingBox();
  expect(inputBox).not.toBeNull();
  expect(chipBox).not.toBeNull();
  expect(inputBox!.y, 'el input debe ir ARRIBA de los chips').toBeLessThan(chipBox!.y);

  // ── (3) POCO ALTO ÚTIL (≈ teclado abierto): título + input + CTA primario siguen dentro del viewport ──
  await page.setViewportSize(KEYBOARD_UP_VIEWPORT);
  const title = page.getByTestId('maneuver-config-sheet').getByText('Vacunación', { exact: true });
  await expect(title).toBeVisible();
  const sheetBox = await page.getByTestId('maneuver-config-sheet').boundingBox();
  const titleBox = await title.boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  // El título NO se sale por arriba del sheet ni de la pantalla (el sheet se achica, no se desborda).
  expect(sheetBox!.y, 'el sheet se desbordó por arriba de la pantalla').toBeGreaterThanOrEqual(-1);
  expect(titleBox!.y).toBeGreaterThanOrEqual(sheetBox!.y - 1);
  await expectInsideViewport(page, 'maneuver-config-input', 'input de vacuna');
  const guardar = page.getByRole('button', { name: 'Guardar', exact: true });
  await expect(guardar).toBeVisible();
  const guardarBox = await guardar.boundingBox();
  expect(guardarBox).not.toBeNull();
  expect(guardarBox!.y + guardarBox!.height, 'el CTA "Guardar" quedó fuera del viewport').toBeLessThanOrEqual(
    KEYBOARD_UP_VIEWPORT.height + 1,
  );
  await page.setViewportSize(FULL_VIEWPORT);

  // ── (4) La X del header CIERRA el sheet (sin guardar: la fila sigue reclamando la vacuna) ──
  await page.getByTestId('maneuver-config-sheet-close').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Faltan vacunas', { exact: true })).toBeVisible();
});

test('la X del header cierra el sheet de maniobra custom y el de "Guardar como rutina"', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await createTestUser('sheet-teclado-x');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Sheet X');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await openVacunacionSheet(page);
  // Definimos la vacuna (D2 exige ≥1 para poder continuar a la etapa 3) y guardamos.
  await page.getByTestId('maneuver-config-input').fill('Brucelosis');
  await page.getByTestId('maneuver-config-input').press('Enter');
  await expect(page.getByTestId('config-chip-Brucelosis')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });

  // ── SHEET DE MANIOBRA CUSTOM (el `+` de la lista): la X lo cierra sin crear nada ──
  await page.getByTestId('maneuver-add-custom').click();
  await expect(page.getByTestId('custom-field-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('custom-field-label')).toBeVisible();

  // CONSISTENCIA con el sheet de vacunas (misma interacción escribir→agregar→chip ⇒ mismo layout): en el
  // editor de opciones de un enum, el INPUT "Nueva opción" va ARRIBA de los chips y el input NO SE MUEVE al
  // agregar (con el teclado arriba, la 3ra/4ta opción lo empujaba fuera del área visible). Enter agrega y
  // conserva el foco, igual que en vacunas.
  await page.getByTestId('type-enum_multi').click();
  const optionInput = page.getByTestId('custom-field-option-input');
  await expect(optionInput).toBeVisible();
  const inputContentYBefore = await optionInputContentY(page);
  for (const opt of ['adentro', 'afuera', 'normal']) {
    await optionInput.click();
    await optionInput.fill(opt);
    await optionInput.press('Enter');
    await expect(page.getByTestId(`option-chip-${opt}`)).toBeVisible({ timeout: 5_000 });
    await expect(optionInput).toHaveValue('');
    await expect(optionInput, `el foco se perdió tras agregar ${opt}`).toBeFocused();
  }
  const optionInputBox = await optionInput.boundingBox();
  const optionChipBox = await page.getByTestId('option-chip-normal').boundingBox();
  expect(optionInputBox).not.toBeNull();
  expect(optionChipBox).not.toBeNull();
  expect(optionInputBox!.y, 'el input de opción debe ir ARRIBA de los chips').toBeLessThan(optionChipBox!.y);
  // Y su posición DENTRO DEL CONTENIDO no cambió al agregar las 3 (los chips crecen hacia abajo, no lo
  // empujan). Con los chips arriba (layout anterior) este delta era el alto del bloque de chips.
  expect(
    Math.abs((await optionInputContentY(page)) - inputContentYBefore),
    'el input se movió dentro del contenido al agregar opciones',
  ).toBeLessThanOrEqual(1);

  await page.getByTestId('custom-field-sheet-close').click();
  await expect(page.getByTestId('custom-field-sheet')).toHaveCount(0, { timeout: 10_000 });
  // Seguimos en la etapa 2 (no navegó, no creó).
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible();

  // ── SHEET "GUARDAR COMO RUTINA" (etapa 3): la X lo cierra sin guardar ──
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Guardar como rutina', exact: true }).click();
  await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('save-preset-input')).toBeVisible();
  await page.getByTestId('save-preset-sheet-close').click();
  await expect(page.getByTestId('save-preset-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible();
});

test('picker de razas: el buscador sigue filtrando y la X cierra el sheet', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await createTestUser('sheet-teclado-raza');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Sheet Raza');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Categoría Vaquillona', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Elegir raza', exact: true }).click();
  await expect(page.getByTestId('breed-sheet')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('breed-option-none')).toBeVisible();

  // El buscador (ahora primer elemento del cuerpo, no del header fijo) sigue filtrando la lista.
  await page.getByTestId('breed-sheet-search').fill('aberdeen');
  await expect(page.getByTestId('breed-option-AA')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('breed-option-HE')).toHaveCount(0);

  // La X cierra el sheet sin elegir raza (el form sigue reclamando la raza para SIGSA).
  await page.getByTestId('breed-sheet-close').click();
  await expect(page.getByTestId('breed-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(
    page.getByText('Completá la raza para poder exportar el animal a SIGSA.', { exact: true }),
  ).toBeVisible();
});
