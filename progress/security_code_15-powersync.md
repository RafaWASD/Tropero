# Security Gate 2 (modo code) — 15-powersync

> Archivo acumulativo por runs. Los gates de runs anteriores de esta feature viven en archivos propios:
> `security_code_15-powersync-run1.md`, `security_code_15-powersync-run2.md`, `security_code_15-powersync-t5t6.md`.
> NO se reescriben — cada run nuevo agrega una sección acá.

---

## Run bugfix-overlay-list (2026-06-10)

### Veredicto: PASS

Auditoría del diff SIN commitear del working tree (no hay `baseline..HEAD` para este run; alcance = `git status --porcelain`). Skill `sentry-skills:security-review` corrida sobre el diff: **no high-confidence vulnerabilities**. Checklist RAFAQ complementario: sin findings HIGH ni MEDIUM.

### Alcance auditado

| Archivo | Tipo |
|---|---|
| `app/app/(tabs)/animales.tsx` | Modificado — refactor: búsqueda extraída a `runSearch` (useCallback) + re-ejecución en `useFocusEffect` y en el efecto de `lastSyncedMs`. |
| `app/e2e/animals-offline.spec.ts` | NUEVO — 2 tests E2E offline (`context.setOffline(true)`). |
| `docs/backlog.md`, `specs/active/15-powersync/{design,tasks}.md`, `progress/*` | Docs — escaneados solo por fuga de secrets. |

`git diff --name-only -- app/src/` → **vacío**: services, builders SQL y utils intactos (verificado, no asumido).

### Findings HIGH de Sentry

Ninguno. La skill no reportó vulnerabilidades high-confidence sobre el diff.

### Findings RAFAQ-SPECIFIC

Ninguno HIGH ni MEDIUM.

### Verificación de los focos del run

**1. Multi-tenant (`runSearch` + establishment stale) — OK.**
`runSearch` cierra sobre `establishmentId` derivado de `EstablishmentContext` (`animales.tsx:92`, `estState.status === 'active' ? estState.current.id : null`) — nunca hardcodeado. Deps del callback: `[establishmentId, debouncedQuery]` (`animales.tsx:175`) → al cambiar de campo, los tres consumidores (`useEffect[runSearch]`, `useFocusEffect`, efecto `lastSyncedMs`) se re-registran con la identidad nueva. El seq-guard se conserva textual: `searchSeq` se incrementa SINCRÓNICAMENTE al inicio de cada invocación (`animales.tsx:165`) y el resultado en vuelo de la invocación vieja se descarta (`if (seq !== searchSeq.current) return`, línea 168). Si `establishmentId` pasa a `null` → `setSearchResults([])` inmediato. Ventana residual teórica (un resultado en vuelo del campo A resolviendo entre el commit del render con campo B y el re-run del efecto): **pre-existe idéntica al refactor** (el efecto inline viejo tenía la misma estructura), dura un ciclo de efecto, y los datos son del MISMO usuario autorizado en ambos campos (cambiar de campo requiere membresía) → staleness transitorio de UI, no fuga de autorización. No introducido por este run; no es finding.

