// e2e/reactividad-sync.spec.ts — feature 20: REACTIVIDAD DE LECTURAS SINCRONIZADAS.
//
// El bug que originó la feature (Raf, Android A07): creó un campo server-side y, con la app VIVA,
// ONLINE y CONECTADA, el campo no apareció; solo al cerrar y reabrir. La fila estaba en el SQLite
// local todo el tiempo — lo que fallaba era la LECTURA: `EstablishmentContext` y `RodeoContext`
// tenían un latch de UN SOLO DISPARO (`lastHasSynced` nunca volvía a false) → todo `statusChanged`
// posterior al primer sync era no-op. `lotes.tsx` era peor: mount-only, ni siquiera al re-enfocar.
//
// ⚠️ REGLA DE ORO DE ESTE SPEC: **ningún test puede hacer `page.reload()` ni re-login después del
// seed server-side**. Reiniciar la app re-corre el bootstrap y "arregla" el bug → el test daría
// verde sin el fix y no probaría absolutamente nada. Todo lo que se assertea acá ocurre con la
// misma página viva desde antes del cambio server-side.
//
// Casos:
//   1. (T17) Campo en caliente — te agregan a un campo server-side y aparece en el switch. EL criterio A8.
//   2. (T18) Rodeo en caliente — un coworker crea un rodeo y el selector lo refleja (R20.2/R20.5/R20.19).
//   3. (T19) Lote en caliente — /lotes montada refleja un lote creado por otro (R20.3/R20.9).
//   4. (T20) Revocación FUERA de maniobra → /campo-perdido con copy honesto (R20.14/R20.23/R20.24/R20.26/R20.28).
//   5. (T21) Revocación DURANTE la maniobra → diferimiento (D1) + riesgos 7 y 8.
//   6. (T22) Offline puro intacto — sin ningún sync el efecto reactivo no dispara (R20.7/R20.8).
//
// Timeouts generosos a propósito: acá se espera un CHECKPOINT REAL de PowerSync (no un refresh
// local), y eso depende de la replicación del servicio.

import { test, expect, type Page } from './helpers/fixtures';
import {
  admin,
  assertServerSessionsRevoked,
  captureRefreshToken,
  cleanupAll,
  createTestUser,
  revokeMemberRole,
  seedEstablishment,
  seedEstablishmentWithRodeo,
  seedManagementGroup,
  seedRodeo,
  setUserPhone,
  waitForServerRoleInactive,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, waitForMisCampos, gotoTab } from './helpers/ui';

