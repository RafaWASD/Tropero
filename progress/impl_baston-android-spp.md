baseline_commit: 6d1fd748b015e32b70271c70f6dd284a07b220b7

# Unidad — «el bastón funciona de verdad en Android» (SPP nativo)

**Feature**: 04-bluetooth-baston (status `deferred`; la parte que se cierra acá es la que estaba
gated por hardware: **T-MV.5.1** —el veto de compatibilidad— y **T-MV.5.5** —montar el adapter en el
provider—, ambas `[ ]` en `tasks-multivendor.md`).

**Pedido de Raf** (textual, tras el fix cosmético anterior): *"Te pedí que lo desarrolles no que lo
escondas. Quería desarrollo completo de Bluetooth y conectar bastón para android"*.

**Base**: `6d1fd74`, árbol limpio. Titularidad de BLE en esta terminal.

---

## Plan (tasks reales de esta unidad)

- [x] **T1 — GATE 0**: vetar `react-native-bluetooth-classic` contra RN 0.85.3 + Expo SDK 56 + New
      Architecture **antes** de instalar. Evidencia contra el código instalado, no contra blogs.
- [x] **T2** — instalar la dependencia nativa + confirmar autolinking.
- [x] **T3** — `spp-protocol.ts` (piezas puras del transporte) + tests.
- [x] **T4** — `permissions-android.ts` (permisos de runtime Android 12+) + tests.
- [x] **T5** — reescribir la I/O de `adapter-spp-android.ts` (framing real, permisos, BT apagado,
      desconexión del SO, reconexión, lista de emparejados) + tests de la máquina de estados.
- [x] **T6** — wiring: `selectTransportAdapter` (Android → `spp-android`), `instantiateTransport`
      (con guard de módulo nativo presente), `BUILT_ADAPTERS`.
- [x] **T7** — pantalla de conexión: lista REAL de devices emparejados del teléfono.
- [x] **T8** — config plugin de Expo (la lib no trae uno) + `app.config.ts` + tests.
- [x] **T9** — verificación: `check.mjs`, build Gradle real, manifiesto mergeado, E2E BLE.
- [x] **T10** — reconciliar specs (`04-bluetooth-baston/*`) + `docs/backlog.md`.

---

## GATE 0 — veredicto: **COMPATIBLE**, verificado contra el código instalado y con un build real

El veto previo (`tasks-multivendor.md` T-MV.5.1, 2026-07-20) decía *"RIESGO ALTO NO RESUELTO: la lib
usó históricamente el bridge viejo… es la MISMA clase de fallo que bloqueó react-native-quick-sqlite
bajo bridgeless"*. Ese riesgo **queda resuelto**, y la analogía con quick-sqlite era incorrecta:

| Pregunta | Evidencia | Veredicto |
|---|---|---|
| ¿Es TurboModule? | El `package.json` publicado **no tiene `codegenConfig`**; `RNBluetoothClassicPackage` implementa `ReactPackage.createNativeModules()` (bridge legacy) | Legacy, no migrada |
| ¿Anda un módulo legacy con `newArchEnabled=true` (RN 0.85.3)? | `ReactPackageTurboModuleManagerDelegate.kt` (RN 0.85.3 instalado) tiene la rama `shouldSupportLegacyPackages()` → `shouldEnableLegacyModuleInterop = enableBridgelessArchitecture() && useTurboModuleInterop()`, y `ReactNativeNewArchitectureFeatureFlagsDefaults.kt:35` define `useTurboModuleInterop() = newArchitectureEnabled \|\| super…` | **Sí**: el interop está ON por defecto justamente cuando la new arch está prendida |
| ¿Por qué NO es el caso quick-sqlite? | quick-sqlite fallaba porque instalaba **bindings JSI** a mano contra el runtime del bridge (no hay interop para eso). Esta lib es un NativeModule de métodos `@ReactMethod` + eventos por `RCTDeviceEventEmitter`: exactamente lo que el interop cubre. **No tiene una línea de JSI ni de C++** (el tarball no trae `cpp/` ni `CMakeLists`) | Clase de fallo distinta |
| ¿Las APIs de RN que usa siguen existiendo en 0.85.3? | Los 17 imports `com.facebook.*` del código nativo existen en `node_modules/react-native/ReactAndroid/src/main/java/…` (`ReactPackage.kt`, `ReactContextBaseJavaModule.kt`, `BaseJavaModule.java`, `JavaScriptModule.kt`, `DeviceEventManagerModule.kt`, `ViewManager.java`, …) | OK |
| ¿Resuelve la dependencia Maven? La lib pide `com.facebook.react:react-native:0.71.0-rc.0` (coordenada muerta) | `DependencyUtils.kt` del gradle-plugin de RN 0.85.3 sustituye `com.facebook.react:react-native` → `react-android` y **fuerza** la versión, sobre `rootProject.allprojects` | OK |
| ¿Compila con Gradle 9.3.1 + AGP 8.12.0 + compileSdk 36 + JDK 17? | **Se corrió**: `./gradlew :react-native-bluetooth-classic:assembleDebug` → `BUILD SUCCESSFUL in 1m 21s`, `compileDebugJavaWithJavac` sin errores (solo notas de deprecación) | **Verificado, no deducido** |
| ¿Autolinkea? | `android/build/generated/autolinking/autolinking.json` incluye `"packageInstance":"new RNBluetoothClassicPackage()"` | OK |
| ¿Trae config plugin de Expo? | **No**: el tarball publicado (86 archivos) no tiene `app.plugin.js` | Se escribió uno propio |
| ¿ViewManagers / Fabric? | `createViewManagers()` devuelve lista vacía | N/A (el interop de Fabric no entra en juego) |

