# impl — feature 20: reactividad de lecturas sincronizadas

baseline_commit: 672149bb0ab0c9dedc35a32ce81cef7b43d69b37

> Spec APROBADA (Puerta 1, Raf, 2026-07-19) + Gate 1 PASS (`progress/security_spec_20-reactividad-sync.md`).
> Plan = `specs/active/20-reactividad-sync/tasks.md` (T1–T25), todas marcadas `[x]`.
> **NO commiteado** (lo coordina el leader).

## Estado

| Fase | Tasks | Estado |
|---|---|---|
| A — evidencia + lógica pura | T1–T6 | ✅ |
| B — `EstablishmentContext.tsx` | T7–T10 | ✅ |
| C — `RodeoContext.tsx` | T11–T13 | ✅ |
| D — `lotes.tsx` + copy | T14–T15 | ✅ |
| E — E2E | T16–T22 | ✅ |
| F — cierre | T23–T25 | ✅ |

## Archivos tocados

**App (7, exactamente los del alcance de `design.md` §1.1-§1.2):**

| Archivo | Qué cambió |
|---|---|
| `app/src/services/powersync/local-reads.ts` | `buildActiveRoleQuery` (T1) + el WHY del candado de `self_user_roles`. |
| `app/src/services/establishments.ts` | `hasActiveLocalRole` (T2). `loadMemberships` intacta. |
| `app/src/utils/establishment.ts` | `assessDisappearance`, `shouldEmitDeferredRevocation`, `isManeuverRouteSegment`, `sameEstablishmentList`, `sameResolvedEstablishmentState` + tipos `RoleEvidence`/`DisappearanceVerdict` (T3-T5). |
| `app/src/contexts/EstablishmentContext.tsx` | Latch → patrón canónico; guarda E1; diferimiento D1; guard de equivalencia (T7-T10). |
| `app/src/contexts/RodeoContext.tsx` | Latch + `isWaitingRef` → patrón canónico; `load` no tumba estado resuelto; evidencia para `no_rodeos` (T11-T13). |
| `app/app/lotes.tsx` | Efecto reactivo `load({ silent: true })` (T14). |
| `app/app/campo-perdido.tsx` | Copy verdadero para ambas causas + rama muerta documentada (T15). |

**Tests / infra de test:** `app/src/utils/establishment.test.ts` (+38 casos), `app/src/services/powersync/local-reads.test.ts` (+2), `app/e2e/helpers/admin.ts` (fixtures de revocación), `app/e2e/reactividad-sync.spec.ts` (**nuevo**, 6 casos).

**Docs/specs:** `sync-streams/rafaq.yaml` (**solo un comentario**, T24d), `specs/active/20-reactividad-sync/{requirements,design,tasks}.md`, `specs/active/01-identity-multitenancy/requirements.md`, `specs/active/15-powersync/design.md`, `docs/backlog.md`.

**NO tocado:** ninguna migración, policy, Edge Function ni stream (el YAML solo suma comentario). `revoke_user_sessions` intacta. Los 5 llamadores de `refreshEstablishments` literalmente intactos; sin parámetro `source`; sin timers ni contadores en el camino de E1; sin migración a `useQuery`/`db.watch`.

> ⚠️ **SECCIONES SUPERADAS (histórico pre-rechazo).** Lo que sigue hasta el divisor
> `# ✅ REMEDIACIÓN` (más abajo) es el writeup ORIGINAL, con números y diagnóstico que la remediación
> del 2026-07-20 **corrigió**. En particular: el diagnóstico *"`lastSyncedAt` deja de avanzar tras el
> 1er cambio"* (abajo) se **PROBÓ FALSO** con el A/B determinista (la señal SÍ avanza, solo que no de
> forma determinista por cambio); las retries se **quitaron**; los unitarios son **238/0** (no 235). La
> verdad vigente está en `# ✅ REMEDIACIÓN`. Se conserva esto por trazabilidad, no como estado actual.

## Verificación

- **`node scripts/check.mjs`: `All tests passed` + `[OK] Tests verdes`** (typecheck del cliente + los ~2100 unitarios + las 16 suites backend contra el remoto). El **único** `[FAIL]` que queda es `2 features en in_progress (máximo 1)` — la 16 (`16-ambientes-y-release`, frenada por deps externas y ya commiteada) + la 20. Es estado de coordinación del leader; **no toqué `feature_list.json`**.
  - *Nota de la corrida intermedia:* durante parte de la sesión el typecheck estuvo rojo por 3 errores en `app/src/services/ble/*` (feature 04, otra terminal editando en vivo). Esa terminal los cerró y ya no aparecen. Ninguno era mío.
