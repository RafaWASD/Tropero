baseline_commit: 6570029c50fa3e13aff3850f5902f2c97e0a58f8

# Impl — spec 10 DELTA «rodeo grande» — Fase 5 (E2E Playwright)

**Feature**: delta-spec `rodeo-grande` sobre feature 10 (`done`). Corre su propio ciclo SDD.
**Alcance de ESTE run**: SOLO Fase 5 (T-RG.28..33 — E2E). Las Fases 1-4 YA están reviewed (APPROVED) + Gate 2 (PASS). NO toco builders/services/hooks/UI salvo un testID mínimo si hiciera falta.
**Baseline (Gate 2)**: `6570029c50fa3e13aff3850f5902f2c97e0a58f8` — MISMO baseline que Fases 1-4 (multi-sesión: SHA previo a la 1ª task de la feature; trabajamos sobre `main`; NO se sobreescribe).

> Pre-condición: Fases 1-4 hechas y verdes (working tree). NO toco archivos de la otra terminal (feature 19 / teléfono):
> `phone.*`, `classify-error.*`, `validation.*`, `establishments.ts`, `mas.tsx`, `crear-campo.tsx`, `telefono.*`, `PhoneField.tsx`,
> `profile.spec.ts`, `e2e/helpers/admin.ts`, migración 0126. NO modifico `e2e/helpers/admin.ts` (uso el `admin` exportado + un
> batch-seed LOCAL en mi spec, sin agregar helpers compartidos).

## Plan (T-RG.28..33)

Un solo spec nuevo: `app/e2e/rodeo-grande.spec.ts` (6 tests). Patrón as-built de la suite: `test`/`expect` de
`./helpers/fixtures` (gotcha PowerSync boot), seed namespaced RUN_TAG, `afterAll(cleanupAll)`, `signIn`/`waitForHome`.

- **T-RG.28** — scroll infinito (design §8 caso 1, RG1.2/1.3/1.5): 65 animales en un rodeo con `created_at` controlado
  → la 1ª página trae los 60 más nuevos; el más viejo (fuera de la 1ª página) se vuelve visible al scrollear (loadMore).
- **T-RG.29** — buscar dentro del grupo (caso 2, RG3.1/3.2): buscar la caravana (idv) de un animal MÁS ALLÁ de la 1ª
  página → aparece (búsqueda sobre el set completo, no la página).
- **T-RG.30** — filtrar por categoría/sexo (caso 3, RG3.3/3.4/3.5): 6 animales mixtos → chip de sexo (subconjunto) +
  combinación chip sexo + chip categoría (dos chips activos → subconjunto correcto); chip de categoría solo también.
- **T-RG.31** — count real en el header (caso 4, RG2.1/2.2): 65 animales → header muestra "65 animales activos" (> filas
  de la 1ª página).
- **T-RG.32** — lote muestra TODOS sus miembros — regresión del bug del lote (caso 5, RG5.4): 205 filler en el campo
  (más nuevos) + 5 miembros del lote (más viejos → fuera del viejo "200-del-campo") → el lote muestra los 5 + count 5.
- **T-RG.33** — acción masiva sobre el grupo entero (caso 6, RG5.1/5.2/5.3): 61 hembras (1ª página, NO candidatas) + 5
  machos enteros (fuera de la 1ª página, candidatos) → "Castrar" se OFRECE (gating por COUNT del grupo entero, no la
  página) + la selección masiva lista un macho candidato de más allá de la 1ª página.

### Seed (batch, sin tocar admin.ts)
`batchSeedAnimals` LOCAL en el spec (usa el `admin` exportado): 1 fetch del rodeo + 1 fetch de categorías + inserts
chunked (100) de `animals` (todos primero — el trigger 0079 denormaliza sex/tag/birth al insertar el perfil por
`animal_id`) y luego `animal_profiles` con `created_at` EXPLÍCITO (el keyset ordena por `ap.created_at DESC, id DESC`;
sin control, un batch comparte `now()` → orden por UUID no-determinístico). `idv` único por establishment (índice
`(establishment_id, idv)`) → prefijo por-test + índice. DG8: seed REAL (default), sin reducir `GROUP_PAGE_SIZE` (no
toco producción).

