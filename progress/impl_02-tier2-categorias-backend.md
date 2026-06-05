baseline_commit: 77a1ff204dac5c52831df747e73dce84c775771b

# Impl — Spec 02 Tier 2/3 backend: modelo de categorías de cría

Feature: delta backend Tier 2/3 de spec 02 (modelo de categorías de cría). Spec APROBADA (Gate 1 PASS + Puerta 1). Backend puro: migraciones `.sql` ≥ 0059 + tests reales contra el remoto. NO se toca `app/`.

Fuente: `requirements-tier2-categorias.md` (RT2.x) + `design-tier2-categorias.md` (DD-1..DD-4) + `tasks-tier2-categorias.md` (T1-T8/T7bis). Dominio firme: ADR-008 (§ Enmienda) + `dominio-categorias-facundo-2026-06-03.md`.

As-built verificado: migraciones hasta `0058` (local == remote confirmado vía Management API). Próximo libre: `0059`. Sin colisión con terminales paralelas (la otra terminal trabaja frontend C3 / spec 04, no migraciones).

## Plan (tasks)

- [x] T1 — `0059` seed novillito/novillo (idempotente, join por `.code`).
- [x] T2 — `0060` columna `is_castrated` en `animals` (default false NOT NULL).
- [x] T3 — `0061` columna `nursing` en `animal_profiles` + `compute_nursing` + trigger.
- [x] T4 — `0062` reescritura completa de `compute_category` (rama macho/hembra + cortes de edad + aborto-revierte-tacto).
- [x] T5 — `0063` alinear trigger incremental → delega a `compute_category` + recrear trigger recálculo con `OF` ampliado a `event_date`.
- [x] T6 — `0064` trigger de castración (`AFTER UPDATE OF is_castrated`) → delega a `compute_category`.
- [x] T7 — `0065` check_grants: revoke `apply_auto_transition` + revoke nominal de 3 funciones-trigger + smoke-check.
- [x] T7bis — `0066` `refresh_age_categories()` + `pg_cron` (filtro targeted + M02 revoke + smoke-check fail-closed + schedule idempotente).
- [x] (autorrevisión) `0067` trigger de nursing sobre `birth_calves` (fix mellizos).
- [x] T8 — tests T8.a-T8.n (= sub-tests T2.20-T2.33) en `supabase/tests/animal/run.cjs`.
- [x] T9 — recordatorio espejo cliente RT2.20 (abajo; NO se toca en este chunk).
- [x] Aplicar al remoto + `node scripts/check.mjs` (suites verdes) + `pnpm e2e`.

## Qué hace cada migración

