// reports.ts — capa de datos de los REPORTES (spec 07 Stream C — FRONTEND, design §1/§4).
//
// ONLINE-ONLY por diseño (context.md §7, R7.2.1): los reportes se computan SERVER-SIDE (9 RPC
// `SECURITY DEFINER STABLE` de `0106_reports_rpcs.sql`); el cliente NO replica la agregación, solo dibuja
// lo que la RPC devuelve. A diferencia del resto del frontend (offline-first, lee del SQLite local), acá
// llamamos `supabase.rpc(...)` DIRECTO — las RPC no sincronizan (no son entidades offline).
//
// Estrategia offline (R7.2.2): detectamos ausencia de red ANTES de llamar la RPC (`assertOnline` lee la
// señal del socket de PowerSync) y, si estamos offline, devolvemos `Result.err({kind:'offline'})` SIN
// disparar la RPC (no cuelga la pantalla esperando un fetch que no resuelve). La pantalla muestra
// "necesitás conexión" con un botón "reintentar".
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id ni rodeo_id — los pasa el caller
// (establishment del contexto activo; rodeo elegido en el selector). La RLS server-side NO protege una
// SECURITY DEFINER → el guard `has_role_in` DENTRO de cada RPC (fail-closed, design §5.1) es la barrera
// real; un rodeo/establecimiento ajeno (IDOR) recibe `42501` de la RPC → lo mapeamos a `kind:'forbidden'`.
//
// El mapeo de filas a camelCase + el cálculo del % (con guard de 0) + el formato es-AR viven en el módulo
// PURO `reports-format.ts` (testeable con node:test); acá solo orquestamos I/O.

import { supabase } from './supabase';
import { assertOnline } from './powersync/online-guard';
import {
  asCalvingStatus,
  type CalvingStatus,
  asWeaningStatus,
  type WeaningStatus,
} from '../utils/reports-format';

// ─── Result tipado de un reporte ────────────────────────────────────────────────────────────────────

/**
 * Error de una llamada de reporte. `offline` = sin red, no se llamó la RPC (R7.2.2). `forbidden` = la RPC
 * rechazó por tenant/IDOR (42501, R7.12.3) o el recurso no existe (P0002) — la UI lo trata como "no
 * disponible". `validation` = parámetro fuera de cota (22023, defensivo — la UI no debería mandarlos).
 * `network`/`server` = fallo de red post-online-check o error del servidor (R7.2.4: reintentable).
 */
export type ReportError = {
  kind: 'offline' | 'network' | 'server' | 'forbidden' | 'validation';
  message: string;
};

export type ReportResult<T> = { ok: true; value: T } | { ok: false; error: ReportError };

const OFFLINE_MSG = 'Necesitás conexión para ver reportes.';

// ─── Tipos de dominio (camelCase) de cada RPC ───────────────────────────────────────────────────────

/** Un row del resumen de sesión: un kind de evento con su conteo + animales distintos (R7.3.1). */
export type SessionEventCount = {
  kind: string;
  eventCount: number;
  animals: number;
};

/** Una sesión de la lista del rodeo (R7.3.6). */
export type SessionListItem = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  status: string;
  workLotLabel: string | null;
  animalCount: number;
  eventCount: number;
};

/** %Preñez de un rodeo en una campaña (R7.5). Absolutos; el % lo computa la UI con `safePercent`. */
export type PregnancyKpi = {
  isConfigured: boolean;
  serviced: number;
  entoradas: number;
  pregnant: number;
  empty: number;
};

/**
 * %Parición de un rodeo en una campaña (R7.6 + delta #8/RPF). `status` gatea el DISPLAY de la card (fix del
 * 0% engañoso, D2/D3/D5); `pendingPregnant` = preñadas vigentes sin parto contado en la campaña (D4).
 */
export type CalvingKpi = {
  isConfigured: boolean;
  serviced: number;
  entoradas: number;
  pregnant: number;
  calved: number;
  status: CalvingStatus;
  pendingPregnant: number;
};

/**
 * %Destete de un rodeo en una campaña (delta #10/RWK). `status` gatea el DISPLAY de la card (D3/D5);
 * `weaned` = crías destetadas de la campaña (numerador; %destete puede >100% con mellizos); `pendingWeaning`
 * = crías de la campaña al pie sin destetar (D4). Cierra el ciclo servida → preñada → parida → DESTETADA.
 */
export type WeaningKpi = {
  isConfigured: boolean;
  serviced: number;
  weaned: number;
  pendingWeaning: number;
  status: WeaningStatus;
};

