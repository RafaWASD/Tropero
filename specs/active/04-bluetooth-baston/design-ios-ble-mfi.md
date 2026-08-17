# Spec 04 — DELTA «iOS BLE real + MFi prearmado» — Design

**Status**: `spec_ready` (delta-spec ADR-028 Nivel B — mini-ciclo propio; **NO reabre el core aprobado de spec 04 ni el delta multivendor**).
**Fecha**: 2026-08-17.
**Fuente de verdad**: `requirements-ios-ble-mfi.md` (`RBM`) + `context-ios-ble-mfi.md` (Gate 0 aprobado) + **ADR-024** (transporte — no se re-decide) + **ADR-003** (Nordic UART) + el **as-built** de `app/src/services/ble/*` y `app/src/features/ble-stick/*`.

> **Regla de oro del delta.** El core dejó firme la columna vertebral (`contract.ts`, `stick-adapter.ts`, `dedup.ts`, `feedback*`, `BleStickListenerProvider.tsx`, `remembered-device.ts`, `line-framer.ts`) y el delta multivendor le agregó el registro de drivers y la selección por capacidad. Este delta **agrega dos adaptadores y dos módulos puros**, hace **extensiones aditivas** a las uniones ya existentes, y hace **una** cirugía real: sacarle a `contract.ts` la llamada hardcodeada al parser del RS420. Ningún método de `StickAdapter` cambia. Ningún archivo de spec 09 se toca.

## Deltas posteriores (índice — lo mantiene el leader al cerrar)

- `multivendor` — registro de drivers + selección por capacidad + pantalla de conexión + simulador demo + `adapter-spp-android` escrito. Estado: cerrado (as-built, con reconciliaciones).
- `ios-ble-mfi` — parser por driver + `adapter-ble-gatt` cross-platform + `adapter-mfi-ios` gateado + prioridad iOS + banco `MODO_GATT` + gate HID. Estado: `spec_ready` (este documento).

---

## 1. Arquitectura del delta sobre el as-built

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│  StickConnectionScreen ("Más", ADR-018)  +  StickStatusIndicator (chrome)          │
│    flujo por transporte: SPP · serial · [BLE: escanear→listar→elegir]  ← NUEVO     │
│                          [MFi: Accessory Picker + "falta el protocolo"] ← NUEVO   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌───────────────────────────────────────────────────────────────────────────────────┐
│  driver-registry.ts            selection-priority.ts                               │
│   + driver-esp32-gatt (banco)   ios: ['mfi','ble-gatt','ble-hid']       ← CAMBIA   │
│   ✗ NO hay driver del HR5 v3    adapterForTransport: +ble-gatt +mfi-ios ← CAMBIA   │
│     (sin doc del fabricante)    available(mfi) = built ∧ protocolo declarado       │
│                                 + preferencia del bastón RECORDADO     ← NUEVO    │
└───────────────────────────────────────────────────────────────────────────────────┘
                                    ↓ elige adapter + driver
┌───────────────────────────────────────────────────────────────────────────────────┐
│  StickAdapter (interfaz del core, R11 — SIN cambios de método)                     │
│    ├── adapter-spp-android   as-built (Android, RS420)                             │
│    ├── adapter-ble-gatt      NUEVO — react-native-ble-plx, iOS **y** Android       │
│    ├── adapter-mfi-ios       NUEVO — rama iOS de bluetooth-classic, GATEADO        │
│    ├── adapter-web-serial · adapter-manual · adapter-mock · adapter-simulator      │
│    └── adapter-hid-wedge     placeholder — lo destraba (o lo cierra) el GATE de T7 │
│         ↓ cada stream entrega su LÍNEA CRUDA + su ReaderDriver                     │
│  contract.ts: ingestRawLine(line, frameParser) → isValidTag → dedup → confirm      │
│               ▲ el parser ENTRA POR PARÁMETRO (T1). Ya no importa parser-rs420.    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**La idea central del delta**, en una línea: *el transporte deja de presuponer el fabricante*. El multivendor hizo que los fabricantes fueran datos; este delta hace que el **contrato** los lea de ahí, que es lo que faltaba para que un transporte nuevo sirva para algo más que para nuestro propio emulador.

## 2. Archivos a crear o modificar

### 2.1 Nuevos (todos en territorio de 04)

```
app/src/services/ble/
├── adapter-ble-gatt.ts          # StickAdapter kind:'ble-gatt' sobre react-native-ble-plx (RBM2, RBM3)
├── ble-gatt-protocol.ts         # PURO: decodeBase64Ascii, normalizeUuid128, bleGattDelimiterIsSupported,
│                                #   resolveBleGattParams(driver) (espejo de spp-protocol.ts)
├── adapter-mfi-ios.ts           # StickAdapter kind:'mfi-ios' sobre la rama iOS de bluetooth-classic (RBM4)
│                                #   as-built F5: MfiModuleEnv (3 operaciones con costos distintos, el
│                                #   chequeo del nativo VA ÚLTIMO) + MfiEnv inyectable + las 10 lecciones
│                                #   del SPP escritas desde el día uno (RBM3), porque RBM4.7 no deja que
│                                #   el día del dato haya código nuevo. Ver §5.1.
├── ea-protocols.ts              # PURO: declaredEaProtocols(), mfiAvailability(driver, declared) (RBM4.2/4.4/4.5)
│                                #   as-built F5: + resolveMfiParams / mfiDelimiterIsSupported (1 carácter:
│                                #   la rama iOS avanza UNO) / mfiConnectOptions (SIN charset: force-cast =
│                                #   crash) / normalizeMfiAccessories + pickMfiAccessory (no hay
│                                #   descubrimiento: se lista y se filtra por protocolString) /
│                                #   mfiProtocolStringsOf (hallazgo 7: el wrapper JS se come la clave) /
│                                #   classifyMfiConnectError + MFI_CONNECT_RETRY (el motivo decide si se
│                                #   reintenta: la cadena que el build no declara NO se martilla)
├── driver-esp32-gatt.ts         # ReaderDriver del EMULADOR en MODO_GATT (RBM5.12/5.13). PURO.
└── tests (junto al módulo, patrón node:test)
    ├── ble-gatt-protocol.test.ts       # base64/latin-1 con STX, uuid case, delimitador inválido
    ├── adapter-ble-gatt.test.ts        # máquina de estados con BleEnv inyectado (RBM2, RBM3)
    │                                   #   as-built F3 (fix-loop del review): DOS PERFILES DE DRIVER
    │                                   #   (`DRIVER_PROFILES`) — UUID y fin de trama DISTINTOS, recorridos
    │                                   #   de punta a punta. Es lo que hace falsificable "el parámetro sale
    │                                   #   del driver" (RBM2.4/2.6/2.8): con un solo juego, un literal de
    │                                   #   fabricante y el valor del driver son los mismos bytes.
    ├── ea-protocols.test.ts            # lista vacía → no disponible; cadena sintética → disponible (RBM4)
    │                                   #   as-built F5: + el GUARD derivado del paquete instalado que ata
    │                                   #   las dos formas de `protocolStrings` (hallazgo 7): si la lib
    │                                   #   cambia de forma, nace en rojo en vez de quedar muda.
    ├── adapter-mfi-ios.test.ts         # con lista vacía NO carga el nativo (RBM4.2)
    │                                   #   as-built F5: máquina de estados COMPLETA con MfiEnv +
    │                                   #   MfiModuleEnv inyectados (el doble CUENTA los toques al nativo:
    │                                   #   0 en un arranque en frío, con control positivo). Dos perfiles
    │                                   #   de driver (cadena y fin de trama DISTINTOS) por el mismo motivo
    │                                   #   que la suite del BLE. Es el ÚNICO lugar donde este transporte
    │                                   #   se ejercita: no hay banco posible sin licencia MFi.
    └── frame-parser-resolve.test.ts    # (A) exhaustivo sobre ADAPTER_KINDS + fail-closed (RBM1.4)
                                        #   (B) as-built F1 (fix del review): `readSourceFor` — EL CAMINO
                                        #       QUE CORRE EL PROVIDER, por comportamiento e IDENTIDAD.
                                        #   (C) as-built F1: ADITIVIDAD end-to-end (T1.7/RBM1.6)
                                        #   (D) as-built F1: GUARD estático sobre contract.ts (T1.8-i/RBM1.7).
                                        #   El guard de las superficies de CABLEO (provider +
                                        #   adapter-selection, T1.8-ii) vive en adapter-ingest-mode.test.ts,
                                        #   junto al de la decisión hermana.
```

### 2.2 Modificados — la cirugía de T1 (04-owned)

