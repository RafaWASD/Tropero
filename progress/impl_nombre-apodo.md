# impl — Delta #2 NOMBRE/APODO por rodeo (spec 02, `nombre-apodo`)

baseline_commit: fd5c7e28183c3c23a72fb98a1a97ca22292d6805

Delta **Nivel B (ADR-028)** sobre spec 02 (`in_progress`) · **CON BACKEND** (seed `0119`) · Gate 1 PASS (fix foldeado) · Deploy autorizado · Migración `0119`.
Implementer: solo código + tests. **NO** marca `done`, **NO** toca `feature_list.json`/`current.md`. La migración `0119` la aplica el **leader por MCP** tras el veto de SQL + reviewer + Gate 2 + Gate 2.5.

---

## Tasks

- [x] **T1** — `supabase/migrations/0119_seed_apodo_field_definition.sql` (backfill-only per-est, `on conflict ... where establishment_id is not null and deleted_at is null do nothing` = predicado del índice `0101` vigente, fix Gate 1). **NO aplicada** (leader).
- [x] **T2** — Test backend `supabase/tests/custom/run.cjs` subtest `(p)` (replica el seed sobre fixture fresca; ver §Backend test). **NO corrido** (leader tras aplicar `0119`).
- [x] **T3** — Removido el `FormField` editable "Nombre / seña (opcional)" de `crear-animal.tsx`; conservado el read-only `prefillKind==='visual'`; podado el wiring muerto (`onVisual`, imports `sanitizeVisualInput`/`VISUAL_MAX_LENGTH`, `visual` → const derivado read-only).
- [x] **T4** — Mensaje mínimo → `'Cargá al menos un identificador: caravana electrónica o caravana visual.'` (sin "nombre/seña"); `hasAtLeastOneIdentifier` intacto.
- [x] **T5** — Verificado (sin código): `animal/[id].tsx` conserva el display condicional de `visual_id_alt` (L898-899) + apodo por `CustomPropertiesFicha`.
- [x] **T6** — `app/e2e/captures/nombre-apodo.capture.ts` (4 shots). Compila (`playwright --list`). **NO corrido** (leader, Gate 2.5).
- [x] **T7** — Bloque `delta #2 nombre/apodo` en `animals.spec.ts` (2 tests) + **migración obligatoria** de los ~17 fills del built-in a idv (4 archivos e2e). Compilan (`playwright --list` 58 tests). **NO corrido** (leader).
- [ ] **T8** — Reconciliación de cierre (fold al `design.md` baseline de spec 02). Pendiente **al cierre (leader, Puerta 2)**, patrón #15 T22.

---

## Mapa RNA → archivo:test

| RNA | Cubierto por |
|---|---|
| RNA.1.1 (fila apodo per-est, campos) | `0119_...sql` (INSERT) · `custom/run.cjs (p)` (shape asserts) |
| RNA.1.2 (idempotencia on-conflict) | `0119_...sql` (`on conflict ... and deleted_at is null do nothing`) · `custom/run.cjs (p)` (2do apodo vivo → 23505) |
| RNA.1.3 (no rodeo_data_config/system_default_fields) | `custom/run.cjs (p)` (rodeo_data_config vacío + system_default_fields 0 filas) |
| RNA.1.4 (no NULL global) | `0119_...sql` (`e.id`) · `custom/run.cjs (p)` (`establishment_id === estA`) |
| RNA.1.5 (sin triggers sobre establishments) | `0119_...sql` (solo `INSERT ... SELECT`, sin trigger) |
| RNA.2.1 (alta sin editable "Nombre/seña") | `crear-animal.tsx` (FormField removido) · `animals.spec.ts` delta #2 (a) `toHaveCount(0)` · capture `01` |
| RNA.2.2 (apodo por CustomPropertiesForm) | `animals.spec.ts` delta #2 (c) · `maniobra-custom-render.spec.ts` PART B · capture `03` |
| RNA.2.3 (read-only prefill visual conservado) | `crear-animal.tsx` (read-only FormField) · `animals-offline.spec.ts:194` ("Nombre / seña (no editable)") |
| RNA.3.1 (mensaje sin "nombre/seña") | `crear-animal.tsx` L541 · `animals.spec.ts` delta #2 (a) · capture `02` |
| RNA.3.2 (hasAtLeastOneIdentifier no relajado) | `crear-animal.tsx` (sin cambio) · `animals.spec.ts` delta #2 (a) (no navega) · `animal-form.test.ts` (existente) |
| RNA.4.1 (ficha display legacy visual_id_alt) | `animal/[id].tsx` (sin cambio) · `animals.spec.ts` caravana-ficha (`seedAnimal({visualAlt})`) · `animals-offline.spec.ts:194` |
| RNA.4.2 (ficha apodo por CustomPropertiesFicha) | `animals.spec.ts` delta #2 (c) ficha · `maniobra-custom-render.spec.ts` PART B · capture `04` |
| RNA.5.1 (sin mecanismo nuevo) | reuso puro (sin archivos nuevos de mecanismo); delta #2 (c) reusa `seedCustomField`/`custom_attributes` |
| RNA.5.2 (no tocar queries/config/policies) | `git diff` no toca `local-reads.ts`/`custom-fields.ts`/`rodeo-config.ts`/`editar-plantilla.tsx`/streams |
| RNA.6.1 (RLS sin fuga cross-tenant) | seed per-est (`0119`) + Gate 1 · `custom/run.cjs (e)` WAL frontier (existente, per-est scope) |
| RNA.6.2 (no enabled por default) | `custom/run.cjs (p)` (no en system_default_fields) |
| RNA.6.3 (gating custom_attributes) | `custom/run.cjs (p)` (string OK / número → 23514) |
| RNA.6.4 (sin regresión resto alta/ficha) | `animals.spec.ts` suite migrada (verde) · `pnpm typecheck` limpio |
| RNA.6.5 (no toca onboarding) | `0119_...sql` (sin trigger sobre `establishments`) |
| RNA.7.1 (capture) | `app/e2e/captures/nombre-apodo.capture.ts` (4 shots) |
| RNA.8.1 (test remoción + mensaje) | `animals.spec.ts` delta #2 (a) · capture `01`/`02` |
| RNA.8.2 (test flujo custom apodo) | `animals.spec.ts` delta #2 (c) · `maniobra-custom-render.spec.ts` PART B |
| RNA.8.3 (test backend) | `custom/run.cjs (p)` |

