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

============================================================

# Review — 15-powersync · Run bugfix-overlay-list (bug "animal creado OFFLINE desaparece de la lista al navegar de tab")

Reviewer (puerta de código). Alcance: fix del bug del backlog 2026-06-10 (repro en vivo de Raf).
Working tree SIN commitear sobre 8db117f. Verificado contra: design §5.1 (as-built nuevo), tasks.md T11
(sub-bullet), docs/backlog.md, impl_15 (Run bugfix-overlay-list). NO se editó código.

## Veredicto: APPROVED

Fix mínimo y dirigido a la causa raíz confirmada con evidencia (no plausibilidad): la ejecución de
`searchAnimals` vivía SOLO en el efecto `[establishmentId, debouncedQuery]` → con un término en el
buscador, el re-foco de la tab re-corría la lista pero NO la búsqueda → `searchResults` stale
("No encontramos «N»") aunque el animal estaba en el overlay. Extracción a `runSearch` (mismo
seq-guard, mismas deps) + re-corrida en `useFocusEffect` y en el efecto de `lastSyncedMs`, simétrico
a `loadList`. El diagnóstico descartó rollback espurio del overlay / JOIN / contexto con dumps del
SQLite local y captura de consola (cero `[powersync] upload rechazado` en 10+ retries transient).

## Trazabilidad (alcance del run — bugfix, sin R nuevos)

| Qué | Test |
|---|---|
| Animal offline-only visible en la lista a través de Más→Animales (R6.11 overlay en lectura + ppio 3 offline-first) | `app/e2e/animals-offline.spec.ts` test 1 (repro literal; verde en baseline = red de regresión declarada) |
| Búsqueda activa re-computada al re-foco (causa raíz) | `animals-offline.spec.ts` test 2 — **ROJO en baseline → VERDE con fix**, verificado por stash (impl log, Verificación) |
| Upload offline clasifica transient y NO toca overlay (R6.9, regresión) | test 1: dwell 6s ≥1 ciclo de retry + oráculo de visibilidad + consola capturada (un rechazo lo haría fallar e imprime el diagnóstico) |

`requirements.md` SIN cambio: defendible — R6.11/R5 ya exigían ver el overlay en las lecturas; el fix
es mecanismo de UI (cómo), no cambia ningún "qué". Decisión documentada en el impl log (paso 9).

## Verificaciones puntuales del brief

1. **¿Puede loopear?** No. `runSearch` solo cambia identidad con `establishmentId`/`debouncedQuery`
   (las MISMAS deps del efecto original); ni `runSearch` ni `loadList` mutan sus propias deps
   (los setState que disparan — `searchResults`/`searching`/`list`/`loading` — no son deps de nada);
   `lastSyncedMs` es primitivo y solo avanza con syncs nuevos (offline no cambia). Query vacío
   short-circuitea sin tocar services → comportamiento online sin término: CERO cambio.
2. **Scope del diff** (git status): `animales.tsx` (único de app) + `animals-offline.spec.ts` (nuevo)
   + reconciliación (design/tasks/backlog) + bitácoras. `provider.tsx` NO está en el diff
   (byte-idéntico, confirmado por git). Grep de `__rafaqDebugDumpOverlay|rafaqDebug|DumpOverlay|debugDump`
   sobre `app/` → **0 matches**: cero instrumentación residual; el spec nuevo solo captura consola
   (Playwright puro) y la imprime al fallar.
3. **Calidad del E2E**: helpers reales reusados (`gotoTab`/`gotoAnimales`/`seedRodeo`/`cleanupAll`/
   `RUN_TAG` existen en `e2e/helpers/`), selectores idénticos al patrón de la suite (mismos
   `getByRole('button', { name: 'Volver'/'Dar de alta tu primer animal' })` que `animals.spec.ts`),
   `afterAll(cleanupAll)` + usuarios namespaced, sin dependencia del hook de debug removido. El único
   `waitForTimeout(6_000)` está justificado y documentado en el comment: dwell para que corra ≥1 ciclo
   de retry del upload offline (~5s en el SDK) ANTES del oráculo de visibilidad — es lo que convierte
   el test 1 en red de regresión de la clasificación transient, no un band-aid de flakiness. ACEPTADO.
4. **Specs vs código**: design §5.1 as-built describe EXACTAMENTE el fix (`runSearch` + los 2 puntos de
   re-corrida + el descarte de hipótesis con evidencia); tasks.md T11 sub-bullet fiel; backlog
   ✅ RESUELTO con la causa real + hallazgo lateral ProfileContext registrado como entrada nueva
   (scope discipline correcto: anotado, no improvisado). Sin drift.
5. **UI de campo (sin flicker)**: `setSearching(true)` corre sincrónico al inicio de `runSearch` y
   `showNoMatch` exige `!searching` (animales.tsx:210) → durante el re-search no se muestra un
   no-match falso; el SQLite local resuelve en ms. Sin cambios de layout/targets/copy.

## CHECKPOINTS (alcance del run)

- C1 harness: [x] `node scripts/check.mjs` → exit 0 (re-corrido por este reviewer: typecheck + lint
  anti-hardcode 0 violaciones + client units + RLS/Edge/Animal/Maneuvers/User_private/Import verdes).
- C2 estado coherente: [x] 15-powersync sigue única `in_progress`; NO done; current.md describe el run.
- C3 arquitectura: [x] cambio contenido en la pantalla; sin deps nuevas; sin logs de debug (los
  `console.log` del spec E2E solo imprimen al fallar — patrón de la suite); sin hardcode de
  `establishment_id` (`runSearch` usa el del contexto).
- C4 verificación real: [x] oráculo E2E contra PowerSync/SQLite real con `context.setOffline(true)`
  (primeros tests offline reales de la suite); test 2 ROJO→VERDE por stash = falla por la razón
  correcta. Leader corrió `pnpm exec playwright test e2e/animals-offline.spec.ts` → 2/2 verdes (27.5s).
  Sin unit nuevo: `animales.tsx` no es cargable bajo node:test (patrón del repo, justificado en impl log).
