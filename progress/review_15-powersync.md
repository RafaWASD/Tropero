# Review — 15-powersync · Run 1 (cimientos del cliente + YAML de streams)

> Reviewer (puerta de codigo). Alcance del run: T1.1-T1.5, T1.7, T1.8, T2.1 (mas base de T1.6 en connector.ts).
> NO se exige en este run: swap de services T3-T6, delta backend T6.4, deploy de streams T2.3, validacion LIVE T7.4.
> baseline_commit: 1618a9566037eeca65cf2fa8841c86379ba35809

## Veredicto: APPROVED

Run 1 cumple el alcance acordado. check.mjs verde, 33 unit nuevos verdes, sin tocar backend ni migraciones,
boundary de capas respetado, el secreto token/sesion nunca se loguea, spec reconciliada al as-built sin
contradicciones. El swap de services, el delta backend y el deploy de streams quedan para runs posteriores.

## Trazabilidad R<n> a test (cobertura de Run 1)

| R<n> | Test concreto | Estado |
|---|---|---|
| R1.2 env powersyncUrl | utils/env-resolve.test.ts :: R1.2 con las 3 vars presentes | OK |
| R1.3 error accionable | env-resolve.test.ts :: R1.3 falta / vacio / faltan Supabase | OK |
| R2.1 AppSchema espeja sync | services/powersync/schema.test.ts 8 tests: validate del SDK real, 26 tablas, PII fuera de users | OK |
| R2.2 factory por plataforma | services/powersync/platform-select.test.ts web/native/fail-safe | OK |
| R3.1 fetchCredentials | services/powersync/upload-classify.test.ts :: R3.1 con sesion / sin sesion / token vacio null | OK |
| R3.4 transitorio a reintento | upload-classify.test.ts :: R3.4 red, 5xx/429, sin senal conservador | OK |
| R3.5 permanente a descarta | upload-classify.test.ts :: R3.5 42501, clase 23, 4xx mas isPermanentServerCode | OK |
| R6.8 outbox insertOnly | schema.test.ts :: R6.8 outbox op_intents es insertOnly | OK |
| R6.11/R6.12 overlay localOnly | schema.test.ts :: pending_* localOnly, synced no localOnly ni insertOnly | OK |
| R10.1 estado de sync UI | services/powersync/status-derive.test.ts 8 tests: estados mas copy es-AR mas defaults | OK |
| decision-abierta-PK | schema.test.ts :: PK especial user_private/rodeo_data_config/birth_calves NO declaran id | OK |

Cubiertos por typecheck mas montaje (LIVE diferido, legitimo):
- R2.3 provider montado: wireado en app/app/_layout.tsx:420 dentro de AuthProvider, envolviendo los providers de datos; typecheck verde.
- R2.4 boot WASM live / R3.2 refresh live: diferidos a T7.4 (necesita Instance URL en .env.local mas streams deployadas). Codigo wireado.
- R4.1-R4.11 streams: materializadas en rafaq.yaml; las cubre el test de no-bypass T7.2 (run posterior) mas Gate 1 PASS ya emitido sobre el YAML.

Ningun R<n> del alcance de Run 1 queda sin test. Los R<n> sin test concreto hoy (R5.x, R6.1-R6.7, R6.9, R6.10, R7.x, R8.x, R9.x, R11.x) son de runs posteriores y estan correctamente fuera de scope.

## Tasks completas: si (para el alcance del run)

- T1.1 OK, T1.2 OK, T1.3 OK, T1.4 OK, T1.5 OK, T1.7 OK, T1.8 OK, T2.1 OK. Todas marcadas [x] en tasks.md.
- T1.6 sin marcar. JUSTIFICADO: la base de CRUD plano mas clasificacion transitorio/permanente mas superficiado viven en connector.uploadData(); el resto op_intents a RPC, overlay, idempotencia es Run T6, marcado STUB TODO Run T6 en connector.ts:50-52.
- T2.2 Gate 1 sin marcar. JUSTIFICADO: ya PASS en progress/security_spec_15-powersync.md.
- T2.3 deploy sin marcar. JUSTIFICADO: lo hace leader/Raf, gateado.
- T3-T8 sin marcar: runs posteriores, fuera de scope.

## CHECKPOINTS

- C1 harness completo: [x] check.mjs exit 0.
- C2 estado coherente: [x] feature 15 in_progress, NO marcada done por el implementer; current.md describe la sesion.
- C3 codigo respeta arquitectura: [x] todo en services/powersync/ mas utils/env-resolve.ts mas provider en root; deps PowerSync justificadas por ADR-002; sin debug logs sueltos; el unico console.warn es observabilidad R10.2 sin datos; sin establishment_id hardcodeado.
- C4 verificacion real: [x] 33 unit nuevos; schema.test ejercita el SDK REAL validate/toJSON, no mock; el no-bypass cross-tenant es T7.2, run posterior.
- C6 SDD: [x] 3 archivos presentes; EARS; tasks del run [x]; cada R del run con al menos 1 test.
- C7 multi-tenant: [x] aplica a las STREAMS, no a tablas nuevas; predicado canonico espeja has_role_in con JOIN a establecimientos vivos; user_private self-only; est_members owner-gated espejando user_roles_select; deleted_at IS NULL filtrado. Test de aislamiento por device = T7.2; Gate 1 PASS cubre la auditoria hoy.
- C8 offline-first: [x] capa offline-first; LWW default explicito documentado en R12.2; stream scoping por establishment_id activo en el YAML.

