-- 0082_set_rodeo_config_rpc.sql  (feature 15-powersync, Run T9.9 — editar plantilla del rodeo OFFLINE)
--
-- RPC atómica para EDITAR la plantilla de datos de un rodeo OFFLINE (Raf: offline-first sin excepciones).
-- Es el gemelo de `create_rodeo` (0081, Run T9.8) para el camino de EDICIÓN: hoy `editar-plantilla.tsx`
-- escribe ONLINE (UPDATE/INSERT directos sobre `rodeo_data_config` vía PostgREST → toggleRodeoField /
-- enableNonDefaultField) y falla sin red. `rodeo_data_config` tiene PK COMPUESTA (`rodeo_id,
-- field_definition_id`) → es read-only-local (no se escribe por el camino CRUD-plano offline). Por eso la
-- edición de la plantilla va por esta RPC atómica server-side + outbox + overlay optimista (mismo patrón que
-- create_rodeo en T9.8 / register_birth/exit en T6).
--
-- Ver specs/active/15-powersync/{requirements R5.1/R6.x, design §5.3/§5.4}. La migración la escribe el
-- IMPLEMENTER (≥ 0082; as-built en disco llega a 0081) pero NO la aplica al remoto: la aplica el leader por
-- Management API tras gatearla (Gate 1 spec + reviewer). Hasta entonces el test `set_rodeo_config` de
-- supabase/tests/animal/run.cjs FALLA — es ESPERADO (mismo patrón que 0075-0081).
--
-- ALCANCE (aditivo, no toca policies/RLS/triggers as-built): 1 RPC nueva. NO modifica `rodeos`,
-- `rodeo_data_config`, sus RLS, ni el trigger de seed (0018) ni el de force-establishment_id (0078). El delta
-- es estrictamente una RPC que ENCAPSULA el UPSERT de toggles que hoy hace el cliente online, para que pueda
-- drenarse desde la outbox de PowerSync de forma atómica e idempotente.
--
-- IDEMPOTENCIA (R6.10 — la outbox es at-least-once): la edición NO necesita p_client_op_id. La dedup es
-- NATURAL por el UPSERT: cada toggle re-aplica el MISMO end-state (set enabled) → reaplicar el mismo
-- p_toggles deja la plantilla EXACTAMENTE igual (no-op total). El UPSERT cubre ambos casos del diff:
--   - field con fila (default pre-poblada o no-default ya habilitado) → UPDATE enabled;
--   - field no-default sin fila → INSERT enabled.
-- → un replay completo (mismo p_rodeo_id + p_toggles) es no-op TOTAL.
--
-- AUTHZ + ANTI-IDOR POR DERIVACIÓN (diferencia clave con create_rodeo): editar la plantilla es OWNER-ONLY
-- (espeja la RLS rodeo_data_config_update/insert = is_owner_of, 0018:158-170). La RPC es SECURITY DEFINER → la
-- RLS NO la protege; el guard `is_owner_of(v_est)` rige PRIMERO (42501). La CLAVE: el establishment NO es un
-- parámetro (a diferencia de create_rodeo, donde p_establishment_id ENTRABA por param y necesitaba un guard
-- anti-IDOR explícito c-bis para que un p_id ajeno no se UPSERTeara). Acá el establishment se DERIVA del rodeo
-- (`select establishment_id from rodeos where id = p_rodeo_id`), así que un owner SOLO puede tocar rodeos de
-- SUS campos: un p_rodeo_id de OTRO tenant → is_owner_of(est ajeno) = false → 42501, sin tocar nada. El
-- diseño es HERMÉTICO POR CONSTRUCCIÓN: no hay forma de que el establishment autorizado y el rodeo objetivo
-- diverjan, porque uno se deriva del otro. (En create_rodeo el rodeo aún no existía → el est no se podía
-- derivar → hizo falta el guard c-bis tras el INSERT; acá el rodeo YA existe → la derivación es directa.)

begin;

create or replace function public.set_rodeo_config (
  p_rodeo_id uuid,
  p_toggles  jsonb default '[]'::jsonb  -- [{ "field_definition_id": uuid, "enabled": bool }, ...] (diff del usuario)
) returns uuid                          -- devuelve el id del rodeo (= p_rodeo_id) por simetría con create_rodeo
language plpgsql security definer
set search_path = public as $$
declare
  v_est uuid;
  v_toggle jsonb;
  v_field_id uuid;
  v_enabled boolean;
