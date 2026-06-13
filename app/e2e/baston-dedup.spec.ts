// e2e/baston-dedup.spec.ts — E2E FORMAL (Fase 6) del chunk "09 resto · dedup A/B (asignación de
// caravana)" de spec 09. Tests de COMPORTAMIENTO con aserciones (no solo captura — eso vive en
// dedup-screenshot.spec.ts, que sigue generando los PNG del veto del leader).
//
// Reusa el harness mock del bastón del chunk BLE global (`window.__rafaqBle.tagRead` bajo el flag
// `__RAFAQ_BLE_E2E__`, igual que baston.spec.ts): el provider de la raíz monta el MockAdapter, que NO
// existe fuera de la marca (Gate 2). El lookup es LOCAL (PowerSync SQLite) → los candidatos sembrados
// server-side deben BAJAR por la stream antes de bastonear; esperamos a verlos en la lista (proxy de
// "ya sincronizó") para no pasar por la razón equivocada (patrón del test RD6.1 existente).
//
// Los 5 escenarios (design §8.3 / Gate 0 §3.5 + el directo-a-CREATE de RD3.2):
//   (a)  opción A — asignar a candidato: bastoneo de un EID SIN match CON ≥1 candidato noTag → modo
//        `assign_or_create` (lista + buscador) → tocar candidato → confirmar → navega a la ficha de ESE
//        perfil + la caravana asignada aparece en la ficha al sincronizar (RPC + denorm 0079 end-to-end).
//   (b)  opción A — "es nuevo": misma intermedia → "Es un animal nuevo → dar de alta" → /crear-animal con
//        el EID precargado read-only.
//   (a') 0 candidatos → CREATE directo (RD3.2): bastoneo SIN match SIN candidatos noTag → va directo al
//        modo `create` (no abre la intermedia "¿Es uno de tus animales sin caravana?").
//   (c)  opción B — masiva 1×1 + contador: en BulkTagAssignmentScreen, bastonear 2 EIDs nuevos distintos,
//        asignar cada uno a un candidato → el contador llega a 2 y los 2 candidatos salen de la lista.
//   (d)  opción B — dup prevención (RD6.1): bastonear un EID YA asignado NO encola y avisa, la sesión sigue.
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown.

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  waitForServerTagAssigned,
  RUN_TAG,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ─── EIDs FDX-B válidos (15 díg). Únicos por corrida para no chocar con el unique GLOBAL de
//     animals.tag_electronic; cada test/bastoneo genera el suyo. ───
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

