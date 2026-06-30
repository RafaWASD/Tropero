# Spec 02 — Design

**Status**: Aprobada 2026-05-26 · refundida 2026-05-28 (incorpora ADR-020 lote + ADR-021 plantilla de datos) · refinamiento de edge cases 2026-05-29 (sesión 17).
**Fecha original**: 2026-05-25

> El historial de refinamientos vive en el **Changelog** al final de este documento (audit trail, mismo principio que los ADRs). La entrada de sesión 17 (2026-05-29) está al tope del Changelog.
>
> **Nota de alcance del refinamiento de sesión 17**: este design **documenta el cambio conceptual** (baja de animal, mellizos uno-a-muchos, recálculo de categoría, transiciones por edad, TAG no reusable, timeline siempre visible). El SQL nuevo / las migrations correspondientes los escribe el **implementer**; los bloques SQL nuevos marcados "(sesión 17 — propuesta de diseño)" eran orientativos.
>
> **Nota de alcance del fold Tier 1 (sesión 20)**: la sección **"Fold del Tier 1 — bloque backend delta s17/s18"** (abajo) deja **firmes** 5 de esas decisiones (`created_by`, `exit_reason` enum, `birth_calves`/mellizos, recálculo de categoría `R6.14`, `R4.5.1` relajada) y les asigna **migrations concretas 0043+**. Los bloques SQL de esa sección son **especificación de diseño firme** (el implementer escribe los `.sql` + tests, pero el modelado queda cerrado). Lo que sigue marcado **DEFERIDO** (Tier 2: ramas `weaning`/`abortion`; Tier 3: razas SENASA + `castracion`) **no** entra en este fold — pendiente de Facundo/research.

## Deltas posteriores (ADR-028)

> Índice de los delta-specs que extienden esta feature `done`. El baseline de abajo **no se reescribe**; cada
> delta vive en su propio `{context,requirements,design,tasks}-<slug>.md` en esta carpeta. (Índice introducido
> al cerrar el delta `aptitud-reproductiva`; backfill de los previos para que el baseline no mienta por omisión.)

| Slug | Qué agrega | Estado |
|---|---|---|
| `tier2-categorias` | novillito/novillo + `is_castrated` + reescritura `compute_category`/triggers (0059-0067) | done |
| `c4-lotes` | frontend de `management_groups` (ADR-020) | done |
| `c6-categoria-espejo` | espejo client-side display-only de `compute_category` + badge de override | done |
| `cut-ficha` | marcar/quitar CUT desde la ficha + badge de categoría amarillo | done |
| `c3.3-baja` | baja/egreso desde la ficha (R14.9) | done |
| `puesta-en-servicio` | Stream A backend del modelo reproductivo (`service_months`, servidas/entoradas, 0102-0105) | done |
| `aptitud-reproductiva` | badge único de estado reproductivo (lista+ficha) + prompt de aptitud en el alta + fix inseminación hembra+apta (#5/#6/#1b) — **frontend puro, sin migración** | done (Puerta 2, 2026-06-29) |
| `alta-form-refinamiento` | alta: fecha DD/MM opcional separada del año + condición corporal stepper (comparte `ConditionScoreStepper` con la maniobra) + destildar opcionales (#3/#13/#14) — **frontend puro, sin migración** | gateado, ⏸ Puerta 2 (2026-06-29) |
| `caravana-ficha` | ficha: asignar caravana electrónica (RPC existente) y visual/idv (UPDATE local, patrón CUT) desde la sección Identificación, solo lo vacío (R4.13); bastoneo DEFERIDO (hardware) (#6 manual) — **frontend puro, sin migración** | gateado, ⏸ Puerta 2 (2026-06-29) |
| `cria-al-pie-alta` | alta: prompt saltable para vincular la cría al pie de una vaca con `nursing=true` → find-or-create del ternero → RPC nueva `link_calf_to_mother` (vincular existente) o `register_birth` 6-arg con `p_calf_rodeo_id`+`p_calf_idv` (crear+vincular, rodeo editable) (#15) — **CON BACKEND** (0114/0115/**0116** fix `breed_id`). Primer caso del Gate 2.5 (ADR-029, capturas) | done (Puerta 2, 2026-06-30) |

**Reconciliación as-built del delta `aptitud-reproductiva`** (bajo R10/R14 — estado de la ficha — y R4 — alta): la ficha y la lista ahora muestran un **badge único de estado reproductivo** derivado client-side (espejo de `0105` + `deriveCurrentState`, sin columna nueva); el alta de una `vaquillona` ofrece un prompt opcional de aptitud que crea un evento `tacto_vaquillona`; la aplicabilidad de inseminación quedó gateada a hembra apta (con fallback de edad ≥365d, alineado a `0105`). Detalle en `{requirements,design,tasks}-aptitud-reproductiva.md`.

## Arquitectura general

```
┌─────────────────────────────────────────────────────┐
│  React Native (Expo) + TypeScript                    │
│  ┌──────────────────────────────────────────────┐    │
│  │  AuthContext         (de spec 01)             │    │
│  │  EstablishmentContext (de spec 01)            │    │
│  │  RodeoContext        (rodeo activo)           │    │
│  │  Hooks: useAnimals, useAnimalTimeline,        │    │
│  │         useSearchAnimal, useCategories        │    │
│  └──────────────────────────────────────────────┘    │
│                       ↓                              │
│         supabase-js + PowerSync client               │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  Supabase                                            │
│  ┌──────────────────────────────────────────────┐    │
│  │  Migrations 0012..0037 (este spec):           │    │
│  │   - species / systems / categories (config)   │    │
│  │   - field_definitions (catálogo GLOBAL de     │    │
│  │     datos tracqueables, ADR-021)              │    │
│  │   - system_default_fields (defaults/required  │    │
│  │     por sistema)                              │    │
│  │   - rodeos + rodeo_data_config (toggle por    │    │
│  │     rodeo, FK a field_definitions)            │    │
│  │   - management_groups (lote, ADR-020) +       │    │
│  │     animal_profiles.management_group_id       │    │
│  │   - animals / animal_profiles                 │    │
│  │   - eventos tipados (weight, repro, sanitary, │    │
│  │     condition_score, lab_samples)             │    │
│  │   - animal_events (Híbrido: 'observacion' |   │    │
│  │     'otro') con edit_window_until 15 min      │    │
│  │   - animal_category_history                   │    │
│  │   - triggers: transiciones, ternero al pie,   │    │
│  │     identidad check, pre-populate config de   │    │
│  │     rodeo, validar data_key, created_by,      │    │
│  │     author_id, category_history, bloqueo      │    │
│  │     cambio tag/idv (inmutabilidad)            │    │
│  │   - helpers: animal_timeline() (con           │    │
│  │     observacion como 7mo origen),             │    │
│  │     compute_category(),                       │    │
│  │     establishment_of_profile()                │    │
│  │   - RLS policies por tabla                    │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Los tres ejes ortogonales (regla maestra)

Un animal vive en tres dimensiones independientes. Lo que las distingue es **qué dispara un cambio en cada una** (ADR-020):

| Eje | Tabla / columna | Cambia cuando… | Disparador |
|---|---|---|---|
| **Rodeo** | `animal_profiles.rodeo_id` | cambia el sistema productivo | manual / semi-auto, baja frecuencia |
| **Categoría** | `animal_profiles.category_id` | cambia el estado biológico | **automático por evento** (trigger, ADR-008) |
| **Lote** | `animal_profiles.management_group_id` | el productor decide reagrupar | **siempre manual, nunca por evento** |

Implicancia de diseño crítica: los triggers de transición de categoría (`0030_category_transitions`) **solo** tocan `category_id`. Nunca escriben `rodeo_id` ni `management_group_id`. Ningún trigger asigna lote (R2.18, R7.7).

Se parte del estado actual del backend tras spec 01:
- 11 migrations `0001..0011` aplicadas a Supabase remoto.
- Helpers `has_role_in(uuid)`, `is_owner_of(uuid)`.
- Trigger `handle_new_establishment` que crea owner.
- Patrón de migration con `enable RLS + GRANT + policies` documentado.
- Tests Node nativo `supabase/tests/rls/run.cjs`.

Las migrations de este spec van de `0012_` a `0037_`. La refundición 2026-05-28 reemplazó el contenido de la `0016` buggeada (`system_data_templates` por-sistema) por las **tres tablas de plantilla** de ADR-021 (`field_definitions` + `system_default_fields` + `rodeo_data_config` + triggers, todo en `0016` como unidad lógica), insertó `management_groups` + `ALTER animal_profiles ADD management_group_id` como `0036`, y movió `check_grants` a `0037`. Los bloques `0017`–`0035` **mantienen su numeración** original. Ver detalle en el Changelog y en `tasks.md`.

## Schema SQL

### Tablas de configuración (multi-especie)

```sql
-- 0012_species.sql
create table public.species (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,            -- 'bovino', 'equino', 'porcino'
  name        text not null,
  icon        text,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.species (code, name, icon, active) values
  ('bovino', 'Bovino', 'cow', true),
  ('equino', 'Equino', 'horse', false),
  ('porcino', 'Porcino', 'pig', false);

alter table public.species enable row level security;
create policy species_select on public.species for select to authenticated using (true);
grant select on public.species to authenticated;
-- No GRANT insert/update/delete: cambios vía migration.
```

```sql
-- 0013_systems_by_species.sql
create table public.systems_by_species (
  id          uuid primary key default gen_random_uuid(),
  species_id  uuid not null references public.species(id),
  code        text not null,                   -- 'cria', 'invernada', 'feedlot', 'tambo', 'cabana'
  name        text not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (species_id, code)
);

-- Seed para bovino
insert into public.systems_by_species (species_id, code, name, active)
select id, 'cria', 'Cría', true from public.species where code = 'bovino';

insert into public.systems_by_species (species_id, code, name, active)
select id, code, name, false from (
  values ('invernada', 'Invernada'),
         ('feedlot', 'Feedlot'),
         ('tambo', 'Tambo'),
         ('cabana', 'Cabaña')
) as t(code, name), public.species s where s.code = 'bovino';

alter table public.systems_by_species enable row level security;
create policy systems_select on public.systems_by_species for select to authenticated using (true);
grant select on public.systems_by_species to authenticated;
```

```sql
-- 0014_categories_by_system.sql
create table public.categories_by_system (
  id                   uuid primary key default gen_random_uuid(),
  system_id            uuid not null references public.systems_by_species(id),
  code                 text not null,           -- 'ternero', 'vaca_segundo_servicio', etc.
  name                 text not null,
  parent_category_id   uuid references public.categories_by_system(id),
  sort_order           int not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (system_id, code)
);

-- Seed para (bovino, cría) — categorías del MVP
with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
insert into public.categories_by_system (system_id, code, name, sort_order, active)
select sys.system_id, c.code, c.name, c.sort, true
from sys, (values
  ('ternero',              'Ternero',                10),
  ('ternera',              'Ternera',                20),
  ('vaquillona',           'Vaquillona',             30),
  ('vaquillona_prenada',   'Vaquillona preñada',     40),
  ('vaca_segundo_servicio','Vaca segundo servicio',  50),
  ('multipara',            'Multípara',              60),
  ('cut',                  'CUT',                    70),
  ('vaca_cabana',          'Vaca cabaña',            80),
  ('toro',                 'Toro',                   90),
  ('torito',               'Torito',                 95)
) as c(code, name, sort);

alter table public.categories_by_system enable row level security;
create policy categories_select on public.categories_by_system for select to authenticated using (true);
grant select on public.categories_by_system to authenticated;
```

Notas:
- `code` es la clave estable que los triggers usan para resolver transiciones — los nombres se pueden traducir/cambiar sin tocar lógica.
- Cubre **R1.1**, **R1.2**, **R1.3**, **R1.4**, **R1.5**.

### Rodeos

```sql
-- 0015_rodeos.sql
create table public.rodeos (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  species_id        uuid not null references public.species(id),
  system_id         uuid not null references public.systems_by_species(id),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint rodeos_name_not_empty check (length(trim(name)) > 0)
);

create index rodeos_by_est on public.rodeos (establishment_id) where deleted_at is null;
create index rodeos_lookup on public.rodeos (establishment_id, active) where deleted_at is null;

-- Constraint funcional: el (species_id, system_id) debe existir en systems_by_species y estar activo
create or replace function public.tg_rodeos_validate_species_system ()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.systems_by_species s
    where s.id = new.system_id
      and s.species_id = new.species_id
      and s.active = true
  ) then
    raise exception 'invalid species/system combination or system inactive'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rodeos_validate_species_system
  before insert or update on public.rodeos
  for each row execute function public.tg_rodeos_validate_species_system();

-- updated_at trigger (mismo patrón que establishments)
create trigger rodeos_set_updated_at
  before update on public.rodeos
  for each row execute function public.tg_set_updated_at_generic();

-- RLS
alter table public.rodeos enable row level security;

create policy rodeos_select on public.rodeos
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy rodeos_insert on public.rodeos
  for insert with check (is_owner_of(establishment_id));

create policy rodeos_update on public.rodeos
  for update using (is_owner_of(establishment_id))
  with check (is_owner_of(establishment_id));

grant select, insert, update on public.rodeos to authenticated;
```

**Sin rodeo default**: no existe trigger de auto-creación de rodeo al crear un establecimiento. Tras el alta del establishment, el cliente lleva al usuario al wizard de "Crear rodeo" que (i) elige sistema activo, (ii) nombra el rodeo, (iii) tilda/destilda los datos de la plantilla del sistema. El rodeo se crea por INSERT explícito a `rodeos` desde el cliente; el trigger AFTER INSERT de `0016` (`tg_rodeos_seed_data_config`) pre-popula `rodeo_data_config` con los defaults del sistema. Mientras el establishment no tenga rodeo, el cliente bloquea la navegación (empty state de bloqueo total, R2.6).

### Plantilla de datos: catálogo global + defaults por sistema + toggle por rodeo (`ADR-021`)

Tres tablas que separan tres responsabilidades (corrige el bug del catálogo-por-sistema de versiones previas — ver Changelog):

1. **`field_definitions`** — catálogo GLOBAL: cada dato tracqueable existe **una sola vez** (no atado a un sistema). Read-only desde cliente.
2. **`system_default_fields`** — qué fields vienen tildados/requeridos **por sistema** (la "plantilla"). Read-only desde cliente.
3. **`rodeo_data_config`** — estado efectivo **por rodeo** (toggle del owner). Mutable por owner.

La separación habilita el caso real "rodeo de tambo que también quiere tactear preñez": `prenez` existe en `field_definitions` (global), así que el rodeo de tambo puede habilitarlo en su `rodeo_data_config` aunque no sea default de tambo en `system_default_fields`. Sustrato del gating de maniobras de spec 03 (R2.7).

> Las tres tablas van en **una sola migration `0016`** (unidad lógica). El seed de cría es **TENTATIVO** (validación con Facundo pendiente).

```sql
-- 0016_field_template_and_rodeo_config.sql
-- (tres tablas de plantilla de datos + seed de cría + triggers. ADR-021.)
-- Nota: tg_set_updated_at_generic se reusa de spec 01 (0002); se consolida en 0017.

-- 1) Catálogo GLOBAL de datos tracqueables ---------------------------------
create table public.field_definitions (
  id              uuid primary key default gen_random_uuid(),
  data_key        text not null unique,        -- clave estable GLOBAL: 'prenez', 'peso', ...
  label           text not null,               -- texto humano para UI
  description     text,
  category        text not null,               -- 'reproductivo'|'productivo'|'sanitario'|'manejo'|'comercial'|'identificacion'
  data_type       text not null,               -- 'maniobra'|'evento_individual'|'evento_grupal'|'propiedad'
  ui_component    text,                         -- 'numeric'|'numeric_stepped'|'enum_single'|'enum_multi'|'date'|'silent_apply'|'composite'|'text'
  config_schema   jsonb,                        -- configuración específica del dato (TENTATIVO por field)
  schema_version  int not null default 1,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index field_definitions_by_category on public.field_definitions (category) where active = true;

-- Seed TENTATIVO de cría: 26 fields (23 default ON, 3 default OFF). default_enabled vive en system_default_fields.
insert into public.field_definitions (data_key, label, description, category, data_type, ui_component) values
  -- Reproductivo
  ('servicio',                'Servicio / entore',        'Registro de monta natural o IA',             'reproductivo', 'evento_individual', 'composite'),
  ('prenez',                  'Preñez',                   'Tacto: preñada / vacía',                     'reproductivo', 'maniobra',          'enum_single'),
  ('tamano_prenez',          'Tamaño de preñez',         'Cabeza / cuerpo / cola del tacto positivo',  'reproductivo', 'maniobra',          'enum_single'),
  ('tacto_vaquillona',       'Aptitud vaquillona',       'Apta / no apta / diferida',                  'reproductivo', 'maniobra',          'enum_single'),
  ('parto',                   'Parto',                    'Registro de parto + ternero al pie',         'reproductivo', 'evento_individual', 'composite'),
  ('aborto',                  'Aborto',                   'Registro de aborto',                         'reproductivo', 'evento_individual', 'date'),
  ('destete',                 'Destete',                  'Destete del ternero (usa pesaje)',           'reproductivo', 'evento_individual', 'composite'),
  ('raspado_toros',          'Raspado de toros',         'Tricomoniasis + campylobacteriosis',         'reproductivo', 'maniobra',          'composite'),
  ('inseminacion',            'Inseminación artificial',  'IATF / IA con pajuela',                      'reproductivo', 'maniobra',          'composite'),
  -- Productivo
  ('peso',                    'Pesaje',                   'Peso vivo en balanza o manual',              'productivo',   'maniobra',          'numeric'),
  ('peso_destete',           'Peso al destete',          'Peso del ternero al destete',                'productivo',   'evento_individual', 'numeric'),
  ('condicion_corporal',      'Condición corporal',       'Score 1.00 - 5.00 (escala media)',           'productivo',   'maniobra',          'numeric_stepped'),
  ('peso_nacimiento',         'Peso al nacer',            'Peso del ternero al nacimiento',             'productivo',   'evento_individual', 'numeric'),
  -- Sanitario
  ('vacunacion',              'Vacunación',               'Aplicación de vacuna (silenciosa)',          'sanitario',    'maniobra',          'silent_apply'),
  ('brucelosis',              'Brucelosis (sangrado)',    'Extracción de sangre con tubo numerado',     'sanitario',    'maniobra',          'composite'),
  ('antiparasitario_interno', 'Antiparasitario interno',  'Desparasitación interna (silenciosa)',       'sanitario',    'evento_grupal',     'silent_apply'),
  ('antiparasitario_externo', 'Antiparasitario externo',  'Desparasitación externa (silenciosa)',       'sanitario',    'evento_grupal',     'silent_apply'),
  ('antibiotico',             'Antibiótico',              'Aplicación de antibiótico (silenciosa)',     'sanitario',    'evento_individual', 'silent_apply'),
  ('suplementacion',          'Suplementación min/vit',   'Minerales / vitaminas (silenciosa)',         'sanitario',    'evento_grupal',     'silent_apply'),
  ('tratamiento_curativo',    'Tratamiento curativo',     'Tratamiento de un episodio clínico',         'sanitario',    'evento_individual', 'text'),
  ('enfermedad',              'Episodio de enfermedad',   'Registro de enfermedad detectada',           'sanitario',    'evento_individual', 'text'),
  ('tuberculosis',            'Tuberculosis',             'Test de tuberculosis',                       'sanitario',    'evento_individual', 'enum_single'),
  -- Manejo
  ('dientes',                 'Estado de dientes',        'Estado dentario (dispara prompt CUT)',       'manejo',       'maniobra',          'enum_single'),
  ('observacion',             'Observación libre',        'Nota libre del operador (animal_events)',    'manejo',       'evento_individual', 'text'),
  -- Comercial
  ('compra',                  'Compra / ingreso',         'Alta por compra',                            'comercial',    'evento_individual', 'composite'),
  ('venta',                   'Venta / egreso',           'Baja por venta',                             'comercial',    'evento_individual', 'composite');

alter table public.field_definitions enable row level security;
create policy field_definitions_select on public.field_definitions
  for select to authenticated using (true);
grant select on public.field_definitions to authenticated;

create trigger field_definitions_set_updated_at
  before update on public.field_definitions
  for each row execute function public.tg_set_updated_at_generic();

-- 2) Defaults / required POR SISTEMA (la "plantilla") ----------------------
create table public.system_default_fields (
  id                  uuid primary key default gen_random_uuid(),
  system_id           uuid not null references public.systems_by_species(id),
  field_definition_id uuid not null references public.field_definitions(id),
  default_enabled     boolean not null default true,   -- viene tildado al crear rodeo del sistema
  required_for_system boolean not null default false,  -- si true, no se puede destildar a nivel rodeo
  sort_order          int not null default 0,
  unique (system_id, field_definition_id)
);

create index system_default_fields_by_system on public.system_default_fields (system_id, sort_order);

-- Seed de cría: las 26 filas anteriores, 3 con default_enabled = false.
with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
insert into public.system_default_fields (system_id, field_definition_id, default_enabled, required_for_system, sort_order)
select sys.system_id, fd.id,
       case when fd.data_key in ('inseminacion','peso_nacimiento','tuberculosis') then false else true end,
       false,
       row_number() over (order by fd.category, fd.label)
from sys, public.field_definitions fd;
-- En cría MVP ningún field es required (la identificación TAG/IDV/visual_id_alt es el único requisito real, R4.2).

alter table public.system_default_fields enable row level security;
create policy system_default_fields_select on public.system_default_fields
  for select to authenticated using (true);
grant select on public.system_default_fields to authenticated;

-- 3) Estado efectivo POR RODEO (toggle del owner) --------------------------
create table public.rodeo_data_config (
  rodeo_id            uuid not null references public.rodeos(id) on delete cascade,
  field_definition_id uuid not null references public.field_definitions(id),
  enabled             boolean not null,
  custom_config       jsonb,                  -- overrides opcionales al config_schema del field
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (rodeo_id, field_definition_id)
);

create index rodeo_data_config_by_rodeo
  on public.rodeo_data_config (rodeo_id) where enabled = true;
create index rodeo_data_config_by_field
  on public.rodeo_data_config (field_definition_id) where enabled = true;

create trigger rodeo_data_config_set_updated_at
  before update on public.rodeo_data_config
  for each row execute function public.tg_set_updated_at_generic();

-- Trigger AFTER INSERT en rodeos: pre-poblar rodeo_data_config con los system_default_fields del sistema
create or replace function public.tg_rodeos_seed_data_config ()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.rodeo_data_config (rodeo_id, field_definition_id, enabled)
  select new.id, sdf.field_definition_id, sdf.default_enabled
  from public.system_default_fields sdf
  where sdf.system_id = new.system_id;
  return new;
end; $$;

create trigger rodeos_seed_data_config
  after insert on public.rodeos
  for each row execute function public.tg_rodeos_seed_data_config();

-- RLS: SELECT a todo rol del establishment del rodeo; INSERT/UPDATE solo owner; no DELETE de cliente.
-- (INSERT lo habilita el owner para agregar un field no-default del sistema — caso "tambo que tactea preñez".)
alter table public.rodeo_data_config enable row level security;

create policy rodeo_data_config_select on public.rodeo_data_config
  for select using (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id
              and has_role_in(r.establishment_id) and r.deleted_at is null)
  );

create policy rodeo_data_config_insert on public.rodeo_data_config
  for insert with check (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id and is_owner_of(r.establishment_id))
  );

