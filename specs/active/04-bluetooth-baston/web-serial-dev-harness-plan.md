# Spec 04 — Plan: banco de pruebas Web Serial (RS420 → app web, sobre Windows)

**Status**: Insumo técnico / propuesta de track. NO es la spec final. Escrito por el leader (terminal secundaria, 2026-06-02) a pedido de Raf. **Aditivo** al `android-spp-impl-plan.md` — no lo reemplaza ni toca el ADR de transporte.
**Idea de Raf**: el RS420 ya se lee perfecto desde la notebook Windows (caracterizado en Arduino IDE). ¿Podemos enchufarlo a la app **en web** para probar y empezar a desarrollar la integración del bastón **hoy**, sin dev build ni device?
**Respuesta**: sí. Vía **Web Serial API** sobre el puerto COM virtual del SPP. Encaja como un **4º adaptador** detrás de la interfaz `StickAdapter` que ya define `android-spp-impl-plan.md`, reusando el `parser-rs420.ts` ya committeado (`9126dba`).

> **No lo implementa esta terminal** (toca `app/src/services/ble/*`, zona activa de la terminal de spec 04). Este doc es para que esa terminal lo levante como track. Colisión-safe: archivo nuevo, no toca código ni el plan android.

---

## 1. La distinción técnica que define todo

El RS420 es **Bluetooth Classic SPP** (Serial Port Profile), **no BLE**. Consecuencia:

- ❌ **Web Bluetooth** (`navigator.bluetooth`) **NO sirve** — solo habla BLE/GATT. Callejón sin salida.
- ✅ Al parear el RS420 a Windows, el SO crea un **puerto COM virtual** ("Standard Serial over Bluetooth link, COMx") — **lo mismo que lee el Arduino IDE**. Ese COM se abre desde el navegador con la **Web Serial API** (`navigator.serial`), en **Chrome/Edge sobre Windows**.

Camino completo: **RS420 → BT SPP → COM virtual de Windows → `navigator.serial` (Chrome) → app web (`pnpm web`).**

## 2. Qué es y qué NO es (honesto — tentativo vs firme)

**Es**: un **banco de pruebas de desarrollo** que convierte el `adapter-mock` en una **fuente de TAGs reales** del RS420 físico, en la app web, hoy. Desbloquea el desarrollo+testing de **toda la capa app-side** del bastón contra hardware real, sin dev build ni device.

**NO es**: el **transporte de producción**. Web Serial NO existe en React Native ni en iOS Safari. La app real en el teléfono usa transporte **nativo** (Android SPP vía `react-native-bluetooth-classic`; iOS MFi/iAP — barrera del ADR-024). Este harness vive **solo en el navegador de la notebook**; el **iPhone queda afuera de este camino**.

**Por qué igual vale muchísimo**: como todo cuelga de la interfaz `StickAdapter`, el 4º adaptador es lo **único** dev-only. Todo lo de atrás —provider, dedup ~3s, feedback, busy-mode, status/reconexión, wiring a find-or-create— es **compartido** con el adaptador nativo y **no se tira**. Además **de-riskea el ADR-024**: validás el pipeline entero + el parser contra el RS420 real **antes** de comprometerte al transporte nativo, y tenés un **demo funcional** (bastoneás → la app abre la ficha) sin compilar nada.

## 3. Arquitectura — un 4º adaptador, cero parser nuevo

Respeta la interfaz de `android-spp-impl-plan.md`:

```
StickAdapter (interfaz transport-agnóstica)
  connect(deviceId) / disconnect() / onTagRead(cb) / onStatus(cb) / enable() / disable()
   ├── adapter-spp-android.ts   ← react-native-bluetooth-classic (producción Android)
   ├── adapter-mock.ts          ← CI / dev sin device
   ├── adapter-ea-ios.ts        ← MFi (futuro)
   └── adapter-web-serial.ts    ← ESTE track (dev-only, Platform.OS==='web')
        ↓
   parser-rs420.ts  (YA committeado 9126dba — parseRs420Line / isValidTag / normalizeTag)
        ↓
   BleStickEvent{ type:'tag_read', tag } → find-or-create (spec 09, puerta manual YA construida en C2)
```

