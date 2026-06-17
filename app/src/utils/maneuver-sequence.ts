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
import type { CustomUiComponent } from './custom-field';
import { describeCustomValue, type CustomCaptureValue } from './custom-render';

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

/**
 * Una MANIOBRA CUSTOM enabled de un rodeo (spec 03 M5-C.3, R13.8): su field_definition_id + el ui_component
 * que la renderiza + label es-AR + las opciones (si es enum). Es la fuente data-driven del paso custom (el
 * renderer genérico la dibuja por ui_component, escribe a custom_measurements). Espeja EnabledCustomManeuver
 * del service (custom-fields.ts) pero enriquecida con ui_component/options (lo que el render necesita).
 */
export type CustomManeuverSpec = {
  fieldDefinitionId: string;
  uiComponent: CustomUiComponent;
  label: string;
  /** Opciones del enum (enum_single/enum_multi); [] para los demás. */
  options: string[];
};

/** Mapa maniobra → valor capturado (o ausente). El frame lo mantiene en estado y lo persiste por paso. */
export type CaptureMap = Partial<Record<ManeuverKind, StepValue>>;

/** Mapa field_definition_id → valor custom capturado. Paralelo al CaptureMap de las de fábrica. */
export type CustomCaptureMap = Record<string, CustomCaptureValue>;

// ─── (a) La secuencia de pasos del animal (orden de config ∩ gating del rodeo real) ─────────────

/**
 * Un ÍTEM de la secuencia, unión discriminada por `source` (spec 03 M5-C.3 generaliza M2.2): una maniobra de
 * FÁBRICA (las 12, por ManeuverKind) o una CUSTOM (por field_definition_id, renderer genérico). El contador
 * "· 2 de 4" (R5.14) es COMBINADO (fábrica + custom). Antes era `SequenceStep` (solo factory); se conserva el
 * alias `SequenceStep` = el item de fábrica para no romper a quien lo importe puntual.
 */
export type SequenceItem =
  | {
      source: 'factory';
      maneuver: ManeuverKind;
      /** Posición 1-based en la secuencia FILTRADA combinada (la que el operario ve). */
      position: number;
      /** Total de pasos de la secuencia filtrada combinada. */
      total: number;
    }
  | {
      source: 'custom';
      custom: CustomManeuverSpec;
      position: number;
      total: number;
    };

/** @deprecated usar SequenceItem (source:'factory'). Alias retrocompat para los call-sites de fábrica. */
export type SequenceStep = Extract<SequenceItem, { source: 'factory' }>;

/** Clave estable de un ítem para el CaptureMap/keys de React: ManeuverKind (fábrica) o `c:<id>` (custom). */
export function sequenceItemKey(item: SequenceItem): string {
  return item.source === 'factory' ? item.maneuver : `c:${item.custom.fieldDefinitionId}`;
}

/**
 * Construye la secuencia ORDENADA COMBINADA de pasos a presentar para un animal (R5.14): primero las maniobras
 * de FÁBRICA de la sesión EN EL ORDEN de `config.maniobras`, quedándose SOLO con las que aplican al rodeo real
 * (`applicable`, gating R5.5) y SIN reordenar; LUEGO las maniobras CUSTOM enabled del rodeo (`customEnabled`,
 * en su orden de `config.customManiobras`). El contador es combinado (fábrica + custom). Deduplica fábrica
 * (defensivo) y custom (por field_definition_id). Una de `ordered` que no esté en `applicable` se OMITE (R5.5);
 * las custom NO se filtran por aplicabilidad de atributos (el gating del rodeo + capa 2 son su barrera).
 *
 * ADITIVO: con `customEnabled` vacío (lo normal hasta que un campo cree maniobras custom) la secuencia es
 * IDÉNTICA a la de las 12 de fábrica (cero regresión).
 */
export function buildSequence(
  ordered: readonly ManeuverKind[],
  applicable: readonly ManeuverKind[],
  customEnabled: readonly CustomManeuverSpec[] = [],
): SequenceItem[] {
  const applicableSet = new Set<ManeuverKind>(applicable);
  const seenF = new Set<ManeuverKind>();
  const keptFactory: ManeuverKind[] = [];
  for (const m of ordered) {
    if (applicableSet.has(m) && !seenF.has(m)) {
      seenF.add(m);
      keptFactory.push(m);
    }
  }
  const seenC = new Set<string>();
  const keptCustom: CustomManeuverSpec[] = [];
  for (const c of customEnabled) {
    if (c.fieldDefinitionId.length === 0 || seenC.has(c.fieldDefinitionId)) continue;
    seenC.add(c.fieldDefinitionId);
    keptCustom.push(c);
  }
  const total = keptFactory.length + keptCustom.length;
  const items: SequenceItem[] = [];
  let pos = 0;
  for (const maneuver of keptFactory) {
    pos += 1;
    items.push({ source: 'factory', maneuver, position: pos, total });
  }
  for (const custom of keptCustom) {
    pos += 1;
    items.push({ source: 'custom', custom, position: pos, total });
  }
  return items;
}

