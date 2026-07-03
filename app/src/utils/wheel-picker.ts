// Lógica PURA del WHEEL PICKER inercial (spec 03 M6 — circunferencia escrotal, R14.5/R14.6/R14.7).
// SIN RN, SIN red, SIN SDK: testeable con node:test (mismo patrón que condition-stepper.ts /
// maneuver-step-kind.ts). Toda la aritmética de la rueda (rango/paso → valores discretos, conversión
// offset de scroll ↔ índice/valor, clamp, snap a celda, formato es-AR) vive acá, fuera del componente
// (que solo dibuja y delega). Así el snap, los límites y el redondeo se testean sin montar UI.
//
// Por qué una rueda y no un keypad (CE): la circunferencia escrotal es un valor CONTINUO en una banda
// estrecha (20–50 cm, banda de trabajo 30–40) con paso fino (0,5) → un drum/barrel picker con momentum
// (fling rápido pasa muchos valores, drag lento = precisión) + tick háptico por valor es más rápido en
// la manga que teclear "36,5" dígito a dígito. Mismo idiom reusable para la rueda de meses (6–120, paso 1).
//
// es-AR (memoria reference_es_ar_number_format): el VALOR que ve el operario lleva coma decimal ("36,5").
// El número que se persiste (circumference_cm) es float de máquina (punto) — eso lo arma el StepValue
// { kind:'scrotal', circumferenceCm, ageMonths } del orquestador, no este formateo de display.

import { monthsBetween } from './animal-age';

// ─── Parámetros de la rueda de CIRCUNFERENCIA ESCROTAL (R14.5, context-m6 §3) ──────────────────────

/** Cota inferior del rango de CE (cm). Piso de jóvenes/anormales (~20–22). */
export const CE_MIN_CM = 20;
/** Cota superior del rango de CE (cm). Techo documentado ~48 → 50 con holgura. */
export const CE_MAX_CM = 50;
/** Paso de la rueda de CE (cm). Superset BIF/BREEDPLAN (0,5; redondeable a entero para umbrales BSE). */
export const CE_STEP_CM = 0.5;
/** Valor inicial de la rueda de CE si no hay medida previa (promedio toro maduro, context-m6 §3). */
export const CE_DEFAULT_CM = 36;

// ─── Parámetros de la rueda de EDAD en meses (R14.7, context-m6 §3 / design §12.2) ─────────────────

/** Cota inferior de la rueda de meses. ~destete; un torito no se mide antes. */
export const AGE_MIN_MONTHS = 6;
/** Cota superior de la rueda de meses (10 años — un toro deja servicio mucho antes). */
export const AGE_MAX_MONTHS = 120;
/** Paso de la rueda de meses (1 mes). */
export const AGE_STEP_MONTHS = 1;
/** Default de la rueda de meses cuando NO hay birth_date para prellenar (sobreaño ~24, banda típica). */
export const AGE_DEFAULT_MONTHS = 24;

/**
 * Descriptor de una rueda discreta: rango cerrado [min, max] con paso fijo. La rueda enumera los valores
 * `min, min+step, …, max` (max inclusive). Reusado por la rueda de CE y la de meses.
 */
export type WheelSpec = {
  min: number;
  max: number;
  step: number;
};

export const CE_WHEEL: WheelSpec = { min: CE_MIN_CM, max: CE_MAX_CM, step: CE_STEP_CM };
export const AGE_WHEEL: WheelSpec = { min: AGE_MIN_MONTHS, max: AGE_MAX_MONTHS, step: AGE_STEP_MONTHS };

/**
 * Redondeo robusto al múltiplo de `step` MÁS CERCANO dentro de [min, max] (defensivo ante el drift de
 * coma flotante de los múltiplos de 0,5: trabaja en "pasos" enteros con Math.round). Un valor fuera de
 * rango se clampa; un valor entre celdas se snapea a la celda más cercana. NaN/∞ → `min` (fail-safe).
 */