create policy rodeo_data_config_update on public.rodeo_data_config
  for update using (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id and is_owner_of(r.establishment_id))
  ) with check (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id and is_owner_of(r.establishment_id))
  );
-- No policy DELETE: deshabilitar = enabled=false; el borrado real solo por CASCADE al borrar el rodeo.

grant select, insert, update on public.rodeo_data_config to authenticated;
```

Notas:
- **Por qué tres tablas y no una por-sistema**: el bug del modelo anterior era que `system_data_templates(system_id, data_key)` ataba cada dato a un sistema, impidiendo reusarlo. Acá `field_definitions` es global (un dato existe una vez), `system_default_fields` solo marca el default por sistema, y `rodeo_data_config` referencia `field_definitions` directamente — por eso un rodeo puede habilitar **cualquier** field del catálogo (caso "tambo + preñez").
- **No hay trigger de validación contra el sistema** en `rodeo_data_config` (a diferencia del modelo viejo): el FK a `field_definitions` ya garantiza que el field existe en el catálogo, y la intención de diseño es **permitir** habilitar fields fuera del default del sistema.
- El trigger `tg_rodeos_seed_data_config` (AFTER INSERT en `rodeos`) garantiza que un rodeo recién creado nunca queda con config vacía — arranca con los `system_default_fields` del sistema.
- **Catálogo read-only**: `field_definitions` y `system_default_fields` se modifican vía migration (mismo patrón que `species`/`categories_by_system`). Solo `rodeo_data_config` es mutable (owner).
- **Gating de maniobras (spec 03)**: el mapeo maniobra→data_keys es hardcodeado (ADR-021, ver tabla en R2.7 del requirements). Una query `SELECT count(*) FROM rodeo_data_config rdc JOIN field_definitions fd ON fd.id = rdc.field_definition_id WHERE rdc.rodeo_id = ? AND fd.data_key = ANY($1) AND rdc.enabled = true` resuelve el gating en O(log n) con el index `(field_definition_id) WHERE enabled = true`. El enforcement (doble capa UI + DB) vive en spec 03.
- **Seed TENTATIVO**: 26 fields de cría (23 ON, 3 OFF: `inseminacion`, `peso_nacimiento`, `tuberculosis`). `evaluacion_toro` diferido post-MVP. Otros sistemas reciben su `system_default_fields` cuando se activen; los `field_definitions` universales ya quedan disponibles. Ajustable por migration sin reabrir spec 02.
- **El timeline muestra historial aunque el data_key esté deshabilitado (sesión 17, R2.12.1)**: `rodeo_data_config.enabled` y `field_definitions.active` controlan la **carga futura** (gating de maniobras de spec 03), **no** la visibilidad de lo ya cargado. La función `animal_timeline` (ver más abajo) **no** hace join a `rodeo_data_config` ni filtra por `enabled`/`active` — por diseño rinde todos los eventos históricos. Cuando el `owner` destilda en un rodeo un data_key que ya tiene eventos cargados, el **cliente** debe avisarle ("este dato tiene N eventos cargados; se dejará de pedir pero el historial se conserva"); el conteo sale de un `count(*)` sobre la tabla de eventos correspondiente filtrado por los `animal_profiles` del rodeo. No se borra ni se oculta nada.
- **Garantía de R2.11 acotada (sesión 17)**: "el rodeo nunca queda con `rodeo_data_config` vacía" vale **solo** para sistemas con filas en `system_default_fields`. En MVP solo `(bovino, cría)` las tiene. **Activar un sistema nuevo** (invernada/feedlot/tambo/cabaña) **requiere seedear sus `system_default_fields` en la misma migration** que pone `systems_by_species.active = true`; de lo contrario el trigger `tg_rodeos_seed_data_config` no inserta filas y un rodeo de ese sistema nace con config vacía. Precondición de activación documentada acá.

Cubre **R2.1..R2.5**, **R2.6**, **R2.7** (nota gating), **R2.8..R2.13**, **R2.12.1**.

### Lotes — agrupación de manejo (`management_groups`, `ADR-020`)

Tercer eje de organización (regla maestra). Tabla `management_groups` (scope establishment) + columna nullable `animal_profiles.management_group_id`. La UI la muestra como "Lote".

> **Orden de migration**: la tabla `management_groups` solo depende de `establishments` (existe desde spec 01), pero la columna `animal_profiles.management_group_id` depende de que `animal_profiles` ya exista (migration `0019`). Por eso esta migration se numera **`0036`** (después de todo el bloque de animal) y agrega la columna vía `ALTER TABLE`. Conceptualmente es un eje de organización paralelo al rodeo; físicamente se materializa al final.

```sql
-- 0036_management_groups.sql (ADR-020)

create table public.management_groups (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint management_groups_name_not_empty check (length(trim(name)) > 0)
);

create index management_groups_by_est
  on public.management_groups (establishment_id) where deleted_at is null;

create trigger management_groups_set_updated_at
  before update on public.management_groups
  for each row execute function public.tg_set_updated_at_generic();

-- Columna en animal_profiles (eje lote). Nullable: NULL = "sin grupo de manejo custom".
alter table public.animal_profiles
  add column management_group_id uuid references public.management_groups(id);

create index animal_profiles_by_management_group
  on public.animal_profiles (management_group_id) where deleted_at is null;

-- Validación: el lote debe ser del mismo establishment que el perfil (asignación exclusiva = FK simple).
create or replace function public.tg_animal_profiles_management_group_check ()
returns trigger language plpgsql as $$
declare v_est uuid;
begin
  if new.management_group_id is null then return new; end if;
  select establishment_id into v_est
  from public.management_groups
  where id = new.management_group_id and deleted_at is null;
  if v_est is null then
    raise exception 'management_group % not found or deleted', new.management_group_id using errcode = '23503';
  end if;
  if v_est <> new.establishment_id then
    raise exception 'management_group belongs to a different establishment' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_management_group_check
  before insert or update of management_group_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_management_group_check();

-- RLS de management_groups: SELECT a todo rol activo; INSERT/UPDATE/soft-DELETE solo owner.
alter table public.management_groups enable row level security;

create policy management_groups_select on public.management_groups
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy management_groups_insert on public.management_groups
  for insert with check (is_owner_of(establishment_id));

create policy management_groups_update on public.management_groups
  for update using (is_owner_of(establishment_id))
  with check (is_owner_of(establishment_id));

grant select, insert, update on public.management_groups to authenticated;
-- La ASIGNACIÓN de un animal a un lote es un UPDATE de animal_profiles.management_group_id,
-- cubierto por la policy animal_profiles_update (has_role_in) — cualquier rol operativo activo (R2.17, R11.5).
```

Notas:
- **Asignación exclusiva**: un animal está en a lo sumo un lote (FK simple, no M2M). Transferir = `UPDATE ... SET management_group_id = X`. Sin historial en MVP.
- **Ortogonalidad** (R7.7): ningún trigger de transición de categoría toca `management_group_id`. El ternero al pie nace con `management_group_id = NULL` (R9.1).
- **Regla de display** "lote si tiene, si no categoría" (R2.16): la implementa el cliente. Spec 02 expone `management_group_id` + `category_id` para que el cliente agrupe.
- **Soft-delete de un lote con animales asignados**: el cliente debe reasignar esos animales a `NULL` antes (o la operación se maneja en la capa de servicio); a nivel DB el FK no cascadea el soft-delete. Decisión de UX en spec 09/cliente.

Cubre **R2.14..R2.18**, parte de **R4.1** (columna), **R9.1** (ternero sin lote), **R7.7** (ortogonalidad).

### Helper genérico `tg_set_updated_at_generic`

Antes de las tablas de eventos definimos un trigger reusable para `updated_at`:

```sql
-- 0017_generic_updated_at.sql
create or replace function public.tg_set_updated_at_generic ()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
```

(El patrón ya existe en `0002` para establishments. Lo reusamos.)

### Animals y AnimalProfiles

```sql
-- 0018_animals.sql
create table public.animals (
  id              uuid primary key default gen_random_uuid(),
  tag_electronic  text,
  species_id      uuid not null references public.species(id),
  sex             text not null check (sex in ('male', 'female')),
  birth_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- TAG único globalmente cuando existe y la fila no está soft-deleted
create unique index animals_tag_unique
  on public.animals (tag_electronic)
  where tag_electronic is not null and deleted_at is null;

-- Trigger: rechazar species_id inactiva (R3.3)
create or replace function public.tg_animals_validate_species ()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.species where id = new.species_id and active = true) then
    raise exception 'species inactive or not found' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animals_validate_species
  before insert or update on public.animals
  for each row execute function public.tg_animals_validate_species();

create trigger animals_set_updated_at
  before update on public.animals
  for each row execute function public.tg_set_updated_at_generic();

alter table public.animals enable row level security;
-- policies definidas en 0021_rls_animals_and_profiles.sql (mismo archivo que profiles para no ir y volver)
grant select, insert, update on public.animals to authenticated;
```

```sql
-- 0019_animal_profiles.sql
-- Nota: la columna `management_group_id` (eje lote, ADR-020) se agrega vía ALTER en
-- la migration 0036, porque la tabla `management_groups` se crea recién ahí. A nivel
-- del modelo lógico (R4.1) el perfil tiene management_group_id; físicamente entra en 0036.
create type public.animal_status as enum ('active', 'sold', 'dead', 'transferred');
create type public.teeth_state_enum as enum (
  '2d','4d','6d','boca_llena','3/4','1/2','1/4','sin_dientes'
);

create table public.animal_profiles (
  id                 uuid primary key default gen_random_uuid(),
  animal_id          uuid not null references public.animals(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  rodeo_id           uuid not null references public.rodeos(id),
  -- management_group_id uuid references public.management_groups(id)  -- agregado en 0036 (ADR-020)
  idv                text,
  visual_id_alt      text,
  category_id        uuid not null references public.categories_by_system(id),
  category_override  boolean not null default false,
  breed              text,
  coat_color         text,
  birth_weight       numeric(7,2),
  teeth_state        public.teeth_state_enum,
  is_cut             boolean not null default false,
  entry_date         date,
  entry_weight       numeric(7,2),
  entry_origin       text,
  exit_date          date,
  exit_reason        text,
  exit_weight        numeric(7,2),
  exit_price         numeric(12,2),
  status             public.animal_status not null default 'active',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- R4.2: al menos uno de los tres identificadores tiene texto.
  -- Como TAG vive en `animals`, el check parcial se completa con un trigger;
  -- el constraint local cubre el caso "ni idv ni visual_id_alt".
  constraint animal_profiles_local_id_check check (
    coalesce(nullif(trim(idv), ''), nullif(trim(visual_id_alt), '')) is not null
    or true  -- el trigger valida la unión con tag_electronic
  )
);

-- Unique IDV por establishment (R4.3)
create unique index animal_profiles_idv_unique
  on public.animal_profiles (establishment_id, idv)
  where idv is not null and deleted_at is null;

-- Solo un perfil activo por animal (R4.11)
create unique index animal_profiles_active_animal_unique
  on public.animal_profiles (animal_id)
  where status = 'active' and deleted_at is null;

-- Búsqueda fuzzy de visual_id_alt (R5.3, R4.4)
create extension if not exists pg_trgm;
create index animal_profiles_visual_alt_trgm
  on public.animal_profiles using gin (visual_id_alt gin_trgm_ops)
  where visual_id_alt is not null and deleted_at is null;

-- Indexes operativos
create index animal_profiles_by_est on public.animal_profiles (establishment_id) where deleted_at is null;
create index animal_profiles_by_rodeo on public.animal_profiles (rodeo_id) where deleted_at is null;
create index animal_profiles_by_animal on public.animal_profiles (animal_id);

create trigger animal_profiles_set_updated_at
  before update on public.animal_profiles
  for each row execute function public.tg_set_updated_at_generic();
```

#### Triggers de validación e identificación

```sql
-- 0020_animal_profiles_validations.sql

-- (a) R4.2: al menos uno de tag/idv/visual_alt tiene texto (mirando animals.tag_electronic)
create or replace function public.tg_animal_profiles_identity_check ()
returns trigger language plpgsql as $$
declare v_tag text;
begin
  select tag_electronic into v_tag from public.animals where id = new.animal_id;
  if coalesce(nullif(trim(v_tag), ''),
              nullif(trim(new.idv), ''),
              nullif(trim(new.visual_id_alt), '')) is null then
    raise exception 'animal must have at least one of tag_electronic, idv or visual_id_alt'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_identity_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_identity_check();

-- (b) R4.5: rodeo del mismo establishment, no soft-deleted, activo
create or replace function public.tg_animal_profiles_rodeo_check ()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.rodeos r
    where r.id = new.rodeo_id
      and r.establishment_id = new.establishment_id
      and r.active = true
      and r.deleted_at is null
  ) then
    raise exception 'rodeo does not belong to establishment or is inactive'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_rodeo_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_rodeo_check();

-- (c) R4.6: category_id debe pertenecer al system del rodeo
create or replace function public.tg_animal_profiles_category_check ()
returns trigger language plpgsql as $$
declare v_system_id uuid;
begin
  select system_id into v_system_id from public.rodeos where id = new.rodeo_id;
  if not exists (
    select 1 from public.categories_by_system c
    where c.id = new.category_id and c.system_id = v_system_id and c.active = true
  ) then
    raise exception 'category does not belong to rodeo system'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_category_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_category_check();
```

#### Trigger de `category_override` automático al UPDATE manual (R4.8)

```sql
-- 0020_animal_profiles_validations.sql (continúa)

