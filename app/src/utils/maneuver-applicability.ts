// Lógica PURA de APLICABILIDAD per-animal de una maniobra (spec 03 M3.1). Sin RN, sin red, sin SDK:
// testeable con node:test (mismo patrón que maneuver-gating.ts).
//
// Distinta de `maneuver-gating.ts` (que decide qué maniobras aplican según el RODEO real del animal,
// R5.5). Este módulo decide la aplicabilidad por ATRIBUTOS del propio animal (sexo, categoría):
//   - R6.12: el RASPADO de toros es solo para machos → se SALTA en una hembra (aunque el rodeo lo habilite).
//   - R6.2/R6.3 (bug B, correcciones-demo-facundo-padre): el TACTO de preñez (`tacto`) y el TACTO de aptitud
//     (`tacto_vaquillona`) NO son "cualquier hembra". Se distinguen por el ESTADO REPRODUCTIVO (reproStatus):
//     el tacto de PREÑEZ es solo para hembras SERVIDAS (categoría PROBADA o con evidencia de servicio/tacto
//     previo); el tacto de APTITUD es solo para VAQUILLONAS que AÚN NO son aptas. Una ternera no pasa por
//     ninguno; una vaquillona apta sin servicio tampoco. Un macho se SALTA ambos (un toro no se tacta).
//   - R6.9/R6.10: `pesaje` (peso de adulto/recría) y `pesaje_ternero` (peso de cría al pie) son
//     MUTUAMENTE EXCLUYENTES por CATEGORÍA — ambos mapean al mismo data_key `peso` (maneuver-gating), así que
//     SIN este filtro un animal pasaría por los DOS pasos de peso (el doble pesaje que reportó Raf). Un
//     ternero/ternera → solo `pesaje_ternero`; cualquier otra categoría (incl. desconocida) → solo `pesaje`.
//   - R6.8: el prompt CUT (transición por dientes) NO se ofrece para TERNEROS.
//   - R14.2/R14.3: la CIRCUNFERENCIA ESCROTAL es solo para machos ENTEROS no-ternero (categoría ∈
//     {torito, toro} ∧ is_castrated ≠ true) → se SALTA en hembras, terneros, novillos/castrados; castración
//     DESCONOCIDA (null) → se INCLUYE (entero por defecto — UX, no seguridad: mostrar la maniobra no escribe
//     dato prohibido; el gating capa 2 server-side cubre el rodeo).
//
// Son predicados PUROS para que M3.2 los use al secuenciar (saltar la maniobra / no mostrar el prompt). El
// orquestador (`maneuver-events.ts`) NO debe escribir un raspado de una hembra ni un CUT de un ternero —
// estos predicados son la barrera de cliente; el gating server-side cubre el rodeo, no el sexo/categoría.

import type { ManeuverKind } from './maneuver-gating';
import { isReproApt, PROVEN_FEMALE_CATEGORY_CODES, type ReproStatus } from './repro-status';
import type { HeiferFitness } from './maneuver-sequence';

export type AnimalSex = 'male' | 'female';

