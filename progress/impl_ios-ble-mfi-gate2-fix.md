# Fix-loop del Gate 2 — delta `ios-ble-mfi` (feature 04)

baseline_commit: 2efda44c7c90d08fdc9760a90b0f0c5a81f0748c

**Entrada**: `progress/security_code_04-ios-ble-mfi.md` → **FAIL** (1 HIGH + 1 MEDIUM).
**Alcance ejecutado**: SOLO HIGH-1 y MEDIUM-2. No se empezó F6 ni F7. **No se commiteó.**
**Estado**: los dos findings cerrados, con falsificación por mutantes. Quedan **dos hallazgos nuevos para
el leader** (§7), ninguno bloqueante y ninguno dentro del alcance autorizado.

## 1. Tasks (todas cerradas)

- [x] **T1** — Tope al buffer del `LineFramer`, fail-closed con evento distinguible + resync tras el descarte.
- [x] **T2** — El adapter BLE GATT distingue "llegan BYTES" de "llegan LÍNEAS"; el estado de salud deja de
      resetearse con basura y la causa nueva tiene evento propio.
- [x] **T3** — `line-framer.test.ts` (no existía): 12 tests, con el caso legítimo primero.
- [x] **T4** — MEDIUM-2: fuera el identificador de dispositivos ajenos del log + `device_id` al scrubber.
- [x] **T5** — `line-framer.test.ts` registrado en `scripts/run-tests.mjs` + verificación + reconciliación
      de specs (RBM2.19, RBM3.12 y las notas bajo RBM2.8 / RBM3.10 / RBM5.13).

## 2. HIGH-1 — cómo quedó

### 2.1 El tope (`app/src/services/ble/line-framer.ts`)

`LINE_FRAMER_MAX_BUFFER = 4096` caracteres (~117× la trama legítima más larga conocida: los 35 del RS420).
Entra por constructor **pero no se puede apagar**: cualquier valor que no sea un número finito ≥ 1 —incluidos
`0` e `Infinity`— cae al default. Un invariante que un call site puede desactivar pasando un número no es un
invariante: es una opción, y una opción se elige mal exactamente una vez.

Al pasarse: se descarta **todo** lo acumulado (no un truncado parcial, que pegaría una cabeza vieja con una
cola nueva), se marca `resyncing` y se emite el log. El descarte va **después** de cortar las líneas del
chunk: lo que sí cerró trama es bueno y se entrega igual.

**El resync es parte del fix, no un extra.** Del pedazo que sigue llegando no conocemos el principio, así que
la primera línea que cierre después del descarte **no se emite** (y `flush()` post-descarte devuelve `null`).
Con el RS420 de hoy una trama recortada da `null` (el regex está anclado con largos fijos), pero el delta
entero existe para que entren parsers de OTROS fabricantes (RBM1.1/RBM1.6) y uno que **busque** el EID en vez
de anclarlo podría extraer un EID que nadie leyó. Un EID inventado es lo único verdaderamente inaceptable de
este camino (RBM1.8).

### 2.2 El evento: distinguible, y por qué NO es un `kind` nuevo del union

Sale como **sub-evento por mensaje** de `read_loop_error`:
`ble_framer_overflow: descartados N de tope M`. Es la forma que ya usan `ble_decode_failed`,
`ble_monitor_lost`, `ble_scan_error` y `liveness_probe_unavailable` **en este mismo transporte**: una entrada
que llega y se descarta es exactamente la familia de `ble_decode_failed`.

El analyzer recomendó "un kind propio". **Se probó y se descartó por una medición**, no por gusto — el motivo
completo está en §7.1: agregar **dos líneas** al union de `ble/logging.ts` pone en **rojo a 9 guards** que no
tienen nada que ver con esta unidad. Lo que el finding pedía —*"un evento de log distinguible (no un
`connected_silent`, no un descarte mudo)"*— se cumple: prefijo propio, greppable, con el tamaño y el tope
adentro, y el test exige las **dos** mitades (kind + prefijo) para que un `read_loop_error` cualquiera no lo
satisfaga.