| Archivo | Cambio | Requisito |
|---|---|---|
| `contract.ts` | `ingestRawLine(line, frameParser)` y `EidIngestEngine.processRawLine(line, frameParser, now?)` reciben el parser. **Se elimina** el `import { parseRs420Line }` (queda `isValidTag`/`normalizeTag`, que son del contrato y no de un fabricante). ✅ **as-built F1** | RBM1.1, RBM1.2 |
| `app/app/baston-test.tsx` | **(as-built F1, no estaba en esta tabla)** el harness web-serial era el SEGUNDO call site de `processRawLine`; migrado al mismo camino (`resolveFrameParser` + descarte con log). Lo enumeró el typecheck. | RBM1.1, RBM1.4 |
| `stick-adapter.ts` | `readonly driver?: ReaderDriver` — **aditivo y opcional**, mismo precedente que `autoConnect?()`. Ningún método cambia. | RBM1.3 |
| `adapter-selection.ts` | ✅ **as-built F1**: `resolveFrameParser(adapter, onUnresolved)` (puro, sink inyectado — ver §3 nota 1) **+ `ReadSource` / `readSourceFor(adapter, onUnresolved)`** (§3 nota 4). Además: `AdapterKind`/`ADAPTER_KINDS`/`ADAPTER_INGEST_MODE` += `'ble-gatt'` (`raw-line`) y `'mfi-ios'` (`raw-line`); `SelectionEnv.preferredAdapter?: AdapterKind`. | RBM1.4, RBM2.11, RBM4.9, RBM5.6 |
| `BleStickListenerProvider.tsx` | `instantiateTransport` gana los dos `case`; ✅ **as-built F1**: el call site pide su `ReadSource` con `readSourceFor(adapter, sink)` y pasa `source.frameParser` a `processRawLine`; hidrata la preferencia del bastón recordado. | RBM1.1, RBM2.3, RBM5.6 |
| `permissions.ts` | `case 'ble-gatt' → { kind: 'ble' }` (nuevo modelo) y `case 'mfi-ios' → { kind: 'ios-mfi' }`. Switch exhaustivo: no compila hasta declararlos. | RBM2.13 |
| `permissions-android.ts` | ✅ **as-built F2**: `androidBluetoothPermissionsFor(apiLevel, transport)` con tabla exhaustiva por transporte (`ANDROID_BLUETOOTH_PERMISSIONS … satisfies Record<TransportKind, {modern, legacy}>`). El `transport` es **requerido y sin default** también en `ensureAndroidBluetoothPermissions` / `checkAndroidBluetoothPermissions` (→ `defaultSppEnv()` los envuelve pasando `'spp'`). Suma `hasAndroidPermissionPolicy(transport)`: los consumidores leen lista vacía como *concedido*, así que "no sé qué pedir" necesitaba su propio canal (los dos caminos asincrónicos devuelven `'unavailable'`). | RBM2.13 |
| `selection-priority.ts` | prioridad iOS; `adapterForTransport` +`ble-gatt`/+`mfi-ios`; `BindingEnv.declaredEaProtocols`; `available` de MFi. | RBM5.1–RBM5.5 |
| `driver-registry.ts` | `DRIVER_REGISTRY = [RS420_DRIVER, ESP32_GATT_DRIVER]`. | RBM5.12 |
| `driver-types.ts` | `TransportCapability` de kind `ble-gatt` gana `delimiter?` (el fin de trama es del **lector**, no del transporte — misma lección que 🟠-5 del SPP). | RBM2.8, RBM2.10 |
| `logging.ts` | + `parser_unresolved` (RBM1.4), + `ble_scan_timeout`, + `mfi_unavailable{reason}`. ✅ **as-built F3**: `ble_scan_timeout` lleva `{ms, seen}` — `seen` = cuántos devices aparecieron anunciando el servicio del driver, que es lo que separa "no hay nada a la vista" de "hay algo con ese servicio que NO es un bastón" (el bridge de la balanza). `mfi_unavailable` es de F5. ✅ **as-built F5**: `mfi_unavailable` lleva **seis** motivos y no cuatro (se sumaron `plataforma-no-ios`, `modulo-nativo-ausente` y `delimitador-no-soportado`), y su tipo se **importa** de `ea-protocols.ts` en vez de copiarse a mano — dos unions gemelos escritos a mano fue el bug que el review de F1 cazó con `RejectReason`. | RBM1.4, RBM2.5, RBM4.2 |
| `line-framer.ts` | **as-built F3 (no estaba en esta tabla)**: el delimitador estaba **hardcodeado** en `'\n'`, así que "framear con el delimitador del driver" (RBM2.8) exigía parametrizarlo. Entra por **constructor con default `'\n'`** → los dos call sites existentes no cambian (con test de regresión); multi-carácter consume el delimitador completo; un delimitador vacío cae al default en vez de colgar el bucle (`indexOf('')` = 0 para siempre) — quién RECHAZA ese driver es el adapter, antes de conectar. | RBM2.8 |
| `connect-trigger.ts` | **as-built F3 (no estaba en esta tabla)**: `LINK_DWELL_MS` se **mudó** acá desde `adapter-spp-android.ts` (que lo re-exporta para no tocar sus call sites). Es una política de la **cadena de reintentos**, igual que `UNPROMPTED_RETRY_BUDGET_MS`, y con dos transportes con radio la alternativa era duplicar el número o importarlo de un adapter hermano. | RBM3.9 |
| `adapter-ingest-mode.test.ts` | **as-built F3**: el bloque "los dos adaptadores de STREAM" pasó a tres — `ingestModeFor('ble-gatt') === 'raw-line'` va **asertado explícitamente** (el bucle exhaustivo solo exige que la fila EXISTA y sea válida, así que un `'eid'` ahí lo cazaba únicamente la suite del adapter). | RBM2.11 |
| `remembered-device.ts` | el valor pasa de `deviceId: string` a `{ deviceId, vendorId?, adapterKind? }`, **leyendo el formato viejo sin romper** (RBM5.7). Los tres call sites del `forget` y los techos de `storage` quedan intactos. | RBM5.6, RBM5.7 |
| `features/ble-stick/connection-view.ts` | ramas de vista para `ble-gatt` y `mfi` (incluido el estado "reconocido, falta el protocolo del fabricante"). | RBM5.14, RBM4.5 |
| `features/ble-stick/screens/StickConnectionScreen.tsx` | `BUILT_ADAPTERS` += `'ble-gatt'`, `'mfi-ios'`; `TransportInstructions` gana las dos ramas; lista de resultados de escaneo BLE. | RBM5.14 |
| `spp-bridge-timeout-guard.test.ts` | `BOUNDED_AT_THE_BOUNDARY` += los dos adaptadores nuevos. | RBM3.3 |
| `adapter-ingest-mode.test.ts` | + los dos kinds nuevos + el guard de que el provider delegue en `resolveFrameParser`. | RBM1.7, RBM2.11 |
| `app/app.config.ts` | ✅ **as-built F2**: plugin `['react-native-ble-plx', { isBackgroundEnabled:false, modes:[], neverForLocation:true, bluetoothAlwaysPermission: BLUETOOTH_PURPOSE }]`. Las dos opciones que el design no preveía tienen consecuencia real — ver §4 "Permisos por transporte" y la nota de `with-bluetooth-classic.js`. `UISupportedExternalAccessoryProtocols` **intacta**. | RBM2.15, RBM4.3 |
| `app/plugins/with-bluetooth-classic.js` | comentario reconciliado (`BLUETOOTH_SCAN` **sí** se usa ahora, y el tope de `ACCESS_FINE_LOCATION` sigue igual **por otro motivo**). Los permisos declarados **ya alcanzan** y la política **no cambió**. ✅ **as-built F2**: lo que el design no preveía es que el config plugin de la lib de BLE **agrega `ACCESS_COARSE_LOCATION`** —y una segunda copia de `ACCESS_FINE_LOCATION`— en el array **`uses-permission-sdk-23`**, que el `tools:node="replace"` de este plugin **no alcanza**; con `neverForLocation:true` entran topeados a `maxSdkVersion=30`, con el default de la lib entrarían **sin tope**. | RBM7.6, RBM2.13 |
| `app/plugins/with-bluetooth-classic.test.ts` | **as-built F2 (no estaba en esta tabla)**: bloque nuevo que compone las transformaciones REALES de los dos config plugins (importadas del paquete instalado) en **los dos órdenes posibles** de mods y verifica el invariante "ninguna ubicación sin tope" sobre **todos** los arrays de permisos — el test viejo miraba solo `uses-permission` y era ciego al array nuevo. Con falsificación del mundo malo. | RBM2.13, RBM2.15, RBM7.6 |
| `app/ios-purpose-strings-guard.test.ts` | `CENSUS` += `react-native-ble-plx` (nace en rojo al instalarla, a propósito). ✅ **as-built F2**: el veredicto NO va en `MODULE_VERDICTS` — sus fuentes propias no nombran CoreBluetooth (entra por el pod `MultiplatformBleAdapter`), así que el escaneo de símbolos es ciego y lo que obliga la clave es la **red por nombre**; una entrada en `MODULE_VERDICTS` sería un veredicto "fantasma". El veredicto quedó como test ejecutable. Se reconcilió además su **límite nº5** ("ningún plugin nuestro toca el `Info.plist`"), que este delta vuelve falso. | RBM2.17 |
| `app/app.config.test.ts` | **as-built F2 (no estaba en esta tabla)**: 5 tests — plugin declarado sin background en las 4 variantes, guard sobre la ausencia de `bluetooth-central` en TODA la config, `neverForLocation` presente, el purpose string del plugin idéntico al de `ios.infoPlist`, y la clave de EA declarada y vacía. | RBM2.15, RBM2.17, RBM4.3 |
| `scripts/run-tests.mjs` | registrar las 5 suites nuevas en la lista **explícita**. | todas |

### 2.3 Lo que NO se toca

- **`parser-rs420.ts`**: no se reimplementa ni se mueve. Sigue siendo el `frameParser` del `RS420_DRIVER` (R1.2, R11.4).
- **`dedup.ts`, `feedback*`, `read-dispatch.ts`, `stick.ts`, `connection-status.ts`**: el camino de la lectura confirmada no cambia.
- **`app/src/features/animals/*` y los screens de find-or-create** (spec 09): cero cambios (RBM9.6).
- **`supabase/`, `sync-streams/`**: cero cambios (RBM9.1) — ver §11.

## 3. T1 — el parser sale del registro (la cirugía)

**Estado actual, verificado**: `contract.ts:16` importa `parseRs420Line` y `:36` lo llama dentro de `ingestRawLine`. El `frameParser` del driver existe desde el multivendor pero **solo se invoca desde los tests** — la propia spec lo dejó declarado como deuda bajo RMV5.2, no como logro.

**Forma nueva** (mínima, sin inventar capas):

```ts
// contract.ts  — ya NO importa ningún parser de fabricante
export function ingestRawLine(line: string, frameParser: FrameParser): IngestResult {
  if (typeof line !== 'string' || normalizeTag(line).length === 0) return { ok: false, reason: 'empty' };
  const parsed = frameParser.parse(line);            // ← del DRIVER, no de un import
  if (parsed === null) return { ok: false, reason: 'parse_failed' };
  if (!isValidTag(parsed.eid)) return { ok: false, reason: 'invalid_eid' };
  return { ok: true, eid: parsed.eid };
}
```

`frameParser` es **parámetro requerido**: un call site que se lo olvide **no compila**. Eso es deliberado — es la misma familia de guard que `satisfies Record<AdapterKind, IngestMode>`: el mecanismo se escribe sobre la ausencia, no sobre el uso correcto.

**De dónde sale el parser en runtime** (`resolveFrameParser`, puro, en `adapter-selection.ts` — al lado de `ingestModeFor`, que es la otra mitad de la misma decisión):

```
resolveFrameParser(adapter, onUnresolved):                         # ← as-built: el sink va INYECTADO
   if ingestModeFor(adapter.kind) !== 'raw-line': return null      # 'eid' no desframea nada, en silencio
   parser = adapter.driver?.frameParser
   if parser sin `parse` función: onUnresolved(adapter.kind); return null   # fail-closed (RBM1.4)
   return parser

readSourceFor(adapter, onUnresolved) -> ReadSource:                # ← as-built F1 (corregido en el review)
   { kind: adapter.kind,                                           #   vive en adapter-selection.ts, NO en el
     mode: ingestModeFor(adapter.kind),                            #   provider: es puro y así se prueba por
     frameParser: resolveFrameParser(adapter, onUnresolved) }      #   COMPORTAMIENTO (sin ?? de ningún tipo)
```

El provider llama `processRawLine(line, parser)` solo si `parser != null`; si es `null` con modo `raw-line`, **descarta y loguea `parser_unresolved`**. Los dos adaptadores de stream ya existentes se construyen con `RS420_DRIVER` por defecto → su comportamiento no cambia (RBM1.5).

