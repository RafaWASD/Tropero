# Spec 04 — DELTA «multivendor + selección + demo» — Tasks

**Status**: `spec_ready` (delta-spec ADR-028 Nivel B — mini-ciclo propio; **NO reabre el core aprobado de spec 04, ni toca su `tasks.md` original**).
**Fecha**: 2026-07-20 (sesión bastón).
**Fuente**: `requirements-multivendor.md` (RMV) + `design-multivendor.md`. Cada `RMV<n>` mapea a ≥1 task; cada task referencia ≥1 `RMV<n>`.

> **Reglas** (`docs/specs.md`): pasos discretos en orden, cada uno con `[ ]` + los `RMV<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificación. Cada `RMV<n>` mapea a ≥1 test.

> **Orden de despacho para el leader.** Las fases están ordenadas para despachar implementers por fase, respetando dependencias:
> 1. **Fases MV.0–MV.4 = buildable-hoy sin hardware** (registro + selección + simulador + UI). Todo unit puro / mock / simulador. Se puede cerrar entero sin ningún bastón.
> 2. **Fase MV.5 = `adapter-spp-android` escrito** (código + tests puros hoy; device-test GATED por hardware). Depende del registro (MV.1) + veto del config plugin.
> 3. **Fase MV.6 = gated / fuera de este delta** (MFi/EA, GATT, device-validation real). Arquitectura preparada, sin implementar.

| Fase | Buildable hoy | Gated por hardware | Gated por negocio (MFi) |
|---|---|---|---|
| MV.0 — Setup (uniones aditivas + tipos) | ✅ | — | — |
| MV.1 — Registro de drivers (RMV1) | ✅ (puro) | — | — |
| MV.2 — Motor de selección (RMV2) | ✅ (puro) | matching device→driver real | — |
| MV.3 — Simulador + gate demo (RMV4) | ✅ (dev/demo-gated) | — | — |
| MV.4 — Pantalla de conexión + indicador (RMV3) | ✅ (UI + mock/web-serial/sim) | conexión real SPP/HID | — |
| MV.5 — `adapter-spp-android` (RMV5) | ✅ **código + tests + dep nativa instalada + montado en Android** (2026-07-29) | stream de un RS420 **físico** (T-MV.5.6) | — |
| MV.6 — MFi/EA + GATT (RMV6) | arquitectura declarable | — | ✅ adapter EA/MFi |

---

## Fase MV.0 — Setup (buildable hoy)

- [x] T-MV.0.1 — Confirmar el core as-built intacto: `contract.ts`, `stick-adapter.ts`, `adapter-selection.ts`, `parser-rs420.ts`, `line-framer.ts`, `remembered-device.ts`, `permissions.ts`, `BleStickListenerProvider.tsx`. **NO reescribir** ninguno. Cubre: prerrequisito (RMV1–RMV5).
- [x] T-MV.0.2 — Extensiones **aditivas** de union (04-owned): `stick-adapter.ts` `StickAdapter['kind']` += `'simulator'`; `adapter-selection.ts` `AdapterKind` += `'simulator'`, `ProviderMode` += `'demo'`. Completar los switches exhaustivos que el typecheck marque (`permissions.ts` → `case 'simulator': {kind:'none'}`; `instantiateTransport`). Cubre: RMV2.7 (aditividad), RMV4.1 (kind).
- [x] T-MV.0.3 — `driver-types.ts`: `TransportKind`, `TransportCapability` (discriminada), `FrameParser`, `DeviceMatcher`, `DiscoveredDevice`, `DiscoveryChannel`, `ReaderDriver`/`ReaderProfile`. PURO (sin RN). Cubre: RMV1.1, RMV1.2, RMV6.1 (params `mfi`).

## Fase MV.1 — Registro de drivers (buildable hoy, puro)

- [x] T-MV.1.1 — `driver-rs420.ts`: `RS420_DRIVER` con transportes `spp` (`SPP_UUID`, pin `'1234'`) + `serial` (`DEFAULT_BAUD`), `frameParser` = `{ parse: parseRs420Line }` (reuso, **no** reimplementa), `deviceMatch` (`/RS\s?420|allflex/i` + `[SPP_UUID]`), `streaming:true`. Cubre: RMV1.3.
- [x] T-MV.1.2 — `driver-registry.ts`: `DRIVER_REGISTRY = [RS420_DRIVER]`, `driverByVendorId(id)`, `findDriverForDevice(device)` (cruza `deviceMatch` con nombre/UUIDs). Cubre: RMV1.4, RMV1.5, RMV1.7.
- [x] T-MV.1.3 — `driver-registry.test.ts` (node:test): RS420 matchea un device `{name:'RS420…'}` / uno con `advertisedServiceUuids:[SPP_UUID]`; un device desconocido → `findDriverForDevice`=`null` (RMV1.7); `driverByVendorId('allflex-rs420')` OK / `null` para inexistente; **test de aditividad** (RMV1.6): registrar un driver sintético en una copia del registry y resolverlo por selección NO requiere editar `contract.ts`/`stick-adapter.ts`/adapters. Cubre: RMV1.3, RMV1.4, RMV1.5, RMV1.6, RMV1.7.

## Fase MV.2 — Motor de selección por capacidad (buildable hoy, puro)

- [x] T-MV.2.1 — `selection-priority.ts`: `platformTransportPriority(os)` (ios `['ble-hid','ble-gatt','mfi']`; android `['spp','ble-gatt','ble-hid']`; web `['serial']`; otro `[]`); `adapterForTransport(kind,os)` (spp+android→`spp-android`; serial+web→`web-serial`; ble-hid→`hid-wedge`; ble-gatt/mfi→`null`). Cubre: RMV2.1, RMV2.2, RMV6.2, RMV6.3.
- [x] T-MV.2.2 — `selection-priority.ts`: `selectReaderBinding(env)` → `{adapterKind,transportKind,driver,available}` eligiendo el transporte de mayor prioridad soportado con adapter mapeado; `available = env.builtAdapters.includes(adapterKind)`; sin transporte alcanzable → `null` (RMV2.5). Puro, entradas inyectadas (RMV2.6). Cubre: RMV2.3, RMV2.4, RMV2.5, RMV2.6.
- [x] T-MV.2.3 — `adapter-selection.ts`: rama `if (env.mode === 'demo') return 'simulator';` **antes** de la lógica de plataforma; `auto`/`mock`/`manual` **sin cambios** de resultado. Cubre: RMV2.7, RMV4.3.
- [x] T-MV.2.4 — `selection-priority.test.ts` (node:test): RS420 en android→`{spp-android,spp}`; en web→`{web-serial,serial,available:true}`; **RS420 en ios→`null`** (no declara ble-hid/gatt/mfi → no alcanzable → manual, RMV2.5); **driver HID genérico en ios→`{hid-wedge,ble-hid,available:false}`**; driver solo-HID en android→`{hid-wedge,ble-hid,available:false}`; ambigüedad (device SPP+HID en android)→`spp` gana determinístico (RMV2.8); driver sin transporte alcanzable→`null` (RMV2.5); `available` con `builtAdapters` inyectado (RMV2.4); **regresión** `selectTransportAdapter` (`auto`/`mock`/`manual` idénticos al as-built) (RMV2.7). Cubre: RMV2.1–RMV2.8.

## Fase MV.3 — Simulador + gate demo (buildable hoy, dev/demo-gated)

- [x] T-MV.3.1 — `demo-gate.ts`: `isDemoMode()` puro = `globalThis.__RAFAQ_BLE_DEMO__ === true && isDemoBuildAllowed()`, donde `isDemoBuildAllowed() = (__DEV__ === true) || isExplicitDemoBuild() || isE2eDemoAllowed()` (`isExplicitDemoBuild()` lee `Constants.expoConfig?.extra?.demoBuild === true` con require perezoso; `isE2eDemoAllowed()` = `globalThis.__RAFAQ_BLE_E2E__ === true`, contexto no-prod de E2E/captura), todo envuelto en try/catch. `__DEV__` leído con `typeof` (safe en node). No seteable desde UI/input. Cubre: RMV4.4. **[Reconciliación as-built 2026-07-20: la redacción original decía `&& !isProduction()` (`NODE_ENV==='production' || !__DEV__`); se reconcilió a `&& isDemoBuildAllowed()` para alinear con RMV4.4 (ampliado por el leader pre-Puerta 1) + design §5 Guard 2 — "dev O build de demo explícito", que habilita una demo standalone sin romper la garantía prod-safe. El requirement y el design ya traían la fórmula nueva; solo esta task quedaba con la vieja.]**
- [x] T-MV.3.2 — `adapter-simulator.ts`: `SimulatorAdapter` (`kind:'simulator'`, `StickAdapter`): `connect`→`'connected'`; `emit(eid?)` empuja un EID sintético **válido** (`isValidTag`) por `onTagRead`; respeta `enable/disable`; opcional auto-play (`startAutoPlay(intervalMs)`/`stop`). Cubre: RMV4.1, RMV4.2.
- [x] T-MV.3.3 — `BleStickListenerProvider.tsx` `instantiateTransport`: `case 'simulator': return isDemoMode() ? new SimulatorAdapter() : null;` (triple-guard 3). El simulador entra por `handleReading(value, isRawStream=false)` (mismo contrato: validate+dedup+confirm pre-commit+feedback). Cubre: RMV4.5, RMV4.8.
- [x] T-MV.3.4 — `demo-gate.test.ts` + `adapter-simulator.test.ts` (node:test): sin marca→`isDemoMode()` false; en prod (`__DEV__` false / ausente)→false; con marca+dev→true (RMV4.4); `emit()` de EID válido dispara el pipeline (candidato→commit→tag_read); `disable`→no emite; EID sintético siempre pasa `isValidTag` (RMV4.2); `selectTransportAdapter(mode:'auto')` **nunca** `'simulator'` (RMV4.3). Cubre: RMV4.1, RMV4.2, RMV4.3, RMV4.4.

## Fase MV.4 — Pantalla de conexión + indicador (buildable hoy; conexión real SPP/HID gated)

- [x] T-MV.4.1 — `connection-view.ts` (PURO): `ConnectionStatus → {label,hint,cta}` (apagado/permiso/buscando/conectando/conectado/desconectado, RMV3.4); `ReaderBinding → estado de fila` (available true/false, RMV3.7; driver=null → "no reconocido", RMV3.8); marca "DEMO" para lecturas del simulador (RMV4.6). Cubre: RMV3.4, RMV3.7, RMV3.8, RMV4.6. **[as-built: `app/src/features/ble-stick/connection-view.ts` — `connectionStatusView`, `deviceRowView` (incluye el estado `recognized-unreachable` para RMV2.5: RS420 en iOS, driver reconocido sin transporte alcanzable), `readingBadge`.]**
- [x] T-MV.4.2 — `features/ble-stick/screens/StickConnectionScreen.tsx`: consume el provider global (`useBleProviderApi` + `useBleConnectionStatus`), NO monta provider propio (RMV3.1); flujo descubrir→listar→elegir→conectar específico por adaptador del binding (SPP listar/elegir/olvidar; web-serial requestPort/getPorts; HID instrucción+scan) (RMV3.2); elegir device → `writeRememberedDevice` (RMV3.3); estados con CTA desde `connection-view.ts` (RMV3.4); no bloqueante (RMV3.6). Monta en "Más" (ADR-018). Cubre: RMV3.1, RMV3.2, RMV3.3, RMV3.4, RMV3.6. **[as-built: la sub-UI por adaptador (`TransportInstructions`) se deriva del `ReaderBinding`; la LISTA de web-serial es el diálogo NATIVO de puertos del navegador (la interfaz `StickAdapter` del core NO expone `getPorts` — ver reconciliación en design §7). `writeRememberedDevice(driver.vendorId)` como marcador de reconexión.]**
- [x] T-MV.4.3 — `features/ble-stick/components/StickDeviceRow.tsx` + `StickStatusIndicator.tsx`: fila de device (reconocido/no-reconocido/available RMV3.7/3.8); indicador global en el chrome alimentado por `useBleConnectionStatus()` (RMV3.5). Cubre: RMV3.5, RMV3.7, RMV3.8. **[as-built: el indicador se monta en `app/app/_layout.tsx` (`BleHost`, hermano del stack), `pointerEvents="box-none"` no bloqueante + auto-oculto en 'off'. NO tocó ningún archivo de spec 09.]**
- [x] T-MV.4.4 — `features/ble-stick/components/DemoControls.tsx`: "Simular lectura" + (opcional) auto-play, montado **solo** bajo `isDemoMode()` (re-chequeo, triple-guard 3); marca las lecturas del simulador como "DEMO" (RMV4.6). Cubre: RMV4.5, RMV4.6. **[as-built: re-chequeo `isDemoMode() && transport instanceof SimulatorAdapter` → null si no es demo.]**
- [x] T-MV.4.5 — **Frontera host-level (coordinar con el leader, colisión-safe):** `app/app/_layout.tsx` → prop `mode` del provider raíz `… : (isDemoMode() ? 'demo' : 'auto')` (1 línea, análoga a `isBleE2E`); entrada de ruta a `StickConnectionScreen` en "Más" (ADR-018); montaje de `StickStatusIndicator` en el chrome. **Si montar el indicador exigiera tocar un contrato de spec 09 → parar y reportar.** NO tocar archivos de teléfono/auth. Cubre: RMV3.1 (nav), RMV3.5 (montaje), RMV4.4 (wiring del gate). **[as-built: precedencia demo en el `mode` + `<Stack.Screen name="baston" />` + route file `app/app/baston.tsx` + `<StickStatusIndicator/>` en `BleHost`. La FILA de "Más" (`(tabs)/mas.tsx`) que navega a `/baston` queda PENDIENTE de coordinación: `mas.tsx` es de la otra terminal (feature 19/20) — colisión-safe, no se tocó; la ruta ya es alcanzable por deep-link. Snippet de la fila en `progress/impl_04-multivendor-ui.md`.]**
- [x] T-MV.4.6 — `connection-view.test.ts` (node:test) + component/E2E con simulador/mock: mapeo estado→vista; binding available=false → CTA manual sin conectar (RMV3.7); device sin driver → "no reconocido" (RMV3.8); lectura demo marcada "DEMO" (RMV4.6). Cubre: RMV3.4, RMV3.7, RMV3.8, RMV4.6. **[as-built: `connection-view.test.ts` (10 casos node:test) verde + registrado en `scripts/run-tests.mjs`. El component/E2E con simulador va en el run APARTE de Gate 2.5 (E2E + capturas), fuera de este run buildable-hoy — ver T-MV.7.2.]**

## Fase MV.5 — `adapter-spp-android` ESCRITO (código + tests puros hoy; conexión real GATED)

> **Depende de** MV.1 (driver RS420). El **código se escribe hoy**; la **conexión SPP real** y el **dev build** quedan GATED por hardware. El config plugin se **veta** sin instalar la dependencia.

- [x] T-MV.5.1 — **VETO (prerrequisito, gated):** probar la compatibilidad del config plugin de `react-native-bluetooth-classic` con Expo SDK 56 + permisos Android 12+ (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`, `neverForLocation`), **sin instalar la dep ni prebuildear el dev build**. Si incompatible, **PARAR y reportar al leader**. **Aceptación**: dev build documentado como viable o el bloqueo reportado. Cubre: RMV5.8. **[Veto liviano 2026-07-20 (sin instalar): stack = Expo ~56.0.15 + RN 0.85.3 NEW ARCHITECTURE/bridgeless (no apagable — reanimated@4 la exige). RIESGO ALTO NO RESUELTO: `react-native-bluetooth-classic` (kenjdavidson) usó históricamente el bridge viejo (RCTBridgeModule/RCTEventEmitter) y tiene issues abiertas de New Architecture; es la MISMA clase de fallo que bloqueó `react-native-quick-sqlite` (JSI bindings no instalados bajo bridgeless RN 0.85 → migración a op-sqlite). El config plugin (permisos Android 12+) es lo de MENOS; el bloqueante probable es la compat new-arch del módulo nativo. NO se puede confirmar viable desde docs → el gate REAL es el dev build Android. NO bloquea este run (el código usa import perezoso → importa/testea sin la lib). El leader/dev-build debe tratar esto como GATE explícito antes de comprometer la conexión SPP real.]**
  **[VETO CERRADO — 2026-07-29 (Gate 0 de la unidad «bastón Android SPP»): COMPATIBLE. El riesgo del veto liviano NO se materializó y la analogía con `react-native-quick-sqlite` era incorrecta.** Evidencia contra el código INSTALADO + un build REAL, no contra docs: (1) la lib es un NativeModule **legacy** (`ReactPackage.createNativeModules()`, sin `codegenConfig`), y RN 0.85.3 lo soporta bajo bridgeless por el **interop de módulos legacy** — `ReactPackageTurboModuleManagerDelegate.shouldSupportLegacyPackages()` ⇐ `enableBridgelessArchitecture() && useTurboModuleInterop()`, y `ReactNativeNewArchitectureFeatureFlagsDefaults.kt:35` define `useTurboModuleInterop() = newArchitectureEnabled`, o sea el interop está **ON justamente cuando `newArchEnabled=true`**. (2) quick-sqlite fallaba por **bindings JSI** instalados a mano (para eso NO hay interop); esta lib **no tiene una línea de JSI ni de C++** (el tarball no trae `cpp/` ni `CMakeLists`) → clase de fallo distinta. (3) Los 17 imports `com.facebook.*` de su código nativo existen en RN 0.85.3. (4) Su `implementation 'com.facebook.react:react-native:0.71.0-rc.0'` (coordenada muerta) lo resuelve el `DependencyUtils.kt` del gradle-plugin de RN, que sustituye a `react-android` y fuerza la versión sobre `rootProject.allprojects`. (5) **Compila de verdad**: `./gradlew :react-native-bluetooth-classic:assembleDebug` → BUILD SUCCESSFUL (Gradle 9.3.1 + AGP 8.12.0 + compileSdk 36 + JDK 17). (6) Autolinkea: `autolinking.json` trae `new RNBluetoothClassicPackage()`. (7) **Config plugin: la lib NO trae ninguno** (86 archivos publicados, sin `app.plugin.js`) → se escribió uno propio, `app/plugins/with-bluetooth-classic.js`, que además **topea el `ACCESS_FINE_LOCATION` que la lib declara SIN tope**. Detalle y tabla de evidencia en `progress/impl_baston-android-spp.md`.]**
