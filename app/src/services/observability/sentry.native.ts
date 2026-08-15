// sentry.native.ts — variante NATIVA (iOS/Android) del wiring de Sentry (feature 17).
//
// Metro resuelve este archivo en device; en web resuelve la base `sentry.ts` (no-op). Acá se importa
// `@sentry/react-native` y se inicializa DE VERDAD, con la doble guarda + el scrubber defense-in-depth.
// La config NATIVA de bajo nivel (config plugin en app.config.ts + metro plugin + source maps + crash
// nativo + buffer offline) es [GATED-FASE0]: este JS ya funciona por OTA sobre un build que la incluya.

import type { ComponentType } from 'react';
import * as Sentry from '@sentry/react-native';
// captureConsoleIntegration vive en @sentry/core (v10, pinned por @sentry/react-native v7): el SDK RN NO lo
// re-exporta desde su índice (verificado en integrations/exports.d.ts). Import del core hoisteado.
import { captureConsoleIntegration } from '@sentry/core';
import type { CrudEntry } from '@powersync/common';

import { getAppEnv, isE2E } from '@/utils/app-env';
import type { TransportLogEvent } from '../ble/logging';
import { getObservabilityEnv } from './env';
import { redactEvent, redactBreadcrumb } from './redact';
import {
  buildUploadRejectedPayload,
  buildBleBreadcrumb,
  buildNavigationBreadcrumb,
  buildCaptureTags,
  UPLOAD_REJECTED_EVENT,
} from './payloads';

export function initSentry(): void {
  const { sentryDsn } = getObservabilityEnv();
  Sentry.init({
    dsn: sentryDsn,
    // R1.2 / R1.3 — doble guarda: sin DSN o en E2E → Sentry queda no-op (no envía).
    enabled: !!sentryDsn && !isE2E(),
    // R1.1 / R7.3 — environment = ambiente real (para segmentar env=production en los dashboards).
    environment: getAppEnv(),
    // R1.1 — tracing mínimo.
    tracesSampleRate: 0,
    // R1.5 — captura console.error app-wide sin tocar call sites.
    integrations: [captureConsoleIntegration({ levels: ['error'] })],
    // R7.4 — scrubber defense-in-depth, fail-closed (redact.ts devuelve null → Sentry descarta).
    beforeSend: (event) => redactEvent(event),
    beforeBreadcrumb: (breadcrumb) => redactBreadcrumb(breadcrumb),
    // R7.5 (M4) — NO subir pixeles/jerarquía de views = no PII visual (bypassean el scrubber key-based).
    attachScreenshot: false,
    attachViewHierarchy: false,
    // enableFeedbackOnShake / feedback widget → R2.7 [GATED-FASE0]. Cuando se habilite: NUNCA sobre un
    // tenant real sin decisión aparte (el screenshot del shake = PII visual, R7.5).
  });
}

export function wrapRoot<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  // Sentry.wrap está tipado con props fijas (Record<string, unknown>), no genérico → cast en ambos sentidos.
  return Sentry.wrap(Component as ComponentType<Record<string, unknown>>) as ComponentType<P>;
}

export function captureExceptionSafe(
  error: unknown,
  hint?: { mechanism?: string; requestId?: string },
): void {
  try {
    // Tags POR-CAPTURA (no setTag global): mechanism + request_id de correlación (no-PII, spec 23).
    // Builder puro (payloads.ts), testeado en payloads.test.ts → esta es la MISMA función que produce el tag.
    const tags = buildCaptureTags(hint);
    Sentry.captureException(
      error,
      Object.keys(tags).length > 0 ? { tags } : undefined,
    );
  } catch {
    /* best-effort: el reporte nunca rompe el flujo del operario. */
  }
}

export function captureUploadRejected(op: CrudEntry | null, error: unknown): void {
  try {
    // SOLO table/op/code (builder puro, testeado). El scrubber `beforeSend` es el segundo cerrojo.
    Sentry.captureMessage(UPLOAD_REJECTED_EVENT, {
      level: 'warning',
      tags: buildUploadRejectedPayload(op, error),
    });
  } catch {
    /* best-effort: no propaga ni demora el drenado de la upload queue. */
  }
}

export function addBleBreadcrumb(event: TransportLogEvent): void {
  try {
    Sentry.addBreadcrumb(buildBleBreadcrumb(event as unknown as Record<string, unknown>));
  } catch {
    /* best-effort: el logging jamás propaga (R15.2). */
  }
}

export function addNavigationBreadcrumb(pathname: string): void {
  try {
    Sentry.addBreadcrumb(buildNavigationBreadcrumb(pathname));
  } catch {
    /* best-effort. */
  }
}
