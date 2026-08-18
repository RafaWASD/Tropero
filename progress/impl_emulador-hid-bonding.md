# `MODO_HID` del emulador: emparejaba sin bondear (y no entregaba una tecla) — causa raíz, fix y medición

`baseline_commit: 0b8cf09` (el fix del boot loop, `progress/impl_emulador-hid-crash.md`)

**Estado**: arreglado y **medido de punta a punta contra Windows**, no sólo compilado. El emulador
**empareja, bondea, el bond persiste, y tipea los 15 dígitos en una ventana de texto real**. El banco
quedó flasheado en `MODO_HID`, **sin bonds y libre** (`bonds=0`, Windows `paired=False`,
anunciándose), listo para el gate del iPhone. **No commiteé nada** (así lo pidió el encargo).

**Lo que este trabajo NO prueba**: que **iOS** acepte el mismo emparejamiento y entregue las teclas a
nuestro `TextInput`. Eso es el gate y necesita el iPhone. Lo que sí queda cerrado es que el emulador
**es** un teclado BLE que empareja y tipea: si el iPhone falla, el fallo ya no puede ser del banco.

---

## 1. La causa raíz, leída del código de la librería instalada

**El emulador nunca arrancaba la seguridad. No es que el pairing fallara: nunca empezaba.**

`txBegin()` usaba la sobrecarga de `uint8_t` de `setAuthenticationMode`. En `BLESecurity` del core
`esp32:esp32@3.3.8` (el instalado, leído en
`~/AppData/Local/Arduino15/packages/esp32/hardware/esp32/3.3.8/libraries/BLE/src/`) hay **dos**
`setAuthenticationMode` y **no son equivalentes**:

```cpp
// BLESecurity.cpp:105-115  ← la que usábamos: SOLO empuja el authReq al GAP
void BLESecurity::setAuthenticationMode(uint8_t auth_req) {
  m_authReq = auth_req;
  esp_ble_gap_set_security_param(ESP_BLE_SM_AUTHEN_REQ_MODE, &m_authReq, sizeof(uint8_t));
}

// BLESecurity.cpp:239-258  ← la de 3 bool: la ÚNICA que prende la seguridad
void BLESecurity::setAuthenticationMode(bool bonding, bool mitm, bool sc) {
  m_authReq = ...;
  m_securityEnabled = (m_authReq != 0);          // ← ESTO
  esp_ble_gap_set_security_param(ESP_BLE_SM_AUTHEN_REQ_MODE, &m_authReq, sizeof(uint8_t));
  if (sc) { if (mitm) setEncryptionLevel(ESP_BLE_SEC_ENCRYPT_MITM);
            else      setEncryptionLevel(ESP_BLE_SEC_ENCRYPT_NO_MITM); }   // ← Y ESTO
}
```

Y `m_securityEnabled` es lo que gatea que el periférico **arranque** la seguridad al conectarse:

```cpp
// BLEDevice.cpp:1219-1225 — handler del GATT server, ESP_GATTS_CONNECT_EVT
case ESP_GATTS_CONNECT_EVT: {
  if (BLESecurity::m_securityEnabled && BLESecurity::m_forceSecurity) {
    BLESecurity::startSecurity(param->connect.remote_bda);   // → esp_ble_set_encryption()
  }
  break;
}
```

Con `m_securityEnabled == false` (`BLESecurity.cpp:69`, y **nadie más lo pone en true**), el emulador
**nunca mandaba el Security Request**. Encima `m_securityLevel` es un `static esp_ble_sec_act_t` **sin
inicializador** (`BLESecurity.cpp:87`) → 0, que ni siquiera es un valor válido del enum
(`ESP_BLE_SEC_ENCRYPT == 1`, `esp_gap_ble_api.h:380`): aunque `m_securityEnabled` hubiera sido true,
`esp_ble_set_encryption(bda, 0)` no pedía nada coherente. La sobrecarga de 3 bool arregla las dos.

