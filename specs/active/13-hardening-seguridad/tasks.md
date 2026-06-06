# Spec 13 — Hardening de seguridad (baseline) — Tasks

**Status**: in_progress — reconciliado con el AS-BUILT (2026-06-05). **Fuente**: `requirements.md` + `design.md` + `progress/impl_13-hardening-seguridad.md` (as-built). Gate 1 PASS + Puerta 1 aprobada + implementación desplegada (migraciones 0070/0071/0072 + EFs).

> **Numeración de migrations (AS-BUILT)**: las migraciones quedaron **0070** (INPUT-1, `check_text_length_caps`), **0071** (A1-1, `animals_update_with_check`) y **0072** (H1-1, `revoke_user_sessions_rpc` — agregada en el fix-loop del reviewer al reemplazar el ban por la RPC). 0070 depende de 0068 (feature 14 / `user_private`): orden de apply 0068 → 0070. 0071 y 0072 independientes entre sí.

---

## INPUT-1 — CHECK char_length server-side

- [x] **T1** — Pre-check de datos legados (AS-BUILT): DO-block que por cada columna de la tabla R1.1–R1.45 cuenta filas fuera de rango (`where char_length(col) > N` para `text`; `where octet_length(col::text) > N` para `jsonb`) y, si hay, emite `RAISE NOTICE` listando los violadores **sin abortar** (NO `RAISE EXCEPTION`): la barrera de seguridad es el CHECK `NOT VALID`, no el pre-check. El DO-block cuenta TODAS las columnas (deja visible cualquier violación inesperada futura). _(R1.46, R1.46c)_
- [x] **T2** — Crear la migration `0070_check_text_length_caps.sql`: **un constraint por cada fila de la tabla R1.1–R1.45** (45 en total, sobre 15 tablas). Dos patrones según tipo: `add constraint <tabla>_<col>_len_chk check (char_length(col) <= N)` para `text`; `add constraint <tabla>_<col>_size_chk check (octet_length(col::text) <= N)` para `jsonb` (`establishments.plan_limits` 16384, `rodeo_data_config.custom_config` 16384, `animal_events.structured_payload` 32768). **Patrón as-built**: las 43 columnas limpias → `not valid` + `validate constraint` (validadas); las 2 columnas de tag con basura de e2e —`animals.tag_electronic` (179 filas), `reproductive_events.calf_tag_electronic` (18 filas)— → `not valid` **sin** `validate constraint` (grandfather; el `NOT VALID` capea todo input futuro igual). Tablas: users (**name** — `email`/`phone` movidos a `user_private` por feature 14 / 0068), **user_private (email/phone)**, establishments (name/province/city/plan_type/plan_limits), invitations (email/token), push_tokens (token/device_id), rodeos (name), rodeo_data_config (custom_config), animals (tag_electronic), animal_profiles (idv/visual_id_alt/breed/coat_color/entry_origin/notes), weight_events (notes), semen_registry (pajuela_name/bull_name/breed/supplier/notes), reproductive_events (notes/calf_tag_electronic), sanitary_events (product_name/active_ingredient/result/notes), condition_score_events (notes), lab_samples (tube_number/lab_destination/result/result_interpretation/notes), animal_events (text/structured_payload), management_groups (name), sessions (work_lot_label/notes), maneuver_presets (name). Cabecera con mapeo a R1.x. Cerrar con `notify pgrst, 'reload schema'`. **NO** agregar CHECK a enums/numéricas/date/boolean, a `push_tokens.platform` (ya enum), ni a `sessions.config`/`maneuver_presets.config` (ya topados en 0050/0051). **NO** agregar CHECK de formato a `tag_electronic`/`calf_tag_electronic` (solo largo, R1.49). _(R1.1–R1.45, R1.46a, R1.46b, R1.47, R1.48, R1.49)_
- [x] **T3** — Test PostgREST/SQL directo (extender `supabase/tests/rls/run.cjs` o `supabase/tests/animal/run.cjs`): con un JWT de miembro, sobre un **subconjunto representativo** que cubra cada clase de techo y ambos tipos (`text` y `jsonb`), escribir un valor por encima del techo y verificar rechazo `23514`; y un valor en el borde superior y verificar que persiste. **Obligatorio muestrear ≥3 de las tablas incorporadas en el refinamiento**: `sanitary_events.notes` (clase notas), `animal_events.structured_payload` (jsonb, `techo+1` bytes), y al menos una de eventos/sesiones (`sessions.notes` o `weight_events.notes`). Espejar el patrón de fixtures service-role + assertion JWT real. _(R2.1, R2.2, R2.3, R2.4)_

