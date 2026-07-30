# Review adversarial — fix de los bloqueantes del camino SPP del bastón (feature 04)

**Rol**: `reviewer` (read-only, no toqué `app/`). **Fecha**: 2026-07-30.
**Unidad revisada**: working tree sobre `d08ed9c` (28 archivos modificados + 7 nuevos: `app/src/services/ble/*`,
`app/src/features/ble-stick/*`, `app/e2e/*`, `scripts/run-tests.mjs`, las 5 specs de 04, `docs/backlog.md`).
**Entradas**: `progress/impl_baston-spp-bloqueantes.md` (incompleto a propósito: sin la tercera pasada) ·
`progress/review_baston-android-spp.md` (el pliego: 2 🔴 · 5 🟠 · 5 🟡 · 5 ⚪) ·
`progress/bench_baston-spp-emulador.md` · `progress/handoff-bluetooth-esp32.md` §2/§3 · `specs/active/04-bluetooth-baston/*`.

## Veredicto

**CHANGES REQUESTED** — **1 🔴 bloqueante** (nuevo, introducido por la tercera pasada, con cero cobertura) ·
**2 🟠** · **4 🟡** · **3 ⚪**.

Las dos primeras pasadas están bien y lo verifiqué mutando el código: los tres 🔴 del pliego y los cuatro 🟠 están
cerrados de verdad, los guards saben fallar, y BENCH-1 ataca la causa raíz correcta (leí el Java yo mismo y el
razonamiento se sostiene). **El problema está donde el leader sospechaba: la tercera pasada** — la que llegó sin
autorrevisión. Su riesgo (b) (`autoConnectExhausted` pegado) está **cerrado**; su riesgo (a) está **abierto en una
forma peor que la que se pidió mirar**: el tope no se filtra a la cadena del operario porque no hay cadena del
operario — se filtra a la vida entera de la sesión, y **mata la reconexión automática de un bastón que estaba
funcionando**.

---

## Método (para que ningún número de acá sea una afirmación)

- **lo leí** = lectura de código (nuestro y el Java de `react-native-bluetooth-classic@1.73.0-rc.17` en `app/node_modules`).
- **lo ejecuté** = lo corrí y vi la salida.
- **Conteo de tests**: `node --test` por archivo, tomando la línea `pass`/`fail` de su resumen. No `grep`.
- **Mutación**: copié `app/src` completo al scratchpad y muté **ahí**, nunca en `app/` (el `git status` del repo
  quedó intacto toda la review). Los guards estáticos leen su fuente con `resolve(HERE, …)`, así que corren igual
  contra la copia.
- **Probes**: 3 archivos `.mjs` en el scratchpad que importan el adapter REAL por `file://` con dobles de `SppEnv`
  (mismo patrón que su suite). Nada quedó en `app/`.

### Verificación ejecutada

| qué | resultado |
|---|---|
| `node scripts/check.mjs` | **RC=0**, *"Entorno listo"*, 18 suites con `fail 0`. **NO incluye Playwright** (es typecheck del cliente + unit del cliente + suites contra la DB remota). |
| `npx tsc -p app/tsconfig.json --noEmit` | **RC=0** (ejecutado por mí, no heredado). |
| Suites del camino, una por archivo | `adapter-spp-android` **94** · `connection-view` **30** · `spp-protocol` **17** · `wiring` **15** · `permissions-android` **13** · `bridge-timeout` **12** · `connect-trigger` **6** · `adapter-ingest-mode` **5** · `spp-bridge-timeout-guard` **4** → **196 pass / 0 fail**. (El 151/6-suites del leader es un subconjunto: no incluye `connection-view`, `connect-trigger` ni `wiring`.) |
| ¿los tests nuevos corren? | los 4 archivos nuevos están en la lista explícita de `scripts/run-tests.mjs` (verificado leyendo la lista, no el diff). |
| `tsc --listFiles` | **ejecutado**: `adapter-selection.ts` y `connect-trigger.ts` **entran** al typecheck; **0** archivos `*.test.ts` entran. El hallazgo de clase del implementer es real y los dos anclas de exhaustividad están en el lugar correcto. |
| Playwright | **NO ejecutado por mí** (ni la spec afectada ni la suite completa). El 4/4 de `baston-multivendor.spec.ts` es del implementer; el sentido de la aserción lo verificó el leader por lectura. Evidencia de segunda mano. |
| Device / banco | **NO ejecutado** (no tengo el rig). Todo lo device-gated queda marcado como tal. |

### Mutación — 6 mutantes propios, corridos por mí sobre la copia

| # | mutante | resultado |
|---|---|---|
| M1 | sacarle el `withTimeout` a `getBondedDevices` | `spp-bridge-timeout-guard` **3 pass / 1 fail** ✅ el guard cae |
| M2 | volver a la comparación de literales de kinds en el provider | `adapter-ingest-mode` **4/1** ✅ cae *"el provider DELEGA en ingestModeFor"* |
| M4 | anular el chequeo de generación post-`connectToDevice` | `adapter-spp-android` **92/2** ✅ caen los dos tests del intento stale |
| M5 | re-poner el gate `this.closed` en `autoConnect` | **93/1** ✅ cae *"el ciclo autoConnect → disconnect → autoConnect"* |
| M6 | el timer arranca cadena `operator` en vez de heredar `retry` | **94/6** ✅ caen 6, incluido *"el presupuesto NO se re-arma"* |
| **M7** | **el candidato de fix del 🔴 de abajo** (terminar la cadena capada al establecer el link) | **104 pass / 0 fail** ❌ **ningún test lo distingue** |

M7 es el hallazgo más importante: **la suite entera está verde con el bug y verde con el fix**. Los 8 tests del
bloque `TOPE:` no pueden ver la diferencia. Es el mismo modo de falla que esta feature ya sufrió tres veces (verde
mentiroso), esta vez dentro del mecanismo que se acababa de escribir para evitarlo.

---

## 1. 🔴 BLOQUEANTE

### 🔴-A · El tope de la cadena `autoconnect` sobrevive a la conexión exitosa: pasados 120 s de haber abierto la app, el primer corte del link mata la reconexión automática — con 0 reintentos y un diagnóstico falso

**Archivos**: `app/src/services/ble/adapter-spp-android.ts:669-677` (`applyChainPolicy`, **el único** lugar que
escribe `retryBudgetUntil`) · `:846-858` (el camino de éxito **no** lo limpia) · `:1058-1068` y `:1096-1099`
(`scheduleReconnect` lo consume, en los dos puntos) · `:1144-1152` (`exhaustUnpromptedChain`).

`retryBudgetUntil` se setea al **arrancar** la cadena (`autoconnect` → `now + 120 s`) y solo se limpia al agotarse o
al arrancar una cadena `operator`. **Establecer el link no lo limpia**, y `retry` hereda. O sea: el presupuesto no
acota "la cadena que nadie pidió" — acota **los primeros 120 s de vida de la app**.

