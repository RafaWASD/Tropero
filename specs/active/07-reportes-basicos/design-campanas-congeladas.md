# Spec 07 — Delta CAMPAÑAS CONGELADAS: los reportes cerrados son una foto — Design

> Cómo se construye `requirements-campanas-congeladas.md`. Delta **Nivel B (ADR-028)** sobre spec 07 (`done`).
> El baseline (`requirements.md` / `design.md` / `tasks.md`) y los deltas `paricion-fix` / `destete-kpi`
> **no se tocan**. Al cerrar la Puerta 2 se folda el puntero + la entrada en "Deltas posteriores" del baseline.
>
> **Gate 1 OBLIGATORIO** (3 tablas nuevas + RLS + 2 RPC `SECURITY DEFINER` de **escritura**). La §5 de este
> documento es la que audita el `security_analyzer` contra la cabecera §5.1–§5.10 de `0106`.
> **Gate 2.5** (ADR-029) con capture de los dos estados de la pantalla.
> **Deploy NO autorizado**: las 4 migraciones las aplica el **leader** tras Gate 1 + reviewer + Gate 2 + Gate 2.5 +
> autorización explícita de Raf en sesión.

---

## §0 — As-built vigente (leído, no supuesto)

### §0.1 — Lo que existe hoy

| Objeto | Migración **vigente** | Qué es |
|---|---|---|
| `rodeos.service_months smallint[]` | `0102` | NULL = sin configurar; `{}` = no hace servicio; CHECK vía `service_months_is_valid`. |
| `rodeo_service_campaign(uuid,int)` | `0105` | `is_configured, n_months, months, window_start, window_end`. **No se toca.** |
| `rodeo_serviced_females(uuid,int)` | `0105` | El conjunto SERVIDAS. **Núcleo del defecto** (`0105:119-144`). |
| `rodeo_repro_denominator(uuid,int)` | `0105` | `serviced, retired, entoradas` (`0105:207-210`). |
| `rodeo_pregnancy_kpi(uuid,int)` | `0106` | `is_configured, serviced, entoradas, pregnant, empty`. |
| `rodeo_calving_kpi(uuid,int)` | **`0117`** | `+ status, pending_pregnant`. **El molde es 0117, no 0106.** |
| `rodeo_ccl_distribution(uuid,int)` | `0106` | `n_months, head, body, tail, total`. |
| `rodeo_calving_by_stage(uuid,int)` | `0106` | `n_months, head_born, body_born, tail_born, total_born`. |
| `rodeo_weaning_kpi(uuid,int)` | **`0118`** | `is_configured, serviced, weaned, pending_weaning, status`. |
| `animal_category_history` | `0030` | `from_category_id/to_category_id/changed_at/reason` + trigger. **Molde de tabla-con-historia.** |
| `animal_profiles` | `0020` (+ `0122` dropea `visual_id_alt`) | `entry_date`, `exit_date`, `exit_reason`, `status`, `rodeo_id`, `idv`, `deleted_at`. |
| `has_role_in` / `is_owner_of` | `0005` | Helpers de RLS. `is_owner_or_vet_of` **no existe** (punto ①). |
| `exit_animal_profile` | `0044` | Molde de RPC de escritura con guard `has_role_in && (is_owner_of || creador)`. |
| `register_birth` | `0116` | Molde de RPC de escritura `SECURITY DEFINER`. |
| `transfer_animal` | `0087` | Re-apunta la historia (incl. `animal_category_history`) al perfil destino. **No se toca.** |
| `supabase/tests/reports/run.cjs` | — | TR.1–TR.11 + TR.10 transversal (grants/read-only/tenant). |
| `app/src/services/reports.ts` | — | 10 wrappers online-only. **Hoy es read-only: este delta le agrega 2 escrituras.** |
| `app/app/(tabs)/reportes.tsx` | — | `YearStepper`, `ReproSection`, `useRodeoKpis`, `defaultCampaignYear`. |

Verificado con `grep` sobre `supabase/migrations/*.sql`: **ninguna migración posterior** re-crea
`rodeo_serviced_females`, `rodeo_repro_denominator`, `rodeo_pregnancy_kpi`, `rodeo_ccl_distribution`,
`rodeo_calving_by_stage` ni `rodeo_service_campaign`. `rodeo_calving_kpi` la re-crea `0117`;
`rodeo_weaning_kpi` la crea `0118`.

### §0.2 — Regla `reference_function_recreate_base` (obligatoria, por función)

> Antes de un `CREATE OR REPLACE` de una función existente, el molde es su **cuerpo vigente en el remoto**, que
> puede venir de una migración posterior a la que cita la spec. El implementer **verifica con
> `pg_get_functiondef` contra DEV** y moldea sobre lo que ve, no sobre lo que dice este documento.

| Función | Base a copiar | Verificación previa obligatoria |
|---|---|---|
| `rodeo_serviced_females` | `0105:95-170` | `select pg_get_functiondef('public.rodeo_serviced_females(uuid,int)'::regprocedure)` |
| `rodeo_repro_denominator` | `0105:190-213` | ídem con su firma |
| `rodeo_pregnancy_kpi` | `0106:216-269` | ídem |
| `rodeo_calving_kpi` | **`0117:31-153`** (NO `0106`) | ídem |
| `rodeo_ccl_distribution` | `0106:358-404` | ídem |
| `rodeo_calving_by_stage` | `0106:419-499` | ídem |
| `rodeo_weaning_kpi` | **`0118:17-102`** | ídem |

Si el cuerpo del remoto difiere del de la migración citada, **se para y se avisa** (jerarquía de verdad:
el remoto es el as-built).

### §0.3 — Hallazgos del `spec_author` sobre el inventario del context

- **H1 — son 7 funciones, no 6.** El context (§Alcance 4) y ADR-032 (§1.3) dicen "las 6 RPC parametrizadas por
  `p_year`" pero enumeran **siete**: `rodeo_serviced_females`, `rodeo_repro_denominator`, `rodeo_pregnancy_kpi`,
  `rodeo_calving_kpi`, `rodeo_ccl_distribution`, `rodeo_calving_by_stage`, `rodeo_weaning_kpi`. La lista enumerada
  es la autoritativa; el conteo estaba mal. (`rodeo_service_campaign` también recibe `p_year` pero solo deriva
  configuración del rodeo, no estado de animales → no necesita reescritura histórica.)
- **F5 — `service_months` es mutable y se cuela en el KPI.** `is_configured` y `n_months` salen de
  `rodeo_service_campaign`, que lee la columna **de hoy**. Si el productor edita la estación después de cerrar,
  una campaña cerrada cambiaría de `n_months` → el CCL cambiaría de número de barras. Es una quinta fuga, más
  chica, y se tapa congelando `service_months`/`n_months`/`is_configured` en el snapshot (RCC.4.2) y usando los
  congelados en la UI (RCC.10.4).
- **F3-bis — el fallback por edad usa `current_date`** (`0105:141`). Una vaquillona que hoy tiene ≥365 días entra
  como servida en campañas de hace cinco años. Misma familia que F3; se corrige evaluando contra la fecha de corte.
- **F7 — `retired` queda estructuralmente en 0.** Con el conjunto servidas evaluado a la fecha de corte, "del
  conjunto servidas, las que ya no están" solo puede referirse a bajas **posteriores** al corte, que no son
  retiradas de la campaña. Se devuelve `retired = 0` explícito y `entoradas = serviced`; la redefinición real de
  *entoradas* queda en `docs/backlog.md` (ya anotada, ADR-032 §fuera de alcance).

---

## §1 — Archivos a crear / modificar

### Backend (SQL — las aplica el leader tras Gate 1/2/2.5 + OK de Raf)

| Archivo | Qué |
|---|---|
| `supabase/migrations/0127_rodeo_membership_history.sql` | **NUEVO.** Enum `rodeo_membership_reason` + tabla `rodeo_membership_history` + índices + RLS + grants + trigger `tg_animal_profiles_record_rodeo_change` + backfill idempotente. |
| `supabase/migrations/0128_campaign_snapshots.sql` | **NUEVO.** Enum `campaign_bucket` + tablas `rodeo_campaign_snapshots` (incl. `closed_incomplete`/`missing_at_close`, F8) y `rodeo_campaign_snapshot_animals` + índices + RLS + grants; helpers `is_owner_or_vet_of`, `animal_category_at`, `campaign_tacto_bounds`, `campaign_cycle_complete`, `campaign_missing_summary`. |
| `supabase/migrations/0129_reports_historical_compute.sql` | **NUEVO.** Set-functions internas `rodeo_campaign_tacto` / `rodeo_campaign_births` / `rodeo_campaign_calves` + `CREATE OR REPLACE` de las **7** funciones de campaña (cómputo histórico + cortocircuito por snapshot) + re-`revoke`/`grant` + smoke-check. |
| `supabase/migrations/0130_campaign_close_rpcs.sql` | **NUEVO.** `close_campaign`, `reopen_campaign` (escritura) y `rodeo_campaign_status` (lectura) + grants + smoke-check. |

### Backend (tests)

| Archivo | Qué |
|---|---|
| `supabase/tests/reports/run.cjs` | **MODIFICAR.** TR.12 (inmutabilidad + los dos contrafactuales), TR.13 (cómputo histórico), TR.14 (authz/grants de lo nuevo), TR.15 (membresía), TR.16 (DL10), TR.17 (regresión tacto sin jornada + guard `session_id`), TR.18 (`entoradas == serviced`), TR.19 (guard de ausencia en `sync-streams/mitropero.yaml`). Extender TR.10 con las funciones nuevas. |

### Frontend

| Archivo | Qué |
|---|---|
| `app/src/services/reports.ts` | **MODIFICAR.** `fetchCampaignStatus`, `closeCampaign`, `reopenCampaign` + tipos + mapeo de `23514` a `conflict`. |
| `app/src/utils/reports-format.ts` | **MODIFICAR.** `campaignStateView(status)` puro + copys. |
| `app/src/utils/reports-format.test.ts` | **MODIFICAR.** Casos de `campaignStateView`. |
| `app/src/hooks/use-reports.ts` | **MODIFICAR.** `useCampaignStatus(rodeoId, year)` + acciones `close`/`reopen` con recarga. |
| `app/src/components/reports/CampaignStateBar.tsx` | **NUEVO.** Barra de estado de campaña (en curso / cerrada + fecha / datos nuevos) + acciones. |
| `app/src/components/reports/index.ts` | **MODIFICAR.** Export del componente nuevo. |
| `app/app/(tabs)/reportes.tsx` | **MODIFICAR.** Montar `CampaignStateBar` bajo el `YearStepper`; pasar los `service_months` congelados al `CclBlock`; confirmación de cierre; cierre masivo por campo. ⚠ **colisión** — ver §12. |
| `app/app/reportes-spike.tsx` | **MODIFICAR.** Variantes mock `campana-en-curso`, `campana-cerrada`, `campana-datos-nuevos`, `campana-sugerencia`, `campana-confirmacion`. |
| `app/e2e/captures/campanas-congeladas.capture.ts` | **NUEVO.** Gate 2.5. |

### Documentación

| Archivo | Qué |
|---|---|
| `docs/backlog.md` | **MODIFICAR** (al cerrar): nota de que `entoradas = servidas − retiradas` queda formalmente en 0 y por qué. |

---

## §2 — Modelo de datos

### §2.1 — `rodeo_membership_history` (F4 / D3) — molde: `animal_category_history` (`0030`)

```sql
create type public.rodeo_membership_reason as enum
  ('backfill','initial','move','reactivation','transfer_in');

create table public.rodeo_membership_history (
  id                uuid primary key default gen_random_uuid(),
  animal_profile_id uuid not null references public.animal_profiles(id) on delete cascade,
  rodeo_id          uuid not null references public.rodeos(id),
  establishment_id  uuid not null references public.establishments(id) on delete cascade, -- denorm ADR-026
  from_date         date not null,
  to_date           date,          -- NULL = vigente. INTERVALO MEDIO-ABIERTO [from_date, to_date)
  reason            public.rodeo_membership_reason not null,
  changed_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  constraint rodeo_membership_history_range_ck check (to_date is null or to_date >= from_date)
);

create index rodeo_membership_history_by_profile
  on public.rodeo_membership_history (animal_profile_id, from_date desc);
-- el predicado del reporte: "perfiles del rodeo R vigentes en la fecha D"
create index rodeo_membership_history_by_rodeo_date
  on public.rodeo_membership_history (rodeo_id, from_date, to_date);
-- INVARIANTE (RCC.1.3): a lo sumo una membresía vigente por perfil
create unique index rodeo_membership_history_one_open
  on public.rodeo_membership_history (animal_profile_id) where to_date is null;

alter table public.rodeo_membership_history enable row level security;
create policy rodeo_membership_history_select on public.rodeo_membership_history
  for select using (has_role_in(establishment_of_profile(animal_profile_id)));
grant select on public.rodeo_membership_history to authenticated;   -- SIN insert/update/delete
grant all    on public.rodeo_membership_history to service_role;
```

**Por qué medio-abierto `[from_date, to_date)`.** Con intervalos inclusivos, un movimiento el mismo día deja al
animal simultáneamente en dos rodeos ese día: si la fecha de corte cae justo ahí, la vaca cuenta en **dos**
campañas. Medio-abierto lo hace imposible por construcción (`to_date` = primer día en que ya **no** está), y un
alta+movimiento el mismo día produce un intervalo vacío `[hoy, hoy)` que nunca matchea — que es lo correcto.

**Por qué la RLS usa `establishment_of_profile(...)` y no la columna denormalizada.** ADR-026 dice explícitamente
que la RLS as-built de las tablas hijas **no cambia**: sigue derivando el tenant por la cadena de FK; la columna
denormalizada existe para el wire de sync y la localidad de índice. Y §5.5 de `0106` prohíbe scopear por la
columna denormalizada de las tablas hijas. Se respetan ambas. (La tabla igual **no** entra a PowerSync — DL8 — así
que la denormalización acá es puramente conformidad de convención + un `establishment_id` a mano para diagnóstico.)

**Trigger** `tg_animal_profiles_record_rodeo_change()` — `SECURITY DEFINER set search_path = public`, molde exacto
de `tg_animal_profiles_record_category_change` (`0030:23-54`):

```sql
after insert on public.animal_profiles                              -- abre la membresía inicial
after update of rodeo_id, status, deleted_at on public.animal_profiles
```

Ramas (todas con `is distinct from`, así que un `update of` que no cambia nada no escribe):

| Disparo | Acción | `reason` |
|---|---|---|
| INSERT, perfil en padrón | insert `[coalesce(entry_date, created_at::date), NULL)` | `initial` (o `transfer_in` si `current_setting('mitropero.is_transfer', true) = 'on'`) |
| INSERT, perfil ya fuera del padrón | insert `[from, greatest(coalesce(exit_date, current_date), from))` | ídem |
| UPDATE `rodeo_id` cambia, sigue en padrón | cierra la vigente con `to_date = current_date`; abre `[current_date, NULL)` | `move` |
| UPDATE sale del padrón | cierra la vigente con `to_date = greatest(coalesce(new.exit_date, current_date), from_date)` | — |
| UPDATE vuelve al padrón sin fila vigente | abre `[current_date, NULL)` | `reactivation` |

> **RECONCILIACIÓN (rebrand miTropero, fase 4 — migración `0132`, 2026-08-17).** La GUC de la primera
> fila se llamaba `rafaq.is_transfer` y hoy se llama **`mitropero.is_transfer`**. `0132` re-emitió
> `tg_animal_profiles_record_rodeo_change` (y las otras 5 funciones que nombran una GUC) en una sola
> transacción; `0127` conserva el nombre viejo por append-only.
>
> ⚠️ **La rama `transfer_in` de esta tabla no se dispara hoy, y no es por el rename.** En el cuerpo
> vigente de `transfer_animal` (`0122`), el `set_config('…is_transfer','on',true)` está **después** del
> `insert into animal_profiles` del perfil destino y se apaga inmediatamente después del UPDATE de
> `animal_events`. El trigger `animal_profiles_record_rodeo_change_ins` es `AFTER INSERT` (no
> deferrable), así que corre con la GUC todavía apagada → el alta del perfil destino se registra como
> `initial`, nunca como `transfer_in`. Coincide con lo que ya marcó `progress/review_campanas-congeladas.md`
> (RCC.1.13: la rama `transfer_in` no la ejercita ningún test). **La fase 4 no lo tocó a propósito**: es
> un rename puro y arreglarlo cambiaría comportamiento. Queda como hallazgo abierto.

**El trigger captura el upload de PowerSync**: `moveAnimalToRodeo` (`app/src/services/animals.ts:1683`) es un
UPDATE plano de `rodeo_id` que sube por la cola de CRUD → dispara el trigger igual que cualquier UPDATE. No hace
falta tocar el cliente. **Limitación honesta**: la fecha registrada es la del *upload*, no la del hecho en el
campo; un movimiento cargado offline y subido tres días después queda fechado el día de la subida.

**`transfer_animal` (`0087`) no se toca** y **no** re-apunta esta tabla (RCC.1.13). El RPC archiva el perfil de
origen (→ el trigger cierra su membresía en X) y crea el perfil destino (→ el trigger abre la membresía en Y).
Si en cambio se re-apuntaran las filas como hace con `animal_category_history`, el campo destino heredaría la
historia de rodeo del campo origen — exactamente la fuga F4 elevada a escala de establecimiento. **Queda escrito
acá porque el próximo que lea `0087` va a querer "arreglar" la asimetría.**

**Backfill (DL7, refinado en RCC.1.8)** — una fila por perfil, `to_date` nulo solo para los activos:

```sql
insert into public.rodeo_membership_history
  (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
select p.id, p.rodeo_id, p.establishment_id,
       coalesce(p.entry_date, p.created_at::date) as from_date,
       case when p.status = 'active' and p.deleted_at is null then null
            else greatest(coalesce(p.exit_date, current_date),
                          coalesce(p.entry_date, p.created_at::date)) end,
       'backfill', null
from public.animal_profiles p
where not exists (select 1 from public.rodeo_membership_history h
                  where h.animal_profile_id = p.id);
```

> **Deuda declarada (RCC.1.9)**: el backfill **asume que ningún animal se movió de rodeo**. Para los que sí se
> movieron, la historia sembrada es falsa. Va en el `comment on table`, no solo acá.

### §2.2 — `rodeo_campaign_snapshots` (cabecera) — DL2 / DL4 / F5

```sql
create table public.rodeo_campaign_snapshots (
  id                uuid primary key default gen_random_uuid(),
  rodeo_id          uuid not null references public.rodeos(id) on delete cascade,
  campaign_year     int  not null,
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  -- rastro del cierre / reapertura (D1, DL4)
  closed_at         timestamptz not null default now(),
  closed_by         uuid references public.users(id) on delete set null,
  reopened_at       timestamptz,
  reopened_by       uuid references public.users(id) on delete set null,
  -- F8: ¿se cerró con el ciclo INCOMPLETO (reconocido a propósito)? y qué faltaba en ese momento.
  -- El detalle numérico ya vive en pending_pregnant / pending_weaning / calving_status / weaning_status;
  -- `missing_at_close` guarda el descriptor legible para que un lector de dentro de tres años no lo re-derive.
  closed_incomplete boolean not null default false,
  missing_at_close  text,
  -- parámetros del cómputo, congelados (auditoría + F5)
  service_months    smallint[],
  state_as_of       date,          -- DL6: fecha de corte del estado histórico
  tacto_from        date,          -- DL5
  tacto_to          date,          -- DL5
  formula_version   smallint not null default 1,
  -- los 5 KPI congelados (unión de los returns de las 5 RPC)
  is_configured     boolean not null,
  n_months          int not null,
  serviced          int not null,
  retired           int not null,
  entoradas         int not null,
  pregnant          int not null,
  empty             int not null,
  calved            int not null,
  pending_pregnant  int not null,
  calving_status    text not null,
  ccl_head          int not null,
  ccl_body          int not null,
  ccl_tail          int not null,
  ccl_total         int not null,
  born_head         int not null,
  born_body         int not null,
  born_tail         int not null,
  born_total        int not null,
  weaned            int not null,
  pending_weaning   int not null,
  weaning_status    text not null,
  created_at        timestamptz not null default now(),
  constraint rodeo_campaign_snapshots_year_ck check (campaign_year between 1900 and 2400)
);

-- RCC.4.10: a lo sumo UN snapshot vigente por (rodeo, campaña). Los reabiertos quedan como historia.
create unique index rodeo_campaign_snapshots_active
  on public.rodeo_campaign_snapshots (rodeo_id, campaign_year) where reopened_at is null;
create index rodeo_campaign_snapshots_by_est
  on public.rodeo_campaign_snapshots (establishment_id, campaign_year desc);
-- RCC.4.8.b: destino de la FK compuesta del detalle → el tenant de padre e hijo NO puede divergir.
alter table public.rodeo_campaign_snapshots
  add constraint rodeo_campaign_snapshots_id_est_uq unique (id, establishment_id);
```

**Procedencia del `establishment_id` (RCC.4.8.a)**: sale de `v_est`, el mismo valor que derivó el guard de la
fila de `rodeos`. Nunca del cliente (no hay grant de escritura) ni de ninguna otra fila.

