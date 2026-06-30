# ADR-029 — Gate de verificación E2E + visual (post-Gate 2, pre-Puerta 2)

**Estado**: Aceptada
**Fecha**: 2026-06-30
**Decisor**: Raf (directiva explícita) + leader

## Contexto

El flujo SDD tenía dos gates automáticos antes de la aprobación humana del código (Puerta 2):

1. **`reviewer`** — verifica correctitud del código contra specs + CHECKPOINTS (estático: lee el diff, corre typecheck/unit).
2. **Gate 2 (`security_analyzer` modo `code`)** — verifica seguridad del diff (estático).

Ninguno de los dos **ejecuta la UI corriendo** ni la **mira**. Los E2E con Playwright se venían corriendo de forma **ad-hoc** (a veces el implementer, a veces el leader a mano), sin ser un paso formal del pipeline. En la práctica eso ya cazó bugs (un test E2E del delta #15 destapó una aserción mal escrita; otra corrida destapó un bug real de producto en `setCustomAttribute`), lo que confirma el valor — pero sin formalización el paso se podía saltar.

Además, ni el reviewer ni el Gate 2 verifican que la pantalla **se vea bien** ni que **cumpla los criterios de diseño** (manga-friendly, anti-recorte de descendentes, tokens, jerarquía, es-AR) ni que el **flujo coincida con el planeado en la spec**. Eso quedaba para el ojo humano en la Puerta 2 — pero el humano aprobaba **sin evidencia visual**, solo leyendo reportes.

Raf pidió explícitamente (2026-06-30): *"agregá al flujo de agentes POST security Gate 2 y PRE aprobación humana de código que corra tests E2E con Playwright y saque capturas de todo para verificar que todo funcione OK y de acuerdo a lo planeado en la spec y con los criterios de diseño."*

## Decisión

Se agrega un gate obligatorio **Gate 2.5 — Verificación E2E + Visual**, entre Gate 2 (PASS) y la Puerta 2 (aprobación humana del código), para toda feature/delta con **UI nueva o modificada**.

### Quién produce qué

- **El `implementer`** entrega, como parte de su trabajo de UI, **dos** artefactos de test:
  1. La suite de **regresión** E2E del feature (`app/e2e/*.spec.ts`, como hoy) — verifica funcionalidad.
  2. Un **archivo de captura dedicado** `app/e2e/captures/<feature>.capture.ts` que recorre el flujo del feature y saca **capturas NOMBRADAS de cada estado clave**: cada pantalla/sheet, los estados de validación (errores inline), los pickers abiertos, los avisos, y los estados vacío/loading/error. Las capturas se escriben a `app/e2e/captures/__shots__/<feature>/<NN>-<estado>.png` (gitignored — ver §Artefactos).

- **El `leader`**, tras **Gate 2 PASS** y antes de presentar la Puerta 2:
  a. Corre la **suite E2E** del feature (config normal) — debe estar **verde**.
  b. Corre el **capture file** con `playwright.capture.config.ts` (viewport mobile real 412×915) → genera las capturas.
  c. **Revisa las capturas** contra (i) el **flujo de la spec** (¿hace lo planeado?, ¿cada RCAP/R<n> con UI se ve reflejado?) y (ii) los **criterios de diseño** (skill `design-review`: manga-friendly, anti-recorte, tokens, jerarquía, Fitts, es-AR, sheets header-fijo/body-scroll/footer-fijo). Puede delegar esta revisión visual a un subagente con la skill `design-review`.
  d. **Es BLOQUEANTE**: si la suite E2E está **roja**, o el diseño **no cumple** los criterios, o el flujo **no coincide** con la spec → vuelve al `implementer` (fix-loop) **antes** de la Puerta 2. NO se avanza a la aprobación humana con E2E rojo o capturas con problemas.
  e. Si todo OK → **adjunta las capturas a la Puerta 2** (vía `SendUserFile`) para que Raf apruebe el código **con evidencia visual**, no solo leyendo reportes.

### Alcance

- **Aplica** a features/deltas con **frontend nuevo o modificado** (pantallas, componentes, sheets, formularios).
- **N/A** a deltas **backend-only** (migraciones/RPCs/tests sin UI): no hay nada visual que capturar. Se documenta el N/A en el reporte (igual que Gate 1 N/A para frontend puro). El #15 backend, por ejemplo, no habría tenido capturas; el #15 frontend SÍ.
- Para deltas Nivel B (ADR-028), el capture file cubre los **estados que el delta toca**, no toda la app.

### Artefactos (commiteado vs efímero)

- **`app/e2e/captures/<feature>.capture.ts`** → **se commitea** (es el "cómo capturar", durable y regenerable; vive junto a la suite de regresión).
- **`app/e2e/captures/__shots__/`** (los `.png`) → **gitignored** (son de corrida, regenerables; se regeneran con byte-diffs espurios igual que `design/**/*.png` — ver memoria `reference_e2e_design_png_rerender`). Se le muestran a Raf en la Puerta 2 vía `SendUserFile`, no se commitean. Esto evita el problema de los diffs espurios y mantiene el repo limpio.
- Los `.capture.ts` los recoge `playwright.capture.config.ts` (testMatch `captures/*.capture.ts`); el subdir `__shots__/` solo tiene `.png`, no se ejecuta.

## Consecuencias

- **+1 deliverable** del implementer en trabajo de UI (el capture file). El reviewer controla que exista y cubra los estados del feature.
- **El leader es dueño del Gate 2.5** (orquesta E2E + captura + veto visual + loop). Es coherente con la regla "vetar diseño antes de mostrar" (el leader ya auto-revisa diseño).
- **Raf aprueba con capturas a la vista** en cada Puerta 2 de UI → menos sorpresas, verificación visual real.
- **Costo**: el Gate 2.5 agrega una corrida E2E + captura (minutos) por feature de UI. Aceptable: el E2E ya se corría; ahora es formal y produce evidencia.
- **No reemplaza** la Puerta 2 humana: la complementa con evidencia. El humano sigue siendo la aprobación final.

## Alternativas descartadas

1. **Reusar `playwright.report.config.ts` (screenshot:'on') en vez de un capture file dedicado.** Descartada: solo captura el estado final de cada test (no los intermedios) y las capturas no quedan nombradas/curadas → no sirven para "capturas de todo" verificables 1-a-1 contra la spec/diseño.
2. **Gate informativo (adjunta capturas pero no frena).** Descartada por decisión de Raf: debe ser **bloqueante** (verificar que funcione y cumpla diseño ANTES de la aprobación).
3. **Que el reviewer haga la verificación visual.** Descartada: el reviewer es estático (lee diff); el veto visual es responsabilidad del leader (que ya tiene la skill `design-review` y el mandato de vetar diseño antes de mostrar).

## Referencias

- Complementa ADR-019 (gates de seguridad), ADR-022 (Gate 0 contexto), ADR-028 (delta-specs).
- Skill `design-review` (criterios de diseño RAFAQ).
- Memoria `reference_e2e_design_png_rerender` (por qué los `.png` van gitignored).