- C8 offline-first: [x] el bug ERA de offline-first y el fix lo cierra con cobertura automatizada nueva;
  buckets/streams/conflict-resolution intactos (cero cambios de sync).

## Checklist RAFAQ-específico

- A (RLS/multi-tenancy): **N/A** — cero cambios de schema/RLS/policies. Scoping por contexto intacto.
- B (offline-first): **APLICA** — [x] funciona offline (2 E2E con `setOffline(true)`); [x] buckets sin
  cambio; [x] conflictos sin cambio (overlay/outbox intactos, verificados sanos por los dumps);
  [x] la pantalla no hace requests síncronos a Supabase (services → SQLite local).
- C (BLE): **N/A**.
- D (UI de campo): **APLICA** — [x] sin cambio de targets/fuentes/layout; [x] loading visible
  (`searching` + "Cargando…" intactos); [x] sin flicker del no-match (punto 5 arriba).
- E (Edge Functions): **N/A**.

## Observaciones MINOR (no bloquean)

- **M1 — runSearch redundante por tipeo con la tab enfocada**: al cambiar `debouncedQuery` cambia la
  identidad de `runSearch` → además de su efecto propio, se re-disparan el `useFocusEffect` (que
  también corre `loadList`) y el efecto de `lastSyncedMs` (si ≠0) → hasta 3 `runSearch` + 2 `loadList`
  extra por tick de debounce. Correctitud garantizada por `searchSeq`/`listSeq` (último gana); costo =
  queries redundantes al SQLite local (ms). El patrón PRE-EXISTÍA para `loadList` (cambios de filtro) —
  el fix es simétrico, no lo introduce. Se borra gratis con la migración a `useQuery`/`watch`
  (backlog 2026-06-09).
- **M2 — `toHaveCount(0)` instantáneo** (animals-offline.spec.ts:171/178): solo, sería un assert débil
  (pasa en el instante 0 antes del render); está apareado con el oráculo fuerte (`'34'` visible) y el
  ROJO de baseline se verificó por stash, así que el test falla por la razón correcta. OK como está.

## Cambios requeridos

Ninguno.

---

# Review — 15-powersync · Run create-animal-rpc (RPC atómica 0083 — cierra la pérdida real del alta)

> Reviewer (puerta de código). Alcance del run: migración 0083 (YA APLICADA al remoto por el leader,
> Management API HTTP 201, post-apply verificado) + cliente (upload.ts/connector.ts) + 7 tests backend +
> oráculo E2E de persistencia server-side + reconciliación de specs. Trabajo SIN commitear, apilado sobre
> el Run bugfix-overlay-list (ya APPROVED — no se re-revisó salvo la colisión en animals-offline.spec.ts).
> Gate 1 ya emitido: PASS 0 HIGH, 1 MED no bloqueante (entry_weight sin CHECK de rango, precedente MED-01)
> — sección "Run create-animal-rpc — Gate 1" en progress/security_spec_15-powersync.md. Este review cubre
> CORRECTITUD funcional (la seguridad ya está gateada).

## Veredicto: APPROVED

Verificación EJECUTADA por el reviewer (no solo leída):
- `node scripts/check.mjs` → exit 0, "All tests passed" — incluye los 7 casos de la suite
  `create_animal RPC` (supabase/tests/animal/run.cjs:2803) ahora VERDES post-apply de 0083.
- E2E vivo contra el remoto con 0083: `pnpm e2e:build` (export fresco) + `playwright test
  e2e/animals-offline.spec.ts` → 2/2 verdes (test 1 con el bloque nuevo de drenado: alta offline →
  reconectar → fila REAL en animal_profiles vía admin en ~18s + el animal sigue en la lista + cero
  "upload rechazado"). `animals.spec.ts -g "alta guiada desde empty"` (oráculo online) → verde.
- Bonus probatorio: la primera corrida del reviewer fue accidentalmente contra el `dist/` VIEJO
  (build 01:50, cliente de 2 upserts) y el oráculo nuevo la cazó EN VIVO con la cadena exacta del bug
  (403 → {table: op_intents, op: PUT, code: 42501} → "[powersync] upload rechazado (descartado)" →
  el alta jamás llegó al server). Misma corrida con el export fresco (cliente RPC): verde. Demostración
  A/B de que (a) el oráculo detecta el bug real y (b) la RPC lo cierra.

## Correctitud funcional revisada (foco pedido por el leader)

1. Migración 0083 (`supabase/migrations/0083_create_animal_rpc.sql`):
- Estilo/estructura calcada de 0081 (header con racional, begin/commit, authz PRIMERO, ON CONFLICT (id)
  DO NOTHING, guards post-insert, comment on function, revoke public/anon + grant authenticated con la
  firma tipada completa de 20 args, notify pgrst). Comentarios consistentes con el código (verificado).
- Edges del flujo a/a-bis/b/b-bis/c/c-bis correctos:
  - Replay tras edición de identidad: el corte (a-bis) matchea por perfil (id+animal+est) ANTES del
    guard de identidad (b-bis) → no rechaza 42501 espurio un replay legítimo. Correcto.
  - Half-state healing: (b) DO NOTHING sobre el huérfano + (b-bis) matchea (payload idéntico,
    IS NOT DISTINCT FROM NULL-safe para tag/birth_date) + (c) crea el perfil. El caso 3 lo prueba con el
    estado EXACTO del bug (huérfano pre-insertado vía service role) y asserta NO-42501. Correcto.
  - Soft-deleted: (a-bis) sin filtro deleted_at A PROPÓSITO (un perfil soft-deleteado post-apply NO se
    resucita en el replay — documentado); un `animals` soft-deleteado no matchea (b-bis) → 42501
    (rechazo deliberado de una entidad removida). Correcto.
  - Mismatch/anti-IDOR: (b-bis) y (c-bis) → 42501 genérico sin oráculo de qué difiere; el caso 7 ataca
    con un caller que SÍ pasa la authz (rol en SU campo) — testeado por la razón correcta.
  - 23505 de dominio NO se traga: target del ON CONFLICT = SOLO la PK; tag/idv duplicados salen
    (casos 5 y 6) y el caso 5 además asserta ATOMICIDAD (sin huérfano nuevo). Correcto.
