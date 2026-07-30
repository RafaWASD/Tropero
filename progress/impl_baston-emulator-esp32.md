# impl — Emulador de bastones RFID sobre ESP32 (banco de regresión del bastón)

**Fecha**: 2026-07-29 · **Base**: `16cf880` (árbol limpio) · **Tipo**: firmware + docs (NO toca `app/`)
**Autorización de Raf (textual)**: *"corregí 003 como necesites y guardá todo lo que el esp tiene HOY en
algun lado para mas tarde restaurarlo. y hace todos los cambios que necesites para usar el esp32 para
cubrir todas las pruebas que se pueda"*.

`baseline_commit: 16cf880`

## Por qué

Los tres bugs 🔴 del camino SPP de Android (`dad711f`) eran de **máquina de estados**, estaban en código
dado por "escrito y testeado", y se cazaron **leyendo el código nativo de la librería** — el peor hacía
que no se emitiera ni una lectura. Un emulador los habría mostrado en segundos. Esto no es un test de
una vez: es el **banco de regresión** del bastón.

## Entregable

```
firmware/baston-emulator/
├── baston-emulator.ino   1467 líneas · UN solo fuente · 3 modos por flag de compilación
└── README.md             qué prueba cada modo, comandos de flasheo, protocolo de control,
                          veredicto medido del binario único, y QUÉ NO VALIDA
```

`firmware/backup/` NO se tocó. ADR-003 NO se tocó (ya traía la aclaración del segundo rol del ESP32).

### Estructura del fuente

| sección | qué hay |
|---|---|
| 0 | modo de compilación (`EMU_MODE`) + toda la config (`#define`) |
| 1 | **tipos** — van arriba de todo: el preprocesador de Arduino inserta los prototipos **antes** de la primera función, así que un tipo declarado más abajo y usado en una firma rompe el build (me pasó: `'EmuTerm' has not been declared`) |
| 2 | utilidades (deadlines rollover-safe, impresión escapada de bytes) |
| 3 | **generador de tramas y de EIDs — ÚNICA fuente de verdad, compartida por los 3 modos** |
| 4 | transporte: una implementación por modo detrás de la MISMA interfaz (`txBegin/txPoll/txLinked/txSendRaw/txDropLink/txRadioOff/txRadioOn`) |
| 5 | escenarios (lo que provoca los estados que rompen) |
| 6 | consola de control |
| 7 | entradas (serie + botón BOOT) y `loop()` |

Los tres modos comparten las secciones 1, 2, 3, 5, 6 y 7; solo la 4 se compila por modo. El generador
no está duplicado en ningún lado: es lo que tiene que ser fiel al parser y duplicarlo es cómo se
desincroniza.

## Veredicto medido: ¿entran los 3 modos en un solo binario?

**SÍ, y en la partición por defecto. El supuesto de que no entraban (mío, en el enunciado) es falso.**

Medido hoy con `arduino-cli 1.4.1` + core `esp32 3.3.8`, placa `esp32:esp32:esp32` (partición default,
máximo de app = 1.310.720 B):

| build | flash | % | globals |
|---|---|---|---|
| `MODO_SPP` | 1.071.256 B | 81 % | 42.016 B |
| `MODO_HID` | 1.112.843 B | 84 % | 41.472 B |
| `MODO_GATT` | 1.110.547 B | 84 % | 41.536 B |
| **sonda que linkea los TRES stacks juntos** | **1.113.523 B** | **84 %** | 42.360 B |

La sonda (`probe-all.ino`, en el scratchpad: instancia `BluetoothSerial` + `BLEHIDDevice` + servicio
Nordic UART y llama sus métodos para que el linker no los descarte) pesa **3 kB más** que el build de
GATT solo. Razón verificada en el `sdkconfig` de la plataforma: el core trae Bluedroid precompilado en
**modo dual** (`CONFIG_BTDM_CTRL_MODE_BTDM=1`, `CONFIG_BT_CLASSIC_ENABLED=1`, `CONFIG_BT_SPP_ENABLED=1`,
`CONFIG_BT_BLE_ENABLED=1`, `CONFIG_BT_GATTS_ENABLE=1`), así que el blob del stack se linkea entero de
todos modos y sumar el otro perfil casi no cuesta flash.

