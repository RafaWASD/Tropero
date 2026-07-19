// Lógica PURA del cursor keyset de la lista paginada de la vista de grupo (spec 10 delta rodeo-grande,
// RG1.4/RG1.5). SIN I/O, SIN imports de RN/expo/supabase/SDK: testeable con node:test. La I/O (correr
// `buildGroupAnimalsPageQuery` contra el SQLite local + enriquecer con el espejo) vive en `services/group-page.ts`;
// acá solo la DERIVACIÓN del próximo cursor y del corte de paginación a partir de las filas crudas de una página.
//
// El type `GroupPageCursor` vive en `local-reads.ts` (junto a `buildGroupAnimalsPageQuery`, que lo consume). Se
// importa como TIPO (local-reads es un módulo de builders PUROS, sin runtime deps → seguro de importar acá).

import type { GroupPageCursor } from '../services/powersync/local-reads';

export type { GroupPageCursor };

/** Forma mínima de una fila cruda de la página para derivar el cursor: la clave de orden `(in_treatment, created_at, id)`. */
export type CursorRow = {
  id: string;
  created_at: string;
  in_treatment: number | boolean | null;
};

/**
 * Deriva, de las filas crudas de una página (en el orden `in_treatment DESC, created_at DESC, id DESC` que la query
 * ya aplicó), el próximo cursor keyset y si la lista llegó al final (RG1.5).
 *
 * - `reachedEnd = rows.length < pageSize` (una página incompleta = no hay más filas). Página vacía → también fin.
 * - `nextCursor` = la clave `(inTreatment, createdAt, id)` de la ÚLTIMA fila, para el seek de la próxima página.
 *   Cuando `reachedEnd`, `nextCursor` es `null` (invariante: `reachedEnd ⟺ nextCursor === null`) → el hook corta
 *   la paginación por cualquiera de los dos sin loop infinito.
 *
 * `in_treatment` llega de SQLite como 0/1 (EXISTS) o boolean → se normaliza a `0 | 1` para el predicado keyset.
 */
export function deriveNextCursor(
  rows: readonly CursorRow[],
  pageSize: number,
): { nextCursor: GroupPageCursor | null; reachedEnd: boolean } {
  if (rows.length < pageSize || rows.length === 0) {
    return { nextCursor: null, reachedEnd: true };
  }
  const last = rows[rows.length - 1];
  return {
    nextCursor: {
      inTreatment: last.in_treatment === 1 || last.in_treatment === true ? 1 : 0,
      createdAt: last.created_at,
      id: last.id,
    },
    reachedEnd: false,
  };
}
