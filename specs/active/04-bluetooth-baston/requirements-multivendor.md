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
> **[Reconciliación 2026-07-29: el `emulador de bastones` sobre ESP32 (`firmware/baston-emulator/`) destraba la mayor parte de este bloque — SPP real, conexión real, matching por nombre anunciado y el gate físico del `hid-wedge` (R8.7) se pueden correr sin comprar hardware. Queda gated lo que un emulador no puede imitar: las mañas de los lectores comerciales.]**
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

> **Reconciliación 2026-07-30 (BENCH-3, banco §4.5) — la pantalla es DUEÑA del bastón mientras está enfocada.** Medido en device: cada bastonazo en `/baston` se consumía **dos veces** — entraba en la lista de Lecturas de la pantalla **y** abría el `FindOrCreateOverlay` global (*"Caravana leída / ¿Es uno de tus animales sin caravana?"*) **tapándola**. Rompe la invariante que el propio proyecto se construyó ("un solo consumidor efectivo") y pega justo donde más incomoda: `context-multivendor.md` §3 define esta pantalla como la cara de la demo a los fabricantes.
>
> As-built: la pantalla toma la **propiedad exclusiva** del listener con `acquireScopedScanner()` (el mecanismo RCF.6, del delta caravana-ficha) dentro de un `useFocusEffect` → el overlay global se auto-suprime mientras `/baston` está en primer plano, y la confirmación de esa pantalla es su lista de lecturas en vivo (nada se commitea desde ahí).
>
> Se eligió el scanner acotado y **no** agregar `'baston'` a `BLE_OWNED_ROUTES`, por tres razones: (1) la propiedad la declara el DUEÑO y no una lista de literales de rutas que vive en otro archivo —mover o renombrar la ruta la rompería en silencio, que es la misma clase de bug que 🟡-1—; (2) el scanner acotado además FUERZA la escucha aunque un ancestro haya prendido `busyMode`, que es lo que necesita una pantalla cuyo único trabajo es mostrar lecturas en vivo; (3) `useFocusEffect` y no `useEffect` porque las pantallas del stack quedan MONTADAS al navegar encima: con `useEffect`, algo empujado sobre `/baston` dejaría el overlay suprimido en toda la app, en silencio. `BLE_OWNED_ROUTES` sigue siendo lo correcto para rutas con su propio flujo completo (`maniobra`, `asignar-caravanas`).
>
> **Reconciliación 2026-08-05 — la cláusula "accesible desde «Más»" recién ahora es CIERTA.** Desde el 2026-07-20 la ruta `/baston` existía y estaba registrada, pero la **fila de `(tabs)/mas.tsx` nunca se cableó** (quedó como coordinación pendiente entre terminales): la pantalla se alcanzaba **solo por deep-link**. O sea, el EARS afirmaba un punto de entrada que no existía. El disparador de cerrarlo fue un reporte de Raf en device: abrió la app, el chip global quedó ciclando *"Conectando…"* (la reconexión automática de R6.4 con el bastón apagado) y **no tuvo ninguna manera de llegar a la pantalla** para cortarlo ni para entender qué pasaba.
>
> As-built: sección **"Bastón"** en `(tabs)/mas.tsx` con un `ActionRow` a `/baston`, ubicada **después de la card de Perfil y antes del bloque "Campo activo"** — el bastón se empareja con el **teléfono**, no con el campo, y ese bloque está gateado por `activeField != null`, así que la fila habría desaparecido justo cuando el usuario no tiene campo resuelto. **Sin gate de rol**: conectar el bastón es trabajo de manga, no una acción administrativa. El **trailing muestra el estado de conexión EN VIVO** (`connectionRowStatus`, función pura nueva de `connection-view.ts`), que es lo que responde el reporte original: enterarse sin entrar. La fila **no se oculta sin transporte** (a diferencia del chip global, que sí): es el único camino in-app a la pantalla, y esa pantalla es la que explica la salida manual — el trailing dice "No disponible" en vez de mentir. Mismo criterio que la fila de "Asignar caravanas en masa" (bugfix 2026-07-29).
>
> Efecto colateral cerrado: el chevron del header de la pantalla pasó de `router.back()` pelado a `backOr(router, '/(tabs)/mas')` — era el **último** `back()` pelado de la app, y quedaba trabado con el stack vacío (que era EXACTAMENTE cómo se llegaba: deep-link). Y la captura `07-indicador-global-chrome` del Gate 2.5, caída desde el 2026-07-30 por falta de una navegación client-side que saliera de `/baston` con la conexión viva, **volvió**.

