// e2e/captures/sheet-teclado.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029) del
// fix 🔴 MANGA "el teclado tapa TODO el bottom sheet" (Raf, device iOS): del sheet "Vacunación" solo se veía
// el TÍTULO — input, chips, "+", sugerencias y los DOS CTAs quedaban debajo del teclado.
//
// Fix = primitivo `BottomSheetShell` (backdrop con guard + header fijo / body scroll / footer fijo +
// lift sobre el teclado (`KeyboardAvoidingShell`) + condensación con el teclado arriba + X de cierre SIEMPRE) aplicado a los 4 sheets
// con input de texto: preconfig de maniobra, dato/maniobra custom, guardar rutina, picker de razas.
//
// ── QUÉ MUESTRAN ESTAS CAPTURAS Y QUÉ NO ─────────────────────────────────────────────────────────────
// react-native-web NO monta teclado virtual → la CONDENSACIÓN (ocultar descripción + CTA secundario con el
// teclado arriba) NO es capturable en web; su veredicto es DEVICE (Raf). Lo que SÍ se captura, y es el
// riesgo de layout del fix:
//   · el estado NORMAL de los 4 sheets a 412 (que la migración al shell no regresionó nada), con la X nueva;
//   · el estado de ALTO ÚTIL RECORTADO (viewport 412×420 ≈ lo que queda visible con el teclado abierto en un
//     teléfono): ahí se ve si el título se recorta, si el input sigue a la vista y si el CTA primario queda
//     alcanzable. Es la mitad "geométrica" del caso teclado que web sí puede ejercitar.
//
// Estados capturados:
//   01 — vacunación VACÍO (input arriba, "Usadas antes", único CTA "Listo", X en el header)
//   02 — vacunación con 3 VACUNAS cargadas (chips DEBAJO del input; el input no se movió)
//   03 — vacunación con ALTO RECORTADO (412×420 ≈ teclado arriba): título + input + "Listo" visibles
//   04 — maniobra CUSTOM (form) normal
//   05 — maniobra CUSTOM con alto recortado
//   05b — maniobra CUSTOM enum con 3 OPCIONES cargadas (input arriba, chips DEBAJO — mismo layout que el
//         sheet de vacunas: misma interacción, mismo diseño)
//   05c — ese mismo estado con ALTO RECORTADO (≈ teclado arriba): el input sigue a la vista con chips cargados
//   05d — VALIDACIÓN del editor con opciones cargadas (opción repetida): borde terracota + mensaje inline
//         PEGADO al input (arriba de los chips)
//   06 — GUARDAR COMO RUTINA (autoFocus: en device el teclado abre solo → es el caso más expuesto)
//   07 — GUARDAR COMO RUTINA con alto recortado
//   08 — PICKER DE RAZAS normal (buscador como primer elemento del cuerpo)
//   09 — PICKER DE RAZAS filtrado + alto recortado
//
// NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/sheet-teclado.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page, type Browser } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedManeuverPreset,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'sheet-teclado');

/** Alto útil que queda con el teclado abierto en un teléfono (≈45% de la pantalla). */
const KEYBOARD_UP = { width: 412, height: 420 } as const;
const FULL = { width: 412, height: 915 } as const;

async function newMobilePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { ...FULL } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Captura el mismo estado con el alto RECORTADO (≈ teclado arriba) y vuelve al viewport pleno. */
async function shotKeyboardUp(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ ...KEYBOARD_UP });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  await page.setViewportSize({ ...FULL });
}

/**
 * Lleva el body scrolleable de un sheet al FONDO (el form del dato custom es largo: tipo de dato = 7
 * opciones) para que el editor de opciones —input + chips debajo— entre en la foto.
 */
