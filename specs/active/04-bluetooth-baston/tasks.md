# Spec 04 — Integración bastón lector RFID (EID) — Tasks

**Status**: `spec_ready` (status flip pendiente de coordinación).
**Fecha**: 2026-06-03 (sesión 22+).
**Fuente**: `requirements.md` (v2) + `design.md` (v2). Cada `R<n>` mapea a ≥1 task; cada task referencia ≥1 `R<n>`.

## Historial de refinamiento

- **2026-06-03 — Reescritura v2 (folding ADR-024).** La v1 (2026-05-30) ordenaba por "no-hardware vs día de campo (adaptador GATT)". ADR-024 refutó el transporte GATT; esta v2 reordena por **buildable-hoy → dev-build (Android) → GATED (HID)**. Reusa `parser-rs420.ts` (ya committeado `9126dba`); no lo reescribe.

> **Reglas** (`docs/specs.md`): pasos discretos en orden, cada uno con `[ ]` + los `R<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificación. Cada `R<n>` mapea a ≥1 test.

## Orden de build (informado por design §"Decisión de orden de build")

1. **Buildable HOY sin device** (Fases 0–3): contrato de ingesta + reuso parser + dedup + feedback + `adapter-manual` + `adapter-web-serial` + `adapter-mock` + provider/hooks + wiring a spec 09. De-riskea el pipeline entero contra el RS420 real en web.
2. **Dev build + Android** (Fase 4): `adapter-spp-android` (RS420 nativo, el beta). Requiere vetar `react-native-bluetooth-classic` + Android de pruebas.
3. **GATED por hardware de test** (Fase 5): `adapter-hid-wedge`. NO se implementa hasta pasar el gate físico en iPhone real (ADR-024 §4 / R8.7).
4. **UI de conexión** (Fase 6): pantalla en "Más" + indicador — **tentativa** hasta design system.

| Fase | Buildable hoy | Dev build / Android | GATED (HID) | Design system |
|---|---|---|---|---|
| 0 — Setup (carpetas + interfaz + tipos) | ✅ | — | — | No |
| 1 — Contrato de ingesta (R1,R2,R3) + feedback (R4) | ✅ | — | — | No (lógica) |
| 2 — adaptadores buildables (manual, web-serial, mock) | ✅ | — | — | No |
| 3 — provider + hooks + wiring spec 09/03 | ✅ | — | — | No (lógica) |
| 4 — adapter-spp-android (beta) | — | ✅ | — | No |
| 5 — adapter-hid-wedge | — | — | ⚠️ **GATED** | No |
| 6 — UI conexión + indicador + permisos | parcial | parcial | — | **Sí** (layout) |

---

## Fase 0 — Setup (buildable hoy)

- [ ] T0.1 — Confirmar que `app/src/services/ble/parser-rs420.ts` (+ test) está committeado (`9126dba`) e intacto; **NO reescribirlo**. Confirmar que el stub `useBleStickListener` de spec 09 (T1.5) existe y su firma. Si no, documentar el estado. Cubre: housekeeping (prerrequisito R1.2, R10.4).
- [ ] T0.2 — Scaffolding de `app/src/services/ble/`: archivos vacíos con export mínimo para `contract.ts`, `dedup.ts`, `feedback.ts`, `feedback-pref.ts`, `config.ts`, `stick-adapter.ts`, `adapter-manual.ts`, `adapter-mock.ts`, `adapter-web-serial.ts`, `adapter-spp-android.ts`, `adapter-hid-wedge.ts` (placeholder GATED), `remembered-device.ts`, `permissions.ts`, `connection-status.ts`, `stick.ts`. **Aceptación**: typecheck verde; `node scripts/check.mjs` verde. Cubre: housekeeping.
- [ ] T0.3 — Definir la interfaz `StickAdapter` en `stick-adapter.ts` (`connect/disconnect/onTagRead/onStatus/enable/disable`) + `ConnectionStatus` + tipos. NO redefinir `BleStickEvent` de spec 09 (reusar/reexportar). **Aceptación**: tipos compilan con `strict`; consumibles por los adaptadores. Cubre: R11.1.
- [ ] T0.4 — `config.ts`: constantes `DEDUP_WINDOW_MS = 3000` (ajustable), `SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB'`, `DEFAULT_BAUD = 9600`. **Aceptación**: importables. Cubre: R3.4, R6.1, R6.8.

