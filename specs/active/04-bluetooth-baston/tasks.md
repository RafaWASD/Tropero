# Spec 04 — Integración bastón Bluetooth (Allflex RS420) — Tasks

**Status**: `spec_ready` (pendiente de aprobación humana — Puerta 1).
**Fecha**: 2026-05-30.
**Cobertura**: parte **NO-hardware**. El adaptador GATT real del RS420 queda detrás de la **PUERTA DÍA DE CAMPO** (Fase 4). Todo lo demás (Fases 0–3, 5, 6) se construye y testea **ahora** contra el mock provider.

## Historial de refinamiento

- **2026-05-30 — Creación inicial.** Tasks redactadas a partir de `requirements.md` y `design.md`. Cada R<n> cubierta por ≥1 task; cada task referencia ≥1 R<n>. Estructura de fases que separa lo construible-ahora (servicio + provider + mock + reconexión + dedup + feedback + permisos) de lo bloqueado por el día de campo (adaptador GATT real + parsing del TAG).

## Cabecera de fases — qué se puede correr ya

| Fase | Depende de design system | Depende del día de campo | Comentario |
|---|---|---|---|
| Fase 0 — Setup | No | No | Scaffolding `services/ble/` + tipos + interface adapter |
| Fase 1 — Lógica core sin UI | No | No | dedup, normalize, dedup, connection FSM, remembered-device, feedback, permissions |
| Fase 2 — Servicio + mock + provider | No (lógica) / parcial (UI indicador) | No | `stick.ts` + `adapter-mock.ts` + reemplazo del stub + provider real |
| Fase 3 — Pantallas BLE (conexión, indicador, toggle) | **Sí** | No | `BleStickConnectionScreen`, `BleConnectionIndicator`, toggle de sonido |
| Fase 4 — Adaptador GATT real | No (design system) | **Sí (BLOQUEANTE)** | `adapter-ble-plx.ts` real + UUIDs + parsing del TAG |
| Fase 5 — Integración con MODO MANIOBRAS / busy mode | Parcial | No | suspensión por contexto, contrato con spec 03 |
| Fase 6 — Tests + QA | Parcial | Parcial | cubre lo implementado; QA real en el día de campo |

**Fases ejecutables ahora (sin día de campo, sin design system)**: 0, 1, 2 (lógica), 5, 6 (contra mock).
**Fase que requiere design system cerrado**: 3 (UI components/screens).
**Fase que requiere el día de campo**: 4 (adaptador GATT real).

---

## Fase 0 — Setup

- [ ] **T0.1** Crear estructura `app/src/services/ble/{stick,adapter,adapter-ble-plx,adapter-mock,connection,remembered-device,dedup,normalize,feedback,permissions,config,types}.ts` + `__tests__/` con scaffolding mínimo. Cubre: housekeeping.
- [ ] **T0.2** Definir `services/ble/types.ts` que **reexporta** `BleStickEvent` desde `@/features/animals/types` (NO redefinir) + tipos internos de 04 (`BleConnectionStatus`, `RememberedStick`, `BleStickAdapter`). Cubre: R1.2, soporte de R1.
- [ ] **T0.3** Definir la interface `BleStickAdapter` en `adapter.ts` (R1.5) con los métodos `requestPermissions / scan / connect / disconnect / subscribeToTags / onConnectionChange / getConnectionState`. Cubre: R1.5.
- [ ] **T0.4** Crear `config.ts` con constantes: `DEDUP_WINDOW_MS = 3000`, backoff params, `USE_MOCK_BLE`, placeholders 🔧 `RS420_SERVICE_UUID` / `RS420_TAG_CHAR_UUID` (marcados `// TODO(día de campo)`). Cubre: R4.4, soporte de R1.6.

---

## Fase 1 — Lógica core sin UI (construible ahora)

