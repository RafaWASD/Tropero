baseline_commit: d6ecc9a1be5713c85ac10edb48596616bab30da4

# impl — Delta D2 · Vacunas APLICA/NO-APLICA (spec 03, triage demo-facundo-padre 2026-07-10)

ADR-028 · Nivel A (frontend puro) · Gate 1 N/A. Construido SOBRE el estado actual (D1 ya cambió
`SilentVaccinationStep.tsx` — se respeta su path honesto de 0 vacunas).

## Feature en curso + plan (T1..Tn) — TODAS [x]

- [x] **T1** — Helper puro `vaccine-checklist.ts` (`buildVaccineChecklist`/`appliedVaccineNames`) + test (17 casos).
- [x] **T2** — Helper puro en `maneuver-wizard.ts`: `definedVaccines` + `vaccinationMissingProducts` + test (6 casos).
- [x] **T3** — Parte 1: rediseño de `SilentVaccinationStep.tsx` → CHECKLIST grande APLICA/NO-APLICA (sin input libre).
- [x] **T4** — Wiring `carga.tsx` (JSX only, NO persist): `definedProducts` + `appliedProducts`.
- [x] **T5** — Parte 2: `ManeuverReorderList.tsx` marca de alto contraste "Faltan vacunas" (warn en inline).
- [x] **T6** — Parte 2: `jornada.tsx` bloqueo del continue de etapa 2 + mensaje (FormError terracota) + warn en `inlineConfig`.
- [x] **T7** — Capture `app/e2e/captures/vacunas-checklist.capture.ts` (NO ejecutado — lo corre el leader en Gate 2.5).
- [x] **T8** — Reconciliación spec 03 (notas as-built R6.1 + R1.7 + tabla de deltas + §6.bis SilentVaccinationStep).
- [x] **T9 (extra)** — Reconciliación de la SUITE E2E de regresión rota por el gate D2 (ver abajo).

## Archivos tocados

**Producto:**
- `app/src/utils/vaccine-checklist.ts` (NUEVO) — cerebro puro del checklist.
- `app/src/utils/maneuver-wizard.ts` — `definedVaccines` + `vaccinationMissingProducts` (validación etapa 2).
- `app/app/maniobra/_components/SilentVaccinationStep.tsx` — reescrito: checklist APLICA/NO-APLICA.
- `app/app/maniobra/carga.tsx` — wiring `silent_multi` (JSX; `definedProducts`/`appliedProducts`; persist SIN cambios).
- `app/app/maniobra/_components/ManeuverReorderList.tsx` — `warn` en `InlineConfigResolver` + marca "Faltan vacunas".
- `app/app/maniobra/jornada.tsx` — gate del continue etapa 2 + mensaje + `warn` en `inlineConfig`.

**Tests / infra:**
- `app/src/utils/vaccine-checklist.test.ts` (NUEVO) + `app/src/utils/maneuver-wizard.test.ts` (+6 casos).
- `scripts/run-tests.mjs` — registra `vaccine-checklist.test.ts` en la suite unit.
- `app/e2e/captures/vacunas-checklist.capture.ts` (NUEVO, Gate 2.5).
- E2E de regresión reconciliados: `maniobra-sanitaria.spec.ts`, `maniobra-offline.spec.ts`,
  `maniobra-config-sheet-race.spec.ts`, `maniobra-wizard.spec.ts`, `captures/guardar-rutina.capture.ts`.

**Specs:** `specs/active/03-modo-maniobras/{requirements,design}.md` (notas as-built in-place, ver T8).

## Requirements → tests (trazabilidad)

- **R6.1 (D2 — checklist APLICA/NO-APLICA por animal, supera captura por-animal):**
  - `vaccine-checklist.test.ts` → default todas APLICA · corrección respeta (des)tildado · `applied=[]` todas NO
    APLICA · match case-insensitive · defensa legacy · `appliedVaccineNames` subset · 0 tildadas → `[]`.
  - `maneuver-sequence.test.ts` (pre-existente, sigue verde) → `describeStepValue({vaccination, products:[]})` = "Sin
    vacuna"; `['Aftosa','Mancha']` = "Aftosa, Mancha" (path honesto D1 conservado).
  - Capture `vacunas-checklist.capture.ts` → 04 todas APLICA (CTA "Aplicar y seguir") · 05 una NO APLICA · 06 cero
    (CTA "Seguir sin aplicar").
  - Regresión: `maniobra-sanitaria.spec.ts` (2 vacunas definidas → 2 `sanitary_events`, oráculo server-side) +
    `maniobra-offline.spec.ts` (1 vacuna, offline, escribe `sanitary_events`).
- **R1.7 (D2 — etapa 2 exige ≥1 vacuna definida):**
  - `maneuver-wizard.test.ts` → `vaccinationMissingProducts` (elegida sin/con vacuna, no elegida) + `definedVaccines`
    (string / objeto `{products}` / vacía / ausente).
  - Capture → 01 "Faltan vacunas" + continue bloqueado ("Completá las vacunas") + mensaje · 02 sheet preconfig ·
    03 vacuna definida → continue habilitado.
  - Regresión: `maniobra-config-sheet-race.spec.ts` + `maniobra-wizard.spec.ts` (marca "Faltan vacunas" al no
    definir; `selected-config-warn-N`).