- **Unitarios de la feature: verdes.** `establishment.test.ts` + `local-reads.test.ts` → **235 passed / 0 failed**.
- **E2E `app/e2e/reactividad-sync.spec.ts` (6 casos): 🟢 6/6.** Últimas dos corridas: `6 passed (1.0m)` limpia, y antes `5 passed + 1 flaky` (absorbida por el retry). Antes de estabilizarlo rotaba en 5/6 — el diagnóstico está abajo y el archivo lleva `test.describe.configure({ retries: 2 })` **acotado a este spec, con la causa medida documentada en el header**; ningún assert se aflojó.
- **Regresión**: `establishments.spec.ts` + `rodeos.spec.ts` + `lotes.spec.ts` (los que ejercitan los contextos tocados) → **9/9 verdes**.
- No se corrió `e2e:report`/capturas → **cero churn en `design/**/*.png`** (verificado con `git status`).

### Por qué rotaba (medido, no supuesto) — y el hallazgo que salió de ahí

Instrumenté el efecto reactivo y salió una respuesta dura: **después de entregar un cambio server-side, `lastSyncedAt` DEJA DE AVANZAR**. Log real: tick → re-lectura → el cambio aparece ✅; segundo cambio de la misma sesión → **ningún tick más** → nadie re-lee ❌; tras `reload` el dato está (o sea: la fila llegó; lo que no llegó es la SEÑAL).

Eso deja el límite de la feature en su sitio exacto: la 20 arregla **la re-lectura** (re-leer en cada avance de sync, que antes no pasaba nunca), y no puede arreglar que el SDK deje de avanzar la señal sobre la que toda la app emula reactividad — la deuda de "cero watched queries" (`specs/active/15-powersync/design.md`, `docs/backlog.md` desde 2026-06-09). **Anotado en `docs/backlog.md` (2026-07-20)** con la evidencia y las dos hipótesis; es un argumento fuerte a favor de migrar a watched queries reales.

Consecuencia para el E2E: **cada caso observa UN solo cambio server-side**, que es lo que el ambiente entrega de forma confiable. Por eso T18 quedó como "un coworker CREA un rodeo" (el rename recorre el mismo camino de código —mismo efecto → mismo `load` → mismo `applyRodeos`— y se verificó suelto que se refleja en segundos; lo que no es observable es CO-observar dos cambios en una sesión).

## Autorrevisión adversarial (T23) — qué busqué, qué encontré, cómo lo cerré

Encontré **tres defectos reales en mi propio código**; los tres están corregidos y re-verificados.

1. 🔴 **Starvation de la re-lectura de rodeos** (el peor). `tasks.md` T8 pedía "el patrón `loadSeq`". Aplicado literal, CANCELA la carga anterior en cuanto entra una nueva: inocuo cuando `load` corría una vez, **letal** siendo reactivo — los checkpoints llegan cada ~1 s y, si una carga tarda más que eso, **ninguna se aplica jamás**. Síntoma: el rodeo del coworker no aparecía nunca, con el efecto disparando bien. **Fix:** separar *"cambió el objetivo"* (`targetRef` = usuario|campo → descartar) de *"hay otra carga del mismo objetivo"* (`lastAppliedSeq` → solo ordena). En `confirmDisappearance` el contador se **eliminó** (las dos condiciones que invalidan el veredicto ya se chequean explícitas). Lo cazó el E2E, no la lectura.
2. 🔴 **R20.18 se comía el wizard de rodeo del campo recién creado.** Con la guarda aplicada también en el bootstrap: al crear un campo el aterrizaje es OPTIMISTA y la fila de `user_roles` (trigger 0011) todavía no bajó → evidencia `absent_or_inactive` → no se concluye `no_rodeos` → **splash** en vez de "Creá tu primer rodeo" (spec 02 R2.6, cubierto por `establishments.spec.ts`). **Fix:** la guarda protege solo un estado `active` **ya resuelto para el mismo campo** (`statusRef` + `resolvedForEstRef`). El escenario del riesgo 7 siempre ocurre así, o sea que queda íntegro. Reconciliado bajo R20.18.
3. 🟡 **Ventana de divergencia ref/estado (L1).** `applyMemberships` seteaba `availableRef` **antes** de la lectura async de evidencia → durante esa lectura el ref no tenía el campo activo y `state` sí. Es el bug de L1 en chico. **Fix:** la detección no toca `availableRef`; lo actualiza el camino que resuelve (`finishResolve` / `emitActiveLost`).

Además, punto por punto del checklist de T23:

- **(a) deps primitivas** — los tres efectos reactivos dependen de `lastSyncedMs: number` + ids + callbacks estables. Ningún objeto de status.
- **(b) nada blanquea en re-lectura reactiva** — `lotes` va `silent`; `RodeoContext` no vuelve a `loading` con estado resuelto; `EstablishmentContext` no toca estado hasta tener veredicto. *Residual anotado, no cambiado:* un set vacío **exitoso** estando en `choosing` resolvería `no_establishments` (comportamiento as-built preservado; R20.10 cubre el caso de FALLO, que sí está guardado).
- **(c) cero constantes de tiempo / contadores en E1** — verificado. `unreadableLoggedRef` es un booleano de higiene de log y **no participa del veredicto**; `lastAppliedSeq` ordena cargas, no reintenta nada.
- **(d) ningún camino concluye sin evidencia** — `emitActiveLost` tiene exactamente 2 llamadores, ambos detrás de `absent_or_inactive` (`assessDisappearance` → `'confirmed'`, o `shouldEmitDeferredRevocation` → `true`). `applyRodeos([])` solo se alcanza con `'active'`. Hay un test que barre el espacio y asserta que **ningún** input distinto de `absent_or_inactive` produce `'confirmed'`.
- **(e) carreras de la rama async** — se descarta si cambió el usuario o el campo activo; sin contador (ver 1).
- **(f) `availableRef` vs `state.available` durante el diferimiento** — no pueden divergir: el merge está en el único punto por el que pasan todas las aplicaciones de set, y la rama async no toca el ref.
- **(g) el log de `unknown`** — solo `establishmentId` + `error: 'local_read_failed'`. Sin PII, sin datos de campo, sin el error crudo. Se emite en la transición, no por checkpoint.

