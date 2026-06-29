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

import { formatCmAR } from './wheel-picker';

// ─── Kinds + payloads tipados (espejo de los 7 orígenes de la RPC 0035 + la CE compuesta en cliente) ──

export type TimelineKind =
  | 'weight'
  | 'reproductive'
  | 'sanitary'
  | 'condition_score'
  | 'lab_sample'
  | 'category_change'
  | 'observacion'
  // Circunferencia escrotal (CE) del toro (spec 03 M6, US-14, R14.14). NO viene de la vista server
  // `animal_timeline` (que no lee `scrotal_measurements`): la ficha la COMPONE en el cliente desde la
  // lectura LOCAL (`fetchScrotalHistory`) y la mergea al riel (design §12.6 — default = composición en
  // cliente, no toca la vista). Por eso no hay rama de parseo en `parseTimelineRow` (la RPC nunca la
  // emite); el mapeo de las filas locales lo hace `scrotalRowsToTimelineItems` (abajo).
  | 'scrotal';

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
  // 'scrotal': `measured_at` es una columna `date` (sin hora) — fecha calendario que el operario fijó,
  // igual que weight/condition_score. Va date-only para que una CE de hoy NO se vea como "Ayer" (UTC-3).
  'scrotal',
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

/** pregnancy_status de reproductive_events (R6.2): empty=vacía / small=cola / medium=cuerpo / large=cabeza. */
export type PregnancyStatus = 'empty' | 'small' | 'medium' | 'large';

/**
 * service_type de reproductive_events (R6.2): monta natural / inseminación (IA) / transferencia
 * embrionaria (TE). NO viene en el payload de la RPC animal_timeline (0035) → se enriquece
 * client-side con una query suplementaria (applyServiceTypes), igual que los nombres de categoría.
 */
