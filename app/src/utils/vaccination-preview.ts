// Preview PURO de la VACUNACIÓN masiva (spec 10, T-UI.6 / R4.2, R4.3, R4.4, R6.3, R7.2). SIN I/O, SIN
// RN/expo/supabase: testeable con node:test (mismo patrón que bulk-candidates / bulk-selection /
// bulk-idempotency). La I/O (resolver los ids ya aplicados del SQLite local + el gating por rodeo) vive
// en la pantalla / el service; acá solo se COMPUTA el conteo del preview + el skip-and-report.
//
// MODELO Gate 0 ORIGINAL (R4.1, "vacunación NO cambia"): el conjunto candidato = todos los activos del
// grupo + filtro opcional por categoría/sexo (eso ya lo resolvió buildBulkCandidates('vaccinate', …)
// antes de llamar acá). Sobre ese conjunto, el preview separa (R4.3, skip-and-report):
//   - toApply       → los que SÍ reciben evento (M animales → N=M eventos, 1 por animal — R3.1).
//   - alreadyApplied → ya tienen un `vaccination` de esa fecha localmente (idempotencia, R6.3/R4.3): su
//                      id determinístico (UUIDv5) ya está en el SQLite. Re-ejecutar la masiva NO duplica.
//   - rodeoDisabled  → (lote cross-rodeo, R7.2) su rodeo real NO tiene `vacunacion` habilitado → el
//                      gating capa 2 (0054, fail-closed) los rechazaría server-side; los SALTAMOS de
//                      entrada para no crear una mutación condenada (R4.4).
//
// El orden de precedencia de los skips es FIJO y determinístico: primero rodeoDisabled (no se puede
// vacunar ahí, independientemente del estado), luego alreadyApplied (ya está hecho). Así un animal de
// rodeo deshabilitado que además ya tuviera el evento se cuenta UNA sola vez (en rodeoDisabled) — sin
// doble-conteo en los totales del preview.

import { bulkEventId } from './bulk-idempotency';
import type { GroupProfile } from './bulk-candidates';

/** Desglose del skip-and-report del preview (R4.3): cuántos se saltan y por qué. */
export type VaccinationSkips = {
  /** Ya tienen un `vaccination` de esta fecha localmente (idempotencia, R6.3). */
  alreadyApplied: number;
  /** (Lote cross-rodeo, R7.2) su rodeo real no tiene `vacunacion` habilitado → gating capa 2 los rechaza. */
  rodeoDisabled: number;
};

/** Resultado del preview de la vacunación masiva (R4.2/R4.3/R4.4). */
export type VaccinationPreview = {
  /** Perfiles que SÍ reciben evento (el conjunto a aplicar — R4.4: solo estos se encolan). */
  toApply: GroupProfile[];
  /** Cantidad de animales a vacunar (M). En vacunación N eventos = M animales (1 por animal — R3.1). */
  animalsToApply: number;
  /** Cantidad de eventos a crear (N == M en vacunación; ambos por fidelidad al copy del spec). */
  eventsToApply: number;
  /** Total del conjunto candidato (antes de los skips) — para el "de M, K saltados". */
  totalCandidates: number;
  /** Skips agrupados por motivo (R4.3). */
  skipped: VaccinationSkips;
  /** Total de saltados (alreadyApplied + rodeoDisabled). */
  skippedTotal: number;
};

/**
 * Computa el preview de la vacunación masiva (R4.2/R4.3/R4.4/R6.3/R7.2) sobre el conjunto `candidates`
 * (ya filtrado por categoría/sexo por buildBulkCandidates, R4.1).
 *
 * `existingEventIds` = ids de `vaccination` ya aplicados localmente de estos perfiles en `eventDate` (el
 * caller los lee del SQLite con buildExistingVaccinationIdsQuery). Un candidato cuyo id determinístico
 * (UUIDv5 sobre (profileId, 'vaccination', eventDate)) ya está en ese set → alreadyApplied (R6.3).
 *
 * `rodeoVaccinationEnabled` = predicado `(rodeoId) => boolean` del gating de cada rodeo (lote cross-rodeo,
 * R7.2). Si NO se pasa (rodeo único ya gateado por la vista de grupo, o gating irresoluble offline), NO
 * se excluye a nadie por rodeo (fail-open de DISPLAY — la barrera real es el gating capa 2 server-side).
 *
 * PURA: no toca red ni SQLite. Determinística: mismo input ⇒ mismo output (orden de toApply preservado).
 */
export function buildVaccinationPreview(
  candidates: readonly GroupProfile[],
  eventDate: string,
  existingEventIds: ReadonlySet<string>,
  rodeoVaccinationEnabled?: (rodeoId: string) => boolean,
): VaccinationPreview {
  const toApply: GroupProfile[] = [];
  let alreadyApplied = 0;
  let rodeoDisabled = 0;

  for (const p of candidates) {
    // 1) rodeoDisabled tiene PRECEDENCIA: si el rodeo no vacuna, no importa si ya estaba aplicado.
    if (rodeoVaccinationEnabled && !rodeoVaccinationEnabled(p.rodeoId)) {
      rodeoDisabled += 1;
      continue;
    }
    // 2) alreadyApplied: su id determinístico ya está localmente (idempotencia, R6.3).
    const id = bulkEventId({ animalProfileId: p.profileId, type: 'vaccination', date: eventDate });
    if (existingEventIds.has(id)) {
      alreadyApplied += 1;
      continue;
    }
    toApply.push(p);
  }

  const skippedTotal = alreadyApplied + rodeoDisabled;
  return {
    toApply,
    animalsToApply: toApply.length,
    eventsToApply: toApply.length, // 1 evento por animal (R3.1)
    totalCandidates: candidates.length,
    skipped: { alreadyApplied, rodeoDisabled },
    skippedTotal,
  };
}

/** Opción de filtro de categoría derivada del conjunto candidato (R4.1): code + name legible + conteo. */
export type CategoryFilterOption = {
  /** category_code del catálogo (el valor del filtro). */
  code: string;
  /** name legible es-AR (del espejo C6) para mostrar en el chip. */
  name: string;
  /** Cuántos animales activos del grupo tienen esa categoría (para el chip "Terneros (12)"). */
  count: number;
};

/**
 * Deriva las opciones de filtro por CATEGORÍA del conjunto de animales activos del grupo (R4.1): solo las
 * categorías REALMENTE presentes (offline-correct, sin resolver el catálogo del sistema). Orden ESTABLE:
 * primera aparición (preserva el orden de la lista, que ya viene ordenada por el service). El `name` se
 * toma del primer animal de esa categoría (display del espejo C6). PURA.
 */
export function deriveCategoryFilterOptions(
  profiles: readonly { categoryCode: string; categoryName?: string }[],
): CategoryFilterOption[] {
  const byCode = new Map<string, CategoryFilterOption>();
  for (const p of profiles) {
    const existing = byCode.get(p.categoryCode);
    if (existing) {
      existing.count += 1;
    } else {
      byCode.set(p.categoryCode, {
        code: p.categoryCode,
        name: p.categoryName && p.categoryName.length > 0 ? p.categoryName : p.categoryCode,
        count: 1,
      });
    }
  }
  return [...byCode.values()];
}
