// e2e/baston-chip.spec.ts — red de regresión del CHIP DE CONEXIÓN del bastón (spec 09 chunk BLE global,
// RB8) frente al bugfix 2026-07-29.
//
// EL BUG (reporte de Raf en device Android): *"el botón de conectar bastón en android no me está
// funcionando"*. En native NO hay adapter de transporte construido (`react-native-ble-plx` no está
// instalado; `selectTransportAdapter` devuelve 'manual' → `instantiateTransport` devuelve null), así que
// el chip del header decía "Conectar bastón" y su tap llamaba `transport?.connect()` sobre `null`: un
// no-op silencioso. Peor: contradecía a su propia pantalla (`maniobra/identificar`), que dos elementos
// más abajo dice "El bastón no está disponible en este dispositivo".
//
// EL FIX: sin transporte instanciado, el chip NO EXISTE. La condición es "no hay transporte", NO "es
// Android" → cuando la Fase 4 construya el adapter SPP, el chip vuelve solo.
//
// CÓMO SE REPRODUCE EN WEB (sin device): el provider de la raíz acepta `mode='manual'` bajo la marca
// SECUNDARIA `__MITROPERO_BLE_E2E_MANUAL__` (app/_layout.tsx → isBleE2EManual). Ese modo existe justo para
// esto: `instantiateTransport('manual')` devuelve null, o sea EXACTAMENTE el estado del Android de hoy.
// Con solo `__MITROPERO_BLE_E2E__` el provider monta el MockAdapter → transporte presente (paridad con web
// real, donde el web-serial siempre existe).
//
// ORÁCULOS (los dos lados, para que el test no pueda pasar por la razón equivocada):
//   - SIN transporte  → `ble-connection-chip` con count 0 Y ningún texto de estado del chip visible.
//   - CON transporte  → el MISMO testID visible con el label 'Conectar bastón', y tras conectar el mock,
//     'Bastón conectado'. Si el fix ocultara el chip de más (regresión en web), este test lo caza.

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
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

/** Arranca la app con el MockAdapter montado (transporte PRESENTE, como el web-serial de web real). */
async function gotoWithTransport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
  });
  await page.goto('/');
}

/** Arranca la app en modo 'manual': provider SIN transporte (el estado del Android de hoy). */
async function gotoWithoutTransport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) SIN TRANSPORTE → el chip NO existe (el bug de Raf, reproducido en web con mode='manual').
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) RB8: SIN transporte, el header de Animales NO ofrece "Conectar bastón" (el chip no existe)', async ({
  page,
}) => {
  const user = await createTestUser('chipnt');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo ChipNT');

  await gotoWithoutTransport(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // La pantalla YA está montada: `gotoAnimales` espera por el buscador permanente de la tab. El chip
  // vivía en la fila del título, al lado de "Animales" — o sea que si estuviera, ya estaría en el DOM.
  // ORÁCULO 1 (estructural): el testID EXCLUSIVO del chip no está montado.
  await expect(page.getByTestId('ble-connection-chip')).toHaveCount(0);
  // ORÁCULO 2 (de copy): ninguno de los labels del chip aparece — ni el CTA muerto ni otro estado.
  await expect(page.getByText('Conectar bastón', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Bastón conectado', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Bastón desconectado', { exact: true })).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) CON TRANSPORTE → el chip sigue EXACTAMENTE como antes (web no se toca). Es el contrafáctico de (a):
//     sin esto, ocultar el chip SIEMPRE también pasaría el test (a) y rompería web en silencio.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) RB8.1/RB8.3: CON transporte, el chip está y refleja el estado (off → conectado)', async ({
  page,
}) => {
  const user = await createTestUser('chipct');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo ChipCT');

  await gotoWithTransport(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Estado 'off' con transporte → el chip existe y ofrece conectar (RB8.3, el atajo de web-serial).
  const chip = page.getByTestId('ble-connection-chip');
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Conectar bastón', { exact: true })).toBeVisible();

  // Conectar el mock → el chip refleja el cambio de estado (RB8.2): el chip informa de verdad.
  await page.evaluate(() => {
    const h = (window as unknown as { __mitroperoBle?: { connectMock: () => void } }).__mitroperoBle;
    if (!h) throw new Error('window.__mitroperoBle no está disponible (¿se montó el BleE2EBridge?)');
    h.connectMock();
  });
  await expect(page.getByText('Bastón conectado', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(chip).toBeVisible();
});
