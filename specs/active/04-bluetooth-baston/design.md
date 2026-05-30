# Spec 04 — Integración bastón Bluetooth (Allflex RS420) — Design

**Status**: `spec_ready` (pendiente de aprobación humana — Puerta 1).
**Fecha**: 2026-05-30.
**Cobertura**: parte **NO-hardware**. El adaptador GATT real del RS420 queda como **stub/TODO bloqueante** (ver § "Pendiente día de campo"). Todo lo demás se construye y testea contra el **mock provider**.

## Historial de refinamiento

- **2026-05-30 — Creación inicial.** Design redactado a partir del `context.md` aprobado en Gate 0 (sesión 18) y de la interfaz ya contractualizada por spec 09 design.md. No redefine los tipos de spec 09 (`BleStickEvent`, `useBleStickListener`, `BleStickListenerProvider`, `useBleConnectionStatus`, `useBusyMode`): los **implementa**. Referencias: ADR-002, ADR-013, ADR-018, CONTEXT/05, CONTEXT/07.

## Relación con spec 09 (qué implementa 04, qué consume de 04)

Spec 09 ya declaró los contratos. 04 los hace reales:

| Contrato (declarado en spec 09 design.md) | Estado en spec 09 | Estado en spec 04 |
|---|---|---|
| `BleStickEvent` (tipo) | declarado | **se reusa tal cual** (no se redefine) |
| `useBleStickListener(opts)` | stub (T1.5, nunca dispara) | **implementación real** (R1.1) |
| `BleStickListenerProvider` | esqueleto (T4.2, monta hook stub) | **implementación real montando el hook de 04** (R1, R11) |
| `useBleConnectionStatus()` | "a definir" (T4.2) | **definido e implementado** (R2.4, R2.5) |
| `useBusyMode()` | "a definir" (T4.5) | **definido e implementado** (R11.3) |
| mock provider | pedido (riesgos design.md) | **implementado** (R10) |
| `FindOrCreateOverlay`, `useAnimalLookup`, screens | propiedad de spec 09 | **consumidos, no tocados** |

**Regla de frontera**: 04 NO modifica ningún archivo de `app/src/features/animals/` (territorio de spec 09) salvo el reemplazo del stub `useBleStickListener.ts` por una reexportación que delegue en `services/ble/`. Si durante implementación se necesitara cambiar un contrato de spec 09, **parar y reportar al leader** (mismo protocolo que spec 09 con spec 02).

## Arquitectura del servicio BLE

```
┌────────────────────────────────────────────────────────────────┐
│  React Native (Expo) + TypeScript                              │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  BleStickListenerProvider (global, montado en root)       │  │ ← spec 09 lo declara; 04 lo implementa
│  │   · usa useBleStickListener (real, de 04)                 │  │
│  │   · al recibir tag_read → useAnimalLookup (spec 09)       │  │
│  │   · expone { enableListener, disableListener } (ctx)      │  │
│  │   · expone useBleConnectionStatus() / useBusyMode()       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓ consume                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  services/ble/  (territorio de spec 04)                   │  │
│  │   ├── stick.ts            → useBleStickListener (R1)      │  │
│  │   ├── adapter.ts          → interface BleStickAdapter     │  │
│  │   ├── adapter-ble-plx.ts  → adaptador REAL 🔧 stub        │  │ ← día de campo
│  │   ├── adapter-mock.ts     → adaptador MOCK (R10)          │  │
│  │   ├── connection.ts       → ciclo de vida / reconexión    │  │
│  │   ├── remembered-device.ts→ persistencia bastón recordado │  │
│  │   ├── dedup.ts            → ventana por-TAG (R4)          │  │
│  │   ├── normalize.ts        → normalización/validación TAG  │  │
│  │   ├── feedback.ts         → vibración + beep + visual     │  │
│  │   ├── permissions.ts      → permisos por plataforma (R2)  │  │
│  │   └── config.ts           → constantes (ventana, UUIDs🔧) │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Pantalla de conexión (en tab "Más", ADR-018)            │  │
│  │   └── BleStickConnectionScreen (R3.1, R3.5, R3.6)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                  │
│      react-native-ble-plx  (real)   |   in-memory (mock)       │
└────────────────────────────────────────────────────────────────┘
                               │
                  ❌ sin red — todo local (R12)
```

