baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

# impl 03 — M6-C.0 DESIGN SPIKE de la rueda de Circunferencia Escrotal (CE)

> Spike VISUAL (mock data, sin backend ni persistencia). Objetivo: que la rueda inercial se vea y se
> sienta bien para que el leader la veta (design-review) antes de mostrársela a Raf.
> Feature `03-modo-maniobras` = `in_progress`. Spec aprobada (Puerta 1). Sub-chunk M6-C.0 de M6-CLIENTE.

## Plan (Tn)

- **T1** — `app/src/utils/wheel-picker.ts`: lógica PURA del wheel picker (rango/paso → valores; offset↔valor;
  clamp/snap; formato es-AR; edad: birth_date→meses, default, formato "≈ N meses"). Sin React/RN. Testeable Node.
- **T2** — `app/src/utils/haptics.ts`: agregar `hapticTick()` (pulso ligero por valor al cruzar celda, idiom Vibration
  existente — NO expo-haptics, ver cabecera del módulo). Test de no-crash.
- **T3** — `app/app/maniobra/_components/WheelPicker.tsx`: componente genérico de rueda inercial (Reanimated
  scroll vertical + snapToInterval = alto de celda + decelerationRate + tick háptico por valor + líneas de
  selección + fade superior/inferior). Reusable por CE y por la rueda de meses.
- **T4** — `app/app/maniobra/_components/CircunferenciaEscrotalStep.tsx`: el step 🔴 manga. Rueda de CE dominante
  + número grande glanceable "36,5 cm" (tamaño fijo, sin adjustsFontSizeToFit) + edad secundaria prellenada
  "≈ 24 meses" con tap-to-ajustar (sheet con rueda de meses 6–120) + confirm gigante full-width. Props
  `initialCm`/`ageMonths`/`onConfirm` (mock, sin cablear a carga.tsx).
- **T5** — Harness DEV `app/app/maniobra/rueda-ce.tsx` (DEV_WEB_ROUTES, patrón paso.tsx) + capture
  Playwright web TÁCTIL (hasTouch:true, 360 y 412) → reposo, número grande, edad secundaria, sheet de meses,
  confirm. Salida en `tests/modo-maniobra/`.
- **T6** — `node scripts/check.mjs` (typecheck + anti-hardcode + unit) verde + autorrevisión adversarial +
  reconciliación de specs.

## Baseline / Gate 2
- baseline_commit registrado arriba (SHA previo a la primera task de M6-C.0). NO se sobreescribe.

## Tasks (todas [x])
- T1 `wheel-picker.ts` (lógica pura) + `wheel-picker.test.ts` (18 casos) ✓
- T2 `hapticTick()` en `haptics.ts` + `haptics.test.ts` ✓
- T3 `WheelPicker.tsx` (drum inercial genérico, Reanimated) ✓
- T4 `CircunferenciaEscrotalStep.tsx` (rueda CE + número grande + edad secundaria sheet + confirm) ✓
- T5 harness `maniobra/rueda-ce.tsx` (DEV_WEB_ROUTES) + capture `e2e/captures/rueda-ce.spec.ts` (2/2) ✓
- T6 check.mjs (typecheck + anti-hardcode + client unit verdes) + autorrevisión + reconciliación ✓

## Mapa R<n> → test
> M6-C.0 es un **design spike VISUAL** (su aceptación es el feel inercial + el veto del leader, NO cobertura
> EARS — los R14.* se cubren end-to-end en M6-C.1 al cablear). Pero las MECÁNICAS PURAS que sostienen esos
> R están testeadas acá:
- **R14.5** (rango 20–50/0,5 = 61 valores; valor inicial 36; snap al valor; valor centrado = seleccionado)
  → `app/src/utils/wheel-picker.test.ts`: "la rueda de CE es 20–50…default 36", "…61 valores", "snapToWheel:
  clamp/snap", "valueToIndex/indexToValue inversas", "offsetToIndex centro más cercano", "indexToOffset
  round-trip". Feel inercial verificado en la captura `rueda-ce-fling-{360,412}.png` (fling → snap a 41,5, v2).
- **R14.5.1** (input manual por teclado, sub-cláusula v2: parsear "36,5"/"36.5"; clamp [20,50]; redondeo 0,5;
  no-numérico→revierte; sincronía con la rueda) → `wheel-picker.test.ts`: "parseCmInput: coma decimal es-AR",
  "…acepta también punto", "…redondea al 0,5 más cercano", "…clampa al rango [20,50]", "…no-numérico/vacío →
  null", "…resultado SIEMPRE en la grilla". Sincronía rueda↔campo verificada en e2e (asserts `toHaveValue`
  tras tipear "38,5" + tras fling a "41,5") y en las capturas `rueda-ce-input-{360,412}.png`.
