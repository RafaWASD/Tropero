# security_code — spec 03 (MODO MANIOBRAS) — chunk M3.1 — Gate 2 (modo `code`, ADR-019)

## Veredicto: **PASS**

Orquestador de escritura de eventos de maniobra (12 maniobras + aplicabilidad per-animal). Frontend puro sobre backend done (0091 aplicada). Revisado con metodología `sentry-skills:security-review` (trazar data flow + verificar exploitability) + checklist RAFAQ-específico + Catálogo de dominios de seguridad.

**No se identificaron findings HIGH-confidence.** El modelo de seguridad es sólido: el local write siempre tiene éxito offline (no es decisión de seguridad), y la autorización REAL es RLS + triggers server-side al subir, todos verificados fila por fila contra las migraciones aplicadas. Cero secrets, cero SQL injection en los builders nuevos, IDOR cerrado por RLS, inputs de texto libre con cota autoritativa server-side.

---

## Baseline y alcance
- `baseline_commit`: `638679fa61672e884fc75b3ae94a855bf9853642` (registrado en `progress/impl_03-m3.1.md`).
- Trabajamos sobre `main`; los archivos de M3.1 están en working tree (sin commitear). Alcance tomado del progress, no de `main...HEAD` (daría vacío).

---

## FOCO 1 — Writes de evento con session_id (SQL injection + spoofing de tenant)

**SQL injection — DESCARTADO (verificado).** Los 14 builders nuevos (`local-reads.ts:1315-1564`) construyen TODO el SQL con placeholders `?` y pasan los valores por `args[]`. Cero interpolación de input en el string SQL. Ejemplos verificados:
- `buildAddManeuverSanitaryInsert` (1315): `INSERT INTO sanitary_events (...) VALUES (?, ?, ?, ?, ?, ?)`, `args:[id, profileId, eventType, productName, eventDate, sessionId]`.
- `buildAddManeuverLabSampleInsert` (1482), `buildAddManeuverConditionScoreInsert` (1372), `buildAddManeuverInseminationInsert` (1444), etc.: idéntico patrón.
- Las únicas interpolaciones `${...}` del archivo (`local-reads.ts:176/741/898/1095/1107/1771/2323`) son builders PREEXISTENTES fuera del alcance M3.1 y usan valores server-controlled: `${synced}`/`${overlay}` (constantes SQL internas), `${table}` (union literal cerrado `DeletableEventTable`), `${placeholders}` (= `?,?,?` generado por count, dato en `args[]`).

**`created_by` NO se manda — VERIFICADO.** Ningún builder de M3.1 incluye `created_by` en el INSERT. Lo fuerza el trigger server-side `tg_set_created_by_auth_uid` (ej. `0028:22-24` para condition_score; mismo patrón en el resto). El `establishment_id` tampoco se maneja en cliente: lo denormaliza el trigger (0077).

**`session_id` cross-tenant — CERRADO server-side (fail-closed).** Aunque el cliente pase un `sessionId` arbitrario, `tg_event_session_tenant_check` (`0052:27-77`) valida al INSERT (y al UPDATE-of-session_id) en las 5 tablas de evento, con triggers separados ins/upd (`0056`, fix del bypass de 0052 donde el trigger combinado no disparaba en INSERT):
- (cross-tenant) `sessions.establishment_id` == establishment del perfil → 23514 si difiere.
- (intra-tenant a) sesión `status='active'` → 23514 si cerrada.
- (intra-tenant b) `animal_profiles.rodeo_id` == `sessions.rodeo_id` (R1.1) → 23514 si no coincide.
- sesión inexistente/soft-deleted → 23503.
La función es `SECURITY DEFINER` + `search_path=public` + `EXECUTE` revocado de public/authenticated/anon.

**`establishment_id`/`rodeo_id` no spoofeables — VERIFICADO.** No viajan en el payload de M3.1; el `animal_profile_id` (derivado del animal real identificado en la manga, vía param de ruta) es la única FK, y la RLS INSERT (`has_role_in(establishment_of_profile(animal_profile_id))`, ej. `0025:35-38`, `0026:65-66`, `0028:29-30`) rechaza un evento sobre un perfil de otro establishment.

