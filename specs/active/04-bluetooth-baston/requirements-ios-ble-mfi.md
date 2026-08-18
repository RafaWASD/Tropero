# Spec 04 — DELTA «iOS BLE real + MFi prearmado» — Requirements (EARS)

**Status**: `spec_ready` (delta-spec, estilo ADR-028 Nivel B — corre su propio mini-ciclo; **NO reabre el core aprobado de spec 04 ni el delta `multivendor` ya cerrado**).
**Fecha**: 2026-08-17.
**Autor**: spec_author.
**Prefijo de IDs**: `RBM<n>` (**b**le-**m**fi). IDs estables: no se reordenan después de aprobar.

**Fuente de verdad**: `specs/active/04-bluetooth-baston/context-ios-ble-mfi.md` (Gate 0 **aprobado por Raf el 2026-08-15**, con las decisiones de la Puerta 1 en su §7). Todo lo que ese documento afirma está verificado contra el código y **no se re-deriva ni se contradice acá**. Insumos que el contexto declara y que este delta respeta sin re-decidir: **ADR-024** (contrato de ingesta transport-agnóstico + enmienda del registro de drivers), **ADR-003** (Nordic UART — vigente para el hardware propio, y los UUIDs que el emulador usa), `docs/bastones-mercado-argentino.md` (relevamiento del 13/08), el delta `*-multivendor.md` (`RMV1`–`RMV6`) y el core de spec 04 (`R1`–`R15`).

**Related**: core spec 04 (`requirements.md` — este delta lo **extiende sin contradecir**; toca R6.9, R8, R11.2, R12), `requirements-multivendor.md` (cierra la deuda declarada bajo RMV5.2 y destraba RMV6.2/RMV6.3), spec 09 (interfaz `BleStickEvent`/`useBleStickListener`/`useBleConnectionStatus` que 04 implementa y este delta **reusa sin redefinir**), spec 03 (consumidor), ADR-018 (pantalla en "Más"), ADR-010 (el ESP32 es test rig, no producto).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". Un solo "deberá" por requisito. Cada `RBM<n>` verificable por ≥1 test o por una medición registrada.

---

## Qué agrega este delta, en una pantalla

El core dejó firme el contrato de ingesta (R1–R3) y la interfaz `StickAdapter` (R11). El delta `multivendor` agregó el **registro de drivers** (RMV1) y la **selección por capacidad** (RMV2), y escribió el `adapter-spp-android` (RMV5) — que es hoy el único transporte con stream verificado en device.

Este delta hace **siete cosas** (T1…T7 del contexto §4 y §7):

| | Qué | Por qué acá |
|---|---|---|
| **T1** | El parser de trama sale del **registro de drivers**, no de una llamada hardcodeada en `contract.ts` | **Prerrequisito duro.** `contract.ts:16` importa y `:36` llama `parseRs420Line` hardcodeado: hoy un segundo driver **no puede existir**. Sin esto, el adapter BLE solo puede hablar con algo que emita tramas RS420 — o sea, con nuestro emulador y con nada más (contexto §1.1) |
| **T2** | `adapter-ble-gatt.ts` sobre `react-native-ble-plx`, **cross-platform** (iOS **y** Android) | Es el camino iOS-abierto real del mercado (HR5 v3), y restringirlo a iOS sería trabajo extra para tener menos (contexto §4) |
| **T3** | `adapter-mfi-ios.ts` sobre la rama iOS de `react-native-bluetooth-classic`, **gateado por la lista de protocolos** | La lib ya está instalada y tiene rama iOS sobre ExternalAccessory: falta el adapter, no el paquete (contexto §1.3) |
| **T4** | Selección y prioridad por plataforma, y que el transporte montado siga al bastón recordado | En iOS el orden pasa a ser `mfi (si hay protocolo) → ble-gatt → …`; `spp-android` no se ofrece (contexto §4) |
| **T5** | Banco del ESP32 en `MODO_GATT`, en device | La lección de `dad711f`: un transporte "escrito y testeado" sin device tenía tres 🔴 de máquina de estados (contexto §3) |
| **T6** | Reconciliación de ADR-024, del delta multivendor, del relevamiento y del emulador | Regla dura de `docs/specs.md`: ninguna spec queda contradiciendo al código |
| **T7** | Camino HID: **primero el gate físico**, después (y solo si pasa) el adapter | La cabecera de `adapter-hid-wedge.ts` lo prohíbe explícitamente al revés (contexto §7) |

**Lo que NO entra, dicho para que no se lea como olvido**: la **cadena de protocolo real** de cualquier fabricante (Allflex/Datamars) — es gestión comercial, no código (contexto §4); y un **driver del Gallagher HR5 v3** — no tenemos ni el aparato ni sus UUIDs/formato de trama (contexto §2/§3).

> **Manual-first sigue siendo ley** (core R7, R9.6): ningún estado de los transportes nuevos, del gate MFi, del gate HID ni de un driver desconocido deberá **nunca** bloquear la app ni la carga manual. El delta hereda ese piso y lo re-afirma en RBM9.

---

## RBM1. El parser de trama sale del registro de drivers (T1 — prerrequisito de todo lo demás)

> **Buildable-hoy, puro.** Cierra la deuda que el propio delta multivendor declaró y **no escondió** bajo RMV5.2: *"`frameParser`: no se usa en producción. `contract.ingestRawLine` llama `parseRs420Line` hardcodeado… con un segundo driver SPP de otro formato de trama, RMV1.6 no se cumple"*. Era teórica mientras todos los transportes hablaban con un RS420. Deja de serlo con un transporte BLE.

**RBM1.1** El sistema deberá extraer el EID de una línea cruda usando el `frameParser` del `ReaderDriver` del adaptador que produjo esa línea.

**RBM1.2** El sistema **no deberá** importar ni invocar ningún parser de fabricante (`parseRs420Line` u otro) desde `contract.ts`: el parser deberá entrar como parámetro del contrato.

**RBM1.3** El sistema deberá exponer el `ReaderDriver` activo de un adaptador a través de la interfaz `StickAdapter` de forma **aditiva** (campo de solo lectura, opcional), sin modificar ninguno de los métodos ya existentes de la interfaz (R11.1, R11.3).

**RBM1.4** Si un adaptador cuyo modo de ingesta es `raw-line` entrega una línea sin exponer un `ReaderDriver` con `frameParser`, entonces el sistema **no deberá** ingerir esa línea, deberá descartarla y deberá registrar el evento de log correspondiente, **sin** caer a un parser por defecto.

> **Por qué fail-closed y no "si no hay driver, RS420"**: el fallback silencioso produce lecturas para un lector y **silencio total** para todos los demás, que es indistinguible de "el operario no está bastoneando" — el mismo síntoma que costó el terminador equivocado del SPP (🟠-5 / BENCH-2). Un rechazo con log es diagnosticable; un fallback no.

**RBM1.5** El sistema deberá conservar, para los adaptadores de stream ya existentes (`web-serial`, `spp-android`), el `RS420_DRIVER` como driver por defecto, de modo que su comportamiento actual no cambie (regresión).

**RBM1.6** Cuando se registra un `ReaderDriver` nuevo con un `frameParser` distinto del RS420, el sistema deberá ingerir sus tramas de punta a punta **sin modificar** `contract.ts`, `stick-adapter.ts` ni los adaptadores existentes (recién acá RMV1.6 pasa a ser cierto).

**RBM1.7** El sistema deberá exponer un guard que falle si `contract.ts` vuelve a llamar un parser de fabricante hardcodeado o si el provider deja de resolver el parser por el driver, y ese guard deberá haberse verificado **mutando el código que vigila**.

> **Reconciliación al as-built (F1, tras el review del 2026-08-17)** — el requisito no cambia; cambia **quién** lo cumple y **cómo se verifica**, y conviene que quede escrito porque la primera implementación no alcanzaba.
>
> 1. **"El provider resuelve el parser por el driver" se cumple ahora en la capa pura.** La composición `ReadSource {kind, mode, frameParser}` la arma `readSourceFor(adapter, onUnresolved)` en `adapter-selection.ts`; el provider la **invoca**. Motivo: `BleStickListenerProvider.tsx` importa `react-native`, así que nada de lo que se decida ahí adentro se puede ejercer desde `node:test` — el único oráculo posible era un regex sobre el fuente.
> 2. **Un guard de nombres NO satisface este requisito.** La primera versión prohibía tres grafías conocidas y el reviewer la falsificó con un fallback que no nombraba ninguna (`?? DRIVER_REGISTRY[0].frameParser`): compilaba, reintroducía lo que RBM1.4 prohíbe, y dejaba la suite entera en verde. Se lee, entonces, con este piso: el guard tiene que caer ante **la ausencia del invariante**, no ante los nombres de hoy. As-built: (a) oráculo de **comportamiento** sobre `readSourceFor` (identidad del parser · `null` + aviso · silencio en los kinds `'eid'`); (b) guard estático **derivado del árbol** (módulos de fabricante = `parser-*.ts` + `driver-*.ts` salvo los tipos) sobre las dos superficies que cablean un adaptador; (c) prohibición de **fabricar** un parser o un `ReadSource` dentro del provider.

**RBM1.8** El sistema deberá seguir aplicando `isValidTag` (R1.3), la dedup por-TAG (R3) y la confirmación visual pre-commit (R2) a todo EID que salga de un `frameParser`, cualquiera sea el driver.

> **Es el requisito de integridad SENASA de este delta.** Lo único que RBM1 cambia es **de dónde sale el parser**; la validación y el gate de confirmación quedan donde estaban. Ver RBM9.2.

## RBM2. `adapter-ble-gatt` — BLE GATT cross-platform (T2)

> **Buildable-hoy el código + los tests puros; el stream real se verifica contra el emulador (RBM6).** Sobre `react-native-ble-plx`, **dep nueva** (contexto §1.5) → cambia el fingerprint → hace falta build de iOS **y** de Android. El adaptador entra detrás de la MISMA interfaz `StickAdapter`, sin tocar el contrato (R10.3 / R11.3).

**RBM2.1** El sistema deberá exponer `adapter-ble-gatt.ts` como un `StickAdapter` (`kind: 'ble-gatt'`) sobre `react-native-ble-plx`, con **el mismo código en iOS y en Android**.

**RBM2.2** El sistema deberá importar `react-native-ble-plx` de forma **perezosa** (require dentro de las funciones de I/O, patrón `feedback.ts` / RMV5.6), de modo que `adapter-ble-gatt.ts` sea importable en web y en CI sin el módulo nativo.

**RBM2.3** Si el módulo nativo de BLE no está presente en el build, entonces el sistema **no deberá** montar el adaptador (el provider deberá devolver `null`) y deberá quedar manual-first, con el chip y el CTA ocultos por `hasTransport` (mismo guard que `isSppNativeAvailable`).

> **Reconciliación al as-built (F3, 2026-08-17)** — el requisito se cumple, y el guard resultó **más
> exigente** de lo que dice: `isBleGattTransportAvailable()` pide **dos** condiciones y las loguea por
> separado —(a) el módulo nativo está en el build, (b) **algún driver del registro declara el transporte
> `ble-gatt`**—. El motivo de (b): sin un `serviceUuid` no hay filtro de escaneo posible (RBM2.4 lo exige),
> así que montar el adapter sería un transporte que no puede ni buscar — un CTA que promete y no cumple, el
> mismo bug que cerró el fix del chip. Consecuencia honesta: al cerrar F3 la condición (b) es **false en
> producción**, porque el único driver `ble-gatt` (el del emulador) lo registra **F4**.

> **Reconciliación al as-built (F4, fix-loop del review 🟠-1)** — el chequeo (a) pasó a ser una **consulta y
> no una construcción**: mira `NativeModules.BlePlx` (exactamente como `isSppNativeAvailable`, que es lo que
> este requisito dice) en vez de intentar construir el `BleManager`. Motivo largo en la nota de **RBM3.8**: en
> iOS construir el manager es tocar la radio, y este guard corre en el arranque en frío **y** en la pantalla
> de conexión (que ahora lo consulta para saber si puede ofrecer el transporte BLE como elección, RBM5.14).

**RBM2.4** Cuando el operario inicia el descubrimiento, el sistema deberá escanear **filtrado por el `serviceUuid`** declarado en el `TransportCapability` de kind `ble-gatt` del driver, y **no deberá** escanear sin filtro de servicio.

> **Reconciliación al as-built (F3, fix-loop del review) — cubre RBM2.4, RBM2.6 y RBM2.8.** El código cumplía
> los tres desde la primera pasada, pero la mitad *"**del driver**"* de los tres **no estaba falsificada**, y
> eso hacía que el requisito pudiera dejar de cumplirse sin que nada se pusiera rojo: los fixtures de la suite
> declaraban **un solo juego de parámetros** (los UUID Nordic UART y ningún fin de trama propio), así que un
> literal de fabricante hardcodeado adentro del transporte y el valor del driver eran **los mismos bytes**.
> Medido: tres mutantes que re-hardcodean el filtro del escaneo, el par servicio+característica del monitor y
> el delimitador del framer sobrevivían con **136/136 en verde** — o sea, la deuda **RMV5.2 que este delta vino
> a cerrar** era reintroducible sin costo. As-built: la suite ejercita **DOS perfiles de driver** de punta a
> punta (escaneo → device reconocido → monitor → reensamblado → EID), el segundo con **otros** UUID (servicio
> en la forma corta de 16 bits, que además ejercita la expansión de `normalizeUuid128`) y fin de trama `'\r'`,
> con un test de **anti-vacuidad** que exige que los dos juegos difieran en los tres campos. Los tres mutantes
> ahora **caen** nombrando ese test. (Sin esto, F4 —que registra el `ESP32_GATT_DRIVER` con esos mismos UUID
> NUS— habría vuelto el agujero invisible hasta el primer lector de tercero.)