**Igual se entregan tres builds, por razones que NO son el tamaño** (y así queda dicho en el README):
(1) la coexistencia **en RAM** no está verificada y no puedo verificarla sin flashear; (2) un binario
único necesitaría cambio de modo en runtime = `deinit`/`init` de Bluedroid con bonding de por medio,
o sea estado nuevo justo en la capa que estamos tratando de testear; (3) **contaminaría el test**: un
device que se anuncia a la vez como RS420 SPP, como teclado BLE y como periférico NUS es una quimera
que ningún lector real presenta, y `findDriverForDevice` matchea justamente por nombre y UUID anunciado.

Si algún día conviene un solo flasheo, el camino queda medido y abierto.

## Verificación hecha (y la que NO)

### Ejecutada

1. **Compilan los tres modos, sin warnings propios.** `--warnings all` deja un único warning y es del
   core: `'BluetoothSerial' is deprecated: won't be supported in version 4.0.0 by default` (documentado
   en el README como riesgo futuro de `MODO_SPP`).
2. **El flag de compilación realmente selecciona el modo** (no es un placebo): grepeando los `.bin`,
   cada binario contiene **solo** su propia cadena de modo — `build-spp` → `MODO_SPP (Bluetooth`,
   `build-hid` → `MODO_HID (teclado`, `build-gatt` → `MODO_GATT (BLE`. Y las librerías linkeadas
   difieren (`BluetoothSerial` vs `BLE`). O sea `--build-property build.defines=-DEMU_MODE=…` llega al
   preprocesador.
3. **Las tramas que va a emitir pasan por el parser REAL de la app.** `check-frames.mjs` (scratchpad)
   importa `app/src/services/ble/parser-rs420.ts` y corre las 22 aserciones: **22 ok / 0 fail**.
   - buenas → EID correcto: captura de campo (`\x02` + `1000000` + EID + ts + `\r\n`), `term lf`,
     `term cr`, `stx off`, `eid ar` (`032…`), y los 5 primeros EIDs incrementales pasan `isValidTag`.
   - malformadas → `null`: `header`, `short`, `long`, `alpha`, `tsjunk`, `nots`, `binary`, `empty`,
     `garbage`.
   - `double` → 2 líneas, cada una parsea al EID.
   - **Hallazgo del propio check**: `bad noterm` **no es un caso de parser** — su contenido es una trama
     VÁLIDA; el defecto es de transporte (sin terminador la línea no se entrega). El texto del
     `selftest` decía "las 10 de arriba deben dar null", que era **falso**. Corregido en el firmware y
     documentado como tal en el README y en la tabla de escenarios.
4. **`node scripts/check.mjs` → RC=0, verde.** Como debía ser: no se tocó una línea de `app/`.

### NO ejecutada (y por qué)

- **NO se flasheó el ESP32** (restricción explícita del pedido: lo corre Raf, presente, porque a partir
  de ahí el device deja de tener el firmware de la balanza — respaldado en `firmware/backup/`).
- **El generador no se ejecutó**, se verificó su **contrato**: en esta máquina no hay compilador nativo
  (solo el cross-compiler xtensa), así que `check-frames.mjs` transcribe byte por byte lo que produce el
  código C con sus defaults y lo pasa por el parser real. La implementación se confirma en la mesa en 1
  segundo con el comando `selftest`, que imprime todas las variantes escapadas **sin necesidad de
  teléfono ni conexión** — ese es el primer paso después de flashear.
- **Nada de lo que dependa de la radio** (pairing, bonding, advertising, HID en iOS, MTU real).

## Protocolo de control (resumen; el completo está en el README)

Una línea por comando, `\n`, por el **serie USB a 115200**. `help` los lista. Prefijo `[emu]` en todo lo
que imprime. Además: **botón BOOT** (corto = 1 lectura, largo = `off 5000`) y, solo en `MODO_GATT`, los
mismos comandos **por aire** escribiendo en el RX del Nordic UART.

`read` `same` `burst` `eid` `seq` `gap` `auto` `mute` `drop` `off` `flap` `bad` `split` `double` `stx`
`term` `clock` `name` `reboot` `status` `selftest` `help` + `chunk` (GATT) + `hidterm`/`hiddelay`/
`hidraw` (HID). Un comando de otro modo contesta `ERR: ese comando no aplica al modo compilado`.

