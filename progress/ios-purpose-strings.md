# ITMS-90683 — purpose strings de iOS (build 5)

**Fecha**: 2026-08-11 · **Tipo**: fix de defecto reportado por Apple (no es feature SDD, no hay
`specs/active/<name>/`) · **Estado**: listo para revisión.

## Qué se rompió y por qué urgía

El bundle `miTropero.app` del **build 5 de iOS** no declaraba **ningún** purpose string. Apple lo frenó
con `ITMS-90683: Missing purpose string in Info.plist` pidiendo `NSBluetoothAlwaysUsageDescription`.

No es cosmético: en iOS, instanciar el manager de CoreBluetooth sin esa clave **aborta el proceso**. ~~El
primer tester que abriera la pantalla del bastón en un iPhone no habría visto un permiso feo — se le
habría cerrado la app.~~ **[CORREGIDO en la Vuelta 2]** esa segunda frase exagera: en iOS hoy no hay
transporte, así que la pantalla del bastón **no** instancia CoreBluetooth. Lo incondicional es el rechazo
del validador (ITMS-90683); el aborto en runtime es condicional a que la app monte el manager. El módulo
que la exige es `react-native-bluetooth-classic`, que usa CoreBluetooth en `ios/RNBluetoothClassic.swift`
(verificado en `node_modules`, no de memoria).

**El defecto de fondo no fue una clave mal puesta: fue que nadie estaba mirando la lista.** Por eso la
parte principal del trabajo es el guard, no las dos líneas de config.

## Los cambios

| Archivo | Qué |
|---|---|
| `app/app.config.ts` | `NSBluetoothAlwaysUsageDescription` + `NSBluetoothPeripheralUsageDescription` en `ios.infoPlist`, con el motivo escrito al lado (igual que `ITSAppUsesNonExemptEncryption`) |
| `app/app.config.test.ts` | +1 test: las dos claves declaradas y **no vacías**, en las 4 variantes de `APP_VARIANT` |
| `app/ios-purpose-strings-guard.test.ts` | **nuevo** — el guard escrito sobre la ausencia (12 tests) |
| `scripts/run-tests.mjs` | registra el guard en la lista explícita + el porqué |

### El texto (sale en el diálogo del SO)

> «miTropero se conecta por Bluetooth con el bastón lector para leer las caravanas electrónicas de los
> animales.»

Español rioplatense, en términos del campo, con el para-qué explícito — Apple rechaza los genéricos tipo
"esta app usa Bluetooth". Las dos claves comparten **una sola constante** (`BLUETOOTH_PURPOSE`): que
puedan divergir es justamente la forma en que una de las dos queda genérica sin que nadie lo note.

### Por qué se declara igual la clave deprecada

`NSBluetoothPeripheralUsageDescription` está deprecada desde iOS 13 y muy probablemente no hace falta. Se
declara **a propósito**, con el motivo en el código: un build de EAS es un recurso agotable (plan Free,
30/mes, ya se agotaron una vez y dejaron el proyecto dos semanas sin poder buildear), así que un segundo
aviso del validador cuesta un ciclo entero. **Una clave de más es una línea; una clave de menos son 40
minutos y un build.**

## El guard (`app/ios-purpose-strings-guard.test.ts`)

Oráculo al revés del de `app.config.test.ts` (que solo puede verificar lo que alguien se acordó de poner):

1. **`IOS_PROTECTED_RESOURCES`** — 18 recursos protegidos de iOS con su clave y los **símbolos del SDK de
   Apple** que delatan su uso (`CBCentralManager`, `AVCaptureDevice`, `CLLocationManager`, `LAContext`, …).
2. **Escaneo del árbol instalado** — recorre las fuentes `.swift/.m/.mm/.h` de **todos** los paquetes de
   `node_modules` (transitivas incluidas: `ios/`, `apple/`, o el paquete entero si tiene `.podspec` en la
   raíz, que es el caso de `react-native`). Hoy: **51 paquetes, 3.019 archivos, ~1 s** con pre-filtro de
   una sola pasada y blanqueo de comentarios (`stripSourceComments`) solo sobre los candidatos.
