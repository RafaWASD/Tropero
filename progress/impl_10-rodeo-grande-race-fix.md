baseline_commit: 6570029c50fa3e13aff3850f5902f2c97e0a58f8

# Impl — spec 10 DELTA «rodeo grande» — FIX del race de `useGroupView.refreshWindow` (ensanchar-filtro)

**Feature**: delta-spec `rodeo-grande` sobre feature 10. Corre su propio ciclo SDD.
**Alcance de ESTE run**: SOLO el fix targeted del race que la Fase 5 (E2E) destapó (documentado como FINDING en
`design-rodeo-grande.md` §8 + `tasks-rodeo-grande.md` changelog). Toca la capa de hooks (Fases 3-4). NO reabre
builders/services/UI. Cierra el finding antes de la puerta final.
**Baseline (Gate 2)**: `6570029c50fa3e13aff3850f5902f2c97e0a58f8` — MISMO baseline que Fases 1-5 (multi-sesión:
SHA previo a la 1ª task de la feature; trabajamos sobre `main`; NO se sobreescribe). El fix va sobre el working
tree que ya tiene Fases 1-5 (sin commitear).

> Pre-condición: Fases 1-5 en el working tree (verde). NO toco archivos de la otra terminal (feature 19 / teléfono):
> `phone.*`, `classify-error.*`, `validation.*`, `establishments.ts`, `mas.tsx`, `crear-campo.tsx`, `telefono.*`,
> `PhoneField.tsx`, `profile.spec.ts`, `e2e/helpers/admin.ts`, migración 0126.

## El bug (traza)

Al ENSANCHAR un filtro (limpiar chip de categoría / pasar a "Todas"), la lista puede quedar pegada en el tamaño
angosto. `loadFirstPage` (cambio de chip) fetchea la 1ª página fresca (~60), pero un `refreshWindow` de FONDO
(foco/avance de sync) lee `loadedCount = pagesRef.current.length` STALE (angosto, ej. 2) → `limit=2`, bumpea
`listSeq` (más nuevo) → clobber-ea la carga fresca dejando 2 filas anchas. Raíz: `listSeq` compartido +
`refreshWindow` de fondo puede bumpear seq DESPUÉS de un `loadFirstPage` de primer plano, y encima aplica una
ventana con `limit`/`reachedEnd`/filtro STALE.

**Deterministico, no flaky**: al ensanchar, los efectos de foco (l.317) Y de sync (l.332) re-disparan
`refreshWindow` (su identidad cambia con `categoryCode`/`sex`), Y el efecto de lista (l.301) dispara
`loadFirstPage`. Orden de efectos = declaración: `loadFirstPage` (seq=N) → `refreshWindow` foco (seq=N+1) →
`refreshWindow` sync (seq=N+2). El ÚLTIMO en bumpear seq gana → el `refreshWindow` de sync (stale) aplica.

## Approach elegido: (a) — `refreshWindow` CEDE si hay una carga de foreground en vuelo

Elegido **(a)**: `refreshWindow` hace bail al INICIO (antes de bumpear `listSeq` o leer `loadedCount`/`reachedEnd`/
filtro) si hay una carga de foreground en vuelo — 1ª página / refresh previo (`loadingRef`) O `loadMore`
(`loadingMoreRef`). Guard decidible extraído a `utils/group-view-model.ts` (`shouldYieldWindowRefresh`, PURO +
unit test).

**Por qué (a) y no (b)/(max):**
- **(a) elimina la clase ENTERA de lecturas stale**, no solo `loadedCount`. El alternativo `max(loadedCount,
  GROUP_PAGE_SIZE)` (design §8) arregla el síntoma de `loadedCount` pero deja `prevReachedEnd = reachedEndRef.current`
  STALE (angosto) → al ensanchar marcaría la lista ancha como `reachedEnd=true` cuando hay más abajo → bloquea
  `loadMore` (bug nuevo). El filtro capturado en la closure también sería el viejo si la identidad no cambió.
- **(b) `criterionVersion` NO cubre la traza exacta**: cuando `refreshWindow` arranca DESPUÉS de `loadFirstPage`,
  el criterio (filtro) YA es el nuevo → capturar `criterionVersion` al inicio y re-chequear al final da
  `criterion === current` → NO descarta → aplica las filas stale. El problema es la DATA stale (`loadedCount`),
  no el criterio. (a) lo cubre porque cede ante la carga en vuelo, sin importar el criterio.
