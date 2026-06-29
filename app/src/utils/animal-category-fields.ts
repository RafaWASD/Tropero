// Mapeo PURO "datos por categoría" de la alta guiada (sub-chunk B, dominio Facundo §2). Sin RN, sin
// red: testeable con node:test (mismo patrón que animal-category-picker.ts).
//
// El paso "datos" del wizard deja de ser un form plano (C2) y muestra SOLO los campos relevantes a
// (sexo, categoría). El "qué campos por categoría" está HARDCODEADO (la tabla §2 es fija; config es
// over-engineering MVP, ver context-alta-guiada §"Decisiones tomadas"). Todos los datos ya existen en
// la DB (columnas o eventos) — esto es frontend puro de presentación.
//
// Tabla §2 (con las correcciones de Facundo 2026-06-04: CC no en recría; dientes solo vacas/toros;
// toro sin peso; preñez solo en hembra preñable; cría al pie solo vacas):
//
//   Base (TODAS): identificación · raza · pelaje · año de nacimiento · lote.   (no se listan acá)
//   recría (ternero/ternera/vaquillona/novillito/novillo/torito): peso.
//   adultas repro (vaca_segundo_servicio/multipara):  dientes · condición corporal · preñez · cría al pie.
//   toro:                                             dientes · condición corporal.
//   vaquillona_prenada:                               preñez · condición corporal.
//
// `peso` = entry_weight (columna). `dientes` = teeth_state (columna). `criaAlPie` = nursing (columna).
// `condicion` = condition_score_event (evento post-create). `preñez` = reproductive_event tacto (evento
// post-create). Ver crear-animal.tsx / animals.ts / events.ts para CÓMO se captura cada uno.

/**
 * Campos de datos EXTRA (más allá de la base) que el alta guiada pregunta por categoría. La base
 * (identificación · raza · pelaje · año de nacimiento · lote) se muestra SIEMPRE y NO está acá.
 */
export type CategoryDataField = 'weight' | 'teeth' | 'conditionScore' | 'pregnancy' | 'nursing';

/** Conjunto de campos extra que aplican a una categoría (orden estable de presentación). */
export type CategoryFields = readonly CategoryDataField[];

// Listas de codes por "perfil de datos" (la tabla §2). Codes FIJOS del catálogo de cría (0015/0059).
// Un code que no esté en ninguna lista → sin campos extra (defensivo: solo base; no inventamos datos).

/** Categorías de recría/engorde: el ÚNICO dato extra es el PESO (entry_weight). No condición, no dientes. */
const WEIGHT_ONLY_CODES: readonly string[] = [
  'ternero',
  'ternera',
  'vaquillona',
  'novillito',
  'novillo',
  'torito',
];

/** Vacas con servicio (2º servicio + multíparas): dientes · condición · preñez · cría al pie. */
const ADULT_FEMALE_CODES: readonly string[] = ['vaca_segundo_servicio', 'multipara'];

const ADULT_FEMALE_FIELDS: CategoryFields = ['teeth', 'conditionScore', 'pregnancy', 'nursing'];

/**
 * Devuelve los campos EXTRA (no-base) que el alta guiada pregunta para una categoría de (cría, sexo).
 * El mapeo es la tabla §2 (hardcodeada). Casos:
 *   - recría (ternero/ternera/vaquillona/novillito/novillo/torito) → ['weight'].
 *   - vaca_segundo_servicio / multipara → ['teeth','conditionScore','pregnancy','nursing'].
 *   - toro → ['teeth','conditionScore'].   (circunferencia escrotal DIFERIDA — no existe en DB.)
 *   - vaquillona_prenada → ['pregnancy','conditionScore'].
 *   - cualquier otro code (cut/vaca_cabana/desconocido) → [] (solo base; el picker tampoco los ofrece).
 *
 * `sex` se recibe por simetría con el picker y para futura divergencia por sexo, pero hoy el mapeo es
 * por `code` (los codes ya son sexo-específicos: 'toro' es macho, 'multipara' es hembra). Es PURO.
 */
export function fieldsForCategory(_sex: 'male' | 'female', code: string): CategoryFields {
  const c = code.trim();
  if (WEIGHT_ONLY_CODES.includes(c)) return ['weight'];
  if (ADULT_FEMALE_CODES.includes(c)) return ADULT_FEMALE_FIELDS;
  if (c === 'toro') return ['teeth', 'conditionScore'];
  if (c === 'vaquillona_prenada') return ['pregnancy', 'conditionScore'];
  // cut / vaca_cabana / code desconocido → solo base (sin extras). El picker tampoco los ofrece.
  return [];
}

/** ¿La categoría pide ESTE campo extra? Azúcar sobre fieldsForCategory para el render condicional. */
export function categoryHasField(
  sex: 'male' | 'female',
  code: string,
  field: CategoryDataField,
): boolean {
  return fieldsForCategory(sex, code).includes(field);
}

// ─── Dientes (boca): lista CERRADA del enum teeth_state con labels de campo (Facundo §2) ──────
//
// El enum DB `teeth_state_enum` (0020): '2d','4d','6d','boca_llena','3/4','1/2','1/4','sin_dientes'.
// Facundo da los labels de campo. El selector es CERRADO (nunca texto libre) → el valor elegido SIEMPRE
// cumple el CHECK del enum. Fuente de verdad (estilo PREGNANCY_OPTIONS), ordenada de "menos boca" a
// "boca llena" (progresión natural de la edad/desgaste dentario).

/** Un valor válido del enum `teeth_state_enum` (DB 0020). */
export type TeethState =
  | 'sin_dientes'
  | '1/4'
  | '1/2'
  | '3/4'
  | '2d'
  | '4d'
  | '6d'
  | 'boca_llena';

/**
 * Opciones del selector CERRADO de DIENTES (teeth_state). value = enum DB; label = término de campo
 * (Facundo §2). Orden de presentación: gastada → joven (FIX #12, 2026-06-29 — pedido de Raf: descarte/
 * vejez arriba, boca llena al medio, dientes de leche en bajada). MISMO orden que `teeth-options.ts`
 * (la maniobra) — alta y maniobra muestran la lista igual.
 */
export const TEETH_OPTIONS: readonly { value: TeethState; label: string }[] = [
  { value: 'sin_dientes', label: 'Sin dientes' },
  { value: '1/4', label: '1/4' },
  { value: '1/2', label: '1/2' },
  { value: '3/4', label: '3/4' },
  { value: 'boca_llena', label: 'Boca llena' },
  { value: '6d', label: '6 dientes' },
  { value: '4d', label: '4 dientes' },
  { value: '2d', label: '2 dientes' },
];

const TEETH_VALUES: ReadonlySet<string> = new Set(TEETH_OPTIONS.map((o) => o.value));

/** ¿Es `v` un valor válido del enum teeth_state? (defensa: el selector cerrado ya lo garantiza). */
export function isValidTeethState(v: string | null | undefined): v is TeethState {
  return v != null && TEETH_VALUES.has(v);
}
