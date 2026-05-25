# ADR-003 — BLE Nordic UART Service (NO Bluetooth Classic SPP)

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

El bridge entre el data collector Vesta 3516 (RS-232) y el smartphone necesita comunicación inalámbrica. Hay dos opciones principales en el ecosistema Bluetooth:

1. **Bluetooth Classic con SPP (Serial Port Profile)** — emulación de puerto serie, simple
2. **Bluetooth Low Energy (BLE) con Nordic UART Service** — más moderno, multi-plataforma

La aplicación debe correr en **iOS + Android**.

## Decisión

**Implementar el bridge con BLE usando el Nordic UART Service**, con los UUIDs estándar:
- Service UUID: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- TX Characteristic (ESP32 → teléfono, NOTIFY): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- RX Characteristic (teléfono → ESP32, WRITE): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`

## Razón principal

**iOS no soporta Bluetooth Classic SPP sin certificación MFi (Made For iPhone) de Apple**. MFi requiere:
- Aprobación corporativa de Apple
- Chip MFi en el hardware
- Licencias y royalties

Para un producto en early-stage hecho por un solo developer, MFi es completamente impracticable.

BLE, en cambio, funciona en iOS sin certificación adicional.

## Alternativas consideradas

### Bluetooth Classic + SPP en Android, otra cosa en iOS
- **Pros**: SPP es trivial de implementar
- **Contras**: dos implementaciones distintas, dos protocolos, dos bugs, dos surfaces de testing

### WiFi Direct
- **Pros**: ancho de banda alto
- **Contras**: consumo de energía mucho mayor (ESP32 alimentado con power bank en campo), latencia variable, complejidad de pairing

### BLE custom (UUIDs propios sin Nordic UART)
- **Pros**: control total
- **Contras**: hay que documentar e implementar protocolo desde cero. Nordic UART está estandarizado, soportado por herramientas como nRF Connect, y bien soportado en `react-native-ble-plx`

### USB cable directo
- **Pros**: sin Bluetooth
- **Contras**: requiere cable físico, requiere adapter OTG en Android, no funciona en iOS lightning sin adaptador, fricción inaceptable en campo

## Consecuencias

**Positivas**:
- Una sola implementación cross-platform
- iOS soportado sin MFi
- Herramientas de testing maduras (nRF Connect for Mobile)
- `react-native-ble-plx` tiene buen soporte para Nordic UART
- Patrón conocido por la comunidad Arduino/ESP32

**Negativas**:
- BLE tiene MTU limitado (~20 bytes por defecto, negociable hasta 247)
- Hay que fragmentar mensajes largos si superan MTU
- Throughput menor que SPP (no relevante para mensajes de peso/TAG que son cortos)

**Notas de implementación**:
- Nunca emparejar desde Settings de iOS — conectar solo desde la app
- ESP32 advierte como `VESTA_BRIDGE`
- Múltiples conexiones simultáneas: iOS soporta ~7-8 BLE concurrentes, Android similar — suficiente para 2-3 dispositivos en campo
- Timestamps de correlación se toman en el cliente cuando llega la notificación (no en el ESP32)
