-- 0071_animals_update_with_check.sql  (spec 13 — A1-1, R5)
-- Recrea la policy animals_update: el `with check` re-afirma has_role_in sobre algún
-- perfil del animal (ESPEJO del `using`), cerrando el `with check (true)` que hoy NO
-- valida nada post-update. animals es GLOBAL (ADR-004): sin esto, el patrón de la policy
-- queda desalineado con el resto (animal_profiles_update / animal_events_update ya tienen
-- `using == with check`) y, si el `using` se relajara o hubiera un path que lo saltee, el
-- check no atajaría nada. Defensa en profundidad + alineación de patrón (R5.1, R5.4).
--
-- SEMÁNTICA DEL FIX (documentada para Gate 2):
--   - El caso EXPLOTABLE de A1-1 (user con rol SOLO en el campo A muta un animal cuyo
--     ÚNICO perfil está en el campo B) ya lo corta el `using` (no existe perfil del animal
--     donde A tenga rol → 0 filas). El nuevo `with check` lo refuerza simétricamente.
--   - El caso "animal COMPARTIDO A+B, user de A" es acceso LEGÍTIMO por diseño de animals
--     global (el user tiene rol real en A); no lo bloquea ni el using ni el check. Acotar
--     QUÉ columnas puede tocar un co-tenant sería column-level write authz = scope nuevo
--     (SPEC-MED-1, en docs/backlog.md, para la Puerta humana). NO se inventa control acá.
--
-- R5.5 — INMUTABILIDAD de tag_electronic desde el cliente directo (verificado contra
-- 0036_immutability_identifiers.sql): el trigger `animals_block_tag_change` es
-- `before update of tag_electronic on public.animals for each row` → dispara en CUALQUIER
-- UPDATE de esa columna (PostgREST directo del cliente o RPC, no solo el path RPC). Bloquea
-- valor->otro valor y valor->NULL; permite NULL->valor (asignación inicial). Conclusión: el
-- vector "co-tenant reescribe el tag_electronic (EID SENASA) que ve el otro campo" YA está
-- cerrado por 0036 a nivel trigger, independiente de la policy. NO se requiere control
-- adicional (sin hueco detectado → sin escalamiento).
--
-- NO se reabre 0022 (migración nueva, drop+create de la policy). NO aplicada al remoto por
-- el implementer (deploy gateado por el leader).

drop policy if exists animals_update on public.animals;

create policy animals_update on public.animals
  for update using (
    exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id and has_role_in(ap.establishment_id)
    )
  ) with check (
    exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id and has_role_in(ap.establishment_id)
    )
  );

notify pgrst, 'reload schema';
