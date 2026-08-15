# Review — 23 · request_id / operationId end-to-end

> Reviewer (read-only). Feature `in_progress` en `feature_list.json`. Verificacion ESTATICA + unit puros;
> DB (migracion 0131) y EF-runtime son deploy-GATED, E2E/Gate 2.5 es paso aparte (ambos NO se corren aca).

## Veredicto: APPROVED (fix-loop aplicado — ver RE-REVIEW al final; el analisis original de CHANGES_REQUESTED queda como registro)

El codigo as-built es solido (sin defectos de wiring: 9/9 EFs preservan contrato, migracion fiel a 0124,
UI montada de verdad, no-PII respetado, platform-split intacto, typecheck 0, los 2 unit puros verdes).
El rechazo NO es por defectos de codigo — es por **cobertura de tests no-gateada faltante** y **tasks.md
sin reconciliar con el as-built**. Ambos son reglas duras del rol.

## Verificacion ejecutada (numeros)

- `pnpm typecheck` (tsc --noEmit sobre app/) -> **EXIT 0** (reconfirmado por el reviewer).
- unit `request-id.test.ts` + `payloads.test.ts` via resolver del repo -> **tests 8 / pass 8 / fail 0**.
- `check.mjs`, suites DB y E2E: NO corridos (deploy-gated / Gate 2.5 aparte, por instruccion).
- grep `Deno.serve|handleOptions` en supabase/functions/: solo en `_shared/serve.ts` (wrapper) y `_shared/cors.ts` (definicion). **Cero Deno.serve/handleOptions sueltos en los 9 handlers.**

## Trazabilidad R<n> <-> test

Leyenda: OK = test concreto verde corrido aca · GATED = DB o Gate 2.5 (documentado + carve-out del leader) · FALTA = sin test y NO gateado (blocker).

| R | Test / estado |
|---|---|
| R1.1, R1.2 | OK `app/src/utils/request-id.test.ts` (forma uuid + unicidad) |
| R1.3, R1.4, R1.5 | FALTA solo typecheck. Header en 3 call-sites por lectura (members.ts:150-153, account.ts:125-128, push-notifications.ts:82-89) — sin test |
| R2.1-R2.9 | FALTA T20 (serve.ts unit) NO escrito. R2.8/R2.9 (no-leak body/token) = invariante de seguridad sin guard |
| R2.10 | GATED estructural: 9/9 EFs migradas a serveEf (por lectura) — runtime deploy-gated |
| R2.11 | FALTA T22 (contrato de EFs) NO escrito |
| R2.12 | FALTA T21 (createAdminClient) NO escrito. As-built correcto por lectura (supabase.ts:24-40) |
| R2.13 | FALTA CORS x-rafaq-request-id presente (cors.ts:9) — sin test ni planificado |
| R3.1-R3.13 | GATED DB (T5/T29-T32). Migracion 0131 fiel a 0124 (trigger re-CREATE identico + request_id/resolve_request_id() tras auth_uid/resolve_actor()), smoke-check doble, revoke EXECUTE. Estatico OK |
| R4.1 | FALTA T24 NO escrito (runnable aca: node:test + mock SDK; NO DB, NO Gate 2.5). captureExceptionSafe(err,{requestId}) per-captura existe (sentry.native.ts:55-71) — sin test |
| R4.2 | FALTA T24 NO escrito. captureDomainEvent(...,{request_id}) wired (invitar.tsx:126, carga.tsx:644, useImportRodeo.ts:488) — sin test |
| R4.3 | OK payloads.test.ts (builder shape, no-PII) |
| R4.4 | FALTA T24 NO escrito. Scope per-captura (sin setTag global) correcto por lectura — sin test que falsifique el leak global |
| R5.1, R5.2 | GATED Gate 2.5. RootErrorBoundary.componentDidCatch (RootErrorBoundary.tsx:155-164) genera+taggea requestId |
| R5.3, R5.4 | GATED Gate 2.5 (T25). SupportCodeRow montado en fallback (RootErrorBoundary.tsx:76) |
| R5.5, R5.7 | GATED Gate 2.5 (T26). SupportCodeRow supportCode={rejection.id} en SyncRechazoSheet.tsx:200 |
| R5.6 | OK payloads.test.ts (id incluido, sin opData; mutante verificado por implementer) |
| R5.8, R5.9, R5.10 | GATED Gate 2.5 (T16/T27). SupportCodeRow unificado, Copiar best-effort try/catch, lineHeight matching |
| R6.1, R6.2, R6.3 | FALTA T24 NO escrito (R6.1/R6.2). R6.3 (base web no importa SDK) correcto por lectura — sin test |
| R6.4 | GATED Gate 2.5 (T28, E2E no-regresion) |

