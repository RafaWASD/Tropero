// scripts/lib/backup-cmd.mjs — lógica PURA del armado del comando de backup de backup-db.mjs
// (spec 16 Run B, B4 / R5.7/R5.8/R5.10/R5.11). Sin I/O: no toca fs ni spawnea; solo arma el plan.
//
// Seguridad (Gate 1):
//   - L2/R5.11: la conn string va a pg_dump por VARIABLE DE ENTORNO (libpq: PGHOST/PGPORT/PGUSER/
//     PGPASSWORD/PGDATABASE), NUNCA como argumento de línea de comando (visible en `ps`). Por eso
//     `pgDumpArgs` no contiene ni la conn string ni la password.
//   - H1/R5.10: el output default vive FUERA del working tree (`~/.mitropero-backups/`).
//   - R5.8: sin conn string → throw (el script aborta ANTES de crear cualquier archivo).
//   - R5.13: `safeSummary` NUNCA incluye la password ni la conn string cruda.

import path from 'node:path';

/** Parsea la conn string del pooler a variables libpq (para pasarla a pg_dump por env, no por argv). */
export function parseConnString(uri) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    throw new Error('SUPABASE_DB_URL_PROD no es una URI válida (esperado postgres://user:pass@host:port/db).');
  }

  // VALIDAR EL RESULTADO, no solo que haya parseado. Este guard existía y era CIEGO: solo miraba si
  // `new URL` tiraba. Una password con `#` o `@` SIN percent-encodear produce una URI perfectamente
  // parseable y silenciosamente equivocada, y el error recién aparece como un DNS raro dentro de
  // pg_dump. Pasó de verdad (2026-08-09): con la password `5YV@...#...`, el `#` cortó la URI en
  // fragmento y el host quedó siendo el pedazo de password entre los dos caracteres especiales —
  // que además se logueó en claro, porque `safeSummary` imprime el host confiando en que es un host.
  if (u.hash || u.search) {
    throw new Error(
      'SUPABASE_DB_URL_PROD tiene un `#` o un `?` sin escapar: cortan la URI y el host queda mal. ' +
        'Si están en la password, percent-encodealos (# → %23, ? → %3F, @ → %40, / → %2F) o usá una ' +
        'password alfanumérica.',
    );
  }
  const host = decodeURIComponent(u.hostname);
  if (!host.includes('.') && host !== 'localhost') {
    throw new Error(
      `SUPABASE_DB_URL_PROD apunta al host "${host}", que no parece un host real. Causa típica: la ` +
        'password tiene caracteres especiales sin percent-encodear (@ / # / : / ? / %) y el parseo ' +
        'tomó un pedazo de la password como host. Copiá de nuevo la conn string del pooler.',
    );
  }

  // PUERTO: session mode (5432), NUNCA transaction mode (6543). pg_dump no puede trabajar a través
  // de pgBouncer en modo transacción —necesita estado de sesión y prepared statements— así que un
  // 6543 acá produce un backup fallido con un error que no menciona el pooler. El default también
  // es 5432: este script SOLO hace pg_dump, no hay caso en que 6543 sea lo correcto.
  const port = u.port || '5432';
  if (port === '6543') {
    throw new Error(
      'SUPABASE_DB_URL_PROD apunta al pooler en modo TRANSACCIÓN (puerto 6543): pg_dump no funciona ' +
        'por ahí. Usá la conn string del "Session pooler" (puerto 5432) del dashboard de Supabase.',
    );
  }

  return {
    PGHOST: decodeURIComponent(u.hostname),
    PGPORT: port,
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
  };
}

/** Timestamp ISO seguro para filename (sin `:` ni `.`, que rompen en Windows/algunos FS). */
export function isoStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * Nombre del archivo de backup, comprimido + con timestamp (R5.7).
 *
 * ⚠️ ESTE PREFIJO ES UN CONTRATO CON `.github/workflows/backup-prod.yml`: el paso de cifrado busca el
 * dump con un glob (`"$RUNNER_TEMP"/<prefijo>*.sql.gz`) y los artifacts se nombran con él. Cambiarlo acá
 * y no allá rompe el backup de PROD EN SILENCIO (el glob no matchea nada). Lo ata
 * `scripts/lib/backup-ci-consistency.test.mjs`, que DERIVA el prefijo de esta función.
 */
export function backupFilename(now = new Date()) {
  return `mitropero-prod-${isoStamp(now)}.sql.gz`;
}

/**
 * Dir default del backup: FUERA del working tree (`~/.mitropero-backups`, H1/R5.10).
 *
 * Rebrand (2026-08-17): antes era `~/.rafaq-backups`. Los backups viejos SIGUEN en el dir viejo — son
 * locales y no se migran; este script nunca lista el dir, solo escribe el `outPath` que arma acá.
 */
export function defaultBackupDir(homedir) {
  return path.join(homedir, '.mitropero-backups');
}

/**
 * Arma el plan del backup. PURA (no crea el archivo; el script lo hace tras validar).
 * @param {{env:Record<string,string|undefined>, homedir:string, outDir?:string, now?:Date}} p
 * @returns {{connString:string, pgEnv:object, dir:string, outPath:string, pgDumpArgs:string[]}}
 * @throws {Error} si falta la conn string (R5.8: abortar SIN crear archivo).
 */
export function buildBackupPlan({ env, homedir, outDir, now = new Date() }) {
  const raw = env.SUPABASE_DB_URL_PROD;
  if (!raw || !raw.trim()) {
    throw new Error(
      'Falta SUPABASE_DB_URL_PROD (conn string del pooler de PROD). Abortando SIN crear archivo de backup.',
    );
  }
  const connString = raw.trim();
  const pgEnv = parseConnString(connString);
  const dir = outDir && outDir.trim().length ? outDir.trim() : defaultBackupDir(homedir);
  const outPath = path.join(dir, backupFilename(now));
  // pg_dump: SIN -d/conn string en argv (L2/R5.11). La conexión llega por libpq env vars (pgEnv).
  const pgDumpArgs = ['--no-owner', '--no-privileges', '--verbose'];
  return { connString, pgEnv, dir, outPath, pgDumpArgs };
}

/** Resumen SEGURO para loguear: host/db/out, NUNCA la password ni la conn string cruda (R5.13). */
export function safeSummary(plan) {
  return `backup PROD → host=${plan.pgEnv.PGHOST} db=${plan.pgEnv.PGDATABASE} out=${plan.outPath}`;
}
