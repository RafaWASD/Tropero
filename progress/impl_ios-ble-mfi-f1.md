# impl — delta `ios-ble-mfi`, **Fase F1** (T1.1 … T1.9)

baseline_commit: b28bfe36108e6efb675c8fe1861784b2facb2543

**Spec**: `specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md` (aprobada en Puerta 2, 2026-08-17).
**Alcance de esta sesión**: SOLO la Fase F1 (`T1.1`–`T1.9`). Nada de F0/F2…F8.
**Estado en `feature_list.json`**: `04-bluetooth-baston` figura `deferred` (no `in_progress`). No lo toco (límite duro del
despacho). Es el mismo estado bajo el que se implementó y commiteó el delta `multivendor` (`acec3cd`): un delta-spec
ADR-028 Nivel B corre su propio mini-ciclo sobre una feature cuyo core ya está cerrado. Lo dejo declarado acá para que el
reviewer lo vea y no lo lea como precondición saltada en silencio.

**Gate 1 (N/A, RBM9.1/RBM9.2)** — verificado con el oráculo ATRIBUIBLE, cruzado contra la lista de archivos de F1:

```
$ git status --porcelain supabase/ sync-streams/          # 2026-08-17, HEAD 80c7022
 M supabase/functions/_shared/{cors,serve,supabase}.ts
 M supabase/functions/{accept_invitation,change_member_role,delete_account,remove_member}/index.ts
 M supabase/tests/audit/run.cjs
?? supabase/functions/_shared/request-headers.ts   ?? …/request-headers.test.ts
?? supabase/migrations/0133_rename_audit_headers_mitropero.sql
                                                          # sync-streams/ → 0 líneas
```

**11 líneas bajo `supabase/`, NINGUNA de F1**: son de la otra terminal (unidad *rebrand fase 5 — headers*
`X-Rafaq-*` → `X-Mitropero-*`; corroborado por su propio bloque en `scripts/run-tests.mjs`, por
`?? progress/rebrand-fase5-headers.md` y por los `src/services/{account,members,push-notifications}.ts` +
`src/utils/request-id.ts` + `app/invitar.tsx` modificados, que tampoco son míos). Ninguna aparece en la lista
de archivos de F1 del final de este informe. `sync-streams/` intacto → **Gate 1 N/A**.

> ⚠️ **Corrección del review (🟡-3).** Este informe decía *"`git diff --stat supabase/ sync-streams/` →
> **vacío**"*, y era **doblemente incorrecto**: (a) RBM9.2/T8.8 **prohíben ese comando por escrito** —mide el
> ÁRBOL y no el cambio, y es CIEGO a los untracked—; (b) la afirmación es **falsa** en el árbol de hoy: ese
> comando devuelve 8 archivos / 166 inserciones, y el untracked `0133_rename_audit_headers_mitropero.sql`
> —justo el caso que la spec cita— no lo ve. La conclusión (Gate 1 N/A) se sostiene, pero con el oráculo de
> arriba: lo que había era una verificación no atribuible presentada como verificación.

---

## Plan (las tasks son el contrato literal)

- [x] T1.1 `stick-adapter.ts`: `readonly driver?: ReaderDriver` (aditivo, ningún método cambia) — RBM1.3
- [x] T1.2 `contract.ts`: el parser entra por parámetro **requerido**; se elimina el import de `parseRs420Line` — RBM1.1/1.2/1.8
- [x] T1.3 `adapter-selection.ts`: `resolveFrameParser(adapter)` puro, fail-closed — RBM1.4
- [x] T1.4 `adapter-web-serial` / `adapter-spp-android`: `RS420_DRIVER` por defecto, expuesto por `driver` — RBM1.5
- [x] T1.5 provider: call site pasa el parser resuelto; `null` + `raw-line` → descarta + loguea `parser_unresolved` — RBM1.1/1.4
- [x] T1.6 `frame-parser-resolve.test.ts`: exhaustivo sobre `ADAPTER_KINDS` — RBM1.4
- [x] T1.7 aditividad real: driver sintético con OTRO formato de trama, ingerido end-to-end — RBM1.6
- [x] T1.8 guards + mutantes falsificados — RBM1.7
- [x] T1.9 `tsc --noEmit` enumera los call sites — RBM1.2

## Bitácora (se escribe A MEDIDA, no al final)

### Lectura del as-built (antes de tocar nada)

Hechos verificados contra el código (no contra la spec):

- `contract.ts:16` importa `parseRs420Line, isValidTag, normalizeTag` de `./parser-rs420`; `:36` llama `parseRs420Line`
  dentro de `ingestRawLine`. Coincide con lo que el design §3 afirma. ✔
- Call sites de `ingestRawLine`/`processRawLine` en **código de producción** (los que el typecheck va a enumerar):
  `BleStickListenerProvider.tsx:213` y `app/app/baston-test.tsx:176` (pantalla dev del harness web-serial). El design
  solo nombraba el primero → el segundo es un hallazgo de esta fase, no una adivinanza.
- Call sites en **tests** (el typecheck NO los ve: `app/tsconfig.json` excluye `**/*.test.ts`): `contract.test.ts`,
  `adapter-web-serial.test.ts`, `offline-noread.test.ts`. Hay que actualizarlos a mano o el runtime revienta con
  `frameParser === undefined` sin que `tsc` diga una palabra.
- `SppAndroidAdapter` YA tiene `private readonly driver: ReaderDriver = RS420_DRIVER` (constructor, RMV5.2): T1.4 para
  ese adapter es hacerlo **público de solo lectura**, no agregarlo. `WebSerialAdapter` no tiene driver: hay que
  agregárselo.
