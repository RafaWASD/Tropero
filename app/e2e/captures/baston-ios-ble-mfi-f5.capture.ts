// e2e/captures/baston-ios-ble-mfi-f5.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5,
// ADR-029) de la **Fase F5** del delta `ios-ble-mfi` (spec 04): `adapter-mfi-ios` prearmado y gateado.
//
// ── LO PRIMERO, PORQUE CAMBIA CÓMO SE LEE ESTE ARCHIVO: F5 NO AGREGA NINGUNA SUPERFICIE NUEVA ───────
// F5 escribe un TRANSPORTE, no una pantalla. De `StickConnectionScreen.tsx` toca exactamente dos
// constantes (`BUILT_ADAPTERS` += `'mfi-ios'` y su probe en `TRANSPORT_INSTALLABLE`), y las dos ramas de
// copy de MFi —la del Accessory Picker y la de "falta la autorización del fabricante"— **ya existían
// desde F4** y están cubiertas por `connection-view.test.ts` con bindings sintéticos.
//
// Y hay una razón más fuerte por la que no hay foto nueva que sacar, en NINGUNA plataforma: hoy **ningún
// lector del registro declara el transporte `mfi`** (RBM4.6 prohíbe inventar la `protocolString` del
// fabricante), así que la fila de un bastón MFi no existe ni en un iPhone. El día que llegue la cadena
// aparece sin código nuevo (RBM4.7), y ESE día su veto visual es de device (T6.6/RBM9.7 — en web el
// binding es `serial` y no hay `mfi`).
//
// ── ENTONCES QUÉ ENTREGA ESTE ARCHIVO: EL ORÁCULO DE QUE F5 NO ROMPIÓ NADA VISIBLE ──────────────────
// Declarar `mfi-ios` construido y **sacarlo de `NOT_SELECTABLE_AS_PREFERENCE`** son cambios en el motor
// que decide QUÉ se renderiza. Los dos mundos malos son visibles en web y valen una foto:
//
//   1. **Una fila fantasma.** Si el kind nuevo produjera una fila en la banda de "otros transportes"
//      —donde el bug de F4-b puso DOS filas idénticas en `mock`—, la pantalla ofrecería tocar un
//      transporte que web no puede montar. El oráculo es el mismo que cazó aquel bug:
//      `toHaveCount(1)`, aserrado ANTES de cada captura.
//   2. **Una preferencia de STORAGE que le saca el transporte al operario.** Hasta F4, `'mfi-ios'` estaba
//      vetado por lista. Desde F5 lo único que lo frena fuera de iOS es la tabla de plataforma
//      (`isAdapterUsableOn`, derivada de `adapterForTransport`). Así que se SIEMBRA un registro con
//      `adapterKind:'mfi-ios'` en `localStorage` y se exige que la pantalla siga entera y funcional
//      (fail-closed → cae al piso de web). Es un escenario nuevo que F4 no podía tener.
//
// Las capturas van a __shots__/baston-ios-ble-mfi-f5/:
//   01 — `/baston` completa, build de hoy: la referencia (una sola fila, cero rastro de MFi).
//   02 — banda de «Dispositivos»: fila + instrucción del transporte `serial`, intactas.
//   03 — `/baston` con un bastón recordado del formato nuevo pero con `adapterKind:'mfi-ios'`: la
//        pantalla NO se degrada (fail-closed a `web-serial`) y el CTA de olvidar está a mano.
//   04 — banda del CTA «Olvidar el bastón guardado» en ese estado (la salida del operario si la
//        preferencia quedó apuntando a un transporte que este teléfono no tiene).
//
// Viewport mobile 412×915 (lo hereda de playwright.config). NO corre en `pnpm e2e` (es un `.capture.ts`):
//   pnpm exec playwright test e2e/captures/baston-ios-ble-mfi-f5.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect } from '../helpers/fixtures';
import type { Page, Locator } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-ios-ble-mfi-f5');

/** La clave de storage del bastón recordado. NO se renombra nunca (auditoría de `rafq.*`, `e0a32ad`). */
const REMEMBERED_KEY = 'rafq.ble.remembered_device';

