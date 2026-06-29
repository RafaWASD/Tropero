baseline_commit: b7c2554c4b970fab9fe6180188ab0ea6d07d6448

# Impl — Delta REFINAMIENTO DEL FORMULARIO DE ALTA (#3 / #13 / #14) (spec 02, Nivel B ADR-028)

**Feature**: 02-modelo-animal (in_progress) — delta `alta-form-refinamiento`.
**Contrato**: `specs/active/02-modelo-animal/{requirements,design,tasks}-alta-form-refinamiento.md` (RAF2.1–RAF2.4).
**Gate 1**: N/A (frontend puro, sin migración/RLS/RPC — design §6). **No se toca DB.**

## Plan (tasks.md del delta)
- T1 — `animal-birth-year.ts`: `sanitizeDayMonthInput` + `validateBirthDate` (reusa `validateBirthYear`/`birthYearToDate`, intactos).
- T2 — `animal-birth-year.test.ts`: bordes día/mes, bisiesto, futuro, todo-o-nada, año-solo, sanitizer.
- T3 — `crear-animal.tsx`: campo DD/MM + state + sanitizer en vivo.
- T4 — `crear-animal.tsx` onSubmit: reemplazar validateBirthYear+birthYearToDate por validateBirthDate.
- T5 — `ConditionScoreStepper.tsx` (nuevo): stepper presentacional controlado, reusa `condition-stepper.ts`.
- T6 — `CondicionCorporalStep.tsx`: wrapper sin cambio de comportamiento (R6.6). Regresión maniobra.
- T7 — `crear-animal.tsx`: ScoreChips → ConditionScoreStepper compact tri-estado null.
- T8 — `OptionRows`: flag opt-in `allowDeselect`.
- T9 — `crear-animal.tsx`: allowDeselect en dientes/preñez/cría/aptitud → null.
- T10 — `crear-animal.tsx`: control "Sin cargar" bajo el stepper de condición.
- T11 — revisión: "sin cargar" NO se envía (contrato createAnimal intacto).
- T12 — `crear-animal.tsx`: scroll-al-campo (DD/MM + año + peso).
- T13 — revisión: sin DB, tokens, es-AR, lineHeight, offline.
- T14 — `animals.spec.ts` e2e.

## Estado
**DONE (recuperado).** El proceso del implementer murió en background ANTES de actualizar este archivo y relayar su resultado, pero el código + tests quedaron escritos en disco. El **leader verificó el estado recuperado**:
- **typecheck (tsc --noEmit): VERDE.**
- **client unit (touched): 35/35** — `animal-birth-year.test.ts` (validateBirthDate: rangos día/mes RAF2.1.7, bisiesto 2020/2021/2000/1900 RAF2.1.8, futura RAF2.1.9, año-solo→midpoint, todo-o-nada, field:year/dayMonth, sanitizer día-primero) + `condition-stepper.test.ts` (sin cambios, verde).
- **anti-hardcode (ADR-023 §4): 0 violaciones.**
- **Extracción del stepper VERIFICADA behavior-preserving**: `ConditionScoreStepper` (nuevo, `src/components/`) preserva testIDs `score-display`/`score-minus`/`score-plus` + a11y + tokens; `CondicionCorporalStep` (maniobra) lo envuelve con su `useState` + CTA `confirm-step` → contrato R6.6 intacto (guarda de regresión = e2e maniobra + testIDs + condition-stepper.test). Agrega `compact` (embed alta) + `dimmed` (tri-estado null "sin cargar").
- **Higiene del leader**: revertidos 4 `.png` espurios de `design/maniobra-elegir/` que el run muerto había tocado (no son de este delta).

**PENDIENTE de verificación por el reviewer**: mapa R→test completo (RAF2.x ↔ archivo:test, incl. e2e `animals.spec.ts` reconciliado estático), que NO se rompieron los selectores requeridos (rodeo/categoría con `allowDeselect=false`), que "sin cargar" no se envía a `createAnimal`, y la confirmación de que NO toca DB (Gate 1 N/A). T1–T14 implementados; verificar `[x]` en `tasks-alta-form-refinamiento.md`.

## Tasks
T1–T14 implementados (código en disco, typecheck+unit verdes). El veto de diseño del leader (extracción del stepper) = PASS. → reviewer → Gate 2 → Puerta 2.
