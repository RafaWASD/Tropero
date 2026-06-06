// Lógica PURA de categoría inicial al alta (spec 02 R4.7 / RT2.20) — espejo cliente de
// compute_category. Sin RN, sin red, sin supabase-js: testeable con node:test.
//
// POR QUÉ existe (no llamamos compute_category(profile_id) en el alta):
//   La RPC compute_category(profile_id) del server (migration 0062, reescritura Tier 2/3) recibe un
//   perfil que YA EXISTE. En el alta el perfil todavía no existe (lo estamos por insertar) y
//   category_id es NOT NULL en animal_profiles → necesitamos la categoría ANTES del insert.
//   Replicamos acá la rama "sin eventos" de compute_category (un animal recién creado no tiene
//   partos, tactos, destete ni servicio), que depende SOLO de sex + birth_date + is_castrated.
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
// Las transiciones posteriores (preñez, parto, destete, servicio, edad) las maneja el server vía
// triggers + el job nocturno (spec 02 Tier 2); el cliente NO recomputa categoría tras eventos.
// Acá solo el alta.

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

export type AnimalSex = 'male' | 'female';

const ONE_YEAR_DAYS = 365;
const TWO_YEAR_DAYS = 730;

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
  const ageDays = birthDate ? ageInDays(birthDate, today) : null;
  // edad conocida = no null y no futura (negativa). Si es desconocida → default conservador por sexo.
  const knownAge = ageDays !== null && ageDays >= 0 ? ageDays : null;

  if (sex === 'male') {
    if (knownAge === null) return 'torito'; // sin fecha → default conservador (= backend, RT2.3.4)
    if (knownAge >= TWO_YEAR_DAYS) return 'toro'; // ≥ 2 años (RT2.3.3)
    if (knownAge >= ONE_YEAR_DAYS) return 'torito'; // 1–2 años (RT2.3.2)
    return 'ternero'; // < 1 año (RT2.3.1)
  }

  // hembra
  if (pregnant) return 'vaquillona_prenada'; // refinamiento B: tacto+ capturado → derivable, sin importar edad
  if (knownAge === null) return 'vaquillona'; // sin fecha → default conservador (= backend, RT2.4.6)
  if (knownAge >= ONE_YEAR_DAYS) return 'vaquillona'; // ≥ 1 año (RT2.4.4)
  return 'ternera'; // < 1 año (RT2.4.5)
}

/** Normaliza el 3er argumento (objeto de opciones o un Date posicional legado) a { today, pregnant }. */
function normalizeOpts(opts: CategoryComputeOpts | Date): { today: Date; pregnant: boolean } {
  if (opts instanceof Date) return { today: opts, pregnant: false };
  return { today: opts.today ?? new Date(), pregnant: opts.pregnant ?? false };
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
