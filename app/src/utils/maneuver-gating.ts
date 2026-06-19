// Lógica PURA del gating de maniobras (capa 1, cliente — ADR-021 / spec 03 M1.1).
// Sin RN, sin red, sin supabase-js, sin PowerSync: testeable con node:test (mismo patrón que
// rodeo-template.ts / animal-category.ts).
//
// Resuelve, dado el rodeo REAL de un animal y su rodeo_data_config (a nivel data_key), QUÉ maniobras
// de la sesión APLICAN para ese animal (R5.3/R5.5) y, por cada data_key, si es REQUERIDO u OPCIONAL
// (R5.6). El mapeo maniobra→data_keys (R5.4) es hardcodeado (ADR-021 / spec 02 R2.7).
//
// El cliente NO resuelve el rodeo del animal con una función `current_animal_rodeo` (NO existe as-built,
// SEC-SPEC-03-02): el caller (el hook) lee `animal_profiles.rodeo_id` del perfil activo del SQLite local
// y pasa acá el rodeo_data_config de ESE rodeo. Este módulo no toca I/O — opera sobre datos ya resueltos.
//
// Defensa en profundidad: la capa 2 (DB, trigger `assert_data_keys_enabled`, 0054) re-valida lo mismo
// server-side al subir; esta capa 1 solo evita ofrecer/cargar una maniobra que el rodeo no habilita.

// ─── Las maniobras del MVP cría (R1.6 / R5.4) ──────────────────────────────────────────
//
// 10 de fábrica + 2 sanitarias nuevas (sesión 26): antiparasitario (R6.13/R6.14) + antibiótico (R6.15).

/** Las 13 maniobras tipadas del MVP cría (12 + circunferencia escrotal, s27). Claves estables = el ManeuverKind del cliente. */
export type ManeuverKind =
  | 'tacto'
  | 'tacto_vaquillona'
  | 'sangrado'
  | 'vacunacion'
  | 'inseminacion'
  | 'condicion_corporal'
  | 'dientes'
  | 'pesaje'
  | 'pesaje_ternero'
  | 'raspado'
  // Maniobras nuevas (sesión 26, R6.13/R6.15) → sanitary_events deworming/treatment, silent_apply.
  | 'antiparasitario'
  | 'antibiotico'
  // Circunferencia escrotal del toro (sesión 27, R14.1) → tabla typed scrotal_measurements, StepKind 'rueda'.
  | 'circunferencia_escrotal';

/**
 * Modo de match de los data_keys de una maniobra contra el rodeo real (R5.4):
 *   - `all`: la maniobra aplica SSI TODOS sus data_keys están enabled (caso por defecto, AND).
 *   - `any`: aplica SSI AL MENOS UNO está enabled (OR). Único caso: antiparasitario, cuyo gating es la
 *     OR de `antiparasitario_interno`/`antiparasitario_externo` (D10 RESUELTO Raf 2026-06-14: una sola
 *     maniobra SIN distinción estructurada interno/externo; basta cualquiera). La capa 2 (DB, 0091)
 *     espeja esta OR con `assert_any_data_key_enabled`.
 */
export type ManeuverMatchMode = 'all' | 'any';

/** El requisito de gating de UNA maniobra: sus data_keys + cómo se matchean contra el rodeo (all/any). */
export type ManeuverDataKeyReq = {
  /** Los data_key REALES de field_definitions (0018) que la maniobra necesita. */
  dataKeys: readonly string[];
  /** Cómo se evalúan contra el rodeo real: 'all' (AND, default) | 'any' (OR, solo antiparasitario). */
  match: ManeuverMatchMode;
};

/**
 * Mapeo maniobra → requisito de data_key(s) (R5.4, ADR-021 / spec 02 R2.7). Los `dataKeys` son los
 * `data_key` REALES de `field_definitions` (0018) — DEBEN matchear los literales de los triggers de
 * gating capa 2 (0054 + 0091). El `match`:
 *   - `all` (AND): la maniobra aplica SSI TODOS sus data_keys están enabled (la mayoría).
 *   - `any` (OR): aplica SSI AL MENOS UNO está enabled. SOLO antiparasitario (OR de interno/externo,
 *     D10 RESUELTO). NO se modela como una entrada plana `['antiparasitario_interno','antiparasitario_externo']`
 *     con AND (eso exigiría AMBOS, incorrecto): se modela con `match:'any'` (design §3).
 *
 * ⚠️ Contrato de binding (R7.2): si un data_key se renombra en field_definitions sin actualizar este
 * mapeo (o el trigger), el gating se rompe silenciosamente. El test de binding de la suite de DB
 * (T2.5/T2.4c) verifica que cada literal existe en el catálogo; acá el unit test verifica el shape.
 */
