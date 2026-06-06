# ADR-024 — Transporte del bastón lector RFID: contrato de ingesta de EID transport-agnóstico (multi-adaptador)

**Status**: Accepted
**Fecha**: 2026-06
**Decisores**: Raf (decisión informada por investigación de mercado `deep-research` + LLM Council, sesión 22). Track de certificaciones/MFi: canal Facundo.

## Contexto

El bastón lector lee el TAG electrónico (EID) de la caravana oficial bovina (FDX-B ISO 11784/11785, 15 dígitos, 134.2 kHz) y lo entrega al motor de identificación (find-or-create de spec 09; consumido por MODO MANIOBRAS, spec 03). Es uno de los pilares de producto ("manga-friendly") y Raf lo fijó como **P0** del MVP. Restricción dura: **iOS + Android siempre = MUST**.

El refinamiento original de spec 04 (`context.md`) y ADR-002 asumían que el bastón se leía por **BLE GATT** vía `react-native-ble-plx`. **El día de campo (2026-05-30) y la investigación de mercado posterior refutaron ese supuesto.** Lo verificado (ver `specs/active/04-bluetooth-baston/field-findings.md`):

1. **El Allflex RS420 (el bastón que el cliente beta YA tiene) NO es BLE.** Es **Bluetooth Classic SPP + iAP/MFi**. No expone GATT (no aparece en nRF Connect aunque esté pareado). En Android se lee nativo por SPP (protocolo capturado y caracterizado: `□ + "1000000" + <EID 15 díg> + <YYMMDDHHMMSS>` en ASCII, una línea por lectura). En iOS, el RS420 solo se lee con **autorización MFi de Allflex** (Allflex autoriza la app + da protocol string + su "Reader Connectivity SDK 2.0"; decisión de negocio del fabricante, no certificación de Apple).
2. **El mercado de stick readers NO ofrece BLE GATT abierto.** Investigación `deep-research` (fuentes primarias, verificación adversarial 3-votos): NINGÚN stick reader de ganado expone un GATT abierto leíble por terceros. Los flagships son vendor-locked (Allflex AWR300 = Classic; Gallagher HR5 = app propia; Tru-Test XRS2 = app Data Link).
3. **SÍ existe un transporte abierto, sin MFi y cross-platform: BLE-HID / keyboard-wedge.** El lector parea como **teclado Bluetooth** y **tipea el EID** en el campo de texto enfocado — en iOS y Android, sin app del fabricante y sin MFi (documentado textual en AgriEID y Datamars/Tru-Test, corroborado por AgriWebb). **Caveat**: confirmado solo en lectores USD 595+ (AgriEID BT Ultra) sin canal de venta en Argentina; los genéricos baratos disponibles en MercadoLibre AR (Montetech ME-BL01, Smart LFID, ~USD 100-300) **no se pudo verificar** si hacen HID o solo "Bluetooth" genérico → quedan **no-verificados, no descartados**.

Por las apuestas (define la capa de integración del bastón para todo el MVP, equivocarse = rework o un MVP que se siente mal en el "primer try"), la estrategia se pasó por el **LLM Council** (5 asesores + revisión por pares + síntesis). El veredicto convergió fuerte:
- La abstracción correcta **no es "BLE"**: es **"un EID es texto"** — un contrato de ingesta ("string de 15 díg validado → commit") con N transportes como proveedores.
- La estructura multi-adaptador es correcta, **pero no se lockea el leg HID-iOS sobre un mecanismo nunca ejecutado** (HID→`TextInput` de RN en iOS, con la supresión del teclado en pantalla, es el supuesto más frágil).
- **NO** estandarizar un lector USD 595 importado como "hardware RAFAQ" (mata adopción en AR); sirve como test rig + ancla premium de una lista de compatibilidad.
- Riesgo nuevo detectado: un EID tipeado por el wedge con un dígito mutado se **declara MAL ante SENASA** (10 días hábiles) → el contrato necesita **checksum + confirmación visual antes del commit**, no solo "stream + Enter".

## Decisión

**El bastón se integra detrás de un contrato de ingesta de EID transport-agnóstico, con adaptadores intercambiables. El MVP soporta múltiples transportes; la autorización MFi/certificación por fabricante se difiere a un track paralelo (no bloqueante, pero marcado importante).**

### 1. El contrato canónico = ingesta de EID validado (no "BLE", no un fabricante)

La unidad de la arquitectura es un **EID válido + confirmado → commit al motor find-or-create (spec 09)**. Cualquier fuente que produzca un string de dígitos es un **proveedor** del mismo contrato. Esto reemplaza el supuesto "adaptador BLE GATT" del context original de spec 04.