### 2.3 Que el chorro sea DETECTABLE (`adapter-ble-gatt.ts`)

Dos relojes donde había uno:

- `lastLineAt` — se mueve con la **trama cerrada**. Es el reloj de **salud** del link y el que mira el
  watchdog. Se actualiza **fuera** del gate de `listening` a propósito: que la trama cierre es salud del
  transporte, no ingesta — si dependiera de la escucha, un link sano con la app en otra pantalla se
  reportaría mudo.
- `lastByteAt` — se mueve con cualquier byte. No decide nada; solo permite nombrar la causa.

El watchdog distingue **tres** causas donde antes había dos:

| Situación | Antes | Ahora |
|---|---|---|
| Nadie bastonea | `connected_silent {ms}` | `connected_silent {ms}` — **igual** (RBM3.10 no cambia) |
| Entran bytes y ninguno cierra trama | **NADA** (el reloj lo reseteaba la propia basura) | `ble_stream_unframed: bytes hace X ms, sin cerrar trama hace Y ms` |
| El socket murió | `liveness_lost` | `liveness_lost` — igual |

**El discriminador es la VENTANA**, no la comparación entre los dos relojes: "entró un byte DENTRO del
presupuesto de silencio". `bytesMs < silentMs` parece equivalente y no lo es — una trama que queda a medias en
un momento benigno (el operario sacó el bastón de rango a mitad de un bastonazo) deja el reloj del byte
adelante **para siempre**, y el link mudo se reportaría "con basura" en todos los polls siguientes: un
diagnóstico falso, que es peor que ninguno. Lo cazó la autorrevisión (§6) y tiene test y mutante propios.

`adapter-spp-android.ts` y `adapter-mfi-ios.ts` **no se tocaron**: ahí el framing lo hace el nativo y
`splitSppPayload` no acumula, así que byte y trama son el mismo evento y no hay nada que distinguir.

### 2.4 El costo cuadrático que nombró el analyzer — MEDIDO, no razonado

Con 25.000 notificaciones de 20 bytes (500 KB de chorro sin un solo fin de trama):

| Variante | Tiempo |
|---|---|
| **as-built (con tope)** | **4-6 ms** |
| sin tope, con la búsqueda optimizada | 2196 ms |
| sin tope y sin optimizar (el HIGH-1 tal cual) | 2450 ms |
| **sin la optimización pero CON tope** | **4 ms** |

Dos conclusiones que cambiaron el diseño:

1. **Lo que mantiene el costo lineal es EL TOPE, y nada más.** La parte cuadrática no es el barrido: es el
   **re-aplanado** del buffer que crece (el `indexOf` necesita la cadena plana en cada notificación).
2. **La optimización que había escrito primero —arrancar el `indexOf` en el solape en vez de en 0— se
   DESCARTÓ**: dentro del tope no mueve el número (4 ms vs 6 ms, ruido) y agrega el riesgo de partir mal un
   fin de trama de dos caracteres que cae entre dos notificaciones. No se paga riesgo de framing por una
   mejora de cero. El `push()` quedó **idéntico al original salvo el bloque del tope y el resync**, que es
   además el diff más chico de revisar.

El test de costo quedó con presupuesto **500 ms** (≈50× lo medido): separa el orden de magnitud (4 ms vs
2200 ms) sin flakear.

## 3. MEDIUM-2 — cómo quedó

`ble_device_not_recognized: ${device.id}` → `ble_device_not_recognized: #${seen.size} del escaneo`.

