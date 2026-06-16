# Security code review — 03-bugfix-config-sheet (Gate 2, ADR-019)

**Veredicto: PASS**

Bugfix de TIMING de UI (frontend puro). Guard del backdrop de un bottom sheet contra un
"click huérfano" emulado por el browser en web táctil. NO agrega inputs nuevos, NI escrituras,
NI auth/authz, NI cambios de tenant/RLS, NI llamadas de red, NI secrets. La superficie de
seguridad introducida por el diff es nula. Skill `sentry-skills:security-review` corrida sobre
los 3 archivos del alcance: sin findings HIGH-confidence.

## Alcance analizado

`baseline_commit` registrado en `progress/impl_03-bugfix-config-sheet.md` = `edac670`, que
coincide con HEAD. Trabajamos sobre `main` sin feature-branches y spec 03 entera está sin
commitear, así que `git diff edac670..HEAD` da vacío y los 3 archivos figuran como **untracked**
(la carpeta `app/app/maniobra/` es nueva respecto al baseline). Por eso el review se hace sobre
los 3 archivos del alcance declarado del bugfix, leídos completos, no sobre un diff git.

Archivos:
- `app/app/maniobra/_components/ManeuverConfigSheet.tsx` — el FIX: guard `readyToDismissRef`
  (`useRef(false)`) armado en el próximo frame vía doble `requestAnimationFrame` (fallback
  `setTimeout(0)`); el `onPress` del scrim (`onBackdropPress`) hace `if (!ready) return;` antes
  de `onClose()`. Cleanup cancela rAF/timer en unmount.
- `app/app/maniobra/_components/DientesStep.tsx` — REVERT del mismo guard en `CutPromptSheet`;
  quedó solo una nota explicando por qué su scrim no lo necesita. No introduce nada nuevo.
- `app/e2e/maniobra-config-sheet-race.spec.ts` — NUEVO test Playwright (context táctil) que
  reproduce el race. Archivo de test.

## Findings HIGH de Sentry

Ninguno. La skill no identificó vulnerabilidades de alta confianza en los 3 archivos.

Trazado de cada superficie potencial (data flow + exploitability):

- **Guard de timing (el fix)**: `useRef` + `useEffect` + `requestAnimationFrame` /
  `cancelAnimationFrame` / `setTimeout` / `clearTimeout`. Cero input attacker-controlled, cero
  `eval`/`exec`, cero concatenación en queries, cero secrets. El guard solo RESTRINGE el path de
  cierre del backdrop por ~2 frames; no abre ningún path nuevo. Falla "cerrado" en el sentido
  correcto para un dismiss (si el ref no se arma, el backdrop simplemente no cierra; las salidas
  legítimas —Cancelar, Guardar— no pasan por el guard). Cleanup cancela rAF/timer → sin leak ni
  callback tras unmount.
- **`TextInput` (`typed`) → `onSave`**: es texto libre del usuario, PERO (a) no es parte del diff
  del bugfix —ya existía y se gateó en el chunk M1.4—; el fix solo agrega el guard del scrim, no
  toca el input ni su persistencia. (b) Su salida pasa por `joinMultiPreconfig` /
  `splitMultiPreconfig` (`app/src/utils/maneuver-wizard.ts`): helpers PUROS (trim + dedup +
  split/join por coma), sin concatenación SQL ni HTML. (c) RN `Text`/`TextInput` auto-escapan; no
  hay `dangerouslySetInnerHTML` ni `innerHTML`. (d) El valor se persiste como `config.preconfig[...]`
  (jsonb vía PostgREST/PowerSync, parametrizado).
- **`DientesStep`**: el `onConfirm(value, cut)` recibe `value` del enum constante `TEETH_OPTIONS`,
  no input libre. El cambio es un revert → sin superficie.
- **Tokens / `getTokenValue` / `Platform.OS` / a11y**: todo constante / server-controlled.

