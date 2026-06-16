# impl_03-bugfix-silent-product-truncado — BUG: nombre de producto hero TRUNCADO/overflow en web (silent_apply)

baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

Feature en curso: **03-modo-maniobras** (in_progress). Bugfix de frontend puro (NO backend) sobre
`SilentSanitaryStep.tsx` (paso silent_apply de Antiparasitario / Antibiótico / Inseminación-single del
wizard de MODO MANIOBRAS).

## SÍNTOMA (Raf, testing en vivo `pnpm web`)
Un nombre de producto largo se renderiza TAN grande (hero `$11`=64px) que se corta/overflowea horizontal
saliéndose de la pantalla por ambos lados. Evidencia: `tests/modo-maniobra/antibiotico-cortado.png`
("Ivermectinaaaaaa…" gigante, cortado por ambos lados).

## CAUSA (ya diagnosticada por el leader, confirmada por lectura)
El hero del producto (L201-214) usa `fontSize="$11"` (64px) + `adjustsFontSizeToFit` + `minimumFontScale={0.5}`.
`adjustsFontSizeToFit` es **NO-OP en react-native-web** (gotcha conocido del repo) → el texto NO se encoge →
overflow horizontal. `$11` es apropiado para 1 carácter (condición corporal), NO para un NOMBRE de longitud
variable.

Diferencia clave vs el bugfix de CondicionCorporal: CC tiene un valor de **longitud fija acotada** ("4,00",
4-5 chars) → se resolvió fijando el layout full-width. Acá el nombre es **texto libre de longitud arbitraria**
→ hace falta un **step-down length-aware** (emular adjustsFontSizeToFit por buckets de longitud, web-safe) +
**wrap/break** para el caso patológico sin espacios.

## PLAN (tasks)
- T1: Helper PURO `heroFontTokenForName(name)` en util nuevo → bucket de longitud de string → token de
  fontSize ($-token) con su lineHeight matching. Criterio: nombre típico de vet entra COMPLETO y GRANDE;
  nombre largo entra completo más chico. + tests node:test (tabla de longitudes → token esperado, bordes de
  bucket, vacío). Cero hardcode (tokens de la escala Inter).
- T2: Aplicar el helper en el hero de `SilentSanitaryStep.tsx`: quitar `adjustsFontSizeToFit` +
  `minimumFontScale`; fontSize/lineHeight del helper; wrap + word-break (`overflowWrap`/`wordBreak`
  'break-word'/'anywhere' en web) para el caso patológico sin espacios; `numberOfLines` con elipsis como
  ÚLTIMO recurso (preferir que ENTRE partiendo en líneas). lineHeight matching (regla descenders).
- T3: Verificación web Playwright (360 Y 412): corto / medio / largo / patológico — ninguno overflowea
  horizontal; típicos entran completos y grandes. Capturas entregables en `tests/modo-maniobra/`.
- T4: Reconciliar `design.md` (as-built del hero del silent_apply) + nota de reconciliación si aplica.

## NOTA SOBRE check.mjs (baseline)
Al arrancar, `node scripts/check.mjs` da ROJO en las suites backend `edge` por **`Request rate limit
reached`** + cascada de `Cannot read properties of undefined (reading 'functions')` — el flake de auth de
Supabase por terminales paralelas documentado en la memoria del repo (`reference_check_red_rate_limit`), NO
una regresión. Mi cambio es frontend puro (un componente Tamagui + un helper puro) y no toca backend. La
verificación real de este bugfix es el e2e de maniobras + el unit del helper.

## QUÉ SE CAMBIÓ
- **`app/src/utils/hero-text-size.ts`** (NUEVO): helper PURO `heroFontTokenForName(name)` → step-down
  length-aware por buckets de longitud → token `{fontSize,lineHeight}` (tipos `HeroFontToken`/`HeroSizeToken`
  = unión exacta `$7..$11` para que Tamagui acepte la prop tipada). Buckets: `$11` ≤10 / `$10` ≤16 / `$9` ≤24
  / `$8` ≤40 / `$7` piso. Mide sobre `trim()`; vacío → token grande. Cero hardcode (tokens de la escala Inter).
- **`app/src/utils/hero-text-size.test.ts`** (NUEVO): 9 tests node:test (típicos GRANDES, largo→más chico,
  bordes de bucket exactos, caso patológico/extremo→piso, trim, vacío/placeholder, lineHeight matching).
- **`app/app/maniobra/_components/SilentSanitaryStep.tsx`**: en el hero (modo lectura) se computa
  `heroName = product || resolvedEmpty` y `heroToken = heroFontTokenForName(heroName)`. El `<Text>` del hero:
  quitó `adjustsFontSizeToFit` + `minimumFontScale`; `fontSize={heroToken.fontSize}`/`lineHeight=...`;
  `width="100%"` + `ellipsizeMode="tail"` + (web-only) `style={{overflowWrap:'anywhere',wordBreak:'break-word'}}`
  (en native no-op). `numberOfLines={2}` preservado. El `YStack` interno ganó `width="100%"`. Comentario de
  cabecera + del bloque actualizados al as-built. **NO toqué** edición/autocompletar/CTA/`identificar.tsx`.
- **`app/e2e/maniobra-sanitaria.spec.ts`**: test 6 nuevo (R6.15) — verifica por LAYOUT (boundingBox) que el
  hero NO overflowea horizontal (x>=0, x+w<=ancho) NI vertical (el botón "Cambiar" no se sale del alto) para
  corto/medio/típico/patológico/extremo(200ch) a 360 Y 412. 4 capturas entregables a `tests/modo-maniobra/`.
- **`scripts/run-tests.mjs`**: agregado `hero-text-size.test.ts` a la lista del runner de unit tests.

