// Lógica PURA del binding maniobra→write(s) (spec 03 — orquestador de eventos de maniobra; M2.2 esqueleto,
// M3.1 generaliza a las 12). Sin RN, sin red, sin SDK: testeable con node:test. Vive en utils (no en
// services) PORQUE el service `maneuver-events.ts` importa `runLocalWrite` (que arrastra el SDK de
// PowerSync) y NO puede entrar al grafo de node:test — la parte PURA (qué INSERT/UPDATE produce cada
// maniobra) se aísla acá, igual que los SQL builders de local-reads.ts.
//
// Dado un animal + sesión + maniobra + valor capturado, produce el/los `LocalQuery` del/los write(s) del
// evento de spec 02 correcto(s), inyectando `session_id` (R5.11). Devuelve un ARRAY de writes:
//   - 0 writes  → la maniobra no persiste (valor `skipped`, o un caso sin dato — el caller avanza sin escribir).
//   - 1 write   → el caso típico (un evento / un UPDATE de propiedad).
//   - 2 writes  → raspado de toros (R6.11: dos lab_samples) o vacunación multi-vacuna (R6.1: N sanitary_events).
//
// La CORRECCIÓN desde el resumen (R5.9, `isCorrection`) re-captura con el MISMO id → UPDATE de la columna de
// dato (no un 2do INSERT) — split INSERT/UPDATE igual que M2.2.

import {
  buildAddWeightInsert,
  buildAddTactoInsert,
  buildUpdateManeuverWeight,
  buildUpdateManeuverTacto,
  buildAddManeuverSanitaryInsert,
  buildUpdateManeuverSanitary,
  buildAddManeuverVaccinationInsert,
  buildAddManeuverConditionScoreInsert,
  buildUpdateManeuverConditionScore,
  buildAddManeuverTactoVaquillonaInsert,
  buildUpdateManeuverTactoVaquillona,
  buildAddManeuverInseminationInsert,
  buildUpdateManeuverInsemination,
  buildAddManeuverLabSampleInsert,
  buildUpdateManeuverLabSample,
  buildSetTeethStateUpdate,
  buildSetCutUpdate,
  buildUnsetCutUpdate,
  buildAddScrotalInsert,
  buildUpdateManeuverScrotal,
  type LocalQuery,
} from '../services/powersync/local-reads';
import type { StepValue } from './maneuver-sequence';
import type { ManeuverKind } from './maneuver-gating';

/**
 * Entrada para construir el/los write(s) de un evento de maniobra. `eventDate` ISO 'YYYY-MM-DD';
 * `createdAt` ISO ts.
 */
export type ManeuverEventInput = {
  maneuver: ManeuverKind;
  value: StepValue;
  /** Perfil del animal identificado (real, del contexto de la manga). */
  profileId: string;
  /** Sesión de la jornada de manga (R5.11). */
  sessionId: string;
  /** Fecha del evento (ISO 'YYYY-MM-DD'). */
  eventDate: string;
  /** Timestamp de creación de cliente (ISO) — desempate determinístico de reproductivos. */
  createdAt: string;
  /**
   * id(s) de cliente del/los evento(s) (crypto.randomUUID). Para las maniobras de 1 write, se usa
   * `eventId`/`eventIds[0]`. Para raspado (2 lab_samples) se usan `eventIds[0]` (scrape_tricho) y
   * `eventIds[1]` (scrape_campylo). Para vacunación multi, uno por vacuna. El caller los pasa → testeable
   * sin azar. Para dientes/CUT (UPDATE de animal_profiles) el id es el del PERFIL (`profileId`), NO se usa
   * `eventId`.
   */
  eventId: string;
  /** ids adicionales para las maniobras multi-write (raspado: [tricho, campylo]; vacunación: uno por vacuna). */
  eventIds?: readonly string[];
  /**
   * ¿Es una CORRECCIÓN de un evento YA persistido (R5.9, re-captura desde el resumen)? Si sí → UPDATE de la
   * fila existente (mismo id), rastreado por PowerSync como PATCH; si no → INSERT (1ra captura). Default
   * false. Para las maniobras multi-write (raspado/vacunación) la corrección NO se cubre acá (M3.2 re-captura
   * borrando+recargando; ver nota en cada rama).
   */
  isCorrection?: boolean;
  /**
   * Para la maniobra DIENTES (R6.7/R6.8): el `category_id` a fijar. Si el operario confirma CUT → el id de la
   * categoría CUT del sistema; si REVIERTE CUT → el id de la categoría derivada (sin CUT). Lo resuelve el
   * caller del catálogo local. Si no viene y el valor pide CUT, el write de CUT se OMITE (solo se setea
   * teeth_state) — fail-safe (no se fija una categoría inválida).
   */
  cutCategoryId?: string | null;
};

