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

## Reencuadre estratégico (Raf, 2026-05-30) — el bridge NO es producto

**Decisión de Raf**: el bridge ESP32 es un **instrumento de test**, NO una parte del producto. Sirve para simular acá un dispositivo BLE "moderno" a partir del equipo viejo del amigo (Vesta RS-232, RS420 SPP) y así desarrollar/validar el camino BLE de la app sin depender del hardware final. **No se envía un dongle por cliente.** Igual que ya usamos el ESP32 para la balanza vieja, lo usamos para el bastón viejo: re-emite los TAGs del RS420 por BLE Nordic UART y la app los lee con `react-native-ble-plx` → desbloquea TODO el pipeline platform-agnostic de spec 04 (lectura, dedup, find-or-create, UI, mock) HOY, en ambas plataformas, sin tocar MFi. Pero **NO valida el transporte real** del producto (MFi/SDK por fabricante) — eso queda como problema aparte.

**Premisa del producto a verificar**: "ser compatible con los bastones/balanzas buenos y modernos del mercado". El refinamiento asumía que modernos = BLE GATT abierto. **La evidencia preliminar lo REFUTA para stick readers.**

### Realidad del mercado de stick readers (evidencia 2026-05-30, preliminar)
Los lectores de bastón NO son periféricos BLE GATT abiertos; son **accesorios vendor-locked**. Patrón transversal a las marcas:
- **Allflex (marca dominante en AR)**: el **AWR300**, sucesor actual del RS420, sigue listando **"Bluetooth Class 1"** (Classic) + USB + RS-232 — **NO BLE**. iOS ⇒ MFi/iAP. O sea: el flagship vigente de la marca líder es Classic igual que el RS420. **"Moderno ≠ BLE abierto"** para Allflex.
- **Gallagher (HR5)**: el live data va por **Wi-Fi / Bluetooth a SU PROPIA app** (Animal Performance); integración de terceros = **export CSV**, no stream BLE en vivo.
- **Tru-Test/Datamars (XRS2)**: se conecta a iOS y Android pero **vía su app Data Link**; acceso de terceros no documentado/abierto.

**Implicación dura**: NO existe un camino "uso BLE y anda en ambas plataformas" para los stick readers reales. Soportar los lectores del mercado en iOS = **MFi / SDK / partnership por fabricante** (problema de negocio, no de código) — canal Facundo. El único transporte vendor-independiente y cross-platform-limpio es el bridge… que Raf (con razón, por logística) descarta como producto. Hay una **tensión real entre "AMBOS SIEMPRE MUST" + "soportar los readers reales" + "sin dongle"** que es decisión de Raf/Facundo, no técnica.

## Decisión pendiente (ADR — NO decidir sin Raf)

**Restricción dura (Raf, 2026-05-30): AMBOS (Android + iOS) SIEMPRE — es MUST del proyecto.** Descarta "Android-first / iOS diferido" como respuesta permanente.

Opciones de alto nivel (a evaluar, no decididas), reordenadas con el reencuadre:
- **A — Android-first para el bastón**: SPP nativo en Android (parsea el SPP de Allflex AWR300/RS420 directo, sin deals); iOS diferido. ❌ Viola "AMBOS MUST" como respuesta permanente; sirve solo como mitad de una solución combinada.
- **B — MFi/SDK por fabricante (iOS)** ⭐ camino de producto real para iOS: perseguir protocol string + autorización/SDK de la(s) marca(s) que importen en AR (casi seguro Allflex) vía Facundo. Pesado y dependiente del fabricante, pero es **el** unlock de iOS sin dongle.
- **C — Restringir a lectores con iOS abierto**: solo soportar readers que expongan acceso iOS libre (BLE GATT abierto). Hoy **casi no existen** en sticks de ganado → recomendación de hardware poco realista para AR.
- **D/E — Bridge ESP32** (ahora **solo test rig**, NO producto): re-emite SPP→BLE. Desbloquea desarrollo/QA en ambas plataformas YA; no se envía a clientes.

**Afecta**: ADR-002 (stack BLE bastón — el supuesto BLE no cubre los readers reales del mercado), ADR-003 (solo Vesta, no bastón — sigue válido), ADR-010 (bridge = test, no producto; corregir "el RS420 ya tiene Bluetooth nativo… no hace falta bridge"), diseño de spec 04 (adaptador transport-agnóstico + parser por fabricante), `CONTEXT/05` (corregir "Bluetooth nativo" → Classic/iAP).

## Pendiente de confirmación inmediata
- [x] iOS Ajustes → Bluetooth: el RS420 **está emparejado en Ajustes pero nRF Connect NO lo detecta** → **CONFIRMA Classic/iAP** (2026-05-30, campo).
- [x] Protocolo SPP capturado (COM9, Windows): streaming en vivo, ASCII, `□ + 1000000 + <EID 15d> + <YYMMDDHHMMSS>`. **Android de-riskeado.**
- [x] Target del operario: **AMBOS (Android + iOS) SIEMPRE — MUST** (Raf). → la decisión debe cubrir iOS sí o sí.
- [ ] Test de la pista del bridge (¿el Vesta reenvía el TAG por Pin 3?) — **sigue siendo la clave para iOS**.
- [x] Cabecera `1000000` decodificada: **constante** con 2 tags distintos (`982...` y `032...`) → prefijo fijo del lector. Visto tag oficial argentino (`032...`) y de fabricante (`982...`), ambos 15 díg.
- [ ] Hex exacto del byte de control inicial + terminador de línea (menor; requiere hex dump).

