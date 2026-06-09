-- 0081_create_rodeo_rpc.sql  (feature 15-powersync, Run T9.8 — createRodeo OFFLINE)
--
-- RPC atómica para crear un rodeo OFFLINE (Raf: offline-first sin excepciones). Es el ÚLTIMO write que
-- faltaba offline. A diferencia de createManagementGroup (INSERT plano → ya offline en T5), createRodeo
-- arma una PLANTILLA de datos (`rodeo_data_config`): el trigger server-side `tg_rodeos_seed_data_config`
-- (0018) seedea los defaults del sistema en el INSERT del rodeo, y luego se aplica el diff de toggles del
-- usuario. Y `rodeo_data_config` tiene PK COMPUESTA (`rodeo_id, field_definition_id`) → es read-only-local
-- (no se escribe por el camino CRUD-plano offline). Por eso el alta de rodeo va por una RPC atómica
-- server-side + outbox + overlay optimista (mismo patrón que register_birth/exit en T6).
--
-- Ver specs/active/15-powersync/{requirements R5.1/R6.x, design §1.2}. La migración la escribe el
-- IMPLEMENTER (≥ 0081; as-built en disco llega a 0080) pero NO la aplica al remoto: la aplica el leader
-- por Management API tras gatearla (Gate 1 spec + reviewer). Hasta entonces el test de idempotencia de
-- supabase/tests/animal/run.cjs FALLA — es ESPERADO (mismo patrón que 0075-0080).
--
-- ALCANCE (aditivo, no toca policies/RLS/triggers as-built): 1 RPC nueva. NO modifica `rodeos`,
-- `rodeo_data_config`, sus RLS, ni el trigger de seed (0018). El delta es estrictamente una RPC que
-- ENCAPSULA el flujo que hoy hace el cliente online (INSERT rodeo → el trigger seedea config → UPSERT
-- de los toggles), para que pueda drenarse desde la outbox de PowerSync de forma atómica e idempotente.
--
-- IDEMPOTENCIA (R6.10 — la outbox es at-least-once): el alta NO necesita p_client_op_id. La dedup es
-- NATURAL por el `id` de cliente del rodeo:
--   - el INSERT del rodeo es `ON CONFLICT (id) DO NOTHING` → un replay (mismo p_id) NO crea un 2do rodeo
--     y, crucialmente, NO re-dispara el trigger de seed (no hay INSERT efectivo) → la plantilla no se
--     duplica;
--   - el UPSERT de cada toggle re-aplica el MISMO end-state (set enabled) → re-aplicar es no-op.
-- → un replay completo (mismo p_id + p_toggles) es no-op TOTAL.
--
-- AUTHZ: crear rodeo es OWNER-ONLY (espeja la RLS `rodeos_insert` = is_owner_of, 0017:53-54). La RPC es
-- SECURITY DEFINER → la RLS NO la protege; el guard `is_owner_of(p_establishment_id)` rige PRIMERO (42501).
-- El INSERT/UPSERT de adentro corre como definer (bypassa RLS) pero el guard ya cerró el tenant.

begin;

create or replace function public.create_rodeo (
  p_id               uuid,
  p_establishment_id uuid,
  p_name             text,
  p_species_id       uuid,
  p_system_id        uuid,
  p_toggles          jsonb default '[]'::jsonb  -- [{ "field_definition_id": uuid, "enabled": bool }, ...] (diff del usuario)
) returns uuid                                   -- devuelve el id del rodeo (= p_id; o el existente en el replay)
language plpgsql security definer
set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_toggle jsonb;
  v_field_id uuid;
  v_enabled boolean;