- Enums animal_status/teeth_state_enum verificados contra la DB real por el veto manual del leader (citado).

2. Cliente:
- `upload.ts::mapIntentToRpc`: mapeo verificado CAMPO POR CAMPO contra la firma de 20 args de la RPC y
  contra lo que `animals.ts::createAnimal` pone en params_json (animals: id/sex/species_id/tag_electronic?/
  birth_date?; profile: id/animal_id/establishment_id/rodeo_id/category_id/category_override/status/idv?/
  visual_id_alt?/breed?/coat_color?/entry_date?/entry_weight?/management_group_id?/teeth_state?/nursing?).
  Sin huecos ni args de más; sin p_client_op_id (correcto: la firma no lo tiene). Keys opcionales ausentes
  (intents VIEJOS ya encolados en devices) → null explícito → defaults server-side: drenan por el camino
  nuevo sin migración local (test unit "MINIMAL" lo cubre). Sin ids de cliente → PermanentIntentError
  (anti-loop). IntentPlan quedó single-variant — sin dead code.
- `connector.ts`: rama de 2 upserts ELIMINADA limpia — grep confirma cero referencias vigentes a
  from('animals').upsert / plan.kind === 'create_animal'; solo comentarios históricos correctos.
- `classifyIntentUploadError` sin cambio de lógica; para create_animal-as-RPC: 42501/23505 → permanent,
  red/5xx → transient, replay = 2xx sin error (testeado en upload.test.ts).
- `outbox.ts`/`animals.ts`: solo docs (el shape del intent NO cambió — decisión compat > estética, correcta).

3. Tests backend (suite `create_animal RPC`, 7 casos): bien construidos, no pasan por la razón equivocada —
caso 3 reproduce el bug real (huérfano vía service role → perfil creado + NO 42501); caso 4 asserta NADA
creado (authz antes de escribir); caso 7 con authz que PASA (anti-IDOR puro); casos 5/6 assertan reject +
atomicidad, no solo el happy path. Verdes post-apply (corrida propia de check.mjs).

4. E2E: `waitForServerAnimalProfile` (admin polling, error accionable) + oráculo en animals.spec.ts test 1
+ extensión del offline test 1. Coherente con la suite (RUN_TAG, cleanup, fixtures). El oráculo del run
ANTERIOR en el offline test 1 quedó intacto (solo se apendeó el bloque de drenado al final). Corridos y
verdes por el reviewer.

5. Reconciliación de specs (código → spec): design §5.3.1 (fila createAnimal as-built RPC + alternativa
"orden atómico" probada insuficiente), §5.4.2 (nota Run T6 marcada SUPERSEDIDA con la cadena del 42501 +
nota as-built VIGENTE con whitelist completa incl. create_rodeo/set_rodeo_config — matchea RPC_OP_TYPES
del código), §5.4.3(3) ("SIN delta" acotado a schema), requirements R6.10 (nota de reconciliación sin
reescribir el EARS), tasks T6.2c/T6.2d/T7.7 anotadas. Grep global: NO queda ningún rastro VIGENTE de
"create_animal NO tiene RPC / 2 upserts" como verdad actual.

6. No rompe el run anterior: animales.tsx no tocado por este run; animals-offline.spec.ts solo extiende
el test 1 después del oráculo original; ambos tests del run anterior verdes en mi corrida (2/2).

## Trazabilidad R<n> ↔ test (este run)

| R<n> | Test concreto | Estado |
|---|---|---|
| R6.9 (drenado vía RPC; reject permanente superficia) | upload.test.ts :: "create_animal → RPC atómica 0083…" + "create_animal como RPC (0083)…" | verde |
| R6.10 (no doble-apply del alta) | run.cjs :: create_animal RPC :: caso 2 (replay no-op) | verde post-apply |
| R6.10/R6.9/R6.11 (EL BUG: half-state no pierde el alta) | run.cjs :: caso 3 (healing) + animals-offline.spec.ts test 1 (bloque drenado) | verdes (corridos por el reviewer) |
| R6.2 (server re-valida; triggers dentro de la RPC) | run.cjs :: caso 1 (created_by + identidad forzados por 0043/0079) | verde |
| R8.1/R11.4 (authz/anti-IDOR de la RPC nueva) | run.cjs :: casos 4 y 7 | verdes |
| R6.9 (rechazo de dominio legítimo SALE + atomicidad) | run.cjs :: casos 5 y 6 | verdes |
| Persistencia server-side del alta (gap E2E del bug) | animals.spec.ts test 1 + animals-offline.spec.ts test 1 (oráculo admin) | verdes (corridos) |
| Compat intents viejos | upload.test.ts :: "create_animal MINIMAL (intent VIEJO…)" | verde |

## Tasks completas: sí (alcance del run)

T1–T5 del plan del run todas hechas (bitácora impl_15 § Run create-animal-rpc). Las [ ] restantes de
tasks.md (T6.3, T7.2, T7.4, T7.8, T7.9…) son de OTROS runs de la feature multi-run — justificado.
T7.7 sigue [~] con el sub-bullet create_animal ahora cubierto server-side (anotado en tasks.md).

## CHECKPOINTS

