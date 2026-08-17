# impl — delta `ios-ble-mfi`, **Fase F2** (T2.0 … T2.8): dependencia, veto, config, permisos, censo

baseline_commit: 80c7022296c425b9616e4a0880d7b693870ccdeb

**Spec**: `specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md` (aprobada en Puerta 2, 2026-08-17).
**Alcance de esta sesión**: SOLO la Fase F2 (`T2.0`–`T2.8`). **NO** se escribe `adapter-ble-gatt.ts` (es F3).
**Estado en `feature_list.json`**: `04-bluetooth-baston` figura `deferred`. No lo toco (límite duro del despacho), igual que F1 y
que el delta `multivendor` (`acec3cd`): un delta-spec ADR-028 Nivel B corre su mini-ciclo sobre una feature con el core cerrado.
Queda declarado para que el reviewer no lo lea como precondición saltada en silencio.

**Insumo que NO se repite**: `progress/veto_ble-plx.md` (leader, 2026-08-17) — veto **documental** por inspección de fuente,
veredicto *COMPATIBLE provisional*. Esta fase cierra la **mitad empírica** que ese documento declara faltante (RBM2.18 /
precedente T-MV.5.1: se veta contra un build real, no contra docs).

---

## Plan (las tasks son el contrato literal)

- [x] T2.0 VETO empírico: `react-native-ble-plx` bajo Expo 56 / RN 0.85.3 new-arch bridgeless — RBM2.18 → **FIRME**
- [x] T2.1 instalar y **pinear** la dep con pnpm — RBM2.17 → `3.5.1` exacta
- [x] T2.2 `ios-purpose-strings-guard.test.ts`: `CENSUS` += la dep, con veredicto escrito — RBM2.17, RBM4.3
- [x] T2.3 `app.config.ts`: plugin declarado con **background deshabilitado** — RBM2.15, RBM4.3
- [x] T2.4 `app.config.test.ts`: assert de "plugin sin background" + la clave de EA sigue — RBM2.15, RBM4.3
- [x] T2.5 `permissions-android.ts`: `androidBluetoothPermissionsFor(apiLevel, transport)` exhaustiva — RBM2.13
- [x] T2.6 `permissions-android.test.ts`: casos por (API, transporte) + regresión del `spp` — RBM2.13
- [x] T2.7 verificar contra `with-bluetooth-classic.js` que los permisos declarados alcanzan — RBM2.13, RBM7.6
- [x] T2.8 build **local** de Android con Gradle (0 EAS) — RBM9.8 → `BUILD SUCCESSFUL 3m 23s`

## Bitácora (se escribe A MEDIDA, no al final)

### 1. Lectura del as-built antes de tocar nada (hechos verificados, no supuestos)

Contra el **tarball 3.5.1** descomprimido en scratchpad (`npm pack`, sin instalar todavía) y contra el árbol del repo:

| Hecho | Dónde se verificó | Por qué importa acá |
|---|---|---|
| `app.plugin.js` → `plugin/build/withBLE.js`; el paquete **trae** su config plugin | tarball | T2.3 no necesita `@config-plugins/react-native-ble-plx` (cero deps extra) |
| `withBLE` default: `isBackgroundEnabled = false`, `modes = []` → **no** escribe `UIBackgroundModes` | `withBLE.js` + `withBLEBackgroundModes.js` | RBM2.15 se cumple **sin** pasar nada… pero se declara explícito igual (§4: un default de la lib no puede ser nuestra política) |
| `withBluetoothPermissions` **escribe el Info.plist**: `NSBluetoothAlwaysUsageDescription = bluetoothAlwaysPermission \|\| el ya existente \|\| "Allow $(PRODUCT_NAME) to connect to bluetooth devices"` | `withBluetoothPermissions.js` | 🔴 **Rompe una premisa escrita del guard de purpose strings** (su límite nº5: *"los nuestros no tocan iOS"*). Ver decisión **D2** (§4) |
| `withBLEBackgroundModes` con `modes: []` hace `if (!UIBackgroundModes.length) delete …` | `withBLEBackgroundModes.js` | La app declara `UIBackgroundModes: ['remote-notification']` (push). Con largo 1 **no** se borra; y si el mod corriera antes del merge de `ios.infoPlist`, el merge la re-pone. Seguro en los dos órdenes — verificado en el plist introspectado (§4) |
| `withBLEAndroidManifest` **siempre** corre y agrega `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION` a `uses-permission-sdk-23`; **sin tope de API** si `neverForLocation` es `false` (el default) | `withBLEAndroidManifest.js` | Un permiso de **ubicación sin tope** contradice la política escrita de `with-bluetooth-classic.js`. Ver decisión **D1** (§4) |
| El manifiesto de la lib (`android/src/main/AndroidManifest.xml`) declara COARSE/FINE **sin tope**… pero con AGP ≥ 7.3 el `sourceSets` apunta a `AndroidManifestNew.xml`, que es `<manifest></manifest>` **vacío** | `android/build.gradle` (`supportsNamespace()`) + los dos manifiestos | La lib **no** inyecta permisos por su manifiesto en este proyecto (AGP 8). El único emisor es su config plugin → con **D1** alcanza. Confirmado después en el manifiesto mergeado (§5) |
| `peerDependencies: { react: '*', react-native: '*' }`; sin `dependencies` JS; `engines.node >= 18` | `npm view` | Nada del stack restringe la versión → el criterio de elección **no** puede ser el peer range (ver §2) |
| Nativo Android: rxjava2 2.2.17 + `com.polidea.rxandroidble2:rxandroidble:1.17.2`, `minSdk 24`, `compileSdk 35` | `android/build.gradle` + `android/gradle.properties` | Transitivas nuevas en el APK; `minSdk 24` ≤ el del proyecto |
| El prebuild en disco está **stale de rebrand** (`settings.gradle` → `rootProject.name = 'RAFAQ'`) | `app/android/settings.gradle` | El `expo prebuild` de esta fase lo regenera a `miTropero`; es artefacto gitignoreado (`app/.gitignore:/android`) |

### 2. T2.1 — la versión instalada y POR QUÉ esa

**`react-native-ble-plx@3.5.1`, pineada EXACTA** (`"react-native-ble-plx": "3.5.1"`, sin `^` ni `~`).

El criterio, en orden, porque acá no hay una versión "bendecida" por nadie:

1. **Expo NO la tiene en su lista de módulos nativos de SDK 56** → `expo install` no pinea nada (lo verificó el
   veto documental del leader). O sea: la elección es nuestra y hay que justificarla, no delegarla.
2. **Nada del stack la restringe**: sus `peerDependencies` son `{ react: '*', react-native: '*' }` y no tiene
   dependencias JS. No existe un rango que "resuelva" la pregunta → el criterio no puede ser el peer range.
