// Lógica PURA del ESTADO REPRODUCTIVO vigente de una hembra (delta spec 02 "aptitud reproductiva", RAR.2).
// Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que animal-category.ts /
// event-timeline.ts). Display-only (RAR.8.1): NO escribe nada — deriva on-read del SQLite local.
//
// ⚠️ ANTI-DRIFT (RAR.8.3, espeja RC6.5.1): este módulo ESPEJA dos contratos del backend:
//   1. La ELEGIBILIDAD reproductiva de `0105` (`rodeo_serviced_females`): set de categorías "probadas"
//      SIN gate (`PROVEN_FEMALE_CATEGORY_CODES`, cita 0105 líneas 126-127) + fallback de edad de la
//      vaquillona sin veredicto (`SERVICE_AGE_THRESHOLD_DAYS = v_age_threshold_days = 365`, 0105 línea 99/141).
//   2. El enum `heifer_fitness` (`0053`): apta | no_apta | diferida.
// Cualquier cambio a esa elegibilidad (0105) o al enum (0053) DEBE actualizar este módulo + `repro-status.test.ts`.
//
// QUÉ HACE (RAR.2): NO reimplementa la preñez — REUSA `deriveCurrentState` (event-timeline.ts) para el eje
// preñez (tacto/birth/abortion) y solo AGREGA el eje aptitud (último `tacto_vaquillona`) + CUT + evidencia de
// servicio, resolviendo a UN único slot (single-slot, RAR.2.4). Para el eje preñez los `tacto_vaquillona` se
// ignoran (su eventType no es tacto/birth/abortion → `deriveCurrentState` ya los descarta).

import {
  deriveCurrentState,
  type PregnancyStatus,
  type ReproEventType,
  type TimelineItem,
} from './event-timeline';
import type { HeiferFitness } from './maneuver-sequence';

/**
 * Categorías de hembra "PROBADAMENTE servidas" — elegibles SIN gate de aptitud (cuentan como servidas en
 * `0105` sin leer `heifer_fitness`). FUENTE ÚNICA del literal (RAR.7.2 / design §2/§12): la MISMA constante
 * la consume el badge (RAR.2.4.4 "Servida sin tacto") y la aplicabilidad de inseminación (RAR.6.2). Cita
 * `0105` líneas 126-127 (`c.code in ('vaquillona_prenada','vaca_segundo_servicio','multipara','vaca_cabana')`).
 */
export const PROVEN_FEMALE_CATEGORY_CODES: ReadonlySet<string> = new Set([
  'vaquillona_prenada',
  'vaca_segundo_servicio',
  'multipara',
  'vaca_cabana',
]);

/**
 * Umbral de "edad de servicio" en días para el fallback de la vaquillona sin veredicto (RAR.6.2): espeja
 * `v_age_threshold_days = 365` de `0105` (líneas 99/141: `birth_date is not null and (current_date - birth_date)
 * >= v_age_threshold_days`). Una vaquillona ≥365 d sin veredicto es servible/inseminable (campos que no tactean).
 */
export const SERVICE_AGE_THRESHOLD_DAYS = 365;

/** event_type del enum reproductivo que disparan el veredicto de aptitud (0053). */
const TACTO_VAQUILLONA = 'tacto_vaquillona';

/**
 * Evento reproductivo CRUDO del SQLite local (synced u overlay) que alimenta este espejo. Mismo shape lean
 * que el espejo de categoría C6 (`ReproEventInput` de animal-category.ts) + `heifer_fitness`/`service_type`
 * (los dos campos que este módulo agrega sobre C6). El SQL ya filtró `deleted_at IS NULL` + el `event_type IN`
 * relevante (`buildReproBadgeEventsQuery`, design §3): acá NO se re-filtra borrado.
 */
