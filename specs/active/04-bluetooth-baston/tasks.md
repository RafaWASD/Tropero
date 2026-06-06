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

- [x] T0.1 — Confirmar que `app/src/services/ble/parser-rs420.ts` (+ test) está committeado (`9126dba`) e intacto; **NO reescribirlo**. Confirmar que el stub `useBleStickListener` de spec 09 (T1.5) existe y su firma. Si no, documentar el estado. Cubre: housekeeping (prerrequisito R1.2, R10.4). **AS-BUILT**: parser intacto (reuso directo). El stub de spec 09 **NO existe** — `app/src/features/animals/` no existe (frontend de spec 09 deferred). Firma de spec 09 tomada de su `design.md` (líneas 168-175). Decisión: todo el contrato vive en `services/ble/`; spec 09 Fase 4 delegará ahí (ver `progress/impl_04-bluetooth-baston.md`).
- [x] T0.2 — Scaffolding de `app/src/services/ble/`. **AS-BUILT**: archivos creados con implementación real (no vacíos), en orden de dependencia. `adapter-hid-wedge.ts` = placeholder GATED documentado. typecheck/check verdes.
- [x] T0.3 — Interfaz `StickAdapter` en `stick-adapter.ts` (`connect/disconnect/onTagRead/onStatus/enable/disable`) + `ConnectionStatus` + `BleStickEvent` (forma exacta de spec 09, no redefinida). Cubre: R11.1.
- [x] T0.4 — `config.ts`: `SPP_UUID`, `DEFAULT_BAUD = 9600`; `DEDUP_WINDOW_MS = 3000` definido en `dedup.ts` (módulo puro testeable) y reexportado por `config.ts` (single source, ajustable R3.4). Cubre: R3.4, R6.1, R6.8.

## Fase 1 — Contrato de ingesta + feedback (buildable hoy, mayormente puro)

