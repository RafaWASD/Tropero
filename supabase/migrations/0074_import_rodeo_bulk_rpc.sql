-- 0074_import_rodeo_bulk_rpc.sql  (spec 12 — R9.4 / R8.1 / R8.2 / R8.4, T2.3)
--
-- RPC SECURITY DEFINER de bulk-insert del padrón. Escenario B (Puerta 1, Raf 2026-06-06):
-- atomicidad por animal (los 2 inserts animals→animal_profiles de cada fila en la misma
-- transacción → SIN huérfanos) + bloqueo de field_operator a nivel DB para la escritura masiva.
--
-- LO LLAMA EL CLIENTE DIRECTO (no un edge con service_role, a diferencia de 0058) → EXECUTE
-- revocado de public/anon, grant a authenticated. La SEGURIDAD la da la re-validación de rol
-- owner/vet ADENTRO (no el grant). Diferencia explícita con 0058 (Gate 1 nota al implementer).
--
-- Los 5 controles obligatorios (R9.4 / design §6-B), por orden:
--   (a) deriva p_establishment_id del rodeo + re-valida has_role_in con rol owner/vet (mismo
--       predicado inline que la policy de import_log) → caller sin ese rol → raise exception.
--   (b) verifica que el rodeo existe (si no, rechaza); est se deriva de ahí (no del payload).
--   (c) setea establishment_id/created_by/imported_by server-side (NO del payload — A1-1/SEC-SPEC-03).
--       species_id/system_id se derivan del rodeo, no del payload.
--   (d) revoke execute from public/anon + grant execute to authenticated (abajo + smoke-check).
--   (e) enforça los CHECK char_length (0070) y los unique (animals_tag_unique / animal_profiles_idv_unique)
--       adentro: NO se bypassan con security definer (los CHECK/unique/triggers disparan igual; el
--       definer solo saltea la RLS, no los constraints). Import parcial por-fila: una fila que viola
--       un unique (carrera) se saltea y se acumula en el resultado, NO aborta el chunk (bloque
--       begin...exception por fila).
--
-- CONTRATO de p_rows (jsonb array). Cada elemento:
--   {
--     "row_index":         int,      -- índice de la fila en el archivo del cliente (para reportar fallos)
--     "sex":               text,     -- 'male' | 'female' (ya normalizado por el cliente; la DB lo CHECK-ea)
--     "tag_electronic":    text|null,
--     "birth_date":        text|null,-- 'YYYY-MM-DD' o null
--     "idv":               text|null,
--     "visual_id_alt":     text|null,
--     "breed":             text|null,
--     "category_code":     text|null,-- code del catálogo del system del rodeo; null/no-match → placeholder por sexo
--     "category_override":  bool,    -- true si vino de columna que matcheó (el cliente lo decide); el RPC
--                                    --   lo FUERZA a false si el code no matchea (placeholder "a completar")
--     "management_group_id":uuid|null-- ya resuelto por nombre por el cliente; null si no matcheó. El trigger
--                                    --   0037 valida que pertenezca al mismo establishment.
--   }
-- establishment_id / created_by / imported_by / species_id / system_id NO se leen del payload.
--
-- RETORNA jsonb:
--   { "imported_ok": int, "imported_errors": int, "errors": [ {"row_index": int, "reason": text}, ... ] }

