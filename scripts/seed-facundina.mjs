#!/usr/bin/env node
// scripts/seed-facundina.mjs — generador del campo demo "La Facundina" (spec 07, delta campañas congeladas,
// T74 / design §9.2).
//
// QUÉ HACE
//   Deja un establecimiento con DOS campañas reproductivas coherentes en sus dos rodeos:
//     · campaña CERRADA (default 2024): ciclo COMPLETO (servicio → tacto → parto → destete) y congelada con
//       `close_campaign`, con `closed_incomplete = false`.
//     · campaña EN CURSO (default 2025): servicio + tacto + parición (total o parcial según el calendario) y
//       destete pendiente → `cycle_complete = false`, la pantalla ofrece cerrar "a medias".
//   Todo en UNA sola transacción sobre la DB remota, por la Management API (mismo transporte que
//   scripts/apply-migration.mjs). Con `--dry-run` la transacción termina en `rollback` y aun así devuelve la
//   verificación completa (incluido el wall-time de `close_campaign`).
//
// POR QUÉ EXISTE COMO SCRIPT DEL REPO
//   El seed original de La Facundina se hizo a mano y no quedó en ningún lado: cuando hubo que re-sembrarlo
//   (RCC.11.*) no había nada que correr. Esto es el reemplazo, parametrizado y probado ANTES de borrar nada.
//
// LOS TRES PUNTOS QUE EL ESTADO ANTERIOR NO CUMPLÍA (design §9.2 / RCC.11.2-11.3)
//   1. `entry_date` EXPLÍCITO en cada perfil, anterior al inicio del servicio de la campaña cerrada. Sin él, el
//      trigger de membresía (0127) abre la fila con `from_date = created_at::date` = HOY, el perfil no está en
//      el rodeo a la fecha de corte y la campaña pasada devuelve `serviced = 0`.
//   2. `animal_category_history.changed_at` de las filas `initial` RETRODATADO al `entry_date` — incluidas las
//      de las CRÍAS que crea el trigger de parto. Sin esto `animal_category_at()` cae en la degradación de
//      RCC.2.7 (categoría ACTUAL) y una ternera de la campaña pasada, ya crecida a `vaquillona`, se cuela en el
//      denominador de una campaña en la que tenía 4 meses.
//   3. `birth_calves` DE VERDAD: partos con cría (trigger mono de 0045/0032) y sus destetes, o `%destete` no
//      tiene nada que mostrar y el cierre queda marcado incompleto.
//
// ORDEN DE LAS FASES (no es negociable, ver design §9.2)
//   preflight (asserts de aborto) → borrado acotado como `service_role` → sembrado como `service_role` →
//   asserts del modelo → captura EN VIVO de los KPI → `set local role authenticated` SOLO para los dos
//   `close_campaign` → `reset role` → verificación → commit.
//   ⚠ La impersonación NO se mueve al arranque: `authenticated` no tiene DELETE sobre animal_profiles /
//   animals / reproductive_events, así que el primer borrado moriría con 42501 y la transacción única haría
//   rollback entero. El alcance corto es a propósito.
//
// USO
//   node scripts/seed-facundina.mjs --establishment-id <uuid> --owner-id <uuid> [opciones]
//     --closed-year <int>        año de la campaña que se cierra (default 2024; la en curso es +1)
//     --expect-name "<txt>"      aborta si el establecimiento no se llama así (guard del id equivocado)
//     --expect-profiles a:b      cota de magnitud ANTES del primer delete (default 250:500; 0:0 = vacío)
//     --require-backup <json>    volcado del establecimiento YA tomado. Se ABRE y se verifica (declara este
//                                establishment_id y trae filas suyas), no alcanza con que exista
//     --backup-to <json>         lo toma ahora y después lo verifica igual.
//                                Con datos en el campo, uno de los dos es OBLIGATORIO (RCC.11.9).
//     --scale <n>                factor sobre el tamaño de los rodeos (default 1)
//     --tag-block <3 dígitos>    bloque del tag electrónico 032-BBB-......... (default 700)
//     --dry-run                  corre TODO y termina en rollback (devuelve la verificación igual)
//     --print-sql <archivo>      vuelca el SQL generado y no ejecuta nada
//   Utilidades para el establecimiento DESCARTABLE de prueba:
//     --bootstrap                crea usuario de test + establecimiento + rol owner, imprime los ids
//     --teardown --i-know        borra ese establecimiento entero + su usuario (se niega si el nombre no
//                                contiene SEED_TEST_MARK)
//
// SEGURIDAD: `.env.local` se carga internamente; ni el access token ni la service-role key se imprimen nunca.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// marca obligatoria en el nombre de todo establecimiento que --teardown acepta borrar.
const SEED_TEST_MARK = 'SEED-TEST';

// ---------------------------------------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------------------------------------
const envLocalPath = resolve(repoRoot, '.env.local');
if (existsSync(envLocalPath)) {
  const text = readFileSync(envLocalPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m || m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---------------------------------------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; } else { out[key] = next; i += 1; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidArg(name, value, { required = true } = {}) {
  if (value === undefined) {
    if (required) fail(`Falta --${name} (uuid).`);
    return null;
  }
  if (typeof value !== 'string' || !UUID_RE.test(value)) fail(`--${name} no es un uuid válido: ${value}`);
  return value.toLowerCase();
}
function intArg(name, value, dflt) {
  if (value === undefined) return dflt;
  const n = Number(value);
  if (!Number.isInteger(n)) fail(`--${name} tiene que ser entero: ${value}`);
  return n;
}
// Toda cadena que termina dentro del SQL pasa por acá. Los únicos valores libres son nombres (--expect-name,
// nombre del establecimiento de test): se escapan como literal de Postgres, no se concatenan crudos.
function lit(s) {
  if (s === null || s === undefined) return 'null';
  return `'${String(s).replace(/'/g, "''")}'`;
}
function fail(msg) { console.error(msg); process.exit(1); }

// ---------------------------------------------------------------------------------------------------------
// transporte
// ---------------------------------------------------------------------------------------------------------
async function runSql(sql, { label = 'sql' } = {}) {
  if (!PROJECT_REF || !ACCESS_TOKEN) fail('Falta SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN en .env.local.');
  const t0 = Date.now();
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify({ query: sql }), 'utf8'),
  });
  const body = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.error(`[${label}] HTTP ${res.status} (${ms} ms)`);
    console.error(body.slice(0, 6000));
    process.exit(1);
  }
  return { rows: JSON.parse(body), ms };
}

// ---------------------------------------------------------------------------------------------------------
// backup por establecimiento (RCC.11.9)
// ---------------------------------------------------------------------------------------------------------
// `scripts/backup-db.mjs` es OTRA cosa: un pg_dump entero de PROD a .sql.gz. Para un re-seed de un solo campo
// de DEV lo que hace falta es el volcado JSON de ESE establecimiento — que es el formato del backup que ya
// existe de La Facundina. Se genera acá para que el mismo script que destruye sea el que respalda, y para que
// el formato que produce y el que verifica no puedan divergir.
const BACKUP_TABLES = [
  ['establishments', 'select * from public.establishments where id = :est'],
  ['user_roles', 'select * from public.user_roles where establishment_id = :est'],
  ['invitations', 'select * from public.invitations where establishment_id = :est'],
  ['rodeos', 'select * from public.rodeos where establishment_id = :est'],
  ['rodeo_data_config', 'select * from public.rodeo_data_config where establishment_id = :est'],
  ['management_groups', 'select * from public.management_groups where establishment_id = :est'],
  ['field_definitions', 'select * from public.field_definitions where establishment_id = :est'],
  ['maneuver_presets', 'select * from public.maneuver_presets where establishment_id = :est'],
  ['sessions', 'select * from public.sessions where establishment_id = :est'],
  ['animals', 'select a.* from public.animals a where exists (select 1 from public.animal_profiles p where p.animal_id = a.id and p.establishment_id = :est)'],
  ['animal_profiles', 'select * from public.animal_profiles where establishment_id = :est'],
  ['animal_category_history', 'select * from public.animal_category_history where establishment_id = :est'],
  ['rodeo_membership_history', 'select * from public.rodeo_membership_history where establishment_id = :est'],
  ['reproductive_events', 'select * from public.reproductive_events where establishment_id = :est'],
  ['birth_calves', 'select * from public.birth_calves where establishment_id = :est'],
  ['weight_events', 'select * from public.weight_events where establishment_id = :est'],
  ['sanitary_events', 'select * from public.sanitary_events where establishment_id = :est'],
  ['treatments', 'select * from public.treatments where establishment_id = :est'],
  ['condition_score_events', 'select * from public.condition_score_events where establishment_id = :est'],
  ['scrotal_measurements', 'select * from public.scrotal_measurements where establishment_id = :est'],
  ['lab_samples', 'select * from public.lab_samples where establishment_id = :est'],
  ['custom_attributes', 'select * from public.custom_attributes where establishment_id = :est'],
  ['custom_measurements', 'select * from public.custom_measurements where establishment_id = :est'],
  ['animal_events', 'select * from public.animal_events where establishment_id = :est'],
  ['sigsa_declarations', 'select * from public.sigsa_declarations where establishment_id = :est'],
  ['export_log', 'select * from public.export_log where establishment_id = :est'],
  ['import_log', 'select * from public.import_log where establishment_id = :est'],
  ['semen_registry', 'select * from public.semen_registry where establishment_id = :est'],
  ['rodeo_campaign_snapshots', 'select * from public.rodeo_campaign_snapshots where establishment_id = :est'],
  ['rodeo_campaign_snapshot_animals', 'select * from public.rodeo_campaign_snapshot_animals where establishment_id = :est'],
];

