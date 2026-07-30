// e2e/captures/baston-multivendor.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del delta «multivendor» de spec 04: la PANTALLA DE CONEXIÓN del bastón (StickConnectionScreen, en "Más")
// + el camino de DEMO por simulador (lee tags "en vivo" sin bastón físico).
//
// Recorre el flujo del feature y saca capturas NOMBRADAS de cada estado clave a __shots__/baston-multivendor/:
//   01 — pantalla de conexión cargada: indicador de estado (off) + fila del device (RS420 reconocido en web) +
//        salida manual (no bloqueante).
//   02 — DemoControls visible ("Modo demo" + "Simular lectura"), montado SOLO bajo isDemoMode() (triple-guard).
//   03 — lectura DEMO en la confirmación de la pantalla: el read-row con el EID + el badge "DEMO" (RMV4.6).
//   04 — la pantalla DESPUÉS de la lectura, SIN ningún sheet encima (invariante de BENCH-3).
//   05 — estado DESCONECTADO de la CARD de la pantalla con CTA "Volver a conectar" (LIMPIA, sin pill encima).
//   06 — estado CONECTADO de la CARD de la pantalla ("Bastón conectado" + CTA "Desconectar"). En /baston el
//        indicador GLOBAL del chrome se SUPRIME (redundante con la card + evita pisar el título del header).
//
// ── DOS CAMBIOS 2026-07-30 (BENCH-3, `progress/bench_baston-spp-emulador.md` §4.5) ──────────────────────
// El shot 04 mostraba el `FindOrCreateOverlay` global abriéndose por un bastonazo EN /baston. Eso era el
// BUG, no la feature: la lectura se consumía DOS VECES (lista de la pantalla + sheet global tapándola),
// rompiendo "un solo consumidor efectivo" justo en la pantalla que `context-multivendor.md` §3 define como
// la cara de la demo a los fabricantes. Ahora la pantalla toma la propiedad exclusiva del bastón mientras
// está enfocada (scanner acotado, RCF.6) y el overlay se auto-suprime → el shot 04 pasa a documentar la
// invariante NUEVA. La prueba dedicada del arreglo (con su "y sigue sin abrirse") vive en
// `baston-spp-bloqueantes.capture.ts`.
//
// Y el shot 07 (indicador GLOBAL del chrome en una pantalla CON header, RMV3.5) se CAE de esta captura: la
// única navegación client-side que salía de /baston con la conexión viva era el "Dar de alta" de ese
// overlay — o sea, existía solo gracias al bug. /baston se alcanza por deep-link (la fila de "Más" no está
// cableada), así que no tiene back-stack in-app y cualquier `goto` remonta el provider y apaga la conexión.
// RMV3.5 sigue cubierto por sus tests (`connection-view.test.ts` + la spec E2E), pero su evidencia VISUAL
// vuelve cuando "Más" tenga la fila a /baston. Anotado en `docs/backlog.md`.
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

/** Fila de una lectura confirmada en la lista en vivo de /baston (aria-label del read-row). */
const DEMO_READ_ROW = /^Caravana \d{15} DEMO$/;

/**
 * Dispara la lectura simulada hasta que aparece en la LISTA EN VIVO de la pantalla (desde BENCH-3, esa es
 * la confirmación de /baston: el overlay global ya no se abre acá). Tras el reload a /baston los contextos
 * están en warm-up hasta que el rodeo activo re-resuelve; reintentamos el tap (cada emisión = EID fresco,
 * sin colisión de dedup).
 */
async function triggerDemoRead(page: Page): Promise<void> {
  await expect(page.getByTestId('demo-simulate')).toBeVisible();
  await expect(async () => {
    await page.getByTestId('demo-simulate').click();
    await expect(page.getByLabel(DEMO_READ_ROW).first()).toBeVisible({ timeout: 4_000 });
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

    // (04) La lectura entra UNA sola vez: la pantalla queda a la vista, sin ningún sheet encima (BENCH-3).
    // La aserción va ANTES del shot para que un regreso del bug rompa el test en vez de dejar una captura
    // mentirosa.
    await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
    await shot(page, '04-lectura-sin-sheet-encima');

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

    // (07) — CAÍDO desde el 2026-07-30 (BENCH-3). Mostraba el indicador GLOBAL del chrome (RMV3.5) en una
    // pantalla CON header: se llegaba al alta de animal con la conexión VIVA tocando "Dar de alta" en el
    // find-or-create que un bastonazo abría ACÁ. Esa era la única navegación client-side que salía de
    // /baston con la conexión en pie, y existía SOLO porque el overlay se abría encima de esta pantalla —
    // que es justo el bug que esta unidad cerró. /baston se alcanza por deep-link (la fila de "Más" no está
    // cableada), así que no tiene back-stack in-app: `router.back()` es no-op y cualquier `goto` remonta el
    // provider raíz → status 'off' → el indicador se auto-oculta.
    //
    // No se reemplaza por una captura peor: RMV3.5 sigue cubierto por `connection-view.test.ts` y por la
    // spec E2E, y su evidencia VISUAL vuelve el día que "Más" tenga la fila a /baston (una navegación
    // client-side real). Anotado en `docs/backlog.md`.
  } finally {
    await ctx.close();
  }
});
