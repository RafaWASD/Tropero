// Lógica PURA del wizard de config de jornada (spec 03 M1.4 — UI del wizard de MODO MANIOBRAS).
// Sin RN, sin red, sin SDK: testeable con node:test (mismo patrón que maneuver-gating.ts /
// maneuver-config.ts). Acá vive (a) el mapeo maniobra → label es-AR para la UI, (b) el reorder PURO
// del array de maniobras (drag-reorder, R1.12), y (c) el armado del `config` snapshot de la jornada
// (R1.13, shape §2.1.1) que se persiste en sessions.config / maneuver_presets.config.
//
// El orden de maniobras es PRESENTACIÓN PURA (R1.12): reordenar NO toca el gating (capa 1/2) ni qué
// maniobras aplican por animal. Estas funciones solo mueven elementos del array y arman el jsonb.

import { ALL_MANEUVERS, type ManeuverKind } from './maneuver-gating';
import type { ManeuverConfig } from './maneuver-config';

// ─── Labels es-AR de las 10 maniobras (R1.6 / UI del wizard) ──────────────────────────────────

/**
 * Nombre legible es-AR de cada maniobra, para mostrar en el wizard (etapa 2/3) y la lista de
 * maniobras. Las claves son el `ManeuverKind` as-built (tacto/raspado/etc., NO los data_keys).
 * Términos de campo (alineados con event-timeline REPRO_LABELS / el dominio de Facundo).
 */
export const MANEUVER_LABELS: Record<ManeuverKind, string> = {
  tacto: 'Tacto de preñez',
  tacto_vaquillona: 'Tacto de aptitud reproductiva',
  sangrado: 'Sangrado (brucelosis)',
  vacunacion: 'Vacunación',
  inseminacion: 'Inseminación',
  condicion_corporal: 'Condición corporal',
  dientes: 'Dientes',
  pesaje: 'Pesaje',
  pesaje_ternero: 'Pesaje de ternero',
  raspado: 'Raspado de toros',
  // Maniobras nuevas (sesión 26, R6.13/R6.15). Términos de campo de Facundo (sesión 26).
  antiparasitario: 'Antiparasitario',
  antibiotico: 'Antibiótico',
};

/** Label es-AR de una maniobra (fallback al token crudo si llegara una desconocida — defensivo). */
export function maneuverLabel(m: ManeuverKind): string {
  return MANEUVER_LABELS[m] ?? m;
}

// ─── Detalle de preconfig por maniobra para el RESUMEN (etapa 3, R1.9) ─────────────────────────

/**
 * Devuelve el DETALLE legible de una maniobra a partir de su preconfig de tanda (R1.7), para mostrarlo
 * en el resumen (ej. "Brucelosis" bajo "Vacunación", la pajuela bajo "Inseminación"). El config es jsonb
 * pass-through: la preconfig de una maniobra puede ser un string (texto libre del MVP) o un objeto con
 * detalle más rico (futuras tandas). Resolvemos TOLERANTE — nunca rompe ante un payload inesperado:
 *   - string no vacío → ese texto.
 *   - objeto → busca campos conocidos (products/product/pajuela/detalle/value) y arma un texto; si no,
 *     devuelve null (no inventamos un detalle de un objeto que no entendemos).
 *   - cualquier otra cosa (number/array/null/vacío) → null (sin detalle → el resumen muestra solo el nombre).
 */
export function maneuverDetail(preconfig: ManeuverPreconfig | undefined, m: ManeuverKind): string | null {
  if (!preconfig) return null;
  const raw = preconfig[m];
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    // Lista de productos (vacuna/s) → "A, B".
    const products = obj.products;
    if (Array.isArray(products)) {
      const parts = products.map((p) => (typeof p === 'string' ? p.trim() : '')).filter((p) => p.length > 0);
      if (parts.length > 0) return parts.join(', ');
    }
    // Campos escalares de detalle conocidos (pajuela/producto/valor/texto libre).
    for (const key of ['product', 'pajuela', 'detalle', 'value', 'text'] as const) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
  }
  return null;
}

// ─── Reorder PURO del array de maniobras (drag-reorder, R1.12) ─────────────────────────────────

/**
 * Mueve la maniobra del índice `from` al índice `to`, devolviendo un NUEVO array (inmutable). Es el
 * núcleo del drag-reorder (R1.12): el handle suelta la fila en una nueva posición → se llama acá. Los
 * índices fuera de rango o iguales devuelven una copia sin cambios (no rompe). Preserva el resto del
 * orden. El orden es presentación pura: esta función NO toca gating ni datos (solo reordena el array).
 */