begin
  -- (a) AUTHZ PRIMERO — crear rodeo es OWNER-ONLY (espeja rodeos_insert = is_owner_of, 0017). Rige antes
  --     de cualquier escritura. Un field_operator/vet o un usuario sin rol en el campo → 42501.
  if not public.is_owner_of(p_establishment_id) then
    raise exception 'not authorized to create a rodeo in this establishment' using errcode = '42501';
  end if;

  -- (b) Validaciones mínimas accionables (el FK + el trigger rodeos_validate_species_system 0017:40-42
  --     re-validan igual, pero acá damos un error claro antes del INSERT).
  if v_name = '' then
    raise exception 'rodeo name must not be empty' using errcode = '23514';
  end if;
  -- Tope de largo server-side (regla dura de inputs / hardening INPUT-1 feature 13): el nombre es input
  -- de usuario; aunque no se concatena ni va a buscador, todo campo de texto lleva límite autoritativo
  -- server-side. 120 es holgado para un nombre de rodeo ("Vacas preñadas norte"). Gate 1 M1, 2026-06-09.
  if char_length(v_name) > 120 then
    raise exception 'rodeo name too long (max 120 chars)' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.species sp where sp.id = p_species_id and sp.active = true
  ) then
    raise exception 'species not found or inactive' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.systems_by_species s
    where s.id = p_system_id and s.species_id = p_species_id and s.active = true
  ) then
    raise exception 'invalid species/system combination or system inactive' using errcode = '23514';
  end if;

  -- (c) INSERT del rodeo con el id de CLIENTE. ON CONFLICT (id) DO NOTHING → idempotencia natural:
  --     un replay at-least-once (mismo p_id) NO crea un 2do rodeo y NO re-dispara el trigger de seed
  --     (`tg_rodeos_seed_data_config`, AFTER INSERT 0018) → la plantilla NO se duplica. En el INSERT real
  --     (1ra vez), el trigger pre-pobla `rodeo_data_config` con los system_default_fields del sistema.
  insert into public.rodeos (id, establishment_id, name, species_id, system_id)
  values (p_id, p_establishment_id, v_name, p_species_id, p_system_id)
  on conflict (id) do nothing;

  -- (c-bis) GUARD ANTI-IDOR (cross-tenant). El INSERT es ON CONFLICT DO NOTHING + esta RPC es SECURITY
  --     DEFINER (bypassa RLS). Si un atacante (owner de SU campo, pasa is_owner_of(p_establishment_id))
  --     manda un p_id que COLISIONA con un rodeo de OTRO establecimiento, el INSERT es no-op pero el UPSERT
  --     de toggles de abajo escribiría sobre el `rodeo_data_config` del rodeo AJENO (bypass de RLS). Por eso
  --     exigimos que el rodeo con p_id PERTENEZCA a p_establishment_id (ya autorizado por is_owner_of). Si no
  --     (rodeo ajeno, o el INSERT no creó nada por colisión con otro tenant) → 42501, NO se toca su config.
  if not exists (
    select 1 from public.rodeos r
    where r.id = p_id and r.establishment_id = p_establishment_id and r.deleted_at is null
  ) then
    raise exception 'rodeo id does not belong to this establishment' using errcode = '42501';
  end if;

  -- (d) Aplicar el DIFF de toggles del usuario (idempotente, UPSERT) sobre la plantilla pre-poblada por el
  --     trigger. `p_toggles` ya es el diff computado en el cliente (computeConfigDiff): por cada field que
  --     el usuario dejó distinto del default (update) o habilitó siendo no-default (insert), una entrada
  --     { field_definition_id, enabled }. El UPSERT cubre AMBOS casos (fila default ya existe → UPDATE
  --     enabled; field no-default sin fila → INSERT) en un solo statement, y re-aplicarlo deja el MISMO
  --     end-state (idempotente). NO se setea establishment_id: el trigger 0078 lo FUERZA desde el rodeo
  --     (anti-spoof). El FK de field_definition_id rechaza un id inexistente (23503).
  if p_toggles is not null and jsonb_typeof(p_toggles) = 'array' then
    for v_toggle in select * from jsonb_array_elements(p_toggles)
    loop
      v_field_id := nullif(v_toggle ->> 'field_definition_id', '')::uuid;
      v_enabled  := coalesce((v_toggle ->> 'enabled')::boolean, true);
      if v_field_id is null then
        raise exception 'toggle entry missing field_definition_id' using errcode = '22023';
      end if;
      insert into public.rodeo_data_config (rodeo_id, field_definition_id, enabled)
      values (p_id, v_field_id, v_enabled)
      on conflict (rodeo_id, field_definition_id) do update set enabled = excluded.enabled;
    end loop;
  end if;

  return p_id;
end; $$;

comment on function public.create_rodeo is
  'Crea un rodeo OFFLINE (drenado desde la outbox de PowerSync). SECURITY DEFINER con guard is_owner_of '
  '(owner-only, espeja rodeos_insert 0017). INSERT del rodeo con id de cliente ON CONFLICT DO NOTHING + '
  'UPSERT de los toggles → idempotente (replay at-least-once = no-op total: el rodeo ya existe, el trigger '
  'de seed no re-dispara, los toggles re-aplican el mismo end-state). El trigger 0018 seedea rodeo_data_config '
  'en el INSERT; el 0078 fuerza su establishment_id (anti-spoof). No necesita client_op_id (dedup natural por el id).';

-- Cierre de la superficie RPC: solo authenticated puede crearla (es el camino de alta de rodeo del cliente).
revoke execute on function public.create_rodeo (uuid, uuid, text, uuid, uuid, jsonb) from public, anon;
grant  execute on function public.create_rodeo (uuid, uuid, text, uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
