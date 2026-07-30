# Review adversarial — camino Bluetooth Classic SPP del bastón (`dad711f`)

**Rol**: `reviewer` (read-only). **Fecha**: 2026-07-29.
**Alcance**: `adapter-spp-android.ts` + cadena (`spp-protocol`, `permissions-android`, `adapter-selection`,
`line-framer`, `dedup`, `contract`, `remembered-device`, `driver-*`, `selection-priority`,
`BleStickListenerProvider`, `connection-status`), el config plugin y las 4 suites de tests.
**Fuera de alcance** (ya verificado a mano, handoff §3, no re-verificado): los 3 bugfixes contra la fuente
Java, la naturaleza NativeModule-legacy de la lib, el tope de `ACCESS_FINE_LOCATION` en el APK.

## Veredicto

**CHANGES REQUESTED** — 2 🔴 bloqueantes, 5 🟠 serios, 5 🟡 menores, 4 ⚪ notas.

Nada de esto invalida la arquitectura: el contrato transport-agnóstico, la inyección por `SppEnv`, el
contador de sesión y el guard de `isSppNativeAvailable()` son correctos y bien pensados. Lo que falla es
**la máquina de estados en los bordes** y —sobre todo— la **ausencia de guards** en los tres lugares donde
la misma clase de bug ya nos quemó dos veces.

## Método (para que los números no sean afirmaciones)

- **lo leí** = lectura de código (nuestro o el Java de `react-native-bluetooth-classic@1.73.0-rc.17` en
  `node_modules`).
- **lo ejecuté** = corrí un probe adversarial propio (7 casos) contra el adapter REAL con dobles de
  `SppEnv`. El probe se escribió, se corrió y **se borró** (`git status` limpio); no quedó nada en `app/`.
  Los 7 casos **pasaron**, o sea: los 7 defectos que asertan están **confirmados empíricamente**.
- Conteo de tests: `grep -c` de las líneas que empiezan con `test(` → `adapter-spp-android.test.ts` = **39**
  (no 36: el commit y `progress/impl_baston-android-spp.md` dicen 8 → 36; en `dad711f` ya eran 39. Ver 🟡-5).
- Suites corridas: `node --import ./scripts/ts-ext-resolver.mjs --test` sobre
  `adapter-spp-android.test.ts` + `spp-protocol.test.ts` + `permissions-android.test.ts` +
  `with-bluetooth-classic.test.ts` + `wiring.test.ts` → **83 pass / 0 fail** (ejecutado).

---

## 1. 🔴 BLOQUEANTES

### 🔴-1 · `connectInFlight` es un latch sin timeout: una promesa nativa que no resuelve mata el bastón hasta reiniciar la app

**Archivo**: `app/src/services/ble/adapter-spp-android.ts:258-267` (guard). **Ningún** await del camino de
connect tiene timeout (`:302`, `:314`, `:327`, `:330`, `:344`, `:359`).

```ts
async connect(deviceId?: string): Promise<void> {
  this.closed = false;
  if (this.connectInFlight) return;   // ← latch
  this.connectInFlight = true;
  try { await this.doConnect(deviceId); } finally { this.connectInFlight = false; }
}
```

`connectInFlight` solo se libera cuando la promesa de `doConnect` **se asienta**. Si un await nativo nunca
resuelve, el flag queda `true` **para siempre**: todo `connect()` posterior —del operario, del chip, del
sheet de scan, del timer de backoff— es un **no-op mudo**. `disconnect()` **no lo libera** (`:387-392`).
El adapter se construye una vez por vida del proceso (`BleStickListenerProvider.tsx:135-138`, `useMemo` con
dep `[mode]`), así que la única recuperación es **matar la app**.

**Y la UI no da salida**: `connectionStatusView` devuelve `cta: none` tanto para `connecting` como para
`scanning` (`app/src/features/ble-stick/connection-view.ts`), así que la pantalla queda en
**Conectando… sin ningún botón**, y tocar una fila de la lista tampoco hace nada (mismo latch).

