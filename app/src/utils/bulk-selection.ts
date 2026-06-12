// Lógica PURA del estado de SELECCIÓN de una operación masiva por grupo (spec 10, T-CL.3 / R11.3,
// R11.4, R11.5, R11.7, R11.8, R5.6). SIN I/O, SIN RN/expo/supabase: testeable con node:test (mismo
// patrón que bulk-candidates.ts / animal-category.ts). La UI (pantalla seleccion-masiva, Fase 4) consume
// estas funciones puras; acá NO hay componentes ni red — solo la DECISIÓN de qué arranca tildado, cómo
// se togglea, y cómo se desglosa para el bottom-sheet.
//
// Modelo de interacción (Gate 0 v2, LOCKEADO — design §3.2):
//   - CASTRACIÓN (D3/D6): secciones "Terneros" / "Adultos". Pre-tildados: SOLO los `ternero` con
//     future_bull=false (los ⭐ y TODOS los adultos arrancan SIN tildar — R11.3). El ⭐ tildado resalta
//     sin modal (la UI); el desglose del sheet cuenta los ⭐ incluidos para el aviso "⚠ N futuros toritos".
//   - DESTETE (D4): secciones "Terneros" / "Terneras". Pre-tildados: TODOS (R11.4). El ⭐ NO genera aviso
//     ni resaltado en destete (sin lógica de future_bull acá).
//   - VACUNACIÓN: NO usa este módulo (su modelo es todo+filtro+preview+skip-report, no selección por
//     checkbox — design §3.1). Si se invoca con 'vaccinate', se construye una sola sección sin secciones
//     por categoría y SIN pre-tildado especial (defensivo; la UI no llega acá para vacunación).
//
// El estado de selección es INMUTABLE: las funciones de toggle devuelven un Set nuevo (no mutan el
// recibido) — facilita el wiring con el estado de React (useState) sin sorpresas de identidad.

import type { BulkOperation, GroupProfile } from './bulk-candidates';

/** Una sección de la pantalla de selección: un grupo de candidatos por categoría (D6). */
export type SelectionSection = {
  /** Clave estable de la sección (para keys de React + lógica de "todos/ninguno"). */
  key: string;
  /** Título es-AR de la sección ("Terneros" / "Terneras" / "Adultos"). */
  title: string;
  /** Los candidatos de esta sección, en el orden recibido (la UI ordena por identificador — R11.9). */
  profiles: GroupProfile[];
};

/** El estado completo de la selección masiva (secciones + el set de profileIds tildados). */
export type BulkSelectionState = {
  operation: BulkOperation;
  sections: SelectionSection[];
  /** profileIds actualmente tildados. INMUTABLE: las funciones de toggle devuelven uno nuevo. */
  selected: ReadonlySet<string>;
};

/** Desglose de la selección para el bottom-sheet de confirmación (R11.8 / R5.6). */
export type SelectionSummary = {
  /** Total de animales tildados = el número del CTA (R11.7) y del header (R11.5). */
  total: number;
  /** Desglose por `categoryCode` de los SELECCIONADOS ("8 terneros · 3 toritos · 1 toro" — R11.8). */
  byCategory: { categoryCode: string; count: number }[];
  /**
   * Cuántos de los SELECCIONADOS son ⭐ futuro torito (future_bull=true) — alimenta el aviso
   * "⚠ N futuros toritos incluidos" del sheet (R11.8, solo castración). 0 si ninguno. */
  futureBullCount: number;
  /**
   * Cuántos de los SELECCIONADOS tienen category_override=true — alimenta el aviso de R5.6
   * ("N con categoría fijada manual no van a cambiar de categoría"). 0 si ninguno. */
  overrideCount: number;
};

/** ¿La categoría es de un adulto castrable (no `ternero`)? Decide la sección en castración. */
const ADULT_CASTRATION_CATEGORIES: ReadonlySet<string> = new Set(['torito', 'toro']);

