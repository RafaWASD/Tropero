// navigation.ts — helper ÚNICO de screen tracking + breadcrumb de navegación (feature 17, R3.1).
//
// `trackNavigation(pathname)` hace AMBAS cosas desde un solo lugar: breadcrumb de Sentry (R3.2) +
// posthog.screen (R3.4). Recibe SOLO el pathname (R3.3): el caller pasa `segments.join('/')` de expo-router,
// que devuelve segmentos de ARCHIVO (`animal/[id]`), NUNCA valores resueltos ni query params
// (useSegments.d.ts: "`/[id]?id=normal` becomes `['[id]']`") → cero PII por construcción. Delega en los
// wrappers platform-split de sentry/posthog → no-op en web/E2E, real en device.

import { addNavigationBreadcrumb } from './sentry';
import { trackScreen } from './posthog';

/** Registra el cambio de ruta (R3.1). SOLO el pathname; sin params ni PII (R3.3). */
export function trackNavigation(pathname: string): void {
  addNavigationBreadcrumb(pathname); // R3.2 — breadcrumb Sentry
  trackScreen(pathname); // R3.4 — posthog.screen
}
