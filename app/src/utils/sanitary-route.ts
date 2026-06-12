// Vía de aplicación sanitaria (`sanitary_events.route`) — opciones + validación PURAS.
//
// FIX VIA-ENUM-MISMATCH (Gate 2 HIGH, spec 10 UI-B2): la pantalla de vacunación masiva tomaba la vía
// como TEXTO LIBRE y lo mandaba crudo al INSERT. Pero `route` es el ENUM `public.sanitary_route`
// (`supabase/migrations/0027_sanitary_events.sql:5,16`) con SOLO 5 valores; un string fuera del enum
// hace que Postgres rechace el INSERT con 22P02 → la op se descarta PERMANENTE al subir → pérdida de
// datos. Este módulo es la única fuente de verdad de las opciones que la UI puede ofrecer, y garantiza
// que lo que viaja al INSERT es SIEMPRE un código del enum o null (nunca texto libre).
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠️ ANTI-DRIFT — los códigos DEBEN ser EXACTAMENTE el enum `sanitary_route` de la migración 0027:
//     create type public.sanitary_route as enum
//       ('intramuscular','subcutaneous','oral','topical','other');
//   Si una migración futura agrega/quita un valor del enum, actualizar SANITARY_ROUTES acá + su test.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Los 5 valores del enum `public.sanitary_route` (0027). Orden = orden de display de los chips. */
export const SANITARY_ROUTES = [
  'subcutaneous',
  'intramuscular',
  'oral',
  'topical',
  'other',
] as const;

export type SanitaryRoute = (typeof SANITARY_ROUTES)[number];

/** Labels es-AR de cada vía (consistentes con `humanizeRoute` de event-timeline; `other` → "Otra"). */
const ROUTE_LABEL: Record<SanitaryRoute, string> = {
  subcutaneous: 'Subcutánea',
  intramuscular: 'Intramuscular',
  oral: 'Oral',
  topical: 'Tópica',
  other: 'Otra',
};

export type RouteOption = { code: SanitaryRoute; label: string };

/** Opciones de vía para el selector (chips): cada una con su código del enum + label es-AR. PURO. */
export function routeOptions(): RouteOption[] {
  return SANITARY_ROUTES.map((code) => ({ code, label: ROUTE_LABEL[code] }));
}

/** Type-guard: `x` es un código válido del enum `sanitary_route`. Cualquier otra cosa → false. */
export function isValidRoute(x: unknown): x is SanitaryRoute {
  return typeof x === 'string' && (SANITARY_ROUTES as readonly string[]).includes(x);
}

/**
 * Normaliza un valor a lo que puede viajar al INSERT de `sanitary_events.route`: un código válido del
 * enum o `null`. Es la barrera dura contra texto libre — si `x` no es uno de los 5 códigos, devuelve
 * null (nunca el string crudo). El selector de la UI ya solo produce códigos válidos; esto garantiza
 * el invariante aunque cambie el llamador.
 */
export function toRouteValue(x: unknown): SanitaryRoute | null {
  return isValidRoute(x) ? x : null;
}