**Ejecutado** (probe con el adapter real + dobles de `SppEnv`):

```
P-A   autoConnect() -> 'connected'; el operario trabaja 5 min; el bastón se apaga (evento del SO)
      -> reintentos programados: 0 · status final: 'off' · autoConnectExhausted: true
      -> [ble] autoconnect_exhausted {"kind":"autoconnect_exhausted","ms":300000,"attempts":0}
P-A2  mismo corte a los 60 s -> 1 reintento, y al cruzar los 120 s muere igual
```

Ese log es la confesión: `attempts:0` con `ms:300000` significa que "la cadena" se declaró agotada **sin haber hecho
un solo intento**. Lo que ve el operario en la manga:

1. el pill del chrome **desaparece** (`StickStatusIndicator.tsx:107`: `'off'` es el único estado que se auto-oculta);
2. la app **deja de intentar** por el resto de la sesión (antes de esta pasada reintentaba cada 8 s y volvía sola);
3. el que va a `/baston` lee **"No encontramos el bastón — puede estar apagado o fuera de rango"** sobre un bastón
   que estaba conectado tres segundos antes. No es un copy inexacto: es un **diagnóstico inventado**, que es
   justamente lo que el leader marcó como "peor que el bug original".

**Y compone con la sonda de liveness** (probe ejecutado): un `isDeviceConnected` que no resuelve es fail-closed →
teardown de un socket **vivo** + reconexión (precio aceptado y documentado, ~1-2 s). Pero sobre una sesión de más de
120 s deja esto:

```
[ble] liveness_lost {"reason":"poll","message":"bridge_timeout:is_device_connected:30ms"}
[ble] autoconnect_exhausted {"ms":200000,"attempts":0}
status final: 'off' · exhausted: true · reintentos: 0
```

o sea: **un puente momentáneamente lento desactiva el bastón por el resto de la sesión** y le echa la culpa al bastón.

**Contradice tres fuentes, en orden de jerarquía**:

- **R6.4** (`requirements.md:104`), textual: *"Cuando la app abre **o el bastón recordado vuelve a estar en rango**,
  el sistema deberá reconectar automáticamente … con backoff incremental"*. As-built, la segunda mitad del EARS deja
  de cumplirse a los 120 s para **toda** sesión que arrancó sola — que después de esta misma unidad es el caso normal.
- **RMV5.5** (reconexión con backoff, foreground-only), por lo mismo.
- **El propio `docs/backlog.md`** de esta unidad, que escribió la intención: *"topear la cadena que arrancó **sin
  gesto** y dejar **sin tope la que arrancó con una conexión establecida**"*. La segunda mitad no se implementó.
  `design-multivendor.md` §6-quater y la nota de R6.4 justifican el tope con el caso "bastón vendido / roto / que
  quedó en otro campo" — un bastón que **nunca conectó**. El código no distingue ese caso.

**Cobertura**: ninguna. El bloque `TOPE:` tiene el caso simétrico del operario
(`adapter-spp-android.test.ts:1779` *"un corte DESPUÉS de una conexión del operario no hereda ningún tope"*) y **no
tiene el del arranque**. El más cercano (`:1708`) verifica que una conexión lograda dentro del presupuesto no lo
sufre, pero **no corta después**. M7 lo confirma: el fix candidato pasa 104/104 sin tocar un test.

**Qué pido**: que una conexión **establecida** termine la cadena capada (`retryBudgetUntil = null` en el punto de
éxito, junto a `:846-848`; conceptualmente: el presupuesto pertenece a la cadena, y una cadena que llegó a
`'connected'` terminó). Más **el test que falta**, con el nombre del caso: *"un corte después de una conexión del
ARRANQUE reintenta indefinidamente"*, dejando vivo el del bastón que nunca apareció.

---

## 2. 🟠 SERIOS

### 🟠-B · Un `connect()` del operario que llega con un intento en vuelo sigue siendo un no-op MUDO — y ahora tampoco destraba el tope

**Archivos**: `adapter-spp-android.ts:632-636` (`runConnect` → `queueTarget` y `return`, **sin** `applyChainPolicy`)
y `:688-693` (`queueTarget` descarta `deviceId == null` y el mismo target, **sin log**).

El fix del 🟠-2 del pliego encoló el caso "otro bastón" con `connect_superseded`. Los otros dos casos siguen mudos, y
su justificación escrita (*"un `connect()` SIN target no encola nada: el intento en curso ya es eso"*) era verdadera
en la primera pasada y **quedó falsa con la tercera**: el intento en curso puede pertenecer a una cadena **capada**, y
el tap significa "quiero que insista". Y es el camino más probable, porque el atajo que el operario tiene a mano llama
`connect()` **sin target**: `BleConnectionChip.tsx:52-55`, renderizado en `app/app/(tabs)/animales.tsx:325` y en
`app/app/maniobra/identificar.tsx:599`.

**Ejecutado** (probes P-B y P-C): con un intento del arranque en vuelo, `connect()` y `connect(MAC)` del operario no
generan nada — ni estado, ni log, ni cambio de política — y la cadena muere igual al vencer el presupuesto.

**Qué pido**: que un `connect()` de trigger `operator` con el latch tomado **al menos** re-aplique la política de su
cadena (destope) y deje log. Es la mitad del 🟠-2 que quedó abierta ("como mínimo emitir un estado/log").

### 🟠-C · Gate 2.5: el único cambio VISIBLE de la tercera pasada no tiene evidencia visual ni un N/A documentado

`connection-view.ts:162-171` agrega un estado **nuevo** de la card de conexión (label + hint + CTA). El capture file
de la unidad (`app/e2e/captures/baston-spp-bloqueantes.capture.ts:6-8`) sigue afirmando *"OCHO de los nueve arreglos
no tienen superficie visual … el ÚNICO cambio visible es BENCH-3"* — cierto cuando se escribió, falso ahora.

Es probable que el estado sea **estructuralmente inalcanzable** en el E2E web (`autoConnectExhausted` sale de
`spp-android`; el E2E corre `mock`/`simulator`), y entonces un N/A es legítimo — pero **hay que escribirlo**, con el
precedente que esta misma spec ya usó (`T-MV.7.2` declaró N/A `available:false` y `unrecognized`, cubiertos por
`connection-view.test.ts`). Hoy el copy nuevo entra a producción sin que nadie lo haya visto renderizado. La lógica sí
está cubierta: 4 tests puros nuevos en `connection-view.test.ts` (copy, CTA, tono, y que el flag no contamine los
otros estados). Verificado además que no recorta: el hint nuevo (~180 caracteres) se renderiza sin `numberOfLines` y
con `lineHeight` matcheado (`StickConnectionScreen.tsx:319-324`).

---

## 3. 🟡 MENORES

