baseline_commit: 42f76c5dcb1de7262aab439c31feed8fe137b39e

# impl — delta `03-skip-por-paso-v2` (C REDISEÑO + D2 enhancement, Puerta 2 demo-facundo-padre 2026-07-10)

> ADR-028 · Nivel A (frontend puro) · Gate 1 N/A. Dos ajustes de UX en MODO MANIOBRA reportados por Raf
> en la Puerta 2 de la demo. C v1 (skip per-animal) fue RECHAZADO → rediseño a skip POR-PASO. D2 refuerzo
> de afordancia del CTA "Faltan vacunas".
>
> ⚠️ Coordinación: otro implementer corre feature A (lotes) tocando identificar.tsx / ExitJornadaSheet.tsx /
> *-lotes-venta.md. Mis archivos son DISJUNTOS (carga.tsx, SpikeIdentityHeader, SkipAnimalSheet,
> ManeuverReorderList, jornada N/A, maneuver-sequence.ts, maneuver-skip.ts, specs 03).

## AJUSTE 1 — C REDISEÑO: "Saltear" pasa a ser POR PASO

**Modelo nuevo de skip:**
- **Skip POR-PASO = PRIMARIO** en el header (`SpikeIdentityHeader.onSkipStep` + `skipStepLabel`). Nombra la
  maniobra ("Saltear tacto"/"Saltear pesaje", fallback "Saltear paso"). Marca ESE paso `{kind:'skipped'}`
  deliberado y avanza al SIGUIENTE paso del MISMO animal (reusa `captureAndAdvance`).
- **Semántica `{kind:'skipped'}` = HECHO** (no faltante): `isSequenceComplete` cuenta un skipped como listo;
  `firstUncapturedIndex` NO lo re-surfacea; `describeStepValue` → "Salteado".
- **Corrección captura→salteado** (desde el resumen): soft-delete de las filas del paso + RESET de los ids
  del paso (evita choque de PK si se re-captura). Dientes queda fuera (propiedad, no fila).
- **Skip ANIMAL-entero = SECUNDARIO**: overflow "⋯" en el header (`onSkipAnimal`) → SkipAnimalSheet intacto.

## AJUSTE 2 — D2: colorear el CTA de "Faltan vacunas"

- `ManeuverReorderList`: cuando la fila de Vacunación está en `warn` (sin ≥1 vacuna), el chevron '>' pasa a
  ser un afordancia TERRACOTA (círculo lleno + chevron blanco, 5.1:1) = "tocá acá para completar". Terracota
  suelto sobre el verde botella ($primary) da 1.59:1 (falla WCAG) → círculo lleno con contenido blanco.

## Plan (T1..Tn)
- [ ] **T1** — `maneuver-sequence.ts`: semántica skipped=hecho (isSequenceComplete/firstUncapturedIndex),
  describeStepValue→"Salteado", `skipStepButtonLabel` (pure). + tests.
- [ ] **T2** — `SpikeIdentityHeader.tsx`: `onSkipStep`+`skipStepLabel` (pill primaria) + `onSkipAnimal`
  (overflow ⋯ secundario). Callers spike sin skip = layout original.
- [ ] **T3** — `carga.tsx`: `skipCurrentStep` (factory), soft-delete+reset-ids en corrección captura→skip,
  wiring del header (primaria solo en paso factory; overflow en paso+resumen).
