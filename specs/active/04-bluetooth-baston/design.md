# Spec 04 — Integración bastón lector RFID (EID) — Design

**Status**: ✅ **Puerta 1 APROBADA por Raf (2026-06-03).** Gate 1 (security, modo spec) PASS (sin findings HIGH). En implementación — empezando por la capa buildable-hoy (contrato + web-serial + manual + mock + provider/hooks).
**Fecha**: 2026-06-03 (sesión 22+).
**Fuente de verdad**: `requirements.md` (v2) + `context.md` (Gate 0 aprobado) + **ADR-024** (transporte). El design **respeta el contrato de ingesta de EID transport-agnóstico + los 5 adaptadores** de ADR-024; no inventa otro transporte ni lo contradice.

## Historial de refinamiento

- **2026-06-03 — Reescritura v2 (folding ADR-024).** La v1 (2026-05-30) asumía un único adaptador **BLE GATT** (`react-native-ble-plx`) con UUIDs a confirmar el día de campo. El día de campo + la investigación de mercado lo refutaron; ADR-024 lo reemplazó por un **contrato multi-adaptador** y el `context.md` se actualizó. Esta v2 reescribe el design sobre ADR-024 + el context actualizado. Consolida (sin copiar entero) `android-spp-impl-plan.md` y `web-serial-dev-harness-plan.md`. **No redefine** los tipos de spec 09 (`BleStickEvent`, `useBleStickListener`, `BleStickListenerProvider`, `useBleConnectionStatus`, `useBusyMode`): los **implementa**.

## Relación con spec 09 (qué implementa 04, qué consume de 04)

Spec 09 ya declaró los contratos (su `design.md` §"Hooks y servicios de cliente" + `tasks.md` Fase 4). 04 los hace reales. **04 NO redefine ni contradice** la interfaz de spec 09 — el "contrato de ingesta" de ADR-024 es la generalización de esa interfaz a N adaptadores.

| Contrato (declarado en spec 09) | Estado en spec 09 | Estado en spec 04 |
|---|---|---|
| `BleStickEvent` (`tag_read` / `connection_changed`) | declarado (design §useBleStickListener) | **se reusa tal cual** (no se redefine) — R1.6, R9.4 |
| `useBleStickListener(opts)` | stub (T1.5, nunca dispara) | **implementación real** — R10.4 |
| `BleStickListenerProvider` | esqueleto (T4.2, monta hook stub) | **implementación real montando el adaptador según plataforma** — R10.3 |
| `useBleConnectionStatus()` | "a definir" (T4.2) | **definido e implementado** — R9.3 |
| `useBusyMode()` | "a definir" (T4.5) | **definido e implementado** — R10.6 |
| `{ enableListener, disableListener }` | esqueleto (T4.2/T4.4) | **implementado** — R10.5, R10.7 |
| mock provider (`mode='mock'` + `mockTagRead`) | pedido (riesgos design.md) | **implementado** — R10.1, R10.2 |
| `FindOrCreateOverlay`, `useAnimalLookup`, screens | propiedad de spec 09 | **consumidos, no tocados** |

