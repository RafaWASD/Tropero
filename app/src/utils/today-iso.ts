// today-iso.ts — FUENTE ÚNICA de "la fecha de hoy" como DATE-ONLY `AAAA-MM-DD`, tomada del wall-clock
// LOCAL del dispositivo. PURO (sin RN, sin red, sin SDK): testeable con node:test.
//
// ── EL BUG QUE CIERRA (🔴 device, QA de maniobras 2026-08-06, hallazgo A.2) ────────────────────────────
// "Hoy" estaba implementado a mano TRECE veces en `app/app` + `app/src`. Cuatro de esas copias lo derivaban
// con `new Date().toISOString().slice(0, 10)`, que es **UTC**. Argentina es UTC−3: entre las 21:00 y las
// 23:59 hora local, el UTC ya está en el día siguiente. Las columnas destino son Postgres `date`
// (`weight_date`, `event_date`, `collection_date`, `measured_at`, …) ⇒ **el dato entra corrido, no es un
// problema de display**: toda la tanda de la tarde/noche —que en el campo es lo normal— quedaba fechada
// MAÑANA. Rompe la ventana de 10 días hábiles de SENASA, la ganancia diaria entre dos pesajes y los filtros
// "de hoy" (medido en el A07: 7 eventos cargados el 06/08 a las 22:54 aparecen en la ficha como 07/08).
// Afectaba manga (`maniobra/carga`), selección masiva y vacunación masiva. Otras DOS —encontradas en el
// fix-loop— anclaban un INSTANTE real por su día UTC con getters, corriendo la EDAD de todo animal un día
// (ver `localDayAnchorUtc`, abajo).
//
// ── POR QUÉ UNA SOLA FUNCIÓN ──────────────────────────────────────────────────────────────────────────
// El proyecto YA tenía la regla escrita ("una fecha date-only va por STRING, nunca por `new Date`", ver
// `format-date-es-ar.ts` + `docs/conventions.md`) y aun así se cumplió en 4 lugares y se violó en 4: con la
// derivación repartida, arreglar una instancia no arregla la clase y la pantalla nueva copia del vecino
// equivocado. El invariante lo cuida `today-iso-guard.test.ts`, escrito sobre la AUSENCIA: un archivo nuevo
// que derive "hoy" por su cuenta nace en rojo. Su oráculo NO está escrito de memoria — sale del git: un test
// trae el cuerpo LITERAL pre-fix de los 13 archivos y exige que cada uno dispare (la primera versión del
// guard, con las reglas imaginadas, era ciega a 7 de 12).
//
// ── POR QUÉ NO VIVE EN `format-date-es-ar.ts` ─────────────────────────────────────────────────────────
// Porque ese módulo es de DISPLAY por contrato declarado ("formateo ÚNICO de fechas para MOSTRAR al
// usuario") y `docs/conventions.md` separa explícitamente el formato de usuario del de MÁQUINA. Lo que
// devuelve `todayIsoLocal` es un valor de máquina: viaja a una columna `date` y a claves idempotentes
// (`bulk-idempotency`), nunca a la pantalla. Meterlo ahí borraría justo la línea que la convención traza.
// Lo que SÍ comparten es la regla de TZ-safety, y por eso cada módulo apunta al otro
// (`format-date-es-ar.ts` tiene el puntero recíproco; la regla, además, está escrita en
// `docs/conventions.md` § "Formato de datos para el usuario").
//
// ── LA SEMÁNTICA, EXPLÍCITA ───────────────────────────────────────────────────────────────────────────
// El día calendario que el operario llama "hoy" es el LOCAL. `getFullYear`/`getMonth`/`getDate` son getters
// locales; `toISOString()` es UTC y NO es intercambiable. Un INSTANTE real (timestamptz: `created_at`,
// `deleted_at`, `started_at`) sí se serializa con `new Date().toISOString()` COMPLETO — eso no es una fecha
// date-only y no pasa por acá.

/**
 * Fecha de HOY como `AAAA-MM-DD` del wall-clock LOCAL. `now` es inyectable para tests deterministas.
 * El orden lexicográfico del string coincide con el orden de fecha (comparable con `<`/`>` sin parsear).
 *
 * Es la ÚNICA forma admitida de derivar una fecha date-only a partir de un `Date` en `app/app` + `app/src`
 * (lo hace cumplir `today-iso-guard.test.ts`). Para un instante real usá `new Date().toISOString()` entero.
 */
export function todayIsoLocal(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * El MISMO día calendario local que `todayIsoLocal`, pero expresado como `Date` a **medianoche UTC** — que
 * es el ancla con la que se hace la aritmética de días contra fechas date-only (un `birth_date` parseado con
 * `Date.UTC(y, m, d)`).
 *
 * ── EL BUG QUE CIERRA (🔴 vivo, fix-loop del QA de maniobras 2026-08-07) ──────────────────────────────
 * Había DOS copias de este ancla escritas como `Date.UTC(x.getUTCFullYear(), x.getUTCMonth(),
 * x.getUTCDate())` sobre un **instante real** (`animal-category.ts startOfDay` y
 * `repro-status.ts ageInDaysFromBirthDate`). Eso toma el día **UTC**: en Argentina (UTC−3), de 21:00 a
 * 23:59 el día UTC ya es el siguiente ⇒ el ancla se corría +1 y **todo animal figuraba un día más viejo**.
 * Es el 🔴 A.2 con getters en vez de con `toISOString()`. Consecuencias medidas: el corte de 365 días
 * (ternera/vaquillona, ternero/torito) se cruzaba tres horas antes todos los días, y la aptitud
 * reproductiva de la manga (`isReproApt`, que decide si se ofrece INSEMINAR) con él.
 *
 * ⚠️ La distinción fina, porque es la que se sigue confundiendo: normalizar a medianoche UTC un `Date` que
 * YA ES una fecha date-only parseada (`animal-form.ts`, `event-input.ts`) es **correcto** — ese dominio es
 * UTC por diseño. Lo que nunca es correcto es leer los componentes **UTC de un INSTANTE real**: el día
 * calendario del operario es el LOCAL. Esta función es el único puente admitido entre los dos mundos.
 */
export function localDayAnchorUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
