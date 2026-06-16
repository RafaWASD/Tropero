// e2e/maniobra-config-sheet-race.spec.ts — REGRESIÓN del bug "el sheet de preconfig se abre y se cierra
// al instante" que Raf cazó en testing en vivo (web), spec 03 MODO MANIOBRAS, wizard etapa 2.
//
// ── CAUSA RAÍZ (confirmada con repro + logging diagnóstico, secuencia real observada) ──────────────────
// El cuerpo de la fila configurable abre el ManeuverConfigSheet vía un `Gesture.Tap()` de
// react-native-gesture-handler (ManeuverReorderList: bodyTap → runOnJS(onOpenConfig) → setConfigManeuver →
// el sheet monta un tick después). En WEB TÁCTIL, el navegador, tras el touchend, EMULA una secuencia de
// mouse (mousedown → mouseup → CLICK) y dispara ese `click` ~20ms después, RE-HIT-TESTEÁNDOLO contra lo que
// esté bajo el dedo en ese momento → para entonces el sheet YA montó y su SCRIM (un Pressable que cubre la
// pantalla con onPress=onClose) está justo ahí → el click huérfano cae sobre el scrim → onClose → el sheet
// se cierra a ~1ms. La secuencia OBSERVADA con logging:
//     [bodyTap onEnd success=true]  (abre el sheet)
//     [scrim onPress fired ~20ms después]  (el click huérfano emulado del touch → cerraría)
// En NATIVE el gesto consume el touch y no hay click emulado suelto → por eso SOLO se ve en web.
//
// ── POR QUÉ NINGÚN E2E LO CAZABA ANTES ─────────────────────────────────────────────────────────────────
// (1) El test del wizard usaba `locator.click()` (mouse sintético sobre el target ya resuelto, sin
//     re-hit-test del click contra el scrim) → el race no aparece. (2) Y corría en el project por defecto
//     (Desktop Chrome, `hasTouch: false`), que NO emula la secuencia touch→mouse→click que dispara el bug.
// La ÚNICA forma fiel de reproducirlo en Playwright es un context con `hasTouch: true` + `page.touchscreen.
// tap()` (touch real → el browser emite el click emulado hit-testeado al dispatch, igual que un dedo). Por
// eso este spec abre su PROPIO context táctil (el project default no lo tiene).
//
// ── FIX ────────────────────────────────────────────────────────────────────────────────────────────────
// El scrim del sheet ignora presses hasta estar "listo para descartar" (guard `readyToDismiss`, armado en
// el próximo frame vía doble requestAnimationFrame). El click huérfano del open (que llega dentro de esa
// ventana) NO cierra; un tap DELIBERADO posterior del usuario SÍ cierra (no rompe la salida por backdrop).
//
// Dos casos:
//   1) ABRIR con TAP TÁCTIL real → el sheet QUEDA abierto (no se auto-cierra) → se puede ESCRIBIR.
//   2) BACKDROP DELIBERADO → un tap táctil a propósito en el scrim (ya armado el guard) SÍ cierra el sheet.

import { test, expect, applyEnvShim, type Page } from './helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Lleva el wizard hasta etapa 2 con Vacunación elegida (fila #1, index 0). */
async function gotoStage2WithVacunacion(page: Page): Promise<void> {
  const fab = page.getByRole('button', { name: 'Abrir MODO MANIOBRAS', exact: true });
  await expect(fab).toBeVisible({ timeout: 30_000 });
  await fab.click();
  await page.getByRole('button', { name: 'Nueva jornada', exact: true }).click();
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // Vacunación es la única configurable ofrecida en cría por default (inseminación está OFF por gating).
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  // Su fila muestra el hint de configurable (R1.7).
  await expect(page.getByText('Tocá para elegir vacuna', { exact: true })).toBeVisible();
}

