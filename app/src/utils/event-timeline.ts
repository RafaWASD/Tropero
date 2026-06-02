// Lógica PURA de la cronología del animal (spec 02 C3.1, R10/R14). Sin RN, sin red, sin supabase-js:
// testeable con node:test (mismo patrón que animal-category.ts / animal-input.ts).
//
// Responsabilidades:
//   1. Parsear una fila CRUDA de la RPC animal_timeline (0035) → un TimelineItem tipado (unión
//      discriminada por kind, con payload narrowado). Tolerante a payload con campos faltantes.
//   2. formatEventDate(iso, now) — fecha humana es-AR (hoy/ayer/mismo año/otro año). PURA: recibe
//      `now` como parámetro (NO Date.now() interno) para testear determinístico.
//   3. Humanizadores de enums (event_type repro/sanitary, pregnancy_status, reason de
//      category_change, sample_type, route) → label es-AR voseo.
//
// El componente TimelineEvent consume estos TimelineItem para renderizar; el service events.ts hace
// el parseo (llama parseTimelineRow) + resuelve los nombres de categoría de los category_change.

// ─── Kinds + payloads tipados (espejo de los 7 orígenes de la RPC 0035) ──────────────────

export type TimelineKind =
  | 'weight'
  | 'reproductive'
  | 'sanitary'
  | 'condition_score'
  | 'lab_sample'
  | 'category_change'
  | 'observacion';

/**
 * Kinds cuyo `event_date` proviene de una columna Postgres `date` (sin hora): weight_events,
 * condition_score_events, sanitary_events, lab_samples, reproductive_events. La RPC 0035 los
 * castea a timestamptz → vuelven como UTC-medianoche (`2026-06-02T00:00:00+00:00`). Esos NO son
 * instantes: son FECHAS CALENDARIO. Hay que formatearlos sin huso ni hora (ver formatEventDate
 * con `dateOnly:true`), si no un evento de HOY cargado en AR (UTC-3) se vería como "Ayer".
 *
 * Los otros dos kinds SÍ son instantes reales (timestamptz): `observacion` (created_at) y
 * `category_change` (changed_at) — esos se formatean con huso local (dateOnly:false).
 */
const DATE_ONLY_KINDS: ReadonlySet<TimelineKind> = new Set<TimelineKind>([
  'weight',
  'condition_score',
  'sanitary',
  'lab_sample',
  'reproductive',
]);

/** ¿El `event_date` de este kind es una FECHA calendario (date-only) y no un instante real? */
export function isDateOnlyKind(kind: string): boolean {
  return DATE_ONLY_KINDS.has(kind as TimelineKind);
}

/** event_type de reproductive_events (R6.2). */
export type ReproEventType =
  | 'service'
  | 'tacto'
  | 'birth'
  | 'abortion'
  | 'weaning'
  | 'drying'
  | 'rejection';

/** pregnancy_status de reproductive_events (R6.2): vacía / cabeza / cuerpo / cola. */
export type PregnancyStatus = 'empty' | 'small' | 'medium' | 'large';

/** event_type de sanitary_events (R6.3). */
export type SanitaryEventType =
  | 'vaccination'
  | 'deworming'
  | 'treatment'
  | 'test'
  | 'other';

/** sample_type de lab_samples (R6.5). */
export type LabSampleType = 'blood' | 'scrape_tricho' | 'scrape_campylo' | 'other';

/** reason de animal_category_history (R10.3). */
export type CategoryChangeReason =
  | 'initial'
  | 'auto_transition'
  | 'manual_override'
  | 'revert_to_auto';

