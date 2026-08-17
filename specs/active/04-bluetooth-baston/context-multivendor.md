# Spec 04 — DELTA «multivendor + selección + demo» — Context (Gate 0)

**Status**: 🟡 En refinamiento — pendiente de Puerta 0 (aprobación de contexto por Raf).
**Fecha**: 2026-07-20 (sesión bastón).
**Tipo**: delta-spec sobre feature 04 (`04-bluetooth-baston`), estilo ADR-028 (corre su propio mini-ciclo SDD; NO reabre el core aprobado de spec 04 / Puerta 1 2026-06-03).
**Fuente de verdad heredada**: **ADR-024** (contrato de ingesta transport-agnóstico + adaptadores) + `design.md`/`requirements.md`/`context.md` de spec 04 + `field-findings.md`. Este delta **respeta** el contrato de ingesta y los tipos de spec 09; **no** los redefine.

## Origen / disparador

Raf (2026-07-20): "desarrollá en paralelo la conexión del bastón — primero Bluetooth Classic y después BLE. Quiero integrar varios métodos de Bluetooth distintos y que la app elija cuál según el dispositivo (Android/iOS) o la forma en que se conecta el bastón. **Compatibilidad máxima.** Estas semanas voy a contactar empresas de bastones, mostrarles una demo de la app y conseguir sus claves para conectar también los que no sean BLE en iOS."

Traducción a la arquitectura existente: lo que pide **ya es** el patrón `StickAdapter` + contrato de ingesta de ADR-024. Lo nuevo es (a) **multi-fabricante** (hoy el parser es solo RS420) y (b) **selección por dispositivo/plataforma/forma-de-conexión** (hoy la selección es solo por plataforma/modo), (c) una **pantalla de conexión** presentable (hoy diferida a "Fase 6"), y (d) un **camino de demo** que lea tags en vivo **sin bastón físico**.

## Restricción dura del momento (define qué se puede construir HOY)

**Raf NO tiene ningún bastón físico a mano — solo el teléfono Android (A07).** Consecuencia directa:

- ~~**No se puede device-validar ningún transporte real**~~ (Classic SPP necesita el RS420; HID necesita un lector HID; GATT necesita un stick con GATT; web-serial necesita el RS420 pareado a la notebook).
  **[RECONCILIACIÓN 2026-07-29 — esto YA NO ES CIERTO.** El ESP32 que estaba de bridge de la balanza se reprogramó como **emulador de bastones**: `firmware/baston-emulator/`, un solo fuente con tres modos por flag de compilación — `MODO_SPP` (Bluetooth Classic SPP, se anuncia `RS420-EMU`, pairing con PIN `1234`), `MODO_HID` (teclado BLE HID) y `MODO_GATT` (BLE Nordic UART). Emite la trama capturada en campo con fidelidad de byte y, sobre todo, **provoca los estados que rompen**: repetidos, ráfagas, corte del link, radio abajo, flap, 10 variantes de trama malformada, trama partida, dos tramas pegadas y mudez. Con eso, **tres de los cuatro transportes pasan a ser device-validables sin comprar nada**: SPP (el del RS420 en Android), BLE-HID (el camino iOS sin MFi, que destraba el gate físico T5.0 / R8.7) y BLE-GATT. Lo que sigue necesitando hardware ajeno son **las idiosincrasias de los lectores reales** (T-MV.5.6) y el web-serial contra el COM virtual del RS420. Motivo de fondo: los tres bugs 🔴 de `dad711f` eran de máquina de estados y se cazaron leyendo código nativo; un emulador los muestra en segundos, y es el **banco de regresión** del bastón de acá en adelante. Detalle y protocolo de control en `firmware/baston-emulator/README.md`; lo que el emulador NO valida, en su §"Qué NO valida".]**
