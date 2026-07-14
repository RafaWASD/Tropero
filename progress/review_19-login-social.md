# Review - 19-login-social (F1-F5, buildable-ya)

- Revisor: reviewer (oraculo de completitud/wiring)
- Fecha: 2026-07-13
- Alcance: F1-F5 (codigo buildable-ya). F6 (QA device T21-T24.1) = GATED-RAF, fuera de este run.
- Baseline impl: 6f14895 (commit del impl_19-login-social.md).

## Veredicto

APPROVED - para el alcance F1-F5 (buildable-ya). El wiring es real (no hay imports muertos), el
platform-split mantiene los modulos nativos fuera del bundle web (verificado por grep del dist, no solo por
typecheck), los invariantes de seguridad (nonce, lockout, no-log de tokens, scope guard) se sostienen, y las
specs (design.md seccion Deltas) describen el as-built. F6 (device) + Gate 2/2.5 + full check.mjs quedan como
gates del leader (documentados abajo), NO bloquean esta review de F1-F5.

## Verificacion ejecutada (LOCAL - full check.mjs deferido por instruccion)

- pnpm --dir app typecheck (tsc --noEmit): VERDE (0 errores).
- unit auth-errors.test.ts (5 social nuevos) + env-resolve.test.ts (3 R7.4 nuevos): 22/22 VERDE.
- pnpm --dir app e2e:build (expo export -p web): Exported dist - limpio.
- grep dist markers nativos (RNGoogleSignin, google-signin, hasPlayServices, PLAY_SERVICES_NOT_AVAILABLE,
  expo-apple-authentication, AppleAuthenticationButton, ExpoAppleAuthentication, getRandomBytesAsync,
  digestStringAsync): 0 hits (9/9).
- grep dist presencia esperada (signInWithOAuth, Continuar con Google, auth-divider): presentes.
- E2E social-login.spec.ts (2) + auth.spec.ts regresion spec 01 (4): 6/6 passed (58s) - sin regresion.
- node scripts/check-hardcode.mjs: 0 violaciones.
- design pngs re-render tras E2E: 0 cambios (estos specs no rinden design pngs; sin revert necesario).

Full node scripts/check.mjs NO corrido - por instruccion explicita del leader (pega a la DB remota
compartida; otra terminal con trabajo activo = riesgo de flake de rate-limit). El subset frontend que ese
check correria (typecheck + estos unit + e2e:build) esta VERDE. El full check.mjs queda como gate del leader
antes del cierre. Esta feature es frontend-only = sin suites backend/DB propias que verificar.

## Trazabilidad R-n vs test/verificacion (automatizable en F1-F5)

- R1.1 (contrato signInWithGoogle): typecheck + AuthContext.tsx:68 (en value) + render E2E. OK
- R2.1 (contrato signInWithApple): typecheck + AuthContext.tsx:70 (en value) + render E2E. OK
- R1.7 / R2.5 / R7.5 (bundle limpio, import nativo solo .native): grep dist = 0 markers nativos. OK
- R3.1 / R3.2 (web OAuth): google-auth.web.ts:14 / apple-auth.web.ts:11 + grep signInWithOAuth en dist. OK
- R3.3 (redirectTo = origin): google-auth.web.ts:16, apple-auth.web.ts:13. OK
- R3.5 (flowType intacto): app/src/services/supabase.ts sin diff + grep flowType ausente (implicit). OK
- R4.1 (AuthDivider): social-login.spec.ts getByTestId auth-divider. OK
- R4.2 (boton Google web): social-login.spec.ts getByRole Continuar con Google. OK
- R4.3 (boton Apple web): social-login.spec.ts getByRole Continuar con Apple. OK
- R4.5 (exports): components/index.ts:13,15,17 + typecheck. OK
- R4.6 (branding Google sin recolorear): check-hardcode 0 violaciones (hex con design-lint-disable) + veto
  visual Gate 2.5 (leader). OK (visual pendiente Gate 2.5)
- R4.7 (mismo layout sign-up): social-login.spec.ts test sign-up. OK
- R6.1 (cancel silencioso): auth-errors.test.ts R6.1 + servicio devuelve ok:false sin error
  (google-auth.native.ts:37, apple-auth.native.ts:63). OK
