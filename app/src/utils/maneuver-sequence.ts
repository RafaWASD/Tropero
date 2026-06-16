// Lógica PURA del FRAME de carga rápida (spec 03 M2.2): construye la SECUENCIA de pasos de un animal y
// arma el RESUMEN corregible. Sin RN, sin red, sin SDK: testeable con node:test (mismo patrón que
// maneuver-gating.ts / maneuver-wizard.ts).
//
// El frame (carga.tsx) recorre las maniobras de la sesión EN ORDEN (R5.14, `config.maniobras`), salteando
// las que NO aplican al rodeo real del animal (R5.5) SIN reordenar las que sí. Este módulo:
//   (a) `buildSequence`: produce la lista ORDENADA de maniobras a presentar para ESTE animal (orden de la
//       config ∩ gating del rodeo real), con su índice/total para el contador "Tacto · 2 de 4" (R5.14).
//   (b) tipos del VALOR capturado por maniobra (`StepValue`) + el mapa de captura (`CaptureMap`).
//   (c) `summaryRows`: arma las filas del resumen por animal (cada maniobra + su valor legible, R5.9).
//   (d) `isSequenceComplete`: ¿se capturaron todas las maniobras persistibles? (gate para el resumen).
//
// El orden es PRESENTACIÓN pura (R5.14): NO toca el gating ni qué maniobras aplican. Estas funciones solo
// filtran/ordenan/leen — no hacen I/O.

import type { ManeuverKind } from './maneuver-gating';
import { maneuverLabel } from './maneuver-wizard';
import { stepKindFor, stepPersists } from './maneuver-step-kind';

// ─── El valor capturado por una maniobra ──────────────────────────────────────────────────────

/** Resultado del tacto de vaca (R6.2): vacía o preñada con tamaño (Cola/Cuerpo/Cabeza). */
export type PregnancyStatus = 'empty' | 'small' | 'medium' | 'large';

/** Aptitud de la vaquillona en el tacto vaquillona (R6.3 / heifer_fitness 0053). */
export type HeiferFitness = 'apta' | 'no_apta' | 'diferida';

/** event_type sanitario silent_apply de UN producto: antiparasitario (deworming) / antibiótico (treatment). */
export type SilentSanitaryType = 'deworming' | 'treatment';

/**
 * El valor capturado de UN paso, unión discriminada por su `kind` (alineado al StepKind del dispatcher,
 * maneuver-step-kind.ts). M3.1 cablea TODAS las maniobras del catálogo (M2.2 solo tacto/pesaje):
 *   - `tacto`        → `{ pregnancy }` — un único reproductive_events (R6.2).
 *   - `pesaje`       → `{ weightKg }` — weight_events (R6.9/R6.10).
 *   - `vaquillona`   → `{ fitness }` — reproductive_events tacto_vaquillona + heifer_fitness (R6.3).
 *   - `score`        → `{ score }` — condition_score_events (R6.6; 1.00–5.00 step 0.25).
 *   - `sanitary`     → `{ eventType, productName }` — sanitary_events deworming|treatment, silent_apply
 *                      (R6.13/R6.15; UNA maniobra c/u, SIN interno/externo — D10).
 *   - `vaccination`  → `{ products }` — N sanitary_events vaccination (R6.1, multi-vacuna).
 *   - `inseminacion` → `{ semenName }` — reproductive_events service_type='ai' (R6.5).
 *   - `lab`          → `{ tubeNumber }` — un lab_samples sample_type='blood' (sangrado, R6.4).
 *   - `lab_double`   → `{ tubeTricho, tubeCampylo }` — dos lab_samples scrape_* (raspado, R6.11).
 *   - `dientes`      → `{ teethState, cut }` — UPDATE animal_profiles.teeth_state (+ CUT, R6.7/R6.8).
 *   - `skipped`      → maniobra NO capturada (M2.2 placeholder / un paso que el operario salta). NO persiste.
 * `null`/ausente en el mapa = aún sin capturar.
 */