- El `BleStickListenerProvider` monta `adapter-web-serial` cuando `Platform.OS==='web'` (detrás del mismo split de plataforma que ya usan, ej. el guard de push-token). En device real monta el nativo; en CI, el mock.
- `enable()/disable()` + `useBusyMode()` funcionan igual (MODO MANIOBRAS / CREATE-EDIT suspenden el listener) — se ejercitan reales con este adaptador.

## 4. Mecanismo concreto

1. **Pairing (una vez, fuera de la app)**: parear el RS420 a Windows por Bluetooth, PIN **1234** (SPP slave). Windows crea `COMx` (verificar en Administrador de dispositivos = el mismo puerto que usó el Arduino IDE).
2. **Pedir el puerto** (gesto de usuario, en la pantalla de conexión de "Más"): `const port = await navigator.serial.requestPort()` → el usuario elige el COM del bastón. Permiso una vez por sesión.
3. **Abrir**: `await port.open({ baudRate: 9600 })`. *Web Serial EXIGE pasar un baud aunque el COM virtual lo ignore* (el plan android dice "baud-independent"); usar el baud que mostró Arduino IDE. Si no anda, probar 115200 (gate §6).
4. **Leer y framear**: `port.readable.pipeThrough(new TextDecoderStream())` → un `TransformStream` que bufferea y corta por `\n` (o `\r\n`) → una **línea cruda por lectura**.
5. **Parsear (reuso total)**: cada línea → `parseRs420Line(line)`. El parser ya descarta el byte de control STX (`0x02`), la cabecera fija `1000000` y el timestamp; devuelve `{eid}` o `null` ante cualquier malformado (nunca tira). Validar con `isValidTag(eid)` (R8).
6. **Emitir**: `{eid}` válido → `BleStickEvent{type:'tag_read', tag: eid}` por `onTagRead` → el provider dispara find-or-create (spec 09). MVP usa **timestamp del teléfono** (el del lector se descarta, ya en el parser).
7. **Recordar el bastón**: `navigator.serial.getPorts()` devuelve los puertos ya autorizados → al reabrir la app, reconecta sin re-preguntar (mapea a la decisión "recordar el bastón" del context). 
8. **Estado/reconexión**: escuchar el evento `disconnect` de `navigator.serial` + capturar errores del read loop → reflejar en `onStatus` (conectado/desconectado/buscando) y reintentar `open()` con backoff. Mismo `useBleConnectionStatus`.

## 5. Tareas (boceto para la terminal de 04)

- **W1 — Interfaz `StickAdapter`** (si no existe aún) conforme a spec 09 + `adapter-mock`. *Compartida con el track android; coordinar para no duplicar.*
- **W2 — `adapter-web-serial.ts`**: `connect` (requestPort + open + read loop), framing por `\n` → `parseRs420Line` → `isValidTag` → emit; `disconnect` (close), `onStatus`, `enable/disable`. Reusa `parser-rs420.ts` tal cual. **Desbloqueada ya** (no necesita device build, solo el RS420 pareado a Windows).
- **W3 — Wire al `BleStickListenerProvider`** por `Platform.OS==='web'` + a find-or-create (spec 09, ya construido en C2) + `useBusyMode`.
- **W4 — Pantalla de conexión en "Más"** (web): `requestPort` + lista de `getPorts()` + estado + olvidar. Reusa la UI que el track android también necesita.
- **W5 — dedup ~3s por-TAG** (compartido, transport-agnóstico) + feedback web (visual + beep Web Audio; vibración desktop es pobre → se prueba en device después).
- **W6 — Prueba real**: bastoneás contra la app web → dedup, asignación masiva (3 TAGs distintos = 3 altas, spec 09 R8), find-or-create, busy-mode en MODO MANIOBRAS (cuando exista).

