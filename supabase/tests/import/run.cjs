// supabase/tests/import/run.cjs
// Suite de tests del BACKEND de la spec 12 (12-import-rodeo, Fase 2):
//   - tabla import_log (audit, RLS owner/vet + trigger imported_by forzado + CHECK error_details/file_name)
//   - RPC import_rodeo_bulk (SECURITY DEFINER, los 5 controles de R9.4 + import parcial por-fila)
//
// Corre contra la base remota usando service_role para fixtures y JWTs reales para los asserts
// de RLS/RPC. Limpia los users/establishments creados al final (CASCADE en establishments;
// users vía admin). Mismo patrón que supabase/tests/user_private/run.cjs y supabase/tests/animal/run.cjs.
//
// ⚠️ Estos tests pasan verde RECIÉN DESPUÉS de aplicar las migraciones 0073 + 0074 al remoto
// (las aplica el implementer del backend vía Management API, ya hecho). Hasta el apply, fallan por
// "tabla/función inexistente".
//
// Trazabilidad R<n> → test en progress/impl_12-backend.md.
//
// Cubre:
//   T2.4 (R9.3, R11.2, R11.3, R11.4, R2.4) — import_log: cross-tenant, imported_by forzado,
//        field_operator NO inserta, error_details gigante rechazado por el CHECK.
//   T2.5 (R9.2, R9.4, R8.1, R8.2) — RPC: owner/vet inserta; rol solo en otro est rechazado;
//        rodeo de otro est rechazado; field_operator rechazado; EXECUTE no a anon/public;
//        import parcial (TAG duplicado en el batch → esa fila se saltea, el resto entra).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const envLocalPath = path.join(REPO_ROOT, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envText = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

const supabaseJsPath = path.join(REPO_ROOT, 'app', 'node_modules', '@supabase', 'supabase-js');
const { createClient: createClientRaw } = require(supabaseJsPath);
const ws = require(path.join(REPO_ROOT, 'app', 'node_modules', 'ws'));