### Por qué del otro lado tampoco pasaba nada — y por eso el síntoma era mudo

Un host HID normalmente arranca el pairing solo, cuando le rebota un *insufficient authentication* al
leer algo del servicio HID. Este `BLEHIDDevice` **le sacó el cifrado a todo lo que el host lee para
enumerar**, a propósito:

```cpp
// BLEHIDDevice.cpp:162-193, inputReport()
// "Note: READ_ENC removed per HOGP specification - characteristics must be readable without
//  encryption for enumeration"
inputReportDescriptor->setAccessPermissions(ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE);
p2902->setAccessPermissions(ESP_GATT_PERM_READ | ESP_GATT_PERM_WRITE);   // ← el CCCD, ABIERTO
```

Report Map, HID Info, PnP, el Report Reference y **el CCCD** son todos de permiso abierto. El host
enumera entero y **suscribe las notificaciones sin cifrar nada**: no hay error, no hay prompt, no hay
pairing. Por eso el iPhone se conectaba, subía a *"Mis dispositivos"* mientras duraba el link, no
ofrecía *"Olvidar este dispositivo"*, volvía a *"Otros dispositivos"* al ciclar el Bluetooth, y no
tipeaba nada: **nunca hubo bond porque nunca hubo SMP.**

### La segunda mitad: las claves las declara un constructor que nunca corre

La hipótesis del encargo (faltan las máscaras de distribución de claves) **es correcta pero incompleta,
y por sí sola no era la causa**. El detalle que importa es *por qué* faltaban:

```cpp
// BLESecurity.cpp:96-101 — el CONSTRUCTOR es quien empuja estos tres parámetros al GAP
BLESecurity::BLESecurity() {
  setKeySize();  setInitEncryptionKey();  setRespEncryptionKey();  setCapability(ESP_IO_CAP_NONE);
}
// y los estáticos arrancan en cero:
uint8_t BLESecurity::m_initKey = 0;   // :77
uint8_t BLESecurity::m_respKey = 0;   // :78
```

El `.ino` usa la API **estática** y nunca construye un `BLESecurity`, así que `ESP_BLE_SM_SET_INIT_KEY`
/ `SET_RSP_KEY` / `MAX_KEY_SIZE` **nunca se declaraban**: quedaban en lo que trajera Bluedroid de
fábrica, sin que el sketch lo dijera. No pude verificar ese default en el core instalado (vive en un
`.c` precompiled, no en los headers) — así que los declaro explícitamente en vez de depender de él.
Que las claves ahora se intercambian **está medido**, no deducido (§4.2: `ESP_GAP_BLE_KEY_EVT` con
LENC/PENC/LID/PID, y `bonds` mostrando `LTK=si IRK=si`).

### Sobre `EMU_HID_AUTH`: se queda en `SC_BOND` (sin MITM), y ahora por un motivo, no por probar

El cambio sin commitear que había en el árbol **se conserva**, y la razón es del código instalado, no
estética: con `IO_CAP_NONE` la única asociación posible es *just works*, que por definición no puede
satisfacer MITM; y `setAuthenticationMode(bonding, mitm, sc)` traduce `mitm=true` a
`ESP_BLE_SEC_ENCRYPT_MITM` (`BLESecurity.cpp:247-253`), que exige una LTK **autenticada** que no
podemos producir. Con MITM habríamos pedido algo imposible sobre el mismo camino que recién ahora
existe. `SC_BOND` → `ESP_BLE_SEC_ENCRYPT_NO_MITM` → medido: `auth_mode=0x09`, `bond=SI sc=si mitm=no`.

Nota de atribución honesta: **cambiar ese `#define` no había arreglado nada, y no podía**. Sin
`m_securityEnabled` el `authReq` no se usaba nunca. Que el síntoma no cambiara fue, en retrospectiva,
la pista de que el pairing no estaba fallando sino que no estaba ocurriendo.

## 2. El fix

