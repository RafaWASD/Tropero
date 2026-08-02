baseline_commit: aead27c01babff1d6770b8046cde86a266fdf7eb

# Fix de clase: blindaje de worklets de gesto/scroll (crash nativo SIGABRT en device)

Fix a código existente de feature 03 (MODO MANIOBRAS, `done`). NO es feature nueva.

## El bug (evidencia)
`EXC_CRASH / SIGABRT` (`abort()`) en iPhone 15 Pro, build release `ar.rafq.app`, armando una
maniobra / dato personalizado. Stack main thread:
`__cxa_throw ← throwPendingError ← WorkletRuntime::runSync ← reanimated::UIEventHandler::process ←
UIEventHandlerRegistry::processEvent ← ReanimatedModuleProxy::handleEvent ← dispatchEvent ← UIGestureRecognizer`.
Diagnóstico: un worklet atado a un **animated-event handler** (callback de gesto RNGH o scroll handler)
tiró una excepción de JS SIN CATCH en el UI runtime → `std::terminate` → abort → muere toda la app.
`UIEventHandler::process` es exclusivo de esos handlers; NO involucra useAnimatedStyle/useDerivedValue/
useFrameCallback. Sin dSYM → no hay pinpoint de la línea; fix DEFENSIVO/de-clase (mismo espíritu que el
blindaje ya probado de `BottomSheetShell`).

## Plan
- T1: blindar el `Gesture.Pan()` del drag-reorder en `ManeuverReorderList.tsx` (onStart/onUpdate/onEnd/onFinalize).
- T2: blindar los `Gesture.Tap()` de `ManeuverReorderList.tsx` (badgeTap/bodyTap/PoolRow).
- T3: blindar el `useAnimatedScrollHandler({onScroll})` de `WheelPicker.tsx`.
- T4: extender el guard de clase (`worklet-callbacks-guard.test.ts`): enumerar TODOS los callbacks de gesto
  RNGH / animated-scroll-handler del árbol y exigir el blindaje (try/catch + `if(__DEV__) throw`). Barrer la
  AUSENCIA: un gesto/scroll worklet nuevo sin blindaje → test ROJO.
- T5: autorrevisión adversarial (mutante: sacar el try/catch a un gesto → test rojo → revertir).
- T6: verificación `node scripts/check.mjs` RC=0.

## Superficie confirmada (leída file:line)
- `ManeuverReorderList.tsx` pan: onStart 212, onUpdate 218, onEnd 257, onFinalize 263 — SIN guard. Sospechoso #1.
- `ManeuverReorderList.tsx` badgeTap onEnd 304, bodyTap onEnd 309, PoolRow tap onEnd 489 — SIN guard.
- `ManeuverReorderList.tsx` `gripTapSwallow` = `Gesture.Tap().maxDuration(250)` — SIN callback (nada que blindar).
- `ManeuverReorderList.tsx` `useFrameCallback` (571): NO es event-handler (registry de frames, otro path
  nativo); el crash NO lo involucra (stack `UIEventHandler`) → NON-TARGET declarado, se deja byte-idéntico.
- `WheelPicker.tsx` `useAnimatedScrollHandler({onScroll})` 285 — SIN guard. Único scroll handler del repo.
- `WheelPicker.tsx` `WheelCell` useAnimatedStyle (123): style worklet, NO event-handler → fuera de scope.
- `BottomSheetShell.tsx` buildDragGesture (451-548): YA blindado (onBegin/onStart/onUpdate/onEnd/onFinalize
  con try/catch + `if(__DEV__)throw`). No se toca; el guard debe seguir viéndolo verde.
- `DientesStep.tsx`: solo una MENCIÓN de `Gesture.Tap()` en un comentario; sin gesto real.
- Sin `useAnimatedGestureHandler` (API v1 legacy) ni `useEvent`/`useHandler` crudos en el árbol.

## Lo que se hizo (tasks)

- [x] T1 — `ManeuverReorderList.tsx` pan (`Gesture.Pan()`): cada callback (onStart/onUpdate/onEnd/onFinalize)
  envuelto en `try/catch`. En release el `catch` degrada a gesto inerte reseteando `dragY.value=0`,
  `activeKey.value=''`, `autoScrollDir.value=0` (la fila vuelve a su slot por el spring de `positions`); en
  `__DEV__` re-lanza. Happy-path byte-idéntico (los cuerpos originales quedaron dentro del `try` sin cambio).
- [x] T2 — `ManeuverReorderList.tsx` `badgeTap`/`bodyTap`/`PoolRow` tap (`Gesture.Tap().onEnd`): mismo
  blindaje. Sin estado de drag que resetear → el `catch` solo re-lanza en DEV (release deja el tap inerte).
- [x] T3 — `WheelPicker.tsx` `useAnimatedScrollHandler({onScroll})`: cuerpo envuelto en `try/catch`
  (fail-closed: rueda quieta si tira; el SETTLE/lock nativo asienta al soltar). Catch param `err` (no pisa el
  arg `e`). Es el único scroll handler del repo y encaja con el stack `UIEventHandler::process`.
- [x] T4 — `worklet-callbacks-guard.test.ts` extendido con la REGLA 2: enumera estáticamente TODOS los
  callbacks de gesto RNGH (SOLO dentro de una cadena `Gesture.…`, vía `gestureChainRegions` → sin colisión con
  `db.onChange` de PowerSync ni props JSX) + los handlers de `useAnimatedScrollHandler`, y exige el blindaje
  (`try` + `catch` + `if(__DEV__)throw`) en cada cuerpo. Cobertura CALCULADA (no lista a mano) con piso
  `WORKLET_CALLBACK_FLOOR=10` (hoy enumera 13) + archivos-testigo (BottomSheetShell/ManeuverReorderList/
  WheelPicker) + válvula de escape justificada `worklet-blindaje-disable-next-line -- <razón>`. Un gesto/scroll
  worklet nuevo SIN blindaje nace en ROJO.