## Verificación

- `pnpm -C app exec tsc --noEmit` → EXIT 0.
- Unit: `vaccine-checklist` + `maneuver-wizard` + `maneuver-sequence` + resto de la familia maniobra → **217/217**.
- Anti-hardcode (`scripts/check-hardcode.mjs`) → 0 violaciones.
- E2E: NO ejecutado (per instrucción — no `check.mjs` completo ni `e2e:build`). Los .spec reconciliados + el
  `.capture.ts` los corre el leader en Gate 2.5. Typecheck ad-hoc de los e2e editados: sin errores reales (solo
  artefactos de node-globals/`Page` re-export que afectan a TODO e2e por igual — el repo no typechea e2e).

## Autorrevisión adversarial (qué busqué / qué encontré / cómo lo cerré)

1. **Estado stale entre animales** (crítico): el paso se re-monta por `key=${maniobra}-${stepEntryNonce}` en
   `carga.tsx` (nonce cambia al entrar a cada paso) → el `useState` inicializador re-corre fresco por animal/paso.
   Sin fuga de estado. OK.
2. **Pérdida del universo al corregir**: si sólo pasara `captured.products` (las aplicadas), una vacuna NO-APLICA
   desaparecería del checklist al corregir → el operario no podría re-tildarla. Por eso `carga.tsx` pasa
   `definedProducts` (universo, SIEMPRE del preconfig) + `appliedProducts` (subset). `buildVaccineChecklist` une
   ambos. Testeado.
3. **`applied=[]` vs `undefined`**: distinguidos — `undefined` = primer paso (todas APLICA); `[]` = corrección con
   todas NO APLICA. Sin colapsar los dos casos. Testeado.
4. **Persist sin cambios / huérfanos**: `onConfirm` devuelve el subset TILDADO (mismo contrato que antes) → el
   orquestador escribe N filas y el soft-delete de huérfanos por `lastWriteCountRef` (D1, carga.tsx sin cambios)
   maneja N→M. No toqué el persist.
5. **0-path honesto D1**: 0 tildadas → CTA "Seguir sin aplicar" (→) → `onConfirm([])` → "Sin vacuna" → 0 filas.
   Conservado (CTA siempre habilitado).
6. **Empty state (0 definidas)**: legacy sin preconfig → checklist vacío + nota + "Seguir sin aplicar" (no atrapa
   al operario). El gate de etapa 2 lo previene en sesiones nuevas.
7. **Gate etapa 2 fuga a etapa 3**: no se llega a etapa 3 con Vacunación sin vacunas (el gate del continue lo
   bloquea); `onArrancar`/`onSavePreset`/`onGuardarCambios` no necesitan re-validar. Verificado por lectura de flujo.
8. **Contraste manga**: `$bg` (#faf9f9) ≈ `$surface` (#F8F6F1) → NO sirven para figura-fondo. Rediseñé: APLICA =
   `$greenLight` (pop) + borde `$primary` + casilla llena; NO APLICA = `$white` + borde `$divider` + casilla vacía
   + rótulo `$terracota`. 3 señales redundantes.
9. **Regresión E2E**: el gate D2 rompía 5 specs/captures que elegían Vacunación sin definir vacuna (o asertaban el
   hint viejo). Reconciliados TODOS (definir la vacuna en etapa 2 o asertar la marca "Faltan vacunas"). Sin dejar
   refs a los testIDs eliminados (`vaccine-input`/`-chip`/`-suggestion`) — grep 0.

## Reconciliación de specs (as-built)

- **`requirements.md`**: nota as-built D2 bajo **R6.1** (checklist APLICA/NO-APLICA supera la captura por-animal de
  R6.1/R1.8; conserva el 0-path de D1) + nota as-built D2 bajo **R1.7** (endurecimiento etapa 2: exige ≥1 vacuna).
  Los EARS no se reescriben (notas de reconciliación, patrón D1/impl_13).
- **`design.md`**: fila `vacunas-aplica-no-aplica (D2)` en "Deltas posteriores" + nota "SUPERADO por D2" en la
  descripción de `SilentVaccinationStep` (§6.bis card dominante).
- **Reconciliación in-place** (no delta-spec files nuevos), consistente con cómo se folded D1 y `skip-animal`.

## Nota para el leader (Gate 2.5)

Correr: `pnpm exec playwright test e2e/captures/vacunas-checklist.capture.ts --config playwright.capture.config.ts`
→ 6 capturas en `app/e2e/captures/__shots__/vacunas-checklist/` (01 faltan-vacunas · 02 sheet · 03 vacuna-definida ·
04 todas-aplica · 05 una-no-aplica · 06 cero-seguir-sin-aplicar). El `.capture.ts` se commitea; los `__shots__/*.png`
van gitignored. Además, correr la suite de regresión de maniobra (sanitaria/offline/wizard/config-sheet-race +
guardar-rutina) por el gate D2 antes de la Puerta 2.