```diff
-  BLESecurity::setAuthenticationMode((uint8_t)EMU_HID_AUTH);
-  BLESecurity::setCapability(ESP_IO_CAP_NONE);
+  BLESecurity::setCapability(ESP_IO_CAP_NONE);
+  BLESecurity::setAuthenticationMode(          // la de 3 bool: la única que prende la seguridad
+      (((uint8_t)EMU_HID_AUTH) & ESP_LE_AUTH_BOND) != 0,
+      (((uint8_t)EMU_HID_AUTH) & ESP_LE_AUTH_REQ_MITM) != 0,
+      (((uint8_t)EMU_HID_AUTH) & ESP_LE_AUTH_REQ_SC_ONLY) != 0);
+  BLESecurity::setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
+  BLESecurity::setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
+  BLESecurity::setKeySize(16);
```

Los bits se descomponen del `#define` para que el knob `-DEMU_HID_AUTH=…` siga sirviendo — si iOS
rechaza nuestros requisitos, se cambia en un lugar y el diagnóstico lo dice con nombre (§3).

Va con el comentario que cita las líneas exactas de la librería, igual que el fix del
`manufacturer()`: media clase `BLESecurity` es estática pero **depende de un constructor** para tener
estado válido, y eso no se ve leyendo el `.h`.

## 3. Lo que el emulador no sabía decir (y por eso el gate anterior era inleíble)

Tres agujeros de observabilidad que hacían que **"no emparejó", "emparejó y falló" y "emparejó bien"
se vieran exactamente iguales** desde la consola:

1. **`status` no decía nada de seguridad.** Ahora hay una segunda línea en `MODO_HID`:
   `cifrado=SI cccd=suscripto auth_mode=0x9 bonds=1`.
2. **El resultado del pairing no se logueaba.** Ahora un hook de GAP (lambda sin captura pasada a
   `setCustomGapHandler`; función suelta no, porque `esp_gap_ble_cb_event_t` en la firma rompe el
   generador de prototipos de Arduino — la trampa que documenta la §1 del `.ino`) imprime el
   intercambio de claves y el `AUTH_CMPL` con el motivo **traducido**: `SMP_PAIR_AUTH_FAIL (el host
   rechazó nuestros requisitos)`, `SMP_CONN_TOUT`, etc. Un `0x66` no sirve para atribuir un fallo.
3. **🔴 El contador de lecturas MENTÍA.** `notify()` descarta en silencio si el CCCD está apagado
   (`BLECharacteristic.cpp:861-867`) y no devuelve nada, así que `txSendRaw` contaba como tipeadas
   teclas que **nunca salieron del ESP32**. Eso es literalmente lo que pasó en la sesión con el
   iPhone: *"el emulador contó `lecturas=1`. En el iPhone NO apareció NADA."* — el emulador no había
   mandado nada. Hoy chequea la suscripción antes de contar, y lo dice.

Además: `bonds` (lista los bonds guardados en NVS, con `LTK`/`IRK`) y `unbond` (los borra). `bonds` es
**el oráculo local de persistencia**: es lo único que sobrevive a un reboot y no depende de la UI de
otro sistema operativo.

## 4. Verificación en hardware (COM7, `dtr=False; rts=False`, sin resetear)

Todo lo de abajo se midió sobre el binario compilado del fuente actual. Después de medir sólo se
tocaron **comentarios** (los números de línea de las citas a la librería) y se **re-flasheó igual**,
para que lo que está en la placa sea exactamente el fuente del worktree: mismo tamaño exacto
(1.117.663 B) antes y después, y el flasheo final cerró con `Hash of data verified` en las cuatro
particiones. Sobre ese binario re-flasheado se re-corrió el chequeo de estado limpio del §4.5.

⚠️ El primer intento de ese re-flasheo murió con `A fatal error occurred: Packet content transfer
stopped` — el cable USB falseado que ya documenta el README (es el motivo de `UploadSpeed=115200`).
Reintentar alcanzó. Si vuelve a pasar, **no dar por bueno el flasheo hasta ver los cuatro
`Hash of data verified`**.

