# `MODO_HID` del emulador: boot loop — causa raíz, fix y verificación en hardware

`baseline_commit: 432b4d199b7c9680bbbf8ebc190d19bc3f76872e`

**Estado**: arreglado y **medido en el ESP32**, no sólo compilado. El banco quedó **flasheado en
`MODO_HID`**, arrancando limpio y anunciándose como `EMU-HID-380`, listo para que Raf corra el gate
(`progress/gate_hid-runbook.md`). **No commiteé nada** (así lo pidió el encargo).

**Lo que este trabajo NO prueba**: que el iPhone empareje y que el wedge tipee los 15 dígitos. Eso **es**
el gate y necesita el iPhone. Ver §6.

---

## 1. La causa raíz, leída del código de la librería instalada

`g_hid->manufacturer("RAFAQ")` — línea 620 del `.ino` — **desreferenciaba un puntero sin inicializar**.

En `BLEHIDDevice` del core `esp32:esp32@3.3.8` (el instalado, leído en
`~/AppData/Local/Arduino15/packages/esp32/hardware/esp32/3.3.8/libraries/BLE/src/`) hay **dos**
`manufacturer` y sólo uno crea la característica:

```cpp
// BLEHIDDevice.cpp:128-131  ← el GETTER es el que la CREA
BLECharacteristic *BLEHIDDevice::manufacturer() {
  m_manufacturerCharacteristic = m_deviceInfoService->createCharacteristic((uint16_t)0x2a29, ...);
  return m_manufacturerCharacteristic;
}

// BLEHIDDevice.cpp:137-139  ← el SETTER escribe derecho, sin crear nada
void BLEHIDDevice::manufacturer(String name) {
  m_manufacturerCharacteristic->setValue(name);
}
```

Y el miembro **no tiene inicializador** (`BLEHIDDevice.h:92`, a diferencia de `m_batteryService = 0` de
la línea 90); el constructor tampoco lo toca — crea el pnp, el hidInfo, el reportMap, el hidControl, el
protocolMode y el batteryLevel, pero **no** el 0x2a29. O sea: hasta que se llama al getter, ese puntero
tiene basura del heap. Llamar primero al setter = `LoadProhibited`.

El propio ejemplo de la librería usa la forma correcta:
`examples/Server_Gamepad/Server_Gamepad.ino:155` → `hid->manufacturer()->setValue("Espressif");`

