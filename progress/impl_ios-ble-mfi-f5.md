# impl — delta `ios-ble-mfi` · **Fase F5**: `adapter-mfi-ios`, prearmado y gateado

baseline_commit: 76e4eb2d8d7f35635bed283c06a20dcd15c179a5

**Fecha**: 2026-08-17. **Spec**: `specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md`
(delta). **Alcance**: **Fase F5 solamente** (T5.1–T5.6 + las seis tasks F5-b que el as-built agregó).
F1–F4 están cerradas y commiteadas (`3272227`, `a9d81ff`, `54b72f8`) y **no se tocaron**. F6 (banco en
device), F7 (HID) y F8 (cierre) quedan fuera por contrato.

> ⚠️ **Esta fase la escribieron DOS agentes.** El primero murió por conexión perdida dejando el adapter
> escrito, `ea-protocols` a medio extender, `tsc` en verde y **6 tests rojos**. El segundo (este informe)
> retomó midiendo el árbol, encontró **un séptimo hallazgo del fuente que dejaba el transporte muerto en
> verde** (§1), cerró los 6 rojos, escribió la suite del adapter y corrió los mutantes.

---

## 0. Veredicto de T5.1 (la pregunta abierta nº1 de la spec): la rama iOS SÍ alcanza

`RBM4.8` obliga a moldear el adapter sobre el **código nativo instalado** y a **parar y reportar** si la
rama iOS de `react-native-bluetooth-classic` no expone en JS lo necesario. Leído el fuente instalado
(`ios/RNBluetoothClassic.swift`, `ios/RNBluetoothClassic.m`, `ios/conn/DelimitedStringDeviceConnectionImpl.swift`,
`ios/device/NativeDevice.swift`, `ios/event/*`, `ios/extensions/SubstringExtension.swift`, `lib/*.js|d.ts`),
las tres capacidades existen:

| Lo que el adapter necesita | Qué lo provee en la rama iOS | Evidencia en el fuente |
|---|---|---|
| **Listar accesorios por protocolo** | `getBondedDevices()` → `eaManager.connectedAccessories` mapeados por `NativeDevice.map()`, que **incluye `protocolStrings`** | `RNBluetoothClassic.swift:221-237`, `NativeDevice.swift:25-36` |
| **Abrir la sesión** | `connectToDevice(id, options)` → cruza el plist con `accessory.protocolStrings` (`determineProtocolString`) y abre una `EASession` con streams | `RNBluetoothClassic.swift:249-310`, `DelimitedString…:83-102` |
| **Leer el stream** | evento `DEVICE_READ@<serialNumber>` vía `device.onDataReceived` → el nativo pone el `dataReceivedDelegate` y entrega **mensajes ya delimitados** | `RNBluetoothClassic.swift:630-636, 662-681`, `DelimitedString…:257-275`, `lib/BluetoothModule.js` (`onDeviceRead`) |

→ **NO se para**. La pregunta abierta nº1 queda **RESUELTA: alcanza**, con **siete** hallazgos que cambiaron
la forma del adapter (§1) y dos límites que ningún unit puede cerrar (§7).

---

## 1. Los siete hallazgos del código instalado (RBM4.8) — y el 7º es el que importa

Los seis primeros los encontró el primer agente y están completos en la cabecera de `adapter-mfi-ios.ts`:

1. **No hay descubrimiento en iOS** (`startDiscovery` → `Method not implemented.`, `lib/BluetoothModule.js:176-179`).
   El emparejamiento lo hace el SO en su Accessory Picker; el adapter solo puede **listar y filtrar**.
2. **El framing lo hace el nativo**: `read()` entrega mensajes ya delimitados y **sin** el terminador. Pasarlos
   por `LineFramer` daría **cero lecturas para siempre** (el bug de `dad711f`).
3. **El terminador tiene que ser de UN carácter**: el `read()` nativo hace `content.index(after: index)`, que
   avanza **uno** — con `\r\n` el `\n` queda al frente del mensaje siguiente. **En Android sí funciona** (el
   Java avanza `index + delimiter.length()`): son dos ramas de la misma librería y **no se pueden unificar**.
4. **Las opciones del SPP crashean acá**: el nativo hace `String.Encoding.from(value as! CFStringEncoding)`
   (force-cast a UInt32) y `sppConnectOptions()` pasa `charset: 'ascii'` (un STRING) → **trapea en Swift**.
5. **`available()` no se llama nunca**: (a) su implementación tiene `while (content.index(of: delimiter) != nil)`
   con `content` inmutable → **bucle infinito**; (b) el `.m` exporta `available:` y el Swift implementa
   `availableFromDevice(…)`, así que el método que la capa JS llama **no existe**.
6. **Todo camino nativo toca CoreBluetooth**: `checkBluetoothAdapter()` usa un `CBCentralManager` **lazy** y la
   propia lib documenta que eso *"prompt bluetooth permission on first call of any bluetooth-related method"*.

### 🔴 7. El wrapper JS de la lib **se come `protocolStrings`** — hallazgo del segundo agente

`BluetoothModule.getBondedDevices()` **no devuelve los diccionarios del nativo**: devuelve un
`BluetoothDevice` por cada uno (`lib/BluetoothModule.js:101-110`), y ese wrapper copia
`name/address/id/bonded/deviceClass/rssi/type/extra` y **NO `protocolStrings`** (`lib/BluetoothDevice.js:107-117`;
la interfaz `BluetoothNativeDevice` ni la declara, porque está pensada para Android). El diccionario crudo
queda en su campo privado `_nativeDevice`.

