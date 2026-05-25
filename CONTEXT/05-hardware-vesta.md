# 05 — Hardware: Bridge BLE Vesta 3516

## Objetivo

Permitir que la balanza Vesta 3516 (data collector con salida RS-232) transmita el peso vía BLE a un smartphone (iOS + Android). El bastón Allflex RS420 ya transmite TAGs vía Bluetooth nativo, así que el puerto RS-232 del Vesta está libre para el bridge.

## Estado actual

**ESP32 funcionando con loopback test. Falta validación en campo con balanza real.**

## Hardware

- **ESP32 DevKit V1** (NodeMCU ESP-32S / DOIT DEVKIT V1) — COM7, funcionando
- **HX711** — comprado pero no se usa en este enfoque (se descartó la lectura directa de load cells)
- **Protoboard grande con adhesivo**
- **Dupont cables**: macho-macho, macho-hembra, hembra-hembra
- **Multímetro DT-830B** — defectuoso, hay que comprar otro antes del día de campo

## Vesta 3516 — pinout del conector circular

Vista inferior del Vesta (conector "Comunicación y Carga"):

| Pin | Función |
|-----|---------|
| 1 | GND (MASA) |
| 2 | RX (RS-232) — recibe TAG del bastón |
| 3 | **TX (RS-232) — esto es lo que interceptamos** |
| 4 | D+ (USB) |
| 5 | D- (USB) |
| 6 | +5V Power In |

**Importante**: como Pin 6 es +5V, el RS-232 es casi seguro TTL (no ±12V). No haría falta MAX3232 salvo que la medición real muestre >5V.

## Cable físico

El cable Vesta↔bastón RFID existe físicamente en el campo y ya está confirmado. Ese cable tiene el conector mating correcto para el Vesta — se usa para conexión limpia en lugar de pinchar los pines directamente.

## Arquitectura BLE — decisión crítica

**Se usa BLE Nordic UART Service, NO Bluetooth Classic SPP**.

Razón: Classic SPP solo funciona en Android. BLE funciona en iOS + Android. Ver `docs/adr/ADR-003-ble-nordic-uart.md`.

UUIDs estándar Nordic:
- Service: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- TX char (ESP32→teléfono): `6E400003-...` (NOTIFY)
- RX char (teléfono→ESP32): `6E400002-...` (WRITE)

## App de testing iOS

**nRF Connect for Mobile** (Nordic Semiconductor, gratis).

**NO emparejar desde Settings de iOS** — conectar solo desde nRF Connect.

## ESP32 — pines relevantes

NodeMCU ESP-32S, USB hacia abajo, mirando de frente:
- Lado izquierdo desde el USB: 1=CLK, 2=SDO, 3=SDI, 4=P15, 5=P2, 6=P0, 7=P4, 8=P16 (UART2 RX), 9=P17 (UART2 TX), 10=P5, 11=P18, 12=P19, 13=GND...

Loopback test (P16↔P17 con cable hembra-hembra) ya validado ✅.

## Código actual (con loopback test)

Estado: funcionando. El bloque de loopback debe **removerse antes del día de campo**.

```cpp
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <HardwareSerial.h>

const int BAUD_VESTA = 9600;
const int PIN_RX = 16;
const int PIN_TX = 17;

#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"

BLECharacteristic *pTxCharacteristic;
bool deviceConnected = false;
HardwareSerial SerialVesta(2);

String bufferVesta = "";
unsigned long ultimoLoopback = 0;

class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) { deviceConnected = true; }
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    delay(500);
    pServer->getAdvertising()->start();
  }
};

void enviarPorBLE(String mensaje) {
  if (deviceConnected) {
    pTxCharacteristic->setValue(mensaje.c_str());
    pTxCharacteristic->notify();
    Serial.println("[BLE>] " + mensaje);
  } else {
    Serial.println("[sin cliente] " + mensaje);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  SerialVesta.begin(BAUD_VESTA, SERIAL_8N1, PIN_RX, PIN_TX);
  BLEDevice::init("VESTA_BRIDGE");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_NOTIFY);
  pTxCharacteristic->addDescriptor(new BLE2902());
  pService->start();
  pServer->getAdvertising()->start();
}

void loop() {
  while (SerialVesta.available()) {
    char c = SerialVesta.read();
    if (c == '\n') {
      bufferVesta.trim();
      if (bufferVesta.length() > 0) {
        Serial.println("[VESTA<] " + bufferVesta);
        enviarPorBLE(bufferVesta);
        bufferVesta = "";
      }
    } else if (c != '\r') {
      bufferVesta += c;
    }
  }
  // LOOPBACK — SACAR PARA EL CAMPO
  if (millis() - ultimoLoopback > 3000) {
    ultimoLoopback = millis();
    SerialVesta.println("+0312.5 kg");
  }
}
```

