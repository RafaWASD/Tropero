// scripts/lib/env-target.mjs — resolución PURA de ambiente (dev/prod) + guarda de PROD para los
// scripts de ambiente de la spec 16 (R5.1/R5.2/R5.3/R5.12/R5.13).
//
// PURA (sin I/O, sin process.exit): testeable bajo node:test. Los scripts imperativos
// (apply-migration-mgmt.mjs, apply-all-migrations.mjs, backup-db.mjs) la importan y traducen el throw
// a un process.exit con mensaje. Mismo espíritu que env-resolve.ts / app-env.ts del cliente.
//
// Reglas (design §4):
//   - sin `--env`            → target 'dev' (default = cero cambio respecto a hoy, R5.1).
//   - `--env prod`           → exige MITROPERO_CONFIRM_PROD=1; si no, throw ProdGuardError (R5.2).
//   - `--env <otro>`         → throw (dominio {dev,prod}).
//   - DESTINO-AWARE (M5/R5.12): si el ref resuelto para 'dev' (default) coincide con un ref CONOCIDO de
//     PROD (`SUPABASE_PROJECT_REF_PROD` o la lista `MITROPERO_KNOWN_PROD_REFS`), se trata como PROD y
//     exige la confirmación IGUAL — así un slot `dev` mal seteado (apuntando a prod) NO bypassea la guarda.
//   - NUNCA expone el token en el mensaje de error (R5.13): ProdGuardError solo lleva el ref (no secreto).
//
// ── EL RENAME DE LAS ENV VARS (rebrand fase 7) ───────────────────────────────────────────────────────
// Las dos env vars de este módulo se renombraron `RAFAQ_*` → `MITROPERO_*`. NO son la misma clase de
// problema y por eso no se tratan igual:
//
//   · `*_CONFIRM_PROD` falla CERRADA (si falta, la guarda bloquea). El riesgo no es de seguridad, es
//     operativo: la tipea Raf a mano y la setea el workflow de backup. Se aceptan LOS DOS nombres y el
//     mensaje de error nombra el NUEVO — una guarda que bloquea a las 3 AM sin decir el nombre nuevo es
//     una trampa.
//
//   · `*_KNOWN_PROD_REFS` falla ABIERTA, y esa es toda la diferencia. Es el refuerzo de la guarda
//     destino-aware. Si el código pasara a leer sólo el nombre nuevo y nadie lo setea, la lista quedaría
//     vacía y la protección se degradaría SIN NINGÚN SÍNTOMA: todo sigue en verde, los scripts siguen
//     andando, y el día que el slot `dev` apunte a PROD la guarda ya no lo ve. Por eso acá NO hay
//     fallback ("el nuevo si está, si no el viejo") sino UNIÓN, y además un guard —
//     `assertKnownProdRefsCoverage`— que convierte la degradación en un bloqueo ruidoso.
//
// La limpieza (sacar los nombres `LEGACY_*`) está anotada en `docs/backlog.md` con su condición.

// ── Nombres de env var (una sola definición; de acá derivan lectura, mensajes y guards) ──────────────

/** Confirmación explícita de destino PROD. Nombre canónico post-rebrand. */
export const CONFIRM_PROD_ENV = 'MITROPERO_CONFIRM_PROD';
/** Nombre PRE-rebrand de la confirmación. Se sigue ACEPTANDO (nunca documentando como el canónico). */
export const LEGACY_CONFIRM_PROD_ENV = 'RAFAQ_CONFIRM_PROD';
/** Todos los nombres que valen como confirmación, en orden de precedencia. */
export const ACCEPTED_CONFIRM_PROD_ENVS = Object.freeze([CONFIRM_PROD_ENV, LEGACY_CONFIRM_PROD_ENV]);

/** Lista (CSV) de refs EXTRA que se tratan como PROD. Nombre canónico post-rebrand. */
export const KNOWN_PROD_REFS_ENV = 'MITROPERO_KNOWN_PROD_REFS';
/** Nombre PRE-rebrand de la lista. Se sigue LEYENDO, y su contenido se UNE al del nombre nuevo. */
export const LEGACY_KNOWN_PROD_REFS_ENV = 'RAFAQ_KNOWN_PROD_REFS';
/** Todos los nombres de lista que el código lee (se unen, no se pisan). */
export const ACCEPTED_KNOWN_PROD_REFS_ENVS = Object.freeze([KNOWN_PROD_REFS_ENV, LEGACY_KNOWN_PROD_REFS_ENV]);

/**
 * Forma de CUALQUIER nombre de variable que declara refs de PROD, presente o futuro.
 *
 * ⚠️ Deliberadamente NO deriva de `ACCEPTED_KNOWN_PROD_REFS_ENVS`: es el ancla independiente que usa
 * `knownProdRefsCoverageGap` para detectar que el ambiente declara una lista que el código NO está
 * leyendo. Si derivara de la misma constante, el guard no podría ver el único bug que existe para ver.
 */
const KNOWN_PROD_REFS_ENV_RE = /(?:^|_)KNOWN_PROD_REFS$/;

