// Lógica PURA de categoría (spec 02 RT2.20 alta + RC6.1 espejo completo) — espejo cliente de
// compute_category. Sin RN, sin red, sin supabase-js: testeable con node:test.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ ANTI-DRIFT (RC6.5.1) — NOTA DE MANTENIMIENTO OBLIGATORIA
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Este módulo ESPEJA la función `compute_category` server-side. La base es la migración `0062`
// (`supabase/migrations/0062_compute_category_rewrite.sql`); en lo que toca la rama `vaquillona`, el
// espejo ahora refleja la RECONCILIACIÓN de `0104`
// (`supabase/migrations/0104_compute_category_drop_service.sql`, spec 02 Stream A / RPS.4.1): la rama
// `vaquillona` YA NO usa el evento `service` (Stream B B4 / RPSC.1.1). Es un espejo client-side
// display-only (chunk C6 de spec 02): permite ver la categoría derivada localmente OFFLINE, antes de que
// el trigger server-side recompute y el cambio baje por sync.
//
//   ➜ CUALQUIER MIGRACIÓN QUE TOQUE `compute_category` (ramas, cortes de edad, precedencia, tacto+,
//     conteo de partos) DEBE ACTUALIZAR ESTE ESPEJO (`computeCategoryCode`) + SUS FIXTURES
//     (`animal-category.test.ts`, la suite "fixtures espejo RC6.1.6"). Los fixtures replican, caso por
//     caso, la matriz RT2.x ya verificada server-side en `supabase/tests/animal/run.cjs` (T2.21–T2.26,
//     T2.29, T2.30) — misma tabla de casos, dos implementaciones (mitigación de drift #1 del Gate 0).
//     El peor caso del drift es display-only: categoría mostrada desactualizada hasta el próximo sync;
//     NO corrompe datos (el server sigue siendo la única verdad).
//
// `is_castrated` REAL vs inferencia DEGRADADA (RC6.2.1 → spec 10 T-CL.7 / R13.6):
//   El `is_castrated` denormalizado YA EXISTE en `animal_profiles` (migración 0084 de spec 10, estilo
//   b1/0079: backfill + force-on-INSERT + write-through + propagación) → el espejo debe alimentarse del
//   VALOR REAL, no inferirlo del code guardado. Por eso `MirrorRowInput.isCastrated` (input REAL,
//   opcional) tiene PRECEDENCIA en `computeDisplayOverrides`: cuando el caller lo provee (no null), se
//   usa tal cual; la inferencia `inferIsCastrated(storedCode)` queda DEGRADADA a FALLBACK documentado y
//   solo se usa cuando el caller NO provee el real (`isCastrated == null`).
//
//   POR QUÉ el real importa (caso que la inferencia NO cubría — R10.6): la castración offline de spec 10
//   setea `is_castrated=true` en `animal_profiles` ANTES de que el server recompute el code. Con la
//   inferencia vieja (que mira el `code` guardado, todavía `torito`/`ternero`) el espejo daría `torito`;
//   con el real (`true`) da `novillito` AL INSTANTE, offline, sin esperar el sync-down. Lo mismo el
//   revert (`false` → `torito`/`toro`). El fallback por inferencia se conserva SOLO para los call-sites
//   que aún no proyectan la columna real (legacy/transición) y para `category_override=true` (donde el
//   code guardado es manual y el real no aplica) — espeja al server en todos los casos productivos
//   actuales (ningún flujo histórico dejó un castrado sin que su code ya fuera novillito/novillo).
//
//   ⚠ El CABLEADO del input real en los call-sites de `animals.ts` (lista/ficha/búsqueda offline) y la
//   PROYECCIÓN de la columna `is_castrated` en las queries locales (local-reads.ts) + el schema PowerSync
//   (T-CL.12) son de la **Fase 3** de spec 10 — NO de este chunk (Fase 2, utils puros). Hasta entonces el
//   caller NO pasa `isCastrated` → cae al fallback por inferencia (comportamiento IDÉNTICO al previo, sin
//   regresión de C6). Este chunk solo HABILITA el input real en la función pura + lo testea.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ existe el espejo PARCIAL del alta (no llamamos compute_category(profile_id) en el alta):
//   La RPC compute_category(profile_id) del server (migration 0062, reescritura Tier 2/3) recibe un
//   perfil que YA EXISTE. En el alta el perfil todavía no existe (lo estamos por insertar) y
//   category_id es NOT NULL en animal_profiles → necesitamos la categoría ANTES del insert.
//   `computeInitialCategoryCode` DELEGA en `computeCategoryCode` (la función espejo completa) con el
//   caso "sin eventos" (un animal recién creado no tiene partos/tactos/destete/servicio) + un tacto+
//   sintético cuando `pregnant` (refinamiento B) — una sola implementación, sin tercera copia (RC6.1.5).
//
// RT2.20 — alineación con compute_category 0062 (rama "sin eventos", is_castrated=false en el alta):
//   En el ALTA no hay toggle de castración aún → todo animal nuevo entra ENTERO (is_castrated=false).
//   La rama macho del backend, sin eventos:
//     - >= 730 días (2 años) conocidos → toro      (entero) / novillo   (castrado)
//     - >= 365 días (1 año)   conocidos → torito    (entero) / novillito (castrado)
//     - <  365 días           conocidos → ternero
//     - birth_date null                 → torito    (entero) / novillito (castrado)  [default conservador]
//   La rama hembra del backend, sin eventos:
//     - >= 365 días conocidos → vaquillona
//     - <  365 días conocidos → ternera
//     - birth_date null       → vaquillona  [default conservador]
//
//   El corte de 2 años (toro) es lo que el espejo viejo NO reflejaba: daba torito para ≥1 año sin
//   distinguir toro. Ahora lo distingue, así la lógica de override (categoryOverrideFor) compara
//   contra la MISMA categoría que el server computaría (si difiere → override; ver más abajo).
//
// REFINAMIENTO B (preñez capturada en el alta — sub-chunk B, dominio Facundo §1): el alta guiada
// puede capturar el estado de PREÑEZ (tacto) junto con la categoría. Un tacto POSITIVO sobre una
// hembra SIN partos la transiciona, server-side, a `vaquillona_prenada` (trigger de transición,
// 0046/0062). Por eso el espejo cliente, cuando se le pasa `{ pregnant: true }`, computa
// `vaquillona_prenada` para la hembra (sin partos): es DERIVABLE → si el usuario eligió justo
// `vaquillona_prenada` + capturó la preñez, NO hace falta override (categoryOverrideFor → false; un
// parto futuro la transiciona a vaca). Las vacas con partos (multipara/vaca_segundo_servicio) NO son
// derivables del alta (no capturamos partos) → siguen difiriendo → override=true (el owner las gestiona
// manual; el modelo no puede inferir su historial de partos). `pregnant` solo afecta a la hembra.
//
// La rama de CASTRACIÓN del espejo (novillito/novillo) se DEJA documentada y contemplada en el type,
// pero NO se computa en este chunk: el alta no tiene toggle de is_castrated (entra todo entero). Se
// completará cuando exista el toggle de castración en la ficha / la op masiva (spec 10). El backend
// ya la cubre (0062); el espejo cliente la sumará con su disparador.
//
// Las transiciones posteriores (preñez, parto, aborto, destete, edad) las maneja el server vía
// triggers + el job nocturno (spec 02 Tier 2); el cliente NO recomputa categoría tras eventos. (El
// `service`/IA ya NO transiciona categoría — RPSC.1.1 / 0104.) Acá solo el alta.