- **Validación obligatoria en el contrato** (no en cada adaptador): EID = exactamente 15 dígitos, prefijo país (ej. `032`=AR) o fabricante (≥900, ej. `982`), normalización (strip de control chars/espacios). Ya implementado y de-riskeado en `app/src/services/ble/parser-rs420.ts` (`parseRs420Line` / `isValidTag` / `normalizeTag`, committeado `9126dba`).
- **Confirmación antes del commit**: dado el riesgo de declaración SENASA incorrecta, el contrato exige **confirmación visual de la lectura** (y feedback sensorial — vibración/beep, spec 04 context decisión 3) antes de persistir. Una lectura malformada no rompe el flujo (se descarta + log).
- **Dedup por-TAG ventana ~3s** (no cooldown global; TAGs distintos pasan al instante para no romper la asignación masiva, spec 09 R8) vive en el contrato, transport-agnóstico.

### 2. Adaptadores del MVP (todos detrás del mismo contrato)

```
EID-ingest contract  (normalize + isValidTag + confirm + dedup → find-or-create spec 09)
  ├── adapter-spp-android     ← RS420 nativo, Bluetooth Classic SPP (react-native-bluetooth-classic). CUBRE AL BETA.
  ├── adapter-hid-wedge       ← bastón BLE-HID que tipea en un TextInput de "scan". Camino ABIERTO iOS+Android, sin MFi.
  │                              ⚠ GATED: requiere validación física antes de implementar (ver §4).
  ├── adapter-web-serial      ← RS420 por COM virtual (Web Serial API) en la notebook Windows. DEV/TEST harness.
  │                              (ver specs/active/04-bluetooth-baston/web-serial-dev-harness-plan.md)
  ├── adapter-manual          ← carga manual del número (puerta cero, spec 09 R1). PISO, siempre disponible.
  └── adapter-mock            ← CI / dev sin device (ya pedido por spec 09).
        ↓
  parser-rs420.ts (compartido para el stream SPP/serial) + normalize/isValidTag (compartido para todos)
```

Esto cubre literal lo que se decidió para el MVP: **recibir de (a) bastones BLE en ambos OS** (vía `adapter-hid-wedge`, el único camino BLE-abierto verificado; si aparece un lector con GATT abierto real se suma un `adapter-ble-gatt` sin tocar el contrato), **(b) Classic SPP en Android** (RS420 nativo, el beta), y **(c) el RS420 por web** (Web Serial, para testear hoy en la notebook).

### 3. El beta sale con SPP-Android + manual

El entregable inmediato para el cliente beta de Chascomús es **`adapter-spp-android` (RS420) + `adapter-manual` como piso**. No depende de iOS, MFi ni HID. Raf **compra un teléfono Android de pruebas** para validar SPP nativo y BLE en device real (también destraba el bloqueo de dev-build / Expo Go SDK 56).

### 4. El leg HID-iOS es dirección elegida, GATED por validación física

El `adapter-hid-wedge` es el camino iOS-sin-MFi elegido, **pero su implementación está gated** detrás de un experimento de hardware (el Council fue enfático: no fijar arquitectura sobre un mecanismo no ejecutado). Gate antes de implementar el adapter HID:
- Conseguir un lector HID-capable (test rig — un AgriEID BT Ultra importado, o un genérico AR si se verifica que hace HID) y validar en **iPhone real**: (a) tipea los 15 dígitos completos, (b) emite terminador (Enter), (c) la supresión del teclado en pantalla de iOS no rompe la UX de manga, (d) el `TextInput` de RN con foco programático captura confiablemente entre versiones.
- Verificar el comportamiento equivalente en Android.

Si el wedge resulta frágil en RN/iOS, el contrato no cambia (los otros adaptadores siguen), solo se reevalúa el camino iOS-abierto.

### 5. MFi-Allflex + certificaciones de fabricantes = track paralelo diferido (importante)

