// Lógica PURA del SELECTOR DE MESES de servicio del rodeo (spec 03 Stream B / B1 — DD-PSC-5).
// Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que rodeo-template.ts /
// wheel-picker.ts). El componente `ServiceMonthsSelector` (alta + edición) consume estas funciones; el
// cableado a la RPC `create_rodeo(p_service_months)` / `set_rodeo_service_months` es POST-VETO (no acá).
//
// Modelo (Gate 0 §6 + Stream A as-built):
//   - El servicio natural es nivel-RODEO: en qué MESES del año (1=enero … 12=diciembre) ese rodeo hace
//     servicio. Persiste como `rodeos.service_months smallint[]` (0102). Caso dominante en cría =
//     PRIMAVERA (Oct/Nov/Dic) → pre-tildado en el ALTA (RPSC.2.2), NO en la edición (RPSC.3.2).
//   - 🔑 CONTIGÜIDAD POR CONSTRUCCIÓN (Raf 2026-06-23, RPSC.2.3/RPSC.2.8/RPSC.2.9): un rodeo hace UN solo
//     período CONTIGUO de servicio (ej. Oct/Nov/Dic, o Jun/Jul, o continuo los 12, o ninguno). NO se puede
//     armar un set DISJUNTO (Oct + Mar separados = PROHIBIDO). Un campo con primavera Y otoño los maneja
//     en RODEOS SEPARADOS. La contigüidad ADMITE WRAP de fin de año: Nov-Dic-Ene es un período válido (Dic
//     adyacente a Ene). El array que se persiste sigue siendo `smallint[]` ORDENADO ASCENDENTE (Stream A
//     usa set-membership, el orden no importa para la DB); el ORDEN DE SERVICIO (para el label "Nov → Ene")
//     se deriva del run con `serviceRunBounds`.
//   - PowerSync materializa el `smallint[]` de Postgres como TEXT/JSON client-side → `parseServiceMonths`
//     lo convierte a `number[] | null` de forma TOLERANTE (RPSC.3.7): null/''/no-array/corrupto →
//     `null` ("sin configurar", distinto de `[]` = "no hace servicio"), valores fuera de 1–12 se filtran;
//     NUNCA tira.
//   - `toServiceMonthsArray` mapea un conjunto de meses (set 1–12) al array ordenado/único/en-rango que la
//     RPC espera (RPSC.2.6). `isMonthChecked` pinta cada chip del run.

// ─── Default de campaña (Gate 0 §6 — primavera, caso dominante en cría) ───────────────────────────

/** Meses de la campaña de PRIMAVERA: octubre, noviembre, diciembre. Pre-tildado en el ALTA (RPSC.2.2). */
export const SPRING_DEFAULT: readonly number[] = [10, 11, 12];

/** Meses del año válidos (1=enero … 12=diciembre). Rango del `smallint[]` que la RPC valida. */
export const MIN_MONTH = 1;
export const MAX_MONTH = 12;
export const MONTHS_IN_YEAR = 12;

/** Los 12 meses en orden (1..12), para iterar el grid sin recrear el array en cada render. */
export const ALL_MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ─── Etiquetas es-AR de los meses (UI del grid) ───────────────────────────────────────────────────
//
// Abreviadas a 3 letras (Ene…Dic): el chip es chico y manga-friendly; el nombre completo no entra sin
// recortar en un grid de 3-4 columnas. Capitalización es-AR (Ene, no ENE/ene).

const MONTH_SHORT_LABELS: readonly string[] = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

const MONTH_FULL_LABELS: readonly string[] = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Etiqueta corta (3 letras, es-AR) de un mes 1–12 para el chip del grid. Fuera de rango → ''. */
export function monthShortLabel(month: number): string {
  if (!Number.isInteger(month) || month < MIN_MONTH || month > MAX_MONTH) return '';
  return MONTH_SHORT_LABELS[month - 1];
}

/** Etiqueta completa (es-AR) de un mes 1–12, para a11y / lecturas. Fuera de rango → ''. */
export function monthFullLabel(month: number): string {
  if (!Number.isInteger(month) || month < MIN_MONTH || month > MAX_MONTH) return '';
  return MONTH_FULL_LABELS[month - 1];
}

// ─── Núcleo: parseo tolerante + mapeo a array (DD-PSC-5) ────────────────────────────────────────────

