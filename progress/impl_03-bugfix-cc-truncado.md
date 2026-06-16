# impl_03-bugfix-cc-truncado — BUG: valor hero de Condición Corporal truncado "4..." en web

baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

Feature en curso: **03-modo-maniobras** (in_progress). Bugfix de frontend puro (NO backend) sobre
`CondicionCorporalStep.tsx` (paso de Condición corporal del wizard de MODO MANIOBRAS).

## SÍNTOMA (Raf, testing en vivo web)
El valor hero de condición corporal se ve truncado **"4..."** (ellipsis) en vez de "4,00".
Evidencia: `tests/modo-maniobra/condicion-corporal.png` — el valor entre los botones − / + no entra y se corta.

## CAUSA (confirmada por lectura)
Layout `− [valor] +` en una `XStack`: el `score-display` está en `flex={1}` entre dos `$stepperBtn`
(88px c/u) + gap, y el `Text` del valor tenía `numberOfLines={1}` + `adjustsFontSizeToFit` +
`minimumFontScale={0.6}`. `adjustsFontSizeToFit` es **NO-OP en react-native-web** → en web el texto NO se
encoge y, con `numberOfLines={1}`, el ancho remanente entre los botones (≈ 412 − 2·88 − gaps − padding) no
alcanza para "4,00" a 64px → `text-overflow: ellipsis` → "4...". En native sí achicaría (por eso Raf solo lo
ve en web).

## PLAN (tasks)
- T1: Reescribir el layout del stepper a **valor full-width arriba / botones − + abajo** (dirección preferida
  del leader). Valor en su propia línea, todo el ancho, centrado, dominante; SIN `numberOfLines`/ellipsize/
  `adjustsFontSizeToFit`. Botones − / + debajo lado a lado, centrados, ≥80px ($stepperBtn=88). Escala (1-5) +
  pista "1=flaca · 5=gorda" debajo. Card llena el alto (cero espacio muerto). Lógica del stepper intacta
  (clamp 1,00–5,00, step 0,25, default 3,00, límites deshabilitados, corrección desde resumen).
- T2: Verificación web (Playwright 412×915 y 360×800): "4,00"/"5,00"/"3,25"/"1,00" se ven COMPLETOS, sin
  "...", centrados. Capturar `design/maniobra-elegir/condicion-corporal.png`. `node scripts/check.mjs` verde.
- T3: Reconciliar `design.md §6.bis.3` (as-built del layout del stepper).

## Requisitos cubiertos (trazabilidad)
- R6.6 (condición corporal stepper 1,00–5,00, step 0,25, default 3,00, es-AR) → e2e
  `app/e2e/maniobra-elegir.spec.ts:142-144` (`score-display` 3,00 → +/click → 3,25, sigue verde con el
  nuevo layout porque el `testID="score-display"` se preservó) + unit `condition-stepper` (aritmética pura,
  intacta). El bug es de LAYOUT del display, no de lógica → se verifica por captura visual (el truncado es
  CSS `text-overflow:ellipsis`, el DOM ya tiene el texto completo → un assert de texto no lo cazaría).

## QUÉ SE CAMBIÓ
- `app/app/maniobra/_components/CondicionCorporalStep.tsx`:
  - **~L115-145** (era ~L114-144): el layout pasó de `XStack [− [valor flex=1] +]` a **valor full-width en
    `<View testID="score-display">` arriba + `XStack [− +]` (gap `$5`) debajo**. El `<Text>` del valor perdió
    `numberOfLines={1}` + `adjustsFontSizeToFit` + `minimumFontScale={0.6}`; ganó `textAlign="center"`. El
    `testID="score-display"` se preservó (e2e intacto). Fuente `$11`/64px sin cambios.
  - **~L1-7 y ~L115-119**: comentarios de cabecera y del bloque reescritos al as-built (valor full-width
    arriba, botones debajo, web-safe).

