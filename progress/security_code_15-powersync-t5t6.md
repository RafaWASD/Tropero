# Security gate (modo code) — 15-powersync T5 + T6 (camino de escritura offline)

> Gate 2 de seguridad sobre el CAMINO DE ESCRITURA OFFLINE de PowerSync (CRUD plano + outbox→RPC +
> overlay optimista + idempotencia + rollback). Baseline: `1618a9566037eeca65cf2fa8841c86379ba35809`.
> Skill `sentry-skills:security-review` corrida + checklist RAFAQ-específico + trazado manual de data-flow.

## Veredicto: **PASS**

No hay findings HIGH. El camino cierra los 4 riesgos que importan en escritura offline:
**(1) no doble-upload por construcción**, **(2) idempotencia at-least-once que cierra por op**,
**(3) sin bypass de authz** (la barrera real es server-side: RLS + RPCs SECURITY DEFINER + triggers,
que el upload NO omite), y **(4) sin inyección** (todo param bindeado; los únicos string-interpola en
SQL son identificadores whitelisteados, nunca input de usuario). El rollback del overlay es completo.

---

## Findings HIGH (Sentry + RAFAQ-SPECIFIC)

Ninguno.

## Findings MEDIUM

Ninguno bloqueante. Una observación LOW de higiene (debug log) al final.

---

## Verificación punto por punto (los 7 del prompt)

### 1. No doble-upload (R6.12) — CRÍTICO → OK
Cada op (b) escribe SOLO en `op_intents` (insertOnly) + tablas overlay `pending_*` (localOnly), en UNA
`writeTransaction` local (`outbox.ts::enqueue`, líneas 54-71). Las `pending_*` son `localOnly` → **no
generan CrudEntry**. Verificado en los 4 swaps:
- `animals.ts::createAnimal` (534) → `enqueueCreateAnimal` (solo intent + `pending_animals`/`pending_animal_profiles`).
- `animals.ts::exitAnimalProfile` (685) → `enqueueExitAnimal` (solo intent + `pending_status_overrides`).
- `events.ts::registerBirth` (536) → `enqueueRegisterBirth` (solo intent + overlay).
- `management-groups.ts::softDeleteManagementGroup` (159) / `rodeos.ts::softDeleteRodeo` (310) → `enqueueSoftDelete`.

NINGÚN swap escribe la fila optimista en una tabla SINCRONIZADA. El `connector.ts::uploadData` (62-66)
detecta el `op_intents` y lo procesa por `applyIntentTransaction` → exactamente UNA CrudEntry por op (b)
→ la RPC corre una sola vez. (Excepción legítima: `softDeleteManagementGroup` hace además un UPDATE plano
`management_group_id = NULL` —paso 1 anti-FK-colgante, `buildClearGroupMembersUpdate`— que SÍ es CrudEntry
plano sobre tabla sincronizada, encolado FIFO ANTES del intent. Es un UPDATE idempotente sobre una tabla
distinta del soft-delete, no un doble-apply de la misma op.)

### 2. Idempotencia (R6.10) — CRÍTICO → OK
`upload.ts::classifyIntentUploadError` (116-154) discrimina por `(code, opType)`, no por `code` solo:
- **`register_birth`**: delta `0075` correcto. Columna `client_op_id` nullable + índice UNIQUE parcial
  **COMPUESTO** `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` + guard procedural
  scopeado (0075:106-128). Un reintento del mismo caller colisiona consigo mismo → no doble-parto. El
  23505 de ese índice se clasifica `idempotent_discard` SOLO si `opType==='register_birth'` Y el
  mensaje/details menciona el índice/`client_op_id` (upload.ts:143-149) → descarte sin rollback. Un 23505
  de OTRO índice (tag duplicado) NO matchea → cae a `permanent_reject` (rollback + superficia). Correcto.
- **`create_animal`**: 2 upserts (`connector.ts:129-131`) por PK `id` de cliente (ON CONFLICT) → reintento no duplica.
- **`soft_delete_*`**: reintento → P0002 (fila ya con `deleted_at`) → `idempotent_discard` SOLO si
  `opType.startsWith('soft_delete_')` (upload.ts:134-136) → descarte SIN rollback (no restaura una fila
  que sí está borrada). Correcto.
