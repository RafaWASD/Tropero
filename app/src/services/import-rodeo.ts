// Capa de I/O del import masivo de rodeo (spec 12, Fase 3 — T3.1..T3.5).
//
// ÚNICA capa que toca red/DB en el flujo de import. Ata los utils PUROS de
// app/src/utils/import/ (parseo + normalización + validación + dedup intra-archivo + lógica de
// escritura import-write.ts, ya hechos) con el RPC `import_rodeo_bulk` (0074, SECURITY DEFINER) y
// la tabla `import_log` (0073).
//
// Forzado server-side (R9): establishment_id / created_by / imported_by / species_id / system_id /
// category_id se derivan/fuerzan en el RPC y los triggers (0043/0021/0037), NO se mandan desde acá.
// El cliente SOLO manda el shape de censo de cada fila (contrato `p_rows` del header de 0074):
// row_index + sex + tag_electronic + birth_date + idv + visual_id_alt + breed + category_code +
// category_override + management_group_id. Nunca category_id ni establishment_id ni autoría.
//
// La LÓGICA PURA (merge de dedup, armado de p_rows, chunking, resumen/truncado de error_details,
// guard de tamaño, escapeIlike) vive en app/src/utils/import/import-write.ts (sin RN/expo/supabase),
// testeable con node:test SIN red (mismo patrón que utils/establishment.ts ↔ establishment-store.ts).
// La parte I/O de acá (queries de dedup + RPC + insert del log) está cubierta por la suite del RPC
// (supabase/tests/import/run.cjs).

import { supabase } from './supabase';
import {
  buildRpcRow,
  chunkRows,
  accumulateChunk,
  mergeDedupAgainstExisting,
  normalizeLoteName,
  summarizeErrorDetails,
  uniqueNonEmpty,
  DEDUP_IN_CHUNK,
  type CandidateRow,
  type DedupAgainstExistingResult,
  type ExistingDuplicate,
  type RowErrorEntry,
  type RpcRow,
  type RpcChunkResult,
  type WriteAccumulator,
  type ErrorDetailsSummary,
} from '../utils/import/import-write';

// Re-export del tipo de fila candidata + el guard de tamaño puro, para que el hook (Fase 4) los use
// desde el service sin importar dos módulos. La lógica vive en import-write.ts; acá solo I/O.
export type {
  CandidateRow,
  ExistingDuplicate,
  ExistingDuplicateReason,
  RowErrorEntry,
} from '../utils/import/import-write';
export { checkFileSize, escapeIlike, MAX_FILE_BYTES } from '../utils/import/import-write';

// ─── Error / Result uniforme (mismo shape que animals.ts / rodeos.ts) ────────────────

export type AppError = {
  kind: 'network' | 'offline' | 'unknown';
  message: string;
};
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

function classifyError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

/** Formatos de archivo soportados (espejo del enum import_file_format de 0073). */
export type ImportFileFormat = 'csv' | 'xlsx' | 'sigsa_txt';

// ─── Resultado final del import (lo consume el hook/UI de Fase 4) ────────────────────

/** El resultado de una corrida completa de import (lo muestra ImportResultScreen, R8.3). */
export type ImportRunResult = {
  /** Total de filas de datos del archivo (incluye válidas, errores y duplicados). */
  totalRecords: number;
  /** Animales escritos OK (suma de los imported_ok de los chunks). */
  importedOk: number;
  /** Filas que fallaron en la escritura por carrera/unique server-side (R8.4). */
  importedErrors: number;
  /** Filas saltadas por dedup contra existentes (R7.2/R7.4). */
  skippedExisting: ExistingDuplicate[];
  /** Errores por-fila de la escritura (carrera). */
  writeErrors: RowErrorEntry[];
  /** id del import_log insertado (null si el insert del log falló — la escritura igual ocurrió). */
  importLogId: string | null;
};

// ─── I/O — T3.1: dedup contra existentes (2 queries en LOTE, no por fila) ─────────────

