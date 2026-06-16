// Lógica PURA del snapshot de configuración de una jornada / preset (spec 03 M1.2/M1.3).
// Sin RN, sin red, sin SDK: testeable con node:test. El `config` de sessions / maneuver_presets es un
// jsonb PASS-THROUGH (la UI lo arma libremente); estas funciones solo (a) parsean el TEXT del SQLite a
// objeto de forma TOLERANTE (un payload corrupto NO rompe), y (b) extraen la lista de maniobras VÁLIDAS
// (filtra cualquier valor que no sea un ManeuverKind conocido — no se confía en el contenido del jsonb).

import { ALL_MANEUVERS, type ManeuverKind } from './maneuver-gating';

/** El snapshot de una jornada/preset. `maniobras` ordenadas; el resto es libre (pre-config de tanda). */
export type ManeuverConfig = {
  maniobras?: ManeuverKind[];
  /** Parámetros fijos de tanda por maniobra (R1.7). Pass-through libre (string o objeto por maniobra). */
  preconfig?: Record<string, unknown>;
  [key: string]: unknown;
};

const MANEUVER_SET = new Set<string>(ALL_MANEUVERS);

/**
 * Parsea el `config` de SQLite a un objeto ManeuverConfig de forma TOLERANTE: null/malformado/array → `{}`
 * (nunca tira). Un payload que no sea un objeto plano (p. ej. un número o un array) cae a `{}`.
 *
 * ⚠️ Acepta DOS formas (round-trip server↔local): (a) un STRING JSON — el camino del INSERT local
 * (`JSON.stringify(config)`), cuando la sesión/preset se acaba de crear offline y vive como TEXT en SQLite;
 * (b) un OBJETO ya parseado — cuando la fila VOLVIÓ del server por la stream y PowerSync materializó el
 * `jsonb` como objeto JS (NO como string). Sin tolerar (b), `JSON.parse(objeto)` fallaría y devolvería `{}`
 * → la carga rápida vería "sin maniobras" tras el primer sync de la sesión (bug M2.2). Por eso, si ya es un
 * objeto plano, se devuelve tal cual.
 */
export function parseManeuverConfig(raw: unknown): ManeuverConfig {
  if (raw == null) return {};
  // (b) PowerSync materializó el jsonb como objeto plano (la fila bajó del server) → usarlo tal cual.
  if (typeof raw === 'object') {
    return !Array.isArray(raw) ? (raw as ManeuverConfig) : {};
  }
  // (a) string JSON. DOS variantes (round-trip server↔local):
  //   - INSERT local recién creado: el string es el JSON del objeto → `'{"maniobras":[...]}'`.
  //   - fila SINCRONIZADA: PowerSync materializa el `jsonb` del server DOBLEMENTE serializado en la columna
  //     text → `'"{\\"maniobras\\":[...]}"'` (un string JSON cuyo contenido es OTRO string JSON). El 1er
  //     `JSON.parse` devuelve un STRING (no un objeto) → si eso pasa, parseamos UNA VEZ MÁS. Sin esto, el
  //     config sincronizado caía a `{}` y la carga rápida veía "sin maniobras" tras el sync (bug M2.2).
  if (typeof raw !== 'string') return {};
  try {
    let v: unknown = JSON.parse(raw);
    if (typeof v === 'string') v = JSON.parse(v); // doble-encoding (fila sincronizada)
    return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as ManeuverConfig) : {};
  } catch {
    return {};
  }
}

/**
 * Extrae las maniobras VÁLIDAS de un ManeuverConfig: filtra todo valor que no sea un ManeuverKind conocido
 * (el jsonb es pass-through — no se confía en su contenido), preserva el orden y DEDUPLICA. `maniobras`
 * ausente o no-array → []. Robusto ante un config corrupto (la UI ofrecería 0 maniobras, no crashea).
 */
export function extractManeuvers(config: ManeuverConfig): ManeuverKind[] {
  const raw = config.maniobras;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ManeuverKind[] = [];
  for (const m of raw) {
    if (typeof m === 'string' && MANEUVER_SET.has(m) && !seen.has(m)) {
      seen.add(m);
      out.push(m as ManeuverKind);
    }
  }
  return out;
}

// ─── Preconfig de tanda por maniobra (R1.7) — extracción TOLERANTE para los pasos de carga (M3.2b) ──────

