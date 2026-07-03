# Security Gate 2 (modo `code`) — delta TAP-TO-SELECT en la rueda inercial (#16, spec 03)

**Veredicto: PASS**

Delta **frontend-only** de interacción de UI (tapear una celda del `WheelPicker` la selecciona: anima + snap + `onValueChange`). Sin backend, sin red, sin input de texto libre, sin secretos/PII. Superficie de seguridad mínima. Cero findings HIGH.

- **baseline_commit**: `f3080ebe1a57bcfd604fbbf89c9c188e95ef3540` (== HEAD; todos los cambios sin commitear en el working tree).
- **Diff analizado**: `git diff <baseline>..HEAD` + `git status --porcelain` (untracked in-scope).
- **Gate 1 (backend)**: N/A este run — `git diff supabase/` **vacío** (verificado).

---

## Findings HIGH de Sentry (`sentry-skills:security-review`)

**Ninguno.** No high-confidence vulnerabilities identified.

La skill trazó el data flow del delta y no encontró ningún sink peligroso alcanzado por input attacker-controlled. Detalle del trace abajo.

## Findings RAFAQ-SPECIFIC

**Ninguno.** El delta no toca ninguno de los dominios del catálogo RAFAQ:
- Sin `createAdminClient()` / service-role (A1) — no hay backend.
- Sin `.insert(body)`/`.update(body)` ni mass assignment (A2) — no hay escritura a DB.
- Sin IDOR/FK (A3), sin authz de función (A4) — no hay endpoint ni RPC.
- Sin `err.message` al cliente (B1), sin logs de PII (B2), sin over-fetch (B3) — no hay respuesta de servidor ni logging nuevo.
- Sin sync rules / Realtime / data-at-rest (C) — el delta no toca PowerSync ni persistencia.
- Sin secretos, imports nuevos ni supply chain (D) — un único import agregado es local (`tapTarget` de `wheel-picker.ts`) + `Pressable`/`buttonA11y` ya en el repo.
- Sin queries, email/SMS, captcha, enumeration (E) — no hay costo por request ni superficie de abuso.
- Sin inyección/ingesta/SSRF (F) — no hay `.or()/.filter()`, ni `fetch()`, ni parsing de archivos, ni prompt LLM.
- Sin trust boundary BLE (G) — el tap es un `Pressable` de UI; no persiste nada por sí solo (el valor solo alimenta el `onValueChange` controlado, mismo camino que el drag ya auditado).
- Sin auth/sesión (H), sin compliance/mobile hardening nuevo (I).

## Data flow trace (evidencia del PASS)

Superficie nueva = un `Pressable` por celda + `handleCellTap` + helper puro `tapTarget`. Trazado extremo a extremo:

1. **Origen del "input" del tap** — `WheelPicker.tsx:352` `values.map((v, i) => …)` con `values = wheelValues(spec)` (`:157`), un array FIJO derivado del `WheelSpec` (rango cerrado `[min,max]` con paso fijo: CE 20–50/0,5 o meses 6–120/1). El "input" del tap es `i`, el índice del `.map` — **acotado por construcción a `[0, values.length-1]`**, no viene del usuario como valor libre ni como coordenada.
2. **`handleCellTap(tappedIndex)`** (`WheelPicker.tsx` ~`:305`) → `tapTarget(offsetY.value, tappedIndex, cell, spec)`.
3. **`tapTarget`** (`wheel-picker.ts:174`) **re-clampa** el índice: `Math.min(wheelCount(spec)-1, Math.max(0, Math.round(tappedIndex)))` y devuelve `value = indexToValue(index, spec)` — que **vuelve a clampar y snapea a la grilla** (`indexToValue` `:90`, `roundStep`). Función PURA, sin red/DB/eval, 8 tests que asertan `index/offset/value/isCentral`.
4. **Sink** — el `value` resultante va a `notifyIndex → onValueChange` (callback local controlado, el MISMO que el drag) y a `scrollTo` (animación local). No hay otro sink: ni HTML (`dangerouslySetInnerHTML`/`innerHTML` inexistentes en RN), ni SQL, ni `fetch`, ni `eval`, ni file, ni storage.

**Conclusión del trace**: cualquier valor que escape del delta hacia un consumidor está garantizado dentro de `[min,max]` y snapeado a la grilla, por doble clamp (`tapTarget` + `indexToValue`). No hay forma de inyectar un valor arbitrario, texto libre, ni de alcanzar un sink sensible.

### A11y label — verificado no-sink
`buttonA11y(Platform.OS, { label: \`Seleccionar ${label}\` })` con `label = formatValue(v)` (`:355`), un formateador numérico (`formatCmAR`/`formatMonthsNum`). Es un string numérico de un set fijo, no texto de usuario, y `accessibilityLabel` no es un sink de inyección en React Native (react-native-web lo emite como `aria-label` DOM-escapado). No explotable.

## False positives descartados

La skill no levantó findings, así que no hubo que descartar ninguno. Se documentan las clases que un pattern-match ingenuo podría marcar y por qué NO aplican:
- **Template string en JSX/props** (`\`Seleccionar ${label}\``, `\`${testID}-cell-${i}\``) → no es sink HTML; `label`/`testID`/`i` son numéricos/constantes controlados por el componente. No XSS (RN no tiene innerHTML; los valores no son attacker-controlled).
- **`scrollTo({ y: t.offset })`** → `offset` es múltiplo exacto de `cell` derivado del índice clampeado; no es navegación/redirect ni URL. No open-redirect.

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| tap sobre celda (índice `i` de la rueda) | set FIJO `wheelValues(spec)`; índice acotado a `[0, n-1]` | server/DB: n.a. (frontend puro); **doble clamp determinístico** en `tapTarget` + `indexToValue` (grilla `[min,max]`, paso fijo) | Sí |

No hay campos de texto libre, buscadores ni prompts en el delta. El único "input" es la elección de un índice de un conjunto discreto y acotado.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| (ninguna acción abusable) | n.a. | n.a. | n.a. | El tap solo mueve la rueda + dispara un callback local (`onValueChange`). Sin red, RPC, email/SMS, API externa, bulk ni storage → no hay superficie de rate limiting. |

## Archivos analizados

- `app/app/maniobra/_components/WheelPicker.tsx` — `WheelCell` en `Pressable` (`onPress → onTap(index)`, `testID`, `buttonA11y`) + `handleCellTap`.
- `app/src/utils/wheel-picker.ts` — helper puro `tapTarget` (+ `WheelTapTarget`).
- `app/src/utils/wheel-picker.test.ts` — 8 tests de `tapTarget` (test file).
- `app/e2e/maniobra-tap-wheel.spec.ts` — regresión E2E del tap (test file).
- `app/e2e/captures/tap-wheel.capture.ts` — capture Gate 2.5 (test file).

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: no aplica — sin cambios en `supabase/` (verificado).
- **RLS / migrations**: no aplica — sin cambios de schema ni policies.
- **PowerSync / Realtime**: no aplica — el delta no toca sync rules ni canales; el valor del picker no persiste por sí solo.
- **React Native / Reanimated**: cubierto por revisión manual del data flow (la skill de Sentry cubre JS/React de forma indirecta; el patrón `Pressable`+worklet no introduce sink). Sin hallazgos.

---

**Resultado**: PASS. Delta de UI pura sobre un number-picker, sin superficie de seguridad explotable. Sin findings HIGH ni RAFAQ-SPECIFIC.