/**
 * Pre-check de dedup contra los animales EXISTENTES del establishment activo (R7.2/R7.3/R7.4). Hace
 * exactamente 2 queries EN LOTE (no N por fila):
 *   1. idv de las candidatas → `select idv from animal_profiles where establishment_id = $est
 *      and deleted_at is null and idv = any($idvs)` (RLS scopea por has_role_in; el .eq es defensa).
 *   2. tag de las candidatas → `select tag_electronic from animals where deleted_at is null
 *      and tag_electronic = any($tags)` (unique de TAG es GLOBAL por SENASA — sin filtro de est; solo
 *      se lee la columna tag, no datos de otro tenant — design §3.2). Corre bajo RLS del usuario: un
 *      TAG de OTRO tenant da falso-negativo y lo ataja el unique global en el insert (R8.4) — diseño
 *      explícito (LOW-1), NO se usa service-role para anticiparlo (sería un leak cross-tenant).
 *
 * Particiona con la lógica PURA mergeDedupAgainstExisting. Si no hay candidatas → no consulta.
 */
export async function dedupAgainstExisting(
  establishmentId: string,
  candidates: CandidateRow[],
): Promise<ServiceResult<DedupAgainstExistingResult>> {
  if (candidates.length === 0) {
    return { ok: true, value: { toWrite: [], skipped: [] } };
  }

  // Juntar los identificadores no vacíos (dedup del propio array de consulta para no repetir valores).
  const idvs = uniqueNonEmpty(candidates.map((c) => c.row.idv));
  const tags = uniqueNonEmpty(candidates.map((c) => c.row.tagElectronic));

  const existingIdvs = new Set<string>();
  const existingTags = new Set<string>();

  // Las queries `.in($array)` se parten en sub-lotes (DEDUP_IN_CHUNK) para no armar un query-string
  // que exceda el límite de URL de un GET de PostgREST con miles de valores. Sigue siendo "en lote"
  // (unas pocas queries, NO una por fila — design §3.2), solo URL-safe.
  for (const idvChunk of chunkRows(idvs, DEDUP_IN_CHUNK)) {
    const { data, error } = await supabase
      .from('animal_profiles')
      .select('idv')
      .eq('establishment_id', establishmentId)
      .is('deleted_at', null)
      .in('idv', idvChunk);
    if (error) return { ok: false, error: classifyError(error) };
    for (const r of (data ?? []) as { idv: string | null }[]) {
      if (r.idv) existingIdvs.add(r.idv);
    }
  }

  for (const tagChunk of chunkRows(tags, DEDUP_IN_CHUNK)) {
    const { data, error } = await supabase
      .from('animals')
      .select('tag_electronic')
      .is('deleted_at', null)
      .in('tag_electronic', tagChunk);
    if (error) return { ok: false, error: classifyError(error) };
    for (const r of (data ?? []) as { tag_electronic: string | null }[]) {
      if (r.tag_electronic) existingTags.add(r.tag_electronic);
    }
  }

  return { ok: true, value: mergeDedupAgainstExisting(candidates, existingIdvs, existingTags) };
}

// ─── I/O — T3.2: resolución de lotes por nombre → management_group_id (en LOTE) ────────

/**
 * Resuelve los nombres de lote de las candidatas a `management_group_id` contra los management_groups
 * ACTIVOS del establishment (R10.4): match POR NOMBRE, NO se crea el lote (default Gate 0). Trae los
 * grupos del establishment UNA vez y arma un mapa nombre-normalizado → id. Sin match → null (la fila
 * queda sin lote). RLS scopea por has_role_in; el .eq es defensa-en-profundidad.
 *
 * Devuelve un Map de índice-de-fila → management_group_id (solo las que matchearon).
 */
export async function resolveLotes(
  establishmentId: string,
  candidates: CandidateRow[],
): Promise<ServiceResult<Map<number, string>>> {
  const result = new Map<number, string>();
  const wanted = candidates.some((c) => normalizeLoteName(c.row.lote) !== null);
  if (!wanted) return { ok: true, value: result };

  const { data, error } = await supabase
    .from('management_groups')
    .select('id, name')
    .eq('establishment_id', establishmentId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: classifyError(error) };

  const byName = new Map<string, string>();
  for (const g of (data ?? []) as { id: string; name: string }[]) {
    const norm = normalizeLoteName(g.name);
    if (norm && !byName.has(norm)) byName.set(norm, g.id);
  }

  for (const c of candidates) {
    const norm = normalizeLoteName(c.row.lote);
    if (norm) {
      const id = byName.get(norm);
      if (id) result.set(c.index, id);
    }
  }

  return { ok: true, value: result };
}