## Checklist RAFAQ-especifico

- A. tablas con establishment_id / RLS: N/A en codigo. Run 1 NO crea tablas server ni migraciones (git diff no toca supabase/migrations/). La frontera de authz son las STREAMS: predicado canonico OK, helpers espejados (no SQL inventado), deleted_at IS NULL en SELECT, user_private self-only, est_members owner-gated. Gate 1 PASS ya las audito. El test de aislamiento por device es T7.2 (run posterior).
- B. offline-first: parcial-N/A en este run (el swap a SQLite local es T3-T6). Lo de Run 1: connector mas provider mas schema mas streams bien encaminados; LWW documentado R12.2; scoping por establishment_id activo; op_intents no hace supabase.from() (write-side mapeada a RPC en T6). Sin requests sincronos a Supabase desde pantallas (el provider solo orquesta connect/disconnect).
- C. BLE: N/A no toca BLE.
- D. UI de campo: N/A no toca pantallas; solo monta el provider en root.
- E. Edge Functions: N/A no toca EFs.

## Verificaciones puntuales del brief

- Deps T1.1: OK. @powersync/react-native 1.35.3, @powersync/web 1.38.2, @powersync/react 1.10.0 mas @journeyapps/wa-sqlite 1.7.0 (peer WASM) en app/package.json. wa-sqlite whitelisteado en pnpm.onlyBuiltDependencies (ADR-011) por su postinstall. Una sola version de @powersync/common 1.53.2 verificada en pnpm-lock.yaml (todos los @powersync/* resuelven a 1.53.2). El peer nativo react-native-quick-sqlite NO instalado (solo lo precisa el bundle native; el web no lo pulla por el require guardado).
- env T1.2: OK. env.ts delega en resolveEnv puro; agrega powersyncUrl desde EXPO_PUBLIC_POWERSYNC_URL; error accionable es-AR fail-closed (vacio cuenta como faltante). .env.example actualizado con la var mas nota.
- AppSchema T1.3: OK. 26 sincronizadas mas op_intents insertOnly mas 5 pending_* localOnly = 32 tablas. Los 3 id aliased/sinteticos (user_private/rodeo_data_config/birth_calves) NO se declaran como columna id (el SDK los agrega implicitos); mantienen sus columnas componentes. PII email/phone fuera de users (ADR-025).
- Factory T1.4: OK. seleccion por Platform.OS via require guardado (web @powersync/web WASM / native @powersync/react-native); singleton lazy getPowerSync(). El bundle web no pulla el peer nativo.
- Connector T1.5: OK. fetchCredentials devuelve endpoint/token desde la sesion Supabase y null sin sesion (no throw, contrato del SDK). uploadData base CRUD plano; el op_intents se reconoce y se rechaza (throw TODO Run T6), NO se aplica como CRUD plano. CRITICO OK: NO se loguea token ni sesion ni opData/params_json; el unico console.warn (connector.ts:96) loguea solo table/op/code.
- Provider T1.7: OK. PowerSyncProvider montado en app/app/_layout.tsx:420 dentro de AuthProvider; connect on sesion valida (authenticated mas emailVerified) / disconnect on logout; fallos best-effort sin romper UI.
- status T1.8: OK. getSyncUiState one-shot mas subscribeSyncUiState mas copy es-AR; logica pura en status-derive.ts con defaults seguros.
- rafaq.yaml T2.1: OK. 26 streams byte-faithful al design seccion 2: predicado canonico (JOIN establecimientos vivos mas e.deleted_at IS NULL), est_members query 2 owner-gated, deleted_at IS NULL donde aplica, los 3 id aliased. NO deployado (sigue en working tree, sin commit; el deploy lo hace leader/Raf).
- Reconciliacion: OK. design seccion 2 (SELECT AS id), seccion PK (RESUELTA en T1.3), seccion 4 (fetchCredentials null), seccion 1.1 (modulos puros / upload.ts y outbox.ts = Run T6) reflejan el as-built y no contradicen el codigo. requirements.md sin cambio de que (las 2 desviaciones son de mecanismo, no de requirement). tasks.md marcado con notas Run 1.
- Tests / check.mjs: OK. 33 unit nuevos verdes; node scripts/check.mjs exit 0 (All tests passed / Entorno listo). T7.4 LIVE web legitimamente diferida.
- RAFAQ boundary: OK. todo en services/powersync/ mas utils/env-resolve.ts puro mas provider en root; NO se tocaron pantallas/hooks/componentes (solo _layout.tsx para montar el provider); cero hardcode de establishment_id; NO se toco supabase/migrations/ ni EFs; feature_list.json solo agrega la entrada de la feature 15 en in_progress (NO done).

## Cambios requeridos

Ninguno. APPROVED para cerrar Run 1.

### Notas para runs posteriores (no bloquean este run)
- El stub de op_intents en connector.ts throwea no implementado en Run 1: si por error se encolara un op_intents antes de T6, quedaria reintentandose como transitorio (no se descarta el intent, safe). T6.2c debe reemplazar ese throw por applyIntent.
- Recordatorio T6.4: el guard de idempotencia de register_birth debe ser SCOPEADO al caller (fix HIGH-D1), NO el lookup global; ya documentado en design seccion 5.4.3(1) y tasks T6.4.
- Las 3 tablas de id sintetico/aliased NO deben escribirse localmente (un upsert plano fallaria server-side); documentado en schema.ts y design seccion PK.


---

# Review - 15-powersync . Run 2 (delta de backend de idempotencia, T6.4 + T7.7)

> Reviewer (puerta de codigo). Alcance del run: migracion 0075_register_birth_idempotency.sql (NO aplicada al remoto)
> + suite de tests "spec 15-powersync" en supabase/tests/animal/run.cjs. Es el unico delta de backend de la feature,
> aprobado en Puerta 1 y gateado a nivel spec (Gate 1 delta PASS tras cerrar HIGH-D1).
> Validacion ESTATICA del SQL y los tests: los 3 tests nuevos FALLAN hoy porque la migracion NO esta aplicada al
> remoto (la aplica el leader por Management API). Esto es ESPERADO y NO motiva rechazo (instructivo explicito).
> baseline_commit: 1618a9566037eeca65cf2fa8841c86379ba35809 (NO sobreescrito; feature multi-run).

## Veredicto: APPROVED

El delta es estrictamente aditivo y correcto. El guard idempotente esta SCOPEADO al caller (no el literal global):
cierra HIGH-D1 (IDOR cross-tenant). El comportamiento as-built de 0045 esta preservado. El path online queda
identico. Firma/grants/indice/numeracion correctos. Los 3 tests cubren idempotencia, cross-tenant negativo (T7.7) y
path online. El implementer NO aplico la migracion al remoto y NO toco feature_list (sigue in_progress) ni sync-streams.
La implementacion sigue al pie de la letra el spec gateado (design 5.4.3(1) + 9-nota, R6.10/R11.3/R11.4, T6.4/T7.7);
specs y codigo no se contradicen.

## Trazabilidad R<n> a test (Run 2)

| R<n> | Test concreto | Estado |
|---|---|---|
| R6.10 (register_birth dedup por client_op_id, no doble-apply) | run.cjs :: spec 15-powersync :: caso 1 (doble call mismo X/madre): r2.data == birthId, 1 evento birth, 2 terneros (no 4), 2 perfiles (no 4), madre avanza 1 parto a vaca_segundo_servicio | OK (falla hoy = migracion no aplicada, ESPERADO) |
| R6.10 / R11.4 (fix HIGH-D1: dedup scopeada al caller, NUNCA cross-tenant) | run.cjs :: spec 15-powersync :: caso 2 (T7.7): B replaya X de A sobre madre propia, rB.data != birthIdA (no IDOR), error generico 23505/42501 o parto propio de B; el id de A no aparece en el error; parto de A intacto | OK (falla hoy = migracion no aplicada, ESPERADO) |
| R11.3 (path online identico al as-built; delta aditivo) | run.cjs :: spec 15-powersync :: caso 3 (3 args sin p_client_op_id): 2 terneros, client_op_id NULL, madre transiciona como as-built | OK (falla hoy = migracion no aplicada, ESPERADO) |

Ningun R<n> del alcance de Run 2 queda sin test. Los 3 tests ejercitan el path real (hoy PGRST202 sobre la firma de
4 args prueba que llaman la firma nueva); el caso 2 verifica el REJECT real (rB.data != birthIdA + parto de A intacto),
no solo el happy path; el caso 1 verifica el conteo REAL via service_role.

## Tasks completas: si (para el alcance del run)

- T6.4 [x]: migracion 0075 escrita, NO aplicada al remoto (la aplica el leader). Alcance verificado abajo.
- T7.7 [~]: JUSTIFICADO. Cubre el sub-bullet register_birth (3 casos). Los sub-bullets exit_animal_profile /
  create_animal / soft_delete_* son dedup-natural (sin delta) y se testean en el run de T6.2 con la outbox. La marca
  [~] esta documentada en tasks.md con la razon. NO es un [ ] sin justificar.
- Resto de tasks (T1.6, T2.2/T2.3, T3-T8) fuera del scope de Run 2.

## CHECKPOINTS (Run 2)

- C1 harness: [x] check.mjs verde para todo MENOS la suite spec 15-powersync, que falla por la migracion no aplicada
  (ESPERADO; la aplica el leader). SQL y tests evaluados estaticamente. Verificado por la autorrevision del implementer:
  solo la suite spec 15-powersync falla; spec 02 y spec 13 verdes (suite top-level con setup aislado).
- C2 estado coherente: [x] feature 15 sigue in_progress (NO done). feature_list/current.md son de Run 1, no re-tocados.
- C3 codigo respeta arquitectura: [x] migracion aditiva en 0075 (numeracion correcta, disco llega a 0074). NO toca
  policy/RLS/trigger as-built. SECURITY DEFINER + set search_path = public. Sin hardcode de establishment_id.
- C4 verificacion real: [x] los tests cuentan el estado real via admin/service_role; el caso negativo verifica el reject real.
- C6 SDD: [x] specs gateadas reflejan exactamente el SQL; tasks marcadas; cada R del run con test.
- C7 multi-tenant: [x] guard triple-scopeado + has_role_in PRIMERO + indice compuesto; test de aislamiento cross-tenant (caso 2).
- C8 offline-first: [x] habilita la dedup at-least-once de la outbox (R6.10); LWW no aplica (parto append-only).

## Checklist RAFAQ-especifico (Run 2)

- A. tablas con establishment_id / RLS: APLICA PARCIAL. El delta NO crea tablas nuevas ni policies:
  - enable RLS: N/A (no hay tabla nueva; reproductive_events ya tiene RLS de 0026, intacta).
  - policies: N/A (no se tocan; R11.3 preservado: solo ADD COLUMN + CREATE INDEX + DROP/CREATE FUNCTION + grants).
  - has_role_in / is_owner_of: [x] has_role_in(v_est) sobre la fila real de la madre, rige PRIMERO (L102).
  - test de aislamiento cross-tenant: [x] caso 2 / T7.7.
  - deleted_at IS NULL: [x] en el SELECT de authz (L98) y en el lookup del guard (L121).
- B. offline-first: APLICA INDIRECTO. Server-side de la idempotencia de la outbox (R6.10). LWW documentado R12.2.
- C. BLE: N/A.
- D. UI de campo: N/A.
- E. Edge Functions: N/A (es una RPC SQL SECURITY DEFINER, no una Edge Function Deno).

## Verificaciones puntuales del brief (Run 2)

- Guard SCOPEADO (no literal global): OK. 0075:114-128. Filtra client_op_id + animal_profile_id = p_mother_profile_id +
  animal_profiles.establishment_id = v_est + deleted_at IS NULL, con has_role_in(v_est) PRIMERO (L102). NO puede devolver
  datos de otra madre/tenant. Coincide con el pseudo-SQL gateado de design 5.4.3(1).
- As-built preservado: OK. v_est/rodeo/species/system de la fila real de la madre via JOIN (0075:93-98). Evento + N
  terneros + birth_calves + transicion de la madre intactos (== 0045). Atomicidad por excepcion no capturada. Herencia
  de tenant del server (v_est, NO del payload). Evento insertado con calf_sex NULL: el trigger mono-ternero no actua.
- Path online intacto: OK. p_client_op_id default null, el if no entra, identico al as-built. Caso 3 lo prueba.
- Firma + grants: OK. DROP (uuid,date,jsonb) + CREATE de 4 args + revoke public/anon + grant authenticated (firma 4 args)
  + notify pgrst. Sin grants colgando. El DROP no rompe dependencias (refs en 0048/0067 son comentarios).
- Indice: OK. UNIQUE parcial COMPUESTO (animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL. No global.
- Aditivo: OK. Solo ADD COLUMN + CREATE INDEX + DROP/CREATE FUNCTION + grants + notify. Cero policy/RLS/trigger.
  Idempotente. Numeracion 0075 correcta.
- Tests: OK. Idempotencia (caso 1), T7.7 cross-tenant negativo (caso 2), path online (caso 3). Suite top-level aislada.
- OJO (migracion no aplicada): CONFIRMADO, NO se rechaza. Los 3 tests fallan hoy (PGRST202). El implementer NO aplico la
  migracion (archivo nuevo, sin script de apply). NO se toco feature_list (in_progress, NO done) ni sync-streams ni
  progress de coordinacion.

## Reconciliacion de specs (codigo -> spec): OK

La implementacion sigue al pie de la letra el spec gateado (5.4.3(1), 9-nota, R6.10/R11.3/R11.4, T6.4/T7.7). No hubo
desviacion. Las specs NO quedaron mintiendo respecto del codigo.

## Cambios requeridos (Run 2)

Ninguno. APPROVED para cerrar Run 2.

### Pendiente para el leader (NO bloquea el cierre del run)
- Aplicar 0075 al remoto por Management API (gateado). Tras aplicar, los 3 tests de spec 15-powersync deben pasar y la
  suite backend completa debe quedar verde (T7.5).

---

# Review - 15-powersync - T5 + T6 (escritura offline: CRUD plano + outbox/overlay/RPC-mapping)

> Reviewer (puerta de codigo). Alcance: Run 8 (T5.1/T5.2/T5.3) + Run T6 (T6.1, T6.2a-f, T6.5).
> Verificado contra: tasks.md T5/T6, design 5.2/5.3/5.4, requirements R6.*, impl_15 Run 8 / Run T6.
> Branch actual sin commitear. NO se edito codigo (solo lectura + check.mjs).

## Veredicto: CHANGES_REQUESTED

T5 y T6 estan implementados con calidad alta y el grueso del run cumple la spec: firmas publicas intactas,
split-insert/count eliminados, outbox op_intents (insertOnly) + overlay pending_* (localOnly) en UNA
writeTransaction, mapeo intent->RPC con p_client_op_id solo a register_birth, create_animal -> 2 upserts
idempotentes, UNION synced+overlay en todas las lecturas afectadas, ACK/rollback/idempotent_discard
clasificados, import_rodeo_bulk online, idempotencia at-least-once cubierta. check.mjs VERDE.

El bloqueo es UNO solo: un drift spec<->codigo sin reconciliar (regla dura). createRodeo quedo ONLINE y
T3.3 prometio explicitamente swapearlo en T5/T6; T5/T6 no lo hizo NI lo reconcilio como diferido. Es CRUD
plano R6.1/R6.3/R6.4-elegible (mismo class que crear/renombrar lote, que T5 SI swapeo) y rompe offline-first
para crear rodeo en campo. No es bug de seguridad/integridad, es spec vieja tras el run, que la regla dura
obliga a reconciliar antes de cerrar.

## Trazabilidad R<n> -> test (T5/T6)

| R<n> | Que verifica | Test concreto | Estado |
|---|---|---|---|
| R6.1 (CRUD plano local + upload, offline) | INSERT/UPDATE local de 6 add* + 3 de lote | local-reads.test.ts :: buildAdd{Weight,ConditionScore,Tacto,Service,Abortion,Observation}Insert + build{Create,Rename,Assign}* | OK |
| R6.3 (eliminar split-insert/count) | sin .select()/count exact en codigo activo | local-reads.test.ts :: buildRename (sin count), buildCreate (un INSERT) + grep 0 en codigo | OK |
| R6.4 (id de cliente) | el id va 1ro en args | local-reads.test.ts :: cada build*Insert asserta id primero; randomUuid() | OK |
| R6.5/R6.6 (clasif b RPC-bound; import online) | import_rodeo_bulk NO se encola | import-rodeo.ts intacto + kind network sin red | OK |
| R6.8 (outbox op_intents insertOnly) | genera CrudEntry, no replica fila plana | schema.test.ts :: R6.8 outbox op_intents insertOnly | OK |
| R6.9 (drenado intent->RPC) | mapeo + clasificacion | upload.test.ts :: mapIntentToRpc (4) + transient/permanent (3) | OK |
| R6.10 (idempotencia no doble-apply) | register_birth client_op_id; soft_delete P0002; create_animal ON CONFLICT | upload.test.ts :: 23505 uq -> idempotent_discard, P0002 + backend animal/run.cjs spec 15 casos 1/2/3 | OK |
| R6.11 (overlay local-only + UNION + rollback) | localOnly; UNION; clear/rollback por client_op_id | schema.test.ts :: pending_* localOnly + GUARD overlay; local-reads.test.ts :: UNION en list/count/search/detail/timeline/mother + clearOverlay + PENDING_OVERLAY_TABLES | OK |
| R6.12 (no doble-upload) | overlay localOnly (0 CrudEntry) -> 1 CrudEntry por op (b) | schema.test.ts :: localOnly de pending_*; garantia arquitectonica (E2E = T7.5/T7.9) | OK (arq; E2E->T7) |
| R11.1 (firmas publicas intactas) | exports sin cambio nombre/params/retorno | diff HEAD vs working: addWeight/.../createAnimal/registerBirth/exitAnimalProfile/softDelete* identicas; typecheck verde | OK |

> El cierre E2E in-vivo (1 CrudEntry server-side / no-doble-upload / rollback contra SQLite+PowerSync REAL)
> esta correctamente diferido a T7.5/T7.9 (NO marcado como hecho). En T5/T6 quedo la garantia arquitectonica + unit puros.

## Tasks completas: SI (con 1 drift no reconciliado)

- T5.1 [x], T5.2 [x], T5.3 [~] (N/A justificado: sin service de sessions/maneuver_presets, spec 03 diferida).
- T6.1 [x], T6.2a-f [x], T6.4 [x] (0075 aplicado: tests spec 15 register_birth VERDES), T6.5 [x], T6.6 [x] (0076 aplicado: verdes).
- Ninguna task de T5/T6 quedo [ ] sin justificacion.
- PERO: T3.3 (Run 3) prometio swapear createRodeo en T5/T6; no se cumplio ni se reconcilio.

## Exactitud de specs (codigo -> spec): reconciliaciones al as-built

Verificadas EN design.md (no solo en el impl log), landed via diff:
- create_animal sin RPC -> 2 upserts idempotentes: design 5.4.2 RECONCILIADO. OK.
- softDeleteRodeo: UPDATE directo -> RPC soft_delete_rodeo: design 1.2 + 5.3.1 RECONCILIADO. OK.
- exitAnimalProfile vive en animals.ts: design 1.2 RECONCILIADO. OK.
- overlay pending_animal_profiles shape completo + pending_reproductive_events created_at: design 5.3.3. OK.
- errores de dominio ya no se surfacing del return -> uploadData al subir: design 5.3.3. OK (UX elevada al leader).

DRIFT NO RECONCILIADO (bloqueante): design 1.2 (rodeos.ts -> create/update local CRUD plano R6.1) contradice
el as-built (createRodeo sigue ONLINE en rodeos.ts:206-252: insert online + before/after via fetchRodeosOnline,
sin id de cliente ni outbox). tasks.md T3.3 dice que T5/T6 lo swaparia; T5/T6 no lo hizo ni anoto por que.

## CHECKPOINTS

No existe CHECKPOINTS.md en la raiz (verificado). El gating vive en tasks.md (Gate 1 spec, Puerta 1 humana) y
feature_list.json. N/A para este review.

## Checklist RAFAQ-especifico

- A. Multi-tenancy / RLS: N/A para el codigo de T5/T6 (no se crean tablas/policies; escope 100% cliente services/).
  El aislamiento cross-tenant de las escrituras lo valida el server al SUBIR (RLS + triggers force 0077, re-validado
  en uploadData) + backend tests (spec 15 cross-tenant register_birth caso 2, VERDE). El wire son las streams (Gate 1).
- B. Offline-first:
  - [x] Funciona offline: 6 add* + 3 de lote local (runLocalWrite); las 4 b RPC-bound encolan intent + overlay (UNION).
        createAnimal/registerBirth resuelven category/species/contexto-madre DESDE LOCAL.
  - [ ] createRodeo NO funciona offline (sigue online): el drift bloqueante.
  - [x] Sync bucket scoping: N/A en T5/T6 (streams ya scopean por establishment_id activo; no se tocan).
  - [x] Resolucion de conflictos: LWW PowerSync (editables) + append-only (eventos, R12.2); b RPC-bound con
        idempotencia explicita/natural documentada (5.4.3). Justificada.
  - [x] No requests sincronos desde la pantalla: todo via services; campo toca SQLite local. EXCEPCION: createRodeo (drift).
- C. BLE: N/A.  D. UI de campo: N/A (capa services; R11.1 confirma sin tocar pantallas).  E. Edge Functions: N/A (R7.1/T6.3).

## Scope (nada fuera de T5/T6)

VERIFICADO via git status + diff: NO se toco sync-streams/rafaq.yaml, supabase/migrations/, supabase/. Cambios en
app/src/services/{animals,events,management-groups,rodeos}.ts + services/powersync/* + specs/progress. import-rodeo.ts
intacto (T6.1). AppSchema de streams paso 2 sin tocar. T6.3 (identidad/admin online) sin tocar. OK.

## Cambios requeridos

1. [BLOQUEANTE - drift spec<->codigo, regla dura] createRodeo quedo ONLINE sin reconciliar.
   - Codigo: app/src/services/rodeos.ts:206-252 - insert online + before/after via fetchRodeosOnline, sin id de cliente ni outbox.
   - Spec que lo promete: specs/active/15-powersync/tasks.md:29 (T3.3) - createRodeo/softDeleteRodeo siguen ONLINE (T5/T6).
   - Spec que quedo mintiendo: specs/active/15-powersync/design.md:49 (1.2) - rodeos.ts -> create/update local (CRUD plano, R6.1).
   - Es CRUD plano single-tabla (INSERT en rodeos), mismo class que createManagementGroup que T5 SI swapeo. Rompe offline-first (R6.1).
   - Resolucion (una de dos):
     (a) swapear createRodeo a escritura local (id de cliente + runLocalWrite + eliminar before/after online), o
     (b) decidir que queda ONLINE deliberadamente y documentarlo en design 1.2 + impl_15 Run T6 + ajustar tasks.md T3.3.
   - El implementer reconcilia (no lo arregla el reviewer).

## Pendiente para el leader (NO bloquea una vez cerrado el drift)

- Decision de producto (design 5.3.3): UX offline de duplicados (sin feedback inmediato de caravana/IDV/tag duplicada;
  se ve al sincronizar). El implementer propone evaluar check de unicidad LOCAL best-effort pre-encolado. No bloquea el codigo.
- T7.5/T7.9 (E2E in-vivo no-doble-upload + rollback contra SQLite/PowerSync REAL) correctamente diferidos a T7.


============================================================

Review 15-powersync . Run T9.8 (createRodeo OFFLINE - RPC create_rodeo 0081 + outbox/overlay, un-defer)

Reviewer (puerta de codigo). Alcance: el un-defer de createRodeo (que quedo ONLINE y motivo el
CHANGES_REQUESTED del review T5/T6) a OFFLINE via RPC create_rodeo (0081) + outbox + overlay optimista.
Verificado contra: tasks.md T9.8/T3.3, design seccion 1.2 (un-defer reconciliado), docs/backlog.md (entrada
RESUELTA), impl_15 Run T9.8. Branch sin commitear (sobre 32630a0). NO se edito codigo. baseline: HEAD = 32630a0.

## Veredicto: APPROVED

El un-defer cierra el ULTIMO write que faltaba offline y resuelve EXACTAMENTE el bloqueo del review T5/T6
(createRodeo ONLINE = drift spec-codigo). Firma publica intacta (R11.1); patron outbox/overlay correcto (1
op_intent insertOnly + 2 overlay localOnly en 1 writeTransaction; UNION en las 2 lecturas; ACK limpia overlay /
permanente rollbackea, cubren AMBAS overlay via PENDING_OVERLAY_TABLES=7); plantilla optimista EQUIVALENTE a la
server-side; sin doble-upload (overlay localOnly = 0 CrudEntry, schema.test); scope aditivo (1 RPC + swap
cliente); specs reconciliadas. RPC idempotente natural (ON CONFLICT DO NOTHING del id + UPSERT de toggles),
owner-only (is_owner_of, espeja rodeos_insert), guard anti-IDOR. Los 4 tests de la RPC FALLAN hoy SOLO porque
0081 no esta aplicada al remoto (PGRST202) - ESPERADO y documentado (regimen 0075-0080: la aplica el leader tras
gatear). NO motiva rechazo (precedente Run 2, este mismo archivo).

## Trazabilidad R(n) a test (T9.8)

- R5.1  rodeo alta-optimista en la lista local . local-reads.test.ts buildRodeosQuery (UNION pending_rodeos) +
        buildSystemByCodeQuery . OK
- R6.4  id de cliente reusado por la RPC (ON CONFLICT) . run.cjs create_rodeo caso 1 (ret==rodeoId) + caso 2
        (replay = mismo id) . OK (rojo hoy = 0081, ESPERADO)
- R6.10 idempotencia no doble-apply (replay = no-op total) . run.cjs caso 2 (1 rodeo, 26 filas no 52) +
        upload.test.ts create_rodeo NO idempotent_discard . OK (rojo hoy = 0081)
- R6.11 overlay localOnly + UNION + clear/rollback de las 2 . schema.test.ts pending_* localOnly (7) + GUARD
        overlay; local-reads.test.ts buildRodeoConfigQuery UNION + buildPendingRodeoInsert +
        buildClearOverlayDelete + PENDING_OVERLAY_TABLES 7 . OK
- R6.12 no doble-upload (overlay 0 CrudEntry, 1 op_intent) . schema.test.ts pending_rodeos/config localOnly;
        upload.test.ts mapIntentToRpc create_rodeo a 1 rpc . OK (arquitectonico; E2E T7.9)
- R11.1 firma publica intacta (ServiceResult Rodeo) . typecheck verde + rodeos.ts 176-261; wizard no se toca . OK
- R11.3/R11.4 delta backend aditivo, gateado . 0081 = CREATE FUNCTION + grants + notify . OK
- anti-IDOR p_id colisionado con rodeo ajeno a 42501, plantilla ajena intacta . run.cjs caso 4 . OK (rojo hoy=0081)
- authz owner-only no-owner a 42501, nada creado . run.cjs caso 3 . OK (rojo hoy = 0081)

Ningun R(n) del alcance queda sin test.

## Equivalencia plantilla optimista vs RPC (checklist 3) - VERIFICADA

- Server: trigger tg_rodeos_seed_data_config (0018) seedea 1 fila por system_default_field con
  enabled=default_enabled (26 en cria); la RPC UPSERTea el diff (UPDATE de defaults cambiados + INSERT de
  no-defaults habilitados).
- Optimista: buildEffectiveConfigRows = buildWizardToggles (1 fila por system_default_field con estado FINAL del
  usuario) + 1 fila por cada insert del diff. Mismo set de filas, mismo enabled final por field. COINCIDEN, sin
  drift visual.
- Edge case OK: si fetchSystemDefaults no sincronizo, configRows vacio y pToggles vacio (rodeos.ts 218-230); se
  encola sin plantilla optimista (la real baja por la stream; la lista igual aparece). Degradacion documentada.

## Tasks completas: SI

- T9.8 [x]: RPC 0081 + schema (2 overlay) + outbox (enqueueCreateRodeo) + upload (create_rodeo en RPC_OP_TYPES) +
  rodeos.ts (createRodeo offline, fetchRodeosOnline eliminado) + local-reads (UNION 2 queries + builders) +
  rodeo-template (buildEffectiveConfigRows puro) + tests.
- T3.3 [x]: reconciliado (createRodeo offline HECHO en T9.8; fetchRodeosOnline eliminado).
- Ninguna task [ ] sin justificacion. El unico rojo = 0081-no-aplicada (la aplica el leader), marcado ESPERADO en
  el SQL, el test, tasks.md y el impl log - patron identico a 0075-0080.

## Exactitud de specs (codigo a spec): reconciliado, sin drift

- design 1.2 (rodeos.ts): RECONCILIADO. Describe createRodeo OFFLINE via RPC 0081 + outbox/overlay, con motivo
  (plantilla por trigger + PK compuesta read-only-local) e idempotencia natural. Ya NO dice create/update local
  CRUD plano (la linea que mentia en el review T5/T6).
- tasks.md T9.8 + T3.3: byte-fiel al codigo.
- docs/backlog.md: entrada createRodeo marcada RESUELTA (2026-06-09, Run T9.8) con la opcion (b) implementada.
- impl_15 Run T9.8: subtareas [x], autorrevision (anti-IDOR), rojo esperado = 0081 no aplicada documentado.
- MINOR (no bloqueante): la enumeracion en prosa de la whitelist de op_types en design 5.4.2 (nota Run T6) NO
  incluye create_rodeo. Texto ilustrativo, no contrato (el contrato vive en upload.ts RPC_OP_TYPES + design 1.2 +
  tasks T9.8). Sugerencia: sumarlo la proxima vez que se toque 5.4.2.

## CHECKPOINTS (alcance T9.8)

- C1 harness: [x] check.mjs ROJO SOLO por los 4 tests create_rodeo (0081 no aplicada) - ESPERADO (regimen
  0075-0080). Resto VERDE (typecheck, 745 client units, RLS, Edge, spec 02/13/15-delta/paso2).
- C2 estado coherente: [x] feature 15 sigue in_progress (NO done).
- C3 arquitectura: [x] swap en services/ + utils/rodeo-template (puro); 0081 aditiva (0081, disco 0080); sin debug
  logs nuevos (el console.log de connector es prexistente T1, fuera de scope); SIN hardcode de establishment_id.
- C4 verificacion real: [x] la RPC se testea contra estado real (26 filas, peso aplicado, anti-IDOR before/after);
  buildEffectiveConfigRows 4 casos; UNION/overlay/clear con unit reales.
- C6 SDD: [x] 3 archivos; tasks T9.8 [x]; cada R con al menos 1 test.
- C7 multi-tenant: [x] owner-only (is_owner_of PRIMERO, espeja rodeos_insert) + guard anti-IDOR (caso 4); trigger
  0078 fuerza establishment_id de la plantilla desde el rodeo.
- C8 offline-first: [x] createRodeo funciona offline (intent + overlay, rodeo Y plantilla al instante via UNION);
  idempotencia at-least-once; sin requests sincronos desde la pantalla.

## Checklist RAFAQ-especifico

- A. Multi-tenancy / RLS: APLICA. enable RLS N/A (no crea tablas; rodeos/rodeo_data_config ya con RLS 0017/0018).
  policies N/A (0081 no toca). has_role_in/is_owner_of [x] (is_owner_of PRIMERO 0081 linea 53, sin SQL duplicado).
  aislamiento cross-tenant [x] (caso 4 anti-IDOR + caso 3 no-owner). deleted_at IS NULL [x] (guard 0081 linea 90).
- B. Offline-first: funciona offline [x]; sync bucket N/A en cliente (deploy = T9.3); conflictos = idempotencia
  natural (ON CONFLICT + UPSERT) [x]; sin requests sincronos desde pantalla [x].
- C. BLE: N/A.  D. UI de campo: N/A (services; R11.1 sin tocar wizard).  E. Edge Functions: N/A (RPC SQL, no Deno).

## Scope (checklist 6)

VERIFICADO: delta backend = 1 RPC (0081), aditiva, no toca RLS/policies/triggers/streams/otras migraciones. Swap
cliente solo el camino de createRodeo. Los diffs grandes de animals/events/management-groups NO son scope T9.8:
son el swap T4/T5/T6 prexistente NO commiteado (HEAD 32630a0 commiteo solo el backend paso 1+2; el animals.ts de
HEAD sigue ONLINE/pre-swap, verificado) - ya revisado en el review T5/T6 de este archivo. Las columnas extra de
schema.ts (created_by/nursing/is_castrated/heifer_fitness/client_op_id + GUARD) son el fix del bug T4
no-such-column del mismo working tree, reconciliado en design 3 - fuera del alcance T9.8 pero documentado y correcto.

## Cambios requeridos (T9.8)

Ninguno. APPROVED.

## Pendiente para el leader (NO bloquea el cierre del run)

- Aplicar 0081_create_rodeo_rpc.sql al remoto por Management API (gateado por Gate 1 spec). Tras aplicar, los 4
  tests create_rodeo deben pasar y la suite backend quedar verde (T7.5). Unico rojo hoy.
- E2E in-vivo del alta de rodeo offline diferido a T7.9.
- MINOR opcional: sumar create_rodeo a la enumeracion en prosa de la whitelist de op_types en design 5.4.2.
