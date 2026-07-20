# impl_04-multivendor-services

baseline_commit: 672149bb0ab0c9dedc35a32ce81cef7b43d69b37

> Feature 04 (`04-bluetooth-baston`) — DELTA «multivendor + selección + demo».
> Este run = **capa de servicios/lógica**: Fases MV.0, MV.1, MV.2, MV.3 + CÓDIGO de MV.5 (+ MV.6.1 confirmación de arquitectura).
> **NO** hace la UI (Fase MV.4, otro run) ni toca `_layout.tsx` (host-level, otro run).
> Fuente de verdad: `specs/active/04-bluetooth-baston/{context,requirements,design,tasks}-multivendor.md` + ADR-024 (enmienda 2026-07-20).

## Nota de coordinación (colisión-safe)
El working tree al arrancar YA tenía cambios sin commitear de **otra terminal** (feature 20 reactividad-sync +
`establishments.ts`/`admin.ts`/`local-reads.*`/contexts/etc. — todos en mi lista de NO-tocar). NO los toqué.
Mis cambios viven exclusivamente en `app/src/services/ble/*` + `scripts/run-tests.mjs` + reconciliación de specs 04.

## Plan (tasks de este run)

- [x] T-MV.0.1 — Core as-built confirmado intacto (leí contract/stick-adapter/adapter-selection/parser-rs420/line-framer/remembered-device/permissions/provider). NO se reescribió ninguno.
- [x] T-MV.0.2 — Extensiones aditivas de union: `stick-adapter.ts` kind += `'simulator'`; `adapter-selection.ts` `AdapterKind` += `'simulator'`, `ProviderMode` += `'demo'`; `permissions.ts` `case 'simulator'`; `instantiateTransport` `case 'simulator'`.
- [x] T-MV.0.3 — `driver-types.ts` (PURO).
- [x] T-MV.1.1 — `driver-rs420.ts` (`RS420_DRIVER`, reusa `parseRs420Line`/`SPP_UUID`/`DEFAULT_BAUD`).
- [x] T-MV.1.2 — `driver-registry.ts` (`DRIVER_REGISTRY`, `driverByVendorId`, `findDriverForDevice`).
- [x] T-MV.1.3 — `driver-registry.test.ts`.
- [x] T-MV.2.1 — `selection-priority.ts` `platformTransportPriority` + `adapterForTransport`.
- [x] T-MV.2.2 — `selection-priority.ts` `selectReaderBinding`.
- [x] T-MV.2.3 — `adapter-selection.ts` rama `mode==='demo' → 'simulator'` (auto/mock/manual sin cambios).
- [x] T-MV.2.4 — `selection-priority.test.ts` (incl. regresión de `selectTransportAdapter`).
- [x] T-MV.3.1 — `demo-gate.ts` `isDemoMode()`.
- [x] T-MV.3.2 — `adapter-simulator.ts` `SimulatorAdapter`.
- [x] T-MV.3.3 — `BleStickListenerProvider.tsx` `instantiateTransport` `case 'simulator'` (triple-guard 3).
- [x] T-MV.3.4 — `demo-gate.test.ts` + `adapter-simulator.test.ts`.
- [x] T-MV.5.1 — Veto config plugin (chequeo liviano desde docs, sin instalar). Ver §Veto abajo.
- [x] T-MV.5.2/5.3/5.7 — `adapter-spp-android.ts` reescrito (StickAdapter real, import perezoso, param por driver, LineFramer, baud-independiente).
- [x] T-MV.5.4 — `adapter-spp-android.test.ts` (partes puras + import no tira).
- [x] T-MV.6.1 — Confirmación de arquitectura MFi (`adapterForTransport('mfi')→null`, driver mfi-only → binding null) en `selection-priority.test.ts`.
- [x] run-tests.mjs — registra los 5 test files nuevos.

## Archivos tocados (todos 04-owned, colisión-safe)

