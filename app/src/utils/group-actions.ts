// Lógica PURA del GATING de las acciones masivas de la vista de grupo (spec 10, T-UI.1 / R1.4, R1.5,
// R1.6, R7.1). SIN I/O, SIN RN/expo/supabase: testeable con node:test (mismo patrón que
// bulk-candidates.ts / rodeo-template.ts). La I/O (leer el catálogo + el rodeo_data_config del SQLite
// local) vive en el service / la pantalla; acá solo la DECISIÓN de qué acciones se ofrecen.
//
// Las TRES acciones del MVP (R1.4):
//   - Vacunar   (R1.5): GATEADA por el data_key `vacunacion` enabled en el rodeo. Verbo pelado.
//   - Destetar  (R1.5): GATEADA por el data_key `destete` enabled en el rodeo. Verbo pelado.
//   - Castrar   (R1.5): SIEMPRE disponible (no se gatea — castrado es estado del animal, no dato del
//                rodeo; no existe data_key `castracion`). Verbo pelado.
//
// Mapeo data_key → field_definition_id → enabled (mismo modelo que el gating capa 1 de spec 03 R5.4):
// `rodeo_data_config` guarda (field_definition_id, enabled); el data_key vive en `field_definitions`.
//
// LOTE cross-rodeo (R7.1): la acción gateada se OFRECE si ALGÚN rodeo del lote la tiene habilitada.
// El skip-and-report (vacunación) / la exclusión-de-lista (destete) por rodeo real se resuelve DESPUÉS,
// en el armado de candidatos (bulk-candidates.ts) — acá solo decidimos si el BOTÓN aparece.
//
// GATING POR CANDIDATOS (fix Raf 2026-06-12): además del gating de CONFIG, una acción NO se ofrece si no
// hay a quién aplicársela (evita abrir una pantalla de selección VACÍA). `applyCandidateGating` combina la
// disponibilidad de config con los conteos de candidatos (que el caller computa con `buildBulkCandidates`
// sobre los perfiles del grupo ya cargados):
//   - Vacunar: SIN cambio (aplica a todos los activos → si hay animales, hay candidatos; gateado solo por config).
//   - Destetar: config destete habilitado **Y** ≥1 candidato a destete (pedido explícito de Raf).
//   - Castrar: ≥1 candidato a castración (no se gatea por config — sigue R1.5; el leader extiende el mismo
//     principio de candidatos por consistencia). Un grupo sin machos enteros NO ofrece "Castrar".

/** Los data_keys que gatean acciones masivas (R1.5). Castración NO tiene data_key. */
export const VACCINATION_DATA_KEY = 'vacunacion';
export const WEANING_DATA_KEY = 'destete';

/** Una acción masiva ofrecible en la vista de grupo (R1.4). */
export type GroupAction = 'vaccinate' | 'wean' | 'castrate';

/**
 * Estado efectivo de la plantilla de UN rodeo, reducido a los data_keys que gatean acciones (R1.5).
 * Lo arma el caller cruzando `field_definitions` (data_key → field_definition_id) con
 * `rodeo_data_config` (field_definition_id → enabled) de ese rodeo.
 */
export type RodeoGating = {
  /** ¿`vacunacion` habilitado en este rodeo? */
  vaccinationEnabled: boolean;
  /** ¿`destete` habilitado en este rodeo? */
  weaningEnabled: boolean;
};

/** Resultado del gating: qué acciones ofrece la vista de grupo (R1.4). */
export type GroupActionsAvailability = {
  /**
   * Castrar: no se gatea por CONFIG (R1.5), pero SÍ por CANDIDATOS (fix Raf 2026-06-12): solo si hay ≥1
   * macho entero candidato. `resolveGroupActions` (solo-config) devuelve `true`; `applyCandidateGating`
   * lo reduce a `count.castrate > 0`. Por eso es `boolean`, no el literal `true`.
   */
  castrate: boolean;
  /** Vacunar si el/los rodeo(s) la tienen habilitada (R1.5/R7.1). Sin gating por candidatos. */
  vaccinate: boolean;
  /** Destetar si el/los rodeo(s) la tienen habilitada (R1.5/R7.1) Y hay ≥1 candidato a destete. */
  wean: boolean;
};

