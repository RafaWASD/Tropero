baseline_commit: 6d5c96f32b01ba91d60d1ea97e9cd96209deebc5

# Implementación spec 04 — bastón lector RFID (EID) — CAPA BUILDABLE-HOY

**Feature**: 04-bluetooth-baston (`in_progress`, Puerta 1 aprobada por Raf 2026-06-03, Gate 1 PASS).
**Run**: capa buildable-hoy (Fases 0–3 de tasks.md) — sin hardware. NO spp-android (R6/R12), NO hid-wedge (R8, GATED).
**Baseline**: `6d5c96f` (SHA previo a la primera task de este run; Gate 2 calcula el diff desde acá).

## Alcance de este run

- Contrato de ingesta de EID (R1, R2, R3): normalización/validación (reusa `parser-rs420.ts`, NO reescribe) + confirmación pre-commit + dedup por-TAG ventana ~3s.
- Feedback (R4): vibración siempre + beep apagable (preferencia persistida) + confirmación visual; web → Web Audio + vibración degradada.
- Interfaz `StickAdapter` (R11), transport-agnóstica.
- adapter-manual (R7), adapter-web-serial (R5), adapter-mock (R10).
- Provider/hooks que IMPLEMENTAN la interfaz de spec 09: `BleStickListenerProvider`, `useBleStickListener`, `useBleConnectionStatus`, `useBusyMode`, `enableListener`/`disableListener`.
- Offline (R14), logging no bloqueante (R15), no-read silencioso (R13), permisos por transporte buildables (R12.4/R12.5).

## Hallazgo de coordinación (spec 09)