**RBM2.5** Mientras un escaneo esté en curso, el sistema deberá acotarlo con un presupuesto de tiempo y detenerlo al vencer o al conectar, y **no deberá** dejar el escaneo corriendo indefinidamente.

> **Reconciliación al as-built (F3)** — cumplido, con dos precisiones que el requisito no fijaba: (a) el
> techo es **DOBLE** (el presupuesto del escaneo por dentro, un `withTimeoutOr` por fuera), porque "acotarlo"
> con un solo timer deja el latch tomado si el timer no llega o si `startDeviceScan` no se asienta — el 🔴-1
> del SPP entrando por la puerta del descubrimiento; (b) `startDeviceScan` **puede RECHAZAR** y en ese caso
> su listener no se llama nunca: el rechazo se atiende y se loguea con **su** motivo, y el test exige que en
> ese caso NO se loguee `ble_scan_timeout` (decir "timeout" cuando el escaneo ni arrancó es un diagnóstico
> falso). El evento lleva además `seen` (cuántos devices aparecieron anunciando el servicio), que es lo que
> separa "no hay nada" de "hay algo con ese servicio que no es un bastón".

**RBM2.6** Cuando el operario elige un dispositivo, el sistema deberá conectar, descubrir servicios y características, y suscribirse a las **notificaciones** de la característica `notifyCharUuid` del driver.

> **Reconciliación al as-built (F3, fix-loop)**: la mitad *"del driver"* está falsificada por los dos perfiles
> de driver (nota bajo RBM2.4). El test que decía cubrirlo (`el servicio y la característica del MONITOR salen
> del driver, normalizados`) medía en realidad la **normalización** y el `deepEqual` exhaustivo de las opciones
> del connect (RBM2.12), no el ORIGEN — y su título se corrigió para no reclamar lo que no podía probar.

**RBM2.7** Cuando llega una notificación, el sistema deberá decodificar su valor **base64 → bytes → texto de un byte por carácter (ASCII/latin-1)**, conservando los bytes de control de la trama (el `STX` `0x02` del RS420), y **no deberá** decodificarlo como UTF-8.

**RBM2.8** Cuando una trama llega **partida** en varias notificaciones, el sistema deberá reensamblarla con `LineFramer` (reuso, R5.3) usando el delimitador del driver y deberá entregar cada línea completa al contrato como línea cruda.

> **Reconciliación al as-built (F3)** — "reusar `LineFramer` con el delimitador del driver" exigió un cambio
> que ni el requisito ni el design nombraban: **el delimitador estaba HARDCODEADO** en `'\n'` dentro de
> `line-framer.ts` (en el SPP no se notaba porque ahí el framing lo hace el nativo con el terminador del
> driver). Ahora entra por **constructor con default `'\n'`**, así que los dos call sites existentes no
> cambian de comportamiento (con test de regresión). Dos detalles con consecuencia: multi-carácter (`\r\n`)
> consume el delimitador **completo** (sin eso el `\n` sobrante arrancaba la línea siguiente), y un
> delimitador **vacío** en el framer cae al default en vez de colgarse (`indexOf('')` devuelve 0 SIEMPRE →
> bucle infinito de líneas vacías) — quién **rechaza** ese driver es el adapter antes de conectar (RBM2.10),
> el framer solo garantiza no colgar.
>
> **Fix-loop del review**: que el adapter le pase al framer el delimitador **del driver** (y no el default)
> recién quedó falsificado con el segundo perfil de driver — ver la nota bajo RBM2.4. Hasta entonces
> `new LineFramer()` sobrevivía la suite entera, porque el único delimitador que llegaba al adapter era `'\n'`,
> que es exactamente el default.

> **Reconciliación (fix-loop del Gate 2, 2026-08-17)**: la nota de arriba nombra *"el buffer creciendo para siempre"* como el síntoma del terminador equivocado, y el as-built de F3 **no lo acotaba**. Ahora sí: el tope, el descarte fail-closed y el resync son **RBM2.19**, y la detección temprana del mismo estado es **RBM3.12**.

**RBM2.9** Cuando llegan **dos tramas pegadas** en una misma notificación, el sistema deberá entregarlas como dos lecturas separadas.

**RBM2.10** Si el driver declara para su transporte `ble-gatt` un delimitador que este adaptador no puede framear (vacío), entonces el sistema **no deberá** abrir la conexión y deberá registrarlo con su motivo (misma honestidad que el chequeo del delimitador del SPP, 🟠-5).

**RBM2.11** El sistema deberá declarar el modo de ingesta de `ble-gatt` como `raw-line` en la tabla exhaustiva `ADAPTER_INGEST_MODE`, de modo que la decisión no viva como una comparación de literales en el provider (🟡-1).

**RBM2.12** El sistema deberá funcionar con el **MTU por defecto** (23 bytes → 20 de payload), sin depender de que una negociación de MTU tenga éxito.

**RBM2.13** Donde la plataforma sea Android, el sistema deberá resolver los permisos del transporte por una **tabla exhaustiva por transporte**: para `ble-gatt`, API ≥ 31 → `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT`; API ≤ 30 → `ACCESS_FINE_LOCATION` (el escaneo BLE lo exige) — sin cambiar el conjunto que hoy pide el transporte `spp`.

> **Reconciliación al as-built (F2, 2026-08-17)** — el requisito se cumple literal (los conjuntos son esos y el del `spp` no cambió, con test de regresión). Tres cosas que el requisito no fijaba y que la implementación tuvo que decidir:
>
> 1. **Los transportes sin permisos también se declaran.** `serial` (Web Serial, navegador), `ble-hid` (teclado que el SO ya emparejó) y `mfi` (no existe en Android) llevan **conjunto vacío declarado con motivo escrito** — es lo que hace la tabla exhaustiva (`satisfies Record<TransportKind, …>`) y lo que hace que un transporte nuevo no compile hasta declararse.
> 2. **"Lista vacía" significaba dos cosas.** Los consumidores leen `[]` como *concedido* (`classifyPermissionResults([], …) === 'granted'`), correcto para los tres de arriba pero **fail-OPEN** para un transporte desconocido, que también daría `[]`. Se agregó el predicado puro `hasAndroidPermissionPolicy(transport)`, que los dos caminos asincrónicos consultan **antes** de tocar RN y que devuelve `'unavailable'` — "no sé" no es "concedido". El `transport` es además **requerido y sin default** en las tres funciones (un default a `'spp'` es el fallback silencioso que el review de F1 rechazó).
> 3. **La política del manifiesto no cambió, pero hubo que sostenerla en la config.** El config plugin de `react-native-ble-plx` agrega `ACCESS_COARSE_LOCATION` (y una segunda copia de `ACCESS_FINE_LOCATION`) en el array `uses-permission-sdk-23`, que el `tools:node="replace"` de `with-bluetooth-classic.js` **no alcanza**; con el default de la lib entran **sin tope de API**. Se cerró con `neverForLocation: true` en `app.config.ts` (no tocando la política), verificado en el manifiesto **mergeado** del APK del build de T2.8 y falsificado en `with-bluetooth-classic.test.ts`.
>
> **Lo que este requisito NO cubre, dicho**: en API ≤ 30 el escaneo BLE exige además que el **servicio de ubicación esté prendido**, que no es un permiso de app y no se resuelve en `permissions-android.ts` — es estado del adapter (F3) y escenario del banco (F6).

> **Reconciliación al as-built (F3) — lo que quedó declarado y NO implementado.** El párrafo de arriba
> anticipaba que el estado del **servicio de ubicación** (que el escaneo BLE exige en API ≤ 30) era "estado
> que el adapter tiene que reflejar (F3)". **No se implementó, y no por olvido**: `react-native-ble-plx` no lo
> expone (su `state()` es el de la radio) y leerlo pediría una dependencia nativa nueva, justo lo que este
> delta no va a agregar por un caso de API ≤ 30. Lo que el adapter sí hace es no dejarlo invisible: el
> síntoma sale como `ble_scan_timeout {seen:0}`, distinguible de `seen:>0` ("hay algo que no es un bastón")
> aunque **no** de "el bastón está apagado". Queda como escenario del banco de **F6** en Android ≤ 30 y como
> recomendación de backlog para el leader.

**RBM2.14** Si el permiso de BLE es denegado, entonces el sistema deberá reflejar el estado `permission_denied` con CTA, deberá mantener la carga manual operativa y **no deberá** disparar backoff (R12.5, R7.2).

> **Reconciliación al as-built (F3)** — cumplido, y el estado `permission_denied` cubre **dos** caminos que
> el requisito escribía como uno: el permiso denegado de Android (`PermissionsAndroid`) y —en iOS— el estado
> `Unauthorized` de la radio, que **es** la forma en que llega la negación del diálogo de Bluetooth (en iOS no
> hay API para volver a pedirlo: se arregla en Ajustes). Los dos terminan igual: CTA, **sin backoff**, carga
> manual intacta. Y se agregó lo que el requisito no contemplaba: un permiso `unavailable` (puente roto / sin
> RN) **no** se lee como concedido — corta con `disconnected` + log, fail-closed.

**RBM2.15** El sistema **no deberá** habilitar BLE en background: no deberá declarar `UIBackgroundModes: bluetooth-central` en iOS ni configurar el plugin de `react-native-ble-plx` con background habilitado (R6.9 — foreground-only en MVP).

> **Reconciliación al as-built (F2)** — cumplido, con dos precisiones. (a) En el plugin son **dos** opciones independientes, no una: `modes: []` es la que escribiría `UIBackgroundModes: ['bluetooth-central']` en iOS, e `isBackgroundEnabled: false` es la que agregaría `<uses-feature android.hardware.bluetooth_le required="true">` en Android (que además excluiría de Google Play a los devices sin BLE). Las dos se declaran explícitas aunque coincidan con el default de la lib. (b) El oráculo no es solo el assert de las opciones: hay un **guard sobre la ausencia** que exige que las cadenas `bluetooth-central`/`bluetooth-peripheral` no aparezcan en **ninguna parte** de la config serializada, en las 4 variantes — así queda cerrada también la puerta de declararlo a mano en `ios.infoPlist`. Verificado además en el `Info.plist` que devuelve `expo config --type introspect` y en el manifiesto **mergeado** del APK.

**RBM2.16** El sistema deberá reusar `remembered-device.ts` para persistir el bastón BLE elegido y deberá implementar `autoConnect()` (R6.4) con la misma política de `ConnectTrigger` que el SPP.

**RBM2.17** El sistema deberá dejar la instalación de `react-native-ble-plx` reflejada en el **censo de dependencias con código nativo Apple** de `app/ios-purpose-strings-guard.test.ts`, con su veredicto escrito (toca CoreBluetooth → exige `NSBluetoothAlwaysUsageDescription`, ya declarada).

> **Reconciliación al as-built (F2)** — el veredicto es el que el requisito pide (**exige** la clave, que ya estaba declarada y con texto útil), pero el paréntesis *"toca CoreBluetooth"* es más sutil de lo que parece y cambia **qué guard lo sostiene**: las fuentes propias del paquete (`ios/BlePlx.m` + 3 cabeceras) **no nombran ni un símbolo de CoreBluetooth** — el framework entra por su dependencia de CocoaPods `MultiplatformBleAdapter 0.2.0`, que vive en `Pods/` y no en `node_modules/`, o sea en el punto ciego declarado nº2 del guard. Consecuencias: (a) lo que hace obligatoria la clave es la **red por nombre** (`MODULES_BY_NAME`), no el escaneo de símbolos; (b) el paquete **no lleva** entrada en `MODULE_VERDICTS`, porque sin hits sería un veredicto "fantasma" y el guard que los caza lo rechazaría; (c) el veredicto quedó **ejecutable** en un test propio, escrito como disyunción (si algún día el escaneo sí lo ve, exige `MODULE_VERDICTS`; si no lo ve, exige la red por nombre **y** que el podspec siga dependiendo del pod que explica la ceguera) para que una versión futura no produzca un rojo espurio.
>
> **Efecto colateral que hubo que reconciliar**: el config plugin de la lib **escribe el `Info.plist`**, lo que vuelve falso el **límite nº5** del propio guard (*"los nuestros no tocan iOS"*). Cerrado pasándole al plugin la **misma constante** de purpose string que usa `ios.infoPlist` (así el resultado no depende del orden de los mods) + un test que impide que las dos copias divergan. Medido en el plist introspectado: el texto que sobrevive es el nuestro, en español.

**RBM2.18** El sistema deberá vetar la compatibilidad de `react-native-ble-plx` con el stack instalado (Expo SDK 56 / RN 0.85.3 new-arch bridgeless) **antes** de comprometer el adaptador, y si es incompatible deberá **parar y reportar al leader**.

> Mismo procedimiento que el veto de T-MV.5.1, que dio COMPATIBLE contra el código instalado y un build Gradle real, no contra docs. El precedente que obliga a hacerlo: `react-native-quick-sqlite` (bindings JSI no instalados bajo bridgeless) — y `react-native-ble-plx` **sí** tiene C++/JSI, así que la analogía que fue incorrecta para `bluetooth-classic` acá **puede** aplicar.

> **Reconciliación al as-built (F2, 2026-08-17) — veredicto: COMPATIBLE, FIRME.** Dos correcciones al párrafo de arriba, las dos verificadas contra el paquete instalado y un build real (`progress/veto_ble-plx.md`, `progress/impl_ios-ble-mfi-f2.md` §5):
>
> 1. **La premisa era FALSA**: `react-native-ble-plx` **no tiene una sola fuente C++/JSI** (cero `.cpp`/`.hpp`/`.cc`; los únicos `.h` son cabeceras de puente ObjC/Swift). El modo de falla de `quick-sqlite` **no tiene dónde ocurrir**. La analogía era incorrecta acá también.
> 2. **El riesgo real es otro, y el build lo dejó a la vista**: el codegen produce un `schema.json` **vacío** (`{"libraryName":"","modules":{}}`) porque la lib **no tiene specs de TurboModule**; su clase es `ReactContextBaseJavaModule` → es un **módulo de puente LEGACY** que bajo bridgeless anda por la **capa de interop**. O sea que el build prueba *compila + linkea + autolinkea + empaqueta* (`BUILD SUCCESSFUL 3m 23s`, `PackageList.java` con `BlePlxPackage`, APK generado, **0 builds de EAS**) y **no** prueba que el puente resuelva en runtime. Lo que sostiene esa mitad es un precedente fuerte —`react-native-bluetooth-classic` es la misma clase de módulo y **lee de verdad en device** sobre este mismo stack— y la medición definitiva es el banco de **RBM6.1**, que es donde ya estaba puesta. El "compila" **no** se lee como "el transporte anda" (lección de `dad711f`).