---

## SQL del seed (para el veto del leader) — `0119_seed_apodo_field_definition.sql`

Backfill-only per-est, idempotente. El `on conflict` reproduce EXACTO el predicado del índice parcial
`field_definitions_data_key_per_est` **vigente en el remoto** (`0101`: `establishment_id is not null AND
deleted_at is null`). Todas las filas insertadas tienen `establishment_id` no-NULL + `deleted_at` NULL → matchean.
Corre service_role (`auth.uid()` NULL) → `tg_field_definitions_custom_guard` hace `return new`.

```sql
begin;

insert into public.field_definitions
  (establishment_id, data_key, label, description, category, data_type, ui_component, active)
select
  e.id, 'apodo', 'Nombre / apodo',
  'Nombre o apodo del animal (texto libre). Por rodeo, opt-in del owner.',
  'identificacion', 'propiedad', 'text', true
from public.establishments e
on conflict (establishment_id, data_key) where establishment_id is not null and deleted_at is null
do nothing;

notify pgrst, 'reload schema';

commit;
```

**Puntos de veto:** (a) el `where` del `on conflict` = predicado del índice `0101` (no `0093`); (b) sin trigger sobre `establishments`; (c) no toca `rodeo_data_config`/`system_default_fields`/RLS/streams; (d) `category='identificacion'` (≤32) + `label` (≤80) + `data_key` slug + `ui_component='text'` satisfacen los CHECKs de `0093`; (e) `0119` libre (highest = `0118`).

---

## Backend test `(p)` — enfoque (as-built)

El seed es **backfill-only** (sin trigger). La suite `custom/run.cjs` usa fixtures **frescas** → un establishment creado por el test **NO** queda auto-seedeado por `0119`. Por eso el test `(p)` **replica el INSERT del seed** (mismo cuerpo, service_role) sobre su `estA` y verifica la **lógica** del seed de punta a punta: shape per-est (RNA.1.1/1.4), no-en-`system_default_fields` (RNA.6.2), no-auto-enabled (RNA.1.3), colisión del índice parcial `0101` (base de idempotencia RNA.1.2), enable-por-owner (RNA.8.3), gating string/número (RNA.6.3).

**Deviación consciente de la instrucción (flag para el leader):** la instrucción anticipaba que *"el test backend fallará hasta que el leader aplique 0119"*. El enfoque self-contained elegido **NO** falla-hasta-aplicar (es determinista y no depende de estado compartido). Razón: un test que consulte los rows realmente backfilleados sería (a) **falso-rojo incluso post-apply** para el establishment fresco del test (backfill-only ⇒ no auto-seed), y (b) flakeable si dependiera de un `count(*)` global sobre establecimientos pre-existentes (que se limpian). El self-contained prueba la **misma lógica** de forma robusta. La verificación del **backfill real** de los establecimientos pre-existentes la hace el leader por MCP tras aplicar `0119` (`select count(*) from field_definitions where data_key='apodo' and category='identificacion'` → N = nº de establecimientos existentes).

## Qué queda "rojo/pendiente hasta que el leader actúe"

- **Migración `0119`**: escrita, **NO aplicada**. La aplica el leader por MCP (deploy autorizado) tras el veto de SQL + Gate 2 (re-verificar el `on conflict` contra el índice vigente) + reviewer + Gate 2.5.
- **Suite backend `custom/run.cjs`**: **NO corrida** por mí (instrucción). La corre el leader; el subtest `(p)` pasa **con o sin** `0119` aplicado (self-contained). El resto de la suite requiere `0093-0097` (ya aplicadas).
- **Capture + E2E de regresión**: **NO corridos** por mí (necesitan `pnpm e2e:build` + server + Supabase). Los corre el leader (Gate 2.5 el capture; la suite E2E en el gate). Compilan (`playwright --list`). El E2E delta #2 (c) usa `seedCustomField` → **independiente de `0119`**.