| Migración | Qué hace | RT2.x |
|---|---|---|
| `0059_categories_novillo_seed.sql` | Seed idempotente de `novillito`/`novillo` para (bovino,cría); join por `.code`; `on conflict (system_id,code) do nothing`; no toca las 10 base. | RT2.1.x, RT2.13.2 |
| `0060_is_castrated_column.sql` | `animals.is_castrated boolean NOT NULL DEFAULT false` (DD-2). Sin policy/grant nuevo (hereda RLS de `animals` 0022). | RT2.2.1, RT2.12.1, RT2.13.1 |
| `0061_nursing_column.sql` | `animal_profiles.nursing boolean NOT NULL DEFAULT false` + `compute_nursing(profile_id)` (SECURITY DEFINER STABLE) + trigger `tg_reproductive_events_recompute_nursing` (insert/update/delete sobre `birth`/`weaning`; resuelve la madre vía `birth_calves` en `weaning`). UPDATE solo de `nursing` (ortogonal). | RT2.9.x, RT2.13.1 |
| `0062_compute_category_rewrite.sql` | Reescritura completa de `compute_category`: rama macho (corte 2 años → toro/novillo; destete o ≥1 año → torito/novillito; <1 año → ternero; null → default por sexo), rama hembra (partos≥2 → multípara; partos=1 → vaca; tacto+ NO revertido por aborto → preñada; destete/servicio/≥1 año → vaquillona; <1 año → ternera; default → vaquillona). Conserva SECURITY DEFINER STABLE, conteo de PARTOS (no terneros), grant a authenticated. Lee `a.is_castrated`. | RT2.3.x, RT2.4.x, RT2.7.2, RT2.7.5, RT2.8.1, RT2.12.3 |
| `0063_category_triggers_align.sql` | Reescribe `tg_reproductive_events_apply_transition` → delega a `compute_category` para `tacto/service/weaning/birth/abortion` (consistencia RT2.10.1 por construcción). Recrea (drop+create, NO edita 0046) `reproductive_events_recompute_on_update` ampliando `OF` a `event_date`. | RT2.5.x, RT2.6.x, RT2.7.1/3/4/6, RT2.10.x |
| `0064_castration_transition.sql` | `tg_animals_apply_castration` (`AFTER UPDATE OF is_castrated`): solo false→true; resuelve el perfil activo (where animal_id=new.id); respeta override; delega a `compute_category` (torito→novillito / toro→novillo según corte 2 años); true→false no revierte. | RT2.2.2-2.2.6, RT2.10.4 |
| `0065_check_grants.sql` | Re-emite revoke de `apply_auto_transition` (RT2.12.2); reafirma grant de `compute_category`/`compute_nursing` a authenticated; SEC-SPEC-M01: revoke nominal de las 3 funciones-trigger + smoke-check fail-closed. | RT2.12.2, RT2.12.4, M01 |
| `0066_age_categories_cron.sql` | `create extension pg_cron`; `refresh_age_categories()` (SECURITY DEFINER returns void, sin params, filtro targeted age-stale: ternero/ternera@365 o torito/novillito@730, override=false, deleted_at null, birth_date not null; compute_category+apply_auto_transition solo si difiere). **SEC-SPEC-M02 (crítico):** revoke de public/authenticated/anon + smoke-check fail-closed + `grant to service_role` (ver decisión D2); `cron.schedule('refresh_age_categories_nightly','0 3 * * *', …)` idempotente (unschedule defensivo previo). | RT2.8.2/4/5, RT2.12.6, M02 |
| `0067_nursing_birth_calves_trigger.sql` | (autorrevisión) `tg_birth_calves_recompute_nursing` (`AFTER INSERT ON birth_calves`): recomputa nursing de la madre. Cierra el hueco de mellizos (register_birth inserta el `birth` antes de poblar birth_calves → el trigger de 0061 corría con birth_calves vacío). EXECUTE revocado de clientes. | RT2.9.1 (refuerzo) |

## Aplicación al remoto

- Local == remote (0058) confirmado antes de pushear (Management API `GET /database/migrations`).
- Método: el `SUPABASE_DB_PASSWORD` no está en `.env.local`, así que la CLI `db push --linked` no era usable. Apliqué vía la **Management API** (`POST /v1/projects/{ref}/database/migrations`, `Authorization: Bearer SUPABASE_ACCESS_TOKEN`) — corre el SQL como `postgres` (owner) y registra la versión. Las 8 migraciones (0059-0066) + 0067 aplicaron OK; los dos smoke-checks fail-closed (0065/0066) pasaron sin excepción; `cron.schedule` devolvió jobid (job activo `refresh_age_categories_nightly`, `0 3 * * *`).
- Verificado en el remoto: novillito/novillo activos (12 categorías activas = 10 + 2); is_castrated NOT NULL default false; nursing NOT NULL default false; `refresh_age_categories` NO ejecutable por authenticated (revoke efectivo); `apply_auto_transition` sigue revocada; cron job activo.

## Decisiones de implementación

