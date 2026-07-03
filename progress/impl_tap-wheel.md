baseline_commit: f3080ebe1a57bcfd604fbbf89c9c188e95ef3540

# Impl — Delta TAP-TO-SELECT en la rueda inercial (#16) — spec 03, Nivel B (ADR-028), frontend-only

**Feature en curso**: delta `tap-wheel` sobre spec 03 (`03-modo-maniobras`, `in_progress`).
**Alcance**: hacer tappable cada celda visible del `WheelPicker` (tap → anima + snap al valor + `onValueChange`), reusando el lock determinístico existente. Sin backend (Gate 1 N/A, `git diff supabase/` vacío).

## Plan (T1–T8)
- [x] T1 — `tapTarget(...)` puro en `wheel-picker.ts`.
- [x] T2 — tests `node:test` de `tapTarget` en `wheel-picker.test.ts`.
- [x] T3 — `WheelCell` tappable (Pressable + a11y + testID por celda).
- [x] T4 — `handleCellTap` enganchado al lock.
- [ ] T5 — no-regresión del drag/settle/momentum (suite existente verde).
- [ ] T6 — E2E del tap `maniobra-tap-wheel.spec.ts`.
- [ ] T7 — capture `app/e2e/captures/tap-wheel.capture.ts` (drum antes/después).
- [ ] T8 — revisión de cierre frontend-only.

## Progreso
- **T1/T2** — `tapTarget(currentOffset, tappedIndex, cellHeight, spec) → { index, offset, value, isCentral }`
  (tipo `WheelTapTarget = WheelSnap & { isCentral }`) en `wheel-picker.ts`, reusando
  `offsetToIndex`/`indexToOffset`/`indexToValue`/`wheelCount` (cero aritmética nueva). 8 tests nuevos
  (`wheel-picker.test.ts`): no central, central (no-op), isCentral por offset, clamp bordes, fraccional,
  round-trip + isOffsetSnapped, AGE_WHEEL. **38/38 unit verdes.**
- **T3** — `WheelCell` envuelto en `Pressable` (`onPress={() => onTap(index)}`, `testID={cellTestID}`,
  `buttonA11y(Platform.OS, { label: 'Seleccionar ${label}' })`). El `Animated.View` con el gradiente queda
  INTACTO adentro. Área tappable = caja de layout (alto `cell`, ancho completo).
- **T4** — `handleCellTap` (JS thread): `tapTarget(offsetY.value, ...)` → no-op si `isCentral`; cancela
  `settleTimer`; sincroniza `offsetY`/`scrollIndex`/`lastNotified` ANTES del `scrollTo({animated:true})`;
  `notifyIndex` una vez. Cableado a cada `WheelCell` (`onTap`, `cellTestID=${testID}-cell-${i}`).
- **T5** — no-regresión: `maniobra-circunferencia-escrotal.spec.ts` SNAP (drag-to-mid lockea exacto CE+edad)
  **1/1** (15,2s) + `captures/rueda-ce.spec.ts` (fling/settle/densidad) **2/2** (360+412).
- **T6** — `app/e2e/maniobra-tap-wheel.spec.ts` (regresión táctil del tap) **1/1** (3,4s).
- **T7** — `app/e2e/captures/tap-wheel.capture.ts` **2/2** → 6 shots gitignoreados en `__shots__/tap-wheel/`.
- **T8** — `git diff supabase/` vacío; anti-hardcode 0; `CircunferenciaEscrotalStep.tsx`/`rueda-ce.tsx`/backend
  intactos (`git diff --stat` = solo `WheelPicker.tsx` + `wheel-picker.ts` + `wheel-picker.test.ts`).

## Verificación (comandos corridos)
- `cd app && pnpm typecheck` → **limpio** (nota: `e2e/` está `exclude` del tsc → los E2E/capture los valida
  Playwright al correr, no el typecheck; por eso se corrieron de verdad).
- `node --import ./scripts/ts-ext-resolver.mjs --test app/src/utils/wheel-picker.test.ts` → **38/38**.
- `node scripts/check.mjs --fast` → anti-hardcode **0 violaciones**, estructura OK.
- `cd app && pnpm run e2e:build` → OK; luego E2E `maniobra-tap-wheel.spec.ts` **1/1**, regresión
  `maniobra-circunferencia-escrotal.spec.ts -g SNAP` **1/1**, `captures/rueda-ce.spec.ts` **2/2**, y capture
  `tap-wheel.capture.ts --config playwright.capture.config.ts` **2/2**.
