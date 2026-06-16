baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

# impl 03 — tweak cosmético: quitar hint "1=flaca·5=gorda" de CONDICIÓN CORPORAL

Feature: 03-modo-maniobras (in_progress). Tweak cosmético chico pedido por Raf. Frontend puro, NO backend.

## Plan
- T1: Quitar el `<Text>` del hint "1 = flaca · 5 = gorda" de `CondicionCorporalStep.tsx`. Dejar intacto el indicador de escala (marcas 1…5 con la activa en verde), el valor hero, los botones − / +, el CTA y la lógica del stepper. Reajustar espaciado si queda raro.
- T2: Verificar `node scripts/check.mjs` verde.
- T3: Re-correr e2e `maniobra-elegir` (re-captura `design/maniobra-elegir/condicion-corporal.png` a 412×915).
- T4: Reconciliar `design.md §6.bis.3`.

## Qué se sacó
- `app/app/maniobra/_components/CondicionCorporalStep.tsx`: eliminado el `<Text>` con literal "1 = flaca · 5 = gorda" (era hijo de un `<YStack gap="$3">` que envolvía el grupo de marcas + el hint). Como el wrapper quedaba con un solo hijo (las marcas), se aplanó: ahora el `<XStack>` de marcas es hijo directo de la card. El indicador de escala (marcas 1…5 con la activa en verde) queda intacto.
- Header del componente actualizado (3 referencias al hint en los comentarios: descripción de la pista + nota de recorte de descendentes).

## Espaciado
La card es `flex={1}` con `justifyContent="center"` + `gap="$6"`. El grupo valor+botones+escala ya estaba centrado como bloque (no top-anchored), así que al sacar el hint el grupo sigue centrado y la card sigue llenando el alto útil — cero espacio muerto, sin región vacía grande (R12.5). No hizo falta tocar gaps ni paddings.

## Trazabilidad / R afectados
Tweak cosmético dentro de R6.6 (condición corporal). El hint era decoración, no comportamiento; ningún R nuevo. Cobertura existente: e2e `maniobra-elegir.spec.ts` (score-display 3,00 → +0,25 → 3,25 → Confirmar → server-side condition_score=3.25) sigue intacta — NO dependía del texto del hint (solo de testID `score-display` y `score-plus`). La util pura `condition-stepper.ts` (clamp/snap/±/formato) no se tocó.

## Autorrevisión adversarial
- ¿Algún assert dependía del literal "flaca"/"gorda"? `grep -rn 'flaca|gorda'` en `app/e2e/` → 0 matches. El test solo usa `score-display`/`score-plus`. OK.
- ¿Lógica del stepper tocada? No. `condition-stepper.ts` intacto; clamp/step/default/botones/CTA sin cambios.
- ¿Indicador de escala tocado? No — el `<XStack>` de marcas con la activa en `$primary` queda igual (solo se aplanó el wrapper de un hijo).
- ¿Hardcode introducido? No — solo se removió un nodo. Sigue todo en tokens.
- ¿Espacio muerto al sacar el hint? No — `justifyContent="center"` mantiene el bloque centrado y la card `flex={1}` llena el alto. Verificado por captura.
- ¿Comentarios del header quedaron mintiendo sobre un hint que ya no existe? Corregido (3 referencias).

## Reconciliación de specs
- `design.md §6.bis.3`: nota de que el hint de texto se removió por pedido de Raf (queda la pista de escala VISUAL).

## Verificación
- `node scripts/check.mjs` → RC=0 ("Entorno listo. Podés trabajar."). Sin regresión.
- e2e `maniobra-elegir` → 2 passed (los 2 tests). El `ELIFECYCLE`/`Assertion failed` final es el crash de teardown de libuv en Windows POST-run (no afecta el resultado, los tests reportaron OK).
- Re-capturado `design/maniobra-elegir/condicion-corporal.png` (412×915, verificado por size + lectura visual): hint ausente, valor hero 3,25, botones − / +, escala 1…5 con la 3 en verde, CTA Confirmar. Card centrada, sin espacio muerto.

## NO marco done — espera reviewer.
