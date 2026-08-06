# Spec 04 — DELTA «multivendor + selección + demo» — Design

**Status**: `spec_ready` (delta-spec ADR-028 Nivel B — mini-ciclo propio; **NO reabre el core aprobado de spec 04**).
**Fecha**: 2026-07-20 (sesión bastón).
**Fuente de verdad**: `requirements-multivendor.md` (RMV) + `context-multivendor.md` (Gate 0) + **ADR-024** (transporte) + el **core as-built** de spec 04 (`app/src/services/ble/*`). El design **respeta** el contrato de ingesta de EID transport-agnóstico + la interfaz `StickAdapter` + los tipos de spec 09; **no** los redefine, los **extiende de forma aditiva**.

> **Regla de oro del delta.** El core dejó firme la columna vertebral: `contract.ts` (`EidIngestEngine`, `ingestRawLine`, `ingestEid`), `stick-adapter.ts` (`StickAdapter`, `ConnectionStatus`, `BleStickEvent` de spec 09), `dedup.ts`, `feedback*`, `adapter-selection.ts` (`selectTransportAdapter`), `BleStickListenerProvider.tsx`, `stick.ts`, `parser-rs420.ts`, `remembered-device.ts`, `permissions.ts`, `line-framer.ts`. Este delta **no reescribe** nada de eso: **agrega archivos** (registro de drivers, motor de selección por capacidad, simulador, pantalla) y hace **extensiones aditivas** puntuales (una rama de `mode`, un `kind` de adapter, un `case` de switch). Todo lo nuevo es hardware-independiente o gated.

## Deltas posteriores (índice — lo mantiene el leader al cerrar)

- `multivendor` — registro de drivers + selección por capacidad + pantalla de conexión/selección + simulador demo + `adapter-spp-android` escrito. Estado: `spec_ready` (este documento).

---

## 1. Arquitectura del delta sobre el as-built

El core ya tiene la forma correcta (ADR-024): un **contrato de ingesta** con `StickAdapter` como interfaz de proveedor. El delta agrega dos capas nuevas **entre** el descubrimiento del device y el adapter, y una capa de UI/demo encima:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  StickConnectionScreen (en "Más", ADR-018)  +  StickStatusIndicator (chrome) │  ← NUEVO (RMV3)
│   descubrir → listar → [driver-registry] → [selección] → elegir → conectar   │
│   + controles de simulación SOLO bajo isDemoMode() (triple-guard)  (RMV4)     │
└────────────────────────────────────────────────────────────────────────────┘
                              ↓ usa
┌────────────────────────────────────────────────────────────────────────────┐
│  driver-registry.ts  (RMV1)         selection-priority.ts (RMV2)             │  ← NUEVO
│   DRIVER_REGISTRY = [RS420_DRIVER]   platformTransportPriority()             │
│   findDriverForDevice(dev)           adapterForTransport(kind, os)           │
│   driverByVendorId(id)               selectReaderBinding(env) → ReaderBinding │
└────────────────────────────────────────────────────────────────────────────┘
                              ↓ elige adapter + driver
┌────────────────────────────────────────────────────────────────────────────┐
│  StickAdapter (interfaz del core, R11 — SIN CAMBIOS de firma)                │
│    ├── adapter-spp-android   ESCRITO (RMV5) — Classic SPP, driver-param.     │
│    ├── adapter-web-serial    core (buildable hoy)                            │
│    ├── adapter-manual        core (piso)                                     │
│    ├── adapter-mock          core (CI / E2E)                                 │
│    ├── adapter-simulator     NUEVO (RMV4) — kind:'simulator', dev/demo-gated │
│    └── adapter-hid-wedge     core GATED (R8.7) · [ble-gatt/ea-ios = futuro]  │
│         ↓ cada stream → frameParser del driver (RS420 = parseRs420Line)      │
│  contract.ts (EidIngestEngine): validate (R1) → dedup (R3) → confirm (R2)    │  ← SIN CAMBIOS
└────────────────────────────────────────────────────────────────────────────┘
```

**Idea central del multivendor (lo que merece ADR):** los adaptadores son **por transporte** (SPP / serial / HID / GATT / MFi), y **los fabricantes son datos** (`ReaderDriver`) que **parametrizan** un adapter de transporte. Sumar una marca = sumar una fila de datos, no un adapter. Esto es exactamente "conseguir las claves de cada empresa → cada una es un driver" del context.

## 2. Archivos a crear o modificar

### 2.1 Nuevos archivos en `app/src/services/ble/` (territorio de 04)

```
app/src/services/ble/
├── driver-types.ts            # ReaderDriver/ReaderProfile, TransportKind, TransportCapability,
│                              #   connectionParams, DeviceMatcher, DiscoveredDevice, DiscoveryChannel,
│                              #   FrameParser (RMV1.1, RMV1.2). PURO.
├── driver-registry.ts         # DRIVER_REGISTRY, driverByVendorId, findDriverForDevice (RMV1.4, 1.5, 1.7). PURO.
├── driver-rs420.ts            # RS420_DRIVER (reusa parseRs420Line, SPP_UUID, DEFAULT_BAUD) (RMV1.3). PURO.
├── selection-priority.ts      # platformTransportPriority, adapterForTransport, selectReaderBinding,
│                              #   ReaderBinding, BindingEnv (RMV2). PURO.
├── adapter-simulator.ts       # SimulatorAdapter (kind:'simulator'), emite EIDs sintéticos válidos (RMV4). 
├── demo-gate.ts               # isDemoMode() puro: lee __RAFAQ_BLE_DEMO__ + __DEV__/no-prod (RMV4.4/4.5). PURO.
└── __tests__ (junto al módulo, patrón node:test del core)
    ├── driver-registry.test.ts    # match por deviceMatch, lookup por vendorId, no-match → null (RMV1)
    ├── selection-priority.test.ts  # tabla de prioridad, binding por plataforma, available, ambigüedad,
    │                               #   regresión de selectTransportAdapter (RMV2)
    ├── adapter-simulator.test.ts   # emite EID válido → pipeline; disable no emite; gate (RMV4)
    ├── demo-gate.test.ts           # sin marca → false; en prod → false; con marca + dev → true (RMV4.4)
    └── adapter-spp-android.test.ts  # partes PURAS: driver-param, framing, backoff, import perezoso no tira (RMV5)
```

**As-built 2026-07-30 (unidad de bloqueantes)** — dos módulos y tres suites más, todos en el mismo lugar:

```
app/src/services/ble/
├── bridge-timeout.ts               # withTimeout / withTimeoutOr / BridgeTimings (🔴-1). PURO.
├── connect-trigger.ts              # ConnectTrigger + CONNECT_TRIGGER_POLICY (tabla exhaustiva) +
│                                   #   UNPROMPTED_RETRY_BUDGET_MS: el TOPE de la cadena sin gesto. PURO.
├── connection-view.ts (features/)  # + `autoConnectExhausted` en ConnectionEnv (copy honesto del tope).
├── permissions-android.ts          # + classifyPermissionChecks (PURA) + checkAndroidBluetoothPermissions
│                                   #   (CONSULTA sin pedir, para el arranque y los reintentos — R6.4).
├── stick-adapter.ts                # + `autoConnect?()` OPCIONAL en la interfaz (R6.4; solo spp-android).
├── spp-protocol.ts                 # + sppDelimiterIsSupported; sppConnectOptions(delimiter);
│                                   #   splitSppPayload(payload, delimiter) (🟠-5). PURO.
├── adapter-selection.ts            # + IngestMode, ADAPTER_INGEST_MODE, ingestModeFor, ADAPTER_KINDS (🟡-1). PURO.
├── driver-types.ts                 # + `delimiter?` en los params del TransportCapability de kind 'spp'.
├── logging.ts                      # + bridge_timeout / connect_superseded / liveness_lost / connected_silent.
├── bridge-timeout.test.ts          # vencimiento, rechazo tardío sin unhandledRejection, onTimeout, presupuestos
├── adapter-ingest-mode.test.ts     # tabla exhaustiva + guard de que el provider delegue en ingestModeFor
└── spp-bridge-timeout-guard.test.ts # falla si aparece un await del puente sin presupuesto
```

> Los dos guards estáticos se verificaron **mutando el código** (sacándole el `withTimeout` a
> `getBondedDevices` y re-metiendo la comparación de literales en el provider): los dos fallan. Un guard
> que no se probó rompiendo lo que vigila no prueba nada.

### 2.2 Reescritura de un placeholder del core (04-owned)

- `adapter-spp-android.ts` — **placeholder → código completo** (RMV5). Implementa `StickAdapter` (`kind:'spp-android'`) sobre `react-native-bluetooth-classic` con **import perezoso** (patrón `feedback.ts`: `require` dentro de la función de I/O, no top-level), parametrizado por `RS420_DRIVER` (sppUuid, pin, frameParser), reusando `LineFramer` + `backoffDelayMs` + `remembered-device.ts`. Las partes puras se testean en CI; la conexión RFCOMM real queda **GATED** (RMV5.9). **[As-built: `LineFramer` NO se usa acá (el framing lo hace el nativo — ver §6); `pin` y `frameParser` no los consume el transporte (nota de RMV5.2); el gate de RMV5.9 se corrió contra el emulador ESP32 y el stream está verificado en device.]**

### 2.3 Extensiones aditivas a archivos del core (04-owned, sin romper firmas)

- `stick-adapter.ts` — extender el union `StickAdapter['kind']` con `'simulator'` (aditivo). No cambia ningún método de la interfaz.
- `adapter-selection.ts` — (a) extender `ProviderMode` con `'demo'`; (b) extender `AdapterKind` con `'simulator'`; (c) agregar la rama `if (env.mode === 'demo') return 'simulator';` **antes** de la lógica de plataforma; los modos `auto`/`mock`/`manual` devuelven **exactamente lo mismo que hoy** (RMV2.7, regresión). El motor de binding por capacidad vive en `selection-priority.ts` (nuevo), no acá.
- `permissions.ts` — agregar `case 'simulator': return { kind: 'none' };` al switch exhaustivo de `permissionModelFor` (aditivo).
- `BleStickListenerProvider.tsx` — en `instantiateTransport`, agregar `case 'simulator': return isDemoMode() ? new SimulatorAdapter() : null;` (triple-guard 3: re-chequea el gate al instanciar). El resto del provider (ingesta, confirmación, `subscribeTagRead`, `acquireScopedScanner`) queda **intacto**: el simulador entra por el mismo `handleReading(value, isRawStream=false)` que el mock (emite EID limpio, no línea cruda).

### 2.4 UI: pantalla de conexión + indicador (buildable-hoy, feature 04)

```
app/src/features/ble-stick/                     (territorio de 04; features/animals es de spec 09, NO se toca)
├── screens/StickConnectionScreen.tsx           # RMV3.1–3.4, 3.7, 3.8 — específica por adaptador del binding
├── components/StickStatusIndicator.tsx         # RMV3.5 — indicador global en el chrome
├── components/StickDeviceRow.tsx               # fila de un device descubierto (reconocido/no-reconocido/available)
├── components/DemoControls.tsx                 # RMV4 — "Simular lectura", SOLO bajo isDemoMode()
└── connection-view.ts                          # PURO: ConnectionStatus → {label, hint, cta}; binding → estado de fila
```

- `connection-view.ts` es **puro y testeable** (mapeo estado→vista, binding→fila), separado del componente (mismo patrón que `statusView` de `baston-test.tsx`, pero extraído para node:test).
- La pantalla **consume el provider global** (`useBleProviderApi()` + `useBleConnectionStatus()`), NO monta un provider propio (a diferencia del harness `baston-test.tsx`, que es self-contained y se mantiene como está para dev).

### 2.5 Frontera host-level (mínima, coordinada — NO toca teléfono/auth)

- `app/app/_layout.tsx` — extender el prop `mode` del `BleStickListenerProvider` raíz: hoy `mode={isBleE2E() ? (isBleE2EManual() ? 'manual' : 'mock') : 'auto'}`; el delta lo lleva a `… : (isDemoMode() ? 'demo' : 'auto')`. **1 línea**, análoga a la de E2E. Coordinar con el leader (colisión-safe).
- `app/app/_components/ble-demo-flag.ts` — *(opcional)* si se prefiere el patrón host-level de `ble-e2e-flag.ts`, la marca `__RAFAQ_BLE_DEMO__` puede vivir acá en vez de en `services/ble/demo-gate.ts`. **Decisión de diseño**: la lógica pura del gate vive en `services/ble/demo-gate.ts` (04-owned, testeable en node:test); el `_layout.tsx` la importa. No se necesita un `BleDemoBridge` separado (los controles de simulación viven en `DemoControls.tsx` dentro de la pantalla, gateados por `isDemoMode()`).
- Nav "Más" (ADR-018) — agregar la entrada de ruta a `StickConnectionScreen`, y montar `StickStatusIndicator` en el chrome. Coordinar el punto de montaje del indicador; si exigiera tocar un contrato de spec 09, **parar y reportar** al leader.

> **Ningún archivo de spec 09 (`app/src/features/animals/*`, screens de find-or-create) se modifica.** El delta reusa `useBleConnectionStatus`, `useBleProviderApi`, `useBleStickListener` tal como el core los expone.

## 3. Modelo de datos de tipos (nuevos — no redefinen spec 09 ni el core)

```typescript
// driver-types.ts — PURO (sin RN, sin I/O)

/** Familia de transporte que un lector soporta (perspectiva del driver, no del adapter concreto). */
export type TransportKind = 'spp' | 'serial' | 'ble-hid' | 'ble-gatt' | 'mfi';