- Restricciones de los guards ya existentes que condicionan CÓMO se escribe el fix (leídas antes de escribir):
  - `read-dispatch.test.ts` → `HOT_PATH_CALLABLE`: todo nombre invocado dentro de `handleReading` tiene que estar
    declarado en esa tabla. ⇒ `resolveFrameParser` **no** puede llamarse dentro de `handleReading`; se resuelve una vez
    en el efecto de wiring y entra por parámetro.
  - `read-dispatch.test.ts` → `handleReadingBody()` matchea `const handleReading = useCallback\(\([^)]*\) => \{`:
    la lista de parámetros **no puede contener paréntesis** (nada de tipos función inline).
  - `read-dispatch.test.ts` → el motor de ingesta y el feedback tienen que seguir DESPUÉS del gate de consumidor.
  - `adapter-ingest-mode.test.ts` → el provider tiene que seguir delegando en `ingestModeFor(`.

### Qué quedó construido (as-built)

**La forma nueva, en tres piezas:**

1. `contract.ts` — `ingestRawLine(line, frameParser)` / `EidIngestEngine.processRawLine(line, frameParser, now?)`.
   El parámetro es **requerido y sin default** (un call site que se lo olvide NO COMPILA: es el mismo guard sobre la
   ausencia que `satisfies Record<AdapterKind, IngestMode>`). Se eliminó `parseRs420Line` del import; quedan
   `isValidTag`/`normalizeTag`, que son reglas del CONTRATO y se aplican a todo EID salga del parser que salga (RBM1.8).
   Se agregó un `try/catch` alrededor del `frameParser.parse(...)` y validación de la forma devuelta: el parser de un
   driver de tercero es código que no controlamos y un throw suyo mataba la ingesta hasta reconectar (el read-loop del
   SPP no atrapa — verificado en `SppAndroidAdapter.emitTag`).
2. `adapter-selection.ts` — `resolveFrameParser(adapter, onUnresolved)`, al lado de `ingestModeFor` (son las dos
   mitades de la misma decisión: por qué puerta entra la lectura y con qué se desframea).
3. `BleStickListenerProvider.tsx` — `readSourceFor(adapter)` resuelve `{kind, mode, frameParser}` **una vez por
   adaptador cableado** (no por bastonazo) y ese `ReadSource` viaja hasta el contrato. El fail-closed descarta y
   loguea `parser_unresolved` **antes** del feedback sensorial.

**Tres decisiones de diseño que el spec no fijaba, con su motivo (para el reviewer):**

| Decisión | Por qué |
|---|---|
| `resolveFrameParser` recibe el sink del aviso **inyectado y requerido** (`onUnresolved`), en vez de importar `logging.ts` | T1.3 la pide PURA y T1.6 pide "null + **log**". Las dos cosas se cumplen con el patrón que el repo ya tiene: `acceptingTargets(subscribers, onError)` en `read-dispatch.ts`. Ganancia real: el fail-closed se verifica **por comportamiento** con un espía, en vez de por un regex sobre el provider. Requerido y no opcional-con-no-op porque un call site que se olvide del sink perdería la única señal de que el transporte no puede parsear nada. |
| El evento se loguea en **dos momentos** (`at:'mount'` y `at:'read'`) | T1.5 pide que el provider "descarte y loguee" (eso es por lectura) y T1.6 pide que la resolución avise (eso es una vez). Son diagnósticos distintos: `mount` = error de cableado, `read` = un bastonazo concreto que se perdió. El que hace diagnosticable "bastoneo y no pasa nada" es el de `read` — el guard exige los DOS por separado (con un solo `includes('parser_unresolved')`, borrar el de lectura dejaba el guard verde). |
| El parser se resuelve en el efecto de wiring y viaja en un `ReadSource`, en vez de resolverse dentro de `handleReading` | El camino caliente tiene una tabla CERRADA de invocables (`HOT_PATH_CALLABLE`, `read-dispatch.test.ts`): agregar `resolveFrameParser` ahí adentro sería trabajo por bastonazo y ruido en el único lugar donde una llamada nueva tiene que justificarse. Además el parser no cambia entre lecturas: es una propiedad del transporte montado. |

### T1.9 — el typecheck ENUMERA los call sites (no se adivinó ninguno)

Se corrió `tsc -p app/tsconfig.json --noEmit` con `contract.ts` ya migrado y **los call sites viejos** (se revirtieron a
propósito los dos archivos consumidores para que el compilador los listara):

```
app/app/baston-test.tsx(176,67): error TS2345: Argument of type 'number' is not assignable to parameter of type 'FrameParser'.
app/src/services/ble/BleStickListenerProvider.tsx(213,69): error TS2345: Argument of type 'number' is not assignable to parameter of type 'FrameParser'.
```

Dos, y los dos migrados. Con todo migrado: **`tsc … --noEmit` → EXIT=0**.

⚠️ **Lo que el typecheck NO enumera, y hubo que barrer a mano**: `app/tsconfig.json` **excluye** `**/*.test.ts`, así que
los call sites de los TESTS no rompen la compilación — habrían reventado en runtime con `frameParser === undefined`.
Se migraron los tres: `contract.test.ts`, `adapter-web-serial.test.ts`, `offline-noread.test.ts`.

### T1.8 — MUTANTES: cada guard falsificado rompiendo lo que vigila

Corridos con el script `mutants.py`/`mutants2.py` (scratchpad): aplican el mutante, corren las suites, y **restauran el
archivo en un `finally`**. Baseline y estado final verificados iguales (11 / 6 / 21 en verde).