Perseguir autorización MFi de Allflex (SDK 2.0 + protocol string, precedentes CattleMax/AgriWebb/Herdwatch) y acuerdos/certificaciones con fabricantes de bastones es **importante pero off-critical-path**, gestionado por Facundo, **post-MVP**. Desbloquea (i) el RS420 en iOS para quienes ya lo tienen, y (ii) una **lista de compatibilidad certificada RAFAQ** (no reventa de hardware; programa de certificación). El dongle ESP32 sigue siendo **test rig, no producto** (ADR-010, Council #2).

## Alternativas consideradas

### B — Comprometer MFi-Allflex como EL camino iOS (en el camino crítico)
- **Pros**: soporta en iOS el RS420 exacto que el beta ya tiene.
- **Contras**: el timeline lo controla Allflex, no RAFAQ (equipo de 2, beta inminente) → bloquea el MVP contra una negociación de fabricante. El Council lo descartó como camino crítico; queda como track paralelo (Decisión §5).

### C — Android-SPP-only para el beta + manual en iOS, diferir todo iOS
- **Pros**: lo más lean; es de facto lo que sale para el beta (Decisión §3).
- **Contras**: como **respuesta permanente** viola "AMBOS-MUST". Se adopta su pragmatismo para el beta, pero la arquitectura (contrato + adaptadores) mantiene iOS como first-class, no diferido por diseño.

### Asumir GATT genérico (react-native-ble-plx lee un bastón BLE barato)
- **Pros**: encajaría con ADR-002 sin fricción.
- **Contras**: **refutado por la investigación** — ningún stick reader expone GATT abierto. Mantener este supuesto habría construido sobre una premisa falsa. Por eso el camino BLE-abierto real es HID-wedge, no GATT.

### Bastón que bufferea offline y se descarga en batch (sin teléfono en la manga)
- **Pros**: el RS420 almacena sesiones (se bajan por comando/USB/SPP) → "bastoneás sin teléfono, volcás la sesión después" **disolvería el problema de transporte-en-vivo-iOS** y la ergonomía de sostener el teléfono en la manga. Lo destapó la revisión por pares del Council.
- **Contras**: pierde el feedback en vivo (confirmación inmediata de lectura) que es parte del pilar manga-friendly; rompe la correlación TAG↔peso en vivo (spec 05). **No se adopta para el MVP**, pero queda anotado como **proveedor candidato del contrato** (`adapter-batch-dump`) — se evalúa si la validación física del wedge (§4) falla o si la ergonomía de campo lo exige.

### Vender un dongle ESP32 "estandarizador" como producto
- Rechazado previamente (Council #2 + ADR-010): no montar un negocio de hardware (FCC/SIG, IP67, RMA, OTA) en un equipo de 2 de software. El ESP32 es test rig.

## Consecuencias

**Positivas**:
- **Resiliente al fabricante y al transporte**: el contrato de ingesta no está atado a Allflex ni a BLE. Sumar un lector nuevo (GATT genérico, otro SPP, QR/NFC futuro) es un adaptador, no un rediseño.
- **Optionality real**: el mismo `TextInput` de scan que recibe el wedge HID recibe carga manual, y mañana OCR de caravana visual / dictado / pegado de planilla. El bastón es el primer driver de un bus de ingesta.
- **El beta avanza ya** con SPP-Android + manual, sin esperar decisiones de iOS/MFi.
- **Honestidad técnica**: el leg más frágil (HID-iOS) queda gated por evidencia física, no formalizado como firme (coherente con la política tentativo-vs-firme).
- **Integridad de dato SENASA**: checksum + confirmación visual en el contrato previenen declarar EIDs corruptos.

**Negativas / riesgos**:
- **El camino BLE-abierto barato en AR sigue sin probar**: el genérico (Montetech/Smart LFID) puede no hacer HID → el camino iOS-abierto podría requerir importar un lector USD 595+, lo que encarece la recomendación de hardware. Mitigación: validación física (§4) antes de comprometer; manual como piso siempre.
- **El wedge HID puede ser frágil en RN/iOS** (foco, autocorrección, app en background). Mitigación: gate §4; el contrato sobrevive sin este adaptador.
- **Ergonomía de manga no resuelta** (quién sostiene el teléfono): puede empujar hacia captura sin pantalla o batch-dump. Mitigación: validar con el operario beta; `adapter-batch-dump` como fallback documentado.
- **Dos caminos de stream con parser compartido** (SPP nativo + Web Serial) — bajo riesgo: `parser-rs420.ts` ya es transport-independiente y testeado.

**Reversibilidad**: alta. El contrato de ingesta es la pieza estable; cualquier adaptador se agrega/saca sin tocar el motor find-or-create ni los otros transportes.

**Relación con otros ADRs**:
- **ADR-002** (stack): amenda el supuesto "`react-native-ble-plx` cubre el bastón" — vale para el bridge Vesta (BLE), no para el RS420 (Classic/MFi). ADR-002 no se supersede; su elección de stack sigue válida.
- **ADR-003** (BLE Nordic UART para el bridge): sigue **vigente y sin cambios**. Su principio ("evitar Classic/MFi eligiendo BLE") se aplicó porque controlamos el firmware del ESP32. El bastón es un device de tercero cuyo firmware **no** controlamos → no se puede aplicar por decreto; se rutea con SPP-Android + HID-wedge + manual. ADR-024 explica por qué el bastón diverge del bridge.
- **ADR-010** (Vesta vía bridge ESP32): el bridge es **test rig, no producto** (corrige el supuesto "el RS420 ya tiene Bluetooth nativo, no hace falta bridge").
- **spec 04** (`specs/active/04-bluetooth-baston/`): este ADR desbloquea su redacción. El `context.md` se folda con esta decisión (contrato + adaptadores del MVP) antes de pasar a `spec_author`. Insumos: `field-findings.md`, `android-spp-impl-plan.md`, `web-serial-dev-harness-plan.md`, `razas`/parser.
- **spec 09** (`buscar-animal`): define la interfaz (`BleStickEvent`/`useBleStickListener`/`BleStickListenerProvider`/`useBusyMode`/mock) que los adaptadores implementan. El "contrato de ingesta" de este ADR es la generalización de esa interfaz a N transportes.
- **spec 03** (MODO MANIOBRAS): consumidor del listener; `enable/disable` + busy-mode aplican igual a todos los adaptadores.