create or replace function public.tg_animal_profiles_set_override_on_manual ()
returns trigger language plpgsql as $$
begin
  -- Si la categoría cambió y no estamos dentro de un trigger de transición automática,
  -- marcamos override. Detectamos "automático" por una GUC local seteada por el trigger AUTO.
  if new.category_id is distinct from old.category_id then
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') <> 'on' then
      new.category_override := true;
    end if;
  end if;
  return new;
end; $$;

create trigger animal_profiles_set_override
  before update of category_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_set_override_on_manual();
```

El trigger de transición automática (definido más abajo) seteará `set_config('rafaq.is_auto_transition','on',true)` antes del UPDATE para evitar marcar override en automático.

### Fold del Tier 1 — bloque backend delta s17/s18 (sesión 20, migrations 0043+)

> **Estado**: el backend de spec 02 está `done` (migrations 0013-0042 aplicadas, suite animal 19/19). Este bloque **reabre un incremento** sobre ese backend. Las **decisiones del Tier 1 ya fueron aprobadas en Gate 0** (refinamientos s17/s18); esta sección las deja **firmes a nivel design** y asigna **números de migration concretos a partir de 0043** (no se pisan las 0013-0042). El SQL de abajo es la **especificación de diseño firme** del Tier 1; el implementer escribe los archivos `.sql` y los tests. Convenciones vigentes: `GRANT` explícito a `authenticated`, split insert+select, RLS por establishment, RPCs `SECURITY DEFINER` donde la policy de SELECT lo exija (patrón as-built `0041`).
>
> **Mapa de migrations propuestas del Tier 1:**
>
> | Migration | Item Tier 1 | Contenido |
> |---|---|---|
> | `0043_animal_profiles_created_by.sql` | 1 | columna `created_by` + trigger BEFORE INSERT que **fuerza** `created_by = auth.uid()` server-side (load-bearing para authz, SEC-SPEC-03) |
> | `0044_exit_reason_enum.sql` | 2 | tipo `exit_reason_enum` + conversión texto→enum + RPC `exit_animal_profile` |
> | `0045_birth_calves.sql` | 3 | tabla puente `birth_calves` (`select`-only para cliente, poblada server-side, SEC-SPEC-04) + RPC firme `register_birth` para N terneros (SEC-SPEC-02) + trigger mono-ternero extendido + conteo de partos por evento |
> | `0046_category_recompute_on_event_change.sql` | 4 | trigger AFTER UPDATE/DELETE de recálculo de categoría (`R6.14`) |
> | `0047_rodeo_change_same_system.sql` | 5 | trigger BEFORE UPDATE de `rodeo_id` que exige mismo `system_id` (`R4.5.1`) |
>
> (Numeración orientativa contigua; el implementer puede reordenar/fusionar dentro del rango 0043+ sin reabrir spec, respetando dependencias — p. ej. `0043` antes de `0044` porque el RPC de baja lee `created_by`.)
>
> **Explícitamente FUERA del Tier 1 — NO se diseña ni se implementa en este fold:**
> - **Tier 2 (DEFERIDO — pendiente Facundo)**: ramas de transición de **aborto** (`abortion`) y **destete** (`weaning`). Los targets de categoría están pendientes de confirmación de Facundo. Nota detallada en "Transiciones automáticas" (cerca de R7). **No** se agregan estas ramas a `tg_reproductive_events_apply_transition` ni a `compute_category` ahora.
> - **Tier 3 (DEFERIDO — pendiente Facundo/research)**: (a) **catálogo de razas SENASA** + migración de `animal_profiles.breed` (y `reproductive_events.breed`) de texto libre a FK contra una tabla de razas, con el ternero heredando la raza de la madre — bloqueado por la tabla de códigos de raza (manual SIGSA = PDF de imágenes, no extraíble) + la lista de razas relevantes; (b) **castración**: data_key `castracion` (sembrable) + su **efecto de categoría** (¿agregar `novillo`? ¿solo sanitario?). Ambos requieren input de Facundo/research. **No** se toca la columna `breed` (sigue texto libre) ni se agrega `castracion` en este fold.
> - **Transferencia re-parenting** (R4.11 → MVP, con RPC atómico): es **feature 11** (spec propia + Gate 1), **no** parte de este bloque. No se diseña acá.

#### `created_by` en `animal_profiles` (item 1 — migration `0043`, R4.1 / R4.14)

Confirmado en la decomposición de sesión 20: la columna **`created_by` falta** en el as-built actual de `animal_profiles`. Se agrega como FK **nullable** a `users(id)`. A diferencia de las tablas de evento (donde `created_by` es puro audit trail), en `animal_profiles` **`created_by` es load-bearing para autorización**: `exit_animal_profile` (`R4.14`) lo usa para decidir quién puede dar de baja. Por eso el trigger **NO** reusa el helper "setear solo si NULL" (`tg_set_created_by_auth_uid`, que un INSERT con `created_by` no-NULL podría burlar): usa una variante que **siempre** sobreescribe el valor server-side, ignorando cualquier `created_by` del payload del cliente.

```sql
-- 0043_animal_profiles_created_by.sql (fold Tier 1, sesión 20)
alter table public.animal_profiles
  add column created_by uuid references public.users(id);

-- (SEC-SPEC-03, Gate 1 s20) `created_by` es load-bearing para authz en animal_profiles (R4.14),
-- así que se FUERZA server-side: el trigger ignora el valor del cliente y siempre setea auth.uid().
-- NO se reusa tg_set_created_by_auth_uid ("solo si NULL"), que es spoofeable en el INSERT
-- (la policy animal_profiles_insert solo exige has_role_in, no restringe created_by).
create or replace function public.tg_force_created_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  new.created_by := auth.uid();   -- ignora cualquier valor que venga en el INSERT del cliente
  return new;
end; $$;

comment on function public.tg_force_created_by_auth_uid is
  'Trigger BEFORE INSERT: FUERZA created_by = auth.uid() (ignora el valor del cliente). '
  'Para columnas created_by que son load-bearing para authz (animal_profiles, R4.14). '
  'No confundir con tg_set_created_by_auth_uid ("solo si NULL"), que es audit-only.';

create trigger animal_profiles_set_created_by
  before insert on public.animal_profiles
  for each row execute function public.tg_force_created_by_auth_uid();
```

Notas:
- **Por qué `tg_force_...` y no el helper compartido** (SEC-SPEC-03): el helper `tg_set_created_by_auth_uid` (`0024`) solo setea `created_by` cuando viene `NULL`. En las tablas de evento eso es inocuo (es audit trail). En `animal_profiles`, `created_by` gobierna una decisión de authz (`exit_animal_profile`, `R4.14`), y como la policy `animal_profiles_insert` (`0021`) solo exige `has_role_in`, **cualquier rol operativo activo podría setear `created_by` a un UUID arbitrario en el INSERT** (atribuir el alta a otro / plantar un cómplice que luego dé de baja vía la rama `v_creator = auth.uid()`). Forzar `auth.uid()` server-side cierra ese vector: el autor registrado es siempre el que ejecutó el INSERT.
- **Nullable** (no `not null`): las filas as-built ya existentes quedan con `created_by = NULL`; el backfill histórico no es posible (no se conoce el autor original) y no es necesario para el MVP. El trigger garantiza autoría real desde el alta en adelante.
- **No rompe el split insert+select**: el trigger es BEFORE INSERT y solo escribe una columna de la propia fila; no consulta otras tablas ni evalúa RLS.
- El RPC `exit_animal_profile` (item 2) lee `created_by` para la autorización de `R4.14`; con esta migration la columna existe firme y su valor es **confiable** (no spoofeable). Si una fila vieja tiene `created_by = NULL`, solo el `owner` puede darla de baja (la rama `v_creator = auth.uid()` no matchea `NULL`), lo cual es el comportamiento conservador correcto.

#### Baja / egreso de animal (item 2 — migration `0044`, R4.14 / R4.15)

Dar de baja un animal es un cambio de `status` (NO soft-delete). Las columnas ya existen en `animal_profiles` (`status`, `exit_date`, `exit_reason`, `exit_weight`, `exit_price`). Dos cambios:

1. **`exit_reason` pasa de texto libre a enum** (`R4.14`). El conjunto de valores (`sale|death|transfer|culling|theft|other`) lo fija `R4.14` desde sesión 17; el fold Tier 1 lo deja firme. La columna está **vacía en producción** (MVP backend-only, sin altas reales todavía), así que la conversión es directa. Migration:

```sql
-- 0044_exit_reason_enum.sql (fold Tier 1, sesión 20)
create type public.exit_reason_enum as enum (
  'sale','death','transfer','culling','theft','other'   -- venta/muerte/transferencia/descarte/robo/otro
);

-- Backfill seguro: la columna texto está vacía en MVP, pero se normaliza por defensa
-- antes del ALTER (cualquier string no mapeable se rebaja a 'other' para no abortar la migration).
update public.animal_profiles
   set exit_reason = case
         when exit_reason in ('sale','death','transfer','culling','theft','other') then exit_reason
         when exit_reason is null or trim(exit_reason) = '' then null
         else 'other'
       end
 where exit_reason is not null;

alter table public.animal_profiles
  alter column exit_reason type public.exit_reason_enum
  using nullif(trim(exit_reason), '')::public.exit_reason_enum;
```

Notas de la conversión:
- El `update` previo es un **backfill defensivo**: en MVP la columna está vacía, así que es no-op; pero deja la migration robusta si en QA hubiera texto libre cargado (cualquier valor fuera del enum cae a `'other'` en vez de abortar el `ALTER`).
- `using nullif(trim(...),'')::enum` convierte cadena vacía → `NULL` (el enum no tiene un miembro vacío) y castea el resto.

2. **La baja se hace vía RPC `SECURITY DEFINER`** (no UPDATE directo de cliente), consistente con el patrón as-built de soft-delete (`0041_soft_delete_rpcs.sql`, ver Changelog): el RPC re-valida la autorización de `R4.14` (es `is_owner_of(est)` **o** `created_by` del perfil) derivando el establishment de la fila real, y aplica el cambio de `status` + columnas de egreso en una transacción.

```sql
-- 0044_exit_reason_enum.sql (continúa — RPC de baja; fold Tier 1, sesión 20)
create or replace function public.exit_animal_profile (
  p_profile_id  uuid,
  p_status      public.animal_status,        -- 'sold' | 'dead' | 'transferred'
  p_exit_reason public.exit_reason_enum,
  p_exit_date   date,
  p_exit_weight numeric default null,
  p_exit_price  numeric default null
) returns void language plpgsql security definer
set search_path = public as $$
declare v_est uuid; v_creator uuid;
begin
  select establishment_id, created_by into v_est, v_creator
  from public.animal_profiles where id = p_profile_id and deleted_at is null;
  if v_est is null then
    raise exception 'animal_profile not found' using errcode = '23503';
  end if;
  -- R4.14: owner del campo O el operario que cargó el animal — pero SIEMPRE con rol activo.
  -- (SEC-SPEC-01, Gate 1 s20) `has_role_in(v_est)` es OBLIGATORIO: filtra al autor cuyo rol
  -- fue desactivado/revocado/transferido (user_roles.active = false). Sin él, un ex-operario
  -- que sigue matcheando `v_creator = auth.uid()` podría dar de baja un animal de un campo
  -- del que ya no forma parte (cambiar status, fijar exit_*). Mismo patrón as-built que
  -- `soft_delete_animal_event` (0041 l.78) y misma clase de hueco que cerró SEC-HIGH-01.
  if not (public.has_role_in(v_est)
          and (public.is_owner_of(v_est) or v_creator = auth.uid())) then
    raise exception 'not authorized to exit this animal' using errcode = '42501';
  end if;
  if p_status = 'active' then
    raise exception 'exit status must be sold/dead/transferred' using errcode = '23514';
  end if;
  update public.animal_profiles
     set status = p_status, exit_reason = p_exit_reason, exit_date = p_exit_date,
         exit_weight = coalesce(p_exit_weight, exit_weight),
         exit_price  = coalesce(p_exit_price, exit_price)
   where id = p_profile_id;
   -- deleted_at queda NULL: NO es soft-delete. El perfil queda archivado y visible (R4.12/R4.15).
end; $$;

-- SEG (SEC-SPEC-01, Gate 1 s20): revoke/grant con la FIRMA TIPADA COMPLETA (sin firma es
-- ambiguo si hubiera overloads; el as-built 0041/0042 siempre revoca con firma) +
-- `notify pgrst, 'reload schema'` al final, igual que 0041 y 0042. Sin el reload,
-- PostgREST puede no aplicar el cambio de grants / no exponer el RPC nuevo hasta el
-- próximo reload, dejando una ventana donde los grants efectivos ≠ los migrados.
-- exit_animal_profile SÍ debe ser invocable por authenticated (R4.14: el owner y el
-- autor dan de baja desde la ficha) — por eso se revoca a public/anon y se concede a
-- authenticated, a diferencia de apply_auto_transition (0042) que se revocó a los tres.
revoke execute on function public.exit_animal_profile (uuid, public.animal_status, public.exit_reason_enum, date, numeric, numeric) from public, anon;
grant  execute on function public.exit_animal_profile (uuid, public.animal_status, public.exit_reason_enum, date, numeric, numeric) to authenticated;
notify pgrst, 'reload schema';
```

Notas de diseño:
- **Depende de `created_by` en `animal_profiles`** (item 1, migration `0043`) para identificar "el operario que cargó el animal". El fold Tier 1 deja firme que la columna **falta** en el as-built actual y la agrega en `0043` (forzado a `auth.uid()` server-side vía trigger BEFORE INSERT, SEC-SPEC-03 — el valor es confiable, no spoofeable). Por eso `0043` se aplica **antes** que `0044`. Para filas viejas con `created_by = NULL`, la rama `v_creator = auth.uid()` no matchea, así que solo el `owner` puede darlas de baja (conservador, correcto).
- **No es soft-delete** (`R4.12`): `deleted_at` queda `NULL`; el perfil sale del rodeo activo por el filtro `status = 'active'` de las queries operativas, pero sigue visible en historial y en las fichas que lo referencian (`R4.15`).
- **Preserva vínculos** (`R4.15`): los `reproductive_events.calf_id`/`bull_id` que apuntan a este perfil no se tocan. **Nunca** hard-delete de un perfil referenciado — el `ON DELETE CASCADE` de las FKs es para borrado físico, que no ocurre en este flujo.

#### Cambio de rodeo dentro del mismo sistema (item 5 — migration `0047`, R4.5.1)

> **Cambio respecto de sesión 17**: la `R4.5.1` original bloqueaba **todo** cambio de `rodeo_id` post-alta en MVP (la UI no lo ofrecía). El fold Tier 1 (sesión 20) la **relaja**: se permite cambiar de rodeo **dentro del mismo sistema productivo** y se rechaza el cruce de sistemas a nivel DB.

La regla (`R4.5.1` relajada): un UPDATE de `animal_profiles.rodeo_id` es válido **solo si** el rodeo destino tiene el **mismo `system_id`** que el rodeo origen. El rodeo destino, además, debe ser activo y del mismo establecimiento — condición que **ya** enforce el trigger `tg_animal_profiles_rodeo_check` (`0020`, `R4.5`), que corre en `before insert or update`. El trigger nuevo agrega **solo** la verificación de mismo-sistema en el caso UPDATE de `rodeo_id`:

```sql
-- 0047_rodeo_change_same_system.sql (fold Tier 1, sesión 20)
create or replace function public.tg_animal_profiles_rodeo_same_system_check ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_old_system uuid; v_new_system uuid;
begin
  -- Solo aplica cuando el rodeo cambia en un UPDATE.
  if new.rodeo_id is not distinct from old.rodeo_id then
    return new;
  end if;
  select system_id into v_old_system from public.rodeos where id = old.rodeo_id;
  select system_id into v_new_system from public.rodeos where id = new.rodeo_id;
  if v_new_system is distinct from v_old_system then
    raise exception 'rodeo change across productive systems is not allowed (category dead-end, R4.6); same system_id required'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_rodeo_same_system_check
  before update of rodeo_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_rodeo_same_system_check();
```

Notas de diseño:
- **Por qué un trigger aparte y no extender `tg_animal_profiles_rodeo_check`**: ese trigger valida pertenencia al establecimiento + rodeo activo, que aplica también al INSERT (donde no hay `old`). La verificación de mismo-sistema es **exclusiva del UPDATE de `rodeo_id`** (necesita `old.rodeo_id`), así que vive en un trigger `before update of rodeo_id` separado, sin tocar el camino del alta.
- **`SECURITY DEFINER`** + `search_path = public`: el trigger lee `rodeos` (que tiene RLS) para resolver el `system_id` de ambos rodeos; con `SECURITY DEFINER` la lectura no se rebota por la policy de `rodeos` durante el UPDATE (mismo motivo que `tg_animal_profiles_identity_check` pasó a `SECURITY DEFINER` en el as-built, ver Changelog). Solo lee `system_id`, no retorna datos ni es invocable como RPC.
- **Ortogonalidad (R7.7 / `R4.5.1`)**: el cambio de rodeo **no** toca `category_id` ni `management_group_id`. Como destino y origen comparten `system_id`, la categoría actual sigue siendo válida para el sistema (`R4.6`) y **no** se recalcula. El cliente puede mover el animal con un UPDATE simple de `rodeo_id`; no hay re-mapeo de categoría.
- **MVP**: con solo `(bovino, cría)` activo, todos los rodeos de un establecimiento comparten `system_id`, así que el trigger nunca rechaza en la práctica. La validación queda firme para cuando exista multi-sistema (entonces el cruce de sistemas seguirá rechazado hasta que se especifique la resolución de categoría cross-sistema).
- **`R4.5` intacto**: la policy de UPDATE de `animal_profiles` (`has_role_in`) ya autoriza el cambio de rodeo a cualquier rol operativo activo; este trigger solo restringe el **valor** del rodeo destino, no quién puede hacerlo.

#### RLS de `animals` y `animal_profiles`

```sql
-- 0021_rls_animals_and_profiles.sql

-- animal_profiles: RLS estándar por establishment
alter table public.animal_profiles enable row level security;

create policy animal_profiles_select on public.animal_profiles
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy animal_profiles_insert on public.animal_profiles
  for insert with check (has_role_in(establishment_id));
  -- field_operator y veterinarian pueden insertar (R11.5)

create policy animal_profiles_update on public.animal_profiles
  for update using (has_role_in(establishment_id))
  with check (has_role_in(establishment_id));
-- (Para bulk-edit owner-only de R11.4 se valida desde Edge Function dedicada;
--  los updates puntuales puede hacerlos cualquier rol activo.)