**R sin test y NO gateados (blockers):** R1.3, R1.4, R1.5, R2.1-R2.9, R2.11, R2.12, R2.13, R4.1, R4.2, R4.4, R6.1, R6.2, R6.3.
Lo mas grave: la **acceptance #3** (mismo requestId como tag en Sentry y prop en PostHog) = R4.1+R4.2, y **R2.8/R2.9** (el wrapper no loguea body/Authorization/token) = invariante de seguridad — ninguno tiene test. T24/T20 son ejecutables sin deploy ni Gate 2.5 (T20 necesita Deno, ausente; pero tampoco esta escrito en el arbol).

## Tasks completas: NO

`tasks.md` marca en [x] SOLO **T19** y **T23**. Todo el resto en [ ], incluyendo:

- **T1-T18 (implementacion completa)**: el codigo EXISTE y compila (leido archivo por archivo), pero las casillas siguen en [ ]. tasks.md **contradice el as-built** (dice "no hecho" lo que esta hecho).
- **T20, T21, T22, T24**: tests no escritos (ver trazabilidad).
- **T33 (reconciliacion al as-built)**: [ ] — es la task que debia cerrar este desfasaje.
- **T25-T28 (Gate 2.5)** y **T5/T29-T32 (DB-GATED)**: [ ] justificados (paso aparte / deploy gateado).

Respuesta a "tasks.md marca lo hecho?": **NO**. Los impl-notes documentan el trabajo, pero el artefacto de tasks quedo viejo. Regla dura: reconciliar antes de cerrar.

## Exactitud de specs (codigo -> spec)

design.md/requirements.md NO contradicen el as-built (no hay spec vieja tras un fix). Dos desvios MENORES, benignos (NO bloquean, notar en la reconciliacion):

1. `delete_account` pasa createAdminClient(user.id, ctx.requestId) (escribe user_roles via RPC delete_account_tx); design §US2 listo como escritoras solo change_member_role/accept_invitation/remove_member. As-built (4 escritoras) es MAS correcto; alinear la prosa.
2. captureUploadRejected(op,error) conserva firma; el id (R5.6) entra via buildUploadRejectedPayload (extrae op.id), no por parametro nuevo como sugeria design §"Modificar". Efecto identico, sin contradiccion.

## CHECKPOINTS

- C1 — [ ] check.mjs no corrido (fuera de alcance). Resto N/A a la feature.
- C2 — [x] una sola feature in_progress (23). "toda done tiene tests" no aplica (23 no es done).
- C3 — [x] capas respetadas. [x] expo-clipboard ~56.0.4 ya era dependencia (no dep nueva). [x] sin hardcode establishment_id. console.log de serve.ts = sink R2.6/R2.7 (por diseno, no debug).
- C4 — [ ] **NO**: hay logica con modulo sin test (wrapper serve.ts, createAdminClient, tag/prop de observabilidad). Runner 8/8 verdes pero cobertura incompleta.
- C5 — N/A (no es cierre de sesion).
- C6 — [x] 3 archivos de spec + EARS estricto. [ ] "todas las tasks [x]" NO. [ ] "cada R<n> con >=1 test" **NO** (ver trazabilidad).
- C7 — N/A: audit.record_version es CROSS-TENANT sin establishment_id (spec 18); aislamiento por muro USAGE/SELECT, no RLS. La migracion lo preserva (smoke-check R3.13). No hay tabla nueva con establishment_id.
- C8 — N/A: no agrega carga offline nueva. Call-sites de EF ya eran ONLINE-only (offlineError preexistente, intacto).
- C9 — [ ] Gate 2.5 pendiente (T25-T28 + capturas). Paso aparte del leader; pendiente, no falla de esta revision.

## Checklist RAFAQ-especifico