3. **Es la última publicada** (2026-02-18) y la que **maneja new arch**: `isNewArchitectureEnabled()`,
   `buildConfigField IS_NEW_ARCHITECTURE_ENABLED`, bloque `react { codegenJavaPackageName }` y, en iOS,
   `install_modules_dependencies` + rama por `RCT_NEW_ARCH_ENABLED`. Con RN 0.85 bridgeless eso no es un lujo.
4. **Es la versión que el veto documental inspeccionó.** Instalar otra invalidaría la mitad ya hecha del veto y
   habría que rehacerla — un costo sin ningún beneficio.
5. **Exacta y no flotante** porque es un módulo NATIVO: un bump de minor cambia el binario y el *fingerprint*, y
   un rango dejaría que un build local y uno de EAS compilen fuentes distintas. Es la convención del repo para
   nativos (`react-native-bluetooth-classic: 1.73.0-rc.17`, `@op-engineering/op-sqlite: 15.2.14`,
   `react-native-reanimated: 4.3.1`, `react-native-worklets: 0.8.3`).

**Lockfile consistente** (`git diff --stat app/pnpm-lock.yaml` → **+17 líneas, 0 borradas**): la entrada del
importer con `specifier: 3.5.1`, el `packages:` con su integrity/engines/peers, y el `snapshots:`. Las otras dos
líneas son `bufferutil`/`utf-8-validate` que pnpm agregó a los `transitivePeerDependencies` de un snapshot
preexistente (normalización, no una dep nueva). Transitivas nuevas en el APK: `io.reactivex.rxjava2:rxjava:2.2.17`
y `com.polidea.rxandroidble2:rxandroidble:1.17.2` (nativas, vía Gradle — no entran al bundle JS).

### 3. T2.2 — el censo, y el hallazgo que cambia CUÁL guard sostiene la clave

`CENSUS` += `react-native-ble-plx` (nació en rojo, como el task anticipaba: 14/15 → el único fallo era el censo).

**El hallazgo**: sus fuentes propias (`ios/BlePlx.m` + 3 cabeceras) **no nombran un solo símbolo de
CoreBluetooth**. El framework entra por su dependencia de **CocoaPods** `MultiplatformBleAdapter 0.2.0`
(`react-native-ble-plx.podspec`), que vive en `Pods/` y no en `node_modules/` → **el escaneo de símbolos del guard
es estructuralmente ciego** a este paquete (su punto ciego nº2, escrito). Verificado ejecutando: el grep de
`CBCentralManager|CBPeripheralManager|CBManager|import CoreBluetooth|<CoreBluetooth` sobre su `ios/` y `android/`
devuelve **cero archivos**.

Consecuencias que se siguen de eso, y que están en el código:

- **NO lleva entrada en `MODULE_VERDICTS`**: sin hits sería un veredicto "fantasma" y el guard que los caza
  («todo veredicto describe el árbol REAL») lo rechazaría. Lo que hace obligatoria la clave es la **red por
  nombre** (`MODULES_BY_NAME['react-native-ble-plx'] = ['bluetooth']`), que ya estaba escrita desde antes.
- El veredicto se escribió **ejecutable**, no como comentario: test nuevo «VEREDICTO `react-native-ble-plx`
  (RBM2.17): la clave es obligatoria, y por qué RUTA lo es». Está redactado como **disyunción** a propósito (si el
  escaneo lo ve ⇒ exige `MODULE_VERDICTS`; si no lo ve ⇒ exige la red por nombre **y** que el podspec siga
  dependiendo de `MultiplatformBleAdapter`, que es la EXPLICACIÓN de la ceguera). Así el invariante vale en los dos
  mundos y una versión futura que inline CoreBluetooth **no** produce un rojo espurio.
- `NSBluetoothAlwaysUsageDescription` ya estaba declarada y con texto útil → **no hizo falta agregar ninguna
  clave**. El guard de `UISupportedExternalAccessoryProtocols` sigue verde (RBM4.3), y su auto-verificación del
  force-cast también.

### 4. T2.3 — qué cambió en `app.config.ts`

Una entrada nueva en `plugins`, con **las cuatro opciones explícitas** (tres coinciden con el default de la lib;
se declaran igual para que un default que cambie no nos cambie la política en silencio):

```ts
['react-native-ble-plx', {
  isBackgroundEnabled: false,   // RBM2.15 — sin `uses-feature bluetooth_le required=true`
  modes: [],                    // RBM2.15 — sin UIBackgroundModes: ['bluetooth-central']
  neverForLocation: true,       // RBM2.13 — la ubicación entra TOPEADA a maxSdkVersion=30
  bluetoothAlwaysPermission: BLUETOOTH_PURPOSE,  // el texto del diálogo es el NUESTRO, en español
}]
```

Nada más cambió del archivo: `UISupportedExternalAccessoryProtocols` intacta (RBM4.3), las dos purpose strings
intactas, `UIBackgroundModes` sigue siendo `['remote-notification']`.

**Las dos decisiones que NO son obvias** (y que no estaban en el design):

- **D1 — `neverForLocation: true`.** Con el default (`false`) el config plugin de la lib declara
  `ACCESS_COARSE_LOCATION` y `ACCESS_FINE_LOCATION` **SIN tope de API**, en el array `uses-permission-sdk-23`. Eso
  es exactamente lo que `plugins/with-bluetooth-classic.js` existe para evitar, y el `tools:node="replace"` de
  nuestro plugin **no lo tapa**: aplica al elemento `uses-permission`, que es otro array. Y la afirmación es
  verdadera, no una conveniencia: el escaneo se filtra por `serviceUuid` para encontrar un bastón, nunca para
  inferir dónde está el teléfono. Falsificado: con `false`, entran **dos** permisos de ubicación sin tope (§6 y el mutante **M2**).
- **D2 — `bluetoothAlwaysPermission: BLUETOOTH_PURPOSE`.** `withBluetoothPermissions` de la lib **escribe** el
  `Info.plist`: `NSBluetoothAlwaysUsageDescription = <la opción> || <el valor existente> || <default en inglés>`.
  Sin pasarle nada, el resultado depende del orden en que Expo aplique los mods (si su mod corre antes del merge de
  `ios.infoPlist`, deja "Allow $(PRODUCT_NAME) to connect to bluetooth devices"). Pasándole **la misma constante**
  que `ios.infoPlist`, el resultado es el mismo en cualquier orden. Esto además **cierra el límite nº5 del guard de
  purpose strings**, que decía textual *"los nuestros no tocan iOS"*: este es el primer plugin que sí lo toca. El
  límite quedó reconciliado en el propio guard y hay un test que impide que las dos copias divergan.

**Verificación de D2 con el plist REAL, sin gastar un prebuild de iOS**: `npx expo config --type introspect`
aplica los mods y devuelve el `Info.plist` resultante. Salida (recortada a lo que importa):

