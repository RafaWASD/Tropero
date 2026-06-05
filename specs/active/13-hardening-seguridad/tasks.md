# Spec 13 — Hardening de seguridad (baseline) — Tasks

**Status**: spec_ready. **Fuente**: `requirements.md` + `design.md`. **Gate 1 OBLIGATORIO** (schema/RLS-sensitive) antes de la Puerta 1 humana.

> **Numeración de migrations**: NO hardcodear `0059`/`0060`. Al implementar, `Glob supabase/migrations/*.sql`, tomar el máximo y continuar (la spec 02 Tier 2 ya reclama 0059+). Anotar los números reales en `progress/impl_13-*.md`. Las dos migrations son independientes entre sí.

---

## INPUT-1 — CHECK char_length server-side

- [ ] **T1** — Pre-check de datos legados: por cada columna de la tabla R1.1–R1.45, contar filas fuera de rango (`where char_length(col) > N` para `text`; `where octet_length(col::text) > N` para `jsonb`). Si hay alguna, abortar y reportar (no migrar sobre datos fuera de rango). _(R1.46)_
- [ ] **T2** — Crear la migration `00NN_check_text_length_caps.sql`: **un constraint por cada fila de la tabla R1.1–R1.45** (45 en total, sobre 15 tablas). Dos patrones según tipo: `add constraint <tabla>_<col>_len_chk check (char_length(col) <= N) not valid` + `validate constraint` para `text`; `add constraint <tabla>_<col>_size_chk check (octet_length(col::text) <= N) not valid` + `validate constraint` para `jsonb` (`establishments.plan_limits` 16384, `rodeo_data_config.custom_config` 16384, `animal_events.structured_payload` 32768). Tablas: users (name/phone/email), establishments (name/province/city/plan_type/plan_limits), invitations (email/token), push_tokens (token/device_id), rodeos (name), rodeo_data_config (custom_config), animals (tag_electronic), animal_profiles (idv/visual_id_alt/breed/coat_color/entry_origin/notes), weight_events (notes), semen_registry (pajuela_name/bull_name/breed/supplier/notes), reproductive_events (notes/calf_tag_electronic), sanitary_events (product_name/active_ingredient/result/notes), condition_score_events (notes), lab_samples (tube_number/lab_destination/result/result_interpretation/notes), animal_events (text/structured_payload), management_groups (name), sessions (work_lot_label/notes), maneuver_presets (name). Cabecera con mapeo a R1.x. Cerrar con `notify pgrst, 'reload schema'`. **NO** agregar CHECK a enums/numéricas/date/boolean, a `push_tokens.platform` (ya enum), ni a `sessions.config`/`maneuver_presets.config` (ya topados en 0050/0051). **NO** agregar CHECK de formato a `tag_electronic`/`calf_tag_electronic` (solo largo, R1.49). _(R1.1–R1.45, R1.47, R1.48, R1.49)_
- [ ] **T3** — Test PostgREST/SQL directo (extender `supabase/tests/rls/run.cjs` o `supabase/tests/animal/run.cjs`): con un JWT de miembro, sobre un **subconjunto representativo** que cubra cada clase de techo y ambos tipos (`text` y `jsonb`), escribir un valor por encima del techo y verificar rechazo `23514`; y un valor en el borde superior y verificar que persiste. **Obligatorio muestrear ≥3 de las tablas incorporadas en el refinamiento**: `sanitary_events.notes` (clase notas), `animal_events.structured_payload` (jsonb, `techo+1` bytes), y al menos una de eventos/sesiones (`sessions.notes` o `weight_events.notes`). Espejar el patrón de fixtures service-role + assertion JWT real. _(R2.1, R2.2, R2.3, R2.4)_

## B1-1 — copy genérico en las EFs

- [ ] **T4** — Agregar `serverError(code, detail)` a `supabase/functions/_shared/errors.ts`: `console.error` del detalle + `jsonError(500, code, 'Error interno, probá de nuevo.')` (sin `.message` crudo). _(R3.1)_
- [ ] **T5** — En `_shared/auth.ts` `requireOwnerOf:44`: reemplazar `HttpError(500, 'db_error', error.message)` por `HttpError(500, 'db_error', 'Error interno, probá de nuevo.')` + `console.error('[requireOwnerOf]', error)`. _(R3.3)_
- [ ] **T6** — Reemplazar las ~32 ocurrencias de `jsonError(500, 'db_error', X.message)` / `jsonError(500, 'unexpected', (err as Error).message)` por `serverError('db_error', X)` / `serverError('unexpected', err)` en las 8 EFs: `accept_invitation`, `cancel_invitation`, `change_member_role`, `delete_account`, `invite_user`, `register_push_token`, `remove_member`, `resend_invitation`. Preservar `console.error` existente y todos los 4xx con copy a mano. Verificar con grep que no quede ningún 5xx propagando `.message`. _(R3.2, R3.4, R3.5)_
- [ ] **T7** — Test (extender `supabase/tests/edge/run.cjs`): forzar un 5xx en al menos una EF y assertear que el body NO contiene el `message` crudo del driver (ni nombres de tabla/columna/constraint/path), solo el copy genérico + `code` estable. _(R4.1)_

## A1-1 — `animals_update with check` re-valida `has_role_in`

