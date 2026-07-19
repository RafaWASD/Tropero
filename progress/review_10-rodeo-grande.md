# Review — spec 10 DELTA «rodeo grande» (Fases 1-4, dos runs de implementer)

**Reviewer**: reviewer agent. **Fecha**: 2026-07-18.
**Alcance**: Fases 1-4 (T-RG.1..27). Fase 5 (E2E, T-RG.28..33) = otro run / Gate 2.5 (ADR-029) — fuera de este review por instrucción del leader.
**Baseline del diff**: `6570029c50fa3e13aff3850f5902f2c97e0a58f8`.
**Verificación network-free**: `pnpm typecheck` VERDE; `local-reads.test.ts` + `group-page-cursor.test.ts` + `group-view-model.test.ts` = **181/181**. NO se corrió check.mjs ni E2E (rate-limit DB compartida; E2E = Gate 2.5).

## Veredicto: APPROVED

Fases 1-4 completas y correctas. Cada RG está cableado end-to-end (builder → service → hook → UI), no solo el builder. Keyset con desempate total y threading real probado. Multi-tenant preservado en toda query nueva. No-regresión de la tab Animales garantizada (drift-guard + args idénticos sin groupScope). Fix de las masivas (rodeo set completo) y del bug del lote (scope por management_group_id) verificados con tests que threadean >200 filas. Anti-IDOR de la baja en tanda intacto.

## Trazabilidad RG ↔ test

| RG | Test / evidencia |
|---|---|
| RG1.1 | `T-RG.2 keyset` (scoped, real rows) + `fetchGroupAnimalsPage` + rutas via `useGroupView` |
| RG1.2 | `T-RG.2` (pageSize) + `GROUP_PAGE_SIZE=60` |
| RG1.3 | `group-view-model.test` canLoadMore + hook `loadMore` + FlatList `onEndReached` |
| RG1.4 | `T-RG.2` threading pageSize=2 sobre 6 filas, empate created_at → desempate id DESC, sin dup/salto |
| RG1.5 | `group-page-cursor.test` deriveNextCursor (incompleta/vacía) + `canLoadMore reachedEnd` |
| RG1.6 | `canLoadMore loadingMore` + `loadingRef` guard |
| RG1.7 | `T-RG.2 pin EN TRATAMIENTO` + `T-RG.1 drift-guard in_treatment` |
| RG1.8 | `T-RG.2 filtros de dominio` (sold/deleted/exit/otro-tenant excluidos) |
| RG2.1/2.2 | `fetchGroupMemberCount` reusa head-count builders (tests buildRodeoHeadCounts/buildGroupHeadCounts overlay-aware) → `GroupMetaHeader` |
| RG2.3/2.4 | `GroupMetaHeader` "…"/`toLocaleString('es-AR')` (código; E2E Fase 5) |
| RG3.1/3.2 | `T-RG.9 groupScope` (matchea SOLO el grupo) + `searchGroupAnimals` |
| RG3.3/3.10 | `GroupSearchBar` chips/popover onPress+a11y en pieza Tamagui, SIN Pressable (inspección; E2E web-touch Fase 5) |
| RG3.4/3.6 | `intersectSearchWithChips` (categoría/sexo/combinado) |
| RG3.5 | `T-RG.2 filtros de chips` (categoryCode/sex en SQL, keyset sobre subconjunto) |
| RG3.7/3.8 | `isSearchActive` + deps de efecto del hook (código; E2E Fase 5) |
| RG3.9 | `T-RG.7 categorías` + `buildGroupSexOptionsQuery` test + `sexFilterAvailable` test |
| RG4.1-4.7 | `GroupViewScreen` FlatList (keyExtractor profileId, header/footer/empty, threshold 0.5); código, E2E Fase 5 |
| RG5.1/5.3 | `bulk-selection-data` rodeo→`fetchAllGroupMembers`; `T-RG.4` set completo |
| RG5.2 | `T-RG.6` (castrar exacto + destetar aprox + lote cross-rodeo) + `T-RG.17` gating COUNT→applyCandidateGating |
| RG5.4 | `T-RG.15` (>200 en el campo NO trunca) + `fetchGroupMembers`→`buildAllGroupMembersQuery` |
| RG5.5 | modelo N-mutaciones sin cambio (bulk-candidates/bulk-selection intactos) |
| RG5.6 | `lote/[id]` modo selección: `fetchAllGroupMembers` + FlatList; `goToVenta` mode+csv-mínimo; `venta.tsx` anti-IDOR (código; E2E Fase 5) |
| RG6.1/6.2 | `refreshWindow`/`fetchGroupWindow` silent, keys estables, fallo conserva lista (código; E2E Fase 5) |
| RG6.3 | overlay en `T-RG.2`/`T-RG.4` (pending intercalado por created_at) |
| RG6.4 | `runLocalQuery` en todas las lecturas nuevas |
| RG6.5 | `T-RG.2` assert `ap.establishment_id = ?` + todas las queries scopean por param |
| RG7.1 | `T-RG.1 drift-guard` + `T-RG.9 sin groupScope` args idénticos; `buildAnimalsListQuery`/`fetchAnimals`/`searchAnimals` intactos |
| RG7.2/7.3 | copy voseo + lineHeight matching (código) |
| RG7.4 | sin sorting configurable ni otras listas (invariante) |

