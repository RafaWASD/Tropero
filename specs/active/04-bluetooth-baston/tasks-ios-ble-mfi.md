# Spec 04 — DELTA «iOS BLE real + MFi prearmado» — Tasks

**Status**: `spec_ready` (delta-spec ADR-028 Nivel B — mini-ciclo propio; **NO reabre el core aprobado de spec 04, ni toca su `tasks.md` original, ni el `tasks-multivendor.md`**).
**Fecha**: 2026-08-17.
**Fuente**: `requirements-ios-ble-mfi.md` (`RBM`) + `design-ios-ble-mfi.md`. Cada `RBM<n>` mapea a ≥1 task; cada task referencia ≥1 `RBM<n>`.

> **Reglas** (`docs/specs.md`): pasos discretos en orden, cada uno con `[ ]` + los `RBM<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificación documentada.

## Orden de despacho para el leader

El orden **no es una preferencia**: cada fase existe donde está porque la anterior cambia lo que hay que escribir.

| Fase | Qué | Cuesta un build de EAS | Depende de |
|---|---|---|---|
| **F0 — GATE HID** | Correr el gate físico R8.7 con el ESP32 en `MODO_HID` contra el iPhone | ❌ **NO** — corre contra la build ya instalada | nada. **Es lo primero ejecutable de toda la unidad** |
| **F1 — T1** | El parser sale del registro de drivers | ❌ no | nada (puro) |
| **F2 — dep + veto** | Vetar e instalar `react-native-ble-plx`, config, censo, permisos | Android local (0 EAS) | F1 |
| **F3 — T2** | `adapter-ble-gatt` + las lecciones del SPP | ❌ (código + unit) | F1, F2 |
| **F4 — T4** | Selección, prioridad iOS, transporte por bastón recordado, UI | ❌ | F3 |
| **F5 — T3** | `adapter-mfi-ios` gateado por la lista de protocolos | ❌ | F4 |
| **F6 — T5** | Banco del emulador en `MODO_GATT`, en device | Android local; **iOS = OK explícito de Raf** | F3, F4 |
| **F7 — T7.1** | El adapter HID — **solo si F0 dio verde** | ❌ | F0 (verde), F4 |
| **F8 — T6 + cierre** | Reconciliación, Gate 1 N/A verificado, Gate 2, Gate 2.5 | — | todas |

> **Por qué F0 va antes que todo**: el gate decide si F7 existe, y **no cuesta nada** (RBM8.2). Correrlo último sería pagar el orden que la cabecera de `adapter-hid-wedge.ts` prohíbe, y encima sin motivo de calendario.

---

## Fase F0 — EL GATE FÍSICO DEL HID (primero, sin build)

> El ESP32 en `MODO_HID` es un teclado BLE HID construido exactamente para esto. Se corre contra la build de **TestFlight del 2026-08-11** (perfil `testflight-dev`, commit `0273c43`) ya instalada en el iPhone, sobre el campo de carga manual de `/maniobra/identificar` (`testID="manual-entry-input"`, a11y `"Número o caravana visual"`), al que se llega por *"Sin chip, ingresá la caravana a mano"*.

- [ ] **T7.0.1** — Preparar el banco: flashear el ESP32 con `-DEMU_MODE=MODO_HID`, verificar con `selftest` + `status` que emite el EID esperado, y **emparejarlo con el iPhone como teclado** desde los ajustes de iOS. Confirmar que la build instalada es `0273c43` antes de medir (si no lo es, **parar y reportar**: el oráculo depende de las props de ese campo). Cubre: RBM8.2, RBM8.3.
- [ ] **T7.0.2** — Anotar **antes de medir** las props del `TextInput` de producción que forman parte del oráculo: `maxLength = SEARCH_TERM_MAX_LENGTH`, `autoCapitalize="characters"`, `autoCorrect={false}`, `returnKeyType="search"`, `onSubmitEditing` → búsqueda, sin `keyboardType`. Sin esta lista, un fallo no se puede atribuir. Cubre: RBM8.6.
- [ ] **T7.0.3** — **(a) 15 dígitos completos**: `read 1` con `hiddelay` en 12 ms (default), 5 ms y 40 ms; comparar el contenido del campo **carácter por carácter** contra el EID del `status` del emulador. Cubre: RBM8.1(a), RBM8.3.
- [ ] **T7.0.4** — **(b) terminador**: `hidterm enter` / `tab` / `none`; registrar cuál dispara `onSubmitEditing` (se observa porque **busca**) y cuál no. Es lo que le dice al adapter qué terminador soportar. Cubre: RBM8.1(b), RBM8.3.
- [ ] **T7.0.5** — **(c) supresión del teclado en pantalla**: con el teclado BT emparejado, abrir el campo y **capturar pantalla**; evaluar barra de sugerencias, espacio muerto, alcance del CTA con una mano y si el layout de manga se rompe. Impresión sin captura no cuenta. Cubre: RBM8.1(c).
- [ ] **T7.0.6** — **(d) captura confiable con foco programático**: 20 lecturas seguidas, incluyendo una ida y vuelta a background y una rotación; exigir 20/20 completas, sin caracteres perdidos ni intercalados. Cubre: RBM8.1(d).
- [ ] **T7.0.7** — Extra informativo: `hidraw on` → ¿el wedge puede tipear la trama completa (con `STX`)? Informa RBM8.8; **no** decide el gate. Cubre: RBM8.8.
- [ ] **T7.0.8** — **Escribir el veredicto** en `progress/` con la evidencia (capturas + logs del emulador + conteos), y clasificarlo en **uno** de los tres desenlaces: (1) verde → habilita F7; (2) falla en (c)/(d) por comportamiento de iOS → el camino HID **se cierra con evidencia** y F7 **no se ejecuta**; (3) falla por una **prop del `TextInput`** → desenlace distinto, la consecuencia es ajustar el campo de scan y re-correr, **no** cerrar el camino. Cubre: RBM8.0, RBM8.4, RBM8.5, RBM8.6.
- [ ] **T7.0.9** — En la **primera línea** del veredicto, declarar lo que el gate **no** prueba: que exista un bastón comercial con modo HID (el Gallagher HR0 sigue sin confirmar del fabricante). Cubre: RBM8.7.

## Fase F1 — T1: el parser sale del registro de drivers (puro, sin device)

> **Estado F1: IMPLEMENTADA** (2026-08-17). Informe: `progress/impl_ios-ble-mfi-f1.md` (as-built, tabla de mutantes,
> trazabilidad `RBM<n>` → test). Las notas de reconciliación al as-built van marcadas abajo con **(as-built)**.

- [x] **T1.1** — `stick-adapter.ts`: agregar `readonly driver?: ReaderDriver` — **aditivo y opcional**, sin tocar ningún método (mismo precedente que `autoConnect?()`). Cubre: RBM1.3.
- [x] **T1.2** — `contract.ts`: `ingestRawLine(line, frameParser)` y `EidIngestEngine.processRawLine(line, frameParser, now?)` reciben el parser como **parámetro requerido**; **eliminar** el `import { parseRs420Line }`. `isValidTag`/`normalizeTag` se quedan (son del contrato, no de un fabricante). Cubre: RBM1.1, RBM1.2, RBM1.8.
  - **(as-built)** el `frameParser.parse(...)` va envuelto en `try/catch` y se valida la forma devuelta: el parser de un driver de tercero es código que no controlamos y el read-loop del transporte **no atrapa** (`SppAndroidAdapter.emitTag`), así que un throw suyo mataba la ingesta hasta reconectar.
  - **(as-built, fix del review 🟡-2)** el throw tiene motivo PROPIO: `RejectReason` += `'parser_threw'`, separado de `'parse_failed'`. "El DRIVER está roto" y "el LECTOR mandó basura" son dos causas con dos acciones distintas y producían un log byte-idéntico. La forma inesperada (`undefined`, objeto sin `eid`) **se queda en `parse_failed`**: en JS caerse del final de una función es la manera descuidada de escribir "no match"; un throw nunca lo es. `logging.ts` **importa** el `RejectReason` del contrato en vez de recopiar el union (con la copia, un motivo nuevo se perdía de un lado sin ponerse rojo).
- [x] **T1.3** — `adapter-selection.ts`: `resolveFrameParser(adapter)` puro, al lado de `ingestModeFor` (son las dos mitades de la misma decisión): modo `'eid'` → `null`; modo `'raw-line'` → `adapter.driver?.frameParser ?? null` (**fail-closed**, sin caída a RS420). Cubre: RBM1.4.
  - **(as-built)** firma final: `resolveFrameParser(adapter, onUnresolved)`. El sink del aviso del fail-closed entra **inyectado y requerido**, patrón `acceptingTargets(subscribers, onError)` de `read-dispatch.ts`. Motivo: es lo que deja la función PURA (T1.3) y al mismo tiempo hace que el "null + **log**" de T1.6 se verifique **por comportamiento** con un espía, en vez de por un regex sobre el provider. Requerido y no opcional-con-no-op: un call site que se olvide del sink perdería la única señal del fail-closed. Además, un `frameParser` presente pero sin `parse` **función** también cae del lado del descarte (un driver a medio escribir no puede tirar `parse is not a function` dentro del read-loop).
- [x] **T1.4** — `adapter-web-serial.ts` y `adapter-spp-android.ts`: construirse con `RS420_DRIVER` como driver por defecto y exponerlo por `driver` → comportamiento actual intacto. Cubre: RBM1.5.
  - **(as-built)** `SppAndroidAdapter` YA lo tenía (`private readonly driver = RS420_DRIVER`, RMV5.2): el cambio fue hacerlo **público de solo lectura**. `WebSerialAdapter` lo ganó como **segundo** parámetro del constructor (el `baudRate` queda primero → los call sites existentes no cambian).
- [x] **T1.5** — `BleStickListenerProvider.tsx`: el call site de `processRawLine` pasa `resolveFrameParser(transport)`; si es `null` con modo `raw-line`, **descarta y loguea**. `logging.ts` += `parser_unresolved`. Cubre: RBM1.1, RBM1.4.
  - **(as-built)** el parser se resuelve en el **efecto de wiring** (una vez por adaptador cableado, no por bastonazo) y viaja hasta el contrato en un `ReadSource {kind, mode, frameParser}`. **(fix del review 🔴-1)** `ReadSource` y `readSourceFor(adapter, onUnresolved)` **viven en `adapter-selection.ts`**, no en el provider: adentro del provider eran inverificables (importa `react-native` → ninguna suite `node:test` lo puede importar) y su único oráculo era un regex, que el reviewer esquivó con `?? DRIVER_REGISTRY[0].frameParser` dejando todo en verde. En la capa pura se ejercen por COMPORTAMIENTO (identidad del parser · `null` + aviso · silencio en los kinds `'eid'`). El provider solo **pide** su `ReadSource` y aporta el sink del log. No se resuelve dentro de `handleReading` porque el camino caliente tiene una tabla CERRADA de invocables (`HOT_PATH_CALLABLE`, `read-dispatch.test.ts`) y el parser no cambia entre lecturas. El evento quedó `{ kind:'parser_unresolved', adapter, at:'mount'|'read' }`: `mount` = se montó un transporte que no puede parsear nada; `read` = se descartó una lectura concreta (el que correlaciona con el bastonazo y hace diagnosticable el "bastoneo y no pasa nada"). El **mismo** camino se aplicó al harness `app/app/baston-test.tsx`, que era el segundo call site de `processRawLine` (lo enumeró el typecheck).
- [x] **T1.6** — `frame-parser-resolve.test.ts` (node:test): exhaustivo sobre `ADAPTER_KINDS` (todo kind `raw-line` sin driver → `null` + log; con driver → su parser; todo kind `eid` → `null` sin log). Cubre: RBM1.4.
  - **(as-built)** cada bucle exhaustivo trae su aserción **anti-vacuidad** (si ningún kind fuera `raw-line`, el `for` no probaría nada y el test pasaría igual).
- [x] **T1.7** — **Test de aditividad real** (el que hoy no puede pasar): un `ReaderDriver` sintético con un `frameParser` de **otro formato de trama**, en una copia del registry, ingerido de punta a punta sin tocar `contract.ts`/`stick-adapter.ts`/adaptadores. Cubre: RBM1.6.
  - **(as-built)** vive en `frame-parser-resolve.test.ts` (no en un archivo propio) para no sumar una suite que `run-tests.mjs` tendría que registrar aparte, y trae la **contraprueba de que los dos formatos son realmente distintos**: sin ella, un parser sintético que por casualidad entendiera la trama del RS420 dejaría el test verde aun con el parser hardcodeado de vuelta.
- [x] **T1.8** — **Guards + mutantes** (RBM1.7): (i) estático — `contract.ts` no importa ni menciona un parser de fabricante; (ii) `adapter-ingest-mode.test.ts` — el provider delega en `resolveFrameParser` y no llama `parseRs420Line`. **Falsificar los dos**: re-poner el import y la llamada inline → los dos en rojo; y dejar constancia de que T1.7 **por sí solo sigue en verde** con el bug puesto (por eso hacen falta los guards). Cubre: RBM1.7.
  - **(as-built)** 7 mutantes corridos, cada uno muerto por el guard que le corresponde (tabla completa en `progress/impl_ios-ble-mfi-f1.md`). Los dos que el task pedía: el import de vuelta en `contract.ts` → guard (i) 🔴, la llamada inline en el provider → guard (ii) 🔴 — y con ese segundo mutante puesto, **las 11 de `frame-parser-resolve.test.ts` (T1.7 incluido) quedan en VERDE**. El guard (i) se escribió **sobre la ausencia** derivando del árbol los exports de todo `parser-*.ts` (un `parseHr5Line` futuro cae sin actualizar nada), con allowlist explícita de `isValidTag`/`normalizeTag` y su **meta-test** de que el extractor no está ciego. El guard (ii) prohíbe además las dos formas "elegantes" de volver a fijar el fabricante (importar cualquier `parser-*`, o usar `RS420_DRIVER.frameParser`) y exige el log en sus **dos** momentos.
  - **(as-built, fix del review 🔴-1)** el guard (ii) **no alcanzaba**: prohibía tres GRAFÍAS y el mutante `?? DRIVER_REGISTRY[0].frameParser` pasaba en verde. Quedó así: (1) el oráculo que manda es de **comportamiento** (bloque B de `frame-parser-resolve.test.ts` sobre `readSourceFor`); (2) el guard estático se reescribió **sobre la ausencia** — deriva del árbol los módulos de fabricante (`parser-*.ts` + `driver-*.ts` salvo `driver-types.ts`) y prohíbe mencionar sus exports **o importar de ellos** en `BleStickListenerProvider.tsx` **y** `adapter-selection.ts` (con meta-test del extractor); (3) el provider tampoco puede **fabricar** un parser ni un `ReadSource` (`frameParser:` / `parse:`), que es la única forma de escribir el fallback sin nombrar a nadie. El mismo extractor extendido cubre ahora el guard (i) sobre `contract.ts` (un fallback vía `driver-rs420.ts` no nombraba ningún `parser-*`). **7 mutantes nuevos corridos**, tabla en el informe — incluido MR1b, el del reviewer, con su antes (verde) y su después (4 rojos).
- [x] **T1.9** — Correr `npx tsc -p app/tsconfig.json --noEmit` para que el typecheck **enumere** los call sites de `ingestRawLine`/`processRawLine` y no quede ninguno adivinado. Cubre: RBM1.2.
  - **(as-built)** enumeró **dos**: `BleStickListenerProvider.tsx:213` y `app/app/baston-test.tsx:176` (el harness web-serial, que el design no nombraba). ⚠️ **El typecheck NO ve los tests**: `app/tsconfig.json` excluye `**/*.test.ts`, así que los call sites de `contract.test.ts`, `adapter-web-serial.test.ts` y `offline-noread.test.ts` **no rompen la compilación** y habrían reventado en runtime — se migraron a mano. Quien haga la próxima cirugía de firma en este camino tiene que barrerlos igual.

## Fase F2 — Dependencia, veto y configuración

> **Estado F2: IMPLEMENTADA** (2026-08-17). Informe: `progress/impl_ios-ble-mfi-f2.md` (as-built, evidencia del
> build, trazabilidad `RBM<n>` → test). Veto **FIRME**: `progress/veto_ble-plx.md`. Las notas de reconciliación al
> as-built van marcadas abajo con **(as-built)**.

- [x] **T2.0** — **VETO (prerrequisito, bloqueante)**: probar la compatibilidad de `react-native-ble-plx` con Expo SDK 56 + RN 0.85.3 **new-arch bridgeless**, contra el **código de la lib y un build real**, no contra docs. Mirar específicamente sus bindings **C++/JSI** (es la clase de fallo que bloqueó `react-native-quick-sqlite`; la analogía que fue **incorrecta** para `bluetooth-classic` acá **puede** aplicar), su config plugin y su autolinking. Si es incompatible → **PARAR y reportar al leader** (T1, T3 y T7 no dependen de esta dep). Cubre: RBM2.18.
  - **(as-built)** **COMPATIBLE, FIRME**. Dos mitades: (i) inspección de fuente, hecha por el leader
    (`progress/veto_ble-plx.md`) — el paquete **no tiene una sola fuente C++/JSI**, así que la analogía con
    `quick-sqlite` que la spec temía **no tiene dónde ocurrir**; (ii) **build real**:
    `:app:assembleDebug` → **BUILD SUCCESSFUL en 3m 23s**, autolinking verificado en `PackageList.java`, codegen
    de new arch corriendo, APK generado, **0 builds de EAS**.
  - **(as-built, límite que el task no anticipaba)** el codegen produce un `schema.json` **vacío**: la lib es un
    **módulo de puente LEGACY** (`ReactContextBaseJavaModule`), no un TurboModule, y bajo bridgeless anda por la
    capa de interop. El build prueba *compila + linkea + autolinkea + empaqueta*; **no** prueba la reachability
    del puente en runtime. Eso lo mide el banco de **F6/RBM6.1** — que es donde la spec ya lo pone.
- [x] **T2.1** — Instalar y **pinear** la dep con pnpm. El censo del guard de purpose strings **va a nacer en rojo**: es a propósito. Cubre: RBM2.17.
  - **(as-built)** `react-native-ble-plx@3.5.1`, **exacta** (sin `^`/`~`, convención del repo para nativos). La
    versión no la elige un peer range (los suyos son `*`) ni Expo (no está en su lista de SDK 56): es la última
    publicada, la que maneja new arch, y **la misma que inspeccionó el veto** — instalar otra lo invalidaba.
    El censo nació en rojo tal como el task decía (14/15, el único fallo era el `CENSUS`).
- [x] **T2.2** — `app/ios-purpose-strings-guard.test.ts`: agregar `react-native-ble-plx` al `CENSUS` con su **veredicto escrito** (toca CoreBluetooth → exige `NSBluetoothAlwaysUsageDescription`, ya declarada y con texto útil). Verificar que el guard de `UISupportedExternalAccessoryProtocols` sigue en verde. Cubre: RBM2.17, RBM4.3.
  - **(as-built)** el veredicto es el que el task pedía —**exige** `NSBluetoothAlwaysUsageDescription`, ya
    declarada— pero la **ruta** es otra que la que el task suponía: sus fuentes propias **no nombran ni un
    símbolo de CoreBluetooth** (el framework entra por el pod `MultiplatformBleAdapter`, que vive en `Pods/` y no
    en `node_modules/`), así que el **escaneo de símbolos es ciego** y lo que obliga la clave es la **red por
    nombre** (`MODULES_BY_NAME`). Por eso **no** lleva entrada en `MODULE_VERDICTS`: sin hits sería un veredicto
    "fantasma" y el guard que los caza lo rechazaría. El veredicto quedó **ejecutable** (test nuevo, escrito como
    disyunción para no dar rojo si una versión futura inline CoreBluetooth). Guard de EA: **verde**.
- [x] **T2.3** — `app.config.ts`: declarar el plugin de `react-native-ble-plx` con **background deshabilitado** — sin `UIBackgroundModes: bluetooth-central`. No tocar `UISupportedExternalAccessoryProtocols` (RBM4.3) ni las purpose strings existentes. Cubre: RBM2.15, RBM4.3.
  - **(as-built)** cuatro opciones explícitas, dos de ellas **no previstas por el design** y con consecuencia
    real: `neverForLocation: true` (sin ella el plugin declara `ACCESS_COARSE_LOCATION` y `ACCESS_FINE_LOCATION`
    **sin tope de API**, en el array `uses-permission-sdk-23` que el `tools:node="replace"` nuestro **no
    alcanza**) y `bluetoothAlwaysPermission: BLUETOOTH_PURPOSE` (el plugin **escribe** el `Info.plist` y sin la
    opción puede dejar su default en inglés, según el orden de los mods). Verificado en el plist REAL con
    `expo config --type introspect`, sin gastar un prebuild de iOS.
- [x] **T2.4** — `app.config.test.ts`: assert de que el plugin de BLE está declarado **sin** background y de que la clave de EA sigue presente. Cubre: RBM2.15, RBM4.3.
  - **(as-built)** 5 tests, no 1: el plugin declarado y sin background **en las cuatro variantes**; un **guard
    sobre la ausencia** (`bluetooth-central`/`bluetooth-peripheral` no aparecen en NINGUNA parte de la config
    serializada — cierra las puertas que no son la del plugin); `neverForLocation` presente; el purpose string
    del plugin **idéntico** al de `ios.infoPlist` (no pueden divergir); y la clave de EA declarada y vacía.
- [x] **T2.5** — `permissions-android.ts`: `androidBluetoothPermissionsFor(apiLevel, transport)` con tabla **exhaustiva** por `TransportKind` (`satisfies`): `spp` como hoy; `ble-gatt` → API ≥ 31 `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT`, API ≤ 30 `ACCESS_FINE_LOCATION`. Un transporte nuevo **no compila** hasta declarar su conjunto. Cubre: RBM2.13.
  - **(as-built)** `transport` es **requerido y sin default** en las tres funciones (la pura y las dos
    asincrónicas), así que los dos call sites del SPP pasan `'spp'` explícito en `defaultSppEnv()`. Un default a
    `'spp'` sería el fallback silencioso que el review de F1 rechazó. Los transportes sin permisos
    (`serial`/`ble-hid`/`mfi`) llevan su conjunto **vacío declarado con motivo escrito**, no ausente.
  - **(as-built, hallazgo de la autorrevisión)** *"lista vacía"* significa **dos cosas distintas** para los
    consumidores: `classifyPermissionResults([], …)` devuelve `'granted'`, así que un transporte **desconocido**
    (que también da `[]`) habría quedado *concedido*. Se agregó el predicado puro
    **`hasAndroidPermissionPolicy(transport)`**, que los dos caminos asincrónicos consultan **antes** de tocar
    RN y que devuelve `'unavailable'` si no hay política. La distinción no cabe en un `string[]` y por eso no
    vive en la función de la tabla.
- [x] **T2.6** — `permissions-android.test.ts`: casos por (API, transporte), incluido que el conjunto del `spp` **no cambió** (regresión). Cubre: RBM2.13.
  - **(as-built)** 26 tests (eran 11). Además de la matriz (API × transporte) y la regresión del `spp`: un
    **guard sobre la ausencia** que deriva los miembros de `TransportKind` del **fuente** de `driver-types.ts` y
    exige fila para cada uno (con su **meta-test** de que el extractor no está ciego); el cruce contra los
    transportes que declaran los drivers **reales** del `DRIVER_REGISTRY`; la **contraprueba de vacuidad** (los
    conjuntos de `spp` y `ble-gatt` son distintos — un mutante que devolviera siempre el del `spp` pasaría toda
    la regresión); y el `Function.length` como oráculo **de comportamiento** de que el `transport` no ganó un
    default.
- [x] **T2.7** — Verificar contra `app/plugins/with-bluetooth-classic.js` que los cuatro permisos ya declarados **alcanzan** para el escaneo BLE (`BLUETOOTH_SCAN` con `neverForLocation`; `ACCESS_FINE_LOCATION` topeado a API 30). Si alcanzan, **no cambiar la política**: solo el comentario (T8.6). Si no alcanzan, reportar antes de tocar el manifiesto. Cubre: RBM2.13, RBM7.6.
  - **(as-built)** **Alcanzan** → la política **no se cambió**. Pero el task tenía un supuesto de menos: el
    plugin de la lib de BLE **agrega un permiso nuevo** (`ACCESS_COARSE_LOCATION`) en **otro array**
    (`uses-permission-sdk-23`), y el test que decía *"no hay ubicación sin tope"* era **estructuralmente ciego**
    a ese array. Se cerró sin tocar la política: `neverForLocation: true` en `app.config.ts` (que lo hace entrar
    topeado a 30) + un bloque nuevo en `with-bluetooth-classic.test.ts` que **compone las dos
    transformaciones reales** (las del paquete instalado, no una copia) en **los dos órdenes posibles** de mods
    y verifica el invariante sobre **todos** los arrays, con la **falsificación** del mundo malo
    (`neverForLocation: false` → dos permisos de ubicación sin tope).
  - **(as-built)** el comentario de `with-bluetooth-classic.js` quedó reconciliado en esta fase (adelanta la
    parte de comentario de **T8.6/RBM7.6**; T8.6 se cierra en F8 con el resto de la reconciliación). Se
    reconcilió también el **límite nº5** del guard de purpose strings, que afirmaba que ningún plugin nuestro
    tocaba el `Info.plist`.
- [x] **T2.8** — Build **local de Android** con Gradle (0 EAS) para confirmar que la app arranca con la dep nueva. Cubre: RBM9.8.
  - **(as-built)** `gradle.mjs --stop` → `expo prebuild -p android` → `:app:assembleDebug` → **exit 0, 3m 23s**,
    `app-debug.apk`. Se revirtieron a mano los scripts `android`/`ios` que el prebuild reescribe. El
    manifiesto **mergeado** (lo que de verdad pide el APK) quedó verificado permiso por permiso.
  - ⚠️ **Precisión sobre el verbo del task**: el build confirma que la app **compila y se empaqueta** con la dep
    nueva, no que **arranque** — eso es device y va en F6. Dicho para que el verde no se lea de más.

## Fase F3 — T2: `adapter-ble-gatt` (código + tests puros)

> **Estado F3: IMPLEMENTADA + fix-loop del review aplicado** (2026-08-17). Informes:
> `progress/impl_ios-ble-mfi-f3.md` (as-built, mutantes, trazabilidad, autorrevisión) y
> `progress/review_ios-ble-mfi-f3.md` (CHANGES_REQUESTED, 20 mutantes propios del reviewer). Las notas de
> reconciliación al as-built van marcadas abajo con **(as-built)**.
>
> **Qué cerró el fix-loop (todo es ORÁCULO — cero cambios de comportamiento en el código de producción)**:
> (1) 🟠-1 la suite ejercita **dos perfiles de driver** con UUID y fin de trama distintos, así que los tres
> mutantes que re-hardcodean un parámetro de fabricante adentro del transporte (la deuda **RMV5.2**) ahora
> **caen**; (2) 🟡-2 el **destope de la cadena por un tap con intento en vuelo** tiene test diferencial;
> (3) 🟡-3 las piezas muertas se resolvieron una por una: `checkPermission` y `clock` **se cablearon** (cada
> una mata un mutante que sobrevivía), y `state.cancelDeviceCalls` + `BleManagerLike.cancelDeviceConnection`
> **se borraron** (la ausencia de la firma es un guard de compilación más fuerte que el contador);
> (4) ⚪-4 el tope de la cadena **adentro del timer** ganó su propio oráculo, así que ya no es "un oráculo y
> un cinturón". Más dos hallazgos propios de la autorrevisión, de la misma clase (monocultura de fixture):
> el **id del bastón recordado** y **qué presupuesto acota qué await**. Suite: **136 → 142**, todas verdes.
>
> ⚠️ **Lo que F3 NO deja andando, dicho para que el verde no se lea de más**: el transporte **no es
> alcanzable en producción todavía**. `selectTransportAdapter` nunca devuelve `'ble-gatt'` y
> `adapterForTransport('ble-gatt')` sigue devolviendo `null` — eso es **F4** (T4.1/T4.6). El `case` del
> provider existe y está probado, pero hoy nada lo elige: F3 no cambia el comportamiento de ninguna
> plataforma. Y el stream real sigue sin verificar hasta el banco de **F6** (RBM6.1).

> ⚠️ **Leer primero el recuadro de `design-ios-ble-mfi.md` §4** ("el `ReadSource` se resuelve AL CABLEAR"): el provider
> resuelve el parser una vez por adaptador cableado, y eso solo es correcto mientras el `driver` sea inmutable por
> instancia. El adapter BLE conoce su driver recién al **elegir el device en el escaneo** — si esa elección no fuerza una
> instancia nueva, el transporte nace **mudo** (0 lecturas, 0 errores) y hoy no lo guarda nada. T3 tiene que traer el test
> que lo fija.

- [x] **T3.1** — `ble-gatt-protocol.ts` (PURO, espejo de `spp-protocol.ts`): `decodeBase64Ascii` (base64 → bytes → **un byte = un carácter**, conservando `STX`), `normalizeUuid128` (case-insensitive), `bleGattDelimiterIsSupported`, `resolveBleGattParams(driver)`. Cubre: RBM2.7, RBM2.10.
  - **(as-built)** el decoder de base64 es **propio** (15 líneas de aritmética de 6 bits) y no `atob`/`Buffer`: `Buffer` no existe en RN y `atob` es un global que **depende del runtime** (lo trae Hermes en versiones recientes, puede no traerlo un motor viejo). Un decoder que existe "según dónde corra" en el ÚNICO camino por el que entra una lectura del bastón tiene como síntoma de falta *cero lecturas*. El oráculo de sus tests es el encoder de **Node** (`Buffer.from(..., 'latin1')`), no el nuestro, para no medir simetría con nosotros mismos.
  - **(as-built)** `resolveBleGattParams` devuelve un resultado **discriminado con tres motivos** (`driver-sin-ble-gatt` / `uuid-invalido` / `delimitador-no-soportado`) en vez de `null`: son tres causas con tres acciones distintas y desde la UI se ven idénticas (nada). Con un `null` único el log no distinguía "este lector no habla GATT" (normal) de "el driver está roto" (bug).
  - **(as-built)** además de lo que el task pedía se agregaron `BLE_DEFAULT_MTU`/`BLE_DEFAULT_NOTIFY_PAYLOAD` (23 − 3 = **20 bytes**, el troceo con el que corre el banco de RBM6.3) y las dos funciones de opciones moldeadas sobre el FUENTE instalado: `bleScanOptions()` (`allowDuplicates:false`) y `bleConnectOptions(ms)` (`autoConnect:false` —el modo autoConnect del SO reintenta solo, en background y sin tope: justo la cadena que RBM3.1/3.6 acotan— y **sin `requestMTU`**, RBM2.12).
  - **(as-built, autorrevisión)** se **borró** un `sameUuid(a,b)` que había quedado exportado y testeado **sin un solo call site de producción**. Detalle y motivo en el informe.
- [x] **T3.2** — `ble-gatt-protocol.test.ts`: trama con `STX` que sobrevive el round-trip; un byte ≥ `0x80` que **no** se mangle (contraprueba de UTF-8); UUID en minúsculas que matchea; delimitador vacío → no soportado. Cubre: RBM2.7, RBM2.10.
  - **(as-built)** 23 tests. La contraprueba de UTF-8 no es "el string es igual": decodifica **los mismos bytes** con `TextDecoder('utf-8')` y **exige que dé distinto** (con U+FFFD), porque para una trama puramente ASCII un decoder UTF-8 pasaría el test igual y el bug aparecería recién con el primer lector que use un byte alto — como un `parse_failed` intermitente.
  - **(as-built)** el oráculo de cada trama es **"sale el EID"** (`parseRs420Line`), no "los strings coinciden".
- [x] **T3.3** — `driver-types.ts`: el `TransportCapability` de kind `ble-gatt` gana `delimiter?` (el fin de trama es del **lector**, no del transporte — lección 🟠-5). Cubre: RBM2.8, RBM2.10.
  - **(as-built)** ausente = `
` (el supuesto del RS420, igual que en `spp`), y **vacío ≠ ausente**: se resuelve con `??` y no con `||` justamente para que un `''` declarado llegue al chequeo y sea **rechazado con su motivo** en vez de caer al default en silencio (hay un test que caza esa variante).
- [x] **T3.4** — `adapter-ble-gatt.ts`: `StickAdapter` (`kind:'ble-gatt'`) con **import perezoso** de `react-native-ble-plx`, `BleEnv` inyectado por constructor (espejo de `SppEnv`: `loadManager` / `checkPermissions` (**obligatorio**, no opcional) / `ensurePermissions` / `readRemembered` / `writeRemembered` / `isForeground` / `schedule` / `onForeground` / `now` / `timeouts`). Flujo del design §4. Cubre: RBM2.1, RBM2.2, RBM2.6, RBM3.11.
  - **(as-built)** la superficie de la lib se **modela a mano** (`BleManagerLike`, `BleDeviceLike`, `BleCharacteristicLike`, `BleSubscription`) desde el FUENTE instalado de la 3.5.1 (`src/BleManager.js`, `src/Device.js`, `src/Characteristic.js`), no desde su README y sin importar sus tipos — igual que en el SPP, para no meter la lib en el grafo de módulos de web/CI.
  - **(as-built)** `isDeviceConnected?` queda **opcional** en la interfaz modelada (una versión futura de la lib podría no tenerlo): sin sonda no hay 2ª fuente de verdad, y eso se **loguea una vez por conexión** (`liveness_probe_unavailable`) en vez de fingir que RBM3.5 está cubierto.
  - **(as-built, no previsto por el design)** el driver entra por constructor con default `bleGattDriverFrom()` y, si el registro no declara ninguno, **no se lanza**: un throw en el constructor del transporte se propagaría al render del provider y se llevaría la app por un dato de configuración. Queda un driver imposible de resolver (`resolveBleGattParams` → `driver-sin-ble-gatt`) y el connect corta con log.
  - **(as-built, LA RADIO NO SE PIDE PRENDER NUNCA — el design no tenía paso de radio)** el as-built CONSULTA `manager.state()` y **no llama `manager.enable()`**, por tres motivos: en iOS esa API no existe (la única salida es Ajustes), así que un camino que dependa de ella sería Android-only en un transporte que se declara cross-platform (RBM2.1); está deprecada desde API 33 y falla en silencio; y es la forma más simple de cumplir RBM3.8 sin depender de acertar el trigger. Tres desenlaces distintos: `Unauthorized` → `permission_denied` (es el permiso de iOS: CTA, sin backoff), `Unsupported` → `disconnected` **sin** reintento (no se arregla martillando hardware que no existe), `PoweredOff`/`Resetting`/ilegible → `disconnected` **con** reintento (puede cambiar solo).
  - **(as-built)** `BleTimings extends BridgeTimings` con un campo propio `scan` (10 s) y `BleTimerLabel = 'reconnect' | 'watchdog' | 'scan'` (un timer nuevo tiene que nombrarse; los tests filtran por ahí). El presupuesto del escaneo **no** se agregó a `BridgeTimings` a propósito: ese tipo lo comparten el SPP y `remembered-device.ts`, que no tienen qué hacer con él.
- [x] **T3.5** — Escaneo: **filtrado por `serviceUuid`** del driver y **acotado** por presupuesto; se detiene al conectar o al vencer, con estado y CTA ("Buscar de nuevo"). `logging.ts` += `ble_scan_timeout`. Cubre: RBM2.4, RBM2.5.
  - **(as-built)** el techo del escaneo es **DOBLE**: adentro lo acota su presupuesto (`schedule(..., 'scan')`, que es lo que produce el `ble_scan_timeout` con su diagnóstico) y afuera lo acota un `withTimeoutOr('scan_for_target')`, para que ni un timer que no llega ni un `startDeviceScan` que no se asienta puedan dejar el LATCH tomado — el 🔴-1 del SPP entrando por la puerta del descubrimiento.
  - **(as-built)** `startDeviceScan` de la lib **es async y puede RECHAZAR** (sin permiso, radio abajo), y en ese caso el listener **no se llama nunca**: se atiende su rechazo, porque sin eso el escaneo esperaba su presupuesto entero para nada y el log decía "timeout" cuando ni arrancó (hay test que exige que en ese caso NO aparezca `ble_scan_timeout`).
  - **(as-built)** `ble_scan_timeout` lleva `{ms, seen}`: `seen` = cuántos dispositivos aparecieron ANUNCIANDO el servicio del driver. Separa "no hay nada a la vista" (bastón apagado / fuera de rango / la radio no está escaneando de verdad) de "hay algo con ese servicio que NO es un bastón" (el bridge de la balanza Vesta) — dos causas que desde la UI se ven igual.
  - **(as-built)** un device que aparece pero que el `deviceMatch` del driver **no reconoce** se cuenta, se loguea una vez (`ble_device_not_recognized`) y **el escaneo SIGUE**. El reconocimiento se delega en `findDriverForDevice` con un registro de UNO (el driver de esta instancia) para no reimplementar el cruce, se le pasan los UUID que el device **anunció de verdad** (nunca el nuestro, que sería un sello de goma) y se prueban los DOS nombres que el SO expone (`name` del GAP y `localName` del anuncio). El CTA "Buscar de nuevo" es UI: **F4** (T4.8).
  - **(as-built)** el escaneo se detiene SIEMPRE (`stopDeviceScan`): al encontrar, al vencer, al fallar y en el teardown — y el teardown **TERMINA** el escaneo (`finish(null)`), no solo cancela su presupuesto: si solo cancelara el timer, un `disconnect()` en medio de un escaneo dejaba **la radio escaneando** hasta que venciera el techo de afuera.
- [x] **T3.6** — Notificaciones → `decodeBase64Ascii` → `LineFramer` (reuso) con el **delimitador del driver** → cada línea completa **cruda** al contrato. Delimitador vacío → **no abre** la conexión, con log. Cubre: RBM2.8, RBM2.9, RBM2.10.
  - **(as-built, archivo que el design no listaba)** `line-framer.ts` tenía el delimitador **HARDCODEADO** en `'\n'`, así que "usar el delimitador del driver" (RBM2.8) exigía parametrizarlo: entra por **constructor con default `'\n'`** → los dos call sites existentes (web-serial y el harness) no cambian de comportamiento (con test de regresión). Un delimitador vacío en el framer cae al default en vez de colgarse (`indexOf('')` devuelve 0 SIEMPRE → bucle infinito de líneas vacías); quién RECHAZA ese driver es el adapter, **antes** de conectar. Multi-carácter (`\r\n`) consume el delimitador COMPLETO (sin eso, el `\n` sobrante arrancaba la línea siguiente).
  - **(as-built)** el framer vive en la **clausura de la sesión** de conexión y no en un campo del adapter: así no hay forma de que el buffer de una sesión vieja se lea desde la nueva (el arrastre que en el SPP hacía perder la primera lectura buena después de corregir el terminador, banco §4.4) ni de que un `null` intermedio del teardown le pegue a una notificación que ya estaba en vuelo.
  - **(as-built)** una notificación que **no se puede decodificar** se descarta CON log (`ble_decode_failed`), no en silencio; y los bytes que llegan cuentan como "el link no está mudo" aunque la trama todavía no esté completa.
  - **(as-built, fix-loop del review 🟠-1)** que el delimitador que llega al framer sea **el del driver** recién quedó falsificado con el **segundo perfil** de driver (`delimiter: '\r'`): mientras el único delimitador de la suite era `'\n'` —el default del framer— `new LineFramer()` pasaba las 136 pruebas. El test exige las dos direcciones: el terminador del OTRO lector **no** cierra línea, el propio sí. Ídem el `serviceUuid` del filtro del escaneo (T3.5) y el par servicio+característica del monitor.
- [x] **T3.7** — `adapter-selection.ts`: `AdapterKind` / `ADAPTER_KINDS` / `ADAPTER_INGEST_MODE` += `'ble-gatt'` (`raw-line`); `permissions.ts` += `case 'ble-gatt' → { kind: 'ble' }`. Los switches exhaustivos hacen que no compile hasta declararlo. Cubre: RBM2.11, RBM2.13.
  - **(as-built)** `'mfi-ios'` **NO** entró (es F5): el union se extendió con un solo miembro, así el typecheck enumera solo lo que esta fase tiene que declarar.
  - **(as-built)** el modelo de permisos es `{ kind: 'ble' }` **propio** y no `'android-bluetooth'`: el conjunto de Android es distinto del SPP (el BLE escanea) y el transporte es cross-platform, así que su modelo no puede llamarse "android-*" (en iOS no hay API de request: el diálogo lo muestra el SO al usar la radio y su negación llega como `Unauthorized`).
  - **(as-built)** `LINK_DWELL_MS` se **mudó** de `adapter-spp-android.ts` a `connect-trigger.ts` (re-exportado desde el SPP para no tocar sus call sites): es una política de la CADENA DE REINTENTOS —igual que `UNPROMPTED_RETRY_BUDGET_MS`— y con el segundo transporte con radio la alternativa era duplicar el número o importarlo de un adapter hermano.
- [x] **T3.8** — `instantiateTransport`: `case 'ble-gatt'` → el adapter **solo si el módulo nativo está presente en el build**, si no `null` (mismo guard que `isSppNativeAvailable`: `require` resuelve desde `node_modules` aunque el binario no esté en el APK → montar igual sería un transporte fantasma). Cubre: RBM2.3.
  - **(as-built)** `isBleGattTransportAvailable()` chequea **DOS** condiciones, no una, y las loguea **por separado** porque tienen causas y arreglos distintos: (a) módulo nativo presente; (b) que **algún driver del registro declare el transporte `ble-gatt`** — sin `serviceUuid` no hay filtro de escaneo posible, así que montarlo sería un transporte que no puede ni buscar. Hoy (b) es **false** en producción: el driver del emulador lo agrega **F4** (T4.3).
  - **(as-built)** la carga del manager distingue "no hay RN" (web/CI → `null` **en silencio**, es lo esperado) de "el binario está y la lib explotó al inicializarse" (`ble_manager_load_failed`): un try/catch mudo en el segundo caso convertía "la lib no arrancó" en "el operario no está bastoneando" — el hallazgo del review de F1.
  - ⚠️ **(as-built)** el `case` es hoy **inalcanzable**: `selectTransportAdapter` nunca devuelve `'ble-gatt'` (F4/T4.6) y `adapterForTransport('ble-gatt')` sigue en `null` (F4/T4.1). Está escrito y probado, pero **F3 no cambia el transporte que monta ninguna plataforma**.
- [x] **T3.9** — **Lecciones del SPP, implementadas** (no reinventadas): techo de la cadena sin gesto por `connect-trigger.ts`; presupuesto en **todos** los awaits del puente + latch con generación liberado en `finally` y en `disconnect()`; desconexión por **suscripción del propio device**; sonda de liveness (foreground + poll) fail-closed; foreground **al disparar**; encolado del `connect()` con otro target; ningún diálogo del SO desde un timer; dwell del backoff; watchdog de mudez. Cubre: RBM3.1, RBM3.2, RBM3.4, RBM3.5, RBM3.6, RBM3.7, RBM3.8, RBM3.9, RBM3.10.
  - **(as-built)** las 10 están implementadas y **falsificadas una por una con un mutante** (13 mutantes, tabla completa en `progress/impl_ios-ble-mfi-f3.md` §5). **Uno sobrevivió** y por eso hay un test nuevo: el chequeo del presupuesto de la cadena está DOS veces (cabecera de `scheduleReconnect` + adentro del timer) y borrar el de la **cabecera** dejaba las 133 pruebas en verde. Lo que ese chequeo cubre y el del timer no: programar un reintento con la cadena **ya vencida** y la app en **background** — sin él la cadena se PARQUEA esperando el foreground en vez de morir, o sea el tope de RBM3.1 se vuelve evitable guardando el teléfono en el bolsillo.
  - **(as-built, propio de esta lib)** hay una lección **nueva**, que no venía del SPP: `subscription.remove()` de un monitor hace `BleModule.cancelTransaction(...)`, lo que **RECHAZA la promesa del monitor**, y la lib traduce ese rechazo en `listener(error, null)`. O sea: **nuestro propio teardown dispara el handler de error de lectura**. Si ese handler reconectara sin mirar la sesión, un `disconnect()` del operario terminaría RECONECTANDO el bastón que acababa de apagar. Se cierra con una **generación de SESIÓN** que `teardownStreams()` bumpea ANTES de remover suscripciones (y el fake reproduce el rechazo, sin knob para apagarlo, para que el oráculo no se pueda desactivar).
  - **(as-built)** el `onDeviceDisconnected` de la lib filtra por id con comparación **EXACTA de strings adentro de la lib** (no podemos tolerar mayúsculas como sí hacemos nosotros con `sameDevice`): si el nativo devolviera el id con otro case, el evento **no llega nunca**. Es un motivo EXTRA —además de BENCH-1— para que la sonda de liveness no sea opcional.
  - **(as-built)** un `connect()` del operario con un intento en vuelo y **sin** otro target que encolar no es un no-op mudo (🟠-B del review del SPP): re-aplica la política de su cadena (la DESTOPA) y deja `connect_reasserted`.
  - **(as-built, fix-loop del review 🟡-2)** de esa línea, el review encontró que solo la **mitad del log** estaba testeada: borrar el destope dejaba 136/136 en verde. Ahora hay test **diferencial** (el mismo escenario con y sin el tap: con tap la cadena sigue reintentando, sin tap muere en `off`), así que no puede pasar por vacuidad. El caso real: el operario abre la app, el bastón tarda, toca "Volver a conectar" a los 90 s → sin el destope su gesto no tiene **ningún** efecto observable y la cadena muere igual a los 120 s.
  - **(as-built, fix-loop del review ⚪-4)** de las **dos** copias del tope de la cadena, la del **timer** no tenía oráculo (borrarla dejaba todo verde: el desenlace `off` se alcanzaba igual por la cabecera, un intento más tarde). Ahora el test del tope exige además que con el presupuesto vencido el timer **no sume un intento**.
- [x] **T3.10** — `remembered-device.ts` + `autoConnect()` del adapter BLE con la misma política de triggers que el SPP. Cubre: RBM2.16.
  - **(as-built)** `remembered-device.ts` **no se tocó**: se REUSA tal cual (su cambio de formato a `{deviceId, vendorId?, adapterKind?}` es **F4**/T4.5). El adapter lo consume por `BleEnv.readRemembered`/`writeRemembered`, con require perezoso y try/catch, y los dos awaits van con techo.
  - **(as-built)** el orden de los gates del `autoConnect` va del más barato al que toca el hardware, y el primero es **"¿hay bastón recordado?"** (lectura local): un arranque en frío **no consulta permisos ni toca la radio**. Eso es lo que hace que RBM3.8 se cumpla también en **iOS**, donde el diálogo de Bluetooth no lo pide una API sino el SO la primera vez que se usa la radio — para que exista un bastón recordado el operario ya eligió uno por un gesto, y ahí el diálogo ya apareció con contexto.
    - ⚠️ **CORRECCIÓN (fix-loop del review de F4, 🟠-1)**: esta nota era cierta **de `autoConnect()`** y **falsa del sistema**. En iOS, construir el `BleManager` (→ `CBCentralManager`) **ya es tocar la radio**, y hasta el fix eso pasaba **una capa antes** de todos estos gates: `instantiateTransport('ble-gatt')` → `isBleGattTransportAvailable()` → `loadBleManager()`, o sea en el primer render del provider. El arranque en frío **sí** tocaba la radio desde que F4 hizo alcanzable el `case` del BLE. Ahora la disponibilidad **solo consulta** `NativeModules` (T4.10) y la afirmación es cierta, con un test que cuenta construcciones en vez de un comentario que promete. Verificación en device: T6.4.
  - **(as-built)** cuando un gate no pasa **no se emite ningún estado** (se queda en `'off'`, el estado honesto de "nunca se intentó") y el motivo va al log (`autoconnect_skipped{reason}`): los cinco motivos se ven idénticos desde la UI (nada), así que el log es lo único que hace diagnosticable un "no se conectó solo".
  - **(as-built)** el bastón se persiste al conectar, pero el objetivo se recuerda **antes** (`currentDeviceId` al resolver el target): si se anotara solo en el éxito, el reintento del backoff llamaría `connect(undefined)` y volvería a **escanear desde cero**, perdiendo el device que el escaneo ya había encontrado.