- R6.2 (sin red): auth-errors.test.ts R6.2 social sin conexion. OK
- R6.3 (DEVELOPER_ERROR): auth-errors.test.ts R6.3 (sin filtrar config). OK
- R6.4 (Play Services): auth-errors.test.ts R6.4. OK
- R6.5/R6.6 (fallback / no crudo): auth-errors.test.ts R6.5/R6.6. OK
- R7.3 (deps): package.json:24,29,32 + typecheck resuelve. OK
- R7.4 (googleWebClientId opcional): env-resolve.test.ts (3 tests: sin=undefined, con=expuesto, requerida
  faltante=aborta). OK
- R8.1 (nonce raw a Supabase / hash a Apple): inspeccion apple-auth.native.ts:37,44,55 (direccion correcta,
  no invertida). OK
- R8.5 (lockout intacto): sign-in.tsx (social no gateado por locked, no llama registerFailure/resetLockout;
  CTA sigue anyBusy or locked) + auth.spec.ts sin regresion. OK
- R8.7 (redirectTo app-controlado): auth.web.ts usa window.location.origin, nunca input. OK
- R8.9 (no loggear tokens/nonce): grep console en servicios auth + botones = 0 (solo comentarios). OK
- QA-manual-device (R1.2-R1.5, R2.2-R2.6, R3.6, R5.x, R8.2-R8.8): GATED-RAF (F6), no automatizable, fuera de
  este run. PAUSA

Cada R-n del alcance F1-F5 tiene 1 o mas verificaciones concretas. Los R-n QA-manual-device estan
correctamente marcados como no automatizables en requirements.md (Mapa metodo de verificacion) y gated a F6
(config externa de Raf); no es una laguna de cobertura, es el limite honesto declarado en la spec.

## Foco de completitud/wiring (typecheck+unit NO basta)

1. Wiring real - OK. signInWithGoogle/signInWithApple estan en AuthContextValue (AuthContext.tsx:68,70) Y en
   el value del provider (AuthContext.tsx:215-216), como wrappers useCallback de los servicios platform-split
   (:180-186). Consumidos en ambas pantallas (sign-in.tsx:42,120,129; sign-up.tsx:33,71,80) por handlers
   onGoogle/onApple cableados a GoogleSignInButton/AppleSignInButton reales (sign-in.tsx:172-175,
   sign-up.tsx:156-159). Los 3 componentes exportados (components/index.ts:13-18) y renderizados. Sin imports
   muertos.
2. Platform-split - OK. google-signin solo en google-auth.native.ts:13; expo-apple-authentication/expo-crypto
   solo en apple-auth.native.ts:18-19 y AppleSignInButton.native.tsx:12. Base .ts/.tsx y .web.ts importan solo
   type/supabase/UI. Verificado por grep del dist: 0 markers nativos (no solo por lectura).
3. AuthActionResult error opcional - OK. Todos los consumidores (sign-in, sign-up, forgot-password) pasan
   result.error a authErrorMessage/isNetworkOrRateLimit (null-safe). Ningun result.error.prop directo. Password
   siempre trae error = sin cambio de comportamiento. Typecheck compila el widening.
4. Lockout intacto (R8.5) - OK. Botones sociales disabled=anyBusy (NO locked); handlers no tocan el estado de
   lockout. CTA primario sigue disabled=anyBusy or locked. auth.spec.ts verde.
5. Nonce Apple (R8.1) - OK. hash a signInAsync(nonce hashedNonce), raw a signInWithIdToken(nonce rawNonce).
   Direccion correcta.
6. Scope guard (T26) - OK. El fileset de feature 19 (21 archivos frontend) NO toca supabase/,
   app/src/services/supabase.ts, _layout.tsx ni el PowerSync connector. Los diffs en supabase/functions/ +
   supabase/migrations/0124 son de spec 18 (audit-log), otra terminal, pre-existentes al git status de
   arranque. Confirmado: supabase.ts sin diff, sin flowType.
7. Exactitud specs (codigo a spec) - OK. design.md (Deltas posteriores, Reconciliacion as-built, 9 puntos)
   describe fielmente el as-built (cancelacion v16 via isSuccessResponse, DEVELOPER_ERROR como string crudo,
   normalizacion a codes canonicos, import type en el .native, env-resolve, testID del divider, placeholders,
   verificacion del bundle). No hay specs viejas mintiendo.

## Tasks completas

