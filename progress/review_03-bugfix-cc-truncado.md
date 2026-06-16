# review_03-bugfix-cc-truncado — Revisión del reviewer

**Feature**: 03-modo-maniobras (in_progress) · Bugfix de frontend puro (layout) sobre `CondicionCorporalStep.tsx`.
**Fecha**: 2026-06-15
**Reviewer**: agente revisor (filtro automático)

## Veredicto: APPROVED

---

## FOCO 1 — El valor renderiza COMPLETO (no se trunca en web)

VERIFICADO. El `<Text>` del valor hero (`CondicionCorporalStep.tsx:121-130`) ya NO lleva `numberOfLines`,
`adjustsFontSizeToFit` ni `minimumFontScale`. Grep sobre el archivo: esas tres props aparecen SOLO en el
comentario explicativo del bug (L116-119) y `numberOfLines={1}` queda solo en las marcas de escala (L167),
la pista (L175) y el CTA (L197) — ninguno es el valor hero. El valor vive en su propia `<View
testID="score-display" width="100%">` (L120) con `<Text textAlign="center">` full-width → no puede cortar
por `text-overflow:ellipsis`. Causa confirmada coherente con la memoria `reference_rn_web_pitfalls`
(`adjustsFontSizeToFit` NO-OP en react-native-web).

## FOCO 2 — Lógica del stepper intacta (sin regresión)

VERIFICADO. `app/src/utils/condition-stepper.ts` sin cambios de comportamiento: clamp [1,5], snap a grilla
de 0,25 sin drift (×4/Math.round), `incrementScore`/`decrementScore` con límites, `isScoreAtMin/Max`,
`SCORE_DEFAULT=3`, `formatScoreAR` es-AR (coma + 2 decimales). El componente sigue delegando todo a la util
(L86-88 `initialScore` → `snapScore`, R5.9; L137/143 ±; L193 `onConfirm(snapScore(score))`). Botones − / +
se deshabilitan en límites (`atMin`/`atMax`, L93-94, L134/141). `testID="score-display"`, `score-minus`,
`score-plus` preservados.

## FOCO 3 — Layout manga + cero hardcode

VERIFICADO. Card `flex={1}` + `justifyContent="center"` + `gap="$6"` llena el alto (densidad R12.5, sin
vacío muerto). Valor hero `$11`/64px dominante. Botones `$stepperBtn`=88px (≥80). Escala 1…5 + pista
"1=flaca · 5=gorda". Recorte de descendentes cubierto: `lineHeight="$11"` en el valor (L124) y `$4` en los
Text con `numberOfLines`. Tokens `$11`=64 (lineHeight 72) y `$stepperBtn`=88 existen en `tamagui.config.ts`
(L308/322, L240) → cero hardcode. Lint anti-hardcode ADR-023 §4: 0 violaciones.

## FOCO 4 — e2e maniobra-elegir intacto

VERIFICADO por preservación del contrato de testIDs. `app/e2e/maniobra-elegir.spec.ts:142-144` asserta
`score-display` 3,00 → `score-plus` click → 3,25, y todos esos testIDs siguen en su lugar tras el restructure.

---

## Trazabilidad R ↔ test

- **R6.6** (condición corporal: stepper 1,00–5,00, step 0,25, default 3,00, es-AR) ↔
  - Unit: `app/src/utils/condition-stepper.test.ts` (rango/step/default L22-27, clamp L37-42, snap L44-48,
    ± con límites L59-78, isAtMin/Max L92-97, formato es-AR L101-111).
  - e2e: `app/e2e/maniobra-elegir.spec.ts:140-146` (display 3,00 → +click → 3,25 → Confirmar; resumen 3,25 L164).
- **R5.9** (corrección desde resumen) ↔ `CondicionCorporalStep.tsx:86-88` (`initialScore` → `snapScore`),
  cubierto por el snap-test de la util.
- El BUG en sí es de LAYOUT/CSS (truncado por ellipsis), no de lógica → no es asertable por texto del DOM
  (el DOM ya tenía el texto completo). Se verificó por captura visual a 412×915 y 360×800 con valores
  extremos (1,00/4,00/5,00) — documentado en `impl_03-bugfix-cc-truncado.md`. Justificación aceptada: un
  assert de texto NO cazaría un truncado puramente visual de CSS.