- [x] **T3.11** — `spp-bridge-timeout-guard.test.ts`: agregar `adapter-ble-gatt.ts` (y, cuando exista, `adapter-mfi-ios.ts`) a `BOUNDED_AT_THE_BOUNDARY`. **Falsificar**: sacarle el techo a un await del adapter nuevo → el guard cae nombrando archivo y línea. Cubre: RBM3.3.
  - **(as-built, corrección del task)** `BOUNDED_AT_THE_BOUNDARY` era el lugar **equivocado**: esa mitad del guard solo mira awaits de `NATIVE_PRIMITIVES` (`SecureStore|PermissionsAndroid|AsyncStorage|NativeModules`), y el adapter BLE **no awaitea ninguna** (habla por `manager.` / `device.` / `this.env.`). Meterlo ahí habría sumado una entrada **VACUA**: 0 awaits mirados, verde garantizado, y el requisito RBM3.3 "cumplido" sin vigilar nada. Lo que se hizo en su lugar: la mitad de arriba del guard —la que sí modela el puente de un adapter— dejó de mirar UN archivo y pasa a recorrer una tabla `RADIO_ADAPTERS` con **los prefijos de puente de cada uno** (`native` en el SPP, `manager` en el BLE).
  - **(as-built)** la tabla **se deriva del árbol**: todo `adapter-*.ts` que haga un `require('react-native…')` perezoso —la definición operativa de "tiene puente"— **tiene que estar declarado**, o el guard cae. `adapter-mfi-ios.ts` (F5) va a **nacer en rojo**, que es exactamente lo que el task pedía y sin depender de que alguien se acuerde.
  - **(as-built)** se agregó un test de **NO-CEGUERA** por adapter: cuando todo está envuelto, la lista de violaciones es vacía **por construcción**, así que un renombre de la variable de la lib (`manager` → `mgr`) dejaría el guard verde mirando NADA. El test exige que cada prefijo declarado siga apareciendo en el fuente.
  - **(as-built)** **falsificado con 3 mutantes** (M1/M2/M3 del informe): (M1) sacarle el techo a `manager.stopDeviceScan()` → el guard cae **nombrando `adapter-ble-gatt.ts:1127`**, y las 75 pruebas del adapter quedan en VERDE (que es por qué el guard hace falta); (M2) sacar el adapter de la tabla —el estado real en que estaba el árbol— → cae el test de derivación; (M3) renombrar `manager` → cae el de no-ceguera.
