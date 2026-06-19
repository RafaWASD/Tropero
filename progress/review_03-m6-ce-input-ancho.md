# Review — spec 03 M6 — FIX RECORTE del campo hero de Circunferencia Escrotal (🔴 manga)

Revisión ACOTADA al diff del fix de ancho (auto-fit medido) del campo editable de CE.
NO re-revisa todo M6.

## Veredicto: CHANGES_REQUESTED

Un (1) bloqueante: el propio diff introduce 2 violaciones de anti-hardcode (ADR-023 §4)
que dejan `node scripts/check.mjs` en ROJO. Regla dura: no se aprueba con check.mjs rojo.
El resto del fix está sólido (lógica, tests, specs, no-regresión, fail-safe).

---

## Bloqueante (B1) — check.mjs ROJO por anti-hardcode introducido en este diff

`scripts/check-hardcode.mjs` (ADR-023 §4) marca 2 violaciones de SPACING en el `<RNText>`
medidor oculto, ambas NUEVAS de este diff (en HEAD el campo usaba
`width: getTokenValue('$stepperBtn','size')`, sin left/top):

- `app/app/maniobra/_components/CircunferenciaEscrotalStep.tsx:314` — `left: 0` (número crudo).
- `app/app/maniobra/_components/CircunferenciaEscrotalStep.tsx:315` — `top: 0` (número crudo).

`top`/`left` están en la lista de SPACING_PROPS del linter (check-hardcode.mjs:90/92) y la
regex `spacingPropRe` matchea `prop: <dígito>` sin token ni disable-comment → exit 1 → check.mjs
FAIL ("Lint anti-hardcode rojo (exit 1)").

Verificado: corrí `node scripts/check.mjs` → único rojo de FRONTEND = estas 2 líneas
(el rojo del Animal backend suite `animals_tag_unique` es el flake de colisión cross-terminal
con spec-08, ajeno; los client unit tests, incl. wheel-picker.test.ts 31/31, pasan ANTES y verdes).

Fix (lo resuelve el implementer, no el reviewer): es un anclaje de posición absoluta de un
medidor off-screen, no spacing de diseño → o se justifica con
`// design-lint-disable-next-line -- anclaje de medidor absoluto off-screen, no spacing de DS`
en cada una, o se usa `getTokenValue('$0','space')` / se quitan (un `position:absolute` ya
ancla en 0,0 por defecto). Decisión del implementer; lo que importa: check.mjs verde.

> Nota de proceso: la autorrevisión del implementer (impl_03-m6-ce-input-ancho.md §Verificación)
> declara "anti-hardcode 0" en el run anterior pero NO re-corrió el linter tras agregar el medidor
> con left:0/top:0 — por eso se le escapó. El `check.mjs` lo cazó.

---

## Foco pedido — los 7 puntos

1. **Requisito duro (ningún valor del rango se recorta, 360/412, reposo y editando)** — CUMPLE.
   - `widestCmDisplay()` deriva el peor caso "XX,X" del rango REAL (no hardcode); verificado a mano
     → "20,5" (4 glifos), y todos los .5 del rango son 4 glifos (los más anchos). El input se
     dimensiona a ese ancho medido + buffer.
   - El e2e MIDE overflow real (no "no crashea"): `ceInputOverflow` lee `scrollWidth`/`clientWidth`
     del `<input>` nativo de rn-web y asserta `clipped=false` (scrollWidth ≤ clientWidth + 1px)
     para 40,5/49,5/50/20/20,5 en REPOSO + draft 49,5 ENFOCADO, a 412 y 360
     (`maniobra-circunferencia-escrotal.spec.ts:467-535`). Es la prueba correcta del recorte.

2. **Ancho estable al peor caso (no salta de ancho)** — CUMPLE.
   `fieldWidth` se deriva de `measuredWidth` del medidor que SIEMPRE renderiza `widest` (constante,
   memoizado), NO del valor actual → ancho constante para todos los valores. El medidor es
   `position:absolute + opacity:0 + pointerEvents:none + accessibilityElementsHidden +
   importantForAccessibility="no-hide-descendants"` → no se ve, no intercepta toques, no se anuncia,
   no ocupa layout (CircunferenciaEscrotalStep.tsx:305-319).

3. **Fallback fail-safe** — CUMPLE. `measuredWidth` arranca 0; `onMeasure` solo setea si `w>0`
   (línea 287). Mientras 0, `fieldWidth = fallbackWidth = ceil(widest.length*heroSize*0.62)+12`
   = 122px (verificado), holgado por encima del peor caso real (~92px) → NUNCA recorta. Si onLayout
   nunca dispara, queda en 122 (ancho conservador, no chico). Correcto.

