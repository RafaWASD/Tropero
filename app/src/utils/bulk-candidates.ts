// Lógica PURA de candidatos de una operación masiva por grupo (spec 10, T-CL.1 / R1.3, R4.1,
// R7.2, R11.2, R11.4). SIN I/O, SIN imports de RN/expo/supabase: testeable con node:test (mismo
// patrón que utils/management-group.ts, utils/animal-category.ts). La I/O (leer los perfiles activos
// del grupo del SQLite local) vive en el service de Fase 3; acá solo la DECISIÓN de quién es candidato.
//
// Las tres operaciones (design §2.3):
//   - vacunación  (R4.1): base = todos los activos del grupo, + filtro OPCIONAL por categoría/sexo.
//                 El skip por idempotencia (already_applied) y por rodeo-sin-vacunación es del service
//                 (skip-and-report, R4.3) — acá solo el conjunto candidato base + filtro.
//   - castración  (R11.2 / D3): machos no castrados (terneros + adultos: ternero/torito/toro).
//                 Excluye hembras y ya-castrados POR CONSTRUCCIÓN (no aparecen como candidatos, R4.3).
//   - destete     (R11.4 / D4): terneros/as (ambos sexos) SIN destete previo (sin `weaning` no borrado).
//                 En lote cross-rodeo: EXCLUYE los de rodeo sin `destete` habilitado, con contador
//                 (equivalente del skip-and-report en el modelo de selección, R7.2 — D9 validada).
//
// El espejo C6 (categoría display-only) decide la CATEGORÍA real offline; acá se usa el `categoryCode`
// ya derivado por el caller (el service lo computa con el espejo antes de armar candidatos) — NO se
// recomputa categoría acá. is_castrated / future_bull / animal_sex vienen del perfil local (post-denorm
// 0084/0085, b1) — el armado funciona 100% offline (design §2.3 nota).

import type { AnimalSex } from './animal-category';

/** Las operaciones masivas con candidatos derivados de la base del grupo (MVP, R1.4). */
export type BulkOperation = 'vaccinate' | 'castrate' | 'wean';

/**
 * Forma mínima de un perfil activo del grupo para decidir candidatura. La cumplen las filas del SQLite
 * local (animal_profiles + identidad denormalizada b1 + el `categoryCode` derivado por el espejo C6).
 * `status`/`deletedAt` se incluyen para el filtro defensivo de R1.3 (la lista local ya filtra activos,
 * pero el armado es explícito: solo `active` y no-soft-deleted entran).
 */
export type GroupProfile = {
  /** animal_profiles.id (el target del UPDATE de castración / del INSERT de evento). */
  profileId: string;
  /** Rodeo real del perfil (animal_profiles.rodeo_id) — para resolver el gating cross-rodeo (R7.2). */
  rodeoId: string;
  /** Sexo denormalizado (b1). null = desconocido (no candidato a castración, que es male-only). */
  sex: AnimalSex | null;
  /** Categoría code YA derivada por el espejo C6 (el service la computa antes de armar candidatos). */
  categoryCode: string;
  /** animal_profiles.is_castrated denormalizado (0084). Excluye candidatos de castración (D3). */
  isCastrated: boolean;
  /** animal_profiles.future_bull (0085). NO excluye candidatos, pero el default de selección lo lee (R11.3). */
  futureBull: boolean;
  /** ¿El ternero/a YA tiene un `weaning` no borrado? Excluye candidatos de destete (R11.4). */
  hasWeaning: boolean;
  /** status del perfil (R1.3: solo 'active'). */
  status: string;
  /** deleted_at del perfil (R1.3: solo NULL). */
  deletedAt: string | null;
  /**
   * animal_profiles.category_override. NO afecta la CANDIDATURA (un animal con override sigue siendo
   * candidato de castración/destete — la mutación se aplica igual; lo que NO transiciona es su categoría,
   * 0064/0063 respetan el override). Lo lee SOLO el desglose de la selección (T-CL.3) para el aviso de
   * R5.6 en el bottom-sheet ("N con categoría fijada manual no van a cambiar de categoría"). Opcional para
   * no acoplar el armado de candidatos: default `false` donde no se provee. */
  categoryOverride?: boolean;
};

/** Filtro OPCIONAL de la vacunación masiva (R4.1): por categoría y/o sexo. null/undefined = sin filtro. */
export type VaccinationFilter = {
  /** Restringe a estos `categoryCode` (subconjunto). undefined/[] = sin filtro de categoría. */
  categoryCodes?: readonly string[];
  /** Restringe a este sexo. undefined = ambos sexos. */
  sex?: AnimalSex;
};

