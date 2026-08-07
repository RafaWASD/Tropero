# Spec 07 — Delta CAMPAÑAS CONGELADAS: los reportes cerrados son una foto — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`, y **sigue** `done`) ·
**CON BACKEND** · **Gate 1 OBLIGATORIO** · **Gate 2.5 OBLIGATORIO** ·
**Deploy NO autorizado todavía** — las 4 migraciones (`0127`–`0130`) las aplica el **leader** por Supabase MCP
tras Gate 1 (PASS) + reviewer (APPROVED) + Gate 2 (PASS) + Gate 2.5 (capturas OK) + **OK explícito de Raf**.

**Orden**: verificación del as-built → backend SQL (4 migraciones, en orden de dependencia) → tests no-bypass →
frontend (datos → pura → hook → componente → pantalla → spike) → capture → cierre.
Cada tarea lleva `[ ]` (la marca el implementer) + los `RCC.<n>` que cubre. El reviewer rechaza si queda `[ ]`
sin justificación documentada.

**El implementer NO aplica ninguna migración y NO toca la DB remota.** Escribe los `.sql`; los aplica el leader.

---

## Bloque A — Verificación del as-built (antes de escribir una línea)

- [ ] **T1 — Confirmar la numeración libre.** `ls supabase/migrations/` → verificar que `0126` sigue siendo la
  última y que `0127`–`0130` están libres (hay **otras dos terminales** activas: puede haberse tomado un número
  desde que se escribió esta spec). Si están tomados, correr el bloque completo al siguiente rango libre y
  reconciliar los números en `design-campanas-congeladas.md` §6. Cubre: §6.

- [ ] **T2 — Traer el cuerpo VIGENTE de las 7 funciones desde el REMOTO** (regla
  `reference_function_recreate_base`): `select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on
  n.oid = p.pronamespace where n.nspname='public' and p.proname in ('rodeo_serviced_females',
  'rodeo_repro_denominator','rodeo_pregnancy_kpi','rodeo_calving_kpi','rodeo_ccl_distribution',
  'rodeo_calving_by_stage','rodeo_weaning_kpi')`. Guardar la salida en el scratchpad y **moldear sobre ella**,
  no sobre las migraciones citadas. Recordatorio: el molde de `rodeo_calving_kpi` es **`0117`** y el de
  `rodeo_weaning_kpi` es **`0118`**. Si algún cuerpo difiere de lo que dice `design` §0.1 → **parar y avisar**.
  Cubre: §0.2.

- [ ] **T3 — Verificar los supuestos de schema** que usa el design: `animal_profiles` tiene `entry_date`,
  `exit_date`, `idv`, `status`, `deleted_at`, `created_at`; `animal_category_history` tiene
  `to_category_id`/`changed_at` + índice `(animal_profile_id, changed_at desc)`; el enum de `user_roles.role` es
  `('owner','field_operator','veterinarian')`; `reproductive_events` tiene `created_at`, `heifer_fitness`,
  `pregnancy_status`. Cubre: RCC.1.4, RCC.2.6, RCC.5.3.

## Bloque B — Migración `0127_rodeo_membership_history.sql` (F4 / D3 / DL7 / DL8)

- [ ] **T4 — Enum + tabla.** `create type public.rodeo_membership_reason as enum
  ('backfill','initial','move','reactivation','transfer_in')` + `create table public.rodeo_membership_history`
  con las columnas de `design` §2.1 + el CHECK `to_date is null or to_date >= from_date`. Comentario SQL que
  documente **explícitamente** la semántica **medio-abierta** `[from_date, to_date)`. Cubre: RCC.1.1, RCC.1.2.

- [ ] **T5 — Índices.** `(animal_profile_id, from_date desc)`, `(rodeo_id, from_date, to_date)` y el **único
  parcial** `(animal_profile_id) where to_date is null` (invariante de una sola membresía vigente).
  Cubre: RCC.1.3.

- [ ] **T6 — RLS + grants.** `enable row level security`; policy `for select using
  (has_role_in(establishment_of_profile(animal_profile_id)))` (molde `0030:57-58`); `grant select … to
  authenticated` (**sin** insert/update/delete); `grant all … to service_role`. Cubre: RCC.1.11, RCC.9.9, DP-19.

- [ ] **T7 — Trigger `tg_animal_profiles_record_rodeo_change`** — `SECURITY DEFINER set search_path = public`
  (molde `0030:23-54`), con las 5 ramas de la tabla de `design` §2.1: INSERT (en padrón / fuera de padrón),
  UPDATE de `rodeo_id`, salida del padrón, reingreso. `establishment_id` **derivado de `new.establishment_id`**,
  nunca del cliente. `reason = 'transfer_in'` si `current_setting('rafaq.is_transfer', true) = 'on'`.
  Cubre: RCC.1.4, RCC.1.5, RCC.1.6, RCC.1.7, RCC.1.12, RCC.9.7, RCC.9.10.