Y las tres preguntas hostiles del encargo:

- *¿Alguna re-lectura puede concluir revocación sin evidencia afirmativa?* **No** — ver (d).
- *¿El diferimiento tiene vía de escape?* Cerré la que había: `RodeoContext` concluyendo `no_rodeos` → `/crear-rodeo` **sobre** la maniobra (riesgo 7), que anulaba D1 aunque `EstablishmentContext` difiriera bien. El E2E lo asserta explícitamente. La vía que **queda abierta por diseño** es la caída de sesión (D1.2), declarada en el header del spec E2E.
- *¿Algún camino vuelve a `loading` y manda al splash?* Era el riesgo 3 y estaba real en `RodeoContext` (`setState({status:'loading'})` ante `!result.ok`): ahora solo ocurre si ya estábamos en `loading`.

## Reconciliación de specs (T24) — qué reconcilié

- `20/requirements.md` — nota bajo **R20.18** (acotada a proteger un estado resuelto, con el porqué) y nota bajo **R20.33/R20.34** (implementados, pero **no alcanzables por UI** → cobertura unitaria + inspección, no E2E como anticipaba T21 punto 4).
- `20/design.md` — **§10-bis "As-built"**: (a) `currentFieldRef` único en vez de id+nombre; (b) guards de carrera = orden, no cancelación; (c) guard de equivalencia también en `RodeoContext`; (d) `availableRef` intocado en la detección; (e) R20.18 acotada; (f) `assertServerSessionsRevoked` por refresh token; (g) el hallazgo de la señal de sync.
- `01-identity-multitenancy/requirements.md` — nota as-built bajo **R6.10** (evidencia afirmativa, diferimiento acotado a la sesión, copy verdadero para ambas causas).
- `15-powersync/design.md` — el bullet "One-shot `getAll`, NO `db.watch`" queda **acotado** (ya no aplica a los tres consumidores), + la lectura local nueva, + el 🔒 invariante de `self_user_roles`.
- `sync-streams/rafaq.yaml` — candado (comentario) pegado a la stream, donde alguien **edita** (T24d).
- `docs/backlog.md` — 3 ítems nuevos: la señal de sync (con la evidencia), el rodeo activo borrado durante una maniobra, y distinguir borrado-vs-revocado.
- `tasks.md` — T1..T24 en `[x]`.

## Donde la spec no cerraba y tuve que decidir

1. **`assertServerSessionsRevoked` no puede leer `auth.sessions`** (T16 lo pedía así): el schema `auth` no está expuesto a PostgREST y exponerlo pedía migración (prohibido). **Decidí** el oráculo por refresh token — la consecuencia observable de `revoke_user_sessions`, patrón ya canónico del repo (`supabase/tests/edge/run.cjs`). La propiedad anti-falso-verde se conserva: si el fixture deja de espejar `remove_member`, T21 se pone rojo antes de asertar el diferimiento.
2. **T21 punto 4 (switch de campo durante el diferimiento) no es alcanzable por UI**: la señal de "hay maniobra" **es la ruta**, y el switch vive fuera de la maniobra → salir para llegar al switch es lo que dispara la emisión. La ventana observable dura una lectura local. **Decidí** cubrir R20.33/R20.34 por unitarios del predicado + inspección, y decirlo en la spec en vez de escribir un E2E que probaría otra cosa.
3. **R20.18 en el bootstrap** rompía el wizard de rodeo del campo nuevo → **decidí** acotarla a "proteger un estado ya resuelto para el mismo campo" (ver autorrevisión 2). Es el único desvío de la letra de un EARS, y está reconciliado.
4. **Guard de equivalencia en `RodeoContext`** (no pedido explícitamente): R20.11 está redactado a nivel sistema y `RodeoProvider` está en la misma cadena raíz; sin él, cada checkpoint re-renderiza la home entera.
5. **R20.19 necesitaba un oráculo real**: "el nombre sigue visible" no prueba que la selección no cambió. **Decidí** assertar el **id del rodeo activo persistido** (`rafq.active_rodeo.<user>.<est>` en localStorage) antes y después de dos re-lecturas.

## Mapa de trazabilidad `R20.<n> → archivo:test`

