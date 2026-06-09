// Capa de datos de eventos cronológicos del animal (spec 02 frontend C3.1, R10/R14).
//
// Service DELGADO y SWAPPABLE (espeja animals.ts): mismo ServiceResult<T>/AppError + classifyError.
// PowerSync es C5 (diferido) — los services son la ÚNICA capa que tocará PowerSync; mantenerlos
// finos. RLS protege server-side (la RPC animal_timeline es security definer + has_role_in; los
// inserts pasan por policies has_role_in(establishment_of_profile(...))). El cliente NO fuerza
// permisos: la RLS es la barrera real (R11/R10.2).
//
// Lectura: fetchTimeline llama la RPC animal_timeline (0035), parsea cada fila a un TimelineItem
// (event-timeline.ts, puro) y resuelve los nombres de categoría de los category_change en UNA sola
// query (NO N+1).
//
// ESCRITURA OFFLINE — CRUD plano (spec 15, T5 / R6.1, R6.3, R6.4). addWeight / addConditionScore /
// addTacto / addService / addAbortion / addObservation pasan de `supabase.from(T).insert(...)` a un
// INSERT LOCAL sobre la tabla SINCRONIZADA (`getPowerSync().execute(...)` vía runLocalWrite). PowerSync
// encola UNA CrudEntry → connector.uploadData() la sube al reconectar (RLS+triggers+CHECKs re-validan,
// R6.2/R8.1). La fila aparece LOCAL al instante → fetchTimeline (local, T4) la ve enseguida, OFFLINE.
//
// CONTRATO (T5): el local write SIEMPRE tiene éxito offline → devuelven ok apenas la fila está en
// SQLite. El fallo de UPLOAD (RLS reject = permanente) lo maneja uploadData (descarta + superficia por
// el canal de status/error, R8.1) — NO por el return del add* (que ya devolvió ok con la fila local).
//
// id de CLIENTE (R6.4, crypto.randomUUID). created_by / author_id / edit_window_until / establishment_id
// (de las tablas de evento, 0077) los FUERZA el trigger server-side al SUBIR (desde auth.uid()/now()/el
// perfil) → NO se mandan en el INSERT local (quedan NULL local; las lecturas T4 no dependen de ellos para
// estos eventos). EXCEPCIÓN: animal_events.establishment_id tiene trigger de VALIDACIÓN (no force) → SÍ se
// setea, derivado del PERFIL (ver addObservation). Sin .select()/RETURNING → R6.3 (gotcha desaparece).

import {
  parseTimeline,
  collectCategoryIds,
  resolveCategoryNames,
  applyReproMeta,
  type ReproMeta,
  type TimelineItem,
  type TimelineRow,
  type PregnancyStatus,
  type ServiceType,
} from '../utils/event-timeline';
import {
  buildTimelineQuery,
  buildReproServiceTypesQuery,
  buildCategoryNamesQuery,
  buildMotherQuery,
  buildAddWeightInsert,
  buildAddConditionScoreInsert,
  buildAddTactoInsert,
  buildAddServiceInsert,
  buildAddAbortionInsert,
  buildAddObservationInsert,
  buildBirthOverlayContextQuery,
  buildCategoryIdByCodeQuery,
  type PendingProfileFields,
} from './powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle, runLocalWrite } from './powersync/local-query';
import { enqueueRegisterBirth, type EnqueueBirthCalfOverlay } from './powersync/outbox';

// ─── Error / Result uniforme (mismo shape que animals.ts) ──────────────────────────────────

// AppError conserva los kinds duplicate_tag/not_authorized en el TIPO (shape compartido). Con el swap a
// OUTBOX (T6) registerBirth ya NO clasifica el 23505/42501 en el return: el encolado SIEMPRE tiene éxito
// offline y el rechazo REAL (tag de ternero duplicado, sin rol) lo resuelve uploadData al SUBIR (rollback
// del overlay + superficia por el canal de status, R8.1) — NO por el return de registerBirth.
export type AppError = {
  kind: 'network' | 'duplicate_tag' | 'not_authorized' | 'unknown';
  message: string;
};
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type { TimelineItem } from '../utils/event-timeline';

