// e2e/baston-multivendor.spec.ts — red de REGRESIÓN E2E de la PANTALLA DE CONEXIÓN + DEMO del bastón
// (spec 04, DELTA «multivendor», Gate 2.5 / ADR-029 · T-MV.7.2). Ejercita la StickConnectionScreen y el
// camino de DEMO por SIMULADOR contra el build web estático (:8099) + Supabase remoto + PowerSync — sin
// ningún bastón físico. NO toca código de producción (todos los testIDs/anclas ya existen en la UI).
//
// CÓMO SE ACTIVA LA DEMO (triple-guard, RMV4.3/4.4/4.5): seteamos ANTES del bundle (addInitScript) las DOS
// marcas globales `__RAFAQ_BLE_E2E__` + `__RAFAQ_BLE_DEMO__`. Con ambas, `isDemoMode()` es true (el gate
// permite el contexto E2E como "no-prod" vía isE2eDemoAllowed()) → `_layout.tsx` da precedencia `mode='demo'`
// al BleStickListenerProvider raíz → monta el `SimulatorAdapter` + los `DemoControls`. Una corrida E2E
// NORMAL (solo `__RAFAQ_BLE_E2E__`, SIN demo) sigue en `mock` — el test (d) lo prueba como regresión.
//
// Los casos:
//   (a) La StickConnectionScreen MONTA en /baston bajo demo: el RS420 sale RECONOCIDO en web + control de
//       simulación visible + carga MANUAL siempre disponible (no bloqueante). (RMV3.1/3.2/3.4/3.6/4.5)
//   (b) LECTURA SIMULADA: tocar "Simular lectura" → dispara el find-or-create global (confirmación pre-commit
//       del EID, R2 del core) Y marca la lectura "DEMO" en la lista de la pantalla. (RMV4.2/4.6/4.8)
//   (c) ESTADOS de conexión con CTA: off → conectado → desconectado, con la carga manual disponible en cada
//       estado (no bloqueante). (RMV3.4/3.6)
//   (d) REGRESIÓN: una corrida E2E NO-demo (solo __RAFAQ_BLE_E2E__ → mock) NO monta ni los DemoControls ni el
//       indicador global (isNonDemoE2E lo suprime) y el bridge mock sigue abriendo el overlay como HOY. Es la
//       prueba de que el elemento NUEVO del chrome (StickStatusIndicator) no perturba las ~70 specs E2E.
//
// Estados no alcanzables sin hardware/plataforma (RMV3.7/3.8): la pantalla resuelve el binding del RS420 en la
// PLATAFORMA REAL del build (web → {web-serial, serial, available:true} = 'recognized-available'). En web NO
// hay camino de UI para montar `available:false` (adapter reconocido pero no construido, ej. iOS-HID/SPP-sin-
// dev-build) ni 'unrecognized' (device sin driver) — eso exige mockear Platform.OS o inyectar un device
// sintético. Esos mapeos son PUROS y quedan cubiertos por `connection-view.test.ts` (node:test, T-MV.4.6);
// acá se documentan como N/A del E2E web y se ejercita el estado alcanzable (RS420 reconocido).
//
// Datos namespaced (RUN_TAG); cleanup en afterAll + global-teardown. Aserta SOLO sobre datos propios. El
// find-or-create dispara un LOOKUP local (read) del EID sintético; NUNCA commitea (no tocamos "Dar de alta"),
// así que no escribe en la DB compartida.

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
  type TestUser,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ─── EIDs FDX-B válidos (15 díg) para el bridge MOCK del test (d). Únicos por corrida (contador). ───
let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Setea las DOS marcas del bastón (E2E + DEMO) ANTES del bundle → isDemoMode() true → mode='demo' (simulador). */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__RAFAQ_BLE_DEMO__ = true;
  });
}

/** Setea SOLO la marca E2E (sin demo) → isDemoMode() false → mode='mock' (regresión del camino existente). */
async function markBleE2EOnly(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
}

