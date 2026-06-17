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
  opts: { speciesCode?: string; systemCode?: string; rawName?: boolean } = {},
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

  // El nombre va namespaced con el RUN_TAG por default (red de seguridad del barrido por nombre). Para
  // CAPTURAS demo (donde el prefijo "e2e_…" ensucia la pantalla, R12.4) se pasa `rawName:true` → nombre
  // limpio ("Cría hembras"). SEGURO: el rodeo se borra por CASCADE del establishment (FK on delete cascade,
  // 0017) trackeado por id; su nombre NO participa del cleanup (el barrido por nombre es solo de
  // `establishments`). El establishment SIGUE con su RUN_TAG → la red de seguridad no se debilita.
  const rodeoName = opts.rawName ? name : `${RUN_TAG} ${name}`;
  const { data: ins, error: insErr } = await admin
    .from('rodeos')
    .insert({
      establishment_id: establishmentId,
      name: rodeoName,
      species_id: species.id,
      system_id: system.id,
    })
    .select('id')
    .single();
  if (insErr) throw new Error(`seedRodeo insert: ${insErr.message}`);
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
  opts: {
    province?: string;
    city?: string | null;
    /** Nombre del rodeo (default "Rodeo general"). Para CAPTURAS demo: un nombre limpio ("Cría hembras"). */
    rodeoName?: string;
    /**
     * Si true, el rodeo se siembra SIN el prefijo RUN_TAG (nombre limpio para capturas demo). SEGURO: el
     * rodeo se borra por CASCADE del establishment (trackeado por id); el establishment conserva su RUN_TAG.
     */
    rodeoRawName?: boolean;
  } = {},
): Promise<{ establishmentId: string; rodeoId: string }> {
  const establishmentId = await seedEstablishment(ownerId, name, opts);
  const rodeoId = await seedRodeo(establishmentId, opts.rodeoName ?? 'Rodeo general', {
    rawName: opts.rodeoRawName,
  });
  return { establishmentId, rodeoId };
}

/**
 * Habilita (o deshabilita) un data_key en el rodeo_data_config de un rodeo, vía service_role. Algunos
 * data_keys nacen DESHABILITADOS por defecto en la plantilla de cría (0018 l.96: `inseminacion`,
 * `peso_nacimiento`, `tuberculosis`) → para testear una maniobra cuyo data_key está off por default (ej.
 * INSEMINACIÓN, R6.5) hay que prenderlo primero (lo que el owner haría desde la config del rodeo). El
 * rodeo_data_config ya tiene una fila por field (la sembró el trigger 0018 al crear el rodeo) → UPDATE.
 */
export async function setRodeoDataKey(
  rodeoId: string,
  dataKey: string,
  enabled: boolean,
): Promise<void> {
  const { data: fd, error: fdErr } = await admin
    .from('field_definitions')
    .select('id')
    .eq('data_key', dataKey)
    .single();
  if (fdErr) throw new Error(`setRodeoDataKey field_definitions(${dataKey}): ${fdErr.message}`);
  const { error } = await admin
    .from('rodeo_data_config')
    .update({ enabled })
    .eq('rodeo_id', rodeoId)
    .eq('field_definition_id', fd.id as string);
  if (error) throw new Error(`setRodeoDataKey update(${dataKey}=${enabled}): ${error.message}`);
}

/**
 * Siembra un maneuver_preset (scope establishment) con su config jsonb, vía service_role. Se usa para
 * que el wizard tenga un HISTORIAL de preconfig que sembrar al autocompletar (R1.8, DM1-UI-1): el
 * wizard lee los presets del campo y junta los valores de preconfig usados antes (vacuna/pajuela). Se
 * borra en cascada al borrar el establishment (FK on delete cascade). Devuelve el preset id.
 */
export async function seedManeuverPreset(
  establishmentId: string,
  name: string,
  config: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from('maneuver_presets')
    .insert({ establishment_id: establishmentId, name: `${RUN_TAG} ${name}`, config })
    .select('id')
    .single();
  if (error) throw new Error(`seedManeuverPreset insert: ${error.message}`);
  return data.id as string;
}