// ─── Lectura: cronología (R10.1) ───────────────────────────────────────────────────────────

// Fila cruda del UNION ALL local (buildTimelineQuery). El payload baja como TEXT (json_object) → se
// JSON.parse a un Record antes de pasarlo a parseTimeline.
type LocalTimelineRow = {
  event_kind: string;
  event_id: string;
  event_date: string;
  created_at: string;
  payload: string | null;
};

/**
 * Parsea el `payload` TEXT (json_object de SQLite) a un Record para parseTimelineRow. Tolerante: un
 * payload null o malformado cae a null (el parser ya tolera campos faltantes). NO rompe el timeline.
 */
function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw);
    return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Lee la cronología completa de un animal_profile desde el SQLite local (T4.2/R10.1), reconstruyendo
 * el UNION ALL de los 7 orígenes de la RPC animal_timeline (0069) sobre las tablas de evento ya
 * sincronizadas. Parsea las filas crudas a TimelineItem (unión discriminada por kind) y resuelve los
 * nombres de categoría de los category_change + el service_type de los reproductivos con queries
 * locales suplementarias (NO N+1).
 *
 * Scoping (R10.2): la stream ya sincronizó solo los eventos de los campos del usuario → el dato local
 * ya es el autorizado; NO se re-filtra has_role_in (la RPC lo hacía server-side; la equivalencia la
 * garantiza la stream). El `deleted_at IS NULL` por origen sí se conserva (igual que la RPC).
 */
export async function fetchTimeline(profileId: string): Promise<ServiceResult<TimelineItem[]>> {
  // emptyIsSyncing:false — un animal sin eventos es un timeline legítimamente vacío (la ficha lo
  // maneja); no degradamos a "Sincronizando" por eso.
  const tl = await runLocalQuery<LocalTimelineRow>(buildTimelineQuery(profileId), {
    emptyIsSyncing: false,
  });
  if (!tl.ok) return { ok: false, error: { kind: tl.error.kind, message: tl.error.message } };

  const rows: TimelineRow[] = tl.value.map((r) => ({
    event_kind: r.event_kind,
    event_id: r.event_id,
    event_date: r.event_date,
    created_at: r.created_at,
    payload: parsePayload(r.payload),
  }));
  let items = parseTimeline(rows);

  // (1) Resolver los nombres de categoría de los category_change (from/to son UUIDs). Una sola query
  // local. Tolerante: si falla NO tiramos el timeline — el historial sigue siendo útil sin el nombre.
  const categoryIds = collectCategoryIds(items);
  if (categoryIds.length > 0) {
    const cats = await runLocalQuery<{ id: string; name: string }>(
      buildCategoryNamesQuery(categoryIds),
      { emptyIsSyncing: false },
    );
    if (cats.ok) {
      const nameById: Record<string, string> = {};
      for (const c of cats.value) {
        nameById[c.id] = c.name;
      }
      items = resolveCategoryNames(items, nameById);
    }
  }

  // (2) Enriquecer service_type de los eventos reproductivos (el UNION del timeline NO lo trae, igual
  // que la RPC). UNA query local suplementaria a reproductive_events, mapa eventId→ReproMeta,
  // applyReproMeta (puro). Tolerante: si falla o no hay reproductivos, items sin enriquecer (el
  // timeline NO se pierde; serviceType queda null y el nodo "Servicio" muestra el fallback).
  const hasReproductive = items.some((it) => it.kind === 'reproductive');
  if (hasReproductive) {
    const repro = await runLocalQuery<{ id: string; service_type: string | null }>(
      buildReproServiceTypesQuery(profileId),
      { emptyIsSyncing: false },
    );
    if (repro.ok) {
      const byId: Record<string, ReproMeta> = {};
      for (const r of repro.value) {
        byId[r.id] = { serviceType: r.service_type };
      }
      items = applyReproMeta(items, byId);
    }
  }

  return { ok: true, value: items };
}

