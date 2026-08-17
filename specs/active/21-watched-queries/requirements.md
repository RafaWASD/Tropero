# Requirements — feature 21: watched queries (`db.onChange` / `useQuery`) para reactividad real

> **Estado**: `spec_ready` (redactada 2026-07-21 por `spec_author`).
> **Fuente de verdad**: `specs/active/21-watched-queries/context.md` (Gate 0 aprobado por Raf, 2026-07-21).
> Las decisiones **D1, D2, D3, D4** del context son vinculantes y ya están cerradas — esta spec las traduce a EARS, no las re-decide.
> **Notación**: EARS estricto (`docs/specs.md`). IDs `R21.<n>` estables — no reordenar después de aprobar.
> **Relación con la 20**: esta feature **cambia solo el disparador** de los 3 consumidores; la lógica de resolución `R20.*` se preserva entera. Ver `docs/adr/ADR-030-watched-queries-reactividad.md`.

---

## 0. Alcance en una línea

Los 3 consumidores de la feature 20 (`EstablishmentContext`, `RodeoContext`, `lotes.tsx`) pasan de disparar la re-lectura sobre `lastSyncedAt` (señal de sync gruesa, proxy NO determinista del cambio de dato — probado ~90 s+ de lag) a **watched queries reales de PowerSync** que reaccionan al cambio del **SQLite local** (~1,5 s determinista): `db.onChange` imperativo en los 2 contextos (el `onChange` re-corre la resolución que ya existe) y `useQuery` en `lotes.tsx` (la lista se vuelve reactiva). Sin cambiar firmas públicas, sin tocar RLS/streams/migraciones, sin migrar el resto de la app.

**Fuera de alcance (explícito, no negociable)**: las 5 pantallas focus-only del backlog (`miembros`, `use-reports`, `animal/[id]`, `export-sigsa`, `maniobra`) y el resto de la app — se migran después con el patrón ya establecido (ADR-030, migración incremental). La frontera de autorización real (RLS `has_role_in`, streams `sync-streams/mitropero.yaml`) NO se toca. La feature 04/BLE NO se toca.

---

## 1. El disparador pasa a watched query (A1, D1)

**R21.1** — Cuando cambie alguna fila local de las tablas que respaldan las membresías del usuario (`user_roles`, `establishments`), el sistema deberá re-ejecutar la resolución de membresías de `EstablishmentContext`.

**R21.2** — Cuando cambie alguna fila local de las tablas que respaldan los rodeos del establecimiento activo (`rodeos`, `user_roles`), el sistema deberá re-ejecutar la carga de rodeos de `RodeoContext`.

**R21.3** — El sistema deberá derivar la lista de lotes de `lotes.tsx` de una watched query (`useQuery`) sobre `management_groups`, de modo que la lista refleje el estado del SQLite local de forma reactiva.

**R21.4** — El sistema no deberá disparar las re-lecturas de R21.1/R21.2/R21.3 a partir del avance de `lastSyncedAt` (queda prohibido el disparador por la señal de sync gruesa en los 3 consumidores).

**R21.5** — El disparador de `EstablishmentContext` y `RodeoContext` deberá ser el callback `onChange` de una watched query imperativa de PowerSync (`db.onChange(handler, { tables })`), registrada dentro de un efecto y liberada con la función de disposición que el método devuelve, al desmontar o al cambiar sus dependencias.

**R21.6** — El disparador de `lotes.tsx` deberá ser el hook `useQuery` de `@powersync/react`, que provee `data`, `isLoading` y `error` de forma reactiva al cambio del SQLite local.

### 1.1 `lotes.tsx` — estado vacío vs. sincronizando (veto de design-review)

> Con `useQuery` como única fuente, un campo **con** lotes que todavía no sincronizaron (primer sync / device nuevo / login fresco) devolvería `data = []` local con `isLoading = false` → se mostraría "Este campo todavía no tiene lotes" durante ~1,5 s+ antes de que aparezcan: un **falso vacío**. La feature 20 lo evitaba (`fetchManagementGroups` con `emptyIsSyncing: true`). No se puede regresar en este estado de alto impacto.

**R21.32** — Mientras el primer sync del campo activo no haya completado y la lista de lotes de `useQuery` esté vacía, el sistema deberá mostrar el estado "sincronizando" y no deberá mostrar el estado "sin lotes".

**R21.33** — Cuando el primer sync del campo activo haya completado y la lista de lotes de `useQuery` esté vacía, el sistema deberá mostrar el estado "sin lotes" (vacío genuino).

