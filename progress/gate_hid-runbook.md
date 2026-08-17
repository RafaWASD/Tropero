# Runbook del gate físico del HID (F0 / RBM8) — para correr con Raf

**Qué decide**: si el camino iOS-sin-MFi (`adapter-hid-wedge`) se implementa o se cierra. Está gateado desde
que se escribió ADR-024 §4 porque *"el Council fue enfático: no fijar arquitectura sobre un mecanismo no
ejecutado en hardware real"*. Hoy se puede correr con hardware propio.

**Qué NO decide**: que exista un bastón comercial con modo HID. El Gallagher HR0 sigue sin confirmar del
fabricante. Este gate mide **el lado del teléfono**. Dos incógnitas distintas.

**Costo**: 0 builds de EAS. ~20 minutos.

---

## Lo que hace falta

| | |
|---|---|
| iPhone | con la build de **TestFlight del 2026-08-11** (`testflight-dev`, commit `0273c43`). ⚠️ **Confirmar antes de medir**: el oráculo depende de las props de ese campo |
| ESP32 | flasheado en **`MODO_HID`** → se anuncia como teclado BLE con el nombre **`EMU-HID-380`** |
| PC | para mandarle comandos al ESP32 por COM7 |

**El flasheo lo hago yo** (30 s, el ESP32 está en mi COM7 y el firmware está respaldado en
`firmware/backup/`). Hoy está en `MODO_SPP`; volver atrás es el mismo comando con `MODO_SPP`. **Decime y lo
hago** — no lo flasheo por mi cuenta para no cambiarte el banco si estabas usándolo.

## Paso 0 — Emparejar (esto sí es tuyo)

Ajustes → Bluetooth en el iPhone → emparejar **`EMU-HID-380`**. Desde ese momento el iPhone lo trata como
un teclado físico.

## Paso 1 — Llegar al campo

App → **Modo maniobra** → *"¿Sin chip? Ingresá la caravana"* → aparece el input
(placeholder **"Número o caravana visual"**).

## Las cuatro mediciones

Yo mando los comandos por serie y vos mirás la pantalla. **Anotá lo que ves, no lo que esperás.**

### (a) ¿Tipea los 15 dígitos completos?
`hiddelay 12` (default, como un wedge real) → `read 1`. Repetir con `hiddelay 5` y `hiddelay 40`.
**Comparar carácter por carácter** contra el EID que imprime `status`. Un dígito perdido con delay bajo es
un resultado, no un error de medición.

### (b) ¿Emite terminador?
`hidterm enter` → ¿dispara la búsqueda sola? Después `hidterm tab` y `hidterm none`.
Se observa porque **busca** (o no). Esto le dice al adapter qué terminador soportar.

### (c) ¿La supresión del teclado en pantalla rompe la UX de manga?
Con el teclado BT emparejado, iOS **no** muestra el teclado en pantalla. Abrir el campo y **sacar captura**.
Mirar: ¿queda barra de sugerencias?, ¿queda un hueco muerto?, ¿el CTA sigue alcanzable con una mano?
**Impresión sin captura no cuenta.**

### (d) ¿Captura confiable con foco programático?
`read 20 1500` → 20 lecturas seguidas. En el medio: **mandar la app a background y volver**, y **rotar**.
Exigir **20/20 completas**, sin caracteres perdidos ni intercalados.

### Extra (no decide el gate)
`hidraw on` → ¿puede tipear la trama completa con el `STX`? Un teclado no puede tipear no-imprimibles, así
que lo más probable es que no. Informa si algún wedge podría entregar trama en vez de EID limpio.

---

## Los tres desenlaces — y por qué importa no mezclarlos

1. **Verde en (a)(b)(c)(d)** → se implementa el adapter (F7), con el terminador y los tiempos que el gate
   validó.
2. **Falla (c) o (d) por comportamiento de iOS** → el camino HID **se cierra con evidencia**. `adapter-hid-wedge.ts`
   queda como placeholder gateado y su binding en `available:false`. F7 **no se ejecuta**.
3. **Falla por una prop del `TextInput` de producción** → **desenlace distinto**. La consecuencia es ajustar
   el campo de scan (o darle uno dedicado al wedge) y **re-correr**, no cerrar el camino.

> Las props que forman parte del oráculo, anotadas **antes** de medir para poder atribuir un fallo:
> `maxLength = SEARCH_TERM_MAX_LENGTH`, `autoCapitalize="characters"`, `autoCorrect={false}`,
> `returnKeyType="search"`, `onSubmitEditing` → búsqueda, y **sin `keyboardType` explícito**.
> Sin esta lista, un fallo no se puede atribuir y se cierra por error una puerta que estaba abierta.

## Comandos del emulador que se usan

`status` / `st` (modo, nombre, EID, y `lecturas=` que cuenta **lo que salió de verdad**) · `selftest` ·
`read [n] [ms]` · `burst [n]` · `hidterm enter|tab|none` · `hiddelay <ms>` · `hidraw on|off`.

⚠️ **Los comandos se mandan con `bench/run-bench.py`**, que abre el puerto con `dtr=False; rts=False`. Abrir
el COM a mano **resetea el ESP32** y devuelve un estado falso — ya pasó una vez y fabricó una conclusión
equivocada.

## Dónde queda el resultado

`progress/` con las capturas, los logs del emulador y los conteos. **Primera línea**: qué NO prueba el gate.
