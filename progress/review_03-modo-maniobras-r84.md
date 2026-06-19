# Review Gate 2 — chunk R8.4 (preview de transición de categoría offline)

**Feature:** spec-03 MODO MANIOBRAS · **Chunk:** R8.4 (M3.2c, solo el preview; lote R9.x diferido)
**Veredicto:** ✅ **APPROVED** (2026-06-19)
**Tipo:** frontend puro, display-only, offline. Gate 1 N/A (sin migraciones/writes). Gate 2 por reviewer.

## Alcance
Cuando una maniobra captura un evento reproductivo que el server transicionaría de categoría
(caso canónico R8.1: tacto POSITIVO sobre vaquillona → vaquillona_prenada), el operario VE el
cambio esperado en el resumen del animal ANTES de sincronizar. Reusa el espejo C6
`computeCategoryCode` (cero re-implementación ⇒ cero drift). Display-only: el server sigue siendo
la única verdad (la transición real la aplica el trigger `tg_reproductive_events_apply_transition`).

## Archivos
- NUEVO `app/src/utils/maneuver-category-preview.ts` (+ `.test.ts`, 19 unit, incluye round-trip antidrift)
- MOD `app/src/services/animals.ts` — `fetchRodeoCategoryCatalog(rodeoId)` (append-only)
- MOD `app/app/maniobra/carga.tsx` — carga catálogo offline + `useMemo transitionPreview` + prop a AnimalSummary
- MOD `app/app/maniobra/_components/AnimalSummary.tsx` — prop `preview?` + `CategoryPreviewBanner` (testID `summary-category-preview`)
- NUEVO `app/e2e/maniobra-preview-transicion.spec.ts` (2 tests: canónico + negativo) + captura `design/maniobra-carga/resumen-preview-transicion.png`
- MOD `scripts/run-tests.mjs` (registro del unit nuevo, append)
- Specs reconciliadas: `requirements.md` (R8.4 + corrige nombre fantasma `transitions.ts`), `design.md` §5 nota as-built, `tasks.md` M3.2c/M4.1

## Verificación
- `node scripts/check.mjs`: typecheck + anti-hardcode 0 + 19 unit nuevos verdes. Único rojo =
  `supabase/tests/animal/run.cjs` `23505 animals_tag_unique` = flake de colisión de tag con la
  terminal paralela (spec-08/10), NO regresión (chunk frontend puro, cero backend).
- e2e `maniobra-preview-transicion.spec.ts`: **2 passed (26.6s)**. `UV_HANDLE_CLOSING` posterior =
  teardown libuv de Windows tras pasar (no-fallo).

## Checklist RAFAQ
- **A (RLS/multi-tenant):** N/A — sin tablas/migraciones; lectura local scopeada por sync; rodeoId del
  caller, cero hardcode de system_id/codes.
- **B (offline-first):** PASS — lectura LOCAL SQLite (`buildRodeoSystemQuery`/`buildSystemCategoriesQuery`),
  cero red, cero writes (display-only). Fail-safe sin systemId → `{ok:true,value:[]}` → no muestra.
- **C (BLE):** N/A.
- **D (UI campo):** PASS — lineHeight matching en todo Text con numberOfLines; banner DISTINTO de filas
  tappables (sin onPress/pressStyle/chevron, fondo `$greenLight`) → no induce tap de corrección; es-AR;
  cero hardcode (tokens). Descendentes "Vaquillona"(q)/"preñada"(p) sin recorte (verificado en captura).
- **E (Edge Functions):** N/A.

## Fail-safes verificados (display-only, nunca crash, nunca blanco)
override→null · macho→null · code no reconstruible→null · sin tacto/inseminación capturados→null ·
toCode==currentCode→null · toCode fuera de catálogo→null · sin catálogo→banner ausente · resumen
(incl. vacío) renderiza igual sin preview · tacto 'empty' NO dispara · tacto_vaquillona NO alimenta
compute_category · escaneo de VALUES de `captured` (no asume key).

## Terminales paralelas
PASS — `animals.ts` append-only; NO tocó `app/app/animal/[id].tsx`, `app/src/services/sigsa/**`,
`specs/active/08-export-sigsa/**`. Coordinación compartida sin escrituras de R8.4.

## Estado
Feature 03 sigue **in_progress** (este es el Gate 2 del CHUNK R8.4, no el cierre de la feature; la
Puerta 2 humana de código es a nivel feature).
