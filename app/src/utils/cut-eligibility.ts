// cut-eligibility.ts — lógica PURA de la afordancia CUT (descarte) en la ficha (delta spec 02, RCUT.3 /
// RCUT.6.2). Sin RN / sin red / sin SDK: solo predicados sobre primitivos → testeable con node:test.
//
// CUT = "Criando Último Ternero" = vaca de DESCARTE por edad/dientes (ADR-008). Es FEMALE-ONLY por
// definición (D3). Estos predicados deciden a QUIÉN se ofrece marcar/quitar CUT desde la ficha; el GATE de
// `dientes` (RCUT.7) NO vive acá (necesita I/O del rodeo) — la ficha lo AND-ea con `canMarkCut`.

export type AnimalSex = 'male' | 'female';
export type AnimalStatus = 'active' | 'sold' | 'dead' | 'transferred';

// Entradas del predicado de eligibilidad CUT. Notas por campo:
//   - sex: CUT es female-only (D3) → un macho nunca es elegible; null = desconocido → no se ofrece.
//   - status: solo un animal ACTIVO recibe afordancias de manejo (un archivado no se reorganiza).
//   - categoryCode: code de la categoría ('ternera', 'cut', 'multipara', … o null si irresoluble). El
//     criterio CONSERVADOR (RCUT.3.3): null/'' → NO se ofrece marcar CUT. La ternera NO es elegible (D2:
//     todas las hembras MENOS ternera).
//   - isCut: detail.isCut — la FUENTE DE VERDAD del estado CUT (flag denormalizado animal_profiles.is_cut).
export type CutEligibilityInfo = {
  sex: AnimalSex | null;
  status: AnimalStatus;
  categoryCode: string | null;
  isCut: boolean;
};

/**
 * ¿Se ofrece "Marcar como CUT (descarte)"? (RCUT.3.1 / D2 / D3). SSI hembra ACTIVA que NO es ternera, NO es
 * ya-CUT, y con `categoryCode` RESOLUBLE (criterio conservador con null/'' → false, RCUT.3.3). Función pura.
 */
export function canMarkCut(a: CutEligibilityInfo): boolean {
  return (
    a.sex === 'female' &&
    a.status === 'active' &&
    !a.isCut &&
    a.categoryCode != null &&
    a.categoryCode !== '' &&
    a.categoryCode !== 'ternera'
  );
}

/**
 * ¿Se ofrece "Quitar CUT"? (RCUT.5.4): hembra ACTIVA que YA es CUT. NO gateado por `dientes` (el desmarcado
 * es sustractivo, RCUT.7.2) ni por `categoryCode` (un CUT ya tiene la categoría 'cut' fijada). Función pura.
 */
export function canUnmarkCut(a: CutEligibilityInfo): boolean {
  return a.sex === 'female' && a.status === 'active' && a.isCut;
}

/**
 * Detección de la categoría CUT del badge (RCUT.6.2), en orden de preferencia:
 *   1) `code === 'cut'` cuando el call-site tiene el code (ruta preferida: hero de la ficha, AnimalRow).
 *   2) fallback por `label`/`name === 'CUT'` (valor FIJO del seed del catálogo 0015, no texto libre) para
 *      los call-sites que solo tienen el nombre (asignar-caravanas, import-rodeo, CandidatePicker, overlay).
 * Función pura. Tolerante a espacios/casing del label ('  cut  ' → true). Sin code ni label → false.
 */
export function isCutCategory(args: { code?: string | null; label?: string | null }): boolean {
  if (args.code != null && args.code !== '') return args.code === 'cut';
  return (args.label ?? '').trim().toUpperCase() === 'CUT';
}