**Es exactamente la clase del bug 2 del handoff** (`pairDevice()` que no resuelve). El fix de aquel bug
sacó **la llamada** pero no escribió el guard sobre **la ausencia del mecanismo**: no hay ni un
`withTimeout` en todo el archivo.

**Que no es teórico** — leído en el Java de la lib:

- `RNBluetoothClassicModule.java:409-424` — `requestBluetoothEnabled()` guarda la promesa en un **único
  slot** (`mEnabledPromise`) y la resuelve solo desde `onActivityResult` (`:327-349`). Dos caminos:
  1. **Llamado con la app en background** → `startActivityForResult` está **bloqueado en Android 10+**
     (background activity start): la Activity no arranca, `onActivityResult` no llega, la promesa nunca se
     asienta. Y el adapter **sí** puede llegar acá en background (ver 🟠-1).
  2. **Dos llamadas solapadas** → la segunda **pisa** `mEnabledPromise` y la primera queda **huérfana para
     siempre**. Hay dos entradas independientes que lo llaman: `listPairedSppDevices()`
     (`adapter-spp-android.ts:150`, desde `StickConnectionScreen.loadPaired`) y `doConnect`
     (`adapter-spp-android.ts:330`, desde el chip del header / `TagScanSheet` / el timer). Si la huérfana
     es la del connect → adapter muerto. Si es la de la lista → ver 🟠-4.
- `BluetoothSocket.connect()` (`RfcommConnectorThreadImpl`) no tiene timeout propio.

**Ejecutado** (probes P2 y P3): con `connectToDevice` colgada, `disconnect()` + 2 × `connect()` → el nativo
recibe **1 sola** llamada en total. Con `requestBluetoothEnabled` colgada, el estado queda en `connecting`
y `connectToDevice` **nunca** se llama.

**Repro en el banco**: `off 8000`; con el Bluetooth del teléfono APAGADO, tocar Conectar y mandar la app a
background antes de responder el diálogo del sistema. Alternativa sin emulador: BT apagado → tocar
"Buscar bastón emparejado" y, apenas se cierre el diálogo, tocar una fila (para solapar las dos llamadas).

**Qué pido**: (a) un `withTimeout(promise, ms)` en **cada** await que cruza el puente, con
`connectInFlight` liberado en el finally y estado `disconnected` + log al vencer; (b) `disconnect()` debe
liberar el latch; (c) un test que inyecte una promesa que nunca resuelve en `connectToDevice` **y** en
`requestBluetoothEnabled` y asserte que un `connect()` posterior **sí** llega al nativo.

### 🔴-2 · El evento de desconexión del SO es GLOBAL: cualquier device Classic que se desconecte mata la conexión viva del bastón

**Archivo**: `app/src/services/ble/adapter-spp-android.ts:369-376` — el callback **ignora el payload**:

```ts
this.disconnectSub = native.onDeviceDisconnected(() => {   // ← el evento trae el device; no se mira
  if (this.closed || this.session !== session) return;
  void this.teardownStreams();     // ← cierra el socket del BASTÓN
  this.emitStatus('disconnected');
  this.scheduleReconnect();
});
```

**Leído en el Java**: `onDeviceDisconnected` se suscribe al evento `DEVICE_DISCONNECTED` **sin filtro de
dirección** (`lib/BluetoothModule.js:336-338` → `createBluetoothEventSubscription`, un tipo de evento
global; comparar con `onDeviceRead`, `:347-348`, que **sí** es `DEVICE_READ@<address>`). Y ese evento lo
dispara `RNBluetoothClassicModule.onACLDisconnected` (`:1379-1385`), alimentado por `ActionACLReceiver`
— un `BroadcastReceiver` de `BluetoothDevice.ACTION_ACL_DISCONNECTED`, **broadcast del sistema para TODOS
los devices Classic del teléfono**.