## B1-1 — copy genérico en las EFs

- [x] **T4** — Agregar `serverError(code, detail)` a `supabase/functions/_shared/errors.ts`: `console.error` del detalle + `jsonError(500, code, 'Error interno, probá de nuevo.')` (sin `.message` crudo). _(R3.1)_
- [x] **T5** — En `_shared/auth.ts` `requireOwnerOf:44`: reemplazar `HttpError(500, 'db_error', error.message)` por `HttpError(500, 'db_error', 'Error interno, probá de nuevo.')` + `console.error('[requireOwnerOf]', error)`. _(R3.3)_
- [x] **T6** — Reemplazar las ~32 ocurrencias de `jsonError(500, 'db_error', X.message)` / `jsonError(500, 'unexpected', (err as Error).message)` por `serverError('db_error', X)` / `serverError('unexpected', err)` en las 8 EFs: `accept_invitation`, `cancel_invitation`, `change_member_role`, `delete_account`, `invite_user`, `register_push_token`, `remove_member`, `resend_invitation`. Preservar `console.error` existente y todos los 4xx con copy a mano. Verificar con grep que no quede ningún 5xx propagando `.message`. _(R3.2, R3.4, R3.5)_
- [x] **T7** — Test (extender `supabase/tests/edge/run.cjs`): forzar un 5xx en al menos una EF y assertear que el body NO contiene el `message` crudo del driver (ni nombres de tabla/columna/constraint/path), solo el copy genérico + `code` estable. _(R4.1)_

## A1-1 — `animals_update with check` re-valida `has_role_in`

- [x] **T8** — Crear la migration `0071_animals_update_with_check.sql`: `drop policy if exists animals_update` + recrearla con el `using` idéntico al as-built (`0022:35-39`) y el `with check` = misma condición (`exists ... has_role_in(ap.establishment_id)`). Nota en cabecera documentando R5.5 (la inmutabilidad de `tag_electronic` ya la cubre el trigger 0036, verificado). `notify pgrst, 'reload schema'`. _(R5.1, R5.4)_
- [x] **T9** — Verificar contra `0036_immutability_identifiers.sql` que `animals_block_tag_change` dispara en UPDATE directo de PostgREST (no solo RPC) y dejarlo documentado en la migration; si se detecta un hueco, NO inventar control: escalar al leader. _(R5.5)_
- [x] **T10** — Test cross-tenant vía PostgREST/SQL directo (extender `supabase/tests/rls/run.cjs`): fixtures con un animal con perfil en campo A y perfil en campo B (compartido) + un animal con perfil **solo** en B. (a) JWT de miembro solo de A intenta `UPDATE animals SET sex/birth_date` de la fila del animal **solo-B** → falla (RLS, 0 filas); (b) control positivo: miembro de un campo con perfil del animal puede actualizar un campo mutable. _(R6.1, R6.2, R6.3)_

## F1-1 — escaping/parametrización + tope del término

- [x] **T11** — Crear `SEARCH_TERM_MAX_LENGTH = 64` en un util compartido (junto a `animal-input.ts`). _(R7.3)_
- [x] **T12** — En `app/src/services/animals.ts`: reemplazar la rama `.or(\`visual_id_alt.ilike.%${escapeIlike(term)}%\`)` (`:318`) por la forma parametrizada `.ilike('visual_id_alt', \`%...%\`)`; dejar `escapeIlike` solo para comodines `% _` del patrón. Agregar al inicio de `searchAnimals` (o en `classifySearchQuery`) un recorte/rechazo del término > `SEARCH_TERM_MAX_LENGTH` antes de cualquier query. No tocar las sub-queries idv/tag (ya parametrizadas). _(R7.1, R7.2, R7.3, R7.5)_
- [x] **T13** — En `app/app/(tabs)/animales.tsx:381`: agregar `maxLength={SEARCH_TERM_MAX_LENGTH}` al `TextInput` del buscador. _(R7.4)_
- [x] **T14** — Test vía PostgREST/SQL directo (extender `supabase/tests/animal/run.cjs` o `rls/run.cjs`): un término con metacaracteres de `.or()` (`. ( ) : * % _ ,`) no altera la estructura del filtro ni cruza columnas (comparar contra término literal equivalente). Caso de tope: término > 64 es recortado/rechazado por el service antes de la query. _(R8.1, R8.2)_
- [x] **T15** — Test puro (en `app/src/services` o `app/src/utils`): la función de escaping/recorte del término se comporta como se espera sin red (complementa T14). _(R8.3)_