**Nuevos** (`app/src/services/ble/`):
- `driver-types.ts` (PURO) — `TransportKind`, `TransportCapability` (discriminada), `FrameParser`, `DeviceMatcher`, `DiscoveredDevice`, `DiscoveryChannel`, `ReaderDriver`/`ReaderProfile`.
- `driver-rs420.ts` (PURO) — `RS420_DRIVER` (reusa `parseRs420Line`/`SPP_UUID`/`DEFAULT_BAUD`).
- `driver-registry.ts` (PURO) — `DRIVER_REGISTRY`, `driverByVendorId`, `findDriverForDevice` (registry inyectable).
- `selection-priority.ts` (PURO) — `platformTransportPriority`, `adapterForTransport`, `selectReaderBinding`, `ReaderBinding`, `BindingEnv`.
- `demo-gate.ts` (PURO) — `isDemoMode`, `isDemoBuildAllowed`, `BLE_DEMO_GLOBAL_KEY`.
- `adapter-simulator.ts` — `SimulatorAdapter` (`kind:'simulator'`).
- Tests: `driver-registry.test.ts`, `selection-priority.test.ts`, `adapter-simulator.test.ts`, `demo-gate.test.ts`, `adapter-spp-android.test.ts`.

**Reescritura de placeholder**: `adapter-spp-android.ts` (placeholder → `SppAndroidAdapter` real + `resolveSppParams` exportado).

**Ediciones ADITIVAS al core** (sin romper firmas):
- `stick-adapter.ts` — `StickAdapter['kind']` += `'simulator'`.
- `adapter-selection.ts` — `AdapterKind` += `'simulator'`; `ProviderMode` += `'demo'`; rama `mode==='demo' → 'simulator'` (antes de la lógica de plataforma).
- `permissions.ts` — `case 'simulator': { kind: 'none' }`.
- `BleStickListenerProvider.tsx` — imports `SimulatorAdapter` + `isDemoMode`; `instantiateTransport` `case 'simulator': isDemoMode() ? new SimulatorAdapter() : null` (triple-guard 3).
- `scripts/run-tests.mjs` — registra los 5 test files nuevos.

**Specs reconciliadas**: `tasks-multivendor.md` (T-MV.3.1 fórmula del gate al as-built + checkboxes de las tasks de este run).

**NO tocado**: `_layout.tsx` (host-level, otro run), `features/ble-stick/*` + `features/animals/*` (UI/spec 09), `contract.ts`, `dedup.ts`, `parser-rs420.ts`, `line-framer.ts`, `remembered-device.ts`, `config.ts`, `connection-status.ts`, `baston-test.tsx`, y NINGÚN archivo de la otra terminal (feature 20 + `establishments.ts`/`admin.ts`/`local-reads.*`/contexts — ya modificados por la otra terminal ANTES de esta sesión; verificado por `git status` inicial).

## Trazabilidad RMV → test

