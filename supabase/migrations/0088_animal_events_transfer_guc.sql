-- 0088_animal_events_transfer_guc.sql  (spec 11 — transferencia-animal, T1.12 / DEC-A1)
--
-- DELTA sobre el trigger tg_animal_events_enforce_edit_window (0034 de spec 02). El re-parenting de la
-- transferencia (RPC transfer_animal, 0087) necesita re-apuntar las observaciones (`animal_events`) del
-- perfil viejo (X) al nuevo (Y), cambiando `animal_profile_id` Y `establishment_id`. Pero ese trigger
-- declara AMBAS columnas INMUTABLES en UPDATE → bloquearía el re-apuntado con
-- 'immutable column changed on animal_event' (design §4.3).
--
-- RESOLUCIÓN (DEC-A1, recomendada y confirmada en Gate 1): early-return por GUC. El RPC transfer_animal
-- (SECURITY DEFINER) setea una GUC LOCAL `rafaq.is_transfer = 'on'` antes de re-apuntar animal_events y la
-- apaga después; el trigger hace `return new` temprano cuando esa GUC está 'on'. Así:
--   - el re-apuntado del DEFINER pasa (la GUC está 'on' dentro de su transacción);
--   - un UPDATE de cliente directo a PostgREST SIGUE BLOQUEADO: la GUC solo la puede setear el RPC
--     (set_config con scope transaccional `is_local=true`), un cliente no puede setearla dentro de la
--     transacción del trigger → cae en el camino de inmutabilidad as-built.
-- Mismo patrón EXACTO que `rafaq.is_auto_transition` (apply_auto_transition 0031): set_config(..., true)
-- local + current_setting(..., true) con missing_ok. No se relaja la inmutabilidad para clientes; el
-- vector de spoofeo que el trigger cierra (cambiar el tenant de una observación por UPDATE directo,
-- denorm load-bearing para el wire de sync) SIGUE cerrado.
--
-- CREATE OR REPLACE de la FUNCIÓN del trigger (NO se re-crea el trigger ni se toca 0034 in-place: las
-- migraciones son append-only). El cuerpo es idéntico al 0034 salvo el early-return inicial.
--
-- Reconciliación de specs: `specs/active/02-modelo-animal/design.md` se actualiza con este delta (T5.1).
--
-- NO aplicar al remoto desde acá: lo aplica el leader/implementer por Management API (apply_migration)
-- tras gatear el SQL. Hasta entonces el re-apuntado de animal_events de transfer_animal FALLARÍA con el
-- error de inmutabilidad → la suite transfer_animal RPC depende de ESTE delta + 0087.

begin;

-- Re-emisión de tg_animal_events_enforce_edit_window (0034) con early-return por GUC al inicio.
-- El resto del cuerpo es IDÉNTICO al as-built (0034:66-86).
create or replace function public.tg_animal_events_enforce_edit_window ()
returns trigger language plpgsql as $$
begin
  -- (delta spec 11) Contexto de transferencia: el RPC transfer_animal (SECURITY DEFINER) re-apunta la
  -- observación al perfil nuevo en Y cambiando animal_profile_id + establishment_id. Esa es la ÚNICA vía
  -- legítima de mover esas columnas inmutables. El RPC setea la GUC local 'rafaq.is_transfer'='on'; un
  -- cliente directo a PostgREST no puede setearla dentro de la transacción del trigger → sigue bloqueado.
  if coalesce(current_setting('rafaq.is_transfer', true), 'off') = 'on' then
    return new;
  end if;

  if now() > old.edit_window_until then
    if new.text is distinct from old.text
       or new.structured_payload is distinct from old.structured_payload
       or new.event_type is distinct from old.event_type then
      raise exception 'edit window expired for animal_event %', old.id
        using errcode = '23514';
    end if;
  end if;
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

comment on function public.tg_animal_events_enforce_edit_window is
  'BEFORE UPDATE de animal_events: rechaza editar text/payload/event_type pasada la ventana e inmuta '
  'author_id/animal_profile_id/establishment_id/created_at/edit_window_until. DELTA spec 11 (0088): '
  'early-return cuando la GUC local rafaq.is_transfer=''on'' (la setea SOLO el RPC transfer_animal '
  'SECURITY DEFINER para re-apuntar la observación a Y; un cliente directo no puede setearla → sigue '
  'bloqueado). Mismo patrón que rafaq.is_auto_transition (0031).';

notify pgrst, 'reload schema';

commit;