async function takeBackup(path, est) {
  const parts = BACKUP_TABLES.map(([name, q]) => (
    `${lit(name)}, coalesce((select jsonb_agg(to_jsonb(t)) from (${q.replace(/:est/g, lit(est))}) t), '[]'::jsonb)`
  ));
  const { rows } = await runSql(
    `select jsonb_build_object('exported_at', now(), 'establishment_id', ${lit(est)},
       'tables', jsonb_build_object(${parts.join(',\n')})) as backup;`,
    { label: 'backup' },
  );
  const abs = expandHome(path);
  writeFileSync(abs, JSON.stringify(rows[0].backup, null, 1), 'utf8');
  console.log(`backup tomado: ${abs}`);
  return abs;
}

function expandHome(p) {
  return resolve(repoRoot, p.replace(/^~(?=[\\/])/, process.env.USERPROFILE || process.env.HOME || '~'));
}

// RCC.11.9 — un backup que no se abrió no es un backup. Se exige (y se LEE) siempre que haya algo que
// destruir: existe, pesa > 0, dice ser de ESTE establecimiento y contiene filas suyas.
function assertBackup(path, est) {
  const abs = expandHome(path);
  if (!existsSync(abs)) fail(`ABORT: el backup ${abs} no existe. Corré scripts/backup-db.mjs antes de borrar nada.`);
  const raw = readFileSync(abs, 'utf8');
  if (raw.length === 0) fail(`ABORT: el backup ${abs} está vacío.`);
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { return fail(`ABORT: el backup ${abs} no es JSON legible: ${e.message}`); }
  if (String(doc.establishment_id || '').toLowerCase() !== est) {
    fail(`ABORT: el backup ${abs} es del establecimiento ${doc.establishment_id}, no de ${est}.`);
  }
  const tables = doc.tables || {};
  let rows = 0;
  for (const list of Object.values(tables)) {
    if (!Array.isArray(list)) continue;
    for (const r of list) if (String(r.establishment_id || '').toLowerCase() === est) rows += 1;
  }
  if (rows === 0) fail(`ABORT: el backup ${abs} no contiene NINGUNA fila de ${est} — no respalda lo que se va a borrar.`);
  console.log(`backup verificado: ${abs} (${raw.length} bytes, ${rows} filas del establecimiento, ${Object.keys(tables).length} tablas)`);
}

async function authAdmin(path, init) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) fail('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local.');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init && init.headers),
    },
  });
  const body = await res.text();
  if (!res.ok) fail(`auth admin ${path}: HTTP ${res.status} ${body.slice(0, 800)}`);
  return body ? JSON.parse(body) : null;
}

// ---------------------------------------------------------------------------------------------------------
// COMPOSICIÓN DEL RODEO
// ---------------------------------------------------------------------------------------------------------
// Cada cohorte existe para ejercitar una rama concreta del cómputo histórico de 0129 — no son "350 vacas
// genéricas". La columna `serviced` de cada una es el MODELO de elegibilidad del script, y el seed aborta si
// no coincide con lo que devuelve `rodeo_serviced_females` (assert A3): es el oráculo de que el seed entendió
// las reglas y no al revés.
//
//   multipara     → elegible sin gate de aptitud, en las dos campañas (el grueso).
//   repo_cerrada  → `vaquillona` con veredicto `apta` en la campaña CERRADA y `vaca_segundo_servicio` en la
//                   EN CURSO: prueba que animal_category_at() lee la categoría DE ESA FECHA (F3) y no la de hoy.
//   vaq_prenada   → categoría que prueba servicio por sí sola.
//   salida        → multípara VENDIDA entre las dos campañas: tiene que seguir contando en la CERRADA (F2, el
//                   fix) y desaparecer de la EN CURSO.
//   repo_abierta  → vaquillona que ENTRÓ después del corte de la campaña cerrada: ausente de la cerrada,
//                   presente en la en curso (entradas, F4).
//   rechazo       → vaquillona con veredicto `no_apta`: no elegible en ninguna (RPS.6.2).
//   cut/toro/torito → cabezas que NO son denominador reproductivo.
const COHORTS = [
  // rodeo, cohorte,        n_inv, n_pri, categoría inicial,      categoría final,          sexo,     nacimiento,  ingreso,      salida,       aptitud,   fecha aptitud, recat
  { key: 'multipara',    nInv: 52, nPri: 85, initCat: 'multipara',          cat: 'multipara',             sex: 'female', birth: '2020-08-10', entry: '2022-05-01', exit: null,         fitness: null,     servClosed: true,  servOpen: true },
  { key: 'repo_cerrada', nInv: 18, nPri: 28, initCat: 'vaquillona',         cat: 'vaca_segundo_servicio', sex: 'female', birth: '2022-09-15', entry: '2023-09-01', exit: null,         fitness: 'apta',   servClosed: true,  servOpen: true },
  { key: 'vaq_prenada',  nInv: 8,  nPri: 14, initCat: 'vaquillona_prenada', cat: 'vaquillona_prenada',    sex: 'female', birth: '2022-04-10', entry: '2023-09-01', exit: null,         fitness: null,     servClosed: true,  servOpen: true },
  { key: 'salida',       nInv: 6,  nPri: 8,  initCat: 'multipara',          cat: 'multipara',             sex: 'female', birth: '2019-08-20', entry: '2022-05-01', exit: 'BETWEEN',    fitness: null,     servClosed: true,  servOpen: false },
  { key: 'repo_abierta', nInv: 9,  nPri: 15, initCat: 'vaquillona',         cat: 'vaquillona',            sex: 'female', birth: 'OPEN_M29',   entry: 'AFTER_CUT',  exit: null,         fitness: 'apta',   servClosed: false, servOpen: true },
  { key: 'rechazo',      nInv: 3,  nPri: 5,  initCat: 'vaquillona',         cat: 'vaquillona',            sex: 'female', birth: 'OPEN_M29',   entry: 'AFTER_CUT',  exit: null,         fitness: 'no_apta',servClosed: false, servOpen: false },
  { key: 'cut',          nInv: 3,  nPri: 4,  initCat: 'cut',                cat: 'cut',                   sex: 'female', birth: '2016-05-10', entry: '2022-05-01', exit: null,         fitness: null,     servClosed: false, servOpen: false },
  { key: 'toro',         nInv: 3,  nPri: 5,  initCat: 'toro',               cat: 'toro',                  sex: 'male',   birth: '2021-07-01', entry: '2022-05-01', exit: null,         fitness: null,     servClosed: false, servOpen: false },
  { key: 'torito',       nInv: 2,  nPri: 3,  initCat: 'torito',             cat: 'torito',                sex: 'male',   birth: 'OPEN_M23',   entry: 'AFTER_CUT',  exit: null,         fitness: null,     servClosed: false, servOpen: false },
];