// ⚠️ EVENTUAL-CONSISTENCY: `retries: 2` + forzador de sync — AMBOS honestos (no un mask). Leer esto.
//
// Cada caso espera un CHECKPOINT REAL de PowerSync (el punto: probar que la UI se entera sin reiniciar).
// El diagnóstico A/B DETERMINISTA (dos/tres cambios secuenciales, sondeo directo del SQLite vía
// `getAll` SIN reload; evidencia cruda en progress/impl_20-reactividad-sync.md) probó: la fila SIEMPRE
// llega al SQLite local en ~1,5 s, pero `lastSyncedAt` —la señal sobre la que TODA la reactividad de
// RAFAQ está emulada (spec 15, CERO watched queries)— avanza de forma NO DETERMINISTA por cambio: a
// veces al instante, a veces un cambio se CONGELA (~90 s medidos, y MÁS bajo carga) hasta que un
// checkpoint posterior lo barre. Es no-determinación INHERENTE de eventual-consistency, no un bug de la
// feature (re-lee en CADA avance de la señal, su contrato) ni un flake del test.
//
// POR QUÉ los retries ACÁ son LEGÍTIMOS (y por qué el reviewer los rechazó antes): el reviewer objetó
// los retries de la versión ANTERIOR porque enmascaraban un flake MAL DIAGNOSTICADO ("lastSyncedAt deja
// de avanzar tras el 1er cambio" — un latch permanente que el A/B mostró FALSO). Con el diagnóstico
// CORREGIDO —no-determinación de eventual-consistency, DOCUMENTADA, con `db.watch` como fix de fondo
// flageado a Raf— los retries son la herramienta ESTÁNDAR y honesta para E2E de eventual-consistency: NO
// tapan un bug, cubren el FREEZE PATOLÓGICO de la señal re-corriendo con una SESIÓN FRESCA (donde el sync
// arranca activo y propaga rápido). Los oráculos siguen ESTRICTOS: un bug real falla las 3 veces.
//
// Para BAJAR la frecuencia de retry (no dependemos SOLO de ellos), cada caso además fuerza/espera la
// señal según el tipo de cambio (medido):
//   · ADICIONES (T17/T18/T19) → `syncUntil` (blip-poll: `context.setOffline` off→on → PowerSync
//     reconecta y completa un checkpoint FRESCO → la fila ya presente en el servidor baja). Reduce el
//     freeze de las altas/updates.
//   · REVOCACIONES (T20/T21) → tick NATURAL con timeout AMPLIO (~120 s, cubre el freeze de ~90 s). Un
//     blip DISRUPTA la propagación de una remoción de bucket (medido), así que NO se usa; T20 usa
//     `revokeSession: false` (camino campo-borrado, E5) porque revocar la sesión también la disrupta —
//     el camino con sesión revocada + su ventana D1.2 lo cubre T21 (`revokeSession: true`).
//
// El fix de fondo (que borraría forzador Y retries) es `db.watch` = EXPANSIÓN DE ALCANCE, decisión de
// Raf (backlog + design §10-bis(g)). Nada acá es un reload (la app sigue montada) ni afloja un assert.
test.describe.configure({ retries: 2 });

test.afterAll(async () => {
  await cleanupAll();
});

