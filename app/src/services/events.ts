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
// query (NO N+1). Escritura (3 tipos simples de C3.1): addWeight / addConditionScore / addObservation.
//
// ⚠️ Inserts SIN .select() (RLS-on-RETURNING, lección B.1.2/C1): insertamos sin returning; el caller
// re-llama fetchTimeline para refrescar. No necesitamos la fila devuelta. created_by / author_id /
// edit_window_until los setea un trigger desde auth.uid()/now() — NO los mandamos.

import { supabase } from './supabase';
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

// ─── Error / Result uniforme (mismo shape que animals.ts) ──────────────────────────────────

export type AppError = {
  kind: 'network' | 'duplicate_tag' | 'not_authorized' | 'unknown';
  message: string;
};
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

function classifyError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  const code = error?.code ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  // Caravana del ternero duplicada (R9.4): la RPC register_birth revierte TODO el parto si el TAG de
  // cualquier ternero ya está asignado (unique parcial de animals.tag_electronic, R3.2). El cliente da
  // un mensaje accionable. unique violation = 23505, o el msg trae "tag"/"unique"/"duplicate".
  if (code === '23505' || (/duplicate key|unique/i.test(msg) && /tag/i.test(msg))) {
    return {
      kind: 'duplicate_tag',
      message: 'Esa caravana electrónica ya está asignada a otro animal.',
    };
  }
  // La RPC deriva el tenant de la fila REAL de la madre + has_role_in → un caller sin rol recibe 42501
  // (insufficient_privilege). No debería ocurrir desde la ficha (el usuario tiene rol en el campo del
  // animal), pero lo mapeamos a un copy claro por las dudas (defensa, no se cruza tenant client-side).
  if (code === '42501' || /not authorized|permission denied|insufficient/i.test(msg)) {
    return {
      kind: 'not_authorized',
      message: 'No tenés permiso para registrar un parto en este animal.',
    };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

export type { TimelineItem } from '../utils/event-timeline';

// ─── Lectura: cronología (R10.1) ───────────────────────────────────────────────────────────

/**
 * Lee la cronología completa de un animal_profile vía la RPC animal_timeline (R10.1). Parsea las
 * filas crudas a TimelineItem (unión discriminada por kind) y resuelve los nombres de categoría de
 * los category_change en UNA sola query (NO N+1) sobre categories_by_system.
 *
 * RLS (R10.2): la RPC es security definer y filtra por has_role_in dentro de la función → un
 * usuario sin rol en el establishment del animal recibe un set vacío. El cliente no fuerza permisos.
 */
export async function fetchTimeline(profileId: string): Promise<ServiceResult<TimelineItem[]>> {
  const { data, error } = await supabase.rpc('animal_timeline', { profile_id: profileId });
  if (error) return { ok: false, error: classifyError(error) };

  const rows = (data ?? []) as unknown as TimelineRow[];
  let items = parseTimeline(rows);

  // (1) Resolver los nombres de categoría de los category_change (from/to son UUIDs). Una sola query.
  // Tolerante: si la resolución falla (red intermitente) NO tiramos el timeline — el historial sigue
  // siendo útil sin el nombre resuelto (el componente muestra "categoría" de fallback).
  const categoryIds = collectCategoryIds(items);
  if (categoryIds.length > 0) {
    const { data: cats, error: catErr } = await supabase
      .from('categories_by_system')
      .select('id, name')
      .in('id', categoryIds);
    if (!catErr && cats) {
      const nameById: Record<string, string> = {};
      for (const c of cats as { id: string; name: string }[]) {
        nameById[c.id] = c.name;
      }
      items = resolveCategoryNames(items, nameById);
    }
  }

  // (2) Enriquecer service_type de los eventos reproductivos (la RPC NO lo trae). Mismo patrón
  // tolerante que la resolución de categorías: UNA query suplementaria a reproductive_events (RLS la
  // protege igual que la RPC), mapa eventId→ReproMeta, applyReproMeta (puro). El `created_at` YA NO se
  // pide acá: la RPC 0069 lo trae top-level para TODOS los kinds (es lo que ordena el timeline dentro
  // de un día y desempata el estado reproductivo vigente del mismo día). Si la query falla o no hay
  // eventos reproductivos, devolvemos los items sin enriquecer (el timeline NO se pierde; serviceType
  // queda null y el detalle del nodo "Servicio" muestra el fallback).
  const hasReproductive = items.some((it) => it.kind === 'reproductive');
  if (hasReproductive) {
    const { data: repro, error: reproErr } = await supabase
      .from('reproductive_events')
      .select('id, service_type')
      .eq('animal_profile_id', profileId);
    if (!reproErr && repro) {
      const byId: Record<string, ReproMeta> = {};
      for (const r of repro as {
        id: string;
        service_type: string | null;
      }[]) {
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

type MotherRow = {
  reproductive_events: {
    animal_profiles: {
      id: string;
      idv: string | null;
      visual_id_alt: string | null;
      status: 'active' | 'sold' | 'dead' | 'transferred';
      animals: { tag_electronic: string | null } | null;
      categories_by_system: { name: string } | null;
    } | null;
  } | null;
};

/**
 * Resuelve la MADRE de un ternero (R14.7) vía birth_calves. Devuelve null si el animal no es un
 * ternero con parto registrado. Tolera madre con status ≠ active (R4.15): NO filtra por status.
 */
export async function fetchMother(calfProfileId: string): Promise<ServiceResult<MotherLink | null>> {
  // Nested select por los FKs: birth_calves → reproductive_events (parto) → animal_profiles (madre).
  //
  // ⚠️ DISAMBIGUACIÓN OBLIGATORIA: reproductive_events tiene TRES FKs a animal_profiles
  // (animal_profile_id = madre, calf_id = 1er ternero, bull_id = toro). Un embed pelado
  // `animal_profiles!inner` es AMBIGUO → PostgREST no sabe qué relación seguir y la query falla
  // (PGRST201), dejando la card "Madre" sin mostrarse (silenciosamente: fetchMother cae al error
  // blando). Hay que nombrar la columna FK: `animal_profiles!animal_profile_id` fuerza el lado MADRE.
  // (Las dos hops internas — animals via animal_id, categories_by_system via category_id — tienen un
  // único FK cada una → NO necesitan hint.)
  //
  // !inner para que las filas sin la relación no devuelvan basura; el lado de animals/categorías es
  // left de hecho (un identificador puede faltar). limit 1: un ternero pertenece a UN parto (PK
  // (birth_event_id, calf_profile_id) — un calf no se duplica entre partos).
  const { data, error } = await supabase
    .from('birth_calves')
    .select(
      'reproductive_events!inner (' +
        ' animal_profiles!animal_profile_id!inner (' +
        '   id, idv, visual_id_alt, status,' +
        '   animals!inner ( tag_electronic ),' +
        '   categories_by_system!inner ( name )' +
        ' )' +
        ')',
    )
    .eq('calf_profile_id', calfProfileId)
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, error: classifyError(error) };
  if (!data) return { ok: true, value: null }; // no es ternero con parto registrado → sin link

  const mother = (data as unknown as MotherRow).reproductive_events?.animal_profiles ?? null;
  if (!mother) return { ok: true, value: null };

  const label =
    cleanStr(mother.idv) ??
    cleanStr(mother.visual_id_alt) ??
    cleanStr(mother.animals?.tag_electronic ?? null) ??
    'Madre';

  return {
    ok: true,
    value: {
      profileId: mother.id,
      label,
      status: mother.status,
      categoryName: mother.categories_by_system?.name ?? '',
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
 * Inserta un weight_event (R6.1). created_by lo setea el trigger desde auth.uid() (NO se manda).
 * source default 'manual' en el DB. Insert SIN .select() (RLS-on-RETURNING); el caller re-fetchea.
 */
export async function addWeight(input: AddWeightInput): Promise<ServiceResult<true>> {
  const payload: Record<string, unknown> = {
    animal_profile_id: input.profileId,
    weight_kg: input.weightKg,
    weight_date: input.weightDate,
  };
  const notes = cleanStr(input.notes);
  if (notes) payload.notes = notes;

  const { error } = await supabase.from('weight_events').insert(payload);
  if (error) return { ok: false, error: classifyError(error) };
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
 * Inserta un condition_score_event (R6.4). El score viene de un selector CERRADO (nunca texto
 * libre) → siempre cumple el CHECK del DB (0028). created_by por trigger. Insert SIN .select().
 */
export async function addConditionScore(
  input: AddConditionScoreInput,
): Promise<ServiceResult<true>> {
  const payload: Record<string, unknown> = {
    animal_profile_id: input.profileId,
    score: input.score,
    event_date: input.eventDate,
  };
  const notes = cleanStr(input.notes);
  if (notes) payload.notes = notes;

  const { error } = await supabase.from('condition_score_events').insert(payload);
  if (error) return { ok: false, error: classifyError(error) };
  return { ok: true, value: true };
}

// ─── Escritura: reproductivo — tacto / servicio (R6.2) ───────────────────────────────────────
//
// reproductive_events deriva su tenant del animal_profile_id vía RLS (with check has_role_in(
// establishment_of_profile(...))) → NO se manda establishment_id, solo el profileId. created_by lo
// setea el trigger desde auth.uid() — NO se manda. Inserts SIN .select() (RLS-on-RETURNING).
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
 * Inserta un evento reproductivo `tacto` (R6.2). El pregnancy_status viene de un selector CERRADO →
 * siempre cumple el enum del DB. created_by por trigger. Insert SIN .select(); el caller re-fetchea.
 */
export async function addTacto(input: AddTactoInput): Promise<ServiceResult<true>> {
  const payload: Record<string, unknown> = {
    animal_profile_id: input.profileId,
    event_type: 'tacto',
    event_date: input.eventDate,
    pregnancy_status: input.pregnancyStatus,
  };
  const notes = cleanStr(input.notes);
  if (notes) payload.notes = notes;

  const { error } = await supabase.from('reproductive_events').insert(payload);
  if (error) return { ok: false, error: classifyError(error) };
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
 * Inserta un evento reproductivo `abortion` (pérdida de la preñez). created_by por trigger. Insert SIN
 * .select(); el caller re-fetchea. deriveCurrentState ya trata `abortion` como determinante de preñez
 * → deja el estado "Vacía" (vía aborto). El flag "tuvo aborto" de la ficha lo deriva hasAbortion.
 */
export async function addAbortion(input: AddAbortionInput): Promise<ServiceResult<true>> {
  const payload: Record<string, unknown> = {
    animal_profile_id: input.profileId,
    event_type: 'abortion',
    event_date: input.eventDate,
  };
  const notes = cleanStr(input.notes);
  if (notes) payload.notes = notes;

  const { error } = await supabase.from('reproductive_events').insert(payload);
  if (error) return { ok: false, error: classifyError(error) };
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
 * Inserta un evento reproductivo `service` (R6.2). El service_type viene de un selector CERRADO →
 * siempre cumple el enum del DB. NO dispara transición de categoría. created_by por trigger. Insert
 * SIN .select(); el caller re-fetchea.
 */
export async function addService(input: AddServiceInput): Promise<ServiceResult<true>> {
  const payload: Record<string, unknown> = {
    animal_profile_id: input.profileId,
    event_type: 'service',
    event_date: input.eventDate,
    service_type: input.serviceType,
  };
  const notes = cleanStr(input.notes);
  if (notes) payload.notes = notes;

  const { error } = await supabase.from('reproductive_events').insert(payload);
  if (error) return { ok: false, error: classifyError(error) };
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
 * Registra un parto vía la RPC register_birth (R9/R7.9/R9.5). Mapea cada ternero al shape del payload
 * jsonb que la RPC espera (`{ calf_sex, calf_weight?, calf_tag_electronic? }`), omitiendo el peso y el
 * tag cuando no vinieron (la RPC los trata como NULL → fallback visual del ternero sin tag, R9.1).
 *
 * Devuelve { birthEventId } — la RPC devuelve el uuid del evento de parto como escalar (data es el
 * string). Errores mapeados con classifyError: tag duplicado → kind 'duplicate_tag' (mensaje
 * accionable, R9.4 = rollback atómico server-side); sin rol → 'not_authorized'.
 */
export async function registerBirth(
  input: RegisterBirthInput,
): Promise<ServiceResult<{ birthEventId: string }>> {
  const calves = input.calves.map((c) => {
    const payload: Record<string, unknown> = { calf_sex: c.sex };
    if (c.weightKg != null) payload.calf_weight = c.weightKg;
    const tag = cleanStr(c.tag);
    if (tag) payload.calf_tag_electronic = tag;
    return payload;
  });

  const { data, error } = await supabase.rpc('register_birth', {
    p_mother_profile_id: input.motherProfileId,
    p_event_date: input.eventDate,
    p_calves: calves,
  });
  if (error) return { ok: false, error: classifyError(error) };
  // La RPC devuelve el uuid del evento de parto como escalar (string). Defensivo si vuelve null.
  const birthEventId = typeof data === 'string' ? data : '';
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
 * Inserta una observación libre en animal_events (R6.10, modelo Híbrido). event_type fijo
 * 'observacion'. author_id y edit_window_until (now()+15min) los setea el trigger/default — NO se
 * mandan. establishment_id se deriva del PERFIL (ver nota del tipo). Insert SIN .select().
 */
export async function addObservation(input: AddObservationInput): Promise<ServiceResult<true>> {
  const payload: Record<string, unknown> = {
    animal_profile_id: input.profileId,
    establishment_id: input.establishmentId,
    event_type: 'observacion',
    text: input.text,
  };

  const { error } = await supabase.from('animal_events').insert(payload);
  if (error) return { ok: false, error: classifyError(error) };
  return { ok: true, value: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────

function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