// Unión discriminada: cada kind con su payload ya narrowado. Los nombres de categoría del
// category_change los resuelve el service (vienen como UUID en la RPC); acá quedan como `*Name`
// opcionales (el parser deja los UUID en `*Id`, el service los completa con el nombre).
export type TimelineItem =
  | {
      kind: 'weight';
      eventId: string;
      eventDate: string;
      weightKg: number | null;
      source: string | null;
      notes: string | null;
    }
  | {
      kind: 'reproductive';
      eventId: string;
      eventDate: string;
      eventType: ReproEventType | null;
      pregnancyStatus: PregnancyStatus | null;
      calfId: string | null;
      notes: string | null;
    }
  | {
      kind: 'sanitary';
      eventId: string;
      eventDate: string;
      eventType: SanitaryEventType | null;
      productName: string | null;
      route: string | null;
      notes: string | null;
    }
  | {
      kind: 'condition_score';
      eventId: string;
      eventDate: string;
      score: number | null;
      notes: string | null;
    }
  | {
      kind: 'lab_sample';
      eventId: string;
      eventDate: string;
      sampleType: LabSampleType | null;
      tubeNumber: string | null;
      result: string | null;
      receivedDate: string | null;
    }
  | {
      kind: 'category_change';
      eventId: string;
      eventDate: string;
      fromCategoryId: string | null;
      toCategoryId: string | null;
      fromCategoryName: string | null;
      toCategoryName: string | null;
      reason: CategoryChangeReason | null;
    }
  | {
      kind: 'observacion';
      eventId: string;
      eventDate: string;
      eventType: string | null;
      text: string | null;
      authorId: string | null;
      editWindowUntil: string | null;
    };

/** Fila cruda de la RPC animal_timeline (PostgREST devuelve el set como array de filas). */
export type TimelineRow = {
  event_kind: string;
  event_id: string;
  event_date: string;
  payload: Record<string, unknown> | null;
};

// ─── Helpers de extracción tolerante (payload puede venir con campos faltantes/null) ─────

