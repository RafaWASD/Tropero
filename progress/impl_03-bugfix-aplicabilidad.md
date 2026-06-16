baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

# impl_03 — BUGFIX aplicabilidad per-animal (doble pesaje + tacto a machos) + renames de labels

Feature `03-modo-maniobras` (in_progress). Tarea acotada de LÓGICA PURA + labels, **frontend puro** (sin backend/schema). Reportada por Raf testeando MODO MANIOBRAS en `pnpm web`.

## Bugs reportados
1. **Doble pesaje**: `pesaje` y `pesaje_ternero` mapean ambos al data_key `peso` (MANEUVER_DATA_KEY_REQS) y ambos `appliesToAnimal → true` → un animal pasa por los DOS pasos de peso.
2. **Tacto a machos**: `tacto` (preñez) y `tacto_vaquillona` (aptitud) se ofrecen a machos (un toro no se tacta).

## Alcance (SOLO estas celdas — el resto de la matriz NO se toca, pendiente de validar con Facundo)
- `tacto` → `sex === 'female'`.
- `tacto_vaquillona` → `sex === 'female'`.
- `pesaje_ternero` → `categoryCode ∈ CALF_CATEGORY_CODES` ({ternero, ternera}).
- `pesaje` → `categoryCode ∉ CALF_CATEGORY_CODES` (adulto/recría). `categoryCode` null → NO es ternero conocido → `pesaje` APLICA y `pesaje_ternero` se SALTA (fail-safe).
- `raspado` → `sex === 'male'` (YA estaba — NO cambia).
- Renames de label es-AR (MANEUVER_LABELS): `tacto`='Tacto de preñez', `tacto_vaquillona`='Tacto de aptitud reproductiva (vaquillonas)'. ManeuverKind y data_keys NO cambian.

## Plan
- T1: extender `appliesToAnimal` en `app/src/utils/maneuver-applicability.ts` con las celdas nuevas (tacto sexo, pesaje/pesaje_ternero por categoría, raspado intacto).
- T2: extender `app/src/utils/maneuver-applicability.test.ts` con las celdas nuevas + secuencia integrada (buildSequence + filterByAnimalApplicability).
- T3: renames de labels en `app/src/utils/maneuver-wizard.ts` (MANEUVER_LABELS).
- T4: actualizar call-sites/tests que aseveran los labels viejos (maneuver-wizard.test.ts, maneuver-sequence.test.ts, e2e maniobra-carga.spec.ts). NO tocar event-timeline / agregar-evento (otra superficie).
- T5: verificar (check.mjs + unit + e2e maniobra) + autorrevisión adversarial + reconciliación de specs.

## Tasks (todas [x])
- [x] T1: extender `appliesToAnimal` (tacto/tacto_vaquillona = hembras; pesaje/pesaje_ternero excluyentes por categoría incl. null; raspado intacto). `app/src/utils/maneuver-applicability.ts`.
- [x] T2: tests nuevos en `app/src/utils/maneuver-applicability.test.ts` (celdas nuevas + integración buildSequence∘filterByAnimalApplicability). Narrowed el test "toda OTRA maniobra" a las realmente agnósticas.
- [x] T3: renames de label en `MANEUVER_LABELS` (`maneuver-wizard.ts`).
- [x] T4: asserts que rompían: `maneuver-wizard.test.ts` (label tacto + nuevo de tacto_vaquillona), `maneuver-sequence.test.ts` (summaryRows label), e2e `maniobra-carga.spec.ts:171` (Tacto→Tacto de preñez), e2e `maniobra-sanitaria.spec.ts` test 3 (ternera: pesaje→pesaje_ternero). event-timeline / agregar-evento NO tocados (otra superficie).
- [x] T5: verificación + autorrevisión + reconciliación de specs.

## Mapa R<n> → test
- **R6.2 (tacto preñez = hembras)** → `maneuver-applicability.test.ts`: "R6.2/R6.3: tacto y tacto_vaquillona APLICAN a una hembra", "…NO aplican a un macho", "…sexo desconocido → NO aplican (fail-safe)", "filterByAnimalApplicability saca AMBOS tactos de un macho". Integración: "secuencia: un MACHO con tacto/tacto_vaquillona → ambos se saltan" / "una HEMBRA → tactos sí". e2e `maniobra-carga.spec.ts` (vaquillona female → tacto aplica, label "Tacto de preñez").
- **R6.2/R6.3 rename de label** → `maneuver-wizard.test.ts`: `maneuverLabel('tacto')==='Tacto de preñez'`, `maneuverLabel('tacto_vaquillona')==='Tacto de aptitud reproductiva (vaquillonas)'`. `maneuver-sequence.test.ts`: summaryRows label "Tacto de preñez". e2e `maniobra-carga.spec.ts:171` asserta "Tacto de preñez" en la línea de maniobra.
- **R6.3 (tacto aptitud = hembras)** → mismos tests R6.2/R6.3 (cubren `tacto_vaquillona`). e2e `maniobra-elegir.spec.ts` (vaquillona female → tacto_vaquillona aplica, sin cambio).
- **R6.9 / R6.10 (pesaje vs pesaje_ternero excluyentes por categoría)** → `maneuver-applicability.test.ts`: "R6.10: pesaje_ternero APLICA a ternero/ternera; pesaje NO", "R6.9: pesaje APLICA a adulto; pesaje_ternero NO", "categoría null → pesaje sí, pesaje_ternero se SALTA", "pesaje y pesaje_ternero NUNCA aplican a la vez". Integración: "secuencia: TERNERO → pesaje_ternero, SIN pesaje", "ADULTO → pesaje, SIN pesaje_ternero", "categoría null → pesaje sí". e2e `maniobra-sanitaria.spec.ts` test 3 (ternera elige pesaje_ternero → `· 1 de 1` + weight_events).
- **R6.12 (raspado solo machos, intacto)** → tests R6.12 existentes (sin cambios) + el test agnóstico narrowed verifica que raspado NO está entre las agnósticas.