grant select, insert, update on public.animal_profiles to authenticated;

-- animals: visible si el usuario tiene rol en un establishment con perfil activo
create policy animals_select on public.animals
  for select using (
    deleted_at is null
    and exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id
        and has_role_in(ap.establishment_id)
    )
  );

create policy animals_insert on public.animals
  for insert with check (auth.uid() is not null);
  -- el INSERT real va acompañado de un INSERT en animal_profiles dentro de la misma
  -- operación del cliente. RLS asegura que el perfil cae en un establishment con rol.

create policy animals_update on public.animals
  for update using (
    exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id and has_role_in(ap.establishment_id)
    )
  ) with check (true);

grant select, insert, update on public.animals to authenticated;
```

Cubre **R3.1..R3.5**, **R4.1..R4.12**, **R11.1..R11.5**.

### Helper `establishment_of_profile`

Lo usan las policies de las tablas de eventos para resolver el establishment del perfil sin joins manuales.

```sql
-- 0022_event_helpers.sql
create or replace function public.establishment_of_profile (profile_id uuid)
returns uuid language sql security definer stable
set search_path = public as $$
  select establishment_id from public.animal_profiles where id = profile_id;
$$;

grant execute on function public.establishment_of_profile (uuid) to authenticated;
```

### Tablas de eventos

Patrón común: cada tabla tiene `id`, `animal_profile_id`, `session_id (nullable, FK pendiente a sessions de spec 03)`, columnas de dominio, `created_by`, `created_at`, `deleted_at`. RLS por `has_role_in(establishment_of_profile(animal_profile_id))`. Trigger para autollenar `created_by = auth.uid()`.

```sql
-- 0023_event_created_by_helper.sql
create or replace function public.tg_set_created_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end; $$;
```

```sql
-- 0024_weight_events.sql
create type public.event_source as enum ('bluetooth', 'manual', 'import_xml');

create table public.weight_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,                 -- FK opcional, sessions viene en spec 03
  weight_kg          numeric(7,2) not null check (weight_kg > 0),
  weight_date        date not null,
  time               time,
  source             public.event_source not null default 'manual',
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index weight_events_by_profile_date
  on public.weight_events (animal_profile_id, weight_date desc)
  where deleted_at is null;

create trigger weight_events_set_created_by
  before insert on public.weight_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.weight_events enable row level security;

create policy weight_events_select on public.weight_events
  for select using (
    has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null
  );

create policy weight_events_insert on public.weight_events
  for insert with check (
    has_role_in(establishment_of_profile(animal_profile_id))
  );

create policy weight_events_update on public.weight_events
  for update using (
    -- owner o created_by puede editar
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  ) with check (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );

grant select, insert, update on public.weight_events to authenticated;
```

```sql
-- 0025_reproductive_events.sql
create type public.repro_event_type as enum (
  'service','tacto','birth','abortion','weaning','drying','rejection'
);
create type public.service_type_enum as enum ('natural','ai','te');
create type public.pregnancy_status_enum as enum ('empty','small','medium','large');

-- Tabla auxiliar para semen (mínima, sin stock — fully fleshed en feature 03)
create table public.semen_registry (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  pajuela_name      text not null,
  bull_name         text,
  breed             text,
  supplier          text,
  notes             text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (establishment_id, pajuela_name)
);
alter table public.semen_registry enable row level security;
create policy semen_select on public.semen_registry for select using (has_role_in(establishment_id) and deleted_at is null);
create policy semen_insert on public.semen_registry for insert with check (has_role_in(establishment_id));
create policy semen_update on public.semen_registry for update using (is_owner_of(establishment_id));
grant select, insert, update on public.semen_registry to authenticated;

create table public.reproductive_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  event_type         public.repro_event_type not null,
  event_date         date not null,
  service_type       public.service_type_enum,
  bull_id            uuid references public.animal_profiles(id),
  semen_id           uuid references public.semen_registry(id),
  pregnancy_status   public.pregnancy_status_enum,
  estimated_days     int,
  estimated_birth    date,
  calf_id            uuid references public.animal_profiles(id),
  calf_weight        numeric(7,2),
  calf_sex           text check (calf_sex in ('male','female')),
  calf_tag_electronic text,    -- opcional al cargar el parto (R9.3)
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index reproductive_events_by_profile_date
  on public.reproductive_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger reproductive_events_set_created_by
  before insert on public.reproductive_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.reproductive_events enable row level security;
create policy reproductive_events_select on public.reproductive_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy reproductive_events_insert on public.reproductive_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy reproductive_events_update on public.reproductive_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.reproductive_events to authenticated;
```

```sql
-- 0026_sanitary_events.sql
create type public.sanitary_event_type as enum ('vaccination','deworming','treatment','test','other');
create type public.sanitary_route as enum ('intramuscular','subcutaneous','oral','topical','other');

create table public.sanitary_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  campaign_id        uuid,  -- FK a sanitary_campaigns que se introduce en feature posterior
  event_type         public.sanitary_event_type not null,
  product_name       text not null,
  active_ingredient  text,
  dose_ml            numeric(7,2),
  route              public.sanitary_route,
  event_date         date not null,
  next_dose_date     date,
  result             text,
  adverse_reaction   boolean not null default false,
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index sanitary_events_by_profile_date
  on public.sanitary_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger sanitary_events_set_created_by
  before insert on public.sanitary_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.sanitary_events enable row level security;
create policy sanitary_events_select on public.sanitary_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy sanitary_events_insert on public.sanitary_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy sanitary_events_update on public.sanitary_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.sanitary_events to authenticated;
```

```sql
-- 0027_condition_score_events.sql
create table public.condition_score_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  score              numeric(3,2) not null
    check (score in (1.00,1.25,1.50,1.75,2.00,2.25,2.50,2.75,
                     3.00,3.25,3.50,3.75,4.00,4.25,4.50,4.75,5.00)),
  event_date         date not null,
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index condition_score_by_profile_date
  on public.condition_score_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger condition_score_set_created_by
  before insert on public.condition_score_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.condition_score_events enable row level security;
create policy condition_score_select on public.condition_score_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy condition_score_insert on public.condition_score_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy condition_score_update on public.condition_score_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.condition_score_events to authenticated;
```

```sql
-- 0028_lab_samples.sql
create type public.lab_sample_type as enum ('blood','scrape_tricho','scrape_campylo','other');

create table public.lab_samples (
  id                     uuid primary key default gen_random_uuid(),
  animal_profile_id      uuid not null references public.animal_profiles(id) on delete cascade,
  session_id             uuid,
  sample_type            public.lab_sample_type not null,
  tube_number            text not null,
  collection_date        date not null,
  lab_destination        text,
  result                 text,
  result_interpretation  text,
  result_received_date   date,
  notes                  text,
  created_by             uuid references public.users(id),
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

-- Búsqueda por tubo para vinculación automática (feature 06 lab imports)
create index lab_samples_tube on public.lab_samples (tube_number) where deleted_at is null;

create trigger lab_samples_set_created_by
  before insert on public.lab_samples
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.lab_samples enable row level security;
create policy lab_samples_select on public.lab_samples
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy lab_samples_insert on public.lab_samples
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy lab_samples_update on public.lab_samples
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.lab_samples to authenticated;
```

Cubre **R6.1..R6.8**.

### Historial de categoría

```sql
-- 0029_animal_category_history.sql
create type public.category_change_reason as enum (
  'initial','auto_transition','manual_override','revert_to_auto'
);

create table public.animal_category_history (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  from_category_id   uuid references public.categories_by_system(id),
  to_category_id     uuid not null references public.categories_by_system(id),
  changed_at         timestamptz not null default now(),
  changed_by         uuid references public.users(id),
  reason             public.category_change_reason not null
);

create index animal_category_history_by_profile
  on public.animal_category_history (animal_profile_id, changed_at desc);

-- Trigger: cada cambio en animal_profiles.category_id graba historial
create or replace function public.tg_animal_profiles_record_category_change ()
returns trigger language plpgsql as $$
declare v_reason public.category_change_reason;
begin
  if tg_op = 'INSERT' then
    v_reason := 'initial';
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, null, new.category_id, auth.uid(), v_reason);
  elsif tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') = 'on' then
      v_reason := 'auto_transition';
    elsif old.category_override = true and new.category_override = false then
      v_reason := 'revert_to_auto';
    else
      v_reason := 'manual_override';
    end if;
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, old.category_id, new.category_id, auth.uid(), v_reason);
  end if;
  return new;
end; $$;

create trigger animal_profiles_record_category_change_ins
  after insert on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_category_change();

create trigger animal_profiles_record_category_change_upd
  after update of category_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_category_change();

alter table public.animal_category_history enable row level security;
create policy animal_category_history_select on public.animal_category_history
  for select using (has_role_in(establishment_of_profile(animal_profile_id)));
-- Insert solo via trigger (security definer ya implícito por owner del schema)
grant select on public.animal_category_history to authenticated;
```

Cubre **R10.3**, **R12.4**.

### Transiciones automáticas

```sql
-- 0030_category_transitions.sql

-- compute_category(profile_id): recalcula desde cero (R7.6)
create or replace function public.compute_category (profile_id uuid)
returns uuid language plpgsql security definer stable
set search_path = public as $$
declare
  v_sex text;
  v_birth_date date;
  v_system_id uuid;
  v_births int;
  v_has_pos_tacto boolean;
  v_target_code text;
begin
  select a.sex, a.birth_date, r.system_id
    into v_sex, v_birth_date, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = profile_id;

  if v_sex = 'male' then
    if v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternero';
    else
      v_target_code := 'torito';   -- conservador, owner puede cambiar a 'toro'
    end if;
  else
    -- conteo de PARTOS (no de terneros) — R7.3/R7.9 (sesión 17):
    -- un parto = un evento 'birth', aunque haya parido N terneros (mellizos).
    -- Con el modelo de mellizos uno-a-muchos (ver "Mellizos / N terneros por parto"),
    -- un parto de mellizos sigue siendo UN evento 'birth', así que count(*) sobre
    -- eventos 'birth' == count de partos. Mantener este conteo por EVENTO de parto,
    -- nunca sumar filas-hijo / terneros.
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id
      and event_type = 'birth'
      and deleted_at is null;

    select exists (
      select 1 from public.reproductive_events
      where animal_profile_id = profile_id
        and event_type = 'tacto'
        and pregnancy_status is not null
        and pregnancy_status <> 'empty'
        and deleted_at is null
    ) into v_has_pos_tacto;

    if v_births >= 2 then
      v_target_code := 'multipara';
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';
    elsif v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternera';
    else
      v_target_code := 'vaquillona';
    end if;
  end if;

  return (select id from public.categories_by_system
          where system_id = v_system_id and code = v_target_code and active = true
          limit 1);
end; $$;

grant execute on function public.compute_category (uuid) to authenticated;

-- apply_transition: helper que setea la GUC y hace el UPDATE
create or replace function public.apply_auto_transition (profile_id uuid, target_category_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  perform set_config('rafaq.is_auto_transition', 'on', true);
  update public.animal_profiles
    set category_id = target_category_id
    where id = profile_id;
  perform set_config('rafaq.is_auto_transition', 'off', true);
end; $$;

-- Trigger sobre reproductive_events: dispara transición incremental (R7.1..R7.3)
create or replace function public.tg_reproductive_events_apply_transition ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_override boolean;
  v_current_code text;
  v_system_id uuid;
  v_target_code text;
  v_target_id uuid;
begin
  select p.category_override, c.code, r.system_id
    into v_override, v_current_code, v_system_id
  from public.animal_profiles p
  join public.categories_by_system c on c.id = p.category_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  if v_override is null or v_override = true then
    return new;  -- override activo => no tocamos
  end if;

  if new.event_type = 'tacto'
     and new.pregnancy_status is not null
     and new.pregnancy_status <> 'empty'
     and v_current_code = 'vaquillona' then
    v_target_code := 'vaquillona_prenada';
  elsif new.event_type = 'birth'
        and v_current_code = 'vaquillona_prenada' then
    v_target_code := 'vaca_segundo_servicio';
  elsif new.event_type = 'birth'
        and v_current_code = 'vaca_segundo_servicio' then
    v_target_code := 'multipara';
  else
    return new;
  end if;

  select id into v_target_id from public.categories_by_system
    where system_id = v_system_id and code = v_target_code and active = true;

  if v_target_id is null then
    -- R7.5: log y NO bloquear el insert
    raise warning 'auto transition target % not found for system %', v_target_code, v_system_id;
    return new;
  end if;

  perform public.apply_auto_transition(new.animal_profile_id, v_target_id);
  return new;
end; $$;

create trigger reproductive_events_apply_transition
  after insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_apply_transition();
```

**Ortogonalidad (R7.7)**: `apply_auto_transition` y `tg_reproductive_events_apply_transition` escriben **únicamente** `category_id` (vía el UPDATE de `apply_auto_transition`). No tocan `rodeo_id` ni `management_group_id`. Un animal que transiciona de `vaca_segundo_servicio` a `multipara` por un parto permanece en su mismo rodeo y su mismo lote. Ningún trigger del sistema asigna lote automáticamente (ADR-020 punto 6, R2.18).

**Transiciones por EDAD no automáticas por reloj (sesión 17, R7.8)**: no hay ningún cron ni job que re-evalúe la edad de los animales. El trigger de transición de arriba se dispara **solo por inserción de un evento** (tacto positivo, parto). Las transiciones etáreas (destete: `ternero`/`ternera` → categoría destetada) ocurren por un **evento de destete** (`reproductive_events` con `event_type = 'weaning'`) o por **override manual** (`R4.8`).

> **DEFERIDO Tier 2 — pendiente Facundo (NO se implementa en este fold).** La **rama de destete** (`weaning`) y la **rama de aborto** (`abortion`) del trigger de transición quedan **fuera del Tier 1**. Los **targets de categoría** están pendientes de confirmación de Facundo:
> - **Destete** (`weaning`): target propuesto `ternera → vaquillona`, `ternero → torito` — **a confirmar**.
> - **Aborto** (`abortion`): target propuesto `vaquillona_prenada → vaquillona` (único estado "preñada" en cría; revierte y `compute_category` deja de contar la preñez) — **a confirmar**.
>
> Hasta que Facundo confirme los targets, **no** se agregan estas ramas a `tg_reproductive_events_apply_transition` ni a `compute_category`. El esqueleto de la rama de destete (orientativo, **no** parte del Tier 1) sería:
>
> ```sql
> -- DEFERIDO Tier 2 — NO implementar en el fold Tier 1 (sesión 20). Pendiente Facundo.
> -- dentro de tg_reproductive_events_apply_transition, agregar (cuando se confirmen targets):
> --   elsif new.event_type = 'weaning' and v_current_code = 'ternera' then
> --     v_target_code := 'vaquillona';
> --   elsif new.event_type = 'weaning' and v_current_code = 'ternero' then
> --     v_target_code := 'torito';
> -- y la rama de aborto:
> --   elsif new.event_type = 'abortion' and v_current_code = 'vaquillona_prenada' then
> --     v_target_code := 'vaquillona';
> ```

`compute_category` (`R7.6`) usa `birth_date`/edad **solo** para resolver el punto de partida en el alta (`R4.7`) y como desempate cuando no hay eventos; **no** como disparador continuo (`R7.8`). El default para `birth_date IS NULL` (`R4.7.1`, **a confirmar**) es adulto-por-sexo sin evento: hembra → `vaquillona`, macho → `torito`. Hoy `compute_category` ya cae en `vaquillona`/`torito` cuando `birth_date is null` (la rama `< 365` no se cumple con NULL), así que el default propuesto **coincide con el comportamiento actual** — la requirement solo lo deja explícito y confirmable.

#### Recálculo de categoría al editar/borrar un evento que disparó transición (item 4 — migration `0046`, R6.14)

Cuando se **edita o soft-deletea** un evento tipado que participó de una transición (típicamente un `reproductive_events` de `tacto` positivo o `birth`), y el perfil tiene `category_override = false`, hay que **recalcular** la categoría desde cero con `compute_category` y persistir el resultado (registrando en `animal_category_history`). El fold Tier 1 deja firme el trigger AFTER UPDATE/DELETE sobre `reproductive_events` que recompute:

```sql
-- 0046_category_recompute_on_event_change.sql (fold Tier 1, sesión 20)
create or replace function public.tg_reproductive_events_recompute_on_change ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare v_override boolean; v_target uuid; v_profile uuid;
begin
  v_profile := coalesce(new.animal_profile_id, old.animal_profile_id);
  select category_override into v_override from public.animal_profiles where id = v_profile;
  if v_override is null or v_override = true then
    return coalesce(new, old);   -- override manda (R4.9)
  end if;
  v_target := public.compute_category(v_profile);
  if v_target is not null then
    perform public.apply_auto_transition(v_profile, v_target);  -- reusa la GUC + history (reason auto_transition)
  end if;
  return coalesce(new, old);
end; $$;

-- AFTER UPDATE: solo cuando cambia algo relevante a una transición.
create trigger reproductive_events_recompute_on_update
  after update of event_type, pregnancy_status, deleted_at on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_on_change();

-- AFTER DELETE: cubre el hard-delete (raro; el flujo normal es soft-delete vía UPDATE de deleted_at,
-- que ya entra por el trigger de UPDATE de arriba).
create trigger reproductive_events_recompute_on_delete
  after delete on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_on_change();
```

Notas:
- **Alcance del recálculo**: el trigger vive **solo sobre `reproductive_events`** porque es la única tabla tipada que participa de transiciones de categoría en el Tier 1 (`tacto` positivo, `birth`). Las otras cuatro tipadas (`weight_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) no disparan transiciones, así que no llevan este trigger. (Cuando Tier 2 agregue `weaning`/`abortion`, siguen siendo `reproductive_events`, así que el mismo trigger los cubre sin cambios.)
- **El soft-delete es un UPDATE de `deleted_at`**: el trigger `... after update of deleted_at` lo captura. El trigger `after delete` es defensa para el hard-delete eventual.
- El recálculo reusa `apply_auto_transition` (que setea la GUC `rafaq.is_auto_transition`), así el cambio queda registrado en `animal_category_history` como `auto_transition` y no marca override.
- El **cliente** marca el evento como "corregido" en el timeline (es presentación; el soft-delete ya preserva la fila para el audit trail). No requiere columna nueva: editado = `created_at < updated_at` (si las tipadas tuvieran `updated_at`) o, para soft-delete, `deleted_at IS NOT NULL` filtrado fuera del timeline normal pero contable para el aviso. **Decisión de presentación del cliente** (R14, TENTATIVO).
- **Edición/borrado sin ventana de tiempo** para los 5 tipados (`R6.8.1`): las policies de UPDATE de las tablas tipadas (`is_owner_of OR created_by = auth.uid()`) **ya** permiten esto sin límite temporal. **No** hay que agregar ningún `edit_window_until` a las tipadas — la ventana de 15 min es exclusiva de `animal_events` (R6.12). Esto corrige la lectura de spec 09 R5.5 (que asumía 15 min para todos): el cliente de spec 09 debe ofrecer editar/borrar los tipados a owner/autor siempre, y limitar a 15 min solo las observaciones.