**04 no introduce ninguna migración SQL ni tabla.** No toca multi-tenancy a nivel datos: el TAG se entrega como string al motor de spec 09, que ya scopea por `establishment_id` (spec 09 R10.3). El único estado persistente de 04 es el **identificador del bastón recordado**, que es estado de dispositivo (no de tenant): se guarda en almacenamiento local del device, no en la DB. Por eso **no aplica RLS a 04** (no escribe tablas con `establishment_id`).

## Archivos a crear o modificar

### Nuevos archivos en `app/src/services/ble/`

```
app/src/services/ble/
├── stick.ts                  # useBleStickListener real (R1.1–R1.4)
├── adapter.ts                # interface BleStickAdapter (R1.5)
├── adapter-ble-plx.ts        # 🔧 adaptador real react-native-ble-plx — STUB (R1.6)
├── adapter-mock.ts           # adaptador mock (R10)
├── connection.ts             # máquina de estados de conexión + reconexión backoff (R2.4, R3.3, R3.4)
├── remembered-device.ts      # persistencia del deviceId recordado (R3.2, R3.5)
├── dedup.ts                  # deduplicación por-TAG con ventana (R4)
├── normalize.ts              # normalización + validación del TAG (R8)
├── feedback.ts               # vibración + beep opcional + señal visual (R5)
├── permissions.ts            # solicitud y estado de permisos por plataforma (R2.1–R2.3)
├── config.ts                 # constantes: DEDUP_WINDOW_MS, BACKOFF, 🔧 UUIDs placeholder
├── types.ts                  # reexporta BleStickEvent (de spec 09) + tipos internos de 04
└── __tests__/
    ├── dedup.test.ts
    ├── normalize.test.ts
    ├── connection.test.ts
    ├── remembered-device.test.ts
    ├── stick.test.ts          # con adapter-mock
    ├── feedback.test.ts
    └── permissions.test.ts
```

### Nuevos archivos de UI (en territorio de "Más" / settings — coordinar con shell de spec 01)

```
app/src/features/settings/ble/        (o equivalente según el shell de "Más" de spec 01)
├── BleStickConnectionScreen.tsx      # pantalla de conexión (R3.1, R3.5, R3.6)
├── BleConnectionIndicator.tsx        # indicador global de estado (R9)
└── BleSoundPreferenceToggle.tsx      # toggle apagar beep (R5.3)
```

> Nota de frontera: la ubicación física exacta de estas pantallas en el árbol de navegación depende del shell de "Más" que monta spec 01 (B.1). 04 declara los componentes; su montaje en la tab "Más" se coordina cuando se implemente. Mismo patrón "UI tentativa hasta design system" que specs 01/02/09.

### Modificaciones a archivos existentes (mínimas, sin tocar lógica de spec 09)

- `app/src/features/animals/hooks/useBleStickListener.ts` (stub creado por spec 09 T1.5) → reemplazar el cuerpo del stub por una **reexportación** del `useBleStickListener` real de `services/ble/stick.ts`. Es el único archivo de spec 09 que 04 toca, y solo para conectar el cable; la firma no cambia. Si spec 09 aún no creó ese stub al momento de implementar 04, se crea acá respetando la firma.
- `BleStickListenerProvider`: spec 09 lo declara montando el hook stub; al implementar 04 se ajusta para montar el hook real y exponer `useBleConnectionStatus` / `useBusyMode`. Coordinar con la Fase 4 de spec 09 (T4.2) — son la misma pieza vista desde dos specs.