- [ ] **T8 — Declarar el trigger** con `after insert or update of rodeo_id, status, deleted_at on
  public.animal_profiles for each row` (dos triggers, ins y upd, como `0030:48-54`). Cubre: RCC.1.4, RCC.1.5.

- [ ] **T9 — Backfill idempotente** (`design` §2.1): una fila por perfil,
  `from_date = coalesce(entry_date, created_at::date)`, `to_date` nulo solo si `status='active' and deleted_at is
  null`, si no `greatest(coalesce(exit_date, current_date), from_date)`; con
  `where not exists (… h.animal_profile_id = p.id)`. Cubre: RCC.1.8.

- [ ] **T10 — Declarar la deuda de DL7** en el `comment on table`: *"el backfill asume que ningún animal se movió
  de rodeo antes del deploy; para los que sí se movieron, la historia previa es falsa. El historial fiel empieza
  en el deploy."* Cubre: RCC.1.9.

- [ ] **T11 — Cerrar la migración**: `notify pgrst, 'reload schema'; commit;` + cabecera
  `🔴 NO se aplica al remoto desde acá` (patrón `0105`/`0118`). **No** agregar nada a `sync-streams/rafaq.yaml`.
  Cubre: RCC.1.10.

## Bloque C — Migración `0128_campaign_snapshots.sql` (② / DL2 / DL4 / F5)

- [ ] **T12 — Helper `is_owner_or_vet_of(est_id uuid)`** — copia **literal** de `is_owner_of` (`0005:31-48`),
  cambiando solo `ur.role = 'owner'` por `ur.role in ('owner','veterinarian')`. `sql security definer stable set
  search_path = public`; `revoke … from public`; `grant … to authenticated`. Cubre: RCC.5.3.

- [ ] **T13 — Helper puro `campaign_tacto_bounds(p_months smallint[], p_year int)`** (`language sql immutable`,
  sin acceso a tablas) que devuelve `(tacto_from, tacto_to)` según DL5, con `coalesce(min(months), 1)` para el
  caso sin meses. `revoke execute … from public, anon, authenticated`. Cubre: RCC.3.1, RCC.3.2, RCC.9.5.

- [ ] **T14 — Helper `animal_category_at(p_profile_id uuid, p_on date)`** (`sql stable set search_path`) con el
  `coalesce(último to_category_id con changed_at::date <= p_on, categoría actual)`.
  `revoke execute … from public, anon, authenticated`. Cubre: RCC.2.6, RCC.2.7, RCC.9.5.

- [ ] **T14-bis — Helpers del predicado de ciclo (F8, dueño único)**: `campaign_cycle_complete(p_weaning_status
  text, p_pending_weaning int, p_state_as_of date) returns boolean` (`sql stable`, cuerpo de `design` §4.1-bis) y
  `campaign_missing_summary(p_calving_status text, p_pending_pregnant int, p_weaning_status text,
  p_pending_weaning int) returns text` (`sql immutable`). **Puras sobre valores**: no tocan tablas ni invocan las
  RPC de KPI. `revoke execute … from public, anon, authenticated`. Comentario SQL que diga que son el **único**
  dueño del predicado y que las consumen `close_campaign` y `rodeo_campaign_status`.
  Cubre: RCC.5.7.c, RCC.7.6, RCC.9.5.

- [ ] **T15 — Tabla `rodeo_campaign_snapshots`** con **todas** las columnas de `design` §2.2 (rastro de cierre y
  reapertura + `closed_incomplete boolean not null default false` + `missing_at_close text` (F8) + parámetros
  congelados `service_months`/`state_as_of`/`tacto_from`/`tacto_to`/`formula_version` + los 21 campos de KPI) +
  CHECK de `campaign_year`. Cubre: RCC.4.1, RCC.4.2, RCC.4.3, RCC.4.11.

- [ ] **T16 — Índice único parcial** `(rodeo_id, campaign_year) where reopened_at is null` + índice
  `(establishment_id, campaign_year desc)`. Cubre: RCC.4.10.

- [ ] **T17 — Enum `campaign_bucket`** `('serviced','pregnant','empty','calved','weaned')` + tabla
  `rodeo_campaign_snapshot_animals` de `design` §2.3, con `animal_profile_id … on delete set null` (**nunca
  cascade**), `idv` congelado, `source`, `pregnancy_status`, `mother_profile_id`/`mother_idv`.
  Cubre: RCC.4.4, RCC.4.6.

- [ ] **T18 — Índices del detalle**: único `(snapshot_id, bucket, animal_profile_id)` (permite el mismo animal en
  varios buckets) + `(snapshot_id, bucket)`. Cubre: RCC.4.5.

- [ ] **T19 — RLS + grants de las 2 tablas de snapshot**: `for select using (has_role_in(establishment_id))`;
  `grant select … to authenticated` (**sin** insert/update/delete); `grant all … to service_role`. Comentario que
  explique **por qué acá sí** se usa la columna denormalizada como frontera (no hay camino de escritura del
  cliente — `design` §2.3). Cubre: RCC.4.8, RCC.9.9, DP-19.