Cubre **R7.1..R7.9**, **R6.8.1**, **R6.14**, **R4.7.1**.

### Ternero al pie (R9) + mellizos / N terneros por parto (item 3 — migration `0045`, R7.9 / R9.5)

> **Cambio conceptual (sesión 17, firme en fold Tier 1 sesión 20)**: un parto es **un** evento `birth` con **N terneros** asociados (uno-a-muchos), no un evento por ternero. El modelo as-built actual (migration `0031`) crea exactamente un ternero por evento `birth` y linkea vía la columna `reproductive_events.calf_id` (uno-a-uno). El fold Tier 1 deja firme la relación uno-a-muchos vía tabla puente `birth_calves` para soportar mellizos sin romper el conteo de partos.

**Tabla puente `birth_calves` (firme, migration `0045`):**

```sql
-- 0045_birth_calves.sql (fold Tier 1, sesión 20)
create table public.birth_calves (
  birth_event_id   uuid not null references public.reproductive_events(id) on delete cascade,
  calf_profile_id  uuid not null references public.animal_profiles(id),
  created_at       timestamptz not null default now(),
  primary key (birth_event_id, calf_profile_id)
);
create index birth_calves_by_event on public.birth_calves (birth_event_id);
create index birth_calves_by_calf  on public.birth_calves (calf_profile_id);

-- RLS: el establishment se deriva del animal de la MADRE (dueña del evento de parto),
-- vía establishment_of_profile sobre el animal_profile_id del reproductive_events.
-- (SEC-SPEC-04, Gate 1 s20) Ambas policies filtran `re.deleted_at is null`: tras soft-deletear
-- el evento de parto, las filas de birth_calves NO deben seguir visibles ni insertables
-- (consistente con que toda policy de SELECT del spec filtra deleted_at — R12.3).
alter table public.birth_calves enable row level security;

create policy birth_calves_select on public.birth_calves
  for select using (
    exists (
      select 1 from public.reproductive_events re
      where re.id = birth_calves.birth_event_id
        and re.deleted_at is null
        and has_role_in(establishment_of_profile(re.animal_profile_id))
    )
  );
-- NO hay policy de INSERT para `authenticated`: la tabla se puebla SOLO desde el flujo de
-- parto SECURITY DEFINER (trigger mono-ternero extendido + RPC register_birth de mellizos),
-- que corren como owner del schema y bypassean RLS. El vínculo madre→ternero es append-only
-- y de ORIGEN SERVER (SEC-SPEC-04): el cliente nunca inserta filas directas. Sin GRANT INSERT,
-- un caller no puede fabricar parentescos ni ligar terneros cruzados desde PostgREST.
-- (La policy de SELECT, con re.deleted_at is null, sí es para el cliente — necesita leer la relación.)

grant select on public.birth_calves to authenticated;
-- Sin INSERT/UPDATE/DELETE de cliente: la relación es append-only y server-side.
-- Al hard-deletear el evento de parto, el ON DELETE CASCADE limpia birth_calves.
-- (El flujo normal es soft-delete del evento; la fila puente queda pero deja de ser visible
--  por el filtro re.deleted_at is null de la policy de SELECT.)
```

- **Por qué tabla puente y no múltiples eventos `birth`**: si cada mellizo fuera su propio evento `birth`, el conteo de partos de `compute_category` (`count(*)` sobre eventos `birth`) marcaría a la madre como multípara con un solo parto real. La tabla puente mantiene **un** evento de parto con **N** terneros, así que `count(distinct birth_event)` == partos. **El conteo de partos en `compute_category` (ya firme, ver "Transiciones automáticas") cuenta `reproductive_events` con `event_type = 'birth'` distintos, NUNCA filas de `birth_calves` ni terneros.** El comentario en `compute_category` lo deja explícito.
- **`birth_calves` es de origen SERVER, no se inserta directo desde el cliente (SEC-SPEC-04)**: se **quitó** `insert` del grant a `authenticated`. La tabla la pobla **solo** el flujo de parto `SECURITY DEFINER` (el trigger mono-ternero extendido de `0031` y el RPC `register_birth` de mellizos), que corren como owner del schema y bypassean RLS. Esto cierra dos vectores que abría el INSERT directo de cliente: (a) **fabricar parentescos falsos** ligando cualquier `calf_profile_id` del propio establecimiento a un parto ajeno; y (b) el **cruce de tenant** (ternero de otro establishment), que la antigua policy de INSERT (solo `has_role_in` sobre la madre) no validaba. Como la única vía de escritura es el flujo server, la herencia de tenant del ternero (mismo establishment + rodeo de la madre, garantizada por el trigger/RPC) es ahora la **única** forma de poblar la tabla — no hay superficie PostgREST para corromperla.
- **`re.deleted_at is null` en la policy de SELECT (SEC-SPEC-04)**: tras soft-deletear el evento de parto, las filas de `birth_calves` dejan de ser visibles, consistente con que toda policy de SELECT del spec filtra `deleted_at is null` (`R12.3`). El flujo normal de borrado de un parto es soft-delete; el `ON DELETE CASCADE` solo aplica al hard-delete (que no ocurre en el flujo normal).
- **Compatibilidad con la columna `calf_id` existente**: la columna `reproductive_events.calf_id` (uno-a-uno) **se conserva** apuntando al primer/único ternero, por compatibilidad con las lecturas as-built (`animal_timeline` rinde `calf_id` en el payload; `R14.7` navega a la madre). `birth_calves` es la **fuente de verdad** de la relación completa madre→terneros. El vínculo se resuelve por `birth_calves JOIN reproductive_events`; `calf_id` queda como atajo para el caso mono-ternero (común).
- **`R4.15`**: ningún ternero referenciado en `birth_calves` se hard-deletea; la baja de la madre o de un ternero es cambio de `status`. Las navegaciones a la ficha de la madre toleran `status ≠ active`.

**Creación de N terneros (firme, migration `0045`)**: la creación deja de producir exactamente uno. El mecanismo concreto:
- **Para el caso mono-ternero** (el común): se **conserva** el trigger BEFORE INSERT as-built `tg_reproductive_events_create_calf` (`0031`), que crea el ternero a partir de `calf_sex`/`calf_weight`/`calf_tag_electronic` del propio evento y lo linkea en `calf_id`. La migration `0045` **agrega** una fila en `birth_calves(birth_event_id, calf_profile_id)` para ese ternero (extendiendo el mismo trigger con un INSERT a la tabla puente tras setear `calf_id`). El INSERT a `birth_calves` lo hace el trigger `SECURITY DEFINER` (no el cliente, que ya no tiene `GRANT INSERT` — SEC-SPEC-04).
- **Para el caso multi-ternero** (mellizos): el cliente envía la lista de terneros del parto (`[{ calf_sex, calf_weight?, calf_tag_electronic? }, ...]`) y la creación se hace vía un **RPC `SECURITY DEFINER`** que, en una transacción: inserta el `reproductive_events` de parto, itera la lista, crea un `animal` + `animal_profile` por ternero (misma herencia que `R9.1`: establishment + rodeo de la madre, `management_group_id = NULL`, categoría `ternero`/`ternera` según sexo, `entry_origin = 'born_here'`, fallback `visual_id_alt` por ternero sin TAG), e inserta una fila en `birth_calves` por cada uno (poblando `calf_id` con el primero por compat). Si **cualquier** ternero falla, rollback del evento completo (`R9.4`/`R9.5`).
- En ambos caminos, **el trigger de transición de la madre se dispara una sola vez** por el evento de parto (es AFTER INSERT sobre `reproductive_events`, no sobre `birth_calves`), así que mellizos no doble-cuentan el parto.

**Contrato firme del RPC de mellizos (SEC-SPEC-02, Gate 1 s20 — NO se difiere al implementer).** El Gate 1 escala a HIGH cualquier RPC `SECURITY DEFINER` invocable por el cliente cuyo contrato de autorización quede sin fijar (es la condición exacta que produjo SEC-HIGH-01: `register_birth` **escribe `animal_profiles`** con input del cliente, idéntica superficie de riesgo). Por eso el RPC **deja de estar en prosa** ("lo define el implementer") y pasa a **SQL firme**: la firma, la derivación de autorización, el blindaje de la superficie RPC y el `search_path` quedan fijos en el design; el implementer solo escribe el cuerpo de creación de los N terneros:

1. **Firma tipada concreta** (parámetros explícitos, sin overloads ambiguos):

   ```sql
   -- 0045_birth_calves.sql (continúa — RPC de parto con N terneros; fold Tier 1, sesión 20)
   create or replace function public.register_birth (
     p_mother_profile_id uuid,
     p_event_date        date,
     p_calves            jsonb   -- [{ "calf_sex": "male|female", "calf_weight": num?, "calf_tag_electronic": text? }, ...]
   ) returns uuid                -- devuelve el reproductive_events.id del parto creado
   language plpgsql security definer
   set search_path = public as $$
   declare v_est uuid; v_birth_event_id uuid;
   begin
     -- (a) AUTORIZACIÓN derivada de la FILA REAL de la madre, NUNCA de un parámetro del cliente:
     select establishment_id into v_est
     from public.animal_profiles
     where id = p_mother_profile_id and deleted_at is null;
     if v_est is null then
       raise exception 'mother animal_profile not found' using errcode = '23503';
     end if;
     if not public.has_role_in(v_est) then
       raise exception 'not authorized to register a birth for this animal' using errcode = '42501';
     end if;
     -- (b) inserta reproductive_events(event_type='birth', animal_profile_id=p_mother_profile_id, ...)
     --     itera p_calves, crea animal + animal_profile por ternero heredando v_est (NO un est del payload),
     --     inserta birth_calves por cada uno, puebla calf_id con el primero. Rollback total si cualquiera falla.
     -- ... cuerpo a cargo del implementer ...
     return v_birth_event_id;
   end; $$;
   ```

2. **La autorización se deriva del `establishment_id` de la fila real de la madre** (`select establishment_id into v_est from animal_profiles where id = p_mother_profile_id`), leída por dentro del `SECURITY DEFINER`, y se valida con `has_role_in(v_est)`. **Nunca** se confía en un `establishment_id` (ni en cualquier otra columna de tenant) que venga en el payload o en un parámetro. Como el RPC bypassea toda RLS por dentro, esto es la única defensa contra que un caller del tenant A pase `p_mother_profile_id` del tenant B y cree el parto/terneros en B (mismo bug que `apply_auto_transition`, SEC-HIGH-01). Idéntico al patrón de `exit_animal_profile` (deriva `v_est` de la fila real) y `soft_delete_event` (`0041`).

3. **Herencia de tenant en cada ternero**: cada `animal_profile` de ternero creado hereda `v_est` (el establishment derivado de la madre), no un valor del payload. El rodeo es el de la madre (`R9.1`). El RPC no acepta `establishment_id`/`rodeo_id` de cliente.

4. **Cierre de la superficie RPC** (patrón obligatorio post-SEC-HIGH-01, con firma tipada completa):

   ```sql
   revoke execute on function public.register_birth(uuid, date, jsonb) from public, anon;
   grant  execute on function public.register_birth(uuid, date, jsonb) to authenticated;
   notify pgrst, 'reload schema';
   ```

   `register_birth` **sí** debe ser invocable por `authenticated` (es el camino de carga de mellizos del cliente) — a diferencia de `apply_auto_transition`, que NO debía y fue revocado a los tres roles. El `revoke ... from public, anon` cierra el `EXECUTE TO PUBLIC` por default y el acceso anónimo; el `grant ... to authenticated` con firma tipada deja el RPC abierto solo a usuarios logueados.

5. **Test obligatorio (`tasks.md` + suite)**: un caller del tenant A que invoque `register_birth(p_mother_profile_id = <perfil del tenant B>, ...)` debe recibir **`42501`** y **no crear nada** (ni evento, ni animales, ni `birth_calves`). El camino feliz (madre del propio tenant) crea el parto + N terneros en una transacción.

> **Reconciliación trigger mono ↔ RPC N — camino firme, sin ambigüedad (SEC-SPEC-02)**: el reparto entre el trigger as-built y el RPC nuevo queda **fijo** así (se elige UNA partición, no se deja a criterio):
> - **Exactamente 1 ternero (caso común)**: lo maneja el **trigger BEFORE INSERT `tg_reproductive_events_create_calf`** (`0031`), que se dispara cuando el cliente inserta directo un `reproductive_events` de `event_type='birth'` con los campos `calf_*` del propio evento. La migration `0045` lo **extiende** para que, además de setear `calf_id`, inserte la fila correspondiente en `birth_calves(birth_event_id, calf_profile_id)`. Este camino conserva el comportamiento as-built (ya cubierto por tests) y **no** crea superficie RPC nueva: la autorización la da la policy de INSERT de `reproductive_events` (`has_role_in`), el INSERT a `birth_calves` lo hace el trigger `SECURITY DEFINER` (no el cliente, coherente con SEC-SPEC-04).
> - **N ≥ 2 terneros (mellizos)**: lo maneja **exclusivamente** el RPC `register_birth` especificado arriba. El cliente **no** inserta el `reproductive_events` directo en este caso: llama al RPC con `p_calves` de longitud ≥ 2. El RPC inserta el evento de parto, los N `animal_profiles` y las N filas de `birth_calves` en una transacción atómica con rollback total (`R9.4`/`R9.5`), todo bajo el contrato de autorización firme de arriba (`v_est` derivado de la fila real de la madre, `has_role_in` antes de cualquier INSERT, `revoke/grant` + `search_path`).
>
> El implementer **puede** unificar ambos caminos enrutando también el caso 1-ternero por `register_birth` (con `p_calves` de longitud 1), si lo prefiere por simetría — pero **solo** bajo la condición de que (i) el conteo de partos siga siendo por evento `birth` (nunca por ternero / fila de `birth_calves`) y (ii) se respete íntegro el contrato de seguridad firme de arriba (firma tipada, `v_est` derivado de la fila real, `has_role_in` antes de los INSERT, `revoke ... from public, anon` + `grant ... to authenticated` + `notify`). Lo que **NO** se difiere es la firma ni el contrato de seguridad del RPC: quedan firmes. Lo único a cargo del implementer es el **cuerpo** de creación de los N terneros.

El trigger uno-a-uno as-built queda como base del comportamiento mono-ternero (válido para un solo ternero, el caso común; `0045` lo extiende para poblar `birth_calves`):

```sql
-- 0031_calf_creation.sql (as-built mono-ternero; 0045 lo extiende para poblar birth_calves)
create or replace function public.tg_reproductive_events_create_calf ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_mother_species_id uuid;
  v_mother_est_id uuid;
  v_mother_rodeo_id uuid;
  v_system_id uuid;
  v_calf_animal_id uuid;
  v_calf_profile_id uuid;
  v_calf_category_id uuid;
  v_calf_category_code text;
  v_visual_fallback text := 'recién nacido — pendiente de caravana';
begin
  if new.event_type <> 'birth' then return new; end if;
  if new.calf_id is not null then return new; end if;
  if new.calf_sex is null then return new; end if;
  -- calf_weight es opcional; el alta no depende de él

  select a.species_id, p.establishment_id, p.rodeo_id, r.system_id
    into v_mother_species_id, v_mother_est_id, v_mother_rodeo_id, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  -- Categoría inicial del ternero
  v_calf_category_code := case when new.calf_sex = 'male' then 'ternero' else 'ternera' end;
  select id into v_calf_category_id from public.categories_by_system
    where system_id = v_system_id and code = v_calf_category_code and active = true;

  -- 1) Crear animal global (TAG si vino, sino null)
  insert into public.animals (tag_electronic, species_id, sex, birth_date)
  values (nullif(trim(new.calf_tag_electronic), ''), v_mother_species_id, new.calf_sex, new.event_date)
  returning id into v_calf_animal_id;

  -- 2) Crear perfil del ternero
  insert into public.animal_profiles (
    animal_id, establishment_id, rodeo_id,
    visual_id_alt, category_id, category_override,
    birth_weight, entry_date, entry_origin, status
  ) values (
    v_calf_animal_id,
    v_mother_est_id,
    v_mother_rodeo_id,
    case when nullif(trim(new.calf_tag_electronic), '') is null then v_visual_fallback else null end,
    v_calf_category_id,
    false,
    new.calf_weight,
    new.event_date,
    'born_here',
    'active'
  ) returning id into v_calf_profile_id;

  -- 3) Linkear
  new.calf_id := v_calf_profile_id;
  return new;
exception
  when others then
    -- R9.4: rollback automático lo asegura Postgres por la transacción del INSERT.
    raise;
end; $$;

create trigger reproductive_events_create_calf
  before insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_create_calf();
```

Cubre **R9.1..R9.4**.

Nota: el trigger BEFORE INSERT corre antes que `tg_reproductive_events_apply_transition` (AFTER INSERT). Eso asegura que `calf_id` queda escrito en el row antes de la transición de la madre.

### Cronología

```sql
-- 0032_animal_timeline.sql
create or replace function public.animal_timeline (profile_id uuid)
returns table (
  event_kind  text,
  event_id    uuid,
  event_date  timestamptz,
  payload     jsonb
) language sql security definer stable
set search_path = public as $$
  -- Acceso: validamos en la primera línea con check de has_role_in
  select 'weight'::text, id, (weight_date::timestamptz + coalesce(time, '00:00'::time)),
         jsonb_build_object('weight_kg', weight_kg, 'source', source, 'notes', notes)
  from public.weight_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'reproductive', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'pregnancy_status', pregnancy_status,
                            'calf_id', calf_id, 'notes', notes)
  from public.reproductive_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'sanitary', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'product_name', product_name,
                            'route', route, 'notes', notes)
  from public.sanitary_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'condition_score', id, event_date::timestamptz,
         jsonb_build_object('score', score, 'notes', notes)
  from public.condition_score_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'lab_sample', id, collection_date::timestamptz,
         jsonb_build_object('sample_type', sample_type, 'tube_number', tube_number,
                            'result', result, 'received', result_received_date)
  from public.lab_samples
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'category_change', id, changed_at,
         jsonb_build_object('from', from_category_id, 'to', to_category_id, 'reason', reason)
  from public.animal_category_history
  where animal_profile_id = profile_id
    and has_role_in(establishment_of_profile(profile_id))

  order by event_date desc;
$$;

grant execute on function public.animal_timeline (uuid) to authenticated;
```

