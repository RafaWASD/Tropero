// reports-format.ts — lógica PURA de presentación de los reportes (spec 07 Stream C — FRONTEND).
// SIN RN, SIN supabase-js, SIN SDK → testeable con node:test (mismo patrón que online-guard-pure.ts /
// service-months.ts). La capa de I/O (`reports.ts`) llama las RPC y delega acá el mapeo de filas crudas a
// los tipos camelCase, el cálculo del porcentaje (con guard de 0 — la RPC NUNCA divide, R7.5.4/R7.6.3) y el
// formato es-AR (coma decimal — referencia de formato es-AR). NO se replica la regla CCL ni la de buckets:
// eso vive en `pregnancy-buckets.ts` / `calving-stage.ts` (fuente única).
//
// Por qué un módulo PURO separado del service: el service importa `supabase` (SDK) → no puede entrar al
// grafo de node:test. Todo lo testeable (mappers + pct + es-AR) vive acá; `reports.ts` solo orquesta I/O.

// ─── Porcentaje con guard de 0 (R7.5.4 / R7.6.3: servidas=0 → "—", nunca NaN/Infinity) ─────────────

/**
 * Porcentaje `num/den×100` con guard de denominador 0. Devuelve `null` cuando el denominador es 0 o
 * inválido (la UI muestra "—"/"sin datos", R7.5.4/R7.6.3) — NUNCA NaN/Infinity. El redondeo lo decide
 * `formatPercentAR`; acá se devuelve el número crudo (o null) para que el caller decida la presentación.
 */
export function safePercent(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return (num / den) * 100;
}

/**
 * Formatea un porcentaje en es-AR: 1 decimal con coma, sin decimal superfluo ("85" no "85,0"), "%" pegado.
 * `null` (denominador 0) → "—" (R7.5.4/R7.6.3: sin datos, no 0% ni NaN). 84.6 → "84,6 %"; 50 → "50 %".
 */
export function formatPercentAR(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—';
  const s = pct.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return `${s} %`;
}

// ─── Parición: estado + presentación de la card (delta #8 / RPF.1-4) ────────────────────────────────
//
// La RPC `rodeo_calving_kpi` devuelve, además de `calved`/`serviced`/`pregnant`, un `status` que GATEA el
// DISPLAY de la card (fix del "0 %" engañoso, decisiones D1-D5 del context) y `pending_pregnant` (D4). El
// conteo (`calved`/`pending_pregnant`) es honesto SIEMPRE; el `status` solo decide qué se MUESTRA:
//   - ok                 → el % (`calved/serviced`), en/desde los meses de parto de la campaña (D1/D2).
//   - not_calving_season → todavía no es época de parición (antes de la ventana +9): NO 0% prematuro (D2).
//   - no_service_months  → el rodeo no tiene meses de servicio configurados: NO 0% engañoso (D3).
//   - not_applicable_12m → servicio continuo 12 meses: no se reporta parición (D5).
// La leyenda D4 ("todavía hay vacas que no parieron…") aparece SOLO con status='ok' y pendingPregnant>0.
//
// `calvingCardView` es PURO/testeable (node:test) — reusa `safePercent`/`formatPercentAR` (guard de 0).

/** Estado de presentación de la card de Parición (espejo del `status` de la RPC, RPF.6.1). */
export type CalvingStatus = 'ok' | 'not_calving_season' | 'no_service_months' | 'not_applicable_12m';

/** Los 4 estados válidos, en un array para el normalizador defensivo del mapeo (CD-6). */
export const CALVING_STATUSES: readonly CalvingStatus[] = [
  'ok',
  'not_calving_season',
  'no_service_months',
  'not_applicable_12m',
];

/**
 * Normaliza el `status` crudo de la RPC a un `CalvingStatus`. Un valor ausente/desconocido → `'ok'` (default
 * defensivo, CD-6): si el cliente corre contra una DB SIN la migración 0117 (sin la columna `status`), la card
 * se comporta como antes (muestra el %). No inventa estados que la RPC no mandó.
 */
export function asCalvingStatus(raw: unknown): CalvingStatus {
  return typeof raw === 'string' && (CALVING_STATUSES as readonly string[]).includes(raw)
    ? (raw as CalvingStatus)
    : 'ok';
}

/** Texto FIJO de la leyenda D4 (context §D4; solo se muestra con ok + pendingPregnant>0). */
export const CALVING_PENDING_LEGEND = 'Todavía hay vacas que no parieron, esto puede afectar el dato';

