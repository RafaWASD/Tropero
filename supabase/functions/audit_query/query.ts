// query.ts — helpers PUROS de la EF `audit_query` (spec 24). Sin dependencias Deno-only (solo globals
// de JS: Date, RegExp, Set, Map, JSON) → node:test los importa y ejerce las MISMAS funciones que corren
// en producción (mismo patrón que `_shared/serve-log.ts` de spec 23), no un espejo a mano.
//
// Responsabilidad: parsear la allowlist de staff (fail-closed) y VALIDAR AUTORITATIVAMENTE todos los
// filtros del body ANTES de que lleguen a la query (US2 / R2.2–R2.9). El armado del SQL NO vive acá: se
// hace 100% con tagged-templates de Postgres.js en `db.ts` (placeholders ligados, sin concatenar input).
// Este módulo devuelve un objeto `Filtros` de escalares YA validados — la única cosa que `db.ts` liga como
// parámetros. Un valor malformado JAMÁS produce un `Filtros`: se corta acá con `{ ok:false, error }`.

// Misma regex de uuid que usan `serveEf` / `audit.resolve_actor` / `resolve_request_id` (anti-spoof por
// forma antes del cast a `::uuid`).
export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Allowlist de tablas trackeadas HOY (spec 18 incremento 1). `animals` va gateada por el gate de volumen
// (T12 de spec 18): cuando se prenda, se agrega acá (1 línea) + su label. La allowlist evita "sondear"
// otras tablas por el filtro `table_name` (R2.6).
export const TABLE_ALLOWLIST = new Set<string>(['user_roles']);

// Operaciones válidas del enum `audit.operation` que exponemos por filtro (R2.7). TRUNCATE existe en el
// enum pero el trigger de audit no lo emite en las tablas trackeadas → no se ofrece como filtro.
export const OP_ALLOWLIST = new Set<string>(['INSERT', 'UPDATE', 'DELETE']);

// Labels es-AR por tabla (R5.3). Fallback: el `table_name` crudo si no está mapeado.
export const TABLE_LABELS: Record<string, string> = {
  user_roles: 'Roles de miembro',
};

// Cap duro del `limit` (R3.2): default 50, máximo 100. No-entero / ≤0 / no-parseable → default.
const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 100;

export function clampLimit(raw: unknown): number {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) {
    n = parseInt(raw.trim(), 10);
  } else {
    return LIMIT_DEFAULT;
  }
  if (!Number.isInteger(n) || n <= 0) return LIMIT_DEFAULT;
  return Math.min(n, LIMIT_MAX);
}

// Parsea la allowlist de staff desde el EF secret `MITROPERO_STAFF_USER_IDS` (R1.4). FAIL-CLOSED (R1.7):
// - secret ausente / vacío  → Set vacío (nadie es staff).
// - tokens que NO tienen forma de uuid → se descartan (basura no ensancha la allowlist).
// Los uuids se normalizan a lowercase para comparar contra `user.id.toLowerCase()`.
export function parseStaffAllowlist(secret: string | undefined | null): Set<string> {
  if (typeof secret !== 'string' || secret.trim() === '') return new Set();
  return new Set(
    secret
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => UUID_RE.test(s)),
  );
}

// Filtros ya validados: exactamente los escalares que `db.ts` liga como parámetros. Un filtro ausente
// queda en `null` (no se filtra por él, R2.8). `limit` siempre presente (capeado).
export type Filtros = {
  from: string | null; // ISO canónico (timestamptz)
  to: string | null;
  auth_uid: string | null; // uuid lowercase
  establishment_id: string | null; // uuid lowercase
  request_id: string | null; // uuid lowercase
  table_name: string | null; // de TABLE_ALLOWLIST
  op: string | null; // de OP_ALLOWLIST
  before: string | null; // cursor: id (bigint) como string de dígitos
  limit: number; // 1..100
};

export type ValidateResult =
  | { ok: true; filtros: Filtros }
  | { ok: false; error: string };

// Un valor "en blanco" (ausente / null / string vacío-o-espacios) = filtro NO presente → se ignora
// (R2.8). Cualquier valor NO-blanco pero malformado → error 400 (no se convierte silenciosamente en
// "sin filtro").
function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

// Validación AUTORITATIVA del body (R2.2–R2.9). Devuelve `{ ok, filtros }` con escalares validados, o
// `{ ok:false, error }` (el handler responde 400 `invalid_filter`). Ignora claves desconocidas del body:
// solo lee los campos previstos → un campo extra jamás llega a la query.
export function validateFilters(body: unknown): ValidateResult {
  const b: Record<string, unknown> =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  const out: Filtros = {
    from: null,
    to: null,
    auth_uid: null,
    establishment_id: null,
    request_id: null,
    table_name: null,
    op: null,
    before: null,
    limit: clampLimit(b.limit),
  };

  // uuids: regex ANTES del cast a `::uuid` (R2.3–R2.5). Cualquier no-uuid no-blanco → 400.
  const uuidFields = ['auth_uid', 'establishment_id', 'request_id'] as const;
  for (const f of uuidFields) {
    const v = b[f];
    if (isBlank(v)) continue;
    if (typeof v !== 'string' || !UUID_RE.test(v.trim())) {
      return { ok: false, error: `Filtro ${f} inválido (se esperaba UUID).` };
    }
    out[f] = v.trim().toLowerCase();
  }

  // from / to: [§8 LOW-2] guard `typeof === 'string'` ANTES del `new Date`; fecha no parseable → 400 (R2.2).
  const dateFields = ['from', 'to'] as const;
  for (const f of dateFields) {
    const v = b[f];
    if (isBlank(v)) continue;
    if (typeof v !== 'string') {
      return { ok: false, error: `Filtro ${f} inválido (se esperaba fecha ISO).` };
    }
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: `Filtro ${f} inválido (fecha no parseable).` };
    }
    out[f] = d.toISOString();
  }

  // table_name: solo de la allowlist (R2.6).
  if (!isBlank(b.table_name)) {
    const t = b.table_name;
    if (typeof t !== 'string' || !TABLE_ALLOWLIST.has(t)) {
      return { ok: false, error: 'Filtro table_name fuera de la allowlist.' };
    }
    out.table_name = t;
  }

  // op: solo INSERT|UPDATE|DELETE (R2.7), case-sensitive (el enum es mayúsculas).
  if (!isBlank(b.op)) {
    const o = b.op;
    if (typeof o !== 'string' || !OP_ALLOWLIST.has(o)) {
      return { ok: false, error: 'Filtro op inválido (INSERT|UPDATE|DELETE).' };
    }
    out.op = o;
  }

  // before (cursor): id `bigint` → string de dígitos (R3.3). Se acepta SOLO string (un number JSON puede
  // perder precisión sobre 2^53); no-dígitos → 400.
  if (!isBlank(b.before)) {
    const raw = typeof b.before === 'string' ? b.before.trim() : b.before;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
      return { ok: false, error: 'Cursor before inválido.' };
    }
    out.before = raw;
  }

  return { ok: true, filtros: out };
}
