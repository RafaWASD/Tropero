# Review — spec 04 (04-bluetooth-baston) CAPA BUILDABLE-HOY

**Revisor**: reviewer
**Fecha**: 2026-06-06
**Alcance**: capa buildable-hoy (Fases 0-3 + Fase 7 parcial). FRONTEND PURO (sin migraciones/RLS/EF). Solo archivos de feature 04: services/ble (excepto parser-rs420 ya committeado), scripts/run-tests.mjs, scripts/ts-ext-resolver.mjs, tasks.md. No se reviso app/app, utils/animal-category, crear-animal.tsx (otra terminal / feature 02).

## Veredicto

APPROVED

Capa buildable-hoy completa: todo R en alcance tiene >=1 test concreto, la interfaz de spec 09 esta implementada con la firma exacta sin redefinir tipos, la dedup es por-TAG (no cooldown global), los adaptadores diferidos (spp-android, hid-wedge) quedaron sin transporte real, y "node scripts/check.mjs" termina verde (exit 0). Las tasks no marcadas [x] son Fases 4/5/6/QA-device, justificadas y diferidas en tasks.md + impl_04-bluetooth-baston.md.

## Trazabilidad R<n> a test (buildable-hoy)

- R1.1 contrato unico -> contract.test.ts "extrae el EID" (todo EID pasa por ingestRawLine/ingestEid). OK
- R1.2 reusa parseRs420Line -> contract.test.ts "tolera STX y CRLF (via parser)"; adapter-web-serial.test.ts "cada linea framed reusada por el parser". OK
- R1.3 isValidTag -> contract.test.ts "y valida", "ingestEid rechaza no-EID". OK
- R1.4 malformado descarta+log -> contract.test.ts "rechaza malformadas SIN tirar", "nunca tira ante no-string", "el motor reporta el motivo". OK
- R1.5 timestamp telefono -> contract.test.ts "timestamp del telefono inyectado (no del lector)". OK
- R1.6 forma exacta tag_read -> contract.test.ts "forma EXACTA de spec 09". OK
- R2.1/R2.3/R2.4 confirmacion pre-commit candidato a commit -> contract.test.ts "commit SOLO al confirmar" (processX devuelve candidato sin emitir; commit emite). OK
- R2.5 encadenable (asignacion masiva) -> contract.test.ts "encadenable"; adapter-mock.test.ts "3 EIDs distintos = 3 tag_read al instante". OK
- R3.1 mismo EID menor a 3s no re-emite -> dedup.test.ts "dentro de la ventana"; contract.test.ts "descarta re-escaneo"; adapter-mock.test.ts "mismo EID re-inyectado se ignora". OK
- R3.2 EIDs distintos al instante -> dedup.test.ts "tres distintos AL INSTANTE"; contract.test.ts "no hay cooldown global". OK
- R3.3 dedup por-TAG keyed -> dedup.test.ts "POR-TAG, no cooldown global". OK
- R3.4 ventana ajustable -> dedup.test.ts "ajustable"; contract.test.ts "ventana inyectada"; DEDUP_WINDOW_MS fuente unica en dedup.ts reexportada por config.ts. OK
- R3.5 dedup en el contrato (identica a todos) -> EidIngestEngine usa TagDedup transport-agnostico; ejercitado por mock (limpio) y stream (processRawLine). OK
- R4.1 vibracion siempre native -> feedback.test.ts "vibracion SIEMPRE, beep ON y OFF". OK
- R4.2 beep si habilitado -> feedback.test.ts "beep SOLO con preferencia". OK
- R4.3 toggle beep persistido, vibracion sigue -> feedback.test.ts "ON por defecto", "1/0"; feedback-pref.ts (web localStorage / native SecureStore). OK
- R4.5 web beep WebAudio + vibracion degradada -> feedback.test.ts "web degrada vibracion", "canal web-audio". OK
- R5.1 web-serial solo Platform.OS web -> wiring.test.ts "en web se monta web-serial". OK
- R5.2 requestPort+open(baud) -> adapter-web-serial.ts connect (logica; device-path diferido T2.5). OK logica
- R5.3 framing por linea a parser -> adapter-web-serial.test.ts 5 casos (chunks partidos, multiples lineas, CRLF, STX) -> ingestRawLine. OK
- R5.4 getPorts reconecta sin re-preguntar -> adapter-web-serial.ts connect(remembered) (logica). OK logica
- R5.5 desconexion a backoff sin bloquear manual -> adapter-web-serial.test.ts "backoff crece y topea"; guard reconnectScheduled. OK
- R5.6 Chromium/seguro, degrada claro -> adapter-web-serial.test.ts "isWebSerialSupported false en node". OK
- R7.1 manual = mismo contrato -> adapter-manual.ts submit a onTagRead a engine; contract.test.ts "ingestEid sin parser de stream". OK
- R7.2/R7.4 manual siempre / nunca bloquea -> wiring.test.ts "piso", "ningun estado bloquea"; blocksManualEntry()=false. OK
- R9.2 isConnectedStatus -> wiring.test.ts "true solo en connected". OK
- R9.3 useBleConnectionStatus (hook propio) -> connection-status.ts + wiring.test.ts (helpers); hook React por typecheck. OK
- R9.4 connection_changed forma exacta -> contract.test.ts "buildConnectionEvent". OK
- R9.6 estados no bloqueantes -> wiring.test.ts "ningun estado bloquea". OK
- R10.1 mock inyecta lecturas+connection -> adapter-mock.test.ts "mockTagRead dispara pipeline", "mockConnectionChange". OK
- R10.2 mock por toggle mode=mock -> wiring.test.ts "mode=mock". OK
- R10.3 provider monta por plataforma -> wiring.test.ts (web/native/mock); instantiateTransport. OK
- R10.4 useBleStickListener firma exacta -> stick.ts (verificado por typecheck, parte de check verde). OK
- R10.5 enabled=false suspende sin desconectar -> adapter-mock.test.ts "disable no dispara, re-enable reanuda"; provider listening = enabled and not busy. OK
- R10.6 useBusyMode -> stick.ts useBusyMode/useBusyWhileMounted + provider not busy. OK
- R10.7 enableListener/disableListener -> stick.ts useStickListenerControls; provider por context (spec 09 design L311). OK
- R10.8 mock respeta dedup/feedback/validacion/enable -> adapter-mock.test.ts (dedup, EID invalido no emite, disable). OK
- R11.1 interfaz StickAdapter -> stick-adapter.ts; 5 adaptadores la implementan (typecheck). OK
- R11.2 5 adaptadores detras de la interfaz -> wiring.test.ts; cada adapter implements StickAdapter. OK
- R11.3 sumar adaptador sin tocar contrato -> selectTransportAdapter ramificable; spp/hid no tocan el contrato. OK
- R11.4 streams mismo parser; hid captura propia -> contract.ts ingestRawLine reusa parseRs420Line; adapter-web-serial.test.ts. OK
- R12.4 web-serial permiso browser -> wiring.test.ts "browser". OK
- R12.5 permiso denegado no bloquea -> wiring.test.ts "NUNCA bloquea". OK
- R13.1/R13.2 no-read silencioso -> offline-noread.test.ts "sin tag no produce evento", "no inventa rechazos". OK
- R14.1/R14.2 offline -> offline-noread.test.ts "corre sin red" (toda la suite sin keys). OK
- R15.1/R15.2 logging no bloqueante -> wiring.test.ts "nunca tira, aun con console roto". OK

