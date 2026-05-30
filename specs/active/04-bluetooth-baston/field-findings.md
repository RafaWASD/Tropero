# Spec 04 — Día de campo: hallazgos del bastón Allflex RS420

**Fecha**: 2026-05-30 (sesión 20, campo)
**Capturado por**: leader + Raf (en el campo, con bastón + VESTA_BRIDGE conectados).
**Status**: 🔴 **Hallazgo bloqueante — requiere decisión arquitectónica (ADR).** No foldear en la spec hasta resolver el transporte.

> Estos hallazgos corrigen un supuesto de `CONTEXT/05` y del diseño de spec 04. Jerarquía de verdad: este finding (evidencia de campo + manual oficial) gana sobre el supuesto previo.

## Hallazgo crítico: el RS420 NO usa BLE

El Allflex RS420 usa **Bluetooth Classic — Serial Port Profile (SPP) + Apple iAP (iPod Accessory Protocol / MFi)**. **No expone GATT BLE.**

**Evidencia**:
1. **Manual oficial RS420** (Rev. 2.5): *"equipped with a Class 1 Bluetooth module and is compliant with the Bluetooth Serial Port Profile (SPP) and Apple's iPod Accessory Protocol (iAP)"*. Emparejamiento desde Ajustes → Bluetooth con **PIN 1234** (patrón de pairing Classic, no BLE).
2. **Empírico (campo, iPhone)**: nRF Connect (scanner BLE-only) **NO lista el bastón, AUNQUE esté emparejado en Ajustes → Bluetooth**. Esta es la firma definitiva de Classic/iAP: un periférico BLE aparecería en nRF Connect; uno Classic se empareja en Ajustes y queda invisible para scanners BLE. Solo aparecen `VESTA_BRIDGE` (ESP32), un beacon de Windows (laptop) y dispositivos BLE ajenos (p.ej. "Clock", que es una función de la notebook, no el bastón).
3. **Empírico**: la app oficial **Gestor RS420 de Allflex** SÍ lee tags en iOS → usa el framework **External Accessory (iAP/MFi)**, no Core Bluetooth.

**Conclusión**: `react-native-ble-plx` (BLE-only, ADR-002) **no puede comunicarse con el RS420**. El diseño actual de spec 04 (adaptador BLE GATT) no aplica al transporte real del bastón.

### Impacto por plataforma
- **Android**: SPP accesible vía API estándar (`BluetoothSocket`, UUID SPP `00001101-0000-1000-8000-00805F9B34FB`) — viable con módulo nativo.
- **iOS**: iAP/MFi requiere certificación MFi de Apple + protocol string de Allflex en `UISupportedExternalAccessoryProtocols`. Barrera dura: necesita cooperación del fabricante. Por eso solo la app oficial lee en iOS.

## Hallazgo bueno: formato del TAG confirmado

Tag leído en la app Gestor RS420: **`982 000364696050`**.
- Estándar **ISO 11784/11785 (FDX-B)**, **15 dígitos**.
- Prefijo `982` = código de **fabricante** (rango ≥900 = manufacturer code, no país). 12 dígitos restantes = ID único.
- Display agrupa como `982 000364696050` (espacio tras el prefijo de 3 dígitos).
- **Insumo firme para `normalize.ts` / `isValidTag`** (R8) independientemente del transporte: 15 dígitos, strip de espacios/control chars, validar longitud + estructura.

## Hallazgo MAYOR: el RS420 transmite EN VIVO por SPP — protocolo capturado

Capturado en **COM9** (Windows, Arduino IDE Serial Monitor). Idéntico a **9600 y 115200 baud** → confirma que el baud es indiferente (típico de SPP virtual). **Refuta la hipótesis de "solo buffer interno": el RS420 emite cada lectura en vivo por SPP** (no hace falta pedirle las "sessions" con un comando para el caso live).

Líneas crudas (9 lecturas del MISMO tag, una por bastoneada):

```
□1000000982000364696050260530101701
□1000000982000364696050260530101703
□1000000982000364696050260530101717
□1000000982000364696050260530101719
□1000000982000364696050260530101721
□1000000982000364696050260530101722
□1000000982000364696050260530101724
□1000000982000364696050260530101729
□1000000982000364696050260530101731
```

Segunda captura — **2 tags distintos** (para decodificar la cabecera):

```
1000000032010006382438260530102708   → EID 032010006382438 (032 = Argentina), ts 10:27:08
1000000982000364696050260530102714   → EID 982000364696050 (982 = fabricante), ts 10:27:14
```

→ La cabecera `1000000` es **idéntica** en ambos pese a tener EIDs distintos ⇒ confirma que es prefijo fijo del lector, no parte del tag.

### Estructura del registro (ASCII, 1 línea por lectura, terminada en newline)

| Campo | Ejemplo | Notas |
|---|---|---|
| Byte de control inicial | `□` (1 byte no imprimible) | Inicio de trama, probablemente STX `0x02`. **NO es ruido.** Hex exacto a confirmar con hex dump. |
| Cabecera | `1000000` (7 dígitos) | **CONSTANTE confirmado con 2 tags distintos** (`982...` y `032...`). Es metadata fija del lector / header ISO (`1`=indicador animal + reservado en 0), NO deriva del tag → **prefijo fijo a descartar**. |
| **EID** | `982000364696050` (15 dígitos) | **El dato útil.** ISO 11784/11785, **15 dígitos**. Prefijo de 3 díg = **país** (`032` = Argentina, caravana oficial) **o fabricante** (≥900, ej. `982`) + 12 díg de ID. `isValidTag` debe aceptar ambas formas. |
| Timestamp | `260530101701` (12 dígitos) | `YYMMDDHHMMSS` = 2026-05-30 10:17:01. Reloj del lector. Segundos incrementan por lectura (01,03,17,19,21,22,24,29,31). |