## FOCO 2 — Dientes/CUT (UPDATE de animal_profiles): IDOR + categoría ajena

**IDOR — CERRADO por RLS (verificado).** Los builders `buildSetTeethStateUpdate` (1523), `buildSetCutUpdate` (1540), `buildUnsetCutUpdate` (1557) filtran solo por `WHERE id = ? AND deleted_at IS NULL`. El connector lo sube como PATCH `.update(opData).eq('id', op.id)` (`connector.ts:82-85`). La barrera es la RLS `animal_profiles_update` (`0022:13-15`): `using (has_role_in(establishment_id)) with check (has_role_in(establishment_id))`. El `establishment_id` evaluado es el de la fila destino → un atacante con rol solo en su establishment NO puede UPDATE un perfil ajeno aunque arme `buildSetCutUpdate(profileIdAjeno, ...)`. El PATCH server-side es rechazado por la policy `using`.

**CUT gateado server-side por `dientes` enabled — VERIFICADO (el cliente NO es la única barrera).** `tg_animal_profiles_teeth_gating` (`0054:148-171`) gatea los cambios ADITIVOS (teeth_state → no-NULL, is_cut false→true) exigiendo `assert_data_keys_enabled(new.id, ['dientes'])`, fail-closed (rodeo irresoluble → 23514). El gate de cliente R7.5/`shouldOfferCutPrompt` (no para terneros) es UX; el server lo cubre por rodeo.

**`category_id` de otro sistema — RECHAZADO server-side (verificado).** `tg_animal_profiles_category_check` (`0021:46-63`) valida que `category_id` pertenezca al `system_id` del rodeo del animal (`categories_by_system`, active) → 23514 si no cuadra. Un id de categoría de otro sistema (o de otro establishment) es rechazado al subir. El `cutCategoryId` lo resuelve M3.2 del catálogo local; el fail-safe del orquestador (sin id → solo teeth_state, `maneuver-event-query.ts:199-206`) evita escribir una categoría inválida.

## FOCO 3 — Inputs de usuario sin cota autoritativa server-side

**Todos los inputs de texto libre / numéricos de M3.1 tienen cota AUTORITATIVA server-side (CHECK de DB).** El cliente Expo es attacker-controlled (escribe a PostgREST directo), pero el CHECK aplica en el upsert/update del connector:

| Input M3.1 | Columna destino | Cota server-side | Origen |
|---|---|---|---|
| Condición corporal | `condition_score_events.score` | `CHECK (score IN (1.00,1.25,…,5.00))` — set discreto exacto | `0028:8-10` |
| product_name (vacunación/antiparasitario/antibiótico) | `sanitary_events.product_name` | `CHECK char_length <= 160` | `0070:227` |
| tube_number (sangrado/raspado) | `lab_samples.tube_number` | `CHECK char_length <= 64` | `0070:241` |
| pajuela (inseminación, va en notes) | `reproductive_events.notes` | `CHECK char_length <= 4000` | `0070:218` |
| teeth_state | enum `teeth_state_enum` (selector cerrado) | enum DB | 0020 |
| heifer_fitness | enum (apta/no_apta/diferida) | enum DB | 0053 |
| pregnancy_status / service_type / event_type / sample_type | enum / selector cerrado | enum DB | 0026/0027/0029 |
| weight_kg | numeric > 0 (keypad acotado + CHECK) | DB | 0025 |

Los CHECK de 0070 son `NOT VALID` pero IGUAL enforzan todo INSERT/UPDATE futuro (Postgres solo saltea la validación retroactiva de filas existentes) → la cota contra storage-exhaustion se cumple. **Ningún input de M3.1 queda sin cota autoritativa server-side.** No se requiere Gate 1 puntual / DDL nuevo.

## FOCO 4 — Gating de la OR es server-side (0091)