3. **`MODULE_VERDICTS`** — cada par (módulo, recurso) detectado necesita veredicto **escrito**: o exige su
   purpose string, o está excluido con un motivo y una condición `stillHolds()` que **se ejecuta**.
   Un módulo nuevo que toque un recurso protegido **nace en rojo**.
4. **`MODULES_BY_NAME`** — segunda capa por NOMBRE (`expo-camera`, `expo-location`, `react-native-ble-plx`,
   …), porque el escaneo tiene un punto ciego obvio: **solo ve lo instalado**. Un `pnpm add expo-camera`
   sin `install` quedaría invisible justo en el commit que lo agrega.
5. **`CENSUS`** — pin de las 33 dependencias **directas** con código nativo Apple. Cubre el hueco que
   queda: un recurso protegido que la tabla todavía no enumera. Solo directas a propósito: pinear las
   transitivas convertiría cada `pnpm update` en un rojo sin señal.
6. **Auto-verificación** — que el escaneo miró un árbol real (`node_modules` existe, ≥40 paquetes nativos,
   ≥2.000 fuentes) y que **vio el caso concreto del defecto** (`react-native-bluetooth-classic/ios/RNBluetoothClassic.swift`).
   Sin esto, todo lo de arriba pasaría en verde por no mirar nada.

### Exclusiones, todas sostenidas por algo ejecutable

| Módulo → recurso | Por qué se excluye | Qué la sostiene (se ejecuta) |
|---|---|---|
| `expo-audio` → micrófono | trae el grabador pero la app **no graba** (`allowsRecording: false`, sin config plugin) | `FEEDBACK_AUDIO_MODE.allowsRecording === false` (el mismo valor que asserta `feedback-guard.test.ts:336`) + plugin no enganchado + cero uso de la API de grabación en `app/`+`src/`+`plugins/` |
| `expo-file-system` → fototeca | el camino de Photos es el legacy de URIs `assets-library:`/`ph://`; la app usa `documentDirectory`/`cacheDirectory` | ningún módulo de cámara/fototeca en `package.json` ni en `node_modules` + cero URIs de fototeca en el código propio |
| `expo-secure-store` → Face ID | `LAContext` solo en el camino `requireAuthentication: true`, que la app nunca pide | cero `requireAuthentication` en el código propio |
| `expo-modules-core` → cámara | son **declaraciones de protocolo** (`EXCameraInterface.h` tipa un `AVCaptureSession`), no captura | el paquete sigue sin `AVCaptureDevice`/`UIImagePickerController` |
| `expo-notifications` → ubicación | importa CoreLocation para decodificar el `CLCircularRegion` de un trigger que no usamos | el paquete sigue sin instanciar `CLLocationManager` |
| `react-native` (core) → ubicación | `RCTConvert+CoreLocation.h` son conversiones de TIPOS | idem: sin `CLLocationManager` |
| `expo-dev-launcher` → red local | Bonjour para descubrir el dev server; solo build de desarrollo, no aborta el proceso | sigue siendo transitiva de `expo-dev-client`; y ningún **otro** paquete toca Bonjour |

`react-native-reanimated` **no** necesita exclusión: usa `CMMotionManager` (acelerómetro/giróscopo crudos,
sin permiso). El patrón de `NSMotionUsageDescription` apunta a `CMPedometer`/`CMMotionActivityManager`,
que son los que sí prompt-ean — está escrito en la tabla para que nadie lo "arregle" ampliándolo.

### Lo que el guard NO cubre (declarado en el header, no fingido)

1. Recursos protegidos que la tabla todavía no enumere (mitigado parcialmente por el `CENSUS`).
2. Código nativo fuera de `<pkg>/ios`, `<pkg>/apple` o de un paquete con `.podspec` en la raíz. Es la
   convención del ecosistema y los 51 paquetes nativos instalados la cumplen, pero un `darwin/` sin
   podspec sería invisible.
3. Uso de recursos protegidos desde un proyecto nativo propio (no hay: la app es managed/CNG).
4. `UISupportedExternalAccessoryProtocols` (ver "adyacentes" abajo).
5. El `Info.plist` **final**: se verifica la fuente (`app.config.ts`), no la salida del prebuild. Ningún
   plugin nuestro escribe el plist de iOS (`with-bluetooth-classic` solo toca el AndroidManifest);
   verificar el plist real exigiría un `expo prebuild` por corrida.

