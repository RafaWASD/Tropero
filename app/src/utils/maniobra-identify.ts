// Lógica PURA de la IDENTIFICACIÓN del animal en MODO MANIOBRAS (spec 03 M2.1-core).
// Sin RN, sin red, sin supabase-js, sin PowerSync: testeable con node:test (mismo patrón que
// tag-lookup.ts / maneuver-gating.ts). Acá vive la DECISIÓN de qué hacer con un identificador
// (bastoneado o tipeado) ya resuelto contra el SQLite local, traducida a la semántica de la MANGA.
//
// La I/O (los lookups locales) vive en services/animals.ts (lookupByTag / searchAnimals); este módulo
// solo MAPEA sus resultados a un IdentifyOutcome que la pantalla consume. Así las reglas de manga
// (found / otro-establecimiento / desconocido / ambiguo) se unit-testean sin tocar el SDK ni el DOM.
//
// R cubiertos acá (la parte PURA): R3.3 (resolución por tag_electronic → found/unknown), R4.3 (BLE
// desempata por tag — implícito: el lookup por tag es por el chip único global, no por visual), R4.5
// (otro establecimiento → avisar + saltar), gate de AUTO-AVANCE (match único y claro). DIFERIDO a
// M2.1-edge: R4.2 (manual multi-candidato → desambiguar) queda como outcome `ambiguous` (estado SEGURO,
// NO se auto-elige) + R4.7 (rodeo de jornada mal elegido).

import type { TagLookupResult } from '../services/tag-lookup';
import type { DisambiguationCandidate } from './maniobra-edge';

// ─── El outcome de identificar un animal en la manga ──────────────────────────────────────────
//
// Traduce las 3 ramas del lookup por TAG (edit/transfer/create) a la semántica de la manga:
//   - found             → hay UN animal activo en el campo ACTIVO con ese identificador → cargar sobre él.
//   - other_establishment → el animal existe pero en OTRO campo del usuario → avisar + SALTAR (R4.5).
//   - unknown           → ningún match en ningún campo → find-or-create inline (R4.1).
//   - ambiguous         → la búsqueda MANUAL por visual devolvió >1 candidato (R4.2) → estado SEGURO,
//                         no se auto-elige (DIFERIDO a M2.1-edge: la UI de desambiguación es de M2.1-edge).

/** El identificador resuelto a UN animal del campo activo (lo que la carga rápida necesita por ahora). */
export type IdentifiedAnimal = {
  /** profile_id del animal activo en el campo ACTIVO. */
  profileId: string;
};

/** Cómo se identificó el animal (para el feedback + el ruteo del find-or-create). */
export type IdentifySource = 'ble' | 'manual';

export type IdentifyOutcome =
  | {
      kind: 'found';
      source: IdentifySource;
      animal: IdentifiedAnimal;
      /** El identificador crudo que entró (EID o texto manual), para el feedback/header. */
      identifier: string;
    }
  | {
      kind: 'other_establishment';
      source: IdentifySource;
      /** El profile_id de origen (en el otro campo) — informativo; el alta/transfer es feature 11. */
      sourceProfileId: string;
      /** El name legible del otro campo (para el aviso "está en el campo X", R4.5). */
      otherFieldName: string;
      identifier: string;
    }
  | {
      kind: 'unknown';
      source: IdentifySource;
      /** El identificador a precargar (NO editable) en el find-or-create inline (R4.1). */
      identifier: string;
    }
  | {
      // R4.2: manual con >1 candidato → estado seguro, sin auto-elegir. M2.1-edge da la UI de selección
      // (CandidatePicker) a partir de `candidates`; M2.1-core ya garantizaba que NO se auto-elige.
      kind: 'ambiguous';
      source: 'manual';
      identifier: string;
      /** Los profile_ids candidatos (compat M2.1-core; deriva de `candidates`). */
      candidateProfileIds: string[];
      /** Los candidatos ENRIQUECIDOS con lo que los distingue (R4.2 — picker manga-friendly). */
      candidates: DisambiguationCandidate[];
    };

// ─── BLE: mapeo del lookupByTag (R3.3 / R4.3 / R4.5) ───────────────────────────────────────────