- C1 harness completo: [x] check.mjs exit 0 (corrida propia).
- C2 estado coherente: [x] una sola feature in_progress (15-powersync); no se marcó done; current.md describe la sesión.
- C3 arquitectura: [x] cambios en services/powersync + migración + tests; sin deps nuevas; sin TODOs sin contexto (el "TODO intent…" cazado y reescrito en la autorrevisión); sin establishment_id hardcodeado (lint anti-hardcode verde; la RPC lo recibe como param y lo guarda has_role_in).
- C4 verificación real: [x] 7 tests backend contra la DB remota real (fixtures reales, sin mocks de I/O crítico) + unit del mapeo + E2E con oráculo server-side; cross-tenant caso 4.
- C5 cierre: [x] sin artefactos sin trackear (dist/, test-results/, public/@powersync/ gitignoreados); history/current los maneja el leader al cerrar.
- C6 SDD: [x] specs reconciliadas al as-built (punto 5); cada R del run con ≥1 test (tabla arriba).
- C7 multi-tenant: [x] sin tabla nueva (RPC aditiva); has_role_in() helper (no SQL inline); cross-tenant caso 4 + anti-IDOR caso 7; deleted_at en los guards (b-bis)/(c-bis).
- C8 offline-first: [x] el alta sigue 100% offline (outbox/overlay intactos); solo cambió el camino de SUBIDA; buckets/streams sin cambios; idempotencia documentada (replay no-op + healing, design §5.4.3(3)).

## Checklist RAFAQ-específico

- A (RLS/multi-tenancy): APLICA PARCIAL — sin tabla nueva ni cambio de RLS/policies (migración aditiva,
  verificado por Gate 1); [x] has_role_in() helper usado (no SQL duplicado inline); [x] test de
  aislamiento cross-tenant (caso 4) + anti-IDOR (caso 7); [x] deleted_at IS NULL en los guards.
- B (offline-first): APLICA — [x] funciona offline (E2E setOffline 2/2, corridos); [x] sync bucket
  scoping sin cambio; [x] resolución de conflictos documentada (replay at-least-once = no-op natural por
  ids de cliente, design §5.4.3(3)); [x] sin requests síncronos a Supabase desde pantallas (el cambio
  vive en el connector/drenado).
- C (BLE): N/A.
- D (UI de campo): N/A — cero cambios de UI en este run.
- E (Edge Functions): N/A — la RPC es función Postgres (no EF); auth vía has_role_in PRIMERO + Gate 1 PASS.

## Observaciones MINOR (no bloquean)

- M1 — trampa del export viejo: `playwright test` directo sirve un dist/ stale en silencio
  (reuseExistingServer + sin rebuild) — la primera corrida del reviewer falló por eso (y de paso
  reprodujo el bug con el cliente viejo). El camino canónico `pnpm e2e` ya rebuilda; toda validación
  E2E post-cambio-de-cliente debe pasar antes por `pnpm e2e:build`. Pre-existente al run.
- M2 — presupuesto del oráculo: waitForServerAnimalProfile default 30×2s = 60s == timeout 60_000 del
  playwright.config → en una regresión real el test moriría por timeout de Playwright (mensaje genérico)
  antes que por el error accionable del helper. Con el cliente nuevo el drenado aterriza en segundos
  (test 1 completo: 18.3s) → no flakea en la práctica. Ajustable gratis (tries: 20) si molesta.
- M3 — match vacío: waitForServerAnimalProfile(est, {}) matchearía cualquier perfil del campo. Ambos
  call sites pasan un identificador; footgun teórico del helper.

## Cambios requeridos

Ninguno.

## Para el leader (post-aprobación)

- 0083 ya aplicada y verificada; el ORDEN DE DEPLOY que pedía la bitácora quedó satisfecho (RPC viva
  antes de servir/commitear el cliente nuevo).
- La entrada REABIERTA del backlog 2026-06-10 queda lista para cerrarla vos (el implementer no la tocó,
  correcto). La limpieza de los huérfanos reales del campo de Raf sigue pendiente (la RPC los sana solo
  si el intent re-drena; los de "12"/"211" perdieron su intent → no se auto-sanan).


---

# Review — Run cierre-T7 (2026-06-10)

> Reviewer pass del run "cierre Fase T7": T7.2 + T9.7 (suite no-bypass por device, supabase/tests/sync_streams/run.cjs, NUEVO), T7.3 (E2E evento simple offline + oraculo server-side), enganche en scripts/run-tests.mjs, reconciliacion de tasks.md/design.md. Alcance verificado: SOLO tests + docs (cero schema/RLS/EF/streams/migraciones).

## Veredicto: APPROVED

## Restriccion dura del run (PROHIBIDO tocar schema/RLS/EF/streams) — CUMPLIDA
git status confirma cero cambios en supabase/migrations/, supabase/functions/, sync-streams/. El run toca: supabase/tests/sync_streams/run.cjs (NUEVO), scripts/run-tests.mjs (enganche L76), app/e2e/animals-offline.spec.ts, app/e2e/helpers/admin.ts, specs/active/15-powersync/tasks.md+design.md, progress/impl_15-powersync.md. Nada fuera de tests + docs. Sin mutant file residual (verificado: solo run.cjs en el dir).

## check.mjs — VERDE (corrido por el reviewer)
node scripts/check.mjs -> exit 0. La suite nueva corre 25 subtests, 25 pass, 0 fail, + cleanup verde. Todas las suites previas (RLS/Edge/Animal/Maneuvers/User_private/Import) siguen verdes con 0075-0083 aplicadas. La suite esta enganchada DENTRO del gate SUPABASE_SERVICE_ROLE_KEY (L76) -> corre siempre que haya keys (no es verde-falso por no-enganche, leccion sesion 18 respetada).