**Qué significaba eso con el código como estaba**: `normalizeMfiAccessories` leía solo la clave directa, así
que **todo** accesorio salía con `protocolStrings: []` → `pickMfiAccessory` devolvía `null` **siempre** → el
transporte quedaba clavado en `mfi_accessory_not_found` para siempre. O sea: **RBM4.7 ("cero código el día que
llegue la cadena") era FALSO**, el síntoma en device habría sido *"no pasa nada"* —indistinguible de "el
bastón está apagado", que es el síntoma más caro de esta unidad— y **la suite entera habría estado en verde**.

Es exactamente la clase de defecto que RBM4.8 vino a evitar, entrando por una puerta que el requisito no
nombraba: *"moldear sobre el código instalado"* incluye **la capa JS que envuelve al nativo**, no solo el
Swift. El primer agente citó el Swift correcto (`NativeDevice.swift:25-36`) y no miró la capa de arriba.

**Cómo quedó**: `mfiProtocolStringsOf` acepta las **dos** formas (la cruda y la del wrapper), lo que además
vuelve al normalizador correcto sin depender de qué superficie se llame. Se descartó listar por
`NativeModules.RNBluetoothClassic` (sería una **segunda superficie del mismo módulo**, y dos implementaciones
de la misma verdad divergen). El costo declarado —`_nativeDevice` es un campo privado— está cubierto por un
**guard derivado del paquete instalado** que ata las tres afirmaciones de las que esto depende: que el mapa
nativo publique la clave, que el wrapper no la copie y conserve `_nativeDevice`, y que `getBondedDevices()`
siga devolviendo wrappers. Un `pnpm update` que cambie la forma **nace en rojo** en vez de mudo.

---

## 2. El gate de RBM4.2, y por qué su oráculo es un contador

En este transporte **consultar el módulo ya es caro**: leer `NativeModules.RNBluetoothClassic` lo
**instancia** en bridgeless (con él `EAAccessoryManager.shared()` y el force-cast del `init()` sobre la clave
del plist), y por el hallazgo 6 cualquier método del nativo puede disparar el diálogo de Bluetooth del SO. Por
eso el orden es **al revés que en el BLE** (donde `NativeModules.BlePlx` es barato y va primero):

```
1. ¿iOS?                                    Platform.OS         — no instancia nada
2. ¿algún lector del registro declara mfi?   puro                — hoy NINGUNO (RBM4.6)
3. ¿el build declara SU cadena?              Constants.expoConfig — hoy VACÍA → SE CORTA ACÁ
4. ¿el fin de trama es frameable en iOS?     puro
5. ¿el binario está en este build?           NativeModules       — recién acá se toca el nativo
```

El oráculo no es un comentario: el borde entra inyectado (`MfiModuleEnv`) y el test **cuenta los toques** en
un arranque en frío COMPLETO (guard de disponibilidad + construcción del adapter + `autoConnect` + `connect`)
→ tiene que dar **cero**, con **control positivo** (con la cadena declarada, >0). Los dos mutantes que
reintroducen el toque eager mueren (M1, M2 en §5).

**Seis motivos de `mfi_unavailable`**, no cuatro: los tres del gate de datos + `delimitador-no-soportado`
(hallazgo 3) + `plataforma-no-ios` + `modulo-nativo-ausente`. Van por separado porque desde la UI se ven
idénticos (nada) y mandan a lugares distintos: al fabricante, a `app.config.ts`, al registro o al build.

---

## 3. Los 6 rojos que dejó el primer agente: qué era cada uno y qué se hizo

El leader los había clasificado como *"los guards de F4 haciendo su trabajo"*. **Se confirmó, y la
clasificación se sostuvo contra la medición** — ninguno era regresión.

| Test rojo | Qué era | Qué se hizo |
|---|---|---|
| `🔴-1: la tabla de adaptadores con radio se DERIVA del árbol` | El guard de F3 escrito **sobre la ausencia** para que un adapter con puente nazca en rojo (RBM3.3) | Declarado `adapter-mfi-ios.ts` en `RADIO_ADAPTERS`. **Bonus**: el contador de usos del mecanismo tenía un punto ciego (no matcheaba `withTimeoutOr<void>(…)`) y **subestimaba en los tres adapters**; corregido |
| `🟡-3: los módulos habilitados a ESCRIBIR el bastón recordado son una lista CERRADA` | F5 agregó un escritor y no lo registró | Registrado + su `byKind` + **anti-vacuidad del mapa** (que el barrido haya visto exactamente los tres kinds) |
| `RBM5.5/RBM4.7: la pantalla pasa la lista REAL de protocolos declarados` | La mitad que exigía **la AUSENCIA** de `'mfi-ios'` en `BUILT_ADAPTERS` | **Invertido citando RBM4.5 + RBM4.7** (§4). Se agregó además que `hid-wedge` siga afuera, explícito |
| `RBM5.6 fail-closed: una preferencia mfi-ios no se honra hasta que F5 construya su adapter` | **Legítimamente obsoleto**: su premisa era que `instantiateTransport('mfi-ios')` devuelve `null` | Reescrito citando **RBM4.4/RBM5.2**: ahora SÍ se honra en iOS y **en ningún otro lado** (fail-closed conservado). Se agregó un test hermano que **deriva del union** cuál es el único kind vetado (`hid-wedge`), en vez de espejar la lista |
| `🟠-2: un transporte que la selección NO honraría no se ofrece` | Ídem: `mfi-ios` ya no está gateado | Reescrito citando **RBM4.1/RBM5.14**: la fila del lector MFi ahora SÍ se ofrece, con `available:false` + motivo + `installable:false` → **se dice y no es accionable**, que es lo que RBM5.14 pide. `hid-wedge` sigue afuera |
| `🟠-2 GUARD SOBRE LA AUSENCIA: todo transporte construido y usable es ALCANZABLE` | **El guard que se pidió justo para esto** | **No se aflojó**: ver §4 |

### El caso del guard de alcanzabilidad (el que valía la pena pensar)

De las tres condiciones (honrado + ofrecido + con escritor), dos se cablearon sin discusión. La tercera —"la
pantalla lo ofrece"— **no se puede cumplir hoy**: `transportChoices` recorre el **registro de lectores**, y
ningún driver declara `mfi` porque **RBM4.6 lo prohíbe**. Eso es un DATO faltante impuesto por un requisito,
no un mecanismo faltante.

Las dos salidas fáciles eran malas: **aflojar** el guard ("si no hay lector, no exijo nada") lo dejaba pasando
por vacuidad para cualquier transporte futuro; **"cumplirlo"** registrando un driver con una cadena inventada
viola RBM4.6 y convierte una incógnita en un verde falso. As-built:

- la exención se aplica **solo** si ningún lector del registro resuelve a ese kind, la lista de pares exentos
  es **cerrada y nombrada** (`['ios/mfi-ios']`) y su motivo se **verifica** (el registro real no tiene lectores
  `mfi`) → un par exento nuevo es una decisión visible en el diff;
- y hay un **test hermano** (`🟠-2/RBM4.7: con la cadena del fabricante, mfi-ios queda ALCANZABLE sin escribir
  una línea de código`) que corre el MISMO invariante inyectando solo los dos datos del día del fabricante y
  exige que el par pase entero, **con contraprueba** de que sin el driver sintético sale exento.

Sin ese hermano, *"no se puede cumplir"* sería indistinguible de *"no lo cableé"* — que es exactamente cómo se
afloja un guard sobre la ausencia sin que se note.

---

## 4. Trazabilidad `RBM<n>` → test

`M` = archivo del módulo. Todo lo de abajo corre en `node scripts/check.mjs` (stage `client unit tests`).

| Requisito | Archivo:test |
|---|---|
| **RBM4.1** (`StickAdapter kind:'mfi-ios'`, sin deps nuevas) | `adapter-mfi-ios.test.ts`: *"el adapter es kind `mfi-ios`, su modo de ingesta es `raw-line` y su permiso es `ios-mfi`"* · *"GUARD: el `require` de la lib y de `react-native` es PEREZOSO"* · deps verificadas: 51, 2 de Bluetooth, `pnpm-lock.yaml` sin cambios |
| **RBM4.2** (lista vacía → no disponible **y no se toca el nativo**) | `adapter-mfi-ios.test.ts`: *"arranque en frío con la lista VACÍA → CERO toques al módulo nativo (el mutante obligatorio)"* + *"CONTROL POSITIVO"* + *"el ORDEN de los chequeos es el requisito (el nativo va ÚLTIMO)"* + *"sin el módulo nativo en el build, `connect()` queda manual-first y sin reintentos"* |
| **RBM4.3** (la clave del plist no se saca nunca) | `ios-purpose-strings-guard.test.ts`: *"GUARD: `UISupportedExternalAccessoryProtocols` está DECLARADA (vacía vale)"* · `app.config.test.ts`: *"RBM4.3: sigue declarada (y vacía) con la dep de BLE instalada"* · `ea-protocols.test.ts`: *"GUARD: la clave que leemos es LA MISMA que declara `app.config.ts`"* + *"…y está en LA MISMA RUTA"* |
| **RBM4.4** (cadena declarada + driver que la declara → disponible) | `ea-protocols.test.ts`: *"build CON la cadena del driver → available"* + *"la comparación de la cadena es EXACTA"* · `adapter-mfi-ios.test.ts`: *"[cadena A/B]: la cadena y el fin de trama que se le pasan al nativo salen DEL DRIVER"* (×2 perfiles) · `selection-priority.test.ts`: la tabla del design §6.1, fila *"RS420 + mfi sintético, build CON esa cadena"* |
| **RBM4.5** (cadena no declarada → `available:false` con motivo, sin intentar) | `ea-protocols.test.ts`: *"el driver declara una cadena que el build NO declara → protocolo-no-declarado"* + *"los TRES motivos son distintos entre sí"* · `adapter-mfi-ios.test.ts`: *"RMV3.7: un driver con una cadena que el build NO declara no intenta conectar"* + *"un `connect_failed` (sin intersección de protocolo) NO se reintenta"* · `wiring.test.ts`: *"la pantalla pasa la lista REAL…"* (`BUILT_ADAPTERS` incluye `mfi-ios` para que el motivo sea el honesto) |
| **RBM4.6** (no se inventa ninguna `protocolString`) | `ea-protocols.test.ts`: *"un driver que NO declara mfi → driver-sin-mfi (y el RS420 es ese caso)"* + *"…apareció una protocolString en el build"* · `selection-priority.test.ts`: *"el RS420 REAL sigue sin declarar mfi → en iOS su binding es null"* · `adapter-mfi-ios.test.ts`: *"`mfiDriverFrom` sobre el registro REAL devuelve null"* · `wiring.test.ts`: el registro entero no tiene lectores `mfi` |
| **RBM4.7** (el diff del día del dato, probado con cadena sintética) | `ea-protocols.test.ts`: *"RBM4.7 de punta a punta: la cadena puesta en la config REAL la levanta el camino de producción"* · `adapter-mfi-ios.test.ts`: los dos perfiles de driver de punta a punta · `wiring.test.ts`: *"con la cadena del fabricante, `mfi-ios` queda ALCANZABLE sin escribir una línea de código"* |
| **RBM4.8** (moldeado sobre el código instalado; parar si no alcanza) | `ea-protocols.test.ts`: *"GUARD (RBM4.8): el fuente INSTALADO sigue teniendo las dos formas que el normalizador tolera"* + *"HALLAZGO 7: `protocolStrings` también se lee del `_nativeDevice`"* · `adapter-mfi-ios.test.ts`: *"GUARD (hallazgos 1 y 5): el adapter no llama métodos que en iOS no existen o cuelgan el nativo"* + *"GUARD (hallazgo 4): no reusa las opciones del SPP"* · `ea-protocols.test.ts`: *"DIFERENCIAL iOS vs Android: `\r\n` lo soporta el SPP y NO el MFi"* |
| **RBM4.9** (`raw-line` + `frameParser` del driver) | `adapter-ingest-mode.test.ts` (recorre `ADAPTER_KINDS`) · `adapter-mfi-ios.test.ts`: *"el `frameParser` sale DEL DRIVER del adapter, y el driver es inmutable por instancia"* + *"la lectura entra CRUDA al contrato y sale el EID con el parser del driver"* |
| **RBM1.3/RBM1.4** (driver aditivo; fail-closed sin driver) | `adapter-mfi-ios.test.ts`: *"sin driver `mfi` el adapter NO expone parser (la línea se descartaría con aviso)"* |
| **RBM3.1** (tope de la cadena sin gesto) | `adapter-mfi-ios.test.ts`: *"la cadena que NADIE pidió muere al vencer su presupuesto (y NO suma un intento más)"* + *"el tope se chequea ANTES del gate de foreground"* + *"el tope de la CABECERA es el que mata una cadena vencida con la app en BACKGROUND"* + *"un GESTO del operario DESTOPA la cadena"* |
| **RBM3.2** (presupuesto en todo await + latch) | `adapter-mfi-ios.test.ts`: *"un `connectToDevice` que NO resuelve vence con SU presupuesto y LIBERA el latch"* + *"un storage que NO CONTESTA no cuelga el arranque"* + *"un `getBondedDevices` que no contesta vence"* + *"un `device.disconnect()` que no contesta no deja colgado el teardown"* |
| **RBM3.3** (guard estático de presupuestos) | `spp-bridge-timeout-guard.test.ts`: los 5 tests de `[adapter-mfi-ios.ts]` + *"la tabla se DERIVA del árbol"* |
| **RBM3.4** (desconexión de fuente propia) | `adapter-mfi-ios.test.ts`: *"el evento de desconexión es GLOBAL — apagar OTRO accesorio no puede cerrar nuestra sesión"* |
| **RBM3.5** (segunda fuente de verdad, fail-closed) | `adapter-mfi-ios.test.ts`: *"la sonda de liveness reconcilia sin depender de ningún evento (poll y foreground)"* + *"al volver a FOREGROUND se reconcilia"* + *"si la sonda RECHAZA no seguimos afirmando conectado"* + *"un evento sin id legible se acepta"* + *"sin `isDeviceConnected` se DICE que no hay sonda"* |
| **RBM3.6** (foreground-only, chequeado al disparar) | `adapter-mfi-ios.test.ts`: *"el foreground se chequea AL DISPARAR el timer"* + *"en background el arranque no hace NADA"* |
| **RBM3.7** (target encolado, no descartado) | `adapter-mfi-ios.test.ts`: *"`connect()` a OTRO accesorio con un intento en vuelo se ENCOLA"* + *"`connect()` SIN target … (`connect_reasserted`)"* |
| **RBM3.9** (dwell del backoff) | `adapter-mfi-ios.test.ts`: *"el backoff solo se resetea si el link DURÓ"* + *"un link que DURÓ el dwell sí resetea el backoff"* |
| **RBM3.10** (mudez escrita, sin desconectar) | `adapter-mfi-ios.test.ts`: *"el silencio de un link conectado queda ESCRITO (`connected_silent`) y NO desconecta"* (con el reloj en un instante real: el `ms` es el INTERVALO) |
| **RBM3.11** (máquina de estados con entorno inyectado) | `adapter-mfi-ios.test.ts` entero: **55 tests**, incluidas las promesas que no resuelven nunca |
| **RBM5.2/RBM5.3** (mapeo `mfi` + iOS → `mfi-ios`, `null` afuera) | `selection-priority.test.ts`: *"ble-gatt mapea en iOS Y Android, mfi SOLO en iOS, spp SOLO en Android"* + *"la preferencia `mfi-ios` SÍ se honra en iOS y en ningún otro lado"* |
| **RBM5.5** (`available` = construido ∧ protocolo declarado) | `selection-priority.test.ts`: *"el `available` de mfi-ios es una CONJUNCIÓN"* (4 casos + anti-vacuidad del fixture `BUILT_WITHOUT_MFI`) |
| **RBM5.6** (el transporte sigue al bastón recordado + su escritor) | `wiring.test.ts`: *"los módulos habilitados a ESCRIBIR … son una lista CERRADA"* + *"la pantalla NO persiste NADA"* + *"todo transporte construido y usable es ALCANZABLE"* + su hermano de la cadena sintética · `adapter-mfi-ios.test.ts`: *"[cadena A/B]: … el accesorio + su transporte quedan persistidos"* |
| **RBM5.7** (formato viejo = sin preferencia; y el id no se presta) | `wiring.test.ts`: *"cada adapter usa el bastón recordado SOLO si el registro es de SU transporte"* (`mfi-ios` con `acceptsLegacy:false`) |
| **RBM5.9** (`mock`/`manual`/`demo` no cambian) | `selection-priority.test.ts`: *"la preferencia NO puede cambiar mock/manual/demo"* (recorre TODO el union) + el bloque de los tres modos del test de la preferencia `mfi-ios` |
| **RBM5.14** (la pantalla deriva el flujo del binding) | `selection-priority.test.ts`: *"un transporte que la selección NO honraría no se ofrece"* (ahora con la fila MFi ofrecida + su motivo) · `connection-view.test.ts` (F4, sin cambios): las dos ramas de copy de MFi |
| **RBM9.4/RBM9.3** (offline-first; sin frontera de datos) | `adapter-mfi-ios.test.ts`: *"offline-first: este transporte NO puede tocar la red"* (guard sobre la ausencia de `fetch`/`supabase`/`powersync`/`establishment_id`) |
| **RBM9.5** (la carga manual nunca se bloquea) | `adapter-mfi-ios.test.ts`: *"ningún camino de este adapter TIRA — una falla es un estado, no una excepción"* (5 caminos de falla) · `wiring.test.ts`: `blocksManualEntry` sobre todos los estados |
| **RBM9.7** (Gate 2.5) | `app/e2e/captures/baston-ios-ble-mfi-f5.capture.ts` — ver §6 |

**Sin cobertura de unit, declarado**: RBM6.\* (banco, es F6), RBM8.\* (gate HID, es F0/F7), RBM7.\*
(reconciliación, es F8).

---

## 5. Mutantes — 16 corridos, **16 muertos**

Backups con nombre propio (`*.f5mut.bak`) y restauración comparada **byte a byte contra ese backup**, no
contra `git diff` (hay otra terminal trabajando en el árbol). Runner:
`scratchpad/mutants-f5.mjs`. Al terminar: cero `.f5mut.bak` en el árbol y `git status` sin cambios inesperados.

| # | Mutante | Resultado | Quién lo mata |
|---|---|---|---|
| M1 | **RBM4.2** — el guard de disponibilidad consulta `NativeModules` **antes** del gate de datos | 💀 | *"CERO toques al módulo nativo"* · *"el ORDEN de los chequeos es el requisito"* |
| M2 | **RBM4.2** — el adapter carga la librería nativa **antes** del gate | 💀 | *"CERO toques…"* · *"un driver con una cadena que el build NO declara no intenta conectar"* |
| M3 | **RBM4.3** — se **borra la clave** `UISupportedExternalAccessoryProtocols` de `app.config.ts` | 💀 | `app.config.test.ts` · `ios-purpose-strings-guard.test.ts` · los dos guards de ruta de `ea-protocols.test.ts` |
| M4 | **Hallazgo 7** — el normalizador vuelve a leer solo la clave directa (el bug que traía la fase) | 💀 | *"HALLAZGO 7: `protocolStrings` también se lee del `_nativeDevice`"* + 4 tests del adapter |
| M5 | **RBM4.9** — el fin de trama del `connect` se hardcodea | 💀 | *"[cadena B + `\r`]: … salen DEL DRIVER"* (solo el 2º perfil) |
| M6 | **RBM4.4** — la cadena de protocolo del filtro se hardcodea | 💀 | *"[cadena B + `\r`]: … salen DEL DRIVER"* |
| M7 | **RBM3.4** — se borra el filtro por nuestra dirección del evento GLOBAL | 💀 | *"el evento de desconexión es GLOBAL"* |
| M8 | **RBM3.9** — el backoff se resetea siempre (se borra el dwell) | 💀 | los dos tests del dwell |
| M9 | **RBM3.10** — la mudez se mide con `now()` en vez del intervalo | 💀 | *"el silencio … queda ESCRITO"* (el `ms` aserrado) |
| M10 | **RBM3.1** — se borra el chequeo del tope **dentro del timer** | 💀 | *"la cadena que NADIE pidió muere…"* · *"el tope se chequea ANTES del gate de foreground"* |
| **M10b** | **RBM3.1** — se borra el chequeo del tope de la **cabecera** | ⚠️ **SOBREVIVIÓ** → test nuevo → 💀 | *"el tope de la CABECERA es el que mata una cadena vencida con la app en BACKGROUND"* |
| M11 | **RBM3.2** — un await del puente sin presupuesto (`getBondedDevices`) | 💀 | `spp-bridge-timeout-guard.test.ts` (nombra archivo y línea) |
| M12 | **RBM4.7** — `mfi-ios` vuelve a `NOT_SELECTABLE_AS_PREFERENCE` | 💀 | 4 tests entre `wiring` y `selection-priority` |
| M13 | **RBM4.5** — `mfi-ios` sale de `BUILT_ADAPTERS` | 💀 | *"la pantalla pasa la lista REAL…"* · los dos de alcanzabilidad |
| M14 | **RBM5.6** — el adapter deja de escribir su `adapterKind` | 💀 | *"lista CERRADA de escritores"* · *"la pantalla NO persiste NADA"* · alcanzabilidad |
| M15 | **RBM5.7** — el adapter acepta el registro del formato viejo (`acceptsLegacy: true`) | 💀 | *"cada adapter usa el bastón recordado SOLO si el registro es de SU transporte"* |

**M10b es el hallazgo de método de esta fase**: el tope está implementado dos veces a propósito, y borrar el de
la cabecera **no mataba nada** — no eran dos oráculos, era un oráculo y un cinturón. Es literalmente el mismo
hallazgo que el review de F3 dejó escrito para el BLE, reaparecido acá porque el adapter copia esa forma. El
caso que solo cubre la cabecera es *"el presupuesto vence MIENTRAS hay un intento en vuelo y la app se fue a
background"*: sin ella la cadena se parquea esperando el foreground y vuelve a martillar cuando el operario
saca el teléfono, o sea **el tope se vuelve evitable guardando el teléfono en el bolsillo**. Escribirlo obligó
a que el doble pudiera rechazar **después** del gate (antes rechazaba de una y el escenario no existía).

---

## 6. Gate 2.5 (ADR-029) — capture

`app/e2e/captures/baston-ios-ble-mfi-f5.capture.ts`, corrido y verde (4 capturas generadas; los `__shots__`
están gitignored y **no se agregaron**).

**F5 no agrega ninguna superficie nueva**, y no solo en web: hoy la fila de un lector MFi **no existe en ningún
teléfono** porque ningún driver declara `mfi` (RBM4.6). Las dos ramas de copy de MFi ya existían desde F4 y
están cubiertas por `connection-view.test.ts` con bindings sintéticos; su veto visual es de device (T6.6).
Entonces lo que el capture entrega es el **oráculo de no-regresión** de lo que F5 sí cambió en el motor que
decide qué se renderiza:

1. **Ni una fila de más** (`toHaveCount(1)`, aserrado ANTES de cada foto): es el oráculo que cazó el bug de las
   dos filas idénticas en F4-b, ahora vigilando que declarar `mfi-ios` construido no haya fabricado una fila
   para un transporte que web no puede montar. Más: cero rastro del copy de MFi.
2. **Escenario NUEVO de F5**: se siembra un bastón recordado con `adapterKind:'mfi-ios'` en `localStorage`.
   Hasta F4 eso lo frenaba una **lista**; desde F5 lo único que lo frena fuera de iOS es la **tabla de
   plataforma**. Se exige que la pantalla siga entera y caiga al piso de web (`web-serial`), con el CTA de
   olvidar a mano. Verificado a ojo en la captura 03: la pantalla renderiza completa, el copy es el de `serial`
   y el botón entra a 412 px sin recortar sus descendentes.

Capturas: `01-baston-build-de-hoy`, `02-devices-instruccion-serial`, `03-preferencia-mfi-ios-en-web`,
`04-cta-olvidar-con-preferencia-mfi`.

---

## 7. Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

**Lo que busqué**, además de lo que ya está arriba:

- **Desviaciones del spec / requisitos cubiertos a medias.** Encontré que T5.3(d) —"cablear su fila en la banda
  de transportes elegibles"— **no se puede cumplir como está escrito** y que cumplirlo "a la fuerza" habría
  violado RBM4.6. Cerrado con la exención nombrada + el test hermano (§3), y **reconciliado en las tres specs**
  para que no quede una task diciendo algo que el código no hace.
- **Tests que pasan por la razón equivocada.** Tres casos, los tres corregidos:
  (a) *"un `disconnect()` MIENTRAS se abre la sesión"* pasaba con `deviceDisconnects === 0` porque el
  `disconnect()` llegaba **antes de que el intento tocara el puente** — el escenario que decía probar no
  existía; se agregó el `flush()` + la aserción de que el intento está en vuelo.
  (b) los dos tests del dwell leían un timer que no existía porque el reintento **había reconectado**; se
  reescribieron con un helper que provoca el corte y devuelve el delay, y con la anti-vacuidad de que
  `backoffDelayMs(0) !== backoffDelayMs(1)`.
  (c) M10b (§5): un test que decía cubrir el tope cubría **una** de sus dos copias.
- **Monocultura de fixtures** (el 🟠-1 del review de F3). La suite corre **dos perfiles de driver** que difieren
  en la cadena Y en el fin de trama, con un test de anti-vacuidad que lo exige; los dos mutantes que
  re-hardcodean cada parámetro mueren nombrando el perfil B. El reloj arranca en un instante **real**
  (`CLOCK_START`) en los tests que miden intervalos, y los presupuestos del doble son **distintos entre sí** con
  el `ms` aserrado en el log — las dos correcciones que F3 tuvo que hacer a posteriori, acá desde el principio.
- **Edge cases sin test**: payload vacío / no-string / solo-whitespace (0 lecturas), dos mensajes pegados
  (2 lecturas), lista de accesorios que no es lista, accesorio sin id, ids duplicados, orden inestable, evento
  de desconexión sin id legible, sonda de liveness ausente / que rechaza / que no contesta, `disconnect()` con
  el teardown colgado, dos `connect()` seguidos (leak de listeners), y **el adapter sin driver** (fail-closed
  de RBM1.4). Todos con test.
- **Gaps de seguridad / frontera de datos.** Gate 1 es N/A y **verificado como tal** (§8). Se agregó un guard de
  que este adapter **no toca la red** (RBM9.4: el peón en la manga no tiene señal) ni la frontera multi-tenant
  (`supabase`/`powersync`/`establishment_id`): el modo de falla acá es una LÍNEA NUEVA, no un estado, así que el
  oráculo correcto es estático.
- **Cosas que NO cambié y verifiqué que siguen igual** (los tres invariantes pre-registrados por el leader):
  `UISupportedExternalAccessoryProtocols` sigue **declarada y vacía**; `driver-rs420.ts` **no declara** el
  transporte `mfi` (sus 3 menciones son comentarios que explican por qué no) — verificado por comportamiento en
  tres suites, no por grep; **51 dependencias, 2 de Bluetooth**, `pnpm-lock.yaml` y `app/package.json` **sin
  cambios**.
- **Typecheck de los tests**, que el repo NO mira (`app/tsconfig.json` excluye `**/*.test.ts`): corrido a mano
  sobre los 5 archivos tocados con `types: ["node"]` → **cero errores**. Es la trampa que F3 documentó (su
  suite tenía 2 errores de tipo reales invisibles para el check).

**Lo que decidí NO hacer, con su motivo** (para que no se lea como olvido):

- **No listar los accesorios por `NativeModules.RNBluetoothClassic`** aunque ahí `protocolStrings` viene sin
  campo privado de por medio: sería una **segunda superficie del mismo módulo**, y dos implementaciones de la
  misma verdad divergen (el bug de clase de este camino). Se prefirió un normalizador que tolera las dos formas
  + guard derivado del paquete.
- **No registrar ningún driver MFi**, ni siquiera "de ejemplo" para destrabar el guard de alcanzabilidad:
  RBM4.6 lo prohíbe y sería convertir una incógnita en un verde falso.
- **No tocar `adapter-hid-wedge.ts` ni el banco**, ni `feature_list.json`/`progress/current.md`/`supabase/`/
  `sync-streams/`/spec 09/spec 24, ni instalar dependencias, ni lanzar builds de EAS. `scripts/run-tests.mjs` es
  compartido: se tocó **solo** el bloque de tests del cliente y se verificó que el bloque de la otra terminal
  (rebrand fase 5 + el `stage-runner` nuevo) siguiera intacto.

---

## 8. Gate 1 (RBM9.1/RBM9.2) — N/A, verificado de forma ATRIBUIBLE

El oráculo **no** es `git diff` (mide el árbol, muestra el trabajo ajeno y es ciego a los untracked): es
`git status --porcelain supabase/ sync-streams/` **cruzado línea por línea contra la lista de archivos de este
delta** (abajo). Corrido al cierre:

```
 M supabase/config.toml
 M supabase/functions/audit_query/index.ts
?? supabase/functions/audit_query/access-helpers.test.ts
?? supabase/functions/audit_query/access-helpers.ts
?? supabase/functions/audit_query/access.ts
```

**Las cinco líneas son de la OTRA TERMINAL** (spec 24, visor de audit / Cloudflare Access — aparecieron durante
esta sesión, y sus informes `progress/impl_24-cloudflare-access-{backend,web}.md` también son de ella).
**Ninguna está en la lista de archivos de F5**, y `sync-streams/` no tiene ni una línea. Este delta: cero
migraciones, cero funciones/RPC, cero Edge Functions, cero policies, cero cambios en `sync-streams/`. Tampoco
toca ningún camino multi-tenant (RBM9.3): el EID que ingiere entra al motor de spec 09, que **no se tocó**
(RBM9.6). **Gate 2 (modo `code`) sigue siendo obligatorio**, y el leader tiene que calcular su diff contra el
`baseline_commit` de la cabecera **filtrando por la lista de abajo**, o va a estar revisando spec 24 con él.

### Archivos de F5 (la lista contra la que se cruza todo lo demás)

**Nuevos**
- `app/src/services/ble/adapter-mfi-ios.test.ts`
- `app/e2e/captures/baston-ios-ble-mfi-f5.capture.ts`

**Nuevo del primer agente, revisado y corregido acá**
- `app/src/services/ble/adapter-mfi-ios.ts`

**Modificados**
- `app/src/services/ble/ea-protocols.ts` (hallazgo 7 + las piezas puras del transporte)
- `app/src/services/ble/ea-protocols.test.ts`
- `app/src/services/ble/wiring.test.ts`
- `app/src/services/ble/selection-priority.test.ts`
- `app/src/services/ble/spp-bridge-timeout-guard.test.ts`
- `app/src/services/ble/adapter-selection.ts` (`mfi-ios` sale de `NOT_SELECTABLE_AS_PREFERENCE`)
- `app/src/services/ble/driver-types.ts` (`mfi` gana `delimiter?`)
- `app/src/services/ble/logging.ts` (`mfi_unavailable{reason}`, con el union importado)
- `app/src/services/ble/BleStickListenerProvider.tsx` (`instantiateTransport('mfi-ios')`)
- `app/src/features/ble-stick/screens/StickConnectionScreen.tsx` (`BUILT_ADAPTERS` + `TRANSPORT_INSTALLABLE`)
- `scripts/run-tests.mjs` (**compartido** — solo el bloque del cliente)
- `specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md` (§9)
- `progress/impl_ios-ble-mfi-f5.md` (este archivo)

Todo lo demás que aparece en `git status` es de la **otra terminal** (visor de audit / spec 24, `check.mjs` +
`scripts/lib/stage-runner*`, `feature_list.json`, `progress/current.md`, `docs/backlog.md`,
`docs/verification.md`, `specs/active/10-operaciones-rodeo/*`, `.harness/config.json`, `docs/marketing/*`).

---

## 9. Reconciliación de specs (regla dura de `docs/specs.md`)

Nada quedó contradiciendo al código:

- **`tasks-ios-ble-mfi.md`**: T5.1–T5.6 en `[x]` con sus notas de as-built (incluido el veredicto de RBM4.8 y
  el hallazgo 7); la nota de T5.3 actualizada con **las cinco cosas hechas** y con la precisión de que la fila
  MFi *"no se cablea: aparece sola"*; T8.7 pasa a **6 de 6**; y una sección **F5-b** con las seis tasks reales
  que el spec no tenía (T5.7–T5.12).
- **`requirements-ios-ble-mfi.md`** (notas de reconciliación, sin reescribir los EARS): **RBM4.2** (el orden y
  por qué "consultar" acá no es barato, + el 6º motivo), **RBM4.5** (por qué `mfi-ios` entra a `BUILT_ADAPTERS`
  y el guard se invierte), **RBM4.7** (la prueba ejecutable en tres capas + "lo que haya que sacar de una lista
  ese día es código"), **RBM4.8** (el veredicto + los siete hallazgos, con el 7º completo), **RBM5.6** (el guard
  de alcanzabilidad: qué se le agregó y por qué no se aflojó), **RBM5.14** (la fila MFi ahora se ofrece; qué se
  puede vetar en web y qué no). La **pregunta abierta nº1 queda tachada y resuelta**, con la lección de método.
- **`design-ios-ble-mfi.md`**: §5.1 **as-built** entera (piezas, el orden del gate, la tabla de los 7 hallazgos,
  las lecciones del SPP, y lo que el diseño no puede verificar), el árbol de archivos actualizado, la fila de
  `logging.ts`, la nota de `BUILT_ADAPTERS` (revertida con su motivo) y la del guard de alcanzabilidad.

---

## 10. Verificación

- `cd app && pnpm typecheck` → **rc=0**.
- Typecheck **de los tests** (que el repo excluye), a mano sobre los 5 archivos tocados → **0 errores**.
- Stage `client unit tests` completo → **3440/3440**.
- Suites de esta fase: `adapter-mfi-ios` **55/55**, `ea-protocols` **25/25**, `wiring` **31/31**,
  `selection-priority` **41/41**, `spp-bridge-timeout-guard` **20/20**.
- **16 mutantes, 16 muertos** (§5).
- `node scripts/check.mjs` → **exit 0**, `22 declarado(s) · 22 PASS · 0 FAIL · 0 SKIP · 0 NO CORRIÓ` (con el
  orquestador nuevo de la otra terminal, que ya nombra los 22 stages uno por uno).
- Capture del Gate 2.5 → verde, 4 capturas (§6). No re-renderizó `design/**/*.png`.

---

## 11. Lo que queda ABIERTO al cerrar F5 (para el reviewer y para el leader)

1. **El transporte MFi está PREARMADO, no verificado.** No hay banco posible: hace falta un lector con licencia
   MFi **y** la cadena de protocolo del fabricante. Es una deuda **distinta** de la del BLE (que sí tiene banco
   en F6) y no puede leerse como "verificado porque la suite está verde".
2. **Riesgo específico que ningún unit cierra**: el `sendEvent` del nativo emite por `RCTBridge` (bajo
   bridgeless, `RCTBridgeProxy`). Si esa vía no estuviera cableada, las lecturas no llegarían a JS. El síntoma
   sería "conectado y mudo" — el adapter lo deja **escrito** (`connected_silent`) en vez de dejarlo invisible.
   Es la misma clase de límite que el veto de F2 declaró para `react-native-ble-plx`.
3. **Lo que destraba MFi de verdad es gestión, no código** (RBM4.6): la cadena iAP + licencia MFi de **Allflex**
   y **Datamars**, canal Facundo. El día que llegue: una línea en `app.config.ts` + una `TransportCapability` en
   el driver del fabricante. **Cero código**, y hay tres tests que lo demuestran (§4, RBM4.7).
4. **F6 sigue siendo el que baja el gate de hardware del BLE**, y su primera medición (T6.4) es la que valida en
   device el invariante hermano del de esta fase: que el arranque en frío no dispare el diálogo de Bluetooth.