Los escenarios cubren lo que pedía el enunciado: repetidos del mismo EID (`same`), ráfagas (`burst`) y
espaciadas (`gap`), corte desde el emulador (`drop` = link; `off` = radio; `flap` = ciclos), 10 tramas
malformadas (`bad`), mudez (`mute`), EID configurable e incremental (`eid`/`seq`). Más dos que no
estaban pedidos y salieron de leer `spp-protocol.ts`: `split` (trama partida en dos escrituras → el
reensamblado) y `double` (dos tramas en UNA escritura → el camino defensivo de `splitSppPayload`, que
hoy no tiene ningún test contra un transporte real).

## Autorrevisión adversarial

Qué busqué y qué encontré (todo corregido y re-verificado con los tres builds + el check de tramas):

1. **Desviaciones del pedido.** El enunciado pedía "UN solo fuente": lo cumplí literal (un `.ino`), lo
   que además hace imposible duplicar el generador. Repasé los 6 escenarios pedidos uno por uno contra
   los comandos implementados: los 6 están, más `split`/`double`.
2. **🔴 Mudez que no se aplicaba a todo.** El chequeo de `mute` estaba en `emitReading`, así que
   `mute 30` + `bad header` **igual mandaba la trama** (y cualquier escenario nuevo habría nacido
   ignorándolo). Movido al **único punto por el que sale un byte** (`sendBytes`) → el guard se escribe
   sobre la ausencia, no sobre cada caso.
3. **🟠 El log mentía el motivo de "no salió".** Decía siempre *"DESCARTADA, nadie conectado"*, incluso
   cuando estaba conectado y lo que fallaba era otra cosa — que en `MODO_HID` es un caso REAL y
   frecuente: un teclado **no puede tipear** el STX ni bytes binarios. Ahora distingue los tres motivos
   (mudo / nadie conectado / conectado pero nada mandable) y el modo HID informa cuántos bytes descartó.
4. **🟠 El contador contaba intentos, no lecturas.** `lecturas=N` en `status` incrementaba aunque la
   trama no saliera → inservible justamente para lo que sirve (compararlo contra lo que ingirió la app).
   Ahora cuenta lo que salió.
5. **🟠 Flap con la máquina de estados mal escrita.** Mi primera versión tenía líneas duplicadas y
   apagaba/prendía en el mismo tick; peor, no dejaba **aire arriba** entre cortes, así que el flap solo
   probaba "el device no está" y **nunca** el ciclo de reconexión (que es el bug 3 de `dad711f`).
   Reescrito con `g_flapNextDownMs` + `EMU_FLAP_SETTLE_MS` = 4 s arriba entre corte y corte.
6. **🟠 Comando por aire ejecutándose DENTRO del callback del stack BLE.** Un `bad`/`split` desde ahí
   notifica en pleno callback de escritura (reentrada) y un `reboot` reinicia con el stack a medio
   camino. Ahora se **encola** y lo corre el `loop()`.
7. **🟠 Nombre Bluetooth que se trunca en silencio.** En BLE el nombre comparte los 31 bytes del
   advertising con flags + appearance + UUID; si no entra, `buildRawAdvData` lo **trunca** (lo leí en el
   código de la lib, no lo supuse). Es una hora perdida buscando por qué el teléfono ve otro nombre →
   `name` ahora rechaza >18 caracteres **con el motivo**.
8. **🟡 `name` pasado a minúscula.** Lowercaseaba toda la línea, así que el nombre Bluetooth se
   guardaba en minúscula (lo ve el operario en los ajustes del teléfono). Ahora solo se normaliza el
   comando, y el argumento de `name` se guarda tal cual.
9. **🟡 Warning de truncación real en el timestamp.** `-Wformat-truncation` marcó que
   `formatReaderClock` podía escribir un campo corto si mes/día fueran >99 → un ts de 11 dígitos haría
   fallar el parseo **por el largo**, o sea un falso negativo del banco. Cerrado con `% 100` en los
   seis campos (ahora son 12 caracteres demostrables).
10. **Fidelidad al parser, caso por caso.** Verificado con el parser real (punto 3 de arriba), no de
    memoria. Los casos malformados salen de los **mismos primitivos** que la trama buena (header, EID y
    reloj actuales) para que no puedan desincronizarse de ella: lo único que cambia es el defecto.
11. **Honestidad sobre lo que NO valida.** Sección propia en el README: emparejamiento del RS420 real,
    su semántica de desconexión, sus tiempos, su buffer interno / "sessions", su versión de firmware,
    iAP/MFi, qué tipea un HID comercial, y RAM/heap bajo estrés (por eso el log imprime el heap en cada
    subida de radio: para ver una fuga **del emulador** antes de atribuírsela a la app).
