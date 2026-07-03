# Spec 03 — Delta TAP-TO-SELECT en la rueda inercial (#16) — Requirements (EARS)

**Status**: `spec_ready` — delta **Nivel B (ADR-028)** sobre spec 03 (feature `done` en baseline), **frontend-only** (sin backend). El baseline NO se reescribe; este delta trae su propio set `{requirements,design,tasks}-tap-wheel.md`. El `tasks.md` original NO se toca.
**Fecha**: 2026-07-03.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/03-modo-maniobras/context-tap-wheel.md` (Gate 0 aprobado por el leader, modo autónomo — mejora de interacción acotada, sin decisiones de dominio). Las decisiones D1–D4 vienen lockeadas en ese contexto; acá NO se re-deciden, se traducen a EARS.
**Origen**: corrección **#16** del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`).
**Gate 1**: **N/A** — frontend puro; sin migración, RLS, RPC, Edge Function, auth ni datos regulados. `git diff supabase/` debe quedar vacío (RTW.8).
**Related**: spec 03 `requirements.md` (R14.5/R14.6/R14.7 — rueda inercial de CE + edad, `WheelPicker.tsx`, `wheel-picker.ts`), `context-m6-circunferencia-escrotal.md`. ADR-028 (delta-spec), ADR-023 (tokens / sin hardcode), memoria `reference_rn_web_pitfalls` (web táctil / snapToInterval no-fiable / Playwright Desktop enmascara touch).

> **Notación EARS** (`docs/specs.md`). **Numeración `RTW.<n>`** ("Reporte/R Tap Wheel") para no colisionar con `R<n>` (baseline), `RT2.<n>`, `RCUT.<n>`, `RPS.<n>`. IDs estables; cada `RTW.<n>` verificable por ≥1 test.

---

## Resumen

Las **ruedas inerciales** (`WheelPicker.tsx`) hoy solo cambian de valor **arrastrando**. Esta mejora hace **tappable cada celda visible del drum**: tapear una opción que ya se ve (arriba/abajo del centro) **anima** la rueda hasta **centrar** ese valor y dispara el mismo `onValueChange` que el drag. En la manga (una mano, guante/barro), tapear lo que ya ves es más rápido que arrastrar con precisión.

Un **único fix en el componente** cubre **ambas** instancias del paso de circunferencia escrotal (`CircunferenciaEscrotalStep.tsx`): la rueda **dominante de CE** (`testID="ce-wheel"`) y la rueda **secundaria de edad en meses** (`testID="age-wheel"`) — las dos son instancias de `WheelPicker` y heredan el fix; **no se tocan**. El tap entra por el **mismo camino determinístico** que el snap/lock existente (sincroniza los shared values antes del `scrollTo`), sin romper el arrastre inercial ni los guards de plataforma.

Trazabilidad al contexto (Gate 0): **D1 → RTW.1**, **D2 → RTW.2**, **D3 → RTW.3**, **D4 → RTW.4**, edge cases → **RTW.5**, helper puro → **RTW.6**, evidencia Gate 2.5 → **RTW.7**, frontend-only → **RTW.8**.

---

## RTW.1 — Tapear una celda visible la selecciona: anima + snap (D1)

**RTW.1.1** El sistema deberá hacer **tappable** cada celda visible del drum (cada `WheelCell` expone un `onPress`).

**RTW.1.2** Cuando el operario tapee una celda que **no** es la central, el sistema deberá **animar** la rueda (`scrollTo({ animated: true })`) hasta centrar el valor de esa celda, reusando el snap por índice existente.

**RTW.1.3** Cuando el tap centre el valor de una celda no central, el sistema deberá disparar el **mismo** `onValueChange` que el drag, con el valor de esa celda.

**RTW.1.4** Cuando el operario tapee la celda **ya central**, el sistema **no deberá** cambiar el valor ni disparar un `onValueChange` (no-op de valor).

## RTW.2 — No romper el drag ni los guards de plataforma (D2)

**RTW.2.1** El tap-select **no deberá** alterar el arrastre inercial (fling/drag) ni su snap/lock existentes (momentum-end / drag-end nativos; settle-debounce web).

**RTW.2.2** Antes del `scrollTo` programático del tap, el sistema deberá **sincronizar los shared values** (`offsetY` / `scrollIndex` / `lastNotified`) al índice destino, con el **mismo patrón** que el lock actual (`lockToOffset`), para que el valor committeado final sea el de la celda tapeada.