### 4.1 Falsificación del "antes" — con el fix puesto, el bug se ve

Antes de cobrar el fix, medí que el diagnóstico nuevo **distingue** los estados. Un central conectado
por bleak (que no empareja ni suscribe el input report) + `read 1`:

```
[emu] HID: central CONECTADO
>>> read 1
[emu] HID: el host NO suscribió el input report — conectado pero sin teclado del otro lado
[emu] lectura (conectado pero NADA mandable) → 982000364696050\n
[emu] link=CONECTADO radio=arriba lecturas=0          ← ANTES decía lecturas=1
[emu] cifrado=no cccd=apagado auth_mode=0x0 bonds=0
```

Ese `lecturas=0` es el bug del §3.3 falsificado: mismo escenario que el del iPhone, y ahora el banco
dice la verdad.

Y la primera conexión **con el fix de seguridad pero sin un host que empareje** produjo el evento que
antes no existía nunca — prueba de que ahora sí se arranca el SMP:

```
[emu] HID: el emparejamiento con 54:E4:ED:6B:72:4E FALLÓ: SMP_CONN_TOUT (se cortó el link a mitad
      del emparejamiento) (0x66) — sin bond y sin cifrado, no se tipea nada
```

### 4.2 Emparejamiento real desde Windows (el proxy más cercano al iPhone)

Emparejado con `DeviceInformationPairing.Custom` (`ConfirmOnly`, `ProtectionLevel.Encryption`) sobre
el *association endpoint* — o sea, el mismo camino que "Agregar dispositivo" de Ajustes:

```
EMU-HID-380: paired=False canPair=True
   [serie] [emu] HID: central CONECTADO
  pairing_requested: CONFIRM_ONLY
   [serie] [emu] HID: clave intercambiada (tipo 0x10)   ← LENC (nuestra LTK)
   [serie] [emu] HID: clave intercambiada (tipo 0x01)   ← PENC (LTK del peer)
   [serie] [emu] HID: clave intercambiada (tipo 0x20)   ← LID  (nuestra IRK)
   [serie] [emu] HID: clave intercambiada (tipo 0x02)   ← PID  (IRK del peer)
pair status: PAIRED
   [serie] [emu] HID: EMPAREJADO con 54:E4:ED:6B:72:4E — link CIFRADO (auth_mode=0x09 bond=SI sc=si mitm=no)
   [serie] [emu] cifrado=SI cccd=suscripto auth_mode=0x9 bonds=1
   [serie] [emu] bonds guardados en NVS: 1
   [serie] [emu]  54:E4:ED:6B:72:4E  claves=0x07 (LTK=si IRK=si)
```

Las cuatro claves son las máscaras del §1 haciendo efecto. `cccd=suscripto` es Windows habilitando las
notificaciones del input report: hay un **teclado** del otro lado, no un GATT cualquiera. Y Windows le
cargó el driver HOGP:

```
Status Class     FriendlyName
OK     Keyboard  Dispositivo de teclado HID     HID\{00001812-…}_DEV_VID&0202E5_PID&11A1_REV&1002_B0CBD80350CA\…
OK     HIDClass  Dispositivo Bluetooth de bajo consumo HID compatible con GATT
OK     Bluetooth EMU-HID-380                    BTHLE\DEV_B0CBD80350CA\…
```

(`VID 0xE502 / PID 0xA111` = el `g_hid->pnp(0x02, 0xE502, 0xA111, 0x0210)` del sketch.)

### 4.3 **Tipea de verdad** — el circuito completo, sin iPhone

Ventana de texto con el foco + `read` por serie. No mide BLE: mide **caracteres**.

