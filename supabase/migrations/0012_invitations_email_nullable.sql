-- 0012_invitations_email_nullable.sql
-- Pivot de invitaciones de "email magic link" a "link shareable" (ver ADR-014).
-- El email ya no es obligatorio: el owner crea el link y lo reparte por el canal
-- que prefiera (WhatsApp, mail, copy-paste). Si quiere, puede dejar el email como
-- anotación opcional para reconocer la invitación en su lista de pendientes.
--
-- Los CHECK constraints existentes (`invitations_email_not_empty`, `invitations_email_lower`)
-- se mantienen tal cual: Postgres los evalúa como UNKNOWN cuando el valor es NULL,
-- lo cual satisface el constraint. Solo bloquean strings vacíos o con mayúsculas.

alter table public.invitations alter column email drop not null;

comment on column public.invitations.email is
  'Email del destinatario (opcional, modelo link shareable - ver ADR-014). '
  'Solo anotación para que el owner reconozca la invitación; no se valida al aceptar.';
