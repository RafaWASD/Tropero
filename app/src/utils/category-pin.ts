// category-pin.ts — lógica PURA de FIJAR LA CATEGORÍA A MANO desde la ficha (delta spec 02
// `ficha-categoria-tacto`, RCM.4 / RCM.7). Sin RN, sin red, sin SDK: testeable con node:test.
//
// Dos decisiones, las dos puras y con `today` inyectable:
//   1. `categoryAgeMismatch` — ¿la categoría elegida es INCOHERENTE con la edad del animal? (RCM.4.3). NO
//      bloquea: alimenta el AVISO de la confirmación (C1.2 del Gate 0: "avisar qué va a quedar raro y pedir
//      confirmación", nunca impedir).
//   2. `canPinCategory` — ¿se ofrece la afordancia "Cambiar" en la fila "Categoría"? (RCM.7.1/RCM.7.2).
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ ANTI-DRIFT (espeja el banner de `animal-category.ts`, RC6.5.1)
// ══════════════════════════════════════════════════════════════════════════════════════════════
// `COHERENCE_WINDOWS` se construye con los MISMOS cortes que `compute_category` (`ONE_YEAR_DAYS` /
// `TWO_YEAR_DAYS`, importados de `animal-category.ts` — cero números mágicos acá).
//
//   ➜ CUALQUIER MIGRACIÓN QUE MUEVA LOS CORTES DE `compute_category` DEBE ACTUALIZAR LAS TRES COSAS EN EL
//     MISMO COMMIT: el espejo (`computeCategoryCode`), `AGE_WINDOWS` (derivabilidad en el alta) y estas
//     ventanas de COHERENCIA.
//
// POR QUÉ UNA TABLA NUEVA Y NO `AGE_WINDOWS` (design §2.3): son DOS SEMÁNTICAS distintas. `AGE_WINDOWS`
// responde "¿esta categoría es age-DERIVABLE en el alta?" y su único consumidor es
// `imputeBirthDateForCategory`; un code SIN ventana ahí cae al midpoint ciego A PROPÓSITO. Agregarle las
// ventanas que faltan cambiaría la fecha imputada del alta year-only y regresionaría, en silencio, el delta
// `override-imputacion-categoria`. Acá la pregunta es otra: "¿la edad REAL del animal cae dentro de lo que
// esta categoría implica?".
//
// P5 (resuelto en la Puerta 1): NO se inventa ningún mínimo etario biológico. El único piso asertable por el
// modelo para los estados post-vaquillona (preñada / 2º servicio / multípara) es el corte ternera→vaquillona
// (365 d). Los mínimos reales son dominio de Facundo (`CONTEXT/07-pendientes.md`) — fijar "Multípara" en una
// hembra de 14 meses NO dispara aviso de edad, y eso es deliberado.

import { computeCategoryCode, ONE_YEAR_DAYS, TWO_YEAR_DAYS, type AnimalSex, type MirrorCategoryCode } from './animal-category';
// Edad en días TZ-safe (ancla del día LOCAL del operario). FUENTE ÚNICA — no se re-deriva acá: es
// exactamente el helper que la manga usa para la aptitud reproductiva, y el que el fix del 🔴 A.2 corrigió.
import { ageInDaysFromBirthDate } from './repro-status';

/** Ventana etaria [minAge, maxAge) en DÍAS que una categoría IMPLICA (`maxAge = Infinity` = sin techo). */
export type CoherenceWindow = { minAge: number; maxAge: number };

/**
 * Ventanas de COHERENCIA por `code` (RCM.4.3). Derivadas de los cortes de `compute_category`:
 *   - cría (<1 año)                    → `ternero` / `ternera`
 *   - recría ([1, 2) años)             → `torito` / `novillito`
 *   - adulto (≥2 años)                 → `toro` / `novillo`
 *   - hembra ≥1 año                    → `vaquillona` y TODOS los estados post-vaquillona
 * Un code SIN entrada (p. ej. `cut`, `vaca_cabana`, o un code custom de otro sistema productivo) → sin
 * ventana → NUNCA se juzga (el aviso se omite). Es el fail-safe correcto: no inventamos biología.
 */
export const COHERENCE_WINDOWS: Readonly<Record<string, CoherenceWindow>> = {
  ternero: { minAge: 0, maxAge: ONE_YEAR_DAYS },
  ternera: { minAge: 0, maxAge: ONE_YEAR_DAYS },
  torito: { minAge: ONE_YEAR_DAYS, maxAge: TWO_YEAR_DAYS },
  novillito: { minAge: ONE_YEAR_DAYS, maxAge: TWO_YEAR_DAYS },
  toro: { minAge: TWO_YEAR_DAYS, maxAge: Infinity },
  novillo: { minAge: TWO_YEAR_DAYS, maxAge: Infinity },
  vaquillona: { minAge: ONE_YEAR_DAYS, maxAge: Infinity },
  // Estados POST-vaquillona: su único piso asertable es el corte ternera→vaquillona (P5, ver header).
  vaquillona_prenada: { minAge: ONE_YEAR_DAYS, maxAge: Infinity },
  vaca_segundo_servicio: { minAge: ONE_YEAR_DAYS, maxAge: Infinity },
  multipara: { minAge: ONE_YEAR_DAYS, maxAge: Infinity },
};