| comandos | lo que quedó escrito en la ventana |
|---|---|
| `hiddelay 5` · `read 1` · `hiddelay 40` · `seq on` · `read 3 300` · `hidterm tab` · `read 1` · `hidterm enter` · `hidraw on` · `read 1` | `982000364696050␊982000364696050␊982000364696051␊982000364696052␊982000364696053␉1000000982000364696054260530102038␊` |

115 caracteres, 5 Enter y 1 Tab. Se ve todo lo que el gate va a mirar: los 15 dígitos completos, los
tres `hiddelay` (5/12/40 ms) sin perder un dígito, `hidterm enter` y `hidterm tab`, los EIDs
incrementales de `seq on`, y `hidraw on` tipeando la trama entera **menos el STX** (`HID: 1 byte(s) no
tipeables descartados`), que es la limitación real del transporte.

### 4.4 El bond PERSISTE — que es exactamente lo que fallaba

El síntoma que dio el diagnóstico fue *"apago y prendo el Bluetooth y vuelve a Otros dispositivos"*.
Se reprodujo el gesto de las tres formas posibles:

| prueba | resultado medido |
|---|---|
| **`reboot` del ESP32** | el banner de arranque, **antes de cualquier conexión**, ya dice `bonds=1`; a los 1,2 s Windows reconecta solo y sale `HID: EMPAREJADO … bond=SI` **sin ninguna línea de intercambio de claves** → se re-cifró con la LTK guardada, no re-emparejó. `bonds` sigue listando `LTK=si IRK=si`. Y **vuelve a tipear** (16 chars, 1 Enter) |
| **ciclo de la radio Bluetooth de Windows** (el gesto de Raf) | `HID: central DESCONECTADO` al apagar; al prender, reconecta a los ~4 s con `EMPAREJADO … bond=SI`, sin re-pairing. Windows lo sigue listando `paired=True`. **Vuelve a tipear** |
| **`off 8000`** (radio del emulador abajo) y **`drop`** (corte desde el emulador) | reconecta y se re-cifra en los dos casos (a los 8,9 s y a los 0,45 s respectivamente) |

Antes del fix, ninguna de estas tres pruebas era siquiera posible: no había bond que persistir.

### 4.5 Estado al cerrar: el banco queda LIBRE

Como pide el encargo (un bond de Windows le roba la conexión al iPhone en plena medición), se limpió
**de los dos lados** — y en ese orden, porque al revés Windows reconecta en loop intentando cifrar con
una clave que el ESP32 ya no tiene (lo medí sin querer, y quedó documentado en el README y en el
propio `unbond`):

```
unpair status: UNPAIRED                                     ← Windows
[emu] bonds borrados: 1 de 1 (quedan 0)                     ← ESP32
[emu] link=libre radio=arriba lecturas=1
[emu] cifrado=no cccd=apagado auth_mode=0x0 bonds=0
--- escaneo BLE ---
*** B0:CB:D8:03:50:CA  name=EMU-HID-380  rssi=-44  uuids=['00001812-0000-1000-8000-00805f9b34fb']
--- Windows ---
'EMU-HID-380'  paired=False canPair=True
Get-PnpDevice … B0CBD80350CA  → (vacío: no quedó ni el teclado ni el device)
```

Y con el banco limpio: `status` / `bonds=0` / `selftest` / `hidterm enter|tab` / `hiddelay 5|12` /
`hidraw on|off` / `read 1` sin central (`DESCARTADA, nadie conectado`) / `help` con las dos entradas
nuevas / `chunk` contestando `ese comando no aplica al modo compilado`.

## 5. Autorrevisión adversarial: qué más busqué