- [x] T-MV.5.2 — `adapter-spp-android.ts` — **reescribir el placeholder** a `StickAdapter` real (`kind:'spp-android'`): abre RFCOMM SPP (UUID del driver, `SPP_UUID`) vía `react-native-bluetooth-classic` con **import perezoso** (require dentro de la I/O, patrón `feedback.ts`); parametrizado por `RS420_DRIVER` (sppUuid/pin/frameParser, RMV5.2); framing por línea (`LineFramer`, reuso, RMV5.3) → línea cruda al contrato; baud-independiente (RMV5.7). Cubre: RMV5.1, RMV5.2, RMV5.3, RMV5.7.
- [x] T-MV.5.3 — `adapter-spp-android.ts` — pairing SPP (slave, PIN del driver `1234`) + persistencia del device (`remembered-device.ts`, RMV5.4); reconexión con `backoffDelayMs` (reuso), foreground-only (RMV5.5). **Aceptación (código)**: la máquina de estados compila y las partes puras se testean; la conexión real queda gated. Cubre: RMV5.4, RMV5.5.
- [x] T-MV.5.4 — `adapter-spp-android.test.ts` (node:test, **partes puras**): resolución driver→sppUuid/pin/frameParser (RMV5.2); framing por línea → EID correcto por el parser (RMV5.3); backoff (RMV5.5); **`import('./adapter-spp-android')` NO tira** en node/CI sin la lib nativa (RMV5.6). Cubre: RMV5.2, RMV5.3, RMV5.5, RMV5.6.
- [x] T-MV.5.5 — Montar `adapter-spp-android` en el provider para Android device (`instantiateTransport('spp-android')` → `new SppAndroidAdapter()`; `selectTransportAdapter({android,auto})` → `'spp-android'`). Sin tocar el contrato ni los otros adaptadores. **[as-built 2026-07-29 (unidad «bastón Android SPP»)**: montaje HECHO + `BUILT_ADAPTERS` += `'spp-android'` en `StickConnectionScreen`. Una desviación deliberada del enunciado: `instantiateTransport('spp-android')` devuelve el adapter **solo si `isSppNativeAvailable()`** (Platform android + `NativeModules.RNBluetoothClassic != null`), si no `null`. Motivo: `require('react-native-bluetooth-classic')` resuelve desde `node_modules` aunque el binario NO esté en el APK (dev build anterior a la dep) → montar igual sería un transporte fantasma, o sea el mismo CTA-que-no-cumple que cerró el bugfix del chip del 2026-07-29. Con el guard, un build viejo queda manual-first y el chip/CTA se ocultan solos.**]** Cubre: RMV2.7 (montaje).
- [ ] T-MV.5.6 — *(GATED por hardware — RS420 físico)* **Prueba real con el RS420**: stream de lecturas, dedup por-TAG sobre lecturas reales, asignación masiva, corte y reconexión con el bastón físico. **Nadie del equipo tiene un RS420 hoy** → es lo ÚNICO que queda gated de la Fase MV.5 (todo el resto del camino —permisos, BT apagado, enumeración de emparejados, apertura del socket, errores de conexión, backoff, foreground— es ejercitable sin él y quedó cubierto por `adapter-spp-android.test.ts` con `SppEnv` inyectado). **Aceptación**: documentado en `progress/impl_baston-android-spp.md` + `field-findings.md`. Cubre: RMV5.9.

