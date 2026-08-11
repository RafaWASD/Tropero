// posthog.tsx — CONTRATO + variante WEB/no-op del wiring de PostHog (feature 17).
//
// Platform-split: esta base la resuelve tsc + Metro en WEB (no hay `.web`); en device Metro resuelve
// `posthog.native.tsx`, que importa `posthog-react-native`. La base NO importa el SDK → el import nativo
// queda fuera del bundle web / de los ~70 specs E2E → boot idéntico, todo no-op (R5.2/R8.1), sin depender
// de que `posthog-react-native` soporte react-native-web. El provider igual está SIEMPRE montado (R5.1):
// acá es un passthrough que preserva el árbol; en device envuelve al lib provider con el client singleton.

import type { ReactNode } from 'react';

export type PostHogProviderProps = {
  children: ReactNode;
  /** Ignorado en web (passthrough). En device es el client singleton. */
  client?: unknown;
  /** Ignorado en web. En device: autocapture off (R5.1). */
  autocapture?: boolean;
};

/** Provider SIEMPRE montado (R5.1). WEB/E2E: passthrough (árbol idéntico). */
export function PostHogProvider({ children }: PostHogProviderProps) {
  return <>{children}</>;
}

/** Client singleton (device). WEB: undefined. */
export const posthogClient: unknown = undefined;

/** R5.3 — identify(user.id) sin email/PII. WEB/E2E: no-op. */
export function identifyUser(_id: string): void {
  /* no-op en web/E2E. */
}

/** R5.6 — reset() al cerrar sesión. WEB/E2E: no-op. */
export function resetIdentity(): void {
  /* no-op en web/E2E. */
}

/** R5.4 / R5.5 — group('establishment', id) + register({role, establishment_id, env}). WEB/E2E: no-op. */
export function setTenantGroup(_establishmentId: string, _role: string, _env: string): void {
  /* no-op en web/E2E. */
}

/** R3.4 — screen tracking manual (solo el pathname). WEB/E2E: no-op. */
export function trackScreen(_pathname: string): void {
  /* no-op en web/E2E. */
}

/** R6.1–R6.3 — evento de dominio con props no-PII (R6.4). WEB/E2E: no-op. */
export function captureDomainEvent(_name: string, _props?: Record<string, unknown>): void {
  /* no-op en web/E2E. */
}
