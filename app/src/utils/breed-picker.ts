// app/src/utils/breed-picker.ts — lógica PURA del picker de raza del catálogo SENASA (spec 08, T13 /
// R1.4 UX, R8.3, decisión 1 del leader 2026-06-24).
//
// El BreedPickerSheet (BreedPickerSheet.tsx) ofrece, EN ORDEN:
//   1) "Sin raza — a completar" (selecciona null → el animal queda "a completar" para SIGSA, R8.2).
//   2) cada raza BOVINA ACTIVA del catálogo, ordenada por `sort_order` (pampeanas frecuentes primero).
// Cada opción lleva: el código SENASA (ej. "AA"), el nombre ("Aberdeen Angus") y su estado `selected`
// derivado del código actualmente elegido (`selectedCode`).
//
// DECISIÓN 1 (leader 2026-06-24, design §BreedPicker): `OR` (Otra Raza) NO se promueve — se renderiza en su
// `sort_order` natural (28 = última entre las bovinas), sin flotar al tope ni como CTA destacada. Razón:
// bajo presión de manga, un `OR` promovido se vuelve el default perezoso y degrada el benchmarking/analytics
// (uno de los 3 pilares). `S/E` (Sin Especificar, species='generic') queda FUERA del picker bovino.
//
// FILTRO (qué entra al picker): species === 'bovine' AND active === true. Las 3 bubalinas (active=false) y
// el S/E (generic) NO aparecen. El ORDEN: por sort_order ASC (nulls al final, estable por código). La BÚSQUEDA
// (filtra por nombre o código, case/acentos-insensitive) la aplica `filterBreedOptions` sobre la lista ya
// ordenada — separada para testear el orden y el filtro por separado.
//
// Por qué helper puro y no inline: la regla de selección tiene bordes (selectedCode null → "Sin raza"
// seleccionada; un selectedCode que NO matchea ninguna raza visible → NINGUNA opción seleccionada, ni
// "Sin raza") + el filtro de búsqueda + la normalización de acentos merecen test propio, fuera del render.
//
// NO conoce React ni Tamagui ni red: solo arma/filtra la lista. La fuente (breed_catalog del SQLite local)
// la lee el service (fetchBreedCatalog); este helper recibe el array ya cargado.

/** Una raza del catálogo, tal como la entrega el service (subset de breed_catalog que el picker usa). */
export type BreedCatalogEntry = {
  /** breed_catalog.id (FK que se guarda en animal_profiles.breed_id). */
  id: string;
  /** breed_catalog.senasa_code (ej. 'AA', 'H', 'OR'). Se muestra como chip + alimenta la búsqueda. */
  senasaCode: string;
  /** breed_catalog.name (ej. 'Aberdeen Angus'). */
  name: string;
  /** breed_catalog.species ('bovine' | 'bubaline' | 'generic'). Solo 'bovine' entra al picker bovino. */
  species: string;
  /** breed_catalog.active. Solo las activas entran (las 3 bubalinas son active=false). */
  active: boolean;
  /** breed_catalog.sort_order (orden de display; nulls al final). */
  sortOrder: number | null;
};

/** Una opción del picker de raza: id (null = "Sin raza"), código + nombre a mostrar, y si está seleccionada. */
export type BreedPickerOption = {
  /** breed_catalog.id, o `null` para la opción "Sin raza — a completar" (deja breed_id null, R8.2). */
  id: string | null;
  /** Código SENASA a mostrar como chip (ej. 'AA'). Vacío para "Sin raza". */
  senasaCode: string;
  /** Nombre a mostrar ("Aberdeen Angus" / "Sin raza — a completar"). */
  name: string;
  /** ¿Es la opción actualmente asignada al animal? (deriva de `selectedCode`). */
  selected: boolean;
};

/** Etiqueta es-AR de la opción "ninguna raza" — deja `breed_id` null (animal "a completar" para SIGSA). */
export const SIN_RAZA_LABEL = 'Sin raza — a completar';

/**
 * Normaliza un string para búsqueda case/acentos-insensitive: lowercase + NFD + strip de diacríticos
 * combinantes (á→a, ñ→n vía descomposición). Pura, nunca lanza. (es-AR: el usuario tipea "angus" y matchea
 * "Aberdeen Angus"; tipea "ha" y matchea el código "HA" o cualquier nombre con "ha").
 */
