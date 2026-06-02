// e2e/helpers/admin.ts — fixtures de la suite E2E contra el Supabase REMOTO.
//
// REUSA el patrón de supabase/tests/rls/run.cjs:
//   - cliente admin (service_role, sin auto-refresh ni persistencia de sesión),
//   - createTestUser pre-confirmado (email_confirm:true) con email NAMESPACED,
//   - tracking de ids creados + cleanup robusto (borra establishments con CASCADE y users).
//
// DB COMPARTIDA: el remoto se usa también para el testing manual de Raf. Por eso:
//   - Emails namespaced bajo @rafaq-e2e.test con un RUN_TAG único por corrida (no colisiona
//     con los @rafaq-test.local de las suites RLS ni con datos reales).
//   - Todo lo creado se trackea y se borra (global-teardown.ts hace el barrido final).
//   - Nunca tocamos ni leemos datos que no hayamos creado nosotros.
//
// supabase-js vive en app/node_modules; `ws` aporta WebSocket para realtime-js en Node 20
// (mismo workaround que run.cjs, aunque la suite E2E no usa realtime, supabase-js lo exige
// al construir el cliente con realtime por default).

import { createClient as createClientRaw, type SupabaseClient } from '@supabase/supabase-js';
import WS from 'ws';
import { randomUUID } from 'node:crypto';

import { getE2EEnv } from './env';

const { supabaseUrl, anonKey, serviceRoleKey } = getE2EEnv();

// Namespace + marca de corrida única (no choca entre corridas paralelas ni con el
// testing manual / las suites RLS).
export const E2E_NAMESPACE = 'rafaq-e2e.test';
export const RUN_TAG = `e2e_${Date.now()}_${randomUUID().slice(0, 8)}`;
export const TEST_PASSWORD = 'E2ePassword!Aa1';

function makeClient(key: string): SupabaseClient {
  return createClientRaw(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Node 20 no tiene WebSocket global; realtime-js lo necesita al construir el cliente.
    realtime: { transport: WS as unknown as typeof WebSocket },
  });
}

/** Cliente admin (service_role) — bypassea RLS. SOLO para fixtures/cleanup, NUNCA en el browser. */
export const admin = makeClient(serviceRoleKey);

// Tracking para cleanup. Process-global (compartido entre specs en el mismo worker).
const createdUserIds = new Set<string>();
const createdEstablishmentIds = new Set<string>();

export type TestUser = {
  id: string;
  email: string;
  password: string;
};

/**
 * Crea un usuario de test PRE-CONFIRMADO (email_confirm:true) vía admin API. El email queda
 * bajo el namespace E2E con el RUN_TAG, único por usuario. Lo trackeamos para borrarlo al final.
 *
 * `name` se guarda en user_metadata (el trigger de profile lo copia a public.users.name, igual
 * que en signup real → el saludo de la home usa ese nombre).
 */
export async function createTestUser(
  label: string,
  name = `E2E ${label}`,
): Promise<TestUser> {
  const email = `${RUN_TAG}_${label}_${randomUUID().slice(0, 6)}@${E2E_NAMESPACE}`.toLowerCase();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw new Error(`createTestUser(${label}): ${error.message}`);
  createdUserIds.add(data.user.id);
  return { id: data.user.id, email, password: TEST_PASSWORD };
}

/**
 * Setea el teléfono del perfil del usuario (public.users.phone) vía service_role. Útil para
 * SALTEAR el gate de teléfono (R3.8) cuando un test quiere ir directo al form de crear campo
 * sin pasar por la pantalla de teléfono. Si el test QUIERE ejercitar el gate, no se llama.
 */
export async function setUserPhone(userId: string, phone: string): Promise<void> {
  const { error } = await admin.from('users').update({ phone }).eq('id', userId);
  if (error) throw new Error(`setUserPhone(${userId}): ${error.message}`);
}

/**
 * Crea un establishment de fixture vía service_role (bypassea RLS) y le asigna al `ownerId`
 * el rol owner ACTIVO. NO ejercita el flujo de UI de crear-campo (eso lo prueba
 * establishments.spec.ts); esto es SOLO para sembrar el estado de partida de un test (ej.
 * "un usuario que ya tiene 2 campos"). El nombre va namespaced con el RUN_TAG.
 *
 * Nota: el trigger 0011 (AFTER INSERT) crea el owner derivado de auth.uid(); con
 * service_role auth.uid() es null, así que el trigger early-returns y NO inserta nada
 * (verificado en 0011_establishment_auto_owner.sql). Insertamos el owner nosotros con un
 * insert plano. (El índice único de R4.3 es PARCIAL — `where active = true` —, no apto para
 * onConflict de PostgREST; como el campo es recién creado no hay rol previo del par, así que
 * el insert plano no colisiona.)
 */
