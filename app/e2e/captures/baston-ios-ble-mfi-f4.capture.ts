// e2e/captures/baston-ios-ble-mfi-f4.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5,
// ADR-029) de la **Fase F4** del delta `ios-ble-mfi` (spec 04): selección, prioridad por plataforma y el
// driver del emulador.
//
// ── QUÉ SE PUEDE VETAR EN WEB Y QUÉ NO, DICHO ANTES DE MOSTRAR NADA (RBM9.7) ────────────────────────
// La UI que F4 toca vive en `/baston`, y la mayor parte de sus ramas nuevas **no existen en web por
// construcción**, no por olvido:
//
//   · Las instrucciones de **`ble-gatt`** y de **`mfi`** salen del `transportKind` del binding, y ese
//     binding lo calcula `selectReaderBinding` con `Platform.OS`. En web la prioridad es `['serial']` y
//     `adapterForTransport('ble-gatt','web')` devuelve `null` **a propósito** (RBM5.2, fail-closed: no hay
//     `react-native-ble-plx` en web). O sea: para fotografiar esas dos cards habría que mockear
//     `Platform.OS` o inyectar un binding falso — cambiar producción para poder sacarle una foto.
//     → Cubiertas por `connection-view.test.ts` (copy, ícono, precedencia por `unavailableReason`, y que
//       ninguna prometa un paso que el adapter no tiene) y por las capturas **de device** de F6/T6.6.
//     Es el mismo precedente que fijaron `T-MV.7.2` y `baston-spp-bloqueantes.capture.ts`.
//   · El estado **"Buscando el bastón…" / "Buscar de nuevo"** (el override de copy de BLE) necesita el
//     mismo binding `ble-gatt`. → mismo veredicto, mismos tests.
//
// Lo que SÍ es fotografiable en web —y es lo que este archivo entrega— son las dos cosas que F4 cambió en
// una superficie que web renderiza:
//
//   1. **La MUDANZA del copy de instrucciones** del JSX a la vista pura (`transportInstructionsView`).
//      La rama `serial` es la que web usa, y su texto tiene que quedar IDÉNTICO: si la mudanza rompió el
//      layout (nota simple vs. card con ícono), se ve acá.
//   2. **El CTA «Olvidar el bastón guardado» FUERA de la rama SPP** (fix de la autorrevisión de F4). Antes
//      vivía adentro de `{isSpp ? …}`; desde RBM5.6 el registro del bastón recordado decide **qué
//      transporte se monta**, así que esconderlo detrás del transporte era una trampa que se cierra sola
//      (un teléfono que conectó por BLE monta `ble-gatt` para siempre → `isSpp` false → el único botón que
//      borra esa preferencia queda invisible). Acá se lo ve renderizado en el camino **no-SPP**, que es
//      exactamente lo que en web se puede demostrar: se siembra el registro en `localStorage` con el
//      **formato NUEVO** (`{deviceId, adapterKind}`, RBM5.6) y la pantalla lo reconoce.
//
// Las capturas van a __shots__/baston-ios-ble-mfi-f4/:
//   01 — `/baston` completa SIN bastón guardado: la referencia (no hay CTA de olvidar → sin afordancia
//        muerta en la primera instalación).
//   02 — banda de la sección «Dispositivos»: fila del bastón + la instrucción del transporte `serial`
//        (el copy mudado a la vista pura, para vetar que no cambió).
//   03 — `/baston` completa CON el bastón guardado (formato nuevo): aparece el CTA de olvidar.
//   04 — banda del CTA «Olvidar el bastón guardado» en el camino NO-SPP (el fix), con la fila y la
//        instrucción arriba para ver que no se pisan.
//
// Viewport mobile 412×915 (lo hereda de playwright.config). NO corre en `pnpm e2e` (es un `.capture.ts`):
//   pnpm exec playwright test e2e/captures/baston-ios-ble-mfi-f4.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect } from '../helpers/fixtures';
import type { Page, Locator } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-ios-ble-mfi-f4');

/** La clave de storage del bastón recordado. NO se renombra nunca (auditoría de `rafq.*`, `e0a32ad`). */
const REMEMBERED_KEY = 'rafq.ble.remembered_device';