| qué busqué | veredicto |
|---|---|
| que el "before" no fuera una historia — ¿el bug se ve con el instrumento nuevo? | ✅ §4.1: `lecturas=0` + "el host NO suscribió", y el `AUTH_CMPL` que antes no existía nunca |
| que la causa raíz del encargo (máscaras de claves) fuera **la** causa | ⚠️ **no lo era sola**: sin `m_securityEnabled` no hay SMP y las máscaras dan igual. Se corrigen las dos, y se dice cuál explicaba el síntoma |
| ¿el default de Bluedroid para init/rsp key ya era ENC\|ID? | ❔ **no verificable** en el core instalado (vive en un `.c` precompilado, no en los headers). Por eso se declaran explícitamente en vez de confiar en él — y por eso el informe no afirma cuál era |
| `m_securityStarted` queda pegado en true tras el primer pairing → ¿reconexión sin cifrar? | ✅ la librería llama `resetSecurity()` en `ESP_GATTS_DISCONNECT_EVT` (`BLEServer.cpp:565`). Medido: 4 reconexiones seguidas, las 4 con `AUTH_CMPL` success |
| ¿alguien contesta el `ESP_GAP_BLE_SEC_REQ_EVT` si el host inicia? | ✅ `BLEDevice.cpp:1337-1349` responde `esp_ble_gap_security_rsp(true)` aun sin `BLESecurityCallbacks` |
| ¿está compilado el SMP en este core? | ✅ `CONFIG_BLE_SMP_ENABLE=y` y **`CONFIG_BT_BLE_SMP_BOND_NVS_FLASH=y`** en el `sdkconfig` de `esp32-libs/3.3.8` — el bond va a NVS. Confirmado empíricamente por el reboot |
| `g_bleEncrypted` heredado de la conexión anterior | ✅ se baja en `onConnect` **y** en `onDisconnect`: cada link se re-negocia y hasta el `AUTH_CMPL` no se da por cifrado |
| `cccd=suscripto` mentiroso con el link caído (la lib persiste el CCCD de los bonded) | ✅ `hidSubscribed()` devuelve false sin link. Encontrado midiendo (`cccd=suscripto` con `link=libre`), no leyendo |
| `unbond` decía "quedan 1" justo después de borrar | ✅ `esp_ble_remove_bond_device` es **asincrónico**; ahora espera a que baje (≤1 s) antes de informar. Encontrado midiendo |
| `auth_mode=0x9` sobreviviendo a un `unbond` (dice "autenticado" sin con qué) | ✅ se resetea en `hidClearBonds` |
| desborde en `esp_ble_get_bond_device_list` si aparece un bond entre las dos llamadas | ✅ `got` clampeado a `n` (el tamaño real del buffer) en las dos funciones |
| `malloc` sin `free` / sin chequeo | ✅ chequeado y liberado en los dos caminos |
| loguear desde el callback del stack BLE | ✅ el hook de GAP **sólo** imprime; no se reentra al stack (misma regla que el `queueAirCommand` del GATT y el re-anuncio del `txPoll`) |
| fuga de heap con muchos ciclos de conexión/pairing | ✅ ~120,4 kB libre en boot y ~114,1 kB conectado, estable a lo largo de ~15 ciclos (114112 / 114148 / 114132 / 114116) |
| romper `MODO_SPP` y `MODO_GATT` | ⚠️ ver §7: **compilan** (y el binario cambia +32/+44 B por una línea intencional), pero **no se flashearon**. Motivo explícito |
| el `.ino` compilado ≠ el `.bin` flasheado | ✅ el último flasheo es posterior al último retoque del fuente; toda la §4.2-4.5 se midió después |

## 6. Lo que queda gated (y por qué no se puede desde acá)

1. **iOS.** Todo lo medido es contra Windows. Es el host más cercano que hay en la mesa y ejerce el
   mismo perfil (HOGP sobre SMP con bonding y Secure Connections), pero **no es iOS**. Que iOS acepte
   `auth_mode=0x09` con `IO_CAP_NONE` y entregue las teclas a un `TextInput` es el gate
   (`progress/gate_hid-runbook.md`, actualizado con qué mirar y cómo atribuir un fallo).
2. **`MODO_GATT` consumido por la app**: `adapter-ble-gatt` no existe (T-MV.6.3). Sin relación con
   este fix.

