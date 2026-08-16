// db.ts — lectura del audit por CONEXIÓN DIRECTA a Postgres (spec 24, R4.1/R4.2). Aislado de `index.ts`
// para poder mockearlo en los tests de handler.
//
// Por qué conexión directa y no supabase-js: el schema `audit` NO está expuesto a PostgREST (config.toml
// `schemas = ["public","graphql_public"]`, migración 0124 lo deja afuera a propósito) → `.schema('audit')`
// daría PGRST106. Exponerlo violaría el muro fail-closed de spec 18. La EF conecta con la credencial de
// base server-side (`SUPABASE_DB_URL`, secret auto-inyectado en las EFs) SIN tocar grants ni exponer nada
// (R4.3). El cliente jamás recibe esa credencial (R4.2).
//
// ── SEGURIDAD [§8 M2] — SQL 100% POR TAGGED-TEMPLATE, JAMÁS `sql.unsafe`/concatenación ──────────────────
// La credencial `SUPABASE_DB_URL` es la de la base ENTERA (no solo `audit`) → una inyección sería
// catastrófica. TODO valor de filtro va como PLACEHOLDER ligado de Postgres.js (`sql`… ${valor} …``). El
// WHERE se compone interpolando FRAGMENTOS `sql`…`` (composición de SQL, no de strings): los valores de
// adentro siguen siendo parámetros. PROHIBIDO `sql.unsafe(...)` o construir SQL por string. Además los
// escalares llegan ya validados desde `query.ts` (uuids por regex, `table_name`/`op` por allowlist).
//
// [§8 M3] `postgres` (Postgres.js) FIJADO a versión EXACTA (no `^`/flotante). El `deno.lock` de la function
// se genera + commitea en el deploy (`deno cache`, necesita Deno + red npm — ambos gateados).

import postgres from 'npm:postgres@3.4.5';

import type { Filtros } from './query.ts';

// Fila cruda de audit.record_version (los tipos jsonb/timestamptz/bigint los normaliza el handler).
export type AuditRow = {
  id: string; // seleccionado como `id::text` → string exacto, sin pérdida de precisión del bigint
  record_id: string | null;
  op: string;
  ts: string | Date | null;
  auth_uid: string | null;
  request_id: string | null;
  table_name: string | null;
  record: unknown;
  old_record: unknown;
};

export type ActorRow = {
  id: string;
  name: string | null;
  email: string | null;
};

export type AuditQueryResult = {
  rows: AuditRow[]; // hasta limit+1 filas (el handler recorta y arma el cursor, §6.6)
  actors: ActorRow[];
};

// Lee una página del audit (limit+1 para saber si hay más) + resuelve los actores en batch. Abre UNA
// conexión efímera (`max:1`, `prepare:false` por el pooler transaction-mode) y la cierra en `finally`.
export async function queryAudit(filtros: Filtros): Promise<AuditQueryResult> {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) {
    throw new Error('Missing SUPABASE_DB_URL');
  }

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    // Fragmentos condicionales: cada uno con su valor LIGADO como parámetro. Solo se agregan los filtros
    // presentes (R2.8). Los casts (`::timestamptz`/`::uuid`/`::bigint`) aplican al PLACEHOLDER, no a input.
    const conds: unknown[] = [];
    if (filtros.from) conds.push(sql`ts >= ${filtros.from}::timestamptz`);
    if (filtros.to) conds.push(sql`ts <= ${filtros.to}::timestamptz`);
    if (filtros.auth_uid) conds.push(sql`auth_uid = ${filtros.auth_uid}::uuid`);
    if (filtros.request_id) conds.push(sql`request_id = ${filtros.request_id}::uuid`);
    // [§8 LOW-1] En un DELETE `record` es NULL → coalesce con `old_record` para no perder esos DELETE.
    if (filtros.establishment_id) {
      conds.push(
        sql`coalesce(record, old_record)->>'establishment_id' = ${filtros.establishment_id}`,
      );
    }
    if (filtros.table_name) conds.push(sql`table_name::text = ${filtros.table_name}`);
    if (filtros.op) conds.push(sql`op::text = ${filtros.op}`);
    if (filtros.before) conds.push(sql`id < ${filtros.before}::bigint`);

    // Composición del WHERE por interpolación de fragmentos (los `${valor}` siguen siendo parámetros).
    const whereClause =
      conds.length > 0
        ? conds.reduce((acc, c) => sql`${acc} and ${c}`)
        : sql`true`;

    // `id::text as id` → string exacto (bigint sin pérdida de precisión, R3.6). `order by
    // record_version.id` se QUALIFICA para ordenar por la COLUMNA bigint (no por el alias text, que
    // ordenaría lexicográficamente). `limit+1` para el cursor (§6.6).
    const rows = (await sql`
      select
        id::text as id,
        record_id,
        op,
        ts,
        auth_uid,
        request_id,
        table_name,
        record,
        old_record
      from audit.record_version
      where ${whereClause}
      order by record_version.id desc
      limit ${filtros.limit + 1}
    `) as unknown as AuditRow[];

    // Resolución de actores en batch (R5.1, sin N+1): una lectura por página. `email` vive en
    // public.user_private desde spec 14 (0068 dropeó users.email). Conexión de base directa → sin RLS.
    const uids = [
      ...new Set(rows.map((r) => r.auth_uid).filter((x): x is string => !!x)),
    ];

    let actors: ActorRow[] = [];
    if (uids.length > 0) {
      actors = (await sql`
        select u.id, u.name, p.email
        from public.users u
        left join public.user_private p on p.user_id = u.id
        where u.id = any(${uids}::uuid[])
      `) as unknown as ActorRow[];
    }

    return { rows, actors };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