**RMV3.2** Cuando el operario abre la pantalla de conexión, el sistema deberá presentar el flujo **descubrir → listar dispositivos → elegir → conectar**, específico por adaptador del binding activo (SPP: listar/elegir/olvidar dispositivos; web-serial: `requestPort` + lista `getPorts`; HID: instrucción de parear el teclado en el SO + campo de scan).

> **Reconciliación 2026-07-30 (🟠-4 del review) — la lista de emparejados no puede quedar clavada en "Buscando…".** `loadPaired()` no tenía guard de re-entrada y su `await` no tenía presupuesto: si esa promesa no se asentaba (el caso de la promesa huérfana del diálogo de Bluetooth, ver RMV5.5), `pairedState` se quedaba en `loading`, y `pairedDevicesView('loading')` devuelve `ctaLabel: null` → la sección quedaba **sin botón** hasta salir y volver a entrar, sin nada en la UI que lo sugiriera. As-built, en dos capas: (a) `listPairedSppDevices` **coalesce** los pedidos concurrentes y acota TODOS sus awaits del puente, así que siempre se asienta en `{ok:false}` con un motivo; el coalesce además evita que **nosotros** solapemos dos `requestBluetoothEnabled` (uno de los dos caminos por los que el nativo dejaba una promesa huérfana para siempre); (b) la pantalla tiene su propio guard de re-entrada y cae a `error` (que sí tiene CTA "Reintentar") si el service llegara a tirar.

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

> **Reconciliación 2026-07-30 (BENCH-3).** En `/baston` la confirmación es la **lista de lecturas en vivo de la propia pantalla** (EID + hora + badge DEMO), no el `FindOrCreateOverlay` global — que ahí está suprimido a propósito (ver la nota de RMV3.1). No se pierde nada del EARS: desde esa pantalla **no hay ningún camino de commit** (no se crea, no se asigna, no se transfiere), así que no hay nada que confirmar antes de commitear; la confirmación pre-commit del overlay sigue intacta en todas las pantallas donde el bastonazo SÍ puede terminar en una escritura.

## RMV5. `adapter-spp-android` escrito (RS420 Bluetooth Classic SPP)

> **Código + tests puros = buildable-hoy; conexión SPP real = GATED por hardware.** Reemplaza el placeholder as-built por código completo (context-multivendor §5). Bluetooth Classic SPP nativo vía `react-native-bluetooth-classic`; parametrizado por el driver RS420 del registro (RMV1.3). El protocolo está caracterizado (`field-findings.md`, `android-spp-impl-plan.md`).
>
> **RECONCILIACIÓN 2026-07-29 (unidad «bastón Android SPP»).** El gate de RMV5.8 ("no instalar la dep") **se levantó por pedido explícito de Raf**: la dependencia nativa está instalada, el adapter está montado en Android y el camino se ejercita en el teléfono. Lo único que queda gated es el **stream de un RS420 físico** (RMV5.9, ver T-MV.5.6). Las notas por-requisito de abajo registran las diferencias entre lo que decía el EARS y cómo quedó construido; el detalle está en `progress/impl_baston-android-spp.md`.

**RMV5.1** El sistema deberá implementar `adapter-spp-android.ts` como un `StickAdapter` real (`kind: 'spp-android'`) que abra el RFCOMM SPP del RS420 (UUID del driver, `SPP_UUID`) vía `react-native-bluetooth-classic`, reemplazando el placeholder actual.