export type ReproEventInput = {
  /** event_type ('tacto'|'birth'|'abortion'|'service'|'tacto_vaquillona'|otros — los demás se ignoran). */
  eventType: string;
  /** event_date 'YYYY-MM-DD'. */
  eventDate: string;
  /**
   * created_at (timestamptz texto) o `null`. `null` = fila local recién insertada por CRUD plano (el trigger
   * lo sella al subir) → se trata como MÁS RECIENTE que cualquier created_at presente a igualdad de event_date
   * (semántica null-as-newest, RC6.1.4).
   */
  createdAt: string | null;
  /** pregnancy_status del tacto ('empty'|'small'|'medium'|'large'|null). Solo relevante para event_type='tacto'. */
  pregnancyStatus: string | null;
  /** heifer_fitness del veredicto de aptitud (apta|no_apta|diferida|null). Solo en 'tacto_vaquillona'. */
  heiferFitness: HeiferFitness | null;
  /** service_type del servicio (natural|ai|te|null). Solo en 'service'; no se lee acá (basta la existencia). */
  serviceType: string | null;
};

/**
 * Último veredicto de APTITUD vigente de una hembra (RAR.2.1): el `heifer_fitness` del `tacto_vaquillona` más
 * reciente no borrado por la tupla `(event_date, created_at)` con null-as-newest (RC6.1.4). `null` si no hay
 * ningún `tacto_vaquillona` (sin veredicto). PURA, sin orden de entrada asumido (recorre y elige el máximo).
 */
export function deriveReproAptitude(events: readonly ReproEventInput[]): HeiferFitness | null {
  let best: { ev: ReproEventInput; idx: number } | null = null;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.eventType !== TACTO_VAQUILLONA) continue;
    if (best === null || isLaterEvent(ev, i, best.ev, best.idx)) {
      best = { ev, idx: i };
    }
  }
  return best?.ev.heiferFitness ?? null;
}

/**
 * ¿El evento `a` (índice `ai`) es ESTRICTAMENTE posterior a `b` (índice `bi`) por la tupla
 * `(event_date, created_at)`? Espeja `isAfter` de animal-category.ts (RC6.1.4) — null-as-newest a igualdad de
 * event_date; dos null (o mismo texto) desempatan por el índice del array (orden de la query = orden de
 * inserción local). MISMO criterio que el tacto+ vigente del espejo de categoría (anti-drift: si cambia allá,
 * cambia acá).
 */
function isLaterEvent(a: ReproEventInput, ai: number, b: ReproEventInput, bi: number): boolean {
  if (a.eventDate !== b.eventDate) return a.eventDate > b.eventDate;
  if (a.createdAt === b.createdAt) return ai > bi; // ambos null (o mismo texto) → orden de inserción
  if (a.createdAt === null) return true; // a recién insertado → posterior
  if (b.createdAt === null) return false; // b recién insertado → a NO posterior
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a.createdAt > b.createdAt; // fallback lexicográfico (ISO)
  return ta > tb;
}

/**
 * Estado reproductivo single-slot del badge (RAR.2.4). Unión discriminada — un único slot por hembra:
 *   - `none`           : macho / ternera (no aplica — sin badge, RAR.2.4.1)
 *   - `cut`            : CUT (descarte) → "No apta" (RAR.2.4.2)
 *   - `pregnant`       : preñada (con tamaño) (RAR.2.4.3)
 *   - `empty`          : vacía (RAR.2.4.3)
 *   - `served_untested`: probada/servida sin tacto (RAR.2.4.4)
 *   - `fitness`        : Apta / Diferida / No apta (vaquillona con veredicto) (RAR.2.4.5)
 *   - `unknown`        : sin preñez, sin servicio, sin veredicto → "Sin evaluar" (RAR.2.4.6)
 */
export type ReproStatus =
  | { kind: 'none' }
  | { kind: 'cut' }
  | { kind: 'pregnant'; status: 'small' | 'medium' | 'large' }
  | { kind: 'empty' }
  | { kind: 'served_untested' }
  | { kind: 'fitness'; fitness: HeiferFitness }
  | { kind: 'unknown' };

export type ReproStatusInput = {
  sex: 'male' | 'female' | null;
  /** `code` de la categoría VIGENTE (display) de la hembra (ternera/vaquillona/multipara/cut/…). */
  categoryCode: string | null;
  /** `is_cut` REAL del perfil (RAR.2.4.2 — CUT → "No apta", sin columna de flag aparte). */
  isCut: boolean;
  /** Eventos reproductivos no borrados del perfil (synced + overlay), del SQLite local. Orden NO requerido. */
  events: readonly ReproEventInput[];
};