Cubre **R10.1**, **R10.2**.

### Eventos libres / observaciones (`animal_events`) — modelo Híbrido

> Tabla agregada en refinamiento 2026-05-26 (ADR-017 matizado). Convive con las 5 tablas tipadas; cubre **solo** `event_type IN ('observacion','otro')`. Los demás tipos del ADR-017 original (`salud`, `reproduccion`, `traslado`, `pesaje`, `identificacion`) **no** van acá: ya están en las 5 tablas tipadas. Esa convivencia preserva type-safety para el pilar de analytics y, a la vez, da al operador un cuaderno libre para observaciones humanas sin schema.

```sql
-- 0033_animal_events.sql
create table public.animal_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  author_id          uuid not null references public.users(id),
  created_at         timestamptz not null default now(),
  event_type         text not null check (event_type in ('observacion','otro')),
  text               text,
  structured_payload jsonb,
  edit_window_until  timestamptz not null default (now() + interval '15 minutes'),
  deleted_at         timestamptz
);

create index animal_events_by_profile_created
  on public.animal_events (animal_profile_id, created_at desc)
  where deleted_at is null;

create index animal_events_by_establishment
  on public.animal_events (establishment_id, created_at desc)
  where deleted_at is null;

create index animal_events_by_author
  on public.animal_events (author_id, created_at desc);

-- Trigger: setear author_id automáticamente desde auth.uid() si vino null
create or replace function public.tg_set_author_id_auth_uid ()
returns trigger language plpgsql as $$
begin
  if new.author_id is null then
    new.author_id := auth.uid();
  end if;
  return new;
end; $$;

create trigger animal_events_set_author_id
  before insert on public.animal_events
  for each row execute function public.tg_set_author_id_auth_uid();

-- Trigger: validar consistencia animal_profile_id ↔ establishment_id
-- (el cliente envía ambos; defensivamente verificamos que coinciden)
create or replace function public.tg_animal_events_validate_est ()
returns trigger language plpgsql as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.animal_profiles where id = new.animal_profile_id;
  if v_est is null then
    raise exception 'animal_profile_id not found' using errcode = '23503';
  end if;
  if v_est <> new.establishment_id then
    raise exception 'establishment_id mismatch with animal_profile' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_events_validate_est
  before insert on public.animal_events
  for each row execute function public.tg_animal_events_validate_est();

-- Trigger: rechazar UPDATE de text/structured_payload/event_type pasada la ventana
create or replace function public.tg_animal_events_enforce_edit_window ()
returns trigger language plpgsql as $$
begin
  if now() > old.edit_window_until then
    if new.text is distinct from old.text
       or new.structured_payload is distinct from old.structured_payload
       or new.event_type is distinct from old.event_type then
      raise exception 'edit window expired for animal_event %', old.id
        using errcode = '23514';
    end if;
  end if;
  -- author_id, animal_profile_id, establishment_id, created_at, edit_window_until inmutables
  if new.author_id        is distinct from old.author_id
     or new.animal_profile_id is distinct from old.animal_profile_id
     or new.establishment_id  is distinct from old.establishment_id
     or new.created_at        is distinct from old.created_at
     or new.edit_window_until is distinct from old.edit_window_until then
    raise exception 'immutable column changed on animal_event %', old.id
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_events_enforce_edit_window
  before update on public.animal_events
  for each row execute function public.tg_animal_events_enforce_edit_window();

-- RECONCILIACIÓN (feature 11 — transferencia-animal, migración 0088, sesión 23): el cuerpo de
-- tg_animal_events_enforce_edit_window se re-emitió (CREATE OR REPLACE, append-only) con un
-- early-return al INICIO cuando la GUC LOCAL `rafaq.is_transfer = 'on'` está activa. El RPC
-- transfer_animal (SECURITY DEFINER, 0087) re-apunta la observación al perfil nuevo en Y cambiando
-- animal_profile_id + establishment_id (ambas inmutables acá); la GUC habilita ESE re-apuntado solo
-- dentro del definer. Un UPDATE de cliente directo a PostgREST NO puede setear la GUC dentro de la
-- transacción del trigger → la inmutabilidad sigue valiendo para clientes (cero relajación del vector
-- anti-spoof que este trigger cierra). Mismo patrón que rafaq.is_auto_transition (0031). Ver
-- specs/active/11-transferencia-animal/design.md §4.3 (DEC-A1).

-- RLS
alter table public.animal_events enable row level security;

create policy animal_events_select on public.animal_events
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy animal_events_insert on public.animal_events
  for insert with check (has_role_in(establishment_id));

-- UPDATE: author original (dentro o fuera de ventana — el trigger enforce qué columnas son tocables) o owner
create policy animal_events_update on public.animal_events
  for update using (
    has_role_in(establishment_id)
    and (author_id = auth.uid() or is_owner_of(establishment_id))
  ) with check (
    has_role_in(establishment_id)
    and (author_id = auth.uid() or is_owner_of(establishment_id))
  );

grant select, insert, update on public.animal_events to authenticated;
```

Notas:
- El CHECK `event_type IN ('observacion','otro')` cierra el alcance a lo que el modelo Híbrido pidió. **No** abrir a `'salud'`, `'reproduccion'`, etc. — esos ya están cubiertos por las 5 tablas tipadas (R6.1..R6.5).
- El trigger `enforce_edit_window` se aplica también al UPDATE de `deleted_at` desde el cliente, pero no lo bloquea porque solo enforce las 3 columnas de contenido + las 5 columnas inmutables. Cambiar `deleted_at` (soft-delete) es permitido siempre.
- **Evolución post-MVP**: si en uso real se valida que conviene unificar las 5 tablas tipadas + `animal_events` en un único modelo "evento genérico + capa de vistas tipadas", se evaluará entonces. Por ahora la separación se mantiene porque protege analytics. Documentado como TODO conceptual; no hay implementación pendiente.

Cubre **R6.10**, **R6.11**, **R6.12**, **R6.13**.

### Cronología v2 (incluye `animal_events`)

La función `animal_timeline` de `0032` se reemplaza para incluir el séptimo origen `observacion`.

```sql
-- 0034_animal_timeline_v2.sql
create or replace function public.animal_timeline (profile_id uuid)
returns table (
  event_kind  text,
  event_id    uuid,
  event_date  timestamptz,
  payload     jsonb
) language sql security definer stable
set search_path = public as $$
  select 'weight'::text, id, (weight_date::timestamptz + coalesce(time, '00:00'::time)),
         jsonb_build_object('weight_kg', weight_kg, 'source', source, 'notes', notes)
  from public.weight_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'reproductive', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'pregnancy_status', pregnancy_status,
                            'calf_id', calf_id, 'notes', notes)
  from public.reproductive_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'sanitary', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'product_name', product_name,
                            'route', route, 'notes', notes)
  from public.sanitary_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'condition_score', id, event_date::timestamptz,
         jsonb_build_object('score', score, 'notes', notes)
  from public.condition_score_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'lab_sample', id, collection_date::timestamptz,
         jsonb_build_object('sample_type', sample_type, 'tube_number', tube_number,
                            'result', result, 'received', result_received_date)
  from public.lab_samples
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'category_change', id, changed_at,
         jsonb_build_object('from', from_category_id, 'to', to_category_id, 'reason', reason)
  from public.animal_category_history
  where animal_profile_id = profile_id
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'observacion', id, created_at,
         jsonb_build_object('event_type', event_type, 'text', text,
                            'structured_payload', structured_payload,
                            'author_id', author_id,
                            'edit_window_until', edit_window_until)
  from public.animal_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_id)

  order by event_date desc;
$$;

grant execute on function public.animal_timeline (uuid) to authenticated;
```

Cubre **R10.1** (extendido), **R10.2**.

> **R2.12.1 (sesión 17)**: `animal_timeline` **no** filtra por `rodeo_data_config.enabled` ni por `field_definitions.active`. Renderiza todos los eventos históricos del perfil aunque su data_key haya sido destildado o el field deshabilitado — el historial es siempre visible. Esta función ya cumple R2.12.1 sin cambios; la requirement solo lo asienta. La marca de "corregido" para eventos editados/borrados (R6.14) es responsabilidad de presentación del cliente; el soft-delete ya excluye del timeline normal las observaciones borradas (`deleted_at IS NULL` en el WHERE) — para mostrar "X corregido" el cliente puede consultar aparte o el implementer puede exponer una variante con `include_deleted`.

### Inmutabilidad de identificadores post-alta (R4.13)

Migration nueva que bloquea por trigger cualquier UPDATE de `animals.tag_electronic` o `animal_profiles.idv`. `visual_id_alt` sigue editable.

```sql
-- 0035_immutability_identifiers.sql
-- Inmutabilidad relajada (refinamiento 2026-05-26 para destrabar R12 de spec 09):
-- - Permitir NULL → valor (completar info que faltaba al alta).
-- - Bloquear valor → otro valor (reescribir identidad: rompe trazabilidad SENASA).
-- - Bloquear valor → NULL (volver a quedar "sin caravana" tras haberla tenido no es un caso de uso real;
--   si alguna vez aparece, se trata como caso edge a refinar; por defecto se rechaza).

create or replace function public.tg_animals_block_tag_change ()
returns trigger language plpgsql as $$
begin
  -- Permitir NULL → valor (asignación inicial de caravana en spec 09 R7/R8).
  if old.tag_electronic is null then
    return new;
  end if;
  -- Bloquear cualquier cambio cuando ya había un TAG cargado.
  if new.tag_electronic is distinct from old.tag_electronic then
    raise exception 'tag_electronic is immutable once set (animal %); use soft-delete + new insert to correct an erroneous TAG'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animals_block_tag_change
  before update of tag_electronic on public.animals
  for each row execute function public.tg_animals_block_tag_change();

create or replace function public.tg_animal_profiles_block_idv_change ()
returns trigger language plpgsql as $$
begin
  -- Misma política: NULL → valor permitido (completar IDV faltante al alta).
  if old.idv is null then
    return new;
  end if;
  if new.idv is distinct from old.idv then
    raise exception 'idv is immutable once set (profile %); use soft-delete + new insert to correct an erroneous IDV'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_block_idv_change
  before update of idv on public.animal_profiles
  for each row execute function public.tg_animal_profiles_block_idv_change();
```

Notas:
- `visual_id_alt` queda explícitamente **fuera** del bloqueo: es texto libre que en la práctica se carga incompleto al inicio.
- **Refinamiento 2026-05-26**: la inmutabilidad de `tag_electronic` e `idv` es **post-completitud, no post-alta**. Una vez que el campo tiene valor, no se puede cambiar. Pero `NULL → valor` está permitido para soportar el caso "animal cargado sin caravana al que después se le pone una" (spec 09 R7/R8 — asignación de caravanas). La distinción semántica: completar información que faltaba ≠ reescribir identidad. El primer caso preserva trazabilidad; el segundo la rompe.
- Tests requeridos (T2.x correspondiente): caso permitido (`NULL → 'ARG001'`) y caso prohibido (`'ARG001' → 'ARG002'`) validados por separado. También bloquear `valor → NULL` (defensivo).
- **TAG no reusable + corrección (sesión 17, R5.6 / R4.13.b)**: el unique parcial `animals_tag_unique` está acotado a `tag_electronic is not null and deleted_at is null`. Por eso un TAG cargado por error se corrige con **soft-delete del `animal` (+ su `animal_profile`)** —que lo saca del índice parcial y **libera** el TAG— seguido de un **alta correctiva** con el TAG correcto. Esto es consistente con SENASA: el chip físico es único de por vida; acá se reasigna el registro lógico de un alta errónea, no se recicla un chip. **Error accionable al escanear un TAG ya existente** (`R5.6`): la búsqueda por TAG (`R5.1`, primitive consumida por spec 09) debe poder distinguir el caso "TAG existe en un animal **activo**" del caso "TAG existe en un animal **dado de baja**" (`status ≠ active`, `deleted_at IS NULL`) para que el cliente arme el mensaje *"Este TAG pertenece a `<animal>`, dado de baja el `<fecha>`."*. A nivel datos, la query de búsqueda por TAG retorna el animal dueño + su `status`/`exit_date` para que spec 09 construya el copy. Un TAG de un animal **soft-deleted** ya no aparece (índice parcial), así que un alta con ese TAG es aceptada (alta correctiva).

Cubre **R4.13**, **R5.6** (a nivel primitive de búsqueda).

## Row Level Security (resumen)

| Tabla | SELECT | INSERT | UPDATE | DELETE (hard) |
|---|---|---|---|---|
| `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields` | todos los autenticados | — (vía migration) | — | — |
| `rodeos` | `has_role_in` | `is_owner_of` | `is_owner_of` | — (soft via UPDATE) |
| `rodeo_data_config` | `has_role_in` (via join a `rodeos`) | `is_owner_of` (habilitar field no-default) | `is_owner_of` (toggle) | — (CASCADE desde `rodeos`) |
| `management_groups` (lote) | `has_role_in` + `deleted_at IS NULL` | `is_owner_of` | `is_owner_of` | — (soft via `deleted_at`) |
| `animals` | derivado de `animal_profiles` | autenticado | derivado | — |
| `animal_profiles` | `has_role_in` + `deleted_at IS NULL` | `has_role_in` | `has_role_in` (incluye asignar `management_group_id`) | — |
| `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples` | `has_role_in(establishment_of_profile(...))` | idem | `is_owner_of OR created_by = uid()` | — |
| `animal_events` (Híbrido, `'observacion' \| 'otro'`) | `has_role_in(establishment_id)` | `has_role_in(establishment_id)` | `author_id = uid() OR is_owner_of` + trigger enforce edit_window | — (soft via `deleted_at`) |
| `semen_registry` | `has_role_in` | `has_role_in` | `is_owner_of` | — |
| `animal_category_history` | `has_role_in` | (trigger) | — | — |
| `birth_calves` (sesión 17, mellizos R7.9) | `has_role_in` (via join a `reproductive_events`→`animal_profiles`) **+ `re.deleted_at IS NULL`** | **sin GRANT INSERT de cliente** — poblada solo server-side (trigger mono + RPC `register_birth`, SEC-SPEC-04) | — | — (CASCADE desde el evento) |

Cubre **R11.1..R11.5**. La baja de animal (`R4.14`) se hace vía RPC `exit_animal_profile` (`SECURITY DEFINER`, re-valida `has_role_in AND (is_owner_of OR created_by = auth.uid())` — rol activo obligatorio, SEC-SPEC-01), no por UPDATE directo de cliente — mismo patrón que las RPCs de soft-delete (ver Changelog as-built). El alta de mellizos (`R7.9`/`R9.5`) usa el RPC firme `register_birth` (`SECURITY DEFINER`, deriva el establishment de la fila real de la madre + `has_role_in` antes de cualquier INSERT, SEC-SPEC-02).

## Edge Functions

Este spec **se apoya en triggers** (`ADR-012`) y no introduce Edge Functions críticas. Las únicas dos que se proponen son utilitarias y se pueden diferir si no aparecen como necesarias durante el frontend:

1. **`bulk_edit_animals`** (opcional, owner-only) — recibe `{ establishment_id, profile_ids: uuid[], updates: {...} }`. Aplica updates en lote validando que `is_owner_of(establishment_id) = true`. Sirve para "marcar 20 animales como CUT" desde la UI. **Diferir** hasta que el flujo aparezca en frontend; el RLS de UPDATE puntual ya cubre los casos del MVP.

2. **`revert_category_override`** (utilitaria) — recibe `{ profile_id }`. Verifica permisos, llama `compute_category(profile_id)` y hace el UPDATE en una transacción. Alternativa: el cliente puede hacer un update sql directo (`update animal_profiles set category_override = false, category_id = compute_category(id) where id = ?`). **Diferir**; el cliente lo resuelve nativo.

## Cliente: contextos, hooks y navegación

### Nuevo contexto: `RodeoContext`

```typescript
type RodeoState =
  | { status: 'loading' }
  | { status: 'no_rodeos' }     // establecimiento recién creado, antes de que el owner cierre el wizard de "Crear rodeo"
  | { status: 'active', current: Rodeo, available: Rodeo[] };
```

Expone: `switchRodeo`, `createRodeo` (solo si rol owner; ver wizard descrito en R2.6), `refreshRodeos`. Scoped por el establishment activo de `EstablishmentContext`. **Importante** (refinamiento 2026-05-27): el estado `no_rodeos` es el estado inicial esperado tras la creación del establishment — ya no hay rodeo default autogenerado. El cliente debe llevar al usuario al wizard de "Crear rodeo" en ese caso (CTA prominente, posiblemente bloqueo del resto de la app hasta que el wizard se cierre exitosamente).

### Hooks de animal

Spec 02 define **solo los hooks que el modelo de datos expone** (lista, detalle, timeline, mutaciones). El hook de búsqueda interactiva + alta dinámica (`useSearchAnimal`, form CREATE/EDIT con dos puertas, selección de rodeo, form dinámico por sistema, etc.) **se mueve a spec 09 `09-buscar-animal`** — esta spec ya no lo define.

```typescript
useAnimals(filter?: { status?: AnimalStatus, rodeoId?: string, search?: string }): UseQueryResult<AnimalListItem[]>
useAnimal(profileId: string): UseQueryResult<AnimalDetail>
useAnimalTimeline(profileId: string): UseQueryResult<TimelineEvent[]>     // incluye 'observacion'
useCreateAnimal(): UseMutationResult<...>                                  // primitive — UX completa en spec 09
useUpdateAnimal(profileId: string): UseMutationResult<...>
useExitAnimal(profileId: string): UseMutationResult<...>                   // baja/egreso (R4.14): status + exit_reason enum + exit_date/weight/price. Llama RPC exit_animal_profile (rol activo + owner|autor, SEC-SPEC-01).
useRegisterBirth(): UseMutationResult<...>                                 // parto (R7.9/R9.5): 1 ternero = insert directo de reproductive_events (trigger crea ternero + birth_calves); N≥2 (mellizos) = RPC register_birth (SECURITY DEFINER, SEC-SPEC-02). El cliente NUNCA inserta birth_calves directo (SEC-SPEC-04).
useCategories(systemCode: string): Category[]
useAnimalObservations(profileId: string): { add, softDelete, edit }        // wrapper de animal_events ('observacion'|'otro')
useRodeoDataConfig(rodeoId: string): { fields: FieldDefinition[], toggle, enableNonDefault }  // catálogo + estado por rodeo (owner-only mutaciones)
useManagementGroups(): { groups: ManagementGroup[], create, rename, softDelete }              // lote (ADR-020); create/rename/softDelete owner-only
useAssignManagementGroup(profileId: string): (groupId: string | null) => Promise<void>        // asignar/quitar lote — cualquier rol operativo
```

