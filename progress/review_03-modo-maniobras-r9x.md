# Review Gate 2 — chunk R9.x (lote opcional/manual desde el wizard de maniobra)

**Feature:** spec-03 MODO MANIOBRAS · **Chunk:** R9.x (M3.2c, lote; R9.4 work_lot_label deferido/estructural)
**Veredicto:** APPROVED (2026-06-19)
**Tipo:** frontend puro, offline, sin migraciones (los services `assignAnimalToGroup`/`fetchManagementGroups`
y la columna `work_lot_label` ya existían de spec 02). Gate 1 N/A. Gate 2 por reviewer.

## Alcance
Afordancia "Lote (opcional)" en el resumen del wizard → sheet picker ("Sin lote" + grupos del campo) →
`assignAnimalToGroup(profileId, groupId|null)` (offline). El lote (`management_groups`, ADR-020) es el
tercer eje del animal: per-animal, manual, NUNCA auto-asignado por la sesión.

## Archivos
- NUEVO `app/src/utils/lote-picker.ts` (+ `.test.ts`, 6 unit) — helper PURO `lotePickerOptions`
- NUEVO `app/app/maniobra/_components/LotePickerSheet.tsx` — sheet canónico (header fijo / body scroll / footer Cancelar / guard tap-through web doble-rAF)
- MOD `app/app/maniobra/_components/AnimalSummary.tsx` — props `loteName`/`onOpenLote` + seccion "Organizacion" con `LoteAffordance` (testID `summary-lote-row`)
- MOD `app/app/maniobra/carga.tsx` — `groups` (fetchManagementGroups offline) + `loteSheetOpen` + `loteError` + `onAssignLote` + sheet
- NUEVO `app/e2e/maniobra-lote.spec.ts` (2 tests) + capturas `design/maniobra-carga/resumen-lote.png` + `resumen-lote-sheet.png`
- MOD `app/e2e/helpers/admin.ts` (append: `seedManagementGroup`, `waitForServerProfileManagementGroup`, `readServerProfileManagementGroup`)
- MOD `scripts/run-tests.mjs` (registro del unit, append)
- Specs reconciliadas: `requirements.md` (nota US-9), `design.md` (§6.bis.13), `tasks.md` (M3.2c R9.x)

## Trazabilidad R<n> -> test
- **R9.1 (NO auto-asignar)** — por construccion (la unica escritura de management_group_id es la accion
  manual del sheet; sessions.ts/identificar.tsx no lo tocan) + contraprueba e2e (maniobra sin tocar lote
  deja management_group_id IGUAL).
- **R9.2 (asignar/cambiar/quitar)** — `lote-picker.test.ts` + sheet/afordancia/`onAssignLote` + e2e oraculo
  SERVER `waitForServerProfileManagementGroup` tras sync, OFFLINE.
- **R9.3 (opcional; "Sin lote"=null)** — `lote-picker.test.ts` (selectedId null / lista vacia) + e2e
  (quitar lote round-trip + contraprueba conserva).
- **R9.4 (work_lot_label)** — DEFERIDO/estructural: columna texto SIN FK asignadora (no-autoritativa,
  context §Lote "o se omite"); sin UI. Documentado, no es un faltante.

## Verificacion
- `node scripts/check.mjs`: unico rojo = flake conocido `23505 animals_tag_unique` en
  `supabase/tests/animal/run.cjs` (colision de tag con la terminal paralela spec-08/10), NO regresion.
- `lote-picker.test.ts`: 6 passed. anti-hardcode 0 violaciones.
- e2e `maniobra-lote.spec.ts`: 2 passed (32.5s). `UV_HANDLE_CLOSING` posterior = teardown libuv tras pasar.
- Capturas inspeccionadas (design-veto del leader + reviewer): afordancia distinta, sheet canonico,
  "Sin lote" primero + grupo seleccionado con check, "Engorde primavera" (g/p) sin recorte.

## Checklist RAFAQ
- **A (RLS):** N/A (reusa management_groups/animal_profiles de spec 02; trigger 0037 + RLS has_role_in
  re-validan server-side al subir; sin hardcode de establishment_id — usa `animal.establishmentId`).
- **B (offline-first):** PASS — funciona offline (e2e setOffline), CRUD-plano local, sin red sincrona.
- **C (BLE):** N/A.
- **D (UI campo):** PASS — touchMin, una decision por pantalla, optimista + banner de error es-AR,
  patron canonico de sheet (header flexShrink:0 / body ScrollView flex:1 / footer), lineHeight matching
  en nombres de lote (texto libre), afordancia distinta (Tags + "Organizacion"), guard tap-through web,
  cero hardcode.
- **E (Edge Functions):** N/A.

## Terminales paralelas
PASS — NO toco `animal/[id].tsx`, `crear-animal.tsx` (no se refactorizo el GroupCombo del alta),
`management-groups.ts` (solo consumido), `services/sigsa/**`, `08-export-sigsa/**`, ni coordinacion
compartida. `admin.ts`/`run-tests.mjs` = append colision-safe.

## Estado
Feature 03 sigue **in_progress** (Gate 2 del CHUNK R9.x, no cierre de feature).
