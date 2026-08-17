# review — delta `ios-ble-mfi` · **Fase F3**: `adapter-ble-gatt`

**Veredicto: CHANGES_REQUESTED**

**Fecha**: 2026-08-17. **Revisor**: reviewer (read-only). **Árbol revisado**: sin commitear desde
`0b3e358`; baseline del changeset de F3 = `3272227` (verificado: existe y es ancestro de HEAD; F1+F2
commiteadas ahí). **Informe del implementer**: `progress/impl_ios-ble-mfi-f3.md`.

> **Cómo leer este documento**: todo lo que dice **[CORRIDO]** lo ejecuté yo en esta sesión y vi el
> resultado que transcribo. Lo que dice **[LEÍDO]** es lectura de código o de spec, sin ejecución.
> La distinción no es decorativa: el árbol lo escribieron dos agentes, el primero murió sin informe, y
> `tsc` verde no confirma cableado.

---

## 0. Resumen ejecutivo

El adapter está bien construido y **las diez lecciones del SPP están implementadas de verdad**: escribí
**20 mutantes propios** sobre el fuente y **15 murieron**, cada uno nombrando el test que lo mata. El
decodificado byte a byte lo verifiqué con **bytes reales** (no con un round-trip contra nuestro propio
encoder). El bug del `??` del fixture está cerrado y tiene meta-test.

Lo que bloquea es de la **misma clase** que el hallazgo que el implementer sí encontró, una capa más
arriba: **barrió la instancia, no la clase**. Los fixtures de las dos suites declaran **un solo juego de
parámetros de driver** (los UUID Nordic UART, y ningún delimitador propio que llegue al adapter), así que
las tres claims *"el parámetro sale del driver"* del adapter **no se pueden falsificar**. Tres mutantes que
vuelven a **hardcodear un parámetro de fabricante adentro del transporte** —exactamente la deuda RMV5.2
que este delta vino a cerrar— sobreviven con las **136 pruebas en verde**.

El producto es correcto (lo medí aparte: con un driver que declara `delimiter:'\r'` el adapter entrega la
lectura). O sea: **defecto de oráculo, no de código**. Un test —un segundo driver sintético con otros UUID
y otro fin de trama, pasado de punta a punta— mata los tres mutantes.

---

## 1. Lo que corrí, con su resultado

| Qué | Resultado | Nota |
|---|---|---|
| `npx tsc -p app/tsconfig.json --noEmit` | **[CORRIDO] rc=0** | |
| Las 5 suites de F3 juntas (`adapter-ble-gatt`, `ble-gatt-protocol`, `spp-bridge-timeout-guard`, `adapter-ingest-mode`, `frame-parser-resolve`) | **[CORRIDO] 136/136** | coincide con el informe |
| Bloque **completo** de unit tests del cliente de `run-tests.mjs` (extraído del script, tal cual) | **[CORRIDO] 3275/3275, rc=0** | coincide con el informe; ninguna suite vecina se rompió (web-serial, wiring, spp, contract) |
| `node --check scripts/run-tests.mjs` + bloque de scripts (spec 16 Run B, con la suite de la otra terminal) | **[CORRIDO] parsea; 50/50** | el archivo compartido no quedó roto |
| 20 mutantes propios sobre `adapter-ble-gatt.ts` | **[CORRIDO] 15 muertos / 5 sobrevivientes** | tabla en §3 |
| Sonda propia: bytes reales (base64 → latin-1 vs UTF-8) y delimitador del driver **de punta a punta** | **[CORRIDO]** | §4 |
| Integridad del árbol después de mutar | **[CORRIDO]** los 3 archivos tocados vuelven **sha256 idéntico**; POST-RESTORE **136/136** | §11 |
| `node scripts/check.mjs` **completo** | **NO CORRIDO** | §8 (motivo + qué queda pendiente) |

---

## 2. Trazabilidad `RBM<n>` → test, con mi veredicto

**A** = `adapter-ble-gatt.test.ts`, **P** = `ble-gatt-protocol.test.ts`, **G** =
`spp-bridge-timeout-guard.test.ts`, **I** = `adapter-ingest-mode.test.ts`, **F** =
`frame-parser-resolve.test.ts`.

