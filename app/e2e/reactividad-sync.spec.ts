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
//   6. (T22) Offline puro intacto — sin ningún cambio de tabla el `db.onChange` no dispara (R21.22/R21.23).
//
// ── spec 21 (as-built): REACTIVIDAD DETERMINISTA vía WATCHED QUERY (D3, ADR-030) ──
// La feature 20 usaba `lastSyncedMs` como disparador (un proxy NO determinista del cambio de dato: el
// diagnóstico A/B midió que la fila SIEMPRE baja al SQLite local en ~1,5 s, pero la señal `lastSyncedAt`
// se CONGELABA ~90 s+ antes de ticar). Ese spec compensaba con `test.describe.configure({ retries: 2 })`
// + un FORZADOR de blip de red (`forceSyncTick`/`syncUntil`). La feature 21 migró el disparador a
// watched queries reales de PowerSync (`db.onChange` en los 2 contextos, `useQuery` en /lotes): la UI
// reacciona al CAMBIO DE TABLA del SQLite local (~1,5 s determinista), no a la señal gruesa. Por eso este
// spec ahora asserta DIRECTO, SIN retries y SIN forzador — y sigue verde de forma determinista.
//
// La ENTREGA de la revocación sigue siendo async (E4/R21.24/R21.25): la watched query elimina el lag de
// la SEÑAL, no la latencia de PROPAGACIÓN del servicio de sync (la remoción del bucket la gobierna el
// servicio; la frontera real de acceso sigue siendo RLS server-side). Por eso los timeouts de las
// REVOCACIONES son más amplios que los de las ADICIONES, pero acotados a la propagación real MEDIDA (no
// al freeze de señal de ~90 s, que desapareció). Los oráculos siguen ESTRICTOS (incluido
// `assertServerSessionsRevoked` como primer assert de T21, el candado anti-falso-verde). Nada acá hace
// `page.reload()` ni re-login tras el seed server-side (regla de oro, abajo): eso re-correría el
// bootstrap y "arreglaría" el bug → daría verde sin probar la reactividad.

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

// spec 21 (D3): SIN `test.describe.configure({ retries })` y SIN forzador de blip. La reactividad es
// determinista (watched query sobre el cambio de tabla), así que cada caso asserta directo. Un bug real
// falla el assert, no lo salva ningún retry. (Ver el header para el porqué de los timeouts.)

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

