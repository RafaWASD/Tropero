// e2e/captures/sheet-baja-teclado.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del fix 🔴 MANGA "abrir un sheet con el teclado abierto lo deja debajo del teclado" (Raf, device Android,
// APK a3b8d804): con el input de caravana enfocado, la ‹ de `maniobra/identificar` abría el
// `ExitJornadaSheet` DEBAJO del teclado — solo asomaba una franja de ~25px y sus dos botones ("Terminar
// jornada" / "Salir sin terminar") quedaban tapados.
//
// Fix: abrir un overlay modal es SALIR del contexto de escritura → se descarta el teclado
// (`hooks/useDismissKeyboardOnOpen`, adoptado por los 22 archivos que dibujan un `$scrim`; única excepción:
// `SavePresetSheet`, que `autoFocus`ea su input y lo declara con `claimsKeyboard`).
//
// ── QUÉ MUESTRAN ESTAS CAPTURAS Y QUÉ NO (honestidad, ADR-029) ──────────────────────────────────────
// react-native-web NO monta teclado virtual: **el bug en sí es estructuralmente invisible en web**. NINGUNA
// captura puede mostrar "el sheet ya no queda debajo del teclado" — eso es veredicto de DEVICE (Raf).
// Lo que estas capturas SÍ sirven para vetar es la otra mitad, que es la que el fix podría haber roto:
//   · que los sheets alcanzables desde la manga sigan dibujándose igual (nada se movió, nada se recortó);
//   · el estado de ALTO ÚTIL RECORTADO (412×420 ≈ lo que queda visible con el teclado abierto en un
//     teléfono): con el teclado bajado por el fix, ese estado ya no se da en device — se captura igual como
//     PEOR CASO geométrico, para ver que ni siquiera ahí el título se recorta ni los CTAs se van del fold.
// La verificación EJECUTABLE del mecanismo (que el descarte corre de verdad, y que NO corre de más) vive en
// `e2e/sheet-baja-teclado.spec.ts`, falsificada en las dos direcciones.
//
// Estados capturados:
//   01 — identificación con la entrada MANUAL expandida y la caravana a medio tipear (el estado del reporte:
//        en device, teclado ARRIBA)
//   02 — el ExitJornadaSheet abierto desde la ‹ con SUS DOS ACCIONES + "Seguir en la jornada" a la vista
//        (eran las que el teclado tapaba)
//   03 — ese mismo sheet con ALTO RECORTADO (412×420 ≈ teclado arriba): peor caso geométrico
//   04 — el overlay GLOBAL (FindOrCreateOverlay) abierto por un BASTONAZO sobre el buscador de Animales
//        (el disparador más filoso: aparece solo, sobre cualquier pantalla, sin que el usuario toque nada)
//   05 — sheet de preconfig de VACUNACIÓN recién abierto (sheet CON input propio: la no-regresión)
//   06 — ese sheet ya tipeado (el input propio sigue perfectamente usable después del descarte)
//   07 — "Guardar como rutina" (el ÚNICO sheet con `autoFocus`, declarado `claimsKeyboard`): su input nace
//        ENFOCADO — es la EXCEPCIÓN de la regla, el sheet que ENTRA al contexto de escritura en vez de salir
//
// NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/sheet-baja-teclado.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page, type Browser } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'sheet-baja-teclado');

/** Alto útil que queda con el teclado abierto en un teléfono (≈45% de la pantalla). */
const KEYBOARD_UP = { width: 412, height: 420 } as const;
const FULL = { width: 412, height: 915 } as const;

async function newMobilePage(browser: Browser, withBle = false): Promise<Page> {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { ...FULL } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  if (withBle) {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
    });
  }
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Captura el mismo estado con el alto RECORTADO (≈ teclado arriba) y vuelve al viewport pleno. */
async function shotKeyboardUp(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ ...KEYBOARD_UP });
  await page.waitForTimeout(300);
  await shot(page, name);
  await page.setViewportSize({ ...FULL });
  await page.waitForTimeout(300);
}