`formula_version` es el registro de con qué generación de fórmulas se computó la foto (las fórmulas ya cambiaron
dos veces: `0117` y `0118`). Sirve para explicar una discrepancia futura sin adivinar.

`calving_status` / `weaning_status` se guardan como `text` (no enum): son valores de dominio que ya viajan como
`text` en el `returns table` de `0117`/`0118`, y un snapshot no puede quedar atado a un enum que puede evolucionar.

### §2.3 — `rodeo_campaign_snapshot_animals` (detalle por animal) — punto ②

```sql
create type public.campaign_bucket as enum ('serviced','pregnant','empty','calved','weaned');

create table public.rodeo_campaign_snapshot_animals (
  id                uuid primary key default gen_random_uuid(),
  snapshot_id       uuid not null references public.rodeo_campaign_snapshots(id) on delete cascade,
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  -- RCC.4.8.b — el tenant del detalle NO puede divergir del de su cabecera. No es una promesa: es una FK.
  constraint rodeo_campaign_snapshot_animals_est_fk
    foreign key (snapshot_id, establishment_id)
    references public.rodeo_campaign_snapshots (id, establishment_id) on delete cascade,
  bucket            public.campaign_bucket not null,
  -- ② el detalle SOBREVIVE a la baja del animal: nunca `on delete cascade`.
  animal_profile_id uuid references public.animal_profiles(id) on delete set null,
  idv               text,     -- identificador legible CONGELADO al cierre
  source            text,     -- 'natural' | 'ai'      (solo bucket='serviced')
  pregnancy_status  text,     -- 'large'|'medium'|'small' (solo bucket='pregnant')
  mother_profile_id uuid references public.animal_profiles(id) on delete set null, -- solo bucket='weaned'
  mother_idv        text,
  created_at        timestamptz not null default now()
);

create unique index rodeo_campaign_snapshot_animals_unique
  on public.rodeo_campaign_snapshot_animals (snapshot_id, bucket, animal_profile_id);
create index rodeo_campaign_snapshot_animals_by_bucket
  on public.rodeo_campaign_snapshot_animals (snapshot_id, bucket);
```

**RLS de las dos tablas de snapshot** (distinta de la de membresía, y con motivo):

```sql
create policy rodeo_campaign_snapshots_select on public.rodeo_campaign_snapshots
  for select using (has_role_in(establishment_id));
create policy rodeo_campaign_snapshot_animals_select on public.rodeo_campaign_snapshot_animals
  for select using (has_role_in(establishment_id));
grant select on public.rodeo_campaign_snapshots        to authenticated;  -- SIN insert/update/delete
grant select on public.rodeo_campaign_snapshot_animals to authenticated;
```

Acá **sí** se scopea por la columna denormalizada, y la diferencia con §2.1 es deliberada: estas dos tablas
**no tienen ningún camino de escritura desde el cliente** (no hay grant de `insert`/`update`/`delete`, y la única
escritura es `close_campaign`, `SECURITY DEFINER`, que deriva el `establishment_id` de la fila del rodeo). El
valor no es spoofeable, así que puede ser la frontera de autorización. En `rodeo_membership_history` la fila la
escribe un trigger sobre una tabla que **sí** es escribible por el cliente, y por eso ahí se conserva la cadena
de FK canónica (§5.5 de `0106`).

> **Desvío declarado de ADR-026** (Gate 1 H-2). ADR-026 dice que la columna denormalizada es *"solo para el
> stream"* y que la RLS sigue derivando el tenant por la cadena de FK. Acá la columna **no tiene** propósito de
> stream (DL8/RCC.4.9: estas tablas no sincronizan) y **sí** es la frontera de RLS: es la inversión exacta de esa
> consecuencia, y se declara como desvío en vez de citarse ADR-026 como si lo autorizara.
> **Invariante que lo sostiene**: *no existe ningún `grant` de escritura a `authenticated` sobre estas tablas ni
> ninguna policy distinta de `for select`*. Ese invariante deja de ser una promesa por dos vías:
> (1) **RCC.13.6.a** lo verifica adversarialmente (un `authenticated` intentando `insert`/`update`/`delete`,
> incluido un `insert` con el `establishment_id` de otro tenant); (2) la **FK compuesta** de RCC.4.8.b hace que
> ni siquiera una escritura privilegiada pueda desalinear el tenant del detalle respecto de su cabecera.
> **Procedencia (RCC.4.8.a)**: el detalle toma su `establishment_id` de la **fila de snapshot padre**, no de
> `animal_profiles.establishment_id` de cada animal. Al cerrar coinciden siempre, pero la fuente importa: si un
> día un camino moviera un perfil de establecimiento in-place, tomarlo del animal haría que una fila del detalle
> de A pasara a ser legible por B e ilegible por A. Tomándolo del padre, la RLS de cabecera y detalle **no puede**
> discrepar — y la FK compuesta lo vuelve estructural.
>
> **La garantía NO es simétrica, y hay que decirlo.** La FK compuesta ata **detalle ↔ cabecera**. Pero el
> eslabón de arriba —que `rodeo_campaign_snapshots.establishment_id` sea el del `rodeos` al que apunta
> `rodeo_id`— se sostiene solo en que `close_campaign` escribe `v_est`, que sale del mismo `select` sobre
> `rodeos` que el guard. No es explotable (los dos valores tienen la misma fuente en la misma sentencia), pero es
> **el nivel donde la RLS decide quién lee**. Cerrarlo con el mismo mecanismo exigiría `unique (id,
> establishment_id)` en `rodeos` + una FK compuesta desde la cabecera: tocar una tabla core por un invariante que
> hoy no tiene camino de violación es más blast radius del que este delta quiere. **Se cierra por test**
> (RCC.13.6.b): un assert de invariante sobre **toda** fila de `rodeo_campaign_snapshots`. Queda escrito acá para
> que nadie asuma una simetría que no existe: **abajo por constraint, arriba por test.**

### §2.4 — Decisión: **enum multi-fila**, no booleanos

| | (a) enum multi-fila **[ELEGIDA]** | (b) una fila por animal con booleanos |
|---|---|---|
| "mismo animal en varios buckets" | estructural: 3 filas | requiere 5 columnas y no olvidarse de ninguna |
| escritura en `close_campaign` | 5 `insert … select` derivados de las **mismas** CTE que produjeron cada número | un `full outer join` de 5 conjuntos + `group by` para plegarlos en una fila |
| auditabilidad | `count(*) filter (bucket='pregnant')` **debe** dar el `pregnant` de la cabecera → invariante testeable (RCC.4.7) | igual verificable, pero el plegado intermedio puede introducir el error que se quiere detectar |
| el bucket `weaned` | su sujeto es la **cría**, no la madre: una fila propia con `mother_profile_id` lo dice explícito | una fila "de animal" con 4 booleanos en false y `is_weaned` en true mezcla dos poblaciones en la misma columna |
| agregar un bucket | `alter type … add value` + un `insert` más | `alter table … add column` + tocar el plegado |
| costo | ~3 filas por vientre + 1 por cría ≈ 1.500/campaña/rodeo | ~650 |

Gana (a). El argumento decisivo es el segundo: el detalle **es** la evidencia del número, y sale de las
mismas CTE que lo calcularon, sin un paso de transformación en el medio que pueda mentir. El costo en filas es
irrelevante (~1.500 filas por campaña por rodeo).

> **AS-BUILT (reconciliación §15 R13, reviewer H-4) — "el mismo `select`" es más fuerte de lo que el código
> puede prometer, y por eso se verifica.** `close_campaign` es `VOLATILE`: en `READ COMMITTED` **cada
> sentencia toma un snapshot de transacción nuevo**, así que las 4 temporales (de donde sale el detalle) y
> las 5 RPC de KPI (de donde salen los números de la cabecera, porque DL2/RCC.5.4 obligan a leer de las
> MISMAS funciones que la lectura en vivo) se materializan en sentencias distintas. Un `reproductive_events`
> que commitee en el medio podía dejar el detalle y la cabecera diferidos en una fila — y el artefacto que
> ADR-032 presenta como "la evidencia del número" quedaría mintiendo para siempre, sin que nada lo notara
> (TR.20 corre sobre un fixture quieto y es estructuralmente ciego a eso).
> **Lo que se hace, dicho con precisión** (el chequeo no es "el mismo select", y no hay que venderlo como
> tal). El paso 10 de §4.2 cuenta las filas del detalle recién insertadas y las compara con los cinco números
> de la cabecera; si difieren, el cierre **aborta con `40001`** y la transacción entera se va (no queda
> snapshot). Eso garantiza **exactamente RCC.4.7 —identidad de CONTEO por bucket— verificada antes del
> commit**, y convierte la carrera de "acuña un artefacto inconsistente que nadie va a notar" en "falla y se
> reintenta".
> **Lo que NO garantiza, y queda declarado**: (a) no es identidad de **conjunto** — si en la misma ventana
> entrara un vientre y saliera otro, los conteos podrían coincidir con conjuntos distintos; (b) no cruza
> **cabecera contra cabecera** — `ccl_total` y `pregnant` salen de invocaciones distintas de RPC distintas, y
> nadie los compara entre sí (lo mismo `born_total` vs `calved`, que además **no** son iguales por diseño:
> `rodeo_calving_by_stage` devuelve 0 cuando `n_months < 2` o `>= 12`). Subir la garantía exigiría un único
> cómputo interno del que salieran los dos lados, que es el rediseño que §5.B W8 deja anotado para cuando la
> medición de T74 diga si hace falta.

---

## §3 — El cómputo histórico

### §3.1 — Cómo se evita duplicar la elegibilidad en siete lugares

Hoy la lógica está repartida así: la **elegibilidad** vive una sola vez (`rodeo_serviced_females`, §5.7), pero el
**"último tacto + regla de aborto"** está copiado 4 veces (`0106:242-266`, `0117:62-79`, `0117:101-127`,
`0106:376-395`) y la **ventana de concepción del parto** está copiada 5 veces (`0117:84-94`, `0117:119-127`,
`0106:466-476`, `0118:51-59`, `0118:69-78`). Agregar el filtro de ventana a mano en cada copia es la forma
garantizada de que dentro de seis meses una de ellas quede vieja.

La estructura queda en **tres capas**, con un solo dueño por concepto:

```
        ┌─────────────────────────── capa 0: helpers puros / de fila ───────────────────────────┐
        │  campaign_tacto_bounds(months, year)  → (tacto_from, tacto_to)      ← DL5, una vez     │
        │  animal_category_at(profile, on_date) → category_id                 ← F3, una vez      │
        └──────────────────────────────────────────────────────────────────────────────────────┘
                                              ▲
        ┌────────────────────── capa 1: conjuntos de la campaña (internas) ─────────────────────┐
        │  rodeo_serviced_females(rodeo, year)  ← PÚBLICA, el ÚNICO lugar de la ELEGIBILIDAD     │
        │  rodeo_campaign_tacto(rodeo, year)    ← el ÚNICO lugar del "último tacto + aborto"     │
        │  rodeo_campaign_births(rodeo, year)   ← el ÚNICO lugar de "parto imputado a la campaña"│
        │  rodeo_campaign_calves(rodeo, year)   ← el ÚNICO lugar de "cría de la campaña + destete"│
        └──────────────────────────────────────────────────────────────────────────────────────┘
                                              ▲
        ┌──────────────── capa 2: las 7 funciones públicas (agregan y cortocircuitan) ───────────┐
        │  serviced_females · repro_denominator · pregnancy · calving · ccl · by_stage · weaning │
        └──────────────────────────────────────────────────────────────────────────────────────┘
```

§5.7 de `0106` no solo se preserva: se **extiende**. Cada concepto del dominio reproductivo tiene exactamente un
lugar auditable, y las 7 funciones públicas pasan a ser agregación + presentación.

### §3.2 — Helpers de capa 0

```sql
-- DL5 — la ventana del TACTO de la campaña, en un solo lugar. Función PURA (no toca tablas) → IMMUTABLE,
-- sin SECURITY DEFINER y sin superficie de authz. Wrap de fin de año: con months={11,12,1} el mínimo es 1
-- → la ventana es el año calendario completo, que es exactamente la convención de set-membership del as-built.
create or replace function public.campaign_tacto_bounds (p_months smallint[], p_year int)
returns table (tacto_from date, tacto_to date)
language sql immutable as $$
  select make_date(p_year, m, 1),
         make_date(p_year + 1, m, 1) - 1
  from (select coalesce((select min(x)::int from unnest(p_months) x), 1) as m) s;
$$;

-- F3 — la categoría del perfil a una fecha. Degradación documentada (RCC.2.7): sin historia previa a la
-- fecha, devuelve la categoría ACTUAL. Solo puede dispararse en perfiles anteriores a 0030 o re-apuntados
-- por transfer_animal; la pertenencia al rodeo ya excluye a los que no existían en la campaña.
create or replace function public.animal_category_at (p_profile_id uuid, p_on date)
returns uuid language sql stable set search_path = public as $$
  select coalesce(
    (select h.to_category_id from public.animal_category_history h
      where h.animal_profile_id = p_profile_id and h.changed_at::date <= p_on
      order by h.changed_at desc limit 1),
    (select p.category_id from public.animal_profiles p where p.id = p_profile_id)
  );
$$;
```

Ambas se revocan de `public`, `anon` **y `authenticated`** (RCC.9.5): solo las invocan funciones
`SECURITY DEFINER`, que corren con los privilegios del owner.

### §3.3 — `rodeo_serviced_females` reescrita (el núcleo)

Cambios respecto de `0105:112-169`, uno por fuga:

| Línea vigente | Qué hacía | Qué hace ahora |
|---|---|---|
| `0105:119` `p.rodeo_id = p_rodeo_id` | membresía **actual** (F4) | `join rodeo_membership_history mh` vigente a `v_state_as_of` |
| `0105:121` `p.status = 'active'` | padrón **actual** (F2) | eliminado — la presencia la resuelve el intervalo de membresía, que se cierra con `exit_date` |
| `0105:122` `p.deleted_at is null` | borrado lógico | **se conserva** (RCC.2.5) |
| `0105:127` `c.code in (...)` sobre la categoría actual (F3) | categoría **actual** | `animal_category_at(p.id, v_state_as_of)` |
| `0105:132-135` último `heifer_fitness` sin cota | veredicto **de hoy** (F3) | `and rv.event_date <= v_state_as_of` |
| `0105:141` `(current_date - a.birth_date)` | edad **de hoy** (F3-bis) | `(v_state_as_of - a.birth_date)` |
| `0105:147-164` rama IA con `p.rodeo_id`/sin padrón | ídem F4 | mismo `join` de membresía; el filtro de `event_date` no cambia |

Esqueleto (el guard, la cota, el `v_est` y la unión DISTINCT quedan **textualmente** como en `0105`):

```sql
create or replace function public.rodeo_serviced_females (p_rodeo_id uuid, p_year int)
returns table (animal_profile_id uuid, source text)
language plpgsql security definer stable set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_age_threshold_days int := 365;
  v_state_as_of date; v_snap uuid;
begin
  -- (1) tenant + guard + cota: IDÉNTICOS a 0105:101-110 (§5.1/§5.3 preservados).
  ...
  -- (2) DL3 — campaña CERRADA: se devuelve la foto y no se computa nada.
  select s.id into v_snap from public.rodeo_campaign_snapshots s
   where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
  if v_snap is not null then
    return query
      select d.animal_profile_id, d.source
        from public.rodeo_campaign_snapshot_animals d
       where d.snapshot_id = v_snap and d.bucket = 'serviced'
       order by d.idv nulls last, d.animal_profile_id;
    return;
  end if;

  -- (3) DL6 — fecha de corte del estado histórico.
  v_state_as_of := coalesce(
    (select window_end from public.rodeo_service_campaign(p_rodeo_id, p_year)),
    make_date(p_year, 12, 31));

  -- (4) cómputo histórico (natural ∪ IA, DISTINCT) — ver la tabla de arriba.
  return query
  with member as (           -- ← F4 + F2 en UN predicado
    select mh.animal_profile_id
      from public.rodeo_membership_history mh
     where mh.rodeo_id = p_rodeo_id
       and mh.from_date <= v_state_as_of
       and (mh.to_date is null or mh.to_date > v_state_as_of)
  ),
  eligible_natural as (
    select distinct p.id as animal_profile_id, 'natural'::text as source
      from public.animal_profiles p
      join member m on m.animal_profile_id = p.id
      join public.animals a on a.id = p.animal_id
      join public.categories_by_system c
        on c.id = public.animal_category_at(p.id, v_state_as_of)     -- ← F3
     where p.establishment_id = v_est          -- §5.5: tenant por el JOIN a animal_profiles
       and p.deleted_at is null
       and a.sex = 'female'
       and v_months is not null and cardinality(v_months) >= 1
       and ( c.code in ('vaquillona_prenada','vaca_segundo_servicio','multipara','vaca_cabana')
             or ( c.code = 'vaquillona' and (
                    (select rv.heifer_fitness from public.reproductive_events rv
                      where rv.animal_profile_id = p.id and rv.event_type = 'tacto_vaquillona'
                        and rv.deleted_at is null
                        and rv.event_date <= v_state_as_of                       -- ← F3
                      order by rv.event_date desc, rv.created_at desc limit 1) = 'apta'
                    or ( not exists (select 1 from public.reproductive_events rv
                                      where rv.animal_profile_id = p.id
                                        and rv.event_type = 'tacto_vaquillona'
                                        and rv.deleted_at is null
                                        and rv.event_date <= v_state_as_of)      -- ← F3
                         and a.birth_date is not null
                         and (v_state_as_of - a.birth_date) >= v_age_threshold_days ) -- ← F3-bis
             )))
  ),
  ai_females as ( ... mismo cuerpo de 0105:151-164 con `join member` en lugar de `p.rodeo_id = p_rodeo_id`
                      y sin `p.status`, conservando el filtro de event_date ... )
  select distinct on (u.animal_profile_id) u.animal_profile_id, u.source
    from (select * from eligible_natural union all select * from ai_females) u
   order by u.animal_profile_id, (u.source = 'natural') desc;
end; $$;
```

> **Nota de comportamiento (F2)**: hoy una vaca vendida desaparece del reporte de 2025; después del cambio,
> **cuenta** si estaba en el rodeo al cierre de la ventana. Ese es el fix, no una regresión. Y si el
> `exit_date` está vacío (convención de flujo, no invariante de DB — 21/21 poblados en DEV), el backfill/trigger
> asume "salió hoy", que es la mejor cota disponible y se declara como limitación.

### §3.4 — `rodeo_repro_denominator`

Se le agrega el cortocircuito por snapshot y se cambia `retired`:

```sql
serviced  := (select count(*)::int from public.rodeo_serviced_females(p_rodeo_id, p_year));
-- F7: con el conjunto servidas evaluado a la fecha de corte, "retirada" ya no es computable sobre él
-- (toda baja posterior al corte es posterior a la campaña). Se devuelve 0 explícito para no reintroducir
-- un número dependiente de HOY en un reporte histórico. La redefinición real de `entoradas` → docs/backlog.md.
retired   := 0;
entoradas := serviced;
```

### §3.5 — Set-functions internas de capa 1

```sql
-- El ÚNICO lugar del "último tacto de la campaña + tacto+ vigente" (F1 / DL5).
create or replace function public.rodeo_campaign_tacto (p_rodeo_id uuid, p_year int)
returns table (animal_profile_id uuid, pregnancy_status text, event_date date,
               is_pregnant boolean, is_empty boolean)
language plpgsql security definer stable set search_path = public as $$
declare v_est uuid; v_months smallint[]; v_from date; v_to date;
begin
  -- guard + cota idénticos al patrón (§5.1/§5.3), aunque la función no sea invocable por authenticated.
  ...
  select b.tacto_from, b.tacto_to into v_from, v_to
    from public.campaign_tacto_bounds(v_months, p_year) b;
  return query
  with last_tacto as (
    select distinct on (t.animal_profile_id)
           t.animal_profile_id, t.pregnancy_status::text as pregnancy_status, t.event_date, t.created_at
      from public.rodeo_serviced_females(p_rodeo_id, p_year) s
      join public.reproductive_events t on t.animal_profile_id = s.animal_profile_id
     where t.event_type = 'tacto' and t.deleted_at is null
       and t.event_date between v_from and v_to                        -- ← F1
     order by t.animal_profile_id, t.event_date desc, t.created_at desc
  )
  select lt.animal_profile_id, lt.pregnancy_status, lt.event_date,
         (lt.pregnancy_status is not null and lt.pregnancy_status <> 'empty'
          and not exists (select 1 from public.reproductive_events ab
                           where ab.animal_profile_id = lt.animal_profile_id
                             and ab.event_type = 'abortion' and ab.deleted_at is null
                             and ab.event_date between v_from and v_to  -- ← F1 (aborto acotado)
                             and (ab.event_date, ab.created_at) > (lt.event_date, lt.created_at))),
         (lt.pregnancy_status = 'empty')
    from last_tacto lt;
end; $$;
```

