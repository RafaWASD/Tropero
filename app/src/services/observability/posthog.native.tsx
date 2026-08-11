// posthog.native.tsx — variante NATIVA (iOS/Android) del wiring de PostHog (feature 17).
//
// Metro resuelve este archivo en device; en web resuelve la base `posthog.tsx` (passthrough/no-op). Acá se
// crea UN client singleton (design §4/§9) y se pasa al PostHogProvider del lib. Un solo punto de acceso
// testeable desde React (provider/hooks) y desde servicios no-React (eventos de dominio) → sin dos clients.
// Las deps nativas de `posthog-react-native` + peers en el APK son [GATED-FASE0] (el wiring JS llega por OTA).

import type { ReactNode } from 'react';
import { PostHog, PostHogProvider as LibPostHogProvider } from 'posthog-react-native';

import { isE2E } from '@/utils/app-env';
import { getObservabilityEnv } from './env';
import { buildTenantRegister } from './payloads';

const { posthogKey, posthogHost } = getObservabilityEnv();

// R5.1 / R5.2 — client singleton. disabled sin key o en E2E → todas las llamadas son no-op.
export const posthogClient = new PostHog(posthogKey ?? '', {
  host: posthogHost,
  disabled: !posthogKey || isE2E(),
});

export type PostHogProviderProps = {
  children: ReactNode;
  client?: unknown;
  autocapture?: boolean;
};

/** R5.1 — provider SIEMPRE montado, autocapture off, con el client singleton. */
export function PostHogProvider({ children, client, autocapture }: PostHogProviderProps) {
  return (
    <LibPostHogProvider client={(client as PostHog) ?? posthogClient} autocapture={autocapture ?? false}>
      {children}
    </LibPostHogProvider>
  );
}

export function identifyUser(id: string): void {
  try {
    // R5.3 — SOLO el id como distinct id; nada de email/nombre.
    posthogClient.identify(id);
  } catch {
    /* best-effort. */
  }
}

export function resetIdentity(): void {
  try {
    // R5.6 — no cruzar identidades en un teléfono compartido.
    posthogClient.reset();
  } catch {
    /* best-effort. */
  }
}

export function setTenantGroup(establishmentId: string, role: string, env: string): void {
  try {
    // R5.4 — group; R5.5 — super props (role/establishment_id/env), no-PII (builder puro testeado).
    posthogClient.group('establishment', establishmentId);
    posthogClient.register(buildTenantRegister(establishmentId, role, env));
  } catch {
    /* best-effort. */
  }
}

export function trackScreen(pathname: string): void {
  try {
    // R3.4 — screen tracking manual con SOLO el pathname (sin params/PII, R3.3).
    posthogClient.screen(pathname);
  } catch {
    /* best-effort. */
  }
}

export function captureDomainEvent(name: string, props?: Record<string, unknown>): void {
  try {
    // R6.1–R6.3 — evento de dominio; props no-PII las arma el call site (R6.4). Cast al tipo de props del
    // SDK (PostHogEventProperties: valores JSON) — nuestros call sites solo pasan string/number.
    posthogClient.capture(name, props as unknown as Parameters<typeof posthogClient.capture>[1]);
  } catch {
    /* best-effort. */
  }
}
