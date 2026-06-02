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
  type TimelineItem,
  type TimelineRow,
} from '../utils/event-timeline';

// ─── Error / Result uniforme (mismo shape que animals.ts) ──────────────────────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

function classifyError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
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
  const items = parseTimeline(rows);

  // Resolver los nombres de categoría de los category_change (from/to son UUIDs). Una sola query.
  const categoryIds = collectCategoryIds(items);
  if (categoryIds.length === 0) {
    return { ok: true, value: items };
  }

  const { data: cats, error: catErr } = await supabase
    .from('categories_by_system')
    .select('id, name')
    .in('id', categoryIds);
  // Si la resolución de nombres falla (ej. red intermitente), NO tiramos el timeline entero: el
  // historial sigue siendo útil sin el nombre resuelto (el componente muestra "categoría" de
  // fallback). Solo logueamos implícitamente devolviendo los items sin resolver.
  if (catErr || !cats) {
    return { ok: true, value: items };
  }

  const nameById: Record<string, string> = {};
  for (const c of cats as { id: string; name: string }[]) {
    nameById[c.id] = c.name;
  }
  return { ok: true, value: resolveCategoryNames(items, nameById) };
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
