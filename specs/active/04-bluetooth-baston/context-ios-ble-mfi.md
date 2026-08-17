# Contexto (Gate 0) — Bluetooth en iOS: BLE real + MFi prearmado

**Pedido de Raf (2026-08-15)**: *"desarrolles absolutamente todo el bluetooth para iOS. con BLE y que
dejes prearmado el MFi para cuando consiga la key de allflex y gallagher"*.

Delta de la **feature 04**. Base: `c84014d`. Insumos leídos: `docs/bastones-mercado-argentino.md`
(relevamiento del 13/08), `ADR-024` (contrato de ingesta agnóstico del transporte), `ADR-003` (Nordic
UART), y el árbol de `app/src/services/ble/`.

---

## 1. Qué encontré antes de proponer nada

### 1.1 🔴 El registro de drivers NO soporta un segundo driver — y esto es prerrequisito

`contract.ts:16` importa `parseRs420Line` y `contract.ts:36` lo **llama hardcodeado**. La deuda ya estaba
anotada el 2026-07-30 (🟡-4 del review de SPP: *"RMV1.6 no se cumple con un segundo driver"*), pero
entonces era teórica porque todos los transportes hablaban con un RS420.

**Ahora deja de ser teórica**: un bastón BLE que no sea Allflex emite otra trama, y hoy no hay por dónde
meterla. **No es limpieza opcional: sin esto, el adapter BLE solo puede hablar con algo que emita tramas
RS420** — o sea, con nuestro propio emulador y con nada más.

### 1.2 ✅ El MFi ya está prearmado a nivel config — y por un motivo que no hay que romper

`app.config.ts:96` ya declara `UISupportedExternalAccessoryProtocols: []`. **La lista vacía no es un
olvido: es un guard anti-crash.** El `init()` nativo de `react-native-bluetooth-classic`
(`ios/RNBluetoothClassic.swift:68-69`) hace un force-cast `as! [String]` sobre esa clave → **sin la clave
la app crashea al arrancar en iOS**. Las dos purpose strings (`NSBluetoothAlwaysUsageDescription`,
`NSBluetoothPeripheralUsageDescription`) ya están, en español.

### 1.3 ✅ El MFi NO necesita una dependencia nueva

`react-native-bluetooth-classic` —**ya instalado**— tiene implementación iOS sobre **ExternalAccessory**
(`ios/conn/*.swift`, `device/NativeDevice.swift`). O sea: el camino MFi es **la misma librería**, su rama
iOS, esperando la cadena de protocolo. Lo que falta es el adapter y el cableado, no el paquete.

### 1.4 ✅ Podemos probar BLE end-to-end SIN ningún bastón comercial

El emulador ESP32 tiene `MODO_GATT` con **Nordic UART** (`NUS_SERVICE_UUID 6E400001-…`, TX notify
`…0003`, RX write `…0002`), los mismos UUIDs de ADR-003. El propio fuente nombra al consumidor:
*"tercer transporte del multivendor (**adapter-ble-gatt, futuro**)"*. Y notifica la trama **partida en
trozos** → ejercita el reensamblado, que es justo donde el SPP se rompió.

### 1.5 ⚠️ `react-native-ble-plx` NO está instalado

No hay ningún adapter GATT hoy (`manual`, `mock`, `simulator`, `hid-wedge`, `web-serial`, `spp-android`).
La dep es nueva → **cambia el fingerprint** → hace falta build de iOS **y** de Android.

---

## 2. La corrección que más importa: qué pedirle a cada fabricante

El pedido dice *"la key de Allflex y Gallagher"*. **Gallagher no tiene ninguna key que dar.**

| Fabricante | Modelo que sirve en iOS | Qué hace falta | Qué NO hace falta |
|---|---|---|---|
| **Gallagher** | **HR5 v3** (BLE) | **UUIDs de servicio/característica + formato de trama** (o su doc de integración) | ❌ **NADA de MFi**: BLE no lleva licencia ni acuerdo |
| **Allflex** | RS420 (SPP + iAP) | **Cadena de protocolo iAP** (`com.allflex.…`) + **licencia MFi** | — |
| **Datamars** (Tru-Test) | SRS2i / XRS2i | Cadena de protocolo iAP + licencia MFi | — |