export function snapToWheel(value: number, spec: WheelSpec): number {
  const { min, max, step } = spec;
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  // Trabajamos en índices enteros desde `min` para evitar el drift binario (ej. 0.5*61).
  const idx = Math.round((clamped - min) / step);
  const snapped = min + idx * step;
  // Re-clamp por seguridad (el redondeo de un valor en el borde podría salirse 1 step).
  return Math.min(max, Math.max(min, roundStep(snapped, step)));
}

/** Cantidad total de celdas/valores de la rueda (max inclusive). Ej. CE 20–50/0,5 = 61; meses 6–120/1 = 115. */
export function wheelCount(spec: WheelSpec): number {
  return Math.round((spec.max - spec.min) / spec.step) + 1;
}

/** Lista completa de valores de la rueda, ya snapeados (sin drift). Para enumerar las celdas en la UI. */
export function wheelValues(spec: WheelSpec): number[] {
  const n = wheelCount(spec);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(roundStep(spec.min + i * spec.step, spec.step));
  return out;
}

/** Índice (0-based, clampeado a [0, n-1]) de un valor dentro de la rueda. Para posicionar el scroll inicial. */
export function valueToIndex(value: number, spec: WheelSpec): number {
  const snapped = snapToWheel(value, spec);
  const idx = Math.round((snapped - spec.min) / spec.step);
  return Math.min(wheelCount(spec) - 1, Math.max(0, idx));
}

/** Valor (snapeado) en un índice de celda dado, clampeado al rango. Inversa de valueToIndex. */
export function indexToValue(index: number, spec: WheelSpec): number {
  const i = Math.min(wheelCount(spec) - 1, Math.max(0, Math.round(index)));
  return roundStep(spec.min + i * spec.step, spec.step);
}

/**
 * Convierte un OFFSET de scroll (px desde el tope del contenido) al ÍNDICE de la celda centrada, dado el
 * alto de una celda. El centrado lo da el padding superior de la lista (= (viewport-celda)/2): con ese
 * padding, `offset / cellHeight` es directamente el índice centrado. Se redondea al entero más cercano
 * (la celda cuyo centro está más cerca de la línea de selección) y se clampa al rango.
 */
export function offsetToIndex(offset: number, cellHeight: number, spec: WheelSpec): number {
  if (!(cellHeight > 0) || !Number.isFinite(offset)) return 0;
  const raw = Math.round(offset / cellHeight);
  return Math.min(wheelCount(spec) - 1, Math.max(0, raw));
}

/** Offset de scroll (px) que centra la celda de un índice dado. Inversa de offsetToIndex (para scrollTo). */
export function indexToOffset(index: number, cellHeight: number): number {
  return Math.max(0, Math.round(index)) * cellHeight;
}

/** Resultado del SNAP DETERMINÍSTICO de un offset a la celda más cercana (lo que el WheelPicker commitea al soltar). */
export type WheelSnap = {
  /** Índice de la celda cuyo centro queda más cerca de la línea de selección (clampeado al rango). */
  index: number;
  /** Offset EXACTO (px, múltiplo de cellHeight) que centra esa celda — el `scrollTo` del lock. */
  offset: number;
  /** Valor (snapeado a la grilla) de esa celda — el `onValueChange` del commit. */
  value: number;
};

/**
 * SNAP DETERMINÍSTICO en JS del WheelPicker (spec 03 M6 — el "lock" al soltar la rueda, R14.5/R14.7).
 *
 * Por qué en JS y no por `snapToInterval`: en **react-native-web** el `snapToInterval`/`decelerationRate`
 * del `ScrollView` NO lockea de forma fiable (la rueda queda DESCANSANDO ENTRE dos valores —
 * `reference_rn_web_pitfalls`). Al terminar el scroll, el componente llama acá con el offset crudo y obtiene
 * la celda cuyo centro está MÁS CERCA de la línea de selección (`offsetToIndex` ya redondea + clampa), el
 * offset EXACTO que la centra (`indexToOffset`, siempre múltiplo de `cellHeight`) y su valor de grilla
 * (`indexToValue`). Reusa la aritmética pura existente — cero duplicación. El offset devuelto está clampeado
 * a [0, (n-1)·cellHeight] por construcción (el índice viene clampeado de `offsetToIndex`), así que el lock
 * nunca cae fuera de [min, max] por el padding de centrado.
 */
