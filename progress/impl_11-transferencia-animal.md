# impl 11 — transferencia-animal (implementer)

baseline_commit: e52dc894e796d840be8e86474056131acca6c1c9

> Punto desde el cual el Gate 2 calcula el diff (trabajamos sobre `main`, sin feature-branches).
> Es el SHA previo a la primera task de la feature. NO sobreescribir en sesiones posteriores.

## Feature en curso

**11-transferencia-animal** — RPC `transfer_animal` (SECURITY DEFINER) que crea un perfil nuevo en Y,
re-apunta toda la historia del perfil viejo (X) al nuevo + archiva el viejo, atómicamente.

Estado: `in_progress` (Puerta 1 aprobada, Gate 1 PASS). Alcance de este run: Fases 1, 2, 3, 5.
Fase 4 (UI) DIFERIDA (depende del frontend de spec 09, deferred). NO se toca.

## Plan (tasks)

### Fase 1 — Backend RPC (FIRME)
- [ ] T1.1 — Migración 0087 `transfer_animal` SECURITY DEFINER + cuerpo §3.2
- [ ] T1.2 — bloque (a) authz asimétrica (paridad 0044 en origen X)
- [ ] T1.3 — bloque (0) idempotencia al inicio (FIX HIGH-2)
- [ ] T1.4 — bloque (b) mismo sistema
- [ ] T1.5 — bloque (c) idv conservar-o-NULL
- [ ] T1.6 — bloque (d) archivar viejo PRIMERO
- [ ] T1.7 — bloque (e) crear perfil nuevo en Y
- [ ] T1.8 — bloque (f) re-apuntar 5 tablas tipadas
- [ ] T1.9 — bloque (f) re-apuntar animal_category_history
- [ ] T1.10 — bloque (f) re-apuntar birth_calves (ternero + madre §4.4)
- [ ] T1.11 — bloque (g) re-apuntar vínculos bull_id/calf_id de OTROS
- [ ] T1.12 — Delta 0088: trigger animal_events early-return por GUC + re-apuntar animal_events
- [ ] T1.13 — grants (revoke/grant firma tipada + smoke-check + notify)

### Fase 2 — Tests (suite `transfer_animal RPC` en animal/run.cjs)
- [ ] T2.1..T2.15 — 15 tests no-bypass

### Fase 3 — Cliente service (ONLINE-only)
- [ ] T3.1 — `transferAnimal(input)` en `app/src/services/animals.ts`
- [ ] T3.2 — UUID estable de cliente para idempotencia
- [ ] T3.3 — resolver `p_target_category_id` por system destino

### Fase 5 — Reconciliación + cierre
- [x] T5.1 — Reconciliar spec 02 design.md con el delta del trigger
- [x] T5.2 — Mapa R<n> → archivo:test (este archivo)
- [x] T5.3 — Autorrevisión adversarial

(Fase 4 UI: NO construida — diferida con el frontend de spec 09. T4.x quedan `[ ]` a propósito.)

## Archivos creados / tocados

| Archivo | Acción |
|---|---|
| `supabase/migrations/0087_transfer_animal_rpc.sql` | **creado** — RPC `transfer_animal` SECURITY DEFINER (§3.2) + grants + smoke-check + notify |
| `supabase/migrations/0088_animal_events_transfer_guc.sql` | **creado** — delta `tg_animal_events_enforce_edit_window` (early-return por GUC `rafaq.is_transfer`) |
| `supabase/tests/animal/run.cjs` | **modificado** — suite `spec 11 — transfer_animal RPC` (T2.1–T2.14, 15 subtests incl. setup) antes del `cleanup` |
| `app/src/services/transfer-animal.ts` | **creado** — lógica PURA (input/result types, `mapTransferResult`, `classifyTransferError`, copys) |
| `app/src/services/transfer-animal.test.ts` | **creado** — 14 unit tests de la lógica pura |
| `app/src/services/animals.ts` | **modificado** — `transferAnimal(input)` (ONLINE-only, `assertOnline` + `supabase.rpc`) + `newTransferTargetProfileId()` + imports/re-exports |
| `scripts/run-tests.mjs` | **modificado** — enganchado `transfer-animal.test.ts` a los client unit tests |
| `specs/active/02-modelo-animal/design.md` | **reconciliado** — nota del delta del trigger (feature 11 / 0088) |
| `specs/active/11-transferencia-animal/design.md` | **reconciliado** — nota as-built §3.2 (rodeo_id en SELECT (a); split 0087+0088) |
| `specs/active/11-transferencia-animal/tasks.md` | **actualizado** — T1.x/T2.x/T3.x/T5.x marcadas `[x]`; T4.x diferidas |