- [x] **T3.12** — `adapter-ble-gatt.test.ts` (node:test, entorno inyectado): máquina de estados completa — permiso concedido/denegado, escaneo que vence, conexión, suscripción, **promesas que no resuelven nunca**, corte del SO, desconexión **de otro device** que no afecta, backoff con dwell, background/foreground, doble connect, connect con otro target, teardown sin timers ni suscripciones huérfanas. Cubre: RBM2.14, RBM3.1–RBM3.11.
  - **(as-built)** **81 tests** (75 en la primera pasada + 6 del fix-loop del review), todos los escenarios del task + los propios de esta lib. Además de los pedidos: radio apagada / `Unauthorized` / `Unsupported` / ilegible, permiso `unavailable`, escaneo que RECHAZA vs escaneo que vence, `stopDeviceScan` que no vuelve, descubrimiento que RECHAZA vs que se cuelga, monitor que muere, notificación indecodificable, intento viejo que despierta (`orphan_socket_kept`), y el `ReadSource` resuelto AL CABLEAR (⚪-3 de F1).
  - **(as-built, fixture)** `fakeDevice` usaba `??` para sus campos nulables, así que pedir un device **sin nombre** (`{name:null}`) devolvía uno **con** el nombre por default —o sea, uno que el driver RECONOCE— justo en los dos tests que probaban lo contrario: uno quedaba verde matcheando el GAP name donde decía medir el `localName`, y el otro (la contraprueba del auto-sellado) se rompía por el camino equivocado. Se arregló el **fixture** (no el test), con un META-TEST que exige que un device declarado anónimo salga anónimo de verdad.
  - **(as-built, el test que no falsificaba lo que decía)** la contraprueba del auto-sellado usaba un driver que matchea **solo por nombre**, con el que el mutante que pretendía cazar (pasarle al driver NUESTRO `serviceUuid` como "lo que el device anunció") **pasaba en verde**: sin matcher de UUID no hay nada que sellar. Ahora usa un driver que **sí** reconoce por UUID anunciado, con **control positivo** (un device que anuncia el servicio SÍ se reconoce) — y el mutante muere (verificado: mata ese test y **ningún otro** de los 75).
  - **(as-built)** se agregó un oráculo que faltaba: `RBM2.13` — que el entorno REAL (`defaultBleEnv`) pida el conjunto de permisos **del transporte BLE** y no el del SPP. Es **estático y está declarado como tal** (toda la suite inyecta un env falso, así que nada ejerce `defaultBleEnv`): cambiar los dos literales a `'spp'` dejaba **121 tests en verde** y en producción significaba escaneo sin `BLUETOOTH_SCAN` (API ≥ 31) o sin `ACCESS_FINE_LOCATION` (API ≤ 30) — cero resultados, sin error y sin log.
  - **(as-built, fix-loop del review — la suite pasa de 75 a 81 tests / 136 a 142 con las 5 suites)** el review midió que el fixture era una **monocultura** en tres ejes, y cada uno dejaba un mutante vivo:
    - **los parámetros del driver** (🟠-1): un solo juego de UUID y ningún delimitador propio → 3 mutantes vivos. As-built: tabla `DRIVER_PROFILES` con **dos** perfiles recorridos de punta a punta + test de **anti-vacuidad** que exige que difieran en los tres campos (si mañana alguien los iguala, el guard cae en vez de volverse teatro).
    - **el reloj** (🟡-3, knob `clock` declarado y nunca pasado): toda la suite corría desde `t=0`, donde `now() - lastDataAt` y `now()` son el mismo número → los mutantes que borran la **medición** del `connected_silent` y del dwell sobrevivían. As-built: los tests que miden un intervalo arrancan en un instante real (`CLOCK_START`).
    - **los presupuestos** (hallazgo propio de la autorrevisión): los cuatro de `FAST_TIMEOUTS` eran `5`, así que **cuál** presupuesto acota **cuál** await no se podía observar (envolver el connect con el de una llamada corta sobrevivía). As-built: distintos entre sí + los tests asertan el `ms` del `bridge_timeout` + anti-vacuidad de que sigan siendo distintos.
    - **el id del device** (hallazgo propio): el target pedido y el id del device del fixture eran el MISMO, así que `writeRemembered('11:22…')` hardcodeado pasaba la suite entera (en producción: R6.4 reconectando siempre al mismo id). El segundo perfil usa otro id y lo asierra.
  - **(as-built, fix-loop del review 🟡-3)** `checkPermission` estaba declarado y **ningún test lo pasaba**, así que `checkPermissions()` y `ensurePermissions()` devolvían lo mismo en toda la suite y los dos caminos solo se distinguían por CONTADORES: borrar el gate de permiso del `autoConnect` dejaba todo verde. Se **cableó** con la secuencia real (`check → denied`, después `ensure → granted`: el permiso no estaba concedido y el gesto lo consigue). Y `state.cancelDeviceCalls` se **borró** junto con `BleManagerLike.cancelDeviceConnection` (cero call sites de producción, mismo criterio con el que se borró `sameUuid`): la firma fuera del modelo hace que un call site nuevo **no compile**, que es más fuerte que un contador que nadie asertaba.
  - **(as-built)** este archivo **no lo ve el typecheck del repo** (`app/tsconfig.json` excluye `**/*.test.ts`) y tenía **2 errores de tipo reales** (una narrowing a `never[]` por `assert.deepEqual(x, [])` y un `let` asignado dentro de un callback). Corregidos; se verificó corriendo `tsc` a mano sobre el archivo, y que los tests pre-existentes de esta carpeta **no** tienen esa clase de error.