## Falsificación (obligatoria) — todos los mutantes, ROJO

Cada mutante se aplicó al árbol real, se corrió la suite y se restauraron los bytes originales
(verificado por md5 y por `git status`).

| Mutante | Resultado | Quién lo cazó |
|---|---|---|
| `NSBluetoothAlwaysUsageDescription: ''` | 🔴 | `app.config.test.ts` + el guard, en las 4 variantes ("está VACÍA — para iOS es lo mismo que no declararla") |
| clave borrada entera | 🔴 | idem ("no está declarada (es undefined)") |
| `NSBluetoothPeripheralUsageDescription: '   '` (solo espacios) | 🔴 | `app.config.test.ts` + el test de claves "a propósito" |
| `"expo-camera"` agregado a `package.json` **sin instalar** y sin declarar sus claves | 🔴 (4 tests) | guard por NOMBRE (`NSCameraUsageDescription` + `NSMicrophoneUsageDescription`), purpose strings exigidas, exclusión de fototeca rota, y el censo ("declarada y no instalada → no certifico nada") |
| `allowsRecording: true` en `feedback-logic.ts` | 🔴 | la exclusión de micrófono de `expo-audio` deja de sostenerse |
| archivo nuevo con `requireAuthentication: true` | 🔴 | la exclusión de Face ID deja de sostenerse |
| archivo nuevo con una URI `ph://` | 🔴 | la exclusión de fototeca deja de sostenerse |
| módulo nativo falso **instalado** con `CBCentralManager` en `ios/` | 🔴 | "código nativo instalado que toca un recurso protegido SIN veredicto" |
| el mismo símbolo dentro de un **comentario** | 🟢 (correcto) | el blanqueo de comentarios evita el falso positivo |

`app/package.json` restaurado byte a byte: md5 `a66275aeab5f408a3cb625852ae18a95` antes y después, y
`git status` no lo lista como modificado. **No se corrió `pnpm install`.**

## Verificación (salida literal)

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit
```

```
>>> typecheck client
<<< typecheck client OK
>>> scripts unit tests (spec 16 Run B)
ℹ tests 33
ℹ pass 33
ℹ fail 0
<<< scripts unit tests (spec 16 Run B) OK
>>> client unit tests
ℹ tests 3086
ℹ pass 3086
ℹ fail 0
<<< client unit tests OK
>>> RLS + Edge + Animal + Maneuvers + Custom + Scrotal + user_private + Import + Sync-streams + Operaciones-rodeo suites — SKIPPED (falta SUPABASE_SERVICE_ROLE_KEY en env)
All tests passed.
```

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
RC=0
```

Aclaraciones honestas sobre esa salida:

- Las suites de base (RLS/Edge/etc.) se saltearon **a propósito** (se pidió typecheck + unitaria; y hay
  otra terminal que puede estar escribiendo en la misma DEV). No las toca este cambio.
- **No se corrió E2E**, como se pidió.
- `tsconfig.json` **excluye** `**/*.test.ts`, así que `pnpm typecheck` no typechequea el guard nuevo (ni
  ningún test del repo). Lo typechequié aparte con un tsconfig temporal (`types: ["node"]` +
  `allowImportingTsExtensions`) y quedó en **0 errores atribuibles** a los dos archivos tocados; el
  tsconfig temporal se borró. En esa corrida aparecen errores **preexistentes** en otros tests excluidos
  (`src/utils/event-timeline.test.ts`), que no toqué.
- No se lanzó ningún build de EAS.

## Hallazgos adyacentes (NO arreglados acá — decisión, no olvido)

1. **`UISupportedExternalAccessoryProtocols` (MFi).** `react-native-bluetooth-classic` usa además
   `EAAccessoryManager` (External Accessory). En iOS, el Bluetooth **Classic** de un bastón MFi no
   aparece si la app no declara los protocolos soportados. No es una purpose string —no aborta el proceso
   ni lo marca el validador— y depende del trámite MFi (gateado, ítem de Facundo). Queda anotado; si el
   bastón se prueba en iPhone antes de eso, va a "no encontrar el dispositivo" y la causa es esta, no un
   bug de la app.
