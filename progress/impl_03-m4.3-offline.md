baseline_commit: 3e2c5c08b2e0ba50fa81cd1fcf28be9091757d2b

# impl 03 — M4.3 — Offline (PowerSync) + cierre (verificación)

Feature `03-modo-maniobras` (in_progress). Chunk **M4.3** — verificación/cobertura (el sustrato ya existe). Frontend/test puro: **Gate 1 N/A** (sin migraciones).

Satisface: R10.1, R10.2, R10.3, R10.7 (+ R12.1 offline-first implícito).

## Plan (tasks)

- [x] T1 — E2E nuevo `app/e2e/maniobra-offline.spec.ts`: jornada offline end-to-end por el **camino MANUAL** (sin BLE), pesaje + vacunación silent_apply, cierre de jornada → oráculo server-side (sesión closed CON sus eventos + session_id FK + cero `upload rechazado`). Cubre R10.1/R10.2 + R10.7 (orden de cierre).
- [x] T2 — Gating offline (R10.3): aserción dentro del mismo E2E — OFFLINE el wizard ofrece solo las maniobras HABILITADAS del rodeo (`pesaje`/`vacunacion` presentes, `inseminacion` ausente = off-by-default en cría), resuelto desde el cache local de `rodeo_data_config` sin red. Sin unit nuevo (la capa pura ya está cubierta por `maneuver-gating.test.ts`).
- [x] T3 — Orden de cierre (R10.7 / design §5): el oráculo de T1 (sesión `closed` CON sus eventos + cero rechazo) lo prueba end-to-end. NO hay lógica pura de ordenamiento de la cola (el orden lo da el FIFO de inserción en la CRUD queue — ver `sessions.ts:164-169`). Constancia abajo.
- [x] T4 — Oráculos: REUSO los de `admin.ts` (no agregué ninguno nuevo). Verificación abajo.
- [x] T5 — `node scripts/check.mjs` + reconciliación tasks M4.3.

## Oráculos reusados (admin.ts — NO agregué helpers nuevos)

- `waitForServerActiveSessionId(establishmentId)` → el sessionId real (no expuesto en el DOM).
- `waitForServerSessionClosed(sessionId)` → la sesión aterrizó con `status='closed'` (R10.7).
- `waitForServerWeightEventWithSession(establishmentId, kg)` → `weight_events` con `session_id` NO nulo (R10.1 + R5.11).
- `waitForServerSanitaryWithSession(profileId, 'vaccination', {productName})` → `sanitary_events` con `session_id` (segunda tabla de evento).
- El test cruza el `session_id` de AMBOS eventos contra el `sessionId` cerrado → prueba el **FK real** (no solo que el evento existe), y prueba que la sesión cerrada TIENE sus eventos (no quedaron huérfanos → el orden de cierre fue events-before-close).

## R<n> → archivo:test (trazabilidad)

- **R10.1** (carga 100% offline de la jornada: sesión + identificación manual + ≥2 eventos): `app/e2e/maniobra-offline.spec.ts` → test "jornada offline por manual → pesaje + vacunación → cerrar → sync".
- **R10.2** (rechazo observable / cero rechazo en el happy-path): mismo test, assert `rejected.toEqual([])` sobre la consola del page (`upload rechazado`). [El surfacing de un rechazo REAL ya lo cubre `maniobra-rechazo-sync.spec.ts` (M4.2).]
- **R10.3** (gating offline desde el cache local de `rodeo_data_config`): mismo test, OFFLINE el wizard muestra `pool-row-pesaje` + `pool-row-vacunacion` y NO `pool-row-inseminacion` (off-by-default en cría) → la resolución del gating capa 1 corre sin red.
- **R10.7** (cierre explícito + orden offline events-before-close): mismo test → `waitForServerSessionClosed` + ambos eventos con `session_id === sessionId` cerrado + cero `upload rechazado` (si el close subiera antes que los eventos, el tenant-check 0056 los rechazaría por sesión closed → habría rechazo).

## Constancia del orden de cierre (R10.7 / design §5)

NO existe lógica pura de ordenamiento de la upload queue para events-before-close. El orden lo da el **FIFO de inserción de la CRUD queue de PowerSync**: durante la carga cada maniobra hace `runLocalWrite` (INSERT al evento) ANTES de que `closeSession` haga su `runLocalWrite` (UPDATE de la sesión a `closed`), porque el cierre ocurre recién en el ExitJornadaSheet (`identificar.tsx::onTerminarJornada`) tras confirmar el animal. Documentado en `app/src/services/sessions.ts:164-169` ("Orden de cierre offline (design §5): los eventos creados antes del cierre se encolan ANTES de esta mutación (FIFO de la upload queue) → al subir, el tenant-check (0056) ve la sesión aún `active` cuando suben esos eventos, y la mutación `closed` sube después"). El E2E es la prueba end-to-end de este invariante (la suite de DB T2.6 ya prueba server-side que crear-eventos→cerrar NO rechaza los eventos ya creados).

## Autorrevisión adversarial (paso 8)

Pasada hostil sobre el E2E ANTES de reportar — qué busqué, qué encontré, cómo lo cerré:

1. **¿El oráculo prueba el `session_id` FK de verdad (no solo que el evento existe)?** SÍ. `waitForServerWeightEventWithSession` y `waitForServerSanitaryWithSession` ambos filtran `.not('session_id','is',null)` (exigen el FK no nulo) y devuelven el `session_id` REAL. El test asserta `vac.sessionId === w.sessionId` (mismo FK = misma jornada) Y `waitForServerSessionClosed(w.sessionId)` (ese FK resuelve a una sesión que existe y quedó `closed`). Un evento "huérfano" (session_id null o apuntando a otra sesión) NO pasaría.