| Req | Test(s) | Veredicto mío |
|---|---|---|
| RBM2.1 kind + mismo código iOS/Android | **A** `RBM2.1/RBM2.11…` | ✅ [LEÍDO] cero ramas por plataforma en el archivo |
| RBM2.2 import perezoso | **A** `RBM2.2/RBM2.3…` (+ las 75 importan el módulo en node sin RN) | ✅ [CORRIDO] la suite corre en node: un require top-level la voltearía entera |
| RBM2.3 sin binario / sin driver → no se monta | **A** `RBM2.3: sin driver…`, `RBM2.2/RBM2.3…`, `un adapter construido SIN driver…` | ✅ [CORRIDO] mutante propio (borrar la condición del driver) → 🔴 |
| RBM2.4 escaneo FILTRADO por el `serviceUuid` **del driver** | **A** `RBM2.4: el escaneo va FILTRADO…` · **P** los 3 de `normalizeUuid128` | ⚠️ **PARCIAL** — "filtrado" ✅ (mutante `null` → 🔴); **"del driver" ✗**: hardcodear el UUID sobrevive 98/98 (🟠-1) |
| RBM2.5 escaneo acotado y detenido | **A** 6 tests (vence, RECHAZA, listener con error, `disconnect()` en medio, `stopDeviceScan` colgado, escaneo que no se asienta) | ✅ [CORRIDO] el techo doble se ejercita; el "no digas timeout si no arrancó" tiene su aserción de ausencia |
| RBM2.6 connect + discover + suscripción a notify | **A** `RBM2.4/RBM2.6…`, discover colgado, discover que RECHAZA | ⚠️ **PARCIAL** — la secuencia ✅; **"la característica sale del driver" ✗** (🟠-1) |
| RBM2.7 base64 → 1 byte = 1 char, con STX | **P** 4 tests (STX, byte ≥ 0x80 con contraprueba UTF-8, padding, indecodificable) · **A** `…entrega la LÍNEA CRUDA (con su STX)`, `ble_decode_failed` | ✅ [CORRIDO] verificado además con bytes reales por mí (§4) |
| RBM2.8 reensamblado con el delimitador **del driver** | **P** 5 tests de framer · **A** trozos de 20 bytes, buffer entre sesiones | ⚠️ **PARCIAL** — el reensamblado ✅; **"delimitador del driver" ✗ en el adapter**: `new LineFramer()` sobrevive 136/136 (🟠-1). En **P** se prueba el framer con `'\r'`, no el adapter |
| RBM2.9 dos tramas pegadas | **P** + **A** | ✅ [CORRIDO] |
| RBM2.10 delimitador no frameable → no abre | **A** `RBM2.10: …NO abre la conexión` · **P** 4 tests (incluido `??` vs `\|\|`) | ✅ [CORRIDO] |
| RBM2.11 `ADAPTER_INGEST_MODE = raw-line` | **I** aserción explícita + los 2 exhaustivos · **A** | ✅ [CORRIDO] |
| RBM2.12 MTU por defecto | **P** payload 20, chunk 20 == chunk 0, connect sin `requestMTU` · **A** troceo de 20 con anti-vacuidad | ✅ [CORRIDO] el `deepEqual` de las opciones del connect es exhaustivo: un `requestMTU` cae |
| RBM2.13 permisos por transporte | **A** oráculo **estático declarado** + contraprueba de que los conjuntos difieren; tabla en F2 | ✅ [LEÍDO] declarado como estático con su motivo; la contraprueba impide que sea teatro |
| RBM2.14 denegado → `permission_denied`, sin backoff | **A** 3 tests (Android denied, iOS `Unauthorized`, `unavailable`) | ✅ [CORRIDO] · ⚪-6: el camino AUTOMÁTICO no lo refleja (pliega iOS `Unauthorized` en `bluetooth_off`) |
| RBM2.15 sin background | F2 (`app.config.test.ts`) · **A** foreground al disparar / autoConnect en background | ✅ [CORRIDO+LEÍDO] `isBackgroundEnabled:false` + `modes:[]` en `app.config.ts:158-159`; el único `UIBackgroundModes` del repo es `['remote-notification']` (push, no BLE); cero `bluetooth-central`/`bluetooth-peripheral` en la config, en `plugins/` y en el adapter |
| RBM2.16 recordado + `autoConnect` | **A** 4 tests | ✅ [CORRIDO] |
| RBM3.1 tope de la cadena sin gesto | **A** 4 tests | ✅ [CORRIDO] mutante propio a la **cabecera** → 🔴 · ⚪-4: el del **timer** sobrevive |
| RBM3.2 techo en todo await + latch en `finally` **y** en `disconnect()` + generación | **A** 4 `RBM3.2…` + orphan + disconnect a medio link · **G** 5 tests | ✅ [CORRIDO] latch del `finally` → **15 rojos**; latch de `disconnect()` → 🔴; `canCloseOrphanLink` siempre true → 🔴. ⚠️ borrar `connectGeneration += 1` de `disconnect()` **solo lo caza el guard estático** (igual muere) |
| RBM3.3 guard estático de presupuestos | **G** 6 tests (tabla derivada del árbol + no-ceguera) | ✅ [CORRIDO] es real: cae solo ante el mutante del latch, y la derivación del árbol la verifiqué leyendo el extractor |
| RBM3.4 desconexión de **fuente propia** | **A** 4 tests | ✅ [CORRIDO] mutante propio (filtro que nunca filtra) → 🔴; el listener GLOBAL está en el fake y se exige 0 usos |
| RBM3.5 2ª fuente en foreground **y** poll, fail-closed | **A** 7 tests | ✅ [CORRIDO] tres mutantes propios (sin sonda de foreground / poll que no sondea / fail-**open**) → 🔴 🔴 🔴 |
| RBM3.6 foreground **al disparar** | **A** `RBM3.6…` | ✅ [CORRIDO] mutante propio → 🔴 |
| RBM3.7 encolar el connect a otro target | **A** 2 tests | ✅ el encolado [CORRIDO] → 🔴 · 🟡-2: el **destope** por tap con intento en vuelo NO tiene oráculo |
| RBM3.8 ningún diálogo desde un camino automático | **A** 3 tests | ✅ [CORRIDO] mutante propio (el automático PIDE) → 🔴 |
| RBM3.9 dwell del backoff | **A** 2 tests | ✅ [CORRIDO] mutante propio (reset sin exigir dwell) → 🔴 |
| RBM3.10 `connected_silent` | **A** `RBM3.10…` | ✅ [CORRIDO] mutante propio → 🔴; el `ms` se mide de verdad (`advance(60_000)` con `silence:45_000`, aserta `"ms":60000`) |
| RBM3.11 máquina de estados en `node:test` con entorno inyectado | **A** las 75, con 8 promesas que no resuelven nunca | ✅ [CORRIDO] |
| RBM1.3 el adapter expone su driver | **A** 2 tests · **F** | ✅ [CORRIDO] `driver` es `readonly` y entra por constructor [LEÍDO] |
| RBM1.4 (extendido al kind nuevo) | **F** exhaustivo sobre `ADAPTER_KINDS` | ✅ [CORRIDO] agregar `'ble-gatt'` al union extiende solo el fail-closed de F1 |
| RBM5.11 ningún lector real inventado | **A** `bleGattDriverFrom…` + `GUARD: si el registro llega a declarar DOS…` | ✅ [CORRIDO+LEÍDO] `DRIVER_REGISTRY = [RS420_DRIVER]` y el RS420 declara solo `spp` + `serial`. Cero UUID/tramas de Gallagher/Datamars. Los drivers de los tests son sintéticos y locales |
| RBM5.13 (mitad del transporte) reconocer por nombre, no por UUID | **A** 4 tests + META-TEST del fixture | ✅ [LEÍDO+CORRIDO] `recognizes()` le pasa `device.serviceUUIDs` (lo anunciado), nunca `params.serviceUuid` |
| RBM9.1/9.2 Gate 1 N/A **atribuible** | — | ✅ [CORRIDO] `git status --porcelain supabase/ sync-streams/` → **solo** ` M supabase/functions/health/index.ts`, que **no** está en la lista §2 del informe (otra terminal, rebrand) |
| RBM9.4 offline-first | grep | ✅ [CORRIDO] cero `fetch(`, `supabase`, `powersync` en los dos archivos nuevos |
| RBM9.5 manual nunca se bloquea | **A** `un adapter construido SIN driver no tira…` | ✅ [LEÍDO] toda falla es estado + log; el constructor no lanza; `instantiateTransport` → `null` |
| RBM9.6 ningún método de `StickAdapter` ni spec 09 | diff | ✅ [CORRIDO] `stick-adapter.ts` solo extiende el union de `kind`; cero archivos bajo `app/src/features/animals/` |
| R10.5 `enable`/`disable` | **A** | ✅ [CORRIDO] |