/** El copy de la instrucción del transporte `serial`, que es el que web usa. Tiene que quedar INTACTO. */
const SERIAL_INSTRUCTION = /elegí el puerto COM del RS420 en el diálogo del navegador/;

/** Fragmentos del copy de MFi (F4). Ninguno puede aparecer en web: acá no hay transporte `mfi`. */
const MFI_COPY = [/autorización del fabricante para iPhone/i, /Accessory/i];

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

test('capturas F5: `/baston` no cambió con el transporte MFi construido (y una preferencia mfi-ios no la degrada) @ 412px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    const user = await createTestUser('cap-f5-mfi');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo MFi F5');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    await page.goto('/baston');
    await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
    const row = page.getByTestId('stick-device-row');
    await expect(row).toBeVisible({ timeout: 20_000 });

    // ── EL ORÁCULO Nº1: NI UNA FILA DE MÁS ────────────────────────────────────────────────────────────
    // Va ANTES de la captura porque una foto no puede desmentir un conteo. Es el mismo oráculo que cazó el
    // bug de F4-b (dos filas idénticas en `mock`), y acá vigila que declarar `mfi-ios` construido no haya
    // fabricado una fila para un transporte que web no puede montar.
    await expect(row).toHaveCount(1);
    for (const copy of MFI_COPY) {
      await expect(page.getByText(copy)).toHaveCount(0);
    }

    // (01) La referencia: `/baston` con el build de hoy. Sin bastón guardado no hay CTA de olvidar.
    await expect(page.getByTestId('stick-forget-cta')).toHaveCount(0);
    await shot(page, '01-baston-build-de-hoy');

    // (02) La instrucción del transporte de web, intacta (lo que F5 no tiene que haber tocado).
    const instruccion = page.getByText(SERIAL_INSTRUCTION);
    await expect(instruccion).toBeVisible();
    await shotBand(page, '02-devices-instruccion-serial', page.getByTestId('stick-devices-section'), instruccion);

    // ── EL ORÁCULO Nº2: UNA PREFERENCIA `mfi-ios` EN UN TELÉFONO QUE NO ES UN iPhone ──────────────────
    // Antes de F5 esto lo frenaba una LISTA (`NOT_SELECTABLE_AS_PREFERENCE`); ahora lo frena la tabla de
    // plataforma. El mundo malo si esa tabla fallara: `selectTransportAdapter` devuelve `'mfi-ios'`,
    // `instantiateTransport` no lo puede montar en web y el operario queda **sin transporte, en silencio**
    // — con la pantalla mostrando una sección de dispositivos vacía y sin explicación. Se siembra el valor
    // a mano (es exactamente lo que un backup restaurado de otro teléfono produce) y se exige que la
    // pantalla siga entera.
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [REMEMBERED_KEY, JSON.stringify({ deviceId: 'SER-A-000123', adapterKind: 'mfi-ios' })] as const,
    );
    await page.reload();
    await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('stick-device-row')).toHaveCount(1);
    // El copy sigue siendo el de `serial`: se cayó al piso por plataforma, no al transporte imposible.
    await expect(page.getByText(SERIAL_INSTRUCTION)).toBeVisible();
    for (const copy of MFI_COPY) {
      await expect(page.getByText(copy)).toHaveCount(0);
    }

    // (03) La pantalla entera en ese estado, con el CTA de olvidar disponible: es la salida del operario si
    // la preferencia quedó apuntando a un transporte que este teléfono no tiene (R6.6 fuera de toda rama).
    const forget = page.getByTestId('stick-forget-cta');
    await expect(forget).toBeVisible({ timeout: 20_000 });
    await forget.scrollIntoViewIfNeeded();
    await shot(page, '03-preferencia-mfi-ios-en-web');

    // (04) La banda del CTA: que el botón no se pise con nada y que su texto entre completo a 412 px
    // (tiene descendentes: la 'g' y la 'j' de "guardado").
    await shotBand(page, '04-cta-olvidar-con-preferencia-mfi', page.getByTestId('stick-devices-section'), forget);
  } finally {
    await ctx.close();
  }
});
