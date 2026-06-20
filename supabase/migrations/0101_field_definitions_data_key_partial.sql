-- 0101_field_definitions_data_key_partial.sql  (spec 03 — MODO MANIOBRAS, chunk M7 / US-13)
-- ⚠️ TOCA EL UNIQUE de un catálogo con RLS reabierta en 0093 (field_definitions) → reabre el Gate de
--    seguridad de schema (security modo `spec`). NO crea/cambia RLS ni policies; solo el predicado del índice.
--
-- PORQUÉ (hallazgo del reviewer M7, progress/review_03-m7.md — HIGH):
--   El índice UNIQUE custom `field_definitions_data_key_per_est` (0093 l.40-41) se creó como
--     ON (establishment_id, data_key) WHERE establishment_id IS NOT NULL
--   La cláusula WHERE solo discrimina las filas CUSTOM de las globales — NO excluye las soft-deleteadas.
--   Como `softDeleteCustomField` (R13.28) hace `UPDATE … SET deleted_at = now()` MANTENIENDO
--   `establishment_id` + `data_key`, la fila borrada SIGUE ocupando su slot `(establishment_id, data_key)`
--   en el índice. Entonces el flujo SANCIONADO por R13.26 ("la corrección de un dato custom mal clasificado
--   se hace por SOFT-DELETE + RECREACIÓN", única vía para re-tipar) ROMPE: al recrear un dato con el mismo
--   label → mismo slug → mismo `data_key` → colisión `23505` contra la fila soft-deleteada al sincronizar.
--   `slugifyDataKey` re-deriva el slug original porque `fetchCustomDataKeys`/`buildCustomDataKeysQuery`
--   filtran `deleted_at IS NULL` (la borrada NO está en `existingDataKeys` → no desambigua). Offline el INSERT
--   local entra y luego el sync lo rebota (descarta el CrudEntry + surface R10.8): el dato NUNCA se recrea.
--
-- FIX: el índice debe ser PARCIAL también sobre `deleted_at` → una fila soft-deleteada LIBERA su slot
--   `(establishment_id, data_key)` para que se pueda recrear el dato con el mismo slug (R13.26). Drop + recreate
--   con el predicado completo `establishment_id IS NOT NULL AND deleted_at IS NULL`.
--
-- SEGURIDAD del cambio:
--   - El otro índice (`field_definitions_data_key_global`, UNIQUE de las globales `establishment_id IS NULL`)
--     queda INTACTO — no se toca acá.
--   - El predicado nuevo es MÁS PERMISIVO (excluye más filas del índice) → no puede violar el unique de filas
--     PRE-existentes que ya cumplían el predicado viejo (todo lo que pasaba sigue pasando; lo que ahora pasa de
--     más son pares (est, key) donde alguna está soft-deleteada). No hay filas custom soft-deleteadas en prod
--     todavía — el borrado custom es justamente lo que M7 recién construye → crear el índice parcial es seguro,
--     sin violaciones preexistentes.
--   - El UPSERT de cliente sigue siendo INSERT plano por PostgREST; el guard `tg_field_definitions_custom_guard`
--     (0093) y la RLS owner-only re-validan al subir. El índice solo define la unicidad efectiva del slot.
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear (re-Gate de schema + reviewer + Gate 2).

begin;

-- Reemplazo del índice custom por uno PARCIAL sobre deleted_at (drop + recreate). `if exists` defensivo por si
-- una corrida previa ya lo hubiera tocado; el nombre es el mismo que 0093 (mantiene la identidad del índice).
drop index if exists public.field_definitions_data_key_per_est;
create unique index field_definitions_data_key_per_est
  on public.field_definitions (establishment_id, data_key)
  where establishment_id is not null and deleted_at is null;

notify pgrst, 'reload schema';

commit;