2. **`NSLocalNetworkUsageDescription` en builds de desarrollo.** `expo-dev-launcher` descubre el dev
   server por Bonjour. Sin la clave, ese descubrimiento falla en iOS 14+ (se pega la URL a mano). No se
   declaró para no pedirle al usuario final un permiso que la app publicada no usa. Está en el guard como
   exclusión con motivo.
3. **`progress/current.md` inflado** (1.283 líneas) — lo avisa `check.mjs --fast`; preexistente, fuera de
   este alcance.

## Reconciliación de specs — PENDIENTE (bloqueada por el alcance del pedido)

Las specs no mencionan purpose strings en ningún lado:

- `specs/active/16-ambientes-y-release/design.md:211` documenta `ios.infoPlist.ITSAppUsesNonExemptEncryption`
  y sería el lugar natural para las dos claves nuevas.
- `specs/active/04-bluetooth-baston/requirements.md:133` habla de permisos (Android/`NSMicrophoneUsageDescription`
  de `expo-audio`) pero no del permiso de Bluetooth de iOS.

El pedido prohíbe explícitamente tocar `docs/**` y `specs/**`, así que **no las edité**. Queda como
deuda de una línea en cada archivo, para que las specs no contradigan el as-built.

## Prohibiciones respetadas

`APP_ID` / `bundleIdentifier` / `package` · `scheme` · `slug` / `owner` / `projectId` · `eas.json` ·
assets · `docs/**` · `specs/**` · `progress/**` (salvo este reporte): **sin tocar** (el diff de
`app/app.config.ts` es exactamente +1 constante y +2 claves con sus comentarios). Ningún build de EAS.

---

# Vuelta 2 — blindar el force-cast del MFi + bajar el tono de dos comentarios

**Fecha**: 2026-08-11 · **Base**: la Vuelta 1 aprobada (`progress/review_ios-purpose-strings.md`), sin
commitear. Cierra los ítems 1 y 2 de la sección «11. Cambios requeridos» de esa review.

## 1. ¿Se sostiene el diagnóstico del force-cast? — SÍ, y el disparador es más concreto

Lo verifiqué yo, leyendo el fuente instalado (no de memoria, no confiando en la review):

**(a) El force-cast existe y está en el `init()`** — `app/node_modules/react-native-bluetooth-classic/ios/RNBluetoothClassic.swift:65-69`:

```swift
override init() {
    self.eaManager = EAAccessoryManager.shared()
    self.notificationCenter = NotificationCenter.default
    self.supportedProtocols = Bundle.main
        .object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as! [String]
```

`object(forInfoDictionaryKey:)` devuelve un opcional. Sin la clave es `nil as! [String]` → **trap**. El
módulo no falla al usarse: falla al **instanciarse**.

**(b) La premisa del pedido («RN inicializa temprano los módulos que sobreescriben `init()`») NO aplica a
esta versión de RN — y el arreglo hace falta igual, por un camino distinto y más corto.** Lo que hay
instalado es **RN 0.85.3 con Expo 56**, o sea bridgeless. Lo que leí en el árbol:

- `ios/RNBluetoothClassic.m:20` → `RCT_EXTERN_MODULE(RNBluetoothClassic, NSObject)`: módulo **legacy**
  (interop), no TurboModule.
- `RNBluetoothClassic.swift:166` → `requiresMainQueueSetup() -> true`. En el bridge viejo eso implicaba
  instanciación **eager** en el arranque; en bridgeless **ya no**:
  `ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleManager.mm:597-601` usa
  `requiresMainQueueSetup` solo para elegir **la cola** (`RCTUnsafeExecuteOnMainQueueSync`), no para
  adelantar la creación. En el init del manager (línea 238-257) lo único eager es el **mapa de clases**
  (`_legacyEagerlyRegisteredModuleClasses`), no las instancias.
- El objeto se crea **on-demand** en `_provideObjCModule` → `[moduleClass new]`
  (`RCTTurboModuleManager.mm:555-613` y `:863`), y quien lo pide desde JS es el proxy:
  `TurboModuleBinding.cpp:42-70` (`BridgelessNativeModuleProxy::get` → `legacyBinding_->getModule`), que
  es lo que hay detrás de `global.nativeModuleProxy`, que es lo que `Libraries/BatchedBridge/NativeModules.js`
  exporta como `NativeModules`.