// ─── (b)/(d) Completitud de la secuencia ────────────────────────────────────────────────────────

/**
 * ¿Se capturó todo lo que DEBE capturarse antes del resumen? Un ítem cuenta como "listo" si tiene un valor en
 * su mapa (las de fábrica en `captured` por ManeuverKind; las custom en `customCaptured` por field_def id). Una
 * secuencia vacía (ninguna maniobra aplica) se considera completa → el resumen muestra "sin maniobras" y deja
 * confirmar (no frena la fila). Las de fábrica PERSISTIBLES no pueden quedar `skipped`. Las custom cuentan si
 * tienen un CustomCaptureValue (el gate de "completo" por ui_component lo hace el paso antes de capturar).
 */
export function isSequenceComplete(
  steps: readonly SequenceItem[],
  captured: CaptureMap,
  customCaptured: CustomCaptureMap = {},
): boolean {
  return steps.every((s) => {
    if (s.source === 'custom') {
      return customCaptured[s.custom.fieldDefinitionId] != null;
    }
    const v = captured[s.maneuver];
    if (!v) return false;
    // Una maniobra persistible no puede quedar "skipped" (sería un dato faltante real).
    if (stepPersists(s.maneuver)) return v.kind !== 'skipped';
    return true;
  });
}

/** El índice del primer paso AÚN sin capturar (para reanudar la secuencia). -1 si está completa. */
export function firstUncapturedIndex(
  steps: readonly SequenceItem[],
  captured: CaptureMap,
  customCaptured: CustomCaptureMap = {},
): number {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.source === 'custom') {
      if (customCaptured[s.custom.fieldDefinitionId] == null) return i;
      continue;
    }
    const v = captured[s.maneuver];
    if (!v) return i;
    if (stepPersists(s.maneuver) && v.kind === 'skipped') return i;
  }
  return -1;
}

// ─── (c) El resumen por animal (R5.9) ───────────────────────────────────────────────────────────

/** Una fila del resumen: la maniobra (label es-AR) + su valor legible + si es corregible (tocable). */
export type SummaryRow = {
  /** ManeuverKind (fábrica) o el field_definition_id (custom). Identifica la fila para corregir. */
  maneuver: string;
  /** `factory` | `custom` — el frame discrimina a qué paso volver al corregir desde el resumen (R5.9). */
  source: 'factory' | 'custom';
  /** Nombre es-AR de la maniobra (R1.6) o el label del dato custom. */
  label: string;
  /** Valor legible es-AR del dato capturado ("Preñada · Cabeza", "385 kg", o el valor custom). */
  value: string;
  /** ¿La fila tiene un dato REAL persistido? Las skipped (fábrica) = false; una custom sin valor = false. */
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
 * Arma las filas del resumen por animal (R5.9): una por cada paso de la secuencia (fábrica + custom), en el
 * MISMO orden de presentación, con su valor legible. Tocar una fila vuelve a su paso para corregir (lo hace el
 * frame). Las de fábrica leen del `captured` (por ManeuverKind); las custom del `customCaptured` (por field_def
 * id) y formatean con describeCustomValue. Una fila sin valor → "Sin cargar".
 */
export function summaryRows(
  steps: readonly SequenceItem[],
  captured: CaptureMap,
  customCaptured: CustomCaptureMap = {},
): SummaryRow[] {
  return steps.map((s) => {
    if (s.source === 'custom') {
      const v = customCaptured[s.custom.fieldDefinitionId];
      return {
        maneuver: s.custom.fieldDefinitionId,
        source: 'custom' as const,
        label: s.custom.label,
        value: describeCustomValue(v),
        captured: v != null,
      };
    }
    const v = captured[s.maneuver];
    return {
      maneuver: s.maneuver,
      source: 'factory' as const,
      label: maneuverLabel(s.maneuver),
      value: describeStepValue(v),
      captured: v != null && v.kind !== 'skipped',
    };
  });
}

// ─── Helper de clasificación (re-export para el frame, sin re-importar dos módulos) ─────────────

export { stepKindFor, stepPersists };