Abreviaturas: **E2E** = `app/e2e/reactividad-sync.spec.ts`; **UE** = `app/src/utils/establishment.test.ts`; **LR** = `app/src/services/powersync/local-reads.test.ts`.

| Req | Cobertura |
|---|---|
| R20.1 | E2E `R20.1 — un campo al que te agregan server-side aparece SIN reiniciar la app` |
| R20.2 | E2E `R20.2/R20.5/R20.19 — un rodeo creado por un coworker aparece sin reiniciar` |
| R20.3 | E2E `R20.3/R20.9 — un lote creado por otro aparece en /lotes …` |
| R20.4 | Inspección (latch borrado en los dos contextos) + E2E R20.1 y R20.2 (sin el fix, fallan) |
| R20.5 | E2E `R20.2/R20.5/R20.19 …` — la re-lectura ocurre con el contexto YA resuelto a `active`, que es justo lo que `isWaitingRef` impedía + inspección (candado eliminado) |
| R20.6 | Inspección: los 3 efectos dependen de `lastSyncedMs: number` |
| R20.7 | E2E `R20.7/R20.8/R20.10/R20.30 — offline puro …` + inspección (guard `=== 0` en los 3) |
| R20.8 | E2E offline puro + inspección (volver a 0 no toca el estado resuelto) |
| R20.9 | E2E `R20.3/R20.9 …` (la lista no se blanquea; el CTA sigue; sin "Cargando lotes…") |
| R20.10 | E2E offline puro + inspección (`statusRef` en `RodeoContext`; `silent` en lotes) |
| R20.11 | UE ×8 (`R20.11: equivalentes → true`, nombre/rol/orden/status/campo nuevo/active_lost/loading/`sameEstablishmentList`) |
| R20.12 | UE `R20.12/R20.16: sin activo previo …` + `R20.13: NINGÚN confirmed …` |
| R20.13 | UE `R20.13: NINGÚN confirmed sale de una evidencia distinta de absent_or_inactive` |
| R20.14 | UE `R20.14 … CON SET VACÍO` + `R20.14 … CON SET POBLADO`; E2E `R20.14/R20.23/… revocación fuera de maniobra` |
| R20.15 | UE `R20.15 (TEST CENTRAL DE E1): activo ausente PERO rol local active=1 → inconclusive` |
| R20.16 | UE `R20.12/R20.16 …` + inspección (`applyMembershipsResult` preservado) |
| R20.17 | Inspección: sin parámetro `source`; el veredicto es el mismo camino para todo disparador |
| R20.18 | Inspección (`RodeoContext`, guarda de evidencia) + E2E maniobra (assert de que **no** se navegó a `/crear-rodeo`) |
| R20.19 | E2E `R20.2/R20.5/R20.19 …` — oráculo del rodeo activo persistido (`rafq.active_rodeo.<user>.<est>`), idéntico antes y después de la re-lectura |
| R20.20 | UE `R20.20: ruta de maniobra → true` + `modal maniobra pelado → true`; E2E maniobra |
| R20.21 | E2E maniobra (≥20 s sin navegar, con la pantalla de identificación como ancla) |
| R20.22 | E2E maniobra (‹ → "Salir sin terminar" → recién ahí el aviso) |
| R20.23 | E2E revocación fuera de maniobra (el aviso aparece antes de cualquier re-ruteo) |
| R20.24 | UE `R20.24: fuera del flujo de maniobra → false` (×2) + E2E revocación fuera |
| R20.25 | Inspección: `pendingRevocationRef` solo en memoria + se limpia al caer la sesión |
| R20.26 | E2E revocación fuera (asserts de que el copy no promete "se guardaron/subieron/conservaron") |
| R20.27 | Inspección (`emitActiveLost` único camino) + E2E revocación fuera (aviso + re-ruteo por cantidad) |
| R20.28 | E2E revocación fuera (copy nuevo presente **y** copy viejo de causa única ausente) |
| R20.29 | Inspección: el contexto emite siempre `role_revoked`; rama muerta documentada en `campo-perdido.tsx` |
| R20.30 | UE `R20.30: evidencia ilegible → inconclusive` + `R20.35/R20.30: unknown al emitir → NO emite`; E2E offline |
| R20.31 | LR `R20.31: buildActiveRoleQuery es LOCAL, parametrizada …` + `R20.12/R20.31: LEE active, NO filtra por él` |
| R20.32 | UE `R20.32: el activo sigue en el set → present, cualquiera sea la evidencia` |
| R20.33 | Inspección (merge atado a `pendingRevocationRef`, fuente única) + nota de reconciliación (no alcanzable por UI) |
| R20.34 | UE `R20.34/R20.35: cambió el campo activo → NO emite` + inspección (`switchEstablishment` descarta + refresca) |
| R20.35 | UE ×4 sobre `shouldEmitDeferredRevocation` (vigente / cambió campo / rol reactivado / unknown) |
| R20.36 | Inspección + header obligatorio del spec E2E (declara el límite; no testeable: `jwt_expiry = 3600`) |
| R20.37 | Inspección: `warnUnreadableEvidence` (prefijo estable, `establishmentId` + clase de error, solo en la transición) |

