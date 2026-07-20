baseline_commit: 672149bb0ab0c9dedc35a32ce81cef7b43d69b37

# impl_04-multivendor-ui — Fase MV.4 (pantalla de conexión + indicador + demo, capa UI)

Delta `multivendor + selección + demo` de spec 04, **Fase MV.4** (UI/demo). Construye la pantalla de
conexión + el indicador global + los controles de demo ENCIMA de la capa de servicios/lógica
(MV.0–MV.3 + MV.5) ya hecha y verde por Impl-1 (working tree). Fuente de verdad:
`specs/active/04-bluetooth-baston/{requirements,design,tasks}-multivendor.md`.

`baseline_commit` = SHA previo al delta (los cambios MV.0–MV.5 de Impl-1 + esta MV.4 están sin
commitear sobre él; el leader commitea). NO se reescribe (feature multi-sesión).

## Archivos tocados

**Nuevos — territorio de 04 (`app/src/features/ble-stick/`):**
- `connection-view.ts` — PURO: `connectionStatusView(ConnectionStatus)→{label,hint,cta,ctaLabel,connected,tone}` (RMV3.4); `deviceRowView({driver,binding,deviceName})→{state,title,subtitle,actionable,tone}` (RMV3.7/3.8 + `recognized-unreachable` para RMV2.5); `readingBadge(isFromSimulator)→'DEMO'|null` (RMV4.6). Imports SOLO de tipos, por ruta relativa (node:test).
- `connection-view.test.ts` — node:test, 10 casos (RMV3.4/3.7/3.8/2.5/4.6).
- `screens/StickConnectionScreen.tsx` — consume el provider global (`useBleProviderApi`+`useBleConnectionStatus`), sin provider propio (RMV3.1); status card con CTA (RMV3.4); `DemoControls` + sección "Dispositivos" (StickDeviceRow del binding del RS420) + `TransportInstructions` por adaptador (RMV3.2/3.7); lista de lecturas en vivo con badge DEMO (RMV4.6/4.8); InfoNote manual-first (RMV3.6); elegir device→`writeRememberedDevice` (RMV3.3).
- `components/StickDeviceRow.tsx` — fila de device (RMV3.7/3.8), tap NATIVO (onPress+a11y+pressStyle en la MISMA pieza Tamagui, sin `<Pressable>`).
- `components/StickStatusIndicator.tsx` — indicador global (RMV3.5), `useBleConnectionStatus()`, absoluto/`pointerEvents=box-none` (no bloqueante, RMV3.6), auto-oculto en 'off', suprimido en E2E-no-demo (protege la regresión).
- `components/DemoControls.tsx` — "Simular lectura" + auto-play, re-chequeo `isDemoMode() && transport instanceof SimulatorAdapter` (triple-guard 3, RMV4.5); dispara `SimulatorAdapter.emit()` (RMV4.6).

**Nuevo — route file (host):** `app/app/baston.tsx` — re-export delgado de `StickConnectionScreen` (RMV3.1, ADR-018 "Más"; deep-link `/baston`).

**Editados — 04-owned:**
- `app/src/services/ble/demo-gate.ts` — `isDemoBuildAllowed()` += `isE2eDemoAllowed()` (permite el gate bajo `__RAFAQ_BLE_E2E__` — E2E/captura es no-prod; override `__RAFAQ_BLE_DEMO_ALLOW_E2E__`). Prod sigue false (sin `__DEV__`/`extra.demoBuild`/`__RAFAQ_BLE_E2E__`). RMV4.4.
- `app/src/services/ble/demo-gate.test.ts` — `withEnv` extendido (limpia las marcas E2E) + 4 casos nuevos: E2E allow true; E2E sin marca demo → isDemoMode false (regresión); override false; prod sin ningún flag → false.

**Editados — host-level (mínimo autorizado, `_layout.tsx`):**
- Prop `mode`: precedencia demo `isDemoMode() ? 'demo' : isBleE2E() ? (isBleE2EManual() ? 'manual' : 'mock') : 'auto'` (import `isDemoMode`).
- `<Stack.Screen name="baston" />` (ruta) + `<StickStatusIndicator/>` en `BleHost` (chrome).

**Editados — infra/spec:**
- `scripts/run-tests.mjs` — registrado `app/src/features/ble-stick/connection-view.test.ts`.
- `specs/active/04-bluetooth-baston/tasks-multivendor.md` — MV.4 T-MV.4.1..4.6 marcadas `[x]` con nota as-built.
- `specs/active/04-bluetooth-baston/design-multivendor.md` — §7 reconciliación as-built (ver abajo).

## Trazabilidad RMV → archivo / test