export function moveManeuver(
  maneuvers: readonly ManeuverKind[],
  from: number,
  to: number,
): ManeuverKind[] {
  const n = maneuvers.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) {
    return [...maneuvers];
  }
  const out = [...maneuvers];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * Alterna (toggle on/off) una maniobra en la lista de elegidas (etapa 2). Si ya está elegida, la quita
 * (preservando el orden del resto); si no, la AGREGA AL FINAL (orden inicial = orden de selección,
 * R1.12). Devuelve un nuevo array. Ignora un valor que no sea un ManeuverKind conocido (defensivo).
 */
export function toggleManeuver(
  chosen: readonly ManeuverKind[],
  maneuver: ManeuverKind,
): ManeuverKind[] {
  if (!ALL_MANEUVERS.includes(maneuver)) return [...chosen];
  if (chosen.includes(maneuver)) return chosen.filter((m) => m !== maneuver);
  return [...chosen, maneuver];
}

// ─── Armado del config snapshot de la jornada (R1.13, shape §2.1.1) ───────────────────────────

/** La pre-config de tanda por maniobra (R1.7): texto libre por maniobra (vacuna(s)/pajuela/etc.). */
export type ManeuverPreconfig = Record<string, unknown>;

/**
 * Arma el `config` jsonb de la jornada (R1.13, shape canónico §2.1.1): `{ maniobras: [<orden>],
 * preconfig: {…} }`. El array `maniobras` se guarda EN EL ORDEN del drag (presentación). Filtra
 * cualquier maniobra que no sea un ManeuverKind conocido y DEDUPLICA preservando el orden (no se
 * confía en el input de la UI — el jsonb es pass-through y lo re-parsea extractManeuvers). La
 * `preconfig` se incluye solo si tiene claves (no ensuciamos el jsonb con `{}` vacío).
 */
export function buildJornadaConfig(
  maneuvers: readonly ManeuverKind[],
  preconfig?: ManeuverPreconfig,
): ManeuverConfig {
  const seen = new Set<string>();
  const maniobras: ManeuverKind[] = [];
  for (const m of maneuvers) {
    if (ALL_MANEUVERS.includes(m) && !seen.has(m)) {
      seen.add(m);
      maniobras.push(m);
    }
  }
  const config: ManeuverConfig = { maniobras };
  if (preconfig && Object.keys(preconfig).length > 0) {
    config.preconfig = preconfig;
  }
  return config;
}

// ─── Preconfig MULTI-valor (vacunación: varias vacunas, R1.7) — split/join puro ────────────────

/**
 * Parte un valor MULTI persistido (varias vacunas separadas por coma) en sus ítems individuales,
 * limpiando vacíos y deduplicando case-insensitive (preserva el orden de aparición y el casing del
 * PRIMER visto). Es el inverso de `joinMultiPreconfig`: el config jsonb guarda la lista como un string
 * coma-separado (round-trip con `maneuverDetail`, que lo muestra tal cual inline y en el resumen).
 */
export function splitMultiPreconfig(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const v = raw.trim();
    if (v.length === 0) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Une los ítems de un preconfig MULTI (vacunas) en el string coma-separado que se persiste (R1.7).
 * Deduplica + recorta igual que `splitMultiPreconfig` → `split(join(x)) === dedup(x)` (round-trip).
 */
export function joinMultiPreconfig(items: readonly string[]): string {
  return splitMultiPreconfig(items.join(', ')).join(', ');
}

// ─── Autocompletar de valores usados antes (R1.8) — dedup + filtro puro ────────────────────────

/**
 * Filtra una lista de valores históricos (vacunas/pajuelas usadas antes, R1.8) por un prefijo tipeado,
 * case-insensitive, deduplicando y preservando el orden de aparición (más recientes primero los pasa
 * el caller). Un prefijo vacío devuelve la lista deduplicada completa. Recorta sugerencias vacías. La
 * comparación ignora acentos NO — es match simple de prefijo es-AR (suficiente para el MVP sin stock).
 */
export function filterAutocomplete(
  history: readonly string[],
  typed: string,
  limit = 5,
): string[] {
  const needle = typed.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of history) {
    const v = raw.trim();
    if (v.length === 0) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    // No sugerimos un valor idéntico a lo ya tipeado (no aporta), pero sí prefijos.
    if (needle.length > 0 && (!key.startsWith(needle) || key === needle)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}