/** Normaliza un candidato a mes a un entero 1–12, o `null` si no es un mes válido (tolerante). */
function coerceMonth(raw: unknown): number | null {
  // Aceptamos number y string numérica ("10"): PowerSync puede materializar el array como JSON de
  // strings o de numbers según el driver. Cualquier otra cosa (bool, objeto, NaN, decimal) → descartar.
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw);
  } else {
    return null;
  }
  if (!Number.isInteger(n) || n < MIN_MONTH || n > MAX_MONTH) return null;
  return n;
}

/**
 * Parsea el `service_months` que PowerSync materializa como TEXT/JSON → `number[] | null` (RPSC.3.7).
 * TOLERANTE (NUNCA tira):
 *   - `null` / `undefined` / `''` / `'   '`           → `null`  ("sin configurar", RPSC.3.2)
 *   - JSON inválido / corrupto                         → `null`
 *   - no-array (objeto, número suelto, bool)           → `null`
 *   - array `[]`                                       → `[]`    ("no hace servicio", explícito)
 *   - array con elementos fuera de 1–12 / no enteros   → se FILTRAN (los válidos quedan)
 *   - array que, tras filtrar, queda vacío             → `[]`    (había intención de array, no NULL)
 * Acepta tanto un array JS ya parseado (si la columna llegó como array) como el TEXT JSON
 * (`'[10,11,12]'`) que es el caso real de PowerSync. El resultado se normaliza ordenado y único.
 *
 * Nota de contigüidad: el parseo NO rechaza un set disjunto que pudiera venir de la DB (la DB tolera
 * cualquier set por membership — RPSC.2.9; la contigüidad la enforza el SELECTOR por construcción). Un
 * dato histórico/manual disjunto se LEE tal cual; el selector, al editarlo, sólo puede dejar un run
 * contiguo. `isContiguousWrap` permite detectarlo si se quisiera advertir (no se usa para filtrar acá).
 */
export function parseServiceMonths(raw: unknown): number[] | null {
  let value: unknown = raw;

  if (value === null || value === undefined) return null;

  // TEXT/JSON de PowerSync: intentamos parsear. Postgres también puede emitir el array-literal
  // `{10,11,12}` (no es JSON) → lo convertimos a JSON antes de parsear.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const jsonish = trimmed.startsWith('{') && trimmed.endsWith('}')
      ? `[${trimmed.slice(1, -1)}]`
      : trimmed;
    try {
      value = JSON.parse(jsonish);
    } catch {
      return null; // corrupto → sin configurar
    }
  }

  if (!Array.isArray(value)) return null; // no-array (objeto/number suelto/bool) → sin configurar

  const months: number[] = [];
  for (const el of value) {
    const m = coerceMonth(el);
    if (m !== null) months.push(m);
  }
  // Había intención de array (aunque haya quedado vacío tras filtrar) → `[]`, no `null`.
  return dedupeSort(months);
}

/** Ordena ascendente y deduplica (in-array). Helper interno + base de `toServiceMonthsArray`. */
function dedupeSort(months: number[]): number[] {
  return Array.from(new Set(months)).sort((a, b) => a - b);
}

/**
 * Mapea un conjunto de meses (set 1–12) → array ordenado, único y dentro de rango (RPSC.2.6) — el shape
 * `smallint[]` que la RPC espera. Filtra defensivamente cualquier valor fuera de rango / no entero que
 * llegara al set (la UI no debería meterlos, pero el contrato es duro).
 */
export function toServiceMonthsArray(checked: ReadonlySet<number>): number[] {
  const valid: number[] = [];
  for (const m of checked) {
    if (Number.isInteger(m) && m >= MIN_MONTH && m <= MAX_MONTH) valid.push(m);
  }
  return dedupeSort(valid);
}

/** ¿El mes `m` (1–12) está en el run? Pinta el chip. `null` ("sin configurar") → ningún mes en el run. */
export function isMonthChecked(months: number[] | null, m: number): boolean {
  if (months === null) return false;
  return months.includes(m);
}

// ─── Contigüidad: validación + construcción del run (RPSC.2.9 / DD-PSC-5) ────────────────────────────