## La interface (referenciando spec 09 — NO se redefine)

`services/ble/types.ts` **reexporta** `BleStickEvent` desde el módulo de tipos de spec 09 (`app/src/features/animals/types.ts`), no lo redeclara, para que haya una sola fuente de verdad del tipo:

```typescript
// services/ble/types.ts
export type { BleStickEvent } from '@/features/animals/types';
//  BleStickEvent =
//    | { kind: 'tag_read', tag: string, timestamp: number }
//    | { kind: 'connection_changed', connected: boolean }
```

`stick.ts` implementa exactamente la firma que spec 09 espera:

```typescript
// services/ble/stick.ts  (firma idéntica a la declarada en spec 09 design.md)
export function useBleStickListener(opts: {
  enabled: boolean;
  onTagRead: (tag: string) => void;
}): { isConnected: boolean; isListening: boolean };

// control imperativo (R1.3, R1.4) — usado por el provider y MODO MANIOBRAS
export function enableListener(): void;
export function disableListener(): void;

// estado de conexión (R2.4, R2.5) — implementación del hook que spec 09 deja "a definir"
export type BleConnectionStatus =
  | 'bluetooth_off'
  | 'permission_denied'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected';
export function useBleConnectionStatus(): BleConnectionStatus;

// busy mode (R11.3) — implementación del hook que spec 09 deja "a definir"
export function useBusyMode(): { setBusy: (busy: boolean) => void; isBusy: boolean };
```

## Adaptador (`BleStickAdapter`) — punto de extensión real/mock

```typescript
// services/ble/adapter.ts
export interface BleStickAdapter {
  requestPermissions(): Promise<'granted' | 'denied' | 'bluetooth_off'>;     // R2
  scan(onFound: (device: { id: string; name: string }) => void): () => void; // R3.1 (devuelve stopScan)
  connect(deviceId: string): Promise<void>;                                   // R3.2, R3.3
  disconnect(): Promise<void>;
  subscribeToTags(onRaw: (raw: string, ts: number) => void): () => void;      // 🔧 R1.6 — la parte GATT
  onConnectionChange(cb: (connected: boolean) => void): () => void;
  getConnectionState(): BleConnectionStatus;
}
```

- `adapter-ble-plx.ts` — implementación con `react-native-ble-plx` (ADR-002). **`subscribeToTags` es el único método que depende del protocolo concreto del RS420** (service/characteristic UUIDs + parse del payload) → 🔧 stub hasta el día de campo. El resto de los métodos (scan, connect, permisos, connectionChange) son genéricos de `react-native-ble-plx` y **sí** se pueden escribir ahora, aunque solo se validan contra device real el día de campo.
- `adapter-mock.ts` — implementación en memoria (R10): `subscribeToTags` se alimenta de `mockTagRead(tag)`; `onConnectionChange` de `mockConnectionChange(connected)`. Sin device.

`stick.ts` selecciona el adaptador vía `config.ts` (`USE_MOCK_BLE` o entorno de test), de modo que el código consumidor (provider, MODO MANIOBRAS, spec 09) nunca distingue mock de real (R10.3).

## Ciclo de vida de conexión / reconexión (`connection.ts`)

Máquina de estados (alimenta `useBleConnectionStatus`, R2.4):

```
        ┌─────────────┐  BT off / sin permiso
        │ bluetooth_off│◄──────────────────────────┐
        │ permission_  │                            │
        │   denied     │                            │
        └──────┬───────┘                            │
   permiso OK  │ + BT on                            │
               ▼                                    │
  ┌────────────────┐  hay bastón recordado    ┌─────┴──────┐
  │   scanning     │─────────────────────────►│ connecting │
  │ (pantalla conn │  (R3.3 auto, foreground) └─────┬──────┘
  │  o auto)       │                                │ ok
  └────────────────┘                                ▼
         ▲                                   ┌────────────┐
         │  back to range (backoff, R3.4)    │ connected  │
         └───────────────────────────────────┤            │
                                             └─────┬──────┘
                                    desconexión    │
                                                   ▼
                                            ┌──────────────┐
                                            │ disconnected │ ── auto-retry backoff (R3.4) ──┐
                                            └──────────────┘                                │
                                                   ▲────────────────────────────────────────┘
```

