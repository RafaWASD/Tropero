# Security Code Review — 02-modelo-animal (Gate 2, modo `code`)

**Agente**: security_analyzer (Gate 2). Reporte persistido por el leader (el subagente no tenía tool `Write` en su contexto — ver follow-up de harness).
**Fecha**: 2026-05-28 (sesión 15)
**baseline_commit**: c1cae843d144cd5f663fdbbd9085d2c1aeb2134c
**Alcance**: migrations `0013..0041` (untracked en working tree) + `supabase/tests/animal/run.cjs` + hook en `scripts/run-tests.mjs`. Excluidos los cambios de sesión 15 ajenos a la feature 02.
**Skill**: `sentry-skills:security-review` + checklist RAFAQ-específico.

## Veredicto: FAIL

Un (1) finding HIGH exploitable. El resto del backend (RLS, RPCs de soft-delete, triggers, SQL injection, secrets, scoping multi-tenant) está sólido.

## Findings HIGH

### [SEC-HIGH-01] `apply_auto_transition` — RPC SECURITY DEFINER sin authz, write cross-tenant

- **Location**: `supabase/migrations/0031_category_transitions.sql` (función `apply_auto_transition`)
- **Confidence**: HIGH — CWE-862 (Missing Authorization) / CWE-639 (IDOR)

**Evidencia**: la función es `security definer`, hace `update public.animal_profiles set category_id = target_category_id where id = profile_id` **sin** `has_role_in`/`is_owner_of` ni scoping por `establishment_id`, a diferencia de los 4 RPC de `0041` que sí re-validan.

**Exploitabilidad (verificada)**:
1. `SECURITY DEFINER` ⇒ bypassa RLS; el UPDATE corre como owner del schema.
2. Cero verificación de autorización adentro; escribe directo sobre el `profile_id` del cliente.
3. Reachable como RPC: `supabase/config.toml` expone el schema `public` → PostgREST publica toda función ejecutable por el rol del request.
4. No se revoca EXECUTE: Postgres otorga `EXECUTE TO PUBLIC` por default; el proyecto no hace `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE` ni un `revoke` específico sobre esta función ⇒ `authenticated`/`anon` la pueden invocar vía `POST /rest/v1/rpc/apply_auto_transition`.
5. Resultado: un usuario autenticado del tenant A que conozca un `profile_id` del tenant B puede reescribir la categoría de un animal de otro establecimiento. Viola "multi-tenant desde día 1" y R11.x. Side-effect: el GUC `rafaq.is_auto_transition='on'` hace que el historial (0030) lo registre como `auto_transition` (degrada audit trail). El trigger `tg_animal_profiles_category_check` (0021) limita el target a categorías válidas del system, pero el write cross-tenant igual ocurre.

**Por qué HIGH**: write cross-tenant sin condiciones complejas. El reviewer validó el no-bypass de los RPC de `0041` con tests (T2.9), pero `apply_auto_transition` nunca se evaluó como superficie RPC — era un helper interno del trigger que quedó expuesto.

