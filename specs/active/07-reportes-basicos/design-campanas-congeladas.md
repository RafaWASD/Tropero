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
| `supabase/tests/reports/run.cjs` | **MODIFICAR.** TR.12 (inmutabilidad + los dos contrafactuales), TR.13 (cómputo histórico), TR.14 (authz/grants de lo nuevo), TR.15 (membresía), TR.16 (DL10), TR.17 (regresión tacto sin jornada + guard `session_id`), TR.18 (`entoradas == serviced`), TR.19 (guard de ausencia en `sync-streams/rafaq.yaml`). Extender TR.10 con las funciones nuevas. |

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
| INSERT, perfil en padrón | insert `[coalesce(entry_date, created_at::date), NULL)` | `initial` (o `transfer_in` si `current_setting('rafaq.is_transfer', true) = 'on'`) |
| INSERT, perfil ya fuera del padrón | insert `[from, greatest(coalesce(exit_date, current_date), from))` | ídem |
| UPDATE `rodeo_id` cambia, sigue en padrón | cierra la vigente con `to_date = current_date`; abre `[current_date, NULL)` | `move` |
| UPDATE sale del padrón | cierra la vigente con `to_date = greatest(coalesce(new.exit_date, current_date), from_date)` | — |
| UPDATE vuelve al padrón sin fila vigente | abre `[current_date, NULL)` | `reactivation` |

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
```

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

### §2.4 — Decisión: **enum multi-fila**, no booleanos

| | (a) enum multi-fila **[ELEGIDA]** | (b) una fila por animal con booleanos |
|---|---|---|
| "mismo animal en varios buckets" | estructural: 3 filas | requiere 5 columnas y no olvidarse de ninguna |
| escritura en `close_campaign` | 5 `insert … select` derivados de las **mismas** CTE que produjeron cada número | un `full outer join` de 5 conjuntos + `group by` para plegarlos en una fila |
| auditabilidad | `count(*) filter (bucket='pregnant')` **debe** dar el `pregnant` de la cabecera → invariante testeable (RCC.4.7) | igual verificable, pero el plegado intermedio puede introducir el error que se quiere detectar |
| el bucket `weaned` | su sujeto es la **cría**, no la madre: una fila propia con `mother_profile_id` lo dice explícito | una fila "de animal" con 4 booleanos en false y `is_weaned` en true mezcla dos poblaciones en la misma columna |
| agregar un bucket | `alter type … add value` + un `insert` más | `alter table … add column` + tocar el plegado |
| costo | ~3 filas por vientre + 1 por cría ≈ 1.500/campaña/rodeo | ~650 |

Gana (a). El argumento decisivo es el segundo: el detalle **es** la evidencia del número, y sale del mismo
`select` que lo calculó, sin un paso de transformación en el medio que pueda mentir. El costo en filas es
irrelevante (~1.500 filas por campaña por rodeo).

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

`SECURITY DEFINER` **VOLATILE** (escribe) `set search_path = public`. Molde de escritura: `exit_animal_profile`
(`0044`) y `register_birth` (`0116`).

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
   create temp table _snap_serviced on commit drop as
     select * from public.rodeo_serviced_females(p_rodeo_id, p_year);
   create temp table _snap_tacto    on commit drop as
     select * from public.rodeo_campaign_tacto(p_rodeo_id, p_year);
   create temp table _snap_births   on commit drop as
     select * from public.rodeo_campaign_births(p_rodeo_id, p_year);
   create temp table _snap_calves   on commit drop as
     select * from public.rodeo_campaign_calves(p_rodeo_id, p_year);
   select * into v_preg  from public.rodeo_pregnancy_kpi   (p_rodeo_id, p_year);
   select * into v_calv  from public.rodeo_calving_kpi     (p_rodeo_id, p_year);
   select * into v_ccl   from public.rodeo_ccl_distribution(p_rodeo_id, p_year);
   select * into v_stage from public.rodeo_calving_by_stage(p_rodeo_id, p_year);
   select * into v_wean  from public.rodeo_weaning_kpi     (p_rodeo_id, p_year);
   ```
   Los cinco KPI se persisten **tal cual los devuelve la lectura en vivo** (DL2): la foto es, por construcción,
   igual al reporte que el productor estaba viendo cuando apretó el botón.
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

