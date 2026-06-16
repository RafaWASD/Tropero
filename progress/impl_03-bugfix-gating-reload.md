baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

# impl_03-bugfix-gating-reload — Recarga que blanquea la carga rápida y pierde el peso tecleado (spec 03)

> Bug reportado por Raf en testing en vivo (`pnpm web`). Frontend de la carga rápida (MODO MANIOBRAS).
> Backend NO tocado (es un bug de ciclo de vida de un hook de cliente, sin schema/RLS/Edge).

## Síntoma (Raf)
Tecleando el peso en "pesaje de ternero", ~1s después la pantalla "se puso en blanco y volvió a cargar" y los
números tecleados se perdieron. Feo + pérdida de datos en curso.

## Root cause (diagnosticado por Raf, confirmado leyendo el código)
- `app/src/hooks/useManeuverGating.ts`: `load()` hace `setLoading(true)` en CADA invocación, y `load()` se
  dispara (a) al ENFOCAR (`useFocusEffect`) y (b) en CADA avance de sync de PowerSync (`useEffect` sobre
  `lastSyncedMs`).
- `app/app/maniobra/carga.tsx` línea ~437: `if (!animal || !session || gating.loading || gatingPending)`
  devuelve el spinner full-screen "Abriendo el animal…".
- Secuencia del bug: un sync de fondo completa → `lastSyncedAt` cambia → `load()` → `loading=true` → el frame
  entero se reemplaza por el spinner → `PesajeStep` se DESMONTA → su estado local `peso` (lo tecleado) se
  pierde → al volver `loading=false` remonta vacío.

## Fix (stale-while-revalidate, root cause en el hook)
`loading=true` SOLO en la carga INICIAL del rodeo (no tenemos config para ESE rodeo todavía). En revalidación
en BACKGROUND (focus/sync) del MISMO rodeo: mantener el `config` previo visible y NO flipear `loading`
(revalidación silenciosa). Al CAMBIAR de rodeo (rodeoId distinto): sí volver a `loading=true`.

Decisión de testabilidad (architecture.md: lógica de decisión PURA, hooks orquestan): la decisión "¿flipear
loading ahora?" se extrae a un módulo PURO `app/src/utils/maneuver-gating-load.ts` (`decideGatingLoad`) y se
testea con node:test (mismo runner que el resto de la suite unit, sin RN/React). El hook solo orquesta el
`useRef(loadedRodeo)` + `reqIdRef` (last-request-wins) y llama a la pura.

## Plan (tasks de este bugfix) — TODAS DONE
- [x] T1 — Decisión PURA en `app/src/utils/maneuver-gating-load.ts`: `shouldShowLoadingForLoad(target, loaded)`
  + `initialLoadingFor(rodeoId)`. Sin React, node:test. (El nombre quedó `shouldShowLoadingForLoad`, no
  `decideGatingLoad` — más explícito sobre lo que decide.)
- [x] T2 — Refactor de `app/src/hooks/useManeuverGating.ts`: `loadedRodeoRef` (ref, no state) + flip de
  `loading` SOLO en carga inicial del rodeo (`shouldShowLoadingForLoad`); `useState(() => initialLoadingFor)`;
  `reqIdRef` conservado (last-request-wins); `loadedRodeoRef.current=null` cuando `rodeoId` es null; al éxito
  `loadedRodeoRef.current=rodeoId`. `load` NO lee `config` → deps siguen `[rodeoId]` (sin loop).
- [x] T3 — Defensa en `app/app/maniobra/carga.tsx`: `hasRenderedContentRef` (se prende una vez que el
  contenido renderiza); el spinner full-screen "Abriendo el animal…" sale solo si (animal/sesión sin resolver)
  o (gating no usable Y todavía no renderizamos contenido). Una vez mostrado un paso, un flip transitorio del
  gating NO vuelve al spinner. Check de `animal`/`session` explícito para que TS narrowée a no-null.
- [x] T4 — `app/src/utils/maneuver-gating-load.test.ts` (12 casos) + enganchado en `scripts/run-tests.mjs`.

## Archivos tocados
- `app/src/utils/maneuver-gating-load.ts` (NUEVO, puro)
- `app/src/utils/maneuver-gating-load.test.ts` (NUEVO, 12 tests)
- `app/src/hooks/useManeuverGating.ts` (refactor stale-while-revalidate)
- `app/app/maniobra/carga.tsx` (defensa del spinner)
- `scripts/run-tests.mjs` (enganchar el test nuevo)

## Trazabilidad (no-EARS: bugfix; comportamiento → test concreto)
- Carga inicial → loading true→false, config cargado ......... `maneuver-gating-load.test.ts`
  "escenario: carga inicial → loading true→false y config queda cargado"
- **REGRESIÓN del bug**: revalidación background (mismo rodeo, nuevo sync) → loading NO vuelve a true, config se
  actualiza en silencio ....................................... idem "REGRESIÓN s27: revalidación background…"
  + "múltiples syncs seguidos del mismo rodeo → cero parpadeo"