- **D1 — Método de aplicación: Management API en vez de CLI.** Sin `SUPABASE_DB_PASSWORD` en `.env.local`, `supabase db push --linked` falla (SASL auth). El MCP de Supabase de esta sesión expone la Management API con el access token; la usé para correr el SQL como owner. Efecto equivalente al `db push` (SQL ejecutado + migración registrada). Nota cosmética: la Management API asigna versiones timestamp (`20260604…`) en `supabase_migrations.schema_migrations`, no `0059`-style; el schema real es correcto y los `.sql` del repo son la fuente de verdad. (El leader puede re-sincronizar la tabla de migraciones si quiere los nombres `0059..0067`, pero no afecta el funcionamiento.)
- **D2 — `grant execute … to service_role` sobre `refresh_age_categories` (0066).** El `revoke … from public, authenticated, anon` cascadeó también el `EXECUTE TO PUBLIC` que cubría a `service_role` → quedó NO ejecutable por service_role. El test T8.n (design/tasks) exige invocarla "vía el client service". `service_role` NO es un rol cliente (es la key admin server-side, nunca se entrega al browser, ya bypassea RLS) → grantearla no abre IDOR cliente (el smoke-check verifica solo public/authenticated/anon, que es el control de M02) y habilita la invocación operativa + el test. La función SECURITY DEFINER corre como owner → su llamada interna a `apply_auto_transition` funciona pese al revoke de esta. **Esto es una precisión sobre el SQL de diseño (que solo listaba el revoke), no un cambio de comportamiento de seguridad.** Flag para el reviewer/Gate 2.
- **D3 — `0067` (nursing sobre birth_calves) NO estaba en el plan de tasks.** Lo agregué tras cazar el bug de mellizos en la autorrevisión (ver abajo). Es backend, dentro del alcance (RT2.9.1), no reabre la spec. Migración nueva (no edita 0061).
- **Delegación incremental→compute_category (0063/0064/0066):** los tres caminos de escritura automática (incremental, castración, cron) llaman `compute_category` + `apply_auto_transition` en vez de hardcodear targets → una sola fuente de verdad, RT2.10.1 por construcción. El `apply_auto_transition` revocado (0042) lo invocan como SECURITY DEFINER (owner).
- **Soft-delete de eventos en los tests:** el cliente borra eventos vía la RPC `soft_delete_event` (0041), no por UPDATE directo de `deleted_at` (lo bloquea la RLS por visibilidad-on-RETURNING). El UPDATE interno de la RPC (definer) dispara el trigger de recálculo. (Cazado al fallar T2.29 con un UPDATE directo.)

## Autorrevisión adversarial

Busqué activamente, como revisor hostil:

- **Mellizos no quedaban `nursing=true` (BUG REAL, cerrado).** `register_birth` inserta el evento `birth` y DESPUÉS puebla `birth_calves` en el loop. El `AFTER INSERT` de nursing de 0061 corría con `birth_calves` vacío para ese parto → `compute_nursing=false`. El camino mono no sufría (el calf-creation es BEFORE INSERT). **Fix: `0067`** (trigger `AFTER INSERT ON birth_calves` que recomputa la madre). Verificado: mellizos vía `register_birth` ahora → `nursing=true`. Test de regresión agregado a T2.28.
- **Soft-delete de evento desde el cliente fallaba (cazado en T2.29).** El UPDATE directo de `deleted_at` lo rechaza la RLS de `reproductive_events` (visibilidad-on-RETURNING). Cambiado a la RPC `soft_delete_event` (camino cliente real) → su UPDATE interno dispara el recálculo. Ahora el borrado revierte correcto (ternera/ternero/vaca) sin quedarse pegado ni revertir por edad.
- **toro recién castrado → novillo, no novillito.** Cubierto por delegar a `compute_category` (corte de 2 años). Test T2.27 explícito (toro@800 + castrar → novillo).
- **vaca/multípara que aborta queda igual.** RT2.7.4: el conteo de partos domina. Test T2.26 (multípara + abortion → multípara).
- **servicio sobre preñada no revierte.** El tacto+ vigente domina en `compute_category`. Test agregado a T2.23 (preñada + service → sigue preñada).
- **aborto-revierte-tacto sobrevive al recompute y respeta el orden por fecha.** RT2.7.5 con `NOT EXISTS` de aborto posterior `(event_date, created_at)`. Test T2.29: incremental + recompute coinciden; mover el aborto antes del tacto → el tacto vuelve a contar (preñada).
- **mellizos = un parto.** `compute_category` cuenta eventos `birth` (no `birth_calves`). Test T2.25 (register_birth 2 terneros → avanza una sola vez).
- **override gana en TODAS las transiciones nuevas** (servicio/destete/parto/aborto/castración/edad/cron). Tests T2.23/24/26/27/30/33. Revert recalcula con is_castrated (T2.30).
- **M02 revoke efectivo.** `refresh_age_categories` NO invocable por authenticated (test T2.33 + smoke-check en 0066). Cross-tenant by-design, sin params, cambia categoría solo vía `apply_auto_transition`, returns void.
- **is_castrated cross-tenant bloqueado por RLS.** Test T2.31 (userC sin rol no togglea; field_operator de estA sí). `apply_auto_transition` no invocable por authenticated (T2.31 + T2.18 base).
- **cron targeted (no recalcula de más).** Test T2.33: recalcula ternero@400 y torito@800; NO toca ternero@100, ni vaquillona vieja (hembra sin corte 2 años), ni override, ni soft-deleted.
- **consistencia incremental↔recompute en todos los caminos.** T2.29: `compute_category` directo == categoría materializada tras secuencias.
- **ortogonalidad de nursing.** T2.28: cambiar nursing no toca category_id/rodeo_id/management_group_id; nursing NO gatilla override (0021/0040 escuchan OF category_id) ni gating dientes (0054 escucha OF teeth_state,is_cut,category_id).
- **No expongo helpers como RPC.** compute_nursing es lectura (EXECUTE a authenticated, paralela a compute_category, deriva del profile_id). Las 3 funciones-trigger + refresh_age_categories revocadas + smoke-checks fail-closed (0065/0066).

## Trazabilidad R<n> → test (archivo: supabase/tests/animal/run.cjs)

| RT2.x | Test |
|---|---|
| RT2.1.1/1.2/1.3 | T2.20 (seed novillito/novillo activos; 10 base intactas) |
| RT2.2.1 | 0060 (columna) + T2.32 (default false) |
| RT2.2.2 | T2.24/T2.27 (ternero castrado sigue ternero) |
| RT2.2.3 | T2.27 (torito + castrar → novillito) |
| RT2.2.4 | T2.27 (toro + castrar → novillo) |
| RT2.2.5 | T2.27 (override bloquea castración) |
| RT2.2.6 | T2.27 (true→false no revierte) |
| RT2.3.1-3.5 | T2.21 (rama macho: ternero/torito/toro/novillito/novillo/null→torito) |
| RT2.4.1 | T2.25 (2º parto → multípara) |
| RT2.4.2 | T2.25 (ternera/vaquillona que pare → vaca) |
| RT2.4.3 | T2.26 (tacto+ → preñada) |
| RT2.4.4 | T2.22 (≥1 año → vaquillona) / T2.23 / T2.24 |
| RT2.4.5 | T2.22 (<1 año → ternera) |
| RT2.4.6 | T2.22 (null → vaquillona) |
| RT2.5.1/5.2/5.3 | T2.23 (servicio: ternera→vaquillona; vaquillona/preñada sin cambio; override) |
| RT2.6.1/6.2/6.3/6.4 | T2.24 (destete: ternero→torito/novillito, ternera→vaquillona, graduado sin retroceso, override) |
| RT2.7.1/7.2 | T2.25 (parto desde cualquier categoría; mellizos = un parto) |
| RT2.7.3/7.4/7.6 | T2.26 (aborto revierte; multípara que aborta queda; override) |
| RT2.7.5 | T2.29 (aborto-revierte-tacto sobrevive al recompute; por fecha) |
| RT2.8.2/8.3/8.4/8.5 | T2.33 (cron: recalcula age-stale; respeta override/soft-delete; no toca no-cruzados; history auto_transition) |
| RT2.9.1/9.2/9.3 | T2.28 (nursing true/false; ortogonalidad; consistencia bajo borrado; mellizos) |
| RT2.10.1/10.2/10.3 | T2.29 (consistencia trigger↔recompute en todos los caminos) |
| RT2.10.4 | T2.27 (castración registra auto_transition en history) |
| RT2.11.1/11.2 | T2.30 (override manda en todas; revert recalcula) |
| RT2.12.1/12.5 | T2.31 (is_castrated cross-tenant bloqueado; field_operator del tenant sí) |
| RT2.12.2 | T2.31 + T2.18 base (apply_auto_transition no invocable) |
| RT2.12.3 | compute_category SECURITY DEFINER, deriva del profile_id (T2.21/22 + diseño) |
| RT2.12.6 / M02 | T2.33 (refresh_age_categories no invocable por authenticated) + smoke-check 0066 |
| RT2.13.1/13.2 | T2.32 (defaults false; categoría base no migra por el seed) |