**RBM fuera de F3 (declarados, no reclamados)**: RBM2.17/2.18 = F2; RBM5.1–5.10/5.12/5.14 = F4; RBM4.\* = F5;
RBM6.\* = F6 (device); RBM8.\* = F0/F7. ✅ correcto: **verifiqué [CORRIDO]** que el transporte es
**inalcanzable** hoy — `adapterForTransport('ble-gatt')` devuelve `null` (`selection-priority.ts:68-69`) y
`selectTransportAdapter` nunca devuelve `'ble-gatt'`. El informe no se vende de más en esto.

---

## 3. Mis mutantes (20), uno por lección + los de parametrización

Metodología: un mutante por vez sobre el fuente, las 5 suites juntas, revertir y verificar sha256. Baseline
post-restore: **136/136**.

| # | Qué desactiva | Resultado | Muerto por |
|---|---|---|---|
| M-1 | RBM3.4 — el filtro por id del `onDisconnected` nunca filtra | 135/136 | `RBM3.4: la desconexión de OTRO device no afecta al bastón` |
| M-2 | RBM3.2 — el latch **no** se libera en el `finally` de `runConnect` | **121/136 (15 rojos)** | 4× `RBM3.2`, 4× `RBM3.5`, 2× `RBM3.9`, `RBM3.1`, `RBM3.7`, orphan, framer entre sesiones, **G** |
| M-3 | RBM3.2 — `disconnect()` no libera el latch | 134/136 | `RBM3.2: disconnect() libera el latch…` + **G** |
| M-4 | RBM3.2 — `disconnect()` no invalida la generación | 135/136 | **solo el guard estático G** (⚪-4) |
| M-5 | RBM3.2 — `canCloseOrphanLink` siempre `true` | 89/90 | `un intento VIEJO que despierta… (orphan_socket_kept)` |
| M-6 | RBM3.5 — no se arma la sonda de **foreground** | 132/136 | 3× `RBM3.5` + `el teardown no deja timers ni suscripciones huérfanas` |
| M-7 | RBM3.5 — el **poll** no sondea liveness (solo mide mudez) | 135/136 | `RBM3.5: el POLL periódico…` |
| M-8 | RBM3.5 — **fail-OPEN**: la sonda que rechaza se lee como "conectado" | 134/136 | `la sonda que RECHAZA…` + `la que NO RESUELVE NUNCA…` |
| M-9 | RBM3.1 — se borra el tope de la **cabecera** de `scheduleReconnect` | 135/136 | `una cadena con el presupuesto VENCIDO muere aunque la app esté en BACKGROUND` |
| M-10 | RBM3.1 — se borra el tope de **adentro del timer** | ⚠️ **136/136 SOBREVIVE** | nadie (⚪-4) |
| M-11 | RBM3.6 — el foreground no se re-chequea al disparar | 135/136 | `RBM3.6: el foreground se verifica AL DISPARAR…` |
| M-12 | RBM3.9 — el backoff se resetea sin exigir dwell | 135/136 | `RBM3.9: un FLAP no resetea el backoff` |
| M-13 | RBM3.10 — la mudez deja de registrarse | 135/136 | `RBM3.10: conectado y MUDO queda escrito…` |
| M-14 | RBM3.7 — el target encolado se descarta | 135/136 | `RBM3.7: un connect a OTRO bastón… se ENCOLA` |
| M-15 | RBM3.7/🟠-B — el tap con intento en vuelo **no re-aplica la política** (no destopa) | ⚠️ **136/136 SOBREVIVE** | nadie (🟡-2) |
| M-16 | RBM3.8 — el camino automático **pide** el permiso | 135/136 | `RBM3.8: el camino AUTOMÁTICO consulta el permiso…` |
| M-17 | RBM2.4 — filtro del escaneo **hardcodeado** a los UUID NUS | ⚠️ **98/98 SOBREVIVE** | nadie (🟠-1) |
| M-18 | RBM2.6 — servicio+característica del monitor **hardcodeados** | ⚠️ **136/136 SOBREVIVE** | nadie (🟠-1) |
| M-19 | RBM2.8 — `new LineFramer(params.delimiter)` → `new LineFramer()` | ⚠️ **136/136 SOBREVIVE** | nadie (🟠-1) |
| M-20 | RBM3.2 — se borra el `gen !==` del guard post-connect (`:898`) | ⚠️ 90/90 sobrevive (lo tapa la 2ª copia) | nadie (⚪-4) |

