-- 0083_create_animal_rpc.sql  (feature 15-powersync, Run create-animal-rpc — alta de animal ATÓMICA)
--
-- RPC atómica server-side para el alta de animal (create_animal). Reemplaza el camino de upload de
-- 2 upserts HTTP NO atómicos (`animals` → `animal_profiles`) que el connector aplicaba al drenar la
-- outbox. Ese camino PERDÍA DATOS bajo reintento (bug confirmado con logs API + DB remota, backlog
-- 2026-06-10 REABIERTO): si el drenado se interrumpía ENTRE los dos upserts quedaba un `animals`
-- huérfano (sin perfil, invisible por RLS) y el REINTENTO del upsert de `animals` pegaba el conflicto
-- de PK → rama ON CONFLICT DO UPDATE → la policy UPDATE de `animals` (0022) exige `EXISTS animal_profiles
-- visible` → el perfil no existe → 42501/403 → permanent_reject → rollback del overlay → el animal
-- desaparecía de la UI y NUNCA llegaba al server. Esta RPC cierra esa cadena: una sola transacción
-- server-side (sin half-state posible) + idempotencia por los ids de CLIENTE + SANA los huérfanos ya
-- dejados por el camino viejo (ON CONFLICT (id) DO NOTHING en `animals` → sigue y crea el perfil).
--
-- Patrón calcado de 0081 (create_rodeo): SECURITY DEFINER + search_path fijado + authz PRIMERO +
-- INSERT con id de cliente ON CONFLICT (id) DO NOTHING + guard anti-IDOR post-insert + grants cerrados.
--
-- La migración la escribe el IMPLEMENTER (as-built en disco llega a 0082) pero NO la aplica al remoto:
-- la aplica el leader por Management API tras gatearla (Gate 1). Hasta entonces los tests de
-- supabase/tests/animal/run.cjs (suite `create_animal RPC`) FALLAN — ESPERADO (patrón 0075-0082).
--
-- ALCANCE (aditivo, no toca policies/RLS/triggers as-built): 1 RPC nueva. Los triggers existentes
-- disparan IGUAL dentro de la RPC (auth.uid() sigue siendo el caller bajo SECURITY DEFINER — patrón
-- validado en 0075/0081):
--   - animals_validate_species (0019): species activa.
--   - animal_profiles_set_created_by (0043): FUERZA created_by = auth.uid() (load-bearing para
--     exit_animal_profile) — por eso la RPC NO setea created_by.
--   - animal_profiles_identity_check / _rodeo_check / _category_check (0021): identidad mínima,
--     rodeo del establishment, categoría del sistema del rodeo (23514 con mensaje claro).
--   - tg de identidad denormalizada (0079): FUERZA animal_tag_electronic/animal_sex/animal_birth_date.
--   - record_category_change (0030) y demás AFTER: corren como siempre.
-- Los CHECKs de largo de texto (0070: idv/visual/breed/coat/tag ≤ 64) y los UNIQUE de dominio
-- (animals_tag_unique, animal_profiles_idv_unique, animal_profiles_active_animal_unique) se aplican
-- dentro del definer → un duplicado REAL revienta con 23505 y SALE de la RPC (rechazo legítimo que
-- uploadData clasifica permanente y superficia). NO se duplican validaciones de triggers acá.
--
-- IDEMPOTENCIA (R6.10 — la outbox es at-least-once): dedup NATURAL por los ids de CLIENTE
-- (p_animal_id / p_profile_id, generados por createAnimal en el cliente y estables entre reintentos).
--   - replay completo (ambas filas ya existen): corte temprano (a-bis) por el perfil existente → la RPC
--     devuelve 2xx sin segundo efecto (no hay rama de error de replay; no necesita p_client_op_id) —
--     robusto incluso si la identidad del animal fue editada entre el primer apply y el reintento.
--   - half-state del camino VIEJO (`animals` huérfano sin perfil): el INSERT de animals es no-op
--     (DO NOTHING, el guard verifica que la fila matchea el intent) y el INSERT del perfil SÍ corre →
--     el huérfano queda SANADO (el alta termina de aterrizar, no 403).
--   ⚠️ El target del ON CONFLICT es SOLO la PK (id): un 23505 de OTRO índice (tag duplicado de OTRO
--   animal, idv duplicado en el establishment) NO se absorbe → sale como error (correcto: es un
--   rechazo de dominio, no un replay).
--
-- AUTHZ: paridad con la policy INSERT as-built de animal_profiles (0022: has_role_in(establishment_id);
-- field_operator y veterinarian PUEDEN dar de alta — NO es owner-only como create_rodeo). La RPC es
-- SECURITY DEFINER → la RLS no la protege; el guard has_role_in(p_establishment_id) rige PRIMERO (42501).