/** El subset de atributos del animal que la aplicabilidad per-animal necesita (lo lee el caller del SQLite). */
export type AnimalApplicabilityInfo = {
  /** Sexo del animal ('male' | 'female' | null si desconocido). Lo lee el caller de animal_profiles. */
  sex: AnimalSex | null;
  /**
   * `code` de la categoría ACTUAL del animal (ternero/ternera/vaquillona/…). Para el gate del prompt CUT
   * (R6.8: no para terneros) y la aplicabilidad de la CE (R14.2: solo torito/toro). null si no se pudo
   * resolver (fail-safe → se trata como NO-ternero salvo que el caller decida otra cosa; ver
   * shouldOfferCutPrompt).
   */
  categoryCode: string | null;
  /**
   * `is_castrated` REAL denormalizado del perfil activo (animal_profiles.is_castrated, spec 10 / 0084). Lo
   * lee el caller del SQLite local (mismo valor que AnimalDetail.isCastrated). Para la CE (R14.2/R14.3):
   * `true` → castrado → se SALTA; `false` → entero → aplica si la categoría es torito/toro; `null` →
   * castración DESCONOCIDA → se INCLUYE (entero por defecto, R14.3). Las demás maniobras no lo usan.
   */
  isCastrated: boolean | null;
  /**
   * Aptitud reproductiva VIGENTE (último `tacto_vaquillona`, RAR.6.1) — SOLO la consume `inseminacion`. La
   * provee el caller desde el espejo local (`deriveReproAptitude`). `undefined`/ausente → se trata como `null`
   * (sin veredicto): los call-sites legacy (DientesStep, tests de CE, etc.) NO la pasan y siguen funcionando.
   */
  aptitude?: HeiferFitness | null;
  /**
   * Estado reproductivo VIGENTE single-slot (delta spec 02 aptitud, RAR.4) — lo consumen los TACTOS (bug B,
   * correcciones-demo-facundo-padre): `tacto` (preñez) distingue una hembra SERVIDA (served_untested/pregnant/
   * empty o categoría PROBADA) de una que no fue servida; `tacto_vaquillona` (aptitud) distingue una vaquillona
   * AÚN NO apta (unknown / fitness≠apta) de una ya apta o ya servida. Es la MISMA fuente que la ficha
   * (`deriveReproStatus`, AnimalDetail.reproStatus) — encapsula la precedencia (no se recompone acá). La provee
   * el caller (carga.tsx). `undefined`/ausente → sin dato: los tactos caen a fail-safe (tacto → solo categorías
   * PROBADAS; tacto_vaquillona → se salta). Los call-sites legacy (DientesStep, tests de CE/pesaje) NO la pasan.
   */
  reproStatus?: ReproStatus;
  /**
   * Edad en DÍAS del animal (de `birth_date`, RAR.6.1) — SOLO la consume `inseminacion` (fallback de edad de
   * la vaquillona sin veredicto, RAR.6.2/6.5, espeja `0105`). `undefined`/`null` → sin edad → el fallback NO
   * aplica. La deriva el caller (`ageInDaysFromBirthDate`).
   */
  ageDays?: number | null;
};

// ─── Aplicabilidad per-animal por sexo/categoría (R6.12 raspado / R6.2-R6.3 tactos / R6.9-R6.10 pesaje) ───

/**
 * Los `code` de categoría de TERNERO/TERNERA (cría al pie). Usado por:
 *   - el prompt CUT, que NO aplica a estos (R6.8);
 *   - el split de pesaje: un ternero/ternera se pesa con `pesaje_ternero`, no con `pesaje` (R6.9/R6.10).
 */
const CALF_CATEGORY_CODES: ReadonlySet<string> = new Set(['ternero', 'ternera']);

/**
 * Los `code` de categoría de MACHO ENTERO no-ternero: `torito` (≥1 año entero) y `toro` (≥2 años entero).
 * Verificado en `animal-category.ts` (AnimalCategoryCode): los CASTRADOS son `novillito`/`novillo` (no entran
 * acá). Usado por la aplicabilidad de la CIRCUNFERENCIA ESCROTAL (R14.2): la CE solo aplica a estos códigos
 * con `is_castrated ≠ true`.
 */
const BULL_ENTIRE_CATEGORY_CODES: ReadonlySet<string> = new Set(['torito', 'toro']);

/**
 * ¿Este animal es un MACHO ENTERO no-ternero? (categoría ∈ {torito, toro} ∧ `is_castrated` ≠ true). Es el
 * MISMO criterio que la aplicabilidad de la CE (R14.2/R14.3) extraído como predicado reusable: la ficha
 * (M6-C.2) lo usa para mostrar la tarjeta de tendencia de CE SOLO a machos enteros (paridad con la fila
 * "Estado reproductivo" que solo se muestra a hembras). Castración DESCONOCIDA (`null`) → INCLUYE (entero
 * por defecto, R14.3 — es display/UX, no seguridad: la RLS server-side es la barrera real de la lectura).
 * `categoryCode` null (irresoluble) → false (no se muestra la tarjeta a un animal sin categoría resuelta).
 * PURO. Única fuente de verdad del set de categorías enteras (no se duplica el literal).
 */