- **Recuerdo (R3.2)**: al elegir un bastón en la pantalla de conexión, se persiste `deviceId` vía `remembered-device.ts`.
- **Auto-reconnect (R3.3)**: al boot/foreground, si hay `deviceId` recordado → `connect()` directo (sin pasar por la pantalla de conexión).
- **Backoff (R3.4)**: ante `disconnected` con bastón recordado, reintentos con backoff incremental (ej. 1s, 2s, 4s, 8s, cap a 30s), solo en foreground (R3.8). Sin loop agresivo que drene batería.
- **Cambiar/olvidar (R3.5)**: `forgetRemembered()` limpia el `deviceId`; vuelve al estado pre-emparejamiento.
- **Múltiples Allflex (R3.6)**: la pantalla de conexión acumula todos los `scan` results compatibles; tras elegir, ese pasa a ser el recordado.
- **Un bastón por dispositivo (R3.7)**: `remembered-device.ts` guarda un único `deviceId` (no una lista).
- **Foreground-only (R3.8)**: la máquina se pausa en background y reanuda en foreground (listener de `AppState`).

**Persistencia del bastón recordado (`remembered-device.ts`)**: `AsyncStorage` key `rafaq:ble:remembered_stick` → `{ deviceId, name, lastConnectedAt }`. Es estado de **dispositivo**, no de tenant; sobrevive reinicios; no se sincroniza ni va a la DB (sin RLS, sin multi-tenancy).

## Deduplicación por-TAG con ventana (`dedup.ts`)

- Estructura: `Map<tagNormalizado, lastEmittedTs>`.
- Al llegar un TAG (ya normalizado por R8): si existe en el map y `now - lastEmittedTs < DEDUP_WINDOW_MS` → **descartar** (no invocar `onTagRead`). Si no, **emitir** y actualizar `lastEmittedTs`.
- `DEDUP_WINDOW_MS = 3000` en `config.ts` (R4.4, ajustable).
- **Por-TAG, no global** (R4.3): cada TAG tiene su propia entrada → tres TAGs distintos en sucesión emiten los tres (R4.2, clave para spec 09 R8 asignación masiva).
- GC: limpieza periódica de entradas con `now - lastEmittedTs > 10s` para no crecer sin límite.

## Feedback de lectura (`feedback.ts`)

- **Vibración (R5.1)**: `expo-haptics` (`Haptics.notificationAsync(Success)` o `impactAsync`), siempre, independiente del sonido.
- **Beep (R5.2, R5.3)**: `expo-av` (sonido corto pre-cargado) condicionado a la preferencia `bleSoundEnabled`. Preferencia persistida en `AsyncStorage` (`rafaq:ble:sound_enabled`, default `true`); toggle en `BleSoundPreferenceToggle.tsx`.
- **Señal visual (R5.4)**: el servicio emite el evento de lectura; la UI (provider / pantalla activa) muestra la confirmación visual. 04 provee la señal; el render visual concreto lo define el design system (UI tentativa).
- **Latencia < 1 s (R5.5)**: el feedback se dispara sincrónicamente en el callback de `onTagRead`, sin esperar el find-or-create. Objetivo medido desde la recepción de la notificación BLE.

## Estados de permiso (`permissions.ts`)