- **R14.6** (edad prellenada desde birth_date, DM6-6 sin distinguir precisión) → `wheel-picker.test.ts`:
  "prefillAgeMonths: calcula meses…clampa", "…año-solo (AAAA-07-01) se prellena igual". Reusa `monthsBetween`
  (animal-age.ts, ya testeado).
- **R14.7** (edad siempre ajustable por rueda de meses 6–120/1; puede quedar desconocida NULL) →
  `wheel-picker.test.ts`: "la rueda de meses es 6–120…default 24", "initialAgeIndex usa prellenada o default";
  el "No sé la edad" (age NULL) está en el sheet (captura `rueda-ce-edad-*.png`).
- **R14.14** (formato es-AR coma decimal) → `wheel-picker.test.ts`: "formatCmAR: coma decimal", "formatCmWithUnitAR",
  "formatAgeLabel ≈ N meses", "formatMonthsNum solo número".
- **R12.5** (densidad ≥60 % del alto útil) → e2e `rueda-ce.spec.ts` mide **81,3 %** (assert ≥60) a 360 y 412 (v2).
- **R5.2/R12.2** (confirm gigante full-width) → presente en las 3 capturas; `minHeight="$touchMin"`.
- Háptica (tick) → `haptics.test.ts` (no-crash web-safe; el efecto real se valida en device, no en node/web).

## Autorrevisión adversarial
Pasada hostil sobre el spike. Qué busqué / qué encontré / cómo lo cerré:
1. **Dependencia de `expo-haptics`** (lo pedía el spec/dirección). El repo lo PROHÍBE a propósito (ADR-011,
   superficie postinstall; cabecera de `haptics.ts`). → Usé el idiom establecido: `hapticTick()` (Vibration,
   web-safe). Reconciliado en design §12.2. **Evitó sumar una dep no autorizada.**
2. **`adjustsFontSizeToFit` (NO-OP en web)** para el número grande. → NO se usa en ningún lado (grep limpio);
   el número grande es tamaño FIJO `$wheelHero=44` + `allowFontScaling={false}`. El brief lo exigía explícito.
3. **Overflow de las celdas de la rueda de MESES**: "24 meses" por celda se TRUNCABA con "…" (visible en la
   1ra captura). → Las celdas ahora muestran SOLO el número (`formatMonthsNum`) y la unidad "meses" va una vez
   en el encabezado live del sheet. Re-capturado: limpio a 360 y 412. (Bug real cazado y cerrado.)
4. **Inicial offset en web** (`contentOffset` no siempre aplica al montar en react-native-web → la rueda
   arrancaría en 20, no en 36). → Agregué un `scrollTo({animated:false})` imperativo en el efecto de montaje
   (belt-and-suspenders con `contentOffset`). Verificado: la captura de reposo arranca centrada en 36.
5. **Spam del JS thread / háptica** (un onScroll por frame dispararía tick+onValueChange en cada píxel). → El
   worklet compara el índice contra un shared value `lastNotified` y solo salta a JS (`runOnJS`) al CRUZAR de
   celda. Tick = un toque por valor (no un buzz), como pide la dirección.
6. **Fitts (targets ≥56)**: confirm `$touchMin`(56); pill de edad `minHeight $touchMin`; botones del sheet
   `$touchMin`. La rueda se ARRASTRA (target = área, no celda). ✓
7. **Recorte de descendentes**: todo `Text` con `fontSize` lleva `lineHeight` matcheado (grep verificado);
   títulos "Circunferencia escrotal"/"Edad del toro" no tienen descendentes pero igual matchean por regla.
8. **Densidad / espacio muerto**: card `$surface flex={1}` reparte el alto (79,6 % medido). Sin vacíos grandes.
9. **Contraste**: número grande `$textPrimary` sobre `$surface`; líneas de selección `$primary`; celdas no-
   centrales atenuadas pero la central queda negra bold (jerarquía). Pill de edad `$textPrimary` sobre `$bg`.