/** Distribución CCL (cabeza/cuerpo/cola) de las preñadas (R7.7). `nMonths` gobierna cuántas barras (cliente). */
export type CclDistribution = {
  nMonths: number;
  head: number;
  body: number;
  tail: number;
  total: number;
};

/** Distribución de NACIMIENTOS por etapa (cruce tacto↔nacimientos, R7.8). */
export type CalvingByStage = {
  nMonths: number;
  headBorn: number;
  bodyBorn: number;
  tailBorn: number;
  totalBorn: number;
};

/** Peso promedio de una categoría del rodeo (R7.9). */
export type WeightByCategory = {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  avgWeight: number;
  nAnimals: number;
};

/** Un ítem de la alerta de dosis vencida (R7.10). delta IDU: sin visualIdAlt (el label degrada a idv). */
export type OverdueDose = {
  animalProfileId: string;
  idv: string | null;
  productName: string;
  nextDoseDate: string;
};

/** Un ítem de la alerta de animales sin pesar (R7.11). `daysSince`/`lastWeightDate` null = nunca pesado. */
export type UnweighedAnimal = {
  animalProfileId: string;
  idv: string | null;
  categoryCode: string;
  categoryName: string;
  lastWeightDate: string | null;
  daysSince: number | null;
};

// ─── Helper de invocación de RPC (offline-first-check + mapeo de error) ──────────────────────────────

type PostgrestErrorLike = { code?: unknown; message?: unknown };

/**
 * Mapea un error de PostgREST/RPC a un `ReportError`. Los códigos vienen del contrato de las RPC (design
 * §5): `42501` = guard de tenant / IDOR (R7.12.3) → `forbidden` (no es reintentable: el usuario no tiene
 * rol). `P0002` = recurso no encontrado (rodeo/sesión borrada) → `forbidden` (no disponible). `22023` =
 * cota de input fuera de rango (defensivo) → `validation`. Sin `code` con `message` de fetch → `network`
 * (reintentable). Resto → `server` (reintentable).
 */
function mapRpcError(error: unknown): ReportError {
  const e = (error ?? {}) as PostgrestErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const rawMsg = typeof e.message === 'string' ? e.message : '';
  if (code === '42501' || code === 'P0002') {
    return { kind: 'forbidden', message: 'No tenés acceso a este reporte o ya no está disponible.' };
  }
  if (code === '22023') {
    return { kind: 'validation', message: 'Parámetro de reporte fuera de rango.' };
  }
  // supabase-js, ante un fallo de red (sin respuesta), deja un error sin `code` con un message de fetch.
  if (code === '' && /fetch|network|Failed to fetch|conexión|timeout/i.test(rawMsg)) {
    return { kind: 'network', message: 'No se pudo conectar. Revisá tu conexión y reintentá.' };
  }
  return { kind: 'server', message: 'No se pudo cargar el reporte. Reintentá en un momento.' };
}

/**
 * Invoca una RPC de reportes ONLINE-ONLY. (1) Chequea conexión ANTES (assertOnline): offline →
 * `{kind:'offline'}` sin llamar (R7.2.2). (2) Llama `supabase.rpc`. (3) Error → `mapRpcError`. (4) OK →
 * mapea las filas con `mapRow`. Las RPC `returns table(...)` → `data` es un array; las de un solo row
 * también vienen como array de 1 (PostgREST). El caller decide si toma `[0]` (KPI de un row) o el array.
 */
async function callRpcRows<TRow, TOut>(
  rpcName: string,
  args: Record<string, unknown>,
  mapRow: (row: TRow) => TOut,
): Promise<ReportResult<TOut[]>> {
  const off = assertOnline(OFFLINE_MSG);
  if (off) return { ok: false, error: { kind: 'offline', message: OFFLINE_MSG } };

  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) return { ok: false, error: mapRpcError(error) };

  const rows = (Array.isArray(data) ? data : data == null ? [] : [data]) as TRow[];
  return { ok: true, value: rows.map(mapRow) };
}

/** Variante para las RPC que devuelven UN row (KPIs): toma la primera fila o `null` si vino vacío. */
async function callRpcSingle<TRow, TOut>(
  rpcName: string,
  args: Record<string, unknown>,
  mapRow: (row: TRow) => TOut,
): Promise<ReportResult<TOut | null>> {
  const r = await callRpcRows<TRow, TOut>(rpcName, args, mapRow);
  if (!r.ok) return r;
  return { ok: true, value: r.value.length > 0 ? r.value[0] : null };
}

