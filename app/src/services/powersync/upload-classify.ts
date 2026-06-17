// Lógica PURA del connector de PowerSync: construcción de credenciales + clasificación de errores
// de la upload queue (T1.5 / R3.1, R3.4, R3.5). SIN imports de supabase/RN/SDK → testeable con
// node:test. El connector real (connector.ts) importa `./supabase` (→ expo-secure-store) y NO carga
// bajo node:test; acá vive solo la decisión.
//
// NOTA de Run 1: este módulo cubre la BASE de CRUD plano + la clasificación transitorio/permanente.
// El mapeo op_intents→RPC, el overlay optimista y la idempotencia (R6.8–R6.12) son Run T6 (stubs
// marcados en connector.ts). Acá NO se decide nada de esas ramas.

/** Forma mínima de la sesión Supabase que precisamos (subset de Session de supabase-js). */
export type SessionLike = { access_token?: string | null } | null | undefined;

/** Credenciales que espera PowerSync (subset de PowerSyncCredentials). */
export type PowerSyncCredentialsLike = { endpoint: string; token: string };

/**
 * Construye las credenciales para PowerSync a partir del endpoint y la sesión Supabase actual.
 * PURA (testeable). Contrato del SDK (PowerSyncBackendConnector.fetchCredentials):
 *   - sin sesión / sin access_token → devolver null (NO conectar; el SDK reintenta cuando haya login).
 *   - con sesión → { endpoint, token: access_token }.
 * NUNCA loguea ni filtra el token (el connector tampoco).
 */
export function buildCredentials(
  endpoint: string,
  session: SessionLike,
): PowerSyncCredentialsLike | null {
  const token = session?.access_token;
  if (!token) return null;
  return { endpoint, token };
}

/**
 * ¿El error al subir una op es TRANSITORIO (red caída / 5xx)? Si sí, el connector RE-LANZA y la op
 * queda en la cola para reintento (R3.4) — NO se descarta. Si NO (permanente: RLS 42501, constraint,
 * check), el connector descarta la op para no bloquear el resto (R3.5/R8.1).
 *
 * PURA (testeable). Detecta lo transitorio por:
 *   - mensajes de red (supabase-js no setea code en fallos de fetch);
 *   - status HTTP 5xx / 429 (rate limit) cuando viene;
 *   - ausencia total de señal de "rechazo del servidor" → conservador: lo trata como TRANSITORIO
 *     (mejor reintentar que descartar a ciegas un dato de campo).
 * Un código de Postgres conocido de rechazo permanente (clase 23 constraint, 42501 RLS, 22/23 checks)
 * → NO transitorio.
 */
export function isTransientUploadError(error: unknown): boolean {
  const e = (error ?? {}) as { message?: unknown; code?: unknown; status?: unknown };
  const msg = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;

  if (/network|failed to fetch|fetch failed|networkerror|timeout|timed out/i.test(msg)) {
    return true;
  }
  if (status !== undefined && (status >= 500 || status === 429)) {
    return true;
  }
  // Códigos de rechazo PERMANENTE del servidor (Postgres / PostgREST).
  if (isPermanentServerCode(code)) {
    return false;
  }
  if (status !== undefined && status >= 400 && status < 500) {
    // 4xx que NO es 429: rechazo del cliente (validación/authz) → permanente.
    return false;
  }
  // Sin señal clara de rechazo del servidor → conservador: reintentar.
  return true;
}

// ─── CRUD-plano: plan de upload (special-case de PK COMPUESTA) — spec 03 M5-C.1 ──────────────────────────
//
// El connector CRUD-plano sube un PUT con `table.upsert({ ...op.opData, id: op.id })` y un PATCH con
// `table.update(op.opData).eq('id', op.id)`. Ambos usan `op.id` = el id LOCAL de la fila (la columna `id`
// implícita de PowerSync). Para las tablas con columna `id` REAL server-side (el grueso) eso es correcto.
// PERO `custom_attributes` (0095) tiene PK COMPUESTA `(animal_profile_id, field_definition_id)` y NO tiene
// columna `id` real: la stream le da un `id` SINTÉTICO (`animal_profile_id || ':' || field_definition_id`)
// solo para el DOWN. Mandar/filtrar ESE `id` contra PostgREST haría referencia a una columna inexistente →
// 42703 (permanente) → el upsert del atributo se DESCARTA y nunca persiste. (Por eso las otras PK-compuestas
// —rodeo_data_config, birth_calves— van por OUTBOX/RPC; custom_attributes va CRUD-plano con este special-case.)
//
// ⚠️ EL GOTCHA REAL (lección M2.2): el write local de custom_attributes es `INSERT ... ON CONFLICT(id) DO
// UPDATE` → en una RE-EDICIÓN, SQLite resuelve por el branch UPDATE → PowerSync lo trackea como PATCH con
// SOLO la columna cambiada (`value`), SIN la PK natural en opData. Por eso el connector debe manejar el PATCH
// de custom_attributes DECODIFICANDO la PK natural del `op.id` sintético (`a:f` → split ':') y filtrar
// `.eq('animal_profile_id', a).eq('field_definition_id', f)` (NO `.eq('id', ...)`). El PUT (1ra captura) trae
// la fila completa en opData → upsert por la PK natural (onConflict).