**R21.34** — El sistema deberá derivar la desambiguación de R21.32/R21.33 del estado de sync (`useStatus().hasSynced`), reintroducido en `lotes.tsx` **únicamente** como affordance del estado vacío; `useStatus` no deberá volver a ser el disparador de la reactividad de la lista (eso lo hace `useQuery`).

---

## 2. D2 — la detección de revocación pasa a watched query sobre `self_user_roles` (A2)

**R21.7** — La watched query de `EstablishmentContext` deberá observar la tabla local `user_roles` (que porta las filas de la stream `self_user_roles`), de modo que una transición del rol propio a `active = 0` dispare la re-evaluación apenas la fila baje al SQLite local.

**R21.8** — Cuando el rol propio sobre el campo activo pase a `active = 0` en el SQLite local y el usuario no esté dentro del flujo de maniobra, el sistema deberá emitir `active_lost` sin esperar el avance de `lastSyncedAt`.

**R21.9** — La watched query de `RodeoContext` deberá observar `user_roles` además de `rodeos`, para que la guarda de evidencia afirmativa que sostiene D1 (R20.18) se re-evalúe apenas cambie el rol, aunque la remoción del bucket de rodeos llegue en un checkpoint distinto que la baja del rol.

---

## 3. La lógica de resolución de la 20 se preserva (A3, E1, E5, D1)

**R21.10** — El `onChange` de `EstablishmentContext` deberá re-ejecutar la resolución existente de la feature 20 (`refreshEstablishments` → `applyMembershipsResult` → `applyMemberships` → `confirmDisappearance`) sin modificar su lógica de veredicto: solo cambia el disparador.

**R21.11** — El `onChange` de `RodeoContext` deberá re-ejecutar la carga existente (`load` → `applyRodeos`, incluida la guarda de evidencia afirmativa de R20.18 acotada a "proteger un estado ya resuelto para el mismo campo") sin modificar su lógica de veredicto.

**R21.12** — El sistema deberá conservar la regla de evidencia afirmativa (`assessDisappearance`): concluir revocación únicamente cuando la fila local de rol del usuario esté ausente o tenga `active = 0`, con independencia del disparador que provocó la re-lectura.

**R21.13** — El sistema deberá conservar el diferimiento D1 (no pasar `EstablishmentContext` a `active_lost` mientras haya una maniobra en curso, con emisión al salir) con el nuevo disparador.

**R21.14** — El sistema deberá conservar el copy de E5 de `campo-perdido.tsx` (verdadero para revocación de rol y para campo borrado) sin cambios.

**R21.15** — El sistema no deberá modificar ninguna firma pública de contexto (`EstablishmentContextValue`, `RodeoContextValue`, `EstablishmentState`, `RodeoState`, `ActiveLostReason`), ni ninguna migración, RLS policy o sync stream.

**R21.35** — El sistema deberá conservar la carga inicial de `EstablishmentContext` y `RodeoContext` en su efecto de bootstrap existente (separado del efecto reactivo), de modo que el estado y las listas aparezcan al montar sin depender del disparo de la watched query (`db.onChange` no dispara al registrarse porque `triggerImmediate` es `false`). El único efecto que se reemplaza en cada contexto es el reactivo (el que dependía de `lastSyncedMs`).

---

## 4. E1 — sin falso `active_lost` / `no_rodeos` con el disparador más frecuente

> El disparador nuevo (`onChange`) reacciona en **cada** cambio de las tablas observadas, posiblemente MÁS seguido que `lastSyncedMs` (que solo ticaba en checkpoints completos y de forma no determinista). La spec debe garantizar que un estado intermedio no se lea como "perdiste acceso" con el disparo más frecuente. La evidencia afirmativa de la 20 lo cubre; acá se afirma que sigue valiendo.

**R21.16** — Cuando una watched query dispare sobre un estado transitorio (el activo desaparecido de un checkpoint pero con el rol propio todavía `active = 1`, o un set momentáneamente vacío), el sistema no deberá concluir `active_lost` ni `no_rodeos` salvo que la evidencia afirmativa lo confirme.

**R21.17** — Cuando la evidencia afirmativa resulte `active` o `unknown` ante una desaparición, el sistema deberá mantener el estado vigente y re-evaluar en el próximo disparo de la watched query, sin introducir ningún temporizador ni contador.

**R21.18** — El sistema deberá apoyar la garantía de R21.16 en que PowerSync aplica cada checkpoint como una transacción consistente sobre el SQLite local (sin prioridades declaradas en `sync-streams/mitropero.yaml`), de modo que ningún disparo de la watched query observe un set de buckets a medio aplicar.

---

## 5. E2 — thrash / doble disparo