- [ ] **T20 — Smoke-check fail-closed + `notify pgrst` + `commit`** para los 5 helpers (`is_owner_or_vet_of`
  ejecutable por `authenticated`; `campaign_tacto_bounds`, `animal_category_at`, `campaign_cycle_complete` y
  `campaign_missing_summary` **no** ejecutables por `public`/`anon`/`authenticated`). **No** agregar nada a
  `sync-streams/rafaq.yaml`. Cubre: RCC.4.9, RCC.9.5, RCC.9.6.

## Bloque D — Migración `0129_reports_historical_compute.sql` (F1 / F2 / F3 / F3-bis / F4 / F5 / DL3)

- [ ] **T21 — Set-function interna `rodeo_campaign_tacto(p_rodeo_id, p_year)`** (`design` §3.5): guard + cota
  del patrón, ventana vía `campaign_tacto_bounds`, `distinct on` del último tacto **dentro de la ventana**,
  `is_pregnant` con el aborto **acotado a la ventana**, `is_empty`. Cubre: RCC.3.3, RCC.3.4, RCC.3.5.

- [ ] **T22 — Set-function interna `rodeo_campaign_births(p_rodeo_id, p_year)`** → `(animal_profile_id,
  birth_event_id, birth_date, conc_month)`: el `distinct on` por concepción más temprana de `0106:466-476` con la
  condición de set-membership de `0117:84-94`, partiendo de `rodeo_serviced_females`. Cubre: RCC.3.6.

- [ ] **T23 — Set-function interna `rodeo_campaign_calves(p_rodeo_id, p_year)`** → `(mother_profile_id,
  calf_profile_id, is_weaned)`: `rodeo_campaign_births` ⋈ `birth_calves` + `exists(weaning no borrado)`
  (molde `0118:51-83`). Cubre: RCC.3.7.

- [ ] **T24 — `CREATE OR REPLACE rodeo_serviced_females`** con el cómputo histórico de `design` §3.3: guard/cota
  **textuales** de `0105:101-110`, cortocircuito por snapshot, `v_state_as_of` (DL6), `join` de membresía,
  `animal_category_at`, `heifer_fitness` acotado, fallback por edad contra el corte, rama IA con el mismo `join`.
  **Se conserva** `p.deleted_at is null` y `p.establishment_id = v_est`; **se elimina** `p.status = 'active'`.
  Cubre: RCC.2.1, RCC.2.2, RCC.2.3, RCC.2.4, RCC.2.5, RCC.2.6, RCC.2.8, RCC.2.9, RCC.2.10, RCC.2.11, RCC.7.2.

- [ ] **T25 — `CREATE OR REPLACE rodeo_repro_denominator`**: cortocircuito por snapshot + `retired := 0` +
  `entoradas := serviced`, con el comentario de F7 y el puntero a `docs/backlog.md`. Cubre: RCC.2.12, RCC.7.1.

- [ ] **T26 — `CREATE OR REPLACE rodeo_pregnancy_kpi`** (molde `0106:216-269`): cortocircuito por snapshot +
  `pregnant`/`empty` desde `rodeo_campaign_tacto` (se borra la CTE `last_tacto` local). Cubre: RCC.3.5, RCC.7.1.

- [ ] **T27 — `CREATE OR REPLACE rodeo_calving_kpi`** (**molde `0117`, verificado en T2**): cortocircuito +
  `pregnant`/`pending_pregnant` desde `rodeo_campaign_tacto` + `calved`/`pending_pregnant` desde
  `rodeo_campaign_births`. **Las fórmulas de `calved`, `pending_pregnant` y `status` no cambian.**
  Cubre: RCC.3.5, RCC.3.6, RCC.3.8, RCC.7.1.

- [ ] **T28 — `CREATE OR REPLACE rodeo_ccl_distribution`** (molde `0106:358-404`): cortocircuito +
  head/body/tail desde `rodeo_campaign_tacto`; `n_months` congelado cuando hay snapshot. Cubre: RCC.3.5, RCC.4.2, RCC.7.1.

- [ ] **T29 — `CREATE OR REPLACE rodeo_calving_by_stage`** (molde `0106:419-499`): cortocircuito + `births` desde
  `rodeo_campaign_births`. **El bucketing por tercios no cambia.** Cubre: RCC.3.6, RCC.3.8, RCC.7.1.

- [ ] **T30 — `CREATE OR REPLACE rodeo_weaning_kpi`** (**molde `0118`, verificado en T2**): cortocircuito +
  `weaned`/`pending_weaning` desde `rodeo_campaign_calves`. **El `status` data-driven no cambia.**
  Cubre: RCC.3.7, RCC.3.8, RCC.7.1.

- [ ] **T31 — Verificar que ninguna de las 7 cambió su `returns table`** (por eso `CREATE OR REPLACE` y no
  `DROP+CREATE`) y que las 7 siguen `security definer STABLE set search_path = public`. Cubre: RCC.7.5, RCC.9.1.