/**
 * Construye el estado INICIAL de la selección a partir de los candidatos (la salida de
 * buildBulkCandidates, T-CL.1). Arma las secciones por categoría y aplica los DEFAULTS pre-tildados
 * EXACTOS por operación (D3/D6/D4):
 *   - castrate: secciones "Terneros" (categoryCode 'ternero') / "Adultos" (torito/toro). Pre-tildados:
 *     SOLO los `ternero` con future_bull=false (R11.3). ⭐ y adultos SIN tildar.
 *   - wean:     secciones "Terneros" ('ternero') / "Terneras" ('ternera'). Pre-tildados: TODOS (R11.4).
 *   - vaccinate (defensivo): una sola sección, sin pre-tildado especial.
 *
 * PURA: no muta `candidates`. El orden DENTRO de cada sección es el de `candidates` (la UI lo re-ordena
 * por identificador, R11.9 — acá no se asume identificador disponible).
 */
export function buildBulkSelectionState(
  operation: BulkOperation,
  candidates: readonly GroupProfile[],
): BulkSelectionState {
  if (operation === 'castrate') {
    const terneros = candidates.filter((p) => p.categoryCode === 'ternero');
    const adultos = candidates.filter((p) => ADULT_CASTRATION_CATEGORIES.has(p.categoryCode));
    const sections: SelectionSection[] = [
      { key: 'terneros', title: 'Terneros', profiles: terneros },
      { key: 'adultos', title: 'Adultos', profiles: adultos },
    ];
    // R11.3: pre-tildar SOLO los terneros comunes (ternero && !future_bull). ⭐ y adultos NO.
    const selected = new Set<string>(
      terneros.filter((p) => p.futureBull !== true).map((p) => p.profileId),
    );
    return { operation, sections, selected };
  }

  if (operation === 'wean') {
    const terneros = candidates.filter((p) => p.categoryCode === 'ternero');
    const terneras = candidates.filter((p) => p.categoryCode === 'ternera');
    const sections: SelectionSection[] = [
      { key: 'terneros', title: 'Terneros', profiles: terneros },
      { key: 'terneras', title: 'Terneras', profiles: terneras },
    ];
    // R11.4: pre-tildar TODOS. El ⭐ NO afecta el destete (sin lógica de future_bull).
    const selected = new Set<string>(candidates.map((p) => p.profileId));
    return { operation, sections, selected };
  }

  // vaccinate (defensivo — la UI de vacunación no usa selección por checkbox). Una sola sección, sin
  // pre-tildado especial (todos tildados, como el preview de "todos"): conservador y no rompe el contrato.
  const sections: SelectionSection[] = [
    { key: 'todos', title: 'Animales', profiles: [...candidates] },
  ];
  const selected = new Set<string>(candidates.map((p) => p.profileId));
  return { operation, sections, selected };
}

/**
 * Togglea UN animal (tildar/destildar). Devuelve un Set NUEVO (inmutable). Si el profileId no es de
 * ningún candidato, igual lo agrega/quita (la UI solo llama con ids visibles; defensivo).
 */
export function toggleProfile(
  selected: ReadonlySet<string>,
  profileId: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(profileId)) next.delete(profileId);
  else next.add(profileId);
  return next;
}

/**
 * "Todos / ninguno" por SECCIÓN (R11.5). `check=true` tilda TODOS los de la sección; `check=false` los
 * destilda. NO toca las otras secciones. Devuelve un Set NUEVO (inmutable).
 */
export function toggleSection(
  selected: ReadonlySet<string>,
  section: SelectionSection,
  check: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const p of section.profiles) {
    if (check) next.add(p.profileId);
    else next.delete(p.profileId);
  }
  return next;
}

/** Estado del checkbox "todos/ninguno" de una sección: 'all' | 'none' | 'some' (indeterminado). */
export type SectionCheckState = 'all' | 'none' | 'some';