begin;

create or replace function public.create_animal (
  p_animal_id           uuid,
  p_profile_id          uuid,
  p_establishment_id    uuid,
  p_rodeo_id            uuid,
  p_category_id         uuid,
  p_sex                 text,
  p_species_id          uuid,
  p_category_override   boolean default false,
  p_status              text default 'active',
  p_tag_electronic      text default null,
  p_birth_date          date default null,
  p_idv                 text default null,
  p_visual_id_alt       text default null,
  p_breed               text default null,
  p_coat_color          text default null,
  p_entry_date          date default null,
  p_entry_weight        numeric default null,
  p_management_group_id uuid default null,
  p_teeth_state         text default null,
  p_nursing             boolean default null
) returns uuid                                   -- devuelve el id del perfil (= p_profile_id; o el existente en el replay)
language plpgsql security definer
set search_path = public as $$
declare
  v_tag text := nullif(trim(coalesce(p_tag_electronic, '')), '');
begin
  -- (a) AUTHZ PRIMERO — paridad con animal_profiles_insert (0022): cualquier rol activo en el campo
  --     puede dar de alta. Un usuario sin rol en p_establishment_id → 42501, antes de cualquier escritura.
  if not public.has_role_in(p_establishment_id) then
    raise exception 'not authorized to create an animal in this establishment' using errcode = '42501';
  end if;

  -- (a-bis) REPLAY COMPLETO ya aplicado → no-op temprano. Si el perfil de ESTE intent ya existe (mismo
  --     p_profile_id + mismo animal + mismo establishment ya autorizado), la op corrió entera en una
  --     pasada previa cuyo ACK se perdió → devolver el id sin tocar nada. Esto hace el replay robusto
  --     incluso si la IDENTIDAD del animal fue editada entre el primer apply y el reintento (sin este
  --     corte, el guard de matcheo de (b-bis) rechazaría 42501 un replay legítimo). SIN filtro de
  --     deleted_at a propósito: si el perfil fue soft-deleteado después del primer apply, el replay
  --     sigue siendo no-op (NO se resucita ni se re-crea).
  if exists (
    select 1 from public.animal_profiles ap
    where ap.id = p_profile_id
      and ap.animal_id = p_animal_id
      and ap.establishment_id = p_establishment_id
  ) then
    return p_profile_id;
  end if;

  -- (b) INSERT de `animals` con el id de CLIENTE. ON CONFLICT (id) DO NOTHING → idempotencia natural:
  --     un replay at-least-once (mismo p_animal_id) NO crea un 2do animal, y un huérfano del camino
  --     viejo (animals sin perfil) NO bloquea (no-op → se sigue al perfil = HEALING del half-state).
  --     El target del conflicto es SOLO la PK: el UNIQUE parcial de tag (animals_tag_unique) NO se
  --     absorbe → un tag tomado por OTRO animal revienta con 23505 (rechazo de dominio legítimo).
  --     El trigger 0019 valida species activa; el CHECK de sex y el cap de largo del tag (0070) aplican.
  insert into public.animals (id, sex, species_id, tag_electronic, birth_date)
  values (p_animal_id, p_sex, p_species_id, v_tag, p_birth_date)
  on conflict (id) do nothing;

  -- (b-bis) GUARD ANTI-IDOR / ANTI-MISMATCH (espeja el (c-bis) de 0081). El INSERT es DO NOTHING y la
  --     RPC bypassa RLS: si p_animal_id COLISIONA con un animal AJENO (o con cualquier fila que NO sea
  --     la de este intent), el INSERT de abajo le colgaría un perfil del atacante a un animal ajeno.
  --     Por eso exigimos que la fila `animals` con p_animal_id MATCHEE la identidad del intent
  --     (sex/species/tag/birth_date — un replay o un huérfano del camino viejo matchean SIEMPRE: salen
  --     del mismo payload). Mismatch → 42501 genérico, sin oráculo de qué difiere ni de quién es.
  if not exists (
    select 1 from public.animals a
    where a.id = p_animal_id
      and a.sex = p_sex
      and a.species_id = p_species_id
      and a.tag_electronic is not distinct from v_tag
      and a.birth_date is not distinct from p_birth_date
      and a.deleted_at is null
  ) then
    raise exception 'animal id does not match this create intent' using errcode = '42501';
  end if;

  -- (c) INSERT de `animal_profiles` con el id de CLIENTE. ON CONFLICT (id) DO NOTHING → el replay
  --     completo es no-op (la PK ya existe → el pre-check del arbiter corta ANTES de tocar los otros
  --     índices: no hay 23505 espurio de idv en el replay). En el INSERT real, los UNIQUE de dominio
  --     (idv por establishment, un perfil activo por animal) y los triggers 0021/0043/0079 aplican; un
  --     fallo acá ABORTA TODA la RPC (incluido el INSERT de animals de arriba) → sin huérfanos nuevos.
  --     created_by NO se setea (lo FUERZA 0043 desde auth.uid()); la identidad denormalizada animal_*
  --     NO se setea (la FUERZA 0079 desde animals).
  insert into public.animal_profiles (
    id, animal_id, establishment_id, rodeo_id, category_id, category_override, status,
    idv, visual_id_alt, breed, coat_color, entry_date, entry_weight, management_group_id,
    teeth_state, nursing
  ) values (
    p_profile_id, p_animal_id, p_establishment_id, p_rodeo_id, p_category_id,
    coalesce(p_category_override, false),
    coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active')::public.animal_status,
    nullif(trim(coalesce(p_idv, '')), ''),
    nullif(trim(coalesce(p_visual_id_alt, '')), ''),
    nullif(trim(coalesce(p_breed, '')), ''),
    nullif(trim(coalesce(p_coat_color, '')), ''),
    p_entry_date, p_entry_weight, p_management_group_id,
    nullif(trim(coalesce(p_teeth_state, '')), '')::public.teeth_state_enum,
    coalesce(p_nursing, false)
  )
  on conflict (id) do nothing;

  -- (c-bis) GUARD post-insert (espeja 0081): el perfil con p_profile_id debe ser EXACTAMENTE el de este
  --     intent (mismo animal + mismo establishment ya autorizado). Cubre la colisión adversarial de
  --     p_profile_id con un perfil AJENO (el DO NOTHING la absorbería en silencio) → 42501 genérico,
  --     sin tocar ni revelar la fila ajena.
  if not exists (
    select 1 from public.animal_profiles ap
    where ap.id = p_profile_id
      and ap.animal_id = p_animal_id
      and ap.establishment_id = p_establishment_id
      and ap.deleted_at is null
  ) then
    raise exception 'profile id does not belong to this establishment' using errcode = '42501';
  end if;

  return p_profile_id;
