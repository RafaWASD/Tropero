# Review — 03-bugfix-config-sheet (ManeuverConfigSheet race del backdrop, web tactil)

> Bugfix de spec 03 (MODO MANIOBRAS, wizard etapa 2). Frontend puro; NO backend. Gate 1 N/A.
> Review previo a Gate 2. Feature 03 in_progress (verificado en feature_list.json).

## Veredicto: APPROVED

El fix resuelve el race reportado por Raf (el sheet se abre y se auto-cierra a ~1ms en web tactil) sin
romper el cierre intencional ni native, el revert del CutPromptSheet es tecnicamente correcto, el e2e
caza el race de verdad (probado fail-without/pass-with por el reviewer), y las specs quedaron
reconciliadas al as-built. node scripts/check.mjs verde (RC=0).

## Trazabilidad R<n> a test

Este chunk es un BUGFIX del *cuando* del dismiss del backdrop; NO introduce requirements nuevos ni cambia
el *que* de los R<n> de M1.4. R afectados y su cobertura:

- R1.7 (pre-configurar params de tanda una vez): app/e2e/maniobra-wizard.spec.ts (abre el sheet por el
  cuerpo de la fila, carga Brucelosis, guarda, round-trip inline + limpiar) + maniobra-config-sheet-race.spec.ts
  CASO 1 (abre tactil -> sheet QUEDA abierto -> escribe Brucelosis) y CASO 2 (backdrop deliberado cierra,
  preconfig NO cargado -> fila vuelve al hint). El backdrop dismiss (R3/UX) sigue vivo.
- R1.8 (autocompletar de usadas antes): maniobra-wizard.spec.ts (sugerencias Brucelosis/Aftosa bajo Usadas
  antes, tocar = chip). Intacto. + unit maneuver-wizard.test.ts (filterAutocomplete/split/joinMultiPreconfig).
- R6.8 (prompt CUT de dientes): app/e2e/maniobra-elegir.spec.ts (regresion del CutPromptSheet, 2/2 segun el
  impl) — confirma que el revert del guard sobrante NO rompio el prompt CUT.

El test PROPIO del bugfix (maniobra-config-sheet-race.spec.ts) es la cobertura concreta del defecto: con el
guard presente PASA (1/1); revirtiendo el scrim a onPress=onClose FALLA en la linea 93 (element not found
-> el sheet se auto-cerro) — VERIFICADO EMPIRICAMENTE por el reviewer con rebuild completo en ambas
direcciones.

## Exactitud de specs (codigo a spec)

- design.md 6.bis.1 As-built v5 describe fielmente: causa raiz (Gesture.Tap -> pointerup -> click emulado
  touch->mouse hit-testeado contra el scrim), fix (guard readyToDismissRef + doble rAF + fallback
  setTimeout), alcance (CutPromptSheet NO lo necesita y POR QUE — onPress Tamagui consume el click), y la
  regresion tactil (hasTouch:true + touchscreen.tap). Coincide con el codigo as-built (lineas 70-108 de
  ManeuverConfigSheet.tsx; nota en DientesStep.tsx 131-137).
- tasks.md M1.4 As-built v5 + lista de Archivos actualizada (ManeuverConfigSheet v5, DientesStep nota,
  maniobra-config-sheet-race.spec.ts NUEVO, wizard spec con nota). Correcto.
- requirements.md: NO se tocaron los EARS de R1.7/R1.8 — correcto, el *que* no cambio (el sheet abre,
  configura, guarda, el backdrop cierra igual; solo se endurecio el *cuando* del dismiss). Aplica la regla
  de reconciliacion (design refleja el como; requirements solo si cambia el que). No miente.

## Tasks completas: si

M1.4 esta [x] (DONE, pendiente reviewer + Gate 2). Este bugfix se folda en M1.4 v5 (no abre task nueva). No
quedan [ ] sin justificar dentro del alcance del bugfix.

## CHECKPOINTS

- [x] C2 — estado coherente (03 unica in_progress; M1.4 no marcado done).
- [x] C3 — respeta arquitectura: guard en componente de presentacion (_components/), APIs estandar
      (useRef/useEffect/rAF), cero hardcode (anti-hardcode ADR-023 4: 0 violaciones), sin establishment_id
      hardcodeado, sin logs de debug sueltos (grep console/DIAG/debugger = 0 en los 2 componentes y el spec),
      sin TODOs sin contexto.