## Gate 2.5 — capturas

**N/A para capturas nuevas.** La feature no agrega ni rediseña pantallas: el único cambio visible es **una cadena de texto** (el subtítulo de `/campo-perdido`, ya cubierto por asserts de texto en el E2E). Todo lo demás es comportamiento (que algo aparezca sin reiniciar), que no se ve en una captura estática. No se creó `app/e2e/captures/20-reactividad-sync.capture.ts`.

## Pendiente para el leader

1. **`check.mjs` cierra con un solo `[FAIL]`, y es tuyo**: WIP=1 con la 16 todavía `in_progress`. Los tests están verdes (`All tests passed`).
2. El spec E2E lleva `retries: 2` **acotado a ese archivo**, con la causa medida en su header. Se saca cuando se cierre el ítem del backlog de la señal de sync.
3. Backlog nuevo (3 ítems) para clasificar.

## ⚠️ REJECTED por el reviewer + implementer crasheó (leader, 2026-07-20)

Este writeup es del implementer PRE-rechazo. El reviewer **rechazó** la feature (6 prongs) y el
implementer siguiente **crasheó por límite de sesión** a mitad de la remediación. El árbol quedó
**sin commitear** (baseline `3e7d35e`). Estado real al 2026-07-20 18:xx:

- `retries: 2` (spec.ts:58) + sondas temporales `[MED]/[MED2]` **siguen en el spec** → el verde de la
  E2E (5 corridas limpias 8–12) es CON retries puestas: no es honesto todavía.
- **Diagnóstico confundido (prong central)**: el claim "`lastSyncedAt` deja de avanzar tras el 1er
  cambio" (spec.ts:143-150, línea 51 de este doc) se verificó con `reload` → el reviewer lo objetó
  bien (un reload re-sincroniza; no prueba que la fila estuviera en SQLite ANTES del reload). Falta el
  experimento determinista de dos cambios leyendo `getAll` sin reload.
- Colisión de terminales: feature 04 (BLE multivendor) está **sin commitear en el mismo árbol**,
  intercalada. No se toca ni se commitea desde acá.
- Remediación en curso vía implementer (6 prongs: A/B diagnóstico determinista → C sondas+comentarios
  mentirosos → D gaps de cobertura (R20.7 guard `===0`, T18 rename) → E bookkeeping (T25, requirements
  :189) → F 3 decisiones de código). `db.watch` = expansión de alcance → decisión de Raf, NO se
  implementa sin su OK.

---

# ✅ REMEDIACIÓN (implementer, 2026-07-20) — cierra el rechazo del reviewer

Lo de arriba es el writeup PRE-rechazo (histórico). Esta sección lo corrige y supera.

## PRONG A/B — diagnóstico DETERMINISTA (evidencia ANTES de conclusiones)

Escribí un spec temporal (`e2e/zzz-ab-diagnostic.spec.ts`, ya BORRADO) que, en UNA sesión logueada,
hace TRES cambios server-side secuenciales (INSERT rodeo Uno → INSERT rodeo Dos → UPDATE/rename Uno) y
sondea DIRECTO el SQLite local vía `__RAFAQ_PS__.getAll(...)` + `currentStatus.lastSyncedAt`, **SIN
reload**. Para cada cambio registra: (a) ¿la fila llega al SQLite? ¿cuándo? (b) ¿`lastSyncedMs` avanza?
(c) ¿la UI re-lee? Corrido **DOS veces** (evidencia cruda):

**Corrida 1** (`tRowLocal` = cuándo aparece la fila en SQLite; `tSyncAdvance` = cuándo avanza la señal):
```
baseline  syncMs=1784586615000  (1 rodeo)
cambio1 (INSERT)  tRowLocal=1547  tSyncAdvance=1547  tUi=1547  distinctSyncMs=[615000, 616000]
cambio2 (INSERT)  tRowLocal=1558  tSyncAdvance=1558  tUi=1558  distinctSyncMs=[616000, 623000]
cambio3 (rename)  tRowLocal=1538  tSyncAdvance=1538  tUi=1538  distinctSyncMs=[623000, 625000]
```
→ los 3 cambios ticaron al instante (~1,5 s); la señal avanzó 615→616→623→625.

**Corrida 2** (la reveladora):
```
baseline  syncMs=1784586732000  (1 rodeo)
cambio1 (INSERT)  tRowLocal=1548  tSyncAdvance=NUNCA  tUi=NUNCA  distinctSyncMs=[732000]   ← fila EN SQLite, señal CONGELADA ~90 s
cambio2 (INSERT)  tRowLocal=1563  tSyncAdvance=1563   tUi=1563   distinctSyncMs=[732000, 829000]  ← el 2º fuerza el checkpoint (732→829, salto de 97 s) que barre AMBOS
cambio3 (rename)  tRowLocal=1548  tSyncAdvance=1548   tUi=1548   distinctSyncMs=[829000, 831000]
```
→ el cambio 1 llegó al SQLite en 1,5 s pero `lastSyncedAt` **NO avanzó** durante los 90 s de sondeo; la
UI **no re-leyó** hasta que el cambio 2 forzó un checkpoint que barrió los dos de golpe.