/** Arranca una jornada mínima (Pesaje) y aterriza en la identificación. */
async function startJornada(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('capturas: el flujo del reporte (‹ con la caravana tipeada → ExitJornadaSheet)', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);

  const user = await createTestUser('cap-baja-teclado-exit');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Captura Exit');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await startJornada(page);

  // 01 — el estado del reporte: entrada manual expandida, caravana a medio tipear.
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  const input = page.getByTestId('manual-entry-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.fill('038');
  await page.waitForTimeout(300);
  await shot(page, '01-identificar-caravana-tipeada');

  // 02 — la ‹ abre el ExitJornadaSheet: las DOS acciones + "Seguir en la jornada", a la vista.
  await page.getByRole('button', { name: 'Volver', exact: true }).first().click();
  const sheet = page.getByTestId('exit-jornada-sheet');
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(sheet.getByRole('button', { name: /Terminar jornada/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Salir sin terminar/ })).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '02-exit-jornada-sheet-dos-acciones');

  // 03 — peor caso geométrico: el mismo sheet con el alto recortado (≈ teclado arriba).
  await shotKeyboardUp(page, '03-exit-jornada-sheet-alto-recortado');

  await page.context().close();
});

test('capturas: el overlay GLOBAL abierto por un bastonazo sobre el buscador enfocado', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser, true);

  const user = await createTestUser('cap-baja-teclado-ble');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Captura BLE');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El operario tipea en el buscador (en device: teclado ARRIBA) y entra un bastonazo SOLO.
  const buscador = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await buscador.click();
  await buscador.fill('038');
  const eid = `982${String(Date.now()).slice(-9)}0001`.slice(0, 15).padEnd(15, '0');
  await page.evaluate((e) => {
    const h = (window as unknown as { __mitroperoBle?: { connectMock: () => void; tagRead: (x: string) => void } })
      .__mitroperoBle;
    h?.connectMock();
    h?.tagRead(e);
  }, eid);
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  await shot(page, '04-overlay-global-por-bastonazo');

  await page.context().close();
});

test('capturas: no-regresión de un sheet CON input propio (preconfig de vacunación)', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);

  const user = await createTestUser('cap-baja-teclado-input');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Captura Input');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByTestId('selected-body-0').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);

  // 05 — recién abierto (el descarte del teclado ya corrió: el sheet tiene que verse idéntico a siempre).
  await shot(page, '05-config-vacunacion-recien-abierto');

  // 06 — tipeado: el input PROPIO del sheet sigue perfectamente usable después del descarte.
  const vacuna = page.getByTestId('maneuver-config-input');
  await vacuna.click();
  await vacuna.pressSequentially('Brucelosis', { delay: 20 });
  await expect(vacuna).toHaveValue('Brucelosis');
  await page.waitForTimeout(300);
  await shot(page, '06-config-vacunacion-tipeado');

  await page.context().close();
});

test('capturas: la EXCEPCIÓN — "Guardar como rutina" (autoFocus) nace con el input enfocado', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);

  const user = await createTestUser('cap-baja-teclado-autofocus');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Captura AutoFocus');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible({ timeout: 20_000 });

  // 07 — el sheet con `autoFocus`: declara `claimsKeyboard`, así que el shell NO le descarta el teclado y su
  //      input nace ENFOCADO (borde de foco visible). Es la única excepción de la regla, y está lockeada por
  //      el guard + por `e2e/sheet-baja-teclado.spec.ts` test 3.
  await page.getByRole('button', { name: 'Guardar como rutina', exact: true }).click();
  await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => page.getByTestId('save-preset-input').evaluate((el) => el === document.activeElement), {
      timeout: 5_000,
    })
    .toBe(true);
  await page.waitForTimeout(300);
  await shot(page, '07-guardar-rutina-autofocus-enfocado');

  await page.context().close();
});
