// e2e/maniobra-customfield-validacion.spec.ts — FIX del bug de DISEÑO del sheet de CREAR maniobra/dato custom
// (M5-CLIENTE, CustomFieldSheet). Raf lo cazó EN VIVO (evidencia: tests/modo-maniobra/error-maniobra-custom.png):
//   - El título "Nueva maniobra" se RECORTABA contra el tope del sheet, y EMPEORABA al aparecer el error
//     "Agregá al menos una opción" (banner al fondo que crecía y empujaba todo hacia arriba).
//
// Cubre los DOS fixes de presentación:
//   FIX 1 — LAYOUT ROBUSTO: header fijo + cuerpo scroll flex:1 + footer fijo → el título queda SIEMPRE completo,
//           con contenido largo Y con el error visible.
//   FIX 2 — ERROR A NIVEL DE CAMPO: al tocar "Crear" inválido (enum_multi, 0 opciones) → se scrollea al editor
//           de Opciones, se le pone borde terracota y el mensaje va INLINE en ese campo (no un banner al fondo
//           que tape el título). Limpieza al editar.
//
// Web TÁCTIL fiel (memoria reference_rn_web_pitfalls): hasTouch + isMobile. Capturas a 360 y 412 →
// tests/modo-maniobra/customfield-*. El cleanup borra el establishment (cascada) en afterAll.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

test.use({ hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

/** Captura a 412 y 360 (web táctil). El viewport ya viene mobile+touch de la fixture. */
async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-412.png`) });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-360.png`) });
  await page.setViewportSize({ width: 412, height: 915 });
}

/** El TÍTULO está COMPLETO (no recortado contra el tope del sheet): su top ≥ el top del sheet (con holgura). */
async function expectTitleNotClipped(page: Page): Promise<void> {
  const sheet = page.getByTestId('custom-field-sheet');
  const title = sheet.getByText('Nueva maniobra', { exact: true });
  await expect(title).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  const titleBox = await title.boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  // El título NO se sale por arriba del sheet: su borde superior está DENTRO del sheet (−1px de tolerancia
  // por el antialias del layout). Antes del fix, el título quedaba por encima del tope → titleBox.y < sheetBox.y.
  expect(titleBox!.y).toBeGreaterThanOrEqual(sheetBox!.y - 1);
  // Y entra COMPLETO en alto (no recortado a media línea): un título $7 tiene ≥20px de alto visible.
  expect(titleBox!.height).toBeGreaterThan(18);
}

/**
 * ORÁCULO DE GEOMETRÍA del auto-scroll (corazón del fix-loop scroll-360): tras tocar "Crear" inválido, el
 * input del campo de Opciones (`custom-field-option-input`) Y su mensaje inline (`custom-field-options-error`)
 * tienen que quedar COMPLETOS dentro del viewport visible de la ScrollView (no below-the-fold). Esto es MÁS
 * ESTRICTO que `toBeInViewport()` (que pasa con visibilidad parcial / contra el viewport del browser, no contra
 * el ScrollView): acá comparamos los bounding boxes REALES contra el rect del propio ScrollView (`custom-field-
 * scroll`). Antes del fix, a 360 el input + el mensaje caían por DEBAJO del fondo del ScrollView.
 */