| RMV | Archivo:función | Test |
|---|---|---|
| RMV1.1, RMV1.2, RMV6.1 (tipos) | `driver-types.ts` | (tipos usados por todos; `selection-priority.test.ts` "mfi-only" verifica `protocolString` declarable) |
| RMV1.3 | `driver-rs420.ts` `RS420_DRIVER` | `driver-registry.test.ts` "RMV1.3: RS420_DRIVER declara spp… reusa parseRs420Line" |
| RMV1.4 | `driver-registry.ts` `DRIVER_REGISTRY`/`driverByVendorId` | `driver-registry.test.ts` "RMV1.4: …driverByVendorId…" |
| RMV1.5 | `driver-registry.ts` `findDriverForDevice` | `driver-registry.test.ts` "RMV1.5: …por nombre" / "…por UUID" |
| RMV1.6 | aditividad (registry inyectable) | `driver-registry.test.ts` "RMV1.6: registrar un driver sintético…" |
| RMV1.7 | `driver-registry.ts` `findDriverForDevice`=null | `driver-registry.test.ts` "RMV1.7: device que no matchea → null" |
| RMV2.1 | `selection-priority.ts` `platformTransportPriority` | `selection-priority.test.ts` "RMV2.1: …por plataforma" |
| RMV2.2, RMV6.2, RMV6.3 | `selection-priority.ts` `adapterForTransport` | `selection-priority.test.ts` "RMV2.2: …mapea…" / "RMV6.2/6.3: ble-gatt y mfi → null" |
| RMV2.3, RMV2.4 | `selection-priority.ts` `selectReaderBinding` | `selection-priority.test.ts` "RMV2.3/2.4: RS420 android…" / "web…" |
| RMV2.5 | `selectReaderBinding` → null | "RMV2.5: RS420 iOS → null" / "SPP-only web/iOS → null" |
| RMV2.6 | `selection-priority.ts` (puro, inyectado) | "RMV2.6: …determinístico" |
| RMV2.7 | `adapter-selection.ts` `selectTransportAdapter` (rama demo, resto intacto) | "RMV2.7 regresión: auto/mock/manual idénticos" |
| RMV2.8 | `selectReaderBinding` (prioridad determinística) | "RMV2.8: SPP+HID android → spp" / "…iOS → HID" |
| RMV4.1 | `adapter-simulator.ts` `SimulatorAdapter` | `adapter-simulator.test.ts` "RMV4.1: kind + connect" / "…disable no propaga" |
| RMV4.2 | `SimulatorAdapter.emit` + contrato | `adapter-simulator.test.ts` "RMV4.2: emit()…pipeline" / "N emits válidos y distintos" |
| RMV4.3 (triple-guard 1) | `adapter-selection.ts` (auto nunca simulator) | `selection-priority.test.ts` "RMV4.3: …nunca simulator salvo mode=demo" |
| RMV4.4/4.5 (triple-guard 2/3) | `demo-gate.ts` `isDemoMode`; provider `instantiateTransport` | `demo-gate.test.ts` (sin marca/prod/dev+marca) + provider case (typecheck) |
| RMV4.7 (integridad SENASA) | triple-guard (RMV4.3/4.4/4.5) | `demo-gate.test.ts` "…prod-safe" + `selection-priority.test.ts` "RMV4.3" |
| RMV5.1, RMV5.2, RMV5.3, RMV5.7 | `adapter-spp-android.ts` (`SppAndroidAdapter`/`resolveSppParams`) | `adapter-spp-android.test.ts` "RMV5.2: resolveSppParams" / "RMV5.3: framing→EID" |
| RMV5.4 | `adapter-spp-android.ts` (pairing + remembered lazy) | código (device-gated); partes puras testeadas |
| RMV5.5 | `adapter-spp-android.ts` `scheduleReconnect`/`backoffDelayMs` | `adapter-spp-android.test.ts` "RMV5.5: reusa backoffDelayMs" |
| RMV5.6 | `adapter-spp-android.ts` (import perezoso) | `adapter-spp-android.test.ts` "RMV5.6: import no tira" / "connect sin lib no tira" |
| RMV5.8 | veto config plugin (spike, sin instalar) | doc — ver §Veto abajo (RIESGO new-arch, gate = dev build) |
| RMV5.9 | device-gated (código + puros = entregable) | doc — conexión SPP real NO validada (sin hardware) |
| RMV6.1, RMV6.2 | `driver-types.ts` (`mfi` params) + `adapterForTransport('mfi')→null` | `selection-priority.test.ts` "RMV6.1/6.2: mfi-only → binding null" |

## Autorrevisión adversarial (paso 8)