Tres consecuencias:

1. **A Gallagher hay que pedirle documentación técnica, no una licencia.** Es un pedido mucho más fácil y
   no depende de ningún trámite con Apple.
2. El HR4 y el HR5 estándar son **Bluetooth clásico sin MFi**: no van a andar en iPhone con ninguna app,
   nunca. Pedir una key para esos es plata y tiempo tirados.
3. **Datamars es un tercer interlocutor** que el pedido no menciona y que cubre dos de los cuatro modelos
   iOS-capaces del relevamiento.

---

## 3. Riesgo que declaro y no escondo

**Hoy el adapter BLE tiene exactamente UN consumidor conocido en este mercado: el Gallagher HR5 v3, que
no tenemos.** Todo lo demás en iOS es MFi (bloqueado por trámite) o imposible (clásico sin chip).

Eso no lo vuelve inútil —el trabajo es real, el transporte es el mismo para cualquier BLE futuro, y el
emulador lo prueba— pero sí significa que **sale sin verificación contra hardware real**, igual que el SPP
antes del ESP32. La lección de `dad711f` es que un transporte "escrito y testeado" sin device tenía tres
🔴 de máquina de estados. Por eso el banco ESP32 en `MODO_GATT` es parte de la unidad, no un extra.

---

## 4. Alcance propuesto

**Decidido por el leader** (no va a Raf): el adapter BLE se hace **cross-platform**, no iOS-only.
`react-native-ble-plx` corre en los dos sistemas, restringirlo a iOS sería trabajo extra para tener menos:
el HR5 v3 andaría también en Android, que es donde está el productor argentino.

**Entra:**

1. **T1 — Pagar la deuda del driver** (§1.1): que `contract.ts` resuelva el parser por `driver-registry` en
   vez de llamar `parseRs420Line`. Con guard que ponga en rojo a cualquier parser hardcodeado nuevo.
2. **T2 — `adapter-ble-gatt.ts`** sobre `react-native-ble-plx`, implementando el contrato `stick-adapter`
   existente: scan filtrado por servicio → connect → subscribe a la característica de notify →
   **reensamblado de trama partida** → `contract.ts`. Con las lecciones del SPP ya escritas: techo a la
   cadena sin gesto, `connectInFlight` con timeout, y desconexión por **fuente propia** (no un evento
   global).
3. **T3 — `adapter-mfi-ios.ts`** sobre la rama iOS de `react-native-bluetooth-classic` (§1.3), **gateado
   por la lista de protocolos**: con `UISupportedExternalAccessoryProtocols: []` el adapter reporta
   "no disponible" y **no toca el framework**. El día que llegue la cadena, se agrega al config y el
   adapter queda vivo sin tocar código.
4. **T4 — Selección y prioridad por plataforma** (`adapter-selection.ts` / `selection-priority.ts`): en
   iOS el orden pasa a ser `mfi (si hay protocolo) → ble-gatt → manual`; `spp-android` no se ofrece.
5. **T5 — Banco**: escenarios del ESP32 en `MODO_GATT` (los mismos del `MODO_SPP`: dedup, 20 animales,
   malformadas, trama partida, dos pegadas, reconexión, corte en background).
6. **T6 — Reconciliación** de ADR-024, `requirements-multivendor.md` y el relevamiento.

**No entra** (y lo digo para que no se lea como olvido):

- ~~**El camino HID** (`adapter-hid-wedge`, R8)~~ → **REVERTIDO por Raf en la Puerta 1: ENTRA como T7.**
  Ver §7. El motivo original para dejarlo afuera (un solo candidato, el Gallagher HR0, sin confirmar del
  fabricante) **sigue en pie y no se resuelve con esta unidad** — lo que cambió es que ahora se puede
  correr el gate físico, que es una incógnita distinta.
