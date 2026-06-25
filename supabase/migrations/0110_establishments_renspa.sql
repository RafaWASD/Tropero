-- 0110_establishments_renspa.sql  (spec 08 — export SIGSA, T4 / R2.1, R2.2, R2.3)
-- Delta cross-spec sobre establishments (spec 01, tabla creada en 0002). Agrega el campo RENSPA
-- (Registro Nacional Sanitario de Productores Agropecuarios) como recordatorio en pantalla al
-- momento de exportar. El RENSPA NO va en el TXT (R2.4): solo lo completa el productor en SIGSA web.
--
-- ✅ DECISIÓN 3 CERRADA (Raf, 2026-06-24): texto OPCIONAL, SIN constraint de unicidad de ningún tipo.
-- NO se crea índice unique (ni global ni por-dueño). El unique global causaba colisión + fuga de
-- existencia cross-tenant (LOW-4 de Gate 1) en casos legítimos (venta del campo, contador+dueño), y
-- el RENSPA ni va en el TXT. La unicidad como señal anti-fraude queda POST-MVP, atada a la
-- cardinalidad real del RENSPA (Facundo). Ver requirements.md §"Decisiones abiertas" #3.
--
-- ESCRITURA OWNER-ONLY (R2.3, MEDIUM-1 de Gate 1): se canaliza por la RPC update_renspa SECURITY
-- DEFINER (mismo patrón que soft_delete_rodeo, 0041) que verifica is_owner_of server-side. NO se crea
-- una policy UPDATE nueva más permisiva: la policy existente establishments_update (0007,
-- is_owner_of(id) en USING y WITH CHECK) YA bloquea cualquier UPDATE directo de la tabla a no-owners
-- (un veterinarian/field_operator que intente UPDATE de renspa vía PostgREST recibe 42501). La RPC es
-- la puerta de UI recomendada; el UPDATE directo ya está cubierto por esa policy.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS antes del ADD CONSTRAINT +
-- CREATE OR REPLACE de la RPC.

-- ── (1) Columna renspa (text, nullable, SIN unique) ────────────────────────────────────────
alter table public.establishments
  add column if not exists renspa text;

comment on column public.establishments.renspa is
  'RENSPA del establecimiento (recordatorio para SIGSA web, R2.1). text nullable SIN unique '
  '(decisión 3, 2026-06-24): el RENSPA no va en el TXT (R2.4) y el unique causaba colisión '
  'cross-tenant. Escritura owner-only vía RPC update_renspa.';

-- ── (2) Validación de longitud server-side (única validación de renspa en MVP, R2.2) ────────
-- string no vacío de hasta 20 chars. Patrón de CHECK de largo server-side (0070). char_length
-- cuenta CARACTERES (correcto para UTF-8). Mantiene NULL como válido (campo opcional).
alter table public.establishments
  drop constraint if exists chk_establishments_renspa_length;
alter table public.establishments
  add constraint chk_establishments_renspa_length
  check (renspa is null or (char_length(trim(renspa)) > 0 and char_length(renspa) <= 20));

-- ── (3) RPC update_renspa (owner-gate, R2.3, MEDIUM-1) ─────────────────────────────────────
-- Mismo patrón que soft_delete_rodeo (0041): guard is_owner_of + UPDATE por dentro (SECURITY
-- DEFINER). is_owner_of(0005) ya excluye establishments soft-deleted; el UPDATE re-filtra
-- deleted_at IS NULL por defensa. Un caller no-owner (vet/field_operator/outsider) recibe 42501.
create or replace function public.update_renspa (
  p_establishment_id uuid,
  p_renspa           text
)
returns void language plpgsql security definer
set search_path = public as $$
begin
  -- Guard de rol: solo owner (mismo que la policy establishments_update 0007).
  if not public.is_owner_of(p_establishment_id) then
    raise exception 'only owner can update renspa' using errcode = '42501';
  end if;
  update public.establishments
  set renspa = p_renspa
  where id = p_establishment_id and deleted_at is null;
end; $$;

comment on function public.update_renspa(uuid, text) is
  'RPC SECURITY DEFINER: actualiza establishments.renspa; solo owner (R2.3). '
  'Patrón: guard is_owner_of + UPDATE, mismo que soft_delete_rodeo (0041).';

-- Solo authenticated puede ejecutar; revocar a public/anon (default no otorga, pero explícito).
revoke execute on function public.update_renspa(uuid, text) from public, anon;
grant  execute on function public.update_renspa(uuid, text) to authenticated;

notify pgrst, 'reload schema';