10. **Overflow 360/412**: ambas anchuras capturadas, sin truncado en CE ni meses (tras el fix #3).
11. **Web táctil real** (regla `reference_rn_web_pitfalls`): el context es `hasTouch:true`+`isMobile:true`,
    viewport 360/412, y el fling se ejercita scrolleando el div real (snap CSS + onScroll del componente).
12. **Guard anti tap-through del sheet de edad**: doble rAF + setTimeout(0) (`readyToDismissRef`), idiom del
    repo — el click huérfano del tap que abre el sheet no lo auto-cierra.

## Reconciliación de specs
- **design.md §12.2** — añadidas notas AS-BUILT: (a) háptica via `Vibration`/`haptics.ts` (NO expo-haptics,
  razón ADR-011); (b) Reanimated = `useAnimatedScrollHandler` para el drum, momentum/snap = motor nativo del
  ScrollView (más fiable en web); (c) lógica pura en `wheel-picker.ts` + tokens JIT `$wheelCell`/`$wheelHero`;
  (d) layout cerrado por el spike (card flex, número fijo, edad pill→sheet, confirm gigante, densidad 79,6 %).
- **tasks.md M6-C.0** — marcada `[x]` con bloque AS-BUILT (componentes, capturas, densidad, flake del Animal
  suite explicado). El veto del design-review del leader + OK Raf siguen pendientes (no me auto-marco done).
- **requirements.md** — sin cambio: NO cambió el *qué* (los EARS R14.5/R14.6/R14.7/R14.14 siguen igual; el
  spike es la realización visual, dentro de lo ya especificado). DM6-6 ya estaba resuelto en el spec.

## Notas para el reviewer / leader
- check.mjs COMPLETO da rojo SOLO por el **Animal suite** (`animals_tag_unique` duplicate-key, EID border-64):
  colisión de datos en la DB compartida (seed previo / terminal paralela), **ajena a este spike frontend-only**
  (cero SQL, cero tabla animals, cero backend). Re-run del suite reproduce la MISMA falla → flake de datos, no
  regresión. typecheck + anti-hardcode + client unit (incl. wheel-picker 18 + haptics 2) **verdes**.
- **NO cableado al frame** (a propósito, paridad spike M2.0): `CircunferenciaEscrotalStep` tiene props
  `initialCm`/`ageMonths`/`onConfirm` pero `carga.tsx` NO lo dispatcha aún (eso es M6-C.1). El harness
  `maniobra/rueda-ce.tsx` lo monta con mock para la captura/veto.

---

## FIX-LOOP de diseño (2026-06-17 — post-veto del leader)

> El leader veteó el spike (design-review) y frenó dos defectos. Frontend/visual puro (mock, sin cablear).
> Backend NO tocado.

### Diagnóstico (causa raíz)
- **DEFECTO 1 (BLOQUEANTE) — los `.5` recortados/tachados por las líneas de selección.** `WheelCell` leía
  `getTokenValue('$8', 'size')` con un comentario erróneo ("23 — tamaño base"). PERO `$8` en el **size-scale**
  de Tamagui v4 = **84px** (no el font-scale `$8`=23). Verificado en runtime:
  `tokens.size.$6=64, $7=74, $8=84`. → la celda central (bold, lineHeight 84) y los vecinos (escalados
  ~0,84 → ~70px) **desbordaban** la celda de 64px; las dos líneas verdes (en los bordes de la celda central)
  **cruzaban por encima del texto de los vecinos**. Los `.5` (`35,5`/`36,5` en reposo; `38,5`/`39,5` en fling)
  quedaban cortados → leían como glitch, a 360 y 412.
- **DEFECTO 2 (redundancia) — dos heroes.** El readout "36 cm" de arriba (`$wheelHero=44`) Y el centro de la
  rueda gigante (84px) competían como dos números protagonistas.

### Fix aplicado
1. **Token JIT nuevo `$wheelValueText=26`** (`tamagui.config.ts`): tamaño UNIFORME y moderado del texto de
   TODAS las celdas del drum. Con `lineHeight` matcheado (=26) entra HOLGADO en `wheelCell=64` (~19px de
   respiro arriba/abajo del glifo, incluidos los `.5`), regla `reference_descender_clipping`.
2. **`WheelPicker.tsx` / `WheelCell`**: (a) lee `$wheelValueText` (uniforme) en vez del `$8` size-scale;
   (b) la celda mide exactamente `$wheelCell=64` (= snapToInterval, lo que bracketean las líneas) con el
   texto centrado; (c) el drum 3D pasa a ser **solo por OPACIDAD** (gradiente vecinos atenuados → centro
   sólido) — **se quitó el `scale`** del `useAnimatedStyle` (la escala empujaba los vecinos contra las
   líneas). Así NINGÚN glifo desborda ni es cruzado.
3. **Un solo hero**: el readout fijo "36 cm" de arriba (`$wheelHero=44`, estable durante el scroll,
   glanceable — manga) queda como único número protagonista; el centro de la rueda es uniforme `$wheelValueText`.
   El `CircunferenciaEscrotalStep` no necesitó cambios (ya tenía el readout arriba; el fix del centro vino del
   `WheelPicker`).
4. **Consistencia**: el fix aplica también a la **rueda de meses** del sheet de edad (mismo `WheelPicker`) —
   verificado limpio a 360/412.
5. **Pill de edad**: medida **64px** de alto a 360 y 412 (≥56 manga ✓). El "≈" (estimación) se mantiene.

### Verificación
- typecheck `tsc --noEmit` **verde** (exit 0).
- anti-hardcode (`check-hardcode.mjs`) **verde** (0 violaciones) — el `26` vive como token JIT, no literal.
- unit `wheel-picker.test.ts` + `haptics.test.ts` **verdes** (20/20) — la lógica pura no se tocó (fix visual).
- **Re-capturas web TÁCTIL** (`hasTouch:true`+`isMobile:true`) a **360 y 412**, mismas rutas
  `tests/modo-maniobra/rueda-ce-*`: reposo, fling (asentado en `39,0` con vecinos `38,5`/`39,5`), sheet de
  edad. Densidad medida = **79,6 %** del alto útil (R12.5 ✓). 2/2 tests verdes.
  - `rueda-ce-reposo-{360,412}.png`, `rueda-ce-fling-{360,412}.png`, `rueda-ce-edad-{360,412}.png`.

### Autorrevisión adversarial (fix-loop, paso 8 — miré yo las capturas)
- **`.5` NO recortado/cruzado**: confirmado en las 6 capturas. Reposo 412: `35,5` (arriba) y `36,5` (abajo)
  completos, las líneas bracketean solo `36`. Fling 412: `38,5`/`39,5` completos. Idem a 360. Sheet de edad:
  `22/23/24/25/26` limpios, líneas bracketean solo `24`. **El defecto bloqueante está cerrado.**
- **Un solo hero**: confirmado — el readout "36 cm"/"39 cm" arriba es el único número grande; el centro de la
  rueda es uniforme y subordinado.
- **Targets ≥56**: pill de edad medida 64px; confirm `$touchMin`(56); botones del sheet `$touchMin`. ✓
- **Trade-off del drum por-opacidad-solo (sin escala)**: el efecto 3D es más sutil que con escala, pero (a) la
  selección sigue clarísima (líneas + opacidad + el readout hero), (b) es el precio correcto para garantizar
  que el glifo nunca desborde — la legibilidad del valor 🔴 manga pesa más que el realismo del drum. Decisión
  consciente, reconciliada en design §12.2.
- **Sin hardcode nuevo**: el `26` es token JIT `$wheelValueText`; el lint anti-hardcode pasa.

### Reconciliación de specs (fix-loop)
- **design.md §12.2**: (a) añadido `$wheelValueText=26` a la lista de tokens JIT; (b) bloque AS-BUILT M6-C.0
  reescrito a "único HERO = readout" + drum por opacidad; (c) nuevo bloque **AS-BUILT M6-C.0 — FIX-LOOP** con
  el diagnóstico (`$8` size-scale=84), el fix (token uniforme + opacidad-solo + un hero), la pill 64px y las
  re-capturas. **requirements.md sin cambio** (el *qué* no cambió: R14.5/R14.6/R14.7/R14.14 intactos — fue un
  defecto de realización visual dentro de lo ya especificado). **tasks.md** M6-C.0 sigue `[x]`.

---

## FIX-LOOP v2 de diseño (2026-06-18 — 2 feedbacks de Raf sobre la v1)

> Raf vio la v1 y dio 2 feedbacks. Frontend/visual puro (mock, sin cablear a persistencia). Backend NO tocado.

### Feedbacks de Raf
- **FB1 — la jerarquía/tamaños no se notan (la v1 quedó plana).** El fix-loop v1 había uniformado TODAS las
  celdas a `$wheelValueText=26` (para no recortar los `.5`), pero así "los tamaños, las prioridades no se
  notan, está raro" — el valor seleccionado no resalta. Pedido: devolver un gradiente de tamaño (centro
  enfatizado vs vecinos) SIN recortar (sin volver al `$8`=84 que recortaba).