/** Entradas de la decisión de coherencia. `today` inyectable (tests deterministas). */
export type CategoryAgeMismatchInput = {
  /** `code` de la categoría que el usuario ELIGIÓ en el selector. */
  chosen: string;
  sex: AnimalSex;
  /** `birth_date` ISO 'AAAA-MM-DD' del animal, o null (desconocida → no se juzga, RCM.4.5). */
  birthDate: string | null;
  /** `is_castrated` REAL del perfil (0084) — define el code que le corresponde por edad a un macho. */
  isCastrated: boolean;
  /** INSTANTE actual (no una fecha date-only). Default: ahora. */
  today?: Date;
};

/**
 * La incoherencia detectada: la edad REAL del animal en días + el code que le CORRESPONDERÍA por edad
 * (corte de edad PURO, sin eventos — ver `categoryAgeMismatch`).
 */
export type CategoryAgeMismatch = {
  ageDays: number;
  expectedCode: MirrorCategoryCode;
};

/**
 * ¿La categoría elegida es INCOHERENTE con la edad del animal? (RCM.4.3/RCM.4.4/RCM.4.5/RCM.4.7).
 *
 * Devuelve `null` (= NO hay nada que avisar) cuando:
 *   - no hay `birth_date` conocida, o no parsea, o es futura (`ageInDaysFromBirthDate` → null): no se juzga
 *     lo que no se sabe (RCM.4.5);
 *   - el `code` elegido no tiene ventana de coherencia (no inventamos biología, P5);
 *   - la edad CAE DENTRO de la ventana `[minAge, maxAge)`.
 *
 * Devuelve `{ ageDays, expectedCode }` cuando la edad cae FUERA. `expectedCode` es el CORTE DE EDAD PURO:
 * `computeCategoryCode` con `events: []` — o sea "por edad le corresponde X", sin arrastrar partos, tactos ni
 * destetes (que son justamente lo que el usuario está sobreescribiendo a mano). El caller resuelve su `name`
 * en el catálogo local y, si no resuelve, degrada a nombrar solo la edad (RCM.4.6).
 *
 * NO BLOQUEA: es un aviso. La confirmación queda habilitada igual (C1.2).
 */
export function categoryAgeMismatch(input: CategoryAgeMismatchInput): CategoryAgeMismatch | null {
  const ageDays = ageInDaysFromBirthDate(input.birthDate, input.today ?? new Date());
  if (ageDays === null) return null; // sin fecha / inválida / futura → no se juzga (RCM.4.5)

  const window = COHERENCE_WINDOWS[input.chosen.trim()];
  if (!window) return null; // code sin ventana (cut, vaca_cabana, custom) → no se juzga

  if (ageDays >= window.minAge && ageDays < window.maxAge) return null; // coherente

  const expectedCode = computeCategoryCode({
    sex: input.sex,
    birthDate: input.birthDate,
    isCastrated: input.isCastrated,
    events: [],
    today: input.today,
  });
  return { ageDays, expectedCode };
}

// ─── Efecto de elegir una categoría (RCM.3.4 no-op + RCM.5.3 copy de la consecuencia) ──────────

/**
 * Qué produce elegir una categoría en el selector:
 *   - `'noop'`  — no cambia NADA (misma categoría vigente y mismo `override`) → el sheet CIERRA sin escribir
 *                 y sin pedir confirmación (RCM.3.4).
 *   - `'pin'`   — queda FIJADA a mano (`override = true`) → la confirmación muestra la consecuencia de
 *                 RCM.4.2 ("deja de actualizarse sola").
 *   - `'unpin'` — vuelve a AUTOMÁTICO (`override = false`, RCM.5.2 / P2) → la confirmación dice que la
 *                 categoría VUELVE a actualizarse sola (RCM.5.3).
 */
export type CategoryPinEffect = 'noop' | 'pin' | 'unpin';

/** Entradas del cálculo del efecto. Espeja EXACTAMENTE la regla del núcleo `decideCategoryPin`. */
export type CategoryPinEffectInput = {
  /** `code` que el usuario tocó en el selector. */
  chosen: string;
  /** `code` de la categoría VIGENTE del animal (la que muestra el espejo C6 / el badge del hero). */
  currentCode: string;
  /** `category_override` ACTUAL del perfil. */
  currentOverride: boolean;
  /** `code` DERIVADO por el espejo, o `null` si no se resuelve localmente. */
  derivedCode: string | null;
};

