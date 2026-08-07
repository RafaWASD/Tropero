// ficha-tacto-offer.ts — decisión PURA de QUÉ TACTO ofrece la ficha de un animal (delta spec 02
// `ficha-categoria-tacto`, RTF.1 / RTF.2). Sin RN, sin red, sin SDK: testeable con node:test.
//
// ── EL PUNTO DE ESTE MÓDULO ES QUE NO TIENE LÓGICA DE DOMINIO PROPIA (RTF.1.3) ───────────────────────
// C2.2 del Gate 0 es explícito: la ficha ofrece el tacto que corresponda **con el mismo criterio que la
// maniobra**, no con uno nuevo. Así que esto COMPONE las dos capas que ya existen, en AND:
//
//   1. capa RODEO   — `resolveManeuverGating(maniobra, rodeoConfig)` (`maneuver-gating.ts`, ADR-021):
//                     `tacto` exige `prenez` **y** `tamano_prenez` enabled; `tacto_vaquillona` exige
//                     `tacto_vaquillona`. Es la capa 1 del mismo gating que el trigger `0054` re-valida
//                     server-side: no ofrecemos lo que el server rechazaría con 23514 al subir (RTF.1.4).
//   2. capa ANIMAL  — `appliesToAnimal(maniobra, {...})` (`maneuver-applicability.ts`), que ya encapsula el
//                     bug-B corregido en la manga: la preñez solo se tacta a hembras SERVIDAS y la aptitud
//                     solo a vaquillonas que todavía NO son aptas.
//
// Si mañana cambia el criterio de la manga, cambia el de la ficha sin tocar este archivo. Lo único que se
// agrega acá es el gate de `status === 'active'` (RTF.1.2 — un archivado no recibe eventos nuevos, igual que
// el resto de las acciones de la ficha) y la precedencia defensiva de RTF.2.2.

import { appliesToAnimal, type AnimalApplicabilityInfo, type AnimalSex } from './maneuver-applicability';
import { resolveManeuverGating, type RodeoDataKeyMap } from './maneuver-gating';
import type { ReproStatus } from './repro-status';

/** El tacto que la ficha ofrece: de PREÑEZ o de APTITUD reproductiva. */
export type FichaTactoKind = 'prenez' | 'aptitud';

/** Todo lo que la decisión necesita, PLANO (lo lee el caller del `AnimalDetail`). */
export type FichaTactoOfferInput = {
  /** `status` del perfil. Solo `'active'` habilita (RTF.1.2). */
  status: string;
  sex: AnimalSex | null;
  /** `code` de la categoría VIGENTE (la del espejo C6, la misma que ve el operario en el badge). */
  categoryCode: string | null;
  isCastrated: boolean | null;
  /** Estado reproductivo vigente (`deriveReproStatus`). `undefined` → los predicados caen a su fail-safe. */
  reproStatus: ReproStatus | undefined;
  /**
   * `rodeo_data_config` del rodeo REAL del animal (`fetchRodeoGating(detail.rodeoId)`). Un mapa VACÍO
   * significa "no se pudo resolver" y, por construcción del gating, ninguna maniobra aplica → `null`
   * (fail-safe conservador, RTF.1.4 — el mismo criterio que el gate de CUT, RCUT.7.3).
   */
  rodeoConfig: RodeoDataKeyMap;
};

/**
 * ¿Qué tacto ofrece la ficha? `'prenez'` | `'aptitud'` | `null` (RTF.2.4).
 *
 * Devuelve COMO MUCHO UNO (RTF.2.1): los dos predicados de `appliesToAnimal` son disjuntos por construcción
 * —`tacto` exige una hembra SERVIDA (categoría probada ∨ `reproStatus ∈ {served_untested, pregnant, empty}`)
 * y `tacto_vaquillona` exige una vaquillona AÚN NO apta (`unknown` ∨ `fitness ≠ apta`)—, y hay un test de
 * disyunción que barre el producto cartesiano de estados para que siga siendo cierto. El `if` en cascada de
 * abajo es DEFENSA EN PROFUNDIDAD (RTF.2.2): si algún día dejaran de serlo, la ficha muestra el de PREÑEZ y
 * nunca dos CTAs — determinístico, no "el primero que matchee según el orden de un objeto".
 *
 * Cuando NINGUNO aplica (macho, ternera, vaquillona ya apta sin servicio, CUT, archivado, rodeo sin el
 * data_key) NO hay CTA: no se muestra un botón deshabilitado ni un cartel de error (RTF.2.3) — simplemente
 * no está.
 */
export function resolveFichaTactoOffer(input: FichaTactoOfferInput): FichaTactoKind | null {
  if (input.status !== 'active') return null; // RTF.1.2

  const animal: AnimalApplicabilityInfo = {
    sex: input.sex,
    categoryCode: input.categoryCode,
    isCastrated: input.isCastrated,
    reproStatus: input.reproStatus,
  };

  const prenez =
    resolveManeuverGating('tacto', input.rodeoConfig).applies && appliesToAnimal('tacto', animal);
  if (prenez) return 'prenez';

  const aptitud =
    resolveManeuverGating('tacto_vaquillona', input.rodeoConfig).applies &&
    appliesToAnimal('tacto_vaquillona', animal);
  if (aptitud) return 'aptitud';

  return null;
}

/** Copy es-AR del CTA por tipo de tacto (RTF.3.2): nombra el tacto que se va a hacer, no un genérico. */
export function fichaTactoCtaLabel(kind: FichaTactoKind): string {
  return kind === 'prenez' ? 'Tacto de preñez' : 'Tacto de aptitud';
}