**No es un bug del core que obligue a cambiar de versión o de librería** (el criterio de "parar y
reportar" del encargo): es un footgun de API que el `.ino` usaba mal. La API expone la forma correcta y
la documenta con su propio ejemplo. Por eso lo arreglé en vez de parar.

### La evidencia, no la deducción: backtrace simbolizado

Recompilé el binario que estaba flasheado y simbolicé el crash que reportó Raf (mismo `ELF file SHA256:
43d80179d`, mismo `PC`, misma `EXCVADDR` → es **ese** binario):

```
$ xtensa-esp32-elf-addr2line -pfiaC -e baston-emulator.ino.elf 0x400db707 0x400d5c45 0x400d5cb5 0x400d8a5d 0x400d2cba

0x400db707: FreeRTOS::Semaphore::take(String)                              at BLE/src/FreeRTOS.cpp:200
0x400d5c45: BLECharacteristic::setValue(unsigned char const*, unsigned int) at BLE/src/BLECharacteristic.cpp:380
0x400d5cb5: BLECharacteristic::setValue(String const&)                     at BLE/src/BLECharacteristic.cpp:394
0x400d8a5d: BLEHIDDevice::manufacturer(String)                             at BLE/src/BLEHIDDevice.cpp:138   ← ACÁ
0x400d2cba: setup() at baston-emulator.ino:620 (inlined by) setup() at baston-emulator.ino:1451
```

El dump de registros cierra el círculo: `A2 : 0x000000b1` es el `this` basura (el puntero sin
inicializar) y `EXCVADDR: 0x000000dd` = `0xb1 + 0x2c`, el offset del semáforo dentro de
`BLECharacteristic`. No es "un puntero nulo en algún lado": es **ese** puntero.

### Por qué nadie lo vio

El modo **nunca se había ejecutado**. Se entregó verificando que los tres modos *compilaban* y que cada
`.bin` contenía su cadena de modo. Hasta hoy sólo se flasheó `MODO_SPP`. `MODO_GATT` estaba igual
(nunca ejecutado) — hoy también arrancó por primera vez (§4.4).

## 2. El fix

```diff
-  g_hid->manufacturer("RAFAQ");
+  g_hid->manufacturer()->setValue("RAFAQ");   // el getter CREA la 0x2a29; el setter sólo escribe
```

Va con el comentario que explica la trampa y cita las líneas exactas de la librería, para que el próximo
que agregue `outputReport`/`bootInput` sepa que media clase son getters que crean.

## 3. Segundo hallazgo (autorrevisión): tras cualquier desconexión, los modos BLE quedaban **mudos para siempre**

Revisando qué más había en el camino que nunca corrió, encontré esto — y lo verifiqué en hardware antes
de tocarlo, porque es un cambio de comportamiento y no quería "arreglar" algo que no estaba roto:

- En BLE el stack **deja de anunciarse** cuando entra un central, y `advertiseOnDisconnect(false)`
  (que usan `MODO_HID` y `MODO_GATT` a propósito, para que `off` mande) **no lo reanuda**.
- Nadie lo reanudaba. Resultado: después de la primera desconexión el emulador desaparecía del aire y no
  volvía nunca.
- Eso **contradice el contrato escrito** de `drop`: *"corta el link desde el emulador, sigue visible y
  emparejado → salió de rango"* (README §comandos, y el comentario del propio `txDropLink`). En
  `MODO_SPP` sí se cumple (`SerialBT.disconnect()` deja el stack arriba).

**Por qué lo arreglé en vez de mandarlo al backlog** (el `drop` no está en el runbook del gate): la
medición **(d)** del gate manda la app a background y vuelve. Si el iPhone corta el link ahí, el
emulador se quedaba invisible, el iPhone no podría reconectar nunca, y el desenlace 2 del runbook —
*"falla (d) por comportamiento de iOS → el camino HID **se cierra con evidencia**"* — **cerraría una
puerta arquitectónica por un defecto nuestro**. Un teclado BLE real vuelve al aire; si el emulador no lo
hace, no emula la cosa que se está midiendo.

Fix: la desconexión deja un pedido y **`txPoll()` re-anuncia desde el `loop()`** (nunca desde el callback
del stack, misma razón que el `queueAirCommand` del GATT), y **respeta la radio abajo** para que `off`
siga significando "se apagó el bastón". Aplicado a los dos modos BLE (mismo defecto, misma forma).

### Falsificado, no deducido

Para no cobrar como fix algo que ya andaba, flasheé el código **de HEAD (sin el fix)** en `MODO_GATT` y
corrí el mismo experimento:

| | conectar → desconectar → escanear |
|---|---|
| **sin el fix** (código de HEAD) | `GATT: central DESCONECTADO` … y después **dos escaneos de 10 s: NO ENCONTRADO / NO ENCONTRADO** |
| **con el fix** | `GATT: central DESCONECTADO` → `GATT: de vuelta en el aire` en el mismo instante, y el escaneo siguiente lo encuentra (~400 ms) |

Y la regresión que el fix podría haber introducido —romper `off`— también se midió: con `off 12000`
puesto, el escaneo **no** lo encuentra durante esos segundos, y vuelve a aparecer recién después de
`radio ARRIBA otra vez`.

**El mismo mecanismo quedó medido en el build de HID** (no sólo en el de GATT). Cerrando la sesión, un
`status` mostró `link=CONECTADO` — algo de la PC había abierto una conexión LE al verlo anunciarse. Sirvió
de test:

```
   4.00 | >>> drop
   4.09 | [emu] corto el link desde el emulador (sigue visible y emparejado)
   4.09 | [emu] HID: central DESCONECTADO
   4.09 | [emu] HID: de vuelta en el aire (un teclado real se re-anuncia al desconectarse)
   6.09 | [emu] link=libre radio=arriba lecturas=0
```

Con el código de HEAD, ahí mismo el banco se habría quedado invisible y el gate habría arrancado contra
un emulador mudo.

## 4. Verificación en hardware (COM7, `dtr=False; rts=False`, sin resetear)

### 4.1 Antes — el boot loop determinístico (para poder comparar)

```
   0.53 | [emu] emulador de bastones RFID (banco de regresión de spec 04)
   0.53 | [emu] MODO_HID (teclado BLE HID) · se anuncia como 'EMU-HID-380'
   1.27 | Guru Meditation Error: Core  1 panic'ed (LoadProhibited). Exception was unhandled.
   1.27 | PC : 0x400db707 ... EXCCAUSE: 0x0000001c  EXCVADDR: 0x000000dd
   1.37 | ELF file SHA256: 43d80179d
   1.48 | Rebooting...
   2.22 | [emu] emulador de bastones RFID (banco de regresión de spec 04)   ← y otra vez, cada ~1,7 s
```

### 4.2 Después — arranque sano del binario que quedó flasheado

10 s de escucha **sin una sola línea** (el loop imprimía el banner cada ~1,7 s), y después un `reboot`
pedido por consola para ver el arranque entero:

```
  10.93 | [emu] emulador de bastones RFID (banco de regresión de spec 04)
  10.93 | [emu] MODO_HID (teclado BLE HID) · se anuncia como 'EMU-HID-380'
  11.71 | [emu] modo=MODO_HID (teclado BLE HID) nombre=EMU-HID-380
  11.71 | [emu] link=libre radio=arriba lecturas=0
  11.71 | [emu] eid=982000364696050 seq=off stx=on term=crlf reloj=260530101701
  11.71 | [emu] gap=800ms auto=0ms pendientes=0 hidterm=enter hiddelay=12ms hidraw=off heap=120068
  11.71 | [emu] 'help' para la lista de comandos
  12.01 | >>> status
  12.04 | [emu] modo=MODO_HID (teclado BLE HID) nombre=EMU-HID-380
```

`txBegin()` corre hasta el final: el `status` sale **después** de inicializar el HID, que es donde moría.

### 4.3 Lo que pidió el encargo, comando por comando

| qué | resultado medido |
|---|---|
| no entra en boot loop | ✅ 10 s de silencio + arranque limpio a pedido |
| `status` dice `MODO_HID` + `EMU-HID-380` | ✅ `modo=MODO_HID (teclado BLE HID) nombre=EMU-HID-380` |
| `selftest` imprime las variantes | ✅ las 12 líneas (captura de campo, trama actual y las 10 malformadas) |
| `hidterm enter\|tab\|none` | ✅ `hidterm=tab` → `none` → `enter` |
| `hiddelay <ms>` | ✅ `5` → `40` → `12` (los tres valores que usa el gate) |
| `hidraw on\|off` | ✅ `hidraw=on` → `off` |

Y además, del camino que nunca había corrido:

| qué | resultado medido |
|---|---|
| `read 2 300` sin central | ✅ `lectura (DESCARTADA, nadie conectado) → 982000364696050\n` ×2 — el EID + Enter, sin STX, que es lo que tipea un wedge |
| `drop` · `off 3000` · vuelta | ✅ `radio ABAJO 3000 ms` → `radio ARRIBA otra vez (heap 120332)`, sin crash |
| **está en el aire** | ✅ escaneo BLE desde la PC: `B0:CB:D8:03:50:CA name=EMU-HID-380 rssi=-44 uuids=['00001812-…']` — el UUID `0x1812` es el servicio HID: el iPhone lo va a ver como teclado |

### 4.4 De yapa: `MODO_GATT` arrancó por primera vez

Al usarlo para falsificar el §3 (es el único modo BLE que se puede conectar **sin bonding**), quedó
medido: arranca, anuncia `EMU-GATT-STICK`, acepta la conexión, y con `read` **notificó la trama partida
en 20 + 17 bytes** — el chunking que `LineFramer` tiene que reensamblar:

```
   3.49 [notif] b'\x021000000982000364696'      ← 20 bytes
   3.49 [notif] b'050260530101737\r\n'          ← 17 bytes
   3.55 [serie] [emu] lectura → \x021000000982000364696050260530101737\r\n
```

## 5. Autorrevisión adversarial: qué más busqué

Todo el `txBegin()` posterior a la línea 620 **nunca se había ejecutado**, así que lo revisé entero
contra el `.cpp` instalado antes de flashear (no contra el README de la librería — es la lección del
adapter SPP):

| qué busqué | veredicto |
|---|---|
| otros punteros de `BLEHIDDevice` sin crear (`pnp`, `hidInfo`, `reportMap`, `hidControl`, `protocolMode`, `batteryLevel`) | ✅ todos los crea el constructor; el **único** que no es el `manufacturer` |
| `setBatteryLevel(95)` **después** de `startServices()` (el ejemplo lo hace antes) | ✅ sano: `notify()` corta con `getConnectedCount() == 0` (`BLECharacteristic.cpp:852`) |
| `g_input->notify()` sin central / sin CCCD suscripto | ✅ sale por el mismo guard y por el chequeo del `BLE2902`; no crashea |
| el nombre BLE truncado en silencio (31 bytes de advertising) | ✅ `flags 3 + appearance 4 + UUID16 4 + nombre 13 = 24 ≤ 31`; con `setScanResponse(false)` la lib mete el nombre en el paquete de adv (`BLEAdvertising.cpp:953`), no en el scan response. Confirmado en el escaneo real |
| que el `onConnect`/`onDisconnect` de una sola firma **se llame** (C++ name hiding) | ✅ `BLEServer.cpp:513-514` y `:551-552` invocan **las dos** sobrecargas |
| `BLESecurity::setAuthenticationMode(uint8_t)`: ¿no hace nada porque no prende `m_securityEnabled`? | ✅ empuja el `ESP_BLE_SM_AUTHEN_REQ_MODE` al GAP igual (`BLESecurity.cpp:105-115`); `m_securityEnabled` sólo gatea la seguridad **iniciada por nosotros**, que además exige `m_forceSecurity` (`BLEDevice.cpp:1221`). El emparejamiento lo inicia iOS. **No lo toqué**: pasar a la sobrecarga de 3 bool metería `ESP_BLE_SEC_ENCRYPT_MITM` con `IO_CAP_NONE`, que es pedir MITM sin poder darlo |
| `txDropLink`/`txRadioOff`/`txRadioOn` (nunca ejecutados) | ⚠️ el hallazgo del §3. Arreglado y medido |
| carrera entre mi flag de re-anuncio y `off` | ✅ `txRadioOff()` baja `g_bleAdvertising` en el **mismo** task que lo lee `txPoll()`; el callback sólo levanta el flag. Medido en §3 y §4.3 |
| el `.ino` compilado ≠ el `.bin` flasheado | ✅ después del último retoque (un comentario) **re-flasheé**, para que lo que está en la placa sea exactamente el fuente del worktree |

## 6. Lo que queda gated (y por qué no se puede desde acá)

1. **El emparejamiento y el tecleo en iOS.** Es el gate. **Adrede no emparejé desde la PC**: un bond de
   Windows deja al emulador reconectándose con la PC y le puede robar la conexión al iPhone en plena
   medición. Lo que sí verifiqué es que **está en el aire como teclado** (`0x1812`), que era la
   precondición que hasta hoy no se cumplía.

   > **Para el gate**: verificado que `EMU-HID-380` **no** quedó emparejado en Windows (`Get-PnpDevice
   > -Class Bluetooth` no lo lista; el `RS420` que sí aparece es el bonding viejo del `MODO_SPP`). Aun
   > así, algo de la PC le abrió una conexión LE suelta al verlo anunciarse y no la soltó sola. Si antes
   > de emparejar el iPhone el `status` dice `link=CONECTADO`, mandar **`drop`**: corta y vuelve al aire
   > en el mismo instante (medido arriba). En 45 s de observación después del `drop` no se reconectó.
2. **`MODO_GATT` consumido por la app**: `adapter-ble-gatt` no existe (T-MV.6.3). Verifiqué el lado del
   emulador, no el nuestro.

## 7. Reconciliación de documentación

| archivo | qué cambió |
|---|---|
| `firmware/baston-emulator/baston-emulator.ino` | los dos fixes, con el porqué citando líneas de la librería |
| `firmware/baston-emulator/README.md` | sección nueva **"Qué está verificado EN HARDWARE, y qué sólo compilaba"** con la tabla por modo (antes los tres se presentaban como equivalentes y no se decía que dos nunca se habían ejecutado) · la fila de `drop` ahora explica el re-anuncio de BLE y su historia medida · tabla de tamaños re-medida (SPP 1.071.288 B · HID 1.113.211 B · GATT 1.110.683 B; la sonda de los 3 stacks sigue siendo la del 2026-07-29, no se re-midió) · 3 notas de mantenimiento nuevas (la trampa de `BLEHIDDevice`, "desconectarse ≠ seguir visible", "antes de decir que un modo anda, flashealo") |
| `progress/gate_hid-runbook.md` | decía *"hoy está en `MODO_SPP`; decime y lo flasheo"* → **ya está flasheado en `MODO_HID`**, más el contexto de que el modo nunca había corrido y qué se midió (para que un fallo se atribuya bien) |

**Lo que NO toqué y le corresponde al dueño del delta** (`specs/active/04-bluetooth-baston/` estaba
recibiendo commits 45 min antes de esta sesión — no piso trabajo en vuelo):

- `tasks-ios-ble-mfi.md` **T7.0.1** ("flashear el ESP32 con `-DEMU_MODE=MODO_HID`, verificar con
  `selftest` + `status`, y emparejarlo con el iPhone"): la **primera mitad está hecha y medida**; queda
  el emparejamiento, que es de Raf. La tarea daba por sentado que flashear era un trámite de 30 s —
  convendría anotar que el modo estaba roto y que ahora el gate arranca desde un banco verificado.
- `progress/impl_baston-emulator-esp32.md` es el informe **histórico** de la sesión que escribió el
  emulador; su tabla de tamaños y su lista de pendientes quedaron viejas por definición. No lo reescribí:
  la foto de hoy es este archivo.

## 8. Estado del banco al cerrar

- ESP32 (COM7, `Silicon Labs CP210x`) **flasheado en `MODO_HID`**, arrancado y verificado después del
  flasheo final. Anunciándose como `EMU-HID-380`.
- Volver al banco de SPP: el mismo comando con `-DEMU_MODE=MODO_SPP`.
- **Sin commitear**, como se pidió. Cambios en el worktree: `baston-emulator.ino`, `README.md`,
  `progress/gate_hid-runbook.md` y este informe.
