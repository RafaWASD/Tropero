// redact.ts — scrubber PURO de PII para Sentry (feature 17, R7.4 / R7.4.1 / R7.4.2 / R7.4.3).
//
// Defense-in-depth (§3 del design): `beforeSend`/`beforeBreadcrumb` pasan TODO evento/breadcrumb por
// acá ANTES de que salga. Redacta recursivamente DOS grupos de claves sensibles — (a) claves de PII por
// IGUALDAD normalizada y (b) raíces de secreto por INCLUSIÓN (MED-1) —, corta secretos embebidos en valores
// string (Bearer/JWT/token=), y es FAIL-CLOSED: si el walk tira, se DESCARTA el evento (devolvemos null)
// en vez de mandarlo crudo.
//
// PURO: no importa el SDK de Sentry ni RN → unit-testeable bajo node:test (redact.test.ts). Es la guarda
// escrita sobre la AUSENCIA: cubre los ARGUMENTOS que `captureConsole` sube de cualquier `console.error`
// presente o FUTURO, sin depender de auditar call sites. Complementa —no reemplaza— R1.6/R7.1. PostHog NO
// lleva scrubber (whitelist-by-construction: autocapture off + solo props explícitas de nuestros helpers).

// ─── Denylist en DOS grupos (R7.4 / R7.4.1, MED-1) ────────────────────────────────────────────────────
// Claves cuyo VALOR se reemplaza por '[redacted]'. El scrubber es la ÚLTIMA línea: sobre-redactar un campo
// benigno (p.ej. el `name` de una categoría) es aceptable; dejar escapar PII/secretos no. La normalización
// (abajo) colapsa casing/separador. Hay DOS semánticas de match distintas y NO son intercambiables:
//
// (a) CLAVES DE PII → IGUALDAD del nombre normalizado. Set del spec + props de contacto de user_private
//     (spec 14 / delta TELÉFONO) + sinónimos obvios de nombre/teléfono. Va por IGUALDAD **a propósito**: la
//     inclusión redactaría claves estándar de los STACKFRAMES de Sentry (`filename` CONTIENE `name`,
//     `abs_path`/`function`/`module`), destruyendo los stack traces. Un `name` benigno es un falso positivo
//     tolerable; matar el diagnóstico de todo crash no lo es.
const PII_KEYS_RAW = [
  'email',
  'phone',
  'telefono',
  'name',
  'nombre',
  'apellido',
  'member_name',
  'dni',
  'cuit',
  'cuil',
  'opData',
  // props de contacto de user_private + sinónimos (defensa amplia).
  'whatsapp',
  'celular',
  'mobile',
  'contact',
  'contact_phone',
  'contact_name',
  'first_name',
  'last_name',
  'full_name',
  'given_name',
  'family_name',
  // MEDIUM-2 del Gate 2 del delta `ios-ble-mfi`: identificador de dispositivo Bluetooth. En Android
  // `device.id` de `react-native-ble-plx` es la MAC; en MFi es el serial del accesorio. No es PII de
  // persona, pero es un identificador de hardware —propio o de un tercero— que no tiene por qué salir a
  // un vendor de telemetría. `normalizeKey` lo colapsa, así que esta entrada cubre `deviceId`,
  // `device_id` y `deviceid` (el `connect_superseded { deviceId }` de los tres adapters).
  //
  // ⚠️ Esto es la SEGUNDA línea, no la primera: un scrubber por CLAVES no puede tocar un identificador
  // interpolado dentro de un `message`. Por eso el arreglo de fondo fue sacarlo del free-text del log
  // (`ble_device_not_recognized` pasó a llevar un ordinal, ble/logging.ts).
  'device_id',
] as const;

// (b) RAÍCES DE SECRETO → INCLUSIÓN (la clave se redacta si su nombre normalizado CONTIENE la raíz). Un
//     secreto nunca es benigno, así que la inclusión es segura y necesaria: cubre `refresh_token` /
//     `access_token` / `session_token` de la sesión de Supabase, que la igualdad exacta perdía (MED-1) — y
//     el `refresh_token` es un valor OPACO (`v1.M…`) que ni la defensa de valores string atrapa. `api_key`
//     normaliza a `apikey`; `authorization` contiene `auth` (redundante pero explícito).
const SECRET_ROOTS_RAW = [
  'token',
  'secret',
  'session',
  'password',
  'pwd',
  'api_key',
  'authorization',
  'auth',
  'credential',
  'cookie',
  'jwt',
] as const;