// Fallback del alta year-only: el midpoint CIEGO 'AAAA-07-01' (o el clamp a no-futuro) al que cae
// `imputeBirthDateForCategory` cuando la categoría no es age-derivable o el cruce es vacío. NO hay ciclo de
// imports: animal-birth-year importa solo event-timeline (→ wheel-picker), nunca este módulo.
import { birthYearToDate } from './animal-birth-year';

/**
 * Códigos de categoría de (bovino, cría) que el modelo contempla para el alta.
 *
 * `novillito`/`novillo` se incluyen para cuando exista el toggle de castración (eje torito↔novillito
 * / toro↔novillo, ADR-008 enmendado): el type debe poder representarlos. En el alta de HOY
 * (is_castrated=false, sin toggle) `computeInitialCategoryCode` nunca los arroja — pero la categoría
 * ELEGIDA por el usuario en el picker puede ser cualquiera del catálogo (un `code` string), y el type
 * de la computada debe cubrir el espacio completo de lo que el backend podría devolver.
 */
export type InitialCategoryCode =
  | 'ternero'
  | 'torito'
  | 'toro'
  | 'novillito'
  | 'novillo'
  | 'ternera'
  | 'vaquillona'
  // refinamiento B: una hembra con tacto+ capturado en el alta computa 'vaquillona_prenada' (derivable
  // server-side por el tacto+). Sin `pregnant`, computeInitialCategoryCode NUNCA la arroja.
  | 'vaquillona_prenada';

/**
 * Espacio COMPLETO de codes que `computeCategoryCode` (espejo de 0062) puede arrojar — incluye los
 * codes de vaca adulta (multipara / vaca_segundo_servicio) que la rama hembra con partos produce y que
 * `InitialCategoryCode` NO contempla (el alta no captura partos). `InitialCategoryCode` es un SUBconjunto.
 */
export type MirrorCategoryCode =
  | 'ternero'
  | 'torito'
  | 'toro'
  | 'novillito'
  | 'novillo'
  | 'ternera'
  | 'vaquillona'
  | 'vaquillona_prenada'
  | 'vaca_segundo_servicio'
  | 'multipara';

export type AnimalSex = 'male' | 'female';

