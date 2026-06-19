// app/src/utils/lote-picker.ts — lógica PURA del picker de lote del wizard de maniobra (spec 03 R9.2).
//
// El sheet de lote (LotePickerSheet) ofrece, EN ORDEN: PRIMERO "Sin lote" (selecciona null → quita el
// lote, R9.3) y luego cada `management_group` activo del campo. Cada opción lleva su estado `selected`
// derivado del `selectedId` actual del animal (`management_group_id`).
//
// Por qué un helper puro y no inline en el componente: la regla de selección tiene casos de borde sutiles
// (selectedId === null → "Sin lote" seleccionada; selectedId que NO matchea ningún grupo Y no es null →
// NINGUNA opción seleccionada — ni siquiera "Sin lote") que merecen test propio, separados del render. El
// sheet consume esta función → la lista y los flags `selected` salen de un solo lugar testeado.
//
// NO conoce React ni Tamagui ni red: solo arma la lista de opciones. El "Sin lote" usa id `null` (el mismo
// valor que `assignAnimalToGroup(profileId, null)` espera para quitar el lote).

import type { ManagementGroup } from '@/services/management-groups';

/** Etiqueta es-AR de la opción "ningún lote" — coincide con el display del alta (`crear-animal.tsx`). */
export const SIN_LOTE_LABEL = 'Sin lote';

/** Una opción del picker de lote: id (null = "Sin lote"), nombre a mostrar, y si está seleccionada hoy. */
export type LotePickerOption = {
  /** id del management_group, o `null` para la opción "Sin lote" (quita el lote, R9.3). */
  id: string | null;
  /** Nombre a mostrar (es-AR para "Sin lote"; el nombre libre del lote para los grupos). */
  name: string;
  /** ¿Es la opción actualmente asignada al animal? (deriva de `selectedId`). */
  selected: boolean;
};

/**
 * Arma las opciones del picker de lote en su orden canónico:
 *   1) "Sin lote" (id `null`) — seleccionada SSI `selectedId === null` (el animal hoy no tiene lote).
 *   2) cada grupo activo del campo — seleccionado SSI `g.id === selectedId`.
 *
 * Borde importante (testeado): si `selectedId` NO es null pero NO matchea ningún grupo de la lista (un
 * lote borrado, o aún sin sincronizar al SQLite local), NINGUNA opción queda `selected` — NI "Sin lote".
 * No "caemos" a Sin-lote como seleccionada: el animal SÍ tiene un lote (solo que no está en la lista
 * visible), así que marcar "Sin lote" mentiría sobre su estado. La lista vacía (`groups.length === 0`)
 * devuelve solo la opción "Sin lote".
 */
export function lotePickerOptions(
  groups: ManagementGroup[],
  selectedId: string | null,
): LotePickerOption[] {
  const options: LotePickerOption[] = [
    { id: null, name: SIN_LOTE_LABEL, selected: selectedId === null },
  ];
  for (const g of groups) {
    options.push({ id: g.id, name: g.name, selected: g.id === selectedId });
  }
  return options;
}
