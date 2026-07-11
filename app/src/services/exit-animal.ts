// Lógica PURA de la baja / egreso de animal (spec 02 C3.3, R4.14 / R14.9).
//
// SIN I/O, SIN imports de RN/expo/supabase: testeable con node:test (mismo patrón que
// utils/establishment.ts ↔ services/establishment-store.ts e import/import-write.ts — la lógica pura
// vive acá, la I/O en services/animals.ts::exitAnimalProfile, que NO carga bajo node:test porque
// importa `./supabase` → expo-secure-store). Acá: el mapeo motivo→(status, exit_reason) y la
// clasificación de errores del RPC `exit_animal_profile` (migration 0044) a un AppError accionable.

import type { AppError } from './animals';
import { formatDateEsAr } from '../utils/format-date-es-ar';

// ─── Motivo de baja (UI) → (status, exit_reason) ─────────────────────────────────────
//
// MVP expone 3 motivos (D1 del context / R14.9), no los 6 del enum DB (`culling/theft/other` quedan
// diferidos hasta validar su semántica de reporte con Facundo). Cada motivo mapea 1:1 a un status de
// egreso + su exit_reason — una decisión por pantalla, sin ambigüedad (campo-friendly).

/** Los 3 motivos de baja que ofrece la UI en MVP. */
export type ExitReasonChoice = 'sale' | 'death' | 'transfer';

/** Status de egreso (NO 'active'): el RPC rechaza 'active' con 23514. */
export type ExitStatus = 'sold' | 'dead' | 'transferred';

/** Una entrada del mapeo: motivo de UI → su (status, exit_reason) + si captura datos de venta. */
export type ExitReasonMapping = {
  /** El motivo (UI), también el valor de `exit_reason` que viaja al RPC (coinciden 1:1 en MVP). */
  choice: ExitReasonChoice;
  /** El `status` resultante del perfil tras la baja. */
  status: ExitStatus;
  /** El `exit_reason` (enum DB) — idéntico a `choice` en MVP. */
  exitReason: ExitReasonChoice;
  /** Etiqueta es-AR del motivo (la que ve el operario). */
  label: string;
  /** ¿Captura peso + precio de salida? SOLO Venta (D2 del context) — alimenta analytics. */
  capturesSaleData: boolean;
};

/**
 * Mapa motivo→(status, exit_reason), fuente única del paso 1 del sheet de baja y del servicio.
 * Orden = el de presentación en la UI (Venta, Muerte, Transferencia).
 *
 *   Venta         → (sold, sale)        + peso/precio opcionales
 *   Muerte        → (dead, death)       —
 *   Transferencia → (transferred, transfer) —  (baja simple por egreso, NO el re-parenting de feat. 11)
 */
export const EXIT_REASON_MAPPINGS: readonly ExitReasonMapping[] = [
  { choice: 'sale', status: 'sold', exitReason: 'sale', label: 'Venta', capturesSaleData: true },
  { choice: 'death', status: 'dead', exitReason: 'death', label: 'Muerte', capturesSaleData: false },
  {
    choice: 'transfer',
    status: 'transferred',
    exitReason: 'transfer',
    label: 'Transferencia',
    capturesSaleData: false,
  },
] as const;

/**
 * Resuelve el (status, exit_reason) de un motivo de UI. Función PURA (testeable): Venta→(sold,sale),
 * Muerte→(dead,death), Transferencia→(transferred,transfer). Devuelve el mapping completo o null si
 * el motivo no es uno de los 3 del MVP (defensivo; la UI nunca pasa otro valor).
 */
export function exitReasonToStatus(choice: ExitReasonChoice): ExitReasonMapping | null {
  return EXIT_REASON_MAPPINGS.find((m) => m.choice === choice) ?? null;
}

