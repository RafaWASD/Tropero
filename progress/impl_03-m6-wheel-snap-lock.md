baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

# impl 03 — M6 — fix snap/lock de la rueda inercial (WheelPicker)

Feature `03-modo-maniobras` (in_progress). Chunk M6 (CE). Tarea ACOTADA: arreglar el snap/lock
determinístico de la rueda al soltar (la rueda quedaba descansando ENTRE dos valores).

## Bug (Raf, textual)
"la rueda gira piola pero tiene que 'lockearse' en el numero que mas cerca esté/caiga. no puede
quedar un 70% en 35 y 30% en 35,5. lo mismo la rueda de edad."

## Causa raíz (confirmada leyendo RN-web)
`WheelPicker.tsx` confiaba en `snapToInterval` + `decelerationRate="fast"` del `Animated.ScrollView`.
En **react-native-web** eso NO snapea. Hallazgo NUEVO al leer `node_modules/react-native-web`:
- `ScrollViewBase.js` (web) SOLO emite `onScroll`: uno al empezar, throttled durante, y un ÚLTIMO
  ~100ms después de la última movida (el "scroll-end tick", `isScrolling=false`).
- Los handlers `onMomentumScrollEnd` / `onScrollEndDrag` del `ScrollView` exterior están cableados a
  eventos React NATIVOS que **NUNCA disparan en web** → el snap prescripto SOLO por esos handlers
  quedaría sin hacer en web (que es justo donde falla).

## Plan
- T1 (puro, `wheel-picker.ts` + test): helpers de snap offset→{index, offset, value} reusando
  `offsetToIndex`/`indexToOffset`/`indexToValue`. Si falta un helper chico (snap directo), agregarlo
  PURO con su test (no aritmética inline en el .tsx).
- T2 (`WheelPicker.tsx`): snap determinístico en JS.
  - Native: `onMomentumScrollEnd` + `onScrollEndDrag` → snap inmediato (idiom nativo).
  - Web: debounce desde el `onScroll` (el único end-signal fiable) → snap al settle.
  - `scrollTo({y: indexToOffset(idx), animated:true})` + commit `onValueChange(indexToValue(idx))` +
    tick háptico UNA vez.
  - Guard re-entrancy/loop: si el offset ya es múltiplo exacto de `cell` (ya snapeado) → no-op (no
    loop, no spam de onValueChange/háptica). Reusa `lastNotified`.
  - NO romper la sincronía externa campo→rueda (useEffect targetIndex con animated:false).
  - Mantener `snapToInterval`/`decelerationRate` para native (no degradar).
- T3 (e2e + capturas): arrastrar/posicionar a offset a mitad de camino (itemHeight*2.7) y assertear
  offset final = múltiplo exacto de itemHeight + valor centrado = celda más cercana. CE + edad. 360/412.

## Archivos tocados
- `app/src/utils/wheel-picker.ts` — helpers PUROS nuevos `snapOffset(offset,cell,spec)→{index,offset,value}`
  (reusa offsetToIndex/indexToOffset/indexToValue) + `isOffsetSnapped(offset,cell,spec,eps)` (guard idempotencia).
- `app/src/utils/wheel-picker.test.ts` — +6 tests (mitad de camino CE/AGE, bordes/clamp, anti-relock fuera de rango).
- `app/app/maniobra/_components/WheelPicker.tsx` — LOCK determinístico:
  - shared value `offsetY` (offset vivo del scroller, lo mantiene el worklet) + `settleTimer` ref.
  - `lockToOffset(rawOffset)`: no-op si `isOffsetSnapped`; si no, `scrollTo({y:snap.offset, animated:true})` +
    commit del valor (onValueChange) + tick háptico una vez; guard `lastNotified` (no re-notifica el eco).
  - `scheduleSettle()` (debounce WEB_SETTLE_MS=140) agendado desde `onScroll` → lock al detenerse (web).
  - `onMomentumEnd` (native, lock autoritativo inmediato) + `onDragEnd` (native, difiere vía settle → cede al
    momentum entrante, sin fight/jitter). En web no disparan (ahí lockea el settle).
  - `onScroll` worklet: setea `offsetY` + `runOnJS(scheduleSettle)`. useEffect de cleanup del timer al desmontar.
  - sincronía externa campo→rueda: mantiene `offsetY` en sync + cancela settle pendiente (no loop).
  - `snapToInterval`/`decelerationRate` se MANTIENEN (native).
- `app/e2e/maniobra-circunferencia-escrotal.spec.ts` — helpers `wheelGeometry`/`setWheelOffset`/
  `getWheelScrollTop`/`expectWheelLocked` + test SNAP (CE + edad lockean exacto al soltar a mitad de camino).
- specs/active/03: design §12.2 (AS-BUILT snap/LOCK), requirements R14.5.0 (nota reconciliación), tasks M6-C.1
  (línea fix snap/lock).

## Mapa R→test
- **R14.5** (snap al valor, rueda de CE) →
  - puro: `wheel-picker.test.ts` "snapOffset: un offset a mitad de camino LOCKEA en la celda más cercana (CE)",
    "snapOffset: clampa en los bordes", "isOffsetSnapped: true SOLO cuando…".
  - e2e: `maniobra-circunferencia-escrotal.spec.ts` "SNAP: …" (CE: offset cell*2,7 → scrollTop múltiplo exacto +
    "21,5" en el campo; cell*2,4 → "21").
- **R14.7** (rueda de meses ajustable, mismo WheelPicker) →
  - puro: `wheel-picker.test.ts` "snapOffset: AGE_WHEEL lockea igual".
  - e2e: mismo test SNAP, bloque edad (ageCell*5,7 → scrollTop múltiplo exacto + "12 meses al medir").