> Las 10 lecciones del SPP que el leader pidió falsificar **están cubiertas**: M-1…M-14 y M-16 murieron
> nombrando su test. Ninguna quedó "listada por el informe pero sin oráculo".

---

## 4. Lo que medí aparte (sonda propia, fuera del repo)

**RBM2.7 con bytes REALES** (no round-trip contra nuestro propio encoder). Bytes
`[0x02,0x31,0x30,0xFF,0x80,0xC3,0xA9,0x0D,0x0A]` → base64 `AjEw/4DDqQ0K`:

```
decodeBase64Ascii  -> [2, 49, 48, 255, 128, 195, 169, 13, 10]   (idéntico a Buffer latin1)
TextDecoder utf-8  -> [2, 49, 48, 65533, 65533, 233, 13, 10]    (0xFF/0x80 -> U+FFFD, 0xC3 0xA9 -> é)
ours === latin1: true · ours === utf8: false · STX preservado: true
```

✅ **[CORRIDO]** El decodificado es latin-1 exacto, el `STX 0x02` sobrevive y **no** es UTF-8. El decoder
propio (aritmética de 6 bits, sin `atob`/`Buffer`) es correcto en padding (`%4==2` → 1 byte, `%4==3` → 2) y
rechaza el resto de 1 carácter.

**RBM2.8 de punta a punta con un driver que declara `delimiter:'\r'`** (lo que ninguna suite hace):
`resolveBleGattParams` → `delimiter:"\r"`, y una notificación con la trama terminada **solo en `\r`** produce
**1 lectura** con `eid: 982000364696050`. ✅ **[CORRIDO] el producto está bien** — lo que falta es el test.
Es la evidencia de que 🟠-1 es defecto de oráculo y no de código.

---

## 5. Hallazgos

### 🟠-1 — La monocultura de fixtures deja SIN FALSIFICAR las tres claims "el parámetro sale del driver"

**Bloqueante.** Es el bug de clase del que el implementer encontró una instancia (el `??` del `fakeDevice`)
y no la familia: **un fixture que no puede expresar la variación no puede probar la parametrización**. Las
dos suites declaran un único juego de parámetros —los UUID Nordic UART y ningún `delimiter` propio que
llegue al adapter (el único que aparece en **A** es `''`, que se rechaza **antes** de conectar)— así que tres
mutantes que reintroducen un parámetro de fabricante hardcodeado **adentro del transporte** quedan en verde:

| Mutante | Archivo:línea | Resultado |
|---|---|---|
| `[params.serviceUuid]` → literal `'6e400001-b5a3-...'` en el filtro del escaneo | `app/src/services/ble/adapter-ble-gatt.ts:1088` | 98/98 verde |
| `params.serviceUuid, params.notifyCharUuid` → los dos literales canónicos | `app/src/services/ble/adapter-ble-gatt.ts:970-971` | 136/136 verde |
| `new LineFramer(params.delimiter)` → `new LineFramer()` | `app/src/services/ble/adapter-ble-gatt.ts:968` | 136/136 verde |

Por qué importa y no es prolijidad:

1. Es **la deuda RMV5.2 exacta** que este delta vino a cerrar (un parámetro de fabricante fijado adentro del
   transporte), reintroducible sin poner nada rojo. Y el mundo malo del delimitador es el **🟠-5 medido en
   device**: `term cr` → conectado, mudo, **0 ingestas y 0 errores**.
2. El test `RBM2.4/RBM2.6: el servicio y la característica del MONITOR salen del driver, normalizados`
   (`adapter-ble-gatt.test.ts:584`) **no puede fallar** por lo que su título afirma: los valores del driver y
   los del hardcode son los mismos bytes. Mide la normalización, no el origen.
3. **F4 lo va a volver invisible**: el `ESP32_GATT_DRIVER` (T4.3) declara **esos mismos** UUID NUS, así que el
   hardcode seguiría verde contra el emulador y contra el banco de F6, y aparecería recién con el primer
   lector de tercero (HR5 v3) como "escanea y no encuentra nada" / "conecta y se queda mudo".
4. La trazabilidad del informe (§4) atribuye a RBM2.4, RBM2.6 y RBM2.8 tests que no vigilan la mitad del
   requisito. Eso es lo que hace esto CHANGES_REQUESTED y no un ⚪: **el informe declara cobertura que no
   existe**.

