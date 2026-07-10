// Lógica PURA del CHECKLIST de vacunación por animal (spec 03 R6.1, delta-fix D2 · triage demo-facundo-padre
// 2026-07-10). Sin RN, sin red, sin SDK: testeable con node:test (mismo patrón que maneuver-wizard.ts).
//
// D2 (patrón CONFIRMADO por Raf): las vacunas se definen SOLO antes de la maniobra (preconfig de la tanda).
// Dentro de cada animal NO se cargan vacunas nuevas: por cada vacuna DEFINIDA el operario elige APLICA /
// NO APLICA (checklist grande, todas tildadas por default, destildar = no aplica). Solo se persisten
// `sanitary_events` de las TILDADAS (APLICA); las destildadas no escriben fila. Con 0 tildadas = "Sin vacuna"
// (path honesto de D1 preservado — el animal no recibe vacuna).
//
// Este módulo es el CEREBRO del checklist: arma el universo de filas + su estado inicial, y deriva el subset
// APLICA que se persiste. El componente (SilentVaccinationStep) solo dibuja y togglea.

/** Una fila del checklist: nombre de la vacuna DEFINIDA en la tanda + si APLICA a este animal (tildada). */
export type VaccineChecklistItem = { name: string; applies: boolean };

/**
 * Construye el checklist de vacunas para UN animal (D2). El universo son las vacunas DEFINIDAS en la tanda
 * (`defined`, del preconfig) — el operario NO agrega vacunas nuevas por animal (endurecimiento pedido).
 *
 * Estado inicial de `applies`:
 *   - PRIMER paso (`applied === undefined`): TODAS aplican (default APLICA — todas tildadas).
 *   - CORRECCIÓN (`applied` provisto): aplican SOLO las que estaban aplicadas (match case-insensitive) →
 *     al volver desde el resumen se respeta lo que el operario había (des)tildado.
 *
 * Defensa de datos legacy: si al corregir `applied` trae vacunas que NO están en `defined` (dato de la vía
 * de texto-libre POR ANIMAL previa a D2), se PRESERVAN al final del universo (tildadas) para no perder el
 * dato ya cargado. Deduplica case-insensitive preservando orden + casing del PRIMER visto (espeja
 * `splitMultiPreconfig`).
 */
export function buildVaccineChecklist(
  defined: readonly string[],
  applied?: readonly string[],
): VaccineChecklistItem[] {
  const universe = dedupNames([...(defined ?? []), ...(applied ?? [])]);
  // null = primer paso (todas aplican). Set de las aplicadas (lower) = corrección.
  const appliedSet =
    applied === undefined
      ? null
      : new Set(applied.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0));
  return universe.map((name) => ({
    name,
    applies: appliedSet === null ? true : appliedSet.has(name.toLowerCase()),
  }));
}

/**
 * Los nombres de las vacunas TILDADAS (APLICA), en el orden del checklist. Es EXACTAMENTE lo que se persiste
 * (N filas `sanitary_events`, una por vacuna — R6.1). 0 tildadas → `[]` → el resumen muestra "Sin vacuna".
 */
export function appliedVaccineNames(items: readonly VaccineChecklistItem[]): string[] {
  return items.filter((it) => it.applies).map((it) => it.name);
}

/** Dedup case-insensitive preservando orden + casing del primer visto (espeja splitMultiPreconfig/dedup). */
function dedupNames(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (v.length === 0) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