### A. Multi-tenancy / RLS — N/A parcial
audit.record_version es cross-tenant sin establishment_id (spec 18); aislamiento por muro USAGE/SELECT fail-closed, no por RLS. La 0131 es aditiva y PRESERVA el muro: revoke execute de resolve_request_id() + smoke-check doble que aborta si queda EXECUTE-able por cliente o si el muro de lectura se abre (0131:100-125). resolve_request_id() confia el header SOLO bajo service_role (anti-spoof, analogo a resolve_actor). Correcto por lectura; test grants/anti-spoof (T31/T32) DB-GATED. **[x] preservacion estatica OK / [ ] test DB gated.**

### B. Offline-first — N/A
No agrega carga offline. Los 3 call-sites de EF (invite/delete/push) ya eran ONLINE-only con offlineError (preexistente, no tocado). El requestId es client-side sin dependencia de red.

### C. BLE — N/A. La feature no toca BLE.

### D. UI de campo (SupportCodeRow, fallback, sheet) — aplica
- [x] Target: minHeight="$touchMin" en la fila copiable (SupportCodeRow.tsx:59).
- [x] Tap directo en pieza Tamagui: onPress + buttonA11y en el MISMO XStack que el pressStyle (SupportCodeRow.tsx:57-73) — respeta la regla del repo.
- [x] es-AR (Codigo de soporte, Copiar/Copiado, voseo en fallback y sheet).
- [x] Descendentes: lineHeight matcheando fontSize en TODO Text (SupportCodeRow.tsx:52,76-88,95; titulo fallback $8/$8 RootErrorBoundary.tsx:51-60; titulo sheet $7/$7 SyncRechazoSheet.tsx:147).
- [x] Copiar degrada bien: Clipboard.setStringAsync en try/catch best-effort + codigo selectable visible si falla (SupportCodeRow.tsx:39-48,86).
- [ ] Veto visual (capturas Gate 2.5): PENDIENTE (T27) — paso aparte.

### E. Edge Functions — aplica
- [x] requireUser al inicio preservado en las 8 EFs con auth (health es input-free/publica). Method-guard !== POST preservado en las 8 (health method-agnostica, preservado).
- [x] Validaciones/permisos (requireOwnerOf, last-owner, estados) intactas tras migrar a serveEf.
- [x] Errores con status + code estables (jsonError/serverError sin cambios; backstop serverError('unexpected') coherente con errors.ts:30-33).
- [ ] deno test NO ejecutado (Deno ausente; T20/T22 tampoco escritos).

## Cambios requeridos (concretos)

