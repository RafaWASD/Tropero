# Security Gate 2 (code) — e2e-rojos-fix

- **Fecha**: 2026-06-11
- **Baseline**: `0b10f52` (de `progress/impl_e2e-rojos-fix.md`)
- **Modo**: `code` · Skill `sentry-skills:security-review` aplicada sobre el diff scopeado
- **Scope auditado** (SOLO esta tarea): `app/src/contexts/ProfileContext.tsx`, `app/app/(tabs)/mas.tsx`, `app/e2e/rodeos.spec.ts`
- **Scope EXCLUIDO** (otra tarea, ya gateada en `progress/security_code_backlog-flake-repro.md`): `events.ts`, `local-reads.ts(.test)`, `event-timeline.ts(.test)`, `specs/active/15-powersync/design.md`, `progress/current.md`. `docs/backlog.md` (hunks aditivos de docs, sin superficie de código).

## Veredicto: **PASS**

Cero findings HIGH. Todo el estado nuevo (optimista + re-eval reactivo) maneja exclusivamente **data del propio usuario, dentro de la propia sesión**, sin cruce de frontera user/tenant. Detalle por pregunta del foco abajo; 2 anotaciones LOW al backlog (correctness, no seguridad).

---

## Findings HIGH de Sentry

**Ninguno.** La skill (metodología trace-data-flow + verify-exploitability) no identificó patrones vulnerables con input attacker-controlled en el diff. Sin `dangerouslySetInnerHTML`/`innerHTML`, sin SQL interpolado (las queries locales son parametrizadas), sin secretos nuevos, sin `err.message` crudo al usuario (copy genérico en español en `ProfileContext.tsx:127-131` y `mas.tsx` `formError`).

## Findings RAFAQ-SPECIFIC

**Ninguno HIGH/MEDIUM.** Análisis de las 4 preguntas del foco:

### 1. Lifecycle de `pendingOptimisticNameRef` vs `userId` — ¿leak cross-user en re-login? NO

El caso a vigilar del prompt, verificado exhaustivamente. El ref se limpia en **tres** puntos, y dos de ellos cubren todo cambio de identidad:

- `ProfileContext.tsx:139-142` — el efecto con dep `[userId]` hace `pendingOptimisticNameRef.current = null` **sincrónicamente, ANTES** de `loadFor(userId)`. Corre en CUALQUIER transición de userId (A→null, null→B, y el hipotético A→B directo).
- `ProfileContext.tsx:98-105` — `loadFor(null)` (logout) limpia ref + `setNamePhone(null)` + error. El flujo real de re-login pasa obligado por acá: `signOut()` → `status:'unauthenticated'` (`AuthContext.tsx:39/79/145-147`) → userId=null → namePhone y ref anulados → login B arranca de estado vacío.
- `ProfileContext.tsx:123` — confirmación normal (el local read trae el name esperado).

Además, estructuralmente el ref **nunca se muestra**: solo actúa como *gate de descarte* en `ProfileContext.tsx:118-122` (suprime un update, jamás escribe UI). Lo único que se renderiza es `namePhone`, que solo se setea desde (a) `loadFor` con query scopeada al userId de sesión, o (b) `applyOwnProfile` con valores que el propio user tipeó y que `saveProfile(userId, …)` — userId de la sesión — acaba de aceptar. **Conclusión: el optimismo solo puede exponer data del propio user; no hay path por el que el name del user anterior sobreviva un re-login.**

### 2. Re-eval por `lastSyncedAt` — ¿lectura cross-tenant/cross-user? NO

- El efecto (`ProfileContext.tsx:165-169`) solo llama `loadFor(userId)` con el userId de la sesión; `lastSyncedMs` es un timestamp-señal, no transporta datos.
- `loadProfileNamePhone` (`services/profile.ts:31-53`) **no fue tocada por este diff** y su scope no se aflojó: SQL parametrizado `WHERE user_id = ?` con el uid del caller (`local-reads.ts:209-214` phone, `:224-229` name vía `user_roles.member_name`). Defensa en profundidad: el SQLite local solo contiene filas self-only que las streams de PowerSync ya scopearon server-side (`self_user_private` / `est_members/self`) — re-leer más veces no amplía el conjunto legible.

### 3. Path de escritura (`saveProfile`) — ¿cambió / se relajó validación? NO

- `establishments.ts` **no está en el diff** (confirmado por `git status` + `git diff`). `saveProfile` (`establishments.ts:276-306`) sigue idéntico: solo `users.name` y `user_private.phone`, ambos `.eq(...id, userId)` y bajo RLS server-side.
- En `mas.tsx:358-368` el call-site es byte-equivalente en semántica: se extrajo `nextName = name.trim()` (mismo trim que antes) y se mantienen los mismos 2 campos. **No se agregó ningún campo client-settable** (ni `role`, ni `establishment_id`, ni ids). El único cambio de contrato es la firma de `onDone(saved)` (`mas.tsx:340-341`), que es plumbing de display: lleva los valores ya aceptados por el server hacia `applyOwnProfile`. Sin mass assignment, sin spread de body.
- XSS del name optimista: se renderiza vía JSX de React (auto-escaped); además es el mismo valor que igualmente llegaría por sync-down. No flag (framework-mitigated, conforme skill).