/**
 * Estado del control "todos/ninguno" de una sección dado el set seleccionado (R11.5): 'all' si TODOS los
 * de la sección están tildados, 'none' si ninguno, 'some' (indeterminado) si algunos. Una sección VACÍA
 * se trata como 'none' (no hay nada para tildar).
 */
export function sectionCheckState(
  selected: ReadonlySet<string>,
  section: SelectionSection,
): SectionCheckState {
  if (section.profiles.length === 0) return 'none';
  let on = 0;
  for (const p of section.profiles) {
    if (selected.has(p.profileId)) on += 1;
  }
  if (on === 0) return 'none';
  if (on === section.profiles.length) return 'all';
  return 'some';
}

/** Cuenta los seleccionados = el número del CTA (R11.7) y del header (R11.5). */
export function selectedCount(state: BulkSelectionState): number {
  return countSelectedAcrossSections(state, state.selected);
}

/**
 * Limpia `category_override` (→ false) de los perfiles cuyo `profileId` está en `revertedIds`, devolviendo
 * un estado NUEVO (inmutable: arrays nuevos + objetos perfil nuevos solo para los afectados). Lo usa la
 * pantalla de selección tras revertir overrides desde el sheet (R5.6) para reflejar el cambio EN SITIO sin
 * re-fetchear toda la lista (anti-patrón del blank/scroll-reset): el `overrideCount` del desglose baja solo,
 * el aviso desaparece, y la SELECCIÓN del usuario (`selected`) se preserva intacta. PURA: no muta el input.
 */
export function clearOverridesInSelection(
  state: BulkSelectionState,
  revertedIds: ReadonlySet<string>,
): BulkSelectionState {
  if (revertedIds.size === 0) return state;
  return {
    ...state,
    sections: state.sections.map((section) => ({
      ...section,
      profiles: section.profiles.map((p) =>
        revertedIds.has(p.profileId) && p.categoryOverride === true
          ? { ...p, categoryOverride: false }
          : p,
      ),
    })),
  };
}

/**
 * Desglose de la selección para el bottom-sheet (R11.8 / R5.6). Recorre SOLO los candidatos
 * SELECCIONADOS (a partir de las secciones del estado, que son la fuente de los GroupProfile) y arma:
 *   - total = cantidad de tildados (== selectedCount — invariante verificada en test);
 *   - byCategory = conteo por categoryCode de los tildados (orden de primera aparición, estable);
 *   - futureBullCount = cuántos tildados tienen future_bull=true (⭐ — aviso de castración);
 *   - overrideCount = cuántos tildados tienen category_override=true (aviso R5.6).
 *
 * PURA: solo lee. Usa el `selected` del estado (o uno provisto, para previsualizar un toggle sin re-armar).
 */
export function summarizeSelection(
  state: BulkSelectionState,
  selected: ReadonlySet<string> = state.selected,
): SelectionSummary {
  const byCategoryMap = new Map<string, number>();
  let total = 0;
  let futureBullCount = 0;
  let overrideCount = 0;

  for (const section of state.sections) {
    for (const p of section.profiles) {
      if (!selected.has(p.profileId)) continue;
      total += 1;
      byCategoryMap.set(p.categoryCode, (byCategoryMap.get(p.categoryCode) ?? 0) + 1);
      if (p.futureBull === true) futureBullCount += 1;
      if (p.categoryOverride === true) overrideCount += 1;
    }
  }

  const byCategory = [...byCategoryMap.entries()].map(([categoryCode, count]) => ({
    categoryCode,
    count,
  }));
  return { total, byCategory, futureBullCount, overrideCount };
}

/** Cuenta los seleccionados que efectivamente pertenecen a alguna sección (consistente con el desglose). */
function countSelectedAcrossSections(
  state: BulkSelectionState,
  selected: ReadonlySet<string>,
): number {
  let n = 0;
  for (const section of state.sections) {
    for (const p of section.profiles) {
      if (selected.has(p.profileId)) n += 1;
    }
  }
  return n;
}