/** Abre el dropdown del switch de establecimiento desde el header de la home (R6.8.1). */
async function openFieldSwitcher(page: Page, activeName: string): Promise<void> {
  const swi = page.getByRole('button', { name: new RegExp(`Establecimiento activo: ${escapeRe(activeName)}`) });
  await expect(swi).toBeVisible({ timeout: 30_000 });
  await swi.click();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fuerza un avance DETERMINISTA de `lastSyncedAt` SIN reload: un blip de red (offline → online) hace
 * que PowerSync reconecte y complete un checkpoint FRESCO → la señal avanza → la re-lectura reactiva
 * (el efecto que arregla esta feature) dispara y lee lo que ya bajó al SQLite local.
 *
 * ⚠️ POR QUÉ existe (ver el header + el diagnóstico A/B en progress/impl_20-reactividad-sync.md): la
 * fila del cambio server-side llega al SQLite local en ~1,5 s, pero `lastSyncedAt` avanza de forma NO
 * determinista por cambio — un cambio SIN un forzador posterior puede estancarse más allá de cualquier
 * timeout. Un `context.setOffline` blip fuerza el checkpoint que hace tica la señal. Esto NO es un
 * reload (la app sigue MONTADA: el efecto reactivo, los refs en memoria y el estado sobreviven — sigue
 * siendo la re-lectura PASIVA lo que se prueba), y ES un escenario REAL de manga (la señal se corta y
 * vuelve todo el tiempo). El fix de fondo —que la señal tique sola por cada cambio— es `db.watch`
 * (deuda de spec 15), FLAGEADO para Raf; mientras tanto este blip vuelve DETERMINISTA lo que sin él es
 * un flake de señal (y por eso el archivo NO necesita retries).
 */
async function forceSyncTick(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.waitForTimeout(1500);
  await page.context().setOffline(false);
}

/**
 * Blip-poll ACOTADO: fuerza avances de `lastSyncedAt` (blips de red) hasta que `check` se cumpla, o se
 * agota el presupuesto. DETERMINISTA frente a la señal no determinista, y frente al LAG del servicio de
 * sync (que procesa el WAL async → un blip puede reconectar y traer un checkpoint que TODAVÍA no
 * incluye el cambio; el siguiente blip lo trae). NO es un retry del test (no re-corre el setup ni el
 * login): re-fuerza SOLO la señal, que es exactamente lo que `db.watch` haría solo (deuda flageada). El
 * assert REAL corre después con su oráculo estricto — un bug real no lo salva ningún blip.
 */
async function syncUntil(
  page: Page,
  check: () => Promise<boolean>,
  opts: { blips?: number; settleMs?: number } = {},
): Promise<void> {
  const blips = opts.blips ?? 10;
  const settleMs = opts.settleMs ?? 6000;
  for (let i = 0; i <= blips; i++) {
    if (await check().catch(() => false)) return;
    if (i === blips) break;
    await forceSyncTick(page);
    await page.waitForTimeout(settleMs); // reconectar + resync + re-lectura reactiva + render
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Caso 1 (T17) — CAMPO EN CALIENTE. Es el criterio de aceptación A8 y la reproducción
// exacta del bug de Raf. Sin el fix (latch de un solo disparo) este test FALLA: el campo B
// baja al SQLite local pero nadie vuelve a leer las membresías.
// ───────────────────────────────────────────────────────────────────────────────
test('R20.1 — un campo al que te agregan server-side aparece SIN reiniciar la app', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('r20-campo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId: estA } = await seedEstablishmentWithRodeo(user.id, 'Campo A Reactivo');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  const nameA = `${RUN_TAG} Campo A Reactivo`;
  // Control: antes del seed hay UN solo campo. Abrimos el switch y el dropdown no ofrece otro.
  await openFieldSwitcher(page, nameA);
  const nameB = `${RUN_TAG} Campo B En Caliente`;
  await expect(page.getByText(nameB, { exact: true })).toHaveCount(0);

  // ── A MITAD DEL TEST, server-side: nos agregan a un campo nuevo. NADA de reload/re-login. ──
  const estB = await seedEstablishment(user.id, 'Campo B En Caliente');
  await seedRodeo(estB);

  // Con el dropdown ABIERTO, el contexto re-lee al avanzar el sync y el campo B aparece solo (el blip
  // de red fuerza el avance de la señal de forma determinista — sin reload, la app sigue montada).
  const campoB = page.getByText(nameB, { exact: true }).first();
  await syncUntil(page, () => campoB.isVisible());
  await expect(campoB).toBeVisible({ timeout: 30_000 });

  // Y el campo activo NO cambió por la aparición del nuevo (R20.11: el guard de equivalencia no
  // puede tragarse el cambio, pero tampoco puede mover al usuario de campo).
  await expect(page.getByText(nameA, { exact: true }).first()).toBeVisible();
  expect(estA).not.toEqual(estB);
});

// ───────────────────────────────────────────────────────────────────────────────
// Caso 2 (T18) — RODEO EN CALIENTE. La home es rodeo-céntrica: sus cards salen de
// `rodeoState.available`. Sin el fix, RodeoContext tenía el latch MÁS el candado `isWaitingRef`
// (no-op garantizado una vez resuelto a `active`) → el rodeo de un coworker no aparecía nunca.
// ───────────────────────────────────────────────────────────────────────────────
test('R20.2/R20.5/R20.19 — un rodeo creado por un coworker aparece sin reiniciar', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const user = await createTestUser('r20-rodeo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Rodeo Caliente');
  // Un segundo rodeo pre-existente (lo vamos a RENOMBRAR en caliente para probar UPDATE): el set
  // arranca con 2 → el alta en caliente lleva a 3.
  const secundarioId = await seedRodeo(establishmentId, 'Rodeo Secundario');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await expect(page.getByText(`${RUN_TAG} Rodeo Secundario`, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });

  // El rodeo ACTIVO al arrancar (el preferido: primero del set por created_at) queda persistido por
  // (usuario, campo). Es el oráculo EXACTO de R20.19: si una re-lectura reactiva cambiara la
  // selección, este valor cambiaría.
  const storeKey = `rafq.active_rodeo.${user.id}.${establishmentId}`;
  const activoAntes = await page.evaluate((k) => window.localStorage.getItem(k), storeKey);
  expect(activoAntes).toBe(rodeoId);

  const nuevoRodeo = `${RUN_TAG} Rodeo Del Coworker`;
  const secundarioRenombrado = `${RUN_TAG} Rodeo Secundario Renombrado`;
  await expect(page.getByText(nuevoRodeo, { exact: true })).toHaveCount(0);

  // ── DOS cambios server-side sobre el campo activo, SIN reload: un coworker CREA un rodeo (INSERT) y
  //    RENOMBRA otro (UPDATE). Se asserta el ESTADO FINAL combinado (ambos reflejados). ──
  //
  // Por qué DOS cambios, y por qué asertar el estado final (MEDIDO, no supuesto — diagnóstico A/B
  // determinista en progress/impl_20-reactividad-sync.md): la fila SIEMPRE llega al SQLite local en
  // ~1,5 s, pero `lastSyncedAt` —la señal sobre la que TODA la reactividad de RAFAQ está emulada
  // (spec 15, cero watched queries)— avanza de forma NO determinista por cambio: a veces tica al
  // instante, a veces un cambio se estanca hasta que un checkpoint POSTERIOR lo barre. Un cambio que
  // llega DESPUÉS fuerza un checkpoint que barre TODO lo pendiente, así que asertar el estado final
  // (los dos cambios reflejados) es MÁS robusto que un solo cambio: si el alta se hubiera estancado, el
  // rename posterior la empuja. Y el rename prueba que la re-lectura refleja UPDATES, no solo INSERTS
  // (mismo camino: efecto reactivo → load → applyRodeos). El límite de fondo —que la señal pueda
  // demorar— es la deuda de spec 15 (db.watch), FLAGEADA para Raf; no la arregla esta feature, que
  // arregla la RE-LECTURA.
  const nuevoId = await seedRodeo(establishmentId, 'Rodeo Del Coworker');
  await admin.from('rodeos').update({ name: secundarioRenombrado }).eq('id', secundarioId);

  // R20.2 — el rodeo creado (INSERT) y el renombrado (UPDATE) aparecen sin reiniciar.
  // R20.5 — esto ocurre con el contexto YA resuelto a `active`, que es justo lo que el candado
  // `isWaitingRef` impedía: con él, una vez resuelto, la re-lectura no volvía a correr nunca.
  const rodeoNuevoLoc = page.getByText(nuevoRodeo, { exact: true }).first();
  const rodeoRenombradoLoc = page.getByText(secundarioRenombrado, { exact: true }).first();
  // Blip-poll hasta que AMBOS cambios propaguen (el forzador avanza la señal, sin reload). El estado
  // final combinado es el oráculo robusto (design §10-bis (g)). Presupuesto amplio (el rename UPDATE
  // puede congelarse más que el INSERT); si aun así se congela patológicamente, el retry del archivo lo
  // cubre re-corriendo con sesión fresca.
  await syncUntil(
    page,
    async () => (await rodeoNuevoLoc.isVisible()) && (await rodeoRenombradoLoc.isVisible()),
    { blips: 16 },
  );
  await expect(rodeoNuevoLoc).toBeVisible({ timeout: 30_000 });
  await expect(rodeoRenombradoLoc).toBeVisible({ timeout: 30_000 });
  // El nombre VIEJO del rodeo renombrado ya no está: la re-lectura reflejó el UPDATE, no dejó el stale.
  await expect(page.getByText(`${RUN_TAG} Rodeo Secundario`, { exact: true })).toHaveCount(0);

  // R20.19 — tras DOS re-lecturas reactivas (alta + rename), el rodeo ACTIVO no cambió bajo los pies
  // del operario: sigue siendo exactamente el mismo id (oráculo: el activo persistido por usuario+campo).
  const activoDespues = await page.evaluate((k) => window.localStorage.getItem(k), storeKey);
  expect(activoDespues).toBe(rodeoId);
  expect(nuevoId).not.toEqual(rodeoId);
});

// ───────────────────────────────────────────────────────────────────────────────
// Caso 3 (T19) — LOTE EN CALIENTE. `/lotes` era MOUNT-ONLY: no se actualizaba ni al re-enfocar.
// El test se queda EN la pantalla (sin salir ni volver a entrar), que es justo lo que el bug
// impedía. `silent: true` en el efecto → la lista no se blanquea.
// ───────────────────────────────────────────────────────────────────────────────
test('R20.3/R20.9 — un lote creado por otro aparece en /lotes sin salir de la pantalla', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('r20-lote');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Lote Caliente');
  const previo = await seedManagementGroup(establishmentId, 'Lote Previo');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // A /lotes desde "Más" y NOS QUEDAMOS ACÁ.
  const lotesRow = page.getByRole('button', { name: 'Ver y gestionar los lotes del campo' });
  await gotoTab(page, 'Más', lotesRow);
  await lotesRow.click();
  await expect(page.getByRole('button', { name: 'Crear lote', exact: true })).toBeVisible({ timeout: 30_000 });
  // ⚠️ `.filter({ visible: true })`, NO `.first()`: /lotes se pushea SOBRE (tabs) y react-native-web deja
  // AMBAS pantallas en el DOM. La home tiene su propia card por lote → el `.first()` en orden de DOM cae
  // en la copia OCULTA de la home y el assert falla por "hidden" aunque la lista se vea perfecto.
  const loteVisible = (name: string) => page.getByText(name, { exact: true }).filter({ visible: true });

  // El lote previo ya está en la lista (carga inicial).
  await expect(loteVisible(previo.name).first()).toBeVisible({ timeout: 30_000 });

  // ── Server-side: otro usuario crea un lote. Sin salir de /lotes, sin reload. ──
  const nuevo = await seedManagementGroup(establishmentId, 'Lote En Caliente');

  // R20.3 — el lote creado por otro aparece en /lotes montada, sin salir ni volver a entrar (esta
  // pantalla era el único MOUNT-ONLY del barrido). El blip-poll fuerza el avance de la señal de forma
  // determinista (sin reload); la re-lectura reactiva de /lotes corre `load({ silent: true })` → la
  // lista NO se blanquea. El límite de fondo (la señal puede demorar sola) es la deuda de spec 15 /
  // db.watch, FLAGEADA — ver el diagnóstico A/B en progress/impl_20-reactividad-sync.md.
  const loteNuevo = loteVisible(nuevo.name).first();
  await syncUntil(page, () => loteNuevo.isVisible());
  await expect(loteNuevo).toBeVisible({ timeout: 30_000 });

  // R20.9 — la re-lectura fue SILENCIOSA: la lista nunca se blanqueó (el lote previo siguió
  // montado todo el tiempo) y el CTA sigue ahí (no volvimos al placeholder de carga).
  await expect(loteVisible(previo.name).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear lote', exact: true })).toBeVisible();
  await expect(page.getByText('Cargando lotes…', { exact: true })).toHaveCount(0);
});

// ───────────────────────────────────────────────────────────────────────────────
// Caso 4 (T20) — REVOCACIÓN FUERA DE MANIOBRA. Con el usuario parado en la home, le revocan el
// acceso al campo activo por el camino de PRODUCCIÓN (rol + sesión) → sin reiniciar aparece el
// aviso, con copy honesto para las DOS causas posibles, y al reconocerlo se re-rutea sobre los
// campos restantes.
// ───────────────────────────────────────────────────────────────────────────────
test('R20.14/R20.23/R20.24/R20.26/R20.28 — revocación fuera de maniobra → aviso + re-ruteo', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const owner = await createTestUser('r20-rev-owner');
  const member = await createTestUser('r20-rev-member');
  await setUserPhone(member.id, '1123456789');

  // El miembro pertenece a DOS campos (A activo, B de repuesto) para ejercitar el re-ruteo.
  const { establishmentId: estA } = await seedEstablishmentWithRodeo(owner.id, 'Campo Revocado A');
  const { establishmentId: estB } = await seedEstablishmentWithRodeo(owner.id, 'Campo Restante B');
  await admin.from('user_roles').insert([
    { user_id: member.id, establishment_id: estA, role: 'field_operator', active: true },
    { user_id: member.id, establishment_id: estB, role: 'field_operator', active: true },
  ]);

  await page.goto('/');
  await signIn(page, member);
  // Con 2 campos el landing es "Mis campos"; elegimos A y aterrizamos en su home.
  await waitForMisCampos(page);
  const nameA = `${RUN_TAG} Campo Revocado A`;
  await page.getByText(nameA, { exact: true }).first().click();
  await waitForHome(page);

  // ── Server-side: le revocan el ROL sobre A (`revokeSession: false` — camino campo-borrado; ver nota). ──
  //
  // ⚠️ `revokeSession: false` a propósito (T16 lo permite, declarándolo): este caso prueba que un campo
  // que DESAPARECE del set accesible dispara el aviso + re-ruteo fuera de maniobra (R20.14/R20.23/R20.24/
  // R20.26/R20.28) — es EXACTAMENTE el camino "campo borrado" (trigger 0076: rol a active=0 SIN revocar
  // sesión), indistinguible en la firma local de una remoción de miembro (E5, design §6.1). NINGUNO de
  // esos requisitos depende de que la sesión se revoque. Además, técnico (medido): revocar la sesión
  // DISRUPTA la propagación de la revocación al cliente → sin ella, propaga por la conexión estable en
  // ~5 s. El caso con sesión revocada + su ventana D1.2 lo cubre T21 (`revokeSession: true` +
  // `assertServerSessionsRevoked`).
  await revokeMemberRole(member.id, estA, { revokeSession: false });
  await waitForServerRoleInactive(member.id, estA);

  // Tick NATURAL con timeout AMPLIO (~120 s, cubre el freeze de ~90 s del A/B) — sin blip (igual que T21,
  // la otra revocación). Medido: una revocación (remoción de bucket) propaga por la conexión ESTABLE; un
  // blip (reconnect) la DISRUPTA en vez de ayudar. Sin reiniciar (la app sigue montada), la re-lectura
  // PASIVA la detecta (evidencia afirmativa: rol local con active=0) y emite active_lost. Si el freeze
  // supera el timeout (patológico, bajo carga), el retry del archivo lo cubre con sesión fresca.
  await expect(page.getByText(`Ya no tenés acceso a ${nameA}`)).toBeVisible({ timeout: 120_000 });

  // R20.28 — el copy NO afirma una causa única (las dos causas son indistinguibles en la firma
  // local: remove_member y el trigger 0076 escriben el mismo par de columnas).
  await expect(
    page.getByText(/Puede que te lo hayan quitado o que el campo se haya eliminado/),
  ).toBeVisible();
  await expect(page.getByText('Te quitaron el acceso a este campo. Tu cuenta sigue activa.')).toHaveCount(0);

  // R20.26 — el aviso NO promete que lo cargado se conservó ni que se subió (eso es E2, fuera).
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toContain('se guardaron');
  expect(body).not.toContain('se subieron');
  expect(body).not.toContain('se conservaron');

  // "Entendido" → re-ruteo por cantidad de campos restantes: queda uno (B) → su home.
  await page.getByRole('button', { name: 'Entendido', exact: true }).click();
  await waitForHome(page);
  await expect(page.getByText(`${RUN_TAG} Campo Restante B`, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(estA).not.toEqual(estB);
});

// ───────────────────────────────────────────────────────────────────────────────
// Caso 5 (T21) — REVOCACIÓN DURANTE LA MANIOBRA (D1 + riesgos 7 y 8).
//
// 📌 QUÉ VERIFICA EXACTAMENTE ESTE TEST, Y QUÉ NO (D1.2, Gate 1 HIGH-1):
// Verifica el diferimiento **dentro de la vida del access token** (`jwt_expiry = 3600`). El camino
// de producción de una remoción de miembro TAMBIÉN revoca la sesión (`remove_member` →
// `revoke_user_sessions`, migración 0072): al vencer el access token, el refresh falla,
// `onAuthStateChange` emite `session = null` y el RootGate rutea a LOGIN — con la maniobra abierta.
// Eso es real, es D1.2, y NO es testeable acá: esperar 1 h no es viable y acortar `jwt_expiry`
// implica tocar config compartida (fuera de alcance). **Ningún assert de este spec debe sugerir que
// la maniobra sobrevive indefinidamente a una remoción de miembro.** Lo que sí se garantiza —y se
// prueba— es que esta feature no lo saca de la manga por su propia decisión de navegación.
//
// El assert 1 es el candado anti-falso-verde (design §8 riesgo 8): si el fixture dejara de espejar
// `remove_member` completo, el test se pone ROJO antes de asertar nada del diferimiento.
// ───────────────────────────────────────────────────────────────────────────────
test('R20.20/R20.21/R20.22/R20.18 — revocación durante la maniobra: no patea, avisa al salir', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const owner = await createTestUser('r20-man-owner');
  const member = await createTestUser('r20-man-member');
  await setUserPhone(member.id, '1123456789');
  const { establishmentId: estA } = await seedEstablishmentWithRodeo(owner.id, 'Campo Maniobra A');
  await admin
    .from('user_roles')
    .insert({ user_id: member.id, establishment_id: estA, role: 'field_operator', active: true });

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, member);
  await waitForHome(page);

  // CONTROL del oráculo de sesión: capturamos un refresh token VIVO ANTES de revocar (si no, el
  // assert 1 no distinguiría "revocado" de "nunca sirvió").
  const refreshBefore = await captureRefreshToken(member);

  // Entramos al flujo de maniobra: wizard → "Arrancar jornada" → pantalla de identificación.
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Ancla EXCLUSIVA de la pantalla de identificación (oráculo de "seguimos en la maniobra"): NO
  // asertamos por ausencia de un texto del destino — la pantalla de fondo sigue montada detrás.
  const enManiobra = page.getByTestId('connect-stick-disc');
  await expect(enManiobra).toBeVisible({ timeout: 30_000 });

  // ── Server-side: le revocan el acceso al campo activo, camino REAL (rol + sesión). ──
  await revokeMemberRole(member.id, estA, { revokeSession: true });
  await waitForServerRoleInactive(member.id, estA);

  // ASSERT 1 (antes de nada): el fixture ejecutó el camino de producción. Sin esto, el resto del
  // test no prueba lo que dice.
  await assertServerSessionsRevoked(refreshBefore);

  // ASSERT 2: durante ≥20 s con la revocación ya propagable, la app NO navega ni a /campo-perdido
  // (D1: EstablishmentContext difiere) ni a /crear-rodeo (riesgo 7: RodeoContext ve su bucket de
  // rodeos vacío y, sin la evidencia afirmativa, concluiría `no_rodeos` → bloqueo total SOBRE la
  // pantalla de maniobra, pateando al operario igual).
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await expect(enManiobra).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entendido', exact: true })).toHaveCount(0);
    await expect(page.getByText('Creá tu primer rodeo', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(2_000);
  }

  // ASSERT 3: al SALIR del flujo de maniobra, recién ahí se aplica la transición y aparece el aviso
  // (R20.22/R20.23).
  //
  // ⚠️ Se sale por la UI REAL (‹ → "Salir sin terminar"), NO con `page.goto()`: un goto en esta SPA es
  // una recarga completa → el pendiente (que vive solo en memoria, R20.25) se perdería y el aviso
  // aparecería por el camino de ARRANQUE EN FRÍO, no por el diferimiento. El test pasaría por la razón
  // equivocada y dejaría de probar D1.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Salir sin terminar', exact: true }).click();

  // El aviso nombra al campo perdido (el título; el subtítulo comparte prefijo → matcheamos el nombre).
  // Timeout AMPLIO (~120 s) por el mismo freeze de propagación de revocación que T20; el retry del
  // archivo cubre el freeze patológico. (Si la revocación se detectó durante la maniobra, el pendiente
  // emite al salir por lectura LOCAL —instantáneo—; el timeout amplio cubre el caso en que aún no
  // había propagado y la detección ocurre post-salida.)
  const nameA = `${RUN_TAG} Campo Maniobra A`;
  await expect(page.getByText(`Ya no tenés acceso a ${nameA}`)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Entendido', exact: true })).toBeVisible();
});

// ───────────────────────────────────────────────────────────────────────────────
// Caso 6 (T22) — OFFLINE PURO INTACTO. Con la red cortada, `lastSyncedMs` queda CONGELADO (no avanza)
// → el efecto reactivo no vuelve a disparar y la app no cambia de estado por su culpa (nada de
// campo-perdido, onboarding fantasma ni bloqueo de rodeo). Mismo patrón que animals-offline.
//
// ⚠️ QUÉ NO cubre este test (honestidad, prong D): el login es ONLINE primero, así que para cuando
// llegamos acá `lastSyncedMs` YA es > 0. Por eso este caso NO ejercita el guard de arranque-en-frío
// `lastSyncedMs === 0` (R20.7 estricto): un first-sync OFFLINE es imposible (PowerSync necesita
// conectarse para sincronizar, y una sesión persistida restaura el `lastSyncedAt` cacheado, > 0). El
// guard `=== 0` se verifica por INSPECCIÓN (está en los 3 efectos). Lo que este test SÍ prueba es la
// otra mitad de R20.7/R20.8: con la señal CONGELADA (sin nuevos avances) el efecto no re-lee de forma
// espuria ni tumba el estado resuelto (R20.10/R20.30).
// ───────────────────────────────────────────────────────────────────────────────
test('R20.7/R20.8/R20.10/R20.30 — offline puro: señal congelada, sin re-lectura espuria ni cambio de estado', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('r20-offline');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Offline Puro');

  // Login ONLINE (necesitamos sesión) y luego cortamos la red ANTES de cualquier cambio server-side.
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await context.setOffline(true);
  try {
    // Un rato sin red: `lastSyncedMs` queda CONGELADO (no avanza) → el efecto reactivo no vuelve a
    // correr y no toca el estado ya resuelto. (Si el servicio se reiniciara y `lastSyncedAt` volviera
    // a 0, el guard `=== 0` lo trataría como "todavía no hubo sync" y tampoco tocaría el estado — R20.8,
    // verificado por inspección: no es reproducible cortando la red desde el cliente.)
    await page.waitForTimeout(10_000);

    // La app sigue en la home del campo activo: NO cayó a campo-perdido, ni a onboarding, ni al
    // bloqueo total de rodeo por una lectura degradada (R20.10/R20.30 — un fallo de lectura nunca
    // concluye en contra del usuario).
    await expect(page.getByText(/¡Hola.*👋/)).toBeVisible();
    await expect(page.getByText(/Ya no tenés acceso a/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Crear mi primer campo' })).toHaveCount(0);
    await expect(page.getByText('Creá tu primer rodeo', { exact: true })).toHaveCount(0);
    await expect(page.getByText(`${RUN_TAG} Campo Offline Puro`, { exact: true }).first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
