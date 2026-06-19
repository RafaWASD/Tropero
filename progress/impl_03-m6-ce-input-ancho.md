baseline_commit: 81bd66fd08bbc3706fdfc96e18118fd31b6421d1

# impl 03 M6 — FIX RECORTE del campo hero de Circunferencia Escrotal (🔴 manga)

Bug 🔴 manga-crítico reportado por Raf: el input de la CE recorta los valores anchos
("40,5"/"49,5") por ambos lados. Captura: `tests/modo-maniobra/40,5-sale-recortado.png`.

## Causa raíz (confirmada contra el código + la captura)
`CircunferenciaEscrotalStep.tsx` → `CmInputField`: el `<TextInput>` hero tenía `width: $stepperBtn`=88px
FIJO con `fontSize: $wheelHero`=44 Inter bold. "40,5"/"49,5" (4 glifos) miden ≈92-100px > 88px → con
`textAlign:'center'` el número se cortaba de AMBOS lados. El comentario inline ("88 — entra 40,5 sin
estirar la caja") era FALSO. Verificado visualmente en la captura de Raf (el "4" izq y el "5" der recortados).

## Mecanismo elegido — Opción A (auto-fit MEDIDO) + por qué
Elegí Option A (auto-fit medido) sobre Option B (Text↔Input swap) porque:
- Mantiene el `<TextInput>` SIEMPRE montado → cero riesgo en el handoff de foco, `selectTextOnFocus`,
  la sincronía bidireccional campo↔rueda y el commit (paths ya lockeados/testeados en M6-C.1/snap-lock).
  Option B introducía un swap de nodos en foco — más superficie para romper esos paths.
- El ancho sale de una MEDICIÓN REAL en runtime (no un magic number): determinístico por device/fuente.

Cambios:
1. **`app/src/utils/wheel-picker.ts`** — nueva util PURA `widestCmDisplay()`: recorre `wheelValues(CE_WHEEL)`
   + `formatCmAR` y devuelve el string MÁS ANCHO del rango ("XX,X", 4 glifos). Deriva el peor caso del rango
   REAL (no se hardcodea "40,5"). Desempate a igual largo = menos comas (más dígitos = más ancho con glifos
   tabulares de Inter; defensivo, no se gatilla en la grilla de CE actual). Atada a `CE_WHEEL` a propósito
   (`formatCmAR` clampa/snapea a CE).
2. **`CircunferenciaEscrotalStep.tsx`** (`CmInputField`):
   - `<Text>` MEDIDOR oculto (`position:absolute`, `opacity:0`, `pointerEvents:none`, `onLayout`) que
     renderiza `widestCmDisplay()` a la MISMA fuente hero (factoricé `heroTextStyle()` para que medidor e
     input compartan exactamente fontSize/lineHeight/familia/peso) → reporta el ancho REAL en px.
   - `fieldWidth = measuredWidth + CE_FIELD_BUFFER(12)` una vez medido; hasta entonces, fallback conservador
     `ceil(widest.length * heroSize * 0.62) + buffer` (≈122px, holgado) para no recortar en el 1er frame.
   - `maxLength={CE_DRAFT_MAXLENGTH=5}` en el `<TextInput>` → el draft tipeado no desborda mientras se
     escribe ("XX,X"=4, +1 de holgura; el clamp/grilla dura sigue en `parseCmInput` al commitear).
   - Corregido el comentario mentiroso del 88; el número sigue grande (NO se achicó); caja sigue
     hugging-content centrada (`alignSelf:center`, sin width 100% → no bleed en web); "cm" + ícono adentro.

As-built medido en web (diagnóstico transitorio, ya removido): `clientWidth=104px` para TODOS los valores
(40,5/49,5/50/20/20,5) a 360 y 412, con `scrollWidth === clientWidth` (overflow CERO). El medidor SÍ fira
(104 ≠ fallback 122) → el path determinístico medido está activo. 104 vs el viejo 88 = compacto pero sin
recorte (el peor caso ≈92px entra con margen).

NO se tocó: la rueda, la sincronía bidireccional campo↔rueda, el sheet de edad, ni el lock del snap.

## Trazabilidad R<n> → test
El requisito de fondo es R14.5 (capturar la CE de forma 🔴 manga legible). El bug era un defecto contra esa
intención (no un cambio de contrato). Cobertura:
- **R14.5 (no-recorte, legibilidad del valor)**
  - `app/src/utils/wheel-picker.test.ts::widestCmDisplay: devuelve un "XX,X" (4 glifos)…` — el peor caso del rango.
  - `…::widestCmDisplay: el resultado es un valor REAL formateado del rango…` — no es literal inventado.
  - `…::widestCmDisplay: cubre los valores que Raf reportó recortados (40,5 / 49,5…)` — los valores de la captura.
  - `app/e2e/maniobra-circunferencia-escrotal.spec.ts::ANTI-RECORTE: ningún valor de CE se recorta…` —
    40,5/49,5/50/20/20,5 en REPOSO + draft 49,5 ENFOCADO + maxLength, a 360 y 412, assert `scrollWidth ≤ clientWidth`.
- **No-regresión de R14.5/R14.6/R14.7** (campo editable, sincronía, snap-lock, edad): los 4 tests
  preexistentes del spec CE siguen verdes (flujo torito + skip hembra/ternero + castrado + SNAP).

## Verificación
- Unit puro (CE): `wheel-picker.test.ts` 31/31 verde (los +3 nuevos de `widestCmDisplay`).
- Broad client unit (655 tests, sin DB): 655 pass / 0 fail.
- typecheck cliente: 0 errores (`tsc --noEmit`).
- Anti-hardcode (`scripts/check-hardcode.mjs`, ADR-023 §4): **0 violaciones** TRAS el fix del medidor
  (2026-06-19). El reviewer detectó que el `<RNText>` medidor oculto traía `left:0`/`top:0` crudos que el
  linter matcheaba como spacing hardcodeado; se ELIMINARON (un `position:absolute` ya ancla top-left por
  defecto, así que eran redundantes — el medidor sigue off-screen por `opacity:0` + `pointerEvents:none` +
  a11y hidden, y `onLayout` mide igual el ancho). NOTA: en la corrida original NO se había re-corrido el
  linter tras agregar el medidor; el "anti-hardcode verde" recién es veraz a partir de este fix.
- e2e `maniobra-circunferencia-escrotal.spec.ts`: **5/5** verde (los 4 previos + ANTI-RECORTE). Re-corrido
  tras eliminar `left:0`/`top:0`: el ANTI-RECORTE sigue verde (el medidor no se movió, ancho medido ~104px,
  overflow CERO) → confirmado que el anclaje crudo era redundante.
- Capturas peor caso entrando COMPLETO:
  - `tests/modo-maniobra/ce-input-ancho-40,5-360.png`
  - `tests/modo-maniobra/ce-input-ancho-40,5-412.png`
  - `tests/modo-maniobra/ce-input-ancho-49,5-360.png`
  - `tests/modo-maniobra/ce-input-ancho-49,5-412.png`
- `node scripts/check.mjs`: el ÚNICO rojo es el flake conocido `animals_tag_unique` del Animal suite
  (spec 02, backend) por colisión con la otra terminal (spec-08 SIGSA) en la DB compartida — ajeno a este
  fix (frontend-only). Los client unit tests (que incluyen `wheel-picker.test.ts`) corren ANTES en
  run-tests.mjs y pasaron; el rojo es en una suite backend posterior.

## Autorrevisión adversarial (paso 8)
Probé el PEOR caso, no "36,5". Qué busqué / qué encontré / cómo cerré:
- ¿"49,5" entra a 360? SÍ — captura `ce-input-ancho-49,5-360.png` + `scrollWidth(104) ≤ clientWidth(104)`.
- ¿El draft mientras tipeás "49,5"? SÍ — el e2e asserta el draft enfocado sin overflow a 360 y 412.
- ¿"cm" y el ícono adentro? SÍ — confirmado en las 4 capturas (no empujados afuera ni recortados).
- ¿El número sigue grande? SÍ — `$wheelHero`=44 intacto, NO usé `adjustsFontSizeToFit` (NO-OP web).
- ¿Caja centrada sin bleed en web? SÍ — `alignSelf:center`, sin width 100%.
- ¿Algún valor del rango al borde? Verifiqué los extremos (20/20,5/50) + el peor caso (40,5/49,5): todos
  `scrollWidth === clientWidth` (cero overflow), no "al borde".
- ¿El medidor realmente fira o uso el fallback? Confirmé con diagnóstico (clientWidth=104 ≠ fallback 122)
  → el path medido está activo; y el fallback es de todos modos seguro (122 > 92 del peor caso real).
- ¿maxLength rompe el tipeo cómodo o `sanitizeCmTyping`/`parseCmInput`? No — 5 chars permiten "XX,X" + 1 de
  holgura; intentar "499,55" queda acotado a 5 (verificado en el e2e), `parseCmInput` snapea en el commit.
- ¿`pointerEvents` del medidor / a11y? El medidor es `pointerEvents:none` + `accessibilityElementsHidden` +
  `importantForAccessibility="no-hide-descendants"` → no tappable, no anunciado, no roba foco.
- Edge: ¿el `onLayout` puede reportar 0 y romper? Sí lo contemplo — `setMeasuredWidth` solo si `w>0`, y
  `fieldWidth` cae al fallback mientras `measuredWidth===0` → nunca width 0/recorte.

## Reconciliación de specs (memoria feedback_correcciones_en_specs)
El *qué* (R14.5) no cambió — el campo sigue siendo un hero editable legible; el bug era un defecto contra
esa intención. Cambió el *cómo* (ancho fijo → auto-fit medido). Reconcilié:
- `design.md §12.2` — nuevo bullet "AS-BUILT M6 — BUGFIX de RECORTE del campo hero (2026-06-19)" con el
  mecanismo y el comentario 88 corregido (no reescribí el historial del fix-loop v2).
- `tasks.md` M6-C.1 — nota `>` "FIX RECORTE del campo hero" (mismo idiom que la nota SNAP/LOCK).
- `requirements.md` — sin cambios (el EARS R14.5 no asserta ancho; el *qué* no cambió → no se anota).
- Comentario inline mentiroso del código corregido.
- NO toqué: feature_list.json, specs/done, ni archivos de coordinación de la otra terminal.

## Riesgos residuales
- La medición por `onLayout` es la fuente de verdad en web/native; en el (improbable) caso de que un device
  no dispare `onLayout` del `<Text>` oculto, el campo cae al fallback conservador (≈122px) → más ancho de lo
  necesario pero NUNCA recortado (fail-safe correcto). No es un riesgo de recorte.
- El buffer de 12px y el factor 0.62 del fallback son holguras de input, no tamaños del valor (ese sale de la
  medición). Si en el futuro cambia la fuente hero a una NO-tabular, el medidor lo absorbe (mide la fuente
  real); el desempate por comas de `widestCmDisplay` ya cubre el caso glifos-proporcionales.
- Capturas tomadas en project chromium Desktop (sin hasTouch). El recorte es de layout/render, no de touch —
  Desktop es representativo para esto (el touch solo afecta tap-through, no medido acá).