/** Error de guarda de PROD: falta la confirmación. Lleva el ref (no secreto) para el mensaje. */
export class ProdGuardError extends Error {
  constructor(ref, requestedEnv, reason) {
    super(
      `Destino PROD (ref ${ref ?? '<sin ref>'}) requiere ${CONFIRM_PROD_ENV}=1 para continuar` +
        (reason === 'destino-aware'
          ? ' (destino-aware: el ref del slot dev coincide con un ref conocido de PROD).'
          : '.'),
    );
    this.name = 'ProdGuardError';
    this.ref = ref;
    this.requestedEnv = requestedEnv;
    this.reason = reason; // 'explicit-prod' | 'destino-aware'
  }
}

/**
 * Error de COBERTURA de la lista de refs de PROD: el ambiente declara refs bajo un nombre de variable
 * que este módulo no lee. Es el guard de la falla ABIERTA — bloquea en vez de degradarse en silencio.
 */
export class KnownProdRefsCoverageError extends Error {
  constructor(gaps) {
    const detalle = gaps
      .map((g) => `${g.name} (refs ignorados: ${g.missing.join(', ')})`)
      .join('; ');
    super(
      `Cobertura de la guarda destino-aware DEGRADADA: el ambiente declara refs de PROD en una variable ` +
        `que este módulo NO lee → ${detalle}. Nombres aceptados hoy: ` +
        `${ACCEPTED_KNOWN_PROD_REFS_ENVS.join(', ')}. Renombrá la variable a ${KNOWN_PROD_REFS_ENV} o ` +
        `agregá su nombre a ACCEPTED_KNOWN_PROD_REFS_ENVS en scripts/lib/env-target.mjs. ` +
        `Se corta a propósito: si siguiéramos, esos refs dejarían de tratarse como PROD SIN ningún síntoma.`,
    );
    this.name = 'KnownProdRefsCoverageError';
    this.gaps = gaps;
  }
}

/**
 * Devuelve el valor de `--env` en argv (soporta `--env prod` y `--env=prod`), o undefined si no está.
 */
export function parseEnvFlag(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--env') return argv[i + 1];
    if (a.startsWith('--env=')) return a.slice('--env='.length);
  }
  return undefined;
}

/**
 * Devuelve los argumentos POSICIONALES de argv, descartando los flags conocidos y sus valores.
 * `withValue`: flags que consumen el siguiente token (`--env prod`). `boolean`: flags sueltos.
 * (Soporta también la forma `--flag=valor`.)
 */
export function positionalArgs(argv, { withValue = ['--env', '--out-dir'], boolean = ['--backfill'] } = {}) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.includes('=') && (withValue.includes(a.split('=')[0]) || boolean.includes(a.split('=')[0]))) continue;
    if (withValue.includes(a)) { i += 1; continue; } // saltear el valor
    if (boolean.includes(a)) continue;
    out.push(a);
  }
  return out;
}

/**
 * ¿Está confirmado el destino PROD, y bajo QUÉ nombre? Devuelve el nombre de la variable que lo
 * confirmó (para poder avisar que el nombre viejo está deprecado), o `null` si ninguna lo hace.
 * Comparación estricta con '1' (fail-closed: cualquier otro valor NO abre la guarda).
 */
export function prodConfirmedVia(env) {
  for (const name of ACCEPTED_CONFIRM_PROD_ENVS) {
    if (env[name] === '1') return name;
  }
  return null;
}

/** `true` si el destino PROD está confirmado bajo CUALQUIERA de los nombres aceptados. */
export function prodConfirmed(env) {
  return prodConfirmedVia(env) !== null;
}

/**
 * Aviso (una línea) si la confirmación llegó por el nombre PRE-rebrand; `null` si llegó por el nuevo o
 * si no hubo confirmación. PURO: lo imprime el script que lo llama (este módulo no hace I/O).
 */
export function legacyConfirmNotice(via) {
  if (via !== LEGACY_CONFIRM_PROD_ENV) return null;
  return (
    `AVISO: confirmaste con ${LEGACY_CONFIRM_PROD_ENV} (nombre PRE-rebrand, sigue funcionando). ` +
    `El nombre nuevo es ${CONFIRM_PROD_ENV} — pasate cuando puedas: el viejo se va a sacar.`
  );
}

/**
 * Set de refs CONOCIDOS de PROD: `SUPABASE_PROJECT_REF_PROD` + la UNIÓN de las listas CSV de
 * `ACCEPTED_KNOWN_PROD_REFS_ENVS`.
 *
 * ⚠️ UNIÓN, no fallback. Con `nuevo ?? viejo`, setear el nuevo APAGARÍA los refs del viejo: en la
 * transición conviven los dos y perder cualquiera de los dos lados es perder cobertura en silencio.
 */
export function knownProdRefs(env) {
  const set = new Set();
  if (env.SUPABASE_PROJECT_REF_PROD && env.SUPABASE_PROJECT_REF_PROD.trim()) {
    set.add(env.SUPABASE_PROJECT_REF_PROD.trim());
  }
  for (const name of ACCEPTED_KNOWN_PROD_REFS_ENVS) {
    const raw = env[name];
    if (typeof raw !== 'string') continue;
    for (const r of raw.split(',')) {
      const t = r.trim();
      if (t) set.add(t);
    }
  }
  return set;
}