**Conclusión, que es peor que la premisa**: no hace falta que RN lo instancie por su cuenta. **Leer
`NativeModules.RNBluetoothClassic` YA lo instancia** — y eso es exactamente lo que hace nuestro chequeo
defensivo `if (NativeModules.RNBluetoothClassic == null) return null` en
`app/src/services/ble/adapter-spp-android.ts:190`. En iOS, ese `== null` no protegería: mataría. Hoy no se
dispara solo porque `isSppNativeAvailable()` (`:204-212`) corta por `Platform.OS !== 'android'` **antes**
de llamar a `loadRNBC()` — y `loadRNBC` no tiene otro caller (`grep`: solo `:209`). Es un `if` de JS de
distancia. El arreglo **no sobra**.

**Límite de lo verificado**: leí fuentes (Swift, ObjC, C++, JS) del árbol instalado. **No corrí un iPhone.**
Lo que sí ejecuté está abajo.

## 2. El cambio

| Archivo | Qué |
|---|---|
| `app/app.config.ts` | `UISupportedExternalAccessoryProtocols: []` en `ios.infoPlist`, con el porqué escrito (qué pasa sin la clave, por qué va vacía, qué la va a llenar) |
| `app/app.config.ts` | reescrito el comentario de `NSBluetoothAlwaysUsageDescription` (separa incondicional / condicional) |
| `app/ios-purpose-strings-guard.test.ts` | header reescrito (mismo criterio) + hueco 4 actualizado (la clave MFi pasó a estar cubierta) + **3 tests nuevos** |
| `app/app.config.test.ts` | reescrito el comentario del test ITMS-90683 — **tercera copia** de la misma frase exagerada, que la review no citó (ver §4) |

### Por qué vacía y no un protocolo inventado

Con `[]` el cast tiene éxito y el módulo arranca con la lista vacía, que es **la verdad de hoy**: no hay
ningún protocolo MFi aprobado. Convierte un crash posible en un no-evento sin declarar nada falso.
Declararla vacía **no habilita** el bastón en iOS — solo evita el trap. La va a llenar el trámite MFi
(gateado, ítem de Facundo) con el protocol string real del fabricante.

**Verificado, no supuesto — que la clave vacía llegue al `Info.plist`**: el merge de Expo es un spread sin
poda (`@expo/config-plugins/build/plugins/withIosBaseMods.js:298-303`) y la escritura es
`plist.build(sortObject(modResults))` (`:315`). Ejecuté ese mismo `plist` sobre `{ UISupportedExternalAccessoryProtocols: [] }`:

```
<key>UISupportedExternalAccessoryProtocols</key>
<array/>
```

y el round-trip `plist.parse` devuelve la clave presente con `[]`. O sea: la clave **existe** en el plist
→ `object(forInfoDictionaryKey:)` devuelve un `NSArray` vacío (no `nil`) → el `as!` no trapea.

## 3. Cobertura nueva (3 tests) y su falsificación

En `app/ios-purpose-strings-guard.test.ts`:

1. **`GUARD: UISupportedExternalAccessoryProtocols está DECLARADA (vacía vale) mientras esté el bastón MFi`**
   — recorre las 4 variantes de `APP_VARIANT`. El oráculo (`eaProtocolsProblem`) **acepta el array vacío**
   y caza la ausencia. Se activa si `react-native-bluetooth-classic` está en `package.json` **o** en
   `node_modules` (el OR: sacarlo de uno solo no apaga el guard). Si el módulo desaparece de los dos, el
   test se **skipea con motivo** (`t.skip`), que es la verdad: sin el force-cast la clave no es obligatoria.
2. **`AUTO-VERIFICACIÓN: el force-cast que obliga esa clave SIGUE en el fuente instalado`** — el
   `stillHolds()` de una **exigencia** (el patrón que el guard ya usa para las exclusiones): la clave se
   declara por un defecto concreto de la librería; si un `pnpm update` lo arregla (`as?` con default), el
   rojo avisa que el motivo escrito dejó de ser cierto. El mensaje dice las dos lecturas posibles
   (la arreglaron / el escaneo quedó ciego).