// ---------------------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------------------
function buildSeedSql(opts) {
  const {
    est, owner, closedYear, openYear, expectName, minProfiles, maxProfiles,
    scale, tagBlock, fallbackInvId, fallbackPriId, dryRun,
  } = opts;

  const E = lit(est);
  const O = lit(owner);

  // fechas relativas al año de campaña, en SQL (para que el script no hornee un calendario a mano).
  // cut(rodeo, y)  = último día del mayor mes de servicio de `y` — la fecha de corte de DL6.
  // La cohorte `salida` sale del padrón DESPUÉS del corte de la cerrada y ANTES del corte de la en curso.
  // La cohorte `repo_abierta` entra DESPUÉS del corte de la cerrada.

  const cohortRows = COHORTS.flatMap((c) => (
    [['inv', c.nInv], ['pri', c.nPri]].map(([rk, n]) => {
      const size = Math.max(0, Math.round(n * scale));
      return `(${lit(c.key)}, ${lit(rk)}, ${size}, ${lit(c.initCat)}, ${lit(c.cat)}, ${lit(c.sex)}, `
        + `${lit(c.birth)}, ${lit(c.entry)}, ${c.exit ? lit(c.exit) : 'null'}, `
        + `${c.fitness ? lit(c.fitness) : 'null'}, ${c.servClosed}, ${c.servOpen})`;
    })
  )).join(',\n    ');

  return `
begin;
set local statement_timeout = '10min';
-- Identidad del OWNER para auth.uid(): con esto los triggers anti-spoof (created_by / changed_by) atribuyen
-- las filas al dueño del campo, y las RPC de lectura (has_role_in) pasan su guard. Ojo: esto NO cambia de
-- ROL — seguimos siendo service_role/postgres, que es lo único que puede BORRAR. El "set local role
-- authenticated" aparece una sola vez, en la fase 7.
set local request.jwt.claims = '{"sub":"${owner}","role":"authenticated"}';

-- =========================================================================================================
-- FASE 1 — PRECONDICIONES DE ABORTO (design §9.2 pasos 1-2 / RCC.11.8). Antes del primer delete.
-- =========================================================================================================
do $ph1$
declare v_name text; v_profiles int; v_events int; v_owner_ok boolean;
begin
  select e.name into v_name from public.establishments e where e.id = ${E} and e.deleted_at is null;
  if v_name is null then
    raise exception 'ABORT: el establecimiento % no existe o está borrado — no se toca nada', ${E};
  end if;
  ${expectName ? `if v_name <> ${lit(expectName)} then
    raise exception 'ABORT: el establecimiento % se llama "%" y se esperaba "%" — id equivocado, no se borra nada',
      ${E}, v_name, ${lit(expectName)};
  end if;` : '-- (sin --expect-name: no se verifica el nombre)'}
  select exists (select 1 from public.user_roles ur
                  where ur.user_id = ${O} and ur.establishment_id = ${E}
                    and ur.role = 'owner' and ur.active) into v_owner_ok;
  if not v_owner_ok then
    raise exception 'ABORT: % no es owner ACTIVO de % — close_campaign fallaría con 42501 al final', ${O}, ${E};
  end if;

  select count(*) into v_profiles from public.animal_profiles where establishment_id = ${E};
  select count(*) into v_events from public.reproductive_events where establishment_id = ${E};
  if v_profiles < ${minProfiles} or v_profiles > ${maxProfiles} then
    raise exception 'ABORT re-seed: magnitud inesperada (% perfiles, esperado ${minProfiles}..${maxProfiles}) — no se borra nada', v_profiles;
  end if;
  raise notice 'preflight OK: % (% perfiles, % eventos repro)', v_name, v_profiles, v_events;
end$ph1$;

-- =========================================================================================================
-- FASE 2 — BORRADO ACOTADO, como service_role, cada delete con su where explícito (design §9.2 paso 3).
-- =========================================================================================================
-- Los animals son GLOBALES (no tienen establishment_id) y una transferencia deja al mismo animal con perfil
-- en dos campos: por eso el delete de animals es "huérfanos de ESTA tanda", nunca "los animales del campo".
create temp table _doomed_animals on commit drop as
  select distinct animal_id from public.animal_profiles where establishment_id = ${E};

-- Foto de los rodeos ANTES de tocar nada: el informe tiene que poder decir si el seed REUSÓ los rodeos del
-- campo (lo esperado en La Facundina, cuyos ids son fijos) o si creó unos nuevos porque el nombre no matcheó
-- — que sería una degradación silenciosa: el rodeo viejo quedaría vacío y el demo apuntando a otro lado.
create temp table _rodeos_before on commit drop as
  select id, name from public.rodeos where establishment_id = ${E} and deleted_at is null;

delete from public.rodeo_campaign_snapshot_animals where establishment_id = ${E};
delete from public.rodeo_campaign_snapshots        where establishment_id = ${E};
delete from public.birth_calves                    where establishment_id = ${E};
delete from public.reproductive_events             where establishment_id = ${E};
delete from public.weight_events                   where establishment_id = ${E};
delete from public.sanitary_events                 where establishment_id = ${E};
delete from public.treatments                      where establishment_id = ${E};
delete from public.condition_score_events          where establishment_id = ${E};
delete from public.lab_samples                     where establishment_id = ${E};
delete from public.scrotal_measurements            where establishment_id = ${E};
delete from public.custom_measurements             where establishment_id = ${E};
delete from public.custom_attributes               where establishment_id = ${E};
delete from public.animal_events                   where establishment_id = ${E};
delete from public.sigsa_declarations              where establishment_id = ${E};
delete from public.rodeo_membership_history        where establishment_id = ${E};
delete from public.animal_category_history         where establishment_id = ${E};
delete from public.animal_profiles                 where establishment_id = ${E};
delete from public.animals a
 where a.id in (select animal_id from _doomed_animals)
   and not exists (select 1 from public.animal_profiles p where p.animal_id = a.id);
delete from public.sessions     where establishment_id = ${E};
delete from public.export_log   where establishment_id = ${E};
delete from public.import_log   where establishment_id = ${E};
delete from public.semen_registry where establishment_id = ${E};
-- NO se borran: establishments, user_roles, rodeos, rodeo_data_config, management_groups, field_definitions,
-- maneuver_presets, invitations. Ver la nota de reconciliación en design §9.2 (as-built).

-- =========================================================================================================
-- FASE 3 — RODEOS + configuración
-- =========================================================================================================
create temp table _rodeo (
  k text primary key, id uuid, name text, months smallint[], prefix text,
  cut_closed date, cut_open date, tacto_from_closed date, tacto_to_closed date
) on commit drop;

insert into _rodeo (k, name, months, prefix) values
  ('inv', 'Servicio Invierno',  array[6,7,8]::smallint[],    'I'),
  ('pri', 'Servicio Primavera', array[10,11,12]::smallint[], 'P');

-- Se REUSA el rodeo existente si ya está (La Facundina tiene ids fijos del namespace fac00000-…); si no, se
-- crea con el uuid que trae el script. Nunca se borra un rodeo: eso mataría su rodeo_data_config y su historia.
update _rodeo set id = coalesce(
  (select r.id from public.rodeos r
    where r.establishment_id = ${E} and r.name = _rodeo.name and r.deleted_at is null
    order by r.created_at limit 1),
  case _rodeo.k when 'inv' then ${lit(fallbackInvId)}::uuid else ${lit(fallbackPriId)}::uuid end);

insert into public.rodeos (id, establishment_id, name, species_id, system_id, service_months, active)
select r.id, ${E}, r.name, sp.id, sy.id, r.months, true
  from _rodeo r
  cross join lateral (select id from public.species where code = 'bovino' and active limit 1) sp
  cross join lateral (select sy2.id from public.systems_by_species sy2
                       where sy2.species_id = sp.id and sy2.code = 'cria' and sy2.active limit 1) sy
on conflict (id) do update
  set service_months = excluded.service_months, active = true, deleted_at = null, name = excluded.name;

-- La Facundina tiene TODOS los data_keys habilitados; sin 'prenez'/'tamano_prenez'/'tacto_vaquillona' el
-- gating de 0054 rechaza los eventos que este seed necesita.
update public.rodeo_data_config set enabled = true where rodeo_id in (select id from _rodeo);

-- Fail-fast con un mensaje que se entiende: sin los data_keys, el gating de 0054 rechaza los eventos 300
-- filas más abajo con un error que no dice qué hacer.
do $ph3$
declare v_bad text;
begin
  select string_agg(distinct r.k || ':' || fd.data_key, ', ') into v_bad
    from _rodeo r
    cross join (values ('prenez'),('tamano_prenez'),('tacto_vaquillona'),('peso'),('vacunacion'),
                       ('condicion_corporal')) req(data_key)
    join public.field_definitions fd on fd.data_key = req.data_key
   where not exists (select 1 from public.rodeo_data_config rdc
                      where rdc.rodeo_id = r.id and rdc.field_definition_id = fd.id and rdc.enabled);
  if v_bad is not null then
    raise exception 'ABORT: faltan data_keys habilitados en rodeo_data_config (%) — el gating de 0054 rechazaría los eventos', v_bad;
  end if;
end$ph3$;

-- Fechas derivadas de la ventana de servicio (DL5/DL6) — no hay ningún calendario horneado a mano.
update _rodeo set
  cut_closed = (make_date(${closedYear}, (select max(m) from unnest(months) m)::int, 1) + interval '1 month - 1 day')::date,
  cut_open   = (make_date(${openYear},   (select max(m) from unnest(months) m)::int, 1) + interval '1 month - 1 day')::date,
  tacto_from_closed = make_date(${closedYear}, (select min(m) from unnest(months) m)::int, 1),
  tacto_to_closed   = make_date(${closedYear} + 1, (select min(m) from unnest(months) m)::int, 1) - 1;

-- =========================================================================================================
-- FASE 4 — EL RODEO ADULTO
-- =========================================================================================================
create temp table _spec (
  cohort text, rodeo_k text, n int, init_cat text, final_cat text, sex text,
  birth_spec text, entry_spec text, exit_spec text, fitness text,
  serv_closed boolean, serv_open boolean
) on commit drop;

insert into _spec (cohort, rodeo_k, n, init_cat, final_cat, sex, birth_spec, entry_spec, exit_spec, fitness, serv_closed, serv_open) values
    ${cohortRows};

-- Resolución de las fechas simbólicas contra la ventana REAL de cada rodeo:
--   AFTER_CUT  = 3 meses después del corte de la campaña cerrada (entra entre campañas)
--   BETWEEN    = 1 mes antes del corte de la campaña en curso (sale entre campañas: después de parir y
--                destetar en la cerrada, antes del corte de la en curso)
--   OPEN_M29   = nacida 29 meses antes del corte de la campaña en curso (>= 365 días al corte: cae en el
--                fallback por edad de RPS.5.4 si no tiene veredicto)
--   OPEN_M23   = 23 meses antes (torito)
create temp table _herd on commit drop as
select
  gen_random_uuid() as animal_id,
  gen_random_uuid() as profile_id,
  -- CLAVE DETERMINISTA. Todo el azar del seed (preñada/vacía, cabeza/cuerpo/cola, pérdida, sexo de la cría,
  -- a quién se pesa, a quién se vende) sale de un md5 sobre ESTA clave, no del uuid del perfil: así dos
  -- corridas sobre el mismo establecimiento producen el MISMO campo y los números del demo son reproducibles.
  s.rodeo_k || ':' || s.cohort || ':' || g.i::text as dkey,
  s.cohort, s.rodeo_k, s.init_cat, s.final_cat, s.sex, s.fitness, s.serv_closed, s.serv_open,
  case s.birth_spec
    when 'OPEN_M29' then (r.cut_open - interval '29 months')::date
    when 'OPEN_M23' then (r.cut_open - interval '23 months')::date
    else s.birth_spec::date end as birth_date,
  case s.entry_spec
    when 'AFTER_CUT' then (r.cut_closed + interval '3 months')::date
    else s.entry_spec::date end as entry_date,
  case s.exit_spec
    when 'BETWEEN' then (r.cut_open - interval '1 month')::date
    else null::date end as exit_date,
  -- veredicto de aptitud SIEMPRE dentro de la campaña en la que la cohorte se sirve por primera vez y
  -- ANTES de su fecha de corte (rv.event_date <= v_state_as_of, F3).
  case when s.fitness is null then null
       when s.serv_closed then (r.cut_closed - interval '3 months')::date
       else (r.cut_open - interval '3 months')::date end as fitness_date,
  -- la recategorización de la cohorte de reposición cae ENTRE los dos cortes
  case when s.final_cat = s.init_cat then null
       else (r.cut_open - interval '2 months')::date end as recat_date,
  row_number() over (order by s.rodeo_k, s.cohort, g.i) as seq,
  g.i as idx
from _spec s
join _rodeo r on r.k = s.rodeo_k,
lateral generate_series(1, s.n) g(i)
where s.n > 0;

-- caravana electrónica: 032 (Argentina) + bloque de 3 + 9 dígitos. El bloque entero tiene que estar LIBRE
-- (animals_tag_unique es global, no por establecimiento) — se chequea el PREFIJO, no las 350 filas que este
-- seed va a insertar: así también cubre las caravanas de las crías, que se generan más adelante.
alter table _herd add column tag text;
update _herd set tag = '032${tagBlock}' || lpad(seq::text, 9, '0');

do $ph4$
declare v_dup int;
begin
  select count(*) into v_dup from public.animals a where a.tag_electronic like '032${tagBlock}%';
  if v_dup > 0 then
    raise exception 'ABORT: el bloque de caravana 032${tagBlock} ya tiene % animales — cambiá --tag-block', v_dup;
  end if;
end$ph4$;

insert into public.animals (id, tag_electronic, species_id, sex, birth_date)
select h.animal_id, h.tag, sp.id, h.sex, h.birth_date
  from _herd h cross join lateral (select id from public.species where code='bovino' and active limit 1) sp;

-- entry_date EXPLÍCITO (RCC.11.2) y category_override para que los triggers de transición no muevan la
-- categoría sembrada bajo nuestros pies.
insert into public.animal_profiles
  (id, animal_id, establishment_id, rodeo_id, idv, category_id, category_override, entry_date, entry_origin,
   status, teeth_state)
select h.profile_id, h.animal_id, ${E}, r.id,
       r.prefix || '-' || lpad(h.seq::text, 4, '0'),
       c.id, true, h.entry_date, 'compra', 'active',
       case when h.final_cat in ('multipara','cut','toro') then 'boca_llena'::public.teeth_state_enum
            when h.final_cat in ('vaca_segundo_servicio','vaquillona_prenada') then '6d'::public.teeth_state_enum
            else '2d'::public.teeth_state_enum end
  from _herd h
  join _rodeo r on r.k = h.rodeo_k
  join public.rodeos ro on ro.id = r.id
  join public.categories_by_system c on c.system_id = ro.system_id and c.code = h.init_cat and c.active;

-- Recategorización de la cohorte de reposición: la fila de historia que escribe el trigger se re-fecha al
-- momento real del cambio, para que animal_category_at() devuelva "vaquillona" en la campaña cerrada y
-- "vaca_segundo_servicio" en la en curso.
update public.animal_profiles p
   set category_id = c.id
  from _herd h
  join _rodeo r on r.k = h.rodeo_k
  join public.rodeos ro on ro.id = r.id
  join public.categories_by_system c on c.system_id = ro.system_id and c.code = h.final_cat and c.active
 where p.id = h.profile_id and h.recat_date is not null;

update public.animal_category_history ach
   set changed_at = h.recat_date + time '10:00'
  from _herd h
 where ach.animal_profile_id = h.profile_id
   and ach.reason = 'manual_override'
   and h.recat_date is not null;

-- =========================================================================================================
-- FASE 5 — EVENTOS REPRODUCTIVOS DE LAS DOS CAMPAÑAS
-- =========================================================================================================
-- Jornadas (sesiones): se crean ACTIVAS porque tg_event_session_tenant_check exige sesión activa al adjuntar
-- un evento; se cierran al final de la fase.
create temp table _session (k text primary key, id uuid, rodeo_k text, started date, cfg jsonb) on commit drop;
insert into _session (k, id, rodeo_k, started, cfg)
select r.k || '_tacto_' || y.y, gen_random_uuid(), r.k,
       (case when y.y = ${closedYear} then r.cut_closed else r.cut_open end + interval '70 days')::date,
       '{"maniobras":["tacto","condicion_corporal"]}'::jsonb
  from _rodeo r, (values (${closedYear}), (${openYear})) y(y)
union all
select r.k || '_tactovaq', gen_random_uuid(), r.k, (r.cut_closed - interval '3 months')::date,
       '{"maniobras":["tacto_vaquillona"]}'::jsonb from _rodeo r
union all
select r.k || '_destete', gen_random_uuid(), r.k, (r.cut_open + interval '4 months')::date,
       '{"maniobras":["destete","pesaje"]}'::jsonb from _rodeo r
union all
select r.k || '_sanidad', gen_random_uuid(), r.k, (current_date - interval '116 days')::date,
       '{"maniobras":["vacunacion","pesaje"]}'::jsonb from _rodeo r;

insert into public.sessions (id, establishment_id, rodeo_id, config, status, started_at, created_by)
select s.id, ${E}, r.id, s.cfg, 'active', s.started + time '08:30', ${O}
  from _session s join _rodeo r on r.k = s.rodeo_k;

-- ── aptitud de vaquillonas ────────────────────────────────────────────────────────────────────────────────
insert into public.reproductive_events
  (animal_profile_id, session_id, event_type, event_date, heifer_fitness, created_by)
select h.profile_id, sv.id, 'tacto_vaquillona', h.fitness_date, h.fitness::public.heifer_fitness_result, ${O}
  from _herd h
  join _session sv on sv.k = h.rodeo_k || '_tactovaq'
 where h.fitness is not null
   -- solo se adjunta a la jornada si la fecha coincide con la de esa jornada; si no, va suelta (RTF.8)
   and h.fitness_date = sv.started;

insert into public.reproductive_events
  (animal_profile_id, event_type, event_date, heifer_fitness, created_by)
select h.profile_id, 'tacto_vaquillona', h.fitness_date, h.fitness::public.heifer_fitness_result, ${O}
  from _herd h
  join _session sv on sv.k = h.rodeo_k || '_tactovaq'
 where h.fitness is not null and h.fitness_date <> sv.started;

-- ── el plan de tactos de las dos campañas ─────────────────────────────────────────────────────────────────
-- Bucket determinista por (perfil, año): 12% vacías; de las preñadas 50% cabeza / 30% cuerpo / 20% cola.
-- El mes de CONCEPCIÓN sale del bucket (cabeza = primer mes de servicio), y el parto se construye como
-- concepción + 9 meses: así la imputación de rodeo_campaign_births() cierra por construcción y no por suerte.
create temp table _plan on commit drop as
with base as (
  select h.profile_id, h.dkey, h.rodeo_k, h.seq, y.y as campaign_year, r.id as rodeo_id, r.months,
         (case when y.y = ${closedYear} then r.cut_closed else r.cut_open end) as cut,
         mod(('x' || substr(md5(h.dkey || 'p' || y.y::text), 1, 7))::bit(28)::int, 100) as hp,
         mod(('x' || substr(md5(h.dkey || 'b' || y.y::text), 1, 7))::bit(28)::int, 100) as hb,
         mod(('x' || substr(md5(h.dkey || 's' || y.y::text), 1, 7))::bit(28)::int, 100) as hs
    from _herd h
    join _rodeo r on r.k = h.rodeo_k
    cross join (values (${closedYear}), (${openYear})) y(y)
   where (y.y = ${closedYear} and h.serv_closed) or (y.y = ${openYear} and h.serv_open)
),
withstatus as (
  select b.*,
         case when b.hp < 12 then 'empty' when b.hp < 56 then 'large'
              when b.hp < 82 then 'medium' else 'small' end as preg_status,
         (b.cut + interval '70 days')::date + (b.seq % 8)::int as tacto_date
    from base b
)
select w.profile_id, w.dkey, w.rodeo_k, w.rodeo_id, w.campaign_year, w.seq, w.preg_status, w.tacto_date, w.hb, w.hs,
       case w.preg_status
         when 'large'  then (select min(m) from unnest(w.months) m)
         when 'medium' then (select m from unnest(w.months) m order by m offset 1 limit 1)
         when 'small'  then (select max(m) from unnest(w.months) m)
       end::int as conc_month
  from withstatus w;

alter table _plan add column birth_date date;
update _plan set birth_date = case when preg_status = 'empty' or hb < 6 then null
  else (make_date(campaign_year, conc_month, (1 + (seq % 27))::int) + interval '9 months')::date end;
-- la parición de la campaña en curso está EN CURSO: lo que todavía no ocurrió, no se carga.
update _plan set birth_date = null where birth_date is not null and birth_date >= current_date;

insert into public.reproductive_events
  (animal_profile_id, session_id, event_type, event_date, pregnancy_status, created_by)
select p.profile_id, s.id, 'tacto', p.tacto_date, p.preg_status::public.pregnancy_status_enum, ${O}
  from _plan p
  join _session s on s.k = p.rodeo_k || '_tacto_' || p.campaign_year;

-- ── partos CON cría: el trigger mono (0045/0032) crea el animal, el perfil y la fila de birth_calves ──────
insert into public.reproductive_events
  (animal_profile_id, event_type, event_date, calf_sex, calf_weight, calf_tag_electronic, created_by)
select p.profile_id, 'birth', p.birth_date,
       case when p.hs % 2 = 0 then 'male' else 'female' end,
       30 + (p.hs % 12),
       '032${tagBlock}' || lpad((500000 + row_number() over (order by p.dkey, p.campaign_year))::text, 9, '0'),
       ${O}
  from _plan p
 where p.birth_date is not null;

create temp table _calf on commit drop as
select bc.calf_profile_id, re.animal_profile_id as mother_profile_id, re.event_date as birth_date,
       p.campaign_year, p.rodeo_k, p.dkey || ':' || p.campaign_year::text as dkey,
       (re.event_date + interval '210 days')::date as weaning_date
  from public.reproductive_events re
  join public.birth_calves bc on bc.birth_event_id = re.id
  join _plan p on p.profile_id = re.animal_profile_id and p.birth_date = re.event_date
 where re.establishment_id = ${E} and re.event_type = 'birth';

-- identificador legible de la cría (el trigger no le pone idv y el detalle del snapshot lo congela).
-- El row_number va en una CTE: una función de ventana no puede vivir en el SET de un UPDATE.
with numbered as (
  select c.calf_profile_id,
         r.prefix || '-' || to_char(c.birth_date, 'YY') || '-'
           || lpad((row_number() over (partition by c.rodeo_k, c.campaign_year
                                       order by c.dkey))::text, 3, '0') as idv
    from _calf c join _rodeo r on r.k = c.rodeo_k
)
update public.animal_profiles p set idv = n.idv from numbered n where p.id = n.calf_profile_id;

-- ── destetes: SOLO los de la campaña cerrada (la en curso todavía tiene las crías al pie) ─────────────────
insert into public.reproductive_events (animal_profile_id, event_type, event_date, created_by)
select c.calf_profile_id, 'weaning', c.weaning_date, ${O}
  from _calf c
 where c.campaign_year = ${closedYear} and c.weaning_date < current_date;

do $ph5$
declare v_pend int;
begin
  select count(*) into v_pend from _calf c
   where c.campaign_year = ${closedYear} and c.weaning_date >= current_date;
  if v_pend > 0 then
    raise exception 'ABORT: % crías de la campaña % no llegan a destetarse antes de hoy — el ciclo NO está completo y el cierre pediría reconocimiento. Corregí las fechas, no reconozcas.', v_pend, ${closedYear};
  end if;
end$ph5$;

-- =========================================================================================================
-- FASE 6 — PESOS, SANIDAD, CONDICIÓN CORPORAL, BAJAS, Y LA RETRODATACIÓN DE LA CATEGORÍA
-- =========================================================================================================
-- pesaje de destete de las crías de la campaña cerrada
insert into public.weight_events (animal_profile_id, session_id, weight_kg, weight_date, source, created_by)
select c.calf_profile_id, s.id, 150 + mod(('x' || substr(md5(c.dkey), 1, 7))::bit(28)::int, 70),
       c.weaning_date, 'manual', ${O}
  from _calf c
  join _session s on s.k = c.rodeo_k || '_destete'
 where c.campaign_year = ${closedYear};

-- pesaje reciente de ~70% de los adultos EN PADRÓN (el 30% restante alimenta establishment_unweighed).
-- Los que ya salieron quedan afuera: una pesada de hoy sobre una vaca vendida el año pasado es dato falso.
insert into public.weight_events (animal_profile_id, session_id, weight_kg, weight_date, source, created_by)
select h.profile_id, s.id,
       case when h.sex = 'male' then 650 else 380 end + mod(('x' || substr(md5(h.dkey || 'w'), 1, 7))::bit(28)::int, 90),
       s.started, 'manual', ${O}
  from _herd h
  join _session s on s.k = h.rodeo_k || '_sanidad'
 where h.exit_date is null
   and mod(('x' || substr(md5(h.dkey || 'q'), 1, 7))::bit(28)::int, 10) < 7;

-- aftosa al día (próxima dosis en el futuro) para todo el rodeo adulto en padrón
insert into public.sanitary_events
  (animal_profile_id, session_id, event_type, product_name, active_ingredient, dose_ml, route, event_date,
   next_dose_date, created_by)
select h.profile_id, s.id, 'vaccination', 'Aftogan Oleoso', 'Virus aftosa inactivado O1/A24/C3', 2,
       'subcutaneous', s.started, (s.started + interval '180 days')::date, ${O}
  from _herd h join _session s on s.k = h.rodeo_k || '_sanidad'
 where h.exit_date is null;

-- brucelosis de las vaquillonas de reposición con la revacunación VENCIDA → establishment_overdue_doses
insert into public.sanitary_events
  (animal_profile_id, event_type, product_name, active_ingredient, dose_ml, route, event_date, next_dose_date,
   created_by)
select h.profile_id, 'vaccination', 'Brucelosis Cepa 19', 'Brucella abortus cepa 19', 2, 'subcutaneous',
       (current_date - interval '400 days')::date, (current_date - interval '35 days')::date, ${O}
  from _herd h
 where h.exit_date is null and h.cohort in ('repo_cerrada', 'repo_abierta');

-- condición corporal en la jornada de tacto de la campaña en curso
insert into public.condition_score_events (animal_profile_id, session_id, score, event_date, created_by)
select p.profile_id, s.id,
       2.5 + 0.25 * mod(('x' || substr(md5(p.dkey || 'c'), 1, 7))::bit(28)::int, 8),
       p.tacto_date, ${O}
  from _plan p
  join _session s on s.k = p.rodeo_k || '_tacto_' || p.campaign_year
 where p.campaign_year = ${openYear}
   and mod(('x' || substr(md5(p.dkey || 'cc'), 1, 7))::bit(28)::int, 10) < 6;

update public.sessions s
   set status = 'closed', ended_at = ss.started + time '17:00',
       animal_count = coalesce(cnt.n, 0), event_count = coalesce(cnt.n, 0)
  from _session ss
  left join lateral (
    select count(*) n from (
      select animal_profile_id from public.reproductive_events where session_id = ss.id
      union all select animal_profile_id from public.weight_events where session_id = ss.id
      union all select animal_profile_id from public.sanitary_events where session_id = ss.id
      union all select animal_profile_id from public.condition_score_events where session_id = ss.id
    ) u
  ) cnt on true
 where s.id = ss.id;

-- ── bajas ────────────────────────────────────────────────────────────────────────────────────────────────
-- (a) las madres vendidas entre campañas: siguen contando en la campaña cerrada (F2) y salen de la en curso.
update public.animal_profiles p
   set status = 'sold', exit_reason = 'sale', exit_date = h.exit_date,
       exit_weight = 430, exit_price = 1250000
  from _herd h
 where p.id = h.profile_id and h.exit_date is not null;

-- (b) el 80% de las crías desteta-y-vende; el resto queda como reposición del año que viene.
update public.animal_profiles p
   set status = 'sold', exit_reason = 'sale',
       exit_date = (c.weaning_date + interval '45 days')::date,
       exit_weight = 190, exit_price = 480000
  from _calf c
 where p.id = c.calf_profile_id
   and c.campaign_year = ${closedYear}
   and (c.weaning_date + interval '45 days')::date < current_date
   and mod(('x' || substr(md5(c.dkey || 'v'), 1, 7))::bit(28)::int, 10) < 8;

-- ── lotes de manejo ──────────────────────────────────────────────────────────────────────────────────────
-- Se ASIGNAN si el establecimiento ya los tiene (La Facundina los trae del seed original y no se borran);
-- si no existen, el update no hace nada. No se crean lotes acá: son decisión del productor, no del seed.
update public.animal_profiles p
   set management_group_id = g.id
  from _herd h
  join public.management_groups g
    on g.establishment_id = ${E} and g.deleted_at is null
   and g.name = case
         when h.cohort in ('repo_abierta','rechazo') then 'Vaquillonas de reposición'
         when h.cohort in ('toro','torito')          then 'Toros'
         when h.cohort = 'cut'                       then 'Vacas de refugo (CUT)'
       end
 where p.id = h.profile_id;

-- ── RETRODATACIÓN de animal_category_history (RCC.11.3) ──────────────────────────────────────────────────
-- VA AL FINAL Y ALCANZA A LAS CRÍAS. El trigger de parto crea el perfil del ternero HOY, así que su fila
-- "initial" queda fechada hoy: sin esta corrección, animal_category_at(cría, corte del año pasado) cae en la
-- degradación de RCC.2.7 y devuelve la categoría de HOY. Una ternera de la campaña cerrada, ya crecida a
-- "vaquillona" por el destete, entraría al denominador de una campaña en la que tenía cuatro meses.
update public.animal_category_history ach
   set changed_at = coalesce(p.entry_date, p.created_at::date) + time '10:00'
  from public.animal_profiles p
 where ach.animal_profile_id = p.id
   and p.establishment_id = ${E}
   and ach.reason = 'initial'
   and ach.changed_at::date <> coalesce(p.entry_date, p.created_at::date);

-- =========================================================================================================
-- FASE 6-bis — ASSERTS DEL MODELO, ANTES DE CONGELAR NADA
-- =========================================================================================================
-- A3: el conjunto SERVIDAS que devuelve la DB tiene que coincidir con el que el script dice haber sembrado.
-- Si difieren, el seed entendió mal las reglas de elegibilidad y congelar sería congelar el malentendido.
do $ph6$
declare r record; v_model int; v_db int;
begin
  for r in select k, id from _rodeo loop
    select count(*) into v_model from _herd h where h.rodeo_k = r.k and h.serv_closed;
    select count(*) into v_db from public.rodeo_serviced_females(r.id, ${closedYear});
    if v_model <> v_db then
      raise exception 'ABORT: servidas % % — modelo % vs DB % (el seed no coincide con la elegibilidad real)',
        r.k, ${closedYear}, v_model, v_db;
    end if;
    select count(*) into v_model from _herd h where h.rodeo_k = r.k and h.serv_open;
    select count(*) into v_db from public.rodeo_serviced_females(r.id, ${openYear});
    if v_model <> v_db then
      raise exception 'ABORT: servidas % % — modelo % vs DB %', r.k, ${openYear}, v_model, v_db;
    end if;
  end loop;
end$ph6$;

-- A4: el ciclo de la campaña que se va a cerrar tiene que estar COMPLETO POR SUS DATOS, no por el escape de
-- los 18 meses de campaign_cycle_complete(). Si el cierre necesitara p_acknowledge_incomplete, el seed está
-- mal y hay que corregir las FECHAS, no reconocer (design §9.2 / T74).
do $ph7$
declare r record; w record; c record;
begin
  for r in select k, id from _rodeo loop
    select * into w from public.rodeo_weaning_kpi(r.id, ${closedYear});
    if w.status <> 'ok' or w.pending_weaning <> 0 or w.weaned = 0 then
      raise exception 'ABORT: la campaña % de % no tiene el ciclo completo por datos (status=%, weaned=%, pending=%)',
        ${closedYear}, r.k, w.status, w.weaned, w.pending_weaning;
    end if;
    -- La campaña en curso se mide por el MISMO predicado que usan la app y el gate del cierre
    -- (campaign_cycle_complete, vía rodeo_campaign_status), no por un proxy: si diera cycle_complete la
    -- demo no tendría el segundo estado de pantalla y el Gate 2.5 se quedaría sin la mitad de las capturas.
    select * into c from public.rodeo_campaign_status(r.id, ${openYear});
    if c.is_closed or c.cycle_complete then
      raise exception 'ABORT: la campaña % de % no quedó EN CURSO (is_closed=%, cycle_complete=%)',
        ${openYear}, r.k, c.is_closed, c.cycle_complete;
    end if;
  end loop;
end$ph7$;

-- A4-bis: NINGÚN evento sembrado puede estar fechado en el futuro. Es el guard contra un --closed-year mal
-- elegido o contra correr el seed en un mes en el que la parición de la campaña en curso todavía no empezó:
-- un tacto o un parto con fecha de mañana es dato inventado, y encima envenena los KPI del año siguiente.
do $ph7b$
declare v_bad text;
begin
  select string_agg(t, ', ') into v_bad from (
    select 'reproductive_events=' || count(*)::text t from public.reproductive_events
      where establishment_id = ${E} and event_date > current_date having count(*) > 0
    union all
    select 'weight_events=' || count(*)::text from public.weight_events
      where establishment_id = ${E} and weight_date > current_date having count(*) > 0
    union all
    select 'sanitary_events=' || count(*)::text from public.sanitary_events
      where establishment_id = ${E} and event_date > current_date having count(*) > 0
    union all
    select 'condition_score_events=' || count(*)::text from public.condition_score_events
      where establishment_id = ${E} and event_date > current_date having count(*) > 0
    union all
    select 'sessions=' || count(*)::text from public.sessions
      where establishment_id = ${E} and started_at::date > current_date having count(*) > 0
  ) x;
  if v_bad is not null then
    raise exception 'ABORT: el seed dejó eventos con fecha FUTURA (%) — revisá --closed-year contra el calendario', v_bad;
  end if;
end$ph7b$;

-- =========================================================================================================
-- FASE 7 — LOS KPI EN VIVO, EL CIERRE, Y LOS KPI CONGELADOS
-- =========================================================================================================
create temp table _kpi (phase text, rodeo_k text, campaign_year int, bundle jsonb) on commit drop;
create temp table _timing (step text, ms numeric) on commit drop;

create or replace function pg_temp.kpi_bundle(p_rodeo uuid, p_year int) returns jsonb
language sql as $kb$
  select jsonb_build_object(
    'serviced', (select jsonb_agg(jsonb_build_array(x.animal_profile_id, x.source) order by x.animal_profile_id)
                   from public.rodeo_serviced_females(p_rodeo, p_year) x),
    'denominator', to_jsonb((select d from public.rodeo_repro_denominator(p_rodeo, p_year) d)),
    'pregnancy',   to_jsonb((select d from public.rodeo_pregnancy_kpi   (p_rodeo, p_year) d)),
    'calving',     to_jsonb((select d from public.rodeo_calving_kpi     (p_rodeo, p_year) d)),
    'ccl',         to_jsonb((select d from public.rodeo_ccl_distribution(p_rodeo, p_year) d)),
    'by_stage',    to_jsonb((select d from public.rodeo_calving_by_stage(p_rodeo, p_year) d)),
    'weaning',     to_jsonb((select d from public.rodeo_weaning_kpi     (p_rodeo, p_year) d))
  );
$kb$;

insert into _kpi (phase, rodeo_k, campaign_year, bundle)
select 'pre', r.k, y.y, pg_temp.kpi_bundle(r.id, y.y)
  from _rodeo r, (values (${closedYear}), (${openYear})) y(y);

-- ⚠ ÚNICO punto de impersonación (design §9.2 paso 5 / RCC.11.7). close_campaign deriva closed_by de
-- auth.uid() y su guard es is_owner_or_vet_of: sin identidad fiel devolvería 42501 y el cierre no se
-- ejercitaría por el camino real. Los dos cierres van en la MISMA transacción, que es posible gracias al
-- crear-o-truncar de las temporales de §4.2 paso 7 (sin él el segundo moría con 42P07).
do $ph8$
declare
  v_inv uuid; v_pri uuid; t0 timestamptz; t1 timestamptz; t2 timestamptz;
  v_rinv uuid; v_rpri uuid;
begin
  select id into v_rinv from _rodeo where k = 'inv';
  select id into v_rpri from _rodeo where k = 'pri';

  set local role authenticated;
  t0 := clock_timestamp();
  v_inv := public.close_campaign(v_rinv, ${closedYear}, false);
  t1 := clock_timestamp();
  v_pri := public.close_campaign(v_rpri, ${closedYear}, false);
  t2 := clock_timestamp();
  reset role;

  insert into _timing (step, ms) values
    ('close_campaign inv ${closedYear}', extract(epoch from (t1 - t0)) * 1000),
    ('close_campaign pri ${closedYear}', extract(epoch from (t2 - t1)) * 1000);

  if v_inv is null or v_pri is null then
    raise exception 'ABORT: close_campaign devolvió null';
  end if;
end$ph8$;

insert into _kpi (phase, rodeo_k, campaign_year, bundle)
select 'post', r.k, y.y, pg_temp.kpi_bundle(r.id, y.y)
  from _rodeo r, (values (${closedYear}), (${openYear})) y(y);

-- A5: la foto tiene que ser IDÉNTICA a la lectura en vivo previa (DL2) y salir sin reconocimiento.
do $ph9$
declare r record;
begin
  for r in select a.rodeo_k, a.campaign_year, a.bundle pre, b.bundle post
             from _kpi a join _kpi b
               on b.rodeo_k = a.rodeo_k and b.campaign_year = a.campaign_year and b.phase = 'post'
            where a.phase = 'pre' and a.campaign_year = ${closedYear} loop
    if r.pre <> r.post then
      raise exception 'ABORT: la foto de % % NO coincide con la lectura en vivo. pre=% post=%',
        r.rodeo_k, r.campaign_year, r.pre, r.post;
    end if;
  end loop;
  if exists (select 1 from public.rodeo_campaign_snapshots s
              join _rodeo r2 on r2.id = s.rodeo_id
             where s.campaign_year = ${closedYear} and s.reopened_at is null and s.closed_incomplete) then
    raise exception 'ABORT: quedó un snapshot con closed_incomplete = true — el ciclo sembrado no está completo';
  end if;
end$ph9$;

-- =========================================================================================================
-- FASE 8 — INFORME
-- =========================================================================================================
select jsonb_pretty(jsonb_build_object(
  'establishment_id', ${E},
  'dry_run', ${dryRun},
  'server_date', current_date,
  'closed_year', ${closedYear},
  'open_year', ${openYear},
  'rodeos', (select jsonb_agg(jsonb_build_object(
       'k', r.k, 'id', r.id, 'name', r.name, 'service_months', r.months,
       'cut_closed', r.cut_closed, 'cut_open', r.cut_open,
       'reusado', exists (select 1 from _rodeos_before b where b.id = r.id)) order by r.k) from _rodeo r),
  -- rodeos del campo que el seed NO usó: quedaron vacíos. En La Facundina esto tiene que ser [].
  'rodeos_huerfanos', (select coalesce(jsonb_agg(b.name), '[]'::jsonb) from _rodeos_before b
                        where not exists (select 1 from _rodeo r where r.id = b.id)),
  'head', jsonb_build_object(
     'profiles_total',  (select count(*) from public.animal_profiles where establishment_id = ${E}),
     'profiles_active', (select count(*) from public.animal_profiles where establishment_id = ${E} and status = 'active' and deleted_at is null),
     'adults_seeded',   (select count(*) from _herd),
     'calves',          (select count(*) from _calf),
     'birth_calves',    (select count(*) from public.birth_calves where establishment_id = ${E}),
     'repro_events',    (select count(*) from public.reproductive_events where establishment_id = ${E}),
     'weight_events',   (select count(*) from public.weight_events where establishment_id = ${E}),
     'sanitary_events', (select count(*) from public.sanitary_events where establishment_id = ${E}),
     'condition_events',(select count(*) from public.condition_score_events where establishment_id = ${E}),
     'sessions',        (select count(*) from public.sessions where establishment_id = ${E}),
     'membership_rows', (select count(*) from public.rodeo_membership_history where establishment_id = ${E}),
     'entry_date_nulls',(select count(*) from public.animal_profiles where establishment_id = ${E} and entry_date is null),
     'initial_history_stale', (select count(*) from public.animal_category_history ach
                                 join public.animal_profiles p on p.id = ach.animal_profile_id
                                where p.establishment_id = ${E} and ach.reason = 'initial'
                                  and ach.changed_at::date <> coalesce(p.entry_date, p.created_at::date))
  ),
  'close_campaign_wall_ms', (select jsonb_object_agg(step, round(ms, 1)) from _timing),
  'closed_year_rpcs_identical_pre_post',
     (select jsonb_object_agg(a.rodeo_k, a.bundle = b.bundle)
        from _kpi a join _kpi b on b.rodeo_k = a.rodeo_k and b.campaign_year = a.campaign_year and b.phase = 'post'
       where a.phase = 'pre' and a.campaign_year = ${closedYear}),
  -- cerrar la campaña anterior NO puede mover la que sigue: se reporta, no se asserta (§9.2 solo exige el par
  -- del año cerrado), pero si sale false hay un acoplamiento que no debería existir.
  'open_year_rpcs_identical_pre_post',
     (select jsonb_object_agg(a.rodeo_k, a.bundle = b.bundle)
        from _kpi a join _kpi b on b.rodeo_k = a.rodeo_k and b.campaign_year = a.campaign_year and b.phase = 'post'
       where a.phase = 'pre' and a.campaign_year = ${openYear}),
  'kpis', (select jsonb_object_agg(k.rodeo_k || '_' || k.campaign_year, k.bundle - 'serviced')
             from _kpi k where k.phase = 'post'),
  'status', (select jsonb_object_agg(r.k || '_' || y.y, to_jsonb(st) - 'closed_by')
               from _rodeo r, (values (${closedYear}), (${openYear})) y(y),
                    lateral public.rodeo_campaign_status(r.id, y.y) st),
  'snapshot_detail_vs_header', (select jsonb_agg(jsonb_build_object(
        'rodeo', r.k, 'year', s.campaign_year, 'closed_incomplete', s.closed_incomplete,
        'header', jsonb_build_object('serviced', s.serviced, 'pregnant', s.pregnant, 'empty', s.empty,
                                     'calved', s.calved, 'weaned', s.weaned),
        'detail', (select jsonb_object_agg(d.bucket, d.n) from (
                     select bucket::text, count(*) n from public.rodeo_campaign_snapshot_animals
                      where snapshot_id = s.id group by bucket) d)))
      from public.rodeo_campaign_snapshots s join _rodeo r on r.id = s.rodeo_id
     where s.reopened_at is null)
)) as report;

${dryRun ? 'rollback;' : 'commit;'}
`;
}

