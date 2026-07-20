// e2e/captures/baston-multivendor.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del delta «multivendor» de spec 04: la PANTALLA DE CONEXIÓN del bastón (StickConnectionScreen, en "Más")
// + el camino de DEMO por simulador (lee tags "en vivo" sin bastón físico).
//
// Recorre el flujo del feature y saca capturas NOMBRADAS de cada estado clave a __shots__/baston-multivendor/:
//   01 — pantalla de conexión cargada: indicador de estado (off) + fila del device (RS420 reconocido en web) +
//        salida manual (no bloqueante).
//   02 — DemoControls visible ("Modo demo" + "Simular lectura"), montado SOLO bajo isDemoMode() (triple-guard).
//   03 — lectura DEMO en la confirmación de la pantalla: el read-row con el EID + el badge "DEMO" (RMV4.6).
//   04 — find-or-create disparado por la lectura demo: el overlay global con el EID leído (confirmación
//        pre-commit, R2 del core) + "Animal nuevo" / "Dar de alta".
//   05 — estado DESCONECTADO de la CARD de la pantalla con CTA "Volver a conectar" (LIMPIA, sin pill encima).
//   06 — estado CONECTADO de la CARD de la pantalla ("Bastón conectado" + CTA "Desconectar"). En /baston el
//        indicador GLOBAL del chrome se SUPRIME (redundante con la card + evita pisar el título del header).
//   07 — DEMOSTRACIÓN de RMV3.5: el indicador GLOBAL del chrome en una pantalla CON HEADER (el alta de
//        animal, alcanzada con conexión VIVA vía "Dar de alta"), flotando en su posición nueva (anclado
//        ABAJO) SIN pisar el título del header. Ver nota de navegación en el paso (07) más abajo.
//
// N/A (RMV3.7/3.8) — device 'available:false' / 'no reconocido': en web el RS420 resuelve a
// 'recognized-available' (binding {web-serial, serial, available:true}); no hay camino de UI para montar esos
// estados sin mockear Platform.OS o inyectar un device sintético. Son mapeos PUROS cubiertos por
// `connection-view.test.ts` (node:test, T-MV.4.6) → 07/08 quedan fuera de esta captura (documentado).
//
// La demo se activa con las DOS marcas globales (__RAFAQ_BLE_E2E__ + __RAFAQ_BLE_DEMO__) seteadas ANTES del
// bundle (addInitScript) → isDemoMode() true → mode='demo' (simulador). Viewport mobile 412×915 (contexto
// propio, mismo patrón que lotes-venta.capture.ts). NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo
// dispara el leader:
//   pnpm exec playwright test e2e/captures/baston-multivendor.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect } from '../helpers/fixtures';
import type { Page, Locator } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-multivendor');

/** Captura NOMBRADA tras un breve settle de layout (el llamador ya asertó visible el elemento clave). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * Captura una BANDA vertical (ancho completo del teléfono) entre dos elementos — un COMPONENTE puntual, no
 * la pantalla entera. La StickConnectionScreen entra completa en el viewport de 915px, así que un screenshot
 * full por componente saldría idéntico a los shots de estado; la banda hace 02/03 genuinamente distintos +
 * más útiles para el veto (aíslan el DemoControls y la lectura marcada DEMO). Fallback a full si falta un box.
 */
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

/** Setea las DOS marcas del bastón (E2E + DEMO) ANTES del bundle → isDemoMode() true → mode='demo' (simulador). */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__RAFAQ_BLE_DEMO__ = true;
  });
}

/**
 * Dispara la lectura simulada hasta que el find-or-create abre. Tras el reload a /baston el listener global
 * queda momentáneamente suspendido hasta que el rodeo activo re-resuelve (warm-up post-reload); reintentamos
 * el tap (cada emisión = EID fresco, sin colisión de dedup) hasta que el overlay aparece.
 */