export const MANEUVER_DATA_KEY_REQS: Record<ManeuverKind, ManeuverDataKeyReq> = {
  tacto: { dataKeys: ['prenez', 'tamano_prenez'], match: 'all' },
  tacto_vaquillona: { dataKeys: ['tacto_vaquillona'], match: 'all' },
  sangrado: { dataKeys: ['brucelosis'], match: 'all' },
  vacunacion: { dataKeys: ['vacunacion'], match: 'all' },
  inseminacion: { dataKeys: ['inseminacion'], match: 'all' },
  condicion_corporal: { dataKeys: ['condicion_corporal'], match: 'all' },
  dientes: { dataKeys: ['dientes'], match: 'all' },
  pesaje: { dataKeys: ['peso'], match: 'all' },
  pesaje_ternero: { dataKeys: ['peso'], match: 'all' },
  raspado: { dataKeys: ['raspado_toros'], match: 'all' },
  // Antiparasitario: OR pura de interno/externo (D10, R6.14). Basta uno enabled → la maniobra aplica.
  antiparasitario: { dataKeys: ['antiparasitario_interno', 'antiparasitario_externo'], match: 'any' },
  // Antibiótico: single key, igual que vacunación (R6.15).
  antibiotico: { dataKeys: ['antibiotico'], match: 'all' },
  // Circunferencia escrotal: single key nuevo (R14.1). AND trivial. data_key seedeado enabled por defecto
  // en cría (R14.18) → un rodeo de cría nuevo la ofrece sin config extra. Binding verificado por la suite
  // de DB (el data_key 'circunferencia_escrotal' existe GLOBAL en field_definitions, 0099).
  circunferencia_escrotal: { dataKeys: ['circunferencia_escrotal'], match: 'all' },
};

/**
 * Mapeo maniobra → data_key(s) requeridos (R5.4). DERIVADO de `MANEUVER_DATA_KEY_REQS` (la lista plana
 * de data_keys, sin el modo de match). Se conserva para los call-sites que solo necesitan los literales
 * (p. ej. el binding-test). Para resolver aplicabilidad, usar `resolveManeuverGating` (que respeta el
 * `match` all/any), NO un `.every()` sobre este array — un `.every()` daría AND también al antiparasitario.
 */
export const MANEUVER_DATA_KEYS: Record<ManeuverKind, readonly string[]> = Object.fromEntries(
  Object.entries(MANEUVER_DATA_KEY_REQS).map(([m, req]) => [m, req.dataKeys]),
) as Record<ManeuverKind, readonly string[]>;

/** Todas las maniobras conocidas (orden estable, para iterar). */
export const ALL_MANEUVERS: readonly ManeuverKind[] = Object.keys(
  MANEUVER_DATA_KEY_REQS,
) as ManeuverKind[];

// ─── Estado de un data_key en el rodeo real (entrada ya resuelta por el caller) ───────

/**
 * El estado de UN data_key en el rodeo real del animal, resuelto a partir de rodeo_data_config (enabled)
 * + system_default_fields (required_for_system). El caller (hook) arma este mapa joineando catálogo +
 * config + defaults. `enabled = false` o ausente ⇒ la maniobra que lo necesita NO aplica.
 */
export type RodeoDataKeyState = {
  /** El data_key está habilitado en el rodeo (rodeo_data_config.enabled = true). */
  enabled: boolean;
  /**
   * El data_key es OBLIGATORIO en este rodeo (system_default_fields.required_for_system = true). En cría
   * MVP ningún field es required (0018 l.100) → default false. Solo aplica si enabled = true.
   */
  required: boolean;
};

/** El rodeo_data_config del rodeo real, a nivel data_key: `{ [data_key]: { enabled, required } }`. */
export type RodeoDataKeyMap = Readonly<Record<string, RodeoDataKeyState>>;

// ─── Resolución por animal (R5.3/R5.5/R5.6) ───────────────────────────────────────────

/** Un data_key de una maniobra resuelto contra el rodeo real: si está habilitado y si es requerido. */
export type ResolvedDataKey = {
  dataKey: string;
  enabled: boolean;
  required: boolean;
};