- [ ] **T32 — Re-`revoke`/`grant` + smoke-check fail-closed** (patrón `0106:706-750`): las 7 públicas revocadas de
  `public`/`anon` y concedidas a `authenticated`; las **3 internas** revocadas también de `authenticated`.
  `notify pgrst, 'reload schema'; commit;`. Cubre: RCC.9.5, RCC.9.6.

- [ ] **T33 — No tocar** `rodeo_service_campaign`, `session_event_summary`, `rodeo_sessions_list`,
  `rodeo_weight_by_category`, `establishment_overdue_doses`, `establishment_unweighed` ni `transfer_animal`.
  Cubre: RCC.12.3, RCC.12.4.

## Bloque E — Migración `0130_campaign_close_rpcs.sql` (D1 / DL1 / DL2 / DL4 / DL9 / DL10 / ①)

- [ ] **T34 — `close_campaign(p_rodeo_id uuid, p_year int, p_acknowledge_incomplete boolean default false)
  returns uuid`** — `security definer` **VOLATILE** (comentario explicando por qué **no** es `STABLE`)
  `set search_path = public`, molde de escritura `0044`/`0116`. Secuencia de `design` §4.2 pasos 1-3: derivar
  tenant (`P0002`), **guard `is_owner_or_vet_of` como primera sentencia ejecutable** (`42501`), cota de `p_year`
  (`22023`). Cubre: RCC.5.1, RCC.5.2, RCC.5.8, RCC.9.2, RCC.9.3, RCC.9.4.

- [ ] **T35 — Guard duro (no reconocible) + idempotencia**: `23514` si `v_state_as_of > current_date`, con un
  mensaje que lo distinga del gate de T36-bis y un comentario explicando por qué `p_acknowledge_incomplete`
  **no** lo sortea (la fecha de corte no ocurrió: no es una foto incompleta, es el presente proyectado al
  futuro). Si ya hay snapshot vigente → devolver su `id` **sin escribir**. Cubre: RCC.5.6, RCC.5.7.

- [ ] **T36 — Computar TODO antes de escribir** (4 temp tables `on commit drop` + 5 `select … into` de las RPC de
  KPI), **después** la cabecera, **después** el detalle. Comentario explicando el orden (si la cabecera se
  insertara primero, las RPC devolverían la foto a medio hacer). Cubre: RCC.5.4, RCC.5.5.

- [ ] **T36-bis — Gate del ciclo incompleto (F8)**, con los KPI ya computados y **antes** de escribir nada:
  `v_complete := campaign_cycle_complete(v_wean.status, v_wean.pending_weaning, v_state_as_of)` y
  `v_missing := campaign_missing_summary(...)`; si `not v_complete and not coalesce(p_acknowledge_incomplete,
  false)` → `raise … using errcode = '23514'` con un mensaje que **interpole `v_missing`** (qué falta, con las
  cantidades). **No** reimplementar el predicado: usar el helper de T14-bis.
  Cubre: RCC.5.7.a, RCC.5.7.b, RCC.5.7.c.

- [ ] **T37 — Insert de la cabecera** con los 21 campos de KPI + `service_months`/`n_months`/`is_configured`
  congelados + `state_as_of`/`tacto_from`/`tacto_to`/`formula_version` + `closed_by = auth.uid()` +
  **`closed_incomplete = not v_complete` y `missing_at_close = case when v_complete then null else v_missing
  end`**, con manejo de `unique_violation` que devuelve el snapshot existente (carrera).
  Cubre: RCC.4.1, RCC.4.2, RCC.4.3, RCC.4.11, RCC.5.7.d, RCC.9.8.

- [ ] **T38 — Cinco `insert … select` del detalle**, uno por bucket, desde las temp tables, con `idv` tomado de
  `animal_profiles` en ese momento (`source` en `serviced`; `pregnancy_status` en `pregnant`;
  `mother_profile_id`/`mother_idv` en `weaned`). Cubre: RCC.4.4, RCC.4.5, RCC.4.6, RCC.4.7.

- [ ] **T39 — `reopen_campaign(p_rodeo_id uuid, p_year int) returns uuid`**: mismo guard y cotas; `null` si ya
  está abierta; `23514` si `(p_rodeo_id, p_year+1)` tiene snapshot vigente; si no,
  `update … set reopened_at = now(), reopened_by = auth.uid()` **sin borrar** la fila ni el detalle.
  Cubre: RCC.6.1, RCC.6.2, RCC.6.3, RCC.6.4, RCC.6.5.

- [ ] **T40 — `rodeo_campaign_status(p_rodeo_id uuid, p_year int)`** — `security definer STABLE`, guard
  `has_role_in` (**no** se endurece: leer lo puede cualquier rol activo), cota de `p_year`. Devuelve las columnas
  de `design` §4.4, incluidos `can_close`/`can_reopen` (derivados de `is_owner_or_vet_of` + las precondiciones),
  `closed_incomplete`, `missing_at_close`, `pending_pregnant`, `pending_weaning`, `missing_summary`,
  `cycle_complete` y `has_new_data`. **`cycle_complete` sale de `campaign_cycle_complete` (T14-bis), no de una
  copia del predicado.** Cubre: RCC.7.3, RCC.7.6, RCC.7.7, RCC.8.3, RCC.10.5, RCC.10.8.