/**
 * Deriva el estado reproductivo vigente single-slot (RAR.2.4, precedencia LOAD-BEARING). PURA, display-only
 * (RAR.8.1: cero writes). REUSA `deriveCurrentState` para el eje preñez (no se reimplementa). Precedencia:
 *   1. sex ≠ female  o  categoría 'ternera'              → none (RAR.2.4.1)
 *   2. is_cut                                             → cut  (RAR.2.4.2)
 *   3. preñez determinada (deriveCurrentState)            → pregnant / empty (RAR.2.4.3)
 *   4. categoría probada  o  hay evento `service`         → served_untested (RAR.2.4.4)
 *   5. categoría 'vaquillona' con veredicto de aptitud    → fitness (RAR.2.4.5)
 *   6. resto                                              → unknown ("Sin evaluar", RAR.2.4.6)
 */
export function deriveReproStatus(input: ReproStatusInput): ReproStatus {
  // 1. No aplica: macho o ternera (la preñez/aptitud no aplica; el toro tiene su CE aparte, fuera de scope).
  if (input.sex !== 'female' || input.categoryCode === 'ternera') {
    return { kind: 'none' };
  }
  // 2. CUT (descarte): "No apta" — leído de is_cut, sin columna de flag (RAR.2.4.2 / decisión 4).
  if (input.isCut) {
    return { kind: 'cut' };
  }
  // 3. Preñez VIGENTE: se REUSA deriveCurrentState (event-timeline.ts) — los tacto_vaquillona/service NO la
  //    determinan (su eventType no es tacto/birth/abortion → deriveCurrentState ya los descarta).
  const pregnancy = deriveCurrentState(toTimelineItems(input.events)).pregnancy;
  if (pregnancy) {
    return pregnancy.kind === 'pregnant'
      ? { kind: 'pregnant', status: pregnancy.status }
      : { kind: 'empty' };
  }
  // 4. Probada (categoría) o con evidencia de servicio, sin diagnóstico de preñez aún → "Servida sin tacto".
  if (
    PROVEN_FEMALE_CATEGORY_CODES.has(input.categoryCode ?? '') ||
    input.events.some((e) => e.eventType === 'service')
  ) {
    return { kind: 'served_untested' };
  }
  // 5. Vaquillona pre-servicio con veredicto de aptitud vigente → Apta / Diferida / No apta.
  if (input.categoryCode === 'vaquillona') {
    const aptitude = deriveReproAptitude(input.events);
    if (aptitude !== null) return { kind: 'fitness', fitness: aptitude };
  }
  // 6. Hembra sin preñez, sin servicio y sin veredicto → "Sin evaluar".
  return { kind: 'unknown' };
}

/**
 * Mapea los `ReproEventInput` crudos a `TimelineItem` de kind 'reproductive' para alimentar `deriveCurrentState`
 * (que solo mira tacto/birth/abortion; ignora el resto). NO se setea `seq` (undefined): `deriveCurrentState` cae
 * a su desempate por `createdAt` (null-as-newest, RC6.1.4) — robusto sin asumir orden de entrada. El `eventId`
 * es un índice 0-padded (estable, monotónico): para el desempate FINAL (mismo event_date + ambos created_at
 * null) el insertado DESPUÉS queda con índice mayor → eventId mayor → gana (espeja "el insertado después gana").
 */
function toTimelineItems(events: readonly ReproEventInput[]): TimelineItem[] {
  return events.map((e, i) => ({
    kind: 'reproductive',
    eventId: String(i).padStart(8, '0'),
    eventDate: e.eventDate,
    createdAt: e.createdAt,
    // El parser real valida los enums; acá basta el string crudo (deriveCurrentState solo lo compara con
    // literales tacto/birth/abortion). El cast es seguro: un valor fuera del enum cae en el `default` (ignorado).
    eventType: e.eventType as ReproEventType | null,
    pregnancyStatus: e.pregnancyStatus as PregnancyStatus | null,
    calfId: null,
    serviceType: null,
    notes: null,
    createdBy: null,
  }));
}