## Fase MV.6 — MFi/EA + GATT (fuera de este delta; arquitectura preparada)

> **Gated por negocio (MFi, canal Facundo) / futuro (GATT).** No se implementa el adapter; se deja la arquitectura declarable.

- [x] T-MV.6.1 — *(arquitectura, buildable hoy)* Confirmar que un `ReaderDriver` puede declarar un `TransportCapability` `kind:'mfi'` con `protocolString`, y que `adapterForTransport('mfi',…)` devuelve `null` (no-buildable) → binding con manual como piso. Test unit del punto de extensión. **El driver RS420 NO popula un `protocolString` real** (desconocido hasta Facundo). Cubre: RMV6.1, RMV6.2.
- [ ] T-MV.6.2 — *(GATED por negocio — NO en este delta)* Implementar `adapter-ea-ios` (External Accessory / MFi) cuando Facundo consiga la autorización + `protocolString` de Allflex. Extiende `AdapterKind`/`adapterForTransport` sin tocar el contrato. **No arranca en este delta.** Cubre: RMV6.2 (futuro).
- [ ] T-MV.6.3 — *(futuro — NO en este delta)* Implementar `adapter-ble-gatt` si aparece un lector con GATT abierto real, declarando `TransportCapability` `kind:'ble-gatt'`, sin tocar el contrato (core R11.3). Cubre: RMV6.3 (futuro).