export type StepValue =
  | { kind: 'tacto'; pregnancy: PregnancyStatus }
  | { kind: 'pesaje'; weightKg: number }
  | { kind: 'vaquillona'; fitness: HeiferFitness }
  | { kind: 'score'; score: number }
  | { kind: 'sanitary'; eventType: SilentSanitaryType; productName: string }
  | { kind: 'vaccination'; products: readonly string[] }
  | { kind: 'inseminacion'; semenName: string }
  | { kind: 'lab'; tubeNumber: string }
  | { kind: 'lab_double'; tubeTricho: string; tubeCampylo: string }
  | { kind: 'dientes'; teethState: string; cut: boolean }
  | { kind: 'skipped' };

/** Mapa maniobra → valor capturado (o ausente). El frame lo mantiene en estado y lo persiste por paso. */
export type CaptureMap = Partial<Record<ManeuverKind, StepValue>>;

// ─── (a) La secuencia de pasos del animal (orden de config ∩ gating del rodeo real) ─────────────

/** Un paso de la secuencia: la maniobra + su posición 1-based para el contador "Tacto · 2 de 4" (R5.14). */
export type SequenceStep = {
  maneuver: ManeuverKind;
  /** Posición 1-based en la secuencia FILTRADA (la que el operario ve). */
  position: number;
  /** Total de pasos de la secuencia filtrada. */
  total: number;
};

/**
 * Construye la secuencia ORDENADA de pasos a presentar para un animal: las maniobras de la sesión EN EL
 * ORDEN de `config.maniobras` (R5.14), quedándose SOLO con las que aplican al rodeo real del animal
 * (`applicable`, resuelto por el gating R5.5) y SIN reordenar. `applicable` puede venir desordenado o con
 * extras: el orden lo manda `ordered`, el filtro lo manda el set de `applicable`. Deduplica (defensivo: el
 * jsonb es pass-through, ya viene dedupeado por extractManeuvers, pero no se confía). Una maniobra de
 * `ordered` que no esté en `applicable` se OMITE (R5.5).
 */
export function buildSequence(
  ordered: readonly ManeuverKind[],
  applicable: readonly ManeuverKind[],
): SequenceStep[] {
  const applicableSet = new Set<ManeuverKind>(applicable);
  const seen = new Set<ManeuverKind>();
  const kept: ManeuverKind[] = [];
  for (const m of ordered) {
    if (applicableSet.has(m) && !seen.has(m)) {
      seen.add(m);
      kept.push(m);
    }
  }
  const total = kept.length;
  return kept.map((maneuver, i) => ({ maneuver, position: i + 1, total }));
}

// ─── (b)/(d) Completitud de la secuencia ────────────────────────────────────────────────────────

/**
 * ¿Se capturó todo lo que DEBE capturarse antes del resumen? Una maniobra cuenta como "lista" si tiene un
 * valor en el mapa (`tacto`/`pesaje` con su dato, o `skipped` para las de M3). Una secuencia vacía (ninguna
 * maniobra aplica) se considera completa → el resumen muestra "sin maniobras" y deja confirmar (no frena la
 * fila). Las maniobras PERSISTIBLES (tacto/pesaje) deben tener un valor REAL (no `skipped`) para contar.
 */
export function isSequenceComplete(steps: readonly SequenceStep[], captured: CaptureMap): boolean {
  return steps.every((s) => {
    const v = captured[s.maneuver];
    if (!v) return false;
    // Una maniobra persistible no puede quedar "skipped" (sería un dato faltante real).
    if (stepPersists(s.maneuver)) return v.kind !== 'skipped';
    return true;
  });
}

/** El índice del primer paso AÚN sin capturar (para reanudar la secuencia). -1 si está completa. */
export function firstUncapturedIndex(steps: readonly SequenceStep[], captured: CaptureMap): number {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const v = captured[s.maneuver];
    if (!v) return i;
    if (stepPersists(s.maneuver) && v.kind === 'skipped') return i;
  }
  return -1;
}

// ─── (c) El resumen por animal (R5.9) ───────────────────────────────────────────────────────────

