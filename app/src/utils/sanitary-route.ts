// Vía de aplicación sanitaria (`sanitary_events.route`) — opciones + validación PURAS.
//
// FIX VIA-ENUM-MISMATCH (Gate 2 HIGH, spec 10 UI-B2): la pantalla de vacunación masiva tomaba la vía
// como TEXTO LIBRE y lo mandaba crudo al INSERT. Pero `route` es el ENUM `public.sanitary_route`
// (`supabase/migrations/0027_sanitary_events.sql:5,16` + `intranasal` de 0090); un string fuera del enum
// hace que Postgres rechace el INSERT con 22P02 → la op se descarta PERMANENTE al subir → pérdida de
// datos. Este módulo es la única fuente de verdad de las opciones que la UI puede ofrecer, y garantiza
// que lo que viaja al INSERT es SIEMPRE un código del enum o null (nunca texto libre).
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ ANTI-DRIFT — los códigos DEBEN ser EXACTAMENTE el enum `sanitary_route` de la migración 0027
//   MÁS el delta de la migración 0090:
//     create type public.sanitary_route as enum
//       ('intramuscular','subcutaneous','oral','topical','other');   -- 0027
//     alter type public.sanitary_route add value 'intranasal';        -- 0090
//   ⇒ el enum REAL tiene 6 valores. Si una migración futura agrega/quita un valor del enum,
//   actualizar SANITARY_ROUTES acá + su test.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Los 6 valores del enum `public.sanitary_route` (0027 + 0090). Orden = orden de display de los chips. */
export const SANITARY_ROUTES = [
  'subcutaneous',
  'intramuscular',
  'intranasal',
  'oral',
  'topical',
  'other',
] as const;

export type SanitaryRoute = (typeof SANITARY_ROUTES)[number];

/** Labels es-AR de cada vía (consistentes con `humanizeRoute` de event-timeline; `other` → "Otra"). */
const ROUTE_LABEL: Record<SanitaryRoute, string> = {
  subcutaneous: 'Subcutánea',
  intramuscular: 'Intramuscular',
  intranasal: 'Intranasal',
  oral: 'Oral',
  topical: 'Tópica',
  other: 'Otra',
};

export type RouteOption = { code: SanitaryRoute; label: string };

/**
 * Opciones de vía GENÉRICAS (las 6 del enum) para forms sanitarios NO-vacuna (desparasitación,
 * tratamiento) que se construyan a futuro: cada una con su código del enum + label es-AR. PURO.
 * Para el selector de VACUNACIÓN, usar `vaccineRouteOptions()` (subconjunto curado, ver abajo).
 */
export function routeOptions(): RouteOption[] {
  return SANITARY_ROUTES.map((code) => ({ code, label: ROUTE_LABEL[code] }));
}

/**
 * Subconjunto CURADO de vías de VACUNA (en orden de display). El enum `sanitary_route` tiene 6
 * valores porque `route` es compartido por TODOS los sanitary_events (vacunación + desparasitación +
 * tratamiento). Pero como VÍAS DE VACUNA solo tienen sentido tres:
 *   - subcutánea / intramuscular → las dos vías parenterales estándar de vacuna bovina;
 *   - intranasal → vacunas respiratorias vivas (IBR/BRSV/PI3).
 * Quedan FUERA del selector de vacunación (pero SIGUEN en el enum, para otros sanitary_events):
 *   - topical → es pour-on antiparasitario, NO una vía de vacuna;
 *   - oral → prácticamente no existe como vía de vacuna bovina;
 *   - other → cajón de sastre, innecesario con las 3 reales.
 */
export const VACCINE_ROUTES = ['subcutaneous', 'intramuscular', 'intranasal'] as const;

/** Opciones de vía para el selector de VACUNACIÓN (chips): las 3 vías curadas con su label es-AR. PURO. */
export function vaccineRouteOptions(): RouteOption[] {
  return VACCINE_ROUTES.map((code) => ({ code, label: ROUTE_LABEL[code] }));
}

/** Type-guard: `x` es un código válido del enum `sanitary_route`. Cualquier otra cosa → false. */
export function isValidRoute(x: unknown): x is SanitaryRoute {
  return typeof x === 'string' && (SANITARY_ROUTES as readonly string[]).includes(x);
}

/**
 * Normaliza un valor a lo que puede viajar al INSERT de `sanitary_events.route`: un código válido del
 * enum o `null`. Es la barrera dura contra texto libre — si `x` no es uno de los códigos del enum,
 * devuelve null (nunca el string crudo). Opera sobre el enum COMPLETO (las 6 vías, incl. topical/oral/
 * other): todas son valores válidos de DB para sanitary_events.route, aunque el selector de VACUNACIÓN
 * solo OFREZCA 3 (ver VACCINE_ROUTES). El selector de la UI ya solo produce códigos válidos; esto
 * garantiza el invariante aunque cambie el llamador.
 */
export function toRouteValue(x: unknown): SanitaryRoute | null {
  return isValidRoute(x) ? x : null;
}