/** Cómo un driver desframea una entrada de su transporte hasta el EID (RS420 → parseRs420Line). */
export interface FrameParser {
  parse(raw: string): { eid: string } | null;
}

export type TransportCapability =
  | { kind: 'spp';      params: { sppUuid: string; pin?: string } }
  | { kind: 'serial';   params: { baud: number } }
  | { kind: 'ble-gatt'; params: { serviceUuid: string; notifyCharUuid: string } }
  | { kind: 'ble-hid';  params: Record<string, never> }              // teclado del SO, sin params
  | { kind: 'mfi';      params: { protocolString: string } };        // arch-ready (Facundo)

/** Canal por el que se descubre un device (cruza con deviceMatch para clasificar el transporte). */
export type DiscoveryChannel = 'classic-paired' | 'ble-advertised' | 'hid-keyboard' | 'serial-port';

export interface DiscoveredDevice {
  id: string;                        // address / port id
  name?: string;
  channel: DiscoveryChannel;
  advertisedServiceUuids?: string[];
}

export interface DeviceMatcher {
  namePattern?: RegExp;              // ej. /RS\s?420|allflex/i
  advertisedServiceUuids?: string[]; // ej. [SPP_UUID]
}

/** La config de un fabricante detrás del contrato de ingesta (RMV1.1). Alias: ReaderProfile. */
export interface ReaderDriver {
  vendorId: string;                  // 'allflex-rs420'
  displayName: string;               // 'Allflex RS420'
  transports: TransportCapability[]; // qué transportes soporta el lector
  frameParser: FrameParser;          // cómo desframea su stream/keystrokes
  deviceMatch: DeviceMatcher;        // cómo reconocerlo al descubrir
  streaming: boolean;                // true = stream por línea; false = keystroke wedge (HID)
}
export type ReaderProfile = ReaderDriver;
```

```typescript
// selection-priority.ts — PURO

import type { AdapterKind } from './adapter-selection';   // union del core (extendido con 'simulator')

export interface ReaderBinding {
  adapterKind: AdapterKind;
  transportKind: TransportKind;
  driver: ReaderDriver;
  available: boolean;                // ¿el adapterKind está construido en este build?
}

export interface BindingEnv {
  platformOS: string;                // Platform.OS
  driver: ReaderDriver;
  builtAdapters: AdapterKind[];      // adaptadores efectivamente construidos (inyectable → testeable)
}

export function platformTransportPriority(platformOS: string): TransportKind[];  // RMV2.1
export function adapterForTransport(kind: TransportKind, platformOS: string): AdapterKind | null; // RMV2.2
export function selectReaderBinding(env: BindingEnv): ReaderBinding | null;      // RMV2.3, 2.4, 2.5, 2.8
```

**Reuso de tipos de spec 09 y del core (NO se redefinen):** `BleStickEvent`, `ConnectionStatus`, `StickAdapter`, `Unsubscribe` se importan de `stick-adapter.ts`; `EidIngestEngine`/`ingestEid`/`ingestRawLine` de `contract.ts`; `useBleStickListener`/`useBusyMode`/`useStickListenerControls` de `stick.ts`; `useBleConnectionStatus` de `connection-status.ts`; `useBleProviderApi` del provider.

## 4. Motor de selección por capacidad (RMV2 — la tabla como función pura)

```
platformTransportPriority(os):
  ios     → ['ble-hid', 'ble-gatt', 'mfi']      # HID > GATT > MFi  (iOS es el cuello de botella)
  android → ['spp', 'ble-gatt', 'ble-hid']      # stream nativo > HID
  web     → ['serial']                          # solo el harness web-serial
  otro    → []

adapterForTransport(kind, os):
  spp + android → 'spp-android'
  serial + web  → 'web-serial'
  ble-hid       → 'hid-wedge'                    # (GATED en el build → available:false)
  ble-gatt      → null                           # sin adapter concreto (futuro)
  mfi           → null                           # gated por negocio (EA/MFi, Facundo)
  resto         → null

selectReaderBinding(env):
  for tk in platformTransportPriority(env.platformOS):
     if env.driver.transports no incluye tk: continue
     ak = adapterForTransport(tk, env.platformOS)
     if ak == null: continue                      # transporte reconocido pero sin adapter buildable → probar el siguiente
     return { adapterKind: ak, transportKind: tk, driver: env.driver,
              available: env.builtAdapters.includes(ak) }
  return null                                     # no alcanzable en esta plataforma → 'no reconocido' + manual (RMV2.5)
```

**Determinismo (RMV2.8):** la elección depende SOLO de `(platformOS, driver.transports, builtAdapters)`, no del orden en que aparecen los devices. Dos runs con las mismas entradas dan el mismo binding. Testeable con tablas de casos: RS420 en android → `{spp-android, spp, available: builtAdapters∋'spp-android'}`; RS420 en web → `{web-serial, serial, available:true}`; **RS420 en ios → `null`** (el RS420 declara solo `spp`+`serial`; en iOS ninguno tiene `AdapterKind` mapeado → no alcanzable → carga manual; su vía iOS real es **MFi** cuando Facundo consiga el `protocolString`, RMV2.5/RMV6.1); un **driver HID genérico en ios → `{hid-wedge, ble-hid, available:false}`** (HID es la dirección iOS-abierta, gated); driver solo-HID en android → `{hid-wedge, ble-hid, available:false}`.

**No rompe `selectTransportAdapter` (RMV2.7):** esa función queda como está para `auto`/`mock`/`manual` (elige el piso a montar por defecto: mock/manual/web-serial). El binding por capacidad es la **capa que usa la pantalla** cuando el operario elige un device concreto. Se agrega SOLO la rama `mode==='demo' → 'simulator'`. Test de regresión: `selectTransportAdapter({platformOS:'web', mode:'auto'})==='web-serial'`, `…mode:'mock'==='mock'`, `…mode:'manual'==='manual'`, `…platformOS:'android', mode:'auto'==='manual'` (idénticos al as-built).

## 5. El simulador y su gate (RMV4 — triple-guard)

**`SimulatorAdapter`** (`adapter-simulator.ts`): un `StickAdapter` con `kind:'simulator'` que, al conectar, marca `'connected'` y expone un método de emisión (`emit(eid?)`) que empuja por `onTagRead` un EID sintético **válido** (de una lista de EIDs demo que pasan `isValidTag`, o generado con prefijo/checksum válido). Respeta `enable/disable` igual que el mock. El provider lo ingiere por `handleReading(value, isRawStream=false)` → mismo contrato (validate + dedup + confirmación pre-commit + feedback). La pantalla, bajo `isDemoMode()`, monta `DemoControls` con un botón "Simular lectura" (y opcional auto-play cada N s) que llama `emit()`.

**Triple-guard (integridad SENASA, RMV4.3–4.5, 4.7):**

```
Guard 1 (selección):  selectTransportAdapter(mode='auto') NUNCA devuelve 'simulator'.
                      Solo mode='demo' → 'simulator'. Prod monta 'auto'. (RMV4.3)
Guard 2 (marca):      isDemoMode() = (globalThis.__RAFAQ_BLE_DEMO__ === true) && isDemoBuildAllowed()
                      donde isDemoBuildAllowed() = (__DEV__ === true) || isExplicitDemoBuild() || isE2eDemoAllowed().
                      isExplicitDemoBuild() lee un flag de build dedicado (ej. Constants.expoConfig.extra.demoBuild),
                      seteado SOLO en un perfil de build 'demo', NUNCA en production/preview.
                      isE2eDemoAllowed() = (globalThis.__RAFAQ_BLE_E2E__ === true): el contexto de E2E/captura
                      (Playwright vía addInitScript, fuera del bundle prod) es no-producción → puede ejercitar la
                      demo seteando AMBOS flags (__RAFAQ_BLE_E2E__ + __RAFAQ_BLE_DEMO__). El flag de E2E por sí
                      solo NO activa el simulador (sigue exigiendo __RAFAQ_BLE_DEMO__). Producción no tiene NINGUNO.
                      La marca la pone deliberadamente el operador ANTES del bundle (addInitScript en web /
                      extra del perfil de demo en nativo); no hay camino desde la UI ni desde input. Un build de
                      producción/preview no tiene __DEV__ ni el flag de demo → simulador imposible. (RMV4.4)
                      [Refinamiento del leader, pre-Puerta 1: el gate original exigía !__DEV__, lo que bloqueaba
                      una demo standalone; se amplía a 'dev O build de demo explícito' manteniendo la garantía
                      prod-safe. Habilitar el demo standalone agrega un perfil/extra de build (colisión-safe).]