// ---------------------------------------------------------------------------------------------------------
// bootstrap / teardown del establecimiento DESCARTABLE
// ---------------------------------------------------------------------------------------------------------
async function bootstrap() {
  const stamp = Date.now();
  const email = `seed_test_${stamp}@mitropero-test.local`;
  const user = await authAdmin('users', {
    method: 'POST',
    body: JSON.stringify({
      email, password: `SeedTest!${stamp}Aa1`, email_confirm: true,
      user_metadata: { name: `Seed Test ${stamp}` },
    }),
  });
  const estId = randomUUID();
  const name = `${SEED_TEST_MARK} ${stamp}`;
  const sql = `
begin;
insert into public.establishments (id, name, province, city, total_hectares, plan_type)
values (${lit(estId)}, ${lit(name)}, 'Buenos Aires', 'Chascomús', 780, 'beta');
insert into public.user_roles (user_id, establishment_id, role, active)
values (${lit(user.id)}, ${lit(estId)}, 'owner', true);
select ${lit(estId)}::uuid as establishment_id, ${lit(user.id)}::uuid as owner_id, ${lit(email)} as email;
commit;`;
  const { rows } = await runSql(sql, { label: 'bootstrap' });
  console.log(JSON.stringify(rows[0], null, 2));
  console.log(`\nSeguí con:\n  node scripts/seed-facundina.mjs --establishment-id ${estId} --owner-id ${user.id} --expect-profiles 0:0\n`);
}