- **`exit_animal_profile`**: transición de status idempotente (`WHERE id=...`, sin re-side-effect; el
  trigger de categoría no dispara porque no toca `category_id`). Sin delta. Correcto.

**Sin loop infinito**: `isTransient` (upload.ts:97-106) NO marca transitorio ningún code Postgres
conocido (`if (code) return false`), y el `PermanentIntentError` (intent corrupto / op_type desconocido /
params_json inválido) se chequea PRIMERO (upload.ts:128) → no cae en "sin señal → transient". Un error
permanente siempre termina en `permanent_reject` → `tx.complete()` lo saca de la cola (no re-queue).
**Sin descarte de dato real**: `idempotent_discard` está acotado a los dos casos donde la op YA corrió
(P0002 de soft_delete; 23505 del índice de idempotencia de register_birth). Correcto.

### 3. No bypass de authz → OK
La escritura local es OPTIMISTA; la authz REAL la enforça el server al subir y el upload NO la omite:
- CRUD plano: `upsert`/`update` contra PostgREST dispara RLS + triggers + CHECKs (connector.ts:74-91).
- Intents: `supabase.rpc(...)` corre las RPCs SECURITY DEFINER con su `has_role_in`/`is_owner_of` interno.
- Un rechazo permanente (42501) → `rollbackOverlay(clientOpId)` (connector.ts:163) borra TODAS las filas
  `pending_*` de ese `client_op_id` → la fila fantasma desaparece del UNION (no queda overlay sin limpiar).

### 4. Inyección / params → OK
- INSERT/UPDATE locales (`local-reads.ts` builders 807-981, 999-1135): **100% bindeados** (`?`). Cero
  string-concat de valores de usuario.
- `supabase.rpc(plan.rpcName, plan.args)` (connector.ts:136): `rpcName` sale de `RPC_OP_TYPES`
  (whitelist, upload.ts:34-41); un op_type fuera del set → `PermanentIntentError` (no se invoca una RPC
  arbitraria). `args` es JSON parseado de `params_json`, pasado como objeto a PostgREST (no concatenado).
- `create_animal`: las tablas `'animals'`/`'animal_profiles'` son **literales** en el connector
  (129-131), no vienen del intent → un intent forjado no puede redirigir el upsert a otra tabla.
- Únicas interpolaciones de string en SQL: `notHiddenByOverride` (`${table}`,`${idExpr}`,`${effects}`,
  local-reads.ts:366-373), `buildClearOverlayDelete` (`${table}`, :1130), `buildSearchLikeQuery`
  (`${column}`, :551-552), y los `${placeholders}` de `IN (?,?,...)`. **Verifiqué TODOS los call sites**:
  esos identificadores son SIEMPRE constantes literales del código (`'animal_profiles'`, `'rodeos'`,
  `'management_groups'`, tablas de `PENDING_OVERLAY_TABLES`) o uniones de tipo TS cerradas
  (`'animal_tag_electronic'|'idv'|'visual_id_alt'`), NUNCA input de usuario. El término de búsqueda del
  usuario va bindeado (`?`) con comodines escapados (`escapeLike`, :563-565) + `ESCAPE '\'`.

### 5. register_birth cross-tenant (no regresión) → OK
El guard de idempotencia (0075:106-128) NO es un lookup global por `client_op_id`: re-ancla en
`re.animal_profile_id = p_mother_profile_id AND p.establishment_id = v_est` (madre + tenant del caller,
ya autorizado por `has_role_in(v_est)` que corre PRIMERO, 0075:102-104). Una colisión ajena cae al camino
de creación → el INSERT choca el índice compuesto → 23505 genérico, NUNCA devuelve el `id`/datos del parto
ajeno ni deja oráculo de existencia cross-tenant (el índice es por `(madre, client_op_id)`, no global).
El cliente NO introduce un canal nuevo: el 23505 que vuelve al device solo lleva `code` (connector.ts:173
loguea SOLO `table/op/code`, nunca `opData` ni `message`), y se clasifica como `idempotent_discard` sin
re-exponer la fila. Coincide con el fix HIGH-D1 ya aprobado en Gate 1 del delta.

