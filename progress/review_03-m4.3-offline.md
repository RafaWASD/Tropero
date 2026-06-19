# Review - spec 03 MODO MANIOBRAS - chunk M4.3 (Offline + cierre, verificacion)

**Veredicto: APPROVED**

Chunk de verificacion/cobertura test-only (sin migraciones; Gate 1 N/A). Este es su Gate 2 (reviewer; ya hubo autorrevision del implementer). Revisado SOLO M4.3.

## Trazabilidad R<n> <-> test

Todos verificados contra app/e2e/maniobra-offline.spec.ts (un unico test, VERDE).

- R10.1 (sesion + identificacion manual + >=2 eventos 100% offline) <-> setOffline(true) antes de "Arrancar jornada" (createSession offline) + manualIdentify (lookup local) + vacunacion (sanitary_events) + pesaje (weight_events), todo con la red cortada. Oraculos waitForServerWeightEventWithSession + waitForServerSanitaryWithSession confirman que ambos eventos aterrizaron. OK
- R10.2 (sync posterior + cero rechazo) <-> setOffline(false) -> drenado -> rejected.toEqual([]) sobre el filtro l.includes('upload rechazado'). El string coincide con connector.ts:193 ('[powersync] upload rechazado (descartado)'). OK
- R10.3 (gating offline desde cache local de rodeo_data_config) <-> pool-row-vacunacion/pool-row-pesaje visibles + pool-row-inseminacion con toHaveCount(0) (off-by-default en cria, confirmado en 0018:96) + la secuencia de carga OFFLINE resuelve exactamente "1 de 2"/"2 de 2". OK
- R10.7 (cierre explicito + orden events-before-close) <-> ExitJornadaSheet -> "Terminar jornada" -> closeSession (offline) + oraculo waitForServerSessionClosed(w.sessionId) + vac.sessionId === w.sessionId + rejected === []. OK
- R12.1 (offline-first implicito) - cubierto por el camino feliz offline de extremo a extremo. OK

## Validacion de los puntos de foco

1. El oraculo cruza el session_id FK real? SI. waitForServerWeightEventWithSession (admin.ts:964) y waitForServerSanitaryWithSession (admin.ts:1182) filtran ambos .not('session_id','is',null) y DEVUELVEN el session_id real. El test asserta vac.sessionId === w.sessionId (mismo FK = misma jornada) Y waitForServerSessionClosed(w.sessionId) (ese FK resuelve a una sesion que existe y quedo closed). Un evento huerfano (session_id null o apuntando a otra sesion) NO pasaria. No es "el evento existe": es "el evento apunta a ESTA sesion, que esta cerrada".

2. El argumento del orden de cierre es logicamente valido? SI, y es load-bearing-confirmado. tg_event_session_tenant_check (0052:62-66) rechaza con 23514 todo INSERT de evento cuyo session_id apunta a una sesion con status <> 'active'. El wiring INSERT real esta en 0056 (split ins/upd). Por tanto: si el close drenara ANTES de los eventos, los INSERT de eventos chocarian la sesion closed -> 23514 -> connector.ts loguea "upload rechazado" -> rejected.toEqual([]) FALLA. El test pasa con rejected === [] + ambos eventos con session_id apuntando a una sesion closed server-side -> prueba que los eventos drenaron primero (sesion aun active), el close despues (FIFO de la CRUD queue). El test FALLA si se rompe el invariante; no verdea por casualidad.

3. Robustez: polls con timeout (tries:40 ~80s por oraculo, test.setTimeout(200_000)), no sleeps fragiles. El unico waitForTimeout(3000) es el dwell de la fila sembrada por service_role (mismo patron que los otros specs de maniobra). Seed namespaced (createTestUser('m43-offline') + seedEstablishmentWithRodeo bajo RUN_TAG); cleanup en afterAll->cleanupAll() + global-teardown. Peso unico (300+Date.now()%90) y vacuna unica (Aftosa-<RUN_TAG.slice(-6)>) -> oraculos deterministas sin colision cross-test. Assertions especificas (peso exacto, product_name exacto, FK igualdad, count 0), no genericas.

