# Spec 04 — DELTA «multivendor + selección + demo» — Requirements (EARS)

**Status**: `spec_ready` (delta-spec, estilo ADR-028 Nivel B — corre su propio mini-ciclo; **NO reabre el core aprobado de spec 04 / Puerta 1 2026-06-03**).
**Fecha**: 2026-07-20 (sesión bastón).
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/04-bluetooth-baston/context-multivendor.md` (Gate 0 aprobado por Raf) + **ADR-024** (contrato de ingesta transport-agnóstico + adaptadores — FUENTE DE VERDAD del transporte, **no se re-decide**) + el **core as-built** de spec 04 (`app/src/services/ble/*`, capa buildable-hoy done + gateada 2026-06-06). Cada punto del `context-multivendor.md` queda cubierto por ≥1 `RMV<n>` (ver mapa de cobertura al final). No se re-decidió contexto ni transporte: se tradujeron a EARS sobre el as-built.
**Related**: core spec 04 (`requirements.md` R1–R15 — este delta los **extiende sin contradecir**), ADR-024, spec 09 (interfaz `BleStickEvent`/`useBleStickListener`/`BleStickListenerProvider`/`useBleConnectionStatus`/`useBusyMode` que 04 **implementa** y el delta **reusa sin redefinir**), ADR-018 (pantalla de conexión en "Más"; listener global = no es tab), `field-findings.md`, `android-spp-impl-plan.md`, `web-serial-dev-harness-plan.md`.

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". IDs estables, no reordenar tras aprobar. Cada `RMV<n>` verificable por ≥1 test.

> **Qué agrega este delta sobre el core (R1–R15).** El core dejó firme el **contrato de ingesta** (R1–R3), el **feedback** (R4), la **interfaz `StickAdapter`** (R11), el **provider/hooks** de spec 09 (R10) y los adaptadores `manual`/`web-serial`/`mock` (R5/R7/R10). Lo nuevo es (a) un **registro de drivers por fabricante** detrás del contrato (hoy el único "driver" implícito es el RS420 dentro de `parser-rs420.ts`), (b) un **motor de selección por capacidad** que elige adaptador+driver por plataforma/transporte/dispositivo (hoy `selectTransportAdapter` elige solo por plataforma/modo), (c) una **pantalla de conexión/selección presentable** (R9 del core, hasta hoy tentativa/diferida) + indicador global, (d) un **camino de demo por simulador** que lee tags "en vivo" sin bastón, y (e) el **`adapter-spp-android` escrito** (código completo, hoy placeholder; device-test gated). El delta **reusa** el contrato de ingesta y los tipos de spec 09; **no** los redefine.

> **Madurez por capa (buildable-hoy vs. gated).** Marcada explícitamente en cada bloque:
> - **Buildable-hoy sin hardware** (unit puro / mock / simulador): `RMV1` (registro), `RMV2` (selección), `RMV3` (pantalla + indicador, contra mock/web-serial/simulador), `RMV4` (simulador, dev/demo-gated), **el código + los tests puros** de `RMV5` (`adapter-spp-android` escrito).
> - **Gated por hardware**: la validación de conexión real de cualquier transporte (`RMV5` SPP real, `RMV3` conexión real SPP/HID, `RMV2` matching device→driver por canal real), el `hid-wedge` (ya GATED en el core R8.7), el config plugin + dev build Android (`RMV5.8`).
> - **Gated por negocio (MFi)**: el adaptador External Accessory / MFi de iOS (`RMV6`). Arquitectura preparada (`transportKind:'mfi'` + `protocolString` declarable), sin implementar el adapter.

> **Manual-first sigue siendo ley** (core R7, R9.6): ningún estado de la selección, la conexión, el driver desconocido ni el simulador deberá **nunca** bloquear la app ni la carga manual. El delta hereda ese piso.

---

## RMV1. Registro de drivers por fabricante (`ReaderDriver` / `ReaderProfile`)

> **Buildable-hoy, puro.** Un driver = la config de un fabricante detrás del contrato de ingesta (ADR-024 §1, context-multivendor §1). "Conseguir las claves de cada empresa → cada una es un driver." El RS420 pasa a ser **el primer driver**, reusando `parser-rs420.ts` tal cual.

**RMV1.1** El sistema deberá definir un tipo `ReaderDriver` (alias `ReaderProfile`) con, como mínimo, los campos `vendorId`, `displayName`, `transports`, `frameParser`, `deviceMatch` y `streaming`.

**RMV1.2** El sistema deberá modelar cada transporte soportado por un driver como una `TransportCapability` discriminada por `kind` ∈ {`spp`, `serial`, `ble-hid`, `ble-gatt`, `mfi`}, cada una con sus `connectionParams` propios: `spp` → `{ sppUuid, pin }`; `serial` → `{ baud }`; `ble-gatt` → `{ serviceUuid, notifyCharUuid }`; `ble-hid` → sin parámetros de conexión (teclado del SO); `mfi` → `{ protocolString }`.

**RMV1.3** El sistema deberá registrar el Allflex RS420 como el primer `ReaderDriver`, declarando sus transportes `spp` (UUID `SPP_UUID`, PIN `1234`) y `serial` (baud `DEFAULT_BAUD`), y usando `parseRs420Line` de `app/src/services/ble/parser-rs420.ts` como su `frameParser`, sin reimplementar el parseo.

**RMV1.4** El sistema deberá exponer un registro de drivers (`DRIVER_REGISTRY`) consultable y una función de lookup por `vendorId`.

**RMV1.5** Cuando se descubre un dispositivo, el sistema deberá resolver su `ReaderDriver` cruzando el `deviceMatch` del driver (patrón de nombre y/o UUIDs de servicio anunciados) con los datos del dispositivo descubierto.

**RMV1.6** El sistema deberá permitir agregar el soporte de un fabricante nuevo añadiendo una entrada de `ReaderDriver` al registro, **sin modificar** el contrato de ingesta (`contract.ts`), la interfaz `StickAdapter` (`stick-adapter.ts`) ni los adaptadores existentes.

**RMV1.7** Si un dispositivo descubierto no matchea ningún `ReaderDriver` del registro, entonces el sistema **no deberá** intentar conectarlo como un lector conocido y deberá tratarlo como "no reconocido", dejando operativa la carga manual (RMV3.8).

## RMV2. Motor de selección por capacidad (extiende `selectTransportAdapter`)

> **Buildable-hoy, puro y testeable sin device.** Elige **adaptador + driver** según `(plataforma, transportes disponibles, dispositivo descubierto/recordado, perfil del driver)` con una **tabla de prioridad por plataforma determinística** (context-multivendor §2 + edge case de ambigüedad). Extiende el `selectTransportAdapter` as-built **sin romper su firma**.

**RMV2.1** El sistema deberá exponer una tabla de prioridad de transporte **por plataforma, determinística**: iOS = `['ble-hid', 'ble-gatt', 'mfi']`; Android = `['spp', 'ble-gatt', 'ble-hid']`; web = `['serial']`.

**RMV2.2** El sistema deberá mapear cada par (`TransportKind`, plataforma) al `AdapterKind` concreto que lo implementa (`spp`+android → `spp-android`; `serial`+web → `web-serial`; `ble-hid` → `hid-wedge`), y deberá indicar ausencia de adaptador buildable para los transportes aún no implementados como adapter concreto (`ble-gatt`, `mfi`).

**RMV2.3** Cuando se resuelve el binding de un driver en una plataforma, el sistema deberá elegir el transporte de **mayor prioridad** (RMV2.1) que el driver soporte y que tenga un `AdapterKind` mapeado (RMV2.2), devolviendo un `ReaderBinding` con la forma `{ adapterKind, transportKind, driver, available }`.

**RMV2.4** El sistema deberá reflejar en el campo `available` del `ReaderBinding` si el `AdapterKind` elegido está **efectivamente construido** en el build actual (ej. `hid-wedge` GATED → `available:false`; `spp-android` sin dev build → `available:false`; `web-serial` en web → `available:true`), tomando el conjunto de adaptadores construidos como una entrada inyectable.

**RMV2.5** Si ningún transporte soportado por el driver tiene un `AdapterKind` mapeado en la plataforma, entonces el sistema **no deberá** devolver un `ReaderBinding` y deberá dejar operativa la carga manual (RMV3.6).

**RMV2.6** El sistema deberá implementar el motor de selección como **lógica pura** (sin React, sin acceso a device), con las entradas (plataforma, driver, adaptadores construidos, dispositivo descubierto/recordado) inyectadas, de modo que sea testeable sin hardware.

**RMV2.7** El sistema deberá extender `app/src/services/ble/adapter-selection.ts` conservando la firma y el comportamiento actuales de `selectTransportAdapter(env: SelectionEnv): AdapterKind` para los modos existentes (`auto` / `mock` / `manual`), agregando la lógica de binding por capacidad de forma **aditiva** (nueva función + nueva rama de modo), sin cambiar el resultado que hoy devuelven esos modos.

**RMV2.8** Cuando un mismo dispositivo es alcanzable por más de un transporte, el sistema deberá resolver la ambigüedad de forma **determinística** según la tabla de prioridad por plataforma (RMV2.1), sin depender del orden de descubrimiento.

## RMV3. Pantalla de conexión / selección + indicador global

> **Buildable-hoy** (UI + camino mock/web-serial/simulador). La **conexión real** de SPP/HID queda gated por hardware. Es la **cara de la demo** para fabricantes. Pantalla en "Más" (ADR-018). Reusa el `BleStickListenerProvider` global ya montado y `useBleConnectionStatus()` (implementados por el core; **no se redefinen**). Aterriza la R9 del core (hasta hoy tentativa/diferida).

**RMV3.1** El sistema deberá exponer una pantalla de conexión del bastón (`StickConnectionScreen`) accesible desde la sección "Más" de la navegación (ADR-018), que consuma el `BleStickListenerProvider` global ya montado (sin montar un provider propio).

**RMV3.2** Cuando el operario abre la pantalla de conexión, el sistema deberá presentar el flujo **descubrir → listar dispositivos → elegir → conectar**, específico por adaptador del binding activo (SPP: listar/elegir/olvidar dispositivos; web-serial: `requestPort` + lista `getPorts`; HID: instrucción de parear el teclado en el SO + campo de scan).

**RMV3.3** Cuando el operario elige un dispositivo en la pantalla de conexión, el sistema deberá persistirlo como el **bastón recordado** (`remembered-device.ts`) para reconexión posterior.

**RMV3.4** El sistema deberá mostrar los estados de conexión con CTA accionable — apagado, permiso denegado, buscando, conectando, conectado, desconectado — mapeados desde el tipo `ConnectionStatus` del core.

**RMV3.5** El sistema deberá exponer un **indicador global de estado de conexión** (`StickStatusIndicator`) en el chrome de la app, alimentado por `useBleConnectionStatus()` (implementado por el core de spec 04, no redefinido).

**RMV3.6** Mientras el estado de conexión sea cualquiera (apagado / permiso denegado / buscando / conectado / desconectado), el sistema deberá mantener la carga manual disponible y **no deberá** bloquear la pantalla de conexión ni el resto de la app.

**RMV3.7** Cuando el dispositivo elegido corresponde a un `ReaderBinding` con `available:false` (transporte reconocido pero adaptador no construido en el build — ej. iOS-HID GATED o SPP sin dev build), el sistema deberá informar el estado "reconocido, no disponible en este build todavía" con CTA a la carga manual, **sin** intentar una conexión que fallaría.

**RMV3.8** Cuando un dispositivo descubierto no matchea ningún driver (RMV1.7), el sistema deberá mostrarlo como "no reconocido" y ofrecer la carga manual, sin bloquear.

> **Reconciliación 2026-07-29.** RMV3.8 queda **igual por defecto** (`deviceRowView` sin flags: "no reconocido", no accionable). Se agregó un **opt-in explícito** (`allowUnrecognized`) que solo usa la lista de **emparejados reales del teléfono** en el camino SPP-Android, y que lleva la fila a `unrecognized-connectable` ("No lo reconocemos como bastón. Podés probar a conectarlo igual."). Motivo: el `deviceMatch.namePattern` del RS420 (`/RS\s?420|allflex/i`) es una **hipótesis** — el nombre Bluetooth real del lector **no está verificado** en `field-findings.md`. Si el bastón se anuncia con otro nombre, una lista que solo deja tocar lo "reconocido" vuelve la feature inservible en el campo **y sin síntoma**. Con el opt-in, el error sale del transporte real y no de una regex nuestra. El invariante duro se mantiene: **sin transporte instanciado ninguna fila es accionable**, ni con el flag.

## RMV4. Camino de demo / simulador (gated a dev/demo)

> **Buildable-hoy, dev/demo-only.** Simula un bastón leyendo tags "en vivo" para mostrar el pipeline completo (conexión → lectura → dedup → confirmación → find-or-create) **sin bastón físico**. Gateado con **triple-guard** al estilo del bridge E2E `__RAFAQ_BLE_E2E__`. **Requisito duro de integridad SENASA**: un EID simulado **nunca** se declara como real.

**RMV4.1** El sistema deberá exponer un adaptador simulador (`adapter-simulator.ts`, `kind: 'simulator'`) que implemente la interfaz `StickAdapter` y emita lecturas de EID sintéticas **válidas** (que pasen `isValidTag`) para ejercitar el pipeline completo sin bastón físico.

**RMV4.2** Cuando el operario dispara una lectura simulada en modo demo, el sistema deberá procesar el EID sintético por el **mismo contrato de ingesta** (validación R1, dedup R3, confirmación pre-commit R2 del core) que un EID real.

**RMV4.3** *(triple-guard 1)* El sistema **no deberá** devolver el simulador desde `selectTransportAdapter` en `mode='auto'` (default de producción); el simulador solo deberá seleccionarse bajo `mode='demo'`.

**RMV4.4** *(triple-guard 2)* El sistema deberá gatear el modo demo detrás de una marca global deliberada (`__RAFAQ_BLE_DEMO__`) horneada en build-time, disponible **solo** en un contexto **no-producción**: entorno de dev (`__DEV__`), **o** un **build de demo explícito** (canal de build dedicado, ej. `extra.demoBuild`), **o** el contexto de **E2E/captura** (`__RAFAQ_BLE_E2E__`, Playwright fuera del bundle prod); y **nunca** presente en el build de producción/preview que usan los usuarios reales (que no tiene ninguno de esos flags). No seteable desde la UI ni desde ningún input de usuario. La marca `__RAFAQ_BLE_DEMO__` es **requerida** además del contexto no-prod (el flag de E2E por sí solo NO activa el simulador — sigue en `mock`).

**RMV4.5** *(triple-guard 3)* El sistema deberá **re-verificar** el gate (marca demo + `kind === 'simulator'`) en el adaptador simulador y en la pantalla antes de emitir lecturas o montar controles de simulación, de modo que un build de producción **no tenga** ningún camino para instanciar el simulador.

**RMV4.6** Mientras una lectura provenga del simulador, el sistema deberá marcarla visualmente como **"DEMO"** en la confirmación y en la lista de lecturas.

**RMV4.7** El sistema **no deberá** permitir que un EID simulado se declare como real ante SENASA: el simulador queda fuera del bundle de producción (RMV4.3–4.5) y sus lecturas se marcan DEMO (RMV4.6); si garantizar la no-declaración exigiera cambiar un contrato de spec 09 o spec 08, el sistema deberá **parar y reportar al leader** (no parchear desde 04).

**RMV4.8** El sistema deberá mantener la **confirmación visual pre-commit** (R2 del core) también para las lecturas del simulador, sin commitear a ciegas.

## RMV5. `adapter-spp-android` escrito (RS420 Bluetooth Classic SPP)

> **Código + tests puros = buildable-hoy; conexión SPP real = GATED por hardware.** Reemplaza el placeholder as-built por código completo (context-multivendor §5). Bluetooth Classic SPP nativo vía `react-native-bluetooth-classic`; parametrizado por el driver RS420 del registro (RMV1.3). El protocolo está caracterizado (`field-findings.md`, `android-spp-impl-plan.md`).
>
> **RECONCILIACIÓN 2026-07-29 (unidad «bastón Android SPP»).** El gate de RMV5.8 ("no instalar la dep") **se levantó por pedido explícito de Raf**: la dependencia nativa está instalada, el adapter está montado en Android y el camino se ejercita en el teléfono. Lo único que queda gated es el **stream de un RS420 físico** (RMV5.9, ver T-MV.5.6). Las notas por-requisito de abajo registran las diferencias entre lo que decía el EARS y cómo quedó construido; el detalle está en `progress/impl_baston-android-spp.md`.

**RMV5.1** El sistema deberá implementar `adapter-spp-android.ts` como un `StickAdapter` real (`kind: 'spp-android'`) que abra el RFCOMM SPP del RS420 (UUID del driver, `SPP_UUID`) vía `react-native-bluetooth-classic`, reemplazando el placeholder actual.

**RMV5.2** El sistema deberá parametrizar el adaptador por el `ReaderDriver` del registro (sppUuid, pin, frameParser), de modo que otro lector SPP se soporte agregando su driver **sin reescribir** el adaptador.

> **Reconciliación 2026-07-29.** El `frameParser` y el `pin` **sí** salen del driver. El `sppUuid` **no se puede aplicar**: `RfcommConnectorThreadImpl` (código nativo de la lib) llama `createRfcommSocketToServiceRecord(BluetoothUUID.SPP.uuid)` con `00001101-…` **hardcodeado** y **ignora** la opción `uuid` que se le pase. As-built: el adapter **contrasta** el `sppUuid` del driver contra ese UUID fijo (`sppUuidIsSupported`) y, si no coincide, **NO abre el socket** (emite `disconnected` + log). Se eligió cortar antes que abrir el SPP estándar y hacer pasar por "parametrizado" algo que no lo está. Un lector SPP en otro UUID exigiría otra lib o un módulo nativo propio — queda dicho, no escondido.

**RMV5.3** Cuando el stream SPP entrega líneas ASCII, el sistema deberá framearlas por línea (`LineFramer`, reuso) y entregar cada línea cruda al contrato vía `ingestRawLine` / el `frameParser` del driver, sin reimplementar el parseo.

> **Reconciliación 2026-07-29 (corrección de un bug, no un cambio de gusto).** El framing por línea lo hace el **nativo**, no `LineFramer`: la lib entrega mensajes ya delimitados por `\n` y **sin** el terminador (`DelimitedStringDeviceConnectionImpl`, `StandardOption.DELIMITER="\n"`). Pasar ese payload por `LineFramer` (que corta por `\n`) devolvía `[]` **siempre** → el adapter no habría emitido **una sola lectura** ni con el bastón enchufado. As-built: se le piden al nativo `connectionType:'delimited'` + `delimiter:'\n'` y cada payload se entrega CRUDO al contrato (`splitSppPayload`, que además separa si vinieran varias tramas pegadas). El `frameParser` del driver sigue siendo el único que parsea (sin reimplementar nada). `LineFramer` sigue en uso en `adapter-web-serial` (ahí el stream sí llega en chunks crudos).

**RMV5.4** Cuando el operario empareja el RS420 por primera vez, el sistema deberá soportar el pairing SPP (slave, PIN del driver = `1234`) y persistir el device elegido (`remembered-device.ts`).

> **Reconciliación 2026-07-29.** La persistencia del device elegido está como pide el EARS. El **pairing programático NO se ejecuta**: el `pairDevice()` de la lib hace `createBond()` y espera un broadcast de bond-state, y sobre un device **ya emparejado** —el caso normal— `createBond()` devuelve false, el broadcast nunca llega y la promesa **no resuelve nunca** (dejaba el estado clavado en `'connecting'`). As-built: el emparejamiento se hace **una vez desde los ajustes de Bluetooth de Android** con el PIN `1234` (que la pantalla dice explícitamente, `pairedDevicesView`), y si el device no estuviera emparejado, el propio `createRfcommSocketToServiceRecord` seguro dispara el diálogo del SO. El PIN sigue viniendo del driver.

**RMV5.5** Cuando la app vuelve a foreground o el device recordado vuelve a rango, el sistema deberá reconectar con **backoff incremental** (`backoffDelayMs`, reuso), únicamente en foreground (sin BLE/SPP en background en MVP).

> **Reconciliación 2026-07-29.** As-built cumple el EARS y le agrega lo que le faltaba para ser cierto: (a) si el intento cae con la app en background, queda un listener de `AppState` que **re-arma** el reintento al volver a 'active' (antes se hacía `return` sin re-armar → la reconexión moría para siempre); (b) el objetivo del reintento es el device que se pidió conectar, no "el recordado" (que en el primer emparejamiento es `null`); (c) un `connect()` nuevo cancela el reintento pendiente. Además hay estados que **no** disparan backoff a propósito: permiso denegado, Bluetooth apagado tras un "no" del operario, y ausencia del módulo nativo — reintentar ahí es o un loop inútil o volver a tirarle el diálogo del sistema en la cara.

**RMV5.6** El sistema deberá importar `react-native-bluetooth-classic` de forma **perezosa** (require dentro de las funciones de I/O, patrón `feedback.ts`), de modo que `adapter-spp-android.ts` sea importable en web/CI **sin** el módulo nativo instalado y sin romper el bundle actual.

**RMV5.7** El sistema deberá mantener el adaptador SPP **baud-independiente** (SPP virtual ignora el baud).

**RMV5.8** El sistema deberá **vetar** la compatibilidad del config plugin de `react-native-bluetooth-classic` con Expo SDK 56 y los permisos Android 12+ (`BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`, `neverForLocation`) **antes** de comprometer el dev build; si es incompatible, el sistema deberá **parar y reportar al leader**. El delta **no deberá** instalar la dependencia nativa ni prebuildear el dev build en esta pasada.

> **Reconciliación 2026-07-29.** El veto se hizo (T-MV.5.1) y dio **COMPATIBLE**, con evidencia contra el código instalado y un build Gradle real. La cláusula "no deberá instalar la dependencia" era del alcance de *aquella* pasada y **quedó levantada por pedido explícito de Raf**: la dep está instalada y pineada, el `expo prebuild -p android` corre, y `:app:assembleDebug` compila. Hallazgo del veto: **la lib no trae config plugin** → se escribió `app/plugins/with-bluetooth-classic.js`, que declara la política de permisos y **topea el `ACCESS_FINE_LOCATION` sin tope que la lib inyecta por su manifiesto** (este camino no hace discovery: lista los emparejados). Los permisos de runtime pedidos son solo `BLUETOOTH_CONNECT` (API ≥31); `BLUETOOTH_SCAN` queda **declarado** con `neverForLocation` pero **no se pide** hoy.

**RMV5.9** El sistema **no deberá** considerar validada la conexión SPP real hasta probarla contra el RS420 físico en un dev build Android; la validación de conexión real queda **GATED** por hardware (el entregable buildable-hoy es el código + los tests puros).

> **Reconciliación 2026-07-29 — el gate se ACOTA, no se levanta.** Sigue vigente: sin un RS420 físico no está validado que el bastón emita la trama por el socket y que la app la ingiera. Lo que cambia es el **tamaño** del gate: metiendo la I/O detrás de `SppEnv` (inyección de entorno), la máquina de estados completa —permiso concedido/denegado, Bluetooth apagado con y sin aceptación, device recordado vs. explícito, apertura del socket, stream, corte del SO, backoff creciente, reset del backoff, background/foreground, doble connect, teardown— se ejercita en `node:test` **sin device**. Y en el teléfono de Raf, **sin RS420**, se puede verificar: que la app arranca con la dep nativa, el diálogo de permiso, la enumeración de los emparejados reales, el error al conectar contra algo que no habla SPP, y que el chip vuelve. Queda **solo** el stream real (T-MV.5.6).

## RMV6. Arquitectura preparada para MFi/EA e GATT (fuera de este delta)

> **Gated por negocio / futuro.** El delta deja la arquitectura preparada pero **no** implementa el adapter External Accessory (MFi iOS) ni un `adapter-ble-gatt`. MFi/certificaciones = track paralelo diferido (canal Facundo, ADR-024 §5).

**RMV6.1** Donde un fabricante autorice el uso de su lector Classic en iOS vía MFi/External Accessory, el sistema deberá permitir declararlo como un `TransportCapability` de `kind: 'mfi'` con su `protocolString` en el `ReaderDriver`, **sin** modificar el contrato de ingesta ni los adaptadores existentes.

**RMV6.2** El sistema **no deberá** implementar el adaptador External Accessory (iOS Classic / MFi) en este delta: queda gated por negocio (autorización + `protocolString` del fabricante, canal Facundo), con la arquitectura preparada (`transportKind:'mfi'` declarable; el mapeo a `AdapterKind` marcado como no-buildable en RMV2.2).

**RMV6.3** Donde aparezca un lector con GATT abierto real, el sistema deberá permitir sumar un `adapter-ble-gatt` implementando `StickAdapter` y declarando un `TransportCapability` `kind:'ble-gatt'`, sin tocar el contrato ni los otros adaptadores (reversibilidad de ADR-024, core R11.3).

---

## Trazabilidad context-multivendor.md → requirements

| Punto del context-multivendor.md | Requirement(s) |
|---|---|
| §1 Registro de drivers (`ReaderDriver`/`ReaderProfile`: vendorId, transportKind, frameParser, connectionParams, capabilities, deviceMatch) | RMV1.1, RMV1.2 |
| §1 RS420 = primer driver, reusa `parser-rs420.ts` | RMV1.3 |
| §1 "agregar fabricante = agregar config de driver sin tocar contrato/adaptadores" | RMV1.6 |
| §1 registro consultable | RMV1.4 |
| Edge case: driver desconocido → "no reconocido" + fallback manual | RMV1.7, RMV3.8 |
| §2 Motor de selección por capacidad (extiende `selectTransportAdapter`) | RMV2.3, RMV2.7 |
| §2 Tabla de prioridad por plataforma determinística (iOS HID>GATT>MFi; Android SPP/GATT>HID) | RMV2.1, RMV2.2 |
| §2 Lógica pura y testeable sin device | RMV2.6 |
| Edge case: ambigüedad de selección (device alcanzable por >1 vía) | RMV2.8 |
| Edge case: selección "por la forma en que se conecta" (canal de descubrimiento × deviceMatch) | RMV1.5, RMV2.8 |
| §2 adaptador reconocido pero no construido (available) | RMV2.4, RMV3.7 |
| §3 Pantalla de conexión/selección (descubrir→listar→elegir→conectar→estados→recordar), no bloqueante | RMV3.1, RMV3.2, RMV3.3, RMV3.4, RMV3.6 |
| §3 Indicador de estado global | RMV3.5 |
| §4 Camino de demo/simulador (lee tags en vivo sin bastón) | RMV4.1, RMV4.2 |
| §4 Gateado dev/demo, triple-guard tipo `__RAFAQ_BLE_E2E__` | RMV4.3, RMV4.4, RMV4.5 |
| §4 EID simulado NUNCA se declara como real (integridad SENASA) | RMV4.7 |
| §4 marca visual "demo" + confirmación pre-commit se mantiene | RMV4.6, RMV4.8 |
| §5 `adapter-spp-android` escrito (Classic SPP, `react-native-bluetooth-classic`), código + unit puro | RMV5.1, RMV5.2, RMV5.3, RMV5.6, RMV5.7 |
| §5 pairing/remembered/reconexión | RMV5.4, RMV5.5 |
| §5 vetar config plugin vs Expo SDK 56 + permisos, sin comprometer el dev build | RMV5.8 |
| §5 device-test GATED por hardware | RMV5.9 |
| Fuera de alcance / gated: MFi/EA adapter (Facundo), arquitectura preparada (`transportKind:'mfi'`+protocolString) | RMV6.1, RMV6.2 |
| Fuera de alcance: GATT genérico si aparece (extensión sin tocar contrato) | RMV6.3 |

## Clasificación de madurez (regla de despacho para el leader)

| Bloque | Buildable-hoy sin hardware | Gated por hardware | Gated por negocio (MFi) |
|---|---|---|---|
| RMV1 — Registro de drivers | ✅ (puro) | — | — |
| RMV2 — Selección por capacidad | ✅ (puro) | matching device→driver por **canal real** (RMV1.5 se testea con devices sintéticos; validación real gated) | — |
| RMV3 — Pantalla + indicador | ✅ UI + mock/web-serial/simulador | conexión **real** SPP/HID | — |
| RMV4 — Simulador (demo) | ✅ (dev/demo-gated por triple-guard) | — | — |
| RMV5 — `adapter-spp-android` | ✅ **código + tests + dep nativa instalada + montado en Android** (RMV5.1–5.8, 2026-07-29) | stream de un RS420 **físico** (RMV5.9, T-MV.5.6) | — |
| RMV6 — MFi/EA + GATT | arquitectura declarable (RMV6.1/6.3) | — | ✅ adapter EA/MFi (RMV6.2) |

## Criterios de aceptación del delta

Este delta se considera implementado (en su alcance buildable-hoy) cuando:

- Existe un `DRIVER_REGISTRY` con el RS420 como primer `ReaderDriver` (reusa `parser-rs420.ts`), y agregar un fabricante nuevo es agregar una entrada de driver sin tocar `contract.ts`, `stick-adapter.ts` ni los adaptadores (RMV1).
- El motor de selección elige `{ adapterKind, transportKind, driver, available }` por plataforma con la tabla de prioridad determinística, resuelve ambigüedad sin depender del orden de descubrimiento, y es 100% testeable sin device; `selectTransportAdapter` sigue devolviendo lo mismo que hoy para `auto`/`mock`/`manual` (RMV2).
- La `StickConnectionScreen` (en "Más") + el `StickStatusIndicator` muestran descubrir/listar/elegir/conectar/estados/recordar, específicos por adaptador, no bloqueantes, y funcionan contra mock/web-serial/simulador; la conexión real de SPP/HID queda documentada como gated (RMV3).
- El simulador lee tags "en vivo" por el mismo contrato de ingesta (dedup + confirmación pre-commit), está gateado por triple-guard a dev/demo, marca las lecturas como DEMO, y un build de producción no tiene camino para instanciarlo (RMV4).
- `adapter-spp-android.ts` está **escrito y montado** (código completo, parametrizado por el driver, import perezoso de la lib nativa, backoff reusado, tests de la máquina de estados verdes); el veto de compatibilidad dio COMPATIBLE y la dep nativa está instalada, con config plugin propio (la lib no trae); la conexión con un RS420 **físico** sigue GATED por hardware (RMV5.9). **[as-built 2026-07-29 — ver las notas de reconciliación bajo RMV5.2/5.3/5.4/5.5/5.8/5.9.]**
- La arquitectura declara `transportKind:'mfi'` + `protocolString` para el RS420 en iOS sin implementar el adapter EA (gated por negocio, Facundo), y admite un `adapter-ble-gatt` futuro sin tocar el contrato (RMV6).
- Todo el delta hereda del core: **offline-first** (core R14 — nada del registro/selección/simulador toca la red), **manual-first** (core R7/R9.6 — nada bloquea la carga manual), **integridad SENASA** (core R2 confirmación pre-commit, más RMV4.7 para el simulador), y **no se redefine** ningún tipo de spec 09 ni se toca ningún screen de find-or-create.

## Historial de refinamiento

- **2026-07-20 — Redacción inicial del delta (v1).** Traducción del `context-multivendor.md` (Gate 0 aprobado) a EARS sobre el core as-built de spec 04. Sin re-decidir contexto ni transporte (ADR-024).
- **2026-07-20 — Revisión crítica del leader (pre-Puerta 1).** (1) Corregido el caso de selección "RS420 en iOS": el RS420 declara solo `spp`+`serial` → en iOS no tiene transporte con adapter mapeado → binding `null` (carga manual; su vía iOS real es MFi vía Facundo), NO `hid-wedge` (el RS420 no hace HID). El caso "HID en iOS → hid-wedge" se prueba con un driver HID genérico. Afecta `design §4` + `tasks T-MV.2.4`. (2) Ampliado el gate de demo (RMV4.4 / design §5 Guard 2): de "solo `__DEV__`" a "dev **o** build de demo explícito, nunca producción/preview", para permitir una demo standalone sin romper la garantía SENASA prod-safe.

## Preguntas abiertas / a confirmar (Puerta 1)

Huecos entre context-multivendor / ADR-024 / core / as-built — **no se improvisaron resoluciones**; se documentan para la Puerta 1.

1. **¿Enmienda a ADR-024 (o ADR nuevo corto)?** El patrón **driver-registry + tabla de selección por capacidad** se va a referenciar cada vez que Raf sume un fabricante. El context-multivendor §"Ganchos" lo dejó a decidir en la spec. **Recomendación en `design-multivendor.md` §"Recomendación de ADR"** — la decide y redacta el **leader**, no el spec_author (política tentativo-vs-firme). No bloquea el `spec_ready`.
2. **Nueva `AdapterKind`/`kind` `'simulator'` y nuevo `ProviderMode` `'demo'`** extienden uniones 04-owned (`stick-adapter.ts`, `adapter-selection.ts`, switch de `permissions.ts` y de `instantiateTransport`). Es aditivo y dentro del territorio de 04, pero toca archivos del core as-built — confirmar en Puerta 1 que se acepta extender esas uniones (vs. reusar `kind:'mock'` para el simulador, alternativa descartada en el design por honestidad del marcado "DEMO").
3. **Frontera host-level del gate demo**: el prop `mode` del `BleStickListenerProvider` en `app/app/_layout.tsx` debe pasar `'demo'` cuando `isDemoMode()` (1 línea, análoga a la de `isBleE2E()`), y el indicador global (`StickStatusIndicator`) se monta en el chrome de la nav. Son cambios **host-level mínimos** (no tocan teléfono/auth), coordinados con el leader por colisión-safe. Si montar el indicador exigiera tocar un contrato de spec 09, **parar y reportar**.
4. **`protocolString` del RS420 en iOS (MFi)**: desconocido hasta que Facundo consiga la autorización de Allflex. La arquitectura lo declara como campo, pero el driver RS420 **no** lo popula con un valor real en este delta (RMV6.1/6.2). Se folda cuando llegue del canal Facundo.
5. **Validación real del matching device→driver por canal de descubrimiento** (RMV1.5, RMV2.8): sin devices reales se **diseña** ahora (unit con dispositivos sintéticos) y se **valida** cuando haya hardware (mismo gate que RMV5.9). No bloquea el `spec_ready`.