- [x] **T3.13** — Tests de reensamblado con el troceo real: trama partida en trozos de 20 bytes → **1** lectura; dos tramas pegadas → **2**; trozo que corta el `STX`; trama sin terminador que se come la siguiente (el defecto conocido, aserrado como tal). Cubre: RBM2.8, RBM2.9, RBM2.12.
  - **(as-built)** el reensamblado se prueba **dos veces y en dos niveles**: sobre el `LineFramer` solo (`ble-gatt-protocol.test.ts`, con el troceo calculado desde `BLE_DEFAULT_NOTIFY_PAYLOAD`) y **de punta a punta por el adapter** (`adapter-ble-gatt.test.ts`: notificaciones en base64 → 1 lectura), porque lo que hay que fijar no es el framer —que ya andaba— sino que el adapter le pase el texto decodificado byte a byte y el delimitador del driver.
  - **(as-built)** cada test de troceo trae su **anti-vacuidad** (`trozos.length >= 2`: si el fixture no se parte, el test no prueba nada), y el del defecto conocido asierra la consecuencia ACEPTABLE: la línea pegada se **RECHAZA** (`parseRs420Line` → `null`), nunca se ingiere un EID inventado.
  - **(as-built)** `chunk 20` vs `chunk 0` da **idéntico** (RBM6.3 anticipado en unit; el banco de F6 lo mide contra el emulador real).