**R21.19** — El sistema deberá componer los guards de equivalencia de la feature 20 (`sameResolvedEstablishmentState`, `sameRodeoState`, `sameEstablishmentList`, `sameRodeo`) con el `onChange`, de modo que un disparo que resuelva a un estado equivalente al vigente sea un no-op observable (sin emitir estado nuevo ni re-renderizar la app).

**R21.20** — `lotes.tsx` deberá evitar el re-render ante un resultado de `useQuery` equivalente al vigente usando el `rowComparator` diferencial del hook, que reemplaza el guard manual `sameManagementGroups`.

**R21.21** — La watched query deberá coalescer las ráfagas de cambios de tabla mediante el throttle (trailing) del SDK, evitando N re-ejecuciones por una ráfaga de cambios de un mismo checkpoint.

---

## 6. E3 — offline puro

**R21.22** — Mientras no haya cambios en las tablas locales observadas (app quieta y/o sin red), el sistema no deberá disparar ninguna re-lectura ni cambio de estado (el `onChange` solo dispara ante un cambio real de tabla; sin cambios, no dispara).

**R21.23** — Si una watched query dispara sin conectividad (por un cambio local del propio usuario), el sistema deberá emitir el estado local vigente y no deberá concluir en contra del usuario (mismo fail-safe de evidencia afirmativa, R21.12).

---

## 7. E4 — la ventana de propagación de revocación no se acelera

**R21.24** — El sistema no deberá afirmar (en copy de UI ni en documentación) que la revocación de UI es instantánea bajo conectividad intermitente: la watched query reacciona apenas la remoción llega al SQLite local, pero la ENTREGA la gobierna el servicio de sync y la frontera real de acceso sigue siendo RLS server-side.

**R21.25** — El sistema no deberá pretender acelerar la entrega de la remoción de bucket: la watched query elimina el lag de la señal `lastSyncedAt`, no la latencia de propagación del servicio.

---

## 8. D3 — reconciliación de la E2E de la feature 20 (A4)

**R21.26** — La E2E `app/e2e/reactividad-sync.spec.ts` deberá aseverar la reactividad de forma directa, sin `test.describe.configure({ retries })`.

**R21.27** — La E2E deberá eliminar el forzador de blip de red (`forceSyncTick` / `syncUntil`) usado para las adiciones, aseverando el cambio server-side sin forzar checkpoints.

**R21.28** — Los oráculos de la E2E deberán permanecer estrictos: la reactividad determinista los cumple sin aflojar ningún assert.

**R21.29** — La E2E deberá conservar los casos y garantías de la feature 20 (campo/rodeo/lote en caliente, revocación fuera y dentro de la maniobra, offline puro); lo único que se saca son los `retries` y el forzador, y lo único que se puede ajustar son los timeouts por-assert (el lag de señal de ~90 s desaparece).

---

## 9. D4 — migración incremental + ADR (A5)

**R21.30** — El sistema deberá migrar a watched queries únicamente los 3 consumidores de la feature 20 (`EstablishmentContext`, `RodeoContext`, `lotes.tsx`) y no deberá tocar las 5 pantallas focus-only ni el resto de la app, conforme al plan de migración incremental de ADR-030.

**R21.31** — El `design.md` deberá referenciar ADR-030 (patrón de watched queries + plan de migración) y reconciliar la nota de "cero watched queries" de `specs/active/15-powersync/design.md` (pasa de deuda total a "los 3 consumidores migrados; el resto pendiente").

---

## 10. Trazabilidad — criterios de aceptación → requisitos

| # | Criterio de aceptación (`feature_list.json`, id 21) | Requisitos |
|---|---|---|
| A1 | Un cambio server-side (campo/rodeo/lote de un coworker) aparece en ~1,5 s determinista, sin depender de que `lastSyncedAt` tique. | R21.1, R21.2, R21.3, R21.4, R21.5, R21.6, R21.32, R21.33, R21.34, R21.35 |
| A2 | La detección de revocación (rol propio a `active = 0`) dispara el aviso de campo-perdido apenas la fila baja al SQLite, sin el lag de ~90 s+. | R21.7, R21.8, R21.9 |
| A3 | La lógica de resolución de la 20 se preserva: E1, diferimiento D1, copy de E5. | R21.10–R21.18 |
| A4 | La E2E de la 20 pasa a determinista SIN retries ni forzador de blip (reconciliada). | R21.26, R21.27, R21.28, R21.29 |
| A5 | ADR del patrón de watched queries + plan de migración incremental. | R21.30, R21.31 |

**Cobertura de los "Casos y decisiones" del `context.md`** (§4 y §5, regla de `docs/specs.md`):