## Aplicación de la migración (BLOQUEADA — el leader debe aplicarla)

`apply_migration` del MCP de Supabase **no está en mi toolset**. La vía sancionada del repo
(`scripts/apply-migration.mjs`, Management API) la **bloqueó el clasificador de seguridad** del modo auto
(razón: aplicar al remoto fuera del MCP `apply_migration` mandado por el usuario). Per la instrucción del
run ("si te lo bloquea el clasificador, NO lo fuerces"), **NO se forzó**. Estado:
- Las dos migraciones quedan **escritas y gateadas** (Gate 1 PASS en spec); **falta aplicarlas al remoto**.
- **El leader debe aplicar `0088` PRIMERO** (el RPC depende del early-return por GUC) **y luego `0087`**,
  vía el MCP `apply_migration`. Tras aplicar → correr `node scripts/check.mjs` (los 15 tests de
  `transfer_animal RPC` deben pasar).

## Verificación realizada (lo que SÍ pude verificar sin la migración)

- `node scripts/check.mjs`: **typecheck VERDE** + **client unit tests VERDE (1002/1002, incluye los 14 de
  transfer-animal)** + RLS/Edge/user_private/import/sync_streams/operaciones_rodeo/maneuvers **VERDES**.
- Animal suite (spec 02): **84 pass / 14 fail** — los 14 fails son **EXACTAMENTE** los subtests de
  `spec 11 — transfer_animal RPC` que ejecutan el RPC, fallando con `PGRST202` (función `transfer_animal`
  inexistente en el remoto, migración no aplicada). **ESPERADO** (patrón 0075-0086). El único subtest de
  spec 11 que pasa sin la migración es **T2.13** (anon NO puede invocar — se cumple igual con/sin función:
  fail-closed legítimo). `cleanup` pasa → **CERO huérfanos dejados**.
- **Honestidad de los tests**: agregué el guard `assertRpcExists(error)` (falla si `error.code==='PGRST202'`)
  a TODOS los tests negativos (T2.3/T2.4/T2.5/T2.6/T2.7/T2.9) + endurecí sus aserciones a `error.code` exacto
  (`42501`/`23503`/`23514`) — antes T2.3/T2.5 pasaban por la **razón equivocada** (un mensaje PGRST202 que
  contiene `p_target_*` matcheaba el regex `/target/`). Tras el fix, 14/15 fallan honestamente sin la
  migración (señalan "migración no aplicada") y pasarán por la razón correcta cuando se aplique.

## Trazabilidad R<n> → archivo:test

> Backend: `supabase/tests/animal/run.cjs`, suite `spec 11 — transfer_animal RPC`. Cliente:
> `app/src/services/transfer-animal.test.ts`. (R1.x y R8.2 son TENTATIVAS-UI → Fase 4 diferida, sin test
> backend; R8.1 se cubre por la semántica del re-parenting, testeada en T2.11.)