R fuera de alcance (correctamente diferidos): R6.*/R12.1/R12.2 (spp-android, Fase 4, placeholder inerte); R8.* (hid-wedge, GATED R8.7, placeholder sin logica); R9.1/R9.5 UI, R2.2/R4.4 latencia visual menor a 1s (Fase 6, UI tentativa).

## Tasks completas

Si, dentro del alcance buildable-hoy. Fase 0 (T0.1-T0.4) [x]; Fase 1 (T1.1-T1.6) [x]; Fase 2 (T2.1-T2.4 [x], T2.5 marcada parcial: prueba RS420 fisica diferida con justificacion - sin hardware, logica de-riskeada por tests puros); Fase 3 (T3.1-T3.10 [x], T3.3 marcada parcial: N/A porque features/animals no existe, todo en services/ble con firma exacta); Fase 7 (T7.1/T7.2/T7.3 [x], T7.4/T7.5 [ ] QA device + cierre docs, diferidos). Fases 4/5/6 [ ] fuera de la capa buildable-hoy (dev build / GATED / design system), justificadas en tasks.md e impl_04. Ningun checkbox sin marcar queda sin justificacion documentada.

## CHECKPOINTS

- C1 harness: [x] check.mjs exit 0 (resto no es alcance de la feature).
- C2 estado coherente: [x] tests verdes; no introduce features in_progress nuevas.
- C3 arquitectura: [x] solo capa services/ble (boundary I/O); [x] sin deps externas nuevas (expo-secure-store/react-native ya en stack; tipos Web Serial locales sin any); [x] sin logs debug ni TODOs sin contexto; [x] no hardcodea establishment_id.
- C4 verificacion: [x] >=1 test por modulo con logica (60 tests BLE verdes); [x] fixtures reales (capturas RS420 de field-findings.md); [x] runner >0 tests verdes; RLS cross-tenant N/A.
- C6 SDD: [x] 3 archivos spec; [x] EARS; [x] cada R en alcance con >=1 test. Feature aun in_progress (cierre full requiere Fases 4-6).
- C7 multi-tenant: N/A (04 no crea tablas ni toca DB).
- C8 offline-first: [x] contrato corre sin red; bucket PowerSync/conflict resolution = spec 09 (04 no persiste).