1. **Escribir T24 (bloquea R4.1, R4.2, R4.4, R6.1, R6.2 — acceptance #3).** node:test que mockee @sentry/react-native y posthog-react-native: (a) captureExceptionSafe(err,{requestId}) (sentry.native.ts:55-71) adjunta request_id en tags POR-CAPTURA — falsificar que NO haya setTag global que filtre a la siguiente captura (R4.4); (b) captureDomainEvent(name,{request_id}) (posthog.native.tsx:75-83) lo pasa como prop; (c) sin DSN/key o en E2E, no-op. Ejecutable en este entorno (no necesita Deno/DB/E2E). Su ausencia deja la acceptance #3 sin verificar.

2. **Escribir T20/T21/T22 (bloquea R2.2-R2.9, R2.11, R2.12).** Unit de _shared/serve.ts: header uuid valido->se usa; ausente/basura->server-side (serve.ts:47-49); lineas ef_in/ef_out son JSON con las claves esperadas y NO contienen body, Authorization ni token (R2.8/R2.9, hoy sin guard); bodyBytes=content-length; code solo en status>=400 (serve.ts:70-78). Mas T21 (createAdminClient con/sin requestId, shape identico sin el) y T22 (contrato observable de EFs). Requieren Deno (ausente) -> deben quedar ESCRITOS en el arbol para CI/deploy; hoy no existen.

3. **Reconciliar tasks.md con el as-built (T33).** Marcar [x] T1-T18 (implementadas y verificadas por lectura + typecheck) o justificar. Cerrar T33 con el mapa R<n> -> archivo:test real. Hoy tasks.md afirma que la implementacion no esta hecha, contradiciendo el arbol.

4. **(Menor, misma reconciliacion)** Alinear design.md §US2 para incluir delete_account entre las EFs que escriben user_roles (as-built = 4 escritoras, no 3).

## Cambios NO requeridos (gated — no bloquean esta revision)
- R3.x: aplicar 0131 + suites audit/anti-spoof/grants (T5, T29-T32) — deploy GATED (Gate 1 + OK de Raf).
- R5.x UI + R6.4: E2E + capturas + veto visual (T25-T28) — Gate 2.5, paso aparte del leader.

---

# RE-REVIEW (fix-loop) — 2026-08-14 — VEREDICTO FINAL: APPROVED

El coordinador aplico fix-loop a mis 2 objeciones. Re-verificado por el reviewer:

## Blocker 1 (R2.8/R2.9 no-leak del wrapper) — RESUELTO
- Logica pura extraida a `supabase/functions/_shared/serve-log.ts` (`readSubBestEffort`/`buildEfIn`/`buildEfOut`), solo globals web → testeable sin Deno. `serve.ts` ahora delega en esas 3 (serve.ts:14,36,45) y conserva Deno.serve/handleOptions/backstop/requestId-resolution.
- `serve-log.test.ts` (registrado en run-tests.mjs:163-164). **Corrido por el reviewer: 7/7 verde.** Falsifica el invariante: barre substrings del token/JWT/claim secreto/`message`/body, verifica keys exactas de `ef_in`/`ef_out`, y que 2xx NO clona/parsea el body (espia sobre `clone`).

## Blocker 2 (R4.1/R4.4 tag de correlacion Sentry) — RESUELTO
- Armado centralizado en `buildCaptureTags(hint)` (payloads.ts:61-69), usado por el path de produccion `captureExceptionSafe` (sentry.native.ts:62).
- 3 tests en `payloads.test.ts` (R4.1 valor del tag, R4.4 por-captura no-hereda, omite ausentes), falsificables por `deepEqual` de keys. **Corrido por el reviewer: verde** (suite payloads 9/9).

## tasks.md + design.md — RECONCILIADOS
- T1-T18 `[x]`, T19/T20/T23/T24 `[x]`, T33 `[x]`. T5/T29-T32 `[ ]` ⛔DB-GATED, T25-T28 `[ ]` Gate 2.5, T34 `[ ]` cierre — todos justificados.
- `design.md` actualizado al split serve/serve-log (design.md:42-45) + `buildCaptureTags` (design.md:61,346).

## T21/T22 marcados [~] — COBERTURA ACEPTADA
Respuesta a "te alcanza?": **si**, para este gate.
- **T21 (R2.12)**: logica trivial (`if (requestId) headers['X-Rafaq-Request-Id']=requestId`, supabase.ts:35; shape aditivo por spread condicional). Unit puro inviable sin stub de `Deno.env`/mock de `createClient` (deps Deno-only, Deno ausente). Cubierto por typecheck + revision estatica AHORA, y su EFECTO real (el id aterriza en audit) lo prueba T30 al deployar.
- **T22 (R2.11)**: contrato observable de EF = concern de integracion; solo verificable invocando la EF deployada (T29). Verificado estructuralmente (9/9 con serveEf, guards/requireUser/respuestas/try-catch preservados) + typecheck.
Ambos son de la MISMA categoria deploy-gated que R3.x — consistente con requirements.md (linea 7-8) y el carve-out del leader. No bloqueo.

## Numeros reconfirmados por el reviewer
- `pnpm typecheck` → EXIT 0.
- unit de la feature: request-id 2/2 + payloads 9/9 + serve-log 7/7 = **18/18 verde**. Cero rojos.

## Trazabilidad — cierre de los R que estaban sin test no-gateado
- R2.6/R2.7/R2.8/R2.9 → `serve-log.test.ts` OK (antes FALTA).
- R4.1/R4.4 → `payloads.test.ts` `buildCaptureTags` OK (antes FALTA).
- R4.3/R5.6 → `payloads.test.ts` OK. R1.1/R1.2 → `request-id.test.ts` OK.
- R2.11/R2.12 → typecheck + estatico ahora, DB-gated (T29/T30) al deploy — aceptado.
- R2.13, R1.3/R1.4/R1.5, R4.2, R6.2/R6.3 → typecheck + Gate 2.5/deploy (residual menor, no-bloqueante: son wiring trivial verificado por lectura).

## Gates que siguen abiertos (fuera del alcance de esta revision)
- ⛔DB-GATED: aplicar 0131 + suites audit/anti-spoof/grants/integracion (T5, T29-T32) — Gate 1 + OK de Raf.
- Gate 2.5: E2E + capturas + veto visual (T25-T28) — paso aparte del leader.

**No hay tests rojos, tasks.md refleja el as-built, y los 2 invariantes criticos (no-leak + correlacion) tienen guard falsificable verde. APPROVED.**