/**
 * Arma el/los `LocalQuery` del/los write(s) del evento de una maniobra, inyectando `session_id` (R5.11).
 * Ramifica por el `kind` del VALOR (no por la maniobra — el valor es la fuente de verdad de lo capturado,
 * defensivo ante el jsonb pass-through). Devuelve un ARRAY (0/1/2 writes). Las maniobras:
 *   - tacto        → 1× reproductive_events (R6.2). Corrección → UPDATE pregnancy_status.
 *   - pesaje       → 1× weight_events (R6.9/R6.10). Corrección → UPDATE weight_kg.
 *   - vaquillona   → 1× reproductive_events tacto_vaquillona + heifer_fitness (R6.3). Corrección → UPDATE.
 *   - score        → 1× condition_score_events (R6.6). Corrección → UPDATE score.
 *   - sanitary     → 1× sanitary_events deworming|treatment, silent_apply (R6.13/R6.15). Corrección → UPDATE.
 *   - vaccination  → N× sanitary_events vaccination (R6.1, uno por vacuna). Sin corrección in-place (M3.2).
 *   - inseminacion → 1× reproductive_events service ai (R6.5). Corrección → UPDATE notes.
 *   - lab          → 1× lab_samples blood (sangrado, R6.4). Corrección → UPDATE tube_number.
 *   - lab_double   → 2× lab_samples scrape_tricho + scrape_campylo (raspado, R6.11). Sin corrección in-place.
 *   - dientes      → 1× UPDATE animal_profiles.teeth_state (R6.7) + (si cut) 1× UPDATE is_cut/category (R6.8).
 *   - scrotal      → 1× scrotal_measurements (CE + edad snapshot, R14.10). Corrección → UPDATE cm/age/date.
 *   - skipped      → [] (no persiste).
 */
