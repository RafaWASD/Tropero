#!/usr/bin/env node
// scripts/db-manifest.mjs — manifiesto del schema `public`: una línea `tabla<TAB>filas` por tabla.
//
// PARA QUÉ: es el ORÁCULO de la verificación de restauración del backup. Se genera contra la base
// ORIGEN en el momento del dump, y después se vuelve a generar contra la base RESTAURADA con la misma
// consulta; si difieren, el backup no sirve. La gracia es que el valor esperado sale de la base real y
// no de una lista escrita a mano: un manifiesto inventado sería un espejo del código y no podría
// detectar que faltan tablas.
//
// Cuenta EXACTA (no `n_live_tup`, que es una estimación de las estadísticas y puede estar vieja o en 0 —
// justo el modo de falla que haría pasar la verificación con un backup vacío).
//
// USO:
//   node scripts/db-manifest.mjs --source prod  > manifest.txt     (usa SUPABASE_DB_URL_PROD)
//   node scripts/db-manifest.mjs --source local > manifest.txt     (usa PGHOST/PGPORT/... del env)
//
// La conn string NUNCA va por argv: se parsea y se pasa a psql por variables libpq (mismo criterio
// que backup-db.mjs, R5.11).

import { spawnSync } from 'node:child_process';
import { parseConnString } from './lib/backup-cmd.mjs';

// Una sola consulta: nombre + count(*) exacto de cada tabla base de `public`. `query_to_xml` permite
// contar filas de una tabla nombrada dinámicamente sin hacer un round-trip por tabla.
// Dos secciones:
//   T<TAB>tabla<TAB>filas      — estructura + datos
//   P<TAB>tabla<TAB>policy     — las POLÍTICAS RLS, que son el modelo de seguridad multi-tenant entero.
// Las policies van incluidas porque la primera corrida de esta verificación (2026-08-09) pasó en VERDE
// mientras el restore tiraba decenas de `role "authenticated" does not exist`: `pg_dump --no-privileges`
// saca los GRANT pero NO las policies, así que la base restaurada tenía las tablas y los datos y NINGUNA
// política. Un backup que restaura los datos sin la seguridad no es un backup restaurado.
const SQL = `
select 'T'::text as tipo, t.table_name as obj,
       (xpath('/row/cnt/text()',
              query_to_xml(format('select count(*) as cnt from public.%I', t.table_name),
                           false, true, '')))[1]::text::text as det
from information_schema.tables t
where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
union all
select 'P'::text, p.tablename, p.policyname
from pg_policies p
where p.schemaname = 'public'
order by 1, 2, 3
`;

const source = process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : 'prod';

let pgEnv;
if (source === 'prod') {
  const raw = process.env.SUPABASE_DB_URL_PROD;
  if (!raw || !raw.trim()) {
    console.error('[db-manifest] Falta SUPABASE_DB_URL_PROD.');
    process.exit(1);
  }
  pgEnv = parseConnString(raw.trim()); // valida host/puerto igual que el backup
} else {
  pgEnv = {}; // local: se usan las PG* que ya estén en el env
}

const r = spawnSync('psql', ['-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', SQL], {
  env: { ...process.env, ...pgEnv },
  encoding: 'utf8',
});

if (r.error) {
  console.error(`[db-manifest] no pude ejecutar psql: ${r.error.message}`);
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`[db-manifest] psql salió con código ${r.status}\n${r.stderr ?? ''}`);
  process.exit(1);
}

const lineas = r.stdout.split('\n').filter((l) => l.trim() !== '');
const tablas = lineas.filter((l) => l.startsWith('T\t')).length;
const policies = lineas.filter((l) => l.startsWith('P\t')).length;

// PISO ANTI-VACUIDAD: sin esto, una base sin tablas ni policies produce un manifiesto vacío que después
// coincide con CUALQUIER restauración fallida — la verificación pasaría en verde sin verificar nada.
// El piso de policies es igual de importante: fue exactamente el agujero de la primera corrida.
const MIN_TABLAS = 10;
const MIN_POLICIES = 10;
if (tablas < MIN_TABLAS || policies < MIN_POLICIES) {
  console.error(
    `[db-manifest] manifiesto sospechosamente chico: ${tablas} tablas (mín ${MIN_TABLAS}), ` +
      `${policies} policies (mín ${MIN_POLICIES}). Un manifiesto casi vacío hace VACUA la verificación ` +
      'de restauración, así que se aborta en vez de emitirlo.',
  );
  process.exit(1);
}

process.stdout.write(`${lineas.join('\n')}\n`);
console.error(`[db-manifest] ${tablas} tablas y ${policies} policies en public (origen: ${source}).`);