const ONE_YEAR_DAYS = 365;
const TWO_YEAR_DAYS = 730;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Ventanas etarias INVERSAS de los cortes de `compute_category` (alta = animal ENTERO, is_castrated=false;
// el alta no tiene toggle de castración → nunca novillito/novillo). Días, intervalo [minAge, maxAge)
// (maxAge=Infinity = sin cota superior). Es la INVERSA de la rama sin-eventos de `computeCategoryCode`
// (macho: <1año ternero / [1,2) torito / ≥2 toro · hembra: <1año ternera / ≥1 vaquillona).
//
//   ➜ ANTI-DRIFT (ver banner del header, RC6.5.1): estas ventanas ESPEJAN LOS CORTES de `compute_category`
//     (`computeCategoryCode`, cortes ONE_YEAR_DAYS / TWO_YEAR_DAYS). Si una migración cambia esos cortes o
//     las ramas de la máquina de estados, ACTUALIZAR estas ventanas EN EL MISMO COMMIT (junto al espejo y
//     sus fixtures). Cero números mágicos: reusa ONE_YEAR_DAYS / TWO_YEAR_DAYS.
const AGE_WINDOWS: Record<AnimalSex, Record<string, { minAge: number; maxAge: number }>> = {
  male: {
    ternero: { minAge: 0, maxAge: ONE_YEAR_DAYS },
    torito: { minAge: ONE_YEAR_DAYS, maxAge: TWO_YEAR_DAYS },
    toro: { minAge: TWO_YEAR_DAYS, maxAge: Infinity },
  },
  female: {
    ternera: { minAge: 0, maxAge: ONE_YEAR_DAYS },
    vaquillona: { minAge: ONE_YEAR_DAYS, maxAge: Infinity },
  },
};

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Imputa una birth_date ISO 'YYYY-MM-DD' para el alta cuando SOLO se conoce el AÑO, usando la categoría
 * elegida para caer del lado correcto del corte de edad (evita el flip del midpoint ciego). Devuelve el
 * MIDPOINT del cruce (año ∩ ventana-etaria-de-la-categoría ∩ pasado). Si la categoría no es age-derivable
 * (multipara/vaca_segundo_servicio/vaquillona_prenada/novillito/novillo — el alta entra entero, sin
 * castración) o el cruce es VACÍO (categoría imposible para el año) → cae al midpoint ciego `birthYearToDate`
 * (fallback). NUNCA devuelve una fecha futura (hi acotado a hoy). PURA, testeable con node:test.
 *
 * INSIGHT (por qué esto resuelve el flip sin tocar `categoryOverrideFor`): con la fecha imputada
 * category-consistent, `computeInitialCategoryCode(sex, fechaImputada) === chosen` → la comparación puntual
 * de `categoryOverrideFor` da `override=false` (auto-avanza sin flip). En el fallback (cruce vacío), la
 * computada difiere de la elegida → `override=true` (preserva la elección rara, congelada). Toda la
 * inteligencia vive acá; `categoryOverrideFor` queda IGUAL.
 *
 * Aritmética de días en UTC (consistente con `ageInDays`/`startOfDay`; edad = floor((today - birth)/día)).
 */
export function imputeBirthDateForCategory(
  chosen: string,
  sex: AnimalSex,
  yearOnlyIso: string, // el midpoint ciego que ya calculó validateBirthDate (year-only), ej '2024-07-01'
  today?: Date,
): string {
  const year = Number(yearOnlyIso.slice(0, 4));
  const window = AGE_WINDOWS[sex]?.[chosen.trim()];
  // Categoría NO age-derivable (sin ventana) → midpoint ciego. El override lo resuelve después
  // categoryOverrideFor (con `pregnant` para vaquillona_prenada; el resto queda override=true).
  if (!window) return birthYearToDate(year, today) as string;

  const todayMid = startOfDay(today ?? new Date());
  // age >= minAge  ⟺ birth <= today - minAge          (latestBirth, inclusive).
  const latestBirth = todayMid.getTime() - window.minAge * DAY_MS;
  // age <  maxAge  ⟺ birth >= today - (maxAge - 1)     (earliestBirth, inclusive; maxAge=∞ → sin cota inferior).
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const earliestBirth =
    window.maxAge === Infinity ? yearStart : todayMid.getTime() - (window.maxAge - 1) * DAY_MS;

  const lo = Math.max(earliestBirth, yearStart);
  const hi = Math.min(latestBirth, yearEnd, todayMid.getTime());
  // Cruce VACÍO (categoría imposible para el año, ej. 'toro' para un nacido este año) → midpoint ciego.
  if (lo > hi) return birthYearToDate(year, today) as string;

  // Midpoint del cruce, redondeado a día ENTERO (floor del medio en días → siempre queda dentro de [lo, hi]).
  const spanDays = Math.floor((hi - lo) / DAY_MS);
  const mid = new Date(lo + Math.floor(spanDays / 2) * DAY_MS);
  return isoUtcDate(mid);
}

/** ISO 'YYYY-MM-DD' (UTC, padded) de un Date normalizado a medianoche UTC. */
function isoUtcDate(d: Date): string {
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Evento reproductivo CRUDO del SQLite local (synced u overlay) que alimenta el espejo (RC6.1.1). El
 * SQL ya filtró `deleted_at IS NULL` y el `event_type IN (...)` relevante (design §3); acá NO se re-filtra
 * borrado. Tipos esperados: 'birth' | 'weaning' | 'service' | 'tacto' | 'abortion'; otros se IGNORAN.
 */
export type ReproEventInput = {
  /** event_type del reproductive_event ('birth' | 'weaning' | 'service' | 'tacto' | 'abortion' | …). */
  eventType: string;
  /** event_date 'YYYY-MM-DD'. */
  eventDate: string;
  /**
   * created_at (timestamptz texto) o null. `null` = fila local recién insertada por CRUD plano (los
   * INSERT locales de tacto/servicio/aborto NO setean created_at — lo pone el trigger al subir, RC6.1.4)
   * → se trata como MÁS RECIENTE que cualquier created_at presente a igualdad de event_date.
   */
  createdAt: string | null;
  /** pregnancy_status del tacto ('empty' | 'small' | … | null). Solo relevante para event_type='tacto'. */
  pregnancyStatus: string | null;
};

/** Inputs explícitos del espejo `computeCategoryCode` (RC6.1.1). Sin I/O: el caller los lee del SQLite. */
export type CategoryMirrorInputs = {
  sex: AnimalSex;
  /** ISO 'YYYY-MM-DD' o null. Si futura/inválida → tratada como desconocida (default por sexo). */
  birthDate: string | null;
  /** Inferido por el caller (RC6.2.1) — HOY ningún write-path productivo lo setea true; ver header. */
  isCastrated: boolean;
  /** Eventos reproductivos no-borrados del perfil (el SQL ya filtró deleted_at). Orden NO requerido (se ordena acá). */
  events: readonly ReproEventInput[];
  /** Inyectable para tests deterministas (default: hoy). */
  today?: Date;
};

/**
 * Opciones del cómputo / override de categoría inicial:
 *   - `today`   : inyectable para tests deterministas (default: hoy).
 *   - `pregnant`: ¿se capturó un tacto POSITIVO en el alta? (sub-chunk B). Solo afecta a la hembra
 *     SIN partos: un tacto+ la transiciona, server-side, a `vaquillona_prenada` → el espejo cliente
 *     lo refleja (categoría derivable, override=false si el usuario eligió justo esa). Default: false.
 */
export type CategoryComputeOpts = {
  today?: Date;
  pregnant?: boolean;
};

/**
 * Calcula el código de categoría inicial de un animal de cría recién creado (R4.7 / RT2.20), espejo
 * de la rama sin-eventos de compute_category (0062) con is_castrated=false (el alta no tiene toggle
 * de castración aún), MÁS el refinamiento B (preñez capturada):
 *   - macho  + nacimiento < 1 año (conocido)        → 'ternero'
 *   - macho  + 1 ≤ nacimiento < 2 años (conocido)   → 'torito'
 *   - macho  + nacimiento ≥ 2 años (conocido)       → 'toro'
 *   - macho  + sin fecha                            → 'torito'  (default conservador, = backend)
 *   - hembra + pregnant (tacto+ capturado)          → 'vaquillona_prenada'  (derivable, refinamiento B)
 *   - hembra + nacimiento < 1 año (conocido)        → 'ternera'
 *   - hembra + nacimiento ≥ 1 año (conocido)        → 'vaquillona'
 *   - hembra + sin fecha                            → 'vaquillona' (default conservador, = backend)
 *
 * El `pregnant` solo aplica a la hembra (un macho preñado no existe). La preñez GANA al corte de edad
 * (una hembra preñada es por definición preñable → no es ternera): el espejo del server transiciona a
 * `vaquillona_prenada` por el tacto+ sin importar la edad (un tacto+ sobre una ternera la promueve a
 * vaquillona y luego a preñada). Por eso `pregnant` se evalúa ANTES que el corte de edad.
 *
 * `birthDate` en formato ISO 'YYYY-MM-DD' o null. Si la fecha es futura/inválida, se trata como
 * desconocida (cae al default por sexo) — la validación del form ya rechaza fechas futuras antes de
 * llegar acá, esto es defensivo. Acepta `opts` (objeto) o, por compat con los tests previos, un `Date`
 * posicional (= { today }).
 */
export function computeInitialCategoryCode(
  sex: AnimalSex,
  birthDate: string | null,
  opts: CategoryComputeOpts | Date = {},
): InitialCategoryCode {
  const { today, pregnant } = normalizeOpts(opts);
  // DELEGA en el espejo completo (RC6.1.5): caso "sin eventos" (un animal recién creado no tiene
  // partos/tactos/destete/servicio) + un tacto+ SINTÉTICO cuando `pregnant` (refinamiento B). El alta no
  // tiene toggle de castración → isCastrated=false. computeCategoryCode con events=[] (o solo el tacto+
  // sintético para la hembra) reproduce EXACTAMENTE la lógica que esta función tenía inline.
  const events: ReproEventInput[] =
    pregnant && sex === 'female'
      ? [{ eventType: 'tacto', eventDate: '1970-01-01', createdAt: null, pregnancyStatus: 'pregnant' }]
      : [];
  const code = computeCategoryCode({ sex, birthDate, isCastrated: false, events, today });
  // El espacio de salida de este caller es el SUBconjunto InitialCategoryCode: con events vacíos (o el
  // tacto+ sintético sobre una hembra sin partos) computeCategoryCode NUNCA arroja multipara/
  // vaca_segundo_servicio (requieren eventos `birth`, que el alta no captura) → el cast es seguro.
  return code as InitialCategoryCode;
}

/**
 * Espejo COMPLETO de `compute_category` (migración 0062, rama `vaquillona` reconciliada por 0104 —
 * sin `service`), RC6.1. Función PURA, determinística, sin I/O: recibe TODOS los inputs (sexo, birth_date,
 * is_castrated, eventos reproductivos crudos) + un `today` inyectable, y devuelve el `code` de categoría
 * que el server computaría. Replica:
 *   - el corte de edad (1 año / 2 años) por sexo;
 *   - el conteo de PARTOS (eventos `birth` distintos no borrados, NUNCA terneros — el SQL ya filtró);
 *   - has_weaning (existencia de evento) — el `service` ya NO entra al cómputo (RPSC.1.1 / 0104);
 *   - el tacto+ VIGENTE (RT2.7.5): un tacto positivo SIN un aborto posterior por la tupla
 *     (event_date, created_at);
 *   - la PRECEDENCIA de ramas LOAD-BEARING de 0062/0104 (no reordenar).
 *
 * Display-only en el cliente (chunk C6): el server sigue siendo la única verdad; al sincronizar
 * convergen (misma función ⇒ mismo resultado). Ver el banner ANTI-DRIFT del header.
 */
export function computeCategoryCode(inputs: CategoryMirrorInputs): MirrorCategoryCode {
  const today = inputs.today ?? new Date();
  const ageDays = inputs.birthDate ? ageInDays(inputs.birthDate, today) : null;
  // edad CONOCIDA = no null y no futura (negativa). Desconocida → null (cae al default por sexo). Espeja
  // el `v_age_days := case when birth_date is not null then (current_date - birth_date) else null end` de
  // 0062: una birth_date futura no existe server-side (CHECK), pero acá es defensivo (= "desconocida").
  const knownAge = ageDays !== null && ageDays >= 0 ? ageDays : null;

  if (inputs.sex === 'male') {
    // Rama MACHO (0062 líneas 46-60). Precedencia: 2años → (destete | 1año) → <1año → default.
    const hasWeaning = inputs.events.some((e) => e.eventType === 'weaning');
    if (knownAge !== null && knownAge >= TWO_YEAR_DAYS) {
      return inputs.isCastrated ? 'novillo' : 'toro'; // ≥ 2 años (RT2.3.3)
    }
    if (hasWeaning || (knownAge !== null && knownAge >= ONE_YEAR_DAYS)) {
      return inputs.isCastrated ? 'novillito' : 'torito'; // destete cargado o ≥ 1 año (RT2.3.2)
    }
    if (knownAge !== null && knownAge < ONE_YEAR_DAYS) {
      return 'ternero'; // < 1 año conocido y sin destete (RT2.3.1)
    }
    // birth_date NULL, sin destete → default conservador (RT2.3.4). El corte de 2 años NO se aplica sin edad.
    return inputs.isCastrated ? 'novillito' : 'torito';
  }

  // Rama HEMBRA (0062 líneas 61-100). Conteo de partos = eventos `birth` no borrados (el SQL ya filtró
  // deleted_at; mellizos = UN evento birth → cuentan los EVENTOS, nunca los terneros — RT2.7.2).
  const births = inputs.events.reduce((n, e) => (e.eventType === 'birth' ? n + 1 : n), 0);
  const hasWeaning = inputs.events.some((e) => e.eventType === 'weaning');
  // `hasService` ELIMINADO (RPSC.1.1 / Stream B B4): el espejo de `compute_category` `0104` ya NO usa
  // `service` para promover a vaquillona (el destete + el corte de edad cubren la vía ternera→vaquillona;
  // categoría ≠ elegibilidad reproductiva, Gate 0 §2). El `service`/IA se SIGUE leyendo en
  // MIRROR_EVENT_TYPES (timeline, RPSC.1.6); solo dejó de influir en el `code` computado.
  const hasPosTacto = hasPositiveTactoVigente(inputs.events);

  // Orden de ramas LOAD-BEARING (precedencia de la máquina de estados, espejo de 0104 líneas 109-121):
  // partos≥2 > partos=1 > tacto+ > vaquillona(destete|≥1año) > ternera(<1año) > default.
  if (births >= 2) return 'multipara'; // RT2.4.1
  if (births === 1) return 'vaca_segundo_servicio'; // RT2.4.2 (desde cualquier categoría, incl. ternera)
  if (hasPosTacto) return 'vaquillona_prenada'; // RT2.4.3
  if (hasWeaning || (knownAge !== null && knownAge >= ONE_YEAR_DAYS)) {
    return 'vaquillona'; // RT2.4.4 (RPSC.1.1: SIN `|| hasService`, espejo de 0104)
  }
  if (knownAge !== null && knownAge < ONE_YEAR_DAYS) return 'ternera'; // RT2.4.5
  return 'vaquillona'; // RT2.4.6 (sin birth_date, sin eventos) — default conservador
}

/**
 * Tacto+ VIGENTE (RT2.7.5 / 0062 líneas 70-83): existe un evento `tacto` POSITIVO (pregnancy_status no
 * null y ≠ 'empty') no borrado SIN un evento `abortion` no borrado POSTERIOR por la tupla
 * (event_date, created_at). Si el aborto es ANTERIOR a un tacto+ (otro servicio/preñez), el tacto vuelve
 * a contar. El SQL ya filtró deleted_at (no se re-filtra acá).
 *
 * El caller entrega `events` YA ORDENADO por (event_date ASC, created_at ASC) — el orden de
 * `buildCategoryMirrorEventsQuery`. Por eso el ÍNDICE en el array es un desempate fiable cuando la tupla
 * (event_date, created_at) empata (caso típico offline: tacto y aborto el MISMO día, ambos con
 * created_at null porque los dos se cargaron en este dispositivo y el trigger aún no los selló) — el que
 * está MÁS ADELANTE en el array se insertó después ⇒ es posterior (RC6.1.4).
 */
function hasPositiveTactoVigente(events: readonly ReproEventInput[]): boolean {
  return events.some((t, ti) => {
    if (t.eventType !== 'tacto') return false;
    if (t.pregnancyStatus === null || t.pregnancyStatus === 'empty') return false;
    // ¿Hay un aborto ESTRICTAMENTE posterior a este tacto+? → revierte. Comparamos por (event_date,
    // created_at) y, si empata, por el índice del array (orden de la query = orden de inserción local).
    return !events.some((ab, abi) => ab.eventType === 'abortion' && isAfter(ab, abi, t, ti));
  });
}

/**
 * ¿El evento `a` (índice `ai`) es ESTRICTAMENTE posterior a `b` (índice `bi`) por la tupla
 * (event_date, created_at)? (espeja el `(ab.event_date, ab.created_at) > (t.event_date, t.created_at)`
 * de 0062). Desempate por created_at solo cuando event_date EMPATA.
 *
 * RC6.1.4 — tie-break offline: un `created_at === null` (fila local recién insertada por CRUD plano, el
 * trigger lo setea recién al subir) se trata como MÁS RECIENTE que cualquier created_at PRESENTE a
 * igualdad de event_date (la fila se acaba de crear en este dispositivo). Entre DOS null a igualdad de
 * event_date, desempata el ÍNDICE del array (la query viene ORDER BY event_date, created_at → con ambos
 * null el orden es el de inserción/rowid local) → el de índice MAYOR es posterior. Esto cierra el caso
 * realista "tacto + aborto el mismo día, ambos offline sin created_at": el aborto (insertado después →
 * índice mayor) revierte el tacto, igual que lo hará el server cuando selle los created_at al subir.
 */
function isAfter(a: ReproEventInput, ai: number, b: ReproEventInput, bi: number): boolean {
  if (a.eventDate !== b.eventDate) return a.eventDate > b.eventDate;
  // event_date EMPATA → desempate por created_at; con ambos null o el mismo texto, por índice.
  if (a.createdAt === b.createdAt) return ai > bi; // ambos null (o mismo texto) → orden de inserción
  if (a.createdAt === null) return true; // a es "ahora", b tiene created_at → a posterior
  if (b.createdAt === null) return false; // b es "ahora", a tiene created_at → a NO es posterior
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  // PowerSync materializa el texto timestamptz de PG (formato uniforme) → Date.parse es fiable; fallback
  // lexicográfico si alguno no parsea (defensivo — el formato ISO es lexicográficamente ordenable).
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a.createdAt > b.createdAt;
  return ta > tb;
}

/** Normaliza el 3er argumento (objeto de opciones o un Date posicional legado) a { today, pregnant }. */
function normalizeOpts(opts: CategoryComputeOpts | Date): { today: Date; pregnant: boolean } {
  if (opts instanceof Date) return { today: opts, pregnant: false };
  return { today: opts.today ?? new Date(), pregnant: opts.pregnant ?? false };
}

/**
 * Infiere `is_castrated` del `code` guardado del perfil (RC6.2.1): `true` si el code ∈ {novillito,
 * novillo} (solo la castración produce esos codes en un cómputo del server), `false` en cualquier otro
 * caso.
 *
 * DEGRADADA a FALLBACK (spec 10 T-CL.7 / R13.6): desde la denorm 0084, `is_castrated` SÍ está en el
 * SQLite local — el espejo se alimenta del valor REAL (`MirrorRowInput.isCastrated`) y esta inferencia
 * SOLO se usa cuando el caller no lo provee (call-sites legacy de C6 aún sin cablear el real — Fase 3, o
 * `category_override=true` donde el code guardado es manual). Se conserva exportada porque es la red de
 * seguridad de esos caminos y porque `resolveRevertCategory`/los tests RC6.2.1 la usan. Ver header.
 */
export function inferIsCastrated(storedCode: string | null | undefined): boolean {
  return storedCode === 'novillito' || storedCode === 'novillo';
}

/** Una categoría del catálogo local (code → name) para resolver el display derivado (RC6.3.4). */
export type CategoryCatalogEntry = { code: string; name: string };

/** Resultado de la resolución de display: el code + name a MOSTRAR (derivado o guardado, fail-safe). */
export type DisplayCategory = { code: string; name: string };

/**
 * Resuelve la categoría a MOSTRAR (display-only, RC6.3.3/RC6.3.4). Reglas:
 *   - `categoryOverride === true` → SIEMPRE la GUARDADA tal cual (el espejo NO aplica, igual que el server).
 *   - `categoryOverride === false` → la DERIVADA por el espejo (`derivedCode`), resolviendo su `name` en el
 *     catálogo local. Si `derivedCode` no tiene fila activa en el catálogo → FAIL-SAFE a la guardada
 *     (nunca blanco, nunca crash; RC6.3.4).
 * Función PURA: el caller pasa el catálogo ya leído del SQLite local. NO escribe nada (RC6.3.5).
 */
export function deriveDisplayCategory(args: {
  storedCode: string;
  storedName: string;
  categoryOverride: boolean;
  derivedCode: MirrorCategoryCode;
  catalog: readonly CategoryCatalogEntry[];
}): DisplayCategory {
  const stored: DisplayCategory = { code: args.storedCode, name: args.storedName };
  if (args.categoryOverride) return stored; // override manda (RC6.3.3)
  const match = args.catalog.find((c) => c.code === args.derivedCode);
  if (!match) return stored; // code derivado sin fila en el catálogo → fail-safe a la guardada (RC6.3.4)
  return { code: match.code, name: match.name };
}

/**
 * Resuelve la categoría DESTINO al flipear `is_castrated` (spec 10 R13.1 — la confirmación que ANTICIPA el
 * recálculo en la ficha: "La categoría se recalcula: Torito → Novillito"). PURA: espeja `compute_category`
 * server-side (0062) con el `is_castrated` NUEVO (`nextCastrated`), reusando `computeCategoryCode`, y
 * resuelve su `name` legible en el catálogo local. Es el mismo cómputo que el server hará al subir el
 * UPDATE (write-through + 0064/0086 simétrico) → lo que se anticipa coincide con lo que aterriza.
 *
 * Devuelve `null` (no se anticipa transición) cuando:
 *   - `categoryOverride === true` → el server NO recalcula (override manda, R5.6) → no hay destino que mostrar;
 *   - el `code` destino no tiene fila en el catálogo local (irresoluble) → fail-safe a "sin anticipación".
 *
 * El destino puede COINCIDIR con la categoría actual (p. ej. `ternero` no transiciona al castrarse — 0062
 * sigue dando `ternero` hasta destete/1 año): en ese caso devuelve igual el `{ code, name }` del destino
 * (== actual) y el caller decide si lo muestra (si destino == actual, la UI puede omitir la línea de
 * consecuencia — no hubo cambio de categoría, solo el flip de estado + la observación automática R13.7).
 */
export function resolveCastrationTargetCategory(args: {
  sex: AnimalSex | null;
  birthDate: string | null;
  categoryOverride: boolean;
  /** Valor NUEVO de is_castrated (true = castrar, false = revertir). */
  nextCastrated: boolean;
  /** Eventos reproductivos no-borrados del perfil (mismo input que el espejo C6). */
  events: readonly ReproEventInput[];
  /** Catálogo code→name del sistema (ya leído del SQLite local). */
  catalog: readonly CategoryCatalogEntry[];
  /** Inyectable para tests deterministas (default: hoy). */
  today?: Date;
}): DisplayCategory | null {
  if (args.categoryOverride) return null; // override manda: el server no recalcula (R5.6) → nada que anticipar
  const derivedCode = computeCategoryCode({
    sex: args.sex ?? 'female',
    birthDate: args.birthDate,
    isCastrated: args.nextCastrated,
    events: args.events,
    today: args.today,
  });
  const match = args.catalog.find((c) => c.code === derivedCode);
  if (!match) return null; // code destino sin fila en el catálogo → no anticipamos (fail-safe)
  return { code: match.code, name: match.name };
}

// ─── Núcleo PURO del espejo de display (C6 / RC6.3) — sin I/O, testeable a fondo ──────────────
//
// `computeDisplayOverrides` es la decisión COMPLETA del espejo de display, separada del I/O: el caller
// (animals.ts) lee del SQLite local las filas + los eventos + el catálogo y se los pasa YA materializados.
// Por construcción es PURO ⇒ no puede escribir nada (RC6.3.5: display-only, cero mutaciones — propiedad
// ESTRUCTURAL, no solo testeada). Devuelve un Map profileId → { code, name } SOLO para las filas que el
// espejo aplica (override=false + system con catálogo); las demás quedan con su categoría guardada.

/** Fila mínima que el espejo necesita para decidir el display (la cumplen las filas del SQLite local). */
export type MirrorRowInput = {
  profileId: string;
  sex: AnimalSex | null;
  birthDate: string | null;
  systemId: string | null;
  categoryOverride: boolean;
  /** code guardado del perfil (fail-safe + fallback de inferencia de is_castrated cuando no hay real). */
  storedCode: string;
  /** name guardado del perfil (fail-safe). */
  storedName: string;
  /**
   * `animal_profiles.is_castrated` REAL denormalizado (0084, spec 10 R13.6). Si se provee (no null),
   * el espejo lo usa TAL CUAL y NO infiere del code (la castración offline se refleja al instante).
   * Si es `null`/`undefined` (call-site que aún no proyecta la columna — Fase 3), se DEGRADA al fallback
   * `inferIsCastrated(storedCode)` (RC6.2.1). Opcional para no romper los call-sites legacy de C6. */
  isCastrated?: boolean | null;
};

/**
 * Decide la categoría a MOSTRAR de cada fila (display-only). PURO: recibe las filas, los eventos
 * agrupados por profileId (ya ordenados por (event_date, created_at) por el SQL) y el catálogo code→name
 * por systemId. NO hace I/O, NO escribe (RC6.3.5). Reglas: override=true o sin systemId → la guardada (no
 * entra al Map); override=false con catálogo → la derivada (deriveDisplayCategory, con fail-safe a la
 * guardada si el code derivado no está en el catálogo).
 */
export function computeDisplayOverrides(
  rows: readonly MirrorRowInput[],
  eventsByProfile: ReadonlyMap<string, readonly ReproEventInput[]>,
  catalogBySystem: ReadonlyMap<string, readonly CategoryCatalogEntry[]>,
): Map<string, DisplayCategory> {
  const result = new Map<string, DisplayCategory>();
  for (const r of rows) {
    if (r.categoryOverride) continue; // override manda → la guardada (RC6.3.3), no se pisa
    if (!r.systemId) continue; // sin system_id no se resuelve code→name → fail-safe a la guardada (RC6.3.4)
    const catalog = catalogBySystem.get(r.systemId) ?? [];
    // R13.6 / T-CL.7: el `is_castrated` REAL (0084) tiene precedencia. Solo si el call-site no lo provee
    // (null/undefined — Fase 3 aún sin cablear) se DEGRADA a la inferencia por code (RC6.2.1, fallback).
    const isCastrated = r.isCastrated ?? inferIsCastrated(r.storedCode);
    const derivedCode = computeCategoryCode({
      sex: r.sex ?? 'female',
      birthDate: r.birthDate,
      isCastrated,
      events: eventsByProfile.get(r.profileId) ?? [],
    });
    result.set(
      r.profileId,
      deriveDisplayCategory({
        storedCode: r.storedCode,
        storedName: r.storedName,
        categoryOverride: false,
        derivedCode,
        catalog,
      }),
    );
  }
  return result;
}

/**
 * Lógica PURA de override de categoría (alta guiada #4 del context-alta-guiada, refinada en B). En la
 * "alta guiada" el usuario ELIGE la categoría (paso 3 del wizard) en vez de aceptar la computada. Al
 * submit decidimos si esa elección debe PRESERVARSE (override) o dejarse auto-transicionar:
 *   - si la elegida COINCIDE con la que el sistema computaría por sexo+fecha+preñez
 *     (computeInitialCategoryCode) → `false` (el server puede recalcular libremente; ej. ternero recién
 *     nacido elegido "ternero"; o vaquillona_prenada elegida + preñez capturada → derivable).
 *   - si DIFIERE → `true` (preserva la elección; ej. comprás una "multípara" sin historial cargado →
 *     el recálculo por edad/eventos no la debe revertir a vaquillona; A5 "vaca comprada").
 *
 * REFINAMIENTO B: la PREÑEZ capturada en el alta entra en la comparación vía `opts.pregnant`. Esto
 * corrige el sobre-bloqueo de A sobre la `vaquillona_prenada`: si la elegís Y capturás preñez (tacto+),
 * la computada-con-esa-preñez también es `vaquillona_prenada` → COINCIDE → override=false (un parto
 * futuro la transiciona a vaca). Sin la preñez, computa `vaquillona` → diferiría → override=true. Las
 * vacas con partos (multipara / vaca_segundo_servicio) NO son derivables del alta (no capturamos partos)
 * → siempre difieren → override=true (el owner las gestiona manual; el modelo no infiere su historial).
 *
 * `chosen` es el `code` del catálogo elegido (string libre: cualquier categoría del sistema). La
 * comparación es por igualdad de code (trim) contra la computada. `birthDate` ISO 'YYYY-MM-DD' o null.
 * `opts` = { today?, pregnant? } (o un Date posicional legado = { today }).
 */
export function categoryOverrideFor(
  chosen: string,
  sex: AnimalSex,
  birthDate: string | null,
  opts: CategoryComputeOpts | Date = {},
): boolean {
  const computed = computeInitialCategoryCode(sex, birthDate, opts);
  return chosen.trim() !== computed;
}

/** Diferencia en días entre `today` y una fecha ISO 'YYYY-MM-DD'. NaN-safe (null si inválida). */
function ageInDays(birthDateIso: string, today: Date): number | null {
  const birth = parseIsoDate(birthDateIso);
  if (!birth) return null;
  const ms = startOfDay(today).getTime() - birth.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** Parsea 'YYYY-MM-DD' a Date en UTC midnight. null si no matchea el formato o es inválida. */
function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rechaza fechas que "se desbordaron" (ej. 2026-02-31 → marzo).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** Medianoche UTC del día de `d` (para comparar con fechas ISO normalizadas a UTC midnight). */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