4. **maxLength** — CUMPLE. `CE_DRAFT_MAXLENGTH=5` ("XX,X"=4 + 1 holgura). El e2e prueba que "499,55"
   queda ≤5 chars (línea 519-521). `sanitizeCmTyping` (un solo separador) y `parseCmInput` (clamp
   [20,50] + grilla 0,5) siguen haciendo la validación dura en el commit — maxLength solo acota el
   ANCHO del draft en vuelo, no reemplaza el clamp. Sin interferencia.

5. **No-regresión** — CUMPLE. El `<TextInput>` queda SIEMPRE montado (no swap Text↔Input); sincronía
   bidireccional (display = focused?draft:formatCmAR(value)), commit por blur/submit, selectTextOnFocus,
   snap-lock, sheet de edad, "cm"+ícono dentro de la caja, número hero $wheelHero=44 (no achicado,
   sin adjustsFontSizeToFit), caja `alignSelf:center` sin width 100% (no bleed web) — todo intacto.
   Los 4 e2e previos (torito/skip/castrado/SNAP) siguen en el archivo.

6. **Pureza/tests** — CUMPLE. `widestCmDisplay` es puro (sin RN) y testeado (3 tests nuevos en
   wheel-picker.test.ts: peor caso "XX,X", valor real del rango, cubre 40,5/49,5). El pixel-width
   medido en runtime es inevitablemente impuro y queda fuera del helper (correcto). No usa
   adjustsFontSizeToFit (NO-OP web); input con width explícito (no flex) → no se estira.

7. **Specs as-built** — CUMPLE. design.md §12.2 suma el bullet "AS-BUILT M6 — BUGFIX de RECORTE
   del campo hero (2026-06-19)" describiendo el auto-fit medido. tasks.md M6-C.1 suma la nota `>`
   "FIX RECORTE". El comentario inline mentiroso del 88 ("88 — entra 40,5…") quedó ELIMINADO (en
   HEAD estaba en línea 285; ya no existe en el archivo). requirements.md sin cambios (R14.5 EARS no
   asserta ancho; el *qué* no cambió) — consistente.

---

## Trazabilidad R<n> ↔ test

- **R14.5 (captura 🔴 manga legible — no-recorte del valor)** ↔
  - `wheel-picker.test.ts`: `widestCmDisplay: devuelve un "XX,X" (4 glifos)…`
  - `wheel-picker.test.ts`: `widestCmDisplay: el resultado es un valor REAL formateado del rango…`
  - `wheel-picker.test.ts`: `widestCmDisplay: cubre los valores que Raf reportó recortados (40,5 / 49,5…)`
  - `maniobra-circunferencia-escrotal.spec.ts`: `ANTI-RECORTE: ningún valor de CE se recorta… 360 y 412`
    (mide scrollWidth ≤ clientWidth en reposo + draft + maxLength).
- No-regresión R14.5/R14.6/R14.7 ↔ los 4 e2e CE preexistentes (torito/skip/castrado/SNAP).

Cobertura completa: cada aspecto del fix tiene ≥1 test concreto.

## Tasks completas: sí
M6-C.1 sigue [x]; las notas de fix (`>`) son reconciliación as-built, no tasks abiertas.
No quedan `[ ]` sin justificar en el scope del diff.

## CHECKPOINTS: N/A para un bugfix acotado (no hay checklist nuevo de feature; M6 ya cerrado).

## Checklist RAFAQ-específico
- A (RLS / establishment_id): N/A — sin superficie de DB.
- B (offline-first): N/A — bugfix de layout puro, no toca repos/sync.
- C (BLE): N/A.
- D (UI de campo): aplica parcialmente — botón Confirmar/target ≥ touchMin OK; fuente hero 44pt;
  número grande no achicado; loading N/A. Sin regresión de manga.
- E (Edge Functions): N/A.

---

## Cambios requeridos (concretos)

1. [B1] `app/app/maniobra/_components/CircunferenciaEscrotalStep.tsx:314` y `:315` —
   `left: 0` / `top: 0` son números crudos en SPACING_PROPS → anti-hardcode rojo.
   Resolver (disable-comment justificado o token `$0`) y re-correr `node scripts/check.mjs`
   hasta VERDE (sin el flake backend). El implementer DEBE re-correr el linter tras el cambio
   (la autorrevisión previa no lo re-corrió con el medidor agregado).

## Nits (no bloqueantes)
- `impl_03-m6-ce-input-ancho.md:58-59` declara "anti-hardcode 0" — quedó desactualizado respecto del
  medidor agregado; reconciliar al re-correr.
- Las capturas del e2e (ce-input-ancho-*) se tomaron en chromium Desktop sin hasTouch — aceptable
  porque el recorte es de layout/render, no de touch (documentado en el impl §Riesgos). OK.