// ─── Lectura: link a la MADRE (R14.7 / R4.15) ────────────────────────────────────────────────
//
// Resuelve calf → madre vía la tabla puente birth_calves (no vía reproductive_events.calf_id: ese
// solo apunta al PRIMER ternero de un parto de mellizos; birth_calves cubre TODOS los terneros, R7.9).
//
// Cadena: birth_calves (calf_profile_id = X) → birth_event_id → reproductive_events.animal_profile_id
// (= la madre) → identidad de la madre (idv/visual/tag, nombre de categoría, status). Un solo nested
// select de PostgREST por los FKs. RLS: birth_calves_select deriva el establishment de la madre y
// filtra el evento soft-deleted; reproductive_events/animal_profiles tienen sus propias policies por
// has_role_in. El cliente NO fuerza permisos — la RLS es la barrera (R11).
//
// ⚠️ NO filtramos por `status` de la madre (R14.7/R4.15): la madre puede estar vendida/muerta/
// transferida y el link DEBE funcionar igual (se muestra archivada, sin dead-end). NO filtramos
// `deleted_at` de la madre acá tampoco — birth_calves nunca apunta a un perfil hard-deleteado (R4.15
// prohíbe hard-delete de un perfil referenciado como calf_id), y el join !inner trae la madre si existe.
//
// Devuelve null si el animal NO es un ternero con parto registrado (no hay fila en birth_calves) → la
// ficha NO muestra link. Tolerante: si la query falla (red), devolvemos el error blando (la ficha lo
// trata como "sin link", no rompe la cabecera).

export type MotherLink = {
  /** profileId de la madre (para navegar a su ficha). */
  profileId: string;
  /** idv ?? visual ?? tag ?? "Madre" — el identificador a mostrar. */
  label: string;
  /** status de la madre (active/sold/dead/transferred) — para el indicador de archivada (R14.7). */
  status: 'active' | 'sold' | 'dead' | 'transferred';
  /** Nombre de la categoría de la madre (ej. "Vaca multípara"). */
  categoryName: string;
};

// Fila cruda del JOIN local (buildMotherQuery; shape PLANO, identidad de la madre desde animal_profiles).
type LocalMotherRow = {
  id: string;
  idv: string | null;
  visual_id_alt: string | null;
  status: 'active' | 'sold' | 'dead' | 'transferred';
  tag_electronic: string | null;
  category_name: string | null;
};

/**
 * Resuelve la MADRE de un ternero (R14.7) vía birth_calves, desde el SQLite local (T4.2). Cadena de
 * JOINs: birth_calves (calf_profile_id = ?) → reproductive_events (parto, deleted_at IS NULL) →
 * animal_profiles (la madre). Identidad de la madre (tag) desde animal_profiles (b1; antes JOIN a
 * `animals`). Devuelve null si el animal no es un ternero con parto registrado. Tolera madre con
 * status ≠ active (R4.15): NO filtra por status. El scoping ya lo aplicaron las streams (las 3 tablas
 * sincronizan scopeadas) → no se re-filtra tenant.
 *
 * Tolerante: si la query falla devolvemos el error blando (la ficha lo trata como "sin link"). LIMIT 1
 * (un ternero pertenece a UN parto, PK compuesta de birth_calves).
 */