| R<n> | Cubierto por (archivo:test) |
|---|---|
| **R2.1** crea perfil nuevo reusa animal_id | `animal/run.cjs` T2.1 (`np.animal_id === animalId`) |
| **R2.2** rodeo destino mismo system | `animal/run.cjs` T2.9 (a 23514 / b OK) |
| **R2.3** management_group_id = NULL | `animal/run.cjs` T2.1 (`np.management_group_id === null`) |
| **R2.4** idv conservar / NULL ante colisión | `animal/run.cjs` T2.8 (a conserva / b NULL+dropped) |
| **R2.5** idv_dropped en el resultado | `animal/run.cjs` T2.8(b); `transfer-animal.test.ts` (mapTransferResult idv_dropped) |
| **R2.6** identidad denorm consistente (0079) | (implícito; el trigger 0079 la fuerza — no se setea en el RPC) |
| **R2.7** is_castrated preserva (global) | `animal/run.cjs` T2.14 (`np.is_castrated === true`) |
| **R2.8** future_bull arranca false | `animal/run.cjs` T2.14 (ambos casos `future_bull === false`) |
| **R2.9** category_override = false | `animal/run.cjs` T2.1 (`np.category_override === false`) |
| **R2.10** created_by forzado al caller | `animal/run.cjs` T2.1 (`np.created_by === userA.id`) |
| **R2.11** status active / deleted_at NULL | `animal/run.cjs` T2.1 (`np.status === 'active'`) |
| **R2.12** descriptivos: animal viaja / relación resetea | `animal/run.cjs` T2.1 (breed/coat/visual viajan; entry_*/notes reset; entry_date=hoy) |
| **R3.1** re-apunta 5 tablas tipadas | `animal/run.cjs` T2.1 (loop weight/sanitary/condition/lab + reproductive) |
| **R3.2** re-apunta animal_events | `animal/run.cjs` T2.1 + T2.12 (ae establishment→Y, viejo sin obs) |
| **R3.3** re-apunta animal_category_history | `animal/run.cjs` T2.1 (ach establishment→Y) |
| **R3.4** re-apunta vínculos calf_id/bull_id de OTROS | `animal/run.cjs` T2.11 (bull_id de la cría→nuevo; evento en X) |
| **R3.5** re-apunta birth_calves del animal-como-ternero | `animal/run.cjs` T2.1 (birth_calves de la madre + ternero en X) |
| **R3.6** establishment_id→Y en TODAS las hijas (no fuga) | `animal/run.cjs` T2.1 + T2.12 (0 filas en X) |
| **R3.7** animal_events re-apuntado sin rechazo (GUC) | `animal/run.cjs` T2.12 (ae en Y; inmutabilidad no rechazó) |
| **R3.8** session_id → NULL en las tipadas | `animal/run.cjs` T2.1 (todas las tipadas `session_id === null`) |
| **R3.9** perfil viejo sin eventos propios | `animal/run.cjs` T2.1 (`nOld === 0` por tabla + obs) |
| **R4.1** archiva viejo (transferred, NO soft-delete) | `animal/run.cjs` T2.1 (status transferred, exit_reason transfer, deleted_at NULL) |
| **R4.2** nunca 0 ni 2 perfiles activos | `animal/run.cjs` T2.2 + T2.1 (`actives.length === 1`) |
| **R4.3** atomicidad / rollback total | `animal/run.cjs` T2.3 (category inválida → rollback, historia intacta) |
| **R5.1** authz origen X (paridad 0044) | `animal/run.cjs` T2.6 (rol X+Y pero no owner/creador → 42501) |
| **R5.2** rechazo sin rol en X → 42501 | `animal/run.cjs` T2.4 (rol solo en Y → 42501, sin efectos) |
| **R5.3** rechazo sin rol en Y → 42501 | `animal/run.cjs` T2.5 (rol solo en X → 42501) |
| **R5.4** deriva X de la fila real (anti-IDOR) | `animal/run.cjs` T2.4/T2.6 (la authz se evalúa sobre la fila real, no el payload) |
| **R5.5** grants fail-closed | `animal/run.cjs` T2.13 (anon NO invoca) + smoke-check en 0087 |
| **R5.6** origen inactivo/inexistente → 23503 | `animal/run.cjs` T2.7 (a inexistente / b ya transferido) |
| **R6.1** idempotencia (replay) | `animal/run.cjs` T2.10 (`replay === true`, sin 2do perfil); `transfer-animal.test.ts` (replay) |
| **R6.2** id de cliente estable | `animal/run.cjs` T2.10 (mismo p_target_profile_id); `animals.ts` `newTransferTargetProfileId()` |
| **R6.3** carrera → a lo sumo una ganadora | `animal/run.cjs` T2.7(b) (re-transferir el viejo ya transferred → 23503) + clasificación 23505 (`transfer-animal.test.ts`) |
| **R7.1** ONLINE-only | `animals.ts` `transferAnimal` (`assertOnline` fast-fail); `transfer-animal.test.ts` (TRANSFER_OFFLINE_MESSAGE / network) |
| **R7.2** un animal por invocación | (por construcción: el RPC toma un único `p_source_profile_id`) |
| **R7.3** SIGSA no carga a Y | (por cardinalidad — el RPC no toca el marcador SIGSA; nada que setear) |
| **R8.1** linaje cruzado no se rompe | `animal/run.cjs` T2.11 (bull_id→nuevo, evento sigue en X) + T2.1 (ternero en X) |
| **copy 42501/23514/23503/23505 sin leak** | `transfer-animal.test.ts` (classifyTransferError, todos los códigos + null + network) |

## Autorrevisión adversarial (T5.3) — vectores de design §7

Pasada hostil sobre la implementación (no pasamanos). Qué busqué, qué encontré, cómo lo cerré:

1. **Fuga de aislamiento del wire de sync (ninguna hija con establishment_id=X).** El RPC setea
   `establishment_id = Y` explícito en las 5 tipadas + animal_events + animal_category_history, y el
   force de 0077 (BEFORE UPDATE) re-deriva Y desde el perfil nuevo → convergen. `birth_calves` (force
   solo-INSERT): el UPDATE explícito de la madre→Y es la ÚNICA vía → incluido. T2.12 asserta 0 filas en X
   en las 6 tablas + animal_events en Y. **Cerrado.**