El directorio `app/src/features/animals/` **NO existe** — el frontend de spec 09 está `deferred` y su stub T1.5 (`useBleStickListener`) nunca se montó. No hay código de spec 09 que reexportar/delegar. Decisión (design §Regla de frontera + Preguntas abiertas #2): implemento TODO el contrato + adaptadores + provider/hooks en `app/src/services/ble/` (territorio de 04), con la firma EXACTA declarada por el `design.md` de spec 09. NO toco `app/src/features/animals/` (territorio spec 09, posible colisión con la otra terminal). Cuando spec 09 Fase 4 se implemente, su `BleStickListenerProvider`/`useBleStickListener` delegan en `services/ble/` (reexportación delgada) — sin redefinir tipos. No fue necesario CAMBIAR ningún contrato de spec 09 → no se paró por R2 (Preguntas abiertas #3).

Firma de spec 09 tomada de `specs/active/09-buscar-animal/design.md` (líneas 165-175):
```ts
type BleStickEvent =
  | { kind: 'tag_read', tag: string, timestamp: number }
  | { kind: 'connection_changed', connected: boolean };
useBleStickListener(opts: { enabled: boolean, onTagRead: (tag: string) => void }): { isConnected: boolean; isListening: boolean };
```
+ provider expone `{ disableListener, enableListener }` por context, acepta `mode='mock'` con `mockTagRead(tag)`, y `useBusyMode()`.

## Plan (tasks de tasks.md, capa buildable-hoy) — ESTADO

- [x] Fase 0 — Setup: `stick-adapter.ts` (interfaz + tipos), `config.ts` (T0.1–T0.4)
- [x] Fase 1 — Contrato + feedback: `contract.ts`, `dedup.ts`, `feedback-pref.ts`, `feedback-logic.ts`, `feedback.ts`, confirmación pre-commit (T1.1–T1.6)
- [x] Fase 2 — Adaptadores buildables: `adapter-manual.ts`, `adapter-mock.ts`, `adapter-web-serial.ts` + `line-framer.ts` (T2.1–T2.4); **T2.5 DIFERIDA** (sin RS420 físico en este run — la lógica está de-riskeada por tests puros)
- [x] Fase 3 — Provider + hooks + wiring: `connection-status.ts`, `stick.ts`, `BleStickListenerProvider.tsx`, `adapter-selection.ts`, `permissions.ts`, `logging.ts`, `remembered-device.ts`, enable/disable, busyMode, offline, no-read (T3.1–T3.10); **T3.3 N/A** (spec 09 sin código → todo en `services/ble/`)
- [x] Fase 7 (parcial) — Tests del contrato + E2E mock + contrato-MANIOBRAS doc (T7.1, T7.2, T7.3)

Placeholders documentados (NO código activo): `adapter-spp-android.ts` (Fase 4, dev build), `adapter-hid-wedge.ts` (Fase 5, GATED R8.7).

DIFERIDO (fuera de este run): Fase 4 (spp-android, dev build + Android), Fase 5 (hid-wedge, GATED), Fase 6 (UI conexión + indicador, design system), T2.5/T4.7/T7.4 (device real), T7.5 (cierre docs final).

## Infraestructura nueva (no-app)

- `scripts/ts-ext-resolver.mjs` — hook `--import` para `node --test` que resuelve imports relativos extensionless ENTRE módulos fuente (Node ESM exige extensión; Metro/typecheck no). Necesario porque `contract.ts` value-importa `dedup.ts`/`parser-rs420.ts`. NO toca Metro, typecheck ni el bundle de la app — solo la resolución de los tests. Habilita node:test para todo módulo puro con cross-imports a futuro. Cableado en `scripts/run-tests.mjs` (`client unit tests`).
- `scripts/run-tests.mjs` — agregados 6 archivos de test BLE + el `--import` del resolver.

## Decisión de frontera con spec 09 (sin parar)

Spec 09 frontend está `deferred` y `app/src/features/animals/` NO existe → no hay stub que reexportar (T3.3 N/A). Implementé todo en `services/ble/` con la firma EXACTA de spec 09 (tomada de su `design.md` 168-175). Cuando spec 09 Fase 4 monte su `BleStickListenerProvider`/`useBleStickListener`, debe REEXPORTAR/DELEGAR en `services/ble/stick.ts` + `BleStickListenerProvider.tsx` (no redefinir tipos). **NO requirió cambiar ningún contrato de spec 09 para R2** (la confirmación visual pre-commit la hace el overlay de spec 09 mostrando el EID string que el provider entrega por `onTagRead(tag)`; el contrato separa candidato/commit pero entrega el string como declara spec 09) → **NO se paró** (Preguntas abiertas #3). `useBleConnectionStatus` implementado como hook propio sobre el contexto del provider (Preguntas abiertas #1; ambos leen el mismo estado, no bloquea).

## Trazabilidad R<n> → archivo:test

| R | Cubierto por |
|---|---|
| R1.1/R1.2/R1.3/R1.4 (normalización/validación, reusa parser) | `contract.ts:ingestRawLine/ingestEid` → `contract.test.ts` ("R1.2/R1.3 extrae...", "R1.4 rechaza malformadas", "R1.4 nunca tira", "R1.3 normaliza bordes") |
| R1.5/R1.6 (timestamp teléfono + forma evento spec 09) | `contract.ts:buildTagReadEvent` → `contract.test.ts` ("R1.6 forma EXACTA", "R1.5 timestamp del teléfono") |
| R2.1/R2.3/R2.4/R2.5 (confirmación pre-commit, encadenable) | `contract.ts:EidIngestEngine.processX/commit` → `contract.test.ts` ("R2.3 commit solo al confirmar", "R2.5 encadenable") |
| R3.1/R3.2/R3.3/R3.4/R3.5 (dedup por-TAG) | `dedup.ts:TagDedup` → `dedup.test.ts` (7 casos: <3s, >3s, 3 distintos al instante, por-TAG, ventana desde emisión confirmada, ajustable, reset) + `contract.test.ts` (motor) |
| R4.1/R4.2/R4.5 (feedback vibración/beep/web) | `feedback-logic.ts:decideFeedback` → `feedback.test.ts` ("R4.1 vibración siempre native", "R4.5 web degrada", "R4.2/R4.3 beep solo habilitado", "R4.5 canal") |
| R4.3/R4.4 (preferencia beep persistida) | `feedback-logic.ts:parseBeepPref` + `feedback-pref.ts` (I/O) → `feedback.test.ts` ("R4.3 ON por defecto", "R4.3 1/0") |
| R5.1/R5.2/R5.3/R5.4 (web-serial) | `adapter-web-serial.ts` + `line-framer.ts` → `adapter-web-serial.test.ts` (framing por chunks/líneas/`\r\n`, cada línea → EID por parser) + `wiring.test.ts` (R5.1 montaje solo en web) |
| R5.5/R5.6 (desconexión/backoff/soporte) | `line-framer.ts:backoffDelayMs/isWebSerialSupported` → `adapter-web-serial.test.ts` ("R5.5 backoff", "R5.6 soporte") |
| R7.1/R7.2/R7.4 (manual piso) | `adapter-manual.ts:ManualAdapter` → ejercitado vía contrato; `wiring.test.ts` (R7 piso en native) + provider lo monta siempre |
| R9.2/R9.3/R9.4/R9.6 (estado conexión, no bloqueante) | `connection-status.ts:isConnectedStatus/blocksManualEntry` + provider → `wiring.test.ts` ("R9.2 isConnected", "R9.6 ningún estado bloquea") |
| R10.1/R10.8 (mock ejercita el stack) | `adapter-mock.ts:MockAdapter` → `adapter-mock.test.ts` (inyección, 3 distintos, dedup, inválido, disable, status) |
| R10.2/R10.3/R11.2/R11.3 (selección de adaptador) | `adapter-selection.ts:selectTransportAdapter` → `wiring.test.ts` ("R10.2 mock", "R10.3/R5.1 web", "R7 native", "R8.7 nunca hid-wedge") |
| R10.4 (useBleStickListener firma) | `stick.ts:useBleStickListener` (React; firma verificada por typecheck) |
| R10.5/R10.7 (enable/disable listener) | `BleStickListenerProvider` + `stick.ts:useStickListenerControls` → `adapter-mock.test.ts` ("R10.5 disable no dispara, re-enable reanuda") |
| R10.6 (busy mode) | `stick.ts:useBusyMode/useBusyWhileMounted` + provider `listening = enabled && !busy` |
| R11.1 (interfaz StickAdapter) | `stick-adapter.ts` (typecheck: 5 adaptadores la implementan) |
| R11.4 (parser compartido streams) | `contract.ts:ingestRawLine` reusa `parseRs420Line` → `adapter-web-serial.test.ts` (línea framed → parser) |
| R12.4/R12.5 (permisos web-serial / no bloquea) | `permissions.ts:permissionModelFor/permissionDenialBlocksApp` → `wiring.test.ts` ("R12.4 browser", "R12.5 no bloquea") |
| R13.1/R13.2 (no-read silencioso) | `offline-noread.test.ts` ("R13.1 no-read sin evento", "R13.2 no inventa rechazos") |
| R14.1/R14.2 (offline) | `offline-noread.test.ts` ("R14.2 contrato corre sin red") — toda la suite corre sin keys |
| R15.1/R15.2 (logging no bloqueante) | `logging.ts:logTransportEvent` → `wiring.test.ts` ("R15.1/R15.2 nunca tira, aun con console roto") |

**Diferidos (no testeables en CI / fuera de run)**: R2.2 (<1s visual — UI, Fase 6), R4.4 (visual — UI), R5.* end-to-end con device (T2.5), R6/R12.1/R12.2 (spp-android, Fase 4), R8 (hid-wedge, GATED), R9.1/R9.5 UI (Fase 6).

## Autorrevisión adversarial (paso 8)

Pasada hostil sobre el propio código antes del reviewer. Qué busqué y qué cerré:

1. **Type bug real (lo cazó el typecheck temprano)**: `IngestResult['reason']` indexaba un `reason` que no existe en la rama `{ok:true}` de la unión → definí `RejectReason` explícito. Cerrado.
2. **Imports muertos en el provider**: `buildConnectionEvent` y `RejectReason` importados sin usar; refs `enabledRef`/`busyRef` asignadas y nunca leídas (solo `listeningRef` se lee). Removidos. Cast redundante `as RejectReason` (el tipo ya era ese) → removido.
3. **Doble loop de reconexión (web-serial)**: el `finally` del read loop y el evento `disconnect` del navegador podían agendar DOS reconexiones paralelas. Agregué guard `reconnectScheduled`. Además `addEventListener('disconnect')` se apilaba en cada reconexión → `removeEventListener` antes de `addEventListener` (idempotente). (Código device-path, no CI; T2.5 lo valida en hardware.)
4. **Dedup edge — ventana desde el último intento vs. última emisión**: verifiqué (test explícito) que re-escaneos repetidos dentro de la ventana NO la extienden (la field-finding muestra 9 líneas repetidas del mismo tag) — se mide desde la última emisión CONFIRMADA. Cerrado.
5. **Tests que pasan por la razón equivocada**: revisé que el "disable no dispara" ejerza el gate real (`MockAdapter.listening`) y luego re-enable confirme el path positivo; que la dedup del mock ejercite el motor real (el mock no dedup-ea); que el EID inválido recorra mock→onTagRead→engine→isValidTag→reject. Todos ejercen el path real, no un atajo.
6. **R2 / frontera spec 09**: confirmé que NO hay que cambiar contrato de spec 09 — el provider entrega el `tag` string (firma exacta `onTagRead(tag)`); la confirmación visual es del overlay de spec 09. No se paró.
7. **Multi-tenant**: 04 no asume `establishment_id` (lo resuelve spec 09 con el EID crudo) — verificado: ningún módulo de `services/ble/` lee/hardcodea establishment.
8. **Offline-first**: ningún módulo del contrato importa supabase/fetch — la suite entera corre sin red (lo prueba `offline-noread.test.ts` por construcción).
9. **No-read silencioso**: el adapter no emite sin tag; el motor no inventa rechazos sin entrada. Tests explícitos.
10. **GATED/diferidos correctos**: `adapter-hid-wedge.ts` sin lógica activa (placeholder); `adapter-spp-android.ts` placeholder que tira si se usa (no se monta en el provider este run); `selectTransportAdapter` nunca elige hid-wedge.

Tras los fixes: typecheck verde + 75/75 tests BLE verdes + `node scripts/check.mjs` verde end-to-end (RLS/Edge/Animal/Maneuvers/user_private sin regresión).