/**
 * Etiqueta es-AR del estado reproductivo para el badge/ficha (RAR.3.4). `null` para 'none' (no se muestra chip).
 *   apta→"Apta", diferida→"Diferida", no_apta/CUT→"No apta", preñada→"Preñada", vacía→"Vacía",
 *   servida-sin-tacto→"Servida sin tacto", sin-evaluar→"Sin evaluar".
 */
export function reproStatusLabel(s: ReproStatus): string | null {
  switch (s.kind) {
    case 'none':
      return null;
    case 'cut':
      return 'No apta';
    case 'pregnant':
      return 'Preñada';
    case 'empty':
      return 'Vacía';
    case 'served_untested':
      return 'Servida sin tacto';
    case 'fitness':
      return s.fitness === 'apta' ? 'Apta' : s.fitness === 'diferida' ? 'Diferida' : 'No apta';
    case 'unknown':
      return 'Sin evaluar';
  }
}

/** Inputs de la elegibilidad de inseminación (RAR.6.1): aptitud vigente + edad en días (fallback de edad). */
export type ReproAptInput = {
  sex: 'male' | 'female' | null;
  categoryCode: string | null;
  /** Aptitud reproductiva vigente (último `tacto_vaquillona`, deriveReproAptitude). null = sin veredicto. */
  aptitude: HeiferFitness | null;
  /** Edad en días (de birth_date). null = sin fecha → el fallback de edad NO aplica (RAR.6.5). */
  ageDays: number | null;
};

/**
 * ¿La hembra es reproductivamente APTA para inseminación (RAR.6.2)? = hembra ∧ (categoría PROBADA ∨ vaquillona
 * con `heifer_fitness='apta'` ∨ vaquillona SIN veredicto con edad ≥365 d). El fallback de edad (decisión de Raf
 * en Puerta 1) deja la aplicabilidad IDÉNTICA a la elegibilidad de servidas de `0105` (misma regla, sin
 * divergencia con el denominador). Excluye: macho (RAR.6.3), ternera (RAR.6.4), vaquillona no_apta/diferida o
 * sin veredicto <365 d / sin birth_date (RAR.6.5), CUT (categoría 'cut', RAR.6.6 — fuera del set probada/vaquillona).
 *
 * DIVERGENCIA INTENCIONAL (design §2/§10): el BADGE de una vaquillona sin veredicto muestra "Sin evaluar"
 * (RAR.2.4.6) aunque ACÁ la edad la habilite — el badge comunica el *estado de evaluación*, esta función la
 * *elegibilidad por edad*. Son distintos a propósito (NO unificar).
 */
export function isReproApt(input: ReproAptInput): boolean {
  if (input.sex !== 'female') return false; // macho / sexo desconocido → no (RAR.6.3)
  if (PROVEN_FEMALE_CATEGORY_CODES.has(input.categoryCode ?? '')) return true; // probada (sin gate)
  if (input.categoryCode === 'vaquillona') {
    if (input.aptitude === 'apta') return true; // veredicto apta (RAR.6.2)
    // Vaquillona SIN veredicto → fallback de edad ≥365 d (RAR.6.2/6.5, espeja 0105). no_apta/diferida → false.
    if (input.aptitude === null) {
      return input.ageDays !== null && input.ageDays >= SERVICE_AGE_THRESHOLD_DAYS;
    }
  }
  return false; // ternera, vaquillona no_apta/diferida/<365d, CUT, cualquier otra → no
}

/**
 * Edad en días entre `now` y una fecha ISO 'YYYY-MM-DD' (UTC-midnight). null si la fecha es inválida o futura
 * (edad negativa). Helper PURO para que el caller (carga.tsx) derive `ageDays` de `birth_date` para `isReproApt`
 * (RAR.6.1). Mismo criterio UTC-midnight que `ageInDays` de animal-category.ts.
 */
export function ageInDaysFromBirthDate(birthDate: string | null | undefined, now: Date): number | null {
  if (!birthDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    return null; // fecha desbordada (ej. 2026-02-31)
  }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = Math.floor((today.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null; // futura → null (no inventamos edad negativa)
}