- [ ] **T1.1** Implementar `dedup.ts`: `Map<tag, lastTs>`, ventana por-TAG, GC de entradas viejas. Cubre: R4.1, R4.2, R4.3, R4.4.
- [ ] **T1.2** Tests `dedup.test.ts`: mismo TAG dentro de la ventana se descarta; mismo TAG fuera de la ventana se emite; **tres TAGs distintos seguidos → tres emisiones** (protege spec 09 R8). Cubre: R4.1, R4.2, R4.3.
- [ ] **T1.3** Implementar `normalize.ts`: `normalizeTag` (trim/strip/uppercase) + `isValidTag` (formato provisional). Marcar `// TODO(día de campo)` donde el formato canónico real se foldará (R8.3). Cubre: R8.1, R8.2.
- [ ] **T1.4** Tests `normalize.test.ts`: trim de whitespace/CR/LF; rechazo de malformado (no emite); log de malformado no rompe. Cubre: R8.1, R8.2.
- [ ] **T1.5** Implementar `remembered-device.ts`: `readRemembered / writeRemembered / forgetRemembered` sobre AsyncStorage (`rafaq:ble:remembered_stick`), un único deviceId (R3.7). Cubre: R3.2, R3.5, R3.7.
- [ ] **T1.6** Tests `remembered-device.test.ts`: persistir/leer/olvidar; sobrevive "reinicio" (mock de AsyncStorage). Cubre: R3.2, R3.5.
- [ ] **T1.7** Implementar `connection.ts`: máquina de estados (`bluetooth_off | permission_denied | scanning | connecting | connected | disconnected`) + reconexión backoff incremental con cap + foreground-only (listener `AppState`). Cubre: R2.4, R3.3, R3.4, R3.8.
- [ ] **T1.8** Tests `connection.test.ts`: transiciones de estado; auto-reconnect con bastón recordado; backoff incrementa y cappea; pausa en background / reanuda en foreground. Cubre: R2.4, R3.3, R3.4, R3.8.
- [ ] **T1.9** Implementar `feedback.ts`: `fireReadFeedback()` → vibración (expo-haptics, siempre) + beep condicional a preferencia (expo-av) + señal visual (evento). Preferencia `bleSoundEnabled` en AsyncStorage (default true). Cubre: R5.1, R5.2, R5.3, R5.4, R5.5.
- [ ] **T1.10** Tests `feedback.test.ts`: vibración siempre; beep solo con sonido on; beep off no apaga vibración; señal visual emitida; disparo sincrónico (objetivo < 1 s). Cubre: R5.1, R5.2, R5.3, R5.4, R5.5.
- [ ] **T1.11** Implementar `permissions.ts`: `requestPermissions()` por plataforma (Android 12+ scan/connect; Android <12 location; iOS bluetooth) → `granted | denied | bluetooth_off`; CTA a settings en denied; CTA enable en bluetooth_off. Cubre: R2.1, R2.2, R2.3.
- [ ] **T1.12** Tests `permissions.test.ts` (con mocks de plataforma): granted/denied/bluetooth_off mapean a los estados correctos; denied no bloquea la app. Cubre: R2.1, R2.2, R2.3, R6.1.
- [ ] **T1.13** Implementar logging diagnóstico no bloqueante de eventos BLE (connect/disconnect/retry/malformed/error GATT) y captura de errores que refleja estado sin propagar excepción. Cubre: R13.1, R13.2.

---

## Fase 2 — Servicio + mock provider + integración con spec 09 (construible ahora)