export function snapOffset(offset: number, cellHeight: number, spec: WheelSpec): WheelSnap {
  const index = offsetToIndex(offset, cellHeight, spec);
  return { index, offset: indexToOffset(index, cellHeight), value: indexToValue(index, spec) };
}

/**
 * ¿El offset YA está snapeado (descansa EXACTAMENTE en el centro de una celda válida)? Guard de
 * idempotencia/anti-loop del lock: el `scrollTo` programático del snap re-dispara el `onScroll` (y en web
 * puede re-disparar el settle) → si el offset ya es el del centro de su celda, no hay que volver a
 * commitear ni mover (no-op) → evita loop y spam de `onValueChange`/háptica. `eps` tolera el sub-píxel del
 * scroller. Un offset fuera de rango (más allá del último índice por el momentum) NO se considera snapeado
 * aunque caiga en un múltiplo, porque su celda real (clampeada) tiene otro offset → debe relockear adentro.
 */
export function isOffsetSnapped(offset: number, cellHeight: number, spec: WheelSpec, eps = 0.5): boolean {
  if (!(cellHeight > 0) || !Number.isFinite(offset)) return false;
  const { offset: snapped } = snapOffset(offset, cellHeight, spec);
  return Math.abs(offset - snapped) <= eps;
}

// ─── TAP-TO-SELECT: destino de un TAP sobre una celda visible (delta #16, RTW.6) ────────────────────

/** Destino de un TAP sobre una celda del drum: el `WheelSnap` de esa celda + si YA es la centrada. */
export type WheelTapTarget = WheelSnap & {
  /** El índice tapeado coincide con el índice centrado por `currentOffset` → el caller hace no-op de valor. */
  isCentral: boolean;
};

/**
 * Destino de un TAP sobre la celda `tappedIndex`, dado el offset ACTUAL del scroller (delta #16, RTW.6).
 *
 * El operario tapea una celda VISIBLE (arriba/abajo del centro) que ya conoce su índice (D3/RTW.3.2 — sin
 * mapeo de coordenada-a-valor). Este helper devuelve el offset destino EXACTO que centra ese índice
 * (`indexToOffset`, múltiplo de `cellHeight`), su valor de grilla (`indexToValue`) y `isCentral` = la celda
 * tapeada YA es la centrada por el offset actual (`offsetToIndex(currentOffset)`) → el caller hace no-op de
 * valor (RTW.1.4: no re-dispara `onValueChange`). El índice tapeado se CLAMPEA a [0, n-1] por robustez
 * (defensivo ante un índice fuera de rango). REUSA `offsetToIndex`/`indexToOffset`/`indexToValue`/`wheelCount`
 * — cero aritmética nueva (misma grilla que el snap por drag → el tap y el drag comparten el valor canónico).
 *
 * PURO (sin RN): el destino del tap se testea sin montar UI, igual que `snapOffset`/`isOffsetSnapped`.
 */
export function tapTarget(
  currentOffset: number,
  tappedIndex: number,
  cellHeight: number,
  spec: WheelSpec,
): WheelTapTarget {
  const centeredIndex = offsetToIndex(currentOffset, cellHeight, spec);
  const index = Math.min(wheelCount(spec) - 1, Math.max(0, Math.round(tappedIndex)));
  return {
    index,
    offset: indexToOffset(index, cellHeight),
    value: indexToValue(index, spec),
    isCentral: index === centeredIndex,
  };
}