export async function seedEstablishment(
  ownerId: string,
  name: string,
  opts: { province?: string; city?: string | null } = {},
): Promise<string> {
  const fullName = `${RUN_TAG} ${name}`;
  const { data: ins, error: insErr } = await admin
    .from('establishments')
    .insert({
      name: fullName,
      province: opts.province ?? 'Buenos Aires',
      city: opts.city ?? null,
    })
    .select('id')
    .single();
  if (insErr) throw new Error(`seedEstablishment insert(${name}): ${insErr.message}`);
  const estId = ins.id as string;
  createdEstablishmentIds.add(estId);

  // Rol owner activo (insert plano — el campo es nuevo, no hay rol previo del par).
  const { error: roleErr } = await admin
    .from('user_roles')
    .insert({ user_id: ownerId, establishment_id: estId, role: 'owner', active: true });
  if (roleErr) throw new Error(`seedEstablishment role(${name}): ${roleErr.message}`);

  return estId;
}

/**
 * Crea un rodeo de fixture (bovino/cría) para un establishment, vía service_role (bypassea RLS).
 * NECESARIO desde C1: el RootGate bloquea TODA la app si el campo activo tiene 0 rodeos (empty-state
 * de bloqueo total, R2.6) → un usuario sembrado con un campo SIN rodeo cae en el wizard "Creá tu
 * primer rodeo" en vez de aterrizar en home/Más. Los tests que necesitan llegar a home (perfil,
 * cuenta, logout, invitaciones) deben sembrar también un rodeo. El trigger 0018 pre-pobla la config.
 * Resuelve species/system por `code` (no hardcodea UUIDs); el nombre va namespaced con el RUN_TAG.
 */
export async function seedRodeo(
  establishmentId: string,
  name = 'Rodeo general',
  opts: { speciesCode?: string; systemCode?: string } = {},
): Promise<string> {
  const speciesCode = opts.speciesCode ?? 'bovino';
  const systemCode = opts.systemCode ?? 'cria';

  const { data: species, error: spErr } = await admin
    .from('species')
    .select('id')
    .eq('code', speciesCode)
    .maybeSingle();
  if (spErr) throw new Error(`seedRodeo species: ${spErr.message}`);
  if (!species) throw new Error(`seedRodeo: especie "${speciesCode}" no encontrada en el catálogo`);

  const { data: system, error: sysErr } = await admin
    .from('systems_by_species')
    .select('id')
    .eq('species_id', species.id)
    .eq('code', systemCode)
    .maybeSingle();
  if (sysErr) throw new Error(`seedRodeo system: ${sysErr.message}`);
  if (!system) throw new Error(`seedRodeo: sistema "${systemCode}" no encontrado para ${speciesCode}`);

  const { data: ins, error: insErr } = await admin
    .from('rodeos')
    .insert({
      establishment_id: establishmentId,
      name: `${RUN_TAG} ${name}`,
      species_id: species.id,
      system_id: system.id,
    })
    .select('id')
    .single();
  if (insErr) throw new Error(`seedRodeo insert: ${insErr.message}`);
  // El rodeo se borra en cascada al borrar el establishment (FK on delete cascade, 0017) → el
  // cleanup de establishments ya lo cubre, no hace falta trackearlo aparte.
  return ins.id as string;
}

/**
 * Conveniencia: siembra un establishment con rol owner activo PARA `ownerId` Y un rodeo bovino/cría,
 * de una. Es el estado de partida más común desde C1 (un usuario que aterriza en home, no en el
 * bloqueo total de rodeo). Devuelve { establishmentId, rodeoId, systemId }.
 */
export async function seedEstablishmentWithRodeo(
  ownerId: string,
  name: string,
  opts: { province?: string; city?: string | null } = {},
): Promise<{ establishmentId: string; rodeoId: string }> {
  const establishmentId = await seedEstablishment(ownerId, name, opts);
  const rodeoId = await seedRodeo(establishmentId);
  return { establishmentId, rodeoId };
}

/**
 * Siembra un animal (animals + animal_profiles) en un rodeo, vía service_role (bypassea RLS).
 * Necesario para el test "buscar un animal EXISTENTE → ficha" (C2). Resuelve species/system/category
 * por code (no hardcodea UUIDs). La categoría inicial se computa simple por sexo (como el alta real):
 * macho → torito, hembra → vaquillona (sin fecha de nacimiento). El animal se borra en cascada al
 * borrar el establishment (FK on delete cascade) → el cleanup de establishments ya lo cubre.
 *
 * Devuelve el animal_profile_id (lo que la ficha y la lista usan como key).
 */