**RMV5.2** El sistema deberá parametrizar el adaptador por el `ReaderDriver` del registro (sppUuid, pin, frameParser), de modo que otro lector SPP se soporte agregando su driver **sin reescribir** el adaptador.

> **Reconciliación 2026-07-29.** El `frameParser` y el `pin` **sí** salen del driver. El `sppUuid` **no se puede aplicar**: `RfcommConnectorThreadImpl` (código nativo de la lib) llama `createRfcommSocketToServiceRecord(BluetoothUUID.SPP.uuid)` con `00001101-…` **hardcodeado** y **ignora** la opción `uuid` que se le pase. As-built: el adapter **contrasta** el `sppUuid` del driver contra ese UUID fijo (`sppUuidIsSupported`) y, si no coincide, **NO abre el socket** (emite `disconnected` + log). Se eligió cortar antes que abrir el SPP estándar y hacer pasar por "parametrizado" algo que no lo está. Un lector SPP en otro UUID exigiría otra lib o un módulo nativo propio — queda dicho, no escondido.
>
> **Corrección de esa reconciliación + ampliación, 2026-07-30 (🟡-4 y 🟠-5 del review de `dad711f`).** La frase *"el `frameParser` y el `pin` sí salen del driver"* era **falsa en dos tercios**, y el reviewer lo cazó:
> - **`pin`**: `resolveSppParams` lo devuelve y **nadie lo consume**. Se dejó de usar cuando se eliminó `pairDevice()` (ver RMV5.4): el emparejamiento lo hace Android, y el PIN sale del driver hacia la **UI** (`pairedDevicesView` lo dice en el copy), no hacia el transporte. Sigue en el tipo porque ahí es donde pertenece el dato; lo que era falso es decir que el adapter lo aplica.
> - **`frameParser`**: **no se usa en producción**. `contract.ingestRawLine` llama `parseRs420Line` **hardcodeado**; el `frameParser` del driver solo se invoca **desde los tests**. Consecuencia honesta: con un segundo driver SPP de otro formato de trama, **RMV1.6 no se cumple** (habría que tocar `contract.ts`). Queda declarado como deuda, no como logro; el fix pertenece a `contract.ts` (core) y se hace cuando exista el segundo driver, no antes.
> - **Lo que SÍ se agregó al driver** (🟠-5): el **terminador de trama** (`delimiter` en el `TransportCapability` de kind `spp`). Estaba hardcodeado en `\n` dentro de `sppConnectOptions()`, y un lector que terminara con CR solo dejaba la app **conectada, muda, sin un error ni un log** — verificado en device (`term cr` → 0 ingestas, 0 errores, banco §4.4). Ahora sale del driver, el RS420 lo declara explícito (`\n`, de `field-findings.md`) y un delimitador que este adapter no puede framear (vacío) **corta la conexión con log**, igual que el UUID.

**RMV5.3** Cuando el stream SPP entrega líneas ASCII, el sistema deberá framearlas por línea (`LineFramer`, reuso) y entregar cada línea cruda al contrato vía `ingestRawLine` / el `frameParser` del driver, sin reimplementar el parseo.