| Plataforma | Permisos requeridos |
|---|---|
| Android 12+ (API 31+) | `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (declarar `neverForLocation` en el manifest para evitar el permiso de ubicación) |
| Android < 12 | `ACCESS_FINE_LOCATION` (requerido para scan BLE legacy) |
| iOS | `NSBluetoothAlwaysUsageDescription` (Info.plist) + prompt de Bluetooth |

- Flujo: `requestPermissions()` → mapea a uno de `granted | denied | bluetooth_off`.
- `permission_denied` (R2.2): estado con CTA → `Linking.openSettings()` (deep-link a settings de la app). Nunca bloquea la carga manual.
- `bluetooth_off` (R2.3): estado con CTA para activar BT. En Android, `requestEnable` si está disponible; en iOS, instrucción al usuario.
- Config Expo: agregar el plugin de `react-native-ble-plx` en `app.json` / `expo` config con los permisos correspondientes (coordinar con quien tenga el lock de `app/`).

## Normalización y validación del TAG (`normalize.ts`)

- `normalizeTag(raw: string): string` — trim, strip de control chars/CR/LF, uppercase, formato canónico.
- `isValidTag(tag: string): boolean` — valida contra el formato RFID esperado. **Provisional** hasta el día de campo (R8.3): el formato canónico exacto (longitud, prefijo país ISO 11784/11785, encoding) se confirma con el escaneo del RS420. Hoy se valida una forma genérica verificable con el mock.
- Lectura malformada (R8.2): `isValidTag === false` → log + NO invocar `onTagRead` + toast opcional no bloqueante.

## Provider, busy mode y suspensión por contexto

`BleStickListenerProvider` (declarado por spec 09, implementado por 04):

```typescript
const enabled =
  !isInModoManiobrasRoute   // R11.1/R11.2 — MODO MANIOBRAS suspende (spec 09 R2.3 gobierna el alcance)
  && !isBusy;               // R11.3 — CREATE/EDIT suspenden vía useBusyMode

useBleStickListener({
  enabled,
  onTagRead: (tag) => {
    // R5: feedback inmediato (vibración + beep + visual)
    fireReadFeedback();
    // spec 09: dispara find-or-create encima de la pantalla actual
    triggerFindOrCreate(tag);
  },
});
```

- `enableListener()` / `disableListener()` (R1.3): MODO MANIOBRAS (spec 03) los llama en `useEffect` con cleanup (contrato heredado de spec 09 T4.4). 04 provee el control; el alcance lo gobierna spec 09.
- `useBusyMode()` (R11.3): CREATE/EDIT marcan `setBusy(true)` en mount, `setBusy(false)` en unmount → suspende el listener sin desconectar el bastón.
- El listener "ocupado" o "en maniobras" **no desconecta** el BLE (R1.4): solo deja de invocar `onTagRead`, así la reactivación es instantánea.

## Indicador global de conexión (`BleConnectionIndicator.tsx`)

- Componente que consume `useBleConnectionStatus()` (R9.1) y se actualiza reactivamente (R9.2).
- Render: ícono + color por estado (conectado / buscando / desconectado / BT off / sin permiso). Ubicación visual concreta en el chrome = design system (UI tentativa, ADR-018).

## Mock provider (`adapter-mock.ts`)

- Implementa `BleStickAdapter` 100% en memoria (R10.1).
- API de test/dev (R10.2): `mockTagRead(tag)`, `mockConnectionChange(connected)`, `mockScanResult(device)`.
- Pasa por el **mismo pipeline** que el real: dedup (R4) → normalize (R8) → feedback (R5) → `onTagRead` → `enable/disable` honrado (R10.4). Así un test con el mock ejercita la misma lógica que el device, salvo la capa GATT (que es justo lo que el día de campo cierra).
- Selección (R10.3): toggle de dev `USE_MOCK_BLE` en `config.ts` + default en entorno de test (`jest`).

## Offline-first

- Toda la cadena (permisos → scan → connect → subscribe → dedup → normalize → feedback → `onTagRead`) es **local al device** (R12.1, R12.2). No hay ninguna llamada de red en 04.
- El find-or-create posterior lo resuelve spec 09 contra PowerSync local (spec 09 R11). 04 solo entrega el string del TAG.

## Logging (`config.ts` / logger compartido)

- Eventos de ciclo de vida BLE (connect/disconnect/retry/malformed) → logger diagnóstico (no bloqueante, R13.1).
- Errores GATT/scan/timeout (R13.2): capturados, logueados, reflejados en `useBleConnectionStatus()`, sin propagar excepciones a la UI.

## Pendiente día de campo (🔧 BLOQUEANTE — CONTEXT/05, CONTEXT/07)

> **Esta es la frontera del refinamiento parcial.** Todo lo de arriba se construye y testea contra el mock **ahora**. Lo de abajo se cierra el día de campo y se folda antes de implementar la parte real (Ola 2 / B.3 del plan). Hasta entonces, `adapter-ble-plx.ts` compila con stubs marcados `// TODO(día de campo)` y los tests corren contra `adapter-mock.ts`.

