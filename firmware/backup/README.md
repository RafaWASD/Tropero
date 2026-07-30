# Backup del firmware que el ESP32 tenía ANTES de usarlo como emulador de bastones

**Fecha del volcado**: 2026-07-29 · **Motivo**: Raf pidió reutilizar el ESP32 (comprado para la balanza)
como emulador de bastones para poder probar los transportes sin lector físico. Antes de escribirle
encima, se respaldó lo que tenía.

## Qué hay en el archivo

`esp32-original-2026-07-29.bin` — volcado **completo** del flash (4 MB, imagen cruda desde 0x0).

```
tamaño   4194304 bytes (4 MB)
sha256   1eb442fb810c512f79e04c2a7cc98a61172efe3bac1a08327e14ca4cf7319892
vacío    49.8% (0xFF) → ~2 MB de contenido real
chip     ESP32, flash 4MB, 3.3V (manufacturer 5e, device 4016)
```

## Qué firmware ES (identificado desde el binario, no supuesto)

**El bridge BLE de la balanza Vesta que define ADR-003.** Evidencia, extraída del propio volcado
(`esp32-original-strings.txt` tiene las 2811 cadenas):

| cadena en el binario | qué prueba |
|---|---|
| `VESTA_BRIDGE` | el nombre de advertising que fija ADR-003 |
| `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` | Service UUID de Nordic UART (ADR-003) |
| `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` | TX Characteristic, ESP32 → teléfono (NOTIFY) |
| `UART2 listo: RX=GPIO…` | lee el Vesta 3516 por **UART2** (RS-232) |
| `[VESTA<]` / `[BLE>]` | prefijos de log: entra del Vesta, sale por BLE |
| `Cliente BLE conectado` / `desconectado` | maneja conexión/desconexión del central |
| `arduino-esp32` core **3.3.8** | compilado con el Arduino IDE de esta máquina |

**Comportamiento**: pass-through. Lee líneas del Vesta por UART2 y las reenvía por BLE Nordic UART
como notificaciones. Coincide con el diseño de ADR-003 y con `CONTEXT/05-hardware-vesta.md`.

## ⚠️ El CÓDIGO FUENTE se perdió

Se buscó y **no está en el disco**: el sketchbook (`Documents\Arduino`, configurado en
`.arduinoIDE/arduino-cli.yaml`) solo tiene `libraries/HX711_Arduino_Library`, y los directorios
`.arduinoIDE-unsaved*` de temp están vacíos. Nunca se guardó como archivo.

Consecuencia: **este binario se puede RESTAURAR pero no MODIFICAR.** Si hay que cambiar el bridge, hay
que reescribir el sketch — usando ADR-003 (UUIDs + nombre) y la tabla de arriba (UART2, pass-through),
que juntos describen el comportamiento completo. No es una pérdida grave; es un sketch corto.

## Cómo restaurarlo

```bash
python -m pip install esptool          # si no está
python -m esptool --port COM7 write-flash 0x0 esp32-original-2026-07-29.bin
# verificar que quedó igual:
python -m esptool --port COM7 read-flash 0 0x400000 /tmp/check.bin
sha256sum /tmp/check.bin   # debe dar 1eb442fb810c512f79e04c2a7cc98a61172efe3bac1a08327e14ca4cf7319892
```

**⚠️ Baudios**: en esta máquina el volcado **falló** a `921600` y a `460800`
(`Packet content transfer stopped`) y funcionó a la velocidad por defecto (**115200**, ~6 min los 4 MB).
El cable USB de la sesión estaba falseado; si vas a subir la velocidad, verificá el sha después.

El puerto era **COM7** (`Silicon Labs CP210x USB to UART Bridge`). Puede cambiar: buscalo con
`Get-PnpDevice | Where-Object { $_.FriendlyName -match 'CP210' }`.