## Checklist RAFAQ-especifico

- A. Multi-tenancy/RLS: N/A (frontend puro, no toca DB; ADR-024 100% cliente).
- B. Offline-first: [x] funciona offline (offline-noread.test.ts); sync bucket scoped = N/A (no persiste, spec 09); conflict resolution N/A (no escribe); [x] sin requests sincronos a Supabase desde pantalla (ningun modulo de services/ble importa supabase/fetch).
- C. BLE: [x] desconexion repentina (web-serial disconnect/error a disconnected + backoff R5.5; UI estado Fase 6); [x] fallback manual <=1 tap (adapter-manual siempre connected, R7.2/R7.3); [x] correlacion TAG-peso = spec 05, fuera de 04 (la ventana ~3s de 04 es DEDUP R3.4, DEDUP_WINDOW_MS=3000 ajustable); [x] logs BLE no bloquean (logging.ts best-effort, R15).
- D. UI de campo: N/A en este run (pantalla conexion/indicador/toggle beep = Fase 6, tentativa hasta design system; sin JSX de campo).
- E. Edge Functions: N/A (100% cliente, sin EF).

## Verificaciones pedidas

1. Cobertura buildable-hoy con test: cada R en alcance con >=1 test (tabla). OK
2. Interfaz spec 09 firma EXACTA (vs design.md L168-175/L311/L403): BleStickEvent identico (implementa, no redefine); useBleStickListener con opts enabled/onTagRead retorna isConnected/isListening identico; provider mode=mock + mockTagRead, enableListener/disableListener por context; useBleConnectionStatus/useBusyMode implementados (coordinacion Fase 4 documentada, no bloquea); NO redefine tipos de spec 09 (comentario explicito stick-adapter.ts L8-10). OK
3. Dedup por-TAG: Map keyed por eid con lastEmittedAtMs; EIDs distintos pasan sin esperar (clave spec 09 R8). OK
4. spp-android/hid-wedge sin codigo activo: spp-android placeholder que tira NOT_BUILT y NO se monta (instantiateTransport retorna null); hid-wedge solo constantes GATED, cero transporte; selectTransportAdapter nunca elige hid-wedge. OK
5. ts-ext-resolver.mjs sano: hook module.registerHooks que solo reintenta agregar .ts en relativos extensionless cuando nextResolve falla, via --import exclusivo de node --test; no toca Metro/typecheck/bundle. Acotado y benigno. OK

## check.mjs

node scripts/check.mjs retorna exit code 0 (typecheck cliente + 60 tests BLE + suites backend RLS/Edge/Animal/Maneuvers/user_private sin regresion). Suite BLE aislada: tests 60 / pass 60 / fail 0.

## Cambios requeridos

Ninguno. APPROVED.

## Notas para la puerta de codigo (no bloqueantes)

- R5.* end-to-end con RS420 fisico (T2.5) y SPP-Android (Fase 4) requieren hardware/dev build - fuera de CI, esperado.
- Render real de provider/hooks (React) y UI Fase 6 se validan en web/device con el design system.
- Frontera spec 09 Fase 4 (reexportacion delgada de stick.ts/BleStickListenerProvider desde features/animals) pendiente del lado de spec 09 - documentada, no es deuda de 04.