### §4.3 — `reopen_campaign(p_rodeo_id uuid, p_year int) returns uuid`

Mismo guard, misma cota, mismo `P0002`. Reglas:

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
| `is_closed`, `snapshot_id`, `closed_at`, `closed_by`, `closed_by_name` | snapshot vigente ⋈ `users.name` |
| `closed_incomplete`, `missing_at_close` | del snapshot vigente (F8) |
| `service_months`, `n_months`, `state_as_of` | del snapshot si está cerrada; de `rodeo_service_campaign` si no (F5) |
| `pending_pregnant`, `pending_weaning`, `missing_summary` | del snapshot si está cerrada; de `rodeo_calving_kpi`/`rodeo_weaning_kpi` + `campaign_missing_summary` si no → la UI enumera qué falta sin llamar a los KPI (RCC.7.7) |
| `can_close` | `is_owner_or_vet_of(v_est) and not is_closed and state_as_of <= current_date` |
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
| **§5.5** | tenant por el JOIN a `animal_profiles`, no por la columna denorm de las tablas hijas | Se conserva: el `join member` filtra por `rodeo_id`, y el tenant lo sigue poniendo `p.establishment_id = v_est` sobre `animal_profiles`. `rodeo_membership_history` **no** se usa como frontera de tenant. |
| **§5.6** | excluir el perfil borrado en el JOIN | `p.deleted_at is null` se conserva. `p.status = 'active'` se **quita a propósito** (es F2) y se reemplaza por el intervalo de membresía, que es un filtro **más** restrictivo en el pasado y equivalente en el presente. |
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
| **W5** | **Tablas nuevas sin camino de escritura del cliente.** | `grant select` únicamente. Las escribe el trigger (`SECURITY DEFINER`) o `close_campaign`/`reopen_campaign`. Por eso la RLS de las de snapshot puede usar el `establishment_id` denormalizado (§2.3). |
| **W6** | **Idempotencia y carrera.** | Índice único parcial `(rodeo_id, campaign_year) where reopened_at is null` + `exception when unique_violation then` → devuelve el existente. Dos cierres concurrentes no producen dos fotos. |
| **W7** | **El cierre no toca datos de negocio.** | Las únicas escrituras son sobre las 2 tablas de snapshot. Testeado con conteos antes/después de `animal_profiles`, `reproductive_events`, `weight_events` (RCC.13.12). |
| **W8** | **Cota de costo.** | El cierre agrega sobre un rodeo y una campaña; `p_year` acotado; el detalle es proporcional al tamaño del rodeo. No hay escaneo por establecimiento ni por historial completo. No se expone `p_limit` porque no hay input del cliente que module el volumen. |
| **W9** | **Funciones internas no alcanzables por PostgREST.** | `revoke execute … from public, anon, authenticated` sobre `rodeo_campaign_tacto`, `rodeo_campaign_births`, `rodeo_campaign_calves`, `animal_category_at`, `campaign_tacto_bounds`. Testeado (RCC.13.6). |
| **W10** | **El trigger es `SECURITY DEFINER set search_path = public`** (molde `0030`) y toma `establishment_id` **de la fila padre**, nunca de un valor del cliente (anti-spoof, ADR-026). |
| **W11** | **PII**: ninguna tabla nueva guarda PII (ADR-025). `closed_by`/`changed_by` son FK a `users(id)`; el nombre se resuelve por JOIN dentro de una RPC con guard, no se denormaliza. |
| **W12** | **Superficie de sync**: las 3 tablas quedan **fuera** de `sync-streams/rafaq.yaml` (DL8) → no amplían la frontera del wire ni el bucket count. Guard de ausencia en la suite (RCC.13.10). |

### §5.C — Códigos de error (contrato con el cliente)