async function expectInvalidFieldFullyInScrollViewport(page: Page): Promise<void> {
  const scroll = page.getByTestId('custom-field-scroll');
  const input = page.getByTestId('custom-field-option-input');
  const inlineError = page.getByTestId('custom-field-options-error');
  await expect(scroll).toBeVisible();
  await expect(input).toBeVisible();
  await expect(inlineError).toBeVisible();

  const scrollBox = await scroll.boundingBox();
  const inputBox = await input.boundingBox();
  const errorBox = await inlineError.boundingBox();
  expect(scrollBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(errorBox).not.toBeNull();

  const viewportTop = scrollBox!.y;
  const viewportBottom = scrollBox!.y + scrollBox!.height;
  // El INPUT entero (top y bottom) cae dentro del viewport del ScrollView (1px de tolerancia por antialias).
  expect(inputBox!.y).toBeGreaterThanOrEqual(viewportTop - 1);
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(viewportBottom + 1);
  // Y el MENSAJE inline (que va DEBAJO del input, es lo que quedaba abajo del fold a 360) también entra entero.
  expect(errorBox!.y).toBeGreaterThanOrEqual(viewportTop - 1);
  expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(viewportBottom + 1);
}

test('crear maniobra custom: título completo en reposo + error a nivel de campo (no banner que tape el título)', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await createTestUser('m5cf-valid');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Custom Validación');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Wizard → elegir rodeo → etapa 2 (lista de maniobras, donde vive el `+` de maniobra custom).
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByText('Elegí las maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Abrir el `+` de maniobra personalizada → arranca DIRECTO en el form (sin clasificación, R13.7).
  const plus = page.getByTestId('maneuver-add-custom');
  await plus.scrollIntoViewIfNeeded();
  await expect(plus).toBeVisible({ timeout: 15_000 });
  await plus.click();
  await expect(page.getByTestId('custom-field-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Nueva maniobra', { exact: true })).toBeVisible();

  // ── REPOSO: el título "Nueva maniobra" está COMPLETO (no recortado contra el tope). ──
  await expectTitleNotClipped(page);
  await shot(page, 'customfield-reposo');

  // ── REPRODUCIR EL ERROR A 360 (el ancho del fix-loop): es el viewport ANGOSTO donde el contenido es más
  //    alto (el texto wrapea más) y el auto-scroll se quedaba corto → el input + el mensaje caían below-the-fold.
  //    Forzamos 360 ANTES de tocar "Crear" para que el auto-scroll corra a ESE ancho y el oráculo lo valide ahí. ──
  await page.setViewportSize({ width: 360, height: 800 });

  // Caso exacto de Raf: nombre cargado + enum_multi + 0 opciones → Crear.
  await page.getByTestId('custom-field-label').fill('Hallazgos de pezuña');
  await page.getByTestId('type-enum_multi').click();
  await expect(page.getByTestId('custom-field-option-input')).toBeVisible();
  // SIN agregar ninguna opción, tocar Crear → debe disparar el error de "Agregá al menos una opción".
  await page.getByRole('button', { name: 'Crear', exact: true }).click();

  // (a) El mensaje INLINE aparece JUSTO en el editor de Opciones (no un banner al fondo) y es VISIBLE en
  //     pantalla (el auto-scroll lo trajo a la vista — el usuario sabe exactamente qué completar).
  const optionsError = page.getByTestId('custom-field-options-error');
  await expect(optionsError).toBeVisible({ timeout: 5_000 });
  await expect(optionsError).toHaveText('Agregá al menos una opción.');
  await expect(optionsError).toBeInViewport();

  // (b) El editor de Opciones está RESALTADO (existe el contenedor con borde de alerta).
  await expect(page.getByTestId('custom-field-options-editor')).toBeVisible();

  // (c) El TÍTULO SIGUE COMPLETO con el error visible (era el corazón del bug: el error lo empujaba/recortaba).
  await expectTitleNotClipped(page);

  // (d) ORÁCULO DE GEOMETRÍA (fix-loop scroll-360): a 360 el input inválido + su borde terracota + el mensaje
  //     inline quedan COMPLETOS dentro del viewport del ScrollView (no below-the-fold). Esto era lo que fallaba.
  await expectInvalidFieldFullyInScrollViewport(page);

  // Captura a 360 (con el error reproducido y scrolleado a la vista) + a 412 (sin re-scrollear: a 412 entra
  //     entero de una). El shot() vuelve a 412 al final.
  await page.screenshot({ path: path.join(OUT_DIR, 'customfield-error-360.png') });
  // ── A 412: el contenido entra entero y el input + mensaje siguen visibles (no se rompió el caso ancho). ──
  await page.setViewportSize({ width: 412, height: 915 });
  // Re-disparamos el scroll a 412 (re-tocar "Crear" con el error ya presente recalcula con la geometría 412).
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(optionsError).toBeVisible();
  await expectInvalidFieldFullyInScrollViewport(page);
  await expectTitleNotClipped(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'customfield-error-412.png') });

  // ── LIMPIEZA: editar el campo (agregar una opción) borra el error inline. ──
  await page.getByTestId('custom-field-option-input').fill('grietas');
  await expect(page.getByTestId('custom-field-options-error')).toHaveCount(0);
  await page.getByTestId('custom-field-add-option').click();
  await expect(page.getByTestId('option-chip-grietas')).toBeVisible();
  // El título sigue intacto tras todo el round-trip.
  await expectTitleNotClipped(page);
});