## TRAZABILIDAD (R<n> → archivo:test)
- **R6.15** (antibiótico silent_apply — el hero del producto) → e2e `app/e2e/maniobra-sanitaria.spec.ts`
  test 6 "el hero del producto silent_apply nunca overflowea horizontal a 360 ni 412 (R6.15)" (jornada de
  antibiótico → paso silent_apply → mide el hero a 360 y 412 con corto/medio/típico/patológico/extremo).
- **R6.13/R6.14** (antiparasitario silent_apply, mismo componente) → cubierto por el mismo `SilentSanitaryStep`
  (un solo fix sirve para los tres); regresión: test 1 (macho con antiparasitario+antibiótico) sigue verde.
- **R6.5** (inseminación-single reusa el hero parametrizado) → e2e test 4 "inseminación con 1 pajuela
  preconfigurada confirma de un toque (R6.5)" — el hero "Toro 123" sigue grande y dentro; test 5 (selector
  >1) verde. La regresión confirma que el otro caso de uso (pajuela) no se rompió.
- **Helper de selección de tamaño por longitud** → unit `app/src/utils/hero-text-size.test.ts` (9 casos).

## AUTORREVISIÓN ADVERSARIAL
Busqué activamente, como revisor hostil:
- **¿Sigue overflowando HORIZONTAL?** No. Verificado por boundingBox (no por texto — el truncado es CSS, el
  textContent ve el string completo) a 360 y 412 para los 5 largos. El típico "Oxitetraciclina" entra en 1
  línea grande; el patológico parte en 2 con word-break. Confirmado visualmente en las 4 capturas.
- **¿Overflow VERTICAL (el hero extremo empuja "Cambiar producto" fuera de la card)?** Cubierto: agregué al
  e2e el caso EXTREMO (200 ch) + assert de que el botón "Cambiar" queda dentro del alto del viewport →
  `numberOfLines={2}` elipsa sin rebalsar. Pasa a 360 y 412.
- **¿`heroName` desincronizado con `heroToken`?** No: deduzco `heroName` UNA vez y lo paso tanto al helper
  (tamaño) como al render (texto) → el tamaño calculado SIEMPRE corresponde al texto mostrado.
- **¿Rompí el otro caso de uso (InseminacionStep / pajuela)?** No. e2e tests 4 y 5 verdes; captura
  `inseminacion.png` ("Toro 123" grande, dentro). Pajuela corta (≤10 ch) → `$11` = idéntico al comportamiento
  previo; pajuela larga → ahora NO overflowea (mejora).
- **¿Rompí el modo edición / autocompletar / CTA?** No los toqué (el hero solo se renderiza en modo lectura).
  e2e test 1 (input + commit + aplicar) verde.
- **¿`adjustsFontSizeToFit` quedó colgado en algún lado?** Grep limpio (solo en comentarios explicando el bug).
- **¿Cero hardcode (ADR-023 §4)?** Sí: tokens `$7..$11` vía el helper; el `style` web solo lleva props CSS de
  LAYOUT (`overflowWrap`/`wordBreak`), sin color/spacing literal. `node scripts/check-hardcode.mjs` → 0 violaciones.
- **¿lineHeight matching (descenders)?** Sí: el helper devuelve `lineHeight` par con `fontSize` (test lo
  asserta); el hero los aplica ambos. "Ivermectina" no tiene descender pero la regla se respeta igual.
- **¿es-AR?** N/A: el nombre del producto/pajuela es texto LIBRE (no un número humano); no se le aplica formato.
- **¿360px específicamente?** Verificado: "Oxitetraciclina" entra completo y grande con margen; el patológico
  parte en 2 líneas dentro de la card.

## VERIFICACIÓN
- `cd app && pnpm typecheck` → **OK** (los tipos del token como unión exacta `$7..$11` los acepta Tamagui).
- `node scripts/check-hardcode.mjs` → **0 violaciones**.
- `node scripts/check.mjs` → typecheck OK; **client unit 1305/1305 pass** (incluye los 9 de hero-text-size);
  RLS 22/22; **Edge 39/42 — los 3 fails son `Request rate limit reached`** (flake de auth ajeno, NO
  regresión: mi cambio es frontend puro). Estado idéntico al baseline (ya estaba rojo por lo mismo antes de
  tocar nada).
- e2e `maniobra-sanitaria.spec.ts` → **6/6 passed** (5 previas — incl. inseminación 4/5 — + el test 6 nuevo).
  (El "Assertion failed: UV_HANDLE_CLOSING" al cierre es un crash benigno de libuv en Windows POST-resultado,
  no afecta el "passed".)

## CAPTURAS ENTREGABLES (para el veto de diseño del leader) — paths absolutos
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\antibiotico-fix-412.png` — "Oxitetraciclina" completo+grande, 412px.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\antibiotico-fix-360.png` — "Oxitetraciclina" completo+grande, 360px.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\antibiotico-largo-412.png` — patológico partido en 2 líneas, sin overflow, 412px.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\antibiotico-largo-360.png` — patológico partido en 2 líneas, sin overflow, 360px.

## RECONCILIACIÓN DE SPECS
- `design.md`: bullet de SilentSanitaryStep (§6.bis.5) actualizado (hero ya no es `$11` fijo) + **nueva
  §6.bis.6** con el as-built del bugfix (causa `adjustsFontSizeToFit` NO-OP, helper length-aware, word-break,
  verificación por layout, capturas). El *qué* (R6.13/R6.14/R6.15/R6.5) no cambió → NO toqué `requirements.md`;
  bugfix sobre M3.2b ya `[x]` → NO toqué `tasks.md`.

## ESTADO
- Listo para reviewer + Gate 2. NO marqué done (lo decide el reviewer).