/**
 * Traduce el resultado de `lookupByTag` (rama BLE, ya resuelto contra el SQLite local) al outcome de
 * manga (PURA, R3.3 / R4.3 / R4.5). El match por TAG es por el `tag_electronic` ÚNICO GLOBAL (spec 02
 * R3.2), así que NUNCA es ambiguo aunque la caravana visual estuviera duplicada (R4.3: el chip desempata
 * solo — no hay rama `ambiguous` por BLE).
 *
 *   - mode 'edit'     → animal activo en el campo ACTIVO → `found` (cargar sobre él).
 *   - mode 'transfer' → activo en OTRO campo del usuario → `other_establishment` (avisar + saltar, R4.5).
 *   - mode 'create'   → sin match en ningún campo → `unknown` (find-or-create inline, R4.1).
 *
 * @param result      el TagLookupResult que devolvió lookupByTag.
 * @param eid         el EID bastoneado (para el header/feedback + el precargado del find-or-create).
 */
export function resolveBleIdentify(result: TagLookupResult, eid: string): IdentifyOutcome {
  switch (result.mode) {
    case 'edit':
      return { kind: 'found', source: 'ble', animal: { profileId: result.profileId }, identifier: eid };
    case 'transfer':
      // El animal está activo en OTRO campo del usuario. En la manga NO transferimos (eso es feature 11):
      // avisamos "está en el campo X" + SALTAMOS para no frenar la fila (R4.5).
      return {
        kind: 'other_establishment',
        source: 'ble',
        sourceProfileId: result.sourceProfileId,
        otherFieldName: result.otherFieldName,
        identifier: eid,
      };
    case 'create':
    default:
      return { kind: 'unknown', source: 'ble', identifier: eid };
  }
}

// ─── Manual: mapeo de searchAnimals (R3.5 / R4.2) ──────────────────────────────────────────────
//
// La búsqueda manual (searchAnimals) está scopeada al campo ACTIVO (idv exacto + visual fuzzy). Reglas:
//   - 0 candidatos  → `unknown` (find-or-create inline con el texto precargado, R4.1).
//   - 1 candidato   → `found` (cargar sobre él, R3.5).
//   - >1 candidatos → `ambiguous` (R4.2): estado SEGURO — NO se auto-elige el equivocado. La UI de
//                     desambiguación manual es M2.1-EDGE (diferida); por ahora se muestra un aviso.
//
// "Otro establecimiento" por la puerta manual NO aplica acá: searchAnimals solo ve el campo activo (un
// idv/visual de otro campo simplemente no matchea → `unknown`). El surfacing de otro-establecimiento es
// propio de la puerta BLE (el chip es único global) — exactamente como lo modela lookupByTag.

/**
 * Un candidato de la búsqueda manual. `profileId` es lo único que el gating necesita; los campos de
 * DISPLAY (visual/idv/tag/rodeo/categoría) son opcionales — los completa la pantalla a partir del
 * `AnimalListItem` que devolvió searchAnimals para alimentar el picker de desambiguación (R4.2). Son
 * opcionales para no romper M2.1-core (los tests pasan solo `{ profileId }`); cuando faltan, el
 * candidato enriquecido cae a null/'' (el picker igual muestra algo, pero la manga real siempre los trae).
 */
export type ManualCandidate = {
  profileId: string;
  visualIdAlt?: string | null;
  idv?: string | null;
  tagElectronic?: string | null;
  rodeoName?: string;
  categoryName?: string;
};

/** Enriquece un ManualCandidate a un DisambiguationCandidate (defaults seguros para los campos faltantes). */
function toDisambiguationCandidate(c: ManualCandidate): DisambiguationCandidate {
  return {
    profileId: c.profileId,
    visualIdAlt: c.visualIdAlt ?? null,
    idv: c.idv ?? null,
    tagElectronic: c.tagElectronic ?? null,
    rodeoName: c.rodeoName ?? '',
    categoryName: c.categoryName ?? '',
  };
}

