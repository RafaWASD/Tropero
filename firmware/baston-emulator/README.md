# Emulador de bastones RFID sobre ESP32 — banco de regresión del bastón

Firmware que hace pasar al ESP32 por un lector de caravanas, para poder probar los transportes del
bastón **sin tener un lector físico**. No es producto: es instrumental de test (ADR-003 §"Segundo rol
del mismo ESP32").

## Por qué existe

El camino SPP de Android (commit `dad711f`) tenía **tres bugs 🔴** en código que estaba dado por
"escrito y testeado". Se cazaron **leyendo el código nativo de la librería**, no ejecutando nada:

| bug | consecuencia |
|---|---|
| framing invertido (`LineFramer` sobre un payload ya delimitado) | **cero lecturas**, aun con el bastón enchufado |
| `pairDevice()` en cada connect | promesa que nunca resuelve → estado clavado en `connecting` |
| el device objetivo se anotaba solo al conectar bien | la cadena de reintentos **moría** tras el primer fallo |

Los tres eran de **máquina de estados**. Un emulador los muestra en segundos. Por eso esto no es un
test de una vez: es el **banco de regresión** del bastón, y por eso emitir la trama feliz no alcanza —
lo que lo vuelve útil es poder **provocar los estados que rompen**.

## Qué prueba cada modo

Un solo fuente, `baston-emulator.ino`, con tres modos por flag de compilación. El **generador de
tramas y de EIDs vive en la sección 3 de ese archivo y es compartido por los tres** (duplicarlo es
cómo se desincroniza de `parser-rs420.ts`).

| modo | transporte | qué valida de NUESTRO lado |
|---|---|---|
| `MODO_SPP` | Bluetooth Classic SPP (`BluetoothSerial`), nombre `RS420-EMU`, pairing con PIN `1234` | `adapter-spp-android.ts` completo: enumeración de emparejados, apertura del RFCOMM, `splitSppPayload`, dedup, corte + backoff + reconexión, foreground. **Es el camino que replica al RS420 en Android.** |
| `MODO_HID` | teclado BLE HID (`BLEHIDDevice`), nombre `EMU-HID-380` | el camino **iOS sin MFi**. Hoy `adapter-hid-wedge.ts` es un placeholder gateado por *"no tenemos hardware BLE-HID"* (ADR-024 §4 / R8.7): con este modo el gate **se puede correr** — ¿el `TextInput` de RN capta los 15 dígitos + Enter?, ¿iOS suprime el teclado en pantalla y cómo queda la UX de manga? |
| `MODO_GATT` | BLE Nordic UART (UUIDs de ADR-003), nombre `EMU-GATT-STICK` | el tercer transporte del multivendor (`adapter-ble-gatt`, T-MV.6.3, sin implementar). Notifica la trama **partida en trozos de 20 bytes**, que es exactamente lo que tiene que reensamblar `LineFramer`. |

Los nombres se cambian en caliente con el comando `name`. El del SPP matchea a propósito el
`deviceMatch.namePattern` del driver RS420 (`/RS\s?420|allflex/i`) para que la app lo reconozca como
bastón; los de BLE **no** matchean a propósito, porque hoy no hay driver BLE-HID ni BLE-GATT en el
registro y lo honesto es que aparezcan como "no reconocido" (RMV3.8). Con `name` se puede forzar
cualquiera de los dos estados.

## La trama que emite

Capturada en campo con un lector real (`specs/active/04-bluetooth-baston/field-findings.md`) y
documentada en `app/src/services/ble/parser-rs420.ts`:

```
[0x02 STX] + "1000000" + <EID: 15 dígitos> + <YYMMDDHHMMSS: 12 dígitos> + \n   (a veces \r\n)

\x021000000982000364696050260530101701\r\n
     ^^^^^^^                            header fijo del lector (el parser lo descarta)
            ^^^^^^^^^^^^^^^             EID = 982000364696050 (el dato útil)
                           ^^^^^^^^^^^^ reloj del lector (el parser lo descarta)
```

El EID y el reloj arrancan **en los valores de la captura de campo**, así que la primera trama después
del boot es byte-por-byte comparable contra `field-findings.md`. El campo de 12 dígitos avanza con el
tiempo real, igual que en la captura (los segundos incrementan lectura a lectura).

En `MODO_HID` la lectura sale distinta a propósito: un teclado **no puede tipear** el STX ni el header
binario, así que tipea **solo el EID + Enter** (que es lo que hace un lector BLE-HID real). Con
`hidraw on` tipea la trama completa, como caso de estrés del futuro parser del wedge.

## Compilar y flashear

`arduino-cli` viene con el Arduino IDE 2 de esta máquina (no hay que instalar nada):

```bash
CLI="$HOME/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
CFG="$HOME/.arduinoIDE/arduino-cli.yaml"
cd firmware/baston-emulator
```

**Compilar + flashear en un paso** (elegí UNO de los tres modos):

```bash
# MODO_SPP — el que replica al RS420 en Android
"$CLI" compile --config-file "$CFG" \
  --fqbn esp32:esp32:esp32:UploadSpeed=115200 \
  --build-property build.defines=-DEMU_MODE=MODO_SPP \
  --upload --port COM7 .

# MODO_HID — teclado BLE (camino iOS sin MFi)
"$CLI" compile --config-file "$CFG" \
  --fqbn esp32:esp32:esp32:UploadSpeed=115200 \
  --build-property build.defines=-DEMU_MODE=MODO_HID \
  --upload --port COM7 .

# MODO_GATT — BLE Nordic UART
"$CLI" compile --config-file "$CFG" \
  --fqbn esp32:esp32:esp32:UploadSpeed=115200 \
  --build-property build.defines=-DEMU_MODE=MODO_GATT \
  --upload --port COM7 .
```

⚠️ **`UploadSpeed=115200` no es opcional en esta máquina.** El cable USB de la sesión del volcado está
falseado: el `read-flash` **falló** a `921600` y a `460800` (`Packet content transfer stopped`) y
funcionó a 115200. El default del board es 921600 → si no se pisa, el flasheo puede cortarse a mitad.

**Desde el Arduino IDE** (si preferís la GUI): abrir `baston-emulator.ino`, editar el
`#define EMU_MODE` de la sección 0, placa *ESP32 Dev Module*, puerto COM7, **Upload Speed = 115200**.
El `#define` de la sección 0 y el `-DEMU_MODE=...` hacen lo mismo; el flag de la CLI gana.

**Fallback con esptool** (si `arduino-cli upload` falla). El build deja un `merged.bin` de 4 MB que se
escribe de una, igual que el backup:

```bash
# OJO: arduino-cli.exe es un binario Windows → el --build-path va en ruta de Windows, no /tmp
BUILD="$TEMP/emu-build"
"$CLI" compile --config-file "$CFG" --fqbn esp32:esp32:esp32 \
  --build-property build.defines=-DEMU_MODE=MODO_SPP \
  --build-path "$BUILD" .
python -m esptool --port COM7 --baud 115200 write-flash 0x0 "$BUILD/baston-emulator.ino.merged.bin"
```

El `merged.bin` son los 4 MB completos, así que a 115200 tarda ~6 min (igual que el volcado del backup).
El camino de `--upload` escribe solo las 4 particiones y es bastante más rápido.

O por partes (los offsets salen del `flash_args` que genera el propio build):

```
0x1000   baston-emulator.ino.bootloader.bin
0x8000   baston-emulator.ino.partitions.bin
0xe000   boot_app0.bin
0x10000  baston-emulator.ino.bin
```

**Puerto**: era `COM7` (`Silicon Labs CP210x`). Puede cambiar:
`Get-PnpDevice | Where-Object { $_.FriendlyName -match 'CP210' }`.

**Volver a la balanza**: `firmware/backup/README.md` tiene el volcado del bridge Vesta y el
procedimiento de restauración con su SHA-256.

### Tamaños medidos (arduino-esp32 3.3.8, partición default 4MB, 2026-07-29)

| build | flash | % de 1.310.720 | globals |
|---|---|---|---|
| `MODO_SPP` | 1.071.256 B | 81 % | 42.016 B |
| `MODO_HID` | 1.112.843 B | 84 % | 41.472 B |
| `MODO_GATT` | 1.110.547 B | 84 % | 41.536 B |
| sonda con los TRES stacks linkeados | 1.113.523 B | 84 % | 42.360 B |

**Los tres entran en un solo binario y en la partición por defecto — el supuesto de que no entraban es
falso.** Medido: la sonda que linkea Classic SPP + BLE HID + BLE GATT juntos pesa 1.113.523 B, apenas
**3 kB más** que el build de GATT solo. Razón: el core trae Bluedroid precompilado en modo dual
(`CONFIG_BTDM_CTRL_MODE_BTDM`, `CONFIG_BT_CLASSIC_ENABLED`, `CONFIG_BT_SPP_ENABLED` y
`CONFIG_BT_BLE_ENABLED` los tres en 1 en el `sdkconfig` de la plataforma), así que el blob del stack
se linkea entero de todos modos y sumar el otro perfil casi no cuesta flash.

**Aun así se entregan tres builds, por razones que NO son el tamaño:**

1. **Coexistencia en RAM sin verificar.** Bluedroid en dual mode reserva su heap en el `init`; hay
   ~285 kB libres, así que es plausible, pero **no se probó** (no se flasheó nada: eso lo corre Raf).
   Un binario único que no arranca es peor que tres que arrancan.
2. **Un binario único necesitaría cambio de modo en runtime**, que en Bluedroid es
   `deinit`/`init` con orden y bonding de por medio: complejidad y estado nuevo justamente en la capa
   que estamos tratando de testear.
3. **Contaminaría el test.** Un device que se anuncia a la vez como RS420 SPP, como teclado BLE y como
   periférico NUS es una quimera que ningún lector real presenta, y el matching device→driver de la
   app (`findDriverForDevice`, por nombre y por UUID anunciado) vería justamente eso.

Si en algún momento conviene un solo flasheo, el camino está medido y abierto: entra en la partición
default sin tocar el esquema de particiones.

## Protocolo de control

Comandos de **una línea terminada en Enter** por el **puerto serie USB a 115200**. `help` los lista en
el device. Todo lo que imprime el emulador va con prefijo `[emu]`.

| comando | qué hace |
|---|---|
| `help` · `?` | lista de comandos |
| `status` · `st` | modo, nombre, link, EID, formato, reloj, heap libre, y `lecturas=` — que cuenta lo que **salió de verdad**, no lo que se intentó, para poder compararlo directo contra lo que la app ingirió |
| `selftest` | imprime **todas** las variantes de trama con los no-imprimibles escapados, sin necesidad de teléfono ni conexión. Es la verificación de mesa del generador contra la captura de campo |
| `read [n] [ms]` | `n` lecturas (default 1) separadas `ms` (default `gap`) |
| `same [n] [ms]` | `n` lecturas del **MISMO** EID (default 3, separadas `gap`) → ejercita el dedup por ventana |
| `burst [n]` | `n` lecturas sin pausa (varias en <1 s) → ráfaga |
| `eid [15díg\|ar\|def]` | fija o muestra el EID. `ar` = `032010006382438` (caravana oficial argentina), `def` = `982000364696050` (el de fabricante de la captura). Rechaza cualquier cosa que no sean 15 dígitos |
| `seq on\|off` | EIDs incrementales → bastonear muchos animales distintos |
| `gap <ms>` | separación por defecto de una serie |
| `auto <ms>` | emisión automática cada `ms` (`0` = apagar) |
| `mute <s>` | **conectado pero MUDO** `s` segundos (`0` cancela) → "el bastón está prendido pero no lee". Suprime **todo** lo que salga (lecturas, malformadas, `split`, `double`): el chequeo está en el único punto por el que sale un byte, así que un escenario nuevo nace respetándolo |
| `drop` | **corta el link desde el emulador**, sigue visible y emparejado → "salió de rango" |
| `off <ms>` | radio abajo `ms`: **desaparece del aire** → "se apagó el bastón" |
| `flap <n> <ms>` | `n` ciclos de `off`/`on` con `ms` abajo y 4 s arriba entre corte y corte → martilla el backoff (el bug 3) |
| `bad <caso>` | trama malformada: `header` `short` `long` `alpha` `tsjunk` `nots` `noterm` `binary` `empty` `garbage` |
| `split [ms]` | trama válida **partida en dos escrituras** con `ms` de pausa → reensamblado |
| `double` | **dos** tramas válidas en **una** escritura → separación de lecturas pegadas |
| `stx on\|off` | byte de control `0x02` al inicio |
| `term crlf\|lf\|cr\|none` | terminador de línea |
| `clock [YYMMDDHHMMSS]` | reloj del lector |
| `name [nombre\|reset]` | nombre Bluetooth: **persiste en NVS y reinicia** (el emparejamiento viejo del teléfono puede quedar obsoleto) |
| `reboot` | reinicia |
| `chunk <n>` | *(solo `MODO_GATT`)* bytes por notificación; `0` = una sola |
| `hidterm enter\|tab\|none` · `hiddelay <ms>` · `hidraw on\|off` | *(solo `MODO_HID`)* terminador tecleado, demora entre teclas (default 12 ms, como un wedge real), y tipear la trama completa en vez de solo el EID |

Un comando de otro modo contesta `ERR: ese comando no aplica al modo compilado` — no se ignora en
silencio.

**Botón BOOT** (sin consola, útil con el teléfono en la mano): pulsación **corta** = una lectura;
**larga** (≥800 ms) = `off 5000`. El LED onboard (GPIO2) parpadea en cada emisión. *(Es el mismo BOOT
que fuerza el modo bootloader si está apretado **durante el reset** — apretarlo con el firmware ya
corriendo es inofensivo.)*

El nombre Bluetooth no puede pasar de **18 caracteres**: en BLE viaja en los 31 bytes del paquete de
advertising junto con los flags, el appearance y el UUID de servicio, y si no entra la lib lo **trunca
en silencio**. El comando `name` lo rechaza con el motivo en vez de dejarte buscando por qué el
teléfono muestra otro nombre.

**Por aire**: en `MODO_GATT` se puede escribir el mismo comando en la característica RX del Nordic
UART (`6E400002-…`) desde nRF Connect o desde la app — el emulador lo **encola** y lo ejecuta en el
`loop()`, nunca dentro del callback del stack. En `MODO_HID` no hay canal de entrada (un teclado no
recibe) y en `MODO_SPP` lo que llegue se descarta, porque ese canal es el protocolo del lector.

### Correrlos todos de una: `bench/run-bench.py`

Los escenarios de abajo están automatizados. El runner maneja el puerto serie, la UI del teléfono por
`adb`+`uiautomator` y los oráculos, y sale con código ≠ 0 si alguno no da lo esperado:

```bash
cd firmware/baston-emulator/bench
python run-bench.py                    # todo
python run-bench.py --only E1,E4,BENCH1
python run-bench.py --list
```

Verifica las precondiciones antes de arrancar (app instalada, `RS420-EMU` emparejado, ESP32 en
`MODO_SPP`) y falla con el motivo en vez de dar un verde vacío. **Un solo proceso puede tener el puerto**:
cerrá el Monitor Serie del Arduino IDE antes.

Suma tres escenarios que no están en la tabla porque no son del emulador sino del teléfono: **BENCH1**
(corte con la app minimizada → ¿queda un "conectado" mentiroso?), **LATCH** (Bluetooth prendido desde el
panel rápido sin contestarle al diálogo de la app) y la verificación de que después de cada corte
**vuelve a leer**, que es lo único que prueba que la reconexión sirvió para algo.

### Los casos, y qué tiene que hacer nuestro lado

La ventana de dedup es **3000 ms por-TAG** y se mide **desde la última emisión CONFIRMADA, no desde el
último intento** (`app/src/services/ble/dedup.ts`). Los números de abajo salen de esa regla — si te da
otra cosa, es un hallazgo:

| escenario | comando | resultado esperado |
|---|---|---|
| repetidas del mismo EID, dentro de la ventana | `same 5 300` | **1 sola** ingesta (5 en el log del emulador, t = 0…1200 ms) |
| repetidas del mismo EID, cruzando la ventana | `gap 2000` + `same 3` | **2** ingestas: la de t=0 y la de t=4000; la de t=2000 cae adentro. Prueba que la ventana se mide desde la última emisión confirmada (si diera 1, el bastón que repite la línea 9 veces la estaría extendiendo para siempre). **Este caso decía `same 5` con gap 800 y era un oráculo tramposo**: ponía la 5ª emisión a 3200 ms de una ventana de 3000, o sea 200 ms de margen — menos que el jitter de RFCOMM + JS. Medido: 1, 2, 2 en tres corridas seguidas (2026-07-30). Con 2000/3 hay 1000 ms de margen y da 2 siempre (3/3) |
| ráfaga del mismo animal | `seq off` + `burst 8` | **1** ingesta; ninguna lectura perdida, la UI no se traba |
| ráfaga de animales distintos | `seq on` + `burst 8` | **8** ingestas (un EID distinto nunca espera por otro) |
| lecturas espaciadas | `same 5 3500` | **5** ingestas del mismo EID (cada una fuera de la ventana) |
| muchos animales | `seq on` + `read 20 500` | 20 EIDs distintos, todos válidos |
| corte del link | `drop` | estado `disconnected` + reintento con backoff; la carga manual sigue viva |
| bastón apagado y prendido | `off 8000` | la cadena de reintentos **sobrevive** al primer fallo y reconecta sola |
| corte repetido | `flap 4 3000` | reconecta en los 4 ciclos, sin quedarse trabado ni duplicar suscripciones. **OJO: el as-built da `attempt:0` en cada ciclo — el backoff NO crece** (medido 2026-07-30, `progress/bench_baston-spp-emulador.md` §4.3). Esta fila decía "backoff creciente" y era falso: el contador se resetea con cualquier connect exitoso sin exigir que el link dure |
| conectado pero mudo | `mute 30` | sigue `connected`, cero ingestas, sin falsos "leí algo" |
| tramas malformadas | `bad header` … `bad garbage` | **descartadas en silencio**, nada de crash ni de tag inválido en la UI |
| trama sin terminador | `bad noterm` | la línea **no se entrega**; y si después llega otra, se come esa también (verificalo: es el defecto real) |
| trama partida | `split 300` | **una** lectura reensamblada |
| dos tramas pegadas | `double` | **dos** lecturas (esto es lo que cubre `splitSppPayload`) |
| terminador `\n` solo | `term lf` + `read` | idéntico resultado que con `\r\n` |
| sin STX | `stx off` + `read` | idéntico resultado (el parser tolera su ausencia) |

Ojo con dos: `bad noterm` **no** es un caso de parser — su contenido es una trama válida, el defecto
es de transporte. Y `bad binary` en `MODO_HID` es **N/A**: un teclado no puede tipear bytes no
imprimibles; el emulador lo dice (`N byte(s) no tipeables descartados`) en vez de fingir que los mandó.

## Qué NO valida

El emulador valida **nuestro lado**. No es un RS420 y no lo suplanta:

- **El emparejamiento del RS420 real.** El emulador hace legacy pairing con PIN `1234` (fiel al manual
  Rev. 2.5), pero el diálogo, los timeouts y las rarezas del bonding del lector real no se reproducen.
  Si algún Android se niega a emparejar, `-DEMU_SPP_LEGACY_PIN=0` pasa a SSP "just works" — **menos
  fiel, pero empareja siempre**.
- **La semántica de desconexión del lector.** Cuándo el RS420 corta solo, si se duerme, si mantiene el
  RFCOMM abierto sin datos, qué pasa al apagarlo a mitad de una lectura.
- **Sus tiempos.** Latencia real entre bastoneada y trama, jitter, throughput con el rodeo entrando.
- **Su buffer interno y sus "sessions".** El lector real guarda lecturas y las puede volcar después;
  acá si no hay nadie conectado la lectura se **descarta** (y el log lo dice).
- **El firmware del lector.** La captura es de una versión concreta; Allflex marcó el software del
  RS420 como desactualizado (pendiente de Raf). Si la trama cambia entre versiones, esto emula la vieja.
- **iAP/MFi.** El camino iOS del RS420 es MFi y no se emula de ninguna forma (por eso existe
  `MODO_HID`: es otro camino, no una emulación del RS420 en iOS).
- **El BLE-HID de un lector comercial.** `MODO_HID` prueba que **nuestro lado** captura un
  keyboard-wedge; qué tipea exactamente un AgriEID o un XRS2i (prefijos, terminador Tab vs Enter,
  supresión del teclado en pantalla) sigue sin verificarse contra el device real.
- **RAM/heap del ESP32 bajo estrés.** `flap` largo baja y sube el stack Bluetooth muchas veces; el log
  imprime el heap libre en cada vuelta para poder ver una fuga del **emulador** antes de atribuírsela
  a la app.

Traducido al gate de hardware de la spec: con esto **stream, dedup, ráfagas, reconexión, backoff,
malformadas y mudez pasan a ser verificables sin lector**. Lo que queda gated por un RS420 físico son
**las idiosincrasias del lector real** (la lista de arriba). Reconciliado en `tasks-multivendor.md`
T-MV.5.6 / T-MV.5.7 y en `context-multivendor.md`.

## Notas de mantenimiento

- **Los tipos van arriba de todo** (sección 1). El preprocesador de Arduino genera los prototipos de
  todas las funciones del `.ino` y los inserta **antes de la primera definición de función**: un tipo
  declarado más abajo pero usado en una firma rompe el build con *"has not been declared"*.
- **`BluetoothSerial` está deprecada** en el core: *"won't be supported in version 4.0.0 by default"*
  (único warning que deja el build). El día que se actualice el core a 4.x, `MODO_SPP` hay que
  revisarlo; `MODO_HID` y `MODO_GATT` no dependen de esa clase.
- **Si cambia la trama del lector**, se cambia en **un** lugar: la sección 3. Los tres modos la
  consumen. Y se re-verifica contra `app/src/services/ble/parser-rs420.test.ts`, que es el contrato.
