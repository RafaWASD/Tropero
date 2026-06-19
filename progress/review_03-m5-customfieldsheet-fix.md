# Review — Spec 03 (modo-maniobras), chunk M5-CUSTOMFIELDSHEET-FIX

**Reviewer**: reviewer (terminal dueña del fix)
**Fecha**: 2026-06-18
**Veredicto**: CHANGES_REQUESTED

## Alcance revisado
- `app/app/maniobra/_components/CustomFieldSheet.tsx` (FIX1 layout + FIX2 error a nivel de campo + scroll geometría-medida)
- `app/src/utils/custom-field.ts` (+`.test.ts`) — helper PURO `customFieldErrorTarget`
- `app/app/maniobra/_components/ManeuverConfigSheet.tsx` (sweep)
- `app/e2e/maniobra-customfield-validacion.spec.ts` (oráculo de geometría)
- `specs/active/03-modo-maniobras/{design.md §11.6, tasks.md}`

## Trazabilidad R↔test (presentación; el *qué* R13.5–R13.8 ya cubierto por M5-C.2/C.3)
- **FIX1 — título no recortado (header fijo)** ↔ `maniobra-customfield-validacion.spec.ts::expectTitleNotClipped`
  (L44-57): geometría real `titleBox.y ≥ sheetBox.y − 1` + `titleBox.height > 18`. NO presencia de texto. ORÁCULO REAL ✓
- **FIX2 lógica — `customFieldErrorTarget`** ↔ `custom-field.test.ts` L154-221: label vacío/largo→'label';
  options sin/inválidas→'options'; precedencia label-antes-que-options; válido→null; **barrido de consistencia
  `target===null ⟺ válido`** (L204-221) atado a `validateCustomFieldDraft`. 30/30 verde. ✓
- **FIX2 UI / scroll-360** ↔ `maniobra-customfield-validacion.spec.ts::expectInvalidFieldFullyInScrollViewport`
  (L67-90): compara `inputBox`/`errorBox` contra el rect REAL del ScrollView (`custom-field-scroll`, L75 `scroll.boundingBox()`),
  NO el viewport del browser. Test fuerza 360 ANTES de Crear (L123 antes de L130). ORÁCULO REAL ✓
- **Sweep `ManeuverConfigSheet`** ↔ regresión `maniobra-wizard.spec.ts` (abre `maneuver-config-sheet`, llena
  `maneuver-config-input`, guarda — flujo intacto). ✓

## Lógica intacta
- `git diff a03e593 -- custom-field.ts` = **puramente aditivo** (solo `customFieldErrorTarget` + tipo). `validateCustomFieldDraft`
  **byte-idéntica** (no aparece en el diff). ✓
- `customFieldErrorTarget` espeja exactamente la precedencia de `validateCustomFieldDraft` (label antes que options;
  mismas ramas de options). Consistencia garantizada por test de barrido. ✓
- Happy-path: `handleCreate` (L278-304) en la rama `valid.ok` va directo a `onCreate`, NO toca `scrollToField`.
  El scroll solo corre en la rama inválida (L285). No queda atrapado. ✓

## Tasks completas
- M5-CUSTOMFIELDSHEET-FIX `[x]` en tasks.md L450. No quedan `[ ]` del chunk. ✓ (pero ver CAMBIO REQUERIDO: AS-BUILT del tasks desactualizado)

## CHECKPOINTS
- C3 (arquitectura): `[x]` — capas previstas (component + util puro), cero hardcode de color (grep `#hex|rgb` = 0 en ambos sheets),
  sin logs/TODOs sueltos, sin `establishment_id` hardcodeado.
- C4 (verificación): `[x]` parcial — unit puro 30/30 + e2e con oráculo de geometría real. `[ ]` global: `check.mjs` ROJO (ver abajo, causa ajena).
- C6 (SDD): `[x]` requirements sin cambios (correcto: el *qué* no cambió). **`[ ]` design↔código: tasks.md L452 contradice el código as-built** (ver CAMBIO REQUERIDO).
- C7 (multi-tenant) / C8 (offline-first): **N/A** — fix de presentación puro; no toca data-path, contexto ni red.

