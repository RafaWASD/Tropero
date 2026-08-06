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
//   (b) LECTURA SIMULADA: tocar "Simular lectura" → la lectura entra UNA sola vez, en la lista en vivo de la
//       pantalla y marcada "DEMO" (confirmación pre-commit de esta pantalla), y el find-or-create global NO
//       se abre encima. (RMV4.2/4.6/4.8)
//   (c) ESTADOS de conexión con CTA: off → conectado → desconectado, con la carga manual disponible en cada
//       estado (no bloqueante). (RMV3.4/3.6)
//
// ── CAMBIO DE EXPECTATIVA 2026-07-30 (BENCH-3, `progress/bench_baston-spp-emulador.md` §4.5) ────────────
// (b) y (c) esperaban que un bastonazo en /baston abriera el `FindOrCreateOverlay` GLOBAL. Eso era el BUG:
// medido en device, cada lectura se consumía DOS VECES —entraba en la lista de Lecturas de la pantalla Y
// abría el sheet global tapándola—, rompiendo la invariante de "un solo consumidor efectivo" justo en la
// pantalla que `context-multivendor.md` §3 define como la cara de la demo a los fabricantes. Ahora la
// pantalla toma la PROPIEDAD EXCLUSIVA del bastón mientras está enfocada (scanner acotado, RCF.6) y el
// overlay se auto-suprime. Estos tests pasan a asertar la invariante NUEVA: la lectura entra una sola vez.
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
import { signIn, waitForHome, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * a11y label de la fila "Bastón" del tab "Más" (`mas.tsx`, sección "Bastón"). El estado va DENTRO del
 * nombre accesible (`Bastón: <estado>. Abrí…`), así que el matcher es una regex: la navegación no
 * depende del estado de conexión, que se asserta aparte con su texto exacto.
 */
const STICK_ROW_NAME = /^Bastón: .+ Abrí la pantalla de conexión del bastón$/;

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
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 20_000 });
}

/** Cierra el FindOrCreateOverlay por la X del header (2 controles "Cerrar": backdrop + X → .last() = X). */
async function closeOverlay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0, { timeout: 10_000 });
}

/** Fila de una lectura confirmada en la lista en vivo de /baston (aria-label del read-row). */
const DEMO_READ_ROW = /^Caravana \d{15} DEMO$/;

/**
 * Dispara una lectura simulada hasta que aparece en la LISTA EN VIVO de la pantalla (que es la
 * confirmación de esta pantalla desde BENCH-3: el overlay global ya no se abre acá).
 *
 * Se reintenta el tap porque tras el RELOAD a /baston (deep-link) los contextos están en warm-up
 * (PowerSync/rodeo) y una sola emisión puede caer en esa ventana. Cada emisión del simulador es un EID
 * sintético FRESCO (seq++), así que reintentar NO choca con la dedup.
 */