| # | Mutante | `frame-parser-resolve` | `adapter-ingest-mode` | `contract.test` | Quién lo mata |
|---|---|---|---|---|---|
| **M1** | `contract.ts`: **fallback** `(frameParser ?? { parse: parseRs420Line })` + el import de vuelta ("por las dudas") | 🔴 10/1 — **solo** cae el GUARD estático | 🟢 6/0 | 🟢 21/0 | guard (i) |
| **M2** | provider: parser **inline** `{ parse: parseRs420Line }` en vez de `resolveFrameParser` | 🟢 **11/0** | 🔴 5/1 | 🟢 21/0 | guard (ii) |
| **M3** | `contract.ts`: **ignora el parámetro** y llama `parseRs420Line` (la llamada hardcodeada entera de vuelta) | 🔴 8/3 | 🟢 6/0 | 🔴 17/4 | guard (i) **+** T1.7 |
| **M4** | `resolveFrameParser` **fail-OPEN**: devuelve `RS420_DRIVER.frameParser` cuando no hay driver | 🔴 8/3 | 🟢 6/0 | 🟢 21/0 | los 3 tests de fail-closed (T1.6) |
| **M5** | provider: `RS420_DRIVER.frameParser` (el mutante *elegante*: fija el fabricante **sin nombrar el parser**) | 🟢 11/0 | 🔴 5/1 | — | guard (ii), regla del driver concreto |
| **M6** | provider: se borra el log del descarte **por lectura** (queda el de `mount`) | 🟢 11/0 | 🔴 5/1 | — | guard (ii), regla `at:'read'` |
| **M7** | `contract.ts`: el `frameParser` gana un **default** (los call sites dejan de romper el typecheck) | 🔴 10/1 | 🟢 6/0 | — | guard (i), regla "sin default" |

**La constancia que el despacho pide, explícita:** con **M2** puesto —el bug real de producción, el provider hablando un
solo formato de trama— el test de aditividad de T1.7 **queda en VERDE, junto con las 11 de su archivo**. Con **M1** —el
fallback silencioso dentro del contrato— el único test rojo de ese archivo es el GUARD ESTÁTICO: T1.7 **también sigue
verde**. Es la razón por la que los guards existen: el test de aditividad **no distingue el bug del arreglo** en los dos
mutantes que más se parecen a lo que alguien escribiría de buena fe. (M3, la versión burda, sí lo mata: se deja anotado
para no vender el guard como más necesario de lo que es.)

**Meta-guard**: `frame-parser-resolve.test.ts` incluye un test que verifica que el extractor de nombres de parsers de
fabricante **realmente encuentra `parseRs420Line`** derivándolo del árbol (`parser-*.ts`). Sin eso, un regex que no
matchea nada dejaría el guard en verde para siempre — el modo de falla que este repo ya se comió cuatro veces.

---

## Trazabilidad `RBM<n>` → test concreto

| Requisito | Archivo : test |
|---|---|
| **RBM1.1** el EID se extrae con el `frameParser` del driver del adapter | `contract.test.ts` : *"RBM1.1: ingestRawLine usa EL PARSER QUE SE LE PASA (no uno propio)"* · `frame-parser-resolve.test.ts` : *"RBM1.1: un kind `raw-line` CON driver devuelve EXACTAMENTE el frameParser de ESE driver"* |
| **RBM1.2** `contract.ts` no importa ni invoca un parser de fabricante; entra por parámetro | `frame-parser-resolve.test.ts` : *"RBM1.2/RBM1.7 (GUARD): `contract.ts` NO importa ni menciona el parser de ningún fabricante"* (incluye la exigencia del parámetro y la prohibición del default) + **el typecheck**, que es el que hace que un call site olvidado no compile (T1.9) |
| **RBM1.3** el driver se expone por `StickAdapter` de forma aditiva | `adapter-spp-android.test.ts` : *"RBM1.3/RBM1.5: el adapter EXPONE su driver (default RS420)…"* · `adapter-web-serial.test.ts` : *"RBM1.5: WebSerialAdapter expone el RS420 como driver por default"* · ningún método de la interfaz cambió (revisado a mano; el campo es `readonly … ?`) |
| **RBM1.4** fail-closed: `raw-line` sin driver → descarta + loguea, sin caer a un parser por defecto | `frame-parser-resolve.test.ts` : *"TODO kind `raw-line` SIN driver → null + aviso"*, *"el fail-closed NO devuelve el parser del RS420"*, *"TODO kind `eid` → null SIN aviso"*, *"un driver con `frameParser` roto…"* · **(fix del review)** el CAMINO DEL PROVIDER, por comportamiento: *"(readSourceFor): raw-line SIN driver → mode raw-line, parser NULL y UN aviso"*, *"(readSourceFor): CON driver … EXACTAMENTE el frameParser de ESE driver"*, *"(readSourceFor): EXHAUSTIVO sobre ADAPTER_KINDS"* · `adapter-ingest-mode.test.ts` : *"RBM1.7: el provider resuelve el parser POR EL DRIVER…"* (exige el log en `mount` **y** en `read`) · `wiring.test.ts` : el payload del evento se **ejecuta** |
| **RBM1.5** regresión: `web-serial` y `spp-android` no cambian de comportamiento | `contract.test.ts` (**21/21**, las mismas capturas reales de campo, ahora con el parser del RS420 pasado por parámetro) · `adapter-web-serial.test.ts` (**10/10**) · `adapter-spp-android.test.ts` (**103/103**, la máquina de estados entera intacta) · `offline-noread.test.ts` (**3/3**) |
| **RBM1.6** aditividad real de un driver con otro formato de trama | `frame-parser-resolve.test.ts` : *"RBM1.6: un driver NUEVO con otro formato se ingiere de punta a punta SIN tocar el contrato"* + su contraprueba *"los dos formatos son REALMENTE distintos"* |
| **RBM1.7** guards verificados MUTANDO lo que vigilan | tabla de mutantes de arriba (7/7 muertos por el guard que corresponde) **+ la segunda tabla del fix-loop (7 mutantes más, incluido MR1b)**. La mitad del provider ya NO depende de un regex: el oráculo que manda es el bloque (B) de comportamiento sobre `readSourceFor` |
| **RBM1.8** `isValidTag` + dedup + confirmación pre-commit se aplican a todo EID | `contract.test.ts` : *"RBM1.8: isValidTag se aplica igual venga el EID del parser que venga"* · `frame-parser-resolve.test.ts` : *"RBM1.8: el EID del driver nuevo pasa por la MISMA validación y la MISMA dedup"* |
| **RBM9.1 / RBM9.2** Gate 1 N/A | `git status --porcelain supabase/ sync-streams/` cruzado contra la lista de archivos de F1 → **0 líneas nuestras** (11 son de la otra terminal, detalle arriba). El `git diff --stat` que este informe citaba está **prohibido** por RBM9.2 y era **falso** (🟡-3 del review) |
| **RBM9.5** la carga manual nunca se bloquea | el `ManualAdapter` es modo `'eid'` → `resolveFrameParser` devuelve `null` **en silencio** y entra por `processEid`: el fail-closed del parser **no puede** tocar la puerta manual. Cubierto por el barrido exhaustivo de kinds `'eid'` |
| **RBM9.6** cero archivos de spec 09 | `git status --short app/src/features/animals` → **vacío** |