## Fase F4 — T4: selección, prioridad y transporte montado

- [x] **T4.1** — `selection-priority.ts`: prioridad iOS → `['mfi','ble-gatt','ble-hid']`; `adapterForTransport` += `ble-gatt` → `'ble-gatt'` (iOS **y** Android), `mfi` + iOS → `'mfi-ios'` (fuera de iOS `null`); `spp` sigue `null` fuera de Android. Actualizar el comentario que menciona `adapter-ea-ios`. Cubre: RBM5.1, RBM5.2, RBM5.3, RBM5.4.
  - **(as-built)** `ble-gatt` quedó acotado a **iOS y Android** y no libre: `react-native-ble-plx` no tiene web, así que mapearlo en web dejaría que un `adapterKind:'ble-gatt'` viejo en `localStorage` (la preferencia de T4.6) montara un transporte imposible. Entró además `isAdapterUsableOn`, **derivado** de `adapterForTransport` recorriendo `TRANSPORT_KINDS` (y no una segunda tabla plataforma→adapter: dos tablas de la misma verdad divergen — es el bug de clase de este camino).
- [x] **T4.2** — `ea-protocols.ts` (PURO): `declaredEaProtocols()` (require perezoso de `Constants`, try/catch) + `mfiAvailability(driver, declared)` con sus tres motivos (`driver-sin-mfi` / `build-sin-protocolos` / `protocolo-no-declarado`). `BindingEnv` gana `declaredEaProtocols` **inyectable**. Cubre: RBM4.2, RBM4.4, RBM4.5, RBM5.5.
  - **(as-built)** `declaredEaProtocols` quedó partido en TRES: el `require` perezoso, la **ruta** dentro del manifiesto (`eaProtocolsFromExpoConfig`, exportada) y el filtro de forma (`eaProtocolsFrom`). Es lo que permite ejercitar la ruta contra la config REAL de la app en `node:test` con la cadena sintética agregada —el diff del día que llegue el dato, ejecutado— en vez de probar solo el camino fail-closed que node da gratis. `BindingEnv.declaredEaProtocols` es **requerida y sin default** (un default a `[]` es el fallback silencioso que el review de F1 rechazó), y como el tipo igual acepta un `[]` literal, hay un guard sobre el call site de producción.
- [x] **T4.3** — `driver-esp32-gatt.ts`: `ESP32_GATT_DRIVER` con los UUIDs Nordic UART de ADR-003, `frameParser` = `parseRs420Line` (reuso), `delimiter` = `SPP_DELIMITER`, `displayName` que dice **explícitamente** que es un banco de pruebas, y `deviceMatch` **solo por `namePattern`** (`/EMU-GATT-STICK/i`) — **nunca** por `advertisedServiceUuids`. Registrarlo en `DRIVER_REGISTRY`. Cubre: RBM5.12, RBM5.13.
- [x] **T4.4** — Test del anti-colisión: un device que anuncia los **UUIDs NUS** y se llama `VESTA_BRIDGE` (el bridge de la balanza, ADR-003) → `findDriverForDevice` = `null` → fila "no reconocido", **no accionable**. **Falsificar** agregando `advertisedServiceUuids` al `deviceMatch` del driver del emulador → el test cae. Cubre: RBM5.13.
  - **(as-built)** el mutante se corrió: agregar `advertisedServiceUuids: [NUS_SERVICE_UUID]` al matcher del emulador **mata 3 tests**. El fixture de la colisión usa el UUID DEL DRIVER (la colisión ES "el mismo UUID": una copia del literal seguiría verde midiendo una colisión que ya no existe), y hay **control positivo** (el mismo device con el nombre del emulador SÍ se reconoce) para que un `findDriverForDevice` que devolviera `null` siempre no pase.
- [x] **T4.5** — `remembered-device.ts`: el valor pasa a `{ deviceId, vendorId?, adapterKind? }`, leyendo el **formato viejo** (string pelado) como "sin preferencia" sin romper. No tocar los techos de `storage` ni los tres call sites del `forget`. Cubre: RBM5.7.
  - **(as-built)** el formato vive en un módulo aparte y **PURO** (`remembered-format.ts`), porque `remembered-device.ts` importa `expo-secure-store` y `react-native` → ninguna suite `node:test` puede importarlo. El discriminante viejo/nuevo es *"¿el `JSON.parse` dio un OBJETO?"* y no *"¿parseó?"*: un id de solo dígitos parsea como número y uno que diga `true` como booleano. Un `adapterKind` que este build no conoce se **descarta conservando el `deviceId`** (fail-closed sin costarle el bastón al operario).
- [x] **T4.6** — `SelectionEnv.preferredAdapter?: AdapterKind` + la rama en `selectTransportAdapter` **después** de `mock`/`demo`/`manual` y **antes** de la plataforma; piso de iOS pasa de `'manual'` a `'ble-gatt'`. El provider hidrata la preferencia del bastón recordado y re-monta **solo si el `AdapterKind` resuelto cambia**. Cubre: RBM5.6.
  - **(as-built)** la preferencia se valida fail-closed (`honorsPreference`: usable en la plataforma + no gateada) y `hid-wedge` quedó en una lista explícita de **no elegible por preferencia** — es la primera entrada por la que un valor de STORAGE elige un transporte, así que "nunca se elige `hid-wedge`" (R8.7) dejó de ser cierto "porque ninguna rama lo escribe". El provider lee el storage **solo en `mode==='auto'`** (los otros tres cortan antes: cero I/O nueva para las ~70 specs E2E) y el `useMemo` depende del **kind ya resuelto**, no de la preferencia cruda.
  - **(as-built, hallazgo de la autorrevisión)** dos consecuencias que el task no anticipaba, cerradas acá: (a) el CTA "Olvidar el bastón guardado" (R6.6) vivía adentro de la rama `isSpp` → la preferencia escondía su propia salida; se movió afuera de las dos ramas, con guard. (b) La pantalla hacía `writeRememberedDevice(binding.driver.vendorId)` —un **vendorId guardado como si fuera un id de device**—, que con el adapter BLE es un bug vivo: `connect()` usa el id recordado **en vez de escanear**, así que un `'esp32-gatt-emu'` ahí manda a `connectToDevice()` contra un id inexistente y el bastón no se encuentra nunca más. Se borró esa escritura (el único que persiste es el adapter, en el punto donde el bastón contestó) y hay guard sobre TODO el archivo, no sobre una función.
- [x] **T4.7** — `selection-priority.test.ts` + `wiring.test.ts`: la tabla de casos del design §6.1 (los nueve), el determinismo (RBM5.8), el `available` de MFi con lista vacía y con cadena sintética, y la **regresión** de `selectTransportAdapter` para `mock`/`manual`/`demo` y para Android/web sin preferencia (RBM5.9). Cubre: RBM5.1–RBM5.10.
  - **(as-built)** el test viejo `RMV2.7 regresión` se **partió en dos** para que el requisito quede legible: uno congela lo que RBM5.9 congela (los tres modos + `auto` en Android/web + las plataformas sin transporte) y otro declara el ÚNICO cambio, con su autorización citada (`RBM5.6`: el piso de iOS). Se agregaron: la matriz completa de determinismo, que la preferencia **no puede** cambiar `mock`/`manual`/`demo` recorriendo TODO el union de `AdapterKind`, y el invariante de forma "todo `available:false` trae motivo / todo `available:true` no lo trae" sobre 7 drivers × 4 plataformas × 3 builds × 2 listas de protocolos (con anti-vacuidad: la matriz tiene que producir bindings de los dos signos).
- [x] **T4.8** — `connection-view.ts` (PURO) + `StickConnectionScreen.tsx`: `BUILT_ADAPTERS` += `'ble-gatt'`, `'mfi-ios'`; ramas de `TransportInstructions` para BLE (escanear → listar → elegir → conectar) y para MFi (Accessory Picker + el copy honesto por `reason` con CTA a la carga manual, **sin** intentar conectar). Cubre: RBM5.14, RBM4.5.
  - **(as-built, DESVIACIÓN deliberada)** `BUILT_ADAPTERS` suma `'ble-gatt'` y **NO** `'mfi-ios'`: `adapter-mfi-ios.ts` es **F5** y todavía no existe, así que declararlo construido haría que su binding saliera `available:true` sobre un transporte que `instantiateTransport` no puede montar — la afordancia muerta que el bugfix del 2026-07-29 cerró. La conjunción de RBM5.5 se ejercita igual (la entrada es inyectable). **F5 tiene que agregarlo Y actualizar el guard que hoy verifica su ausencia, en el mismo diff.**
  - **(as-built)** el copy **entero** de las instrucciones (no solo las ramas nuevas) se mudó a la vista pura, con las 5 cadenas viejas verbatim + test de regresión, y las claves quedaron ancladas al union por typecheck → una rama de copy nueva nace en rojo. La rama BLE **no** promete "listar → elegir": ver la nota de reconciliación de RBM5.14.
  - **(as-built)** entró además un override de copy por transporte en la **card de estado** (`connectionStatusView`, `env.transportKind` opcional): en GATT "conectar" es BUSCAR, así que `scanning` dice *"Buscando el bastón…"* y `disconnected` ofrece *"Buscar de nuevo"*. No toca `tone`/`cta`/`icon`/`connected` → el invariante fila-vs-card se mantiene, y sin `transportKind` la card es idéntica a antes del delta.
- [x] **T4.9** — `connection-view.test.ts`: casos nuevos del copy por transporte y por `reason`, con el invariante ya existente de que el tono de la fila no contradice al de la card. Cubre: RBM5.14.
  - **(as-built)** el invariante de tono **no ejercitaba** el `transportKind`: su matriz (`ROW_ENVS`) no lo tenía, así que el override podía contradecir a la fila sin que nada se pusiera rojo. Se le agregaron 4 combinaciones (con y sin transporte, `ble-gatt` y `spp`, con y sin auto-connect agotado). Y se fijó la **consecuencia visible** de RBM5.12: la fila del bastón BLE dice *"Emulador ESP32 (banco de pruebas)"* y es accionable.

### Fase F4-b — fix-loop del review (tasks que el spec no tenía y el as-built sí)

> Salen del review de F4 (`progress/review_ios-ble-mfi-f4.md`, veredicto CHANGES_REQUESTED). Se escriben como
> tasks porque son **código nuevo**, no reconciliación de prosa: la regla es que `tasks.md` quede con las tasks
> reales. Informe: `progress/impl_ios-ble-mfi-f4.md` §11.

- [x] **T4.10** — 🟠-1 · `adapter-ble-gatt.ts`: partir el borde del módulo nativo en `BleModuleEnv`
      (`nativeModulePresent()` **consulta** / `constructManager()` **construye**) y que
      `isBleGattTransportAvailable()` **solo consulte** — en iOS construir el `BleManager` crea el
      `CBCentralManager` y **es** el primer uso de la radio, así que hacerlo en `instantiateTransport` (primer
      render del provider) le mostraba el diálogo del SO a un operario que no tocó nada. Corregir además el
      comentario de `autoConnect` y la nota de T3.10, que afirmaban lo contrario. Oráculo: test que **cuenta
      construcciones** en un arranque en frío completo (0) con control positivo (1) y cacheo. Cubre: RBM3.8,
      RBM2.3.
- [x] **T4.11** — 🟠-2 · el camino de ESCRITURA de la preferencia: `transportChoices` (puro, con el registro
      **inyectado** por RBM1.7) + `mountActionFor` + `chooseTransport` en el provider + la banda de filas en
      la pantalla, **afuera del ternario `isSpp`** + `rememberedDeviceIdFor` (el id recordado no se presta
      entre transportes). Cubre: RBM5.6, RBM5.14, RBM5.7.
  - **(as-built, bug que cazó la E2E del capture y no un test puro)** la oferta se derivaba con `mode:'auto'`
    **hardcodeado**, y en `mock`/`demo` —donde corren las ~70 specs— el kind montado NO es el piso de la
    plataforma, así que el piso aparecía como "alternativa": `/baston` renderizaba **dos filas idénticas** y
    tocar la segunda no montaba nada (esos modos ignoran la preferencia, RBM5.9). El modo pasó a ser entrada
    **requerida** de `transportChoices` y viaja por el api del provider (`providerMode`). El oráculo que lo
    cazó —`expect(row).toHaveCount(1)`— quedó en el capture como regresión.
  - **(as-built, hallazgo de la autorrevisión)** **el gesto le gana a la hidratación**: la lectura del bastón
    recordado es asincrónica (techo de 2 s), así que un operario que elige otro transporte mientras está en
    vuelo veía el transporte elegido **desmontarse solo** dos segundos después. Con guard.
  - **(as-built, un guard existente haciendo su trabajo)** el `registry` de `transportChoices` es **requerido
    y sin default**: poner `DRIVER_REGISTRY` como default hizo caer el guard de **ceguera al fabricante**
    (RBM1.7) sobre `adapter-selection.ts`, que es exactamente la puerta del `DRIVER_REGISTRY[0].frameParser`
    que el review de F1 falsificó. Lo pasa la pantalla, que sí conoce lectores porque muestra sus nombres.
