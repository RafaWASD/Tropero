// scripts/lib/env-target.mjs — resolución PURA de ambiente (dev/prod) + guarda de PROD para los
// scripts de ambiente de la spec 16 (R5.1/R5.2/R5.3/R5.12/R5.13).
//
// PURA (sin I/O, sin process.exit): testeable bajo node:test. Los scripts imperativos
// (apply-migration-mgmt.mjs, apply-all-migrations.mjs, backup-db.mjs) la importan y traducen el throw
// a un process.exit con mensaje. Mismo espíritu que env-resolve.ts / app-env.ts del cliente.
//
// Reglas (design §4):
//   - sin `--env`            → target 'dev' (default = cero cambio respecto a hoy, R5.1).
//   - `--env prod`           → exige RAFAQ_CONFIRM_PROD=1; si no, throw ProdGuardError (R5.2).
//   - `--env <otro>`         → throw (dominio {dev,prod}).
//   - DESTINO-AWARE (M5/R5.12): si el ref resuelto para 'dev' (default) coincide con un ref CONOCIDO de
//     PROD (`SUPABASE_PROJECT_REF_PROD` o la lista `RAFAQ_KNOWN_PROD_REFS`), se trata como PROD y exige
//     RAFAQ_CONFIRM_PROD=1 IGUAL — así un slot `dev` mal seteado (apuntando a prod) NO bypassea la guarda.
//   - NUNCA expone el token en el mensaje de error (R5.13): ProdGuardError solo lleva el ref (no secreto).

/** Error de guarda de PROD: falta RAFAQ_CONFIRM_PROD=1. Lleva el ref (no secreto) para el mensaje. */
export class ProdGuardError extends Error {
  constructor(ref, requestedEnv, reason) {
    super(
      `Destino PROD (ref ${ref ?? '<sin ref>'}) requiere RAFAQ_CONFIRM_PROD=1 para continuar` +
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

/** Set de refs CONOCIDOS de PROD: `SUPABASE_PROJECT_REF_PROD` + lista opcional `RAFAQ_KNOWN_PROD_REFS`. */
export function knownProdRefs(env) {
  const set = new Set();
  if (env.SUPABASE_PROJECT_REF_PROD && env.SUPABASE_PROJECT_REF_PROD.trim()) {
    set.add(env.SUPABASE_PROJECT_REF_PROD.trim());
  }
  if (env.RAFAQ_KNOWN_PROD_REFS) {
    for (const r of env.RAFAQ_KNOWN_PROD_REFS.split(',')) {
      const t = r.trim();
      if (t) set.add(t);
    }
  }
  return set;
}

/**
 * Resuelve el target de ambiente para un script. PURA (no hace I/O ni process.exit).
 * @returns {{env:'dev'|'prod', ref:string, token:string, host:string, pointsToProd:boolean}}
 * @throws {ProdGuardError} si el destino es PROD y falta RAFAQ_CONFIRM_PROD=1.
 * @throws {Error} si `--env` es inválido o falta el ref/token del ambiente resuelto.
 */
export function resolveTarget(argv, env) {
  const flag = parseEnvFlag(argv);
  let requested;
  if (flag === undefined) requested = 'dev';
  else if (flag === 'dev' || flag === 'prod') requested = flag;
  else throw new Error(`--env inválido: "${flag}". Valores válidos: dev | prod.`);

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
  if (requiresConfirm && env.RAFAQ_CONFIRM_PROD !== '1') {
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
  };
}