## Autorrevisión adversarial (paso 8 — antes del reviewer)

Qué busqué activamente, y qué encontré:

1. **Tests verdes midiendo la cosa equivocada.** Las aserciones de "devuelve el parser" se escribieron por **identidad**
   (`assert.equal(parser, DRIVER.frameParser)`), no por "hay algo": con `assert.ok(parser)` un fallback a RS420 pasaba.
   Los dos bucles exhaustivos tienen aserción **anti-vacuidad** (si ningún kind fuera `raw-line`, el `for` no probaría
   nada). El test de aditividad tiene la **contraprueba de que los dos formatos son distintos** — sin ella, un parser
   sintético que por casualidad entendiera la trama del RS420 lo dejaba verde con el bug puesto. Y el guard estático
   tiene su **meta-test** de que el extractor no está ciego.
2. **Call sites adivinados.** Encontrado: el typecheck **no ve los `.test.ts`** (los excluye `app/tsconfig.json`), así
   que los tres call sites de tests habrían reventado en runtime sin que `tsc` dijera nada. Barridos a mano y
   verificados corriendo las suites.
3. **El camino caliente.** `resolveFrameParser` NO entra en `handleReading` (tabla `HOT_PATH_CALLABLE`): se resuelve una
   vez por adaptador cableado. Verificado por el propio guard de `read-dispatch.test.ts`, que sigue verde.
4. **El fail-closed convertido en regresión.** El riesgo real de T1.4 es que el `driver` NO quede expuesto y el SPP
   —que hoy lee de verdad en device— caiga en el fail-closed y quede mudo. Por eso hay un test de identidad del driver
   por cada uno de los dos adaptadores de stream, no solo el resolutor.
5. **Un parser de tercero como superficie hostil.** El `frameParser` de un driver que no escribimos nosotros puede
   **tirar** o devolver una forma rara. El read-loop del transporte no atrapa (`SppAndroidAdapter.emitTag`), así que un
   throw mataba la ingesta hasta reconectar → se cerró con `try/catch` + validación de forma en `contract.ts`, con sus
   dos tests. **No estaba en el spec**: salió de esta pasada.
6. **Orden respecto del feedback sensorial.** El descarte por parser no resuelto sale **antes** de `playFeedback`: no se
   le confirma nada al operario por una lectura que no se pudo parsear. (Y sale **después** del gate de consumidor, así
   que si además no hay consumidor lo que se ve en el log es `read_dropped_no_consumer` — el diagnóstico del parser en
   ese caso lo da el evento de `mount`. Dicho para que no se lea como omisión.)
7. **Bundle / plataformas.** `adapter-web-serial.ts` ahora importa `RS420_DRIVER` (valor). No agrega **nada** al grafo
   de módulos de web: el provider ya importaba `adapter-spp-android`, que importa `driver-rs420` y `spp-protocol`, y los
   dos son puros (sin `react-native`). Verificado por grep, no por memoria.
8. **Offline-first (RBM9.4).** Cero red en todo lo tocado: el contrato, el resolutor y los drivers son puros y corren en
   `node:test` sin conectividad (`offline-noread.test.ts` lo afirma explícitamente y sigue verde).
9. **Multi-tenant.** Cero `establishment_id` en esta superficie: el EID entra al motor de spec 09, que no se tocó.

## Verificación

| Qué | Resultado |
|---|---|
| `tsc -p app/tsconfig.json --noEmit` | **EXIT=0** |
| `frame-parser-resolve.test.ts` (suite nueva) | **11/11** |
| `adapter-ingest-mode.test.ts` | **6/6** |
| `contract.test.ts` | **21/21** (eran 17 → +4 del parser por parámetro) |
| `adapter-spp-android.test.ts` / `adapter-web-serial.test.ts` / `offline-noread.test.ts` (regresión RBM1.5) | **103/103** · **10/10** · **3/3** |
| suites BLE afectadas juntas (contract, web-serial, offline-noread, ingest-mode, spp-android, read-dispatch, wiring, driver-registry, selection-priority) | **206/206** |
| **toda** la lista de `client unit tests` de `run-tests.mjs` (primera corrida) | 3133 pass / **1 fail** — el rojo NO es de F1, ver abajo |
| la misma lista **sin** `brand-name-guard.test.ts` | 3119/3119, 0 fail |
| **toda** la lista, corrida de cierre (con el rojo ajeno ya resuelto por la otra terminal) | **3135 / 3135, 0 fail** |
| `serve-log` + `audit_query` (suites puras de `supabase/`) | **36/36** |
| **`node scripts/check.mjs` completo** (typecheck + client + las 17 suites contra la DB remota) | **RC=0 — "All tests passed" / "Entorno listo"** |
| `git status --porcelain supabase/ sync-streams/` (Gate 1 ATRIBUIBLE) | 11 líneas bajo `supabase/`, **0 nuestras**; `sync-streams/` vacío → **N/A** |

### ⚠️ El único rojo de la primera corrida, y NO era de esta fase (ya resuelto por otra terminal)

`app/src/utils/brand-name-guard.test.ts` → *"A — ninguna pantalla de app/app + app/src muestra el nombre VIEJO de la
marca"*. Las tres violaciones son el header HTTP `X-Rafaq-Request-Id` en `src/services/account.ts:127`,
`src/services/members.ts:152` y `src/services/push-notifications.ts:88`.