## Fase MV.7 — Tests, QA e integración

- [x] T-MV.7.1 — Suite node:test del delta (`driver-registry.test.ts`, `selection-priority.test.ts`, `adapter-simulator.test.ts`, `demo-gate.test.ts`, `connection-view.test.ts`, `adapter-spp-android.test.ts`) enganchada en `scripts/run-tests.mjs`; `node scripts/check.mjs` verde end-to-end. **[as-built 2026-07-29: los 6 ya estaban enganchados; la unidad del SPP sumó 3 más a la lista explícita — `spp-protocol.test.ts`, `permissions-android.test.ts` y `plugins/with-bluetooth-classic.test.ts`.]** Cubre: RMV1, RMV2, RMV3 (puro), RMV4, RMV5 (puro).
- [x] T-MV.7.2 — E2E/component de la `StickConnectionScreen` contra el **simulador**: descubrir→elegir→conectar→lectura DEMO marcada→confirmación pre-commit→find-or-create; estados con CTA; no bloqueante; available=false no conecta. Reusa el patrón de gate del bridge E2E. Cubre: RMV3, RMV4.6, RMV4.8. **[as-built 2026-07-20 — Gate 2.5 / ADR-029: DOS artefactos. (1) Suite de regresión `app/e2e/baston-multivendor.spec.ts` (4 casos, 4/4 verde): (a) la pantalla monta bajo demo (2 marcas `__RAFAQ_BLE_E2E__`+`__RAFAQ_BLE_DEMO__` → `isDemoMode()` → `mode='demo'`), RS420 reconocido en web + "Simular lectura" + manual no bloqueante; (b) lectura simulada → find-or-create (confirmación pre-commit del EID) + marca DEMO en la lista; (c) estados off→conectado→desconectado con CTA; (d) REGRESIÓN: E2E no-demo (solo mock) NO monta DemoControls ni el indicador global (`isNonDemoE2E`) y el bridge mock sigue abriendo el overlay. (2) Capture de veto `app/e2e/captures/baston-multivendor.capture.ts` (6 shots: 01 pantalla off, 02 DemoControls, 03 lectura DEMO, 04 find-or-create, 05 desconectado, 06 conectado). NOTAS: `available:false` (RMV3.7) y `unrecognized` (RMV3.8) NO son alcanzables en el E2E web (el RS420 resuelve `recognized-available` en web; exigen mockear `Platform.OS`/inyectar device sintético) → quedan cubiertos por `connection-view.test.ts` (node:test, T-MV.4.6); documentado como N/A del E2E web. La lectura simulada se dispara con RETRY-tap: tras el reload a `/baston` (deep-link) el listener global se re-habilita recién cuando el rodeo activo re-resuelve (warm-up de PowerSync/contextos post-reload); reintentar es colisión-safe (cada emisión del simulador es un EID fresco). Bajo demo, el texto de estado aparece 2 veces (card + indicador global) → asserts con `.first()`. CERO cambio de producción (todos los testIDs/anclas ya existían).]**
- [ ] T-MV.7.3 — *(GATED por hardware)* QA de campo con el RS420 real (dev build Android): pairing/stream/reconexión/dedup/asignación masiva/manual al desconectar; validación del matching device→driver por canal real (RMV1.5, RMV2.8). **Aceptación**: documentado en `progress/impl_04-multivendor.md` + `field-findings.md`. Cubre: RMV5.9, RMV1.5, RMV2.8 (real).
- [ ] T-MV.7.4 — Documentación de cierre: reconciliar `requirements-multivendor.md`/`design-multivendor.md`/`tasks-multivendor.md` al as-built; foldear al baseline (índice "Deltas posteriores" del `design.md` core) un puntero + nota as-built bajo el/los `R<n>` afectados (R9 del core aterriza; R6/R11 extendidos por el registry); actualizar `field-findings.md` (resultado del veto del config plugin / gate device si se corrió). **Aceptación**: docs reflejan el estado real. Cubre: housekeeping.