// ─── Filas crudas (snake) de cada RPC ───────────────────────────────────────────────────────────────

type SessionSummaryRow = { event_kind: string; event_count: number; animals: number };
type SessionListRow = {
  id: string; started_at: string | null; ended_at: string | null; status: string;
  work_lot_label: string | null; animal_count: number; event_count: number;
};
type PregnancyRow = { is_configured: boolean; serviced: number; entoradas: number; pregnant: number; empty: number };
type CalvingRow = {
  is_configured: boolean; serviced: number; entoradas: number; pregnant: number; calved: number;
  // status/pending_pregnant vienen de la migración 0117; ausentes si el cliente corre antes del apply (CD-6).
  status?: string; pending_pregnant?: number | string;
};
type WeaningRow = {
  is_configured: boolean; serviced: number;
  // status/weaned/pending_weaning vienen de la migración 0118; ausentes si el cliente corre antes del apply (CD-7).
  weaned?: number | string; pending_weaning?: number | string; status?: string;
};
type CclRow = { n_months: number; head: number; body: number; tail: number; total: number };
type StageRow = { n_months: number; head_born: number; body_born: number; tail_born: number; total_born: number };
type WeightRow = { category_id: string; category_code: string; category_name: string; avg_weight: number | string; n_animals: number };
// delta IDU: los RPC de reportes retornan sin visual_id_alt (la migración 0122 lo quita del RETURNS TABLE);
// el frontend deja de leerlo desde el PASO 1 del deploy (tolera el retorno viejo — no mapea la columna).
type OverdueRow = { animal_profile_id: string; idv: string | null; product_name: string; next_dose_date: string };
type UnweighedRow = {
  animal_profile_id: string; idv: string | null;
  category_code: string; category_name: string; last_weight_date: string | null; days_since: number | null;
};

/** numeric de Postgres puede llegar como string por PostgREST → coerción tolerante a number. */
function toNum(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ─── Wrappers públicos (una función por RPC) ────────────────────────────────────────────────────────

/** Resumen de una sesión: conteo por tipo de evento (R7.3.1). Los 7 kinds vienen siempre (0 incluido). */
export function fetchSessionSummary(sessionId: string): Promise<ReportResult<SessionEventCount[]>> {
  return callRpcRows<SessionSummaryRow, SessionEventCount>(
    'session_event_summary',
    { p_session_id: sessionId },
    (r) => ({ kind: r.event_kind, eventCount: r.event_count, animals: r.animals }),
  );
}

/** Lista de sesiones de un rodeo, más reciente primero (R7.3.6). */
export function fetchRodeoSessions(rodeoId: string): Promise<ReportResult<SessionListItem[]>> {
  return callRpcRows<SessionListRow, SessionListItem>(
    'rodeo_sessions_list',
    { p_rodeo_id: rodeoId },
    (r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      status: r.status,
      workLotLabel: r.work_lot_label,
      animalCount: r.animal_count,
      eventCount: r.event_count,
    }),
  );
}

/** %Preñez de un rodeo en una campaña (R7.5). Devuelve null si la RPC no trajo fila (defensivo). */
export function fetchPregnancyKpi(rodeoId: string, year: number): Promise<ReportResult<PregnancyKpi | null>> {
  return callRpcSingle<PregnancyRow, PregnancyKpi>(
    'rodeo_pregnancy_kpi',
    { p_rodeo_id: rodeoId, p_year: year },
    (r) => ({
      isConfigured: r.is_configured,
      serviced: r.serviced,
      entoradas: r.entoradas,
      pregnant: r.pregnant,
      empty: r.empty,
    }),
  );
}

/** %Parición de un rodeo en una campaña (R7.6). */
export function fetchCalvingKpi(rodeoId: string, year: number): Promise<ReportResult<CalvingKpi | null>> {
  return callRpcSingle<CalvingRow, CalvingKpi>(
    'rodeo_calving_kpi',
    { p_rodeo_id: rodeoId, p_year: year },
    (r) => ({
      isConfigured: r.is_configured,
      serviced: r.serviced,
      entoradas: r.entoradas,
      pregnant: r.pregnant,
      calved: r.calved,
      // default defensivo (CD-6): status ausente/desconocido → 'ok'; pending ausente → 0.
      status: asCalvingStatus(r.status),
      pendingPregnant: toNum(r.pending_pregnant),
    }),
  );
}

