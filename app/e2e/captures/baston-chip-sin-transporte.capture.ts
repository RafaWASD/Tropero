// e2e/captures/baston-chip-sin-transporte.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el bugfix
// del CHIP DE CONEXIÓN del bastón (spec 09 RB8 + spec 04 RMV3.4/3.7).
//
// EL BUG (reporte de Raf en device Android): *"el botón de conectar bastón en android no me está
// funcionando"*. En native NO hay adapter de transporte construido → el tap del chip llamaba
// `transport?.connect()` sobre `null`: un no-op silencioso. Y contradecía a su propia pantalla, que dos
// elementos más abajo dice "El bastón no está disponible en este dispositivo".
//
// EL FIX: sin transporte instanciado, el chip NO EXISTE (y `/baston` deja de ofrecer conectar).
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN vive en
// e2e/baston-chip.spec.ts.
//
// LAS DOS PASADAS SON EL PUNTO: el bug es "hay algo de más", así que una captura sola no dice nada (una
// pantalla sin chip se ve igual que una pantalla que nunca tuvo chip). Por eso se capturan las MISMAS 4
// superficies en las 2 condiciones, para leerlas en pareja:
//   PASADA A — SIN transporte (`mode='manual'`, marca __RAFAQ_BLE_E2E_MANUAL__): el Android de Raf.
//   PASADA B — CON transporte (`mode='mock'`): el estado de web, que NO se toca.
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/baston-chip-sin-transporte.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/baston-chip-sin-transporte/ (gitignoreado — ver app/.gitignore + ADR-029).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoTab } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-chip-sin-transporte');

/** La frase canónica de "sin bastón" (la MISMA que identificar / TagScanSheet / la masiva). */
const SIN_BASTON = 'El bastón no está disponible en este dispositivo';
/** El copy de la espera normal de un bastoneo en la asignación masiva. */
const ESPERANDO = 'Bastoneá para empezar';

test.afterAll(async () => {
  await cleanupAll();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * Recorte de la BANDA del header (top 190px, ancho completo). El chip vivía ahí arriba: en el screenshot
 * full de una pantalla de 915px es un detalle de 24px de alto, imposible de vetar de un vistazo. La banda
 * pone las dos condiciones lado a lado a escala legible.
 */
async function shotHeader(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    clip: { x: 0, y: 0, width: 412, height: 190 },
  });
}

/**
 * Recorre la ruta REAL del operario hasta la asignación masiva: tab "Más" → fila "Asignar caravanas en
 * masa". A propósito y no un `goto` directo: la fila es parte de lo que hay que vetar (la decisión fue NO
 * ocultarla), así que tiene que verse en la captura que sigue estando.
 */