export function isBullEntire(
  categoryCode: string | null | undefined,
  isCastrated: boolean | null | undefined,
): boolean {
  return (
    categoryCode != null &&
    BULL_ENTIRE_CATEGORY_CODES.has(categoryCode) &&
    isCastrated !== true
  );
}

/**
 * ¿El estado reproductivo evidencia que la hembra fue SERVIDA? (gate del tacto de PREÑEZ, bug B). true si ya
 * hay evidencia de servicio o de un tacto previo: `served_untested` (servida sin tacto — categoría probada o
 * evento `service`), `pregnant` o `empty` (ya tactada). Una vaquillona apta/sin evaluar (`fitness`/`unknown`),
 * una hembra CUT (`cut`), una ternera/macho (`none`) o sin dato (`undefined`) → false: NO fueron servidas, no se
 * tacta su preñez. PURO. `reproStatus` encapsula la precedencia RAR.2.4 (no se recompone acá).
 */
function isServedReproStatus(status: ReproStatus | undefined): boolean {
  return (
    status !== undefined &&
    (status.kind === 'served_untested' || status.kind === 'pregnant' || status.kind === 'empty')
  );
}

/**
 * ¿La vaquillona AÚN NO es apta y todavía NO fue servida? (gate del tacto de APTITUD, bug B). true SSI el
 * estado reproductivo es `unknown` (sin evaluar → candidata a la primera aptitud) o `fitness` con veredicto
 * ≠ 'apta' (no_apta/diferida → re-evaluar). Excluye: `fitness` apta (ya es apta), `served_untested`/`pregnant`/
 * `empty` (ya servida — precedencia > fitness, no se re-evalúa aptitud de una servida), `cut`, `none` y sin dato
 * (`undefined`, fail-safe → se salta). PURO. `reproStatus` es la fuente única (encapsula la precedencia RAR.2.4).
 */
function needsFitnessEvaluation(status: ReproStatus | undefined): boolean {
  if (status === undefined) return false;
  if (status.kind === 'unknown') return true;
  return status.kind === 'fitness' && status.fitness !== 'apta';
}

/**
 * ¿La maniobra APLICA a ESTE animal por sus atributos (sexo/categoría)? (per-animal, ortogonal al gating por
 * rodeo de maneuver-gating.ts). Las celdas validadas hoy (el resto de maniobras → `return true`; las demás
 * exclusiones por categoría quedan PENDIENTES de validar con Facundo):
 *
 *   - `raspado` (R6.12): solo MACHOS → una HEMBRA lo SALTA. Sexo desconocido (`null`) → se SALTA (fail-safe:
 *     no se escribe un raspado de campylo/trico sobre un animal cuyo sexo no se pudo confirmar; el operario
 *     corrige el sexo y vuelve a pasarlo).
 *   - `tacto` (R6.2, preñez) y `tacto_vaquillona` (R6.3, aptitud) — bug B (correcciones-demo-facundo-padre):
 *     NO son "cualquier hembra". `tacto` (preñez) aplica solo a hembras SERVIDAS (categoría PROBADA ∨
 *     reproStatus ∈ {served_untested, pregnant, empty}); `tacto_vaquillona` (aptitud) aplica solo a VAQUILLONAS
 *     que AÚN NO son aptas (reproStatus 'unknown' ∨ 'fitness' con veredicto ≠ 'apta'). Una ternera no pasa por
 *     ninguno; una vaquillona apta sin servicio tampoco; un MACHO los SALTA ambos (un toro no se tacta). Sexo
 *     desconocido (`null`) → se SALTA (fail-safe: no se tacta sin sexo confirmado). Ver isServedReproStatus /
 *     needsFitnessEvaluation (encapsulan la precedencia del reproStatus).
 *   - `pesaje` (R6.9) vs `pesaje_ternero` (R6.10): MUTUAMENTE EXCLUYENTES por categoría — ambos usan el data_key
 *     `peso`, así que sin este split el animal pasaría por los DOS pasos de peso (el doble pesaje de Raf).
 *       · `pesaje_ternero` aplica SSI `categoryCode ∈ CALF_CATEGORY_CODES` (ternero/ternera).
 *       · `pesaje` aplica SSI `categoryCode ∉ CALF_CATEGORY_CODES` — INCLUYE el caso `categoryCode == null`
 *         (categoría desconocida): se pesa como adulto (peso genérico) y NO como ternero (fail-safe — no se
 *         pesa-como-ternero un animal de categoría que no se pudo resolver).
 *
 * NO bloquea la fila: una maniobra saltada por atributo simplemente se omite; las demás corren.
 */