12. **El TODO de protocolo que sigue abierto.** El `0x02` y el `\r\n` son la **hipótesis documentada**,
    no una medición (el hex dump del lector real sigue pendiente en `field-findings.md`). No afecta al
    parseo —`normalizeTag` recorta cualquier control char de los bordes— y el emulador permite mover
    las dos cosas (`stx`, `term`) justamente para no depender de esa hipótesis. Anotado en los dos docs.

## Reconciliación de specs

Ninguna spec podía quedar diciendo que hace falta un RS420 para lo que ahora se puede probar:

| archivo | qué cambió |
|---|---|
| `tasks-multivendor.md` | **T-MV.5.6 se ACOTÓ**: ya no dice "stream, dedup, asignación masiva, corte y reconexión con el bastón físico" — eso pasó a la nueva **T-MV.5.7** (con los 10 pasos concretos contra el emulador, **no** gated por hardware, pendiente de flasheo). T-MV.5.6 queda con lo irreductible: las idiosincrasias del lector real. Actualizados también la tabla de fases, la fila de trazabilidad de RMV5.9 y T-MV.7.3 |
| `context-multivendor.md` | la afirmación *"**No se puede device-validar ningún transporte real**"* quedó **tachada** con la reconciliación: tres de los cuatro transportes pasan a ser device-validables sin comprar nada |
| `requirements-multivendor.md` | RMV5.9: segunda nota de reconciliación (el gate se acota otra vez **y ahora sí se puede correr**); fila de la tabla de bloques; nota en el encuadre de "gated por hardware" |
| `tasks.md` (core) | **T5.0** — el gate físico del HID exigía *"conseguir un lector HID-capable (AgriEID USD 595+ / un genérico AR si se verifica que hace HID)"*, que era **el** bloqueo. `MODO_HID` es un teclado BLE HID de verdad → el gate se puede correr; lo que no decide es qué tipea un lector comercial |
| `field-findings.md` | sección nueva de la sesión: los tres modos, qué destraba cada uno, y qué NO reemplaza; más la nota de que el `0x02`/`\r\n` siguen sin medirse |

`git diff --stat` = `git diff --stat -w` en los 5 archivos → sin churn de CRLF (los `.md` del repo son
CRLF; se escribió preservando el line-ending de cada archivo).

## Lo que queda pendiente / dudoso

1. **Flashear y correr T-MV.5.7.** Es de Raf. Primer comando después del flasheo: `selftest` (verifica
   el generador sin teléfono), después `status`, después emparejar.
2. **¿Empareja el legacy pairing con PIN?** `MODO_SPP` hace `disableSSP()` + `setPin("1234")` para ser
   fiel al RS420. Si algún Android moderno se niega, el fallback está listo y documentado:
   `-DEMU_SPP_LEGACY_PIN=0` → SSP "just works" (menos fiel, empareja siempre). No pude probarlo.
3. **¿Acepta iOS el bonding just-works del teclado?** `MODO_HID` usa
   `ESP_LE_AUTH_REQ_SC_MITM_BOND` + `ESP_IO_CAP_NONE`, que es lo que hacen los teclados BLE caseros.
   Si iOS lo rechaza, el fallback documentado es `-DEMU_HID_AUTH=ESP_LE_AUTH_REQ_SC_BOND`.
4. **`SerialBT.end()` / `begin()` repetido**: el ciclo está soportado por la lib (`_stop_bt` libera colas
   y `_spp_client`), pero un `flap` largo podría ir comiendo heap. Por eso el log lo imprime en cada
   subida. Si aparece una fuga, es del emulador, no de la app.
5. **`BluetoothSerial` está deprecada** en el core (único warning del build). Cuando se actualice a 4.x,
   `MODO_SPP` hay que revisarlo; los otros dos modos no dependen de esa clase.
6. **No encontré ningún bug en `parser-rs420.ts`.** Lo leí completo con sus tests y le pasé las 22
   tramas del emulador: se comporta como dice. La única cosa que registré no es un bug sino una
   consecuencia del diseño: `normalizeTag` recorta control chars **de los bordes**, así que la
   fidelidad del byte de control inicial es indiferente para el parseo (y por eso el TODO del hex dump
   nunca dolió).