Revisé como revisor hostil; cerré todo antes de reportar:
1. **¿Alguna edición rompió `selectTransportAdapter` para auto/mock/manual?** NO. La rama `demo` va antes de la lógica de plataforma pero `mode='auto'` nunca la alcanza. Regresión explícita (`selection-priority.test.ts` "RMV2.7 regresión") verifica web→web-serial, mock→mock (3 OS), manual→manual, auto+native→manual — idénticos al as-built. Verde.
2. **¿El simulador puede instanciarse en prod?** NO — triple-guard airtight: (1) `selectTransportAdapter(mode='auto')` nunca devuelve `'simulator'` (solo `mode='demo'`, test RMV4.3); (2) `isDemoMode()` false en prod (sin `__DEV__`, sin `extra.demoBuild`; tests demo-gate "prod-safe"); (3) `instantiateTransport('simulator')` devuelve `null` si `!isDemoMode()`. Los 3 fallan en un bundle de prod → sin camino a un EID simulado declarado como real (RMV4.7). El host (`_layout.tsx`, otro run) recién pasa `mode='demo'` bajo el gate — no lo toqué.
3. **¿`import('./adapter-spp-android')` tira sin la lib?** NO — todos los imports top-level son puros/tipos; `react-native-bluetooth-classic`, `remembered-device` (que arrastra RN+secure-store) y `react-native` (AppState) son require PEREZOSO dentro de la I/O. Test "RMV5.6: import no tira" + "connect sin lib no tira" verdes. `require('...')` no lo resuelve tsc (devuelve any) → typecheck sin la dep instalada.
4. **¿Redefiní algún tipo de spec 09?** NO — `BleStickEvent`/`ConnectionStatus`/`StickAdapter` se reusan; solo extendí el union `StickAdapter['kind']` de forma ADITIVA (+`'simulator'`). Los tipos nuevos (`ReaderDriver`, etc.) son nuevos, no redefinen nada del core/09.
5. **¿RS420 en iOS da `null` (no `hid-wedge`)?** SÍ da `null` — el RS420 declara solo `spp`+`serial`; en iOS ninguno mapea → binding null → carga manual. El caso `hid-wedge` en iOS se prueba con un driver HID sintético, NO con el RS420 (tests RMV2.5 + "HID genérico iOS"). Verde.
6. **¿Toqué algún archivo prohibido?** NO — `git status` confirma que solo cambié `app/src/services/ble/*` + `scripts/run-tests.mjs` (+ progress + specs 04). `_layout.tsx`, `features/*`, `establishments.ts`, `admin.ts`, `local-reads.*` NO fueron editados por mí (los `M` de esos dos últimos son de la otra terminal, pre-sesión).
7. **Edge extra encontrado y cubierto**: (a) el simulador genera EIDs DISTINTOS por llamada para no ser comidos por la dedup por-TAG (test "N emits distintos") + auto-verifica `isValidTag` con fallback a un EID fijo válido; (b) match de UUID case-insensitive (el SO puede anunciar en minúsculas mientras `SPP_UUID` está en mayúsculas) — test explícito; (c) la marca demo solo cuenta si es `=== true` (no truthy) — test explícito; (d) `disconnect()` del simulador detiene el auto-play (no deja timer colgado) — test.

## Reconciliación de specs (regla dura, paso 9)

- `tasks-multivendor.md` **T-MV.3.1**: la redacción tenía la fórmula VIEJA del gate (`&& !isProduction()` con `NODE_ENV==='production' || !__DEV__`). El as-built usa la fórmula del **design §5 Guard 2 + RMV4.4** (ampliada por el leader pre-Puerta 1): `&& isDemoBuildAllowed()` = `(__DEV__ === true) || isExplicitDemoBuild()`. Reconciliado en la task con nota. `requirements-multivendor.md` (RMV4.4) y `design-multivendor.md` (§5 Guard 2, §2.1) YA traían la fórmula nueva → no requerían cambio. Sin contradicción restante.
- Checkboxes `[x]` de las tasks de este run (MV.0/1/2/3, MV.5.2-5.4, MV.6.1) marcadas.
- **Detalle as-built menor** (no contradice el design; documentado acá): `findDriverForDevice` y `driverByVendorId` aceptan un `registry` inyectable (default global) para el test de aditividad RMV1.6; `selectTransportAdapter` mantiene su firma `(env: SelectionEnv): AdapterKind`. El design pseudocódigo no lo detallaba pero es compatible.