async function triggerDemoRead(page: Page): Promise<void> {
  const overlay = page.getByTestId('find-or-create-overlay');
  await expect(page.getByTestId('demo-simulate')).toBeVisible();
  await expect(async () => {
    await page.getByTestId('demo-simulate').click();
    await expect(overlay).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
}

test('capturas pantalla de conexión + demo del bastón @ 412px', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    const user = await createTestUser('cap-baston-mv');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Baston Demo');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // Aterrizar en la pantalla de conexión (deep-link; la fila de "Más" no está cableada). El reload restaura
    // la sesión (persistSession en localStorage) → el gate no expulsa /baston (no es ruta de gating).
    await page.goto('/baston');
    await expect(page.getByText('Dispositivos', { exact: true })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 20_000 });

    // (01) Pantalla de conexión cargada: estado 'off' + RS420 reconocido + salida manual.
    await expect(page.getByText('Bastón sin conectar', { exact: true })).toBeVisible();
    await expect(page.getByText('Allflex RS420', { exact: true })).toBeVisible();
    await shot(page, '01-pantalla-conexion');

    // (02) DemoControls: "Modo demo" + "Simular lectura" (montado solo bajo isDemoMode()). Banda del componente.
    await expect(page.getByText('Modo demo', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Simular lectura', exact: true })).toBeVisible();
    await shotBand(page, '02-demo-controls', page.getByText('Modo demo', { exact: true }), page.getByTestId('demo-autoplay'));

    // Disparar la lectura simulada → conecta + emite un EID sintético por el contrato de ingesta.
    await triggerDemoRead(page);

    // (04) find-or-create disparado: overlay global con el EID leído (confirmación pre-commit) + "Dar de alta".
    await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible();
    await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible();
    await shot(page, '04-find-or-create');

    // Cerrar el overlay (X del header) para ver el estado de la pantalla de fondo.
    await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
    await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0, { timeout: 10_000 });

    // (06) Estado CONECTADO de la CARD de la pantalla: "Bastón conectado" + CTA "Desconectar". En /baston el
    // indicador GLOBAL del chrome se SUPRIME (redundante con esta card + evitar pisar el título) → ahora
    // "Bastón conectado" aparece UNA sola vez (la card). `.first()` sigue válido (una sola coincidencia).
    const connectedLabel = page.getByText('Bastón conectado', { exact: true }).first();
    await connectedLabel.scrollIntoViewIfNeeded();
    await expect(connectedLabel).toBeVisible({ timeout: 10_000 });
    await shot(page, '06-estado-conectado');

    // (03) Confirmación de la pantalla con la lectura marcada "DEMO" (read-row: EID + badge DEMO, RMV4.6).
    // Banda de la card "Lecturas" (header + el read-row con el EID + badge DEMO).
    const demoRow = page.getByLabel(/^Caravana \d{15} DEMO$/);
    await expect(demoRow).toBeVisible({ timeout: 10_000 });
    await shotBand(page, '03-lectura-demo-confirmacion', page.getByText(/Lecturas/).first(), demoRow);

    // (05) Estado DESCONECTADO de la CARD: tras "Desconectar" → "Bastón desconectado" + CTA "Volver a conectar"
    // (la pantalla queda LIMPIA, sin el pill del indicador global encima — suprimido en /baston).
    await page.getByTestId('stick-status-cta').scrollIntoViewIfNeeded();
    await page.getByTestId('stick-status-cta').click();
    await expect(page.getByText('Bastón desconectado', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Volver a conectar', exact: true })).toBeVisible();
    await shot(page, '05-estado-desconectado');

    // (07) DEMOSTRACIÓN de RMV3.5 — el indicador GLOBAL del chrome donde SÍ cumple su rol: una pantalla CON
    // header, con el pill anclado ABAJO (sobre la nav bar + el pico del FAB) SIN pisar el título de arriba.
    //
    // NAVEGACIÓN (por qué NO la home): con conexión VIVA la home es inalcanzable en E2E. La fila de "Más" a
    // /baston no está cableada, así que /baston se abre por DEEP-LINK (goto) → sin back-stack in-app →
    // `router.back()` del header es no-op; y una nav "cruda" por la History API REMONTA el provider raíz →
    // el status vuelve a 'off' y el indicador se auto-oculta (verificado). En cambio "Dar de alta" del
    // find-or-create hace un `router.push('/crear-animal')` REAL (client-side): el BleStickListenerProvider
    // NO se desmonta → la conexión 'connected' PERSISTE → el indicador se ve en el alta (pantalla con header).
    // Re-disparamos una lectura (demo-simulate reconecta + emite → status 'connected') y abrimos el alta.
    await triggerDemoRead(page);
    await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
    // Alta prefilleada (crear-animal): header con título + subtítulo "Creando: <EID>". El indicador global se
    // monta (pathname !== '/baston') con status 'connected' (!= 'off') → visible, anclado ABAJO, lejos del
    // título del header (arriba) → prueba visual de que ya no lo pisa.
    await expect(page.getByText(/^Creando:/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 15_000 });
    await shot(page, '07-indicador-global-chrome');
  } finally {
    await ctx.close();
  }
});