/**
 * Normaliza el nombre de una clave (R7.4.1, M3): minúsculas + descartar `_`/`-`/espacios. Así
 * `member_name`, `memberName` y `MemberName` colapsan a `membername`, y `refresh_token`/`api_key` colapsan
 * a `refreshtoken`/`apikey` — ninguna variante de casing/separador se escapa del match.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, '');
}

const PII_KEYS_NORMALIZED: ReadonlySet<string> = new Set(PII_KEYS_RAW.map(normalizeKey));
const SECRET_ROOTS_NORMALIZED: readonly string[] = SECRET_ROOTS_RAW.map(normalizeKey);

function isDeniedKey(key: string): boolean {
  const norm = normalizeKey(key);
  // (a) PII: IGUALDAD exacta del normalizado. NUNCA inclusión (rompería `filename`→`name` = stack traces).
  if (PII_KEYS_NORMALIZED.has(norm)) return true;
  // (b) secretos: INCLUSIÓN — atrapa refresh_token/access_token/session_token (opacos que la igualdad perdía).
  return SECRET_ROOTS_NORMALIZED.some((root) => norm.includes(root));
}

// ─── Defensa liviana sobre valores string (R7.4.3, M1) ────────────────────────────────────────────────
// Reemplaza secretos EMBEBIDOS en un valor string (JWT `eyJ…`, `Bearer …`, `token=…`). Best-effort con
// regex simple, NO un parser: complementa el match key-based (que por sí solo no atrapa un secreto dentro
// de un valor, p.ej. una URL de un auto-breadcrumb HTTP). Limitación conocida y atenuada (el JWT de la
// sesión viaja por header, no en URL; tracesSampleRate:0 → sin auto-breadcrumbs de red) — design §3.
const REDACTED = '[redacted]';
const STRING_SECRET_PATTERNS: readonly RegExp[] = [
  // JWT: header.payload(.signature) base64url arrancando en `eyJ`.
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g,
  // Bearer <token>.
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  // token=<valor> (querystring / kv).
  /token=[A-Za-z0-9._~+/=-]+/gi,
];

function scrubString(value: string): string {
  let out = value;
  for (const re of STRING_SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

// ─── Walk recursivo (copia, no muta; corte de profundidad; ciclos vía WeakSet) ────────────────────────
const MAX_DEPTH = 16;

/**
 * Devuelve una COPIA redactada de `value`. No muta el original. Corta a MAX_DEPTH (evita estructuras
 * patológicas) y maneja ciclos con un WeakSet de visitados en el camino actual (add antes de recursar,
 * delete al volver: un DAG no se marca como ciclo, solo un ciclo real). Cualquier throw (getter que tira,
 * proxy hostil) PROPAGA hacia redactEvent/redactBreadcrumb, que lo convierten en el fail-closed (null).
 */
function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') {
    // number / boolean / undefined / bigint / symbol → tal cual. function → se descarta (no debería
    // aparecer en un evento de Sentry; devolver la función la filtraría al JSON).
    return typeof value === 'function' ? undefined : value;
  }
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value instanceof Date) return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const arr = value.map((el) => redactValue(el, depth + 1, seen));
      return arr;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (isDeniedKey(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactValue((value as Record<string, unknown>)[key], depth + 1, seen);
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Redacta un EVENTO de Sentry (R7.4). FAIL-CLOSED (R7.4.2, M2): si el walk tira, devolvemos `null` →
 * Sentry DESCARTA el evento (el fail-safe es "no enviar", NUNCA "enviar crudo"). Best-effort: no propaga.
 */
export function redactEvent<T>(event: T): T | null {
  try {
    return redactValue(event, 0, new WeakSet<object>()) as T;
  } catch {
    return null;
  }
}

/**
 * Redacta un BREADCRUMB de Sentry (R7.4). FAIL-CLOSED igual que redactEvent: throw → `null` → Sentry
 * descarta el breadcrumb.
 */
export function redactBreadcrumb<T>(breadcrumb: T): T | null {
  try {
    return redactValue(breadcrumb, 0, new WeakSet<object>()) as T;
  } catch {
    return null;
  }
}

// Exportados SOLO para el test de falsificación (no se consumen en runtime fuera de este módulo).
export const __test = {
  normalizeKey,
  isDeniedKey,
  scrubString,
  PII_KEYS_NORMALIZED,
  SECRET_ROOTS_NORMALIZED,
  MAX_DEPTH,
};
