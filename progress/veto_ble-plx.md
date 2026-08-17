# Veto de `react-native-ble-plx` contra el stack instalado (RBM2.18 / F2)

## ✅ VEREDICTO FINAL: **COMPATIBLE — FIRME** (build real, 2026-08-17)

La mitad empírica que este documento declaraba faltante **se cerró** en F2: `react-native-ble-plx@3.5.1`
instalada, config plugin cableado, `expo prebuild -p android` + **`:app:assembleDebug` → BUILD SUCCESSFUL
en 3m 23s (exit 0)**, APK generado. Detalle, evidencia y los límites de lo que un build prueba:
**`progress/impl_ios-ble-mfi-f2.md` §5**. Lo esencial, para no tener que abrir el otro archivo:

| Qué se probó con el build | Resultado |
|---|---|
| Autolinking del módulo | `PackageList.java:71` → `new com.bleplx.BlePlxPackage()` |
| Compilación del nativo Android | `:react-native-ble-plx:compileDebugJavaWithJavac` + `bundleLibCompileToJarDebug` ✔ |
| Codegen de new arch sobre la lib | `generateCodegenSchemaFromJavaScript` + `generateCodegenArtifactsFromSchema` corren ✔ … con **schema VACÍO** (ver abajo) |
| Empaquetado | `:app:packageDebug` / `:app:assembleDebug` ✔ — `app-debug.apk` |
| Permisos del APK (manifiesto **mergeado**) | sin ubicación sin tope; `BLUETOOTH_SCAN` con `neverForLocation`; **sin** `uses-feature bluetooth_le` |

**El matiz que NO hay que perder (y que un "compila" tapa)**: el `schema.json` del codegen sale
`{"libraryName":"","modules":{}}` → la lib **no tiene specs de TurboModule**. `BlePlxModule extends
ReactContextBaseJavaModule` con `@ReactModule`: es un **módulo de puente LEGACY**, que bajo bridgeless
funciona por la **capa de interop**, no como TurboModule nativo. O sea: el build prueba que **compila,
linkea, se autolinkea y se empaqueta**; **no** prueba que el puente JS↔nativo resuelva en runtime. El
precedente que sostiene esa mitad es fuerte pero es un precedente, no una medición:
`react-native-bluetooth-classic` es **exactamente la misma clase de módulo** (legacy, sin codegen) y **lee
de verdad en device** sobre este mismo stack. La medición definitiva es el banco de F6 (RBM6.1), que es
donde la spec la pone.

---

**2026-08-17 · leader · read-only, sin instalar nada.**

**Veredicto (primera mitad): COMPATIBLE por inspección de fuente. Provisional — falta la mitad empírica (un build real).**

## Contra qué tiene que convivir

| | |
|---|---|
| expo | `~56.0.15` |
| react-native | **0.85.3** (verificado en `node_modules`, no en el rango del `package.json`) |
| react | `19.2.3` |
| arquitectura | `newArchEnabled` **no está declarado** en `app.config.ts` → SDK 56 la deja en su default (new arch / bridgeless) |
| versión candidata | `react-native-ble-plx@3.5.1` (última publicada) |

## Lo que se midió (tarball `npm pack`, sin instalar)

1. **Expo NO lo tiene en su lista de módulos nativos de SDK 56** (122 paquetes, ninguno de Bluetooth) → no hay
   versión bendecida por Expo. **No implica incompatible**: implica *no vetado por Expo*, y por eso este veto.
2. **Android** (`android/build.gradle`): contempla new arch explícitamente — `isNewArchitectureEnabled()`,
   `buildConfigField "boolean", "IS_NEW_ARCHITECTURE_ENABLED"`, y bloque de codegen con
   `codegenJavaPackageName = "com.bleplx"`.
3. **iOS** (`react-native-ble-plx.podspec`): usa `install_modules_dependencies` (helper de RN ≥ 0.71) y
   ramifica por `RCT_NEW_ARCH_ENABLED == '1'` con `folly_compiler_flags`.
4. Trae **config plugin de Expo** (`app.plugin.js` + `plugin/build/withBLE.js`,
   `withBLEAndroidManifest.js`, `withBLEBackgroundModes.js`, `withBluetoothPermissions.js`).
5. `codegenConfig` es `null` en el `package.json` — la config de codegen vive en el bloque `react { }` del
   gradle (estilo viejo), no arriba. Funciona, pero conviene saberlo.

## 🔑 Por qué el precedente que asustaba NO aplica

La spec citó `react-native-quick-sqlite` (bindings **JSI** que no se instalaban bajo bridgeless) como la
clase de fallo a temer, señalando que ble-plx *"sí trae C++/JSI"*.

**Eso es falso, y es el punto que destraba el veto.** El paquete **no tiene una sola fuente C++/JSI**: los
únicos `.h` son `BlePlx-Bridging-Header.h`, `BlePlx-Swift.h` y `BlePlx.h` — cabeceras de puente
ObjC/Swift, no JSI. ble-plx es un módulo de puente/TurboModule, no una librería de bindings JSI. El modo
de falla de quick-sqlite **no tiene dónde ocurrir acá**.

## Lo que este veto NO prueba

Es **inspección de fuente**, no un build. El precedente T-MV.5.1 exige vetar contra **un build de Gradle
real**, no contra documentación. Esa mitad requiere instalar la dep, que es F2.

**Cómo se cierra**: instalar en F2 → `node scripts/gradle.mjs :app:assembleDebug` → si compila y linkea, el
veto pasa de provisional a firme. Si no compila, el delta se replantea: **el HID (F0/F7) y el MFi (F5) no
dependen de esta dependencia** y sobreviven al replanteo.

> **CERRADO el 2026-08-17 (F2)** — ver la cabecera de este archivo. El build compiló y linkeó a la primera,
> sin parchear nada del proyecto nativo. La versión instalada es **3.5.1** (la misma que se inspeccionó acá:
> instalar otra habría invalidado esta mitad del veto). Y quedó **dicho** lo que el build no prueba: la
> reachability del puente en runtime, que la mide el banco en device (F6).

## Consecuencia para el plan

El riesgo más grande de la unidad baja de "puede matar la mitad del delta" a "hay que confirmarlo con un
build de Android, que es local y no consume EAS". **No cambia el orden de fases.**