Guard 3 (instancia):  instantiateTransport('simulator') re-chequea isDemoMode() antes de crear el
                      SimulatorAdapter (si no, devuelve null). DemoControls re-chequea isDemoMode()
                      antes de montar los controles. (RMV4.5)
```

Consecuencia (RMV4.7): en un **bundle de producción** los tres guards fallan (mode='auto' → no 'simulator'; `isDemoMode()` es false; instancia null) → **no existe camino** para que un EID simulado entre al pipeline y termine declarado ante SENASA. En un build de demo, todo es demo por definición y las lecturas se marcan **"DEMO"** en la confirmación (RMV4.6). **Nota de frontera**: si garantizar la no-declaración exigiera que spec 09 / spec 08 supriman/marquen la declaración de un EID demo, **parar y reportar al leader** (04 no toca la declaración). Este patrón replica y **endurece** el del bridge E2E (backlog LOW-2 pedía gatear la marca también por `__DEV__`: acá se folda desde el diseño).

**Distinción con el mock y el bridge E2E:** el `MockAdapter` (kind `'mock'`) + `BleE2EBridge` existen para **Playwright** (inyección programática, no visible). El `SimulatorAdapter` (kind `'simulator'`) es para **demos humanas en vivo** (controles visibles, marcado "DEMO", auto-play). Se elige un `kind` distinto — en vez de reusar `'mock'` — para poder marcar honestamente las lecturas como demo, con su **propia marca requerida** (`__RAFAQ_BLE_DEMO__`), distinta del `mock`. El gate de demo trata el flag de E2E como un **contexto no-prod válido** para ejercitar la demo en captura/Playwright (`isE2eDemoAllowed()`), pero el modo demo sigue **exigiendo** su marca propia → siguen siendo modos distintos (`mock` invisible vs `simulator` con controles + DEMO). (Ver Alternativa descartada B.)

## 6. `adapter-spp-android` (RMV5) — **AS-BUILT 2026-07-30**

> Esta seccion se reescribio al as-built. El diseno original (pseudocodigo con `LineFramer` sobre los
> chunks, `pairDevice()` dentro del connect, dep nativa sin instalar) describia un adapter que **no
> funcionaba**: ver las notas de reconciliacion bajo RMV5.2/5.3/5.4 en `requirements-multivendor.md`.
> La forma que quedo salio de leer el **codigo nativo** de `react-native-bluetooth-classic`, no su README.
>
> **Segunda reescritura, 2026-07-30**: la review adversarial de `dad711f` + el banco contra el ESP32
> encontraron **cinco defectos mas en los bordes de la maquina de estados**, tres de ellos reproducidos en
> el A07 real. El flujo de abajo ya los incluye; el detalle de cada uno esta en las notas de RMV5.5 y en
> `progress/impl_baston-spp-bloqueantes.md`.

**Flujo real de `connect(deviceId?)`** (cada paso es un estado observable; ninguno bloquea el manual).
`gen` es la GENERACION del intento: un `disconnect()` o un connect nuevo la incrementan, y el intento
viejo —que puede estar suspendido en un await del puente— aborta al despertar, cierra lo que abrio y no
toca el estado. Todo await marcado con `⏱` tiene presupuesto (`bridge-timeout.ts`): sin eso, una promesa
nativa que no resolvia dejaba el latch tomado **para siempre**.

```
   if latch tomado: encolar el target si es OTRO (log connect_superseded) y salir   # 🟠-2
   gen = ++connectGeneration ; latch = gen ; closed = false     # closed DESPUES del guard (P7)
0. cancelReconnect() ; await teardownStreams()     # un intento nuevo invalida el reintento pendiente
1. params = resolveSppParams(driver)       # sppUuid / pin / delimiter del driver (RMV5.2)
   if !sppUuidIsSupported(params.sppUuid):   => 'disconnected'   # la lib hardcodea el UUID RFCOMM
   if !sppDelimiterIsSupported(params.delimiter): => 'disconnected'  # 🟠-5: cortar antes que quedar mudo
2. native = loadRNBC()                     # require PEREZOSO (RMV5.6) + chequeo de NativeModules
   if !native: => 'disconnected'           # sin binario en el APK: NO se reintenta
3. ⏱ perm = await (auto ? checkAndroid… : ensureAndroid…)BluetoothPermissions()   # CONNECT si API>=31
   # el GESTO pide (y espera al dialogo); un camino AUTOMATICO solo consulta: `requestMultiple` sobre
   # un permiso denegado una vez VUELVE a mostrar el dialogo, y un timer no puede hacer eso (R6.4)
   'denied'      => 'permission_denied'    # estado CON CTA; sin backoff (lo reintenta el operario)
   'unavailable' => 'disconnected'         # tambien si el dialogo del SO nunca contesta (vence)
4. ⏱ target = deviceId ?? await readRememberedDevice()  # RMV5.4
   if !target: => 'disconnected'
   currentDeviceId = target                # ANTES de intentar: el reintento va a ESTE device
5. => 'connecting'
6. ⏱ if !(await native.isBluetoothEnabled()):
      if auto: log bluetooth_off_auto => 'disconnected' + scheduleReconnect()   # NUNCA un dialogo
      else:    ⏱ await requestBluetoothEnabledOnce(native)   # coalescido: no pisar mEnabledPromise
               si el operario dice que no (o vence) => 'disconnected' SIN backoff
7. ⏱ device = await native.connectToDevice(target, sppConnectOptions(params.delimiter))
      # connectorType:'rfcomm', connectionType:'delimited', delimiter del DRIVER, charset:'ascii', secure
      # NO se pasa baud (RMV5.7) ni uuid (la lib lo ignora); NO se llama pairDevice() (cuelga)
      # si vence y el nativo resuelve DESPUES: se le cierra el socket (onTimeout) o queda fantasma
   if closed || gen viejo: cerrar el device que llego tarde y salir sin tocar el estado
8. ⏱ await writeRememberedDevice(target) ; if closed || gen viejo || sesion vieja: salir
9. device.onDataReceived(e => { lastDataAt = now
                                for line of splitSppPayload(e.data, params.delimiter): onTagRead(line) })
      # el nativo YA entrega la linea completa sin el terminador => CRUDA al contrato (RMV5.3)
10. native.onDeviceDisconnected(e => {
        if direccion(e) != la nuestra: IGNORAR      # 🔴-2: el evento es GLOBAL (todos los devices)
        teardown + 'disconnected' + scheduleReconnect() })
11. armLivenessProbe(target)   # sonda al volver a foreground        ┐ 🔴 BENCH-1: segunda fuente
    armWatchdog(session, target)  # + poll cada 15 s + log de mudez  ┘ de verdad, no un evento