export function buildManeuverEventQueries(input: ManeuverEventInput): LocalQuery[] {
  const { value, profileId, sessionId, eventDate, createdAt, eventId, eventIds, isCorrection } = input;
  switch (value.kind) {
    case 'tacto':
      // Un único reproductive_events (R6.2). pregnancy_status de un selector CERRADO → enum válido al subir.
      return [
        isCorrection
          ? buildUpdateManeuverTacto(eventId, value.pregnancy, eventDate)
          : buildAddTactoInsert(eventId, profileId, value.pregnancy, eventDate, null, createdAt, sessionId),
      ];

    case 'pesaje':
      // weight_events (R6.9). El peso ya validado (> 0) por el caller (keypad acotado).
      return [
        isCorrection
          ? buildUpdateManeuverWeight(eventId, value.weightKg, eventDate)
          : buildAddWeightInsert(eventId, profileId, value.weightKg, eventDate, null, sessionId),
      ];

    case 'vaquillona':
      // tacto_vaquillona + heifer_fitness (R6.3 / R5.13). Selector cerrado apta|no_apta|diferida.
      return [
        isCorrection
          ? buildUpdateManeuverTactoVaquillona(eventId, value.fitness, eventDate)
          : buildAddManeuverTactoVaquillonaInsert(
              eventId, profileId, value.fitness, eventDate, createdAt, sessionId,
            ),
      ];

    case 'score':
      // condition_score_events (R6.6). score de un selector CERRADO 1.00–5.00 step 0.25.
      return [
        isCorrection
          ? buildUpdateManeuverConditionScore(eventId, value.score, eventDate)
          : buildAddManeuverConditionScoreInsert(eventId, profileId, value.score, eventDate, sessionId),
      ];

    case 'sanitary':
      // Antiparasitario (deworming) / Antibiótico (treatment), silent_apply (R6.13/R6.15). UNA maniobra c/u,
      // SIN route/interno-externo (D10). product_name texto libre.
      return [
        isCorrection
          ? buildUpdateManeuverSanitary(eventId, value.productName, eventDate)
          : buildAddManeuverSanitaryInsert(
              eventId, profileId, value.eventType, value.productName, eventDate, sessionId,
            ),
      ];

    case 'vaccination': {
      // Multi-vacuna (R6.1): N sanitary_events vaccination, uno por producto. Cada vacuna su id de cliente
      // (eventId para la 1ra, eventIds[i] para las siguientes). Una corrección de la vacunación (re-elegir
      // las vacunas) la maneja M3.2 borrando+recargando (no hay UPDATE in-place de un set de N filas).
      const products = value.products.filter((p) => p.trim().length > 0);
      return products.map((product, i) => {
        const id = i === 0 ? eventId : (eventIds?.[i - 1] ?? `${eventId}-${i}`);
        return buildAddManeuverVaccinationInsert(id, profileId, product.trim(), eventDate, sessionId);
      });
    }

    case 'inseminacion':
      // reproductive_events service ai (R6.5). La pajuela va en notes (no hay columna estructurada en MVP).
      return [
        isCorrection
          ? buildUpdateManeuverInsemination(eventId, cleanNote(value.semenName), eventDate)
          : buildAddManeuverInseminationInsert(
              eventId, profileId, cleanNote(value.semenName), eventDate, createdAt, sessionId,
            ),
      ];

    case 'lab':
      // Sangrado brucelosis (R6.4): un lab_samples blood con tube_number.
      return [
        isCorrection
          ? buildUpdateManeuverLabSample(eventId, cleanNote(value.tubeNumber), eventDate)
          : buildAddManeuverLabSampleInsert(
              eventId, profileId, 'blood', cleanNote(value.tubeNumber), eventDate, sessionId,
            ),
      ];

    case 'lab_double': {
      // Raspado de toros (R6.11): DOS lab_samples (scrape_tricho + scrape_campylo), dos tube_numbers.
      // id del 1ro = eventId; del 2do = eventIds[0] (fallback derivado, defensivo). La corrección in-place no
      // se cubre acá (M3.2 re-captura borrando+recargando ambos tubos). NO se escribe para hembras (R6.12):
      // ese gate es del cliente (appliesToAnimal) — el orquestador no llega acá con una hembra.
      const trichoId = eventId;
      const campyloId = eventIds?.[0] ?? `${eventId}-campylo`;
      return [
        buildAddManeuverLabSampleInsert(
          trichoId, profileId, 'scrape_tricho', cleanNote(value.tubeTricho), eventDate, sessionId,
        ),
        buildAddManeuverLabSampleInsert(
          campyloId, profileId, 'scrape_campylo', cleanNote(value.tubeCampylo), eventDate, sessionId,
        ),
      ];
    }

    case 'dientes': {
      // Dientes = PROPIEDAD (R6.7): UPDATE animal_profiles.teeth_state (no evento, sin session_id). Si el
      // operario confirmó CUT (R6.8) → 2do UPDATE is_cut/category/override (requiere cutCategoryId). Si
      // REVIERTE CUT (cut=false con un cutCategoryId = la categoría derivada) → UPDATE de revert. El gate
      // "no para terneros" (R6.8) es del cliente (shouldOfferCutPrompt) — el orquestador solo arma el write
      // que el caller pidió.
      const writes: LocalQuery[] = [buildSetTeethStateUpdate(profileId, value.teethState)];
      const catId = cleanNote(input.cutCategoryId);
      if (value.cut && catId) {
        writes.push(buildSetCutUpdate(profileId, catId));
      } else if (!value.cut && catId) {
        // Corrección: desmarcar CUT → revierte categoría a la derivada (consistencia, R6.8).
        writes.push(buildUnsetCutUpdate(profileId, catId));
      }
      return writes;
    }

    case 'scrotal':
      // Circunferencia escrotal (R14.10): un único scrotal_measurements (CE + edad snapshot). cm ∈ [20,50]
      // paso 0,5 (la rueda lo garantiza; el CHECK del DB re-valida al subir). ageMonths null = edad
      // desconocida (R14.7). `establishment_id`/`recorded_by`/`source` los fuerza el trigger/default al
      // subir (R14.9, no se mandan). Corrección desde el resumen (R5.9/R14.17) → UPDATE cm/age/date.
      return [
        isCorrection
          ? buildUpdateManeuverScrotal(eventId, value.circumferenceCm, value.ageMonths, eventDate)
          : buildAddScrotalInsert(
              eventId, profileId, value.circumferenceCm, value.ageMonths, eventDate, sessionId,
            ),
      ];

    case 'skipped':
    default:
      // Maniobra saltada (placeholder M2.2 / paso saltado) → NO persiste (evita un dato inventado).
      return [];
  }
}

/** Trim → null si vacío (para notes/tube/categoría opcionales). */
function cleanNote(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * COMPAT M2.2: la 1ra versión del orquestador esperaba `LocalQuery | null` (1 write o nada). Se conserva
 * para no romper el call-site de `carga.tsx` (M2.2) que persiste un solo write por maniobra. Devuelve el
 * PRIMER write del array (o null si no hay), o lanza si la maniobra produce >1 write (raspado/vacunación-multi
 * NO pasan por este path en M2.2 — caen en placeholder). M3.2 usa `buildManeuverEventQueries` (multi-write).
 */
export function buildManeuverEventQuery(input: ManeuverEventInput): LocalQuery | null {
  const queries = buildManeuverEventQueries(input);
  return queries.length > 0 ? queries[0] : null;
}
