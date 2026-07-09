// supabase/tests/animal/run.cjs
// Suite de tests de la spec 02-modelo-animal (Fase 2).
// Corre contra la base remota: service_role para fixtures, JWTs reales para los
// asserts de RLS/triggers. Limpia users/establishments creados al final
// (CASCADE limpia rodeos/animals/profiles/eventos).
//
// Mapa R<n> -> test en progress/impl_02-modelo-animal.md.
//
// Uso: las vars se cargan desde <repo>/.env.local si existe.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
  console.error('Faltan vars de Supabase (URL / SERVICE_ROLE_KEY / ANON_KEY).');
  process.exit(2);
}

const RUN_TAG = `animal_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

// spec 13 (hardening): el bloque INPUT-1/A1-1/F1-1 corre contra el remoto como el resto de la
// suite. Las migraciones 0070+0071 ya están APLICADAS y las EFs redeployadas (deploy del leader
// completado), así que el gate `SPEC13_APPLIED` se removió: estos tests corren SIEMPRE.

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

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

async function createEstablishmentAs(userClient, name) {
  // Split insert + select (RLS-on-RETURNING; ADR-012).
  const { error: insErr } = await userClient
    .from('establishments')
    .insert({ name, province: 'Buenos Aires' });
  if (insErr) throw new Error(`createEstablishment insert(${name}): ${insErr.message}`);
  const { data, error } = await userClient
    .from('establishments')
    .select('id')
    .eq('name', name)
    .single();
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function assignRoleAsService(userId, establishmentId, role) {
  const { error } = await admin
    .from('user_roles')
    .insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`assignRole: ${error.message}`);
}

// Lookup de species/system por code (catálogos globales, legibles por cualquier authenticated).
async function lookupSpeciesSystem(client, speciesCode = 'bovino', systemCode = 'cria') {
  const { data: sp, error: spErr } = await client
    .from('species').select('id').eq('code', speciesCode).single();
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

// createRodeo: owner crea un rodeo (bovino, cria). El trigger pre-pobla rodeo_data_config.
async function createRodeo(client, { establishmentId, name, systemCode = 'cria' }) {
  const { speciesId, systemId } = await lookupSpeciesSystem(client, 'bovino', systemCode);
  const { error: insErr } = await client.from('rodeos').insert({
    establishment_id: establishmentId,
    name,
    species_id: speciesId,
    system_id: systemId,
  });
  if (insErr) throw new Error(`createRodeo insert(${name}): ${insErr.message}`);
  const { data, error } = await client
    .from('rodeos')
    .select('id, system_id')
    .eq('establishment_id', establishmentId)
    .eq('name', name)
    .single();
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  return { id: data.id, systemId: data.system_id };
}

// createAnimal: insert animals + animal_profiles con patrón split.
// El id del animal se genera en el cliente (crypto.randomUUID): un animal recién
// insertado es invisible vía RLS hasta que existe su animal_profile (animals_select
// deriva de la presencia de un perfil con has_role_in), así que NO se puede
// re-seleccionar por TAG antes de crear el perfil. Generar el UUID resuelve esto y
// replica cómo un cliente real haría el find-or-create.
async function createAnimal(client, { tag = null, idv = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null }) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = require('node:crypto').randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (tag) animalPayload.tag_electronic = tag;
  if (birthDate) animalPayload.birth_date = birthDate;
  const { error: aErr } = await client.from('animals').insert(animalPayload);
  if (aErr) return { error: aErr };

  let catId;
  if (categoryCode) {
    catId = await categoryId(client, systemId, categoryCode);
  } else {
    // default conservador por sexo para satisfacer NOT NULL de category_id
    // (R4.7 lo computa el cliente/spec 09; acá la primitive es el insert).
    catId = await categoryId(client, systemId, sex === 'male' ? 'torito' : 'vaquillona');
  }

  const profileId = require('node:crypto').randomUUID();
  const profilePayload = {
    id: profileId,
    animal_id: animalId,
    establishment_id: establishmentId,
    rodeo_id: rodeoId,
    category_id: catId,
    status: 'active',
  };
  if (idv) profilePayload.idv = idv;
  // IDU: visual_id_alt eliminado (0122). Un perfil sin idv/tag persiste (trigger de completitud dropeado).
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) return { error: pErr, animalId };

  const { data: prof, error: selErr } = await client
    .from('animal_profiles')
    .select('id, category_id, category_override, management_group_id, rodeo_id')
    .eq('id', profileId)
    .maybeSingle();
  if (selErr) throw selErr;
  return { profile: prof, animalId };
}

async function createManagementGroup(client, { establishmentId, name }) {
  const { error: insErr } = await client
    .from('management_groups').insert({ establishment_id: establishmentId, name });
  if (insErr) return { error: insErr };
  const { data, error } = await client
    .from('management_groups').select('id').eq('establishment_id', establishmentId).eq('name', name).single();
  if (error) throw error;
  return { id: data.id };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    const { data: profs } = await admin
      .from('animal_profiles')
      .select('id, animal_id')
      .in('establishment_id', createdEstablishmentIds);
    const profileIds = (profs || []).map((r) => r.id);
    const animalIds = [...new Set((profs || []).map((r) => r.animal_id))];
    // reproductive_events.calf_id referencia animal_profiles SIN cascade, así que
    // borramos los eventos reproductivos de los perfiles de prueba primero
    // (por animal_profile_id y por calf_id) para no bloquear el cascade de
    // establishments -> animal_profiles.
    if (profileIds.length > 0) {
      await admin.from('reproductive_events').delete().in('animal_profile_id', profileIds);
      await admin.from('reproductive_events').delete().in('calf_id', profileIds);
    }
    const { error: estErr } = await admin
      .from('establishments').delete().in('id', createdEstablishmentIds);
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

test('animal suite — spec 02', async (t) => {
  let userA, userB, clientA, clientB, estA, estB;
  let rodeoA, rodeoB; // {id, systemId}

  // ---- T2.1 setup ---------------------------------------------------------
  await t.test('T2.1 setup: usuarios, establishments, rodeos manuales', async () => {
    userA = await createTestUser('userA');
    userB = await createTestUser('userB');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);

    // R2.6: ningún rodeo se crea automáticamente.
    {
      const { data } = await clientA.from('rodeos').select('id').eq('establishment_id', estA);
      assert.equal(data.length, 0, 'no debería haber rodeo autogenerado');
    }

    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo principal' });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: 'Rodeo principal' });

    // El trigger pre-pobló rodeo_data_config (27 filas, 24 enabled). // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    {
      const { data, error } = await clientA
        .from('rodeo_data_config').select('enabled').eq('rodeo_id', rodeoA.id);
      assert.equal(error, null, error && error.message);
      assert.equal(data.length, 27, 'rodeo_data_config debería tener 27 filas'); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
      assert.equal(data.filter((r) => r.enabled).length, 24, '24 enabled'); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    }
  });

  // ---- T2.2 identificación flexible (R4.2, R3.2, R4.3) --------------------
  await t.test('T2.2 identificación flexible', async () => {
    // Caso 1: solo TAG.
    {
      const r = await createAnimal(clientA, { tag: `${RUN_TAG}_TAG1`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.equal(r.error, undefined, r.error && r.error.message);
      assert.ok(r.profile.id);
    }
    // Caso 2: solo IDV.
    {
      const r = await createAnimal(clientA, { idv: `${RUN_TAG}_IDV1`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.equal(r.error, undefined, r.error && r.error.message);
      assert.ok(r.profile.id);
    }
    // Caso 3 (IDU.1.4/1.5): sin NINGÚN identificador de usuario (tag/idv/apodo) -> PERSISTE. El trigger de
    // completitud animal_profiles_identity_check se eliminó (0122); un perfil sin idv ni tag es válido
    // (el animal siempre tiene su PK interna). Reemplaza el viejo "solo visual_id_alt" + el "sin ninguno -> 23514".
    {
      const r = await createAnimal(clientA, { sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.equal(r.error, undefined, `alta sin identificadores debe persistir (IDU.1.4): ${r.error && r.error.message}`);
      assert.ok(r.profile.id, 'el perfil sin identificadores se creó (idv/tag NULL, sin 23514)');
      const { data: prof } = await admin.from('animal_profiles').select('idv').eq('id', r.profile.id).single();
      assert.equal(prof.idv, null, 'idv NULL persiste (IDU.1.4)');
    }
    // Caso 5: TAG duplicado entre campos -> unique violation.
    {
      const dupTag = `${RUN_TAG}_DUPTAG`;
      const r1 = await createAnimal(clientA, { tag: dupTag, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.equal(r1.error, undefined);
      // userB intenta crear animal con el mismo TAG (global unique).
      const { error } = await clientB.from('animals').insert({
        tag_electronic: dupTag, sex: 'female',
        species_id: (await lookupSpeciesSystem(clientB)).speciesId,
      });
      assert.notEqual(error, null, 'TAG duplicado global debería fallar');
      assert.match(String(error.message + ' ' + (error.details || '')), /unique|duplicate|animals_tag_unique/i);
    }
    // Caso 6: IDV duplicado dentro del mismo campo -> falla; entre campos -> OK.
    {
      const idv = `${RUN_TAG}_IDVDUP`;
      const r1 = await createAnimal(clientA, { idv, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.equal(r1.error, undefined);
      const r2 = await createAnimal(clientA, { idv, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.notEqual(r2.error, undefined, 'IDV duplicado en el mismo establishment debería fallar');
      // Mismo IDV en estB -> OK (scope por establishment).
      const r3 = await createAnimal(clientB, { idv, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoB.id, establishmentId: estB, systemId: rodeoB.systemId });
      assert.equal(r3.error, undefined, 'mismo IDV en otro establishment debería ser OK');
    }
  });

  // ---- T2.3 categoría auto-calculada al alta (R4.7) -----------------------
  // El cómputo de categoría inicial lo hace compute_category (server) o el cliente.
  // Acá validamos compute_category() directamente (la primitive del R4.7).
  await t.test('T2.3 compute_category inicial', async () => {
    async function makeAndCompute({ sex, birthDate }) {
      const r = await createAnimal(clientA, { idv: `${RUN_TAG}_C_${Math.random().toString(36).slice(2, 7)}`, sex, birthDate, rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.equal(r.error, undefined, r.error && r.error.message);
      const { data, error } = await clientA.rpc('compute_category', { profile_id: r.profile.id });
      assert.equal(error, null, error && error.message);
      // resolvemos el code de la categoría computada
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data).single();
      return cat.code;
    }
    assert.equal(await makeAndCompute({ sex: 'female', birthDate: daysAgo(180) }), 'ternera');
    assert.equal(await makeAndCompute({ sex: 'female', birthDate: daysAgo(550) }), 'vaquillona');
    assert.equal(await makeAndCompute({ sex: 'male', birthDate: daysAgo(180) }), 'ternero');
    assert.equal(await makeAndCompute({ sex: 'male', birthDate: null }), 'torito');
  });

  // ---- T2.4 transiciones automáticas (R7.1..R7.5, R7.7) -------------------
  await t.test('T2.4 transiciones automáticas + ortogonalidad', async () => {
    // vaquillona + tacto positivo -> vaquillona_prenada, override sigue false.
    const vq = await createAnimal(clientA, { idv: `${RUN_TAG}_VQ`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    assert.equal(vq.error, undefined, vq.error && vq.error.message);
    // asignar un lote a la vaquillona para verificar ortogonalidad (R7.7)
    const grp = await createManagementGroup(clientA, { establishmentId: estA, name: `${RUN_TAG}_loteVQ` });
    {
      const { error } = await clientA.from('animal_profiles').update({ management_group_id: grp.id }).eq('id', vq.profile.id);
      assert.equal(error, null, error && error.message);
    }
    {
      const { error } = await clientA.from('reproductive_events').insert({
        animal_profile_id: vq.profile.id, event_type: 'tacto', event_date: daysAgo(1), pregnancy_status: 'medium',
      });
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('animal_profiles')
        .select('category_id, category_override, management_group_id, rodeo_id').eq('id', vq.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'vaquillona_prenada', 'tacto positivo -> vaquillona_prenada');
      assert.equal(data.category_override, false, 'transición auto no marca override');
      // Ortogonalidad R7.7: lote y rodeo intactos.
      assert.equal(data.management_group_id, grp.id, 'lote no debe cambiar por transición');
      assert.equal(data.rodeo_id, rodeoA.id, 'rodeo no debe cambiar por transición');
    }
    // + birth -> vaca_segundo_servicio.
    {
      const { error } = await clientA.from('reproductive_events').insert({
        animal_profile_id: vq.profile.id, event_type: 'birth', event_date: daysAgo(1),
      });
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('animal_profiles').select('category_id, management_group_id').eq('id', vq.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'vaca_segundo_servicio');
      assert.equal(data.management_group_id, grp.id, 'lote intacto tras parto (R7.7)');
    }
    // + segundo birth -> multipara.
    {
      const { error } = await clientA.from('reproductive_events').insert({
        animal_profile_id: vq.profile.id, event_type: 'birth', event_date: daysAgo(1),
      });
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('animal_profiles').select('category_id').eq('id', vq.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'multipara');
    }
    // + tercer birth sobre multipara -> sin cambio.
    {
      await clientA.from('reproductive_events').insert({
        animal_profile_id: vq.profile.id, event_type: 'birth', event_date: daysAgo(1),
      });
      const { data } = await clientA.from('animal_profiles').select('category_id').eq('id', vq.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'multipara', 'no hay transición desde multipara');
    }
    // override=true + tacto positivo -> sin cambio.
    {
      const vq2 = await createAnimal(clientA, { idv: `${RUN_TAG}_VQOV`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
      // marcar override manual: cambiar categoría a vaquillona explícitamente dispara override? No (mismo valor).
      // Forzamos override con un update a otra categoría válida y de vuelta no es necesario: seteamos override directo.
      await clientA.from('animal_profiles').update({ category_override: true }).eq('id', vq2.profile.id);
      await clientA.from('reproductive_events').insert({
        animal_profile_id: vq2.profile.id, event_type: 'tacto', event_date: daysAgo(1), pregnancy_status: 'large',
      });
      const { data } = await clientA.from('animal_profiles').select('category_id').eq('id', vq2.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'vaquillona', 'override=true bloquea transición auto (R4.9)');
    }
    // tacto con pregnancy_status='empty' -> sin cambio.
    {
      const vq3 = await createAnimal(clientA, { idv: `${RUN_TAG}_VQEMPTY`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
      await clientA.from('reproductive_events').insert({
        animal_profile_id: vq3.profile.id, event_type: 'tacto', event_date: daysAgo(1), pregnancy_status: 'empty',
      });
      const { data } = await clientA.from('animal_profiles').select('category_id').eq('id', vq3.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'vaquillona', 'tacto vacío no transiciona');
    }
    // animal_category_history registra auto_transition.
    {
      const { data } = await clientA.from('animal_category_history')
        .select('reason').eq('animal_profile_id', vq.profile.id);
      const reasons = data.map((r) => r.reason);
      assert.ok(reasons.includes('initial'), 'debe haber un initial');
      assert.ok(reasons.includes('auto_transition'), 'debe haber auto_transition (R10.3/R12.4)');
    }
  });

  // ---- T2.5 override manual y revert (R4.8, R4.10, R7.6) ------------------
  await t.test('T2.5 override manual + revert', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_OVR`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    const multiId = await categoryId(clientA, rodeoA.systemId, 'multipara');
    // UPDATE manual -> override true + history manual_override.
    {
      const { error } = await clientA.from('animal_profiles').update({ category_id: multiId }).eq('id', an.profile.id);
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('animal_profiles').select('category_override').eq('id', an.profile.id).single();
      assert.equal(data.category_override, true, 'update manual -> override true (R4.8)');
      const { data: hist } = await clientA.from('animal_category_history').select('reason').eq('animal_profile_id', an.profile.id).order('changed_at', { ascending: false }).limit(1);
      assert.equal(hist[0].reason, 'manual_override');
    }
    // revert: compute_category + override false + update.
    {
      const { data: computed, error: cErr } = await clientA.rpc('compute_category', { profile_id: an.profile.id });
      assert.equal(cErr, null, cErr && cErr.message);
      // primero override=false, luego category_id=computed (el trigger record_category_change usa override previo)
      const { error: e1 } = await clientA.from('animal_profiles')
        .update({ category_override: false, category_id: computed }).eq('id', an.profile.id);
      assert.equal(e1, null, e1 && e1.message);
      const { data: hist } = await clientA.from('animal_category_history').select('reason').eq('animal_profile_id', an.profile.id).order('changed_at', { ascending: false }).limit(1);
      assert.equal(hist[0].reason, 'revert_to_auto', 'revert graba revert_to_auto (R4.10/R7.6)');
    }
  });

  // ---- T2.6 CUT manual (R8.4, R8.5, R11.5) --------------------------------
  await t.test('T2.6 CUT manual', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CUT`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'multipara' });
    const cutId = await categoryId(clientA, rodeoA.systemId, 'cut');
    // Update directo de is_cut + category cut + override true.
    {
      const { error } = await clientA.from('animal_profiles')
        .update({ is_cut: true, category_id: cutId, category_override: true, teeth_state: 'sin_dientes' })
        .eq('id', an.profile.id);
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('animal_profiles').select('is_cut, category_id').eq('id', an.profile.id).single();
      assert.equal(data.is_cut, true);
      assert.equal(data.category_id, cutId);
    }
    // field_operator y veterinarian pueden hacer el update (R11.5).
    {
      await assignRoleAsService(userB.id, estA, 'field_operator');
      const an2 = await createAnimal(clientA, { idv: `${RUN_TAG}_CUT2`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'multipara' });
      const { error } = await clientB.from('animal_profiles')
        .update({ is_cut: true, category_id: cutId, category_override: true }).eq('id', an2.profile.id);
      assert.equal(error, null, 'field_operator puede actualizar CUT (R11.5)');
      const { data } = await clientB.from('animal_profiles').select('is_cut').eq('id', an2.profile.id).maybeSingle();
      assert.equal(data.is_cut, true);
    }
  });

  // ---- T2.7 ternero al pie (R9) -------------------------------------------
  await t.test('T2.7 ternero al pie', async () => {
    // parto sobre vaquillona preñada con calf -> crea ternera.
    const madre = await createAnimal(clientA, { idv: `${RUN_TAG}_MADRE`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada' });
    {
      const { error } = await clientA.from('reproductive_events').insert({
        animal_profile_id: madre.profile.id, event_type: 'birth', event_date: daysAgo(1),
        calf_sex: 'female', calf_weight: 35,
      });
      assert.equal(error, null, error && error.message);
      // buscar el reproductive_event para verificar calf_id
      const { data: ev } = await clientA.from('reproductive_events')
        .select('calf_id').eq('animal_profile_id', madre.profile.id).eq('event_type', 'birth')
        .order('created_at', { ascending: false }).limit(1).single();
      assert.ok(ev.calf_id, 'calf_id no debe ser null tras el parto');
      const { data: calf } = await clientA.from('animal_profiles')
        .select('category_id, entry_origin, idv, management_group_id').eq('id', ev.calf_id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', calf.category_id).single();
      assert.equal(cat.code, 'ternera');
      assert.equal(calf.entry_origin, 'born_here');
      // IDU.2.2/1.4: la cría mono-ternero SIN tag ni idv persiste con ambos NULL (el fallback visual_id_alt
      // se eliminó en 0122 junto al trigger de completitud) — el trigger tg_reproductive_events_create_calf
      // re-creado sin visual_id_alt sigue creando la cría.
      assert.equal(calf.idv, null, 'cría sin caravana → idv NULL (sin fallback, IDU.2.2)');
      assert.equal(calf.management_group_id, null, 'ternero nace sin lote (R9.1)');
      // madre transicionó a vaca_segundo_servicio.
      const { data: m } = await clientA.from('animal_profiles').select('category_id').eq('id', madre.profile.id).single();
      const { data: mcat } = await clientA.from('categories_by_system').select('code').eq('id', m.category_id).single();
      assert.equal(mcat.code, 'vaca_segundo_servicio', 'madre transiciona tras parto');
    }
    // parto con calf_tag_electronic -> ternero con TAG, sin fallback visual.
    {
      const m2 = await createAnimal(clientA, { idv: `${RUN_TAG}_MADRE2`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada' });
      const calfTag = `${RUN_TAG}_CALFTAG`;
      const { error } = await clientA.from('reproductive_events').insert({
        animal_profile_id: m2.profile.id, event_type: 'birth', event_date: daysAgo(1),
        calf_sex: 'male', calf_tag_electronic: calfTag,
      });
      assert.equal(error, null, error && error.message);
      const { data: ev } = await clientA.from('reproductive_events')
        .select('calf_id').eq('animal_profile_id', m2.profile.id).eq('event_type', 'birth')
        .order('created_at', { ascending: false }).limit(1).single();
      const { data: calf } = await clientA.from('animal_profiles').select('idv, animal_id').eq('id', ev.calf_id).single();
      assert.equal(calf.idv, null, 'cría con TAG → idv NULL (R9.3; sin fallback visual, IDU.2.2)');
      const { data: an } = await clientA.from('animals').select('tag_electronic').eq('id', calf.animal_id).single();
      assert.equal(an.tag_electronic, calfTag);
    }
    // parto con calf_tag duplicado -> rollback del evento completo (R9.4).
    {
      const dupTag = `${RUN_TAG}_DUPCALF`;
      // creamos un animal previo con ese TAG
      await createAnimal(clientA, { tag: dupTag, sex: 'male', birthDate: daysAgo(100), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
      const m3 = await createAnimal(clientA, { idv: `${RUN_TAG}_MADRE3`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada' });
      const before = await clientA.from('reproductive_events').select('id', { count: 'exact', head: true }).eq('animal_profile_id', m3.profile.id);
      const { error } = await clientA.from('reproductive_events').insert({
        animal_profile_id: m3.profile.id, event_type: 'birth', event_date: daysAgo(1),
        calf_sex: 'male', calf_tag_electronic: dupTag,
      });
      assert.notEqual(error, null, 'parto con TAG duplicado debe fallar');
      const after = await clientA.from('reproductive_events').select('id', { count: 'exact', head: true }).eq('animal_profile_id', m3.profile.id);
      assert.equal(after.count, before.count, 'rollback: el evento no quedó persistido (R9.4)');
    }
  });

  // ---- T2.8 RLS animales y eventos (R11) ----------------------------------
  await t.test('T2.8 RLS animales y eventos', async () => {
    // userB es field_operator de estA (asignado en T2.6). Creamos un animal en estA por userA.
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_RLS1`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    // userC sin rol en estA.
    const userC = await createTestUser('userC');
    const clientC = await getUserClient(userC.email);
    // userC no ve el perfil.
    {
      const { data } = await clientC.from('animal_profiles').select('id').eq('id', an.profile.id);
      assert.deepEqual(data, [], 'userC sin rol no ve el perfil');
    }
    // userC no ve el animal global.
    {
      const { data } = await clientC.from('animals').select('id').eq('id', an.animalId);
      assert.deepEqual(data, [], 'userC sin rol no ve el animal global');
    }
    // userA crea evento; userC no lo ve.
    {
      await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 320, weight_date: daysAgo(1) });
      const { data: wA } = await clientA.from('weight_events').select('id').eq('animal_profile_id', an.profile.id);
      assert.ok(wA.length >= 1);
      const { data: wC } = await clientC.from('weight_events').select('id').eq('animal_profile_id', an.profile.id);
      assert.deepEqual(wC, [], 'userC no ve eventos de estA');
    }
    // userB (field_operator de estA) puede insertar evento sobre animal de estA.
    {
      const { error } = await clientB.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 330, weight_date: daysAgo(1) });
      assert.equal(error, null, 'field_operator puede insertar evento (R11.5)');
    }
    // userB (no owner, no creador) no puede editar el evento de userA.
    {
      const { data: ev } = await clientA.from('weight_events').select('id, created_by').eq('animal_profile_id', an.profile.id).eq('weight_kg', 320).single();
      const { data: upd } = await clientB.from('weight_events').update({ weight_kg: 999 }).eq('id', ev.id).select();
      assert.deepEqual(upd, [], 'field_operator no-creador no edita evento ajeno (R6.8)');
    }
    // userA es owner de estA -> puede editar.
    {
      const { data: ev } = await clientA.from('weight_events').select('id').eq('animal_profile_id', an.profile.id).eq('weight_kg', 320).single();
      const { data: upd, error } = await clientA.from('weight_events').update({ weight_kg: 321 }).eq('id', ev.id).select('weight_kg');
      assert.equal(error, null, error && error.message);
      assert.equal(upd[0].weight_kg, 321, 'owner puede editar evento');
    }
    // field_operator no puede crear rodeo en estA.
    {
      const { speciesId, systemId } = await lookupSpeciesSystem(clientB);
      const { error } = await clientB.from('rodeos').insert({ establishment_id: estA, name: `${RUN_TAG}_hackrodeo`, species_id: speciesId, system_id: systemId });
      assert.notEqual(error, null, 'field_operator no crea rodeo (R2.3)');
    }
    // userA con perfil en estA puede leer el animal global; userC no (ya verificado).
    {
      const { data } = await clientA.from('animals').select('id').eq('id', an.animalId);
      assert.equal(data.length, 1, 'userA ve el animal global (R3.5)');
    }
  });

  // ---- T2.9 creación manual de rodeo + validaciones (R2) ------------------
  await t.test('T2.9 rodeo manual + validaciones', async () => {
    // Nuevo establishment de userA para no contaminar estA.
    const estC = await createEstablishmentAs(clientA, `${RUN_TAG} estC`);
    // count rodeos = 0 (no default).
    {
      const { data } = await clientA.from('rodeos').select('id').eq('establishment_id', estC);
      assert.equal(data.length, 0, 'no hay rodeo default (R2.6)');
    }
    // owner crea rodeo (bovino, cria) -> 27 filas rodeo_data_config (24 enabled). // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    const rC = await createRodeo(clientA, { establishmentId: estC, name: 'Rodeo cría' });
    {
      const { data } = await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', rC.id);
      assert.equal(data.length, 27); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
      assert.equal(data.filter((r) => r.enabled).length, 24); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    }
    // owner intenta (bovino, invernada) -> falla (system inactive).
    {
      const { speciesId } = await lookupSpeciesSystem(clientA);
      const { data: sysInv } = await clientA.from('systems_by_species').select('id').eq('code', 'invernada').single();
      const { error } = await clientA.from('rodeos').insert({ establishment_id: estC, name: 'Inv', species_id: speciesId, system_id: sysInv.id });
      assert.notEqual(error, null, 'sistema inactivo debe fallar (R2.4)');
      assert.match(String(error.message + ' ' + (error.code || '')), /23514|invalid species/i);
    }
    // field_operator no puede crear rodeo (userB no tiene rol en estC -> ni ve; lo asignamos field_operator).
    {
      await assignRoleAsService(userB.id, estC, 'field_operator');
      const { speciesId, systemId } = await lookupSpeciesSystem(clientB);
      const { error } = await clientB.from('rodeos').insert({ establishment_id: estC, name: 'FO rodeo', species_id: speciesId, system_id: systemId });
      assert.notEqual(error, null, 'field_operator no crea rodeo (R2.3)');
    }
    // soft-delete con animales activos -> rechazado con error claro (R2.5).
    // El soft-delete va por RPC soft_delete_rodeo (ver 0041_soft_delete_rpcs.sql).
    {
      await createAnimal(clientA, { idv: `${RUN_TAG}_estC_a1`, sex: 'female', birthDate: daysAgo(400), rodeoId: rC.id, establishmentId: estC, systemId: rC.systemId });
      const { error } = await clientA.rpc('soft_delete_rodeo', { p_rodeo_id: rC.id });
      assert.notEqual(error, null, 'soft-delete de rodeo con animales activos debe fallar (R2.5)');
      assert.match(String(error.message), /active animal_profiles|23514/i);
    }
    // soft-delete de un rodeo SIN animales activos -> OK.
    {
      const rEmpty = await createRodeo(clientA, { establishmentId: estC, name: 'Rodeo vacío' });
      const { error } = await clientA.rpc('soft_delete_rodeo', { p_rodeo_id: rEmpty.id });
      assert.equal(error, null, 'soft-delete de rodeo sin animales OK (R2.5)');
      const { data } = await clientA.from('rodeos').select('id').eq('id', rEmpty.id);
      assert.deepEqual(data, [], 'rodeo soft-deleted deja de verse (RLS)');
    }
    // field_operator NO puede soft-deletear un rodeo (R2.5 owner-only).
    {
      const rFo = await createRodeo(clientA, { establishmentId: estC, name: 'Rodeo FO test' });
      const { error } = await clientB.rpc('soft_delete_rodeo', { p_rodeo_id: rFo.id });
      assert.notEqual(error, null, 'field_operator no puede soft-deletear rodeo');
    }
  });

  // ---- T2.10 cronología v1 (R10) ------------------------------------------
  await t.test('T2.10 cronología', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TL`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 300, weight_date: daysAgo(3) });
    await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto', event_date: daysAgo(2), pregnancy_status: 'empty' });
    await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(1) });
    {
      const { data, error } = await clientA.rpc('animal_timeline', { profile_id: an.profile.id });
      assert.equal(error, null, error && error.message);
      // 3 eventos + 1 category_change (initial)
      assert.equal(data.length, 4, 'timeline debe tener 3 eventos + 1 category_change');
      // orden desc por event_date
      for (let i = 1; i < data.length; i++) {
        assert.ok(new Date(data[i - 1].event_date) >= new Date(data[i].event_date), 'orden desc');
      }
    }
    // userC sin rol -> 0 filas.
    {
      const userC = await createTestUser('userC10');
      const clientC = await getUserClient(userC.email);
      const { data } = await clientC.rpc('animal_timeline', { profile_id: an.profile.id });
      assert.deepEqual(data, [], 'userC sin rol -> timeline vacío (R10.2)');
    }
  });

  // ---- T2.11 búsqueda fuzzy (R5) ------------------------------------------
  // IDU.4.3/4.5: visual_id_alt se eliminó (0122); la caravana visual es ahora el `idv` alfanumérico → la
  // búsqueda por substring corre sobre `idv` (canal unificado). Se reemplaza el viejo substring sobre visual.
  await t.test('T2.11 búsqueda', async () => {
    const visualIdv = `${RUN_TAG}_vacablanca`;
    const tag = `${RUN_TAG}_SEARCHTAG`;
    await createAnimal(clientA, { idv: visualIdv, tag, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    // substring del idv -> encuentra.
    {
      const { data, error } = await clientA.rpc('animal_timeline', { profile_id: '00000000-0000-0000-0000-000000000000' }); // noop to ensure rpc path ok
      assert.equal(error, null);
      const { data: ilikeFound } = await clientA
        .from('animal_profiles').select('id').ilike('idv', '%vacablanca%').eq('establishment_id', estA);
      assert.ok(ilikeFound.length >= 1, 'búsqueda por substring de idv encuentra (IDU.4.3)');
    }
    // término no relacionado -> no encuentra.
    {
      const { data } = await clientA.from('animal_profiles').select('id').ilike('idv', '%toronegro%').eq('establishment_id', estA);
      assert.deepEqual(data, [], 'consulta no relacionada no encuentra');
    }
    // TAG exacto -> encuentra; userC sin rol -> 0.
    {
      const { data } = await clientA.from('animals').select('id').eq('tag_electronic', tag);
      assert.equal(data.length, 1, 'TAG exacto encuentra (R5.1)');
      const userC = await createTestUser('userC11');
      const clientC = await getUserClient(userC.email);
      const { data: dC } = await clientC.from('animals').select('id').eq('tag_electronic', tag);
      assert.deepEqual(dC, [], 'userC sin rol no ve el animal por TAG (RLS)');
    }
  });

  // ---- T2.13 animal_events (modelo Híbrido, R6.10..R6.13) -----------------
  await t.test('T2.13 animal_events', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_OBS`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    let obsId;
    // Caso 1: observacion OK.
    {
      const { error } = await clientA.from('animal_events').insert({
        animal_profile_id: an.profile.id, establishment_id: estA, event_type: 'observacion', text: 'vio cojera leve',
      });
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('animal_events').select('id, author_id, edit_window_until').eq('animal_profile_id', an.profile.id).single();
      obsId = data.id;
      assert.equal(data.author_id, userA.id, 'author_id = auth.uid()');
      const delta = new Date(data.edit_window_until).getTime() - Date.now();
      assert.ok(delta > 10 * 60 * 1000 && delta < 20 * 60 * 1000, 'edit_window ~ 15 min');
    }
    // Caso 2: event_type='salud' -> CHECK falla.
    {
      const { error } = await clientA.from('animal_events').insert({
        animal_profile_id: an.profile.id, establishment_id: estA, event_type: 'salud', text: 'x',
      });
      assert.notEqual(error, null, 'event_type fuera de (observacion,otro) debe fallar');
    }
    // Caso 3: establishment_id mismatch -> falla.
    {
      const { error } = await clientA.from('animal_events').insert({
        animal_profile_id: an.profile.id, establishment_id: estB, event_type: 'observacion', text: 'x',
      });
      assert.notEqual(error, null, 'establishment_id mismatch debe fallar');
    }
    // Caso 4: update de text dentro de ventana por author -> OK.
    {
      const { error } = await clientA.from('animal_events').update({ text: 'cojera moderada' }).eq('id', obsId);
      assert.equal(error, null, error && error.message);
    }
    // Caso 5: update fuera de ventana -> falla. La columna edit_window_until es
    // inmutable post-insert (el trigger la bloquea), así que NO se puede moverla con
    // un UPDATE. La seteamos en el pasado AL INSERTAR (el trigger de inmutabilidad
    // solo corre en UPDATE), simulando una observación cuya ventana ya venció.
    let expiredId;
    {
      await clientA.from('animal_events').insert({
        animal_profile_id: an.profile.id, establishment_id: estA, event_type: 'observacion',
        text: 'vieja', edit_window_until: new Date(Date.now() - 60000).toISOString(),
      });
      const { data } = await clientA.from('animal_events').select('id').eq('text', 'vieja').single();
      expiredId = data.id;
      const { data: upd, error } = await clientA.from('animal_events').update({ text: 'tarde' }).eq('id', expiredId).select();
      // El trigger lanza excepción -> PostgREST devuelve error y 0 filas.
      assert.ok(error || !upd || upd.length === 0, 'update de text fuera de ventana debe ser rechazado');
    }
    // Caso 6: update de columna inmutable (author_id) -> falla.
    {
      const { data: upd, error } = await clientA.from('animal_events').update({ author_id: userB.id }).eq('id', obsId).select();
      assert.ok(error || !upd || upd.length === 0, 'cambio de author_id debe ser rechazado');
    }
    // Caso 7: soft-delete por author -> OK (vía RPC soft_delete_animal_event, ver 0041).
    {
      const { error } = await clientA.rpc('soft_delete_animal_event', { p_event_id: obsId });
      assert.equal(error, null, 'soft-delete permitido por author (aun fuera de la ventana de edición)');
      // ya no aparece en lecturas normales (R12.3).
      const { data } = await clientA.from('animal_events').select('id').eq('id', obsId);
      assert.deepEqual(data, [], 'animal_event soft-deleted no aparece en SELECT normal (R12.3)');
    }
    // Caso 8: userC sin rol no ve.
    {
      const userC = await createTestUser('userC13');
      const clientC = await getUserClient(userC.email);
      // creamos una observación fresca para que no esté soft-deleted
      await clientA.from('animal_events').insert({ animal_profile_id: an.profile.id, establishment_id: estA, event_type: 'observacion', text: 'fresca' });
      const { data } = await clientC.from('animal_events').select('id').eq('animal_profile_id', an.profile.id);
      assert.deepEqual(data, [], 'userC sin rol no ve animal_events (R6.13)');
    }
    // Caso 9: field_operator (userB) NO edita texto de evento de userA.
    let freshObsId;
    {
      await clientA.from('animal_events').insert({ animal_profile_id: an.profile.id, establishment_id: estA, event_type: 'observacion', text: 'de userA' });
      const { data } = await clientA.from('animal_events').select('id').eq('text', 'de userA').single();
      freshObsId = data.id;
      const { data: upd } = await clientB.from('animal_events').update({ text: 'hackeado' }).eq('id', freshObsId).select();
      assert.ok(!upd || upd.length === 0, 'field_operator no-author no edita evento ajeno (R6.13)');
    }
    // Caso 10: owner (le damos owner a userB en estA temporalmente vía service) edita evento de userA.
    {
      // userB es field_operator de estA; lo promovemos a owner vía service para este caso.
      await admin.from('user_roles').update({ active: false }).eq('user_id', userB.id).eq('establishment_id', estA);
      await assignRoleAsService(userB.id, estA, 'owner');
      const { error } = await clientB.from('animal_events').update({ text: 'editado por owner' }).eq('id', freshObsId);
      assert.equal(error, null, 'owner puede editar evento ajeno dentro de ventana (R6.13)');
      // restauramos a field_operator para no romper tests posteriores
      await admin.from('user_roles').update({ active: false }).eq('user_id', userB.id).eq('establishment_id', estA).eq('role', 'owner');
      await assignRoleAsService(userB.id, estA, 'field_operator');
    }
  });

  // ---- T2.14 inmutabilidad de identificadores (R4.13) ---------------------
  await t.test('T2.14 inmutabilidad identificadores', async () => {
    // Caso 1: tag ARG001 -> ARG002 falla.
    {
      const an = await createAnimal(clientA, { tag: `${RUN_TAG}_IM1`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      const { data: upd } = await clientA.from('animals').update({ tag_electronic: `${RUN_TAG}_IM1b` }).eq('id', an.animalId).select();
      assert.ok(!upd || upd.length === 0, 'tag valor->otro valor debe fallar (R4.13.b)');
    }
    // Caso 2: idv 001 -> 002 falla.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_IMIDV1`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      const { data: upd } = await clientA.from('animal_profiles').update({ idv: `${RUN_TAG}_IMIDV2` }).eq('id', an.profile.id).select();
      assert.ok(!upd || upd.length === 0, 'idv valor->otro valor debe fallar (R4.13.b)');
    }
    // Caso 3 (IDU): el viejo "visual_id_alt editable" se eliminó junto a la columna (0122). La mutabilidad de
    // identificadores queda cubierta por tag/idv (inmutables, casos 1/2) y el apodo (custom, editable).
    // Caso 4 (permitido): NULL -> valor. El animal se crea SIN identificador (0 identificadores persisten,
    // IDU.1.4) y luego se le asigna el tag por primera vez (NULL->valor).
    {
      const an = await createAnimal(clientA, { sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      const { error } = await clientA.from('animals').update({ tag_electronic: `${RUN_TAG}_IMNEW` }).eq('id', an.animalId);
      assert.equal(error, null, 'NULL->valor permitido (R4.13.a)');
    }
    // Caso 5 (defensivo): valor -> NULL falla.
    {
      const an = await createAnimal(clientA, { tag: `${RUN_TAG}_IMDEF`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      const { data: upd } = await clientA.from('animals').update({ tag_electronic: null }).eq('id', an.animalId).select();
      assert.ok(!upd || upd.length === 0, 'valor->NULL debe fallar (R4.13.c)');
    }
  });

  // ---- T2.15 cronología v2 con 7 orígenes ---------------------------------
  await t.test('T2.15 cronología v2 (observacion)', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TL2`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 300, weight_date: daysAgo(5) });
    await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto', event_date: daysAgo(4), pregnancy_status: 'empty' });
    await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'Mancha', event_date: daysAgo(3) });
    await clientA.from('condition_score_events').insert({ animal_profile_id: an.profile.id, score: 3.50, event_date: daysAgo(2) });
    await clientA.from('animal_events').insert({ animal_profile_id: an.profile.id, establishment_id: estA, event_type: 'observacion', text: 'obs timeline' });
    {
      const { data, error } = await clientA.rpc('animal_timeline', { profile_id: an.profile.id });
      assert.equal(error, null, error && error.message);
      // 5 eventos + 1 category_change initial = 6
      assert.equal(data.length, 6, 'timeline v2: 5 eventos + category_change initial');
      assert.ok(data.some((r) => r.event_kind === 'observacion'), 'incluye observacion');
    }
    // borrar observacion (RPC soft_delete_animal_event) -> ya no aparece.
    {
      const { data: obs } = await clientA.from('animal_events').select('id').eq('animal_profile_id', an.profile.id).eq('text', 'obs timeline').single();
      const { error } = await clientA.rpc('soft_delete_animal_event', { p_event_id: obs.id });
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.rpc('animal_timeline', { profile_id: an.profile.id });
      assert.ok(!data.some((r) => r.event_kind === 'observacion'), 'observacion soft-deleted no aparece');
    }
    // userC sin rol -> 0 filas.
    {
      const userC = await createTestUser('userC15');
      const clientC = await getUserClient(userC.email);
      const { data } = await clientC.rpc('animal_timeline', { profile_id: an.profile.id });
      assert.deepEqual(data, [], 'userC sin rol -> 0 filas');
    }
  });

  // ---- T2.16 plantilla de datos (R2.8..R2.13) -----------------------------
  await t.test('T2.16 plantilla de datos', async () => {
    // Caso 1: catálogo global 27 activos, data_key único. // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    {
      const { data } = await clientA.from('field_definitions').select('data_key, label, category, data_type, ui_component').eq('active', true);
      assert.equal(data.length, 27, '27 field_definitions activos'); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
      const keys = data.map((r) => r.data_key);
      assert.equal(new Set(keys).size, keys.length, 'data_key único');
      assert.ok(data.every((r) => r.label && r.category && r.data_type), 'columnas pobladas');
    }
    // Caso 2: defaults por sistema cría = 27; 24 enabled; 3 off correctos. // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    {
      const { data } = await clientA
        .from('system_default_fields')
        .select('default_enabled, field_definition_id, field_definitions(data_key)')
        .eq('system_id', rodeoA.systemId);
      assert.equal(data.length, 27); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
      assert.equal(data.filter((r) => r.default_enabled).length, 24); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
      const offKeys = data.filter((r) => !r.default_enabled).map((r) => r.field_definitions.data_key).sort();
      assert.deepEqual(offKeys, ['inseminacion', 'peso_nacimiento', 'tuberculosis'].sort());
    }
    // Caso 3: catálogos read-only desde cliente.
    {
      const { error: e1 } = await clientA.from('field_definitions').insert({ data_key: `${RUN_TAG}_x`, label: 'x', category: 'manejo', data_type: 'propiedad' });
      assert.notEqual(e1, null, 'insert en field_definitions debe fallar (no policy)');
      const { error: e2 } = await clientA.from('system_default_fields').insert({ system_id: rodeoA.systemId, field_definition_id: '00000000-0000-0000-0000-000000000000', default_enabled: true });
      assert.notEqual(e2, null, 'insert en system_default_fields debe fallar (no policy)');
    }
    // Caso 4: pre-populate ya verificado en setup (27 filas, 24 enabled). Re-verificamos. // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    {
      const { data } = await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', rodeoA.id);
      assert.equal(data.length, 27); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
      assert.equal(data.filter((r) => r.enabled).length, 24); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    }
    // Caso 5: toggle owner-only.
    {
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'peso').single();
      const { error: ownerErr } = await clientA.from('rodeo_data_config').update({ enabled: false }).eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id);
      assert.equal(ownerErr, null, 'owner puede togglear');
      // userB es field_operator de estA -> no puede togglear.
      const { data: foUpd } = await clientB.from('rodeo_data_config').update({ enabled: true }).eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id).select();
      assert.deepEqual(foUpd, [], 'field_operator no puede togglear (RLS)');
      // restaurar
      await clientA.from('rodeo_data_config').update({ enabled: true }).eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id);
    }
    // Caso 6: habilitar field no-default (caso tambo+preñez con cría: insertamos un field nuevo no presente).
    // En cría los 27 ya están; para probar el INSERT de un field arbitrario del catálogo, // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    // primero borramos (vía service) una fila de rodeo_data_config y la re-insertamos como owner.
    {
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'inseminacion').single();
      await admin.from('rodeo_data_config').delete().eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id);
      // owner inserta el field del catálogo global -> OK.
      const { error: ownerIns } = await clientA.from('rodeo_data_config').insert({ rodeo_id: rodeoA.id, field_definition_id: fd.id, enabled: true });
      assert.equal(ownerIns, null, 'owner inserta field del catálogo global (R2.12)');
      // field_operator no puede insertar.
      await admin.from('rodeo_data_config').delete().eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id);
      const { error: foIns } = await clientB.from('rodeo_data_config').insert({ rodeo_id: rodeoA.id, field_definition_id: fd.id, enabled: true });
      assert.notEqual(foIns, null, 'field_operator no inserta (RLS)');
      // restaurar la fila (default era false para inseminacion).
      await admin.from('rodeo_data_config').insert({ rodeo_id: rodeoA.id, field_definition_id: fd.id, enabled: false });
    }
    // Caso 7: no DELETE desde cliente (no hay policy DELETE -> 0 filas afectadas).
    {
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'peso').single();
      const { data: del } = await clientA.from('rodeo_data_config').delete().eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id).select();
      assert.ok(!del || del.length === 0, 'DELETE desde cliente no afecta filas (no policy)');
      // la fila sigue existiendo.
      const { data: still } = await clientA.from('rodeo_data_config').select('field_definition_id').eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id);
      assert.equal(still.length, 1, 'la fila no se borró');
    }
    // Caso 8: CASCADE hard-delete (service_role borra rodeo -> filas desaparecen).
    {
      const rTmp = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_rcascade` });
      const before = await admin.from('rodeo_data_config').select('field_definition_id', { count: 'exact', head: true }).eq('rodeo_id', rTmp.id);
      assert.equal(before.count, 27); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
      await admin.from('rodeos').delete().eq('id', rTmp.id);
      const after = await admin.from('rodeo_data_config').select('field_definition_id', { count: 'exact', head: true }).eq('rodeo_id', rTmp.id);
      assert.equal(after.count, 0, 'CASCADE borró las filas de rodeo_data_config');
    }
    // Caso 9: RLS scoping (userC sin rol no ve config de estA).
    {
      const userC = await createTestUser('userC16');
      const clientC = await getUserClient(userC.email);
      const { data } = await clientC.from('rodeo_data_config').select('field_definition_id').eq('rodeo_id', rodeoA.id);
      assert.deepEqual(data, [], 'userC sin rol no ve rodeo_data_config (RLS)');
    }
  });

  // ---- T2.17 lote / management_groups (R2.14..R2.18) ----------------------
  await t.test('T2.17 lotes', async () => {
    // Caso 1: crear lote owner-only.
    let grpId;
    {
      const r = await createManagementGroup(clientA, { establishmentId: estA, name: `${RUN_TAG}_Otono2026` });
      assert.equal(r.error, undefined, r.error && r.error.message);
      grpId = r.id;
      // field_operator (userB) no puede crear.
      const r2 = await createManagementGroup(clientB, { establishmentId: estA, name: `${RUN_TAG}_FOlote` });
      assert.notEqual(r2.error, undefined, 'field_operator no crea lote (RLS)');
    }
    // Caso 2: asignar animal (field_operator OK).
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_LOTE_A1`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    {
      const { error } = await clientB.from('animal_profiles').update({ management_group_id: grpId }).eq('id', an.profile.id);
      assert.equal(error, null, 'field_operator asigna animal a lote (R2.17)');
      const { data } = await clientB.from('animal_profiles').select('management_group_id').eq('id', an.profile.id).maybeSingle();
      assert.equal(data.management_group_id, grpId);
    }
    // Caso 3: exclusividad (reasignar a otro lote).
    {
      const r2 = await createManagementGroup(clientA, { establishmentId: estA, name: `${RUN_TAG}_Lote2` });
      const { error } = await clientA.from('animal_profiles').update({ management_group_id: r2.id }).eq('id', an.profile.id);
      assert.equal(error, null);
      const { data } = await clientA.from('animal_profiles').select('management_group_id').eq('id', an.profile.id).single();
      assert.equal(data.management_group_id, r2.id, 'reasignar = un solo lote a la vez');
    }
    // Caso 4: asignar lote de OTRO establishment -> falla 23514.
    {
      const grpB = await createManagementGroup(clientB, { establishmentId: estB, name: `${RUN_TAG}_loteB` });
      const { data: upd } = await clientA.from('animal_profiles').update({ management_group_id: grpB.id }).eq('id', an.profile.id).select();
      assert.ok(!upd || upd.length === 0, 'lote de otro establishment debe fallar (R2.15)');
    }
    // Caso 5: lote inexistente -> falla.
    {
      const { data: upd } = await clientA.from('animal_profiles').update({ management_group_id: '00000000-0000-0000-0000-000000000000' }).eq('id', an.profile.id).select();
      assert.ok(!upd || upd.length === 0, 'lote inexistente debe fallar');
    }
    // Caso 6: quitar de lote (NULL).
    {
      const { error } = await clientA.from('animal_profiles').update({ management_group_id: null }).eq('id', an.profile.id);
      assert.equal(error, null, 'quitar de lote (NULL) OK');
    }
    // Caso 7: ortogonalidad — ya cubierto en T2.4. Verificación adicional desde ángulo lote.
    {
      const r3 = await createManagementGroup(clientA, { establishmentId: estA, name: `${RUN_TAG}_loteOrto` });
      const vqp = await createAnimal(clientA, { idv: `${RUN_TAG}_ORTO`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada' });
      await clientA.from('animal_profiles').update({ management_group_id: r3.id }).eq('id', vqp.profile.id);
      await clientA.from('reproductive_events').insert({ animal_profile_id: vqp.profile.id, event_type: 'birth', event_date: daysAgo(1) });
      const { data } = await clientA.from('animal_profiles').select('management_group_id, category_id').eq('id', vqp.profile.id).single();
      assert.equal(data.management_group_id, r3.id, 'lote intacto tras transición (R7.7)');
    }
    // Caso 8: soft-delete del lote (RPC soft_delete_management_group, owner-only).
    {
      // field_operator no puede soft-deletear.
      const { error: foErr } = await clientB.rpc('soft_delete_management_group', { p_group_id: grpId });
      assert.notEqual(foErr, null, 'field_operator no puede soft-deletear lote');
      // owner sí.
      const { error } = await clientA.rpc('soft_delete_management_group', { p_group_id: grpId });
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('management_groups').select('id').eq('id', grpId);
      assert.deepEqual(data, [], 'lote soft-deleted deja de verse (RLS)');
    }
    // Caso 9: RLS scoping.
    {
      const userC = await createTestUser('userC17');
      const clientC = await getUserClient(userC.email);
      const { data } = await clientC.from('management_groups').select('id').eq('establishment_id', estA);
      assert.deepEqual(data, [], 'userC sin rol no ve lotes de estA');
    }
  });

  // ---- T2.18 apply_auto_transition no es RPC público (SEC-HIGH-01 / R11.x) ----
  // apply_auto_transition es un helper SECURITY DEFINER interno del trigger de
  // transición (R7.7); NO debe ser invocable como RPC por el cliente. Un
  // authenticated del tenant B que conoce un profile_id del tenant A NO puede
  // moverle la categoría cross-tenant (el grant EXECUTE se revoca en 0042).
  await t.test('T2.18 apply_auto_transition no invocable cross-tenant (SEC-HIGH-01)', async () => {
    // Perfil objetivo en estA con categoría conocida (vaquillona).
    const target = await createAnimal(clientA, {
      idv: `${RUN_TAG}_SECTGT`, sex: 'female', birthDate: daysAgo(550),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona',
    });
    assert.equal(target.error, undefined, target.error && target.error.message);
    // categoría original (leída con service_role para no depender de RLS).
    const { data: before } = await admin
      .from('animal_profiles').select('category_id').eq('id', target.profile.id).single();
    const originalCategoryId = before.category_id;
    // categoría válida del system al que el atacante intentaría mover (multipara).
    const multiId = await categoryId(clientA, rodeoA.systemId, 'multipara');

    // userB: owner de estB, SIN rol en estA -> el ataque cross-tenant.
    // Nos aseguramos de que userB no tenga rol activo en estA en este punto.
    await admin.from('user_roles').update({ active: false })
      .eq('user_id', userB.id).eq('establishment_id', estA);

    // Intento de invocar la RPC: debe fallar (función no accesible / permission denied).
    const { error: rpcErr } = await clientB.rpc('apply_auto_transition', {
      profile_id: target.profile.id,
      target_category_id: multiId,
    });
    assert.notEqual(rpcErr, null, 'apply_auto_transition NO debe ser invocable por authenticated (SEC-HIGH-01)');
    assert.match(
      String(rpcErr.message + ' ' + (rpcErr.code || '')),
      /permission denied|not find|does not exist|PGRST202|42501|404/i,
      'el error debe ser de no-acceso/no-encontrada, no un cambio aplicado',
    );

    // Verificación load-bearing: la categoría del perfil de estA NO cambió.
    const { data: after } = await admin
      .from('animal_profiles').select('category_id').eq('id', target.profile.id).single();
    assert.equal(after.category_id, originalCategoryId, 'la categoría del perfil ajeno NO debe cambiar (R11.x)');
  });

  // ---- T2.19 Tests de no-bypass del delta Tier 1 (Gate 1, sesión 20) -------
  // Cierre de los 4 findings del Gate 1 (SEC-SPEC-01..04) sobre las migrations
  // 0043-0047. Corren contra DB remota; el estado real se lee con service_role.
  await t.test('T2.19 no-bypass delta Tier 1 (SEC-SPEC-01..04)', async (st) => {

    // -- Caso 1: exit_animal_profile exige rol activo (SEC-SPEC-01, espejo de T2.18) --
    await st.test('caso 1: exit_animal_profile autor-sin-rol -> 42501, status sin cambiar', async () => {
      // userD: lo hacemos field_operator de estA, crea un animal (queda created_by = userD),
      // luego le desactivamos el rol y prueba dar de baja.
      const userD = await createTestUser('userD19');
      const clientD = await getUserClient(userD.email);
      await assignRoleAsService(userD.id, estA, 'field_operator');
      const an = await createAnimal(clientD, {
        idv: `${RUN_TAG}_EXIT1`, sex: 'female', birthDate: daysAgo(400),
        rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId,
      });
      assert.equal(an.error, undefined, an.error && an.error.message);
      // created_by quedó forzado a userD (server-side).
      {
        const { data } = await admin.from('animal_profiles').select('created_by, status').eq('id', an.profile.id).single();
        assert.equal(data.created_by, userD.id, 'created_by = autor real (userD)');
        assert.equal(data.status, 'active');
      }
      // Desactivamos el rol de userD en estA.
      await admin.from('user_roles').update({ active: false }).eq('user_id', userD.id).eq('establishment_id', estA);
      // userD (created_by, pero rol inactivo) intenta dar de baja -> 42501.
      {
        const { error } = await clientD.rpc('exit_animal_profile', {
          p_profile_id: an.profile.id, p_status: 'sold', p_exit_reason: 'sale', p_exit_date: daysAgo(0),
        });
        assert.notEqual(error, null, 'autor sin rol activo NO debe poder dar de baja (SEC-SPEC-01)');
        assert.match(String(error.message + ' ' + (error.code || '')), /not authorized|42501/i);
      }
      // status leído con service_role: sigue active, exit_* sin setear.
      {
        const { data } = await admin.from('animal_profiles')
          .select('status, exit_reason, exit_date').eq('id', an.profile.id).single();
        assert.equal(data.status, 'active', 'la baja NO se aplicó (status sigue active)');
        assert.equal(data.exit_reason, null, 'exit_reason no se seteó');
        assert.equal(data.exit_date, null, 'exit_date no se seteó');
      }
      // Variante de control: el owner (userA, rol activo) sí puede dar de baja.
      {
        const { error } = await clientA.rpc('exit_animal_profile', {
          p_profile_id: an.profile.id, p_status: 'sold', p_exit_reason: 'sale', p_exit_date: daysAgo(0),
        });
        assert.equal(error, null, error && error.message);
        const { data } = await admin.from('animal_profiles')
          .select('status, exit_reason, deleted_at').eq('id', an.profile.id).single();
        assert.equal(data.status, 'sold', 'owner sí da de baja');
        assert.equal(data.exit_reason, 'sale');
        assert.equal(data.deleted_at, null, 'baja NO es soft-delete (deleted_at NULL, R4.12/R4.15)');
      }
    });

    // -- Caso 2: register_birth no cruza tenant (SEC-SPEC-02) --
    await st.test('caso 2: register_birth cross-tenant A->B -> 42501, nada creado; control crea todo', async () => {
      // Madre en estB (tenant B). userA no tiene rol en estB.
      const madreB = await createAnimal(clientB, {
        idv: `${RUN_TAG}_RBmotherB`, sex: 'female', birthDate: daysAgo(900),
        rodeoId: rodeoB.id, establishmentId: estB, systemId: rodeoB.systemId, categoryCode: 'vaquillona_prenada',
      });
      assert.equal(madreB.error, undefined, madreB.error && madreB.error.message);
      // Snapshot de conteos antes del ataque (service_role).
      const evBefore = await admin.from('reproductive_events')
        .select('id', { count: 'exact', head: true }).eq('animal_profile_id', madreB.profile.id);
      const profBefore = await admin.from('animal_profiles')
        .select('id', { count: 'exact', head: true }).eq('establishment_id', estB);
      // userA (tenant A) invoca register_birth sobre la madre de B -> 42501.
      {
        const { error } = await clientA.rpc('register_birth', {
          p_mother_profile_id: madreB.profile.id, p_event_date: daysAgo(1),
          p_calves: [{ calf_sex: 'male' }],
        });
        assert.notEqual(error, null, 'register_birth cross-tenant debe fallar (SEC-SPEC-02)');
        assert.match(String(error.message + ' ' + (error.code || '')), /not authorized|42501/i);
      }
      // Nada se creó: ni evento, ni nuevos perfiles en estB.
      {
        const evAfter = await admin.from('reproductive_events')
          .select('id', { count: 'exact', head: true }).eq('animal_profile_id', madreB.profile.id);
        assert.equal(evAfter.count, evBefore.count, 'no se creó evento de parto en B');
        const profAfter = await admin.from('animal_profiles')
          .select('id', { count: 'exact', head: true }).eq('establishment_id', estB);
        assert.equal(profAfter.count, profBefore.count, 'no se creó ningún perfil de ternero en B');
      }
      // Variante de control: clientB (dueño de la madre) registra mellizos -> crea todo.
      {
        const { data: birthId, error } = await clientB.rpc('register_birth', {
          p_mother_profile_id: madreB.profile.id, p_event_date: daysAgo(1),
          p_calves: [{ calf_sex: 'male', calf_weight: 32 }, { calf_sex: 'female', calf_weight: 30 }],
        });
        assert.equal(error, null, error && error.message);
        assert.ok(birthId, 'register_birth devuelve el id del evento de parto');
        // 2 filas en birth_calves para ese parto.
        const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
        assert.equal(bc.length, 2, 'parto de mellizos crea 2 filas en birth_calves (R7.9)');
        // Los 2 terneros existen, en estB, rodeo de la madre, categoría ternero/ternera.
        const calfIds = bc.map((r) => r.calf_profile_id);
        const { data: calves } = await admin.from('animal_profiles')
          .select('establishment_id, rodeo_id, category_id, entry_origin').in('id', calfIds);
        assert.equal(calves.length, 2);
        for (const c of calves) {
          assert.equal(c.establishment_id, estB, 'ternero hereda el establishment de la madre (no del payload)');
          assert.equal(c.rodeo_id, rodeoB.id, 'ternero en el rodeo de la madre (R9.1)');
          assert.equal(c.entry_origin, 'born_here');
        }
        // El conteo de partos cuenta el EVENTO, no los 2 terneros: la madre transiciona +1 parto.
        const { data: m } = await admin.from('animal_profiles').select('category_id').eq('id', madreB.profile.id).single();
        const { data: mcat } = await admin.from('categories_by_system').select('code').eq('id', m.category_id).single();
        assert.equal(mcat.code, 'vaca_segundo_servicio', 'mellizos = UN parto (no doble-cuenta, R7.9)');
      }
    });

    // -- Caso 3: birth_calves no acepta INSERT directo de cliente (SEC-SPEC-04) --
    await st.test('caso 3: INSERT directo a birth_calves -> bloqueado (sin GRANT INSERT)', async () => {
      // Madre + parto mono propio (clientA) para tener un birth_event_id real propio.
      const madre = await createAnimal(clientA, {
        idv: `${RUN_TAG}_BCmother`, sex: 'female', birthDate: daysAgo(900),
        rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
      });
      await clientA.from('reproductive_events').insert({
        animal_profile_id: madre.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'female',
      });
      const { data: ev } = await clientA.from('reproductive_events')
        .select('id').eq('animal_profile_id', madre.profile.id).eq('event_type', 'birth')
        .order('created_at', { ascending: false }).limit(1).single();
      // Otro animal_profile cualquiera del propio establecimiento para intentar ligar.
      const other = await createAnimal(clientA, {
        idv: `${RUN_TAG}_BCother`, sex: 'male', birthDate: daysAgo(100),
        rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero',
      });
      // INSERT directo por PostgREST -> debe fallar (sin GRANT INSERT: permission denied).
      const { data: ins, error } = await clientA.from('birth_calves')
        .insert({ birth_event_id: ev.id, calf_profile_id: other.profile.id }).select();
      assert.ok(error || !ins || ins.length === 0, 'INSERT directo a birth_calves debe ser rechazado (SEC-SPEC-04)');
      if (error) {
        assert.match(String(error.message + ' ' + (error.code || '')), /permission denied|42501|not.*allow|denied/i);
      }
      // Verificación: NO quedó una fila que ligue other.profile a ese parto.
      const { data: rows } = await admin.from('birth_calves')
        .select('calf_profile_id').eq('birth_event_id', ev.id).eq('calf_profile_id', other.profile.id);
      assert.deepEqual(rows, [], 'no se fabricó parentesco falso vía INSERT directo');
    });

    // -- Caso 4: SELECT de birth_calves filtra evento soft-deleted (SEC-SPEC-04.a) --
    await st.test('caso 4: SELECT de birth_calves filtra parto soft-deleted', async () => {
      const madre = await createAnimal(clientA, {
        idv: `${RUN_TAG}_SDmother`, sex: 'female', birthDate: daysAgo(900),
        rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
      });
      // parto mono -> 1 fila en birth_calves (creada por el trigger SECURITY DEFINER).
      await clientA.from('reproductive_events').insert({
        animal_profile_id: madre.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'male',
      });
      const { data: ev } = await clientA.from('reproductive_events')
        .select('id').eq('animal_profile_id', madre.profile.id).eq('event_type', 'birth')
        .order('created_at', { ascending: false }).limit(1).single();
      // visible antes del soft-delete.
      {
        const { data } = await clientA.from('birth_calves').select('calf_profile_id').eq('birth_event_id', ev.id);
        assert.equal(data.length, 1, 'la fila puente del parto es visible antes del soft-delete');
      }
      // soft-delete del evento de parto vía RPC.
      {
        const { error } = await clientA.rpc('soft_delete_event', { p_kind: 'reproductive', p_event_id: ev.id });
        assert.equal(error, null, error && error.message);
      }
      // authenticated ya NO ve las filas de birth_calves (policy con re.deleted_at is null).
      {
        const { data } = await clientA.from('birth_calves').select('calf_profile_id').eq('birth_event_id', ev.id);
        assert.deepEqual(data, [], 'tras soft-delete del parto, las filas puente no son visibles (SEC-SPEC-04.a)');
      }
      // con service_role siguen físicamente presentes (no se hard-deletearon).
      {
        const { data } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', ev.id);
        assert.equal(data.length, 1, 'la fila puente sigue física (no hard-delete)');
      }
    });

    // -- Caso 5: created_by se fuerza server-side, no es spoofeable (SEC-SPEC-03) --
    await st.test('caso 5: created_by forzado a auth.uid() aunque el cliente mande otro', async () => {
      // userA inserta un animal_profile pasando created_by = userB explícito en el payload.
      const { speciesId } = await lookupSpeciesSystem(clientA, 'bovino', 'cria');
      const animalId = require('node:crypto').randomUUID();
      {
        const { error } = await clientA.from('animals')
          .insert({ id: animalId, sex: 'female', species_id: speciesId, tag_electronic: `${RUN_TAG}_CB5` });
        assert.equal(error, null, error && error.message);
      }
      const catId = await categoryId(clientA, rodeoA.systemId, 'vaquillona');
      const profileId = require('node:crypto').randomUUID();
      {
        const { error } = await clientA.from('animal_profiles').insert({
          id: profileId, animal_id: animalId, establishment_id: estA, rodeo_id: rodeoA.id,
          category_id: catId, status: 'active',
          created_by: userB.id,   // <- intento de spoof: atribuir el alta a otro usuario
        });
        assert.equal(error, null, error && error.message);
      }
      // service_role: created_by quedó = userA (el caller real), NO userB.
      {
        const { data } = await admin.from('animal_profiles').select('created_by').eq('id', profileId).single();
        assert.equal(data.created_by, userA.id, 'created_by forzado al caller real (SEC-SPEC-03)');
        assert.notEqual(data.created_by, userB.id, 'el valor spoofeado del cliente fue ignorado');
      }
      // Corolario de authz R4.14: userB (el uid spoofeado) NO puede dar de baja vía v_creator.
      // Le damos a userB rol activo en estA para aislar la rama v_creator (no la de owner).
      {
        await admin.from('user_roles').update({ active: false }).eq('user_id', userB.id).eq('establishment_id', estA);
        await assignRoleAsService(userB.id, estA, 'field_operator');
        const { error } = await clientB.rpc('exit_animal_profile', {
          p_profile_id: profileId, p_status: 'sold', p_exit_reason: 'sale', p_exit_date: daysAgo(0),
        });
        assert.notEqual(error, null, 'userB (no owner, no creator real) NO puede dar de baja vía v_creator');
        assert.match(String(error.message + ' ' + (error.code || '')), /not authorized|42501/i);
        const { data } = await admin.from('animal_profiles').select('status').eq('id', profileId).single();
        assert.equal(data.status, 'active', 'el animal sigue activo');
      }
    });

    // -- Caso 6: L2 — el alta del ternero al pie no la bloquean los triggers de validación --
    await st.test('caso 6 (L2): alta de ternero al pie (mono y mellizos) no bloqueada por triggers', async () => {
      // Mono: parto directo -> trigger crea ternero categoría ternero/ternera, mismo system.
      {
        const madre = await createAnimal(clientA, {
          idv: `${RUN_TAG}_L2mono`, sex: 'female', birthDate: daysAgo(900),
          rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
        });
        const { error } = await clientA.from('reproductive_events').insert({
          animal_profile_id: madre.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'male',
        });
        assert.equal(error, null, 'alta de ternero al pie (mono) NO debe ser bloqueada (L2)');
        const { data: ev } = await clientA.from('reproductive_events')
          .select('calf_id').eq('animal_profile_id', madre.profile.id).eq('event_type', 'birth')
          .order('created_at', { ascending: false }).limit(1).single();
        const { data: calf } = await admin.from('animal_profiles').select('category_id, rodeo_id').eq('id', ev.calf_id).single();
        const { data: cat } = await admin.from('categories_by_system').select('code, system_id').eq('id', calf.category_id).single();
        assert.equal(cat.code, 'ternero', 'ternero macho con categoría ternero');
        assert.equal(cat.system_id, rodeoA.systemId, 'categoría del mismo system que la madre');
        assert.equal(calf.rodeo_id, rodeoA.id, 'ternero en el rodeo de la madre (no aplica rodeo_same_system_check)');
      }
      // Mellizos: register_birth -> dos terneros, ambos del mismo system, sin bloqueo.
      {
        const madre = await createAnimal(clientA, {
          idv: `${RUN_TAG}_L2twin`, sex: 'female', birthDate: daysAgo(900),
          rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
        });
        const { data: birthId, error } = await clientA.rpc('register_birth', {
          p_mother_profile_id: madre.profile.id, p_event_date: daysAgo(1),
          p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }],
        });
        assert.equal(error, null, 'alta de mellizos NO debe ser bloqueada (L2)');
        const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
        assert.equal(bc.length, 2);
        const { data: calves } = await admin.from('animal_profiles').select('category_id').in('id', bc.map((r) => r.calf_profile_id));
        const codes = [];
        for (const c of calves) {
          const { data: cat } = await admin.from('categories_by_system').select('code, system_id').eq('id', c.category_id).single();
          assert.equal(cat.system_id, rodeoA.systemId, 'cada ternero del mismo system que la madre');
          codes.push(cat.code);
        }
        assert.deepEqual(codes.sort(), ['ternera', 'ternero'], 'un ternero y una ternera');
      }
    });

    // -- Caso 7: R4.5.1 relajada — cambio de rodeo permitido dentro del mismo sistema --
    await st.test('caso 7 (R4.5.1): mover animal a otro rodeo del mismo sistema es permitido', async () => {
      const an = await createAnimal(clientA, {
        idv: `${RUN_TAG}_RC1`, sex: 'female', birthDate: daysAgo(400),
        rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId,
      });
      // Segundo rodeo del mismo establecimiento (mismo system: MVP solo tiene 'cria').
      const rodeoA2 = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_RodeoA2` });
      assert.equal(rodeoA2.systemId, rodeoA.systemId, 'precondición: ambos rodeos comparten system');
      // Mover el animal: el trigger animal_profiles_rodeo_same_system_check NO debe bloquear.
      {
        const { error } = await clientA.from('animal_profiles')
          .update({ rodeo_id: rodeoA2.id }).eq('id', an.profile.id);
        assert.equal(error, null, 'cambio de rodeo dentro del mismo sistema debe ser permitido (R4.5.1)');
        const { data } = await admin.from('animal_profiles').select('rodeo_id').eq('id', an.profile.id).single();
        assert.equal(data.rodeo_id, rodeoA2.id, 'el animal quedó en el rodeo destino');
      }
    });

    // -- Control de rollback atómico (R2-NEW, R9.4/R9.5): ternero intermedio inválido --
    await st.test('control: register_birth con ternero intermedio inválido -> rollback total', async () => {
      const madre = await createAnimal(clientA, {
        idv: `${RUN_TAG}_RBmother`, sex: 'female', birthDate: daysAgo(900),
        rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
      });
      // Pre-creamos un animal con un TAG; lo usaremos como TAG duplicado en el ternero #2.
      const dupTag = `${RUN_TAG}_RBDUP`;
      await createAnimal(clientA, {
        tag: dupTag, sex: 'male', birthDate: daysAgo(100),
        rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero',
      });
      const evBefore = await admin.from('reproductive_events')
        .select('id', { count: 'exact', head: true }).eq('animal_profile_id', madre.profile.id);
      const profBefore = await admin.from('animal_profiles')
        .select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
      // register_birth con [valido, dup(intermedio), valido] -> el #2 viola el unique global de TAG.
      {
        const { error } = await clientA.rpc('register_birth', {
          p_mother_profile_id: madre.profile.id, p_event_date: daysAgo(1),
          p_calves: [
            { calf_sex: 'male' },
            { calf_sex: 'female', calf_tag_electronic: dupTag },   // intermedio inválido (TAG duplicado)
            { calf_sex: 'male' },
          ],
        });
        assert.notEqual(error, null, 'un ternero intermedio inválido debe abortar el parto (R9.4/R9.5)');
      }
      // Rollback total: ni evento de parto, ni terneros (el #1 que ya se había insertado tampoco).
      {
        const evAfter = await admin.from('reproductive_events')
          .select('id', { count: 'exact', head: true }).eq('animal_profile_id', madre.profile.id);
        assert.equal(evAfter.count, evBefore.count, 'rollback: no quedó el evento de parto');
        const profAfter = await admin.from('animal_profiles')
          .select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
        assert.equal(profAfter.count, profBefore.count, 'rollback: 0 terneros (incl. el #1 ya creado)');
      }
      // La madre NO transicionó (el evento se revirtió).
      {
        const { data: m } = await admin.from('animal_profiles').select('category_id').eq('id', madre.profile.id).single();
        const { data: mcat } = await admin.from('categories_by_system').select('code').eq('id', m.category_id).single();
        assert.equal(mcat.code, 'vaquillona_prenada', 'la madre no transicionó (parto revertido)');
      }
    });
  });

  // =====================================================================
  // Tier 2/3 — modelo de categorías de cría (RT2.x). Delta backend:
  // seed novillito/novillo, is_castrated, nursing, compute_category reescrita,
  // disparadores servicio/destete/parto/aborto, cortes de edad + cron, consistencia
  // trigger<->recompute, override, no-spoof. Cubre T8.a-T8.n de tasks-tier2.
  // =====================================================================

  // Helper: code de la categoría materializada de un perfil (leído con el client dado).
  async function profileCode(client, profileId) {
    const { data: p } = await client.from('animal_profiles').select('category_id').eq('id', profileId).single();
    const { data: c } = await client.from('categories_by_system').select('code').eq('id', p.category_id).single();
    return c.code;
  }
  // Helper: code que compute_category devuelve para un perfil (RPC).
  async function computeCode(client, profileId) {
    const { data, error } = await client.rpc('compute_category', { profile_id: profileId });
    assert.equal(error, null, error && error.message);
    const { data: c } = await client.from('categories_by_system').select('code').eq('id', data).single();
    return c.code;
  }

  // ---- T2.20 seed novillito/novillo (RT2.1.x) -----------------------------
  await t.test('T2.20 seed novillito/novillo (RT2.1.x)', async () => {
    const { data, error } = await clientA
      .from('categories_by_system').select('code, active').eq('system_id', rodeoA.systemId);
    assert.equal(error, null, error && error.message);
    const byCode = Object.fromEntries(data.map((r) => [r.code, r.active]));
    assert.equal(byCode['novillito'], true, 'novillito sembrado y activo');
    assert.equal(byCode['novillo'], true, 'novillo sembrado y activo');
    // las 10 base siguen presentes y activas (RT2.1.2).
    for (const code of ['ternero', 'ternera', 'vaquillona', 'vaquillona_prenada', 'vaca_segundo_servicio', 'multipara', 'cut', 'vaca_cabana', 'toro', 'torito']) {
      assert.equal(byCode[code], true, `categoría base ${code} sigue activa`);
    }
  });

  // ---- T2.21 compute_category rama macho (alta directa) (RT2.3.x) ---------
  await t.test('T2.21 compute_category rama macho (RT2.3.x)', async () => {
    async function makeMale({ birthDate, castrated = false, code = 'torito' }) {
      const r = await createAnimal(clientA, { idv: `${RUN_TAG}_M_${Math.random().toString(36).slice(2, 7)}`, sex: 'male', birthDate, rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: code });
      assert.equal(r.error, undefined, r.error && r.error.message);
      if (castrated) {
        const { error } = await clientA.from('animals').update({ is_castrated: true }).eq('id', r.animalId);
        assert.equal(error, null, error && error.message);
      }
      return r;
    }
    // macho <1 año, entero -> ternero (RT2.3.1)
    assert.equal(await computeCode(clientA, (await makeMale({ birthDate: daysAgo(180), code: 'ternero' })).profile.id), 'ternero');
    // macho >=1<2 año, entero -> torito (RT2.3.2)
    assert.equal(await computeCode(clientA, (await makeMale({ birthDate: daysAgo(400) })).profile.id), 'torito');
    // macho >=2 años, entero -> toro (RT2.3.3)
    assert.equal(await computeCode(clientA, (await makeMale({ birthDate: daysAgo(800) })).profile.id), 'toro');
    // macho >=1<2 año, castrado -> novillito (RT2.3.2)
    assert.equal(await computeCode(clientA, (await makeMale({ birthDate: daysAgo(400), castrated: true })).profile.id), 'novillito');
    // macho >=2 años, castrado -> novillo (RT2.3.3)
    assert.equal(await computeCode(clientA, (await makeMale({ birthDate: daysAgo(800), castrated: true })).profile.id), 'novillo');
    // macho birth_date NULL, entero -> torito (RT2.3.4)
    assert.equal(await computeCode(clientA, (await makeMale({ birthDate: null })).profile.id), 'torito');
  });

  // ---- T2.22 compute_category rama hembra (alta directa) (RT2.4.x) --------
  await t.test('T2.22 compute_category rama hembra (RT2.4.x)', async () => {
    async function makeFemale({ birthDate, code = 'vaquillona' }) {
      const r = await createAnimal(clientA, { idv: `${RUN_TAG}_F_${Math.random().toString(36).slice(2, 7)}`, sex: 'female', birthDate, rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: code });
      assert.equal(r.error, undefined, r.error && r.error.message);
      return r;
    }
    // hembra <1 año sin eventos -> ternera (RT2.4.5)
    assert.equal(await computeCode(clientA, (await makeFemale({ birthDate: daysAgo(180), code: 'ternera' })).profile.id), 'ternera');
    // hembra >=1 año sin eventos -> vaquillona (RT2.4.4)
    assert.equal(await computeCode(clientA, (await makeFemale({ birthDate: daysAgo(550) })).profile.id), 'vaquillona');
    // hembra birth_date NULL sin eventos -> vaquillona (RT2.4.6)
    assert.equal(await computeCode(clientA, (await makeFemale({ birthDate: null })).profile.id), 'vaquillona');
  });

  // ---- T2.23 SERVICIO ya NO transiciona (RT2.5.x SUPERSEDED por RPS.4.1) ---
  // ⚠ Stream A (modelo de puesta en servicio, RPS.4.1, migración 0104 aplicada al remoto): se eliminó el
  // backstop `service→vaquillona` de compute_category. La promoción ternera→vaquillona ahora es SOLO por
  // destete (T2.24) o corte de edad ≥365d. RT2.5.1 (servicio promovía ternera→vaquillona) queda SUPERSEDED.
  // Las demás aserciones de este test (servicio sobre vaquillona/preñada/override = sin cambio) siguen vigentes.
  await t.test('T2.23 servicio NO transiciona ternera (RT2.5.x SUPERSEDED por RPS.4.1)', async () => {
    // ternera + service -> SIGUE ternera (RPS.4.1: el service ya no promueve; la promoción es por destete/edad).
    const tn = await createAnimal(clientA, { idv: `${RUN_TAG}_SV1`, sex: 'female', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: tn.profile.id, event_type: 'service', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, tn.profile.id), 'ternera', 'servicio sobre ternera <365d NO transiciona (RPS.4.1)');
    {
      const { data } = await clientA.from('animal_profiles').select('category_override').eq('id', tn.profile.id).single();
      assert.equal(data.category_override, false, 'el service no tocó override (sigue false)');
    }
    // y el recompute directo coincide: ternera+service sin destete/edad sigue ternera (RPS.4.5 consistencia).
    assert.equal(await computeCode(clientA, tn.profile.id), 'ternera', 'compute_category con service histórico = ternera (RPS.4.5)');
    // servicio sobre vaquillona ya existente -> sin cambio (RT2.5.2)
    const vq = await createAnimal(clientA, { idv: `${RUN_TAG}_SV2`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: vq.profile.id, event_type: 'service', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, vq.profile.id), 'vaquillona', 'servicio sobre vaquillona no retrocede ni avanza (RT2.5.2)');
    // servicio sobre una preñada NO la retrocede (el tacto+ vigente domina en compute_category) (RT2.5.2)
    const pr = await createAnimal(clientA, { idv: `${RUN_TAG}_SV4`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: pr.profile.id, event_type: 'tacto', event_date: daysAgo(10), pregnancy_status: 'large' });
    assert.equal(await profileCode(clientA, pr.profile.id), 'vaquillona_prenada', 'precondición: preñada');
    await clientA.from('reproductive_events').insert({ animal_profile_id: pr.profile.id, event_type: 'service', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, pr.profile.id), 'vaquillona_prenada', 'servicio sobre preñada no la retrocede (RT2.5.2)');
    // servicio con override=true -> sin cambio (RT2.5.3)
    const tnov = await createAnimal(clientA, { idv: `${RUN_TAG}_SV3`, sex: 'female', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
    await clientA.from('animal_profiles').update({ category_override: true }).eq('id', tnov.profile.id);
    await clientA.from('reproductive_events').insert({ animal_profile_id: tnov.profile.id, event_type: 'service', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, tnov.profile.id), 'ternera', 'override bloquea servicio (RT2.5.3)');
  });

  // ---- T2.24 transición DESTETE (RT2.6.x) ---------------------------------
  await t.test('T2.24 destete (RT2.6.x)', async () => {
    // ternero macho entero + weaning -> torito (RT2.6.1)
    const tm = await createAnimal(clientA, { idv: `${RUN_TAG}_W1`, sex: 'male', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: tm.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, tm.profile.id), 'torito', 'ternero entero + destete -> torito (RT2.6.1)');
    // ternero macho castrado + weaning -> novillito (RT2.6.1)
    const tmc = await createAnimal(clientA, { idv: `${RUN_TAG}_W2`, sex: 'male', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    await clientA.from('animals').update({ is_castrated: true }).eq('id', tmc.animalId);
    // castrar un ternero NO transiciona (RT2.2.2): sigue ternero hasta el destete.
    assert.equal(await profileCode(clientA, tmc.profile.id), 'ternero', 'castrar ternero no transiciona (RT2.2.2)');
    await clientA.from('reproductive_events').insert({ animal_profile_id: tmc.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, tmc.profile.id), 'novillito', 'ternero castrado + destete -> novillito (RT2.6.1)');
    // ternera + weaning -> vaquillona (RT2.6.2)
    const tf = await createAnimal(clientA, { idv: `${RUN_TAG}_W3`, sex: 'female', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: tf.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, tf.profile.id), 'vaquillona', 'ternera + destete -> vaquillona (RT2.6.2)');
    // destete sobre torito ya graduado -> sin retroceso (RT2.6.3)
    const grad = await createAnimal(clientA, { idv: `${RUN_TAG}_W4`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: grad.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, grad.profile.id), 'torito', 'destete no retrocede a un torito (RT2.6.3)');
    // destete con override=true -> sin cambio (RT2.6.4)
    const ov = await createAnimal(clientA, { idv: `${RUN_TAG}_W5`, sex: 'female', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
    await clientA.from('animal_profiles').update({ category_override: true }).eq('id', ov.profile.id);
    await clientA.from('reproductive_events').insert({ animal_profile_id: ov.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, ov.profile.id), 'ternera', 'override bloquea destete (RT2.6.4)');
  });

  // ---- T2.25 PARTO desde cualquier categoría (RT2.7.1/2.7.2) --------------
  await t.test('T2.25 parto desde cualquier categoría + mellizos (RT2.7.1/2.7.2)', async () => {
    // vaquillona (sin pasar por preñada) + birth -> vaca_segundo_servicio (RT2.7.1)
    const vq = await createAnimal(clientA, { idv: `${RUN_TAG}_P1`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: vq.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'female' });
    assert.equal(await profileCode(clientA, vq.profile.id), 'vaca_segundo_servicio', 'vaquillona + parto -> vaca (RT2.7.1)');
    // ternera + birth -> vaca_segundo_servicio (salto desde ternera) (RT2.7.1/2.4.2)
    const tn = await createAnimal(clientA, { idv: `${RUN_TAG}_P2`, sex: 'female', birthDate: daysAgo(300), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: tn.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'male' });
    assert.equal(await profileCode(clientA, tn.profile.id), 'vaca_segundo_servicio', 'ternera que pare -> vaca (RT2.4.2)');
    // + 2º birth -> multipara (RT2.4.1)
    await clientA.from('reproductive_events').insert({ animal_profile_id: tn.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'female' });
    assert.equal(await profileCode(clientA, tn.profile.id), 'multipara', '2º parto -> multipara (RT2.4.1)');
    // mellizos: register_birth con 2 terneros = UN parto -> avanza una sola vez (RT2.7.2)
    const tw = await createAnimal(clientA, { idv: `${RUN_TAG}_P3`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    const { data: birthId, error: rbErr } = await clientA.rpc('register_birth', {
      p_mother_profile_id: tw.profile.id, p_event_date: daysAgo(1),
      p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }],
    });
    assert.equal(rbErr, null, rbErr && rbErr.message);
    {
      const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
      assert.equal(bc.length, 2, 'mellizos = 2 filas en birth_calves');
    }
    assert.equal(await profileCode(clientA, tw.profile.id), 'vaca_segundo_servicio', 'mellizos = UN parto (no doble-cuenta, RT2.7.2)');
  });

  // ---- T2.26 ABORTO revierte (RT2.7.3/2.7.4/2.7.6) ------------------------
  await t.test('T2.26 aborto revierte (RT2.7.3/2.7.4/2.7.6)', async () => {
    // vaquillona + tacto+ -> prenada; + abortion -> vaquillona (RT2.7.3)
    const vq = await createAnimal(clientA, { idv: `${RUN_TAG}_AB1`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: vq.profile.id, event_type: 'tacto', event_date: daysAgo(10), pregnancy_status: 'medium' });
    assert.equal(await profileCode(clientA, vq.profile.id), 'vaquillona_prenada', 'tacto+ -> preñada');
    await clientA.from('reproductive_events').insert({ animal_profile_id: vq.profile.id, event_type: 'abortion', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, vq.profile.id), 'vaquillona', 'aborto revierte preñez -> vaquillona (RT2.7.3)');
    // multipara que aborta queda multipara (RT2.7.4)
    const mp = await createAnimal(clientA, { idv: `${RUN_TAG}_AB2`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'multipara' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: mp.profile.id, event_type: 'birth', event_date: daysAgo(60) });
    await clientA.from('reproductive_events').insert({ animal_profile_id: mp.profile.id, event_type: 'birth', event_date: daysAgo(50) });
    assert.equal(await profileCode(clientA, mp.profile.id), 'multipara', 'precondición: multipara con 2 partos');
    await clientA.from('reproductive_events').insert({ animal_profile_id: mp.profile.id, event_type: 'abortion', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, mp.profile.id), 'multipara', 'multipara que aborta queda multipara (RT2.7.4)');
    // aborto con override=true -> sin cambio (RT2.7.6)
    const ov = await createAnimal(clientA, { idv: `${RUN_TAG}_AB3`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada' });
    await clientA.from('animal_profiles').update({ category_override: true }).eq('id', ov.profile.id);
    await clientA.from('reproductive_events').insert({ animal_profile_id: ov.profile.id, event_type: 'abortion', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, ov.profile.id), 'vaquillona_prenada', 'override bloquea aborto (RT2.7.6)');
  });

  // ---- T2.27 CASTRACIÓN (cambio de is_castrated) (RT2.2.x/2.10.4) ---------
  await t.test('T2.27 castración (RT2.2.x/2.10.4)', async () => {
    // torito + set is_castrated=true -> novillito (RT2.2.3)
    const to = await createAnimal(clientA, { idv: `${RUN_TAG}_CS1`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    await clientA.from('animals').update({ is_castrated: true }).eq('id', to.animalId);
    assert.equal(await profileCode(clientA, to.profile.id), 'novillito', 'torito castrado -> novillito (RT2.2.3)');
    // history registró auto_transition (RT2.10.4)
    {
      const { data } = await clientA.from('animal_category_history').select('reason').eq('animal_profile_id', to.profile.id);
      assert.ok(data.map((r) => r.reason).includes('auto_transition'), 'castración queda en history como auto_transition (RT2.10.4)');
    }
    // toro (>=2 años) + castrar -> novillo (RT2.2.4) — verifica el corte de 2 años en la delegación
    const tr = await createAnimal(clientA, { idv: `${RUN_TAG}_CS2`, sex: 'male', birthDate: daysAgo(800), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'toro' });
    await clientA.from('animals').update({ is_castrated: true }).eq('id', tr.animalId);
    assert.equal(await profileCode(clientA, tr.profile.id), 'novillo', 'toro castrado -> novillo, no novillito (RT2.2.4)');
    // ternero + castrar -> sigue ternero (RT2.2.2)
    const tn = await createAnimal(clientA, { idv: `${RUN_TAG}_CS3`, sex: 'male', birthDate: daysAgo(100), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    await clientA.from('animals').update({ is_castrated: true }).eq('id', tn.animalId);
    assert.equal(await profileCode(clientA, tn.profile.id), 'ternero', 'ternero castrado sigue ternero (RT2.2.2)');
    // castrar con override=true -> sin cambio (RT2.2.5)
    const ov = await createAnimal(clientA, { idv: `${RUN_TAG}_CS4`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    await clientA.from('animal_profiles').update({ category_override: true }).eq('id', ov.profile.id);
    await clientA.from('animals').update({ is_castrated: true }).eq('id', ov.animalId);
    assert.equal(await profileCode(clientA, ov.profile.id), 'torito', 'override bloquea castración (RT2.2.5)');
    // true->false AHORA SÍ revierte novillito->torito.
    // RECONCILIACIÓN as-built (spec 10 R13.5, migración 0086_castration_recompute_symmetric): el recompute
    // de castración pasó a ser SIMÉTRICO (D10: castrado = estado editable y reversible). Esto SUPERSEDE
    // RT2.2.6 de spec 02 Tier 2 ("true->false NO revierte"). La nota de reconciliación a nivel DOC en
    // requirements/design de spec 02 la coordina el LEADER (no se edita desde la terminal de spec 10).
    await clientA.from('animals').update({ is_castrated: false }).eq('id', to.animalId);
    assert.equal(await profileCode(clientA, to.profile.id), 'torito', 'des-castración SÍ revierte novillito->torito (spec 10 R13.5, recompute simétrico 0086; supersede RT2.2.6)');
  });

  // ---- T2.28 CRÍA AL PIE (nursing) (RT2.9.x) ------------------------------
  await t.test('T2.28 cría al pie / nursing (RT2.9.x)', async () => {
    const grp = await createManagementGroup(clientA, { establishmentId: estA, name: `${RUN_TAG}_loteNurs` });
    const madre = await createAnimal(clientA, { idv: `${RUN_TAG}_NU1`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada' });
    await clientA.from('animal_profiles').update({ management_group_id: grp.id }).eq('id', madre.profile.id);
    // birth con calf -> nursing true (RT2.9.1)
    await clientA.from('reproductive_events').insert({ animal_profile_id: madre.profile.id, event_type: 'birth', event_date: daysAgo(30), calf_sex: 'female' });
    {
      const { data } = await clientA.from('animal_profiles').select('nursing, category_id, rodeo_id, management_group_id').eq('id', madre.profile.id).single();
      assert.equal(data.nursing, true, 'parto -> nursing true (RT2.9.1)');
      // ortogonalidad: cambiar nursing no tocó rodeo ni lote (RT2.9.2). category cambió por el PARTO (no por nursing).
      assert.equal(data.rodeo_id, rodeoA.id, 'nursing no cambia rodeo (RT2.9.2)');
      assert.equal(data.management_group_id, grp.id, 'nursing no cambia lote (RT2.9.2)');
    }
    // resolver el ternero ligado al parto
    const { data: ev } = await clientA.from('reproductive_events').select('id').eq('animal_profile_id', madre.profile.id).eq('event_type', 'birth').order('created_at', { ascending: false }).limit(1).single();
    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', ev.id).single();
    const calfProfileId = bc.calf_profile_id;
    // destetar al ternero (weaning sobre el perfil del ternero) -> madre nursing false (RT2.9.1)
    const { data: wEv, error: wErr } = await admin.from('reproductive_events').insert({ animal_profile_id: calfProfileId, event_type: 'weaning', event_date: daysAgo(1) }).select('id').single();
    assert.equal(wErr, null, wErr && wErr.message);
    {
      const { data } = await admin.from('animal_profiles').select('nursing').eq('id', madre.profile.id).single();
      assert.equal(data.nursing, false, 'destete del ternero -> madre nursing false (RT2.9.1)');
    }
    // borrar el destete (soft-delete) -> madre vuelve nursing true (RT2.9.3)
    await admin.from('reproductive_events').update({ deleted_at: new Date().toISOString() }).eq('id', wEv.id);
    {
      const { data } = await admin.from('animal_profiles').select('nursing').eq('id', madre.profile.id).single();
      assert.equal(data.nursing, true, 'soft-delete del destete -> nursing vuelve true (RT2.9.3)');
    }
    // borrar el parto (soft-delete) -> nursing false (RT2.9.3)
    await admin.from('reproductive_events').update({ deleted_at: new Date().toISOString() }).eq('id', ev.id);
    {
      const { data } = await admin.from('animal_profiles').select('nursing').eq('id', madre.profile.id).single();
      assert.equal(data.nursing, false, 'soft-delete del parto -> nursing false (RT2.9.3)');
    }
    // MELLIZOS via register_birth -> nursing true (regresión: el AFTER INSERT del birth corre con
    // birth_calves aún vacío; el trigger de 0067 sobre birth_calves cierra el hueco).
    {
      const m2 = await createAnimal(clientA, { idv: `${RUN_TAG}_NU2`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada' });
      const { error: rbErr } = await clientA.rpc('register_birth', { p_mother_profile_id: m2.profile.id, p_event_date: daysAgo(20), p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }] });
      assert.equal(rbErr, null, rbErr && rbErr.message);
      const { data } = await admin.from('animal_profiles').select('nursing').eq('id', m2.profile.id).single();
      assert.equal(data.nursing, true, 'mellizos (register_birth) -> madre nursing true (RT2.9.1)');
    }
  });

  // ---- T2.29 CONSISTENCIA trigger<->recompute (la clave, RT2.10) ----------
  await t.test('T2.29 consistencia trigger<->recompute (RT2.10/2.7.5)', async () => {
    // borrar el weaning que graduó ternera->vaquillona -> vuelve a ternera (si <1 año) (RT2.10.2)
    // ⚠ Antes este bloque usaba un `service` (RT2.5.1, el backstop service→vaquillona). Stream A (RPS.4.1,
    // migración 0104) eliminó ese backstop: el service ya NO transiciona, así que NO sirve para ejercitar la
    // consistencia trigger↔recompute. Se usa el DESTETE (vía hembra), que sigue siendo disparador vivo y prueba
    // el mismo invariante (un evento que promueve + su soft-delete revierte). El soft-delete va por la RPC
    // soft_delete_event (0041; el UPDATE directo de deleted_at lo bloquea la RLS por visibilidad-on-RETURNING).
    // El UPDATE de deleted_at que la RPC hace adentro (SECURITY DEFINER) dispara el recálculo (0046/0063).
    {
      const tn = await createAnimal(clientA, { idv: `${RUN_TAG}_CN1`, sex: 'female', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
      const { data: ev } = await clientA.from('reproductive_events').insert({ animal_profile_id: tn.profile.id, event_type: 'weaning', event_date: daysAgo(1) }).select('id').single();
      assert.equal(await profileCode(clientA, tn.profile.id), 'vaquillona', 'precondición: destete graduó');
      const { error } = await clientA.rpc('soft_delete_event', { p_kind: 'reproductive', p_event_id: ev.id });
      assert.equal(error, null, error && error.message);
      assert.equal(await profileCode(clientA, tn.profile.id), 'ternera', 'borrar el destete revierte a ternera (RT2.10.2)');
    }
    // service NO transiciona y trigger==recompute igual (RPS.4.1 SUPERSEDE RT2.5.1): una ternera <365d con un
    // service insertado SIGUE ternera tanto por el trigger incremental como por compute_category recomputado.
    {
      const tn = await createAnimal(clientA, { idv: `${RUN_TAG}_CN1b`, sex: 'female', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: tn.profile.id, event_type: 'service', event_date: daysAgo(1) });
      assert.equal(await profileCode(clientA, tn.profile.id), 'ternera', 'service no transiciona (incremental) (RPS.4.1)');
      assert.equal(await computeCode(clientA, tn.profile.id), 'ternera', 'service no transiciona (recompute) → trigger==recompute (RPS.4.1/RT2.10.1)');
    }
    // borrar el weaning que graduó ternero->torito -> vuelve a ternero (RT2.10.2)
    {
      const tm = await createAnimal(clientA, { idv: `${RUN_TAG}_CN2`, sex: 'male', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
      const { data: ev } = await clientA.from('reproductive_events').insert({ animal_profile_id: tm.profile.id, event_type: 'weaning', event_date: daysAgo(1) }).select('id').single();
      assert.equal(await profileCode(clientA, tm.profile.id), 'torito', 'precondición: destete graduó');
      const { error } = await clientA.rpc('soft_delete_event', { p_kind: 'reproductive', p_event_id: ev.id });
      assert.equal(error, null, error && error.message);
      assert.equal(await profileCode(clientA, tm.profile.id), 'ternero', 'borrar el destete revierte a ternero (RT2.10.2)');
    }
    // borrar un birth de una multipara (2 partos) -> recálculo a vaca_segundo_servicio (1 parto) (RT2.10.2)
    {
      const mp = await createAnimal(clientA, { idv: `${RUN_TAG}_CN3`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
      const { data: b1 } = await clientA.from('reproductive_events').insert({ animal_profile_id: mp.profile.id, event_type: 'birth', event_date: daysAgo(60) }).select('id').single();
      await clientA.from('reproductive_events').insert({ animal_profile_id: mp.profile.id, event_type: 'birth', event_date: daysAgo(30) });
      assert.equal(await profileCode(clientA, mp.profile.id), 'multipara', 'precondición: 2 partos -> multipara');
      const { error } = await clientA.rpc('soft_delete_event', { p_kind: 'reproductive', p_event_id: b1.id });
      assert.equal(error, null, error && error.message);
      assert.equal(await profileCode(clientA, mp.profile.id), 'vaca_segundo_servicio', 'borrar un parto -> vaca (1 parto) (RT2.10.2)');
    }
    // aborto-revierte-tacto sobrevive al recompute (RT2.7.5) + por fecha
    {
      const vq = await createAnimal(clientA, { idv: `${RUN_TAG}_CN4`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: vq.profile.id, event_type: 'tacto', event_date: daysAgo(10), pregnancy_status: 'large' });
      const { data: abEv } = await clientA.from('reproductive_events').insert({ animal_profile_id: vq.profile.id, event_type: 'abortion', event_date: daysAgo(2) }).select('id').single();
      // incremental dejó vaquillona; recompute directo NO la deja prenada (RT2.7.5)
      assert.equal(await profileCode(clientA, vq.profile.id), 'vaquillona', 'incremental: aborto revierte');
      assert.equal(await computeCode(clientA, vq.profile.id), 'vaquillona', 'recompute: aborto-revierte-tacto sobrevive (RT2.7.5)');
      // mover la fecha del aborto ANTES del tacto -> el tacto vuelve a contar -> prenada (RT2.7.5 por fecha)
      await clientA.from('reproductive_events').update({ event_date: daysAgo(20) }).eq('id', abEv.id);
      assert.equal(await computeCode(clientA, vq.profile.id), 'vaquillona_prenada', 'aborto anterior al tacto: el tacto vuelve a contar (RT2.7.5 por fecha)');
      // y la materializada por el trigger de recálculo (que se disparó por el UPDATE de event_date) coincide
      assert.equal(await profileCode(clientA, vq.profile.id), 'vaquillona_prenada', 'recálculo on-update coincide con compute_category (RT2.10.1/2.10.3)');
    }
    // compute_category directo == categoría materializada tras una secuencia (RT2.10.1)
    {
      const sq = await createAnimal(clientA, { idv: `${RUN_TAG}_CN5`, sex: 'female', birthDate: daysAgo(300), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: sq.profile.id, event_type: 'service', event_date: daysAgo(40) });
      await clientA.from('reproductive_events').insert({ animal_profile_id: sq.profile.id, event_type: 'tacto', event_date: daysAgo(20), pregnancy_status: 'small' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: sq.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'male' });
      assert.equal(await profileCode(clientA, sq.profile.id), await computeCode(clientA, sq.profile.id), 'materializada == compute_category tras secuencia (RT2.10.1)');
      // El parto la lleva a vaca (1 parto); el service es inerte para la categoría (RPS.4.1) — la consistencia
      // trigger↔recompute se prueba igual sobre la secuencia completa.
      assert.equal(await profileCode(clientA, sq.profile.id), 'vaca_segundo_servicio', 'secuencia (service inerte)+tacto+parto -> vaca por el parto');
    }
  });

  // ---- T2.30 OVERRIDE manda en todas las transiciones nuevas (RT2.11) -----
  await t.test('T2.30 override manda + revert (RT2.11.x)', async () => {
    // con override=true: servicio/destete/parto/aborto/castración NO cambian la categoría.
    const baseCat = 'vaquillona';
    async function overrideAnimal(idv, sex = 'female', code = baseCat, birthDate = daysAgo(550)) {
      const r = await createAnimal(clientA, { idv: `${RUN_TAG}_${idv}`, sex, birthDate, rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: code });
      await clientA.from('animal_profiles').update({ category_override: true }).eq('id', r.profile.id);
      return r;
    }
    const a1 = await overrideAnimal('OV_SV');
    await clientA.from('reproductive_events').insert({ animal_profile_id: a1.profile.id, event_type: 'service', event_date: daysAgo(1) });
    assert.equal(await profileCode(clientA, a1.profile.id), baseCat, 'override bloquea servicio (RT2.11.1)');
    const a2 = await overrideAnimal('OV_BIRTH');
    await clientA.from('reproductive_events').insert({ animal_profile_id: a2.profile.id, event_type: 'birth', event_date: daysAgo(1), calf_sex: 'male' });
    assert.equal(await profileCode(clientA, a2.profile.id), baseCat, 'override bloquea parto (RT2.11.1)');
    const a3 = await overrideAnimal('OV_CS', 'male', 'torito', daysAgo(400));
    await clientA.from('animals').update({ is_castrated: true }).eq('id', a3.animalId);
    assert.equal(await profileCode(clientA, a3.profile.id), 'torito', 'override bloquea castración (RT2.11.1)');
    // revert: override=false + compute_category recalcula correcto con is_castrated + eventos (RT2.11.2)
    {
      const computed = (await clientA.rpc('compute_category', { profile_id: a3.profile.id })).data;
      await clientA.from('animal_profiles').update({ category_override: false, category_id: computed }).eq('id', a3.profile.id);
      // a3 es torito castrado de 400 días -> al revertir resuelve novillito (RT2.11.2)
      assert.equal(await profileCode(clientA, a3.profile.id), 'novillito', 'revert recalcula con is_castrated (RT2.11.2)');
    }
  });

  // ---- T2.31 SEGURIDAD / no-spoof (RT2.12.x) ------------------------------
  await t.test('T2.31 seguridad / no-spoof is_castrated + funciones internas (RT2.12.x)', async () => {
    // apply_auto_transition NO invocable por authenticated (ya cubierto en T2.18; re-afirmamos el revoke).
    {
      const tgt = await createAnimal(clientA, { idv: `${RUN_TAG}_SEC1`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
      const multiId = await categoryId(clientA, rodeoA.systemId, 'multipara');
      const { error } = await clientA.rpc('apply_auto_transition', { profile_id: tgt.profile.id, target_category_id: multiId });
      assert.notEqual(error, null, 'apply_auto_transition NO invocable por authenticated (RT2.12.2)');
    }
    // is_castrated cross-tenant: userC sin rol en estA no puede togglear is_castrated de un animal de estA.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_SEC2`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
      const userC = await createTestUser('userC31');
      const clientC = await getUserClient(userC.email);
      // userC no ve el animal (RLS) -> el update no afecta filas.
      const { data: upd } = await clientC.from('animals').update({ is_castrated: true }).eq('id', an.animalId).select();
      assert.ok(!upd || upd.length === 0, 'userC sin rol no togglea is_castrated cross-tenant (RT2.12.5)');
      // verificado con service_role: sigue false y la categoría no cambió.
      const { data: a } = await admin.from('animals').select('is_castrated').eq('id', an.animalId).single();
      assert.equal(a.is_castrated, false, 'is_castrated cross-tenant NO se aplicó');
      assert.equal(await profileCode(admin, an.profile.id), 'torito', 'la categoría del animal ajeno NO cambió');
    }
    // userB (field_operator de estA, asignado en tests previos) SÍ puede togglear is_castrated de estA.
    {
      // garantizar rol activo de userB en estA (puede haber quedado inactivo por T2.13 caso 10/T2.18).
      await admin.from('user_roles').update({ active: false }).eq('user_id', userB.id).eq('establishment_id', estA);
      await assignRoleAsService(userB.id, estA, 'field_operator');
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_SEC3`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
      const { error } = await clientB.from('animals').update({ is_castrated: true }).eq('id', an.animalId);
      assert.equal(error, null, 'field_operator de estA togglea is_castrated (RT2.12.1)');
      assert.equal(await profileCode(admin, an.profile.id), 'novillito', 'la transición se aplicó (torito->novillito) para el dueño');
    }
  });

  // ---- T2.32 migración no toca histórico (RT2.13.x) -----------------------
  await t.test('T2.32 migración no toca histórico (RT2.13.x)', async () => {
    // un animal con is_castrated=false y categoría base no migra por el solo seed.
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_HIST1`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    const { data: a } = await admin.from('animals').select('is_castrated').eq('id', an.animalId).single();
    assert.equal(a.is_castrated, false, 'is_castrated arranca false (default columna nueva, RT2.13.1)');
    assert.equal(await profileCode(clientA, an.profile.id), 'torito', 'la categoría base no cambió por el seed (RT2.13.2)');
    // y el perfil arranca nursing=false (default).
    const { data: p } = await admin.from('animal_profiles').select('nursing').eq('id', an.profile.id).single();
    assert.equal(p.nursing, false, 'nursing arranca false (default columna nueva)');
  });

  // ---- T2.33 CRON de edad (refresh_age_categories) (RT2.8.x, SEC-SPEC-M02) -
  await t.test('T2.33 cron refresh_age_categories: targeted/no-spoof/override (RT2.8.x)', async () => {
    // SEGURIDAD (SEC-SPEC-M02): clientA (authenticated) NO puede invocar la función (revocada).
    {
      const { error } = await clientA.rpc('refresh_age_categories');
      assert.notEqual(error, null, 'refresh_age_categories NO invocable por authenticated (RT2.12.6/M02)');
    }
    // recalcula age-stale corte 1 año: ternero @400 sin eventos -> torito.
    const tn = await createAnimal(clientA, { idv: `${RUN_TAG}_CR1`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    // recalcula age-stale corte 2 años: torito @800 entero -> toro; novillito @800 -> novillo.
    const to = await createAnimal(clientA, { idv: `${RUN_TAG}_CR2`, sex: 'male', birthDate: daysAgo(800), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    const noL = await createAnimal(clientA, { idv: `${RUN_TAG}_CR3`, sex: 'male', birthDate: daysAgo(800), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'novillito' });
    await admin.from('animals').update({ is_castrated: true }).eq('id', noL.animalId);
    // NO toca a los que no cruzaron umbral: ternero @100 sigue ternero; vaquillona @900 sigue vaquillona (hembra sin corte 2 años).
    const young = await createAnimal(clientA, { idv: `${RUN_TAG}_CR4`, sex: 'male', birthDate: daysAgo(100), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    const vqOld = await createAnimal(clientA, { idv: `${RUN_TAG}_CR5`, sex: 'female', birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    // respeta override: ternero @400 override=true no cambia.
    const ov = await createAnimal(clientA, { idv: `${RUN_TAG}_CR6`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    await clientA.from('animal_profiles').update({ category_override: true }).eq('id', ov.profile.id);
    // respeta soft-delete: perfil age-stale soft-deleted no se toca.
    const sd = await createAnimal(clientA, { idv: `${RUN_TAG}_CR7`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    await admin.from('animal_profiles').update({ deleted_at: new Date().toISOString() }).eq('id', sd.profile.id);

    // invocar el job vía service_role (ejercita el efecto sin esperar al schedule).
    const { error: cronErr } = await admin.rpc('refresh_age_categories');
    assert.equal(cronErr, null, cronErr && cronErr.message);

    assert.equal(await profileCode(admin, tn.profile.id), 'torito', 'cron: ternero@400 -> torito (corte 1 año, RT2.8.4)');
    assert.equal(await profileCode(admin, to.profile.id), 'toro', 'cron: torito@800 -> toro (corte 2 años)');
    assert.equal(await profileCode(admin, noL.profile.id), 'novillo', 'cron: novillito@800 castrado -> novillo');
    assert.equal(await profileCode(admin, young.profile.id), 'ternero', 'cron NO toca ternero@100 (RT2.8.4c)');
    assert.equal(await profileCode(admin, vqOld.profile.id), 'vaquillona', 'cron NO toca vaquillona vieja (hembra sin corte 2 años, RT2.8.4a)');
    assert.equal(await profileCode(admin, ov.profile.id), 'ternero', 'cron respeta override (RT2.8.3)');
    assert.equal(await profileCode(admin, sd.profile.id), 'ternero', 'cron respeta soft-delete');
    // el cambio del ternero@400 quedó en history como auto_transition (RT2.8.4b)
    {
      const { data } = await admin.from('animal_category_history').select('reason').eq('animal_profile_id', tn.profile.id);
      assert.ok(data.map((r) => r.reason).includes('auto_transition'), 'cron registra auto_transition en history (RT2.8.4b)');
    }
  });
});

// =====================================================================
// spec 13 — Hardening (DB layer): INPUT-1 (R2), A1-1 (R6), F1-1 (R8)
// Migraciones 0070 (CHECKs) y 0071 (animals_update with check) APLICADAS al remoto.
// Corre como el resto de la suite (fixtures con service_role, assertions con JWT REAL de
// un miembro del tenant escribiendo vía PostgREST directo, NO por la UI).
// =====================================================================
test('spec 13 — INPUT-1 / A1-1 / F1-1 (DB layer)', async (t) => {
  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoB;

  await t.test('setup: dos campos, miembro real en cada uno', async () => {
    userA = await createTestUser('s13_A');
    userB = await createTestUser('s13_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} s13_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} s13_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_s13_rA` });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_s13_rB` });
  });

  // -------------------------------------------------------------------
  // INPUT-1 (R2.1–R2.3): tope de largo server-side, muestreo por CLASE y por TIPO.
  // Cada caso escribe vía PostgREST directo (JWT de miembro): techo+1 → 23514, y el
  // borde `techo` → persiste (anti-falso-positivo). Cubre ≥3 tablas del refinamiento:
  // sanitary_events.notes (notes/text), animal_events.structured_payload (jsonb/bytes),
  // weight_events.notes (eventos). Más identidad: animal_profiles.idv (id corto),
  // animal_profiles.notes (notas), animals.tag_electronic (id corto), establishments.name.
  // -------------------------------------------------------------------
  await t.test('R2: INPUT-1 CHECK rechaza techo+1 (23514) y acepta el borde — muestreo por clase', async () => {
    // Animal de A para colgar eventos.
    const an = await createAnimal(clientA, {
      idv: `${RUN_TAG}_s13_idv`, sex: 'female', birthDate: daysAgo(500),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId,
    });
    assert.ok(an.profile, an.error && an.error.message);
    const profileId = an.profile.id;
    const animalId = an.animalId;

    // helper: intenta un UPDATE de una columna text de una tabla; espera 23514 si > techo.
    async function expectTextCap(table, col, idCol, idVal, cap, label) {
      // techo+1 → rechazo 23514.
      {
        const tooLong = 'x'.repeat(cap + 1);
        const { error } = await clientA.from(table).update({ [col]: tooLong }).eq(idCol, idVal);
        assert.ok(error, `${label}: techo+1 debería fallar`);
        assert.equal(error.code, '23514', `${label}: debería ser check_violation (23514), fue ${error.code}`);
      }
      // borde `techo` → persiste.
      {
        const exact = 'y'.repeat(cap);
        const { error } = await clientA.from(table).update({ [col]: exact }).eq(idCol, idVal);
        assert.equal(error, null, `${label}: el borde (techo) debería persistir: ${error && error.message}`);
        const { data } = await clientA.from(table).select(col).eq(idCol, idVal).single();
        assert.equal(data[col].length, cap, `${label}: el valor de largo=techo debería estar guardado`);
      }
    }

    // animal_profiles.notes (clase notas 4000) y .idv NO (inmutable por 0036 → usamos coat_color, id corto 64).
    await expectTextCap('animal_profiles', 'notes', 'id', profileId, 4000, 'animal_profiles.notes');
    await expectTextCap('animal_profiles', 'coat_color', 'id', profileId, 64, 'animal_profiles.coat_color');

    // animals.tag_electronic (id corto 64; techo subido de 32→64 por decisión de Raf 2026-06-05 para
    // acomodar los fixtures de test de ~45 chars sin perder el cap anti-abuso) — el animal aún NO tiene
    // TAG (se creó por IDV) → NULL→valor permitido por el trigger 0036; probamos el CHECK sobre la asignación.
    {
      const tooLong = '9'.repeat(65);
      const { error: e1 } = await clientA.from('animals').update({ tag_electronic: tooLong }).eq('id', animalId);
      assert.ok(e1, 'animals.tag_electronic techo+1 (65) debería fallar');
      assert.equal(e1.code, '23514', `animals.tag_electronic debería ser 23514, fue ${e1.code}`);
      const exact = '9'.repeat(64);
      const { error: e2 } = await clientA.from('animals').update({ tag_electronic: exact }).eq('id', animalId);
      assert.equal(e2, null, `animals.tag_electronic borde 64 debería persistir: ${e2 && e2.message}`);
    }

    // establishments.name (clase nombre-de-campo 160) — escribible por owner.
    await expectTextCap('establishments', 'name', 'id', estA, 160, 'establishments.name');
    // restaurar nombre del campo para no romper otros asserts dependientes del nombre.
    await admin.from('establishments').update({ name: `${RUN_TAG} s13_estA` }).eq('id', estA);

    // ── Tablas del refinamiento (R2.2): sanitary_events.notes (notes), weight_events.notes (eventos) ──
    // sanitary_events: insert mínimo, luego cap sobre notes.
    {
      const seId = require('node:crypto').randomUUID();
      const { error: insErr } = await clientA.from('sanitary_events').insert({
        id: seId, animal_profile_id: profileId, event_type: 'vaccination',
        product_name: 'Test vaccine', event_date: daysAgo(1), notes: 'ok',
      });
      assert.equal(insErr, null, insErr && `sanitary_events insert: ${insErr.message}`);
      await expectTextCap('sanitary_events', 'notes', 'id', seId, 4000, 'sanitary_events.notes');
    }
    {
      const weId = require('node:crypto').randomUUID();
      const { error: insErr } = await clientA.from('weight_events').insert({
        id: weId, animal_profile_id: profileId, weight_kg: 320.5, weight_date: daysAgo(1), notes: 'ok',
      });
      assert.equal(insErr, null, insErr && `weight_events insert: ${insErr.message}`);
      await expectTextCap('weight_events', 'notes', 'id', weId, 4000, 'weight_events.notes');
    }

    // ── jsonb por BYTES (R2.2): animal_events.structured_payload, techo 32768 bytes (octet_length) ──
    {
      const aeId = require('node:crypto').randomUUID();
      const { error: insErr } = await clientA.from('animal_events').insert({
        id: aeId, animal_profile_id: profileId, establishment_id: estA,
        event_type: 'otro', structured_payload: { k: 'ok' },
      });
      assert.equal(insErr, null, insErr && `animal_events insert: ${insErr.message}`);

      // payload cuyo octet_length(::text) > 32768. Un string JSON `{"k":"<N x 'a'>"}` tiene
      // overhead fijo (~8 bytes: {"k":""}) + N bytes del valor ASCII → N=32768 ya supera 32768.
      const bigVal = 'a'.repeat(32768);
      const { error: tooBig } = await clientA.from('animal_events')
        .update({ structured_payload: { k: bigVal } }).eq('id', aeId);
      assert.ok(tooBig, 'animal_events.structured_payload techo+1 bytes debería fallar');
      assert.equal(tooBig.code, '23514', `structured_payload debería ser 23514, fue ${tooBig.code}`);

      // borde: un payload por debajo del techo persiste.
      const okVal = 'b'.repeat(32000);
      const { error: okErr } = await clientA.from('animal_events')
        .update({ structured_payload: { k: okVal } }).eq('id', aeId);
      assert.equal(okErr, null, `structured_payload < techo debería persistir: ${okErr && okErr.message}`);
    }
  });

  // -------------------------------------------------------------------
  // A1-1 (R6.1–R6.3): animals_update with check re-valida has_role_in.
  // Animal cuyo ÚNICO perfil está en estB; un miembro SOLO de estA intenta UPDATE de esa
  // fila de animals vía PostgREST directo → RLS lo bloquea (0 filas). Control positivo:
  // el dueño del perfil (estB) SÍ puede actualizar un campo mutable.
  // -------------------------------------------------------------------
  await t.test('R6.1: miembro de estA NO puede UPDATE un animal cuyo único perfil está en estB (RLS)', async () => {
    const anB = await createAnimal(clientB, {
      idv: `${RUN_TAG}_s13_onlyB`, sex: 'female', birthDate: daysAgo(500),
      rodeoId: rodeoB.id, establishmentId: estB, systemId: rodeoB.systemId,
    });
    assert.ok(anB.profile, anB.error && anB.error.message);

    // userA (sin rol en estB) intenta mutar la fila de animals → 0 filas (RLS: el using no
    // encuentra perfil del animal con has_role_in para A). .select() para contar afectadas.
    const { data: affected, error } = await clientA
      .from('animals')
      .update({ sex: 'male' })
      .eq('id', anB.animalId)
      .select('id');
    assert.equal(error, null, error && error.message);
    assert.deepEqual(affected, [], 'A no debería poder actualizar el animal solo-de-B (0 filas, RLS)');

    // R6.2 control positivo: B (dueño del perfil) SÍ puede actualizar un campo mutable.
    const { data: okAffected, error: okErr } = await clientB
      .from('animals')
      .update({ birth_date: daysAgo(499) })
      .eq('id', anB.animalId)
      .select('id');
    assert.equal(okErr, null, okErr && okErr.message);
    assert.equal(okAffected.length, 1, 'B (con perfil del animal) debería poder actualizar');
  });

  // -------------------------------------------------------------------
  // F1-1 (R8.1): un término con metacaracteres de .or() NO altera la estructura del filtro
  // ni cruza columnas. Se ejecuta vía PostgREST directo replicando la sub-query parametrizada
  // del service (.ilike(col, pattern)). Comparamos contra un término literal equivalente: el
  // término malicioso NO debe traer filas que el literal no traería (no inyecta condición).
  // -------------------------------------------------------------------
  await t.test('R8.1: .ilike(col, pattern) parametrizado neutraliza filter-injection de .or()', async () => {
    // IDU.4.5: visual_id_alt se eliminó (0122) → el canal de búsqueda por substring es ahora `idv`. La prueba
    // de anti-injection se ejerce sobre `idv` (mismo builder .ilike(col, pattern) parametrizado).
    // Dos animales de A: uno con un idv que contiene un texto buscable, otro con un idv distinto.
    const aMarca = await createAnimal(clientA, {
      idv: `${RUN_TAG}_marca`, sex: 'female', birthDate: daysAgo(500),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId,
    });
    assert.ok(aMarca.profile, aMarca.error && aMarca.error.message);
    const aOther = await createAnimal(clientA, {
      idv: `${RUN_TAG}_s13_other`, sex: 'female', birthDate: daysAgo(500),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId,
    });
    assert.ok(aOther.profile, aOther.error && aOther.error.message);

    // Término MALICIOSO: intenta inyectar una condición vía sintaxis de .or() sobre el idv de aOther.
    // Con .ilike(idv, `%term%`) parametrizado, el valor viaja FUERA del filtro → se busca LITERALMENTE en
    // idv y no matchea nada (ningún idv contiene esa basura), y NO trae la fila de aOther (no inyecta condición).
    const malicious = `idv.eq.${RUN_TAG}_s13_other`;
    const { data: malData, error: malErr } = await clientA
      .from('animal_profiles')
      .select('id, idv')
      .eq('establishment_id', estA)
      .eq('status', 'active')
      .is('deleted_at', null)
      .ilike('idv', `%${malicious}%`)
      .limit(20);
    assert.equal(malErr, null, malErr && malErr.message);
    const broughtOther = (malData || []).some((r) => r.id === aOther.profile.id);
    assert.equal(broughtOther, false, 'el término malicioso NO debe traer la fila de aOther (no inyecta condición)');
    assert.equal((malData || []).length, 0, 'el término malicioso (buscado literal en idv) no matchea nada');

    // Control: un término LEGÍTIMO que sí está en el idv trae su fila (no rompimos la búsqueda).
    const { data: okData, error: okErr } = await clientA
      .from('animal_profiles')
      .select('id, idv')
      .eq('establishment_id', estA)
      .eq('status', 'active')
      .is('deleted_at', null)
      .ilike('idv', `%${RUN_TAG}_marca%`)
      .limit(20);
    assert.equal(okErr, null, okErr && okErr.message);
    const foundMarca = (okData || []).some((r) => r.id === aMarca.profile.id);
    assert.equal(foundMarca, true, 'un término legítimo en idv SÍ trae su fila (R7.5)');
  });
});

// =====================================================================
// spec 15-powersync — T2.20: idempotencia de register_birth vía p_client_op_id
// (delta T6.4 / R6.10 / R11.3 / R11.4 + fix HIGH-D1). Suite TOP-LEVEL propia (no es
// parte de spec 02 ni spec 13) con su propio setup aislado — espeja el patrón de la
// suite spec 13 de este archivo.
//
// El delta vive en supabase/migrations/0075_register_birth_idempotency.sql.
// ⚠️ Estos tests REQUIEREN la migración 0075 APLICADA al remoto (la aplica el leader por
// Management API tras gatear el SQL). Hasta entonces FALLAN — es ESPERADO: register_birth
// sigue con la firma de 3 args (uuid, date, jsonb), así que un call con p_client_op_id da
// PGRST202 (function not found). El implementer NO aplica la migración.
// =====================================================================
test('spec 15-powersync — register_birth idempotencia (delta T6.4, T7.7)', async (t) => {
  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoB;

  await t.test('setup: dos campos, miembro real en cada uno', async () => {
    userA = await createTestUser('s15_A');
    userB = await createTestUser('s15_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} s15_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} s15_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_s15_rA` });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_s15_rB` });
  });

  // -- Caso 1: mismo client_op_id + misma madre, dos veces -> UN SOLO parto (no doble-apply). --
  await t.test('caso 1: doble call con el mismo p_client_op_id (mismo caller, misma madre) -> un solo parto', async () => {
    const madre = await createAnimal(clientA, {
      idv: `${RUN_TAG}_IDEMP1`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(madre.error, undefined, madre.error && madre.error.message);
    const clientOpId = require('node:crypto').randomUUID();

    // Snapshot antes.
    const evBefore = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', madre.profile.id);
    const profBefore = await admin.from('animal_profiles')
      .select('id', { count: 'exact', head: true }).eq('establishment_id', estA);

    // 1er call: crea el parto (mellizos) y persiste el client_op_id.
    const r1 = await clientA.rpc('register_birth', {
      p_mother_profile_id: madre.profile.id, p_event_date: daysAgo(1),
      p_calves: [{ calf_sex: 'male', calf_weight: 32 }, { calf_sex: 'female', calf_weight: 30 }],
      p_client_op_id: clientOpId,
    });
    assert.equal(r1.error, null, r1.error && r1.error.message);
    assert.ok(r1.data, 'el 1er call devuelve el id del evento de parto');
    const birthId = r1.data;

    // 2do call: MISMO client_op_id, MISMA madre (simula el reintento at-least-once tras perder el ACK).
    // Debe ser un NO-OP idempotente: devuelve el MISMO id, NO crea un 2do parto ni 2 terneros nuevos.
    const r2 = await clientA.rpc('register_birth', {
      p_mother_profile_id: madre.profile.id, p_event_date: daysAgo(1),
      p_calves: [{ calf_sex: 'male', calf_weight: 32 }, { calf_sex: 'female', calf_weight: 30 }],
      p_client_op_id: clientOpId,
    });
    assert.equal(r2.error, null, r2.error && r2.error.message);
    assert.equal(r2.data, birthId, 'el reintento con el mismo client_op_id devuelve el MISMO id de parto (no-op idempotente)');

    // Estado real (service_role): exactamente UN evento de parto y 2 terneros (no 4).
    const evAfter = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true })
      .eq('animal_profile_id', madre.profile.id).eq('event_type', 'birth');
    assert.equal(evAfter.count, evBefore.count + 1, 'exactamente UN evento de parto creado (no 2)');

    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    assert.equal(bc.length, 2, 'exactamente 2 terneros (no 4): el reintento no creó terneros nuevos');

    const profAfter = await admin.from('animal_profiles')
      .select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
    assert.equal(profAfter.count, profBefore.count + 2, 'solo 2 perfiles de ternero creados en total (no 4)');

    // La madre transicionó UNA sola vez (mellizos = 1 parto): vaquillona_prenada -> vaca_segundo_servicio.
    const { data: m } = await admin.from('animal_profiles').select('category_id').eq('id', madre.profile.id).single();
    const { data: mcat } = await admin.from('categories_by_system').select('code').eq('id', m.category_id).single();
    assert.equal(mcat.code, 'vaca_segundo_servicio', 'la madre avanzó UN solo parto (no doble-cuenta por el reintento)');
  });

  // -- Caso 2 (T7.7, fix HIGH-D1, OBLIGATORIO): cross-tenant. B replay-ea el client_op_id de A
  //    sobre una madre PROPIA de B -> B NO recibe datos del parto de A (no IDOR); A intacto. --
  await t.test('caso 2 (T7.7): client_op_id colisionado cross-tenant -> no IDOR; parto ajeno intacto', async () => {
    // A registra un parto con un client_op_id X sobre SU madre.
    const madreA = await createAnimal(clientA, {
      idv: `${RUN_TAG}_XTmotherA`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(madreA.error, undefined, madreA.error && madreA.error.message);
    const sharedOpId = require('node:crypto').randomUUID();
    const rA = await clientA.rpc('register_birth', {
      p_mother_profile_id: madreA.profile.id, p_event_date: daysAgo(1),
      p_calves: [{ calf_sex: 'male' }],
      p_client_op_id: sharedOpId,
    });
    assert.equal(rA.error, null, rA.error && rA.error.message);
    const birthIdA = rA.data;
    assert.ok(birthIdA, 'A creó su parto');
    // Snapshot del parto de A (terneros) ANTES del ataque de B.
    const { data: bcABefore } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthIdA);
    assert.equal(bcABefore.length, 1, 'precondición: el parto de A tiene 1 ternero');

    // B (otro establecimiento, SIN rol en estA) replay-ea el MISMO client_op_id X sobre una madre PROPIA de B.
    const madreB = await createAnimal(clientB, {
      idv: `${RUN_TAG}_XTmotherB`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoB.id, establishmentId: estB, systemId: rodeoB.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(madreB.error, undefined, madreB.error && madreB.error.message);
    const profBBefore = await admin.from('animal_profiles')
      .select('id', { count: 'exact', head: true }).eq('establishment_id', estB);

    const rB = await clientB.rpc('register_birth', {
      p_mother_profile_id: madreB.profile.id, p_event_date: daysAgo(1),
      p_calves: [{ calf_sex: 'female' }],
      p_client_op_id: sharedOpId,    // <- replay del client_op_id observado de A (attacker-controlled)
    });

    // INVARIANTE (no IDOR): B NUNCA recibe el id/datos del parto de A. Solo dos resultados ACEPTABLES:
    //  (a) B crea su PROPIO parto (la madre de B no matchea el scope del guard de A -> camino de
    //      creación; el índice compuesto por (madre, client_op_id) NO colisiona porque la madre es
    //      distinta) -> rB.data != birthIdA y el parto creado es de B; o
    //  (b) error genérico (23505/unique_violation) sin filtrar datos ajenos.
    // Lo que JAMÁS debe pasar: rB.data === birthIdA (devolvería el parto de A por el canal RPC).
    if (rB.error) {
      // Camino (b): error genérico, sin oráculo de existencia/propietario del parto ajeno.
      assert.match(
        String(rB.error.message + ' ' + (rB.error.code || '')),
        /23505|unique|duplicate|not authorized|42501/i,
        'colisión cross-tenant -> error genérico (no un mensaje que revele el parto de A)',
      );
      // El mensaje no debe filtrar el id del parto de A.
      assert.ok(!String(rB.error.message).includes(birthIdA), 'el error NO debe contener el id del parto de A');
    } else {
      // Camino (a): B creó su propio parto distinto del de A.
      assert.notEqual(rB.data, birthIdA, 'B NO recibe el id del parto de A (no IDOR cross-tenant)');
      assert.ok(rB.data, 'B obtuvo el id de SU propio parto');
      // El parto que B obtuvo es de la madre de B (su tenant), no el de A.
      const { data: evB } = await admin.from('reproductive_events')
        .select('animal_profile_id').eq('id', rB.data).single();
      assert.equal(evB.animal_profile_id, madreB.profile.id, 'el parto de B es sobre la madre de B');
      const profBAfter = await admin.from('animal_profiles')
        .select('id', { count: 'exact', head: true }).eq('establishment_id', estB);
      assert.ok(profBAfter.count > profBBefore.count, 'B creó su propio ternero en su propio establecimiento');
    }

    // El parto de A queda INTACTO pase lo que pase con B.
    const { data: bcAAfter } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthIdA);
    assert.deepEqual(
      bcAAfter.map((r) => r.calf_profile_id).sort(),
      bcABefore.map((r) => r.calf_profile_id).sort(),
      'el parto de A queda intacto (mismos terneros, sin alteración por el replay de B)',
    );
    const { data: evAStill } = await admin.from('reproductive_events')
      .select('id, client_op_id, animal_profile_id').eq('id', birthIdA).single();
    assert.equal(evAStill.animal_profile_id, madreA.profile.id, 'el evento de A sigue siendo de la madre de A');
    assert.equal(evAStill.client_op_id, sharedOpId, 'el client_op_id del parto de A sigue siendo el suyo');
  });

  // -- Caso 3: path online intacto (p_client_op_id ausente/NULL = comportamiento as-built). --
  await t.test('caso 3: register_birth SIN p_client_op_id -> comportamiento idéntico al as-built', async () => {
    const madre = await createAnimal(clientA, {
      idv: `${RUN_TAG}_ONLINE1`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(madre.error, undefined, madre.error && madre.error.message);
    // Call de 3 args (sin p_client_op_id): el default null resuelve la firma; el guard no entra.
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: madre.profile.id, p_event_date: daysAgo(1),
      p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }],
    });
    assert.equal(error, null, error && error.message);
    assert.ok(birthId, 'register_birth online (3 args) devuelve el id del parto');
    // Mismo comportamiento que el as-built: 2 terneros, client_op_id NULL, madre transiciona.
    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    assert.equal(bc.length, 2, 'parto online de mellizos crea 2 terneros (as-built)');
    const { data: ev } = await admin.from('reproductive_events').select('client_op_id').eq('id', birthId).single();
    assert.equal(ev.client_op_id, null, 'el parto online queda con client_op_id NULL (no afecta históricos)');
    const { data: m } = await admin.from('animal_profiles').select('category_id').eq('id', madre.profile.id).single();
    const { data: mcat } = await admin.from('categories_by_system').select('code').eq('id', m.category_id).single();
    assert.equal(mcat.code, 'vaca_segundo_servicio', 'la madre transiciona igual que en el as-built');
  });
});

// =====================================================================
// spec 15-powersync — PASO 2 (denormalización de establishment_id): tablas hijas + identidad de animal.
// Migraciones 0077 (eventos vía perfil + animal_category_history), 0078 (birth_calves + rodeo_data_config),
// 0079 (identidad de animal sobre animal_profiles, b1). ADR-026 / design §2.4 / R13.
//
// El INVARIANTE que verifican estos tests es lo que sostiene el scoping del wire de sync JOIN-free: la columna
// denormalizada DEBE ser FIEL al padre (anti-spoof). Un cliente que pasa un establishment_id/identidad AJENO en
// el payload NO debe poder pisar la columna → el trigger la FUERZA desde el padre real.
//
// ⚠️ Estos tests REQUIEREN las migraciones 0077/0078/0079 APLICADAS al remoto (las aplica el leader por
// Management API tras gatear el SQL: Gate 1 spec + Gate 2 + reviewer). Hasta entonces FALLAN — es ESPERADO:
// la columna `establishment_id`/`animal_*` aún no existe en esas tablas, así que el INSERT/SELECT que la
// referencia da error de columna inexistente (PGRST/42703). El implementer NO aplica las migraciones. Mismo
// patrón que la suite spec 15-powersync (delta 0075) y los tests 0076 de rls/run.cjs.
// =====================================================================
test('spec 15-powersync paso 2 — denormalización establishment_id (tablas hijas) + identidad animal (b1)', async (t) => {
  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoB;

  await t.test('setup: dos campos con miembro real en cada uno', async () => {
    userA = await createTestUser('s15p2_A');
    userB = await createTestUser('s15p2_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} s15p2_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} s15p2_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_s15p2_rA` });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_s15p2_rB` });
  });

  // -- (A) weight_events: el trigger force deriva establishment_id del PERFIL; un payload spoofeado se pisa. --
  await t.test('(A 0077) weight_events: establishment_id se FUERZA desde el perfil (anti-spoof, ignora el payload de estB)', async () => {
    const an = await createAnimal(clientA, {
      idv: `${RUN_TAG}_p2_we`, sex: 'female', birthDate: daysAgo(500),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona',
    });
    assert.equal(an.error, undefined, an.error && an.error.message);

    // El cliente (de estA, autorizado sobre el perfil) intenta INSERTAR un weight_event pasando un
    // establishment_id AJENO (estB) en el payload. El trigger BEFORE INSERT lo IGNORA y fuerza el de estA.
    const { error: insErr } = await clientA.from('weight_events').insert({
      animal_profile_id: an.profile.id,
      weight_kg: 311,
      weight_date: daysAgo(1),
      establishment_id: estB, // <- spoof: campo ajeno; el trigger debe pisarlo
    });
    assert.equal(insErr, null, insErr && `el insert del dueño del perfil no debería fallar: ${insErr.message}`);

    // Verificación (service_role): la columna quedó con el establishment_id del PERFIL (estA), NO el spoofeado.
    const { data: ev, error } = await admin
      .from('weight_events')
      .select('id, establishment_id')
      .eq('animal_profile_id', an.profile.id)
      .eq('weight_kg', 311)
      .single();
    assert.equal(error, null, error && error.message);
    assert.equal(ev.establishment_id, estA, 'establishment_id debe ser el del perfil (estA), no el spoofeado (estB)');
    assert.notEqual(ev.establishment_id, estB, 'el establishment_id spoofeado de estB NO debe quedar persistido');

    // ANTI-SPOOF POR UPDATE (force BEFORE UPDATE, reconciliación al as-built): el dueño del evento intenta
    // pisar establishment_id a estB por un UPDATE directo (PostgREST). El trigger lo re-deriva del perfil (estA).
    const { error: updErr } = await clientA
      .from('weight_events')
      .update({ establishment_id: estB, notes: 'intento de mover de campo' })
      .eq('id', ev.id);
    assert.equal(updErr, null, updErr && `el UPDATE del dueño no debería fallar: ${updErr.message}`);
    const { data: ev2 } = await admin
      .from('weight_events').select('establishment_id').eq('id', ev.id).single();
    assert.equal(ev2.establishment_id, estA, 'tras el UPDATE-spoof el establishment_id sigue siendo el del perfil (estA)');
  });

  // -- (A) reproductive_events: idem (mismo trigger compartido, deriva del perfil). --
  await t.test('(A 0077) reproductive_events: establishment_id forzado desde el perfil', async () => {
    const an = await createAnimal(clientA, {
      idv: `${RUN_TAG}_p2_re`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(an.error, undefined, an.error && an.error.message);

    const { error: insErr } = await clientA.from('reproductive_events').insert({
      animal_profile_id: an.profile.id,
      event_type: 'tacto',
      event_date: daysAgo(2),
      pregnancy_status: 'medium',
      establishment_id: estB, // spoof
    });
    assert.equal(insErr, null, insErr && `insert tacto no debería fallar: ${insErr.message}`);

    const { data: ev } = await admin
      .from('reproductive_events')
      .select('establishment_id')
      .eq('animal_profile_id', an.profile.id)
      .eq('event_type', 'tacto')
      .single();
    assert.equal(ev.establishment_id, estA, 'reproductive_events.establishment_id forzado desde el perfil (estA)');
  });

  // -- (A 0078) birth_calves: cadena parto -> madre. Se puebla server-side vía register_birth; verificamos que
  //    la columna denormalizada quedó con el establishment_id de la madre (estA), no NULL ni ajeno. --
  await t.test('(A 0078) birth_calves: establishment_id derivado del parto -> madre (cadena de 2 saltos)', async () => {
    const madre = await createAnimal(clientA, {
      idv: `${RUN_TAG}_p2_bc`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(madre.error, undefined, madre.error && madre.error.message);

    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: madre.profile.id, p_event_date: daysAgo(1),
      p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }],
    });
    assert.equal(error, null, error && error.message);

    const { data: bc } = await admin
      .from('birth_calves')
      .select('establishment_id')
      .eq('birth_event_id', birthId);
    assert.equal(bc.length, 2, 'el parto creó 2 filas en birth_calves');
    assert.ok(bc.every((r) => r.establishment_id === estA), 'birth_calves.establishment_id = el de la madre (estA)');
  });

  // -- (A 0078) rodeo_data_config: establishment_id derivado del rodeo, forzado en INSERT *y* UPDATE (toggle). --
  await t.test('(A 0078) rodeo_data_config: establishment_id forzado desde el rodeo, también en el UPDATE del toggle', async () => {
    // rodeoA ya tiene filas en rodeo_data_config (pre-pobladas por tg_rodeos_seed_data_config, 0018).
    const { data: rows, error } = await admin
      .from('rodeo_data_config')
      .select('field_definition_id, establishment_id, enabled')
      .eq('rodeo_id', rodeoA.id)
      .limit(1);
    assert.equal(error, null, error && error.message);
    assert.ok(rows.length >= 1, 'rodeoA debería tener al menos una fila de config pre-poblada');
    // (a) INSERT (vía el seed): la columna ya quedó con el establishment_id del rodeo (estA).
    assert.equal(rows[0].establishment_id, estA, 'rodeo_data_config.establishment_id = el del rodeo (estA) tras el seed');

    // (b) UPDATE (toggle del owner) con un establishment_id spoofeado (estB) en el payload → el BEFORE UPDATE
    //     lo re-fuerza al del rodeo (estA). R13.3.
    const fd = rows[0].field_definition_id;
    const { error: updErr } = await clientA
      .from('rodeo_data_config')
      .update({ enabled: !rows[0].enabled, establishment_id: estB }) // spoof en el UPDATE
      .eq('rodeo_id', rodeoA.id)
      .eq('field_definition_id', fd);
    assert.equal(updErr, null, updErr && `el toggle del owner no debería fallar: ${updErr.message}`);

    const { data: after } = await admin
      .from('rodeo_data_config')
      .select('establishment_id')
      .eq('rodeo_id', rodeoA.id)
      .eq('field_definition_id', fd)
      .single();
    assert.equal(after.establishment_id, estA, 'tras el UPDATE el establishment_id sigue siendo el del rodeo (estA), no el spoofeado');
  });

  // -- (b1 0079) identidad del animal denormalizada sobre animal_profiles: force en el INSERT del perfil. --
  await t.test('(b1 0079) animal_profiles: la identidad (tag/sex/birth_date) se FUERZA desde animals en el INSERT del perfil', async () => {
    const tag = `${RUN_TAG}_TAGb1`;
    const an = await createAnimal(clientA, {
      tag, idv: `${RUN_TAG}_p2_b1`, sex: 'male', birthDate: daysAgo(200),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito',
    });
    assert.equal(an.error, undefined, an.error && an.error.message);

    const { data: prof, error } = await admin
      .from('animal_profiles')
      .select('animal_tag_electronic, animal_sex, animal_birth_date')
      .eq('id', an.profile.id)
      .single();
    assert.equal(error, null, error && error.message);
    assert.equal(prof.animal_tag_electronic, tag, 'animal_tag_electronic denormalizado = el del animal');
    assert.equal(prof.animal_sex, 'male', 'animal_sex denormalizado = el del animal');
    assert.equal(prof.animal_birth_date, daysAgo(200), 'animal_birth_date denormalizado = el del animal');

    // ANTI-SPOOF POR UPDATE (force BEFORE UPDATE OF las 3 columnas): el dueño del perfil intenta pisar la
    // identidad denormalizada con un valor falso por UPDATE directo. El trigger la re-deriva desde animals.
    const { error: updErr } = await clientA
      .from('animal_profiles')
      .update({ animal_tag_electronic: 'TAG_FALSO_SPOOF', animal_sex: 'female' })
      .eq('id', an.profile.id);
    assert.equal(updErr, null, updErr && `el UPDATE del dueño no debería fallar: ${updErr.message}`);
    const { data: prof2 } = await admin
      .from('animal_profiles')
      .select('animal_tag_electronic, animal_sex')
      .eq('id', an.profile.id)
      .single();
    assert.equal(prof2.animal_tag_electronic, tag, 'tras el UPDATE-spoof el tag denormalizado sigue siendo el real (de animals)');
    assert.equal(prof2.animal_sex, 'male', 'tras el UPDATE-spoof el sex denormalizado sigue siendo el real (de animals)');
  });

  // -- (b1 0079) propagación: al cambiar la identidad del animal (sex/birth_date), se propaga a sus perfiles. --
  await t.test('(b1 0079) animals → animal_profiles: el UPDATE de identidad del animal se propaga a sus perfiles', async () => {
    const an = await createAnimal(clientA, {
      idv: `${RUN_TAG}_p2_prop`, sex: 'female', birthDate: daysAgo(300),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona',
    });
    assert.equal(an.error, undefined, an.error && an.error.message);

    // Cambiar birth_date del animal (vía service_role: es un cambio de identidad raro/correctivo). El trigger
    // de propagación AFTER UPDATE OF birth_date debe reflejarlo en animal_profiles.animal_birth_date.
    const newBirth = daysAgo(310);
    const { error: updErr } = await admin
      .from('animals')
      .update({ birth_date: newBirth })
      .eq('id', an.animalId);
    assert.equal(updErr, null, updErr && updErr.message);

    const { data: prof } = await admin
      .from('animal_profiles')
      .select('animal_birth_date')
      .eq('id', an.profile.id)
      .single();
    assert.equal(prof.animal_birth_date, newBirth, 'el cambio de birth_date del animal se propagó al perfil');
  });
});

// =====================================================================
// spec 15-powersync — Run T9.8: RPC create_rodeo (alta de rodeo OFFLINE).
// Migración supabase/migrations/0081_create_rodeo_rpc.sql.
// ⚠️ Estos tests REQUIEREN la migración 0081 APLICADA al remoto (la aplica el leader por Management API
// tras gatear el SQL). Hasta entonces FALLAN — es ESPERADO: la función create_rodeo no existe aún, así
// que el call da PGRST202 (function not found). El implementer NO aplica la migración. Mismo patrón que
// la suite spec 15-powersync (delta 0075) y la del paso 2 (0077-0080).
//
// Verifican: (1) owner crea un rodeo vía la RPC con id de cliente → rodeo + plantilla (trigger 0018) +
// toggles aplicados; (2) IDEMPOTENCIA: replay (mismo p_id + p_toggles) = no-op total (1 rodeo, la plantilla
// NO se duplica porque el trigger no re-dispara, los toggles re-aplican el mismo end-state); (3) AUTHZ:
// un usuario SIN rol de owner en el campo → 42501 (espeja rodeos_insert = is_owner_of, 0017).
// =====================================================================
test('spec 15-powersync — create_rodeo RPC (alta de rodeo OFFLINE, Run T9.8)', async (t) => {
  let userA, userB, clientA, clientB, estA, speciesId, systemId, fdPeso;

  await t.test('setup: owner A + un field_operator B en el campo de A', async () => {
    userA = await createTestUser('s15cr_A');
    userB = await createTestUser('s15cr_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} s15cr_estA`);
    // B es field_operator del campo de A (rol activo pero NO owner) → debe poder leer rodeos pero NO crear.
    await assignRoleAsService(userB.id, estA, 'field_operator');
    const ss = await lookupSpeciesSystem(clientA, 'bovino', 'cria');
    speciesId = ss.speciesId;
    systemId = ss.systemId;
    // Un field_definition para diffear un toggle (peso = default ON en cría → lo apagamos en p_toggles).
    const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'peso').single();
    fdPeso = fd.id;
  });

  // -- Caso 1: owner crea el rodeo con id de cliente; trigger seedea la plantilla; toggles aplicados. --
  await t.test('caso 1: owner crea rodeo vía create_rodeo (id de cliente) → rodeo + plantilla + toggle aplicado', async () => {
    const rodeoId = require('node:crypto').randomUUID();
    const { data: ret, error } = await clientA.rpc('create_rodeo', {
      p_id: rodeoId,
      p_establishment_id: estA,
      p_name: `${RUN_TAG}_cr_rodeo`,
      p_species_id: speciesId,
      p_system_id: systemId,
      p_toggles: [{ field_definition_id: fdPeso, enabled: false }], // apagar 'peso' (default ON)
    });
    assert.equal(error, null, error && error.message);
    assert.equal(ret, rodeoId, 'create_rodeo devuelve el id del rodeo (= el id de cliente)');

    // El rodeo existe con el id de CLIENTE.
    const { data: rodeo } = await admin.from('rodeos')
      .select('id, establishment_id, name, species_id, system_id, deleted_at').eq('id', rodeoId).single();
    assert.ok(rodeo, 'el rodeo se creó con el id de cliente');
    assert.equal(rodeo.establishment_id, estA);
    assert.equal(rodeo.deleted_at, null);

    // El trigger 0018 seedeó la plantilla (27 filas en cría). // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    const { data: cfg } = await admin.from('rodeo_data_config')
      .select('field_definition_id, enabled, establishment_id').eq('rodeo_id', rodeoId);
    assert.equal(cfg.length, 27, 'el trigger pre-pobló rodeo_data_config (27 filas en cría)'); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    // El toggle del usuario se aplicó: 'peso' quedó en false (era default ON).
    const peso = cfg.find((c) => c.field_definition_id === fdPeso);
    assert.equal(peso.enabled, false, 'el toggle de peso se aplicó (enabled=false sobre el default ON)');
    // establishment_id denormalizado lo forzó el trigger 0078 desde el rodeo.
    assert.ok(cfg.every((c) => c.establishment_id === estA), 'establishment_id de la plantilla forzado al del rodeo');
  });

  // -- Caso 2: IDEMPOTENCIA — replay (mismo p_id + p_toggles) = no-op TOTAL. --
  await t.test('caso 2: replay (mismo p_id + p_toggles) → no-op total (1 rodeo, plantilla no duplicada, toggles iguales)', async () => {
    const rodeoId = require('node:crypto').randomUUID();
    const args = {
      p_id: rodeoId,
      p_establishment_id: estA,
      p_name: `${RUN_TAG}_cr_idemp`,
      p_species_id: speciesId,
      p_system_id: systemId,
      p_toggles: [{ field_definition_id: fdPeso, enabled: false }],
    };
    // 1er call: crea el rodeo + plantilla.
    const r1 = await clientA.rpc('create_rodeo', args);
    assert.equal(r1.error, null, r1.error && r1.error.message);

    const cfgBefore = await admin.from('rodeo_data_config')
      .select('field_definition_id', { count: 'exact', head: true }).eq('rodeo_id', rodeoId);
    const rodeoCountBefore = await admin.from('rodeos')
      .select('id', { count: 'exact', head: true }).eq('establishment_id', estA);

    // 2do call: MISMO p_id + p_toggles (simula el reintento at-least-once tras perder el ACK).
    const r2 = await clientA.rpc('create_rodeo', args);
    assert.equal(r2.error, null, r2.error && r2.error.message);
    assert.equal(r2.data, rodeoId, 'el replay devuelve el MISMO id (no-op idempotente)');

    // Estado real: exactamente UN rodeo (no 2) y la plantilla NO se duplicó (el trigger no re-disparó: el
    // INSERT del rodeo fue ON CONFLICT DO NOTHING → no hubo INSERT efectivo → no AFTER INSERT trigger).
    const rodeoCountAfter = await admin.from('rodeos')
      .select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
    assert.equal(rodeoCountAfter.count, rodeoCountBefore.count, 'el replay NO creó un 2do rodeo');
    const cfgAfter = await admin.from('rodeo_data_config')
      .select('field_definition_id', { count: 'exact', head: true }).eq('rodeo_id', rodeoId);
    assert.equal(cfgAfter.count, cfgBefore.count, 'el replay NO duplicó la plantilla (trigger no re-dispara)');
    assert.equal(cfgAfter.count, 27, 'la plantilla sigue siendo 27 filas (no 54)'); // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099); el guard de duplicado pasa de 52 a 54
    // El toggle sigue en el mismo end-state (UPSERT idempotente).
    const { data: peso } = await admin.from('rodeo_data_config')
      .select('enabled').eq('rodeo_id', rodeoId).eq('field_definition_id', fdPeso).single();
    assert.equal(peso.enabled, false, 'el toggle re-aplicado deja el mismo end-state');
  });

  // -- Caso 3: AUTHZ — un NO-owner (field_operator del campo) NO puede crear un rodeo → 42501. --
  await t.test('caso 3: field_operator (no-owner) llamando create_rodeo → 42501, nada creado', async () => {
    const rodeoId = require('node:crypto').randomUUID();
    const { error } = await clientB.rpc('create_rodeo', {
      p_id: rodeoId,
      p_establishment_id: estA,
      p_name: `${RUN_TAG}_cr_denied`,
      p_species_id: speciesId,
      p_system_id: systemId,
      p_toggles: [],
    });
    assert.notEqual(error, null, 'un no-owner NO debe poder crear un rodeo (owner-only, espeja rodeos_insert)');
    assert.match(String(error.message + ' ' + (error.code || '')), /42501|not authorized|denied/i);
    // NO se creó el rodeo.
    const { data: rows } = await admin.from('rodeos').select('id').eq('id', rodeoId);
    assert.deepEqual(rows, [], 'el rodeo NO se creó (authz rechazó antes de cualquier escritura)');
  });

  // -- Caso 4 (anti-IDOR): owner de OTRO campo colisiona p_id con un rodeo AJENO → NO toca su plantilla. --
  await t.test('caso 4: p_id que colisiona con un rodeo AJENO → 42501; la plantilla del rodeo ajeno intacta', async () => {
    // userC = owner de SU propio campo estC; intenta crear un rodeo con el p_id de un rodeo de estA (ajeno).
    const userC = await createTestUser('s15cr_C');
    const clientC = await getUserClient(userC.email);
    const estC = await createEstablishmentAs(clientC, `${RUN_TAG} s15cr_estC`);
    // Un rodeo REAL de A (víctima), con su plantilla seedeada.
    const victimRodeoId = require('node:crypto').randomUUID();
    {
      const { error } = await clientA.rpc('create_rodeo', {
        p_id: victimRodeoId, p_establishment_id: estA, p_name: `${RUN_TAG}_cr_victim`,
        p_species_id: speciesId, p_system_id: systemId, p_toggles: [],
      });
      assert.equal(error, null, error && error.message);
    }
    // Snapshot de la plantilla de la víctima ANTES del ataque (el toggle de 'peso' = default ON).
    const { data: pesoBefore } = await admin.from('rodeo_data_config')
      .select('enabled').eq('rodeo_id', victimRodeoId).eq('field_definition_id', fdPeso).single();
    assert.equal(pesoBefore.enabled, true, 'precondición: peso ON en la plantilla de la víctima');

    // ATAQUE: userC (owner de estC) llama create_rodeo con el p_id del rodeo de A + SU propio establishment.
    // is_owner_of(estC) pasa, pero el rodeo p_id es de estA → el guard anti-IDOR debe rechazar (42501) y
    // NUNCA tocar el rodeo_data_config ajeno (un UPSERT bypassaría RLS por ser SECURITY DEFINER).
    const { error: atkErr } = await clientC.rpc('create_rodeo', {
      p_id: victimRodeoId,            // <- p_id de un rodeo AJENO (de estA)
      p_establishment_id: estC,       // <- el campo PROPIO del atacante (is_owner_of pasa)
      p_name: `${RUN_TAG}_cr_attack`,
      p_species_id: speciesId, p_system_id: systemId,
      p_toggles: [{ field_definition_id: fdPeso, enabled: false }], // intento de apagar peso en la víctima
    });
    assert.notEqual(atkErr, null, 'colisión de p_id con un rodeo ajeno → debe rechazar (anti-IDOR)');
    assert.match(String(atkErr.message + ' ' + (atkErr.code || '')), /42501|not.*belong|denied|not authorized/i);

    // INVARIANTE: la plantilla de la víctima quedó INTACTA (peso sigue ON; el atacante NO la modificó).
    const { data: pesoAfter } = await admin.from('rodeo_data_config')
      .select('enabled, establishment_id').eq('rodeo_id', victimRodeoId).eq('field_definition_id', fdPeso).single();
    assert.equal(pesoAfter.enabled, true, 'la plantilla de la víctima NO fue modificada por el atacante');
    assert.equal(pesoAfter.establishment_id, estA, 'el rodeo_data_config ajeno sigue siendo de estA');
    // El rodeo de la víctima sigue siendo de estA (el INSERT ON CONFLICT no lo re-apropió).
    const { data: vr } = await admin.from('rodeos').select('establishment_id').eq('id', victimRodeoId).single();
    assert.equal(vr.establishment_id, estA, 'el rodeo de la víctima sigue perteneciendo a estA');
  });
});

test('spec 15-powersync — set_rodeo_config RPC (editar plantilla OFFLINE, Run T9.9)', async (t) => {
  let userA, userB, clientA, clientB, estA, speciesId, systemId, fdUpdate, fdInsert, rodeoA;

  await t.test('setup: owner A + field_operator B en el campo de A + un rodeo de A con su plantilla seedeada', async () => {
    userA = await createTestUser('s15sc_A');
    userB = await createTestUser('s15sc_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} s15sc_estA`);
    // B es field_operator del campo de A (rol activo pero NO owner) → debe poder LEER la plantilla pero NO editarla.
    await assignRoleAsService(userB.id, estA, 'field_operator');
    const ss = await lookupSpeciesSystem(clientA, 'bovino', 'cria');
    speciesId = ss.speciesId;
    systemId = ss.systemId;
    // En cría TODOS los field_definitions activos son defaults del sistema → no existe ningún field activo
    // no-default. Por eso ambas ramas del UPSERT (update + insert) se ejercitan sobre fields DEFAULT reales:
    //   - fdUpdate = 'peso' (default ON) → destildar = rama UPDATE sobre una fila ya seedeada.
    //   - fdInsert = otro default cualquiera → para ejercitar la rama INSERT, en el setup BORRAMOS (vía service
    //     role) su fila seedeada en rodeo_data_config de rodeoA, así no tiene fila pre-poblada y el set_rodeo_config
    //     la crea por la rama INSERT del ON CONFLICT (+ el trigger 0078 fuerza establishment_id en ese INSERT).
    // Esto NO toca el catálogo global field_definitions (no creamos fields sintéticos): solo la config de ESTE
    // rodeo de test, que se limpia al borrar el rodeo/est en el cleanup.
    const { data: fdP } = await clientA.from('field_definitions').select('id').eq('data_key', 'peso').single();
    fdUpdate = fdP.id;
    // Elegimos fdInsert como cualquier default del sistema cría que NO sea 'peso' (sin hardcodear ids: lo leemos
    // de system_default_fields del sistema cría).
    const { data: defs } = await clientA.from('system_default_fields').select('field_definition_id').eq('system_id', systemId);
    const other = defs.map((d) => d.field_definition_id).find((id) => id !== fdUpdate);
    assert.ok(other, 'el sistema cría debe tener ≥2 defaults para elegir fdUpdate ≠ fdInsert');
    fdInsert = other;

    // Creamos el rodeo de A vía create_rodeo (0081) — su trigger 0018 seedea la plantilla (las 27 filas). // +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)
    rodeoA = require('node:crypto').randomUUID();
    const { error } = await clientA.rpc('create_rodeo', {
      p_id: rodeoA, p_establishment_id: estA, p_name: `${RUN_TAG}_sc_rodeo`,
      p_species_id: speciesId, p_system_id: systemId, p_toggles: [],
    });
    assert.equal(error, null, error && error.message);

    // Borramos (vía service role) la fila seedeada de fdInsert en la config de rodeoA → queda sin fila
    // pre-poblada para que set_rodeo_config la cree por la rama INSERT del UPSERT (caso 1).
    const { error: delErr } = await admin.from('rodeo_data_config')
      .delete().eq('rodeo_id', rodeoA).eq('field_definition_id', fdInsert);
    assert.equal(delErr, null, delErr && delErr.message);
    const { count: insRows } = await admin.from('rodeo_data_config')
      .select('field_definition_id', { count: 'exact', head: true }).eq('rodeo_id', rodeoA).eq('field_definition_id', fdInsert);
    assert.equal(insRows, 0, 'fdInsert quedó sin fila pre-poblada (rama INSERT lista)');
  });

  // -- Caso 1: owner edita la plantilla ejercitando AMBAS ramas del UPSERT (update + insert) vía set_rodeo_config. --
  await t.test('caso 1: owner edita vía set_rodeo_config (rama UPDATE destildando un default + rama INSERT de un default sin fila) → filas reflejan el nuevo enabled', async () => {
    const { data: ret, error } = await clientA.rpc('set_rodeo_config', {
      p_rodeo_id: rodeoA,
      p_toggles: [
        { field_definition_id: fdInsert, enabled: true },  // rama INSERT: su fila seedeada se borró en el setup
        { field_definition_id: fdUpdate, enabled: false },  // rama UPDATE: apagar 'peso' (default ON, fila ya seedeada)
      ],
    });
    assert.equal(error, null, error && error.message);
    assert.equal(ret, rodeoA, 'set_rodeo_config devuelve el id del rodeo');

    // 'peso' quedó en false (rama UPDATE sobre el default ON ya seedeado).
    const { data: peso } = await admin.from('rodeo_data_config')
      .select('enabled, establishment_id').eq('rodeo_id', rodeoA).eq('field_definition_id', fdUpdate).single();
    assert.equal(peso.enabled, false, 'el toggle de peso se aplicó (enabled=false sobre el default ON) — rama UPDATE');
    // fdInsert se creó por la rama INSERT (su fila no existía) con enabled=true.
    const { data: inserted } = await admin.from('rodeo_data_config')
      .select('enabled, establishment_id').eq('rodeo_id', rodeoA).eq('field_definition_id', fdInsert).single();
    assert.ok(inserted, 'fdInsert se insertó (fila nueva creada por la rama INSERT del UPSERT)');
    assert.equal(inserted.enabled, true, 'fdInsert quedó habilitado (enabled=true) — rama INSERT');
    // establishment_id forzado por el trigger 0078 desde el rodeo (anti-spoof) en INSERT y UPDATE.
    assert.equal(peso.establishment_id, estA, 'establishment_id forzado al del rodeo (rama UPDATE)');
    assert.equal(inserted.establishment_id, estA, 'establishment_id forzado al del rodeo (rama INSERT, trigger 0078-on-INSERT)');
  });

  // -- Caso 2: IDEMPOTENCIA — replay con los mismos toggles = no-op total. --
  await t.test('caso 2: replay (mismos toggles) → no-op total (mismos valores, sin duplicar filas)', async () => {
    const cfgBefore = await admin.from('rodeo_data_config')
      .select('field_definition_id', { count: 'exact', head: true }).eq('rodeo_id', rodeoA);

    const { error } = await clientA.rpc('set_rodeo_config', {
      p_rodeo_id: rodeoA,
      p_toggles: [
        { field_definition_id: fdInsert, enabled: true },
        { field_definition_id: fdUpdate, enabled: false },
      ],
    });
    assert.equal(error, null, error && error.message);

    // El conteo de filas no cambió (PK compuesta → el UPSERT no duplica; fdInsert ya tiene fila tras caso 1).
    const cfgAfter = await admin.from('rodeo_data_config')
      .select('field_definition_id', { count: 'exact', head: true }).eq('rodeo_id', rodeoA);
    assert.equal(cfgAfter.count, cfgBefore.count, 'el replay NO duplicó filas (UPSERT por PK compuesta)');
    // Los valores siguen iguales (mismo end-state).
    const { data: peso } = await admin.from('rodeo_data_config')
      .select('enabled').eq('rodeo_id', rodeoA).eq('field_definition_id', fdUpdate).single();
    assert.equal(peso.enabled, false, 'peso sigue en false tras el replay');
    const { data: inserted } = await admin.from('rodeo_data_config')
      .select('enabled').eq('rodeo_id', rodeoA).eq('field_definition_id', fdInsert).single();
    assert.equal(inserted.enabled, true, 'fdInsert sigue en true tras el replay');
  });

  // -- Caso 3: AUTHZ — un NO-owner (field_operator del campo) NO puede editar la plantilla → 42501. --
  await t.test('caso 3: field_operator (no-owner) llamando set_rodeo_config → 42501, plantilla sin cambios', async () => {
    const { data: pesoBefore } = await admin.from('rodeo_data_config')
      .select('enabled').eq('rodeo_id', rodeoA).eq('field_definition_id', fdUpdate).single();

    const { error } = await clientB.rpc('set_rodeo_config', {
      p_rodeo_id: rodeoA,
      p_toggles: [{ field_definition_id: fdUpdate, enabled: true }], // intento de re-prender 'peso'
    });
    assert.notEqual(error, null, 'un no-owner NO debe poder editar la plantilla (owner-only, espeja rodeo_data_config_update)');
    assert.match(String(error.message + ' ' + (error.code || '')), /42501|not authorized|denied/i);

    // La plantilla NO cambió.
    const { data: pesoAfter } = await admin.from('rodeo_data_config')
      .select('enabled').eq('rodeo_id', rodeoA).eq('field_definition_id', fdUpdate).single();
    assert.equal(pesoAfter.enabled, pesoBefore.enabled, 'la plantilla quedó intacta (authz rechazó antes de escribir)');
  });

  // -- Caso 4 (anti-IDOR por derivación): un owner de OTRO campo edita un rodeo AJENO → 42501. --
  await t.test('caso 4: p_rodeo_id de un rodeo AJENO (otro tenant) → 42501; la plantilla del rodeo ajeno intacta', async () => {
    // userC = owner de SU propio campo estC; intenta editar la plantilla del rodeo de A (ajeno).
    const userC = await createTestUser('s15sc_C');
    const clientC = await getUserClient(userC.email);
    await createEstablishmentAs(clientC, `${RUN_TAG} s15sc_estC`);

    // Snapshot de la plantilla de la víctima ANTES del ataque.
    const { data: pesoBefore } = await admin.from('rodeo_data_config')
      .select('enabled').eq('rodeo_id', rodeoA).eq('field_definition_id', fdUpdate).single();

    // ATAQUE: userC (owner de estC) llama set_rodeo_config con el p_rodeo_id del rodeo de A. La RPC DERIVA el
    // establishment del rodeo (= estA), is_owner_of(estA) para userC = false → 42501. Sin tocar la plantilla
    // ajena (es hermético por construcción: el est NO es parámetro, se deriva del rodeo).
    const { error: atkErr } = await clientC.rpc('set_rodeo_config', {
      p_rodeo_id: rodeoA, // <- rodeo AJENO (de estA)
      p_toggles: [{ field_definition_id: fdUpdate, enabled: true }],
    });
    assert.notEqual(atkErr, null, 'editar un rodeo ajeno → debe rechazar (anti-IDOR por derivación del est)');
    assert.match(String(atkErr.message + ' ' + (atkErr.code || '')), /42501|not authorized|denied/i);

    // INVARIANTE: la plantilla de la víctima quedó INTACTA.
    const { data: pesoAfter } = await admin.from('rodeo_data_config')
      .select('enabled, establishment_id').eq('rodeo_id', rodeoA).eq('field_definition_id', fdUpdate).single();
    assert.equal(pesoAfter.enabled, pesoBefore.enabled, 'la plantilla de la víctima NO fue modificada por el atacante');
    assert.equal(pesoAfter.establishment_id, estA, 'el rodeo_data_config ajeno sigue siendo de estA');
  });

  // -- Caso 5: rodeo soft-deleteado → P0002 'rodeo not found', nada cambia. --
  await t.test('caso 5: rodeo soft-deleteado → P0002 (rodeo not found), nada cambia', async () => {
    // Creamos un rodeo de A y lo soft-deleteamos vía el RPC soft_delete_rodeo (camino real de baja).
    const goneRodeo = require('node:crypto').randomUUID();
    {
      const { error } = await clientA.rpc('create_rodeo', {
        p_id: goneRodeo, p_establishment_id: estA, p_name: `${RUN_TAG}_sc_gone`,
        p_species_id: speciesId, p_system_id: systemId, p_toggles: [],
      });
      assert.equal(error, null, error && error.message);
    }
    const { error: delErr } = await clientA.rpc('soft_delete_rodeo', { p_rodeo_id: goneRodeo });
    assert.equal(delErr, null, delErr && delErr.message);

    // Editar la plantilla de un rodeo soft-deleteado → P0002 (la edición es moot).
    const { error } = await clientA.rpc('set_rodeo_config', {
      p_rodeo_id: goneRodeo,
      p_toggles: [{ field_definition_id: fdUpdate, enabled: false }],
    });
    assert.notEqual(error, null, 'editar un rodeo soft-deleteado debe fallar (P0002)');
    assert.match(String(error.message + ' ' + (error.code || '')), /P0002|not found/i);
  });
});

// =====================================================================
// spec 15-powersync — Run create-animal-rpc: RPC create_animal (alta ATÓMICA).
// Migración supabase/migrations/0083_create_animal_rpc.sql.
// ⚠️ Estos tests REQUIEREN la migración 0083 APLICADA al remoto (la aplica el leader por Management API
// tras gatear el SQL). Hasta entonces FALLAN — es ESPERADO: la función create_animal no existe aún →
// PGRST202 (function not found). El implementer NO aplica la migración. Mismo patrón que 0075-0082.
//
// Contexto (bug de PÉRDIDA REAL de datos, backlog 2026-06-10 REABIERTO): el alta se subía como 2 upserts
// HTTP no atómicos; un drenado interrumpido entre ambos dejaba `animals` huérfano y el reintento moría
// 42501 (la policy UPDATE de animals exige un perfil visible) → rollback del overlay → alta perdida.
// La RPC es UNA transacción + idempotente por ids de cliente + SANA el half-state (caso 3 = el bug).
// =====================================================================
test('spec 15-powersync — create_animal RPC (alta atómica, Run create-animal-rpc)', async (t) => {
  let userA, userB, clientA, clientB, estA, estB, rodeoA, speciesId, catVaq;
  const uuid = () => require('node:crypto').randomUUID();

  // args completos para un alta hembra/vaquillona en estA/rodeoA (cada caso pisa lo que necesita).
  function buildArgs(overrides = {}) {
    return {
      p_animal_id: uuid(),
      p_profile_id: uuid(),
      p_establishment_id: estA,
      p_rodeo_id: rodeoA.id,
      p_category_id: catVaq,
      p_sex: 'female',
      p_species_id: speciesId,
      ...overrides,
    };
  }

  await t.test('setup: owner A (estA + rodeo), owner B (estB, sin rol en estA)', async () => {
    userA = await createTestUser('s15ca_A');
    userB = await createTestUser('s15ca_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} s15ca_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} s15ca_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_ca_rodeoA` });
    const ss = await lookupSpeciesSystem(clientA, 'bovino', 'cria');
    speciesId = ss.speciesId;
    catVaq = await categoryId(clientA, rodeoA.systemId, 'vaquillona');
  });

  // -- Caso 1: happy path — UNA RPC crea animals + perfil; triggers fuerzan created_by + identidad. --
  await t.test('caso 1: alta completa vía create_animal → animals + perfil; created_by e identidad FORZADOS por triggers', async () => {
    const tag = `${RUN_TAG}_ca_tag1`;
    const args = buildArgs({
      p_tag_electronic: tag,
      p_birth_date: '2024-07-01',
      p_idv: `${RUN_TAG}_idv1`,
      p_breed: 'Angus',
      p_entry_weight: 180.5,
    });
    const { data: ret, error } = await clientA.rpc('create_animal', args);
    assert.equal(error, null, error && error.message);
    assert.equal(ret, args.p_profile_id, 'create_animal devuelve el id del perfil (= id de cliente)');

    const { data: an } = await admin.from('animals')
      .select('id, sex, species_id, tag_electronic, birth_date, deleted_at').eq('id', args.p_animal_id).single();
    assert.ok(an, 'animals se creó con el id de cliente');
    assert.equal(an.sex, 'female');
    assert.equal(an.species_id, speciesId);
    assert.equal(an.tag_electronic, tag);
    assert.equal(an.birth_date, '2024-07-01');

    const { data: prof } = await admin.from('animal_profiles')
      .select('id, animal_id, establishment_id, rodeo_id, category_id, status, idv, breed, entry_weight, created_by, animal_tag_electronic, animal_sex, animal_birth_date')
      .eq('id', args.p_profile_id).single();
    assert.ok(prof, 'animal_profiles se creó con el id de cliente');
    assert.equal(prof.animal_id, args.p_animal_id);
    assert.equal(prof.establishment_id, estA);
    assert.equal(prof.rodeo_id, rodeoA.id);
    assert.equal(prof.category_id, catVaq);
    assert.equal(prof.status, 'active');
    assert.equal(prof.idv, `${RUN_TAG}_idv1`);
    assert.equal(prof.breed, 'Angus');
    assert.equal(Number(prof.entry_weight), 180.5);
    // created_by lo FUERZA el trigger 0043 desde auth.uid() (la RPC no lo setea) — y bajo SECURITY
    // DEFINER auth.uid() sigue siendo el CALLER (patrón validado 0075/0081).
    assert.equal(prof.created_by, userA.id, 'created_by forzado al caller (trigger 0043 dentro de la RPC)');
    // Identidad denormalizada b1: la FUERZA el trigger 0079 desde animals (la RPC no la setea).
    assert.equal(prof.animal_tag_electronic, tag, 'identidad denormalizada forzada (0079)');
    assert.equal(prof.animal_sex, 'female');
    assert.equal(prof.animal_birth_date, '2024-07-01');
  });

  // -- Caso 2: IDEMPOTENCIA — replay idéntico (mismos ids de cliente) = no-op TOTAL, no error. --
  await t.test('caso 2: replay idéntico (mismos ids de cliente) → 2xx no-op (ni duplica ni error)', async () => {
    const args = buildArgs({ p_idv: `${RUN_TAG}_idv2` });
    const r1 = await clientA.rpc('create_animal', args);
    assert.equal(r1.error, null, r1.error && r1.error.message);

    // Replay (reintento at-least-once tras perder el ACK): MISMOS args.
    const r2 = await clientA.rpc('create_animal', args);
    assert.equal(r2.error, null, `el replay NO debe dar error (ON CONFLICT DO NOTHING): ${r2.error && r2.error.message}`);
    assert.equal(r2.data, args.p_profile_id, 'el replay devuelve el MISMO id de perfil');

    // Estado real: UNA fila de animals, UN perfil (ni 2 animales ni 2 perfiles).
    const { count: nAnimals } = await admin.from('animals')
      .select('id', { count: 'exact', head: true }).eq('id', args.p_animal_id);
    assert.equal(nAnimals, 1);
    const { count: nProfiles } = await admin.from('animal_profiles')
      .select('id', { count: 'exact', head: true }).eq('animal_id', args.p_animal_id);
    assert.equal(nProfiles, 1, 'el replay NO creó un 2do perfil');
  });

  // -- Caso 3 (EL TEST DEL BUG): half-state healing — animals huérfano del camino viejo → la RPC lo SANA. --
  await t.test('caso 3: half-state healing — animals huérfano preexistente → la RPC crea el perfil (NO 403/42501)', async () => {
    // Simula el half-state EXACTO del bug (backlog 2026-06-10): el camino viejo de 2 upserts insertó
    // `animals` y se interrumpió ANTES del perfil → huérfano invisible por RLS. Con el camino viejo, el
    // reintento moría 42501 (ON CONFLICT DO UPDATE vs la policy UPDATE de animals que exige un perfil
    // visible) y el alta se PERDÍA. La RPC debe sanarlo: DO NOTHING en animals → sigue → crea el perfil.
    const orphanId = uuid();
    const { error: seedErr } = await admin.from('animals')
      .insert({ id: orphanId, sex: 'female', species_id: speciesId });
    assert.equal(seedErr, null, seedErr && seedErr.message);

    // El MISMO intent re-drenado (mismos valores que produjeron el huérfano: sin tag, sin birth_date).
    const args = buildArgs({ p_animal_id: orphanId, p_idv: `${RUN_TAG}_idv3` });
    const { data: ret, error } = await clientA.rpc('create_animal', args);
    assert.equal(error, null, `el reintento sobre el huérfano NO debe morir 42501/403 (el bug): ${error && error.message}`);
    assert.equal(ret, args.p_profile_id);

    // El huérfano quedó SANADO: ahora tiene su perfil (el alta aterrizó completa).
    const { data: prof } = await admin.from('animal_profiles')
      .select('id, animal_id, establishment_id, idv, created_by').eq('id', args.p_profile_id).single();
    assert.ok(prof, 'el perfil del huérfano se creó');
    assert.equal(prof.animal_id, orphanId);
    assert.equal(prof.establishment_id, estA);
    assert.equal(prof.idv, `${RUN_TAG}_idv3`);
    assert.equal(prof.created_by, userA.id);
    // Y sigue habiendo UNA sola fila de animals (no se duplicó el huérfano).
    const { count: nAnimals } = await admin.from('animals')
      .select('id', { count: 'exact', head: true }).eq('id', orphanId);
    assert.equal(nAnimals, 1);
  });

  // -- Caso 4: AUTHZ — caller sin rol en p_establishment_id → 42501, nada creado. --
  await t.test('caso 4: cross-tenant (userB sin rol en estA) → 42501, nada creado', async () => {
    const args = buildArgs({ p_idv: `${RUN_TAG}_idv4` }); // p_establishment_id = estA (ajeno para B)
    const { error } = await clientB.rpc('create_animal', args);
    assert.notEqual(error, null, 'un caller sin rol en el establishment NO debe poder crear (has_role_in)');
    assert.match(String(error.message + ' ' + (error.code || '')), /42501|not authorized|denied/i);
    // NADA se escribió (el guard corre ANTES de cualquier INSERT).
    const { data: an } = await admin.from('animals').select('id').eq('id', args.p_animal_id);
    assert.deepEqual(an, [], 'animals NO se creó');
    const { data: prof } = await admin.from('animal_profiles').select('id').eq('id', args.p_profile_id);
    assert.deepEqual(prof, [], 'el perfil NO se creó');
  });

  // -- Caso 5: idv duplicado → 23505 SALE (rechazo de dominio) y la RPC aborta ATÓMICA (sin huérfano). --
  await t.test('caso 5: idv duplicado en el establishment → 23505; ATÓMICO: tampoco queda el animals (sin huérfano nuevo)', async () => {
    const dupIdv = `${RUN_TAG}_idv_dup`;
    const first = buildArgs({ p_idv: dupIdv });
    const r1 = await clientA.rpc('create_animal', first);
    assert.equal(r1.error, null, r1.error && r1.error.message);

    // OTRO animal (ids nuevos) con el MISMO idv → el UNIQUE parcial (establishment_id, idv) revienta.
    const second = buildArgs({ p_idv: dupIdv });
    const { error } = await clientA.rpc('create_animal', second);
    assert.notEqual(error, null, 'idv duplicado debe rechazarse (23505 de dominio, NO se traga)');
    assert.match(String(error.message + ' ' + (error.code || '')), /23505|duplicate|idv/i);

    // MEJORA CLAVE vs el camino viejo: la RPC aborta ENTERA → NO queda un animals huérfano del 2do alta.
    const { data: an } = await admin.from('animals').select('id').eq('id', second.p_animal_id);
    assert.deepEqual(an, [], 'el 23505 del perfil abortó TODA la RPC: animals NO quedó huérfano');
    const { data: prof } = await admin.from('animal_profiles').select('id').eq('id', second.p_profile_id);
    assert.deepEqual(prof, [], 'el perfil duplicado NO se creó');
  });

  // -- Caso 6: tag duplicado de OTRO animal → 23505 SALE (el ON CONFLICT targetea SOLO la PK). --
  await t.test('caso 6: tag_electronic tomado por OTRO animal → 23505, nada creado', async () => {
    const dupTag = `${RUN_TAG}_ca_tagdup`;
    const first = buildArgs({ p_tag_electronic: dupTag, p_idv: `${RUN_TAG}_idv6a` });
    const r1 = await clientA.rpc('create_animal', first);
    assert.equal(r1.error, null, r1.error && r1.error.message);

    // OTRO animal (id nuevo) con el MISMO tag → animals_tag_unique revienta (NO lo absorbe el ON
    // CONFLICT (id): el target es SOLO la PK — un duplicado real NUNCA se traga como replay).
    const second = buildArgs({ p_tag_electronic: dupTag, p_idv: `${RUN_TAG}_idv6b` });
    const { error } = await clientA.rpc('create_animal', second);
    assert.notEqual(error, null, 'tag duplicado de OTRO animal debe rechazarse (23505)');
    assert.match(String(error.message + ' ' + (error.code || '')), /23505|duplicate|tag/i);
    const { data: an } = await admin.from('animals').select('id').eq('id', second.p_animal_id);
    assert.deepEqual(an, [], 'animals NO se creó (la RPC abortó atómica)');
  });

  // -- Caso 7 (anti-IDOR, espeja el c-bis de 0081): p_animal_id que colisiona con un animal AJENO. --
  await t.test('caso 7: p_animal_id de un animal AJENO (identidad distinta) → 42501; sin perfil colgado al animal ajeno', async () => {
    // Animal REAL de A (víctima), con tag — creado en el caso 1/6; usamos uno nuevo para aislar.
    const victim = buildArgs({ p_tag_electronic: `${RUN_TAG}_ca_victim`, p_idv: `${RUN_TAG}_idv7` });
    const rv = await clientA.rpc('create_animal', victim);
    assert.equal(rv.error, null, rv.error && rv.error.message);

    // ATAQUE: userB (rol en estB → has_role_in(estB) PASA) reusa el p_animal_id de la víctima con SU
    // establishment y SU payload (identidad distinta: sin tag). El INSERT de animals es DO NOTHING
    // (la PK existe) → el guard de matcheo debe rechazar 42501 ANTES de colgarle un perfil de estB
    // al animal de A (la RPC es SECURITY DEFINER → sin el guard, bypassaría la RLS).
    const catB = catVaq; // catálogo global; el rodeo es lo tenant-scoped
    const rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_ca_rodeoB` });
    const atk = {
      p_animal_id: victim.p_animal_id,          // ← id del animal AJENO
      p_profile_id: uuid(),
      p_establishment_id: estB,                  // ← campo PROPIO del atacante (authz pasa)
      p_rodeo_id: rodeoB.id,
      p_category_id: catB,
      p_sex: 'female',
      p_species_id: speciesId,
      p_idv: `${RUN_TAG}_idv7atk`,
      // sin p_tag_electronic → identidad NO matchea la del animal de A (que tiene tag)
    };
    const { error: atkErr } = await clientB.rpc('create_animal', atk);
    assert.notEqual(atkErr, null, 'colisión de p_animal_id con un animal ajeno → debe rechazar (anti-IDOR)');
    assert.match(String(atkErr.message + ' ' + (atkErr.code || '')), /42501|not.*match|denied|not authorized/i);

    // INVARIANTE: el animal de la víctima NO tiene ningún perfil en estB; su perfil de estA intacto.
    const { data: profs } = await admin.from('animal_profiles')
      .select('id, establishment_id').eq('animal_id', victim.p_animal_id);
    assert.equal(profs.length, 1, 'el animal ajeno sigue con UN solo perfil');
    assert.equal(profs[0].establishment_id, estA, 'el perfil sigue siendo de estA (el atacante no colgó nada)');
    const { data: atkProf } = await admin.from('animal_profiles').select('id').eq('id', atk.p_profile_id);
    assert.deepEqual(atkProf, [], 'el perfil del atacante NO se creó');
  });

  // -- Caso 8 (IDU.1.4/2.5): alta SIN identificadores (p_idv NULL + p_tag_electronic NULL) → PERSISTE con
  //    idv/tag ambos NULL (firma de 19 params, sin p_visual_id_alt; el trigger de completitud se eliminó, 0122). --
  await t.test('caso 8 (IDU.1.4): create_animal sin idv ni tag → persiste con idv/tag NULL (0 identificadores)', async () => {
    const args = buildArgs({}); // sin p_tag_electronic, sin p_idv → 0 identificadores de usuario
    const { data: ret, error } = await clientA.rpc('create_animal', args);
    assert.equal(error, null, `un alta sin identificadores debe persistir (IDU.1.4): ${error && error.message}`);
    assert.equal(ret, args.p_profile_id, 'devuelve el id del perfil');
    const { data: prof } = await admin.from('animal_profiles')
      .select('id, idv, animal_tag_electronic').eq('id', args.p_profile_id).single();
    assert.ok(prof, 'el perfil sin identificadores se creó');
    assert.equal(prof.idv, null, 'idv NULL (IDU.1.4)');
    const { data: an } = await admin.from('animals').select('tag_electronic').eq('id', args.p_animal_id).single();
    assert.equal(an.tag_electronic, null, 'tag_electronic NULL (IDU.1.4)');
  });
});

// =====================================================================
// spec 11 — transferencia-animal: RPC transfer_animal (re-parenting de historia).
// Migraciones supabase/migrations/0087_transfer_animal_rpc.sql + 0088_animal_events_transfer_guc.sql.
// ⚠️ Estos tests REQUIEREN 0087 + 0088 APLICADAS al remoto (las aplica el leader/implementer por
// Management API tras gatear el SQL). Hasta entonces FALLAN — ESPERADO: la función transfer_animal no
// existe (PGRST202) o el re-apuntado de animal_events revienta por inmutabilidad. Patrón 0075-0086.
//
// El RPC crea un perfil nuevo en Y reusando el animal_id global + re-apunta TODA la historia del perfil
// viejo (X) al nuevo con establishment_id→Y (aislamiento del wire de sync) + session_id→NULL en las
// tipadas + archiva el viejo (status='transferred'), ATÓMICAMENTE. Authz asimétrica: destino Y = rol
// activo (CREATE); origen X = baja a paridad EXACTA con exit_animal_profile (0044).
// =====================================================================
test('spec 11 — transfer_animal RPC (re-parenting de historia)', async (t) => {
  const uuid = () => require('node:crypto').randomUUID();
  // Guard: distingue un error de DOMINIO (lo que el test quiere) de PGRST202 (la función no existe porque
  // la migración 0087 no está aplicada). Sin esto, un mensaje de PGRST202 que casualmente contiene
  // 'p_target_*' haría pasar las aserciones de error por la razón EQUIVOCADA (autorrevisión T5.3).
  function assertRpcExists(error) {
    if (error && error.code === 'PGRST202') {
      assert.fail('transfer_animal no existe en el remoto (migración 0087 no aplicada) — este test no puede validar el comportamiento real.');
    }
  }
  // userA: dueño de estX (origen) Y con rol activo en estY (destino) → puede transferir.
  // userB: dueño de estY pero SIN rol en estX. userC: rol SOLO en estX. userD: tercero sin roles.
  let userA, userB, clientA, clientB, estX, estY;
  let rodeoX, rodeoY; // {id, systemId} en cria
  let speciesId, sessionId;

  // Helper: arma un animal en estX/rodeoX con historia rica y devuelve sus ids.
  async function seedAnimalWithHistory(opts = {}) {
    const idv = opts.idv === undefined ? `${RUN_TAG}_tr_${Math.random().toString(36).slice(2, 7)}` : opts.idv;
    const r = await createAnimal(clientA, {
      tag: opts.tag || null, idv,
      sex: opts.sex || 'female', birthDate: opts.birthDate || daysAgo(900),
      rodeoId: rodeoX.id, establishmentId: estX, systemId: rodeoX.systemId,
      categoryCode: opts.categoryCode || (opts.sex === 'male' ? 'torito' : 'vaquillona'),
    });
    if (r.error) throw new Error(`seedAnimal: ${r.error.message}`);
    const profileId = r.profile.id;
    const animalId = r.animalId;
    // breed/coat_color via UPDATE (no es param de createAnimal).
    await clientA.from('animal_profiles')
      .update({ breed: 'Brangus', coat_color: 'colorado', notes: 'nota de X', entry_origin: 'bought', entry_weight: 200 })
      .eq('id', profileId);
    // 1 weight_event con session_id (para verificar session_id→NULL).
    await admin.from('weight_events').insert({
      animal_profile_id: profileId, session_id: sessionId, weight_kg: 320, weight_date: daysAgo(30), source: 'manual',
    });
    // 1 sanitary_event con session_id.
    await admin.from('sanitary_events').insert({
      animal_profile_id: profileId, session_id: sessionId, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(20),
    });
    // 1 condition_score_event con session_id.
    await admin.from('condition_score_events').insert({
      animal_profile_id: profileId, session_id: sessionId, score: 3.0, event_date: daysAgo(15),
    });
    // 1 lab_sample con session_id.
    await admin.from('lab_samples').insert({
      animal_profile_id: profileId, session_id: sessionId, sample_type: 'blood', tube_number: 'T-1', collection_date: daysAgo(10),
    });
    // 1 observación (animal_events).
    await admin.from('animal_events').insert({
      animal_profile_id: profileId, establishment_id: estX, author_id: userA.id, event_type: 'observacion', text: 'obs de X',
    });
    return { profileId, animalId };
  }

  await t.test('setup: userA dueño de estX + rol en estY; rodeos cria en ambos; una sesión en X', async () => {
    userA = await createTestUser('s11_A');
    userB = await createTestUser('s11_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estX = await createEstablishmentAs(clientA, `${RUN_TAG} s11_estX`);
    estY = await createEstablishmentAs(clientB, `${RUN_TAG} s11_estY`);
    // userA recibe rol de field_operator en estY (tiene rol activo en X como owner + en Y).
    await assignRoleAsService(userA.id, estY, 'field_operator');
    rodeoX = await createRodeo(clientA, { establishmentId: estX, name: `${RUN_TAG}_rodeoX` });
    rodeoY = await createRodeo(clientB, { establishmentId: estY, name: `${RUN_TAG}_rodeoY` });
    speciesId = (await lookupSpeciesSystem(clientA, 'bovino', 'cria')).speciesId;
    // Una sesión en X (para taggear eventos con session_id; el re-parenting debe nullearlo).
    const { data: sess, error: sErr } = await admin.from('sessions')
      .insert({ establishment_id: estX, rodeo_id: rodeoX.id, created_by: userA.id, status: 'active' })
      .select('id').single();
    if (sErr) throw new Error(`session seed: ${sErr.message}`);
    sessionId = sess.id;
  });

  // -- T2.1: camino feliz con historia completa (incl. parto como madre con 1 ternero que queda en X). --
  await t.test('T2.1 camino feliz: transfiere con historia → perfil en Y, viejo transferred, eventos re-apuntados (est=Y, session NULL)', async () => {
    const { profileId, animalId } = await seedAnimalWithHistory({});
    // Parto: el animal es MADRE de un ternero (register_birth crea el ternero en X).
    const { data: birthId, error: bErr } = await clientA.rpc('register_birth', {
      p_mother_profile_id: profileId, p_event_date: daysAgo(5), p_calves: [{ calf_sex: 'female' }],
    });
    assert.equal(bErr, null, bErr && bErr.message);
    // 1 manual category change para poblar animal_category_history más allá del 'initial'.
    await clientA.from('animal_profiles').update({ category_override: true, category_id: await categoryId(clientA, rodeoX.systemId, 'vaca_segundo_servicio') }).eq('id', profileId);

    const newProfileId = uuid();
    const catY = await categoryId(clientA, rodeoY.systemId, 'vaca_segundo_servicio');
    const { data: ret, error } = await clientA.rpc('transfer_animal', {
      p_source_profile_id: profileId,
      p_target_establishment_id: estY,
      p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newProfileId,
      p_target_category_id: catY,
    });
    assert.equal(error, null, error && error.message);
    assert.equal(ret.target_profile_id, newProfileId);
    assert.equal(ret.replay, false);

    // Perfil nuevo activo en Y; reusa el animal_id global.
    const { data: np } = await admin.from('animal_profiles')
      .select('id, animal_id, establishment_id, rodeo_id, status, management_group_id, category_override, idv, breed, coat_color, entry_origin, entry_weight, notes, entry_date, created_by')
      .eq('id', newProfileId).single();
    assert.ok(np, 'perfil nuevo creado');
    assert.equal(np.animal_id, animalId, 'reusa el animal_id global');
    assert.equal(np.establishment_id, estY);
    assert.equal(np.rodeo_id, rodeoY.id);
    assert.equal(np.status, 'active');
    assert.equal(np.management_group_id, null, 'llega sin lote (R2.3)');
    assert.equal(np.category_override, false, 'category_override false (R2.9)');
    assert.equal(np.created_by, userA.id, 'created_by forzado al caller (0043)');
    // Descriptivos del animal VIAJAN (R2.12.a); de la relación con el campo RESETEAN (R2.12.b).
    assert.equal(np.breed, 'Brangus', 'breed viaja');
    assert.equal(np.coat_color, 'colorado', 'coat_color viaja');
    // IDU.2.5: visual_id_alt eliminado (0122) → transfer_animal ya no lo lee/escribe. El idv sí viaja (o NUL
    // por colisión) — cubierto por los tests de idv de esta suite (T5.x); acá basta con que el perfil no lo referencie.
    assert.equal(np.entry_origin, null, 'entry_origin reset');
    assert.equal(np.entry_weight, null, 'entry_weight reset');
    assert.equal(np.notes, null, 'notes reset');
    assert.equal(np.entry_date, new Date().toISOString().slice(0, 10), 'entry_date = hoy');

    // Perfil viejo archivado (transferred, NO soft-delete) — rastro en X (R4.1).
    const { data: op } = await admin.from('animal_profiles')
      .select('status, exit_reason, exit_date, deleted_at, establishment_id').eq('id', profileId).single();
    assert.equal(op.status, 'transferred');
    assert.equal(op.exit_reason, 'transfer');
    assert.ok(op.exit_date, 'exit_date seteado');
    assert.equal(op.deleted_at, null, 'NO soft-delete (deleted_at NULL)');
    assert.equal(op.establishment_id, estX, 'el viejo sigue en X (rastro)');

    // R4.2: exactamente UN perfil activo para el animal (el de Y).
    const { data: actives } = await admin.from('animal_profiles')
      .select('id, establishment_id').eq('animal_id', animalId).eq('status', 'active').is('deleted_at', null);
    assert.equal(actives.length, 1, 'exactamente 1 perfil activo');
    assert.equal(actives[0].id, newProfileId);

    // Eventos tipados re-apuntados: animal_profile_id=nuevo, establishment_id=Y, session_id=NULL (R3.1/R3.6/R3.8).
    for (const tbl of ['weight_events', 'sanitary_events', 'condition_score_events', 'lab_samples']) {
      const { data: rows } = await admin.from(tbl).select('animal_profile_id, establishment_id, session_id').eq('animal_profile_id', newProfileId);
      assert.ok(rows.length >= 1, `${tbl}: al menos 1 fila re-apuntada`);
      for (const row of rows) {
        assert.equal(row.establishment_id, estY, `${tbl}: establishment_id→Y`);
        assert.equal(row.session_id, null, `${tbl}: session_id→NULL`);
      }
      // El perfil viejo quedó SIN eventos propios (R3.9).
      const { count: nOld } = await admin.from(tbl).select('id', { count: 'exact', head: true }).eq('animal_profile_id', profileId);
      assert.equal(nOld, 0, `${tbl}: el viejo quedó sin eventos`);
    }
    // reproductive_events (el parto de la madre) re-apuntado a Y, session NULL.
    {
      const { data: re } = await admin.from('reproductive_events').select('establishment_id, session_id, event_type').eq('animal_profile_id', newProfileId);
      assert.ok(re.length >= 1, 'reproductive_events re-apuntados');
      for (const row of re) {
        assert.equal(row.establishment_id, estY, 'reproductive establishment→Y');
        assert.equal(row.session_id, null, 'reproductive session→NULL');
      }
    }
    // animal_events (observación) re-apuntado a Y (R3.2/R3.7, vía GUC — NO rechazado por inmutabilidad).
    {
      const { data: ae } = await admin.from('animal_events').select('establishment_id, text').eq('animal_profile_id', newProfileId);
      assert.ok(ae.length >= 1, 'animal_events re-apuntado (la GUC dejó cambiar las inmutables)');
      assert.equal(ae[0].establishment_id, estY, 'animal_events establishment→Y');
      const { count: nOldAe } = await admin.from('animal_events').select('id', { count: 'exact', head: true }).eq('animal_profile_id', profileId);
      assert.equal(nOldAe, 0, 'el viejo quedó sin observaciones');
    }
    // animal_category_history re-apuntada a Y (R3.3/R3.6).
    {
      const { data: ach } = await admin.from('animal_category_history').select('establishment_id').eq('animal_profile_id', newProfileId);
      assert.ok(ach.length >= 1, 'category_history re-apuntada');
      for (const row of ach) assert.equal(row.establishment_id, estY, 'category_history establishment→Y');
    }
    // birth_calves del animal-como-MADRE: el establishment de la fila puente sigue a Y (DEC-A3), pero el
    // perfil del ternero QUEDA en X (linaje cruzado R8.1).
    {
      // partos de la madre (ahora en Y).
      const { data: births } = await admin.from('reproductive_events').select('id').eq('animal_profile_id', newProfileId).eq('event_type', 'birth');
      const birthIds = (births || []).map((r) => r.id);
      assert.ok(birthIds.length >= 1, 'la madre tiene su parto re-apuntado a Y');
      const { data: bc } = await admin.from('birth_calves').select('establishment_id, calf_profile_id, birth_event_id').in('birth_event_id', birthIds);
      assert.ok(bc.length >= 1, 'birth_calves del parto de la madre');
      for (const row of bc) {
        assert.equal(row.establishment_id, estY, 'birth_calves de la madre→Y (DEC-A3)');
        // el ternero (calf_profile_id) sigue en X.
        const { data: calf } = await admin.from('animal_profiles').select('establishment_id').eq('id', row.calf_profile_id).single();
        assert.equal(calf.establishment_id, estX, 'el ternero QUEDA en X (linaje cruzado)');
      }
    }
  });

  // -- T2.2: invariante de unicidad — nunca 0 ni 2 perfiles activos. --
  await t.test('T2.2 invariante: a lo sumo 1 perfil activo en todo momento (no viola el unique parcial)', async () => {
    const { profileId, animalId } = await seedAnimalWithHistory({});
    const before = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('animal_id', animalId).eq('status', 'active').is('deleted_at', null);
    assert.equal(before.count, 1, 'arranca con 1 activo');
    const newId = uuid();
    const { error } = await clientA.rpc('transfer_animal', {
      p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newId, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
    });
    assert.equal(error, null, error && error.message);
    const after = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('animal_id', animalId).eq('status', 'active').is('deleted_at', null);
    assert.equal(after.count, 1, 'sigue con exactamente 1 activo (R4.2)');
  });

  // -- T2.3: atomicidad — category_id inválida para el system destino → rollback total. --
  await t.test('T2.3 atomicidad: category_id inválida → rollback total, el animal queda intacto en X', async () => {
    const { profileId, animalId } = await seedAnimalWithHistory({});
    // category de OTRO system (la del rodeo de origen NO sirve si forzamos una inexistente para el destino;
    // acá usamos un uuid random → el trigger de category_check (0021) la rechaza → aborta).
    const badCat = uuid();
    const newId = uuid();
    const { error } = await clientA.rpc('transfer_animal', {
      p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newId, p_target_category_id: badCat,
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'category inválida debe abortar la transferencia');
    assert.match(String(error.message + ' ' + (error.code || '')), /23514|category|invalid|foreign key|violates/i);
    // Rollback total: el animal sigue activo en X, sin perfil nuevo en Y, historia intacta.
    const { data: src } = await admin.from('animal_profiles').select('status, establishment_id').eq('id', profileId).single();
    assert.equal(src.status, 'active', 'el viejo sigue ACTIVO (rollback)');
    assert.equal(src.establishment_id, estX);
    const { data: created } = await admin.from('animal_profiles').select('id').eq('id', newId);
    assert.deepEqual(created, [], 'NO se creó perfil en Y');
    // Eventos siguen colgando del perfil viejo (en X).
    const { count: nW } = await admin.from('weight_events').select('id', { count: 'exact', head: true }).eq('animal_profile_id', profileId);
    assert.equal(nW, 1, 'los eventos siguen en el perfil viejo (historia intacta)');
    assert.ok(animalId);
  });

  // -- T2.4: seguridad — caller con rol SOLO en Y (no en X) → 42501, nada tocado. --
  await t.test('T2.4 seguridad: caller con rol SOLO en Y (no en X) → 42501, sin efectos', async () => {
    const { profileId } = await seedAnimalWithHistory({});
    // userB es dueño de Y pero NO tiene rol en X. Intenta sacar el animal de X.
    const newId = uuid();
    const { error } = await clientB.rpc('transfer_animal', {
      p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newId, p_target_category_id: await categoryId(clientB, rodeoY.systemId, 'vaquillona'),
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'sin rol en X no puede transferir');
    assert.equal(error.code, '42501', `debe ser 42501 (no autorizado): ${error.message}`);
    const { data: src } = await admin.from('animal_profiles').select('status').eq('id', profileId).single();
    assert.equal(src.status, 'active', 'el viejo sigue activo');
    const { data: created } = await admin.from('animal_profiles').select('id').eq('id', newId);
    assert.deepEqual(created, [], 'nada creado en Y');
  });

  // -- T2.5: seguridad — caller con rol SOLO en X (no en Y) → 42501. --
  await t.test('T2.5 seguridad: caller con rol SOLO en X (no en Y) → 42501, sin efectos', async () => {
    // userC: nuevo usuario con rol field_operator en X (creador del animal) pero SIN rol en Y.
    const userC = await createTestUser('s11_C');
    const clientC = await getUserClient(userC.email);
    await assignRoleAsService(userC.id, estX, 'field_operator');
    // userC crea su propio animal en X (será su creador → pasa el gate de owner-or-creator en X).
    const rc = await createAnimal(clientC, {
      idv: `${RUN_TAG}_trC_${Math.random().toString(36).slice(2, 6)}`, sex: 'female', birthDate: daysAgo(800),
      rodeoId: rodeoX.id, establishmentId: estX, systemId: rodeoX.systemId, categoryCode: 'vaquillona',
    });
    assert.equal(rc.error, undefined, rc.error && rc.error.message);
    const newId = uuid();
    const { error } = await clientC.rpc('transfer_animal', {
      p_source_profile_id: rc.profile.id, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newId, p_target_category_id: await categoryId(clientC, rodeoY.systemId, 'vaquillona'),
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'sin rol en Y no puede transferir (es un CREATE en Y)');
    assert.equal(error.code, '42501', `debe ser 42501 (no autorizado en Y): ${error.message}`);
    const { data: src } = await admin.from('animal_profiles').select('status').eq('id', rc.profile.id).single();
    assert.equal(src.status, 'active', 'el viejo sigue activo en X');
  });

  // -- T2.6: anti-IDOR + authz de baja — operario ajeno (rol en X pero NO owner ni creador) → 42501. --
  await t.test('T2.6 anti-IDOR: rol en X+Y pero NI owner NI creador del animal → 42501 (paridad 0044)', async () => {
    // userE: field_operator en X y en Y, pero NO es owner de X ni creador del animal (lo creó userA).
    const userE = await createTestUser('s11_E');
    const clientE = await getUserClient(userE.email);
    await assignRoleAsService(userE.id, estX, 'field_operator');
    await assignRoleAsService(userE.id, estY, 'field_operator');
    const { profileId } = await seedAnimalWithHistory({}); // creado por userA
    const newId = uuid();
    const { error } = await clientE.rpc('transfer_animal', {
      p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newId, p_target_category_id: await categoryId(clientE, rodeoY.systemId, 'vaquillona'),
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'operario ajeno (no owner ni creador) no puede sacar el animal de X');
    assert.equal(error.code, '42501', `debe ser 42501 (no owner ni creador en X): ${error.message}`);
    const { data: src } = await admin.from('animal_profiles').select('status').eq('id', profileId).single();
    assert.equal(src.status, 'active', 'el viejo sigue activo (la baja no autorizada no corrió)');
    const { data: created } = await admin.from('animal_profiles').select('id').eq('id', newId);
    assert.deepEqual(created, [], 'nada creado en Y');
  });

  // -- T2.7: perfil de origen ya inactivo/inexistente → 23503 sin efectos. --
  await t.test('T2.7 origen inactivo/transferido/inexistente → 23503 sin efectos', async () => {
    // (a) inexistente.
    {
      const { error } = await clientA.rpc('transfer_animal', {
        p_source_profile_id: uuid(), p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: uuid(), p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
      });
      assertRpcExists(error);
      assert.notEqual(error, null, 'perfil inexistente → error');
      assert.equal(error.code, '23503', `debe ser 23503 (no encontrado): ${error.message}`);
    }
    // (b) ya transferido (transferimos uno, luego intentamos transferirlo de nuevo desde el viejo).
    {
      const { profileId } = await seedAnimalWithHistory({});
      const okId = uuid();
      const r1 = await clientA.rpc('transfer_animal', {
        p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: okId, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
      });
      assert.equal(r1.error, null, r1.error && r1.error.message);
      // El perfil viejo ahora está 'transferred' → re-transferirlo desde el viejo debe fallar 23503.
      const { error } = await clientA.rpc('transfer_animal', {
        p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: uuid(), p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
      });
      assertRpcExists(error);
      assert.notEqual(error, null, 'origen ya transferido → 23503');
      assert.equal(error.code, '23503', `debe ser 23503 (ya transferido): ${error.message}`);
    }
  });

  // -- T2.8: idv conservar-o-NULL. --
  await t.test('T2.8 idv: (a) libre en Y → se conserva; (b) colisiona en Y → NULL + idv_dropped, transfiere igual', async () => {
    // (a) idv libre en Y.
    {
      const idv = `${RUN_TAG}_idvkeep_${Math.random().toString(36).slice(2, 6)}`;
      const { profileId } = await seedAnimalWithHistory({ idv });
      const newId = uuid();
      const { data: ret, error } = await clientA.rpc('transfer_animal', {
        p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: newId, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
      });
      assert.equal(error, null, error && error.message);
      assert.equal(ret.idv_dropped, false);
      const { data: np } = await admin.from('animal_profiles').select('idv').eq('id', newId).single();
      assert.equal(np.idv, idv, 'idv conservado');
    }
    // (b) idv colisiona en Y → NULL + flag.
    {
      const idv = `${RUN_TAG}_idvclash_${Math.random().toString(36).slice(2, 6)}`;
      // un animal en Y que ya ocupa ese idv (lo crea userB, dueño de Y).
      await createAnimal(clientB, { idv, sex: 'female', birthDate: daysAgo(700), rodeoId: rodeoY.id, establishmentId: estY, systemId: rodeoY.systemId, categoryCode: 'vaquillona' });
      const { profileId } = await seedAnimalWithHistory({ idv });
      const newId = uuid();
      const { data: ret, error } = await clientA.rpc('transfer_animal', {
        p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: newId, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
      });
      assert.equal(error, null, error && error.message);
      assert.equal(ret.idv_dropped, true, 'idv_dropped=true por colisión');
      const { data: np } = await admin.from('animal_profiles').select('idv').eq('id', newId).single();
      assert.equal(np.idv, null, 'idv quedó NULL por colisión');
    }
  });

  // -- T2.9: rodeo destino mismo sistema. --
  // En MVP solo (bovino, cria) está activo en systems_by_species (0014). Para tener un rodeo de OTRO
  // system en Y (y ejercer la rama cross-system del RPC, línea `system distinct`) activamos invernada
  // TEMPORALMENTE vía service_role, creamos el rodeo, y RESTAURAMOS invernada a inactivo al final
  // (try/finally). El catálogo es GLOBAL → la ventana de activación es mínima y se restaura siempre;
  // los demás tests resuelven 'cria' explícito y no se ven afectados (riesgo de carrera con terminales
  // paralelas: acotado y auto-restaurado).
  await t.test('T2.9 rodeo destino: (a) otro system → 23514; (b) mismo system → OK', async () => {
    const { data: sp } = await admin.from('species').select('id').eq('code', 'bovino').single();
    const { data: invSys } = await admin.from('systems_by_species').select('id, active').eq('species_id', sp.id).eq('code', 'invernada').single();
    let rodeoYInvId = null;
    try {
      await admin.from('systems_by_species').update({ active: true }).eq('id', invSys.id);
      const { data: rInv, error: rErr } = await admin.from('rodeos')
        .insert({ establishment_id: estY, name: `${RUN_TAG}_rodeoYinv`, species_id: sp.id, system_id: invSys.id })
        .select('id').single();
      assert.equal(rErr, null, rErr && rErr.message);
      rodeoYInvId = rInv.id;

      // (a) rodeo destino de OTRO system (invernada) → 23514 (cross-system).
      {
        const { profileId } = await seedAnimalWithHistory({});
        const { error } = await clientA.rpc('transfer_animal', {
          p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoYInvId,
          p_target_profile_id: uuid(), p_target_category_id: await categoryId(clientA, rodeoX.systemId, 'vaquillona'),
        });
        assertRpcExists(error);
        assert.notEqual(error, null, 'rodeo de otro system → rechazo');
        assert.equal(error.code, '23514', `debe ser 23514 (cross-system): ${error.message}`);
      }
    } finally {
      // Restaurar invernada a inactivo (hygiene del catálogo global). El rodeo creado lo limpia el
      // cleanup vía el cascade de estY; igual lo borramos explícito para no dejar un rodeo de un system
      // que vuelve a inactivo (consistencia).
      if (rodeoYInvId) await admin.from('rodeos').delete().eq('id', rodeoYInvId);
      await admin.from('systems_by_species').update({ active: invSys.active }).eq('id', invSys.id);
    }

    // (b) mismo system (cria) → OK.
    {
      const { profileId } = await seedAnimalWithHistory({});
      const { error } = await clientA.rpc('transfer_animal', {
        p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: uuid(), p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
      });
      assertRpcExists(error);
      assert.equal(error, null, `mismo system debe ser OK: ${error && error.message}`);
    }
  });

  // -- T2.10: idempotencia — replay con el mismo p_target_profile_id = no-op. --
  await t.test('T2.10 idempotencia: 2 invocaciones con el mismo p_target_profile_id → 2da es no-op (replay)', async () => {
    const { profileId, animalId } = await seedAnimalWithHistory({});
    const newId = uuid();
    const args = {
      p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newId, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
    };
    const r1 = await clientA.rpc('transfer_animal', args);
    assert.equal(r1.error, null, r1.error && r1.error.message);
    assert.equal(r1.data.replay, false);
    // Replay: el perfil target ya existe en Y → no-op.
    const r2 = await clientA.rpc('transfer_animal', args);
    assert.equal(r2.error, null, `el replay NO debe dar error: ${r2.error && r2.error.message}`);
    assert.equal(r2.data.replay, true, 'la 2da es replay');
    assert.equal(r2.data.target_profile_id, newId);
    // Estado real: exactamente 1 perfil activo + el viejo transferred (no doble re-apuntado).
    const { count: nActive } = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('animal_id', animalId).eq('status', 'active').is('deleted_at', null);
    assert.equal(nActive, 1, 'el replay no creó un 2do perfil activo');
    const { count: nProfiles } = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('animal_id', animalId);
    assert.equal(nProfiles, 2, 'exactamente 2 perfiles (1 transferred en X + 1 activo en Y)');
  });

  // -- T2.11: linaje cruzado — descendencia que queda en X re-apunta su bull_id/calf_id al perfil nuevo. --
  await t.test('T2.11 linaje cruzado: madre transferida → bull_id/calf_id de la cría (en X) apunta al perfil nuevo (Y); el evento sigue en X', async () => {
    // Toro en X que será transferido a Y. Una cría en X tiene un service con bull_id=el toro.
    const bull = await seedAnimalWithHistory({ sex: 'male', categoryCode: 'torito', idv: `${RUN_TAG}_bull_${Math.random().toString(36).slice(2, 6)}` });
    const calf = await createAnimal(clientA, { idv: `${RUN_TAG}_calf_${Math.random().toString(36).slice(2, 6)}`, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoX.id, establishmentId: estX, systemId: rodeoX.systemId, categoryCode: 'vaquillona' });
    // service event de la cría con bull_id = el toro (evento de OTRO animal que referencia al toro).
    const { data: ev, error: evErr } = await admin.from('reproductive_events')
      .insert({ animal_profile_id: calf.profile.id, event_type: 'service', event_date: daysAgo(100), service_type: 'natural', bull_id: bull.profileId })
      .select('id, establishment_id').single();
    assert.equal(evErr, null, evErr && evErr.message);
    const evEstBefore = ev.establishment_id;

    const newBullId = uuid();
    const { error } = await clientA.rpc('transfer_animal', {
      p_source_profile_id: bull.profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newBullId, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'torito'),
    });
    assert.equal(error, null, error && error.message);
    // El service de la cría (que QUEDA en X) ahora apunta su bull_id al perfil nuevo del toro (en Y).
    const { data: evAfter } = await admin.from('reproductive_events').select('bull_id, establishment_id, animal_profile_id').eq('id', ev.id).single();
    assert.equal(evAfter.bull_id, newBullId, 'bull_id re-apuntado al perfil nuevo (R3.4)');
    assert.equal(evAfter.animal_profile_id, calf.profile.id, 'el evento sigue siendo de la cría (no se movió)');
    assert.equal(evAfter.establishment_id, evEstBefore, 'el evento NO cambió de establishment (sigue en X — R8.1)');
    assert.equal(evAfter.establishment_id, estX, 'el evento de la descendencia sigue en X');
  });

  // -- T2.12: aislamiento de sync — NINGUNA fila hija queda con establishment_id=X; animal_events vía GUC. --
  await t.test('T2.12 aislamiento de sync: ninguna fila hija re-apuntada queda con establishment_id=X', async () => {
    const { profileId, animalId } = await seedAnimalWithHistory({});
    const newId = uuid();
    const { error } = await clientA.rpc('transfer_animal', {
      p_source_profile_id: profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: newId, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'vaquillona'),
    });
    assert.equal(error, null, error && error.message);
    // Ninguna fila hija re-apuntada del animal apunta a X.
    for (const tbl of ['weight_events', 'sanitary_events', 'condition_score_events', 'lab_samples', 'reproductive_events', 'animal_category_history']) {
      const { data: leaked } = await admin.from(tbl).select('id').eq('animal_profile_id', newId).eq('establishment_id', estX);
      assert.deepEqual(leaked, [], `${tbl}: NINGUNA fila re-apuntada quedó en X (fuga de sync)`);
    }
    // animal_events: re-apuntado, en Y (el trigger de inmutabilidad NO lo rechazó gracias a la GUC).
    const { data: ae } = await admin.from('animal_events').select('establishment_id').eq('animal_profile_id', newId);
    assert.ok(ae.length >= 1, 'animal_events re-apuntado (GUC permitió mover las inmutables)');
    for (const row of ae) assert.equal(row.establishment_id, estY, 'animal_events en Y, no en X');
    assert.ok(animalId);
  });

  // -- T2.13: grants — transfer_animal no es EXECUTE-able por anon/public; sí por authenticated. --
  await t.test('T2.13 grants: transfer_animal NO invocable por anon (PostgREST sin JWT) — fail-closed', async () => {
    // cliente anon (sin sesión).
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await anonClient.rpc('transfer_animal', {
      p_source_profile_id: uuid(), p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
      p_target_profile_id: uuid(), p_target_category_id: uuid(),
    });
    assert.notEqual(error, null, 'anon NO debe poder invocar transfer_animal');
    // anon sin EXECUTE → 404/permission denied (no llega a la lógica). El smoke-check del 0087 ya falla
    // el deploy si quedara EXECUTE-able por anon/public; acá verificamos el comportamiento end-to-end.
    assert.match(String(error.message + ' ' + (error.code || '')), /permission denied|not found|PGRST|42501|404/i);
  });

  // -- T2.14: is_castrated preserva (global); future_bull arranca false en Y. --
  await t.test('T2.14 is_castrated preserva / future_bull no viaja', async () => {
    // Macho castrado con future_bull=true en X.
    const m = await seedAnimalWithHistory({ sex: 'male', categoryCode: 'torito', idv: `${RUN_TAG}_cast_${Math.random().toString(36).slice(2, 6)}` });
    // castrar (write-through a animals) + marcar future_bull... future_bull se auto-clear al castrar (0085),
    // así que para probar que NO viaja, lo seteamos en un macho NO castrado.
    const m2 = await seedAnimalWithHistory({ sex: 'male', categoryCode: 'torito', idv: `${RUN_TAG}_fb_${Math.random().toString(36).slice(2, 6)}` });
    await clientA.from('animal_profiles').update({ future_bull: true }).eq('id', m2.profileId);
    // castrar m (is_castrated es estado global → debe preservarse en Y).
    await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', m.profileId);

    // transfiere m (castrado).
    const newM = uuid();
    {
      const { error } = await clientA.rpc('transfer_animal', {
        p_source_profile_id: m.profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: newM, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'torito'),
      });
      assert.equal(error, null, error && error.message);
      const { data: np } = await admin.from('animal_profiles').select('is_castrated, future_bull').eq('id', newM).single();
      assert.equal(np.is_castrated, true, 'is_castrated preservado (estado global, R2.7)');
      assert.equal(np.future_bull, false, 'future_bull arranca false en Y (R2.8)');
    }
    // transfiere m2 (future_bull=true en X) → arranca false en Y.
    const newM2 = uuid();
    {
      const { error } = await clientA.rpc('transfer_animal', {
        p_source_profile_id: m2.profileId, p_target_establishment_id: estY, p_target_rodeo_id: rodeoY.id,
        p_target_profile_id: newM2, p_target_category_id: await categoryId(clientA, rodeoY.systemId, 'torito'),
      });
      assert.equal(error, null, error && error.message);
      const { data: np } = await admin.from('animal_profiles').select('future_bull').eq('id', newM2).single();
      assert.equal(np.future_bull, false, 'future_bull NO viaja entre campos (R2.8)');
    }
  });
});

// spec 09 — chunk "09 resto · dedup A/B": RPC assign_tag_to_animal (asignación de caravana NULL→valor).
// Migración supabase/migrations/0089_assign_tag_to_animal_rpc.sql.
// ⚠️ Estos tests REQUIEREN 0089 APLICADA al remoto (la aplica el leader por Management API tras gatear el
// SQL — Gate 1 PASS + Gate 2 + autorización de Raf). Hasta entonces FALLAN — ESPERADO: la función
// assign_tag_to_animal no existe (PGRST202). Patrón 0075-0088.
//
// El RPC asigna la caravana electrónica (EID 15 díg) al animal GLOBAL de un perfil ACTIVO sin caravana
// (NULL→valor), SECURITY DEFINER: (a) deriva animal_id+establishment_id de la fila real (anti-IDOR);
// (b) has_role_in sobre el tenant derivado (cualquier rol activo, D-d); (c) valida formato ^\d{15}$;
// (d) idempotencia state-based (animal ya con ese TAG → replay:true); (e) UPDATE con guard tag IS NULL;
// (f) 0 filas = race → 23514. Unicidad global → 23505 del índice animals_tag_unique (0019). El efecto baja
// a animal_profiles.animal_tag_electronic vía la propagación del trigger 0079 (no lo escribe el cliente).
// =====================================================================
test('spec 09 — assign_tag_to_animal RPC (asignación de caravana NULL→valor)', async (t) => {
  const uuid = () => require('node:crypto').randomUUID();
  // Guard: distingue un error de DOMINIO (lo que el test quiere) de PGRST202 (la función no existe porque la
  // migración 0089 no está aplicada). Sin esto, un PGRST202 que casualmente contenga un código esperado haría
  // pasar las aserciones de error por la razón EQUIVOCADA (autorrevisión adversarial).
  function assertRpcExists(error) {
    if (error && error.code === 'PGRST202') {
      assert.fail('assign_tag_to_animal no existe en el remoto (migración 0089 no aplicada) — este test no puede validar el comportamiento real.');
    }
  }
  // EID de 15 dígitos ÚNICO por invocación (el RPC valida ^\d{15}$ → los TAG `${RUN_TAG}_...` de la suite
  // base NO sirven acá). Prefijo fijo + 9 díg random sobre 6 díg de base → colisión despreciable; el índice
  // global animals_tag_unique rebota igual si colisionara (no es un test que dependa de un valor concreto).
  let eidCounter = 0;
  function eid15() {
    eidCounter += 1;
    const tail = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    const head = String(eidCounter % 1000000).padStart(6, '0');
    return (head + tail).slice(0, 15);
  }

  // userA: owner de estA (campo del animal). userB: owner de estB (otro campo, SIN rol en estA).
  let userA, userB, clientA, clientB, estA, estB;
  let rodeoA, rodeoB; // {id, systemId} en cria

  // Crea un animal SIN caravana en estA/rodeoA (candidato a asignación). Devuelve { profileId, animalId }.
  async function seedNoTagAnimal(opts = {}) {
    const r = await createAnimal(clientA, {
      idv: opts.idv === undefined ? `${RUN_TAG}_at_${Math.random().toString(36).slice(2, 7)}` : opts.idv,
      sex: opts.sex || 'female', birthDate: opts.birthDate || daysAgo(700),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId,
      categoryCode: opts.categoryCode || (opts.sex === 'male' ? 'torito' : 'vaquillona'),
    });
    if (r.error) throw new Error(`seedNoTagAnimal: ${r.error.message}`);
    return { profileId: r.profile.id, animalId: r.animalId };
  }

  await t.test('setup: userA owner de estA, userB owner de estB; rodeos cria en ambos', async () => {
    userA = await createTestUser('s09at_A');
    userB = await createTestUser('s09at_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} s09at_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} s09at_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_rodeoA_at` });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_rodeoB_at` });
  });

  // -- Escenario 1: NULL→valor OK + propagación a animal_profiles.animal_tag_electronic (0079) + replay:false. --
  await t.test('escenario 1: NULL→valor OK → animals.tag_electronic seteado + propagado al perfil (0079) + replay:false', async () => {
    const { profileId, animalId } = await seedNoTagAnimal({});
    const tag = eid15();
    const { data: ret, error } = await clientA.rpc('assign_tag_to_animal', {
      p_profile_id: profileId, p_tag_electronic: tag, p_client_op_id: uuid(),
    });
    assertRpcExists(error);
    assert.equal(error, null, error && error.message);
    assert.equal(ret.replay, false, 'primera asignación: replay false');
    assert.equal(ret.animal_id, animalId);
    assert.equal(ret.profile_id, profileId);
    assert.equal(ret.tag_electronic, tag);
    // animals.tag_electronic quedó seteado (lectura por service_role: animals está fuera del sync, pero el
    // backend test la lee directo).
    const { data: an } = await admin.from('animals').select('tag_electronic').eq('id', animalId).single();
    assert.equal(an.tag_electronic, tag, 'animals.tag_electronic seteado por el RPC');
    // Propagación 0079: animal_profiles.animal_tag_electronic del perfil quedó con el TAG (la UI lo lee offline).
    const { data: prof } = await admin.from('animal_profiles').select('animal_tag_electronic').eq('id', profileId).single();
    assert.equal(prof.animal_tag_electronic, tag, 'animal_tag_electronic propagado al perfil (trigger 0079)');
  });

  // -- Escenario 2: valor→valor rebota (guard IS NULL / trigger 0036) → 23514. --
  await t.test('escenario 2: animal con caravana A → asignar B rebota (guard IS NULL → 0 filas → 23514)', async () => {
    const { profileId, animalId } = await seedNoTagAnimal({});
    const tagA = eid15();
    // Primera asignación (NULL→valor) OK.
    {
      const { error } = await clientA.rpc('assign_tag_to_animal', { p_profile_id: profileId, p_tag_electronic: tagA, p_client_op_id: uuid() });
      assertRpcExists(error);
      assert.equal(error, null, error && error.message);
    }
    // Intentar reasignar OTRO tag (B) al mismo animal → el guard AND tag_electronic IS NULL afecta 0 filas
    // → 23514 (race/valor→valor). DISTINGUIBLE del dup global (23505).
    const tagB = eid15();
    const { error } = await clientA.rpc('assign_tag_to_animal', { p_profile_id: profileId, p_tag_electronic: tagB, p_client_op_id: uuid() });
    assertRpcExists(error);
    assert.notEqual(error, null, 'reasignar a un animal que ya tiene caravana debe rebotar');
    assert.equal(error.code, '23514', `debe ser 23514 (animal ya tiene caravana): ${error.message}`);
    // El animal conserva su caravana original (no se pisó).
    const { data: an } = await admin.from('animals').select('tag_electronic').eq('id', animalId).single();
    assert.equal(an.tag_electronic, tagA, 'la caravana original NO se pisó');
  });

  // -- Escenario 3: anti-IDOR — perfil de OTRO campo (caller sin rol) → 42501, no toca el animal ajeno. --
  await t.test('escenario 3: anti-IDOR — p_profile_id de un perfil de OTRO campo → 42501, sin tocar el animal ajeno', async () => {
    // Animal de estB (de userB). userA NO tiene rol en estB.
    const rb = await createAnimal(clientB, {
      idv: `${RUN_TAG}_atB_${Math.random().toString(36).slice(2, 6)}`, sex: 'female', birthDate: daysAgo(700),
      rodeoId: rodeoB.id, establishmentId: estB, systemId: rodeoB.systemId, categoryCode: 'vaquillona',
    });
    assert.equal(rb.error, undefined, rb.error && rb.error.message);
    const tag = eid15();
    // userA invoca el RPC sobre el perfil de B (que SÍ existe). La derivación de la fila real encuentra el
    // tenant estB, pero has_role_in(estB) es false para userA → 42501. El animal ajeno NO se toca.
    const { error } = await clientA.rpc('assign_tag_to_animal', { p_profile_id: rb.profile.id, p_tag_electronic: tag, p_client_op_id: uuid() });
    assertRpcExists(error);
    assert.notEqual(error, null, 'asignar sobre un perfil de otro campo debe fallar');
    assert.equal(error.code, '42501', `debe ser 42501 (sin rol en el tenant derivado): ${error.message}`);
    // El animal de B sigue sin caravana (no se aplicó nada).
    const { data: an } = await admin.from('animals').select('tag_electronic').eq('id', rb.animalId).single();
    assert.equal(an.tag_electronic, null, 'el animal ajeno NO recibió la caravana (anti-IDOR)');
  });

  // -- Escenario 4: rol sin acceso — usuario sin rol activo en el campo del perfil → 42501. --
  await t.test('escenario 4: usuario sin rol activo en el campo del perfil → 42501', async () => {
    const { profileId, animalId } = await seedNoTagAnimal({});
    // userC: nuevo usuario sin ningún rol en estA.
    const userC = await createTestUser('s09at_C');
    const clientC = await getUserClient(userC.email);
    const tag = eid15();
    const { error } = await clientC.rpc('assign_tag_to_animal', { p_profile_id: profileId, p_tag_electronic: tag, p_client_op_id: uuid() });
    assertRpcExists(error);
    assert.notEqual(error, null, 'sin rol activo no puede asignar caravana');
    assert.equal(error.code, '42501', `debe ser 42501 (sin rol activo): ${error.message}`);
    const { data: an } = await admin.from('animals').select('tag_electronic').eq('id', animalId).single();
    assert.equal(an.tag_electronic, null, 'el animal sigue sin caravana');
  });

  // -- Escenario 5: idempotencia state-based — reintento (mismo TAG ya aplicado) → replay:true, no rebota. --
  await t.test('escenario 5: idempotencia — reintento con el TAG ya aplicado → replay:true (no doble-aplica ni rebota)', async () => {
    const { profileId, animalId } = await seedNoTagAnimal({});
    const tag = eid15();
    const opId = uuid();
    // 1ra invocación: NULL→valor, replay false.
    const r1 = await clientA.rpc('assign_tag_to_animal', { p_profile_id: profileId, p_tag_electronic: tag, p_client_op_id: opId });
    assertRpcExists(r1.error);
    assert.equal(r1.error, null, r1.error && r1.error.message);
    assert.equal(r1.data.replay, false);
    // 2da invocación: mismo TAG ya aplicado al MISMO animal → la dedup state-based (d) lo reconoce →
    // replay:true SIN error (NO rebota 23514 por el guard, NO 23505 por unicidad — es el propio animal).
    // p_client_op_id repetido es passthrough (no ancla nada): el replay se reconoce por el ESTADO ya aplicado.
    const r2 = await clientA.rpc('assign_tag_to_animal', { p_profile_id: profileId, p_tag_electronic: tag, p_client_op_id: opId });
    assert.equal(r2.error, null, `el replay NO debe dar error: ${r2.error && r2.error.message}`);
    assert.equal(r2.data.replay, true, 'reintento del TAG ya aplicado → replay true');
    assert.equal(r2.data.animal_id, animalId);
    assert.equal(r2.data.tag_electronic, tag);
    // El TAG quedó UNA sola vez (no se duplicó nada; sigue siendo el propio animal con su caravana).
    const { data: an } = await admin.from('animals').select('tag_electronic').eq('id', animalId).single();
    assert.equal(an.tag_electronic, tag, 'el TAG sigue aplicado una sola vez');
    // (DA-1 condición de Gate 1) el replay legítimo del propio animal se distingue del dup global de OTRO
    // animal — un client_op_id DISTINTO sobre el MISMO estado ya aplicado también es replay:true (la dedup
    // es por estado, no por client_op_id).
    const r3 = await clientA.rpc('assign_tag_to_animal', { p_profile_id: profileId, p_tag_electronic: tag, p_client_op_id: uuid() });
    assert.equal(r3.error, null, `replay state-based con OTRO client_op_id tampoco debe dar error: ${r3.error && r3.error.message}`);
    assert.equal(r3.data.replay, true, 'state-based: mismo estado, distinto client_op_id → replay true igual');
  });

  // -- Escenario 6: dup global — TAG ya en OTRO animal → 23505 (índice animals_tag_unique 0019). --
  await t.test('escenario 6: TAG ya asignado a OTRO animal global → 23505 (unicidad global), distinguible del race', async () => {
    const tag = eid15();
    // Animal 1 (de estA) ya tiene el TAG.
    const a1 = await seedNoTagAnimal({});
    {
      const { error } = await clientA.rpc('assign_tag_to_animal', { p_profile_id: a1.profileId, p_tag_electronic: tag, p_client_op_id: uuid() });
      assertRpcExists(error);
      assert.equal(error, null, error && error.message);
    }
    // Animal 2 (de estA, SIN caravana) intenta el MISMO TAG → el UPDATE de (e) viola el índice global parcial
    // animals_tag_unique → 23505. NO es el replay (es OTRO animal_id) → no replay:true, no 23514.
    const a2 = await seedNoTagAnimal({});
    const { error } = await clientA.rpc('assign_tag_to_animal', { p_profile_id: a2.profileId, p_tag_electronic: tag, p_client_op_id: uuid() });
    assertRpcExists(error);
    assert.notEqual(error, null, 'un TAG ya usado por otro animal debe rebotar');
    assert.equal(error.code, '23505', `debe ser 23505 (dup global): ${error.message}`);
    // Animal 2 sigue sin caravana (el dup no le aplicó nada).
    const { data: an } = await admin.from('animals').select('tag_electronic').eq('id', a2.animalId).single();
    assert.equal(an.tag_electronic, null, 'el 2do animal NO recibió el TAG duplicado');
  });

  // -- grants: assign_tag_to_animal NO invocable por anon (fail-closed) — paridad con 0087/0089 cierre. --
  await t.test('grants: assign_tag_to_animal NO invocable por anon (PostgREST sin JWT) — fail-closed', async () => {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await anonClient.rpc('assign_tag_to_animal', {
      p_profile_id: uuid(), p_tag_electronic: eid15(), p_client_op_id: uuid(),
    });
    assert.notEqual(error, null, 'anon NO debe poder invocar assign_tag_to_animal');
    // anon sin EXECUTE → permission denied / 404 (no llega a la lógica). El smoke-check del 0089 ya falla el
    // deploy si quedara EXECUTE-able por anon/public; acá verificamos el comportamiento end-to-end.
    assert.match(String(error.message + ' ' + (error.code || '')), /permission denied|not found|PGRST|42501|404/i);
  });

  // -- formato: EID que no es 15 díg → 23514 (validación server-side, defensa en profundidad). --
  await t.test('formato: p_tag_electronic que no es 15 dígitos → 23514 (validación server-side)', async () => {
    const { profileId } = await seedNoTagAnimal({});
    for (const badTag of ['123', '12345678901234', '1234567890123456', 'ABCDEFGHIJKLMNO', '12345678901234a']) {
      const { error } = await clientA.rpc('assign_tag_to_animal', { p_profile_id: profileId, p_tag_electronic: badTag, p_client_op_id: uuid() });
      assertRpcExists(error);
      assert.notEqual(error, null, `tag inválido "${badTag}" debe rebotar`);
      assert.equal(error.code, '23514', `tag "${badTag}" debe dar 23514: ${error.message}`);
    }
  });

  // -- perfil inexistente / inactivo → 23503 (derivación de la fila real, anti-IDOR). --
  await t.test('perfil inexistente → 23503 sin efectos', async () => {
    const { error } = await clientA.rpc('assign_tag_to_animal', { p_profile_id: uuid(), p_tag_electronic: eid15(), p_client_op_id: uuid() });
    assertRpcExists(error);
    assert.notEqual(error, null, 'perfil inexistente debe rebotar');
    assert.equal(error.code, '23503', `debe ser 23503 (perfil no encontrado): ${error.message}`);
  });
});

// =====================================================================
// spec 02 — delta VINCULAR LA CRÍA AL PIE (#15): RPC link_calf_to_mother (0114) + register_birth con rodeo
// del ternero (0115). Suites TOP-LEVEL propias con setup aislado (espejo de las suites 0075/0089).
//
// El delta vive en supabase/migrations/0114_link_calf_to_mother_rpc.sql + 0115_register_birth_calf_rodeo.sql.
// ⚠️ Estos tests REQUIEREN 0114 + 0115 APLICADAS al remoto (las aplica el LEADER por Supabase MCP / Management
// API tras gatear el SQL — Gate 1 PASS + Gate 2 + reviewer + autorización de Raf). Hasta entonces FALLAN —
// ESPERADO: link_calf_to_mother no existe (PGRST202) y register_birth sigue con la firma vieja (un call con
// p_calf_rodeo_id/p_calf_idv da PGRST202). El implementer NO aplica las migraciones. Patrón 0075-0089.
// =====================================================================
test('spec 02 delta #15 — link_calf_to_mother RPC (vincular ternero EXISTENTE)', async (t) => {
  const uuid = () => require('node:crypto').randomUUID();
  // Distingue un error de DOMINIO (lo que el test quiere) de PGRST202 (función inexistente porque 0114 no está
  // aplicada). Sin esto, un PGRST202 que casualmente matchee un código esperado haría pasar las aserciones por
  // la razón EQUIVOCADA (autorrevisión adversarial).
  function assertRpcExists(error) {
    if (error && error.code === 'PGRST202') {
      assert.fail('link_calf_to_mother no existe en el remoto (migración 0114 no aplicada) — este test no puede validar el comportamiento real.');
    }
  }

  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoB;

  // Crea una MADRE (vaquillona_prenada → tras el vínculo debe avanzar a vaca_segundo_servicio).
  async function makeMother(client, est, rodeo, idvSuffix) {
    const r = await createAnimal(client, {
      idv: `${RUN_TAG}_lcm_M_${idvSuffix}`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeo.id, establishmentId: est, systemId: rodeo.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    return r.profile.id;
  }
  // Crea un TERNERO EXISTENTE (activo, sin madre todavía).
  async function makeCalf(client, est, rodeo, idvSuffix, sex = 'male') {
    const r = await createAnimal(client, {
      idv: `${RUN_TAG}_lcm_C_${idvSuffix}`, sex, birthDate: daysAgo(30),
      rodeoId: rodeo.id, establishmentId: est, systemId: rodeo.systemId,
      categoryCode: sex === 'male' ? 'ternero' : 'ternera',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    return { profileId: r.profile.id, animalId: r.animalId };
  }

  await t.test('setup: userA owner de estA, userB owner de estB; rodeos cria en ambos', async () => {
    userA = await createTestUser('lcm_A');
    userB = await createTestUser('lcm_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} lcm_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} lcm_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_lcm_rA` });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_lcm_rB` });
  });

  // -- T5 / RCAP.10.1: happy. 1 reproductive_events(birth) + 1 birth_calves; madre nursing=true (0067) +
  //    recompute de categoría (0031/0063: vaquillona_prenada → vaca_segundo_servicio). --
  await t.test('T5 (RCAP.10.1): happy — vincula 1 ternero existente → 1 parto + 1 birth_calves + nursing + categoría', async () => {
    const motherId = await makeMother(clientA, estA, rodeoA, 'happy');
    const calf = await makeCalf(clientA, estA, rodeoA, 'happy');

    const evBefore = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherId).eq('event_type', 'birth');

    const { data: ret, error } = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherId, p_calf_profile_id: calf.profileId,
      p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assertRpcExists(error);
    assert.equal(error, null, error && error.message);
    assert.ok(ret && ret.birth_event_id, 'devuelve { birth_event_id }');
    assert.equal(ret.replay, false, 'replay:false en la 1ra vinculación');
    const birthId = ret.birth_event_id;

    // Exactamente UN evento de parto nuevo.
    const evAfter = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherId).eq('event_type', 'birth');
    assert.equal(evAfter.count, evBefore.count + 1, 'exactamente UN evento de parto creado');
    // El evento es de la madre y persiste su client_op_id.
    const { data: ev } = await admin.from('reproductive_events')
      .select('animal_profile_id, event_type, client_op_id').eq('id', birthId).single();
    assert.equal(ev.animal_profile_id, motherId, 'el evento de parto es de la madre');
    assert.equal(ev.event_type, 'birth');

    // Exactamente UNA fila birth_calves, apuntando al ternero EXISTENTE (no a uno nuevo).
    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    assert.equal(bc.length, 1, 'exactamente 1 fila birth_calves');
    assert.equal(bc[0].calf_profile_id, calf.profileId, 'la fila puente apunta al ternero EXISTENTE');

    // Madre nursing=true (0067) + categoría recomputada (vaquillona_prenada → vaca_segundo_servicio).
    const { data: m } = await admin.from('animal_profiles').select('nursing, category_id').eq('id', motherId).single();
    assert.equal(m.nursing, true, 'la madre queda nursing=true (trigger 0067)');
    const { data: mcat } = await admin.from('categories_by_system').select('code').eq('id', m.category_id).single();
    assert.equal(mcat.code, 'vaca_segundo_servicio', 'la madre recomputa categoría por el parto (0031/0063)');
  });

  // -- T6 / RCAP.10.2: re-link rechazado. Ternero ya con madre → 23514, sin filas nuevas. --
  await t.test('T6 (RCAP.10.2): re-vincular un ternero que ya tiene madre → 23514, sin filas nuevas', async () => {
    const mother1 = await makeMother(clientA, estA, rodeoA, 'relink1');
    const mother2 = await makeMother(clientA, estA, rodeoA, 'relink2');
    const calf = await makeCalf(clientA, estA, rodeoA, 'relink');

    // 1er vínculo: OK.
    const r1 = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: mother1, p_calf_profile_id: calf.profileId, p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assertRpcExists(r1.error);
    assert.equal(r1.error, null, r1.error && r1.error.message);

    const ev2Before = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', mother2);
    const bcBefore = await admin.from('birth_calves')
      .select('calf_profile_id', { count: 'exact', head: true }).eq('calf_profile_id', calf.profileId);

    // 2do vínculo del MISMO ternero a OTRA madre → rechazado (23514, "ya tiene madre"). client_op_id NUEVO
    // (no es un replay) para ejercer el guard (f), no el de idempotencia (e).
    const r2 = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: mother2, p_calf_profile_id: calf.profileId, p_event_date: daysAgo(20), p_client_op_id: uuid(),
    });
    assertRpcExists(r2.error);
    assert.notEqual(r2.error, null, 're-vincular un ternero con madre debe rebotar');
    assert.equal(r2.error.code, '23514', `debe ser 23514 (ya tiene madre): ${r2.error.message}`);

    // Sin filas nuevas: mother2 no recibió un parto, el ternero sigue con UNA sola fila puente.
    const ev2After = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', mother2);
    assert.equal(ev2After.count, ev2Before.count, 'mother2 NO recibió un evento de parto');
    const bcAfter = await admin.from('birth_calves')
      .select('calf_profile_id', { count: 'exact', head: true }).eq('calf_profile_id', calf.profileId);
    assert.equal(bcAfter.count, bcBefore.count, 'el ternero sigue con su único vínculo (sin fila puente nueva)');
  });

  // -- T7 / RCAP.10.3: cross-tenant. (a) caller sin rol en el tenant de la madre → 42501. (b) ternero de
  //    otro tenant (scopeado a la madre) → 23503 genérico (sin oráculo). --
  await t.test('T7 (RCAP.10.3): cross-tenant — sin rol en la madre → 42501; ternero de otro tenant → 23503 genérico', async () => {
    // (a) Madre de estB; userA (sin rol en estB) intenta vincular → 42501 (has_role_in(v_est) falla).
    const motherB = await makeMother(clientB, estB, rodeoB, 'xtB');
    const calfB = await makeCalf(clientB, estB, rodeoB, 'xtB');
    const evBBefore = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherB);

    const rA = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherB, p_calf_profile_id: calfB.profileId, p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assertRpcExists(rA.error);
    assert.notEqual(rA.error, null, 'userA sin rol en estB debe rebotar');
    assert.equal(rA.error.code, '42501', `debe ser 42501 (sin rol en el tenant de la madre): ${rA.error.message}`);
    // El mensaje no filtra datos de estB (anti-oráculo).
    assert.ok(!String(rA.error.message).includes(calfB.profileId), 'el error NO debe revelar el ternero de estB');
    // estB intacto: ningún parto nuevo para motherB.
    const evBAfter = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherB);
    assert.equal(evBAfter.count, evBBefore.count, 'estB queda intacto (sin parto fabricado)');

    // (b) Madre de estA (userA SÍ tiene rol) + ternero de estB → la derivación del ternero scopeada a estA NO
    //     lo encuentra → 23503 GENÉRICO (mismo error que "no existe", sin revelar que existe en estB).
    const motherA = await makeMother(clientA, estA, rodeoA, 'xtAmother');
    const rB = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherA, p_calf_profile_id: calfB.profileId, p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assertRpcExists(rB.error);
    assert.notEqual(rB.error, null, 'un ternero de otro tenant debe rebotar');
    assert.equal(rB.error.code, '23503', `debe ser 23503 genérico (ternero no encontrado en el tenant): ${rB.error.message}`);
    assert.ok(!String(rB.error.message).includes('estB') && !String(rB.error.message).includes(estB),
      'el 23503 NO debe revelar que el ternero existe en otro tenant (sin oráculo cross-tenant)');
    // motherA no recibió ningún parto (rebotó antes del insert).
    const { data: evA } = await admin.from('reproductive_events').select('id').eq('animal_profile_id', motherA);
    assert.equal(evA.length, 0, 'la madre de estA no recibió un parto con el ternero ajeno');
  });

  // -- T8 / RCAP.10.4: anti-IDOR. El tenant se deriva de las filas reales (la firma NO tiene establishment_id);
  //    un p_mother_profile_id ajeno rebota por authz, sin parentesco fabricado. --
  await t.test('T8 (RCAP.10.4): anti-IDOR — el cliente no pasa establishment_id; madre ajena rebota por authz, sin parentesco fabricado', async () => {
    // Madre de estB + ternero PROPIO de estA: userA intenta colgar SU ternero de la madre de estB. Rebota por
    // has_role_in(estB) = 42501 ANTES de tocar nada → no se fabrica parentesco. (El cliente NUNCA pasa el
    // establishment: la RPC lo deriva de la fila real de la madre.)
    const motherB = await makeMother(clientB, estB, rodeoB, 'idor');
    const calfA = await makeCalf(clientA, estA, rodeoA, 'idor');
    const bcBefore = await admin.from('birth_calves')
      .select('calf_profile_id', { count: 'exact', head: true }).eq('calf_profile_id', calfA.profileId);

    const r = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherB, p_calf_profile_id: calfA.profileId, p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assertRpcExists(r.error);
    assert.notEqual(r.error, null, 'la madre ajena debe rebotar por authz');
    assert.equal(r.error.code, '42501', `debe ser 42501 (authz sobre el tenant derivado de la madre): ${r.error.message}`);
    // El ternero de estA sigue SIN madre (no se fabricó parentesco cruzado).
    const bcAfter = await admin.from('birth_calves')
      .select('calf_profile_id', { count: 'exact', head: true }).eq('calf_profile_id', calfA.profileId);
    assert.equal(bcAfter.count, bcBefore.count, 'no se fabricó un vínculo cruzado para el ternero de estA');
  });

  // -- T9 / RCAP.10.5: idempotencia. Dos calls con el mismo p_client_op_id (misma madre) → un solo vínculo;
  //    la 2da devuelve el id existente con replay:true. --
  await t.test('T9 (RCAP.10.5): idempotencia — doble call con el mismo p_client_op_id → un solo vínculo (replay:true)', async () => {
    const motherId = await makeMother(clientA, estA, rodeoA, 'idemp');
    const calf = await makeCalf(clientA, estA, rodeoA, 'idemp');
    const opId = uuid();

    const r1 = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherId, p_calf_profile_id: calf.profileId, p_event_date: daysAgo(30), p_client_op_id: opId,
    });
    assertRpcExists(r1.error);
    assert.equal(r1.error, null, r1.error && r1.error.message);
    assert.equal(r1.data.replay, false, '1er call: replay:false');
    const birthId = r1.data.birth_event_id;

    // 2do call: MISMO client_op_id, MISMA madre (reintento at-least-once tras perder el ACK).
    const r2 = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherId, p_calf_profile_id: calf.profileId, p_event_date: daysAgo(30), p_client_op_id: opId,
    });
    assertRpcExists(r2.error);
    assert.equal(r2.error, null, r2.error && r2.error.message);
    assert.equal(r2.data.birth_event_id, birthId, 'el reintento devuelve el MISMO birth_event_id');
    assert.equal(r2.data.replay, true, 'el reintento marca replay:true (no-op idempotente)');

    // Estado real: UN solo evento de parto + UNA sola fila birth_calves (no 2).
    const ev = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherId).eq('event_type', 'birth');
    assert.equal(ev.count, 1, 'exactamente UN evento de parto (el reintento no creó un 2do)');
    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    assert.equal(bc.length, 1, 'exactamente UNA fila birth_calves (sin doble vínculo)');
  });

  // -- guard: ternero = madre → 23514 (RCAP.6.5). --
  await t.test('guard: p_calf_profile_id = p_mother_profile_id → 23514 (un animal no puede ser su propia cría)', async () => {
    const motherId = await makeMother(clientA, estA, rodeoA, 'self');
    const { error } = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherId, p_calf_profile_id: motherId, p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'ternero = madre debe rebotar');
    assert.equal(error.code, '23514', `debe ser 23514: ${error.message}`);
  });

  // -- guard de especie (criterio propio #4, defensa en profundidad): ternero de OTRA especie → 23514.
  //    El catálogo MVP solo tiene bovino ACTIVO; para tener un ternero de otra especie en estA activamos
  //    'equino' TEMPORALMENTE (admin) para sortear el trigger animals_validate_species (0019), creamos el
  //    animal, y RESTAURAMOS equino=inactive en finally. El flip solo afecta a 'equino' (ninguna otra suite
  //    lo usa) y se revierte siempre. --
  await t.test('guard de especie: ternero de otra especie (equino) → 23514 (no se liga un potrillo a una vaca)', async () => {
    const { data: sp } = await admin.from('species').select('id, active').eq('code', 'equino').single();
    if (!sp) { assert.ok(true, 'sin especie equino seedeada — guard no ejercitable en este entorno'); return; }
    const motherId = await makeMother(clientA, estA, rodeoA, 'species');
    const ternCat = await categoryId(clientA, rodeoA.systemId, 'ternero');  // categoría cría válida (bovino)
    const equinoAnimalId = uuid();
    const equinoProfileId = uuid();
    try {
      // Activar equino TEMPORALMENTE para que el trigger animals_validate_species permita el insert.
      await admin.from('species').update({ active: true }).eq('id', sp.id);
      // Animal de especie equino, perfil en rodeoA (cria) con categoría cría — inconsistente pero válido a
      // nivel de constraints; el RPC solo compara species_id (madre bovino vs ternero equino).
      const { error: aErr } = await clientA.from('animals').insert({
        id: equinoAnimalId, species_id: sp.id, sex: 'male', birth_date: daysAgo(30),
      });
      assert.equal(aErr, null, aErr && `insert animal equino: ${aErr.message}`);
      const { error: pErr } = await clientA.from('animal_profiles').insert({
        id: equinoProfileId, animal_id: equinoAnimalId, establishment_id: estA, rodeo_id: rodeoA.id,
        category_id: ternCat, status: 'active', idv: `${RUN_TAG}_lcm_equino`,
      });
      assert.equal(pErr, null, pErr && `insert profile equino: ${pErr.message}`);
    } finally {
      await admin.from('species').update({ active: sp.active }).eq('id', sp.id);  // RESTAURAR equino=inactive
    }

    const { error } = await clientA.rpc('link_calf_to_mother', {
      p_mother_profile_id: motherId, p_calf_profile_id: equinoProfileId, p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'un ternero de otra especie debe rebotar');
    assert.equal(error.code, '23514', `debe ser 23514 (especie distinta de la madre): ${error.message}`);
  });

  // -- grants: link_calf_to_mother NO invocable por anon (fail-closed, paridad con 0087/0089). --
  await t.test('grants: link_calf_to_mother NO invocable por anon (PostgREST sin JWT) — fail-closed', async () => {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await anonClient.rpc('link_calf_to_mother', {
      p_mother_profile_id: uuid(), p_calf_profile_id: uuid(), p_event_date: daysAgo(30), p_client_op_id: uuid(),
    });
    assert.notEqual(error, null, 'anon NO debe poder invocar link_calf_to_mother');
    assert.match(String(error.message + ' ' + (error.code || '')), /permission denied|not found|PGRST|42501|404/i);
  });
});

// =====================================================================
test('spec 02 delta #15 — register_birth extendido con rodeo del ternero (0115)', async (t) => {
  const uuid = () => require('node:crypto').randomUUID();
  function assertRpcExists(error) {
    if (error && error.code === 'PGRST202') {
      assert.fail('register_birth con la firma nueva (p_calf_rodeo_id/p_calf_idv) no existe en el remoto (0115 no aplicada) — este test no puede validar el comportamiento real.');
    }
  }

  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoA2, rodeoB;

  async function makeMother(idvSuffix) {
    const r = await createAnimal(clientA, {
      idv: `${RUN_TAG}_rbr_M_${idvSuffix}`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    return r.profile.id;
  }
  // calf_profile_id del único ternero creado por un birthId.
  async function calfRodeoOf(birthId) {
    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    assert.equal(bc.length, 1, 'el parto creó 1 ternero');
    const { data: prof } = await admin.from('animal_profiles').select('rodeo_id, idv').eq('id', bc[0].calf_profile_id).single();
    return prof;
  }

  await t.test('setup: estA con 2 rodeos cria (rodeoA, rodeoA2); estB con su rodeo cria', async () => {
    userA = await createTestUser('rbr_A');
    userB = await createTestUser('rbr_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} rbr_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} rbr_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_rbr_rA` });
    rodeoA2 = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_rbr_rA2` });  // 2do rodeo cria, mismo sistema
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_rbr_rB` });
  });

  // -- T10a / RCAP.10.6(a): p_calf_rodeo_id = NULL → ternero en el rodeo de la madre (regresión inalterada). --
  await t.test('T10a (RCAP.7.2): p_calf_rodeo_id ausente → ternero en el rodeo de la MADRE (regresión)', async () => {
    const motherId = await makeMother('nullrodeo');
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_calves: [{ calf_sex: 'female' }], p_client_op_id: uuid(),
    });
    assertRpcExists(error);
    assert.equal(error, null, error && error.message);
    const prof = await calfRodeoOf(birthId);
    assert.equal(prof.rodeo_id, rodeoA.id, 'sin p_calf_rodeo_id el ternero hereda el rodeo de la madre');
  });

  // -- T10b / RCAP.10.6(b): rodeo válido del campo (mismo sistema) → ternero en ESE rodeo. --
  await t.test('T10b (RCAP.7.4): p_calf_rodeo_id válido del campo (mismo sistema) → ternero en ESE rodeo', async () => {
    const motherId = await makeMother('validrodeo');
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_calves: [{ calf_sex: 'female' }],
      p_client_op_id: uuid(), p_calf_rodeo_id: rodeoA2.id,
    });
    assertRpcExists(error);
    assert.equal(error, null, error && error.message);
    const prof = await calfRodeoOf(birthId);
    assert.equal(prof.rodeo_id, rodeoA2.id, 'el ternero se crea en el rodeo elegido (mismo sistema, mismo campo)');
  });

  // -- T10c / RCAP.10.6(c) parte 1: rodeo de OTRO tenant → 23514. --
  await t.test('T10c (RCAP.7.3): p_calf_rodeo_id de OTRO tenant (rodeo de estB) → 23514', async () => {
    const motherId = await makeMother('xtrodeo');
    const evBefore = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherId);
    const { error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_calves: [{ calf_sex: 'female' }],
      p_client_op_id: uuid(), p_calf_rodeo_id: rodeoB.id,
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'un rodeo de otro tenant debe rebotar');
    assert.equal(error.code, '23514', `debe ser 23514 (rodeo no del tenant de la madre): ${error.message}`);
    // Atomicidad: NO se creó el parto (rebotó antes/durante el insert → rollback).
    const evAfter = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherId);
    assert.equal(evAfter.count, evBefore.count, 'no se creó el parto (rollback atómico)');
  });

  // -- T10c parte 2: rodeo de OTRO sistema (mismo campo) → 23514. El catálogo MVP solo tiene 'cria' ACTIVO;
  //    activamos 'invernada' TEMPORALMENTE (admin) para crear un rodeo de otro sistema en estA y lo
  //    RESTAURAMOS en finally. El flip solo afecta a 'invernada' (ninguna suite lo usa). --
  await t.test('T10c (RCAP.7.3): p_calf_rodeo_id de OTRO sistema productivo (mismo campo) → 23514', async () => {
    const { data: sp } = await admin.from('species').select('id').eq('code', 'bovino').single();
    const { data: sysInv } = await admin.from('systems_by_species')
      .select('id, active').eq('species_id', sp.id).eq('code', 'invernada').single();
    if (!sysInv) { assert.ok(true, 'sin sistema invernada seedeado — branch no ejercitable'); return; }
    const motherId = await makeMother('othersys');
    let invRodeoId;
    try {
      await admin.from('systems_by_species').update({ active: true }).eq('id', sysInv.id);  // activar invernada
      // Rodeo de invernada en estA (mismo campo de la madre, distinto sistema). Lo crea el owner (clientA).
      const { error: rErr } = await clientA.from('rodeos').insert({
        establishment_id: estA, name: `${RUN_TAG}_rbr_inv`, species_id: sp.id, system_id: sysInv.id,
      });
      assert.equal(rErr, null, rErr && `insert rodeo invernada: ${rErr.message}`);
      const { data: invR } = await clientA.from('rodeos').select('id')
        .eq('establishment_id', estA).eq('name', `${RUN_TAG}_rbr_inv`).single();
      invRodeoId = invR.id;
    } finally {
      await admin.from('systems_by_species').update({ active: sysInv.active }).eq('id', sysInv.id);  // RESTAURAR
    }
    const { error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_calves: [{ calf_sex: 'female' }],
      p_client_op_id: uuid(), p_calf_rodeo_id: invRodeoId,
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'un rodeo de otro sistema debe rebotar');
    assert.equal(error.code, '23514', `debe ser 23514 (rodeo de otro sistema productivo): ${error.message}`);
  });

  // -- LOW-1 (Gate 1): p_calf_idv → el ternero nace con ESE idv. --
  await t.test('LOW-1: p_calf_idv setea animal_profiles.idv del ternero creado', async () => {
    const motherId = await makeMother('calfidv');
    const idv = `${RUN_TAG}_rbr_calfIDV`;
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_calves: [{ calf_sex: 'female' }],
      p_client_op_id: uuid(), p_calf_idv: idv,
    });
    assertRpcExists(error);
    assert.equal(error, null, error && error.message);
    const prof = await calfRodeoOf(birthId);
    assert.equal(prof.idv, idv, 'el ternero creado lleva el IDV tipado (LOW-1)');
  });

  // -- LOW-2 (Gate 1): cap del tag del ternero (> 15 díg → 23514). --
  await t.test('LOW-2: calf_tag_electronic de más de 15 dígitos → 23514 (cap autoritativo del tag)', async () => {
    const motherId = await makeMother('tagcap');
    const evBefore = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherId);
    const { error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2),
      p_calves: [{ calf_sex: 'female', calf_tag_electronic: '1234567890123456' }],  // 16 díg → supera el cap
      p_client_op_id: uuid(),
    });
    assertRpcExists(error);
    assert.notEqual(error, null, 'un tag de más de 15 díg debe rebotar');
    assert.equal(error.code, '23514', `debe ser 23514 (cap del tag): ${error.message}`);
    const evAfter = await admin.from('reproductive_events')
      .select('id', { count: 'exact', head: true }).eq('animal_profile_id', motherId);
    assert.equal(evAfter.count, evBefore.count, 'no se creó el parto (rollback atómico del cap)');
  });

  // -- regresión: parto normal SIN params nuevos (3 args) → comportamiento as-built (firma resuelve por defaults). --
  await t.test('regresión: register_birth (3 args, sin params nuevos) → parto normal inalterado, ternero en rodeo de la madre', async () => {
    const motherId = await makeMother('regress');
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }],
    });
    assertRpcExists(error);
    assert.equal(error, null, error && error.message);
    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    assert.equal(bc.length, 2, 'mellizos = 2 terneros (as-built)');
    for (const row of bc) {
      const { data: prof } = await admin.from('animal_profiles').select('rodeo_id, idv').eq('id', row.calf_profile_id).single();
      assert.equal(prof.rodeo_id, rodeoA.id, 'sin p_calf_rodeo_id los terneros van al rodeo de la madre');
      assert.equal(prof.idv, null, 'sin p_calf_idv los terneros nacen sin idv (as-built)');
    }
  });
});

// =====================================================================
// spec 02 — delta PARTO: CARAVANA VISUAL DEL TERNERO POR CRÍA (parto-caravana-visual-por-ternero, PCV.4/5/6)
// + delta IDENTIFICADORES UNIFICADOS (IDU.1.4/2.2). El idv del ternero al parto se computa POR CRÍA (leyendo
// `calf_idv` de cada elemento de `p_calves`), con precedencia per-calf sobre el top-level `p_calf_idv` (cría al
// pie #15). El fallback `visual_id_alt` se ELIMINÓ (0122, IDU.2.2): una cría sin tag ni idv persiste con AMBOS
// NULL, SIN 23514 (el trigger de completitud animal_profiles_identity_check se dropeó en la misma migración).
//
// Ambas migraciones (0121 idv-por-cría, 0122 sin-fallback) están APLICADAS al remoto. Firma 6-arg intacta.
// =====================================================================
test('spec 02 delta parto — register_birth idv POR CRÍA (0121) + sin fallback visual (0122, IDU.2.2)', async (t) => {
  const uuid = () => require('node:crypto').randomUUID();

  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoB;

  async function makeMother(idvSuffix) {
    const r = await createAnimal(clientA, {
      idv: `${RUN_TAG}_pcv_M_${idvSuffix}`, sex: 'female', birthDate: daysAgo(900),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona_prenada',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    return r.profile.id;
  }
  // Perfiles de los terneros de un parto → { idv, tag_electronic } por cría (para las matrices).
  async function calvesOf(birthId) {
    const { data: bc } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    const out = [];
    for (const row of bc) {
      const { data: prof } = await admin.from('animal_profiles')
        .select('idv, animals(tag_electronic)').eq('id', row.calf_profile_id).single();
      out.push({ idv: prof.idv, tag: prof.animals?.tag_electronic ?? null });
    }
    return out;
  }
  // Estado server-side del parto de una madre (contraprueba del rollback atómico): eventos birth + terneros.
  async function birthState(motherId) {
    const { data: ev } = await admin.from('reproductive_events')
      .select('id').eq('animal_profile_id', motherId).eq('event_type', 'birth').is('deleted_at', null);
    const eventIds = (ev ?? []).map((e) => e.id);
    let calfCount = 0;
    if (eventIds.length > 0) {
      const { count } = await admin.from('birth_calves').select('*', { count: 'exact', head: true }).in('birth_event_id', eventIds);
      calfCount = count ?? 0;
    }
    return { eventCount: eventIds.length, calfCount };
  }

  await t.test('setup: userA owner de estA (rodeo cria); userB owner de estB', async () => {
    userA = await createTestUser('pcv_A');
    userB = await createTestUser('pcv_B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} pcv_estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} pcv_estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_pcv_rA` });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_pcv_rB` });
  });

  // -- PCV.5.1/5.2: mellizos con idv DISTINTO cada uno → ambos persisten con SU idv. --
  await t.test('PCV.5.1/5.2: mellizos con calf_idv distinto → ambos animal_profiles.idv persisten', async () => {
    const motherId = await makeMother('twindistinct');
    const idv0 = `${RUN_TAG}_pcv_calfA`;
    const idv1 = `${RUN_TAG}_pcv_calfB`;
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calves: [{ calf_sex: 'female', calf_idv: idv0 }, { calf_sex: 'male', calf_idv: idv1 }],
    });
    assert.equal(error, null, error && error.message);
    const calves = await calvesOf(birthId);
    assert.equal(calves.length, 2, 'mellizos = 2 terneros');
    const idvs = calves.map((c) => c.idv).sort();
    assert.deepEqual(idvs, [idv0, idv1].sort(), 'cada mellizo persiste con SU idv independiente (PCV.5.2)');
    assert.ok(calves.every((c) => c.tag === null), 'sin tag → tag null en ambos mellizos');
  });

  // -- PCV.5.3: idv DUPLICADO en el MISMO parto (dos crías, mismo calf_idv) → 23505 + rollback atómico (0/0). --
  await t.test('PCV.5.3: dos mellizos con el MISMO calf_idv → 23505 + rollback atómico (0 eventos / 0 terneros)', async () => {
    const motherId = await makeMother('twindup');
    const dupIdv = `${RUN_TAG}_pcv_dup`;
    const before = await birthState(motherId);
    const { error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calves: [{ calf_sex: 'female', calf_idv: dupIdv }, { calf_sex: 'male', calf_idv: dupIdv }],
    });
    assert.notEqual(error, null, 'dos crías con el mismo idv debe rebotar');
    assert.equal(error.code, '23505', `debe ser 23505 (índice parcial animal_profiles_idv_unique): ${error.message}`);
    const after = await birthState(motherId);
    assert.equal(after.eventCount, before.eventCount, 'rollback atómico: NO se creó el evento de parto');
    assert.equal(after.calfCount, before.calfCount, 'rollback atómico: NO se creó ningún ternero');
  });

  // -- PCV.5.3: idv que COLISIONA con el rebaño ((establishment_id, idv) ya existe) → 23505 + rollback. --
  await t.test('PCV.5.3: calf_idv que colisiona con un idv ya usado en el campo → 23505 + rollback atómico', async () => {
    // Animal pre-existente en estA con un idv conocido.
    const existingIdv = `${RUN_TAG}_pcv_herd`;
    const pre = await createAnimal(clientA, {
      idv: existingIdv, sex: 'female', birthDate: daysAgo(600),
      rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona',
    });
    assert.equal(pre.error, undefined, pre.error && pre.error.message);

    const motherId = await makeMother('herdcollide');
    const before = await birthState(motherId);
    const { error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calves: [{ calf_sex: 'female', calf_idv: existingIdv }],  // choca con el pre-existente
    });
    assert.notEqual(error, null, 'un idv ya usado en el campo debe rebotar');
    assert.equal(error.code, '23505', `debe ser 23505 (idv ya existe en (establishment_id, idv)): ${error.message}`);
    const after = await birthState(motherId);
    assert.equal(after.eventCount, before.eventCount, 'rollback atómico: sin evento de parto');
    assert.equal(after.calfCount, before.calfCount, 'rollback atómico: sin ternero');
  });

  // -- IDU.1.4/2.2 (ex PCV.2.3/2.4): ternero SIN idv y SIN tag → PERSISTE con idv/tag AMBOS NULL, SIN 23514.
  //    El fallback visual_id_alt se eliminó (0122); el trigger de completitud animal_profiles_identity_check ya
  //    no existe → la cría both-null es válida. La fila-puente birth_calves se crea. --
  await t.test('IDU.1.4/2.2: ternero sin idv ni tag → persiste con idv/tag NULL (sin 23514) + birth_calves creada', async () => {
    const motherId = await makeMother('nocaravana');
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calves: [{ calf_sex: 'female' }],  // ni calf_idv ni calf_tag_electronic → 0 identificadores
    });
    assert.equal(error, null, `un ternero sin ninguna caravana debe crearse sin 23514 (IDU.1.4): ${error && error.message}`);
    const calves = await calvesOf(birthId);
    assert.equal(calves.length, 1, 'se creó el ternero');
    assert.equal(calves[0].idv, null, 'sin idv → idv null (sin fallback, IDU.2.2)');
    assert.equal(calves[0].tag, null, 'sin tag → tag null');
    // la fila-puente birth_calves existe (el parto quedó bien armado pese a 0 identificadores en la cría).
    const { count: bcCount } = await admin.from('birth_calves')
      .select('*', { count: 'exact', head: true }).eq('birth_event_id', birthId);
    assert.equal(bcCount, 1, 'birth_calves creada para la cría sin caravana (IDU.1.4)');
  });

  // -- PCV.4.5: ternero con idv pero SIN tag → persiste con su idv (tag null). --
  await t.test('PCV.4.5: ternero con idv sin tag → persiste con su idv (tag null)', async () => {
    const motherId = await makeMother('idvnotag');
    const idv = `${RUN_TAG}_pcv_idvnotag`;
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calves: [{ calf_sex: 'male', calf_idv: idv }],
    });
    assert.equal(error, null, error && error.message);
    const calves = await calvesOf(birthId);
    assert.equal(calves[0].idv, idv, 'el ternero lleva su idv');
    assert.equal(calves[0].tag, null, 'sin tag → tag null');
  });

  // -- PCV.4.3: precedencia per-calf sobre el top-level. calf_idv del elemento GANA sobre p_calf_idv. --
  await t.test('PCV.4.3: el calf_idv del elemento GANA sobre el p_calf_idv top-level (precedencia per-calf)', async () => {
    const motherId = await makeMother('precedence');
    const perCalf = `${RUN_TAG}_pcv_perCalf`;
    const topLevel = `${RUN_TAG}_pcv_topLevel`;
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calf_idv: topLevel,  // top-level presente…
      p_calves: [{ calf_sex: 'female', calf_idv: perCalf }],  // …pero el elemento trae el suyo → gana el del elemento
    });
    assert.equal(error, null, error && error.message);
    const calves = await calvesOf(birthId);
    assert.equal(calves[0].idv, perCalf, 'el calf_idv del elemento tiene precedencia sobre p_calf_idv (PCV.4.3)');
  });

  // -- PCV.6.1 (T4): backward-compat CRÍA AL PIE (#15). p_calf_idv top-level, SIN calf_idv en el elemento
  //    (1 cría) → el coalesce cae al p_calf_idv y el ternero se crea con ese idv. --
  await t.test('PCV.6.1: cría al pie (#15) — p_calf_idv top-level, sin calf_idv en el elemento → ternero con ese idv', async () => {
    const motherId = await makeMother('criaalpie');
    const idv = `${RUN_TAG}_pcv_criaalpie`;
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calf_idv: idv,  // top-level (camino cría al pie), sin calf_idv en el elemento
      p_calves: [{ calf_sex: 'female' }],
    });
    assert.equal(error, null, error && error.message);
    const calves = await calvesOf(birthId);
    assert.equal(calves[0].idv, idv, 'el ternero cae por el coalesce al p_calf_idv (backward-compat #15, PCV.6.1)');
    assert.equal(calves[0].tag, null, 'sin tag → tag null');
  });

  // -- PCV.4.6/IDU.1.4: regresión — mellizos SIN idv ni tag (parto normal) → 2 terneros, ambos persisten con
  //    idv/tag NULL (sin fallback, sin 23514). El CREATE OR REPLACE no rompió la creación de mellizos ni la
  //    herencia de rodeo. --
  await t.test('PCV.4.6/IDU.1.4: regresión — mellizos sin caravana → 2 terneros persisten (idv/tag null), rodeo de la madre', async () => {
    const motherId = await makeMother('regressplain');
    const { data: birthId, error } = await clientA.rpc('register_birth', {
      p_mother_profile_id: motherId, p_event_date: daysAgo(2), p_client_op_id: uuid(),
      p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }],
    });
    assert.equal(error, null, `mellizos sin caravana deben persistir sin 23514 (IDU.1.4): ${error && error.message}`);
    const calves = await calvesOf(birthId);
    assert.equal(calves.length, 2, 'mellizos = 2 terneros (as-built)');
    assert.ok(calves.every((c) => c.idv === null), 'sin idv → idv null (sin fallback, IDU.2.2)');
    assert.ok(calves.every((c) => c.tag === null), 'sin tag → tag null');
  });
});

test('cleanup', async () => {
  await cleanup();
});