**Escenario de campo**: el operario tiene auriculares Bluetooth, o el teléfono estaba pareado al estéreo de
la camioneta y se baja en la manga. Ese ACL disconnect → **cerramos el socket del bastón**, chip a
Reintentando…, se pierden lecturas ~0,5-1 s y se reconecta. Con un device que va y viene (manos libres del
auto en el alambrado) es un flap permanente sobre una conexión que estaba sana.

**Ejecutado** (probe P4): emitiendo el evento con la MAC `00:00:00:00:00:99` sobre una conexión viva a
`AA:BB:CC:DD:EE:FF`, `device.disconnect()` se llama 1 vez, el estado va a `scanning` y las lecturas
posteriores ya no se ingieren.

**Repro sin emulador**: conectar el bastón (o el ESP32 en `MODO_SPP`) y apagar unos auriculares BT.

**Qué pido**: filtrar por dirección en el callback (comparar `event.device?.address` contra
`this.currentDeviceId`, case-insensitive) y un test con un evento de otra MAC que asserte que la conexión
**sobrevive**.

---

## 2. 🟠 SERIOS

### 🟠-1 · El gate de foreground se chequea al PROGRAMAR, no al DISPARAR (viola R6.9 / RMV5.5)

`adapter-spp-android.ts:421-441` — `scheduleReconnect()` consulta `isForeground()` antes de armar el timer,
pero el callback del timer (`:436-440`) **no lo vuelve a chequear**. Entre armar (hasta 8 s de backoff) y
disparar, la app puede haberse ido a background.

R6.9 (`requirements.md:115`) es explícito: conexión, escaneo y reconexión **únicamente** en foreground.

**Ejecutado** (probe P5): corte en foreground → timer armado → `isForeground()` pasa a false → disparo el
timer → **se llama a `connectToDevice`**.

Es además el habilitador de 🔴-1 (`requestBluetoothEnabled` desde background).

**Repro**: `drop` y guardar el teléfono en el bolsillo antes de los 500 ms.

### 🟠-2 · Un `connect()` con la app ocupada se descarta EN SILENCIO (sin estado, sin log, sin CTA)

`adapter-spp-android.ts:260` — el return temprano no emite nada. El caso normal: el operario toca el bastón
A (el `connectToDevice` de un device apagado bloquea varios segundos), se da cuenta de que era el otro y
toca el B → **no pasa absolutamente nada** y, cuando A resuelve, queda conectado a A.

**Ejecutado** (probe P1): con un connect en vuelo, `connect('11:22:33:44:55:66')` no genera **ninguna**
llamada al nativo ni **ningún** cambio de estado.

**Falso verde**: el test `dos connect() concurrentes no abren dos sockets`
(`adapter-spp-android.test.ts:543-550`) usa **el mismo MAC** y solo asserta que hubo 1 llamada. Pasa
idéntico con el bug puesto. No hay ni un test con dos targets distintos.

**Qué pido**: encolar el último target pedido (o cancelar el intento en curso), y como mínimo emitir un
estado/log. Test con `connect(A)` en vuelo + `connect(B)`.

### 🟠-3 · No hay reconexión automática al ABRIR la app (R6.4 sin implementar y sin test)

`BleStickListenerProvider.tsx:214-215` dice explícitamente que no auto-conecta. Los únicos llamadores de
`transport.connect()` son gestos (`BleConnectionChip.tsx:54`, `TagScanSheet.tsx:153`,
`StickConnectionScreen.tsx:166/219/222`). O sea: `readRememberedDevice()` **solo** se alcanza si alguien
toca algo.

R6.4 (`requirements.md:105`): cuando la app abre … deberá reconectar automáticamente al bastón guardado …
**sin requerir que el operario vuelva a la pantalla de conexión**. As-built: cada arranque exige ir a
Más → Bastón → tocar. Es media razón de ser de `remembered-device.ts`.

