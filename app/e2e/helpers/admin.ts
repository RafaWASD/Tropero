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
 * Setea el teléfono del perfil del usuario vía service_role. Útil para SALTEAR el gate de teléfono
 * (R3.8) cuando un test quiere ir directo al form de crear campo sin pasar por la pantalla de
 * teléfono. Si el test QUIERE ejercitar el gate, no se llama.
 *
 * Spec 14: el `phone` se separó de `public.users` a `public.user_private` (PII de contacto
 * self-only). El service_role bypassa RLS; escribimos directo en user_private (la fila la creó el
 * trigger de signup junto con users, así que un update por user_id basta).
 */
export async function setUserPhone(userId: string, phone: string): Promise<void> {
  const { error } = await admin.from('user_private').update({ phone }).eq('user_id', userId);
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
  opts: {
    idv?: string | null;
    visualAlt?: string | null;
    tag?: string | null;
    sex?: 'male' | 'female';
    /** code de categoría explícito (default torito/vaquillona por sexo). Para sembrar una categoría manual. */
    categoryCode?: string;
    /** category_override del perfil (default false). true = categoría FIJADA manualmente (C6). */
    categoryOverride?: boolean;
    /** birth_date ISO 'YYYY-MM-DD' del animal (opcional). */
    birthDate?: string | null;
    /**
     * Estado de castración inicial (default false). Setea `animals.is_castrated` (fuente de verdad
     * física, 0060); el trigger `animal_profiles_force_is_castrated` (0084) lo COPIA al perfil en el
     * INSERT → el espejo C6 y la denorm nacen fieles. Para sembrar un animal ya-castrado (spec 10).
     */
    isCastrated?: boolean;
    /**
     * Flag ⭐ "futuro torito" del perfil (`animal_profiles.future_bull`, 0085, default false). Solo
     * machos no-castrados (el trigger de normalización lo fuerza a false si no aplica). Para sembrar
     * un ternero ⭐ que la castración masiva pre-tilda SIN marcar por default (spec 10 R11.3).
     */
    futureBull?: boolean;
  } = {},
): Promise<string> {
  const sex = opts.sex ?? 'female';

  // species/system del rodeo.
  const { data: rodeo, error: rErr } = await admin
    .from('rodeos')
    .select('species_id, system_id')
    .eq('id', rodeoId)
    .single();
  if (rErr) throw new Error(`seedAnimal rodeo: ${rErr.message}`);

  const categoryCode = opts.categoryCode ?? (sex === 'male' ? 'torito' : 'vaquillona');
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
  if (opts.birthDate) animalPayload.birth_date = opts.birthDate;
  // is_castrated en `animals` (0060) — el force-on-INSERT del perfil (0084) lo copia → el perfil nace fiel.
  if (opts.isCastrated) animalPayload.is_castrated = true;
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
  if (opts.categoryOverride) profilePayload.category_override = true;
  // future_bull (0085): solo machos no-castrados; el trigger de normalización lo fuerza a false si no aplica.
  if (opts.futureBull) profilePayload.future_bull = true;
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

/**
 * ORÁCULO de persistencia server-side de un alta (Run create-animal-rpc, 15-powersync). Pollea vía
 * service_role hasta que `animal_profiles` contenga la fila REAL en el server para ese establishment
 * + identificador. Existe porque el bug de pérdida de datos del backlog 2026-06-10 pasó INVISIBLE:
 * los E2E asertaban la UI (que muestra el OVERLAY local) sin verificar que el alta aterrizara en el
 * server — ninguna alta vía app llegaba al server y la suite seguía verde. Todo test de alta que
 * quiera garantizar persistencia DEBE llamar esto, no solo mirar la lista.
 */
export async function waitForServerAnimalProfile(
  establishmentId: string,
  match: { idv?: string; visualAlt?: string },
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; animal_id: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    let q = admin
      .from('animal_profiles')
      .select('id, animal_id')
      .eq('establishment_id', establishmentId)
      .is('deleted_at', null);
    if (match.idv) q = q.eq('idv', match.idv);
    if (match.visualAlt) q = q.eq('visual_id_alt', match.visualAlt);
    const { data, error } = await q.limit(1);
    if (error) throw new Error(`waitForServerAnimalProfile: ${error.message}`);
    if (data && data.length > 0) return data[0] as { id: string; animal_id: string };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerAnimalProfile(${establishmentId}, ${JSON.stringify(match)}): el alta NUNCA llegó al ` +
      `server (${tries} intentos) — el animal vive solo en el overlay/UI. Pérdida de persistencia ` +
      `(cadena del backlog 2026-06-10) o la RPC create_animal (0083) no está aplicada al remoto.`,
  );
}

/**
 * ORÁCULO de persistencia server-side de un EVENTO SIMPLE (spec 15 T7.3 — evento simple offline →
 * reconexión → fila REAL en el server). Pollea vía service_role hasta que `weight_events` contenga la
 * fila REAL para ese establishment + peso. Espeja `waitForServerAnimalProfile`: el bug de pérdida de
 * datos del backlog pasó invisible porque los E2E asertaban la UI (overlay) sin verificar el server.
 * El evento simple es CRUD plano (INSERT local + upload queue, T5.1) — al reconectar PowerSync drena
 * la cola por PostgREST; el trigger 0077 fuerza `establishment_id` desde el perfil al subir.
 */
export async function waitForServerWeightEvent(
  establishmentId: string,
  weightKg: number,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('weight_events')
      .select('id, establishment_id, weight_kg')
      .eq('establishment_id', establishmentId)
      .eq('weight_kg', weightKg)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerWeightEvent: ${error.message}`);
    if (data && data.length > 0) return { id: data[0].id as string };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerWeightEvent(${establishmentId}, ${weightKg}kg): el peso NUNCA llegó al server ` +
      `(${tries} intentos) — el evento vive solo en el SQLite local / no se drenó la upload queue.`,
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

    // ⚠️ birth_calves.calf_profile_id → animal_profiles(id) NO tiene ON DELETE CASCADE (mig 0045).
    // Si un test registró un PARTO, hay filas en birth_calves apuntando a los animal_profiles de los
    // terneros; el CASCADE de establishments → animal_profiles choca con ese FK y FALLA el borrado
    // (deja el campo + el usuario colgados). Pre-paso: borramos los reproductive_events de los
    // animal_profiles de estos campos → su FK birth_event_id (ON DELETE CASCADE) limpia birth_calves
    // → el CASCADE del establishment ya puede borrar los animal_profiles. Best-effort (loguea, no tira).
    try {
      const { data: profiles } = await admin
        .from('animal_profiles')
        .select('id')
        .in('establishment_id', ids);
      const profileIds = (profiles ?? []).map((p) => p.id as string);
      if (profileIds.length > 0) {
        const { error: reproErr } = await admin
          .from('reproductive_events')
          .delete()
          .in('animal_profile_id', profileIds);
        if (reproErr) console.error('[e2e cleanup] reproductive_events:', reproErr.message);
      }
    } catch (e) {
      console.error('[e2e cleanup] sweep reproductive_events:', (e as Error).message);
    }

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

/**
 * ORÁCULO de persistencia server-side de un PARTO (spec 15 T7.9 — parto offline → reconexión → un solo
 * evento de parto + N terneros REALES en el server, NO duplicados). Pollea vía service_role hasta que
 * `reproductive_events` tenga un evento `birth` para la madre + cuenta los `birth_calves` de ESE evento.
 * Devuelve { birthEventId, birthEventCount, calfCount } — el test asserta birthEventCount === 1 (no
 * doble-apply, R6.10/R6.12) y calfCount === <terneros esperados>. Espeja waitForServerWeightEvent: el
 * oráculo mira el SERVER (no el overlay/UI), que es donde el bug de pérdida/duplicación se manifiesta.
 *
 * birth_calves es SERVER-ONLY (sin GRANT de INSERT) → los terneros SOLO pueden existir si la RPC
 * register_birth corrió. La cuenta de eventos `birth` de la madre detecta un doble-apply (sería 2).
 */
export async function waitForServerBirth(
  motherProfileId: string,
  opts: { expectedCalves?: number; tries?: number; delayMs?: number } = {},
): Promise<{ birthEventId: string; birthEventCount: number; calfCount: number }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  const expected = opts.expectedCalves ?? 1;
  for (let i = 0; i < tries; i++) {
    const snap = await getServerBirthState(motherProfileId);
    // Esperamos a que el parto + sus terneros estén materializados (calfCount ≥ esperado) — bajo
    // at-least-once el ACK puede tardar, pero la RPC es atómica: cuando hay evento, hay N terneros.
    if (snap.birthEventCount >= 1 && snap.calfCount >= expected) {
      return {
        birthEventId: snap.birthEventId as string,
        birthEventCount: snap.birthEventCount,
        calfCount: snap.calfCount,
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const last = await getServerBirthState(motherProfileId);
  throw new Error(
    `waitForServerBirth(${motherProfileId}): el parto NUNCA aterrizó completo en el server ` +
      `(${tries} intentos; última lectura birthEvents=${last.birthEventCount}, calves=${last.calfCount}, ` +
      `esperados ${expected}). El parto vive solo en el overlay o no se drenó la outbox / RPC register_birth.`,
  );
}

/**
 * Snapshot NO-bloqueante del estado server-side del parto de una madre: cantidad de eventos `birth`
 * (vivos) + cantidad total de terneros (`birth_calves`) colgados de esos eventos. Lo usa la
 * contraprueba del rollback (debe quedar en 0/0: la RPC abortó atómica → NADA escrito) y el oráculo
 * del happy path. `birthEventId` = el id del PRIMER evento birth (o '' si no hay).
 */
export async function getServerBirthState(
  motherProfileId: string,
): Promise<{ birthEventId: string; birthEventCount: number; calfCount: number }> {
  const { data: events, error: evErr } = await admin
    .from('reproductive_events')
    .select('id')
    .eq('animal_profile_id', motherProfileId)
    .eq('event_type', 'birth')
    .is('deleted_at', null);
  if (evErr) throw new Error(`getServerBirthState events: ${evErr.message}`);
  const eventIds = (events ?? []).map((e) => e.id as string);
  if (eventIds.length === 0) return { birthEventId: '', birthEventCount: 0, calfCount: 0 };
  const { count, error: cErr } = await admin
    .from('birth_calves')
    .select('*', { count: 'exact', head: true })
    .in('birth_event_id', eventIds);
  if (cErr) throw new Error(`getServerBirthState calves: ${cErr.message}`);
  return { birthEventId: eventIds[0], birthEventCount: eventIds.length, calfCount: count ?? 0 };
}

/**
 * ORÁCULO de persistencia server-side de una BAJA (spec 15 T7.9 — baja offline → reconexión → el
 * status/exit_reason REAL aterriza en el server, R6.10). Pollea `animal_profiles` vía service_role
 * hasta que el perfil tenga el `status` egresado esperado (sold/dead/transferred). Devuelve la fila
 * (status + exit_reason + exit_date). Mira el SERVER, no el overlay (que solo OCULTA de la lista).
 */
export async function waitForServerExit(
  profileId: string,
  expectedStatus: 'sold' | 'dead' | 'transferred',
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ status: string; exit_reason: string | null; exit_date: string | null }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('status, exit_reason, exit_date')
      .eq('id', profileId)
      .limit(1);
    if (error) throw new Error(`waitForServerExit: ${error.message}`);
    const row = data?.[0] as { status: string; exit_reason: string | null; exit_date: string | null } | undefined;
    if (row && row.status === expectedStatus) return row;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerExit(${profileId}, ${expectedStatus}): el status egresado NUNCA aterrizó en el ` +
      `server (${tries} intentos) — la baja vive solo en el overlay / no se drenó la outbox.`,
  );
}