`rodeo_campaign_births(p_rodeo_id, p_year)` → `(animal_profile_id, birth_event_id, birth_date, conc_month)`:
el `distinct on (animal_profile_id)` por concepción más temprana de `0106:466-476`, con la misma condición de
set-membership de `0117:84-94`. `calved` pasa a ser `count(distinct animal_profile_id)` sobre ella;
`rodeo_calving_by_stage` la usa para posicionar los tercios; `rodeo_weaning_kpi` la usa como origen del JOIN.

`rodeo_campaign_calves(p_rodeo_id, p_year)` → `(mother_profile_id, calf_profile_id, is_weaned)`:
`rodeo_campaign_births` ⋈ `birth_calves` + `exists(weaning)`. `weaned` = `count(distinct calf) filter (is_weaned)`,
`pending_weaning` = el complemento.

**Lo que NO cambia** (RCC.3.8): las fórmulas de `calved`, `pending_pregnant`, `status` de parición y destete,
y el bucketing por tercios de `rodeo_calving_by_stage`. Cambian el conjunto del que parten y la ventana del tacto.

### §3.6 — El cortocircuito por snapshot, uniforme en las 7

```sql
-- Se inserta DESPUÉS del guard de tenant y de la cota de p_year, y ANTES de cualquier cómputo.
select s.* into v_snap
  from public.rodeo_campaign_snapshots s
 where s.rodeo_id = p_rodeo_id and s.campaign_year = p_year and s.reopened_at is null;
if found then
  is_configured := v_snap.is_configured;  serviced := v_snap.serviced;  ...
  return next; return;
end if;
```

**Ninguna de las 7 cambia su `returns table`** → `CREATE OR REPLACE` en todas, sin `DROP` y sin perder grants.
La migración igual re-emite `revoke`/`grant` + smoke-check (defensa en profundidad; `CREATE OR REPLACE` preserva
privilegios, pero el smoke-check verifica el estado final en lugar de confiar en la semántica).

**Por qué `rodeo_serviced_females` también lee del snapshot** (la pregunta abierta del prompt): porque es una RPC
**pública, con grant a `authenticated`**, y es la única forma de enumerar el denominador. Si siguiera computando
en vivo con la campaña cerrada, un cliente —o el drill-down "¿qué vacas quedaron vacías en 2025?"— obtendría un
conjunto que **contradice** los KPI congelados que la misma pantalla muestra al lado. La garantía de "foto
inmutable" tiene que valer en **toda** superficie pública, no solo en los cinco agregados. Además, dejarla en vivo
obligaría a `rodeo_repro_denominator` a un híbrido (contar en vivo sobre un conjunto congelado) que puede diferir
del `serviced` almacenado. Con las dos leyendo del snapshot, el sistema tiene una sola verdad por campaña cerrada.

Las **internas** (`rodeo_campaign_tacto`/`_births`/`_calves`) **no** cortocircuitan: no son alcanzables desde
PostgREST (revocadas de `authenticated`) y solo se invocan durante el cómputo en vivo o desde `close_campaign`,
que por construcción corre con la campaña abierta.

---

## §4 — Cierre, reapertura y estado

### §4.1 — `is_owner_or_vet_of` (punto ①)

Copia literal de `is_owner_of` (`0005:31-48`) — `sql security definer stable set search_path = public`, join a
`establishments` con `e.deleted_at is null`, `ur.active = true` — cambiando **solo**
`ur.role = 'owner'` por `ur.role in ('owner','veterinarian')`. Enum vigente:
`('owner','field_operator','veterinarian')`. `grant execute … to authenticated` (lo usan las policies/RPC),
`revoke … from public`.

### §4.1-bis — `campaign_cycle_complete(...)`: **un solo dueño** del predicado (F8) — vive en `0128`

> Las dos funciones de abajo son puras sobre valores (no tocan tablas, no dependen de las RPC de KPI) → se
> declaran junto al resto de los helpers en `0128`, aunque sus dos consumidores estén en `0130`.

El predicado "el ciclo de la campaña terminó" lo consumen **dos** funciones (`close_campaign`, para decidir si
hace falta reconocimiento; `rodeo_campaign_status`, para sugerir el cierre). Duplicarlo garantiza que dentro de
seis meses una de las dos quede vieja y la app sugiera cerrar algo que el cierre rechaza. Va a un único lugar,
como función **pura sobre valores ya computados** (no recomputa nada: los dos callers ya tienen los números en
la mano, sea del cómputo en vivo o del snapshot):

```sql
-- DP-15, dueño único. STABLE (no IMMUTABLE) porque depende de current_date.
create or replace function public.campaign_cycle_complete (
  p_weaning_status text, p_pending_weaning int, p_state_as_of date
) returns boolean language sql stable as $$
  select (p_weaning_status = 'ok' and coalesce(p_pending_weaning, 0) = 0)
      or (p_state_as_of is not null and current_date > p_state_as_of + interval '18 months');
$$;

-- Descriptor legible de lo que falta. Alimenta (a) el mensaje del 23514, (b) `missing_at_close` del snapshot
-- y (c) `rodeo_campaign_status.missing_summary` para que la UI enumere sin re-derivar.
create or replace function public.campaign_missing_summary (
  p_calving_status text, p_pending_pregnant int, p_weaning_status text, p_pending_weaning int
) returns text language sql immutable as $$
  select nullif(concat_ws(' · ',
    case when coalesce(p_pending_pregnant,0) > 0
         then p_pending_pregnant || ' preñadas sin parir' end,
    case when coalesce(p_pending_weaning,0) > 0
         then p_pending_weaning || ' crías sin destetar' end,
    case when p_calving_status = 'not_calving_season' then 'la parición no empezó' end,
    case when p_weaning_status = 'not_weaning_season' then 'el destete no empezó' end
  ), '');
$$;
```

Ambas se revocan de `public`, `anon` y `authenticated` (solo las invocan funciones `SECURITY DEFINER`).

### §4.2 — `close_campaign(p_rodeo_id uuid, p_year int, p_acknowledge_incomplete boolean default false) returns uuid`

`SECURITY DEFINER` **VOLATILE** (escribe) **`set search_path = public, pg_temp`**. Molde de escritura:
`exit_animal_profile` (`0044`) y `register_birth` (`0116`).

> **Por qué `pg_temp` explícito y último** (Gate 1 M-3a). Postgres busca `pg_temp` **primero** para nombres de
> relación aunque no esté en el `search_path`; la guía oficial de *Writing SECURITY DEFINER Functions Safely*
> exige listarlo **último** y explícito. Este delta es el **primero del repo** que crea y lee tablas temporales
> dentro de un `DEFINER`, así que el as-built dejó de cubrir el caso por accidente. No es explotable hoy
> (`authenticated` solo llega por PostgREST, que no hace DDL, así que nadie puede pre-crear
> `pg_temp.animal_profiles`), pero el costo del blindaje es una palabra. **Que nadie lo "uniformice"** con el
> `set search_path = public` de las funciones de lectura, que no usan temporales.

Secuencia:

1. Derivar `v_est` + `v_months` de `rodeos` (no borrado) → `P0002` si no existe.
2. **Guard**: `if not public.is_owner_or_vet_of(v_est) then raise … using errcode = '42501'` — primera sentencia
   ejecutable tras derivar el tenant, fail-closed, nunca un no-op silencioso.
3. Cota `p_year ∈ [1900, current+1]` → `22023`.
4. Derivar `v_state_as_of` (DL6) y `(v_tacto_from, v_tacto_to)` (DL5).
5. **Guard duro, NO reconocible**: `if v_state_as_of > current_date then raise … '23514'`. Es distinto del guard
   de ciclo incompleto del paso 7 y por eso no lo sortea `p_acknowledge_incomplete`: acá la **fecha de corte
   todavía no ocurrió**, así que el conjunto servidas no sería una foto incompleta sino el presente proyectado
   al futuro (y cualquier vaca que entre al rodeo antes de que termine el servicio quedaría afuera para siempre).
   No es "cerrar temprano": es cerrar antes de que la campaña exista. `D1` no cubre este caso.
6. **Idempotencia** (RCC.5.6): si ya hay snapshot vigente → devolver su `id` y salir **sin escribir**.
7. **Computar TODO antes de escribir** (RCC.5.5). El orden importa: si la cabecera se insertara primero, las
   propias funciones que este RPC invoca encontrarían el snapshot y devolverían la foto a medio hacer.
   ```sql
   -- Gate 1 M-3b: `on commit drop` limpia al COMMIT, no al salir de la función → un segundo close_campaign en
   -- la MISMA transacción reventaría con 42P07. Pasa en el runbook del §9 (dos rodeos, una transacción).
   -- Crear-o-truncar, con el nombre calificado, sin SQL dinámico (§5.10):
   if to_regclass('pg_temp._snap_serviced') is null then
     create temp table _snap_serviced on commit drop as
       select * from public.rodeo_serviced_females(p_rodeo_id, p_year);
   else
     truncate pg_temp._snap_serviced;
     insert into pg_temp._snap_serviced
       select * from public.rodeo_serviced_females(p_rodeo_id, p_year);
   end if;
   -- ídem _snap_tacto / _snap_births / _snap_calves
   select * into v_preg  from public.rodeo_pregnancy_kpi   (p_rodeo_id, p_year);
   select * into v_calv  from public.rodeo_calving_kpi     (p_rodeo_id, p_year);
   select * into v_ccl   from public.rodeo_ccl_distribution(p_rodeo_id, p_year);
   select * into v_stage from public.rodeo_calving_by_stage(p_rodeo_id, p_year);
   select * into v_wean  from public.rodeo_weaning_kpi     (p_rodeo_id, p_year);
   ```
   Los cinco KPI se persisten **tal cual los devuelve la lectura en vivo** (DL2): la foto es, por construcción,
   igual al reporte que el productor estaba viendo cuando apretó el botón.
7-bis-α. **Gate de campaña inexistente (RCC.5.7.e, Gate 1 M-4.3)** — antes del gate de F8:
   ```sql
   if v_denom.serviced = 0 then
     raise exception 'campaign has no serviced females: nothing to freeze'
       using errcode = '23514';
   end if;
   ```
   Es el **tercer** guard duro no reconocible, y su motivo es doble. (i) Semántico: un año sin una sola hembra
   servida no es una campaña incompleta, es una campaña **inexistente**; congelar "0 de 0" no es una foto de nada
   y contamina el benchmarking con años fantasma. (ii) De costo: sin él, `campaign_cycle_complete` da `true` para
   cualquier año vacío por la rama de los 18 meses, así que un owner podía materializar ~126 snapshots por rodeo
   iterando `p_year`, cada uno pagando la amplificación de §5.B W8, sin ningún rate limit de PostgREST que lo
   frene. Con él, la cota de snapshots por rodeo pasa a ser "los años en que el rodeo realmente sirvió".

7-bis. **Gate del ciclo incompleto (F8)** — con los KPI ya en la mano, **antes** de escribir nada:
   ```sql
   v_complete := public.campaign_cycle_complete(v_wean.status, v_wean.pending_weaning, v_state_as_of);
   v_missing  := public.campaign_missing_summary(v_calv.status, v_calv.pending_pregnant,
                                                 v_wean.status, v_wean.pending_weaning);
   if not v_complete and not coalesce(p_acknowledge_incomplete, false) then
     raise exception
       'campaign cycle incomplete (%): close again acknowledging it to freeze it anyway', v_missing
       using errcode = '23514';
   end if;
   ```
   El mensaje **enumera qué falta** (no es un "no se puede" pelado): el cliente lo muestra tal cual como
   fallback, y en el camino feliz la UI arma el texto en es-AR desde `rodeo_campaign_status` (§7.2).
   `v_complete` / `v_missing` se persisten en el paso 8 como `closed_incomplete` / `missing_at_close`.
8. `insert into rodeo_campaign_snapshots (…, closed_incomplete, missing_at_close) values (…) returning id into v_snap_id;`
   Con `on conflict` sobre el índice parcial no aplicable (los índices parciales no sirven como
   `conflict_target` sin la misma cláusula `where`) → se usa `on conflict (rodeo_id, campaign_year)
   where reopened_at is null do nothing` + re-`select`, y si aun así hubiera carrera, se captura
   `unique_violation` y se devuelve el snapshot existente (RCC.9.8).
9. Cinco `insert … select` desde las temp tables, uno por bucket (`serviced` con `source`; `pregnant` con
   `pregnancy_status`; `empty`; `calved`; `weaned` con `mother_profile_id`/`mother_idv`), tomando `idv` de
   `animal_profiles` en ese momento.
10. `return v_snap_id;`

**Cierre masivo del campo (DL1, DENTRO de este delta)**: **no** hay RPC de establecimiento. El cliente itera los
rodeos que ya tiene en `RodeoContext` y llama N veces. Motivos: (i) evita una segunda superficie IDOR con
`p_establishment_id` del cliente, que es exactamente el M1 de `0106` §5.1; (ii) la semántica de falla parcial es
clara y reportable ("se cerraron 3 de 4; *Servicio Primavera* todavía está en servicio"); (iii) N es un puñado.

El reconocimiento de F8 **no se pierde en el gesto masivo** (que es donde sería más fácil perderlo): la iteración
va en **dos pasadas** (RCC.5.10.a). Primera con `p_acknowledge_incomplete = false` → los rodeos con el ciclo
incompleto vuelven con `23514` y su descriptor. La UI los lista con lo que les falta; si el usuario confirma, se
hace una **segunda pasada acotada a esos rodeos** con `true`. Un solo "cerrar todo" nunca puede congelar en
silencio una campaña sin partos.

### §4.2-bis — Los tres gates del cierre, de un vistazo

| # | Condición | Código | ¿`p_acknowledge_incomplete` lo sortea? | Por qué |
|---|---|---|---|---|
| G1 | `state_as_of > current_date` (el servicio no terminó) | `23514` | **No** | La fecha de corte no ocurrió: no sería una foto incompleta sino el presente proyectado al futuro. |
| G2 | `serviced = 0` (RCC.5.7.e) | `23514` | **No** | No hay campaña que fotografiar; además es el piso que acota la cantidad de snapshots materializables. |
| G3 | ciclo incompleto (`campaign_cycle_complete` falso) | `23514` con el detalle | **Sí** | D1: el productor puede querer congelar una campaña cuyo destete no va a llegar nunca. Queda persistido en `closed_incomplete`. |

G1 y G2 son "no hay campaña"; G3 es "la campaña existe pero está a medias". Solo el tercero es una decisión del
productor, y por eso solo el tercero es reconocible.

### §4.3 — `reopen_campaign(p_rodeo_id uuid, p_year int) returns uuid`

Mismo guard, misma cota, mismo `P0002`. No usa tablas temporales; igual lleva `set search_path = public, pg_temp`
por uniformidad de las dos RPC de escritura. Reglas:

- Si no hay snapshot vigente → devuelve `null` sin escribir (idempotente, RCC.6.4).
- Si existe snapshot vigente para `(p_rodeo_id, p_year + 1)` → `23514` (DL4).
- Si no → `update … set reopened_at = now(), reopened_by = auth.uid()` y devuelve el `id`.
- La fila y su detalle **quedan** (RCC.6.3). Un re-cierre inserta un snapshot nuevo (RCC.6.5); el índice parcial
  lo permite porque el viejo ya no está vigente.

### §4.4 — `rodeo_campaign_status(p_rodeo_id uuid, p_year int)` (lectura)

`SECURITY DEFINER STABLE`, guard `has_role_in` (leer **no** cambia de rol — RCC.7.3), cota de `p_year`,
`grant … to authenticated`. Devuelve:

| Columna | Cómo se deriva |
|---|---|
| `is_closed`, `snapshot_id`, `closed_at`, `closed_by`, `closed_by_name` | snapshot vigente ⋈ **`user_roles.member_name`** `where user_id = closed_by and establishment_id = v_est`, con `coalesce` a null (Gate 1 M-5). **No** se lee la tabla global `users`: ADR-026 (c2) ya decidió denormalizar el nombre sobre `user_roles` (`0080`) justamente para no abrir un camino de lectura a una tabla compartida entre tenants desde una función que corre con privilegios del owner. Además el nombre que corresponde mostrar es el que **esa membresía** conoce, no el global de hoy. |
| `closed_incomplete`, `missing_at_close` | del snapshot vigente (F8) |
| `service_months`, `n_months`, `state_as_of` | del snapshot si está cerrada; de `rodeo_service_campaign` si no (F5) |
| `pending_pregnant`, `pending_weaning`, `missing_summary` | del snapshot si está cerrada; de `rodeo_calving_kpi`/`rodeo_weaning_kpi` + `campaign_missing_summary` si no → la UI enumera qué falta sin llamar a los KPI (RCC.7.7) |
| `can_close` | `is_owner_or_vet_of(v_est) and not is_closed and state_as_of <= current_date` **`and serviced > 0`** — los **tres** gates duros de §4.2-bis, no dos. `serviced` ya viene en el `returns` de `rodeo_weaning_kpi`, que esta función ya invoca en el camino abierto: costo cero. Sin esta cláusula, un rodeo sin servicio ofrecía "Cerrar campaña", fallaba con `23514`, y la UI —que distingue reconocible de no reconocible **por `can_close`** (§5.C)— mostraba la segunda acción "Cerrar igual con estos datos incompletos", que también falla. Eso **entrena al usuario a clickear el reconocimiento**, que es exactamente el control que DP-10 existe para proteger. |
| `can_reopen` | `is_owner_or_vet_of(v_est) and is_closed and not exists(snapshot vigente de p_year+1)` |
| `cycle_complete` | **`campaign_cycle_complete(weaning_status, pending_weaning, state_as_of)`** — la misma función que usa el gate de `close_campaign` (§4.1-bis), no una copia |
| `has_new_data` | ver abajo (DL10) |

`cycle_complete` es la señal de D1 ("la app detecta que el ciclo se completó y avisa") **y** el gate de F8: es el
mismo predicado, y por eso vive en una sola función. Los 18 meses = 9 de gestación + ~8 de destete + margen.
**[VALIDAR CON FACUNDO]** el número exacto — y notar que ahora ese número no solo mueve un aviso: también decide
cuándo el cierre pide reconocimiento.

`has_new_data` (RCC.8.3):

```sql
exists (
  select 1
    from public.rodeo_campaign_snapshot_animals d
    join public.reproductive_events e on e.animal_profile_id = d.animal_profile_id
   where d.snapshot_id = v_snap.id
     and e.deleted_at is null
     and e.created_at > v_snap.closed_at
     and e.event_date between v_snap.tacto_from and v_snap.tacto_to)
```

Acotado por el conjunto congelado de animales y por la ventana congelada → barato (índice
`reproductive_events (animal_profile_id, event_date desc)`) y preciso para el caso que importa: *un dato de la
campaña cerrada que llegó tarde*. **Limitación declarada**: no detecta un dato de un animal que no estaba en el
snapshot (una vaca que debió estar y nunca se cargó). Cubrir ese caso exigiría recomputar el conjunto histórico
en cada carga de pantalla; no vale el costo.

DL10 en su otra mitad es **ausencia de código**: nada bloquea la escritura de un evento de una campaña cerrada.
No se agrega ningún trigger de rechazo (rompería el offline-first). Se testea explícitamente (RCC.8.1).

---

## §5 — Seguridad (Gate 1) — auditable contra la cabecera §5.1–§5.10 de `0106`

### §5.A — Las 7 funciones modificadas: el contrato se preserva íntegro

| § de `0106` | Qué exige | Cómo se preserva en este delta |
|---|---|---|
| **§5.1** | guard `has_role_in` al entrar, fail-closed `42501`, tenant derivado de la fila | Las 7 conservan **textualmente** su bloque de derivación de `v_est` + guard. Ninguna recibe `establishment_id` del cliente → no aparece la superficie M1. |
| **§5.2** | `SECURITY DEFINER STABLE set search_path = public` | Sin cambios: las 7 siguen `STABLE` (siguen sin escribir; el cortocircuito es un `select`). |
| **§5.3** | cota de `p_year` tras el guard | Sin cambios, y el cortocircuito por snapshot va **después** de la cota. |
| **§5.4** | cota de escaneo de las alertas | No aplica (esas 2 RPC no se tocan). El cierre tiene su propia cota: §5.B W8. |
| **§5.5** | tenant por el JOIN a `animal_profiles`, no por la columna denorm de las tablas hijas | Se conserva, y es **la** cláusula que sostiene la frontera: el `join member` filtra **solo** por `mh.rodeo_id = p_rodeo_id`, sin filtro de tenant, así que quien pone el tenant es `p.establishment_id = v_est` sobre `animal_profiles`. **`rodeo_membership_history.rodeo_id` no puede ser frontera de tenant** porque deriva de una columna escribible por el cliente (`animal_profiles.rodeo_id`, `0022:13`) — ver la nota de abajo. Esa cláusula **no es redundante y no se saca**. |
| **§5.6** | excluir el perfil borrado en el JOIN | `p.deleted_at is null` se conserva. `p.status = 'active'` se **quita a propósito** (es F2) y se reemplaza por el intervalo de membresía. **El reemplazo NO es "más restrictivo": es bidireccional.** Excluye a los que entraron después del corte (más restrictivo) e **incluye** a los que ya no están en el padrón pero cuya membresía cubría el corte (más permisivo — que es exactamente el fix F2). Y **no es equivalente en el presente**: un perfil `sold` con `exit_date` nulo queda con `to_date = current_date` y por lo tanto entra en toda campaña pasada, donde el código viejo lo excluía (§13). El cambio de conjunto es intencional y de dominio; **la seguridad no la sostiene este filtro sino §5.5**. |

