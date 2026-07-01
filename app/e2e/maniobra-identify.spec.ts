// e2e/maniobra-identify.spec.ts — red de seguridad de la IDENTIFICACIÓN del animal en MODO MANIOBRAS
// (spec 03 M2.1-core). Pantalla REAL (ya NO es el design spike mock): consume la sesión + el
// establishment/rodeo del contexto + el listener del bastón. Se llega ARRANCANDO una jornada en el wizard
// (createSession → /maniobra/identificar?sessionId=…); el listener BLE global (spec 09) se suspende por
// ruta `maniobra` (R3.2) → el escaneo lo maneja ESTA pantalla.
//
// Cómo se inyecta el bastonazo sin hardware: igual que baston.spec.ts — el provider de la RAÍZ monta el
// MockAdapter (mode='mock', marca `window.__RAFAQ_BLE_E2E__` vía addInitScript ANTES del bundle). El
// BleE2EBridge publica `window.__rafaqBle.tagRead(eid)` / `connectMock()` / `disconnectMock()`. FUERA de
// producción: sin la marca, ni el mock ni el handle existen (Gate 2).
//
// Escenarios (R3.x / R4.x):
//   (a) BLE a un animal del campo → FOUND → AUTO-AVANCE a la carga rápida (R3.3, auto-avance).
//   (b) BLE a un EID NUEVO → UNKNOWN → find-or-create con el TAG precargado (R4.1).
//   (c) BLE a un animal en OTRO campo del usuario → "Está en otro campo" → Saltar (R4.5).
//   (d) MANUAL por idv → lookup → FOUND → AUTO-AVANCE (R3.5).
//   (e) DESCONEXIÓN del bastón a mitad → fallback a manual sin perder la sesión (R3.6); el manual resuelve.
//
// El lookup es LOCAL (PowerSync SQLite): el animal sembrado server-side debe BAJAR por la stream antes de
// bastonear → esperamos a verlo en la lista (proxy de "ya sincronizó"). Usuarios + campos namespaced;
// cleanup en afterAll + global-teardown.

import path from 'node:path';

import { test, expect, applyEnvShim, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedRodeo,
  seedAnimal,
  setUserPhone,
  waitForServerProfileRodeo,
  waitForServerSessionClosed,
  waitForServerActiveSessionId,
  readServerSessionStatus,
  waitForServerAnimalProfile,
  RUN_TAG,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ─── EIDs FDX-B válidos (15 díg, prefijo país/fabricante). Únicos por corrida (unique global de tag). ───
let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Arranca la app con la marca de E2E del bastón SETEADA antes del bundle → mode='mock' + handle en window. */
async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

/** Conecta el mock + inyecta un bastonazo del EID dado (el handle lo publica BleE2EBridge bajo el flag). */
async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Marca el bastón conectado sin inyectar lectura (para el chip + el listening del mock). */
async function connectBaston(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

/** Desconecta el mock (simula pérdida de batería / fuera de rango, R3.6). */
async function disconnectBaston(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { disconnectMock: () => void } }).__rafaqBle;
    h?.disconnectMock();
  });
}

/**
 * Arranca una jornada de manga real desde el wizard y aterriza en la IDENTIFICACIÓN. Elige el rodeo
 * sembrado + 1 maniobra (Pesaje, siempre habilitada en cría) → "Arrancar jornada" → /maniobra/identificar.
 * Devuelve cuando el hero de escaneo "Acercá el bastón al animal" está visible.
 */
async function startManiobraSession(page: Page): Promise<void> {
  await startManiobraSessionOnRodeo(page);
}

/**
 * Igual que startManiobraSession pero elige un rodeo ESPECÍFICO por nombre (para los tests M2.1-edge con
 * 2 rodeos en el mismo campo: la sesión queda sobre `rodeoLabel` y el animal de otro rodeo dispara R4.4).
 * Si `rodeoLabel` es undefined, elige el primer rodeo (camino feliz de un solo rodeo).
 *
 * HERO ADAPTATIVO (M2.1, R3.6/R3.7): con el adapter-mock hay un transporte CONECTABLE → el estado inicial
 * "escuchando" muestra el ConnectHero ("Conectá el bastón"), NO el ScanHero. Para los tests que asumen el
 * camino conectado (bastonazo / scan), CONECTAMOS el mock antes de asertar el ScanHero (el escenario real:
 * el operario ya conectó el bastón). Los sub-estados desconectado/conectable/manual tienen sus tests propios.
 */