| RMV | Archivo | Test |
|---|---|---|
| RMV3.1 (screen consume provider global, "Más") | `StickConnectionScreen.tsx` + `baston.tsx` + `_layout` Stack.Screen | typecheck; E2E → Gate 2.5 |
| RMV3.2 (flujo por adaptador) | `StickConnectionScreen.tsx` (`TransportInstructions`) | E2E → Gate 2.5 |
| RMV3.3 (elegir → writeRememberedDevice) | `StickConnectionScreen.tsx` (`onChooseDevice`) | E2E → Gate 2.5 |
| RMV3.4 (estados con CTA) | `connection-view.ts` (`connectionStatusView`) + status card | `connection-view.test.ts` (RMV3.4 ×3) |
| RMV3.5 (indicador global) | `StickStatusIndicator.tsx` + `_layout` `BleHost` | typecheck; E2E → Gate 2.5 |
| RMV3.6 (no bloqueante) | `connection-view` (filas ofrecen manual) + indicador `box-none` + InfoNote | `connection-view.test.ts` (subtítulos → "mano") |
| RMV3.7 (available:false, sin conectar) | `connection-view.deviceRowView` + `StickDeviceRow` + `TransportInstructions` | `connection-view.test.ts` (RMV3.7 ×2, RMV2.5) |
| RMV3.8 (no reconocido) | `connection-view.deviceRowView` + `StickDeviceRow` | `connection-view.test.ts` (RMV3.8 ×2) |
| RMV4.4 (gate demo + wiring) | `demo-gate.ts` (`isDemoBuildAllowed`) + `_layout` mode | `demo-gate.test.ts` (E2E allow / prod-safe) |
| RMV4.5 (triple-guard 3) | `DemoControls.tsx` (re-chequeo) + provider (Impl-1) | `demo-gate.test.ts` |
| RMV4.6 (marca DEMO) | `connection-view.readingBadge` + `StickConnectionScreen` (ReadRowView) + `DemoControls` badge | `connection-view.test.ts` (RMV4.6) |

## Reconciliación de specs (as-built)

`design-multivendor.md` §7 — nota de reconciliación agregada. Diferencias con la redacción original por
respetar la interfaz `StickAdapter` del core (CONGELADA):
1. **Web-serial "lista getPorts":** la interfaz no expone getPorts/requestPort a la pantalla → la
   lista/elección es el DIÁLOGO NATIVO de puertos del navegador (que abre el CTA→connect()→requestPort);
   la reconexión por getPorts sigue DENTRO del WebSerialAdapter. Un `listDevices()` en la interfaz
   tocaría el core congelado → fuera del delta.
2. **RMV3.3 `writeRememberedDevice(driver.vendorId)`** como marcador de reconexión (no una MAC, que no
   existe en web-serial); la MAC real la recordará el adapter SPP (Fase 4).
3. **`deviceRowView` estado `recognized-unreachable`** (RS420 en iOS, driver reconocido sin binding →
   manual, RMV2.5), además de RMV3.7/3.8.
4. **Indicador** montado en `_layout` `BleHost` (no toca spec 09), `box-none` + auto-oculto en 'off';
   posición/estética final = veto de Gate 2.5.
5. **Fila de "Más"** que navega a `/baston` PENDIENTE (mas.tsx es de otra terminal, colisión-safe).

`tasks-multivendor.md` MV.4 = `[x]` con notas as-built.

## Autorrevisión adversarial (paso 8)

- **¿La pantalla monta el provider global (no uno propio)?** Sí — `StickConnectionScreen` consume
  `useBleProviderApi()` + `useBleConnectionStatus()`; NO envuelve un `BleStickListenerProvider` (a
  diferencia del harness self-contained `baston-test.tsx`). ✓
- **¿`DemoControls` re-chequea `isDemoMode()`?** Sí — `isDemoMode() && api?.transport instanceof
  SimulatorAdapter ? … : null`. En prod (mode='auto', simulador nunca instanciado) → null. ✓
- **¿el refinamiento de `demo-gate` mantiene prod → false?** Sí — prod no tiene `__DEV__` ni
  `extra.demoBuild` ni `__RAFAQ_BLE_E2E__` → `isDemoBuildAllowed()` false → `isDemoMode()` false.
  Test `RMV4.7: producción sin ningún flag → false` lo cubre. ✓
- **¿la precedencia demo en `_layout` deja la regresión E2E intacta?** Sí — `isDemoMode()` exige
  `__RAFAQ_BLE_DEMO__`; la E2E normal setea solo `__RAFAQ_BLE_E2E__` → `isDemoMode()` false → cae a
  `mock`/`manual` como hoy. Test `E2E: __RAFAQ_BLE_E2E__ SIN la marca demo → isDemoMode false`. ✓