export async function seedAnimal(
  establishmentId: string,
  rodeoId: string,
  opts: { idv?: string | null; visualAlt?: string | null; tag?: string | null; sex?: 'male' | 'female' } = {},
): Promise<string> {
  const sex = opts.sex ?? 'female';

  // species/system del rodeo.
  const { data: rodeo, error: rErr } = await admin
    .from('rodeos')
    .select('species_id, system_id')
    .eq('id', rodeoId)
    .single();
  if (rErr) throw new Error(`seedAnimal rodeo: ${rErr.message}`);

  const categoryCode = sex === 'male' ? 'torito' : 'vaquillona';
  const { data: cat, error: cErr } = await admin
    .from('categories_by_system')
    .select('id')
    .eq('system_id', rodeo.system_id)
    .eq('code', categoryCode)
    .single();
  if (cErr) throw new Error(`seedAnimal category: ${cErr.message}`);

  const animalId = randomUUID();
  const animalPayload: Record<string, unknown> = { id: animalId, sex, species_id: rodeo.species_id };
  if (opts.tag) animalPayload.tag_electronic = opts.tag;
  const { error: aErr } = await admin.from('animals').insert(animalPayload);
  if (aErr) throw new Error(`seedAnimal animals: ${aErr.message}`);

  const profileId = randomUUID();
  const profilePayload: Record<string, unknown> = {
    id: profileId,
    animal_id: animalId,
    establishment_id: establishmentId,
    rodeo_id: rodeoId,
    category_id: cat.id,
    status: 'active',
  };
  if (opts.idv) profilePayload.idv = opts.idv;
  if (opts.visualAlt) profilePayload.visual_id_alt = opts.visualAlt;
  const { error: pErr } = await admin.from('animal_profiles').insert(profilePayload);
  if (pErr) throw new Error(`seedAnimal animal_profiles: ${pErr.message}`);

  return profileId;
}

/**
 * Agrega a `userId` como MIEMBRO ACTIVO (no-owner) de un establishment existente, vía service_role.
 * Útil para sembrar un usuario que aterriza en HOME (estado 'active') pero NO es dueño único de
 * ningún campo (su baja de cuenta NO se bloquea). El rol default es 'field_operator'. (El índice
 * único de R4.3 es parcial `where active`, no apto para onConflict; el par es nuevo → insert plano.)
 */
export async function addMember(
  userId: string,
  establishmentId: string,
  role: 'field_operator' | 'veterinarian' = 'field_operator',
): Promise<void> {
  const { error } = await admin
    .from('user_roles')
    .insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`addMember(${userId}): ${error.message}`);
}

/**
 * Lee el token de la invitación PENDIENTE más reciente de un establishment, vía service_role
 * (las invitations son owner-only por RLS desde el browser, pero el admin las ve todas). Es MÁS
 * ESTABLE que scrapear el ShareLink del DOM (el accept_url se trunca con ellipsis en la UI). El
 * invitado navega luego a `/invite?token=<token>`. Reintenta unas veces por si la fila tarda en
 * verse tras crear la invitación desde la UI (round-trip al edge invite_user).
 */
export async function getLatestInvitationToken(
  establishmentId: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<string> {
  const tries = opts.tries ?? 10;
  const delayMs = opts.delayMs ?? 500;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('invitations')
      .select('token, created_at')
      .eq('establishment_id', establishmentId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`getLatestInvitationToken: ${error.message}`);
    const token = data?.[0]?.token as string | undefined;
    if (token) return token;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `getLatestInvitationToken(${establishmentId}): no apareció ninguna invitación pendiente tras ${tries} intentos.`,
  );
}

/** Permite que un test trackee para cleanup un establishment creado por la UI (por nombre exacto). */
export async function trackEstablishmentsByNameLike(namePrefix: string): Promise<string[]> {
  const { data, error } = await admin
    .from('establishments')
    .select('id')
    .like('name', `${namePrefix}%`);
  if (error) throw new Error(`trackEstablishmentsByNameLike: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id as string);
  for (const id of ids) createdEstablishmentIds.add(id);
  return ids;
}

/** Trackea explícitamente un id (para cleanup). */
export function trackEstablishment(id: string): void {
  createdEstablishmentIds.add(id);
}

/**
 * Cleanup robusto: borra TODO lo creado por esta corrida. Establishments primero (CASCADE
 * limpia user_roles e invitations), luego los users vía admin API. Best-effort: loguea
 * errores pero no tira, para no dejar usuarios colgados si falla el borrado de un establishment.
 *
 * Además barre por namespace: cualquier establishment cuyo nombre arranque con el RUN_TAG
 * (por si un test creó uno por UI y no lo trackeó) y cualquier usuario @rafaq-e2e.test de ESTA
 * corrida. NO toca datos de otras corridas ni del testing manual.
 */
export async function cleanupAll(): Promise<void> {
  // Barrido por RUN_TAG en el nombre (campos creados por UI que no se trackearon explícitamente).
  try {
    const { data } = await admin
      .from('establishments')
      .select('id')
      .like('name', `${RUN_TAG}%`);
    for (const r of data ?? []) createdEstablishmentIds.add(r.id as string);
  } catch (e) {
    console.error('[e2e cleanup] sweep establishments:', (e as Error).message);
  }

  if (createdEstablishmentIds.size > 0) {
    const ids = [...createdEstablishmentIds];
    const { error } = await admin.from('establishments').delete().in('id', ids);
    if (error) console.error('[e2e cleanup] establishments:', error.message);
    else createdEstablishmentIds.clear();
  }

  for (const uid of [...createdUserIds]) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`[e2e cleanup] user ${uid}:`, error.message);
    else createdUserIds.delete(uid);
  }
}

/** Cliente anon (key pública) — para chequeos auxiliares server-side desde el test si hiciera falta. */
export function anonClient(): SupabaseClient {
  return makeClient(anonKey);
}
