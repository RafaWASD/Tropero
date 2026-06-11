# Review — backlog flake deriveCurrentState (estado reproductivo determinístico)

Tipo: BUGFIX de backlog (NO feature SDD). Frontend puro (TS + tests). Sin schema/RLS/Edge/migraciones.
Baseline: working tree no commiteado sobre 0b10f52.
Reporte del implementer: progress/impl_backlog-flake-repro.md.

## Veredicto: APPROVED

Fix correcto en los 3 casos a igualdad de event_date, fiel al server (verificado a nivel schema), sin
regresiones, tests nuevos fieles, reconciliacion exacta. check.mjs verde (exit 0). Un hallazgo MENOR de
documentacion (no bloqueante).

## 1. Correctitud en los 3 casos (foco 1) — OK
ORDER BY real (local-reads.ts:845): event_date ASC, created_at IS NULL ASC, created_at ASC (NULLs-last).
fetchTimeline (events.ts:120) asigna seq=i. Mayor seq = leido despues = creado despues -> gana.
- parseTimeline (display): b.seq-a.seq -> seq mayor arriba. OK.
- isNewerRepro (event-timeline.ts:550): cand.seq > best.item.seq -> seq mayor gana. OK.
Casos (todos con eventId del tacto LEXICAMENTE MAYOR que el del birth -> prueba que NO decide el eventId):
- Ambos presentes: created_at ASC -> mayor ultimo -> seq mayor -> gana (test caso 1).
- Uno null: NULLs-last -> null seq mayor -> gana null (test caso 2 + invertido + simetrico aborto).
- Ambos null: orden insercion estable SQLite -> insertado despues seq mayor -> gana (test caso 3 + simetrico).
Semantica vs isAfter/RC6.1.4 (animal-category.ts:298): COINCIDE punto por punto (null=posterior; dos null
-> indice mayor; dos presentes -> created_at mayor). isNewerRepro codifica "null=posterior" en el ORDER BY
en vez de en la comparacion. Fallback sin seq mantiene la misma regla.

## 2. created_at server-authoritative -> client-controlled (foco 2) — OK, ALINEA
0026_reproductive_events.sql:50 created_at default now(). Unico trigger BEFORE INSERT: set_created_by
(0026:58-60 -> tg_set_created_by_auth_uid, 0024:5-9) SOLO setea created_by, NO created_at. => el created_at
de cliente PERSISTE al subir. Premisa central REAL. compute_category (0062/0063) ordena por (event_date,
created_at); antes server veia now() de subida y cliente NULL hasta sync (divergencia = causa raiz del
flake); ahora ambos usan el mismo instante de creacion -> el fix ALINEA, no introduce riesgo nuevo. Skew de
reloj a igualdad de event_date = el mismo que el overlay del parto ya tenia (outbox.ts:266). Frontera de
autorizacion (created_by/establishment_id) la sigue forzando el trigger; Gate 2 la cubre.

## 3. Regresiones (foco 3) — OK
parseTimeline a/b/c/d intactos (seq opcional -> sin el, fallback eventId previo). Consumidores
(animal/[id].tsx:160,1126) solo leen deriveCurrentState; no construyen seq. Callers de builders
(events.ts:340/379/406) actualizados con nowIso(); typecheck exit 0 lo garantiza. GUARD de columnas
(schema.test.ts) 13/13; seq no es columna DB (lo deriva fetchTimeline) -> correctamente sin declaracion.
ORDER BY/wrapping cubierto por 2 tests nuevos en local-reads.test.ts.

## 4. Parto por overlay con created_at de cliente (foco 4) — CONFIRMADO
enqueueRegisterBirth (outbox.ts:266) createdAt=nowIso() -> buildPendingReproductiveEventInsert
(outbox.ts:269-275; local-reads.ts:1248-1259 exige createdAt:string no nullable). Rama overlay del UNION
(local-reads.ts:836) selecciona created_at. => el parto del overlay SI trae created_at de cliente. NO hay
agujero.

## 5. Tests nuevos (foco 5) — fieles, cubren los 3 casos
3 casos + simetricos + invertido + fallback-sin-seq, todos con eventId del tacto MAYOR -> fallarian si el
desempate cayera al eventId. No tautologicos. reproItemsWithCreatedAt emula fielmente el ORDER BY del SQL.
2 tests de comportamiento contra node:sqlite (tablas reales). Conteos confirmados: event-timeline 88/88,
local-reads 74/74, animal-category 69/69.

## 6. Reconciliacion (foco 6) — OK
design.md (spec 15): nota as-built fiel a los 2 cambios. backlog.md: entrada RESUELTO, no borrada.

## Hallazgo MENOR (no bloqueante) — doc drift
event-timeline.ts:104 y :204 y events.ts:115-118 describen el ORDER BY como "event_date ASC, created_at
ASC" OMITIENDO "created_at IS NULL ASC" (NULLs-last) que el SQL real SI tiene. El docstring de
deriveCurrentState y el banner de local-reads.ts:839-843 SI lo tienen. Inconsistencia de COMENTARIOS; el
SQL ejecutado es correcto (probado por los 2 tests node:sqlite). NO bloquea. Sugerido unificar.

## Checklist RAFAQ
A (RLS): N/A — no toca tablas/RLS. B (offline-first): aplica y OK — el fix es para el path offline; usa
SQLite local, sin requests sincronos; orden documentado. C (BLE): N/A. D (UI campo): N/A. E (Edge): N/A.

## Verificacion corrida
- node scripts/check.mjs -> exit 0. Client JS suite 829/829. typecheck OK. (2 corridas previas rojas en
  suites supabase DISTINTAS — animal/run.cjs luego rls/run.cjs — flake transitorio de setup vs DB beta
  remota, NO por el diff: cada una paso aislada; ninguna toca el diff frontend-only. 3ra corrida full verde.)
- tsc --noEmit (app/) exit 0.
- Unit: event-timeline 88/88, local-reads 74/74, animal-category 69/69, schema 13/13.
- e2e events.spec.ts (web :8099 ya up, DB beta) --repeat-each=4 -g "parto|aborto": 19 passed / 1 failed. El
  /^Vacia /  (estado repro determinístico) paso en todas. El 1 failed es el flake PRE-EXISTENTE documentado:
  parto con mellizos falla en navegacion calf->madre (getByText "Vaca segundo servicio", ~linea 349), ajeno
  al estado repro y fuera de scope. El UV_HANDLE_CLOSING exit 127 es el crash de teardown libuv en Windows
  DESPUES de imprimir resultados (no es fallo de test).

## Conclusion
APPROVED. Resuelve el flake deterministicamente, fiel al server (verificado a nivel schema), sin regresion,
reconciliacion exacta. Unico hallazgo cosmetico (comentarios ORDER BY incompletos), no bloqueante.