Versión instalada: **`react-native-bluetooth-classic@1.73.0-rc.17`** (dist-tag `latest`, publicada
2025-11-19). Es un "rc" desde hace años en esa lib — la línea 1.60 también lo era; no hay versión
estable publicada. Se pinea exacta.

---

## Qué cambió, archivo por archivo

### Dependencia y build

| Archivo | Cambio |
|---|---|
| `app/package.json`, `app/pnpm-lock.yaml` | `+ react-native-bluetooth-classic 1.73.0-rc.17` (pin exacto). El lock solo suma (26 inserciones, 0 borrados): la dep + `buffer`/`ieee754`. |
| `app/plugins/with-bluetooth-classic.js` | **NUEVO**. Config plugin de Expo (la lib no trae). Declara la política de permisos Android del bastón y —lo importante— **topea `ACCESS_FINE_LOCATION` a `maxSdkVersion=30` con `tools:node="replace"`**: la lib lo declara SIN tope y el manifest merger lo metía solo, o sea la app pedía permiso de ubicación sin usarlo. Lógica pura exportada aparte (`applyBluetoothPermissions`) para testearla sin cargar Expo. |
| `app/app.config.ts` | `+ './plugins/with-bluetooth-classic'` en `plugins`. |

### Servicio BLE

| Archivo | Cambio |
|---|---|
| `app/src/services/ble/spp-protocol.ts` | **NUEVO**, puro. `RNBC_FIXED_SPP_UUID` + `sppUuidIsSupported` (la lib hardcodea el UUID RFCOMM: un driver con otro UUID **no** es alcanzable y hay que decirlo, no fingirlo), `sppConnectOptions()` (delimitado por `\n`, sin baud, sin valores numéricos), `splitSppPayload()`, `normalizePairedDevices()`. |
| `app/src/services/ble/permissions-android.ts` | **NUEVO**. `androidBluetoothPermissionsFor(api)` (API ≥31 → `BLUETOOTH_CONNECT`; ≤30 → nada), `classifyPermissionResults` (fail-closed), `ensureAndroidBluetoothPermissions()` con require perezoso de RN. **No** se pide `BLUETOOTH_SCAN` ni ubicación: este camino no hace discovery. |
| `app/src/services/ble/adapter-spp-android.ts` | **REESCRITA la I/O.** Ver "bugs" abajo. Suma `loadRNBC` (chequea el **módulo nativo**, no el paquete JS), `isSppNativeAvailable()`, `listPairedSppDevices()`, e inyección de entorno (`SppEnv`) que vuelve testeable la máquina de estados completa. |
| `app/src/services/ble/adapter-selection.ts` | `platformOS === 'android'` → `'spp-android'` (antes `'manual'` con el comentario "hasta que la Fase 4 esté construida"). iOS sigue en `'manual'`. |
| `app/src/services/ble/BleStickListenerProvider.tsx` | `instantiateTransport('spp-android')` → `isSppNativeAvailable() ? new SppAndroidAdapter() : null`. |

### UI

| Archivo | Cambio |
|---|---|
| `app/src/features/ble-stick/connection-view.ts` | `deviceRowView` suma el opt-in `allowUnrecognized` + el estado `'unrecognized-connectable'`; nueva `pairedDevicesView(state)` (copy es-AR de los 8 estados de la lista de emparejados). |
| `app/src/features/ble-stick/components/StickDeviceRow.tsx` | El ícono de alerta cubre también `'unrecognized-connectable'`. |
| `app/src/features/ble-stick/screens/StickConnectionScreen.tsx` | `BUILT_ADAPTERS` += `'spp-android'`. En el camino SPP, la sección "Dispositivos" pasa a listar los **emparejados reales del teléfono** (carga con gesto explícito, no al entrar: la primera llamada dispara el diálogo de permiso). Web/iOS: idéntico a antes. |