### VEREDICTO: **SIGNAL problem (intermitente), NO delivery, NO latch permanente.**

- La fila **SIEMPRE** llega al SQLite local en ~1,5 s (6/6 cambios, INSERT y UPDATE) → la ENTREGA del
  dato **no** es el problema.
- `lastSyncedAt` avanza de forma **NO determinista por cambio**: a veces al instante (corrida 1), a
  veces un cambio se estanca hasta que un checkpoint POSTERIOR lo barre (corrida 2, cambio 1).
- El claim original **"`lastSyncedAt` deja de avanzar DESPUÉS del primer cambio"** es **FALSO** — la
  corrida 1 muestra CADA cambio ticando. Lo cierto: `lastSyncedAt` significa "último sync FULL
  completado", no "cambió un dato"; es el primitivo equivocado para reactividad y puede lagear detrás.
- **Nota de honestidad**: mi propio A/B sondea con `page.evaluate` cada 1,5 s (contención de main-thread)
  → puede AGRAVAR el estancamiento. Las sondas `[MED]/[MED2]` del spec original hacían lo mismo cada 2 s
  EN PARALELO al assert → hipótesis fuerte de que **las sondas se auto-inducían el flake que medían**.
  La conclusión (señal no determinista → hace falta `db.watch`) se sostiene igual: `lastSyncedAt` es
  semánticamente el proxy equivocado, independientemente de qué agrave el lag.

### `db.watch` — FLAGEADO para Raf (NO implementado)