export function appliesToAnimal(maneuver: ManeuverKind, animal: AnimalApplicabilityInfo): boolean {
  switch (maneuver) {
    case 'raspado':
      // Raspado de toros: solo machos (R6.12). Sexo null → se salta (fail-safe).
      return animal.sex === 'male';
    case 'tacto':
      // Tacto de PREÑEZ (bug B): solo hembras SERVIDAS. Una hembra está servida si su categoría es PROBADA
      // (PROVEN_FEMALE_CATEGORY_CODES: vaquillona_preñada/vaca_segundo_servicio/multípara/vaca_cabaña — todas
      // "probadamente servidas", fuente única de repro-status.ts) O su estado reproductivo evidencia servicio
      // o tacto previo (served_untested = servida sin tacto; pregnant/empty = ya tactada). Una vaquillona APTA
      // pero SIN servicio (reproStatus 'fitness'), una vaquillona sin evaluar ('unknown'), una ternera ('none')
      // y un macho NO entran → no se tacta la preñez de quien no fue servida. Sexo null → se salta (fail-safe).
      // reproStatus ausente → solo categorías PROBADAS (fail-safe: sin el espejo no se confirma el servicio).
      return (
        animal.sex === 'female' &&
        (PROVEN_FEMALE_CATEGORY_CODES.has(animal.categoryCode ?? '') ||
          isServedReproStatus(animal.reproStatus))
      );
    case 'tacto_vaquillona':
      // Tacto de APTITUD (bug B): solo VAQUILLONAS que AÚN NO son aptas. = hembra ∧ categoría 'vaquillona' ∧
      // aptitud no resuelta como apta y todavía NO servida. Fuente única = reproStatus (encapsula la precedencia
      // RAR.2.4): aplica SSI kind='unknown' (sin evaluar → candidata a la 1ª aptitud) o kind='fitness' con
      // veredicto ≠ 'apta' (no_apta/diferida → re-evaluar). Se EXCLUYE: apta (fitness+apta → ya es apta), ya
      // servida (served_untested/pregnant/empty → precedencia > fitness; no se re-evalúa aptitud de una servida),
      // cut, ternera, macho. Sexo null / categoría ≠ vaquillona / reproStatus ausente → se salta (fail-safe).
      return (
        animal.sex === 'female' &&
        animal.categoryCode === 'vaquillona' &&
        needsFitnessEvaluation(animal.reproStatus)
      );
    case 'inseminacion':
      // Inseminación (RAR.6, corrección #1b): hembra ∧ reproductivamente apta (categoría probada ∨ vaquillona
      // apta ∨ vaquillona sin veredicto con edad ≥365 d, fallback alineado a 0105). Cierra el `default: return
      // true` que dejaba inseminar machos. Excluye macho/ternera/no_apta/diferida/<365d/CUT. La elegibilidad
      // vive en isReproApt (FUENTE ÚNICA, espeja 0105). `aptitude`/`ageDays` los provee el caller (carga.tsx)
      // desde el espejo local; ausentes (undefined) → null (sin veredicto / sin edad).
      return isReproApt({
        sex: animal.sex,
        categoryCode: animal.categoryCode,
        aptitude: animal.aptitude ?? null,
        ageDays: animal.ageDays ?? null,
      });
    case 'pesaje_ternero':
      // Peso de cría al pie: solo terneros/terneras (R6.10). Categoría desconocida → NO es ternero → se salta.
      return animal.categoryCode != null && CALF_CATEGORY_CODES.has(animal.categoryCode);
    case 'pesaje':
      // Peso de adulto/recría: cualquier categoría que NO sea ternero/ternera (R6.9). null → aplica (genérico).
      return !(animal.categoryCode != null && CALF_CATEGORY_CODES.has(animal.categoryCode));
    case 'circunferencia_escrotal':
      // CE solo a machos ENTEROS no-ternero (R14.2): categoría ∈ {torito, toro} ∧ is_castrated ≠ true.
      // Castración DESCONOCIDA (null) → INCLUYE (entero por defecto, R14.3 — UX, no seguridad). Hembra,
      // ternero, novillo/castrado → se salta (categoría fuera del set o is_castrated=true). categoryCode
      // null (irresoluble) → se salta. Reusa `isBullEntire` (única fuente del set de categorías enteras).
      return isBullEntire(animal.categoryCode, animal.isCastrated);
    default:
      return true;
  }
}