/**
 * Siembra una SESIÓN de maniobra ACTIVA (status='active') directamente en el server, vía service_role —
 * para reproducir el estado del bug de R10.6 (sesiones `active` huérfanas ACUMULADAS que un arranque
 * previo sin cierre + "Salir sin terminar" dejaban). El cliente NUNCA puede acumular esto post-fix (cada
 * createSession cierra las activas antes de insertar), así que el seed server-side es la única forma de
 * partir de N>1 activas. Se borra por CASCADE del establishment. Devuelve el session id.
 *
 * `started_at` explícito (default un instante fijo) para un orden determinístico de la "más reciente".
 */
export async function seedActiveSession(
  establishmentId: string,
  rodeoId: string,
  opts: { config?: Record<string, unknown>; startedAt?: string } = {},
): Promise<string> {
  const { data, error } = await admin
    .from('sessions')
    .insert({
      establishment_id: establishmentId,
      rodeo_id: rodeoId,
      config: opts.config ?? { maniobras: ['pesaje'] },
      status: 'active',
      animal_count: 0,
      event_count: 0,
      started_at: opts.startedAt ?? '2026-06-16T08:00:00Z',
    })
    .select('id')
    .single();
  if (error) throw new Error(`seedActiveSession insert: ${error.message}`);
  return data.id as string;
}

/**
 * Lee los ids de TODAS las sesiones ACTIVAS (status='active', no borradas) de un establishment, vía
 * service_role. Para asertar el invariante R10.6 (≤1 activa) sin pollear. Orden por started_at DESC.
 */
export async function readServerActiveSessionIds(establishmentId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('sessions')
    .select('id')
    .eq('establishment_id', establishmentId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('started_at', { ascending: false });
  if (error) throw new Error(`readServerActiveSessionIds: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * ORÁCULO SERVER del invariante R10.6: pollea hasta que la cantidad de sesiones ACTIVAS del establishment
 * sea EXACTAMENTE `expected` (no solo "al menos una"). Lo usa el e2e de ≤1-activa: tras arrancar una jornada
 * nueva con N activas pre-existentes, el close-all de createSession + el INSERT suben por la upload queue →
 * el server debe converger a 1 activa (la nueva). Lanza si nunca converge.
 */
export async function waitForServerActiveSessionCount(
  establishmentId: string,
  expected: number,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<void> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  let last = -1;
  for (let i = 0; i < tries; i++) {
    const { count, error } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('establishment_id', establishmentId)
      .eq('status', 'active')
      .is('deleted_at', null);
    if (error) throw new Error(`waitForServerActiveSessionCount: ${error.message}`);
    last = count ?? 0;
    if (last === expected) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerActiveSessionCount(${establishmentId}): la cantidad de sesiones activas NUNCA llegó a ` +
      `${expected} (${tries} intentos; última vista: ${last}). El enforcement ≤1 activa (R10.6, createSession ` +
      `→ closeActiveSessions) no sincronizó, o no cerró todas las activas.`,
  );
}

/**
 * Normaliza el `config` de un session/preset materializado en el server al objeto que la APP lee. El
 * cliente persiste `config` como `JSON.stringify(config)` (CRUD-plano sobre la columna jsonb) → al subir,
 * PostgREST guarda ese STRING como un VALOR string JSON dentro del jsonb (no como objeto). Por eso la app
 * tolera ambas formas en `parseManeuverConfig` (string JSON → parse; objeto → tal cual). El oráculo del
 * server debe espejar esa tolerancia: asertar el shape que la app GENUINAMENTE recupera, no el wire-shape
 * crudo. Re-parsea hasta 2 niveles (cubre el doble-encoding observado), igual que el cliente.
 */
function normalizeManeuverConfig(raw: unknown): Record<string, unknown> {
  let v = raw;
  for (let i = 0; i < 2; i++) {
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        return {};
      }
    } else break;
  }
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * ORÁCULO de persistencia server-side de un PRESET de maniobra (spec 03 R2.1 — "Guardar como rutina").
 * Pollea `maneuver_presets` vía service_role hasta que exista una fila NO borrada del establishment con el
 * `name` esperado (el wizard lo guarda SIN el RUN_TAG, así que se busca por el nombre tal cual lo tipeó el
 * test). Verifica que el createPreset (CRUD-plano local + upload queue) llegó REAL al server (no solo al
 * overlay/UI) — espeja waitForServerActiveSessionId. Devuelve el id + el config NORMALIZADO al shape que la
 * app recupera (las maniobras + preconfig de la jornada), tolerando el doble-encoding del jsonb (igual que
 * parseManeuverConfig del cliente).
 */
