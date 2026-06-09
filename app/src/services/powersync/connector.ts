// connector.ts — SupabaseConnector implements PowerSyncBackendConnector (T1.5 / R3.1–R3.5).
//
// fetchCredentials(): toma el endpoint de EXPO_PUBLIC_POWERSYNC_URL (getEnv) + el access_token de la
//   sesión Supabase actual. autoRefreshToken (supabase.ts) renueva el JWT vencido → getSession()
//   devuelve el fresco y PowerSync re-pide credenciales sin logout forzado (R3.2). Sin sesión →
//   devuelve null (contrato del SDK: "Return null if the user is not signed in") → no conecta hasta
//   el próximo login. NUNCA loguea el token ni la sesión (igual que supabase.ts).
//
// uploadData(): drena la upload queue en orden FIFO, una CrudTransaction por vez. Procesa DOS clases de
//   CrudEntry, distinguidas por op.table (§5.4):
//   (1) CRUD plano (tablas de datos sincronizadas): upsert/update por op.table/op.id contra Supabase.
//   (2) op_intents (outbox, insertOnly): mapeo a supabase.rpc(...) (§5.4.2) — las (b) RPC-bound (alta,
//       parto, baja, soft-deletes). create_animal NO tiene RPC → 2 upserts idempotentes (ON CONFLICT por
//       PK). p_client_op_id SOLO a register_birth (delta 0075). Idempotencia at-least-once (§5.4.3) +
//       ACK/rollback del overlay local-only (§5.4.4): éxito → clearOverlay; transitorio → re-throw (queda
//       en cola); permanente → rollbackOverlay + descarte + superficia; P0002 de soft_delete_* / 23505 del
//       índice de idempotencia de register_birth → descarte idempotente SIN rollback (la op ya corrió).
//
//   Transitorio → re-throw (deja la tx en cola para reintento, R3.4); permanente → complete (descarta
//   para no bloquear el resto, R3.5/R8.1) + log observable (R10.2). Server-side siguen RLS + triggers
//   (created_by/author_id forzados) + CHECKs (R6.2) — el upload NO los omite.

import { UpdateType, type AbstractPowerSyncDatabase, type CrudEntry, type PowerSyncBackendConnector, type PowerSyncCredentials } from '@powersync/common';

import { supabase } from '../supabase';
import { getEnv } from '../../utils/env';
import { buildCredentials, isTransientUploadError } from './upload-classify';
import { mapIntentToRpc, classifyIntentUploadError } from './upload';
import { clearOverlay, rollbackOverlay } from './outbox';

/** Tabla outbox (insertOnly): genera CrudEntry pero se mapea a supabase.rpc (§5.4.2), NO a CRUD plano. */
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

    // Una op (b) RPC-bound se encola como UN op_intent (insertOnly) en su PROPIA writeTransaction (el
    // overlay pending_* es localOnly → no genera CrudEntry, R6.12) → la CrudTransaction de un intent es
    // single-op. La detectamos y la procesamos por el camino de intención (idempotencia + overlay).
    const intentOp = transaction.crud.find((o) => o.table === OP_INTENTS_TABLE);
    if (intentOp) {
      await this.applyIntentTransaction(intentOp, transaction, database);
      return;
    }

    // ── CRUD plano (tablas de datos sincronizadas) ──────────────────────────────────────
    let lastOp: CrudEntry | null = null;
    try {
      for (const op of transaction.crud) {
        lastOp = op;
        // ── CRUD plano contra PostgREST (RLS + triggers + CHECKs siguen aplicando, R6.2) ──
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
            // No se usa para datos: el soft-delete va por outbox→RPC (design §5.3.1). Un DELETE plano
            // contra PostgREST sería rechazado (la fila sale de la SELECT-policy).
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

  /**
   * Procesa la CrudTransaction de un op_intent (outbox → RPC, §5.4.2–§5.4.4). FIFO: PowerSync entrega las
   * transacciones en orden de encolado, así que las dependencias cross-op (alta → evento sobre ese animal)
   * se preservan. La idempotencia at-least-once la garantiza la dedup por op (client_op_id en register_birth
   * vía el delta 0075; ids de cliente en create_animal; guarda deleted_at en soft_delete_*; transición de
   * status en exit). El client_op_id = op.id (el id de la fila op_intents).
   */
  private async applyIntentTransaction(
    op: CrudEntry,
    transaction: { complete: () => Promise<void> },
    database: AbstractPowerSyncDatabase,
  ): Promise<void> {
    const clientOpId = op.id;
    const opType = typeof op.opData?.op_type === 'string' ? op.opData.op_type : '';
    try {
      const plan = mapIntentToRpc({ id: op.id, opData: op.opData ?? null });
      if (plan.kind === 'create_animal') {
        // create_animal NO tiene RPC en el schema as-built → 2 upserts idempotentes por PK (ON CONFLICT
        // por el id de cliente, R6.10). animals primero (el perfil tiene FK animal_id → animals.id). Si el
        // upsert del perfil falla (p.ej. idv duplicado), el animals ya quedó (huérfano invisible por RLS,
        // como el split-insert online) — el rollback del overlay revierte la VISTA optimista local igual.
        const { error: aErr } = await supabase.from('animals').upsert(plan.animals);
        if (aErr) throw aErr;
        const { error: pErr } = await supabase.from('animal_profiles').upsert(plan.animal_profiles);
        if (pErr) throw pErr;
      } else {
        // register_birth / exit_animal_profile / soft_delete_* → supabase.rpc con sus args (p_client_op_id
        // SOLO en register_birth, ya inyectado por mapIntentToRpc).
        const { error } = await supabase.rpc(plan.rpcName, plan.args);
        if (error) throw error;
      }
      // ── ACK (éxito, R6.11): la op corrió server-side. Limpiar el overlay local-only: las filas reales
      //    bajan por la stream → el UNION deja de mostrar el overlay (sin duplicado). complete() saca el
      //    op_intent de la cola atómicamente.
      await clearOverlay(clientOpId, { db: database });
      await transaction.complete();
    } catch (error) {
      const disposition = classifyIntentUploadError(error, opType);
      if (disposition === 'transient') {
        // R3.4/R6.9: red caída / 5xx → re-throw deja la tx en cola para reintento. NO se toca el overlay
        // (la op sigue "en vuelo"; la UI muestra el efecto optimista como pendiente).
        throw error;
      }
      if (disposition === 'idempotent_discard') {
        // La op YA corrió server-side (reintento at-least-once cuyo ACK se perdió): P0002 de un
        // soft_delete_* ya aplicado, o 23505 del índice de idempotencia de register_birth (MED-1). Éxito
        // idempotente: descartar SIN rollback (la fila real ya está borrada/creada server-side) + limpiar
        // overlay (la fila real bajó/bajará por la stream). NO se superficia (es un no-op exitoso).
        await clearOverlay(clientOpId, { db: database });
        await transaction.complete();
        return;
      }
      // R3.5/R8.1/R6.11: rechazo PERMANENTE (RLS 42501, FK 23503, check 23514, tag duplicado 23505, intent
      // corrupto) → rollback del overlay local-only (el ternero/alta desaparece del UNION; la baja/borrado
      // se des-oculta) + descarte de la intención (no loop) + registro observable (R10.2).
      await rollbackOverlay(clientOpId, { db: database });
      await transaction.complete();
      surfaceUploadRejection(op, error);
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