// ─── Motivos de la BAJA EN TANDA (delta lotes-venta, RLV.4/RLV.4.1/RLV.4.2) ────────────
//
// La baja en tanda desde un lote (LOOP CLIENT-SIDE de exit_animal_profile, sin RPC nueva) ofrece SOLO
// **Venta** y **Muerte** — "Venta simple" (Raf, Puerta 1 2026-07-10). NO se agrega `culling` (sigue diferido
// a validar con Facundo, como en `c3.3-baja`); "Descarte" queda SOLO como NOMBRE de lote sugerido (RLV.13),
// NO como motivo. La `Transferencia` per-animal sigue en la ficha (`app/animal/baja.tsx`), pero NO en la
// tanda (RLV.4.2). Se DERIVA como subconjunto de `EXIT_REASON_MAPPINGS` (fuente única) para no duplicar el
// mapeo ni desincronizarse: si mañana cambia el status/label de Venta/Muerte, cambia en un solo lugar. El
// filtro por `choice` garantiza que `culling`/`theft`/`other`/`transfer` NO caigan en el set de la tanda.

/** Los motivos que la baja EN TANDA ofrece (RLV.4): Venta y Muerte, en ese orden de presentación. */
export type BatchExitChoice = Extract<ExitReasonChoice, 'sale' | 'death'>;

/**
 * Subconjunto Venta/Muerte de `EXIT_REASON_MAPPINGS` (RLV.4.1). Fuente única del paso 1 del form de venta
 * de la tanda (`app/lote/venta.tsx`). Derivado por filtro (no reescrito): garantiza `sale`→(sold,sale) +
 * `death`→(dead,death), SIN `culling`/`transfer`/`theft`/`other` (RLV.4.2). Orden = Venta, Muerte.
 */
export const BATCH_EXIT_MAPPINGS: readonly ExitReasonMapping[] = EXIT_REASON_MAPPINGS.filter(
  (m): m is ExitReasonMapping & { choice: BatchExitChoice } =>
    m.choice === 'sale' || m.choice === 'death',
);

/** ¿`choice` es un motivo válido de la baja en tanda (Venta/Muerte)? Defensivo (RLV.4.2). */
export function isBatchExitChoice(choice: string): choice is BatchExitChoice {
  return BATCH_EXIT_MAPPINGS.some((m) => m.choice === choice);
}

/**
 * Resuelve el mapping de un motivo de la TANDA (RLV.4.1). Como `exitReasonToStatus` pero acotado al set de
 * la tanda: devuelve null para cualquier motivo que NO sea Venta/Muerte (p.ej. `transfer`, `culling`) — la
 * UI de la tanda nunca ofrece otro, pero el contrato es fail-safe.
 */
export function batchExitReasonToStatus(choice: string): ExitReasonMapping | null {
  return BATCH_EXIT_MAPPINGS.find((m) => m.choice === choice) ?? null;
}

// ─── Precio/peso EFECTIVO por animal de la tanda (datos comunes ajustables, RLV.5.2/RLV.6) ─────
//
// La tanda carga datos COMUNES (un precio/peso para todos) que el operario puede AJUSTAR por animal
// (override). Esta función PURA resuelve el valor efectivo de UN animal: el override GANA sobre el común;
// ambos pueden ser null (campo vacío → no se manda → el RPC coalesce, no pisa nada). "Vacío" del override =
// `null`/`undefined` → cae al común (el operario que no toca a un animal usa el valor de la tanda, RLV.5.2);
// un override presente (incl. un número) PISA el común aunque el común exista (RLV.6). NO valida rangos
// (eso es validateExitPrice/validateExitWeight, RLV.6.1): acá solo se elige QUÉ valor va, ya validado.

export type EffectiveSaleData = { price: number | null; weight: number | null };

/**
 * Resuelve el precio y peso EFECTIVOS de un animal de la tanda (RLV.5.2/RLV.6): el override gana sobre el
 * común; `null`/`undefined` en el override → cae al común; ambos pueden ser null. PURA (testeable).
 */