export async function fetchMother(calfProfileId: string): Promise<ServiceResult<MotherLink | null>> {
  // emptyIsSyncing:false — "no es ternero con parto" es un resultado de negocio válido (null), no
  // necesariamente falta de sync → no degradamos.
  const r = await runLocalQuerySingle<LocalMotherRow>(buildMotherQuery(calfProfileId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  const mother = r.value;
  if (!mother) return { ok: true, value: null }; // no es ternero con parto registrado → sin link

  const label =
    cleanStr(mother.idv) ??
    cleanStr(mother.visual_id_alt) ??
    cleanStr(mother.tag_electronic) ??
    'Madre';

  return {
    ok: true,
    value: {
      profileId: mother.id,
      label,
      status: mother.status,
      categoryName: mother.category_name ?? '',
    },
  };
}

// ─── Escritura: peso (R6.1) ─────────────────────────────────────────────────────────────────

export type AddWeightInput = {
  profileId: string;
  /** Kilos (> 0, parte entera ≤ 4 cifras / < 10000). Ya validado por validateWeight en el caller. */
  weightKg: number;
  /** ISO 'YYYY-MM-DD'. weight_date NOT NULL. */
  weightDate: string;
  notes?: string | null;
};

/**
 * Inserta un weight_event LOCAL (R6.1, offline) → upload queue. id de cliente. created_by/source/
 * establishment_id los pone el trigger/default al SUBIR (NO se mandan). La fila aparece local al
 * instante → fetchTimeline (local) la ve; el caller re-fetchea. R6.3: sin split-insert/.select().
 */
export async function addWeight(input: AddWeightInput): Promise<ServiceResult<true>> {
  const q = buildAddWeightInsert(
    randomUuid(),
    input.profileId,
    input.weightKg,
    input.weightDate,
    cleanStr(input.notes),
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Escritura: condición corporal (R6.4) ───────────────────────────────────────────────────

export type AddConditionScoreInput = {
  profileId: string;
  /** Uno de los 17 valores válidos (1.00→5.00 paso 0.25). El selector cerrado lo garantiza. */
  score: number;
  /** ISO 'YYYY-MM-DD'. event_date NOT NULL. */
  eventDate: string;
  notes?: string | null;
};

/**
 * Inserta un condition_score_event LOCAL (R6.4, offline) → upload queue. id de cliente. El score viene
 * de un selector CERRADO → cumple el CHECK del DB (0028) al SUBIR. created_by/establishment_id por
 * trigger. R6.3: sin split-insert/.select().
 */
export async function addConditionScore(
  input: AddConditionScoreInput,
): Promise<ServiceResult<true>> {
  const q = buildAddConditionScoreInsert(
    randomUuid(),
    input.profileId,
    input.score,
    input.eventDate,
    cleanStr(input.notes),
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Escritura: reproductivo — tacto / servicio (R6.2) ───────────────────────────────────────
//
// INSERT LOCAL (T5.1, offline) → upload queue. reproductive_events deriva su tenant del
// animal_profile_id: la RLS (with check has_role_in(establishment_of_profile(...))) lo valida al SUBIR,
// y el trigger 0077 FUERZA establishment_id desde el perfil → NO se manda en el INSERT local (queda
// NULL local; el timeline T4 filtra por animal_profile_id). created_by lo setea el trigger desde
// auth.uid() — NO se manda. R6.3: sin split-insert/.select().
//
// ⚠️ Efecto colateral server-side (NO se toca desde el cliente): un `tacto` con pregnancy_status ≠
// 'empty' sobre una vaquillona dispara la transición de categoría a vaquillona_prenada (trigger
// reproductive_events_apply_transition, si category_override=false). El cliente solo re-fetchea el
// timeline + el detalle al volver a la ficha. `service` NO dispara transición (es un registro).

export type AddTactoInput = {
  profileId: string;
  /** Resultado del tacto. Viene de un selector CERRADO (PREGNANCY_OPTIONS) → siempre un enum válido. */
  pregnancyStatus: PregnancyStatus;
  /** ISO 'YYYY-MM-DD'. event_date es columna `date` NOT NULL. */
  eventDate: string;
  notes?: string | null;
};

/**
 * Inserta un evento reproductivo `tacto` LOCAL (R6.2, offline) → upload queue. id de cliente. El
 * pregnancy_status viene de un selector CERRADO → cumple el enum del DB al SUBIR. La TRANSICIÓN de
 * categoría de la madre la dispara el trigger AFTER INSERT al subir la fila a PostgREST (no local) — el
 * cliente re-fetchea la ficha al volver. created_by/establishment_id por trigger. R6.3: sin .select().
 */
export async function addTacto(input: AddTactoInput): Promise<ServiceResult<true>> {
  const q = buildAddTactoInsert(
    randomUuid(),
    input.profileId,
    input.pregnancyStatus,
    input.eventDate,
    cleanStr(input.notes),
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Escritura: reproductivo — aborto (R6.2 / dominio Facundo §1) ────────────────────────────
//
// Un `abortion` es la pérdida de la preñez. MISMO patrón que addTacto: insert mínimo en
// reproductive_events (event_type 'abortion'), tenant por RLS (with check has_role_in), created_by por
// trigger. SIN .select() (RLS-on-RETURNING). No lleva pregnancy_status ni service_type.
//
// ⚠️ Efecto colateral server-side (NO se toca desde el cliente, dominio Facundo §1): un aborto REVIERTE
// la preñez de la categoría — `vaquillona_prenada → vaquillona` (vía el trigger de transición, si
// category_override=false); una vaca de 2º servicio/multípara que aborta QUEDA igual (ya tiene partos
// contados). El "flag rojo permanente" (A2) se DERIVA de la existencia del evento (hasAbortion), no es
// una columna de estado → el cliente solo re-fetchea el timeline al volver a la ficha.

export type AddAbortionInput = {
  profileId: string;
  /** ISO 'YYYY-MM-DD'. event_date es columna `date` NOT NULL. */
  eventDate: string;
  notes?: string | null;
};

/**
 * Inserta un evento reproductivo `abortion` LOCAL (pérdida de la preñez, offline) → upload queue. id de
 * cliente. created_by/establishment_id por trigger; la REVERSIÓN de preñez (categoría) la dispara el
 * trigger al SUBIR. deriveCurrentState ya trata `abortion` como determinante (estado "Vacía"). El flag
 * "tuvo aborto" de la ficha lo deriva hasAbortion del timeline (local). R6.3: sin .select().
 */
export async function addAbortion(input: AddAbortionInput): Promise<ServiceResult<true>> {
  const q = buildAddAbortionInsert(
    randomUuid(),
    input.profileId,
    input.eventDate,
    cleanStr(input.notes),
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

export type AddServiceInput = {
  profileId: string;
  /** Tipo de servicio. Viene de un selector CERRADO (SERVICE_TYPE_OPTIONS) → siempre un enum válido. */
  serviceType: ServiceType;
  /** ISO 'YYYY-MM-DD'. event_date es columna `date` NOT NULL. */
  eventDate: string;
  notes?: string | null;
};

/**
 * Inserta un evento reproductivo `service` LOCAL (R6.2, offline) → upload queue. id de cliente. El
 * service_type viene de un selector CERRADO → cumple el enum del DB al SUBIR. NO dispara transición de
 * categoría. created_by/establishment_id por trigger. R6.3: sin .select().
 */
export async function addService(input: AddServiceInput): Promise<ServiceResult<true>> {
  const q = buildAddServiceInsert(
    randomUuid(),
    input.profileId,
    input.serviceType,
    input.eventDate,
    cleanStr(input.notes),
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Escritura: PARTO — register_birth (R9 / R7.9 / R9.5) ─────────────────────────────────────
//
// Un parto = UN evento `birth` con 1..N terneros (mellizos), creado ATÓMICAMENTE por la RPC
// register_birth (0045): el server crea el evento + por CADA ternero un animals + animal_profile
// (hereda establishment + rodeo de la madre, category_id = ternero|ternera por sexo,
// entry_origin='born_here', status='active', sin lote) + una fila en el puente birth_calves. Si
// CUALQUIER ternero falla → rollback total (R9.4/R9.5). Devuelve el reproductive_events.id del parto.
//
// ⚠️ El cliente DEBE usar SIEMPRE esta RPC para el parto (1..N uniforme), NUNCA inserts directos a
// reproductive_events con campos calf_* (eso es el trigger mono-ternero, que la RPC esquiva insertando
// el evento sin calf_sex). NO usamos .select() (es una RPC que devuelve un escalar uuid → OK).
//
// Server-side, además: la TRANSICIÓN de categoría de la madre (vaquillona_prenada →
// vaca_segundo_servicio → multipara si category_override=false) la hace un trigger AFTER INSERT del
// evento de parto; y la creación de los terneros la hace la RPC. El cliente NO toca nada de eso: al
// volver a la ficha, el useFocusEffect re-fetchea y refleja el badge nuevo + el nodo "Parto".
//
// Multi-tenant: el cliente manda SOLO motherProfileId + fecha + terneros. La RPC deriva el tenant de
// la fila REAL de la madre + has_role_in (un caller sin rol recibe 42501). NO se manda establishment_id.

/** Un ternero del parto (lo que el form arma). sexo REQUERIDO; peso/tag opcionales. */
export type BirthCalfInput = {
  sex: 'male' | 'female';
  /** Peso al nacer en kg (> 0 si viene). Opcional. */
  weightKg?: number | null;
  /** Caravana electrónica FDX-B (15 díg). Opcional — sin TAG el server pone el fallback visual. */
  tag?: string | null;
};

export type RegisterBirthInput = {
  motherProfileId: string;
  /** ISO 'YYYY-MM-DD'. event_date del parto. */
  eventDate: string;
  /** Al menos 1 ternero (lo garantiza validateCalves en el caller). */
  calves: BirthCalfInput[];
};

/**
 * Registra un parto OFFLINE-FIRST vía la OUTBOX (T6.2f). Es una op (b) RPC-bound (register_birth crea el
 * evento de parto + N terneros + N birth_calves + la transición de categoría de la madre, ATÓMICO
 * server-side). Mapea cada ternero al payload jsonb que la RPC espera (`{ calf_sex, calf_weight?,
 * calf_tag_electronic? }`) y encola:
 *   - la INTENCIÓN `register_birth` (los params de la RPC; uploadData le inyecta p_client_op_id = el
 *     client_op_id, dedup explícita del delta 0075 → un reintento at-least-once NO crea un 2do parto, R6.10).
 *   - el EFECTO OPTIMISTA en el overlay: el parto en pending_reproductive_events (visible en la cronología
 *     de la madre vía UNION) + por cada ternero pending_animals/pending_animal_profiles/pending_birth_calves
 *     (visibles en la lista + el link calf→madre). Los ids "visuales" son de cliente PROVISIONALES (los
 *     reales los asigna la RPC al subir; el ACK limpia el overlay y las filas reales bajan por la stream).
 *
 * Los terneros HEREDAN establishment_id + rodeo_id de la MADRE (igual que la RPC) y su categoría
 * (ternero/ternera) se resuelve por el system del rodeo de la madre — todo DESDE LOCAL (la madre/rodeo/
 * catálogo ya sincronizaron). Devuelve { birthEventId } = el id PROVISIONAL del parto (offline-first: el
 * real lo asigna la RPC). La firma pública NO cambia (R11.1). El rechazo REAL (tag duplicado, sin rol) lo
 * resuelve uploadData al subir (rollback del overlay + superficia, R8.1) — NO el return de acá.
 */
export async function registerBirth(
  input: RegisterBirthInput,
): Promise<ServiceResult<{ birthEventId: string }>> {
  const calvesPayload = input.calves.map((c) => {
    const payload: Record<string, unknown> = { calf_sex: c.sex };
    if (c.weightKg != null) payload.calf_weight = c.weightKg;
    const tag = cleanStr(c.tag);
    if (tag) payload.calf_tag_electronic = tag;
    return payload;
  });

  // Contexto de la MADRE para el overlay optimista de los terneros (heredan est+rodeo; categoría por
  // system). DESDE LOCAL (la madre ya está sincronizada). emptyIsSyncing:true: si el catálogo/perfil aún
  // no bajó, degrada a "Sincronizando" (no encola un parto sin poder armar el overlay).
  const ctx = await runLocalQuerySingle<{
    establishment_id: string; rodeo_id: string; species_id: string; system_id: string;
  }>(buildBirthOverlayContextQuery(input.motherProfileId), { emptyIsSyncing: true });
  if (!ctx.ok) return { ok: false, error: { kind: ctx.error.kind, message: ctx.error.message } };
  if (!ctx.value) {
    return { ok: false, error: { kind: 'unknown', message: 'No se encontró la madre para registrar el parto.' } };
  }
  const { establishment_id, rodeo_id, species_id, system_id } = ctx.value;

  // Resolver category_id de ternero y ternera (por si el parto trae ambos sexos) — DESDE LOCAL.
  const catByCode: Record<'male' | 'female', string | null> = { male: null, female: null };
  for (const [sex, code] of [['male', 'ternero'], ['female', 'ternera']] as const) {
    if (input.calves.some((c) => c.sex === sex)) {
      const r = await runLocalQuerySingle<{ id: string }>(
        buildCategoryIdByCodeQuery(system_id, code),
        { emptyIsSyncing: true },
      );
      if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
      catByCode[sex] = r.value?.id ?? null;
    }
  }

  const birthEventId = randomUuid();
  const createdAt = new Date().toISOString();
  const overlayCalves: EnqueueBirthCalfOverlay[] = input.calves.map((c) => {
    const calfAnimalId = randomUuid();
    const calfProfileId = randomUuid();
    const tag = cleanStr(c.tag);
    // El ternero sin tag muestra el fallback visual de la RPC (R9.1) en el overlay.
    const visualFallback = tag ? null : 'recién nacido — pendiente de caravana';
    const profile: PendingProfileFields = {
      animalId: calfAnimalId,
      establishmentId: establishment_id,
      rodeoId: rodeo_id,
      managementGroupId: null,
      idv: null,
      visualIdAlt: visualFallback,
      categoryId: catByCode[c.sex] ?? '',
      categoryOverride: false,
      breed: null,
      coatColor: null,
      entryDate: input.eventDate,
      entryWeight: c.weightKg ?? null,
      status: 'active',
      createdBy: null,
      animalTagElectronic: tag,
      animalSex: c.sex,
      animalBirthDate: input.eventDate,
      createdAt,
    };
    return {
      calfProfileId,
      calfAnimalId,
      profile,
      animal: { tagElectronic: tag, speciesId: species_id, sex: c.sex, birthDate: input.eventDate },
    };
  });

  const enq = await enqueueRegisterBirth({
    params: {
      p_mother_profile_id: input.motherProfileId,
      p_event_date: input.eventDate,
      p_calves: calvesPayload,
    },
    motherProfileId: input.motherProfileId,
    eventDate: input.eventDate,
    birthEventId,
    calves: overlayCalves,
  });
  if (!enq.ok) return { ok: false, error: { kind: 'unknown', message: enq.error.message } };
  return { ok: true, value: { birthEventId } };
}

// ─── Escritura: observación libre (R6.10) ────────────────────────────────────────────────────

export type AddObservationInput = {
  profileId: string;
  /**
   * establishment_id del PERFIL (NO del contexto activo). animal_events.establishment_id está
   * denormalizado y un trigger valida que coincida con el establishment del perfil (error 23514 si
   * no coincide). Por eso el caller DEBE derivarlo del perfil — un usuario con rol en varios campos
   * podría tener activo el campo B mientras la ficha es del campo A. Ver fetchAnimalDetail.
   */
  establishmentId: string;
  /** Texto de la observación. Ya validado (no vacío, ≤ tope) por validateObservation. */
  text: string;
};

/**
 * Inserta una observación libre LOCAL en animal_events (R6.10, offline) → upload queue. id de cliente.
 * event_type fijo 'observacion'. author_id y edit_window_until (now()+15min) los setea el trigger/
 * default al SUBIR — NO se mandan. ⚠️ establishment_id SÍ se setea (EXCEPCIÓN): animal_events tiene un
 * trigger de VALIDACIÓN (no force) que exige que coincida con el del PERFIL (23514 si no) → el caller
 * lo deriva del perfil (ver nota del tipo), no del contexto activo. R6.3: sin .select().
 */
export async function addObservation(input: AddObservationInput): Promise<ServiceResult<true>> {
  const q = buildAddObservationInsert(
    randomUuid(),
    input.profileId,
    input.establishmentId,
    input.text,
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────

function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** UUID v4 de cliente (R6.4). crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
