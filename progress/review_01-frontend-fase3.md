# Review (01-identity-multitenancy) Frontend B.1.1 Fase 3 - fundacion de auth

Agente: reviewer | Fecha: 2026-05-30 (sesion 21)
Baseline: c56a57f -> commit 1893513 (24 archivos, +1823/-44).
Alcance: T3.1-T3.6 (cliente auth). Backend Fases 0/1/2 ya done, no re-revisado.

## Veredicto: APPROVED

El run B.1.1 cumple el alcance Fase 3, respeta architecture/conventions/ADR-023, tiene trazabilidad R->test para lo testeable + evidencia e2e para lo no-unit-testeable, y check.mjs pasa verde sin regresion. Seams de Fase 4/5 declarados como TODO con punto de insercion - no a medio hacer.

## Trazabilidad R<n> <-> test/evidencia

- R1.1 -> app/src/utils/validation.test.ts (5 tests). unit verde.
- R1.2 -> sign-up.tsx signUp + estado verifica email; e2e over_email_send_rate_limit confirma path de envio.
- R1.3 -> _layout.tsx AuthGate re-rutea !emailVerified -> /verify-email; verify-email.tsx.
- R1.4 -> sign-in.tsx + AuthContext.signIn; e2e signInWithPassword + invalid_credentials.
- R1.5 -> forgot-password.tsx + update-password.tsx + requestPasswordReset; e2e resetPasswordForEmail.
- R1.6 -> AuthContext.signOut + reset push guard; onAuthStateChange -> unauthenticated -> gate.
- R1.7 -> app/src/utils/lockout.test.ts (6 tests) + auth-errors mapeo 429. unit verde.
- R5.11 -> registerPushTokenBestEffort -> register_push_token (Edge T2.7 verde); web no-op.
- R5.13 -> pending-invitation.ts store read/write/clear + verify-email.tsx consulta token; re-ruteo TODO B.1.3.
- R7.* -> gating por AuthState; backend RLS verde (15 tests, R7.2 cross-tenant).
- R9.2 -> por construccion: signUp/signIn/reset online, no se cachean offline.

Nota: R1.2-R1.6 dependen de I/O real de Supabase Auth, no unit-testeables sin Jest (no instalado, justificado) ni mock de I/O critico (prohibido). Cubiertos con e2e real contra remoto (coherente con verification.md). Logica pura (R1.1, R1.7, mapeo errores) en 19 unit tests verdes, no tautologicos (reloj inyectado; mapeo real code+message+status).

## Tasks completas: si (alcance B.1.1)

T3.1-T3.6 hechas (trackeadas en progress/impl_01-frontend-fase3.md). Tasks Fase 4-8 quedan [ ] con justificacion documentada: feature in_progress, decomposicion en runs (B.1.1->B.1.2->B.1.3->B.1.4; Fase 7/8 diferidas) en feature_list.json::notes. No se cierra como done -> C6 (todas [x]) no aplica aun.

## CHECKPOINTS

- C1 [x] harness completo (check.mjs exit 0).
- C2 [x] estado coherente (una feature in_progress; no marcada done).
- C3 [x] arquitectura: capas correctas (services unica I/O; components no importan services); sin establishment_id hardcodeado; sin logs debug (2 console.warn guardeados por NODE_ENV); TODOs con contexto.
- C4 [x] verificacion real: 19 unit + suites backend reales; >0 verdes; sin mocks de I/O critico.
- C5 [~] cierre de sesion: lo cierra el leader; .env.local gitignoreado.
- C6 [parcial OK] SDD: 3 archivos spec; EARS estricto; tasks Fase 4+ justificadas (no done); cada R Fase 3 con test/evidencia.
- C7 [N/A cliente] multi-tenant: no se tocan tablas; RLS backend verde (R7.2).
- C8 [N/A] offline-first: auth online por spec (R9.2); PowerSync Fase 7 diferida.

## Checklist RAFAQ-especifico