> **Reconciliación al as-built (F1, 2026-08-17)** — lo que cambió respecto del pseudocódigo original, con su motivo:
>
> 1. **`resolveFrameParser` recibe el sink del aviso inyectado y REQUERIDO** (`onUnresolved`), en vez de importar `logging.ts`. Es el patrón que el repo ya usa para esto (`acceptingTargets(subscribers, onError)`, `read-dispatch.ts`) y resuelve la tensión entre "T1.3 la pide pura" y "T1.6 pide *null + log*": con el sink inyectado, el fail-closed se verifica **por comportamiento** con un espía en `node:test`, en vez de por un regex sobre el provider. Requerido y no opcional-con-no-op: un call site que se olvide del sink perdería la única señal de que el transporte montado no puede parsear nada.
> 2. **Un `frameParser` presente pero sin `parse` función también cae del lado del descarte.** Un driver a medio escribir no puede tirar `parse is not a function` adentro del read-loop del transporte.
> 3. **El evento tiene DOS momentos**: `{kind:'parser_unresolved', adapter, at:'mount'|'read'}`. `mount` = se montó un transporte que no puede parsear nada (una vez, error de cableado); `read` = se descartó una lectura concreta (por bastonazo, y es el que hace diagnosticable "bastoneo y no pasa nada"). El guard exige los dos por separado: con un solo `includes('parser_unresolved')`, borrar el de lectura dejaba el guard verde y el síntoma invisible.
> 4. **El parser se resuelve en el efecto de wiring del provider**, no adentro de `handleReading`, y viaja hasta el contrato en un `ReadSource {kind, mode, frameParser}`. Motivo duro: el camino caliente tiene una tabla CERRADA de invocables (`HOT_PATH_CALLABLE` en `read-dispatch.test.ts`) y el parser no cambia entre lecturas — es una propiedad del transporte montado.
>    **Corrección del review de F1 (🔴-1)**: `ReadSource` y `readSourceFor(adapter, onUnresolved)` **viven en `adapter-selection.ts`**, no en el provider. Nacieron adentro del provider y ahí eran INVERIFICABLES: `BleStickListenerProvider.tsx` importa `react-native`, así que ninguna suite `node:test` puede importarlo y su único oráculo posible era un regex sobre el fuente. El reviewer lo falsificó con `resolveFrameParser(...) ?? DRIVER_REGISTRY[0].frameParser` — el fallback silencioso que RBM1.4 prohíbe, escrito sin nombrar `parseRs420Line` ni `RS420_DRIVER` — y **las suites quedaron todas en verde**. La función es pura (`kind` + `ingestModeFor` + `resolveFrameParser` + el sink inyectado), así que se mudó a la capa pura y se ejerce **por comportamiento** (identidad del parser · `null` + aviso en el fail-closed · silencio en los kinds `'eid'`) en `frame-parser-resolve.test.ts`. El provider queda con una sola responsabilidad: **pedir** su `ReadSource` y pasarle el sink del log.
> 5. **`contract.ts` envuelve el `frameParser.parse(...)` en `try/catch`** y valida la forma devuelta. El parser de un driver de tercero es código que no controlamos y el read-loop del transporte **no atrapa** (`SppAndroidAdapter.emitTag`): un throw suyo mataba la ingesta hasta reconectar.
>    **Corrección del review de F1 (🟡-2)**: el throw se rechaza con motivo PROPIO — `RejectReason` += `'parser_threw'`, distinto de `'parse_failed'`. Son dos fallas con dos causas y dos acciones: `parse_failed` = el parser corrió y dijo "esta trama no es de mi formato" (mirar el LECTOR / su configuración); `parser_threw` = el `parse` del driver explotó o no era invocable (arreglar el DRIVER). Con un lector nuevo ésa es justo la pregunta que importa, y con un solo motivo los dos casos producían un log byte-idéntico. Un `parse` que devuelve `undefined` o un objeto sin `eid` **se queda en `parse_failed`**: caerse del final de una función sin `return` es la forma descuidada de escribir "no match" en JS y no se distingue de la intención; un throw nunca es "no match". `logging.ts` deja de recopiar el union a mano y usa `import type { RejectReason }` del contrato — con la copia, un motivo nuevo se agregaba de un lado y se perdía del otro sin que nada se pusiera rojo (verificado: con el union recopiado, el typecheck cae en los dos call sites).
> 6. **Había un segundo call site de `processRawLine` que este design no nombraba**: `app/app/baston-test.tsx` (el harness web-serial). Lo enumeró el typecheck (T1.9) y se migró por el mismo camino (`resolveFrameParser` + descarte con log), para que el harness no tenga una regla propia.
> 7. **`SppAndroidAdapter` ya tenía el driver**: era `private readonly driver = RS420_DRIVER` desde RMV5.2; T1.4 solo lo hizo público de solo lectura. En `WebSerialAdapter` el driver entró como **segundo** parámetro del constructor (el `baudRate` queda primero → los call sites existentes no cambian).

**Guards, y cómo se falsifican** (RBM1.7 — un guard que no se probó rompiendo lo que vigila no prueba nada):

| Guard | Mutante que tiene que ponerlo en rojo |
|---|---|
| `contract.ts` no importa ni menciona un parser de fabricante | volver a poner `import { parseRs420Line }` y llamarlo |
| el provider delega (`readSourceFor`) y no fabrica ni parser ni `ReadSource` | reemplazarlo por `parseRs420Line` inline; re-armar el `ReadSource` con `?? DRIVER_REGISTRY[0].frameParser`; o con un parser escrito **a mano** (los tres caen, ver la tabla de mutantes del informe) |
| `readSourceFor` compone modo + parser sin fallback (**oráculo de comportamiento**, no regex) | `resolveFrameParser(...) ?? <cualquier parser>`; fijar `mode: 'raw-line'`; tragarse el sink del aviso |
| `resolveFrameParser` es fail-closed | hacerlo caer a `RS420_DRIVER.frameParser` cuando no hay driver |
| aditividad real (RBM1.6) | un driver sintético con otro formato de trama se ingiere end-to-end; si alguien vuelve el parser a `contract.ts`, este test **sigue en verde** — por eso hacen falta los tres de arriba **además** de éste |

> Ese último renglón es el que importa: el test de aditividad **no distingue** el bug del arreglo por sí solo (es la cuarta repetición del verde mentiroso que esta feature ya se comió). El oráculo que sí distingue es el guard estático sobre `contract.ts`.

> **Medido (as-built F1, 2026-08-17)** — 7 mutantes corridos, tabla completa en `progress/impl_ios-ble-mfi-f1.md`. La afirmación de arriba se verificó y se precisa: con el mutante del **provider** (parser inline) el test de aditividad queda en **verde junto con las 11 de su archivo**; con el **fallback** dentro de `contract.ts` el único rojo es el **guard estático**. La versión BURDA (el contrato ignora el parámetro y llama `parseRs420Line`) **sí** la mata la aditividad — se deja anotado para no vender el guard como más necesario de lo que es. Se agregaron tres mutantes que el design no listaba y que el guard también tiene que matar: el provider usando `RS420_DRIVER.frameParser` (fija el fabricante **sin nombrar el parser**), borrar el log del descarte **por lectura**, y darle un **default** al `frameParser` en el contrato (los call sites dejan de romper el typecheck).
>
> **Corregido tras el review de F1 (2026-08-17)** — la fila del provider **no se sostenía**: el guard prohibía **tres grafías** (`parseRs420Line`, importar un `./parser-*`, `RS420_DRIVER`) y el mutante `?? DRIVER_REGISTRY[0].frameParser` pasaba por el costado, en verde. Un guard que enumera los nombres de hoy no vigila un invariante. Lo que se cambió:
> 1. el oráculo que manda ahora es **de comportamiento** (`readSourceFor` en la capa pura, con aserciones de **identidad**);
> 2. el guard estático se reescribió **sobre la ausencia**: deriva del árbol los módulos de fabricante (`parser-*.ts` y `driver-*.ts` salvo `driver-types.ts`) y prohíbe, en **`BleStickListenerProvider.tsx` y `adapter-selection.ts`**, mencionar cualquiera de sus exports **e importar de ellos por cualquier vía** (mata también el `import * as`). Un `HR5_DRIVER` futuro cae sin que nadie actualice el guard. El mismo extractor extendido se aplica al guard de `contract.ts` (el reviewer mostró que un fallback vía `driver-rs420.ts` no nombraba ningún `parser-*`);
> 3. el provider tiene prohibido **fabricar** un parser o un `ReadSource` (`frameParser:` / `parse:` como propiedad): sin eso, el fallback se puede escribir a mano (`?? { parse: (raw) => ({ eid: raw.slice(7, 22) }) }`) sin nombrar a ningún fabricante, y ningún guard de nombres lo ve. Lo que se decide dentro del provider solo se puede vigilar por regex — así que la decisión no se toma ahí.

## 4. T2 — `adapter-ble-gatt` (el transporte nuevo)

**Librería**: `react-native-ble-plx` (dep nueva, RBM2.18 la veta antes). **Un solo código para iOS y Android** (RBM2.1).

> ### ⚠️ Heredado de F1: el `ReadSource` se resuelve AL CABLEAR, y eso obliga al adapter BLE
>
> El provider resuelve `readSourceFor(adapter, sink)` **una vez por adaptador cableado** (efecto de wiring), no por bastonazo. Hoy eso es correcto **porque el `driver` es inmutable por instancia de adapter**: es `readonly` y entra por constructor (`adapter-spp-android.ts`, `adapter-web-serial.ts`), y TS lo hace cumplir. El reviewer de F1 lo verificó y dejó la consecuencia escrita para acá (⚪-3 de `progress/review_ios-ble-mfi-f1.md`).
>
> **El adapter BLE rompe ese supuesto si no se lo diseña con cuidado**: conoce su `ReaderDriver` recién cuando el operario **elige el device en el escaneo** (`findDriverForDevice`). Si esa elección **muta** el adapter ya montado en vez de forzar una **instancia nueva** (y por lo tanto un re-cableado del efecto), el `ReadSource` queda con el parser viejo —`null`, si al montar no había driver— y el transporte nuevo **nace mudo**: conecta, recibe tramas, y no ingiere ni una. Es el síntoma de siempre (0 lecturas, 0 errores) y hoy **no lo guarda nada**.
>
> Dos formas válidas de cerrarlo, a elegir en F3 y a dejar escrita:
> (a) el `driver` sigue siendo `readonly` y elegir un device **construye un adapter nuevo** (el efecto de wiring re-corre porque cambia la identidad del transporte); o
> (b) el adapter expone el driver de forma mutable y el provider **re-resuelve el `ReadSource`** ante ese cambio — lo que exige una señal observable (no alcanza con reasignar el campo) y un test que la ejerza.
> La opción (a) es la que no agrega estado nuevo y la que ya cumple el tipo. Cualquiera sea, **T3 tiene que traer el test que lo fija**: montar el adapter sin driver, elegir un device, y verificar que la lectura siguiente se ingiere con el parser de ESE driver.

**Flujo de `connect(deviceId?)`** — cada paso es un estado observable, ninguno bloquea la carga manual. `gen` es la generación del intento; todo `await` marcado `⏱` tiene presupuesto (`bridge-timeout.ts`). La forma es deliberadamente **la del `adapter-spp-android` as-built**, porque ese flujo ya pagó tres 🔴 en device:

```
   if latch tomado: encolar el target si es OTRO (log connect_superseded) y salir     # RBM3.7
   gen = ++connectGeneration ; latch = gen
0. cancelReconnect() ; await teardown()
1. params = resolveBleGattParams(driver)          # serviceUuid / notifyCharUuid / delimiter
   if !bleGattDelimiterIsSupported(params.delimiter): => 'disconnected' + log          # RBM2.10
2. manager = loadBleManager()                     # require PEREZOSO (RBM2.2)
   if !manager: => 'disconnected'                 # sin binario en el build: NO se reintenta  RBM2.3
3. ⏱ perm = await (auto ? checkPerms : ensurePerms)(transport:'ble-gatt')              # RBM2.13, RBM3.8
   'denied' => 'permission_denied' (CTA, sin backoff)                                  # RBM2.14
4. ⏱ target = deviceId ?? await readRememberedDevice()
   if !target: => 'scanning' + scanFiltered(params.serviceUuid, budget)                # RBM2.4, RBM2.5
5. => 'connecting'
6. ⏱ device = await manager.connectToDevice(target, {timeout})
   if gen viejo: cancelar la conexión que llegó tarde y salir sin tocar el estado
7. ⏱ await device.discoverAllServicesAndCharacteristics()
8. device.monitorCharacteristicForService(serviceUuid, notifyCharUuid, (err, c) => {
        if err → read_loop_error ; return
        const text = decodeBase64Ascii(c.value)        # base64 → bytes → 1 byte = 1 char  RBM2.7
        for (line of framer.push(text)) onTagRead(line)   # LineFramer, delimitador del driver RBM2.8/2.9
   })
9. sub = device.onDisconnected(handler)          # ← SUSCRIPCIÓN POR DEVICE, no global    RBM3.4
10. armLivenessProbe() + armWatchdog()           # 2ª fuente de verdad + mudez            RBM3.5, RBM3.10
11. => 'connected' ; writeRememberedDevice({deviceId, vendorId, adapterKind:'ble-gatt'})
```