- **BUG ENCONTRADO Y CERRADO (regresión E2E):** `maniobra-identify.spec.ts:308/310` aserta
  `getByText('Bastón conectado'/'Bastón desconectado', { exact: true })`. El indicador GLOBAL, que
  usa las mismas etiquetas, habría duplicado ese texto en la corrida E2E (que llama `connectMock()` →
  status 'connected') → strict-mode violation → fallo. **Fix:** `StickStatusIndicator` se suprime en
  E2E-no-demo (`__RAFAQ_BLE_E2E__ === true && !isDemoMode()`) → NO se monta en la regresión existente
  ni en las capturas de otras features; SÍ se muestra en producción y en la captura demo de esta
  feature (isDemoMode true). Re-verificado typecheck + tests.
- **¿algún `<Pressable>` RN envolviendo Tamagui con pressStyle?** No — filas/CTAs/botón demo usan
  `onPress`+a11y en la pieza Tamagui (`XStack`/`View`/`Button`), sin `<Pressable>`. ✓
- **¿algún heading sin lineHeight matching?** No — todo heading ≥$5 y todo `Text` con `numberOfLines`
  lleva `lineHeight` matcheado (título $8, labels $5, filas, badges). ✓
- **¿tocaste algún archivo prohibido?** No (ver frontera). ✓
- **Offline-first / multi-tenant:** ningún archivo toca red/`supabase`/`fetch` ni `establishment_id`
  (registro/selección/UI son locales; `writeRememberedDevice` es storage local). ✓

## Verificación (network-free)

- `cd app && pnpm typecheck` → verde (sin salida).
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test app/src/services/ble/*.test.ts app/src/features/ble-stick/*.test.ts` → **132/132 pass, 0 fail** (incluye la suite ble de regresión + `connection-view.test.ts` (10) + `demo-gate.test.ts` (8, con los 4 casos nuevos)).
- NO se corrió `check.mjs` (DB compartida). NO E2E/capturas (van en el run de Gate 2.5).

## Frontera confirmada

Solo se tocaron: `app/src/features/ble-stick/*` (nuevo, territorio 04) + `app/app/baston.tsx` (route
file nuevo) + `app/src/services/ble/demo-gate.ts`(+test) (04-owned, refinamiento autorizado) + las
líneas host-level en `app/app/_layout.tsx` (mode + `<Stack.Screen name="baston" />` + `<StickStatusIndicator/>` + 2 imports) + `scripts/run-tests.mjs` (registro del test) + specs `tasks/design-multivendor.md`.

NO se tocó: `app/src/features/animals/*` (spec 09, no existe), ningún screen de find-or-create, el
contrato de ingesta ni tipos de spec 09; NI ninguno de los archivos de la otra terminal (feature 19/20:
`mas.tsx`, `phone.*`, `PhoneField.tsx`, `establishments.ts`, `crear-campo.tsx`, `telefono.*`,
`classify-error.*`, `validation.*`, `admin.ts`, `components/index.ts`, `hooks/index.ts`, migración 0126,
contexts, spec 20). Verificado con `git status`.

## Pendiente de coordinación para el leader

1. **Fila de "Más" → `/baston`** (mas.tsx es de la otra terminal; colisión-safe, no se tocó). La ruta ya
   es alcanzable por deep-link `/baston`. Snippet a agregar en `app/app/(tabs)/mas.tsx` (sección "Campo
   activo" o una nueva, todos los roles), reusando `ActionRow` + `StickIcon`:

   ```tsx
   import { StickIcon } from '@/theme/icons';
   // …dentro del Card de acciones:
   <ActionRow
     icon={<StickIcon size={20} color={primary} strokeWidth={2} />}
     label="Bastón"
     accessibilityLabel="Conectar y configurar el bastón lector de caravanas"
     trailing={<ChevronRight size={20} color={muted} strokeWidth={2} />}
     onPress={() => router.push('/baston')}
   />
   ```

2. **Captura de Gate 2.5:** para la captura de la `StickConnectionScreen` en modo demo, el leader puede
   necesitar (a) setear `__RAFAQ_BLE_DEMO__` + `__RAFAQ_BLE_E2E__` (addInitScript) para que
   `isDemoMode()` sea true y el provider monte el simulador + los DemoControls, y (b) agregar `'baston'`
   a `DEV_WEB_ROUTES` si quiere alcanzar `/baston` sin auth/rodeo en la captura. Fuera de este run.

3. **Veto de diseño (Gate 2.5):** posición/estética final del `StickStatusIndicator` global (hoy pill
   top-center, no bloqueante, auto-oculto en 'off').