El ordinal responde la misma pregunta que el finding reconoce como valor diagnóstico ("vi N dispositivos y
ninguno era un bastón") **sin mandar el identificador de un tercero** —en Android, su MAC— a un vendor de
telemetría. Es la preferencia que pediste: no mandar el identificador crudo. Tampoco hasheado: un hash corto
de una MAC es reversible por fuerza bruta dentro de un OUI, así que no habría cerrado nada; el contador sí.

Defensa en profundidad, **no** la defensa principal: `device_id` entró a `PII_KEYS_RAW` de
`observability/redact.ts`. `normalizeKey` lo colapsa, así que cubre `deviceId` / `device_id` / `deviceid` —o
sea el `connect_superseded { deviceId }` de los tres adapters, que **sí** es un campo con clave y por lo tanto
alcanzable por un scrubber key-based. Queda un test que **documenta por comportamiento** que ese scrubber no
puede tocar un identificador interpolado en un `message`: es la razón escrita de por qué el arreglo de fondo
tuvo que ser sacarlo del texto.

## 4. Trazabilidad `R<n>` → archivo:test

| Requisito | Test que lo cubre |
|---|---|
| **RBM2.19** (tope + fail-closed con log + resync) | `app/src/services/ble/line-framer.test.ts` → `un chorro SIN fin de trama no hace crecer el buffer sin límite` · `el descarte se DICE, con su prefijo propio y con el tamaño` · `después del descarte el framer SIGUE leyendo, y la trama SIN CABEZA no se ingiere` · `flush() después de un descarte NO devuelve el fragmento sin cabeza` · `reset() limpia el buffer Y el estado de resync` · `el tope NO es opcional` · `25.000 notificaciones … dentro del presupuesto` |
| **RBM2.19** (cableado real en el transporte) | `app/src/services/ble/adapter-ble-gatt.test.ts` → `un chorro sostenido SIN fin de trama se descarta con log y el transporte SIGUE leyendo` |
| **RBM2.8/2.9/2.12** (el caso legítimo, que el tope no puede romper) | `line-framer.test.ts` → `la trama partida en notificaciones de 20 bytes se reensambla en UNA lectura` · `una trama partida de a UN carácter` · `una RÁFAGA legítima de 500 tramas NO se acerca al tope` · `un fin de trama de DOS caracteres (CR+LF) partido entre dos chunks` |
| **RBM3.12** (salud por trama, no por byte) | `adapter-ble-gatt.test.ts` → `los bytes que NO cierran trama dejan de esconderse detrás del reloj de salud` · `una trama que quedó A MEDIAS hace rato NO convierte la mudez en "entra basura"` |
| **RBM3.10** (no cambia) | `adapter-ble-gatt.test.ts` → `conectado y MUDO queda escrito (connected_silent) y NO se desconecta` (intacto, sigue verde) |
| **RBM5.13** (MEDIUM-2: sin identificador ajeno) | `adapter-ble-gatt.test.ts` → `un device que anuncia el MISMO servicio pero NO lo reconoce el driver no se conecta` · `el escaneo NO se auto-sella` (las dos exigen ahora que el id **no** esté en ninguna línea de log) |
| **MEDIUM-2** (scrubber, defensa en profundidad) | `app/src/services/observability/redact.test.ts` → `el id de dispositivo Bluetooth se redacta en el breadcrumb` · `el scrubber por CLAVES no alcanza un id interpolado en un texto` |

## 5. Falsificación — 9 mutantes, todos MUEREN

Corridos con un script propio (`scratchpad/mutantes2.mjs` y `mutantes3.mjs`), con **backup de nombre único
mío** fuera del repo y verificación byte a byte de que el árbol volvió a quedar igual a **mi** backup. Control
positivo (sin mutar) en verde en la misma corrida.

| # | Mutante | Test(s) que caen |
|---|---|---|
| M1 | borrar el bloque del tope | los 5 del tope + el presupuesto de costo (2200 ms vs 500) |
| M2 | descartar **sin** loguear (truncado mudo) | `el descarte se DICE…` + 2 más |
| M3 | que `maxBufferChars = 0` signifique "sin tope" | `el tope NO es opcional` |
| M4 | emitir la línea sin cabeza (sin resync) | `la trama SIN CABEZA no se ingiere` |
| M5 | quitar el tope ante la carga del test de costo | `25.000 notificaciones … presupuesto` |
| M6 | no consumir el delimitador COMPLETO | los 2 del fin de trama multi-carácter |
| M7 | el reloj de salud lo mueve el BYTE (**el bug original**) | `los bytes que NO cierran trama…` |
| M8 | devolver `device.id` al mensaje del no-reconocido | los 2 de MEDIUM-2 |
| M9 | discriminar `bytesMs < silentMs` en vez de por la ventana | `una trama que quedó A MEDIAS…` |
| M10 | tragarse las dos causas en `connected_silent` | `los bytes que NO cierran trama…` |

(M5 y M1 son el mismo cambio medido contra oráculos distintos; se listan separados porque el segundo es el
único que mide el COSTO.)

## 6. Autorrevisión adversarial

Qué busqué y qué encontré, en orden:

1. **Que el tope rompiera el caso legítimo.** El framer existe para reensamblar una trama partida en
   notificaciones de 20 bytes: si el tope se paga con eso, el arreglo es peor que el bug. Cubierto con cuatro
   tests del camino feliz **antes** de los del tope (incluida una ráfaga de 500 tramas pegadas, que es el
   malentendido natural del tope: no acota "cuántas lecturas entran juntas", porque lo pendiente es solo el
   pedazo que todavía no cerró).
2. **Que el framer quedara envenenado después de descartar.** Sería un modo de falla nuevo: el operario
   tendría que reconectar el bastón y nadie le diría por qué. Test explícito de recuperación + `reset()` +
   `flush()`.
3. **Que la trama recortada se ingiriera.** El peor desenlace posible del descarte no es perder una lectura:
   es **inventar un EID**. Cerrado con el resync (§2.1) y su mutante M4.
4. **El discriminador del watchdog — ENCONTRADO Y CORREGIDO.** Mi primera versión comparaba los dos relojes
   (`bytesMs < silentMs`). Es un diagnóstico falso permanente cuando una trama queda a medias en un momento
   benigno. Se cambió a la ventana de silencio, que además se autocorrige en el poll siguiente, y se agregó
   el test + los mutantes M9/M10.
5. **El costo: medido en vez de razonado — ENCONTRADO Y CORREGIDO.** Mi optimización del barrido no movía el
   número (era el re-aplanado, no el `indexOf`) y agregaba riesgo de framing: se **descartó** (§2.4). También
   por eso el presupuesto del test bajó de 2000 ms —que quedaba a 200 ms del mutante— a 500 ms.
6. **Tests que pasan por la razón equivocada — ENCONTRADO Y CORREGIDO.** Tres tests comparaban el valor de
   `withLogs()` (que devuelve los **eventos**) contra las **líneas** esperadas. Daban rojo, no verde, pero la
   misma confusión al revés es un verde mentiroso: se agregó el helper `pushed()` que devuelve las dos cosas.
7. **Multi-tenant / offline-first / red.** El diff no toca red, ni Supabase, ni PowerSync, ni
   `establishment_id`: es transporte local. El invariante que sí estaba en juego es **manual-first** (R7.2 /
   RBM9.5) y está aserido: el descarte no desconecta y el estado sigue `connected`.
8. **Fail-closed.** Los tres caminos nuevos caen del lado cerrado: el buffer se descarta (no se ingiere), la
   línea sin cabeza se descarta (no se parsea), y un `maxBufferChars` inválido cae al default (no a "sin
   tope").

## 7. Hallazgos NUEVOS para el leader (fuera del alcance autorizado, ninguno bloqueante)

### 7.1 🟠 `ble/logging.ts` está a DOS LÍNEAS de poner en rojo a 9 guards, y no es culpa de este fix

Medido, no deducido. El meta-guard compartido `assertScanCoverage` (`app/src/utils/scan-coverage.ts`) exige
que un archivo de **≥ 150 líneas no vacías** conserve **≥ 25%** después de blanquear comentarios. Hoy:

```
ble/logging.ts   148 líneas no vacías → 34 de código   (retención 0.230)
```

O sea que **ya está por debajo del piso** y lo único que lo salva es estar **2 líneas** abajo del umbral de
tamaño. **Medido** (agregando al union dos miembros de una línea y SIN un solo comentario, que es el caso
mínimo: el archivo queda en exactamente 150 líneas no vacías): caen **9 de los 10** guards que corren esa
auto-verificación — `keyboard-avoiding`, `sheet-keyboard-dismiss`, `worklet-callbacks`,
`stick-status-surface`, `storage-keys`, `brand-name`, `safe-bottom-inset`, `tap-target-collision` y
`today-iso` —, todos con el mismo mensaje: *"el blanqueo se está comiendo `src/services/ble/logging.ts`"*.
El único que se salva es `phone-field`, porque su raíz de escaneo no llega a ese archivo. Nada de eso tiene que ver con la
unidad que hizo el cambio, y el diagnóstico queda a nueve guards de distancia del síntoma (es literalmente el
incidente del 2026-08-06 que documenta `tap-target-collision-guard.test.ts`).

**No es un falso positivo del blanqueador**: el stripper funciona bien. El archivo es un **catálogo de eventos
de diagnóstico donde el artefacto ES la prosa** (cada evento existe para que un síntoma en logcat se
distinga de otro). Es el caso que la propia `allow` de `scan-coverage.ts` describe —*"un fuente raro que no
puede bloquear la suite entera sin salida"*— y que hoy está vacía (*"Hoy: ninguno"*).

**Por qué no lo arreglé**: las dos salidas son decisiones de política, no de implementación, y ninguna entra
en "solo HIGH-1 y MEDIUM-2": (a) purgar ~15 líneas de prosa de otras unidades en ese archivo, o (b) estrenar
la allowlist del meta-guard —los 9 guards usan el mismo `label` (`relative(APP_ROOT, f)` con `/`), así que
alcanzaría **una** entrada compartida en `scan-coverage.ts` con su motivo escrito—. Recomiendo (b). Mientras
no se decida, **el union de `TransportLogEvent` no puede crecer**, y eso conviene saberlo antes de que lo
descubra la próxima feature en un rojo de 9 guards.

### 7.2 🟠 La MAC de NUESTRO bastón sí llega a los breadcrumbs, por el `message` de `BleError`

Verificado en el fuente instalado, no supuesto —`app/node_modules/react-native-ble-plx/src/BleError.js:282`
en adelante—: los mensajes de la librería se arman interpolando el id del dispositivo.

```js
[BleErrorCode.DeviceDisconnected]:      'Device {deviceID} was disconnected',
[BleErrorCode.DeviceConnectionFailed]:  'Device {deviceID} connection failed',
[BleErrorCode.DeviceNotFound]:          'Device {deviceID} not found',
[BleErrorCode.ServicesDiscoveryFailed]: 'Services discovery failed for device {deviceID}',
```

`errorMessage(e)` devuelve `e.message` tal cual (`adapter-ble-gatt.ts:381`) y ese string se interpola en
`ble_disconnected: …`, `ble_monitor_lost: …`, `ble_scan_error: …` y en `logBridgeFailure`. Es **la misma clase
que MEDIUM-2** —identificador en free-text, donde el scrubber key-based no llega— con dos diferencias que
bajan la severidad: el dispositivo es **el nuestro** (no el de un tercero) y la forma es preexistente (el SPP
hace lo mismo desde antes del baseline), aunque el emisor `ble-plx` sí es nuevo de este delta.

**No lo toqué** porque el arreglo obliga a elegir entre diagnóstico y privacidad y eso no me corresponde acá:
(a) redactar el patrón MAC en `errorMessage` deja los UUID de servicio/característica intactos pero **no**
cubre el id de iOS (que es un UUID y es indistinguible de los otros por regex); (b) preferir
`errorCode:<n>` cuando el error trae `deviceID` no pierde información (los códigos mapean 1:1 con las
plantillas de arriba) pero degrada la legibilidad del log. Recomiendo (b) y que entre como su propio
fix-loop, junto con el mismo barrido sobre `adapter-spp-android` y `adapter-mfi-ios`.

## 8. Reconciliación de specs (hecha, no pendiente)

- `requirements-ios-ble-mfi.md`: **RBM2.19** (tope + fail-closed + resync) y **RBM3.12** (salud por trama +
  `ble_stream_unframed`) nuevos, cada uno con su nota de as-built, la medición del costo y lo que se
  descartó. Notas de reconciliación bajo **RBM2.8** (la frase *"el buffer creciendo para siempre"* ahora está
  acotada), **RBM3.10** (se cumple literal y sin cambios; el caso que faltaba se fue a RBM3.12) y **RBM5.13**
  (MEDIUM-2). No se reescribió ningún EARS existente — patrón `impl_13`.
- `design-ios-ble-mfi.md`: **§4.1** con el as-built del fix (los pasos 8 y 10 del flujo, el escaneo, y las dos
  decisiones de forma con su motivo medible).
- `tasks-ios-ble-mfi.md`: fase **F5-fix** con TF.1–TF.8 en `[x]` + el mapa `RBM<n> → task` actualizado.

## 9. Verificación

Corrido con el runner directo del proyecto (como el analyzer; `check.mjs` levanta las 16 suites contra la DB
DEV **compartida** con la otra terminal y este diff no toca backend):

| Stage | Resultado |
|---|---|
| `pnpm typecheck` (app) | ✅ |
| `client unit tests` (la lista explícita completa de `run-tests.mjs`) | ✅ **3467 / 3467** |
| `scripts unit tests` (incluye el guard estático de `run-tests.mjs`) | ✅ 77 / 77 |
| `serve-log` + `request-headers` (rebrand fase 5) + `audit_query` × 2 | ✅ 63 / 63 |
| Mutantes | ✅ 9 / 9 mueren, control positivo verde, árbol restaurado |

- **Gate 2.5 / capturas (ADR-029): N/A.** El fix es del transporte y del logging; no toca ninguna pantalla,
  componente, sheet ni copy. `pnpm e2e` tampoco se corrió: no hay superficie de UI en el diff y una corrida
  re-renderiza 40+ `design/**/*.png` con diffs espurios.
- **Archivos de la otra terminal: no tocados.** `feature_list.json`, `progress/current.md`, `supabase/`,
  `sync-streams/`, spec 09, spec 24, `scripts/check.mjs` y `scripts/lib/stage-runner.mjs` están intactos
  (`git status --porcelain --untracked-files=all` cruzado). De `scripts/run-tests.mjs` —compartido— se tocó
  **solo** el bloque de tests del cliente, y se verificó que el stage de **rebrand fase 5**
  (`request-headers rename guard`) y el de `stage-runner` siguieran intactos y en verde.
- **Sin churn de CRLF**: `git diff --stat` y `git diff -w --stat` dan idéntico.

## 10. Diff (11 archivos, ninguno backend)

```
app/src/services/ble/line-framer.ts             +106 / -4     tope + resync + el porqué
app/src/services/ble/line-framer.test.ts        NUEVO (12 tests)
app/src/services/ble/adapter-ble-gatt.ts        +68 / -12     dos relojes, watchdog, MEDIUM-2
app/src/services/ble/adapter-ble-gatt.test.ts   +132 / -4     3 tests nuevos + MEDIUM-2 dado vuelta
app/src/services/observability/redact.ts        +10           `device_id` en PII_KEYS_RAW
app/src/services/observability/redact.test.ts   +32           2 tests
scripts/run-tests.mjs                           +16 / -1      registro + el porqué
specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md   reconciliación
```
