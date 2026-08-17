// audit_query — EF del visor forense interno (spec 24). ÚNICA puerta de lectura de audit.record_version:
// el cliente jamás toca la tabla (muro fail-closed de spec 18 intacto, R4.1–R4.3).
//
// Delta cloudflare-access: el gate de auth ya NO es Supabase Auth. La EF se despliega con verify_jwt=false
// (config.toml) → queda directamente expuesta a internet y es el ÚNICO gate. Ese gate son DOS muros:
//   (M-1) un secreto compartido Function↔EF (`X-Mitropero-Proxy-Secret`), chequeado ANTES del JWT en tiempo
//         constante; y (2) el JWT de Cloudflare Access verificado criptográficamente (aud EXACTO + RS256).
//
// Pipeline (design §3.3 + §6-bis):
//   1. método POST                                              → si no, 405 method_not_allowed  (R1.2)
//   2. [M-1] secreto proxy en tiempo constante, ANTES del JWT  → si falta/no coincide, 401         (§6-bis)
//      (env `MITROPERO_AUDIT_PROXY_SECRET` ausente/vacío ⇒ nadie pasa, fail-closed)
//   3. verifyAccessJwt(Cf-Access-Jwt-Assertion) → email        → si no verifica, 401 unauthorized  (RCFA.2.x)
//   4. [opcional] email ∈ CF_ACCESS_EMAIL_ALLOWLIST            → si no, 403 not_staff              (RCFA.2.13)
//   5. rate limit in-memory por email verificado               → si excede, 429 rate_limited       (RCFA.2.14)
//   6. validateFilters(body) autoritativo                      → si inválido, 400 invalid_filter   (R2.x)
//   7. lectura por conexión DIRECTA a Postgres (db.ts)         → SQL parametrizado                 (R4.1)
//   8. resuelve actor {name,email} + table_label + id string   → { rows, next_cursor }             (R5.x)
//
// No-leak (R7.1–R7.3): `serveEf` no loguea body/JWT ni el `Cf-Access-Jwt-Assertion`; este handler NUNCA
// loguea record/old_record ni el email del actor; los 5xx salen por `serverError` (copy genérico, sin el
// message del driver de Postgres). PII (record/old_record + email) se expone SOLO a staff gateado (R7.4).

import { serveEf } from '../_shared/serve.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
import { HttpError } from '../_shared/auth.ts';
import { TABLE_LABELS, validateFilters } from './query.ts';
import { verifyAccessJwt } from './access.ts';
import { parseEmailAllowlist, proxySecretMatches } from './access-helpers.ts';
import { queryAudit } from './db.ts';

// ── Rate limit in-memory por email verificado (R3.5, re-key RCFA.2.14) ────────────────────────────────
// Fixed-window best-effort, POR INSTANCIA de EF (efímera/multi-instancia → el contador no es global). Es
// suficiente para una tool interna de 2 personas: corta scraping/loops accidentales; el atacante externo
// ya está afuera por el proxy secret + el JWT de Access. Ver design §2.5 / §6.3 (alternativa DB-backed
// descartada). La key pasó de `user.id` a `email` (el `email` es estable por persona, lo emite Access).
const RATE_LIMIT_MAX = 60; // requests
const RATE_WINDOW_MS = 60_000; // por ventana de 60 s
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
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
    // 2. [M-1] Secreto compartido Function↔EF, ANTES del JWT (design §6-bis). Con verify_jwt=false la EF
    //    queda expuesta directo a internet: este secreto (a) evita que un caller directo llegue al gate del
    //    JWT si éste tuviera un bug futuro (belt-and-suspenders), y (b) corta el flood no-autenticado ANTES
    //    de gastar la verificación RS256 + el rate-limit (Denial-of-Wallet). Comparación en TIEMPO CONSTANTE
    //    (no `===` naíve). Fail-closed: env ausente/vacío ⇒ NADIE pasa (`proxySecretMatches` → false).
    if (
      !proxySecretMatches(
        req.headers.get('X-Mitropero-Proxy-Secret'),
        Deno.env.get('MITROPERO_AUDIT_PROXY_SECRET'),
      )
    ) {
      return jsonError(401, 'unauthorized', 'Sin acceso.');
    }

    // 3. Auth (RCFA.2.2): el JWT de Access viene EXCLUSIVAMENTE en `Cf-Access-Jwt-Assertion` (Access lo
    //    inyecta server-side). Ausente/vacío → 401 sin leer nada.
    const assertion = req.headers.get('Cf-Access-Jwt-Assertion');
    if (!assertion) {
      return jsonError(401, 'unauthorized', 'Sin acceso.');
    }
    // verifyAccessJwt tira HttpError(401) si la firma/aud/iss/exp no verifican, si faltan los secrets
    // CF_ACCESS_*, o si no viene el email (RCFA.2.3–RCFA.2.11). El `email` sale del PAYLOAD verificado
    // criptográficamente, NUNCA de un header de identidad crudo (RCFA.2.9). El catch de abajo mapea el 401.
    const { email } = await verifyAccessJwt(assertion);

    // 4. [opcional] Defensa en profundidad por email allowlist (RCFA.2.13). Secret ausente ⇒ null ⇒ NO
    //    filtra (Access es la autoridad; no es fail-open porque el gate del `aud` ya corrió). Poblado y el
    //    email no pertenece ⇒ 403.
    const emailAllow = parseEmailAllowlist(Deno.env.get('CF_ACCESS_EMAIL_ALLOWLIST'));
    if (emailAllow !== null && !emailAllow.has(email)) {
      return jsonError(403, 'not_staff', 'Sin acceso.');
    }

    // 5. Rate limit keyeado por el email verificado (RCFA.2.14; cap/ventana de R3.5 sin cambios).
    if (isRateLimited(email)) {
      return jsonError(429, 'rate_limited', 'Demasiadas consultas, probá en un momento.');
    }

    // 6. Validación autoritativa de filtros (R2.x). El body va en el POST (nunca en la URL, R2.1).
    const body = await req.json().catch(() => ({}));
    const parsed = validateFilters(body);
    if (!parsed.ok) {
      return jsonError(400, 'invalid_filter', parsed.error);
    }
    const filtros = parsed.filtros;

    // 7. Lectura por conexión directa (R4.1). Los errores del driver NO se propagan al cliente: copy
    //    genérico (R7.2). El detalle va a los logs server-side vía serverError.
    let result;
    try {
      result = await queryAudit(filtros);
    } catch (dbErr) {
      return serverError('db_error', dbErr);
    }

    // 8. Armado de la respuesta. limit+1 para el cursor (§6.6): si vino la fila extra, hay más páginas.
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
    // verifyAccessJwt → HttpError (401). Cualquier otra cosa → 5xx genérico (sin message del driver, R7.2).
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    return serverError('unexpected', err);
  }
});