El fix real es una **watched query** (`db.watch`) que reaccione al cambio del SQLite local en vez de a
la señal gruesa de status. Es EXPANSIÓN DE ALCANCE (3 consumidores + deuda de spec 15 "cero watched
queries") → **decisión de Raf**, NO la implementé. Documentado con la evidencia en `docs/backlog.md`
(reescribí el ítem, antes tenía el diagnóstico confundido) y en `design.md` §10-bis (g). La feature 20
arregla la RE-LECTURA (re-leer en CADA avance de la señal, que antes no pasaba nunca) y es estrictamente
mejor que el latch, pero **no puede** arreglar que la señal no tique por cambio.

## PRONG C — instrumentación temporal + comentarios mentirosos

- **Sacado** `__RAFAQ_PS__` de `database.ts` (exposición del DB local bajo marca E2E — era solo para el A/B).
- **Sacadas** las sondas `[MED]/[MED2]` del spec (bloques `page.evaluate` en paralelo en T18 y T19).
- **Retries**: primero los saqué (sobre-corrección) y los **RESTAURÉ** (`retries: 2`) tras la verificación
  independiente del leader (4/6 bajo carga). Header reescrito con la explicación HONESTA: el flake es la
  no-determinación de eventual-consistency probada por el A/B, con `db.watch` como fix de fondo flageado;
  el reviewer objetó los retries bajo el diagnóstico VIEJO/errado ("lastSyncedAt deja de avanzar" — falso),
  y por qué ahora son la herramienta ESTÁNDAR y honesta (ver la sección "Determinismo del E2E" abajo).
- **Corregido** el comentario de T18 (antes: "un segundo cambio no se ve… CO-observar dos cambios") y la
  narrativa de diagnóstico (design §10-bis (g), backlog).

## PRONG D — gaps de cobertura

- **R20.7/R20.8 guard `=== 0`**: el login es ONLINE primero → `lastSyncedMs > 0` para cuando el test
  corre → el guard de arranque-en-frío `=== 0` **NUNCA** se ejercita por E2E (un first-sync offline es
  imposible: PowerSync necesita conectarse). **Bajé el claim honestamente**: el guard `=== 0` es
  **inspección** (está en los 3 efectos); T22 prueba la otra mitad (señal CONGELADA → sin re-lectura
  espuria ni cambio de estado). Título y comentarios del test corregidos.
- **T18 rename (R20.19 sobre UPDATE)**: agregué el 2º cambio real (rename de un rodeo pre-existente vía
  service_role). El A/B mostró que multi-cambio funciona y que **asertar el estado final combinado es
  MÁS robusto** que un solo cambio (el cambio posterior fuerza el checkpoint que barre el anterior si se
  estancó). Prueba que la re-lectura refleja UPDATES, no solo INSERTS.

## PRONG E — bookkeeping

- `tasks.md` **T25 tildado `[x]`**: verde honesto = sin SONDAS + con `retries: 2` legítimos (herramienta
  estándar de eventual-consistency, diagnóstico A/B corregido) + forzador/timeouts. Resultados de TODAS
  las corridas abajo (sin cherry-pick). (Antes lo dejé `[ ]` mientras exploraba "sin retries"; esa apuesta
  falló bajo carga (leader 4/6) → restauré los retries.)
- `requirements.md` §6: **R20.33/R20.34 SACADOS de la línea E2E** (son unit + inspección, no alcanzables
  por E2E); agregada la línea "Unit + inspección" que lo aclara. T18 anotado como multi-cambio.
- `tasks.md` **T21 punto 4** reconciliado: el switch-durante-diferimiento NO es alcanzable por E2E → unit
  (`shouldEmitDeferredRevocation`) + inspección. **T18** actualizado al multi-cambio real.

## PRONG F — 3 decisiones de código

1. **`RodeoContext.tsx` rutea por `assessDisappearance`** (antes `if (evidence !== 'active') return;`
   inline). Ambos contextos comparten UN camino de veredicto. Para rodeos, el establecimiento sigue
   "presente" sii el rol local está activo (`stillPresent = evidence === 'active'`); se concluye
   `no_rodeos` solo con `'present'`; `'confirmed'` (revocación → protege D1) y `'inconclusive'`
   (ilegible → fail-safe R20.30) conservan. **Behavior-idéntico** al inline previo — verificado con
   tabla de verdad + 3 unit tests nuevos (R20.18 active→concluye, absent→conserva, unknown→conserva).
   NO rompe el bootstrap (la guarda sigue acotada a `protectingResolved`).
2. **`lotes.tsx` guard de equivalencia** (`sameManagementGroups`): la re-lectura reactiva corre en cada
   checkpoint → sin guard, cada uno re-renderizaba toda la pantalla con un array nuevo. Mismo patrón que
   los contextos.
3. **`refreshEstablishments` 6º llamador reconciliado**: los **5 PRE-EXISTENTES** quedan intactos
   (editar-campo, invite, mas ×2, applyCreatedEstablishment); feature 20 agrega **2 invocaciones
   internas** (efecto reactivo :515 + refresh post-switch de R20.34 :405). Comentario del contexto
   corregido (antes decía "5 llamadores intactos" a secas, omitiendo las 2 nuevas).

## Autorrevisión adversarial (T23) de la remediación

- **F1 behavior-idéntico**: tabla de verdad + unit tests. El race-guard `targetRef` queda antes del
  veredicto (intacto); no agrega await nuevo; `hasActiveLocalRole` solo devuelve los 3 valores cubiertos.
- **F2 no traga cambios reales**: `ManagementGroup` es solo `{id,name}` → comparar id+name+orden es la
  comparación completa; `prev===null`→emite; los updates optimistas usan `setGroups(fn)` directo (no
  pasan por el guard); el reconcile idéntico→skip / distinto→emite (cero regresión: el código viejo
  siempre re-renderizaba).
- **T18 no tiene falso verde**: el old-name-gone assert corre DESPUÉS del renamed-visible (misma
  `applyRodeos` atómica → nunca ambos a la vez); `toHaveCount(0)` auto-retrya; R20.19 (`activoDespues ===
  rodeoId`) — el rename toca OTRO rodeo, el activo nunca se toca.
- **Instrumentación**: `grep` confirma cero `__RAFAQ_PS__` en `src/` y cero `MED`/`retries`/`console.log`
  de código en el spec (solo comentarios explicativos). Typecheck 0 errores.

## Trazabilidad — cambios respecto del writeup pre-rechazo

- **R20.2** (T18): ahora multi-cambio (INSERT + UPDATE/rename) → cubre re-lectura de INSERTS **y** UPDATES.
- **R20.7/R20.8**: el guard `=== 0` es **inspección** (no alcanzable por E2E post-login); T22 cubre la
  señal congelada.
- **R20.18** (RodeoContext): ahora vía `assessDisappearance` compartido + 3 unit tests nuevos en
  `establishment.test.ts` (`rodeoConcludesNoRodeos`).
- **R20.33/R20.34**: unit (`shouldEmitDeferredRevocation`) + inspección, NO E2E (reconciliado en specs).

## Determinismo del E2E: forzador de sync + `retries: 2` (ambos honestos) — corrección de sobre-corrección

**Corrección importante (2026-07-20, tras verificación independiente del leader).** Yo había SACADO
`retries: 2` y apostado a "solo forzador". El leader corrió el spec de forma independiente bajo CARGA
REAL y me marcó **4/6, no 6/6**: falló el rename UPDATE de T18 (no re-leído en 30 s) y el aviso de T20
(no en 150 s). Mis 2 corridas verdes (run 5/6) fueron en una ventana de carga baja — **me sobre-corregí**.

El REFRAME es correcto y lo acepto: el reviewer rechazó los retries porque enmascaraban un flake **MAL
DIAGNOSTICADO** ("lastSyncedAt deja de avanzar" — un latch permanente, que el A/B mostró FALSO). Con el
diagnóstico CORREGIDO —no-determinación INHERENTE de eventual-consistency, documentada, con `db.watch`
flageado— **los retries son la herramienta ESTÁNDAR y honesta para E2E de eventual-consistency**: NO
tapan un bug, cubren el FREEZE PATOLÓGICO de la señal re-corriendo con una sesión fresca. Los oráculos
siguen estrictos: un bug real falla las 3 veces.

Estrategia final (dos capas, ambas honestas):

- **Capa 1 — forzador/timeout para BAJAR la frecuencia de retry** (medido, no supuesto):
  - **ADICIONES (T17/T18/T19) → `syncUntil` (blip-poll de red).** `context.setOffline` off→on →
    PowerSync reconecta → checkpoint FRESCO → la fila ya presente en el servidor baja → re-lectura
    PASIVA. Presupuesto ampliado para el rename UPDATE de T18 (`blips: 16`). NO es reload.
  - **REVOCACIONES (T20/T21) → tick NATURAL con timeout AMPLIO (~120 s, cubre el freeze de ~90 s del
    A/B), SIN blip.** Un blip (reconnect) DISRUPTA la propagación de una remoción de bucket (medido: con
    blip T20 se estancaba >100 s). **T20 usa `revokeSession: false`** (camino campo-borrado, E5) porque
    revocar la sesión también disrupta la propagación; el camino con sesión revocada + su ventana D1.2 lo
    cubre **T21** (`revokeSession: true` + `assertServerSessionsRevoked`).
- **Capa 2 — `retries: 2` (file-level)** con header honesto: cubre el residual (el freeze patológico que
  supera el timeout por-intento). Re-corre con sesión fresca (sync activo → propaga rápido).

Hallazgo transversal (refuerza el flag de `db.watch`): la revocación de sesión y el blip de reconnect
DISRUPTEN la propagación de una revocación; la conexión estable la entrega mejor — otra cara de que
`lastSyncedAt` es el primitivo equivocado. **`db.watch` borraría forzador Y retries.**

### Verificación E2E — TODAS las corridas, honestas (no cherry-pick)

Diagnóstico de estrategias (con las descartadas, para dejar la MEDICIÓN):
- Independiente del leader (carga real): **4/6** con "solo forzador, sin retries" → gatilló esta corrección.
- Corridas mías con estrategias descartadas: run 1 4/6, run 3 5/6, run 4 5/6 (blip en revocaciones /
  `revokeSession:true`+blip); run 5 6/6, run 6 6/6 (carga baja, sin retries — engañosas: no probaban nada
  bajo carga).

**Config final (`retries: 2` + forzador/timeouts ampliados) — resultados REALES:**
- **Run A: 6/6 verde (1.4 m)** — todos al 1er intento (sin retry).
- **Run B: 6/6 verde (1.4 m)** — todos al 1er intento.
- **Run C: 6/6 verde (1.3 m)** — todos al 1er intento.
- **Stress `--repeat-each=2` (12 ejecuciones): 11 passed + 1 FLAKY, 0 fallos reales (exit 0, 5.4 m).** La
  ejecución 8 (T18 rodeo, rename UPDATE) se CONGELÓ 2,6 m en el 1er intento y el **retry #1 pasó en
  11,9 s** → demostración directa de que el retry RECUPERA el freeze patológico, como está diseñado.
  NINGÚN caso falló los 3 intentos (retry + 2) → los retries ALCANZAN; no hay evidencia de que `db.watch`
  sea urgente más allá del flag ya levantado.

Honestidad sobre la carga: A/B/C corrieron con carga baja (no gatillaron retry — no "probaban" el residual
por sí solas); el stress-run SÍ reprodujo el freeze bajo carga y mostró el retry recuperándolo. La
combinación (3 corridas limpias + 1 stress con freeze recuperado por retry) es la evidencia honesta de
verde CONFIABLE. Si en el futuro algún caso fallara los 3 intentos, sería evidencia de que `db.watch` hace
falta YA (escalar a Raf) — hoy no ocurrió.

- Unitarios confiables: **238 passed / 0 failed** (`establishment.test.ts` + `local-reads.test.ts`).
- Typecheck del cliente: **0 errores**.
- NO se corrió `e2e:report` ni el build-de-capturas (las corridas de spec puro no churnean `design/**`).

## Pendiente para el leader / Raf (flag)

1. **`db.watch` — EXPANSIÓN DE ALCANCE, decisión de Raf.** La evidencia A/B es un argumento fuerte para
   migrar los 3 consumidores (y a la larga toda la app) a watched queries. NO lo implementé (fuera de
   alcance). Documentado en `docs/backlog.md` (ítem reescrito) + `design.md` §10-bis (g). **El forzador +
   `retries: 2` del E2E son un andamio hasta que exista `db.watch`**: con `db.watch` los tests asertarían
   directo, sin forzador NI retries. El stress-run mostró el freeze real (T18 2,6 m) recuperado por retry;
   ningún caso falló los 3 intentos → los retries alcanzan HOY, pero la deuda de fondo es `db.watch`.
2. **`check.mjs` WIP=1**: sigue siendo coordinación del leader (16 + 20 en `in_progress`). No lo toqué.
3. Feature 04 (BLE) sigue sin commitear en el mismo árbol — no la toqué.
</content>