> **Reconciliación 2026-07-29 (corrección de un bug, no un cambio de gusto).** El framing por línea lo hace el **nativo**, no `LineFramer`: la lib entrega mensajes ya delimitados por `\n` y **sin** el terminador (`DelimitedStringDeviceConnectionImpl`, `StandardOption.DELIMITER="\n"`). Pasar ese payload por `LineFramer` (que corta por `\n`) devolvía `[]` **siempre** → el adapter no habría emitido **una sola lectura** ni con el bastón enchufado. As-built: se le piden al nativo `connectionType:'delimited'` + `delimiter:'\n'` y cada payload se entrega CRUDO al contrato (`splitSppPayload`, que además separa si vinieran varias tramas pegadas). El `frameParser` del driver sigue siendo el único que parsea (sin reimplementar nada). `LineFramer` sigue en uso en `adapter-web-serial` (ahí el stream sí llega en chunks crudos).
>
> **Reconciliación 2026-07-30 (dos precisiones).** (a) El delimitador ya **no** es `'\n'` fijo: sale del `TransportCapability` del driver (ver la nota de RMV5.2), y `splitSppPayload` separa por **ese mismo** delimitador — separar por otro sería inventar tramas. (b) La decisión de **por qué puerta del contrato entra** una lectura (`processRawLine` para un stream vs `processEid` para un adapter que ya entrega el EID limpio) dejó de ser una comparación de dos literales inline en el provider y pasó a una tabla EXHAUSTIVA por `AdapterKind` (`ADAPTER_INGEST_MODE` en `adapter-selection.ts`, `satisfies Record<AdapterKind, IngestMode>`): un adapter nuevo **no compila** hasta declarar su modo. Motivo (🟡-1): si a esa lista le faltara `spp-android`, cada trama del RS420 iría por `processEid` → `normalizeTag` le saca el STX → 34 dígitos → `isValidTag` false → **cero lecturas con la suite entera en verde** (el provider es `.tsx`, no lo cubría ningún node:test, y el E2E corre web con mock/manual/simulator). Era la tercera repetición de esta clase de bug en este camino.

**RMV5.4** Cuando el operario empareja el RS420 por primera vez, el sistema deberá soportar el pairing SPP (slave, PIN del driver = `1234`) y persistir el device elegido (`remembered-device.ts`).

> **Reconciliación 2026-07-29.** La persistencia del device elegido está como pide el EARS. El **pairing programático NO se ejecuta**: el `pairDevice()` de la lib hace `createBond()` y espera un broadcast de bond-state, y sobre un device **ya emparejado** —el caso normal— `createBond()` devuelve false, el broadcast nunca llega y la promesa **no resuelve nunca** (dejaba el estado clavado en `'connecting'`). As-built: el emparejamiento se hace **una vez desde los ajustes de Bluetooth de Android** con el PIN `1234` (que la pantalla dice explícitamente, `pairedDevicesView`), y si el device no estuviera emparejado, el propio `createRfcommSocketToServiceRecord` seguro dispara el diálogo del SO. El PIN sigue viniendo del driver.

**RMV5.5** Cuando la app vuelve a foreground o el device recordado vuelve a rango, el sistema deberá reconectar con **backoff incremental** (`backoffDelayMs`, reuso), únicamente en foreground (sin BLE/SPP en background en MVP).