`tasks.md` T4.3 sigue en `[ ]` (honesto), pero `design-multivendor.md §6` y la nota de reconciliación de
RMV5.5 se leen como si la historia de reconexión estuviera completa. **Ningún test cubre R6.4** (no puede:
no existe el camino).

**Decisión pedida**: implementarlo (auto-connect al montar el provider si hay device recordado, con el
mismo backoff) **o** reconciliar R6.4/R6.9 en la spec diciendo que el arranque es por gesto. Hoy la spec y
el código no dicen lo mismo.

### 🟠-4 · La lista de emparejados puede quedar clavada en Buscando… sin CTA de salida

`StickConnectionScreen.tsx:177-191` — `loadPaired()` no tiene guard de re-entrada y su
`await listPairedSppDevices()` no tiene timeout. Si esa promesa no se asienta (el caso de la promesa
huérfana de 🔴-1), `pairedState` se queda en loading, y `pairedDevicesView(loading)`
(`connection-view.ts:316-317`) devuelve **`ctaLabel: null`** → la sección queda con
"Buscando dispositivos emparejados…" y **sin botón** hasta salir y volver a entrar a la pantalla (nada en
la UI lo sugiere).

**Qué pido**: guard de re-entrada + timeout con caída al estado `error` (que sí tiene CTA Reintentar).

### 🟠-5 · Conectado pero mudo no se detecta en ninguna parte (y hay un camino que lo produce en silencio)

`sppConnectOptions()` (`spp-protocol.ts:67-75`) **hardcodea** el delimitador LF. La `TransportCapability`
de kind spp (`driver-types.ts:35`) solo declara `{sppUuid, pin}`: **un driver no puede declarar su
terminador**. Y en el Java, `DelimitedStringDeviceConnectionImpl.receivedData` acumula en un `StringBuffer`
**sin cota** y solo entrega cuando encuentra el delimitador.

Consecuencia: un lector que termine con CR solo (o sin terminador) → estado **connected**, **cero
lecturas**, **cero errores**, **cero logs**, y el buffer nativo creciendo. Indistinguible de "el operario no
está bastoneando". Nada en el adapter mide "hace N segundos que estoy conectado y no llegó un byte".

Es la misma clase que el bug 1 (framing invertido) y la misma honestidad que **sí** se aplicó al UUID
(`sppUuidIsSupported` corta en vez de fingir) — pero no al delimitador.

**Predicción falsable para el banco**: `term cr` + `read 5` → la app sigue diciendo **Conectado** y no
ingiere nada; `term none` + `auto 200` → idem, con el heap nativo subiendo. Compará con `mute 30`, que
produce **el mismo síntoma exacto** siendo una situación totalmente distinta.

**Qué pido**: o el delimitador sale del driver (con un chequeo honesto como el del UUID), o queda escrito
que LF es un supuesto del RS420 y no del transporte. Y un watchdog de connected-sin-datos (aunque sea solo
un log).

---

## 3. 🟡 MENORES

### 🟡-1 · `isRawStream` es una lista de literales duplicada, sin un solo test — tercera repetición de la clase

`BleStickListenerProvider.tsx:205` decide si la lectura entra como línea cruda o como EID limpio con una
comparación literal de dos kinds: web-serial y spp-android.

Si `spp-android` faltara ahí, cada trama del RS420 iría por `processEid` → `normalizeTag` le saca el STX →
quedan 34 dígitos → `isValidTag` false → **`invalid_eid`, cero lecturas** — con **toda la suite verde**.
`grep -rn isRawStream src/` (ejecutado): **cero tests**; el provider es `.tsx` y no lo cubre ninguna suite
node:test ni el E2E (que corre web con mock/manual/simulator).