async function startManiobraSessionOnRodeo(page: Page, rodeoLabel?: string): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  const rodeoBtn = rodeoLabel
    ? page.getByRole('button', { name: new RegExp(`Elegir rodeo .*${rodeoLabel}`) }).first()
    : page.getByRole('button', { name: /Elegir rodeo / }).first();
  await rodeoBtn.click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Conectamos el bastón mock → el hero adaptativo pasa de ConnectHero a ScanHero ("Acercá el bastón").
  await connectBaston(page);
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Expande la entrada manual + busca por el texto dado (idv/visual). Reusable en los tests de manual/edge. */
async function manualSearch(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(query);
  await page.getByRole('button', { name: 'Buscar animal' }).click();
}

/**
 * Camina el wizard de /crear-animal desde el paso 2 (sexo) hasta confirmar el alta. Con 1 rodeo el
 * wizard auto-avanza el paso 1 (rodeo) → arranca en SEXO. Elige sexo + categoría + (opcional) una
 * caravana visual recomendada → "Crear animal". Réplica local de walkWizardToData de animals.spec.ts
 * (no hay helper compartido del wizard). Selectores por a11y (buttonA11y emite role=button + aria-label).
 */
async function walkCrearAnimalWizard(
  page: Page,
  opts: { sex: 'Macho' | 'Hembra'; categoryName: string; idv?: string },
): Promise<void> {
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
  // El built-in editable "Nombre / seña" fue removido del alta (delta #2 NOMBRE/APODO, RNA.2.1): el
  // identificador libre del paso 4 es la caravana visual (idv). Solo se rellena si el llamador lo pide
  // (el camino con idv PRECARGADO read-only ya trae su identificador y no necesita rellenar nada).
  if (opts.idv) {
    await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(opts.idv);
  }
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();
}

// (a) BLE a un animal del campo → FOUND → AUTO-AVANCE a la carga rápida.
test('(a) bastonazo a un animal del campo → encontrado → auto-avance a la carga rápida', async ({ page }) => {
  const user = await createTestUser('mid-found');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Identify Found');
  const eid = makeEid();
  const visual = `${RUN_TAG}-FOUND`;
  await seedAnimal(establishmentId, rodeoId, { tag: eid, visualAlt: visual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Esperamos a que el animal BAJE por la stream (visible en la lista = ya sincronizó al SQLite local).
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startManiobraSession(page);

  // Bastonazo del EID existente → "Lectura recibida" (flash found) → auto-avance (~0,8s) a la carga rápida.
  await bastonazo(page, eid);
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });
  // La carga rápida REAL (M2.2) abre el paso de la jornada (Pesaje, única maniobra) → el contador "· 1 de 1"
  // + el display de peso confirman el auto-avance al frame real.
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
});

// (b) BLE a un EID NUEVO → UNKNOWN → find-or-create con el TAG precargado.
test('(b) bastonazo a un EID nuevo → desconocido → dar de alta con el tag precargado', async ({ page }) => {
  const user = await createTestUser('mid-unknown');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Identify Unknown');
  const eid = makeEid();

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await startManiobraSession(page);

  // EID que no existe en ningún campo → unknown → hero "Animal nuevo" + "Dar de alta".
  await bastonazo(page, eid);
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible({ timeout: 15_000 });
  const darAlta = page.getByRole('button', { name: 'Dar de alta', exact: true });
  await expect(darAlta).toBeVisible();
  await darAlta.click();

  // Aterriza en el wizard de alta con el TAG precargado (read-only): "Creando: [TAG]" (R4.1 / RB6.3).
  await expect(page.getByText(`Creando: ${eid}`, { exact: true })).toBeVisible({ timeout: 20_000 });
});

