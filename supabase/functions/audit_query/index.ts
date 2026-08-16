// audit_query — EF del visor forense interno (spec 24). ÚNICA puerta de lectura de audit.record_version:
// el cliente jamás toca la tabla (muro fail-closed de spec 18 intacto, R4.1–R4.3).
//
// Pipeline (design §0):
//   1. método POST                                              → si no, 405 method_not_allowed  (R1.2)
//   2. requireUser(JWT del header Authorization) → user.id      → si no, 401 unauthorized         (R1.3)
//   3. gate de staff: user.id ∈ allowlist del secret            → si no, 403 not_staff             (R1.5)
//      (secret ausente/vacío ⇒ allowlist vacía ⇒ nadie es staff → 403, fail-closed, R1.7)
//   4. rate limit in-memory por user.id                         → si excede, 429 rate_limited     (R3.5)
//   5. validateFilters(body) autoritativo                       → si inválido, 400 invalid_filter  (R2.x)
//   6. lectura por conexión DIRECTA a Postgres (db.ts)          → SQL parametrizado                (R4.1)
//   7. resuelve actor {name,email} + table_label + id string    → { rows, next_cursor }            (R5.x)
//
// No-leak (R7.1–R7.3): `serveEf` no loguea body/JWT; este handler NUNCA loguea record/old_record ni el
// email del actor; los 5xx salen por `serverError` (copy genérico, sin el message del driver de Postgres).
// PII (record/old_record + email) se expone SOLO a staff gateado — aceptable y documentado (R7.4).

import { serveEf } from '../_shared/serve.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
import { createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireUser } from '../_shared/auth.ts';
import { parseStaffAllowlist, TABLE_LABELS, validateFilters } from './query.ts';
import { queryAudit } from './db.ts';

// ── Rate limit in-memory por user.id (R3.5) ──────────────────────────────────────────────────────────
// Fixed-window best-effort, POR INSTANCIA de EF (efímera/multi-instancia → el contador no es global). Es
// suficiente para una tool interna de 2 personas: corta scraping/loops accidentales; el atacante externo
// ya está afuera por el gate de staff. Ver design §2.5 / §6.3 (alternativa DB-backed descartada).
const RATE_LIMIT_MAX = 60; // requests
const RATE_WINDOW_MS = 60_000; // por ventana de 60 s
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

serveEf('audit_query', async (req) => {
  // 1. Método (R1.2).
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Solo POST.');
  }

  try {
    // 2. Auth (R1.3): user del JWT validado por Supabase (requireUser tira HttpError 401 si no hay sesión).
    const userClient = createUserClient(req);
    const user = await requireUser(userClient);

    // 3. Gate de staff (R1.4–R1.7): allowlist SERVER-SIDE desde el secret. Fail-closed: size 0 (secret
    //    ausente/vacío/basura) ⇒ nadie es staff ⇒ 403. La pertenencia sale SOLO del user.id del JWT, nunca
    //    del body ni de headers (R1.6).
    const staff = parseStaffAllowlist(Deno.env.get('MITROPERO_STAFF_USER_IDS'));
    if (staff.size === 0 || !staff.has(user.id.toLowerCase())) {
      return jsonError(403, 'not_staff', 'No tenés acceso a esta herramienta.');
    }

    // 4. Rate limit por user.id de staff (R3.5).
    if (isRateLimited(user.id)) {
      return jsonError(429, 'rate_limited', 'Demasiadas consultas, probá en un momento.');
    }

    // 5. Validación autoritativa de filtros (R2.x). El body va en el POST (nunca en la URL, R2.1).
    const body = await req.json().catch(() => ({}));
    const parsed = validateFilters(body);
    if (!parsed.ok) {
      return jsonError(400, 'invalid_filter', parsed.error);
    }
    const filtros = parsed.filtros;

    // 6. Lectura por conexión directa (R4.1). Los errores del driver NO se propagan al cliente: copy
    //    genérico (R7.2). El detalle va a los logs server-side vía serverError.
    let result;
    try {
      result = await queryAudit(filtros);
    } catch (dbErr) {
      return serverError('db_error', dbErr);
    }

    // 7. Armado de la respuesta. limit+1 para el cursor (§6.6): si vino la fila extra, hay más páginas.
    const hasMore = result.rows.length > filtros.limit;
    const page = hasMore ? result.rows.slice(0, filtros.limit) : result.rows;

    const actorById = new Map(result.actors.map((a) => [String(a.id), a]));

    const rows = page.map((r) => {
      const authUid = r.auth_uid ? String(r.auth_uid) : null;
      // Actor null si el auth_uid es null o no existe en public.users (usuario borrado; sin FK, R5.2).
      const match = authUid ? actorById.get(authUid) : undefined;
      const tableName = r.table_name != null ? String(r.table_name) : null;
      return {
        id: String(r.id), // bigint como string (R3.6)
        record_id: r.record_id ?? null,
        op: r.op,
        ts: r.ts == null ? null : new Date(r.ts).toISOString(),
        auth_uid: authUid,
        actor: match
          ? { id: String(match.id), name: match.name ?? null, email: match.email ?? null }
          : null,
        request_id: r.request_id ?? null,
        table_name: tableName,
        // Label es-AR; fallback al table_name crudo si la tabla no está mapeada (R5.3).
        table_label:
          tableName != null ? (TABLE_LABELS[tableName] ?? tableName) : null,
        record: r.record ?? null,
        old_record: r.old_record ?? null,
      };
    });

    const nextCursor = hasMore ? String(page[page.length - 1].id) : null;

    return jsonOk({ rows, next_cursor: nextCursor });
  } catch (err) {
    // requireUser → HttpError (401). Cualquier otra cosa → 5xx genérico (sin message del driver, R7.2).
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    return serverError('unexpected', err);
  }
});
