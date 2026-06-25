-- 0107_breed_catalog.sql  (spec 08 — export SIGSA, T1 / R1.1, R1.2, R1.3)
-- Catálogo controlado de razas con los códigos SENASA oficiales (manual SIGSA v2.42.80,
-- Tabla 1 de specs/active/08-export-sigsa/razas-senasa-codigos.md). Es el universo del
-- BreedPicker (UI diferida) y la fuente del código RAZA que va en el TXT de declaración de
-- dispositivos (R5.2/R6.5). Lista CERRADA: SIGSA valida contra estos códigos exactos → grafías
-- LITERALES del manual (ej. 'Bosmara' por 'Bonsmara', 'S/E' con la barra).
--
-- Read-only para el cliente: SELECT abierto a authenticated, sin INSERT/UPDATE/DELETE (las
-- modificaciones se hacen vía migración). Mismo patrón que los catálogos globales species /
-- categories_by_system (spec 02), que el sync de PowerSync trata como bucket global.
--
-- Cross-check del seed (verificado por el implementer, 2026-06-24): los 32 códigos↔nombre son
-- 1:1 con app/src/utils/import/breed-senasa.ts (la capa pura, T9/T10, ya sembrada) y con
-- razas-senasa-codigos.md (Tabla 1). 28 bovinas + S/E (generic) + 3 bubalinas (active=false).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + el seed con ON CONFLICT (senasa_code) DO NOTHING
-- (senasa_code es UNIQUE) → re-correr la migración no duplica filas ni rompe.

create table if not exists public.breed_catalog (
  id          uuid        primary key default gen_random_uuid(),
  senasa_code text        not null unique,
  name        text        not null,
  species     text        not null default 'bovine',  -- 'bovine' | 'bubaline' | 'generic'
  active      boolean     not null default true,
  sort_order  int,
  created_at  timestamptz not null default now()
);

comment on table public.breed_catalog is
  'Catálogo controlado de razas con códigos SENASA oficiales (manual SIGSA v2.42.80, spec 08). '
  'Read-only para el cliente (RLS SELECT-only). Grafías literales del manual; SIGSA valida contra ellas.';

-- Catálogo de solo lectura para clientes autenticados (R1.3).
alter table public.breed_catalog enable row level security;
grant select on public.breed_catalog to authenticated;
grant all    on public.breed_catalog to service_role;

drop policy if exists "breed_catalog_select_authenticated" on public.breed_catalog;
create policy "breed_catalog_select_authenticated"
  on public.breed_catalog
  for select to authenticated
  using (true);
-- Sin policies de INSERT/UPDATE/DELETE: el cliente no puede mutar el catálogo (R1.3). Solo
-- service_role (migraciones) escribe.

-- Seed (R1.2): 28 razas bovinas con las grafías LITERALES del manual SIGSA v2.42.80
-- (razas-senasa-codigos.md Tabla 1) + S/E (Sin Especificar, generic) + 3 bubalinas (active=false,
-- fuera del scope bovino MVP). sort_order: razas pampeanas frecuentes primero (para el picker);
-- 'OR' (Otra Raza) NO se promueve — queda en su sort_order natural 28 (decisión 1 del leader, no
-- degradar analytics). 'S/E' = 99; bubalinas 100-102.
insert into public.breed_catalog (senasa_code, name, species, active, sort_order) values
  ('AA',  'Aberdeen Angus',     'bovine',  true,  1),
  ('H',   'Hereford',           'bovine',  true,  2),
  ('PH',  'Polled Hereford',    'bovine',  true,  3),
  ('BG',  'Brangus',            'bovine',  true,  4),
  ('BF',  'Braford',            'bovine',  true,  5),
  ('SH',  'Shorthorn',          'bovine',  true,  6),
  ('CH',  'Charolais',          'bovine',  true,  7),
  ('L',   'Limousine',          'bovine',  true,  8),
  ('LA',  'Limangus',           'bovine',  true,  9),
  ('CR',  'Criolla',            'bovine',  true,  10),
  ('GC',  'Ganado Cruza',       'bovine',  true,  11),
  ('HA',  'Holando Argentino',  'bovine',  true,  12),
  ('B',   'Brahman',            'bovine',  true,  13),
  ('MG',  'Murray Grey',        'bovine',  true,  14),
  ('G',   'Galloway',           'bovine',  true,  15),
  ('W',   'Wagyu',              'bovine',  true,  16),
  ('SF',  'Seneford',           'bovine',  true,  17),
  ('SG',  'Santa Gertrudis',    'bovine',  true,  18),
  ('SA',  'Senangus',           'bovine',  true,  19),
  ('SP',  'Senepol',            'bovine',  true,  20),
  ('FS',  'Simmental',          'bovine',  true,  21),
  ('J',   'Jersey',             'bovine',  true,  22),
  ('K',   'Kiwi',               'bovine',  true,  23),
  ('BO',  'Bosmara',            'bovine',  true,  24),   -- grafía del manual (raza real: Bonsmara)
  ('SRB', 'Sueca Roja y Blanca','bovine',  true,  25),
  ('TL',  'Tuli',               'bovine',  true,  26),
  ('SI',  'San Ignacio',        'bovine',  true,  27),   -- ⚠ en el flujo de dispositivos SI = San Ignacio (no Simmental)
  ('OR',  'Otra Raza',          'bovine',  true,  28),
  -- Genérico de cierre + bubalinas (fuera de scope bovino MVP)
  ('S/E', 'Sin Especificar',    'generic', true,  99),
  ('ME',  'Mediterranea',       'bubaline', false, 100),
  ('JA',  'Jafarabadi',         'bubaline', false, 101),
  ('MU',  'Murrah',             'bubaline', false, 102)
on conflict (senasa_code) do nothing;

notify pgrst, 'reload schema';