- [ ] **T41 — No agregar ningún trigger que rechace escrituras de una campaña cerrada** (DL10: el dato se acepta).
  Cubre: RCC.8.1, RCC.8.2.

- [ ] **T42 — Grants + smoke-check fail-closed + `notify pgrst` + `commit`**: `revoke … from public, anon` y
  `grant … to authenticated` para las 3 RPC nuevas, **con la firma tipada COMPLETA** — ojo que
  `close_campaign` es `(uuid, int, boolean)`, no `(uuid, int)`: un `revoke`/`grant` con la firma vieja falla con
  `42883` y deja la función con el default de Postgres (`EXECUTE` a `PUBLIC`). El smoke-check acotado a las 3 lo
  atrapa igual, pero la firma tiene que estar bien de entrada. Cubre: RCC.9.5, RCC.9.6.

## Bloque F — Tests no-bypass (`supabase/tests/reports/run.cjs`)

- [ ] **T43 — Helpers de fixture nuevos**: `closeCampaign(client, rodeoId, year)`, `reopenCampaign(...)`,
  `campaignStatus(...)`, `snapshotOf(rodeoId, year)` (vía `admin`), `moveProfileToRodeo(profileId, rodeoId)`,
  `setCategory(profileId, code)`, `seedTacto(...)`, `seedTactoVaquillona(..., 'no_apta')`, y un
  `kpiBundle(client, rodeoId, year)` que devuelve los 5 KPI en un objeto (para comparar de una).
  Cubre: infraestructura de TR.12–TR.20.

- [ ] **T44 — TR.12 inmutabilidad (ORÁCULO CENTRAL)**: reproducir el escenario del probe 1 con `year =
  thisYear()-1`, `service_months={6,7}`, 3 multíparas, 3 tactos preñada `year-09-15`, 1 parto `year+1-03-15`;
  assertar T0 (`serviced 3 / pregnant 3 / empty 0 / calved 1 / ccl total 3 / total_born 1 / pending_weaning 1`);
  `close_campaign`; aplicar **las cuatro** mutaciones (tacto de la campaña siguiente · venta · transferencia de
  rodeo · categoría `cut` + `no_apta` fechado en `year+1`); assertar que `kpiBundle` es **idéntico** a T0, campo
  por campo (`deepStrictEqual`). Cubre: RCC.13.1.

- [ ] **T45 — TR.12b contrafactual del SNAPSHOT**: rodeo gemelo con el mismo escenario **sin cerrar**; aplicar un
  tacto vacío fechado **dentro** de la ventana (`year+1-02-15`); assertar que el gemelo **se mueve**
  (`pregnant 3→2`, `empty 0→1`, `ccl total 3→2`) y que el cerrado, con el mismo tacto, **no**. Comentario en el
  test explicando por qué la mutación tiene que ser un dato **de la campaña** y no una venta.
  Cubre: RCC.13.2.

- [ ] **T46 — TR.12c contrafactual del CÓMPUTO HISTÓRICO**: sobre el gemelo **abierto**, la venta, la
  transferencia y el `no_apta` posteriores al corte **no** mueven ningún KPI. Comentario citando el probe
  (antes movían 7, 6 y hasta `serviced: 0`). Cubre: RCC.13.3.

- [ ] **T47 — TR.13 cómputo histórico antes del cierre**: (a) animal que entra al rodeo **después** del corte →
  no cuenta; (b) animal que sale **antes** del corte → no cuenta; (c) animal vendido/movido después del corte →
  cuenta; (d) `no_apta` posterior al corte → no borra la campaña; (e) fallback por edad al corte (vaquillona con
  400 días hoy pero 200 al corte → **no** cuenta); (f) `p_year` sin nadie presente → `serviced = 0`.
  Cubre: RCC.2.*, RCC.12.6, RCC.13.4.

- [ ] **T48 — TR.14 authz de las 3 RPC nuevas**: owner de B → `42501` en las tres; `field_operator` de A →
  `42501` en `close`/`reopen` y **OK** en `status` + en los 6 KPI; `veterinarian` de A → OK en las tres;
  `22023` con `p_year` fuera de cota; `P0002` con rodeo inexistente; `23514` de precondición de cierre y de
  reapertura bloqueada; `close` dos veces → mismo id y una sola fila. Cubre: RCC.5.2, RCC.5.6, RCC.5.7, RCC.5.8,
  RCC.6.2, RCC.7.3, RCC.9.4, RCC.13.5, RCC.13.9.