/**
 * Lee el valor de preconfig de UNA maniobra del config jsonb (R1.7), TOLERANTE al shape pass-through:
 *   - string → ese string (ej. "Ivermectina" para antiparasitario, "Aftosa, Mancha" para vacunación multi);
 *   - objeto → busca campos conocidos (`products`/`product`/`pajuela`/`default_pajuela`/`value`/`detalle`)
 *     y los serializa a string (lista → coma-join); si no entiende el objeto → ''.
 *   - cualquier otra cosa (number/array/null/ausente) → '' (sin preconfig).
 * No tira nunca. Es la fuente del producto pre-cargado del paso silent_apply (SilentSanitaryStep) y de las
 * vacunas pre-cargadas (SilentVaccinationStep, que luego splittea por coma).
 */
export function preconfigStringFor(config: ManeuverConfig, m: ManeuverKind): string {
  const pre = config.preconfig;
  if (pre == null || typeof pre !== 'object' || Array.isArray(pre)) return '';
  const raw = (pre as Record<string, unknown>)[m];
  if (typeof raw === 'string') return raw.trim();
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const products = o.products;
    if (Array.isArray(products)) {
      return products.filter((p) => typeof p === 'string' && p.trim().length > 0).map((p) => (p as string).trim()).join(', ');
    }
    for (const key of ['product', 'default_pajuela', 'pajuela', 'value', 'detalle']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
  }
  return '';
}

/**
 * Lista de PAJUELAS disponibles de la tanda para la INSEMINACIÓN (R6.5): 1 → confirmar de un toque; >1 →
 * selector. TOLERANTE al shape pass-through del preconfig de inseminación:
 *   - string → 1 pajuela (ej. "Toro 123"); coma-separado → cada parte una pajuela (ej. "Toro 123, Toro 456");
 *   - objeto con `pajuelas` array → esa lista; con `default_pajuela`/`pajuela`/`value` string → 1 pajuela;
 *   - ausente/otro → [] (sin pajuela preconfigurada → el paso pide una libre).
 * Deduplica case-insensitive (preserva orden + casing del primero) y descarta vacíos. NO tira nunca.
 * Es la fuente del "1 vs >1" de R6.5 (el InseminacionStep decide modo single vs selector por el length).
 */
export function pajuelasFor(config: ManeuverConfig): string[] {
  const pre = config.preconfig;
  const out: string[] = [];
  if (pre != null && typeof pre === 'object' && !Array.isArray(pre)) {
    const raw = (pre as Record<string, unknown>).inseminacion;
    if (typeof raw === 'string') {
      out.push(...raw.split(','));
    } else if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      const list = o.pajuelas;
      if (Array.isArray(list)) {
        for (const p of list) if (typeof p === 'string') out.push(p);
      } else {
        for (const key of ['default_pajuela', 'pajuela', 'product', 'value']) {
          const v = o[key];
          if (typeof v === 'string') {
            out.push(v);
            break;
          }
        }
      }
    }
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of out) {
    const v = raw.trim();
    if (v.length === 0) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(v);
  }
  return result;
}

/**
 * Histórico de valores "usados antes" (R1.8) para el autocompletar de un paso de carga: todos los valores de
 * preconfig de la jornada (de TODAS las maniobras), aplanados (los multi por coma), deduplicados
 * case-insensitive. Espeja la fuente source-agnostic de DM1-UI-1 (el preconfig SON valores ya cargados por
 * el campo); el caller filtra por prefijo con `filterAutocomplete`. M4 puede enriquecerlo con una query de
 * product_name distinct sin reabrir esto (el helper es source-agnostic).
 */
export function preconfigHistory(config: ManeuverConfig): string[] {
  const pre = config.preconfig;
  if (pre == null || typeof pre !== 'object' || Array.isArray(pre)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const v = raw.trim();
    if (v.length === 0) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  for (const key of Object.keys(pre as Record<string, unknown>)) {
    const flat = preconfigStringFor(config, key as ManeuverKind);
    for (const part of flat.split(',')) push(part);
  }
  // Pajuelas multi de inseminación (shape `{pajuelas:[...]}`) que preconfigStringFor no aplana → sumarlas.
  for (const p of pajuelasFor(config)) push(p);
  return out;
}