**Regla de frontera.** 04 es dueña de `app/src/services/ble/*`. NO modifica los archivos de `app/src/features/animals/` (territorio de spec 09) **salvo** reemplazar el stub `app/src/features/animals/hooks/useBleStickListener.ts` por una reexportación delgada que delega en `services/ble/`, y montar el adaptador real en el `BleStickListenerProvider` que spec 09 declaró. Si durante implementación se necesitara cambiar un contrato de spec 09 (ej. la confirmación pre-commit de R2, ver Preguntas abiertas #3 de requirements), **parar y reportar al leader** (mismo protocolo que spec 09 con spec 02). El reparto exacto provider/hook entre `services/ble/` y `features/animals/` se coordina con quien implemente spec 09 Fase 4 (Preguntas abiertas #2).

## Arquitectura: el contrato de ingesta + 5 adaptadores (ADR-024)

La unidad de la arquitectura **no es "BLE"**: es **"un EID válido + confirmado → commit al motor find-or-create"**. Cualquier fuente que produzca un string de dígitos es un **proveedor** del mismo contrato.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  BleStickListenerProvider (global, root)   ← spec 09 lo declara; 04 lo monta │
│   · monta el adaptador según Platform/entorno (R10.3)                       │
│   · al recibir tag_read confirmado → useAnimalLookup(spec 09, source='ble') │
│   · expone { enableListener, disableListener } + useBusyMode + status       │
└──────────────────────────────────────────────────────────────────────────┘
                              ↓ consume
┌──────────────────────────────────────────────────────────────────────────┐
│  EID-INGEST CONTRACT  (services/ble/, territorio de 04)  — transport-agnóstico│
│   normalize + isValidTag (R1)  →  dedup por-TAG ~3s (R3)                     │
│     →  confirm visual + feedback (R2, R4)  →  BleStickEvent{tag_read} (R1.6) │
│                                                                              │
│   StickAdapter (interfaz común R11):                                         │
│     connect(deviceId?) / disconnect() / onTagRead(cb) / onStatus(cb)         │
│     / enable() / disable()                                                    │
│       ├── adapter-spp-android   RS420 Classic SPP (react-native-bluetooth-   │
│       │     classic). CUBRE AL BETA.        [dev build + Android]  R6,R12     │
│       ├── adapter-hid-wedge     BLE-HID → TextInput de scan. iOS+Android sin  │
│       │     MFi.  ⚠ GATED por validación física (ADR-024 §4)      R8          │
│       ├── adapter-web-serial    RS420 por COM virtual (Web Serial). DEV/TEST. │
│       │     [buildable hoy, Platform.OS==='web']                  R5          │
│       ├── adapter-manual        carga manual (puerta cero spec 09 R1).        │
│       │     PISO, siempre disponible. [buildable hoy]             R7          │
│       └── adapter-mock          CI / dev sin device. [buildable hoy] R10      │
│            ↓                                                                  │
│   parser-rs420.ts (COMPARTIDO para streams SPP/serial; YA committeado 9126dba)│
│       parseRs420Line / normalizeTag / isValidTag  (R1.2, R1.3, R11.4)        │
└──────────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────────┐
│  Pantalla de conexión en tab "Más" (ADR-018)  + indicador global de estado  │
│   └── StickConnectionScreen (R9) — específica por adaptador                  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Madurez de cada pieza (buildable HOY vs. dev-build vs. GATED):**

| Pieza | Buildable hoy sin device | Necesita dev build / Android | GATED por hardware de test |
|---|---|---|---|
| Contrato de ingesta (R1–R3) | ✅ (sobre parser ya hecho) | — | — |
| Feedback (R4) | ✅ (web Audio + visual; haptic real en device) | — | — |
| `adapter-web-serial` (R5) | ✅ (RS420 pareado a Windows + Chrome) | — | — |
| `adapter-manual` (R7) | ✅ | — | — |
| `adapter-mock` (R10) | ✅ | — | — |
| `BleStickListenerProvider` + hooks (R10) | ✅ (con mock/web-serial/manual) | — | — |
| Interfaz `StickAdapter` (R11) | ✅ | — | — |
| `adapter-spp-android` (R6, R12) | ❌ | ✅ `react-native-bluetooth-classic` + Android de pruebas | — |
| Pantalla de conexión SPP (R9) | parcial (UI sí; conexión real no) | ✅ | — |
| `adapter-hid-wedge` (R8) | ❌ (no se implementa) | — | ⚠️ **GATED** (ADR-024 §4 — iPhone real) |

> **Decisión de orden de build (informa tasks.md):** primero todo lo **buildable hoy** (contrato + parser-reuse + manual + web-serial + mock + provider/hooks), que de-riskea el pipeline entero contra el RS420 real en web sin compilar nada; después **`adapter-spp-android`** (entregable del beta, requiere dev build); el **`adapter-hid-wedge`** queda como bloque GATED — no se toca hasta pasar el gate físico.

## Archivos a crear o modificar

### Nuevos archivos en `app/src/services/ble/` (territorio de 04)

```
app/src/services/ble/
├── parser-rs420.ts                 # YA EXISTE (commit 9126dba) — reuso directo, NO se reescribe
├── parser-rs420.test.ts            # YA EXISTE — tests del parser
├── contract.ts                     # Contrato de ingesta: normalize+validate+confirm+dedup → tag_read (R1,R2,R3)
├── dedup.ts                        # Ventana por-TAG ~3s, keyed por EID (R3)
├── feedback.ts                     # Vibración (siempre) + beep (configurable) + señal visual (R4)
├── feedback-pref.ts                # Persistencia local del toggle de beep (R4.3, R4.4)
├── config.ts                       # Constantes: DEDUP_WINDOW_MS=3000, SPP_UUID, baud default (R3.4)
├── stick-adapter.ts                # interfaz StickAdapter (R11.1)
├── adapter-manual.ts               # puerta cero → contrato (R7)
├── adapter-mock.ts                 # inyección de lecturas + connection (R10.1)
├── adapter-web-serial.ts           # Web Serial (Platform.OS==='web'), reusa parser (R5)
├── adapter-spp-android.ts          # react-native-bluetooth-classic (R6) — necesita dev build
├── adapter-hid-wedge.ts            # ⚠ GATED — NO se implementa hasta R8.7 (placeholder documentado)
├── remembered-device.ts            # persistencia del bastón recordado (SPP) (R6.3)
├── permissions.ts                  # permisos por transporte (R12)
├── connection-status.ts            # estado de conexión + useBleConnectionStatus (R9.2, R9.3)
├── stick.ts                        # ensambla contrato + adaptador activo → useBleStickListener real (R10.4)
└── __tests__ (junto al módulo, patrón node:test del parser)
    ├── contract.test.ts            # normalize/validate/confirm/dedup (R1, R2, R3)
    ├── dedup.test.ts               # mismo TAG <3s ignora; TAGs distintos pasan al instante (R3)
    ├── adapter-web-serial.test.ts  # framing por línea + reuso parser (R5)
    ├── adapter-mock.test.ts        # inyección + enable/disable (R10)
    └── feedback.test.ts            # vibración siempre / beep apagable (R4)
```

> El `parser-rs420.ts` **es puro** (no react-native, no I/O) y corre bajo `node:test` igual que `src/utils/*`. El contrato + dedup + feedback-pref se diseñan para ser **mayormente puros** (testables sin device): la lógica de ventana, validación y selección de feedback no necesita hardware; solo la capa de transporte (adaptadores) y el efecto físico (haptic/beep nativo) lo necesitan.

### Pantalla de conexión + UI (TENTATIVA — design system)

```
app/src/features/ble-stick/screens/         (o donde la nav de "Más" lo monte — coordinar ADR-018)
└── StickConnectionScreen.tsx               # R9 — específica por adaptador (SPP/web-serial/HID)
app/src/features/ble-stick/components/
├── StickStatusIndicator.tsx                # indicador global en el chrome (R9.3)
└── ScanInput.tsx                           # campo de scan enfocado para hid-wedge (R8.4) — GATED
```

### Modificaciones a archivos existentes (mínimas, en frontera de spec 09)

- `app/src/features/animals/hooks/useBleStickListener.ts` (stub de spec 09 T1.5) → reemplazar el cuerpo stub por una **reexportación delgada** que delega en `services/ble/stick.ts`. NO cambia la firma declarada por spec 09.
- `app/src/features/animals/providers/BleStickListenerProvider.tsx` (esqueleto de spec 09 T4.2) → montar el adaptador real según plataforma/entorno (R10.3) + implementar `{ enableListener, disableListener }` + `useBusyMode` + `useBleConnectionStatus`. Coordinar con quien implemente spec 09 Fase 4 (Preguntas abiertas #2 de requirements).
- Config de navegación de "Más" (ADR-018): agregar la entrada a `StickConnectionScreen`.
- `app.json` / config plugin (solo para `adapter-spp-android`): permisos Android + config plugin de `react-native-bluetooth-classic` (dev build).

**Ningún archivo de spec 01, spec 02 ni los screens/hooks de spec 09 (find-or-create) se modifica desde 04** salvo los dos puntos de frontera listados.

## Contratos de tipos (reuso de spec 09 — NO se redefinen)

```typescript
// Declarados por spec 09 design.md — 04 los IMPLEMENTA, no los redefine.
type BleStickEvent =
  | { kind: 'tag_read', tag: string, timestamp: number }
  | { kind: 'connection_changed', connected: boolean };

useBleStickListener(opts: { enabled: boolean, onTagRead: (tag: string) => void }): {
  isConnected: boolean;
  isListening: boolean;
};
```

```typescript
// NUEVO en 04 — interfaz StickAdapter (R11), transport-agnóstica.
type ConnectionStatus =
  | 'off' | 'permission_denied' | 'scanning' | 'connecting' | 'connected' | 'disconnected';

interface StickAdapter {
  connect(deviceId?: string): Promise<void>;
  disconnect(): Promise<void>;
  onTagRead(cb: (rawOrEid: string) => void): () => void;   // stream adapters pasan línea cruda; manual/hid pasan dígitos
  onStatus(cb: (status: ConnectionStatus) => void): () => void;
  enable(): void;
  disable(): void;
}
```

```typescript
// NUEVO en 04 — el contrato de ingesta (R1–R3). Mayormente puro → testeable sin device.
function ingestRawLine(line: string): { eid: string } | null;   // parseRs420Line → isValidTag (R1)
function shouldEmit(eid: string, now: number): boolean;          // dedup por-TAG ventana ~3s (R3)
// confirm visual + feedback (R2, R4) viven en la capa UI/provider, gated por shouldEmit.
```

## Cómo cada adaptador entrega al contrato

- **`adapter-spp-android`** (R6): abre el RFCOMM SPP (UUID `00001101-...`) con `react-native-bluetooth-classic`, lee líneas ASCII, pasa cada **línea cruda** a `ingestRawLine` → `parseRs420Line` descarta framing → `isValidTag`. Pairing PIN 1234 (slave), recordar device (`remembered-device.ts`), reconexión backoff (`connection-status.ts`). Baud-independiente.
- **`adapter-web-serial`** (R5): `requestPort()` + `open({baudRate})` + `port.readable.pipeThrough(TextDecoderStream)` + framing por `\n` → cada línea a `ingestRawLine` (mismo `parser-rs420.ts`). `getPorts()` para reconectar sin re-preguntar. Solo `Platform.OS==='web'`, Chromium, contexto seguro. **Mismo pipeline que SPP detrás del contrato** — solo el transporte difiere.
- **`adapter-manual`** (R7): el tipeo de spec 09 R1 (IDV/visual/EID) entra como un EID/identificador directo al contrato (no pasa por `parseRs420Line` — ya es el dígito limpio); `isValidTag` aplica si el tipeo es un EID. Siempre disponible, piso.
- **`adapter-mock`** (R10): `mockTagRead(tag)` inyecta un EID ya limpio al contrato (ejercita validate+dedup+confirm+feedback sin transporte); `mockConnectionChange(connected)` ejercita el status.
- **`adapter-hid-wedge`** (R8, **GATED**): NO es GATT, NO usa `react-native-ble-plx`. Captura **keystrokes + Enter** en un `TextInput` de scan (`ScanInput.tsx`); ensambla la línea tipeada (15 díg, quizá sin el framing del lector) → `isValidTag` la valida (R8.2). El parser de stream **no aplica** a este adaptador (R11.4). **No se implementa hasta R8.7.**

El **parser `parser-rs420.ts` es compartido** por los dos adaptadores de stream (SPP + web-serial) y ya está de-riskeado: solo el transporte difiere. Esto es exactamente el "dos caminos de stream con parser compartido — bajo riesgo" de ADR-024 §Consecuencias.

## Dedup, confirmación y feedback (el corazón del contrato)

- **Dedup (R3)** — `dedup.ts`: un `Map<eid, lastEmittedAtMs>`. `shouldEmit(eid, now)` retorna `false` si `now - lastEmittedAt[eid] < DEDUP_WINDOW_MS` (default 3000, `config.ts`, ajustable R3.4); `true` y actualiza el timestamp en cualquier otro caso. **Keyed por EID** → un EID distinto nunca espera (R3.2, habilita asignación masiva spec 09 R8). No es un cooldown global. Puro y testeable.
- **Confirmación visual (R2)** — la UI muestra el EID legible antes del commit. Es el **mismo gate** que el feedback visual de R4 (R2.4). Para asignación masiva (spec 09 R8) la confirmación es ligera y encadenable (R2.5): no bloquea el siguiente EID distinto. **Interpretación de frontera** (Preguntas abiertas #3 de requirements): la confirmación se realiza dentro del `FindOrCreateOverlay`/flujo de spec 09 mostrando el EID antes de ejecutar el commit; si requiere cambio de contrato en spec 09, parar y reportar.
- **Feedback (R4)** — `feedback.ts`: al confirmar un EID válido dispara `Haptics` (vibración, **siempre**, R4.1) + beep si `feedbackPref.beepEnabled` (R4.2, persistido en `feedback-pref.ts`, R4.3/R4.4) + señal visual <1s (R4.4). En web (`adapter-web-serial`): beep por Web Audio, vibración degradada en silencio (R4.5).

## Conexión, estado e indicador global (R9)

- `connection-status.ts` modela `ConnectionStatus` y expone `useBleConnectionStatus()` (R9.3). Cada cambio emite `BleStickEvent{connection_changed}` (R9.4).
- **`StickConnectionScreen`** (R9.1, en "Más"/ADR-018) es **específica por adaptador**: SPP lista/elige/olvida dispositivos (R6.2, R6.6); web-serial hace `requestPort` + lista `getPorts` (R5.2, R5.4); HID muestra instrucción de parear el teclado en el SO + el campo de scan (R8.3, R8.4 — GATED).
- **`StickStatusIndicator`** (R9.3) en el chrome, alimentado por `useBleConnectionStatus`. Estados con CTA: apagado / permiso denegado / buscando / conectado / desconectado (R9.2). **Todos no bloqueantes** — la carga manual anda en cualquiera (R9.6, R7.2).
- Reconexión automática con backoff donde el adaptador lo soporta (SPP, web-serial) — R9.5. Foreground-only en MVP (R6.9).

## Permisos por transporte (R12)

| Adaptador | Permisos | Build |
|---|---|---|
| `spp-android` | Android 12+: `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` (`neverForLocation`); <12: `BLUETOOTH`/`BLUETOOTH_ADMIN` + location | **dev build** (`react-native-bluetooth-classic`, Expo Go no sirve) — R12.2 |
| `hid-wedge` (GATED) | **ninguno de app** (teclado del SO) — R12.3 | — |
| `web-serial` | permiso del **navegador** (gesto `requestPort()`) — R12.4 | `pnpm web`, Chromium, contexto seguro |
| `manual` | ninguno | cualquiera |
| `mock` | ninguno | CI / dev |

Permiso denegado → estado `permission_denied` con CTA (R9.2) + carga manual operativa (R12.5, R7.2). Nunca bloquea.

## BLE / protocolo (lo que pide `docs/specs.md` cuando toca BLE)

- **Transporte**: NO es BLE GATT (refutado, ADR-024). `spp-android` = Bluetooth **Classic SPP** (RFCOMM, UUID `00001101-0000-1000-8000-00805F9B34FB`); `hid-wedge` = **BLE-HID** (perfil teclado del SO, no GATT); `web-serial` = COM virtual del SPP por `navigator.serial`.
- **Protocolo del stream RS420** (caracterizado en campo, `field-findings.md`): ASCII, 1 línea por lectura, `[STX ~0x02] + "1000000" + <EID 15 díg> + <YYMMDDHHMMSS 12 díg>` terminado en `\n` (a veces `\r\n`). Ya parseado por `parser-rs420.ts` (regex anclada `/^1000000(\d{15})\d{12}$/`, descarta framing y timestamp; nunca tira).
- **Ventana de correlación**: 04 NO correlaciona EID↔peso (eso es spec 05, fuera de alcance). 04 usa el **timestamp del teléfono** en la ingesta (R1.5); el del lector se descarta en el parser.
- **Fallback manual**: `adapter-manual` siempre disponible, 1 tap, mismo contrato (R7).

## Offline-first (`docs/specs.md` — feature que carga datos en campo)

**Offline-first no es opcional** (CLAUDE.md principio 3): el peón en la manga no tiene señal. La conexión bastón↔teléfono es **local** (BLE Classic / serie / HID), no requiere internet (R14). El find-or-create disparado por el `tag_read` corre contra **PowerSync local** (spec 09 R11.3, T5.2). Ningún paso del contrato de ingesta (normalizar, validar, dedup, confirmar, feedback, emitir) toca la red (R14.2). La sync de las mutaciones resultantes la maneja spec 09 (cola PowerSync).

## Multi-tenancy / RLS

04 **no introduce tablas nuevas ni RLS nueva**: no toca la DB. El EID que 04 emite lo procesa el motor find-or-create de spec 09, que ya scopea por `establishment_id` activo (spec 09 R10) y se apoya en las policies RLS de spec 02 R11 como red de seguridad final. 04 solo entrega el `tag_read`; el aislamiento multi-tenant es responsabilidad del consumidor (spec 09 R10.3: el listener es consciente del establishment activo). **Nota de frontera**: 04 no debe asumir un establishment; pasa el EID crudo y deja que spec 09 lo resuelva contra el establishment del context.

## Estados de PowerSync / Edge Functions

- **PowerSync**: 04 no agrega buckets ni sync rules. Consume indirectamente (vía spec 09) la copia local. Sin cambios.
- **Edge Functions**: ninguna. 04 es 100% cliente (transporte + contrato de ingesta). No hay backend nuevo.

## Alternativa descartada

### A — Un único adaptador BLE GATT con `react-native-ble-plx` (la v1 de esta spec)

**Era la dirección de la v1** (2026-05-30) y de ADR-002: un solo adaptador GATT, descubrir service/characteristic del RS420 por UUID, suscribirse a notificaciones.

**Pros**:
- Encaja con ADR-002 sin fricción (un solo transporte, un solo módulo nativo ya elegido).
- Menos superficie: un adaptador en vez de cinco.

**Contras (por qué se descartó — ADR-024)**:
- **Refutado por evidencia de campo + mercado**: el RS420 es Bluetooth **Classic SPP + MFi**, NO expone GATT (no aparece en nRF Connect aunque esté pareado). `react-native-ble-plx` (BLE-only) **no puede comunicarse con el RS420**. La premisa era falsa.
- Ningún stick reader de ganado expone GATT abierto (Allflex AWR300 = Classic; Gallagher HR5 = app propia; Tru-Test XRS2 = Data Link). Construir sobre "uso GATT y anda en ambos OS" habría sido construir sobre arena.
- No habría cubierto **iOS** (la barrera real es MFi/HID, no GATT) ni el beta (que tiene un RS420 Classic).

**Razón**: la abstracción correcta no es "BLE" sino "un EID es texto" — un **contrato de ingesta** con N transportes como proveedores (ADR-024, veredicto del LLM Council). El multi-adaptador es resiliente al fabricante y al transporte, deja iOS como first-class vía `hid-wedge`, cubre el beta con `spp-android`, y permite desarrollar hoy con `web-serial`/`mock`. Si mañana aparece un lector con GATT abierto real, se suma un `adapter-ble-gatt` **sin tocar el contrato** (R11.3). Esta es la dirección elegida.

### B — Bastón que bufferea offline y se descarga en batch (`adapter-batch-dump`)

Documentada en ADR-024 §Alternativas: el RS420 almacena sesiones; "bastoneás sin teléfono, volcás la sesión después" disolvería el problema de transporte-en-vivo-iOS y la ergonomía de sostener el teléfono en la manga. **No se adopta para el MVP** (pierde el feedback en vivo que es parte del pilar manga-friendly; rompe la correlación EID↔peso en vivo de spec 05). Queda anotado como **proveedor candidato del contrato** (`adapter-batch-dump`, R11.3) — se evalúa si el gate físico del HID (R8.7) falla o si la ergonomía de campo lo exige.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El `adapter-hid-wedge` es frágil en RN/iOS (foco, autocorrección, supresión de teclado) | **GATED** (R8.7): no se implementa hasta el gate físico de ADR-024 §4. El contrato sobrevive sin él (los otros 4 adaptadores siguen). |
| El camino BLE-abierto barato en AR sin probar (genéricos Montetech/Smart LFID) | No se compromete hardware: `adapter-manual` es el piso siempre. El gate físico (R8.7) valida antes de recomendar hardware. |
| Firmware RS420 desactualizado → la trama SPP podría cambiar tras actualizar | `parser-rs420.ts` tolera `\r`/STX por `normalizeTag`; re-capturar y revalidar el parser si Raf actualiza el firmware (Preguntas abiertas #5). |
| EID con un dígito corrupto → declaración SENASA incorrecta (10 días hábiles) | **Confirmación visual pre-commit (R2)** + `isValidTag` (R1.3) en el contrato. Lectura malformada se descarta + loguea, no rompe el flujo (R1.4). |
| Listener captura un TAG mientras hay un form CREATE/EDIT abierto, pisando el form | `useBusyMode()` (R10.6): el provider no dispara nuevo flujo mientras un form está activo. |
| Reparto de archivos provider/hook entre `services/ble/` y `features/animals/` (territorio spec 09) | Frontera explícita + coordinar con spec 09 Fase 4 (Preguntas abiertas #2). 04 solo reexporta el stub y monta el adaptador; no toca los screens. |
| Dev build con `react-native-bluetooth-classic` incompatible con Expo SDK 56 | Vetar el config plugin / prebuild manual antes de implementar `adapter-spp-android` (Pendientes del context; tasks T-SPP.0). |

## Dependencias del spec

- **ADR-024** (transporte): Accepted. **Fuente de verdad** — el design lo respeta al pie (contrato + 5 adaptadores, beta = SPP-Android + manual, HID GATED, MFi diferido a Facundo).
- **spec 09** (`buscar-animal`): declara la interfaz que 04 implementa. 04 reemplaza el stub T1.5 y monta el provider real. No redefine ni contradice.
- **spec 03** (`modo-maniobras`): consumidor; usa `enableListener`/`disableListener` + busy-mode (R10.5, R10.7). Sin cambios desde 04.
- **`parser-rs420.ts`** (commit `9126dba`): reuso directo. NO se reescribe.
- **ADR-002** (stack): amendado por ADR-024 (`react-native-ble-plx` vale para el bridge Vesta BLE, no para el RS420). 04 usa `react-native-bluetooth-classic` (SPP) + Web Serial + captura HID, no GATT.
- **ADR-018** (navegación): pantalla de conexión en "Más"; listener global (no es tab).
- **CONTEXT/05** (hardware), **CONTEXT/07** (día de campo): timestamp del teléfono, no-read silencioso, pendientes.

## Notas para el implementer

- Leer `context.md` + ADR-024 + `field-findings.md` + spec 09 design/tasks (Fase 4) **antes** de empezar. Mandatorio entender que el transporte NO es GATT.
- **Reuso obligatorio de `parser-rs420.ts`** — no reimplementar el parseo del stream. Los streams (SPP/serial) van al mismo parser.
- **No redefinir los tipos de spec 09** (`BleStickEvent`, etc.) — implementarlos.
- **No tocar los screens de find-or-create de spec 09** — solo reexportar el stub y montar el adaptador en el provider declarado (coordinar Fase 4).
- El `adapter-hid-wedge` **NO se implementa** hasta R8.7 (gate físico). Dejar el archivo como placeholder documentado, sin lógica activa.
- Patrón de tests del parser (`node:test`, módulos puros) para el contrato/dedup/feedback-pref. Adaptadores con device → test manual en device real + mock en CI.
- Commits en español, presente, descriptivo.
- Si aparece la necesidad de cambiar un contrato de spec 09 (ej. confirmación pre-commit R2), **parar y reportar al leader** — no parchear desde 04.

Ver `tasks.md` para el plan de ejecución paso a paso.
</content>