Y ya existe el campo que debería decidirlo: `ReaderDriver.streaming` (RMV1.1), que en producción **no se
usa en ningún lado** (grep de `.streaming` en `src/` → solo `driver-registry.test.ts:19`).

**Guard sobre la ausencia**: derivar el modo de ingesta del adapter/driver y escribir un test que recorra
**todos** los `AdapterKind` y falle si alguno no lo declara → un adapter nuevo nace en rojo.

### 🟡-2 · `instantiateTransport` + `isSppNativeAvailable()` no tienen cobertura en el camino positivo

`isSppNativeAvailable()` y `loadRNBC()` hacen el require de `react-native` directo, sin inyección → el
único test posible es el negativo (`adapter-spp-android.test.ts:228-230`, es false fuera de Android), que
pasa trivialmente. `instantiateTransport` (`BleStickListenerProvider.tsx:82-108`) no tiene **ningún** test.

Verifiqué a mano lo que el guard no puede verificar solo: `MODULE_NAME = "RNBluetoothClassic"`
(`RNBluetoothClassicModule.java:101`) coincide con la clave que se busca en `NativeModules` — o sea hoy
está bien. Pero la única evidencia de que la rama verdadera funciona es **una corrida manual en device**.
Es el hueco `binding.available` vs `selectTransportAdapter` otra vez, un nivel más abajo.

### 🟡-3 · El backoff se resetea con cualquier connect exitoso, sin exigir que el link DURE

`adapter-spp-android.ts:358` pone `reconnectAttempt = 0` apenas resuelve `connectToDevice`. Un link que cae
a los 200 ms de conectar produce un ciclo connect → drop → 500 ms → connect indefinido, con el chip
parpadeando y la radio martillando. No hay dwell mínimo ni tope de intentos: con el bastón apagado, la app
reintenta cada 8 s **para siempre**, y como el estado scanning tiene cta none, el operario no tiene botón
para frenarlo.

**Predicción falsable**: `flap 4 3000` (3 s abajo / 4 s arriba) → los delays observados serán
**500 → 1000 → 2000 → (conecta) → 500 → 1000 → 2000 → …**, reseteando en cada ciclo. El README del emulador
(`firmware/baston-emulator/README.md`, fila "corte repetido") espera **backoff creciente** entre ciclos: o
se corrige el README o se agrega el dwell. El test "una reconexión exitosa RESETEA el backoff"
(`adapter-spp-android.test.ts:437-454`) hoy **congela el comportamiento actual como correcto**.

### 🟡-4 · Las specs se quedaron viejas en tres puntos (exactitud código → spec)

1. **RMV5.2, nota de reconciliación** (`requirements-multivendor.md`): dice que *el frameParser y el pin sí
   salen del driver*. **Falso as-built.** `resolveSppParams` (`adapter-spp-android.ts:92-96`) devuelve el
   `pin` y **nadie lo consume** (se eliminó `pairDevice()`), y `driver.frameParser` **no se usa en
   producción**: `contract.ingestRawLine` (`contract.ts:36`) llama `parseRs420Line` **hardcodeado**
   (grep de frameParser en `src/` → solo tests). Con un segundo driver SPP de otro formato, RMV1.6 (sumar
   un fabricante sin tocar `contract.ts`) **no se cumple**.
   Los tests que la spec cita como evidencia son **falsos verdes**: `adapter-spp-android.test.ts:167-178`
   prueba que la función devuelve el pin (que se tira), y `:328` / `spp-protocol.test.ts:52-67` invocan
   `RS420_DRIVER.frameParser.parse(...)` **desde el test**, no por el camino de producción.
2. **`tasks-multivendor.md` T-MV.5.2** sigue marcada `[x]` con el enunciado *framing por línea (LineFramer,
   reuso, RMV5.3)* — justo lo que el as-built **no** hace. RMV5.3 sí tiene su nota; la task no.