- **🟡-D · El pliego §9.7 quedó a medias.** La review pidió *"completar (o marcar como imposible) la autorrevisión
  vacía de `progress/impl_baston-android-spp.md`"*. Los **seis** placeholders siguen vacíos (`:135` OUTPUT_CHECK,
  `:139` OUTPUT_GRADLE, `:143` OUTPUT_E2E, `:149` GATED, `:155` SELFREVIEW, `:161` RECONCILE) y el archivo no se
  volvió a tocar desde `dad711f`. La otra mitad del ítem (reconciliar RMV5.2 / T-MV.5.2 / `tasks.md` core) **sí** está
  hecha y la verifiqué en el diff. Es el mismo modo de falla que encabeza el informe de esta unidad.
- **🟡-E · Números sin método, otra vez** (era el 🟡-5 del pliego). `tasks-multivendor.md` T-MV.5.17 dice
  `bridge-timeout.test.ts (13)` — **medí 12** — y *"39 → 71 casos"* cuando el archivo hoy tiene **94** (pasadas 2 y 3).
  Y **T-MV.5.7 sigue `[ ]`** con aceptación *"documentado en `progress/impl_baston-emulator-esp32.md`"*, cuando sus 10
  sub-escenarios (a…j) se corrieron y quedaron documentados en `progress/bench_baston-spp-emulador.md`. Una task
  abierta que ya está cerrada es tan mala señal como una cerrada que no lo está.
- **🟡-F · `design-multivendor.md` §6-ter describe un gate que el código deliberadamente NO tiene.** El pseudocódigo de
  `autoConnect()` dice *"ya hay link / hay intento en curso / **el operario desconectó** => skip('busy')"*. El as-built
  **no** mira `this.closed`, y no por olvido: es el hallazgo 14 de la autorrevisión (ese gate mataba R6.4 en silencio)
  y hay un test que lo caza — **lo verifiqué con M5**. El design documenta exactamente el bug que se mató.
- **🟡-G · `docs/backlog.md` ítem 2 quedó viejo.** Describe *"`scanning` sin CTA y sin tope de reintentos"* como
  pendiente y escalado, cuando la tercera pasada implementó el tope de la cadena sin gesto; y su propia "opción barata"
  es la parte que quedó a medias (🔴-A). Reconciliar: qué se hizo, y qué queda (el `scanning` de la cadena del
  operario sigue sin CTA y sin tope — que es lo correcto y decidido).

## 4. ⚪ NOTAS

- **⚪-H · Límite no declarado del guard de timeouts.** `spp-bridge-timeout-guard.test.ts:55-66` escanea los `await`
  **por línea**, así que un member-expression partido (`await native` + newline + `.foo()`) no matchea `BRIDGE_EXPR` y
  escapa. El guard declara honestamente su límite (a) (promesa guardada en variable) pero no este. Cuesta una línea:
  normalizar el whitespace antes de escanear, o declararlo.
- **⚪-I · La cola de `pendingTarget` promueve a `operator` cualquier target encolado** (`:652-661`), y `queueTarget`
  se alcanza desde **cualquier** trigger. En la ventana entre `:643` (`inFlightTarget = target ?? null`) y `:782`
  (`inFlightTarget` = el target resuelto), un `retry` encolado se convertiría en una cadena **sin** tope. Es angosta
  (`doConnect` cancela el reintento pendiente en su segunda línea, así que un timer casi no puede disparar ahí) y su
  efecto es el comportamiento pre-fix, no una mudez. No bloqueante; queda escrito porque el propio guard de call-sites
  declara que no puede ver si el trigger elegido es el correcto.
- **⚪-J · Lo que la sonda de liveness NO puede cubrir, y es device-gated.** El mecanismo es correcto y verifiqué la
  causa raíz en el Java yo mismo: el único emisor que llega a nuestro listener es `onACLDisconnected` vía
  `sendEvent(EventType, WritableMap)`, que **descarta** el evento sin Catalyst instance activa
  (`RNBluetoothClassicModule.java:1398-1408`), y el otro (`onDisconnect`, `:1157-1166`) publica en
  `DEVICE_DISCONNECTED@<address>`, al que `onDeviceDisconnected` **no** está suscrito (`BluetoothModule.js:336-338`).
  `isDeviceConnected` es `mConnections.containsKey` (`:939-946`) y ese mapa lo limpian los **dos** caminos en Java. Todo
  eso se sostiene. Lo que queda fuera de alcance desde JS es un `mConnections` que **mienta** (socket muerto, clave
  presente): ahí la única traza sería `connected_silent` cada 15 s a partir de los 45 s y el estado seguiría diciendo
  "conectado". El oráculo es `BENCH1` en device — **hoy no verificado**. Lo demás del poll: no queda colgado (su await
  tiene presupuesto y el re-armado es posterior y sincrónico), muere en el teardown (`:1179-1186`) y no pisa un connect
  en vuelo (early-return por `inFlightGen` + re-chequeo post-await, `:1025` y `:1041`) — leído y ejecutado.

---

## 5. Predicciones falsables para el re-run del banco (25 escenarios)

**Aviso previo sobre cómo leer el resultado**: `ensure_connected()` (`run-bench.py`) devuelve `True` **sin tapear** si
la app ya está conectada. Con R6.4 implementado, en el run nuevo la app va a auto-conectar sola al arrancar, así que
los escenarios que dependen de `ensure_connected` van a heredar **la cadena capada del arranque** en vez de una cadena
`operator`. Y los `COUNTING` consumen ~145 s antes de llegar a `E13`. O sea: **E13 / E14 / E15 / BENCH1 pueden salir
rojos por 🔴-A y no por lo que miden**. Si pasa, no es flake: es la confirmación.

| # | escenario | qué predigo si 🔴-A es real | qué lo falsifica |
|---|---|---|---|
| 1 | **COLD-DROP (nuevo, es el que pido)**: `ensure_connected` → `drop` → force-stop → relanzar **sin tocar nada** (confirmar `emu.linked()` = CONECTADO, o sea R6.4 ok) → esperar **≥130 s** sin tocar la app → `drop` | **cero** `reconnect_attempt` en logcat; un `autoconnect_exhausted {"ms":≥130000,"attempts":0}`; pantalla en *"No encontramos el bastón"*; pill del chrome **ausente**; `emu.linked()` libre indefinidamente | aparece `reconnect_attempt attempt:0` y el link vuelve → 🔴-A cae |
| 2 | E13 `drop` / E14 `off 8000` / BENCH1, corridos **>120 s** después del arranque y **sin ningún tap previo** | rojos, con `autoconnect_exhausted attempts:0` y **sin** `reconnect_attempt` | verdes con la escalera de reintentos → 🔴-A cae (y entonces `ensure_connected` tapeó: revisar el log del runner) |
| 3 | **CAP** y **CAP-RESET** | **✅ los dos, con el 🔴 puesto**: CAP es el caso "nunca conectó" y CAP-RESET prueba el destrabe por tap. **No sirven como oráculo de 🔴-A** — importante no leerlos como cobertura | — |
| 4 | 🟠-B: con el arranque auto contra un bastón ausente, tocar el chip del header en la tab Animales mientras la card dice *"Conectando…"* | **nada** en logcat (ni `connect_superseded` ni un `connecting` nuevo) y la app se rinde igual a los 120 s aunque el operario tocó | aparece un log o la cadena pasa a indefinida → 🟠-B cae |
| 5 | LATCH · E15 (`flap` con backoff creciente) · `term cr` + `read 5` (→ `connected_silent` a los ≥45 s) · COLD · COLD-BTOFF | **verdes** — son las pasadas 1 y 2, cuyo mecanismo verifiqué en código y con mutantes | cualquier rojo acá invalida algo de lo que doy por cerrado abajo |