**2. Inputs del buscador — OK, sin cambios en el camino al SQL.**
El fix no agregó interpolación de strings en SQL ni tocó la sanitización: el término sigue el camino as-built `TextInput maxLength={SEARCH_TERM_MAX_LENGTH}` (`animales.tsx:417`, 64 chars, intacto) → `classifySearchQuery` (re-cap a 64 en la util pura, `animal-identifier.ts:120` — el tope NO depende del TextInput, así que bypassear la UI no lo bypassea) → builders parametrizados en `local-reads.ts`: `buildSearchByTagQuery`/`buildSearchByIdvQuery` con `= ?` (líneas 565-576), `buildSearchLikeQuery` con `LIKE ? ESCAPE '\'` + `escapeLike` que neutraliza `% _ \` (líneas 594-611) + columna restringida por whitelist de tipo literal TS (no input). Scoping por `establishment_id` + `deleted_at IS NULL` + `LIMIT 20` en cada sub-query. Nada de esto está en el diff (`app/src/` sin cambios). La validación autoritativa server-side del buscador ya era as-built (RLS como barrera real, R10.2) y este run no toca services — confirmado.

**3. Instrumentación de debug residual — LIMPIO.**
`grep -rn "__rafaqDebug|DumpOverlay|debugDump|window.__|globalThis.__"` sobre `app/` → **0 matches**. `provider.tsx` no figura en `git status` (el hook temporal `__rafaqDebugDumpOverlay` no sobrevivió). Sin window-hooks ni logs nuevos que filtren datos de campo/tokens.

**4. E2E nuevo y secrets — OK.**
`animals-offline.spec.ts`: la captura de consola del page (`consoleLines`, líneas 66-67 y 128-129) se imprime SOLO dentro del `catch` al fallar el oráculo (líneas 115 y 181) — diagnóstico, no logging permanente. Lo capturado es la consola del browser: la app no loguea tokens (connector auditado en runs previos; el único marker esperado es el warn `[powersync] upload rechazado (descartado)`, que no contiene credenciales). El password de fixtures (`TEST_PASSWORD`) y la service_role key viven en helpers PRE-existentes (`e2e/helpers/admin.ts` / `env.ts`, fuera del diff): service_role solo node-side vía env, nunca en el browser; el spec nuevo no introduce ningún secret ni los loguea. `RAFAQ_E2E_BASE_URL` es env opcional de diagnóstico (server-controlled). Teléfono seedeado es fake (`1123456789`).

**5. Rate limits / amplificación remota — N/A confirmado.**
El fix re-dispara `loadList`/`runSearch` al re-enfocar la tab y al avanzar `lastSyncedMs`, pero ambos terminan en **SQLite local** (`runLocalQuery` de PowerSync) — cero llamadas remotas nuevas; el diff no amplifica tráfico a Supabase/PowerSync. Las queries locales están acotadas (debounce 250ms, `LIMIT 20`, term cap 64). Nota no-security (perf, territorio del reviewer, ya APPROVED): el efecto de `lastSyncedMs` ahora tiene `runSearch` en deps, así que también re-corre `loadList` en cada cambio de query debounced — queries locales extra, acotadas, sin impacto de seguridad.

**Docs sin secrets**: `git diff` de `docs/backlog.md`, `specs/active/15-powersync/*`, `progress/*` escaneado contra `eyJ|service_role|api_key|secret|Bearer|token=` → 0 matches.

### False positives descartados

- *(skill)* Ningún finding emitido → nada que descartar. Patrón `ap.${column} LIKE ?` en `local-reads.ts:597` evaluado proactivamente: la interpolación es de `column`, un parámetro tipado como unión literal TS elegida por el service (no input de usuario); el término viaja como placeholder. No es inyección. Además está fuera del diff.
- *Carrera establishment-switch con búsqueda en vuelo* (foco 1): pre-existente, mismo usuario autorizado, transitoria — no introducida por el refactor, no es fuga de authz.

### Tabla de inputs (campos nuevos/modificados que el usuario tipea)

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| Buscador de animales (`query`, único input tocado por el diff — solo se movió el CONSUMO, no la captura) | 64 chars (`maxLength` UI + re-cap en `classifySearchQuery`, util pura — no bypasseable saltando la UI) | Parametrizada en sink local (`?` + `escapeLike` + columna whitelist + LIMIT 20); server-side: RLS as-built (R10.2) | OK |

El diff no agrega ningún campo de entrada nuevo.

### Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Re-ejecución de búsqueda/lista al re-foco y al avanzar sync | n.a. | — | — | Queries 100% locales (SQLite PowerSync), debounced 250ms, LIMIT 20. Sin llamadas remotas → no aplica rate limit. |

El diff no toca Edge Functions, email/SMS, APIs externas, bulk ni `config.toml`.

### Archivos analizados

- `app/app/(tabs)/animales.tsx` (diff completo + archivo entero)
- `app/e2e/animals-offline.spec.ts` (completo)
- `app/src/services/animals.ts` (searchAnimals — verificación de sink, fuera del diff)
- `app/src/services/powersync/local-reads.ts` (builders + escapeLike — verificación de sink, fuera del diff)
- `app/src/utils/animal-identifier.ts` (cap 64 — fuera del diff)
- `app/e2e/helpers/{admin,env,ui}.ts` (manejo de service_role/password — pre-existentes, fuera del diff)
- Diffs de `docs/backlog.md`, `specs/active/15-powersync/{design,tasks}.md`, `progress/*` (scan de secrets)

### Cobertura indirecta

- La skill de Sentry no modela PowerSync/SQLite local ni RN — los focos de overlay/sync se cubrieron con revisión manual (este checklist).
- Encriptación at-rest de la SQLite local (dominio C3 del catálogo) sigue siendo deuda declarada de la feature 15 (ya registrada en gates previos de esta feature) — fuera del alcance de este run de bugfix UI.

---

## Run create-animal-rpc — Gate 2 (2026-06-10)

### Veredicto: PASS

Gate 2 post-reviewer del residuo NO auditado por el Gate 1 de este run + sweep formal. Skill `sentry-skills:security-review` corrida sobre el diff completo del working tree (modificados + untracked `0083_create_animal_rpc.sql` / `animals-offline.spec.ts`): **no high-confidence vulnerabilities**. Checklist RAFAQ complementario: 0 HIGH, 0 MEDIUM nuevos.

### (1) Código auditado por Gate 1 — SIN cambios posteriores (verificado contra contenido, no asumido)

- **`supabase/migrations/0083_create_animal_rpc.sql`** (untracked, leída completa, 189 líneas): coincide 1:1 con lo que el Gate 1 aprobó y la bitácora describe — guard (a) `has_role_in(p_establishment_id)` ANTES de toda escritura con 42501 genérico; (a-bis) corte temprano de replay por perfil existente (id+animal+establishment ya autorizado, sin filtro `deleted_at` a propósito → no resucita); (b) INSERT `animals` `ON CONFLICT (id) DO NOTHING` (target SOLO PK → `animals_tag_unique` NO se absorbe); (b-bis) guard anti-IDOR con matcheo de identidad `IS NOT DISTINCT FROM` + `deleted_at is null` → 42501 genérico sin oráculo; (c) INSERT `animal_profiles` `ON CONFLICT (id) DO NOTHING`, NO setea `created_by` (0043 lo fuerza desde auth.uid() del caller) ni identidad denormalizada (0079); (c-bis) guard post-insert (perfil = animal+establishment del intent); `language plpgsql security definer set search_path = public`; sin SQL dinámico (cero EXECUTE/format → sin superficie de inyección); `revoke from public, anon` + `grant to authenticated` con la firma tipada completa de 20 args (1:1 con la declaración) + `notify pgrst` + begin/commit. El md5(prosrc) remoto ya fue verificado por el leader contra este archivo.
- **`upload.ts` / `connector.ts`**: el diff actual es EXACTAMENTE el descripto en `impl_15-powersync.md` (run create-animal-rpc) y gateado: `mapIntentToRpc` traduce el shape histórico `{animals, animal_profiles}` a los 20 args `p_*` campo por campo (**whitelist explícita** — no spread del payload: mass assignment n.a.; `p_establishment_id` viaja del intent pero la RPC re-deriva la autorización con `has_role_in` contra el JWT real del caller → sin inyección de autoridad); sin ids de cliente → `PermanentIntentError`; en connector muere la rama de 2 upserts y todo intent (b) va por `supabase.rpc`. Sin ediciones post-gate detectadas (contenido = bitácora = review APPROVED).
- `outbox.ts` / `animals.ts`: solo comentarios/docs (verificado en el diff — cero cambio de lógica).

### (2) Residuo NO mirado por Gate 1 — auditado acá

- **`app/e2e/helpers/admin.ts` — `waitForServerAnimalProfile` (nuevo)**: sigue el patrón pre-existente del archivo — usa el client `admin` module-level construido desde `getE2EEnv().serviceRoleKey` (env, node-side, "NUNCA en el browser", igual que el resto de helpers). La key NUNCA se loguea ni se interpola en mensajes: el `throw` en error de query incluye solo `error.message` de PostgREST (output de test node-side, no canal cliente) y el timeout-throw incluye `establishmentId` + `match` (idv/visual de fixture — datos de test, no secretos). Query parametrizada vía `.eq()/.is()` + `limit(1)`. Sin polling infinito (30 × 2s, acotado). OK.
- **`app/e2e/animals.spec.ts`** (diff): solo suma el import + la llamada al oráculo con `establishmentId` del seed propio. Cero secrets, cero prints nuevos. OK.
- **`app/e2e/animals-offline.spec.ts`** (extensión del test 1; el resto ya gateado en el run anterior): el bloque nuevo agrega `setOffline(false)` + oráculo admin + un diag-print más (`[diag] consola del page al fallar (drenado)`) con el MISMO patrón ya aceptado — imprime la consola del browser SOLO dentro del `catch`; la app no loguea tokens (re-verificado abajo) y el único marker esperado (`upload rechazado`) no contiene credenciales. El assert de `rejected` imprime esas mismas líneas del warn (solo `table/op/code`). OK.
- **`supabase/tests/animal/run.cjs`** (suite nueva, 7 casos): test file node-side con el patrón pre-existente (`admin` service-role para asserts de estado + clients de usuario para el ataque). Los casos 4 y 7 son exactamente los tests negativos cross-tenant/anti-IDOR que el Gate 1 exigió. Sin secrets hardcodeados (grep del diff: 0 matches). OK.
- **Diffs de docs/specs/progress**: scan de secrets (`eyJ…|service_role|api_key|secret|bearer|token=|sbp_|sk-`) → 0 matches (única mención: prosa "vía service_role" en el doc-comment del helper). OK.

### (3) Sweep formal (skill) + checklist RAFAQ

- **Skill `sentry-skills:security-review`**: 0 findings high-confidence. Data flow trazado: el único input attacker-controlled nuevo que cruza al server es el payload del intent (device comprometido / curl) → llega a la RPC como 20 args tipados (uuid/date/numeric/boolean castean o revientan 22P02→permanent_reject; textos pasan por nullif/trim + casts a enum + CHECKs 0070 + UNIQUEs de dominio dentro del DEFINER) y la autorización NUNCA sale del payload (`has_role_in` + guards b-bis/c-bis sobre las filas reales). Sin SQL dinámico, sin `.or()/.filter()` con texto libre, sin fetch externo, sin Edge Functions, sin cambios de `config.toml`.
- **Fix del buscador (`animales.tsx`, run anterior)**: el sweep NO encontró nada nuevo → su Gate 2 PASS previo queda intacto (no se reabre).
- **B1 (err.message al cliente)**: los 42501 de la RPC son mensajes genéricos fijos ("not authorized…", "…does not match this create intent") sin datos de la fila ajena; `surfaceUploadRejection` (pre-existente) loguea solo `{table, op, code}` — sin `error.message`, sin datos de campo. OK.
- **Instrumentación de debug residual**: grep `__rafaqDebug|DumpOverlay|debugDump|window.__|globalThis.__` sobre código propio (`app/src`, `app/app`, `app/e2e`) → **0 matches** (todos los hits son node_modules). Logs del camino del connector sin cambios en este run: `fetchCredentials` loguea solo booleanos + endpoint público (NUNCA el token — nota: ese log lleva un `TODO(debug 15-powersync): quitar tras diagnosticar` PRE-existente, fuera de este diff; no filtra nada, queda como recordatorio de limpieza no-security). OK.

### False positives descartados

- *(skill)* Sin findings emitidos. Evaluado proactivamente: el oráculo residual de (b-bis) — atacante que conoce UUID + identidad EXACTA de un huérfano ajeno podría "reclamarlo" — ya fue aceptado en Gate 1 (mismo perfil de riesgo que 0081: UUIDs cliente no enumerables, `animals` no sincroniza cross-tenant, `animal_profiles_active_animal_unique` bloquea animales vivos). No se reabre.
- *`p_establishment_id` viene del cliente*: NO es inyección de autoridad — es el scope SOLICITADO; la RPC valida con `has_role_in` contra el JWT. Patrón idéntico a la policy INSERT as-built de `animal_profiles` (0022).
- *`error.message` en throws de helpers E2E*: node-side, output de test (no respuesta a cliente). El criterio B1 aplica a respuestas server→cliente, no a diagnóstico de suite.

### Tabla de inputs (nuevos/modificados que cruzan al server)

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| Payload del intent `create_animal` (20 args p_*) | tipos PG (uuid/date/numeric/boolean/text) + CHECKs 0070 (textos ≤64) + enums `animal_status`/`teeth_state_enum` + UNIQUEs de dominio + triggers 0019/0021/0043/0079 | server (autoritativa, dentro del DEFINER; authz `has_role_in` + guards anti-IDOR; 22P02/23505/23514/42501 → permanent_reject sin loop) | OK |

El diff no agrega ningún campo de UI nuevo (el form de alta es el ya gateado; solo cambió el camino de subida).

### Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Drenado outbox → `supabase.rpc('create_animal')` | n.a. (mismo PostgREST que el alta online pre-existente; 1 op = 1 animal, sin fan-out) | per-user (JWT) | sí (sin sesión no conecta; sin rol → 42501) | sin EF nueva, sin email/SMS/API externa, sin amplificación. `config.toml` intacto. |
| Polling del oráculo E2E (admin) | acotado (30×2s) | n.a. (suite node-side) | sí (throw) | no es superficie de producción. |

### Archivos analizados

`supabase/migrations/0083_create_animal_rpc.sql` (completa) · `app/src/services/powersync/{upload,connector,outbox}.ts` + `app/src/services/animals.ts` (diffs + contexto) · `app/src/services/powersync/upload.test.ts` (diff, scan) · `app/e2e/helpers/admin.ts` (diff + patrón del archivo) · `app/e2e/animals.spec.ts` (diff) · `app/e2e/animals-offline.spec.ts` (completo) · `supabase/tests/animal/run.cjs` (diff) · diffs de `docs/ specs/ progress/` (scan de secrets).

### Cobertura indirecta

- La skill no modela plpgsql/SECURITY DEFINER ni PowerSync → la RPC y el camino del connector se cubrieron con revisión manual (este checklist + Gate 1 de este run, que sigue vigente: el código no cambió post-gate).
- Deudas ya registradas que NO cambian con este run: SQLite local sin encriptación at-rest (C3, backlog/ADR pendiente); MED `p_entry_weight` sin CHECK de rango (Gate 1 de este run, a cerrar con MED-01 de C3.3); surfacing UI de rechazos permanentes (backlog del implementer); TODO(debug) del log de `fetchCredentials` (pre-existente, no filtra valores).

---

## Gate 2 — Run cierre-T7 (2026-06-10)

### Veredicto: PASS — 0 HIGH / 0 MEDIUM / 3 LOW (anexo)

Run de SOLO tests (Fase T7: suite de no-bypass de sync streams + E2E de evento simple offline + docs). Alcance verificado contra `git status --porcelain` (NO `main...HEAD` — trabajamos sobre main sin commitear; `baseline_commit` `1618a956…` consta en `progress/impl_15-powersync.md:1` y este run no agrega commits): `supabase/tests/sync_streams/run.cjs` (NUEVO, 631 líneas), `scripts/run-tests.mjs` (+6 líneas, hookup línea 76), `app/e2e/animals-offline.spec.ts` (+1 test T7.3), `app/e2e/helpers/admin.ts` (+`waitForServerWeightEvent`), + docs/specs/progress. Confirmado: **cero** cambios en `supabase/migrations/`, `supabase/functions/`, `sync-streams/`, `supabase/config.toml`, `app/src/` (el diff stat no los lista). Excluidos por instrucción del leader (cambios del leader, no del run): `docs/backlog.md`, `progress/current.md`, `specs/active/02-modelo-animal/context-c6-categoria-espejo.md`.

Skill `sentry-skills:security-review` corrida sobre el diff con metodología completa (trace de data flow + exploitability): **no high-confidence vulnerabilities**. Checklist RAFAQ + catálogo A–I sobre código de test: 0 HIGH, 0 MEDIUM.

### Findings HIGH de Sentry

Ninguno.

### Findings RAFAQ-SPECIFIC

Ninguno HIGH ni MEDIUM.

### Verificación de los 5 focos del gate

**1. Credenciales service_role — OK (mismo mecanismo que las suites existentes, sin fuga).**
- `sync_streams/run.cjs:46-58`: loader de `.env.local` **idéntico carácter a carácter** al de `rls/run.cjs` y `run-tests.mjs:22-33` (mismo regex, mismo "no pisa env existente"). `.env.local` está gitignored (verificado: `git check-ignore` → `.gitignore:25`).
- Keys SOLO desde env (`run.cjs:71-73`); si faltan → `process.exit(2)` con mensaje que lista NOMBRES de vars, no valores (`run.cjs:76-79`). Fail-closed.
- Cero `console.log` de keys en toda la suite: los únicos prints son `console.error('cleanup …', error.message)` (`run.cjs:300,304,308`) — mensajes PostgREST node-side, sin credenciales. `run-tests.mjs:36-37` imprime el LABEL y el COMANDO (`node --test supabase/tests/sync_streams/run.cjs`) — las keys viajan por `process.env` heredado, nunca en la línea de comando.
- Nada se escribe a archivos: la suite no tiene ningún `fs.writeFile*` (solo 2 `readFileSync`: `.env.local` y `sync-streams/rafaq.yaml`, ambos locales y read-only).

**2. Enganche en run-tests.mjs — no debilita nada.**
- La línea nueva (`run-tests.mjs:76`) se agrega DENTRO del bloque `if (process.env.SUPABASE_SERVICE_ROLE_KEY)` existente, DESPUÉS de las 6 suites previas — ninguna suite se movió, des-gateó ni envolvió en try/catch.
- Propagación de fallos intacta: `run()` usa `execSync(..., { stdio: 'inherit' })` (`run-tests.mjs:38`) → exit code ≠ 0 de `node --test` lanza, no hay catch en todo el script → el proceso muere non-zero. Un test rojo de la suite nueva ROMPE el check completo, igual que las demás.
- El skip sin key (`run-tests.mjs:78`) es PRE-existente (CI sin credenciales) y no cambió de semántica. Nota cosmética en anexo LOW-3.

**3. Datos sembrados en la DB beta real — higiene OK.**
- **Namespacing**: 4 usuarios (`A`, `B`, `CoA`, `ownerD`) con emails `${RUN_TAG}_<label>@rafaq-test.local` (`run.cjs:94`) — dominio no ruteable, RUN_TAG único por corrida (`run.cjs:82`); establishments/rodeos/lotes/invitación con nombre prefijado `RUN_TAG`. No colisiona con data real ni con otras suites (`@rafaq-e2e.test` del E2E es namespace distinto).
- **No interferencia con data real**: todos los asserts son RELACIONALES entre los dos tenants propios (A↔B) o sobre ids propios — nunca conteos absolutos ni asserts sobre filas ajenas (el header `run.cjs:25-28` lo declara y el código lo cumple). Las únicas lecturas fuera de lo sembrado son catálogos globales read-only (`lookupSpeciesSystem`, test de catálogos `run.cjs:580-587` con `head:true` count) y las queries de scope acotadas por `.in('establishment_id', scope)` donde scope = SOLO los campos del actor de test. Cero UPDATE/DELETE sobre ids no trackeados.
- **Cleanup**: `cleanup()` (`run.cjs:288-310`) borra por ids TRACKEADOS (establishments con CASCADE + pre-paso reproductive_events por el FK sin cascade de birth_calves, animals, y `auth.admin.deleteUser` por usuario — incluye `ownerD` y el estD soft-deleteado del test R8.2, que sí se trackean en `seedEstablishment`/`createTestUser`). Corre como subtest final: con `node:test`, un `await t.test(...)` que FALLA un assert NO lanza en el padre → los subtests siguientes (incluido cleanup) corren igual. Orfandad solo ante kill duro del proceso → anexo LOW-2.
- **Password**: `PASSWORD = 'TestPassword!Aa1'` (`run.cjs:83`) — constante de fixture IDÉNTICA a la pre-existente de `rls/run.cjs:61` (mismo valor, mismo patrón). Evaluado como no-finding (ver false positives).

**4. Oráculo E2E `waitForServerWeightEvent` (admin.ts:342-365) — sin expansión de service_role.**
Misma clase de capacidad que el `waitForServerAnimalProfile` ya gateado (run create-animal-rpc): SELECT read-only sobre `weight_events` parametrizado vía `.eq('establishment_id', …)` + `.eq('weight_kg', …)` + `.is('deleted_at', null)` + `limit(1)`, scopeado al establishment QUE EL PROPIO TEST sembró. Polling acotado (30×2s). Los throws incluyen solo `error.message` PostgREST / establishmentId / peso de fixture — node-side, sin credenciales. El test nuevo en `animals-offline.spec.ts` reusa el patrón diag-print ya aceptado (consola del browser SOLO en `catch`; re-verificado HOY que `connector.ts:44-48` sigue logueando solo booleanos + endpoint público, nunca el token) y el teléfono seedeado es fake. Service_role nunca cruza al browser (helper node-side, patrón `env.ts` intacto — fuera del diff).

**5. Catálogo A–I sobre el diff** — A: todas las queries admin nuevas están scopeadas a ids/scopes creados por la corrida (n.a. como superficie de producción; sin `.insert(body)`/spread — payloads campo por campo). B1: n.a. (output de suite, no respuesta server→cliente). B2: emails/teléfonos sembrados son sintéticos. C: la suite VALIDA C1 (es el test de no-bypass de streams exigido por el Gate 1); C3 (SQLite sin encriptar) sigue como deuda declarada, sin cambios. D: sin imports remotos (todo `node:` + `app/node_modules` local), sin secrets hardcodeados (scan `eyJ|sbp_|sk-|service_role.*=` sobre el diff → 0 matches de valores), sin CI tocado. E/F: sin superficie de producción nueva; las 2 lecturas de archivo son paths constantes del repo. G/H/I: no tocados por el diff.

### False positives descartados

- **`PASSWORD = 'TestPassword!Aa1'` hardcodeado (`run.cjs:83`) + `TEST_PASSWORD` E2E**: matchea el patrón "Always Flag (Secrets)" de la skill, pero NO es un secret de producción — es el password de usuarios de fixture descartables, idéntico al pre-existente en `rls/run.cjs:61` (patrón ya gateado en runs previos). Exploitability real: aun si un usuario de test quedara huérfano (kill duro antes del cleanup), un atacante con el password repo-público obtendría… una cuenta sin roles privilegiados scopeada por RLS a tenants de test vacíos — exactamente lo mismo que ya obtiene gratis por el **signup abierto** de la app. Cero escalación. No-finding (queda LOW-2 como higiene).
- **`error.message` en throws/`console.error` de cleanup y oráculo**: node-side, diagnóstico de suite — B1 aplica a respuestas server→cliente, no acá (criterio ya asentado en este archivo).
- **Inserts admin que bypassean RLS y triggers de authoría** (`seedAnimalWithEvents` pasa `author_id` explícito, `run.cjs:198-201`): es la mecánica DECLARADA de la suite (computar el sync set con service_role); cada insert está scopeado a los tenants propios y el propio comentario documenta qué invariante NO se está testeando (author_id es de spec 02). No es un debilitamiento del modelo.
- **`require(supabaseJsPath)` con path construido** (`run.cjs:60-62`): path derivado de `__dirname` constante hacia `app/node_modules` del repo — server-controlled, mismo workaround que las suites existentes. No es path traversal.

### Tabla de inputs

El diff no agrega NINGÚN campo que el usuario tipee (es código de test; el form de peso que el E2E ejercita es el as-built de spec 03, ya gateado — el test solo lo opera vía Playwright con un valor numérico de fixture). n.a.

### Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `auth.admin.createUser` ×4 por corrida (suite) + ×1 (E2E) | n.a. (Admin API server-side con service_role, no superficie pública; volumen fijo por corrida) | n.a. | sí (throw si falla) | no pasa por `[auth.rate_limit]` (eso gatea el flujo público, intacto — `config.toml` no está en el diff) |
| `signInWithPassword` del owner A (anon key, `run.cjs:113`) | `sign_in_sign_ups` nativo (intacto) | per-IP nativo | sí | 1-2 logins por corrida, muy por debajo del límite |
| Polling oráculos (suite/E2E, admin) | acotado (30×2s / asserts finitos) | n.a. | sí (throw) | sin amplificación: cada query `limit(1)` o scopeada por ids propios |

Sin Edge Functions, email/SMS, APIs externas, bulk ni cambios de `config.toml` en el diff.

### Anexo LOW

1. **LOW-1 — La suite simula los predicados, no los parsea del YAML**: los predicados org_scope/owner_scope están RE-IMPLEMENTADOS en JS (`run.cjs:245-275`) en vez de derivarse de `sync-streams/rafaq.yaml`; solo 3 asserts leen el YAML real (no-`FROM animals`, no-`est_animals`, no-`FROM users` — `run.cjs:413-420,557-558`). Si mañana alguien afloja un predicado en el YAML (p.ej. quita el `IN org_scope` de una stream), esta suite seguiría verde — la frontera real solo la valida el Gate 1 de streams + el E2E con device real. Es la aproximación declarada por design §7 (aceptada en Gate 1); anotarlo para no sobre-confiar en el verde de esta suite ante CAMBIOS futuros del YAML (todo cambio de `sync-streams/` debe re-pasar Gate 1 igual).
2. **LOW-2 — Orfandad ante kill duro**: si el proceso muere antes del subtest `cleanup` (Ctrl+C/timeout del runner), quedan en la beta usuarios auth con password repo-público + tenants de test. Sin escalación posible (ver false positives), pero higiene: un sweep periódico por `@rafaq-test.local` / `@rafaq-e2e.test` viejos sería deseable (aplica igual a las suites pre-existentes; no es de este run).
3. **LOW-3 — Mensaje de skip desactualizado**: `run-tests.mjs:78` sigue diciendo "RLS + Edge + Animal + Maneuvers suites — SKIPPED" sin mencionar User_private/Import/Sync streams. Cosmético (trazabilidad del skip en CI), cero impacto de seguridad.

### Archivos analizados

`supabase/tests/sync_streams/run.cjs` (completo, 631 líneas) · `scripts/run-tests.mjs` (completo + diff) · `app/e2e/animals-offline.spec.ts` (diff del test T7.3) · `app/e2e/helpers/admin.ts` (completo + diff) · `app/e2e/global-teardown.ts` (invocación de cleanupAll, contexto) · `app/src/services/powersync/connector.ts:38-54` (re-verificación del log de credenciales, fuera del diff) · `supabase/tests/rls/run.cjs` (patrón de referencia, fuera del diff) · `.gitignore` (status de `.env.local`) · diffs de `specs/active/15-powersync/{design,tasks}.md` + `progress/impl_15-powersync.md` (scan de secrets → 0 matches de valores).

### Cobertura indirecta

- La skill no modela PowerSync/sync-rules ni `node:test` — la semántica de la suite (qué frontera testea y qué NO, LOW-1) y la robustez del cleanup se cubrieron con revisión manual.
- Deudas pre-existentes sin cambios en este run: SQLite local sin encriptación at-rest (C3), TODO(debug) del log de `fetchCredentials` (no filtra valores), surfacing UI de rechazos permanentes.

---

## Gate 2 — Run T7.9 (2026-06-10)

### Veredicto: PASS — 0 HIGH / 0 MEDIUM / 2 LOW (anexo)

Run de SOLO tests E2E (T7.9 + cierre in-vivo de T7.8). Alcance verificado contra `git status --porcelain` + `git diff` (working tree sobre main sin commitear; `baseline_commit` `1618a956…` consta en `progress/impl_15-powersync.md:1`). Delta T7.9 auditado: `app/e2e/animals-offline.spec.ts` (5 tests nuevos post-T7.3: parto offline mono/mellizos, baja Venta offline, rollback in-vivo por madre soft-deleteada, contraprueba transitoria + 4 helpers de navegación) y `app/e2e/helpers/admin.ts` (5 helpers aditivos: `waitForServerBirth`, `getServerBirthState`, `waitForServerExit`, `getServerProfileStatus`, `softDeleteProfile`) + docs (`specs/active/15-powersync/{design,tasks}.md`, `progress/impl_15-powersync.md` — scan de secrets sobre los diffs → 0 valores; solo la nota pre-existente de hardening C3). Confirmado: **cero** cambios en `app/src/`, `supabase/migrations/`, `supabase/functions/`, `sync-streams/`, `supabase/config.toml`. Excluidos por instrucción del leader: el delta cierre-T7 ya gateado (`supabase/tests/sync_streams/`, `scripts/run-tests.mjs`, test T7.3, `waitForServerWeightEvent` — sección previa vigente) y los archivos del leader (`docs/backlog.md`, `progress/current.md`, `context-c6-categoria-espejo.md`, reportes). Nota: el delta cierre-T7 además CIERRA el LOW-3 previo (el mensaje de skip de `run-tests.mjs:78` ya lista todas las suites).

Skill `sentry-skills:security-review` corrida sobre el delta con metodología completa (trace de data flow + exploitability): **no high-confidence vulnerabilities**. Checklist RAFAQ + catálogo A–I sobre código de test: 0 HIGH, 0 MEDIUM.

### Findings HIGH de Sentry

Ninguno.

### Findings RAFAQ-SPECIFIC

Ninguno HIGH ni MEDIUM.

### Verificación de los 5 focos del gate

**1. Helper de soft-delete admin (`softDeleteProfile`, admin.ts:563-569) — scopeado y coherente con la clase.**
- Es un `UPDATE animal_profiles SET deleted_at = now()` keyeado por `.eq('id', profileId)` EXACTO — una sola fila, sin predicados anchos (`like`/barridos por nombre), sin spread de payload (un solo campo, `deleted_at`).
- Procedencia del id: el ÚNICO call-site (`animals-offline.spec.ts`, test rollback) le pasa `motherProfileId`, que es el `randomUUID()` generado por `seedAnimal()` del PROPIO test (admin.ts:234) sobre el establishment trackeado de ESA corrida. El test no tiene mecanismo para obtener un UUID ajeno (los helpers nunca leen data fuera del scope sembrado).
- Coherencia de clase: misma forma que las mutaciones admin ya gateadas keyeadas por id exacto (`setUserPhone` admin.ts:85-88, `addMember` admin.ts:257-266). Es soft-delete (no destructivo), reversible, y el hard-delete final lo hace el cleanup por CASCADE del establishment propio. Throw con `profileId` + `error.message` PostgREST node-side, sin credenciales.
- Hardening posible (no exigible): asertar que el perfil pertenece a un establishment trackeado antes de mutar → anexo LOW-2.

**2. Credenciales — mismo mecanismo, sin fuga.**
- Los 5 helpers usan el cliente `admin` module-level pre-existente (admin.ts:41), key vía `getE2EEnv()` (`env.ts:60-85`: solo `process.env` + `.env.local` gitignored; el propio loader documenta y cumple "No imprime NUNCA los valores"). El delta NO toca `env.ts` ni crea clientes nuevos.
- Cero prints de keys: los throws nuevos interpolan SOLO ids de fixture / `error.message` PostgREST / conteos (admin.ts:475-479, 532-535, 568). Los dumps `[diag]` de los tests imprimen la consola del BROWSER (que jamás ve la service_role: el browser corre con anon key + sesión del usuario de test); el único warn relevante capturado es el del connector, que loguea `{table, op, code}` (ver foco 4). Las keys nunca van por línea de comando ni a screenshots (los dumps son `console.log` node-side en `catch`).

**3. Data sembrada y rota a propósito — el cleanup la cubre, sin zombies en la beta.**
- La madre soft-deleteada pertenece al establishment `Campo OfflineRollback` trackeado por `seedEstablishment` (admin.ts:120) → `cleanupAll` la HARD-borra vía `DELETE establishments .in('id', ids)` con CASCADE (el FK row-level ignora `deleted_at`; el flag soft-delete no la salva del cascade).
- Los terneros creados por la RPC en los happy paths (mono/mellizos) nacen con `animal_profiles` del mismo establishment → mismo cascade; sus `birth_calves`/`reproductive_events` los limpia el pre-paso PRE-existente de `cleanupAll` (admin.ts:408-429, ya en HEAD — selecciona perfiles `.in('establishment_id', ids)` SIN filtrar `deleted_at`, así que incluye a la madre rota). En el test de rollback la RPC abortó atómica → 0 filas server-side que limpiar (el propio test lo asserta).
- Residuo real: las filas `animals` (tabla de identidad global, sin FK a establishment) de madres sembradas y terneros RPC quedan huérfanas post-cleanup → anexo LOW-1 (clase pre-existente, sin PII ni linkage de tenant).

**4. Warn `upload rechazado` — B1 limpio.**
- `surfaceUploadRejection` (`app/src/services/powersync/connector.ts:163-176`, PRE-existente, fuera del diff) loguea exactamente `{table, op, code}` — `code` solo si es string (p.ej. `23503`). NO incluye `message`/sqlerrm, ids, ni payload. El detalle interno del server no cruza a la consola del usuario; los tests solo ASSERTAN sobre la presencia/ausencia de ese warn (matching por substring), no lo expanden. El surfacing UI más rico sigue como deuda declarada del implementer (backlog), sin cambios acá.

**5. Catálogo A–I sobre el delta.**
- **A**: todas las queries admin nuevas scopeadas a ids generados por la propia corrida; las 4 de lectura son SELECT (`waitForServerBirth`/`getServerBirthState` por `motherProfileId` propio + `.in('birth_event_id', eventIds)` derivado de él; `waitForServerExit`/`getServerProfileStatus` por id exacto), la única mutación es el soft-delete del foco 1. Sin `.insert(body)`/spread. n.a. como superficie de producción (código de test node-side).
- **B1**: n.a. salvo el warn del foco 4 (limpio). **B2**: teléfono seedeado fake (`1123456789`), emails namespaced `@rafaq-e2e.test`; los dumps `[diag]` solo contienen data de fixture.
- **C**: los tests VALIDAN C4 (re-validación server-side de mutaciones encoladas offline: el rollback prueba que el server rechaza una intención cuya precondición murió entre la edición offline y el sync — exactamente el control que el catálogo exige) y R6.12/R6.10 (no doble-apply bajo at-least-once). C3 (SQLite sin encriptar) sigue como deuda declarada, sin cambios.
- **D**: sin imports nuevos en admin.ts (usa el cliente existente); el spec importa solo de `./helpers/admin` y `@playwright/test`. Sin secrets hardcodeados en el delta. Sin CI tocado.
- **E**: polling acotado (30×2s; `expect.poll` 40s) sobre queries `limit(1)`/`head:true` scopeadas — sin amplificación. **F**: sin concat de input en filtros (todos los args de `.eq/.in` son UUIDs/constantes de fixture; el único `new RegExp(idv)` es un locator Playwright sobre idv numérico propio). **G/H/I**: no tocados.

### False positives descartados

- **service_role mutando data de la beta (`softDeleteProfile`)**: matchea la clase "admin client = RLS bypass" del checklist, pero NO es superficie de producción — es fixture node-side keyeada por id exacto de procedencia propia, misma clase que `setUserPhone`/`addMember` ya gateados. El riesgo residual (invocación futura con un id ajeno) requiere que un test obtenga un UUID de producción, mecanismo que no existe en la suite. Queda LOW-2 como hardening.
- **`page.on('dialog', accept)` global**: auto-acepta el `window.confirm` del aviso suave del parto — comportamiento de test determinista, no bypass de un control de seguridad (el aviso es UX; la validación dura es server-side en la RPC, y justamente el test del rollback prueba que esa validación muerde).
- **Asserts por substring sobre la consola (`'upload rechazado'`)**: acoplan el test al shape del log del connector — fragilidad de test, no seguridad (el reviewer ya lo evaluó).

### Tabla de inputs

El delta no agrega NINGÚN campo que el usuario tipee (es código de test; los forms que ejercita — pesaje, parto, baja — son los as-built ya gateados de specs 03/frontend-02, operados vía Playwright con valores de fixture: peso entero 300-389, sexo por OptionSelector, fecha prefill). n.a.

### Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `auth.admin.createUser` ×5 (uno por test) | n.a. (Admin API service_role, volumen fijo por corrida) | n.a. | sí (throw) | no pasa por `[auth.rate_limit]` público (config.toml fuera del diff, intacto) |
| `signInWithPassword` ×5 (browser, anon key) | `sign_in_sign_ups` nativo (intacto) | per-IP nativo | sí | muy por debajo del límite |
| RPC `register_birth` / `exit_animal_profile` vía app | superficie PRE-existente (gateada en runs previos), invocada como usuario autenticado de test | per-sesión RLS/SECURITY DEFINER | sí | el delta no crea endpoints ni afloja límites |
| Polling oráculos admin (30×2s / poll 40s) | acotado | n.a. | sí (throw) | queries `limit(1)`/`head:true` scopeadas a ids propios |

Sin Edge Functions, email/SMS, APIs externas, bulk ni cambios de `config.toml` en el delta.

### Anexo LOW

1. **LOW-1 — Filas `animals` huérfanas post-cleanup**: `cleanupAll` borra establishments (CASCADE → `animal_profiles`) pero la tabla de identidad global `animals` no cuelga de establishment y nadie la barre → cada corrida deja huérfanas las filas de las madres sembradas (`seedAnimal`, admin.ts:228-232) y de los terneros creados por la RPC. Sin PII ni linkage de tenant (sexo + species_id; los idv de test viven en el profile borrado), sin escalación — higiene de la DB compartida. Clase PRE-existente (seedAnimal es de C2; las altas vía UI de runs previos dejan lo mismo); T7.9 solo suma volumen. Candidato al sweep periódico ya anotado en LOW-2 del gate cierre-T7.
2. **LOW-2 — `softDeleteProfile` sin guard de tenant**: hardening opcional — asertar que el `establishment_id` del perfil ∈ `createdEstablishmentIds` antes del UPDATE, para que un mal uso futuro (id ajeno por bug de un test nuevo) falle cerrado en vez de soft-deletear data real. Hoy no explotable (ver false positives).

### Archivos analizados

`app/e2e/animals-offline.spec.ts` (diff completo del delta, 398 líneas) · `app/e2e/helpers/admin.ts` (completo, 575 líneas: helpers nuevos + clase pre-existente + `cleanupAll` con el pre-paso de birth_calves) · `app/e2e/helpers/env.ts` (completo — mecanismo de credenciales, fuera del diff) · `app/src/services/powersync/connector.ts:163-176` (`surfaceUploadRejection`, fuera del diff — verificación B1 del foco 4) · diffs de `specs/active/15-powersync/{design,tasks}.md` + `progress/impl_15-powersync.md` (scan de secrets → 0).

### Cobertura indirecta

- La skill no modela Playwright/PowerSync/plpgsql — el scoping de los helpers admin, el cleanup en la DB compartida y la semántica del rollback se cubrieron con revisión manual (focos 1-5).
- Deudas pre-existentes sin cambios en este run: SQLite local sin encriptación at-rest (C3), surfacing UI de rechazos permanentes (backlog del implementer), MED `p_entry_weight` sin CHECK (a cerrar con MED-01 de C3.3), orfandad ante kill duro del runner (LOW-2 del gate cierre-T7).