> **Reconciliación 2026-07-29.** As-built cumple el EARS y le agrega lo que le faltaba para ser cierto: (a) si el intento cae con la app en background, queda un listener de `AppState` que **re-arma** el reintento al volver a 'active' (antes se hacía `return` sin re-armar → la reconexión moría para siempre); (b) el objetivo del reintento es el device que se pidió conectar, no "el recordado" (que en el primer emparejamiento es `null`); (c) un `connect()` nuevo cancela el reintento pendiente. Además hay estados que **no** disparan backoff a propósito: permiso denegado, Bluetooth apagado tras un "no" del operario, y ausencia del módulo nativo — reintentar ahí es o un loop inútil o volver a tirarle el diálogo del sistema en la cara.
>
> **Reconciliación 2026-07-30 — la reconexión no alcanzaba porque la DESCONEXIÓN no siempre se detectaba.** Cinco cosas cambiaron, todas de la misma familia (la máquina de estados en los bordes). Cada una cierra un defecto **reproducido**, no una hipótesis: dos en el A07 real (banco §4.1 y §4.2/§4.6) y el resto con dobles del entorno.
>
> 1. **Liveness (🔴, banco §4.1, 3/3 repro).** Si el link se caía con la app **minimizada**, el evento del SO se perdía y al volver la pantalla decía *"Bastón conectado — la lectura entra sola"* **indefinidamente**, con el socket muerto y cada bastonazo al vacío. Causa raíz: el ÚNICO detector era un evento que se puede perder (el nativo lo emite con `sendEvent`, que **descarta** el evento si no hay Catalyst instance activa; y el otro emisor publica en `DEVICE_DISCONNECTED@<address>`, al que este listener ni siquiera está suscrito). As-built: **segunda fuente de verdad** — `isDeviceConnected(address)` (del lado Java es `mConnections.containsKey`, y ese mapa lo limpian el `ActionACLReceiver` y el error del hilo de lectura, dos caminos que corren en Java aunque el evento nunca llegue a JS), consultada (i) **al volver a foreground** y (ii) por un **poll periódico de 15 s** que no depende de ningún evento ni de `AppState`. Fail-closed: si la sonda no está o rechaza, NO se sigue afirmando "conectado". Nota R6.9: sondear no es conectar/escanear/reconectar, y la reconexión que dispara sigue siendo foreground-only.
> 2. **Timeouts (🔴, banco §4.2).** Ningún await del puente vencía → una promesa nativa que no resolvía dejaba el latch de conexión tomado **para siempre** y todo `connect()` posterior era un no-op mudo hasta matar la app. Medido en device: **2 min 40 s sin un solo evento** con el Bluetooth prendido y el bastón disponible, porque el operario lo prendió del panel rápido en vez de contestar el diálogo. As-built: `bridge-timeout.ts` (presupuestos por clase de llamada), latch liberado en el `finally` **y** en `disconnect()`, generación de intento para que el intento viejo no pise al nuevo, y un guard estático (`spp-bridge-timeout-guard.test.ts`) que falla si aparece un await del puente sin presupuesto.
> 3. **Gate de foreground al DISPARAR (🟠, banco §4.6, confirmado en device).** Se chequeaba al **programar** el timer y no al **disparar**, así que un timer nacido en primer plano se ejecutaba en background — viola este requisito y el R6.9 del core, y es el habilitador del latch (un `requestBluetoothEnabled` en background no puede abrir su Activity, así que su promesa no se asienta nunca).
> 4. **Dwell del backoff (🟡-3, banco §4.3).** El contador se reseteaba apenas resolvía `connectToDevice`, así que `flap 4 3000` daba `attempt:0` las **cuatro** veces: connect → drop → 500 ms → connect indefinido, con la radio martillando. Ahora el reset exige que el link haya **durado** 30 s (`LINK_DWELL_MS`). El README del emulador esperaba "backoff creciente" y el as-built lo desmentía; ahora la expectativa es cierta. **Y desde la tercera pasada**, el contador también vuelve al piso cuando **arranca una cadena nueva** (un tap del operario): si tocó "Volver a conectar" después de cinco fallos, el reintento sale a los 500 ms y no a los 8 s. Ojo con el modelo al testear esto: un `connect()` es un GESTO y arranca cadena; el flap real lo dispara el TIMER (trigger `retry`), que hereda — dos tests del dwell tenían el atajo de simular el flap con `connect()` y hubo que corregirlos (documentado en el propio test).
> 5. **El diálogo del sistema NUNCA sale de un timer.** Un reintento automático con el Bluetooth apagado ya no pide activarlo (sería un diálogo que el operario no pidió); sigue reintentando en silencio, y como el backoff topea en 8 s, cuando el operario lo prenda por afuera la app reconecta sola dentro de esa ventana. Un `connect()` **del operario** sí lo pide, como antes. **Ampliado en la segunda pasada (R6.4)**: lo mismo vale para el diálogo de **permisos**. Un camino automático (arranque o reintento) **consulta** el permiso (`PermissionsAndroid.check`) en vez de pedirlo, porque `requestMultiple` sobre un permiso denegado UNA vez —sin "no volver a preguntar"— **vuelve a mostrar el diálogo**: un timer podía tirárselo en la cara al operario sin contexto. El campo `checkPermissions` del `SppEnv` es **obligatorio** a propósito (no un opcional con caída a `ensurePermissions`): un env nuevo que se lo olvide **no compila**, en vez de empezar a mostrar diálogos desde un timer en silencio.
>
> **Tercera pasada, 2026-07-30 — el TOPE de la cadena que nadie pidió.** R6.4 introdujo un defecto: el reintento infinito, que antes exigía un gesto deliberado, ahora arranca solo en cada apertura → un bastón que ya no existe deja la app con cara de rota para siempre, martillando la radio, y `scanning` no tiene CTA. La política pasó a declararse por **ORIGEN de la cadena** en una tabla exhaustiva (`connect-trigger.ts`): `operator` sin tope, `autoconnect` con tope de 120 s, `retry` hereda. Eso también reemplazó el booleano `auto` de `doConnect` —que era el mismo dato pero adivinado, y no distinguía "cadena del operario" de "intento sin diálogos"— y le dio a `checkPermissions` su call site derivado de la política en vez de un flag. El detalle (el número y su justificación contra la escalera de backoff, qué pasa al agotarse, y por qué el chequeo va antes del gate de foreground) está en la nota de **R6.4** en `requirements.md`. Lo que toca a este delta: `connectionStatusView` gana un `autoConnectExhausted` OPCIONAL en su `ConnectionEnv` para dar el copy honesto en la pantalla de conexión sin cambiar el estado (`'off'`) ni tocarle el chrome a alguien que no pidió nada — el `StickStatusIndicator` no pasa el flag y sigue viendo el copy genérico, que para él es cierto.
>
> **Segunda pasada, 2026-07-30 — R6.4 (auto-conectar al ABRIR la app).** Se implementó (decisión de Raf; la alternativa de reconciliar la spec diciendo "el arranque es por gesto" quedó descartada). Vive en `SppAndroidAdapter.autoConnect()`, que el provider llama una vez al montar el transporte, y está gobernada por la regla **"el arranque no pide nada"** — los cuatro gates, el "no se emite ningún estado" y el log de los seis motivos están en la nota de reconciliación de **R6.4** (`requirements.md`, core), que es donde vive el requisito. Acá solo lo que toca a este delta: `autoConnect` es **opcional** en `StickAdapter` y hoy la implementa **solo** `spp-android`, y no por olvido de los otros cuatro — `web-serial` **no puede** (la Web Serial API exige un gesto para `requestPort()`; su "recordar" es `getPorts()`, R5.4), `manual` no tiene transporte físico, y `mock`/`simulator` los conecta su propio disparador (el bridge de E2E / el botón de la demo). Eso también es lo que hace que el cambio tenga **cero riesgo** para las ~70 specs E2E, que corren en `mock`.