// ─── Formato es-AR de los valores (display) ────────────────────────────────────────────────────────

/**
 * Formatea la CE en es-AR (coma decimal) SIN la unidad: "36,5", "36" (entero sin decimales superfluos),
 * "40,5". Mantiene a lo sumo 1 decimal (el paso es 0,5). Es el número GRANDE glanceable del step.
 */
export function formatCmAR(cm: number): string {
  const snapped = snapToWheel(cm, CE_WHEEL);
  // Hasta 1 decimal con coma; sin decimales si es entero (37,0 → "37").
  return snapped.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/** CE con unidad para la lectura grande: "36,5 cm". */
export function formatCmWithUnitAR(cm: number): string {
  return `${formatCmAR(cm)} cm`;
}

/**
 * String es-AR MÁS ANCHO (en glifos) que puede mostrar el campo hero de CE, derivado del rango REAL de la
 * rueda de CE (NO un literal hardcodeado). El campo editable se dimensiona midiendo el ancho en píxeles de
 * ESTE string a la fuente hero → garantiza que NINGÚN valor del rango se recorte (🔴 manga, captura de Raf
 * 40,5 recortado). Recorre `wheelValues(CE_WHEEL)` con `formatCmAR` y se queda con el peor caso.
 *
 * "Más ancho" = mayor cantidad de caracteres y, a igual cantidad, peor caso por anchura de glifos: los
 * dígitos de Inter son tabulares (mismo avance), pero la COMA es más angosta que un dígito → con el mismo
 * largo, el string con MENOS comas (más dígitos) es más ancho. Por eso al empatar en largo elegimos el de
 * menos comas. En la grilla de CE (20–50/0,5) el peor caso real es del tipo "XX,X" (4 glifos: "20,5"…"49,5"),
 * más ancho que "50"/"20" (2 glifos). Se deriva del rango → sigue a la grilla aunque CE_WHEEL cambie.
 *
 * Atado a la rueda de CE a propósito: `formatCmAR` snapea/clampa al `CE_WHEEL` internamente (es el formato de
 * CE), así que el peor caso solo tiene sentido para esa rueda. La edad usa otro formato (sin coma).
 *
 * PURO (sin RN): el STRING más ancho se testea sin montar UI. El ancho en PÍXELES sí necesita medición en
 * runtime (depende de la fuente/device) y lo hace el componente; este helper solo le da el peor-caso textual.
 */
export function widestCmDisplay(): string {
  let widest = '';
  let widestCommas = Number.POSITIVE_INFINITY;
  for (const v of wheelValues(CE_WHEEL)) {
    const s = formatCmAR(v);
    const commas = (s.match(/,/g) ?? []).length;
    // Más largo gana; a igual largo, el de MENOS comas (más dígitos → más ancho con glifos tabulares).
    if (s.length > widest.length || (s.length === widest.length && commas < widestCommas)) {
      widest = s;
      widestCommas = commas;
    }
  }
  return widest;
}

/**
 * Parsea lo que el operario TIPEÓ en el campo editable (input híbrido del step, R14.5 sub-cláusula de
 * teclado manual) y lo lleva a un valor VÁLIDO de la rueda de CE, o `null` si no es un número.
 *
 * Acepta coma O punto decimal (es-AR usa coma en el teclado, pero un punto pegado debe funcionar): "36,5",
 * "36.5", "36", " 40 ". Tolera unidad/sufijos no numéricos al final ("36,5 cm") y separador de miles es-AR
 * irrelevante acá (la CE es de 2 dígitos). Lo numérico se CLAMPEA a [20, 50] y se REDONDEA al 0,5 más
 * cercano (la misma grilla que la rueda) reusando `snapToWheel` — así el campo y la rueda comparten un
 * único valor canónico. Entrada vacía / sin dígitos / no-numérica → `null` (el caller decide: revertir al
 * último valor válido, no mover la rueda). NaN/∞ ya los maneja `snapToWheel` aguas abajo.
 *
 * PURO (sin RN): la validación del input se testea sin montar UI, igual que el resto del módulo.
 */
export function parseCmInput(raw: string, spec: WheelSpec = CE_WHEEL): number | null {
  if (typeof raw !== 'string') return null;
  // Normaliza coma decimal es-AR a punto y descarta todo lo que no sea dígito, signo o separador decimal.
  // (un "36,5 cm" tipeado o pegado no debe romper el parseo).
  const cleaned = raw.trim().replace(',', '.').replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  // Mismo clamp + grilla 0,5 que la rueda → un solo valor canónico entre campo y rueda.
  return snapToWheel(n, spec);
}

/**
 * Etiqueta de la edad para el control secundario. Prellenada → "≈ N meses" (es estimación, no exacta —
 * el "≈" lo comunica honestamente, DM6-6: no se distingue precisión del birth_date). Singular "1 mes".
 * Si `months` es null (sin fecha y sin ajuste manual) → "Edad sin definir" (el caller la muestra como
 * affordance para fijarla; la edad puede quedar desconocida, age_months NULL, R14.7).
 */
export function formatAgeLabel(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(months)) return 'Edad sin definir';
  const m = Math.round(months);
  return m === 1 ? '≈ 1 mes' : `≈ ${m} meses`;
}