1. **Service / characteristic UUIDs del Allflex RS420** (🔧 R1.6) — escanear el RS420 con **nRF Connect** (CONTEXT/05). Identificar el service que expone el bastón y la characteristic de NOTIFY que transporta el TAG. Completar `config.ts` (placeholders `RS420_SERVICE_UUID`, `RS420_TAG_CHAR_UUID`) y `adapter-ble-plx.ts.subscribeToTags`.
   - Nota: el RS420 transmite vía **Bluetooth nativo** (BLE), distinto del bridge ESP32 Nordic UART del Vesta (ese es spec 05, balanza). No asumir que el RS420 usa Nordic UART; **confirmar UUIDs reales con nRF Connect**.
2. **Formato del mensaje del TAG** (🔧 R8.3) — del mismo escaneo, capturar un payload real al bastonear un tag conocido. Derivar encoding/longitud/estructura (ASCII vs binario, ISO 11784/11785, prefijo país). Completar `normalize.ts.normalizeTag` / `isValidTag` con el formato canónico real.
3. **Señal de "lectura fallida"** (🔧 R7.2) — confirmar si el RS420 emite algo a nivel protocolo cuando se acciona sin detectar tag. **Default asumido**: no emite → no-read silencioso (R7.1). Si emite → folder un evento de no-read manejable.
4. **Battery Service (nice-to-have, hardware-dependiente)** — verificar si el RS420 expone el Battery Service estándar `0x180F`. Si sí → low-battery warning en el indicador. Si no → se omite (no es requirement numerado).

**Puerta del día de campo**: hasta cumplir (1)+(2), la lectura del **device real** no funciona, aunque el resto de la feature sí (contra mock). El implementer marca esta puerta en `tasks.md` Fase 4.

## Alternativa descartada

### Adaptador BLE acoplado directo (sin interface `BleStickAdapter`), parseando el RS420 inline en `stick.ts`

**Pros**:
- Menos archivos: `stick.ts` habla `react-native-ble-plx` directo.
- Menos indirección para una sola marca de bastón (Allflex) en MVP.

**Contras**:
- **Imposibilita testear sin device**: sin la interface, no hay dónde inyectar el mock; toda la lógica de dedup/normalize/feedback quedaría atrapada detrás de una capa BLE que solo corre en un teléfono con un Allflex en mano. Spec 09 explícitamente pidió un mock provider para su CI (no se puede romper eso).
- **Mezcla la parte bloqueante con la no-bloqueante**: el contexto manda separar lo construible-ahora (todo el comportamiento) de lo que espera el día de campo (los UUIDs + parsing). Con todo inline, la parte no-hardware quedaría rehén del hardware — exactamente lo que el refinamiento parcial busca evitar.
- **Mata la extensibilidad**: el día de mañana habrá otros bastones/balanzas (CONTEXT/05 ya anticipa fuentes de peso pluggables). La interface `BleStickAdapter` es el mismo patrón "fuente pluggable" aplicado al bastón.