// ─── I/O — T3.3: escritura batch vía el RPC en chunks (import parcial) ─────────────────

/**
 * Escribe las filas candidatas (ya dedupeadas contra existentes) vía el RPC `import_rodeo_bulk` en
 * chunks (R8.1/R8.2). Import parcial (R8.2): un chunk que devuelve errores NO aborta los demás; un
 * chunk que falla a nivel de red/transporte se reporta como error de TODAS sus filas y se sigue con
 * el resto (no all-or-nothing). Acumula conteos/errores de cada chunk con la lógica pura.
 *
 * El RPC deriva establishment/species/system del rodeo y fuerza autoría — acá solo mandamos
 * p_rodeo_id + p_rows. El cliente NO arma establishment_id.
 */
export async function writeInChunks(
  rodeoId: string,
  rpcRows: RpcRow[],
): Promise<ServiceResult<WriteAccumulator>> {
  let acc: WriteAccumulator = { imported_ok: 0, imported_errors: 0, errors: [] };

  for (const chunk of chunkRows(rpcRows)) {
    const { data, error } = await supabase.rpc('import_rodeo_bulk', {
      p_rodeo_id: rodeoId,
      p_rows: chunk,
    });

    if (error) {
      // Un fallo de transporte/RPC de ESTE chunk no aborta los demás (import parcial, R8.2). Si es un
      // error de red y nada se escribió todavía (sin conexión real desde el primer chunk), lo
      // propagamos hacia arriba; si ya hubo escrituras, reportamos las filas del chunk y seguimos.
      const appErr = classifyError(error);
      if (appErr.kind === 'network' && acc.imported_ok === 0 && acc.imported_errors === 0) {
        return { ok: false, error: appErr };
      }
      acc = accumulateChunk(acc, {
        imported_ok: 0,
        imported_errors: chunk.length,
        errors: chunk.map((r) => ({ row_index: r.row_index, reason: appErr.message })),
      });
      continue;
    }

    acc = accumulateChunk(
      acc,
      (data as RpcChunkResult) ?? { imported_ok: 0, imported_errors: 0, errors: [] },
    );
  }

  return { ok: true, value: acc };
}

// ─── I/O — T3.4: insert del import_log al finalizar (también 0 escritas, R5.6) ─────────

/**
 * Inserta el audit de la corrida en import_log (R11.1/R5.6/R8.3). imported_by lo FUERZA el trigger
 * tg_force_imported_by_auth_uid (0073) — NO se manda. error_details va ACOTADO (R11.5) para no chocar
 * el CHECK octet_length de 0073. file_name se topa también server-side (CHECK char_length≤255); acá lo
 * recortamos defensivamente para no recibir un 23514 evitable. Se inserta incluso con 0 escritas (R5.6).
 *
 * id generado en el cliente (sin .select() encadenado — gotcha RLS-on-RETURNING, consistente con
 * animals.ts). Si el insert falla, NO rompe el resultado de la escritura (ya ocurrió): ok:false.
 */
export async function insertImportLog(input: {
  establishmentId: string;
  rodeoId: string;
  fileName: string;
  fileFormat: ImportFileFormat;
  totalRecords: number;
  importedOk: number;
  importedErrors: number;
  errorDetails: ErrorDetailsSummary;
}): Promise<ServiceResult<string>> {
  const id = randomUuid();
  const fileName = input.fileName.slice(0, 255); // espejo del CHECK char_length(file_name)≤255 de 0073.

  const { error } = await supabase.from('import_log').insert({
    id,
    establishment_id: input.establishmentId,
    rodeo_id: input.rodeoId,
    file_name: fileName,
    file_format: input.fileFormat,
    total_records: input.totalRecords,
    imported_ok: input.importedOk,
    imported_errors: input.importedErrors,
    error_details: input.errorDetails,
    // imported_by se OMITE: lo fuerza el trigger 0073 a auth.uid() (R11.3) — mandarlo sería ignorado.
  });

  if (error) return { ok: false, error: classifyError(error) };
  return { ok: true, value: id };
}

// ─── Orquestación end-to-end de la escritura (lo llama el hook tras la confirmación, R5.5) ──

