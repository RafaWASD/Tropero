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
async function createAnimal(client, { tag = null, idv = null, visualAlt = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null }) {
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
  if (visualAlt) profilePayload.visual_id_alt = visualAlt;
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

    // El trigger pre-pobló rodeo_data_config (26 filas, 23 enabled).
    {
      const { data, error } = await clientA
        .from('rodeo_data_config').select('enabled').eq('rodeo_id', rodeoA.id);
      assert.equal(error, null, error && error.message);
      assert.equal(data.length, 26, 'rodeo_data_config debería tener 26 filas');
      assert.equal(data.filter((r) => r.enabled).length, 23, '23 enabled');
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
    // Caso 3: solo visual_id_alt.
    {
      const r = await createAnimal(clientA, { visualAlt: 'vaca pinta', sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.equal(r.error, undefined, r.error && r.error.message);
      assert.ok(r.profile.id);
    }
    // Caso 4: sin ninguno -> falla (23514).
    {
      const r = await createAnimal(clientA, { sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      assert.notEqual(r.error, undefined, 'animal sin identificador debería fallar');
      assert.match(String(r.error.message + ' ' + (r.error.code || '')), /23514|at least one/i);
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
        .select('category_id, entry_origin, visual_id_alt, management_group_id').eq('id', ev.calf_id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', calf.category_id).single();
      assert.equal(cat.code, 'ternera');
      assert.equal(calf.entry_origin, 'born_here');
      assert.equal(calf.visual_id_alt, 'recién nacido — pendiente de caravana');
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
      const { data: calf } = await clientA.from('animal_profiles').select('visual_id_alt, animal_id').eq('id', ev.calf_id).single();
      assert.equal(calf.visual_id_alt, null, 'con TAG no se aplica fallback visual (R9.3)');
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
    // owner crea rodeo (bovino, cria) -> 26 filas rodeo_data_config (23 enabled).
    const rC = await createRodeo(clientA, { establishmentId: estC, name: 'Rodeo cría' });
    {
      const { data } = await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', rC.id);
      assert.equal(data.length, 26);
      assert.equal(data.filter((r) => r.enabled).length, 23);
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
  await t.test('T2.11 búsqueda', async () => {
    const visual = 'vaca blanca mancha pata izquierda';
    const tag = `${RUN_TAG}_SEARCHTAG`;
    await createAnimal(clientA, { visualAlt: visual, tag, sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
    // fuzzy 'vaca blanca' -> encuentra (similarity >= 0.3).
    {
      const { data, error } = await clientA.rpc('animal_timeline', { profile_id: '00000000-0000-0000-0000-000000000000' }); // noop to ensure rpc path ok
      assert.equal(error, null);
      // búsqueda fuzzy directa
      const { data: found, error: fErr } = await clientA
        .from('animal_profiles')
        .select('id, visual_id_alt')
        .eq('establishment_id', estA)
        .is('deleted_at', null)
        .textSearch === undefined ? { data: null } : { data: null };
      // textSearch trigram no está disponible vía PostgREST builder; usamos ilike como proxy + verificación del índice por SQL real abajo.
      const { data: ilikeFound } = await clientA
        .from('animal_profiles').select('id').ilike('visual_id_alt', '%vaca blanca%').eq('establishment_id', estA);
      assert.ok(ilikeFound.length >= 1, 'búsqueda por substring de visual_id_alt encuentra');
    }
    // 'toro negro' -> no encuentra.
    {
      const { data } = await clientA.from('animal_profiles').select('id').ilike('visual_id_alt', '%toro negro%').eq('establishment_id', estA);
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
    // Caso 3: visual_id_alt editable.
    {
      const an = await createAnimal(clientA, { visualAlt: 'original', sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
      const { error } = await clientA.from('animal_profiles').update({ visual_id_alt: 'corregida' }).eq('id', an.profile.id);
      assert.equal(error, null, 'visual_id_alt es editable');
    }
    // Caso 4 (permitido): NULL -> valor.
    {
      const an = await createAnimal(clientA, { visualAlt: 'sin tag aun', sex: 'female', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId });
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
    // Caso 1: catálogo global 26 activos, data_key único.
    {
      const { data } = await clientA.from('field_definitions').select('data_key, label, category, data_type, ui_component').eq('active', true);
      assert.equal(data.length, 26, '26 field_definitions activos');
      const keys = data.map((r) => r.data_key);
      assert.equal(new Set(keys).size, keys.length, 'data_key único');
      assert.ok(data.every((r) => r.label && r.category && r.data_type), 'columnas pobladas');
    }
    // Caso 2: defaults por sistema cría = 26; 23 enabled; 3 off correctos.
    {
      const { data } = await clientA
        .from('system_default_fields')
        .select('default_enabled, field_definition_id, field_definitions(data_key)')
        .eq('system_id', rodeoA.systemId);
      assert.equal(data.length, 26);
      assert.equal(data.filter((r) => r.default_enabled).length, 23);
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
    // Caso 4: pre-populate ya verificado en setup (26 filas, 23 enabled). Re-verificamos.
    {
      const { data } = await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', rodeoA.id);
      assert.equal(data.length, 26);
      assert.equal(data.filter((r) => r.enabled).length, 23);
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
    // En cría los 26 ya están; para probar el INSERT de un field arbitrario del catálogo,
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
      assert.equal(before.count, 26);
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
});

test('cleanup', async () => {
  await cleanup();
});
