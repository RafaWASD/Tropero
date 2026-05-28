-- 0018_field_template_and_rodeo_config.sql  (spec 02 lógico: 0016)
-- Plantilla de datos: catálogo global + defaults por sistema + toggle por rodeo (ADR-021).
-- Tres tablas en una unidad lógica. El seed de cría es TENTATIVO (validar con Facundo).
-- Cubre R2.6 (sin trigger de auto-creación de rodeo), R2.8..R2.13.

-- 1) Catálogo GLOBAL de datos tracqueables -----------------------------------
create table public.field_definitions (
  id              uuid primary key default gen_random_uuid(),
  data_key        text not null unique,        -- clave estable GLOBAL: 'prenez', 'peso', ...
  label           text not null,
  description     text,
  category        text not null,               -- reproductivo|productivo|sanitario|manejo|comercial|identificacion
  data_type       text not null,               -- maniobra|evento_individual|evento_grupal|propiedad
  ui_component    text,                         -- numeric|numeric_stepped|enum_single|enum_multi|date|silent_apply|composite|text
  config_schema   jsonb,
  schema_version  int not null default 1,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.field_definitions is
  'Catálogo GLOBAL de datos tracqueables (ADR-021). Cada dato existe una sola vez. Read-only desde cliente.';

create index field_definitions_by_category on public.field_definitions (category) where active = true;

-- Seed TENTATIVO de cría: 26 fields. default_enabled vive en system_default_fields.
insert into public.field_definitions (data_key, label, description, category, data_type, ui_component) values
  -- Reproductivo
  ('servicio',                'Servicio / entore',        'Registro de monta natural o IA',             'reproductivo', 'evento_individual', 'composite'),
  ('prenez',                  'Preñez',                   'Tacto: preñada / vacía',                     'reproductivo', 'maniobra',          'enum_single'),
  ('tamano_prenez',           'Tamaño de preñez',         'Cabeza / cuerpo / cola del tacto positivo',  'reproductivo', 'maniobra',          'enum_single'),
  ('tacto_vaquillona',        'Aptitud vaquillona',       'Apta / no apta / diferida',                  'reproductivo', 'maniobra',          'enum_single'),
  ('parto',                   'Parto',                    'Registro de parto + ternero al pie',         'reproductivo', 'evento_individual', 'composite'),
  ('aborto',                  'Aborto',                   'Registro de aborto',                         'reproductivo', 'evento_individual', 'date'),
  ('destete',                 'Destete',                  'Destete del ternero (usa pesaje)',           'reproductivo', 'evento_individual', 'composite'),
  ('raspado_toros',           'Raspado de toros',         'Tricomoniasis + campylobacteriosis',         'reproductivo', 'maniobra',          'composite'),
  ('inseminacion',            'Inseminación artificial',  'IATF / IA con pajuela',                      'reproductivo', 'maniobra',          'composite'),
  -- Productivo
  ('peso',                    'Pesaje',                   'Peso vivo en balanza o manual',              'productivo',   'maniobra',          'numeric'),
  ('peso_destete',            'Peso al destete',          'Peso del ternero al destete',                'productivo',   'evento_individual', 'numeric'),
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
grant all on public.field_definitions to service_role;

create trigger field_definitions_set_updated_at
  before update on public.field_definitions
  for each row execute function public.tg_set_updated_at_generic();

-- 2) Defaults / required POR SISTEMA (la "plantilla") ------------------------
create table public.system_default_fields (
  id                  uuid primary key default gen_random_uuid(),
  system_id           uuid not null references public.systems_by_species(id),
  field_definition_id uuid not null references public.field_definitions(id),
  default_enabled     boolean not null default true,
  required_for_system boolean not null default false,
  sort_order          int not null default 0,
  unique (system_id, field_definition_id)
);

comment on table public.system_default_fields is
  'Defaults/required por sistema (la plantilla). Read-only desde cliente (ADR-021).';

create index system_default_fields_by_system on public.system_default_fields (system_id, sort_order);

-- Seed de cría: las 26 filas; 3 con default_enabled = false.
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
-- En cría MVP ningún field es required (la identificación es el único requisito real, R4.2).

alter table public.system_default_fields enable row level security;
create policy system_default_fields_select on public.system_default_fields
  for select to authenticated using (true);
grant select on public.system_default_fields to authenticated;
grant all on public.system_default_fields to service_role;

-- 3) Estado efectivo POR RODEO (toggle del owner) ---------------------------
create table public.rodeo_data_config (
  rodeo_id            uuid not null references public.rodeos(id) on delete cascade,
  field_definition_id uuid not null references public.field_definitions(id),
  enabled             boolean not null,
  custom_config       jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (rodeo_id, field_definition_id)
);

comment on table public.rodeo_data_config is
  'Estado efectivo por rodeo. FK a field_definitions (catálogo global) — no se valida contra el sistema, justamente para permitir habilitar un dato no-default (caso tambo + preñez). Sin deleted_at: el toggle vive en enabled.';

create index rodeo_data_config_by_rodeo
  on public.rodeo_data_config (rodeo_id) where enabled = true;
create index rodeo_data_config_by_field
  on public.rodeo_data_config (field_definition_id) where enabled = true;

create trigger rodeo_data_config_set_updated_at
  before update on public.rodeo_data_config
  for each row execute function public.tg_set_updated_at_generic();

-- R2.11: trigger AFTER INSERT en rodeos pre-pobla rodeo_data_config con los
-- system_default_fields del sistema (garantiza que un rodeo nuevo nunca queda vacío).
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
-- No policy DELETE: deshabilitar = enabled=false; borrado real solo por CASCADE.

grant select, insert, update on public.rodeo_data_config to authenticated;
grant all on public.rodeo_data_config to service_role;

notify pgrst, 'reload schema';