/** Presentación derivada de la card de Parición (RPF.6.2): value/detail/note/legend + muted. */
export type CalvingCardView = {
  /** El número grande ya formateado ("84,6 %" | "—"). */
  value: string;
  /** El denominador explícito cuando hay % ("38 paridas / 46 servidas"). */
  detail?: string;
  /** Mensaje de estado cuando NO hay % (ocupa el slot `detail` de la KpiCard). */
  note?: string;
  /** Leyenda D4 (solo status='ok' + pendingPregnant>0). */
  legend?: string;
  /** true → el valor es "—" (atenuado): sin % que mostrar. */
  muted: boolean;
};

/**
 * Deriva la presentación de la card de Parición a partir del `status` + conteos (RPF.6.2, tabla design §3.2).
 * `status='ok'` con servidas>0 → el % + el detalle "N paridas / M servidas" (+ leyenda D4 si quedan preñadas
 * sin parir). `status='ok'` con servidas=0 → "—" ("sin datos de esta campaña"). Los otros estados → "—" + el
 * mensaje accionable correspondiente (NO un 0% engañoso, D2/D3/D5). `kpi === null` → "—" ("sin datos").
 */
export function calvingCardView(
  kpi: { status: CalvingStatus; calved: number; serviced: number; pendingPregnant: number } | null,
): CalvingCardView {
  if (kpi === null) {
    return { value: '—', note: 'Sin datos', muted: true };
  }
  switch (kpi.status) {
    case 'ok': {
      const pct = safePercent(kpi.calved, kpi.serviced);
      if (pct === null) {
        // serviced=0 → no hay base para el % (la campaña todavía no tiene servidas). No es 0%.
        return { value: '—', note: 'Sin datos de esta campaña', muted: true };
      }
      return {
        value: formatPercentAR(pct),
        detail: `${kpi.calved} paridas / ${kpi.serviced} servidas`,
        legend: kpi.pendingPregnant > 0 ? CALVING_PENDING_LEGEND : undefined,
        muted: false,
      };
    }
    case 'not_calving_season':
      return { value: '—', note: 'Todavía no es época de parición', muted: true };
    case 'no_service_months':
      return { value: '—', note: 'Sin meses de servicio configurados', muted: true };
    case 'not_applicable_12m':
      return { value: '—', note: 'No aplica (servicio todo el año)', muted: true };
    default:
      // status desconocido (defensivo; el mapeo ya normaliza a un CalvingStatus válido) → "sin datos".
      return { value: '—', note: 'Sin datos', muted: true };
  }
}

// ─── Destete: estado + presentación de la card (delta #10 / RWK.1-5) ────────────────────────────────
//
// La RPC `rodeo_weaning_kpi` devuelve, además de `weaned`/`serviced`, un `status` que GATEA el DISPLAY de la
// card de Destete (mismo espíritu que #8) y `pending_weaning` (crías de la campaña al pie, D4). El conteo
// (`weaned`/`pending_weaning`) es honesto SIEMPRE; el `status` solo decide qué se MUESTRA:
//   - ok                 → el %destete (`weaned/serviced`, puede >100% con mellizos — D1/RWK.1.3).
//   - not_weaning_season → todavía no empezó el destete de la campaña (weaned=0, DATA-DRIVEN — D3/CD-2): NO 0%.
//   - no_service_months  → el rodeo no tiene meses de servicio configurados: NO 0% engañoso (D5).
//   - not_applicable_12m → servicio continuo 12 meses: no se reporta destete de campaña (D5, precede).
// La leyenda D4 ("todavía hay crías sin destetar…") aparece SOLO con status='ok' y pendingWeaning>0.
//
// `weaningCardView` es PURO/testeable (node:test) — reusa `safePercent`/`formatPercentAR` (guard de 0).
// Espejo 1:1 de `calvingCardView`: misma forma de retorno, solo cambian los copys y el numerador `weaned`.

/** Estado de presentación de la card de Destete (espejo del `status` de la RPC, RWK.7.1). */
export type WeaningStatus = 'ok' | 'not_weaning_season' | 'no_service_months' | 'not_applicable_12m';

/** Los 4 estados válidos, en un array para el normalizador defensivo del mapeo (CD-7). */
export const WEANING_STATUSES: readonly WeaningStatus[] = [
  'ok',
  'not_weaning_season',
  'no_service_months',
  'not_applicable_12m',
];