**Confirmado: ninguna decisión de seguridad delegada exclusivamente al cliente.** La capa 1 (`maneuver-gating.ts`, `MANEUVER_DATA_KEY_REQS` con `match` all/any) es UX (ofrecer/omitir maniobra por rodeo). La autoridad es 0091:
- `tg_sanitary_events_gating` (`0091:76-95`) ramifica: `vaccination`→`vacunacion`; `deworming`→OR `antiparasitario_interno`/`externo` (vía `assert_any_data_key_enabled`, umbral `>=1`, fail-closed); `treatment`→`antibiotico`.
- `assert_any_data_key_enabled` (`0091:35-69`): resuelve el rodeo del perfil INLINE (no confía en input del cliente), fail-closed si rodeo null, SECURITY DEFINER + EXECUTE revocado. Espeja la propiedad fail-closed de `assert_data_keys_enabled` (0054).
- La OR (`deworming`) y los single-key (`treatment`/`vaccination`) re-validan al subir aunque la UI nunca lo hubiera ofrecido (defensa en profundidad, R7.7). El binding OR-vs-AND tiene test dedicado (contraste con el tacto multi-key AND).

## FOCO 5 — Multi-write (raspado 2 samples / vacunación N)

**Sin path de write parcial cross-tenant.** El orquestador corre el array de writes en orden (`maneuver-events.ts:63-67`); cada write es un CrudEntry independiente. Todos los writes del array comparten el MISMO `profileId` + `sessionId` (derivados del contexto) → no hay forma de que un id manipulado en el multi-write apunte a un tenant distinto: cada INSERT pasa la RLS INSERT (perfil propio) + el tenant-check de session. El raspado en hembra (R6.12) es un filtro de UX (`appliesToAnimal`, `maneuver-applicability.ts:43-44`); forzarlo solo escribe un lab_sample legítimo del propio establishment, gateado por `raspado_toros` enabled. Un write parcial (raro: error de SQLite local) deja los writes ya corridos locales (offline-first los sube) — no es un hueco de seguridad.

## FOCO 6 — Offline + secrets

**Offline no evade validación server-side.** El camino CRUD-plano → CrudEntry → connector → PostgREST aplica RLS + triggers + CHECKs al subir (`connector.ts:69-93`, banner explícito). Un rechazo (RLS 42501 / check 23514 / FK 23503) se clasifica `permanent_reject` → descarte + log observable sin filtrar `opData` (`connector.ts:96-106`, `surfaceUploadRejection` solo loguea table/op/code). La re-autorización en replay la garantiza la RLS server-side (no se confía en la autorización que tenía el cliente offline) — `change_member_role` revoca la sesión (R10.2, verificado por la suite edge).

**Secrets: cero hardcode.** Grep de api_key/secret/service_role/password/bearer/JWT/establishment_id-literal sobre los 7 archivos del alcance → NINGUNO. `console.log` del connector (`connector.ts:44-48`) loguea solo booleanos + endpoint público (NUNCA el valor del token, convención de supabase.ts).

---

## Checklist RAFAQ-específico (ángulo de security que el reviewer no cubre)
- **RLS de las tablas tocadas testeada cross-tenant**: la suite backend de maniobras (T2.4c deworming/treatment + el resto) corre verde; el tenant-check y el gating tienen tests server-side. Los builders nuevos tienen unit con node:sqlite (ejecución real, no string-match).
- **Edge Functions nuevas**: ninguna en M3.1 (frontend puro). N/A.
- **Triggers nuevos en DB**: ninguno en M3.1 (0091 es de M3.0-backend, ya gateada en su Gate). Los triggers que protegen M3.1 (0052/0054/0056/0021/0022) son preexistentes, todos SECURITY DEFINER + EXECUTE revocado donde corresponde.
- **Secrets / console.log**: limpio (ver Foco 6).