> ### ✅ as-built F3 (2026-08-17) — en qué se APARTA este flujo de lo que se construyó
>
> El informe completo está en `progress/impl_ios-ble-mfi-f3.md`. Cuatro diferencias que cambian el flujo de
> arriba y una que hay que leer como límite:
>
> 1. **Falta un paso: LA RADIO.** Entre el permiso (3) y el device (4) el as-built **consulta**
>    `manager.state()`, y **nunca llama `manager.enable()`** — decisión explícita: en iOS esa API no existe
>    (la única salida es Ajustes), así que un camino que dependa de ella sería Android-only en un transporte
>    que se declara cross-platform (RBM2.1); además está deprecada desde API 33 y falla en silencio; y no
>    pedirla es la forma más simple de cumplir RBM3.8 sin depender de acertar el trigger. Tres desenlaces
>    distintos, no uno: `Unauthorized` → `permission_denied` (en iOS ESE es el permiso denegado: CTA, sin
>    backoff), `Unsupported` → `disconnected` **sin** reintento, `PoweredOff`/`Resetting`/ilegible →
>    `disconnected` **con** reintento (puede cambiar solo). Con un gesto del operario, un estado **ilegible**
>    (el puente no contestó) se trata como `PoweredOn` y se sigue: el error real del connect es mejor
>    diagnóstico que un "prendé el Bluetooth" inventado sobre una radio que no pudimos leer. En `autoConnect`
>    es al revés (ante la duda no se toca la radio: nadie pidió nada).
> 2. **El techo del escaneo es DOBLE** (paso 4): adentro su presupuesto (`schedule(..., 'scan')`, el que
>    produce el `ble_scan_timeout` con su diagnóstico) y afuera un `withTimeoutOr('scan_for_target')`, para
>    que ni un timer que no llega ni un `startDeviceScan` que no se asienta puedan dejar el **latch** tomado.
>    Y el escaneo **no se cierra con el primer resultado**: un device que el `deviceMatch` no reconoce se
>    cuenta, se loguea (`ble_device_not_recognized`) y se sigue buscando.
> 3. **Hay una GENERACIÓN DE SESIÓN además de la del intento**, por una trampa propia de esta lib:
>    `subscription.remove()` de un monitor hace `cancelTransaction`, lo que **rechaza la promesa del
>    monitor**, y la lib traduce ese rechazo en `listener(error, null)` → **nuestro propio teardown dispara
>    el handler de error de lectura**. Sin mirar la sesión, un `disconnect()` del operario terminaría
>    RECONECTANDO. `teardownStreams()` bumpea la sesión ANTES de remover suscripciones.
> 4. **El framer vive en la clausura de la sesión** (paso 8), no en un campo del adapter: un buffer a medio
>    llenar de un link caído no puede pegarse con la primera trama del siguiente (el arrastre del banco §4.4
>    del SPP).
> 5. **La superficie modelada de `BleManagerLike` NO declara `cancelDeviceConnection(id)`** (fix-loop del
>    review 🟡-3). Estaba declarada y sin un solo call site de producción, que es la clase de pieza muerta que
>    parece cableada. Y no se saca solo por prolijidad: cerrar el link **por id** —en vez de por el objeto
>    `device` que abrió ESTE intento— es exactamente el bug que `canCloseOrphanLink` existe para evitar (un
>    intento vencido le mata el link al que conectó después, y la app queda diciendo "conectado" sobre un link
>    muerto: el síntoma de BENCH-1 producido por la limpieza). Con la firma fuera del modelo, un call site
>    nuevo **no compila**: la ausencia es el guard, más fuerte que el contador que el doble llevaba y que
>    ningún test asertaba.
> 6. ⚠️ **Lo que F3 NO hace, dicho para que no se lea como hecho**: el transporte **no es alcanzable en
>    producción**. `selectTransportAdapter` no devuelve `'ble-gatt'` y `adapterForTransport('ble-gatt')` sigue
>    en `null` (las dos cosas son **F4**), y `isBleGattTransportAvailable()` exige además que algún driver del
>    registro declare `ble-gatt` — que también entra en F4. El `case` del provider está escrito y probado,
>    pero hoy nada lo elige.
> 7. **(F4, fix-loop del review 🟠-1)** El paso 2 del flujo (`loadBleManager()`) es lo que **construye** el
>    client de la lib, y en iOS eso crea el `CBCentralManager` → **es el primer uso de la radio**, el que
>    dispara el diálogo del SO. Por eso el borde se partió en dos (`BleModuleEnv`:
>    `nativeModulePresent()` consulta / `constructManager()` construye) y **la disponibilidad del transporte
>    solo consulta**: con las dos cosas juntas, `instantiateTransport` —o sea el primer render del provider—
>    tocaba la radio sin un gesto (RBM3.8 incumplido en iOS, ver su nota de reconciliación). El paso 2 y el
>    `autoConnect` después de su gate de bastón recordado son los únicos que construyen.

**Las decisiones que no son obvias, con su motivo:**

- **`decodeBase64Ascii` y no `TextDecoder('utf-8')`.** `react-native-ble-plx` entrega el valor de la característica en **base64**. La trama del RS420 arranca con `STX` (`0x02`) y el emulador la reproduce byte por byte; decodificar como UTF-8 rompería cualquier byte ≥ `0x80` de un lector futuro y volvería el bug invisible (el `normalizeTag` del contrato limpia los control chars **después**, así que el síntoma sería "parse_failed intermitente"). Se decodifica **un byte = un carácter**.
- **`LineFramer` SÍ acá, a diferencia del SPP.** En SPP el framing lo hace el nativo (`DelimitedStringDeviceConnectionImpl`) y meter `LineFramer` encima devolvía `[]` para siempre — el bug que costó "cero lecturas". En GATT **no hay** framing nativo: las notificaciones son trozos de ≤ MTU−3 bytes, y el propio emulador parte la trama a propósito. Acá `LineFramer` es exactamente la pieza correcta y su reuso es el requisito (RBM2.8).
- **El delimitador sale del driver.** Misma lección que 🟠-5: un lector que termine en CR dejaría la app *conectada, muda, sin un error ni un log*. Un delimitador vacío **corta la conexión con log** en vez de abrirla (RBM2.10).
- **Escaneo filtrado y acotado.** Filtrado por `serviceUuid` (RBM2.4) porque un escaneo abierto en la manga es batería y ruido; acotado (RBM2.5) porque un escaneo que nadie apaga es el equivalente BLE del latch eterno.
- **MTU**: en Android se puede pedir MTU alto, pero el adapter **no depende** de que se conceda (RBM2.12): el banco corre con `chunk 20` (MTU por defecto) **y** con `chunk 0` (trama entera) y debe dar lo mismo (RBM6.3).
- **Sin background** (RBM2.15): ni `UIBackgroundModes` ni el modo background del plugin. R6.9 dice foreground-only, y declarar background en iOS además arrastra escrutinio de App Review por una capacidad que no usamos.
  - ✅ **as-built F2**: en el plugin son **dos** opciones distintas y las dos van apagadas explícitas — `modes: []` (lo que escribiría `UIBackgroundModes: ['bluetooth-central']` en iOS) e `isBackgroundEnabled: false` (lo que agregaría `<uses-feature android.hardware.bluetooth_le required="true">` en Android, que además excluye de Play a los devices sin BLE). Verificado en el plist introspectado (`UIBackgroundModes` sigue siendo `['remote-notification']`) y en el manifiesto **mergeado** del APK (sin `uses-feature`).

**Permisos por transporte** (RBM2.13) — `androidBluetoothPermissionsFor(apiLevel, transport)`:

| transporte | API ≥ 31 | API ≤ 30 |
|---|---|---|
| `spp` (as-built, sin cambios) | `BLUETOOTH_CONNECT` | `[]` (no hace discovery: lista emparejados) |
| `ble-gatt` | `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` | `ACCESS_FINE_LOCATION` (el escaneo BLE lo exige) |
| `serial` / `ble-hid` / `mfi` (**as-built F2**: la tabla es exhaustiva, así que también se declaran) | `[]` | `[]` |

`serial` es Web Serial (navegador, sin modelo de permisos de Android), `ble-hid` es un teclado que el SO ya emparejó, y `mfi` no existe en Android. Los tres van con **conjunto vacío declarado y motivo escrito**, no ausentes.

El manifiesto **ya declara los cuatro** con los atributos correctos (`with-bluetooth-classic.js`): `BLUETOOTH_SCAN` con `neverForLocation` y `ACCESS_FINE_LOCATION` topeado a `maxSdkVersion=30`, que es justo donde el escaneo BLE lo necesita. O sea: **no hace falta cambiar la política de permisos, hace falta pedirlos**. Lo que sí cambia es el comentario que decía que `BLUETOOTH_SCAN` era para un futuro (RBM7.6). La tabla es exhaustiva por `TransportKind` (`satisfies`) → un transporte nuevo no compila hasta declarar su conjunto.