### Tests

`spp-protocol.test.ts` (nuevo, 14), `permissions-android.test.ts` (nuevo, 9),
`adapter-spp-android.test.ts` (reescrito: 8 → 36), `with-bluetooth-classic.test.ts` (nuevo, 10),
`connection-view.test.ts` (+10), `app.config.test.ts` (+1), `wiring.test.ts` y
`selection-priority.test.ts` (actualizados al nuevo comportamiento de Android).
Los 4 archivos nuevos quedaron enganchados en `scripts/run-tests.mjs` (la lista es explícita: un test
que no figure ahí NUNCA corre).

---

## Bugs reales encontrados (todos en código que ya estaba "escrito y testeado")

1. 🔴 **Framing invertido — el adapter no habría emitido UNA SOLA lectura.** Pasaba `event.data` por
   `LineFramer` (que corta por `\n`), pero el `DelimitedStringDeviceConnectionImpl` de la lib entrega
   el mensaje **ya delimitado y sin el `\n`** (`StandardOption.DELIMITER` = `"\n"`). Un payload sin
   `\n` → `LineFramer.push()` devuelve `[]` **siempre**. Los tests no lo veían porque alimentaban al
   framer con datos sintéticos que sí traían `\n`. Cerrado por `splitSppPayload` + dos tests de
   regresión que usan el payload EXACTO que produce el nativo.
2. 🔴 **`pairDevice()` colgaba el connect para siempre.** Se llamaba en cada `connect()`. El nativo
   hace `createBond()` y espera un broadcast de bond-state; sobre un device **ya emparejado** —el
   caso normal, porque el RS420 se empareja una vez en los ajustes— `createBond()` devuelve false, el
   broadcast no llega y **la promesa nunca resuelve**: el `await` dejaba el estado clavado en
   `'connecting'`. Ya no se llama nunca (test de regresión con una promesa que no resuelve).
3. 🟠 **La cadena de reintentos moría después del primer fallo.** `currentDeviceId` se anotaba solo al
   CONECTAR bien, así que el reintento llamaba `connect(undefined)` → caía en el device *recordado*,
   que en el primer emparejamiento todavía es `null` → `disconnected` y fin. Justo el caso "el bastón
   está apagado, prendelo". Ahora el objetivo se recuerda al resolverlo.
4. 🟠 **Un connect nuevo no cancelaba el reintento pendiente** → el guard de `scheduleReconnect`
   (`cancelScheduled != null`) quedaba trabado y **el corte siguiente ya no reconectaba nunca**.
5. 🟠 **Background = reconexión muerta.** `scheduleReconnect` hacía `return` si la app no estaba en
   foreground y no re-armaba nada: minimizar el teléfono en el momento del reintento dejaba el bastón
   desconectado para siempre. Ahora queda un listener de `AppState` esperando el retorno a 'active'.
6. 🟡 **`available` de la lib JS ≠ módulo nativo en el APK.** `require('react-native-bluetooth-classic')`
   resuelve igual desde `node_modules` aunque el binario no esté en el build (dev build viejo). Sin
   chequear `NativeModules.RNBluetoothClassic` montaríamos un transporte fantasma → chip y CTA que
   prometen y no cumplen: **exactamente el bug que cerró el fix del 2026-07-29**. Por eso
   `instantiateTransport` usa `isSppNativeAvailable()`.
7. 🟡 **`ACCESS_FINE_LOCATION` sin tope** entrando por el manifiesto de la lib (ver config plugin).
8. 🟡 **Lecturas de una sesión ya cerrada.** `subscription.remove()` es best-effort del otro lado del
   puente; se agregó un contador de sesión para que una lectura en vuelo no aparezca como caravana
   leída después de un `disconnect()`.

---

## Verificación

### `node scripts/check.mjs`

<!-- OUTPUT_CHECK -->

### Build Gradle real (no deducido)

<!-- OUTPUT_GRADLE -->

### E2E

<!-- OUTPUT_E2E -->

---

## Qué queda GATED por hardware (RS420 físico) y qué NO

<!-- GATED -->

---

## Autorrevisión adversarial

<!-- SELFREVIEW -->

---

## Reconciliación de specs

<!-- RECONCILE -->