/**
 * ¿El conjunto de meses es UN período CONTIGUO (admitiendo WRAP de fin de año)? (RPSC.2.9)
 *   - `[]`            → true  (no hace servicio; vacío es trivialmente "un período" — ninguno)
 *   - los 12          → true  (servicio continuo)
 *   - `[3]`           → true  (un mes)
 *   - `[10,11,12]`    → true  (contiguo simple)
 *   - `[11,12,1]`     → true  (contiguo con WRAP — Dic adyacente a Ene)
 *   - `[12,1,2]`      → true  (wrap)
 *   - `[10,3]`        → false (disjunto: Oct y Mar no son adyacentes ni envuelven adyacentes)
 *   - `[1,2,5,6]`     → false (dos runs separados)
 *   - `null`          → false (no es un conjunto; "sin configurar" no es un período)
 *
 * Algoritmo: en el círculo de 12 meses, un set de N meses es un run contiguo SII al recorrer los meses
 * ordenados, los "saltos" circulares al siguiente son TODOS de 1 salvo a lo sumo UNO (el hueco entre el
 * fin del run y su inicio). Equivalente: a lo sumo un gap circular ≠ 1. (Para N=0 → 0 gaps ≠1; N=1 → el
 * único gap circular es 0, ≠1, conteo 1 → ≤1; N=12 → todos los gaps son 1, conteo 0.)
 */
export function isContiguousWrap(months: number[] | null): boolean {
  if (months === null) return false;
  const sorted = dedupeSort(months);
  const n = sorted.length;
  if (n <= 1) return true; // vacío y un mes son trivialmente contiguos
  if (n >= MONTHS_IN_YEAR) return true; // los 12 → continuo
  let gapsNotOne = 0;
  for (let i = 0; i < n; i += 1) {
    const cur = sorted[i];
    const next = sorted[(i + 1) % n];
    const circularStep = ((next - cur) % MONTHS_IN_YEAR + MONTHS_IN_YEAR) % MONTHS_IN_YEAR;
    if (circularStep !== 1) gapsNotOne += 1;
    if (gapsNotOne > 1) return false; // ≥2 huecos → al menos dos runs → disjunto
  }
  return true;
}

/**
 * Construye el run CONTIGUO de meses desde `start` AVANZANDO en orden de calendario (con wrap) hasta
 * `end` INCLUSIVE. Devuelve el array ORDENADO ASCENDENTE (el shape de persistencia; el orden de servicio
 * se recupera con `serviceRunBounds`). Es la base de la interacción "tap=inicio, 2º tap=fin" (RPSC.2.8):
 *   - buildContiguousRun(10, 12) → [10, 11, 12]            (Oct → Dic)
 *   - buildContiguousRun(11, 1)  → [1, 11, 12]             (Nov → Dic → Ene, WRAP — ordenado asc)
 *   - buildContiguousRun(10, 10) → [10]                    (un mes)
 *   - buildContiguousRun(10, 9)  → [1..12]                 (vuelta completa = los 12)
 * `start`/`end` fuera de rango → []. El resultado SIEMPRE es contiguo por construcción.
 */
export function buildContiguousRun(start: number, end: number): number[] {
  if (
    !Number.isInteger(start) || !Number.isInteger(end) ||
    start < MIN_MONTH || start > MAX_MONTH || end < MIN_MONTH || end > MAX_MONTH
  ) {
    return [];
  }
  const span = ((end - start) % MONTHS_IN_YEAR + MONTHS_IN_YEAR) % MONTHS_IN_YEAR; // 0..11
  const run: number[] = [];
  for (let i = 0; i <= span; i += 1) {
    run.push(((start - 1 + i) % MONTHS_IN_YEAR) + 1);
  }
  return dedupeSort(run);
}

/**
 * Recupera los EXTREMOS del run en ORDEN DE SERVICIO ({start, end}) a partir del array ordenado, SIN
 * necesitar el anchor de la interacción — así el label es correcto aun para un valor que vino de
 * persistencia. Para un run contiguo, `start` es el mes JUSTO DESPUÉS del único hueco grande y `end` el
 * mes JUSTO ANTES. Ej: [1,11,12] → {start:11, end:1} ("Nov → Ene"); [10,11,12] → {start:10, end:12}.
 * Devuelve `null` si el conjunto está vacío, es null, o NO es contiguo (no tiene un run bien definido).
 * Los 12 → {start:1, end:12} (continuo; el label usa "Todo el año", no los extremos).
 */