/** Valor de la edad en la RUEDA de meses (sin "≈"): "24 meses" / "1 mes". El header del sheet lo usa. */
export function formatMonthsAR(months: number): string {
  const m = snapToWheel(months, AGE_WHEEL);
  return m === 1 ? '1 mes' : `${m} meses`;
}

/**
 * Edad SOLO el número, para las CELDAS de la rueda de meses: "24", "120" (la unidad "meses" va una vez en
 * el header/encabezado de la rueda, no en cada celda — si fuera "24 meses" por celda, el texto largo se
 * truncaría con "…" al ancho de la celda, ilegible). Espeja cómo la rueda de CE muestra "36" en las celdas
 * y "cm" aparte. NO lleva coma (los meses son enteros).
 */
export function formatMonthsNum(months: number): string {
  return String(snapToWheel(months, AGE_WHEEL));
}

// ─── Edad prellenada desde birth_date (R14.6, DM6-6) ─────────────────────────────────────────────────

/**
 * Edad en meses PRELLENADA a partir del `birthDate` denorm ('YYYY-MM-DD' o null), clampeada al rango de
 * la rueda de meses. Reusa `monthsBetween` (animal-age.ts) — la MISMA fuente de verdad que la edad de la
 * ficha. DM6-6: NO se distingue fecha exacta de año-solo ('AAAA-07-01'); se prellena con lo que haya y el
 * operario la ajusta por la rueda si no le cierra. Sin fecha (o futura/inválida) → null (no se prellena;
 * la rueda arranca en el default y la edad puede quedar desconocida). `now` inyectable para tests.
 */
export function prefillAgeMonths(
  birthDate: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const months = monthsBetween(birthDate, now);
  if (months == null) return null;
  // Clamp a [AGE_MIN, AGE_MAX]: un torito recién destetado podría dar <6, un dato viejo >120.
  return snapToWheel(months, AGE_WHEEL);
}

/** Índice inicial de la rueda de meses: la edad prellenada/ajustada, o el default si es desconocida. */
export function initialAgeIndex(months: number | null | undefined): number {
  const seed = months == null || !Number.isFinite(months) ? AGE_DEFAULT_MONTHS : months;
  return valueToIndex(seed, AGE_WHEEL);
}

// ─── helpers internos ────────────────────────────────────────────────────────────────────────────

/** Redondea `v` al múltiplo de `step` más cercano sin drift binario (×inv → round → ÷inv). */
function roundStep(v: number, step: number): number {
  const inv = 1 / step;
  return Math.round(v * inv) / inv;
}