Todos los hooks orquestan `services/animals.ts` (+ `services/observations.ts` para `animal_events`, `services/rodeo-config.ts` para la plantilla, `services/management-groups.ts` para lote) que es la única capa que toca PowerSync. La regla de capas del `architecture.md` se mantiene.

**Nota explícita**: `useSearchAnimal` **no se define en este spec**. Spec 09 lo construye consumiendo las primitives de búsqueda definidas en R5 (queries directas a `animal_profiles` por TAG / IDV / `visual_id_alt`) y el hook de mutación `useCreateAnimal` de acá.

### Lógica de categoría compartida cliente/server

Crear `app/src/services/category/transitions.ts` con la implementación TypeScript de `compute_category` espejada del SQL. Se usa para preview offline (R13.4). El módulo no se acopla a Supabase — recibe un perfil + lista de eventos como input puro y retorna el target category code. Tests unitarios cubren los caminos R7.1..R7.5.

### Navegación

Nuevas pantallas dentro de `AppStack → MainTabs` que **define este spec**:

```
MainTabs
├── Home
├── Animales              ← nuevo (tab)
│    ├── AnimalListScreen
│    └── AnimalDetailScreen  ← ficha + cronología (incluye observaciones)
└── Settings
     └── RodeosScreen      ← gestión de rodeos (owner)
```

`AnimalSearchScreen` y `AnimalCreateScreen` **no se definen acá** — pertenecen a spec 09 `09-buscar-animal` (UX de búsqueda + alta interactiva + form dinámico por rodeo + dos puertas manual/BLE). `AcceptInvitation` y `EmptyState` siguen del spec 01.

### Baja desde la ficha (C3.3 — as-built, frontend Fase 3+)

> Aterriza la UX de `R4.14`/`R14.9` (Gate 0 `context-c3.3-baja.md`, 2026-06-07). Frontend + un servicio cliente sobre el RPC **ya existente** `exit_animal_profile` (`0044`). **No** toca schema/RLS/migración. El frontend de spec 02 usa **servicios delgados** (`services/animals.ts`) en lugar de hooks react-query (los `useExitAnimal`/`useAnimal` de la sección anterior son el contrato de datos; el as-built los implementa como funciones de servicio + estado local en la pantalla, mismo patrón que C1/C2/C3.1/C3.2).

**Capa de datos** — `app/src/services/`:

- **`exitAnimalProfile(input): Promise<ServiceResult<void>>`** (`animals.ts`): llama `supabase.rpc('exit_animal_profile', { p_profile_id, p_status, p_exit_reason, p_exit_date, p_exit_weight, p_exit_price })`. `p_exit_weight`/`p_exit_price` se mandan `null` si no vinieron (el RPC los `coalesce` → no pisan valores previos). El RPC es la **barrera real de authz** (`has_role_in AND (is_owner_of OR created_by = auth.uid())`, SEC-SPEC-01); un `42501` → copy "No tenés permiso…".
- **`exit-animal.ts`** (lógica PURA, sin `./supabase` → testeable bajo `node:test`, patrón `establishment-store.ts`):
  - `EXIT_REASON_MAPPINGS` + `exitReasonToStatus(choice)` → el mapa **motivo → (status, exit_reason)**: `Venta→(sold,sale)` (captura peso+precio), `Muerte→(dead,death)`, `Transferencia→(transferred,transfer)`. MVP expone **3 motivos** (no los 6 del enum DB; `culling/theft/other` diferidos a Facundo — D1).
  - `classifyExitError(error)` → mapea `42501`/`23503`/`23514`/network/unknown a un `AppError` con copy es-AR accionable (NUNCA el `sqlerrm` crudo).
  - `validateExitWeight` / `validateExitPrice` (OPCIONALES, vacío → `null`) + `sanitizePriceInput` (sin el cap de 4 díg de `sanitizeWeightInput` — un animal se vende por 6-7 cifras).
  - `archivedBadgeLabel(status, exitDate)` → texto del badge de modo archivada ("Vendido el {fecha}"); fecha `null` → solo el verbo (nunca "null").
- **`fetchAnimalDetail`** (extendido): el SELECT + el type `AnimalDetail` agregan `created_by → createdBy`, `exit_date → exitDate`, `exit_reason → exitReason` (gating + badge de archivada).

**Capa de UI** — `app/app/animal/`:

- **`[id].tsx`** (ficha): botón **"Dar de baja"** al FONDO (terracota/outline, discreto — Fitts inverso a propósito), **gated** por `canExit = status==='active' AND (owner del campo activo del animal OR createdBy===userId)`. Conservadurismo multi-tenant: el owner-flag del contexto es del establishment **activo**; si el animal es de otro campo, se habilita solo por `createdBy` (el RPC re-valida igual). **Modo archivada** (`status≠active`): badge bajo el hero (`ArchivedBadge`) + se ocultan "Agregar evento" y "Dar de baja"; el resto read-only.
- **`baja.tsx`** (pantalla corta, registrada en `_layout.tsx` bajo el top-segment `animal` ya permitido): paso 1 = elegir motivo (3 cards grandes ≥`$touchMin`); paso 2 = fecha (default hoy) + (solo Venta) peso/precio opcionales + resumen del animal + aviso de irreversibilidad + botón destructivo. `busyRef` anti doble-tap; online-only (sin red → error, no marca la baja). Post-éxito → `backOr` a la ficha, que recarga por `useFocusEffect` y pasa a modo archivada in-situ (el animal sale de la tab Animales por el filtro `status='active'`).

**Tests**: `exit-animal.test.ts` (25 unit: mapeo, `classifyExitError`, validadores opcionales, `sanitizePriceInput`, `archivedBadgeLabel`) + e2e `animals.spec.ts` (owner da de baja Venta → desaparece de Animales + ficha "Vendido" + visible bajo filtro Vendidos).

## PowerSync

### Buckets nuevos

Heredando los buckets de spec 01 (`user_self`, `est_membership`, `est_data`, `est_members`, `est_invitations`), agregamos:

- `est_rodeos`: filas de `rodeos` cuyo `establishment_id` está en el set del usuario.
- `est_rodeo_data_config`: filas de `rodeo_data_config` cuyo `rodeo_id` cae en `est_rodeos`. Necesario para que el wizard de creación de rodeo, la pantalla de gestión y el gating de maniobras (spec 03) funcionen offline.
- `est_management_groups`: filas de `management_groups` cuyo `establishment_id` está en el set del usuario. Necesario para que la asignación de lote funcione offline (R13.2).
- `est_animal_profiles`: filas de `animal_profiles` por establishment (incluye `management_group_id`).
- `est_animals_local`: filas de `animals` con `id` en el set de `animal_profiles.animal_id` del establishment. (No es global; cada cliente solo sincroniza los animales presentes en sus establishments.)
- `est_weight_events`, `est_reproductive_events`, `est_sanitary_events`, `est_condition_score_events`, `est_lab_samples`: filas cuyo `animal_profile_id` cae en `est_animal_profiles`.
- `est_birth_calves` (sesión 17, mellizos R7.9): filas de `birth_calves` cuyo `birth_event_id` cae en `est_reproductive_events`. Necesario para que la relación madre→N terneros del parto esté disponible offline.
- `est_animal_events`: filas de `animal_events` cuyo `establishment_id` está en el set del usuario (filtrado por la columna denormalizada — no requiere join). Modelo Híbrido (refinamiento 2026-05-26).
- `est_animal_category_history`: idem.
- `est_semen_registry`: por establishment.
- `config_global`: filas de `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields` (todas las activas). TTL 24 hs en cliente. Necesario para que el wizard de creación de rodeo pueda renderizar los toggles (catálogo global + defaults del sistema) offline.

### Estrategia de conflictos

`last-write-wins` por default. Excepción:
- **Eventos** (`*_events`, `lab_samples`): no se "actualizan", se borran (soft-delete) y se vuelven a crear. Si dos clientes editan el mismo evento (poco común), gana el más reciente.
- **`animal_profiles.category_id`**: gana el server por revalidación de trigger en sync (R13.4). El cliente muestra el resultado del server después de cada sync.

### Cola de sync local

PowerSync maneja la cola por default. Para casos extremos (constraints DB que fallan offline porque el cliente no vio el estado actual), el cliente captura el error de sync y muestra una alerta accionable al usuario ("este IDV ya existe en tu campo; revisá").

## Búsqueda (primitives de R5 consumidas por spec 09)

> El hook `useSearchAnimal` y la pantalla `AnimalSearchScreen` **se definen en spec 09** (refinamiento 2026-05-26). Esta sección documenta solo las **primitives de búsqueda a nivel datos** que spec 09 consume.

Orden canónico (R5):

1. TAG (match exacto contra `animals.tag_electronic` filtrado por presencia de perfil en el establishment activo).
2. IDV (match exacto contra `animal_profiles.idv` filtrado por establishment).
3. `visual_id_alt` fuzzy: `select * from animal_profiles where visual_id_alt % :query and establishment_id = :est and deleted_at is null order by similarity(visual_id_alt, :query) desc limit 20`.

Caso especial cubierto a nivel datos: si el TAG existe globalmente pero no hay perfil activo en el establishment, la query retorna el `animal_id` del global sin perfil local. La UX de "Dar de alta en este campo" (crear nuevo `animal_profile` para ese animal global) la decide y orquesta spec 09.

## Cliente: validaciones locales

`app/src/services/animal/validation.ts`:

- `validateIdentity({ tag, idv, visualAlt })`: retorna error si todos vacíos (R13.3).
- `validateProfileForm(form, rodeoSystemCode)`: chequea coherencia (categoría override válida para sistema, etc.).
- `previewCategory(form, events)`: invoca `transitions.ts` para mostrar la categoría calculada en la UI antes de guardar.

## Motor de form dinámico por rodeo (consumido por spec 09 y spec 03)

Dos consumos distintos del modelo de datos por rodeo:

1. **Spec 09 — form de alta de animal**: renderiza campos según el `system_id` del rodeo seleccionado. Las **categorías disponibles** por sistema viven en `categories_by_system` (seedeada por T1.4). Spec 09 lee esa tabla para popular el dropdown de categoría sugerida + override (R4.7, R4.8). En MVP los campos del form son **los mismos para todos los sistemas activos** (solo `(bovino, cria)` está activo, así que la pregunta es trivial). Las columnas de `animal_profiles` cubren el superset razonable (`breed`, `coat_color`, `birth_weight`, `entry_*`, etc.).

2. **Spec 03 — gating de maniobras**: una maniobra tiene un set de `data_keys` requeridos (mapeo hardcodeado, ADR-021). Por ejemplo, **tacto** requiere `prenez` y `tamano_prenez` con `enabled = true` en el `rodeo_data_config` del rodeo destino. Una query de la forma `SELECT count(*) FROM rodeo_data_config rdc JOIN field_definitions fd ON fd.id = rdc.field_definition_id WHERE rdc.rodeo_id = ? AND fd.data_key = ANY($1) AND rdc.enabled = true` resuelve el gating en O(log n) con el index `(field_definition_id) WHERE enabled = true`. La UI del wizard de maniobras lee `rodeo_data_config` para deshabilitar/explicar las maniobras incompatibles con el rodeo elegido (capa UI); la capa DB rechaza persistir el evento gateado. Ambas capas en spec 03.

3. **Wizard de creación de rodeo (spec 02)**: el cliente lee `field_definitions` (catálogo global) join `system_default_fields` filtrando por el `system_id` elegido, renderiza una lista de toggles con su `default_enabled`, y al confirmar hace INSERT en `rodeos` + UPDATEs sobre `rodeo_data_config` (las filas ya existen porque el trigger AFTER INSERT las pre-pobló). Si el usuario quiere habilitar un dato que no es default del sistema, el cliente hace un INSERT en `rodeo_data_config` (permitido al owner, R2.12).

- **Por qué tres tablas tipadas y no JSONB ni catálogo-por-sistema**: data analytics es pilar del producto. Queries como "¿qué rodeos tracquean preñez?" o "promedio de tasa de preñez por sistema" salen naturales con tablas tipadas; con JSONB requieren `custom_config->>...::boolean` + GIN y son frágiles. El catálogo-por-sistema (modelo viejo) impedía reusar un dato entre sistemas (bug "tambo + preñez"); el catálogo **global** (`field_definitions`) lo resuelve.
- **Evolución post-MVP**: cuando se habilite un segundo sistema (`invernada`, `feedlot`, `tambo`, `cabana`), basta sumar filas a `field_definitions` (datos nuevos) y `system_default_fields` (sus defaults), cero código. Una tabla auxiliar para parametrizar **qué columnas de `animal_profiles`** mostrar por sistema (distinto de los data_keys tracqueables) queda diferida hasta tener ≥2 sistemas activos.
- **No-objetivo de este spec**: spec 02 **no implementa** la pantalla del wizard de maniobras ni el form de alta de animal. Solo expone la fuente de configuración (`categories_by_system`, `field_definitions`, `system_default_fields`, `rodeo_data_config`) y el sustrato para el gating.

## Alternativas descartadas

### 1. Categorías hardcoded en enum SQL

**Pros**: schema más compacto, menos joins.
**Contras**:
- Cada nuevo sistema/especie requiere migration con `ALTER TYPE` (no se puede borrar valor de un enum sin recrear la tabla).
- Imposible activar/desactivar categorías o renombrarlas sin migration.
- Para multi-especie / multi-sistema el enum se hincha y mezcla dominios.
**Razón**: el contexto del producto explícitamente prepara multi-especie/multi-sistema (`CONTEXT/04`, `CONTEXT/08`). Tablas de configuración son la forma estándar.

### 2. Categoría como vista derivada (sin almacenarla)

**Pros**: nunca se desincroniza con los eventos.
**Contras**:
- Imposible hacer override manual (categoría sería función pura de eventos).
- `ADR-008` rechaza explícitamente esta opción por el caso real del campo (compra de animal sin historial cargado, decisiones del operador, etc.).
**Razón**: el override manual es un requisito explícito del producto.

### 3. Edge Function `create_animal` orquestadora en lugar de RLS + triggers

**Pros**:
- Validaciones complejas en un solo lugar TypeScript.
- Service role bypassa RLS internamente.
**Contras**:
- Más infraestructura para mantener.
- Pierde la "una roundtrip" — el cliente offline tendría que diferir el alta hasta tener red.
- `ADR-012` ya estableció el patrón: preferir trigger Postgres + RLS para escrituras simples.
**Razón**: el caso de alta de animal es perfectamente expresable con RLS + triggers (validación de identidad, default de categoría, ternero al pie). Edge Function no aporta.

### 4. Ternero como sub-registro de la madre (sin tabla independiente)

**Pros**:
- Modelo más simple a primera vista.
**Contras**:
- El ternero necesita su propia cronología de eventos (peso, sanidad).
- Por ley SENASA tiene que tener TAG propio dentro de la semana → es un animal con identidad.
- El acceptance criteria 3 explícitamente pide "entidad independiente".
**Razón**: dejar el ternero como `animals + animal_profiles` propio es lo único que cierra el caso de uso real.

### 5. Almacenar timeline como tabla materializada en lugar de UNION ALL

**Pros**:
- Lecturas más rápidas.
- Sync más simple en PowerSync (un solo bucket por timeline).
**Contras**:
- Triggers sobre cada tabla de eventos para mantener la materialización en sync — fragil.
- Duplicación de datos.
- Reescritura en cada cambio de schema de eventos.
**Razón**: la función `animal_timeline` con `UNION ALL` es suficiente para los volúmenes del MVP (un campo bovino típico: 100-2000 animales, 5-20 eventos por año por animal). Si en producción se vuelve lenta, materializamos como optimización después.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Trigger de transición pisa override por bug de GUC | Tests específicos: insertar tacto positivo sobre vaquillona con override → categoría NO cambia. |
| Trigger BEFORE INSERT de ternero rompe la transacción del parto si falla | Tests: parto con `calf_tag_electronic` duplicado rollbackea el evento. |
| Constraint de identificación rechaza el alta de ternero sin TAG ni IDV | Fallback `visual_id_alt = 'recién nacido — pendiente de caravana'` aplicado por el mismo trigger. Tests cubren caso. |
| Cliente preview de categoría diverge del server | Módulo TypeScript compartido + tests unitarios. Gana el server al sync. |
| RLS de eventos genera N joins lentos | Helper `establishment_of_profile` es stable + index `animal_profiles_by_animal`. Plan ejecutivo: monitorear con `EXPLAIN ANALYZE` en QA. |
| Búsqueda fuzzy de `visual_id_alt` lenta | Índice GIN trigram + límite a 20 resultados. |
| Sync de tablas de configuración con TTL stale | Forzar refresh al detectar cambio de schema vía version-stamp en `species` (a futuro). En MVP, refresh al primer login del día. |
| Migration 0031 (ternero) muy compleja para revisar | Dividir en archivos: 0030 transitions, 0031 calf creation, 0032 timeline — cada uno auditable independientemente. |
| Owner deshabilita en un rodeo un data_key que ya tiene eventos cargados | El cliente debe avisar antes de destildar ("este dato tiene N eventos cargados"); no se borran datos históricos (R2.12.1). El `animal_timeline` no filtra por `enabled`/`active`, así que el historial sigue visible. Validación de UX en spec 03/cliente. |
| Soft-delete de un lote con animales asignados | El cliente reasigna esos animales a `NULL` antes del soft-delete (o la capa de servicio lo hace); el FK no cascadea el soft-delete. |
| Mellizos marcan mal a la madre como multípara (sesión 17) | Modelo uno-a-muchos (`birth_calves`): un parto = un evento `birth` con N terneros; `compute_category` cuenta **eventos** `birth`, no terneros (R7.9). Tests: parto con 2 terneros deja la madre con +1 parto, no +2. |
| Baja de animal confundida con soft-delete (sesión 17) | `exit_animal_profile` cambia `status` con `deleted_at` intacto (NULL); el perfil queda archivado y visible (R4.14/R4.12). Tests: animal dado de baja sigue apareciendo en su ficha y en `R14.7`/`R5.8`. |
| Dar de baja una madre/toro rompe la navegación a su ficha (sesión 17) | Nunca hard-delete de un perfil referenciado como `calf_id`/`bull_id`; las fichas toleran `status ≠ active` (R4.15). Tests: ternero con madre vendida navega a la ficha de la madre sin crash. |
| Editar/borrar un tacto viejo deja la categoría desactualizada (sesión 17) | Trigger de recálculo `tg_reproductive_events_recompute_on_change` invoca `compute_category` si no hay override (R6.14). Tests: borrar el tacto que disparó la preñez revierte la categoría. |
| Escanear un TAG ya usado da error opaco (sesión 17) | La búsqueda por TAG retorna el animal dueño + `status`/`exit_date` para que spec 09 arme el copy accionable, incluso si está dado de baja (R5.6). |