- [x] T5 — autorrevisión adversarial (abajo).
- [x] T6 — `node scripts/check.mjs` RC=0 (incluye typecheck del cliente + la suite unitaria con el guard).

## Trazabilidad (fix-de-clase → red que corre en check.mjs)

El crash es del UI runtime NATIVO (worklet en el hilo de UI); web/E2E (react-native-web) NO ejercitan
`UIEventHandler::process` → una E2E nueva no lo cazaría. La red concreta es el guard ESTÁTICO que corre en
`check.mjs`:
- Blindaje de cada gesto/scroll → `app/src/components/worklet-callbacks-guard.test.ts` :: "cada callback de
  gesto RNGH / animated-scroll-handler está BLINDADO (try/catch + if(__DEV__) throw)".
- El guard sabe fallar (oráculo no muerto) → mismo archivo :: "el guard de BLINDAJE sabe FALLAR (detecta un
  callback sin try/catch, y no se confunde con db.onChange)".
- No-regresión de la REGLA 1 (`runOnJS(X.y)`) → tests preexistentes intactos, siguen verdes.

## Autorrevisión adversarial (paso 8)

Qué busqué y qué encontré:
- **¿El guard sabe fallar (no verde-vacío)?** Mutante REAL sobre `WheelPicker.tsx` (saqué el try/catch al
  `onScroll`) → test ROJO señalando `WheelPicker.tsx:291 scrollHandler.onScroll`. Revertido.
- **¿Cubre la rama de cadena de gestos, no solo el scroll handler?** Segundo mutante REAL sobre el `PoolRow`
  tap (saqué el try/catch) → test ROJO señalando `ManeuverReorderList.tsx:548 Gesture.onEnd`. Revertido.
  Ambos casos también cubiertos con contenido sintético dentro del propio guard.
- **¿Falsos positivos?** Verifiqué que `db.onChange(...)` (PowerSync, 8 usos) y una prop JSX `onEnd={fn}` NO
  se enumeran (el scan está ACOTADO a regiones `Gesture.…`) — assert sintético + el hecho de que el guard pasa
  verde con esos usos en el árbol. `gripTapSwallow`/`Gesture.Race` (sin callbacks) no suman sitios.
- **¿Happy-path intacto?** `git diff -w` muestra que ManeuverReorderList/WheelPicker sólo suman líneas
  nuevas (los try/catch + comentarios) sin borrar código de los cuerpos; la única diferencia con formato es la
  indentación por el `try`. El orden de sentencias en `onEnd` se preservó (commit antes de los resets).
- **¿`'worklet'` cambia el thread?** No: los callbacks de gesto ya eran worklets del UI runtime
  (acceden a `.value` y llaman `runOnJS`); el directive explícito es inerte (idempotente con el
  auto-workletize de RNGH) y alinea con el patrón de `BottomSheetShell`. El `onScroll` ya lo tenía.
- **¿El `catch` puede re-tirar y volver al abort?** El `catch` sólo escribe `useSharedValue`s legítimos
  (host objects serializables) → en la práctica no re-tira; mismo argumento que `BottomSheetShell` documenta.

## Non-target declarado (con motivo)

`useFrameCallback` de `ManeuverReorderList.tsx:571` NO se blinda ni se exige: los frame callbacks corren por
otro registry (no por `UIEventHandler::process`), el stack del crash NO los involucra, y su cuerpo ya es
defensivo (early-returns + null-checks + una fn PURA testeada). Se dejó byte-idéntico para no tocar más de lo
evidenciado. Igual `useAnimatedStyle`/`useDerivedValue` (worklets de estilo/derivados, no de evento) quedan
fuera de scope.

## Reconciliación de specs

Fix de CLASE a feature 03 (`done`), puramente defensivo: envuelve callbacks en `try/catch` + agrega un guard
de test. NO cambia ningún comportamiento afirmado por un requirement (R1.4/R1.5/R1.12/R1.13 del reorder,
R14.5 de la rueda): el happy-path es byte-idéntico → ninguna spec queda contradicha. No edité specs
(`specs/done/*` requiere confirmación humana por CLAUDE.md y no hay qué reconciliar). El memoria-guard
`worklet-callbacks-guard.test.ts` documenta el bug y su clase en su propio header (auto-explicativo).

## Notas de coordinación

- NO toqué `feature_list.json`, `progress/current.md`, `progress/plan.md` ni marqué nada `done` (owna el
  leader). NO commit, NO push.
- `docs/backlog.md` aparece modificado en el working tree PERO no lo toqué yo: es la entrada del leader que
  documenta este mismo crash (fechada 2026-08-01, con el mismo diagnóstico y "próximo paso sugerido" que esta
  tarea implementa). Lo dejé intacto.

## Dudas abiertas

- Sin dSYM no hubo pinpoint de la línea que tiró; el fix es de-clase (blinda toda la superficie de
  event-worklets). Si feature 17 (Sentry) entra, simbolizaría la línea exacta y confirmaría cuál era el throw.
- Verificación en DEVICE pendiente (fuera de mi alcance: el crash es nativo y no reproducible en web/E2E). El
  guard estático es la red que corre en CI; la confirmación empírica del no-crash requiere un build de device.