## Pipeline validado

Arduino IDE + ESP32 toolchain (board: DOIT ESP32 DEVKIT V1, COM7) ✅
BLE Nordic UART funcionando con iPhone vía nRF Connect ✅
UART2 hardware (loopback P16↔P17) ✅
Pipeline completo: serial → ESP32 → BLE → iPhone ✅

Tip de upload: si falla "Connecting......", mantener botón BOOT presionado.

## Protocolo día de campo

**Llevar**: laptop con Arduino IDE, ESP32 en breadboard, power bank (microUSB), 2 cables macho-hembra Dupont, multímetro nuevo, cinta aisladora.

**Pasos**:

1. Localizar el cable RFID físico del Vesta (ya confirmado que está)
2. Con Vesta encendido, multímetro en DC 20V, negro en carcasa metálica del conector (referencia GND), rojo en cada pin → mapear voltajes
   - 0V = GND (Pin 1)
   - ~5V = supply (Pin 6, no tocar)
   - ~3-5V idle = TX (Pin 3) ← **objetivo**
3. Si TX ≤ 3.3V: conectar directo. Si ≤ 5V: conectar directo con precaución. Si >5V: necesitamos MAX3232 (poco probable)
4. Pin 1 (GND) del Vesta → cable macho-hembra → GND del ESP32
5. Pin 3 (TX) del Vesta → cable macho-hembra → P16 del ESP32
6. Alimentar ESP32 con power bank
7. Abrir Serial Monitor (115200 baud), pesar un animal, mirar líneas `[VESTA<]`

**Plan B si no sale nada por Pin 3**: ir a Config → Lector y cambiar de Bluetooth/Allflex a Lector por cable, para forzar el RS-232 activo.

## Correlación Vesta + Allflex en la app

El teléfono puede mantener múltiples conexiones BLE simultáneas (iOS ~7-8, Android similar). Una al VESTA_BRIDGE, otra al Allflex RS420 — independientes.

Pseudocódigo del correlation engine:

```
weightQueue = []  // {timestamp, peso}
tagQueue = []     // {timestamp, tag}

onWeightReceived(peso):
    weightQueue.push({now(), peso})
    tryMatch()

onTagReceived(tag):
    tagQueue.push({now(), tag})
    tryMatch()

tryMatch():
    for peso in weightQueue:
        for tag in tagQueue:
            if |peso.ts - tag.ts| < 3000ms:
                emit({peso, tag, ts})
                remover ambos
    limpiar entradas viejas (>10s)
```

**Timestamps**: del teléfono cuando llega la notificación, no de los dispositivos emisores.

**Edge cases**: peso sin TAG (animal no identificado), TAG sin peso (se bajó antes), TAGs múltiples ambiguos, desconexiones.

## Pendiente de validación en campo

- Confirmar que el Vesta efectivamente saca datos por Pin 3 (TX) al pesar un animal
- Identificar formato exacto del mensaje del Vesta
- Escanear protocolo BLE del Allflex RS420 con nRF Connect (identificar service/characteristic UUIDs)

## Balanzas Bluetooth nativas (caso adicional)

El producto también debe soportar balanzas que tengan Bluetooth nativo (no requieren bridge). El módulo de conexión a balanza debe ser pluggable:
- Modo 1: VESTA_BRIDGE (ESP32 intermediario)
- Modo 2: Balanza Bluetooth directa (cuando exista)

Esto se modela como un "tipo de fuente de peso" en el código de la app.