## FOCO 1 — Fidelidad predicado-simulado vs YAML deployado: PASS (con nota de drift)
Comparacion stream-por-stream del SQL que la suite ejecuta (helpers orgScope/ownerScope/syncSetIds/rowsInSyncSet) contra el predicado real de sync-streams/rafaq.yaml (V3 JOIN-FREE):
- orgScope(u) = user_roles WHERE user_id=u AND active=true -> identico al CTE org_scope del YAML. ownerScope anade role=owner -> identico a owner_scope. OK
- Per-establishment (est_animal_profiles/est_rodeos/est_management_groups/ev_*): syncSetIds(t, scope, withDeletedAtFilter:true) = WHERE establishment_id IN org_scope AND deleted_at IS NULL -> identico al YAML. OK
- est_animal_category_history/ev_birth_calves/est_rodeo_data_config (sin deleted_at propio): simulacion sin filtro deleted_at -> identico al YAML. OK
- est_establishments: id IN org_scope AND deleted_at IS NULL -> identico. OK
- est_members_roles (owner-only): active=true AND establishment_id IN owner_scope -> identico. est_invitations: establishment_id IN owner_scope AND status=pending AND deleted_at IS NULL -> identico. OK
- self_user_private/self_user_roles: WHERE user_id = actor -> identico. OK
Guard anti-drift futuro: PARCIAL. La suite PARSEA el YAML solo para las propiedades NEGATIVAS de "NO esta en el sync set" (animals y users via doesNotMatch). Para el predicado POSITIVO per-establishment, la suite DUPLICA el predicado a mano en JS (no lo parsea del YAML); hay nota de mantenimiento en el header ("mismo SQL que rafaq.yaml", L241) pero NO un assert runtime que ate la simulacion al YAML -> si alguien editara el establishment_id IN org_scope del YAML, la suite quedaria verde-falsa. Aceptable: (a) espeja el patron de los runners RLS; (b) design seccion 7 eligio explicitamente "simular el predicado contra Postgres"; (c) la frontera REAL la audita Gate 1 sobre el YAML (PASS previo). Registrado como finding no-bloqueante (F1/F2).

## FOCO 2 — Los tests negativos MUERDEN: PASS (mutation-test ejecutado por el reviewer)
Mutacion aplicada por el reviewer: quitar el filtro de scope en syncSetIds y rowsInSyncSet (simula una stream SIN el scope). Resultado: 12 subtests cross-tenant FALLAN (est_animal_profiles, las 5 ev_*, est_animal_events, ev_birth_calves, est_rodeo_data_config, est_animal_category_history, est_rodeos/est_management_groups). Los asserts no son tautologicos ni sobre conjuntos vacios: el setup siembra al menos una fila por tenant en cada tabla, asi que el assert de disjuncion tiene data real que atrapar. (El implementer reporto 11; observo 12 al incluir los paths de PK sintetica — diferencia menor, claim esencialmente fiel.) Las clases self-only/owner-only quedaron verdes bajo ESTA mutacion porque muerden sobre OTRA superficie (scope por user_id/owner), correcto. Archivo restaurado byte-identico tras el test.

## FOCO 3 — Oraculo E2E server-side: PASS
animals-offline.spec.ts test 3 verifica la fila REAL en weight_events via waitForServerWeightEvent(establishmentId, weightKg) (poll con service_role sobre la tabla del server), NO la UI/overlay. Ademas assert de que el peso SIGUE en la ficha post-drenado y CERO upload rechazado en consola. Es la leccion del bug de alta offline. Selectores del wizard mapean a pantallas reales (agregar-evento.tsx, animal/[id].tsx) — no phantom; implementer reporto 3/3 verde.

## FOCO 4 — Suite enganchada/verde, autocontenida, tolerante a data ajena, cleanup: PASS
- Enganchada en run-tests.mjs L76 dentro del gate de keys -> corre en check.mjs. OK
- Autocontenida: RUN_TAG namespacea 2 campos + 3 users + (HIGH-1) un 4to campo/owner dedicados. OK
- Tolerante a la data contaminada (344K animals): TODOS los asserts cross-tenant son relacionales entre nuestros tenants (A-vs-B, disjuncion), nunca conteos absolutos. El unico count mayor a cero es sobre catalogos globales (correcto). OK
- Cleanup robusto: estD/ownerD/soft-deleted-rodeo trackeados; cleanup() pre-borra reproductive_events para destrabar el CASCADE (birth_calves sin ON DELETE CASCADE), luego CASCADE de establishments + deleteUser. Empiricamente verde en 2 corridas (normal + mutada). No deja basura FK-bloqueante. OK

## FOCO 5 — Reconciliacion specs (T7.8 parcial / T7.9 diferido): COHERENTE
- T7.8 [~]: rationale = cobertura a NIVEL CLASIFICACION en upload.test.ts (classifyIntentUploadError: permanent_reject->rollback / transient->no-toca-overlay / P0002->idempotent_discard / intent corrupto->PermanentIntentError). Verificado: upload.test.ts existe en el runner (L53) con 58 referencias a esos outcomes. El E2E in-vivo del rollback se defiere honestamente a T7.9. El parcial no sobre-afirma.
- T7.9 [ ]: diferido con rationale explicito (E2E de PARTO offline + rollback in-vivo = run aparte; el alta offline E2E ya esta en tests 1+2; logica unit-cubierta). Coincide con el alcance nombrado del run. Justificado y documentado -> no bloquea.
- T7.1/T7.4/T7.5/T7.6 -> [x] con ubicacion real verificada. T7.2/T9.7 -> [x] (suite real, mutation-probada).
- design seccion 7: nota AS-BUILT agregada (1 linea, L1048) describe fielmente la suite. Exacta.
- Direccion codigo->spec (paso 6): este run NO cambio comportamiento/estructura/contrato (solo agrego tests) -> no introdujo ni empeoro drift. La tension pre-existente R4.1-EARS (JOIN V2) vs YAML-V3 ya esta cubierta por las notas RECONCILIADO de requirements.md L87-103 (apuntan a rafaq.yaml/design seccion 2.2 como fuente de verdad) y fue auditada en el Gate 1 V3 PASS previo — NO es deuda de este run.