**Razón**: la interface `BleStickAdapter` con implementaciones real/mock intercambiables es lo que permite (a) cumplir el requisito de spec 09 de testear el stack completo sin hardware, (b) aislar la única parte bloqueante (el `subscribeToTags` real + parsing) en un único método stub, y (c) extender a otros bastones después. El costo (una interface + dos archivos) es marginal. Esta es la dirección elegida.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El protocolo real del RS420 difiere de lo asumido (no es BLE GATT estándar, payload binario raro) | Toda la lógica no-hardware está aislada del adaptador; el día de campo solo se completa `subscribeToTags` + `normalize`. El blast radius del descubrimiento queda confinado a 2 archivos (`adapter-ble-plx.ts`, `normalize.ts`). |
| Reconexión agresiva drena batería en campo | Backoff incremental con cap (R3.4) + foreground-only (R3.8) + sin polling. |
| Dedup global rompería la asignación masiva (spec 09 R8) | Dedup explícitamente **por-TAG** (R4.3), validado con test de 3 TAGs distintos seguidos. |
| Permisos denegados dejan al operador trabado | Manual-first (R6): la app nunca se bloquea por BLE; manual en 1 tap (R6.2). |
| Lectura malformada dispara un find-or-create basura | `isValidTag` filtra antes de `onTagRead` (R8.2). |
| El listener pisa un form CREATE/EDIT en curso | `useBusyMode` suspende el listener durante formularios (R11.3). |
| Feedback se demora esperando el find-or-create | El feedback se dispara sincrónicamente en `onTagRead`, antes del lookup (R5.5). |

## Dependencias del spec

- **Spec 09** (BUSCAR ANIMAL): aprobada. Declara la interface que 04 implementa (`BleStickEvent`, `useBleStickListener`, provider, `useBleConnectionStatus`, `useBusyMode`, mock provider). 04 consume su motor find-or-create y sus screens; **no** los modifica.
- **Spec 03** (MODO MANIOBRAS): pending. Consume `disableListener`/`enableListener` para suspender el listener global dentro de su wizard. 04 provee el control.
- **Spec 01** (identity/multi-tenancy): el shell de "Más" (ADR-018) hospeda la pantalla de conexión y el indicador global. Coordinar el montaje cuando spec 01 frontend (B.1) exista.
- **ADR-002** (react-native-ble-plx): ✅ accepted. Stack BLE.
- **ADR-013** (frontend stack): ✅. expo-haptics / expo-av / AsyncStorage.
- **ADR-018** (estructura de navegación): ✅ accepted. Listener global = no es tab; pantalla de conexión en "Más"; bastoneo dispara find-or-create encima de la pantalla actual.
- **ADR-003** (BLE Nordic UART): aplica al **bridge del Vesta (spec 05)**, NO al RS420. El RS420 usa su propio protocolo BLE nativo, a descubrir el día de campo. No asumir Nordic UART para el bastón.
- **CONTEXT/05** (hardware): protocolo del bastón a confirmar con nRF Connect.
- **CONTEXT/07** (día de campo): pendientes bloqueantes listados.

## Notas para el implementer

- 04 **no** introduce migraciones SQL, tablas, RLS ni Edge Functions. Todo es cliente.
- No tocar `app/src/features/animals/` salvo reemplazar el stub `useBleStickListener.ts` por la reexportación al real (única integración). Si hace falta más, **parar y reportar al leader**.
- Construir y testear **todo** contra `adapter-mock.ts` primero. El `adapter-ble-plx.ts` real se completa el día de campo (los `// TODO(día de campo)` marcan los huecos).
- Validaciones de cliente espejo del comportamiento esperado; la latencia de feedback < 1 s es un objetivo medible (R5.5).
- Commits en español, presente, descriptivo.

Ver `tasks.md` para el plan de ejecución paso a paso.
