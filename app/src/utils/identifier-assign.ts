// Predicados PUROS de elegibilidad para ASIGNAR un identificador desde la ficha (delta spec 02 caravana-ficha,
// RCF.1.7). Deciden si la sección "Identificación" debe ofrecer la afordancia "Agregar caravana …" para cada
// identificador, o mantenerlo solo-lectura.
//
// Regla única (context #1 / RCF.1.1–RCF.1.5): se ofrece asignar SOLO lo que está VACÍO (NULL→valor) en un
// animal ACTIVO. Lo ya seteado queda read-only (inmutabilidad post-completitud R4.13 — el trigger
// server-side rechazaría valor→otro/valor→NULL, así que el cliente ni siquiera lo ofrece). Un animal no
// activo (vendido/muerto/transferido) no recibe ninguna afordancia de asignación, consistente con el resto de
// acciones de la ficha que solo se ofrecen en activos (RCF.1.5).
//
// Sin RN, sin red, sin SDK: testeable con node:test (mismo molde que cut-eligibility.ts / repro-status.ts).
// La elección de qué afordancia mostrar cuelga de estos predicados + del valor del identificador; no se
// infiere de ninguna otra cosa.

// Espejo del `AnimalStatus` canónico (animals.ts:127 / components/AnimalRow.tsx:33 / cut-eligibility.ts:9). Se
// redefine inline acá (NO se importa del componente RN) para que el módulo no arrastre RN y siga puro/testeable.
export type AnimalStatus = 'active' | 'sold' | 'dead' | 'transferred';

/**
 * ¿Se puede ASIGNAR la caravana electrónica (`tag_electronic`)? (RCF.1.1/RCF.1.2/RCF.1.5)
 *
 * True ⇔ el animal está activo Y la caravana electrónica está vacía (`== null`, cubre null y undefined).
 * Cualquier valor ya seteado → false (read-only, R4.13); cualquier status ≠ 'active' → false.
 */
export function canAssignTag(a: { status: AnimalStatus; tagElectronic: string | null }): boolean {
  return a.status === 'active' && a.tagElectronic == null;
}

/**
 * ¿Se puede ASIGNAR la caravana visual / IDV (`idv`)? (RCF.1.3/RCF.1.4/RCF.1.5)
 *
 * True ⇔ el animal está activo Y el idv está vacío (`== null`). Valor seteado → false (read-only, R4.13);
 * status ≠ 'active' → false. Espejo exacto de canAssignTag sobre el otro identificador.
 */
export function canAssignIdv(a: { status: AnimalStatus; idv: string | null }): boolean {
  return a.status === 'active' && a.idv == null;
}