/**
 * Snapshot NO-bloqueante del status server-side de un perfil. Lo usa la contraprueba: tras un rollback
 * la baja NO debe haber aplicado (status sigue 'active'). Si el perfil fue soft-deleteado devuelve
 * `deleted_at` no-null (para no confundir un rollback con un soft-delete del setup del test).
 */
export async function getServerProfileStatus(
  profileId: string,
): Promise<{ status: string | null; deleted_at: string | null }> {
  const { data, error } = await admin
    .from('animal_profiles')
    .select('status, deleted_at')
    .eq('id', profileId)
    .limit(1);
  if (error) throw new Error(`getServerProfileStatus: ${error.message}`);
  const row = data?.[0] as { status: string; deleted_at: string | null } | undefined;
  return { status: row?.status ?? null, deleted_at: row?.deleted_at ?? null };
}

/**
 * Soft-deletea un animal_profile server-side (deleted_at = now()) vía service_role. Lo usa el test de
 * ROLLBACK in-vivo (T7.8/T7.9): rompe la PRECONDICIÓN server-side de una RPC encolada offline (p.ej. la
 * madre de un register_birth ya no existe → la RPC levanta 23503 'mother animal_profile not found' →
 * classifyIntentUploadError → permanent_reject → rollbackOverlay). Es el camino MÁS DETERMINISTA de
 * provocar un rechazo PERMANENTE real del server (no un 42501 de RLS, que exigiría manipular roles).
 */
export async function softDeleteProfile(profileId: string): Promise<void> {
  const { error } = await admin
    .from('animal_profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', profileId);
  if (error) throw new Error(`softDeleteProfile(${profileId}): ${error.message}`);
}

/** Cliente anon (key pública) — para chequeos auxiliares server-side desde el test si hiciera falta. */
export function anonClient(): SupabaseClient {
  return makeClient(anonKey);
}
