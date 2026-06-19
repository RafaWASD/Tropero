// Lógica PURA del DISPATCHER de render por maniobra (spec 03 M2.2 → M3.1 generaliza). Sin RN, sin red,
// sin SDK: testeable con node:test (mismo patrón que maneuver-gating.ts / maneuver-config.ts).
//
// El frame de carga rápida (carga.tsx / paso.tsx) es GENÉRICO: recorre las maniobras del animal y, por
// cada una, pregunta a este módulo QUÉ TIPO DE UI la renderiza (`StepKind`). Es el SEAM para que M3.2
// enchufe las pantallas SIN reescribir el frame — solo se agrega el case en el switch del renderer por
// `StepKind`. M3.1 ASIGNA el StepKind correcto a CADA maniobra (define los kinds); las PANTALLAS de cada
// kind son M3.2 (este módulo NO construye componentes — solo el mapeo dominio→tipo-de-UI).

import { ALL_MANEUVERS, type ManeuverKind } from './maneuver-gating';

/**
 * El TIPO DE UI con el que el frame renderiza una maniobra. Es una capa de PRESENTACIÓN sobre el
 * `ManeuverKind` del dominio: varias maniobras distintas comparten un mismo `StepKind` cuando su captura
 * es del mismo tipo (p. ej. `pesaje` y `pesaje_ternero` → mismo keypad; `antiparasitario` y `antibiotico`
 * → mismo silent_apply de un producto). Los kinds (M3.2 los renderiza):
 *
 *   - `tacto`         : decisión binaria PREÑADA/VACÍA (paso 1) + tamaño condicional Cabeza/Cuerpo/Cola
 *                       (paso 2 si PREÑADA). Persiste UN `reproductive_events` (event_type='tacto'). (R6.2)
 *   - `vaquillona`    : selector apta/no_apta/diferida → `reproductive_events`
 *                       (event_type='tacto_vaquillona', heifer_fitness). (R6.3/R5.13)
 *   - `pesaje`        : keypad numérico es-AR → `weight_events`. (R6.9/R6.10; pesaje + pesaje_ternero)
 *   - `score`         : selector 1.00–5.00 step 0.25 → `condition_score_events`. (R6.6)
 *   - `silent_single` : silent_apply de UN producto (texto libre + autocompletar) → `sanitary_events`.
 *                       Antiparasitario (deworming, R6.13) + Antibiótico (treatment, R6.15). (UNA maniobra
 *                       c/u, SIN sub-elección interno/externo — D10.)
 *   - `silent_multi`  : silent_apply de N productos (multi-vacuna) → N `sanitary_events`
 *                       (event_type='vaccination'). (R6.1)
 *   - `inseminacion`  : selector de pajuela (1 → popup info; >1 → selector) → `reproductive_events`
 *                       (event_type='service', service_type IA). (R6.5)
 *   - `lab_single`    : captura de UN número de tubo → un `lab_samples` (sample_type='blood'). Sangrado
 *                       brucelosis. (R6.4)
 *   - `lab_double`    : captura de DOS números de tubo → dos `lab_samples` (scrape_tricho + scrape_campylo).
 *                       Raspado de toros (solo machos, R6.12). (R6.11)
 *   - `dientes`       : selector de estado dentario → UPDATE `animal_profiles.teeth_state`; si 1/2 · 1/4 ·
 *                       sin_dientes → prompt CUT (no para terneros, R6.8). (R6.7/R6.8)
 *   - `rueda`         : rueda inercial (wheel picker) de CIRCUNFERENCIA ESCROTAL (CE) del toro + edad en
 *                       meses (snapshot) → `scrotal_measurements` (tabla typed, R14.5/R14.9). FACTORY-ONLY:
 *                       el render genérico de M5 custom NO lo usa (las custom caen a su CustomManeuverStep
 *                       por ui_component, no por StepKind). (R14.1/R14.5)
 *
 * NOTA: NO hay `placeholder` en M3.1 — todas las maniobras del catálogo tienen su StepKind real. El default
 * de `stepKindFor` (defensivo, ante un valor del jsonb pass-through fuera del catálogo) cae a `silent_single`
 * (el más inocuo: pide un producto y persiste un sanitary_event que el gating capa 2 re-valida).
 */
export type StepKind =
  | 'tacto'
  | 'vaquillona'
  | 'pesaje'
  | 'score'
  | 'silent_single'
  | 'silent_multi'
  | 'inseminacion'
  | 'lab_single'
  | 'lab_double'
  | 'dientes'
  // Circunferencia escrotal (R14.5): rueda inercial + edad. FACTORY-ONLY (el render custom de M5 no lo usa).
  | 'rueda';

/**
 * Mapeo ManeuverKind → StepKind (R5.4, destino de UI). Exhaustivo sobre las 13 maniobras del catálogo
 * (M3.1 cablea TODAS; s27 sumó circunferencia_escrotal → 'rueda'). M3.2 agrega el `case` de cada StepKind
 * en el renderer del paso; el frame no cambia.
 */
const STEP_KIND_BY_MANEUVER: Record<ManeuverKind, StepKind> = {
  tacto: 'tacto',
  tacto_vaquillona: 'vaquillona',
  sangrado: 'lab_single',
  vacunacion: 'silent_multi',
  inseminacion: 'inseminacion',
  condicion_corporal: 'score',
  dientes: 'dientes',
  pesaje: 'pesaje',
  pesaje_ternero: 'pesaje',
  raspado: 'lab_double',
  antiparasitario: 'silent_single',
  antibiotico: 'silent_single',
  // Circunferencia escrotal (R14.5): rueda inercial de CE + edad → scrotal_measurements. Factory-only.
  circunferencia_escrotal: 'rueda',
};

/**
 * Devuelve el `StepKind` con el que el frame renderiza una maniobra. Default defensivo `silent_single`:
 * un valor desconocido (jsonb pass-through fuera del catálogo) NO rompe la secuencia — se renderiza como un
 * silent_apply de producto y persiste un sanitary_event que el gating capa 2 re-valida server-side. Cuando
 * M3.2 implemente el renderer, lee este StepKind para elegir el componente.
 */
export function stepKindFor(maneuver: ManeuverKind): StepKind {
  return STEP_KIND_BY_MANEUVER[maneuver] ?? 'silent_single';
}

/**
 * ¿La maniobra PERSISTE un evento/escritura? En M3.1 TODAS las maniobras del catálogo persisten (cada una
 * tiene su write-path real). Se conserva el predicado (lo usa el frame / la secuencia de M2.2) y queda
 * `true` para toda maniobra conocida; un valor fuera del catálogo (defensivo) también persiste por su
 * default silent_single. La secuencia ya no tiene maniobras "skipped por no estar cableadas" (M2.2) — el
 * único skip real es per-animal (raspado en hembra, R6.12), que NO es este predicado sino la aplicabilidad
 * pura (maneuver-applicability.ts).
 */
export function stepPersists(_maneuver: ManeuverKind): boolean {
  return true;
}