export function normalizeForSearch(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Arma las opciones del picker de raza en su orden canónico (design §BreedPicker, decisión 1):
 *   1) "Sin raza — a completar" (id `null`) — seleccionada SSI `selectedCode == null` (sin raza hoy).
 *   2) cada raza BOVINA ACTIVA del catálogo, ordenada por sort_order ASC (nulls al final, tie-break por
 *      código) — seleccionada SSI `b.senasaCode === selectedCode`. `OR` queda en su sort_order natural (28),
 *      NO promovido.
 *
 * Borde importante (testeado): si `selectedCode` NO es null pero NO matchea ninguna raza visible (un código
 * legacy raro, o una raza inactiva que no entra al picker), NINGUNA opción queda `selected` — NI "Sin raza".
 * No "caemos" a Sin-raza como seleccionada (mentiría: el animal SÍ tiene un código, solo que no en la lista).
 *
 * @param breeds       el catálogo cargado del SQLite local (todas las filas; este helper filtra bovine+active).
 * @param selectedCode el senasa_code actualmente elegido, o null (sin raza). Se compara case-SENSITIVE (los
 *                     códigos del catálogo son grafías literales del manual: 'AA', 'S/E' — no se uppercasea).
 */
export function breedPickerOptions(
  breeds: BreedCatalogEntry[],
  selectedCode: string | null,
): BreedPickerOption[] {
  const bovineActive = breeds
    .filter((b) => b.species === 'bovine' && b.active === true)
    .sort(compareBySortOrder);

  const options: BreedPickerOption[] = [
    { id: null, senasaCode: '', name: SIN_RAZA_LABEL, selected: selectedCode == null },
  ];
  for (const b of bovineActive) {
    options.push({
      id: b.id,
      senasaCode: b.senasaCode,
      name: b.name,
      selected: selectedCode != null && b.senasaCode === selectedCode,
    });
  }
  return options;
}

/**
 * Filtra una lista YA ARMADA de opciones por el texto de búsqueda (R8.3 UX): matchea por NOMBRE o CÓDIGO
 * (normalizados, case/acentos-insensitive). La opción "Sin raza" (id null) se CONSERVA SIEMPRE (es la salida
 * para "no sé la raza", no se debe filtrar al tipear). Query vacía/espacios → devuelve la lista tal cual.
 *
 * Pura: no muta el input (devuelve un array nuevo).
 */
export function filterBreedOptions(
  options: BreedPickerOption[],
  query: string,
): BreedPickerOption[] {
  const q = normalizeForSearch(query);
  if (q.length === 0) return options.slice();
  return options.filter((opt) => {
    if (opt.id === null) return true; // "Sin raza" siempre disponible (no se filtra)
    return (
      normalizeForSearch(opt.name).includes(q) || normalizeForSearch(opt.senasaCode).includes(q)
    );
  });
}

/**
 * Resuelve el `senasa_code` de una raza a partir de su NOMBRE (texto libre de `animal_profiles.breed`), por
 * match normalizado (lower + trim + acentos), espejando el match del trigger derive-breed_id (0113). Lo usa la
 * FICHA: el animal guarda la raza como `breed` (nombre); el BreedPickerSheet espera el `selectedCode`
 * (senasa_code) para marcar la opción vigente → esta función traduce nombre → código. Devuelve null si el
 * nombre es null/vacío o no matchea ninguna raza del catálogo (raza legacy/texto raro → ninguna opción
 * preseleccionada, consistente con breedPickerOptions). Pura.
 */
export function breedCodeForName(
  breeds: BreedCatalogEntry[],
  breedName: string | null,
): string | null {
  if (breedName == null) return null;
  const target = normalizeForSearch(breedName);
  if (target.length === 0) return null;
  const b = breeds.find((x) => normalizeForSearch(x.name) === target);
  return b ? b.senasaCode : null;
}

/**
 * Resuelve el nombre + código de la raza ACTUALMENTE elegida (para el resumen del trigger "Elegir raza" del
 * form). Devuelve null si no hay raza (selectedCode null) o si el código no matchea ninguna raza del catálogo.
 * Pura.
 */
export function selectedBreedLabel(
  breeds: BreedCatalogEntry[],
  selectedCode: string | null,
): { senasaCode: string; name: string } | null {
  if (selectedCode == null) return null;
  const b = breeds.find((x) => x.senasaCode === selectedCode);
  return b ? { senasaCode: b.senasaCode, name: b.name } : null;
}

/** Orden por sort_order ASC; nulls al final; tie-break estable por código (grafía del manual). */
function compareBySortOrder(a: BreedCatalogEntry, b: BreedCatalogEntry): number {
  const sa = a.sortOrder == null ? Number.POSITIVE_INFINITY : a.sortOrder;
  const sb = b.sortOrder == null ? Number.POSITIVE_INFINITY : b.sortOrder;
  if (sa !== sb) return sa - sb;
  return a.senasaCode < b.senasaCode ? -1 : a.senasaCode > b.senasaCode ? 1 : 0;
}
