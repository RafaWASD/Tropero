# Review — FIX SNAP/LOCK rueda inercial (spec 03 M6, 2026-06-18)

**Alcance**: bugfix ACOTADO del lock/snap de `WheelPicker` (CE + edad). NO se re-revisa M6 backend/gating/RLS (ya pasó Gate 2; este diff no toca DB/red/inputs/auth).

## Veredicto: APPROVED

## Trazabilidad R<n> ↔ test
- **R14.5 (snap al valor, rueda CE)** ↔ `wheel-picker.test.ts` `snapOffset: un offset a mitad de camino LOCKEA en la celda más cercana (CE)` + `snapOffset: clampa en los bordes` + `isOffsetSnapped: true SOLO cuando...`; e2e `maniobra-circunferencia-escrotal.spec.ts` `SNAP: la rueda de CE y la de EDAD lockean EXACTO...` (suelta a cell*2,7→idx3→"21,5"; cell*2,4→idx2→"21"; assert scrollTop múltiplo exacto).
- **R14.7 (rueda de meses, mismo idiom)** ↔ `wheel-picker.test.ts` `snapOffset: AGE_WHEEL lockea igual`; e2e mismo test, rama EDAD (ageCell*5,7→idx6→"12 meses al medir", scrollTop múltiplo exacto).
- **R14.5.0 (AS-BUILT lock JS-driven, anti-loop)** ↔ `isOffsetSnapped` tests (anti-relock dentro de eps + fuera de rango); e2e `expectWheelLocked` (lockea y queda lockeado).

## Tasks completas: sí
tasks.md línea 518 (FIX SNAP/LOCK) reconcilia el as-built; el chunk M6-C.1 base ya estaba `[x]`. No quedan `[ ]` del fix sin justificar.

## check.mjs / tests
- `client unit tests OK` (incluye wheel-picker.test.ts con los +6 del snap). typecheck client OK. anti-hardcode 0.
- Único rojo: `supabase/tests/animal/run.cjs` → `animals_tag_unique` (23505 duplicate key) = flake cross-terminal documentado (memoria "Check rojo = rate-limit / tag_unique dup por 2 terminales"). AJENO al fix (frontend-only, sin DB/red). NO bloquea.

## Checklist RAFAQ-específico (secciones aplicables)
- **A (multi-tenancy/RLS)**: N/A — el fix no toca tablas/policies.
- **B (offline-first)**: N/A para el diff del snap (no toca repos/SQLite/sync); el path de persistencia es de M6-C.1, fuera de alcance.
- **C (BLE)**: N/A.
- **D (UI de campo)**: [x] target de arrastre = área de la rueda (no celda); [x] una decisión por pantalla; [x] el lock da feedback inmediato (snap visible + tick háptico una vez); [x] descendentes: WheelCell con `lineHeight={cellTextSize}` matcheado (celdas = dígitos+coma, sin g/q/p/j/y; lineHeight correcto igual); sheet "Edad del toro" lineHeight matcheado.
- **E (Edge Functions)**: N/A.

## Foco de revisión (los 7 puntos del pedido) — todos OK
1. **Correctitud snap**: `snapOffset` reusa `offsetToIndex` (round+clamp [0,n-1]) → siempre celda más cercana, clampada en [min,max]. Overscroll (negativo / >last) clampea adentro (tests de bordes CE+AGE). ✓
2. **Loops/jitter**: `isOffsetSnapped` hace idempotente el scrollTo programático (re-onScroll/settle = no-op en múltiplo). `scheduleSettle` debounce (clearTimeout previo). momentum-end cancela el drag-settle diferido. El glide animado del lock es ≤0,5 celda → `Math.round` no cruza de bucket → sin notify intermedio. ✓
3. **No-momentum (drag lento, suelta quieto)**: web = settle desde onScroll; native = onScrollEndDrag→settle diferido que corre si no llega momentum-end. Cubierto en ambos. ✓
4. **Sincronía campo→rueda**: `lastNotified` seteado antes del scrollTo(animated:false) → eco no re-notifica; settle pendiente cancelado; `offsetY` sincronizado → settle posterior = no-op. Sin loop de feedback. ✓
5. **Pureza/tests**: aritmética en wheel-picker.ts (snapOffset/isOffsetSnapped reusan helpers existentes, cero duplicación); e2e prueba el lock REAL (offset múltiplo exacto + valor canónico es-AR) a 360/412 con el idiom scrollTop+dispatch('scroll') ya establecido (maniobra-custom-bugfix). ✓
6. **Descendentes**: lineHeight matcheado en WheelCell y títulos. ✓
7. **Reconciliación specs**: design §12.2 AS-BUILT (l.1509), requirements R14.5.0 (l.416), tasks (l.518) describen el lock JS-driven, WEB_SETTLE_MS, handlers nativos, idempotencia y los helpers puros — coinciden con el as-built. ✓

## Nits (NO bloqueantes)
- `WheelPicker.tsx:216` — la dep list de `lockToOffset` lista `[cell, spec, notifyIndex]` con `notifyIndex` (estable por useCallback) pero el comentario dice "shared values y refs no son deps reactivas"; correcto, solo es ligeramente redundante con la línea de eslint-disable. Cosmético.
- `onScroll` agenda `runOnJS(scheduleSettle)` en CADA frame durante el scroll (debounce lo absorbe). En native es trabajo extra menor (los handlers nativos lockean primero); aceptable, ya documentado en el comentario.

## Cambios requeridos: ninguno.