/**
 * GUARD DE LA FALLA ABIERTA. Devuelve los "huecos" de cobertura: variables del ambiente que declaran
 * refs de PROD y cuyos refs NO terminaron en el set resuelto por `knownProdRefs()`.
 *
 * El oráculo NO es "la lista quedó vacía" — eso es inalcanzable teniendo `SUPABASE_PROJECT_REF_PROD`
 * seteado (`knownProdRefs` lo mete él mismo), o sea un test que no puede fallar. El oráculo es
 * **el skew**: que el ambiente declare refs bajo un nombre que el código no lee. Barre `env` por FORMA
 * del nombre (`/(?:^|_)KNOWN_PROD_REFS$/`), no por la lista de nombres conocidos, así que cubre las dos
 * direcciones: el rename que deja de leer un nombre vivo, y el operador que setea un nombre inventado.
 *
 * @returns {{name:string, missing:string[]}[]} vacío = cobertura completa.
 */
export function knownProdRefsCoverageGap(env) {
  const resolved = knownProdRefs(env);
  const gaps = [];
  for (const key of Object.keys(env)) {
    if (!KNOWN_PROD_REFS_ENV_RE.test(key.toUpperCase())) continue;
    const raw = env[key];
    if (typeof raw !== 'string') continue;
    const declared = raw.split(',').map((r) => r.trim()).filter(Boolean);
    const missing = declared.filter((r) => !resolved.has(r));
    if (missing.length > 0) gaps.push({ name: key, missing });
  }
  return gaps;
}

/** Igual que `knownProdRefsCoverageGap` pero tira `KnownProdRefsCoverageError` si hay huecos. */
export function assertKnownProdRefsCoverage(env) {
  const gaps = knownProdRefsCoverageGap(env);
  if (gaps.length > 0) throw new KnownProdRefsCoverageError(gaps);
}

/**
 * Resuelve el target de ambiente para un script. PURA (no hace I/O ni process.exit).
 * @returns {{env:'dev'|'prod', ref:string, token:string, host:string, pointsToProd:boolean, confirmedVia:string|null}}
 * @throws {ProdGuardError} si el destino es PROD y falta la confirmación.
 * @throws {KnownProdRefsCoverageError} si el ambiente declara refs de PROD bajo un nombre no leído.
 * @throws {Error} si `--env` es inválido o falta el ref/token del ambiente resuelto.
 */
export function resolveTarget(argv, env) {
  const flag = parseEnvFlag(argv);
  let requested;
  if (flag === undefined) requested = 'dev';
  else if (flag === 'dev' || flag === 'prod') requested = flag;
  else throw new Error(`--env inválido: "${flag}". Valores válidos: dev | prod.`);

  // ANTES de cualquier decisión de destino: si la guarda destino-aware está trabajando con menos refs de
  // los que el ambiente declara, cortamos. Un `--env dev` que procede con cobertura degradada es
  // exactamente el escenario que esta guarda existe para impedir.
  assertKnownProdRefsCoverage(env);

  const devRef = env.SUPABASE_PROJECT_REF && env.SUPABASE_PROJECT_REF.trim();
  const prodRef = env.SUPABASE_PROJECT_REF_PROD && env.SUPABASE_PROJECT_REF_PROD.trim();
  const token = env.SUPABASE_ACCESS_TOKEN && env.SUPABASE_ACCESS_TOKEN.trim();
  const prodRefs = knownProdRefs(env);

  // Destino-aware (M5/R5.12): el slot dev apunta a un ref conocido de PROD.
  const devPointsToProd = requested === 'dev' && !!devRef && prodRefs.has(devRef);
  const requiresConfirm = requested === 'prod' || devPointsToProd;

  // ref del target: prod usa el ref _PROD; dev usa el ref dev (aunque devPointsToProd, el ref ES el de dev).
  const ref = requested === 'prod' ? prodRef : devRef;

  // Guarda ANTES de validar completitud (fail-closed: no revelar más de lo necesario).
  const confirmedVia = prodConfirmedVia(env);
  if (requiresConfirm && confirmedVia === null) {
    throw new ProdGuardError(ref, requested, devPointsToProd ? 'destino-aware' : 'explicit-prod');
  }

  if (!ref) {
    throw new Error(
      `Falta ${requested === 'prod' ? 'SUPABASE_PROJECT_REF_PROD' : 'SUPABASE_PROJECT_REF'} en .env.local`,
    );
  }
  if (!token) throw new Error('Falta SUPABASE_ACCESS_TOKEN en .env.local');

  return {
    env: requested,
    ref,
    token,
    host: `https://api.supabase.com/v1/projects/${ref}`,
    pointsToProd: requested === 'prod' || devPointsToProd,
    // Nombre de la variable que confirmó el destino PROD, o null si la confirmación no hizo falta.
    // Lo consumen los scripts para avisar que el nombre PRE-rebrand está deprecado.
    confirmedVia: requiresConfirm ? confirmedVia : null,
  };
}