> **Nota sobre `rodeo_id` y el tenant** (corrige una premisa de Gate 1 M-1, verificada contra el remoto):
> `animal_profiles.rodeo_id` **sí** tiene guard de establecimiento — `tg_animal_profiles_rodeo_check`
> (`0021:25-43`, `before insert or update`) rechaza con `23514` un `rodeo_id` que no pertenezca al
> `establishment_id` de la propia fila, o que apunte a un rodeo inactivo o borrado; y
> `tg_animal_profiles_rodeo_same_system_check` (`0047`) cubre además el cruce de sistemas productivos. O sea que
> el par (perfil de A, rodeo de B) **no es alcanzable** por ningún camino, ni de cliente ni de `service_role` (es
> un trigger de tabla, no una policy). Aun así, la frontera de tenant de la query sigue siendo
> `p.establishment_id = v_est`: es defensa en profundidad y es la que hay que citar, no el intervalo de
> membresía. Guard del invariante: RCC.13.13 (el intento de escritura cruzada da `23514`).
> Es un caso de `reference_function_recreate_base` aplicado a la **lectura**: el as-built del remoto manda sobre
> lo que parece decir una migración vieja leída de a un archivo por vez.
| **§5.7** | los KPI no re-derivan el denominador | Se preserva y se extiende: además del denominador, el tacto, los partos y las crías tienen un único dueño (§3.1). |
| **§5.8** | `revoke public/anon` + `grant authenticated` + smoke-check | Re-emitido en `0129` y `0130` para todo lo nuevo y re-creado. |
| **§5.10** | parámetros tipados de PostgREST, sin SQL dinámico | Ninguna función nueva construye SQL como string. |

### §5.B — Lo que cambia por ser **escritura** (`close_campaign` / `reopen_campaign`)

| # | Regla | Implementación |
|---|---|---|
| **W1** | **No son `STABLE`.** El `STABLE` de §5.2 no aplica: escriben. Declararlas `STABLE` haría que Postgres pudiera cachear/reordenar su ejecución. | `security definer` **sin** `stable` (VOLATILE por defecto) + `set search_path = public`. Se deja el comentario explicando por qué, para que nadie "uniformice" el estilo. |
| **W2** | **Guard más estricto que el de lectura**: `is_owner_or_vet_of`, no `has_role_in` (punto ①). | Primera sentencia ejecutable tras derivar `v_est` de la fila del rodeo. `42501` fail-closed. El `field_operator` recibe `42501`, nunca un no-op. |
| **W3** | **El guard de lectura NO se endurece.** | Las 7 funciones de lectura y `rodeo_campaign_status` siguen con `has_role_in`. |
| **W4** | **Sin `establishment_id` del cliente.** | Las 3 RPC nuevas reciben `p_rodeo_id`; el tenant sale de la fila. Cero superficie M1. |
| **W5** | **Tablas nuevas sin camino de escritura del cliente.** | `grant select` únicamente; policies **solo** `for select`. Las escribe el trigger (`SECURITY DEFINER`) o `close_campaign`/`reopen_campaign`. Por eso la RLS de las de snapshot puede usar el `establishment_id` denormalizado (§2.3) — **desvío declarado de ADR-026**. El invariante no es una promesa: lo verifica **RCC.13.6.a** (un `authenticated` intentando `insert`/`update`/`delete` en las 3 tablas, incluido un `insert` con `establishment_id` ajeno) y lo refuerza la **FK compuesta** de RCC.4.8.b. |
| **W5b** | **Procedencia del `establishment_id` de las 2 tablas de snapshot.** | Cabecera: `v_est`, derivado de la fila de `rodeos` por el guard. Detalle: de la **fila de snapshot padre**, no de `animal_profiles`. La FK compuesta `(snapshot_id, establishment_id) → (id, establishment_id)` lo hace estructural: cabecera y detalle no pueden discrepar de tenant ni con una escritura privilegiada. |
| **W6** | **Idempotencia y carrera.** | Índice único parcial `(rodeo_id, campaign_year) where reopened_at is null` + `exception when unique_violation then` → devuelve el existente. Dos cierres concurrentes no producen dos fotos. |
| **W7** | **El cierre no toca datos de negocio.** | Las únicas escrituras son sobre las 2 tablas de snapshot. Testeado con conteos antes/después de `animal_profiles`, `reproductive_events`, `weight_events` (RCC.13.12). |
| **W8** | **Cota de costo — declarada, no minimizada.** | Ningún parámetro del cliente modula el volumen (no hace falta `p_limit`), pero el costo **por llamada no es una pasada**: `close_campaign` materializa 4 temporales y **después** invoca las 5 RPC de KPI, que recomputan desde cero (`pregnancy` → tacto → serviced; `calving` → tacto + births → serviced; `ccl` → tacto → serviced; `by_stage` → births → serviced; `weaning` → calves → births → serviced). **`rodeo_serviced_females` corre del orden de una docena de veces por cierre**, y cada corrida hace un `animal_category_at` correlacionado por perfil más la subquery de `heifer_fitness`. Cota realista: **≈ 12 × N_cabezas_del_rodeo**. Además `rodeo_campaign_status` recomputa 2 KPI en el camino abierto y se recarga en cada `useFocusEffect` (la pantalla pasa de 8 RPC a 9). **Piso de años**: el gate G2 (`serviced = 0`) impide materializar snapshots de años vacíos, que era el multiplicador que convertía esto en abuso (≈126 años × N rodeos). **MEDIDO (T74, 2026-08-07, DEV, campo de prueba equivalente a La Facundina: 433 cabezas en padrón, 84 y 135 servidas por rodeo)**: `close_campaign` **≈ 150 ms** (152 ms Invierno / 147 ms Primavera) sobre datos **ya commiteados**, y ≈ 153/159 ms dentro de la misma transacción que los sembró. La lectura en vivo de las 6 RPC de una campaña **abierta** es **≈ 128 ms**; la de una **cerrada** (cortocircuito por snapshot) **≈ 10 ms** — o sea que el snapshot no solo congela, además **divide por doce** el costo de la pantalla. **Veredicto: la amplificación ≈12× es real pero irrelevante a esta escala; NO se rediseña el cierre a un cómputo interno único.** El umbral en el que valdría la pena revisitarlo es un rodeo un orden de magnitud mayor (≈4.000 vientres → ≈1,5 s), o un cierre masivo de muchos rodeos en una sola acción; anotado como disparador, no como deuda abierta. |
| **W9** | **Funciones internas no alcanzables por PostgREST.** | `revoke execute … from public, anon, authenticated` sobre **las 7**: `rodeo_campaign_tacto`, `rodeo_campaign_births`, `rodeo_campaign_calves`, `animal_category_at`, `campaign_tacto_bounds`, **`campaign_cycle_complete`**, **`campaign_missing_summary`**. La lista **no se enumera dos veces**: la migración declara una única **lista blanca de lo público** y el smoke-check barre por prefijo todo lo demás (§6-bis), así que una interna nueva nace revocada o la migración muere. Testeado (RCC.13.6). |
| **W10** | **El trigger es `SECURITY DEFINER set search_path = public`** (molde `0030`) y toma `establishment_id` **de la fila padre**, nunca de un valor del cliente (anti-spoof, ADR-026). |
| **W11** | **PII**: ninguna tabla nueva guarda PII (ADR-025). `closed_by`/`changed_by` son FK a `users(id)`; el nombre se resuelve por JOIN dentro de una RPC con guard, no se denormaliza. |
| **W12** | **Superficie de sync**: las 3 tablas quedan **fuera** de `sync-streams/mitropero.yaml` (DL8) → no amplían la frontera del wire ni el bucket count. Guard de ausencia en la suite (RCC.13.10). |

### §5.C — Códigos de error (contrato con el cliente)

| Código | Cuándo | Mapeo en `reports.ts` |
|---|---|---|
| `42501` | sin rol / rol insuficiente (IDOR incluido) | `forbidden` |
| `P0002` | rodeo inexistente o borrado | `forbidden` |
| `22023` | `p_year` fuera de `1900..current+1` | `validation` |
| `23514` | (a) cerrar una campaña cuyo servicio no terminó **[no reconocible]**; (b) cerrar con el ciclo incompleto sin `p_acknowledge_incomplete` **[reconocible]**; (c) reabrir con la campaña siguiente cerrada | **`conflict`** (nuevo `kind`, con mensaje accionable) |
| `40001` | el detalle y la cabecera no coinciden porque llegó un dato **durante** el cierre (§2.4 as-built): el cierre aborta sin escribir | `server` (reintentable — es exactamente lo que hay que hacer) |

El cliente distingue **lo reconocible de lo no reconocible por `can_close`**, no por el texto del mensaje ni por
un código nuevo: si `can_close` es falso, el `23514` viene de G1 o G2 y **no hay reintento posible** (la UI no
ofrece ni el cierre ni el reconocimiento); si `can_close` es verdadero y `cycle_complete` es falso, es G3 y el
reintento con reconocimiento es la salida. Por eso `can_close` tiene que reflejar **los tres** gates duros
(§4.4): si le falta uno, la UI ofrece un reconocimiento que no puede funcionar.

---

## §6 — Migraciones: numeración y orden

`0126_user_private_phone_format.sql` es la última del repo → **`0127` es el siguiente libre** (verificado
listando `supabase/migrations/`). El implementer **re-verifica** antes de escribir (otra terminal podría haber
tomado el número).

| # | Archivo | Depende de | Por qué en ese orden |
|---|---|---|---|
| 1 | `0127_rodeo_membership_history.sql` | — | La tabla **y su backfill** tienen que existir antes de que ninguna función la lea. Si `0129` se aplicara primero, todos los reportes darían `serviced = 0`. |
| 2 | `0128_campaign_snapshots.sql` | `0127` (ninguna dep. real, pero se aplica en orden) | Las tablas de snapshot y los helpers de capa 0 tienen que existir antes de que `0129` las referencie en tiempo de *parse*. |
| 3 | `0129_reports_historical_compute.sql` | `0127`, `0128` | Reescribe las 7 + crea las 3 internas. A partir de acá los reportes son históricos. |
| 4 | `0130_campaign_close_rpcs.sql` | `0129` | `close_campaign` invoca las 5 RPC de KPI **ya históricas**: si se aplicara antes, un cierre congelaría números viejos (justamente el "solo snapshot" que ADR-032 §6 descarta). |

Cada una: `begin; … notify pgrst, 'reload schema'; commit;` + smoke-check fail-closed que aborta la transacción.
Ninguna se aplica desde el implementer (`🔴 NO se aplica al remoto desde acá`, patrón `0105`/`0106`/`0117`/`0118`).
Entre `0127` y `0130` la suite `supabase/tests/reports/run.cjs` queda **roja-hasta-apply** — esperado.

**Ventana de inconsistencia entre `0127` y `0129`**: no la hay funcionalmente (las funciones viejas no conocen la
tabla nueva), pero sí operativa: si el apply se corta entre migraciones, el sistema queda con historia de
membresía sin usar. Es inocuo y reversible.

**Reversibilidad**: `0129` se revierte re-aplicando los cuerpos vigentes de `0105`/`0106`/`0117`/`0118`;
`0130`/`0128`/`0127` se revierten con `drop function` / `drop table` (las tablas nuevas no tienen dependientes).

### §6-bis — El smoke-check de grants: lista blanca + barrido, no enumeración de lo prohibido

Gate 1 M-2 encontró que la lista normativa de funciones a revocar tenía 5 entradas y las internas eran 7. El
problema no son las dos que faltaban: es **la forma de la lista**. Enumerar lo que hay que revocar es el patrón
que este repo ya se comió cuatro veces — se escribe sobre las que hoy existen y no falla cuando aparece una nueva.

Se invierte: la migración declara **una sola** enumeración, la de lo **público**, y de ella salen **dos** loops —
uno por cada mitad del invariante de §5.8. La primera versión de este bloque tenía un solo loop y por eso perdía
la mitad que `0105:237-252` ya exigía: **el barrido excluye la lista blanca por construcción, así que nadie
verificaba que las públicas estén revocadas de `anon`/`public`** — y el default de Postgres para una función
nueva es `EXECUTE` a `PUBLIC`, o sea que `close_campaign` nacía abierta. Una fuente, dos invariantes:

```sql
do $$
declare
  -- ÚNICA enumeración de la migración. De acá salen los grants Y los DOS checks.
  v_public constant text[] := array[
    'close_campaign','reopen_campaign','rodeo_campaign_status',
    'rodeo_service_campaign','rodeo_serviced_females','rodeo_repro_denominator',
    'rodeo_pregnancy_kpi','rodeo_calving_kpi','rodeo_ccl_distribution',
    'rodeo_calving_by_stage','rodeo_weaning_kpi',
    -- AS-BUILT (reconciliación §15 R1): las dos públicas PREEXISTENTES que el barrido `rodeo\_%` también
    -- alcanza. Sin ellas acá, el loop (1) aborta la migración por dos RPC legítimas de spec 07.
    'rodeo_sessions_list','rodeo_weight_by_category',
    -- + el helper de authz (mismo estatus que is_owner_of/has_role_in: grant a authenticated).
    'is_owner_or_vet_of'
  ];
  -- AS-BUILT: `rodeo\_campaign\_%` ⊂ `rodeo\_%`; se suman `close\_%`/`reopen\_%` porque close_campaign y
  -- reopen_campaign no matchean NINGÚN prefijo (`campaign\_%` es prefijo, no sufijo) y sin eso un error de
  -- tipeo en la lista blanca los dejaría fuera de LOS DOS loops, abiertos a PUBLIC por default.
  v_ns constant text[] := array['rodeo\_%','campaign\_%','close\_%','reopen\_%'];
  v_bad record;
begin
  -- (1) INTERNAS: todo lo del namespace del delta que NO está en la lista blanca no puede ser
  --     ejecutable por public/anon/authenticated.
  for v_bad in
    select p.oid::regprocedure::text as fn, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public','authenticated']) as rolname) r
    where n.nspname = 'public'
      and (p.proname like any (v_ns) or p.proname = 'animal_category_at')
      and not (p.proname = any (v_public))
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: % is EXECUTE-able by % (internal → must be revoked)',
      v_bad.fn, v_bad.rolname;
  end loop;

  -- (2) PÚBLICAS: la otra mitad de §5.8 / 0105:237-252. Las de la lista blanca SÍ van a authenticated,
  --     pero NUNCA a anon/public (default de Postgres = EXECUTE a PUBLIC → el revoke es obligatorio).
  for v_bad in
    select p.oid::regprocedure::text as fn, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = any (v_public)
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: % is EXECUTE-able by % (public RPC → must be revoked from anon/public)',
      v_bad.fn, v_bad.rolname;
  end loop;
end$$;
```

**Qué gana**: una función interna nueva bajo el namespace del delta nace revocada o **la migración muere**; y una
pública nueva a la que se le olvide el `revoke` también la mata. No hay lista de prohibidos que mantener.
**Qué no cubre, dicho explícitamente**: una interna futura con un nombre fuera de los prefijos. Eso es una
convención de nombres, no un guard; queda declarado acá en vez de fingir cobertura total.

---

## §7 — Frontend

### §7.1 — Capa de datos (`app/src/services/reports.ts`)

Se agregan tres wrappers. Los dos de escritura conservan el patrón del módulo (chequeo `assertOnline` **antes**
de llamar → `{kind:'offline'}` sin disparar la RPC; DL9 sale gratis de ahí) y suman `conflict` al `ReportError`:

```ts
export type ReportError = { kind: 'offline' | 'network' | 'server' | 'forbidden' | 'validation' | 'conflict'; message: string };

export type CampaignStatus = {
  isClosed: boolean; snapshotId: string | null;
  closedAt: string | null; closedBy: string | null; closedByName: string | null;
  closedIncomplete: boolean; missingAtClose: string | null;          // F8
  serviceMonths: number[] | null; nMonths: number; stateAsOf: string | null;
  pendingPregnant: number; pendingWeaning: number;                    // qué falta, para enumerar
  canClose: boolean; canReopen: boolean; cycleComplete: boolean; hasNewData: boolean;
};

export function fetchCampaignStatus(rodeoId: string, year: number): Promise<ReportResult<CampaignStatus | null>>;
// F8: `acknowledgeIncomplete` NO tiene default en el wrapper — quien lo llama tiene que elegir a propósito.
export function closeCampaign  (rodeoId: string, year: number, acknowledgeIncomplete: boolean): Promise<ReportResult<string>>;
export function reopenCampaign (rodeoId: string, year: number): Promise<ReportResult<string | null>>;
```

`mapRpcError` gana `code === '23514' → conflict`. El `p_acknowledge_incomplete` **sí** tiene default en SQL
(compatibilidad de PostgREST y de cualquier caller futuro), pero **no** en el wrapper de TypeScript: un default a
`false` en el wrapper sería inofensivo, pero un default a `true` en un refactor futuro sería catastrófico y
silencioso. Sin default, el compilador obliga a decidir en cada call site.

### §7.2 — Presentación pura (`app/src/utils/reports-format.ts`)

```ts
export type CampaignStateView = {
  badge: 'en-curso' | 'cerrada' | 'cerrada-a-medias';
  title: string;            // "Campaña en curso" | "Campaña cerrada"
  detail: string | null;    // "Foto del 14/03/2026" (formatDateEsAr) | "Los números se actualizan solos"
  notice: string | null;    // DL10 | sugerencia de cierre (D1) | qué faltaba al cerrar (F8)
  primaryAction: 'close' | 'reopen' | null;
  /** F8: lo que falta HOY para que el ciclo esté completo — alimenta la confirmación de RCC.10.7.a. */
  missing: string[];        // ej. ["2 preñadas sin parir", "5 crías sin destetar"]
  tone: 'neutral' | 'info' | 'warning';
};
export function campaignStateView(s: CampaignStatus | null): CampaignStateView;
```

Tabla de estados:

| `isClosed` | `closedIncomplete` | `hasNewData` | `cycleComplete` | permiso | `title` | `detail` | `notice` | acción |
|---|---|---|---|---|---|---|---|---|
| false | — | — | false | can_close | Campaña en curso | Los números se actualizan con cada dato nuevo | — | Cerrar campaña |
| false | — | — | **true** | can_close | Campaña en curso | ídem | **El ciclo de esta campaña está completo. ¿La cerrás?** | Cerrar campaña |
| false | — | — | — | `canClose` false | Campaña en curso | ídem | — | **ninguna** — cubre tanto "no tiene el rol" como "todavía está en servicio" (G1) y "no hay hembras servidas" (G2). La UI no ofrece un cierre que el server va a rechazar, ni el reconocimiento que vendría después. |
| **true** | false | false | — | can_reopen | **Campaña cerrada** | **Foto del 14/03/2026** | — | Reabrir campaña |
| **true** | **true** | false | — | can_reopen | **Campaña cerrada a medias** | Foto del 14/03/2026 | **Se cerró con 2 preñadas sin parir · 5 crías sin destetar. Los números no incluyen eso.** | Reabrir campaña |
| **true** | — | **true** | — | can_reopen | Campaña cerrada | Foto del 14/03/2026 | **Hay datos nuevos sin reflejar en la foto. Reabrí la campaña para incorporarlos.** | Reabrir campaña |
| true | — | — | — | sin permiso | Campaña cerrada | Foto del 14/03/2026 | (el aviso de "a medias" se muestra igual: es información del reporte, no una acción) | ninguna |

**El estado "cerrada a medias" es información del reporte, no un error de operación.** Se muestra a todos los
roles, incluido el que no puede reabrir: un reporte comparado año contra año tiene que poder decir "este número
se congeló antes de que terminara la parición". Es exactamente el dato que el benchmarking necesita para no
comparar peras con manzanas.

Copys en **sentence-case** (la corrección de casing de 2026-07-10 que Raf cazó en la Puerta 2 del delta anterior),
fechas por `formatDateEsAr` (`dd/mm/aaaa`, TZ-safe por string).

### §7.3 — Pantalla (`app/app/(tabs)/reportes.tsx`)

- `CampaignStateBar` va **inmediatamente debajo del `YearStepper`** y encima del `ReportSectionHeader` de
  Reproductivo: es el marco de interpretación de todo lo que viene abajo, así que tiene que leerse antes que los
  números (jerarquía visual; nadie debería ver un 89 % sin saber si es una foto o un número vivo).
- El `hint` del `ReportSectionHeader` de Reproductivo pasa de `Campaña ${year} · base servidas` a
  `Campaña ${year} · ${cerrada ? 'foto' : 'en curso'} · base servidas`: redundancia barata para que el estado
  siga visible al scrollear.
- **RCC.10.4**: `CclBlock` recibe `campaign.serviceMonths ?? selectedRodeo?.serviceMonths ?? null` — con la
  campaña cerrada manda el array congelado, no el del rodeo de hoy.
> **AS-BUILT (§15-ter)**: (a) los controles de la hoja los decide `campaignCloseActions` (pura): tras un
> rechazo del server no queda ningún primario y el intento que falló desaparece; (b) "Reabrir campaña" es una
> acción de texto de baja jerarquía, no un botón a ancho completo.