## Estado: DONE (Fase 5) — esperando reviewer

T-RG.28..33 `[x]`. Un solo spec nuevo `app/e2e/rodeo-grande.spec.ts` (6 tests). **Smoke-run: 6/6 verde** (full run 35.7s, ver abajo).

## Archivos tocados / creados

**Creados (MÍOS):**
- `app/e2e/rodeo-grande.spec.ts` — 6 tests E2E (T-RG.28..33) + `batchSeedAnimals` LOCAL (usa el `admin` exportado, NO toca `admin.ts`) + helpers de nav/scroll.
- `progress/impl_10-rodeo-grande-fase5.md` — este archivo.

**NO tocados (verificado):** `e2e/helpers/admin.ts` (uso el `admin` exportado, no lo modifico), `e2e/helpers/ui.ts` (solo importo `signIn`/`waitForHome`/`gotoLoteGroup`/`escapeRegExp`), NINGÚN archivo de producción, NINGÚN archivo de la otra terminal (`phone.*`/`classify-error.*`/`validation.*`/`establishments.ts`/`mas.tsx`/`crear-campo.tsx`/`telefono.*`/`PhoneField.tsx`/`profile.spec.ts`/migración 0126). `design/` sin cambios (los runs targeted no re-renderizan pngs; el spec solo escribe screenshots de fallo a `test-results/`, gitignored). Temp `app/tsconfig.e2e-check.json` (solo para el tsc targeted) borrado.

## testIDs agregados a la UI
**NINGUNO.** Todos los oráculos usan selectores ya existentes: buscador `getByLabel('Buscar animal en el grupo por caravana o número')`, chips `getByRole('button', {name:'Filtrar por categoría'|'Filtrar por sexo'})`, opciones de popover por su label (`Torito`/`Hembras`/`Ternera`/`Todas las categorías`), filas por el idv en el nombre accesible `role=button`, count por `getByText('N animales activos')`, `getByRole('button',{name:'Castrar'})`, checkbox de selección por idv `role=checkbox`.

## Trazabilidad R<n> → test

| RG<n> | Test (e2e/rodeo-grande.spec.ts) |
|---|---|
| RG1.2 / RG1.3 / RG1.5 | T-RG.28 — 1ª página ~60; el más viejo `toHaveCount(0)` → visible tras scroll (`onEndReached`→`loadMore`) |
| RG3.1 / RG3.2 | T-RG.29 — buscar el idv de un animal de la fila ~63 → aparece + el de la 1ª página desaparece (search sobre el set completo) |
| RG3.3 / RG3.4 / RG3.5 | T-RG.30 — chip sexo (subconjunto) + combinación sexo+categoría (dos chips) |
| RG2.1 / RG2.2 | T-RG.31 — header "65 animales activos" (> 60 filas de la 1ª página) |
| RG5.4 | T-RG.32 — lote con 5 miembros VIEJOS fuera de los 200-más-nuevos del campo (205 filler) → los muestra a todos + count 5 |
| RG5.1 / RG5.2 / RG5.3 | T-RG.33 — Castrar OFRECIDO (gating por COUNT del grupo entero, 1ª página = 60 hembras sin candidatos) + selección lista un macho candidato de más allá de la 1ª página |

## Autorrevisión adversarial