- [ ] **T2.1** Implementar `adapter-mock.ts`: `BleStickAdapter` en memoria + API de test `mockTagRead / mockConnectionChange / mockScanResult`; pasa por dedup→normalize→feedback→onTagRead; honra enable/disable. Cubre: R10.1, R10.2, R10.4.
- [ ] **T2.2** Implementar `stick.ts`: `useBleStickListener(opts)` real (selecciona adapter vía config), `enableListener/disableListener`, `useBleConnectionStatus`, `useBusyMode`. Honra `enabled=false` sin desconectar físicamente. Cubre: R1.1, R1.2, R1.3, R1.4, R2.5, R11.3.
- [ ] **T2.3** Tests `stick.test.ts` (contra `adapter-mock`): `mockTagRead` con `enabled=true` invoca `onTagRead` (post dedup+normalize+feedback); `enabled=false` no invoca pero mantiene conexión; `useBleConnectionStatus` refleja transiciones. Cubre: R1.1, R1.3, R1.4, R2.5, R10.4.
- [ ] **T2.4** Reemplazar el cuerpo del stub `app/src/features/animals/hooks/useBleStickListener.ts` (spec 09 T1.5) por una **reexportación** del `useBleStickListener` real de `services/ble/stick.ts`. Única integración con territorio de spec 09; firma sin cambios. (Si el stub aún no existe, crearlo respetando la firma de spec 09.) Cubre: R1.1.
- [ ] **T2.5** Implementar el `BleStickListenerProvider` real (declarado por spec 09 T4.2): monta el hook real, `enabled = !isInModoManiobras && !isBusy`, en `onTagRead` dispara `fireReadFeedback()` + el find-or-create de spec 09, expone `enableListener/disableListener/useBleConnectionStatus/useBusyMode`. Coordinar con la Fase 4 de spec 09 (misma pieza). Cubre: R5.x (feedback), R6.3, R11.1, R11.3.
- [ ] **T2.6** Tests del provider (contra mock): `mockTagRead` dispara el overlay de spec 09; con MODO MANIOBRAS activo (`disableListener`) no dispara; con `isBusy` no dispara. Cubre: R6.3, R11.1, R11.3.
- [ ] **T2.7** Verificar offline-first: el flujo completo (scan→connect→subscribe→dedup→normalize→feedback→onTagRead) no hace ninguna llamada de red. Test/assert de que ningún módulo de `services/ble/` importa fetch/supabase. Cubre: R12.1, R12.2.

---

## Fase 3 — Pantallas BLE — **requiere design system cerrado**

> Fase pausada hasta cerrar el design system canónico (item A.1 del plan), igual patrón que specs 01/02/09. Documentar el bloqueo en `progress/impl_04-bluetooth-baston.md` al llegar acá.

- [ ] **T3.1** `BleStickConnectionScreen.tsx` (en tab "Más", ADR-018): escanea, lista candidatos Allflex (R3.6), elegir → `writeRemembered` + connect, acción "cambiar bastón" y "olvidar" (R3.5). Cubre: R3.1, R3.5, R3.6.
- [ ] **T3.2** `BleConnectionIndicator.tsx`: consume `useBleConnectionStatus()`, render reactivo por estado. Cubre: R9.1, R9.2.
- [ ] **T3.3** `BleSoundPreferenceToggle.tsx`: toggle de beep persistido (`bleSoundEnabled`). Cubre: R5.3.
- [ ] **T3.4** Estados de permiso/BT en la UI: `permission_denied` con CTA a settings; `bluetooth_off` con CTA enable; ambos sin bloquear la carga manual. Cubre: R2.2, R2.3, R6.1, R6.2.
- [ ] **T3.5** Montar la pantalla de conexión + el indicador en el shell de "Más" de spec 01 (coordinar con B.1). Cubre: R3.1, R9.1.
- [ ] **T3.6** Component tests (RTL) de las pantallas BLE: render de lista de candidatos (0/1/N), cambiar/olvidar, toggle de sonido, indicador por estado. Cubre: R3.1, R3.5, R3.6, R5.3, R9.1.

---

## ⏸ PUERTA DÍA DE CAMPO (🔧 BLOQUEANTE — CONTEXT/05, CONTEXT/07)

> Hasta acá todo se construyó y testeó contra `adapter-mock.ts`. La Fase 4 NO puede arrancar hasta tener el resultado del día de campo: escanear el Allflex RS420 con **nRF Connect** y obtener (1) service/characteristic UUIDs y (2) un payload real de un TAG conocido. El leader/implementer **folda** el resultado en `config.ts` + `adapter-ble-plx.ts` + `normalize.ts` antes de implementar la Fase 4. Marcar esta puerta en `progress/impl_04-bluetooth-baston.md`.

---

## Fase 4 — Adaptador GATT real — **requiere día de campo**