Si, para el alcance F1-F5 (T1-T17, T19, T20, T25, T26 en x). Los no-x estan justificados:
- T18 [~]: subset local VERDE (typecheck + unit + e2e:build); full check.mjs deferido al leader (flake de DB
  remota). Justificado y documentado en tasks.md.
- T20 [x]: corrida del E2E deferida al reviewer; la corri, 6/6 verde.
- T21-T24.1 [ ]: GATED-RAF (F6 device gate; config externa de Raf). Explicitamente fuera de F1-F5. Justificado
  en tasks.md (Fase 6) y en context.md (ultimo gate = decision de Raf).

Sin [ ] sin justificacion en el alcance revisado.

## CHECKPOINTS

- C1: [x] harness/docs/agentes presentes. [~] full check.mjs deferido (subset frontend verde).
- C2: [x] una feature in_progress (19); current.md describe la sesion.
- C3: [x] capas respetadas (services/components/contexts/utils/screens). Deps nuevas (3) justificadas por la
  spec. Sin logs de debug. Sin establishment_id hardcodeado. Branding Google = excepcion justificada
  (design-lint-disable, R4.6). Platform-split .native/.web = patron nuevo documentado en design.md.
- C4: [x] test por modulo con logica pura (auth-errors social + env-resolve); E2E render; runner mayor a 0
  verdes. Servicios auth.native = wrappers I/O sobre libs nativas (no automatizable = QA-device). RLS N/A.
- C5: [ ] cierre de sesion (history.md + estado de feature) = pendiente del leader (correcto: la feature NO
  esta done; faltan Gate 2/2.5 + F6).
- C6: [x] 3 archivos de spec + EARS estricto + F1-F5 tasks x + cada R-n con verificacion. Los [ ] de F6 son
  GATED-RAF (feature aun no done).
- C7: N/A multi-tenant: no crea tablas/RLS; sesion OAuth = mismo JWT/auth.uid().
- C8: N/A offline-first: login = puerta de entrada (documentado en design.md seccion Offline-first).
- C9: [x] suite E2E (social-login.spec.ts) verde + capture file (social-login.capture.ts). shots no
  commiteados (solo .capture.ts). Veto visual Gate 2.5 = pendiente del leader.

## Checklist RAFAQ-especifico

- A (establishment_id / RLS): N/A. No crea/edita tablas con establishment_id; sin policies nuevas. La sesion
  OAuth produce el mismo JWT que consumen las RLS vigentes (design.md seccion Multi-tenancy).
- B (offline-first): N/A. Login = puerta de entrada, antes de que exista sesion que sincronizar; requiere red
  igual que password; falla con gracia (copy NETWORK, R6.2). Documentado.
- C (BLE): N/A. La feature no toca BLE.
- D (UI de campo / manga): N/A como UI de manga (login = puerta de entrada, no wizard de maniobra). Aun asi:
  botones sociales minHeight touchMin (56dp, mismo estandar que el CTA primario de spec 01); label fontSize
  token 5 (16px) con lineHeight token 5 (22px) matching + numberOfLines 1 = la g de Google sin descendente
  recortado (memoria descender_clipping); estado de loading visible (ActivityIndicator, googleBusy/appleBusy
  independientes). Consistente con la casa.
- E (Edge Functions): N/A. La feature no agrega Edge Functions (confirmado por Gate 1).

es-AR: copys de error en voseo (auth-errors.ts:82,86,132); labels Continuar con Google/Apple.

## Cambios requeridos

Ninguno para el alcance F1-F5.

## Gates pendientes (leader - NO bloquean esta review de F1-F5)

- Full check.mjs verde antes de cerrar (deferido por flake de DB remota).
- Gate 2 (security_analyzer modo code): verificar R8.9 sobre el diff (no-log de tokens); ya pre-verificado por
  grep aca (0 console), pero es gate formal.
- Gate 2.5 (ADR-029): veto visual de las capturas (social-login.capture.ts): branding Google sin recolorear +
  sin recorte de descendentes.
- F6 / T21-T24.1 (GATED-RAF): QA device + config del Dashboard de Supabase (Authorized Client IDs,
  skip_nonce_check false, verified-email linking, Redirect URLs, enable_confirmations true): criterios
  fail-closed de Gate 1 (M1/M2). El anti-takeover (R8.4) depende de esa config.