- El guard de secuencia EXISTENTE (`listSeq`) ya cubre la dirección inversa (un `loadFirstPage` que arranca
  DURANTE un `refreshWindow` → el refresh se descarta por seq). (a) cubre la dirección del bug (un `refreshWindow`
  de fondo que arrancaría DESPUÉS de un `loadFirstPage`).

**Diff conceptual del guard:**
```ts
// group-view-model.ts (PURO)
export function shouldYieldWindowRefresh(s: { listLoadInFlight: boolean; loadingMore: boolean }): boolean {
  return s.listLoadInFlight || s.loadingMore;
}
// useGroupView.refreshWindow (PRIMERA línea tras el guard est/group, ANTES de leer loadedCount / ++listSeq):
if (shouldYieldWindowRefresh({ listLoadInFlight: loadingRef.current, loadingMore: loadingMoreRef.current })) return;
```

## Plan

- T1 — `shouldYieldWindowRefresh` PURO en `group-view-model.ts` + unit test en `group-view-model.test.ts`.
- T2 — `useGroupView.refreshWindow`: bail al inicio con el guard (import de `shouldYieldWindowRefresh`).
- T3 — E2E: extender `T-RG.30` con un tramo de ENSANCHAR (angosto → ancho, limpiar chips) asertando que la lista
  se RE-PUEBLA al tamaño ancho (las filas filtradas-fuera vuelven a `toHaveCount(1)`). El ensanche mismo dispara el
  refresh concurrente (efectos foco+sync) → cubre el race.