create or replace function public.import_rodeo_bulk (p_rodeo_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_establishment_id uuid;
  v_species_id       uuid;
  v_system_id        uuid;
  v_uid              uuid := auth.uid();
  v_row              jsonb;
  v_ok               int := 0;
  v_err              int := 0;
  v_errors           jsonb := '[]'::jsonb;
  v_animal_id        uuid;
  v_profile_id       uuid;
  v_cat_id           uuid;
  v_cat_code         text;
  v_cat_override     boolean;
  v_sex              text;
  v_row_index        int;
begin
  -- Caller debe estar autenticado (defensa; el grant ya excluye anon, pero auth.uid() null no debe pasar).
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- (a)+(b) Derivar establishment/species/system DEL RODEO (no del payload). Si el rodeo no existe
  -- o está soft-deleted → rechazar (no se puede importar a un rodeo inexistente).
  select r.establishment_id, r.species_id, r.system_id
    into v_establishment_id, v_species_id, v_system_id
  from public.rodeos r
  where r.id = p_rodeo_id
    and r.deleted_at is null;

  if v_establishment_id is null then
    raise exception 'rodeo % not found or deleted', p_rodeo_id using errcode = '23503';
  end if;

  -- (a) Re-validar rol owner/vet en el establishment del rodeo (mismo predicado inline que la
  -- policy de import_log). Un caller sin rol owner/vet en ESE establishment → rechazado. Esto
  -- cierra MEDIUM-3 (field_operator a nivel DB) y el cross-tenant (rol solo en otro est → no pasa).
  if not (
    public.is_owner_of(v_establishment_id)
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = v_uid
        and ur.establishment_id = v_establishment_id
        and ur.role = 'veterinarian'
        and ur.active = true
    )
  ) then
    raise exception 'caller is not owner or veterinarian of the destination establishment'
      using errcode = '42501';
  end if;

  -- Tope DURO de filas por llamada (capa autoritativa server-side, espejo de R3.2 = 5000 filas).
  -- El cap del cliente (R3.2/R3.3) es UX/bypasseable con curl; ESTE es el que enforça contra
  -- DoW/amplificación (SEC-12B-HIGH-01). Va DESPUÉS del authz (un caller sin rol owner/vet ya
  -- fue rechazado arriba, sin evaluar el tamaño) y ANTES del loop (no se procesa ni una fila).
  -- Rechaza el BATCH ENTERO: un batch >5000 no es "filas malas que se saltean" sino un límite de
  -- input duro como R3.1/R3.2 — no es skip-and-report. Si el cliente chunkea, el chunk respeta este tope.
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then
    raise exception 'import batch exceeds max rows: % (max 5000 per call)',
      jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) using errcode = '22023';
  end if;

  -- Recorrer las filas. Import parcial POR FILA: cada fila va en su propio bloque de excepción,
  -- así una violación de unique (carrera) o cualquier error de fila se saltea y se reporta sin
  -- abortar el resto del chunk.
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_row_index := coalesce((v_row->>'row_index')::int, -1);
    begin
      v_sex := v_row->>'sex';

      -- (e) NO confiamos del payload el category_id: resolvemos category_id por (system del rodeo, code).
      -- Si el code matchea → ese category_id + el override que mandó el cliente. Si no matchea (o no
      -- vino code) → placeholder "a completar" por sexo (torito/novillito machos, vaquillona hembras)
      -- con category_override = false (D3 interino; no se infiere categoría biológica fina en masa).
      v_cat_code := nullif(trim(coalesce(v_row->>'category_code', '')), '');
      v_cat_override := coalesce((v_row->>'category_override')::boolean, false);
      v_cat_id := null;

      if v_cat_code is not null then
        select c.id into v_cat_id
        from public.categories_by_system c
        where c.system_id = v_system_id and c.code = v_cat_code and c.active = true;
      end if;

      if v_cat_id is null then
        -- placeholder por sexo (R10.5). category_override forzado a false → recálculo posterior lo ajusta.
        v_cat_override := false;
        select c.id into v_cat_id
        from public.categories_by_system c
        where c.system_id = v_system_id
          and c.code = case when v_sex = 'male' then 'torito' else 'vaquillona' end
          and c.active = true;
      end if;

      if v_cat_id is null then
        -- el catálogo del sistema no tiene el placeholder esperado: error de fila, no aborta el chunk.
        raise exception 'no se pudo resolver una categoría del catálogo para la fila';
      end if;

      -- (c) animals: species_id DEL RODEO (no del payload). sex/tag/birth del payload (la DB CHECK-ea
      -- sex enum, tag char_length≤64 + unique global, species activa). id generado server-side.
      v_animal_id := gen_random_uuid();
      insert into public.animals (id, species_id, sex, tag_electronic, birth_date)
      values (
        v_animal_id,
        v_species_id,
        v_sex,
        nullif(trim(coalesce(v_row->>'tag_electronic', '')), ''),
        (nullif(trim(coalesce(v_row->>'birth_date', '')), ''))::date
      );

      -- (c) animal_profiles: establishment_id DEL RODEO (no del payload), rodeo_id = p_rodeo_id.
      -- created_by lo FUERZA el trigger 0043 (auth.uid()). Los triggers de 0021 (identity / rodeo∈est /
      -- category∈system) y de 0037 (management_group∈est) disparan igual (security definer NO los saltea).
      v_profile_id := gen_random_uuid();
      insert into public.animal_profiles (
        id, animal_id, establishment_id, rodeo_id,
        idv, visual_id_alt, breed,
        category_id, category_override, management_group_id, status
      )
      values (
        v_profile_id, v_animal_id, v_establishment_id, p_rodeo_id,
        nullif(trim(coalesce(v_row->>'idv', '')), ''),
        nullif(trim(coalesce(v_row->>'visual_id_alt', '')), ''),
        nullif(trim(coalesce(v_row->>'breed', '')), ''),
        v_cat_id, v_cat_override,
        nullif(v_row->>'management_group_id', '')::uuid,
        'active'
      );

      v_ok := v_ok + 1;
    exception
      when unique_violation then
        -- (e) carrera: tag o idv ya tomado (R8.4). Skip + report, NO aborta el chunk.
        v_err := v_err + 1;
        v_errors := v_errors || jsonb_build_object('row_index', v_row_index, 'reason', 'duplicate');
      when others then
        -- cualquier otra falla de fila (sex inválido, tag>64, category irresoluble, etc.): skip + report.
        v_err := v_err + 1;
        v_errors := v_errors || jsonb_build_object('row_index', v_row_index, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'imported_ok', v_ok,
    'imported_errors', v_err,
    'errors', v_errors
  );
