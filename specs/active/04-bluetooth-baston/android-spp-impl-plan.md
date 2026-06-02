# Spec 04 — Plan de implementación Android-first (SPP del RS420)

**Status**: Insumo técnico para `spec_author` / `design.md`. NO es la spec final. Escrito por el leader (sesión 2026-06-01), a partir del protocolo capturado (`field-findings.md`) y del contrato de spec 09.

> **Decisión de Raf (2026-06-01): Android-first.** Implementar la lectura del bastón en Android vía SPP nativo (camino sin dependencia de terceros), exponiendo el contrato transport-agnóstico que spec 09 ya definió. iOS se folda después (protocol string MFi — ver `field-findings.md` §S21 + probe de descubrimiento). El **ADR de transporte sigue pendiente** y gobierna la parte estratégica (qué readers soportar, iOS via Allflex/generic-BLE); este plan cubre la pieza Android, que no está en disputa.

## Alcance

**Dentro:** leer el TAG del **Allflex RS420** en **Android** vía Bluetooth Classic SPP; parsear el protocolo a un EID de 15 díg; emitir `tag_read` por el contrato de spec 09; ciclo de conexión/reconexión; dedup; feedback; fallback manual; permisos; mock.

**Fuera (folded después):** iOS (External Accessory + protocol string MFi); correlación TAG↔peso (spec 05); multi-wand.

## Dependencia y build

- **Librería:** `react-native-bluetooth-classic`. Cubre **Android SPP** (`BluetoothSocket` + UUID SPP `00001101-0000-1000-8000-00805F9B34FB`) **y iOS External Accessory** con una sola API → el mismo adaptador sirve para ambas plataformas (iOS solo suma el protocol string en `Info.plist`).
- **Requiere dev build** (módulo nativo → Expo Go no sirve): `expo-dev-client` + EAS build o `expo prebuild` local. **No es costo nuevo**: cualquier BT/BLE ya lo exigía (también `react-native-ble-plx`).
- **A vetar antes de implementar:** compatibilidad del config plugin de la lib con Expo SDK 56 (o prebuild manual); estado de mantenimiento de la lib.

## Arquitectura (respeta el contrato de spec 09)

spec 09 ya declara `BleStickEvent` / `useBleStickListener` / `BleStickListenerProvider` / `useBleConnectionStatus` / `useBusyMode`. spec 04 los implementa con adaptadores intercambiables detrás de una interfaz:

```
StickAdapter (interfaz transport-agnóstica)
  connect(deviceId) / disconnect() / onTagRead(cb) / onStatus(cb) / enable() / disable()
   ├── adapter-spp-android.ts   ← react-native-bluetooth-classic (ESTA entrega)
   ├── adapter-mock.ts          ← ya pedido por spec 09 (CI / dev sin device)
   └── adapter-ea-ios.ts        ← misma lib + protocol string MFi (entrega futura)
        ↓
   parser-rs420.ts (compartido, plataforma-independiente, YA de-riskeado)
        ↓
   normalize/isValidTag (R8) → BleStickEvent{ type:'tag_read', tag } → find-or-create (spec 09)
```

- El **provider** (`BleStickListenerProvider`) monta el adaptador real según plataforma; en mock/CI inyecta `adapter-mock`.
- `enable()/disable()` los usa MODO MANIOBRAS (spec 03); `useBusyMode()` suspende el listener en CREATE/EDIT.

## Parser RS420 (firme — testeable HOY sin device)

Trama capturada (ASCII, 1 línea por lectura, terminada en `\n`):

```
[byte control ~0x02] + "1000000" + <EID 15 díg> + <YYMMDDHHMMSS 12 díg>
ej:  \x02 1000000 982000364696050 260530101701
```

Algoritmo:
1. Descartar el byte de control inicial (no imprimible) y `\r`.
2. Tras la cabecera fija `1000000` (7 chars), tomar los **15 díg siguientes = EID**.
3. Descartar el timestamp del lector (12 díg). MVP usa **timestamp del teléfono** (CONTEXT/05, para correlación con peso).
4. Validar: EID = 15 díg, prefijo país (`032`=AR) **o** fabricante (≥900, ej. `982`). `isValidTag` acepta ambas formas (R8).
5. Robusto: extraer con `/1000000(\d{15})\d{12}/` o por offsets fijos tras strip del control.

- **Baud-independiente** (SPP virtual) → no hay que configurar baud en Android.
- **Tests unitarios del parser** con las muestras capturadas (`982000364696050`, `032010006382438`) — primera tarea, cero hardware.

## Ciclo de conexión (spec 04 context.md)

- **Pairing**: el RS420 es SPP **slave**, PIN **1234**; el teléfono (master) se conecta. Primera vez: pantalla de conexión en "Más" que lista dispositivos y recuerda el elegido.
- **Reconexión automática** con backoff al volver a rango / abrir la app; **indicador de estado global** (`useBleConnectionStatus`).
- **Dedup por-TAG, ventana ~3s** (NO cooldown global): TAGs distintos pasan al instante (clave para asignación masiva de caravanas, spec 09 R8).
- **Feedback**: vibración siempre + beep configurable + visual (<1s objetivo).
- **Fallback manual SIEMPRE disponible en 1 tap**, independiente del estado BT. El bastón es enhancement; la app nunca se bloquea por BT.

## Permisos Android

- 12+ (API 31): `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` (con `neverForLocation` si aplica).
- <12: location + `BLUETOOTH`/`BLUETOOTH_ADMIN`.
- Estados claros con CTA: BT apagado / permiso denegado / buscando / conectado / desconectado. La carga manual anda en todos.

## Testing

1. **Parser**: unit tests con muestras capturadas (sin device).
2. **adapter-mock**: inyecta lecturas simuladas → testea el pipeline entero (find-or-create, dedup, asignación masiva, MODO MANIOBRAS) en CI sin hardware.
3. **adapter-spp-android**: test manual en device real con el RS420 (Raf lo tiene) — pairing, stream, reconexión, dedup, fallback.

## Tareas (boceto para tasks.md)

- T1 Parser RS420 + tests (sin device). **Primera, desbloqueada ya.**
- T2 Interfaz `StickAdapter` + `adapter-mock` conforme a spec 09.
- T3 Dev build (expo-dev-client + prebuild/EAS) con `react-native-bluetooth-classic`.
- T4 `adapter-spp-android`: pairing, connect SPP, read stream, parse, dedup, reconnect, status.
- T5 Permisos + pantalla de conexión ("Más") + indicador de estado.
- T6 Wire al `BleStickListenerProvider` + find-or-create (spec 09) + busy-mode (spec 03).
- T7 Test en device real con RS420.

## No-disputa vs. pendiente del ADR

- **No-disputa (este plan):** Android RS420 = SPP nativo. Es el único camino Android y está caracterizado.
- **Pendiente del ADR de transporte:** iOS (Allflex MFi vs. generic-BLE vs. bridge), y si el producto soporta RS420 o recomienda BLE genérico. El council marcó: probar primero un **bastón BLE genérico** (lee directo, sin SPP ni MFi) — si sirve, la `StickAdapter` suma un `adapter-ble-generic` y este trabajo Android **no se tira** (mismo contrato). Medir también el split iOS/Android real del beta.