/** Lo que el hook le pasa al service tras la confirmación del preview (R5.5). */
export type ConfirmImportInput = {
  establishmentId: string;
  rodeoId: string;
  fileName: string;
  fileFormat: ImportFileFormat;
  /** Total de filas de datos del archivo (para el conteo del log, aunque algunas no se escriban). */
  totalRecords: number;
  /** Las filas CANDIDATAS (válidas + no-dup-intra-archivo) — salida de validate-rows + normalize-row. */
  candidates: CandidateRow[];
  /**
   * Probe de conectividad (R12.2): si devuelve false, NO se escribe ni se encola — se informa offline.
   * Inyectable para testear sin red; default = probe real (navigator.onLine en web; online si no se
   * puede determinar — la escritura fallaría con kind:'network' y se reporta, no bloqueamos por falso-offline).
   */
  isOnline?: () => boolean | Promise<boolean>;
};

/**
 * Orquesta la escritura completa tras la confirmación (R5.5): chequeo de conexión (R12.2) → dedup
 * contra existentes (T3.1) → resolución de lotes (T3.2) → armado de p_rows (T3.3) → escritura en
 * chunks (T3.3) → insert del log acotado (T3.4). Import parcial en cada paso. NO toca el parseo (es
 * del hook, local R12.1).
 *
 * R12.2: si está offline al confirmar → ok:false { kind:'offline' }, NO se encola (online por diseño).
 * R5.6: si no hay candidatas tras el dedup → no escribe, pero igual deja el import_log de la corrida.
 */
export async function confirmImport(
  input: ConfirmImportInput,
): Promise<ServiceResult<ImportRunResult>> {
  // R12.2 — conexión al confirmar. Online por diseño: si no hay red, informar y NO encolar.
  const online = await resolveOnline(input.isOnline);
  if (!online) {
    return {
      ok: false,
      error: {
        kind: 'offline',
        message: 'La importación necesita conexión a internet. Conectate y volvé a confirmar.',
      },
    };
  }

  // T3.1 — dedup contra existentes (skip + report, NUNCA update).
  const dedup = await dedupAgainstExisting(input.establishmentId, input.candidates);
  if (!dedup.ok) return dedup;
  const { toWrite, skipped } = dedup.value;

  // T3.2 — resolución de lotes por nombre → management_group_id (en lote, no crea).
  const lotes = await resolveLotes(input.establishmentId, toWrite);
  if (!lotes.ok) return lotes;

  // T3.3 — armado del p_rows (puro) + escritura en chunks (import parcial).
  const rpcRows = toWrite.map((c) => buildRpcRow(c, lotes.value.get(c.index) ?? null));

  let acc: WriteAccumulator = { imported_ok: 0, imported_errors: 0, errors: [] };
  if (rpcRows.length > 0) {
    const written = await writeInChunks(input.rodeoId, rpcRows);
    if (!written.ok) return written;
    acc = written.value;
  }

  // T3.4 — insert del import_log al finalizar (también 0 escritas, R5.6). error_details ACOTADO (R11.5).
  const errorDetails = summarizeErrorDetails(acc.errors);
  const log = await insertImportLog({
    establishmentId: input.establishmentId,
    rodeoId: input.rodeoId,
    fileName: input.fileName,
    fileFormat: input.fileFormat,
    totalRecords: input.totalRecords,
    importedOk: acc.imported_ok,
    importedErrors: acc.imported_errors,
    errorDetails,
  });

  // El audit es best-effort: si el insert del log falla, la escritura YA ocurrió → devolvemos el
  // resultado con importLogId = null (el caller puede avisar "no se pudo guardar el registro").
  const importLogId = log.ok ? log.value : null;

  return {
    ok: true,
    value: {
      totalRecords: input.totalRecords,
      importedOk: acc.imported_ok,
      importedErrors: acc.imported_errors,
      skippedExisting: skipped,
      writeErrors: acc.errors,
      importLogId,
    },
  };
}

/** Resuelve el estado de conexión (R12.2). Default: navigator.onLine en web; online si indeterminable. */
async function resolveOnline(probe?: () => boolean | Promise<boolean>): Promise<boolean> {
  if (probe) return await probe();
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
  } catch {
    // ignore — caemos a online.
  }
  return true;
}

/** UUID v4. crypto.randomUUID está en RN (Hermes), web y Node — sin dependencia extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