export async function waitForServerPreset(
  establishmentId: string,
  name: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; config: Record<string, unknown> }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('maneuver_presets')
      .select('id, config')
      .eq('establishment_id', establishmentId)
      .eq('name', name)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerPreset: ${error.message}`);
    if (data && data.length > 0) {
      return { id: data[0].id as string, config: normalizeManeuverConfig(data[0].config) };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerPreset(${establishmentId}, "${name}"): el preset NUNCA llegó al server (${tries} ` +
      `intentos) — el createPreset vive solo en el SQLite local / no se drenó la upload queue.`,
  );
}

/**
 * Oráculo SERVER del alta de un dato/maniobra CUSTOM (spec 03 M5-C.2): la fila REAL aterrizó en
 * field_definitions con su establishment_id (forzado/validado por la RLS owner-only + el guard 0093), su
 * data_type (maniobra/propiedad), ui_component y config_schema. Busca por (establishment_id, label) — el
 * label lo tipea el usuario tal cual. Prueba el camino OFFLINE → sync → CRUD-plano → 0093 end-to-end.
 */
export async function waitForServerCustomField(
  establishmentId: string,
  label: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; dataKey: string; dataType: string; uiComponent: string; configSchema: unknown }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('field_definitions')
      .select('id, data_key, data_type, ui_component, config_schema')
      .eq('establishment_id', establishmentId)
      .eq('label', label)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerCustomField: ${error.message}`);
    if (data && data.length > 0) {
      return {
        id: data[0].id as string,
        dataKey: data[0].data_key as string,
        dataType: data[0].data_type as string,
        uiComponent: data[0].ui_component as string,
        configSchema: data[0].config_schema,
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerCustomField(${establishmentId}, "${label}"): el dato custom NUNCA llegó al server ` +
      `(${tries} intentos) — el createCustomField vive solo en el SQLite local / no se drenó la cola.`,
  );
}

/**
 * Siembra un DATO/MANIOBRA CUSTOM (field_definitions con establishment_id) y lo HABILITA en un rodeo, vía
 * service_role (spec 03 M5-C.3). Bypassea el form de creación (C.2 ya lo testea) para que el C.3 e2e se
 * enfoque en seleccionar → secuenciar → renderizar → capturar. Inserta el field_definitions custom (data_type
 * maniobra|propiedad, ui_component, config_schema {options} si enum) + un INSERT/UPDATE de rodeo_data_config
 * enabled=true. Devuelve el field_definition_id (lo que config.customManiobras / custom_attributes referencian).
 */
export async function seedCustomField(
  establishmentId: string,
  rodeoId: string,
  opts: {
    label: string;
    dataKey: string;
    dataType: 'maniobra' | 'propiedad';
    uiComponent: 'numeric' | 'numeric_stepped' | 'enum_single' | 'enum_multi' | 'text' | 'boolean' | 'date';
    options?: string[];
  },
): Promise<string> {
  const id = randomUUID();
  const configSchema =
    opts.uiComponent === 'enum_single' || opts.uiComponent === 'enum_multi'
      ? { options: opts.options ?? [] }
      : null;
  const { error: fdErr } = await admin.from('field_definitions').insert({
    id,
    establishment_id: establishmentId,
    data_key: opts.dataKey,
    label: opts.label,
    data_type: opts.dataType,
    ui_component: opts.uiComponent,
    category: 'personalizado',
    config_schema: configSchema,
    active: true,
  });
  if (fdErr) throw new Error(`seedCustomField field_definitions(${opts.label}): ${fdErr.message}`);

  // Habilitar el field en el rodeo (rodeo_data_config). No hay fila previa (el trigger 0018 solo seedea los
  // de fábrica) → INSERT directo (service_role bypassea la RLS owner-only).
  const { error: cfgErr } = await admin
    .from('rodeo_data_config')
    .insert({ rodeo_id: rodeoId, field_definition_id: id, enabled: true });
  if (cfgErr) throw new Error(`seedCustomField rodeo_data_config(${opts.label}): ${cfgErr.message}`);
  return id;
}

