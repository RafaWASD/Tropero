# Review - 16-ambientes-y-release - Run C (Edge Function health)

Reviewer: read-only. Fecha: 2026-07-14. Alcance: SOLO tasks del Run C (C1/C2/C4; C3 gateado).
Baseline impl: progress/impl_16-runC.md (baseline_commit 6b07bca).

## Veredicto

APPROVED - condicionado a la verificacion FUNCIONAL post-deploy de la suite supabase/tests/health/run.cjs
(la corre el leader tras aplicar 0125 a DEV + deploy "supabase functions deploy health --no-verify-jwt" = C3).
El codigo/config/test estaticos estan correctos; "node scripts/check.mjs" quedo VERDE (14 suites, hook health
comentado). No hay nada que reconciliar ni ningun requisito de Run C sin test.

## check.mjs

VERDE. Corrido read-only. Todas las suites fail 0 (typecheck + scripts unit + client unit + RLS + Edge +
Animal + Maneuvers + Puesta-en-servicio + Reports + Custom + Scrotal + user_private + Import + Sync-streams +
Operaciones-rodeo + SIGSA + Treatments + Audit). La suite "Health EF (spec 16 Run C)" NO aparece en el run,
lo que confirma que el hook esta comentado (correcto: la suite falla sin el deploy de C3). Cierre:
"All tests passed" + "[OK] Tests verdes".

## Trazabilidad requisito <-> test (Run C)

- R7.1 -> functions/health/index.ts (ok:true cuando la RPC responde) + tests/health/run.cjs C4(a)
  (assert body.ok===true). Test concreto.
- R7.2 -> index.ts (schema_version = data?.schema_version ?? "unknown", prefijo 4 dig via health_status())
  + health/run.cjs C4(a) (assert.match contra el regex de 4 digitos o unknown). Test concreto.
- R7.3 -> index.ts (AMBOS caminos de fallo -> serverError: if(error) linea 36 + catch linea 47) +
  tests/edge/run.cjs R4.1 (linea 1052): verifica que serverError (helper IDENTICO) devuelve el copy generico
  fijo "Error interno, proba de nuevo." y NO filtra fragmentos del driver (blob anti-leak). Test concreto sobre
  el helper compartido (ver Nota 1).
- R7.4 -> config.toml [functions.health] verify_jwt=false + health/run.cjs C4(b) (POST sin Authorization ->
  200 + ok:true). Config + test.
- R7.5 -> index.ts (respuesta literal {ok,schema_version,env}) + health/run.cjs C4(c) (keys subconjunto de
  {ok,schema_version,env} + blob anti-leak de 10 substrings). Test concreto.
- R7.7 -> 0125_health_status.sql (Run B: REVOKE FROM PUBLIC + anon/authenticated + GRANT a service_role) +
  health/run.cjs C4(d) (anon NO puede POST /rest/v1/rpc/health_status; espera 401/403/404, nunca 200).
  Test concreto.
- R7.9 -> index.ts invariante input-free: NO req.json() ni query params; solo handleOptions(req) (lee
  req.method), comentado como invariante (lineas 6-10, 30). Demostrado ademas por C4(b) (POST sin body -> 200
  ok). Code-review + test demostrativo (negativo/invariante).
- R7.6 (DEV) -> C3 gateado: deploy de la EF a DEV (leader + OK Raf). Verificacion operativa post-deploy.
  Fuera del codigo estatico (task pendiente justificada).

Todos los requisitos de Run C tienen al menos 1 test concreto. (R7.8 rate-limit-posture es Run E, fuera de
alcance.)

Nota 1 (R7.3): no hay test de 5xx especifico del endpoint health (forzar un 5xx en un RPC read-only es
impractico sin romper estado de DB, y design.md seccion 6 no lo exige). La cobertura es legitima: (a) revision
estatica confirma que health rutea sus DOS ramas de fallo por el helper serverError exacto, y (b) ese helper
esta testeado concretamente por edge/run.cjs R4.1 (copy generico fijo + assert anti-leak). Cadena de cobertura
aceptada; es el eslabon mas debil de la traza.

## Tasks completas