## Tasks completas: sí (Fases 1-4)

T-RG.1..27 → `[x]`, verificadas contra el código real. T-RG.28..33 (Fase 5 E2E) → `[ ]` **con justificación documentada** (changelog tasks + impl files + verificación instructions del leader: E2E es otro run / Gate 2.5). Aceptado para las fases revisadas.

## CHECKPOINTS
- C3 (arquitectura): [x] — capas respetadas; `components/` (GroupViewScreen/Bits/SearchBar) NO importan services (toman `view` por prop); hooks orquestan; builders puros. Sin logs/TODOs. Sin hardcode de establishment_id.
- C4 (verificación real): [x] — tests in-memory con SQLite real (node:sqlite), threading real de filas, no mocks de I/O. 181/181.
- C6 (SDD): [x] — 3 archivos + set hermano; EARS estricto; cada RG con ≥1 test; specs reconciliadas con as-built (design §1/§5.2/§6.2/§6.3/§6.4 + changelog).
- C7 (multi-tenant): [x] — todas las queries conservan `establishment_id = ?` (param); test cross-tenant a nivel builder (`T-RG.2` excluye otro-tenant). Sin tablas/RLS nuevas (delta 100% cliente).
- C8 (offline-first): [x] — todo del SQLite local + overlay `pending_*`; sin bucket nuevo (reusa est_animal_profiles); LWW baseline.
- C9 (E2E + visual): [ ] — **pendiente, Fase 5 / Gate 2.5** (documentado). No bloquea las Fases 1-4.
- C1/C2/C5: N/A a este review (cierre de sesión lo maneja el leader).

## Checklist RAFAQ-específico
- **A (RLS/multi-tenancy)**: N/A estricto (sin tablas/RLS nuevas). Lo aplicable: [x] queries scopeadas por establishment_id + dominio; [x] `deleted_at IS NULL` + `status='active'` + HIDE_EXITED en todas; [x] scope de grupo ADITIVO (no reemplaza el tenant); [x] aislamiento cross-tenant a nivel builder testeado.
- **B (offline-first)**: [x] funciona offline (runLocalQuery); [x] sync bucket correcto (sin cambio); [x] LWW documentado; [x] la pantalla no pega síncrono a Supabase (services → SQLite).
- **C (BLE)**: N/A.
- **D (UI de campo)**: [x] tap nativo correcto (RG3.10, crítico manga); [x] estados de loading visibles (InfoNote/footer/"…"); tamaños de botón/fuente ≥ tokens — sujeto a **veto visual Gate 2.5** (no verificable network-free).
- **E (Edge Functions)**: N/A (sin backend).

## Observaciones (no bloqueantes)
1. **Riesgo (a) flaggeado — refresh de ventana en grupo TOTALMENTE cargado**: si `reachedEnd=true` y el grupo crece por overlay, `fetchGroupWindow(LIMIT=loadedCount)` puede empujar la última fila fuera y preservar `reachedEnd=true` → esa fila queda inalcanzable hasta re-navegar. **Aceptable**: raro (en "rodeo grande" reachedEnd casi nunca es true), NO silencioso (el header muestra el count real ≠ filas), auto-sana al re-montar, y está documentado en design §6.2. No es data-loss.
2. **Riesgo (b) flaggeado — sin botón "limpiar todo" dedicado**: RG3.8 se cumple funcionalmente (popover "Todas las categorías"/"Ambos sexos" + borrar texto). Falta un one-tap clear. **Polish de Gate 2.5**, no violación de requisito.
3. **Drift stored vs espejo en chips**: modo lista filtra por categoría ALMACENADA (SQL); modo búsqueda por categoría MOSTRADA (espejo, client-side). Documentado (design §4.2 + comentario en group-view-model). Aceptable, transitorio, auto-sana al sync.
4. **Fetch en rutas**: `lote/[id]`/`venta.tsx` llaman services en useEffect (no vía hook dedicado) para el set de baja en tanda / nombre de lote. Es el patrón as-built del baseline (no regresión); `components/` sigue limpio (sin imports de services). No bloqueante.

## Cambios requeridos: ninguno para Fases 1-4.
Pendiente para cerrar la feature completa: Fase 5 (E2E T-RG.28..33) + Gate 2.5 (capturas + veto visual, ADR-029) — coordina el leader.