- [ ] **T4.1** 🔧 Foldar el resultado del día de campo: completar `config.ts` con `RS420_SERVICE_UUID` y `RS420_TAG_CHAR_UUID` reales. Cubre: R1.6.
- [ ] **T4.2** 🔧 Implementar `adapter-ble-plx.ts.subscribeToTags`: descubrir el service/characteristic del RS420, suscribirse a NOTIFY, entregar el raw payload. (El resto de los métodos del adaptador —scan/connect/permisos/connectionChange— se escriben en esta fase o se adelantan en Fase 2 como genéricos de `react-native-ble-plx`, validados con device real acá.) Cubre: R1.6.
- [ ] **T4.3** 🔧 Completar `normalize.ts` con el formato canónico real del TAG derivado del payload del día de campo (encoding/longitud/ISO 11784/11785). Cubre: R8.3.
- [ ] **T4.4** 🔧 Confirmar la señal de "lectura fallida" del RS420: si NO existe (default), mantener no-read silencioso (R7.1); si existe, foldar un evento de no-read manejable (R7.2). Cubre: R7.1, R7.2.
- [ ] **T4.5** 🔧 (nice-to-have) Verificar Battery Service `0x180F`: si el RS420 lo expone, conectar low-battery al indicador; si no, omitir. Cubre: nice-to-have hardware-dependiente (design § "Pendiente día de campo").
- [ ] **T4.6** 🔧 Validación con device real: bastonear un tag conocido → ver `onTagRead` con el TAG normalizado correcto en un teléfono real con el RS420. Cubre: R1.6, R8.3 (validación end-to-end real).

---

## Fase 5 — Integración con MODO MANIOBRAS / busy mode (construible ahora, contra mock)

- [ ] **T5.1** Documentar y exponer el contrato `enableListener/disableListener` para spec 03: MODO MANIOBRAS llama `disableListener()` en mount (`useEffect`) y `enableListener()` en cleanup. Cubre: R11.1, R11.2.
- [ ] **T5.2** Implementar `useBusyMode()` consumido por CREATE/EDIT de spec 09: `setBusy(true)` en mount, `setBusy(false)` en unmount → suspende el listener sin desconectar. Cubre: R11.3.
- [ ] **T5.3** Tests (contra mock): con `disableListener` activo, `mockTagRead` no dispara; con `isBusy`, `mockTagRead` no dispara; reactivación instantánea sin re-emparejar (R1.4). Cubre: R11.1, R11.2, R11.3, R1.4.
- [ ] **T5.4** Confirmar fallback manual en todos los estados BLE: con bastón desconectado/denegado/BT off, la carga manual de spec 09 sigue accesible en 1 tap. Cubre: R6.1, R6.2.

---

## Fase 6 — Tests + QA

- [ ] **T6.1** Suite unit/integration contra mock verde: `dedup`, `normalize`, `connection`, `remembered-device`, `stick`, `feedback`, `permissions`, provider. Coverage > 80% sobre `services/ble/`. Cubre: trazabilidad completa de las R no-hardware.
- [ ] **T6.2** Test E2E con bastón mockeado del stack de spec 09: `mockTagRead` → `FindOrCreateOverlay` aparece → EDIT/CREATE; tres `mockTagRead` distintos seguidos → asignación masiva (spec 09 R8) no se rompe. Cubre: R4.2, R6.3, R10.2.
- [ ] **T6.3** Test E2E offline (airplane mode + mock conectado): bastoneo → find-or-create local → mutación encolada en PowerSync; sin red en ningún paso de 04. Cubre: R12.1, R12.2.
- [ ] **T6.4** 🔧 QA manual el día de campo: con el RS420 real, bastonear ≥10 tags, medir latencia de feedback (< 1 s, R5.5), verificar reconexión tras salir/volver a rango, dedup real, no-read silencioso. Cubre: validación real de R1.6, R3.4, R5.5, R7.1, R8.3.
- [ ] **T6.5** Documentación de cierre: actualizar `CONTEXT/07-pendientes.md` (quitar lo resuelto el día de campo), foldar UUIDs/formato en CONTEXT/05, registrar el estado en `progress/impl_04-bluetooth-baston.md`. Cubre: housekeeping.

---

## Resumen de dependencias críticas