function createClient(url, key, opts = {}) {
  return createClientRaw(url, key, {
    ...opts,
    realtime: { ...(opts.realtime || {}), transport: ws },
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Faltan vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN_TAG = `import_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

// ---- retry anti-transitorio (remoto COMPARTIDO con otras suites del pipeline) --------------
// En `node scripts/check.mjs` el remoto recibe corridas concurrentes: un write legítimo del SETUP
// (establishment/rol/rodeo) puede recibir un error transitorio (deadlock/serialization/cancel/conexión)
// y, si lo dejábamos pasar, `rodeoA` quedaba undefined → los tests del RPC caían con "función inexistente"
// (el param p_rodeo_id undefined se dropea del JSON de PostgREST). Reintenta SOLO errores realmente
// transitorios; un error determinista (RLS 42501, unique, etc.) se devuelve tal cual (NO se enmascara
// un bug real reintentando algo que nunca va a pasar). Mismo patrón que supabase/tests/maneuvers/run.cjs.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Códigos Postgres transitorios: serialization_failure, deadlock_detected, query_canceled,
// connection_failure, connection_does_not_exist. NO se listan errores deterministas a propósito.
const TRANSIENT_PG_CODES = new Set(['40001', '40P01', '57014', '08006', '08003', '53300', '57P01']);

function isTransient(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (TRANSIENT_PG_CODES.has(code)) return true;
  // PostgREST a veces no propaga el code SQLSTATE: caemos al mensaje para deadlock/timeout/conexión.
  const msg = String(error.message || '').toLowerCase();
  return /deadlock|timeout|timed out|connection|temporarily unavailable|too many connections/.test(msg);
}

// Reintenta una operación de SETUP que esperamos que pase. `fn` puede devolver {error} (estilo
// supabase-js) o lanzar; en ambos casos, si el error es transitorio, reintenta con backoff corto.
async function setupWithRetry(label, fn, { tries = 4, delay = 500 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fn();
      // Estilo supabase-js: {data, error}. Si error transitorio → reintenta; si determinista → throw ruidoso.
      if (res && res.error) {
        if (isTransient(res.error) && i < tries - 1) {
          lastErr = res.error;
          await sleep(delay * (i + 1));
          continue;
        }
        throw new Error(`${label}: ${res.error.message}`);
      }
      return res;
    } catch (err) {
      if (isTransient(err) && i < tries - 1) {
        lastErr = err;
        await sleep(delay * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: agotados ${tries} intentos (último transitorio: ${lastErr && lastErr.message})`);
}

// ---- helpers de fixtures --------------------------------------------------

async function createTestUser(label) {
  const email = `${RUN_TAG}_${label}@rafaq-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: `Test ${label}` },
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function getUserClient(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

// El que crea el establishment queda owner (trigger 0011 auto-owner).
async function createEstablishmentAs(userClient, name) {
  await setupWithRetry(`createEstablishment insert(${name})`, () =>
    userClient.from('establishments').insert({ name, province: 'Buenos Aires' }),
  );
  const { data, error } = await setupWithRetry(`createEstablishment select(${name})`, () =>
    userClient.from('establishments').select('id').eq('name', name).single(),
  );
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  assert.ok(data && data.id, `createEstablishment(${name}): no se obtuvo id`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function assignRoleAsService(userId, establishmentId, role) {
  await setupWithRetry(`assignRole(${role})`, () =>
    admin.from('user_roles').insert({ user_id: userId, establishment_id: establishmentId, role, active: true }),
  );
}

async function lookupSpeciesSystem(client, speciesCode = 'bovino', systemCode = 'cria') {
  const { data: sp, error: spErr } = await client
    .from('species').select('id').eq('code', speciesCode).single();
  if (spErr) throw new Error(`lookup species: ${spErr.message}`);
  const { data: sys, error: sysErr } = await client
    .from('systems_by_species').select('id').eq('species_id', sp.id).eq('code', systemCode).single();
  if (sysErr) throw new Error(`lookup system: ${sysErr.message}`);
  return { speciesId: sp.id, systemId: sys.id };
}

// Owner crea un rodeo (bovino, cria). Devuelve { id, systemId }. FALLA RUIDOSO si no se crea
// (un rodeo undefined cascadea en "RPC inexistente" porque el p_rodeo_id undefined se dropea del JSON).
async function createRodeo(client, { establishmentId, name }) {
  const { speciesId, systemId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  await setupWithRetry(`createRodeo insert(${name})`, () =>
    client.from('rodeos').insert({
      establishment_id: establishmentId,
      name,
      species_id: speciesId,
      system_id: systemId,
    }),
  );
  const { data, error } = await setupWithRetry(`createRodeo select(${name})`, () =>
    client
      .from('rodeos')
      .select('id, system_id')
      .eq('establishment_id', establishmentId)
      .eq('name', name)
      .single(),
  );
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  assert.ok(data && data.id, `createRodeo(${name}): no se obtuvo id (rodeo no creado)`);
  return { id: data.id, systemId: data.system_id };
}

// Una fila válida para el RPC (sólo identidad mínima: idv + sexo).
// IDU (0122): visual_id_alt se eliminó; la caravana visual es ahora el idv alfanumérico → el import_rodeo_bulk
// re-creado ya NO lee visual_id_alt. Los fixtures usan idv como identificador mínimo buscable.
function makeRow(i, extra = {}) {
  return {
    row_index: i,
    sex: extra.sex || 'female',
    tag_electronic: extra.tag_electronic ?? null,
    idv: extra.idv ?? `${RUN_TAG}_v${i}`,
    birth_date: extra.birth_date ?? null,
    breed: extra.breed ?? null,
    category_code: extra.category_code ?? null,
    category_override: extra.category_override ?? false,
    management_group_id: extra.management_group_id ?? null,
  };
}

// Junta TODOS los animal_id de los perfiles de estos establishments, paginando.
// POR QUÉ PAGINAR: PostgREST topa cada respuesta a 1000 filas por default. El test de borde
// importa 5000 filas (todas con perfil); un `.select(...).in('establishment_id', ests)` sin
// paginar devolvía solo las primeras ~1000 → el cleanup borraba ~1000 `animals` y el CASCADE del
// establishment cascadeaba los 5000 `animal_profiles`, dejando ~4000 `animals` HUÉRFANOS por
// corrida (animals NO tiene establishment_id, así que NO cascadea del establishment: hay que
// borrarlas explícitas y por eso recuperar TODOS los ids es crítico). Keyset por la PK estable
// `id` (no offset/range: es robusto ante inserts/deletes concurrentes del remoto compartido).
async function collectAllAnimalIds(ests) {
  const PAGE = 1000; // = cap de PostgREST por respuesta
  const ids = new Set();
  let after = null; // último id de la página previa (keyset)
  for (;;) {
    let q = admin
      .from('animal_profiles')
      .select('id, animal_id')
      .in('establishment_id', ests)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(`collectAllAnimalIds: ${error.message}`);
    const page = data || [];
    for (const p of page) {
      if (p.animal_id) ids.add(p.animal_id);
    }
    if (page.length < PAGE) break; // última página
    after = page[page.length - 1].id;
  }
  return [...ids];
}

async function cleanup() {
  // Splice los arrays a medida que se borran, para que el cleanup de la 2da suite no reintente
  // borrar los fixtures de la 1ra (ambas suites comparten estos arrays module-global).
  const ests = createdEstablishmentIds.splice(0);
  if (ests.length > 0) {
    // OJO: `animals` NO tiene establishment_id; el CASCADE del establishment borra `animal_profiles`
    // (FK 0020:15) pero deja los `animals` HUÉRFANOS. Con el test de borde de 5000 filas eso sería
    // litter grande en el remoto compartido. Borramos los animals de NUESTROS profiles ANTES del
    // CASCADE (el delete de animals SÍ cascadea a sus profiles — FK 0020:14 on delete cascade).
    try {
      // Recuperar TODOS los animal_id (paginado: el test de borde deja 5000 perfiles y PostgREST
      // tope a 1000/respuesta — sin paginar quedaban ~4000 animals huérfanos por corrida).
      const animalIds = await collectAllAnimalIds(ests);
      // Borrar en chunks (el test de borde puede dejar ~5000 animals; evitamos un IN gigante).
      for (let i = 0; i < animalIds.length; i += 500) {
        const chunk = animalIds.slice(i, i + 500);
        await setupWithRetry('cleanup animals', () => admin.from('animals').delete().in('id', chunk));
      }
    } catch (e) {
      console.error('cleanup animals (orphan-avoidance):', e.message);
    }
    // Retry transitorio: un delete que flakea deja fixtures huérfanos en el remoto compartido.
    // Los nombres son únicos por corrida (RUN_TAG), así que un huérfano no colisiona, pero limpiamos igual.
    try {
      await setupWithRetry('cleanup establishments', () =>
        admin.from('establishments').delete().in('id', ests),
      );
    } catch (e) {
      console.error('cleanup establishments:', e.message);
    }
  }
  const uids = createdUserIds.splice(0);
  for (const uid of uids) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

// =====================================================================
// import_log — RLS owner/vet + imported_by forzado + CHECKs.  T2.4
// =====================================================================

test('spec 12 — import_log (audit RLS owner/vet, imported_by forzado, CHECKs)', async (t) => {
  let ownerA, vetA, opA, outsider;
  let ownerClientA, vetClientA, opClientA, outsiderClient;
  let estA, rodeoA;

  await t.test('setup: estA con owner + vet + field_operator; outsider sin rol', async () => {
    ownerA = await createTestUser('logOwnerA');
    vetA = await createTestUser('logVetA');
    opA = await createTestUser('logOpA');
    outsider = await createTestUser('logOutsider');

    ownerClientA = await getUserClient(ownerA.email);
    vetClientA = await getUserClient(vetA.email);
    opClientA = await getUserClient(opA.email);
    outsiderClient = await getUserClient(outsider.email);

    estA = await createEstablishmentAs(ownerClientA, `${RUN_TAG} estA`);
    await assignRoleAsService(vetA.id, estA, 'veterinarian');
    await assignRoleAsService(opA.id, estA, 'field_operator');

    const r = await createRodeo(ownerClientA, { establishmentId: estA, name: `${RUN_TAG} Rodeo principal` });
    rodeoA = r.id;

    // Fail loud: si el setup no dejó estA/rodeoA, abortamos ACÁ (en vez de cascadear errores
    // confusos en cada test del RPC por un p_rodeo_id undefined).
    assert.ok(estA, 'setup: estA no se creó');
    assert.ok(rodeoA, 'setup: rodeoA no se creó');
  });

  // R11.3: imported_by se FUERZA aunque el payload mande otro uuid.
  await t.test('T2.4 R11.3: owner inserta import_log; imported_by se fuerza a auth.uid() (ignora el payload)', async () => {
    const { error: insErr } = await ownerClientA.from('import_log').insert({
      establishment_id: estA,
      rodeo_id: rodeoA,
      file_name: 'padron.csv',
      file_format: 'csv',
      total_records: 10,
      imported_ok: 9,
      imported_errors: 1,
      // Intento de spoofear la autoría: mandamos el uuid del outsider.
      imported_by: outsider.id,
    });
    assert.equal(insErr, null, insErr && insErr.message);

    const { data, error } = await ownerClientA
      .from('import_log')
      .select('imported_by, file_name')
      .eq('establishment_id', estA)
      .eq('file_name', 'padron.csv')
      .single();
    assert.equal(error, null, error && error.message);
    assert.equal(data.imported_by, ownerA.id, 'imported_by debe ser el caller (owner), no el uuid del payload');
    assert.notEqual(data.imported_by, outsider.id, 'el imported_by spoofeado NO debe persistir');
  });

  // R11.2: el vet puede insertar (es uno de los roles que importan).
  await t.test('T2.4 R2.4/R11.2: el veterinarian SÍ puede insertar import_log', async () => {
    const { error } = await vetClientA.from('import_log').insert({
      establishment_id: estA,
      rodeo_id: rodeoA,
      file_name: 'padron-vet.csv',
      file_format: 'csv',
      total_records: 5,
    });
    assert.equal(error, null, error && error.message);
  });

  // R2.4: field_operator NO puede insertar (la policy de INSERT exige owner o vet).
  await t.test('T2.4 R2.4: field_operator NO puede insertar import_log (solo owner/vet)', async () => {
    const { error } = await opClientA.from('import_log').insert({
      establishment_id: estA,
      rodeo_id: rodeoA,
      file_name: 'padron-op.csv',
      file_format: 'csv',
      total_records: 3,
    });
    assert.notEqual(error, null, 'el field_operator no debería poder insertar en import_log');
    // Verificación adversarial: NO quedó la fila escrita.
    const { data } = await admin
      .from('import_log')
      .select('id')
      .eq('establishment_id', estA)
      .eq('file_name', 'padron-op.csv');
    assert.deepEqual(data, [], 'no debería haber quedado un import_log del field_operator');
  });

  // R11.2 (cross-tenant): el outsider (sin rol en estA) NO ve ni escribe los import_log de estA.
  await t.test('T2.4 R11.2: outsider sin rol en estA NO ve los import_log de estA', async () => {
    const { data, error } = await outsiderClient
      .from('import_log')
      .select('id, file_name')
      .eq('establishment_id', estA);
    assert.equal(error, null, error && error.message);
    assert.deepEqual(data, [], 'un usuario sin rol en estA no debería ver sus import_log (RLS scope)');
  });

  await t.test('T2.4 R11.2: outsider sin rol en estA NO puede insertar import_log en estA', async () => {
    const { error } = await outsiderClient.from('import_log').insert({
      establishment_id: estA,
      rodeo_id: rodeoA,
      file_name: 'padron-cross.csv',
      file_format: 'csv',
      total_records: 1,
    });
    assert.notEqual(error, null, 'un outsider no debería poder escribir un import_log cross-tenant');
  });

  // R11.4: error_details que excede el CHECK octet_length (256 KiB) es rechazado por la DB.
  await t.test('T2.4 R11.4: error_details > 256KB es rechazado por el CHECK octet_length', async () => {
    // jsonb con un string de ~300KB → octet_length del serializado supera 262144.
    const huge = { blob: 'x'.repeat(300 * 1024) };
    const { error } = await ownerClientA.from('import_log').insert({
      establishment_id: estA,
      rodeo_id: rodeoA,
      file_name: 'padron-huge.csv',
      file_format: 'csv',
      total_records: 5000,
      error_details: huge,
    });
    assert.notEqual(error, null, 'un error_details > 256KB debería ser rechazado por el CHECK');
    assert.match(
      (error.message || '') + (error.details || ''),
      /error_details|check|violates/i,
      'el rechazo debería venir del CHECK de error_details',
    );
    // Un error_details chico SÍ entra (sanity del CHECK no es un falso positivo).
    const { error: okErr } = await ownerClientA.from('import_log').insert({
      establishment_id: estA,
      rodeo_id: rodeoA,
      file_name: 'padron-small.csv',
      file_format: 'csv',
      total_records: 2,
      error_details: { count_by_reason: { duplicate: 1 }, sample: [{ row_index: 3, reason: 'duplicate' }] },
    });
    assert.equal(okErr, null, okErr && okErr.message);
  });

  // R11.4: file_name > 255 chars es rechazado por el CHECK char_length.
  await t.test('T2.4 R11.4: file_name > 255 chars es rechazado por el CHECK char_length', async () => {
    const { error } = await ownerClientA.from('import_log').insert({
      establishment_id: estA,
      rodeo_id: rodeoA,
      file_name: 'a'.repeat(300) + '.csv',
      file_format: 'csv',
    });
    assert.notEqual(error, null, 'un file_name > 255 debería ser rechazado por el CHECK');
  });

  await t.test('cleanup', async () => {
    await cleanup();
  });
});

// =====================================================================
// RPC import_rodeo_bulk — 5 controles de R9.4 + import parcial.  T2.5
// =====================================================================

test('spec 12 — RPC import_rodeo_bulk (SECURITY DEFINER, authz + import parcial)', async (t) => {
  let ownerA, vetA, opA, outsider, ownerB;
  let ownerClientA, vetClientA, opClientA, outsiderClient, ownerClientB;
  let estA, rodeoA, estB, rodeoB;

  await t.test('setup: estA (owner/vet/op) + estB (otro owner); rodeoA, rodeoB', async () => {
    ownerA = await createTestUser('rpcOwnerA');
    vetA = await createTestUser('rpcVetA');
    opA = await createTestUser('rpcOpA');
    outsider = await createTestUser('rpcOutsider');
    ownerB = await createTestUser('rpcOwnerB');

    ownerClientA = await getUserClient(ownerA.email);
    vetClientA = await getUserClient(vetA.email);
    opClientA = await getUserClient(opA.email);
    outsiderClient = await getUserClient(outsider.email);
    ownerClientB = await getUserClient(ownerB.email);

    estA = await createEstablishmentAs(ownerClientA, `${RUN_TAG} rpc estA`);
    await assignRoleAsService(vetA.id, estA, 'veterinarian');
    await assignRoleAsService(opA.id, estA, 'field_operator');
    rodeoA = (await createRodeo(ownerClientA, { establishmentId: estA, name: `${RUN_TAG} Rodeo A` })).id;

    estB = await createEstablishmentAs(ownerClientB, `${RUN_TAG} rpc estB`);
    rodeoB = (await createRodeo(ownerClientB, { establishmentId: estB, name: `${RUN_TAG} Rodeo B` })).id;

    // Fail loud: sin rodeoA/rodeoB todos los tests del RPC cascadean en "función inexistente"
    // (p_rodeo_id undefined se dropea del JSON de PostgREST). Abortamos ruidosamente acá.
    assert.ok(estA && rodeoA, 'setup: estA/rodeoA no se crearon');
    assert.ok(estB && rodeoB, 'setup: estB/rodeoB no se crearon');
  });

  // R9.4 (a): owner del est correcto → inserta. Verifica que animals+profiles quedaron escritos.
  await t.test('T2.5 R8.1: owner del est correcto importa 2 filas → inserta animals+profiles', async () => {
    const rows = [makeRow(0), makeRow(1)];
    const { data, error } = await ownerClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: rows,
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.imported_ok, 2, 'deberían entrar las 2 filas');
    assert.equal(data.imported_errors, 0, 'sin errores');

    // Verificación: los 2 perfiles existen en estA, en rodeoA, con establishment derivado del rodeo.
    const { data: profs, error: pErr } = await admin
      .from('animal_profiles')
      .select('id, establishment_id, rodeo_id, idv, created_by')
      .eq('rodeo_id', rodeoA)
      .like('idv', `${RUN_TAG}_v%`);
    assert.equal(pErr, null, pErr && pErr.message);
    assert.equal(profs.length, 2, 'deberían existir 2 animal_profiles del import');
    for (const p of profs) {
      assert.equal(p.establishment_id, estA, 'establishment_id debe ser el del rodeo (no del payload)');
      assert.equal(p.created_by, ownerA.id, 'created_by debe ser el caller (trigger 0043), no del payload');
    }
  });

  // R9.4 (a): el vet del est también puede importar.
  await t.test('T2.5 R9.4: el veterinarian del est correcto SÍ puede importar', async () => {
    const { data, error } = await vetClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: [makeRow(100, { idv: `${RUN_TAG}_vet100` })],
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.imported_ok, 1);
  });

  // R9.4 (a): field_operator del est → RECHAZADO a nivel DB (cierra MEDIUM-3).
  await t.test('T2.5 R9.4/R2.4: field_operator del est → RECHAZADO (raise exception adentro del RPC)', async () => {
    const { data, error } = await opClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: [makeRow(200, { idv: `${RUN_TAG}_op200` })],
    });
    assert.notEqual(error, null, 'el field_operator no debería poder llamar el bulk insert');
    assert.match(error.message || '', /owner|veterinarian|not/i, 'el rechazo debe ser por authz de rol');
    // Adversarial: NO se escribió ningún perfil.
    const { data: profs } = await admin
      .from('animal_profiles')
      .select('id')
      .eq('rodeo_id', rodeoA)
      .like('idv', `${RUN_TAG}_op200`);
    assert.deepEqual(profs, [], 'no debería haber quedado un perfil del field_operator');
  });

  // R9.4 (a) cross-tenant: outsider con rol SOLO en otro est (B) → rechazado al importar a rodeoA.
  await t.test('T2.5 R9.4: caller con rol solo en OTRO est (ownerB) → RECHAZADO al importar a rodeoA', async () => {
    const { error } = await ownerClientB.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA, // rodeo de estA; ownerB no tiene rol en estA
      p_rows: [makeRow(300, { idv: `${RUN_TAG}_b300` })],
    });
    assert.notEqual(error, null, 'ownerB no debería poder importar a un rodeo de estA');
    assert.match(error.message || '', /owner|veterinarian|not/i, 'el rechazo debe ser por authz de rol');
  });

  // R9.2 / R9.4 (b): un caller (ownerA) que apunta a un rodeo de OTRO est (rodeoB) → rechazado.
  // ownerA no tiene rol en estB (el est del rodeoB), así que la re-validación de rol falla.
  await t.test('T2.5 R9.2/R9.4: p_rodeo_id de otro est (rodeoB) → RECHAZADO', async () => {
    const { error } = await ownerClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoB, // rodeo de estB; ownerA no tiene rol en estB
      p_rows: [makeRow(400, { idv: `${RUN_TAG}_cross400` })],
    });
    assert.notEqual(error, null, 'no debería poder escribir a un rodeo de otro establishment');
    // Adversarial: rodeoB no recibió el perfil.
    const { data: profs } = await admin
      .from('animal_profiles')
      .select('id')
      .eq('rodeo_id', rodeoB)
      .like('idv', `${RUN_TAG}_cross400`);
    assert.deepEqual(profs, [], 'no debería haber quedado un perfil en rodeoB');
  });

  // R9.4 (b): rodeo inexistente → rechazado.
  await t.test('T2.5 R9.4: p_rodeo_id inexistente → RECHAZADO', async () => {
    const { error } = await ownerClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: crypto.randomUUID(),
      p_rows: [makeRow(500)],
    });
    assert.notEqual(error, null, 'un rodeo inexistente debería ser rechazado');
  });

  // R9.4 (d): anon NO puede ejecutar el RPC (EXECUTE revocado de anon/public).
  await t.test('T2.5 R9.4: anon NO puede ejecutar import_rodeo_bulk (EXECUTE revocado)', async () => {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await anonClient.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: [makeRow(600)],
    });
    assert.notEqual(error, null, 'anon no debería poder ejecutar el RPC');
  });

  // R8.2 / R8.4: import parcial — una fila con TAG duplicado dentro del batch se saltea, el resto entra.
  await t.test('T2.5 R8.2/R8.4: TAG duplicado en el batch → esa fila se saltea, el resto entra (import parcial)', async () => {
    const dupTag = `9820000${Date.now().toString().slice(-8)}`; // 15 díg aprox., único de la corrida
    const rows = [
      makeRow(700, { tag_electronic: dupTag, idv: `${RUN_TAG}_dup700` }),
      makeRow(701, { tag_electronic: dupTag, idv: `${RUN_TAG}_dup701` }), // mismo TAG → colisión unique
      makeRow(702, { idv: `${RUN_TAG}_dup702` }),
    ];
    const { data, error } = await ownerClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: rows,
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.imported_ok, 2, 'la 1ra con TAG + la 3ra entran (2 OK)');
    assert.equal(data.imported_errors, 1, 'la 2da (TAG duplicado) se saltea (1 error), NO aborta el chunk');
    const errRows = (data.errors || []).map((e) => e.row_index);
    assert.ok(errRows.includes(701), 'la fila reportada como error debe ser la del TAG duplicado (701)');
    // Adversarial: el TAG existe exactamente una vez (la 1ra), la 3ra entró sin TAG.
    const { data: withTag } = await admin
      .from('animals')
      .select('id')
      .eq('tag_electronic', dupTag)
      .is('deleted_at', null);
    assert.equal(withTag.length, 1, 'el TAG debe existir una sola vez (la 2da fila no se escribió)');
    const { data: third } = await admin
      .from('animal_profiles')
      .select('id')
      .eq('rodeo_id', rodeoA)
      .like('idv', `${RUN_TAG}_dup702`);
    assert.equal(third.length, 1, 'la 3ra fila (sin TAG) debe haber entrado pese al error de la 2da');
  });

  // R9.4 (e): un TAG > 64 chars (escapa la validación de largo del cliente) es rechazado por la DB
  // (CHECK char_length de 0070) DENTRO del RPC, como error de fila (no aborta el chunk).
  await t.test('T2.5 R9.5/R9.4(e): TAG > 64 chars → error de fila (CHECK 0070 enforça dentro del definer)', async () => {
    const rows = [
      makeRow(800, { tag_electronic: 'X'.repeat(80), idv: `${RUN_TAG}_long800` }),
      makeRow(801, { idv: `${RUN_TAG}_long801` }),
    ];
    const { data, error } = await ownerClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: rows,
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.imported_errors, 1, 'la fila con TAG > 64 debe caer como error de fila');
    assert.equal(data.imported_ok, 1, 'la otra fila entra (import parcial)');
    const errRows = (data.errors || []).map((e) => e.row_index);
    assert.ok(errRows.includes(800), 'la fila del TAG largo (800) debe estar reportada');
  });

  // SEC-12B-HIGH-01 (R3.2/R9.4): tope DURO de filas server-side. Un batch > 5000 filas se rechaza
  // ENTERO (no skip-and-report) y NO inserta NADA — el cap del cliente (R3.2) es UX/bypasseable con
  // curl; el RPC SECURITY DEFINER es la frontera autoritativa contra DoW/amplificación. Filas mínimas
  // (un idv único por fila) para que generar 5001 sea barato.
  await t.test('T2.5 SEC-12B-HIGH-01: batch > 5000 filas → RECHAZADO entero (cap server-side, nada se inserta)', async () => {
    const tooMany = 5001;
    const bigBatch = new Array(tooMany);
    for (let i = 0; i < tooMany; i += 1) {
      // fila mínima y barata: solo identidad (idv) + sexo. Prefijo único para el assert adversarial.
      bigBatch[i] = { row_index: i, sex: 'female', idv: `${RUN_TAG}_cap${i}` };
    }
    const { data, error } = await ownerClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: bigBatch,
    });
    // Rechazo del batch entero: error de RPC (no un resultado con errors[]).
    assert.notEqual(error, null, 'un batch > 5000 filas debería ser rechazado entero (no procesado fila a fila)');
    assert.equal(data, null, 'un batch rechazado no debería devolver un resultado de conteos');
    assert.match(
      error.message || '',
      /batch|max|5000|exceeds/i,
      'el rechazo debe ser por el tope de filas server-side',
    );
    // Adversarial: NO se escribió NINGUNA de las 5001 filas (rechazo antes del loop, no parcial).
    const { data: profs, error: pErr } = await admin
      .from('animal_profiles')
      .select('id')
      .eq('rodeo_id', rodeoA)
      .like('idv', `${RUN_TAG}_cap%`);
    assert.equal(pErr, null, pErr && pErr.message);
    assert.deepEqual(profs, [], 'un batch rechazado por el cap NO debe insertar ninguna fila');
  });

  // SEC-12B-HIGH-01 (orden): el authz corre ANTES del cap. Un field_operator que manda un batch > 5000
  // se rechaza por ROL (no por tamaño) → confirma que el cap no se evalúa antes del authz (no se filtra
  // info de tamaño a un caller no autorizado, y el authz sigue siendo la primera barrera).
  await t.test('T2.5 SEC-12B-HIGH-01: field_operator con batch > 5000 → rechazado por AUTHZ (cap es posterior)', async () => {
    const huge = new Array(5001);
    for (let i = 0; i < 5001; i += 1) {
      huge[i] = { row_index: i, sex: 'female', idv: `${RUN_TAG}_opcap${i}` };
    }
    const { error } = await opClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: huge,
    });
    assert.notEqual(error, null, 'field_operator con batch grande debe ser rechazado');
    // El mensaje debe ser el de AUTHZ (owner/veterinarian), NO el del cap (batch/max) → authz corre primero.
    assert.match(error.message || '', /owner|veterinarian|not/i, 'el rechazo debe venir del authz, no del cap');
    assert.doesNotMatch(error.message || '', /exceeds|max rows/i, 'el cap NO debe evaluarse antes del authz');
  });

  // SEC-12B-HIGH-01 (borde): exactamente 5000 filas SÍ pasa (el cap es estricto: rechaza > 5000, no >= 5000).
  // Esto evita un off-by-one que volviera el cap más restrictivo de lo que dice R3.2.
  await t.test('T2.5 SEC-12B-HIGH-01: batch de exactamente 5000 filas SÍ se procesa (borde del cap)', async () => {
    const exact = 5000;
    const okBatch = new Array(exact);
    for (let i = 0; i < exact; i += 1) {
      okBatch[i] = { row_index: i, sex: 'female', idv: `${RUN_TAG}_edge${i}` };
    }
    const { data, error } = await ownerClientA.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoA,
      p_rows: okBatch,
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.imported_ok, exact, 'las 5000 filas (borde) deben procesarse, no rechazarse por el cap');
    assert.equal(data.imported_errors, 0, 'sin errores de fila en el borde');
  });

  await t.test('cleanup', async () => {
    await cleanup();
  });
});
