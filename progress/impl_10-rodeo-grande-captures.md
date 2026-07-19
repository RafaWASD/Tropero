# impl 10 — rodeo grande — capture file de Gate 2.5 (ADR-029)

**Deliverable único**: `app/e2e/captures/rodeo-grande.capture.ts` — el capture file dedicado de veto visual para el
Gate 2.5 del delta «rodeo grande» (feature 10). Las Fases 1-5 (builders/services/hooks/UI/E2E) + el fix del race
YA estaban hechas, reviewed (APPROVED) y NO se reabrieron. Esto entrega SOLO el artefacto de capturas que faltaba.

## Qué se entregó

- **CREADO**: `app/e2e/captures/rodeo-grande.capture.ts` (2 tests, viewport mobile 412×915, contexto propio por
  test, `applyEnvShim`, `try/finally { ctx.close() }`, `afterAll(cleanupAll)`). Patrón copiado de
  `lotes-venta.capture.ts`; seed + navegación copiados LOCALMENTE del hermano de regresión
  `e2e/rodeo-grande.spec.ts` (`batchSeedAnimals`, `idvPrefix`/`idvOf`/`createdAtOf`, `openRodeoGroup`,
  `groupSearchInput`, `groupRow`, `scrollGroupListToBottom`/`scrollUntilRowVisible`). Importa lo exportado de
  `../helpers/{admin,ui,fixtures}` — NO modifica ningún helper.
- **RECONCILIADO**: `specs/active/10-operaciones-rodeo/tasks-rodeo-grande.md` — entrada de changelog del capture
  file de Gate 2.5 con la lista de shots. NO se tocaron requirements/design (sin contradicción real).
- **NO se tocó** ningún archivo de producción (builders/services/hooks/UI), ni `rodeo-grande.spec.ts`, ni
  `helpers/admin.ts`/`helpers/ui.ts`, ni archivos de la otra terminal (feature 19 / teléfono / pelajes / HANDOFF).

## 10 capturas NOMBRADAS → `e2e/captures/__shots__/rodeo-grande/` (gitignored)

Rodeo GRANDE (65 animales, mezcla catFor: ~13 toritos + ~13 terneras + ~39 vaquillonas → chips con opciones reales):

- `01-rodeo-grande-lista.png` — HERO: header con count real "65 animales activos", buscador fijo, chips
  categoría/sexo, actions card (Vacunar/Destetar/Castrar) + primeras filas de la lista paginada.
- `02-buscador-activo.png` — tipear el idv de un animal de más allá de la 1ª página → un solo match (búsqueda
  sobre el SET COMPLETO del grupo).
- `03-chip-categoria-abierto.png` — popover del chip "Filtrar por categoría" (Todas las categorías / Ternera /
  Torito / Vaquillona).
- `04-chip-sexo-abierto.png` — popover del chip "Filtrar por sexo" (Ambos sexos / Machos / Hembras).
- `05-filtro-combinado.png` — dos chips activos (Categoría: Ternera + Sexo: Hembras) en verde relleno + lista al
  subconjunto (terneras).
- `06-busqueda-sin-resultados.png` — idv inexistente → empty state "No encontramos «…» en este grupo".
- `07-scroll-segunda-pagina.png` — tras el loadMore, filas de la 2ª página montadas (hasta el más viejo, …001).
- `09-castrar-ofrecido.png` — actions bar del grupo con "Castrar" ofrecido (gating por el grupo entero, hay
  machos enteros) — encuadre distinto del hero (scroll modesto).
- `10-seleccion-masiva.png` — pantalla de selección masiva de Castrar: 13 candidatos del set COMPLETO (incluye
  toritos de más allá de la 1ª página), tildados + CTA "Castrar 13 animales" habilitado.

Lote (campo de 65 con un lote de 8 miembros):

- `08-lote-todos-miembros.png` — vista del LOTE con sus 8 miembros + count real "8 animales activos" + la acción
  fija "Vender / Descartar" (testId `lote-vender-descartar`).

## Verificación (self-check del deliverable)