## Verificación local corrida

- `pnpm typecheck` → **limpio** (app; e2e excluido por `tsconfig`).
- `node --test animal-input.test.ts animal-form.test.ts` → **19/19** (`sanitizeVisualInput` sigue exportado + testeado; no se borró de `animal-input.ts`).
- `node --check supabase/tests/custom/run.cjs` → **OK**.
- `playwright test --list` (4 specs migrados) → **58 tests, 0 errores de compilación**; (capture) → **1 test**.
- `node scripts/check.mjs --fast` → **anti-hardcode 0 violaciones**; verde.

---

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

1. **¿Saqué SOLO el editable, no el read-only del prefill?** ✅ Removí el `FormField` `prefillKind !== 'visual'`; el read-only `prefillKind === 'visual'` ("Nombre / seña (no editable)", `value={visual}`) quedó intacto (L1266-1272). Cubierto por `animals-offline.spec.ts:194` (assert `toHaveValue('34')`).
2. **¿El mensaje de validación quedó coherente?** ✅ Enumera solo los identificadores editables vigentes (electrónica + caravana visual). `hasAtLeastOneIdentifier(tag, idv, visual)` sigue aceptando `visual` (para el camino prefill `visual`, donde `visual` es no-vacío → nunca dispara el mensaje). En alta en blanco `visual === ''` → el mensaje es correcto.
3. **¿El `on conflict` tiene `and deleted_at is null`?** ✅ Sí (fix Gate 1, predicado del índice `0101`). Sin él, `42P10` y la migración aborta.
4. **¿La ficha quedó intacta?** ✅ `animal/[id].tsx` sin cambios; display condicional de `visual_id_alt` conservado (RNA.4.1); apodo por `CustomPropertiesFicha` (RNA.4.2).
5. **¿Tests que pasan por imports muertos / que no ejercen el path real?** Verifiqué:
   - `sanitizeVisualInput`/`VISUAL_MAX_LENGTH` removidos del import de `crear-animal.tsx` (quedaban sin uso tras remover el FormField); grep confirma 0 referencias huérfanas en el screen.
   - `resolveProfileIdByVisual` (helper muerto tras migrar el oráculo a idv) **removido** de `maniobra-custom-render.spec.ts`; `waitForServerAnimalProfile` importado y usado.
   - Nuevos imports en `animals.spec.ts` (`seedCustomField`, `waitForServerCustomAttribute`) **usados** por el delta #2 (c).
   - Los tests migrados **ejercen el path real**: fillan la caravana visual (idv) editable, y los oráculos server pasaron de `{ visualAlt }` a `{ idv }` (matchean la columna real que ahora lleva el identificador). Los `seedAnimal({ visualAlt })` (service_role) se conservan a propósito: testean el display legacy de ficha (RNA.4.1), no el form removido.
6. **¿Gaps de seguridad?** El seed no expone RPC, no toca RLS/policies/streams (RNA.5.2), es per-est (sin fuga cross-tenant), fail-closed por `assert_custom_field_enabled` (0096). El `(p)` prueba el gating string/número. Sin `search_path`/`revoke`/`grant` nuevos (no hay función nueva).
7. **¿Offline / multi-tenant?** El apodo fluye por el patrón soft-fail existente (`CustomPropertiesForm` → `custom_attributes`), sin camino de sync nuevo. El seed lleva `establishment_id` real por fila (per-tenant). Sin hardcode de `establishment_id`.

**Encontrado y cerrado durante la autorrevisión:** el helper `resolveProfileIdByVisual` habría quedado muerto (dead code) tras migrar el oráculo → lo removí y usé `waitForServerAnimalProfile({ idv })`. `visual` quedaba como `useState` con `setVisual` sin uso → lo convertí a `const` derivado read-only.

---

## Reconciliación de specs (paso 9)

Reconciliado el as-built (implementación ≠ literal de la spec en 2 puntos):

1. **`design-nombre-apodo.md §Tests / As-built`** (nuevo bloque): (a) el test backend replica el seed sobre fixture fresca (backfill-only ⇒ no auto-seed) en `custom/run.cjs (p)`; (b) remover el built-in obligó a **migrar los ~17 fills** de "Nombre / seña" a idv en 4 archivos e2e (`animals`/`sigsa-breed-renspa`/`maniobra-identify`/`maniobra-custom-render`), conservando los `seedAnimal({visualAlt})` (display legacy). Capture con 4 shots nombrados.
2. **`requirements-nombre-apodo.md` RNA.8.3**: nota de reconciliación (test self-contained determinista, backfill de ests pre-existentes verificado por el leader por MCP). EARS **no** reescrito.
3. **`tasks-nombre-apodo.md`**: T1-T7 `[x]` con as-built; T8 (fold al baseline) `[ ]` justificado como acción de cierre del leader (Puerta 2).

`import-rodeo.tsx` (mensaje de identificador del flujo de import, feature 12) **no tocado** — no-alcance explícito del `context.md`.