**RTW.2.3** Antes de animar el tap, el sistema deberá **cancelar** cualquier settle/lock pendiente (el timer de settle web), para que un lock diferido no asiente la rueda en el offset previo al tap.

**RTW.2.4** Cuando la animación del tap termine en el offset destino (ya snapeado por construcción), el sistema **no deberá** disparar un lock redundante (el lock sobre un offset ya snapeado es no-op).

## RTW.3 — Solo las celdas visibles importan (D3)

**RTW.3.1** El sistema deberá hacer tappables **solo** las celdas dentro del drum (viewport); las celdas fuera del viewport (no visibles) **no deberán** ser tappables.

**RTW.3.2** Cada celda deberá conocer su **índice**, y su tap deberá resolver el valor destino a partir de ese índice, **sin** mapeo de coordenada-a-valor.

## RTW.4 — Háptica/feedback consistente (D4)

**RTW.4.1** Cuando el tap centre un valor, el sistema deberá disparar la **misma** háptica de settle (`hapticTick` vía `notifyIndex`) que el snap por drag.

## RTW.5 — Edge cases

**RTW.5.1** Si hay un fling en curso cuando el operario tapea una celda, entonces el sistema deberá **cancelar** el momentum y asentar la rueda en el valor tapeado (decisión de criterio propio — ver `design` §Decisiones de criterio propio; a confirmar en Puerta 1).

**RTW.5.2** En web táctil, el sistema **no deberá** disparar el tap dos veces por el click emulado ni cerrar el sheet/paso por tap-through (reusar los guards de plataforma existentes).

**RTW.5.3** Cada celda tappable deberá exponer su **accesibilidad**: `role` de botón + label accesible = el valor de la celda (vía `buttonA11y`/`labelA11y`, DOM-válido en web).

**RTW.5.4** Cuando el tap-select dispare un `onValueChange`, el sistema **no deberá** introducir un loop de feedback con la sincronía externa campo↔rueda (el eco del valor tapeado no re-mueve la rueda).

## RTW.6 — Helper puro del destino del tap (testeable)

**RTW.6.1** El sistema deberá proveer en `wheel-picker.ts` una util **pura** que, dados el offset actual, el índice tapeado, el alto de celda y el `WheelSpec`, devuelva el destino del tap `{ index, offset, value, isCentral }` (`isCentral` = el índice tapeado coincide con el centrado actual), **reusando** `offsetToIndex`/`indexToOffset`/`indexToValue` **sin duplicar** aritmética.

**RTW.6.2** La util de RTW.6.1 deberá estar cubierta por tests `node:test` (sin montar UI): destino no central (offset/valor correctos), tap de la celda central (`isCentral: true`), clamp en los bordes y round-trip contra los helpers existentes.

## RTW.7 — Evidencia Gate 2.5 (E2E del tap + capture)

**RTW.7.1** El sistema deberá tener un **E2E** en web **táctil** (`hasTouch: true` + `touchscreen.tap()` / `locator.tap()` — Playwright Desktop enmascara el touch) que **tapea una celda visible no central** de la rueda y **assertea que el valor cambió** al de esa celda (la interacción, no solo el estado; una captura estática no muestra el tap→snap).

**RTW.7.2** El sistema deberá capturar el **estado del drum** antes y después del tap (evidencia visual del snap al valor tapeado), a los anchos de captura del repo.

## RTW.8 — Frontend-only (sin backend)

**RTW.8.1** El sistema **no deberá** tocar backend: `git diff supabase/` deberá quedar **vacío** y el Gate 1 es **N/A** (sin migración, RLS, RPC, Edge, auth ni datos regulados).

---

## Historial de refinamiento

- **2026-07-03** — Redacción inicial del delta (spec_author) a partir de `context-tap-wheel.md` (Gate 0). D1→RTW.1, D2→RTW.2, D3→RTW.3, D4→RTW.4; edge cases→RTW.5; helper puro→RTW.6; Gate 2.5→RTW.7; frontend-only→RTW.8. Decisiones de criterio propio (cancelar-fling en RTW.5.1; equivalencia de háptica settle=drag en RTW.4.1) marcadas para Puerta 1.