/**
 * Normaliza el `status` crudo de la RPC a un `WeaningStatus`. Un valor ausente/desconocido → `'ok'` (default
 * defensivo, CD-7): si el cliente corre contra una DB SIN la migración 0118 (sin la RPC/columna `status`), la
 * card se comporta como antes (muestra el %). No inventa estados que la RPC no mandó.
 */
export function asWeaningStatus(raw: unknown): WeaningStatus {
  return typeof raw === 'string' && (WEANING_STATUSES as readonly string[]).includes(raw)
    ? (raw as WeaningStatus)
    : 'ok';
}

/** Texto FIJO de la leyenda D4 (context §D4; solo se muestra con ok + pendingWeaning>0). */
export const WEANING_PENDING_LEGEND = 'Todavía hay crías sin destetar, esto puede afectar el dato';

/** Presentación derivada de la card de Destete (RWK.7.2): value/detail/note/legend + muted. */
export type WeaningCardView = {
  /** El número grande ya formateado ("87 %" | "—"). */
  value: string;
  /** El denominador explícito cuando hay % ("40 destetados / 46 servidas"). */
  detail?: string;
  /** Mensaje de estado cuando NO hay % (ocupa el slot `detail` de la KpiCard). */
  note?: string;
  /** Leyenda D4 (solo status='ok' + pendingWeaning>0). */
  legend?: string;
  /** true → el valor es "—" (atenuado): sin % que mostrar. */
  muted: boolean;
};

/**
 * Deriva la presentación de la card de Destete a partir del `status` + conteos (RWK.7.2, tabla design §3.2).
 * `status='ok'` con servidas>0 → el %destete + el detalle "N destetados / M servidas" (+ leyenda D4 si quedan
 * crías al pie). El %destete puede exceder 100 % (mellizos: dos crías destetadas de una servida — D1/RWK.1.3):
 * `safePercent`/`formatPercentAR` lo formatean tal cual ("150 %"), sin truncar. `status='ok'` con servidas=0 →
 * "—" ("sin datos de esta campaña", defensivo — RWK.1.4). Los otros estados → "—" + el mensaje accionable
 * correspondiente (NO un 0% engañoso, D3/D5). `kpi === null` → "—" ("sin datos").
 */
export function weaningCardView(
  kpi: { status: WeaningStatus; weaned: number; serviced: number; pendingWeaning: number } | null,
): WeaningCardView {
  if (kpi === null) {
    return { value: '—', note: 'Sin datos', muted: true };
  }
  switch (kpi.status) {
    case 'ok': {
      const pct = safePercent(kpi.weaned, kpi.serviced);
      if (pct === null) {
        // serviced=0 → no hay base para el % (la campaña todavía no tiene servidas). No es 0% (RWK.1.4).
        return { value: '—', note: 'Sin datos de esta campaña', muted: true };
      }
      return {
        value: formatPercentAR(pct),
        detail: `${kpi.weaned} destetados / ${kpi.serviced} servidas`,
        legend: kpi.pendingWeaning > 0 ? WEANING_PENDING_LEGEND : undefined,
        muted: false,
      };
    }
    case 'not_weaning_season':
      return { value: '—', note: 'Todavía no empezó el destete', muted: true };
    case 'no_service_months':
      return { value: '—', note: 'Sin meses de servicio configurados', muted: true };
    case 'not_applicable_12m':
      return { value: '—', note: 'No aplica (servicio todo el año)', muted: true };
    default:
      // status desconocido (defensivo; el mapeo ya normaliza a un WeaningStatus válido) → "sin datos".
      return { value: '—', note: 'Sin datos', muted: true };
  }
}

// ─── Peso es-AR (R7.9.3: coma decimal, ej. "385,5 kg"; no aplica a formatos de máquina) ─────────────

/**
 * Formatea un peso en kg es-AR: separador de miles "." + coma decimal, hasta 1 decimal sin superfluo, " kg".
 * `null`/no-finito (categoría sin pesaje, R7.9.4) → "—" ("sin pesar", no "0 kg"). 385.5 → "385,5 kg";
 * 1050 → "1.050 kg"; 312 → "312 kg". (La RPC ya `round(...,2)`; acá normalizamos a 1 decimal de display.)
 */
