// e2e/sheet-baja-teclado.spec.ts — ABRIR UN SHEET/OVERLAY BAJA EL TECLADO (bug 🔴 device Android, APK a3b8d804).
//
// ── EL BUG ──────────────────────────────────────────────────────────────────────────────────────────
// En `maniobra/identificar`, con el input de caravana ENFOCADO y el teclado ABIERTO, tocar la ‹ del header
// —que abre el `ExitJornadaSheet` para terminar o abandonar la jornada— dejaba el teclado arriba y del
// sheet solo asomaba una franja de ~25px: sus dos botones quedaban TAPADOS. Fix: abrir un overlay modal es
// SALIR del contexto de escritura → se descarta el teclado (`hooks/useDismissKeyboardOnOpen`, adoptado por
// los 22 archivos que dibujan un `$scrim`; lo sostiene el guard estático
// `src/components/sheet-keyboard-dismiss-guard.test.ts`).
//
// ── QUÉ NO PUEDE VERIFICAR ESTE SPEC (honestidad de cobertura, ADR-029) ─────────────────────────────
// **Que el IME baje** es veredicto de DEVICE: react-native-web no monta teclado virtual, así que en web no
// hay nada que tapar ni que bajar. Un test que dijera "el sheet ya no queda debajo del teclado" sería un
// falso verde. NO se escribe.
//
// ── EL ORÁCULO QUE SÍ DISCRIMINA, Y POR QUÉ ES ESTE Y NO OTRO ───────────────────────────────────────
// En web, `Keyboard.dismiss()` de react-native-web es `TextInputState.blurTextInput(currentlyFocusedField())`:
// **blurea el `<input>` del DOM enfocado**. O sea que el mecanismo SÍ deja una huella observable. Pero hay
// una trampa, y se descubrió FALSIFICANDO (la primera versión de este spec pasaba también SIN el fix):
//   · si el sheet lo abre un CLICK, el browser desenfoca el input igual (el mousedown cae sobre un div no
//     focusable) → el oráculo no distingue nada;
//   · si lo abre ENTER, tampoco: el `handleKeyDown` de RNW hace `blurOnSubmit` por default en single-line.
// El único disparador que NO toca el foco por su cuenta es el que NO viene del usuario: un **BASTONAZO**.
// El `FindOrCreateOverlay` es global y lo abre una lectura BLE inyectada por `window.__rafaqBle.tagRead()`.
// Sin el fix, el buscador de Animales sigue ENFOCADO con el overlay encima (que es exactamente el bug, en su
// versión más filosa: el overlay se abre solo, sobre cualquier pantalla). Con el fix, se desenfoca.
// **Falsificado**: sacando la llamada al hook, el test 1 cae; con la llamada, pasa.
//
// El test 2 cubre el modo de falla CONTRARIO, que es el más caro: que el descarte dispare DE MÁS. Si el
// efecto corriera en cada render en vez de en el flanco de apertura, un sheet con input propio cerraría su
// propio teclado en cada tecla y sería inusable en device; en web se ve como el input perdiendo el foco al
// tipear. **Falsificado** mutando el hook para que dispare siempre: el test 2 cae.
//
// El test 3 cubre la ÚNICA EXCEPCIÓN de la regla, que salió de la autorrevisión de este mismo fix:
// `SavePresetSheet` `autoFocus`ea su input (es el único del repo) y con el descarte puesto **perdía el
// foco** — en web el `commitMount` de React enfoca al hijo dentro del MISMO commit, o sea ANTES del efecto
// del padre, así que el `Keyboard.dismiss()` del shell llegaba después y lo blureaba. Un sheet que
// auto-enfoca no está SALIENDO del contexto de escritura sino ENTRANDO a uno → lo declara con
// `claimsKeyboard` (prop de `BottomSheetShell`) y el shell no descarta nada. **Falsificado**: con el fix y
// SIN la declaración este test cae; con la declaración pasa; y sin el fix también pasaba, o sea que mide
// la excepción y no el ambiente.
//
// El test 4 es el FLUJO EXACTO del reporte (‹ con el input cargado → ExitJornadaSheet). No prueba el
// descarte —ese sheet lo abre un click, ver arriba— y no lo pretende: verifica lo que sí es regresión web
// (el sheet abre con sus DOS acciones, no navega, y lo tipeado NO se pierde al bajar el teclado).

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** EID FDX-B válido (15 díg) único por corrida — mismo criterio que `baston.spec.ts`. */
let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Arranca la app con la marca de E2E del bastón ANTES del bundle → mode='mock' + handle en window. */
async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

/** Conecta el mock e inyecta un bastonazo (NO es un gesto del usuario: no toca el foco por su cuenta). */
async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } })
      .__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** ¿Este elemento es el `document.activeElement`? (el foco REAL del DOM, no una clase de estilo). */
function isFocused(page: Page, label: string): Promise<boolean> {
  return page.getByLabel(label, { exact: true }).evaluate((el) => el === document.activeElement);
}

function isFocusedByTestId(page: Page, testId: string): Promise<boolean> {
  return page.getByTestId(testId).evaluate((el) => el === document.activeElement);
}