/** El copy de la instrucción del transporte `serial` (el que web usa), mudado a la vista pura en F4. */
const SERIAL_INSTRUCTION = /elegí el puerto COM del RS420 en el diálogo del navegador/;

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Banda vertical entre dos elementos (aísla un componente en vez de repetir la pantalla entera). */
async function shotBand(page: Page, name: string, topLoc: Locator, bottomLoc: Locator, pad = 16): Promise<void> {
  await page.waitForTimeout(200);
  const top = await topLoc.boundingBox();
  const bottom = await bottomLoc.boundingBox();
  if (!top || !bottom) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
    return;
  }
  const y = Math.max(0, top.y - pad);
  const height = Math.min(915 - y, bottom.y + bottom.height + pad - y);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), clip: { x: 0, y, width: 412, height } });
}

/** Las DOS marcas del bastón (E2E + DEMO) ANTES del bundle → isDemoMode() true → simulador. */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__MITROPERO_BLE_E2E__ = true;
    w.__MITROPERO_BLE_DEMO__ = true;
  });
}

test('capturas F4: instrucción del transporte + el CTA de olvidar fuera de la rama SPP @ 412px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    const user = await createTestUser('cap-f4-seleccion');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Seleccion F4');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    await page.goto('/baston');
    await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
    const row = page.getByTestId('stick-device-row');
    await expect(row).toBeVisible({ timeout: 20_000 });

    // ── REGRESIÓN del fix-loop 🟠-2: la banda de "otros transportes" NO existe en web ──────────────────
    // F4-b agrega filas para los transportes ALTERNATIVOS que la plataforma puede montar (en Android: el
    // BLE debajo de los emparejados; en Android con BLE montado: el RS420). En web tiene que ser **vacía**
    // por construcción —el único transporte de web es el montado— y esa es la razón por la que esta banda
    // no se puede fotografiar acá (su veto visual es de device, T6.6). Lo que sí se puede demostrar en web
    // es que **no se filtró**: UNA sola fila en toda la pantalla. Si mañana una fila de más aparece en web,
    // este oráculo cae antes que cualquier captura — y con él se protegen las ~70 specs E2E.
    await expect(row).toHaveCount(1);

    // (01) SIN bastón guardado: la referencia. El CTA de olvidar NO está — la aserción va ANTES del shot
    // para que una captura no pueda mentir sobre la afordancia muerta de la primera instalación.
    await expect(page.getByTestId('stick-forget-cta')).toHaveCount(0);
    await shot(page, '01-sin-baston-guardado');

    // (02) La instrucción del transporte, que en web es la de `serial`: el copy que F4 mudó del JSX a la
    // vista pura. Se asierra el texto (no solo que exista algo) porque lo que hay que vetar es que la
    // mudanza no lo cambió ni lo convirtió en una card con ícono.
    const instruccion = page.getByText(SERIAL_INSTRUCTION);
    await expect(instruccion).toBeVisible();
    await shotBand(page, '02-devices-instruccion-serial', page.getByTestId('stick-devices-section'), instruccion);

    // ── Ahora CON bastón guardado, en el FORMATO NUEVO de RBM5.6 ──────────────────────────────────────
    // Se siembra el registro y se recarga: `readRememberedDevice()` lo parsea (`parseRememberedValue`) y
    // la pantalla enciende el CTA. El `adapterKind` que se guarda es el de web (`web-serial`) porque es el
    // único usable en esta plataforma — `honorsPreference` descartaría cualquier otro (fail-closed), y una
    // captura no puede depender de un valor que producción ignora.
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [REMEMBERED_KEY, JSON.stringify({ deviceId: 'AA:BB:CC:DD:EE:01', adapterKind: 'web-serial' })] as const,
    );
    await page.reload();
    await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });

    // (03) La pantalla entera con el CTA nuevo visible en el camino NO-SPP (el fix de F4).
    const forget = page.getByTestId('stick-forget-cta');
    await expect(forget).toBeVisible({ timeout: 20_000 });
    await forget.scrollIntoViewIfNeeded();
    await shot(page, '03-con-baston-guardado');

    // (04) La banda: fila + instrucción + CTA, para ver que el botón nuevo no se pisa con nada y que el
    // texto del botón entra completo a 412 px (tiene una 'j' en "guardado"… y una 'g': descendentes).
    await shotBand(page, '04-cta-olvidar-fuera-de-spp', page.getByTestId('stick-devices-section'), forget);
  } finally {
    await ctx.close();
  }
});