4. No-regresion / alcance: cambio test-only - un spec E2E nuevo + reconciliacion de tasks.md. admin.ts NO se toco (0 helpers nuevos; reusa 3 existentes). No toca codigo de app ni backend. Playwright testDir:'./e2e' auto-descubre el spec (no requiere wiring). Todos los anchors UI que usa son reales y renderizados por componentes de prod (verificado: identificar.tsx:1043, ExitJornadaSheet.tsx, ManeuverReorderList.tsx:430, SilentVaccinationStep.tsx:152/170/128, PesajeStep.tsx:89/158, AnimalSummary.tsx:41) - no anchorea strings nunca renderizados.

5. Reconciliacion: la nota AS-BUILT de M4.3 en tasks.md refleja lo construido. La afirmacion "no hay logica pura de ordenamiento; el orden lo da el FIFO de la CRUD queue" es CORRECTA - sessions.ts:164-169 lo documenta in-code y design.md seccion 5 (linea 647) describe el mismo invariante as-built ("los eventos creados antes del cierre se suben antes que la mutacion status='closed'... Se debe verificar ese orden en el cliente"). El E2E ES esa verificacion cliente. No hay specs viejas/mintiendo: requirements.md (R10.1/2/3/7) y design.md seccion 5 coinciden con el codigo; el chunk verifica, no cambia comportamiento.

## Tasks completas: SI
M4.3 -> [x] en tasks.md con nota AS-BUILT. T1-T5 en [x] en progress/impl_03-m4.3-offline.md. No quedan [ ] sin justificar en este chunk.

## CHECKPOINTS
- [x] Trazabilidad: cada R con >=1 test concreto.
- [x] Tasks del chunk en [x].
- [x] Cada archivo modificado respeta architecture/conventions y tiene cobertura (el archivo nuevo ES la cobertura).
- [x] Specs no contradicen el as-built (design seccion 5 + requirements coinciden).
- [x] check.mjs: verde salvo el flake admisible (ver abajo).

## Checklist RAFAQ-especifico
- A. Multi-tenancy/RLS - N/A directo (no crea tablas). El test SI valida el aislamiento server-side de forma indirecta: el oraculo de pesaje busca por establishment_id (tenant-scoped), establishment del contexto del user sembrado (no hardcodeado), y el establishment_id de eventos lo fuerza server-side el trigger 0077. Sin migraciones nuevas -> sin policies nuevas que revisar.
- B. Offline-first - APLICA, todas tildadas:
  - [x] Funciona offline (corte CDP setOffline(true) para createSession + identify + 2 maniobras + cierre).
  - [x] Sync bucket scoped por establishment activo (sessions/eventos ya en sync rules M1; verificado por el aterrizaje server-side tenant-scoped).
  - [x] Resolucion de conflictos: N/A para este flujo (CRUD-plano append/UPDATE FIFO; no hay edicion concurrente en el test).
  - [x] No hace requests sincronos a Supabase desde la pantalla (todo el camino corre con red cortada y aun asi escribe -> repos sobre SQLite local).
- C. BLE - N/A (camino MANUAL, sin BLE; documentado en el spec).
- D. UI de campo - N/A para este chunk (verificacion, no UI nueva; sizes/legibilidad ya cubiertos por M2/M3).
- E. Edge Functions - N/A (no toca edge functions; el camino es CRUD-plano + triggers, no RPC).

## check.mjs
Anti-hardcode 0 violaciones - typecheck client OK - client unit verde (incl. suites powersync/maneuver/ble/sigsa). Unico ROJO: "R2: INPUT-1 CHECK ... animals_tag_unique (23505)" en supabase/tests/animal/run.cjs:1924 - colision cross-terminal en la DB compartida (spec-08 SIGSA en otra terminal), flake conocido (reference_check_red_rate_limit), NO regresion (M4.3 es test-only/frontend, no toca la suite backend animal). Admisible per el brief.

## Cambios requeridos
Ninguno (bloqueante). El chunk se aprueba.

## Nits (no bloquean)
- El waitForTimeout(3000) dwell en configureSessionVacPesaje es el patron heredado del resto de specs de maniobra; aceptable, pero es el unico punto no-poll. Si en el futuro se quiere endurecer, podria reemplazarse por un poll de presencia de la fila en el cache local. No bloquea.
- El test prueba R10.3 con la inseminacion (off-by-default) como negativa; no cubre el camino "maniobra prendida-luego-apagada offline" (capa 2/DB), pero eso ya lo cubre la suite maneuvers/run.cjs T2.4 y queda fuera del scope de cobertura del cliente offline. Correctamente delimitado.
