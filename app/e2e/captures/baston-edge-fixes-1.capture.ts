// e2e/captures/baston-edge-fixes-1.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para los dos 🔴 del
// barrido de edge cases del Bluetooth (2026-08-06): 🔴-2 (la lectura que vibra y no recibe nadie) y
// 🔴-3 (`asignar-caravanas` con el bastón desconectado = pozo mudo sin salida).
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). Las redes de regresión viven en
// e2e/asignar-caravanas-sin-transporte.spec.ts (🔴-3) y e2e/baston-lectura-sin-consumidor.spec.ts (🔴-2).
//
// QUÉ HAY QUE VETAR ACÁ. El 🔴-3 es un cambio de COPY + un CTA nuevo en un estado vacío 🔴 de manga, así
// que se captura el estado vacío en sus TRES condiciones, para leerlas en terna (una sola no dice nada:
// "decir siempre que hay un problema" se vería igual de bien que el fix):
//   · SIN transporte (iOS / build sin módulo nativo) → frase canónica + salida por la ficha, SIN CTA.
//   · CON transporte y DESCONECTADO (el Android con el bastón apagado / la cadena agotada) → el estado
//     NUEVO: dice qué pasa y trae el CTA. Es el que hay que mirar con más ganas.
//   · CON transporte y CONECTADO → "Bastoneá para empezar", el copy de siempre (regresión).
// Y la SALIDA se captura llegando: el CTA tiene que aterrizar en `/baston`.
//
// El 🔴-2 no tiene UI (su fix es la AUSENCIA de una confirmación falsa), así que se documenta con la
// pantalla donde ocurría: `maniobra/carga` después de un bastonazo. La captura muestra lo que el peón ve
// —nada cambia— que ahora es coherente con lo que el teléfono le dice —nada—. Antes, esa misma pantalla
// le VIBRABA "entró".
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/baston-edge-fixes-1.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/baston-edge-fixes-1/ (gitignoreado — ver app/.gitignore + ADR-029).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoTab } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-edge-fixes-1');

/** La frase canónica de "sin bastón" (la MISMA que identificar / TagScanSheet / la masiva). */
const SIN_BASTON = 'El bastón no está disponible en este dispositivo';
/** El copy de la espera normal de un bastoneo (solo válido con el bastón CONECTADO). */
const ESPERANDO = 'Bastoneá para empezar';
/** El título del estado NUEVO (🔴-3). */
const DESCONECTADO = 'El bastón no está conectado';
/** El CTA de salida del estado desconectado. */
const CTA_CONECTAR = 'Conectar el bastón';

test.afterAll(async () => {
  await cleanupAll();
});

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Recorre la ruta REAL del operario hasta la asignación masiva: tab "Más" → la fila. */
async function gotoAsignarCaravanasDesdeMas(page: Page): Promise<void> {
  const row = page.getByRole('button', { name: 'Asignar caravanas electrónicas en masa con el bastón' });
  await gotoTab(page, 'Más', row);
  await row.click();
  await expect(page.getByText('Asignar caravanas', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴-3 · Los TRES estados del vacío de la asignación masiva + la salida.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

test('capturas 🔴-3: el vacío de la masiva en sus tres estados + el CTA llegando a /baston', async ({
  page,
}) => {
  test.setTimeout(240_000);

  // ── (1) CON TRANSPORTE Y DESCONECTADO — el estado NUEVO, el que cierra el pozo mudo. El MockAdapter
  //        arranca desconectado, que es exactamente el Android con el bastón apagado. ──
  const userDc = await createTestUser('capedgedc');
  await setUserPhone(userDc.id, '1123456789');
  await seedEstablishmentWithRodeo(userDc.id, 'Campo EdgeDC');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, userDc);
  await waitForHome(page);

  await gotoAsignarCaravanasDesdeMas(page);
  await expect(page.getByText(DESCONECTADO, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: CTA_CONECTAR })).toBeVisible();
  await expect(page.getByText(ESPERANDO, { exact: true })).toHaveCount(0);
  await shot(page, '01-masiva-desconectado-con-salida');

  // ── (2) LA SALIDA LLEGA: el CTA aterriza en `/baston`, que es donde el problema SE PUEDE resolver.
  //        Un estado que describe el problema sin llevar a ningún lado sigue siendo un pozo. ──
  await page.getByRole('button', { name: CTA_CONECTAR }).click();
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 30_000 });
  await shot(page, '02-cta-aterriza-en-baston');

  // ── (3) CON TRANSPORTE Y CONECTADO — regresión: el copy de siempre, sin aviso y sin CTA.
  //        Se conecta el bastón EN `/baston` y se vuelve por el chevron del header. Es el viaje de ida y
  //        vuelta REAL que promete el CTA (el peón toca «Conectar el bastón», conecta, y vuelve a lo que
  //        estaba haciendo), y de paso ejercita el `backOr` de esa pantalla.
  //        ⚠️ NO se vuelve con `gotoTab(page, 'Más', …)`: `/baston` es una pantalla de **Stack** y NO
  //        tiene bottom tab bar, así que el `role="tab"` no existe ahí y el helper no encuentra nada.
  await page.evaluate(() => {
    const h = (window as unknown as { __mitroperoBle?: { connectMock: () => void } }).__mitroperoBle;
    if (!h) throw new Error('window.__mitroperoBle no está disponible (¿se montó el BleE2EBridge?)');
    h.connectMock();
  });
  // `.last()`: la pantalla de origen (`asignar-caravanas`) queda MONTADA detrás en el Stack y también
  // tiene su chevron "Volver" → hay dos en el DOM. El de arriba (el último) es el de `/baston`.
  await page.getByRole('button', { name: 'Volver', exact: true }).last().click();
  // Volvimos de verdad: la pantalla de conexión se desmontó y la masiva quedó al frente.
  await expect(page.getByTestId('stick-devices-section')).toHaveCount(0);
  await expect(page.getByText('Asignar caravanas', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(ESPERANDO, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: CTA_CONECTAR })).toHaveCount(0);
  await shot(page, '03-masiva-conectado-copy-de-siempre');

});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴-3 · (4) SIN TRANSPORTE — el estado del bugfix de julio, INTACTO: frase canónica, salida por la ficha
// y SIN CTA (no hay nada que conectar en ese dispositivo).
//
// Va en un test APARTE y no al final del anterior: la marca `__MITROPERO_BLE_E2E_MANUAL__` se tiene que poner
// ANTES del bundle, o sea que hace falta arrancar la app de cero con otra sesión. Reusar la misma `page`
// no alcanza — `context().clearCookies()` NO desloguea, porque el token de Supabase vive en
// `localStorage`, así que el `signIn` siguiente se quedaba esperando un campo "Email" que nunca aparece
// (la app seguía adentro con el usuario anterior). Un test nuevo trae page/contexto limpios.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