### 6. Validación de input offline (forma/rango pre-encolado) → OK
La validación de FORMA/rango sigue corriendo ANTES de encolar (no se saltó al swapear): los selectores
cerrados (`pregnancy_status`, `service_type`, `condition_score`) garantizan enum/CHECK válido; pesos/
textos los valida el caller (`validateWeight`/`validateObservation`, documentado en los tipos de
`events.ts:248,277,562`); `cleanStr` trimea. La **unicidad** (tag/IDV duplicado) NO se puede validar
offline contra el server → se resuelve al subir (`permanent_reject` → rollback + superficia). Esto es
correcto y está documentado como consecuencia UX (sin feedback inmediato de duplicado offline). El CHECK/
unique real del DB es la barrera autoritativa al subir.

### 7. Overlay rollback completo → OK
`clearOverlay`/`rollbackOverlay` (outbox.ts:258-272) iteran las 5 tablas de `PENDING_OVERLAY_TABLES`
(local-reads.ts:1121-1127) y borran `WHERE client_op_id = ?` en una sola `writeTransaction`. Para un parto
(parto en `pending_reproductive_events` + N terneros en `pending_animals`/`pending_animal_profiles` +
`pending_birth_calves`) TODAS las filas comparten el mismo `client_op_id` (outbox.ts:147-162) → se borran
juntas. **Sin huérfanos**. Solo toca tablas `localOnly` (nunca sincronizadas).

---

## Resultado de la skill `sentry-skills:security-review`

La skill no produjo findings HIGH adicionales sobre el diff. Patrones candidatos evaluados y descartados
tras trazar data-flow (false positives / no exploitables):

| Patrón candidato | Por qué NO es vulnerabilidad |
|---|---|
| String-interpolation en SQL (`${table}`/`${column}`/`${idExpr}` en local-reads.ts) | Los identificadores son SIEMPRE constantes literales o uniones de tipo TS cerradas elegidas por el service. El valor de usuario (search term) va bindeado por `?` + `escapeLike`. No attacker-controlled. |
| Mass assignment en CRUD plano (`upsert({ ...op.opData, id: op.id })`, connector.ts:77) | `op.opData` proviene de los builders locales que OMITEN deliberadamente `created_by`/`author_id`/`establishment_id` (los fuerza el trigger server-side desde `auth.uid()`/perfil, ignorando el payload — R6.2). Aunque una fila local forjada los incluyera, el trigger los pisa. La barrera real es server-side. |
| `supabase.rpc(name, args)` con `name` dinámico (connector.ts:136) | `name` sale de `RPC_OP_TYPES` (whitelist); fuera del set → `PermanentIntentError`. No se invoca RPC arbitraria. |
| Information disclosure de `err.message` al cliente | El upload NO devuelve `err.message` al usuario (el encolado siempre `ok:true`; el rechazo se maneja por el canal de status). `surfaceUploadRejection` (connector.ts:171-183) loguea SOLO `table/op/code`, NUNCA `opData` ni `message`. |
| IDOR en el guard de idempotencia de register_birth | Guard scopeado al caller (madre + tenant), no global. Ya cubierto por fix HIGH-D1. |

---

## Tabla de inputs (campos nuevos/modificados que el usuario tipea, lado escritura)

| campo | límite | validación (server/cliente/ausente) | OK? |
|---|---|---|---|
| `weightKg` (addWeight) | >0, parte entera ≤4 cifras | cliente `validateWeight` + CHECK DB al subir + bindeado | sí |
| `score` (condition) | 17 valores 1.00–5.00 | selector CERRADO + CHECK DB (0028) al subir | sí |
| `pregnancyStatus`/`serviceType` (tacto/servicio) | enum cerrado | selector CERRADO + enum DB al subir | sí |
| `text` (observación) | no vacío, ≤ tope | cliente `validateObservation` + bindeado; trigger fuerza author/edit_window | sí |
| `name` (lote create/rename) | trim, no vacío | cliente trim + RLS owner-only al subir + bindeado | sí |
| `tag_electronic`/`idv`/`visual_id_alt` (alta/parto) | formato/largo | cliente `cleanStr` + UNIQUE/CHECK DB al subir (rechazo permanente si dup) + bindeado | sí |
| `sex`/`categoryCode` (alta/parto) | enum / code de catálogo | selector cerrado + FK/CHECK DB al subir | sí |
| search `term` (buscador local) | length-cap `classifySearchQuery` (R7.3) | bindeado `?` + `escapeLike` + `LIMIT 20/200` | sí |

