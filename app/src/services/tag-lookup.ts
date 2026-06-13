// Lógica PURA de la rama BLE del find-or-create (spec 09 chunk "BLE global", RB4 / design §3.1-§3.2).
//
// SIN I/O, SIN imports de RN/expo/supabase: testeable con node:test (mismo patrón que
// services/transfer-animal.ts ↔ services/animals.ts::transferAnimal). Acá vive la DECISIÓN de las 3
// ramas (edit/transfer/create) a partir de las filas que `lookupByTag` (en animals.ts) lee del SQLite
// local; la I/O (las 2 queries `runLocalQuery`) vive en animals.ts::lookupByTag, que NO carga bajo
// node:test (importa `./supabase` → expo-secure-store).
//
// Por qué un módulo aparte: animals.ts no se puede importar en un test (carga el SDK/supabase). Extraer
// la decisión pura acá permite unit-testear las 3 ramas sin mockear el módulo entero.

/**
 * Resultado del lookup por TAG bastoneado (rama BLE del find-or-create, RB4.2). Distinto del
 * `LookupResult` de la puerta MANUAL (animals.ts) — otros modos:
 *   - `edit`     → hay un perfil activo con ese TAG en el campo ACTIVO → abrir la ficha (RB4.3).
 *   - `transfer` → no en el campo activo, pero SÍ activo en OTRO campo del usuario → ofrecer transferir
 *                  (spec 11, online-only). `sourceProfileId` = el perfil de origen; `otherFieldName` =
 *                  el name legible del otro campo (RB4.4 / DEC-3).
 *   - `create`   → sin match en ningún campo → alta con el TAG precargado (RB4.5 / DEC-2, DIRECTO a CREATE).
 */
export type TagLookupResult =
  | { mode: 'edit'; profileId: string }
  | { mode: 'transfer'; sourceProfileId: string; otherFieldName: string }
  | { mode: 'create' };

/** Una fila del lookup en el campo ACTIVO (buildSearchByTagQuery → LocalListRow; solo usamos el id). */
export type ActiveFieldTagRow = { id: string };

/** Una fila del lookup CROSS-CAMPO (buildLookupTagAcrossFieldsQuery, RB4.6). */
export type CrossFieldTagRow = {
  profile_id: string;
  establishment_id: string;
  establishment_name: string | null;
};

/**
 * Decide el modo del lookup por TAG a partir de las filas leídas del SQLite local (PURA, RB4.2-RB4.5).
 *
 * Orden de las ramas (NO conmutable):
 *   1. EDIT: si hay ≥1 fila activa en el campo ACTIVO (`activeFieldRows`) → `edit` con el primer profileId.
 *      La unicidad GLOBAL de `animals.tag_electronic` (spec 02) garantiza ≤1 perfil activo por campo.
 *   2. TRANSFER: si la rama 1 vino vacía, buscamos en `crossFieldRows` (cross-campo) la PRIMERA fila cuyo
 *      `establishment_id !== establishmentId` → `transfer`. Defensivo: ignoramos una fila que SEA del campo
 *      activo (no debería estar — esa la habría tomado la rama 1; pero si el set cross-campo la incluye, no
 *      la confundimos con "otro campo").
 *   3. CREATE: si nada matcheó → `create` (DIRECTO, sin el intermediate de opción A — DEC-2, diferido).
 *
 * @param activeFieldRows  filas de buildSearchByTagQuery(establishmentId, tag) — scopeadas al campo activo.
 * @param crossFieldRows   filas de buildLookupTagAcrossFieldsQuery(tag) — sin filtro de campo.
 * @param establishmentId  el campo ACTIVO (para distinguir "otro campo" en crossFieldRows).
 */
export function resolveTagLookup(params: {
  activeFieldRows: readonly ActiveFieldTagRow[];
  crossFieldRows: readonly CrossFieldTagRow[];
  establishmentId: string;
}): TagLookupResult {
  const { activeFieldRows, crossFieldRows, establishmentId } = params;

  // Rama 1 — EDIT: match activo en el campo activo.
  if (activeFieldRows.length > 0) {
    return { mode: 'edit', profileId: activeFieldRows[0].id };
  }

  // Rama 2 — TRANSFER: activo en OTRO campo del usuario. Tomamos la primera fila de OTRO campo (defensivo:
  // ignoramos una fila que sea del campo activo — esa la habría tomado la rama 1).
  const other = crossFieldRows.find((r) => r.establishment_id !== establishmentId);
  if (other) {
    return {
      mode: 'transfer',
      sourceProfileId: other.profile_id,
      // name del catálogo local; si por algún motivo no bajó, copy genérico (la UI siempre tiene algo que mostrar).
      otherFieldName: other.establishment_name ?? 'otro campo',
    };
  }

  // Rama 3 — CREATE: sin match en ningún campo.
  return { mode: 'create' };
}