- **No es mío**: los tres archivos están **intactos** en el working tree (`git status --short` sobre ellos → vacío) y
  ninguno de mis archivos aparece en la lista de violaciones (la aserción es un `deepEqual` con **todas**).
- **Origen**: el header viene de `7bb2db4` (spec 23, request_id end-to-end) y el guard se endureció con el rebrand
  fase 1 (`88cecaf`, el commit anterior a mi baseline).
- **Por qué no lo arreglé**: está fuera del alcance de F1 y **no es un rename cosmético** — es un header de protocolo que
  las Edge Functions leen; cambiarlo del lado del cliente sin redeployarlas rompe la correlación de `request_id`. Es de
  la unidad de rebrand del leader (hay un `progress/rebrand-fase5-headers.md` sin trackear, que parece ser justamente
  eso). Lo dejo reportado, no tocado.
- **Cómo terminó**: **otra terminal lo arregló mientras yo trabajaba.** A mitad de sesión aparecieron modificados
  `src/services/account.ts`, `src/services/members.ts`, `src/services/push-notifications.ts`, `src/utils/request-id.ts`
  y `app/invitar.tsx` — que yo **no toqué** — y la corrida de cierre de la lista completa dio **3135/3135**. O sea: el
  working tree de esta sesión **incluye cambios de otra terminal** (la unidad de rebrand fase 5, headers). El reviewer
  tiene que stagear **selectivo**: los archivos de F1 son los 15 que se listan abajo, ninguno de esos cinco.

### Lo que NO verifiqué (dicho, no barrido)

- **E2E de Playwright**: no se corrió. Exige `expo export -p web` + la DB remota compartida (~38 min) y es el paso del
  leader (Gate 2.5). Riesgo evaluado **bajo y argumentado**: la E2E corre en web con `mock`/`manual`/`simulator`, los
  tres de modo `'eid'`, cuyo camino queda **idéntico** (`processEid`, sin parser); el bridge de E2E inyecta por
  `mock.mockTagRead(eid)`, que no cambió. Lo único que cambió de comportamiento en web es el harness `/baston-test`, que
  necesita un RS420 real por Web Serial.
- **Device**: nada de F1 necesita hardware (es puro), pero tampoco se corrió el banco. El SPP en device queda cubierto
  por la regresión de identidad del driver (si el driver no se expusiera, el fail-closed lo dejaría mudo — y eso lo
  detecta el test, no el aparato).
- **Capturas (Gate 2.5)**: **N/A** — F1 no toca ni una superficie de UI (el único `.tsx` tocado es el provider, que no
  renderiza nada propio, y el harness de dev `/baston-test`, cuyo layout no cambió).

## Archivos de F1 (los únicos que el reviewer tiene que mirar / stagear)

**Código de producción (8)**
- `app/src/services/ble/contract.ts` — el parser entra por parámetro; se fue el import del fabricante ·
  **fix-loop**: `RejectReason` += `parser_threw`
- `app/src/services/ble/stick-adapter.ts` — `readonly driver?: ReaderDriver` (aditivo) · **fix-loop**: se fue la
  referencia a `contract.ingestFromAdapter`, que no existe
- `app/src/services/ble/adapter-selection.ts` — `resolveFrameParser(adapter, onUnresolved)` · **fix-loop**:
  **+ `ReadSource` + `readSourceFor`** (mudados del provider)
- `app/src/services/ble/adapter-web-serial.ts` — expone `driver` (default RS420)
- `app/src/services/ble/adapter-spp-android.ts` — `driver` pasa de privado a público de solo lectura
- `app/src/services/ble/BleStickListenerProvider.tsx` — fail-closed con log · **fix-loop**: pide su `ReadSource`
  a la capa pura y solo aporta el sink (`logParserUnresolvedAtMount`)
- `app/src/services/ble/logging.ts` — `parser_unresolved` · **fix-loop**: el `reason` de `eid_rejected` es el
  `RejectReason` **importado** del contrato, no una copia
- `app/app/baston-test.tsx` — el segundo call site (harness web-serial) · **fix-loop**: loguea el descarte

**Tests (7 modificados + 1 nuevo)**
- 🆕 `app/src/services/ble/frame-parser-resolve.test.ts` — **UNTRACKED**, hay que `git add`-earlo
- `app/src/services/ble/adapter-ingest-mode.test.ts` — guard de las superficies de cableo (T1.8-ii)
- `app/src/services/ble/contract.test.ts` · `adapter-web-serial.test.ts` · `adapter-spp-android.test.ts` ·
  `offline-noread.test.ts` · `wiring.test.ts` · `read-dispatch.test.ts` · `feedback.test.ts` (**fix-loop**)

**Infra / specs**
- `scripts/run-tests.mjs` — la suite nueva en la lista explícita. ⚠️ **archivo compartido**: la otra terminal
  (rebrand fase 5) agregó en paralelo su propio bloque `request-headers rename guard`. Los dos cambios conviven; el
  mío es el comentario de `frame-parser-resolve` + el path dentro de la lista explícita de `client unit tests`.
- `specs/active/04-bluetooth-baston/tasks-ios-ble-mfi.md`, `design-ios-ble-mfi.md` y (fix-loop)
  `requirements-ios-ble-mfi.md` — reconciliados al as-built
- `progress/impl_ios-ble-mfi-f1.md` (este archivo)

---

# FIX-LOOP del review (`progress/review_ios-ble-mfi-f1.md`, CHANGES_REQUESTED) — 2026-08-17

Veredicto atendido: **1 🔴 + 3 🟡 + 3 ⚪**. Nada de F2; no se tocó `adapter-ble-gatt`/`adapter-mfi-ios`/
`adapter-hid-wedge`, ni `feature_list.json`, ni `progress/current.md`, ni la spec 09, ni `supabase/`, ni
`sync-streams/`, ni `scripts/run-tests.mjs` (verificado que su bloque de *rebrand fase 5* sigue intacto en el
diff, junto con el mío de F1). Cero deps nuevas.