- **La cadena de protocolo real** de cualquier fabricante: es gestión comercial, no código.

---

## 5. Lo que hace falta para verificar, y de quién depende

| Qué | De quién | Bloquea |
|---|---|---|
| Build de **iOS** (EAS — la dep nueva cambia el fingerprint) | **OK explícito de Raf**, por plataforma | La verificación en iPhone de T2/T3/T4 |
| Build de **Android** (local con Gradle, 0 EAS) | nadie — lo hago yo | La verificación cross-platform de T2 |
| Un **HR5 v3** en la mano | mercado / Gallagher | Que T2 salga verificado contra hardware real y no solo contra el emulador |
| Cadena de protocolo **iAP** de Allflex/Datamars | trámite MFi (Facundo) | Que T3 pase de "prearmado" a "andando" |

---

## 6. Preguntas abiertas de esta refinación

1. **¿Hay un iPhone disponible para device-test en esta tanda?** Sin él, T2/T3/T4 salen verdes solo en
   unit + emulador, y ya sabemos qué vale eso en un transporte.
2. **¿El HR0 tiene modo HID?** No bloquea esta unidad (el HID quedó afuera), pero si la respuesta es sí,
   cambia la prioridad de lo que viene después: sería el camino iOS más barato del mercado.

---

## 7. Decisiones de Raf en la Puerta 1 (2026-08-15)

1. **El camino HID ENTRA a la unidad** (era "no entra" en §4).
2. **Hay iPhone** para device-test. El OK del build de EAS iOS se decide después, cuando el código esté
   verde en unit + emulador.

### T7 — Camino HID, y por qué arranca por el GATE y no por el adapter

`adapter-hid-wedge.ts` **no es código a completar**: son **22 líneas de placeholder sin lógica activa**,
gateadas a propósito. Su cabecera lo dice: *"el Council fue enfático: **no fijar arquitectura sobre un
mecanismo no ejecutado en hardware real**"*. El gate (R8.7) exige validar **en iPhone real**:

- (a) que tipee los **15 dígitos completos**,
- (b) que emita el **terminador Enter**,
- (c) que la **supresión del teclado en pantalla** de iOS no rompa la UX de manga,
- (d) que un **TextInput de RN con foco programático** capture confiable.

**Lo nuevo es que el gate ya se puede correr.** El ESP32 en `MODO_HID` es un **teclado BLE HID** y fue
construido para esto — el comentario del fuente dice *"levanta el gate de `adapter-hid-wedge.ts`"*. Trae
los knobs exactos que el gate necesita: `hidterm enter|tab|none`, `hiddelay <ms>`, `hidraw on|off`.

**Secuencia obligatoria de T7** (invertirla sería cometer justo lo que la cabecera advierte):

1. **T7.0 — CORRER EL GATE** con el ESP32 en `MODO_HID` emparejado al iPhone, contra un `TextInput` real
   de la app. Registrar (a)(b)(c)(d) con evidencia.
2. **T7.1 — Recién ahí**, implementar el adapter detrás de la MISMA interfaz `StickAdapter`, sin tocar el
   contrato (R10.3 / R11.3), con la captura de keystrokes + terminador que el gate haya validado.
3. Si el gate **falla** en (c) o (d), el adapter **no se escribe**: se documenta el resultado y el camino
   HID se cierra con evidencia en vez de con una suposición.

⚠️ **Lo que el gate NO prueba**: que el **Gallagher HR0** haga HID. Eso sigue sin confirmar del
fabricante (ítem 1 de "qué falta" del relevamiento). El ESP32 valida el **lado del teléfono** —que es
(a)(b)(c)(d)—, no que exista un bastón comercial con el que hablar. Son dos incógnitas distintas y no hay
que dejar que el verde de una tape a la otra.

💡 **Posible atajo sin gastar un build**: si el iPhone ya tiene una build instalada con el campo de
"caravana a mano" (`/maniobra/identificar`), el gate se puede correr **contra esa build**, emparejando el
ESP32 como teclado. Verificar primero qué build tiene el iPhone.