- [ ] **T4** — `ManeuverReorderList.tsx` (D2): chevron terracota afordancia en warn + testID.
- [ ] **T5** — `maneuver-skip.test.ts`: target de UN paso (corrección captura→skip).
- [ ] **T6** — E2E: rewrite `skip-animal-maniobra.capture.ts` (skip por-paso + Salteado + animal secundario);
  `vacunas-checklist.capture.ts` (+chevron terracota); nuevo `maniobra-skip-paso.spec.ts` (#1 skip paso,
  #2 skip animal); assert chevron en `maniobra-wizard.spec.ts`. NO los corro.
- [ ] **T7** — Reconciliar spec 03 (R5.15 as-built per-paso+secundario; R1.7 chevron D2). design.md.

## Estado
- [x] T1 · [x] T2 · [x] T3 · [x] T4 · [x] T5 · [x] T6 · [x] T7

## Archivos tocados

**Producto:**
- `app/src/utils/maneuver-sequence.ts` — semántica `skipped`=HECHO (`isSequenceComplete`/`firstUncapturedIndex`),
  `describeStepValue({kind:'skipped'})`→"Salteado", nuevo helper puro `skipStepButtonLabel`.
- `app/app/maniobra/_components/SpikeIdentityHeader.tsx` — reescrito: `onSkipStep`+`skipStepLabel` (pill
  PRIMARIA "Saltear <maniobra>", testID `skip-step`) + `onSkipAnimal` (overflow "⋯" SECUNDARIO, testID
  `skip-animal`). Sin skip = layout original (spikes). Reemplaza la prop única `onSkip`.
- `app/app/maniobra/carga.tsx` — `skipCurrentStep` (paso factory) + rama en `captureAndAdvance` para
  corrección captura→salteado (soft-delete acotado al paso `collectManeuverDiscardTargets({[maneuver]:prev})`
  → `discardManeuverEvents` + RESET de `eventIdsRef`/`extraIdsRef`/`lastWriteCountRef` del paso) + wiring del
  header (`onSkipStep` solo en paso factory; `onSkipAnimal` en paso+resumen, oculto en secuencia vacía).
- `app/app/maniobra/_components/ManeuverReorderList.tsx` — D2 enhancement: chevron '>' de la fila `warn`
  ("Faltan vacunas") → círculo TERRACOTA lleno + chevron blanco (testID `selected-config-fix-<i>`).

**Tests / E2E:**
- `app/src/utils/maneuver-sequence.test.ts` — reescritos los 2 tests de "skipped NO cuenta" → "skipped=HECHO";
  describeStepValue→"Salteado"; summaryRows→"Salteado"; +2 tests de `skipStepButtonLabel`; +test de reanudación.
- `app/src/utils/maneuver-skip.test.ts` — +3 tests de corrección captura→salteado (target de UN paso acotado;
  vacunación multi; dientes excluido).
- `app/e2e/captures/skip-animal-maniobra.capture.ts` — reescrito para el flujo v2 (skip por-paso primario →
  paso siguiente mismo animal → resumen "Salteado" → skip animal secundario). SHOT_DIR `skip-por-paso`.
- `app/e2e/captures/vacunas-checklist.capture.ts` — +assert del chevron terracota `selected-config-fix-0`.
- `app/e2e/maniobra-skip-paso.spec.ts` (NUEVO) — #1 skip por-paso (aptitud → pesaje mismo animal, "Salteado",
  pesaje persiste) + #2 skip animal secundario (descarta + "0 hoy").
