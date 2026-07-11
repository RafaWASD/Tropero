// supabase/tests/treatments/run.cjs
// Suite RLS del delta `tratamientos` de spec 02 (tabla treatments + treatment_id en sanitary_events, 0123).
// Corre contra la base remota con service_role para fixtures y JWTs reales para el assertion.
//
// ⚠️ REQUIERE la migración 0123 APLICADA en el remoto (deploy gateado a Raf). Antes del apply, esta suite
//    FALLA (la tabla treatments no existe) → el hook en scripts/run-tests.mjs queda COMENTADO hasta el deploy
//    (patrón spec 12/14/M6). El leader la descomenta tras aplicar 0123.
//
// Cubre T6 (a)-(i) de tasks-tratamientos.md → RTR.7.1, RTR.7.2, RTR.7.3, RTR.7.5, RTR.7.7, RTR.7.8, RTR.1.9,
// RTR.1.10, RTR.2.7, RTR.2.8, RTR.6.1–RTR.6.3, RTR.3.2.
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node --test run.cjs
// Las vars se cargan automáticamente desde <repo>/.env.local si existe.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Resolve repo root y carga .env.local si existe.
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

const RUN_TAG = `trt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

async function createTestUser(label) {
  const email = `${RUN_TAG}_${label}@rafaq-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { name: `Test ${label}` },
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

async function createEstablishmentAs(userClient, name) {
  const { error: insErr } = await userClient.from('establishments').insert({ name, province: 'Buenos Aires' });
  if (insErr) throw new Error(`createEstablishment insert(${name}): ${insErr.message}`);
  const { data, error } = await userClient.from('establishments').select('id').eq('name', name).single();
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function assignRoleAsService(userId, establishmentId, role) {
  const { error } = await admin
    .from('user_roles').insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`assignRole: ${error.message}`);
}

async function lookupSpeciesSystem(client, speciesCode = 'bovino', systemCode = 'cria') {
  const { data: sp, error: spErr } = await client.from('species').select('id').eq('code', speciesCode).single();
  if (spErr) throw new Error(`lookup species: ${spErr.message}`);
  const { data: sys, error: sysErr } = await client
    .from('systems_by_species').select('id').eq('species_id', sp.id).eq('code', systemCode).single();
  if (sysErr) throw new Error(`lookup system: ${sysErr.message}`);
  return { speciesId: sp.id, systemId: sys.id };
}

async function categoryId(client, systemId, code) {
  const { data, error } = await client
    .from('categories_by_system').select('id').eq('system_id', systemId).eq('code', code).single();
  if (error) throw new Error(`lookup category ${code}: ${error.message}`);
  return data.id;
}

async function createRodeo(client, { establishmentId, name }) {
  const { speciesId, systemId } = await lookupSpeciesSystem(client);
  const { error: insErr } = await client
    .from('rodeos').insert({ establishment_id: establishmentId, name, species_id: speciesId, system_id: systemId });
  if (insErr) throw new Error(`createRodeo insert(${name}): ${insErr.message}`);
  const { data, error } = await client
    .from('rodeos').select('id, system_id').eq('establishment_id', establishmentId).eq('name', name).single();
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  return { id: data.id, systemId: data.system_id };
}

async function createAnimal(client, { sex = 'female', rodeoId, establishmentId, systemId }) {
  const { speciesId } = await lookupSpeciesSystem(client);
  const animalId = crypto.randomUUID();
  const { error: aErr } = await client.from('animals').insert({ id: animalId, sex, species_id: speciesId });
  if (aErr) throw new Error(`createAnimal animals: ${aErr.message}`);
  const catId = await categoryId(client, systemId, sex === 'male' ? 'torito' : 'vaquillona');
  const profileId = crypto.randomUUID();
  const { error: pErr } = await client.from('animal_profiles').insert({
    id: profileId, animal_id: animalId, establishment_id: establishmentId,
    rodeo_id: rodeoId, category_id: catId, status: 'active',
  });
  if (pErr) throw new Error(`createAnimal profile: ${pErr.message}`);
  return { profileId, animalId };
}