12. => 'connected'
```

**`scheduleReconnect()`** (RMV5.5): (1) si la cadena vigente tiene TOPE y ya se le paso, la **mata**
(`exhaustUnpromptedChain()`, ver §6-quater); (2) si no hay foreground, espera el retorno a `'active'`;
(3) resetea el contador **solo si el link duro** `LINK_DWELL_MS` (30 s), programa
`backoffDelayMs(attempt)` y —al DISPARAR, no solo al programar— **vuelve a chequear el tope y el
foreground**, en ese orden; si ya no esta en foreground, no conecta y se queda esperando el retorno.

> **El orden (1) antes de (2) no es un detalle**: si el tope se chequeara despues del gate de foreground,
> un timer que dispara con la app en background se parquearia en `waitForForeground()` **sin pasar por el
> tope**, y una cadena vencida quedaria de zombi esperando el retorno a primer plano para volver a
> martillar. O sea: el tope seria evitable guardando el telefono en el bolsillo. Lo encontro la
> autorrevision, con un test que lo caza.

- **Framing = nativo, no `LineFramer`.** `DelimitedStringDeviceConnectionImpl` buffera en Java y entrega
  un mensaje por delimitador, ya sin el LF. `LineFramer` sobre eso devuelve `[]` para siempre.
- **`pairDevice()` no se llama nunca.** Sobre un device ya emparejado, el `createBond()` del nativo no
  dispara broadcast y la promesa no resuelve: el connect quedaba clavado en `'connecting'`. El
  emparejamiento es de sistema (ajustes de Android, PIN `1234` del driver).
- **Reconexion (RMV5.5):** `backoffDelayMs` (reuso), foreground-only, pero con **re-armado** por
  `AppState` cuando el intento cae con la app en background. Estados que a proposito **no** reintentan:
  permiso denegado, Bluetooth apagado tras un "no" del operario, y ausencia del modulo nativo.
- **Sesion de conexion:** un contador invalida los callbacks de una conexion ya cerrada, para que una
  lectura en vuelo no aparezca como caravana despues de un `disconnect()`.
- **Inyeccion de entorno (`SppEnv`):** `loadNative` / `ensurePermissions` / `readRemembered` /
  `writeRemembered` / `isForeground` / `schedule` / `onForeground` (+ `now` y `timeouts` desde el
  2026-07-30) entran por constructor con defaults reales. Es lo que baja el gate de hardware de "toda la
  conexion" a "solo el stream del RS420": la maquina de estados entera se ejercita en `node:test` con
  dobles — incluidas las promesas que **no resuelven nunca**, el reloj (dwell y mudez) y la desconexion
  de OTRO device.
- **Enumeracion de emparejados (`listPairedSppDevices`, RMV3.2):** `getBondedDevices()` normalizado a
  `{id: MAC, name}`. **No hay discovery** => no se pide `BLUETOOTH_SCAN` ni ubicacion. Devuelve
  `{ok:false, reason}` con `unavailable | permission_denied | bluetooth_off | error`, para que la
  pantalla de un mensaje distinto por causa. **Coalescido** (2026-07-30): dos pedidos concurrentes son
  una sola llamada al nativo — no por eficiencia, sino porque dos `requestBluetoothEnabled` solapados
  **pisan** el unico slot de promesa del nativo y dejan la primera huerfana para siempre.

### 6-bis. Las cuatro piezas que agrego la unidad de bloqueantes (2026-07-30)

- **`bridge-timeout.ts` (nuevo, puro).** `withTimeout` / `withTimeoutOr` + `BridgeTimings`. Al vencer:
  (a) le adosa un handler vacio a la promesa abandonada (un rechazo tardio del nativo no puede explotar
  como `unhandledRejection`), y (b) llama a `onTimeout`, que es donde el caller cierra lo que la llamada
  abandonada haya abierto igual. `spp-bridge-timeout-guard.test.ts` **enumera todos** los awaits del
  adapter que arrancan en `native.` / `device.` / `env.` y exige el mecanismo en cada uno: el guard se
  escribe sobre la AUSENCIA, asi que una llamada nueva al puente nace en rojo.
- **Liveness (`verifyLiveness`).** Segunda fuente de verdad del link: `isDeviceConnected(address)`, que
  del lado Java es `mConnections.containsKey` — y ese mapa lo limpian el `ActionACLReceiver` y el error
  del hilo de lectura, dos caminos que corren en Java **aunque el evento nunca llegue a JS** (el nativo
  lo emite con `sendEvent`, que descarta el evento si no hay Catalyst instance activa). Se sondea con el
  string EXACTO con el que se abrio, porque esa es la clave del mapa. Dos disparadores: retorno a
  foreground (instantaneo para el caso del bolsillo) y poll de 15 s (independiente de todo evento y de
  `AppState`, que es lo que acota el techo del "conectado" mentiroso).
- **Modo de ingesta por adapter (`ADAPTER_INGEST_MODE`).** La decision de por que puerta del contrato
  entra una lectura sale de una tabla exhaustiva por `AdapterKind` (`satisfies Record<…>`) y no de una
  comparacion de literales en el provider. Un adapter nuevo no compila hasta declarar su modo.
- **Propiedad exclusiva de `/baston`.** La pantalla llama `acquireScopedScanner()` (RCF.6) dentro de un
  `useFocusEffect` => el `FindOrCreateOverlay` global se auto-suprime mientras esta enfocada. Antes cada
  lectura se consumia dos veces (lista de la pantalla + sheet global tapandola). Por que el scanner
  acotado y no `BLE_OWNED_ROUTES`, y por que `useFocusEffect` y no `useEffect`: nota de RMV3.1.

### 6-ter. R6.4 — el arranque (segunda pasada, 2026-07-30)

`autoConnect()` es el UNICO camino que corre sin que nadie haya pedido nada, asi que es el unico con
una regla propia: **el arranque no pide nada**. Cuatro gates, ordenados del mas barato al que toca el
hardware — y el orden es parte del diseno, no una casualidad:

```
autoConnect()                                  # el provider la llama 1 vez al montar el transporte
  0. ya hay link / hay intento en curso                            => skip('busy')
     # OJO: acá NO se mira `closed` ("el operario desconecto"), y es deliberado. `disconnect()`
     # significa dos cosas opuestas segun quien lo llame —el gesto del operario, o el cleanup del
     # efecto del provider— y el unico que puede re-invocar `autoConnect()` es el segundo, asi que
     # ese gate MATABA R6.4 en silencio (hallazgo 14 de la autorrevision, con test que lo caza).
  1. !isForeground()                                             => skip('background')       # R6.9
  2. ⏱ remembered = await readRememberedDevice()                                 # LECTURA LOCAL
     if (!remembered) => skip('no_remembered')   # arranque en frio: NO se toca la radio, y NO se
                                                 # consulta el permiso (por eso este gate va PRIMERO)
  3. native = loadRNBC() ; if (!native) => skip('unavailable')
  4. ⏱ perm = await checkAndroidBluetoothPermissions()      # CONSULTA, no pide (PermissionsAndroid.check)
     if (perm !== 'granted') => skip('permission')           # el prompt lo dispara un GESTO
  5. ⏱ enabled = await native.isBluetoothEnabled()           # lectura, sin dialogo
     if (!enabled) => skip('bluetooth_off')                  # el dialogo de activar lo pide un GESTO
  6. runConnect(remembered, auto=true)           # de aca en adelante es el connect() normal