test('captura 🔴-3 (4): SIN transporte el vacío queda intacto (frase canónica, sin CTA)', async ({ page }) => {
  test.setTimeout(240_000);

  const userNt = await createTestUser('capedgent');
  await setUserPhone(userNt.id, '1123456789');
  await seedEstablishmentWithRodeo(userNt.id, 'Campo EdgeNT');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, userNt);
  await waitForHome(page);

  await gotoAsignarCaravanasDesdeMas(page);
  await expect(page.getByText(SIN_BASTON, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: CTA_CONECTAR })).toHaveCount(0);
  await shot(page, '04-masiva-sin-transporte-intacto');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴-2 · La pantalla donde la lectura vibraba sin llegar a nadie. El fix es una AUSENCIA (no hay UI
// nueva): la captura documenta el estado, y el veredicto de comportamiento lo da el .spec.ts con el
// contador de confirmaciones (`window.__mitroperoBeeps`).
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

test('captura 🔴-2: `maniobra/carga` — un bastonazo acá ya no confirma nada (no hay UI que lo reciba)', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const user = await createTestUser('capedgenc');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo EdgeNC');
  const eidA = makeEid();
  const eidB = makeEid();
  await seedAnimal(establishmentId, rodeoId, { tag: eidA, idv: '0501', sex: 'female', categoryCode: 'vaquillona' });
  await seedAnimal(establishmentId, rodeoId, { tag: eidB, idv: '0502', sex: 'female', categoryCode: 'vaquillona' });

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoAnimales(page);
  await expect(page.getByText('0501', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0502', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Jornada con una sola maniobra (pesaje) → identificar.
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-pesaje')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __mitroperoBle?: { connectMock: () => void } }).__mitroperoBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, '05-identificar-escuchando');

  // Bastonazo del animal A → la lectura SÍ la recibe alguien (identificar) → auto-avance a la carga.
  await page.evaluate((e) => {
    const h = (window as unknown as { __mitroperoBle?: { tagRead: (x: string) => void } }).__mitroperoBle;
    h?.tagRead(e);
  }, eidA);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, '06-carga-rapida-animal-en-el-cepo');

  // Bastonazo del animal B MIENTRAS se carga el peso de A — el ritmo real de la manga. Nadie consume esta
  // lectura: la pantalla no tiene listener propio y el overlay global está suprimido en `maniobra/*`.
  // Antes de este fix, acá el teléfono CONFIRMABA (vibración en device / beep en web).
  await page.evaluate((e) => {
    const h = (window as unknown as { __mitroperoBle?: { tagRead: (x: string) => void } }).__mitroperoBle;
    h?.tagRead(e);
  }, eidB);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible();
  await shot(page, '07-carga-tras-bastonazo-sin-consumidor');
});