## Fase 1 — Contrato de ingesta + feedback (buildable hoy, mayormente puro)

- [ ] T1.1 — `contract.ts` — `ingestRawLine(line)`: reusa `parseRs420Line` (R1.2) → `isValidTag` (R1.3); retorna `{ eid } | null`; malformado → `null` + log no bloqueante (R1.4). NO reimplementa el parseo. **Aceptación**: tests con muestras capturadas (`982000364696050`, `032010006382438`) + malformados (14/16 díg, no-numérico). Cubre: R1.1, R1.2, R1.3, R1.4.
- [ ] T1.2 — `contract.ts` — timestamp del teléfono en la ingesta (R1.5); emite `BleStickEvent{tag_read}` con la forma exacta de spec 09 (R1.6). **Aceptación**: el evento emitido tiene `{ kind:'tag_read', tag, timestamp }`; el timestamp es del teléfono, no del lector. Cubre: R1.5, R1.6.
- [ ] T1.3 — `dedup.ts` — `shouldEmit(eid, now)` con `Map<eid, lastEmittedAtMs>`, ventana `DEDUP_WINDOW_MS`, **keyed por EID** (no cooldown global). **Aceptación** (`dedup.test.ts`): mismo EID <3s → `false`; mismo EID >3s → `true`; **3 EIDs distintos seguidos → 3× `true` al instante** (spec 09 R8). Cubre: R3.1, R3.2, R3.3, R3.4, R3.5.
- [ ] T1.4 — `feedback-pref.ts` — persistencia local del toggle de beep (default ON), sobrevive sesiones. **Aceptación**: read/write del flag persiste. Cubre: R4.3, R4.4.
- [ ] T1.5 — `feedback.ts` — al confirmar EID válido: vibración **siempre** (R4.1) + beep si habilitado (R4.2) + señal visual (R4.4 <1s). En web: beep Web Audio + vibración degradada en silencio (R4.5). **Aceptación** (`feedback.test.ts`): vibración se dispara con beep ON y con beep OFF; beep solo con flag ON; selección de canal web vs native. Cubre: R4.1, R4.2, R4.5.
- [ ] T1.6 — Confirmación pre-commit (R2): el contrato expone el EID validado para que la UI lo muestre y confirme **antes** del commit (R2.1, R2.3); gate ligero/encadenable para asignación masiva (R2.5). **Nota frontera** (design §Confirmación / Preguntas abiertas #3): la confirmación se realiza dentro del overlay de spec 09. **Aceptación**: el contrato no commitea sin pasar por el punto de confirmación; un descarte no emite `tag_read`. Cubre: R2.1, R2.3, R2.4, R2.5.

## Fase 2 — Adaptadores buildables hoy (manual, web-serial, mock)

- [ ] T2.1 — `adapter-manual.ts` — el tipeo de spec 09 R1 (IDV/visual/EID) entra al contrato como identificador directo (sin `parseRs420Line`); `isValidTag` aplica si es EID. Siempre disponible, no bloquea (R7.4). **Aceptación**: un tipeo válido alimenta el mismo contrato que el bastón. Cubre: R7.1, R7.2, R7.4.
- [ ] T2.2 — `adapter-mock.ts` — `mockTagRead(tag)` inyecta EID limpio al contrato; `mockConnectionChange(connected)` ejercita el status; respeta dedup/feedback/validación/enable-disable (R10.8). **Aceptación** (`adapter-mock.test.ts`): inyección dispara el pipeline; `disable()` no emite. Cubre: R10.1, R10.8.
- [ ] T2.3 — `adapter-web-serial.ts` — `requestPort()` + `open({baudRate})` (R5.2) + `port.readable`/`TextDecoderStream` + framing por `\n`/`\r\n` → `ingestRawLine` (reusa parser, R5.3); `getPorts()` reconecta sin re-preguntar (R5.4); solo `Platform.OS==='web'` (R5.1). **Aceptación** (`adapter-web-serial.test.ts`): framing por línea correcto; cada línea cruda va al parser; mock de `navigator.serial`. Cubre: R5.1, R5.2, R5.3, R5.4.
- [ ] T2.4 — `adapter-web-serial.ts` — manejo de desconexión: evento `disconnect` / error del read loop → `onStatus('disconnected')` + reintento `open()` con backoff, sin bloquear manual (R5.5); restricción Chromium + contexto seguro + degradación clara en Safari/Firefox (R5.6). **Aceptación**: desconexión refleja estado + reintenta; navegador sin Web Serial degrada con mensaje. Cubre: R5.5, R5.6.
- [ ] T2.5 — **Prueba real con RS420 en web** (manual): RS420 pareado a Windows (PIN 1234) → `pnpm web` en Chrome → bastonear → confirmar dedup (mismo TAG <3s ignora), asignación masiva (3 TAGs distintos = 3 eventos), find-or-create de spec 09. **Aceptación**: documentado en `progress/impl_04-bluetooth-baston.md`. Cubre: R5 (validación end-to-end), R3 (real).

## Fase 3 — Provider + hooks + wiring a spec 09 / spec 03 (buildable hoy)

- [ ] T3.1 — `connection-status.ts` — modela `ConnectionStatus` + `useBleConnectionStatus()` (R9.3); cada cambio emite `BleStickEvent{connection_changed}` (R9.4). **Nota** (Preguntas abiertas #1): confirmar con spec 09 Fase 4 si `useBleConnectionStatus` es hook propio o selector. **Aceptación**: el hook retorna el estado actual; cambio emite el evento. Cubre: R9.3, R9.4.
- [ ] T3.2 — `stick.ts` — ensambla contrato + adaptador activo → implementa `useBleStickListener({ enabled, onTagRead })` con la firma exacta de spec 09, retorna `{ isConnected, isListening }` (R10.4). **Aceptación**: firma idéntica a la declarada por spec 09; reemplaza el stub. Cubre: R10.4.
- [ ] T3.3 — Reemplazar el stub `app/src/features/animals/hooks/useBleStickListener.ts` (spec 09 T1.5) por una **reexportación delgada** que delega en `services/ble/stick.ts`. NO cambiar la firma. **Coordinar con spec 09 Fase 4** (frontera, design §Regla de frontera). **Aceptación**: spec 09 consume el hook real sin cambios en sus screens. Cubre: R10.4 (wiring).
- [ ] T3.4 — Montar el adaptador real en `BleStickListenerProvider` (esqueleto de spec 09 T4.2) según `Platform`/entorno: `adapter-web-serial` (web), `adapter-mock` (CI/dev toggle), `adapter-manual` siempre como piso; `adapter-spp-android` (Fase 4), `adapter-hid-wedge` (Fase 5, GATED) se enchufan después sin tocar el contrato (R10.3, R11.2, R11.3). **Aceptación**: el provider monta el adaptador correcto por plataforma; mock por toggle en dev. Cubre: R10.2, R10.3, R11.2.
- [ ] T3.5 — `enable/disable` del listener (R10.5) + `{ enableListener, disableListener }` (R10.7): `enabled=false` desactiva la escucha sin desconectar físicamente; reactiva con `enabled=true`. Consumido por MODO MANIOBRAS (spec 03). **Aceptación**: con `enabled=false` no se invoca `onTagRead`; conexión física se mantiene. Cubre: R10.5, R10.7.
- [ ] T3.6 — `useBusyMode()` (R10.6): mientras un form CREATE/EDIT de spec 09 esté activo, el provider no dispara nuevo flujo encima; reactiva al salir. **Coordinar con spec 09 T4.5**. **Aceptación**: en CREATE/EDIT un bastoneo no abre overlay encima del form. Cubre: R10.6.
- [ ] T3.7 — `permissions.ts` — permisos por transporte (esqueleto): web-serial = browser (R12.4); manual/mock = ninguno; SPP/HID se completan en sus fases. Permiso denegado → `permission_denied` + CTA + manual operativa (R12.5). **Aceptación**: permiso denegado no bloquea la app. Cubre: R12.4, R12.5.
- [ ] T3.8 — Offline-first del contrato: confirmar que normalizar/validar/dedup/confirmar/emitir no tocan red (R14.2); la conexión bastón↔teléfono es local (R14.1). **Aceptación**: test del contrato corre sin red; el find-or-create disparado va a PowerSync local (spec 09 R11.3). Cubre: R14.1, R14.2.
- [ ] T3.9 — `logging` no bloqueante de eventos de transporte + EIDs descartados (R15); errores de transporte → capturados, reflejados en status, sin romper UI (R15.2). **Aceptación**: un error de read loop se loguea + refleja estado, no propaga excepción. Cubre: R15.1, R15.2.
- [ ] T3.10 — No-read silencioso (R13): un accionamiento sin tag no emite evento; no se asume señal de "lectura fallida" (R13.2). **Aceptación**: no-read no produce `tag_read` ni error visible. Cubre: R13.1, R13.2.

## Fase 4 — `adapter-spp-android` — RS420 nativo (el beta) — requiere dev build + Android

> **Requiere el Android de pruebas (Raf lo compra) + dev build.** No bloquea las Fases 0–3 ni el harness web.

- [ ] T4.0 — **Vetar** la compatibilidad del config plugin de `react-native-bluetooth-classic` con Expo SDK 56 (o prebuild manual) + estado de mantenimiento de la lib (Pendientes del context). Si incompatible, **PARAR y reportar al leader**. **Aceptación**: dev build documentado como viable o bloqueante. Cubre: R12.2 (prerrequisito).
- [ ] T4.1 — `adapter-spp-android.ts` — abre RFCOMM SPP (UUID `SPP_UUID`) con `react-native-bluetooth-classic`, lee líneas ASCII → `ingestRawLine` (reusa parser, R6.5); baud-independiente (R6.8). **Aceptación**: stream del RS420 real parsea EIDs en el Android de pruebas. Cubre: R6.1, R6.5, R6.8.
- [ ] T4.2 — Pairing SPP (slave, PIN 1234) desde la pantalla de conexión: listar dispositivos, elegir uno (R6.2). **Aceptación**: pairing exitoso con el RS420 real. Cubre: R6.2.
- [ ] T4.3 — `remembered-device.ts` — persistir el bastón elegido (R6.3, sobrevive reinicios); reconexión automática con backoff al abrir/volver a rango (R6.4); foreground-only (R6.9). **Aceptación**: tras elegir, reconecta solo sin volver a la pantalla. Cubre: R6.3, R6.4, R6.9.
- [ ] T4.4 — Un bastón por dispositivo; múltiples cerca → lista + recordar último (R6.7); acción cambiar/olvidar (R6.6). **Aceptación**: con 2 RS420 cerca, lista ambos; recuerda el último; olvidar limpia el persistido. Cubre: R6.6, R6.7.
- [ ] T4.5 — Permisos Android (R12.1): 12+ `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` (`neverForLocation`); <12 `BLUETOOTH`/`BLUETOOTH_ADMIN` + location; config en `app.json`/plugin (R12.2). **Aceptación**: permisos solicitados por versión; denegado → CTA + manual operativa. Cubre: R12.1, R12.2.
- [ ] T4.6 — Montar `adapter-spp-android` en el provider para Android device (R10.3). **Aceptación**: en Android device, el provider usa SPP; en web sigue usando web-serial. Cubre: R10.3 (Android).
- [ ] T4.7 — **Prueba real en device con RS420** (manual): pairing, stream, reconexión, dedup, asignación masiva, fallback manual al desconectar (R7.3). **Aceptación**: documentado en `progress/impl_04-bluetooth-baston.md`. Cubre: R6 (end-to-end), R7.3.

## Fase 5 — `adapter-hid-wedge` — ⚠️ GATED por validación física (NO implementar hasta R8.7)

> **BLOQUE GATED (ADR-024 §4 / R8.7).** Dirección elegida para iOS-sin-MFi, pero el Council fue enfático: no fijar arquitectura sobre un mecanismo no ejecutado. **Ninguna task de esta fase se implementa hasta pasar el gate físico.** El archivo `adapter-hid-wedge.ts` queda como placeholder documentado (T0.2). El contrato y los otros 4 adaptadores funcionan sin esta fase.

- [ ] T5.0 — **GATE FÍSICO (BLOQUEANTE de esta fase)** — conseguir un lector HID-capable (test rig: AgriEID BT Ultra importado, o un genérico AR —Montetech ME-BL01 / Smart LFID— **si se verifica que hace HID**) y validar en **iPhone real**: (a) tipea los 15 dígitos completos, (b) emite terminador Enter, (c) la supresión del teclado en pantalla de iOS no rompe la UX de manga, (d) el `TextInput` de RN con foco programático captura confiable entre versiones. Repetir en Android. Si falla, **NO implementar el adaptador**; reevaluar el camino iOS-abierto (el contrato sobrevive). **Aceptación**: resultado del gate documentado en `field-findings.md` + `progress/impl_04-bluetooth-baston.md`. Cubre: R8.7 (gate).
- [ ] T5.1 — *(GATED, solo tras T5.0 PASS)* `adapter-hid-wedge.ts` — captura keystrokes + Enter en `ScanInput.tsx`; ensambla la línea tipeada → `isValidTag` (R8.2); NO usa `react-native-ble-plx`, NO es GATT; parser de stream no aplica (R11.4). Cubre: R8.1, R8.2, R11.4.
- [ ] T5.2 — *(GATED)* Pairing del SO (teclado Bluetooth), sin escaneo BLE de la app, "recordar" = el SO recuerda el teclado (R8.3); sin permisos BLE de app (R8.5, R12.3); campo de scan enfocado confiable (R8.4); manejar supresión del teclado en pantalla iOS (R8.6). Cubre: R8.3, R8.4, R8.5, R8.6, R12.3.
- [ ] T5.3 — *(GATED)* Montar `adapter-hid-wedge` en el provider (iOS/Android, tras gate) sin tocar el contrato (R10.3, R11.3). Cubre: R10.3 (HID), R11.3.

## Fase 6 — UI de conexión + indicador (TENTATIVA — tras design system)

> Fase pausada hasta cerrar el design system canónico (item A.1 del plan). Describe el comportamiento; el layout se refina después.

- [ ] T6.1 — `StickConnectionScreen.tsx` en la sección "Más" (ADR-018), **específica por adaptador**: SPP (listar/elegir/olvidar — R6.2/R6.6), web-serial (`requestPort` + lista `getPorts` — R5.2/R5.4), HID (instrucción de parear en el SO + campo de scan — GATED). Cubre: R9.1.
- [ ] T6.2 — Estados de conexión con CTA (R9.2): apagado / permiso denegado / buscando / conectado / desconectado; reconexión automática con backoff donde aplique (R9.5); todos no bloqueantes (R9.6). Cubre: R9.2, R9.5, R9.6.
- [ ] T6.3 — `StickStatusIndicator.tsx` — indicador global en el chrome, alimentado por `useBleConnectionStatus()` (R9.3). Cubre: R9.3.
- [ ] T6.4 — Toggle de beep en ajustes (lee/escribe `feedback-pref.ts`, R4.3). Cubre: R4.3 (UI).
- [ ] T6.5 — Fallback manual en 1 tap visible ante desconexión (R7.3) — UI. Cubre: R7.3 (UI).

## Fase 7 — Tests, QA e integración con MODO MANIOBRAS

- [ ] T7.1 — Suite de tests del contrato (`node:test`, módulos puros): `contract.test.ts`, `dedup.test.ts`, `feedback.test.ts`, `adapter-mock.test.ts`, `adapter-web-serial.test.ts`. **Aceptación**: todos verdes; `node scripts/check.mjs` verde. Cubre: R1, R2, R3, R4, R5, R10.
- [ ] T7.2 — E2E con `adapter-mock` (CI, sin device): un `mockTagRead` dispara el flujo find-or-create de spec 09; 3 EIDs distintos → asignación masiva (spec 09 R8); `disable` no dispara. **Aceptación**: pasa en CI. Cubre: R10.1, R10.8, R3.2.
- [ ] T7.3 — Contrato con MODO MANIOBRAS (spec 03 — coordinar): documentar que la stack de manga llama `disableListener()` en `useEffect` con cleanup `enableListener()`. **Aceptación**: con la stack de manga montada (mock), el listener no dispara. Cubre: R10.5, R10.7.
- [ ] T7.4 — QA de campo (con el RS420 real, beta Chascomús o simulado por Raf): jornada mixta bastón + manual; verificar dedup, confirmación visual, feedback, reconexión, manual al desconectar. **Aceptación**: feedback documentado en `progress/impl_04-bluetooth-baston.md`. Cubre: R2, R4, R6, R7.
- [ ] T7.5 — Documentación de cierre: actualizar `field-findings.md` (resultado del gate HID si se corrió, versión de firmware si Raf actualizó), `CONTEXT/07-pendientes.md`, y `feature_list.json` (status final lo hace coordinación). **Aceptación**: docs reflejan el estado real. Cubre: housekeeping.

---

## Resumen de dependencias críticas

```
Fase 0 (setup) → Fase 1 (contrato + feedback) → Fase 2 (manual/web-serial/mock)
   → Fase 3 (provider + hooks + wiring spec 09/03)        ← TODO buildable HOY, sin device
        ↓
⏸ PUERTA: Android de pruebas + dev build (react-native-bluetooth-classic)
   → Fase 4 (adapter-spp-android, el beta)
        ↓
⏸ GATE FÍSICO: iPhone real + lector HID-capable (ADR-024 §4 / R8.7)
   → Fase 5 (adapter-hid-wedge)                            ← GATED, no antes del gate
        ↓
⏸ PUERTA: design system canónico
   → Fase 6 (UI conexión + indicador)
        ↓
   Fase 7 (tests + QA + MODO MANIOBRAS)                    ← parcial desde Fase 1 (contra mock)
```

## Trazabilidad R<n> → tasks

| Requirement | Tasks | Bloqueo |
|---|---|---|
| R1.1, R1.2, R1.3, R1.4 | T1.1 | OK (buildable hoy) |
| R1.5, R1.6 | T1.2 | OK |
| R2.1, R2.3, R2.4, R2.5 | T1.6 | OK (frontera spec 09 — Preguntas abiertas #3) |
| R2.2 | T1.5, T6.* (UI <1s) | OK lógica / UI tentativa |
| R3.1..R3.5 | T1.3, T2.5 | OK |
| R4.1, R4.2, R4.5 | T1.5 | OK |
| R4.3, R4.4 | T1.4, T6.4 | OK lógica / UI tentativa |
| R5.1..R5.4 | T2.3 | OK (buildable hoy) |
| R5.5, R5.6 | T2.4 | OK |
| R6.1, R6.5, R6.8 | T4.1 | Dev build + Android |
| R6.2 | T4.2 | Dev build + Android |
| R6.3, R6.4, R6.9 | T4.3 | Dev build + Android |
| R6.6, R6.7 | T4.4 | Dev build + Android |
| R7.1, R7.2, R7.4 | T2.1 | OK |
| R7.3 | T4.7, T6.5 | parcial |
| R8.1, R8.2, R11.4 | T5.1 | ⚠️ GATED (R8.7) |
| R8.3, R8.4, R8.5, R8.6 | T5.2 | ⚠️ GATED |
| R8.7 | T5.0 | gate físico |
| R9.1 | T6.1 | UI tentativa |
| R9.2, R9.5, R9.6 | T6.2 | UI tentativa / lógica OK |
| R9.3, R9.4 | T3.1, T6.3 | OK lógica / UI tentativa |
| R10.1, R10.8 | T2.2, T7.2 | OK |
| R10.2, R10.3 | T3.4, T4.6, T5.3 | OK (mock/web) / Android / GATED |
| R10.4 | T3.2, T3.3 | OK |
| R10.5, R10.7 | T3.5, T7.3 | OK |
| R10.6 | T3.6 | OK |
| R11.1 | T0.3 | OK |
| R11.2 | T3.4 | OK |
| R11.3 | T3.4, T5.3 | OK |
| R12.1, R12.2 | T4.0, T4.5 | Dev build + Android |
| R12.3 | T5.2 | ⚠️ GATED |
| R12.4, R12.5 | T3.7 | OK |
| R13.1, R13.2 | T3.10 | OK |
| R14.1, R14.2 | T3.8 | OK |
| R15.1, R15.2 | T3.9 | OK |

## Notas de ejecución

- **Reuso obligatorio de `parser-rs420.ts`** (commit `9126dba`) — no reescribirlo. Los streams SPP/serial van al mismo parser.
- **No redefinir los tipos de spec 09** — implementarlos. **No tocar los screens de find-or-create de spec 09** — solo reexportar el stub y montar el adaptador en el provider (coordinar Fase 4 de spec 09).
- El `adapter-hid-wedge` **NO se implementa** hasta T5.0 PASS (gate físico ADR-024 §4). El archivo queda como placeholder documentado.
- Tests del contrato/dedup/feedback con `node:test` (módulos puros, patrón del parser). Adaptadores con device → test manual + mock en CI.
- Si aparece la necesidad de cambiar un contrato de spec 09 (ej. confirmación pre-commit R2) o de spec 02/03, **PARAR y reportar al leader** — no parchear desde 04.
- Commits en español, presente, descriptivo (`agrega contrato de ingesta de EID`, `crea adapter-web-serial`, etc.).
</content>