- [x] **T4.12** — Los guards del fix-loop, escritos **sobre la ausencia**: (a) alcanzabilidad — todo kind
      construido y usable en una plataforma es alcanzable ahí (piso, o honrado + ofrecido + con escritor), y lo
      no construido **no** se honra como preferencia (🟡-1: `'mfi-ios'` entra a `NOT_SELECTABLE_AS_PREFERENCE`
      hasta F5); (b) 🟡-3 — la lista de módulos habilitados a escribir la clave del bastón recordado es
      **cerrada** y sale de barrer el árbol, y la clave de storage vive en un solo lugar; (c) el probe de
      "se puede instanciar" de la pantalla no puede driftar del de `instantiateTransport`; (d) el lector que
      promete cada fila es el que el adapter va a usar de verdad. Cubre: RBM5.6, RBM5.11, R8.7.

## Fase F5 — T3: `adapter-mfi-ios` (prearmado y gateado)

- [x] **T5.1** — **Antes de escribir nada**: leer el fuente instalado de la rama iOS de `react-native-bluetooth-classic` (`ios/conn/*.swift`, `device/NativeDevice.swift`) y confirmar qué expone a JS (listar accesorios por protocolo, abrir sesión, leer el stream). Si no alcanza → **PARAR y reportar al leader**. Cubre: RBM4.8.
  - **(as-built) VEREDICTO: ALCANZA, y NO se para** — la pregunta abierta nº1 del delta queda **RESUELTA**. Las tres capacidades existen en JS: listar (`getBondedDevices()` → `EAAccessoryManager.connectedAccessories` mapeados por `NativeDevice.map()`), abrir la sesión (`connectToDevice(id, options)` → `determineProtocolString` cruza el plist con `accessory.protocolStrings` y abre una `EASession`) y leer el stream (evento `DEVICE_READ@<serialNumber>` vía `device.onDataReceived`).
  - **(as-built) SIETE hallazgos del fuente cambiaron la forma del adapter**, y el nº7 lo encontró la SEGUNDA pasada de esta fase: **el wrapper JS de la lib se come `protocolStrings`**. El nativo sí publica la clave, pero `BluetoothModule.getBondedDevices()` devuelve un `BluetoothDevice` por accesorio que copia ocho campos y **no ese** (queda en su privado `_nativeDevice`). Leyendo solo la forma cruda —que es lo que la primera pasada hacía— TODO accesorio salía con `protocolStrings: []`, `pickMfiAccessory` devolvía `null` SIEMPRE y el transporte quedaba clavado en `mfi_accessory_not_found`: o sea **RBM4.7 falso el día que llegue la cadena**, con el síntoma más caro de esta unidad ("no pasa nada"). Cerrado en `mfiProtocolStringsOf` (acepta las dos formas) + guard **derivado del paquete instalado** para que un `pnpm update` que cambie la forma nazca en rojo. Los otros seis están en la cabecera de `adapter-mfi-ios.ts`. Detalle: `progress/impl_ios-ble-mfi-f5.md` §1.
- [x] **T5.2** — `adapter-mfi-ios.ts`: `StickAdapter` (`kind:'mfi-ios'`), **sin dependencias nuevas**. Con la lista de protocolos **vacía**, `connect()` corta en el primer `if` → estado "no disponible" + `mfi_unavailable{reason}`, **sin** `require` de la lib y **sin** leer `NativeModules` (leerlo instancia el módulo nativo en bridgeless). Cubre: RBM4.1, RBM4.2.
  - **(as-built)** el borde del módulo nativo entra por un `MfiModuleEnv` **inyectable** de tres operaciones con costos distintos (`platformIsIos` / `nativeModulePresent` / `loadNative`), igual que el `BleModuleEnv` de F4 y por el mismo motivo: el oráculo de RBM4.2 **cuenta toques al nativo** en un arranque en frío completo (disponibilidad + adapter + `autoConnect` + `connect`) → tiene que dar **cero**, con control positivo (con la cadena declarada da >0). Los dos mutantes que lo tocan eager mueren.
  - **(as-built)** el gate vive en UN solo lugar (`resolveGate`) y es **puro**; sus **seis** motivos van al log por separado (`mfi_unavailable{reason}`) porque desde la UI se ven idénticos (nada) y mandan a lugares distintos: al fabricante, a `app.config.ts`, al registro de drivers o al build. Se agregó `delimitador-no-soportado` (el sexto), que el task no anticipaba: en iOS el terminador tiene que ser de **UN carácter** (el `read()` nativo consume el delimitador con `index(after:)`, que avanza UNO), así que un `\r\n` parte mal cada trama a partir de la segunda — se rechaza ANTES de conectar. **En Android el multi-carácter SÍ funciona**: es una diferencia real entre las dos ramas de la misma librería y hay un test diferencial para que nadie las "unifique".
  - **(as-built)** el adapter trae las **diez lecciones del SPP** (RBM3) escritas desde el día uno y no "para cuando se destrabe", porque RBM4.7 exige que ese día no haya código nuevo: presupuesto en todo await del puente, latch con generación liberado en `finally` y en `disconnect()`, socket huérfano, desconexión filtrada por NUESTRA dirección (el evento es **GLOBAL** en iOS), segunda fuente de verdad del liveness (poll + foreground) fail-closed, foreground chequeado AL DISPARAR, tope de la cadena sin gesto (dos veces, y las dos con su propio oráculo), dwell del backoff y watchdog de mudez.
  - **(as-built)** `mfiConnectOptions()` es PROPIO y **no** reusa `sppConnectOptions()`: el nativo de iOS hace `String.Encoding.from(value as! CFStringEncoding)` (force-cast a UInt32) y el del SPP pasa `charset: 'ascii'` (un STRING) → ese mismo objeto en iOS **no falla la conexión: crashea la app**. Hay guard estático que prohíbe la "simplificación".
- [x] **T5.3** — ~~`adapter-selection.ts` / `permissions.ts`: `'mfi-ios'` en `AdapterKind`, `ADAPTER_KINDS`, `ADAPTER_INGEST_MODE` (`raw-line`) y `permissionModelFor` (`{ kind:'ios-mfi' }`)~~; parametrizado por el `frameParser` del driver (T1). Cubre: RBM4.9.
  - **(hecho en F4, con su motivo de compilación — reconciliado en el fix-loop del review de F4, 🟡-2)** Las **cuatro** entran en F4 y no acá: T4.1/RBM5.2 exigen que `adapterForTransport('mfi','ios')` devuelva el literal `'mfi-ios'` y RBM5.5 que su binding calcule `available`, o sea que **el union tiene que tener el kind para que F4 compile** — y agregarlo al union deja en rojo por typecheck las otras tres tablas (`ADAPTER_KINDS`, `ADAPTER_INGEST_MODE`, `permissionModelFor`), que es el mecanismo funcionando. Ya tienen test (`wiring.test.ts`: *"`mfi-ios` tiene su PROPIO modelo de permiso"*; `adapter-ingest-mode.test.ts` recorre `ADAPTER_KINDS`).
  - **Lo que QUEDA para F5**, para que no haya que deducirlo: (a) `adapter-mfi-ios.ts` (T5.2); (b) agregarlo a `BUILT_ADAPTERS` de la pantalla **y actualizar en el mismo diff** el guard que hoy verifica su ausencia (`wiring.test.ts`); (c) **sacarlo de `NOT_SELECTABLE_AS_PREFERENCE`** (entró ahí en el fix-loop de F4, 🟡-1: hasta que exista el adapter, honrar esa preferencia deja al iPhone sin transporte); (d) cablear su fila en la banda de transportes elegibles y que el adapter **escriba `adapterKind:'mfi-ios'`** al conectar — el guard de alcanzabilidad de `wiring.test.ts` **nace en rojo** hasta que (b), (c) y (d) estén; (e) registrar `adapter-mfi-ios.test.ts` en `run-tests.mjs`.
  - **(as-built F5) las cinco están hechas, y (d) con una precisión que cambia cómo se lee el guard.** (b) `BUILT_ADAPTERS` suma `'mfi-ios'` y el guard se invirtió citando **RBM4.5 + RBM4.7** (con el kind afuera, el binding de un lector MFi diría `adapter-no-construido` —"todavía no lo soportamos"— cuando la verdad es `build-sin-protocolos` —"falta la autorización del fabricante"—: el motivo equivocado manda a buscar el dato equivocado). (c) `NOT_SELECTABLE_AS_PREFERENCE` queda con `hid-wedge` **solo**, y hay un test que lo DERIVA del union en vez de espejar la lista. (d) el adapter escribe su `adapterKind` ✅, y su probe entró en `TRANSPORT_INSTALLABLE` ✅ — pero **la fila no se "cablea": aparece sola** en cuanto un driver declare `mfi`, porque `transportChoices` recorre el REGISTRO. Hoy ninguno lo declara (RBM4.6), así que la fila no existe **en ningún teléfono**, y eso no es un cableado faltante sino un DATO faltante que un requisito impone. El guard de alcanzabilidad se reescribió para distinguir las dos cosas: exime al par `ios/mfi-ios` **nombrándolo, con la exención cerrada y su motivo verificado** (el registro real no tiene lectores `mfi`), y hay un **test hermano** que corre el mismo invariante con un driver MFi sintético + su cadena declarada y exige que el par pase entero. Sin ese hermano, "no se puede cumplir" sería indistinguible de "no lo cableé" — que es la forma en que un guard sobre la ausencia se afloja sin que se note. (e) registrada, con el motivo escrito en `run-tests.mjs`.
- [x] **T5.4** — Confirmar que `RS420_DRIVER` **sigue sin declarar** el transporte `mfi` (no se inventa ninguna `protocolString`). Cubre: RBM4.6.
  - **(as-built)** verificado por COMPORTAMIENTO y en tres lugares, no por lectura: `ea-protocols.test.ts` (`RS420_DRIVER.transports.some(t => t.kind === 'mfi') === false`), `selection-priority.test.ts` (su binding en iOS es `null`, no un MFi fantasma) y `wiring.test.ts` (el REGISTRO entero no tiene ni un lector `mfi`, que es lo que hace que hoy la fila no exista en ningún teléfono). Las únicas menciones de `mfi` en `driver-rs420.ts` son comentarios que explican **por qué no lo declara**.
- [x] **T5.5** — `ea-protocols.test.ts` + `adapter-mfi-ios.test.ts`: lista vacía → no disponible **y el módulo nativo no se carga** (verificable con un doble que registre si se lo pidió); cadena sintética declarada + driver sintético que la declara → `available:true`; cadena que el build no declara → `available:false` con `reason`. Cubre: RBM4.2, RBM4.4, RBM4.5.
  - **(as-built)** `adapter-mfi-ios.test.ts` son **55 tests** con el entorno inyectado (el doble cuenta los toques al nativo, como pedía el task) y `ea-protocols.test.ts` pasó de 18 a 25. **16 mutantes, 16 muertos** (tabla en `progress/impl_ios-ble-mfi-f5.md` §5), incluidos los dos obligatorios del contrato: el que toca el nativo con la lista vacía y el que **borra la clave** `UISupportedExternalAccessoryProtocols` de `app.config.ts`.
  - **(as-built, un mutante que SOBREVIVIÓ y obligó a escribir un test)** borrar el chequeo del tope de la **cabecera** de `scheduleReconnect` (dejando el del timer) no mataba nada: no eran dos oráculos, era un oráculo y un cinturón — el mismo hallazgo que el review de F3 dejó escrito para el BLE. El caso que solo cubre la cabecera es *"el presupuesto vence MIENTRAS hay un intento en vuelo y la app se fue a background"*: sin ella la cadena se parquea esperando el foreground y vuelve a martillar la radio cuando el operario saca el teléfono del bolsillo, o sea **el tope se vuelve evitable guardando el teléfono**. Test nuevo (necesitó que el doble pudiera rechazar DESPUÉS del gate) y ahora los dos mutantes caen.
- [x] **T5.6** — Documentar en el design **el diff exacto** que destraba MFi el día que llegue el dato (una línea en `app.config.ts` + una `TransportCapability` en el driver) y dejar el test de T5.5 como su prueba ejecutable. Cubre: RBM4.7.
  - **(as-built)** el diff está en el design §5 y su prueba ejecutable son **tres** cosas, no una: (a) `ea-protocols.test.ts` toma la config REAL de la app, le agrega la cadena sintética **en la ruta que producción lee** y el binding pasa a `available:true`; (b) `adapter-mfi-ios.test.ts` corre **el transporte entero** con esa cadena (listar → filtrar por protocolo → abrir la sesión → stream → EID) con **dos** perfiles de driver que difieren en la cadena Y en el fin de trama, así que los dos parámetros quedan probados como "salen del driver" y no como literales; (c) `wiring.test.ts` corre el invariante de **alcanzabilidad** inyectando solo esos dos datos y exige que `mfi-ios` quede honrado + ofrecido + con escritor — o sea que el CABLEADO ya está y lo único que falta es el dato.

### Fase F5-b — lo que el spec no tenía y el as-built sí

> No es reconciliación de prosa: es **código y guards nuevos**. La regla es que `tasks.md` quede con las
> tasks reales. Informe: `progress/impl_ios-ble-mfi-f5.md`.