- Confirmación (RCC.10.7): `BulkConfirmSheet` ya existe y es el molde; se reusa con el copy "Vas a cerrar la
  campaña 2025 de *Servicio Invierno*. Los números quedan congelados. Podés reabrirla mientras no cierres la
  campaña 2026."
- **Confirmación reforzada con el ciclo incompleto (RCC.10.7.a, F8)**: si `cycleComplete === false`, la hoja
  **enumera `view.missing`** en una lista ("2 preñadas sin parir", "5 crías sin destetar") y agrega una segunda
  acción explícita —"Cerrar igual con estos datos incompletos"— separada visualmente de la primaria. El primer
  intento va con `acknowledgeIncomplete: false` y, si vuelve `conflict`, se muestra esa segunda acción; recién
  ese segundo toque manda `true`. Con `cycleComplete === true` no aparece nada de esto y el cierre es un toque
  (RCC.10.7.b): la fricción se paga **solo** cuando hay algo que reconocer.
- Cierre masivo (RCC.10.6, **dentro de este delta**): acción secundaria dentro de la misma hoja ("Cerrar los 4
  rodeos del campo"); el hook itera en dos pasadas (§4.2) y devuelve
  `{ ok: string[], incomplete: [{rodeoName, missing: string[]}], failed: [{rodeoName, message}] }`. Los
  `incomplete` se listan con lo que les falta y se cierran solo tras una confirmación adicional. Es la mitigación
  directa del riesgo más alto de la feature (§13, "el productor nunca cierra"): un campo de 4 rodeos no puede
  depender de cuatro gestos manuales.
- `useFocusEffect` recarga también `campaign` (junto con los 6 KPI y las 2 alertas).

> ⚠ **Colisión de trabajo en curso**: `app/app/(tabs)/reportes.tsx` tiene cambios **sin commitear de otra
> terminal** (`useStickStatusSurface('screen-band')`, del bastón, 2026-08-06). Este design describe el cambio
> **sobre el as-built commiteado** (`git show HEAD:app/app/(tabs)/reportes.tsx`). El implementer **no** debe
> revertir ni pisar ese hunk: el cambio de este delta es aditivo (un componente nuevo montado bajo el
> `YearStepper` + un prop más al `CclBlock`) y no toca el `Shell` ni el header, que es donde vive la banda del
> bastón. Si al aplicar hay conflicto, se para y se coordina con el leader.

### §7.4 — Hook (`app/src/hooks/use-reports.ts`)

`useCampaignStatus(rodeoId, year)` con el mismo `useReport` genérico (anti-parpadeo: no blanquea al recargar) +
`closeAction`/`reopenAction` que, al terminar OK, recargan el status **y** los 6 KPI (la campaña recién cerrada
pasa a leerse del snapshot, y los números deben coincidir — si no coincidieran, se ve en el acto).

### §7.5 — Spike (`app/app/reportes-spike.tsx`)

Variantes mock, sin backend, para el capture: `campana-en-curso`, `campana-sugerencia`, `campana-cerrada`,
`campana-datos-nuevos`, `campana-confirmacion`. Reusan `campaignStateView` + `CampaignStateBar`.

---

## §8 — Tests (`supabase/tests/reports/run.cjs`)

### §8.1 — TR.12, el oráculo central: inmutabilidad **con sus dos contrafactuales**

El escenario es el del probe 1 (`progress/repro_reportes-campanas-congeladas.md`), con los mismos números:
rodeo de cría, `service_months = {6,7}`, 3 multíparas, las 3 con **tacto preñada el `year-09-15`**, la vaca B con
**parto el `year+1-03-15`**. `year = thisYear() - 1` para que la ventana esté en el pasado y el cierre sea legal.

Estado esperado antes de cerrar (T0 del probe):

```
serviced_females        3
denominator             serviced 3, retired 0, entoradas 3
rodeo_pregnancy_kpi     serviced 3, entoradas 3, pregnant 3, empty 0
rodeo_calving_kpi       serviced 3, pregnant 3, calved 1, pending_pregnant 2
rodeo_ccl_distribution  head 3, body 0, tail 0, total 3
rodeo_calving_by_stage  total_born 1
rodeo_weaning_kpi       serviced 3, weaned 0, pending_weaning 1
```

Luego `close_campaign`, y las **cuatro** mutaciones del probe:

1. tacto **vacío** sobre la vaca A fechado en la campaña **siguiente** (`year+1-09-15`, fuera de la ventana);
2. **venta** de la vaca B (`status='sold'`, `exit_date` de hoy);
3. **transferencia de rodeo** de la vaca C a otro rodeo del mismo campo;
4. **cambio de categoría** de una vaquillona a `cut` **y** un veredicto `tacto_vaquillona = 'no_apta'` fechado en
   `year+1` (el killer del probe 2, que hacía `serviced: 0`).

**Aserción**: los 5 KPI, campo por campo, **idénticos** a T0. No "aproximadamente": comparación de objetos.

**Contrafactual 1 — el snapshot hace su trabajo (RCC.13.2).** Un rodeo gemelo con el mismo escenario, **sin
cerrar**. Se le aplica **un tacto vacío fechado DENTRO de la ventana** (`year+1-02-15`, que cae antes del
`year+1-06-01` en que arranca la campaña siguiente). El gemelo abierto **se mueve** (`pregnant 3 → 2`,
`empty 0 → 1`, `ccl total 3 → 2`); el cerrado, con el mismo tacto, **no se mueve**. Ese es el único par de
mutaciones que aísla la contribución del snapshot.

> **Por qué el contrafactual "obvio" no sirve, y hay que decirlo en el test.** Después de este delta, la venta,
> la transferencia y el cambio de categoría **tampoco mueven una campaña abierta** — ese es precisamente el fix
> del cómputo histórico. Si el contrafactual se escribiera con esas tres mutaciones, fallaría (el gemelo abierto
> no se movería) y el próximo que lo lea lo "arreglaría" aflojando la aserción. La mutación que distingue
> snapshot de cómputo histórico es **un dato legítimo de la campaña que llega tarde**, que es exactamente el
> escenario DL10.

**Contrafactual 2 — el cómputo histórico hace su trabajo (RCC.13.3).** Sobre el gemelo **abierto**, las tres
mutaciones de estado (venta, transferencia, `no_apta` posterior) **no** mueven ningún KPI. Se asserta
explícitamente y con un comentario que cita el probe: antes del delta movían 7, 6 y "hasta serviced 0"
respectivamente.

### §8.1-bis — TR.21: el tenant del **camino cerrado** (Gate 1 H-1)

El hallazgo más valioso del informe: **hoy la suite es estructuralmente ciega al camino del snapshot.** Los IDOR
existentes (`run.cjs:475`, `:529`, `:754`, `:802`, `:854`) están bien escritos, pero **todos corren con campañas
abiertas** — no porque nadie lo pensara, sino porque hasta este delta no existían las campañas cerradas. El
cortocircuito agrega **siete salidas tempranas nuevas** y ninguna se ejercita. Y poner el `select … from
rodeo_campaign_snapshots` antes del `select establishment_id from rodeos` es la variante **natural** de escribir
la función: leer el snapshot no necesita la fila del rodeo. Una sola de las siete escrita así entrega los 5 KPI
congelados **y el detalle por animal completo** de un campo ajeno, con la suite en verde.

**Los dos oráculos son conductuales.** No hace falta ningún regex sobre el SQL:

1. **Orden guard → cortocircuito**: se cierra la campaña de A; el owner de **B** invoca cada función de campaña
   sobre el rodeo de **A** con ese año → `42501`, y `data` vacío. Si el cortocircuito quedó antes del guard, la
   llamada devuelve filas y el test se pone rojo.
2. **Orden cota → cortocircuito**: no alcanza con pedir `p_year = 9999999` (no habría snapshot para ese año, así
   que hasta una función mal ordenada cae igual en la cota). El oráculo es **sembrar el snapshot en un año que la
   cota rechaza pero el `CHECK` de la tabla admite**: `service_role` inserta una fila con `campaign_year = 2400`
   (el `CHECK` es `1900..2400`; la cota de las RPC es `1900..current+1`), y entonces el owner de A pide
   `rodeo_pregnancy_kpi(rodeo, 2400)` → **tiene que dar `22023`**. Si el cortocircuito está antes de la cota,
   devuelve la foto sembrada. **Este oráculo corre sobre el MISMO conjunto descubierto que (1)**, no sobre una
   función de ejemplo: el conjunto ya está calculado ahí al lado, y si el orden sale bien en una y mal en otra el
   caso único quedaría verde. (Impacto real bajo —`close_campaign` no puede crear un snapshot fuera de cota, así
   que en producción el estado es inalcanzable— pero cuesta una línea y es disciplina de la misma clase que (1).)

**El guard se escribe sobre la ausencia (RCC.13.5.e).** La lista de funciones a machacar **no se escribe a mano**:
el test la **descubre** del catálogo, y le aplica (1) a cada una:

```sql
select p.oid::regprocedure::text as fn, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like 'rodeo\_%'
  and oidvectortypes(p.proargtypes) = 'uuid, integer'   -- ← AS-BUILT (§15 R3), NO identity_arguments
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
```

> **AS-BUILT (reconciliación §15 R3).** La versión original de este bloque usaba
> `pg_get_function_identity_arguments(p.oid) = 'uuid, integer'`. **Medido contra el remoto, esa función
> devuelve `"p_rodeo_id uuid, p_year integer"` — CON los nombres de los parámetros**, así que la comparación
> no matchea nunca y el descubrimiento daba **0 funciones**: el test habría quedado rojo para siempre por el
> piso (fail-closed, sí, pero inútil — los dos oráculos no se ejecutarían jamás). `oidvectortypes(proargtypes)`
> devuelve exactamente `uuid, integer`. Es la misma lección que `reference_function_recreate_base`, aplicada
> al catálogo: lo que "dice" una función del catálogo se **verifica ejecutándola**, no se supone.

Hoy devuelve 9 (`rodeo_service_campaign`, las 7 de campaña y `rodeo_campaign_status`). El test **asserta un piso**
(`>= 9`) para que sacar una función del namespace tampoco sirva para esquivarlo, y machaca cada una de las
descubiertas. **Una función de campaña nueva entra sola al test.** Esto resuelve *el hecho* (¿filtra o no?), no la
forma en que hoy se escribiría el bug.

**Lo que este guard NO ve, dicho sin maquillaje**: una función de campaña futura con otra firma (p. ej.
`(uuid, integer, text)`) o con un nombre fuera del prefijo `rodeo_`. `close_campaign(uuid,int,boolean)` y
`reopen_campaign(uuid,int)` quedan fuera del descubrimiento por firma/nombre y se cubren **explícitamente** en
TR.14. No hay forma no textual de observar "esta función lee la tabla de snapshots": `pg_depend` no registra las
referencias a tablas dentro de un cuerpo `plpgsql` (se resuelven en runtime), así que la única alternativa sería
un match sobre `pg_get_functiondef`, que es exactamente lo que este repo ya vio burlar cuatro veces. Se elige
cubrir el invariante por comportamiento sobre un conjunto descubierto, y se declara el borde que queda afuera.

### §8.2 — Los demás bloques

| Bloque | Qué cubre | Requisitos |
|---|---|---|
| **TR.13** cómputo histórico | animal que entró al rodeo **después** del corte → no cuenta; animal que salió **antes** del corte → no cuenta; animal vendido/movido/recategorizado **después** del corte → cuenta con el número de entonces; veredicto `no_apta` posterior al corte → no borra la campaña; fallback por edad evaluado al corte (F3-bis: una vaquillona que hoy tiene 400 días pero al corte tenía 200 → **no** cuenta); `p_year` sin animales presentes → `serviced = 0` (el año deja de ser decorativo). | RCC.2.*, RCC.12.6 |
| **TR.14** authz | owner de B sobre rodeo de A → `42501` en las 3 RPC; `field_operator` de A → `42501` en `close`/`reopen` y **OK** en `status` y en los 6 KPI; `veterinarian` de A → OK en las 3; `22023`/`P0002`; `23514` de precondición y de reapertura; idempotencia de `close`; `close` no muta filas de animales. | RCC.5.*, RCC.6.*, RCC.9.4, RCC.13.12 |
| **TR.14d** ciclo incompleto (F8) | ciclo incompleto sin ack → `23514` **y el mensaje nombra lo que falta** (regex sobre "preñadas sin parir"/"crías sin destetar"); **no se creó ninguna fila** de snapshot; con ack → cierra y `closed_incomplete = true` con `missing_at_close` no nulo, expuesto por `rodeo_campaign_status`; ciclo **completo** → cierra **sin** ack y `closed_incomplete = false`; `campaign_cycle_complete` da lo mismo desde `close_campaign` y desde `rodeo_campaign_status` en el mismo escenario; y el guard **no reconocible**: con `state_as_of > current_date`, `ack = true` **igual** falla con `23514`. | RCC.5.7, RCC.5.7.a–d, RCC.4.11, RCC.7.7, RCC.13.9.a–c |
| **TR.14b** grants de **función** | `anon`/`public` no ejecutan `close_campaign`, `reopen_campaign`, `rodeo_campaign_status`; **`authenticated` no ejecuta** las **7** internas (incluidas `campaign_cycle_complete` y `campaign_missing_summary`). En vez de un array a mano, se reusa el barrido de §6-bis desde el test. Extender el array de TR.10. | RCC.9.5, RCC.13.6 |
| **TR.14e** grants de **TABLA** (Gate 1 H-2b) | Un `authenticated` con rol activo intenta `insert`, `update` y `delete` sobre las **3** tablas nuevas → rechazado en las 9 combinaciones, incluido un `insert` en `rodeo_campaign_snapshots` con el `establishment_id` de **otro** tenant. Y `pg_policies` para las 3 tablas devuelve **solo** filas con `cmd = 'SELECT'`. Es el guard del invariante que sostiene DP-19: si mañana alguien agrega un `grant insert` "para el import", esto se pone rojo antes de que la frontera se caiga. | RCC.4.8, RCC.1.11, RCC.13.6.a |
| **TR.14f** helper de authz (Gate 1 H-3) | `close_campaign`/`reopen_campaign` con (a) un owner cuyo `user_roles.active = false` y (b) un owner de un establecimiento con `deleted_at` no nulo → **`42501`** en ambos; `rodeo_campaign_status` los rechaza igual. Es la asimetría clásica que faltaba: se testeaba que el rol equivocado no pase, no que el rol **correcto caducado** tampoco. **(a) es un oráculo genuino**: sin `ur.active = true` en el helper, se pone rojo. **(b) NO puede fallar hoy y va rotulado** — ver abajo. | RCC.13.5.c |
| **TR.14h-bis** tenant de la cabecera (Gate 1 N-6) | Assert de invariante sobre **toda** fila de `rodeo_campaign_snapshots`: `establishment_id` == el `establishment_id` del `rodeos` de su `rodeo_id`. Es el eslabón cabecera↔rodeo, que la FK compuesta (detalle↔cabecera) no cubre. | RCC.13.6.b |

> **TR.14f(b) es un test que hoy no puede fallar, y va rotulado como tal.** El estado que quiere probar —un owner
> **activo** de un establecimiento **borrado**— es **inalcanzable**: `0076` desactiva los roles al soft-deletear
> un campo y prohíbe reactivar un rol sobre un campo borrado (es el invariante que sostiene el modelo JOIN-free
> de PowerSync, ADR-026). O sea que el caso pasa por `ur.active = false`, no por el join a `establishments`, y
> pasaría igual si el helper no tuviera ese join. **No se borra ni se disfraza**: se deja con un comentario que
> diga (i) que hoy es inalcanzable por `0076`, (ii) que por eso el join a `establishments … deleted_at is null`
> es redundante **hoy**, y (iii) que se vuelve load-bearing el día que exista el flujo de restore de campo que
> `0076` difiere. Un verde que no puede ponerse rojo es un verde mentiroso **salvo que esté rotulado**; rotulado,
> es documentación de un invariante que vive en otra migración.
| **TR.14g** guard de catálogo | Leyendo `pg_proc` (no el texto): `is_owner_or_vet_of` es `prosecdef`, `provolatile = 's'` y tiene `search_path` en `proconfig`; las 7 de lectura + `rodeo_campaign_status` son `stable`; `close_campaign` y `reopen_campaign` **no** son `stable` y tienen `search_path` con `pg_temp`. Resuelve el valor, no el texto. | RCC.13.5.d, RCC.9.2 |
| **TR.14h** procedencia del tenant | Insertar por `service_role` una fila de detalle con un `establishment_id` distinto al de su cabecera → **rechazado por la FK compuesta** (`23503`). El invariante de RCC.4.8.b es estructural, y esto lo confirma. | RCC.4.8.b |
| **TR.15** membresía | apertura al insertar (con `entry_date` y sin él); cierre + apertura al mover; cierre al dar de baja con `exit_date`; invariante de una sola fila vigente (intento de romperlo → `23505`); backfill idempotente (segunda corrida no duplica); RLS (owner de B no ve filas de A); `transfer_animal` deja la historia en el origen; **apuntar el `rodeo_id` de un perfil de A a un rodeo de B → `23514` de `tg_animal_profiles_rodeo_check`** (`0021`), o sea que el par cruzado nunca llega a la tabla de membresía. | RCC.1.*, RCC.13.13 |
| **TR.16** DL10 | tras cerrar: insertar un `tacto` de la campaña **no falla**; los 5 KPI no se mueven; `rodeo_campaign_status.has_new_data = true`; tras `reopen` + `close`, el KPI **sí** incorpora el dato y hay un snapshot nuevo con el viejo `reopened_at`. | RCC.8.*, RCC.6.5 |
| **TR.17** regresión | un `tacto` con `session_id = null` sigue contando en preñez/parición/CCL; **guard de clase**: `pg_get_functiondef` de las 7 funciones no contiene `session_id`. | RCC.12.1, RCC.12.2 |
| **TR.18** denominador | `entoradas === serviced` y `retired === 0` en todos los escenarios. | RCC.2.12 |
| **TR.19** guard de ausencia | leer `sync-streams/mitropero.yaml` y fallar si menciona `rodeo_membership_history`, `rodeo_campaign_snapshots` o `rodeo_campaign_snapshot_animals`. | RCC.13.10 |
| **TR.20** consistencia detalle↔cabecera | por cada bucket, `count(*)` del detalle == el número congelado; y `rodeo_serviced_females` con la campaña cerrada devuelve exactamente `serviced` filas. | RCC.4.7, RCC.7.2 |

El `cleanup()` existente ya borra por `establishment_id` en cascada; las tres tablas nuevas tienen FK a
`establishments … on delete cascade`, así que **no hace falta tocarlo**. Se verifica igual.

---

## §9 — Re-seed de "La Facundina" (D2)

**Ejecutor**: el **leader**, por Supabase MCP, tras el apply de las 4 migraciones y con autorización de Raf.
No lo hace el implementer (es escritura sobre la DB de DEV compartida).
**Objetivo**: `establishment_id = fac00000-face-4000-a000-000000000010` con una campaña cerrada y correcta y una
campaña en curso, en los dos rodeos (`Servicio Invierno {6,7,8}`, `Servicio Primavera {10,11,12}`).

### §9.1 — El año de la campaña cerrada es **2024** — ✅ RESUELTO POR RAF (Puerta 1, 2026-08-07)

D2 / ADR-032 §4.2 dicen "su campaña **2025** ya cerrada y correcta". La aritmética del ciclo lo impide (hoy es
**2026-08-07**):

| Rodeo | Servicio 2025 | Partos (+9) | Destetes (+~7 más) | ¿Ciclo completo hoy? |
|---|---|---|---|---|
| Invierno `{6,7,8}` | jun–ago **2025** | mar–may **2026** ✓ pasado | oct–dic **2026** ✗ **futuro** | **no** |
| Primavera `{10,11,12}` | oct–dic **2025** | jul–sep **2026** (a medias) | feb–abr **2027** ✗ futuro | **no** |

Cerrar 2025 hoy congelaría `%destete` sin destetes y `pending_weaning > 0` **para siempre** — el mismo error que
ADR-032 §2 descarta para el cierre automático por fecha, cometido a mano en la demo. Con 2024 sí cierra:

| Rodeo | Servicio 2024 | Partos | Destetes | ¿Completo? |
|---|---|---|---|---|
| Invierno | jun–ago 2024 | mar–may 2025 | oct–dic 2025 | **sí** |
| Primavera | oct–dic 2024 | jul–sep 2025 | feb–abr 2026 | **sí** |

**Propuesta**: **2024 = campaña cerrada** (ciclo completo, la foto), **2025 = campaña en curso** (servicio y
partos cargados, destete pendiente). La demo gana lo que D2 buscaba y además: los **dos estados de pantalla en el
mismo campo** (que es justo lo que pide el Gate 2.5) y una comparativa 2024 vs 2025 real. No es una re-decisión
de dominio: es la consecuencia aritmética del calendario. **Va a la Puerta 1 para que Raf lo confirme.**

### §9.2 — Procedimiento

> **Es un runbook del leader sobre la DB de DEV compartida, no un snippet copiable.** Los pasos 1-2 son
> **precondiciones de aborto**: si alguna no se cumple, no se ejecuta nada. El `sub` del owner no se transcribe
> acá (Gate 1 anexo, L): se resuelve en el momento con
> `select user_id from user_roles where establishment_id = :est and role = 'owner' and active`.

1. **Backup verificado, no solo tomado** (RCC.11.9): `node scripts/backup-db.mjs` y después **comprobar** que el
   archivo existe, pesa > 0 y **contiene filas del `establishment_id` que se va a borrar**. Un backup que no se
   abrió no es un backup.
2. **Asserts de magnitud ANTES del primer `delete`** (RCC.11.8), dentro de la misma transacción y **como
   `service_role`** (sin impersonar todavía):
   ```sql
   begin;
   -- (a) cardinalidad 1: el conjunto de establecimientos alcanzados es EXACTAMENTE uno
   -- (b) magnitud esperada: ~350 perfiles / ~2.045 eventos; si se desvía, abort
   do $$ begin
     if (select count(distinct establishment_id) from public.animal_profiles
          where establishment_id = 'fac00000-face-4000-a000-000000000010') <> 1
        or (select count(*) from public.animal_profiles
             where establishment_id = 'fac00000-face-4000-a000-000000000010') not between 250 and 500
     then raise exception 'ABORT re-seed: magnitud inesperada, no se borra nada'; end if;
   end $$;
   ```

> ### ⚠ El alcance de la impersonación: **solo el paso 5**, no toda la transacción
>
> La versión anterior de este runbook abría la transacción con `set local role authenticated` + claims y dejaba
> la impersonación puesta para **todo** el procedimiento. **Está mal y muere en el primer `delete`**, verificado
> contra el remoto: `authenticated` tiene `select, insert, update` sobre `animal_profiles` / `animals` /
> `reproductive_events` —**sin `DELETE`**— y solo `select` sobre `animal_category_history`. Con la impersonación
> activa desde el arranque, el borrado aborta con `42501` y, por la transacción única, hace rollback entero: el
> runbook no llegaba a correr nunca.
>
> **Regla**: el borrado (paso 3) y el sembrado (paso 4) corren como **`service_role`** — son operaciones de
> mantenimiento que necesitan `DELETE` y escritura sobre tablas que el cliente no borra. La impersonación se
> acota al **paso 5**, que es el único que la necesita: `close_campaign` deriva `closed_by` de `auth.uid()` y su
> guard es `is_owner_or_vet_of`, así que sin identidad fiel devolvería `42501` y el cierre no se ejercitaría por
> el camino real. **Que nadie lo "uniformice" moviendo el `set local` al arranque**: el alcance es corto a
> propósito, y la contención del borrado la dan los asserts del paso 2 y los `where` explícitos del paso 3, no
> la RLS.
3. **Borrado acotado** (como `service_role`) al `establishment_id` de La Facundina, en orden de dependencia (molde: el `cleanup()` de
   `supabase/tests/reports/run.cjs`): eventos (7 tablas tipadas + `animal_events`) → `birth_calves` →
   `rodeo_membership_history` / `animal_category_history` → `animal_profiles` → `animals` huérfanos →
   `sessions`, `management_groups`, `rodeo_data_config`, `semen_registry` → `rodeos` → `user_roles` →
   `establishments`. Cada `delete` con su `where establishment_id = …` explícito. **No se toca "Santo Domingo"**
   ni ningún otro campo de la cuenta.
4. **Re-seed** (como `service_role`) con el mismo namespace de UUID fijos (`fac00000-face-4000-a000-…`), 2 rodeos
   con los mismos `service_months`, ~350 cabezas, ~2.000 eventos. Diferencias obligatorias respecto del seed
   original:
   - **`entry_date` explícito** en cada perfil, anterior al inicio del servicio 2024 (RCC.11.2). Sin esto el
     trigger abre la membresía en `created_at` = hoy y la campaña 2024 devuelve `serviced = 0`.
   - **Retrodatar `animal_category_history.changed_at`** de las filas `initial` al `entry_date` (RCC.11.3), por
     `service_role`, después de crear los perfiles. Sin esto la categoría histórica cae en la degradación de
     RCC.2.7 y la demo dependería de un fallback.
   - Tactos dentro de la ventana de cada campaña; partos a −9 meses de concepción; destetes ~7 meses post-parto.
5. **Cierre de 2024** en **ambos** rodeos llamando `close_campaign`, y **recién acá** la impersonación, acotada a
   este paso:
   ```sql
   set local role authenticated;                                  -- ⬅ RCC.11.7, alcance = este paso
   set local request.jwt.claims = '{"sub":"<owner resuelto en el momento>","role":"authenticated"}';
   select public.close_campaign('<rodeo invierno>', 2024);
   select public.close_campaign('<rodeo primavera>', 2024);
   reset role;                                                    -- vuelve a service_role para el paso 6
   ```
   Como la cuenta de Facundo es login por Google (sin password para
   `signInWithPassword`), la impersonación por SQL es el único camino que ejercita la RPC real. **No** se
   insertan filas de snapshot a mano. Los **dos** cierres van en la misma transacción, lo cual es posible
   gracias al arreglo de las temporales de §4.2 paso 7 (RCC.11.10): sin él, el segundo moría con `42P07` y el
   runbook se rompía en su primer uso real. El cierre debe salir **sin** `p_acknowledge_incomplete` y dejar
   `closed_incomplete = false`.
6. **Verificación** (RCC.11.6): guardar la salida de las 5 RPC de 2024 **antes** del cierre y comparar contra
   `rodeo_campaign_status` + las 5 RPC **después**; comprobar `is_closed = true` con su `closed_at`, y que 2025
   sigue abierta. **Medir y anotar** el wall-time de cada `close_campaign` (350 cabezas) y foldearlo en §5.B W8.
   `commit` recién acá; ante cualquier desvío, `rollback`.

### §9.3 — AS-BUILT: el runbook es un SCRIPT DEL REPO (`scripts/seed-facundina.mjs`), 2026-08-07

Lo de arriba estaba escrito como un runbook a ejecutar a mano. **No se podía**: el seed original de La
Facundina se hizo a mano en una sesión anterior y **no quedó en el repo**, así que "borrar y volver a sembrar"
no tenía con qué sembrar. Se invirtió el orden — nunca se borra antes de tener el reemplazo probado — y el
runbook se convirtió en un generador parametrizado: **`scripts/seed-facundina.mjs`**, probado de punta a punta
contra un establecimiento descartable ANTES de tocar el campo demo.

```
node scripts/seed-facundina.mjs --establishment-id <uuid> --owner-id <uuid> \
  [--closed-year 2024] --expect-name "La Facundina" [--expect-profiles 250:500] \
  (--backup-to <archivo.json> | --require-backup <archivo.json>) \
  [--tag-block 700] [--scale 1] [--dry-run] [--print-sql <archivo>]
node scripts/seed-facundina.mjs --bootstrap                 # campo descartable de prueba + su usuario
node scripts/seed-facundina.mjs --establishment-id <uuid> --teardown --i-know
```

Con datos en el campo, **`--expect-name` y el backup son obligatorios**: no es posible destruir un
establecimiento sin nombrarlo y sin respaldarlo.

**Lo que se conserva del §9.2**: una sola transacción; asserts de aborto antes del primer `delete`; cada
`delete` con su `where establishment_id` explícito; borrado y sembrado como `service_role`; la impersonación
(`set local role authenticated` + `request.jwt.claims`) **acotada al paso de cierre y a nada más**; los dos
`close_campaign` en la misma transacción; `close_campaign` real, cero filas de snapshot escritas a mano;
comparación de las RPC antes/después; `commit` recién al final.

**Las cinco desviaciones, con su motivo:**

| # | §9.2 decía | As-built | Por qué |
|---|---|---|---|
| **A** | borrar hasta `rodeos` → `user_roles` → `establishments` | se **conservan** `establishments`, `user_roles`, `rodeos`, `rodeo_data_config`, `management_groups`, `field_definitions`, `maneuver_presets`, `invitations`; se borra todo lo demás del establecimiento | Borrar `establishments` **cascadea a `user_roles`** y se lleva puestas la membresía del owner y las de los dos veterinarios, que apuntan a cuentas de auth reales (una de ellas con login por Google). Borrar `rodeos` destruye los UUID fijos `…0011`/`…0012` **que el propio §9.2 paso 4 pide preservar** y su `rodeo_data_config`. El objetivo es regenerar el **rodeo y sus eventos**, no la tenencia. "Santo Domingo" sigue intacto por la misma razón de siempre: todo `delete` va scopeado por `establishment_id`. |
| **B** | assert (a) = "cardinalidad 1 del conjunto de `establishment_id` alcanzados" | reemplazado por dos asserts que **sí pueden fallar**: el nombre del establecimiento (`--expect-name`, **obligatorio** si el campo tiene datos) y que el `--owner-id` sea owner **activo** | Con cada `delete` llevando `where establishment_id = <literal>`, el conjunto alcanzado es ⊆ {est} **por construcción**: el assert literal es tautológico, un guard que no sabe fallar. El riesgo real que buscaba cubrir es *apuntar al establecimiento equivocado*, y eso lo cierra comparar el NOMBRE. El otro riesgo real —`animals` es una tabla **global**, sin `establishment_id`— se cierra borrando solo los **huérfanos de esta tanda** (`not exists (select 1 from animal_profiles …)`), nunca "los animales del campo". |
| **C** | el backup se verifica "a mano" con `scripts/backup-db.mjs` | el mismo script lo **toma** (`--backup-to`) o **exige** uno ya tomado (`--require-backup`), y en los dos casos lo **abre** y verifica que declare este `establishment_id` y contenga filas suyas. Sin uno de los dos, con datos en el campo, no arranca | RCC.11.9 pedía exactamente eso y como paso manual se cumple una vez y después no. Además `scripts/backup-db.mjs` **no sirve para esto**: es un `pg_dump` entero de **PROD** a `.sql.gz` (spec 16 Run B), no el volcado JSON de UN establecimiento de DEV, que es el formato del backup que ya existía de La Facundina. Que el mismo script respalde y destruya evita que el formato que se produce y el que se verifica diverjan. |
| **D** | "~350 cabezas, ~2.000 eventos" | ~271 adultos + ~322 crías = **~593 perfiles** (~433 en padrón) y ~1.850 eventos | El estado anterior tenía **`birth_calves = 0`**: un campo de cría con 243 vientres **tiene** ~200 terneros por año. La cifra de 350 describía el campo roto que este delta viene a arreglar, no uno sano. El denominador reproductivo (84 + 135 servidas) sí queda en el orden del original. |
| **E** | — | el seed es **determinista**: todo el azar (preñada/vacía, cabeza/cuerpo/cola, pérdida, sexo de la cría, a quién se pesa, a quién se vende) sale de un `md5` sobre una clave `rodeo:cohorte:índice`, no del UUID del perfil | Dos corridas sobre el mismo establecimiento producen el MISMO campo. Un demo cuyos números cambian en cada re-seed no se puede citar en una presentación ni comparar contra una captura. |

**Qué siembra, y por qué cada cohorte existe.** No son "350 vacas genéricas": cada una ejercita una rama del
cómputo histórico de `0129`, y el script **aborta si su modelo de elegibilidad no coincide con lo que devuelve
`rodeo_serviced_females`** (assert A3) — o sea que el seed no puede "acomodar" los números.

| Cohorte | Invierno / Primavera | Qué prueba |
|---|---|---|
| `multipara` | 52 / 85 | el grueso: elegible sin gate de aptitud en las dos campañas |
| `repo_cerrada` | 18 / 28 | `vaquillona` **apta** en la campaña cerrada y `vaca_segundo_servicio` en la en curso → **F3**: `animal_category_at` lee la categoría **de esa fecha** (fila `manual_override` re-fechada entre los dos cortes) |
| `vaq_prenada` | 8 / 14 | categoría que prueba servicio por sí sola |
| `salida` | 6 / 8 | multípara **vendida entre campañas**: sigue contando en la cerrada (**F2**, el fix) y desaparece de la en curso |
| `repo_abierta` | 9 / 15 | vaquillona que **entró después** del corte de la cerrada: ausente de la cerrada, presente en la en curso (**F4**) |
| `rechazo` | 3 / 5 | veredicto `no_apta` → fuera de las dos (RPS.6.2) |
| `cut` / `toro` / `torito` | 3+3+2 / 4+5+3 | cabezas que **no** son denominador reproductivo |

**Los asserts que abortan antes de congelar nada** (los marcados ✓ verificados **disparando**, no solo
pasando):
**A0** hay backup, es de este establecimiento y tiene filas suyas ✓ · **A1** el establecimiento existe, se
llama como se espera ✓ y el `--owner-id` es owner **activo** ✓ · **A2** la magnitud de perfiles cae en la
cota ✓ · **A2-bis** el bloque de caravana electrónica está libre y los `data_keys` que el gating de `0054`
exige están habilitados · **A3** servidas **modelo == DB**, por rodeo y por año · **A4** la campaña a cerrar
tiene el ciclo completo **por sus datos** (`weaning_status = ok`, `weaned > 0`, `pending_weaning = 0`) ✓ y la
posterior queda con `cycle_complete = false` según `rodeo_campaign_status` · **A4-bis** ningún evento sembrado
queda fechado en el futuro · **A5** la foto es idéntica a la lectura en vivo previa y ningún snapshot sale con
`closed_incomplete = true`. El `--teardown` además se **niega** a borrar un establecimiento cuyo nombre no
lleve la marca `SEED-TEST` ✓ (probado apuntándolo a La Facundina).

**A4 es el que cierra DP-22 empíricamente**: correr el generador con `--closed-year 2025` aborta con
*"137 crías de la campaña 2025 no llegan a destetarse antes de hoy — el ciclo NO está completo y el cierre
pediría reconocimiento. Corregí las fechas, no reconozcas."* La aritmética de §9.1 deja de ser un argumento
en prosa y pasa a ser un guard.

**Medido contra el establecimiento de prueba** (2026-08-07, DEV, las 4 migraciones aplicadas):

| Qué | Invierno | Primavera |
|---|---|---|
| servidas 2024 / 2025 | 84 / 87 | 135 / 142 |
| 2024 (cerrada): preñadas · paridas · destetadas | 76 · 70 · 70 | 120 · 113 · 113 |
| 2024: `closed_incomplete` · `cycle_complete` · `has_new_data` | `false` · `true` · `false` | ídem |
| 2025 (en curso): `is_closed` · `cycle_complete` · `can_close` | `false` · `false` · `true` | ídem |
| las 7 RPC de 2024 antes vs. después del cierre | **idénticas** | **idénticas** |
| detalle por animal vs. cabecera (RCC.4.7) | coincide en los 5 buckets | coincide |

Y los contrafactuales, sobre el campo ya sembrado: un `tacto` nuevo dentro de la ventana de 2024 **y** una
venta posterior al corte **no mueven ni un número** de la campaña cerrada, y `has_new_data` pasa a `true`.

**Reconciliación de RCC.11**: RCC.11.1 (alcance del borrado) → desviación **A**; RCC.11.8(a) (cardinalidad 1)
→ desviación **B**; RCC.11.9 (backup verificado) → desviación **C**, ahora en código.

---

## §10 — Gate 2.5 (ADR-029)

`app/e2e/captures/campanas-congeladas.capture.ts`, viewport 412×915, capturas nombradas a
`app/e2e/captures/__shots__/campanas-congeladas/`:

| # | Estado | Fuente |
|---|---|---|
| 01 | `campana-en-curso` | spike |
| 02 | `campana-sugerencia-cierre` (D1) | spike |
| 03 | `campana-confirmacion-cierre` (ciclo completo: un toque) | spike |
| 04 | `campana-confirmacion-incompleta` (F8: la lista de lo que falta + la segunda acción) | spike |
| 05 | `campana-cerrada` con "Foto del dd/mm/aaaa" | spike |
| 06 | `campana-cerrada-a-medias` (F8: qué faltaba al cerrar) | spike |
| 07 | `campana-datos-nuevos` (DL10) | spike |
| 08 | `campana-cierre-masivo` (resultado por rodeo: cerrados / incompletos / fallidos) | spike |
| 09 | `campana-sin-permiso` (field_operator: sin botones, pero el aviso de "a medias" sí se ve) | spike |

`assertTextNotClipped` sobre "Campaña cerrada", "Campaña cerrada a medias", "Cerrar campaña", "Reabrir campaña",
"Cerrar igual con estos datos incompletos" y "Hay datos nuevos sin reflejar en la foto" (todos con descendentes:
g/p/j/y/q). Las PNG son gitignored; se le muestran a Raf en la
Puerta 2. Tras correr el capture: revertir `design/**` si el build re-renderizó PNGs
(`reference_e2e_design_png_rerender`).

---

## §11 — Alternativas descartadas

1. **Solo arreglar el cómputo, sin persistir** — descartada en ADR-032 §6: el número se mueve igual si cambia la
   fórmula, y las fórmulas ya cambiaron dos veces (`0117`, `0118`).
2. **Solo snapshot, sin cómputo histórico** — descartada en ADR-032 §6: congela el error.
3. **Detalle por animal con booleanos** (`is_serviced`/`is_pregnant`/…) en vez de enum multi-fila — descartada
   en §2.4: el plegado de 5 conjuntos en una fila introduce el paso intermedio que el detalle existe para
   auditar, y mezcla dos poblaciones (madres y crías) en la misma columna.
4. **Dejar `rodeo_serviced_females` computando en vivo con la campaña cerrada** — descartada: es una RPC pública
   con grant a `authenticated`; en vivo contradiría los KPI congelados que la pantalla muestra al lado, y
   obligaría a `rodeo_repro_denominator` a un híbrido congelado/vivo.
5. **RPC masiva `close_campaign_for_establishment(p_establishment_id, p_year)`** — descartada: reintroduce la
   superficie IDOR M1 (`establishment_id` del cliente) por conveniencia, y esconde la falla parcial. El cliente
   itera.
6. **Agregar `is_closed`/`closed_at` al `returns table` de las 5 RPC de KPI** — descartada: obliga a
   `DROP+CREATE` de cinco funciones (con re-grants y smoke-checks) y cambia el contrato del cliente, para
   entregar el mismo dato cinco veces. Una RPC de estado lo resuelve con una llamada.
7. **Intervalos de membresía inclusivos `[from_date, to_date]`** — descartada: un movimiento el mismo día pone al
   animal en dos rodeos a la vez y lo hace contar en dos campañas si el corte cae ahí.
8. **Cerrar la membresía solo por movimiento y dejar la presencia en el padrón a `exit_date`** — descartada: dos
   predicados que pueden divergir. Un solo predicado (`membership`), alimentado por `exit_date`, es el único que
   no se puede desincronizar consigo mismo.
9. **Reconstruir la membresía histórica desde el audit log de spec 18** — descartada en ADR-032 §6: el audit
   cubre solo `user_roles` y retiene 90 días.
10. **Bloquear la escritura de eventos de una campaña cerrada** — descartada por DL10: rompería el offline-first.
    Se acepta el dato y se avisa.
11. **Bloqueo duro del cierre con el ciclo incompleto** (sin parámetro de reconocimiento) — descartada:
    contradice D1. Hay casos legítimos en los que el destete **nunca va a llegar** (se vendieron los terneros al
    pie, se perdió la parición entera, el productor arrancó a usar la app a mitad de ciclo) y el productor tiene
    que poder congelar igual. El diseño elegido hace el error **imposible por accidente y posible a propósito**,
    que es la forma correcta de tratar una acción legítima pero peligrosa.
12. **Avisar y nada más** (dejar `cycle_complete` solo como sugerencia, sin gate) — que era el diseño original
    (DP-10 v1). Descartada por la objeción F8: un aviso no es un guard, y el resultado —`%parición` y `%destete`
    congelados en 0 para siempre— es exactamente el modo de falla que ADR-032 §2 descarta para el cierre
    automático por fecha. Detectarlo para la demo (DP-22) y dejarlo abierto para el usuario real, que además no
    tiene quien se lo revise, era incoherente.
13. **Recomputar el predicado de "ciclo completo" dentro de `close_campaign`**, aparte del de
    `rodeo_campaign_status` — descartada: dos copias de la misma regla que se desincronizan, y el síntoma sería
    que la app sugiere cerrar algo que el cierre rechaza. Una función pura sobre valores ya computados
    (§4.1-bis) da un solo dueño sin costo de recómputo.

---

## §12 — Decisiones de criterio propio del `spec_author`

> Todo lo de esta tabla lo decidí yo: **no** está en el `context.md` ni en ADR-032. Va explícito para que la
> Puerta 1 pueda vetarlo pieza por pieza.

| # | Decisión | Fundamento | Requisito |
|---|---|---|---|
| **DP-1** | Nombres: tablas `rodeo_membership_history`, `rodeo_campaign_snapshots`, `rodeo_campaign_snapshot_animals`; enums `rodeo_membership_reason`, `campaign_bucket`; RPC `close_campaign`, `reopen_campaign`, `rodeo_campaign_status`; internas `rodeo_campaign_tacto/_births/_calves`; helpers `is_owner_or_vet_of`, `animal_category_at`, `campaign_tacto_bounds`. | Prefijo `rodeo_*` = lo parametrizado por rodeo (as-built de las 10 RPC). | §2, §3, §4 |
| **DP-2** | **Detalle = enum multi-fila**, no booleanos. | §2.4. | RCC.4.4 |
| **DP-3** | **Intervalo medio-abierto** `[from_date, to_date)` + índice único de "una sola fila vigente". | Elimina por construcción el doble conteo del movimiento el mismo día. | RCC.1.2, RCC.1.3 |
| **DP-4** | La **membresía es el único predicado de presencia**; `exit_date` entra como el `to_date` del cierre de fila, no como un segundo filtro. | Dos predicados que pueden divergir es un criadero de bugs. | RCC.2.3, RCC.2.4 |
| **DP-5** | `rodeo_serviced_females` **también** lee del snapshot con la campaña cerrada. | Es pública y con grant; en vivo contradiría la foto. §3.6. | RCC.7.2 |
| **DP-6** | Tres set-functions internas nuevas (tacto/partos/crías) + 2 helpers, revocadas de `authenticated`. | Baja las 4+5 copias de lógica a una por concepto sin ampliar la superficie pública. §3.1. | RCC.3.5–3.7 |
| **DP-7** | Ninguna de las 7 cambia su `returns table` → `CREATE OR REPLACE`, sin `DROP`. El estado de campaña viaja por una RPC aparte. | Menos blast radius, grants preservados, contrato del cliente intacto. | RCC.7.5 |
| **DP-8** | `retired := 0` explícito y `entoradas := serviced`. | F7. La alternativa (mantener el conteo sobre el `status` de hoy) reintroduce un número de hoy en un reporte histórico. | RCC.2.12 |
| **DP-9** | El backfill cierra la fila de los perfiles ya dados de baja (`to_date = exit_date`), en vez de dejarlas todas abiertas como dice literalmente DL7. | Con todas abiertas, los 21 perfiles no activos de DEV figurarían presentes hoy. Es un refinamiento de DL7, no una contradicción. | RCC.1.8 |
| **DP-10** *(reescrita tras la objeción del leader, 2026-08-07 — F8)* | **Dos gates distintos, no uno.** (a) **Guard duro, no reconocible**: no se puede cerrar si la fecha de corte todavía no ocurrió (`23514`) — no es "cerrar temprano", es cerrar antes de que la campaña exista, y el conjunto servidas sería el presente proyectado al futuro. (b) **Guard reconocible**: con el ciclo incompleto y `p_acknowledge_incomplete = false` → `23514` **con el detalle de qué falta**; con `true` → cierra, y el snapshot queda marcado `closed_incomplete` + `missing_at_close`. El predicado de (b) es **el mismo** que expone `rodeo_campaign_status.cycle_complete`, en una única función (§4.1-bis). | **Es el mismo problema que DP-22, un nivel más abajo.** DP-22 detecta que cerrar la campaña 2025 de la demo hoy congelaría `%destete` sin destetes para siempre — "el mismo error que ADR-032 §2 descarta para el cierre automático, cometido a mano". La v1 de DP-10 dejaba ese error abierto para **cualquier usuario**: con `{6,7}`, el 1/9 ya se podía cerrar, sin un parto (faltan 9 meses) ni un destete (faltan ~15). El aviso de `cycle_complete` no es un guard. Y a diferencia de la demo, al usuario real no hay quien se lo revise. Un bloqueo duro contradiría D1 (hay cierres legítimos con el destete que nunca va a llegar) → **imposible por accidente, posible a propósito**, con el reconocimiento **persistido** porque un reporte cerrado a medias tiene que poder decirlo tres años después. | RCC.5.7, RCC.5.7.a–d, RCC.4.11, RCC.10.7.a/b, RCC.10.11 |
| **DP-11** | Cierre masivo = N llamadas del cliente, no una RPC de establecimiento, **en dos pasadas** (sin ack → listar los incompletos → con ack solo sobre esos). | Evita la superficie IDOR M1, hace visible la falla parcial (§4.2) y no deja que el gesto masivo se coma el reconocimiento de F8, que es justo donde sería más fácil perderlo. | RCC.5.10, RCC.5.10.a |
| **DP-12** | Reapertura **no borra**: `reopened_at`/`reopened_by` + índice único parcial; el re-cierre crea un snapshot nuevo. | Rastro completo (DL4) sin lógica de borrado. | RCC.6.3, RCC.6.5 |
| **DP-13** | El snapshot congela también `service_months`/`n_months`/`is_configured`, la fecha de corte, la ventana del tacto y un `formula_version`. | F5 + auditoría de "con qué se computó esta foto". | RCC.4.2, RCC.4.3 |
| **DP-14** | El aborto que revierte un "tacto+ vigente" se acota a la ventana de la campaña. | Un hecho fuera de la ventana no puede cambiar el resultado de la campaña. **[VALIDAR CON FACUNDO]** | RCC.3.4 |
| **DP-15** | `cycle_complete = (weaning_status='ok' and pending_weaning=0) or current_date > state_as_of + 18 meses`, en **una sola** función (`campaign_cycle_complete`) consumida por `rodeo_campaign_status` **y** por el gate de `close_campaign`. | Traduce el "la app detecta que el ciclo se completó" de D1. Tras F8 el predicado dejó de ser solo cosmético: decide cuándo el cierre exige reconocimiento → con más razón un único dueño. **[VALIDAR CON FACUNDO]** el nº de meses. | RCC.5.7.c, RCC.7.6, RCC.10.5 |
| **DP-16** | `has_new_data` se evalúa sobre los animales del detalle y la ventana congelada. | Barato y preciso para DL10; la limitación (animal ausente del snapshot) queda declarada. | RCC.8.3 |
| **DP-17** | Fallback de categoría a la categoría actual cuando no hay historia previa a la fecha. | Los perfiles anteriores a `0030` no tienen fila `initial`. Degradación honesta, no silenciosa. | RCC.2.7 |
| **DP-18** | Corte y ventana del tacto cuando `service_months` es NULL/`{}`: 31/12 y el año calendario. | Mantiene la coherencia con el set-membership del as-built. | RCC.2.2, RCC.3.2 |
| **DP-19** *(ampliada tras Gate 1 H-2)* | RLS por `establishment_of_profile()` en la tabla de membresía, y por la columna denormalizada en las de snapshot — **declarado como desvío de ADR-026**, no como aplicación de ADR-026. Con su invariante escrito ("sin grant de escritura ni policy distinta de SELECT"), su oráculo (RCC.13.6.a) y su refuerzo estructural (FK compuesta, RCC.4.8.b). Procedencia fijada: cabecera ← `v_est` del guard; detalle ← **fila padre**, no `animal_profiles`. | La primera cuelga de una tabla escribible por el cliente; las segundas no tienen ningún camino de escritura del cliente. Pero "no tiene camino de escritura" es una premisa, y una premisa sin test es una promesa. §2.3. | RCC.1.11, RCC.4.8, RCC.4.8.a, RCC.4.8.b, RCC.13.6.a |
| **DP-24** *(Gate 1 H-1)* | El test de tenant del camino cerrado **descubre** las funciones del catálogo en vez de enumerarlas, y usa dos oráculos **conductuales** (42501 cross-tenant con snapshot; `22023` con un snapshot sembrado en `campaign_year = 2400`). El borde que no cubre queda declarado. | La suite era estructuralmente ciega al camino nuevo: todos los IDOR existentes corren con campañas abiertas. Y un guard textual sobre `pg_get_functiondef` es el patrón que este repo ya vio burlar cuatro veces. §8.1-bis. | RCC.13.5.a, RCC.13.5.b, RCC.13.5.e |
| **DP-25** *(Gate 1 M-2)* | El smoke-check de grants enumera **lo público** y **barre** el resto por prefijo, en vez de enumerar lo prohibido. Una sola lista en la migración, usada por los `revoke` y por el check. | Enumerar lo prohibido no falla cuando aparece algo nuevo. §6-bis. | RCC.9.5, RCC.9.6 |
| **DP-26** *(Gate 1 M-4)* | Tercer guard duro no reconocible: `serviced = 0` → `23514`. | Un año sin hembras servidas no es una campaña incompleta sino inexistente; y era el multiplicador que permitía materializar ~126 snapshots por rodeo iterando `p_year`. §4.2 paso 7-bis-α, §4.2-bis. | RCC.5.7.e, RCC.9.11 |
| **DP-27** *(Gate 1 M-3)* | `set search_path = public, pg_temp` en las 2 RPC de escritura + temporales **crear-o-truncar** con nombre calificado. | Es el primer delta del repo que crea y lee temporales dentro de un `DEFINER`; y sin el crear-o-truncar el runbook del §9 moría con `42P07` en su primer uso. | RCC.9.2, RCC.11.10 |
| **DP-28** *(Gate 1 M-5)* | `closed_by_name` sale de `user_roles.member_name`, no de `users.name`. | ADR-026 (c2) ya lo decidió (`0080`); leer la global desde un `DEFINER` abre una lectura cross-tenant innecesaria y muestra el nombre global de hoy en vez del que esa membresía conoce. | RCC.9.12 |
| **DP-29** *(Gate 1 N-1)* | La impersonación del runbook se acota **al paso de los dos `close_campaign`**; el borrado y el sembrado corren como `service_role`. | `authenticated` no tiene `DELETE` sobre las tablas que el re-seed borra (verificado en el remoto) → con la impersonación desde el arranque, el runbook moría con `42501` en su primer `delete` y hacía rollback entero. La contención del borrado la dan los asserts de magnitud y los `where`, no la RLS. | RCC.11.7 |
| **DP-30** *(Gate 1 N-2)* | El smoke-check de grants tiene **dos** loops sobre la misma enumeración: internas no ejecutables por `public`/`anon`/`authenticated`, y públicas no ejecutables por `anon`/`public`. | El barrido excluye la lista blanca por construcción, así que con un solo loop nadie verificaba la mitad de §5.8 que `0105:237-252` ya exigía — y el default de Postgres dejaba `close_campaign` abierta a `PUBLIC` al aplicar. | RCC.9.6, RCC.9.6.a |
| **DP-31** *(Gate 1 N-3)* | `can_close` refleja **los tres** guards duros, incluido `serviced > 0`. | §5.C hace que el cliente distinga lo reconocible de lo no reconocible **por `can_close`**; con G2 afuera, un rodeo sin servicio ofrecía "cerrar igual con estos datos incompletos" y fallaba igual → entrenaba al usuario a clickear el control que DP-10 existe para proteger. Costo cero: `serviced` ya viene de `rodeo_weaning_kpi`. | RCC.7.6.a |
| **DP-32** *(Gate 1 N-4)* | TR.14f(b) se **conserva y se rotula** como inalcanzable hoy, en vez de borrarse o de contarse como cobertura. | `0076` hace imposible el estado "owner activo de campo borrado", así que el caso pasa por `ur.active = false` y pasaría igual sin el join a `establishments`. Un verde que no puede ponerse rojo es un verde mentiroso **salvo que esté rotulado**; rotulado, documenta un invariante que vive en otra migración y que se vuelve load-bearing con el flujo de restore que `0076` difiere. | RCC.13.5.c.i |
| **DP-33** *(Gate 1 N-6)* | La garantía del tenant es **asimétrica y se declara**: detalle↔cabecera por constraint (FK compuesta), cabecera↔rodeo por test (RCC.13.6.b). | Cerrar el eslabón de arriba con el mismo mecanismo exigiría `unique (id, establishment_id)` + FK compuesta sobre `rodeos`, una tabla core, por un invariante que hoy no tiene camino de violación (los dos valores salen del mismo `select`). Más blast radius del que el delta quiere. Se declara para que nadie asuma una simetría que no hay. | RCC.13.6.b |
| **DP-20** | `transfer_animal` **no** re-apunta la membresía (a diferencia de lo que hace con `animal_category_history`). | Re-apuntarla movería la historia de rodeo al campo destino: F4 a escala de establecimiento. | RCC.1.13 |
| **DP-21** | Migraciones `0127`–`0130` en cuatro archivos, en el orden de §6. | La tabla de historia y su backfill tienen que existir antes del cómputo; el cómputo histórico antes del cierre. | §6 |
| **DP-22** ✅ **RATIFICADA POR RAF (Puerta 1, 2026-08-07)** | Re-seed: campaña **2024** cerrada y **2025** en curso, no 2025 cerrada. | §9.1: una campaña 2025 no puede tener su destete cargado antes de ~oct-2026. | RCC.11.4 |
| **DP-23** | El contrafactual del test de inmutabilidad usa un tacto **dentro** de la ventana, no las tres mutaciones de estado. | §8.1: con el cómputo histórico arreglado, esas tres tampoco mueven una campaña abierta. | RCC.13.2, RCC.13.3 |

### Pendientes marcados

| Marca | Qué | Dónde |
|---|---|---|
| **[VALIDAR CON FACUNDO]** | DL5: la ventana del tacto de la campaña (ya venía marcado en el `context.md`). | RCC.3.1 |
| **[VALIDAR CON FACUNDO]** | DP-14: acotar el aborto a la ventana de la campaña. | RCC.3.4 |
| **[VALIDAR CON FACUNDO]** | DP-15: los 18 meses de "ciclo completo por vencimiento". | RCC.7.6 |
| **[VALIDAR CON FACUNDO]** | F7 / DP-8: que `entoradas == servidas` sea aceptable como estado transitorio hasta que se redefina *entoradas*. | RCC.2.12 |
| ~~[VALIDAR CON RAF]~~ ✅ | DP-22: campaña cerrada de la demo = 2024, no 2025. **RESUELTO** en la Puerta 1 (2026-08-07): Raf eligió 2024 cerrada + 2025 en curso. **No quedan preguntas abiertas para Raf en esta spec.** | §9.1 |

> **Resuelto por el leader (2026-08-07, ya no es pendiente)**: el **cierre masivo por campo (RCC.10.6) entra en
> este delta**. DL1 ya lo prometió y es la mitigación directa del riesgo #5 de §13 ("el productor nunca cierra"),
> que es el riesgo declarado más alto de la feature: hacer que un campo de 4 rodeos cierre cuatro veces a mano es
> precisamente lo que lo materializa. DP-11 se mantiene sin cambios (N llamadas del cliente, sin RPC de
> establecimiento: la falla parcial visible es lo correcto).

---

## §13 — Riesgos y limitaciones declaradas

| Riesgo | Mitigación / estado |
|---|---|
| El backfill de membresía **miente** para los animales ya movidos de rodeo (DL7). | Declarado en el `comment on table`, en RCC.1.9 y acá. No hay fuente para reconstruirlo (el audit de spec 18 solo cubre `user_roles`, 90 días). El historial fiel empieza en el deploy. |
| La fecha de un movimiento es la del **upload**, no la del hecho en el campo. | Declarada. Un movimiento cargado offline y subido 3 días después queda fechado el día de la subida. Aceptable: el corte de campaña es anual. |
| `exit_date` es una **convención de flujo**, no un invariante de DB (21/21 poblados en DEV, sin constraint). | Si falta, se asume "salió hoy". Declarado. |
| **Cambio de conjunto en el presente** (Gate 1 M-1): un perfil con `status <> 'active'` y `exit_date` **nulo** queda con `to_date = current_date` y por lo tanto **entra en toda campaña pasada**, donde el código viejo lo excluía. No es solo "más restrictivo en el pasado": el reemplazo de `p.status` por el intervalo es **bidireccional**. | Es la consecuencia querida de F2 llevada al borde de los datos sucios. La cota superior del error es "los perfiles no-activos sin `exit_date`", que hoy en DEV son **0 de 21**. Se declara acá porque el `retired` que existía para contarlos ahora es 0 (F7) y nadie más los va a ver. |
| `transfer_animal` re-apunta `animal_category_history` al perfil destino → el perfil de origen se queda sin categoría histórica y cae en la degradación DP-17. | Declarado; anotar en `docs/backlog.md` al cerrar. Es territorio de spec 11, no de este delta. |
| **(#5, el más alto)** El productor **nunca cierra** ninguna campaña. | Riesgo asumido por ADR-032 §5; no se elimina, se mitiga por tres lados: (a) el aviso de `cycle_complete` cuando el ciclo termina; (b) el **cierre masivo por campo** (RCC.10.6), para que un campo de 4 rodeos sea un gesto y no cuatro — sin esto el riesgo se materializa solo; (c) aunque nunca cierre, la campaña queda en vivo pero **con cómputo histórico**, así que ya no se mueve por ventas, movimientos ni recategorizaciones. Lo único que se pierde sin cerrar es la inmunidad a un cambio futuro de fórmula. |
| **(F8)** El productor cierra **de más**: congela una campaña sin partos ni destetes y el 0 % queda para siempre. | Gate de reconocimiento explícito (DP-10): imposible por accidente. Y si lo hace a propósito, el snapshot lo dice (`closed_incomplete` + `missing_at_close`) y la pantalla lo muestra, así que el benchmarking no compara peras con manzanas sin avisar. Queda reversible por `reopen_campaign` mientras no se cierre la campaña siguiente. |
| Costo de `animal_category_at` por perfil (N lookups por llamada). | Índice `animal_category_history_by_profile (animal_profile_id, changed_at desc)` ya existe (`0030:19`). Para 350 cabezas es despreciable; si un rodeo de 5.000 se pusiera lento, se pasa a un `lateral join` único. |
| Cambio de comportamiento visible: una vaca vendida **vuelve a aparecer** en campañas pasadas. | Es el fix (F2), no una regresión. Puede sorprender a Facundo en la demo → mencionarlo. |

---

## §13-bis — Anexo LOW de Gate 1 (aplicado)

| # | Qué | Resolución |
|---|---|---|
| **L-1** | `P0002` antes del guard = oráculo de existencia de `rodeo_id`. | **Sin cambio**, a propósito: es idéntico al as-built (`0105:103`, `0106:67`), el UUID no es adivinable y `reports.ts` mapea `P0002` y `42501` al mismo `forbidden`. Queda anotado para que nadie lo "arregle" en una sola función y rompa la simetría. |
| **L-2** | Política de borrado del actor inconsistente: `closed_by`/`reopened_by` con `on delete set null`, `changed_by` de membresía en `NO ACTION` (molde `0030`). | **Se unifica en `on delete set null`** para las tres columnas de actor del delta. Fundamento: derecho de supresión (Ley 25.326) gana sobre conservar el nombre del actor; y el hecho auditado (qué se cerró, cuándo, con qué números) sobrevive igual. Se aparta del molde `0030` a propósito y se dice por qué. |
| **L-3** | El guard de `mitropero.yaml` es un match de texto case-sensitive. | **Case-insensitive** (RCC.13.10) + queda escrito que no puede ver una edición manual en el dashboard de PowerSync — que el propio header del YAML ya declara fuera de proceso (los deploys van por `scripts/powersync-deploy.sh`). |
| **L-4** | `animal_category_at` no tiene guard de tenant; solo la protege el `revoke`. | `comment on function` explícito: *"sin guard a propósito: no es alcanzable por PostgREST. Si alguna vez se le da `grant`, hay que agregarle el guard PRIMERO."* |
| **L-5** | El `establishment_id` denormalizado de `rodeo_membership_history` puede quedar viejo (el trigger no dispara con `update of establishment_id`). | `comment on column` explícito: *"no es frontera de autorización — la RLS de esta tabla usa `establishment_of_profile()` (DP-19). Puede quedar stale. El día que alguien 'optimice' la policy a `has_role_in(establishment_id)`, primero hay que agregar `establishment_id` a la lista de columnas del trigger."* Hoy es inocuo porque `transfer_animal` crea un perfil nuevo en vez de mover el existente. |

## §14 — Coordinación

- **`feature_list.json` no se toca**: la feature 07 queda en `done` (ADR-028 no agrega estados). Este delta no
  altera su estado ni el de ninguna otra feature.
- **`progress/current.md`, `progress/qa_maniobras-device.md`, `docs/marketing/**`,
  `app/src/features/ble-stick/**`, `specs/active/04-bluetooth-baston/**` y
  `specs/active/02-modelo-animal/*ficha-categoria-tacto*` no se tocan** (otras dos terminales activas).
- **`app/app/(tabs)/reportes.tsx`**: cambios sin commitear de otra terminal — ver el aviso de §7.3.
- **El delta `ficha-categoria-tacto` de spec 02 depende de que un tacto sin jornada siga entrando a los KPI** →
  RCC.12.1 + el guard de RCC.12.2 lo protegen. Si alguna de las 7 funciones necesitara `session_id`, se para y
  se coordina.
</content>

---

## §15 — As-built: reconciliación tras la implementación (2026-08-07)

> Lo que quedó CONSTRUIDO distinto de lo que decía este documento, con el motivo. Regla
> `feedback_correcciones_en_specs`: nunca se deja una spec que contradiga al código. Todo lo de acá está
> aplicado en `supabase/migrations/0127`–`0130`, `supabase/tests/reports/run.cjs` y el frontend del §7.
> Nada de esto cambia una decisión de dominio (D1-D3, DL1-DL10, ①/②): son correcciones de mecanismo, y
> **tres de ellas son defectos de esta spec que la implementación encontró al ejecutarlos**.

| # | Qué decía | Qué quedó | Por qué |
|---|---|---|---|
| **R1** | §6-bis: lista blanca de **11** funciones públicas + barrido `rodeo\_%`. | **14**: se suman `rodeo_sessions_list`, `rodeo_weight_by_category` e `is_owner_or_vet_of`; y el barrido suma los prefijos `close\_%` / `reopen\_%`. | **La migración no aplicaba.** Verificado contra el catálogo del remoto: `rodeo_sessions_list(uuid)` y `rodeo_weight_by_category(uuid,uuid)` son públicas, están concedidas a `authenticated` y **matchean `rodeo\_%`** → el loop (1) las tomaba por internas y abortaba `0128`/`0129`/`0130`. Los prefijos nuevos cierran el hueco simétrico: `close_campaign` no matchea ninguno de los tres originales, así que un typo en la lista blanca lo dejaba fuera de **los dos** loops (que es exactamente el N-2 de Gate 1, un nivel más abajo). |
| **R2** | T42/T32: `revoke`/`grant` escritos a mano **con la firma tipada completa**. | Se **derivan del catálogo** (`pg_get_function_identity_arguments`) dentro del mismo `DO` que corre los dos checks. | RCC.9.6 exige que la lista blanca sea la **única** enumeración de la migración: con `revoke`/`grant` escritos aparte hay dos. Derivándolos, la firma es correcta **por construcción** y el `42883` que T42 previene deja de ser posible. (No es SQL dinámico con input de usuario: es `format('%I(%s)')` sobre el catálogo, dentro de una migración — §5.10 habla de los cuerpos de las funciones.) |
| **R3** | §8.1-bis / T48-α: descubrimiento por `pg_get_function_identity_arguments(oid) = 'uuid, integer'`. | `oidvectortypes(p.proargtypes) = 'uuid, integer'`. | **El oráculo no podía funcionar.** Medido: `identity_arguments` devuelve `"p_rodeo_id uuid, p_year integer"` (con nombres) → 0 descubiertas → el piso `>= 9` rojo para siempre y los dos oráculos de tenant/cota **sin ejecutarse nunca**. Con el fix, hoy descubre 8 (pre-apply) y 9 post-apply. |
| **R4** | T64: "reusar `BulkConfirmSheet`". | `app/src/components/reports/CampaignCloseSheet.tsx`, **moldeado** sobre él (mismo shell, mismo copy reversible, mismo `useSafeBottomInset`). | Las props de `BulkConfirmSheet` son de dominio de la operación masiva de animales (`operation: 'castrate'|'wean'`, `summary: SelectionSummary` con desglose por categoría, futuros toritos y overrides). Reusarlo exigía inventar una `SelectionSummary` falsa y una "operación" que no existe: degradaba los dos componentes. Se reusa la **estructura**, que es lo que el molde aporta. |
| **R5** | T48-ε: `prosecdef = true` en **todas** las funciones del delta. | `prosecdef` en las **15 que tocan datos**; `search_path` fijado en **las 18**. | Las tres puras (`campaign_tacto_bounds`, `campaign_cycle_complete`, `campaign_missing_summary`) **no son `SECURITY DEFINER` por diseño** (§3.2 y §4.1-bis: operan sobre los valores que les pasa el caller, no hay nada que autorizar) y están revocadas de los tres roles. Exigirles `definer` habría contradicho al propio design. |
| **R6** | — (no estaba) | El helper `createAnimal` de `supabase/tests/reports/run.cjs` escribe **`entry_date`** (default: la fecha de nacimiento). | Sin `entry_date`, el trigger de `0127` abre la membresía **hoy**, así que los fixtures no pertenecen al rodeo en la fecha de corte de una campaña pasada y **TR.4b y TR.11 (que usan `lastYear`) se ponen rojas post-apply por el calendario, no por una regresión**. Es el mismo requisito que RCC.11.2 le pide al re-seed, un nivel más abajo. |
| **R7** | §3.5: `rodeo_campaign_calves` = `rodeo_campaign_births ⋈ birth_calves`. | Igual — con la **consecuencia declarada**: si una madre tuviera **dos** partos imputables a la misma campaña, `weaned`/`pending_weaning` cuentan solo las crías del de concepción más temprana. | `rodeo_campaign_births` es `distinct on (madre)` (molde `0106`), así que partir de ella unifica la convención "un parto por hembra por campaña" que ya sostenía `calved == total_born`. El as-built de `0118` contaba las crías de los dos partos: es un cambio de conjunto en un borde raro, y va escrito en el `comment on function` en vez de quedar como sorpresa. |
| **R8** | — | El rótulo **TR.12 quedó duplicado** en `run.cjs`. | El delta `ficha-categoria-tacto` (spec 02) tomó `TR.12` para su test de tacto suelto **al mismo tiempo** que este delta lo tomaba para el oráculo de inmutabilidad (dos terminales en paralelo). Los dos conviven; los de este delta llevan `(campañas congeladas)` en el título y el header de la suite lo declara. |
| **R9** | — | `CampaignCloseSheet` llama `useDismissKeyboardOnOpen()`. | Lo exige el guard de clase `sheet-keyboard-dismiss-guard` (todo overlay con `$scrim` baja el teclado al abrirse). El guard **cazó el sheet nuevo en el primer `check.mjs`**: funcionó exactamente como fue diseñado. |
| **R10** | §7.2: `campaignStateView(s: CampaignStatus \| null)`. | `campaignStateView(s: CampaignStatusLike \| null)`, con el tipo declarado **estructuralmente** en `reports-format.ts`. | `services/reports.ts` ya importa de `utils/reports-format.ts`; importar su tipo desde ahí cerraba un ciclo. TypeScript es estructural → un `CampaignStatus` entra sin cast. **Además**: cuando la campaña está cerrada a medias **y** tiene datos nuevos, se muestran **los dos** avisos (uno por línea) — la tabla de §7.2 los tenía en filas separadas y no decía qué pasa cuando coinciden. |
| **R11** | §8.1 / T44: "…`close_campaign`; aplicar las cuatro mutaciones…". | El cierre de TR.12 va con **`p_acknowledge_incomplete = true`**. | El escenario del probe tiene `pending_weaning = 1` (lo fija el propio T44), o sea **ciclo incompleto** → sin reconocimiento el cierre se rechaza con `23514`, que es lo correcto y lo que prueba TR.14d. Se documenta en el test para que nadie lo lea como una licencia. |

### §15-bis — Segunda tanda de reconciliaciones (fix-loop de la Puerta 2, 2026-08-07)

> Del **reviewer** (CHANGES_REQUESTED, `progress/review_campanas-congeladas.md`) y del **Gate 2** (FAIL,
> `progress/security_code_07-campanas-congeladas.md`). Mismo criterio que §15: acá va **cómo quedó
> construido**, no cómo se había pensado.

| # | Origen | Qué quedó |
|---|---|---|
| **R12** | Gate 2 **H-C1** | `0127`/`0128` emiten `revoke all ... from public, anon, authenticated` **antes** de sus `grant select`. Motivo: el `pg_default_acl` de este proyecto concede `Dxtm` —**`D` = TRUNCATE**— a `anon` y `authenticated` en toda tabla que `postgres` cree en `public`, y **la RLS no puede restringir TRUNCATE** (no existe policy de TRUNCATE: `pg_policies.cmd` solo toma DELETE/INSERT/SELECT/UPDATE). **No es una condición que introduzca este delta** —alcanza a las 35 tablas del schema, el molde `animal_category_history` incluido, y el barrido general quedó anotado en `docs/backlog.md`—, pero sobre estas tres está escrito el invariante que sostiene el desvío de ADR-026 (DP-19), así que su ACL tiene que decir lo mismo que el comentario. El `comment on column` de la cabecera se reescribió: antes afirmaba "no existe grant de escritura a authenticated" (falso al momento del apply) y nombraba como guard a TR.14e, que **no podía verlo** (PostgREST no expone TRUNCATE y `pg_policies` no tiene esa categoría). Precedente del repo: `0068:208`. |
| **R13** | reviewer **H-4** | El invariante detalle↔cabecera (RCC.4.7) pasa a estar **verificado antes del commit** en vez de prometido — ver §2.4. |
| **R14** | reviewer **H-5** + Gate 2 **M-C2** + reviewer **RR-1** | **La lista blanca enumera FIRMAS, no nombres**, y cada entrada se resuelve con `to_regprocedure` al `oid` de esa función exacta. La primera versión de este arreglo barría por `oid` pero **construía los `oid` seleccionando por `proname`**, así que `oid ∈ v_oids` era idénticamente equivalente a `proname ∈ v_public`: un no-op con un comentario que afirmaba lo contrario (RR-1, y la tercera vez en esta unidad que un texto promete lo que el código no hace). **Medido** con la sobrecarga `rodeo_serviced_females(uuid,integer,uuid)` creada y concedida a `authenticated` dentro de `begin/rollback`: la lista por NOMBRE la detecta **0** veces; la lista por FIRMA, **3** (una por rol). Con firmas, además, un typo en una entrada deja a la función real fuera de `v_oids` → cae en el barrido de internas → **el apply aborta**. `0130` conserva el tercer loop, que ahora verifica que **cada firma resuelva** (cubre también a `is_owner_or_vet_of`, que no matchea ningún prefijo). El loop (2) queda, con su comentario diciendo qué es: verificación del estado final. |
| **R15** | Gate 2 **M-C1** | El `comment on table` de `0127` decía "no sincroniza porque no está en el YAML", que confunde dos capas. Reescrito con el texto de la cabecera de `0124`: la publicación `powersync` es **FOR ALL TABLES** y el default ACL le da `SELECT` a `powersync_role`, así que las filas **sí cruzan al slot de replicación** (no se puede excluir una tabla de un FOR ALL TABLES); lo que las mantiene fuera de los **devices** es que ninguna sync stream las nombra, y no hay catch-all. TR.19 suma el assert de `puballtables` para que, si esa premisa cambiara, el comentario se ponga rojo. |
| **R16** | Gate 2 **M-C3** — **RETIRADO: la premisa del gate era falsa** | M-C3 afirmaba que en esta base una función nueva **no** nace `EXECUTE`-able por `PUBLIC`, y el reviewer lo ratificó en su H-5. Lo apliqué a los comentarios de tres migraciones **sin medirlo yo** — y es falso. Medición directa (crear una función sin grant/revoke dentro de `begin/rollback`): `quien_crea = postgres`, **`proacl = NULL`** (= default built-in) y `public_x = anon_x = auth_x = TRUE`. El `pg_default_acl` de `postgres` sobre funciones de `public` (`postgres=X`) **suma** privilegios; no revoca el `EXECUTE` a `PUBLIC` del built-in. Los dos gates infirieron el default mirando funciones cuyo ACL era `postgres=X/postgres` — funciones a las que su propia migración ya les había hecho el `revoke`: inferir el default desde objetos modificados. **Consecuencia**: los `revoke` de las 7 internas y el del loop (0) son **load-bearing**, no defensa en profundidad (sin ellos, `campaign_tacto_bounds` y compañía quedan invocables por `anon`), el loop (2) es un oráculo real, y el hueco del typo de H-5 era **de exposición**, no de disponibilidad. Los tres comentarios quedaron con la medición escrita. |
| **R17** | reviewer **H-1** | `campaignStateView(null)` devuelve un estado **`desconocido`** (título neutro "Campaña", sin fecha y sin acciones) en vez de afirmar "Campaña en curso"; el hint de la sección se calla por el mismo motivo; el test asserta la **ausencia** de afirmación (antes verificaba la afirmación que su propio nombre negaba, y con eso congelaba el defecto); y `useCampaignStatus` **etiqueta el resultado con la clave `(rodeo, año)`** que lo produjo y lo descarta si cambió, para que la etiqueta de una campaña no sobreviva al cambio de año o de rodeo. El `useReport` genérico **no se toca**: su anti-parpadeo es correcto para los números y equivocado solo para la etiqueta que los califica. Reconcilia §7.2 y §7.4. Capture nuevo: `10-campana-desconocida`. |
| **R18** | reviewer **H-2** | La corrección de `entry_date` (R6) se propagó a `supabase/tests/puesta-en-servicio/run.cjs`, el **otro** consumidor de las funciones reescritas (13 call sites): sin ella, TPS.9/TPS.15 pasaban hasta el 30/11 y se caían enteras desde el 1/12, por calendario y sin regresión detrás. Además se reescribió el comentario y el mensaje de TPS.15, que post-delta eran **falsos**: lo que saca del conjunto a la vaca vendida ya no es `p.status = 'active'` —ese filtro se eliminó a propósito, es la fuga F2— sino que el trigger cierra su membresía con `to_date` anterior al corte. **Consumidores medidos: dos** (`reports` y `puesta-en-servicio`); no hay un tercero. |
| **R19** | reviewer **H-3** | La rama `ai_females` tiene oráculo propio: TR.13(g) siembra una **ternera** —que por categoría no es elegible en la rama natural, y el fallback por edad es solo para vaquillonas, así que su único camino al conjunto es el evento de IA— y le aplica los dos contrafactuales históricos (entró al rodeo después del corte / salió antes del corte). TR.20 congela una fila con `source = 'ai'` y asserta **la mezcla** (3 natural + 1 ai) en vez del `every(source === 'natural')` anterior, que era una aserción inversa. |
| **R20** | reviewer **H-6/H-7** | Cerrados con oráculo: **RCC.5.11** (guard de cableado `app/src/services/reports-online-guard.test.ts` — los helpers chequean conexión **antes** del fetch y ningún wrapper exportado se saltea el helper; registrado en `run-tests.mjs`), **RCC.10.4** (la regla pasa a la función pura `campaignCclMonths`, que además **arregla un bug real**: el `??` encadenado de la pantalla hacía que una campaña cerrada **sin** meses configurados cayera a los del rodeo de hoy — F5 reintroducida por un operador), **RCC.4.6/7.2** (TR.20 borra un `animal_profiles` y verifica que la fila del detalle sobrevive con `animal_profile_id` nulo y el `idv` congelado, y que la RPC cerrada sigue devolviendo `serviced` filas), **RCC.9.12** (assert textual rotulado sobre el cuerpo de `rodeo_campaign_status`), **RCC.9.8** (TR.14i: dos cierres **concurrentes** con `Promise.all` — oráculo probabilístico declarado como tal, pero el assert de "una sola foto vigente" es sobre el estado final y no puede dar falso verde) y **RCC.11.10** (TR.14i: los dos `close_campaign` en **una** transacción, por el mismo transporte que usa el runbook del §9 y con `rollback` al final → el oráculo corre y el estado no se mueve). **H-7**: un caso de `closedAt` con la forma real del contrato (`timestamptz` con hora) y la expectativa **computada** con getters locales, para que el test no dependa del huso del runner. |

### §15-ter — Veto visual del Gate 2.5 (2026-08-07)

| # | Hallazgo | Qué quedó |
|---|---|---|
| **R21** 🟠 | Tras el rechazo del server, la hoja dejaba **dos botones adyacentes que empiezan con la misma palabra**: "Cerrar campaña" (relleno, primario) y "Cerrar igual con estos datos incompletos" (contorno). El primero es el mismo `onConfirm(false)` que el server **acaba de rechazar**: estaba garantizado que volvía a fallar, y era el de más peso visual y mejor target de Fitts. Prevención de error (Nielsen #5) al revés, y en la manga —con guante o barro— un slip esperando pasar. Peor: degradaba a ruido el control de dos toques que DP-10 existe para proteger. | Los controles de la hoja salen de una función **pura**, `campaignCloseActions` (`reports-format.ts`), y el `.tsx` solo mapea `kind` → variante. Con `acknowledgeAvailable`, el intento sin reconocimiento **desaparece** y **no queda ningún control primario**: reconocer y volver son los dos de contorno, con la explicación del rechazo arriba. Ninguna acción con `acknowledge === true` puede tener peso de primario **por ningún camino** (el test barre el espacio de estados). |
| **R22** 🟠 | "Reabrir campaña" era un botón de contorno a **ancho completo**: el elemento interactivo más grande de una campaña cerrada. Invertido — sobre una foto la acción frecuente es **leerla**, y reabrir es rara y semi-destructiva (des-congela lo que ADR-032 declara inmutable). La jerarquía contradecía al texto. | Pasa a **acción de texto alineada a la derecha**, sin competir con los números, pero con target real (`$chipMin` 40 + `hitSlop` 8). La asimetría con "Cerrar campaña" (que sigue siendo botón) es **deliberada**: cerrar es lo que la app quiere y sugiere (D1); reabrir es la salida de emergencia. Oráculo en el capture: el alto del target de reabrir es **≥ 40** y **< la mitad** del alto de la tarjeta. |
| **R23** 🟡 | (a) Recuadro con borde dentro de una tarjeta con borde, los dos en terracota: la severidad duplicada sin información nueva. (b) Sospecha de que el color del detalle leía como "family de alerta". | (a) El aviso pierde su borde propio: la tarjeta ya carga la severidad. (b) **Medido, no estimado** — el detalle es `$textMuted` `rgb(92,101,95)` sobre `$surface` `rgb(248,246,241)` a 13 px = **5,58:1 (AA ✔)**, un gris-verde neutro que **no** es de la familia del terracota; lo que leía como alerta era el chrome (el borde duplicado de (a)). El capture ahora **mide el contraste** de título/detalle/aviso y falla por debajo de 4,5:1, así que la próxima vez no hay que estimarlo. |

**Números medidos en el capture** (`getComputedStyle` sobre el render real, viewport 412×915):

| Elemento | Color | Fondo | Tamaño | Contraste |
|---|---|---|---|---|
| Título de la barra | `rgb(15,14,12)` | `rgb(248,246,241)` | 16 px | **17,86:1** ✔ |
| Detalle ("Foto del 14/03/2026 · la cerró Facundo") | `rgb(92,101,95)` | `rgb(248,246,241)` | 13 px | **5,58:1** ✔ |
| Aviso ("Se cerró con…") | `rgb(23,23,23)` | `rgb(250,249,249)` | 16 px | **17,06:1** ✔ |

De referencia, el token que **no** se usa: `$textFaint` sobre `$surface` da **3,92:1** — por debajo de AA para texto normal. Es el caso que el repo ya se comió una vez.

### §15.2 — Lo que queda declarado como límite (sin oráculo, a propósito)

| Requisito | Por qué no tiene oráculo |
|---|---|
| **RCC.1.13** (`transfer_animal` no re-apunta la membresía) | Es **ausencia de código** en `0087`, que este delta no toca. Un oráculo exigiría montar el flujo completo de transferencia (dos establecimientos con rol del mismo usuario, la RPC y su GUC) para verificar que **algo no pasó**. Se sostiene por: (a) `git diff` vacío sobre `0087`; (b) el `comment on function` del trigger de `0127`, que dice explícitamente por qué NO hay que "arreglar" la asimetría con `animal_category_history`; (c) TR.15, que verifica que el ciclo archivar-origen / crear-destino escribe las filas correctas. |
| **RCC.5.10 / 5.10.a** (cierre masivo en dos pasadas) | Vive en un hook de React y el repo no monta react-testing-library. Cubierto por el capture 08 (el resultado por rodeo, con la falla parcial visible) + lectura. La parte pura (`campaignStateView.missing`, que alimenta la lista de lo que falta) sí tiene tests. |
| **RCC.10.6 / 10.7 / 10.10** (composición de la pantalla) | Misma razón. Cubierto por los 10 captures del Gate 2.5 y el veto del leader (ADR-029). |

### §15-quater — Post-apply (2026-08-07): TR.14h no probaba su enunciado

El apply destapó que **TR.14h fallaba con `23505`, no con `23503`**: la fila que insertaba reusaba un perfil
que YA estaba en el bucket `serviced` del snapshot, así que el índice único
`(snapshot_id, bucket, animal_profile_id)` la rechazaba **antes de que la FK compuesta llegara a opinar**. La
fila se rechazaba igual, pero el oráculo no distinguía *"la FK funciona"* de *"la FK no está y me salvó el
índice"* — y la FK existe precisamente para dar esa garantía **estructural** (RCC.4.8.b). Arreglado con una
fila **única-safe** (un perfil ausente del snapshot) y el **contrafactual** de tenant correcto, que es lo que
hace que el test se ponga rojo si mañana alguien borra la FK. Mismo barrido en otros 4 asserts que
verificaban el rechazo sin verificar su código.

### §15.1 — Lo que queda ROJO hasta el apply (esperado)

> **SUPERADO (2026-08-07)**: con las 4 migraciones aplicadas, la suite da **36/36**. Lo de abajo queda como
> registro del estado pre-apply.

`supabase/tests/reports/run.cjs`: **18 de 35** tests en rojo, **todos** del delta y **todos** por la misma
causa (`PGRST202 Could not find the function public.close_campaign…` / `relation "public.rodeo_membership_history"
does not exist` / los dos contrafactuales del cómputo histórico, que hoy fallan **porque el defecto todavía
está vivo**). Los **17 verdes** incluyen **todos** los tests preexistentes (TR.1–TR.11, el TR.12 de spec 02 y
los dos TR.10), o sea que el cambio de `createAnimal` (R6) no rompió nada. Post-apply (T73) deben quedar 35/35.