1. **tsc targeted** (tsconfig temporal que `extends` el base + incluye SOLO el `.capture.ts`, con
   `types:[node]` + `moduleResolution:bundler` para resolver el node: protocol que Playwright transpila fuera de
   tsc): **0 errores propios**. Los únicos errores que quedan son pre-existentes en `helpers/admin.ts` (TS7016
   `ws` sin `@types/ws` + 2 TS2352 de casts) — NO son de este archivo. El tsconfig temporal se borró.
2. **Corrida del capture**: `pnpm exec playwright test e2e/captures/rodeo-grande.capture.ts --config
   playwright.capture.config.ts` → **2 passed (29.0s)**. El `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
   … exit 127` DESPUÉS de "passed" es el gotcha conocido de teardown de Node en Windows → veredicto OK. Las 10
   capturas se escribieron a `__shots__/rodeo-grande/` (44-88 KB c/u, ninguna degenerada/blanca).
3. Dist fresco: `dist/index.html` (22:53:20) es posterior a todos los fuentes del feature (incl. `useGroupView.ts`
   22:53:04, el fix del race) y el bundle contiene las strings del feature (buscador in-grupo, chips, "Cargando
   más", "Vender / Descartar") → NO se rebuildeó (se evitó el re-render de `design/**/*.png`).

## Autorrevisión adversarial (paso 8)

Busqué, como revisor hostil, y corregí ANTES de cerrar:

- **[CORREGIDO] Categoría incoherente en las filas.** Seed inicial sin `birth_date` ni `category_override` → la
  lista recomputa la categoría por edad (mirror, `animals.ts` §370: solo cuando `category_override=false`) y una
  ternera sin edad caía al default de hembra adulta → los shots mostraban filas "Vaquillona" bajo un filtro
  "Categoría: Ternera" (riesgo de veto). Fix: sembrar con `category_override=true` (la categoría GUARDADA manda,
  RC6.3.3) + `birth_date` acorde por categoría (torito ~14m, ternera ~6m, vaquillona ~18m). Re-verificado
  visualmente: 05/07/08/09 ahora muestran "Ternera · 5 meses" / "Torito · 1 año" / "Vaquillona · 1 año" coherentes.
- **[CORREGIDO] Shot 09 byte-idéntico al 01.** La actions card vive en el header de la lista → el hero ya la
  mostraba → `09` salía idéntico (md5 igual). Fix: `09` scrollea un poco (encuadra la actions card prominente con
  la lista mezclada abajo) → ahora distinto (md5 distinto) y más informativo (muestra el gating sobre un grupo
  mixto).
- **[CORREGIDO] Shot 10 "vacío" (0 seleccionados).** Los toritos adultos NO vienen pre-tildados → el shot salía
  con CTA deshabilitada "Castrar 0 animales". Fix: tildar "todos" → 13 seleccionados + CTA "Castrar 13 animales"
  habilitado + checkboxes tildados (estado de selección real, incluye candidatos de más allá de la 1ª página).
- **Cada shot va DESPUÉS de un `expect(...).toBeVisible()`/`toHaveCount()` del elemento clave** (count real,
  buscador, popovers por opción, empty state, fila de la 2ª página, checkbox de un candidato off-page) → no se
  captura una pantalla intermedia/en blanco. Timeouts amplios (30-45s) para el first-sync, como el spec.
- **Seeds MODESTOS** (65, no los volúmenes de la regresión) → rápido + menos riesgo de rate-limit (hay otra
  terminal activa). Sin testIDs/logs nuevos en producción (CERO cambio de prod).
- **Re-corrible**: datos namespaced (RUN_TAG) + `cleanupAll` en `afterAll` → sin colisión entre corridas.
- **Scope limpio (git status)**: solo `?? app/e2e/captures/rodeo-grande.capture.ts` como untracked; `__shots__/`
  gitignored (no aparece); `design/` limpio (sin `*.png` sin revertir); ningún `.png` trackeable; los archivos de
  la otra terminal (HANDOFF-feature19 / docs/pelajes-*) siguen untracked tal como estaban — NO los toqué.

## Estado

Deliverable de Gate 2.5 COMPLETO. El leader corre este capture y veta el diseño contra las 10 capturas antes de la
Puerta 2. No hay nada de producción que revisar acá (solo el `.capture.ts`).