async function teardown(estId) {
  if (args['i-know'] !== true) fail('--teardown exige --i-know (borra el establecimiento entero).');
  const { rows } = await runSql(`
begin;
do $t$
declare v_name text;
begin
  select name into v_name from public.establishments where id = ${lit(estId)};
  if v_name is null then raise exception 'ABORT teardown: % no existe', ${lit(estId)}; end if;
  if position(${lit(SEED_TEST_MARK)} in v_name) = 0 then
    raise exception 'ABORT teardown: "%" no es un establecimiento de prueba (le falta la marca %)', v_name, ${lit(SEED_TEST_MARK)};
  end if;
end$t$;
create temp table _doomed on commit drop as
  select distinct animal_id from public.animal_profiles where establishment_id = ${lit(estId)};
create temp table _owners on commit drop as
  select distinct user_id from public.user_roles where establishment_id = ${lit(estId)};
delete from public.establishments where id = ${lit(estId)};
delete from public.animals a where a.id in (select animal_id from _doomed)
  and not exists (select 1 from public.animal_profiles p where p.animal_id = a.id);
select (select count(*) from public.animal_profiles where establishment_id = ${lit(estId)}) as profiles_left,
       (select count(*) from public.reproductive_events where establishment_id = ${lit(estId)}) as repro_left,
       (select count(*) from public.rodeos where establishment_id = ${lit(estId)}) as rodeos_left,
       (select count(*) from public.rodeo_campaign_snapshots where establishment_id = ${lit(estId)}) as snapshots_left,
       (select count(*) from public.animals a join _doomed d on d.animal_id = a.id) as animals_left,
       (select count(*) from public.establishments where id = ${lit(estId)}) as est_left,
       (select coalesce(string_agg(user_id::text, ','), '') from _owners) as users;
commit;`, { label: 'teardown' });
  console.log(JSON.stringify(rows[0], null, 2));
  const users = String(rows[0].users || '').split(',').filter(Boolean);
  for (const uid of users) {
    await authAdmin(`users/${uid}`, { method: 'DELETE' });
    console.log(`auth user ${uid} borrado`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------------
async function main() {
  if (args.bootstrap) return bootstrap();

  const est = uuidArg('establishment-id', args['establishment-id']);
  if (args.teardown) return teardown(est);

  const owner = uuidArg('owner-id', args['owner-id']);
  const closedYear = intArg('closed-year', args['closed-year'], 2024);
  const openYear = closedYear + 1;
  const scale = args.scale === undefined ? 1 : Number(args.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 10) fail('--scale fuera de rango (0, 10].');
  const tagBlock = String(args['tag-block'] === undefined ? '700' : args['tag-block']);
  if (!/^\d{3}$/.test(tagBlock)) fail('--tag-block tiene que ser exactamente 3 dígitos.');
  const expectName = typeof args['expect-name'] === 'string' ? args['expect-name'] : null;
  const range = String(args['expect-profiles'] === undefined ? '250:500' : args['expect-profiles']);
  const m = range.match(/^(\d+):(\d+)$/);
  if (!m) fail('--expect-profiles tiene que ser MIN:MAX (ej. 250:500).');
  const [minProfiles, maxProfiles] = [Number(m[1]), Number(m[2])];

  // Si hay algo que destruir, hay que traer el backup y hay que poder abrirlo (RCC.11.9). El único caso
  // exento es el establecimiento vacío, donde no hay nada que respaldar.
  if (maxProfiles > 0) {
    // Si hay algo que destruir, hay que NOMBRAR lo que se destruye. Es el guard contra el id equivocado, y
    // es el que reemplaza al assert tautológico de "cardinalidad 1" de RCC.11.8(a) (ver design §9.3-B).
    if (!expectName) {
      fail('ABORT: --expect-name "<nombre del campo>" es obligatorio cuando el establecimiento tiene datos. '
        + 'Sin él, un uuid mal pegado borra el campo equivocado sin que nada se ponga rojo.');
    }
    const provided = typeof args['require-backup'] === 'string' ? args['require-backup'] : null;
    const toTake = typeof args['backup-to'] === 'string' ? args['backup-to'] : null;
    if (!provided && !toTake) {
      fail('ABORT: hace falta --require-backup <archivo.json> (uno ya tomado) o --backup-to <archivo.json> '
        + '(tomarlo ahora) cuando el establecimiento tiene datos (RCC.11.9). Si el campo está vacío, pasá '
        + '--expect-profiles 0:0.');
    }
    const file = provided || (await takeBackup(toTake, est));
    assertBackup(file, est);
  }

  const sql = buildSeedSql({
    est, owner, closedYear, openYear, expectName, minProfiles, maxProfiles, scale, tagBlock,
    fallbackInvId: randomUUID(), fallbackPriId: randomUUID(), dryRun: args['dry-run'] === true,
  });

  if (typeof args['print-sql'] === 'string') {
    writeFileSync(resolve(repoRoot, args['print-sql']), sql, 'utf8');
    console.log(`SQL escrito en ${args['print-sql']} (${sql.length} chars). No se ejecutó nada.`);
    return;
  }

  console.log(`${args['dry-run'] ? '[DRY-RUN] ' : ''}seed sobre ${est} (cerrada ${closedYear} / en curso ${openYear})…`);
  const { rows, ms } = await runSql(sql, { label: 'seed' });
  console.log(rows[0] && rows[0].report ? rows[0].report : JSON.stringify(rows, null, 2));
  console.log(`\nTransacción completa: ${ms} ms${args['dry-run'] ? ' (ROLLBACK — no se persistió nada)' : ''}`);
}

await main();