3. **`FALSIFICACIÓN: el oráculo de la clave MFi ACEPTA el array vacío y caza la ausencia`** — ejercita el
   oráculo y el patrón: `[]` → OK, `['com.fabricante.rs420']` → OK, `undefined`/`null`/`''`/string suelto
   → problema, `['']` y `[42]` → problema; y el regex del force-cast **ve** la línea real y **no** se
   dispara con `as? [String] ?? []` (patrón muerto = auto-verificación en verde por no ver nada).

**Mutantes (aplicados al árbol real, corridos, restaurados; md5 idéntico antes/después —
`6256a17fd3a6d8da46508713af9a0041`):**

| # | Mutante sobre `app.config.ts` | Resultado |
|---|---|---|
| M1 | clave **borrada** entera | 🔴 (las 4 variantes, mensaje «NO está declarada… el `as! [String]` … TRAPEA») |
| M2 | `'com.fabricante.rs420'` (string en vez de array) | 🔴 «el cast del módulo es a [String], tiene que ser un ARRAY» |
| M3 | `['']` (array con string vacío) | 🔴 «tiene entradas que no son protocol strings» |
| M4 | `null` | 🔴 |
| M5 | declarada **solo** en la variante no-dev (`...(isDev ? {} : {...})`) | 🔴 en `variant=development` — el build que se instala en el teléfono |

El control positivo (el estado real: `[]`) queda **verde**, que es el punto del pedido: el oráculo no
confunde «vacía» con «ausente».

## 4. Los comentarios que exageraban — y el tercero que nadie había citado

La review señaló dos lugares (`app/app.config.ts:58-60` y el header del guard). Aplicando «barrer la
ausencia» hice el grep de la frase y apareció una **tercera copia**: `app/app.config.test.ts:152`
(«el primer tester que abre la pantalla del bastón pierde la app»). Los tres quedaron reescritos con la
misma separación:

- **Incondicional**: sin la clave, el validador de App Store Connect **rechaza la entrega** (ITMS-90683).
  No depende de que la app ejecute nada — alcanza con que el binario linkee CoreBluetooth.
- **Condicional**: el **aborto en runtime** ocurre si la app instancia el manager de CoreBluetooth, cosa
  que en iOS **hoy no pasa** (no hay transporte: `selectTransportAdapter` devuelve `manual` y
  `isSppNativeAvailable()` corta por `Platform.OS`).

También se actualizó el **hueco 4** del header del guard: ya no dice «no lo cubre a propósito» (era falso
dos veces: ahora la clave **sí** está cubierta, y decía que el problema «no hace abortar el proceso»,
que es justamente lo contrario de lo que hace el force-cast). Lo que queda declarado como NO cubierto es
lo que de verdad no cubre: que el bastón MFi **funcione** en iOS, que depende del protocol string del
trámite. Y arriba, en el reporte de la Vuelta 1, marqué la frase exagerada con su corrección en vez de
reescribir la historia en silencio.

## 5. Autorrevisión adversarial

Qué busqué y qué encontré:

- **¿La clave vacía llega de verdad al plist, o Expo poda los vacíos?** Era el supuesto que sostiene todo
  el arreglo. Lo ejecuté (§2): `<array/>`, round-trip OK. Si hubiera podado, el fix sería decorativo.
- **¿El `init()` es el camino real, o el arreglo sobra?** Es real, y el disparador es más corto que el
  del pedido (§1). Si hubiera sido lazy-y-nadie-lo-toca-nunca lo habría dicho.
- **¿El oráculo puede pasar por la razón equivocada?** 5 mutantes, todos rojos, con el control positivo
  verde. Además falsifiqué el **patrón** del force-cast contra la forma arreglada (si no, la
  auto-verificación podría quedar verde/roja por un regex muerto).
- **¿Se puede apagar el guard barato?** Sacando el módulo de `package.json` pero dejándolo instalado →
  no, el OR lo cubre. Borrando la clave → rojo. Declarándola en una sola variante → rojo (M5).
- **¿Rompe algo existente?** El test «no hay purpose strings declaradas de más» filtra por
  `/UsageDescription$/`, así que la clave nueva no lo dispara ni necesita entrar a `DELIBERATE_EXTRA_KEYS`
  (tiene su propio test, que es mejor). `ios.infoPlist` está tipado `[k: string]: any` en
  `@expo/config-types` → typecheck limpio. Ningún test asertaba la forma exacta del `infoPlist`.