3. **`tasks.md` (core) sin reconciliar**: T4.0 (veto, hecho y documentado), T4.1, T4.5, T4.6, T6.1 y T6.2
   están implementadas y siguen en `[ ]`. T4.7 / T5.0 / T7.4 sí están legítimamente gated por hardware.
   El T10 (reconciliar specs) del plan del implementer se cerró sobre los archivos `*-multivendor.md` y
   dejó afuera el `tasks.md` del core.

Además, `progress/impl_baston-android-spp.md` tiene **seis placeholders sin llenar**: OUTPUT_CHECK,
OUTPUT_GRADLE, OUTPUT_E2E, GATED, SELFREVIEW y RECONCILE. La **autorrevisión adversarial del implementer
está vacía** — consistente con que el agente murió mid-run, pero el informe quedó commiteado como si
estuviera completo.

### 🟡-5 · Números sin método en el commit y en el informe

El commit `dad711f` y `progress/impl_baston-android-spp.md` dicen *pasó de 8 a 36 tests*. Conté las líneas
que arrancan con `test(` en `adapter-spp-android.test.ts`, en `dad711f` y en HEAD: **39**. No cambia ningún
veredicto, pero es la regla del propio proyecto (handoff §9).

---

## 4. ⚪ NOTAS

- **⚪-1 · `bad noterm` se come la lectura siguiente — confirmado, y es irreparable desde JS.** El
  `StringBuffer` de Java retiene la trama sin terminador y la entrega **pegada** a la siguiente; el parser
  está anclado (`parser-rs420.ts:56`) → `parse_failed` y se pierde la válida. **Ejecutado** (probe P6). El
  README del emulador ya lo predice; queda confirmado que **no** es un bug nuestro sino el precio del
  framing nativo. Único paliativo posible: buscar el último STX dentro de la línea antes de rechazarla.
  Decisión de producto, no defecto.
- **⚪-2 · `splitSppPayload` es defensa muerta en Android.** Con `double`, el que separa las dos tramas es
  el **nativo** (`receivedData` hace un while sobre `read()` y emite un `onDataReceived` por mensaje), no
  `splitSppPayload`. El README (fila `double`) se lo atribuye a `splitSppPayload`: inexacto, sin
  consecuencia.
- **⚪-3 · Ningún framer tiene cota.** Ni el `StringBuffer` nativo ni `LineFramer.push`
  (`line-framer.ts:19-20`, que sigue vivo en `adapter-web-serial`). Un lector que escupa basura sin
  terminador crece sin límite en las dos. Guard sobre la ausencia: cap + descarte con log en ambos.
- **⚪-4 · Dos escrituras del device recordado.** `StickConnectionScreen.onChoosePaired:197` persiste la MAC
  **antes** de saber si conecta, y el adapter la persiste otra vez al conectar (`:359`). Tocar los
  auriculares por error los deja recordados como bastón. Inofensivo; se corrige con un forget en el fallo.