```
NSBluetoothAlwaysUsageDescription  = "miTropero se conecta por Bluetooth con el bastón lector para
                                      leer las caravanas electrónicas de los animales."   ← EL NUESTRO
NSBluetoothPeripheralUsageDescription = (idem)
UIBackgroundModes                  = ["remote-notification"]        ← SIN bluetooth-central (RBM2.15)
UISupportedExternalAccessoryProtocols = []                          ← intacta (RBM4.3)
```

O sea: el purpose string en español sobrevive al mod de la lib y el background BLE no aparece — **medido**,
no deducido del orden de los mods.

### 5. T2.0 + T2.8 — EL VETO EMPÍRICO (la mitad que faltaba de RBM2.18)

**Secuencia ejecutada**, en este orden y con el motivo de cada paso:

1. `cp app/package.json <scratchpad>` — snapshot, porque `expo prebuild` **reescribe los scripts** `android`/`ios`
   de `expo start --X` a `expo run:X` (defecto conocido, `docs/backlog.md:1491`).
2. `node scripts/gradle.mjs --stop` → *"No Gradle daemons are running"*. Es el paso que evita el
   *"Unable to delete directory … expo-modules-core/…/cxx"* de dos builds concurrentes.
3. `npx expo prebuild -p android` → **exit 0**. Regeneró `app/android` (artefacto gitignoreado). Efecto
   colateral bueno: el prebuild que había en disco estaba **stale de rebrand** y quedó actualizado
   (`rootProject.name = 'miTropero'`, `strings.xml → app_name = miTropero`) — cerrando de paso el pendiente
   *"re-correr el prebuild antes del próximo build local"* de `docs/marketing/plan-toma-de-marca-mitropero.md`.
4. Revertidos a mano los dos scripts de `package.json` (verificado con `git diff`: el único cambio que queda en
   ese archivo es la línea de la dep nueva).
5. `node scripts/gradle.mjs :app:assembleDebug`, **sin pipe a `tail`** (log a archivo, para ver el progreso):

```
[gradle.mjs] JDK 17 → C:\Program Files\Amazon Corretto\jdk17.0.15_6
BUILD SUCCESSFUL in 3m 23s
664 actionable tasks: 134 executed, 530 up-to-date
[exited with code 0]        03:48:16 → 03:51:40
→ app/android/app/build/outputs/apk/debug/app-debug.apk   (275 MB, debug)
```

**0 builds de EAS consumidos.**

#### Qué prueba este build (evidencia, no impresión)

| Qué | Evidencia en el log / el árbol |
|---|---|
| El módulo se **autolinkea** y queda **registrado en la app** | `android/app/build/generated/autolinking/.../PackageList.java:71` → `new com.bleplx.BlePlxPackage()` |
| Su nativo **compila** | `:react-native-ble-plx:compileDebugJavaWithJavac`, `:…:bundleLibCompileToJarDebug` |
| El **codegen de new arch** corre sobre la lib | `:react-native-ble-plx:generateCodegenSchemaFromJavaScript` (línea 420) y `generateCodegenArtifactsFromSchema` (685) |
| El APK se **empaqueta** con todo dentro | `:app:mergeLibDexDebug`, `:app:mergeDebugNativeLibs`, `:app:packageDebug`, `:app:assembleDebug` |
| No hubo que **parchear nada** del proyecto nativo | cero cambios a mano en `app/android`; el build salió verde a la primera |

#### 🔑 Qué **NO** prueba (dicho, no escondido)

El `schema.json` que produjo el codegen es **`{"libraryName":"","modules":{}}`**: la lib **no tiene specs de
TurboModule**. Y su clase es `BlePlxModule extends ReactContextBaseJavaModule` con `@ReactModule` → es un
**módulo de puente LEGACY**, que bajo bridgeless anda por la **capa de interop**, no como TurboModule.

