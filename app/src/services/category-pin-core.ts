// category-pin-core.ts — núcleo PURO de la orquestación de FIJAR LA CATEGORÍA A MANO desde la ficha
// (delta spec 02 `ficha-categoria-tacto`, RCM.5 / RCM.6).
//
// `setCategoryManual` (animals.ts) es un orquestador delgado: resuelve LOCALMENTE (a) el `category_id` del
// code ELEGIDO en el catálogo del sistema del rodeo y (b) la categoría DERIVADA por el espejo
// (`resolveRevertCategory`, la MISMA resolución que "Quitar fijación" ⇒ no divergen), y según eso escribe UNO
// de dos UPDATEs o devuelve un error accionable SIN escribir. Esa DECISIÓN se factoriza acá como una función
// PURA con los writes INYECTADOS → testeable con fakes, sin SDK/red/SQLite.
//
// POR QUÉ el núcleo existe (TCUT.7, precedente literal `cut-service-core.ts`): los services VALUE-IMPORTAN el
// SDK de Supabase/PowerSync y NO son importables bajo `node:test`. Sin este archivo, los cuatro caminos de
// abajo solo se podrían testear por E2E.
//
// LA REGLA, EN UNA LÍNEA (design §2.1): `override = (categoría elegida ≠ categoría derivada)`.
//   - elegida ≠ derivada → FIJAR   (`buildSetCategoryOverrideUpdate`, override=1) — RCM.5.1
//   - elegida = derivada → VOLVER A AUTOMÁTICO (`buildRevertCategoryOverrideUpdate`, override=0) — RCM.5.2
// Es EXACTAMENTE el invariante que ya establece el alta (`categoryOverrideFor`), extendido del espejo
// reducido del alta (sexo + fecha) al espejo COMPLETO (sexo + fecha + is_castrated + eventos). Por eso elegir
// la categoría automática EQUIVALE a quitar la fijación (P2, resuelto en la Puerta 1): fijarla igual
// congelaría sin querer un animal que el sistema ya venía derivando bien.

/** Forma mínima de un error propagable (misma que `cut-service-core.ts`: el caller elige el enum concreto). */
export type PinCoreError = {
  kind: 'network' | 'unknown' | 'duplicate_tag' | 'duplicate_idv';
  message: string;
};

/** Resultado uniforme (ok con valor, o error). Estructuralmente compatible con `ServiceResult<T>`. */
export type PinCoreResult<T, E extends PinCoreError = PinCoreError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** La categoría ELEGIDA por el usuario, ya resuelta contra el catálogo local. `null` = no resolvió. */
export type ChosenCategory = { code: string; categoryId: string } | null;

/** La categoría DERIVADA por el espejo, ya resuelta a id. `null` = no resoluble localmente. */
export type DerivedCategory = { code: string; categoryId: string } | null;

/** Resultado de un write local (ok, o error propagable). El `value` extra de `runLocalWrite` se tolera. */
export type PinWriteOutcome<E extends PinCoreError = PinCoreError> =
  | { ok: true; value?: unknown }
  | { ok: false; error: E };

/** Lo que devuelve la decisión al caller: qué quedó (para el optimismo EN SITIO, RCM.6.5). */
export type PinOutcome = { override: boolean; categoryCode: string };

// Mensajes es-AR (voseo), fijados acá para pinearlos en el test y reusarlos desde animals.ts.

/**
 * El code elegido NO tiene fila ACTIVA en el catálogo local del sistema (RCM.6.2). NO se escribe nada: fijar
 * un `category_id` inexistente/ajeno al sistema lo rechazaría el trigger `animal_profiles_category_check`
 * (`0021`) con 23514 AL SUBIR, o sea mucho después y sin que el operario entienda por qué.
 */
export const PIN_CATEGORY_UNRESOLVED_MESSAGE =
  'No pudimos resolver esa categoría en este rodeo. Probá de nuevo cuando termine de sincronizar.';

/**
 * Caso RCM.5.2 (volver a automático) con la DERIVADA irresoluble (RCM.6.3): mismo mensaje accionable que
 * RC6.4.5 ("Quitar fijación"), porque es literalmente la misma operación y el mismo motivo.
 */
export const PIN_DERIVED_UNRESOLVED_MESSAGE =
  'No pudimos calcular la categoría automática de este animal. Probá de nuevo cuando se sincronice el campo.';

/**
 * Decide + ejecuta la fijación manual de categoría (RCM.5/RCM.6). Cuatro caminos, sin ningún otro:
 *
 *   1. `chosen` NO resuelto (null)                    → error es-AR, **sin escribir** (RCM.6.2).
 *   2. `chosen.code === derived.code`                 → write de REVERT con el id de la DERIVADA
 *                                                       (`override = false`, RCM.5.2).
 *   3. `chosen.code !== derived.code`, o `derived`
 *      irresoluble (null)                             → write de FIJACIÓN con el id de la ELEGIDA
 *                                                       (`override = true`, RCM.5.1/RCM.6.3).
 *   4. write que falla                                → propaga el error tal cual (el caller revierte su
 *                                                       optimismo).
 *
 * SOBRE EL CASO 3 CON `derived === null` (RCM.6.3): que el espejo no resuelva la derivada NO puede impedir
 * FIJAR — fijar no la necesita (el id que se escribe es el de la elegida). Solo el caso 2 (volver a
 * automático) la requiere, y ahí la comparación `chosen.code === derived.code` es inalcanzable sin derivada,
 * así que se cae naturalmente en "fijar". Es el comportamiento correcto: con la derivada desconocida, la
 * elección del usuario es, por definición, distinta de lo que el sistema puede afirmar.
 *
 * ⚠️ El caller NO debe pre-comparar los codes ni elegir el builder: toda la decisión vive acá.
 */
export async function decideCategoryPin<E extends PinCoreError>(args: {
  chosen: ChosenCategory;
  derived: DerivedCategory;
  /** Write del caso FIJAR (en prod: `runLocalWrite(buildSetCategoryOverrideUpdate(profileId, id))`). */
  writePin: (categoryId: string) => Promise<PinWriteOutcome<E>>;
  /** Write del caso VOLVER A AUTOMÁTICO (en prod: `buildRevertCategoryOverrideUpdate`). */
  writeRevert: (categoryId: string) => Promise<PinWriteOutcome<E>>;
}): Promise<PinCoreResult<PinOutcome, E>> {
  const { chosen, derived, writePin, writeRevert } = args;

  // (1) Sin id de la elegida no se escribe NADA (RCM.6.2). Es el fail-safe hermano de `setCut` (RCUT.1.2).
  if (chosen == null || chosen.categoryId.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: PIN_CATEGORY_UNRESOLVED_MESSAGE } as E };
  }

  // (2) La elegida ES la que el sistema derivaría → volver a automático (RCM.5.2, P2).
  if (derived != null && derived.code === chosen.code) {
    if (derived.categoryId.length === 0) {
      // Derivada "resuelta" pero sin id utilizable: no escribimos un category_id vacío (RCM.6.3).
      return { ok: false, error: { kind: 'unknown', message: PIN_DERIVED_UNRESOLVED_MESSAGE } as E };
    }
    const w = await writeRevert(derived.categoryId);
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, value: { override: false, categoryCode: derived.code } };
  }

  // (3) Difiere (o la derivada no es resoluble) → FIJAR con el id de la elegida (RCM.5.1/RCM.6.3).
  const w = await writePin(chosen.categoryId);
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, value: { override: true, categoryCode: chosen.code } };
}