- **FB2 (lo más importante) — campo de texto editable + teclado.** Que la rueda actualice un campo de texto y
  que pulsando ese campo se abra el teclado del dispositivo para tipear los cm a mano. Input híbrido,
  sincronía bidireccional, validación (clamp 20–50 + grilla 0,5 + es-AR).

### Fix aplicado
1. **GRADIENTE de tamaño en la rueda (FB1)** — `WheelPicker.tsx`/`WheelCell`: se restauró el gradiente vía
   `transform: scale` en el worklet (UI thread), sobre el texto BASE chico `$wheelValueText=26` (NO se vuelve
   al `$8`=84 que recortaba): central `×1,22` (≈32px, RESALTA), vecinos `×0,88` (≈23px), lejanos `×0,78`
   (≈20px) + opacidad decreciente (centro sólido → piso 0,16). Constantes nombradas (`CENTER_SCALE`/`FAR_SCALE`/
   `SCALE_DROP`/`MIN_OPACITY`/`OPACITY_DROP`) — no hardcode disperso, son factores de escala (no spacing/color).
   El centro escalado entra HOLGADO en `wheelCell=64` → ningún `.5` desborda ni cruza las líneas (verificado).
2. **CAMPO EDITABLE + teclado (FB2)** — `CircunferenciaEscrotalStep.tsx`: el readout fijo de arriba pasa de
   `<Text>` read-only a un **`<TextInput>` editable = HERO PRIMARIO** (`CmInputField`): caja bordeada
   (`$white`/`borderWidth 2`/`$divider`→`$primary` en foco/`borderRadius $card`/`minHeight $touchMin`=56/
   `alignSelf:center`) con "36,5" (`$wheelHero=44`, ancho fijo `$stepperBtn`=88, `textAlign:center`) + "cm" +
   **ícono de teclado** (lucide `Keyboard`). Tap → `keyboardType="decimal-pad"` (web `inputmode="decimal"`).
   **Sincronía bidireccional** (un único `cm` canónico): rueda→campo (no enfocado = `formatCmAR(value)`);
   campo→rueda (draft mientras tipea; en blur/`onSubmitEditing` valida con `parseCmInput` y commitea →
   `setCm`). `sanitizeCmTyping` evita basura mientras se tipea (dígitos + 1 separador).