**RMV5.6** El sistema deberá importar `react-native-bluetooth-classic` de forma **perezosa** (require dentro de las funciones de I/O, patrón `feedback.ts`), de modo que `adapter-spp-android.ts` sea importable en web/CI **sin** el módulo nativo instalado y sin romper el bundle actual.

**RMV5.7** El sistema deberá mantener el adaptador SPP **baud-independiente** (SPP virtual ignora el baud).

**RMV5.8** El sistema deberá **vetar** la compatibilidad del config plugin de `react-native-bluetooth-classic` con Expo SDK 56 y los permisos Android 12+ (`BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT`, `neverForLocation`) **antes** de comprometer el dev build; si es incompatible, el sistema deberá **parar y reportar al leader**. El delta **no deberá** instalar la dependencia nativa ni prebuildear el dev build en esta pasada.

> **Reconciliación 2026-07-29.** El veto se hizo (T-MV.5.1) y dio **COMPATIBLE**, con evidencia contra el código instalado y un build Gradle real. La cláusula "no deberá instalar la dependencia" era del alcance de *aquella* pasada y **quedó levantada por pedido explícito de Raf**: la dep está instalada y pineada, el `expo prebuild -p android` corre, y `:app:assembleDebug` compila. Hallazgo del veto: **la lib no trae config plugin** → se escribió `app/plugins/with-bluetooth-classic.js`, que declara la política de permisos y **topea el `ACCESS_FINE_LOCATION` sin tope que la lib inyecta por su manifiesto** (este camino no hace discovery: lista los emparejados). Los permisos de runtime pedidos son solo `BLUETOOTH_CONNECT` (API ≥31); `BLUETOOTH_SCAN` queda **declarado** con `neverForLocation` pero **no se pide** hoy.