## Autorrevisión adversarial (qué busqué / qué encontré / cómo lo cerré)
- **Busqué**: que el test "toda OTRA maniobra aplica a cualquier sexo" no quedara mintiendo (ahora tacto/tacto_vaquillona/pesaje/pesaje_ternero SÍ filtran). **Encontré**: ese test los listaba → daría falso-verde si lo dejaba. **Cerré**: lo narrow-eé a las realmente agnósticas (sangrado/vacunación/inseminación/condición/dientes/antiparasitario/antibiótico) y agregué tests dedicados por celda.
- **Busqué (e2e que rompen)**: animales corridos por tacto siendo machos, o por pesaje siendo terneros. **Encontré**: `maniobra-sanitaria.spec.ts` test 3 (TERNERA con sesión `{pesaje}`) — con el nuevo split, `pesaje` ya NO aplica a una cría → la secuencia quedaría VACÍA y el test fallaría. **Cerré**: el test ahora elige `pesaje_ternero` (la maniobra que sí aplica a una cría). Verifiqué el resto: test 1 (macho/toro, sin tacto/pesaje) intacto; carga (vaquillona female, `tacto+pesaje`) intacto; elegir/tacto-bugfix (hembras vaquillona) intactos; seedAnimal default categoryCode = torito/vaquillona (no-calf) → identify/carga sin categoría explícita siguen con pesaje genérico.
- **Busqué (invariante)**: ¿puede un animal pasar por los DOS pesos? **Verifiqué por fuerza bruta** (33 combos sexo×categoría incl. null y string vacío): `pesaje` XOR `pesaje_ternero` = SIEMPRE exactamente uno. El doble pesaje es imposible.
- **Busqué (edge cases)**: `categoryCode` null, `''` (string vacío), sexo null. **Resultado**: null/`'' ` no están en CALF_CATEGORY_CODES → tratados como adulto (pesaje genérico, fail-safe). Sexo null → tactos y raspado se saltan (fail-safe). Todos cubiertos por test.
- **Busqué (no over-reach)**: ¿inventé exclusiones nuevas? **No**: una `ternera` (female) sigue admitiendo `tacto`/`tacto_vaquillona` (la exclusión ternera-vs-tacto es parte del "split fino de hembras" PENDIENTE de Facundo — no la toqué, respetando la regla dura del brief). El resto de la matriz sigue `return true`.
- **Busqué (recorte de descendentes / layout del label largo)**: el label `tacto_vaquillona` largo se renderiza en pool/selected/carga con `numberOfLines={1}` + `lineHeight` matching (regla `feedback_descender_clipping`) → trunca con elipsis, no rompe layout. Sin riesgo. (No es escenario de seguridad; lógica + copy puros.)

## Reconciliación de specs (qué reconcilié)
- **`design.md` §6.bis.4**: agregué "Aplicabilidad per-animal — as-built v2": tactos = hembras + pesaje/pesaje_ternero excluyentes por categoría (incl. null fail-safe), con la nota de que el resto de la matriz queda pendiente de Facundo y que el e2e de la ternera pasó a `pesaje_ternero`.
- **`requirements.md`**: nota de reconciliación bajo R6.2/R6.3 (tactos = hembras + rename de los 2 labels es-AR, sin tocar ManeuverKind/data_keys ni el timeline `REPRO_LABELS`) y bajo R6.9/R6.10 (pesaje vs pesaje_ternero excluyentes por categoría, fail-safe null, mata el doble pesaje). No reescribí los EARS — notas de reconciliación.
- **`tasks.md` M3.1 AS-BUILT**: extendí la línea de `maneuver-applicability.ts` con la v2 (3 ejes) + los tests + el cambio del e2e. No es una task nueva (es un bugfix sobre M3.1/M3.2b ya `[x]`, mismo patrón que los otros `impl_03-bugfix-*`).

## Verificación
- typecheck (`pnpm typecheck`): EXIT 0.
- unit: 301/301 verde en las suites de maniobras + event-timeline (incluye applicability/wizard/sequence). Las 3 suites editadas: 69/69.
- e2e (web build real, Supabase live): `maniobra-carga` 3/3, `maniobra-sanitaria` 8/8, `maniobra-elegir` 2/2, `maniobra-tacto-bugfix` 3/3, `maniobra-wizard` 1/1.
- `node scripts/check.mjs`: rojo SOLO en la suite backend `animal` por `animals_tag_unique` (23505 duplicate key, seed concurrente de terminales paralelas — flake conocido, memoria `reference_check_red_rate_limit`). NO regresión: esta tarea es frontend pura (no toca backend/schema/migraciones).

Frontend puro → Gate 1 N/A. Pendiente: reviewer + Gate 2. NO marqué nada `done`.