**RBM2.19** Mientras un transporte alimente al `LineFramer`, el sistema deberá acotar su buffer con un **tope de tamaño**; si el tope se pasa, el sistema deberá **descartar** todo lo acumulado, deberá **registrarlo** con un evento distinguible del silencio (`ble_framer_overflow`) y **no deberá** truncar en silencio, desconectar, ni bloquear la carga manual. Además deberá **descartar la primera línea que cierre después del descarte** (le falta el principio), de modo que nunca se ingiera una trama recortada.

> **De dónde sale este requisito**: es el **HIGH-1 del Gate 2 del delta** (`progress/security_code_04-ios-ble-mfi.md`, fix en `progress/impl_ios-ble-mfi-gate2-fix.md`). El buffer del framer acumulaba **sin cota** y ninguna defensa lo tapaba: el watchdog de mudez miraba un reloj que **la propia basura reseteaba** (ver RBM3.12), la sonda de liveness pregunta si el peer está conectado —y el que inunda lo está— y `isValidTag`/dedup/confirmación corren *después* del framer. Hasta este delta el único call site de producción era `adapter-web-serial` (web, escritorio, detrás del gesto obligatorio de `requestPort()`); `adapter-ble-gatt` es el **primero nativo, sobre la radio y que auto-conecta sin gesto** (RBM2.16), y en BLE **no hay framing nativo**: el framer de JS es lo único que corta.
>
> **El disparador realista no es un atacante**: un lector cuyo fin de trama no coincide con el que declara su `ReaderDriver` — el `term cr` / 🟠-5 que ya se pagó en el SPP, medido en device. (El adversarial también existe —`deviceMatch` por nombre anunciado, NUS sin pairing ni cifrado, ADR-003— y el mismo tope lo cubre.)
>
> **El daño era manual-first, no memoria.** Sin tope, cada notificación vuelve a **aplanar** un buffer que crece (el `indexOf` necesita la cadena plana): el costo es cuadrático y el hilo de JS se muere mucho antes que la RAM. Medido con 25.000 notificaciones de 20 bytes: **4-6 ms con tope, 2200-2450 ms sin tope**. Un proceso que se muere se lleva la carga manual, en la manga y sin señal — y eso rompe el invariante duro de la unidad (R7.2 / R9.6 / RBM9.5), que todos los demás modos de falla de este delta respetan.
>
> **As-built** (`line-framer.ts`): tope `LINE_FRAMER_MAX_BUFFER = 4096` caracteres (~117× la trama legítima más larga que conocemos, la del RS420: 35), parametrizable por constructor **pero no apagable** — cualquier valor que no sea un número finito ≥ 1 (incluidos `0` e `Infinity`) cae al default, porque un invariante que un call site puede desactivar es una opción y una opción se elige mal exactamente una vez. El evento sale como **sub-evento por mensaje** de `read_loop_error` (`ble_framer_overflow: descartados N de tope M`), que es la forma que ya usan `ble_decode_failed` / `ble_monitor_lost` / `ble_scan_error` / `liveness_probe_unavailable` en este transporte: una entrada que llega y se descarta es esa misma familia. Vigilado por `line-framer.test.ts` (el archivo **no existía**: el invariante no lo miraba nada), con los mutantes que caen listados en su cabecera.
>
> **Lo que se descartó, dicho para que no se reintente a ciegas**: arrancar el `indexOf` en el *solape* en vez de en 0 (O(chunk) en vez de O(buffer)). Medido **dentro del tope no mueve el tiempo** (4 ms vs 6 ms) y agrega el riesgo de partir mal un fin de trama de dos caracteres que cae entre dos notificaciones. No se paga riesgo de framing por una mejora de cero.

## RBM3. Las lecciones del SPP son requisitos del transporte nuevo, no sugerencias

> Los tres bloqueantes 🔴 del SPP (`progress/impl_baston-spp-bloqueantes.md`) son **defectos de la máquina de estados en los bordes**, no accidentes de una librería: los tres reaparecen en cualquier transporte con radio, latch y eventos del SO. Este bloque los declara como requisitos del `adapter-ble-gatt` (y del `adapter-mfi-ios` cuando se destrabe) para que no haya que redescubrirlos en device.

**RBM3.1** Mientras una cadena de reintentos haya arrancado **sin un gesto del operario**, el sistema deberá acotarla con el tope de tiempo `UNPROMPTED_RETRY_BUDGET_MS` y con la política por `ConnectTrigger` de `connect-trigger.ts` (tabla exhaustiva, `retry` hereda), sin duplicar esa lógica.

> **Reconciliación al as-built (F3)** — el tope está implementado **dos veces a propósito** (en la cabecera de
> `scheduleReconnect` y adentro del timer) y las dos veces **antes** del gate de foreground: una cadena con el
> presupuesto vencido tiene que MORIR, no quedarse esperando el retorno a primer plano para seguir
> martillando. La segunda copia no es redundante y lo probó un **mutante que sobrevivió** a las 133 pruebas
> (borrar la de la cabecera): el caso que solo ella cubre es programar un reintento con la cadena **ya
> vencida** y la app en **background**, donde sin ella el tope se vuelve evitable guardando el teléfono en el
> bolsillo. Hay test nuevo por eso (detalle en `progress/impl_ios-ble-mfi-f3.md` §5, mutante MB3.1).
>
> **Precisión del fix-loop del review (⚪-4)**: de las dos copias, al cerrar la primera pasada solo la de la
> **cabecera** estaba falsificada — borrar la del **timer** dejaba 136/136 en verde, porque el desenlace
> observado (`off` + `autoconnect_exhausted`) se alcanzaba igual por la cabecera **después de un intento más**.
> O sea: no eran dos oráculos, era un oráculo y un cinturón. Ahora el cinturón tiene el suyo: el test del tope
> exige además que con el presupuesto ya vencido el timer **no sume un intento** (en device, ese intento de más
> son ~10 s de radio martillando por apertura de la app). Los dos mutantes caen.
>
> **Y el DESTOPE por gesto tiene su oráculo (🟡-2 del review)**: `runConnect` re-aplica la política del trigger
> cuando llega un `connect()` con un intento **en vuelo** (no solo cuando la cadena ya murió). Eso también se
> podía borrar en verde; el caso real es *"abro la app, el bastón tarda, toco «Volver a conectar» a los 90 s"*
> → sin esa línea el tap no destopa nada y la cadena muere igual a los 120 s, con el gesto del operario sin
> ningún efecto observable. El test nuevo es diferencial (el mismo escenario **sin** el tap tiene que morir en
> `off`), así que no puede pasar por vacuidad.

**RBM3.2** El sistema deberá dar presupuesto (`withTimeout` / `withTimeoutOr` de `bridge-timeout.ts`) a **todo** `await` del adaptador BLE que cruce el puente nativo, y deberá liberar el latch de conexión en el `finally` **y** en `disconnect()`, usando una **generación de intento** para que un intento viejo que despierta no pise al vigente.

**RBM3.3** El sistema deberá extender el guard estático de presupuestos (`spp-bridge-timeout-guard.test.ts`, mitad "bordes declarados") al adaptador nuevo, de modo que un `await` del puente sin techo **nazca en rojo**.

> **Reconciliación al as-built (F3, 2026-08-17)** — el requisito se cumple pero **NO donde el task decía**, y
> la diferencia es la que separa un guard de un adorno. `tasks` pedía agregar el adapter a
> `BOUNDED_AT_THE_BOUNDARY` de `spp-bridge-timeout-guard.test.ts`: esa mitad del guard mira **solo** awaits de
> primitivas nativas (`SecureStore|PermissionsAndroid|AsyncStorage|NativeModules`), y el adapter BLE **no
> awaitea ninguna** (habla por `manager.` / `device.` / `this.env.`) → habría sido una entrada **VACUA**: cero
> awaits mirados, verde garantizado, requisito "cumplido" sin vigilar nada. As-built: la mitad que sí modela
> el puente de un adapter dejó de mirar UN archivo y recorre una tabla `RADIO_ADAPTERS` con los prefijos de
> puente de cada uno, la tabla **se deriva del árbol** (todo `adapter-*.ts` con un `require('react-native…')`
> perezoso tiene que estar declarado, así que `adapter-mfi-ios.ts` de F5 **nace en rojo**), y hay un test de
> **no-ceguera** (cuando todo está envuelto la lista de violaciones es vacía por construcción, así que
> renombrar la variable de la lib dejaría el guard verde mirando nada). Falsificado con 3 mutantes: el await
> sin techo cae **nombrando archivo y línea** (`adapter-ble-gatt.ts:1127`) mientras las 75 pruebas del adapter
> quedan en VERDE — que es exactamente por qué el guard hace falta.

**RBM3.4** Cuando el SO informa una desconexión, el sistema deberá atender **únicamente** el evento de su propio dispositivo (suscripción por device de `react-native-ble-plx`), y **no deberá** reaccionar a un listener global que cualquier dispositivo pueda disparar (🔴-2 del SPP).

**RBM3.5** Si el evento de desconexión no llega (app minimizada, evento descartado por el puente), entonces el sistema deberá reconciliar el estado con una **segunda fuente de verdad** consultada al volver a foreground **y** por un poll periódico, fallando **cerrado** (ante duda, no seguir afirmando "conectado") — BENCH-1.

**RBM3.6** Mientras la app no esté en foreground, el sistema **no deberá** conectar, escanear ni reintentar, y deberá verificar el foreground **al disparar** el timer y no solo al programarlo (R6.9, 🟠-1).

**RBM3.7** Si llega un `connect()` con otro dispositivo objetivo mientras hay un intento en curso, entonces el sistema deberá encolar ese objetivo, atenderlo al terminar el intento vigente y dejar log (`connect_superseded`), sin descartarlo en silencio.

**RBM3.8** El sistema **no deberá** mostrar un diálogo del SO (permiso, "¿activar Bluetooth?") desde un camino automático: un arranque o un reintento deberá **consultar** el estado del permiso en vez de pedirlo.

> **Reconciliación al as-built (F3, fix-loop del review 🟡-3)** — cumplido, y ahora también **por resultado** y
> no solo por contadores de llamadas. En la primera pasada el doble hacía que `checkPermissions()` y
> `ensurePermissions()` devolvieran **lo mismo** en toda la suite, así que ningún test distinguía los dos
> caminos por su desenlace: medido, borrar el **gate de permiso del `autoConnect`** dejaba todo en verde. El
> test nuevo ejercita la secuencia real —`check → denied` (nunca se pidió) y después `ensure → granted` (el
> gesto muestra el diálogo y el operario concede)— y exige que el arranque **no conecte, no toque la radio y no
> emita estado**, y que el gesto sí conecte.

> **Reconciliación al as-built (F4, fix-loop del review 🟠-1, 2026-08-17) — en iOS este requisito estaba
> INCUMPLIDO por una capa más arriba, y el código afirmaba lo contrario.**
>
> En iOS el diálogo de permiso de Bluetooth no lo pide ninguna API: lo muestra el SO **la primera vez que la
> app usa CoreBluetooth**, y **construir el central manager es ese primer uso**. El as-built de F4 construía
> el `BleManager` dentro de `isBleGattTransportAvailable()`, que corre en `instantiateTransport` — o sea en el
> **primer render del provider**, sin ningún gesto. Consecuencia concreta: un iPhone recién instalado, de un
> operario que nunca vio un bastón, podía recibir el diálogo de Bluetooth **al abrir la app**. Y encima el
> comentario del adapter y la nota de T3.10 afirmaban que *"el arranque en frío no toca la radio"*: eran
> ciertas de `autoConnect()` y falsas del sistema. (La analogía con `isSppNativeAvailable` tampoco valía: ese
> guard **solo consulta** `NativeModules`, no construye nada.)
>
> **Cómo quedó**: el borde del módulo nativo se partió en dos operaciones con costos distintos
> (`BleModuleEnv`): `nativeModulePresent()` **consulta** `NativeModules.BlePlx` —lo mismo que el SPP— y
> `constructManager()` **construye** el client. La disponibilidad del transporte pregunta solo lo primero, y
> la construcción quedó donde ya hay gate: `doConnect` (gesto o cadena con su política de `ConnectTrigger`) y
> `autoConnect` **después** del gate de bastón recordado. Con eso RBM3.8 se sostiene **por construcción**
> también en iOS.
>
> **El oráculo es de comportamiento, no un comentario**: el borde es inyectable y el test **cuenta
> construcciones del manager** durante un arranque en frío completo (disponibilidad + adapter + `autoConnect`
> sin bastón recordado) → tiene que dar **cero**, con control positivo (con bastón recordado da **uno**, y
> queda cacheado). Los dos mutantes que reintroducen la construcción eager —en el chequeo de disponibilidad y
> antes del gate del recordado— **mueren**. Falta la verificación en device (F6/T6.4): abrir la app en una
> instalación limpia sin bastón recordado y confirmar que el diálogo **no** aparece.

**RBM3.9** El sistema deberá resetear el contador de backoff solo si el link **duró** `LINK_DWELL_MS`, de modo que un flap no deje el reintento martillando en `attempt:0` (🟡-3).

