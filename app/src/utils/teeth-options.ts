// Lógica PURA del catálogo de ESTADO DENTARIO (spec 03 M3.2a, R6.7/R6.8). Sin RN, sin red, sin SDK:
// testeable con node:test (mismo patrón que maneuver-applicability.ts).
//
// La maniobra DIENTES (R6.7) sobrescribe la PROPIEDAD `animal_profiles.teeth_state` (enum
// `teeth_state_enum`, migración 0020). Este módulo expone, en EL ORDEN cronológico de boca (de joven a
// gastada), las opciones del enum con su etiqueta es-AR y si ese valor dispara el prompt CUT (R6.8). El
// componente DientesStep solo dibuja esta lista (un bloque gigante por opción); el umbral CUT lo manda
// `CUT_PROMPT_TEETH` (maneuver-applicability.ts) — única fuente de verdad, no se re-define acá.
//
// El ORDEN (FIX #12, 2026-06-29 — pedido de Raf) va de boca MÁS GASTADA a más joven: descarte/vejez
// arriba (sin dientes → 1/4 → 1/2 → 3/4), boca llena (adulto pleno) al medio, y dientes de leche en
// bajada (6d → 4d → 2d). Es el REVERSO de la progresión etaria (joven→gastada). Las 3 más-gastadas
// (1/2, 1/4, sin dientes) son las que disparan CUT; 3/4 NO (R6.8). Las etiquetas espejan humanizeTeeth /
// el resumen (maneuver-sequence.TEETH_LABEL): "2 dientes", "Boca llena", "Sin dientes", etc.

import { CUT_PROMPT_TEETH } from './maneuver-applicability';

/** Una opción del selector de dientes: el valor del enum + su etiqueta es-AR + si dispara el prompt CUT. */
export type TeethOption = {
  /** Valor del enum `teeth_state_enum` (0020) — lo que se persiste en `animal_profiles.teeth_state`. */
  value: string;
  /** Etiqueta es-AR que ve el operario en el bloque (campo claro). */
  label: string;
  /** ¿Este valor es "boca de descarte"? → dispara el prompt CUT (R6.8). Marca visual en el bloque. */
  cutTrigger: boolean;
};

/**
 * Las 8 opciones del enum `teeth_state_enum` (0020) en ORDEN gastada → joven (FIX #12, 2026-06-29 —
 * reverso de la progresión etaria). El `cutTrigger` se DERIVA de `CUT_PROMPT_TEETH` (no se hardcodea por
 * opción) → si el umbral CUT cambia (Facundo decide incluir 3/4), basta tocar el set en
 * maneuver-applicability.ts y esta lista lo refleja.
 */
export const TEETH_OPTIONS: readonly TeethOption[] = [
  { value: 'sin_dientes', label: 'Sin dientes', cutTrigger: CUT_PROMPT_TEETH.has('sin_dientes') },
  { value: '1/4', label: '1/4', cutTrigger: CUT_PROMPT_TEETH.has('1/4') },
  { value: '1/2', label: '1/2', cutTrigger: CUT_PROMPT_TEETH.has('1/2') },
  { value: '3/4', label: '3/4', cutTrigger: CUT_PROMPT_TEETH.has('3/4') },
  { value: 'boca_llena', label: 'Boca llena', cutTrigger: CUT_PROMPT_TEETH.has('boca_llena') },
  { value: '6d', label: '6 dientes', cutTrigger: CUT_PROMPT_TEETH.has('6d') },
  { value: '4d', label: '4 dientes', cutTrigger: CUT_PROMPT_TEETH.has('4d') },
  { value: '2d', label: '2 dientes', cutTrigger: CUT_PROMPT_TEETH.has('2d') },
] as const;

/** Etiqueta es-AR de un valor de dientes (fallback al valor crudo si no está en el catálogo). */
export function teethLabel(value: string): string {
  return TEETH_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
