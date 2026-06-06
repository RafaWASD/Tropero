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