## Tasks completas: sí

Bugfix sobre M3.2a (ya `[x]` en `tasks.md`). No introduce tasks nuevas. T1/T2/T3 del impl (reescritura de
layout / verificación web / reconciliación design) ejecutadas y documentadas. Sin `[ ]` colgado.

## Exactitud de specs (código → spec): OK

`design.md §6.bis.3` (bullet Condición corporal, L745) describe el as-built REAL: valor full-width arriba /
botones − + debajo, SIN `numberOfLines`/`adjustsFontSizeToFit`, con la nota de reconciliación del bugfix
(causa NO-OP en web, fix, verificación 412/360). No queda mintiendo. `requirements.md` (R6.6) no contradice
el as-built — el *qué* (escala/step/default/es-AR) no cambió, solo el *cómo* (disposición). Correcto no
tocar requirements.md ni tasks.md.

## CHECKPOINTS

- **C1** El harness está completo:
  - [x] Archivos base / docs / 5 agentes presentes (check.mjs §1).
  - [x] `node scripts/check.mjs` exit code 0.
- **C2** Estado coherente:
  - [x] Una sola feature `in_progress` (03).
  - [~] `current.md` describe la sesión activa — WARN de inflado (154 líneas), hygiene, NO bloqueante para
    este bugfix. (Se recomienda al leader limpiar al cerrar sesión, AGENTS.md §6.)
- **C3** Código respeta arquitectura:
  - [x] Capa correcta (component en `app/app/.../`, lógica pura en `app/src/utils/`). Sin deps nuevas.
  - [x] Sin logs de debug ni TODOs sueltos. Sin `establishment_id` hardcodeado (N/A en este componente).
- **C4** Verificación real:
  - [x] Test por módulo con lógica (`condition-stepper.test.ts`). Runner >0 tests, todos verdes.
  - [ ] Test de aislamiento cross-tenant → **N/A** (sin RLS/datos en este bugfix).
- **C6** SDD:
  - [x] Specs presentes (03 in_progress). R6.6 cubierto por ≥1 test.
- **C7** Multi-tenant → **N/A** (sin tabla/RLS).
- **C8** Offline-first → **N/A** (cambio de layout puro, sin nuevo write-path; el paso ya persistía vía el
  orquestador M3.1, sin cambios).

## Checklist RAFAQ-específico

- **A. Multi-tenancy / RLS** → **N/A** (no toca tablas con `establishment_id`).
- **B. Offline-first** → **N/A** (no carga/edita datos nuevos; restructure de layout del display; el
  write-path de `condition_score_events` es de M3.1/M3.2a, sin tocar).
- **C. BLE** → **N/A** (no toca BLE).
- **D. UI de campo (manga)** — APLICA:
  - [x] Botones ≥60dp: `$stepperBtn`=88px (− / +) y CTA `minHeight="$touchMin"`.
  - [x] Fuente ≥18pt en texto a leer: valor hero `$11`=64px; pista `$4` (es decorativa/secundaria, no es el
    dato a leer en manga).
  - [x] Una decisión por pantalla: un solo valor a elegir (R5.2).
  - [x] Estado de loading visible → N/A acá (sin async en el step; el feedback de avance lo da el frame).
- **E. Edge Functions** → **N/A** (no toca Edge Functions).

## Gate 2 (seguridad): coincido con N/A

Confirmado: cero superficie de seguridad. El cambio es puramente de disposición visual del display de un
valor que YA existía. No agrega ni modifica inputs que lleguen al backend (el `score` se valida server-side
desde M3.1), no toca auth, RLS, escrituras nuevas, ni contexto de tenant. Sacar `adjustsFontSizeToFit` y
mover el `<Text>` a su propia línea no abre ninguna superficie. **Gate 2 N/A correcto.**

## check.mjs

RC=0. Todos los tests verdes (suites backend + client unit + typecheck + lint anti-hardcode). Único WARN:
`current.md` inflado (hygiene, no bloqueante). NO es flake (verde limpio, sin rate-limit ni cascada undefined).

## Cambios requeridos

Ninguno.