- [x] **T5.7** — `ea-protocols.ts`: `mfiProtocolStringsOf` (hallazgo nº7) + el guard **derivado del paquete
      instalado** que ata las dos formas (el mapa nativo publica `protocolStrings` / el wrapper JS no la copia
      y conserva `_nativeDevice` / `getBondedDevices()` devuelve wrappers). Sin esto el filtro por protocolo
      está muerto y el mundo malo es mudo. Cubre: RBM4.4, RBM4.8.
- [x] **T5.8** — `spp-bridge-timeout-guard.test.ts`: declarar `adapter-mfi-ios.ts` en `RADIO_ADAPTERS` con
      sus prefijos de puente. **El guard lo hizo nacer en rojo**, que es para lo que se escribió derivado del
      árbol en F3 (RBM3.3). Se corrigió además un punto ciego del CONTADOR de usos del mecanismo: el regex no
      matcheaba `withTimeoutOr<void>(…)`, así que subestimaba los usos en los TRES adapters (F5 tiene 8 y
      contaba 7). Un contador que subestima puede pedir un uso "de relleno", que es lo contrario de lo que la
      cota quiere decir. Cubre: RBM3.2, RBM3.3.
- [x] **T5.9** — `wiring.test.ts`: los tres guards del fix-loop de F4 actualizados **en el mismo diff** que
      construye el transporte —lista CERRADA de escritores de la preferencia (+`adapter-mfi-ios.ts`), el
      filtro `rememberedDeviceIdFor` por transporte con `acceptsLegacy:false`, y `BUILT_ADAPTERS`— más el de
      alcanzabilidad, reescrito con la exención nombrada + su test hermano con la cadena sintética (ver la
      nota de T5.3). Cubre: RBM4.5, RBM4.7, RBM5.6, RBM5.7.
- [x] **T5.10** — `selection-priority.test.ts`: los dos tests que el delta volvió falsos **a propósito**,
      reescritos citando el requisito que lo autoriza (`RBM4.4`/`RBM5.2` para la preferencia `mfi-ios`, que
      ahora SÍ se honra en iOS y en ningún otro lado; `RBM4.1`/`RBM5.14` para la fila del lector MFi, que
      ahora SÍ se ofrece con su motivo honesto). `BUILT_TODAY` suma `'mfi-ios'` y entró `BUILT_WITHOUT_MFI`
      para no perder el caso que prueba el ORDEN del chequeo de `available` ("construido primero"), que sin un
      build donde falte el adapter deja de ser observable. Cubre: RBM4.4, RBM4.5, RBM5.2, RBM5.14.
- [x] **T5.11** — `app/e2e/captures/baston-ios-ble-mfi-f5.capture.ts` (Gate 2.5 / ADR-029). F5 **no agrega
      ninguna superficie nueva** —y no solo en web: hoy la fila MFi no existe en ningún teléfono porque ningún
      driver declara `mfi`—, así que lo que el capture entrega es el ORÁCULO de que no rompió nada visible:
      una sola fila de dispositivo (el oráculo que cazó el bug de las dos filas en F4-b), cero rastro del copy
      de MFi, y —escenario **nuevo** de F5— un bastón recordado con `adapterKind:'mfi-ios'` sembrado en
      `localStorage`: hasta F4 lo frenaba una lista, ahora lo frena la tabla de plataforma, así que se exige
      que la pantalla siga entera y caiga al piso de web. 4 capturas generadas y verificadas. Cubre: RBM9.7.
- [x] **T5.12** — `run-tests.mjs`: registrar `adapter-mfi-ios.test.ts` (era el punto (e) de T5.3, y con esto
      la lista del delta queda **6 de 6**). ⚠️ Archivo compartido con la otra terminal: se agregó solo dentro
      del bloque de tests del cliente y se verificó que su bloque (rebrand fase 5 + `stage-runner`) siguiera
      intacto. Cubre: todas.

## Fase F5-fix — fix-loop del Gate 2 (HIGH-1 + MEDIUM-2)

> Entrada: `progress/security_code_04-ios-ble-mfi.md` (veredicto FAIL). Informe:
> `progress/impl_ios-ble-mfi-gate2-fix.md`. Alcance cerrado a los dos findings: **no** se empezó F6 ni F7.

- [x] **TF.1** — `line-framer.ts`: tope del buffer (`LINE_FRAMER_MAX_BUFFER = 4096`, parametrizable pero
      **no apagable**: `0`/`Infinity`/`NaN` caen al default), descarte **fail-closed con log**
      (`ble_framer_overflow`, sub-evento de `read_loop_error`) y **resync** — la primera línea que cierra
      después del descarte no se emite, porque le falta el principio y un parser que BUSQUE el EID en vez de
      anclarlo podría extraer uno que nadie leyó. `flush()` post-descarte devuelve `null` por el mismo
      motivo. Cubre: RBM2.19, RBM1.8.
- [x] **TF.2** — `adapter-ble-gatt.ts`: dos relojes (`lastLineAt` = salud, `lastByteAt` = bytes crudos) y el
      watchdog distingue TRES causas: mudez real (`connected_silent`, RBM3.10 sin cambios) vs. bytes que no
      cierran trama (`ble_stream_unframed`, con los dos intervalos). Cubre: RBM3.12.
- [x] **TF.3** — `line-framer.test.ts` (**el archivo no existía**): 12 tests con el caso legítimo primero
      —trama partida en notificaciones de 20 bytes, troceo de a 1 carácter, ráfaga de 500 tramas pegadas, fin
      de trama de dos caracteres partido entre chunks—, el tope, el evento distinguible, el no-envenenamiento,
      el resync, `flush`/`reset`, "el tope no es opcional" y el presupuesto de costo (25.000 notificaciones:
      medido 4-6 ms con tope, 2200-2450 ms sin tope). Cubre: RBM2.19.
- [x] **TF.4** — `adapter-ble-gatt.test.ts`: dos tests nuevos —el chorro sostenido llega al log del transporte
      y el transporte sigue leyendo después (fail-closed no es fail-dead), y el reloj de salud no lo mueve la
      basura— más las aserciones de MEDIUM-2 dadas vuelta (antes exigían que el identificador ESTUVIERA en el
      log; ahora exigen que no esté en ninguna línea). Cubre: RBM2.19, RBM3.12, RBM5.13.
- [x] **TF.5** — MEDIUM-2: el escaneo loguea el **ordinal** del dispositivo no reconocido y no su
      identificador; `device_id` entra a `PII_KEYS_RAW` de `redact.ts` (defensa en profundidad para el
      `connect_superseded { deviceId }`, que sí es un campo con clave) + 2 tests en `redact.test.ts`, uno de
      ellos documentando por comportamiento **por qué** el scrubber key-based no puede ser la defensa
      principal. Cubre: RBM5.13.
- [x] **TF.6** — Falsificación: **7 mutantes**, uno por invariante, todos MUEREN, con control positivo sin
      mutar en verde y restauración verificada contra backup propio. La lista vive en la cabecera de
      `line-framer.test.ts` y el detalle en el informe. Cubre: RBM2.19, RBM3.12, RBM5.13.
- [x] **TF.7** — `run-tests.mjs`: registrar `line-framer.test.ts` en la lista **explícita** (un test que no
      corre da falsa confianza). ⚠️ Archivo compartido: se verificó que el bloque de **rebrand fase 5** y el
      de `stage-runner` siguieran intactos. Cubre: todas.
- [x] **TF.8** — Reconciliación de specs: **RBM2.19** y **RBM3.12** nuevos, notas bajo RBM2.8 / RBM3.10 /
      RBM5.13, y `design-ios-ble-mfi.md` §4.1 con el as-built (incluidas las dos decisiones de forma y el
      hallazgo del meta-guard de cobertura sobre `ble/logging.ts`, que queda como recomendación al leader).
      Cubre: RBM7.x (mismo patrón `impl_13`).


## Fase F5-followup — los DOS hallazgos §7 que el fix-loop dejó fuera de alcance

> Entrada: `progress/impl_ios-ble-mfi-gate2-fix.md` §7. Informe:
> `progress/impl_ios-ble-mfi-gate2-followup.md`. El leader decidió el camino de cada uno antes de
> despachar. Alcance cerrado a los dos hallazgos: **no** se empezó F6 ni F7, no se commiteó.

- [x] **TG.1** — §7.1: `utils/scan-coverage.ts` gana una allowlist **compartida** (`SCAN_COVERAGE_ALLOW`)
      con **UNA** entrada —`src/services/ble/logging.ts`— y el motivo escrito **en el lugar**. La exención
      pasa a ser **por chequeo**: exime del piso de retención y el balance de llaves **le sigue corriendo**
      (antes el `allow` era un `continue` que sacaba el archivo del escaneo). Cubre: RBM9.10.
- [x] **TG.2** — §7.1: `utils/scan-coverage.test.ts` (nuevo) — **el freno** de la allowlist: motivo
      sustantivo y no un puntero, tope de entradas, el archivo eximido existe, la exención está **GANADA**
      contra el árbol real (si sobra, rojo), la exención es **angosta** en las dos direcciones, la puerta es
      **UNA** (ningún guard pasa `allow` inline — verificado sobre `app/app` + `app/src` **y la raíz de
      `app/`**) y todos los guards calculan el **mismo label**. Cierra con **la demostración**: el mutante de
      dos líneas sobre el archivo real, medido CON y SIN la entrada. Cubre: RBM9.10.
- [x] **TG.3** — §7.2: `services/ble/error-text.ts` (nuevo) — `safeErrorText(e, deviceId?)`: `errorCode:<n>`
      cuando el código interpola `{deviceID}`, y si no el mensaje con el id exacto y las MAC blanqueados a
      `<device>`, acotado a 240 caracteres. Cubre: RBM9.9.
- [x] **TG.4** — §7.2: **los tres adapters**. Se borran los tres `errorMessage(e)` locales (las tres copias
      devolvían `e.message` crudo) y todos los call sites pasan por `safeErrorText`; los que conocen el
      device se lo pasan (`verifyLiveness` ×3, `ble_monitor_lost`, `ble_disconnected`, `connect_path` ×3 y
      `logBridgeFailure` con un cuarto parámetro opcional). El `let target` del MFi se declara **fuera del
      `try`** para que el `catch` pueda blanquear el serial. Cubre: RBM9.9.
- [x] **TG.5** — §7.2: `error-text.test.ts` (nuevo, 12 tests). El principal **DERIVA** de
      `node_modules/react-native-ble-plx` la lista de códigos cuya plantilla interpola `{deviceID}` y exige
      que la tabla declarada la contenga —una tabla copiada a mano se pudre, y esa es la lección del union
      `RejectReason`—; el resto cubre las dos vías, los controles negativos (un UUID de servicio NO se
      blanquea, un mensaje sin id NO se degrada) y el tope. Cubre: RBM9.9.
- [x] **TG.6** — §7.2: `log-device-identifier-guard.test.ts` (nuevo) — el **guard sobre la ausencia**, con
      sus tres reglas, su anti-vacuidad (dispara sobre el cuerpo VIEJO) y su control de falsos positivos
      (no dispara sobre lo que hoy es correcto). Declara lo que NO cubre. Cubre: RBM9.9.
- [x] **TG.7** — §7.2: barrido de **comportamiento** en las tres suites de adapter (4 tests en `ble-gatt`,
      2 en `spp-android`, 2 en `mfi-ios`): con un error de la lib que interpola el id, ningún `message` de
      ningún evento lo lleva — y la causa sigue estando (`errorCode:201`, `Connection to <device> failed.`).
      Uno es un barrido de **clase** sobre un flujo entero, no una lista de eventos. Cubre: RBM9.9.
- [x] **TG.8** — Falsificación: **13 mutantes**, todos con el desenlace esperado (M1 verde a propósito: es
      la dirección "con la entrada NO rompe"), control positivo sin mutar en verde y árbol restaurado byte a
      byte contra backup propio. Detalle en el informe. Cubre: RBM9.9, RBM9.10.
- [x] **TG.9** — `run-tests.mjs`: registrar los tres tests nuevos. ⚠️ Archivo compartido: se verificó que el
      bloque de **rebrand fase 5** y el de `stage-runner` siguieran intactos y en verde (77/77). Cubre: todas.
- [x] **TG.10** — Reconciliación de specs: **RBM9.9** y **RBM9.10** nuevos, nota de reconciliación bajo
      **RBM5.13** (de la instancia a la clase), cierre del pendiente que §4.1 del design había dejado
      abierto, y `design-ios-ble-mfi.md` **§4.2** con el as-built completo. Cubre: RBM7.x (patrón `impl_13`).

## Fase F6 — T5: banco del emulador en `MODO_GATT` (device)

- [ ] **T6.1** — Flashear el ESP32 con `-DEMU_MODE=MODO_GATT`; verificar con `selftest` y `status`; renombrarlo con `name` para ejercitar **reconocido** (`EMU-GATT-STICK`) y **no reconocido**. Cubre: RBM6.1, RBM5.13.
- [ ] **T6.2** — **Android** (build local, 0 EAS): correr los escenarios del design §9 — stream, dedup dentro/cruzando la ventana, ráfagas, 20 animales, las 10 malformadas, `split`, `double`, `drop`, `off`, `flap` (backoff **creciente**), `mute`, corte con la app **minimizada** (BENCH-1) y desconexión de **otro** device BLE. Cubre: RBM6.1, RBM6.2, RBM3.4, RBM3.5.
  - **(cómo se ARRANCA el banco en Android — cableado en el fix-loop del review de F4, 🟠-2)** El piso de Android es `spp-android`, así que el primer paso del banco es **elegir el transporte BLE**: `Más → Bastón → Dispositivos`, la fila *"Emulador ESP32 (banco de pruebas)"* (debajo de la lista de emparejados) → tocarla monta `ble-gatt` **y conecta** (escaneo filtrado buscando `EMU-GATT-STICK`). Antes de este fix ese paso **no existía** y el banco de Android no tenía por dónde empezar (la preferencia solo se auto-escribía).
  - **Y el escenario de la PERSISTENCIA, que es lo que el fix compra**: conectado por BLE → cerrar la app del todo → reabrirla → tiene que montar `ble-gatt` **solo** (no `spp-android`) y reconectar al mismo device. Después tocar la fila *"Allflex RS420"* de esa misma banda → tiene que volver a `spp-android`. Y "Olvidar el bastón guardado" → el próximo arranque vuelve al piso.
  - **Un caso que el unit no puede probar y el banco sí**: con un bastón recordado **del otro transporte**, el transporte elegido tiene que **escanear** (no dialar el id ajeno). Si se quedara "conectando" para siempre, es el mundo malo del punto 5 de la nota de RBM5.6.