/** Plan de un PUT CRUD-plano para PostgREST: el payload + (opcional) la clave de conflicto. */
export type CrudUpsertPlan = {
  /** Columnas a upsertear (lo que va a `.upsert(payload, ...)`). */
  payload: Record<string, unknown>;
  /** Columnas de conflicto (PostgREST `onConflict`); undefined = conflicto por PK `id` (default). */
  onConflict?: string;
};

/** Plan de un PATCH CRUD-plano para PostgREST: el payload + el/los filtro(s) de igualdad de la fila. */
export type CrudPatchPlan = {
  /** Columnas a actualizar. */
  payload: Record<string, unknown>;
  /** Filtros de igualdad (columna→valor) que identifican la fila: `{ id }` normal, o la PK natural. */
  match: Record<string, unknown>;
};

/** Tablas SINCRONIZADAS con PK COMPUESTA (sin columna `id` real server-side): se opera por la PK natural. */
const COMPOSITE_PK: Record<string, { onConflict: string; cols: readonly string[]; sep: string }> = {
  // (animal_profile_id, field_definition_id) — custom_attributes (M5, 0095). id sintético = a:f.
  custom_attributes: {
    onConflict: 'animal_profile_id,field_definition_id',
    cols: ['animal_profile_id', 'field_definition_id'],
    sep: ':',
  },
};

/**
 * Decodifica las columnas de la PK natural a partir del `id` sintético de una tabla de PK compuesta. PURA.
 * `a:f` → `{ animal_profile_id: 'a', field_definition_id: 'f' }`. Usa splitN para tolerar (defensivo) un
 * separador dentro de un valor (no ocurre con uuids, pero el último split agrupa el resto en la 2da col).
 */
function decodeCompositeKey(table: string, id: string): Record<string, string> | null {
  const spec = COMPOSITE_PK[table];
  if (!spec) return null;
  const idx = id.indexOf(spec.sep);
  if (idx <= 0 || idx >= id.length - 1) return null; // mal formado → null (el connector cae al camino normal)
  const first = id.slice(0, idx);
  const rest = id.slice(idx + spec.sep.length);
  return { [spec.cols[0]]: first, [spec.cols[1]]: rest };
}

// ─── Columnas jsonb que viajan como TEXT local → hay que PARSEARLAS antes de subir (M5-C.1) ──────────────
//
// ⚠️ GOTCHA del TIPO jsonb (la 2da capa del problema, lección "doble-encoding del config jsonb" de M2.2). El
// schema local de PowerSync guarda jsonb como TEXT (SQLite no tipa). El service serializa `value` a JSON TEXT
// (`385` para un número, `"overo"` para un string, `["a","b"]` para un array). Si el connector lo subiera
// COMO ESTÁ (un string JS), PostgREST escribiría en la columna jsonb un VALOR string (doble-encoding): un
// número quedaría como jsonb-string `"385"` en vez de jsonb-number `385`. `assert_custom_value_valid` (0096)
// valida `jsonb_typeof(value)` (= 'number'/'boolean'/'array'/'string' según el ui_component) → un número
// double-encodeado como string sería RECHAZADO (23514). Solución: PARSEAR la columna `value` a su valor JS
// nativo antes del upsert → PostgREST la sube como jsonb del TIPO correcto.
//
// `sessions.config`/`maneuver_presets.config` también son jsonb-as-TEXT, pero NO se validan por tipo
// server-side (solo size CHECK) y su consumidor (el cliente) tolera el doble-encoding en la lectura → NO se
// listan acá (cambiarlas sería un cambio de comportamiento fuera de scope). Acá SOLO las VALIDADAS por tipo.
//
// `field_definitions.config_schema` (M5-C.2, R13.8): el alta de un enum custom escribe config_schema como
// {options:[...]} (jsonb). El guard tg_field_definitions_custom_guard (0093) lee `new.config_schema ->
// 'options'` y exige `jsonb_typeof(options)='array'`. Si se subiera como string JS, PostgREST lo escribiría
// como jsonb-STRING → `-> 'options'` daría NULL → "requires a config_schema.options array" (23514). Por eso
// se decodifica acá ANTES de subir (mismo gotcha que el `value` de M5-C.1). Para los no-enum config_schema es
// null → decodeJsonbColumns lo deja intacto (typeof null !== 'string' → continue).