## Verificación (network-free — NO se corrió check.mjs: pega a la DB compartida, otra terminal activa)

- `cd app && pnpm typecheck` → **VERDE** (exit 0). Los switches exhaustivos (`permissions.ts`, `instantiateTransport`) forzaron completar el `case 'simulator'` — red de seguridad OK.
- **5 test suites nuevos** (`node --disable-warning … --import ./scripts/ts-ext-resolver.mjs --test driver-registry.test.ts selection-priority.test.ts adapter-simulator.test.ts demo-gate.test.ts adapter-spp-android.test.ts`) → **41/41 pass, 0 fail**.
- **Regresión de los 9 ble tests existentes** (parser/dedup/contract/feedback/adapter-mock/adapter-web-serial/wiring/offline-noread/listener-gate) → **78/78 pass, 0 fail**. Total ble: **119/119**.
- Casos verificados explícitamente (pedidos en el brief): regresión `selectTransportAdapter` auto/mock/manual idénticos ✓; RS420-android→spp-android ✓; RS420-web→web-serial ✓; RS420-iOS→null ✓; HID-genérico-iOS→hid-wedge/available:false ✓; ambigüedad SPP+HID→spp ✓; `isDemoMode()` false sin marca / false en prod / true con marca+dev ✓; `emit()` dispara el pipeline ✓; `import('./adapter-spp-android')` no tira ✓.

## Veto del config plugin `react-native-bluetooth-classic` (RMV5.8) — chequeo liviano (sin instalar)

Stack actual: **Expo ~56.0.15 + React Native 0.85.3 (New Architecture / bridgeless, NO apagable — reanimated@4 la exige)**. `react-native-bluetooth-classic` NO instalada (correcto para este delta).

**Veredicto: RIESGO ALTO NO RESUELTO — el gate real es el dev build Android, no una decisión de docs.**
- El config plugin (permisos Android 12+ `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` + `neverForLocation`, `NSBluetoothAlwaysUsageDescription`) es lo de MENOS: es un `app.plugin.js` estándar que se puede reconciliar.
- El bloqueante **probable** es la compat con **New Architecture / bridgeless de RN 0.85**: `react-native-bluetooth-classic` (kenjdavidson) usó históricamente el bridge viejo (`RCTBridgeModule`/`RCTEventEmitter`) y tiene issues abiertas de new-arch. Es la **MISMA clase de fallo** que bloqueó `react-native-quick-sqlite` en este mismo proyecto (JSI bindings no instalados bajo bridgeless → hubo que migrar a op-sqlite). Ver `progress/current.md` §bring-up nativo.
- No se puede confirmar viable NI descartar desde docs sin instalar/prebuildear. **NO bloquea este run** (el código usa import perezoso → importa y testea sin la lib; el entregable buildable-hoy está completo).
- **Recomendación al leader/dev-build (T-MV.5.1, gated)**: tratar la validación en un dev build Android como el GATE explícito antes de comprometer la conexión SPP real (RMV5.9). Si el módulo no soporta new-arch en RN 0.85, evaluar (a) fork/patch new-arch, (b) módulo alternativo de Classic SPP con soporte bridgeless, o (c) diferir SPP-Android detrás del camino HID-wedge (que no necesita módulo nativo de Classic). La arquitectura driver-registry + selección lo absorbe sin tocar el contrato.

## Estado final

Todas las tasks de este run cerradas (MV.0/1/2/3 + código MV.5.2-5.4 + MV.6.1). UI (MV.4), host-level `_layout.tsx`, device-test SPP real (MV.5.5), y check.mjs end-to-end quedan fuera de este run (otros runs / gated). Listo para el reviewer. **NO marco `done`.**
</content>
</invoke>