// Habilita/deshabilita un data_key en el rodeo (owner). El trigger pre-pobla rodeo_data_config; acá lo togglea.
async function setDataKeyEnabled(client, rodeoId, dataKey, enabled) {
  const { data: fd, error: fdErr } = await client
    .from('field_definitions').select('id').eq('data_key', dataKey).is('establishment_id', null).single();
  if (fdErr) throw new Error(`lookup field_definition ${dataKey}: ${fdErr.message}`);
  const { error } = await client
    .from('rodeo_data_config').update({ enabled }).eq('rodeo_id', rodeoId).eq('field_definition_id', fd.id);
  if (error) throw new Error(`setDataKeyEnabled ${dataKey}: ${error.message}`);
}

const today = () => new Date().toISOString().slice(0, 10);

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    const { data: profs } = await admin
      .from('animal_profiles').select('id, animal_id').in('establishment_id', createdEstablishmentIds);
    const profileIds = (profs || []).map((r) => r.id);
    const animalIds = [...new Set((profs || []).map((r) => r.animal_id))];
    if (profileIds.length > 0) {
      // treatments/sanitary_events cascadean al borrar el perfil; los repro por calf_id no aplican acá.
      await admin.from('reproductive_events').delete().in('animal_profile_id', profileIds);
    }
    const { error: estErr } = await admin.from('establishments').delete().in('id', createdEstablishmentIds);
    if (estErr) console.error('cleanup establishments:', estErr.message);
    if (animalIds.length > 0) {
      const { error: anErr } = await admin.from('animals').delete().in('id', animalIds);
      if (anErr) console.error('cleanup animals:', anErr.message);
    }
  }
  for (const uid of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

// =====================================================================
// Suite
// =====================================================================

test('treatments suite — spec 02 delta tratamientos', async (t) => {
  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoB, animalA, animalB;

  await t.test('setup: usuarios, establishments, rodeos, animales', async () => {
    userA = await createTestUser('userA');
    userB = await createTestUser('userB');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo A' });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: 'Rodeo B' });
    animalA = await createAnimal(clientA, { rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    animalB = await createAnimal(clientB, { rodeoId: rodeoB.id, establishmentId: estB, systemId: rodeoB.systemId });
  });

  // (a) fail-closed: usuario sin rol en el campo NO lee/escribe un treatment (RTR.7.1).
  await t.test('(a) fail-closed: sin rol no lee/escribe (RTR.7.1)', async () => {
    // A crea un treatment de su animal.
    const { error: insErr } = await clientA.from('treatments').insert({
      animal_profile_id: animalA.profileId, kind: 'antibiotico', product_name: 'Oxitetraciclina',
    });
    assert.equal(insErr, null, insErr && insErr.message);

    // B (sin rol en estA) NO ve el treatment de A.
    const { data: bSees } = await clientB
      .from('treatments').select('id').eq('animal_profile_id', animalA.profileId);
    assert.equal((bSees || []).length, 0, 'B no debería ver treatments de A');

    // B NO puede insertar un treatment sobre el animal de A (RLS with check fail-closed).
    const { error: bInsErr } = await clientB.from('treatments').insert({
      animal_profile_id: animalA.profileId, kind: 'otro', product_name: 'Intruso',
    });
    assert.notEqual(bInsErr, null, 'B no debería poder crear un treatment sobre el animal de A');
  });

  // (b) anti-spoof establishment_id: forzado del perfil aunque el payload mande otro, en INSERT y UPDATE (RTR.7.2).
  await t.test('(b) anti-spoof establishment_id forzado (INSERT+UPDATE) (RTR.7.2)', async () => {
    // INSERT con establishment_id = estB (ajeno) → el trigger lo fuerza a estA (el del perfil).
    const { error: insErr } = await clientA.from('treatments').insert({
      animal_profile_id: animalA.profileId, establishment_id: estB, kind: 'otro', product_name: 'Spoof INSERT',
    });
    assert.equal(insErr, null, insErr && insErr.message);
    const { data: rows } = await admin
      .from('treatments').select('id, establishment_id').eq('animal_profile_id', animalA.profileId)
      .eq('product_name', 'Spoof INSERT').single();
    assert.equal(rows.establishment_id, estA, 'establishment_id debe forzarse a estA (no estB)');

    // UPDATE que intenta pisar establishment_id a estB → el trigger de inmutabilidad + el force lo pinnean a estA.
    const { error: updErr } = await clientA
      .from('treatments').update({ establishment_id: estB }).eq('id', rows.id);
    // El UPDATE puede pasar (policy amplia) pero el valor queda estA.
    assert.equal(updErr, null, updErr && updErr.message);
    const { data: after } = await admin.from('treatments').select('establishment_id').eq('id', rows.id).single();
    assert.equal(after.establishment_id, estA, 'establishment_id sigue estA tras el UPDATE-spoof');
  });

  // (c) created_by forzado a auth.uid() (RTR.7.7).
  await t.test('(c) created_by forzado a auth.uid() (RTR.7.7)', async () => {
    // A inserta mandando created_by = userB (spoof) → el trigger lo fuerza a userA.
    const { error: insErr } = await clientA.from('treatments').insert({
      animal_profile_id: animalA.profileId, created_by: userB.id, kind: 'otro', product_name: 'CreatedBy spoof',
    });
    assert.equal(insErr, null, insErr && insErr.message);
    const { data: row } = await admin.from('treatments').select('created_by')
      .eq('animal_profile_id', animalA.profileId).eq('product_name', 'CreatedBy spoof').single();
    assert.equal(row.created_by, userA.id, 'created_by debe ser userA (auth.uid), no userB');
  });

  // (d) anti-IDOR del treatment_id: cross-animal 23514 + inexistente 23503, en INSERT y UPDATE (RTR.2.6/RTR.7.3).
  await t.test('(d) anti-IDOR treatment_id (23514 cross-animal / 23503 inexistente, INSERT+UPDATE) (RTR.7.3)', async () => {
    // treatment de A sobre animalA.
    const { data: trtA } = await admin.from('treatments').insert({
      animal_profile_id: animalA.profileId, kind: 'antibiotico', product_name: 'TrtA para IDOR',
    }).select('id').single();

    // Segundo animal de A para el caso cross-animal SAME-TENANT.
    const animalA2 = await createAnimal(clientA, { rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });

    // INSERT de una aplicación sobre animalA2 linkeada al treatment de animalA → 23514 (cross-animal).
    const { error: crossErr } = await clientA.from('sanitary_events').insert({
      animal_profile_id: animalA2.profileId, treatment_id: trtA.id,
      event_type: 'treatment', product_name: 'Cross', event_date: today(),
    });
    assert.notEqual(crossErr, null, 'linkear a un treatment de otro animal debe rebotar');
    assert.equal(crossErr.code, '23514', `esperaba 23514, fue ${crossErr.code}: ${crossErr.message}`);

    // INSERT con treatment_id inexistente → 23503.
    const { error: nonExistErr } = await clientA.from('sanitary_events').insert({
      animal_profile_id: animalA.profileId, treatment_id: crypto.randomUUID(),
      event_type: 'treatment', product_name: 'Fantasma', event_date: today(),
    });
    assert.notEqual(nonExistErr, null, 'linkear a un treatment inexistente debe rebotar');
    assert.equal(nonExistErr.code, '23503', `esperaba 23503, fue ${nonExistErr.code}: ${nonExistErr.message}`);

    // UPDATE del animal_profile_id de la aplicación a otro animal (SEC-TRT-03: tenant-check incondicional).
    // Creamos una aplicación válida sobre animalA (linkeada a trtA) y luego intentamos moverla a animalA2.
    const { data: appOk, error: appErr } = await clientA.from('sanitary_events').insert({
      animal_profile_id: animalA.profileId, treatment_id: trtA.id,
      event_type: 'treatment', product_name: 'App válida', event_date: today(),
    }).select('id').single();
    assert.equal(appErr, null, appErr && appErr.message);
    const { error: moveErr } = await clientA.from('sanitary_events')
      .update({ animal_profile_id: animalA2.profileId }).eq('id', appOk.id);
    assert.notEqual(moveErr, null, 'mover la aplicación a otro animal (UPDATE de animal_profile_id) debe rebotar (SEC-TRT-03)');
    assert.equal(moveErr.code, '23514', `esperaba 23514 en el UPDATE-move, fue ${moveErr.code}: ${moveErr.message}`);
  });

  // (e) ciclo iniciar → aplicar → finalizar (RTR.3.2) + (f) cualquier rol (peón) finaliza (RTR.6.1-6.3).
  await t.test('(e/f) ciclo iniciar/aplicar/finalizar + peón finaliza (RTR.3.2/6.x)', async () => {
    // El peón (userB con rol field_operator en estA) inicia el tratamiento.
    await assignRoleAsService(userB.id, estA, 'field_operator');
    const clientPeon = await getUserClient(userB.email);

    const { data: trt, error: startErr } = await clientPeon.from('treatments').insert({
      animal_profile_id: animalA.profileId, kind: 'antiparasitario', product_name: 'Ivermectina',
    }).select('id, ended_at').single();
    assert.equal(startErr, null, `peón debería poder iniciar (RTR.6.1): ${startErr && startErr.message}`);
    assert.equal(trt.ended_at, null, 'nace en curso (ended_at NULL)');

    // Aplicación (RTR.6.2): deworming derivado del kind antiparasitario.
    const { error: appErr } = await clientPeon.from('sanitary_events').insert({
      animal_profile_id: animalA.profileId, treatment_id: trt.id,
      event_type: 'deworming', product_name: 'Ivermectina', event_date: today(), dose_ml: 5,
    });
    assert.equal(appErr, null, `peón debería poder registrar aplicación (RTR.6.2): ${appErr && appErr.message}`);

    // Finalizar (RTR.6.3 / RTR.3.2): el peón setea ended_at NULL→instante.
    const nowIso = new Date().toISOString();
    const { error: finErr } = await clientPeon.from('treatments')
      .update({ ended_at: nowIso }).eq('id', trt.id).is('ended_at', null);
    assert.equal(finErr, null, `peón debería poder finalizar (RTR.6.3): ${finErr && finErr.message}`);
    const { data: fin } = await admin.from('treatments').select('ended_at').eq('id', trt.id).single();
    assert.notEqual(fin.ended_at, null, 'ended_at seteado (finalizado)');
  });

  // (g) inmutabilidad SEC-TRT-01: un UPDATE de columnas o des-finalizar NO surte efecto (RTR.7.8).
  await t.test('(g) inmutabilidad de columnas + no des-finalizar (RTR.7.8)', async () => {
    const { data: trt } = await admin.from('treatments').insert({
      animal_profile_id: animalA.profileId, establishment_id: estA,
      kind: 'antibiotico', product_name: 'Original', notes: 'nota original',
      started_at: new Date().toISOString(),
    }).select('*').single();

    // A intenta PATCH-ear todas las columnas inmutables + des-finalizar (ended_at ya NULL → probamos con
    // primero finalizar y luego intentar reabrir).
    const { error: patchErr } = await clientA.from('treatments').update({
      created_by: userB.id, product_name: 'Hackeado', kind: 'otro', notes: 'nota hackeada',
      started_at: '2000-01-01T00:00:00Z', deleted_at: new Date().toISOString(),
    }).eq('id', trt.id);
    assert.equal(patchErr, null, 'el UPDATE pasa (policy amplia) pero el trigger pinnea a OLD');
    const { data: after } = await admin.from('treatments').select('*').eq('id', trt.id).single();
    assert.equal(after.product_name, 'Original', 'product_name inmutable');
    assert.equal(after.kind, 'antibiotico', 'kind inmutable');
    assert.equal(after.notes, 'nota original', 'notes inmutable');
    assert.equal(after.deleted_at, null, 'deleted_at inmutable (no se puede ocultar por UPDATE)');
    assert.equal(after.created_by, trt.created_by, 'created_by inmutable');

    // Finalizar y luego intentar des-finalizar (ended_at instante → NULL).
    const nowIso = new Date().toISOString();
    await clientA.from('treatments').update({ ended_at: nowIso }).eq('id', trt.id).is('ended_at', null);
    const { data: finalized } = await admin.from('treatments').select('ended_at').eq('id', trt.id).single();
    assert.notEqual(finalized.ended_at, null, 'finalizado');
    // Intento de reabrir (ended_at → NULL) y de cambiar el instante.
    await clientA.from('treatments').update({ ended_at: null }).eq('id', trt.id);
    const { data: reopen } = await admin.from('treatments').select('ended_at').eq('id', trt.id).single();
    assert.notEqual(reopen.ended_at, null, 'no se puede des-finalizar (ended_at pinneado a OLD)');
  });

  // (h) CHECKs SEC-TRT-02: product_name>120 / notes>1000 rebotan (RTR.1.9/1.10).
  await t.test('(h) CHECKs de tope product_name≤120 / notes≤1000 (RTR.1.9/1.10)', async () => {
    const { error: pErr } = await clientA.from('treatments').insert({
      animal_profile_id: animalA.profileId, kind: 'otro', product_name: 'x'.repeat(121),
    });
    assert.notEqual(pErr, null, 'product_name > 120 debe rebotar (CHECK)');

    const { error: nErr } = await clientA.from('treatments').insert({
      animal_profile_id: animalA.profileId, kind: 'otro', product_name: 'OK', notes: 'y'.repeat(1001),
    });
    assert.notEqual(nErr, null, 'notes > 1000 debe rebotar (CHECK)');

    // product_name vacío/whitespace rebota (RTR.1.4).
    const { error: emptyErr } = await clientA.from('treatments').insert({
      animal_profile_id: animalA.profileId, kind: 'otro', product_name: '   ',
    });
    assert.notEqual(emptyErr, null, 'product_name vacío debe rebotar (CHECK not_empty)');
  });

  // (i) exención de gating: aplicación de tratamiento pasa sin data_key; aplicación suelta gateada;
  //     vaccination con treatment_id del mismo animal SIGUE gateada (RTR.2.7/2.8, LOW-1).
  await t.test('(i) exención de gating acotada (RTR.2.7/2.8)', async () => {
    // Rodeo dedicado para no interferir; deshabilitamos antibiotico + vacunacion.
    const rodeoG = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo gating off' });
    const animalG = await createAnimal(clientA, { rodeoId: rodeoG.id, establishmentId: estA, systemId: rodeoG.systemId });
    await setDataKeyEnabled(clientA, rodeoG.id, 'antibiotico', false);
    await setDataKeyEnabled(clientA, rodeoG.id, 'vacunacion', false);

    const { data: trt } = await clientA.from('treatments').insert({
      animal_profile_id: animalG.profileId, kind: 'antibiotico', product_name: 'Antibiótico',
    }).select('id').single();

    // (a) aplicación de tratamiento (event_type='treatment' + treatment_id) PASA aunque antibiotico esté OFF.
    const { error: appErr } = await clientA.from('sanitary_events').insert({
      animal_profile_id: animalG.profileId, treatment_id: trt.id,
      event_type: 'treatment', product_name: 'Antibiótico', event_date: today(),
    });
    assert.equal(appErr, null, `aplicación de tratamiento debe pasar sin data_key (RTR.2.7): ${appErr && appErr.message}`);

    // (b) aplicación SUELTA (treatment_id NULL, event_type='treatment') sigue GATEADA (antibiotico OFF → 23514).
    const { error: looseErr } = await clientA.from('sanitary_events').insert({
      animal_profile_id: animalG.profileId,
      event_type: 'treatment', product_name: 'Suelto', event_date: today(),
    });
    assert.notEqual(looseErr, null, 'un sanitario suelto treatment sigue gateado (rama de maniobra intacta)');
    assert.equal(looseErr.code, '23514', `esperaba 23514 (gating), fue ${looseErr.code}: ${looseErr.message}`);

    // (c) vaccination con treatment_id del MISMO animal SIGUE gateada (LOW-1, RTR.2.8): vacunacion OFF → 23514.
    const { error: vaxErr } = await clientA.from('sanitary_events').insert({
      animal_profile_id: animalG.profileId, treatment_id: trt.id,
      event_type: 'vaccination', product_name: 'Vacuna colada', event_date: today(),
    });
    assert.notEqual(vaxErr, null, 'una vaccination con treatment_id NO debe saltear el gating de vacunacion (LOW-1)');
    assert.equal(vaxErr.code, '23514', `esperaba 23514 (gating vacunacion), fue ${vaxErr.code}: ${vaxErr.message}`);
  });

  // (j) fail-closed RTR.7.5: perfil inexistente al insertar → 23503.
  await t.test('(j) perfil inexistente → 23503 (RTR.7.5)', async () => {
    const { error } = await admin.from('treatments').insert({
      animal_profile_id: crypto.randomUUID(), kind: 'otro', product_name: 'Sin perfil',
    });
    assert.notEqual(error, null, 'un treatment sobre un perfil inexistente debe rebotar');
    assert.equal(error.code, '23503', `esperaba 23503, fue ${error.code}: ${error.message}`);
  });

  await t.after(cleanup);
});