/**
 * Conteos de candidatos de las operaciones gateadas por presencia (fix Raf 2026-06-12). Los computa el
 * caller con `buildBulkCandidates` sobre los perfiles del grupo ya cargados (offline). Vacunación NO está
 * acá: aplica a todos los activos (si hay animales, hay candidatos) → se gatea solo por config.
 */
export type GroupCandidateCounts = {
  /** Cuántos machos enteros candidatos a castración hay en el grupo. */
  castrate: number;
  /** Cuántos terneros/as candidatos a destete hay (ya filtrados por rodeo con `destete` en lote cross-rodeo). */
  wean: number;
};

/**
 * Resuelve qué acciones masivas ofrece la vista de un grupo a partir del gating de los rodeos que lo
 * componen (R1.4/R1.5/R1.6/R7.1):
 *   - 1 rodeo (vista de rodeo): `rodeos` tiene un elemento → Vacunar/Destetar según ese rodeo.
 *   - N rodeos (vista de lote cross-rodeo): Vacunar/Destetar si ALGÚN rodeo la tiene (R7.1).
 *   - 0 rodeos (lote vacío / aún sincronizando): solo Castrar (las gateadas requieren al menos un
 *     rodeo habilitado — fail-closed: sin info, no se ofrece la gateada).
 * Castrar `true` acá (R1.5: no se gatea por config). El gating por CANDIDATOS se aplica DESPUÉS con
 * `applyCandidateGating` (fix Raf 2026-06-12). PURA: no toca red ni SQLite.
 */
export function resolveGroupActions(
  rodeos: readonly RodeoGating[],
): GroupActionsAvailability {
  return {
    castrate: true,
    vaccinate: rodeos.some((r) => r.vaccinationEnabled),
    wean: rodeos.some((r) => r.weaningEnabled),
  };
}

/**
 * Reduce la disponibilidad de CONFIG por PRESENCIA DE CANDIDATOS (fix Raf 2026-06-12): no se ofrece una
 * acción que abriría una pantalla de selección vacía. PURA.
 *   - Vacunar: SIN cambio (config; aplica a todos los activos).
 *   - Destetar: config destete habilitado **Y** ≥1 candidato a destete.
 *   - Castrar: ≥1 candidato a castración (no se gatea por config — sigue R1.5; gateado solo por candidatos).
 * Mantiene el gating de config existente (no lo rompe): un `wean=false` de config sigue `false` aunque
 * hubiera candidatos (no habría a dónde mandarlos), y un `vaccinate=false` de config sigue `false`.
 */
export function applyCandidateGating(
  config: GroupActionsAvailability,
  counts: GroupCandidateCounts,
): GroupActionsAvailability {
  return {
    vaccinate: config.vaccinate,
    wean: config.wean && counts.wean > 0,
    castrate: counts.castrate > 0,
  };
}

/**
 * Construye el `RodeoGating` de un rodeo a partir del catálogo (data_key → field_definition_id) y de
 * su `rodeo_data_config` (field_definition_id → enabled). PURA. Si un data_key no existe en el
 * catálogo, o no hay fila en la config para su field, se considera DESHABILITADO (fail-closed, R1.6:
 * sin fila enabled=true → no se ofrece la acción).
 */
export function buildRodeoGating(
  dataKeyToFieldId: ReadonlyMap<string, string>,
  configEnabledByFieldId: ReadonlyMap<string, boolean>,
): RodeoGating {
  return {
    vaccinationEnabled: isDataKeyEnabled(VACCINATION_DATA_KEY, dataKeyToFieldId, configEnabledByFieldId),
    weaningEnabled: isDataKeyEnabled(WEANING_DATA_KEY, dataKeyToFieldId, configEnabledByFieldId),
  };
}

/**
 * ¿El data_key está habilitado en una config de rodeo? data_key → field_definition_id (catálogo) →
 * enabled (config). Fail-closed: data_key sin field en el catálogo, o field sin fila enabled en la
 * config → false. PURA. Exportada para que el caller resuelva un data_key suelto si lo necesita.
 */
export function isDataKeyEnabled(
  dataKey: string,
  dataKeyToFieldId: ReadonlyMap<string, string>,
  configEnabledByFieldId: ReadonlyMap<string, boolean>,
): boolean {
  const fieldId = dataKeyToFieldId.get(dataKey);
  if (fieldId == null) return false;
  return configEnabledByFieldId.get(fieldId) === true;
}