## 🔴 §1 — `readSourceFor` tenía un guard de GRAFÍAS y ningún oráculo de comportamiento

**El diagnóstico del reviewer, aceptado sin descuento**: `readSourceFor` vivía dentro del provider, y el
provider importa `react-native` → **ninguna suite `node:test` puede importarlo**, así que su único oráculo
posible era un regex sobre el fuente. El guard prohibía **tres grafías** (`parseRs420Line`, importar un
`./parser-*`, `RS420_DRIVER`) y su mutante MR1b —`resolveFrameParser(...) ?? DRIVER_REGISTRY[0].frameParser`—
no nombra ninguna: compila, reintroduce el fallback silencioso que RBM1.4 prohíbe, y quedaba **todo en verde**.
Mi M5 se había cerrado *agregando un nombre más a la lista de prohibidos*: eso persigue grafías, no invariantes.

**Lo que hice, en tres piezas** (la primera es el fix; las otras dos son la red, no el oráculo):

1. **`ReadSource` + `readSourceFor(adapter, onUnresolved)` se mudaron a `adapter-selection.ts`** (son puros:
   `kind` + `ingestModeFor` + `resolveFrameParser` + el sink inyectado). El provider ahora solo **pide** su
   `ReadSource` y aporta el sink (`logParserUnresolvedAtMount`, module-level → el regex del log `at:'mount'`
   sigue teniendo qué mirar). Y **el bloque (B) de `frame-parser-resolve.test.ts` la ejerce por
   COMPORTAMIENTO**, con las tres aserciones que el review pidió, por **identidad**:
   - `readSourceFor({kind:'spp-android'}, sink)` → `{kind, mode:'raw-line', frameParser:null}` (la forma
     ENTERA con `deepEqual`, no campo por campo) **+ `sink` llamado exactamente una vez** + contraprueba
     contra el `frameParser` de **cada driver del `DRIVER_REGISTRY`** (derivada del registro, no un nombre);
   - `readSourceFor({kind:'spp-android', driver: SINTETICO}, sink)` → `frameParser === SINTETICO.frameParser`
     (identidad, no `assert.ok`) **+ `sink` sin llamar**;
   - `readSourceFor({kind:'manual'}, sink)` → `{mode:'eid', frameParser:null}` **sin aviso** (RBM9.5: el
     fail-closed del parser no puede tocar la puerta manual);
   - \+ un **exhaustivo sobre `ADAPTER_KINDS`**: para todo kind, `source.mode === ingestModeFor(kind)`, el
     `kind` se conserva, y con driver el parser sale del driver **si y solo si** desframea.
2. **El guard estático se reescribió SOBRE LA AUSENCIA** (el método que ya había usado bien en el guard (i)):
   `vendorModules()` deriva del árbol los módulos de fabricante —`parser-*.ts` **y `driver-*.ts`**, salvo
   `driver-types.ts` (tipos, con su excepción escrita y su motivo)— y prohíbe, en **las DOS superficies que
   cablean un adaptador** (`BleStickListenerProvider.tsx` **y** `adapter-selection.ts`): (a) mencionar
   cualquiera de sus **exports** y (b) **importar de ellos por cualquier vía** (la regla (b) existe porque un
   `import * as drivers from './driver-registry'` no nombra un solo export y evadiría la (a) entera). Con su
   **meta-test**: el extractor tiene que ver `parser-rs420.ts`/`driver-rs420.ts`/`driver-registry.ts` y los
   nombres `parseRs420Line`/`RS420_DRIVER`/`DRIVER_REGISTRY`/`findDriverForDevice`, y NO puede contar
   `FrameParser`/`ReaderDriver`. Un `HR5_DRIVER` futuro cae sin que nadie actualice el guard.
   El **mismo extractor extendido** se aplicó al guard (i) sobre `contract.ts`, que tenía el mismo agujero de
   familia que el reviewer nombró en su §7(a) (un fallback vía `driver-rs420.ts` no nombra ningún `parser-*`).
3. **El provider tiene prohibido FABRICAR un parser o un `ReadSource`** (`frameParser:` / `parse:` como
   propiedad). Sin esta regla queda un agujero que ningún guard de nombres ve: `?? { parse: (raw) => ({ eid:
   raw.slice(7, 22) }) }` es el framing del RS420 reimplementado a mano, sin nombrar a nadie. Lo corrí
   (MR1d-prov) y sin esta regla **sobrevivía**. La consecuencia buscada es estructural: lo que se decide
   adentro del provider solo se puede vigilar por regex, así que **la decisión no se toma ahí**.

### El criterio de aceptación, ejecutado: MR1b tiene que CAER

| MR1b (`?? DRIVER_REGISTRY[0].frameParser`) | tsc | Suites BLE | Veredicto |
|---|---|---|---|
| **ANTES del fix** — reproducido en el árbol de hoy neutralizando (con `test.skip`) los 4 tests de comportamiento nuevos + el guard estático nuevo, que es exactamente el estado que revisó el reviewer | **EXIT=0** | **🟢 394 pass / 0 fail** (5 skipped) | **VIVO** — coincide con lo que reportó el review (233/233 en su corrida) |
| **DESPUÉS del fix** — mutante puesto en su hogar nuevo (`adapter-selection.readSourceFor`) | **EXIT=0** (mutante legítimo, no un typo) | **🔴 395 pass / 4 fail** | **MUERTO**, y por comportamiento: `(readSourceFor): raw-line SIN driver…`, `(readSourceFor): la puerta MANUAL…`, `(readSourceFor): EXHAUSTIVO…` + el guard de ceguera al fabricante |

## Mutantes del fix-loop (7 más; aplicados y **revertidos** con restore en `finally`, en binario → cero churn de CRLF)

Script: `scratchpad/mutants_f1_fix.py` (+ `mutants_f1_before.py` para la fila "antes"). Baseline y cierre
verificados iguales: **tsc EXIT=0 · 399 pass / 0 fail** sobre `app/src/services/ble/*.test.ts`.