- [ ] **T6.3** — `chunk 20` vs `chunk 0` → **resultado idéntico** (el reensamblado no depende del troceo). Cubre: RBM6.3, RBM2.12.
- [ ] **T6.4** — **iOS**: mismo banco. ⚠️ Requiere un build de EAS → **pedir el OK explícito de Raf, por plataforma y por build**, y recién pedirlo con el unit + el banco de Android **ya en verde** (un build es recurso agotable: plan Free, 30/mes, ya se agotaron una vez). Cubre: RBM6.4, RBM9.8.
  - **(escenario agregado en el fix-loop del review de F4, 🟠-1 — RBM3.8 en device)** **PRIMERA medición, antes de cualquier otra**: instalación **limpia** (borrar la app), sin bastón recordado, abrir la app y **no tocar nada** → el diálogo de permiso de Bluetooth del sistema **NO debe aparecer**. Es lo que el fix de 🟠-1 sostiene por construcción (la construcción del `CBCentralManager` quedó detrás de los gates) y lo único que un unit no puede probar. Si aparece igual, el hallazgo va al veredicto: el siguiente sospechoso es que leer `NativeModules.BlePlx` en bridgeless ya instancie CoreBluetooth, y la mitigación sería mover **ese** chequeo detrás de un gesto (deja al chip/CTA ocultos hasta el primer tap).
  - Y la contraparte: **con** un bastón recordado, abrir la app **sí** debe reconectar solo (R6.4) — si no, el fix se pasó de conservador y el arranque quedó sin poder tocar la radio nunca.
- [ ] **T6.5** — Documentar el banco en `progress/bench_baston-gatt-emulador.md`: un escenario que dé distinto de lo esperado va como **hallazgo**, no como verde; y la sección de **qué NO valida** el emulador (las mañas de un HR5 v3 real, que no tenemos). Cubre: RBM6.5, RBM6.6.
- [ ] **T6.6** — Capturas del flujo BLE **desde el device** para el Gate 2.5, con la aclaración de que la E2E web no puede cubrir esta superficie (en web el binding es `serial`). Cubre: RBM9.7.
  - **(lista concreta de lo que quedó sin evidencia visual, cerrada en el fix-loop del review de F4)** Las tres cosas que web **no puede** fotografiar y que Raf tiene que ratificar acá: (a) la fila *"Emulador ESP32 (banco de pruebas)"* en **iOS** (🟡-4 del review de F4: hoy es la única fila que un iPhone muestra); (b) la **banda de transportes elegibles** en **Android** (fila del BLE debajo de los emparejados, y la del RS420 cuando el montado es el BLE — 🟠-2); (c) las instrucciones y el copy de `ble-gatt` (*"Buscando el bastón…"* / *"Buscar de nuevo"*). Hasta que esto exista, **el veto visual de F4 es PARCIAL** y así hay que declararlo.

## Fase F7 — T7.1: el adapter HID *(condicional: solo si F0 dio verde en (a)(b)(c)(d))*

> **Si T7.0.8 clasificó el resultado como desenlace (2) o (3), esta fase NO se ejecuta.** En el (2) el camino se cierra con evidencia; en el (3) se ajusta el campo de scan y se **re-corre F0** antes de volver acá.

- [ ] **T7.1.1** — `adapter-hid-wedge.ts`: reemplazar el placeholder por un `StickAdapter` real detrás de la **MISMA** interfaz, sin tocar el contrato de ingesta (R10.3 / R11.3), con la captura de keystrokes y el **terminador que el gate midió** (no el que suponíamos). Cubre: RBM8.4.
- [ ] **T7.1.2** — Mantener `ADAPTER_INGEST_MODE['hid-wedge'] = 'eid'`. Si el gate mostró que algún wedge tipea la trama completa, eso se resuelve con **su propio driver**, no cambiando esa fila. Cubre: RBM8.8.
- [ ] **T7.1.3** — Tests del adapter (captura, terminador, foco, `enable`/`disable`) + el binding `hid-wedge` pasa a `available:true` en `BUILT_ADAPTERS`. Cubre: RBM8.4.
- [ ] **T7.1.4** — Reconciliar R8/R8.7 del core y la cabecera del archivo, que hoy dicen "GATED": el gate **se corrió** y con qué resultado. Cubre: RBM7.2.

## Fase F8 — T6: reconciliación y cierre

- [ ] **T8.1** — `requirements-multivendor.md`: notas de reconciliación bajo **RMV5.2** (la deuda del `frameParser` queda **cerrada**), **RMV1.6** (ahora es cierto), **RMV2.1/RMV2.2** (prioridad de iOS y mapeos nuevos) y **RMV6.2/RMV6.3** (ya no son "fuera de este delta"). No reescribir los EARS: notas, patrón `impl_13`. Cubre: RBM7.1.
- [ ] **T8.2** — Core `requirements.md` de spec 04: **R11.2** (ya no son "los 5 adaptadores"), **R12** (modelo de permisos del transporte BLE), **R8** (desenlace del gate). Cubre: RBM7.2.
- [ ] **T8.3** — **Recomendación de enmienda a ADR-024 para el leader** (no la redacta el spec_author): (a) el camino iOS-abierto real del mercado es **BLE-GATT** (HR5 v3), no solo HID; (b) la prioridad de transporte de iOS; (c) a Gallagher se le pide **documentación técnica**, no una licencia, y **Datamars** es un tercer interlocutor. Cubre: RBM7.3.
- [ ] **T8.4** — `docs/bastones-mercado-argentino.md` §"Qué falta": el pedido correcto por fabricante. Cubre: RBM7.4.
- [ ] **T8.5** — `firmware/baston-emulator/README.md`: la fila de `MODO_GATT` (*"sin implementar"*) y la de `MODO_HID` (*"con este modo el gate se puede correr"*) quedan viejas con este delta. Cubre: RBM7.5.
- [ ] **T8.6** — `app/plugins/with-bluetooth-classic.js`: el comentario que dice que `BLUETOOTH_SCAN` es *"para un descubrimiento futuro… no se usa hoy"* queda falso. Cubre: RBM7.6.
- [ ] **T8.7** — `scripts/run-tests.mjs`: registrar en la lista **explícita** las suites nuevas (`ble-gatt-protocol`, `adapter-ble-gatt`, `ea-protocols`, `adapter-mfi-ios`, `frame-parser-resolve`). Un test que no corre da falsa confianza. Cubre: todas.
  - **(parcial, hecho en F3)** quedaron registradas **3 de 5**: `frame-parser-resolve` (que **F1 dejó sin registrar** — su oráculo de comportamiento, el que el review de F1 exigió, no corría en el check), `ble-gatt-protocol` y `adapter-ble-gatt`. Se adelantó porque esperar a F8 dejaba tres fases enteras dando "verde" sin que estas suites corrieran nunca. Faltan `ea-protocols` y `adapter-mfi-ios`, que son de **F5** y todavía no existen. ⚠️ El archivo es **compartido con la otra terminal** (rebrand): se agregó solo dentro del bloque de tests del cliente y se verificó que su bloque (`backup-ci-consistency.test.mjs`, rebrand Cat. H) siguiera intacto.
  - **(parcial, hecho en F4)** `ea-protocols` **la escribió F4** (no F5: la lista inyectable es T4.2), así que se registró acá — junto con **`remembered-format`**, que la lista de esta task ni nombraba porque el módulo no existía cuando se escribió el spec. Van **4 de 6**; falta solo `adapter-mfi-ios` (F5).
  - **(cerrado en F5, T5.12)** `adapter-mfi-ios` registrada → **6 de 6**. El motivo quedó escrito en el propio `run-tests.mjs`: es la ÚNICA cosa que puede medir RBM4.2 (que el arranque en frío no toque el módulo nativo) y el único lugar donde este transporte se ejercita completo — no hay banco posible sin un accesorio con licencia MFi y sin la cadena del fabricante, así que si esa suite no corre, del MFi **no se sabe nada**. Verificado otra vez que el bloque de la otra terminal (rebrand fase 5 + el `stage-runner` nuevo) sigue intacto. El mundo malo de `remembered-format` es un teléfono ya instalado que queda sin poder reconectar en la manga por una migración de formato, y eso no lo ve ni el typecheck (el valor viene de storage, tipado `string`) ni la E2E. ⚠️ Verificado otra vez que el bloque de la otra terminal (rebrand fase 5: `request-headers.test.ts` + `backup-ci-consistency.test.mjs`) sigue intacto; el diff de `run-tests.mjs` es de **8 líneas** y todas en el bloque del cliente.
- [ ] **T8.8** — **Verificación de que Gate 1 es N/A, ATRIBUIBLE**: correr `git status --porcelain supabase/ sync-streams/` y **cruzar cada línea contra la lista de archivos que tocó este delta**; ninguna puede pertenecernos. ⚠️ NO usar `git diff`: mide el árbol (muestra el trabajo de la otra terminal) y es ciego a los **untracked** — el 2026-08-17 había un `?? supabase/migrations/0133_…` que ese comando no veía. Dejarlo escrito en el informe del implementer, nombrando de quién es cada línea ajena. Cubre: RBM9.1, RBM9.2.
- [ ] **T8.9** — Invariantes heredados, verificados y no asumidos: carga manual viva en **todos** los estados nuevos (RBM9.5); cero red en el camino del transporte (RBM9.4); ningún archivo de spec 09 tocado (RBM9.6); ningún método de `StickAdapter` modificado. Cubre: RBM9.3–RBM9.6.
- [ ] **T8.10** — `node scripts/check.mjs` en verde + `pnpm e2e` comparado contra el baseline (recordar: `check.mjs` **no** corre Playwright, y una corrida de E2E re-renderiza `design/**/*.png` — revertir esa carpeta antes de commitear). Cubre: todas.
- [ ] **T8.11** — Gate 2.5 (ADR-029): capturas de las superficies nuevas de la pantalla de conexión + las del device (T6.6), con el veto visual del leader antes de mostrárselas a Raf. Cubre: RBM9.7.

---

## Mapa `RBM<n>` → task

| Requisito | Task(s) |
|---|---|
| RBM1.1–RBM1.8 | T1.1–T1.9 |
| RBM2.1–RBM2.12 | T3.1–T3.8, T3.12, T3.13, **T4.10** (RBM2.3: el guard consulta, no construye) |
| RBM2.13, RBM2.14 | T2.5, T2.6, T2.7, T3.7, T3.12 |
| RBM2.15 | T2.3, T2.4 |
| RBM2.16 | T3.10 |
| RBM2.17 | T2.1, T2.2 |
| RBM2.18 | T2.0 |
| **RBM2.19** | **TF.1, TF.3, TF.4, TF.6** |
| RBM3.1–RBM3.11 | T3.9, T3.11, T3.12, T6.2, **T4.10 + T6.4** (RBM3.8 en iOS: el arranque en frío no construye el manager) |
| **RBM3.12** | **TF.2, TF.4, TF.6** |
| RBM4.1–RBM4.9 | T5.1–T5.6, T2.2, T2.3, T4.2 |
| RBM5.1–RBM5.10 | T4.1, T4.2, T4.5, T4.6, T4.7, **T4.11 + T4.12** (RBM5.6/RBM5.7: el camino de escritura de la preferencia y su guard de alcanzabilidad) |
| RBM5.11 | T4.3 (contraparte: **no** se registra el HR5 v3) |
| RBM5.12, RBM5.13 | T4.3, T4.4, **TF.5** (MEDIUM-2: el log no lleva el id del device ajeno), **TG.6** (y ahora un guard estático lo vigila) |
| RBM5.14 | T4.8, T4.9, **T4.11** (elegir → conectar, con granularidad de transporte) |
| RBM6.1–RBM6.6 | T6.1–T6.5 |
| RBM7.1–RBM7.6 | T8.1–T8.6, T7.1.4 |
| RBM8.0–RBM8.3 | T7.0.1–T7.0.7 |
| RBM8.4 | T7.0.8, T7.1.1, T7.1.3 |
| RBM8.5, RBM8.6 | T7.0.2, T7.0.8 |
| RBM8.7 | T7.0.9 |
| RBM8.8 | T7.0.7, T7.1.2 |
| RBM9.1, RBM9.2 | T8.8 |
| RBM9.3–RBM9.6 | T8.9 |
| RBM9.7 | T6.6, T8.11 |
| RBM9.8 | T2.8, T6.4 |
| **RBM9.9** | **TG.3, TG.4, TG.5, TG.6, TG.7, TG.8** |
| **RBM9.10** | **TG.1, TG.2, TG.8** |

## Qué queda GATED al cerrar el delta (para que no se lea como olvido)

| Qué | De quién depende | Qué lo destraba |
|---|---|---|
| Un **Gallagher HR5 v3** real, con sus UUIDs y su formato de trama | mercado / Gallagher (documentación técnica, **no** una licencia) | Una fila en `DRIVER_REGISTRY` — sin tocar el contrato, que es justo lo que T1 compró |
| La **cadena de protocolo iAP** de Allflex / Datamars | trámite MFi (canal Facundo) | Una línea en `app.config.ts` + una `TransportCapability` en el driver. **Cero código** (T5.6) |
| Que el **Gallagher HR0** haga HID | Gallagher (sin confirmar del fabricante) | Nada de este delta: es una incógnita distinta de la del gate (T7.0.9) |
| Las **mañas de un lector comercial** por BLE (tiempos, semántica de desconexión, buffer) | tener el aparato en la mano | Lo mismo que sigue gated para el RS420 físico (T-MV.5.6) |