- [ ] **T8** — Crear la migration `00MM_animals_update_with_check.sql`: `drop policy if exists animals_update` + recrearla con el `using` idéntico al as-built (`0022:35-39`) y el `with check` = misma condición (`exists ... has_role_in(ap.establishment_id)`). Nota en cabecera documentando R5.5 (la inmutabilidad de `tag_electronic` ya la cubre el trigger 0036, verificado). `notify pgrst, 'reload schema'`. _(R5.1, R5.4)_
- [ ] **T9** — Verificar contra `0036_immutability_identifiers.sql` que `animals_block_tag_change` dispara en UPDATE directo de PostgREST (no solo RPC) y dejarlo documentado en la migration; si se detecta un hueco, NO inventar control: escalar al leader. _(R5.5)_
- [ ] **T10** — Test cross-tenant vía PostgREST/SQL directo (extender `supabase/tests/rls/run.cjs`): fixtures con un animal con perfil en campo A y perfil en campo B (compartido) + un animal con perfil **solo** en B. (a) JWT de miembro solo de A intenta `UPDATE animals SET sex/birth_date` de la fila del animal **solo-B** → falla (RLS, 0 filas); (b) control positivo: miembro de un campo con perfil del animal puede actualizar un campo mutable. _(R6.1, R6.2, R6.3)_

## F1-1 — escaping/parametrización + tope del término

- [ ] **T11** — Crear `SEARCH_TERM_MAX_LENGTH = 64` en un util compartido (junto a `animal-input.ts`). _(R7.3)_
- [ ] **T12** — En `app/src/services/animals.ts`: reemplazar la rama `.or(\`visual_id_alt.ilike.%${escapeIlike(term)}%\`)` (`:318`) por la forma parametrizada `.ilike('visual_id_alt', \`%...%\`)`; dejar `escapeIlike` solo para comodines `% _` del patrón. Agregar al inicio de `searchAnimals` (o en `classifySearchQuery`) un recorte/rechazo del término > `SEARCH_TERM_MAX_LENGTH` antes de cualquier query. No tocar las sub-queries idv/tag (ya parametrizadas). _(R7.1, R7.2, R7.3, R7.5)_
- [ ] **T13** — En `app/app/(tabs)/animales.tsx:381`: agregar `maxLength={SEARCH_TERM_MAX_LENGTH}` al `TextInput` del buscador. _(R7.4)_
- [ ] **T14** — Test vía PostgREST/SQL directo (extender `supabase/tests/animal/run.cjs` o `rls/run.cjs`): un término con metacaracteres de `.or()` (`. ( ) : * % _ ,`) no altera la estructura del filtro ni cruza columnas (comparar contra término literal equivalente). Caso de tope: término > 64 es recortado/rechazado por el service antes de la query. _(R8.1, R8.2)_
- [ ] **T15** — Test puro (en `app/src/services` o `app/src/utils`): la función de escaping/recorte del término se comporta como se espera sin red (complementa T14). _(R8.3)_

## H1-1 — invalidar sesión del target

- [ ] **T16** — Verificar la API de invalidación por **user id** disponible en la versión de `@supabase/supabase-js`/GoTrue del proyecto (incógnita técnica): `auth.admin.signOut(userId, scope)` por id, o revocación de refresh tokens por user id. Si ninguna API por-user-id existe, **escalar al leader** antes de aceptar fallback (no cumplir R9 sería un blocker). Documentar el modelo elegido. _(R9.3)_
- [ ] **T17** — En `remove_member/index.ts`: tras el `update active:false`, invalidar la sesión del `targetUserId` (NO el access token del caller) con la API de T16. Fail-soft: `console.error` si falla, sin revertir el rol; sin exponer el error al cliente. _(R9.1, R9.4, R9.5)_
- [ ] **T18** — En `change_member_role/index.ts`: tras el split de rol, invalidar la sesión del `targetUserId` igual que T17. _(R9.2, R9.4, R9.5)_
- [ ] **T19** — Test (extender `supabase/tests/edge/run.cjs`): tras `remove_member`, la sesión/refresh previo del target queda invalidado (un refresh con el token anterior ya no produce sesión válida); ídem tras `change_member_role`. _(R10.1, R10.2, R10.3)_

## Cierre

- [ ] **T20** — Correr `node scripts/check.mjs` + las suites de `supabase/tests/*` afectadas; dejar el resumen en `progress/impl_13-hardening-seguridad.md` con los números de migration reales asignados. _(todos)_
- [ ] **T21** — Autorrevisión adversarial del implementer antes del reviewer (paso 8 del agente): re-grep de `.message` en EFs, re-leer el `with check` recreado, confirmar que los tests de INPUT-1/A1-1/F1-1 pegan a PostgREST/SQL directo (no a la UI). _(todos)_

---

## Cobertura R<n> → Task

| R<n> | Tasks |
|------|-------|
| R1.1–R1.45, R1.46–R1.49 (INPUT-1 schema, 45 columnas / 15 tablas) | T1, T2 |
| R2.1–R2.4 (INPUT-1 test, muestreo por clase + ≥3 tablas nuevas) | T3 |
| R3.x (B1-1) | T4, T5, T6 |
| R4.x (B1-1 test) | T7 |
| R5.x (A1-1 policy + trigger) | T8, T9 |
| R6.x (A1-1 test) | T10 |
| R7.x (F1-1) | T11, T12, T13 |
| R8.x (F1-1 test) | T14, T15 |
| R9.x (H1-1) | T16, T17, T18 |
| R10.x (H1-1 test) | T19 |
| cierre/QA | T20, T21 |