**RBM3.10** Mientras el link esté conectado y no llegue un byte durante el presupuesto de silencio, el sistema deberá dejarlo escrito en el log (`connected_silent`) sin desconectar, para distinguir "conectado y mudo" de "socket muerto" y de "el operario no bastonea" (🟠-5).

> **Reconciliación (fix-loop del Gate 2, 2026-08-17)**: este requisito se cumple **literal y sin cambios** (no llega un byte → `connected_silent`), pero el as-built de F3 lo cumplía sobre un reloj que **cualquier byte** reseteaba, así que el caso "entran bytes y no cierran trama" —el peor de los tres que este evento vino a distinguir— no producía **ningún** log. Ese caso pasó a tener requisito y evento propios: **RBM3.12** (`ble_stream_unframed`).

**RBM3.11** El sistema deberá ejercitar la máquina de estados completa del adaptador BLE en `node:test` con el entorno **inyectado** (patrón `SppEnv`), incluidas las promesas que **no resuelven nunca**, el reloj y la desconexión de otro dispositivo.

> **Reconciliación al as-built (F3, fix-loop del review 🟡-3)** — "el reloj" estaba **inyectado pero no
> ejercitado**: el knob existía y ningún test lo pasaba, así que toda la suite corría desde `t=0`, donde
> `now() - lastDataAt` y `now()` dan el mismo número (idem `now() - connectedAt`). Consecuencia medida: los
> mutantes que borran la **resta** —o sea, la medición del intervalo del `connected_silent` (RBM3.10) y del
> dwell (RBM3.9)— sobrevivían la suite entera. As-built: los tests que miden un intervalo arrancan el reloj en
> un instante REAL (`CLOCK_START`) y los dos mutantes caen. La misma corrección se aplicó a los presupuestos
> del doble (eran los cuatro iguales, así que **cuál** presupuesto acota **cuál** await tampoco se podía
> observar): ahora son distintos y los tests asertan el `ms` del `bridge_timeout`.

**RBM3.12** Mientras el link esté conectado, el sistema deberá medir la salud del stream por la **última trama COMPLETA** y **no** por el último byte recibido; y si durante el presupuesto de silencio entran bytes que **no cierran ninguna trama**, deberá registrarlo con un evento propio (`ble_stream_unframed`, con los dos intervalos: desde el último byte y desde la última trama) **distinto** de `connected_silent`.

> **De dónde sale**: es la segunda mitad del HIGH-1 del Gate 2. `connected_silent` (RBM3.10) comparaba contra un reloj que se refrescaba con **cada chunk**, así que el peor estado del transporte —conectado, con el lector hablando y ninguna trama cerrando— mantenía el watchdog en **verde permanente**: no es que la defensa no actuara (ya sabíamos que solo loguea), es que **ni loguaba**, mientras el buffer del framer crecía por debajo.
>
> **RBM3.10 no cambia de significado**: sigue siendo "no llegó un byte" y sigue emitiendo `connected_silent` en ese caso (los dos relojes coinciden cuando nadie bastonea). Lo que se agrega es la **tercera causa**, que antes era invisible y ahora tiene nombre propio. Los dos intervalos juntos son el diagnóstico: `bytes hace 0 ms, sin cerrar trama hace 60000 ms` es la firma exacta del terminador equivocado, y aparece a los 45 s en vez de esperar los ~4 KB que tarda el tope del framer en descartar.
>
> **El discriminador es la VENTANA**, no la comparación entre los dos relojes: "entró un byte DENTRO del presupuesto de silencio". Comparar `bytesMs < silentMs` parece equivalente y no lo es — una trama que quedó a medias en un momento benigno deja el reloj del byte por delante para siempre y el link mudo se reportaría "con basura" en todos los polls siguientes, que es un diagnóstico FALSO (peor que ninguno). Con la ventana, ese caso se autocorrige en el poll siguiente. Los dos mutantes mueren en `adapter-ble-gatt.test.ts`.
>
> **En los transportes con framing NATIVO no aplica** y no se toca nada: en `spp-android` y `mfi-ios` el nativo entrega la trama y `splitSppPayload` no acumula, así que un payload recibido **es** una línea — byte y trama son el mismo evento.

## RBM4. `adapter-mfi-ios` — prearmado y gateado por la lista de protocolos (T3)

> **Gated por negocio, con la arquitectura viva.** No hay dependencia nueva (contexto §1.3): es la **rama iOS** (ExternalAccessory) de `react-native-bluetooth-classic`, que ya está instalada. Lo que falta es la **cadena de protocolo iAP del fabricante** — Allflex y Datamars, trámite MFi, canal Facundo. **Gallagher no tiene ninguna key que dar** (contexto §2): su camino iOS es BLE, no MFi.

**RBM4.1** El sistema deberá exponer `adapter-mfi-ios.ts` como un `StickAdapter` (`kind: 'mfi-ios'`) sobre la rama iOS de `react-native-bluetooth-classic`, **sin agregar ninguna dependencia nueva**.

**RBM4.2** Mientras el build declare la lista `UISupportedExternalAccessoryProtocols` **vacía**, el adaptador deberá reportarse **no disponible** y **no deberá** cargar el módulo nativo ni tocar el framework ExternalAccessory (ni siquiera leyendo `NativeModules.RNBluetoothClassic`).

> Leer ese global **instancia** el módulo nativo en bridgeless (`BridgelessNativeModuleProxy` → `RCTTurboModuleManager` → `[moduleClass new]`), como ya dejó documentado el guard de purpose strings. Con la clave declarada eso hoy no crashea — el requisito es igual: sin protocolo declarado, no hay nada que abrir.

> **Reconciliación al as-built (F5, 2026-08-17)** — el requisito se cumple literal, con dos cosas que no
> decía y que la implementación tuvo que fijar:
>
> 1. **El costo de "consultar" NO es el mismo que en el BLE, y por eso el orden es distinto.** En
>    `adapter-ble-gatt` el chequeo del módulo (`NativeModules.BlePlx`) es barato y va primero; acá
>    `nativeModulePresent()` va **último**, después del gate de datos, porque leer
>    `NativeModules.RNBluetoothClassic` **instancia** el módulo y su `init()` construye
>    `EAAccessoryManager.shared()` y hace el force-cast sobre la clave del plist. Encima, en iOS **cada**
>    método del nativo pasa por `checkBluetoothAdapter()`, que usa un `CBCentralManager` **lazy**, y la propia
>    lib documenta que eso *"prompt bluetooth permission on first call of any bluetooth-related method"*: o
>    sea que tocar el nativo en el arranque le puede mostrar el diálogo de Bluetooth del SO a un operario que
>    no tocó nada — el 🟠-1 del review de F4, en este transporte. El orden as-built es: iOS → un driver
>    declara `mfi` → el build declara SU cadena → el fin de trama es frameable → **y solo entonces** el módulo.
> 2. **El oráculo es un contador, no un comentario.** El borde del módulo entra inyectado (`MfiModuleEnv`) y
>    el test cuenta los toques durante un arranque en frío COMPLETO (guard de disponibilidad + construcción
>    del adapter + `autoConnect` + `connect`): tiene que dar **cero**, con control positivo (con la cadena
>    declarada, >0). Los dos mutantes que reintroducen el toque eager —en el guard y en el `doConnect`—
>    **mueren**. Lo que ningún unit puede cerrar queda declarado: que el diálogo del SO no aparezca en un
>    device es medición de F6/T6.4.
> 3. **Un motivo más que el requisito no enumeraba**: `delimitador-no-soportado`. Son **seis** motivos de
>    `mfi_unavailable`, no cuatro (ver la nota de RBM4.8, hallazgo 3).

**RBM4.3** El sistema **no deberá** eliminar la clave `UISupportedExternalAccessoryProtocols` de `app.config.ts`: la lista vacía es el **guard anti-crash** del `init()` de la librería (force-cast `as! [String]` sobre un opcional), y el guard que lo verifica deberá seguir en verde.

**RBM4.4** Cuando el build declara al menos una cadena de protocolo y un `ReaderDriver` declara un `TransportCapability` de kind `mfi` con esa misma `protocolString`, el sistema deberá resolver su binding como **disponible**, sin cambios de código.

**RBM4.5** Si un driver declara una `protocolString` que el build **no** declara, entonces el sistema deberá marcar ese binding `available:false` con el motivo explícito ("falta declarar el protocolo en el build") y **no deberá** intentar una conexión que fallaría (RMV3.7).