**RMV5.9** El sistema **no deberá** considerar validada la conexión SPP real hasta probarla contra el RS420 físico en un dev build Android; la validación de conexión real queda **GATED** por hardware (el entregable buildable-hoy es el código + los tests puros).

> **Reconciliación 2026-07-29 — el gate se ACOTA, no se levanta.** Sigue vigente: sin un RS420 físico no está validado que el bastón emita la trama por el socket y que la app la ingiera. Lo que cambia es el **tamaño** del gate: metiendo la I/O detrás de `SppEnv` (inyección de entorno), la máquina de estados completa —permiso concedido/denegado, Bluetooth apagado con y sin aceptación, device recordado vs. explícito, apertura del socket, stream, corte del SO, backoff creciente, reset del backoff, background/foreground, doble connect, teardown— se ejercita en `node:test` **sin device**. Y en el teléfono de Raf, **sin RS420**, se puede verificar: que la app arranca con la dep nativa, el diálogo de permiso, la enumeración de los emparejados reales, el error al conectar contra algo que no habla SPP, y que el chip vuelve. Queda **solo** el stream real (T-MV.5.6).

> **Reconciliación 2026-07-29 (bis) — el gate se ACOTA otra vez, y ahora sí se puede correr.** El ESP32 del bridge de la balanza se reprogramó como **emulador de bastones** (`firmware/baston-emulator/`, `MODO_SPP`): emite la trama capturada en campo con fidelidad de byte y provoca los escenarios que rompen (repetidos, ráfagas, corte del link, radio abajo, flap, 10 malformadas, trama partida, dos pegadas, mudez). Con eso **stream, dedup sobre lecturas reales, ráfagas, corte, backoff y reconexión pasan a ser verificables SIN un RS420** (T-MV.5.7, pendiente de flasheo). De este requisito queda gated solo la parte irreductible: **las idiosincrasias del lector físico** — su emparejamiento, su semántica de desconexión, sus tiempos, su buffer interno / "sessions", y si la trama cambió con la actualización de firmware pendiente (T-MV.5.6). Lista completa de lo que el emulador NO valida en `firmware/baston-emulator/README.md` §"Qué NO valida".

> **Reconciliación 2026-07-30 (ter) — el gate se CORRIÓ: el bastón LEE en device.** El emulador se flasheó y el banco se corrió entero contra el A07 real (`progress/bench_baston-spp-emulador.md`): **la app ingirió su primera trama real** (`982000364696050`, byte por byte igual a la captura de campo) y **18 de 21 escenarios** del banco automatizado quedaron en verde contra `dad711f` — stream, dedup (1/2/8 exacto), 20 animales sin perder ninguno, 9 malformadas con 9 rechazos, trama partida, dos pegadas, corte + reconexión, mudez. Los tres rojos son los que esta unidad arregla (BENCH-1 y LATCH) más un oráculo tramposo del propio banco (§4.8, ya corregido). O sea: **el stream ya no es fe** y el banco es un oráculo que sabe fallar ante un bug conocido. Sigue gated solo lo del párrafo anterior (idiosincrasias del RS420 físico, T-MV.5.6 / T-MV.7.3), más lo que necesita hardware ajeno: 🔴-2 (el filtro del evento de desconexión global) pide un **segundo device Classic emparejado** — unos auriculares alcanzan, es una prueba de 1 minuto. El mecanismo está verificado leyendo el Java de la lib y cubierto por tests con dobles; lo que falta es verlo en el teléfono.

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
| RMV5 — `adapter-spp-android` | ✅ **código + tests + dep nativa instalada + montado en Android** (RMV5.1–5.8, 2026-07-29) + **stream/dedup/reconexión contra el emulador ESP32** (T-MV.5.7) | solo las **idiosincrasias** del RS420 físico (RMV5.9, T-MV.5.6) | — |
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