3. **`parseCmInput` (lógica PURA, FB2)** — `wheel-picker.ts`: parsea "36,5"/"36.5"/"36,5 cm" → número; clamp
   [20,50] + redondeo al 0,5 (reusa `snapToWheel`); no-numérico/vacío → `null` (el caller revierte). 6 tests
   nuevos en `wheel-picker.test.ts` (coma/punto, clamp, redondeo 0,5, no-numérico→null, resultado en grilla).
4. **Sync externa rueda → instantánea** — `WheelPicker.tsx`: nuevo efecto que, cuando `value` cambia por una
   fuente externa (el campo), scrollea la rueda a ese índice con `animated:false`. **Bug cazado en v2:** con
   `animated:true` el scroll pasaba por los índices intermedios y cada `onScroll` pisaba el valor tipeado con
   uno a mitad de camino (commit quedaba en 36,5 en vez de 38,5). El guard `lastNotified` (seteado ANTES del
   scrollTo) evita el loop de feedback rueda↔campo y el re-notify del salto programático.

### Verificación (v2)
- typecheck `tsc --noEmit` de MIS archivos **verde** (los 2 errores `error TS2345` actuales son de
  `CustomManeuverStep.tsx`, archivo M5-C.3 **modificado por OTRA terminal** en el working tree — no es mío).
- anti-hardcode: **0 violaciones en MIS archivos** (las 7 violaciones que reporta check-hardcode son TODAS de
  `CustomManeuverStep.tsx`, la WIP de la otra terminal — ninguna en Circunferencia/WheelPicker/rueda-ce).
- unit `wheel-picker.test.ts` + `haptics.test.ts` **verdes (26/26)** — incl. los 6 casos nuevos de `parseCmInput`.
- **Re-capturas web TÁCTIL** (`hasTouch:true`+`isMobile:true`) 360 y 412, **2/2 tests verdes**, densidad
  **81,3 %** (R12.5 ✓). Rutas `tests/modo-maniobra/rueda-ce-{reposo,input,fling,edad}-{360,412}.png`:
  - `reposo`: campo editable "36 cm" (bordeado + ícono teclado) + rueda con gradiente (centro 36 grande/bold,
    vecinos 35,5/36,5 medianos, lejanos 35/37 chicos+atenuados) + edad + confirm.
  - `input`: campo enfocado (borde $primary + focus-ring) tipeando "38,5" — affordance de edición manual.
  - `fling`: asentado en **41,5** (un `.5` — prueba que NO se recorta) + el campo sincronizado a 41,5.
  - `edad`: sheet de meses (mismo `WheelPicker`, ahora con gradiente también).