### 4. `rodeos.spec.ts` — test-only, ¿secretos/prod? LIMPIO

- El diff solo reemplaza un read-back único por `expect.poll` (líneas ~130-158). **Cero credenciales nuevas**: reusa `supa = anonClient()` cuyas keys salen de `getE2EEnv()` (env vars, `e2e/helpers/admin.ts:22-24`), con `signInWithPassword` del usuario de test **efímero y namespaced** (`@rafaq-e2e.test` + `RUN_TAG`, borrado en `cleanupAll`). `TEST_PASSWORD` es constante pre-existente de fixtures (usuarios desechables), fuera de este diff.
- La query polleada respeta RLS (sesión del propio user) y está scopeada `.eq('establishment_id', estId)` al campo recién sembrado por el test. Apunta a la **DB beta compartida** que toda la suite e2e ya usa (patrón documentado en `admin.ts:8-12`), no a prod. El poll agrega como mucho ~20s de reintentos de un SELECT chico — sin vector de amplificación.

## False positives descartados (trazabilidad)

| Candidato | Por qué NO es finding |
|---|---|
| `applyOwnProfile` expuesto en el context (cualquier componente podría inyectar un name arbitrario) | Estado de display client-side puro (saludo), no persiste ni viaja al server; el cliente es attacker-controlled por definición — inyectarse un saludo a uno mismo no cruza ninguna frontera. |
| Ventana transitoria de `namePhone` stale en un hipotético switch A→B sin pasar por null | (a) El flujo de auth real siempre pasa por `unauthenticated` (logout limpia `namePhone`); (b) la estructura es **pre-existente** al diff (el código viejo tenía la misma carrera in-flight); el diff no la empeora — `loadSeq` + limpieza del ref la acotan igual o mejor. Anotado LOW abajo. |
| `expect.poll` con `data[0].id as string` sin assert interno | Decisión deliberada y correcta del test (fail→0→retry); test-only, sin superficie de prod. |

## Tabla de inputs

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| *(ninguno nuevo/modificado)* | — | — | ✅ |

El diff no agrega ni modifica campos de entrada: los inputs name/phone del `ProfileEditForm` quedan exactamente como estaban (mismo `trim()`, mismos campos hacia `saveProfile`); solo cambió el payload del callback post-guardado-exitoso. El estado de validación de esos campos es pre-existente y no fue relajado.

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| *(ninguna acción abusable tocada)* | n.a. | — | — | Sin EF nuevas, sin email/SMS/API externa/bulk. El efecto `lastSyncedAt` dispara solo lecturas del SQLite **local** (cero red, cero carga server). El write path (`saveProfile`) no cambió. El poll del e2e es test-only (≤20s de SELECTs chicos contra beta). |

## Archivos analizados

- `app/src/contexts/ProfileContext.tsx` (diff completo + archivo final)
- `app/app/(tabs)/mas.tsx` (diff)
- `app/e2e/rodeos.spec.ts` (diff + contexto del archivo)
- Verificación upstream (read-only, sin auditar como diff): `app/src/services/profile.ts`, `app/src/services/powersync/local-reads.ts` (solo `buildOwnNameQuery`/`buildOwnPhoneQuery`), `app/src/services/establishments.ts` (`saveProfile`), `app/src/contexts/AuthContext.tsx` (transiciones de sesión), `app/e2e/helpers/admin.ts` (origen de credenciales)

## Cobertura indirecta

- La skill de Sentry no modela el SDK de PowerSync ni la semántica de `useStatus()`/`lastSyncedAt`; esa parte la cubrí con revisión manual (dominio C del catálogo: el efecto reactivo no amplía el sync set ni toca sync rules — solo re-lee lo ya sincronizado self-only).
- RLS/streams self-only se verificaron por lectura de las queries y comentarios de scoping, no ejecutando tests de aislamiento — aceptable: este diff no toca policies, streams ni schema.

## Anexo LOW (→ backlog, no bloquea)

1. **Optimista pegado en multi-device** (`ProfileContext.tsx:118-122`): si OTRO dispositivo del mismo user cambia el name después del save local, los `loadFor` reactivos que traen ese name distinto se descartan indefinidamente, y el early-return también bloquea updates de `phone`; `refresh()`/"Reintentar" pasa por el mismo gate, así que no fuerza la limpieza hasta remount/re-login. **Staleness de data propia** — correctness, no seguridad. Ya reconocido en `impl_e2e-rojos-fix.md` (riesgos residuales).
2. **Ventana pre-existente de `namePhone` in-flight** en un switch directo de userId sin null intermedio: teórica (el flujo de auth pasa por logout) y anterior a este diff. Si algún día se agrega session-switching sin sign-out, limpiar `namePhone` en el efecto de `userId` igual que el ref.