---

## 6. El pliego, ítem por ítem (§9 de `review_baston-android-spp.md`)

| # | pedido | estado | evidencia |
|---|---|---|---|
| 1 | 🔴-1 timeout en cada await + `disconnect()` libera el latch + tests con promesas que no resuelven | ✅ **cerrado** | `bridge-timeout.ts` (12 tests) + guard (4) + `:815/:836/:856/:897/:915`; el `finally` de `runConnect:649-651` y el `disconnect():930-931` los fija el guard `:100-109`. Mutante M1 ✅ |
| 2 | 🔴-2 filtrar el evento por dirección + test con otra MAC | ✅ **cerrado en código** (`:879-894`; tests `:952/:972/:986`) · **device-test pendiente** (2º device Classic), declarado |
| 3 | 🟠-1 foreground **al disparar** + ningún diálogo del SO desde un timer | ✅ **cerrado** | `:1105-1108` + `:797-806`; tests `:1232/:1314/:1340`; la política sale de la tabla (`policyFor`), no de un booleano. Mutante M6 ✅ |
| 4 | 🟠-2 un `connect()` con otro target no se descarta mudo | ⚠️ **parcial** → 🟠-B | el caso "otro target" sí (`:1255`); "sin target" y "mismo target" siguen mudos y ahora se comen el destope |
| 5 | 🟠-3 decisión de Raf sobre R6.4 | ✅ **implementado** (13 tests + 2 guards de wiring) … ⛔ **pero introdujo 🔴-A** |
| 6 | 🟠-4 guard de re-entrada + timeout en `loadPaired()` | ✅ **cerrado** | coalesce `:301-318` + guard de pantalla `StickConnectionScreen.tsx:212-241` + caída a `error`; tests `:1352/:1363/:1370/:1377` |
| 7 | 🟡-4 reconciliar RMV5.2 / T-MV.5.2 / `tasks.md` core **+ la autorrevisión vacía** | ⚠️ **parcial** → 🟡-D | specs reconciliadas ✅; los 6 placeholders siguen vacíos ❌ |
| — | 🟡-1 `isRawStream` derivado + guard sobre la ausencia | ✅ **cerrado** | `ADAPTER_INGEST_MODE` + ancla en el **módulo** (verificado con `tsc --listFiles`), 5 tests. Mutante M2 ✅ |
| — | 🟡-3 dwell del backoff | ✅ **cerrado** | `LINK_DWELL_MS` + `:1078-1081`; tests `:569/:593` |
| — | 🟠-5 delimitador del driver + watchdog de mudez | ✅ **cerrado** | `delimiter?` en `TransportCapability`, `sppDelimiterIsSupported` (corta con log), `connected_silent`; tests `:1197/:1214/:1133/:1154` + 4 puros |
| — | BENCH-1 | ✅ **mecanismo correcto** (⚪-J) · device-gated |
| — | BENCH-2 | ✅ **declarado irreparable desde JS**, con la mudez ahora logueada |
| — | BENCH-3 | ✅ **cerrado** (scanner acotado + `useFocusEffect`); E2E corregida a la invariante nueva, con aserción por **ausencia** del testID exclusivo. **No lo ejecuté yo** |
| — | 🟡-5 números sin método | ⚠️ **se repite** → 🟡-E |

### Las cinco mudeces del pliego (§6 de la review anterior)

1. `isRawStream` sin `spp-android` → **cerrado** (tabla exhaustiva + ancla en módulo + guard del call site).
2. `isSppNativeAvailable()` falso-negativo → **sigue abierto**, en el backlog, sin cobertura del camino positivo (el
   `require` de `react-native` es directo). Sin cambios en esta unidad; correcto que quede afuera.
3. Delimitador ≠ LF → **cerrado** (sale del driver, corta con log, y la mudez deja rastro).
4. Latch de `connectInFlight` → **cerrado** (timeouts + generación + guard sobre la ausencia).
5. Evento de desconexión ajeno en loop → **cerrado** (filtro por dirección).

**Y una sexta, nueva, que introdujo esta unidad**: 🔴-A. La app no se queda muda mintiendo "conectado" — se queda muda
**habiendo dejado de intentar**, con el pill oculto y un diagnóstico falso en la pantalla de conexión. Con la suite
entera en verde (M7). Es la misma clase por cuarta vez, y esta vez la produjo el mecanismo escrito para cerrarla.

---

## 7. Trazabilidad requisito → test (verificado que existe y corre)

| requisito / hallazgo | test |
|---|---|
| RMV5.5 n.1 · BENCH-1 (foreground, poll, socket vivo, fail-closed, lib sin sonda, sin timers huérfanos) | `adapter-spp-android.test.ts:1001/1025/1043/1057/1072/1104/1173/1184` |
| RMV5.5 n.2 · 🔴-1 (3 awaits colgados, latch, generación, label del vencimiento) | `:815/:836/:856/:868/:897/:915` + `bridge-timeout.test.ts` (12) + `spp-bridge-timeout-guard.test.ts` (4) |
| RMV5.5 · 🔴-2 (evento ajeno, case-insensitive, sin dirección) | `:952/:972/:986` |
| RMV5.5 n.3 · 🟠-1 (foreground al disparar) | `:1232` |
| RMV5.5 n.5 · ningún diálogo del SO desde un timer (BT **y** permisos) | `:1314/:1340/:1567` + `connect-trigger.test.ts:70` |
| RMV5.5 n.4 · 🟡-3 dwell | `:569/:593` |
| RMV5.5 · 🟠-2 otro target | `:1255/:1280/:1295` (⚠️ `:1280` testea el caso "sin target" **como no-op deseado**: hoy ese test es la fotografía de 🟠-B) |
| RMV3.2 · 🟠-4 lista de emparejados | `:1352/:1363/:1370/:1377` |
| RMV5.2 / RMV5.3 · 🟠-5 delimitador + mudez | `:1197/:1214/:1133/:1154` + `spp-protocol.test.ts` (4 nuevos) |
| RMV5.3 / RMV1.1 · 🟡-1 modo de ingesta | `adapter-ingest-mode.test.ts` (5) + `tsc` (ancla en el módulo, verificado con `--listFiles`) |
| RMV3.1 / RMV4.8 · BENCH-3 | `app/e2e/baston-multivendor.spec.ts` (b) — no ejecutado por mí |
| R15 · los 6 kinds de log nuevos | `wiring.test.ts:103` |
| **R6.4** (arranque: gates, orden, sin diálogos, idempotencia, ciclo del efecto, fallos) | `:1395…:1567` (13 casos) + `permissions-android.test.ts` (6) + `wiring.test.ts:131/141` |
| **R6.4 · tope de la cadena sin gesto** | `:1612/:1640/:1662/:1686/:1708/:1727/:1751/:1779` + `connect-trigger.test.ts` (6) + `connection-view.test.ts` (4) + `wiring.test.ts:157` |
| **R6.4 · "vuelve a estar en rango" para una cadena que arrancó SOLA** | ❌ **NINGUNO** — es el hueco de 🔴-A. Existe el simétrico del operario (`:1779`) y falta el del arranque |