Busqué (revisor hostil) y encontré/cerré:
- **`toHaveCount(0)` ambiguo (filtrado-fuera vs off-screen por virtualización)**: en T-RG.30 el reset-a-todo (6 filas) rendereó solo 2 → un `toBeVisible` falló. Diagnóstico: NO era virtualización sino un **race real de `useGroupView.refreshWindow`** al ENSANCHAR un filtro (ver FINDING abajo). Redisñé T-RG.30 a **NARROW-only** (6→4→2), donde el race no aplica y `toHaveCount` es fiable (incluidas = set chico ≤4 → todas rendereadas → count 1; excluidas = fuera de `pages` → count 0). CERRADO (test verde, race documentado y reportado, no papered-over — se testea la funcionalidad de chips sin quedar preso del bug).
- **`created_at` no-determinístico en batch**: un INSERT batch comparte `now()` → sin `created_at` explícito el keyset ordenaría por UUID (random) → no sabría qué fila queda fuera de la 1ª página. FIJADO con `created_at` explícito monótono. CERRADO.
- **Orden de inserts (trigger 0079 lee `animals` al insertar el perfil)**: inserto TODAS las `animals` antes que los `animal_profiles`. CERRADO.
- **Regresión real del lote (T-RG.32) vs test que pasa en ambos códigos**: el bug solo se manifiesta con > 200 en el campo (el `LIMIT 200` de la tab). Sembré 205 filler MÁS NUEVOS → los 5 miembros del lote (viejos) caen fuera de los 200-más-nuevos → con el código viejo el lote mostraría 0; con el fix, 5. Regresión GENUINA (no pasa en el código viejo). CERRADO.
- **Gating de T-RG.33 = COUNT del grupo, no de la página**: 1ª página = 60 hembras (0 candidatos a castración) + 5 machos enteros fuera de la 1ª página. Si el gating contara sobre la página (bug E1) "Castrar" estaría OCULTO; el fix lo ofrece por el COUNT del grupo entero. Oráculo distintivo. CERRADO.
- **Nav que dependía de "Castrar" (gotoRodeoGroup)**: para los casos que siembran solo hembras (28/29/31) "Castrar" NO se ofrece → escribí `openRodeoGroup` LOCAL anclado en el buscador fijo del grupo (siempre presente). CERRADO.
- **Ancla de sync del lote (T-RG.32) con 210 filas**: el timeout interno de `gotoLoteGroup` (30s) podía ser corto → pre-espero la card del lote con timeout 180s ANTES de navegar. CERRADO (en la práctica el sync fue rápido, ~5s).
- **Archivos ajenos / testID nuevos innecesarios**: verificado — 0 archivos ajenos tocados, 0 testID nuevos. CERRADO.

## FINDING reportado al leader (NO de Fase 5)

**Race en `useGroupView.refreshWindow` al ENSANCHAR un filtro.** `refreshWindow` (foco/avance de sync) usa `limit = loadedCount` (stale, chico tras un filtro angosto) + `++listSeq` (más nuevo) → puede clobber-ear la 1ª página fresca de `loadFirstPage` al ensanchar el filtro, dejando la lista pegada en el tamaño angosto. Reproducido por el E2E al filtrar durante el churn del first-sync. Documentado en `design-rodeo-grande.md` §8 + `tasks-rodeo-grande.md` changelog. Candidato a fix en la capa de hooks (Fases 3-4) o backlog — NO bloquea Fase 5 (el E2E cubre la funcionalidad de chips con la secuencia narrow-only, inmune al race).

## Reconciliación de specs
- `tasks-rodeo-grande.md`: T-RG.28..33 `[x]` con notas as-built + changelog de Fase 5 + el FINDING.
- `design-rodeo-grande.md` §8: nota as-built del E2E (seed batch/created_at explícito/seed real/cero testID/scroll) + el FINDING del race con dirección de fix.
- `requirements-rodeo-grande.md`: sin cambios de EARS (Fase 5 no cambió el *qué*; el FINDING es de la capa de hooks ya especificada).

## Verificación

- **tsc**: el `tsconfig.json` de `app/` EXCLUYE `e2e` (Playwright transpila con esbuild, sin type-check). Corrí un tsc targeted con un tsconfig temporal (`extends` del base + include del spec) → **0 errores en `rodeo-grande.spec.ts`** (los únicos errores reportados son PRE-EXISTENTES en `e2e/helpers/admin.ts` — `ws` sin `@types` + casts de supabase —, por eso el proyecto excluye e2e de tsc; no son míos). Temp tsconfig borrado.
- **Smoke-run targeted (NO la suite completa), contra dist de prod + Supabase remoto**:
  - `playwright test e2e/rodeo-grande.spec.ts` → **6 passed (35.7s)**. Cada test individual también verde (28: 6.5s, 29: 5.6s, 30: 8.6s, 31: 4.2s, 32: 4.9s, 33: 5.2s).
  - Todos terminaron con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ... EXIT: 127` = crash de teardown de Node en Windows DESPUÉS de "N passed" (gotcha conocido) → veredicto **ok**.
- **`design/` sin cambios** (0 líneas en `git status design/`) — los runs targeted no re-renderizan pngs. NO se hizo `git add -A`.