/** Inyecta un bastonazo por el bridge MOCK (test (d)): el handle lo publica BleE2EBridge bajo el flag E2E. */
async function bastonazoMock(page: Page, eid: string): Promise<void> {
  await page.evaluate((e: string) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/**
 * Arranca en modo DEMO, loguea con un campo+rodeo sembrados y aterriza en la PANTALLA DE CONEXIÓN (/baston).
 * `waitForHome` garantiza que la sesión quedó persistida en localStorage ANTES del reload a /baston (el
 * cliente supabase-js persiste la sesión → el reload la restaura y el gate NO expulsa /baston, que no es una
 * ruta de gating/stranded). Ancla estable de la pantalla: la sección "Dispositivos" + la fila del device.
 */
async function openBastonDemo(page: Page, user: TestUser): Promise<void> {
  await markBleDemo(page);
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await page.goto('/baston');
  await expect(page.getByText('Dispositivos', { exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 20_000 });
}

/** Cierra el FindOrCreateOverlay por la X del header (2 controles "Cerrar": backdrop + X → .last() = X). */
async function closeOverlay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Dispara una lectura simulada hasta que el find-or-create abre. Tras el RELOAD a /baston (deep-link), el
 * listener GLOBAL queda momentáneamente suspendido: el `useBleStickListener` del FindOrCreateOverlay lo
 * re-habilita recién cuando el rodeo activo re-resuelve (warm-up de PowerSync/contextos post-reload). Una
 * sola emisión puede caer en esa ventana y el gate de escucha la descarta (status "conectado" pero sin
 * lectura). Reintentamos el tap — cada emisión del simulador es un EID sintético FRESCO (seq++), así que
 * reintentar NO choca con la dedup — hasta que el overlay aparece. `toPass` re-tapea SOLO mientras no haya
 * overlay (al abrir, el bloque pasa y no vuelve a tapear → el scrim nunca intercepta un re-tap).
 */
async function triggerDemoRead(page: Page): Promise<void> {
  const overlay = page.getByTestId('find-or-create-overlay');
  await expect(page.getByTestId('demo-simulate')).toBeVisible();
  await expect(async () => {
    await page.getByTestId('demo-simulate').click();
    await expect(overlay).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });
}

// ─── (a) La pantalla monta bajo demo: RS420 reconocido + control de simulación + manual no bloqueante ──────
test('(a) StickConnectionScreen monta en /baston bajo demo: RS420 reconocido + "Simular lectura" + manual disponible', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('mv-pantalla');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston MV');

  await openBastonDemo(page, user);

  // Estado inicial 'off' con CTA accionable (RMV3.4): "Bastón sin conectar" + "Conectar bastón".
  await expect(page.getByText('Bastón sin conectar', { exact: true })).toBeVisible();
  await expect(page.getByTestId('stick-status-cta')).toBeVisible();

  // Dispositivo RECONOCIDO en web (RMV3.2/3.7): el RS420 → binding {web-serial, serial, available:true} →
  // fila 'recognized-available' (título = displayName del driver + copy "Reconocido. Tocá para conectar.").
  await expect(page.getByText('Allflex RS420', { exact: true })).toBeVisible();
  await expect(page.getByText('Reconocido. Tocá para conectar.', { exact: true })).toBeVisible();

  // Control de simulación presente SOLO bajo demo (RMV4.5, triple-guard 3): "Modo demo" + "Simular lectura".
  await expect(page.getByText('Modo demo', { exact: true })).toBeVisible();
  await expect(page.getByTestId('demo-simulate')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simular lectura', exact: true })).toBeVisible();

  // Manual-first SIEMPRE disponible, no bloqueante (RMV3.6): la salida manual está a la vista.
  await expect(page.getByText(/Sin bast[oó]n/).first()).toBeVisible();
});

// ─── (b) Lectura simulada → find-or-create + marca DEMO en la confirmación pre-commit ──────────────────────
test('(b) "Simular lectura" dispara el find-or-create (confirmación pre-commit) y marca la lectura DEMO', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('mv-lectura');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston Sim');

  await openBastonDemo(page, user);

  // El simulador emite un EID sintético VÁLIDO (isValidTag) por el MISMO contrato de ingesta (validate +
  // dedup + confirmación pre-commit) que un bastón real (RMV4.2). El EID cae SIN match en ningún campo →
  // find-or-create modo CREATE (0 candidatos sin caravana → "Animal nuevo").
  await triggerDemoRead(page);

  // Find-or-create DISPARADO (RMV4.8): el overlay GLOBAL de spec 09 muestra el EID leído (confirmación
  // visual pre-commit, R2 del core) ANTES de commitear. No tocamos "Dar de alta" → no se escribe nada.
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible();
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dar de alta', exact: true })).toBeVisible();

  // Cerramos el overlay → la CONFIRMACIÓN de la pantalla (lista de lecturas en vivo) queda a la vista con la
  // lectura marcada "DEMO" (RMV4.6, integridad SENASA): el read-row tiene aria-label "Caravana <15 díg> DEMO"
  // (el badge visible + el EID). Es la marca honesta de que la lectura vino del simulador, no de un bastón real.
  await closeOverlay(page);
  await expect(page.getByLabel(/^Caravana \d{15} DEMO$/)).toBeVisible({ timeout: 10_000 });
});

// ─── (c) Estados de conexión con CTA (off → conectado → desconectado), manual disponible en cada uno ───────
test('(c) estados de conexión con CTA: off → conectado → desconectado; manual disponible siempre', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('mv-estados');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston Estados');

  await openBastonDemo(page, user);

  // Estado 'off': CTA "Conectar bastón". Manual disponible (no bloqueante, RMV3.6).
  await expect(page.getByText('Bastón sin conectar', { exact: true })).toBeVisible();
  await expect(page.getByText(/Sin bast[oó]n/).first()).toBeVisible();

  // Simular una lectura → el simulador conecta (status 'connected') + emite. Cerramos el overlay para leer
  // el estado de la pantalla de fondo.
  await triggerDemoRead(page);
  await closeOverlay(page);

  // Estado 'connected' (RMV3.4): "Bastón conectado" + CTA "Desconectar". El indicador GLOBAL del chrome
  // (RMV3.5) se SUPRIME en la PROPIA /baston (redundante con esta card + evita pisar el título del header,
  // Gate 2.5 / ADR-029) → count 0 acá aunque el status sea 'connected'. Su rol real (visible en pantallas
  // SIN card de estado, anclado abajo) se demuestra en la captura (shot 07, home). "Bastón conectado" aparece
  // una sola vez (la card) → `.first()` sigue válido. Manual sigue disponible (RMV3.6).
  await expect(page.getByText('Bastón conectado', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);
  await expect(page.getByText(/Sin bast[oó]n/).first()).toBeVisible();

  // CTA de estado en 'connected' = "Desconectar" (stick-status-cta) → status 'disconnected'.
  await page.getByTestId('stick-status-cta').click();
  await expect(page.getByText('Bastón desconectado', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Volver a conectar', exact: true })).toBeVisible();
});

// ─── (d) REGRESIÓN: E2E NO-demo (mock) no monta demo ni indicador global; el bridge mock sigue funcionando ──
test('(d) regresión: corrida E2E no-demo (mock) no monta DemoControls ni el indicador global; el mock sigue abriendo el overlay', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('mv-regresion');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston Reg');

  // SOLO la marca E2E (sin demo): isDemoMode() false → mode='mock' (comportamiento HOY de las ~70 specs).
  await markBleE2EOnly(page);
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // El bridge MOCK sigue abriendo el overlay como HOY (no lo rompió el delta): bastonazo de un EID nuevo →
  // find-or-create CREATE. Esto reproduce el camino de baston.spec.ts sin reescribirlo.
  await bastonazoMock(page, makeEid());
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible();

  // REGRESIÓN CLAVE: el indicador global del chrome (elemento NUEVO del delta) NO se monta en una corrida
  // E2E no-demo, aunque el mock haya conectado (status 'connected') — isNonDemoE2E() lo suprime para no
  // duplicar textos de estado que otras specs asertan { exact: true }. count 0 = no perturba la regresión.
  await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);

  // Y en la propia /baston (no-demo) NO hay controles de demo (triple-guard: DemoControls se auto-suprime sin
  // isDemoMode()), pero la fila del device sigue presente (la pantalla es funcional en cualquier build).
  await closeOverlay(page);
  await page.goto('/baston');
  await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('demo-simulate')).toHaveCount(0);
  await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);
});