Si (dentro del alcance Run C):
- C1 [x] - functions/health/index.ts. OK
- C2 [x] - config.toml [functions.health]. OK
- C3 [ ] - GATEADO (deploy a DEV, leader + OK Raf). Justificacion documentada (tasks.md C3 + impl seccion "Que
  queda para el deploy"). Pendiente legitimo (no lo ejecuta el implementer). OK
- C4 [x] - tests/health/run.cjs + hook COMENTADO en run-tests.mjs. OK

Ningun pendiente sin justificacion.

## Exactitud de specs (codigo -> spec, paso 6)

Reconciliacion al as-built VERIFICADA - design.md/requirements.md no quedaron mintiendo:
- design.md seccion 6 lleva bloque de reconciliacion as-built Run C (reuso de _shared/* sin tocar cors.ts,
  fallback defensivo a "unknown", verify_jwt en 2 capas, suite dedicada health/run.cjs con hook comentado, C3
  gateado). El snippet original (data.schema_version sin fallback) queda como pseudocodigo pero la nota de
  arriba documenta explicitamente el as-built real (data?.schema_version ?? "unknown") -> patron
  nota-de-reconciliacion (impl_13), no contradiccion. Seccion Archivos lista supabase/tests/health/run.cjs.
- requirements.md seccion Historial de refinamiento (2026-07-14, Run C): R7.1/R7.2/R7.3/R7.5/R7.9 (EF as-built),
  R7.4 (verify_jwt en 2 capas), R7.6 (deploy gateado), R7.7 (suite dedicada con hook comentado). Aditivo, sin
  reescribir EARS. Consistente con el as-built.
- tasks.md: C1/C2/C4 marcadas [x] con notas as-built; C3 pendiente gateado. Consistente.

## CHECKPOINTS

- C1 [x] check.mjs exit 0 (verde). Harness base preexistente.
- C2 [x] una sola feature in_progress (16); nada nuevo pasa a done.
- C3 [x] respeta architecture.md: la EF vive en supabase/functions/ (capa backend prevista). Sin logs de debug
  sueltos (el console.error de serverError es logging server-side intencional). Sin TODOs. No hardcodea
  establishment_id. Sin deps nuevas.
- C4 [x] suite health/run.cjs (4 tests C4a-C4d) con red real (no mocks de I/O). El runner muestra mas de 0
  tests verdes (check.mjs). RLS cross-tenant: N/A (no toca tablas con establishment_id).
- C5 [x] sin artefactos temporales sin trackear fuera de los esperados de Run C.
- C6 [x] feature sdd:true con los 3 archivos + EARS estricto + tasks Run C [x]/justificadas + cada requisito de
  Run C con al menos 1 test.
- C7 N/A (documentado): Run C no crea tablas con datos de campo. ops.applied_migrations (Run B) es metadata de
  ops, no expuesta por PostgREST, con REVOKE.
- C8 N/A (documentado): health es endpoint server-side de ops, no feature de carga offline.
- C9 N/A (documentado): backend-only, sin UI. Sin suite E2E ni capturas.

## Checklist RAFAQ-especifico

Aplicable: seccion E (Edge Functions). Secciones A/B/C/D = N/A (Run C no crea tablas multi-tenant, no carga
datos en campo, no toca BLE, no toca UI de campo).

### Seccion E - Edge Functions
- [x] Errores retornan codigo HTTP apropiado + mensaje claro: serverError -> 500 + copy generico
  "Error interno, proba de nuevo." sin filtrar driver msg (R7.3).
- [~] Test con deno test verde: el repo NO usa deno test (convencion architecture.md = runners Node-nativos
  contra la DB remota). El equivalente es tests/health/run.cjs (node:test), ESCRITO y estaticamente valido
  (node --check OK), pero su EJECUCION es post-deploy (gateada por C3). Condicionado a la corrida del leader.
- [N/A] Validacion de auth.uid() al inicio: health es PUBLICA por diseno (verify_jwt=false, R7.4) para
  UptimeRobot sin JWT. La postura NO es autenticar, sino: input-free (R7.9), corre con service_role, y solo
  invoca un RPC con EXECUTE revocado a anon/authenticated (R7.7). Justificado.
- [N/A] Validacion de permisos via user_roles: health no toca datos de tenant ni operaciones user-scoped;
  llama a health_status() (metadata de ops). Justificado.

## Observaciones no bloqueantes (para el leader, post-deploy C3)

1. apikey del gateway: C4a/C4b invocan health sin ningun header (ni apikey). Si el gateway exigiera el anon
   apikey incluso con verify_jwt=false, esos tests fallarian y UptimeRobot necesitaria el apikey. Cuestion
   puramente FUNCIONAL post-deploy: verificarla en el smoke curl de C3. No bloquea la aprobacion estatica.
2. Descomentar el hook: tras C3, descomentar el run de la Health EF suite en scripts/run-tests.mjs (linea 151)
   y re-correr check.mjs verde (patron spec 12/14/M6/tratamientos/audit).

## Cambios requeridos

Ninguno. APPROVED (condicionado a la suite health post-deploy, task C3, que ejecuta el leader).
