# Spec 03 — Delta TAP-TO-SELECT en la rueda inercial (#16) — Tasks

**Status**: `spec_ready` — delta **Nivel B (ADR-028)**, **frontend-only**. Gate 1 **N/A**.

> El `tasks.md` baseline NO se toca — este delta trae su propio ledger.
> Cada tarea: checkbox + los `RTW.<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificar.
> **Orden**: helper puro + componente → E2E + capture. **Sin migración** → no hay tarea SQL/remoto (`git diff supabase/` vacío, RTW.8).

## Helper puro (primero)

- [x] **T1** — `app/src/utils/wheel-picker.ts`: agregar `tapTarget(currentOffset, tappedIndex, cellHeight, spec)` → `{ index, offset, value, isCentral }` (tipo `WheelTapTarget = WheelSnap & { isCentral: boolean }`), **reusando** `offsetToIndex`/`indexToOffset`/`indexToValue`/`wheelCount` (sin aritmética nueva). `isCentral` = índice tapeado === índice centrado por `currentOffset`. Cubre: RTW.6.1, RTW.3.2.
- [x] **T2** — `app/src/utils/wheel-picker.test.ts`: extender (`node:test`) — tap no central de CE (offset destino = `indexToOffset(idx)`, value de grilla); tap de la celda central → `isCentral: true`; clamp en bordes (índice <0 y >n-1); round-trip `offsetToIndex(indexToOffset(idx))`; mismo comportamiento en `AGE_WHEEL`. **38/38 unit verdes** (8 nuevos de `tapTarget`). Cubre: RTW.6.1, RTW.6.2.

## Componente (rueda tappable + handler enganchado al lock)

- [x] **T3** — `app/app/maniobra/_components/WheelPicker.tsx` (`WheelCell`): envolver el contenido en un `Pressable` con `onPress={() => onTap(index)}`, `testID={`${testID}-cell-${index}`}` (prop nueva `cellTestID`) y a11y `buttonA11y(Platform.OS, { label: `Seleccionar ${label}` })`. Preservar el `Animated.View` con el gradiente de escala/opacidad. Solo las celdas renderizadas (visibles) reciben el press. Cubre: RTW.1.1, RTW.3.1, RTW.5.3.
- [x] **T4** — `WheelPicker.tsx` (componente): agregar `handleCellTap(tappedIndex)` (JS thread) que — vía `tapTarget(offsetY.value, tappedIndex, cell, spec)` — (a) hace no-op si `isCentral` (RTW.1.4); (b) cancela `settleTimer` pendiente (RTW.2.3, RTW.5.1); (c) sincroniza `offsetY`/`scrollIndex`/`lastNotified` al destino ANTES del scroll (mismo patrón que `lockToOffset`, RTW.2.2); (d) `scrollRef.current?.scrollTo({ y: t.offset, animated: true })` (RTW.1.2); (e) `notifyIndex(t.index)` UNA vez (RTW.1.3, RTW.4.1). Pasar `onTap={handleCellTap}` a cada `WheelCell`. Cubre: RTW.1.2, RTW.1.3, RTW.1.4, RTW.2.2, RTW.2.3, RTW.2.4, RTW.4.1, RTW.5.1, RTW.5.4.

## No-regresión del drag/settle/momentum

- [x] **T5** — Correr la suite existente del baseline `app/e2e/maniobra-circunferencia-escrotal.spec.ts` (test "SNAP: la rueda de CE y la de EDAD lockean EXACTO al soltar a mitad de camino") + `app/e2e/captures/rueda-ce.spec.ts` (fling/settle del drum) y confirmar que **siguen verdes** (el camino de drag/settle/momentum no cambió; el tap solo agrega un `onPress` + handler). **VERDE**: SNAP 1/1 (15,2s) + rueda-ce 2/2 (fling/settle a 360+412). Cubre: RTW.2.1.

## E2E del tap + capture (Gate 2.5)

> **Reconciliación (as-built, ADR-029 + convención del repo):** T6 y T7 se SEPARARON en dos archivos en vez de folear las capturas dentro del `.spec.ts`. Motivo: `.spec.ts` = regresión (corre en `pnpm e2e`); `.capture.ts` = capturas del Gate 2.5 (se disparan a mano con `playwright.capture.config.ts`, shots **gitignoreados** en `e2e/captures/__shots__/`). Espeja el patrón del primer caso ADR-029 (`cria-al-pie-alta.capture.ts`) y evita que los screenshots ensucien la suite de regresión. El "qué" (tap→snap asertado + drum antes/después a 360/412) es idéntico al spec; solo cambia la ubicación de los `.png` (`__shots__/tap-wheel/` en vez de `tests/modo-maniobra/`).

- [x] **T6** — `app/e2e/maniobra-tap-wheel.spec.ts` **(nuevo, REGRESIÓN)**: context `hasTouch: true` + `isMobile: true`, `applyEnvShim`, `goto('/maniobra/rueda-ce')` (spike en `DEV_WEB_ROUTES`, sin auth/seed). Ubica celdas **visibles no centrales** de `ce-wheel` por `testID` (`ce-wheel-cell-<idx>`) y **`locator.tap()`** (touch real): tap a `cell-34` → `ce-input` `'37'`; re-selección `cell-33` → `'36,5'`; **no-op central** `cell-33` → sigue `'36,5'` (RTW.1.4); tap hacia abajo `cell-31` → `'35,5'`; la pantalla NO se cierra (RTW.5.2). **VERDE 1/1** (3,4s). Cubre: RTW.7.1, RTW.5.2, RTW.1.4 (E2E). Notas: `test`/`expect`/`applyEnvShim` de `./helpers/fixtures` (`reference_e2e_fixtures_import`); `locator.tap()` porque Playwright Desktop enmascara el touch (`reference_rn_web_pitfalls`).
- [x] **T7** — `app/e2e/captures/tap-wheel.capture.ts` **(nuevo, CAPTURE Gate 2.5)**: recorre el drum y saca capturas NOMBRADAS del estado **antes** y **después** del tap (a 360 y 412) → `e2e/captures/__shots__/tap-wheel/01-drum-antes-36-<w>.png` / `02-drum-despues-tap-37-<w>.png` / `03-drum-despues-tap-36-5-<w>.png` (evidencia visual del snap al valor tapeado, incluida una selección ".5"). **VERDE 2/2** (360+412), 6 shots gitignoreados. Cubre: RTW.7.2.

## Verificación frontend-only

- [x] **T8** — Revisión de cierre: `git diff supabase/` **vacío** (Gate 1 N/A, RTW.8); tokens-only (anti-hardcode 0 violaciones, ADR-023) en el `Pressable` de la celda; a11y DOM-válida en web (`buttonA11y`); offline-first inalterado (interacción pura, sin camino de red nuevo); `CircunferenciaEscrotalStep.tsx`/`rueda-ce.tsx`/backend **no** tocados (ambas ruedas `ce-wheel`/`age-wheel` heredan el fix). Cubre: RTW.8.1.

> Nota E2E/native (`reference_rn_web_pitfalls` / `reference_playwright_win_teardown`): el veredicto en Windows es "ok N / N passed" aunque aparezca el crash de teardown de Node post-pase. El tap en web debe disparar `onPress` una sola vez por touch; verificar que no haya doble-commit (el valor aterriza y queda estable).