- Todo lo de este delta debe ser **hardware-independiente**: la arquitectura (registro + selección + UI) y el **camino de demo por mock/simulador**. *(Sigue valiendo: el emulador llegó después de este delta y no es un requisito para construirlo, es lo que permite verificarlo.)*
- El `adapter-spp-android` se **escribe** (código completo + lo testeable en unit), pero su validación de conexión real queda **gated** hasta que Raf tenga el RS420 + dev build en el A07. **[Reconciliado: la dep nativa está instalada y el adapter montado (2026-07-29); el stream real se verifica contra el emulador en T-MV.5.7 y solo las mañas del lector físico quedan en T-MV.5.6.]**

## Qué agrega este delta (alcance propuesto — buildable sin hardware)

1. **Registro de drivers por fabricante (`ReaderDriver`/`ReaderProfile`)** detrás del contrato de ingesta. Un driver = `{ vendorId, transportKind, frameParser, connectionParams (UUIDs/PIN/baud/protocolString), capabilities, deviceMatch (patrón de nombre/servicio anunciado) }`. El **RS420 pasa a ser UN driver** (reusa `parser-rs420.ts` tal cual). Agregar un fabricante = **agregar una config de driver**, no tocar el contrato ni los adaptadores. Esto es "conseguir las claves de cada empresa → cada una es un driver".
2. **Motor de selección por capacidad** (extiende `selectTransportAdapter`): elige **adaptador + driver** según `(plataforma, transportes disponibles, dispositivo descubierto/recordado, perfil del driver)`. Prioridad por plataforma (ver matriz abajo). Lógica **pura y testeable** (sin device).
3. **Pantalla de conexión + selección de bastón** (`StickConnectionScreen` + indicador de estado global, R9 de spec 04, hoy diferido): descubrir → listar → elegir → conectar → estados → recordar. Es también **la cara de la demo** para fabricantes.
4. **Camino de demo por mock/simulador**: un modo que **simula un bastón leyendo tags en vivo** (para mostrar el pipeline completo — conexión, lectura, dedup, confirmación, find-or-create — sin bastón físico). Gateado para dev/demo; **nunca** un EID simulado se declara como real (ver edge cases).
5. **`adapter-spp-android` escrito** (Bluetooth Classic SPP, `react-native-bluetooth-classic`): código + unit de lo puro; **device-test gated** por hardware. Incluye vetar el config plugin contra Expo SDK 56 + permisos Android (sin comprometer el dev build hasta tener con qué probar).
   **[as-built 2026-07-29 — el gate se levantó por pedido de Raf.** El veto dio COMPATIBLE (evidencia + build Gradle real), la dep está instalada, el adapter está **montado** en Android, hay permisos de runtime, lista de emparejados reales y config plugin propio. **Queda gated SOLO el stream de un RS420 físico** (T-MV.5.6): nadie tiene uno. Detalle en `progress/impl_baston-android-spp.md`.**]**

## Compatibilidad por plataforma (la matriz que guía la selección)

| Transporte | Android | iOS | Clave del fabricante |
|---|---|---|---|
| **BLE-HID** (parea como teclado, tipea el EID) | ✅ | ✅ | **ninguna** — universal, sin MFi. **Máxima compatibilidad.** |
| **BLE GATT** abierto | ✅ | ✅ | Service/Char UUIDs + trama. Raro en sticks. |
| **Bluetooth Classic SPP** (RS420) | ✅ nativo | ⚠️ solo MFi | iOS: autorización MFi + protocol string (+ SDK). |
| **MFi / External Accessory** (iOS Classic) | — | ✅ | autorización de marca + protocol string. Track Facundo. |

**Dos verdades que fija este delta:**
- **"BLE" para sticks ≠ GATT.** Ningún stick reader de ganado expone GATT abierto (investigación spec 04 sesión 22). El camino BLE cross-platform real es **BLE-HID**. El "después BLE" de Raf = **HID-wedge** (+ un `adapter-ble-gatt` solo si un fabricante entrega UUIDs abiertos).
- **iOS es el cuello de botella**: un Classic (RS420) **no conecta en iOS** sin MFi + protocol string del fabricante. Por eso el outreach de Raf es el unlock correcto; la app queda **lista para enchufar** cada clave que consiga (como un driver / protocol string).