## Checklist RAFAQ-específico
- **A (RLS/multi-tenancy)**: N/A — no toca tablas ni policies.
- **B (offline-first)**: N/A — presentación pura; el path de creación (offline) no se tocó.
- **C (BLE)**: N/A.
- **D (UI de campo)**: aplica.
  - [x] Targets ≥ 60dp: inputs `$searchBarLg` (≥56), bloques `$touchMin`; el footer Crear/Cancelar usa `Button fullWidth`.
  - [x] Fuente legible: título `$7`, labels `$4`, FieldError `$3` con lineHeight matching.
  - [x] Una decisión por pantalla / sheet enfocado; el error guía AL campo culpable (scroll + borde terracota + inline).
  - [x] Estado de loading visible: botón "Creando…" + `disabled` durante submit (L633-634).
  - [x] Recorte de descendentes: título `lineHeight="$7"`, `FieldError` `lineHeight="$4"` con `numberOfLines`. (regla dura)
- **E (Edge Functions)**: N/A.

## check.mjs
- ROJO. 2 fallas, AMBAS en `supabase/tests/animal/run.cjs:1924` → `animals_tag_unique` (23505 duplicate key, caravana borde 64).
- Es el flake cross-terminal documentado (memoria `reference_check_red_rate_limit`): residuo de seed de la OTRA terminal
  en la suite backend animal. NINGUNO de los 3 archivos de código de este fix (`CustomFieldSheet.tsx`, `custom-field.ts`,
  `ManeuverConfigSheet.tsx`) toca esa suite ni el schema `animals`. NO es regresión de este chunk. CONFIRMADO.

## Gate 2
- **N/A** — CONFIRMADO. Presentación + cómo se superficia el error; sin cambio de data-path / inputs / auth / schema.
  El único símbolo nuevo (`customFieldErrorTarget`) es puro y presentacional. No hay diff de seguridad que auditar.

## Cambios requeridos
1. **`specs/active/03-modo-maniobras/tasks.md` L452 — AS-BUILT del scroll desactualizado (contradice el código).**
   La entrada describe el FIX 2 en su versión PRE fix-loop:
   - dice: *"Opciones vía `scrollToEnd` diferido 1 frame para que el mensaje recién agregado entre a la vista"*
   - dice: *"el error residual del server (sin target) va al FINAL del cuerpo + scrollToEnd"*
   El código as-built (`CustomFieldSheet.tsx` L124-234) **ya NO usa `scrollToEnd` diferido 1 frame**: usa el modelo
   DETERMINISTA por geometría medida (`onLayout` captura rect `{y,height}` por sección + alto de viewport →
   `runScrollToField` alinea TOPE/FONDO → consumido por `onFieldLayout` al crecer el mensaje + **doble-rAF de fallback**;
   el error general va por `onContentSizeChange` + doble-rAF, NO `scrollToEnd` con defer fijo).
   El `design.md §11.6` L1452 SÍ está reconciliado (incluye el FIX-LOOP scroll-360 completo). El tasks NO.
   → Reconciliar el AS-BUILT de tasks.md L452 con el código (mecánica de scroll = geometría medida + doble-rAF;
     mencionar `custom-field-scroll` y el oráculo `expectInvalidFieldFullyInScrollViewport`), igualándolo al design §11.6.
   (Regla dura del proyecto: nunca dejar specs contradictorias con el código tras un fix; memoria `feedback_correcciones_en_specs`.)

## Resto
Todo lo demás del fix está correcto y verde: FIX1, FIX2 (lógica + UI), sweep, happy-path, tokens, oráculos reales de
geometría a 360/412, helper puro consistente, `validateCustomFieldDraft` byte-idéntica, Gate 2 N/A. El único bloqueo es
la reconciliación pendiente de tasks.md L452. Una vez igualado al design §11.6, esto APRUEBA.
