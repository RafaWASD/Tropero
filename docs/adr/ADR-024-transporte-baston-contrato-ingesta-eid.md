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
- **NO** estandarizar un lector USD 595 importado como "hardware miTropero" (mata adopción en AR); sirve como test rig + ancla premium de una lista de compatibilidad.
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

Perseguir autorización MFi de Allflex (SDK 2.0 + protocol string, precedentes CattleMax/AgriWebb/Herdwatch) y acuerdos/certificaciones con fabricantes de bastones es **importante pero off-critical-path**, gestionado por Facundo, **post-MVP**. Desbloquea (i) el RS420 en iOS para quienes ya lo tienen, y (ii) una **lista de compatibilidad certificada miTropero** (no reventa de hardware; programa de certificación). El dongle ESP32 sigue siendo **test rig, no producto** (ADR-010, Council #2).

## Alternativas consideradas

### B — Comprometer MFi-Allflex como EL camino iOS (en el camino crítico)
- **Pros**: soporta en iOS el RS420 exacto que el beta ya tiene.
- **Contras**: el timeline lo controla Allflex, no miTropero (equipo de 2, beta inminente) → bloquea el MVP contra una negociación de fabricante. El Council lo descartó como camino crítico; queda como track paralelo (Decisión §5).

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

## Enmienda 2026-07-20 — Registro de drivers por fabricante + selección por capacidad

**Status**: Accepted (Puerta 1 del delta `04-bluetooth-baston/*-multivendor` aprobada por Raf, 2026-07-20). Extiende §1–§2 de este ADR; **no cambia** la decisión de transporte ya aceptada.

**Disparador**: objetivo de **compatibilidad máxima** + outreach continuo a fabricantes de bastones (Raf consigue las "claves" de cada empresa). La decisión original fijó los transportes (SPP / BLE-HID / web-serial / manual / mock) pero el parseo era RS420-only y la selección era solo por plataforma/modo.

### Decisión (dos piezas)

1. **Los adaptadores son por transporte; los fabricantes son datos (`ReaderDriver`).** Un `ReaderDriver` (alias `ReaderProfile`) declara `{ vendorId, displayName, transports: TransportCapability[], frameParser, deviceMatch, streaming }`, donde `TransportCapability` está discriminada por `kind ∈ {spp, serial, ble-hid, ble-gatt, mfi}` con sus `connectionParams` (SPP → `{sppUuid, pin}`; serial → `{baud}`; ble-gatt → `{serviceUuid, notifyCharUuid}`; ble-hid → sin params; mfi → `{protocolString}`). El RS420 es el **primer driver** (reusa `parser-rs420.ts`). **Sumar una marca = agregar una fila al `DRIVER_REGISTRY`**, sin tocar el contrato de ingesta, la interfaz `StickAdapter` ni los adaptadores. Es la generalización natural de §1 ("un EID es texto") a N fabricantes: §1 fijó los transportes; esto fija cómo se parametriza cada transporte por marca. (Alternativa descartada: un adapter por fabricante → duplica la I/O de transporte por marca; el transporte es el eje estable, la marca es la variación.)

2. **Selección por capacidad con prioridad de transporte por plataforma, determinística.** `platformTransportPriority(os)`: iOS `['ble-hid','ble-gatt','mfi']` (HID es el camino iOS-abierto; iOS es el cuello de botella); Android `['spp','ble-gatt','ble-hid']` (stream nativo > HID); web `['serial']`. `selectReaderBinding(env)` elige el transporte de mayor prioridad que el driver soporte y que tenga un `AdapterKind` construible, devolviendo `{adapterKind, transportKind, driver, available}`; resuelve la ambigüedad (device alcanzable por >1 vía) sin depender del orden de descubrimiento. Es **lógica pura** (testeable sin device). Consecuencia importante: **el RS420 en iOS → binding `null`** (solo declara `spp`+`serial`; su vía iOS real es MFi cuando llegue el `protocolString` de Facundo) → carga manual como piso. Un lector **HID** en iOS → `hid-wedge` (gated por validación física, §4 original).

**Por qué se formaliza (regla "¿se referencia en 6 meses?")**: se referencia cada vez que se suma un fabricante o un transporte (GATT/MFi); fija una decisión de integridad (qué transporte usa producción por plataforma). No es un detalle de una feature.

**Reversibilidad / relación**: mantiene la reversibilidad de §Consecuencias (agregar/sacar un driver o un adapter no toca el contrato). Insumos: `specs/active/04-bluetooth-baston/{context,requirements,design,tasks}-multivendor.md`. El adapter External Accessory/MFi (iOS Classic) sigue **diferido a Facundo** (§5); la arquitectura solo lo deja declarable (`transportKind:'mfi'` + `protocolString`).

## Enmienda 2026-08-17 — El camino iOS-abierto real es BLE-GATT, no HID

**Status**: Accepted (Puertas 1 y 2 del delta `04-bluetooth-baston/*-ios-ble-mfi`, aprobadas por Raf el 2026-08-15 y el 2026-08-17). Corrige §2, §4 y §5 y la prioridad de iOS de la enmienda 2026-07-20; **no cambia** el contrato de ingesta ni la interfaz `StickAdapter`.

**Disparador**: el relevamiento de bastones del mercado argentino (`docs/bastones-mercado-argentino.md`, 13/08/2026), que cruzó los catálogos reales de los distribuidores locales en vez de suponer el parque instalado.

### Lo que el relevamiento FALSIFICÓ de este ADR

1. **§2 llamaba al `hid-wedge` "el único camino BLE-abierto verificado".** No estaba verificado: **no hay un solo bastón del mercado argentino con modo HID confirmado por su fabricante**. El único candidato —el Gallagher **HR0**— sale de descripciones de revendedores y Gallagher no lo documenta.

2. **§2 decía "si aparece un lector con GATT abierto real se suma un `adapter-ble-gatt`".** Apareció: el **Gallagher HR5 v3**, que pasó a BLE justamente para entrar a iOS sin MFi (declarado por el fabricante vía AgriWebb).

⇒ **Los roles se dieron vuelta.** El camino con evidencia documental es **BLE-GATT** (un modelo, declarado por el fabricante); el que quedó sin ningún dispositivo confirmado es **HID**. La decisión original apostó al revés, con la información que había.

### Decisión (cuatro piezas)

1. **Se construye `adapter-ble-gatt`** sobre `react-native-ble-plx`, **cross-platform** (iOS y Android): el mismo transporte sirve al HR5 v3 en las dos plataformas, y Android es donde está el productor argentino. La dep quedó **vetada por inspección de fuente** (`progress/veto_ble-plx.md`): maneja new arch en Android e iOS y **no tiene capa JSI**, así que el modo de falla de `react-native-quick-sqlite` bajo bridgeless no aplica. El veto es **provisional** hasta un build de Gradle real.

2. **La prioridad de transporte de iOS pasa a `['mfi', 'ble-gatt', 'ble-hid']`**, invirtiendo la de la enmienda 2026-07-20 (`['ble-hid','ble-gatt','mfi']`). Cuando la cadena de protocolo existe, MFi es un stream nativo del lector que el cliente **ya tiene** (RS420, SRS2i, XRS2i) y no depende de que haya un campo enfocado; BLE-GATT va segundo porque es abierto pero hoy solo lo habla el HR5 v3; HID queda último porque secuestra el teclado del SO y sigue gated. Android y web no cambian.

3. **El gate físico del HID (§4) deja de requerir una compra.** El requisito original —*"conseguir un lector HID-capable (un AgriEID BT Ultra importado, o un genérico AR)"*— quedó obsoleto: el **emulador ESP32 en `MODO_HID`** es un teclado BLE HID y se construyó para esto, con terminador, delay y modo raw configurables. El gate se corre con hardware propio, contra una build ya instalada en el iPhone, **sin consumir un build de EAS**.
   ⚠️ **Lo que ese gate NO prueba** sigue siendo lo de (1): valida el **lado del teléfono** (que iOS entregue los keystrokes a un `TextInput` enfocado), **no** que exista un bastón comercial con modo HID. Son dos incógnitas y el verde de una no cierra la otra.

4. **§5 se corrige en quién es interlocutor de qué**, porque el ADR original hablaba solo de "autorización MFi de Allflex" y el pedido no es el mismo para los tres:
   - **Allflex** (RS420) y **Datamars** (Tru-Test SRS2i/XRS2i) → cadena de protocolo **iAP + licencia MFi**. Datamars **no figuraba** en este ADR y cubre dos de los cuatro modelos iOS-capaces del relevamiento.
   - **Gallagher** (HR5 v3) → **documentación técnica** (UUIDs de servicio/característica, formato de trama). **No hay ninguna licencia MFi que pedirle**: su camino iOS es BLE. Pedírsela sería pedir algo que no existe.
   - **HR4, HR5 estándar, SRS2, XRS2** → Bluetooth clásico sin chip MFi: **no se conectan a un iPhone con ninguna app, jamás**. No hay gestión posible por esos modelos.

**Lo que NO se decide acá**: registrar un `ReaderDriver` del HR5 v3. No tenemos el aparato ni sus parámetros, y un driver con UUIDs adivinados convertiría una incógnita en un verde falso. Un fabricante entra al `DRIVER_REGISTRY` cuando entrega su documentación.

**Prerrequisito que esta enmienda paga**: la deuda declarada bajo RMV5.2 —`contract.ts` llamaba `parseRs420Line` hardcodeado, así que un segundo driver **no podía existir**— se cierra en la Fase F1 del delta. Recién con eso RMV1.6 ("sumar una marca = agregar una fila") pasa a ser cierto.

**Reversibilidad**: intacta. Los adaptadores nuevos entran detrás de la misma `StickAdapter`; sacar `ble-gatt` o `mfi-ios` no toca el contrato de ingesta ni los otros transportes. El MFi queda **prearmado y gateado por la lista `UISupportedExternalAccessoryProtocols`** del build: el día que llegue una cadena, se destraba con una línea de config + una `TransportCapability`, **sin escribir código**.