2. **¿El test es robusto al timing de sync?** SÍ. Los oráculos polean con `tries:40` (≈80s c/u), no sleeps frágiles. El único `waitForTimeout(3000)` es el dwell para que la fila sembrada por service_role se asiente en la stream antes de la carga — idéntico patrón a TODOS los specs de maniobra existentes (carga/sanitaria/identify). El cierre se prueba por el FK + `waitForServerSessionClosed`, no por un sleep.

3. **¿Seed namespaced + cleanup?** SÍ. `createTestUser('m43-offline')` + `seedEstablishmentWithRodeo` bajo `RUN_TAG`; `cleanupAll()` en `afterAll` + global-teardown. Peso (`300+Date.now()%90`) y vacuna (`Aftosa-<RUN_TAG.slice(-6)>`) únicos → oráculos deterministas sin colisión cross-test.

4. **¿Tests que pasan por la razón equivocada?** Cubierto: (a) los `· 1 de 2`/`· 2 de 2` corren OFFLINE → la secuencia se resuelve del cache local (si el gating offline estuviera roto, la secuencia tendría otro largo o pasos extra); (b) la NEGATIVA `pool-row-inseminacion` count 0 prueba que el gating NO se cae a "todas" sin red; (c) el assert `rejected === []` es la trampa del orden de cierre: si el close subiera antes que los eventos, el tenant-check 0056 los rechazaría → el assert fallaría. Es decir, el test FALLA si el orden de cierre se rompe (no pasa por casualidad).

5. **Gaps offline / multi-tenant:** la sesión + ambos eventos llevan el `establishment_id` FORZADO server-side (trigger 0077 sobre los eventos; RLS sobre la sesión) — el test no hardcodea establishment, todo del contexto del user sembrado. El oráculo de pesaje busca por `establishment_id` (tenant-scoped).

### Defectos que ENCONTRÉ y CERRÉ durante la corrida (no llegaron al reviewer)

- **`page.goto('/maniobra/jornada')` con la red CORTADA → `net::ERR_INTERNET_DISCONNECTED`.** Causa: la SPA se sirve desde localhost:8099 y `setOffline(true)` (CDP) bloquea TODO el tráfico, incluido localhost → una carga de página completa muere. Fix: la **configuración** de la jornada (que navega a la página) se hace ONLINE; el corte de red se hace JUSTO ANTES de **"Arrancar jornada"** → el `createSession` (la escritura offline-crítica de R1.11) + identify + carga + cierre corren todos offline. La jornada NACE offline (createSession local), que es lo que pide R10.1.
- **Supuesto de hero erróneo (manual-first promovido).** Asumí `transport==null` → ManualPromptHero + input expandido por default. En el build WEB hay un transporte BLE/web-serial CONECTABLE → `listenConn==='connectable'` → **ConnectHero** ("Conectá el bastón") con la entrada manual COLAPSADA (botón "¿Sin chip? Ingresá la caravana"). Fix: `manualIdentify` expande la banda manual (click "Sin chip, ingresá la caravana a mano" si está visible) antes de tipear — mismo patrón que `maniobra-identify.spec.ts`. El manual está SIEMPRE disponible (manual-first), conectado o no → R3.5 se cumple igual.
- **Contador del cierre frágil al re-load del foco.** El `Procesaste N animal` depende del re-load de `getActiveSession` al re-enfocar identify → assert tolerante (`/Procesaste\s*\d+\s*animal/`, no pineo el número) — el conteo es informativo, NO el oráculo de R10.7 (ese es el FK + sesión closed server-side).

## Reconciliación de specs

- `tasks.md` M4.3 → `[x]` con nota AS-BUILT (qué cubre el E2E, oráculos reusados, cómo se verificó el orden de cierre). NO toqué otros chunks del ledger.
- `requirements.md` (R10.1/R10.2/R10.3/R10.7) → NO se tocan: el E2E los VERIFICA tal cual están escritos (chunk de cobertura, no cambia el comportamiento).
- `design.md` §5 (orden de cierre) → NO se toca: el as-built coincide con el diseño (FIFO de la upload queue, eventos antes del close); el E2E lo prueba end-to-end. Constancia del "no hay lógica pura de ordenamiento" registrada arriba.
- `admin.ts` → **0 helpers nuevos** (todos los oráculos necesarios ya existían: `waitForServerWeightEventWithSession`, `waitForServerSanitaryWithSession`, `waitForServerSessionClosed`).

## Verificación final

- E2E `app/e2e/maniobra-offline.spec.ts`: **1 passed** (16,9s). (El `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` al final = crash de teardown de Node en Windows, NO fallo de test — documentado en `current.md` para cut-ficha.)
- `node scripts/check.mjs`: anti-hardcode **0 violaciones**, typecheck client **OK**, client unit **verde**. Único ROJO = flake conocido `animals_tag_unique` (23505) en `supabase/tests/animal/run.cjs` — colisión cross-terminal con spec-08 SIGSA en la DB compartida (`reference_check_red_rate_limit`), NO regresión (mi cambio es test-only/frontend, no toca backend).

## Riesgos residuales

- El E2E depende del remoto + service_role (igual que los otros offline specs). Bajo presión de 2 terminales sobre la DB compartida, los polls de los oráculos podrían tardar más; mitigado con `tries:40` (≈80s) y `test.setTimeout(200_000)`.
- R10.3 se prueba con la inseminación (off-by-default en cría) como negativa + la secuencia offline de 2 pasos. No probé el camino "una maniobra prendida-luego-apagada offline" (eso es la capa 2/DB, ya cubierta por la suite `maneuvers/run.cjs` T2.4). Es defensa-en-profundidad server-side, fuera del scope de cobertura de M4.3 (verificación de la capa OFFLINE del cliente).
