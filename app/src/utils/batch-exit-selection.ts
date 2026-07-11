// Estado PURO de la SELECCIÓN del subconjunto de la baja en tanda (delta lotes-venta, RLV.3/RLV.3.1/RLV.3.2).
// SIN I/O, SIN RN/expo/supabase: testeable con node:test (mismo patrón que bulk-selection.ts / utils puros).
//
// El operario abre un lote → entra en "modo selección" → tilda un subconjunto de los animales ACTIVOS del
// lote (o "seleccionar todos"). La UI mantiene un `Set<profileId>` de seleccionados; estas funciones puras
// deciden las transiciones (toggle por animal, seleccionar/deseleccionar todos) y derivan el contador +
// "¿se puede avanzar?" (≥1 seleccionado, RLV.3.1). NO conoce la fila del animal ni el motivo: solo ids.
//
// Invariante (RLV.21.1): el conjunto de ids operables lo provee SIEMPRE el caller desde `fetchGroupMembers`
// (RLS-scopeado). Estas funciones NUNCA fabrican ids; `selectAll` toma exactamente los que se le pasan y
// `toggle` no valida pertenencia (la valida el caller / el RPC server-side por-llamada, anti-IDOR).

/** El conjunto de profileIds seleccionados para la baja en tanda (inmutable de cara al caller). */
export type BatchSelection = ReadonlySet<string>;

/** Selección vacía (estado inicial del modo selección). */
export function emptySelection(): BatchSelection {
  return new Set<string>();
}

/**
 * Alterna un animal en la selección (RLV.3): si estaba tildado lo saca, si no lo agrega. Devuelve un NUEVO
 * Set (inmutable — no muta el recibido, apto para setState de React sin sorpresas de referencia).
 */
export function toggleSelection(selection: BatchSelection, profileId: string): BatchSelection {
  const next = new Set(selection);
  if (next.has(profileId)) next.delete(profileId);
  else next.add(profileId);
  return next;
}

/**
 * Selecciona TODOS los animales dados (RLV.3, "seleccionar todos"). `ids` = los miembros activos del lote
 * (de `fetchGroupMembers`, RLS-scopeado). Devuelve un nuevo Set con exactamente esos ids (dedup natural).
 */
export function selectAll(ids: readonly string[]): BatchSelection {
  return new Set(ids);
}

/** Deselecciona todos (vuelve a la selección vacía). */
export function deselectAll(): BatchSelection {
  return new Set<string>();
}

/**
 * Toggle de "seleccionar todos" (una sola afordancia en el header): si YA están todos seleccionados →
 * deselecciona todos; si falta alguno (o no hay ninguno) → selecciona todos. Usa `isAllSelected` para
 * decidir. `ids` = los miembros activos actuales del lote.
 */
export function toggleSelectAll(selection: BatchSelection, ids: readonly string[]): BatchSelection {
  return isAllSelected(selection, ids) ? deselectAll() : selectAll(ids);
}

/** Cantidad de animales seleccionados (RLV.3.2 — el contador visible en todo momento). */
export function selectionCount(selection: BatchSelection): number {
  return selection.size;
}

/** ¿Hay al menos un animal seleccionado? Habilita avanzar a la carga de datos (RLV.3.1). */
export function hasSelection(selection: BatchSelection): boolean {
  return selection.size > 0;
}

/**
 * ¿Están TODOS los animales del lote seleccionados? Con `ids` vacío → false (no hay "todos" que marcar; el
 * header no debe mostrarse tildado sobre una lista vacía). Solo cuenta como "todos" si cada id de la lista
 * está en la selección (ignora ids sobrantes en la selección que ya no son miembros — defensivo).
 */
export function isAllSelected(selection: BatchSelection, ids: readonly string[]): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => selection.has(id));
}

/**
 * Reduce la selección a los ids que SIGUEN siendo miembros activos del lote (RLV.21.1 — anti-IDOR/consistencia):
 * si la lista de miembros cambió (un animal se fue por otra vía) se descartan los ids que ya no pertenecen.
 * Devuelve la lista efectiva de profileIds a dar de baja, en el orden de `members` (estable para la UI).
 */
export function resolveSelectedIds(
  selection: BatchSelection,
  memberIds: readonly string[],
): string[] {
  return memberIds.filter((id) => selection.has(id));
}