export function resolveEffectiveSaleData(input: {
  commonPrice: number | null;
  commonWeight: number | null;
  overridePrice?: number | null;
  overrideWeight?: number | null;
}): EffectiveSaleData {
  const price = input.overridePrice ?? input.commonPrice ?? null;
  const weight = input.overrideWeight ?? input.commonWeight ?? null;
  return { price, weight };
}

// ─── Clasificación de errores del RPC exit_animal_profile (0044) ──────────────────────
//
// El RPC lanza, por `errcode`:
//   - 42501  → no autorizado (no es owner ni el autor con rol activo, has_role_in falló). El gating
//              del cliente es best-effort; el RPC es la barrera real → copy accionable.
//   - 23503  → el animal_profile no existe / ya no está disponible (deleted_at, o id inexistente).
//   - 23514  → status='active' pasado por error (la UI nunca lo manda; defensivo).
// Más network (sin conexión, R12.x — online-only con guard) y cualquier otro → unknown.
//
// El kind se reusa del AppError de animals.ts ('network' | 'unknown' | …). NO inventamos un kind
// nuevo (el shape es compartido por todos los services): el copy específico viaja en `message`, que
// es lo que la UI renderiza. NUNCA exponemos el `sqlerrm`/message crudo de Postgres al usuario.

const COPY = {
  unauthorized: 'No tenés permiso para dar de baja este animal.',
  gone: 'El animal ya no está disponible.',
  invalidStatus: 'No se pudo dar de baja el animal. Volvé a intentar.',
  network: 'Sin conexión: no pudimos dar de baja el animal. Conectate y volvé a intentar.',
  unknown: 'No se pudo dar de baja el animal. Volvé a intentar.',
} as const;

/**
 * Clasifica el error del RPC `exit_animal_profile` a un AppError con copy es-AR accionable. PURA
 * (testeable): recibe el `{ message, code }` que devuelve supabase-js (PostgrestError) y NO toca red.
 *
 * Detecta primero la red por el MENSAJE (supabase-js no setea code en fallos de fetch), luego los
 * errcode conocidos del RPC. Cualquier otro → unknown con copy genérico (nunca el message crudo).
 */
export function classifyExitError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  const code = error?.code ?? '';

  if (/network|failed to fetch|fetch failed|networkerror/i.test(msg)) {
    return { kind: 'network', message: COPY.network };
  }
  if (code === '42501') {
    return { kind: 'unknown', message: COPY.unauthorized };
  }
  if (code === '23503') {
    return { kind: 'unknown', message: COPY.gone };
  }
  if (code === '23514') {
    return { kind: 'unknown', message: COPY.invalidStatus };
  }
  return { kind: 'unknown', message: COPY.unknown };
}

export const EXIT_ERROR_COPY = COPY;

// ─── Badge de modo archivada (ficha de un animal dado de baja) ────────────────────────
//
// Cuando un animal está archivado (status ≠ active), la ficha muestra un badge bajo el hero con el
// verbo derivado de su status + (si hay) la fecha de egreso. PURO (testeable): deriva el texto de
// status + exitDate, tolerando exitDate null (un animal archivado por seed/datos viejos sin fecha).
//
// El verbo sale del STATUS (no del exit_reason, que en MVP es 1:1 igual): sold→"Vendido",
// dead→"Muerto", transferred→"Transferido". status 'active' → null (no se muestra badge).

/** Verbo de archivada por status (masculino, neutral — el animal puede ser macho o hembra). */
function archivedVerb(status: string): string | null {
  switch (status) {
    case 'sold':
      return 'Vendido';
    case 'dead':
      return 'Muerto';
    case 'transferred':
      return 'Transferido';
    default:
      return null;
  }
}

/**
 * Texto del badge de modo archivada (R14.9): "Vendido el {dd/mm/aaaa}" / "Muerto el …" / "Transferido
 * el …". Si exitDate es null/vacío (datos viejos), solo el verbo sin la fecha. status 'active' → null
 * (la ficha no muestra badge). La fecha se muestra en formato es-AR dd/mm/aaaa (formatDateEsAr, tz-safe
 * para la columna date `exit_date`); NUNCA un "null" literal ni el ISO crudo.
 */