**Cambio requerido**: un segundo driver sintético en `adapter-ble-gatt.test.ts` con **otros** UUID (no NUS —
p. ej. la forma corta de 16 bits, que además ejercita la expansión de `normalizeUuid128`) **y** con
`delimiter: '\r'`, pasado de punta a punta por el adapter, asertando (a) `m.state.scanCalls[0].uuids` con el
UUID **de ese** driver, (b) `d.state.monitorArgs` con **su** servicio y característica, y (c) que una
notificación terminada **solo en `\r`** produce 1 lectura (y que esa misma trama con `\n` no cierra línea).
Un test mata los tres mutantes. Anti-vacuidad obligatoria: asertar que los dos juegos de UUID son
**distintos** (si mañana alguien los iguala, el test vuelve a ser teatro).

### 🟡-2 — Un comportamiento que el informe declara como fix (🟠-B) no tiene oráculo

`adapter-ble-gatt.ts:651` — `if (policyFor(trigger).chain !== 'inherit') this.applyChainPolicy(trigger);`
Borrarlo deja **136/136 verde** (M-15). El informe (T3.9 as-built) lo declara así: *"un `connect()` del
operario con un intento en vuelo… re-aplica la política de su cadena (la DESTOPA) y deja
`connect_reasserted`"*. La mitad del log **sí** está testeada (`RBM3.7: un segundo connect al MISMO
target…`); la del **destope** no: `RBM3.1: un tap del operario DESTOPA la cadena` cubre el caso en que la
cadena **ya terminó** (`off`), no el de un intento **en vuelo**.

Consecuencia real: el operario toca "Volver a conectar" mientras corre un intento de la cadena del arranque
(capada a 120 s) → sin esa línea el tap no destopa, la cadena muere igual a los 120 s y el gesto queda sin
efecto observable. Es el mismo síntoma que RBM3.1 vino a arreglar, por la otra puerta.

**Cambio requerido**: test con `gateConnect:true` sobre una cadena `autoconnect`, tap del operario con el
intento en vuelo, avanzar el reloj más allá de `UNPROMPTED_RETRY_BUDGET_MS` y exigir que la cadena **siga
reintentando** (no `'off'`, `autoConnectExhausted === false`).

### 🟡-3 — El barrido de fixtures muertos también quedó en la instancia

El informe §6-f dice haber barrido "tres knobs del doble declarados y nunca usados". Quedaron tres más, de la
misma familia que el `sameUuid()` que §6-d borró **por no tener call site de producción**:

| Qué | Dónde | Consecuencia |
|---|---|---|
| `FakeEnvOptions.checkPermission` declarado y **ningún test lo pasa** | `adapter-ble-gatt.test.ts:340` (default en `:389`) | en toda la suite `checkPermissions` y `ensurePermissions` devuelven **lo mismo**: ningún test distingue los dos caminos por su **resultado**, solo por los contadores de llamadas |
| `FakeEnvOptions.clock` declarado y nunca pasado | `adapter-ble-gatt.test.ts:344` / `:360` | knob muerto (todos arrancan en 0 y usan `advance()`) |
| `state.cancelDeviceCalls` se llena y **nadie lo asierta** | `adapter-ble-gatt.test.ts:272` / `:313` | espeja un método muerto: **`BleManagerLike.cancelDeviceConnection`** (`adapter-ble-gatt.ts:158`) tiene **cero call sites de producción** — solo la declaración y la mención del comentario de `canCloseOrphanLink` que explica por qué **no** se usa |

**Cambio requerido** (chico): o se usan (un caso donde el `check` diga `granted` y el `ensure` `denied`, que
es el mundo real "el permiso está concedido pero el diálogo se cancela") o se borran; y
`cancelDeviceConnection` sale de la superficie modelada con el mismo criterio con el que se borró `sameUuid`.

### ⚪-4 — Guards redundantes presentados como dos oráculos, falsificables en una sola dirección

- `adapter-ble-gatt.ts:1308-1311` (el tope **adentro** del timer): borrarlo deja 136/136 (M-10). El tope sigue
  vigente por la copia de la cabecera, con el costo de **un intento extra más allá del tope** (el presupuesto
  se vence *durante* el delay del backoff, que es el caso normal). El informe presenta la doble copia como "no
  redundante": es cierto para la **cabecera** (M-9 la falsifica), no para el timer.
- `adapter-ble-gatt.ts:898` (el `gen !==` del guard post-connect): borrarlo deja 90/90 (M-20); lo tapa el
  chequeo de `:925`/`:954`. Idem M-4 (la generación que invalida `disconnect()`), que **solo** la caza el regex
  del guard estático.

No pido cambio de código: pido que la reconciliación no describa como "dos oráculos" lo que es un oráculo más
un cinturón (o que el cinturón gane su test, si se lo quiere vigilar).

### ⚪-5 — Catch mudos: heredados del molde SPP, no introducidos por F3

`teardownStreams` (`:1429`) y los dos `abort_cancel_connection` (`:905`, `:929`) se tragan el error **y el
`bridge_timeout`**: "no pude cerrar el link" queda invisible. Idem `defaultBleEnv.readRemembered` (`:375`, un
storage roto se lee como "no hay bastón recordado" y sale como `autoconnect_skipped{no_remembered}`,
indistinguible de un arranque en frío), `writeRemembered` (`:385`) y `onForeground` (`:409`). **[LEÍDO]** son
**byte por byte** el molde del SPP (`adapter-spp-android.ts:1260-1279` y `:860-872`), así que es deuda de los
**dos** transportes: recomendación al leader, no cambio de F3.

El resto **sí** es distinguible: barrí los 20 mensajes de los 26 call sites de log y no hay dos causas con el
mismo texto (los prefijos `ble_*` separan params sin resolver / nativo ausente / manager que explotó / permiso
/ radio / escaneo / device no reconocido / decode / monitor / desconexión), y `ble_decode_failed` va **sin
payload** (no filtra la línea cruda al breadcrumb de Sentry).

### ⚪-6 — RBM2.14 solo se refleja en el camino del GESTO

En `autoConnect`, un `Unauthorized` de iOS (permiso de Bluetooth denegado) cae en `skip('bluetooth_off')`
junto con `PoweredOff`/`Resetting`/ilegible (`adapter-ble-gatt.ts:629-631`), **no emite estado** y por lo tanto
no hay copy que diga "andá a Ajustes". Dos causas con **el mismo log** y dos arreglos distintos (Ajustes ›
Privacidad vs. centro de control). La decisión de no emitir estado desde un gate está declarada y la comparto;
sugiero separar el `reason` (`permission_ios` vs `bluetooth_off`). Queda además como escenario de F6.

### ⚪-7 — `isBleGattTransportAvailable()` loguea `connect_error` por una condición ESPERADA

`adapter-ble-gatt.ts:306-308`: hoy la condición (b) es `false` en producción (ningún driver declara `ble-gatt`
hasta F4) y la función devuelve `false` **loguendo un `connect_error`** con breadcrumb de Sentry. Hoy es
inerte (el `case` del provider es inalcanzable), pero cuando F4 cablee la selección, si el driver del emulador
faltara, cada montaje del provider metería un `connect_error` por algo normal. A mirar en F4.

### ✅ Lo que revisé y está bien, dicho para que no se relea

- **El `??` del fixture está cerrado de verdad**: `fakeDevice` usa `in` para distinguir "no lo declaré" de "lo
  declaré `null`", y el META-TEST exige las **dos** direcciones (el anónimo sale anónimo **y** el default sigue
  siendo el reconocible). Barrí el resto de los defaults de los dos archivos (`id ?? DEV_ID`,
  `state ?? 'PoweredOn'`, `device ?? fakeDevice().device`, `linkAlive: true`, `foreground ?? true`,
  `remembered ?? null`, `permission ?? 'granted'`, `timeouts ?? {ceros}`, `scanEmits ?? []`,
  `scanListenerError !== undefined`) y **ninguno** pone un test en verde por un motivo distinto del que
  declara. El de `timeouts` merece una nota: el default deja **todos los presupuestos en 0** (= sin techo) y
  `livenessPoll: 0` (= sin watchdog), así que un test que no pase `FAST_TIMEOUTS` **no puede** observar un
  vencimiento; está declarado en el comentario del fixture y los tests que miden vencimiento lo pasan.
- **Las aserciones de AUSENCIA no son vacuas**: las cinco que existen (`ble_scan_timeout` cuando el escaneo
  rechaza, `bridge_timeout` cuando el nativo contesta con error, `ble_manager_load_failed` cuando no hay RN,
  etc.) van **acompañadas de una aserción de presencia sobre el mismo array de logs**, así que si el capturador
  de `console.info` se rompiera, el test caería en vez de pasar en silencio.
- **Piezas a medio cablear: no encontré ninguna.** [CORRIDO] los 27 símbolos importados por el adapter tienen
  uso real (grep de conteos); el único importador de producción de `adapter-ble-gatt` es el provider
  (`instantiateTransport`, `case 'ble-gatt'` completo con sus dos motivos logueados por separado); cero
  imports a módulos de F4/F5 que no existan; `LineFramer` tiene 3 call sites de producción y los dos viejos
  siguen sin delimitador (regresión cubierta); el `export { LINK_DWELL_MS }` de `adapter-spp-android.ts`
  resuelve (su suite pasa). Lo único muerto es lo de 🟡-3.

---

## 6. Exactitud de las specs contra el as-built (paso 6 del protocolo)

**✅ Reconciliadas y correctas.** Verifiqué [LEÍDO] cada afirmación nueva contra el código:

- `requirements-ios-ble-mfi.md`: 8 notas de reconciliación (RBM2.3, 2.5, 2.8, 2.13, 2.14, 3.1, 3.3, 5.13), sin
  reescribir ningún EARS. Las tres que más fácil se habrían quedado viejas —el techo **doble** del escaneo, el
  `startDeviceScan` que **rechaza**, y el `seen` del `ble_scan_timeout`— están escritas y coinciden con el
  fuente. La nota bajo RBM2.13 declara lo que **no** se implementó (servicio de ubicación en API ≤ 30) con su
  motivo: eso es exactamente lo que pide la regla de reconciliación.
- `design-ios-ble-mfi.md` §4: el recuadro as-built enumera 4 diferencias contra el flujo de 11 pasos y **las 4
  están en el código**: el paso de la radio con sus tres desenlaces (`:822`, `:830`, `:837`), el techo doble
  (`:855-861` + `:1077`), la **generación de sesión** bumpeada **antes** de remover suscripciones (`:1394`) y el
  framer en la clausura de la sesión (`:968`). §2.2 gana las tres filas que faltaban (`line-framer.ts`,
  `connect-trigger.ts`, `adapter-ingest-mode.test.ts`).
- `tasks-ios-ble-mfi.md`: **T3.1–T3.13 todas `[x]`**, cada una con su nota as-built. La corrección de T3.11
  (que `BOUNDED_AT_THE_BOUNDARY` era el lugar equivocado y habría sido una entrada **vacua**) está bien
  argumentada y la verifiqué: `NATIVE_PRIMITIVES` no matchea **ningún** await del adapter BLE.
- El ⚠️ de "lo que F3 NO deja andando" es **cierto y verificado por mí** [CORRIDO]: el transporte es
  inalcanzable (`adapterForTransport('ble-gatt') → null`).

Correcciones al informe: (a) §6-c afirma *"el único importador de `adapter-ble-gatt` es el provider"* — cierto
en producción, pero el módulo también lo leen como texto `spp-bridge-timeout-guard.test.ts` e
`ios-purpose-strings-guard.test.ts` (detalle sin consecuencia); (b) la trazabilidad de §4 declara para
RBM2.4/2.6/2.8 una cobertura que **no existe** (🟠-1) y hay que corregirla al cerrar el punto 1 de §10.

---

## 7. CHECKPOINTS

| # | Box | Estado |
|---|---|---|
| C1 | archivos base / docs / 5 agentes | `[x]` [LEÍDO] |
| C1 | `check.mjs` exit 0 | `[ ]` **no corrido completo** — §8 |
| C2 | una sola feature `in_progress` · `done` con tests verdes · `current.md` describe la sesión | `[x]` |
| C3 | capas previstas (`services/ble/**`) | `[x]` |
| C3 | deps externas justificadas | `[x]` — `react-native-ble-plx@3.5.1` es de **F2**, con veto FIRME (`progress/veto_ble-plx.md`) |
| C3 | sin logs de debug ni TODOs sin contexto | `[x]` [CORRIDO] los "TODO" del grep son la palabra española en comentarios; cero `console.log/warn/debug` |
| C3 | no se hardcodea `establishment_id` | `[x]` [CORRIDO] cero ocurrencias |
| C4 | ≥1 test por módulo con lógica | `[x]` |
| C4 | fixtures reales, no mocks de I/O crítico sin necesidad | `[ ]` **🟠-1**: los dobles de I/O son correctos, pero el **fixture de datos del driver** es único y por eso tres claims no se pueden falsificar |
| C4 | runner > 0 tests y verdes | `[x]` [CORRIDO] 136/136 y 3275/3275 |
| C4 | RLS cross-tenant | **N/A** (cero DB — RBM9.1/9.3) |
| C5 | artefactos temporales sin trackear | `[x]` para F3 (sus 4 archivos son fuente). Nota: hay `?? .wrangler/` y un `.zip` en el árbol, **de otras terminales** |
| C5 | `history.md` con entrada de la sesión | `[ ]` — cierre de sesión, del leader |
| C5 | feature en su estado correcto | `[x]` (04 sigue `in_progress`; F3 de 8 fases) |
| C6 | los 3 archivos de spec existen | `[x]` |
| C6 | EARS estricto | `[x]` |
| C6 | tasks `[x]` | `[x]` **para F3** (T3.1–T3.13, ninguna `[ ]`). F0/F4–F8 en `[ ]` **por contrato de fases** (ADR-028 Nivel B), no por olvido |
| C6 | cada `R<n>` con ≥1 test concreto | `[ ]` **RBM2.4 / RBM2.6 / RBM2.8 parciales** (🟠-1) |
| C7 | multi-tenant | **N/A** — cero tablas, cero RLS, cero `establishment_id` |
| C8 | offline-first | `[x]` [CORRIDO] cero red en los archivos nuevos; los 136 tests corren sin red |
| C9 | E2E + capturas (ADR-029) | **N/A y no por omisión**: F3 no toca ninguna superficie de UI (todo es `services/ble/` + un `case` en el provider, que no renderiza). La UI del transporte es F4/T4.8 y sus capturas están pedidas en T8.11/T6.6. La corrida de Playwright contra baseline queda del leader (el `expo export -p web` verde lo reporta el implementer) |

---

## 8. Sobre `check.mjs`

**No lo corrí completo, y digo qué corrí en su lugar.** Motivo: sus stages de backend pegan contra la DB remota
**compartida** y hay otra terminal trabajando en el árbol (su diff está en `supabase/functions/health/`,
`scripts/`, `powersync/`, specs 10 y 16); el patrón conocido `Request rate limit reached` fabrica rojos que no
son regresiones, y —como avisó el leader— **un stage rojo impide que corran los posteriores** (`execSync` sin
`try`), así que un RC≠0 no diría nada del resto.

Lo que **sí** corrí, que es donde F3 puede romper algo: **stage 1** (`typecheck client`) → rc=0; el **bloque
completo de unit tests del cliente** → 3275/3275; el **bloque de scripts** → 50/50; y `node --check` sobre
`scripts/run-tests.mjs` (archivo compartido que F3 editó). F3 no toca **ningún** archivo de backend (verificado
con `git status --porcelain` cruzado contra la lista del implementer), así que los stages que no corrí no tienen
superficie donde ser afectados por esta fase.

**Queda pendiente para el cierre del delta (F8): un `check.mjs` verde de punta a punta y `pnpm e2e` contra
baseline.** No lo cuento como hallazgo de F3; lo cuento como el box `[ ]` de C1.

---

## 9. Checklist RAFAQ-específico

**A. Tablas con `establishment_id` / RLS** → **N/A**. RBM9.1: cero migraciones, cero RPC, cero Edge Functions,
cero policies, cero `sync-streams/`. Verificado [CORRIDO] y **atribuible** (§2).

**B. Carga/edición de datos en campo (offline-first)** → **aplica solo en su mitad**:
- [x] Funciona offline: [CORRIDO] cero `fetch(`/`supabase`/`powersync` en los archivos nuevos; los 136 tests
      corren sin red por construcción (RBM9.4).
- **N/A** sync bucket / resolución de conflictos / repositorio local: F3 no persiste **ningún** dato de
  dominio. Lo único que escribe es el bastón recordado (`SecureStore`, local, sin tenant). El EID sigue
  entrando por el motor de spec 09 **sin cambios** (RBM1.8/RBM9.3, verificado en el diff).

**C. BLE (aplica de lleno)**:
- [x] Desconexión repentina: tres fuentes (evento del SO **por device**, sonda de liveness fail-closed, monitor
      que muere) con **un solo** desenlace (`loseLink` → teardown + estado + backoff). Falsificado con 5
      mutantes propios (M-1, M-5, M-6, M-7, M-8).
- [x] Techo en **todo** await del puente + latch liberado en `finally` y en `disconnect()`, con guard estático
      derivado del árbol que hace **nacer en rojo** al adapter de F5. Falsificado (M-2, M-3).
- [x] Modo manual de fallback ≤1 tap: manual-first intacto — el adapter **nunca lanza** hacia afuera y
      `instantiateTransport` devuelve `null` cuando no hay transporte (R7/RBM9.5).
- [x] Los logs BLE no bloquean el flujo del operario: `logTransportEvent` es best-effort (R15.1) y **ningún**
      call site loguea la línea cruda ni el EID (barrí los 26).
- **N/A** correlación TAG↔peso por ventana temporal: es el bridge de la balanza Vesta (ADR-003), no este
  transporte. El delta sí toca el vecindario y lo resuelve bien: el bridge Vesta anuncia los **mismos** UUID
  NUS y el reconocimiento **por nombre** (RBM5.13) es lo que evita que la balanza entre como bastón.
- ⚠️ Gate real pendiente, declarado por la spec y por el informe: **nada de esto leyó de un dispositivo real**
  (RBM6.1, banco `MODO_GATT` en F6, en Android **y** iOS). La lección `dad711f` sigue vigente: un transporte
  "escrito y testeado" sin device tenía tres 🔴 de máquina de estados. Este review **no** habilita a leer F3
  como "el transporte anda".

**D. UI de campo** → **N/A**: F3 no toca pantallas, sheets, formularios ni componentes (ver C9).

**E. Edge Functions** → **N/A**: cero funciones tocadas (§2 / RBM9.2).

---

## 10. Cambios requeridos (lista cerrada)

1. **🟠-1 (bloqueante)** — `app/src/services/ble/adapter-ble-gatt.test.ts`: agregar un **segundo driver
   sintético** con UUID distintos de los NUS **y** `delimiter: '\r'`, ejercido de punta a punta por el adapter,
   que mate los tres mutantes de §5 (`adapter-ble-gatt.ts:1088` filtro del escaneo, `:970-971` monitor, `:968`
   framer). Con anti-vacuidad (asertar que los dos juegos de UUID son distintos).
2. **🟡-2** — `adapter-ble-gatt.test.ts`: test del **destope por tap con intento en vuelo** (mata M-15,
   `adapter-ble-gatt.ts:651`).
3. **🟡-3** — `adapter-ble-gatt.test.ts`: usar o borrar `checkPermission` (`:340`), `clock` (`:344`) y
   `state.cancelDeviceCalls` (`:272`); y sacar `cancelDeviceConnection` de `BleManagerLike`
   (`adapter-ble-gatt.ts:158`) si sigue sin call site de producción — mismo criterio con el que se borró
   `sameUuid()`.
4. **Reconciliación de specs** — al cerrar 1-3: corregir la trazabilidad de RBM2.4/RBM2.6/RBM2.8 en
   `progress/impl_ios-ble-mfi-f3.md` §4 (hoy declara cobertura que no existe) y matizar en la nota de RBM3.1 de
   `requirements-ios-ble-mfi.md` (y en el informe §5) que de la **doble** copia del tope solo la de la cabecera
   está falsificada (⚪-4).
5. **Recomendaciones al leader (backlog, NO trabajo de F3)**: los catch mudos del molde SPP (⚪-5, aplica a los
   **dos** transportes); separar `permission_ios` de `bluetooth_off` en `autoconnect_skipped` (⚪-6); revisar el
   `connect_error` por condición esperada de `isBleGattTransportAvailable()` cuando F4 cablee la selección
   (⚪-7); y las dos que el implementer ya dejó anotadas (servicio de ubicación en API ≤ 30 → escenario de F6;
   `driver-registry.ts` compara UUID con `toLowerCase()` sin expandir la forma corta de 16 bits).

**Lo que NO pido**: nada del código de producción. Los tres hallazgos con acción son de **oráculo** (tests) y de
**exactitud del informe**. El adapter, tal como está, hace lo que la spec dice — lo medí.

---

## 11. Constancia de que el árbol quedó como estaba

Apliqué **20 mutantes** y los revertí todos. Al cierre, **[CORRIDO]**:

- `adapter-ble-gatt.ts`, `adapter-ble-gatt.test.ts` y `ble-gatt-protocol.ts` → **sha256 idéntico** a la copia
  que saqué antes de empezar (`7bfaa9563a30ee101341e88d343da46d4ff17118d3f8e52fb932f2fd07698b86` para el
  adapter).
- `git status --porcelain app/src/services/ble/` → las mismas 11 modificadas + 4 untracked de §2 del informe,
  sin agregados ni faltantes.
- POST-RESTORE de las 5 suites: **136/136**.
- No edité ni una línea de código ni de test. Las sondas propias viven fuera del repo (scratchpad).