## T9 — Recordatorio espejo cliente (RT2.20, NO en este chunk)

`app/src/utils/animal-category.ts::computeInitialCategoryCode` y su test `animal-category.test.ts` deberán alinearse cuando el frontend agregue el picker `novillito`/`novillo` o el alta de macho castrado adulto (agregar `novillito`/`novillo` al type `InitialCategoryCode` + rama de castración). En este chunk NO se tocó `app/`: la rama sin-eventos de `compute_category` no cambió, así que el espejo sigue correcto para el alta directa actual. Handoff al chunk de frontend posterior.

## Conteos finales

- `node scripts/check.mjs`: typecheck OK; anti-hardcode **0 violaciones**; **client unit 313/313**; **RLS 17/17**; **Edge 36/36**; **Animal 42/42** (28 base regresión + 14 nuevos T2.20-T2.33; T2.19 con 8 sub-casos); **Maniobras 13/13**. "All tests passed."
  - ⚠️ check.mjs imprime "Entorno NO listo" por **"2 features en in_progress (máximo 1)"** en `feature_list.json` — estado de coordinación PRE-EXISTENTE (features 01 + "user_private" ambas `in_progress`), NO causado por este chunk y `feature_list.json` está fuera de mi alcance (regla dura). El bloque de tests/typecheck/anti-hardcode está VERDE. → decisión del leader.
- Regresión base verde: tacto+→prenada, birth→vaca, 2º birth→multipara (ahora vía el camino delegado) — T2.4 base pasa.
- `pnpm e2e`: (resultado abajo).

## Para el leader (decisiones / flags)

1. **check.mjs rojo SOLO por `feature_list.json` (2 in_progress)** — coordinación, no mi deliverable. No lo toqué (regla dura). Resolver el estado de in_progress.
2. **D2: `grant execute … to service_role` sobre `refresh_age_categories`** — precisión necesaria para el test T8.n; no debilita M02 (service_role no es rol cliente; smoke-check verifica solo public/authenticated/anon). Que Gate 2 lo confirme.
3. **D1: migraciones aplicadas vía Management API** (sin DB password para la CLI). Versiones timestamp en `schema_migrations`; los `.sql` 0059-0067 son la fuente de verdad. Re-sync opcional del leader.
4. **C1 (tensión spec 10):** este chunk entrega `is_castrated` + su efecto de categoría. La castración masiva de spec 10 debe ESCRIBIR `is_castrated = true` (además del `sanitary_events`) para que la transición ocurra — anotado para el implementer de spec 10.
