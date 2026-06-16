baseline_commit: 638679fa61672e884fc75b3ae94a855bf9853642

# impl_03-bugfix-tacto — Bug de la pantalla de tacto (MODO MANIOBRAS, spec 03)

> Bug reportado por Raf en testing en vivo (web). Frontend de la carga rápida / tacto. Prioridad alta.
> Backend NO tocado (no hubo mismatch capa1↔capa2: el binding del tacto coincide en ambas capas — ver §Causa raíz #2).

## Síntomas (Raf)
1. La pantalla de tacto muestra OTRA caravana (distinta a la identificada).
2. No avanza al tapear PREÑADA / VACÍA (ni continúa), sin feedback.

## Cómo lo reproduje (web, Playwright a 412×915, build estático contra Supabase remoto)
Armé un campo+rodeo realista de cría y recorrí el flujo de UI completo (config jornada → identificar a MANO →
carga → tacto) con specs de repro temporales (ya borradas), capturando errores de consola/página y un dump
instrumentado del resultado del persist (`window.__captureLog`, ya removido).

- **Camino feliz (manual idv exacto, secuencial multi-animal, re-tacto del mismo animal): TODO funciona.**
  Header correcto, tacto VACÍA/PREÑADA avanza al resumen, persist `ok=true` cada vez. → El bug NO está en el
  camino limpio; es condicional.
- **REPRODUJE "otra caravana"** con un único animal "1428" en el campo y tecleando "42": la búsqueda manual
  (substring `LIKE '%42%'`) devolvía 1 solo match (idv "1428", que CONTIENE "42") → el cliente lo trataba como
  `found` y **auto-avanzaba** a la carga rápida del animal EQUIVOCADO (header "X-1428"). Exactamente el síntoma.
- **"No avanza"**: no lo reproduje en condiciones limpias (el persist nunca falla con DB booteada). Es el
  **error tragado**: ante un fallo del write LOCAL (ok:false) o un throw (ej. `getPowerSync()` no booteó —
  está FUERA del try de `runLocalWrite`), `captureAndAdvance` avanzaba igual (ignoraba el ServiceResult) o el
  `void captureAndAdvance(...)` se comía el throw → tapear PREÑADA/VACÍA no hacía nada, sin feedback.

## Causa raíz EXACTA + fix de cada síntoma

### #1 — "otra caravana" = auto-avance de un match por SUBSTRING (no exacto)
- **Causa**: `searchAnimals` corre, además del exacto, un substring/fuzzy `LIKE '%texto%'` sobre idv/tag/visual
  (degradación de pg_trgm a SQLite, `animals.ts`). `resolveManualIdentify` trataba **cualquier** resultado
  único como `found` → auto-avance sin confirmar, AUNQUE el match fuera por substring (la caravana sólo
  CONTIENE el texto). Tecleo "42" → único match idv "1428" → se cargaba "1428".
- **Fix (cliente, sin backend)**: en `app/src/utils/maniobra-identify.ts`, el auto-avance manual exige match
  **EXACTO** (`isExactMatch`: idv | visual_id_alt | tag_electronic === texto, case-insensitive + trim). Un
  único match NO-exacto → `ambiguous` → `CandidatePicker` de confirmación. Copy del picker adaptado para 1
  candidato (`CandidatePicker.tsx`: "No hay ninguna caravana <texto> exacta. ¿Querías este animal? Confirmá o
  dalo de alta."). El flash de confirmación al elegir muestra la caravana del animal ELEGIDO, no el texto
  tecleado (`onPickCandidate`, `identificar.tsx`). El camino rápido del idv/visual EXACTO queda intacto.

### #2 — "no avanza" = error de persistencia TRAGADO (no mismatch capa1↔capa2)
- **Verificación de gating**: el binding del tacto COINCIDE en ambas capas — capa 1 `MANEUVER_DATA_KEY_REQS.tacto
  = ['prenez','tamano_prenez'] (all)` y capa 2 `tg_reproductive_events_gating` exige `['prenez','tamano_prenez']`
  (0054). Ambos data_keys son default-enabled en cría (0018). NO hay mismatch → NO se tocó backend.
- **Causa**: el write es CRUD-plano offline → el local write SIEMPRE devuelve ok offline; el rechazo de gating
  capa 2 es ASÍNCRONO (al subir) y NO llega a `captureAndAdvance`. El "no avanza" sólo puede venir de un
  fallo/throw del write LOCAL, que el frame **tragaba**: `await persistManeuverEvent(...)` sin chequear el
  `ServiceResult` + el call-site `void captureAndAdvance(...)` SIN try/catch.
- **Fix (cliente)**: `captureAndAdvance` (`carga.tsx`) ahora es **fail-closed**: chequea el resultado de
  `persistManeuverEvent`/`softDeleteManeuverEvents` (`resolveCutCategory` también dentro del try) y se envuelve
  en try/catch; ante fallo, **NO avanza** y superficia `ManeuverErrorBanner` (`testID="maneuver-capture-error"`,
  terracota, es-AR accionable "No se pudo guardar la maniobra. Tocá de nuevo para reintentar…" + detalle
  atenuado). `setCaptured` pasó a correr **después** del write confirmado (antes optimista). Guard `capturingRef`
  contra doble-tap (se libera en `finally`). Cumple el espíritu de R5.7/R10.8 (rechazo observable). El reintento
  (tocar de nuevo) procede.

## Archivos tocados
- `app/src/utils/maniobra-identify.ts` — auto-avance manual sólo con match exacto (`isExactMatch`). (+test)
- `app/src/utils/maniobra-identify.test.ts` — +5 casos (exacto idv/visual/tag → found; substring → ambiguous;
  sin display → ambiguous seguro).
- `app/app/maniobra/identificar.tsx` — `onPickCandidate` usa la caravana del animal ELEGIDO para el flash.
- `app/app/maniobra/_components/CandidatePicker.tsx` — copy adaptado para 1 candidato (confirmación).
- `app/app/maniobra/carga.tsx` — `captureAndAdvance` fail-closed + `ManeuverErrorBanner` + `capturingRef`.
- `app/app/maniobra/_components/maneuver-e2e-fault.ts` — NUEVO (e2e-only, gated `window.__RAFAQ_MANEUVER_FAULT__`,
  patrón de `ble-e2e-flag.ts`): inyecta una falla de persist determinística para la regresión. Fuera de prod.
- `app/e2e/maniobra-tacto-bugfix.spec.ts` — NUEVO (3 escenarios de regresión).
- Specs reconciliadas: `requirements.md` (notas R3.5/R4.2/R5.8), `design.md` (as-built bugfix), `tasks.md`
  (task BUGFIX-TACTO).

## ¿Se tocó backend?
**NO.** El diagnóstico descartó el mismatch capa1↔capa2 (binding del tacto idéntico en ambas capas). Ambos
fixes son frontend puro. → Gate 1 N/A; Gate 2 (code) sí.

## Trazabilidad R<n> → test
- **R3.5 / R4.2 (auto-avance manual sólo con exacto / picker de confirmación)** →
  `app/src/utils/maniobra-identify.test.ts`: "1 candidato que matchea EXACTO el idv → found", "…visual…",
  "…tag…", "FIX otra-caravana: 1 candidato substring (NO exacto) → ambiguous", "…SIN campos de display →
  ambiguous (seguro)". + e2e `app/e2e/maniobra-tacto-bugfix.spec.ts` (1) substring → picker → confirma → carga
  la correcta; (1b) match exacto → auto-avance preservado.
- **R5.7 / R5.8 / R10.8 (persistencia fail-closed, error observable)** → e2e `maniobra-tacto-bugfix.spec.ts`
  (2): persist falla → `maneuver-capture-error` visible + NO avanza (no llega a "Revisá la carga"); reintento
  → avanza al resumen + persiste server-side (`waitForServerTactoWithSession(profileId,'empty')`).
- **No-regresión** del camino feliz: `app/e2e/maniobra-identify.spec.ts` (8/8, incluye (d) manual por idv exacto
  → auto-avance) + `app/e2e/maniobra-carga.spec.ts` (flujo completo tacto+pesaje+persist, corrección, offline).

## Autorrevisión adversarial (qué busqué / qué encontré / cómo lo cerré)
- **¿El camino rápido exacto se rompió?** Verifiqué con e2e (identify (d) por idv exacto + carga flujo completo):
  auto-avance preservado. ✅
- **¿La BLE quedó afectada?** No: `resolveBleIdentify` siempre es exacto por tag único global → `found` directo.
  El fix sólo toca el manual. ✅
- **¿`resolveCutCategory` (dientes) podía tirar fuera del try?** Estaba dentro de `captureAndAdvance`; ahora todo
  el cuerpo está en try/catch → cubierto. ✅
- **¿Doble-tap del operario?** `capturingRef` ignora el 2do tap mientras el 1ro está en vuelo; se libera en
  `finally` → el reintento tras un error funciona (probado en e2e (2)). ✅
- **¿`setCaptured` optimista mostraba un valor que no persistió?** Lo moví a DESPUÉS del write confirmado → el
  resumen sólo muestra lo realmente guardado. ✅
- **¿El picker de 1 candidato confunde (copy "Hay 1 animales")?** Adapté el copy y el flash → claro. ✅
- **¿`onCreateFromPicker` precarga bien?** Usa `outcome.identifier` (el texto tecleado "42") → dar de alta con
  "42" (lo que el operario buscaba). ✅
- **EDGE no cerrado (anotado para el reviewer, NO en scope del bug de tacto)**: en la rama `vaccination`
  (multi-write, M3.2) el `lastWriteCountRef.current[maneuver] = newCount` se setea ANTES del persist; si el
  persist falla y se reintenta, el `lastCount` ya es `newCount` → la limpieza de huérfanos no re-corre. No
  afecta tacto/pesaje (el bug reportado). El comportamiento no es PEOR que antes (antes avanzaba igual). Lo dejo
  documentado para M3.2; moverlo post-persist requiere repensar el orden soft-delete↔persist (el soft-delete
  debe correr ANTES del re-INSERT). Fuera del alcance de este bugfix.
- **`gating.loading` reaparece en un sync mid-tacto** → el frame muestra el spinner (no un "tap no hace nada");
  recupera al terminar el load. Es flicker, no el "no avanza" reportado. Anotado, fuera de scope.

## Reconciliación de specs
`requirements.md` (notas de reconciliación bajo R3.5/R4.2/R5.8 — no reescribí los EARS), `design.md` (bloque
AS-BUILT bugfix tacto), `tasks.md` (task `[x] BUGFIX-TACTO`). El código y las specs no se contradicen.

## Estado de verificación
- `node scripts/check.mjs` → **VERDE** (unit incluye +5 casos nuevos; backend suites OK; sin flake este run).
- e2e regresión `maniobra-tacto-bugfix.spec.ts` → **3/3 passed**.
- e2e no-regresión `maniobra-identify.spec.ts` → **8/8 passed**; `maniobra-carga.spec.ts` → 3/3 (1 flake de
  auth/keypad-tap en una corrida, verde al re-correr — documentado como flake conocido, no regresión).
- `tsc --noEmit` → 0 errores. Instrumentación temporal y specs de repro **removidas**.

## NO marco done — espera reviewer + Gate 2 (code).