/**
 * ORÁCULO de persistencia server-side de una CAPTURA de maniobra CUSTOM (spec 03 M5-C.3, R13.11): pollea
 * `custom_measurements` hasta encontrar la fila del `field_definition_id` de un perfil con `session_id` NO
 * nulo y el `value` jsonb esperado. Prueba que la captura subió por addCustomMeasurement con session_id y el
 * value tipado correcto (number/string/bool/array nativo, no double-encodeado). `expectedValue` se compara
 * con JSON.stringify (jsonb nativo del server). Devuelve el session_id real.
 */
export async function waitForServerCustomMeasurement(
  profileId: string,
  fieldDefinitionId: string,
  expectedValue: unknown,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; sessionId: string; value: unknown }> {
  const tries = opts.tries ?? 40;
  const delayMs = opts.delayMs ?? 2000;
  const want = JSON.stringify(expectedValue);
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('custom_measurements')
      .select('id, animal_profile_id, field_definition_id, value, session_id')
      .eq('animal_profile_id', profileId)
      .eq('field_definition_id', fieldDefinitionId)
      .not('session_id', 'is', null)
      .is('deleted_at', null)
      .limit(5);
    if (error) throw new Error(`waitForServerCustomMeasurement: ${error.message}`);
    const hit = (data ?? []).find((r) => JSON.stringify(r.value) === want);
    if (hit) return { id: hit.id as string, sessionId: hit.session_id as string, value: hit.value };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerCustomMeasurement(${profileId}, ${fieldDefinitionId}, ${want}): la captura custom NUNCA ` +
      `llegó al server con session_id + ese value (${tries} intentos).`,
  );
}

/**
 * ORÁCULO de persistencia server-side de una PROPIEDAD CUSTOM (spec 03 M5-C.3, R13.12): pollea
 * `custom_attributes` hasta encontrar el current-value del par (animal, field) con el `value` jsonb esperado.
 * Prueba que setCustomAttribute subió el upsert por la PK natural con el value tipado correcto.
 */
export async function waitForServerCustomAttribute(
  profileId: string,
  fieldDefinitionId: string,
  expectedValue: unknown,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ value: unknown }> {
  const tries = opts.tries ?? 40;
  const delayMs = opts.delayMs ?? 2000;
  const want = JSON.stringify(expectedValue);
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('custom_attributes')
      .select('animal_profile_id, field_definition_id, value')
      .eq('animal_profile_id', profileId)
      .eq('field_definition_id', fieldDefinitionId)
      .limit(1);
    if (error) throw new Error(`waitForServerCustomAttribute: ${error.message}`);
    if (data && data.length > 0 && JSON.stringify(data[0].value) === want) {
      return { value: data[0].value };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerCustomAttribute(${profileId}, ${fieldDefinitionId}, ${want}): la propiedad custom NUNCA ` +
      `llegó al server con ese value (${tries} intentos).`,
  );
}

/**
 * Resuelve el animal_profile_id de un perfil ACTIVO por su `visual_id_alt` dentro de un establishment, vía
 * service_role (spec 03 M5-C.3): para descubrir el id de un animal recién creado por la UI (cuyo id es de
 * cliente) y poder consultar sus custom_attributes en el oráculo. Reintenta (la fila tarda en propagarse).
 */