- T4 — Reconciliar specs: design §8 (finding → RESUELTO + as-built del guard) + tasks changelog (sacar "candidato
  a backlog", documentar el fix) + nota de T-RG.30 (ya no narrow-only por el race).

## Estado: DONE — esperando reviewer

T1..T4 hechos. `tsc` verde + unit **184/184** (los 3 tests nuevos del guard) + **E2E rodeo-grande 6/6** (fixed) y
**T-RG.30 CAE con el bug** (guard deshabilitado → falla en el step de ensanchar, `33 × locator resolved to 0`).

## Archivos tocados (SOLO los permitidos)

- `app/src/utils/group-view-model.ts` — `shouldYieldWindowRefresh` (PURO).
- `app/src/utils/group-view-model.test.ts` — 3 tests del guard.
- `app/src/hooks/useGroupView.ts` — import + bail al inicio de `refreshWindow` (2 líneas efectivas; sin otros cambios).
- `app/e2e/rodeo-grande.spec.ts` — T-RG.30: `created_at` explícito (orden determinístico) + tramo de ENSANCHAR
  (2→4→6, limpiar chips) asertando re-población; comentario de cabecera del caso 3.
- `specs/active/10-operaciones-rodeo/design-rodeo-grande.md` — §8 (FINDING → RESUELTO + as-built del guard + por qué
  (a)) + §6.2 punto (4).
- `specs/active/10-operaciones-rodeo/tasks-rodeo-grande.md` — nota as-built de T-RG.30 (ya NO narrow-only) + entrada
  de changelog del fix + "candidato a backlog" → RESUELTO + coverage RG3.7/RG3.8.
- `progress/impl_10-rodeo-grande-race-fix.md` — este archivo.

**NO tocados (verificado por `git status`):** ningún archivo de la otra terminal (`phone.*`, `classify-error.*`,
`validation.*`, `establishments.ts`, `mas.tsx`, `crear-campo.tsx`, `telefono.*`, `PhoneField.tsx`, `profile.spec.ts`,
`e2e/helpers/admin.ts`, migración 0126). `design/*.png` revertido tras cada `e2e:build` (NO `git add -A`).

## Prueba de que el E2E ejercita el race (no pasa por la razón equivocada)

Deshabilité el guard (`if (false && shouldYieldWindowRefresh(...))`), rebuild, corrí SOLO T-RG.30 → **FALLA
determinísticamente** en el step de ENSANCHAR (l.372, `expect(groupRow(vaq1)).toHaveCount(1)` → recibió 0;
`33 × locator resolved to 0 elements` a lo largo del timeout de 15s = pegada, no flaky). Restauré el guard → rebuild
→ **6/6 verde**. El test cae con el bug y pasa con el fix = regresión genuina del race.

## Trazabilidad (R → test)

- Guard PURO del race → `group-view-model.test.ts`: `shouldYieldWindowRefresh — CEDE si hay 1ª página/refresh en
  vuelo` / `CEDE si hay loadMore en vuelo` / `corre normal sin foreground en vuelo`.
- Invariante user-facing (ensanchar re-puebla) → `e2e/rodeo-grande.spec.ts` T-RG.30 tramo (c)/(d) (RG3.7/RG3.8).
- RG3.3/3.4/3.5 (chips/combinar, narrow) → T-RG.30 tramo (a)/(b) (intacto).

## Autorrevisión adversarial (revisor hostil)

- **¿Rompe angostar-filtro?** NO. Narrowing: `loadFirstPage` (loadingRef=true) → `refreshWindow` bail → loadFirstPage
  aplica la página angosta. T-RG.30 (a)/(b) siguen verdes (6/6). El simétrico total (angosto→ancho→todo) lo cubre (d).
- **¿Rompe loadMore-durante-refresh?** NO. Dirección "loadMore durante refresh": `canLoadMore` ya bloquea loadMore
  mientras `loadingRef` (refresh) está true → sin cambio. Dirección "refresh durante loadMore" (Caso 5): antes el
  refresh ganaba y DESCARTABA el loadMore vía seq; ahora el refresh CEDE (loadingMoreRef) → **preserva** el loadMore
  del usuario (mejor en manga). T-RG.28 (scroll infinito) sigue verde.
- **¿Rompe la carga inicial?** NO. Los efectos de foco/sync esperan `hasLoadedOnceRef`; y aunque dispararan, bailan
  (loadingRef=true durante la 1ª carga). T-RG.28/29/31/32/33 cargan inicial y pasan.
- **¿Otro flujo con `listSeq` roto?** `loadMore` captura seq (no bumpea) → con el fix el refresh bumpea seq MENOS
  veces → loadMore es MENOS invalidado espuriamente (estrictamente más seguro). `loadFirstPage` nunca baila (sigue
  ganando). El guard de cambio-de-chip (efecto l.301) intacto.
- **¿Staleness permanente por bailar?** NO. El bail es transitorio (ms, mientras un fetch de foreground está en
  vuelo); el foreground lee del MISMO SQLite local ya sincronizado → aplica data fresca. El próximo foco/sync corre
  el refresh normal. `loadMeta` (count/actions/opciones) sigue corriendo SIEMPRE (fuera del guard).
- **¿Confié solo en el orden de efectos?** El mecanismo primario (bail on `loadingRef`) descansa en que
  `loadFirstPage` setea `loadingRef=true` SÍNCRONO (l.179, antes del await) y su efecto (l.301) corre ANTES que los
  de foco (l.317)/sync (l.332) en el mismo commit → el E2E (grafo de efectos + timing REAL) confirma que anda y que
  el bug reproduce sin el guard. Para el caso async genuino (sync avanza durante un loadFirstPage en vuelo)
  `loadingRef` está true toda la ventana del await → también baila.
- **¿El test pasa por la razón equivocada?** Descartado (ver "Prueba de que el E2E ejercita el race").

## Reconciliación de specs

- `design-rodeo-grande.md`: §8 (FINDING → **RESUELTO**, con el as-built del guard + por qué (a) sobre las
  alternativas) + §6.2 punto (4) (`refreshWindow` cede ante foreground). `requirements-rodeo-grande.md`: SIN cambios
  de EARS (el *qué* no cambió — el fix es de la capa de hooks, invariante RG6.1/RG3.7 ya especificada).
- `tasks-rodeo-grande.md`: T-RG.30 (as-built ya-no-narrow-only) + entrada de changelog del fix + "candidato a
  backlog" → RESUELTO + coverage RG3.7/RG3.8.

## Verificación

- `cd app && pnpm typecheck` → **verde** (sin output).
- Unit network-free (`local-reads.test.ts` + `group-page-cursor.test.ts` + `group-view-model.test.ts`) → **184/184**
  (los 3 del guard incluidos).
- `pnpm exec playwright test e2e/rodeo-grande.spec.ts` (targeted, contra dist rebuildeado + Supabase remoto +
  PowerSync) → **6/6 verde** (T-RG.30 6.8s). El `UV_HANDLE_CLOSING` post-"6 passed" = crash de teardown de Node en
  Windows DESPUÉS del éxito (gotcha conocido) → veredicto ok. `design/*.png` revertido.
- **NO** corrí `check.mjs` completo: pega a la DB compartida (rate-limit con 2 terminales activas — la otra corre
  feature 19/teléfono) y la verificación de ESTE fix es tsc + unit puros + el E2E targeted (mismo criterio
  network-free que Fases 3-4/5). El fix es un guard puro en el hook + util pura; sin backend, sin migraciones.