## 7. Reconciliación de documentación

| archivo | qué cambió |
|---|---|
| `firmware/baston-emulator/baston-emulator.ino` | el fix de seguridad + las máscaras de clave, con el porqué citando líneas de la librería · hook de GAP que loguea el pairing y traduce el `fail_reason` · `g_bleEncrypted` / `g_bleAuthMode` y la línea de seguridad en `status` · guard de suscripción en `txSendRaw` (el contador que mentía) · comandos `bonds` y `unbond` · comentario de `EMU_HID_AUTH` reescrito (decía que SC_MITM_BOND + IO_CAP_NONE era "just works", que es falso) |
| `firmware/baston-emulator/README.md` | la fila de `MODO_HID` en *"Qué está verificado EN HARDWARE"* pasa a **empareja y tipea**, con qué se midió · *"lo que sigue sin verificarse"* ahora dice **iOS**, no "el emparejamiento" · `bonds` y `unbond` en la tabla de comandos y la línea nueva de `status` · **dos notas de mantenimiento nuevas** (la trampa de las dos sobrecargas de `BLESecurity`; "un central conectado no es un teclado del otro lado") · tabla de tamaños re-medida |
| `progress/gate_hid-runbook.md` | el contexto pasa de "un bug" a **los tres**, con el estado real del banco · **Paso 0 ampliado**: cómo se sabe que emparejó *de verdad* (incluido el chequeo de Raf de apagar y prender el Bluetooth, que es el que encontró el bug) y el `bonds`=0 previo · bloque nuevo **"lo primero que hay que mirar si el iPhone no tipea"**, que mapea cada estado del `status` a una causa distinta para no cerrar por error una puerta que está abierta · `bonds`/`unbond` en la lista de comandos |

**Sobre `MODO_SPP` / `MODO_GATT`**: compilan (1.071.320 B y 1.110.727 B). Cambian +32/+44 bytes por
una línea **intencional**: `bonds` y `unbond` se agregaron a la cadena de "comando de otro modo", así
que en esos builds contestan `ERR: ese comando no aplica al modo compilado` en vez de "comando
desconocido". **No los flasheé**: la placa es una sola y hacerlo habría destruido el banco de HID
recién verificado, para probar dos `strcmp` más en una cadena que ya existía. Lo que sí verifiqué en
la placa es esa misma cadena, desde el otro lado: `chunk` en `MODO_HID` contesta el mensaje correcto.
Dicho acá porque en este archivo "compila" nunca contó como "anda".

**No toqué** `app/`, `supabase/`, `sync-streams/`, `feature_list.json` ni `progress/current.md`, ni
`specs/active/04-bluetooth-baston/` (sigue habiendo trabajo en vuelo de otra terminal). La tarea
**T7.0.1** de `tasks-ios-ble-mfi.md` ("flashear en `MODO_HID`, verificar con `selftest` + `status`, y
emparejarlo con el iPhone") tiene la primera mitad hecha y medida desde la sesión anterior; ahora
además el **emparejamiento está probado contra un host real** y sólo queda el iPhone. Le corresponde
al dueño del delta anotarlo.

## 8. Estado del banco al cerrar

- ESP32 (COM7, `Silicon Labs CP210x`) **flasheado en `MODO_HID`** con el fuente actual del worktree,
  arrancado y verificado **después** del flasheo final. Anunciándose como `EMU-HID-380` con el
  servicio HID `0x1812`.
- **Sin bonds** (`bonds=0`) y **sin emparejamiento del lado de Windows** (`paired=False`, sin entradas
  en `Get-PnpDevice`): el iPhone no va a tener que pelear la conexión.
- Volver al banco de SPP: el mismo comando con `-DEMU_MODE=MODO_SPP`.
- **Sin commitear**, como se pidió. Cambios en el worktree: `baston-emulator.ino`, `README.md`,
  `gate_hid-runbook.md` y este informe.