## Autorrevisión adversarial (paso 8)
Revisé el diff como adversario buscando los riesgos que el spec marcó:
- **¿Loop de snap?** El `scrollTo({animated:true})` re-dispara `onScroll` → re-agenda settle; al landear en el
  offset exacto, `isOffsetSnapped` true → `lockToOffset` no-op. El e2e no colgó/timeouteó (1 passed en 12-15s),
  confirmando que no hay loop infinito ni spam de onValueChange. CERRADO.
- **¿Jitter entre drag y momentum (native)?** Reescribí `onScrollEndDrag` para DIFERIR (scheduleSettle) en vez de
  lockear inmediato: si llega momentum, su `onMomentumScrollEnd` cancela el timer del drag y lockea el reposo
  real → un solo scrollTo, sin pelea. CERRADO (lógico; native no e2e-testeable acá, pero el path que fallaba es
  el web, sí testeado).
- **¿Caso no-momentum cubierto?** Web: el `onScroll` final (debounce 100ms de rn-web) agenda el settle → lockea
  aunque el usuario suelte quieto. Native: `onScrollEndDrag` → settle. Ambos cubiertos. (Residual: en native sin
  momentum el lock llega ~140ms tarde en vez de inmediato — UX menor, ver riesgos.)
- **¿Sincronía campo→rueda sigue sin loop?** El useEffect de `targetIndex` early-returns en el eco; ahora también
  sincroniza `offsetY` y cancela un settle pendiente. El e2e de tipear "38,5" (test 1, ya existente) pasa → la
  vía campo→rueda sigue funcionando sin loop. CERRADO.
- **¿El snap respeta el clamp del rango?** `snapOffset` clampa el índice vía `offsetToIndex` ([0,n-1]); un
  overscroll más allá del último índice NO se considera snapeado (test `isOffsetSnapped: …fuera de rango`) →
  relockea HACIA adentro del rango. Verificado en puro (bordes 20/50 CE, 6/120 AGE). CERRADO.
- **¿Descendentes recortados?** No toqué labels ni lineHeight; las celdas siguen con `lineHeight` matcheado. La
  captura `ce-snap-lock-412.png` muestra "21,5" y el título "Circunferencia escrotal" sin recorte. CERRADO.
- **¿No degradé native?** `snapToInterval`/`decelerationRate` se mantienen; el JS lock es aditivo. CERRADO.
- **Hallazgo NUEVO en la investigación** (no asumido): leí `react-native-web/ScrollViewBase.js` y confirmé que
  en web NO disparan `onMomentumScrollEnd`/`onScrollEndDrag` (solo `onScroll` debounced 100ms) → por eso el snap
  SOLO por esos handlers (como sugería el brief) no funcionaría en web; agregué el path de settle por `onScroll`.

Encontrado y corregido durante la implementación: la 1ra versión lockeaba inmediato desde `onScrollEndDrag`
(habría peleado con el momentum native). Lo reescribí a drag-end-diferido antes de cerrar.

## Reconciliación de specs
- `design.md §12.2`: agregada nota **AS-BUILT (snap/LOCK al soltar)** — el snap NO es por `snapToInterval`
  (no fiable en RN-web, causa raíz verificada en el source); LOCK determinístico JS (native handlers + web
  settle), idempotente, helpers puros. No reescribí los EARS.
- `requirements.md R14.5.0`: nota de reconciliación AS-BUILT (el "snap al valor" se cumple por lock JS, no
  snapToInterval; aplica a CE y meses). El *qué* (R14.5/R14.7) no cambió.
- `tasks.md M6-C.1`: línea "FIX SNAP/LOCK de la rueda" bajo el AS-BUILT (qué se construyó, tests, capturas).
- NO toqué feature_list.json, specs/done/, ni archivos de spec-08/cut-ficha (coordinación terminales paralelas).

## Verificación
- typecheck: VERDE. anti-hardcode: 0 violaciones.
- client unit: 1285 VERDES (incluye +6 wheel-picker nuevos). wheel-picker.test.ts 28/28.
- e2e `maniobra-circunferencia-escrotal.spec.ts`: **4/4 VERDE** (3 existentes sin regresión + 1 SNAP nuevo).
  Capturas: `tests/modo-maniobra/{ce,age}-snap-lock-{360,412}.png`.
- `node scripts/check.mjs`: ROJO SOLO por el flake conocido `animals_tag_unique` (23505) del backend
  `supabase/tests/animal/run.cjs` (terminal paralela spec-08; `reference_check_red_rate_limit`) — NO es mío
  (frontend wheel + util pura). El runner aborta en ese suite; el resto (client unit, typecheck, anti-hardcode)
  ya había corrido verde.

## Riesgos residuales
1. **Native no e2e-verificado** (Playwright es web). El path web (el que fallaba) está testeado; el native sigue
   la lógica estándar + snapToInterval nativo. Si en un dev build se ve un micro-delay en el caso drag-lento-
   sin-momentum (lock ~140ms tras soltar), se puede bajar `WEB_SETTLE_MS` para drag-end o lockear inmediato en
   ese path nativo — no cambia el contrato.
2. **`runOnJS(scheduleSettle)` por frame** durante el fling: marshaling JS por frame (solo resetea un timer,
   barato). Si en profiling pesara, se podría gatear a "casi detenido". No observé jank en el e2e.
3. **Heurística `cell = clientHeight/5`** en el e2e: robusta a los transforms de escala del drum (mide el
   scroller, no las celdas). Si cambia `CONTEXT_CELLS` (5 celdas visibles) habría que ajustar el divisor.