export async function adminQueryProfileByVisual(
  establishmentId: string,
  visual: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<string> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('id, visual_id_alt, establishment_id')
      .eq('establishment_id', establishmentId)
      .eq('visual_id_alt', visual)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`adminQueryProfileByVisual: ${error.message}`);
    if (data && data.length > 0) return data[0].id as string;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`adminQueryProfileByVisual(${establishmentId}, "${visual}"): el perfil NUNCA apareció.`);
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
 * ORÁCULO de persistencia server-side del MOVIMIENTO DE RODEO de un perfil (spec 03 R4.4 — "pasar el
 * animal a este rodeo"). Pollea vía service_role hasta que `animal_profiles.rodeo_id` del perfil dado sea
 * `expectedRodeoId`. Verifica que el UPDATE de `rodeo_id` (CRUD-plano local + upload queue) llegó REAL al
 * server (no solo al overlay/UI). Espeja `waitForServerAnimalProfile`.
 */
export async function waitForServerProfileRodeo(
  profileId: string,
  expectedRodeoId: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<void> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  let last: string | null = null;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('rodeo_id')
      .eq('id', profileId)
      .maybeSingle();
    if (error) throw new Error(`waitForServerProfileRodeo: ${error.message}`);
    last = (data?.rodeo_id as string | undefined) ?? null;
    if (last === expectedRodeoId) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerProfileRodeo(${profileId}): el rodeo_id NUNCA llegó a ${expectedRodeoId} en el server ` +
      `(${tries} intentos; último visto: ${last ?? 'null'}). El UPDATE de animal_profiles.rodeo_id (R4.4 ` +
      `"pasar a este rodeo") no sincronizó, o lo rechazó el trigger same-system (0047).`,
  );
}

/**
 * ORÁCULO de persistencia server-side del CIERRE de una jornada de manga (spec 03 R10.7 — "Terminar
 * jornada" → closeSession). Pollea vía service_role hasta que `sessions.status` del id dado sea `'closed'`.
 * Verifica que el UPDATE de cierre (CRUD-plano local + upload queue) llegó REAL al server (no solo a la UI).
 * Espeja `waitForServerProfileRodeo`. Lo usa el e2e de salida de la jornada para probar que "Terminar
 * jornada" cierra la sesión de verdad (no solo navega).
 */
export async function waitForServerSessionClosed(
  sessionId: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<void> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  let last: string | null = null;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw new Error(`waitForServerSessionClosed: ${error.message}`);
    last = (data?.status as string | undefined) ?? null;
    if (last === 'closed') return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerSessionClosed(${sessionId}): el status NUNCA llegó a 'closed' en el server ` +
      `(${tries} intentos; último visto: ${last ?? 'null'}). El UPDATE de cierre (R10.7 closeSession) no ` +
      `sincronizó, o lo rechazó la RLS (sessions_update = has_role_in).`,
  );
}

/**
 * Lee el `status` actual de una sesión vía service_role (sin pollear). Para asertar que "Salir sin terminar"
 * NO cerró la sesión (queda 'active' + reanudable, R10.5/R10.6). Devuelve null si no existe.
 */
export async function readServerSessionStatus(sessionId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`readServerSessionStatus: ${error.message}`);
  return (data?.status as string | undefined) ?? null;
}

/**
 * Lee el `id` de la sesión ACTIVA de un establishment vía service_role. La pantalla de identificación NO
 * expone el sessionId en el DOM → el e2e necesita el id real para los oráculos de cierre. Pollea hasta verla
 * (la jornada se crea offline-local y sube por la upload queue). Devuelve el id o lanza si nunca aparece.
 */