## Catálogo de dominios — cobertura
- **A (authz objeto/función)**: A1 service-role bypass → N/A (M3.1 no usa `createAdminClient()`, todo CRUD-plano bajo RLS del usuario). A2 mass assignment → los builders arman el INSERT campo por campo (whitelist explícita), no spread de input; `created_by`/`establishment_id`/`id` no vienen del cliente. A3 IDOR por FK → cubierto (RLS INSERT por `establishment_of_profile`). A4 BFLA → N/A (sin RPC/EF nueva).
- **B (exposición)**: B1 `err.message` crudo → el connector NO devuelve mensajes al cliente, solo loguea table/op/code. B2/B3 → sin select nuevo; los reads de M3.1 son builders locales de columnas acotadas.
- **C (offline/sync)**: C4 stale-auth en replay → cubierto (RLS re-autoriza al subir). C1 PowerSync sync rules / C3 data-at-rest → fuera de alcance de M3.1 (no se tocan reglas de sync ni storage local; pendiente arquitectónico general, no introducido por este chunk).
- **E/F/G/H/I**: sin inputs concatenados en `.or()/.filter()`/ilike/prompt (F1); sin ingesta de archivos / fetch a URL de usuario (F2/F3); BLE (G) fuera de alcance de M3.1; sin cambios de auth/sesión/compliance.

## False positives descartados (trazabilidad)
- **"Los UPDATE de corrección filtran solo por `id` → IDOR"**: descartado. La RLS UPDATE de las tablas de evento (`using (is_owner_of(...) or created_by = auth.uid())`, ej. `0025:40-45`, `0026:67-70`, `0028:31-34`) restringe a filas propias del usuario; el `.eq('id', op.id)` del PATCH no alcanza filas ajenas. Misma lógica para animal_profiles (Foco 2).
- **"Interpolación `${table}`/`${synced}` en local-reads.ts → SQL injection"**: descartado. Valores server-controlled (union literal cerrado / constantes SQL internas / placeholders generados), no input de usuario, y fuera del alcance M3.1.
- **"session_id arbitrario del cliente → cross-tenant write"**: descartado. `tg_event_session_tenant_check` (0052/0056) fail-closed.
- **"raspado en hembra / CUT en ternero gateado solo en cliente"**: no es finding de seguridad. Es filtro de UX; el server cubre el tenant + el rodeo + la categoría válida. Forzarlo no cruza tenants ni mete dato prohibido.

---

## Archivos analizados
- `app/src/services/maneuver-events.ts` (orquestador multi-write)
- `app/src/utils/maneuver-event-query.ts` (binding maniobra→write, ramas por value.kind)
- `app/src/services/powersync/local-reads.ts` (builders nuevos 1186-1564)
- `app/src/utils/maneuver-gating.ts`, `maneuver-step-kind.ts`, `maneuver-sequence.ts`, `maneuver-applicability.ts`
- `app/app/maniobra/carga.tsx`
- Verificación server-side (barrera real): `connector.ts`, `upload.ts`; migraciones 0021, 0022, 0025, 0026, 0028, 0052, 0054, 0056, 0070, 0091.

## Cobertura indirecta (advertencia)
La skill `sentry-skills:security-review` no cubre nativamente RLS de Postgres ni el modelo PowerSync (CRUD-plano → PostgREST). Esos dominios — que son justamente la barrera de seguridad de M3.1 — se revisaron MANUALMENTE leyendo las RLS/triggers aplicados y trazando el data flow cliente→connector→PostgREST. La conclusión PASS se apoya en esa verificación manual, no solo en el pattern-matching de la skill.

---

## check.mjs
RC=0 del proceso, pero el resumen marca FAIL por **1 test rojo**: `R10.2: change_member_role ... Request rate limit reached` en `supabase/tests/edge/run.cjs` (suite de Edge Functions de spec 13). Es el **flake de rate-limit de auth de Supabase por terminales paralelas** documentado en memoria del proyecto (`reference_check_red_rate_limit.md`): `signIn ... Request rate limit reached`. NO es regresión ni finding de seguridad, y NO toca ningún archivo de M3.1. Las suites relevantes a M3.1 pasaron verdes: typecheck client OK, anti-hardcode 0 violaciones, y `maneuver-event-query.test`, `maneuver-applicability.test`, `maneuver-gating.test`, `maneuver-step-kind.test`, `maneuver-sequence.test`, `local-reads.test`, `maneuver-reads.test`, `upload.test` en la batería verde.

## NO done
Reporte de Gate 2. La decisión final (puerta humana) es de Raf.
