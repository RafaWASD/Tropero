// payloads.ts — builders PUROS de las formas que salen a Sentry/PostHog (feature 17).
//
// Centraliza la CONSTRUCCIÓN de cada payload outbound en funciones puras, unit-testeables sin el SDK
// (payloads.test.ts). Los wrappers de SDK (sentry.native.ts / posthog.native.ts) son I/O fina que
// consume estos builders → no entran al grafo de node:test (mismo criterio que maneuver-events.ts). Así
// el test de FORMA (R4.2/R6.4/R7.1) ejerce la MISMA función que producción (no un espejo a mano): si
// alguien mete opData/PII en el payload real, lo mete acá → el test cae en rojo.

import type { CrudEntry } from '@powersync/common';

// ─── Nombres de eventos/categorías (constantes únicas) ────────────────────────────────────────────────
export const UPLOAD_REJECTED_EVENT = 'upload_rejected';
export const BLE_BREADCRUMB_CATEGORY = 'ble';
export const NAVIGATION_BREADCRUMB_CATEGORY = 'navigation';
/** Tag de correlación por-captura del requestId (no-PII). Spec 23. */
export const REQUEST_ID_TAG = 'request_id';

/** Eventos de dominio del MVP (R6). Sin PII en sus props (R6.4). */
export const DOMAIN_EVENTS = {
  maniobraGuardada: 'maniobra_guardada',
  importCompletado: 'import_completado',
  invitacionEnviada: 'invitacion_enviada',
} as const;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : value == null ? undefined : String(value);
}

// ─── R4.1 / R4.2 — upload_rejected: SOLO id/table/op/code, JAMÁS opData ────────────────────────────────
/**
 * Payload del sink `upload_rejected` (R4.1). Extrae EXCLUSIVAMENTE `id`, `table`, `op` y `code` — NUNCA
 * `opData` (que puede traer datos del campo) ni ningún otro campo del CrudEntry. `id` es el `op.id` (id de
 * la fila afectada, no-PII) para correlacionar la op rechazada. Omite las claves ausentes. Es la MISMA
 * función que llama el connector: si alguien la ensanchara a opData, payloads.test.ts lo pondría rojo.
 */
export function buildUploadRejectedPayload(
  op: CrudEntry | null,
  error: unknown,
): Record<string, string> {
  const id = asString(op?.id);
  const table = asString(op?.table);
  const opType = asString(op?.op);
  const code = asString((error as { code?: unknown } | null | undefined)?.code);
  const out: Record<string, string> = {};
  if (id !== undefined) out.id = id;
  if (table !== undefined) out.table = table;
  if (opType !== undefined) out.op = opType;
  if (code !== undefined) out.code = code;
  return out;
}

// ─── R4.1 / R4.4 (spec 23) — tags POR-CAPTURA de captureException: mechanism + request_id (no-PII) ─────
/**
 * Tags de UNA captura de excepción de Sentry (R4.1). Scope acotado a esa captura (R4.4): se pasan como el
 * `tags` de esa llamada a `Sentry.captureException`, NUNCA con `setTag` global (que se filtraría a capturas
 * de otras acciones — scope sticky). `request_id` (uuid v4 sin significado → no-PII) correlaciona la captura
 * con la EF/audit/PostHog. Omite las claves ausentes → `{}` si no hay hint (una captura sin requestId NO
 * hereda el de otra). Es la MISMA función que llama `captureExceptionSafe`: si alguien dejara de adjuntar el
 * `request_id`, payloads.test.ts lo pondría rojo.
 */
export function buildCaptureTags(hint?: {
  mechanism?: string;
  requestId?: string;
}): Record<string, string> {
  const tags: Record<string, string> = {};
  if (hint?.mechanism) tags.mechanism = hint.mechanism;
  if (hint?.requestId) tags[REQUEST_ID_TAG] = hint.requestId;
  return tags;
}

// ─── R4.4 — breadcrumb BLE: kind + campos diagnósticos del evento, sin opData/PII ─────────────────────
/**
 * Breadcrumb de un evento de transporte BLE (R4.4). El `TransportLogEvent` (ble/logging.ts) es un union
 * cuyos miembros SOLO llevan campos diagnósticos (kind + reason/attempt/ms/…), nunca el EID crudo ni datos
 * del animal → se puede spread completo sin filtrar PII. `category: 'ble'` para filtrarlos en Sentry.
 */
export function buildBleBreadcrumb(event: Record<string, unknown>): {
  category: string;
  level: 'info';
  data: Record<string, unknown>;
} {
  return { category: BLE_BREADCRUMB_CATEGORY, level: 'info', data: { ...event } };
}

// ─── R3.2 / R3.3 — breadcrumb de navegación: SOLO el pathname (sin params/PII) ────────────────────────
export function buildNavigationBreadcrumb(pathname: string): {
  category: string;
  level: 'info';
  data: { pathname: string };
} {
  return { category: NAVIGATION_BREADCRUMB_CATEGORY, level: 'info', data: { pathname } };
}

// ─── R5.5 — super props del tenant: role + establishment_id + env (no-PII) ─────────────────────────────
/**
 * Super properties del establecimiento activo (R5.5). SOLO metadata no identificatoria: rol
 * por-establecimiento, id del campo (no-PII, derivado del contexto ya scopeado por RLS) y ambiente. NUNCA
 * email/nombre/teléfono.
 */
export function buildTenantRegister(
  establishmentId: string,
  role: string,
  env: string,
): { role: string; establishment_id: string; env: string } {
  return { role, establishment_id: establishmentId, env };
}