## Findings RAFAQ-SPECIFIC

Ninguno.

- **RLS / Edge Functions / triggers**: el diff no toca DB, migrations ni edge functions.
- **service-role / `createAdminClient()`**: no aparece en el diff de app. El `service_role` vive
  solo en `app/e2e/helpers/admin.ts` (Node, fixtures) y NUNCA en el bundle del browser; ese helper
  además NO fue tocado por este chunk (el nuevo spec solo lo importa para sembrar infra de test).
- **Mass assignment / `.insert(body)`**: n.a. — el diff no hace escrituras a DB.
- **Information disclosure (`err.message` crudo al cliente)**: n.a. — el diff no maneja errores de
  red/DB hacia el cliente.
- **Secrets**: ninguno hardcodeado; ningún `console.log` de secretos (el logging diagnóstico se
  removió, confirmado en `impl_03-bugfix-config-sheet.md`).

## False positives descartados

La skill no levantó findings que haya que descartar. Patrones que un escaneo ingenuo podría
marcar y por qué NO aplican:
- `setTimeout`/`requestAnimationFrame` → no es timing-attack ni race explotable; es UI scheduling
  para diferir el armado de un guard. No hay recurso compartido sensible.
- `TextInput` de texto libre → no es parte del diff y su sink es un helper puro + jsonb
  parametrizado (ver arriba).
- `Pressable onPress=onClose` en el scrim → el fix lo ENDURECE (gating), no lo afloja.

## Tabla de inputs

| campo | límite | validación (server/solo-cliente/ausente) | OK? |
|---|---|---|---|
| (ninguno introducido por el diff) | n.a. | n.a. | n.a. |

El `TextInput` de preconfig (vacuna/pajuela) NO es parte de este bugfix —pertenece al chunk M1.4 y
se revisó en su Gate 2 correspondiente. El diff solo agrega el guard de timing del scrim.

## Tabla de rate limits

| acción | rate limit (sí/no/n.a.) | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| (ninguna acción abusable tocada) | n.a. | n.a. | n.a. | El diff no manda email/SMS, no pega a APIs externas, no es bulk, no expone endpoint. |

## Archivos analizados

- `app/app/maniobra/_components/ManeuverConfigSheet.tsx` (leído completo)
- `app/app/maniobra/_components/DientesStep.tsx` (leído completo)
- `app/e2e/maniobra-config-sheet-race.spec.ts` (leído completo)
- Contexto (no en el alcance del diff, leídos para trazar data flow / descartar exposición):
  `app/src/utils/maneuver-wizard.ts` (helpers puros), `app/e2e/helpers/admin.ts` (service_role
  solo en infra de test, no en browser).

## Cobertura indirecta de Deno / RLS / PowerSync / BLE / RN

La skill `sentry-skills:security-review` está orientada a patrones web/backend; NO cubre de
primera mano Deno edge functions, RLS policies, sync rules de PowerSync, ni el trust boundary BLE.
**Para este bugfix da igual**: el diff es React Native puro de UI y no toca ninguno de esos
dominios. Revisión manual del catálogo RAFAQ (dominios A–I): ninguno aplicable al cambio.

## check.mjs

RC del comando: **rojo por flake conocido**, no por regresión del bugfix.
- typecheck client: **OK**
- anti-hardcode (ADR-023 §4): **0 violaciones**
- client unit tests: **1284 pass / 0 fail**
- RLS tests: **22 pass / 0 fail**
- suite **edge**: roja con `Request rate limit reached` en `signIn(...)` / `getUserClient` —
  flake de auth de Supabase por terminales en paralelo (memoria `reference_check_red_rate_limit.md`,
  cascada `signIn ... Request rate limit reached`). El bugfix es frontend puro y no toca edge
  functions; el fallo es de infra de auth del harness, no del código revisado. **No es finding.**

No marco `done`. Decisión final del humano (Gate 2 / puerta de aprobación).