2. **birth_calves del ternero con madre en X.** Su force es solo-INSERT → el UPDATE de `calf_profile_id`
   NO toca establishment_id → conserva el de la madre (X) = DEC-A2 (correcto). T2.1 asserta el ternero
   queda en X. **Verificado.**
3. **Doble / cero perfil activo.** Orden (d) archivar viejo ANTES de (e) crear nuevo → el unique parcial
   `animal_profiles_active_animal_unique` nunca ve 2 activos; atómico → nunca 0. T2.2 + T2.1
   (`actives.length === 1`). **Cerrado.**
4. **Idempotencia robusta.** Corte de replay AL INICIO (0) por `p_target_profile_id` de cliente, ANTES del
   select active-only del origen (FIX HIGH-2: si fuera después, el reintento sobre un origen ya
   'transferred' tiraría 23503 en vez de devolver el resultado). T2.10. **Verificado.**
5. **Authz a paridad EXACTA con 0044 (HIGH-1).** `has_role_in(X) AND (is_owner_of(X) OR created_by=auth.uid())`
   — copiado literal de `exit_animal_profile` (0044). El `has_role_in(X)` filtra al ex-creador revocado
   (active=false) con rol en Y. Destino Y = solo rol activo (CREATE). Todo derivado de la fila real, nunca
   del payload. T2.4/T2.5/T2.6 (3 vectores: solo-Y, solo-X, rol-en-ambos-pero-ajeno). **Verificado contra 0044.**
6. **Grants fail-closed.** `revoke from public, anon` + `grant to authenticated` con firma tipada (5 uuids)
   + smoke-check que ABORTA el deploy si quedara EXECUTE-able por anon/public + notify. T2.13. **Cerrado.**
7. **GUC no seteable por cliente.** `set_config('rafaq.is_transfer','on',true)` es transaccional-local y
   SOLO la setea el RPC (definer); un UPDATE de cliente directo a PostgREST no entra en esa transacción →
   el early-return no se activa → la inmutabilidad de animal_events sigue valiendo (vector anti-spoof
   intacto). Mismo patrón que rafaq.is_auto_transition (0031). **Verificado contra 0031.**
8. **Interacción con triggers ocultos (cazado en la revisión).** (a) `tg_event_session_tenant_check`
   (0052, BEFORE UPDATE OF session_id en las 5 tipadas) → mi UPDATE pone session_id=NULL → el trigger
   early-returna cuando new.session_id IS NULL → no valida el nuevo perfil/rodeo. **No estorba.** (b)
   `tg_reproductive_events_apply_transition` (0031) es AFTER INSERT only → el re-apuntado (UPDATE) NO
   re-dispara transiciones de categoría. **No estorba.** (c) En bloque (g) el UPDATE de bull_id/calf_id NO
   toca session_id → no dispara el tenant-check; SÍ dispara el force 0077 que re-deriva el establishment del
   evento (que sigue en X) → queda en X = correcto (linaje cruzado).
9. **Tests que pasan por la razón equivocada (cazado y cerrado).** T2.3/T2.5 originalmente pasaban SIN la
   migración porque el mensaje PGRST202 contiene `p_target_*` (matcheaba `/target/`). Agregué
   `assertRpcExists` + aserciones a `error.code` exacto en TODOS los negativos → ahora 14/15 fallan
   honestamente sin la migración. **Cerrado.**
10. **Limitación honesta:** NO pude ejecutar el RPC contra la DB real (apply bloqueado). La correctitud
    behavioral del SQL está verificada solo por **revisión estática** contra las migraciones as-built
    (0017/0020/0021/0026/0030/0034/0044/0045/0052/0077/0078/0079/0084/0085) + el contrato del design. El
    leader debe aplicar 0088→0087 y correr la suite para la verificación behavioral completa.

## Decisiones menores / desviaciones

- **Split de migración 0087 (RPC) + 0088 (delta trigger)** en vez de un archivo: append-only (no se edita
  0034 in-place) + separación de concerns. Reconciliado en ambos designs.
- **`rodeo_id` del origen leído en el SELECT (a)** en vez de un SELECT separado en (b): una query menos,
  misma fila real. Reconciliado en spec 11 design §3.2.
- **Service cliente split puro/IO** (`transfer-animal.ts` puro + `animals.ts` I/O) — patrón as-built
  (`exit-animal.ts` ↔ `animals.ts`) para que la lógica sea testeable bajo node:test sin el grafo RN/expo.
- **MED-2 (sin rate limit)**: aplicado tal cual (Raf lo anotó en Puerta 1; DoW self-scoped, no bloquea).
</content>
</invoke>
