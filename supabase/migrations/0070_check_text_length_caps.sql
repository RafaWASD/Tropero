-- 0070_check_text_length_caps.sql  (spec 13 — INPUT-1, R1)
-- Tope de largo server-side autoritativo en CADA columna de texto-libre / jsonb de
-- usuario escribible por un miembro (tablas con grant insert/update a authenticated +
-- write-policy positiva). El cliente Expo es attacker-controlled (escribe a PostgREST
-- directo), así que el CHECK de DB es la ÚNICA capa autoritativa contra abuso de largo
-- (storage exhaustion); el cliente sigue siendo barrera de UX. Techo HOLGADO (no espejo
-- exacto del cliente). Cobertura completa: 45 columnas / 15 tablas (R1.1–R1.45),
-- verificada migration por migration en el Gate 1 (security_spec_13).
--
-- ⚠️ RECONCILIACIÓN POST-FEATURE-14 (migración 0068 user_private_pii, YA APLICADA al remoto):
-- la feature 14 movió `email` y `phone` de `public.users` (que ya NO las tiene) a la tabla nueva
-- `public.user_private (user_id PK, email NOT NULL, phone, ...)` con RLS self-only. 0070 se había
-- escrito contra el schema viejo (CHECK sobre users.email/users.phone) → abortaba con
-- `column "phone" does not exist`. Esta versión topa esas dos columnas de texto de usuario en su
-- nueva tabla: user_private.email (techo 320, RFC 5321) + user_private.phone (techo 32). El conteo
-- total NO cambia: -2 en users, +2 en user_private = 45 columnas / 15 tablas igual. Los CHECK siguen
-- siendo la única capa autoritativa (PostgREST directo escribe user_private.email/phone con grant
-- update a authenticated, acotado por la RLS self-only).
--
-- Patrón por constraint (R1.46): `add constraint ... not valid` (rápido, no escanea) +
-- `validate constraint` (escanea filas existentes). Para las 43 columnas LIMPIAS se hace
-- el patrón completo (not valid + validate) → quedan validadas. Para las 2 columnas de tag
-- con basura legada de e2e (ver abajo) se hace SOLO `not valid` (sin validate).
--
-- ⚠️ CLAVE CONCEPTUAL (3er ajuste de 0070): un CHECK `NOT VALID` IGUAL enforça TODOS los
-- INSERT/UPDATE futuros — Postgres solo saltea la validación de las filas EXISTENTES al
-- crearlo. O sea, el objetivo de seguridad de INPUT-1 (capear input de usuario de acá en
-- más, contra storage-exhaustion) se cumple con `NOT VALID` SOLO. El `VALIDATE CONSTRAINT`
-- es únicamente un re-chequeo retroactivo de las filas viejas. La seguridad la da el CHECK
-- NOT VALID, NO el pre-check ni el validate.
--
-- DATOS LEGADOS de e2e (verificado contra data real): SOLO 2 columnas tenían filas legadas con
-- tags sintéticos de test (36–45 chars; tags reales = 15 díg FDX-B, bien bajo el tope 64). Con el
-- techo en 64, algunas de esas filas YA caben, pero igual se conservan como NOT VALID sin validate
-- (grandfather, por si quedara alguna >64 de corridas viejas — no se mutan ni borran datos de e2e):
--   - animals.tag_electronic                  → NOT VALID sin validate (grandfather)
--   - reproductive_events.calf_tag_electronic → NOT VALID sin validate (grandfather)
-- Las otras 43 columnas están LIMPIAS → not valid + validate (quedan validadas). Se grandfatherean
-- las filas legadas (no se mutan ni se borran datos de e2e), pero TODO input futuro queda capeado.
--
-- Pre-check de datos legados (T1/R1.46): el DO-block de abajo era un `RAISE EXCEPTION` que ABORTABA
-- ante cualquier fila fuera de rango. Decisión (3er ajuste): se convierte en `RAISE NOTICE` que LISTA
-- los violadores y NO aborta. Razón: la seguridad la da el NOT VALID (que enforça el futuro), no el
-- pre-check; abortar por basura de e2e que ya está grandfathereada no aportaba nada y bloqueaba el
-- apply. Es la opción más limpia y robusta (no hay whitelist frágil de columnas esperadas; el NOTICE
-- deja traza visible de QUÉ filas quedaron grandfathereadas, para auditoría).
--
-- text  → CHECK (char_length(col) <= N)            (cuenta CARACTERES, correcto para UTF-8/acentos)
-- jsonb → CHECK (octet_length(col::text) <= N)     (tope de BYTES del serializado; mismo patrón que
--                                                   sessions.config / maneuver_presets.config 0050/0051)
--
-- EXCLUIDAS (R1.48, justificación en requirements §R1.48 / design §Excluidas):
--   - enums / selectores cerrados / numéricos / date / time / boolean / *_status.
--   - jsonb YA topados: sessions.config, maneuver_presets.config (0050/0051) — no se duplica.
--   - push_tokens.platform (ya CHECK de enum).
--   - catálogos globales read-only sin grant de escritura a authenticated
--     (species, systems_by_species, categories_by_system, field_definitions, system_default_fields).
--   - animal_profiles.exit_reason (enum, 0044).
--
-- tag_electronic / calf_tag_electronic (R1.49): SOLO techo de largo (64), NO CHECK de formato
-- 15 díg FDX-B (acoplaría el schema a un formato variable y arriesga el import masivo futuro).
-- La INMUTABILIDAD de animals.tag_electronic ya la cubre el trigger animals_block_tag_change
-- (0036) — ese es el control de integridad relevante, no el formato.
--
-- ⚠️ TECHO DE TAG SUBIDO 32 → 64 (decisión de Raf, 2026-06-05): las DOS columnas de tag
-- (animals.tag_electronic + reproductive_events.calf_tag_electronic) pasan de 32 a 64. RAZÓN:
-- la convención de fixtures de test (`animal_test_<timestamp>_<rand>_<SUFFIX>`) produce tags
-- sintéticos de hasta ~45 chars → el tope de 32 rompía 7 tests de la suite de spec 02. 64 los
-- acomoda y SIGUE capeando abuso real (un FDX-B real son 15 díg; 64 no permite payloads multi-KB
-- de storage-exhaustion). Ningún OTRO techo cambia (user_private.phone sigue 32, email 320, etc.).
-- Ambas siguen NOT VALID SIN validate (grandfather de la data legada de e2e — ver abajo).
--
-- NO se reabren las migrations viejas (0001/0002/0019/0020/0034/etc.): todo es ALTER en migración
-- nueva. NO aplicada al remoto por el implementer (deploy gateado por el leader).

