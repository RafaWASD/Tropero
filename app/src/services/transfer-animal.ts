// Lógica PURA de la transferencia de animal entre campos (spec 11, R7.1 / R5.2 — copy).
//
// SIN I/O, SIN imports de RN/expo/supabase: testeable con node:test (mismo patrón que
// services/exit-animal.ts ↔ services/animals.ts::exitAnimalProfile). Acá viven: el shape del input/
// resultado del RPC `transfer_animal` (0087), la clasificación de sus errores (42501/23514/23503 +
// network) a un AppError accionable, y la lectura del flag `idv_dropped` del resultado. La I/O (el
// `assertOnline` + `supabase.rpc('transfer_animal', ...)`) vive en services/animals.ts::transferAnimal,
// que NO carga bajo node:test (importa `./supabase` → expo-secure-store).
//
// ONLINE-ONLY (R7.1): la transferencia NO se encola offline (toca datos de X que deben estar firmes,
// análogo a crear-campo, spec 01 R9.2). El call-site hace un fast-fail con `assertOnline` antes del RPC.

import type { AppError } from './animals';

// ─── Input del RPC transfer_animal (espeja la firma SQL de 0087) ──────────────────────
//
// El cliente NO arma el establishment_id de ORIGEN ni el animal_id: el RPC los deriva de la FILA REAL
// del perfil de origen (anti-IDOR). Solo manda el perfil de origen + los datos de DESTINO + el id del
// perfil nuevo generado por el cliente (UUID estable entre reintentos → idempotencia, R6.2).
export type TransferAnimalInput = {
  /** Perfil ACTIVO del animal en el campo de ORIGEN X (lo vio el cliente vía RLS). */
  sourceProfileId: string;
  /** Campo DESTINO Y (el establishment activo del cliente). */
  targetEstablishmentId: string;
  /** Rodeo destino en Y (mismo sistema que el de origen; R1.5/R2.2). */
  targetRodeoId: string;
  /** Id del PERFIL NUEVO, generado por el cliente (UUID estable entre reintentos → idempotencia, R6.2). */
  targetProfileId: string;
  /** Categoría inicial en Y (la resuelve el cliente con el catálogo del system destino; R2.9 / TODO-D2). */
  targetCategoryId: string;
};

/** Resultado de una transferencia exitosa (espeja el jsonb que devuelve 0087). */
export type TransferAnimalResult = {
  /** Id del perfil nuevo en Y (= targetProfileId). */
  targetProfileId: string;
  /**
   * true si el `idv` del perfil viejo COLISIONÓ con uno existente en Y → el perfil nuevo arrancó con
   * idv = NULL (R2.4/R2.5). La UI debe avisar al operario que complete el idv (R4.13.a permite NULL→valor).
   */
  idvDropped: boolean;
  /** Perfil de origen (ahora archivado en X con status='transferred'). */
  sourceProfileId: string;
  /** true si fue un replay (la transferencia ya se había aplicado; idempotencia, R6.1). */
  replay: boolean;
};

/** El shape crudo del jsonb que devuelve el RPC (snake_case del SQL). */
export type TransferAnimalRpcRow = {
  target_profile_id: string;
  idv_dropped: boolean;
  source_profile_id: string;
  replay: boolean;
};

/**
 * Mapea el jsonb del RPC al resultado de dominio (camelCase). PURO (testeable). Tolerante: si el RPC
 * (versión vieja / shape inesperado) no trae `replay`, lo asume `false`; `idv_dropped` ausente → `false`.
 */
export function mapTransferResult(row: TransferAnimalRpcRow | null, fallbackTargetProfileId: string): TransferAnimalResult {
  return {
    targetProfileId: row?.target_profile_id ?? fallbackTargetProfileId,
    idvDropped: row?.idv_dropped === true,
    sourceProfileId: row?.source_profile_id ?? '',
    replay: row?.replay === true,
  };
}

// ─── Clasificación de errores del RPC transfer_animal (0087) ──────────────────────────
//
// El RPC lanza, por `errcode`:
//   - 42501 → no autorizado. Dos sub-casos (mismo copy genérico para no dar un oráculo de cuál falló):
//       (a) sin rol activo en el campo DESTINO Y; (b) sin rol activo en X, o no owner ni creador del
//       animal en X (paridad con la baja exit_animal_profile, R5.1/R5.2).
//   - 23514 → guard de dominio: rodeo destino de otro system / inexistente / inactivo / no en Y, u
//       origen==destino (R1.6/R2.2). La UI rara vez lo manda (gatea el rodeo antes), defensivo.
//   - 23503 → el perfil de origen no existe / ya no está activo / ya fue transferido (R5.6).
//   - 23505 → colisión de unicidad inesperada (defensivo; el idv se resuelve a NULL en el RPC, así que
//       esto solo saltaría por una carrera del perfil activo — R6.3 → "ya no está disponible").
// Más network (sin conexión, R7.1 — online-only con guard) y cualquier otro → unknown genérico.
//
// El kind se reusa del AppError de animals.ts. NUNCA exponemos el sqlerrm/message crudo de Postgres.

const COPY = {
  unauthorized: 'No tenés permiso para transferir este animal. Necesitás ser dueño o haberlo cargado, y tener acceso a ambos campos.',
  invalidTarget: 'No se pudo transferir: revisá que el rodeo destino sea del mismo sistema y esté activo.',
  gone: 'Este animal ya no está disponible para transferir (puede que ya se haya transferido).',
  conflict: 'Este animal ya no está disponible para transferir. Volvé a intentar.',
  network: 'Sin conexión: la transferencia necesita internet. Conectate y volvé a intentar.',
  unknown: 'No se pudo transferir el animal. Volvé a intentar.',
} as const;

/**
 * Clasifica el error del RPC `transfer_animal` a un AppError con copy es-AR accionable. PURA
 * (testeable): recibe el `{ message, code }` de supabase-js (PostgrestError) y NO toca red.
 *
 * Detecta primero la red por el MENSAJE (supabase-js no setea code en fallos de fetch), luego los
 * errcode conocidos del RPC. Cualquier otro → unknown con copy genérico (nunca el message crudo).
 */
export function classifyTransferError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  const code = error?.code ?? '';

  if (/network|failed to fetch|fetch failed|networkerror/i.test(msg)) {
    return { kind: 'network', message: COPY.network };
  }
  if (code === '42501') {
    return { kind: 'unknown', message: COPY.unauthorized };
  }
  if (code === '23514') {
    return { kind: 'unknown', message: COPY.invalidTarget };
  }
  if (code === '23503') {
    return { kind: 'unknown', message: COPY.gone };
  }
  if (code === '23505') {
    return { kind: 'unknown', message: COPY.conflict };
  }
  return { kind: 'unknown', message: COPY.unknown };
}

export const TRANSFER_ERROR_COPY = COPY;

/**
 * Mensaje offline accionable para el fast-fail ONLINE-only (R7.1). La I/O lo usa con `assertOnline`.
 * Expuesto para que el call-site no re-tipee el copy.
 */
export const TRANSFER_OFFLINE_MESSAGE = COPY.network;