async function triggerDemoRead(page: Page): Promise<void> {
  await expect(page.getByTestId('demo-simulate')).toBeVisible();
  await expect(async () => {
    await page.getByTestId('demo-simulate').click();
    await expect(page.getByLabel(DEMO_READ_ROW).first()).toBeVisible({ timeout: 4_000 });
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

// ─── (b) Lectura simulada → UN SOLO consumidor: la lista de la pantalla, marcada DEMO ──────────────────────
test('(b) "Simular lectura" entra UNA sola vez: lista en vivo marcada DEMO, sin el sheet global encima', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('mv-lectura');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston Sim');

  await openBastonDemo(page, user);

  // El simulador emite un EID sintético VÁLIDO (isValidTag) por el MISMO contrato de ingesta (validate +
  // dedup + confirmación pre-commit) que un bastón real (RMV4.2).
  await triggerDemoRead(page);

  // CONFIRMACIÓN de esta pantalla (RMV4.8): la lista de lecturas en vivo muestra el EID leído, marcado
  // "DEMO" (RMV4.6, integridad SENASA) — el read-row tiene aria-label "Caravana <15 díg> DEMO" (el badge
  // visible + el EID). Nada se commitea desde acá.
  await expect(page.getByLabel(DEMO_READ_ROW).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^Lecturas \(\d+\)$/)).toBeVisible();

  // INVARIANTE (BENCH-3): un solo consumidor efectivo. El sheet global NO se abre encima de la pantalla
  // que es la cara de la demo. Se asserta por la AUSENCIA del testID EXCLUSIVO del overlay (no por la
  // ausencia de un texto: la pantalla de fondo sigue montada detrás de cualquier scrim).
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);

  // Y sigue sin abrirse un rato después (no es una carrera ganada por poco: el overlay está SUPRIMIDO).
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
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

  // Simular una lectura → el simulador conecta (status 'connected') + emite. Desde BENCH-3 la lectura queda
  // en la lista de ESTA pantalla y no hay ningún sheet que cerrar antes de leer el estado.
  await triggerDemoRead(page);

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

// ─── (e) RMV3.1: la pantalla es ALCANZABLE in-app desde "Más" (y el chevron vuelve) ────────────────────
// El bug que originó esta unidad: `/baston` estaba registrada pero SIN entrada in-app (solo deep-link).
// Raf abrió la app con el chip global ciclando "Conectando…" y no tuvo ninguna forma de llegar a la
// pantalla para cortarlo. Este test recorre la ruta REAL del operario, no un `page.goto('/baston')`.
test('(e) RMV3.1: la fila "Bastón" del tab "Más" navega a /baston, y el chevron vuelve a "Más"', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('mv-fila-mas');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston Fila');

  // Corrida E2E normal (mock): el transporte EXISTE, que es el caso del build de web/Android real.
  await markBleE2EOnly(page);
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  const row = page.getByRole('button', { name: STICK_ROW_NAME });
  await gotoTab(page, 'Más', row);
  await expect(row).toHaveCount(1);

  // El TRAILING informa el estado EN VIVO sin entrar (el valor de la fila). Con el mock montado y sin
  // conectar: "Sin conectar" — NO "No disponible" (que es el contrafáctico sin transporte, test (f)).
  await expect(page.getByText('Sin conectar', { exact: true })).toBeVisible();
  await expect(page.getByText('No disponible', { exact: true })).toHaveCount(0);

  await row.click();

  // ORÁCULO DEL DESTINO: anclas EXCLUSIVAS de /baston. NO se usa el título "Bastón" del header: el tab
  // "Más" queda MONTADO detrás del Stack y su fila también dice "Bastón" → strict-mode violation.
  await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stick-devices-section')).toBeVisible();
  await expect(page).toHaveURL(/\/baston$/);

  // Y la vuelta: el chevron del header usa `backOr(router, '/(tabs)/mas')`. Acá el stack SÍ tiene origen
  // (llegamos por push), así que se ejercita la rama `router.back()`; la rama del fallback la cubre
  // `nav.test.ts`. Sin esto, cablear la entrada dejaría al operario sin salida verificada.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stick-device-row')).toHaveCount(0);
});

// ─── (f) contrafáctico: SIN transporte la fila SIGUE (no se oculta) y dice la verdad ──────────────────
// Sin este lado, un trailing hardcodeado en "Sin conectar" pasaría (e). Y fija la decisión de diseño:
// la fila NO se gatea por transporte (a diferencia del chip global, que se auto-oculta) porque es el
// único camino in-app a la pantalla — que es justo la que explica la salida manual.
test('(f) RMV3.1: sin transporte la fila sigue en "Más", dice "No disponible" y navega igual', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('mv-fila-nt');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston FilaNT');

  // `__RAFAQ_BLE_E2E_MANUAL__` → provider en mode='manual' → `instantiateTransport` devuelve null:
  // EXACTAMENTE el estado de un iOS / dev build sin el módulo nativo (mismo shim que usa
  // `asignar-caravanas-sin-transporte.spec.ts`).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  const row = page.getByRole('button', { name: STICK_ROW_NAME });
  await gotoTab(page, 'Más', row);
  await expect(row).toHaveCount(1);

  await expect(page.getByText('No disponible', { exact: true })).toBeVisible();
  await expect(page.getByText('Sin conectar', { exact: true })).toHaveCount(0);

  // Y sigue llevando a la pantalla: sin transporte, esa pantalla es la que dice qué hacer en su lugar.
  await row.click();
  await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Bastón no disponible', { exact: true })).toBeVisible();
});