---

## Resumen de dependencias críticas

```
MV.0 (setup + uniones aditivas + tipos)
   → MV.1 (registro RS420)  →  MV.2 (selección por capacidad)     ← TODO buildable HOY, puro
        ↓                          ↓
   MV.3 (simulador + gate)   →  MV.4 (pantalla + indicador + demo) ← buildable HOY (mock/sim/web-serial)
        ↓
   MV.5 código adapter-spp-android + tests PUROS (buildable HOY)
        ↓
⏸ VETO config plugin (MV.5.1) → ⏸ dev build + Android → MV.5.5 (device-test SPP real)  ← GATED hardware
        ↓
⏸ Facundo (MFi authz + protocolString) → MV.6.2 (adapter-ea-ios)                        ← GATED negocio
⏸ Lector GATT abierto real → MV.6.3 (adapter-ble-gatt)                                   ← futuro
```

## Trazabilidad RMV → tasks

| Requirement | Tasks | Bloqueo |
|---|---|---|
| RMV1.1, RMV1.2 | T-MV.0.3 | OK (buildable hoy) |
| RMV1.3 | T-MV.1.1 | OK |
| RMV1.4, RMV1.5, RMV1.7 | T-MV.1.2, T-MV.1.3 | OK |
| RMV1.6 | T-MV.1.3 (aditividad) | OK |
| RMV2.1, RMV2.2 | T-MV.2.1 | OK |
| RMV2.3, RMV2.4, RMV2.5, RMV2.6, RMV2.8 | T-MV.2.2, T-MV.2.4 | OK (matching real → gated) |
| RMV2.7 | T-MV.0.2, T-MV.2.3, T-MV.2.4 | OK |
| RMV3.1, RMV3.2, RMV3.3, RMV3.4, RMV3.6 | T-MV.4.1, T-MV.4.2, T-MV.4.5 | OK UI / conexión real gated |
| RMV3.5 | T-MV.4.3, T-MV.4.5 | OK |
| RMV3.7, RMV3.8 | T-MV.4.1, T-MV.4.3, T-MV.4.6 | OK |
| RMV4.1, RMV4.2, RMV4.8 | T-MV.3.2, T-MV.3.3, T-MV.3.4 | OK |
| RMV4.3 | T-MV.2.3, T-MV.3.4 | OK |
| RMV4.4, RMV4.5 | T-MV.3.1, T-MV.3.3, T-MV.4.4 | OK |
| RMV4.6 | T-MV.4.1, T-MV.4.4, T-MV.4.6 | OK |
| RMV4.7 | T-MV.3.1, T-MV.3.3 (triple-guard) + frontera spec 09/08 | OK (parar/reportar si toca spec 09/08) |
| RMV5.1, RMV5.2, RMV5.3, RMV5.7 | T-MV.5.2, T-MV.5.4 | OK código / conexión real gated |
| RMV5.4, RMV5.5 | T-MV.5.3, T-MV.5.4 | OK código / real gated |
| RMV5.6 | T-MV.5.2, T-MV.5.4 | OK |
| RMV5.8 | T-MV.5.1 | ⏸ veto (parar si incompatible) |
| RMV5.9 | T-MV.5.5, T-MV.7.3 | ⚠️ GATED hardware |
| RMV6.1, RMV6.2 | T-MV.2.1, T-MV.6.1 | OK arquitectura / adapter EA gated |
| RMV6.3 | T-MV.2.1, T-MV.6.3 | futuro |