- **Orden de tests / estado global**: `infoPlistOf()` escribe `process.env.APP_VARIANT`; mis tests lo
  dejan en `production`, igual que el test de purpose strings que ya estaba antes. Verifiqué que nada
  posterior dependa de la variante (los plugins no branchean por `isDev`) — y la suite corre verde.
- **Riesgo que NO puedo cerrar desde acá, declarado**: no conozco ninguna regla del validador de Apple que
  rechace un `UISupportedExternalAccessoryProtocols` **vacío** (es un array de strings sin mínimo, y no
  declaramos el background mode `external-accessory`, que sí exige protocolos). Pero eso es «no conozco»,
  no «lo verifiqué»: el veredicto real llega con la próxima entrega. Si Apple llegara a objetarlo, el
  remedio es sacar la clave y mantener iOS fuera del camino de RNBC — no inventar un protocolo.

## 6. Reconciliación de specs — sigue PENDIENTE (prohibido por el alcance del pedido)

El pedido prohíbe `docs/**` y `specs/**`, así que no las toqué. Deuda concreta, para el próximo toque:

- `specs/active/16-ambientes-y-release/design.md:214-219` ya documenta las **dos** purpose strings (lo
  reconcilió la Vuelta 1). Le faltan dos arreglos, los dos verificados leyendo el archivo:
  1. **una línea** por la tercera clave: `UISupportedExternalAccessoryProtocols: []`, declarada vacía por
     el force-cast de `react-native-bluetooth-classic`, a llenar con el trámite MFi;
  2. la **cuarta copia** de la frase exagerada — línea 217: «la app se cierra al abrir la pantalla del
     bastón». Mismo arreglo que en los otros tres lugares (incondicional = rechazo del validador;
     condicional = aborto si la app instancia el manager, que en iOS hoy no pasa). **No la toqué porque
     `specs/**` está prohibido en este pedido**, pero queda contradiciendo al código.
- `specs/active/04-bluetooth-baston/requirements.md` R12 — la línea opcional que ya pedía la review
  (permiso de Bluetooth de iOS + el pendiente MFi).

## 7. Verificación (salida literal)

`pnpm typecheck` (en `app/`):

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit

TYPECHECK_RC=0
```

`node scripts/run-tests.mjs` — **exit code 0** (esta vez había keys, así que las suites de base también
corrieron):

```
>>> typecheck client
<<< typecheck client OK
>>> scripts unit tests (spec 16 Run B)
ℹ tests 33     ℹ pass 33     ℹ fail 0
>>> client unit tests
ℹ tests 3089   ℹ pass 3089   ℹ fail 0      (eran 3086 en la Vuelta 1: +3 tests nuevos)
<<< RLS / Edge Functions / Animal / Maneuvers / Puesta-en-servicio / Reports / Custom / Scrotal /
    User_private / Import / Sync-streams / Operaciones-rodeo / SIGSA / Treatments / Audit / Health — todas OK
All tests passed.
RC=0
```

`node scripts/check-hardcode.mjs`:

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
RC=0
```

Los dos archivos del cambio, aislados: **26 tests, 26 pass, 0 fail** (11 de `app.config.test.ts` + 15 del
guard: los 12 de la Vuelta 1 + 3 nuevos).

**E2E: NO se corrió**, como se pidió.

## 8. Prohibiciones respetadas (Vuelta 2)

`APP_ID` / `bundleIdentifier` / `package` · `scheme` · `slug` / `owner` / `projectId` · `eas.json` ·
assets · `docs/**` · `specs/**` · `progress/**` (salvo este reporte) · **`node_modules`**: sin tocar.
Los mutantes se aplicaron **solo** a `app/app.config.ts` y se restauraron byte a byte (md5 verificado);
`git status` no muestra nada espurio. **Ningún build de EAS.** Nada commiteado.

⚠️ Para quien commitee: el working tree sigue arrastrando cosas **ajenas** —
`specs/active/10-operaciones-rodeo/requirements.md`, `specs/active/16-ambientes-y-release/design.md` y
`docs/marketing/kit-capturas.zip`—. Stagear selectivo; un `git add -A` se los lleva puestos.
