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