async function scrollSheetBodyToEnd(page: Page, bodyTestId: string): Promise<void> {
  await page.getByTestId(bodyTestId).evaluate((el) => {
    (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
  });
  await page.waitForTimeout(200);
}

test('capturas sheets keyboard-aware: vacunación / custom / rutina @ 412 + alto recortado', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-sheet-teclado');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Sheet Teclado');
    // Dos presets con preconfig de vacunación → siembran el autocompletar (R1.8): "Brucelosis"/"Aftosa"
    // aparecen como "Usadas antes" (contenido real del cuerpo del sheet).
    await seedManeuverPreset(establishmentId, 'Sanitario otoño', {
      maniobras: ['vacunacion'],
      preconfig: { vacunacion: 'Brucelosis' },
    });
    await seedManeuverPreset(establishmentId, 'Sanitario primavera', {
      maniobras: ['vacunacion'],
      preconfig: { vacunacion: 'Aftosa' },
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // ── Wizard → etapa 2 con Vacunación elegida → sheet de preconfig ──
    await page.goto('/maniobra/jornada');
    await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('pool-row-vacunacion').click();
    await expect(page.getByTestId('selected-row-0')).toBeVisible();
    await page.getByTestId('selected-body-0').click();
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });

    // 01) VACÍO — input GRANDE arriba, "Usadas antes" debajo, footer con el único CTA "Listo" (UX 4:
    //     auto-guardado, sin Guardar/Cancelar), X en el header.
    await expect(page.getByTestId('maneuver-config-input')).toBeVisible();
    await expect(page.getByText('Usadas antes', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('maneuver-config-sheet-close')).toBeVisible();
    await shot(page, '01-vacunacion-vacio');

    // 02) TRES VACUNAS con Enter (sin perder el foco) — los chips quedan DEBAJO del input.
    for (const vacuna of ['Brucelosis', 'Aftosa', 'Carbunclo']) {
      await page.getByTestId('maneuver-config-input').click();
      await page.getByTestId('maneuver-config-input').fill(vacuna);
      await page.getByTestId('maneuver-config-input').press('Enter');
      await expect(page.getByTestId(`config-chip-${vacuna}`)).toBeVisible({ timeout: 5_000 });
    }
    await shot(page, '02-vacunacion-tres-chips');

    // 03) ALTO RECORTADO (≈ teclado arriba): título + input + "Listo" tienen que seguir a la vista.
    await shotKeyboardUp(page, '03-vacunacion-alto-recortado');

    // Cerramos (D2 exige ≥1 vacuna para continuar a la etapa 3; ya quedaron persistidas al agregarlas).
    await page
      .getByTestId('maneuver-config-sheet')
      .getByRole('button', { name: 'Listo', exact: true })
      .click();
    await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });

    // ── 04/05) SHEET DE MANIOBRA CUSTOM (form directo, sin clasificación) ──
    await page.getByTestId('maneuver-add-custom').click();
    await expect(page.getByTestId('custom-field-sheet')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('custom-field-label')).toBeVisible();
    await shot(page, '04-custom-form');
    await shotKeyboardUp(page, '05-custom-form-alto-recortado');

    // 05b/05c) EDITOR DE OPCIONES de un enum con 3 opciones cargadas: el input "Nueva opción" queda ARRIBA
    // y los chips crecen DEBAJO (mismo layout que el sheet de vacunas — consistencia/ley de Jakob). Con el
    // alto recortado se ve si el input sigue alcanzable teniendo opciones ya cargadas.
    await page.getByTestId('type-enum_multi').click();
    await expect(page.getByTestId('custom-field-option-input')).toBeVisible();
    for (const opt of ['adentro', 'afuera', 'normal']) {
      await page.getByTestId('custom-field-option-input').click();
      await page.getByTestId('custom-field-option-input').fill(opt);
      await page.getByTestId('custom-field-option-input').press('Enter');
      await expect(page.getByTestId(`option-chip-${opt}`)).toBeVisible({ timeout: 5_000 });
    }
    // El form es largo (7 tipos de dato) → llevamos el body al fondo para que el editor entre en la foto.
    await scrollSheetBodyToEnd(page, 'custom-field-scroll');
    await shot(page, '05b-custom-enum-opciones');
    await page.setViewportSize({ ...KEYBOARD_UP });
    await scrollSheetBodyToEnd(page, 'custom-field-scroll');
    await shot(page, '05c-custom-enum-opciones-alto-recortado');
    await page.setViewportSize({ ...FULL });

    // 05d) VALIDACIÓN del editor CON opciones ya cargadas: repetir una opción marca el editor con el borde
    // terracota y el mensaje inline, que ahora va PEGADO al input (antes de los chips) — el estado que hay
    // que vetar visualmente tras el cambio de orden.
    await page.getByTestId('custom-field-option-input').click();
    await page.getByTestId('custom-field-option-input').fill('adentro');
    await page.getByTestId('custom-field-option-input').press('Enter');
    await expect(page.getByTestId('custom-field-options-error')).toBeVisible({ timeout: 5_000 });
    await scrollSheetBodyToEnd(page, 'custom-field-scroll');
    await shot(page, '05d-custom-enum-opcion-duplicada');

    await page.getByTestId('custom-field-sheet-close').click();
    await expect(page.getByTestId('custom-field-sheet')).toHaveCount(0, { timeout: 10_000 });

    // ── 06/07) SHEET "GUARDAR COMO RUTINA" (etapa 3; autoFocus → en device el teclado abre solo) ──
    await page.getByRole('button', { name: /^Continuar/ }).click();
    await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Guardar como rutina', exact: true }).click();
    await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('save-preset-input').fill('Tacto de otoño');
    await shot(page, '06-guardar-rutina');
    await shotKeyboardUp(page, '07-guardar-rutina-alto-recortado');
  } finally {
    await page.context().close();
  }
});

test('capturas sheet keyboard-aware: picker de razas @ 412 + alto recortado', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-sheet-raza');
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

    // 08) NORMAL — buscador como primer elemento del cuerpo + lista de razas + Cancelar + X.
    await shot(page, '08-razas-normal');

    // 09) FILTRADO + alto recortado (≈ teclado del buscador arriba): el resultado tiene que seguir visible.
    await page.getByTestId('breed-sheet-search').fill('aberdeen');
    await expect(page.getByTestId('breed-option-AA')).toBeVisible({ timeout: 10_000 });
    await shotKeyboardUp(page, '09-razas-filtrado-alto-recortado');
  } finally {
    await page.context().close();
  }
});