// (c) BLE a un animal en OTRO campo del usuario → "Está en otro campo" → Saltar (R4.5).
test('(c) bastonazo a un animal de OTRO campo → aviso "está en otro campo" → saltar', async ({ page }) => {
  const user = await createTestUser('mid-otherfield');
  await setUserPhone(user.id, '1123456789');
  // Campo ACTIVO (de la jornada) + 2º campo (donde vive el animal). El usuario es owner de ambos → ambos
  // sincronizan al SQLite local. Landing 'choosing' con 2 campos → fijamos el activo.
  const active = await seedEstablishmentWithRodeo(user.id, 'Campo Identify Activo');
  const other = await seedEstablishmentWithRodeo(user.id, 'Campo Identify Vecino');
  const eid = makeEid();
  await seedAnimal(other.establishmentId, other.rodeoId, { tag: eid, visualAlt: `${RUN_TAG}-OF`, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);

  // Con 2 campos aterriza en "Mis campos" → elegimos el campo ACTIVO de la jornada.
  const activeCard = page.getByRole('button', { name: new RegExp('Campo Identify Activo') }).first();
  await expect(activeCard).toBeVisible({ timeout: 30_000 });
  await activeCard.click();
  await waitForHome(page);

  // Damos margen a que el set (incl. el animal del 2º campo) baje al SQLite local de ambos campos.
  await gotoAnimales(page);
  await page.waitForTimeout(4000);

  await startManiobraSession(page);

  // Bastonazo del EID que vive en el OTRO campo → aviso "Está en otro campo" + "Saltar y seguir" (R4.5).
  await bastonazo(page, eid);
  await expect(page.getByText('Está en otro campo', { exact: true })).toBeVisible({ timeout: 20_000 });
  const saltar = page.getByRole('button', { name: 'Saltar y seguir escaneando' });
  await expect(saltar).toBeVisible();
  await saltar.click();
  // Tras saltar, volvemos a ESCUCHAR (no se carga sobre el animal de otro campo; no frena la fila).
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 10_000 });
});

