// cut-service-core.ts — núcleo PURO de la orquestación de marcar/quitar CUT (delta spec 02, RCUT.1/RCUT.2).
//
// `setCut`/`unsetCut` (animals.ts) son orquestadores delgados: resuelven la categoría (resolveCutCategory,
// I/O local) y, según el id resuelto, ejecutan UN write local (runLocalWrite) o devuelven un error es-AR sin
// escribir. Esa DECISIÓN (¿hay id? → escribir : error sin escribir) se factoriza acá como una función pura
// INYECTABLE (recibe el resolve-result + un writer) → testeable con fakes, sin SDK/red/SQLite. Mismo patrón
// que `resolveTagLookup` (núcleo puro de `lookupByTag`). El contrato público de setCut/unsetCut NO cambia.
//
// Genérico sobre el tipo de error `E` (con la forma { kind; message }) para PROPAGAR el error exacto que el
// caller maneja (animals.AppError, con kind ancho duplicate_*) sin acoplar el núcleo a un enum concreto ni
// re-mapear. El núcleo nunca CREA un kind: solo propaga el del resolve/write, o devuelve un mensaje es-AR
// con kind 'unknown' (válido en ambos shapes) cuando no hay id resoluble.

/** Forma mínima de un error propagable: el caller decide el set de `kind` concreto (E extiende esto). */
export type CoreError = { kind: 'network' | 'unknown' | 'duplicate_tag' | 'duplicate_idv'; message: string };

/** Resultado uniforme (ok con valor, o error). Estructuralmente compatible con ServiceResult<T>. */
export type CoreResult<T, E extends CoreError = CoreError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Forma mínima del resolve-result que el núcleo necesita (subset de resolveCutCategory). */
export type ResolvedCutCategory = { cutCategoryId: string | null; derivedCategoryId: string | null };

/** Resultado del resolve (ok con los ids, o error propagable). */
export type ResolveOutcome<E extends CoreError = CoreError> = CoreResult<ResolvedCutCategory, E>;

/** Resultado de un write local (ok, o error propagable). El `value` extra (runLocalWrite) es tolerado. */
export type WriteOutcome<E extends CoreError = CoreError> =
  | { ok: true; value?: unknown }
  | { ok: false; error: E };

// Mensajes es-AR (voseo) — fijados acá para pinearlos en el test y reusarlos desde animals.ts.
export const CUT_RESOLVE_FAIL_MESSAGE =
  'No se pudo resolver la categoría CUT de este rodeo. Probá de nuevo cuando termine de sincronizar.';
export const UNCUT_RESOLVE_FAIL_MESSAGE =
  'No se pudo resolver la categoría a la que volver. Probá de nuevo cuando termine de sincronizar.';

/**
 * Decide + ejecuta el SET de CUT (RCUT.1): toma el id `cutCategoryId` del resolve; si es null/sin-resolve →
 * error es-AR SIN escribir (RCUT.1.2); si hay id → escribe (write(cutCategoryId)) y propaga el resultado.
 * El `write` lo inyecta el caller (en prod: runLocalWrite(buildSetCutUpdate(profileId, id))).
 */
export async function decideSetCut<E extends CoreError>(
  resolve: ResolveOutcome<E>,
  write: (cutCategoryId: string) => Promise<WriteOutcome<E>>,
): Promise<CoreResult<true, E>> {
  if (!resolve.ok) return { ok: false, error: resolve.error };
  const id = resolve.value.cutCategoryId;
  if (id == null) {
    return { ok: false, error: { kind: 'unknown', message: CUT_RESOLVE_FAIL_MESSAGE } as E };
  }
  const w = await write(id);
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, value: true };
}

/**
 * Decide + ejecuta el UNSET de CUT (RCUT.2): toma el id `derivedCategoryId` del resolve; si es null/sin-resolve
 * → error es-AR SIN escribir (RCUT.2.2); si hay id → escribe (write(derivedCategoryId)) y propaga. El write
 * inyectado en prod es runLocalWrite(buildUnsetCutUpdate(profileId, id)) — el camino que SÍ resetea is_cut.
 */
export async function decideUnsetCut<E extends CoreError>(
  resolve: ResolveOutcome<E>,
  write: (derivedCategoryId: string) => Promise<WriteOutcome<E>>,
): Promise<CoreResult<true, E>> {
  if (!resolve.ok) return { ok: false, error: resolve.error };
  const id = resolve.value.derivedCategoryId;
  if (id == null) {
    return { ok: false, error: { kind: 'unknown', message: UNCUT_RESOLVE_FAIL_MESSAGE } as E };
  }
  const w = await write(id);
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, value: true };
}