**Fix recomendado (preferente #1)**:
```sql
revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon;
notify pgrst, 'reload schema';
```
Hardening opcional (sistémico, follow-up): `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public;` + grants explícitos solo a las funciones que el cliente invoca. El modelo actual "expongo todo y reviso caso por caso" fue lo que dejó pasar este agujero.

## False positives descartados / verificaciones que pasaron
1. `tg_animal_profiles_identity_check` (0039 SD) — trigger, lee solo el animal del propio insert, no retorna, no RPC. Safe.
2. `tg_animal_profiles_record_category_change` (0030 SD) — trigger AFTER, no RPC. Safe.
3. 4 `soft_delete_*` (0041 SD) — re-validan la misma authz que la policy de UPDATE, derivan `v_est` de la fila real (no del parámetro), `search_path=public`. No-bypass testeado (T2.9/T2.13/T2.17). Safe.
4. `tg_reproductive_events_create_calf` (0032 SD) — trigger BEFORE, deriva establishment de la madre. Safe.
5. `compute_category` (SD, grant authenticated) — READ-ONLY, retorna UUID de catálogo no sensible. LOW.
6. `establishment_of_profile` (0023 SD) — READ-ONLY, info-disclosure marginal. LOW.
7. `animal_timeline` (0033/0035 SD) — READ-ONLY; cada UNION re-filtra con `has_role_in` (testeado userC 0 filas). Safe.
8. SQL injection — sin `EXECUTE`/`format()`/concatenación dinámica; `soft_delete_event(p_kind)` con allowlist `case`. Safe.
9. `search_path` pinning — verificado `set search_path = public` en TODAS las funciones SECURITY DEFINER. Sin hijacking.
10. Cobertura RLS multi-tenant — toda tabla con `establishment_id` con RLS + policies coherentes con ADR-004; SELECT con `deleted_at is null`; catálogos read-only. Sin tabla sin RLS.
11. `animals_insert/update` (0022) — `animals` es global (ADR-004) sin establishment_id; confidencialidad vía `animals_select` derivado; `tag_electronic` inmutable (trigger 0036). By-design, no cross-tenant.
12. Secrets — ninguno en migrations.
13. GRANTs (0038) — `select,insert,update` (no delete) a authenticated; `grant all` a service_role (esperado, bypassa RLS by design Supabase). El único problema es el `EXECUTE TO PUBLIC` default (cubierto en SEC-HIGH-01).

## Advertencias de cobertura
- La skill NO cubre nativamente Postgres/PL-pgSQL/RLS ni el modelo de exposición RPC de PostgREST. SEC-HIGH-01 se detectó por revisión manual RAFAQ-específica (`schemas=public` ⇒ funciones expuestas + default `EXECUTE TO PUBLIC`).
- PowerSync/offline fuera de alcance (Fase 5). El cambio de soft-delete a RPC (0041) impacta la estrategia offline; documentado en `CONTEXT/07-pendientes.md`. Deuda de diseño, no hueco de seguridad.
- No se ejecutó SQL contra remoto. Para certeza absoluta antes del fix: `select proacl from pg_proc where proname='apply_auto_transition'`.

## Recomendación al leader
FAIL por un finding HIGH puntual y de fix barato. Rebote corto al implementer: `0042_revoke_internal_function_grants.sql` (revoke execute sobre `apply_auto_transition`) + un test que verifique que un `authenticated` sin rol NO puede mover la categoría de un perfil ajeno vía `rpc/apply_auto_transition`. No requiere decisión arquitectónica (el contrato ya define `apply_auto_transition` como helper interno del trigger, R7.7 — solo faltó cerrar la superficie RPC).

## Re-run (fix SEC-HIGH-01) — 2026-05-28

**Veredicto: PASS** — SEC-HIGH-01 cerrado, el fix no introduce superficie nueva. Re-run focalizado (no re-auditoría); el resto del backend ya estaba clear en el Gate 2 previo.

### Verificación
1. **`0042_revoke_internal_function_grants.sql`**: `revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon;` (l.22) + `notify pgrst, 'reload schema';` (l.25). Revoke puro, sin superficie nueva.
2. **Cierre runtime (T2.18)**: `supabase/tests/animal/run.cjs:1048-1083` reproduce el vector exacto — `clientB` (authenticated, rol en estA desactivado vía `user_roles.active=false`) llama `rpc('apply_auto_transition', {profile_id de estA, target multipara})`; assertea `rpcErr != null` (regex `permission denied|PGRST202|42501|404|...`) y, leída con service_role, la categoría del perfil ajeno NO cambió. Pasa contra el remoto (ok 17) ⇒ remoto al día con 0042. No fue necesario el `select proacl` manual: el test cubre el assert de no-acceso end-to-end.
3. **No-regresión de la transición**: el trigger SD `tg_reproductive_events_apply_transition` (0031 l.80-127) sigue invocando `apply_auto_transition` como owner (l.125). T2.4 (transiciones automáticas, R7.1-R7.3) y T2.5 (override/revert) verdes. `node scripts/check.mjs` verde: 19/19 pass, 0 fail.
4. **Sin reapertura**: grep en `supabase/migrations` no encuentra ningún `grant execute` sobre `apply_auto_transition` en migraciones posteriores. El revoke no se reabre.

### Resultado
Finding HIGH único resuelto. Sin findings nuevos. Gate 2 → PASS.