begin
  -- (a) Buscar el rodeo y DERIVAR su establishment (la derivación es lo que hace la RPC anti-IDOR por
  --     construcción — ver header). Un rodeo inexistente o soft-deleteado → NOT FOUND → la edición es moot
  --     (P0002): el cliente clasifica P0002 de set_rodeo_config como rechazo permanente (rollbackea el
  --     overlay optimista y descarta el intent — la plantilla a editar ya no existe).
  select establishment_id into v_est
  from public.rodeos
  where id = p_rodeo_id and deleted_at is null;
  if not found then
    raise exception 'rodeo not found' using errcode = 'P0002';
  end if;

  -- (b) AUTHZ PRIMERO — editar la plantilla es OWNER-ONLY (espeja rodeo_data_config_update/insert = is_owner_of,
  --     0018). Rige antes de cualquier escritura. ANTI-IDOR: v_est se DERIVÓ del rodeo, así que un owner solo
  --     pasa este guard para rodeos de SUS campos; un p_rodeo_id de otro tenant → is_owner_of(est ajeno) = false
  --     → 42501 (hermético por construcción, ver header). Un field_operator/vet o un usuario sin rol → 42501.
  if not public.is_owner_of(v_est) then
    raise exception 'not authorized to edit this rodeo template' using errcode = '42501';
  end if;

  -- (c) Aplicar el DIFF de toggles del usuario (idempotente, UPSERT). `p_toggles` ya es el diff computado en el
  --     cliente (computeEditDiff): por cada field que el usuario dejó distinto del estado efectivo (update) o
  --     habilitó siendo no-default sin fila (insert), una entrada { field_definition_id, enabled }. El UPSERT
  --     cubre AMBOS casos (fila existe → UPDATE enabled; sin fila → INSERT) en un solo statement, y re-aplicarlo
  --     deja el MISMO end-state (idempotente). NO se setea establishment_id: el trigger 0078 lo FUERZA desde el
  --     rodeo en INSERT *y* UPDATE (anti-spoof). El FK de field_definition_id rechaza un id inexistente (23503).
  --     Guarda de jsonb (defensiva, igual que create_rodeo): si p_toggles no es array, no iteramos (p_toggles
  --     vacío `[]` → loop sin iteraciones → no-op, válido: "guardar sin cambios").
  if p_toggles is not null and jsonb_typeof(p_toggles) = 'array' then
    for v_toggle in select * from jsonb_array_elements(p_toggles)
    loop
      v_field_id := nullif(v_toggle ->> 'field_definition_id', '')::uuid;
      v_enabled  := coalesce((v_toggle ->> 'enabled')::boolean, true);
      if v_field_id is null then
        raise exception 'toggle entry missing field_definition_id' using errcode = '22023';
      end if;
      insert into public.rodeo_data_config (rodeo_id, field_definition_id, enabled)
      values (p_rodeo_id, v_field_id, v_enabled)
      on conflict (rodeo_id, field_definition_id) do update set enabled = excluded.enabled;
    end loop;
  end if;

  return p_rodeo_id;
end; $$;

comment on function public.set_rodeo_config is
  'Edita la plantilla de datos de un rodeo OFFLINE (drenado desde la outbox de PowerSync). SECURITY DEFINER '
  'con guard is_owner_of sobre el establishment DERIVADO del rodeo (owner-only, espeja rodeo_data_config_update/'
  'insert 0018; anti-IDOR HERMÉTICO por construcción: el est no es parámetro, se deriva → un p_rodeo_id ajeno '
  'da is_owner_of=false → 42501). UPSERT idempotente del diff de toggles (ON CONFLICT (rodeo_id, '
  'field_definition_id) DO UPDATE SET enabled) → replay = no-op total. Rodeo inexistente/soft-deleteado → P0002. '
  'El trigger 0078 fuerza establishment_id (anti-spoof). No necesita client_op_id (dedup natural por el UPSERT).';

-- Cierre de la superficie RPC: solo authenticated puede ejecutarla (es el camino de edición de plantilla del
-- cliente). anon/public revocados.
revoke execute on function public.set_rodeo_config (uuid, jsonb) from public, anon;
grant  execute on function public.set_rodeo_config (uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