end; $$;

comment on function public.import_rodeo_bulk (uuid, jsonb) is
  'Bulk-insert del padrón (spec 12, R9.4). SECURITY DEFINER: re-valida owner/vet adentro, deriva '
  'establishment/species/system del rodeo (no del payload), fuerza created_by/imported_by server-side, '
  'import parcial por-fila (unique_violation se saltea + reporta). Lo llama el cliente directo (grant '
  'a authenticated; revocado de public/anon — la seguridad la da la re-validación de rol, no el grant).';

-- (d) EXECUTE: revocado de public/anon, grant a authenticated. NO service_role-only (lo llama el
-- CLIENTE directo, a diferencia del RPC de 0058 que llama un edge con service_role). La re-validación
-- de rol owner/vet ADENTRO es lo que lo hace seguro, no el grant. Revocar de los TRES roles que
-- Supabase podría tener por ALTER DEFAULT PRIVILEGES (patrón 0042/0055/0058), luego grant a authenticated.
revoke all on function public.import_rodeo_bulk (uuid, jsonb) from public, anon;
grant execute on function public.import_rodeo_bulk (uuid, jsonb) to authenticated;

-- Smoke-check fail-closed (estilo 0055/0058): si la RPC quedara EXECUTE-able por anon/public, FALLA.
-- authenticated SÍ debe poder (lo llama el cliente) — por eso NO está en la lista de prohibidos.
do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'import_rodeo_bulk'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: import_rodeo_bulk is EXECUTE-able by %', v_bad.rolname;
  end loop;
  raise notice 'grant check OK: import_rodeo_bulk revoked from anon/public, granted to authenticated';
end$$;

notify pgrst, 'reload schema';