export function formatKgAR(kg: number | null): string {
  if (kg === null || !Number.isFinite(kg)) return '—';
  const s = kg.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return `${s} kg`;
}

/**
 * Formatea un DELTA de peso es-AR con signo explícito (comparativa de peso por sesiones, R7.9.5/R7.4):
 * "+12,5 kg", "−8 kg" (menos tipográfico U+2212), "0 kg". `null` (una de las dos sesiones sin peso en esa
 * categoría) → "—" (no se inventa un delta contra cero). Usa el menos tipográfico para no confundir con un
 * guion de lista.
 */
export function formatKgDeltaAR(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '—';
  const abs = Math.abs(delta).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  if (delta > 0) return `+${abs} kg`;
  if (delta < 0) return `−${abs} kg`;
  return '0 kg';
}

/**
 * Formatea un DELTA entero con signo (delta de conteo de eventos en la comparativa de sesiones, R7.4.1):
 * "+3", "−1", "0". Menos tipográfico (U+2212). NO devuelve "—": un kind sin eventos en una sesión cuenta
 * como 0 (R7.4.3), así que el delta siempre es un entero definido.
 */
export function formatCountDelta(delta: number): string {
  const n = Math.trunc(delta);
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

// ─── Número hero del KpiCard: split unidad + tamaño length-aware (web-safe) ──────────────────────────
//
// `adjustsFontSizeToFit` es NO-OP en react-native-web (gotcha del repo, memoria reference_rn_web_pitfalls):
// un valor largo NO se encoge, se TRUNCA con ellipsis ("84,6 %" → "84,6…" en una media card a 320-360px).
// Dos medidas web-safe (determinísticas, sin medir en runtime) contra el recorte del bug F:
//   1) `splitKpiValue` separa el número de la unidad "%": el número va GRANDE (héroe, patrón de UIs
//      financieras — el monto manda) y el "%" al lado, más chico. Al sacar del texto grande el glifo "%"
//      (~0.9em en Inter) + su espacio, se libera el ancho que empujaba "84,6 %" fuera de la media card.
//   2) `kpiValueFontToken` elige el tamaño del NÚMERO (sin la unidad) por su longitud: ≤3 chars ("100",
//      "50", "—") van $10=38px; 4+ chars ("84,6", "150,5") bajan a $9=30px.
//
// Anchos reales VERIFICADOS (render de Inter con el mismo faux-bold de la web build — el peso 800 no tiene
// face cargada, así que el navegador lo sintetiza y ENSANCHA los glifos), sobre la media card (2-por-fila,
// ancho útil de texto ≈ 98px @320 / 118px @360 / 144px @412):
//   • "84,6 %" pegado @ $9=30px = 101px  → TRUNCA a 320px (el bug que vio Raf).
//   • "84,6 %" split: número "84,6" @ $9=30px + "%" @ $6=18px = grupo 84px  → ENTRA a 320/360/412.
//   • Peor caso real en 2-por-fila ("100 %" → número "100" @ $10=38px + "%" = 84px)  → ENTRA a 320.
// El par lineHeight matchea el token (regla anti-recorte de descendentes del DS).

/** Token de tamaño del número hero del KpiCard (de la escala Inter de tamagui.config.ts). */
export type KpiSizeToken = '$9' | '$10';

/**
 * Separa el valor del KpiCard en `number` + `percent` para renderizar el número GRANDE (héroe) y la unidad
 * "%" más chica al lado (libera el ancho del "%" que hacía truncar la media card angosta — bug F). Sólo
 * separa un "%" al final: "84,6 %" → { number: "84,6", percent: "%" }; "100 %" → { number: "100",
 * percent: "%" }. Un valor SIN "%" ("—", o defensivamente cualquier otra unidad) → { number: <el valor>,
 * percent: null } (se renderiza entero al tamaño del número).
 */
export function splitKpiValue(value: string): { number: string; percent: string | null } {
  const v = (value ?? '').trim();
  const m = /^(.*\S)\s*%$/.exec(v);
  return m ? { number: m[1], percent: '%' } : { number: v, percent: null };
}

/**
 * Elige el `fontSize`/`lineHeight` (par matching, anti-recorte de descendentes) del número hero del KpiCard
 * según la longitud del NÚMERO (sin la unidad, vía `splitKpiValue`). ≤3 chars ("100", "50", "—") → `$10`
 * (38px, dominante); 4+ chars ("84,6", "100,0", "150,5") → `$9` (30px) para que el grupo número+"%" entre
 * completo en media card a 320px SIN truncar (web-safe: no dependemos de adjustsFontSizeToFit).
 */
export function kpiValueFontToken(value: string): { fontSize: KpiSizeToken; lineHeight: KpiSizeToken } {
  const len = splitKpiValue(value).number.length;
  return len <= 3 ? { fontSize: '$10', lineHeight: '$10' } : { fontSize: '$9', lineHeight: '$9' };
}

// ─── Etiquetas de los tipos de evento de una sesión (R7.3.1) ────────────────────────────────────────
//
// Los 7 kinds que la RPC `session_event_summary` devuelve (snake del server) → label es-AR + orden de
// presentación estable. animal_events NO tiene session_id → no entra (design §2.1).

/** Los 7 kinds de evento de una sesión, en orden de presentación. Espejo del shape de la RPC. */
export const SESSION_EVENT_KINDS = [
  'weight',
  'reproductive',
  'sanitary',
  'condition',
  'lab',
  'scrotal',
  'custom',
] as const;

export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

const EVENT_KIND_LABELS: Record<SessionEventKind, string> = {
  weight: 'Pesajes',
  reproductive: 'Reproductivos',
  sanitary: 'Sanitarios',
  condition: 'Condición corporal',
  lab: 'Muestras de lab',
  scrotal: 'Circunferencia escrotal',
  custom: 'Personalizados',
};

/** Label es-AR de un kind de evento de sesión. Un kind desconocido → el code crudo (defensivo). */
export function eventKindLabel(kind: string): string {
  return EVENT_KIND_LABELS[kind as SessionEventKind] ?? kind;
}

// ─── Etiquetas de los buckets CCL (cabeza/cuerpo/cola) ──────────────────────────────────────────────

export type CclStage = 'head' | 'body' | 'tail';

const CCL_LABELS: Record<CclStage, string> = {
  head: 'Cabeza',
  body: 'Cuerpo',
  tail: 'Cola',
};

/** Label es-AR de una etapa CCL. */
export function cclStageLabel(stage: CclStage): string {
  return CCL_LABELS[stage];
}

// ─── Buckets CCL a mostrar (R7.7.2 — espejo de la regla de pregnancy-buckets) ───────────────────────
//
// La RPC `rodeo_ccl_distribution` devuelve los 3 conteos crudos (head=large / body=medium / tail=small) +
// el total. CUÁNTAS barras mostrar lo decide el CLIENTE con `sizeBucketsForServiceMonths(nMonths)`
// (FUENTE ÚNICA, design §2.4/§8). Este helper toma los 3 conteos + la lista de buckets de esa fuente y
// arma las barras a renderizar, plegando defensivamente un `body` (medium) extraviado cuando el rodeo
// muestra sólo 2 buckets (cabeza/cola — un tacto de 2 meses no debería producir `medium`, pero si un dato
// histórico lo trae, se pliega en CABEZA = la preñez más avanzada, para que las barras sumen el total y no
// se pierda un animal del % — R7.7.5). Para 3 buckets, los tres se muestran tal cual.

import { sizeBucketsForServiceMonths } from './pregnancy-buckets';
import { formatDateEsAr } from './format-date-es-ar';

/** Una barra CCL lista para renderizar: etapa + label + conteo + % sobre el total (0..100). */
export type CclBar = {
  stage: CclStage;
  label: string;
  count: number;
  /** Porcentaje sobre el total (0 si total=0). Entero o 1 decimal, ya redondeado para la barra. */
  percent: number;
};

/** Conteos crudos de la RPC de CCL (o del cruce de nacimientos, mismo shape head/body/tail). */
export type CclCounts = { head: number; body: number; tail: number; total: number };

/**
 * Arma las barras CCL a mostrar para un rodeo de `nMonths` meses (R7.7.2). Devuelve `[]` cuando el rodeo
 * no distingue etapas (1/12/0/null → la UI oculta CCL con una nota, R7.7.3). Para 2 buckets pliega
 * `body`→`head` (defensivo). El % se calcula sobre `total` (R7.7.5); si total=0 todas las barras dan 0
 * (la UI muestra el empty state, R7.7.4). Mantiene el orden cabeza→(cuerpo)→cola.
 */
export function cclBarsForMonths(nMonths: number | null, counts: CclCounts): CclBar[] {
  const buckets = sizeBucketsForServiceMonths(nMonths);
  if (buckets.length === 0) return [];

  const total = counts.total > 0 ? counts.total : 0;
  const pct = (n: number): number => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  // 2 buckets (cabeza/cola): plegamos un medium extraviado en cabeza (la más avanzada).
  if (buckets.length === 2) {
    const head = counts.head + counts.body;
    return [
      { stage: 'head', label: cclStageLabel('head'), count: head, percent: pct(head) },
      { stage: 'tail', label: cclStageLabel('tail'), count: counts.tail, percent: pct(counts.tail) },
    ];
  }

  // 3 buckets (cabeza/cuerpo/cola): los tres tal cual.
  return [
    { stage: 'head', label: cclStageLabel('head'), count: counts.head, percent: pct(counts.head) },
    { stage: 'body', label: cclStageLabel('body'), count: counts.body, percent: pct(counts.body) },
    { stage: 'tail', label: cclStageLabel('tail'), count: counts.tail, percent: pct(counts.tail) },
  ];
}

// ─── Comparativa de dos sesiones del mismo rodeo (R7.4) ─────────────────────────────────────────────
//
// Dadas las cuentas por tipo de evento de DOS sesiones (cada una = filas {kind, eventCount}), arma las
// filas comparadas: un row POR CADA kind que aparece en alguna de las dos (R7.4.3: si una sesión no tiene
// un kind que la otra sí, se muestra 0 + el delta — no se omite la fila). El delta = B − A.

export type SessionCountRow = { kind: string; eventCount: number };

/** Una fila de la comparativa: kind + conteo en A + conteo en B + delta (B − A). */
export type CompareRow = {
  kind: string;
  label: string;
  a: number;
  b: number;
  delta: number;
};

/**
 * Arma las filas comparadas de dos sesiones (R7.4.1/.3). Toma los 7 kinds en su orden de presentación
 * (SESSION_EVENT_KINDS) y, para cada uno, el conteo en A y en B (0 si falta). Omite los kinds que son 0 en
 * AMBAS (no agregan información a la comparación). El delta = B − A.
 */
export function compareSessions(rowsA: SessionCountRow[], rowsB: SessionCountRow[]): CompareRow[] {
  const mapA = new Map(rowsA.map((r) => [r.kind, r.eventCount]));
  const mapB = new Map(rowsB.map((r) => [r.kind, r.eventCount]));
  const out: CompareRow[] = [];
  for (const kind of SESSION_EVENT_KINDS) {
    const a = mapA.get(kind) ?? 0;
    const b = mapB.get(kind) ?? 0;
    if (a === 0 && b === 0) continue; // 0 en ambas → no aporta a la comparación.
    out.push({ kind, label: eventKindLabel(kind), a, b, delta: b - a });
  }
  return out;
}

// ─── Comparativa de PESO por categoría entre dos sesiones (R7.9.5 / T7.3) ───────────────────────────

export type WeightRowLite = { categoryId: string; categoryName: string; avgWeight: number };

/** Una fila de la comparativa de peso: categoría + AVG en A + AVG en B + delta (B − A) o null si falta. */
export type WeightCompareRow = {
  categoryId: string;
  categoryName: string;
  a: number | null;
  b: number | null;
  delta: number | null;
};

/**
 * Arma las filas de la comparativa de peso por categoría entre dos sesiones del mismo rodeo (R7.9.5). Un
 * row por cada categoría presente en alguna de las dos. `a`/`b` = AVG en esa sesión (null si la categoría
 * no tiene peso en esa sesión → "—", R7.9.4). `delta` = B − A sólo si AMBAS tienen valor (no se inventa un
 * delta contra una categoría ausente). Orden: por nombre de categoría (estable).
 */
export function compareWeights(rowsA: WeightRowLite[], rowsB: WeightRowLite[]): WeightCompareRow[] {
  const mapA = new Map(rowsA.map((r) => [r.categoryId, r]));
  const mapB = new Map(rowsB.map((r) => [r.categoryId, r]));
  const ids = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  const out: WeightCompareRow[] = [];
  for (const id of ids) {
    const ra = mapA.get(id);
    const rb = mapB.get(id);
    const a = ra ? ra.avgWeight : null;
    const b = rb ? rb.avgWeight : null;
    out.push({
      categoryId: id,
      categoryName: (rb?.categoryName ?? ra?.categoryName ?? '').trim(),
      a,
      b,
      delta: a !== null && b !== null ? b - a : null,
    });
  }
  out.sort((x, y) => x.categoryName.localeCompare(y.categoryName, 'es-AR'));
  return out;
}

// ─── Días desde el último pesaje (alerta sin pesar, R7.11.3) ────────────────────────────────────────

/**
 * Texto es-AR de "días desde el último pesaje" para un ítem de la alerta sin pesar. `null` = nunca pesado
 * (R7.11.3: "nunca pesado"). 1 → "hace 1 día"; 45 → "hace 45 días". Negativos (reloj raro) → se clampean a 0.
 */
export function daysSinceLabel(days: number | null): string {
  if (days === null) return 'Nunca pesado';
  const d = Math.max(0, Math.trunc(days));
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

/**
 * Identificador visible de un animal en una alerta (delta IDU, design §3): IDV si lo tiene, sino
 * "Sin identificación". Los reportes NO adoptan el hero-por-apodo (fuera de alcance, restringido a lista +
 * ficha) — degradan solo al idv (el canal `visual_id_alt` se eliminó).
 */
export function animalLabel(idv: string | null): string {
  const a = (idv ?? '').trim();
  if (a.length > 0) return a;
  return 'Sin identificación';
}

// ─── Campaña (año) por defecto = última con datos (R7.5.7) ──────────────────────────────────────────
//
// R7.5.7 (Puerta de spec): el período por defecto NO es el año calendario actual, sino la ÚLTIMA campaña
// con datos del rodeo. No hay RPC que devuelva "años con datos" → lo derivamos del año de la sesión más
// reciente del rodeo (las sesiones son donde se cargan los eventos → un proxy honesto de "última campaña
// con actividad"). Sin sesiones → año calendario actual (fallback razonable: el operario recién arranca).

/**
 * Año de campaña por defecto (R7.5.7): el año de la sesión más reciente (proxy de "última campaña con
 * datos"). `startedAtIsos` = los `started_at` de las sesiones del rodeo (la lista ya viene desc, pero no
 * dependemos del orden: tomamos el máximo año válido). `nowYear` = año actual (fallback sin sesiones).
 */
export function defaultCampaignYear(startedAtIsos: Array<string | null>, nowYear: number): number {
  let best: number | null = null;
  for (const iso of startedAtIsos) {
    const y = isoYear(iso);
    if (y === null) continue;
    if (best === null || y > best) best = y;
  }
  return best ?? nowYear;
}

/**
 * Año de una fecha ISO de forma DETERMINÍSTICA (sin depender de la timezone del runtime — evita flake en
 * CI vs Argentina). Si el string arranca con `YYYY-` lo tomamos literal (el año stampeado en el dato, que
 * es como el server keyea por `extract(year ...)`); si no, caemos a `getUTCFullYear` de un Date parseado.
 */
function isoYear(iso: string | null): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-/.exec(iso.trim());
  if (m) return Number(m[1]);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

// ─── Etiqueta de una sesión para la lista (R7.3.6) ──────────────────────────────────────────────────

/**
 * Fecha es-AR corta de una sesión para la lista/encabezado: "24/06/2026" (dd/mm/aaaa). `null`/inválida →
 * "Sin fecha". No incluye hora (la lista es glanceable; el detalle muestra el rango completo). Delega en
 * `formatDateEsAr` (formato ÚNICO es-AR + tz-safe): un `started_at` (instante real) usa su día LOCAL; una
 * fecha date-only (ej. `next_dose_date` de la alerta de dosis) se formatea por string SIN drift.
 */
export function sessionDateLabel(startedAtIso: string | null): string {
  const s = formatDateEsAr(startedAtIso);
  return s === '—' ? 'Sin fecha' : s;
}

/** Rango temporal es-AR de una sesión (started → ended) para el detalle (R7.3.2). "abierta" si no cerró. */
export function sessionRangeLabel(startedAtIso: string | null, endedAtIso: string | null): string {
  const start = sessionDateLabel(startedAtIso);
  if (!endedAtIso) return `${start} · abierta`;
  const end = new Date(endedAtIso);
  if (Number.isNaN(end.getTime())) return start;
  // Si arranca y termina el mismo día, no repetimos la fecha.
  const startDay = startedAtIso ? new Date(startedAtIso).toDateString() : null;
  if (startDay && startDay === end.toDateString()) return start;
  return `${start} → ${sessionDateLabel(endedAtIso)}`;
}