> Casi todo W2–W6 es **lógica compartida** con el adaptador nativo. El esfuerzo neto exclusivo del harness es W2 (el adaptador Web Serial) — el resto se construye una vez y sirve a ambos.

## 6. Caveats / gates de verificación

- **Web Serial = solo Chromium** (Chrome/Edge), no Safari/Firefox. Testeás en Chrome → ok. Requiere **contexto seguro** → `localhost:8081` de `pnpm web` califica.
- **Baud**: confirmar el valor real de Arduino IDE (o que el COM virtual lo ignora). Gate antes de W2.
- **Emit-on-read**: el RS420 debe emitir la línea solo al leer un TAG (el éxito en Arduino IDE lo sugiere). Si resultara request/response, ajustar el read loop. Verificar en W2.
- **Framing**: confirmar terminador real (`\n` vs `\r\n`) con una captura cruda; el parser ya tolera el `\r` y el STX por `normalizeTag`.
- **Permiso/gesto**: `requestPort()` necesita gesto de usuario; UX de una vez por sesión, aceptable en dev.

## 7. Plan B — puente WebSocket (si Web Serial fricciona)

Un script Node chico con `serialport` lee `COMx` y empuja las líneas por `ws://localhost:PORT`; la app se conecta por WebSocket con un `adapter-websocket.ts` (mismo contrato `StickAdapter`, mismo `parser-rs420`). 
- **Pro**: anda en cualquier browser, sin permiso Web Serial, desacopla el hardware (se puede loguear/replay).
- **Contra**: un proceso extra corriendo en la notebook.
- **Cuándo**: si Web Serial da problemas de permiso/baud/driver. Para fidelidad con la arquitectura de producción, Web Serial es preferible (el adaptador vive **dentro** de la app); el WS-bridge es el fallback robusto.

## 8. Qué NO toca / coordinación

- **No toca el ADR de transporte** (iOS MFi vs generic-BLE vs bridge sigue pendiente, gobierna producción).
- **No toca `android-spp-impl-plan.md`** — es un track paralelo y aditivo; comparten `StickAdapter` + `parser-rs420`.
- **No reemplaza el dev build nativo** — ese sigue siendo el camino de producción (Android SPP / iOS MFi).
- **Lo implementa la terminal de spec 04** (dueña de `app/src/services/ble/*`). Esta terminal solo documenta.

## 9. Insumos / referencias

- `app/src/services/ble/parser-rs420.ts` (committeado `9126dba`) — `parseRs420Line` / `isValidTag` / `normalizeTag`. **Reuso directo, no se reescribe.**
- `specs/active/04-bluetooth-baston/android-spp-impl-plan.md` — la interfaz `StickAdapter` + adaptadores; este doc suma el 4º.
- `specs/active/04-bluetooth-baston/context.md` + `field-findings.md` — protocolo capturado, decisiones de UX (recordar bastón, dedup ~3s, feedback, manual-first), pairing PIN 1234.
- `specs/active/09-buscar-animal/` — interfaz `BleStickEvent`/`useBleStickListener`/`BleStickListenerProvider`/`useBusyMode` + motor find-or-create (puerta manual ya construida en C2 de spec 02 fe).
- Web Serial API (MDN): `navigator.serial.requestPort()/getPorts()`, `SerialPort.open({baudRate})`, `port.readable` + `TextDecoderStream`. Chromium/Windows, contexto seguro.

## 10. Resumen ejecutivo

Un adaptador `adapter-web-serial.ts` (dev-only, web) que lee el COM virtual del RS420 pareado a Windows vía `navigator.serial`, reusa el `parser-rs420.ts` ya hecho, y emite por el mismo contrato que el bastón nativo. Te deja **desarrollar y probar toda la integración del bastón contra el hardware real, en web, hoy**, sin dev build ni device — y todo el laburo (menos el adaptador en sí) se comparte con el transporte nativo de producción. El iPhone y el transporte shippable siguen siendo harina de otro costal (ADR-024).