/** Formato legible del EID en los encabezados (espeja utils/eid-format: PPP NNNN NNNN NNNN). */
function eidReadable(eid: string): string {
  return `${eid.slice(0, 3)} ${eid.slice(3, 7)} ${eid.slice(7, 11)} ${eid.slice(11, 15)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) OPCIÓN A — asignar a candidato: EID sin match CON candidatos → intermedia → elegir candidato →
//     confirmar → ficha del candidato con la caravana asignada (al sincronizar, end-to-end RPC + denorm).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) opción A: bastoneo sin match con candidatos → asignar candidato → ficha correcta + caravana puesta', async ({ page }) => {
  const user = await createTestUser('dedup-a-assign');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Dedup A');

  // El candidato AL QUE asignamos (sin caravana) + un distractor (para que la lista NO sea trivial de 1).
  const targetVisual = `${RUN_TAG}-A-TARGET`;
  const targetProfileId = await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '4001', visualAlt: targetVisual, sex: 'female' });
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '4002', visualAlt: `${RUN_TAG}-A-OTHER`, sex: 'male' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Esperamos a que los candidatos BAJEN por la stream (visibles = ya sincronizó al SQLite local).
  await gotoAnimales(page);
  await expect(page.getByText('4001', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('4002', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Bastoneo de un EID SIN match + ≥1 candidato sin caravana → modo assign_or_create (RD3.1), NO create directo.
  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await expect(page.getByText('¿Es uno de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
  // La intermedia ofrece el buscador + el CTA "es nuevo" (una decisión por pantalla, CTA siempre a la vista).
  await expect(page.getByPlaceholder('Buscar por número o visual')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Es un animal nuevo → dar de alta' })).toBeVisible();

  // Tocar el candidato 4001 (su a11y label = "Asignar caravana a 4001, …") → paso de CONFIRMACIÓN.
  await page.getByRole('button', { name: /^Asignar caravana a 4001,/ }).click();
  await expect(page.getByText('Le vas a asignar la caravana', { exact: false })).toBeVisible({ timeout: 15_000 });
  // Confirmar → el flujo de asignación se invoca (assignTagToAnimal, offline) → navega a la ficha del candidato.
  await page.getByRole('button', { name: 'Asignar caravana', exact: true }).click();

  // Aterriza en la ficha del candidato 4001 (bloque "Identificación" + su visual) = el flujo de asignación
  // navegó al perfil CORRECTO (RD3.6). El overlay se cerró (la intermedia ya no está).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('¿Es uno de tus animales sin caravana?', { exact: true })).toHaveCount(0);
  await expect(page.getByText(targetVisual, { exact: true })).not.toHaveCount(0);

  // PRUEBA END-TO-END de que SE ASIGNÓ (no solo que se navegó): el assign encolado offline SINCRONIZA → el
  // connector llama al RPC assign_tag_to_animal (0089) → setea animals.tag_electronic → el trigger 0079
  // propaga a animal_profiles.animal_tag_electronic. Verificamos AMBOS lados de la cadena en el SERVER (vía
  // service_role) en el perfil del candidato elegido. NO lo verificamos en la ficha porque es una lectura
  // LOCAL no-reactiva (useFocusEffect una sola vez) → muestra "sin caravana" hasta el próximo sync + re-focus
  // (staleness offline-first documentada, design §3.3); el oráculo server prueba la persistencia real.
  await waitForServerTagAssigned(targetProfileId, eid);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) OPCIÓN A — "es nuevo": misma intermedia → "Es un animal nuevo" → /crear-animal con el EID precargado.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) opción A: intermedia → "es nuevo" → crear-animal con el EID precargado read-only', async ({ page }) => {
  const user = await createTestUser('dedup-a-new');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Dedup A New');

  // Un candidato sin caravana → la intermedia se abre (≥1 candidato). Pero el operario dice "es nuevo".
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '4100', visualAlt: `${RUN_TAG}-AN`, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  await gotoAnimales(page);
  await expect(page.getByText('4100', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByText('¿Es uno de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });

  // "Es un animal nuevo → dar de alta" → cierra la intermedia + navega a crear-animal con el EID precargado.
  await page.getByRole('button', { name: 'Es un animal nuevo → dar de alta' }).click();

  // El wizard de alta muestra "Creando: [EID]" (el EID crudo, read-only — RB6.3 / RD3.7). Esa es la prueba.
  await expect(page.getByText(`Creando: ${eid}`, { exact: true })).toBeVisible({ timeout: 20_000 });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a') 0 candidatos → CREATE directo (RD3.2): sin candidatos noTag, la intermedia NO se abre (sería fricción
//      pura). El overlay va directo al modo `create` ("Animal nuevo" + "Dar de alta").
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a\') opción A: bastoneo sin match SIN candidatos noTag → CREATE directo (no abre la intermedia)', async ({ page }) => {
  const user = await createTestUser('dedup-a-zero');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Dedup A Zero');

  // Un animal CON caravana (NO es candidato noTag) → el campo tiene 0 candidatos sin caravana. Lo sembramos
  // para que el campo no esté vacío (y para esperar el first-sync), pero NO debe ofrecerse la intermedia.
  const otherEid = makeEid();
  await seedAnimal(establishmentId, rodeoId, { tag: otherEid, idv: '4200', visualAlt: `${RUN_TAG}-Z`, sex: 'male' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  await gotoAnimales(page);
  await expect(page.getByText('4200', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Bastoneo de un EID NUEVO sin match → como NO hay candidatos noTag, va directo a CREATE (RD3.2).
  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Modo `create` directo: "Animal nuevo" + "Dar de alta". NUNCA la intermedia (no hay a quién asignar).
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Dar de alta', exact: true })).toBeVisible();
  await expect(page.getByText('¿Es uno de tus animales sin caravana?', { exact: true })).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (c) OPCIÓN B — masiva 1×1 + contador: bastonear 2 EIDs nuevos distintos, asignar cada uno a un candidato
//     → el contador llega a 2 y los 2 candidatos salen de la lista de la sesión (excluidos client-side).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(c) opción B: masiva — 2 bastoneos → asignar a 2 candidatos → contador en 2 + ambos salen de la lista', async ({ page }) => {
  const user = await createTestUser('dedup-b-bulk');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Dedup B');

  // EXACTAMENTE 2 candidatos sin caravana: tras asignar el 1º, debe salir de la sesión y NO re-aparecer al
  // bastonear el 2º EID (RD2.5 / excludedProfileIds). El 2º candidato cubre el 2º bastoneo.
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '5001', visualAlt: `${RUN_TAG}-B1`, sex: 'female' });
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '5002', visualAlt: `${RUN_TAG}-B2`, sex: 'male' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Esperamos a que AMBOS candidatos bajen al SQLite local (visibles = sincronizado).
  await gotoAnimales(page);
  await expect(page.getByText('5001', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('5002', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Entramos a la masiva por el entry point de la tab Animales (filtro noTag → CTA).
  await page.getByRole('button', { name: 'Filtrar animales sin caravana electrónica' }).click();
  await page.getByRole('button', { name: 'Asignar caravanas en masa' }).click();
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Contador arranca en 0.
  await expect(page.getByLabel('0 caravanas asignadas')).toBeVisible();

  // ── 1er EID → entra a la cola → lista de candidatos → asignar a 5001 → contador 1, queue vacía. ──
  const eid1 = makeEid();
  await bastonazo(page, eid1);
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid1), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Asignar caravana a 5001,/ }).click();
  await expect(page.getByText('Le vas a asignar la caravana', { exact: false })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Asignar caravana', exact: true }).click();

  // Tras asignar el 1º: la cola se vacía → vuelve a "Bastoneá para empezar"; el contador subió a 1.
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('1 caravana asignada')).toBeVisible();

  // ── 2do EID (distinto) → lista de candidatos. El 5001 ya NO debe aparecer (salió de la sesión, RD2.5). ──
  const eid2 = makeEid();
  await bastonazo(page, eid2);
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid2), { exact: true })).toBeVisible();
  // El candidato YA asignado (5001) salió de la lista de candidatos de la sesión.
  await expect(page.getByRole('button', { name: /^Asignar caravana a 5001,/ })).toHaveCount(0);
  // Asignar el 2do EID al 5002.
  await page.getByRole('button', { name: /^Asignar caravana a 5002,/ }).click();
  await expect(page.getByText('Le vas a asignar la caravana', { exact: false })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Asignar caravana', exact: true }).click();

  // Tras asignar el 2º: contador en 2, cola vacía. Ambos candidatos salieron de la lista de la sesión: al
  // bastonear un 3er EID, NO queda ninguno de los 2 para asignar (la lista de candidatos queda vacía).
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('2 caravanas asignadas')).toBeVisible();

  const eid3 = makeEid();
  await bastonazo(page, eid3);
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^Asignar caravana a 5001,/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Asignar caravana a 5002,/ })).toHaveCount(0);
  // No hay más candidatos sin caravana en la sesión: la lista lo dice explícitamente.
  await expect(page.getByText('No hay animales sin caravana en este campo.', { exact: true })).toBeVisible({ timeout: 15_000 });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (d) OPCIÓN B — dup prevención (RD6.1): bastonear un EID que YA tiene caravana NO encola y avisa, la sesión
//     no se pierde. Defensa primaria client-side (lookupByTag al bastonear), NO espera el rechazo del sync.
//     (Consolidado en la suite formal; existía en dedup-screenshot.spec.ts como red de seguridad.)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(d) opción B: bastonear un EID ya asignado NO encola y avisa (prevención client-side, RD6.1)', async ({ page }) => {
  const user = await createTestUser('dedup-b-dup');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Dedup B Dup');

  // EID YA usado: sembrado en un animal CON caravana (mode 'edit' al bastonearlo). 15 díg FDX-B válido.
  const usedEid = makeEid();
  await seedAnimal(establishmentId, rodeoId, { tag: usedEid, idv: '6001', visualAlt: `${RUN_TAG}-DUP`, sex: 'male' });
  // Un candidato SIN caravana, para confirmar que la lista NO se ofrece para el EID dup.
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '6050', visualAlt: `${RUN_TAG}-FREE`, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // El animal CON caravana debe estar local (visible = sincronizado) para que lookupByTag lo encuentre.
  await gotoAnimales(page);
  await expect(page.getByText('6001', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('6050', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Filtrar animales sin caravana electrónica' }).click();
  await page.getByRole('button', { name: 'Asignar caravanas en masa' }).click();
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Bastoneo del EID YA asignado → lookupByTag resuelve 'edit' → NO encola + banner de dup.
  await bastonazo(page, usedEid);
  await expect(page.getByText('Esa caravana ya está asignada', { exact: true })).toBeVisible({ timeout: 15_000 });

  // INVARIANTE (RD6.1): la cola NO avanzó → seguimos en "Bastoneá para empezar", NO en la pantalla de
  // candidatos. El EID dup nunca entró a la cola; el progreso de la sesión no se pierde.
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible();
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toHaveCount(0);

  // Tras descartar el aviso, un EID NUEVO sin match SÍ entra a la cola (la prevención no rompe el flujo).
  await page.getByRole('button', { name: 'Entendido' }).click();
  await bastonazo(page, makeEid());
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
});