end; $$;

comment on function public.create_animal is
  'Alta de animal ATÓMICA (drenada desde la outbox de PowerSync; reemplaza los 2 upserts no atómicos que '
  'perdían datos bajo reintento — backlog 2026-06-10). SECURITY DEFINER con guard has_role_in PRIMERO '
  '(paridad con animal_profiles_insert 0022). INSERT de animals + animal_profiles con ids de CLIENTE, ambos '
  'ON CONFLICT (id) DO NOTHING → replay at-least-once = no-op total y SANA el half-state (animals huérfano '
  'del camino viejo → DO NOTHING → crea el perfil). Guards anti-IDOR post-insert (la fila debe matchear el '
  'intent). Los 23505 de dominio (tag de OTRO animal, idv duplicado) SALEN como error. created_by lo fuerza '
  '0043; la identidad denormalizada la fuerza 0079. No necesita client_op_id (dedup natural por los ids).';

-- Cierre de la superficie RPC: solo authenticated (es el camino de alta del cliente; anon/public no).
revoke execute on function public.create_animal (uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, text, text, date, text, text, text, text, date, numeric, uuid, text, boolean) from public, anon;
grant  execute on function public.create_animal (uuid, uuid, uuid, uuid, uuid, text, uuid, boolean, text, text, date, text, text, text, text, date, numeric, uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