> ✅ **as-built F2 — lo que este párrafo no preveía, medido contra el manifiesto MERGEADO del APK.** "No hace falta cambiar la política" quedó **confirmado**, pero la política tenía un agujero que no era visible desde acá: el **config plugin de `react-native-ble-plx`** agrega `ACCESS_COARSE_LOCATION` y una segunda copia de `ACCESS_FINE_LOCATION` en el array **`uses-permission-sdk-23`** — otro array que el `tools:node="replace"` de `with-bluetooth-classic.js` **no toca**. Con el **default** de la lib (`neverForLocation: false`) los dos entran **SIN tope de API**, o sea la app pasaría a pedir ubicación en Android 12+: exactamente lo que ese plugin existe para evitar. Se resolvió **en la config, no en la política**: `neverForLocation: true`. Verificado en el manifiesto mergeado del build de T2.8 (los dos capados a 30, `BLUETOOTH_SCAN` con `neverForLocation` y sin tope, ningún `uses-feature`) y falsificado en `with-bluetooth-classic.test.ts` (el mundo malo produce **dos** permisos de ubicación sin tope).
>
> **Nota de implementación para F3** (sale del mismo lugar): en API ≤ 30 el escaneo BLE además exige que el **servicio de ubicación del teléfono esté prendido**. No es un permiso de app, así que `permissions-android.ts` no lo puede resolver: es un estado que el adapter tiene que reflejar (y un escenario del banco de F6).
>
> ✅ **as-built F3 — NO se implementó, y el motivo importa**: `react-native-ble-plx` **no expone** el estado
> del servicio de ubicación (su `state()` es el de la radio: `PoweredOn`/`PoweredOff`/`Unauthorized`/…), y
> leerlo exigiría una dependencia nativa nueva —que es justo lo que este delta no va a agregar por un caso de
> API ≤ 30—. Lo que el adapter **sí** hace es dejarlo **diagnosticable en vez de invisible**: con la ubicación
> apagada el escaneo no devuelve nada y eso sale como `ble_scan_timeout {ms, seen:0}`, que es el mismo log que
> "el bastón está apagado o fuera de rango" pero **distinto** de `seen:>0` ("hay algo con ese servicio que no
> es un bastón"). O sea: se distingue de la otra causa, no del bastón apagado. Queda como **escenario del
> banco de F6** en Android ≤ 30 y como **recomendación al leader** para `docs/backlog.md` (el archivo lo está
> tocando la otra terminal, así que esta fase no lo edita).

## 5. T3 — `adapter-mfi-ios` y su gate

**Sin dependencia nueva**: es la rama iOS de `react-native-bluetooth-classic` (`ios/conn/*.swift`, `device/NativeDevice.swift`), que ya está instalada.

**El gate, en una función pura** (`ea-protocols.ts`):

```
declaredEaProtocols(): string[]
   = Constants.expoConfig?.ios?.infoPlist?.UISupportedExternalAccessoryProtocols ?? []   (require perezoso, try/catch)

mfiAvailability(driver, declared):
   cap = driver.transports.find(t => t.kind === 'mfi')
   if !cap                       → { available:false, reason:'driver-sin-mfi' }
   if declared.length === 0      → { available:false, reason:'build-sin-protocolos' }
   if !declared.includes(cap.params.protocolString)
                                 → { available:false, reason:'protocolo-no-declarado' }
   return { available:true }
```

- **Con la lista vacía, el adapter no toca nada** (RBM4.2): `connect()` corta en el primer `if`, **antes** de cualquier `require` de la lib y antes de leer `NativeModules`. No es paranoia: leer ese global **instancia** el módulo nativo en bridgeless, y el `init()` de esa lib hace un force-cast `as! [String]` sobre esta misma clave. Hoy la clave existe (vacía) y por eso no trapea — el requisito de no tocarlo se sostiene igual.
- **La clave vacía NO se saca nunca** (RBM4.3). Ya hay un guard que lo verifica (`ios-purpose-strings-guard.test.ts`, *"GUARD: `UISupportedExternalAccessoryProtocols` está DECLARADA (vacía vale)"*) con su auto-verificación de que el force-cast sigue en el fuente instalado. Este delta **no lo debilita**: lo hereda.
- **El día que llegue la cadena** el diff es: una línea en `app.config.ts` (el string real del fabricante) + una `TransportCapability` `{ kind:'mfi', params:{ protocolString } }` en el driver correspondiente. **Cero código** — y hay un test que lo demuestra con una cadena sintética inyectada (RBM4.7). Eso es lo que quiere decir "prearmado".
- **RS420 no declara `mfi` todavía** (RBM4.6): sin el dato del fabricante, declararlo sería inventar. Su binding en iOS sigue siendo `null` → carga manual como piso, igual que hoy.
- **Antes de escribir el adapter** hay que leer el Swift instalado y confirmar qué expone la rama iOS a JS (RBM4.8). Si no expone lo necesario → **parar y reportar**, no escribir un adapter que no puede funcionar. Es literal lo que pasó en el SPP cuando el diseño se moldeó sobre el README.

### 5.1 As-built (F5, 2026-08-17) — cómo quedó construido de verdad

**Veredicto de RBM4.8: la rama iOS ALCANZA.** `getBondedDevices()` lista los accesorios prendidos con sus
`protocolStrings`, `connectToDevice(id, options)` abre la `EASession` cruzando el plist con el accesorio, y el
stream llega por el evento `DEVICE_READ@<serialNumber>` (`device.onDataReceived`). Con eso la pregunta abierta
nº1 del delta queda cerrada.

**Piezas y dónde vive cada decisión** (el adapter hace SOLO I/O; todo lo que es protocolo se testea sin device):

```
ea-protocols.ts (PURO)                        adapter-mfi-ios.ts (I/O)
──────────────────────────────                ────────────────────────────────────────────
declaredEaProtocols / …FromExpoConfig  ←─┐    MfiModuleEnv  = platformIsIos / nativeModulePresent / loadNative
mfiAvailability(driver, declared)        │    MfiEnv        = loadNative / declaredProtocols / storage /
resolveMfiParams(driver)                 │                    foreground / schedule / onForeground / now / timeouts
mfiDelimiterIsSupported                  ├──  isMfiTransportAvailable(registry, declared)  ← lo consultan
mfiConnectOptions(delimiter)             │      instantiateTransport y TRANSPORT_INSTALLABLE
normalizeMfiAccessories / pickMfi…       │    MfiIosAdapter.resolveGate()  (el gate, PURO, un solo lugar)
mfiProtocolStringsOf  (hallazgo 7)     ──┘    MfiIosAdapter  connect / autoConnect / disconnect / enable / disable
classifyMfiConnectError / MFI_CONNECT_RETRY
```

**El ORDEN de los chequeos es el requisito** (RBM4.2), y es distinto del del BLE a propósito: acá el chequeo
del módulo va **último** porque leer `NativeModules.RNBluetoothClassic` lo **instancia** (y en iOS cada método
del nativo pasa por un `CBCentralManager` lazy que puede disparar el diálogo del SO):

```
1. ¿iOS?                                   Platform.OS      — no instancia nada
2. ¿algún lector del registro declara mfi?  puro             — hoy NINGUNO (RBM4.6)
3. ¿el build declara SU cadena?             Constants.expoConfig — hoy la lista está VACÍA → SE CORTA ACÁ
4. ¿el fin de trama es frameable en iOS?    puro (1 carácter ASCII)
5. ¿el binario está en este build?          NativeModules    — recién acá se toca el nativo
```

**Seis motivos de `mfi_unavailable`, no cuatro**: los tres del gate de datos (`driver-sin-mfi`,
`build-sin-protocolos`, `protocolo-no-declarado`) + `delimitador-no-soportado` (hallazgo 3) +
`plataforma-no-ios` + `modulo-nativo-ausente`. Van por separado porque desde la UI se ven idénticos (nada) y
mandan a lugares distintos: al fabricante, a `app.config.ts`, al registro de drivers o al build.

**Diferencias con el diseño de arriba, que salieron de leer el código instalado** (las siete completas están en
la cabecera de `adapter-mfi-ios.ts`; la que importa para el diseño es la última):

| # | Hallazgo | Qué cambió en la forma |
|---|---|---|
| 1 | En iOS **no hay descubrimiento** (`startDiscovery` → `Method not implemented`) | el adapter LISTA y filtra por `protocolString`; el emparejamiento lo hace el Accessory Picker del SO |
| 2 | **El framing lo hace el nativo** (mensajes ya delimitados, sin terminador) | NO se usa `LineFramer` (usarlo daría cero lecturas para siempre); `splitSppPayload` solo separa defensivamente |
| 3 | El `read()` nativo consume el delimitador con `index(after:)` (avanza **uno**) | el terminador tiene que ser de **1 carácter ASCII**; `\r\n` se **rechaza antes de conectar**. En Android sí funciona → los dos chequeos NO se unifican (test diferencial) |
| 4 | `charset` se force-castea a `CFStringEncoding` | `mfiConnectOptions()` propio, **sin** `charset` ni `read_size`; reusar `sppConnectOptions()` **crashea la app** (guard estático) |
| 5 | `available()`: bucle infinito + el selector del `.m` no es el que implementa el Swift | la firma **no existe** en `MfiNative` (una llamada nueva no compila) + guard estático |
| 6 | Todo método del nativo usa un `CBCentralManager` **lazy** | el arranque en frío no toca el nativo; el oráculo CUENTA los toques (0, con control positivo) |
| 7 | **El wrapper JS (`BluetoothDevice`) no copia `protocolStrings`** — la deja en su privado `_nativeDevice` | `mfiProtocolStringsOf` acepta las **dos** formas. Sin esto, TODO accesorio sale con `protocolStrings: []` → `pickMfiAccessory` = `null` SIEMPRE → `mfi_accessory_not_found` para siempre, o sea **RBM4.7 falso** el día que llegue la cadena, en silencio. Guard **derivado del paquete instalado** para que un `pnpm update` que cambie la forma nazca en rojo |

**Las lecciones del SPP (RBM3) están escritas desde el día uno**, no "para cuando se destrabe", porque RBM4.7
exige que ese día no haya código nuevo: presupuesto en todo await del puente (declarado en `RADIO_ADAPTERS` del
guard de F3), latch con generación liberado en `finally` y en `disconnect()`, socket huérfano
(`canCloseOrphanSocket`), **desconexión filtrada por nuestra dirección** (en iOS el evento es GLOBAL: lo
alimenta el observer de `.EAAccessoryDidDisconnect`), segunda fuente de verdad del liveness (poll + foreground)
fail-closed, foreground chequeado AL DISPARAR, tope de la cadena sin gesto **dos veces y con dos oráculos**,
dwell del backoff y watchdog de mudez (`connected_silent`).

**Lo que este diseño NO puede verificar, dicho**: no hay banco posible para MFi (hace falta un lector con
licencia MFi **y** la cadena del fabricante), así que el transporte queda **prearmado, no verificado en
device** — a diferencia del SPP (banco del 2026-07-30) y del BLE (banco de F6). Y hay un riesgo específico de
esta rama que ningún unit cierra: el `sendEvent` del nativo emite por `RCTBridge` (bajo bridgeless,
`RCTBridgeProxy`); si esa vía no estuviera cableada, las lecturas no llegarían a JS. El síntoma sería
"conectado y mudo", que el adapter deja **escrito** en vez de dejarlo invisible.

## 6. T4 — selección, prioridad y qué transporte se monta

### 6.1 La tabla

```
platformTransportPriority(os):
  ios     → ['mfi', 'ble-gatt', 'ble-hid']      # CAMBIA (era ['ble-hid','ble-gatt','mfi'])
  android → ['spp', 'ble-gatt', 'ble-hid']      # sin cambios
  web     → ['serial']                          # sin cambios
  otro    → []

adapterForTransport(kind, os):
  spp      + android → 'spp-android'
  serial   + web     → 'web-serial'
  ble-gatt           → 'ble-gatt'               # NUEVO — iOS y Android
  mfi      + ios     → 'mfi-ios'                # NUEVO — solo iOS
  ble-hid            → 'hid-wedge'              # GATED hasta RBM8
  resto              → null
```

`available` deja de ser solo `builtAdapters.includes(ak)`: para `mfi-ios` es `built ∧ mfiAvailability(driver, declaredEaProtocols).available` (RBM5.5). La lista declarada entra **inyectada** en `BindingEnv` → sigue siendo lógica pura testeable sin device (RMV2.6).

**(as-built F4, 2026-08-17)** Tres precisiones que la implementación fijó y que esta sección no decía:

- **El orden del chequeo es "construido primero"**: si `mfi-ios` no está en `builtAdapters`, el estado del plist es irrelevante y el motivo honesto es `adapter-no-construido` (decir "falta el protocolo" mandaría a buscar el dato equivocado). Con las dos mitades falsas, gana igual el primero.
- **`unavailableReason` viaja en TODOS los bindings no disponibles**, no solo en los de MFi (los demás: `adapter-no-construido`). El motivo largo está en la nota de reconciliación de RBM4.5; en la tabla de abajo eso significa que las filas `available:false` traen además su `unavailableReason`.
- **La lista declarada se lee por una función aparte** (`eaProtocolsFromExpoConfig`, exportada) y no inline adentro del `require`: es lo que permite ejercitar **la ruta** `ios.infoPlist[KEY]` contra la config REAL de la app en `node:test`, agregándole la cadena sintética. Sin eso, mover la clave en `app.config.ts` (o leer otra rama acá) dejaría la lista en `[]` **para siempre** —incluso el día que llegue la cadena del fabricante— y RBM4.7 sería falso sin que nada se pusiera rojo. Los dos mutantes (mover la clave / mover la ruta del lector) **mueren**.

**Casos que la tabla de tests tiene que fijar:**

| driver | plataforma | binding |
|---|---|---|
| RS420 (spp+serial) | ios | `null` → carga manual (no cambia; su vía real es MFi cuando llegue la cadena) |
| RS420 | android | `{spp-android, spp, available:true}` (regresión) |
| RS420 | web | `{web-serial, serial, available:true}` (regresión) |
| RS420 **+ mfi sintético**, build **sin** protocolos | ios | `{mfi-ios, mfi, available:false, reason:'build-sin-protocolos'}` |
| RS420 **+ mfi sintético**, build **con** esa cadena | ios | `{mfi-ios, mfi, available:true}` ← el test de RBM4.7 |
| emulador GATT (ble-gatt) | ios | `{ble-gatt, ble-gatt, available:true}` |
| emulador GATT | android | `{ble-gatt, ble-gatt, available:true}` |
| driver HID genérico | ios | `{hid-wedge, ble-hid, available:false, reason:'adapter-no-construido'}` mientras el gate no pase |
| driver ble-gatt+mfi, build con protocolo | ios | `mfi` gana (prioridad), determinístico |

**(as-built F4)** Las nueve filas están en un solo test data-driven (`selection-priority.test.ts`, *"la tabla del design §6.1, fila por fila"*), con el `driver` del binding aserrado **por identidad** (más fuerte que un `deepEqual`: caza un binding que devuelva el driver de otro). Se agregaron dos oráculos que la tabla sola no da:

- **El orden de declaración de los transportes del driver no cambia el resultado** (RMV2.8/RBM5.8): la última fila se corre con `[ble-gatt, mfi]` y con `[mfi, ble-gatt]` → `mfi` en las dos. Es el mutante interesante de este motor (recorrer `driver.transports` en vez de la tabla de prioridad), y sin el segundo orden el fixture no puede verlo. Con anti-vacuidad: el fixture declara el transporte de MENOR prioridad primero.
- **`emulador GATT | web → null`** (RMV2.5): el driver del banco declara solo `ble-gatt`, que en web no mapea → carga manual como piso.

### 6.2 El transporte que se monta sigue al bastón recordado (RBM5.6)

**El problema real**: `selectTransportAdapter` elige el piso **por plataforma**. En Android eso es siempre `spp-android`. Con el adapter BLE escrito y el usuario con un HR5 v3, el transporte que la app monta sigue siendo el del RS420 → **el BLE queda inalcanzable en producción en Android**, que es donde está el productor argentino. Y el banco de RBM6 en Android tampoco podría correr el camino real.

**La forma**: `SelectionEnv` gana `preferredAdapter?: AdapterKind`, que el provider hidrata del bastón recordado.

```
selectTransportAdapter(env):
  if mode==='mock'   → 'mock'        # sin cambios
  if mode==='demo'   → 'simulator'   # sin cambios
  if mode==='manual' → 'manual'      # sin cambios
  if env.preferredAdapter && esUsableEn(env.preferredAdapter, env.platformOS)
                     → env.preferredAdapter          # ← NUEVO
  if web → 'web-serial' ; if android → 'spp-android' ; if ios → 'ble-gatt' ; resto → 'manual'
```

- El `mode` se chequea **antes** de la preferencia → las ~70 specs E2E (que corren en `mock`) tienen **cero** riesgo, igual que cuando entró `autoConnect`.
- `remembered-device.ts` pasa a guardar `{ deviceId, vendorId?, adapterKind? }`. Un valor viejo (string pelado) se lee como "sin preferencia" (RBM5.7) → nadie queda sin bastón por una migración de formato.
- La hidratación es **asíncrona** (SecureStore, con el techo de `storage` = 2 s que ya existe en el borde): el provider arranca con el piso por plataforma y re-monta cuando resuelve. Ese re-montaje pasa por el `teardown` normal del efecto, que ya es el camino probado (`autoConnect → disconnect → autoConnect` tiene test).
- **iOS pasa de `'manual'` a `'ble-gatt'`** como piso: es el único transporte que iOS tiene, y si el módulo nativo no está en el build, `instantiateTransport` devuelve `null` y la app queda manual-first exactamente como hoy (mismo guard que `isSppNativeAvailable`).

**Limitación declarada, no escondida**: un teléfono con **dos** bastones de transportes distintos monta uno solo (R6.7: un bastón por dispositivo). Cambiar de bastón = elegirlo en la pantalla, que reescribe la preferencia. Si el campo pide dos simultáneos, es scope nuevo → `docs/backlog.md`.

**(as-built F4, 2026-08-17) — tres cosas que esta sección no tenía bien:**

1. **"Cambiar de bastón = elegirlo en la pantalla" NO alcanza como salida.** En BLE no hay lista de devices que elegir (el adapter escanea y se conecta solo; RBM9.6 no deja exponer el escaneo en la interfaz del `StickAdapter`), así que la única forma de reescribir la preferencia es conectar con ese mismo transporte — que es imposible si el bastón que la preferencia apunta ya no está. Y el CTA "Olvidar el bastón guardado" (R6.6) **vivía adentro de la rama `isSpp`**, o sea que la preferencia escondía su propia salida. Se movió afuera de las dos ramas, con guard. Ver la nota de reconciliación de RBM5.6.
2. **La preferencia se valida fail-closed** (`honorsPreference`): usable en la plataforma (**derivado** de `adapterForTransport` con `isAdapterUsableOn`, una sola tabla) **y** no gateada (`NOT_SELECTABLE_AS_PREFERENCE = ['hid-wedge']`). Es la primera entrada por la que STORAGE elige un transporte, así que "nunca se elige `hid-wedge`" dejó de ser cierto "porque ninguna rama lo escribe".
3. **El piso de iOS + la preferencia hacen alcanzable el `autoConnect` del adapter BLE** (RBM2.16): desde este delta la app puede arrancar escaneando por BLE **sin gesto**. Se dejó dicho en el provider y en la tabla de `autoConnect` de `wiring.test.ts`, que decía *"la implementa SOLO spp-android"* y era falso desde F3 sin que nada cayera (el adapter nuevo no estaba en la lista que la tabla recorría).

**(as-built F4, fix-loop del review 🟠-2, 2026-08-17) — "El problema real" de esta sección NO estaba resuelto
en Android. Ahora sí, y así:**

El diagrama de arriba resuelve **quién gana** cuando hay preferencia. Lo que faltaba era **quién la escribe**:
el `adapterKind` lo escribe el adapter al conectar, y en Android el adapter BLE no se monta si la preferencia
no dice ya `ble-gatt` → bucle sin entrada, `ble-gatt` inalcanzable en producción, y el banco de F6/T6.2 sin
poder arrancar. (Mismo patrón que R6.6 con cero call sites.)

```
transportChoices({platformOS, mountedKind, builtAdapters, declaredEaProtocols, canInstantiate, registry})
  → por cada driver del registro (en orden): binding = selectReaderBinding(...)
      · sin binding                         → no alcanzable en esta plataforma  (RMV2.5)
      · binding.adapterKind === mountedKind  → ya montado, no es alternativa
      · kind repetido                        → una fila por transporte (el adapter usa el 1º del registro)
      · selectTransportAdapter(pref: kind) !== kind → NO se ofrece (gateado / imposible): sería una fila
                                                      que no monta nada  ← derivado, no una 2ª tabla
  → [{adapterKind, binding, driver, installable: canInstantiate(kind)}]

pantalla:  fila (deviceRowView) + instrucción (transportInstructionsView), AFUERA del ternario `isSpp`
tap     →  api.chooseTransport(kind)  →  provider: setPreferredAdapter(kind) + ref "elegido por gesto"
        →  se monta ese adapter  →  mountActionFor({chosenByGesture:true}) === 'connect'  (trigger operator)
        →  el adapter escanea/dialoga y, al conectar, persiste {deviceId, adapterKind}  ← el único escritor
```

- **`registry` entra INYECTADO y sin default** a `DRIVER_REGISTRY`: `adapter-selection.ts` es una de las dos
  superficies **ciegas al fabricante** (RBM1.7, con guard) y nombrar el registro ahí abre la puerta al
  `DRIVER_REGISTRY[0].frameParser` que el review de F1 falsificó. Lo pasa la pantalla, que sí conoce lectores.
- **`installable`** es la otra mitad de `BUILT_ADAPTERS`: aquella dice "el build trae el adapter", esta "este
  dispositivo puede montarlo" (`isSppNativeAvailable` / `isBleGattTransportAvailable`). Sin ella, un APK sin el
  módulo nativo ofrecería "Tocá para conectar" y el tap dejaría al operario **sin** transporte. El probe de la
  pantalla es un espejo de los guards de `instantiateTransport`, y hay guard cruzando los dos archivos.
  ⚠️ Esto **depende del fix de 🟠-1**: antes, consultar la disponibilidad del BLE construía el
  `CBCentralManager` — o sea que la pantalla no podía preguntarlo sin tirar el diálogo del SO.
- **El id recordado no se presta entre transportes** (`rememberedDeviceIdFor`): el registro guarda UN bastón
  con SU `adapterKind`, y desde que el montado puede no ser el que escribió, un `connect()` sin id dialaba el
  id del otro — un intento que **no falla rápido, se queda esperando**. El formato viejo lo acepta solo el SPP.
- **Guard sobre la ausencia** (`wiring.test.ts`): todo kind construido y usable en una plataforma es alcanzable
  ahí (piso, o honrado + ofrecido + con escritor), y lo no construido no se honra. F5 (`mfi-ios`) nace en rojo.
  **(as-built F5)** nació en rojo, y el invariante ganó la distinción que le faltaba: la tercera condición
  ("la pantalla lo ofrece") **no se puede cumplir para `mfi-ios` hoy**, porque `transportChoices` recorre el
  REGISTRO DE LECTORES y ningún driver declara `mfi` (RBM4.6). Eso es un DATO faltante impuesto por un
  requisito, no un mecanismo faltante — y confundir las dos cosas es cómo se afloja un guard sobre la
  ausencia. As-built: la exención es **cerrada, nombrada** (`['ios/mfi-ios']`) y su motivo se **verifica**
  (el registro real no tiene lectores `mfi`), y hay un **test hermano** que corre el mismo invariante con un
  driver MFi sintético + su cadena declarada y exige que el par pase entero. Detalle en la nota de RBM5.6.
- **Límite declarado**: el único driver `ble-gatt` del registro es el del emulador (RBM5.11), así que en
  Android esa fila dice *"Emulador ESP32 (banco de pruebas)"* — la misma superficie que RBM5.12 declaró para
  iOS, ahora también en la plataforma del productor. Es lo que hace posible T6.2 y lo que el Gate 2.5 tiene que
  ver **en device** (T6.6): en web la lista de alternativas es **vacía** (el único transporte de web es el
  montado), así que la E2E y las capturas de F4 no la pueden fotografiar.

## 7. Los drivers: qué se registra y qué NO

| Driver | Entra | Por qué |
|---|---|---|
| `RS420_DRIVER` (as-built) | ✅ sin cambios | sigue declarando `spp` + `serial`; su `mfi` llega con la cadena del fabricante |
| `ESP32_GATT_DRIVER` (banco) | ✅ nuevo | es lo único con lo que el transporte BLE se puede verificar hoy (contexto §1.4) |
| **Gallagher HR5 v3** | ❌ **no** | no tenemos ni el aparato ni sus UUIDs/formato de trama. Un driver con parámetros adivinados sería un verde falso sobre el único consumidor conocido del transporte (RBM5.11) |
| Tru-Test SRS2i / XRS2i | ❌ no | su vía es MFi y la cadena iAP no la tenemos (RBM4.6) |

**`ESP32_GATT_DRIVER`, en detalle:**

```ts
{
  vendorId: 'esp32-gatt-emu',
  displayName: 'Emulador ESP32 (banco de pruebas)',          // ← honesto en la UI (RBM5.12, ADR-010)
  transports: [{ kind: 'ble-gatt', params: {
      serviceUuid:   '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',  // Nordic UART (ADR-003)
      notifyCharUuid:'6E400003-B5A3-F393-E0A9-E50E24DCCA9E',
      delimiter: SPP_DELIMITER } }],                          // el emulador emite la trama del RS420
  frameParser: { parse: parseRs420Line },                     // reuso, no reimplementación
  deviceMatch: { namePattern: /EMU-GATT-STICK/i },            // ← SOLO por nombre (RBM5.13)
  streaming: true,
}
```

**Por qué el `deviceMatch` es por nombre y nunca por `advertisedServiceUuids`**: el **bridge de la balanza Vesta** (ADR-003) anuncia **los mismos UUIDs NUS**. Un match por UUID haría que la app reconozca el bridge de la balanza como un bastón — con la lectura de peso yendo al ingesta de EID. Con el match por nombre, el bridge aparece como *"no reconocido"* y **no es accionable** (RMV1.7 / RMV3.8), que es la conducta correcta y ya construida. El emulador, además, anuncia `EMU-GATT-STICK` **a propósito** para no matchear ningún driver (README del firmware) y su comando `name` permite forzar los dos estados en el banco.

**Por qué el driver del banco vive en el registro de producción y no detrás de un gate de build**: (1) un `ReaderDriver` es **datos**, no un transporte — por sí solo no conecta nada, necesita un dispositivo que matchee su nombre; (2) un registro condicional rompe el determinismo que RMV2.8 compró (el mismo input daría bindings distintos según el build); (3) el `displayName` dice lo que es. *(Alternativa descartada — ver §12.)*

## 8. UI: lo que cambia en la pantalla de conexión

`TransportInstructions` ya deriva del `ReaderBinding` (as-built). Se le agregan dos ramas:

- **`ble-gatt`** → "Prendé el bastón y tocá Buscar" + lista de resultados del escaneo (nombre + reconocido/no reconocido, `StickDeviceRow` sin cambios) + estado de escaneo con su presupuesto vencido → CTA "Buscar de nuevo".
- **`mfi`** → instrucción del **Accessory Picker de iOS** (así emparejan los Tru-Test "i", según el relevamiento) y, con `available:false`, el copy honesto por `reason`: *"Reconocemos este bastón, pero esta versión de la app todavía no tiene la autorización del fabricante para iPhone"* + CTA a la carga manual, **sin intentar conectar** (RMV3.7).

`connection-view.ts` sigue siendo puro y testeado con `node:test`; ninguna de estas ramas mete lógica en el componente.

**(as-built F4, 2026-08-17) — cómo quedó de verdad esta sección:**

- **El copy ENTERO de las instrucciones se mudó del JSX a la vista pura** (`transportInstructionsView`), no solo las dos ramas nuevas. Mientras vivía en el `if` del componente era la única decisión de presentación del bastón **sin un solo test**, y este delta le agregaba dos ramas más —una de ellas dependiendo del `unavailableReason`—. En el componente quedó la traducción clave→ícono lucide y el layout (lo que no puede vivir en el módulo puro). Las cinco cadenas que ya existían se conservan verbatim, con test de regresión. Las claves están enumeradas en una lista **anclada al union por typecheck** (`TRANSPORT_INSTRUCTION_KEYS`), así que una rama de copy nueva **nace en rojo** hasta que tenga su caso de test.
- **La rama `ble-gatt` NO lista resultados de escaneo**: ver la nota de reconciliación de RBM5.14. El copy dice lo que el adapter hace (busca y se conecta al que reconoce) y remata con el CTA real ("Buscar de nuevo").
- **El copy por transporte en la CARD de estado** entró como un override aditivo (`env.transportKind`, opcional): `scanning` → *"Buscando el bastón…"* y `disconnected` → CTA *"Buscar de nuevo"* + hint que nombra lo accionable. **No toca `tone`, `cta`, `icon` ni `connected`**, así que el invariante de que la fila no contradiga a la card se sigue cumpliendo con el mismo test (ahora con el `transportKind` en su matriz). Sin `transportKind`, o con cualquier otro, la card es byte por byte la de antes del delta (test de regresión sobre los 6 estados).
- **`BUILT_ADAPTERS` suma `'ble-gatt'` y NO `'mfi-ios'`** — desviación deliberada de T4.8, ver su nota.
  **(as-built F5) esto se REVIRTIÓ y el guard se invirtió con él**: ahora suma los dos. Con el adapter escrito,
  dejar `'mfi-ios'` afuera no es ruido, **miente el motivo** — el binding de un lector MFi diría
  `adapter-no-construido` ("todavía no lo soportamos") en vez de `build-sin-protocolos` ("falta la autorización
  del fabricante"), que es la distinción que RBM4.5 compró para el copy. Y por RBM4.7 tenía que entrar en este
  diff: si hubiera que agregarlo el día que llegue la cadena, ese día habría código. Que esté "construido" no
  lo vuelve montable: `TRANSPORT_INSTALLABLE['mfi-ios'] = isMfiTransportAvailable` incluye el gate de datos.

**Gate 2.5 (ADR-029)**: hay UI nueva → capturas obligatorias. Con una salvedad honesta: la E2E de web **no puede** ejercitar el flujo BLE (no hay transporte en web y el binding en web es `serial`). Las capturas de las ramas nuevas salen de (a) los tests puros de `connection-view` para el copy y (b) **screenshots del banco en device** (RBM9.7). Decirlo es parte del entregable: una captura web de una pantalla que en web no existe sería teatro.

**(as-built F4)** Lo que SÍ se entregó en web: `app/e2e/captures/baston-ios-ble-mfi-f4.capture.ts` (4 shots) con las dos cosas que web renderiza de verdad — la instrucción del transporte `serial` (para vetar que la mudanza del copy no cambió el layout) y el **CTA "Olvidar el bastón guardado" fuera de la rama SPP**, sembrando el registro del bastón recordado en `localStorage` con el **formato nuevo** (que además ejercita `parseRememberedValue` de punta a punta en el navegador). El archivo declara arriba qué es N/A y por qué.

**(as-built F4, fix-loop del review 🟠-2)** La sección "Dispositivos" gana una banda más, **afuera de las dos
ramas** del ternario `isSpp`: **los otros transportes alcanzables** en esta plataforma, uno por fila, con la
misma anatomía que la rama no-SPP (fila del lector + card de instrucción de su transporte) y con las mismas
vistas puras. Cómo se ve por plataforma:

| Plataforma / montado | Qué agrega la banda |
|---|---|
| web (`web-serial`) | **nada** (lista vacía) → la E2E y las 4 capturas de F4 quedan idénticas |
| iOS (`ble-gatt`) | **nada** (el SPP no existe en iOS —RBM5.3— y MFi está gateado hasta F5) |
| Android (`spp-android`) | fila *"Emulador ESP32 (banco de pruebas) · Reconocido. Tocá para conectar."* + la instrucción de BLE GATT (*"no hace falta emparejarlo desde los ajustes"*) |
| Android (`ble-gatt`) | fila *"Allflex RS420"* + la instrucción del SPP → **la vuelta** al bastón por Classic |
| cualquiera, sin el módulo nativo de ese transporte | la misma fila, **no accionable**, diciendo *"Reconocido, todavía no disponible en esta versión"* |

⚠️ **Para el veto visual (y es el límite honesto de esta fase)**: esta banda **no se puede fotografiar en web**
—en web no hay transporte alternativo, a propósito— así que su evidencia visual es **de device (T6.6)**, igual
que las instrucciones de `ble-gatt`/`mfi`. Lo que sí está fijado por test: qué filas aparecen en cada
plataforma, que la de BLE dice que es un banco de pruebas, que ninguna se ofrece si tocarla no montaría nada, y
que el bloque no vive adentro de una rama del ternario (la trampa por ubicación del CTA de olvidar).

## 9. T5 — el banco del emulador en `MODO_GATT`

**Qué lo hace útil** (contexto §1.4): el emulador notifica la trama **partida en trozos de 20 bytes** — o sea, ejercita el reensamblado, que es justo donde el SPP se rompió. Y el generador de tramas es **compartido con `MODO_SPP`**, así que los oráculos ya escritos valen.

**Escenarios** (los mismos que `MODO_SPP`, más los propios de GATT):

| escenario | comando | esperado |
|---|---|---|
| stream | `seq on` + `read 20 500` | 20 EIDs distintos, ninguno perdido |
| dedup dentro de la ventana | `same 5 300` | **1** ingesta |
| dedup cruzando la ventana | `gap 2000` + `same 3` | **2** ingestas |
| ráfaga | `burst 8` (seq on/off) | 8 / 1 |
| malformadas | las 10 `bad <caso>` | descartadas en silencio, sin crash |
| trama partida | `split 300` | **1** lectura reensamblada |
| dos pegadas | `double` | **2** lecturas |
| **troceo** | `chunk 20` vs `chunk 0` | **idéntico** (RBM6.3) |
| corte del link | `drop` | `disconnected` + backoff + reconecta |
| radio abajo | `off 8000` | la cadena sobrevive al primer fallo |
| flap | `flap 4 3000` | backoff **creciente** (`attempt:0→1→2→3`), sin duplicar suscripciones |
| mudez | `mute 30` | sigue `connected`, 0 ingestas, `connected_silent` en el log |
| **corte en background** | `drop` con la app minimizada | al volver, la sonda reconcilia — **no** queda "conectado" mentiroso (BENCH-1) |
| **desconexión ajena** | otro device BLE que se va | **no** afecta la conexión del bastón (RBM3.4) |
| device no reconocido | `name VESTA_BRIDGE` | fila "no reconocido", **no** accionable (RBM5.13) |

**Dos plataformas** (RBM6.4): Android con build local de Gradle (0 EAS) e iOS con build de EAS (**gateado por el OK explícito de Raf**). Un escenario que dé distinto es **hallazgo**, no verde (RBM6.5) — es literal lo que pasó con `flap` y `mute` en el banco del SPP, y de ahí salieron el dwell y el watchdog de mudez.

**Lo que el banco NO valida, y queda escrito** (README del firmware §"Qué NO valida", más lo propio de este delta): las mañas de un **HR5 v3 real** (su formato de trama, sus UUIDs, sus tiempos, su semántica de desconexión) — que no tenemos. El verde del emulador prueba **nuestro lado**.

## 10. T7 — el gate del HID: protocolo de medición y los tres desenlaces

**Corre primero y no cuesta un build** (RBM8.2). El iPhone tiene la build de TestFlight del **2026-08-11** (perfil `testflight-dev`, commit `0273c43`), que ya trae el campo donde el ESP32 tipearía:

- `app/app/maniobra/identificar.tsx` → `TextInput` con `testID="manual-entry-input"`, `accessibilityLabel="Número o caravana visual"`;
- se llega por el botón *"Sin chip, ingresá la caravana a mano"* de esa misma pantalla.

**Props del campo, que hay que anotar antes de medir** (son parte del oráculo, no un detalle): `maxLength = SEARCH_TERM_MAX_LENGTH` (64 → los 15 dígitos entran de sobra), `autoCapitalize="characters"`, `autoCorrect={false}`, `returnKeyType="search"`, `onSubmitEditing` → dispara la búsqueda, y **sin** `keyboardType` explícito.

**Setup**: ESP32 flasheado en `MODO_HID` (nombre `EMU-HID-380`), emparejado con el iPhone **como teclado** desde los ajustes de iOS. La app en `/maniobra/identificar` con el campo manual abierto.

**Qué se mide, por punto de R8.7:**

| | Medición | Cómo se observa |
|---|---|---|
| **(a)** 15 dígitos completos | `read 1` con `hiddelay` en 12 ms (default), 5 ms y 40 ms | el contenido del campo == el EID del `status` del emulador, **carácter por carácter** |
| **(b)** terminador Enter | `hidterm enter` / `tab` / `none` | con `enter` dispara `onSubmitEditing` (se ve porque **busca**); con `tab`/`none` no — y eso dice qué terminador tiene que soportar el adapter |
| **(c)** supresión del teclado en pantalla | con el teclado BT emparejado, abrir el campo | ¿aparece la barra de sugerencias?, ¿queda espacio muerto?, ¿el CTA sigue alcanzable con una mano?, ¿el layout de manga se rompe? — **captura de pantalla, no impresión** |
| **(d)** captura confiable con foco programático | 20 lecturas seguidas, incluyendo volver de background y rotar | 20/20 completas, sin caracteres perdidos ni intercalados |
| extra | `hidraw on` | ¿el wedge puede tipear la trama completa (con STX)? Informa RBM8.8, no decide el gate |

**Los tres desenlaces, que no se pueden mezclar** (RBM8.4/8.5/8.6):

1. **(a)(b)(c)(d) verdes** → se escribe el adapter (T7.1), detrás de la MISMA `StickAdapter`, con el terminador y la cadencia que el gate midió.
2. **Falla (c) o (d) por comportamiento de iOS** → el adapter **no se escribe**. `adapter-hid-wedge.ts` queda placeholder, su binding en `available:false`, y el camino se cierra **con la medición adjunta**.
3. **Falla por una prop del `TextInput` de producción** (p. ej. `autoCapitalize`, la ausencia de `keyboardType`, o `onSubmitEditing` haciendo algo indeseado con el Enter) → **no es el desenlace 2**. La consecuencia es *ajustar el campo de scan (o darle uno dedicado al wedge) y re-correr el gate*. Confundirlos cerraría por error una puerta que estaba abierta.

**Lo que el gate NO prueba** (RBM8.7): que el **Gallagher HR0** —o cualquier bastón comercial del mercado argentino— haga HID. Eso sigue **sin confirmar del fabricante** (relevamiento §"Qué falta", ítem 1). El ESP32 valida **el lado del teléfono**. Son dos incógnitas y el verde de una no tapa a la otra; el informe del gate tiene que decirlo en su primera línea.

## 11. Base de datos, multi-tenancy, offline-first y Gate 1

- **Base de datos: NADA.** Cero migraciones, cero RPC, cero funciones, cero Edge Functions, cero policies, cero cambios en `sync-streams/` (RBM9.1). **Verificación de cierre**: `git status --porcelain supabase/ sync-streams/` cruzado contra la lista de archivos del delta (ve untracked y es atribuible). `git diff` NO sirve acá: mide el árbol, no el cambio.
- **RLS / multi-tenancy: no se toca ninguna tabla con `establishment_id`** (RBM9.3). El EID que estos transportes ingieren entra al motor find-or-create de **spec 09**, que ya corre bajo RLS y PowerSync; ese camino no cambia una línea. Se menciona explícitamente porque la regla del proyecto lo exige, no porque haya superficie nueva.
- **Offline-first (R14)**: los tres caminos —BLE GATT, ExternalAccessory y HID— son **enlaces locales entre el bastón y el teléfono**. Ningún paso del transporte, del parseo, de la validación ni de la dedup requiere red (RBM9.4). Es una feature de **carga de datos en campo**: el peón en la manga no tiene señal, y el delta no introduce ninguna llamada a internet.
- **Gate 1 (security_analyzer modo `spec`): N/A**, y se declara con el motivo. Los disparadores del gate (RLS, schema sensible, Edge Functions, auth/tokens, secrets) **no se tocan**. El único eje que roza "datos regulados" es la integridad del EID que se declara ante SENASA, y este delta **no toca** `isValidTag`, la dedup ni la confirmación pre-commit: solo cambia **de dónde sale el parser** (RBM1.8). El único modo de falla nuevo es "parser no resuelto", resuelto **fail-closed con log** (RBM1.4). Si el leader quiere correr Gate 1 igual, esa es la única pregunta que vale hacerle. **Gate 2 (modo `code`) sigue siendo obligatorio**, como siempre.

## 12. Alternativas descartadas

**A — Dejar el parser hardcodeado y meterle un `if` por vendor a `contract.ts`.**
Es lo más rápido y es exactamente lo que ADR-024 §1 y RMV1.6 prohíben: convierte "sumar una marca = una fila de datos" en "sumar una marca = tocar el corazón del contrato". Además el `if` crece con cada fabricante en el archivo que **ningún** transporte puede eludir. Descartada: el costo de pasar el parser por parámetro es una firma, y compra que el requisito RMV1.6 sea cierto por construcción.

**B — `adapter-ble-gatt` solo para iOS.**
Era la lectura literal del pedido original ("todo el bluetooth para iOS"). Descartada por el contexto §4 y confirmada acá: `react-native-ble-plx` corre en los dos sistemas con el mismo código, así que restringirlo sería **trabajo extra para tener menos**, y el HR5 v3 andaría también en Android — que es donde está el productor argentino.

**C — Registrar un driver del Gallagher HR5 v3 con UUIDs "razonables" (Nordic UART, o los de algún foro).**
Tentador porque destrabaría el único consumidor real del transporte. Descartada: sería un **verde falso sobre la incógnita más importante del delta**. Si el HR5 usa otros UUIDs u otro formato de trama, el driver no funcionaría y el fallo aparecería recién con el aparato en la mano, después de haber declarado el camino "listo". A Gallagher se le pide **documentación técnica** (contexto §2), que es un pedido fácil y no depende de ningún trámite.

**D — Poner el driver del emulador detrás de un gate de build (como el simulador de RMV4).**
Descartada por tres motivos: un `ReaderDriver` es **datos** y no puede conectar nada por sí solo; un registro condicional **rompe el determinismo** que RMV2.8 compró (mismas entradas → mismo binding, sin importar el build); y el gate del simulador existe por una razón que acá no aplica (que un EID **sintético** no se declare ante SENASA — el emulador emite EIDs por un transporte real, igual que un lector). Lo que sí se toma del simulador es la honestidad del rótulo: el `displayName` dice que es un banco de pruebas.

**E — Un toggle de dev para forzar el transporte BLE en el banco, en vez de RBM5.6.**
Más barato: una línea y ningún cambio en `remembered-device.ts`. Descartada porque deja el problema de producción intacto — en Android el BLE seguiría siendo **inalcanzable para un usuario real**, y el banco estaría midiendo un camino que producción nunca toma. Es la definición de un verde que no prueba lo que dice.

**F — Escribir el `adapter-hid-wedge` en paralelo al gate, "total después se ajusta".**
Descartada, y no por prudencia genérica: la cabecera de `adapter-hid-wedge.ts` lo prohíbe textualmente (*"el Council fue enfático: no fijar arquitectura sobre un mecanismo no ejecutado en hardware real"*, ADR-024 §4). Escribir primero garantiza que el diseño se acomode a lo que suponemos y no a lo que el iPhone hace — y el gate cuesta **cero builds** (RBM8.2), así que ni siquiera hay una excusa de calendario.

## 13. Riesgos declarados

| Riesgo | Probabilidad | Mitigación / qué pasa si se materializa |
|---|---|---|
| `react-native-ble-plx` no arranca bajo RN 0.85.3 bridgeless (tiene C++/JSI, la clase de fallo de `quick-sqlite`) | media | RBM2.18: veto **antes** de escribir el adapter, contra el código instalado y un build real. Si falla, el delta se replantea; T1, T3 y T7 **no dependen** de esa dep |
| El transporte BLE sale sin un solo lector comercial con el que hablar | **alta (es un hecho hoy)** | Declarado en el contexto §3 y en RBM5.11/RBM6.6. El banco prueba nuestro lado; el driver del HR5 v3 espera la doc de Gallagher |
| El gate HID falla en (c) o (d) | media | RBM8.5: el camino se cierra **con evidencia**, no con una suposición. El contrato sobrevive sin ese adaptador (ADR-024 §4) |
| Un `HR5 v3` real emite una trama que `parseRs420Line` no entiende | alta si aparece el aparato | Es exactamente lo que T1 destraba: su driver trae su propio `frameParser`, sin tocar el contrato |
| El re-montaje del transporte por preferencia recordada introduce un ciclo (montar → hidratar → re-montar) | baja | El `mode` corta antes que la preferencia; la hidratación ocurre **una vez**; el ciclo `autoConnect → disconnect → autoConnect` ya tiene test. Guard: la preferencia solo re-monta si **cambia** el `AdapterKind` resuelto |
| Sacar `parseRs420Line` de `contract.ts` rompe un call site no listado | baja | El parámetro es **requerido** → el typecheck enumera los call sites por nosotros |
| El build de iOS se necesita dos veces (uno para el banco, otro para un fix) | media | Recurso agotable: 30/mes. Por eso el gate HID va **antes** y sin build, y el código llega al build de EAS con unit + emulador Android ya en verde |
| **(F4 fix-loop 🟠-1)** El diálogo de Bluetooth de iOS aparece en un camino que no medimos (el `CBCentralManager` se crea en algún lugar que no vimos) | baja, pero **no verificada en device** | El fix mueve la construcción del manager detrás de los gates y lo fija un test que **cuenta construcciones** en un arranque en frío (0) con control positivo (1). Lo que ningún unit puede probar es qué hace iOS de verdad: **escenario explícito de T6.4** (instalación limpia, sin bastón recordado, abrir la app → el diálogo NO debe aparecer). Si apareciera igual, el siguiente sospechoso es leer `NativeModules.BlePlx` en bridgeless, y la mitigación sería mover ese chequeo también detrás de un gesto |
| **(F4 fix-loop 🟠-2)** La banda de "otros transportes" de la pantalla **no tiene evidencia visual**: en web la lista es vacía por diseño, así que el Gate 2.5 de F4 no la puede fotografiar | media | Está fijada por tests puros (qué filas por plataforma, copy, no-accionable sin módulo, ubicación afuera del ternario) y por typecheck (reusa `StickDeviceRow`/`TransportInstructions` con las mismas props que la rama existente). El veto visual queda **atado a T6.6** (capturas de device) y el flujo entero a **T6.2**. Riesgo residual: un error de render solo visible en device |
| **(F4 fix-loop 🟠-2)** En Android, un productor sin banco ve una fila que dice *"Emulador ESP32 (banco de pruebas)"* | **alta (es un hecho hoy)** | Es la consecuencia de RBM5.11 (no se inventa el driver del HR5 v3) + RBM5.12 (el del banco se llama por su nombre), y la misma superficie que iOS ya muestra. Honesta y funcional: es lo único con lo que hoy se puede conectar por BLE. Si Raf decide esconderla, es **un `filter` en la pantalla** (una línea) y no un rediseño; el día que un lector comercial entre al registro, la misma fila dice su nombre |

## 14. Notas para el implementer

1. **Orden no negociable**: el gate HID (T7.0) primero — no cuesta build y su resultado cambia lo que se escribe después. Después T1 (sin él, T2 solo habla con nuestro emulador). Después el veto de la dep. Recién ahí el adapter BLE.
2. **Moldeá sobre el código instalado, no sobre el README.** Vale para `react-native-ble-plx` y **especialmente** para la rama iOS de `react-native-bluetooth-classic`. El diseño del SPP escrito desde el README describía un adapter que no leía nada.
3. **Reusá, no reimplementes**: `LineFramer`, `backoffDelayMs`, `bridge-timeout.ts`, `connect-trigger.ts`, `remembered-device.ts`, `permissions-android.ts`, `logging.ts`, `parser-rs420.ts`. Todo lo que este delta necesita de máquina de estados **ya está escrito y pagado en device**.
4. **Los guards se falsifican con mutantes.** Cada uno de los de §3 tiene su mutante escrito; si un mutante no pone nada en rojo, el guard es teatro y hay que rehacerlo (van cuatro repeticiones del verde mentiroso en esta feature).
5. **Un `env` inyectado por constructor** (`BleEnv`, espejo de `SppEnv`) es lo que baja el gate de hardware de "todo el transporte" a "solo el stream": la máquina de estados entera se ejercita en `node:test` con dobles, incluidas las promesas que **no resuelven nunca** y el reloj.
6. **Registrá las suites nuevas en `scripts/run-tests.mjs`** (lista explícita). Un test que no corre da falsa confianza.
7. **No toques `feature_list.json`, `progress/` ni nada de spec 09.** Si algo lo exige, **pará y reportá al leader** (RBM9.6).
