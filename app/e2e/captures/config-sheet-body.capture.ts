// e2e/captures/config-sheet-body.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del fix 🔴 MANGA (U5): el CUERPO del ManeuverConfigSheet (preconfig de tanda de vacunación) quedaba
// INVISIBLE en NATIVO (iOS, cazado por Raf con captura): solo se veían título + subtítulo + Guardar/Cancelar,
// pero NO el input para agregar vacunas → no se podían cargar vacunas → "Faltan vacunas" no se iba.
//
// CAUSA: el body era <ScrollView flex={1}> dentro de un YStack con maxHeight:85% SIN altura fija. Con
// contenido CORTO (vacunación: input + pocos chips) el padre se dimensiona por contenido y NO llega al cap →
// no hay espacio libre para el flexGrow:1 → en Yoga (nativo) el ScrollView colapsa a su basis:0% → altura 0.
// FIX: flexShrink={1} (grow:0, shrink:1, basis:auto) → corto = content-sized (el input SE VE); alto = el
// padre clampea al maxHeight y el ScrollView (shrink:1) se achica y scrollea con el footer siempre abajo.
//
// El bug es NATIVE-ONLY (web renderiza bien ANTES y DESPUÉS → por eso la E2E web no lo cazó). El veredicto
// es DEVICE (Raf). Estas capturas son WEB y muestran que el cuerpo (input + "Usadas antes" + chip cargado)
// se ve — el veto visual del leader confirma que el fix NO regresionó el layout web.
//
// Estados clave capturados:
//   01 — sheet ABIERTO VACÍO: título + subtítulo + INPUT grande visible + "Usadas antes" (Brucelosis/Aftosa)
//        + el CTA "Listo". Es el estado que estaba ROTO en nativo (cuerpo invisible).
//   02 — VACUNA CARGADA: chip "Brucelosis" agregado (con su ×), el input sigue visible, "Aftosa" sigue en
//        "Usadas antes". Prueba que el flujo de carga funciona con el cuerpo visible.
//
// NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/config-sheet-body.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page, type Browser } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedManeuverPreset,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'config-sheet-body');

async function newMobilePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  return page;
}

/** Lleva el wizard hasta la etapa 2 con Vacunación elegida (fila #1, index 0) y ABRE el sheet de preconfig. */
async function openVacunacionConfigSheet(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // Vacunación es configurable (multi) y está habilitada por default en cría → la elegimos (sube al tope).
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await expect(page.getByText('Faltan vacunas', { exact: true })).toBeVisible();
  // Abrimos el sheet de preconfig con .click() sintético (sin el race del click huérfano — ese vive en
  // maniobra-config-sheet-race.spec.ts con hasTouch + touchscreen.tap).
  await page.getByTestId('selected-body-0').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
}

test('capturas config sheet body (U5): sheet abierto con el input visible + vacuna cargada @ 412px', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-u5-config-body');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo U5 Config Body');
    // Dos presets con preconfig de vacunación → siembran el autocompletar (R1.8): "Brucelosis" y "Aftosa"
    // aparecen como "Usadas antes" en el sheet (estado clave del cuerpo, antes invisible en nativo).
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

    await openVacunacionConfigSheet(page);

    // ── 01) SHEET ABIERTO VACÍO — el estado que estaba ROTO en nativo (cuerpo invisible). ──
    // El INPUT grande debe verse (era lo que faltaba). El autocompletar ("Usadas antes") vive DENTRO del
    // cuerpo scrolleable → si se ve, el body no colapsó.
    await expect(page.getByTestId('maneuver-config-input')).toBeVisible();
    await expect(page.getByText('Usadas antes', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('config-suggestion-Brucelosis')).toBeVisible();
    await expect(page.getByTestId('config-suggestion-Aftosa')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '01-sheet-abierto-vacio.png') });

    // ── 02) VACUNA CARGADA — chip agregado, el input SIGUE visible. ──
    // Tocar la sugerencia "Brucelosis" la agrega como chip (multi); "Aftosa" sigue en "Usadas antes".
    await page.getByTestId('config-suggestion-Brucelosis').click();
    await expect(page.getByTestId('config-chip-Brucelosis')).toBeVisible();
    await expect(page.getByTestId('maneuver-config-input')).toBeVisible();
    await expect(page.getByTestId('config-suggestion-Aftosa')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '02-vacuna-cargada.png') });
  } finally {
    await page.context().close();
  }
});