export async function waitForServerActiveSessionId(
  establishmentId: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<string> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('sessions')
      .select('id')
      .eq('establishment_id', establishmentId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`waitForServerActiveSessionId: ${error.message}`);
    const id = (data?.id as string | undefined) ?? null;
    if (id) return id;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerActiveSessionId(${establishmentId}): no apareció ninguna sesión activa en el server ` +
      `(${tries} intentos). La jornada (createSession offline) no sincronizó.`,
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

/**
 * ORÁCULO de persistencia server-side de un PESAJE de MANIOBRA con `session_id` (spec 03 M2.2, R5.11):
 * pollea `weight_events` hasta encontrar la fila REAL del peso CON un `session_id` NO nulo (= cargada en la
 * jornada de manga). Espeja waitForServerWeightEvent pero EXIGE el vínculo de sesión: prueba que el evento
 * subió por el orquestador con session_id (no como evento suelto de la ficha). Devuelve el session_id real.
 */
export async function waitForServerWeightEventWithSession(
  establishmentId: string,
  weightKg: number,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; sessionId: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('weight_events')
      .select('id, establishment_id, weight_kg, session_id')
      .eq('establishment_id', establishmentId)
      .eq('weight_kg', weightKg)
      .not('session_id', 'is', null)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerWeightEventWithSession: ${error.message}`);
    if (data && data.length > 0) return { id: data[0].id as string, sessionId: data[0].session_id as string };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerWeightEventWithSession(${establishmentId}, ${weightKg}kg): el peso NUNCA llegó al server ` +
      `con session_id (${tries} intentos) — o no se drenó la upload queue, o subió sin vincular la jornada.`,
  );
}

/**
 * ORÁCULO de persistencia server-side de un TACTO de MANIOBRA con `session_id` (spec 03 M2.2, R5.11/R6.2):
 * pollea `reproductive_events` hasta encontrar el `tacto` (event_type='tacto') de un perfil con un
 * `session_id` NO nulo y el `pregnancy_status` esperado. Prueba que el tacto subió por el orquestador con
 * session_id y el dato correcto (incl. el tamaño si preñada).
 */
export async function waitForServerTactoWithSession(
  profileId: string,
  pregnancyStatus: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; sessionId: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('reproductive_events')
      .select('id, animal_profile_id, event_type, pregnancy_status, session_id')
      .eq('animal_profile_id', profileId)
      .eq('event_type', 'tacto')
      .eq('pregnancy_status', pregnancyStatus)
      .not('session_id', 'is', null)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerTactoWithSession: ${error.message}`);
    if (data && data.length > 0) return { id: data[0].id as string, sessionId: data[0].session_id as string };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerTactoWithSession(${profileId}, ${pregnancyStatus}): el tacto NUNCA llegó al server ` +
      `con session_id (${tries} intentos).`,
  );
}

/**
 * ORÁCULO de persistencia server-side de un TACTO VAQUILLONA de MANIOBRA con `session_id` (spec 03 M3.2a,
 * R6.3/R5.13): pollea `reproductive_events` hasta encontrar el `tacto_vaquillona` de un perfil con
 * `session_id` NO nulo y el `heifer_fitness` esperado (apta|no_apta|diferida). Prueba que el resultado de
 * aptitud subió por el orquestador con session_id y el dato correcto.
 */
export async function waitForServerVaquillonaWithSession(
  profileId: string,
  heiferFitness: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; sessionId: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('reproductive_events')
      .select('id, animal_profile_id, event_type, heifer_fitness, session_id')
      .eq('animal_profile_id', profileId)
      .eq('event_type', 'tacto_vaquillona')
      .eq('heifer_fitness', heiferFitness)
      .not('session_id', 'is', null)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerVaquillonaWithSession: ${error.message}`);
    if (data && data.length > 0) return { id: data[0].id as string, sessionId: data[0].session_id as string };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerVaquillonaWithSession(${profileId}, ${heiferFitness}): el tacto vaquillona NUNCA llegó ` +
      `al server con session_id (${tries} intentos).`,
  );
}

/**
 * ORÁCULO de persistencia server-side de una INSEMINACIÓN de MANIOBRA con `session_id` (spec 03 M3.2b,
 * R6.5): pollea `reproductive_events` hasta encontrar el `service` (event_type='service', service_type='ai')
 * de un perfil con `session_id` NO nulo y la pajuela esperada en `notes`. Prueba que la pajuela subió por el
 * orquestador con session_id y el service_type IA correcto.
 */
export async function waitForServerInseminationWithSession(
  profileId: string,
  opts: { semenName?: string; tries?: number; delayMs?: number } = {},
): Promise<{ id: string; sessionId: string; notes: string | null }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    let q = admin
      .from('reproductive_events')
      .select('id, animal_profile_id, event_type, service_type, notes, session_id')
      .eq('animal_profile_id', profileId)
      .eq('event_type', 'service')
      .eq('service_type', 'ai')
      .not('session_id', 'is', null)
      .is('deleted_at', null);
    if (opts.semenName) q = q.eq('notes', opts.semenName);
    const { data, error } = await q.limit(1);
    if (error) throw new Error(`waitForServerInseminationWithSession: ${error.message}`);
    if (data && data.length > 0) {
      return {
        id: data[0].id as string,
        sessionId: data[0].session_id as string,
        notes: (data[0].notes ?? null) as string | null,
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerInseminationWithSession(${profileId}, ${opts.semenName ?? '*'}): la inseminación NUNCA ` +
      `llegó al server con session_id (${tries} intentos).`,
  );
}

/**
 * ORÁCULO de persistencia server-side de una CONDICIÓN CORPORAL de MANIOBRA con `session_id` (spec 03
 * M3.2a, R6.6): pollea `condition_score_events` hasta encontrar el score esperado de un perfil con
 * `session_id` NO nulo. Prueba que el score (1,00–5,00 step 0,25) subió por el orquestador con session_id.
 */
export async function waitForServerConditionScoreWithSession(
  profileId: string,
  score: number,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; sessionId: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('condition_score_events')
      .select('id, animal_profile_id, score, session_id')
      .eq('animal_profile_id', profileId)
      .eq('score', score)
      .not('session_id', 'is', null)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerConditionScoreWithSession: ${error.message}`);
    if (data && data.length > 0) return { id: data[0].id as string, sessionId: data[0].session_id as string };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerConditionScoreWithSession(${profileId}, ${score}): el score NUNCA llegó al server con ` +
      `session_id (${tries} intentos).`,
  );
}