```

- **`skip()` NO emite ningun estado.** Se queda en `'off'`, que es el estado honesto de "nunca se
  intento" (`"Bastón sin conectar"` + CTA `"Conectar bastón"`, y el `StickStatusIndicator` se
  auto-oculta en `'off'`). Emitir `'disconnected'` seria mentir ("se apago, quedo fuera de rango o
  cancelaste") sobre algo que no paso, y le pondria un pill en el chrome a alguien que no pidio nada.
  El motivo queda en el log (`autoconnect_skipped`, 6 motivos) porque desde la UI los 6 se ven igual.
- **El fallback de `isBluetoothEnabled` es `false` aca y `true` en `doConnect`**, a proposito: en el
  arranque la duda NO habilita a tocar la radio (nadie pidio nada); en el gesto el operario SI pidio
  conectar, y el error real lo da el `connectToDevice`.
- **`autoConnect` es opcional en `StickAdapter`** y hoy la implementa solo `spp-android`. No es olvido
  de los otros cuatro: `web-serial` **no puede** (la Web Serial API exige un gesto para
  `requestPort()`), `manual` no tiene transporte fisico, y `mock`/`simulator` los conecta su propio
  disparador. `wiring.test.ts` lo fija como decision escrita (y de paso deja las ~70 specs E2E —que
  corren en `mock`— sin ningun riesgo).
- **Config plugin (RMV5.8):** la lib **no trae uno** => `app/plugins/with-bluetooth-classic.js`. Ademas
  de declarar los permisos, **topea el `ACCESS_FINE_LOCATION` que la lib inyecta sin tope**.
- **Montaje (as-built):** `selectTransportAdapter({android, auto})` => `'spp-android'`;
  `instantiateTransport('spp-android')` => `isSppNativeAvailable() ? new SppAndroidAdapter() : null`.
  El guard es deliberado: sin el modulo nativo en el APK (dev build viejo) montar el adapter seria un
  transporte fantasma => chip y CTA que prometen y no cumplen. Sin tocar el contrato ni los otros
  adaptadores (core R11.3).

### 6-quater. El TOPE de la cadena que nadie pidio (tercera pasada, 2026-07-30)

R6.4 introdujo un defecto: el reintento infinito, que antes exigia un gesto deliberado, ahora arranca
solo en cada apertura. Un baston vendido / roto / que quedo en otro campo deja la app permanentemente
con cara de rota, martillando la radio, y `scanning` no tiene CTA para frenarla.

La politica se declara por **ORIGEN de la cadena** —no por estado— en una tabla exhaustiva
(`connect-trigger.ts`, `satisfies Record<ConnectTrigger, TriggerPolicy>`), que reemplazo al booleano
`auto` de `doConnect`:

| trigger | ¿dialogos del SO? | efecto en la cadena |
|---|---|---|
| `operator` (un tap) | ✅ el unico | `start-unbounded` — el operario esta tratando de conectar |
| `autoconnect` (el arranque, R6.4) | ❌ | `start-capped` — nadie la pidio: 120 s |
| `retry` (el timer) | ❌ | `inherit` — continua la cadena vigente |

- **`retry` DEBE heredar.** Si arrancara cadena, re-armaria el presupuesto en cada vuelta y el tope no se
  alcanzaria nunca: la cadena infinita disfrazada. Un test lo fija (y el mutante que lo prueba rompe 6).
- **120 s, contra la escalera de backoff.** `backoffDelayMs` da 500·1000·2000·4000·8000 y de ahi 8 s
  fijos → 15,5 s de rampa y despues un poll de 8 s. Tiene que cubrir "abri la app al llegar, camine hasta
  la manga y prendi el baston un minuto despues" y NO cubrir "ese baston lo vendi". 120 s es el doble del
  escenario a cubrir; 60 s seria igual al escenario, sin margen para el boot del lector. En intentos son
  ~18 si el nativo resolviera al instante y ~6-7 con el baston ausente (cada `connectToDevice` bloquea
  ~10 s antes de rendirse) — por eso el tope se mide en TIEMPO, no en intentos.
- **`exhaustUnpromptedChain()`**: deja de reintentar · **no olvida** el device recordado (que hoy no
  aparezca no significa que no sea su baston; olvidarlo le rompe el arranque de manana) · emite `'off'`,
  que **si** tiene CTA (a diferencia de `scanning`, que era la trampa) y que es el unico estado que el
  `StickStatusIndicator` se auto-oculta → no se le toma el chrome a alguien que no pidio nada · el
  contador de backoff vuelve al piso, asi que el tap del operario reintenta a los 500 ms.
- **EL PRESUPUESTO MUERE AL CONECTAR** (fix-loop del 2026-07-30, 🔴-A del review / HIGH-1 del Gate 2).
  `retryBudgetUntil = null` en el punto donde el link se establece. Sin eso el tope no acotaba la cadena
  sino **los primeros 120 s de vida de la app**: el primer corte posterior mataba la reconexion automatica
  de toda la sesion, con 0 reintentos, el pill oculto y un diagnostico inventado en la pantalla. El
  invariante: el presupuesto pertenece a la CADENA, y una cadena que llego a `'connected'` TERMINO — el
  motivo del tope ("ese baston lo vendi") deja de aplicar en el instante en que el baston contesta.
  Cubierto por 5 tests que **distinguen el bug del arreglo** (el reviewer habia probado que los 8 casos
  originales del bloque `TOPE:` no lo hacian: su mutante M7 pasaba 104/104).
- **Un tap del operario SIEMPRE destopa**, incluso con el latch tomado y sin nada que encolar (el camino
  del chip del header, `connect()` sin target). Antes era un no-op mudo que se comia el destope.
- **La honestidad sin cambiar el estado**: `connectionStatusView` gana `autoConnectExhausted` (OPCIONAL en
  su `ConnectionEnv`) → en la pantalla de conexion el copy es "No encontramos el baston / puede estar
  apagado o fuera de rango" en vez de "Conecta el baston", que sonaria a que nunca se intento. El
  indicador global NO pasa el flag y sigue con el copy generico, que para el es cierto.
- **Guard sobre la ausencia** (`connect-trigger.test.ts`): se escanean **todos** los `runConnect(` del
  adapter y se exige que pasen un trigger LITERAL conocido → un camino nuevo que arranque reintentos sin
  declarar su origen nace en rojo. Mas el guard de coherencia en `wiring.test.ts`: el adapter tiene que
  DERIVAR la politica con `policyFor()` y el booleano `auto` no puede volver.

## 7. `StickConnectionScreen` + indicador (RMV3) — dónde la monta la nav

- **Ruta:** en la sección **"Más"** (ADR-018: la pantalla de conexión vive en "Más"; el listener es global, no una tab). El wiring de la entrada de ruta se coordina con el shell de nav; la pantalla en sí es 04-territory (`features/ble-stick/`).
- **Flujo por adaptador (RMV3.2):** la pantalla lee el `ReaderBinding` activo (vía `selectReaderBinding` con el driver del device elegido) y renderiza la sub-UI correcta: SPP → listar/elegir/olvidar devices (usa `remembered-device.ts`); web-serial → botón `requestPort` + lista `getPorts`; HID → instrucción de parear el teclado en el SO + campo de scan (GATED). Estados con CTA desde `connection-view.ts` (RMV3.4).
- **`available:false` (RMV3.7):** si el binding del device elegido tiene `available:false` (HID gated / SPP sin dev build), la pantalla muestra "reconocido, no disponible en este build todavía" + CTA a la carga manual, **sin** intentar conectar.
- **Device no reconocido (RMV3.8):** si `findDriverForDevice` devuelve `null`, la fila se marca "no reconocido" + fallback manual.
- **No bloqueante (RMV3.6):** `blocksManualEntry()` del core es `false` siempre; la pantalla nunca gatea la carga manual.
- **Indicador global (RMV3.5):** `StickStatusIndicator` en el chrome, alimentado por `useBleConnectionStatus()`. Reactivo al `connection_changed` que el provider ya emite.
- **Demo (RMV4.6):** bajo `isDemoMode()`, la pantalla monta `DemoControls` (botón "Simular lectura") y marca las filas de lecturas del simulador como **"DEMO"**.

El harness `app/app/baston-test.tsx` (dev, self-contained) se **mantiene intacto**: es otro artefacto (web-serial contra el RS420 real de la notebook). La `StickConnectionScreen` es la de **producción/demo** y consume el provider global.

> **Reconciliación as-built (MV.4, 2026-07-20).** Construido en `app/src/features/ble-stick/` (`connection-view.ts` puro + `screens/StickConnectionScreen.tsx` + `components/{StickDeviceRow,StickStatusIndicator,DemoControls}.tsx`), consumiendo el provider global (`useBleProviderApi` + `useBleConnectionStatus`) — sin provider propio (RMV3.1). Detalles que difieren de la redacción original de §7 por respetar la **interfaz `StickAdapter` del core (congelada)**:
> - **Web-serial "listar `getPorts`":** la interfaz `StickAdapter` del core NO expone `getPorts`/`requestPort` a la pantalla (solo `connect/disconnect/onTagRead/onStatus/enable/disable`). Por eso la pantalla NO renderiza una lista in-app de puertos: la **lista/elección** de web-serial es el **diálogo NATIVO de puertos COM del navegador** (que se abre con el gesto del CTA "Conectar bastón" → `transport.connect()` → `requestPort`), que ES la lista del SO y la única accesible desde una web app. La reconexión silenciosa por `getPorts()` sigue viviendo DENTRO del `WebSerialAdapter` (core, `connect('remembered')`), no en la UI. Extender la interfaz para exponer un `listDevices()` queda como mejora futura (tocaría el core congelado → fuera del delta).
> - **`writeRememberedDevice` (RMV3.3):** al elegir la fila reconocida-conectable se persiste el `driver.vendorId` como **marcador de reconexión** (no una MAC real, que no existe en el path web-serial). Cuando el `adapter-spp-android` real (Fase 4/gated) aterrice, recordará la MAC del device elegido de la lista de bonded; el contrato de persistencia (`remembered-device.ts`) no cambia.
> - **Fila del device:** `deviceRowView` agrega un estado `recognized-unreachable` (driver reconocido pero `selectReaderBinding` = null en la plataforma, ej. RS420 en iOS → manual, RMV2.5) además de los de RMV3.7 (`available` true/false) y RMV3.8 (`unrecognized`). Todos NO bloqueantes.
> - **Indicador global (RMV3.5):** `StickStatusIndicator` se monta en `app/app/_layout.tsx` (`BleHost`, hermano del stack de navegación, dentro del `BleStickListenerProvider`) — NO tocó ningún archivo/contrato de spec 09. `pointerEvents="box-none"` (no roba toques) + auto-oculto en estado `off` (invisible en pantallas normales; visible durante la actividad del bastón/demo).
> - **Posición del indicador — RESUELTO en el veto de Gate 2.5 (2026-07-20):** el veto encontró que el anclaje inicial (`top = insets.top + $2`, pill centrado arriba) **se solapaba con el título del header** de cualquier pantalla. As-built final:
>   1. **Anclado al FONDO** (centrado horizontal) → queda por encima de la bottom tab bar y del pico del FAB elevado, y **nunca pisa un título de header** en ninguna pantalla. No bloqueante (`box-none`/`none`) intacto.
>      **As-built desde la unidad «aire» (2026-07-26)**: `bottom = useSafeBottomInset() + $navBar + $fabRaise + $2` (antes: `insets.bottom + $navBar + $fabRaise + $2`). Es la única diferencia de comportamiento **en web** que introdujo esa unidad, y es un fix, no un efecto colateral: el pill se posiciona RELATIVO a la tab bar, así que su primer término tiene que ser el **`paddingBottom` real del nav**, no el inset pelado. Con el inset pelado, en web (inset 0) el borde inferior del pill caía en `0 + 60 + 26 + 7 = 93`, mientras que el pico del FAB elevado está en `98` (`$navBar` 60 + los 12 de `paddingBottom` del nav + `$fabRaise` 26) → **el FAB tapaba el pill por 5px**. Con la reserva compartida da `12 + 60 + 26 + 7 = 105 = 98 + $2`, o sea el gap pedido POR ENCIMA del pico del FAB, en las cuatro plataformas y por construcción (si mañana cambia la reserva del nav, el pill la sigue sola). iOS no se mueve (127 antes y después); Android sube 16 igual que el nav.
>   2. **Suprimido en `/baston`** (guarda `usePathname() === '/baston' → null`, entre `isNonDemoE2E()` y el auto-oculto `off`): ahí es redundante con la card de estado de la propia pantalla y competía con el título. En el resto del chrome (home, alta, etc.) sí se muestra — que es el rol de RMV3.5 (estado del bastón en pantallas sin card propia).
>   Verificado en captura (Gate 2.5): shots 05/06 = card de `/baston` limpia sin pill encima; shot 07 = indicador anclado al fondo en `/crear-animal` (pantalla con header + CTA), sin solape con el título. La demostración de RMV3.5 en `/crear-animal` en vez de la home es una limitación del E2E (una nav "cruda" a la home remonta el provider raíz y resetea la conexión a `off`; el único `router.push` client-side desde `/baston` que preserva la conexión es "Dar de alta" → alta) — la geometría garantiza el no-solape igual en la home. **[CERRADO el 2026-08-05 — ver la reconciliación de abajo. Las dos cláusulas de este párrafo quedaron VIEJAS: (1) el shot 07 ya no es `/crear-animal` sino el **tab "Más"** (`baston-multivendor.capture.ts`), y (2) "Dar de alta" dejó de ser la única navegación client-side que sale de `/baston` con la conexión viva — la vuelta a "Más" por el chevron (`backOr`) también la preserva, y **es la que usa la captura restaurada**. En el medio el shot 07 estuvo CAÍDO (2026-07-30, BENCH-3): el "Dar de alta" se suprimió ahí a propósito y, sin la fila de "Más", no quedaba ninguna nav client-side de salida.]**
> - **Ruta en "Más":** la ruta `/baston` queda registrada (`<Stack.Screen name="baston" />` + `app/app/baston.tsx`) y alcanzable por deep-link; la **fila de `(tabs)/mas.tsx`** que navega ahí queda pendiente de coordinación (mas.tsx es de otra terminal, colisión-safe — no se tocó en este run). **[CERRADO el 2026-08-05 — ver la reconciliación de abajo.]**

> **Reconciliación as-built (bugfix 2026-07-29 — barrida de afordancias sin transporte).** Disparador: Raf reportó en device Android que *"el botón de conectar bastón en android no me está funcionando"*. La causa está en spec 09 (el chip del header), pero la barrida encontró la MISMA clase de defecto en esta pantalla: **elementos que ofrecen conectar sin mirar si hay un transporte instanciado**. En native no hay adapter de transporte construido (`react-native-ble-plx` no está instalado; `selectTransportAdapter` devuelve `'manual'` → `instantiateTransport` devuelve `null`), así que todo `transport?.connect()` es un no-op silencioso. **La condición es "no hay transporte", NO "es Android"**: cuando la Fase 4 aterrice el adapter SPP, todo esto vuelve solo sin tocar código. As-built:
> - **`connectionStatusView(status, { hasTransport })` (firma nueva, RMV3.4).** Sin transporte corta **antes** del `switch` y devuelve `{ label: 'Bastón no disponible', hint: 'Todavía no se conecta en este dispositivo. Cargá las caravanas a mano.', cta: 'none', ctaLabel: null, tone: 'idle' }`. Antes, el CTA se ocultaba en el COMPONENTE (`showStatusCta = view.cta !== 'none' && hasTransport`) pero el **copy seguía prometiendo** ("Bastón sin conectar / Conectá el bastón para leer caravanas sin tocar la pantalla"). Ahora hay una sola decisión y es pura; el componente quedó en `showStatusCta = view.cta !== 'none'`.
> - **`deviceRowView({ ..., hasTransport })` (RMV3.7).** El `binding` responde *"¿este build sabe hablarle a este lector en esta plataforma?"* (capacidad de BUILD, `selectReaderBinding` contra `BUILT_ADAPTERS`); el transporte responde *"¿hay un adapter instanciado ahora?"* (`selectTransportAdapter` + `instantiateTransport`). **Son dos fuentes distintas que pueden discrepar**, y tocar la fila llama `transport?.connect()`. Hoy en Android coinciden por casualidad (spp-android no está ni en `BUILT_ADAPTERS` ni instanciado); **el día que la Fase 4 agregue `'spp-android'` a `BUILT_ADAPTERS` sin tocar `selectTransportAdapter`, la fila diría "Tocá para conectar" y no pasaría nada, con toda la suite en verde**. Sin transporte, la fila cae a `recognized-unavailable` — que es literalmente cierto (el build no lo construyó) y no agrega estado nuevo al union. **Alcance honesto (medido, no estimado): hoy este cambio es NO-OP en las 3 plataformas** — Android entra por `available:false`, iOS por `binding === null`, web evalúa `true && true`. O sea es **endurecimiento preventivo de una trampa de Fase 4**, no un defecto vivo (a diferencia del chip, que Raf sí chocó en su device).
> - **`TransportInstructions`**: el guard pasó a `if (!binding.available || !hasTransport)` → sin transporte no se dan instrucciones de un pairing imposible ("Tocá «Conectar bastón» y elegí el puerto COM…").
> - **`readsEmptyHint(hasTransport)` (nuevo, puro)**: el estado vacío de la lista de lecturas también decía *"Conectá el bastón y bastoneá un animal"*. Vive en `connection-view.ts` —y no inline en el JSX— para que **toda** respuesta a "¿esto promete conectar?" se decida y se testee en un solo archivo.
> - **`StickStatusIndicator` (RMV3.5)**: consume `useBleProviderApi()?.transport != null` y se auto-oculta sin transporte, además del auto-oculto en `'off'` que ya tenía. Hoy es equivalente (sin transporte el único estado alcanzable es `'off'`); es explícito para alimentar la vista pura y para cubrir el transitorio en que el transporte se desmonta en caliente con un status previo pegado.
> - **`hasTransport` es parámetro OBLIGATORIO** en las tres funciones (`connectionStatusView`, `deviceRowView`, `readsEmptyHint`): un call site nuevo tiene que decidirlo explícitamente, no heredar un default optimista que reintroduzca un CTA muerto.
> - **`ConnectionStatusView.icon` (campo nuevo, `StatusIconKey`)** — cierre del último elemento de la card que NO pasaba por la vista pura. El componente derivaba el ícono con un `statusIcon(status)` propio, del **status crudo**, así que podía contradecir al label (ícono de "conectado" sobre "Bastón no disponible"). Era inalcanzable hoy (sin transporte el provider solo suscribe `onStatus` dentro de `if (transport)`, así que el único estado posible es `'off'`), pero es la misma clase de trampa que el punto anterior: una decisión de presentación viviendo fuera del archivo donde se decide y se testea. Ahora la vista devuelve la CLAVE y `StickConnectionScreen` solo mapea clave→componente lucide (`STATUS_ICONS`) — la traducción es lo único que no puede vivir en el módulo puro (importar lucide en runtime rompe el loader de node:test).
> - **Verificación (medida, no estimada)**: `connection-view.test.ts` pasó de **9 a 17 casos** (los **8 nuevos** cubren las dos ramas de transporte, el invariante "ninguna fila es accionable sin transporte" sobre las 4 combinaciones, y el ícono). Falsificado: neutralizar el corte deja **4 casos en rojo en este archivo** (6 sobre los 22 de los dos módulos puros, contando `components/ble-connection-view.test.ts`). Capture de Gate 2.5: `e2e/captures/baston-chip-sin-transporte.capture.ts` shots 03 (sin transporte) vs 09 (con transporte).

> **Reconciliación as-built (2026-08-05 — «acceso in-app a la pantalla del bastón»).** Disparador: Raf, en device. Abrió la app, el chip global quedó ciclando *"Conectando…"* (la reconexión automática de R6.4 con el ESP32 apagado) y **no tuvo ninguna manera de llegar a `/baston`** para cortarlo ni para revisar. La ruta existía desde el 2026-07-20 pero su **única** entrada era el deep-link: la fila de "Más" había quedado como coordinación pendiente entre terminales (ver el bullet "Ruta en «Más»" de arriba), o sea RMV3.1 afirmaba un punto de entrada que no existía. As-built:
>
> - **`(tabs)/mas.tsx` → sección "Bastón" + `ActionRow` a `/baston`** (componente local `StickRow`). **Ubicación: después de la card de Perfil, antes del bloque "Campo activo".** El bastón se empareja con el **teléfono**, no con el campo: meterlo en ese bloque sería semánticamente falso y —peor— el bloque entero está gateado por `activeField != null`, así que la fila desaparecería justo cuando el usuario no tiene campo resuelto. **Sin gate de rol**: conectar el bastón es trabajo de manga, no una acción administrativa. Ícono: `StickIcon` del registro central (`@/theme/icons`, = `ScanLine`) — el mismo glifo con el que la app ya representa el bastón en `TagScanCta`, `TagScanSheet`, `maniobra/identificar` y la propia `StickDeviceRow` de `/baston`. Se descartó `Bluetooth`/`BluetoothConnected` (los del chip) porque nombran el **transporte**, no el dispositivo, y en esta fila el objeto es el bastón; y `Radio`, porque en esta misma pantalla ya rotula "Asignar caravanas en masa".
> - **El trailing es el estado de conexión EN VIVO** (`useBleConnectionStatus()` + `useBleProviderApi()?.transport != null`, las mismas dos fuentes que el chip). Es lo que responde el reporte original: enterarse **sin entrar**. El copy sale de **`connectionRowStatus(status, env): { text, tone }`**, función PURA nueva de `connection-view.ts` — NO se deriva inline en `mas.tsx`, que es exactamente el defecto que ese archivo cerró el 2026-07-29 (*"una decisión de presentación viviendo fuera del archivo donde se decide y se testea"*). Copy corto por estado: `Conectado` / `Conectando…` / `Reintentando…` / `Desconectado` / `Sin permiso` / `Sin conectar` / `No encontrado` (R6.4, auto-connect agotado) / `No disponible` (sin transporte, corte ANTES del switch igual que `connectionStatusView`).
> - **La fila NO se oculta sin transporte** (a diferencia del chip, que se auto-oculta): es el ÚNICO camino in-app a la pantalla, y esa pantalla es la que explica la salida manual. Lo que cambia es que el trailing dice la verdad. Mismo criterio —y mismo argumento— que la fila de "Asignar caravanas en masa" (bugfix 2026-07-29).
> - **`toneColorToken(tone)` se exporta desde `connection-view.ts`** (puro: devuelve el NOMBRE del token, no importa Tamagui) para que el call site nuevo no invente una cuarta traducción tono→color. Las tres copias privadas que ya viven en `StickConnectionScreen`, `StickDeviceRow` y `StickStatusIndicator` **no se tocaron** (barrido cross-file, fuera del alcance de esta unidad; y una de ellas vive en el chip global, congelado por otra unidad en curso). **Y no son intercambiables entre sí** (🟠-1 del review, medido): `StickDeviceRow:21` manda `'progress'` a la rama del `default` junto con `'idle'` → **`$textMuted`**, donde las otras tres dan **`$primary`**. Hoy es inalcanzable —`deviceRowView` nunca emite `tone:'progress'`; sus cinco estados son success/idle/warning— así que no hay bug vivo, pero **el barrido futuro NO es un no-op**: unificar cambia un color (en un camino hoy muerto, hacia el valor de las otras tres). Queda escrito acá y en el doc comment de la función para que el próximo no lo descubra en producción.
> - **`StickConnectionScreen`: `backOr(router, '/(tabs)/mas')`** en el chevron del header, en vez del `router.back()` pelado. Era el **último** de la app (el barrido del 2026-07-23 blindó 15 pantallas y dejó solo esta, excluida por ser territorio de otra terminal). Va en esta unidad porque recién ahora "Más" es el origen REAL de la pantalla: antes se llegaba por deep-link, o sea con el stack vacío, que es justo el caso en el que `back()` es un no-op silencioso y deja al usuario trabado. Sin test propio (`nav.test.ts` ya cubre `backOr`); la rama `router.back()` la ejercita el E2E (e).
> - **Verificación (medida, no estimada)**: `connection-view.test.ts` pasó de **29 a 37 casos**; los 8 nuevos son exhaustivos sobre `ConnectionStatus` × `{con, sin}` transporte × `{agotado, no}` e incluyen un **invariante duro: el `tone` de la fila NUNCA puede diferir del de `connectionStatusView` para la misma entrada** (la fila no puede pintarse de "conectado" mientras la card dice "no disponible"), un techo de largo del texto (≤16 caracteres: es un trailing, no una frase) y la prohibición de repetir la palabra "Bastón" (ya es el label de la fila). Falsificado: mutar la rama sin transporte a un copy largo + tono `success` deja **5 casos en rojo**. E2E: `baston-multivendor.spec.ts` casos **(e)** (Más → fila → `/baston` + vuelta por el chevron) y **(f)** (contrafáctico sin transporte: la fila SIGUE, dice "No disponible" y navega igual) — **6/6 verde**. Capturas del Gate 2.5: `07-indicador-global-chrome` **restaurada** (ahora hay una navegación client-side real que sale de `/baston` con la conexión viva), más `08-mas-fila-baston` (ubicación de la sección) y `09-fila-mas-baston-conectado` (trailing en vivo).

> **Reconciliación as-built (2026-08-06 — «el FAB de Maniobra le roba los taps a la banda de arriba del nav»).** Bugfix 🔴 reportado por Raf en device (*"el pill de «Conectando…» que se ve arriba del rayo de modo maniobra, si lo clickeo me lleva al modo maniobra"*). Toca RMV3.5. **RMV3.6 NO cambia** — se intentó cambiarlo (pill tocable) y se revirtió el mismo día con evidencia medida: ver la nota de ese EARS.
>
> - **La causa NO estaba en el pill: estaba en el FAB.** `app/(tabs)/_layout.tsx` le daba al `Pressable` del FAB un `hitSlop={{ top: $fabRaise }}` (26 dp), o sea su TARGET se extendía 26 dp por encima del círculo pintado — justo adentro de la banda donde este delta ancla el pill, que flotaba a 10 dp. Medido con dos métodos independientes: **web** (cajas del DOM @412×915: pill `bottom=810`, círculo `top=820`, techo del target `y=794` → **solape de 16 dp = 48 % inferior del pill**) y **device A07** (720×1600, densidad 300: techo PINTADO `y=1324` medido con Pillow sobre `screencap`, techo TÁCTIL `y=1276` medido con barrido de `adb shell input tap` → 48 px = 25,6 dp ≈ `$fabRaise`; **mismo 48 %**). El `top` se **sacó**; el `bottom` (que hace tocable el label "Maniobra" y crece hacia dentro del nav, donde no hay vecinos) se conserva.
> - **Que el pill sea `pointerEvents="none"` NO evitaba el bug** — es el razonamiento fácil que hay que descartar de entrada: el toque atravesaba el pill y caía en lo que había debajo, y lo que había debajo era el target inflado del FAB. Por eso el invariante se mide contra la banda **PINTADA** del pill: es lo que el operario percibe como "una cosa", tenga o no `onPress`.
> - **La justificación escrita en `_layout.tsx` era FALSA y por eso nadie sospechó del FAB.** Afirmaba en negrita que el `top` *"NO recupera un solo píxel HOY, en NINGUNA de las dos plataformas"*. Lo verificado era el paquete de **web** (`hitSlop` es no-op en react-native-web 0.21.2: `Pressable` no lo implementa) y de ahí se **generalizó a nativo sin medirlo**. También cae la premisa que motivaba el `top`: el mismo barrido de device mostró que el target dispara **86 px por encima** del techo de la barra (`y=1362`), o sea que el tabBar **no recorta** los toques → sacar el `top` no puede crear una zona muerta. La entrada de `docs/backlog.md` del 2026-07-18, cerrada como *"no se reproduce"*, quedó corregida: su hipótesis **(a)** era la correcta.
> - **El indicador sigue siendo INFORMATIVO** (contenedor `box-none`, pill `pointerEvents="none"`, sin `onPress`, sin rol de botón, nombre accesible por `labelA11y`). El intento de volverlo tocable y su reversión con los números están en la nota de RMV3.6; el guard `(E)` y `e2e/fab-target-geometry.spec.ts` impiden que vuelva sin que alguien lea esa evidencia.
> - **Geometría nueva**: el gap del pill pasó de `$2` (7) a **`$4` (18)** → **20 dp** de separación efectiva entre el borde de abajo del pill y el techo del target del FAB (`gap + $navItemTop`), antes 9-10. No es separación entre dos *targets* (el pill no lo es): es aire visual —con 10 dp el pill y el círculo se leían como una sola pieza pegada— **y margen de seguridad** contra un slop futuro del FAB.
> - **Nombre accesible de la fila de "Más" centralizado** (`STICK_ROW_ACTION` + `connectionRowA11yLabel`, puros en `connection-view.ts`): `mas.tsx` dejó de armarlo inline, que es el defecto que ese archivo cerró el 2026-07-29. **Efecto lateral as-built**: el nombre pasó de `Bastón: Conectando…. Abrí…` a `Bastón: Conectando… Abrí…` (el separador ya no duplica la puntuación cuando el estado termina en `…`), con el texto visible contenido verbatim (WCAG 2.5.3). Los matchers de la E2E se relajaron en consecuencia (sin el punto literal).
> - **Título de sección de "Más": "Bastón" → "Dispositivos".** Con una sola fila homónima, el título no agrupaba nada (tautología) y repetía la palabra dos veces en la misma pantalla. "Dispositivos" escala al hardware que ya está en el roadmap (balanza, impresora de caravanas) y **espeja la sección "Dispositivos" que la propia `/baston` tiene adentro**. Efecto colateral cerrado: esa homonimia rompe en strict-mode los `getByText('Dispositivos')` de la E2E cuando se navega client-side (el tab queda montado detrás del Stack) → la sección de `/baston` lleva `testID="stick-devices-section"` y las 4 specs/captures que la anclaban pasaron a `getByTestId`.
> - **LOS GUARDS (el entregable central).** Escritos sobre el INVARIANTE y no sobre la instancia: hoy el pill es la única superficie en esa banda, así que un test sobre el pill se quedaría verde para siempre mientras el mecanismo sigue disponible. **La primera versión estaba escrita sobre la FORMA en que hoy se escribe el bug y el reviewer la burló en una línea** (`hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}` → 30/30 en verde; y un overlay anclado con `$navBar + $6`, que da el pico exacto del FAB, también pasaba). Reescritos:
>   1. **`src/utils/nav-target-bands.ts` + `.test.ts`** (puro, node:test, **27 casos**): deriva de los tokens las bandas verticales del target del FAB y del pill y exige separación ≥ `MIN_TAP_TARGET_SEPARATION` (16 dp — el doble del mínimo de Material, por el uso con guante) en las cuatro reservas de plataforma. Incluye el CONTRAFÁCTICO con los tokens de `1f1c002` (da −17 dp de solape, contra los −16 medidos: el modelo ignora el borde de 1 px del tabBar, a propósito y del lado seguro). **La segunda mitad del módulo es el RESOLVEDOR** (`evaluateDp`, `resolveInsetSides`, `resolveFabHitSlop`, `resolveByReserve`, `sizeTokenFromConfig`): traduce un fuente de producción a números en dp —siguiendo spreads, consts, `X.y`, `Math.max/min`, tokens del config— y es **fail-closed**: lo que no puede leer, tira. Lo usan el guard estático **y** el E2E, así que hay UNA sola traducción del fuente y no dos aproximaciones que puedan divergir.
>   2. **`src/utils/tap-target-collision-guard.test.ts`** (estático de CLASE, **22 casos**): **(A)** el VALOR de todo `hitSlop` del árbol tiene que poder leerse de UN solo lugar — literal numérico ≤12 o identificador PELADO declarado en el mismo archivo y registrado; un spread, un ternario, una llamada o un objeto inline caen; **(A-fix)** el target del FAB no excede su círculo pintado salvo hacia abajo — **no cuenta claves: resuelve el VALOR** del `hitSlop` que usa el JSX y lo compara contra el que sale de los tokens (`top=left=right=0`), así que la gramática es irrelevante; **(A-fix bis)** el resolvedor es fail-closed, verificado in-place; **(B1)** nadie ancla nada por encima de la reserva inferior sin registrarse — la firma es **mencionar la reserva** (con vocabulario DERIVADO por archivo: cualquier alias de `useSafeAreaInsets`/`useSafeBottomInset` cuenta), no "sumar" sobre ella; **(B1-bis)** si el valor de una prop sale de la reserva, la prop tiene que ser una que el guard sepa medir — `bottom` (que se convierte en coordenada) o la familia `padding` (que reserva espacio y no coloca): **todo lo demás nace en rojo** (`marginBottom`, `translateY`, `top`, `inset`, un `style={fn(reserva)}`…), y los hand-offs puros a un hijo van a un registro con lo que hace el receptor; **(B-banda)** estar registrado NO alcanza — se resuelve el anclaje real de cada superficie registrada y se exige que despeje el techo del target REAL del FAB por ≥16 dp **en las cuatro reservas de plataforma**; **(B2)** nadie lee los tokens de geometría del nav (`$fab`, `$fabRaise`, `$navBar`, `$navItemTop`, `$navBottomMin`) sin registrarse; **(C)** los números que los tests copian coinciden con los tokens REALES (evalúa `Math.round(FAB_SIZE * FAB_RAISE_RATIO)`) y **el E2E no tiene espejo**; **(D)** el código de producción lee esos tokens; **(E)** el pill no puede volver a ser tocable. Más los inversos de los dos registros y una **auto-verificación de balanceo de llaves con la línea culpable** (un archivo que desbalancea el blanqueo compartido rompe `assertScanCoverage` y voltea guards ajenos: pasó el 2026-08-06 con 10 rojos en `check.mjs`, y el síntoma quedaba a cinco guards de la causa).
>   3. **`e2e/fab-target-geometry.spec.ts`** (geométrico, 2 casos): **no** intersecta rectángulos —ese oráculo se probó y da falso positivo, porque un rect no sabe de z-order: reportaba la card "Completá el RENSPA…" del tab "Más", que cruza al FAB pero está detrás de la barra—. **Muestrea puntos con `document.elementFromPoint`** sobre la franja que el `hitSlop` agrega FUERA de la pintura del FAB (288 puntos, paso de 2 dp) y exige que ninguno le pertenezca a otro control. Con `left/right = 0` esa franja está enteramente dentro de la celda del FAB, así que la aserción es acotada a propósito; lo que la sostiene es la **auto-falsificación in-place**: el mismo medidor con el `hitSlop.top` histórico tiene que ver al pill, sobre ese mismo build. El segundo caso asierta que el pill **no intercepta** el toque (`pointerEvents` computado + `elementFromPoint` en su centro + un tap táctil real) en dos pantallas.
>
>   Los dos primeros están **registrados en la lista explícita de `scripts/run-tests.mjs`**. **Por qué hacían falta tres y ninguno de comportamiento**: `hitSlop` es no-op en react-native-web, así que **ninguna E2E web puede ver este bug** — un "toco el pill y no voy a maniobra" pasa igual con el defecto puesto.
> - **Una cosa que salió de la VERIFICACIÓN y quedó as-built**: el `pressStyle` del pill (del intento tocable) se copió del `ActionRow` de "Más" y **la captura del estado de press lo falsificó** — reposo y press salieron en 16.079 y 16.070 bytes, indistinguibles, porque `$bg` (#faf9f9) sobre `$surface` (#F8F6F1) son 2 puntos de luminancia. Se corrigió a `$divider` y después el `pressStyle` entero salió con la reversión. Queda anotado porque el método vale: **el estado de press hay que capturarlo, no suponerlo.**
> - **Lo que NO se pudo verificar**: el fix del `hitSlop` **en device**. Exige un build de EAS (el gate de builds de `CLAUDE.md`). Queda pendiente de la Puerta 2 con el APK.

## 8. Offline-first (`docs/specs.md` — feature que carga datos en campo)

**Offline-first no es opcional** (CLAUDE.md principio 3). El delta hereda el core R14 y **no** introduce ninguna llamada a red: el registro de drivers, el motor de selección, el simulador y la pantalla son puros/locales. El descubrimiento y la conexión (SPP/serial/HID) son **locales** (radio del teléfono / puerto). El find-or-create disparado por el `tag_read` corre contra PowerSync local (spec 09), igual que hoy. Test: los módulos nuevos no importan `supabase`/`fetch` (mismo chequeo que `offline-noread.test.ts` del core).

## 9. Multi-tenancy / RLS

El delta **no toca la DB**: no agrega tablas, columnas ni RLS. El EID que 04 emite (real o —en demo— simulado) lo procesa el motor find-or-create de spec 09, que scopea por `establishment_id` activo y se apoya en las policies RLS de spec 02. 04 solo entrega el `tag_read`. El aislamiento multi-tenant es responsabilidad del consumidor (spec 09). **Nota de integridad**: el simulador refuerza que un EID demo no debe declararse como real (RMV4.7) — control a nivel bundle/gate, no a nivel RLS.

## 10. Estados de PowerSync / Edge Functions

Sin cambios. El delta es 100% cliente (drivers, selección, UI, simulador, adapter SPP). No agrega buckets, sync rules ni Edge Functions.

## 11. Alternativas descartadas

### A — Un adaptador por fabricante (N adaptadores, uno por marca)

**Dirección alternativa:** en vez de adaptadores por transporte + drivers como datos, tener `AllflexAdapter`, `GallagherAdapter`, `TruTestAdapter`… cada uno con su propia I/O.

**Contras (por qué se descarta):**
- Duplica la I/O de transporte por marca: dos lectores que ambos hacen SPP repetirían el RFCOMM/framing/backoff/reconexión. La superficie explota con cada fabricante — lo opuesto a "agregar fabricante = agregar config".
- Rompe la abstracción de ADR-024 ("un EID es texto", contrato con N transportes): el transporte es el eje estable, la marca es la variación.
- **Elegido:** adaptadores **por transporte** (ya existentes) + `ReaderDriver` como **datos** que parametrizan (sppUuid/pin/frameParser/deviceMatch). El RS420 es el primer driver; un SPP nuevo reusa `adapter-spp-android` con otro driver. Esto es el patrón que merece ADR (§12).

### B — Reusar `adapter-mock` (`kind:'mock'`) para la demo en vez de un `SimulatorAdapter` nuevo

**Alternativa:** no crear `kind:'simulator'`; usar el `MockAdapter` + `BleE2EBridge` existentes también para las demos humanas.

**Contras:**
- El mock/bridge están diseñados para **inyección de Playwright** (invisible, sin marcado). Una demo humana necesita **marcar las lecturas como "DEMO"** (honestidad de integridad SENASA, RMV4.6) y controles visibles — un `kind` propio lo permite sin contaminar el mock de E2E.
- Acopla el gate de demo al de E2E (`__RAFAQ_BLE_E2E__`), cuando son propósitos distintos; separarlos (`__RAFAQ_BLE_DEMO__`) mantiene cada superficie mínima y auditable en su gate.
- **Elegido:** `SimulatorAdapter` con `kind:'simulator'` + marca `__RAFAQ_BLE_DEMO__` propia y **requerida** (triple-guard). No se reusa el flag de E2E como disparador de demo; `isDemoBuildAllowed()` solo acepta `__RAFAQ_BLE_E2E__` como **señal de contexto no-prod** (para capturar/testear la demo con Playwright), no como la marca de demo. Costo: extender 3 uniones 04-owned de forma aditiva (Pregunta abierta #2 de requirements) — barato y honesto.

## 12. Recomendación de ADR (la decide y redacta el LEADER — flag, no formalización)

> **spec_author NO crea ni edita el ADR.** Esta sección es el insumo para que el **leader** decida en la Puerta 1 si formaliza una **enmienda a ADR-024** (o un ADR corto nuevo) y la redacte.

**Qué debería fijar la enmienda/ADR:**

1. **El patrón driver-registry.** Los adaptadores del bastón son **por transporte** (SPP / serial / BLE-HID / BLE-GATT / MFi); los **fabricantes son datos** (`ReaderDriver`: vendorId, transports+connectionParams, frameParser, deviceMatch). Sumar una marca = agregar una fila al `DRIVER_REGISTRY`, **sin** tocar el contrato de ingesta, la interfaz `StickAdapter` ni los adaptadores. Es la generalización natural de ADR-024 §1 ("un EID es texto") a N fabricantes: ADR-024 fijó los transportes; esto fija cómo se parametriza cada transporte por marca.

2. **La tabla de selección por capacidad.** Una **prioridad de transporte por plataforma, determinística** (iOS: HID>GATT>MFi; Android: SPP/GATT>HID; web: serial), materializada como función pura (`platformTransportPriority` + `adapterForTransport` + `selectReaderBinding`). Fija cómo la app elige "cuál según el dispositivo/OS" (el pedido literal de Raf) y resuelve la ambigüedad (device alcanzable por >1 vía) sin depender del orden de descubrimiento.

**Por qué merece ADR (regla práctica de CLAUDE.md "¿se referencia en 6 meses?"):**
- Se va a **referenciar cada vez que Raf sume un fabricante** (el outreach a empresas de bastones es continuo) y cada vez que se agregue un transporte (GATT, MFi) — define un patrón repetible, no una decisión de una feature.
- Fija una **decisión de integridad** (la tabla de prioridad determinística) que afecta qué transporte se usa en producción por plataforma — no es un detalle interno.
- El context-multivendor §"Ganchos" ya lo marcó como "probable enmienda a ADR-024, se decide al escribir la spec".

**Alcance sugerido para el leader:** enmienda a ADR-024 (no ADR nuevo) porque es continuación directa de su §1–§2 (contrato + adaptadores) — agrega la capa driver-registry + selección por capacidad sin cambiar la decisión de transporte ya aceptada. El `context-multivendor.md` y este `design-multivendor.md` son los insumos.

## 13. Trazabilidad RMV → archivo/función

| RMV | Archivo / función |
|---|---|
| RMV1.1, RMV1.2 | `driver-types.ts` (`ReaderDriver`/`ReaderProfile`, `TransportCapability`, `TransportKind`, `DeviceMatcher`, `DiscoveredDevice`) |
| RMV1.3 | `driver-rs420.ts` (`RS420_DRIVER`, reusa `parseRs420Line` + `SPP_UUID` + `DEFAULT_BAUD`) |
| RMV1.4 | `driver-registry.ts` (`DRIVER_REGISTRY`, `driverByVendorId`) |
| RMV1.5, RMV1.7 | `driver-registry.ts` (`findDriverForDevice`) |
| RMV1.6 | estructural: agregar driver al registry no importa `contract.ts`/`stick-adapter.ts`/adapters (test) |
| RMV2.1 | `selection-priority.ts` (`platformTransportPriority`) |
| RMV2.2 | `selection-priority.ts` (`adapterForTransport`) |
| RMV2.3, RMV2.4, RMV2.5, RMV2.8 | `selection-priority.ts` (`selectReaderBinding`, `ReaderBinding`, `BindingEnv`) |
| RMV2.6 | `selection-priority.ts` (puro, entradas inyectadas) + tests node:test |
| RMV2.7 | `adapter-selection.ts` (`selectTransportAdapter` intacto para auto/mock/manual + rama `demo`; `ProviderMode`/`AdapterKind` extendidos) |
| RMV3.1, RMV3.2, RMV3.4 | `features/ble-stick/screens/StickConnectionScreen.tsx` + `connection-view.ts` |
| RMV3.3 | `StickConnectionScreen.tsx` → `remembered-device.ts` (`writeRememberedDevice`) |
| RMV3.5 | `features/ble-stick/components/StickStatusIndicator.tsx` → `useBleConnectionStatus()` |
| RMV3.6 | `connection-view.ts` + `blocksManualEntry()` del core (=false) |
| RMV3.7 | `StickConnectionScreen.tsx` + `connection-view.ts` (binding.available=false) |
| RMV3.8 | `StickConnectionScreen.tsx` + `StickDeviceRow.tsx` (driver=null) |
| RMV4.1, RMV4.2, RMV4.8 | `adapter-simulator.ts` (`SimulatorAdapter`) + provider `handleReading` (reuso) |
| RMV4.3 | `adapter-selection.ts` (`selectTransportAdapter` — 'auto' nunca 'simulator') |
| RMV4.4, RMV4.5 | `demo-gate.ts` (`isDemoMode`) + `instantiateTransport` (re-chequeo) + `DemoControls.tsx` |
| RMV4.6 | `DemoControls.tsx` + `connection-view.ts` (marca "DEMO") |
| RMV4.7 | triple-guard (RMV4.3–4.5) + nota de frontera spec 09/08 (parar y reportar) |
| RMV5.1, RMV5.2, RMV5.3, RMV5.7 | `adapter-spp-android.ts` (reescrito) + `LineFramer` (reuso) + `RS420_DRIVER` |
| RMV5.4 | `adapter-spp-android.ts` → `remembered-device.ts` |
| RMV5.5 | `adapter-spp-android.ts` → `backoffDelayMs` (reuso) |
| RMV5.6 | `adapter-spp-android.ts` (import perezoso) + `adapter-spp-android.test.ts` (import no tira) |
| RMV5.8 | tarea de veto del config plugin (spike, sin instalar dep) |
| RMV5.9 | device-gated (documentado; código + puros = entregable buildable) |
| RMV6.1, RMV6.2 | `driver-types.ts` (`mfi` params) + `adapterForTransport('mfi')→null` |
| RMV6.3 | `adapterForTransport('ble-gatt')→null` (punto de extensión; futuro `adapter-ble-gatt`) |

## 14. Dependencias del spec

- **core spec 04** (`requirements.md` R1–R15, `design.md`): el delta lo extiende sin reabrirlo. Reusa `contract.ts`, `stick-adapter.ts`, `dedup.ts`, `feedback*`, `adapter-selection.ts`, `BleStickListenerProvider.tsx`, `stick.ts`, `parser-rs420.ts`, `remembered-device.ts`, `permissions.ts`, `line-framer.ts`, `connection-status.ts`.
- **ADR-024** (transporte): fuente de verdad, respetada. El delta agrega la capa driver-registry + selección; **recomienda enmienda** (§12, la decide el leader).
- **spec 09** (`buscar-animal`): interfaz reusada, no redefinida ni tocada (`BleStickEvent`, `useBleStickListener`, `useBleConnectionStatus`, `useBusyMode`, `BleStickListenerProvider`). Ningún screen de find-or-create se modifica.
- **ADR-018** (navegación): `StickConnectionScreen` en "Más"; listener global (no es tab).
- **`react-native-bluetooth-classic`**: dependencia de `adapter-spp-android`. **[as-built 2026-07-29: INSTALADA y pineada en `1.73.0-rc.17`.** El veto (T-MV.5.1) dio COMPATIBLE con evidencia contra el codigo instalado + un build Gradle real; la lib **no trae config plugin**, asi que se escribio uno propio (`app/plugins/with-bluetooth-classic.js`). El import sigue siendo perezoso: importar el modulo no tira en web/CI.**]**
- **`ble-e2e-flag.ts` / `BleE2EBridge.tsx`** (spec 09 chunk, host-level): patrón replicado (endurecido) por `demo-gate.ts` / `DemoControls.tsx`. No se tocan.

## 15. Notas para el implementer

- Leer `context-multivendor.md` + ADR-024 + el **core as-built** (`app/src/services/ble/*`) antes de empezar. Mandatorio: NO reescribir el contrato ni los tipos de spec 09; **extender de forma aditiva**.
- **Reuso obligatorio:** `parser-rs420.ts` (frameParser del RS420), `LineFramer`, `backoffDelayMs`, `remembered-device.ts`, `permissions.ts`, `EidIngestEngine`. No reimplementar.
- Las extensiones de union (`'simulator'`, `'demo'`) son **aditivas**; tras agregarlas, completar los switches exhaustivos (`permissions.ts`, `instantiateTransport`) o el typecheck falla — eso es la red de seguridad.
- El `adapter-spp-android` usa **import perezoso** de la lib nativa (patrón `feedback.ts`): importar el módulo NO debe tirar en web/CI. Verificar con un test que `import('./adapter-spp-android')` no lanza.
- El simulador es **dev/demo-only** (triple-guard). En prod, mode='auto' → nunca 'simulator'; `isDemoMode()` false; instancia null. Un EID simulado marcado "DEMO" nunca se declara como real.
- **Frontera:** si algo obligara a cambiar un contrato de spec 09 (montar el indicador, la confirmación pre-commit del simulador, la no-declaración SENASA), **parar y reportar al leader** — no parchear desde 04.
- **Colisión-safe:** trabajar en `app/src/services/ble/*` + `app/src/features/ble-stick/*`; el único toque host-level es 1 línea del prop `mode` en `_layout.tsx` (coordinar) — no tocar archivos de teléfono/auth.
- Tests: `node:test` (módulos puros) para registry/selección/simulador/demo-gate y las partes puras del SPP; el `StickConnectionScreen` se ejercita con mock/simulador (E2E/component); la conexión real de SPP/HID queda gated.
- Commits en español, presente, descriptivo.

Ver `tasks-multivendor.md` para el plan por fases.