> **Reconciliación al as-built (F5, 2026-08-17) — este requisito es lo que obligó a meter `'mfi-ios'` en
> `BUILT_ADAPTERS`, y a invertir el guard de F4 que exigía lo contrario.** En F4 el kind estaba
> deliberadamente afuera porque el adapter no existía (declararlo construido habría dado `available:true`
> sobre un transporte que `instantiateTransport` no podía montar). Con el adapter escrito, dejarlo afuera
> pasa a ser **peor que ruido: miente el motivo** — el binding diría `adapter-no-construido` ("todavía no lo
> soportamos") cuando la verdad es `build-sin-protocolos` ("falta la autorización del fabricante"), y el
> motivo equivocado manda a buscar el dato equivocado. Es la distinción que este requisito compró para el
> copy de la pantalla (RBM5.14). Y que el kind esté "construido" **no** lo vuelve montable: RBM5.5 cruza esa
> mitad con la lista de protocolos declarada (hoy vacía) y `TRANSPORT_INSTALLABLE['mfi-ios']` incluye el gate
> de datos, así que hoy la fila —si existiera un lector `mfi`— no sería accionable. El guard de
> `wiring.test.ts` quedó escrito al revés (exige la PRESENCIA, citando este requisito y RBM4.7) y el mutante
> que lo saca **muere**.

> **Nota de reconciliación (F4, as-built 2026-08-17)**: el `unavailableReason` quedó en **TODOS** los bindings no disponibles y no solo en los de MFi — los que no lo son traen `'adapter-no-construido'`. El motivo es el que este mismo requisito compra: si `available:false` significara "MFi sin protocolo" cuando hay motivo y "cualquier otra cosa" cuando no lo hay, ese significado sería **implícito**, y es exactamente cómo la UI terminaría diciendo *"todavía no lo soportamos"* sobre un bastón al que solo le falta la autorización del fabricante. La consecuencia visible: tres `deepEqual` de bindings del delta multivendor (RS420 en Android sin construir, HID en iOS, HID en Android) ganaron esa clave — con `adapterKind`, `transportKind` y `available` **idénticos**, o sea que la prioridad de Android **no cambió** (RBM5.4 intacto). El invariante ("todo `available:false` trae motivo, todo `available:true` no lo trae") se verifica sobre la matriz completa de drivers × plataformas × builds, no sobre un caso elegido.

**RBM4.6** El sistema **no deberá** inventar ni popular ninguna `protocolString` real en este delta: el `RS420_DRIVER` deberá seguir sin declarar el transporte `mfi` hasta que el fabricante entregue la cadena.

**RBM4.7** El sistema deberá dejar documentado y **probado con una cadena sintética** el diff exacto que destraba MFi el día que llegue el dato (una entrada en la lista de `app.config.ts` + una `TransportCapability` en el driver), de modo que ese día no haya que escribir código.

> **Reconciliación al as-built (F5, 2026-08-17)** — la prueba ejecutable quedó en **tres capas** y no en una,
> porque "cero código ese día" tiene tres mitades independientes que pueden fallar solas:
>
> 1. **El DATO llega al gate.** `ea-protocols.test.ts` toma la config REAL de la app (`app.config.ts` es una
>    función pura de `process.env`), le agrega la cadena sintética **en la ruta que producción lee**
>    (`ios.infoPlist[KEY]`) y el binding pasa a `available:true`. Cubre el modo de falla silencioso de que la
>    clave se mueva de rama y la lista quede en `[]` para siempre.
> 2. **El TRANSPORTE anda con ese dato.** `adapter-mfi-ios.test.ts` corre el camino completo con la cadena
>    declarada (listar → filtrar por protocolo → abrir la sesión con las opciones del driver → stream →
>    EID), con **dos perfiles de driver** que difieren en la cadena Y en el fin de trama. Sin el segundo
>    perfil, un literal hardcodeado adentro del transporte y el valor del driver serían los mismos bytes: los
>    dos mutantes que re-hardcodean cada parámetro **mueren** nombrando el perfil B.
> 3. **El transporte es ALCANZABLE con ese dato.** `wiring.test.ts` corre el invariante de alcanzabilidad
>    inyectando solo esos dos datos y exige que `mfi-ios` quede honrado por la preferencia + ofrecido por la
>    pantalla + con un escritor que lo persista. Es la mitad que el requisito no nombraba y que hace la
>    diferencia entre "el dato entra" y "el operario puede usarlo".
>
> Y una consecuencia de proceso: **cualquier cosa que ese día haya que sacar de una lista es código**. Por eso
> `'mfi-ios'` tuvo que salir de `NOT_SELECTABLE_AS_PREFERENCE` y entrar a `BUILT_ADAPTERS` **en este diff** y
> no el día del dato (ver las notas de RBM4.5 y RBM5.6).

**RBM4.8** El sistema deberá moldear la forma del adaptador sobre el **código nativo instalado** (`ios/conn/*.swift`, `device/NativeDevice.swift` de `react-native-bluetooth-classic`) y no sobre su README; si esa rama no expone en JS lo necesario para listar accesorios por protocolo, abrir la sesión y leer el stream, el sistema deberá **parar y reportar al leader**.

> Es la lección literal del SPP: *"la forma que quedó salió de leer el código nativo, no su README"*, después de que el diseño original describiera un adapter que no funcionaba.

> **Reconciliación al as-built (F5, 2026-08-17) — VEREDICTO: la rama iOS ALCANZA, no se para. Y el
> requisito se cobró SIETE hallazgos, el último de los cuales dejaba el transporte muerto en verde.**
>
> Las tres capacidades existen en JS: **listar** (`getBondedDevices()` → `EAAccessoryManager
> .connectedAccessories` mapeados por `NativeDevice.map()`), **abrir la sesión** (`connectToDevice(id,
> options)` → `determineProtocolString` cruza el plist con `accessory.protocolStrings` y abre una
> `EASession`) y **leer el stream** (evento `DEVICE_READ@<serialNumber>` vía `device.onDataReceived`). Con eso
> la **pregunta abierta nº1** de este delta queda RESUELTA.
>
> Los hallazgos que cambiaron la forma del adapter (los seis primeros están completos en la cabecera de
> `adapter-mfi-ios.ts`): (1) **no hay descubrimiento** en iOS (`startDiscovery` tira `Method not
> implemented`) → solo listar y filtrar; (2) **el framing lo hace el nativo** y entrega mensajes ya
> delimitados y sin terminador → pasarlos por `LineFramer` daría CERO lecturas para siempre; (3) el
> terminador tiene que ser de **UN carácter** (el `read()` consume el delimitador con `index(after:)`, que
> avanza uno) — en Android el multi-carácter sí funciona, así que los dos chequeos **no se pueden unificar**
> y hay test diferencial; (4) **las opciones del SPP crashean acá** (force-cast de `charset` a
> `CFStringEncoding`); (5) `available()` **no se llama nunca** (bucle infinito en el nativo + el selector que
> el `.m` exporta no es el que el Swift implementa) y el guard es la AUSENCIA de la firma en `MfiNative`;
> (6) **todo camino nativo toca CoreBluetooth** por su `CBCentralManager` lazy.
>
> **(7) — y es el que justifica esta nota: el WRAPPER JS de la lib se come `protocolStrings`.** El nativo sí
> publica la clave, pero `BluetoothModule.getBondedDevices()` no devuelve los diccionarios: devuelve un
> `BluetoothDevice` por accesorio que copia `name/address/id/bonded/deviceClass/rssi/type/extra` y **no
> `protocolStrings`** (queda en su campo privado `_nativeDevice`; la interfaz `BluetoothNativeDevice` ni lo
> declara, porque está pensada para Android). Leyendo solo la forma cruda —que es lo que la primera pasada de
> esta fase hacía, con la cita del Swift correcta y la capa de arriba sin mirar— **todo** accesorio salía con
> `protocolStrings: []`, `pickMfiAccessory` devolvía `null` SIEMPRE y el transporte quedaba clavado en
> `mfi_accessory_not_found`. O sea: **RBM4.7 habría sido falso el día que llegara la cadena del fabricante**,
> con el síntoma más caro de esta unidad ("no pasa nada", indistinguible de "el bastón está apagado") y con
> toda la suite en verde. Cerrado aceptando las dos formas (`mfiProtocolStringsOf`) + un guard **derivado del
> paquete instalado** que ata las tres afirmaciones de las que eso depende, para que un `pnpm update` que
> cambie la forma nazca en rojo en vez de mudo. Es exactamente el modo de falla que este requisito nombra —
> "moldear sobre el código instalado" incluye **la capa JS que envuelve al nativo**, no solo el Swift.

**RBM4.9** El sistema deberá declarar el modo de ingesta de `mfi-ios` como `raw-line` (el accesorio entrega la trama del lector, no un EID limpio) y deberá parametrizarlo por el `frameParser` del driver (RBM1.1).

## RBM5. Selección y prioridad por plataforma (T4)

> **Buildable-hoy, puro.** Extiende `selection-priority.ts` (RMV2) sin cambiar su forma: sigue siendo lógica pura, determinística y testeable sin device (RMV2.6, RMV2.8).

**RBM5.1** El sistema deberá cambiar la prioridad de transporte de iOS a `['mfi', 'ble-gatt', 'ble-hid']` (contexto §4: *"en iOS el orden pasa a ser mfi (si hay protocolo) → ble-gatt → manual"*).

> **Por qué MFi primero y HID último**, dado que RMV2.1 tenía a HID en la cabeza: cuando la cadena de protocolo existe, MFi es un **stream nativo del lector que el cliente ya tiene** (RS420, SRS2i, XRS2i) y no depende de que el operario tenga un campo enfocado; BLE-GATT va segundo porque es abierto pero hoy solo lo habla el HR5 v3; HID queda último porque secuestra el teclado del SO y sigue **gateado** por el gate físico (RBM8). El orden lo fijó el contexto aprobado; acá se traduce, no se re-decide.

**RBM5.2** El sistema deberá mapear el transporte `ble-gatt` al `AdapterKind` `'ble-gatt'` **en iOS y en Android**, y el transporte `mfi` al `AdapterKind` `'mfi-ios'` **solo en iOS** (fuera de iOS, `null`).

**RBM5.3** El sistema deberá seguir mapeando el transporte `spp` a `null` fuera de Android, de modo que `spp-android` **no se ofrezca** en iOS (contexto §4).

**RBM5.4** El sistema deberá conservar sin cambios la prioridad de Android (`['spp', 'ble-gatt', 'ble-hid']`) y la de web (`['serial']`).

**RBM5.5** El sistema deberá calcular el `available` de un binding `mfi-ios` como la conjunción de "el adaptador está construido en el build" **y** "la `protocolString` del driver está declarada en el build" (RBM4.4/RBM4.5), tomando la lista declarada como una entrada **inyectable**.

**RBM5.6** El sistema deberá montar como transporte activo el que corresponde al **bastón recordado** cuando hay uno, y deberá caer al piso por plataforma cuando no lo hay.

> **Por qué entra**: sin esto, en Android `selectTransportAdapter` monta siempre `spp-android`, así que un lector **BLE** (el HR5 v3, el único consumidor conocido del transporte nuevo) sería **inalcanzable en producción justo en la plataforma donde está el productor argentino**, y el banco de RBM6 en Android no podría correr el camino real. El transporte se elige por el bastón que el operario ya eligió, no por la plataforma sola.

> **Nota de reconciliación (F4, as-built 2026-08-17) — dos consecuencias que el requisito arrastra y que hubo que cerrar**:
>
> 1. **El registro del bastón recordado pasa a decidir qué transporte se monta, así que la forma de BORRARLO no puede depender del transporte.** El CTA "Olvidar el bastón guardado" (R6.6) vivía **adentro** de la rama `isSpp` de la pantalla de conexión. Con este requisito eso se vuelve una trampa que se cierra sola: un teléfono que alguna vez conectó por BLE monta `ble-gatt` para siempre → `isSpp` es false → el único botón que puede borrar esa preferencia **queda escondido por la preferencia misma**, y el RS420 por SPP se vuelve inalcanzable sin gesto posible. La salida que ofrecía el design §6.2 ("cambiar de bastón = elegirlo en la pantalla, que reescribe la preferencia") **no existe en BLE**: el as-built del adapter escanea y se conecta solo, y RBM9.6 no deja tocar la interfaz del `StickAdapter` para exponer el escaneo. El CTA se movió **afuera de las dos ramas** (visible con cualquier transporte, condicionado solo a que haya algo guardado) y hay un guard que falla si vuelve a quedar gateado por transporte.
> 2. **La preferencia es la primera entrada por la que un valor de STORAGE elige un `AdapterKind`.** Se valida fail-closed en dos ejes: el kind tiene que ser usable en la plataforma (derivado de la MISMA tabla `adapterForTransport`, no de una segunda copia) y no puede estar gateado (`hid-wedge` sigue vetado por R8.7 — sin ese veto explícito, un registro manoseado le saca a Android su `spp-android` y lo deja sin transporte, en silencio). Cualquier preferencia que no se honra cae al piso por plataforma.
> 3. **Consecuencia de producción, dicha en voz alta**: con `ble-gatt` como piso de iOS y como preferencia posible en Android, el `autoConnect` que RBM2.16 le pidió al adapter BLE **se vuelve alcanzable**, así que desde este delta la app puede arrancar **escaneando por BLE sin gesto**. Es lo que R6.4 pide y corre con la misma política de `ConnectTrigger` que el SPP (tope de la cadena sin gesto, permiso CONSULTADO y no pedido, foreground-only), pero es un transporte más haciéndolo.

> **Reconciliación al as-built (F4, fix-loop del review 🟠-2, 2026-08-17) — el propósito de este requisito NO
> se cumplía en Android, y ahora sí: hay un camino de ESCRITURA de la preferencia.**
>
> Lo que el requisito literal pedía se cumplía desde la primera pasada (la preferencia se honra cuando
> existe). Lo que **no** se cumplía era su propósito declarado ("Por qué entra", arriba): el `adapterKind` lo
> escribe **el adapter al conectar**, y en Android el adapter BLE no se monta nunca salvo que la preferencia ya
> diga `ble-gatt`. Huevo y gallina → **el transporte BLE seguía inalcanzable en producción justo en la
> plataforma donde está el productor**, y el banco de RBM6 en Android no tenía con qué arrancar. Es el mismo
> patrón que ya pagamos con **R6.6** (mecanismo completo, cero call sites): un mecanismo sin escritor es una
> promesa, no una función.
>
> **Cómo quedó cableado** (nada de esto persiste al elegir — ver el punto 4):
> 1. `transportChoices` (puro) devuelve los transportes que **esta plataforma puede montar y no son el
>    montado**, cada uno con su lector (el primero del registro que resuelve a ese `AdapterKind`, la MISMA
>    regla con la que el adapter elige el suyo) y con su binding. Un transporte entra **solo si elegirlo haría
>    algo**, y eso se **deriva de `selectTransportAdapter`** (no de una segunda tabla): lo gateado y lo
>    imposible en la plataforma quedan afuera solos.
> 2. La pantalla de conexión las renderiza con las MISMAS vistas puras que el resto de las filas
>    (`deviceRowView` + `transportInstructionsView`), **afuera de las dos ramas** del ternario `isSpp` — misma
>    trampa que el CTA de olvidar: adentro de una rama, la otra plataforma pierde la única forma de elegir.
> 3. Tocar una fila llama `chooseTransport(kind)` en el provider → monta ese adapter **y lo conecta**
>    (`mountActionFor` → `'connect'`, trigger `operator`). Sin ese "y lo conecta", el tap no haría nada
>    visible: `autoConnect` corta en su primer gate ("¿hay bastón recordado?") y en este escenario justamente
>    no hay.
> 4. **La preferencia sigue escribiéndola SOLO el adapter, al conectar** (`writeRememberedDevice(id,
>    {adapterKind})`): se recuerda **lo que funcionó**, no lo que se intentó. Es la lección de MEDIUM-2 y la
>    del `vendorId` guardado como si fuera un id de device. Si la conexión falla, el próximo arranque vuelve al
>    piso por plataforma.
> 5. **Consecuencia nueva que hubo que cerrar**: el registro guarda UN bastón (R6.7) con SU `adapterKind`, y
>    desde que el transporte montado puede no ser el que escribió, un `connect()` sin id leía el id **del
>    otro** transporte (RFCOMM contra un device que solo anuncia GATT, o `connectToDevice()` contra una MAC de
>    Classic). Eso **no falla rápido: se queda esperando**. Ahora cada adapter toma el id recordado solo si el
>    registro es de su transporte (`rememberedDeviceIdFor`); si no, escanea. El formato viejo (sin
>    `adapterKind`) lo acepta **solo el SPP**, que era su único escritor posible (RBM5.7).
>
> **Guard sobre la ausencia** (`wiring.test.ts`): todo `AdapterKind` construido en este build y usable en una
> plataforma tiene que ser **alcanzable** ahí — o es el piso, o (a) la preferencia lo honra, (b) la pantalla lo
> ofrece y (c) alguien escribe esa preferencia. Y su recíproca fail-closed: lo que este build **no** construye
> no puede honrarse como preferencia. Hoy el único par no-piso es `ble-gatt` en Android (el que 🟠-2
> destrabó); **F5 va a sumar `mfi-ios` en iOS y nace en rojo** hasta que tenga las tres cosas.

> **Reconciliación al as-built (F5, 2026-08-17) — el guard de alcanzabilidad NO se aflojó, se le agregó la
> distinción que le faltaba, y por qué eso importa.**
>
> Al escribir `adapter-mfi-ios.ts` el guard se puso en rojo, como estaba previsto. Dos de las tres cosas se
> cablearon sin discusión: la preferencia lo honra (`'mfi-ios'` salió de `NOT_SELECTABLE_AS_PREFERENCE`, que
> era una deuda **con fecha** — y tenía que salir en este diff por RBM4.7: sacarlo el día del dato sería
> escribir código) y el adapter escribe su `adapterKind` al conectar. La tercera —"la pantalla lo ofrece"— **no
> se puede cumplir hoy, y no por falta de cableado**: `transportChoices` recorre el REGISTRO DE LECTORES, y
> **ningún driver declara `mfi` porque RBM4.6 lo prohíbe**. O sea que la fila no existe ni en un iPhone, y eso
> es un DATO faltante que un requisito impone, no un mecanismo faltante.
>
> Las dos salidas fáciles eran malas: aflojar el guard ("si no hay lector, no exijo nada") lo dejaba pasando
> por vacuidad para cualquier transporte futuro, y "cumplirlo" registrando un driver con una cadena inventada
> viola RBM4.6 y convierte una incógnita en un verde falso. As-built:
> - el invariante exime el par **solo si NINGÚN lector del registro resuelve a ese kind**, la lista de pares
>   exentos es **cerrada y nombrada** (`['ios/mfi-ios']`) y el motivo se **verifica** (el registro real no
>   tiene lectores `mfi`), así que un par exento nuevo es una decisión visible en el diff;
> - y hay un **test hermano** que corre el MISMO invariante con un driver MFi sintético + su cadena declarada
>   y exige que el par pase entero (honrado + ofrecido + escrito), con la contraprueba de que sin ese driver
>   sale exento. Sin ese hermano, "no se puede cumplir" sería indistinguible de "no lo cableé" — que es
>   exactamente cómo se afloja un guard sobre la ausencia sin que se note.
>
> Los cuatro mutantes de esta zona **mueren**: volver a meter `'mfi-ios'` en `NOT_SELECTABLE_AS_PREFERENCE`,
> sacarlo de `BUILT_ADAPTERS`, borrarle el `adapterKind` a su `writeRememberedDevice`, y ponerle
> `acceptsLegacy: true` al filtro del bastón recordado.
>
> **Lo que sigue sin resolver, dicho como límite**: en Android el único driver `ble-gatt` del registro es el
> del **emulador del banco** (RBM5.11 no deja inventar el del HR5 v3), así que hoy esa fila dice *"Emulador
> ESP32 (banco de pruebas)"* también en Android — la misma superficie que RBM5.12 ya declara para iOS. El día
> que Gallagher entregue su documentación, la misma fila dice su nombre sin código nuevo.

**RBM5.7** El sistema deberá tratar un valor de bastón recordado en el formato viejo (solo el identificador del dispositivo) como "sin preferencia de transporte", cayendo al piso por plataforma sin romper (compatibilidad hacia atrás).

> **Reconciliación al as-built (F4, fix-loop del review 🟠-2)** — "sin preferencia de transporte" se mantiene
> para la SELECCIÓN (se cae al piso, sin romper), y se le agregó una asimetría en el **uso del id**: el
> registro viejo lo acepta como propio **solo `spp-android`**. Motivo: antes de este delta el único escritor
> posible era el SPP (y en Android, la única plataforma donde corre), así que un registro sin `adapterKind` es
> una MAC de Bluetooth Classic. Dejar que el transporte BLE la use sería dialar el device del otro transporte
> —el bug que el punto 5 de la nota de RBM5.6 cierra— entrando por la puerta de la compatibilidad. La mitad
> que este requisito protege (que un teléfono ya instalado no tenga que re-emparejar en la manga) queda
> intacta y con test propio.

**RBM5.8** El sistema deberá mantener la selección **determinística**: con las mismas entradas (plataforma, transportes del driver, adaptadores construidos, protocolos declarados, preferencia recordada) deberá devolver siempre el mismo binding, sin depender del orden de descubrimiento (RMV2.8).

**RBM5.9** El sistema deberá conservar `selectTransportAdapter` devolviendo **exactamente lo mismo que hoy** para los modos `mock`, `manual` y `demo`, y para `auto` cuando no hay preferencia recordada en Android y en web (regresión de RMV2.7).

**RBM5.10** Mientras ningún transporte sea alcanzable en la plataforma, el sistema deberá dejar la carga manual como piso y **no deberá** bloquear nada (RMV2.5, R7).

**RBM5.11** El sistema **no deberá** registrar un `ReaderDriver` del Gallagher HR5 v3 ni de ningún otro lector con UUIDs, formato de trama o parámetros **inventados**: un fabricante entra al registro cuando entrega su documentación técnica.

> Es la consecuencia directa del contexto §3: *"hoy el adapter BLE tiene exactamente UN consumidor conocido en este mercado: el Gallagher HR5 v3, que no tenemos"*. Un driver con parámetros adivinados convertiría esa incógnita en un verde falso.

**RBM5.12** El sistema deberá registrar un `ReaderDriver` del **emulador ESP32 en `MODO_GATT`** cuyo `displayName` diga explícitamente que es un banco de pruebas, de modo que nunca se presente en la UI como un lector comercial (ADR-010: el ESP32 es test rig, no producto).

> **Nota de reconciliación (F4, as-built 2026-08-17) — la consecuencia visible que este requisito compra**: la pantalla de conexión muestra el driver del **transporte montado** (`transport.driver`), y en iOS el piso es `ble-gatt` (RBM5.6), cuyo único driver en el registro es el del banco. O sea: **en un iPhone la fila de "Dispositivos" dice "Emulador ESP32 (banco de pruebas)" y es accionable** (tocar = escanear buscando `EMU-GATT-STICK`). Eso es exactamente lo que este requisito pidió —que un banco de pruebas no pueda pasar por un lector comercial— y es lo que hace posible el banco de F6 en device; pero es una superficie que un usuario final puede ver, así que queda **fijada por un test** (si algún día se decide esconderla, es un cambio visible y no un drift). La alternativa —mostrar el binding del RS420 mientras el transporte montado es otro— hacía que la pantalla se contradijera sola: la card ofreciendo *"Conectar bastón"* (hay transporte) y la fila diciendo *"no se conecta en este dispositivo"* (el RS420 no habla GATT). El Gate 2.5 la mira en las capturas **de device** (T6.6): en web el binding es `serial` y esta fila no existe.

**RBM5.13** El sistema deberá reconocer al driver del emulador **por su nombre anunciado** y **no deberá** reconocerlo por el UUID del servicio Nordic UART.

> **Por qué importa y no es una preferencia de estilo**: el bridge de la balanza Vesta (ADR-003) anuncia **los mismos UUIDs NUS**. Un `deviceMatch` por UUID de servicio haría que la app reconozca **el bridge de la balanza como un bastón**. Con el match por nombre, el bridge aparece como "no reconocido" y no es accionable (RMV1.7 / RMV3.8), que es la conducta correcta.

> **Reconciliación al as-built (F3)** — la **mitad del transporte** de este requisito ya está construida y
> falsificada, aunque el driver del emulador sea F4: el escaneo del adapter solo acepta devices que el
> `deviceMatch` de su driver reconoce, delegando en `findDriverForDevice`, y le pasa los UUID que el device
> **anunció de verdad** — nunca el `serviceUuid` con el que filtramos, que convertiría cualquier resultado del
> escaneo en un match por UUID y dejaría el chequeo por nombre decorativo. El mutante que hace exactamente eso
> **muere** en `adapter-ble-gatt.test.ts` (y para que muriera hubo que arreglar el test: con un driver que
> matchea solo por nombre, el mutante pasaba en verde). Se prueban además los **dos** nombres que el SO expone
> (`name` del GAP y `localName` del anuncio), porque el emulador se identifica por el del anuncio.

> **Reconciliación (fix-loop del Gate 2, MEDIUM-2, 2026-08-17) — el rastro del "no reconocido" NO lleva el identificador del dispositivo.** El as-built de F3 loguéaba `ble_device_not_recognized: ${device.id}`, y estos dispositivos son de **terceros** por definición (cualquier periférico que anuncie el servicio y no matchee: el bridge de la balanza, un teléfono ajeno, lo que haya en el campo). En Android `device.id` de `react-native-ble-plx` **es la MAC**; el evento viaja a un breadcrumb de Sentry y ahí el scrubber de `redact.ts` es **key-based**, así que un identificador interpolado en el free-text de `message` no lo alcanza ninguna defensa. As-built: el log lleva el **ordinal dentro del escaneo** (`ble_device_not_recognized: #1 del escaneo`), que da el mismo diagnóstico —cuántos aparecieron y cuándo— sin mandar el identificador de nadie a un tercero. El mutante que devuelve el `device.id` al mensaje **muere** en dos tests de `adapter-ble-gatt.test.ts` (uno de ellos exigía justo lo contrario antes de este fix). Defensa en profundidad, aparte: `device_id` entró a `PII_KEYS_RAW` de `redact.ts`, que cubre el `connect_superseded { deviceId }` de los tres adapters (ese sí es un campo con clave, alcanzable por el scrubber).

> **Reconciliación 2 (follow-up del Gate 2, §7.2, 2026-08-17) — de la instancia a la CLASE.** Aquel fix sacó el id de **ese** mensaje; el barrido posterior encontró la misma fuga por otra puerta (el `message` interpolado de los errores de las libs) en los **tres** adapters, uno de ellos desde antes del baseline. La regla general quedó en **RBM9.9**, con su convertidor único y su guard sobre la ausencia — que además vuelve estático el mutante de este requisito: devolver `${device.id}` al mensaje ahora cae también en `log-device-identifier-guard.test.ts`, sin depender de que alguien se acuerde de escribir el test de comportamiento.

**RBM5.14** El sistema deberá presentar en la pantalla de conexión el flujo específico de los transportes nuevos (BLE: escanear → listar → elegir → conectar; MFi: instrucción del Accessory Picker de iOS + el estado "falta el protocolo del fabricante"), derivándolo del `ReaderBinding` como ya hace el resto (RMV3.2).

> **Nota de reconciliación (F4, as-built 2026-08-17) — el flujo de BLE NO tiene el paso "listar → elegir"**: el `StickAdapter` **no expone el escaneo** (`connect(deviceId?)` es toda la superficie) y **RBM9.6 prohíbe cambiar su interfaz** en este delta, así que el as-built es *prender el bastón → tocar conectar → el transporte escanea filtrado por el `serviceUuid` del driver, reconoce por `deviceMatch` y se conecta solo al que reconoce*. El copy dice **eso** y no promete una lista que no existe: prometerla sería la misma afordancia muerta que el bugfix del 2026-07-29 cerró. Lo que sí entró de este requisito: la instrucción propia de `ble-gatt` (con su ícono `bluetooth-searching` y la frase que lo distingue del SPP: *"no hace falta emparejarlo desde los ajustes"*), el **CTA "Buscar de nuevo"** y el label *"Buscando el bastón…"* en lugar de *"Reintentando…"* (en GATT la primera conexión **es** una búsqueda, no un reintento), y las dos ramas de MFi (disponible → Accessory Picker; `available:false` por `build-sin-protocolos`/`protocolo-no-declarado` → el copy honesto que nombra al **fabricante** y ofrece la carga manual, **sin** intentar conectar).
>
> **Reconciliación (F4, fix-loop del review 🟠-2)** — de los cuatro pasos que este requisito nombra, el
> as-built ahora tiene **elegir → conectar** con granularidad de **transporte/lector**, no de resultado de
> escaneo: la sección "Dispositivos" lista, además del transporte montado, **los otros transportes
> alcanzables** en esa plataforma (fila del lector + su instrucción), y tocar uno lo monta y lo conecta. Lo que
> **sigue sin existir es la lista de RESULTADOS DEL ESCANEO**, y el motivo es el de siempre más uno nuevo: el
> `StickAdapter` no expone el escaneo y RBM9.6 prohíbe tocar su interfaz, y escanear por afuera del adapter
> sería una **segunda implementación de la misma operación de radio** (sus permisos, su presupuesto, su
> `stopDeviceScan`) — dos implementaciones de la misma verdad divergen, que es el bug de clase de este camino.
> El copy sigue diciendo lo que el adapter hace (busca y se conecta al que reconoce) y no promete una lista.
>
> Dos límites declarados del as-built, para que no se lean como olvido:
> - **La fila corta del tab "Más"** (`connectionRowStatus`) **no conoce el transporte**: su call site no calcula binding. O sea que con GATT la card dice *"Buscando el bastón…"* y la fila sigue diciendo *"Reintentando…"*. Lo que el proyecto exige que no se contradiga —el **tono**— se sigue verificando, ahora también con el `transportKind` nuevo en la matriz. Unificar el texto exigiría que "Más" calcule el binding (scope nuevo).
> - **La lista de protocolos de `mfi-ios` no entra en `BUILT_ADAPTERS`** hasta F5 (ver la nota de T4.8), así que hoy el binding de MFi en producción diría `adapter-no-construido` — pero es inalcanzable de todos modos, porque ningún driver declara `mfi` (RBM4.6). Las dos ramas de copy se ejercitan con bindings sintéticos.

> **Reconciliación al as-built (F5, 2026-08-17) — dos cambios en QUÉ se ofrece, y un límite que se mantiene.**
>
> 1. **El párrafo de arriba queda viejo en su primera mitad**: `'mfi-ios'` YA entra en `BUILT_ADAPTERS` (nota
>    de RBM4.5), así que el binding de un lector MFi ya no diría `adapter-no-construido` sino
>    `build-sin-protocolos` — el motivo honesto, que es el que la rama de copy de MFi necesita para decir
>    *"falta la autorización del fabricante"* en vez de *"todavía no lo soportamos"*. La segunda mitad sigue
>    en pie: es **inalcanzable de todos modos** porque ningún driver declara `mfi` (RBM4.6).
> 2. **La FILA del lector MFi ahora SÍ se ofrecería**, y eso invirtió un test de F4. Antes `'mfi-ios'` estaba
>    vetado como preferencia, así que `transportChoices` lo dejaba afuera "porque montarlo no haría nada"; con
>    el adapter construido, un lector MFi produce su fila **con `binding.available:false` y su motivo**, y con
>    `installable:false` (el probe incluye el gate de datos) → la fila se **dice y no es accionable**, que es
>    exactamente lo que este requisito pide y el mismo criterio que ya usa `installable:false` para el BLE en
>    un APK sin el módulo nativo. Esconderla sería el bug simétrico: el operario con un Tru-Test "i" no
>    tendría ninguna explicación de por qué su bastón no aparece.
> 3. **Lo que sigue sin poder vetarse visualmente**: nada de esto se ve hoy en ninguna plataforma (no hay
>    lector `mfi`), así que el Gate 2.5 de F5 es el ORÁCULO DE NO-REGRESIÓN de `/baston` (una sola fila, cero
>    rastro del copy de MFi, y la pantalla entera con una preferencia `mfi-ios` sembrada en storage — el
>    escenario nuevo que F5 habilita). El veto visual de las dos ramas de copy sigue siendo de device y queda
>    en T6.6/RBM9.7, y hasta entonces está cubierto por `connection-view.test.ts` con bindings sintéticos.

## RBM6. Banco del emulador ESP32 en `MODO_GATT` (T5)

> **No es un extra: es parte de la unidad** (contexto §3). El emulador en `MODO_GATT` notifica la trama **partida en trozos de 20 bytes**, que es exactamente lo que hay que reensamblar — y es donde el SPP se rompió.

**RBM6.1** El sistema **no deberá** considerar verificado el transporte BLE hasta correr el banco del emulador en `MODO_GATT` contra un dispositivo real y documentar el resultado.

**RBM6.2** El sistema deberá ejercitar en el banco, como mínimo: stream de lecturas distintas, dedup del mismo EID dentro y fuera de la ventana, ráfaga, 20 animales sin perder ninguno, las 10 tramas malformadas, trama partida, dos tramas pegadas, corte del link con reconexión, radio abajo, flap con backoff creciente, mudez, y corte con la app en background.

**RBM6.3** El sistema deberá dar el **mismo resultado** con la trama troceada por defecto (`chunk 20`) y con la trama entera (`chunk 0`), de modo que el reensamblado no dependa del troceo.

**RBM6.4** El sistema deberá correr el banco en **Android** y en **iOS**, porque el transporte se declara cross-platform (RBM2.1) y una sola plataforma no lo demuestra.

**RBM6.5** Si un escenario del banco da distinto de lo esperado, entonces el sistema deberá registrarlo como **hallazgo** y **no deberá** anotarlo como verde.

**RBM6.6** El sistema deberá documentar el resultado del banco en `progress/`, incluyendo qué escenarios el emulador **no** puede validar (las mañas de un lector comercial), sin dejar que el verde del emulador se lea como validación contra hardware real.

## RBM7. Reconciliación de la documentación (T6)

> Regla dura de `docs/specs.md` §"Reconciliación de specs al as-built". Estas afirmaciones quedan **falsas** cuando este delta cierre, y una spec que miente por omisión es peor que una que falta.

**RBM7.1** El sistema deberá reconciliar `requirements-multivendor.md`: la deuda declarada bajo **RMV5.2** (*"el `frameParser` no se usa en producción"*) queda **cerrada** por RBM1; **RMV1.6** pasa a ser cierto; **RMV2.1/RMV2.2** cambian con la prioridad de iOS y los mapeos nuevos; **RMV6.2/RMV6.3** dejan de ser "fuera de este delta".

**RBM7.2** El sistema deberá reconciliar el core `requirements.md` de spec 04: **R11.2** ("los 5 adaptadores del MVP") pasa a enumerar los nuevos; **R12** gana el modelo de permisos del transporte BLE; **R8** queda ligado al desenlace del gate de RBM8.

**RBM7.3** El sistema deberá dejar **recomendada al leader** una enmienda a **ADR-024** que registre: (a) que el camino iOS-abierto real del mercado es **BLE-GATT** (HR5 v3) y no solo HID; (b) la prioridad de transporte de iOS nueva; (c) que a Gallagher se le pide **documentación técnica** y no una licencia, y que **Datamars** es un tercer interlocutor.

> La redacción del ADR es del **leader**, no del `spec_author` (misma regla que la Pregunta abierta 1 del delta multivendor: política tentativo-vs-firme). El delta deja la recomendación, no el ADR.

**RBM7.4** El sistema deberá reconciliar `docs/bastones-mercado-argentino.md` §"Qué falta" con el pedido correcto por fabricante (documentación técnica a Gallagher; cadena iAP + licencia MFi a Allflex y Datamars).

**RBM7.5** El sistema deberá reconciliar `firmware/baston-emulator/README.md`: la fila de `MODO_GATT` dice *"sin implementar"* y la de `MODO_HID` dice *"con este modo el gate se puede correr"* — las dos cambian con este delta.

**RBM7.6** El sistema deberá reconciliar el comentario de `app/plugins/with-bluetooth-classic.js` que afirma que `BLUETOOTH_SCAN` está *"declarado para un descubrimiento futuro… no se usa hoy"*, porque el escaneo BLE lo usa.

## RBM8. Camino HID: primero el GATE, después (y solo si pasa) el adapter (T7)

> **El orden es el requisito.** `adapter-hid-wedge.ts` son 22 líneas de placeholder gateado a propósito, y su cabecera dice por qué: *"el Council fue enfático: no fijar arquitectura sobre un mecanismo no ejecutado en hardware real"*. Lo nuevo es que el gate **ya se puede correr**: el ESP32 en `MODO_HID` es un teclado BLE HID construido para esto.

**RBM8.0** El sistema deberá correr el gate físico **antes** de escribir una sola línea del adaptador HID, y el adaptador **no deberá** escribirse hasta que el resultado del gate esté documentado.

**RBM8.1** Cuando se corre el gate, el sistema deberá medir y registrar con evidencia los cuatro puntos de R8.7 / ADR-024 §4: **(a)** que se tipeen los **15 dígitos completos**, **(b)** que se emita el **terminador Enter**, **(c)** que la **supresión del teclado en pantalla** de iOS no rompa la UX de manga, y **(d)** que un `TextInput` de RN con foco programático capture de forma confiable.

**RBM8.2** El sistema deberá correr el gate contra la build **ya instalada** en el iPhone (TestFlight del 2026-08-11, perfil `testflight-dev`, commit `0273c43`), usando el campo de carga manual de `/maniobra/identificar` (`testID="manual-entry-input"`), y por lo tanto el gate **no deberá** consumir ningún build de EAS ni quedar gateado por el OK de build de Raf.

> Es lo **primero ejecutable de toda la unidad**: va antes incluso de instalar `react-native-ble-plx`. El OK de build de iOS sigue haciendo falta después, para RBM2/RBM4/RBM5 (la dep nueva cambia el fingerprint) — pero no para esto.

**RBM8.3** El sistema deberá correr el gate variando los knobs del emulador (`hidterm enter|tab|none`, `hiddelay <ms>`, `hidraw on|off`) y deberá registrar el resultado por knob.

**RBM8.4** Cuando el gate pase en (a), (b), (c) y (d), el sistema deberá implementar el adaptador detrás de la MISMA interfaz `StickAdapter`, sin tocar el contrato de ingesta (R10.3 / R11.3), con la captura de keystrokes y el terminador **que el gate validó**.

**RBM8.5** Si el gate falla en (c) o en (d), entonces el sistema **no deberá** escribir el adaptador y deberá cerrar el camino HID con la **evidencia** de la medición, dejando `adapter-hid-wedge.ts` como placeholder gateado y su binding en `available:false`.

**RBM8.6** Si el gate falla por una **prop del `TextInput` de producción** y no por el comportamiento de iOS, entonces el sistema deberá registrarlo como un desenlace **distinto** y **no deberá** concluir que el camino HID no sirve.

> El campo que se va a usar es el de producción, con sus props actuales (`maxLength`, `autoCapitalize="characters"`, `autoCorrect={false}`, `returnKeyType="search"`, `onSubmitEditing` → búsqueda, sin `keyboardType` explícito). Un fallo atribuible a una de esas props tiene otra consecuencia: **ajustar el campo de scan (o darle un campo de scan dedicado al wedge) y re-correr el gate**, no cerrar el camino. Mezclar los dos desenlaces es cómo se cierra por error una puerta que estaba abierta.

**RBM8.7** El sistema deberá declarar explícitamente, junto al resultado del gate, que el gate valida **el lado del teléfono** y **no deberá** presentarlo como confirmación de que exista un bastón comercial con modo HID.

> El **Gallagher HR0** sigue **sin confirmar del fabricante** (relevamiento §"Qué falta", ítem 1). Son dos incógnitas distintas y el verde de una no puede tapar a la otra.

**RBM8.8** El sistema deberá mantener `ADAPTER_INGEST_MODE['hid-wedge'] = 'eid'`: si el gate mostrara que algún wedge tipea la trama completa, ese lector deberá resolverse con su propio driver y no cambiando esa fila.

## RBM9. Invariantes heredados, frontera de datos y Gate 1

**RBM9.1** El sistema **no deberá** tocar la base de datos en este delta: cero migraciones, cero funciones/RPC, cero Edge Functions, cero policies RLS, cero cambios en `sync-streams/`.

**RBM9.2** El sistema deberá tratar **Gate 1 (security_analyzer modo `spec`) como N/A** por RBM9.1, y deberá verificarlo al cierre de forma ATRIBUIBLE: el conjunto de archivos que ESTE delta tocó no deberá contener ninguno bajo `supabase/` ni `sync-streams/`. **El oráculo NO es `git diff supabase/`**: ese comando mide el ÁRBOL, no el cambio, y con dos terminales en paralelo muestra el trabajo ajeno; además es CIEGO a los archivos **untracked** (una migración nueva no aparece en un `git diff`). Se verifica con `git status --porcelain supabase/ sync-streams/` **cruzado contra la lista de archivos del implementer**: lo que aparezca ahí y no esté en esa lista es de otra terminal y no cuenta; **Gate 2 (modo `code`) sigue siendo obligatorio**.

> **La única superficie de este delta que roza "datos regulados" está nombrada, no barrida**: un EID mal parseado se declara mal ante SENASA (ADR-024 §Contexto). Este delta **no toca** la validación (`isValidTag`), la dedup ni la confirmación pre-commit — solo cambia **de dónde sale el parser** (RBM1.8), y el único modo de falla nuevo es "parser no resuelto", que es **fail-closed con log** (RBM1.4). Si el leader quiere correr Gate 1 igual, esa es la única pregunta que vale la pena hacerle.

**RBM9.3** El sistema **no deberá** tocar tablas con `establishment_id` ni ningún camino multi-tenant: el EID que este delta ingiere entra al motor find-or-create de spec 09, que ya corre bajo RLS y PowerSync, y ese camino **no cambia**.

**RBM9.4** El sistema **no deberá** requerir internet para conectar, reconectar, escanear, leer, parsear ni deduplicar por ninguno de los transportes nuevos (R14, offline-first).

**RBM9.5** El sistema deberá mantener la carga manual disponible y no bloqueante en todos los estados de los transportes nuevos, del gate MFi y del gate HID (R7.2, R7.4, R9.6).

**RBM9.6** El sistema **no deberá** modificar ningún método de la interfaz `StickAdapter` ni ningún archivo de spec 09 (`app/src/features/animals/*`, screens de find-or-create); si algo lo exigiera, deberá **parar y reportar al leader**.

**RBM9.7** El sistema deberá cubrir con capturas del Gate 2.5 las superficies de UI nuevas (instrucciones por transporte y filas de dispositivo BLE/MFi); donde una superficie solo exista en device, la evidencia visual deberá ser la del banco (RBM6) y deberá quedar dicho que la E2E web no la cubre.

**RBM9.8** El sistema deberá tratar el build de **iOS** como gateado por el **OK explícito de Raf, por plataforma y por build** (la dep nueva cambia el fingerprint), y el de **Android** como local con Gradle sin consumir EAS.

**RBM9.9** El sistema **no deberá** emitir el identificador de un dispositivo (la MAC en Android, el UUID por-app de iOS, el serial del accesorio en MFi) dentro del **texto libre** de un evento de log del transporte; cuando el dato haga falta, deberá ir como **campo con clave** del evento. Y cuando un error del puente traiga un mensaje que interpola ese identificador, el sistema deberá emitir en su lugar el **código** del error si lo tiene, o el mensaje con el identificador **blanqueado** — nunca el mensaje crudo.

> **De dónde sale**: es el **§7.2 del fix-loop del Gate 2** (`progress/impl_ios-ble-mfi-gate2-fix.md`), medido sobre el fuente instalado de las libs, no supuesto. `react-native-ble-plx` arma sus mensajes interpolando el id (`BleError.js`: `'Device {deviceID} was disconnected'`, `'… connection failed'`, `'… not found'`, `'Services discovery failed for device {deviceID}'` — **20 plantillas**), y `react-native-bluetooth-classic` hace lo mismo con `device.getAddress()` (`Exceptions.java`: `'Connection to %s failed.'`, `'Connection to %s was lost'`, `'Not connected to %s'`). Los tres adapters tenían **su propia copia** de un `errorMessage(e)` que devolvía `e.message` crudo, y ese string se interpolaba en `ble_disconnected`, `ble_monitor_lost`, `ble_scan_error`, `liveness_lost` y `logBridgeFailure` → el identificador terminaba en un breadcrumb de Sentry, en **free-text**, que es donde el scrubber key-based de `redact.ts` **no puede llegar** (por eso RBM5.13 ya había sacado el id de *otro* mensaje: esto es la misma clase, barrida entera).
>
> **Es una CLASE, no tres instancias**: el SPP tenía la fuga desde **antes del baseline** y el MFi la va a tener el día que exista su módulo nativo. Por eso el as-built no arregla tres call sites: unifica el convertidor y deja un **guard sobre la ausencia**.
>
> **As-built** (`services/ble/error-text.ts` + los tres adapters + `log-device-identifier-guard.test.ts`): un único `safeErrorText(e, deviceId?)`. (a) Si el error trae un `errorCode` de la tabla de códigos que interpolan `{deviceID}` → sale `errorCode:<n>` y **nunca** el mensaje. Los códigos mapean **1:1** con las plantillas, así que no se pierde diagnóstico: **se pierde legibilidad, y ese es el precio aceptado**. Es la única vía que cubre el id de iOS, que es un UUID y por forma es **indistinguible** de un UUID de servicio (que sí queremos ver). (b) Si no → el mensaje, con el id **exacto** que el call site conocía y con cualquier MAC blanqueados a `<device>`, y acotado a 240 caracteres. Lo que **no** se blanquea, a propósito: los UUID de servicio/característica y los mensajes sin id (`'BluetoothLE is powered off'` sigue entero — degradarlo a un número sería pagar el arreglo con la parte útil del log).
>
> **La tabla de códigos no está escrita a ojo**: `error-text.test.ts` la **deriva** de `node_modules/react-native-ble-plx` y exige que la declarada la contenga, así que un upgrade de la lib que agregue una plantilla con el id se pone rojo **antes** de que el id empiece a viajar. Un código extra (`InvalidIdentifiers`, cuyo `{internalMessage}` **son** los identificadores) va con su motivo escrito y el test exige que la diferencia sea exactamente esa.
>
> **El guard es sobre la ausencia**: enumera las superficies que llaman a `logTransportEvent` y exige que **ninguna** lea el texto de un error por su cuenta (`.message`, `String(e)`, `${e}`) ni **nombre** un identificador en la expresión de un `message` —interpolado o concatenado—, y que `error-text.ts` sea el único convertidor de `services/ble/`. Lo que declara NO cubrir: un texto armado lejos del call site y logueado por una variable (eso es data flow); esa mitad la cubre el barrido de **comportamiento** de las tres suites de adapter, que mira los eventos EMITIDOS.

**RBM9.10** El sistema deberá permitir que el catálogo de eventos de diagnóstico del transporte (`TransportLogEvent`) **crezca** sin poner en rojo a guards estáticos de otras unidades, y **no deberá** resolver esa tensión borrando la prosa que hace distinguible cada evento.

> **De dónde sale**: el **§7.1 del mismo fix-loop**, medido. El meta-guard compartido `assertScanCoverage` exige que un archivo de ≥ 150 líneas no vacías conserve ≥ 25% después de blanquear comentarios. `services/ble/logging.ts` estaba en **148 líneas → 34 de código (retención 0.230)**: ya por debajo del piso, y lo único que lo salvaba era estar **dos líneas** abajo del umbral de tamaño. Medido en las dos direcciones: agregar dos miembros de una línea al union pone en rojo a **10 de los 11** guards que corren esa auto-verificación (se salva `phone-field`, cuya raíz de escaneo no llega al archivo), todos con un mensaje sobre el blanqueo y **a diez guards de distancia del síntoma**.
>
> **Por qué NO se purgó la prosa**: ese archivo es un **catálogo donde la prosa ES el artefacto** — cada miembro del union existe para que un síntoma en logcat se distinga de otro, y el comentario de cada uno es lo que dice cuál es cuál. Borrarlos para satisfacer una heurística de cobertura es optimizar la métrica **contra su propósito**.
>
> **As-built**: se estrenó la `allow` del meta-guard (que estaba declarada y vacía) con **una** entrada, para ese archivo, con el motivo escrito **en el lugar** y **angosta**: exime del piso de retención y **no** del escaneo — el balance de llaves le sigue corriendo (antes la exención era un `continue` que sacaba el archivo entero). Y como una allowlist estrenada es un precedente, entró con su **freno** (`utils/scan-coverage.test.ts`): motivo sustantivo y no un puntero, tope de entradas, el archivo tiene que existir, la exención tiene que estar **GANADA** contra el árbol real (si el archivo dejó de violar el chequeo, la entrada sobra y se pone roja), la puerta es **una** (ningún guard pasa su propia `allow` inline) y los guards tienen que calcular el **mismo label**, que es lo que hace que una entrada alcance para todos.

---

## Trazabilidad `context-ios-ble-mfi.md` → requirements

| Punto del contexto | Requirement(s) |
|---|---|
| §1.1 🔴 el registro de drivers no soporta un segundo driver (prerrequisito) | RBM1.1–RBM1.8 |
| §1.2 ✅ `UISupportedExternalAccessoryProtocols: []` es un guard anti-crash que no hay que romper | RBM4.3 |
| §1.3 ✅ el MFi no necesita dependencia nueva (rama iOS de la lib instalada) | RBM4.1, RBM4.8 |
| §1.4 ✅ se puede probar BLE end-to-end sin bastón comercial (emulador `MODO_GATT`) | RBM6.1–RBM6.6, RBM5.12, RBM5.13 |
| §1.5 ⚠️ `react-native-ble-plx` no está instalado → dep nueva, fingerprint, builds | RBM2.1, RBM2.17, RBM2.18, RBM9.8 |
| §2 qué pedirle a cada fabricante (Gallagher = doc; Allflex/Datamars = iAP + MFi) | RBM7.4, RBM7.3, RBM4.6 |
| §3 riesgo declarado: un solo consumidor conocido, sale sin hardware real | RBM5.11, RBM6.1, RBM6.5, RBM6.6 |
| §4 T1 — pagar la deuda del driver, con guard sobre el parser hardcodeado | RBM1.2, RBM1.7 |
| §4 T2 — `adapter-ble-gatt` cross-platform (scan filtrado → connect → notify → reensamblado) | RBM2.1–RBM2.16, RBM6.4 |
| §4 T2 — con las lecciones del SPP ya escritas (techo, latch, desconexión de fuente propia) | RBM3.1–RBM3.11 |
| §4 T3 — `adapter-mfi-ios` gateado por la lista de protocolos, vivo el día que llegue la cadena | RBM4.1, RBM4.2, RBM4.4, RBM4.5, RBM4.7 |
| §4 T4 — selección y prioridad por plataforma; `spp-android` no se ofrece en iOS | RBM5.1–RBM5.10, RBM5.14 |
| §4 T5 — banco del ESP32 en `MODO_GATT` con los escenarios del `MODO_SPP` | RBM6.2, RBM6.3 |
| §4 T6 — reconciliación de ADR-024, multivendor y relevamiento | RBM7.1–RBM7.6 |
| §4 "no entra": la cadena de protocolo real de cualquier fabricante | RBM4.6 |
| §5 lo que hace falta para verificar y de quién depende | RBM9.8, RBM6.4 |
| §6.2 ¿el HR0 tiene modo HID? (sin confirmar del fabricante) | RBM8.7 |
| §7.1 el camino HID ENTRA como T7 | RBM8.0–RBM8.8 |
| §7 T7 secuencia obligatoria: gate → (si pasa) adapter; si falla en (c)/(d), se cierra con evidencia | RBM8.0, RBM8.4, RBM8.5 |
| §7 💡 atajo: correr el gate contra la build ya instalada, sin gastar un build | RBM8.2 |
| §7 ⚠️ lo que el gate NO prueba | RBM8.7 |
| Restricción del leader: Gate 1 N/A, declarado y verificable al cierre | RBM9.1, RBM9.2 |

## Clasificación de madurez (regla de despacho para el leader)

| Bloque | Buildable-hoy sin hardware | Gated por hardware / device | Gated por negocio o por terceros |
|---|---|---|---|
| RBM1 — parser por driver | ✅ (puro + guard) | — | — |
| RBM2 — `adapter-ble-gatt` | ✅ código + tests puros (env inyectado) | stream real (RBM6) | — |
| RBM3 — lecciones del SPP | ✅ (dobles, relojes, promesas que no resuelven) | los 🔴 en device los cierra RBM6 | — |
| RBM4 — `adapter-mfi-ios` | ✅ el gate por lista de protocolos + el diff sintético | — | ✅ la cadena iAP real (Facundo) |
| RBM5 — selección/prioridad | ✅ (puro) | el montaje real por bastón recordado | `available` real de MFi |
| RBM6 — banco `MODO_GATT` | — | ✅ Android local; **iOS requiere OK de build de Raf** | — |
| RBM7 — reconciliación | ✅ | — | ADR: lo redacta el leader |
| RBM8 — gate HID → adapter | **RBM8.2: corre YA, sin build** | ✅ el gate es device (iPhone + ESP32) | que exista un bastón comercial HID |
| RBM9 — invariantes / Gate 1 | ✅ | — | — |

## Criterios de aceptación del delta

Este delta se considera implementado cuando:

- El gate HID (RBM8.1) está **corrido y documentado** con sus cuatro mediciones, y el camino quedó **abierto con adapter** o **cerrado con evidencia** — pero nunca "pendiente".
- `contract.ts` no menciona ningún parser de fabricante, un driver con otro `frameParser` se ingiere de punta a punta sin tocar el contrato, y el guard que lo vigila fue falsificado con un mutante (RBM1).
- `adapter-ble-gatt.ts` está escrito detrás de la misma `StickAdapter`, con import perezoso, scan filtrado y acotado, reensamblado por `LineFramer` sobre el delimitador del driver, y las diez lecciones del SPP implementadas y testeadas con entorno inyectado (RBM2, RBM3).
- `adapter-mfi-ios.ts` existe, reporta "no disponible" con la lista de protocolos vacía sin tocar el framework, y un test con una cadena sintética demuestra que el día que llegue el dato se destraba **sin escribir código** (RBM4).
- La selección iOS es `mfi → ble-gatt → ble-hid`, `spp-android` no se ofrece en iOS, el transporte montado sigue al bastón recordado, y `selectTransportAdapter` no cambió su resultado para `mock`/`manual`/`demo` (RBM5).
- El banco del emulador en `MODO_GATT` se corrió **en device, en las dos plataformas**, y su resultado está documentado con los hallazgos como hallazgos (RBM6).
- Las cuatro fuentes que quedaban mintiendo están reconciliadas y la enmienda a ADR-024 quedó **recomendada** al leader (RBM7).
- Ningún archivo del changeset del delta cae bajo `supabase/` ni `sync-streams/`, verificado con `git status --porcelain` (que SÍ ve untracked) cruzado contra la lista de archivos tocados — no con `git diff`, que mide el árbol y no el cambio (RBM9.2). La carga manual nunca se bloquea (RBM9.5) y ningún archivo de spec 09 se tocó (RBM9.6).

## Historial de refinamiento

- **2026-08-17 — Redacción inicial del delta (v1).** Traducción del `context-ios-ble-mfi.md` (Gate 0 aprobado el 2026-08-15, con las decisiones de la Puerta 1 de su §7) a EARS sobre el as-built de spec 04 + delta multivendor. No se re-decidió contexto ni transporte. Tres cosas que el contexto **no fijaba** y que se resolvieron acá como diseño (no como decisión de producto), cada una con su justificación escrita en el requisito: **(1)** el fail-closed del parser no resuelto (RBM1.4) en vez de un fallback a RS420; **(2)** que el transporte montado siga al bastón recordado (RBM5.6), sin lo cual el BLE quedaría inalcanzable en Android en producción; **(3)** el driver del emulador matcheado por nombre y **no** por el UUID NUS (RBM5.13), porque el bridge de la balanza (ADR-003) anuncia los mismos UUIDs y sería reconocido como bastón.
- **2026-08-17 — Dato del leader incorporado antes de cerrar.** El gate HID se corre contra la build de TestFlight ya instalada (2026-08-11, `testflight-dev`, `0273c43`) usando `manual-entry-input` de `/maniobra/identificar` → **RBM8.2**: no consume build de EAS y no está gateado por el OK de Raf. Con eso, RBM8 pasa a ser lo **primero ejecutable** de la unidad. Se agregaron además RBM8.6 (un fallo por una prop del `TextInput` es un desenlace distinto de "el camino HID no sirve") y RBM8.7 (el gate mide el lado del teléfono, no la existencia de un bastón comercial HID).

## Preguntas abiertas / a confirmar (Puerta 1)

Huecos entre el contexto, el as-built y los terceros. **No se improvisaron resoluciones.**

1. ~~**¿La rama iOS de `react-native-bluetooth-classic` expone en JS lo que el adapter MFi necesita?**~~ **RESUELTA (F5, 2026-08-17): ALCANZA — no se para.** Las tres capacidades existen (`getBondedDevices` para listar con `protocolStrings`, `connectToDevice` para abrir la `EASession`, el evento `DEVICE_READ@<serial>` para el stream). Pero la respuesta trajo **siete hallazgos** que cambiaron la forma del adapter, y el séptimo era un modo de falla mudo: **el wrapper JS de la lib no copia `protocolStrings`** (lo deja en su privado `_nativeDevice`), así que leer solo la forma cruda dejaba el filtro por protocolo muerto y RBM4.7 falso el día que llegue la cadena. Detalle completo en la nota de reconciliación de **RBM4.8**. La lección de método: *"moldear sobre el código instalado"* incluye **la capa JS que envuelve al nativo**, no solo el Swift — la primera pasada de esta fase citó el Swift correcto y no miró la capa de arriba.
2. ~~**¿`react-native-ble-plx` es compatible con RN 0.85.3 bridgeless?**~~ **RESUELTA (F2, 2026-08-17): COMPATIBLE, FIRME.** La premisa de esta pregunta era falsa (la lib **no** trae C++/JSI: cero fuentes C++). Veto en dos mitades —inspección de fuente + `:app:assembleDebug` verde en 3m 23s, 0 builds de EAS— en `progress/veto_ble-plx.md`. Queda **declarado** lo que el build no prueba (la reachability del puente en runtime: es un módulo de puente legacy bajo la capa de interop, y lo mide el banco de RBM6.1). El delta **no** se replantea; F3 está desbloqueada. Ver la nota de reconciliación bajo RBM2.18.
3. **Prioridad de iOS con HID último.** El contexto §4 fija `mfi → ble-gatt → manual`; RMV2.1 tenía `['ble-hid','ble-gatt','mfi']`. La traducción (RBM5.1) invierte HID y MFi respecto del delta anterior. Está justificada en el requisito, pero es un cambio de una tabla ya aprobada: **confirmar en Puerta 1**.
4. **Uniones nuevas `'ble-gatt'` y `'mfi-ios'`** extienden `StickAdapter['kind']`, `AdapterKind`, `ADAPTER_KINDS`, `ADAPTER_INGEST_MODE` y los switches exhaustivos de `permissions.ts` e `instantiateTransport`. Es aditivo y 04-owned (mismo precedente que `'simulator'`), pero toca archivos del core as-built — confirmar que se acepta.
5. **El driver del emulador vive en el `DRIVER_REGISTRY` de producción** (RBM5.12), no detrás de un gate de build. La alternativa (registro condicional) está descartada en el design con su motivo (rompe el determinismo que RMV2.8 compró). Confirmar que se acepta que un build de producción incluya una fila de datos de un test rig, con su `displayName` diciéndolo.
6. **Un bastón por dispositivo (R6.7) sigue vigente**: RBM5.6 elige **cuál** transporte se monta, no monta dos a la vez. Si en el campo apareciera un caso de dos bastones de transportes distintos en el mismo teléfono, es scope nuevo.