- Cambio de rodeo → loading SÍ vuelve a true ................. idem "CAMBIO de rodeo → loading SÍ vuelve a true"
- rodeoId null → reset (no loading, config/loadedRodeo null) . idem "rodeoId pasa a null → reset…"
- error transitorio en revalidación no blanquea ............. idem "error transitorio en revalidación…"
- error en carga inicial → no cuelga el spinner ............. idem "error en la carga INICIAL…"
- `shouldShowLoadingForLoad`/`initialLoadingFor` casos base .. idem (5 tests de tabla)

## Autorrevisión adversarial (paso 8)
Busqué, como revisor hostil:
- **(a) PesajeStep NO se desmonta + conserva lo tecleado tras un sync nuevo**: VERIFICADO. Root cause = el
  frame de `carga.tsx` se reemplazaba por el spinner cuando `gating.loading` flipeaba en un sync → `PesajeStep`
  (que tiene el peso en `useState` local, `PesajeStep.tsx:66`) se desmontaba → se perdía. Con el fix del hook,
  un sync del MISMO rodeo NO flipea `loading` → `contentReady` sigue true → el paso NO se desmonta → el peso
  sobrevive. Doble red: el `hasRenderedContentRef` de `carga.tsx` impide volver al spinner aunque el gating
  flipee. Encodeado en el test "REGRESIÓN s27".
- **(b) cambio de rodeo SÍ muestra loading**: VERIFICADO (test "CAMBIO de rodeo…"). En `carga.tsx` el rodeo
  viene de `animal.rodeoId` (estable: el animal se setea una vez por route param y no se resetea a null), así
  que este consumidor solo hace revalidación del mismo rodeo; en `jornada.tsx` (wizard) el rodeo SÍ cambia al
  elegir otro en etapa 1 → ahí el loading vuelve correctamente (strict improvement: antes parpadeaba en cada
  sync; ahora solo en el cambio real). Revisé el render del wizard (`InfoNote` "Cargando las maniobras del
  rodeo…", jornada.tsx:418) — se comporta bien.
- **(c) sin loop de renders / deps estables**: VERIFICADO. `load` deps `[rodeoId]`, NO lee `config`;
  `loadedRodeoRef`/`reqIdRef` son refs (mutarlas no re-renderiza); `useFocusEffect`/`useEffect(sync)` deps
  `[load]`/`[lastSyncedMs, load]` no cambian en una revalidación silenciosa que solo toca el state `config`.
- **Edge revisados**: `useState(() => initialLoadingFor(rodeoId))` da EXACTAMENTE el mismo valor inicial que el
  `rodeoId !== null` previo (sin cambio en el mount); `loadedRodeoRef` se resetea con `rodeoId=null` para que
  el próximo rodeo sea "carga inicial" (no mostrar config stale de otro rodeo); error transitorio en
  revalidación no fuerza `loading=true` (no blanquea). Multi-tenant/offline-first sin cambios (no toca queries,
  scoping ni el path de escritura; es ciclo de vida de UI). Cero hardcode, cero es-AR nuevo (solo comentarios).
- **Mutar `hasRenderedContentRef` en render**: patrón "derived-once" idempotente (solo false→true, leído en el
  mismo pase), seguro y usado en el repo (dedup de auto-avance). No introduce side-effect observable.

Lo que encontré durante la implementación y cerré antes de reportar:
- El typecheck cazó que reemplazar el guard `if (!animal || !session || …)` por una variable booleana rompía el
  narrowing de TS (`animal`/`session` quedaban `| null` en el render). Lo corregí dejando el check de
  `animal`/`session` EXPLÍCITO en el `if` (narrowing) y separando la condición del gating en `gatingSpinner`.

## Reconciliación de specs (paso 9)
No hubo desvío del comportamiento especificado: la spec 03 no define el ciclo de vida interno de
`useManeuverGating` (es detalle de implementación de cliente). El gating de maniobras (qué se ofrece/aplica por
rodeo, R1.4/R1.5/R5.3/R5.5) NO cambia — `config`/`filter`/`resolve*` devuelven exactamente lo mismo; solo cambia
CUÁNDO se muestra `loading`. Offline-first (R10.3) intacto (`fetchRodeoGating` sigue leyendo del SQLite local;
las recargas en focus/sync se mantienen, solo dejan de parpadear). Nada que reconciliar en
`requirements/design/tasks`.

## Verificación
- `app/src/utils/maneuver-gating-load.test.ts`: **12/12** pass.
- `pnpm typecheck` (cliente): **OK**.
- Suite de unit de maniobras (gating/sequence/applicability/step-kind/event-query/identify/edge + el nuevo):
  **152/152** pass.
- e2e `maniobra-carga.spec.ts` (regresión del frame de carga rápida tras el restructure del spinner):
  **3/3** pass (flujo completo + resumen corregible + offline).
- `node scripts/check.mjs`: RC=1 por **flake de terminales paralelas** (edge/rls = rate-limit de auth; animal =
  `duplicate key animals_tag_unique`, colisión de seed de un terminal concurrente) — NO es regresión: este
  bugfix es frontend puro y no toca ninguna suite backend. Typecheck + unit de cliente verdes confirman el
  cambio aislado.