- [ ] **T48-bis — TR.14d ciclo incompleto (F8)**: (a) campaña con el servicio terminado pero sin partos →
  `close_campaign` sin ack falla con `23514` **y el mensaje nombra lo que falta** (regex sobre "preñadas sin
  parir" / "crías sin destetar"), y **no se creó ninguna fila** en `rodeo_campaign_snapshots`; (b) la misma
  llamada con `p_acknowledge_incomplete: true` cierra, y el snapshot queda con `closed_incomplete = true` y
  `missing_at_close` no nulo; (c) `rodeo_campaign_status` lo expone; (d) una campaña con el **ciclo completo**
  cierra **sin** ack y queda `closed_incomplete = false`; (e) el `cycle_complete` que devuelve
  `rodeo_campaign_status` coincide con el que usó el gate (mismo escenario, antes y después); (f) **el guard
  duro no es reconocible**: con `state_as_of > current_date`, `ack = true` **igual** falla con `23514`.
  Cubre: RCC.5.7, RCC.5.7.a–d, RCC.4.11, RCC.7.7, RCC.13.9.a, RCC.13.9.b, RCC.13.9.c.

- [ ] **T49 — TR.14b grants**: extender el array de TR.10 con `close_campaign`, `reopen_campaign`,
  `rodeo_campaign_status` (anon no ejecuta); y un bloque nuevo que verifique que **`authenticated` NO ejecuta**
  `rodeo_campaign_tacto`, `rodeo_campaign_births`, `rodeo_campaign_calves`, `animal_category_at`,
  `campaign_tacto_bounds`, `campaign_cycle_complete`, `campaign_missing_summary`. Cubre: RCC.9.5, RCC.13.6.

- [ ] **T50 — TR.14c `close_campaign` no muta datos de negocio**: conteos de `animal_profiles`,
  `reproductive_events` y `weight_events` del establecimiento antes/después del cierre → iguales.
  Cubre: RCC.5.9, RCC.13.12.

- [ ] **T51 — TR.15 membresía**: apertura al insertar (con y sin `entry_date`); mover el rodeo cierra la vigente y
  abre una nueva con `from_date = current_date`; la baja cierra con `to_date = exit_date`; intentar dos filas
  abiertas → `23505`; el backfill corrido dos veces no duplica; owner de B no ve filas de A (RLS);
  `transfer_animal` deja la historia de origen en el campo de origen. Cubre: RCC.1.*, RCC.13.7.

- [ ] **T52 — TR.16 DL10**: tras cerrar, insertar un `tacto` de la campaña → **no falla**; los 5 KPI no se mueven;
  `rodeo_campaign_status.has_new_data === true`; `reopen` + `close` → el KPI **sí** lo incorpora, hay un snapshot
  nuevo y el viejo quedó con `reopened_at`. Cubre: RCC.8.*, RCC.6.5, RCC.13.8.

- [ ] **T53 — TR.17 regresión "tacto sin jornada"**: un `tacto` con `session_id = null` sigue contando en preñez,
  parición y CCL; **guard de clase**: `pg_get_functiondef` de las 7 funciones **no** contiene `session_id`
  (falla en rojo si alguien se lo agrega). Cubre: RCC.12.1, RCC.12.2, RCC.13.11.

- [ ] **T54 — TR.18 denominador**: `entoradas === serviced` y `retired === 0` en todos los escenarios de la suite.
  Cubre: RCC.2.12.

- [ ] **T55 — TR.19 guard de ausencia en PowerSync**: leer `sync-streams/rafaq.yaml` y fallar si menciona
  `rodeo_membership_history`, `rodeo_campaign_snapshots` o `rodeo_campaign_snapshot_animals`.
  Cubre: RCC.1.10, RCC.4.9, RCC.13.10.

- [ ] **T56 — TR.20 consistencia detalle↔cabecera**: por bucket, `count(*)` del detalle == el número congelado;
  con la campaña cerrada, `rodeo_serviced_females` devuelve exactamente `serviced` filas (incluidas las de
  `animal_profile_id` nulo). Cubre: RCC.4.7, RCC.7.2.

- [ ] **T57 — Verificar el `cleanup()`**: las 3 tablas nuevas cascadean por `establishments`; correr la suite dos
  veces seguidas y confirmar que no quedan huérfanos. Cubre: higiene de la suite.

## Bloque G — Frontend

- [ ] **T58 — `app/src/services/reports.ts`**: `ReportError.kind` gana `'conflict'`; `mapRpcError` mapea `23514`;
  tipos `CampaignStatus` (incl. `closedIncomplete`, `missingAtClose`, `pendingPregnant`, `pendingWeaning`) +
  filas snake; `fetchCampaignStatus`, `closeCampaign(rodeoId, year, acknowledgeIncomplete)` **sin default en el
  wrapper** (`design` §7.1: que el compilador obligue a decidir en cada call site), `reopenCampaign`; los dos de
  escritura con el `assertOnline` **antes** de la RPC → DL9 sale de ahí.
  Cubre: RCC.5.1, RCC.5.11, RCC.7.6, RCC.7.7, §5.C.

- [ ] **T59 — `app/src/utils/reports-format.ts`**: `CampaignStateView` (incl. `badge: 'cerrada-a-medias'` y
  `missing: string[]`) + `campaignStateView(status)` puro según la tabla de `design` §7.2; copys en
  **sentence-case**; fechas por `formatDateEsAr`. Cubre: RCC.10.1, RCC.10.2, RCC.10.3, RCC.8.4, RCC.10.5,
  RCC.10.8, RCC.10.11.

- [ ] **T60 — `app/src/utils/reports-format.test.ts`**: casos de `campaignStateView` — en curso sin/con sugerencia,
  cerrada, **cerrada a medias (badge + aviso de qué faltaba)**, cerrada con datos nuevos, **sin permiso pero
  cerrada a medias (el aviso SÍ se muestra, la acción no)**, `missing` con una y con dos entradas,
  `status = null`. Cubre: RCC.10.3, RCC.10.11.

- [ ] **T61 — `app/src/hooks/use-reports.ts`**: `useCampaignStatus(rodeoId, year)` sobre el `useReport` genérico +
  `closeAction(acknowledge)` / `reopenAction` que al terminar OK recargan el status **y** los 6 KPI +
  `closeAllAction(year)` para el masivo, que ejecuta las **dos pasadas** de `design` §4.2 y devuelve
  `{ ok, incomplete: [{rodeoName, missing}], failed }`. Cubre: RCC.7.6, RCC.10.1, RCC.5.10, RCC.5.10.a.

- [ ] **T62 — `app/src/components/reports/CampaignStateBar.tsx`** (+ export en `index.ts`): badge (incl.
  `cerrada-a-medias`) + título + detalle + `InfoNote` de aviso + botón de acción, todo derivado de
  `campaignStateView`. El aviso de "cerrada a medias" se renderiza **también sin permiso de reapertura** (es
  información del reporte, no una acción). Tokens, es-AR, `lineHeight` matcheado en todo texto con descendentes.
  Cubre: RCC.10.1, RCC.10.2, RCC.10.9, RCC.10.11.

- [ ] **T63 — `app/app/(tabs)/reportes.tsx`**: montar `CampaignStateBar` **entre** el `YearStepper` y el
  `ReportSectionHeader` de Reproductivo; sumar el estado al `hint` de la sección; pasar
  `campaign.serviceMonths ?? selectedRodeo?.serviceMonths` al `CclBlock`; recargar `campaign` en el
  `useFocusEffect`. **⚠ NO tocar el `Shell` ni el header** (colisión con el `useStickStatusSurface('screen-band')`
  sin commitear de otra terminal — `design` §7.3/§14); si hay conflicto, **parar y avisar al leader**.
  Cubre: RCC.10.4, RCC.10.10.

- [ ] **T64 — Confirmación de cierre**: reusar `BulkConfirmSheet` con el copy de `design` §7.3 (qué rodeo, qué
  campaña, que se puede reabrir mientras no cierre la siguiente). Con `cycleComplete === true`, es **un solo
  toque**. Cubre: RCC.10.7, RCC.10.7.b.

- [ ] **T64-bis — Confirmación reforzada con el ciclo incompleto (F8)**: con `cycleComplete === false`, la hoja
  **enumera `view.missing`** en una lista y agrega una segunda acción explícita, visualmente separada de la
  primaria ("Cerrar igual con estos datos incompletos"). El primer intento manda `acknowledgeIncomplete: false`;
  solo si vuelve `kind: 'conflict'` se habilita la segunda acción, que manda `true`. Distinguir el caso **no
  reconocible** (`canClose === false` → servicio sin terminar) del reconocible por
  `rodeo_campaign_status`, **no** parseando el texto del error (`design` §5.C).
  Cubre: RCC.10.7.a, RCC.5.7, RCC.5.7.a, RCC.5.7.b.

- [ ] **T65 — Cierre masivo por campo (DL1, RCC.10.6 — DENTRO de este delta)**: acción secundaria en la misma
  hoja que itera los rodeos del `RodeoContext` en **dos pasadas** (primera sin ack; los rechazados por ciclo
  incompleto se listan con lo que les falta; segunda pasada con ack **acotada a esos**) y reporta
  `{ ok, incomplete[], failed[] }`. **No** se crea ninguna RPC de establecimiento (DP-11).
  Cubre: RCC.5.10, RCC.5.10.a, RCC.10.6.

- [ ] **T66 — `app/app/reportes-spike.tsx`**: variantes `campana-en-curso`, `campana-sugerencia`,
  `campana-cerrada`, `campana-cerrada-a-medias`, `campana-datos-nuevos`, `campana-confirmacion`,
  `campana-confirmacion-incompleta`, `campana-cierre-masivo`, `campana-sin-permiso` (mock, sin backend) +
  extender `SpikeVariant` y el switch. Cubre: RCC.14.1.

## Bloque H — Gate 2.5 (ADR-029)

- [ ] **T67 — `app/e2e/captures/campanas-congeladas.capture.ts`** (molde `destete-kpi.capture.ts`): las **9**
  capturas nombradas de `design` §10 a 412×915 + `assertTextNotClipped` sobre "Campaña cerrada", "Campaña cerrada
  a medias", "Cerrar campaña", "Reabrir campaña", "Cerrar igual con estos datos incompletos" y "Hay datos nuevos
  sin reflejar en la foto". Salida en `app/e2e/captures/__shots__/campanas-congeladas/` (gitignored).
  Cubre: RCC.14.1, RCC.14.2.

- [ ] **T68 — Correr el capture** con `playwright.capture.config.ts` y **vetar** (design-review del leader) antes
  de mostrarle nada a Raf; revertir `design/**` si el build re-renderizó PNGs
  (`reference_e2e_design_png_rerender`). **[LEADER — Gate 2.5]**. Cubre: RCC.14.1.

## Bloque I — Cierre

- [ ] **T69 — Autorrevisión adversarial del implementer** (paso 8 de su protocolo) + `progress/impl_campanas-
  congeladas.md` con el mapa `RCC.<n> → archivo:test`. Foco de la autorrevisión: (a) ¿el cortocircuito por
  snapshot está **después** del guard y de la cota en las 7?; (b) ¿`close_campaign` computa **antes** de
  insertar, y el gate de F8 corre **antes** de la primera escritura?; (c) ¿queda alguna copia de la CTE
  `last_tacto`, de la ventana de concepción **o del predicado de ciclo completo** sin migrar a su dueño único?;
  (d) ¿alguna función nueva quedó `STABLE` siendo de escritura, o sin `set search_path`?; (e) ¿el `revoke`/`grant`
  de `close_campaign` usa la firma `(uuid, int, boolean)`?; (f) ¿algún call site de `closeCampaign` en el
  frontend manda `true` sin una confirmación explícita del usuario detrás? Cubre: trazabilidad.

- [ ] **T70 — `node scripts/check.mjs`** verde (con la suite de reportes **roja-hasta-apply** documentada como
  esperada) + typecheck + unit del frontend. **No** correr `pnpm e2e` completo (38 min) salvo pedido del leader.
  Cubre: higiene.

- [ ] **T71 — Reconciliación de specs**: si Gate 1 / reviewer / Gate 2 / Gate 2.5 cambian algo, reflejarlo en
  `{requirements,design,tasks}-campanas-congeladas.md` **antes** de commitear (regla
  `feedback_correcciones_en_specs`), incluyendo una fila nueva en "Historial de refinamiento" de
  `requirements-campanas-congeladas.md`. Cubre: `docs/specs.md` §Reconciliación.

- [ ] **T72 — [LEADER] Gate 1**: `security_analyzer` modo `spec` sobre `design` §5, auditado contra la cabecera
  §5.1–§5.10 de `0106` + los W1–W12 de escritura. Output en
  `progress/security_spec_07-campanas-congeladas.md`. **Bloqueante.** Cubre: RCC.9.*.

- [ ] **T73 — [LEADER] Deploy**: pedir el OK de Raf y aplicar `0127` → `0128` → `0129` → `0130` **en ese orden**
  por Supabase MCP; correr `supabase/tests/reports/run.cjs` verde post-apply (TR.1–TR.20) y `node
  scripts/check.mjs` verde. Si algo falla entre migraciones, **no** seguir con la siguiente. Cubre: §6.

- [ ] **T74 — [LEADER] Re-seed de "La Facundina" (D2)** — solo después de T73 y con el punto DP-22 confirmado por
  Raf: backup (`node scripts/backup-db.mjs`) → borrado acotado a
  `establishment_id = 'fac00000-face-4000-a000-000000000010'` (sin tocar "Santo Domingo") → re-seed con
  `entry_date` explícito y `animal_category_history.changed_at` retrodatado → `close_campaign` de la campaña
  completa **con la identidad del owner** (`set local request.jwt.claims`) → verificación de que los KPI
  congelados coinciden con los de la lectura en vivo previa y de que la campaña posterior queda en curso.
  **El cierre del re-seed debe salir con `p_acknowledge_incomplete = false` y el snapshot quedar con
  `closed_incomplete = false`**: si el cierre pide reconocimiento, el seed está mal (la campaña elegida no tiene
  el ciclo completo) y hay que corregir las fechas, **no** reconocer. Es el oráculo más barato de que DP-22 está
  bien resuelto. Cubre: RCC.11.*, RCC.5.7.b.

- [ ] **T75 — [LEADER] Fold al baseline (ADR-028)**, al aprobar la Puerta 2: entrada nueva en la tabla "Deltas
  posteriores" de `specs/active/07-reportes-basicos/design.md` + nota as-built bajo `R7.5`/`R7.6`/`R7.7`/`R7.8`
  de `requirements.md` baseline apuntando a este delta. **El `tasks.md` baseline no se toca.** Cubre: ADR-028.

- [ ] **T76 — [LEADER] Backlog**: anotar en `docs/backlog.md` (a) que `entoradas = servidas − retiradas` quedó
  formalmente en `retired = 0` y por qué, y (b) que `transfer_animal` re-apunta `animal_category_history` al
  campo destino y deja al perfil de origen sin categoría histórica. Cubre: RCC.2.12, `design` §13.
</content>