function str(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = payload?.[key];
  if (v == null) return null;
  if (typeof v === 'string') return v.length > 0 ? v : null;
  // tube_number / result pueden venir numéricos en el JSON → los stringificamos defensivamente.
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function num(payload: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = payload?.[key];
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // numeric de Postgres puede serializar como string ("320.50") → parseamos.
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parsea una fila cruda de la RPC a un TimelineItem tipado. Tolerante a payload incompleto (cada
 * campo cae a null si falta). Si el `event_kind` no es uno de los 7 conocidos, devuelve null (el
 * caller lo descarta; defensivo ante una RPC que sume orígenes nuevos sin que el cliente reviente).
 */
export function parseTimelineRow(row: TimelineRow): TimelineItem | null {
  const p = row.payload ?? null;
  const base = { eventId: row.event_id, eventDate: row.event_date };
  switch (row.event_kind as TimelineKind) {
    case 'weight':
      return {
        kind: 'weight',
        ...base,
        weightKg: num(p, 'weight_kg'),
        source: str(p, 'source'),
        notes: str(p, 'notes'),
      };
    case 'reproductive':
      return {
        kind: 'reproductive',
        ...base,
        eventType: str(p, 'event_type') as ReproEventType | null,
        pregnancyStatus: str(p, 'pregnancy_status') as PregnancyStatus | null,
        calfId: str(p, 'calf_id'),
        notes: str(p, 'notes'),
      };
    case 'sanitary':
      return {
        kind: 'sanitary',
        ...base,
        eventType: str(p, 'event_type') as SanitaryEventType | null,
        productName: str(p, 'product_name'),
        route: str(p, 'route'),
        notes: str(p, 'notes'),
      };
    case 'condition_score':
      return {
        kind: 'condition_score',
        ...base,
        score: num(p, 'score'),
        notes: str(p, 'notes'),
      };
    case 'lab_sample':
      return {
        kind: 'lab_sample',
        ...base,
        sampleType: str(p, 'sample_type') as LabSampleType | null,
        tubeNumber: str(p, 'tube_number'),
        result: str(p, 'result'),
        receivedDate: str(p, 'received'),
      };
    case 'category_change':
      return {
        kind: 'category_change',
        ...base,
        fromCategoryId: str(p, 'from'),
        toCategoryId: str(p, 'to'),
        fromCategoryName: null,
        toCategoryName: null,
        reason: str(p, 'reason') as CategoryChangeReason | null,
      };
    case 'observacion':
      return {
        kind: 'observacion',
        ...base,
        eventType: str(p, 'event_type'),
        text: str(p, 'text'),
        authorId: str(p, 'author_id'),
        editWindowUntil: str(p, 'edit_window_until'),
      };
    default:
      return null;
  }
}

/**
 * Parsea + ordena un set de filas crudas. Orden: event_date desc (R10.1). La RPC ya ordena, pero
 * reordenamos defensivamente acá (el orden visual no debe depender de que PostgREST preserve el
 * `order by` de la función). Empate de fecha → estable por eventId (determinístico para tests).
 */
export function parseTimeline(rows: readonly TimelineRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const item = parseTimelineRow(row);
    if (item) items.push(item);
  }
  items.sort((a, b) => {
    const da = Date.parse(a.eventDate);
    const db = Date.parse(b.eventDate);
    if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return db - da;
    // empate (o fecha inválida) → desempate estable por eventId.
    return a.eventId < b.eventId ? 1 : a.eventId > b.eventId ? -1 : 0;
  });
  return items;
}

/** Devuelve los UUIDs de categoría (from/to) únicos de un set de items, para resolver sus nombres. */
export function collectCategoryIds(items: readonly TimelineItem[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    if (it.kind === 'category_change') {
      if (it.fromCategoryId) set.add(it.fromCategoryId);
      if (it.toCategoryId) set.add(it.toCategoryId);
    }
  }
  return [...set];
}

/** Reemplaza los items category_change con los nombres resueltos del mapa id→name (no muta). */
export function resolveCategoryNames(
  items: readonly TimelineItem[],
  nameById: Readonly<Record<string, string>>,
): TimelineItem[] {
  return items.map((it) => {
    if (it.kind !== 'category_change') return it;
    return {
      ...it,
      fromCategoryName: it.fromCategoryId ? (nameById[it.fromCategoryId] ?? null) : null,
      toCategoryName: it.toCategoryId ? (nameById[it.toCategoryId] ?? null) : null,
    };
  });
}

// ─── Estado actual del animal (último valor vigente por medición tipada) ──────────────────
//
// Decisión de modelo (fix-loop 2, FIX C): los datos MEDIDOS del animal no son SOLO eventos. El
// timeline es la auditoría/historial; pero el VALOR VIGENTE de cada medición tipada (el del evento
// más reciente de ese tipo) es un ATRIBUTO del animal que se muestra en la ficha. Solo las
// observaciones libres quedan únicamente en el timeline (no tienen "valor actual").
//
// Para C3.1 los tipos cargables son peso + condición corporal → surfaceamos esos dos. Punto de
// EXTENSIÓN a futuro (C3.2): estado reproductivo (preñez del último reproductive_event) y última
// sanidad se agregan acá sumando ramas; la ficha las muestra sin tocar la lógica de selección.

export type CurrentState = {
  /** Peso vigente: kg + fecha del weight_event más reciente. Ausente si nunca se pesó. */
  weight?: { kg: number; date: string };
  /** Condición corporal vigente: score + fecha del condition_score_event más reciente. */
  conditionScore?: { score: number; date: string };
};

/**
 * Deriva el ESTADO ACTUAL del animal a partir de su timeline: el valor vigente de cada medición
 * tipada = el del evento de MAYOR `eventDate` de ese kind. PURA, sin orden asumido: recorre todo el
 * timeline y se queda con el máximo por kind (NO confía en que `parseTimeline` ya ordenó — robusto
 * ante cualquier orden de entrada). Timeline vacío/null → `{}`. Un evento con valor null (payload
 * incompleto) NO cuenta como vigente (no surfaceamos un "peso actual" sin número).
 *
 * Empate de fecha (mismo `eventDate` exacto) → desempate estable por `eventId` mayor (mismo criterio
 * que parseTimeline: el id "más alto" gana), para que el resultado sea determinístico.
 */
export function deriveCurrentState(
  timeline: readonly TimelineItem[] | null | undefined,
): CurrentState {
  const state: CurrentState = {};
  if (!timeline) return state;

  let weightBest: { item: Extract<TimelineItem, { kind: 'weight' }>; ms: number } | null = null;
  let scoreBest: {
    item: Extract<TimelineItem, { kind: 'condition_score' }>;
    ms: number;
  } | null = null;

  // ¿`candidate` es más reciente que `best`? Mayor fecha gana; empate → mayor eventId.
  const isNewer = (
    candDate: string,
    candId: string,
    best: { item: { eventDate: string; eventId: string }; ms: number } | null,
  ): boolean => {
    if (!best) return true;
    const cand = Date.parse(candDate);
    if (Number.isFinite(cand) && cand !== best.ms) return cand > best.ms;
    // Empate (o fecha inválida) → desempate estable por eventId.
    return candId > best.item.eventId;
  };

  for (const it of timeline) {
    if (it.kind === 'weight') {
      if (it.weightKg == null) continue; // sin número → no es un peso vigente válido
      if (isNewer(it.eventDate, it.eventId, weightBest)) {
        weightBest = { item: it, ms: Date.parse(it.eventDate) };
      }
    } else if (it.kind === 'condition_score') {
      if (it.score == null) continue;
      if (isNewer(it.eventDate, it.eventId, scoreBest)) {
        scoreBest = { item: it, ms: Date.parse(it.eventDate) };
      }
    }
  }

  if (weightBest && weightBest.item.weightKg != null) {
    state.weight = { kg: weightBest.item.weightKg, date: weightBest.item.eventDate };
  }
  if (scoreBest && scoreBest.item.score != null) {
    state.conditionScore = { score: scoreBest.item.score, date: scoreBest.item.eventDate };
  }
  return state;
}

// ─── Fecha humana es-AR (PURA: `now` inyectado) ──────────────────────────────────────────

const MESES_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type FormatEventDateOpts = {
  /**
   * El valor es una FECHA calendario (columna `date`, sin hora) — ver isDateOnlyKind. En ese caso
   * NO se interpreta el huso ni se muestra hora: la fecha que el usuario tipeó son los componentes
   * UTC del valor (la RPC lo devuelve como UTC-medianoche). Sin esto, un evento de HOY en AR (UTC-3)
   * se vería como "Ayer" porque la medianoche-UTC cae el día anterior en hora local.
   */
  dateOnly?: boolean;
};

/**
 * Formatea una fecha ISO a un label humano es-AR, relativo a `now`.
 *
 * NO date-only (instante real: observacion `created_at`, category_change `changed_at`) — huso LOCAL:
 *   - hoy        → "Hoy HH:MM"
 *   - ayer       → "Ayer"
 *   - mismo año  → "DD MMM" (mes es-AR abreviado, ej. "15 mar")
 *   - otro año   → "DD/MM/AAAA"
 *
 * date-only (columna `date`: weight/condition_score/sanitary/lab_sample/reproductive) — la fecha es
 * el día calendario que el usuario tipeó (componentes UTC del valor), SIN huso y SIN hora:
 *   - mismo día → "Hoy" (sin hora)  ·  ayer → "Ayer"  ·  mismo año → "DD MMM"  ·  otro año → "DD/MM/AAAA"
 *
 * `now` se inyecta (NO Date.now() interno) para tests deterministas. Si `iso` no parsea, devuelve ''.
 */
export function formatEventDate(
  iso: string | null | undefined,
  now: Date,
  opts?: FormatEventDateOpts,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  if (opts?.dateOnly) {
    // El valor es UTC-medianoche del día tipeado → sus componentes UTC SON la fecha calendario.
    // Comparamos contra la fecha LOCAL de `now` (lo que el operario llama "hoy"). Sin huso, sin hora.
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();

    if (y === now.getFullYear() && mo === now.getMonth() && day === now.getDate()) {
      return 'Hoy';
    }
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (y === yest.getFullYear() && mo === yest.getMonth() && day === yest.getDate()) {
      return 'Ayer';
    }
    if (y === now.getFullYear()) {
      return `${day} ${MESES_ES[mo]}`;
    }
    return `${pad2(day)}/${pad2(mo + 1)}/${y}`;
  }

  // Instante real: huso LOCAL del dispositivo (lo que el operario espera ver), con hora si es hoy.
  if (sameDay(d, now)) {
    return `Hoy ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) {
    return 'Ayer';
  }

  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getDate()} ${MESES_ES[d.getMonth()]}`;
  }

  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ─── Humanizadores de enums → label es-AR ────────────────────────────────────────────────

const REPRO_LABELS: Record<ReproEventType, string> = {
  service: 'Servicio',
  tacto: 'Tacto',
  birth: 'Parto',
  abortion: 'Aborto',
  weaning: 'Destete',
  drying: 'Secado',
  rejection: 'Rechazo',
};

export function humanizeReproEventType(t: string | null | undefined): string {
  if (!t) return 'Reproducción';
  return REPRO_LABELS[t as ReproEventType] ?? 'Reproducción';
}

const PREGNANCY_LABELS: Record<PregnancyStatus, string> = {
  empty: 'Vacía',
  small: 'Preñez chica (cabeza)',
  medium: 'Preñez media (cuerpo)',
  large: 'Preñez grande (cola)',
};

export function humanizePregnancyStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  return PREGNANCY_LABELS[s as PregnancyStatus] ?? null;
}

const SANITARY_LABELS: Record<SanitaryEventType, string> = {
  vaccination: 'Vacunación',
  deworming: 'Desparasitación',
  treatment: 'Tratamiento',
  test: 'Análisis',
  other: 'Sanidad',
};

export function humanizeSanitaryEventType(t: string | null | undefined): string {
  if (!t) return 'Sanidad';
  return SANITARY_LABELS[t as SanitaryEventType] ?? 'Sanidad';
}

const SAMPLE_LABELS: Record<LabSampleType, string> = {
  blood: 'Sangre',
  scrape_tricho: 'Raspaje (trichomonas)',
  scrape_campylo: 'Raspaje (campylobacter)',
  other: 'Otra muestra',
};

export function humanizeSampleType(t: string | null | undefined): string | null {
  if (!t) return null;
  return SAMPLE_LABELS[t as LabSampleType] ?? null;
}

const ROUTE_LABELS: Record<string, string> = {
  subcutaneous: 'Subcutánea',
  intramuscular: 'Intramuscular',
  intravenous: 'Intravenosa',
  oral: 'Oral',
  topical: 'Tópica',
  sc: 'Subcutánea',
  im: 'Intramuscular',
  iv: 'Intravenosa',
};

export function humanizeRoute(r: string | null | undefined): string | null {
  if (!r) return null;
  return ROUTE_LABELS[r.toLowerCase()] ?? r;
}

/**
 * Título + detalle del category_change (hito). El `initial` (alta) se trata distinto del resto.
 * Devuelve { title, detail } ya en es-AR. `toName`/`fromName` son los nombres resueltos (o null).
 */
export function describeCategoryChange(item: {
  reason: CategoryChangeReason | null;
  fromCategoryName: string | null;
  toCategoryName: string | null;
}): { title: string; detail: string | null } {
  const to = item.toCategoryName ?? 'categoría';
  if (item.reason === 'initial') {
    return { title: 'Alta', detail: `Categoría inicial: ${to}` };
  }
  const reasonSuffix =
    item.reason === 'auto_transition'
      ? ' (automático)'
      : item.reason === 'revert_to_auto'
        ? ' (volvió a automático)'
        : item.reason === 'manual_override'
          ? ' (manual)'
          : '';
  return { title: `Cambió a ${to}`, detail: reasonSuffix ? reasonSuffix.trim() : null };
}