## Sesión 21 (2026-05-31) — inteligencia de transporte: councils + autorización Allflex + Serialio

> Material para el futuro ADR de transporte. Es **research/brainstorming, NO decisiones firmes** (memoria "tentativo vs firme"). No formalizar sin Raf.

### Reencuadre del mercado (verificado por research)
- Los stick readers NO son BLE GATT abiertos: son **vendor-locked**. El Allflex **AWR300** (flagship vigente, sucesor del RS420) sigue siendo **Bluetooth Class 1 = Classic**, igual que el RS420. Gallagher HR5 = Wi-Fi/CSV a su app. Tru-Test XRS2 = app propia.
- PERO existen **bastones BLE genéricos baratos** en AR (Smart LFID, AgriEID "BT Ultra", Montetech ME-BL01, genéricos ISO en MercadoLibre, ~USD 100-200) que andan en iOS+Android **sin MFi** → la app los lee directo con `react-native-ble-plx`. El mercado está **PARTIDO**: premium-locked vs genérico-BLE-abierto.

### Council #1 — transporte del bastón (AMBOS MUST + readers reales + sin dongle)
NO poner el deal Allflex en el camino crítico. Android SPP ya; iOS degradado (carga manual/import); Allflex MFi como upside paralelo de Facundo. Reframes: el **foso real puede ser el loop de declaración SENASA (10 días hábiles)**, no la lectura en vivo; el bastón quizá **no es P0** (carga manual/visual del número = puerta cero); AR es mayoritariamente Android → el problema iOS puede ser menor de lo asumido (**medir el split del beta**).

### Council #2 — ¿vender el dongle ESP32 "estandarizador" como producto?
Veredicto (4/5 + chairman): **NO.** No montar un negocio de hardware (FCC/SIG, IP67, RMA, OTA, baterías) en un equipo de 2 personas de software. Los BLE genéricos ya resuelven iOS+Android sin MFi → recomendar/certificar un BLE barato como "hardware compatible RAFAQ" (canal Facundo, sin fábrica). Dongle solo como proyecto custom pagado por adelantado. El Expansionista (caballo-de-Troya-de-datos) fue refutado 5/5: el dato lo captura el SaaS, no el dongle.
**Única acción #1:** comprar UN bastón BLE genérico (~USD 100-300) + probar lectura **GATT en iPhone** con `react-native-ble-plx`. Falsea la premisa de la que cuelga TODA la estrategia.

### Hallazgo Allflex (autorización MFi — verificado por empresa)
- RAFAQ **NO necesita certificación MFi propia**: el RS420 ya es MFi (Allflex lo certificó). RAFAQ necesita que **Allflex autorice su app** (decisión de negocio que Allflex da de rutina). FAQ de Apple confirma: el portero es el fabricante, no Apple.
- Allflex tiene un **"Reader Connectivity SDK 2.0"** (mencionado en su app Allflex Connect) → es lo concreto a pedir.
- **Precedentes de terceros INDEPENDIENTES** (verificados) que leen el RS420 en iOS = están autorizados: **CattleMax/TagMax** (Cattlesoft Inc, independencia confirmada explícita), **AgriWebb** (VC-backed, USD 64.6M), **Herdwatch** (FRS co-op). [DuraDiamond/Gestor RS420 = **contratista** de Allflex SA → precedente débil; iLivestock = su producto propio, independiente pero íntimo con Allflex.]
- **"Pedido B" redactado** (en la conversación de la sesión): pedir SDK 2.0 + autorización del protocol string MFi, citando CattleMax/AgriWebb/Herdwatch. Lo manda **Facundo**.

### Atajo Serialio (analizado)
- **SerialMagic Keys (keyboard-wedge):** SÍ saltea a Allflex (la app de Serialio sostiene la conexión MFi; RAFAQ recibe el tag tecleado). UX clunky (2 apps, teclado pago por dispositivo, keyboard custom con Full Access) → **stopgap/demo**, no producto. Se combina con la "puerta cero" (teclea en el campo de carga manual).
- **SDK embebido:** probablemente NO saltea a Allflex (la app de RAFAQ igual declara el protocol string → necesita autorización). Acelera el código, no la autorización.
- **3 preguntas pendientes a soporte Serialio** (support@serialio.com): ¿el SDK exime de la autorización MFi?; mecanismo iOS del wedge; soporte RN + precio.

## Fuentes
- Manual RS420 Rev. 2.5 (allflex.global)
- Serialio — "Connect Allflex Stick Reader To iOS" (serialio.com)
- Evidencia de campo: capturas `docs/nRF Connect.jpeg`, `docs/nrf connect2.jpeg`, `docs/allflex-gestor-rs420.jpeg`
</content>
</invoke>