/** El resultado del gating de UNA maniobra contra el rodeo real del animal. */
export type ManeuverGatingResult = {
  maneuver: ManeuverKind;
  /**
   * La maniobra APLICA: TODOS sus data_keys están enabled en el rodeo real (R5.5). Si false, la UI la
   * OMITE para ese animal (no la ofrece / no la carga).
   */
  applies: boolean;
  /** El detalle por data_key (enabled + required), para distinguir requeridos vs opcionales (R5.6). */
  dataKeys: ResolvedDataKey[];
  /**
   * Los data_keys REQUERIDOS de esta maniobra (subset de dataKeys con required = true). Vacío en cría
   * MVP (ningún field es required). La UI bloquea la confirmación si falta un campo de un data_key
   * requerido (R5.7). Solo significativo cuando applies = true.
   */
  requiredDataKeys: string[];
};

/**
 * Resuelve el gating de UNA maniobra contra el rodeo_data_config (a nivel data_key) del rodeo REAL del
 * animal (R5.3). La maniobra aplica SSI TODOS sus data_keys están enabled (R5.5). Un data_key ausente
 * del mapa = NO enabled (el rodeo no tiene fila de config habilitada para él) → la maniobra NO aplica.
 *
 * required vs opcional (R5.6): por cada data_key se reporta su `required` (de system_default_fields). Si
 * el rodeo no tiene config habilitada para un data_key, ese data_key queda { enabled:false } y la
 * maniobra no aplica (no se llega a pedir required/opcional). En cría MVP ningún data_key es required.
 */
export function resolveManeuverGating(
  maneuver: ManeuverKind,
  rodeoConfig: RodeoDataKeyMap,
): ManeuverGatingResult {
  const req = MANEUVER_DATA_KEY_REQS[maneuver];
  const dataKeys: ResolvedDataKey[] = req.dataKeys.map((dataKey) => {
    const state = rodeoConfig[dataKey];
    const enabled = state?.enabled === true;
    // required solo es significativo si el data_key está habilitado.
    const required = enabled && state?.required === true;
    return { dataKey, enabled, required };
  });
  // R5.5: AND (`all`) → aplica si TODOS enabled; OR (`any`, antiparasitario) → si AL MENOS UNO (D10).
  const applies =
    req.match === 'any'
      ? dataKeys.some((dk) => dk.enabled)
      : dataKeys.every((dk) => dk.enabled);
  // required (R5.6): solo de los data_keys ENABLED (en una OR, un data_key off no puede ser requerido —
  // no se carga su campo). En cría MVP ningún field es required → vacío. Solo significativo si aplica.
  const requiredDataKeys = applies
    ? dataKeys.filter((dk) => dk.enabled && dk.required).map((dk) => dk.dataKey)
    : [];
  return { maneuver, applies, dataKeys, requiredDataKeys };
}

/**
 * Resuelve el gating de un CONJUNTO de maniobras (las elegidas en la sesión) contra el rodeo real de un
 * animal. Preserva el orden de entrada. Útil en la pantalla de carga rápida: por cada maniobra de la
 * sesión, decide si aplica para ESTE animal (R5.5) y qué campos son requeridos (R5.6).
 */
export function resolveSessionGating(
  maneuvers: readonly ManeuverKind[],
  rodeoConfig: RodeoDataKeyMap,
): ManeuverGatingResult[] {
  return maneuvers.map((m) => resolveManeuverGating(m, rodeoConfig));
}

/**
 * Filtra una lista de maniobras a SOLO las que aplican en el rodeo (todas sus data_keys enabled), y
 * devuelve además las OMITIDAS (las que el rodeo no habilita). Para el gating UI capa 1 (R1.4/R1.5: el
 * wizard solo ofrece maniobras habilitadas) y para el aviso de preset (R2.3: una maniobra del preset
 * cuyo data_key está OFF se filtra y se avisa). Preserva el orden de entrada en ambas listas.
 */
export function filterApplicableManeuvers(
  maneuvers: readonly ManeuverKind[],
  rodeoConfig: RodeoDataKeyMap,
): { applicable: ManeuverKind[]; omitted: ManeuverKind[] } {
  const applicable: ManeuverKind[] = [];
  const omitted: ManeuverKind[] = [];
  for (const m of maneuvers) {
    if (resolveManeuverGating(m, rodeoConfig).applies) applicable.push(m);
    else omitted.push(m);
  }
  return { applicable, omitted };
}