/**
 * Resuelve el EFECTO de elegir `chosen` (RCM.3.4 / RCM.5.3). PURA.
 *
 * La regla del `override` resultante es la MISMA que la del núcleo `decideCategoryPin` (design §2.1):
 * `override = (elegida ≠ derivada)`, con la derivada irresoluble contando como "distinta". Es deliberado que
 * esté escrita dos veces —acá para el COPY y allá para el WRITE—: son dos capas distintas (UI vs datos) y el
 * test de abajo las ata (un cambio en una sin la otra rompe la coherencia entre lo que la confirmación
 * PROMETE y lo que el write HACE).
 *
 * `noop` SSI la categoría no cambia Y el `override` tampoco. OJO con el caso que parece no-op y no lo es:
 * un animal con `override = true` cuya categoría fijada COINCIDE con la derivada — tocar esa misma categoría
 * QUITA la fijación (cambia `override`), así que hay algo que confirmar y algo que escribir.
 */
export function resolveCategoryPinEffect(input: CategoryPinEffectInput): CategoryPinEffect {
  const chosen = input.chosen.trim();
  const nextOverride = !(input.derivedCode != null && input.derivedCode === chosen);
  if (chosen === input.currentCode && nextOverride === input.currentOverride) return 'noop';
  return nextOverride ? 'pin' : 'unpin';
}

// ─── Codes que NUNCA se pueden fijar desde este camino (RCM.2.4, defensa en profundidad) ───────

/**
 * `code`s que el selector de categoría NO puede escribir NUNCA, ni siquiera si un caller futuro se saltea
 * `pickableCategories`. Hoy hay uno solo, y no es una preferencia estética: **`cut`** ACOPLA la columna
 * `is_cut` (`buildSetCutUpdate` escribe los tres campos juntos). Fijar `category_id = cut` por esta vía
 * dejaría `is_cut = 0` con la categoría CUT colgada — el estado inconsistente que RCUT.2.3 prohíbe, y que
 * además rompe el desmarcado (`unsetCut` es el ÚNICO camino que resetea `is_cut`).
 *
 * `vaca_cabana` NO está acá: queda fuera del selector por ALCANCE (cabaña no es MVP de cría), no por
 * consistencia — si mañana entra al MVP, entra sin tocar esta lista.
 */
export const CATEGORY_PIN_FORBIDDEN_CODES: ReadonlySet<string> = new Set(['cut']);

/**
 * ¿Este `code` se puede fijar desde el selector de la ficha? (RCM.2.4, barrera de SERVICIO). El selector ya
 * no lo ofrece (`pickableCategories` filtra por `MALE_/FEMALE_CATEGORY_CODES`, que excluyen `cut`); esto es
 * la segunda cerradura, en el borde donde se ESCRIBE — el guard se escribe sobre la AUSENCIA, así un caller
 * nuevo de `setCategoryManual` nace protegido en vez de nacer roto. PURA.
 */
export function isPinnableCategoryCode(code: string): boolean {
  const c = code.trim();
  return c.length > 0 && !CATEGORY_PIN_FORBIDDEN_CODES.has(c);
}

/** Entradas del gate de la afordancia "Cambiar" de la fila "Categoría" (RCM.7.1). */
export type CanPinCategoryInput = {
  /** `status` del perfil ('active' | 'sold' | 'dead' | 'transferred'). */
  status: string;
  /** `is_cut` REAL del perfil. Un CUT NO se re-categoriza desde acá (RCM.7.2). */
  isCut: boolean;
  /** Cantidad de categorías OFRECIBLES (`pickableCategories(...).length`). 0 → fail-safe (RCM.2.6). */
  optionCount: number;
};

/**
 * ¿Se ofrece "Cambiar" en la fila "Categoría"? (RCM.7.1). SSI las tres:
 *   - el animal está ACTIVO (un archivado no recibe cambios, igual que el resto de la ficha);
 *   - NO es CUT (RCM.7.2: cambiar `category_id` dejaría `is_cut = 1` con una categoría no-CUT — el estado
 *     inconsistente que RCUT.2.3 prohíbe; el CUT tiene su propio desmarcado en "Manejo");
 *   - hay al menos UNA categoría ofrecible (RCM.2.6: catálogo sin sincronizar / sistema sin esos codes →
 *     la fila queda solo lectura, la ficha no se rompe).
 * PURA. Un `optionCount` negativo (imposible por construcción) se trata como "sin opciones".
 */
export function canPinCategory(input: CanPinCategoryInput): boolean {
  return input.status === 'active' && input.isCut === false && input.optionCount > 0;
}