## Trazabilidad R<n> vs test (este run)
- R4.1, R4.2 -> est_animal_profiles / est_rodeos+est_management_groups / est_establishments + R8.2/HIGH-1 (soft-delete del campo -> org_scope vacio)
- R4.3 -> self_user_private
- R4.4 -> catalogos globales (R4.4)
- R4.5 -> soft-deleted (R4.5)
- R4.6, R13.5, R13.6 -> 5 ev_* (weight/sanitary/condition_score/lab/reproductive) + est_animal_category_history
- R4.7, R13.7 -> animals (T9.7) + b1 (T9.7)
- R4.8 -> ev_birth_calves
- R4.9 -> est_invitations
- R4.10 -> est_rodeo_data_config
- R4.11 -> SIN test directo (finding F2; satisfecho as-built — push_tokens/import_log ausentes del YAML)
- R8.2 -> R8.2/HIGH-1
- R9.1, R9.2 -> suite completa (no-bypass por device)
- R13.8 (c2) -> c2 (T9.7)
- R5.1, R5.2 -> E2E test 3 (lectura local ficha+timeline offline)
- R6.1 -> E2E test 3 (peso offline INSERT local)
- R6.2 -> E2E test 3 (waitForServerWeightEvent, trigger 0077 al subir)
- R11.2 -> E2E test 3 + check.mjs verde (firmas/flujos intactos)
- R3.3/R3.4/R3.5/R8.1 (T7.1) -> upload-classify.test.ts + upload.test.ts
- R6.10 (T7.7 parcial) -> animal/run.cjs T2.20 + create_animal RPC suite

## Tasks completas: SI (con diferimientos justificados)
T7.1 a T7.6 [x]; T7.2/T9.7 [x]; T7.7/T7.8 [~] (parcial honesto, cobertura unit/clasificacion real); T7.9 [ ] diferido con rationale dentro del alcance nombrado del run. No hay [ ] sin justificacion documentada.

## CHECKPOINTS
- C1 — harness completo: [x]
- C2 — estado coherente: [x] (15-powersync in_progress; no se marco done)
- C3 — arquitectura: [x] (tests Node-nativos + Playwright, sin deps nuevas, sin hardcode de establishment_id — el scope sale de user_roles por actor)
- C4 — verificacion real: [x] (fixtures reales contra la DB remota; suite con mas de 0 tests verdes; test de aislamiento cross-tenant ES el nucleo de la suite)
- C5 — sesion: [ ] N/A en este run (no se cierra sesion ni se commitea; lo maneja el leader)
- C6 — SDD: [x] (3 archivos de spec; cada R<n> del run con al menos 1 test salvo R4.11 — ver F2)
- C7 — multi-tenant: [x] (la suite valida la frontera de tenancy del sync set; helpers org_scope/owner_scope espejan has_role_in/is_owner_of)
- C8 — offline-first: [x] (E2E test 3: lectura+escritura offline + reconexion)

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS): aplicable — esta suite ES el test de aislamiento cross-tenant del wire de sync. [x] streams scopean por establishment_id IN org_scope; [x] helpers org_scope/owner_scope espejan has_role_in/is_owner_of (no SQL ad-hoc divergente); [x] test cross-tenant A vs B; [x] deleted_at IS NULL filtrado en las streams con soft-delete (subtest R4.5). No se crearon tablas nuevas (run de tests).
- B (offline-first): aplicable — [x] E2E offline (setOffline true) + sync bucket scopeado por establishment_id; [x] last-write-wins documentado (R12.2); [x] lectura/escritura via repositorio/local, oraculo confirma el drenado.
- C (BLE): N/A (el run no toca BLE).
- D (UI de campo): N/A (sin cambios de UI; el E2E maneja pantallas existentes ya gateadas).
- E (Edge Functions): N/A (cero cambios en supabase/functions/, verificado por git status).

## Findings (no bloqueantes)
- F1 (drift guard parcial, FOCO 1): la suite duplica a mano el predicado per-establishment en JS en vez de parsearlo del YAML; solo las propiedades negativas (animals/users ausentes) tienen drift-guard runtime. Recomendacion (backlog): agregar doesNotMatch(yaml, FROM push_tokens) + FROM import_log y, opcionalmente, un assert que verifique que cada stream per-establishment del YAML contiene literalmente establishment_id IN org_scope/owner_scope. No bloquea: Gate 1 sobre el YAML es la frontera autoritativa y dio PASS.
- F2 (R4.11 sin test directo): push_tokens/import_log NO estan en el YAML (requirement satisfecho as-built) pero la suite no los drift-guardea como si hace con animals/users. Mismo remedio que F1.

## Cambios requeridos
Ninguno. APPROVED.

---

## Review — Run T7.9 (PARCIAL — en progreso, red flaky)

> Reviewer RELANZADO tras la muerte del anterior por corte de red. Alcance: 5 E2E nuevos + helpers admin aditivos + reconciliacion T7.9/T7.8.
> ESTE BLOQUE SE IRA COMPLETANDO. Guardado parcial por si la red se vuelve a cortar.

### Avance verificado hasta ahora
- Diff revisado: `app/e2e/animals-offline.spec.ts` (5 tests nuevos + helpers de navegacion), `app/e2e/helpers/admin.ts` (6 helpers ADITIVOS, cero delecion), `specs/.../design.md` + `tasks.md` reconciliados, `progress/*` (leader/bitacora), `scripts/run-tests.mjs` + `docs/backlog.md` (cierre-T7 ya gateado), `supabase/tests/sync_streams/` untracked (cierre-T7).
- RESTRICCION DURA OK: cero cambio en `app/src/`, `supabase/migrations/`, `supabase/functions/`, `sync-streams/`. `feature_list.json` y `plan.md` SIN tocar. (git status verificado.)
- MORDIDA del parto: el oraculo `waitForServerBirth` asserta `birthEventCount === 1` EXACTO + `calfCount === N` EXACTO → un doble-apply daria 2 → muerde. `birth_calves` es server-only (sin GRANT INSERT) → un ternero server existe SOLO si la RPC corrio.
- MORDIDA del rollback: `softDeleteProfile(madre)` server-side mientras offline → `register_birth` (0075:98-100 `WHERE deleted_at IS NULL` → raise `23503`) → connector.ts clasifica `permanent_reject` (upload.ts:205, unit-test upload.test.ts:214) → `rollbackOverlay`. El test asserta (a) overlay borrado (count 0 tras refresh), (b) `getServerBirthState` = 0/0, (c) warn `upload rechazado` presente (connector.ts:168). DETERMINISTA: el soft-delete admin aterriza server-side ANTES de reconectar → sin carrera con el drain.
- CONTRAPRUEBA transitorio: asserta overlay PERSISTE (count 1) + `rejected === []` + server 0/0 EN COLA → luego reconecta y `waitForServerBirth` confirma que dreno (no se descarto). Distingue "en cola" de "no paso nada".