### Implicaciones
- **Android: vía SPP totalmente caracterizada.** Módulo nativo abre el RFCOMM SPP (UUID `00001101-0000-1000-8000-00805F9B34FB`), lee líneas ASCII, descarta el byte de control, extrae los **15 dígitos del EID** (offset fijo tras la cabecera de 7). Listo para diseñar/implementar.
- **iOS: sin cambios** — que transmita en vivo NO esquiva la barrera iAP/MFi. iOS sigue necesitando MFi, o el atajo del bridge (opción D), o un lector BLE.
- Para `normalize.ts` (R8): el adaptador SPP entrega el EID `982000364696050` (15 dígitos) ya recortado del byte de control + cabecera + timestamp. El strip de framing va en el parser del adaptador, no en normalize.
- El lector trae **su propio timestamp** por lectura — decisión futura: usar reloj del lector vs. timestamp del teléfono (CONTEXT/05 ya fijó "timestamp del teléfono" para correlación con peso; el del lector es info extra).

### TODO de protocolo (menores)
- [ ] Confirmar **hex exacto del byte de control inicial** y del terminador de línea (CR/LF/CRLF) — requiere hex dump (Arduino Serial Monitor no muestra hex; usar la captura PowerShell sobre COM9 cuando esté libre).
- [ ] Bastonear un **2do tag distinto** para decodificar el campo `1000000` (¿constante reader-meta o deriva del tag?).

## Hallazgo lateral: balanza (spec 05) — bridge OK

`VESTA_BRIDGE` (ESP32, BLE Nordic UART) **aparece y conecta bien en nRF Connect**. La capa de advertising/conexión BLE del bridge de la balanza está validada (pendiente: ver datos reales de peso + UUIDs Nordic confirmados).

## Pista a explorar (potencial atajo elegante)

El RS420 está cableado al Vesta por RS-232 (CONTEXT/05: Pin 2 del Vesta = RX, "recibe TAG del bastón"). **¿El Vesta re-emite el TAG por su TX (Pin 3) junto con el peso?** Si sí, el bridge ESP32 ya capturaría **TAG + peso por un solo canal BLE Nordic UART**, esquivando por completo el problema de transporte del RS420.
- **Test (en campo, con todo conectado)**: abrir Serial Monitor del ESP32, bastonear un tag y/o pesar, y mirar si las líneas `[VESTA<]` incluyen el TAG `982...`.
- Si funciona → cambia radicalmente la solución del bastón (no se conecta a la app; pasa por el bridge). Si no → seguir con la decisión de transporte abajo.

## Decisión pendiente (ADR — NO decidir sin Raf)

**Restricción dura (Raf, 2026-05-30): AMBOS (Android + iOS) SIEMPRE — es MUST del proyecto.** Esto descarta "Android-first / iOS diferido" como respuesta permanente. La solución del bastón **debe** funcionar en las dos plataformas. Eleva la opción D (bridge cross-platform, es BLE) como la candidata más limpia para cubrir iOS sin MFi.

Opciones de alto nivel (a evaluar, no decididas):
- **A — Android-first para el bastón**: SPP nativo en Android; iOS bastón diferido/bloqueado por MFi. ❌ **Insuficiente solo** (viola "AMBOS MUST"); a lo sumo, parte de una solución combinada.
- **B — MFi/iAP en iOS**: perseguir protocol string de Allflex + certificación MFi (pesado, depende del fabricante).
- **C — Bastón BLE alternativo**: otro lector que sí exponga GATT BLE (cambia el supuesto de hardware).
- **D — Bridge del TAG vía Vesta**: si la pista de arriba funciona, el TAG llega por el ESP32 (un solo canal). Sujeto a confirmar que el Vesta reenvía el tag por TX.
- **E — Bridge SPP→BLE dedicado**: ESP32 como master SPP del RS420 que re-advertiza BLE (más hardware por bastón).

**Afecta**: ADR-002 (stack BLE bastón), ADR-003 (solo Vesta, no bastón — sigue válido), diseño de spec 04 (adaptador), `CONTEXT/05` (corregir "Bluetooth nativo" → Classic/iAP).

## Pendiente de confirmación inmediata
- [x] iOS Ajustes → Bluetooth: el RS420 **está emparejado en Ajustes pero nRF Connect NO lo detecta** → **CONFIRMA Classic/iAP** (2026-05-30, campo).
- [x] Protocolo SPP capturado (COM9, Windows): streaming en vivo, ASCII, `□ + 1000000 + <EID 15d> + <YYMMDDHHMMSS>`. **Android de-riskeado.**
- [x] Target del operario: **AMBOS (Android + iOS) SIEMPRE — MUST** (Raf). → la decisión debe cubrir iOS sí o sí.
- [ ] Test de la pista del bridge (¿el Vesta reenvía el TAG por Pin 3?) — **sigue siendo la clave para iOS**.
- [x] Cabecera `1000000` decodificada: **constante** con 2 tags distintos (`982...` y `032...`) → prefijo fijo del lector. Visto tag oficial argentino (`032...`) y de fabricante (`982...`), ambos 15 díg.
- [ ] Hex exacto del byte de control inicial + terminador de línea (menor; requiere hex dump).

## Fuentes
- Manual RS420 Rev. 2.5 (allflex.global)
- Serialio — "Connect Allflex Stick Reader To iOS" (serialio.com)
- Evidencia de campo: capturas `docs/nRF Connect.jpeg`, `docs/nrf connect2.jpeg`, `docs/allflex-gestor-rs420.jpeg`
</content>
</invoke>