## Dependencias del spec

- Spec 01 done (Fase 1+2 backend). ✅ ya cumplido.
- `pg_trgm` extension habilitada en Supabase (estándar en Postgres 14+ remoto). Verificar en T1.1.
- `auth.uid()` disponible en sesiones autenticadas — ya validado por spec 01.

## Notas para el implementer (referencia rápida)

- Cada migration nueva sigue el patrón `enable RLS + GRANT + policies` del `design.md` de spec 01.
- Tests Node nativo en `supabase/tests/rls/` y `supabase/tests/edge/` (cuando aplique). Patrón establecido en spec 01.
- Patrón **split insert + select** sigue vigente (`ADR-012`): los inserts en `animal_profiles` y eventos que disparan triggers de transición se hacen sin `.select()` + un select separado para obtener el estado final.
- Commits en español, presente, descriptivo.

Ver `tasks.md` para el plan de ejecución paso a paso.

## Changelog

> Audit trail del design. No se borra (mismo principio que los ADRs). Orden cronológico inverso.

- **2026-06-29 — Reconciliación in-place Nivel A (FIX #12, ADR-028) — orden del selector de DIENTES del alta**. El selector cerrado de dientes del alta (`fieldsForCategory`/form dinámico) consume `TEETH_OPTIONS` de `app/src/utils/animal-category-fields.ts` (array PARALELO al de la maniobra). Raf pidió invertir el orden de presentación a **gastada→joven** (`sin_dientes, 1/4, 1/2, 3/4, boca_llena, 6d, 4d, 2d`). Solo presentación: el enum `teeth_state_enum`, `isValidTeethState` y la validación no cambian. Queda alineado con el array de la maniobra (`teeth-options.ts`, spec 03 §6.bis.3) → alta y maniobra muestran la lista igual. Test order-oracle agregado en `animal-category-fields.test.ts`.
- **2026-05-30 (sesión 20) — Fold del Tier 1 del bloque backend (delta s17/s18) a design firme, migrations 0043+**. El backend de spec 02 está `done` (0013-0042); este bloque reabre un incremento. Se **promueven a diseño firme** (con números de migration concretos 0043+) los 5 ítems del Tier 1 que la sesión 17 había dejado como "propuesta de diseño". El SQL queda como **especificación firme**; el implementer escribe los `.sql` + tests. Cambios en `design.md`:
  - **Nueva sección "Fold del Tier 1"** con mapa de migrations: `0043` (`created_by`) · `0044` (`exit_reason` enum + RPC baja) · `0045` (`birth_calves`) · `0046` (recálculo de categoría) · `0047` (cambio de rodeo mismo-sistema). Bloque explícito de "FUERA del Tier 1" (Tier 2/Tier 3 DEFERIDO + transferencia = feature 11).
  - **Item 1 — `created_by` (`0043`)**: firme que la columna **falta** en el as-built; se agrega FK nullable a `users(id)` + trigger BEFORE INSERT que **fuerza** `created_by = auth.uid()` server-side (`tg_force_created_by_auth_uid`, ver Endurecimiento Gate 1 / SEC-SPEC-03 abajo — la columna es load-bearing para authz, no se usa el helper "solo si NULL"). Nota de orden: `0043` antes que `0044` (el RPC de baja lee `created_by`).
  - **Item 2 — `exit_reason` enum (`0044`)**: el bloque texto→enum pasa de "propuesta" a migration firme `0044`, con **backfill defensivo** (cualquier texto fuera del enum → `'other'`, vacío → `NULL`) antes del `ALTER`. El RPC `exit_animal_profile` queda en la misma migration; la nota "requiere `created_by`" se actualiza a dependencia firme de `0043`.
  - **Item 3 — mellizos `birth_calves` (`0045`)**: tabla puente firme con **RLS** (establishment derivado de la madre vía `establishment_of_profile`). `select`-only para el cliente, poblada **solo** server-side (ver Endurecimiento Gate 1 / SEC-SPEC-04). Creación N terneros: trigger mono-ternero `0031` extendido para poblar `birth_calves` (caso 1) + RPC firme `register_birth` `SECURITY DEFINER` (caso mellizos, ≥2; ver SEC-SPEC-02); el trigger de transición de la madre se dispara una vez por evento `birth`. `compute_category` cuenta **eventos `birth` distintos**, no terneros (ya estaba en el comentario del SQL; queda firme). `calf_id` se conserva apuntando al primer ternero por compat.
  - **Item 4 — recálculo de categoría (`0046`)**: el trigger `tg_reproductive_events_recompute_on_change` pasa a firme con sus dos `create trigger` (AFTER UPDATE OF `event_type,pregnancy_status,deleted_at` + AFTER DELETE), solo sobre `reproductive_events` (única tipada que dispara transiciones). Recomputa vía `compute_category`/`apply_auto_transition` si `category_override = false`; registra en `animal_category_history`.
  - **Item 5 — cambio de rodeo mismo-sistema (`0047`, NUEVO)**: nueva subsección "Cambio de rodeo dentro del mismo sistema" — trigger `tg_animal_profiles_rodeo_same_system_check` (`SECURITY DEFINER`, BEFORE UPDATE OF `rodeo_id`) que exige `system_id` destino == origen, rechazando el cruce de sistemas (`R4.6`). Reemplaza el bloqueo total de la `R4.5.1` original de sesión 17.
  - **DEFERIDO**: **Tier 2** (ramas `weaning`/`abortion`, targets pendientes de Facundo) marcado con nota explícita en "Transiciones automáticas"; **Tier 3** (razas SENASA + `castracion`) marcado en el bloque "FUERA del Tier 1". `breed` sigue texto libre; no se agrega `castracion`.
  - **Nota de alcance global** del header actualizada para distinguir los bloques s17 ya promovidos a firme (Tier 1) de lo que sigue DEFERIDO.
  - **Endurecimiento Gate 1 (FAIL → fix)**: el Gate 1 (security_analyzer modo `spec`) sobre el delta Tier 1 dio **FAIL** con 2 HIGH + 2 MEDIUM (reporte: `progress/security_spec_02-modelo-animal.md`). Los 4 findings se cerraron a nivel design **sin** escribir migrations (las escribe el implementer). Sin renumerar requirements:
    - **SEC-SPEC-01 (HIGH) — `exit_animal_profile` (`0044`)**: la guarda de autorización pasa de `is_owner_of OR created_by = auth.uid()` a `has_role_in(v_est) AND (is_owner_of OR created_by = auth.uid())`. El `has_role_in` obligatorio impide que un autor cuyo rol fue desactivado (`user_roles.active = false`) dé de baja un animal de un campo del que ya no forma parte (misma clase que SEC-HIGH-01). Mismo patrón as-built que `soft_delete_animal_event` (`0041`).
    - **SEC-SPEC-02 (HIGH) — RPC multi-ternero (`0045`)**: el RPC de mellizos pasó de **prosa** ("lo define el implementer") a **SQL firme** (`register_birth`): firma tipada `(uuid, date, jsonb)`, `set search_path = public`, `revoke execute ... from public, anon` + `grant execute ... to authenticated`, autorización vía `has_role_in(v_est)` con `v_est` **derivado de la fila real de la madre** (nunca de un `establishment_id` del payload), `has_role_in` **antes** de cualquier INSERT, y transacción atómica con rollback total si falla cualquier ternero (`R9.4`/`R9.5`). Reconciliación firme: el trigger mono-ternero `0031` maneja el caso 1; `register_birth` maneja N≥2.
    - **SEC-SPEC-03 (MEDIUM) — `created_by` (`0043`)**: como `created_by` es ahora load-bearing para authz (`R4.14`), el trigger pasa de reusar `tg_set_created_by_auth_uid` ("setea solo si NULL", spoofeable en el INSERT) a `tg_force_created_by_auth_uid`, que **siempre** sobreescribe `new.created_by := auth.uid()` ignorando el valor del cliente.
    - **SEC-SPEC-04 (MEDIUM) — `birth_calves` (`0045`)**: (a) `and re.deleted_at is null` agregado a la policy de SELECT (las filas dejan de ser visibles tras soft-delete del parto, consistente con `R12.3`); (b) **se quitó `insert` del grant** a `authenticated` — la tabla se puebla **solo** desde el flujo de parto `SECURITY DEFINER` (trigger mono + `register_birth`). El cliente conserva `select`. Cierra el INSERT directo que permitía fabricar parentescos falsos y el cruce de tenant del ternero.
    - **Tests de no-bypass** declarados en `tasks.md` (T2.19): `exit_animal_profile` con autor-sin-rol (espejo de T2.18), `register_birth` cross-tenant, INSERT directo a `birth_calves` (debe fallar sin grant), y L2 (alta del ternero al pie no bloqueada por `rodeo_same_system_check` ni por el category check as-built).

- **2026-05-29 (sesión 17) — Refinamiento de edge cases (Gate 0 retroactivo)**. Documenta el **cambio conceptual** de las decisiones de Raf de sesión 17; el SQL/migrations los escribe el implementer (los bloques nuevos marcados "(sesión 17 — propuesta de diseño)" son orientativos, no as-built). Cambios en `design.md`:
  - **Baja / egreso de animal** (`R4.14`/`R4.15`): nueva subsección — `exit_reason` pasa a enum (`sale|death|transfer|culling|theft|other`); baja vía RPC `exit_animal_profile` (`SECURITY DEFINER`, re-valida `is_owner_of OR created_by = auth.uid()`, no UPDATE de cliente, mismo patrón que las RPCs de soft-delete); no es soft-delete (`deleted_at` intacto). Requiere `created_by` en `animal_profiles` (verificar/agregar contra as-built).
  - **Mellizos / N terneros por parto** (`R7.9`/`R9.5`): reescrita la sección "Ternero al pie" — modelo uno-a-muchos con tabla puente `birth_calves(birth_event_id, calf_profile_id)`; el conteo de partos en `compute_category` cuenta **eventos** `birth`, no terneros (comentario actualizado en el SQL); el trigger mono-ternero queda como referencia del caso común. Añadidos bucket `est_birth_calves`, fila en la tabla RLS, hook `useRegisterBirth`.
  - **Transiciones por edad no automáticas** (`R7.8`/`R4.7.1`): nota explícita de que no hay cron; rama propuesta de `weaning` en el trigger de transición; default para `birth_date IS NULL` (adulto por sexo) documentado y notado que **coincide con el comportamiento actual** de `compute_category`.
  - **Recálculo de categoría al corregir eventos** (`R6.14`): nueva subsección con trigger propuesto `tg_reproductive_events_recompute_on_change` (recomputa vía `compute_category`/`apply_auto_transition` si no hay override); aclaración de que la edición/borrado de los 5 tipados es **sin ventana de tiempo** (las policies de UPDATE ya lo permiten; la ventana de 15 min es solo de `animal_events`) — corrige la lectura de spec 09 R5.5.
  - **TAG no reusable + error accionable** (`R5.6`/`R4.13.b`): nota en la sección de inmutabilidad — el unique parcial libera el TAG al soft-deletear; la búsqueda por TAG retorna el animal dueño + `status`/`exit_date` para el copy de spec 09.
  - **Timeline siempre muestra historial** (`R2.12.1`): notas en la plantilla de datos y en la cronología v2 — `animal_timeline` no filtra por `enabled`/`active`; aviso al owner al destildar un dato con eventos (cliente). Acotación de `R2.11` (activar un sistema nuevo exige seedear sus `system_default_fields`).
  - **Hooks de cliente**: `useExitAnimal`, `useRegisterBirth`. **Riesgos**: 5 filas nuevas (mellizos, baja vs soft-delete, baja de madre/toro, recálculo al corregir, TAG ya usado).
  - **Criterios de diseño propios (a validar por Raf/Facundo)**: tabla puente `birth_calves` (vs múltiples eventos `birth`); conservar `reproductive_events.calf_id` apuntando al primer ternero por compat; mapeo `weaning`→categoría (`ternera→vaquillona`, `ternero→torito`); RPC para la baja en vez de UPDATE de cliente.

- **2026-05-28 (sesión 15) — As-built de la implementación Fase 1+2 (backend)**. Lo siguiente refleja el código realmente aplicado y **prevalece sobre las descripciones inline previas donde difieran**. Detalle en `progress/impl_02-modelo-animal.md` y `progress/review_02-modelo-animal.md`.
  - **Soft-delete vía RPC, no UPDATE de cliente** (migration `0041_soft_delete_rpcs.sql`): el soft-delete se hace con funciones `SECURITY DEFINER` `soft_delete_rodeo` / `soft_delete_management_group` / `soft_delete_animal_event` / `soft_delete_event(kind,id)`, **no** con un `UPDATE deleted_at` desde el cliente. Motivo: PostgREST rechaza (42501) el `UPDATE deleted_at` cuando la policy SELECT filtra `deleted_at is null` sobre la propia fila (exige que la fila post-update siga visible). Relajar la SELECT rompería R12.3. Cada RPC re-valida la MISMA autorización que la policy de UPDATE (`is_owner_of`/`has_role_in`, derivando el establishment de la fila real) y preserva R12.3. **Impacto en Fase 5 (PowerSync)**: la estrategia offline de borrado debe usar estas RPCs, no un write local de `deleted_at` — anotado en `CONTEXT/07-pendientes.md`.
  - **Triggers `SECURITY DEFINER` no previstos en el diseño original**: `tg_animal_profiles_identity_check` (migration `0039`) pasó a `SECURITY DEFINER` porque una fila recién insertada en `animals` es RLS-invisible hasta que existe su `animal_profile` (patrón split insert+select), así que el check corría con la RLS del usuario y veía NULL → rechazaba mal el alta TAG-only. Lee solo el animal del propio insert, no retorna nada, no es RPC. `tg_animal_profiles_record_category_change` (`0030`) también corre `SECURITY DEFINER`. Ambos con `search_path = public`.
  - **Fix de revert de override** (migration `0040`): `tg_animal_profiles_set_override_on_manual` ahora respeta un revert explícito (`category_override` de true→false): no re-marca override y deja que el historial grabe `revert_to_auto` (R4.10/R7.6).
  - **`apply_auto_transition` cerrada como superficie RPC** (migration `0042_revoke_internal_function_grants.sql`): es helper INTERNO del trigger de transición (R7.7), `SECURITY DEFINER` sin authz propia. Por default quedaba `EXECUTE TO PUBLIC` → invocable como RPC de PostgREST → escritura de categoría cross-tenant (Gate 2 `SEC-HIGH-01`). Se revocó `execute` a `public/authenticated/anon`; el trigger (también `SECURITY DEFINER`, corre como owner) la sigue invocando. Test de regresión `T2.18`. **Principio**: toda función `SECURITY DEFINER` pensada como helper interno debe revocar `EXECUTE` del cliente.
  - **Renumber +1 de migrations**: el spec asumía `0012..0037`, pero `0012` ya estaba ocupado por spec 01 → el as-built es `0013..0042`. Tabla de mapeo lógico→archivo en `progress/impl_02-modelo-animal.md`.
  - **Seed de 26 fields de cría**: sigue TENTATIVO hasta validar con Facundo (R2.13).

- **2026-05-28 — Refundición consolidada (ADR-020 lote + ADR-021 plantilla de datos)**:
  - **Plantilla de datos (ADR-021)**: se reemplazó el contenido de la migration `0016` (antes `system_data_templates` catálogo *por sistema*, con bug "no reusa datos entre sistemas") por las **tres tablas** `field_definitions` (catálogo global) + `system_default_fields` (defaults por sistema) + `rodeo_data_config` (toggle por rodeo, FK a `field_definitions`), todo en `0016`. Seed de 26 fields de cría (TENTATIVO). Trigger `tg_rodeos_seed_data_config` ahora pre-popula desde `system_default_fields`. Se eliminó el trigger de validación contra el sistema (el FK al catálogo global + la intención de permitir fields no-default lo hacen innecesario). RLS de `rodeo_data_config` ahora permite INSERT al owner (habilitar field no-default — caso "tambo + preñez").
  - **Lote (ADR-020)**: nueva migration `0036_management_groups.sql` — tabla `management_groups` (scope establishment) + `ALTER animal_profiles ADD management_group_id` + trigger de validación mismo-establishment + RLS (crear/editar/borrar solo owner; asignar animal = UPDATE de `animal_profiles` por cualquier rol operativo). `check_grants` movido a `0037`.
  - **Ortogonalidad (R7.7)**: nota explícita de que los triggers de transición de categoría solo tocan `category_id`, nunca `rodeo_id` ni `management_group_id`.
  - **Transversal**: regla maestra de 3 ejes agregada a Arquitectura; tabla RLS, buckets PowerSync (`est_management_groups`, `config_global` con catálogo de fields) y "Motor de form dinámico" actualizados al modelo de catálogo global. Header + historial movido a este Changelog. Diagrama de migrations `0012..0037`.
  - **Preservado**: todo el SQL de animals/profiles/eventos/transiciones/ternero/timeline/inmutabilidad/animal_events se mantuvo con su numeración original (`0017`–`0035`).
- **2026-05-27 — Plantilla por sistema + sin rodeo default** *(superada por la refundición 2026-05-28)*. Introdujo `system_data_templates` + `rodeo_data_config` como catálogo por-sistema (modelo con bug, reemplazado por ADR-021) y eliminó el trigger de rodeo default.
- **2026-05-26 — Refinamiento previo a aprobación**. Agregada `animal_events` (modelo Híbrido, migration de la época `0033`) + `animal_timeline_v2` con séptimo origen `observacion` + triggers de inmutabilidad de `tag_electronic`/`idv` (R4.13). Eliminadas referencias al flujo R15 (movido a spec 09). Agregada sección "Motor de form dinámico por rodeo".