| # | Mutante | tsc | Suites BLE | Quién lo mata |
|---|---|---|---|---|
| **MR1b** | `adapter-selection.readSourceFor`: `?? DRIVER_REGISTRY[0].frameParser` (**el del reviewer**) | EXIT=0 | 🔴 395/4 | **los 3 tests de comportamiento de `readSourceFor`** + el guard de ceguera al fabricante |
| **MR1b-prov** | el **provider** re-arma el `ReadSource`: `{...base, frameParser: base.frameParser ?? DRIVER_REGISTRY[0].frameParser}` | EXIT=0 | 🔴 397/2 | el guard estático: nombra `DRIVER_REGISTRY` **e** importa de `driver-registry` (las dos reglas, por separado) |
| **MR1d-prov** | el **provider** re-arma el `ReadSource` con un parser escrito **a mano** (`{ parse: (raw) => ({ eid: raw.slice(7,22) }) }`) — **no nombra a NINGÚN fabricante** | EXIT=0 | 🔴 398/1 | **solo** la regla nueva "el provider no fabrica parsers" (`parse:`). Sin ella este mutante vivía: es la razón de existir de esa regla |
| **MR-mode** | `readSourceFor` ignora `ingestModeFor` y fija `mode:'raw-line'` | n/a | 🔴 397/2 | comportamiento: `manual` deja de ser `'eid'` (el exhaustivo + el test de la puerta manual) |
| **MR-sink** | `readSourceFor` se traga el aviso del fail-closed (le pasa un no-op al resolutor) | n/a | 🔴 397/2 | comportamiento: `sink` no llamado (el descarte quedaba mudo) |
| **MR-2a** | `contract.ts` vuelve a meter el throw del driver en la bolsa de `parse_failed` (🟡-2) | n/a | 🔴 396/3 | el test de la DIFERENCIA (`notDeepEqual`) + los dos de motivo |
| **MR-2b** | `logging.ts` se re-copia el union del motivo a mano en vez de importar `RejectReason` | **EXIT=2** | 🟢 399/0 | **el typecheck**, en los dos call sites (`BleStickListenerProvider.tsx:275`, `baston-test.tsx:197`) — el único guard que no se puede olvidar de correr |

Dos lecturas que valen: (a) **MR1d-prov es el mutante más importante de la tabla** — es el que muestra que la
familia "fallback" no se agota nombrando fabricantes, y por eso la regla se escribió sobre *fabricar*, no sobre
*nombrar*; (b) **MR-2b justifica el `import type`**: los dos unions gemelos escritos a mano eran una deuda
esperando a que alguien agregara un motivo de un solo lado.

## 🟡 §2 — `parse_failed` metía en la misma bolsa "el parser EXPLOTÓ" y "la trama vino mal"

`RejectReason` += **`'parser_threw'`** (sale del `catch` de `ingestRawLine`), y `logging.ts` deja de recopiar el
union: `reason: RejectReason` **importado** del contrato (`import type`, se borra en runtime; `contract.ts` no
importa `logging.ts`, así que no hay ciclo). Dos causas → dos acciones: `parse_failed` = el parser corrió y dijo
"esta trama no es de mi formato" → mirar el **lector**; `parser_threw` = el `parse` del driver explotó o no era
invocable → arreglar el **driver**.

**Decisión propia, y por qué me aparté del literal de la recomendación**: la forma inesperada (`parse` que
devuelve `undefined`, u objeto sin `eid`) **se queda en `parse_failed`**. Caerse del final de una función sin
`return` es la manera descuidada —y frecuentísima en JS— de escribir "no match", y no hay forma de
distinguirla de la intención; un throw, en cambio, **nunca** es "no match". Meterla en `parser_threw` habría
sido un nombre que miente sobre la mitad de sus casos. Tests: el de la **diferencia** (`notDeepEqual` entre el
rechazo del que explota y el del que no entiende — la aserción es la distinción, no los literales), los dos de
motivo, el `classifyReadOutcome` (al operario le suena igual: la causa es para el log, no para la manga) y el
payload ejecutado en `wiring.test.ts`.

## 🟡 §3 — el Gate 1 estaba verificado con el oráculo que la spec PROHÍBE, y lo que afirmaba era falso

Corregido arriba (encabezado del informe + las dos filas de las tablas), con el `git status --porcelain`
cruzado contra la lista de archivos de F1 y nombrando de quién es cada línea ajena (*rebrand fase 5 — headers*,
de la otra terminal). El 🟡 era exacto: `git diff --stat supabase/ sync-streams/` hoy devuelve 8 archivos / 166
inserciones y **no ve** el untracked `0133_rename_audit_headers_mitropero.sql`, que es justo el caso que RBM9.2
cita. La conclusión (N/A) no cambia; el oráculo sí.

## 🟡 §4 — `design-ios-ble-mfi.md` §2.2 tenía la firma vieja

Corregida la fila de `adapter-selection.ts` (`resolveFrameParser(adapter, onUnresolved)` + `ReadSource` /
`readSourceFor`) y la de `BleStickListenerProvider.tsx`. Aproveché para reconciliar lo demás que el fix movió:
el pseudocódigo de §3 (ahora muestra `readSourceFor`), la nota 4 (dónde vive y **por qué**), la nota 5
(`parser_threw`), la tabla de guards + su nota "Medido", y el árbol de tests de §2.1.

## ⚪ §5 — los tres nits, hechos (eran baratos)

- **`stick-adapter.ts`**: se fue la referencia a `contract.ingestFromAdapter` (función que nunca existió).
  Quedó en su lugar la verdad verificable: el modo lo declara `ADAPTER_INGEST_MODE` y lo resuelve
  `readSourceFor`.
- **`baston-test.tsx`**: el harness ya no se come el `{rejected}` en silencio — loguea `eid_rejected` con su
  motivo, igual que el provider. Era la regla propia que su propio comentario decía no tener (y con
  `parser_threw` recién agregado, era justo el rastro que importa).
