// Capa de datos de la cuenta del usuario (spec 01, Fase 6 — T6.1 email / T6.3 eliminar cuenta).
//
// Dos operaciones administrativas ONLINE (R9.2: identidad/baja no se sincronizan offline). Este
// archivo solo hace el I/O (supabase-js); el mapeo de resultados es lógica PURA en
// utils/account-result.ts (testeable bajo node, sin RN/red).
//
//   1. changeEmail(newEmail) — R2.1/R2.2. `supabase.auth.updateUser({ email })`. Supabase maneja
//      la DOBLE confirmación nativa y MANTIENE el email viejo hasta que se confirme desde el mail
//      nuevo (R2.2 nativo, sin migración). El display de "Más" sigue mostrando el email viejo (que
//      es lo que da el session) hasta que el usuario confirme.
//
//   2. deleteAccount() — R2.4/R2.5/R2.5.1. Invoca el edge `delete_account` (ya gateado: RPC atómica
//      `delete_account_tx` migración 0058 + signOut global + ban; ver design-T6.3-delete-account.md).
//      Identidad SOLO del JWT (sin user_id en el body → sin IDOR). Result TIPADO con los casos del
//      contrato: ok / already_deleted / sole_owner (con la lista de campos bloqueantes, R2.5.1) /
//      network / unauthorized / unknown.
//
// El unwrap del error de las edge functions sigue el patrón de members.ts: supabase-js, en no-2xx,
// devuelve `{ data:null, error: FunctionsHttpError }` y el body real
// (`{ error: { code, message, establishments? } }`) queda en `error.context` (una Response) → hay
// que `await error.context.json()`. Acá ADEMÁS capturamos `establishments` (que members.ts no
// necesitaba) para alimentar la lista de campos bloqueantes de R2.5.1.
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea nada del usuario; la identidad sale del JWT
// (sesión de supabase-js). El edge deriva el user de `requireUser` (su propio JWT).

import { supabase } from './supabase';
import {
  classifyAuthEmailError,
  classifyDeleteNetworkError,
  mapDeleteAccountErrorBody,
  type ChangeEmailResult,
  type DeleteAccountResult,
} from '../utils/account-result';

export type { ChangeEmailResult, DeleteAccountResult, BlockingEstablishment } from '../utils/account-result';

// ─── Cambio de email (R2.1/R2.2) ──────────────────────────────────────────────────

/**
 * Cambia el email del usuario (R2.1/R2.2). Dispara la verificación al email NUEVO; Supabase mantiene
 * el viejo hasta confirmar (nativo). El nuevo email NO queda activo hasta que el usuario confirme
 * desde el mail → el session sigue reportando el email viejo, y el display de "Más" también.
 */
export async function changeEmail(newEmail: string): Promise<ChangeEmailResult> {
  const email = newEmail.trim();
  try {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) return classifyAuthEmailError(error);
    return { ok: true };
  } catch (err) {
    // Fallo de red antes de tener respuesta (offline, DNS).
    return {
      ok: false,
      reason: 'network',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Eliminar cuenta (R2.4/R2.5/R2.5.1) ─────────────────────────────────────────────

/**
 * Mapea el error de la invocación del edge `delete_account` a un DeleteAccountResult tipado. Lee el
 * body de error del FunctionsHttpError (queda en `error.context` como Response) → lo pasa al mapeo
 * puro (`mapDeleteAccountErrorBody`). Sin context con json() → error de red/desconocido.
 */
async function mapDeleteAccountError(error: unknown): Promise<DeleteAccountResult> {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const context = (error as { context?: unknown }).context;

  if (context && typeof (context as Response).json === 'function') {
    try {
      const body = (await (context as Response).json()) as {
        error?: { code?: unknown; message?: unknown; establishments?: unknown };
      };
      return mapDeleteAccountErrorBody(body, rawMessage);
    } catch {
      // Body no parseable como JSON.
      return { ok: false, reason: 'unknown', establishments: [], message: rawMessage };
    }
  }

  // Sin context con json() → error de red/fetch (FunctionsFetchError) o desconocido.
  return classifyDeleteNetworkError(rawMessage);
}

/**
 * Elimina la cuenta del usuario (R2.4). Invoca el edge `delete_account` (POST, body vacío — la
 * identidad sale del JWT, sin IDOR). Devuelve:
 *   - ok + alreadyDeleted=false → baja consumada (el llamador hace signOut local + rutea a auth).
 *   - ok + alreadyDeleted=true  → ya estaba dada de baja (idempotente); igual conviene signOut.
 *   - sole_owner → bloqueada por R2.5; `establishments` = campos bloqueantes (R2.5.1).
 *   - network / unauthorized / unknown → error legible, no se borró nada.
 *
 * R9.2: operación ONLINE. Sin red → reason='network' para que la pantalla muestre copy accionable.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  let data: unknown;
  let error: unknown;
  try {
    const res = await supabase.functions.invoke('delete_account', { body: {} });
    data = res.data;
    error = res.error;
  } catch (err) {
    return {
      ok: false,
      reason: 'network',
      establishments: [],
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (error) {
    return mapDeleteAccountError(error);
  }

  // Éxito (2xx). El body es jsonOk(...) del edge: { ok: true, already_deleted?: true }.
  // Defensa: un 2xx que igual trae { error } (no debería con jsonOk/jsonError).
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const inner = (data as { error?: { message?: unknown } }).error;
    return {
      ok: false,
      reason: 'unknown',
      establishments: [],
      message: typeof inner?.message === 'string' ? inner.message : 'Error de la función.',
    };
  }
  const body = (data ?? {}) as { already_deleted?: unknown };
  return { ok: true, alreadyDeleted: body.already_deleted === true };
}
