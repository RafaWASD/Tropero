# ADR-010 — Integración Hardware con Vesta 3516 vía Bridge ESP32

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

El Vesta 3516 es el data collector más común en Argentina para pesaje de animales en jaula/manga. Lee las celdas de carga, muestra el peso, y tiene un puerto serial RS-232 para comunicarse con periféricos (bastones RFID, computadoras).

**El Vesta no tiene Bluetooth nativo**. Para llevar el dato del peso al teléfono hay que hacer un puente.

Inicialmente se exploró la idea de un dispositivo independiente que leyera directamente las celdas de carga (HX711). Pero eso significa:
- Crear un nuevo dispositivo paralelo al Vesta
- Convencer al productor de "no usar el Vesta original"
- Hacer calibración propia
- Competir con el Vesta funcional

La alternativa más elegante: **interceptar el output del puerto RS-232 del Vesta**, leer lo que el Vesta ya está calculando, y retransmitirlo vía BLE al teléfono.

El cable Vesta↔bastón existe físicamente en el campo (ya confirmado en Los Tamarindos), lo que permite conexión limpia sin pinchar pines.

Adicionalmente, el bastón Allflex RS420 ya tiene Bluetooth nativo y se conecta directamente al teléfono — no hace falta bridge para el bastón.

## Decisión

**Arquitectura de bridge BLE para el Vesta usando ESP32**:

```
Vesta 3516
   │
   │  RS-232 TTL (cable existente del campo)
   │  Pin 1 (GND), Pin 3 (TX)
   │
   ▼
ESP32 (NodeMCU DevKit V1)
   │  UART2 hardware (P16=RX, P17=TX)
   │
   │  procesa, parsea, opcionalmente filtra
   │
   ▼
BLE Nordic UART Service
   │
   ▼
iPhone / Android con la app
```

**Conexión física**:
- Vesta Pin 1 (GND) → ESP32 GND
- Vesta Pin 3 (TX) → ESP32 GPIO 16 (UART2 RX)
- ESP32 alimentado con power bank (USB)

**Protocolo BLE**: Nordic UART Service estándar (ver `ADR-003`).

**Hardware del bridge**:
- ESP32 DevKit V1 (NodeMCU ESP-32S)
- Caja impresa 3D para campo (post-MVP)
- Power bank pequeño para alimentar

**Modo manual como fallback**: si no hay bridge o falla, el operador puede tipear el peso a mano. La app no debe nunca bloquearse esperando hardware.

**Soporte futuro de balanzas Bluetooth nativas**: la arquitectura del módulo de "fuente de peso" debe permitir agregar balanzas con BLE nativo sin tocar el código del bridge ESP32.

## Alternativas consideradas

### Lector independiente de celdas con HX711
- **Pros**: independencia del Vesta
- **Contras**:
  - Crear competencia al Vesta confunde al productor
  - Calibración compleja
  - Falla y diagnóstico difíciles
  - Duplica funcionalidad existente

### USB OTG cable directo Vesta ↔ teléfono
- **Pros**: sin Bluetooth
- **Contras**:
  - Requiere cable físico que estorba en manga
  - Android requiere OTG adapter
  - iOS Lightning requiere Camera Adapter ($$)
  - Fricción inaceptable operativa

### Modificar firmware del Vesta para que emita Bluetooth
- **Pros**: solución limpia
- **Contras**:
  - Imposible (firmware cerrado)
  - Pediría romper garantía

### Solo software (operador tipea peso manualmente siempre)
- **Pros**: cero hardware
- **Contras**:
  - 500 animales = 500 typos potenciales
  - Pierde value prop principal (datos automáticos)
  - Sigue siendo igual a Control Ganadero

### Comprar balanzas Bluetooth y reemplazar Vestas
- **Pros**: arquitectura limpia
- **Contras**:
  - Inversión grande del productor
  - Vestas ya están comprados y funcionando
  - Adopción muy lenta

## Consecuencias

**Positivas**:
- Aprovecha hardware existente del productor
- No compite con Vesta, lo extiende
- Componentes baratos (~$20 USD por bridge)
- Pueden fabricarse y enviarse a productores
- Patrón replicable para otros data collectors con RS-232

**Negativas**:
- Es un dispositivo más en el campo (potencial punto de falla)
- Requiere energía (power bank o alimentación cableada)
- Soporte: si falla el bridge, hay que diagnosticar BLE + UART + cable
- Cada modelo de data collector puede tener un protocolo distinto en RS-232 (requiere parser por modelo si se extiende)

**Mitigaciones**:
- Caja robusta para campo (IP54 o mejor)
- LED status indicators (power, BLE connected, data flowing)
- Documentación clara de instalación
- Modo manual siempre disponible como fallback
- Logs locales en SD card (post-MVP) para diagnóstico

**Pendiente de validación en campo**:
- Voltaje real en Pin 3 del Vesta (esperado TTL 3.3-5V, requiere MAX3232 si fuera ±12V)
- Formato exacto del mensaje serial que emite el Vesta
- Estabilidad de conexión BLE a distancia útil (≥5 metros con obstáculos)
- Plan B: si Pin 3 no emite por defecto, Config → Lector → cable para forzar RS-232 activo

**Notas de implementación**:
- Firmware del ESP32 en `/firmware/vesta-bridge/` del repo
- Loopback block del firmware actual debe removerse antes de field day
- App tiene módulo `lib/bluetooth/vestaBridge.ts` que maneja conexión, parseo y feed al correlation engine
- Correlation engine (`lib/bluetooth/correlation.ts`) une eventos Vesta con eventos Allflex por ventana temporal de ~3 segundos