| Caso / Decisión | Requisitos que lo cubren |
|---|---|
| D1 — `db.onChange` en los 2 contextos + `useQuery` en `lotes.tsx` | R21.1, R21.2, R21.3, R21.5, R21.6, R21.10, R21.11, R21.35 |
| Design-review — estado vacío vs. sincronizando en `lotes.tsx` | R21.32, R21.33, R21.34 |
| Correctitud — carga inicial al montar (bootstrap separado del reactivo) | R21.35 |
| D2 — watched query de revocación sobre `self_user_roles` | R21.7, R21.8, R21.9 |
| D3 — sacar retries + forzador de la E2E de la 20 | R21.26, R21.27, R21.28, R21.29 |
| D4 — ADR del patrón (ADR-030) | R21.30, R21.31 |
| E1 — falso `active_lost` por estado transitorio bajo disparo más frecuente | R21.16, R21.17, R21.18, R21.12 |
| E2 — doble disparo / thrash | R21.19, R21.20, R21.21 |
| E3 — offline puro | R21.22, R21.23 |
| E4 — la ventana de propagación de revocación no se acelera | R21.24, R21.25 |

---

## 11. Verificabilidad

Cada `R21.<n>` tiene ≥1 test o inspección asignada en `tasks.md`. Resumen del tipo de prueba:

- **Inspección de wiring verificada por el reviewer** (el cambio es de DISPARADOR, no de lógica pura): R21.1, R21.2, R21.3, R21.4, R21.5, R21.6, R21.7, R21.9, R21.10, R21.11, R21.15, R21.18, R21.21, R21.30, R21.31, R21.34, R21.35 — el disparador nuevo, las tablas observadas por consumidor, la disposición del listener, la ausencia de `lastSyncedAt` como dep, que la carga inicial vive en el bootstrap separado, que `useStatus` en `lotes.tsx` es solo affordance del vacío, y que ninguna firma pública/RLS/stream cambió.
- **E2E del estado vacío vs. sincronizando** (`lotes.tsx`): R21.32, R21.33 — un campo con lotes aún sin sincronizar muestra "sincronizando" (no "sin lotes"); un campo sincronizado sin lotes muestra "sin lotes". La carga inicial al montar (R21.35) se cubre por los E2E de lotes existentes (la lista aparece al entrar a `/lotes`) + inspección del bootstrap.
  > **RECONCILIACIÓN al as-built (implementer, 2026-07-21).** **R21.33** (campo SINCRONIZADO sin lotes → "sin lotes") se cubre con un E2E DETERMINISTA nuevo en `app/e2e/lotes.spec.ts` (`campo sincronizado sin lotes → "sin lotes" (no "Sincronizando…"), R21.33`): tras `waitForHome` el first-sync ya completó (`hasSynced=true`), así que `useQuery` con `data=[]` cae en el vacío genuino — se asserta el copy owner y que NO aparecen "Sincronizando…" ni "Cargando lotes…". **R21.32** (campo CON lotes aún sin sincronizar → "Sincronizando…", NO "sin lotes") se cubre por **INSPECCIÓN del orden de ramas del display** (design §3.3: `groups.length===0 && !hasSynced` → `SYNCING_MESSAGE`, ANTES de la rama de vacío genuino), NO por E2E: ese estado solo existe en la ventana del PRIMER sync (una vez `hasSynced=true` nunca vuelve a `false`), así que catchearlo en E2E sería inherentemente RACY — y esta feature justamente elimina la no-determinación, no la reintroduce en su propia suite. El fail-safe es en la dirección segura (mostrar "Sincronizando…" de más nunca miente "sin lotes").
- **Unitarios puros ya existentes de la feature 20** (`establishment.test.ts` — `assessDisappearance`, `shouldEmitDeferredRevocation`, `sameResolvedEstablishmentState`, `sameRodeo`): R21.12, R21.13, R21.16, R21.17, R21.19 — la lógica de veredicto y los guards de equivalencia NO cambian, así que su suite sigue verde y es la que garantiza que la resolución preservada es correcta.
- **E2E (Playwright, `./helpers/fixtures`), determinista y SIN retries/forzador**: R21.1/A1 (campo/rodeo/lote en caliente), R21.8/A2 (revocación → aviso apenas baja la fila), R21.13 (revocación en maniobra → no patea, avisa al salir), R21.20 (la lista de lotes no se blanquea), R21.22/R21.23 (offline puro), R21.26, R21.27, R21.28, R21.29.
- **Inspección / documentación**: R21.14 (copy de E5 intacto), R21.24, R21.25 (el copy/spec no prometen revocación instantánea; la frontera real es RLS).
</content>
</invoke>