/** %Destete de un rodeo en una campaña (delta #10/RWK). */
export function fetchWeaningKpi(rodeoId: string, year: number): Promise<ReportResult<WeaningKpi | null>> {
  return callRpcSingle<WeaningRow, WeaningKpi>(
    'rodeo_weaning_kpi',
    { p_rodeo_id: rodeoId, p_year: year },
    (r) => ({
      isConfigured: r.is_configured,
      serviced: toNum(r.serviced),
      weaned: toNum(r.weaned),
      pendingWeaning: toNum(r.pending_weaning),
      // default defensivo (CD-7): status ausente/desconocido → 'ok'; pending/weaned ausentes → 0.
      status: asWeaningStatus(r.status),
    }),
  );
}

/** Distribución CCL de las preñadas (R7.7). */
export function fetchCclDistribution(rodeoId: string, year: number): Promise<ReportResult<CclDistribution | null>> {
  return callRpcSingle<CclRow, CclDistribution>(
    'rodeo_ccl_distribution',
    { p_rodeo_id: rodeoId, p_year: year },
    (r) => ({ nMonths: r.n_months, head: r.head, body: r.body, tail: r.tail, total: r.total }),
  );
}

/** Cruce tacto↔nacimientos: distribución de nacimientos por etapa (R7.8). */
export function fetchCalvingByStage(rodeoId: string, year: number): Promise<ReportResult<CalvingByStage | null>> {
  return callRpcSingle<StageRow, CalvingByStage>(
    'rodeo_calving_by_stage',
    { p_rodeo_id: rodeoId, p_year: year },
    (r) => ({
      nMonths: r.n_months,
      headBorn: r.head_born,
      bodyBorn: r.body_born,
      tailBorn: r.tail_born,
      totalBorn: r.total_born,
    }),
  );
}

/**
 * Peso promedio por categoría de un rodeo (R7.9). `sessionId` opcional → restringe a los pesajes de esa
 * sesión (comparativa por sesiones, R7.9.5). Las categorías sin peso NO vienen (la UI las marca "sin pesar").
 */
export function fetchWeightByCategory(
  rodeoId: string,
  sessionId?: string | null,
): Promise<ReportResult<WeightByCategory[]>> {
  return callRpcRows<WeightRow, WeightByCategory>(
    'rodeo_weight_by_category',
    { p_rodeo_id: rodeoId, p_session_id: sessionId ?? null },
    (r) => ({
      categoryId: r.category_id,
      categoryCode: r.category_code,
      categoryName: r.category_name,
      avgWeight: toNum(r.avg_weight),
      nAnimals: r.n_animals,
    }),
  );
}

/**
 * Alerta de dosis vencida (R7.10). `lookbackDays`/`limit` tienen default server (365/500); se exponen por
 * si la UI quiere acotar. El orden ya viene del server (lo más vencido primero).
 */
export function fetchOverdueDoses(
  establishmentId: string,
  opts?: { lookbackDays?: number; limit?: number },
): Promise<ReportResult<OverdueDose[]>> {
  const args: Record<string, unknown> = { p_establishment_id: establishmentId };
  if (opts?.lookbackDays !== undefined) args.p_lookback_days = opts.lookbackDays;
  if (opts?.limit !== undefined) args.p_limit = opts.limit;
  return callRpcRows<OverdueRow, OverdueDose>('establishment_overdue_doses', args, (r) => ({
    animalProfileId: r.animal_profile_id,
    idv: r.idv,
    productName: r.product_name,
    nextDoseDate: r.next_dose_date,
  }));
}

/**
 * Alerta de animales sin pesar (R7.11). `thresholdDays` default-MVP server = 180 (parametrizado).
 * `categoryCodes` = el conjunto de categorías que se pesan en cría ([SUPUESTO]/Facundo, D2); null = todas.
 */
export function fetchUnweighed(
  establishmentId: string,
  opts?: { thresholdDays?: number; categoryCodes?: string[] | null },
): Promise<ReportResult<UnweighedAnimal[]>> {
  const args: Record<string, unknown> = { p_establishment_id: establishmentId };
  if (opts?.thresholdDays !== undefined) args.p_threshold_days = opts.thresholdDays;
  if (opts?.categoryCodes !== undefined) args.p_category_codes = opts.categoryCodes;
  return callRpcRows<UnweighedRow, UnweighedAnimal>('establishment_unweighed', args, (r) => ({
    animalProfileId: r.animal_profile_id,
    idv: r.idv,
    categoryCode: r.category_code,
    categoryName: r.category_name,
    lastWeightDate: r.last_weight_date,
    daysSince: r.days_since,
  }));
}