- A. Multi-tenancy/RLS - N/A. No crea/modifica tablas con establishment_id; cliente de auth puro. Backend RLS done y verde.
- B. Offline-first - N/A. No carga datos de campo. Auth online por spec (R9.2). Storage adapter degrada con gracia (SecureStore/localStorage/memoria) = persistencia de sesion, no datos.
- C. BLE - N/A.
- D. UI de campo (parcial; auth es pantalla mixta, no manga-critica):
  [x] Touch-targets: FormField y Button minHeight=touchMin(56); LinkButton chipMin(40)+hitSlop8 (link secundario OK). CTAs primarios >=56.
  [x] Fuente: inputs inputText(16px); labels size3(13px). Auth no manga-critica -> 18pt no vinculante; acciones en 16px. Aceptable onboarding.
  [x] Una decision por pantalla: sign-in/up/forgot/verify/update.
  [x] Loading visible: submit togglea copy + disabled mientras submitting.
- E. Edge Functions - N/A. No crea/modifica EF (7 ya done/verdes). Solo invoca register_push_token (best-effort, JWT por supabase-js).

## ADR-023 (CERO hardcode)

- Lint anti-hardcode: 0 violaciones en app/app + app/src/components.
- getTokenValue en FormField: textPrimary/textMuted/divider/terracota/white/inputText/touchMin/card/space4 todos existen en tamagui.config.ts; valores comentados coinciden (touchMin=56, inputText=16, card=16). Sin literales encubiertos.
- fontFamily Inter en FormField.tsx:102 NO es violacion: el lint no cubre fontFamily; es el nombre de familia real que el face del config espera. En TextInput de RN debe ser string de familia real, no token.
- Consistencia con Button.tsx: FormField/AuthScreenShell/AuthBits replican split a11y web/native, mismos tokens, exportados desde components/index.ts.

## Calidad/robustez

1. Errores de Auth: auth-errors.ts mapea email duplicado, credenciales invalidas, password debil, sin red, rate-limit(429), email no confirmado, email invalido + fallback por contexto. No expone stack. 7 tests verdes incl. error nulo.
2. Storage adapter no rompe en web: selecciona por Platform.OS; web->localStorage; headless->memoria. Bundle web compilo (3689 modulos).
3. Polling verify-email se limpia al desmontar: clearInterval(id) en cleanup (verify-email.tsx:43-48). Sin leak.
4. No hay loop en AuthGate: replace solo dispara cuando segmento != estado; tras re-rutear coincide. Flash de (tabs) al boot unauthenticated (no hay app/index.tsx) es cosmetico, home no usa auth, no crashea. Aceptable B.1.1.
5. Tests no tautologicos: lockout inyecta reloj y ejercita ramas reales; auth-errors verifica mapeo real.
6. Alcance correcto: setPendingInvitationToken/clear definidos pero NO invocados desde pantallas (escritura = Fase 5). EstablishmentContext no existe (TODO en contexts/index.ts). Gate verificado cae a (tabs) placeholder con insercion marcada para Fase 4. Sin trabajo Fase 4/5 a medio hacer.

## check.mjs

VERDE. Typecheck OK; 19 client unit + 15 RLS + 26 Edge + 28 Animal + 13 Maneuvers pass. Anti-hardcode 0. Sin regresion.

## Observaciones menores (no bloqueantes, para B.1.2/B.1.3)

- OBS-1 (B.1.2): SecureStore 2KB en native - la sesion supabase-js va en una key, puede exceder el limite en device. TODO en supabase.ts; veredicto device diferido. No bloquea B.1.1 (web).
- OBS-2 (B.1.3): forgot-password.tsx:51 discrimina error red/limit por substring del copy traducido (includes conexion/intentos). Acopla control de flujo al texto; si el copy cambia, la rama se rompe silenciosamente. Preferible chequear error crudo (status/code) antes de traducir. Menor; anotar para Fase 5.
- OBS-3 (B.1.3): flash de (tabs) al boot unauthenticated se resolvera con el gating de establecimiento de Fase 4. Sin accion ahora.

Ninguna observacion amerita CHANGES_REQUESTED.