| Código | Cuándo | Mapeo en `reports.ts` |
|---|---|---|
| `42501` | sin rol / rol insuficiente (IDOR incluido) | `forbidden` |
| `P0002` | rodeo inexistente o borrado | `forbidden` |
| `22023` | `p_year` fuera de `1900..current+1` | `validation` |
| `23514` | (a) cerrar una campaña cuyo servicio no terminó **[no reconocible]**; (b) cerrar con el ciclo incompleto sin `p_acknowledge_incomplete` **[reconocible]**; (c) reabrir con la campaña siguiente cerrada | **`conflict`** (nuevo `kind`, con mensaje accionable) |

El cliente distingue (a) de (b) por `rodeo_campaign_status`: si `can_close` es falso, es (a) y no hay
reintento posible; si `can_close` es verdadero y `cycle_complete` es falso, es (b) y el reintento con
reconocimiento es la salida. No se inventa un código nuevo ni se parsea el texto del mensaje.

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
| false | — | — | — | sin permiso | Campaña en curso | ídem | — | ninguna |
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

### §8.2 — Los demás bloques

| Bloque | Qué cubre | Requisitos |
|---|---|---|
| **TR.13** cómputo histórico | animal que entró al rodeo **después** del corte → no cuenta; animal que salió **antes** del corte → no cuenta; animal vendido/movido/recategorizado **después** del corte → cuenta con el número de entonces; veredicto `no_apta` posterior al corte → no borra la campaña; fallback por edad evaluado al corte (F3-bis: una vaquillona que hoy tiene 400 días pero al corte tenía 200 → **no** cuenta); `p_year` sin animales presentes → `serviced = 0` (el año deja de ser decorativo). | RCC.2.*, RCC.12.6 |
| **TR.14** authz | owner de B sobre rodeo de A → `42501` en las 3 RPC; `field_operator` de A → `42501` en `close`/`reopen` y **OK** en `status` y en los 6 KPI; `veterinarian` de A → OK en las 3; `22023`/`P0002`; `23514` de precondición y de reapertura; idempotencia de `close`; `close` no muta filas de animales. | RCC.5.*, RCC.6.*, RCC.9.4, RCC.13.12 |
| **TR.14d** ciclo incompleto (F8) | ciclo incompleto sin ack → `23514` **y el mensaje nombra lo que falta** (regex sobre "preñadas sin parir"/"crías sin destetar"); **no se creó ninguna fila** de snapshot; con ack → cierra y `closed_incomplete = true` con `missing_at_close` no nulo, expuesto por `rodeo_campaign_status`; ciclo **completo** → cierra **sin** ack y `closed_incomplete = false`; `campaign_cycle_complete` da lo mismo desde `close_campaign` y desde `rodeo_campaign_status` en el mismo escenario; y el guard **no reconocible**: con `state_as_of > current_date`, `ack = true` **igual** falla con `23514`. | RCC.5.7, RCC.5.7.a–d, RCC.4.11, RCC.7.7, RCC.13.9.a–c |
| **TR.14b** grants | `anon`/`public` no ejecutan `close_campaign`, `reopen_campaign`, `rodeo_campaign_status`; **`authenticated` no ejecuta** `rodeo_campaign_tacto`, `rodeo_campaign_births`, `rodeo_campaign_calves`, `animal_category_at`, `campaign_tacto_bounds`. Extender el array de TR.10. | RCC.9.5, RCC.13.6 |
| **TR.15** membresía | apertura al insertar (con `entry_date` y sin él); cierre + apertura al mover; cierre al dar de baja con `exit_date`; invariante de una sola fila vigente (intento de romperlo → `23505`); backfill idempotente (segunda corrida no duplica); RLS (owner de B no ve filas de A); `transfer_animal` deja la historia en el origen. | RCC.1.* |
| **TR.16** DL10 | tras cerrar: insertar un `tacto` de la campaña **no falla**; los 5 KPI no se mueven; `rodeo_campaign_status.has_new_data = true`; tras `reopen` + `close`, el KPI **sí** incorpora el dato y hay un snapshot nuevo con el viejo `reopened_at`. | RCC.8.*, RCC.6.5 |
| **TR.17** regresión | un `tacto` con `session_id = null` sigue contando en preñez/parición/CCL; **guard de clase**: `pg_get_functiondef` de las 7 funciones no contiene `session_id`. | RCC.12.1, RCC.12.2 |
| **TR.18** denominador | `entoradas === serviced` y `retired === 0` en todos los escenarios. | RCC.2.12 |
| **TR.19** guard de ausencia | leer `sync-streams/rafaq.yaml` y fallar si menciona `rodeo_membership_history`, `rodeo_campaign_snapshots` o `rodeo_campaign_snapshot_animals`. | RCC.13.10 |
| **TR.20** consistencia detalle↔cabecera | por cada bucket, `count(*)` del detalle == el número congelado; y `rodeo_serviced_females` con la campaña cerrada devuelve exactamente `serviced` filas. | RCC.4.7, RCC.7.2 |