## H1-1 — invalidar sesión del target (AS-BUILT: RPC, no ban)

- [x] **T16** — Verificar la API de invalidación por **user id** (incógnita técnica). Resultado as-built: `@supabase/supabase-js@2` NO expone `signOut(userId)` (solo acepta el access token, que el owner no posee). El intento inicial con `updateUserById(target, {ban_duration:'1s'})` se probó **empíricamente inefectivo** (el ban finito no revoca el refresh token persistente; tras la ventana, el refresh vuelve a funcionar). _(R9.3)_
- [x] **T16b** — Crear la migration `0072_revoke_user_sessions_rpc.sql`: RPC `SECURITY DEFINER` `public.revoke_user_sessions(target_uid uuid)` → `delete from auth.sessions where user_id = target_uid` (revoca refresh tokens de forma persistente, mismo efecto que `signOut(global)` por user id; verificada empíricamente: refresh post-delete → `400 Refresh Token Not Found`). Grants blindados: `revoke all ... from public, authenticated, anon` + `grant execute ... to service_role` + smoke-check fail-closed que aborta si quedara EXECUTE-able por un rol cliente (lección SEC-HIGH-01). `notify pgrst, 'reload schema'`. _(R9.3)_
- [x] **T17** — En `remove_member/index.ts`: tras el `update active:false`, invalidar la sesión del `targetUserId` (NO el access token del caller) invocando `adminClient.rpc('revoke_user_sessions', { target_uid: targetUserId })`. Fail-soft: `console.error` si falla, sin revertir el rol; sin exponer el error al cliente. _(R9.1, R9.4, R9.5)_
- [x] **T18** — En `change_member_role/index.ts`: tras el split de rol, invalidar la sesión del `targetUserId` con la misma RPC que T17. _(R9.2, R9.4, R9.5)_
- [x] **T19** — Test **determinista** (extender `supabase/tests/edge/run.cjs`): control explícito PRE-invoke (el refresh con el token previo DEBE producir sesión → descarta falso positivo), invocar la EF, y assertar que el refresh POST-invoke FALLA (`refreshErr && !session`), sin `sleep` ni ventana temporal (el `DELETE FROM auth.sessions` es persistente). Para `remove_member` y para `change_member_role`. _(R10.1, R10.2, R10.3)_

## Cierre

- [x] **T20** — Correr `node scripts/check.mjs` + las suites de `supabase/tests/*` afectadas; dejar el resumen en `progress/impl_13-hardening-seguridad.md` con los números de migration reales asignados. _(todos)_
- [x] **T21** — Autorrevisión adversarial del implementer antes del reviewer (paso 8 del agente): re-grep de `.message` en EFs, re-leer el `with check` recreado, confirmar que los tests de INPUT-1/A1-1/F1-1 pegan a PostgREST/SQL directo (no a la UI). _(todos)_

---

## Cobertura R<n> → Task

| R<n> | Tasks |
|------|-------|
| R1.1–R1.45, R1.46/R1.46a/R1.46b/R1.46c–R1.49 (INPUT-1 schema, 45 columnas / 15 tablas; `email`/`phone` en `user_private`; 2 tags grandfathereadas) | T1, T2 |
| R2.1–R2.4 (INPUT-1 test, muestreo por clase + ≥3 tablas nuevas) | T3 |
| R3.x (B1-1) | T4, T5, T6 |
| R4.x (B1-1 test) | T7 |
| R5.x (A1-1 policy + trigger) | T8, T9 |
| R6.x (A1-1 test) | T10 |
| R7.x (F1-1) | T11, T12, T13 |
| R8.x (F1-1 test) | T14, T15 |
| R9.x (H1-1: RPC `revoke_user_sessions`, no ban) | T16, T16b, T17, T18 |
| R10.x (H1-1 test, determinista) | T19 |
| cierre/QA | T20, T21 |