// ───────────────────────────────────────────────────────────────────────────────
// Caso 1 (T17) — CAMPO EN CALIENTE. Es el criterio de aceptación A8 y la reproducción
// exacta del bug de Raf. Sin el fix (latch de un solo disparo) este test FALLA: el campo B
// baja al SQLite local pero nadie vuelve a leer las membresías.
// ───────────────────────────────────────────────────────────────────────────────
test('R20.1 — un campo al que te agregan server-side aparece SIN reiniciar la app', async ({ page }) => {
  test.setTimeout(120_000);
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

  // spec 21 — Con el dropdown ABIERTO, el `db.onChange` sobre `establishments`/`user_roles` dispara
  // apenas la fila del campo B baja al SQLite local (~1,5 s) → `refreshEstablishments` re-resuelve y el
  // campo aparece solo, SIN forzador de blip y SIN reload (la app sigue montada).
  const campoB = page.getByText(nameB, { exact: true }).first();
  await expect(campoB).toBeVisible({ timeout: 30_000 });

  // Y el campo activo NO cambió por la aparición del nuevo (R20.11: el guard de equivalencia no
  // puede tragarse el cambio, pero tampoco puede mover al usuario de campo).
  await expect(page.getByText(nameA, { exact: true }).filter({ visible: true }).first()).toBeVisible();
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
  test.setTimeout(150_000);
  const user = await createTestUser('r20-rodeo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Rodeo Caliente');
  // Un segundo rodeo pre-existente (lo vamos a RENOMBRAR en caliente para probar UPDATE): el set
  // arranca con 2 → el alta en caliente lleva a 3.
  const secundarioId = await seedRodeo(establishmentId, 'Rodeo Secundario');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await expect(page.getByText(`${RUN_TAG} Rodeo Secundario`, { exact: true }).filter({ visible: true }).first()).toBeVisible({
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
  // spec 21 — Por qué DOS cambios: ejercitan las dos caras del disparador. El `db.onChange` sobre
  // `rodeos` dispara `load` → `applyRodeos` apenas CUALQUIER fila de `rodeos` cambia en el SQLite local
  // (~1,5 s determinista), sea un INSERT (rodeo nuevo) o un UPDATE (rename). Asertar que AMBOS quedan
  // reflejados prueba que la watched query refleja updates, no solo altas — sin depender de que tique
  // ninguna señal gruesa (ese era el freeze que la feature 20 sufría y la 21 elimina).
  const nuevoId = await seedRodeo(establishmentId, 'Rodeo Del Coworker');
  await admin.from('rodeos').update({ name: secundarioRenombrado }).eq('id', secundarioId);

  // R20.2 — el rodeo creado (INSERT) y el renombrado (UPDATE) aparecen sin reiniciar.
  // R20.5 — esto ocurre con el contexto YA resuelto a `active`, que es justo lo que el candado
  // `isWaitingRef` impedía: con él, una vez resuelto, la re-lectura no volvía a correr nunca.
  const rodeoNuevoLoc = page.getByText(nuevoRodeo, { exact: true }).first();
  const rodeoRenombradoLoc = page.getByText(secundarioRenombrado, { exact: true }).first();
  // spec 21 — assert DIRECTO (sin forzador de blip): el `onChange` sobre `rodeos` dispara con cada
  // cambio de tabla → ambos aparecen solos. Timeouts razonables de Playwright.
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
  test.setTimeout(120_000);
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

  // spec 21 (R21.3/R21.20) — el lote creado por otro aparece en /lotes montada, sin salir ni volver a
  // entrar. `useQuery` sobre `management_groups` re-emite apenas la fila baja al SQLite local (~1,5 s),
  // SIN forzador de blip. Como el hook NO re-pone `isLoading` en las re-emisiones, la lista NO se
  // blanquea (el `rowComparator` preserva las filas sin cambio). Assert directo.
  const loteNuevo = loteVisible(nuevo.name).first();
  await expect(loteNuevo).toBeVisible({ timeout: 30_000 });

  // R20.9 / R21.20 — la re-emisión fue SILENCIOSA: la lista nunca se blanqueó (el lote previo siguió
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
  test.setTimeout(150_000);
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

  // spec 21 — SIN blip y SIN retry. El `db.onChange` sobre `user_roles` dispara apenas la fila del rol
  // (active=0) baja al SQLite local (candado RG-1: `self_user_roles` sobrevive con active=0) →
  // `refreshEstablishments` → evidencia afirmativa `absent_or_inactive` → `active_lost`. La ENTREGA de la
  // remoción la gobierna el servicio de sync (E4/R21.24), pero SIN el lag de la señal `lastSyncedAt`: la
  // propagación real por la conexión estable es de sub-segundos (MEDIDO en la 21: aviso a <250 ms del
  // disparo, 4 corridas), no el freeze de ~90 s de la 20. El timeout de 45 s da margen amplio para la
  // variación de propagación del servicio (E4) sin reintroducir flakiness — muy por debajo del ~120 s
  // que cubría el freeze de señal.
  await expect(page.getByText(`Ya no tenés acceso a ${nameA}`)).toBeVisible({ timeout: 45_000 });

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
  await expect(page.getByText(`${RUN_TAG} Campo Restante B`, { exact: true }).filter({ visible: true }).first()).toBeVisible({
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
  test.setTimeout(150_000);
  const owner = await createTestUser('r20-man-owner');
  const member = await createTestUser('r20-man-member');
  await setUserPhone(member.id, '1123456789');
  const { establishmentId: estA } = await seedEstablishmentWithRodeo(owner.id, 'Campo Maniobra A');
  await admin
    .from('user_roles')
    .insert({ user_id: member.id, establishment_id: estA, role: 'field_operator', active: true });

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
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

  // spec 21 — El aviso nombra al campo perdido. SIN retry. Si la revocación ya se detectó durante la
  // maniobra (el `onChange` sobre `user_roles` disparó y se difirió el pendiente), al salir el pendiente
  // emite por lectura LOCAL —instantáneo—. Si aún no había propagado, la detección ocurre post-salida
  // dentro de la ventana de propagación real, sin el freeze de señal de la 20. MEDIDO en la 21: aviso a
  // <350 ms de salir (4 corridas). El timeout de 45 s da margen amplio sin reintroducir flakiness.
  const nameA = `${RUN_TAG} Campo Maniobra A`;
  await expect(page.getByText(`Ya no tenés acceso a ${nameA}`)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Entendido', exact: true })).toBeVisible();
});

// ───────────────────────────────────────────────────────────────────────────────
// Caso 6 (T22) — OFFLINE PURO INTACTO (spec 21: R21.22/R21.23). Con la red cortada NO bajan cambios de
// tabla del servidor → el `db.onChange` de los contextos NO dispara (solo dispara ante un cambio real de
// una tabla observada) y `useQuery` refleja el estado local sin re-emitir → la app no cambia de estado
// por su culpa (nada de campo-perdido, onboarding fantasma ni bloqueo de rodeo). Mismo patrón que
// animals-offline.
//
// spec 21 — Esto REEMPLAZA el guard `lastSyncedMs === 0` de la feature 20 por una propiedad más fuerte:
// no hay disparo espurio porque no hay EVENTO (sin cambio de tabla, no hay onChange). Si un write LOCAL
// del propio usuario disparara el onChange estando offline, la re-lectura lee el SQLite local y, por la
// evidencia afirmativa (R21.23), nunca concluye en contra del usuario. El oráculo (sin cambio de estado)
// es el mismo que la 20; sigue válido con el disparador nuevo.
// ───────────────────────────────────────────────────────────────────────────────
test('R21.22/R21.23 — offline puro: sin cambios de tabla el onChange no dispara ni cambia el estado', async ({
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
    // Un rato sin red: NO bajan cambios de tabla → el `db.onChange` no dispara y no toca el estado ya
    // resuelto (R21.22). `useQuery` de /lotes tampoco re-emite sin un cambio local. No hay evento, no
    // hay re-lectura espuria.
    await page.waitForTimeout(10_000);

    // La app sigue en la home del campo activo: NO cayó a campo-perdido, ni a onboarding, ni al
    // bloqueo total de rodeo por una lectura degradada (R20.10/R20.30 — un fallo de lectura nunca
    // concluye en contra del usuario).
    await expect(page.getByText(/¡Hola.*👋/)).toBeVisible();
    await expect(page.getByText(/Ya no tenés acceso a/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Crear mi primer campo' })).toHaveCount(0);
    await expect(page.getByText('Creá tu primer rodeo', { exact: true })).toHaveCount(0);
    await expect(page.getByText(`${RUN_TAG} Campo Offline Puro`, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