## NUEVO LAYOUT
Dentro de la card de superficie (figura-fondo, `flex={1}`, `gap="$6"`, llena el alto):
1. **Valor hero** `$11`/64px, full-width, centrado, coma es-AR ("3,00") — SIN truncado.
2. **Botones − / +** `$stepperBtn`=88px, lado a lado, centrados (`gap="$5"`), deshabilitados en los límites.
3. **Escala 1…5** (marca activa en verde) + pista "1 = flaca · 5 = gorda".
CTA "Confirmar" full-width abajo (zona del pulgar), disjunto. Stepper intacto (clamp 1,00–5,00, step 0,25,
default 3,00, corrección desde resumen).

## VERIFICACIÓN
- `node scripts/check.mjs` → **VERDE** (RC=0), sin regresión (incluye e2e build implícito no; suites
  backend + lint/types). Corrido 2 veces (antes y después de la reconciliación de design).
- e2e `maniobra-elegir`: **2/2 ok** (regeneró `design/maniobra-elegir/condicion-corporal.png` a 412×915 con
  el nuevo layout, valor "3,25" completo).
- Verificación de valores EXTREMOS (spec temporal `_tmp-cc-verify`, ya borrada): driveó el stepper a 5,00
  (tope), 4,00 y 1,00 (piso) a **412×915 Y 360×800** → todos COMPLETOS, sin "...", centrados; `+` deshabilitado
  en 5,00, `−` deshabilitado en 1,00 (clamp intacto). Capturas revisadas a ojo (las 4 críticas).
- Captura entregable (la que pidió Raf): `design/maniobra-elegir/condicion-corporal.png` (sobreescrita).

## AUTORREVISIÓN ADVERSARIAL
Busqué activamente, como revisor hostil:
- **¿Sigue truncando?** No. Valor en línea propia full-width sin `numberOfLines`/ellipsize/`adjustsFontSizeToFit`
  → CSS no puede cortar. Verificado a 412 y 360 con el caso más ancho ("5,00"/"4,00", 4 chars + coma).
- **¿Rompí el stepper?** No. `decrement/increment/isScoreAtMin/isScoreAtMax/snapScore/SCORE_DEFAULT` y
  `onConfirm(snapScore(score))` intactos. Límites deshabilitados confirmados visualmente.
- **¿Corrección desde resumen (R5.9)?** Intacta (`initialScore` → `snapScore` en el initializer).
- **¿es-AR?** `formatScoreAR` intacto, coma + 2 decimales en todas las capturas.
- **¿`score-display` testID?** Preservado → e2e no se rompe (confirmado, 2/2 ok).
- **¿Quedó `adjustsFontSizeToFit` colgado?** Solo en comentarios (explicando el bug), no como prop. Grep limpio.
- **¿Espacio muerto / densidad R12.5?** La card `flex={1}` + `justifyContent="center"` + `gap="$6"` sigue
  llenando el alto; el valor arriba sube la jerarquía, no deja hueco. Verificado en capturas (sin región
  vacía grande).
- **¿360px específicamente (el más chico)?** Verificado: "4,00" entra completo con margen holgado.

## RECONCILIACIÓN DE SPECS
- `design.md §6.bis.3` (bullet Condición corporal): actualizado al as-built (valor full-width arriba /
  botones − + debajo) + **nota de reconciliación del bugfix** (causa `adjustsFontSizeToFit` NO-OP en web,
  fix, verificación 412/360). El *qué* (R6.6) no cambió — sigue siendo stepper 1,00–5,00 step 0,25 default
  3,00 es-AR; solo cambió el *cómo* (disposición). No toqué `requirements.md` (R6.6 sin cambio de
  comportamiento) ni `tasks.md` (sin tasks nuevas; bugfix sobre M3.2a ya `[x]`).

## ESTADO
- check.mjs: **VERDE**. Listo para reviewer + Gate 2. NO marqué done (lo decide el reviewer).