**Tasks completas: sí, con una desactualizada.** `tasks-multivendor.md` fase MV.5-bis tiene **T-MV.5.8 … T-MV.5.17,
T-MV.5.19 y T-MV.5.20** en `[x]`, y **T-MV.5.18** en `[ ]` con justificación explícita (el banco en device lo corre el
leader). Las otras abiertas del archivo están gated con motivo (RS420 físico, MFi, GATT, QA de campo, housekeeping),
salvo **T-MV.5.7**, que está `[ ]` pero ya se corrió (🟡-E). `tasks.md` (core) reconciliado: T4.0/T4.1/T4.3/T4.5/T4.6 y
T6.1/T6.2/T6.3 a `[x]`, con el motivo escrito de las que siguen abiertas.

---

## 8. CHECKPOINTS.md

| # | box | estado |
|---|---|---|
| C1 | archivos base / docs / 5 agentes / `check.mjs` rc=0 | **[x]** — `check.mjs` **RC=0** ejecutado por mí; **sin Playwright** |
| C2 | ≤1 feature `in_progress` · `done` con tests verdes · `current.md` describe la sesión | **[x]** — `current.md` actualizado en el diff; `feature_list.json` no cambia (bugfix sobre 04) |
| C3 | capas de `architecture.md` · deps justificadas · sin logs de debug ni TODOs · sin `establishment_id` hardcodeado | **[x]** — ejecutado: **0** `console.log/warn/debug`, **0** marcadores TODO/FIXME (los hits de "TODO/TODOS" son español), **0** `establishment_id` en `services/ble` y `features/ble-stick`, **0** dependencias nuevas |
| C4 | ≥1 test por módulo con lógica · fixtures reales · runner >0 y verde · RLS cross-tenant | **[x]** — los 4 módulos nuevos tienen suite propia; **196 pass / 0 fail** medidos; RLS **N/A** |
| C5 | sin artefactos sin trackear · `history.md` · feature en su estado | **[ ]** — se cierra al commitear (hoy todo en working tree). Verificado: `__shots__/` **ignorado** (`app/.gitignore:29`, `git check-ignore` ejecutado) y **cero** `design/**/*.png` re-renderizados |
| C6 | 3 archivos de spec · EARS · tasks `[x]` · cada `R<n>` con ≥1 test | **[ ]** — por la última columna: R6.4 tiene tests del arranque y del tope, pero **su segunda cláusula ("vuelve a estar en rango") no tiene ninguno para la cadena del arranque**, y el as-built la incumple (🔴-A) |
| C7 | multi-tenant | **N/A** — sin tablas, sin RLS, sin migraciones |
| C8 | offline-first | **[x]** — nada de lo agregado toca la red; `offline-noread.test.ts` verde dentro de `check.mjs`. Bucket / conflictos **N/A** |
| C9 | E2E verde · capture de cada estado clave · Gate 2.5 · `__shots__` no commiteados | **[ ]** — E2E existe y (según el implementer) 4/4, **no ejecutada por mí**; `__shots__` bien ignorados; **falta la captura —o el N/A escrito— del estado nuevo de la tercera pasada** → 🟠-C |

---

## 9. Checklist RAFAQ-específico

**A. Multi-tenancy / RLS** — **N/A**: la unidad no crea ni toca tablas; cero `establishment_id` en el diff (ejecutado).

**B. Offline-first** — aplica parcialmente (es transporte, no carga de datos).
- [x] Funciona offline: nada del camino nuevo hace red; `offline-noread.test.ts` verde en `check.mjs`.
- [ ] N/A · sync bucket (no hay tabla nueva).
- [ ] N/A · resolución de conflictos.
- [x] La pantalla no hace requests síncronos a Supabase (solo puente nativo y SecureStore).

**C. BLE (Vesta / Allflex)** — aplica de lleno.
- [ ] **Manejo de desconexión repentina del dispositivo (timeout + UI clara)** — **NO**. Los timeouts están y están
  bien (`bridge-timeout.ts`, 3 presupuestos, guard sobre la ausencia) y la detección mejoró mucho (filtro por
  dirección + sonda de foreground + poll de 15 s). Pero **la desconexión repentina de una sesión de más de 120 s no se
  maneja**: no reintenta, oculta el indicador y la UI da un diagnóstico falso (🔴-A). Es el box que bloquea.
- [x] Modo manual de fallback en ≤1 tap: intacto (hero manual promovido + `InfoNote` en todos los estados; el hint
  nuevo dice explícitamente *"podés cargar a mano"*).
- [ ] N/A · correlación TAG↔peso (no hay balanza en esta unidad).
- [x] Los logs BLE no bloquean el flujo: `logTransportEvent` es best-effort y no tira ni con `console` roto
  (`wiring.test.ts:103`, ejecutado).

**D. UI de campo** — aplica solo por el copy nuevo de la card de conexión.
- [x] Botones ≥60dp: sin cambios de layout; el CTA reusa el `Button fullWidth` ya vetado.
- [x] Fuente y recorte: `fontSize="$5" lineHeight="$5"` en el label y `$3/$3` en el hint, **sin** `numberOfLines`
  (`StickConnectionScreen.tsx:319-324`) → el hint nuevo, más largo, envuelve y no recorta descendentes.
- [x] Una decisión por pantalla: un solo CTA por estado.
- [x] Estado de loading visible: `connecting` → *"Conectando…"*, `scanning` → *"Reintentando…"*.
- [ ] **Falta la evidencia visual del estado nuevo** (o su N/A escrito) → 🟠-C.

**E. Edge Functions** — **N/A**: no hay funciones ni endpoints en esta unidad.

---

## 10. Cambios requeridos (lista de cierre)