## Edge cases refinados

- **Ambigüedad de selección** (un device alcanzable por >1 vía, ej. un stick que hace Classic *y* HID): definir prioridad determinística por plataforma + confiabilidad (regla tentativa: en iOS preferir HID > GATT > MFi; en Android preferir stream nativo SPP/GATT > HID). La spec fija la tabla; el motor de selección la implementa como función pura.
- **Selección "por la forma en que se conecta"**: el `transportKind` lo determina el **canal de descubrimiento** (pareado en Ajustes/Classic vs anunciado por BLE vs teclado HID) cruzado con el `deviceMatch` del driver. Sin devices reales, el matching se **diseña** ahora y se **valida** cuando haya hardware.
- **Integridad SENASA con el modo demo/simulador**: un EID **simulado** NO puede terminar declarado como real (declaración en 10 días hábiles). El simulador queda **gateado a dev/demo** (fuera de prod, patrón triple-guard como el bridge E2E `__RAFAQ_BLE_E2E__`) y/o marca visualmente la lectura como "demo". La confirmación visual pre-commit del contrato (R2) se mantiene.
- **Driver desconocido**: un device que no matchea ningún driver → estado "no reconocido" + fallback a carga manual (piso siempre disponible). Nunca bloquea.
- **Permisos por transporte** (ya modelados en `permissions.ts`): SPP-Android pide BT runtime; HID ninguno de app; web-serial permiso de navegador; manual/mock ninguno. Permiso denegado → estado con CTA + manual operativo.
- **Reconexión / device recordado**: `remembered-device.ts` (hoy sin call-site productivo) se cablea de verdad para SPP/GATT; foreground-only en MVP.

## Fuera de alcance / gated (no en este delta)

- **Device-validation** de Classic SPP / HID / GATT — gated por hardware (cuando Raf tenga el RS420 y/o un lector HID/BLE).
- **Adapter MFi / External Accessory (iOS Classic)** — requiere autorización + protocol string del fabricante (Allflex "Reader Connectivity SDK 2.0", etc.). **Track paralelo de negocio (Facundo)**, off-critical-path (ADR-024 §5). Este delta deja la arquitectura preparada (el driver puede declarar `transportKind: 'mfi'` + protocolString), pero no implementa el adapter EA hasta tener autorización.
- **Correlación EID↔peso** (spec 05). **Certificación / lista de compatibilidad miTropero** (negocio).

## Ganchos para la fase de spec (a confirmar en Puerta 0)

- **Packaging SDD**: delta-spec sobre 04 (`*-multivendor.md`: requirements/design/tasks), estilo rodeo-grande. NO reabre el core aprobado de spec 04.
- **¿ADR?**: el **registro de drivers + motor de selección por capacidad** es un patrón que se va a referenciar (cada fabricante nuevo lo usa) → probable **enmienda a ADR-024** (o ADR nuevo corto) para dejarlo firme. Se decide en Puerta 0 / al escribir la spec, no antes (política tentativo-vs-firme).
- **Frontera con spec 09**: se mantiene la de spec 04 (04 es dueña de `app/src/services/ble/*`; no toca los screens de find-or-create; reexporta el stub + monta el adapter). El delta agrega archivos nuevos en `services/ble/` (registro, selección, drivers) + la pantalla de conexión.
- **Colisión-safe**: vive en `app/src/services/ble/*` + una pantalla de conexión nueva; no toca teléfono/auth (otra terminal).

## Puerta 0 — qué se aprueba

Que el **alcance de arriba** (registro multi-fabricante + motor de selección + pantalla de conexión/demo + `adapter-spp-android` escrito, todo hardware-independiente; MFi/HID/GATT device-validation gated) es la dirección correcta para pasar a `spec_author` (delta requirements/design/tasks). Al aprobarse, escribo la spec del delta y la traigo para la Puerta 1.