Notas: la validación AUTORITATIVA es el DB (tipos de columna acotados, CHECK, UNIQUE, FK, NOT NULL) +
los triggers que fuerzan `created_by`/`establishment_id`, evaluados al SUBIR contra PostgREST. El cliente
es UX (bypasseable, attacker-controlled), pero acá el backend ya tenía esos controles desde las features
previas y el swap a offline NO los aflojó: la misma fila pasa por la misma RLS+trigger+CHECK al upload.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Encolado offline de escrituras (intent/CRUD plano) | n.a. | — | — | El encolado es LOCAL (SQLite del device); no es un endpoint remoto. No hay superficie de abuso a escala server-side por el encolado. |
| Drenado `uploadData` → PostgREST/RPC | n.a. (sin cambio) | per-user (JWT) | sí | El upload corre con el JWT del usuario contra RLS/RPC; no introduce un endpoint nuevo sin límite. La RPC `register_birth` no manda email/SMS ni pega a API externa. Sin denial-of-wallet nuevo. |
| `register_birth` (parto + N terneros, fan-out) | n.a. en este diff | per-user | sí | El N de terneros lo acota la UI/dominio (un parto real). No es import masivo. Sin amplificación a escala. |

Sin acciones que manden email/SMS, peguen a API externa, o sean bulk/import en este diff (esas son
features 12/onboarding, ONLINE, fuera de scope T5/T6). No se tocó `[auth.rate_limit]` de `config.toml`.

---

## Archivos analizados (diff T5/T6)

- `app/src/services/powersync/outbox.ts` (nuevo) — encolado + clear/rollback overlay.
- `app/src/services/powersync/upload.ts` (nuevo) — `mapIntentToRpc` + `classifyIntentUploadError` (PURO).
- `app/src/services/powersync/connector.ts` — `uploadData` + `applyIntentTransaction` + `surfaceUploadRejection`.
- `app/src/services/powersync/local-reads.ts` — builders de escritura plana + overlay + UNION de lectura.
- `app/src/services/animals.ts` — `createAnimal` (→ enqueueCreateAnimal), `exitAnimalProfile` (→ enqueueExitAnimal), `searchAnimals`.
- `app/src/services/events.ts` — `registerBirth` (→ enqueueRegisterBirth), `addWeight/addConditionScore/addTacto/addService/addAbortion/addObservation` (CRUD plano local).
- `app/src/services/management-groups.ts` — `createManagementGroup`/`renameManagementGroup`/`assignAnimalToGroup` (CRUD plano), `softDeleteManagementGroup` (→ enqueueSoftDelete).
- `app/src/services/rodeos.ts` — `softDeleteRodeo` (→ enqueueSoftDelete).
- `supabase/migrations/0075_register_birth_idempotency.sql` — delta de idempotencia + guard scopeado.
- `supabase/migrations/0076_deactivate_roles_on_establishment_soft_delete.sql` — invariante "rol activo ⇒ campo vivo" (deactivate-on-delete + guard block-activate). Refuerza el scoping JOIN-free del sync; defensa-en-profundidad de tenancy.

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia)

La skill de Sentry NO cubre nativamente: (a) la semántica de PowerSync (insertOnly vs localOnly, CrudEntry,
at-least-once) — **cubierta por revisión manual** contra el design §5.3/§5.4; (b) las RPCs plpgsql
SECURITY DEFINER y RLS — **cubiertas por lectura directa** de 0075/0076 y verificación del guard scopeado;
(c) no hay código Deno (Edge Functions) tocado en este diff. La frontera de autorización del **wire de
sync** (sync streams YAML) NO es parte de T5/T6 (es Gate 1, ya PASS en
`progress/security_spec_15-powersync-v3-joinfree.md`); este gate cubre el camino de ESCRITURA.

---

## Anexo LOW (no bloqueante)

- **Debug log en `connector.ts::fetchCredentials` (40-52)**: hay un `console.log('[powersync]
  fetchCredentials', { hasSession, hasToken, endpoint })` marcado `// TODO(debug 15-powersync): quitar
  tras diagnosticar`. Loguea SOLO booleanos + el endpoint (público), NUNCA el token/sesión (respeta la
  convención de `supabase.ts`). No es un leak. Recomendación: quitarlo antes de release (es ruido de
  debug), pero no afecta seguridad. LOW.