El `cleanup()` existente ya borra por `establishment_id` en cascada; las tres tablas nuevas tienen FK a
`establishments … on delete cascade`, así que **no hace falta tocarlo**. Se verifica igual.

---

## §9 — Re-seed de "La Facundina" (D2)

**Ejecutor**: el **leader**, por Supabase MCP, tras el apply de las 4 migraciones y con autorización de Raf.
No lo hace el implementer (es escritura sobre la DB de DEV compartida).
**Objetivo**: `establishment_id = fac00000-face-4000-a000-000000000010` con una campaña cerrada y correcta y una
campaña en curso, en los dos rodeos (`Servicio Invierno {6,7,8}`, `Servicio Primavera {10,11,12}`).

### §9.1 — El año de la campaña cerrada **no puede ser 2025** — [VALIDAR CON RAF]

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

1. **Backup** (`node scripts/backup-db.mjs`) antes de borrar nada.
2. **Borrado acotado** al `establishment_id` de La Facundina, en orden de dependencia (molde: el `cleanup()` de
   `supabase/tests/reports/run.cjs`): eventos (7 tablas tipadas + `animal_events`) → `birth_calves` →
   `rodeo_membership_history` / `animal_category_history` → `animal_profiles` → `animals` huérfanos →
   `sessions`, `management_groups`, `rodeo_data_config`, `semen_registry` → `rodeos` → `user_roles` →
   `establishments`. **No se toca "Santo Domingo"** ni ningún otro campo de la cuenta.
3. **Re-seed** con el mismo namespace de UUID fijos (`fac00000-face-4000-a000-…`), 2 rodeos con los mismos
   `service_months`, ~350 cabezas, ~2.000 eventos. Diferencias obligatorias respecto del seed original:
   - **`entry_date` explícito** en cada perfil, anterior al inicio del servicio 2024 (RCC.11.2). Sin esto el
     trigger abre la membresía en `created_at` = hoy y la campaña 2024 devuelve `serviced = 0`.
   - **Retrodatar `animal_category_history.changed_at`** de las filas `initial` al `entry_date` (RCC.11.3), por
     `service_role`, después de crear los perfiles. Sin esto la categoría histórica cae en la degradación de
     RCC.2.7 y la demo dependería de un fallback.
   - Tactos dentro de la ventana de cada campaña; partos a −9 meses de concepción; destetes ~7 meses post-parto.
4. **Cierre de 2024** en ambos rodeos llamando `close_campaign` **con la identidad del owner** (RCC.11.5). Como
   la cuenta de Facundo es login por Google (sin password para `signInWithPassword`), se ejecuta por SQL con
   `set local request.jwt.claims = '{"sub":"b3fb7b0f-b0b2-4c22-87a4-a88f8870a376","role":"authenticated"}'`
   dentro de la misma transacción → `auth.uid()` resuelve a Facundo, `is_owner_or_vet_of` pasa y `closed_by`
   queda correcto. **No** se insertan filas de snapshot a mano.
