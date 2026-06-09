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