/**
 * ORÁCULO de la maniobra DIENTES (PROPIEDAD, NO evento — spec 03 M3.2a, R6.7/R6.8): pollea
 * `animal_profiles` hasta que el `teeth_state` del perfil sea el esperado. Si `expectCut` es true, EXIGE
 * además `is_cut = true` + `category_override = true` (la transición CUT, R6.8). Devuelve el estado del
 * perfil para asertar la categoría. Prueba el UPDATE de propiedad (no hay tabla de evento para dientes).
 */
export async function waitForServerTeethState(
  profileId: string,
  teethState: string,
  opts: { expectCut?: boolean; tries?: number; delayMs?: number } = {},
): Promise<{ teethState: string; isCut: boolean; categoryOverride: boolean; categoryId: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('teeth_state, is_cut, category_override, category_id')
      .eq('id', profileId)
      .single();
    if (error) throw new Error(`waitForServerTeethState: ${error.message}`);
    const matchesTeeth = data?.teeth_state === teethState;
    const matchesCut = !opts.expectCut || (data?.is_cut === true && data?.category_override === true);
    if (matchesTeeth && matchesCut) {
      return {
        teethState: data!.teeth_state as string,
        isCut: data!.is_cut as boolean,
        categoryOverride: data!.category_override as boolean,
        categoryId: data!.category_id as string,
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerTeethState(${profileId}, ${teethState}, cut=${!!opts.expectCut}): el estado dentario ` +
      `NUNCA llegó al server (${tries} intentos).`,
  );
}

/** Lee el `code` de una categoría por id (para asertar que la categoría CUT del sistema quedó fijada). */
export async function getCategoryCodeById(categoryId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('categories_by_system')
    .select('code')
    .eq('id', categoryId)
    .maybeSingle();
  if (error) throw new Error(`getCategoryCodeById: ${error.message}`);
  return (data?.code as string | undefined) ?? null;
}

/**
 * ORÁCULO de una maniobra SANITARIA silent_apply (spec 03 M3.2b, R6.13/R6.15): pollea `sanitary_events`
 * hasta que exista una fila del perfil con el `event_type` esperado (`deworming`=antiparasitario,
 * `treatment`=antibiótico, `vaccination`=vacunación) CON `session_id`. Si `productName` viene, lo exige.
 * Prueba que la maniobra silent escribió su sanitary_event vinculado a la jornada (R5.11). Para vacunación
 * multi, devuelve el conteo de filas con ese event_type+session.
 */
export async function waitForServerSanitaryWithSession(
  profileId: string,
  eventType: 'deworming' | 'treatment' | 'vaccination',
  opts: { productName?: string; minCount?: number; tries?: number; delayMs?: number } = {},
): Promise<{ count: number; sessionId: string; productNames: string[] }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  const minCount = opts.minCount ?? 1;
  for (let i = 0; i < tries; i++) {
    let q = admin
      .from('sanitary_events')
      .select('id, animal_profile_id, event_type, product_name, session_id')
      .eq('animal_profile_id', profileId)
      .eq('event_type', eventType)
      .not('session_id', 'is', null)
      .is('deleted_at', null);
    if (opts.productName != null) q = q.eq('product_name', opts.productName);
    const { data, error } = await q;
    if (error) throw new Error(`waitForServerSanitaryWithSession: ${error.message}`);
    if (data && data.length >= minCount) {
      return {
        count: data.length,
        sessionId: data[0].session_id as string,
        productNames: data.map((r) => (r.product_name as string) ?? ''),
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerSanitaryWithSession(${profileId}, ${eventType}): no llegaron ≥${minCount} filas con ` +
      `session_id (${tries} intentos).`,
  );
}

/**
 * ORÁCULO de una maniobra de LABORATORIO (spec 03 M3.2b, R6.4/R6.11): pollea `lab_samples` hasta que exista
 * una fila del perfil con el `sample_type` esperado (`blood`=sangrado, `scrape_tricho`/`scrape_campylo`=
 * raspado) CON `session_id` y el `tube_number` esperado (si viene). Prueba que el lab_sample se vinculó a la
 * jornada (R5.11). Para el raspado (2 muestras) se llama dos veces (una por sample_type).
 */
export async function waitForServerLabSampleWithSession(
  profileId: string,
  sampleType: 'blood' | 'scrape_tricho' | 'scrape_campylo',
  opts: { tubeNumber?: string; tries?: number; delayMs?: number } = {},
): Promise<{ id: string; sessionId: string; tubeNumber: string }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    let q = admin
      .from('lab_samples')
      .select('id, animal_profile_id, sample_type, tube_number, session_id')
      .eq('animal_profile_id', profileId)
      .eq('sample_type', sampleType)
      .not('session_id', 'is', null)
      .is('deleted_at', null);
    if (opts.tubeNumber != null) q = q.eq('tube_number', opts.tubeNumber);
    const { data, error } = await q.limit(1);
    if (error) throw new Error(`waitForServerLabSampleWithSession: ${error.message}`);
    if (data && data.length > 0) {
      return {
        id: data[0].id as string,
        sessionId: data[0].session_id as string,
        tubeNumber: data[0].tube_number as string,
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerLabSampleWithSession(${profileId}, ${sampleType}): la muestra NUNCA llegó al server con ` +
      `session_id (${tries} intentos).`,
  );
}

/**
 * Cuenta los `lab_samples` scrape_* (raspado) NO borrados de un perfil. Para asertar que el raspado NO corrió
 * (hembra, R6.12): debe ser 0. Usa el cliente service_role (NO la app) → ve el estado real del server.
 */
export async function countScrapeSamples(profileId: string): Promise<number> {
  const { count, error } = await admin
    .from('lab_samples')
    .select('id', { count: 'exact', head: true })
    .eq('animal_profile_id', profileId)
    .in('sample_type', ['scrape_tricho', 'scrape_campylo'])
    .is('deleted_at', null);
  if (error) throw new Error(`countScrapeSamples: ${error.message}`);
  return count ?? 0;
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
 * ORÁCULO de persistencia server-side de una ASIGNACIÓN DE CARAVANA (spec 09 chunk dedup — RD1/RD2). El
 * assign se ENCOLA offline (op_intent → outbox); al sincronizar, el connector llama al RPC
 * `assign_tag_to_animal`, que setea `animals.tag_electronic` (índice unique global) y el trigger 0079
 * propaga el valor a `animal_profiles.animal_tag_electronic` de TODOS los perfiles del animal.
 *
 * Por qué un oráculo SERVER y no la ficha: la ficha (`/animal/[id]`) lee LOCAL una sola vez al enfocar
 * (`useFocusEffect`) y NO es reactiva → muestra "sin caravana" hasta el próximo sync + re-focus (staleness
 * documentada, design §3.3). Mirar el SERVER (vía service_role) prueba que el assign GENUINAMENTE persistió
 * end-to-end (outbox → RPC → animals.tag_electronic → propagación 0079), sin depender de la reactividad de
 * la UI. Verificamos AMBOS lados de la propagación: `animals.tag_electronic` (lo que escribió el RPC) Y
 * `animal_profiles.animal_tag_electronic` (lo que propagó el trigger 0079, que es lo que la app lee).
 */
export async function waitForServerTagAssigned(
  profileId: string,
  tag: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ animalTag: string | null; profileTag: string | null }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('animal_tag_electronic, animals(tag_electronic)')
      .eq('id', profileId)
      .limit(1);
    if (error) throw new Error(`waitForServerTagAssigned: ${error.message}`);
    const row = data?.[0] as
      | { animal_tag_electronic: string | null; animals: { tag_electronic: string | null } | null }
      | undefined;
    const animalTag = row?.animals?.tag_electronic ?? null;
    const profileTag = row?.animal_tag_electronic ?? null;
    // El RPC seteó animals.tag_electronic Y el trigger 0079 propagó al denorm del perfil.
    if (animalTag === tag && profileTag === tag) return { animalTag, profileTag };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const { data: last } = await admin
    .from('animal_profiles')
    .select('animal_tag_electronic, animals(tag_electronic)')
    .eq('id', profileId)
    .limit(1);
  throw new Error(
    `waitForServerTagAssigned(${profileId}, ${tag}): la caravana NUNCA se asignó en el server ` +
      `(${tries} intentos; última lectura ${JSON.stringify(last?.[0])}) — el assign vive solo en la ` +
      `outbox / no se drenó / el RPC assign_tag_to_animal (0089) no aplicó.`,
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