async function gotoAsignarCaravanasDesdeMas(page: Page): Promise<void> {
  const row = page.getByRole('button', { name: 'Asignar caravanas electrónicas en masa con el bastón' });
  await gotoTab(page, 'Más', row);
  await row.click();
  await expect(page.getByText('Asignar caravanas', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Arranca la jornada de manga y aterriza en `maniobra/identificar` (la pantalla 🔴 del bug). */
async function startManiobra(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// PASADA A — SIN TRANSPORTE (el Android de Raf, reproducido en web con mode='manual').
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
test('captura A: SIN transporte — ninguna superficie ofrece ni pide el bastón', async ({ page }) => {
  test.setTimeout(240_000);

  const user = await createTestUser('capchipnt');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo CapChipNT');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── 01/02 — tab ANIMALES: el header ya NO trae el chip "Conectar bastón" (era chrome permanente en
  //            primera línea, informando de algo inusable en ese device). El título queda solo. ──
  await gotoAnimales(page);
  await expect(page.getByTestId('ble-connection-chip')).toHaveCount(0);
  await shotHeader(page, '01-animales-header-sin-chip');
  await shot(page, '02-animales-pantalla-sin-chip');

  // ── 11 — ASIGNAR CARAVANAS EN MASA (a 2 taps del tab "Más"): su ÚNICA entrada de datos es el bastón y
  //         no tiene carga manual, así que sin transporte no puede llegar jamás un tag. El vacío decía
  //         "Bastoneá para empezar / Pasá el bastón por la caravana del animal" — una pantalla muerta
  //         pidiendo lo único imposible. Ahora dice la verdad, con la MISMA frase que las otras
  //         superficies, y apunta a la salida real (la ficha del animal). La FILA de "Más" NO se ocultó:
  //         la funcionalidad existe y funciona con bastón; esconderla la volvería indescubrible.
  //         (Va acá, antes del `goto('/baston')`: esa ruta no tiene tab bar y `gotoTab` no tendría
  //         de dónde agarrarse.) ──
  await gotoAsignarCaravanasDesdeMas(page);
  await expect(page.getByText(SIN_BASTON, { exact: true })).toBeVisible();
  await shot(page, '11-masiva-sin-transporte-vacio-honesto');

  // ── 03 — PANTALLA /baston: la card de estado dice la verdad ("Bastón no disponible / Todavía no se
  //         conecta en este dispositivo") y NO ofrece CTA; la fila del RS420 tampoco es accionable.
  //         Antes decía "Bastón sin conectar / Conectá el bastón para leer caravanas…" (el CTA ya
  //         estaba oculto por el componente, pero el copy seguía prometiendo lo que no podía cumplir). ──
  await page.goto('/baston');
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('Bastón no disponible', { exact: true })).toBeVisible();
  await expect(page.getByTestId('stick-status-cta')).toHaveCount(0);
  await shot(page, '03-baston-sin-transporte-sin-cta');

  // ── 04/05 — MANIOBRA / IDENTIFICAR (🔴 manga): la contradicción, resuelta. Antes el header decía
  //            "Conectar bastón" y el hero, dos elementos más abajo, "El bastón no está disponible en
  //            este dispositivo". Ahora hay UN solo mensaje y la entrada manual es la tarea primaria.
  //            (Va al final de la pasada: arranca una jornada y deja una sesión activa.) ──
  await startManiobra(page);
  await expect(
    page.getByText('El bastón no está disponible en este dispositivo', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ble-connection-chip')).toHaveCount(0);
  await shotHeader(page, '04-identificar-header-sin-chip');
  await shot(page, '05-identificar-hero-manual-promovido');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// PASADA B — CON TRANSPORTE (web real / mock): TODO queda como antes. Es el contrafáctico: sin estas
// capturas, "ocultar el chip siempre" se vería idéntico a la pasada A y no habría cómo vetar la regresión.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
test('captura B: CON transporte — todo sigue igual (web no se toca)', async ({ page }) => {
  test.setTimeout(240_000);

  const user = await createTestUser('capchipct');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo CapChipCT');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── 06/07 — tab ANIMALES con transporte: el chip está y ofrece conectar (RB8.3, el atajo web-serial). ──
  await gotoAnimales(page);
  await expect(page.getByTestId('ble-connection-chip')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Conectar bastón', { exact: true })).toBeVisible();
  await shotHeader(page, '06-animales-header-con-chip');
  await shot(page, '07-animales-pantalla-con-chip');

  // ── 08 — el chip CONECTADO: informa de verdad (RB8.2), que es su razón de ser cuando hay transporte. ──
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge?)');
    h.connectMock();
  });
  await expect(page.getByText('Bastón conectado', { exact: true })).toBeVisible({ timeout: 10_000 });
  await shotHeader(page, '08-animales-header-chip-conectado');

  // ── 12 — ASIGNAR CARAVANAS EN MASA con transporte: el vacío queda EXACTAMENTE como antes ("Bastoneá
  //         para empezar"). Es el contrafáctico del shot 11: sin este par, "decir siempre que no hay
  //         bastón" se vería idéntico y no habría cómo vetar la regresión.
  //         (🔴-3, 2026-08-06: desde el barrido de edge cases el vacío ya no mira SOLO `hasTransport` —
  //         con transporte pero DESCONECTADO dice "El bastón no está conectado" + CTA. El mock quedó
  //         conectado en el shot 08, que es la precondición real de este copy; antes este shot lo
  //         aseveraba sobre un mock desconectado, o sea sobre el propio bug.) ──
  await gotoAsignarCaravanasDesdeMas(page);
  await expect(page.getByText(ESPERANDO, { exact: true })).toBeVisible();
  await shot(page, '12-masiva-con-transporte-vacio-original');

  // ── 09 — PANTALLA /baston con transporte: card "Bastón sin conectar" + CTA "Conectar bastón" + la fila
  //         del RS420 accionable ("Tocá para conectar"). Idéntico al baseline. (El goto recarga la SPA →
  //         el mock arranca desconectado, por eso el estado es 'off' y no 'connected'.) ──
  await page.goto('/baston');
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText('Bastón sin conectar', { exact: true })).toBeVisible();
  await expect(page.getByTestId('stick-status-cta')).toBeVisible();
  await shot(page, '09-baston-con-transporte-con-cta');

  // ── 10 — MANIOBRA / IDENTIFICAR con transporte: el header conserva el chip y el hero es el ConnectHero
  //         (disco = botón que conecta). Coherentes entre sí, como debe ser. ──
  await startManiobra(page);
  await expect(page.getByTestId('ble-connection-chip')).toBeVisible({ timeout: 30_000 });
  await shot(page, '10-identificar-con-chip');
});