const JSONB_TEXT_COLUMNS: Record<string, readonly string[]> = {
  custom_measurements: ['value'],
  custom_attributes: ['value'],
  field_definitions: ['config_schema'],
};

/**
 * Parsea in-place (sobre una COPIA) las columnas jsonb-as-TEXT de `table` de su representación JSON-TEXT a su
 * valor JS nativo (número/bool/array/string/objeto). PURA. Si una columna no está presente, es null/undefined,
 * o NO es un string parseable → se deja como está (defensivo: no rompe el upload por un valor inesperado; el
 * server re-valida). Esto evita el doble-encoding del jsonb (un número subiría como `"385"` en vez de `385`).
 */
export function decodeJsonbColumns(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const cols = JSONB_TEXT_COLUMNS[table];
  if (!cols) return data;
  const out = { ...data };
  for (const col of cols) {
    const raw = out[col];
    if (typeof raw !== 'string') continue; // ya es nativo / ausente → no tocar
    try {
      out[col] = JSON.parse(raw);
    } catch {
      // no parsea (no debería: el service siempre serializa con JSON.stringify) → dejar como está; el
      // server lo rechazará si corresponde (mejor que romper el drenado de la cola acá).
    }
  }
  return out;
}

/**
 * Construye el plan de UPSERT (PUT) CRUD-plano. PURA (testeable, sin SDK). Para una tabla normal (PK `id`
 * real) re-inyecta `id` en el payload (idem comportamiento previo del connector). Para una tabla de PK
 * COMPUESTA (custom_attributes) DESCARTA el id sintético del payload y devuelve `onConflict` con la PK natural
 * → PostgREST upsertea por `(animal_profile_id, field_definition_id)` sin tocar una columna `id` inexistente.
 */
export function buildCrudUpsert(
  table: string,
  id: string,
  opData: Record<string, unknown> | null | undefined,
): CrudUpsertPlan {
  // Parsear las columnas jsonb-as-TEXT (value) a su tipo nativo ANTES de subir (evita el doble-encoding).
  const data = decodeJsonbColumns(table, { ...(opData ?? {}) });
  const spec = COMPOSITE_PK[table];
  if (spec) {
    delete data.id; // PK compuesta: el `id` (sintético) NO es columna real → no lo mandamos.
    return { payload: data, onConflict: spec.onConflict };
  }
  return { payload: { ...data, id } }; // PK `id` real.
}

/**
 * Construye el plan de PATCH CRUD-plano. PURA. Para una tabla normal filtra por `{ id }` (idem comportamiento
 * previo del connector). Para una tabla de PK COMPUESTA (custom_attributes) DESCARTA el id del payload y
 * decodifica la PK natural del `op.id` sintético → filtra por `(animal_profile_id, field_definition_id)`
 * (NO por `id`, que no existe). Esto cubre la RE-EDICIÓN de un atributo (el write local ON CONFLICT DO UPDATE
 * se trackea como PATCH con solo `value`). Si el id estuviera mal formado, cae al filtro por `id` (defensivo).
 */
export function buildCrudPatch(
  table: string,
  id: string,
  opData: Record<string, unknown> | null | undefined,
): CrudPatchPlan {
  // Parsear las columnas jsonb-as-TEXT (value) a su tipo nativo ANTES de subir (evita el doble-encoding):
  // una re-edición de un atributo numérico patchea SOLO `value` → debe ir como número, no como `"385"`.
  const data = decodeJsonbColumns(table, { ...(opData ?? {}) });
  const natural = decodeCompositeKey(table, id);
  if (natural) {
    delete data.id; // no actualizar/filtrar por una columna `id` inexistente.
    return { payload: data, match: natural };
  }
  return { payload: data, match: { id } };
}

/**
 * ¿El `code` de Postgres/PostgREST es un rechazo PERMANENTE? (RLS, constraints, checks, dominio).
 * PURA. Cubre: 42501 (RLS/insufficient_privilege), clase 23 (integrity constraint: 23502 not_null,
 * 23503 fk, 23505 unique, 23514 check), 22xxx (data exception), 42xxx (syntax/undefined).
 */
export function isPermanentServerCode(code: string): boolean {
  if (!code) return false;
  if (code === '42501') return true;
  return /^(22|23|42)/.test(code);
}
