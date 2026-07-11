# Gate 2 (security_analyzer modo `code`) — feature E · TRATAMIENTOS EN LA FICHA

**Veredicto: PASS — 0 findings HIGH.** Los 5 controles del Gate 1 (SEC-TRT-01..04 + LOW-1) implementados fielmente; los 8 puntos de superficie verifican. (Reporte inline del analyzer; persistido por el leader.)

## Verificación (8 puntos)
1. **SEC-TRT-01** inmutabilidad: `tg_treatments_immutable_columns` (0123) pinnea a OLD todo salvo `ended_at` NULL→ts (y ya-seteado inmutable); `establishment_id`+`animal_profile_id` juntos → consistente en cualquier orden de trigger. No SECURITY DEFINER.
2. **SEC-TRT-02** CHECKs 120/1000/not_empty = constantes del cliente (`treatment-input.ts`).
3. **SEC-TRT-03** `tg_sanitary_events_treatment_check` `before insert or update` incondicional, security definer, 23503/23514; cubre UPDATE de animal_profile_id.
4. **SEC-TRT-04** revoke execute en las 3 security-definer.
5. **LOW-1** short-circuit `treatment_id NOT NULL AND event_type <> 'vaccination'`; rama de maniobra **byte-idéntica a 0091** (verificado como cuerpo vigente); vaccination+treatment_id sigue gateado.
6. **RLS** tenant de `has_role_in(establishment_of_profile(...))`, fail-closed, sin DELETE; grants sin delete a authenticated.
7. **Anti-spoof** force establishment_id (0077, INSERT+UPDATE) + created_by (0043, INSERT).
8. **Stream** `ev_treatments` scope establishment + deleted_at IS NULL, JOIN-free.
Writes CRUD-plano 100% parametrizados; sin mass assignment; no fabrican establishment_id/created_by.

## ⚠️ Observación NON-SECURITY (reliability) — EN FIX
`TREATMENT_ROUTE_OPTIONS` ofrece `intravenous`, pero el enum `sanitary_route` (0027/0090) = {intramuscular, subcutaneous, oral, topical, other, intranasal} NO lo tiene → seleccionar "Intravenosa" escribe local OK pero Postgres rechaza al sync (poison-pill potencial en la cola). Fail-closed desde seguridad, pero bug funcional. **Fix en curso** (implementer E: alinear el selector al enum, quitar intravenous). NO afecta el PASS de seguridad.

## Inputs (todos con barrera server-side)
product_name ≤120 not-empty, notes ≤1000, dose numeric(7,2)>0, route enum, next_dose_date date, kind enum. Rate limits: N/A (writes locales→outbox, sin fan-out/externa).