```
Fase 0 (setup)
   ↓
Fase 1 (lógica core sin UI)              ← construible YA (dedup, normalize, connection, feedback, permisos)
   ↓
Fase 2 (servicio + mock + provider)      ← construible YA (contra mock) — R1, R2.5, R10, R11.3
   ↓
Fase 5 (busy mode / MODO MANIOBRAS)      ← construible YA (contra mock) — R11
   ↓
⏸ PUERTA: design system canónico → Fase 3 (pantallas BLE)
   ↓
⏸ PUERTA: DÍA DE CAMPO (nRF Connect: UUIDs + payload) → Fase 4 (adaptador GATT real)
   ↓
Fase 6 (tests + QA — mock ahora, real el día de campo)
```

## Trazabilidad R<n> → tasks

| Requirement | Tasks | Bloqueo |
|---|---|---|
| R1.1 | T2.2, T2.3, T2.4 | OK |
| R1.2 | T0.2 | OK |
| R1.3, R1.4 | T2.2, T2.3, T5.3 | OK |
| R1.5 | T0.3 | OK |
| R1.6 🔧 | T0.4, T4.1, T4.2, T4.6 | **Día de campo** |
| R2.1, R2.2, R2.3 | T1.11, T1.12, T3.4 | OK (T3.4 espera design system) |
| R2.4 | T1.7, T1.8 | OK |
| R2.5 | T2.2, T2.3 | OK |
| R3.1 | T3.1, T3.5 | Design system |
| R3.2 | T1.5, T1.6 | OK |
| R3.3, R3.4 | T1.7, T1.8 | OK |
| R3.5, R3.6 | T1.5, T3.1 | Parcial (T3.1 design system) |
| R3.7 | T1.5 | OK |
| R3.8 | T1.7, T1.8 | OK |
| R4.1, R4.2, R4.3, R4.4 | T1.1, T1.2 | OK |
| R5.1–R5.5 | T1.9, T1.10, T2.5 | OK (señal visual UI espera design system) |
| R6.1, R6.2 | T1.12, T3.4, T5.4 | OK (T3.4 design system) |
| R6.3 | T2.5, T2.6, T6.2 | OK |
| R7.1 | T4.4 | Día de campo (confirmación); default ya cubierto por "no emite evento" |
| R7.2 🔧 | T4.4 | **Día de campo** |
| R8.1, R8.2 | T1.3, T1.4 | OK (formato provisional) |
| R8.3 🔧 | T4.3, T4.6 | **Día de campo** |
| R9.1, R9.2 | T3.2, T3.5, T3.6 | Design system |
| R10.1, R10.2, R10.4 | T2.1, T2.3 | OK |
| R10.3 | T0.4, T2.2 | OK |
| R11.1, R11.2 | T2.5, T5.1, T5.3 | OK |
| R11.3 | T2.2, T2.5, T5.2, T5.3 | OK |
| R12.1, R12.2 | T2.7, T6.3 | OK |
| R13.1, R13.2 | T1.13 | OK |

## Notas de ejecución

- 04 **no** introduce migraciones SQL, tablas, RLS ni Edge Functions. Todo es cliente. No correr migrations ni tocar la DB.
- Construir y testear **todo** contra `adapter-mock.ts` antes de la PUERTA del día de campo. El `adapter-ble-plx.ts` real (T4.x) solo se completa con el resultado del día de campo.
- No tocar `app/src/features/animals/` salvo T2.4 (reexportación del stub) y la coordinación del provider (T2.5 = la pieza que spec 09 T4.2 declara). Si hace falta más, **PARAR y reportar al leader**.
- Cada task termina con commit en español, presente, descriptivo (`agrega dedup por TAG del bastón`, `implementa adapter-mock del bastón`, etc.).
- Patrón de tests offline-first: airplane mode + mock; ningún módulo de `services/ble/` debe importar red.
- Las Fases 3 (design system) y 4 (día de campo) quedan **listas para diferirse**. Cerrar Fases 0+1+2+5+6(parcial) alcanza para declarar la **parte no-hardware** del bastón operativa contra el mock, desbloqueando la Fase 4 de spec 09 (listener BLE global) end-to-end con bastón mockeado.
```