export function archivedBadgeLabel(status: string, exitDate: string | null): string | null {
  const verb = archivedVerb(status);
  if (verb === null) return null;
  const date = exitDate?.trim();
  return date ? `${verb} el ${formatDateEsAr(exitDate)}` : verb;
}

// ─── Validación OPCIONAL de los datos de venta (peso + precio) ────────────────────────
//
// En la baja por Venta, peso y precio son OPCIONALES (D2): el campo vacío es válido (devuelve
// {ok:true, value:null} → no se manda). Con texto, se valida un número positivo razonable. Acepta
// coma decimal es-AR. PURO (testeable), espeja la forma de validateWeight de event-input pero
// permitiendo el vacío (allí el peso de un evento es requerido; acá es opcional).

export type OptionalNumberValidation =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/** Parsea un decimal aceptando coma es-AR ("1500,5" → 1500.5). null si no es número. */
function parseArAr(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Tope del peso de salida (consistente con WEIGHT_KG_LIMIT de event-input: < 10000 kg, 4 cifras). */
const EXIT_WEIGHT_LIMIT = 10000;
/** Tope defensivo del precio de salida (evita basura; un valor enorme se rechaza con copy claro). */
const EXIT_PRICE_LIMIT = 1_000_000_000;

/**
 * Valida el peso de salida (OPCIONAL, solo Venta). Vacío → null (no se manda). Con texto: número > 0
 * y < 10000 kg. `raw` ya viene sanitizado en vivo por sanitizeWeightInput (solo dígitos + 1 separador).
 */
export function validateExitWeight(raw: string): OptionalNumberValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  const n = parseArAr(trimmed);
  if (n === null || n <= 0) {
    return { ok: false, error: 'El peso tiene que ser un número mayor a 0.' };
  }
  if (n >= EXIT_WEIGHT_LIMIT) {
    return { ok: false, error: 'El peso no puede tener más de 4 cifras.' };
  }
  return { ok: true, value: n };
}

/**
 * Sanitiza EN VIVO el precio de salida: dígitos + UN solo separador decimal (coma/punto es-AR).
 * Descarta letras y separadores extra. A DIFERENCIA de sanitizeWeightInput (que acota la parte entera
 * a 4 dígitos, porque ningún bovino pesa ≥10000 kg), el precio NO acota la parte entera: un animal
 * en AR se vende por cientos de miles de pesos (5-7 cifras). Acota el LARGO TOTAL a 13 chars
 * (defensivo, > tope de validateExitPrice de 9 cifras + separador + decimales) para no permitir
 * tipear basura sin fin. El validador resuelve el rango final al submit.
 *
 *   "250000"   → "250000"
 *   "1500,75"  → "1500,75"
 *   "abc1200"  → "1200"
 *   "1,2,3"    → "1,23"     (un solo separador)
 */
export function sanitizePriceInput(raw: string): string {
  const MAX_LEN = 13;
  let seenSeparator = false;
  let out = '';
  for (const ch of raw) {
    if (out.length >= MAX_LEN) break;
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if ((ch === ',' || ch === '.') && !seenSeparator) {
      seenSeparator = true;
      out += ch;
    }
    // letras / 2do separador → descartados
  }
  return out;
}

/**
 * Valida el precio de salida en $ (OPCIONAL, solo Venta). Vacío → null (no se manda). Con texto:
 * número > 0 y dentro de un tope defensivo. Acepta coma decimal es-AR.
 */
export function validateExitPrice(raw: string): OptionalNumberValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  const n = parseArAr(trimmed);
  if (n === null || n <= 0) {
    return { ok: false, error: 'El precio tiene que ser un número mayor a 0.' };
  }
  if (n >= EXIT_PRICE_LIMIT) {
    return { ok: false, error: 'Ese precio es demasiado grande.' };
  }
  return { ok: true, value: n };
}