-- ─── Pre-check de datos legados (R1.46): aborta VISIBLE si hay filas fuera de rango ───
do $$
declare
  v_n bigint;
  v_msg text := '';
begin
  -- text caps
  select count(*) into v_n from public.users where char_length(name) > 120;            if v_n > 0 then v_msg := v_msg || format('users.name: %s; ', v_n); end if;
  select count(*) into v_n from public.user_private where char_length(email) > 320;    if v_n > 0 then v_msg := v_msg || format('user_private.email: %s; ', v_n); end if;
  select count(*) into v_n from public.user_private where char_length(phone) > 32;     if v_n > 0 then v_msg := v_msg || format('user_private.phone: %s; ', v_n); end if;
  select count(*) into v_n from public.establishments where char_length(name) > 160;       if v_n > 0 then v_msg := v_msg || format('establishments.name: %s; ', v_n); end if;
  select count(*) into v_n from public.establishments where char_length(province) > 96;     if v_n > 0 then v_msg := v_msg || format('establishments.province: %s; ', v_n); end if;
  select count(*) into v_n from public.establishments where char_length(city) > 96;         if v_n > 0 then v_msg := v_msg || format('establishments.city: %s; ', v_n); end if;
  select count(*) into v_n from public.establishments where char_length(plan_type) > 64;    if v_n > 0 then v_msg := v_msg || format('establishments.plan_type: %s; ', v_n); end if;
  select count(*) into v_n from public.invitations where char_length(email) > 320;    if v_n > 0 then v_msg := v_msg || format('invitations.email: %s; ', v_n); end if;
  select count(*) into v_n from public.invitations where char_length(token) > 512;    if v_n > 0 then v_msg := v_msg || format('invitations.token: %s; ', v_n); end if;
  select count(*) into v_n from public.push_tokens where char_length(token) > 512;     if v_n > 0 then v_msg := v_msg || format('push_tokens.token: %s; ', v_n); end if;
  select count(*) into v_n from public.push_tokens where char_length(device_id) > 160; if v_n > 0 then v_msg := v_msg || format('push_tokens.device_id: %s; ', v_n); end if;
  select count(*) into v_n from public.rodeos where char_length(name) > 120;          if v_n > 0 then v_msg := v_msg || format('rodeos.name: %s; ', v_n); end if;
  select count(*) into v_n from public.animals where char_length(tag_electronic) > 64; if v_n > 0 then v_msg := v_msg || format('animals.tag_electronic: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_profiles where char_length(idv) > 64;            if v_n > 0 then v_msg := v_msg || format('animal_profiles.idv: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_profiles where char_length(visual_id_alt) > 64;  if v_n > 0 then v_msg := v_msg || format('animal_profiles.visual_id_alt: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_profiles where char_length(breed) > 64;          if v_n > 0 then v_msg := v_msg || format('animal_profiles.breed: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_profiles where char_length(coat_color) > 64;     if v_n > 0 then v_msg := v_msg || format('animal_profiles.coat_color: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_profiles where char_length(entry_origin) > 120;  if v_n > 0 then v_msg := v_msg || format('animal_profiles.entry_origin: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_profiles where char_length(notes) > 4000;        if v_n > 0 then v_msg := v_msg || format('animal_profiles.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.weight_events where char_length(notes) > 4000;          if v_n > 0 then v_msg := v_msg || format('weight_events.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.semen_registry where char_length(pajuela_name) > 120;   if v_n > 0 then v_msg := v_msg || format('semen_registry.pajuela_name: %s; ', v_n); end if;
  select count(*) into v_n from public.semen_registry where char_length(bull_name) > 120;      if v_n > 0 then v_msg := v_msg || format('semen_registry.bull_name: %s; ', v_n); end if;
  select count(*) into v_n from public.semen_registry where char_length(breed) > 64;           if v_n > 0 then v_msg := v_msg || format('semen_registry.breed: %s; ', v_n); end if;
  select count(*) into v_n from public.semen_registry where char_length(supplier) > 160;       if v_n > 0 then v_msg := v_msg || format('semen_registry.supplier: %s; ', v_n); end if;
  select count(*) into v_n from public.semen_registry where char_length(notes) > 4000;         if v_n > 0 then v_msg := v_msg || format('semen_registry.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.reproductive_events where char_length(notes) > 4000;             if v_n > 0 then v_msg := v_msg || format('reproductive_events.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.reproductive_events where char_length(calf_tag_electronic) > 64; if v_n > 0 then v_msg := v_msg || format('reproductive_events.calf_tag_electronic: %s; ', v_n); end if;
  select count(*) into v_n from public.sanitary_events where char_length(product_name) > 160;      if v_n > 0 then v_msg := v_msg || format('sanitary_events.product_name: %s; ', v_n); end if;
  select count(*) into v_n from public.sanitary_events where char_length(active_ingredient) > 160; if v_n > 0 then v_msg := v_msg || format('sanitary_events.active_ingredient: %s; ', v_n); end if;
  select count(*) into v_n from public.sanitary_events where char_length(result) > 4000;           if v_n > 0 then v_msg := v_msg || format('sanitary_events.result: %s; ', v_n); end if;
  select count(*) into v_n from public.sanitary_events where char_length(notes) > 4000;            if v_n > 0 then v_msg := v_msg || format('sanitary_events.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.condition_score_events where char_length(notes) > 4000;     if v_n > 0 then v_msg := v_msg || format('condition_score_events.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.lab_samples where char_length(tube_number) > 64;            if v_n > 0 then v_msg := v_msg || format('lab_samples.tube_number: %s; ', v_n); end if;
  select count(*) into v_n from public.lab_samples where char_length(lab_destination) > 160;       if v_n > 0 then v_msg := v_msg || format('lab_samples.lab_destination: %s; ', v_n); end if;
  select count(*) into v_n from public.lab_samples where char_length(result) > 4000;               if v_n > 0 then v_msg := v_msg || format('lab_samples.result: %s; ', v_n); end if;
  select count(*) into v_n from public.lab_samples where char_length(result_interpretation) > 4000; if v_n > 0 then v_msg := v_msg || format('lab_samples.result_interpretation: %s; ', v_n); end if;
  select count(*) into v_n from public.lab_samples where char_length(notes) > 4000;                if v_n > 0 then v_msg := v_msg || format('lab_samples.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_events where char_length(text) > 4000;               if v_n > 0 then v_msg := v_msg || format('animal_events.text: %s; ', v_n); end if;
  select count(*) into v_n from public.management_groups where char_length(name) > 120;            if v_n > 0 then v_msg := v_msg || format('management_groups.name: %s; ', v_n); end if;
  select count(*) into v_n from public.sessions where char_length(work_lot_label) > 120;           if v_n > 0 then v_msg := v_msg || format('sessions.work_lot_label: %s; ', v_n); end if;
  select count(*) into v_n from public.sessions where char_length(notes) > 4000;                   if v_n > 0 then v_msg := v_msg || format('sessions.notes: %s; ', v_n); end if;
  select count(*) into v_n from public.maneuver_presets where char_length(name) > 120;             if v_n > 0 then v_msg := v_msg || format('maneuver_presets.name: %s; ', v_n); end if;
  -- jsonb byte caps
  select count(*) into v_n from public.establishments where octet_length(plan_limits::text) > 16384; if v_n > 0 then v_msg := v_msg || format('establishments.plan_limits: %s; ', v_n); end if;
  select count(*) into v_n from public.rodeo_data_config where octet_length(custom_config::text) > 16384; if v_n > 0 then v_msg := v_msg || format('rodeo_data_config.custom_config: %s; ', v_n); end if;
  select count(*) into v_n from public.animal_events where octet_length(structured_payload::text) > 32768; if v_n > 0 then v_msg := v_msg || format('animal_events.structured_payload: %s; ', v_n); end if;

  if v_msg <> '' then
    raise notice 'INPUT-1 (0070): filas legadas fuera de rango (informativo, NO aborta) -> %', v_msg;
  end if;
end $$;

-- ─── R1.1: users (email/phone movidos a user_private por 0068/feature 14 → ya no en users) ───
alter table public.users add constraint users_name_len_chk check (char_length(name) <= 120) not valid;
alter table public.users validate constraint users_name_len_chk;

-- ─── R1.2–R1.3: user_private (PII de contacto separada de users por 0068/feature 14) ───
alter table public.user_private add constraint user_private_email_len_chk check (char_length(email) <= 320) not valid;
alter table public.user_private validate constraint user_private_email_len_chk;
alter table public.user_private add constraint user_private_phone_len_chk check (char_length(phone) <= 32)  not valid;
alter table public.user_private validate constraint user_private_phone_len_chk;

-- ─── R1.4–R1.8: establishments (name/province/city/plan_type text; plan_limits jsonb) ───
alter table public.establishments add constraint establishments_name_len_chk      check (char_length(name)      <= 160) not valid;
alter table public.establishments validate constraint establishments_name_len_chk;
alter table public.establishments add constraint establishments_province_len_chk  check (char_length(province)  <= 96)  not valid;
alter table public.establishments validate constraint establishments_province_len_chk;
alter table public.establishments add constraint establishments_city_len_chk      check (char_length(city)      <= 96)  not valid;
alter table public.establishments validate constraint establishments_city_len_chk;
alter table public.establishments add constraint establishments_plan_type_len_chk check (char_length(plan_type) <= 64)  not valid;
alter table public.establishments validate constraint establishments_plan_type_len_chk;
alter table public.establishments add constraint establishments_plan_limits_size_chk check (octet_length(plan_limits::text) <= 16384) not valid;
alter table public.establishments validate constraint establishments_plan_limits_size_chk;

-- ─── R1.9–R1.10: invitations ───
alter table public.invitations add constraint invitations_email_len_chk check (char_length(email) <= 320) not valid;
alter table public.invitations validate constraint invitations_email_len_chk;
alter table public.invitations add constraint invitations_token_len_chk check (char_length(token) <= 512) not valid;
alter table public.invitations validate constraint invitations_token_len_chk;

-- ─── R1.11–R1.12: push_tokens (platform ya CHECK-enum → excluida) ───
alter table public.push_tokens add constraint push_tokens_token_len_chk     check (char_length(token)     <= 512) not valid;
alter table public.push_tokens validate constraint push_tokens_token_len_chk;
alter table public.push_tokens add constraint push_tokens_device_id_len_chk check (char_length(device_id) <= 160) not valid;
alter table public.push_tokens validate constraint push_tokens_device_id_len_chk;

-- ─── R1.13: rodeos ───
alter table public.rodeos add constraint rodeos_name_len_chk check (char_length(name) <= 120) not valid;
alter table public.rodeos validate constraint rodeos_name_len_chk;

-- ─── R1.14: rodeo_data_config (custom_config jsonb) ───
alter table public.rodeo_data_config add constraint rodeo_data_config_custom_config_size_chk check (octet_length(custom_config::text) <= 16384) not valid;
alter table public.rodeo_data_config validate constraint rodeo_data_config_custom_config_size_chk;

-- ─── R1.15: animals (tag_electronic; sex ya CHECK-enum → excluida). Solo largo, NO formato (R1.49). ───
-- ⚠️ NOT VALID SIN VALIDATE (grandfather de basura e2e): hay filas legadas de e2e con
--    tag_electronic sintético de hasta ~45 chars (ej. `animal_test_..._DUPCALF`). Tags REALES
--    son 15 díg (FDX-B), bien bajo el tope de 64. Un CHECK `NOT VALID` IGUAL enforça TODOS los
--    INSERT/UPDATE futuros (Postgres solo saltea la validación de las filas EXISTENTES) → el
--    objetivo de seguridad de INPUT-1 (capear input de usuario de acá en más) se cumple con
--    NOT VALID solo. El `validate constraint` es solo re-chequeo retroactivo de filas viejas, y
--    ahí la basura de e2e lo bloquearía sin aportar seguridad. Se omite a propósito (ver header).
alter table public.animals add constraint animals_tag_electronic_len_chk check (char_length(tag_electronic) <= 64) not valid;

-- ─── R1.16–R1.21: animal_profiles (exit_reason enum 0044 → excluida; breed techo INTERINO 64) ───
alter table public.animal_profiles add constraint animal_profiles_idv_len_chk           check (char_length(idv)           <= 64)   not valid;
alter table public.animal_profiles validate constraint animal_profiles_idv_len_chk;
alter table public.animal_profiles add constraint animal_profiles_visual_id_alt_len_chk check (char_length(visual_id_alt) <= 64)   not valid;
alter table public.animal_profiles validate constraint animal_profiles_visual_id_alt_len_chk;
alter table public.animal_profiles add constraint animal_profiles_breed_len_chk         check (char_length(breed)         <= 64)   not valid;
alter table public.animal_profiles validate constraint animal_profiles_breed_len_chk;
alter table public.animal_profiles add constraint animal_profiles_coat_color_len_chk    check (char_length(coat_color)    <= 64)   not valid;
alter table public.animal_profiles validate constraint animal_profiles_coat_color_len_chk;
alter table public.animal_profiles add constraint animal_profiles_entry_origin_len_chk  check (char_length(entry_origin)  <= 120)  not valid;
alter table public.animal_profiles validate constraint animal_profiles_entry_origin_len_chk;
alter table public.animal_profiles add constraint animal_profiles_notes_len_chk         check (char_length(notes)         <= 4000) not valid;
alter table public.animal_profiles validate constraint animal_profiles_notes_len_chk;

-- ─── R1.22: weight_events ───
alter table public.weight_events add constraint weight_events_notes_len_chk check (char_length(notes) <= 4000) not valid;
alter table public.weight_events validate constraint weight_events_notes_len_chk;

-- ─── R1.23–R1.27: semen_registry ───
alter table public.semen_registry add constraint semen_registry_pajuela_name_len_chk check (char_length(pajuela_name) <= 120)  not valid;
alter table public.semen_registry validate constraint semen_registry_pajuela_name_len_chk;
alter table public.semen_registry add constraint semen_registry_bull_name_len_chk    check (char_length(bull_name)    <= 120)  not valid;
alter table public.semen_registry validate constraint semen_registry_bull_name_len_chk;
alter table public.semen_registry add constraint semen_registry_breed_len_chk        check (char_length(breed)        <= 64)   not valid;
alter table public.semen_registry validate constraint semen_registry_breed_len_chk;
alter table public.semen_registry add constraint semen_registry_supplier_len_chk     check (char_length(supplier)     <= 160)  not valid;
alter table public.semen_registry validate constraint semen_registry_supplier_len_chk;
alter table public.semen_registry add constraint semen_registry_notes_len_chk        check (char_length(notes)        <= 4000) not valid;
alter table public.semen_registry validate constraint semen_registry_notes_len_chk;

-- ─── R1.28–R1.29: reproductive_events (calf_sex/service_type/etc. enum → excluidas) ───
alter table public.reproductive_events add constraint reproductive_events_notes_len_chk               check (char_length(notes)               <= 4000) not valid;
alter table public.reproductive_events validate constraint reproductive_events_notes_len_chk;
-- ⚠️ NOT VALID SIN VALIDATE (grandfather de basura e2e): filas legadas de e2e con
--    calf_tag_electronic sintético de hasta ~45 chars (mismo origen que animals.tag_electronic).
--    NOT VALID igual enforça los INSERT/UPDATE futuros (seguridad INPUT-1 cubierta); el validate
--    solo re-chequea filas viejas y lo bloquearía la basura de e2e. Se omite a propósito.
alter table public.reproductive_events add constraint reproductive_events_calf_tag_electronic_len_chk check (char_length(calf_tag_electronic) <= 64)   not valid;

-- ─── R1.30–R1.33: sanitary_events (event_type/route enum → excluidas) ───
alter table public.sanitary_events add constraint sanitary_events_product_name_len_chk      check (char_length(product_name)      <= 160)  not valid;
alter table public.sanitary_events validate constraint sanitary_events_product_name_len_chk;
alter table public.sanitary_events add constraint sanitary_events_active_ingredient_len_chk check (char_length(active_ingredient) <= 160)  not valid;
alter table public.sanitary_events validate constraint sanitary_events_active_ingredient_len_chk;
alter table public.sanitary_events add constraint sanitary_events_result_len_chk            check (char_length(result)            <= 4000) not valid;
alter table public.sanitary_events validate constraint sanitary_events_result_len_chk;
alter table public.sanitary_events add constraint sanitary_events_notes_len_chk             check (char_length(notes)             <= 4000) not valid;
alter table public.sanitary_events validate constraint sanitary_events_notes_len_chk;

-- ─── R1.34: condition_score_events (score numeric-CHECK → excluida) ───
alter table public.condition_score_events add constraint condition_score_events_notes_len_chk check (char_length(notes) <= 4000) not valid;
alter table public.condition_score_events validate constraint condition_score_events_notes_len_chk;

-- ─── R1.35–R1.39: lab_samples (sample_type enum → excluida) ───
alter table public.lab_samples add constraint lab_samples_tube_number_len_chk           check (char_length(tube_number)           <= 64)   not valid;
alter table public.lab_samples validate constraint lab_samples_tube_number_len_chk;
alter table public.lab_samples add constraint lab_samples_lab_destination_len_chk       check (char_length(lab_destination)       <= 160)  not valid;
alter table public.lab_samples validate constraint lab_samples_lab_destination_len_chk;
alter table public.lab_samples add constraint lab_samples_result_len_chk                check (char_length(result)                <= 4000) not valid;
alter table public.lab_samples validate constraint lab_samples_result_len_chk;
alter table public.lab_samples add constraint lab_samples_result_interpretation_len_chk check (char_length(result_interpretation) <= 4000) not valid;
alter table public.lab_samples validate constraint lab_samples_result_interpretation_len_chk;
alter table public.lab_samples add constraint lab_samples_notes_len_chk                 check (char_length(notes)                 <= 4000) not valid;
alter table public.lab_samples validate constraint lab_samples_notes_len_chk;

-- ─── R1.40–R1.41: animal_events (event_type enum → excluida; structured_payload jsonb) ───
alter table public.animal_events add constraint animal_events_text_len_chk check (char_length(text) <= 4000) not valid;
alter table public.animal_events validate constraint animal_events_text_len_chk;
alter table public.animal_events add constraint animal_events_structured_payload_size_chk check (octet_length(structured_payload::text) <= 32768) not valid;
alter table public.animal_events validate constraint animal_events_structured_payload_size_chk;

-- ─── R1.42: management_groups ───
alter table public.management_groups add constraint management_groups_name_len_chk check (char_length(name) <= 120) not valid;
alter table public.management_groups validate constraint management_groups_name_len_chk;

-- ─── R1.43–R1.44: sessions (config jsonb YA topado 0050 → excluida) ───
alter table public.sessions add constraint sessions_work_lot_label_len_chk check (char_length(work_lot_label) <= 120)  not valid;
alter table public.sessions validate constraint sessions_work_lot_label_len_chk;
alter table public.sessions add constraint sessions_notes_len_chk          check (char_length(notes)          <= 4000) not valid;
alter table public.sessions validate constraint sessions_notes_len_chk;

-- ─── R1.45: maneuver_presets (config jsonb YA topado 0051 → excluida) ───
alter table public.maneuver_presets add constraint maneuver_presets_name_len_chk check (char_length(name) <= 120) not valid;
alter table public.maneuver_presets validate constraint maneuver_presets_name_len_chk;

notify pgrst, 'reload schema';