5. **Verificación** (RCC.11.6): guardar la salida de las 5 RPC de 2024 **antes** del cierre y comparar contra
   `rodeo_campaign_status` + las 5 RPC **después**; comprobar `is_closed = true` con su `closed_at`, y que 2025
   sigue abierta.

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
| **DP-19** | RLS por `establishment_of_profile()` en la tabla de membresía, y por la columna denormalizada en las de snapshot. | La primera cuelga de una tabla escribible por el cliente; las segundas no tienen ningún camino de escritura del cliente. §2.3. | RCC.1.11, RCC.4.8 |
| **DP-20** | `transfer_animal` **no** re-apunta la membresía (a diferencia de lo que hace con `animal_category_history`). | Re-apuntarla movería la historia de rodeo al campo destino: F4 a escala de establecimiento. | RCC.1.13 |
| **DP-21** | Migraciones `0127`–`0130` en cuatro archivos, en el orden de §6. | La tabla de historia y su backfill tienen que existir antes del cómputo; el cómputo histórico antes del cierre. | §6 |
| **DP-22** | Re-seed: campaña **2024** cerrada y **2025** en curso, no 2025 cerrada. **[VALIDAR CON RAF]** | §9.1: una campaña 2025 no puede tener su destete cargado antes de ~oct-2026. | RCC.11.4 |
| **DP-23** | El contrafactual del test de inmutabilidad usa un tacto **dentro** de la ventana, no las tres mutaciones de estado. | §8.1: con el cómputo histórico arreglado, esas tres tampoco mueven una campaña abierta. | RCC.13.2, RCC.13.3 |

### Pendientes marcados

| Marca | Qué | Dónde |
|---|---|---|
| **[VALIDAR CON FACUNDO]** | DL5: la ventana del tacto de la campaña (ya venía marcado en el `context.md`). | RCC.3.1 |
| **[VALIDAR CON FACUNDO]** | DP-14: acotar el aborto a la ventana de la campaña. | RCC.3.4 |
| **[VALIDAR CON FACUNDO]** | DP-15: los 18 meses de "ciclo completo por vencimiento". | RCC.7.6 |
| **[VALIDAR CON FACUNDO]** | F7 / DP-8: que `entoradas == servidas` sea aceptable como estado transitorio hasta que se redefina *entoradas*. | RCC.2.12 |
| **[VALIDAR CON RAF]** | DP-22: campaña cerrada de la demo = 2024, no 2025. **Es la única pregunta abierta para la Puerta 1.** | §9.1 |

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
| `transfer_animal` re-apunta `animal_category_history` al perfil destino → el perfil de origen se queda sin categoría histórica y cae en la degradación DP-17. | Declarado; anotar en `docs/backlog.md` al cerrar. Es territorio de spec 11, no de este delta. |
| **(#5, el más alto)** El productor **nunca cierra** ninguna campaña. | Riesgo asumido por ADR-032 §5; no se elimina, se mitiga por tres lados: (a) el aviso de `cycle_complete` cuando el ciclo termina; (b) el **cierre masivo por campo** (RCC.10.6), para que un campo de 4 rodeos sea un gesto y no cuatro — sin esto el riesgo se materializa solo; (c) aunque nunca cierre, la campaña queda en vivo pero **con cómputo histórico**, así que ya no se mueve por ventas, movimientos ni recategorizaciones. Lo único que se pierde sin cerrar es la inmunidad a un cambio futuro de fórmula. |
| **(F8)** El productor cierra **de más**: congela una campaña sin partos ni destetes y el 0 % queda para siempre. | Gate de reconocimiento explícito (DP-10): imposible por accidente. Y si lo hace a propósito, el snapshot lo dice (`closed_incomplete` + `missing_at_close`) y la pantalla lo muestra, así que el benchmarking no compara peras con manzanas sin avisar. Queda reversible por `reopen_campaign` mientras no se cierre la campaña siguiente. |
| Costo de `animal_category_at` por perfil (N lookups por llamada). | Índice `animal_category_history_by_profile (animal_profile_id, changed_at desc)` ya existe (`0030:19`). Para 350 cabezas es despreciable; si un rodeo de 5.000 se pusiera lento, se pasa a un `lateral join` único. |
| Cambio de comportamiento visible: una vaca vendida **vuelve a aparecer** en campañas pasadas. | Es el fix (F2), no una regresión. Puede sorprender a Facundo en la demo → mencionarlo. |

---

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