- **⚪-5 · El plugin declara `BLUETOOTH_SCAN` sin usarlo** (`with-bluetooth-classic.js:40`, "para un
  descubrimiento futuro") — el mismo argumento con el que se topeó `ACCESS_FINE_LOCATION`. Es una
  declaración de más en la ficha de Play.

## 5. Lo que está BIEN (y no hay que tocar)

Verificado por lectura y por los tests que corrí:

- **Sin doble suscripción al reconectar**: `doConnect` hace `await this.teardownStreams()` antes de todo
  (`:279`), y el **contador de sesión** (`:239`, `:356`, `:362`, `:371`) descarta cualquier callback de una
  conexión vieja aunque el `remove()` del otro lado del puente falle. Es la defensa correcta.
- **Teardown idempotente**; `disconnect()` doble no tira (test `:232-238`).
- **`disconnect()` durante un connect en vuelo** cierra el socket que se abre después (`:345-355`, test
  `:529`).
- **El listener de foreground no se duplica**: se da de baja dentro de su propio callback y el guard
  `unsubForeground != null` impide un segundo armado (`:422-430`, test `:456-472`).
- **`onDataReceived` sí está filtrado por dirección** en la lib (evento `DEVICE_READ@<address>`) — el
  problema es solo el evento de desconexión.
- **Dedup**: la composición cierra con el banco. Ventana por-TAG medida desde la **última emisión
  confirmada** (`dedup.ts:44-51`) → `same 5 300` = 1 ingesta y `same 5` (gap 800) = 2, exactamente lo que
  predice el README. `burst 8` con `seq on` = 8 (ningún EID espera a otro).
- **Una trama partida a mitad de un read no cruza sesiones**: el buffer vive en el `DeviceConnection`, que
  se crea nuevo en cada connect (`RNBluetoothClassicModule:874-880`) — un corte a mitad de trama no deja
  medio EID esperando a la reconexión.
- **Permisos**: fail-closed (`permissions-android.ts:44-51`), pide solo `BLUETOOTH_CONNECT` y solo en
  API ≥ 31, y no pide SCAN ni ubicación porque este camino no descubre. Correcto y bien argumentado.
- **Config plugin**: `applyBluetoothPermissions` es puro e idempotente (upsert por `android:name`) y
  declara el `xmlns:tools` que el merger necesita. Sin objeciones.

## 6. Respuesta directa a las dos preguntas de clase

**¿Los 39 tests cubren transiciones o caminos felices?** Cubren bastante más que caminos felices (permiso
denegado, BT apagado con y sin aceptación, sin nativo, sin device, corte del SO, cancelación del retry,
disconnect durante connect). Los **falsos verdes** concretos:

| test | por qué pasaría igual con el bug puesto |
|---|---|
| `:543` dos connect() concurrentes | usa **el mismo MAC** y solo cuenta llamadas → no ve el descarte mudo de otro target (🟠-2) |
| `:167`, `:171` resolveSppParams / pin | prueban el retorno de una función cuyo `pin` **nadie consume** (🟡-4) |
| `:328`, `spp-protocol.test.ts:52-67` frameParser | invocan el parser **desde el test**; producción no pasa por `driver.frameParser` (🟡-4) |
| `:228` isSppNativeAvailable false | pasa trivialmente sin RN; la rama verdadera no tiene cobertura (🟡-2) |
| `:437` reset del backoff | **congela** el reset-sin-dwell como comportamiento esperado (🟡-3) |
| `:424`, `:452` evento de desconexión | siempre lo emiten como si fuera de nuestro device; nunca de otra MAC (🔴-2) |

Y las tres **ausencias** que importan: ningún test con dos targets distintos, ninguno con una promesa que
no resuelve en el camino que **sí** se usa, ninguno del gate de foreground **al disparar** el timer.

**¿Puede quedar todo verde con el bastón sin emitir una lectura?** Sí, por **cinco** caminos distintos, y
ninguno tiene test:

1. `isRawStream` sin spp-android → todo se rechaza como `invalid_eid` (🟡-1).
2. `isSppNativeAvailable()` falso-negativo → no se monta transporte, la app queda honestamente manual y
   nadie se entera (🟡-2).
3. Delimitador distinto del LF hardcodeado → connected y mudo (🟠-5).
4. `connectInFlight` latcheado → Conectando… eterno sin CTA (🔴-1).
5. Evento de desconexión ajeno en loop → el socket se cierra tan rápido como se abre (🔴-2).

## 7. Verificación ejecutada

- **`node scripts/check.mjs`**: **verde, exit code 0** ("All tests passed" / "Entorno listo").
- **Suites del camino SPP** (ejecutado): **83 pass / 0 fail** — `adapter-spp-android` 39 +
  `spp-protocol` 13 + `permissions-android` 9 + `with-bluetooth-classic` 10 + `wiring` 12.
- **Probe adversarial propio** (ejecutado, 7/7 confirmando los defectos): P1 descarte mudo · P2 latch por
  `connectToDevice` colgado · P3 latch por `requestBluetoothEnabled` colgado · P4 desconexión de otro
  device · P5 connect en background · P6 `bad noterm` se come la siguiente · P7 un `connect()` espurio
  borra el `disconnect()` del operario (`connect()` pone `closed = false` **antes** del guard de
  re-entrada, `:259-260`).
- **No ejecutado**: Playwright (`pnpm e2e`, ~38 min; no toca el camino SPP: el E2E corre en web con
  mock/manual/simulator) y el banco del ESP32 (sin flashear).

## 8. Predicciones falsables para el banco (cuando se flashee `MODO_SPP`)

| # | comando | qué predigo (as-built) | si da otra cosa |
|---|---|---|---|
| 1 | `off 8000` + mandar la app a background dentro de los 500 ms | se intenta el connect **en background** (viola R6.9) | 🟠-1 no aplica |
| 2 | ídem con el **Bluetooth del teléfono apagado** | Conectando… **para siempre**, sin CTA, ningún tap responde hasta matar la app | 🔴-1 no aplica |
| 3 | apagar unos auriculares BT con el bastón conectado | el bastón se **desconecta solo** y reintenta | 🔴-2 no aplica |
| 4 | `off 8000` + tocar otra fila mientras dice Conectando… | **no pasa nada**: ni estado, ni intento | 🟠-2 no aplica |
| 5 | `flap 4 3000` | delays 500→1000→2000 y **reset en cada ciclo** (no crece entre ciclos) | el README acierta y 🟡-3 no aplica |
| 6 | `bad noterm` seguido de `read` | 2 tramas emitidas, **0 ingestas** | ⚪-1 no aplica |
| 7 | `term cr` + `read 5` | **Conectado** y **0 ingestas**, sin ningún error ni log | 🟠-5 no aplica |
| 8 | `mute 30` | **Conectado** y 0 ingestas — **idéntico al #7**, siendo otra cosa | — |
| 9 | `same 5 300` / `same 5` (gap 800) / `seq on` + `burst 8` | 1 / 2 / 8 ingestas | el dedup no compone como dice `dedup.ts` |
| 10 | `double` | 2 ingestas, pero las separa el **nativo**, no `splitSppPayload` | ⚪-2 no aplica |

## 9. Bloqueantes a cerrar antes de aprobar

1. 🔴-1 — timeout en cada await del camino de connect + `disconnect()` que libere `connectInFlight` +
   tests con promesas que no resuelven en `connectToDevice` **y** en `requestBluetoothEnabled`.
2. 🔴-2 — filtrar el evento de desconexión por dirección + test con un evento de otra MAC.
3. 🟠-1 — re-chequear foreground **al disparar** el timer (y nunca llamar `requestBluetoothEnabled` desde
   la cadena de reintentos).
4. 🟠-2 — que un `connect()` con otro target no se descarte mudo.
5. 🟠-3 — **decisión de Raf**: implementar el auto-connect al abrir (R6.4) o reconciliar R6.4/R6.9 en la
   spec diciendo que el arranque es por gesto.
6. 🟠-4 — guard de re-entrada + timeout en `loadPaired()`.
7. 🟡-4 — reconciliar RMV5.2 (frameParser/pin), T-MV.5.2 (LineFramer) y `tasks.md` core (T4.0/T4.1/T4.5/
   T4.6/T6.1/T6.2), y completar (o marcar como imposible) la autorrevisión vacía de
   `progress/impl_baston-android-spp.md`.

🟡-2, 🟡-3, 🟡-5 y las ⚪ pueden ir a `docs/backlog.md` si Raf prefiere no ampliar el scope. **🟡-1 no**:
recomiendo cerrarlo en la misma pasada, es el mismo bug de clase por tercera vez y el guard cuesta un test.
