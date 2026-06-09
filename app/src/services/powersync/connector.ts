// connector.ts — SupabaseConnector implements PowerSyncBackendConnector (T1.5 / R3.1–R3.5).
//
// fetchCredentials(): toma el endpoint de EXPO_PUBLIC_POWERSYNC_URL (getEnv) + el access_token de la
//   sesión Supabase actual. autoRefreshToken (supabase.ts) renueva el JWT vencido → getSession()
//   devuelve el fresco y PowerSync re-pide credenciales sin logout forzado (R3.2). Sin sesión →
//   devuelve null (contrato del SDK: "Return null if the user is not signed in") → no conecta hasta
//   el próximo login. NUNCA loguea el token ni la sesión (igual que supabase.ts).
//
// uploadData(): drena la upload queue en orden, una CrudTransaction por vez. EN ESTE RUN implementa
//   SOLO la BASE de CRUD plano (upsert/update por op.table/op.id contra Supabase): transitorio →
//   re-throw (deja la tx en cola para reintento, R3.4); permanente → complete (descarta para no
//   bloquear el resto, R3.5/R8.1) + log observable (R10.2). Server-side siguen RLS + triggers
//   (created_by/author_id forzados) + CHECKs (R6.2) — el upload NO los omite.
//
// ⚠️ Run T6 (NO en este run): el mapeo op_intents→RPC (§5.4.2), el overlay optimista local-only y la
//   idempotencia/rollback (R6.8–R6.12) quedan como STUB MARCADO abajo. Este run NO wirea escritura
//   offline de las ops (b) RPC-bound.

import { UpdateType, type AbstractPowerSyncDatabase, type CrudEntry, type PowerSyncBackendConnector, type PowerSyncCredentials } from '@powersync/common';

import { supabase } from '../supabase';
import { getEnv } from '../../utils/env';
import { buildCredentials, isTransientUploadError } from './upload-classify';

/** Tabla outbox (insertOnly). En este run NO se procesa (stub Run T6); se reconoce para no tratarla como CRUD plano. */
const OP_INTENTS_TABLE = 'op_intents';

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data } = await supabase.auth.getSession();
    const endpoint = getEnv().powersyncUrl;
    // buildCredentials es PURA (testeada aparte): null si no hay token (no conectar), si no { endpoint, token }.
    const credentials = buildCredentials(endpoint, data.session);
    // TODO(debug 15-powersync): quitar tras diagnosticar. NUNCA loguear el VALOR del token ni de la sesión
    // (convención de supabase.ts) — solo booleanos + el endpoint (público).
    // eslint-disable-next-line no-console
    console.log('[powersync] fetchCredentials', {
      hasSession: !!data.session,
      hasToken: !!credentials,
      endpoint,
    });
    if (!credentials) {
      // eslint-disable-next-line no-console
      console.warn('[powersync] fetchCredentials: sin sesión → no conecta');
    }
    return credentials;
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    let lastOp: CrudEntry | null = null;
    try {
      for (const op of transaction.crud) {
        lastOp = op;

        // ── STUB Run T6: outbox op_intents → supabase.rpc(...) ──────────────────────────
        // Las ops (b) RPC-bound (register_birth/exit_animal_profile/soft_delete_*/create_animal)
        // se encolan como op_intents (insertOnly) y se mapean a RPC en el drenado, con idempotencia
        // (client_op_id), overlay local-only y rollback (R6.8–R6.12). Eso es Run T6: este run NO lo
        // wirea. Si apareciera una op_intents en la cola, NO la procesamos como CRUD plano (sería
        // incorrecto) y la dejamos para que la implemente T6.
        if (op.table === OP_INTENTS_TABLE) {
          // TODO Run T6: applyIntent(op) — mapeo op_intents → supabase.rpc + idempotencia + overlay/rollback.
          throw new Error('op_intents upload no implementado en Run 1 (pendiente Run T6)');
        }

        // ── BASE: CRUD plano contra PostgREST (RLS + triggers + CHECKs siguen aplicando, R6.2) ──
        const table = supabase.from(op.table);
        switch (op.op) {
          case UpdateType.PUT: {
            const { error } = await table.upsert({ ...op.opData, id: op.id });
            if (error) throw error;
            break;
          }
          case UpdateType.PATCH: {
            const { error } = await table.update(op.opData ?? {}).eq('id', op.id);
            if (error) throw error;
            break;
          }
          case UpdateType.DELETE: {
            // No se usa para datos: el soft-delete va por outbox→RPC (design §5.3.1, Run T6). Un
            // DELETE plano contra PostgREST sería rechazado (la fila sale de la SELECT-policy).
            break;
          }
        }
      }

      await transaction.complete();
    } catch (error) {
      if (isTransientUploadError(error)) {
        // R3.4/R6.9: transitorio (red caída / 5xx) → re-throw deja la tx en cola para reintento.
        throw error;
      }
      // R3.5/R8.1: rechazo PERMANENTE (RLS 42501 / constraint / check) → descartar la op para no
      // bloquear el resto de la cola + registro observable (R10.2). NUNCA se loguea opData (puede
      // traer datos del campo); solo tabla + op + code.
      surfaceUploadRejection(lastOp, error);
      await transaction.complete();
    }
  }
}

/** Registro observable de un rechazo permanente de upload (R10.2). Best-effort, sin filtrar datos. */
function surfaceUploadRejection(op: CrudEntry | null, error: unknown): void {
  try {
    const code = (error as { code?: unknown })?.code;
    // eslint-disable-next-line no-console
    console.warn('[powersync] upload rechazado (descartado)', {
      table: op?.table,
      op: op?.op,
      code: typeof code === 'string' ? code : undefined,
    });
  } catch {
    /* noop: el logger nunca rompe el drenado */
  }
}