## Notas de ejecución

- **NO reescribir** el core (contrato, tipos de spec 09, adaptadores existentes). Extensiones **aditivas** (`'simulator'`, `'demo'`) + reuso (`parser-rs420`, `LineFramer`, `backoffDelayMs`, `remembered-device`, `permissions`, `EidIngestEngine`).
- El `adapter-spp-android` se **escribe** con import perezoso; **no** se instala `react-native-bluetooth-classic` ni se prebuildea el dev build en este delta (RMV5.8). La conexión real es device-gated.
- El simulador es **dev/demo-only** (triple-guard endurecido por `__DEV__`); un EID demo marcado "DEMO" **nunca** se declara como real.
- **Colisión-safe:** trabajar en `app/src/services/ble/*` + `app/src/features/ble-stick/*`; único toque host-level = 1 línea del `mode` en `_layout.tsx` (coordinar). No tocar teléfono/auth.
- Si aparece la necesidad de cambiar un contrato de spec 09 (indicador global, confirmación del simulador, no-declaración SENASA), **PARAR y reportar al leader** — no parchear desde 04.
- **Recomendación de ADR** (design §12): el patrón driver-registry + tabla de selección probablemente merece una **enmienda a ADR-024** — la decide y redacta el **leader** en la Puerta 1, no el spec_author.
- Commits en español, presente, descriptivo (`agrega registro de drivers de bastón`, `crea motor de selección por capacidad`, `escribe adapter-spp-android`, etc.).