/** Normaliza un identificador para comparar exactitud: trim + minúsculas (las caravanas no son case-sensitive). */
function normalizeId(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * ¿El candidato matchea EXACTAMENTE el texto tecleado (no solo por substring/fuzzy)? Un match exacto es por
 * idv === texto, visual_id_alt === texto, o tag_electronic === texto (todo case-insensitive, trim). El
 * substring fuzzy (`searchAnimals` corre `LIKE '%texto%'` sobre idv/tag/visual) puede devolver un animal cuya
 * caravana sólo CONTIENE el texto (ej. tecleo "42" → matchea idv "1428") — ese NO es exacto. Distinguirlo es
 * lo que evita auto-cargar la caravana EQUIVOCADA (bug "otra caravana").
 */
function isExactMatch(c: ManualCandidate, text: string): boolean {
  const t = normalizeId(text);
  if (t.length === 0) return false;
  return normalizeId(c.idv) === t || normalizeId(c.visualIdAlt) === t || normalizeId(c.tagElectronic) === t;
}

/**
 * Decide el outcome de la búsqueda MANUAL a partir de los candidatos del campo activo (PURA, R3.5/R4.2).
 *
 * AUTO-AVANCE SOLO CON MATCH EXACTO (fix bug "otra caravana", 2026-06-15): un `found` que auto-avanza a la
 * carga rápida solo se emite cuando el ÚNICO candidato matchea EXACTAMENTE lo tecleado (idv/visual/tag ===
 * texto). Si el único candidato es un match por SUBSTRING/fuzzy (su caravana sólo CONTIENE el texto, ej.
 * tecleo "42" → animal "1428"), NO se auto-carga: se devuelve `ambiguous` con ese candidato → el operario lo
 * CONFIRMA en el picker antes de cargar (o da de alta el que buscaba). Así nunca se salta a la caravana
 * equivocada sin que el operario la vea y la elija. El camino rápido del idv/visual EXACTO se preserva intacto.
 *
 * @param candidates  los candidatos que devolvió searchAnimals (ya scopeados al campo activo).
 * @param text        el texto que el operario tipeó (para el header/feedback + el precargado).
 */
export function resolveManualIdentify(
  candidates: readonly ManualCandidate[],
  text: string,
): IdentifyOutcome {
  if (candidates.length === 0) {
    return { kind: 'unknown', source: 'manual', identifier: text };
  }
  // Un único candidato que matchea EXACTO → found (auto-avance, camino rápido de manga). Un único candidato
  // que sólo matchea por substring → ambiguous (confirmación explícita): no se auto-carga el equivocado.
  if (candidates.length === 1 && isExactMatch(candidates[0], text)) {
    return {
      kind: 'found',
      source: 'manual',
      animal: { profileId: candidates[0].profileId },
      identifier: text,
    };
  }
  // >1 candidato (caravana visual duplicada, R4.2) o 1 candidato NO-exacto (substring): estado SEGURO, sin
  // auto-elegir. El picker (CandidatePicker) muestra el/los candidato(s) enriquecido(s) → el operario elige
  // el correcto o da de alta el que buscaba. NO se salta a una caravana que el operario no tecleó exacta.
  return {
    kind: 'ambiguous',
    source: 'manual',
    identifier: text,
    candidateProfileIds: candidates.map((c) => c.profileId),
    candidates: candidates.map(toDisambiguationCandidate),
  };
}

// ─── Gate de AUTO-AVANCE (decisión de Raf: match único y claro → carga rápida) ─────────────────

/**
 * ¿El outcome habilita el AUTO-AVANCE a la carga rápida? (PURA). SOLO un `found` (match único y claro)
 * auto-avanza tras el flash de confirmación (~0,8s). `other_establishment` (se salta), `unknown`
 * (find-or-create) y `ambiguous` (desambiguar — M2.1-edge) NUNCA auto-avanzan: requieren una acción
 * explícita del operario, así no se carga sobre el animal equivocado.
 */
export function shouldAutoAdvance(outcome: IdentifyOutcome): boolean {
  return outcome.kind === 'found';
}

// ─── Validación del rodeo de la sesión para el find-or-create (R4.1) ───────────────────────────

/**
 * Resuelve el identificador precargado del find-or-create inline (R4.1) según cómo se identificó: por BLE
 * va en `tag` (caravana electrónica), por manual va en el campo que la heurística elija (numérico → idv;
 * si no → visual). PURA: la heurística numérica es la misma que classifyIdentifier de animals.ts, pero la
 * replicamos mínima acá para no arrastrar el SDK al test (un texto que es solo dígitos → idv; si no → visual).
 *
 * @returns el shape de params para `/crear-animal` (solo el campo que corresponde precargado).
 */
export function resolvePrefilledCreateParams(
  outcome: Extract<IdentifyOutcome, { kind: 'unknown' }>,
): { tag?: string; idv?: string; visual?: string } {
  if (outcome.source === 'ble') {
    return { tag: outcome.identifier };
  }
  const trimmed = outcome.identifier.trim();
  // Manual: numérico puro → idv; cualquier otro → visual (caravana visual alfanumérica).
  if (/^\d+$/.test(trimmed)) return { idv: trimmed };
  return { visual: trimmed };
}