/** Resultado del armado de candidatos: la lista + (para destete cross-rodeo) el contador de excluidos. */
export type CandidatesResult = {
  /** Los perfiles candidatos de la operación (ya filtrados por las reglas D3/D4/R4.1). */
  candidates: GroupProfile[];
  /**
   * Excluidos POR CONFIGURACIÓN DEL RODEO (solo destete cross-rodeo, R7.2): terneros cuyo rodeo real
   * no tiene `destete` habilitado. La UI muestra "N excluidos por configuración del rodeo" (equivalente
   * del skip-and-report en el modelo de selección — D9). 0 en vacunación/castración y en destete de un
   * solo rodeo habilitado.
   */
  excludedByRodeoConfig: number;
};

/** Las categorías de macho candidatas a castración (D3): terneros + adultos no castrados. */
const CASTRATION_CATEGORIES: ReadonlySet<string> = new Set(['ternero', 'torito', 'toro']);

/** Las categorías candidatas a destete (D4): terneros/as de ambos sexos. */
const WEANING_CATEGORIES: ReadonlySet<string> = new Set(['ternero', 'ternera']);

/** ¿El perfil está activo y no soft-deleted? (R1.3 — base común de las 3 operaciones). */
function isActive(p: GroupProfile): boolean {
  return p.status === 'active' && p.deletedAt == null;
}

/**
 * Arma el conjunto candidato de una operación masiva sobre la base de activos de un grupo (R1.3).
 *
 * `rodeoWeaningEnabled` es un predicado `(rodeoId) => boolean` que responde si ese rodeo tiene `destete`
 * habilitado en su `rodeo_data_config` (el service lo resuelve del SQLite local, cacheado offline). SOLO
 * se consulta para `wean` (R7.2): para `vaccinate`/`castrate` no aplica (vacunación gatea por animal en
 * el service vía skip-and-report; castración no se gatea, R1.5). Si no se pasa, se asume habilitado
 * (caso de un solo rodeo ya filtrado por la vista de grupo).
 *
 * `filter` SOLO aplica a `vaccinate` (R4.1). PURA: no toca red ni SQLite — el caller le pasa los perfiles.
 */
export function buildBulkCandidates(
  operation: BulkOperation,
  profiles: readonly GroupProfile[],
  options: {
    filter?: VaccinationFilter;
    rodeoWeaningEnabled?: (rodeoId: string) => boolean;
  } = {},
): CandidatesResult {
  const base = profiles.filter(isActive);

  if (operation === 'vaccinate') {
    return { candidates: applyVaccinationFilter(base, options.filter), excludedByRodeoConfig: 0 };
  }

  if (operation === 'castrate') {
    // D3 / R11.2: machos no castrados, terneros + adultos (ternero/torito/toro). Hembras y ya-castrados
    // quedan EXCLUIDOS por construcción (no son candidatos, R4.3) — no hay skip-report en castración.
    const candidates = base.filter(
      (p) => p.sex === 'male' && !p.isCastrated && CASTRATION_CATEGORIES.has(p.categoryCode),
    );
    return { candidates, excludedByRodeoConfig: 0 };
  }

  // operation === 'wean' — D4 / R11.4: terneros/as sin destete previo. En lote cross-rodeo, EXCLUIR los
  // de rodeo sin `destete` habilitado, contando cuántos quedaron fuera por configuración (R7.2 / D9).
  const weanable = base.filter(
    (p) => WEANING_CATEGORIES.has(p.categoryCode) && !p.hasWeaning,
  );
  const enabled = options.rodeoWeaningEnabled;
  if (!enabled) {
    return { candidates: weanable, excludedByRodeoConfig: 0 };
  }
  const candidates: GroupProfile[] = [];
  let excludedByRodeoConfig = 0;
  for (const p of weanable) {
    if (enabled(p.rodeoId)) {
      candidates.push(p);
    } else {
      excludedByRodeoConfig += 1;
    }
  }
  return { candidates, excludedByRodeoConfig };
}

/** Aplica el filtro opcional de la vacunación (R4.1): por categoría (subconjunto) y/o sexo. */
function applyVaccinationFilter(
  base: readonly GroupProfile[],
  filter: VaccinationFilter | undefined,
): GroupProfile[] {
  if (!filter) return [...base];
  const codes = filter.categoryCodes && filter.categoryCodes.length > 0
    ? new Set(filter.categoryCodes)
    : null;
  return base.filter((p) => {
    if (codes && !codes.has(p.categoryCode)) return false;
    if (filter.sex && p.sex !== filter.sex) return false;
    return true;
  });
}