- `git diff supabase/` **vacío**; `git status design/` **0 cambios** (el e2e:build no dejó png espurios);
  shots `__shots__/tap-wheel/*.png` gitignoreados (verificado con `git check-ignore`), NO `git add`.

## Mapa de trazabilidad RTW → archivo:test
- **RTW.1.1** (celda tappable) → `WheelPicker.tsx` `WheelCell` `Pressable onPress` · E2E `maniobra-tap-wheel.spec.ts` (el tap dispara la selección).
- **RTW.1.2** (anima+snap) → `WheelPicker.tsx` `handleCellTap` `scrollTo({animated:true})` · E2E (valor cambia a la celda) · capture `02/03`.
- **RTW.1.3** (mismo `onValueChange` que el drag) → `handleCellTap` `notifyIndex(t.index)` · E2E `ce-input toHaveValue('37')/('36,5')/('35,5')`.
- **RTW.1.4** (celda central = no-op) → `handleCellTap` `if (t.isCentral) return` · unit `tapTarget: tap central → isCentral true` · E2E (tap `cell-33` central → sigue `'36,5'`).
- **RTW.2.1** (no rompe drag/settle/momentum) → sin cambio del camino de scroll · E2E `maniobra-circunferencia-escrotal.spec.ts` SNAP + `captures/rueda-ce.spec.ts` fling (verdes).
- **RTW.2.2** (sync antes del scrollTo) → `handleCellTap` set `offsetY/scrollIndex/lastNotified` antes · unit round-trip (`offset` = múltiplo exacto) · E2E aterriza exacto en el valor.
- **RTW.2.3** (cancela settle pendiente) → `handleCellTap` `clearTimeout(settleTimer)`.
- **RTW.2.4** (sin lock redundante) → `offset` = `indexToOffset` (ya snapeado) → `lockToOffset` no-op · unit `isOffsetSnapped(t.offset)===true`.
- **RTW.3.1** (solo visibles tappables) → `Pressable` por celda renderizada; las fuera del viewport quedan clipeadas por el overflow (no alcanzables).
- **RTW.3.2** (celda conoce su índice) → `onTap(index)` + `tapTarget(...tappedIndex...)` · unit (índice tapeado → valor, sin coordenada).
- **RTW.4.1** (háptica settle = drag) → `notifyIndex` (`hapticTick`) — mismo punto de feedback que el drag.
- **RTW.5.1** (cancela fling en curso) → `handleCellTap` cancela settle + `scrollTo` re-target · E2E: taps rápidos secuenciales (34→33→31) aterrizan correctos (proxy de tap sobre animación en vuelo).
- **RTW.5.2** (web táctil: sin doble disparo / sin cerrar) → E2E (la pantalla sigue; el no-op central queda estable, sin cambio espurio).
- **RTW.5.3** (a11y de la celda) → `buttonA11y(Platform.OS, { label: 'Seleccionar '+label })` (role button + aria-label DOM-válido).
- **RTW.5.4** (sin loop con la sincronía externa) → `handleCellTap` deja `lastNotified===t.index` → el efecto value→rueda ve su eco · E2E (valores estables, sin re-move).
- **RTW.6.1** (helper puro del destino) → `tapTarget` en `wheel-picker.ts`.
- **RTW.6.2** (helper testeado) → 8 tests `node:test` en `wheel-picker.test.ts`.
- **RTW.7.1** (E2E del tap) → `app/e2e/maniobra-tap-wheel.spec.ts`.
- **RTW.7.2** (capture antes/después) → `app/e2e/captures/tap-wheel.capture.ts` (6 shots, 360+412).
- **RTW.8.1** (frontend-only) → `git diff supabase/` vacío + `CircunferenciaEscrotalStep.tsx`/backend intactos (T8).

