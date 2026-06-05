# Gate 2 (code) — Spec 02 Tier 2/3 backend: modelo de categorías de cría (migraciones 0059-0067)

**Veredicto: PASS** (0 findings HIGH-confidence) · **Fecha**: 2026-06-04 · **Gate**: ADR-019, modo `code`.
**Skill**: `sentry-skills:security-review` + revisión manual del PL/pgSQL/RLS/`pg_cron` contra el modelo de amenaza RAFAQ y los precedentes `0042`/`0055`/`0022` (la skill no cubre PL/pgSQL nativamente; declarado).
**Reporte materializado por el leader** (el security_analyzer no pudo escribir por restricción de entorno; contenido fiel a su auditoría).

**Scope**: `supabase/migrations/0059`→`0067` + tests `supabase/tests/animal/run.cjs` (T2.31, T2.33). **Fuera de scope** (otras terminales): `0068_user_private_pii.sql`, `config.toml`, edge functions, feature 13/14.

## Resumen
- Findings: **0** (0 Critical, 0 High). Risk: Low. Confidence: High.
- La implementación concuerda con el diseño gateado en Gate 1 (spec). Los 2 controles críticos están presentes, correctos y **fail-closed**.

## Modelo de amenaza — confirmación punto por punto

1. **`refresh_age_categories()` (0066) — SEC-SPEC-M02 CERRADO.** Retorna `void` + `SECURITY DEFINER` + muta `category_id` cross-tenant (recorre todos los `animal_profiles` por diseño). **Revoke presente y correcto** (`0066:55`, `from public, authenticated, anon`) + **smoke-check fail-closed** (`0066:63-79`: `has_function_privilege` × 3 roles cliente → `raise exception` → la migración FALLA si quedó execute-able). Sin params → sin spoofing de `profile_id`.
   - **D2 (`grant ... to service_role`, `0066:59`) — SEGURA**: `service_role` es admin server-side (nunca va al browser, ya bypassea RLS) → no agrega capacidad ofensiva a un atacante cliente. El smoke-check chequea solo `public/authenticated/anon` (el conjunto que constituye el control). Separación correcta verificada en T2.33 (`run.cjs:1807-1808` authenticated→error; `:1827` admin ejercita el efecto).
2. **`apply_auto_transition` sigue revocada (SEC-HIGH-01 NO reintroducido).** Ninguna migración 0059-0067 la re-grantea; `0065` re-emite el revoke + smoke-check. La invocan solo triggers SECURITY DEFINER (corren como owner). T2.18 + T2.31 verifican que authenticated recibe error.
3. **`compute_category` reescrita (0062)** — `SECURITY DEFINER STABLE`, deriva del `profile_id` (joins), lectura pura (sin UPDATE/INSERT), sin camino cross-tenant nuevo. `grant to authenticated` benigno (devuelve un `category_id` del catálogo compartido, no PII; no es IDOR — read-only; mismo patrón as-built 0031).
4. **Triggers nuevos (0061/0063/0064/0067)** — todos derivan el perfil/madre de la **fila real** (`new.id`/`new.animal_profile_id`/`new.birth_event_id`/birth_calves), nunca de params del cliente; la RLS de animals/reproductive_events ya filtró el evento disparador. Funciones-trigger (retornan `trigger`, no expuestas por PostgREST) revocadas nominalmente + smoke-check (M01). `0064` solo false→true + respeta override; `0063` filtra event_types + respeta override.
5. **`compute_nursing` (0061)** — lectura pura; el UPDATE de `nursing` (trigger) es ortogonal a `category_id` (guard `is distinct from`; no gatilla override 0021/0040 ni dientes/CUT 0054).
6. **`is_castrated` (0060)** — columna en `animals`, hereda RLS de `0022` sin policy nueva; default false (ningún perfil migra por el ADD COLUMN). T2.31 confirma cross-tenant bloqueado.
7. **Tests no-spoof (T2.31/T2.33)** existen y verifican lo correcto (apply_auto_transition + refresh_age_categories no invocables por authenticated; is_castrated cross-tenant bloqueado por RLS).

## Needs verification
Ninguno. (Los smoke-check fail-closed de 0065/0066 son verificación en tiempo de aplicación; el implementer confirmó que pasaron sin excepción al aplicar al remoto.)

## Notas (no findings)
- **0067** (fix mellizos, fuera del plan de tasks, autorrevisión): backend en alcance (RT2.9.1), revocado, sin GRANT INSERT cliente a `birth_calves`. Sin impacto de seguridad.
- **Aplicación vía Management API** (no CLI): corre como owner `postgres`, efecto equivalente a `db push`; los `.sql` del repo son la fuente de verdad auditada.