1. **🔴-A** — `adapter-spp-android.ts`: una conexión **establecida** tiene que terminar la cadena capada
   (`retryBudgetUntil` a `null` en el punto de éxito, junto a `:846-848`). Más el test faltante *"un corte después de
   una conexión del ARRANQUE reintenta indefinidamente"* (gemelo de `:1779`), dejando vivo el del bastón que nunca
   apareció. Reconciliar `requirements.md` R6.4, `design-multivendor.md` §6-quater y `docs/backlog.md` ítem 2.
2. **🟠-B** — `adapter-spp-android.ts:632-636` y `:688-693`: un `connect()` con trigger `operator` y el latch tomado
   tiene que re-aplicar la política de su cadena (destope) y dejar log. Test con el camino real del chip: tap sin
   target durante un intento del arranque → la cadena deja de tener tope.
3. **🟠-C** — capturar el estado `autoConnectExhausted` en el `.capture.ts` **o** declararlo N/A por escrito
   (precedente `T-MV.7.2`) y corregir el encabezado del capture file, que hoy afirma que el único cambio visible es
   BENCH-3.
4. **🟡-D** — cerrar los 6 placeholders de `progress/impl_baston-android-spp.md` (llenarlos o marcarlos imposibles con
   el motivo). Era el ítem 7 del pliego.
5. **🟡-E** — corregir los números de `tasks-multivendor.md` T-MV.5.17 (12, no 13; y el conteo del adapter) y cerrar
   **T-MV.5.7** apuntando al informe del banco que la cerró.
6. **🟡-F** — sacar *"el operario desconectó"* del paso 0 del pseudocódigo de `autoConnect()` en
   `design-multivendor.md` §6-ter: el código deliberadamente **no** mira `this.closed`.
7. **🟡-G** — reconciliar `docs/backlog.md` ítem 2 con la tercera pasada.
8. Opcionales (⚪-H, ⚪-I): declarar el límite por-línea del guard de timeouts; anotar que `pendingTarget` promueve a
   `operator` cualquier target encolado.

**Nada de esto invalida la arquitectura ni las dos primeras pasadas**, que son un trabajo sólido: los tres 🔴 del
pliego están cerrados de verdad, los guards saben fallar (los rompí yo), y la causa raíz de BENCH-1 está bien
identificada en el Java. El bloqueante es un mecanismo nuevo —el tope— que le puso un vencimiento involuntario a la
reconexión automática de toda la sesión. Es un cambio chico y un test.

---
---

# ADENDA — verificación del fix-loop (2026-07-30, misma sesión)

**Alcance**: solo mis hallazgos + lo que el fix pudo romper al pasar. No re-revisé la unidad entera.
**Diff revisado**: 8 archivos, obtenido comparando la copia que me guardé del árbol al momento del review
(`scratchpad/mut/src`, 03:36-03:37) contra `app/src` (04:04-04:17). Son
`adapter-spp-android.ts` · `adapter-spp-android.test.ts` · `logging.ts` · `wiring.test.ts` ·
`spp-bridge-timeout-guard.test.ts` · `StickConnectionScreen.tsx` · `contexts/AuthContext.tsx` ·
`services/account.ts`. Más las specs, `docs/backlog.md`, la capture y
`progress/impl_baston-android-spp.md`.

## Veredicto nuevo

**APPROVED** — el 🔴 y los dos 🟠 cerrados y **verificados con los mismos oráculos que los encontraron**;
los cuatro 🟡 y el ⚪-H cerrados. Quedan **2 verificaciones pendientes** (ninguna es un cambio de código:
el re-run de la E2E tras el último cambio, y el banco en device) y **3 ⚪ nuevos** que el fix-loop dejó
como residuo, todos de backlog.

## Lo que ejecuté (no leí)

| # | mutante / probe | resultado |
|---|---|---|
| **M7-inv** | **revertir el fix del 🔴-A** (sacar `retryBudgetUntil = null` del punto de éxito) | **99 pass / 3 fail** ✅ la ceguera se cerró: caen *"un corte DESPUÉS de una conexión del ARRANQUE reintenta"*, *"sigue reintentando indefinidamente"* y *"un teardown por LIVENESS de un link establecido tampoco mata la reconexión"*. Antes del fix-loop, el mismo mutante pasaba **104/104** |
| P-A / P-A2 | mis dos probes originales del 🔴-A, sin tocarles una línea | **dados vuelta**: corte a los 5 min → `reconnect_attempt attempt:0`, `scanning`, `exhausted: false`. A los 60 s → reintenta y **reconecta** |
| P-liveness | el compose que marqué (sonda colgada sobre sesión > 120 s) | **dado vuelta**: `liveness_lost` → `reconnect_attempt` → `scanning`, `exhausted: false` |
| P-B / P-C | tap del operario (sin target / mismo target) con el intento del arranque en vuelo | **dados vuelta**: `connect_reasserted {"trigger":"operator"}` y, tras el corte posterior, **reintenta** (la cadena quedó destopada) |
| **M4** | re-corrida **después** del test corregido: anular el chequeo de generación post-`connectToDevice` | **99/3** ✅ el test corregido **no compró verde**: sigue cayendo, y ahora arrastra uno más (`MEDIUM-1`) |
| M8 | `canCloseOrphanSocket` → siempre `true` (comportamiento pre-MEDIUM-1) | **101/1** ✅ cae la aserción corregida |
| M9 | `canCloseOrphanSocket` → siempre `false` (nunca cierra) | **100/2** ✅ caen los dos del cierre legítimo. **Las dos direcciones están fijadas** |
| M10-bis | invertir el orden tope↔foreground **en el callback del timer** | **101/1** ✅ cae *"una cadena con presupuesto vencido MUERE aunque la app esté en background"* |
| M11 | sacar el chequeo del tope del callback (dejarlo solo al programar) | **101/1** ✅ cae el mismo test → el zombi del bolsillo está guardado |
| M12 | sacar el gate de **foreground** del callback (mi 🟠-1 original) | **101/1** ✅ cae *"🟠-1: si la app se fue a background entre armar y disparar, NO se conecta (R6.9)"* |
| **M13** | un await del puente **partido en dos líneas** (⚪-H) | ✅ el guard **endurecido** cae y **nombra archivo:línea**; con el guard **viejo** el mismo mutante pasa **4/0**. La corrección es load-bearing, no cosmética |

**M11 + M12 juntos son la respuesta a lo que pediste confirmar**: el orden vigente es **tope → foreground**
en los dos lugares donde se evalúa (`adapter-spp-android.ts:1107-1113` en `scheduleReconnect` y
`:1138-1148` en el callback del timer), y cada mitad tiene **su propio** test que cae si se la saca. O sea:
el arreglo del zombi del bolsillo **no se llevó puesto** mi 🟠-1 — coexisten y los dos están guardados.

### Suites y entorno (ejecutado por mí)