- [x] T1.1 — `contract.ts` — `ingestRawLine(line)` reusa `parseRs420Line` (R1.2) → `isValidTag` (R1.3); retorna `{ ok, eid } | { ok:false, reason }`; malformado → reason para log no bloqueante (R1.4). NO reimplementa el parseo. Tests con capturas reales + malformados (14/16 díg, no-numérico, cabecera mala). Cubre: R1.1, R1.2, R1.3, R1.4.
- [x] T1.2 — `contract.ts` — `buildTagReadEvent(eid, now)` usa timestamp del teléfono (R1.5); emite `BleStickEvent{tag_read}` forma exacta de spec 09 (R1.6). Test verifica `{ kind:'tag_read', tag, timestamp }` con ts del teléfono, no del lector. Cubre: R1.5, R1.6.
- [x] T1.3 — `dedup.ts` — `TagDedup.shouldEmit(eid, now)` con `Map<eid, lastEmittedAtMs>`, ventana `DEDUP_WINDOW_MS`, keyed por EID (no cooldown global). `dedup.test.ts`: mismo EID <3s → false; >3s → true; 3 EIDs distintos seguidos → 3× true al instante (spec 09 R8); ventana medida desde última emisión confirmada (no extiende). Cubre: R3.1, R3.2, R3.3, R3.4, R3.5.
- [x] T1.4 — `feedback-pref.ts` — persistencia del toggle de beep (default ON, patrón canónico web→localStorage/native→SecureStore); lógica pura (`parseBeepPref`) en `feedback-logic.ts`. Test del parseo + default. Cubre: R4.3, R4.4.
- [x] T1.5 — `feedback.ts`/`feedback-logic.ts` — `decideFeedback(platform, beepEnabled)` (puro): vibración siempre en native (R4.1) + beep si habilitado (R4.2) + canal web-audio en web / native en device, vibración degradada en web (R4.5). `playFeedback` = efecto guardado (Vibration RN / Web Audio), no testeado en CI. Test de la decisión con beep ON/OFF y por plataforma. Cubre: R4.1, R4.2, R4.5.
- [x] T1.6 — Confirmación pre-commit (R2): `EidIngestEngine.processRawLine/processEid` devuelve el EID CANDIDATO (validado + des-duplicado) SIN emitir; `commit(eid, now)` produce el `tag_read` SOLO tras la confirmación de la UI (R2.1, R2.3); un descarte no llama `commit` → no emite. Gate ligero/encadenable: cada EID distinto es candidato independiente al instante (R2.5). **Frontera** (design §Confirmación / Preguntas abiertas #3): la confirmación visual se hace en el overlay de spec 09; NO requirió cambiar contrato de spec 09 → no se paró. Tests del gate + encadenable. Cubre: R2.1, R2.3, R2.4, R2.5.

## Fase 2 — Adaptadores buildables hoy (manual, web-serial, mock)

- [x] T2.1 — `adapter-manual.ts` — `ManualAdapter` (StickAdapter): la UI de spec 09 llama `submit(value)` con el identificador tipeado → se propaga al MISMO contrato (R7.1). Estado siempre 'connected' (carga manual siempre lista, R7.2); connect/disconnect no-ops; nunca bloquea (R7.4). El `isValidTag` lo aplica el contrato (ingestEid) si el valor es EID. Cubre: R7.1, R7.2, R7.4.
- [x] T2.2 — `adapter-mock.ts` — `MockAdapter`: `mockTagRead(tag)` inyecta EID limpio; `mockConnectionChange(connected)` ejercita el status; respeta enable/disable (R10.8 — con disable no emite). `adapter-mock.test.ts`: inyección dispara el pipeline (validate+dedup+candidato), 3 EIDs distintos = asignación masiva, EID inválido no emite, disable no emite. Cubre: R10.1, R10.8.
- [x] T2.3 — `adapter-web-serial.ts` — `WebSerialAdapter` (StickAdapter): `requestPort()` + `open({baudRate})` (R5.2); read loop `port.readable` + `TextDecoder` + framing por `\n`/`\r\n` (LineFramer puro) → línea cruda al contrato vía `ingestRawLine` (reusa parser, R5.3); `getPorts()` reconecta sin re-preguntar (deviceId='remembered', R5.4); `isSupported()` gate (R5.6). `adapter-web-serial.test.ts`: framing por chunks/múltiples líneas/`\r\n`, cada línea framed → EID correcto por el parser, soporte y backoff. Cubre: R5.1, R5.2, R5.3, R5.4.
- [x] T2.4 — `adapter-web-serial.ts` — desconexión: evento `disconnect` del navegador / error del read loop → `onStatus('disconnected')` + reintento `connect('remembered')` con backoff incremental (`backoffDelayMs`), sin bloquear manual (R5.5); `isWebSerialSupported()` degrada claro (R5.6). Test del backoff + soporte. **Nota**: el read loop / setTimeout reales se prueban en device/web (T2.5); la lógica pura (framing, backoff, soporte) está testeada en CI. Cubre: R5.5, R5.6.
- [~] T2.5 — **Prueba real con RS420 en web** (manual): RS420 pareado a Windows → `pnpm web` Chrome → bastonear. **DIFERIDA de este run** (no hay RS420 físico disponible en esta sesión). La lógica está de-riskeada por los tests puros del framing+parser+dedup; la validación end-to-end con hardware queda pendiente para Raf. Cubre: R5 (validación end-to-end), R3 (real) — PENDIENTE device.

## Fase 3 — Provider + hooks + wiring a spec 09 / spec 03 (buildable hoy)

- [x] T3.1 — `connection-status.ts` — `ConnectionStatusContext` + `useBleConnectionStatus()` (R9.3, hook propio que lee el estado del provider); el provider emite el cambio + `buildConnectionEvent` (R9.4) y loguea. `isConnectedStatus`/`blocksManualEntry` (puros, testeados). **Preguntas abiertas #1**: implementado como hook propio (ambos —hook propio e isConnected del listener— leen el mismo estado del provider; a confirmar con spec 09 Fase 4, no bloquea). Cubre: R9.3, R9.4.
- [x] T3.2 — `stick.ts` — `useBleStickListener({ enabled, onTagRead })` con la firma EXACTA de spec 09, retorna `{ isConnected, isListening }` (R10.4). Delega en `BleStickListenerProvider` (motor de ingesta + adaptador activo). Cubre: R10.4.
- [~] T3.3 — Reemplazar el stub de spec 09. **N/A en este run**: `app/src/features/animals/` NO existe (frontend de spec 09 deferred) → no hay stub que reexportar. Implementado todo en `services/ble/` con la firma exacta; cuando spec 09 Fase 4 monte su provider/hook, REEXPORTA/DELEGA en `services/ble/stick.ts` + `BleStickListenerProvider` (frontera documentada en impl_04). NO se tocó `features/animals/`. Cubre: R10.4 (wiring) — pendiente del lado de spec 09.
- [x] T3.4 — `BleStickListenerProvider.tsx` monta el adaptador según `Platform`/entorno (`selectTransportAdapter`, puro+testeado): web→web-serial, mock por toggle (`mode='mock'`), manual siempre como piso; spp-android (Fase 4) e hid-wedge (GATED) NO se montan en este run (no tocan el contrato — R11.3). Cubre: R10.2, R10.3, R11.2.
- [x] T3.5 — `enable/disable` del listener (R10.5) + `{ enableListener, disableListener }` vía `useStickListenerControls()` (R10.7): `enabled=false` (de `useBleStickListener` o MODO MANIOBRAS) suspende la escucha (`listening = enabled && !busy`) sin desconectar el transporte físico; reactiva con `enabled=true`. Test (mock): con disable, `mockTagRead` no propaga; re-enable reanuda. Cubre: R10.5, R10.7.
- [x] T3.6 — `useBusyMode()` + `useBusyWhileMounted()` (R10.6): mientras un form CREATE/EDIT está activo (`busy=true`), el listener no dispara (`listening=false`). **Coordinar con spec 09 T4.5** (el form de spec 09 llama `useBusyWhileMounted`). Cubre: R10.6.
- [x] T3.7 — `permissions.ts` — `permissionModelFor(kind)`: web-serial=browser (R12.4); manual/mock=none; spp-android=android-bluetooth; hid-wedge=os-keyboard. `permissionDenialBlocksApp()=false` (R12.5/R7.2: nunca bloquea). El web-serial refleja `permission_denied` si no hay soporte. Test puro. Cubre: R12.4, R12.5.
- [x] T3.8 — Offline-first: el grafo del contrato NO importa supabase/fetch; `offline-noread.test.ts` corre el pipeline completo SIN red (si tocara internet, fallaría offline) (R14.2). El find-or-create disparado va a PowerSync local de spec 09 (R14.1, fuera de 04). Cubre: R14.1, R14.2.
- [x] T3.9 — `logging.ts` — `logTransportEvent` no bloqueante (R15.1): console.info best-effort envuelto; el provider loguea connection_changed + eid_rejected; los errores del read loop del web-serial se capturan y reflejan en status sin propagar (R15.2). Test: nunca tira, aun con console roto. Cubre: R15.1, R15.2.
- [x] T3.10 — No-read silencioso (R13): un accionamiento sin tag = el adapter no llama onTagRead → cero eventos; el motor no inventa rechazos sin entrada (R13.2). Test en `offline-noread.test.ts`. Cubre: R13.1, R13.2.

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

- [x] T7.1 — Suite de tests del contrato (`node:test`, módulos puros): `contract.test.ts`, `dedup.test.ts`, `feedback.test.ts`, `adapter-mock.test.ts`, `adapter-web-serial.test.ts` (+ `wiring.test.ts`, `offline-noread.test.ts`, parser ya existente). Enganchadas en `scripts/run-tests.mjs`. **Hook nuevo** `scripts/ts-ext-resolver.mjs` (`--import`): resuelve imports extensionless entre módulos fuente bajo node:test (no toca Metro/typecheck/bundle). `node scripts/check.mjs` verde end-to-end. Cubre: R1, R2, R3, R4, R5, R10.
- [x] T7.2 — E2E con `adapter-mock` (CI, sin device): en `adapter-mock.test.ts` un `mockTagRead` dispara el pipeline del contrato (candidato → commit → tag_read); 3 EIDs distintos → asignación masiva (spec 09 R8); `disable` no dispara; EID inválido no emite. El find-or-create real de spec 09 (overlay) se ejercita cuando spec 09 Fase 4 exista. Cubre: R10.1, R10.8, R3.2.
- [x] T7.3 — Contrato con MODO MANIOBRAS (spec 03 — coordinar): documentado. La stack de manga llama `useStickListenerControls().disableListener()` en `useEffect` con cleanup `enableListener()` (R10.7); con `disable`, el provider no propaga lecturas (verificado vía mock: `disable()` → `mockTagRead` no emite). Cubre: R10.5, R10.7.
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
