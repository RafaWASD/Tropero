baseline_commit: 7d43b4d08ddf50a62e83b55696ba2ed151ad3bfc

# Impl — Fix de las 10 fallas de la 1ra corrida E2E EN VIVO (post 4 deltas)

**Contexto**: la suite E2E completa corrió por primera vez en vivo tras los 4 deltas (Fase 1 + aptitud + alta-form + caravana-ficha) → **176 passed / 10 failed**. Los e2e de los deltas nunca habían corrido en vivo (reconciliados estáticos). Esta sesión diagnostica + arregla las 10. **NO se tocó la DB** (sin migraciones; arreglos de TEST + un fix de PRODUCTO-frontend).

## Veredicto por falla

| # | Test | Causa raíz | Tipo | Arreglo | Re-corrida |
|---|---|---|---|---|---|
| 1 | `animals.spec.ts:120` aptitud Apta | visual `${RUN_TAG}-APTA` = 31 chars → el form TRUNCA a 30 (`VISUAL_MAX_LENGTH`, sanitizeVisualInput) → `getByText` exacto en la lista no matchea `-APT` | **TEST** (data) | sufijo corto `-AP` (≤30) | ✅ green |
| 2 | `animals.spec.ts:688` #3 DD/MM | `${RUN_TAG}-DDMM` truncado → `waitForServerAnimalProfile` por visual_alt nunca matchea | **TEST** (data) | sufijo `-DM` | ✅ green |
| 3 | `animals.spec.ts:795` #13 condición | `${RUN_TAG}-COND` truncado → ídem oráculo server | **TEST** (data) | sufijo `-CO` | ✅ green |
| 4 | `animals.spec.ts:831` #14 sin tocar | `${RUN_TAG}-NOCOND` (33) truncado → ídem oráculo server | **TEST** (data) | sufijo `-NC` | ✅ green |
| 5 | `animals.spec.ts:1039` caravana inmutable | `.first()` pelado cae en la fila de la LISTA (oculta, montada bajo el overlay de la ficha): este animal NO tiene visual → su id PRIMARIO en la lista es el propio idv/tag | **TEST** (selector) | `.filter({ visible: true }).first()` (idv y tag) | ✅ green |
| 6 | `maniobra-sanitaria.spec.ts:323` IA 1 pajuela | el animal `multipara` SIN override + sin birth_date/eventos lo RECALCULA el espejo C6 a `vaquillona` (sin veredicto, sin edad) → `isReproApt`=false → la inseminación se SALTA (#1b correcto) | **TEST** (setup) | `categoryOverride: true` → fija la categoría probada → apta | ✅ green |
| 7 | `maniobra-sanitaria.spec.ts:369` IA >1 pajuela | ídem #6 | **TEST** (setup) | `categoryOverride: true` | ✅ green |
| 8 | `maniobra-custom-render.spec.ts:195` propiedad custom ficha edit | `UNIQUE constraint failed: ps_data__custom_attributes.id` — `setCustomAttribute` decidía UPDATE-vs-INSERT por `rowsAffected`, que NO es confiable en un UPDATE sobre VIEW de PowerSync (INSTEAD OF trigger); editar una propiedad CREADA EN EL ALTA → UPDATE reporta 0 → INSERT plano colisiona la PK sintética | **PRODUCTO (bug real)** | SELECT-existencia determinista (ver abajo) | ✅ green |
| 9 | `events.spec.ts:282` parto mellizos | "No se encontró el animal" — sync/timing transitorio durante la corrida en vivo inestable (red/2-terminales) | **FLAKE** (no delta) | — (no se toca) | ✅ 3/3 en aislado |
| 10 | `maniobra-single-active.spec.ts:68` | `waitForServerActiveSessionCount(1)` resuelve, luego un `readServerActiveSessionIds` SEPARADO racea y devuelve `[]` (consistencia eventual / contención 2-terminales). Archivo NO tocado por los deltas | **FLAKE** (no delta) | — (no se toca, per instrucción) | 2/3 (intermitente) |

## El bug de PRODUCTO (#8) — fix sin DB

**Síntoma**: editar desde la ficha una propiedad custom que se cargó en el ALTA tiraba `UNIQUE constraint failed: ps_data__custom_attributes.id` → el dato no se guardaba (un usuario real lo pega).

**Causa**: `custom_attributes` (PK compuesta, sin `id` real) se expone como VIEW; `setCustomAttribute` hacía UPDATE-luego-INSERT-si-`rowsAffected`==0. Pero `sqlite3_changes()` NO cuenta cambios hechos por un INSTEAD OF trigger, y en la web (wa-sqlite) el UPDATE de una fila SINCRONIZADA reporta 0 aunque matchee → caía al INSERT plano que colisiona la PK sintética (`profile:field`) de la fila creada en el alta. Latente hasta ahora porque el unit test usa una TABLA plana (donde `changes` sí funciona) y ningún flujo previo editaba un atributo creado en el alta.

**Fix** (frontend, cero DB):
- `app/src/services/powersync/local-reads.ts`: nuevo builder `buildCustomAttributeExistsQuery` (`SELECT 1 FROM custom_attributes WHERE id = ?`).
- `app/src/services/custom-attributes.ts`: `setCustomAttribute` decide UPDATE vs INSERT por ese SELECT DETERMINISTA (view-safe), NO por `rowsAffected`. Misma semántica LWW; el upload por PK natural no cambió. `runLocalWriteCount` queda sin uso en este path.
- `app/src/services/powersync/maneuver-reads.test.ts`: emulación `setAttr` actualizada a SELECT-existencia + test del builder + test de REGRESIÓN ("re-editar una propiedad creada en el alta NO colisiona la PK").

## Archivos tocados
- **PRODUCTO**: `app/src/services/custom-attributes.ts`, `app/src/services/powersync/local-reads.ts`
- **UNIT**: `app/src/services/powersync/maneuver-reads.test.ts`
- **E2E**: `app/e2e/animals.spec.ts` (4 labels cortos + 2 `.filter({visible:true})`), `app/e2e/maniobra-sanitaria.spec.ts` (2 `categoryOverride:true`)
- **SPEC (reconciliación)**: `specs/active/03-modo-maniobras/design.md` (nota RECONCILIACIÓN bajo R13.12)

## Verificación (build fresco `e2e:build`, red a Supabase OK)
- `pnpm typecheck`: PASS.
- Unit: `maneuver-reads.test.ts` 46/46, `local-reads.test.ts` 132/132.
- E2E re-corridas EN VIVO contra el export fresco:
  - `animals.spec.ts` **28/28** (incluye las 5 del GRUPO 1).
  - `maniobra-sanitaria.spec.ts` **6/6** (incluye las 2 de IA — confirma #1b correcto).
  - `maniobra-custom-render.spec.ts` **3/3** (incluye el fix de producto #8 + las 2 de measurements).
  - `events.spec.ts` parto-mellizos **3/3** en aislado (flake confirmado).
  - `maniobra-single-active.spec.ts` 2/3 (flake confirmado; race count-then-read del oráculo server; no es de los deltas).

## Confirmaciones importantes
- **#1b (inseminación = solo hembra apta) es CORRECTO, no bug**: el `multipara` derivado a `vaquillona` por el espejo C6 + sin aptitud/edad → no apta → la maniobra se salta. El setup viejo asumía el `default:true` previo a la corrección. Los tests ahora fijan la categoría probada con override.
- **#8 es un bug de PRODUCTO real** (UNIQUE constraint visible al usuario), no de los deltas en sí — latente desde M5-C.3; el alta-escribe-custom-attribute + ficha-edit lo destapó. Fix frontend, sin DB.
- **GRUPO 4 (events + single-active) son flakes pre-existentes**, NO regresiones de los deltas (esos archivos no se tocaron). No se modifican.

## STATUS: DONE
Las 8 fallas atribuibles a los deltas (GRUPO 1/2/3) quedan VERDES y estables contra el build fresco. Las 2 restantes (GRUPO 4) son flakes pre-existentes documentados, fuera del alcance de esta tanda. Sin cambios de DB. Para el leader: revisar el fix de producto #8 (reviewer + veto) y la nota de reconciliación en `design.md` antes de commitear.