| qué | resultado |
|---|---|
| Suites del camino, `node --test` por archivo | `adapter-spp-android` **102** · `connection-view` **30** · `spp-protocol` **17** · `wiring` **17** · `permissions-android` **13** · `bridge-timeout` **12** · `connect-trigger` **6** · `adapter-ingest-mode` **5** · `spp-bridge-timeout-guard` **4** → **206 pass / 0 fail** (era 196) |
| Todo el camino BLE junto | **315 pass / 0 fail** |
| `npx tsc -p app/tsconfig.json --noEmit` | **RC=0** |
| `node scripts/check.mjs` | **RC=0**, *"All tests passed"* / *"Entorno listo"*, **18 suites con `fail 0`** y cero `fail > 0` en todo el log. **NO incluye Playwright** |
| Tests nuevos registrados | los 4 archivos nuevos siguen en la lista explícita de `run-tests.mjs`; el fix-loop no agregó archivos, solo casos |

### El rojo de `check.mjs` que reportó el implementer: **es flake, confirmado por mí**

No lo tomé por dado y no lo cierro "por conveniencia": corrí `check.mjs` completo yo, con el mismo código,
y la **suite de Edge Functions pasó** — `47 tests / 42 pass / 0 fail / 5 skipped`, con el bloque
`delete_account (T6.3)` en **6,8 s** en total y su test más caro (`Test 8 — HIGH/IDOR: RPC
delete_account_tx NO invocable por authenticated`) en **549 ms**. Contra los **39,6 s** de un solo test que
reportó él, eso es exactamente la firma de contención de la DB remota compartida, no una regresión: el
mismo código, la misma suite, verde. Coincide con el flake ya documentado del proyecto (rate-limit / dos
terminales sobre la misma DB) y con que esta noche corrimos los tres en paralelo.

## Mis hallazgos, uno por uno

| # | estado | verificación |
|---|---|---|
| **🔴-A** | ✅ **CERRADO** | `retryBudgetUntil = null` en el punto donde el link se establece (`:875`), con el invariante escrito en código **y** en `requirements.md` R6.4 (*"el presupuesto pertenece a la cadena, y una cadena que llegó a `'connected'` terminó"*) + `design-multivendor.md`. **5 casos nuevos escritos desde el requisito**, no desde el mecanismo (asertan reintentos/estado/flag, no el campo privado), con las dos contrapruebas: la cadena que **nunca** conectó **sigue topeada**, y el corte **dentro** del presupuesto también reintenta. M7-inv **falla 3**. Mis dos probes, dados vuelta |
| **🟠-B** | ✅ **CERRADO** | `runConnect` re-aplica la política cuando el trigger no es `inherit` y **siempre** loguea (`connect_reasserted`, con el trigger). Verificado con mis probes P-B/P-C + 2 tests nuevos, uno de ellos por el camino real del chip. Detalle que me importaba: `autoconnect` **no puede** entrar por ahí (sus tres gates chequean `inFlightGen` sin await de por medio), así que el destope no se puede invertir en un *tope* sobre la cadena del operario |
| **🟠-C** | ✅ **CERRADO** | la capture declara los **dos** cambios visibles como **N/A del E2E web** con el motivo estructural verificado por mí: el estado agotado sale de `transport.autoConnectExhausted` (solo `SppAndroidAdapter`) y el CTA "Olvidar" vive dentro de `{isSpp ? …}` (`StickConnectionScreen.tsx:393`), y en web el transporte es `web-serial`/`mock`/`simulator`. Usa el precedente de `T-MV.7.2`. La lógica sí tiene tests puros |
| **🟡-D** | ✅ **CERRADO** | 3 placeholders reconstruidos con evidencia de tercero y punteros, 3 marcados **IMPOSIBLE DE RECONSTRUIR** con el motivo. La autorrevisión dice *"esa autorrevisión nunca se hizo"* en vez de rellenarla: **coincido con el leader, es la decisión correcta** — un output inventado habría sido peor que el vacío, y este placeholder es el mejor argumento a favor de la regla que lo prohíbe |
| **🟡-E** | ✅ **CERRADO** | T-MV.5.17 trae ahora el **método** ("`ℹ pass` de `node --test` por archivo") y los 9 conteos. Los verifiqué uno por uno contra mi propia medición: **coinciden los 9**. Y explica los dos errores viejos (el 71 mezclaba pasadas; el 13 estaba mal medido) |
| **🟡-F** | ✅ **CERRADO** | `design-multivendor.md:388-389`: el paso 0 ya no dice "el operario desconectó" y agrega la nota de **por qué** no se mira `closed` |
| **🟡-G** | ✅ **CERRADO** | `docs/backlog.md` ítem 2 pasa a *"RESUELTO A MEDIAS"* y separa lo hecho de **lo que queda como decisión tomada** (la cadena del operario y la post-conexión no tienen tope ni CTA en `scanning`, a propósito) |
| **⚪-H** | ✅ **CERRADO y probado** | ver M13 |
| **⚪-I** | ⚪ sigue abierto (era opcional) | el comentario nuevo afirma *"`queueTarget` solo encola targets explícitos, así que su cadena es del operario"*: un `retry` pasa `currentDeviceId` **explícito**, así que la afirmación no es hermética. Sigue siendo angosta y ahora su efecto (cadena sin tope) es el **default** de cualquier cadena que conectó, así que el costo bajó todavía más |

## Tu pregunta sobre MEDIUM-2: ¿el argumento cierra?

**Cierra en lo sustantivo, y hay exactamente un camino que se le escapa.** Lo verifiqué:
`supabase.auth.signOut()` tiene **un solo call site** en todo el árbol (`AuthContext.tsx:168`), y la
limpieza está inmediatamente antes. El argumento *"si A no cierra sesión, B **es** A para la app"* es
correcto: sin logout la app sigue autenticada como A, así que un scope por usuario no compraría nada —
la app no puede saber que cambió el humano.

**Lo que se le escapa**: la sesión también puede terminar **sin pasar por esa acción** — refresh token
expirado o revocado, o un logout global disparado desde otro device. `onAuthStateChange`
(`AuthContext.tsx:115`) solo refleja la sesión en el estado; **no limpia nada**. En ese caso, si después
entra otro usuario en el mismo teléfono, hereda la MAC de A. Qué se expone: una **MAC** (no dato de
tenant, no `establishment_id`) y un RFCOMM no pedido — y el *bond* de Bluetooth es del SO, o sea que B
podía conectarse a mano igual. Es el mismo residuo que el security_analyzer archivó como **LOW-5**, así
que no lo re-litigo: **el argumento cierra, el residuo está nombrado y fileado**. El endurecimiento barato,
si Raf lo quiere algún día, es la misma línea movida al branch `SIGNED_OUT` del listener (o al `SIGNED_IN`
cuando `session.user.id` difiere del último visto), que cubre el fin de sesión involuntario.

## MEDIUM-1: cerrado en lo peligroso, con un residuo que el Gate 2 descartó y yo dejo nombrado