export type ServiceType = 'natural' | 'ai' | 'te';

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
//
// `createdAt` (timestamp REAL de inserción) está en TODOS los kinds: la RPC animal_timeline (0069) lo
// trae como columna top-level desde cada origen (weight_events.created_at, …, reproductive_events.
// created_at; para category_change usa changed_at, su instante real). Se usa para (1) ORDENAR el
// timeline dentro de un mismo día calendario (lo recién registrado arriba; ver parseTimeline) y (2)
// desempatar el estado reproductivo vigente cuando dos eventos repro caen el mismo `eventDate` (ver
// deriveCurrentState). Es `string | null`: null defensivo si la fila no lo trajo (RPC vieja / payload
// raro) → el orden cae al desempate por `seq` (orden de inserción local).
//
// `seq` (orden de LECTURA del read local = proxy del ORDEN DE INSERCIÓN local) — TAREA 2 / fix flake del
// estado repro. La fuente de la verdad del orden a igualdad de `event_date` (columna `date`, SIN hora) es
// `created_at`: el server lo sella con `now()` al insertar ⇒ orden de subida = orden de inserción local.
// Cuando el `created_at` aún NO está sellado (fila CRUD-plano cargada local que todavía no subió → NULL
// en el SQLite local), el único predictor FIEL de "quién va a quedar posterior server-side" es el orden
// de inserción local. `buildTimelineQuery` entrega las filas
// `ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC` (la cláusula `created_at IS NULL ASC`
// empuja los NULL AL FINAL = recién insertado, aún sin sellar server-side = más reciente)
// (mismo criterio que el espejo de categoría YA-probado, `buildCategoryMirrorEventsQuery`/RC6.1.4): a
// igualdad de (event_date, created_at) SQLite las devuelve en su orden de almacenamiento estable (proxy
// del orden de inserción) → el de índice MAYOR se insertó después ⇒ es posterior. El service (fetchTimeline)
// asigna `seq` = ese índice. Reemplaza al `eventId` (UUID v4 RANDOM) como desempate estable: el eventId
// daba ~50/50 en el caso "tacto + parto/aborto el mismo día sin created_at sellado" (el bug). Es `number`
// en el path real; los call-sites que no lo aportan (RPC fallback / tests legados) usan `eventId` como
// fallback estable (ver parseTimeline / isNewerRepro).
export type TimelineItem =
  | {
      kind: 'weight';
      eventId: string;
      eventDate: string;
      createdAt: string | null;
      seq?: number;
      weightKg: number | null;
      source: string | null;
      notes: string | null;
    }
  | {
      kind: 'reproductive';
      eventId: string;
      eventDate: string;
      createdAt: string | null;
      seq?: number;
      eventType: ReproEventType | null;
      pregnancyStatus: PregnancyStatus | null;
      calfId: string | null;
      /**
       * service_type del evento. La RPC animal_timeline NO lo trae → el parser lo deja `null` y el
       * service lo completa con applyReproMeta (una query suplementaria, mismo patrón que los nombres
       * de category_change). Solo es relevante para event_type 'service'; en otros queda null.
       */
      serviceType: ServiceType | null;
      notes: string | null;
      /**
       * created_by del evento (spec 10 T-UI.8 / R4.5). El read local lo proyecta para gatear (best-effort)
       * el borrado del evento desde la ficha (owner|autor). null = sin autor registrado / fila legacy. La
       * BARRERA REAL es la RLS UPDATE server-side. La RPC animal_timeline (path online legacy) NO lo trae.
       */
      createdBy: string | null;
    }
  | {
      kind: 'sanitary';
      eventId: string;
      eventDate: string;
      createdAt: string | null;
      seq?: number;
      eventType: SanitaryEventType | null;
      productName: string | null;
      route: string | null;
      notes: string | null;
      /** created_by del evento (spec 10 T-UI.8). Ver la nota de `reproductive.createdBy`. */
      createdBy: string | null;
    }
  | {
      kind: 'condition_score';
      eventId: string;
      eventDate: string;
      createdAt: string | null;
      seq?: number;
      score: number | null;
      notes: string | null;
    }
  | {
      kind: 'lab_sample';
      eventId: string;
      eventDate: string;
      createdAt: string | null;
      seq?: number;
      sampleType: LabSampleType | null;
      tubeNumber: string | null;
      result: string | null;
      receivedDate: string | null;
    }
  | {
      kind: 'category_change';
      eventId: string;
      eventDate: string;
      createdAt: string | null;
      seq?: number;
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
      createdAt: string | null;
      seq?: number;
      eventType: string | null;
      text: string | null;
      authorId: string | null;
      editWindowUntil: string | null;
    }
  | {
      // Circunferencia escrotal (CE) del toro (spec 03 M6, R14.14). Compuesta en el cliente desde la
      // lectura local (NO de la RPC animal_timeline). `eventDate` = measured_at (date-only). `circumferenceCm`
      // siempre presente (la lectura solo trae filas reales); `ageMonths` snapshot nullable (R14.8).
      kind: 'scrotal';
      eventId: string;
      eventDate: string;
      createdAt: string | null;
      seq?: number;
      circumferenceCm: number;
      ageMonths: number | null;
    };