### Autorrevisión adversarial (v2, paso 8 — miré yo las 8 capturas)
- **Jerarquía clara (FB1)**: ✓ en las 6 capturas reposo/input/fling. El centro de la rueda RESALTA (grande +
  bold + sólido) vs vecinos medianos vs lejanos chicos/atenuados. La v1 plana quedó resuelta. Y el CAMPO
  editable bordeado es el hero por encima del centro de la rueda (3 niveles: campo > centro > vecinos).
- **`.5` sin recorte a 360/412**: ✓. Reposo: 35,5/36,5 completos. Fling 41,5 (centro, `.5`) completo + 40,5/
  42,5 (lejanos) completos. El centro escalado ~32px entra holgado en cell=64; las líneas bracketean solo el
  centro. Miré las 4 capturas (reposo+fling × 360/412) glifo por glifo.
- **Campo obviamente editable + abre teclado (FB2)**: ✓. La caja bordeada + ícono de teclado comunica "input".
  El `<input>` renderizado es `inputmode="decimal"` (verificado en el DOM del trace) → abre el teclado decimal
  del SO al tocar. En foco el borde pasa a `$primary` + focus-ring (capturas `input-*`).
- **Sincronía rueda↔campo correcta**: ✓. Tipeé "38,5" → blur → la rueda saltó a 38,5 (campo "38,5"). Fling de
  +6 celdas desde 38,5 → 41,5, el campo siguió a 41,5 (asserts `toHaveValue('38,5')` y `toHaveValue('41,5')`
  pasan). El bug del valor a mitad de camino quedó cerrado con `animated:false` + guard `lastNotified`.
- **Targets ≥56**: campo `minHeight $touchMin`=56; confirm `$touchMin`; pill de edad 64px; botones del sheet
  `$touchMin`. ✓
- **Overflow horizontal**: ✓ cerrado — la v2 inicial tenía la caja sangrando fuera de la card (width 100% +
  TextInput estirado en RNW). Fix: `alignSelf:center` + ancho fijo del input (`$stepperBtn`=88, no flex). A
  360 y 412 la caja queda contenida dentro de la card.
- **No-numérico no rompe**: `parseCmInput` devuelve null y el campo revierte al último válido (testeado).

### Reconciliación de specs (v2)
- **design.md §12.2**: nuevo bloque **AS-BUILT M6-C.0 — FIX-LOOP v2** (gradiente de tamaño por scale sobre
  base chica; campo editable `TextInput` hero + teclado decimal; sincronía bidireccional + `parseCmInput`;
  el bug del salto animado + guard `lastNotified`; densidad 81,3 %; capturas `{reposo,input,fling,edad}`).
- **requirements.md**: agregada **R14.5.1** (sub-cláusula) — input manual por teclado sincronizado con la
  rueda (mismo clamp 20–50 + grilla 0,5, es-AR). Es comportamiento NUEVO pedido por Raf, por eso se nota como
  reconciliación bajo R14.5 (no se reescriben los EARS existentes). R14.6/R14.7/R14.8/R14.14 intactos.
- **tasks.md**: M6-C.0 sigue `[x]` (el spike es el mismo chunk; la v2 es un fix-loop dentro de él).

### Notas para el reviewer / leader
- **Parallel terminals**: el working tree tiene `CustomManeuverStep.tsx` (M5-C.3) **modificado por otra
  terminal** con 2 errores de typecheck + 7 violaciones de anti-hardcode. NO lo toqué (no es mi feature/chunk).
  Por eso `node scripts/check.mjs` COMPLETO da rojo — pero es ajeno a este spike. MIS archivos pasan
  typecheck + anti-hardcode + unit + e2e en aislamiento. Verificado: ninguno de los lints/errores apunta a
  Circunferencia/WheelPicker/rueda-ce/wheel-picker.
- **Sigue siendo spike VISUAL no cableado** (props mock; `carga.tsx` no lo dispatcha — eso es M6-C.1). El veto
  del design-review + OK de Raf siguen pendientes (no me auto-marco done).