El test corregido **no es un verde comprado** — lo probé por las dos direcciones (M8/M9) y re-corrí M4:
sigue cayendo, y ahora arrastra un test más. La aserción vieja (`deviceDisconnectCalls === 1`, *"el socket
viejo se cerró"*) pasaba por el motivo equivocado (los dos dobles del test son devices independientes;
en el teléfono son **el mismo socket**, porque `device.disconnect()` de la lib cierra **por dirección** y el
nativo reusa la conexión de esa MAC). La corrección va en la dirección correcta.

**⚪-K (nuevo, backlog)**: `canCloseOrphanSocket` responde *"¿sigo siendo el dueño de la generación?"*, no
*"¿esta dirección sigue siendo mía?"*. En el caso **direcciones distintas** —el operario cambia del bastón A
al B, que es justo el flujo que abrió 🟠-2— el socket de A queda abierto en el `mConnections` del nativo con
**nadie leyéndolo**, y su `DelimitedStringDeviceConnectionImpl` sigue acumulando en un `StringBuffer` **sin
cota** (es MEDIUM-3, ahora con una ventana nueva): al reconectar a A más tarde, el nativo devuelve esa misma
conexión y la primera trama se pierde arrastrada por lo acumulado — el mecanismo de BENCH-2, medido en el
banco §4.4. El Gate 2 lo descartó argumentando *"no acumula: el mapa es por dirección"*, y eso es cierto
para la **cantidad de sockets**, pero el costo no es la acumulación de sockets: es el buffer sin drenar y un
link de radio que nadie usa. Predicado que lo cierra: cerrar también cuando
`!sameAddress(direcciónDelHuérfano, this.currentDeviceId)` — 3 líneas y un test. **Neto: el fix-loop cambió
un 🔴 (matarle el socket al que sí conectó) por un ⚪; es una mejora clara, pero el residuo no es cero.**

**⚪-L (nuevo, backlog)**: los dos call sites nuevos de limpieza son **awaits del puente FUERA del adapter**,
donde el guard no llega (`spp-bridge-timeout-guard.test.ts` escanea solo `adapter-spp-android.ts`) y **sin
presupuesto**: `AuthContext.tsx:159` hace `await forgetRememberedDevice()` **antes** de
`supabase.auth.signOut()` (un `SecureStore.deleteItemAsync` que no resuelva ⇒ **el operario no puede cerrar
sesión**) y `account.ts:150` lo hace **después** de la baja server-side (un cuelgue deja la UI en progreso
sobre una cuenta ya borrada). Los dos son limpiezas best-effort cuyo modo de falla es **peor que saltearlas**:
`void` en vez de `await`, o `withTimeoutOr`. Es la clase que esta unidad entera vino a cerrar, aplicada a
código que nació en el fix-loop.

**⚪-M (nit de docs)**: `T-MV.5.7` pasó a `[x]` pero su cuerpo sigue diciendo *"**Pendiente de flasheo** (lo
corre Raf)"* y la tabla de fases (`tasks-multivendor.md:21`) sigue diciendo *"T-MV.5.7, pendiente de
flasheo"*. El ESP32 se flasheó y el banco corrió: dos líneas.
(Y un nit sin consecuencia: `logging.ts` duplica el union de `ConnectTrigger` como literales en vez de
importar el tipo. Falla cerrado en compilación —un trigger nuevo no sería asignable—, así que no es finding.)

## Pendientes de verificación (no son cambios de código)

1. **E2E: hay que re-correrla.** El fix-loop tocó `StickConnectionScreen.tsx` (04:13) **después** del
   `4/4` de `baston-multivendor.spec.ts`, así que ese verde es de un build anterior. El riesgo es
   estructuralmente bajo —el CTA nuevo vive dentro de `{isSpp ? …}` y `onChoosePaired` también, y en web
   `isSpp` es false; la spec E2E no cambió (mtime 01:06)— pero el Gate 2.5 tiene que verla verde contra el
   build final. **Yo no corrí Playwright** en ninguna de las dos pasadas de esta review.
2. **Device**: todo lo que depende de que el nativo diga la verdad (BENCH-1, el filtro de 🔴-2, MEDIUM-1)
   sigue device-gated. Nada de esta adenda se verificó en el A07.

## Predicciones falsables para las 26 escenas

| escena | predicción con el fix | qué la falsifica |
|---|---|---|
| **COLD-CUT** (mi COLD-DROP) | `reconnect_attempt attempt:0` en logcat y el link **vuelve**; **cero** `autoconnect_exhausted` | un `autoconnect_exhausted {"attempts":0}` → el fix no llegó al build |
| **CAP** | sigue ✅, y ahora su `autoconnect_exhausted` tiene **`attempts` > 0** (el `attempts:0` era la confesión del bug) | `attempts:0` → el presupuesto se sigue gastando sin intentar |
| **CAP-RESET** | ✅ (ya pasaba: el tap destraba) | — |
| **E13 / E14 / E15 / BENCH1** corridos >120 s después de un arranque auto y **sin tap previo** | ✅ **sin depender de que `ensure_connected` tapee** — era mi aviso de lectura del 21/21, y el fix lo desactiva | rojo con `autoconnect_exhausted` en logcat |
| tocar el chip del header mientras dice *"Conectando…"* | `connect_reasserted {"trigger":"operator"}` en logcat | silencio → el destope no llegó al build |
| **⚪-K** (si aparece un 2º device Classic): A vence → B conecta → A resuelve tarde | `orphan_socket_kept` en logcat y el link de **B sobrevive** | B se desconecta → MEDIUM-1 no está cerrado en device |
| CTA "Olvidar el bastón guardado" → force-stop → abrir | `autoconnect_skipped reason:no_remembered` y **cero** connects | un `connecting` → la limpieza no llegó al storage |

## CHECKPOINTS y checklist RAFAQ — deltas de esta adenda

- **C6** pasa a **[x]**: la segunda cláusula de R6.4 (*"vuelve a estar en rango"*) ya tiene tests para la
  cadena del arranque (5 casos), y el as-built ya no la incumple.
- **C9** sigue **[ ]**, ahora por un solo motivo: el re-run de la E2E contra el build final (los dos N/A
  visuales quedaron documentados con motivo estructural + precedente).
- **C5** sigue **[ ]**: se cierra al commitear.
- **Checklist C (BLE)**, box *"manejo de desconexión repentina (timeout + UI clara)"* → **[x]**: la
  desconexión repentina de una sesión de cualquier antigüedad ahora reintenta, y el estado dice la verdad.

**Veredicto final: APPROVED.** Los tres bloqueantes que encontramos entre el review y el Gate 2 están
cerrados con oráculos que saben fallar —lo verifiqué rompiéndolos yo, no leyéndolos—, `check.mjs` está en
**RC=0** con el rojo del implementer confirmado como flake por re-corrida independiente, y lo que queda es
backlog (⚪-K, ⚪-L, ⚪-M, ⚪-I, LOW-5) más las dos verificaciones de arriba: la E2E contra el build final y
el banco en device, que es el oráculo que importa.
