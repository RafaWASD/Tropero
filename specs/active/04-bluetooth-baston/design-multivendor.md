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

### 2.2 Reescritura de un placeholder del core (04-owned)

- `adapter-spp-android.ts` — **placeholder → código completo** (RMV5). Implementa `StickAdapter` (`kind:'spp-android'`) sobre `react-native-bluetooth-classic` con **import perezoso** (patrón `feedback.ts`: `require` dentro de la función de I/O, no top-level), parametrizado por `RS420_DRIVER` (sppUuid, pin, frameParser), reusando `LineFramer` + `backoffDelayMs` + `remembered-device.ts`. Las partes puras se testean en CI; la conexión RFCOMM real queda **GATED** (RMV5.9).

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

## 6. `adapter-spp-android` escrito (RMV5)

**Diseño (parametrizado por el driver, import perezoso):**

```
connect(deviceId?):
  perms = permissionModelFor('spp-android')            # 'android-bluetooth' (RMV5, core R12.1)
  const RNBC = require('react-native-bluetooth-classic')  # PEREZOSO — no top-level (RMV5.6)
  driver = RS420_DRIVER                                  # sppUuid/pin/frameParser del registro (RMV5.2)
  device = deviceId ?? await readRememberedDevice()      # remembered-device.ts (RMV5.4)
  onStatus('connecting')
  conn = await RNBC.connectToDevice(device, { uuid: driver.transports.spp.sppUuid, pin })  # PIN 1234
  framer = new LineFramer()                              # reuso (RMV5.3)
  conn.onDataReceived(chunk => for line of framer.push(chunk): onTagRead(line))  # línea CRUDA → contrato
  onStatus('connected')

disconnect(): cierra la conexión SPP; onStatus('disconnected').
reconnect (foreground): backoffDelayMs(attempt++) → connect(remembered) (RMV5.5). Foreground-only.
```

- **Import perezoso (RMV5.6):** `react-native-bluetooth-classic` se `require` dentro de `connect()` (patrón `feedback.ts::vibrateNative`), envuelto en try/catch → en web/CI el módulo no existe pero **importar** `adapter-spp-android.ts` no tira; solo `connect()` fallaría en un entorno sin la lib. Esto mantiene el bundle actual verde **sin instalar la dependencia nativa** (RMV5.8).
- **Partes puras testeadas en CI:** resolución driver→sppUuid/pin/frameParser (RMV5.2), framing por línea (`LineFramer`, ya testeado), backoff (`backoffDelayMs`, ya testeado), y que `import('./adapter-spp-android')` no tira en node:test (RMV5.6). La I/O RFCOMM real es **device-gated** (RMV5.9).
- **Veto del config plugin (RMV5.8):** tarea de spike previa a comprometer el dev build — probar que el config plugin de `react-native-bluetooth-classic` es compatible con Expo SDK 56 + los permisos Android 12+; si no, **parar y reportar**. NO se instala la dep ni se prebuildea en este delta.
- **Montaje en el provider:** cuando el dev build exista, `instantiateTransport('spp-android')` devolverá `new SppAndroidAdapter(RS420_DRIVER)` (hoy devuelve `null`); `selectTransportAdapter({platformOS:'android', mode:'auto'})` pasará de `'manual'` a `'spp-android'`. Esos dos cambios son de la fase gated (no en la pasada buildable-hoy), y **no** tocan el contrato ni los otros adaptadores (core R11.3).

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
>   1. **Anclado al FONDO** (`bottom = insets.bottom + $navBar + $fabRaise + $2`, centrado horizontal) → queda por encima de la bottom tab bar y del pico del FAB elevado, y **nunca pisa un título de header** en ninguna pantalla. No bloqueante (`box-none`/`none`) intacto.
>   2. **Suprimido en `/baston`** (guarda `usePathname() === '/baston' → null`, entre `isNonDemoE2E()` y el auto-oculto `off`): ahí es redundante con la card de estado de la propia pantalla y competía con el título. En el resto del chrome (home, alta, etc.) sí se muestra — que es el rol de RMV3.5 (estado del bastón en pantallas sin card propia).
>   Verificado en captura (Gate 2.5): shots 05/06 = card de `/baston` limpia sin pill encima; shot 07 = indicador anclado al fondo en `/crear-animal` (pantalla con header + CTA), sin solape con el título. La demostración de RMV3.5 en `/crear-animal` en vez de la home es una limitación del E2E (una nav "cruda" a la home remonta el provider raíz y resetea la conexión a `off`; el único `router.push` client-side desde `/baston` que preserva la conexión es "Dar de alta" → alta) — la geometría garantiza el no-solape igual en la home.
> - **Ruta en "Más":** la ruta `/baston` queda registrada (`<Stack.Screen name="baston" />` + `app/app/baston.tsx`) y alcanzable por deep-link; la **fila de `(tabs)/mas.tsx`** que navega ahí queda pendiente de coordinación (mas.tsx es de otra terminal, colisión-safe — no se tocó en este run).

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
- **`react-native-bluetooth-classic`**: dependencia de `adapter-spp-android` — **NO se instala** en este delta (RMV5.8, import perezoso). El veto del config plugin es prerrequisito de la fase gated.
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
