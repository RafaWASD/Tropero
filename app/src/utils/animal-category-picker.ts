// Filtrado PURO de las categorías del picker de la alta guiada por sexo (alta guiada A, paso 3).
// Sin RN, sin red: testeable con node:test.
//
// La tabla categories_by_system NO tiene columna de sexo → mapeamos por `code` (codes FIJOS del
// catálogo de cría, ADR-008 enmendado). El picker es CERRADO: ofrece SOLO las categorías del sexo
// elegido, en el orden del catálogo (sort_order, ya aplicado por fetchSystemCategories).
//
// Mapeo (context-alta-guiada §2 + ADR-008 enmendado):
//   macho  = ternero, torito, toro, novillito, novillo
//   hembra = ternera, vaquillona, vaquillona_prenada, vaca_segundo_servicio, multipara
// Quedan AFUERA del alta guiada (no son elegibles al dar de alta): `cut` (marca de descarte
// ortogonal, se gatilla por dientes, no es un estado a elegir) y `vaca_cabana` (categoría de cabaña,
// fuera del MVP de cría). Un code que no esté en ninguna de las dos listas NO se ofrece (defensivo:
// no adivinamos el sexo de un code desconocido).

import type { AnimalSex } from './animal-category';
import type { SystemCategory } from '../services/animals';

/** Codes de categoría de MACHO ofrecidos en la alta guiada (orden de catálogo lo da sort_order). */
export const MALE_CATEGORY_CODES: readonly string[] = [
  'ternero',
  'torito',
  'toro',
  'novillito',
  'novillo',
];

/** Codes de categoría de HEMBRA ofrecidos en la alta guiada. */
export const FEMALE_CATEGORY_CODES: readonly string[] = [
  'ternera',
  'vaquillona',
  'vaquillona_prenada',
  'vaca_segundo_servicio',
  'multipara',
];

/**
 * Filtra el catálogo de categorías del sistema por el sexo elegido (picker cerrado, paso 3). Devuelve
 * SOLO las categorías cuyo `code` está en la lista del sexo, PRESERVANDO el orden de entrada (que ya
 * viene por sort_order del catálogo). No inventa categorías ni cambia los names: solo filtra.
 */
export function categoriesForSex(
  categories: readonly SystemCategory[],
  sex: AnimalSex,
): SystemCategory[] {
  const allowed = sex === 'male' ? MALE_CATEGORY_CODES : FEMALE_CATEGORY_CODES;
  return categories.filter((c) => allowed.includes(c.code));
}

// ─── Selector de categoría de la FICHA (delta ficha-categoria-tacto, RCM.2) ─────────────────────
//
// Mismo filtro por sexo del alta (arriba) + el eje CASTRACIÓN para machos (P1, resuelto en la Puerta 1).
// POR QUÉ se recorta el "cualquier categoría del mismo sexo": ofrecerle "Novillo" a un animal cuyo
// `is_castrated` es `false` produce un estado que se contradice a sí mismo, y ese eje YA tiene su control
// propio en la MISMA ficha ("Manejo → Castrado", R13.1), que además recalcula la categoría solo.
//
// El recorte es DERIVADO del espejo, no una lista paralela: `computeCategoryCode` (animal-category.ts, rama
// macho de 0062) devuelve, sin eventos, `ternero` (<1 año) / `torito`|`novillito` ([1,2)) / `toro`|`novillo`
// (≥2) según `is_castrated`. `ternero` está en las DOS ramas a propósito: el corte de <1 año no distingue
// castración. Para la HEMBRA el eje no aplica → las 5 de FEMALE_CATEGORY_CODES.

/** Codes de MACHO ENTERO (is_castrated=false) ofrecidos en el selector de la ficha (RCM.2.3). */
const MALE_ENTIRE_CATEGORY_CODES: ReadonlySet<string> = new Set(['ternero', 'torito', 'toro']);
/** Codes de MACHO CASTRADO (is_castrated=true) ofrecidos en el selector de la ficha (RCM.2.3). */
const MALE_CASTRATED_CATEGORY_CODES: ReadonlySet<string> = new Set(['ternero', 'novillito', 'novillo']);

/**
 * Categorías OFRECIBLES para fijar a mano desde la ficha (RCM.2). Filtra el catálogo del sistema del rodeo
 * REAL del animal por:
 *   1. el SEXO — reusando `MALE_CATEGORY_CODES` / `FEMALE_CATEGORY_CODES` (fuente única del mapeo sexo↔code,
 *      que ya excluye `cut` (RCM.2.4) y `vaca_cabana` (RCM.2.5));
 *   2. para MACHOS, la CASTRACIÓN real (RCM.2.3): `false` → ternero/torito/toro; `true` →
 *      ternero/novillito/novillo. Para HEMBRAS no aplica (las 5 codes).
 *
 * PRESERVA el orden de entrada (el `sort_order` del catálogo). PURA (RCM.2.6): sin RN, sin red, sin SDK.
 * Catálogo vacío / sin ninguno de esos codes → `[]` → la ficha NO ofrece "Cambiar" (fail-safe, RCM.1.3).
 */
export function pickableCategories(
  categories: readonly SystemCategory[],
  sex: AnimalSex,
  isCastrated: boolean,
): SystemCategory[] {
  const bySex = categoriesForSex(categories, sex);
  if (sex !== 'male') return bySex;
  const allowed = isCastrated ? MALE_CASTRATED_CATEGORY_CODES : MALE_ENTIRE_CATEGORY_CODES;
  return bySex.filter((c) => allowed.has(c.code));
}