/** Fila cruda de la RPC animal_timeline (PostgREST devuelve el set como array de filas). */
export type TimelineRow = {
  event_kind: string;
  event_id: string;
  event_date: string;
  /** Timestamp REAL de inserción del evento (RPC 0069, top-level). Para el orden dentro del día. */
  created_at: string;
  /**
   * Orden de LECTURA del read local (índice de la fila en el set que devuelve buildTimelineQuery,
   * `ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC` — la cláusula `created_at IS NULL ASC`
   * empuja los NULL AL FINAL = recién insertado, aún sin sellar = más reciente). Proxy FIEL del orden de inserción local cuando el
   * `created_at` aún no está sellado server-side (ver TimelineItem.seq). Opcional: las filas de una RPC
   * que no lo aporten dejan `seq` undefined → el desempate cae a `eventId` (fallback estable).
   */
  seq?: number;
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
  // `createdAt` viene de la RPC (0069) para TODOS los kinds. Defensivo: si la fila no lo trajo (RPC
  // vieja / shape raro), queda null → el orden cae al desempate por `seq` (orden de inserción) y, sin
  // `seq`, a `eventId` (fallback estable).
  const createdAt = typeof row.created_at === 'string' && row.created_at.length > 0 ? row.created_at : null;
  // `seq` = orden de lectura del read local (proxy del orden de inserción). Solo se propaga si la fila lo
  // trae (el path real, fetchTimeline, lo asigna); si no, queda undefined (los tie-breaks usan eventId).
  const seq = typeof row.seq === 'number' ? row.seq : undefined;
  const base = { eventId: row.event_id, eventDate: row.event_date, createdAt, seq };
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
        // service_type NO viene en la RPC → null acá; lo completa applyReproMeta. createdAt SÍ viene de
        // la RPC (0069) → ya está en `base`, NO se pisa con null (ese era el bug que esto cierra).
        serviceType: null,
        notes: str(p, 'notes'),
        // created_by (spec 10 T-UI.8): lo proyecta el read local; la RPC online legacy no → null.
        createdBy: str(p, 'created_by'),
      };
    case 'sanitary':
      return {
        kind: 'sanitary',
        ...base,
        eventType: str(p, 'event_type') as SanitaryEventType | null,
        productName: str(p, 'product_name'),
        route: str(p, 'route'),
        notes: str(p, 'notes'),
        createdBy: str(p, 'created_by'),
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
 * Clave de DÍA CALENDARIO de un item del timeline, como entero `AAAAMMDD` ordenable (mayor = más
 * reciente). El criterio del día es EL MISMO que usa formatEventDate (ver isDateOnlyKind), para que un
 * date-only de hoy y un timestamp de hoy caigan en EL MISMO día (si no, el bug se reproduce al revés):
 *   - date-only (weight/condition_score/sanitary/lab_sample/reproductive): el valor llega como
 *     UTC-medianoche del día que el usuario tipeó → sus componentes UTC SON la fecha calendario.
 *   - instante real (observacion/category_change): es un timestamptz real → su día calendario es el
 *     día LOCAL del dispositivo (lo que el operario llama "hoy"), igual que lo muestra formatEventDate.
 * PURA, sin huso asumido (usa los getters UTC vs locales explícitamente). Fecha inválida → null.
 */
function dayKey(item: TimelineItem): number | null {
  const d = new Date(item.eventDate);
  if (Number.isNaN(d.getTime())) return null;
  if (isDateOnlyKind(item.kind)) {
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Parsea + ordena un set de filas crudas. Orden (fix del bug de orden del timeline):
 *   (1) DÍA CALENDARIO de eventDate, descendente — el día más reciente arriba. El día se extrae con
 *       dayKey (mismo criterio que formatEventDate: UTC para date-only, local para instantes) → un
 *       date-only de hoy y un timestamp de hoy comparten día.
 *   (2) dentro del mismo día, `createdAt` (instante REAL de inserción) DESCENDENTE — lo recién
 *       registrado arriba. Esto pone un servicio/tacto/etc. cargado hoy ARRIBA de los eventos del
 *       mismo día con hora real (Alta, "Cambió a…", observaciones), que antes lo tapaban porque el
 *       date-only volvía como 00:00 < su hora real. Un evento BACKDATED (fecha vieja, createdAt nuevo)
 *       NO salta al tope: cae en SU día (el orden por día manda) y solo se ordena por createdAt
 *       DENTRO de ese día.
 *   (3) desempate final estable por `seq` (orden de inserción local) DESCENDENTE — el insertado después
 *       arriba. Reemplaza al `eventId` (UUID v4 RANDOM, que barajaba el array en el caso "mismo día +
 *       ambos createdAt null" — TAREA 2). Sin `seq` en alguno (RPC fallback / tests legados) cae a
 *       `eventId` (estable, determinístico para tests; sin Date.now() interno).
 * PURA, TZ-independiente (no usa la hora local para comparar instantes entre días, solo el día).
 */
export function parseTimeline(rows: readonly TimelineRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const item = parseTimelineRow(row);
    if (item) items.push(item);
  }
  return sortTimelineItems(items);
}

/**
 * Ordena un set de TimelineItem ya parseados con el MISMO criterio que `parseTimeline` (día calendario
 * desc → createdAt desc dentro del día → seq desc → eventId). Extraído para que la ficha pueda MERGEAR la
 * CE compuesta en cliente (`scrotalRowsToTimelineItems`) con el riel del server y re-ordenar el conjunto
 * (la CE no viene de la RPC → no pasa por `parseTimeline`). NO muta el array de entrada (copia + sort).
 * PURA, TZ-independiente.
 */
export function sortTimelineItems(items: readonly TimelineItem[]): TimelineItem[] {
  const out = [...items];
  out.sort((a, b) => {
    // (1) día calendario desc. Un día inválido (fecha no parseable) se trata como el MÁS VIEJO posible
    // (-Infinity) → cae al fondo, sin romper el orden del resto.
    const dayA = dayKey(a) ?? -Infinity;
    const dayB = dayKey(b) ?? -Infinity;
    if (dayA !== dayB) return dayB - dayA;
    // (2) mismo día → createdAt desc (lo recién registrado arriba). createdAt ausente en alguno →
    // ese instante se trata como el MÁS VIEJO (-Infinity) para no saltar el orden; si ambos faltan o
    // empatan, cae al desempate por eventId.
    const ca = a.createdAt != null ? Date.parse(a.createdAt) : NaN;
    const cb = b.createdAt != null ? Date.parse(b.createdAt) : NaN;
    const msA = Number.isFinite(ca) ? ca : -Infinity;
    const msB = Number.isFinite(cb) ? cb : -Infinity;
    if (msA !== msB) return msB - msA;
    // (3) desempate estable por `seq` (orden de inserción local) — el insertado después (seq mayor)
    // arriba. Solo si AMBOS lo tienen; si falta en alguno, cae al fallback por eventId.
    if (typeof a.seq === 'number' && typeof b.seq === 'number' && a.seq !== b.seq) {
      return b.seq - a.seq;
    }
    // fallback estable por eventId (mayor primero) — RPC sin seq / tests legados.
    return a.eventId < b.eventId ? 1 : a.eventId > b.eventId ? -1 : 0;
  });
  return out;
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

/**
 * Metadato suplementario de un reproductive_event que la RPC animal_timeline NO trae y el service
 * enriquece con una query a reproductive_events: `service_type` (tipo de servicio). El `created_at` YA
 * NO se enriquece acá — viene de la RPC (0069) como columna top-level para TODOS los kinds.
 */
export type ReproMeta = {
  serviceType?: string | null;
};

const SERVICE_TYPES: ReadonlySet<string> = new Set<ServiceType>(['natural', 'ai', 'te']);

/**
 * Completa `serviceType` de los items reproductive desde el mapa eventId→ReproMeta (NO muta; espejo de
 * resolveCategoryNames). La RPC animal_timeline NO trae service_type → el service lo enriquece con UNA
 * query suplementaria a reproductive_events. Tolerante: un eventId sin entrada en el mapa, o un
 * service_type que no es un ServiceType conocido, queda `null` (no rompe el item). NO toca `createdAt`
 * (ese viene de la RPC, ya está en el item). Solo toca los items reproductive; el resto pasa intacto.
 */
export function applyReproMeta(
  items: readonly TimelineItem[],
  byId: Readonly<Record<string, ReproMeta>>,
): TimelineItem[] {
  return items.map((it) => {
    if (it.kind !== 'reproductive') return it;
    const meta = byId[it.eventId];
    const rawType = meta?.serviceType ?? null;
    const serviceType = rawType != null && SERVICE_TYPES.has(rawType) ? (rawType as ServiceType) : null;
    return { ...it, serviceType };
  });
}

// ─── Circunferencia escrotal: composición en el cliente del riel (spec 03 M6, R14.14) ─────
//
// La CE NO está en la vista server `animal_timeline` (design §12.6 — default = composición en el
// cliente, sin tocar el schema). La ficha lee el histórico LOCAL (`fetchScrotalHistory`) y lo mapea a
// TimelineItem con estos helpers, los mergea con el resto del riel y re-ordena con `parseTimeline` (el
// `eventDate` de la CE = `measured_at`, date-only) → la CE aparece en el riel como un evento más.

/** Una fila del histórico de CE como la devuelve la lectura local (shape de `ScrotalMeasurementRow`). */
export type ScrotalTimelineRow = {
  id: string;
  circumferenceCm: number;
  ageMonths: number | null;
  measuredAt: string;
  createdAt: string | null;
};

/**
 * Mapea las filas del histórico de CE a TimelineItem de kind 'scrotal'. PURO. El `eventId` = el id real de
 * la medición (estable, no UUID random → desempate determinístico en `parseTimeline`); `eventDate` =
 * measured_at (date-only). Tolerante: una fila sin `measuredAt` (no debería: la columna es NOT NULL) se
 * descarta para no romper el orden por fecha. NO ordena (lo hace `parseTimeline` al mergear con el resto).
 */
export function scrotalRowsToTimelineItems(
  rows: readonly ScrotalTimelineRow[] | null | undefined,
): TimelineItem[] {
  if (!rows) return [];
  const items: TimelineItem[] = [];
  for (const r of rows) {
    if (!r.measuredAt) continue;
    items.push({
      kind: 'scrotal',
      eventId: r.id,
      eventDate: r.measuredAt,
      createdAt: r.createdAt,
      circumferenceCm: r.circumferenceCm,
      ageMonths: r.ageMonths,
    });
  }
  return items;
}

// ─── Estado actual del animal (último valor vigente por medición tipada) ──────────────────
//
// Decisión de modelo (fix-loop 2, FIX C): los datos MEDIDOS del animal no son SOLO eventos. El
// timeline es la auditoría/historial; pero el VALOR VIGENTE de cada medición tipada (el del evento
// más reciente de ese tipo) es un ATRIBUTO del animal que se muestra en la ficha. Solo las
// observaciones libres quedan únicamente en el timeline (no tienen "valor actual").
//
// Para C3.1 los tipos cargables eran peso + condición corporal. C3.2a agrega el ESTADO REPRODUCTIVO
// (preñez): el valor vigente lo determina el evento reproductivo más reciente entre tacto/birth/abortion
// (los que definen preñez; service/weaning/drying/rejection NO la determinan). La ficha lo muestra
// (solo hembras) sin tocar la lógica de selección.

/**
 * Estado reproductivo vigente (preñez). Lo determina el evento más reciente entre tacto/birth/abortion:
 *   - tacto positivo (status ≠ empty) → preñada, con el tamaño de preñez.
 *   - tacto empty → vacía (vía tacto).
 *   - birth → vacía (parió: ya no está preñada).
 *   - abortion → vacía (vía aborto).
 * `via` distingue el origen de un estado "vacía" (para que la ficha pueda matizar el copy si quiere).
 */
export type PregnancyState =
  | { kind: 'pregnant'; status: 'small' | 'medium' | 'large'; date: string }
  | { kind: 'empty'; date: string; via: 'tacto' | 'birth' | 'abortion' };

export type CurrentState = {
  /** Peso vigente: kg + fecha del weight_event más reciente. Ausente si nunca se pesó. */
  weight?: { kg: number; date: string };
  /** Condición corporal vigente: score + fecha del condition_score_event más reciente. */
  conditionScore?: { score: number; date: string };
  /**
   * Estado reproductivo vigente (preñez). Ausente si no hay ningún evento reproductivo que la
   * determine (tacto/birth/abortion). La ficha lo muestra solo para hembras.
   */
  pregnancy?: PregnancyState;
};

/**
 * Deriva el ESTADO ACTUAL del animal a partir de su timeline: el valor vigente de cada medición
 * tipada = el del evento de MAYOR `eventDate` de ese kind. PURA, sin orden asumido: recorre todo el
 * timeline y se queda con el máximo por kind (NO confía en que `parseTimeline` ya ordenó — robusto
 * ante cualquier orden de entrada). Timeline vacío/null → `{}`. Un evento con valor null (payload
 * incompleto) NO cuenta como vigente (no surfaceamos un "peso actual" sin número).
 *
 * Empate de fecha (mismo `eventDate` exacto):
 *   - weight / condition_score → desempate estable por `eventId` mayor (el id "más alto" gana).
 *   - reproductive → desempate por `seq` (orden de inserción local), porque a igualdad de `eventDate`
 *     (columna `date`, SIN hora) el orden total real lo da el `created_at` = INSTANTE DE CREACIÓN. Los
 *     INSERT CRUD-plano de reproductive_events ahora setean created_at de CLIENTE al insertar (tacto/
 *     service/abortion, ver banner en local-reads.ts) y el parto del overlay también → TODOS los
 *     determinantes tienen un instante real de creación. `buildTimelineQuery` entrega las filas
 *     `ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC` (created_at ascendentes; NULL al
 *     final = recién insertado sin sellar = más reciente; espejo de buildCategoryMirrorEventsQuery/RC6.1.4)
 *     → fetchTimeline asigna ese orden de lectura como `seq`. El INSERTADO DESPUÉS (created_at mayor → seq
 *     MAYOR) es posterior ⇒ gana. Esto hace DETERMINÍSTICO el bug: tacto + parto/aborto el MISMO día (el
 *     parto/aborto, creado DESPUÉS, GANA ⇒ "Vacía" SIEMPRE), reemplazando el `eventId` UUID random (~50/50).
 *     Sin `seq` (RPC fallback / tests legados) cae a `createdAt` (el mayor si AMBOS presentes; null = recién
 *     insertado = más reciente) y, sin él, a `eventId` mayor (estable). PURA.
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
  // Preñez: el evento reproductivo más reciente que la DETERMINA (tacto/birth/abortion). Los demás
  // event_type reproductivos (service/weaning/drying/rejection) NO cambian el estado de preñez.
  let reproBest: {
    item: Extract<TimelineItem, { kind: 'reproductive' }>;
    ms: number;
  } | null = null;

  // ¿`candidate` es más reciente que `best`? Mayor fecha gana; empate → mayor eventId. (weight/score)
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

  // ¿`cand` es más reciente que `best` para los eventos repro? Fecha mayor gana; a igualdad de eventDate
  // (columna `date` sin hora), DESEMPATE PRIMARIO por `seq` (orden de inserción local = orden de lectura de
  // buildTimelineQuery `ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC` → created_at
  // ascendentes y NULL al final; el insertado DESPUÉS queda con seq mayor). Como los repro CRUD-plano ahora
  // setean created_at de cliente al insertar (ver banner en local-reads.ts) y el parto del overlay también,
  // el caso REALISTA es "ambos created_at presentes" → el seq sale del orden por created_at = orden de
  // creación. Fallback sin seq: created_at (mayor, con null = recién insertado = más reciente), luego
  // eventId. Espeja la precedencia server (animal-category.ts/RC6.1.4) de forma DETERMINÍSTICA.
  const isNewerRepro = (
    cand: Extract<TimelineItem, { kind: 'reproductive' }>,
    best: { item: Extract<TimelineItem, { kind: 'reproductive' }>; ms: number } | null,
  ): boolean => {
    if (!best) return true;
    const candMs = Date.parse(cand.eventDate);
    if (Number.isFinite(candMs) && candMs !== best.ms) return candMs > best.ms;
    // Mismo eventDate (mismo día). (1) DESEMPATE PRIMARIO: seq (orden de inserción local). El insertado
    // DESPUÉS (seq mayor) es posterior → gana.
    if (typeof cand.seq === 'number' && typeof best.item.seq === 'number' && cand.seq !== best.item.seq) {
      return cand.seq > best.item.seq;
    }
    // (2) Fallback SIN seq (RPC que no lo aporta / tests legados): created_at. Un null = recién insertado
    // local (el trigger lo sella al SUBIR) = MÁS RECIENTE que cualquier presente (isAfter/RC6.1.4).
    const candCa = cand.createdAt;
    const bestCa = best.item.createdAt;
    if (candCa !== bestCa) {
      if (candCa === null) return true; // cand recién insertado → posterior
      if (bestCa === null) return false; // best recién insertado → cand NO posterior
      const candCreated = Date.parse(candCa);
      const bestCreated = Date.parse(bestCa);
      // PowerSync materializa el texto timestamptz de PG (ISO uniforme, lexicográficamente ordenable) →
      // Date.parse es fiable; fallback lexicográfico si alguno no parsea (defensivo).
      if (Number.isNaN(candCreated) || Number.isNaN(bestCreated)) return candCa > bestCa;
      return candCreated > bestCreated;
    }
    // (3) seq y createdAt no deciden → desempate estable por eventId (previo).
    return cand.eventId > best.item.eventId;
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
    } else if (it.kind === 'reproductive') {
      // Solo tacto/birth/abortion determinan preñez. service/weaning/drying/rejection no la cambian.
      if (it.eventType !== 'tacto' && it.eventType !== 'birth' && it.eventType !== 'abortion') {
        continue;
      }
      if (isNewerRepro(it, reproBest)) {
        reproBest = { item: it, ms: Date.parse(it.eventDate) };
      }
    }
  }

  if (weightBest && weightBest.item.weightKg != null) {
    state.weight = { kg: weightBest.item.weightKg, date: weightBest.item.eventDate };
  }
  if (scoreBest && scoreBest.item.score != null) {
    state.conditionScore = { score: scoreBest.item.score, date: scoreBest.item.eventDate };
  }
  const pregnancy = reproBest ? toPregnancyState(reproBest.item) : undefined;
  if (pregnancy) state.pregnancy = pregnancy;
  return state;
}

/**
 * Mapea el evento reproductivo determinante (tacto/birth/abortion) a un PregnancyState. Un `tacto`
 * con pregnancy_status null o desconocido NO se puede interpretar como preñez ni como vacía → devuelve
 * undefined (no surfaceamos un estado a ciegas). birth/abortion siempre significan "vacía".
 */
function toPregnancyState(
  item: Extract<TimelineItem, { kind: 'reproductive' }>,
): PregnancyState | undefined {
  const date = item.eventDate;
  if (item.eventType === 'birth') return { kind: 'empty', date, via: 'birth' };
  if (item.eventType === 'abortion') return { kind: 'empty', date, via: 'abortion' };
  if (item.eventType === 'tacto') {
    const s = item.pregnancyStatus;
    if (s === 'empty') return { kind: 'empty', date, via: 'tacto' };
    if (s === 'small' || s === 'medium' || s === 'large') {
      return { kind: 'pregnant', status: s, date };
    }
    // tacto con status null/desconocido: sin dato claro → no surfaceamos preñez.
    return undefined;
  }
  return undefined;
}

/**
 * ¿El animal tuvo AL MENOS un aborto? (dominio Facundo §1, A2: el flag "tuvo aborto" — la "marquita
 * roja" — se DERIVA de la existencia de un evento reproductivo `abortion`, NO es una columna de estado).
 * PURA: recorre el timeline y devuelve true si hay un evento reproductivo con eventType 'abortion'.
 * Timeline vacío/null → false. Es PERMANENTE: una vez que hay un aborto, el flag queda para siempre
 * (no se "limpia" por una preñez posterior — es historia, marca al animal).
 */
export function hasAbortion(timeline: readonly TimelineItem[] | null | undefined): boolean {
  if (!timeline) return false;
  return timeline.some((it) => it.kind === 'reproductive' && it.eventType === 'abortion');
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

// B1 (dominio Facundo §4): término de campo SOLO (Cabeza/Cuerpo/Cola), sin "preñez chica/media/grande".
// Lo usa el detalle del nodo "Tacto" del timeline (humanizePregnancyStatus). small=cola, medium=cuerpo,
// large=cabeza; empty="Vacía".
const PREGNANCY_LABELS: Record<PregnancyStatus, string> = {
  empty: 'Vacía',
  small: 'Cola',
  medium: 'Cuerpo',
  large: 'Cabeza',
};

export function humanizePregnancyStatus(s: string | null | undefined): string | null {
  if (!s) return null;
  return PREGNANCY_LABELS[s as PregnancyStatus] ?? null;
}

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  natural: 'Monta natural',
  ai: 'Inseminación (IA)',
  te: 'Transferencia embrionaria (TE)',
};

export function humanizeServiceType(t: string | null | undefined): string | null {
  if (!t) return null;
  return SERVICE_TYPE_LABELS[t as ServiceType] ?? null;
}

/**
 * Texto del ESTADO de preñez para la ficha ("Estado reproductivo"). El "via" y la fecha los compone
 * la ficha aparte; este humanizer solo da el texto del estado. Ausente → null (la fila muestra "Sin
 * registrar").
 *
 * B1 (dominio Facundo §4): la fila de estado lleva "Preñada (...)" con el término de campo entre
 * paréntesis (cola/cuerpo/cabeza), SIN palabra de tamaño. Mantenemos "Preñada" como estado (a
 * diferencia del selector y el timeline, que van solo con el término) para que se entienda que está
 * preñada. small=cola, medium=cuerpo, large=cabeza.
 */
export function humanizePregnancyState(p: PregnancyState | undefined): string | null {
  if (!p) return null;
  if (p.kind === 'empty') return 'Vacía';
  switch (p.status) {
    case 'small':
      return 'Preñada (cola)';
    case 'medium':
      return 'Preñada (cuerpo)';
    case 'large':
      return 'Preñada (cabeza)';
  }
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
  intranasal: 'Intranasal',
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

/**
 * Edad en meses → label es-AR con AÑOS tras los 24 meses (FIX #11, 2026-06-29 — pedido de Raf para la CE de
 * la ficha). ÚNICO formateador de edad de CE: lo usan la LISTA (ScrotalSeriesRow) y el RIEL/timeline
 * (describeScrotalTimeline) → mismo dato, mismo formato en las dos pantallas (consistencia, no divergencia).
 *   - < 24 meses → en meses ("18 meses", "1 mes")
 *   - ≥ 24 meses → años + meses ("2 años 3 meses"; "2 años" si no sobran meses; "2 años 1 mes" en singular).
 *
 * null/no-finito → null (la CE sin edad solo muestra los cm). Redondea (snapshot histórico, R14.8 — NO snapea
 * a rueda). No guarda negativos (la edad snapshot no es negativa).
 */
export function formatAgeYearsAR(months: number | null | undefined): string | null {
  if (months == null || !Number.isFinite(months)) return null;
  const m = Math.round(months);
  if (m < 24) return m === 1 ? '1 mes' : `${m} meses`;
  const years = Math.floor(m / 12);
  const rem = m % 12;
  const yearsLabel = years === 1 ? '1 año' : `${years} años`;
  if (rem === 0) return yearsLabel;
  const monthsLabel = rem === 1 ? '1 mes' : `${rem} meses`;
  return `${yearsLabel} ${monthsLabel}`;
}

/**
 * Detalle es-AR de una medición de CE para el riel/tarjeta: la CE en cm (coma decimal, reusa `formatCmAR`)
 * + la edad snapshot si está, en años tras 24m ("36,5 cm · 2 años"); edad null (R14.7/R14.8) → solo la CE
 * ("36,5 cm"). MISMA fuente de edad que la LISTA de la ficha (`formatAgeYearsAR`, FIX #11) → riel y lista
 * consistentes. El TÍTULO del evento ("Circunferencia escrotal") lo pone el componente (TimelineEvent / la tarjeta).
 */
export function describeScrotalTimeline(item: {
  circumferenceCm: number;
  ageMonths: number | null;
}): string {
  const ce = `${formatCmAR(item.circumferenceCm)} cm`;
  const age = formatAgeYearsAR(item.ageMonths);
  return age ? `${ce} · ${age}` : ce;
}