### PENDIENTE (red flaky bloqueo temporal)
- `node scripts/check.mjs`: 1ra corrida ROJA por `ConnectTimeoutError`/`UND_ERR_CONNECT_TIMEOUT` a Supabase (Cloudflare 172.64.149.246:443) DENTRO de `animal/run.cjs` — NO un fallo de codigo, es la red. Probes: REST 401 (reachable) x2, auth health TIMEOUT. Red intermitente. REINTENTANDO.
- Worktree HEAD para verificar los 8 fallos pre-existentes: PENDIENTE.

### check.mjs — RESUELTO: VERDE (exit 0)
- Las 2 corridas rojas iniciales fueron `ConnectTimeoutError` a Supabase (red flaky tras el corte), fallando en suites DISTINTAS cada vez (animal/run.cjs, luego rls/run.cjs) = signature de red, no de codigo. Probes pasaron de timeout a 401-estable. RLS standalone 22/22. 3ra corrida de `check.mjs` → VERDE: "All tests passed." / "Entorno listo." incl. Sync streams no-bypass 25/25.

### Veredicto sobre los 8 fallos pre-existentes (worktree HEAD = 55d5700)
**CLAIM CONFIRMADO: los 8 fallos son PRE-EXISTENTES en HEAD, NO los introdujo el working tree (T7.9 ni cierre-T7).**
- Worktree limpio `git worktree add ../rafaq-verify HEAD` (55d5700), `pnpm install` + env copiado + `pnpm e2e:build` OK.
- Corrida de `account.spec.ts events.spec.ts profile.spec.ts rodeos.spec.ts` (workers=1) en HEAD, RED ESTABLE:
  **8 failed / 12 passed, ZERO `fetch failed`** — todos fallos de ASERCION (`toBeVisible` timeouts), no de red.
  Los 8: `account.spec.ts:137` (cambiar email), `events.spec.ts:190/279/509/639` (tacto→transicion categoria / parto mellizos / aborto / orden timeline), `profile.spec.ts:38/65/102` (nombre/telefono/descarte).
- 2 fallos son EXACTAMENTE el badge `vaquillona preñada` (events:190 L238, + el de parto) = el gap de backlog
  "transiciones de categoria NO visibles / recalculo server-side" (2026-06-08/09, YA DECIDIDO opcion A, chunk C6 spec 02). Confirma la hipotesis del implementer.
- 1ra corrida (red flaky) dio 13 fallos inflados por `fetch failed` transitorios (rodeos:99 cayo por `createTestUser fetch failed`); la corrida ESTABLE los redujo a los 8 reales de asercion → los extras eran ruido de red, no codigo.
- POR QUE NO ES EL WORKING TREE: el diff de `admin.ts` es 100% ADITIVO (cero delecion/modificacion de lineas existentes, `git diff | grep ^-` vacio); NINGUNO de los 4 specs que fallan importa los 6 helpers nuevos; `cleanupAll` intacto. El unico vector seria data residual en la beta compartida — y los fallos reproducen identicos en HEAD, donde el working tree no existe. → NO es regresion del run. Distribucion levemente distinta a la del implementer (events×4 vs ×3, rodeos×0 vs ×1) por flakiness ambiental, pero el set y la causa coinciden.
- ACCION: quedan para backlog/leader (ya hay entrada + decision C6). NO bloquean T7.9.

### VEREDICTO Run T7.9: APPROVED

**Alcance**: 5 E2E nuevos en `animals-offline.spec.ts` + 6 helpers aditivos en `helpers/admin.ts` + reconciliacion T7.9[x]/T7.8[x] en design/tasks + bitacora. Solo tests + helpers + docs.

**Restriccion dura — OK**: cero cambio en `app/src/`, `supabase/migrations/`, `supabase/functions/`, `sync-streams/` (git status verificado). `feature_list.json` y `plan.md` SIN tocar. Lo demas del working tree (`scripts/run-tests.mjs`, `docs/backlog.md`, `supabase/tests/sync_streams/`, `progress/current.md`) es trabajo cierre-T7/leader YA GATEADO — este run NO lo modifico (verificado: el diff de esos archivos es del cierre-T7, no de T7.9).

**Trazabilidad R<n> ↔ test (Run T7.9)** — TODOS cubiertos:
| R<n> | Test |
|---|---|
| R6.6 parto offline | animals-offline.spec.ts "PARTO mono/mellizos (T7.9)" |
| R6.8 overlay optimista | idem (asserts overlay offline: "Parto" en cronologia + ternero en lista) |
| R6.12 no doble-upload | idem — `waitForServerBirth` asserta `birthEventCount===1` EXACTO |
| R6.10 idempotencia/baja | idem + "BAJA (Venta) (T7.9)" → `waitForServerExit('sold')` |
| R6.9 reject permanente | "rollback (T7.8)" — 23503→permanent_reject, warn observable + "transitorio (contraprueba)" |
| R6.11 rollback overlay | "rollback (T7.8)" — ternero desaparece (count 0 tras refresh) |
| R8.1 server re-valida | "rollback (T7.8)" — `getServerBirthState`=0/0 (RPC abortó atómica) |
| R10.2 rechazo observable / transitorio reintenta | "rollback (T7.8)" (warn) + "transitorio" (no warn, en cola, drena al reconectar) |

