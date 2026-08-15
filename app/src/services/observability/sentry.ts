// sentry.ts — CONTRATO + variante WEB/no-op del wiring de Sentry (feature 17).
//
// Platform-split (misma técnica que google-auth.ts / apple-auth.ts): este archivo BASE define la firma
// pública y es el que resuelve tsc (typecheck) Y Metro en WEB (no hay `sentry.web.ts`: la base ES la web).
// En iOS/Android Metro resuelve `sentry.native.ts`, que importa `@sentry/react-native` e inicializa de
// verdad. La base NO importa el SDK nativo → el import nativo queda FUERA del grafo del bundle web y de los
// ~70 specs E2E (que corren sobre el build web) → boot idéntico, no-op garantizado (R1.3/R8.1), sin
// depender de que `@sentry/react-native` soporte web. La config NATIVA (config plugin, source maps, crash
// nativo, buffer offline) es [GATED-FASE0].

import type { ComponentType } from 'react';
import type { CrudEntry } from '@powersync/common';

import type { TransportLogEvent } from '../ble/logging';

/** Inicializa Sentry a nivel módulo (R1.1). WEB/E2E: no-op. */
export function initSentry(): void {
  /* no-op en web/E2E: Sentry es device-only (nativo, [GATED-FASE0]). */
}

/** Envuelve el componente raíz (R1.4). WEB/E2E: identidad (no altera el árbol). */
export function wrapRoot<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  return Component;
}

/**
 * Reporta una excepción best-effort (R2.5). `hint.mechanism` distingue el origen (p.ej. RootErrorBoundary);
 * `hint.requestId` correlaciona la captura (tag `request_id` por-captura en nativo, spec 23). WEB/E2E: no-op.
 */
export function captureExceptionSafe(
  _error: unknown,
  _hint?: { mechanism?: string; requestId?: string },
): void {
  /* no-op en web/E2E. */
}

/** Sink de rechazo permanente de upload (R4.1): SOLO table/op/code, jamás opData. WEB/E2E: no-op. */
export function captureUploadRejected(_op: CrudEntry | null, _error: unknown): void {
  /* no-op en web/E2E. */
}

/** Breadcrumb de un evento de transporte BLE (R4.4), sin opData/PII. WEB/E2E: no-op. */
export function addBleBreadcrumb(_event: TransportLogEvent): void {
  /* no-op en web/E2E. */
}

/** Breadcrumb de navegación con SOLO el pathname (R3.2/R3.3). WEB/E2E: no-op. */
export function addNavigationBreadcrumb(_pathname: string): void {
  /* no-op en web/E2E. */
}