test('(1) MECANISMO: un bastonazo abre el overlay global y DESENFOCA el buscador (nadie más lo desenfocaba)', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const user = await createTestUser('sheet-baja-teclado-ble');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baja Teclado BLE');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El operario está TIPEANDO en el buscador (en device: teclado ARRIBA).
  const BUSCADOR = 'Buscar animal por caravana o número';
  const buscador = page.getByLabel(BUSCADOR, { exact: true });
  await buscador.click();
  await buscador.fill('038');
  expect(await isFocused(page, BUSCADOR)).toBe(true);

  // BASTONAZO de un EID nuevo → el FindOrCreateOverlay se abre SOLO, sin ningún gesto sobre el DOM.
  await bastonazo(page, makeEid());
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });

  // EL ORÁCULO: el buscador quedó DESENFOCADO. Nada más pudo desenfocarlo (no hubo click ni Enter) → la
  // única explicación es el `Keyboard.dismiss()` del montaje del overlay. En device, eso es el IME bajando.
  await expect.poll(() => isFocused(page, BUSCADOR), { timeout: 5_000 }).toBe(false);

  // Y el overlay sigue siendo el de siempre: su CTA a la vista (lo que el teclado tapaba en device).
  await expect(page.getByRole('button', { name: 'Dar de alta', exact: true })).toBeVisible();
});

test('(2) NO-REGRESIÓN: un sheet con input PROPIO se sigue tipeando (el descarte es SOLO en el flanco)', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const user = await createTestUser('sheet-input-propio');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Input Propio');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });

  // Vacunación → su sheet de preconfig tiene un INPUT propio (el nombre de la vacuna). Monta
  // `BottomSheetShell`, o sea que llamó a `Keyboard.dismiss()` al abrirse.
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByTestId('selected-body-0').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });

  // El input tiene que quedar perfectamente usable: se enfoca, se tipea LETRA POR LETRA (cada tecla es un
  // re-render del sheet) y el foco SOBREVIVE. Eso es lo que se rompe si el efecto no es de flanco.
  const vacuna = page.getByTestId('maneuver-config-input');
  await vacuna.click();
  expect(await isFocusedByTestId(page, 'maneuver-config-input')).toBe(true);
  await vacuna.pressSequentially('Brucelosis', { delay: 20 });
  await expect(vacuna).toHaveValue('Brucelosis');
  expect(await isFocusedByTestId(page, 'maneuver-config-input')).toBe(true);

  // Y el dato llega a destino (el sheet sigue funcionando de punta a punta).
  await page
    .getByTestId('maneuver-config-sheet')
    .getByRole('button', { name: 'Listo', exact: true })
    .click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('selected-config-0')).toHaveText('Brucelosis');
});

test('(3) NO-REGRESIÓN del caso MÁS EXPUESTO: el `autoFocus` de "Guardar como rutina" SOBREVIVE al descarte', async ({
  page,
}) => {
  test.setTimeout(120_000);

  // ── POR QUÉ ESTE TEST ────────────────────────────────────────────────────────────────────────────
  // `SavePresetSheet` es el ÚNICO sheet del repo con `autoFocus`: abre el teclado AL MONTAR. O sea que es
  // exactamente el sheet donde "bajar el teclado al montar" podría pelearse con su propia intención. El
  // razonamiento dice que no se pisan (`Keyboard.dismiss()` con nada enfocado es `blurTextInput(null)`, un
  // no-op; y el autoFocus es un prop NATIVO que se aplica al montar la vista), pero eso es una LECTURA de
  // la fuente de RN — acá se EJECUTA, que es lo único que cuenta. Si el orden de efectos fuese al revés de
  // lo razonado, este test cae y el fix necesita otra forma para este sheet.
  const user = await createTestUser('sheet-autofocus');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo AutoFocus');

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

  // Abrir "Guardar como rutina" → su input tiene `autoFocus`.
  await page.getByRole('button', { name: 'Guardar como rutina', exact: true }).click();
  await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });

  // EL ORÁCULO: el input llegó (y se quedó) ENFOCADO pese al descarte del montaje.
  await expect.poll(() => isFocusedByTestId(page, 'save-preset-input'), { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(300); // deja pasar cualquier blur diferido
  expect(await isFocusedByTestId(page, 'save-preset-input')).toBe(true);

  // Y se puede tipear sin perder el foco (el sheet sigue siendo usable de punta a punta).
  await page.getByTestId('save-preset-input').pressSequentially('Rutina de otoño', { delay: 20 });
  await expect(page.getByTestId('save-preset-input')).toHaveValue('Rutina de otoño');
  expect(await isFocusedByTestId(page, 'save-preset-input')).toBe(true);
});

test('(4) EL FLUJO DEL REPORTE: ‹ con la caravana tipeada → ExitJornadaSheet con sus DOS acciones, sin perder el dato', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const user = await createTestUser('sheet-baja-teclado-exit');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baja Teclado Exit');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Jornada mínima (pesaje: sin preconfig obligatorio) → arrancar → identificación.
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });

  // EL ESTADO DEL REPORTE: entrada manual expandida, caravana a medio tipear (en device: teclado ARRIBA).
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  const input = page.getByTestId('manual-entry-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.fill('038');

  // LA ACCIÓN DEL REPORTE: la ‹ del header abre el ExitJornadaSheet…
  await page.getByRole('button', { name: 'Volver', exact: true }).first().click();
  const sheet = page.getByTestId('exit-jornada-sheet');
  await expect(sheet).toBeVisible({ timeout: 10_000 });

  // …con sus DOS acciones A LA VISTA. En device estas dos eran las que el teclado tapaba; en web el
  // oráculo es que existen y están visibles (la geometría contra el IME no es verificable acá).
  await expect(sheet.getByRole('button', { name: /Terminar jornada/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Salir sin terminar/ })).toBeVisible();

  // NO-REGRESIÓN: "Seguir en la jornada" cierra sin navegar (el oráculo de "seguimos acá" es un elemento
  // EXCLUSIVO de la identificación, no un texto del hero: con el manual expandido el hero va `compact`).
  await page.getByTestId('exit-jornada-seguir').click();
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });
  await expect(input).toBeVisible();
  // Y lo tipeado NO se perdió: bajar el teclado desenfoca, NO borra (dato de manga, no cosmética).
  await expect(input).toHaveValue('038');
});
