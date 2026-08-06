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
//   07 — indicador GLOBAL del chrome (RMV3.5) sobre el tab "Más" (pantalla CON header y CON bottom-nav),
//        con la conexión VIVA: el pill anclado abajo, por encima del nav y del pico del FAB, sin pisar nada.
//   08 — la NUEVA fila de acceso "Bastón" en el tab "Más" (RMV3.1), en reposo ("Sin conectar"): pantalla
//        completa, para vetar la UBICACIÓN de la sección (después de Perfil, antes de "Campo activo").
//   09 — la misma fila con el estado EN VIVO ("Conectado"): el trailing informa sin entrar a la pantalla.
//   10 — la misma fila SIN TRANSPORTE ("No disponible"): la decisión de NO ocultarla + el único estado del
//        trailing con descendente ('p') que se puede montar a voluntad (veto del recorte g/q/p/j/y).
//        Va en un test aparte de este archivo: necesita otra marca global, y las marcas van pre-bundle.
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
// ── EL SHOT 07 VOLVIÓ (2026-08-05, unidad «acceso in-app a la pantalla del bastón») ─────────────────────
// Se había caído porque la única navegación client-side que salía de /baston con la conexión viva era el
// "Dar de alta" del overlay — o sea, existía solo gracias al bug que BENCH-3 cerró; y /baston se alcanzaba
// SOLO por deep-link (la fila de "Más" nunca se había cableado), así que no tenía back-stack in-app y
// cualquier `goto` remontaba el provider y apagaba la conexión. Ahora "Más" TIENE la fila: esta captura
// entra por ahí (navegación client-side real) y vuelve por el chevron del header (`backOr`), con la
// conexión en pie → el pill del chrome se puede fotografiar sobre una pantalla que sí lo muestra.
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
import { signIn, waitForHome, gotoTab } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** a11y label de la fila "Bastón" del tab "Más" (el estado en vivo va dentro del nombre accesible). */
const STICK_ROW_NAME = /^Bastón: .+ Abrí la pantalla de conexión del bastón$/;

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

    // (08) La NUEVA fila de acceso del tab "Más" (RMV3.1) en reposo. Pantalla COMPLETA a propósito: lo que
    // hay que vetar acá es la UBICACIÓN de la sección "Dispositivos" (después de la card de Perfil, antes
    // del bloque "Campo activo" — el bastón es del teléfono, no del campo) además de la fila en sí. El
    // título dice "Dispositivos" desde el 2026-08-06 (antes "Bastón", que con una sola fila homónima era
    // una tautología y no agrupaba nada).
    const stickRow = page.getByRole('button', { name: STICK_ROW_NAME });
    await gotoTab(page, 'Más', stickRow);
    await expect(page.getByText('Sin conectar', { exact: true })).toBeVisible();
    await shot(page, '08-mas-fila-baston');

    // Aterrizar en la pantalla de conexión POR LA FILA (navegación client-side real, no deep-link): es el
    // camino del operario y el que preserva el provider raíz (y con él la conexión) al volver.
    await stickRow.click();
    await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
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

    // ── Volver a "Más" CON LA CONEXIÓN VIVA (chevron del header = `backOr`; llegamos por push, así que
    // ejercita `router.back()`). El provider vive en la raíz → la conexión sobrevive a la navegación
    // client-side. Esto es lo que devuelve el shot 07 después de que la fila existe.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(stickRow).toBeVisible({ timeout: 20_000 });

    // (07) Indicador GLOBAL del chrome (RMV3.5) sobre una pantalla CON header y CON bottom-nav: el pill
    // anclado abajo, por encima del nav y del pico del FAB central, sin pisar el título "Más".
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 10_000 });
    await shot(page, '07-indicador-global-chrome');

    // (09) La fila con el estado EN VIVO: "Conectado" en el trailing (el valor de la fila es enterarse sin
    // entrar). Banda del componente, para el veto de la fila en sí.
    await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
    await shotBand(page, '09-fila-mas-baston-conectado', page.getByText('Dispositivos', { exact: true }), stickRow);

    // Volver a la pantalla por la fila (la conexión sigue viva) para el estado desconectado.
    await stickRow.click();
    await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 20_000 });

    // (05) Estado DESCONECTADO de la CARD: tras "Desconectar" → "Bastón desconectado" + CTA "Volver a conectar"
    // (la pantalla queda LIMPIA, sin el pill del indicador global encima — suprimido en /baston).
    await page.getByTestId('stick-status-cta').scrollIntoViewIfNeeded();
    await page.getByTestId('stick-status-cta').click();
    await expect(page.getByText('Bastón desconectado', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Volver a conectar', exact: true })).toBeVisible();
    await shot(page, '05-estado-desconectado');

  } finally {
    await ctx.close();
  }
});

// ── (10) La fila SIN TRANSPORTE — contexto aparte (necesita otra marca global, pre-bundle) ─────────────
// Dos motivos para que este shot exista:
//   1. Es una DECISIÓN de diseño que el leader tiene que poder vetar: sin transporte la fila NO se oculta
//      (a diferencia del chip global, que sí). Es el único camino in-app a la pantalla, y esa pantalla es
//      la que explica la salida manual — ocultarla la volvería indescubrible justo donde más se necesita.
//   2. Es el único estado del trailing con DESCENDENTE ("No disponible", la 'p') que se puede montar a
//      voluntad. El bug de clase recurrente de este repo es el recorte de g/q/p/j/y en un `Text` con
//      `numberOfLines` cuyo `lineHeight` no matchea el `fontSize`; sin este shot, el veto visual se haría
//      contra "Sin conectar"/"Conectado", que no tienen ninguno y no probarían nada.
test('captura de la fila del bastón SIN transporte (decisión: no se oculta) @ 412px', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  // `__RAFAQ_BLE_E2E_MANUAL__` → provider en mode='manual' → `instantiateTransport` devuelve null:
  // exactamente el estado de un iOS / dev build sin el módulo nativo.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__RAFAQ_BLE_E2E_MANUAL__ = true;
  });

  try {
    const user = await createTestUser('cap-baston-nt');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Baston NT');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    const stickRow = page.getByRole('button', { name: STICK_ROW_NAME });
    await gotoTab(page, 'Más', stickRow);
    await expect(page.getByText('No disponible', { exact: true })).toBeVisible();
    await shotBand(page, '10-fila-mas-baston-sin-transporte', page.getByText('Dispositivos', { exact: true }), stickRow);
  } finally {
    await ctx.close();
  }
});