Entonces, con precisión: el build prueba **compila + linkea + autolinkea + empaqueta**. **No** prueba que el
puente JS↔nativo **resuelva en runtime**. Lo que sostiene esa mitad hoy es un precedente fuerte —
`react-native-bluetooth-classic` es **exactamente la misma clase de módulo** (legacy, sin codegen) y **lee de
verdad en device sobre este mismo stack** (banco del SPP) — pero es un precedente, no una medición. La
medición es el banco del emulador en device, que la spec ya pone en **F6/RBM6.1** ("el transporte BLE no se
considera verificado hasta correr el banco"). Vender el build verde como "el transporte anda" sería
exactamente el error que `dad711f` costó.

**Consecuencia para el plan: el veto pasa a FIRME y F3 está desbloqueada.** `progress/veto_ble-plx.md`
actualizado con esta evidencia y con este límite.

#### El manifiesto MERGEADO del APK (lo que de verdad pide la app)

`app/android/app/build/intermediates/merged_manifest/debug/…/AndroidManifest.xml`, filtrado a Bluetooth/ubicación:

```
uses-permission          ACCESS_FINE_LOCATION    maxSdkVersion=30
uses-permission          BLUETOOTH               maxSdkVersion=30
uses-permission          BLUETOOTH_ADMIN         maxSdkVersion=30
uses-permission          BLUETOOTH_CONNECT       minSdkVersion=31
uses-permission          BLUETOOTH_SCAN          minSdkVersion=31  usesPermissionFlags=neverForLocation
uses-permission-sdk-23   ACCESS_COARSE_LOCATION  maxSdkVersion=30
uses-permission-sdk-23   ACCESS_FINE_LOCATION    maxSdkVersion=30
(ningún <uses-feature android.hardware.bluetooth_le>)
```

Tres cosas que esto **verifica** y que antes eran razonamiento:

1. **Ningún permiso de ubicación entra sin tope** (RBM2.13 / la política de `with-bluetooth-classic.js`). El
   `ACCESS_COARSE_LOCATION` es NUEVO —lo trae el plugin de la lib— y entra topeado a 30 sólo por
   `neverForLocation: true`.
2. **`BLUETOOTH_SCAN` con `neverForLocation` y sin tope** → el escaneo de API 31+ está habilitado (T2.7: los
   permisos declarados **alcanzan**, no hay que cambiar la política).
3. Los `tools:*` **no sobreviven** al merge (era lo que afirmaba el comentario del test de orden de plugins:
   la diferencia entre los dos órdenes es de lint, no de política). Y el `tools:node="replace"` hizo su trabajo:
   el `ACCESS_FINE_LOCATION` **sin tope** que declara el manifiesto de `react-native-bluetooth-classic` no llegó
   al APK.
   *(Detalle menor, preexistente y no nuestro: los `android:minSdkVersion` en elementos `uses-permission` los
   pone el manifiesto de `react-native-bluetooth-classic`; Android ignora ese atributo ahí — el que cuenta es
   `maxSdkVersion`.)*

Sobre el manifiesto de la lib de BLE, que era un riesgo identificado en §1: con AGP 8 su `sourceSets` apunta a
`AndroidManifestNew.xml`, que es `<manifest></manifest>` **vacío** → **no inyecta permisos**. El único emisor
del lado de BLE es su config plugin. Confirmado por el mergeado: si su `AndroidManifest.xml` viejo estuviera en
juego, habría un `uses-permission ACCESS_COARSE_LOCATION` **sin tope**, y no está.

### 6. T2.5–T2.7 — la política de permisos: qué se decidió y qué se falsificó

**Tabla exhaustiva por transporte** (`ANDROID_BLUETOOTH_PERMISSIONS … satisfies Record<TransportKind, …>`):

| transporte | API ≥ 31 | API ≤ 30 | por qué |
|---|---|---|---|
| `spp` | `BLUETOOTH_CONNECT` | `[]` | **as-built, sin cambios** (regresión con test) |
| `ble-gatt` | `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` | `ACCESS_FINE_LOCATION` | el escaneo lo exige; antes de Android 12 se autoriza como ubicación |
| `serial` | `[]` | `[]` | Web Serial: navegador, no hay permisos de Android |
| `ble-hid` | `[]` | `[]` | teclado que el SO ya emparejó; la app solo recibe keystrokes |
| `mfi` | `[]` | `[]` | es iOS (ExternalAccessory): en Android no existe |

**Cuatro decisiones que el design no fijaba**, con su motivo:

| Decisión | Por qué |
|---|---|
| `transport` **requerido y sin default** en las TRES funciones (la pura y las dos asincrónicas) → `defaultSppEnv()` pasa `'spp'` explícito | Un default a `'spp'` haría que un call site nuevo que se lo olvide pida en silencio el conjunto equivocado, y el síntoma sería un `SecurityException` del escaneo sin nada que lo explique. Es la misma familia que el `?? DRIVER_REGISTRY[0].frameParser` que el review de F1 rechazó. Oráculo: `Function.length` (que **no** cuenta los parámetros con default) |
| `hasAndroidPermissionPolicy(transport)` + `'unavailable'` en los dos caminos asincrónicos | **Hallazgo de la autorrevisión.** `[]` significa dos cosas: para `serial`/`ble-hid`/`mfi` es "no hace falta nada" (y `classifyPermissionResults([], …)` devuelve `'granted'`, correcto), pero para un transporte **desconocido** sería dar por concedido algo que ni sabemos qué pide. La distinción **no cabe en un `string[]`** → predicado aparte, consultado **antes** de tocar RN |
| Un `apiLevel` ilegible cae al régimen **VIEJO** (conducta as-built, pineada por el test de regresión) | Para `spp` da `[]`, que es lo que hacía antes. Y para `ble-gatt` el desenlace también es correcto **por un mecanismo que vale tener escrito**: `ACCESS_FINE_LOCATION` está topeado a 30, así que en un teléfono API ≥ 31 ese permiso NO pertenece al conjunto de la app y `requestMultiple` lo devuelve denegado **sin mostrar diálogo** → `permission_denied` con CTA y carga manual intacta, no un pedido de ubicación injustificado |
| El conjunto devuelto es una **copia** (`[...set]`) | Un consumidor que le haga `.push()` al resultado no puede corromper la política para el resto de la app. Con test |

**T2.7 — la respuesta, y el supuesto que le faltaba al task.** Los cuatro permisos declarados **alcanzan** →
la política **no se cambió**. Pero el task preguntaba solo por *"alcanzan"*, y el riesgo real era otro: el
plugin de la lib **agrega un permiso que no teníamos** (`ACCESS_COARSE_LOCATION`) en **otro array**
(`uses-permission-sdk-23`). El test que decía *"no se pide NINGÚN permiso de ubicación sin tope"* miraba solo
`uses-permission` → era **estructuralmente ciego** al permiso nuevo (el patrón *"barrer la ausencia"*: el guard
no cubría la superficie donde el defecto podía aparecer).

Cómo se cerró, **sin tocar la política de permisos**:

1. `neverForLocation: true` en `app.config.ts` → los dos entran topeados a `maxSdkVersion=30`.
2. Bloque nuevo en `with-bluetooth-classic.test.ts` que **compone las transformaciones REALES de los dos
   config plugins** —importadas del paquete instalado (`react-native-ble-plx/plugin/build/withBLEAndroidManifest`)
   y del `AndroidConfig.Permissions.ensurePermissions` de Expo, no copias a mano— **en los dos órdenes posibles
   de mods**, y verifica el invariante sobre **todos** los arrays de permisos. Las opciones las lee del
   `app.config.ts` real: si alguien saca `neverForLocation` o prende el background, el que cae es el test.
3. **Falsificación** del mundo malo (`neverForLocation: false`, o sea enganchar el plugin sin opciones):
   entran **DOS** permisos de ubicación sin tope. *(Yo había escrito la aserción esperando **uno** y el test me
   corrigió: nuestro `tools:node="replace"` no alcanza al `ACCESS_FINE_LOCATION` del otro array.)*
4. **Medición final** contra el manifiesto **mergeado** del APK (§5): ninguna ubicación sin tope.

**Hallazgo del orden de los mods, medido**: los dos órdenes **no** dan un manifiesto byte-idéntico — cuando el
plugin de la lib corre primero, su `BLUETOOTH_SCAN` trae `tools:targetApi="31"`. Es una diferencia **de lint,
no de política** (los `tools:*` no sobreviven al merge, confirmado en el mergeado), así que el test compara la
política (`android:*` + `tools:node`) y **declara** la diferencia de lint en un assert aparte en vez de taparla
con un `deepEqual` laxo.

---

## Trazabilidad `RBM<n>` → test concreto / medición registrada

| Requisito | Archivo : test (o medición) |
|---|---|
| **RBM2.13** tabla exhaustiva por transporte | `permissions-android.test.ts` : *"(GUARD): TODO `TransportKind` tiene su fila"* (+ su **META** de que el extractor no está ciego) · *"todo transporte que un driver REAL declara tiene fila"* · *"`ble-gatt` en API ≥ 31 pide SCAN + CONNECT"* · *"`ble-gatt` en API ≤ 30 pide FINE_LOCATION y NO los BLUETOOTH_*"* · *"`ble-gatt` en API ≥ 31 NO pide ubicación"* · *"el borde exacto es 31"* · *"los conjuntos de `spp` y `ble-gatt` son DISTINTOS"* (anti-vacuidad) · *"`serial`/`ble-hid`/`mfi` no piden NINGÚN permiso"* · *"`transport` es REQUERIDO (sin default)"* · *"(fail-closed) un transporte que NO está en la tabla no cae al conjunto de otro"* · *"(fail-closed) «no hay política» NO es lo mismo que «no hace falta nada»"* · *"la tabla no se puede mutar desde afuera"* |
| **RBM2.13** regresión del `spp` (su conjunto NO cambió) | `permissions-android.test.ts` : las 4 pruebas *"(regresión spp)"* + `adapter-spp-android.test.ts` **103/103** (la máquina de estados entera, con el env por defecto ya envuelto) |
| **RBM2.13** el manifiesto declarado ALCANZA para el escaneo BLE | `with-bluetooth-classic.test.ts` : *"los permisos declarados ALCANZAN para el escaneo BLE"* · *"con los DOS plugins aplicados, NINGÚN permiso de ubicación entra sin tope"* · *"el orden de los dos plugins NO cambia la POLÍTICA"* · *"FALSIFICACIÓN: con `neverForLocation: false` el invariante SE ROMPE"* · **medición**: manifiesto **mergeado** del APK (§5) |
| **RBM2.15** background BLE prohibido | `app.config.test.ts` : *"el plugin de `react-native-ble-plx` está declarado y SIN background"* (4 variantes) · *"(GUARD sobre la AUSENCIA): la palabra `bluetooth-central` no aparece en NINGUNA parte de la config"* · `with-bluetooth-classic.test.ts` : *"sin background, el plugin de la lib NO declara `uses-feature bluetooth_le`"* · **mediciones**: `expo config --type introspect` (`UIBackgroundModes == ['remote-notification']`) y el manifiesto mergeado (sin `uses-feature`) |
| **RBM2.17** censo con veredicto escrito | `ios-purpose-strings-guard.test.ts` : *"CENSO: las dependencias DIRECTAS con código nativo Apple son exactamente estas"* (nació en rojo con la dep nueva) · *"VEREDICTO `react-native-ble-plx`: la clave es obligatoria, y por qué RUTA lo es"* · *"GUARD por NOMBRE"* + *"las purpose strings EXIGIDAS … en TODAS las variantes"* (los dos ya la exigían por `MODULES_BY_NAME`) · `app.config.test.ts` : *"el purpose string que el plugin de BLE escribe es EL NUESTRO"* |
| **RBM2.18** veto de compatibilidad | **Medición registrada** (el requisito admite medición, no exige test): `progress/veto_ble-plx.md` — inspección de fuente + `:app:assembleDebug` **BUILD SUCCESSFUL 3m 23s / exit 0**, `PackageList.java:71`, codegen corriendo, APK generado. Con su límite escrito (no prueba runtime) |
| **RBM4.3** la clave de EA no se toca | `ios-purpose-strings-guard.test.ts` : *"`UISupportedExternalAccessoryProtocols` está DECLARADA (vacía vale)"* + su *"AUTO-VERIFICACIÓN: el force-cast SIGUE en el fuente instalado"* (las dos **verdes** con la dep nueva) · `app.config.test.ts` : *"sigue declarada (y vacía) con la dep de BLE instalada"* · **medición**: el plist introspectado (`[]`) |
| **RBM7.6** el comentario de `BLUETOOTH_SCAN` queda falso | `app/plugins/with-bluetooth-classic.js` — comentario reconciliado (bloque *"RECONCILIACIÓN 2026-08-17"* + la lista de `BLUETOOTH_PERMISSIONS`), y el hecho que lo vuelve verdadero está en `permissions-android.test.ts` (el `ble-gatt` **pide** `BLUETOOTH_SCAN`). **Parcial a propósito**: T8.6 cierra el resto de la reconciliación en F8 |
| **RBM9.8** Android local, sin EAS | `:app:assembleDebug` local, **0 builds de EAS consumidos**. El de **iOS no se pidió** (sigue gateado por el OK de Raf, por plataforma y por build) |
| **RBM9.1 / RBM9.2** Gate 1 N/A, ATRIBUIBLE | `git status --porcelain supabase/ sync-streams/` cruzado contra la lista de archivos de F2 → **0 líneas nuestras** (detalle abajo) |
| **RBM9.4** offline-first | Cero red en todo lo tocado: `permissions-android.ts` es local (`PermissionsAndroid`), la config es estática y los guards leen el árbol. Las 3154 units corren sin conectividad |
| **RBM9.5** la carga manual nunca se bloquea | F2 **no toca ninguna superficie de UI**. Lo único que podría bloquear algo es la resolución de permisos, y su semántica no cambió: `denied` → `permission_denied` con CTA (R12.5) y `unavailable` → el camino automático no arranca. El caso nuevo (transporte sin política) devuelve `'unavailable'`, o sea el **más** conservador de los dos |
| **RBM9.6** cero archivos de spec 09 / cero métodos de `StickAdapter` | `git status --short app/src/features/animals` → **vacío**; `stick-adapter.ts` **no se tocó en F2** |

## Autorrevisión adversarial (paso 8 — antes del reviewer)

Qué busqué activamente, y qué encontré:

1. **Un comentario que miente sobre el código (lo peor que puede pasar en un archivo de política).**
   Encontrado, y era MÍO: había escrito que un transporte fuera de la tabla *"se trata como «no sé qué pedir» y
   el adapter lo verá como 'unavailable'/'denied'"*, y eso era **falso** — devolvía `[]`, que los consumidores
   leen como `'granted'`. O sea que había documentado un fail-closed que el código no hacía. Cerrado de verdad
   con `hasAndroidPermissionPolicy` + la rama `'unavailable'` en los dos caminos asincrónicos, y con el test que
   lo fija (y con el límite **dicho**: desde `node:test` el valor de retorno de `ensure…` no distingue esa rama
   porque el require de RN ya devuelve `'unavailable'` — el oráculo verificable es el predicado puro; queda
   escrito en el propio test en vez de fingido).
2. **Tests verdes que miden la cosa equivocada.** El barrido por transportes tiene su **contraprueba de
   vacuidad** (*"los conjuntos de `spp` y `ble-gatt` son DISTINTOS"*): sin ella, un mutante que devolviera
   siempre el conjunto del `spp` pasaba **toda** la regresión. El guard de exhaustividad tiene su **meta-test**
   (si el regex sobre `driver-types.ts` se rompe, el guard pasaría por no mirar nada — el modo de falla que este
   repo ya se comió varias veces). Y el guard combinado de permisos exige `location.length > 0` antes de
   verificar los topes, porque un array vacío habría pasado el `for` sin probar nada.
3. **Un guard que prohíbe una GRAFÍA en vez de una capacidad.** El de background lo escribí primero como
   asserts sobre las opciones del plugin; le agregué el barrido de `bluetooth-central` sobre **la config
   serializada entera**, que cierra la puerta de declararlo a mano en `ios.infoPlist` o por otro plugin.
4. **La superficie que el guard NO cubría (barrer la ausencia, no el mal uso).** El test *"no se pide ningún
   permiso de ubicación sin tope"* miraba **un solo array** del manifiesto, y el permiso nuevo entra por
   **otro**. Era un guard ciego a la superficie donde el defecto podía aparecer. Reescrito sobre los dos arrays
   y sobre **las transformaciones reales de los dos plugins**, en los dos órdenes.
5. **Una premisa escrita en otro archivo que este cambio vuelve falsa.** El límite nº5 del guard de purpose
   strings decía *"los nuestros no tocan iOS"*. Con el plugin de BLE eso deja de ser cierto → reconciliado
   **y** cerrado el riesgo concreto (el purpose string en inglés) pasando la constante explícita, con test de
   no-divergencia. Este es el tipo de cosa que un reviewer encuentra y que cuesta un fix-loop.
6. **Vender el verde de más.** El build compila y linkea, pero el codegen sale con schema **vacío**: es un
   módulo de puente **legacy** bajo la capa de interop. Dejé escrito, en el informe, en el veto y en la spec,
   que el build **no** prueba la reachability del puente en runtime, y que eso lo mide F6. Es exactamente el
   error que costó `dad711f` ("escrito y testeado" sin device).
7. **Regresión del SPP, que es el único transporte que hoy lee de verdad.** El cambio de firma podía dejar el
   `defaultSppEnv()` pidiendo el conjunto equivocado (o ninguno). Verificado corriendo `adapter-spp-android.test.ts`
   (103/103) y con las 4 pruebas de regresión de la tabla. El typecheck enumeró los dos call sites (`EXIT=0`).
8. **Tocar un archivo compartido con la otra terminal.** `scripts/run-tests.mjs` **no se tocó**: las cuatro
   suites que modifiqué (`permissions-android`, `app.config`, `ios-purpose-strings-guard`,
   `with-bluetooth-classic`) **ya estaban** en su lista explícita, y no creé ninguna suite nueva. Verificado por
   grep, no por memoria.
9. **Deuda de bundle / plataformas.** La dep nueva **no se importa desde ningún módulo** todavía (F3 lo hace, y
   con require perezoso), así que no entra al bundle de web ni cambia el grafo de módulos. Verificado por grep:
   las únicas menciones de `react-native-ble-plx` en `app/src` son **comentarios** (`adapter-hid-wedge.ts`,
   `permissions-android.ts`).
10. **Multi-tenant / datos regulados.** Cero: F2 no toca `establishment_id`, ni el parser, ni la validación, ni
    la dedup. Nada del EID pasa por acá.
11. **Lo que el prebuild se lleva puesto.** `expo prebuild` reescribe dos scripts de `package.json` (defecto
    conocido y anotado en el backlog); verificado con `git diff` que el único cambio que queda en ese archivo es
    la dep. Y `app/android` es artefacto gitignoreado (`app/.gitignore` → `/android`), así que la regeneración
    no ensucia el commit.

## MUTANTES: cada guard falsificado rompiendo lo que vigila

Script `scratchpad/mutants_f2.py` — aplica el mutante, corre las suites y **restaura el archivo en un
`finally`**, en **binario** (cero churn de CRLF); cada restauración se verifica byte a byte. Baseline y cierre
iguales.

| # | Mutante | tsc | Suites | Quién lo mata |
|---|---|---|---|---|
| **M1** | `app.config.ts`: `modes: ['central']` (background BLE de iOS **ON**) | — | 🔴 46/1 | *"el plugin … está declarado y SIN background"* |
| **M2** | `app.config.ts`: **se saca** `neverForLocation` (queda el default `false` de la lib) | — | 🔴 44/**3** | *"el plugin de BLE declara `neverForLocation`"* + *"con los DOS plugins … NINGÚN permiso de ubicación sin tope"* + *"los permisos declarados ALCANZAN"* |
| **M3** | `app.config.ts`: **se saca** `bluetoothAlwaysPermission` (queda el default en inglés de la lib) | — | 🔴 46/1 | *"el purpose string que el plugin de BLE escribe es EL NUESTRO"* |
| **M4** | `app.config.ts`: `isBackgroundEnabled: true` | — | 🔴 45/2 | el de background **+** *"NO declara `uses-feature bluetooth_le required=true`"* |
| **M5** | `permissions-android.ts`: `ble-gatt.legacy = []` (se olvida la ubicación en API ≤ 30 → escaneo muerto en Android 11) | — | 🔴 127/3 | *"`ble-gatt` en API ≤ 30 pide ACCESS_FINE_LOCATION"* + *"el borde exacto es 31"* + **la contraprueba de vacuidad** |
| **M6** | `permissions-android.ts`: **se borra la fila `mfi`** (tabla no exhaustiva) | **EXIT=2** | 🔴 128/2 | el `satisfies` (typecheck) **y** el guard derivado del fuente de `driver-types.ts` |
| **M7** | `permissions-android.ts`: `transport: TransportKind = 'spp'` (el default silencioso) | — | 🔴 129/1 | *"`transport` es un parámetro REQUERIDO (sin default)"* (oráculo `Function.length`) |
| **M8** | `permissions-android.ts`: `?? ANDROID_BLUETOOTH_PERMISSIONS.spp` (el fallback "cómodo", familia MR1b de F1) | — | 🔴 128/2 | *"un transporte que NO está en la tabla no cae al conjunto de otro"* + *"una clave del PROTOTIPO no tira"* |
| **M9** | `with-bluetooth-classic.js`: se le saca el tope `maxSdkVersion=30` a `ACCESS_FINE_LOCATION` | — | 🔴 26/**5** | los 3 guards viejos del plugin **+ los 2 nuevos** de la política combinada |
| **M10** | `ios-purpose-strings-guard.test.ts`: `CENSUS` sin `react-native-ble-plx` | — | 🔴 15/1 | *"CENSO: las dependencias DIRECTAS con código nativo Apple son exactamente estas"* (es el rojo con el que nació el task) |
| **M11** | `permissions-android.ts`: `set === undefined` en vez de `hasOwnProperty` (el bug que encontré en la autorrevisión) | — | 🔴 26/1 | *"una clave del PROTOTIPO no tira"* → `TypeError: … is not iterable` |

Dos lecturas que valen: **(a)** M8 es el mutante importante — es el `?? fallback` que el review de F1 usó para
falsificar un guard de grafías, y acá muere por **comportamiento** (dos tests distintos), no por un regex;
**(b)** M2 y M9 muestran que la política de permisos está vigilada **desde los dos lados** (nuestra declaración
y la del plugin de terceros), que era justo el agujero que T2.7 tenía.

## Verificación (ejecutada)

| Qué | Comando | Resultado |
|---|---|---|
| Typecheck | `app/node_modules/.bin/tsc -p app/tsconfig.json --noEmit` | **EXIT=0** |
| Suites BLE (todas) + `app.config` + guard de purpose strings + plugin del bastón | `node --import ./scripts/ts-ext-resolver.mjs --test app/src/services/ble/*.test.ts app/app.config.test.ts app/ios-purpose-strings-guard.test.ts app/plugins/with-bluetooth-classic.test.ts` | **459 / 459, 0 fail** |
| `permissions-android.test.ts` sola | idem | **26 / 26** (eran 11) |
| `app.config.test.ts` sola | idem | **16 / 16** (eran 11) |
| `ios-purpose-strings-guard.test.ts` sola | idem | **16 / 16** (eran 15) — y **nació en rojo** al instalar la dep, como el task pedía |
| `with-bluetooth-classic.test.ts` sola | idem | **15 / 15** (eran 10) |
| **Toda** la lista de `client unit tests` de `run-tests.mjs` (offline, sin DB) | el comando literal del script | **3154 / 3154, 0 fail** |
| Config nativa resultante (iOS) | `npx expo config --type introspect --json` | purpose string **en español**, `UIBackgroundModes == ['remote-notification']`, EA `[]` |
| Prebuild de Android | `npx expo prebuild -p android` | **exit 0** |
| **EL VETO**: build local de Android | `node scripts/gradle.mjs --stop` + `node scripts/gradle.mjs :app:assembleDebug` | **BUILD SUCCESSFUL en 3m 23s, exit 0** · `app-debug.apk` · **0 builds de EAS** |
| Permisos del APK | manifiesto **mergeado** (`merged_manifest/debug/expoDebugOverrideMaxSdkConflicts/`) | ninguna ubicación sin tope · `BLUETOOTH_SCAN` con `neverForLocation` · sin `uses-feature bluetooth_le` |
| Lockfile | `git diff --stat app/pnpm-lock.yaml` | **+17 / −0** — solo la dep nueva (+2 líneas de normalización de `transitivePeerDependencies`) |
| Gate 1 ATRIBUIBLE | `git status --porcelain supabase/ sync-streams/` | 15 líneas bajo `supabase/`, **0 nuestras**; `sync-streams/` **vacío** → **N/A** |
| Mutantes | `scratchpad/mutants_f2.py` | tabla de arriba — **11/11 muertos**; árbol restaurado byte a byte y re-verificado |
| **`node scripts/check.mjs` completo** (typecheck + client units + las 17 suites contra la DB remota) | `node scripts/check.mjs` | **RC=0 — "All tests passed" / "Entorno listo. Podés trabajar."**, **0 fallos** en todo el log |
| Cierre después del último fix | typecheck + la lista completa de units | **EXIT=0** · **3155 / 3155, 0 fail** |

> **Orden exacto de las corridas, para que nadie tenga que suponerlo**: el `check.mjs` completo (RC=0) corrió
> **antes** del último hallazgo de la autorrevisión (el `hasOwnProperty` de las claves del prototipo) y de la
> batería de mutantes. Ese fix toca **un solo archivo de cliente** (`permissions-android.ts`) que **ninguna** de
> las suites de `supabase/` ejerce, así que la re-verificación es typecheck + **las 3155 units completas**, las
> dos en verde después del fix. Dicho en vez de presentar el RC=0 como si fuera posterior.
>
> ⚠️ **Contexto del entorno durante estas corridas**: la otra terminal estuvo trabajando sobre `supabase/tests/*`
> (rebrand de los emails de los fixtures) y comparte la DB remota. El `check.mjs` salió limpio igual (0 fallos, sin
> rate-limit), pero si el reviewer lo re-corre y ve rojos en las suites de backend, el primer sospechoso es ese
> cruce (flake catalogado), no F2 — que no toca nada bajo `supabase/`.

### Gate 1 (N/A, RBM9.1/RBM9.2) — con el oráculo ATRIBUIBLE, no con `git diff`

```
$ git status --porcelain supabase/ sync-streams/      # 2026-08-17, HEAD 80c7022
 M supabase/tests/{animal,audit,custom,edge,import,maneuvers,operaciones_rodeo,puesta-en-servicio,
                   reports,rls,scrotal,sigsa,sync_streams,treatments,user_private}/run.cjs
                                                      # sync-streams/ → 0 líneas
```

**15 líneas, NINGUNA de F2.** Son de la otra terminal (unidad *rebrand*): el diff es
`@rafaq-test.local` → `@mitropero-test.local` en los emails de los fixtures de test (33 inserciones / 33
borrados, verificado leyendo el diff de `tests/rls/run.cjs`). Ninguna aparece en la lista de archivos de F2 de
más abajo, y **ningún archivo mío está bajo `supabase/` ni `sync-streams/`** → **Gate 1 N/A**. (`git diff
supabase/` está prohibido por RBM9.2 y no se usó: mide el árbol y es ciego a los untracked.)

### Gate 2.5 / capturas (ADR-029) — **N/A, declarado**

F2 **no toca ninguna superficie de UI**: los archivos cambiados son un `.ts` de política de permisos, un `.js`
de config plugin, `app.config.ts` y cuatro suites de test. **Cero `.tsx`**, cero componentes, cero pantallas →
no hay estado nuevo que capturar y no corresponde un `app/e2e/captures/<feature>.capture.ts`. Las superficies de
UI del delta (instrucciones por transporte, filas del escaneo BLE) las trae **F4/T4.8**, y sus capturas van con
esa fase; las del device, con F6/T6.6.

### Lo que NO verifiqué (dicho, no barrido)

- **Runtime del módulo nativo.** El build no lo prueba (§5). Es F6 y necesita device: `PackageList` registra el
  package, pero que `NativeModules.BlePlx` resuelva bajo bridgeless lo dice el aparato, no Gradle.
- **iOS.** No se corrió `pod install` ni build de iOS: la dep nueva cambia el fingerprint y el build de iOS está
  **gateado por el OK explícito de Raf, por plataforma y por build** (RBM9.8). Lo que sí se verificó del lado de
  iOS, sin gastar nada: el `Info.plist` que resulta de aplicar los mods (`expo config --type introspect`) y que
  el podspec de la lib usa `install_modules_dependencies` + rama `RCT_NEW_ARCH_ENABLED` (inspección del veto).
- **E2E de Playwright.** No se corrió (es del leader, ~38 min, y re-renderiza `design/**/*.png`). Riesgo
  argumentado como **bajo**: F2 no agrega ni cambia ninguna superficie de UI ni ningún camino que la E2E ejerza
  (en web el binding es `serial`, y la dep nueva no se importa desde ningún módulo).
- **`:app:assembleRelease`** y la instalación en el A07. F2 pide "build local", no QA en device.

## Reconciliación de specs al as-built (paso 9, hecha ANTES de reportar)

| Archivo | Qué se reconcilió |
|---|---|
| `tasks-ios-ble-mfi.md` | Fase F2 marcada `[x]` (T2.0–T2.8) con recuadro de estado y **una nota `(as-built)` por task**: la versión y su criterio, la RUTA del veredicto del censo (red por nombre, no escaneo de símbolos), las dos opciones no previstas del plugin, el `transport` requerido + `hasAndroidPermissionPolicy`, el permiso nuevo en el otro array del manifiesto, y la precisión de que el build **no** prueba que la app "arranque". Se corrigió además la referencia cruzada de T2.7 (decía *"(T6.6)"*, es **T8.6**) |
| `design-ios-ble-mfi.md` §2.2 | Fila de `permissions-android.ts` (firma real + `hasAndroidPermissionPolicy` + los wrappers), de `app.config.ts` (las 4 opciones), de `with-bluetooth-classic.js` (el permiso que agrega el otro plugin, en el array que el `replace` no alcanza) y de `ios-purpose-strings-guard.test.ts` (por qué NO va en `MODULE_VERDICTS` + el límite nº5 reconciliado). **Dos filas nuevas** que la tabla no tenía: `app.config.test.ts` y `with-bluetooth-classic.test.ts` |
| `design-ios-ble-mfi.md` §4 | La tabla de permisos gana la fila de `serial`/`ble-hid`/`mfi` (la exhaustividad los obliga); el bullet "sin background" aclara que son **dos** opciones distintas; y un recuadro `as-built` con lo que el párrafo *"no hace falta cambiar la política"* no preveía (el `ACCESS_COARSE_LOCATION` del otro plugin) + la nota para F3 de que en API ≤ 30 el escaneo exige el **servicio** de ubicación prendido |
| `requirements-ios-ble-mfi.md` | Notas de reconciliación bajo **RBM2.13** (3 puntos), **RBM2.15**, **RBM2.17** (la ruta del veredicto + el límite nº5) y **RBM2.18** (la premisa *"sí tiene C++/JSI"* era **falsa**; el riesgo real es el módulo legacy bajo interop; veredicto FIRME con su límite). Los EARS **no se reescribieron**: van como notas, patrón `impl_13`. La **Pregunta abierta 2** de la Puerta 1 quedó marcada **RESUELTA** |
| `progress/veto_ble-plx.md` | Cabecera con el **veredicto FINAL FIRME**, la tabla de evidencia del build, y el matiz del codegen vacío / módulo legacy. La sección *"Lo que este veto NO prueba"* quedó con su nota de **CERRADO** |

## Archivos de F2 (los únicos que el reviewer tiene que mirar / stagear)

**Dependencia (2)**
- `app/package.json` — `react-native-ble-plx: 3.5.1`. ⚠️ **el prebuild reescribe los scripts `android`/`ios`**: ya
  se revirtieron a mano; verificar en el diff que la única línea nueva es la dep.
- `app/pnpm-lock.yaml` — +17 / −0.

**Config nativa (3)**
- `app/app.config.ts` — el plugin de BLE con sus 4 opciones (background off, `neverForLocation`, purpose string)
  \+ el comentario del plugin del SPP reconciliado (decía que `BLUETOOTH_CONNECT` era *"el único de runtime"* y que
  *"este camino NO hace discovery"*: las dos cosas dejaron de ser ciertas con el `ble-gatt`).
- `app/plugins/with-bluetooth-classic.js` — **solo comentarios** (reconciliación RBM7.6 + el segundo plugin). La
  lista `BLUETOOTH_PERMISSIONS` **no cambió** (la política es idéntica).
- `app/src/services/ble/permissions-android.ts` — tabla exhaustiva por transporte, `transport` requerido,
  `hasAndroidPermissionPolicy`.

**Código de producción (1)**
- `app/src/services/ble/adapter-spp-android.ts` — **2 líneas** en `defaultSppEnv()`: los wrappers que pasan
  `'spp'` explícito. ⚠️ El resto del diff de ese archivo (el `driver` que pasó de `private` a `readonly`
  público) es de **F1**, no de F2 — el árbol tiene las dos fases sin commitear.

**Tests (4 modificados, 0 nuevos archivos)**
- `app/src/services/ble/permissions-android.test.ts` (11 → **26**)
- `app/app.config.test.ts` (11 → **16**)
- `app/ios-purpose-strings-guard.test.ts` (15 → **16**; + el `CENSUS`)
- `app/plugins/with-bluetooth-classic.test.ts` (10 → **15**)
- ➜ **`scripts/run-tests.mjs` NO se tocó**: las cuatro ya estaban en su lista explícita y no hay suites nuevas.
  (El archivo está **compartido** con la otra terminal — verificado que su bloque sigue intacto porque no lo abrí.)

**Specs / progreso**
- `specs/active/04-bluetooth-baston/{tasks,design,requirements}-ios-ble-mfi.md` — reconciliados al as-built.
- `progress/veto_ble-plx.md` — veredicto FIRME con la evidencia.
- `progress/impl_ios-ble-mfi-f2.md` (este archivo).

**Artefactos gitignoreados que cambiaron** (no se commitean, pero conviene saberlo): `app/android/**` completo
(regenerado por el prebuild — de paso quedó **al día con el rebrand**: `rootProject.name`/`app_name` = `miTropero`,
cerrando el pendiente de `docs/marketing/plan-toma-de-marca-mitropero.md`) y el `app-debug.apk`.

## Para el leader (no lo hago yo)

- **No commiteé nada** (límite del despacho). Al stagear: los archivos de F2 son los de la lista de arriba. **NO**
  van `supabase/tests/*/run.cjs` (15 archivos de la otra terminal, rebrand de fixtures), ni `progress/current.md`,
  ni `docs/adr/ADR-024*`, `docs/backlog.md`, `docs/bastones-mercado-argentino.md`,
  `specs/active/10-operaciones-rodeo/*`, `scripts/seed-facundina.mjs`, `progress/qa_maniobras-device.md` — nada de
  eso es mío. Y **ojo con `design/**/*.png` y `app/e2e/**`**: aparecen modificados en el árbol por la corrida de
  E2E de otra sesión, no por F2 (regla conocida: revertir `design/` antes de commitear).
- `feature_list.json` y `progress/current.md`: **no los toqué** (límite duro del despacho).
- **F3 está desbloqueada** (el veto es FIRME). Dos insumos que F2 le deja escritos y que le ahorran un fix-loop:
  (a) en API ≤ 30 el escaneo BLE exige el **servicio de ubicación prendido**, que no es un permiso y tiene que
  ser un estado del adapter; (b) el adapter tiene que pedir permisos con `androidBluetoothPermissionsFor(api,
  'ble-gatt')` vía un `BleEnv` con `checkPermissions`/`ensurePermissions` **envueltos** con su transporte, como
  quedó `defaultSppEnv()`.
- **iOS sigue gateado**: la dep nueva cambia el fingerprint, así que el build de iOS necesita el **OK explícito de
  Raf, por plataforma y por build** (RBM9.8). Antes de pedirlo conviene tener F3/F4 en verde y el banco de Android
  corrido (F6), que es el orden que la propia spec pone en T6.4.