## Autorrevisión adversarial (foco: NO-regresión del drag)
Busqué activamente, como revisor hostil:
- **(a) El tap NO rompe drag/momentum/web-settle** — el camino `onScroll`/`onMomentumScrollEnd`/`onScrollEndDrag`/`scheduleSettle`/`lockToOffset` quedó **sin tocar**; solo agregué un `Pressable` envolviendo el contenido de la celda + `handleCellTap`. Verificado con la suite de drag REAL (SNAP 1/1: CE y edad lockean exacto al soltar a mitad de camino) + fling/settle (rueda-ce 2/2). El `Pressable` dentro del `ScrollView` cede el press al pan-responder cuando el gesto se vuelve drag (idiom estándar RN/rn-web) → **drag después de tap** y **drag normal** intactos.
- **Tap durante un fling / animación en vuelo** — el E2E hace taps rápidos secuenciales (34→33→31): cada uno aterriza en el valor correcto, lo que ejercita un tap mientras la animación previa aún podía estar asentándose (proxy de RTW.5.1). El cancel de `settleTimer` + el `scrollTo` al nuevo target garantizan que se asiente en el TAP.
- **Tap en web táctil real** — `hasTouch:true` + `locator.tap()` (no mouse sintético). El `Pressable` emite UN `onPress` por touch; el no-op central quedó estable (no cambia el valor) → sin doble disparo ni cambio espurio.
- **(b) `tapTarget` tiene tests REALES** (no imports muertos, lección recurrente) — 8 tests que ASSERTAN `index/offset/value/isCentral` con valores concretos + round-trip contra `offsetToIndex`/`isOffsetSnapped`. 38/38.
- **(c) Doble-notify (tap + onScroll programático)** — el `handleCellTap` llama `notifyIndex(t.index)` una vez; la animación del `scrollTo` barre celdas intermedias y emite ticks/valores TRANSITORIOS (ej. 36→36,5→37), aterrizando en el valor tapeado. Es **por diseño** (design §4.2/§7: "idéntico a arrastrar por esas mismas celdas"; el salto `animated:false` fue descartado). El valor **committeado final** es el correcto (garantizado por el sync-antes-del-scrollTo + `lastNotified===t.index`), verificado por el E2E (`toHaveValue` estable). NO es un defecto — es la misma lectura de "drum girando" del arrastre.
- **(d) Tap-through web guardeado** — la rueda de CE es inline (sin scrim) → el tap del cell no puede descartar nada (E2E: la pantalla sigue). La rueda de edad vive en `AgeAdjustSheet`, que ya tiene su guard `readyToDismissRef` (doble rAF); el `onPress` del cell no propaga al `onPress` del scrim (Pressables hermanos, sin bubbling) → tocar una celda de edad no cierra el sheet.
- **(e) `CircunferenciaEscrotalStep` NO se toca** — confirmado por `git diff --stat` (solo `WheelPicker.tsx`, `wheel-picker.ts`, `wheel-picker.test.ts`). Ambas ruedas (`ce-wheel`/`age-wheel`) heredan el fix del componente.
- **A11y** — `buttonA11y` en web emite `role`/`aria-label` DOM-válidos (no filtra `accessibilityLabel` crudo → no monta el LogBox overlay que intercepta toques, bug C1). El `aria-label` de la rueda (contenedor) + los `role=button` por celda son a11y CORRECTA (grupo con opciones), no regresión.

Resultado: **sin defectos que corregir**; los "transitorios" del sweep son comportamiento de diseño ya decidido (design §7). Nada requirió re-fix.

## Reconciliaciones (paso 9)
- **T6/T7 separados** (as-built) vs. spec original (capturas foleadas en el `.spec.ts` → `tests/modo-maniobra/`).
  As-built: `maniobra-tap-wheel.spec.ts` (regresión, corre en `pnpm e2e`) + `app/e2e/captures/tap-wheel.capture.ts`
  (Gate 2.5, shots gitignoreados en `e2e/captures/__shots__/tap-wheel/`), por ADR-029 + convención del repo
  (`.spec.ts`=regresión / `.capture.ts`=capturas a mano) + `reference_e2e_design_png_rerender`. El comportamiento
  verificado es idéntico; solo cambió la ubicación de los `.png`. Reconciliado en `design-tap-wheel.md` §1 y
  `tasks-tap-wheel.md` T6/T7 (nota de reconciliación). `requirements-tap-wheel.md` (RTW.7.1/7.2) **no** se
  reescribe: el "qué" (E2E del tap + capture antes/después) no cambió.
- El resto del as-built (helper `tapTarget`, `handleCellTap`, `WheelCell` tappable) quedó **igual** a `design-tap-wheel.md` §3/§4 — sin más reconciliaciones.

## Estado
Implementación completa y verde. **NO marco `done`** (espera al reviewer + Gate 2 + Gate 2.5 + Puerta 2).
Baseline sin backend (Gate 1 N/A confirmado: `git diff supabase/` vacío).
