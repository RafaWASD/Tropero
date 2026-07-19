// Clasificación de errores de Supabase/PostgREST a un resultado accionable para la UI.
//
// Módulo PURO (sin cliente de Supabase, sin PowerSync) — extraído de `establishments.ts` para poder
// testearlo con node:test sin arrastrar el SDK a la suite unitaria (RTEL.14.9.1). Mismo patrón que
// `powersync/upload-classify.ts`.
//
// ⚠️ RESTRICCIÓN DE SEGURIDAD (HIGH-1 del Gate 1 — RTEL.8.5 / RTEL.8.6). La firma consume SOLO
//    `message` y `code`. NO se amplía para leer `details` ni `hint`, y la rama de `23514` NO devuelve
//    el `message` crudo de Postgres.
//
//    El motivo es concreto: ante un CHECK violado, PostgREST expone en `details` el
//    `DETAIL: Failing row contains (...)` de Postgres, que en `user_private` trae **email y teléfono en
//    claro** (el rol `authenticated` tiene `grant select` sobre la tabla). Hoy eso no llega a la UI
//    *solo porque la firma no lo consume* — una protección accidental. Ampliar la firma "para dar mejor
//    diagnóstico" es el refactor más natural del mundo y traería la PII al cliente y a sus logs.
//    Este archivo y `classify-error.test.ts` son la pata EJECUTABLE de la aceptación del riesgo R-7:
//    si alguien afloja esto, el test se pone rojo.

import { PHONE_FORMAT_REJECTED_COPY } from '../utils/phone';

/** Forma mínima del error que se clasifica. NO incluye `details` ni `hint` — ver la nota de arriba. */
export type ClassifiableError = { message?: string; code?: string } | null;

export type ClassifiedErrorKind = 'network' | 'phone_format' | 'unknown';

export type ClassifiedError = {
  kind: ClassifiedErrorKind;
  /** Texto para la UI. En `phone_format` es SIEMPRE el copy fijo (nunca algo derivado del error). */
  message: string;
};

/** Código Postgres de violación de CHECK constraint. */
const CHECK_VIOLATION = '23514';

/**
 * El CHECK de formato del teléfono (migración 0126). Se matchea contra `message` —que es el texto de
 * Postgres "violates check constraint <nombre>", SIN PII— y nunca contra `details`, que es donde vive
 * la fila que falló.
 */
const PHONE_FORMAT_CONSTRAINT = /user_private_phone_format_chk/;

/** Errores de red de fetch (sin status HTTP): "Failed to fetch" / "Network request failed". */
const NETWORK_MESSAGE = /network|failed to fetch|fetch failed/i;

export function classifyError(error: ClassifiableError): ClassifiedError {
  const msg = error?.message ?? '';

  if (NETWORK_MESSAGE.test(msg)) {
    return { kind: 'network', message: msg };
  }

  // RTEL.8.3 — el rechazo del formato del teléfono se traduce a un copy accionable, no a un error
  // genérico ni de red. El copy es CONSTANTE: no se compone con nada del error (RTEL.8.5).
  if (error?.code === CHECK_VIOLATION && PHONE_FORMAT_CONSTRAINT.test(msg)) {
    return { kind: 'phone_format', message: PHONE_FORMAT_REJECTED_COPY };
  }

  return { kind: 'unknown', message: msg || 'Error desconocido' };
}