/**
 * Filtra una lista de maniobras (las que ya pasaron el gating por rodeo, `applicable`) a SOLO las que
 * aplican a ESTE animal por sus atributos (R6.12). Preserva el orden. Devuelve también las SALTADAS por
 * atributo (p. ej. raspado en una hembra) para que la UI pueda informar por qué se omitió, si quiere.
 */
export function filterByAnimalApplicability(
  maneuvers: readonly ManeuverKind[],
  animal: AnimalApplicabilityInfo,
): { applicable: ManeuverKind[]; skipped: ManeuverKind[] } {
  const applicable: ManeuverKind[] = [];
  const skipped: ManeuverKind[] = [];
  for (const m of maneuvers) {
    if (appliesToAnimal(m, animal)) applicable.push(m);
    else skipped.push(m);
  }
  return { applicable, skipped };
}

// ─── R6.8 — Prompt CUT: no para terneros ───────────────────────────────────────────────────────

/**
 * Los estados dentarios que disparan el prompt CUT (R6.8): 1/2, 1/4, sin_dientes. NO 3/4. Exportado para
 * que el paso de DIENTES (M3.2a, teeth-options.ts) marque visualmente cuáles son "boca de descarte" sin
 * re-definir el set (única fuente de verdad del umbral CUT). El umbral exacto (incluir 3/4) queda a
 * validar con Facundo (R6.8); hoy = los 3.
 */
export const CUT_PROMPT_TEETH: ReadonlySet<string> = new Set(['1/2', '1/4', 'sin_dientes']);

/**
 * ¿Se debe OFRECER el prompt CUT (transición a CUT) tras cargar este estado dentario? (R6.8). Condiciones:
 *   - el `teethState` cargado ∈ {1/2, 1/4, sin_dientes} (boca gastada → candidato a "corte/CUT");
 *   - el animal NO es un TERNERO/TERNERA (R6.8: "no deberá mostrar el prompt CUT para terneros").
 *
 * Es un predicado PURO: M3.2 lo usa para decidir si, después del paso de dientes, muestra el prompt CUT. Un
 * `categoryCode` null (irresoluble) se trata como NO-ternero (fail-OPEN del prompt) — el peor caso es ofrecer
 * el prompt a un animal cuya categoría no se pudo leer; el operario decide (no se aplica CUT sin su
 * confirmación). El umbral exacto de estados (incluir 3/4) queda a validar con Facundo (R6.8); hoy = los 3.
 */
export function shouldOfferCutPrompt(teethState: string, animal: AnimalApplicabilityInfo): boolean {
  if (!CUT_PROMPT_TEETH.has(teethState)) return false;
  // No para terneros (R6.8). categoryCode null → NO es ternero conocido → se permite el prompt (el operario
  // confirma; no se aplica CUT solo).
  if (animal.categoryCode != null && CALF_CATEGORY_CODES.has(animal.categoryCode)) return false;
  return true;
}