- `app/e2e/maniobra-wizard.spec.ts` — +assert `selected-config-fix-2` + continue bloqueado (D2, scenario #3).

**Specs:** `requirements.md` (notas de reconciliación bajo R5.15 y R1.7), `design.md` (fila `skip-por-paso-v2`
en "Deltas posteriores"). `run-tests.mjs` NO tocado (maneuver-sequence/skip ya registrados).

## Trazabilidad (R → test)

- **R5.15 (skip por-paso = HECHO, no bloquea)** → `maneuver-sequence.test.ts`: "un SALTEADO deliberado cuenta
  como HECHO", "solo un paso AUSENTE frena", "reanudar NO re-surfacea un paso salteado". E2E
  `maniobra-skip-paso.spec.ts` #1 (skip aptitud → pesaje mismo animal → "Salteado").
- **R5.15 (resumen "Salteado", corregible)** → `maneuver-sequence.test.ts`: describeStepValue/summaryRows
  "Salteado". Capture `skip-por-paso/03-resumen-salteado.png`.
- **R5.15 (botón nombra la maniobra)** → `maneuver-sequence.test.ts`: skipStepButtonLabel (corto + fallback).
- **R5.15 (corrección captura→salteado soft-borra acotado)** → `maneuver-skip.test.ts`: "target de UN solo
  paso", "vacunación", "dientes excluido".
- **R5.15 (skip animal secundario intacto)** → E2E `maniobra-skip-paso.spec.ts` #2 (descarta + "0 hoy");
  capture 04/05.
- **R1.7 (D2 chevron terracota)** → E2E `maniobra-wizard.spec.ts` (`selected-config-fix-2` + continue
  bloqueado); capture `vacunas-checklist/01`.

## Autorrevisión adversarial (paso 8) — qué busqué / encontré / cerré

1. **¿Un skip deliberado puede quedar "faltante" y bloquear el resumen?** NO — `isSequenceComplete` cuenta
   cualquier valor presente (incl. skipped) como resuelto; solo `undefined` frena. Testeado.
2. **¿La reanudación (firstUncapturedIndex) re-surfacea un paso salteado?** NO — solo apunta `undefined`.
   Testeado ("reanudar NO re-surfacea", "solo un paso AUSENTE frena").
3. **¿La corrección captura→salteado deja huérfanos?** NO — soft-delete acotado al paso + **RESET de los ids
   del paso**. HALLAZGO CLAVE: sin el reset, una re-captura del MISMO paso re-usaría el id soft-deleteado → un
   nuevo INSERT chocaría con la PK del row oculto (PowerSync no upsertea bien, ver local-reads.ts §1485) → el
   valor re-capturado quedaría oculto. Cerré: `delete eventIdsRef/extraIdsRef; lastWriteCount=0` tras el
   soft-delete → re-captura con id FRESCO (INSERT limpio; el row viejo sigue oculto). Fail-closed si el
   soft-delete falla (no avanza).
4. **¿Dientes?** Correcto por construcción: `collectManeuverDiscardTargets` excluye dientes (propiedad, no
   fila) → correcto que su `teeth_state` persista (misma excepción documentada del skip-animal). El reset de
   su id (unused) es inocuo. Testeado.
5. **¿El skip-animal secundario sigue descartando bien?** SÍ — `onConfirmSkip`/`onSkipDone`/`SkipAnimalSheet`
   intactos; el overflow `skip-animal` los abre igual que v1. La navegación resetea todos los ids (useEffect
   keyed en profileId) → sin colisión de PK en el próximo animal.
6. **Custom step + skip:** un paso custom NO tiene primaria (source!=='factory' → `stepSkippable`=false) — el
   modelo custom (CustomCaptureMap) no tiene marcador de skip. El operario escapa un paso custom con el skip
   animal-entero (secundario). Documentado (no un bug — decisión de scope).
7. **Edge #4 (corregir un paso capturado A salteado desde el resumen):** onEdit entra al paso
   (editingFromSummaryRef=true) → el pill de skip está visible → tocar "Saltear <x>" → captureAndAdvance con
   isCorrection=true → soft-delete + reset + skipped + **vuelve al resumen** ("Salteado"). Cerrado por lógica
   de flujo + test del target.
8. **Recorte de labels:** el pill "Saltear <corto>" cap ≤9 chars + numberOfLines={1} + lineHeight $4 matching;
   overflow icon-only. Sin recorte. FLAG para el veto visual del leader: en modo paso, línea 1 = IDV
   (flexShrink=1) + pill + "⋯" → para un IDV LARGO (animal identificado solo por RFID de 15 díg, sin caravana
   visual) la caravana ellipsa para dar lugar (mismo tradeoff que v1, apenas más ancho). El caso común
   (caravana corta "0385") entra holgado. Vetalo con las capturas 01/02.
9. **Contraste D2 chevron:** terracota SUELTO sobre el verde botella $primary = 1.59:1 (FALLA WCAG 1.4.11) →
   por eso NO tinté el chevron suelto; usé un círculo TERRACOTA lleno con chevron BLANCO (5.1:1) — mismo
   patrón/contraste que el pill "Faltan vacunas" ya aceptado. Consistente.
10. **e2e fault hook + skip:** `consumeManeuverPersistFault()` (E2E-only, nunca existe en prod) se chequea en
    captureAndAdvance; ningún test de skip lo arma → inerte. Documentado (edge E2E-only, sin efecto real).

## Verificación
- `pnpm -C app exec tsc --noEmit` → **EXIT 0** (con todos los cambios, incl. e2e).
- Unit familia maniobra (sequence/skip/step-kind/wizard/applicability/event-query/vaccine-checklist/config) →
  **228/228** (34 en maneuver-sequence incl. los nuevos de skip). NO corrí check.mjs completo ni e2e:build ni
  la suite E2E (per indicación + implementer A activo). NO git add/commit.

## Reconciliación de specs (paso 9)
As-built = spec: **notas de reconciliación** bajo R5.15 (skip per-animal→per-paso primario + animal-entero
secundario, semántica skipped=HECHO, corrección captura→skip, contraste) y bajo R1.7 (D2 chevron terracota).
Fila `skip-por-paso-v2` en design.md "Deltas posteriores". Sin reescribir EARS (patrón de los deltas previos).
El fold a la tabla de deltas / Puerta 2 lo hace el leader.

## Para reviewer / Gate 2 / Gate 2.5
- **Gate 2.5 (capturas, NO las corrí):**
  - `pnpm exec playwright test e2e/captures/skip-animal-maniobra.capture.ts --config playwright.capture.config.ts`
    → `__shots__/skip-por-paso/` (01 header 2 afordancias · 02 siguiente paso mismo animal · 03 resumen
    "Salteado" · 04 sheet saltar-animal secundario · 05 vuelta identify).
  - `pnpm exec playwright test e2e/captures/vacunas-checklist.capture.ts --config playwright.capture.config.ts`
    → 01 ahora con el chevron terracota (`selected-config-fix-0`).
- **E2E regresión:** `maniobra-skip-paso.spec.ts` (#1/#2) + `maniobra-wizard.spec.ts` (chevron D2). NO corrí la
  suite (evitar contención de DB con el implementer A + re-render de design/*.png).
- **Veto visual pendiente del leader (§autorrevisión #8):** jerarquía pill-primaria vs "⋯"-secundaria + el
  squeeze de la caravana con IDV largo + el chevron terracota sobre el verde botella.