// (d) MANUAL por idv → lookup → FOUND → AUTO-AVANCE (R3.5).
test('(d) búsqueda manual por idv → encontrado → auto-avance a la carga rápida', async ({ page }) => {
  const user = await createTestUser('mid-manual');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Identify Manual');
  const idv = '4721';
  const visual = `${RUN_TAG}-MAN`;
  // Sin caravana electrónica (animal cargado a mano): se identifica por idv.
  await seedAnimal(establishmentId, rodeoId, { idv, visualAlt: visual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // Proxy de "ya sincronizó al SQLite local": para un animal SIN caravana el HERO de la fila es el IDV
  // (AnimalRow: idv → visual → "—"); el visual va como secundario inline → esperamos el IDV (hero), que
  // es exact-matchable. El campo es namespaced (RUN_TAG) → el IDV corto no colisiona con otro animal.
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startManiobraSession(page);

  // Expandimos la entrada manual (thumb zone) → tipeamos el idv → Buscar → found → auto-avance.
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(idv);
  await page.getByRole('button', { name: 'Buscar animal' }).click();
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
});

// (e) DESCONEXIÓN del bastón a mitad → fallback a manual sin perder la sesión (R3.6).
test('(e) desconexión del bastón → fallback a manual sin perder la sesión', async ({ page }) => {
  const user = await createTestUser('mid-disconnect');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Identify Disc');
  const idv = '3310';
  const visual = `${RUN_TAG}-DISC`;
  await seedAnimal(establishmentId, rodeoId, { idv, visualAlt: visual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // Proxy de sync: el IDV es el hero de la fila del animal sin caravana (ver test (d)).
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startManiobraSession(page);

  // Conectamos el bastón (chip "Bastón conectado") y luego lo DESCONECTAMOS a mitad (R3.6).
  await connectBaston(page);
  await expect(page.getByText('Bastón conectado', { exact: true })).toBeVisible({ timeout: 10_000 });
  await disconnectBaston(page);
  await expect(page.getByText('Bastón desconectado', { exact: true })).toBeVisible({ timeout: 10_000 });

  // La sesión NO se perdió: el hero de escaneo sigue + el manual está SIEMPRE disponible (manual-first).
  // Caemos a manual y resolvemos → found → auto-avance. La sesión sigue intacta (no se reinició).
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(idv);
  await page.getByRole('button', { name: 'Buscar animal' }).click();
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// M2.1-EDGE — edge cases diferidos (R4.2 desambiguación / R4.4 otro rodeo mismo campo / R4.7 heurística)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const SHOT_DIR = path.join(process.cwd(), '..', 'design', 'maniobra-identify');

// (f) R4.2 — MANUAL con caravana visual DUPLICADA → picker de candidatos → elegir el correcto → carga.
// MOCK LIMPIO (captura): caravana visual "0385" (no e2e_…), rodeo "Cría hembras", categoría Vaquillona.
// El visual "0385" no es idv de ningún animal (idv 5001/5002) → la búsqueda cae a la rama visual-fuzzy →
// devuelve 2 candidatos que comparten visual+rodeo+categoría → el N° interno (idv) los DESEMPATA.
test('(f) manual con visual duplicado → picker de candidatos → elegir → carga (R4.2)', async ({ page }) => {
  const user = await createTestUser('mid-dup');
  await setUserPhone(user.id, '1123456789');
  // rodeoRawName → rodeo "Cría hembras" limpio en la captura (sin prefijo e2e_…). SEGURO: cleanup por CASCADE.
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Identify Dup', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const dupVisual = '0385';
  await seedAnimal(establishmentId, rodeoId, { idv: '5001', visualAlt: dupVisual, sex: 'female' });
  await seedAnimal(establishmentId, rodeoId, { idv: '5002', visualAlt: dupVisual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // Proxy de sync: el hero de ambas filas (sin tag) es el idv → esperamos a ver uno de los dos.
  await expect(page.getByText('5001', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('5002', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startManiobraSessionOnRodeo(page, 'Cría hembras');

  // Buscamos por la caravana visual DUPLICADA → >1 candidato → picker (NO se auto-elige).
  await manualSearch(page, dupVisual);
  await expect(page.getByTestId('candidate-picker')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('¿Cuál es?', { exact: true })).toBeVisible();
  // Las dos filas comparten la caravana visual DOMINANTE "0385" (es lo duplicado); el N° interno (idv) las
  // DESEMPATA en el distinguidor → se eligen por "N° 5001" / "N° 5002".
  await expect(page.getByRole('button', { name: /Elegir .*N° 5001/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Elegir .*N° 5002/ })).toBeVisible();

  // CAPTURA del picker (412×915) para el veto del leader — mock limpio "0385" / "Cría hembras" / Vaquillona.
  await page.screenshot({ path: path.join(SHOT_DIR, 'candidate-picker.png') });

  // Elegimos el correcto (5002) → cargar sobre él → auto-avance a la carga rápida (rodeo de la sesión).
  await page.getByRole('button', { name: /Elegir .*N° 5002/ }).click();
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
});

// (g) R4.4 — animal de OTRO RODEO del MISMO campo → sheet → PASAR EL ANIMAL a este rodeo → carga.
// Honra el EARS R4.4: el animal se MUEVE al rodeo de la SESIÓN (UPDATE de animal_profiles.rodeo_id), NO se
// cambia la jornada. Verificamos que (1) NO carga directo (el sheet intercepta el auto-avance), (2) tras
// "Pasar el animal a este rodeo" el animal queda en el rodeo de la jornada → recién ahí carga.
test('(g) animal de otro rodeo del mismo campo → pasar el animal a este rodeo → carga (R4.4)', async ({ page }) => {
  const user = await createTestUser('mid-otherrodeo');
  await setUserPhone(user.id, '1123456789');
  // Campo con DOS rodeos del mismo sistema (cría). La jornada va sobre el rodeo A ("Cría hembras"); el
  // animal vive en el B ("Vaquillonas"). MOCK LIMPIO (captura): nombres limpios + caravana "0386".
  const { establishmentId, rodeoId: rodeoA } = await seedEstablishmentWithRodeo(user.id, 'Campo Identify 2Rodeos', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const rodeoB = await seedRodeo(establishmentId, 'Vaquillonas', { rawName: true });
  const idv = '6010';
  const profileId = await seedAnimal(establishmentId, rodeoB, { idv, visualAlt: '0386', sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Arrancamos la jornada sobre el RODEO A ("Cría hembras"; el animal está en "Vaquillonas" → R4.4).
  await startManiobraSessionOnRodeo(page, 'Cría hembras');

  // Buscamos el animal por idv → found, pero está en OTRO rodeo (B) → sheet R4.4 (NO carga directo).
  await manualSearch(page, idv);
  await expect(page.getByTestId('other-rodeo-sheet')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Está en otro rodeo', { exact: true })).toBeVisible();
  // R4.4: NO se cargó ningún evento (no se llegó al frame de carga) hasta resolver — el sheet lo intercepta.
  await expect(page.getByTestId('weight-display')).toHaveCount(0);

  // CAPTURA del sheet R4.4 (412×915) — mock limpio: "Pasar el animal a este rodeo" + origen "Vaquillonas".
  await page.screenshot({ path: path.join(SHOT_DIR, 'other-rodeo-sheet.png') });

  // PASAR EL ANIMAL a este rodeo (mismo sistema) → se MUEVE al rodeo de la jornada → cargar sobre él.
  await page.getByRole('button', { name: 'Pasar el animal a este rodeo', exact: true }).click();
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();

  // Verificación del as-built R4.4 (oráculo server-side): el UPDATE de animal_profiles.rodeo_id SÍ pasó —
  // el animal está AHORA en el rodeo A (el de la jornada), ya no en el B. Esto es lo que honra el EARS R4.4
  // (mover el animal, no cambiar la jornada). El trigger same-system (0047) lo permite (ambos cría).
  await waitForServerProfileRodeo(profileId, rodeoA);
});

// (h) R4.7 — 3 animales consecutivos de OTRO rodeo (mismo campo) → aviso no-bloqueante de rodeo mal elegido.
// MOCK LIMPIO + nombre de rodeo LARGO a propósito: la captura PRUEBA la robustez del fix (el botón "Cambiar
// a <rodeo largo>" trunca + los 2 botones apilados no clipean). Rodeo B = "Rodeo de cría de reposición 2024".
test('(h) 3 consecutivos de otro rodeo → aviso "rodeo de jornada mal elegido" (R4.7)', async ({ page }) => {
  const user = await createTestUser('mid-misrodeo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Identify MisRodeo', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const longRodeo = 'Rodeo de cría de reposición 2024';
  const rodeoB = await seedRodeo(establishmentId, longRodeo, { rawName: true });
  // 3 animales en el rodeo B (todos del mismo otro-rodeo → disparan la heurística al 3ro). Caravanas limpias.
  await seedAnimal(establishmentId, rodeoB, { idv: '7001', visualAlt: '0390', sex: 'female' });
  await seedAnimal(establishmentId, rodeoB, { idv: '7002', visualAlt: '0391', sex: 'female' });
  await seedAnimal(establishmentId, rodeoB, { idv: '7003', visualAlt: '0392', sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText('7001', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('7003', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Jornada sobre el rodeo A ("Cría hembras"; los 3 animales están en el B → cada uno R4.4; al 3ro → R4.7).
  await startManiobraSessionOnRodeo(page, 'Cría hembras');

  // Animal 1 (B) → sheet R4.4 → Saltar.
  await manualSearch(page, '7001');
  await expect(page.getByTestId('other-rodeo-sheet')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Saltar este animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Animal 2 (B) → sheet R4.4 → Saltar.
  await manualSearch(page, '7002');
  await expect(page.getByTestId('other-rodeo-sheet')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Saltar este animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Animal 3 (B) → sheet R4.4 → Saltar → la racha llegó a 3 → AVISO R4.7 no-bloqueante.
  await manualSearch(page, '7003');
  await expect(page.getByTestId('other-rodeo-sheet')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Saltar este animal' }).click();

  // El banner R4.7 aparece (no-bloqueante, debajo del header) sugiriendo cambiar la jornada al rodeo largo.
  await expect(page.getByTestId('rodeo-mismatch-banner')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(new RegExp(`Los últimos 3 animales son de .*${longRodeo}`))).toBeVisible();

  // CAPTURA del aviso R4.7 (412×915) — mock limpio + nombre LARGO: prueba que el botón "Cambiar a <rodeo>"
  // trunca y los 2 botones apilados (full-width) NO clipean con un nombre de rodeo largo (robustez fix-loop).
  await page.screenshot({ path: path.join(SHOT_DIR, 'rodeo-mismatch-warning.png') });

  // Es NO-bloqueante: el hero de escaneo sigue detrás (la fila no se frena).
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible();

  // Confirmar el aviso → cambia la jornada al rodeo de la racha (el rodeo largo) → el banner se cierra.
  // El botón se ubica por aria-label (incluye el nombre completo del rodeo, aunque el texto visible trunque).
  await page.getByRole('button', { name: `Cambiar a ${longRodeo}` }).click();
  await expect(page.getByTestId('rodeo-mismatch-banner')).toBeHidden({ timeout: 10_000 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// M2.1 — SALIDA de la jornada (botón ‹ → ExitJornadaSheet): Terminar (R10.7) / Salir sin terminar
// (reanudable R10.5/R10.6) / Seguir (cancelar/scrim). NADA destructivo (no hay rojo).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// (i) ‹ → ExitJornadaSheet → "Terminar jornada" → closeSession (oráculo server) + navega fuera del flujo.
test('(i) salida → terminar jornada → closeSession (server cerrado) + navega fuera', async ({ page }) => {
  const user = await createTestUser('mid-exit-terminar');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Exit Terminar');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await startManiobraSession(page);

  // El sessionId real (no expuesto en el DOM) → del server para el oráculo de cierre.
  const sessionId = await waitForServerActiveSessionId(establishmentId);

  // Tocar ‹ (header de sesión) → abre el ExitJornadaSheet (NO navega atrás directo).
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
  // Contexto "Llevás 0 animales hoy" (la jornada recién arranca → N=0).
  await expect(page.getByText(/Llev[aá]s\s*0\s*animales hoy/)).toBeVisible();

  // "Terminar jornada" → closeSession → paso de confirmación "Jornada terminada · Procesaste 0 animales".
  await page.getByRole('button', { name: 'Terminar jornada', exact: true }).click();
  await expect(page.getByText('Jornada terminada', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Procesaste\s*0\s*animales/)).toBeVisible();

  // ORÁCULO server: el closeSession (UPDATE offline → upload queue) cerró la sesión de verdad (R10.7).
  await waitForServerSessionClosed(sessionId);

  // "Listo" → navega FUERA del flujo de maniobra → volvemos a la superficie principal (home).
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await waitForHome(page);
});

// (j) ‹ → "Salir sin terminar" → navega fuera SIN cerrar la sesión (queda activa + reanudable).
test('(j) salida → salir sin terminar → navega fuera SIN cerrar (reanudable)', async ({ page }) => {
  const user = await createTestUser('mid-exit-salir');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Exit Salir');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await startManiobraSession(page);

  const sessionId = await waitForServerActiveSessionId(establishmentId);

  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });

  // "Salir sin terminar" → navega fuera (home), pero la sesión NO se cierra (sigue 'active').
  await page.getByRole('button', { name: 'Salir sin terminar', exact: true }).click();
  await waitForHome(page);

  // La sesión sigue ACTIVA en el server (no se cerró) → reanudable (R10.5/R10.6).
  // Damos margen a que cualquier UPDATE (que NO debería haber) sincronice; el status debe seguir 'active'.
  await page.waitForTimeout(2000);
  expect(await readServerSessionStatus(sessionId)).toBe('active');
});

// (k) ‹ → "Seguir en la jornada" → cierra el sheet, NO navega (seguimos en la identificación).
test('(k) salida → seguir en la jornada → cierra el sheet, no navega', async ({ page }) => {
  const user = await createTestUser('mid-exit-seguir');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Exit Seguir');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await startManiobraSession(page);

  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });

  // "Seguir en la jornada" (botón terciario, por testID — el scrim comparte el a11y label) → cierra el
  // sheet, seguimos en la identificación (hero de escaneo visible).
  await page.getByTestId('exit-jornada-seguir').click();
  await expect(page.getByTestId('exit-jornada-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible();
});

// (l) REGRESIÓN tap-through (web táctil): abrir el sheet con un TAP TÁCTIL real NO debe auto-cerrarlo por el
// click huérfano del open (mismo bug que el ManeuverConfigSheet). Context táctil propio (hasTouch + tap real).
test('(l) el ExitJornadaSheet NO se auto-cierra al abrirlo con tap táctil (click huérfano sobre el scrim)', async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 412, height: 915 },
  });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });

  try {
    const user = await createTestUser('mid-exit-tapthrough');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Exit TapThrough');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await startManiobraSession(page);

    // Abrir el sheet con un TAP TÁCTIL real sobre el botón ‹ (touch → click emulado ~20ms después).
    const back = page.getByRole('button', { name: 'Volver', exact: true });
    const box = await back.boundingBox();
    if (!box) throw new Error('sin boundingBox para el botón Volver');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500); // > ventana del click huérfano + doble rAF
    // Con el guard, el sheet SIGUE abierto (con el bug se auto-cerraba a ~1ms).
    await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible();

    // Y el backdrop DELIBERADO (guard ya armado) SÍ cierra: tap táctil arriba, sobre el scrim libre.
    const scrim = await page.getByTestId('exit-jornada-scrim').boundingBox();
    if (!scrim) throw new Error('sin boundingBox para el scrim');
    await page.touchscreen.tap(scrim.x + scrim.width / 2, scrim.y + 12);
    await expect(page.getByTestId('exit-jornada-sheet')).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await ctx.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// M2.1 — HERO ADAPTATIVO por estado de conexión (solo "escuchando", outcome===null, R3.6/R3.7).
// 3 sub-estados con el mock de transporte/BLE: conectado=ScanHero / desconectado+conectable=ConnectHero
// (tap→connect) / transport null=manual promovido. El mock-adapter SIEMPRE tiene transporte conectable →
// los sub-estados "conectado" y "conectable" se cubren con connect/disconnect; "transport null" (native
// manual-first) NO es expresable con el mock-adapter en web → se documenta como diferido al device.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// (m) Sub-estados conectado ↔ conectable, en vivo: el hero reacciona a connect/disconnect sin recargar.
test('(m) hero adaptativo: desconectado+conectable=ConnectHero (tap→connect) ↔ conectado=ScanHero', async ({ page }) => {
  const user = await createTestUser('mid-hero-adapt');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Hero Adapt');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Arrancamos la jornada SIN conectar (no usamos startManiobraSession, que conecta el mock). Con un
  // transporte conectable (mock) y desconectado → el estado "escuchando" muestra el ConnectHero.
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();

  // DESCONECTADO + CONECTABLE → ConnectHero ("Conectá el bastón") + disco tappable (testID).
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('connect-stick-disc')).toBeVisible();
  // NO está el ScanHero todavía.
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toHaveCount(0);

  // Tap del disco → connect() (el mock-adapter conecta). El hero pasa en vivo a ScanHero.
  await page.getByTestId('connect-stick-disc').click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Conectá el bastón', { exact: true })).toHaveCount(0);

  // DESCONEXIÓN en vivo (R3.6) → vuelve a ConnectHero sin recargar (el hero reacciona a isConnected/transport).
  await disconnectBaston(page);
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 15_000 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// M2.2 — ALTA desde la MANGA → CONTINÚA la carga de la maniobra del animal nuevo (cierra el TODO de
// R4.1). Antes el alta desde modo maniobras aterrizaba en la FICHA del animal (/animal/[id]) = dead-end
// de la jornada (el operario no podía volver a cargar la maniobra; back caía en la pantalla stale "Animal
// nuevo"). Ahora, en contexto maniobra, al crear se navega DIRECTO a /maniobra/carga (carga del nuevo
// animal), sin re-identificarlo. La regresión asegura que el alta NORMAL (sin sessionId) sigue yendo a la
// ficha.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// (n) desconocido en maniobras → dar de alta → wizard → "Crear animal" → CONTINÚA en /maniobra/carga (NO ficha).
test('(n) alta desde la manga → continúa la carga de la maniobra del animal nuevo (no la ficha)', async ({ page }) => {
  const user = await createTestUser('mid-alta-continua');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Alta Continua');
  const idv = '8090';

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await startManiobraSession(page);

  // Caravana MANUAL desconocida (no existe ningún animal con ese idv) → hero "Animal nuevo" → "Dar de alta".
  await manualSearch(page, idv);
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible({ timeout: 15_000 });
  // El idv tecleado va precargado read-only en el wizard ("Creando: 8090", R4.1).
  await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
  await expect(page.getByText(`Creando: ${idv}`, { exact: true })).toBeVisible({ timeout: 20_000 });

  // Completamos el wizard de alta (1 rodeo → auto-avanza a sexo) → "Crear animal". El idv 8090 ya viene
  // PRECARGADO read-only (find-or-create por el buscador de la manga) → es el identificador; no rellenamos nada.
  await walkCrearAnimalWizard(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // CLAVE (M2.2): NO aterriza en la ficha del animal → CONTINÚA en la carga de la maniobra del nuevo animal
  // (/maniobra/carga: la única maniobra es Pesaje → su display + contador "· 1 de 1" + el keypad lo
  // confirman; estos marcadores son EXCLUSIVOS de la carga, no aparecen en la ficha).
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
  // NEGATIVA: NO se ven los marcadores de la FICHA del animal (/animal/[id]: Historial / Dar de baja).
  await expect(page.getByText('Historial', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dar de baja' })).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MED-2 (Gate 2 / security_code_03) — la búsqueda manual TIENE `maxLength` UX = SEARCH_TERM_MAX_LENGTH (64).
// Defensa-en-profundidad: el corte AUTORITATIVO ya lo hace classifySearchQuery (slice(0,64)); este test
// asegura que el INPUT no deja tipear de más (paridad con el buscador de la lista de animales). Una sola
// aserción barata: tipear un string > 64 y confirmar que el valor renderizado quedó topado en 64.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// (p) la entrada manual topa el término en SEARCH_TERM_MAX_LENGTH (64) — maxLength UX (MED-2).
test('(p) la búsqueda manual topa el término en 64 caracteres (maxLength UX, MED-2)', async ({ page }) => {
  const user = await createTestUser('mid-maxlen');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Identify MaxLen');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await startManiobraSession(page);

  // Expandimos la entrada manual y tipeamos MÁS de 64 caracteres (100 'A').
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  const input = page.getByTestId('manual-entry-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill('A'.repeat(100));

  // El valor renderizado quedó topado en 64 (maxLength + slice — vale en web y native).
  await expect(input).toHaveValue('A'.repeat(64));
});

// (o) REGRESIÓN — alta NORMAL (desde la lista de animales, SIN sessionId) → FICHA /animal/[id], como hoy.
test('(o) regresión: alta sin sessionId (desde la lista) → ficha del animal (no la carga de maniobra)', async ({ page }) => {
  const user = await createTestUser('mid-alta-normal');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Alta Normal');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Alta NORMAL: empty-state de la lista → "Dar de alta tu primer animal" → wizard SIN sessionId.
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  // Identificador = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1).
  const idv = `6192${Date.now().toString().slice(-6)}`;
  await walkCrearAnimalWizard(page, { sex: 'Hembra', categoryName: 'Vaquillona', idv });

  // Sin sessionId → aterriza en la FICHA del recién creado (marcadores EXCLUSIVOS de /animal/[id]:
  // Identificación / Historial / Dar de baja), NO en la carga de maniobra. El alta normal NO cambió.
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Historial', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dar de baja' })).toBeVisible();
  // NEGATIVA: NO está la carga de maniobra (sin display de peso ni contador "· 1 de 1").
  await expect(page.getByTestId('weight-display')).toHaveCount(0);
  await expect(page.getByText('· 1 de 1', { exact: true })).toHaveCount(0);

  // Oráculo server-side: el alta llegó de verdad a animal_profiles (el drenado online de la outbox corre).
  await waitForServerAnimalProfile(establishmentId, { idv });
});