- [x] C4 — verificacion real: 1284 unit del cliente verdes; el e2e de regresion usa fixtures reales
      (Supabase real + context tactil), no mocks de I/O; caza el defecto (fail-without/pass-with probado).
- [x] C6 — SDD: los 3 docs presentes; R afectados con >=1 test; design/tasks reconciliados al as-built.
- [ ] C7 — Multi-tenant: N/A (frontend puro, no toca tablas/RLS).
- [ ] C8 — Offline-first: N/A (no agrega carga de datos; el preconfig ya persistia en config.preconfig jsonb
      desde v4 sin cambios; el fix es un guard de UI del dismiss).

## Checklist RAFAQ-especifico

- A (multi-tenancy / RLS) — N/A. No toca tablas con establishment_id ni policies.
- B (offline-first) — N/A. No carga/edita datos nuevos; solo gatea el press del scrim.
- C (BLE) — N/A. No toca BLE.
- D (UI de campo: manga, wizard) — APLICA (sheet de preconfig del wizard etapa 2):
  - [x] Botones >=60dp: input searchBarLg=56 + botones Button canonicos (touchMin=56); boton + de agregar
        usa inputMinHeight (=56). El fix NO altera ningun target (consistente con v4 aprobado).
  - [x] Fuente >=18pt en texto leido: titulo 7, chips/sugerencias 4, input inputText. Sin cambios.
  - [x] Una decision por pantalla: el sheet configura UNA maniobra. Sin cambios.
  - [x] Estado de loading: N/A real (form local sin fetch). El guard arma en ~2 frames (~33ms), imperceptible.
- E (Edge Functions) — N/A. No toca Edge Functions.

## Foco escrutado

1. Guard cierra el race sin romper el cierre intencional: VERIFICADO. onBackdropPress (l.105-108) early-returns
   solo si el guard no esta armado; tras ~2 frames un tap deliberado SI cierra (CASO 2, probado). Cancelar
   (onClose directo l.342), Guardar (l.339), chips x, +, sugerencias e input NO pasan por onBackdropPress ->
   andan desde el 1er tick. El guard es solo del scrim.
2. No-regresion native: useEffect doble rAF + cleanup (l.83-102) usa APIs presentes en RN; en native no hay
   click huerfano y el delay (~2 frames) es imperceptible -> inofensivo. Fallback setTimeout(0). Ref (no
   estado) -> sin re-render. Sin leak (cleanup cancela rAF/timer; cada mount = ref fresco).
3. Revert de DientesStep correcto: VERIFICADO en codigo. CutPromptSheet abre con onPress de Tamagui del
   bloque de dientes (DientesStep l.82, driven por click, consumido) -> sin click huerfano. ManeuverReorderList
   abre el ManeuverConfigSheet con Gesture.Tap() (l.277-280, runOnJS, driven por pointerup) -> deja el click
   libre = el race. Revert fundado. Sin guard sobrante ni imports muertos (solo la nota l.131-137). El scrim
   del CutPromptSheet usa onDismiss directo (l.149).
4. El e2e CAZA el race: VERIFICADO EMPIRICAMENTE (rebuild completo cada vez):
   - Fix presente -> 1 passed (10.9s).
   - Fix revertido (scrim onPress=onClose) -> 1 failed en la linea 93 (element not found: sheet auto-cerrado).
   Restaurado el archivo (sha verificado). El spec usa hasTouch:true + page.touchscreen.tap() (no
   locator.click()), context tactil propio, applyEnvShim antes del goto. Fiel a la repro real.
5. Cero hardcode / descendentes / sin artefactos: anti-hardcode 0 violaciones; titulos con lineHeight
   matching (l.214 7/7); sin logging/DIAG/debugger en componentes ni spec (grep = 0); test-results de
   Playwright limpiados.

## node scripts/check.mjs

RC=0 — VERDE. typecheck client OK; anti-hardcode 0 violaciones; 1284 unit client + suites backend
(RLS/edge/sync/operaciones) verdes (All tests passed). Sin flake. El WARN de current.md inflado es higiene
de progress, no del codigo del bugfix.

E2E (corrido aparte, fuera de check.mjs que no ejecuta Playwright): maniobra-config-sheet-race 1/1 PASS con
el fix; FALLA al revertir el fix (regresion genuina). El Assertion failed uv_handle src-win-async.c que
aparece tras el reporte es ruido de cierre de proceso de libuv en Windows (NO un fallo de test).

## Cambios requeridos

Ninguno.

## NO marco done

Espera Gate 2 (security_analyzer modo code) + Puerta 2 (aprobacion humana de Raf).