**Foco 1 — Mordida**: VERIFICADO.
- Parto: `waitForServerBirth` asserta `birthEventCount===1` Y `calfCount===N` EXACTOS (no `>=1`) → un doble-apply daria 2 eventos → FALLA. `birth_calves` server-only (sin GRANT INSERT) → ternero server existe SOLO si la RPC corrio (no confunde overlay con real).
- Rollback: asserta (a) overlay borrado UI count 0, (b) server 0/0, (c) warn `upload rechazado` presente. El implementer reporta (y es plausible) que sin el `refreshAnimalesList` el assert fallaba con count=1 → la asercion muerde.
- Contraprueba transitorio: asserta overlay PERSISTE (count 1) + `rejected===[]` + server 0/0 EN COLA, LUEGO reconecta y `waitForServerBirth` confirma drenado. Distingue "en cola" de "no paso nada".

**Foco 2 — Oraculos server-side**: OK. Todos los helpers nuevos miran el SERVER via service_role (`reproductive_events`/`birth_calves`/`animal_profiles`/`weight_events`), nunca el overlay/UI — leccion del bug de perdida invisible.

**Foco 3 — Determinismo del rollback**: OK. `softDeleteProfile(madre)` se aplica server-side via admin MIENTRAS el cliente esta offline → cuando reconecta y drena, la madre YA esta soft-deleteada → `register_birth` (0075:98-100, `WHERE deleted_at IS NULL` → `raise 23503`) rechaza ANTES de cualquier INSERT (atomico, 0 filas). Sin carrera con el drain: el soft-delete admin aterriza antes de la reconexion. 23503→permanent_reject confirmado en connector.ts:153 + unit upload.test.ts:214.

**Foco 4 — Cleanup + namespacing**: OK. Data sembrada por `createTestUser`/`seedEstablishmentWithRodeo`/`seedAnimal` namespaced por RUN_TAG; `cleanupAll` (intacto) borra por ids trackeados. Oraculos scopeados por `motherProfileId`/`establishmentId` UNICO por test → inmunes a la contaminacion de la beta. (LOW: huerfanos ante kill duro → ya en backlog, no bloquea.)

**Foco 5 — Cero cambio app/src/migraciones/EF/streams**: OK (ver Restriccion dura).

**Foco 6 — Reconciliacion**: COHERENTE. T7.9→[x] y T7.8→[x] con ubicacion de cada test/helper; design §7 nota AS-BUILT del write-path E2E (principio "oraculo mira el server" + desviacion de MECANISMO de test `refreshAnimalesList` por la lectura one-shot + "el assert del rollback muerde"); requirements.md sin cambio de "que" (materializa R6.6/R6.8-R6.12 como E2E, no requirement nuevo). Sin specs contradictorias con el as-built. **T6.5/T7.5 "1 CrudEntry in-vivo"**: el test de parto (op_intents → register_birth atomico → 1 evento) cubre el espiritu de "un solo intent → un solo apply"; el conteo literal de CrudEntries de op_intents queda en el unit T7.7 (idempotencia server-side) + la clasificacion T7.8 — coherente, no abierto.

**check.mjs**: VERDE (exit 0) — "All tests passed." Las 2 corridas rojas iniciales fueron `ConnectTimeoutError` a Supabase (red flaky post-corte), en suites distintas cada vez = red, no codigo. Confirmado: RLS standalone 22/22, sync-streams 25/25, animal suite verde tras estabilizar la red.

**E2E del run**: `animals-offline.spec.ts` 8/8 PASS reproducido por MI (build fresco del working tree, red estable, ZERO `fetch failed`). Respalda la evidencia del reviewer caido (t79-e2e-results.txt, 2x 8/8).

**Veredicto sobre los 8 fallos pre-existentes**: CONFIRMADOS PRE-EXISTENTES (ver subseccion dedicada arriba). HEAD 55d5700 en worktree limpio → 8 failed / 12 passed, todos de ASERCION (badge `vaquillona preñada` = gap de categoria server-side ya en backlog + decidido C6 spec 02), ZERO red. El working tree NO los introdujo: diff de admin.ts 100% aditivo, ningun spec fallido importa los helpers nuevos. Quedan al leader/backlog, NO bloquean T7.9.

**CHECKPOINTS aplicables**:
- C1 check.mjs exit 0 → [x]. C3 (sin hardcode establishment_id en los tests, sin TODOs sueltos) → [x]. C4 (tests con fixtures reales server-side, runner >0 verdes, cross-tenant cubierto por la suite sync_streams del cierre-T7) → [x]. C6 (R<n> con ≥1 test, tasks T7.x [x]) → [x]. C7/C8 (multi-tenant + offline) cubiertos por el cuerpo de la feature; este run los EJERCITA E2E (offline parto/baja/rollback + oraculo server-side) → [x].
- C2/C5 (cierre de sesion, history.md, estado de la feature en feature_list) → responsabilidad del LEADER al cerrar; este run no marca done ni commitea. N/A para el reviewer del run.

**Checklist RAFAQ-especifico**:
- A (RLS/multi-tenancy): N/A directo (cero tabla/policy nueva en este run); el aislamiento cross-tenant del schema lo cubre la suite sync_streams (cierre-T7).
- B (offline-first): [x] funciona offline (5 tests con `setOffline(true)`), [x] bucket scopeado (heredado), [x] conflict resolution documentada (idempotencia por client_op_id + rollback/transient en design §5.4/§7), [x] no requests sincronos a Supabase desde pantalla (overlay/SQLite local + outbox).
- C (BLE): N/A (no toca BLE).
- D (UI campo): N/A en este run (tests, no UI nueva).
- E (Edge Functions): N/A (no toca EFs).

**Cambios requeridos**: NINGUNO.

`APPROVED`
