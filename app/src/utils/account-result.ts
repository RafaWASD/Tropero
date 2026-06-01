// Lógica PURA de mapeo de resultados de la cuenta (spec 01, Fase 6 — T6.1 / T6.3).
//
// Separada de services/account.ts (que importa supabase/RN, no testeable bajo node nativo) para
// que el mapeo de errores sea testeable con node:test, sin red ni RN. Patrón del repo: la lógica
// pura vive en utils/ y los servicios solo hacen el I/O de plataforma.
//
// Cubre:
//   - classifyAuthEmailError: AuthError de updateUser({email}) → motivo accionable (R2.1/R2.2).
//   - parseBlockingEstablishments / mapDeleteAccountErrorBody: body de error del edge
//     `delete_account` → DeleteAccountResult tipado, incl. la lista de campos bloqueantes (R2.5.1).

// ─── Cambio de email (R2.1/R2.2) ──────────────────────────────────────────────────

export type ChangeEmailResult =
  | { ok: true }
  | {
      ok: false;
      /** 'email_taken' = ya en uso; 'invalid' = formato; 'network' = sin red; 'unknown' = otro. */
      reason: 'email_taken' | 'invalid' | 'network' | 'unknown';
      message: string;
    };

/**
 * Clasifica el AuthError de `updateUser({ email })` en un motivo accionable. Supabase no expone
 * códigos súper estables acá; nos guiamos por mensaje/code. El copy fino lo arma la pantalla;
 * este reason elige la rama.
 */
export function classifyAuthEmailError(error: {
  message?: string | null;
  code?: string | null;
  status?: number | null;
}): ChangeEmailResult {
  const msg = (error.message ?? '').toLowerCase();
  const code = (error.code ?? '').toLowerCase();
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { ok: false, reason: 'network', message: error.message ?? 'Sin conexión.' };
  }
  // Email ya registrado por otra cuenta: "already registered" / code email_exists / 422.
  if (code.includes('email_exists') || /already.*(registered|in use|exists)/i.test(msg)) {
    return { ok: false, reason: 'email_taken', message: error.message ?? 'Email en uso.' };
  }
  if (code.includes('validation') || /invalid.*email|email.*invalid/i.test(msg)) {
    return { ok: false, reason: 'invalid', message: error.message ?? 'Email inválido.' };
  }
  return { ok: false, reason: 'unknown', message: error.message ?? 'Error desconocido.' };
}

// ─── Eliminar cuenta (R2.4/R2.5/R2.5.1) ─────────────────────────────────────────────

/** Un establecimiento bloqueante (R2.5.1): el usuario es su único owner activo. */
export type BlockingEstablishment = { id: string; name: string };

export type DeleteAccountResult =
  | { ok: true; alreadyDeleted: boolean }
  | {
      ok: false;
      /** 'sole_owner' = bloqueado por R2.5; 'network'; 'unauthorized' = sin sesión; 'unknown'. */
      reason: 'sole_owner' | 'network' | 'unauthorized' | 'unknown';
      /** Lista de campos bloqueantes (R2.5.1). Solo no-vacía en reason='sole_owner'. */
      establishments: BlockingEstablishment[];
      message: string;
    };

/** Parsea la lista `establishments` del body de error del edge (defensivo ante shapes raros). */
export function parseBlockingEstablishments(raw: unknown): BlockingEstablishment[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockingEstablishment[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const id = (item as { id?: unknown }).id;
      const name = (item as { name?: unknown }).name;
      if (typeof id === 'string') {
        out.push({ id, name: typeof name === 'string' ? name : '' });
      }
    }
  }
  return out;
}

/**
 * Mapea el `{ error: { code, message, establishments? } }` del body de error del edge
 * `delete_account` a un DeleteAccountResult tipado. `rawMessage` es el fallback (mensaje del
 * FunctionsHttpError) cuando el body no trae message. Lógica pura: el servicio se encarga de leer
 * el Response (`await context.json()`) y de pasar el objeto ya parseado acá.
 */
export function mapDeleteAccountErrorBody(
  body: { error?: { code?: unknown; message?: unknown; establishments?: unknown } } | null | undefined,
  rawMessage: string,
): DeleteAccountResult {
  const code = typeof body?.error?.code === 'string' ? body.error.code : null;
  const message = typeof body?.error?.message === 'string' ? body.error.message : rawMessage;
  if (code === 'sole_owner') {
    return {
      ok: false,
      reason: 'sole_owner',
      establishments: parseBlockingEstablishments(body?.error?.establishments),
      message,
    };
  }
  if (code === 'unauthorized') {
    return { ok: false, reason: 'unauthorized', establishments: [], message };
  }
  // db_error / unexpected / method_not_allowed / desconocido → genérico (no accionable por campo).
  return { ok: false, reason: 'unknown', establishments: [], message };
}

/** Clasifica un mensaje crudo (sin body JSON) como error de red o desconocido. */
export function classifyDeleteNetworkError(rawMessage: string): DeleteAccountResult {
  if (/network|failed to fetch|fetch failed/i.test(rawMessage)) {
    return { ok: false, reason: 'network', establishments: [], message: rawMessage };
  }
  return { ok: false, reason: 'unknown', establishments: [], message: rawMessage };
}