/** Tap TÁCTIL real (touchstart/touchend → click emulado por el browser) en el centro de un elemento. */
async function touchTap(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`sin boundingBox para ${testId}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Tap TÁCTIL real sobre un botón accesible por su nombre (no por testId). */
async function touchTapButton(page: Page, name: string): Promise<void> {
  const box = await page.getByRole('button', { name, exact: true }).first().boundingBox();
  if (!box) throw new Error(`sin boundingBox para el botón "${name}"`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Lleva el wizard hasta la ETAPA 3 (resumen) con una maniobra elegida. */
async function gotoStage3(page: Page): Promise<void> {
  await gotoStage2WithVacunacion(page);
  await touchTapButton(page, 'Continuar (1)');
  await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('el sheet de preconfig NO se auto-cierra al abrirlo con un tap táctil (click huérfano sobre el scrim)', async ({
  browser,
}) => {
  // Context TÁCTIL propio (el project default es Desktop Chrome sin touch → no reproduce el race).
  const ctx = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 412, height: 915 },
  });
  const page = await ctx.newPage();
  await applyEnvShim(page);

  try {
    const user = await createTestUser('config-sheet-race');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Config Race');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    await gotoStage2WithVacunacion(page);

    // ── CASO 1: ABRIR con TAP TÁCTIL → el sheet debe QUEDAR abierto (no auto-cerrarse) ──
    // Con el bug presente, el `click` emulado del touch cae sobre el scrim recién montado → onClose → el
    // sheet desaparece a ~1ms. Con el fix (guard readyToDismiss armado en el próximo frame), el scrim
    // ignora ESE primer click. El wait deja pasar el click huérfano (llega ~20ms tras el touchend) y el
    // siguiente assert verifica que el sheet SIGUE vivo: con el bug, este assert falla (count 0).
    await touchTap(page, 'selected-body-0');
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500); // > la ventana del click huérfano y del doble rAF
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible();
    // Y se puede ESCRIBIR (el sheet quedó interactivo, no se cerró).
    await page.getByTestId('maneuver-config-input').fill('Brucelosis');
    await expect(page.getByTestId('maneuver-config-input')).toHaveValue('Brucelosis');

    // ── CASO 2: el BACKDROP DELIBERADO SÍ cierra (no rompimos la salida por backdrop, R3/UX) ──
    // El guard ya está armado (pasaron >2 frames + 500ms). Un tap táctil a propósito en el scrim, en una
    // zona LIBRE de la parte alta de la pantalla (el sheet está anclado abajo), cierra el sheet.
    const box = await page.getByTestId('maneuver-config-scrim').boundingBox();
    if (!box) throw new Error('sin boundingBox para el scrim');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 12); // bien arriba, sobre el scrim libre
    await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
    // Cerramos por backdrop (no Guardar) → el preconfig NO se cargó → la fila sigue mostrando el hint.
    await expect(page.getByText('Tocá para elegir vacuna', { exact: true })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('el sheet de "Guardar como rutina" NO se auto-cierra al abrirlo con un tap táctil (R2.1, mismo race)', async ({
  browser,
}) => {
  // MISMA clase de bug que el sheet de preconfig: el SavePresetSheet se abre con un onPress; en web táctil
  // el click emulado del touch cae sobre el scrim recién montado y lo cerraría a ~1ms si no fuera por el
  // guard readyToDismissRef (doble rAF). Este test lo cierra con su propio context táctil.
  const ctx = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 412, height: 915 },
  });
  const page = await ctx.newPage();
  await applyEnvShim(page);

  try {
    const user = await createTestUser('save-preset-race');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Save Preset Race');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    await gotoStage3(page);

    // ── CASO 1: ABRIR con TAP TÁCTIL → el sheet de nombre debe QUEDAR abierto (no auto-cerrarse) ──
    await touchTapButton(page, 'Guardar como rutina');
    await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500); // > la ventana del click huérfano + el doble rAF
    await expect(page.getByTestId('save-preset-sheet')).toBeVisible();
    // Y se puede ESCRIBIR (el sheet quedó interactivo, no se cerró) — sin perder lo tipeado.
    await page.getByTestId('save-preset-input').fill('Tacto de otoño');
    await expect(page.getByTestId('save-preset-input')).toHaveValue('Tacto de otoño');

    // ── CASO 2: el BACKDROP DELIBERADO SÍ cierra (no rompimos la salida por backdrop) ──
    const box = await page.getByTestId('save-preset-scrim').boundingBox();
    if (!box) throw new Error('sin boundingBox para el scrim');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 12); // bien arriba, sobre el scrim libre
    await expect(page.getByTestId('save-preset-sheet')).toHaveCount(0, { timeout: 10_000 });
    // Cerramos por backdrop (no Guardar) → seguimos en la etapa 3 (no se guardó, no se navegó).
    await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