/** Una fila del resumen: la maniobra (label es-AR) + su valor legible + si es corregible (tocable). */
export type SummaryRow = {
  maneuver: ManeuverKind;
  /** Nombre es-AR de la maniobra (R1.6). */
  label: string;
  /** Valor legible es-AR del dato capturado ("Preñada · Cabeza", "385 kg", "Pendiente (M3)"). */
  value: string;
  /** ¿La fila tiene un dato REAL persistido? (tacto/pesaje capturados). Las skipped = false. */
  captured: boolean;
};

/** Etiquetas de campo es-AR de los tamaños de preñez (as-built dominio Facundo §4, event-timeline). */
const PREGNANCY_SIZE_LABEL: Record<Exclude<PregnancyStatus, 'empty'>, string> = {
  small: 'Cola',
  medium: 'Cuerpo',
  large: 'Cabeza',
};

/** Etiquetas es-AR de la aptitud de vaquillona (R6.3). */
const HEIFER_FITNESS_LABEL: Record<HeiferFitness, string> = {
  apta: 'Apta',
  no_apta: 'No apta',
  diferida: 'Diferida',
};

/** Etiquetas es-AR del estado dentario (subset relevante para el resumen; espeja humanizeTeeth). */
const TEETH_LABEL: Record<string, string> = {
  '2d': '2 dientes',
  '4d': '4 dientes',
  '6d': '6 dientes',
  boca_llena: 'Boca llena',
  '3/4': '3/4',
  '1/2': '1/2',
  '1/4': '1/4',
  sin_dientes: 'Sin dientes',
};

/** Texto legible es-AR del valor de un paso, para el resumen (R5.9). es-AR en los números (coma decimal). */
export function describeStepValue(value: StepValue | undefined): string {
  if (!value) return 'Sin cargar';
  switch (value.kind) {
    case 'tacto':
      return value.pregnancy === 'empty'
        ? 'Vacía'
        : `Preñada · ${PREGNANCY_SIZE_LABEL[value.pregnancy]}`;
    case 'pesaje':
      // es-AR: coma decimal + punto de miles (memoria reference_es_ar_number_format). 385 → "385 kg".
      return `${value.weightKg.toLocaleString('es-AR')} kg`;
    case 'vaquillona':
      return HEIFER_FITNESS_LABEL[value.fitness];
    case 'score':
      // es-AR: coma decimal (3.5 → "3,5"); selector cerrado 1.00–5.00 step 0.25.
      return value.score.toLocaleString('es-AR', { minimumFractionDigits: 2 });
    case 'sanitary':
      return value.productName.trim() || 'Aplicado';
    case 'vaccination':
      return value.products.length > 0 ? value.products.join(', ') : 'Aplicada';
    case 'inseminacion':
      return value.semenName.trim() || 'Inseminada';
    case 'lab':
      return value.tubeNumber.trim() ? `Tubo ${value.tubeNumber.trim()}` : 'Muestra tomada';
    case 'lab_double': {
      const t = value.tubeTricho.trim();
      const c = value.tubeCampylo.trim();
      return `Trico ${t || '—'} · Campylo ${c || '—'}`;
    }
    case 'dientes':
      return (TEETH_LABEL[value.teethState] ?? value.teethState) + (value.cut ? ' · CUT' : '');
    case 'skipped':
      return 'Sin cargar';
    default:
      return 'Sin cargar';
  }
}

/**
 * Arma las filas del resumen por animal (R5.9): una por cada paso de la secuencia, en el MISMO orden de
 * presentación, con su valor legible. Tocar una fila vuelve a su paso para corregir (lo hace el frame). Una
 * fila sin valor capturado se muestra "Sin cargar" (no debería pasar si la secuencia está completa).
 */
export function summaryRows(steps: readonly SequenceStep[], captured: CaptureMap): SummaryRow[] {
  return steps.map((s) => {
    const v = captured[s.maneuver];
    return {
      maneuver: s.maneuver,
      label: maneuverLabel(s.maneuver),
      value: describeStepValue(v),
      captured: v != null && v.kind !== 'skipped',
    };
  });
}

// ─── Helper de clasificación (re-export para el frame, sin re-importar dos módulos) ─────────────

export { stepKindFor, stepPersists };