- **F3**: recuadro nuevo en `design-ios-ble-mfi.md` §4 + aviso al inicio de la Fase F3 en `tasks`: el
  `ReadSource` se resuelve **al cablear**, y eso solo es correcto mientras el `driver` sea inmutable por
  instancia; el adapter BLE conoce su driver recién **al elegir el device en el escaneo**, así que si esa
  elección no fuerza una instancia nueva el transporte **nace mudo** (0 lecturas, 0 errores). Con las dos
  formas válidas de cerrarlo y la exigencia del test que lo fije.

## Autorrevisión del fix (antes de devolverlo)

Qué busqué en mi propio fix, más allá de lo que pedía el review:

1. **¿El fix rompe algún guard preexistente que yo no esté mirando?** Enumeré los tests que **leen el fuente
   del provider** (ripgrep, no memoria): `adapter-ingest-mode.test.ts`, `read-dispatch.test.ts` (×4 reglas,
   incluida `HOT_PATH_CALLABLE`) y `wiring.test.ts`. `handleReading` **no cambió** (sigue leyendo
   `source.mode`/`source.frameParser`), así que la tabla de invocables del camino caliente queda igual — y lo
   confirmé corriendo, no leyendo: `read-dispatch.test.ts` verde.
2. **¿El guard viejo se debilitó al cambiar `ingestModeFor(` por `readSourceFor(`?** Es la pregunta correcta:
   el provider ya no llama `ingestModeFor` directo. Lo que antes vigilaba un regex ("delega el modo") ahora lo
   verifica el exhaustivo por comportamiento (`source.mode === ingestModeFor(kind)` para **todos** los kinds),
   que es estrictamente más fuerte; y la prohibición de comparar kinds inline (`kind === 'web-serial'`) quedó
   intacta.
3. **¿El guard nuevo es satisfacible o me deja el árbol en rojo a futuro?** Lo chequeé contra el uso real: el
   provider y `adapter-selection.ts` solo importan de `driver-types` (tipos), que está excluido **con su
   motivo escrito**. Si F3 necesitara el registro en una de esas dos superficies, el guard la fuerza a
   justificarlo — que es el punto, no un accidente.
4. **¿Metí un ciclo de imports con el `import type { RejectReason }` en `logging.ts`?** No: `contract.ts` no
   importa `logging.ts`, y de todas formas es type-only (se borra en runtime). Verificado por lectura del
   grafo + typecheck EXIT=0.
5. **¿Los tests nuevos pasan por la razón correcta?** Los falsifiqué todos (tabla de arriba): cada uno tiene
   al menos un mutante que lo pone en rojo. El que me faltaba —y que agregué por esta pasada— es el de
   "fabricar el parser a mano" (MR1d-prov), que ningún guard de nombres podía ver.
6. **Offline / multi-tenant / UI**: sin cambios respecto de la primera pasada — todo el camino sigue siendo
   local y puro, cero `establishment_id`, cero superficie de UI (el único `.tsx` de producción es el provider,
   que no renderiza nada propio; el harness `/baston-test` sumó un log, no un componente) → **capturas Gate
   2.5 N/A**, otra vez declarado y no omitido.
7. **Lo que NO corrí, dicho**: Playwright (`pnpm e2e`, Gate 2.5 del leader) y device. El argumento de riesgo
   bajo es el mismo que el reviewer verificó por su cuenta: la E2E corre en web con `mock`/`manual`/
   `simulator`, los tres de modo `'eid'` → van por `processEid`, camino que este fix **no toca**.

## Verificación del fix-loop (ejecutada)

| Qué | Comando | Resultado |
|---|---|---|
| Typecheck | `app/node_modules/.bin/tsc -p app/tsconfig.json --noEmit` | **EXIT=0** |
| Suites BLE (**todas** las de `app/src/services/ble/`) | `node --import ./scripts/ts-ext-resolver.mjs --test app/src/services/ble/*.test.ts` | **399 / 399, 0 fail** |
| Toda la lista de `client unit tests` de `run-tests.mjs` (offline, sin DB) | el comando literal del script | **3145 / 3145, 0 fail** |
| Mutantes | `scratchpad/mutants_f1_fix.py` + `mutants_f1_before.py` | tabla de arriba; **árbol restaurado y re-verificado** (399/399, tsc 0) |
| Gate 1 ATRIBUIBLE | `git status --porcelain supabase/ sync-streams/` | 11 líneas, **0 nuestras**; `sync-streams/` vacío |
| `scripts/run-tests.mjs` sigue con **los dos** bloques (el mío y el de la otra terminal) | `git diff scripts/run-tests.mjs` | ✅ intactos, no lo toqué en este fix-loop |

> `node scripts/check.mjs` completo **no** se corrió en este fix-loop: incluye las ~17 suites contra la DB
> remota **compartida con la otra terminal** (rebrand fase 5), y ese cruce fabrica rojos de rate-limit que se
> leen como regresión. Lo determinista y offline —typecheck + las 3145 units, que **contienen** todas las
> suites tocadas— está verde. Correr el check completo es del leader, en una ventana sin otra terminal
> escribiendo.

## Para el leader (no lo hago yo)

- `app/src/services/ble/frame-parser-resolve.test.ts` es **untracked**: hay que `git add`-earlo explícitamente. Un
  `git add` con lista explícita ya dejó `main` sin compilar una vez por olvidar un `??`.
- `feature_list.json` y `progress/current.md`: **no los toqué** (límite duro del despacho).
- **No commiteé nada** (límite del despacho del fix-loop). Al stagear: los archivos de F1 son los de la lista de
  arriba; **NO** van `src/services/{account,members,push-notifications}.ts`, `src/utils/request-id.ts`,
  `app/invitar.tsx`, `supabase/**` ni el bloque de *rebrand fase 5* de `scripts/run-tests.mjs`.