export function serviceRunBounds(months: number[] | null): { start: number; end: number } | null {
  if (months === null) return null;
  const sorted = dedupeSort(months);
  const n = sorted.length;
  if (n === 0) return null;
  if (!isContiguousWrap(sorted)) return null;
  if (n === 1) return { start: sorted[0], end: sorted[0] };
  if (n >= MONTHS_IN_YEAR) return { start: MIN_MONTH, end: MAX_MONTH };
  // Hallar el único hueco grande (circularStep > 1): el run ARRANCA en el mes después de ese hueco.
  for (let i = 0; i < n; i += 1) {
    const cur = sorted[i];
    const next = sorted[(i + 1) % n];
    const circularStep = ((next - cur) % MONTHS_IN_YEAR + MONTHS_IN_YEAR) % MONTHS_IN_YEAR;
    if (circularStep !== 1) {
      return { start: next, end: cur };
    }
  }
  // No debería llegar acá (un run no-trivial sin hueco grande sería los 12, ya cubierto).
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

// ─── Atajos de un toque (Gate 0 §6 / design §3.1 — reducen fricción sin esconder el control fino) ───
//     Todos producen períodos CONTIGUOS válidos (RPSC.2.8).

/** Un atajo (preset) de un toque del selector. `id` estable; `months` el conjunto que aplica. */
export type ServiceMonthsShortcut = {
  id: 'primavera' | 'otono' | 'todo' | 'ninguno';
  label: string;
  months: readonly number[];
};

/**
 * Atajos del selector (dirección del leader, design §3.1):
 *   - Primavera   = Oct/Nov/Dic (= SPRING_DEFAULT, caso dominante de cría)   → contiguo
 *   - Otoño       = Jun/Jul                                                  → contiguo
 *   - Todo el año = los 12                                                   → contiguo (continuo)
 *   - Ninguno     = vacío (el rodeo no hace servicio)                        → contiguo (trivial)
 * `Ninguno` produce `[]` (no `null`): es una elección EXPLÍCITA del operario, no "sin configurar".
 */
export const SERVICE_MONTHS_SHORTCUTS: readonly ServiceMonthsShortcut[] = [
  { id: 'primavera', label: 'Primavera', months: SPRING_DEFAULT },
  { id: 'otono', label: 'Otoño', months: [6, 7] },
  { id: 'todo', label: 'Todo el año', months: ALL_MONTHS },
  { id: 'ninguno', label: 'Ninguno', months: [] },
];

/** ¿Dos conjuntos de meses son iguales como SET (ignorando orden/dups)? */
export function sameMonthSet(a: number[] | null, b: readonly number[]): boolean {
  if (a === null) return false; // "sin configurar" no coincide con ningún atajo (ni con "Ninguno")
  const sa = dedupeSort(a);
  const sb = dedupeSort([...b]);
  if (sa.length !== sb.length) return false;
  return sa.every((x, i) => x === sb[i]); // ambos ordenados/únicos → comparación posicional
}

/**
 * Devuelve el `id` del atajo ACTIVO para resaltar (el primero cuyo conjunto coincide exactamente con
 * `months`), o `null` si ninguno coincide (selección custom) o si está "sin configurar" (`months===null`).
 * "Sin configurar" deliberadamente NO resalta "Ninguno": un conjunto vacío explícito (el operario tocó
 * "Ninguno") sí resalta; un rodeo nunca configurado (`null`) no resalta nada (RPSC.3.2).
 */
export function activeShortcutId(months: number[] | null): ServiceMonthsShortcut['id'] | null {
  if (months === null) return null;
  for (const s of SERVICE_MONTHS_SHORTCUTS) {
    if (sameMonthSet(months, s.months)) return s.id;
  }
  return null;
}

// ─── Interacción "inicio → fin" CONTIGUA POR CONSTRUCCIÓN (RPSC.2.8) ─────────────────────────────────
//
// La selección manual del grid es un período "inicio → fin", NO un toggle disjunto. Una máquina pura de
// 2 taps (con un 3er tap que reinicia) garantiza que el resultado SIEMPRE es un run contiguo — es
// IMPOSIBLE armar un set disjunto desde la grilla. El `anchor` (mes de inicio pendiente) es estado de
// INTERACCIÓN transitorio (no del valor persistido); el componente lo mantiene aparte y persiste sólo
// `months`.

/** Estado de la interacción de rango: el run actual + el inicio PENDIENTE (esperando el fin), si lo hay. */
export type RangeSelection = {
  /** Meses del run actual, ordenados ascendente (el shape de persistencia). */
  months: number[];
  /** Mes de INICIO fijado esperando el fin (2º tap), o `null` si no hay período en progreso. */
  anchor: number | null;
};

/** Estado de interacción inicial a partir de un `value` (alta = primavera; edición = persistido o null).
 *  `anchor` arranca SIEMPRE `null`: el value de partida (default/persistido) es un run cerrado; el próximo
 *  tap en la grilla INICIA un período nuevo (no extiende el de partida — "1 período por rodeo"). */
export function initialRangeSelection(value: number[] | null): RangeSelection {
  return { months: value ?? [], anchor: null };
}

/**
 * Reduce un tap sobre el mes `tapped` (1–12) al nuevo estado de la interacción de rango (RPSC.2.8):
 *   - `anchor === null` → INICIA un período de 1 mes en `tapped` y queda esperando el fin
 *     ({ months: [tapped], anchor: tapped }). (Cubre tap único = 1 mes; y el 3er tap = reinicia.)
 *   - `anchor !== null` → CIERRA el período: run de `anchor` AVANZANDO hasta `tapped` (wrap-aware), y
 *     limpia el anchor ({ months: buildContiguousRun(anchor, tapped), anchor: null }).
 * El resultado SIEMPRE es contiguo por construcción. Un `tapped` fuera de rango se ignora (no muta).
 */
export function nextRangeSelection(state: RangeSelection, tapped: number): RangeSelection {
  if (!Number.isInteger(tapped) || tapped < MIN_MONTH || tapped > MAX_MONTH) return state;
  if (state.anchor === null) {
    return { months: [tapped], anchor: tapped };
  }
  return { months: buildContiguousRun(state.anchor, tapped), anchor: null };
}

/** Aplica un atajo: setea el run al conjunto del atajo y LIMPIA el anchor (un período custom en progreso
 *  se descarta al elegir un preset). El resultado es contiguo (todos los atajos lo son). */
export function applyShortcutSelection(shortcut: ServiceMonthsShortcut): RangeSelection {
  return { months: toServiceMonthsArray(new Set(shortcut.months)), anchor: null };
}

/** ¿El mes `m` es el INICIO pendiente (anchor a la espera del fin)? Pinta el estado intermedio del grid. */
export function isPendingAnchor(state: RangeSelection, m: number): boolean {
  return state.anchor === m;
}

// ─── Label del período seleccionado (Nielsen #1 — visibilidad de lo que se armó) ─────────────────────

/** Resultado del label del período: la frase es-AR + el conteo de meses (para el componente). */
export type ServicePeriodLabel = {
  /** Frase principal es-AR: "Oct → Dic", "Nov → Ene", "Todo el año", "Sin meses de servicio", etc. */
  text: string;
  /** Nº de meses del período (0..12). Alimenta el conteo "· N meses" y, post-cableado, el bucketing CCL. */
  count: number;
};

/**
 * Describe el período seleccionado para el LABEL que el operario VE (RPSC.2.8: "Servicio: Oct → Dic ·
 * 3 meses"). Casos:
 *   - `null` ("sin configurar")          → "Todavía sin configurar" · 0
 *   - `[]`   ("ninguno")                 → "No hace servicio" · 0
 *   - los 12 ("continuo")               → "Todo el año" · 12
 *   - 1 mes                             → "Oct" · 1
 *   - run contiguo (incl. wrap)         → "Oct → Dic" / "Nov → Ene" · N  (orden de SERVICIO)
 *   - (defensivo) set disjunto          → "N meses (sin período definido)" · N  — la grilla NO puede
 *     producirlo, pero un dato persistido disjunto se describe sin mentir un rango.
 * Sólo formato es-AR de display (no toca el array de persistencia, que es de máquina).
 */
export function describeServicePeriod(months: number[] | null): ServicePeriodLabel {
  if (months === null) return { text: 'Todavía sin configurar', count: 0 };
  const sorted = dedupeSort(months);
  const n = sorted.length;
  if (n === 0) return { text: 'No hace servicio', count: 0 };
  if (n >= MONTHS_IN_YEAR) return { text: 'Todo el año', count: MONTHS_IN_YEAR };

  const bounds = serviceRunBounds(sorted);
  if (bounds === null) {
    // Set disjunto (sólo posible desde un dato persistido, no desde la grilla): no inventamos un rango.
    return { text: `${n} meses (sin período definido)`, count: n };
  }
  if (n === 1) return { text: monthShortLabel(bounds.start), count: 1 };
  return { text: `${monthShortLabel(bounds.start)} → ${monthShortLabel(bounds.end)}`, count: n };
}
