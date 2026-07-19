baseline_commit: 6570029c50fa3e13aff3850f5902f2c97e0a58f8

# Impl — spec 10 DELTA «rodeo grande» — Fases 1 + 2 (builders + services)

**Feature**: delta-spec `rodeo-grande` sobre feature 10 (`done`). Corre su propio ciclo SDD.
**Alcance de ESTE run**: Fase 1 (T-RG.1..9) + Fase 2 (T-RG.10..18). NO se toca UI/hooks/E2E (Fases 3-5, otro run).
**Baseline (Gate 2)**: `6570029c50fa3e13aff3850f5902f2c97e0a58f8` (SHA previo a la 1ª task de la feature; trabajamos sobre `main`).

> Nota de pre-condición: la feature 10 base está `done`; este delta (status `spec_ready` en su set `-rodeo-grande`) corre su propio ciclo — el leader coordina el flip/estado y me lanzó explícitamente a implementar Fases 1+2 (autonomous pipeline). Los 4 archivos del spec existen.

## Estado: DONE (Fases 1+2) — esperando reviewer

Todas las tasks T-RG.1..18 `[x]`. `tsc` verde + `local-reads.test.ts`/`group-page-cursor.test.ts` **170/170** + utils de gating **50/50**. Fases 3-5 (hooks/UI/E2E) = otro run.

## Archivos tocados / creados

**Creados:**
- `app/src/services/group-page.ts` — `GROUP_PAGE_SIZE=60`, `fetchGroupAnimalsPage`, `searchGroupAnimals`, `fetchGroupMemberCount`, `fetchGroupCategoryOptions` (T-RG.10/11/12).
- `app/src/utils/group-page-cursor.ts` — util PURO `deriveNextCursor` (RG1.5) + tipo `CursorRow`.
- `app/src/utils/group-page-cursor.test.ts` — tests del cursor (T-RG.13 pura).

**Modificados:**
- `app/src/services/powersync/local-reads.ts` — builders nuevos: `buildGroupAnimalsPageQuery` (T-RG.1), `buildAllGroupMembersQuery` (T-RG.3), `buildGroupCandidateCountsQuery` (T-RG.5), `buildGroupCategoryOptionsQuery` (T-RG.7), `buildGroupRodeoIdsQuery` (soporte gating lote), helpers privados `buildGroupScopedUnion`/`buildWeanCountExpr`; tipos `GroupScope`/`GroupPageCursor`; `buildSearchUnion` + los 4 builders de búsqueda con `groupScope?` (T-RG.8). **`buildAnimalsListQuery` NO tocado.**
- `app/src/services/powersync/local-reads.test.ts` — tests T-RG.2/4/6/7/9/15/17 + drift-guard + rodeo-ids (in-memory).
- `app/src/services/animals.ts` — export ADITIVO `enrichLocalRows` + tipo `LocalListRow`. **`fetchAnimals`/`searchAnimals`/`buildAnimalsListQuery` NO tocados.**
- `app/src/services/management-groups.ts` — `fetchGroupMembers` → `buildAllGroupMembersQuery` (fix bug RG5.4) + `fetchAllGroupMembers` (T-RG.14).
- `app/src/services/group-data.ts` — gating por `buildGroupCandidateCountsQuery` (grupo entero); `fetchRodeoGroupActions(est, rodeoId)` / `fetchLoteGroupActions(est, groupId)`; se eliminó `fetchGroupProfilesForCounts`/`countCandidates` (T-RG.16).
- `app/src/services/bulk-selection-data.ts` — rodeo usa `fetchAllGroupMembers` (set completo, no LIMIT 200); lote hereda `fetchGroupMembers` corregido (T-RG.18).
- `app/app/rodeo/[id].tsx`, `app/app/lote/[id].tsx` — ajuste MÍNIMO de la llamada de gating (no rompe tsc; NO se tocó FlatList/loader de la lista = Fase 4).
- `scripts/run-tests.mjs` — registra `group-page-cursor.test.ts`.

## Trazabilidad R<n> → test

- RG1.1/1.2/1.4/1.7/1.8 (page scopeada + keyset + orden total + filtros dominio) → `local-reads.test.ts` `T-RG.2: … keyset pagina sin saltos ni duplicados` / `… 1ª página sin keyset` / `… pin EN TRATAMIENTO` / `… filtros de dominio`.
- RG1.5 (reachedEnd) → `group-page-cursor.test.ts` `deriveNextCursor: página INCOMPLETA/VACÍA`.
- RG3.5 (chips categoría/sexo, combinables, paginado) → `T-RG.2: … scope de LOTE + filtros de chips`.
- RG5.3/5.4 (set completo + fix lote) → `T-RG.4: … TODOS los miembros`, `T-RG.15: … >200 en el campo no trunca`.
- RG5.2 (gating COUNT grupo entero + lote cross-rodeo) → `T-RG.6: … castrar exacto + destetar aprox`, `T-RG.6: … lote cross-rodeo`, `T-RG.17: gating ofrece/oculta`.
- RG3.9 (opciones de categoría) → `T-RG.7: … DISTINCT categorías del grupo`.
- RG3.1/3.2 (búsqueda scopeada) + RG7.1 (no-regresión tab) → `T-RG.9: … matchea SOLO el grupo` / `… sin groupScope SQL+args as-built`.
- RG1.7 drift-guard (no se toca la tab) → `T-RG.1: in_treatment idéntico a buildAnimalsListQuery`.
- RG6.5 (multi-tenant establishment_id) → asserts `ap.establishment_id = ?` en `T-RG.2: … filtros de dominio`.

## Autorrevisión adversarial

Busqué (revisor hostil) y encontré/cerré:
- **Assert de test frágil** (T-RG.4 `doesNotMatch(/LIMIT/)`): matcheaba el `LIMIT 1` de la subconsulta correlada del apodo → afinado a "termina en ORDER BY" (el corte real lo prueba T-RG.15 con 210 filas de campo). CERRADO.
- **Assert incorrecto del cursor `pageSize=1`** en `group-page-cursor.test.ts` (afirmaba `nextCursor===null` cuando `rows.length===pageSize` NO es fin) → línea removida. CERRADO.
- **Firma sin `establishment_id`** en `buildGroupCandidateCountsQuery` (el design lo omitía): la regla dura multi-tenant exige `establishment_id = ?` → lo agregué + reconcilié design §5.2. CERRADO.
- **Rodeos del lote sin cargar miembros**: `fetchLoteGroupActions` necesitaba los rodeos representados sin la lista (paginada). Agregué `buildGroupRodeoIdsQuery` (DISTINCT barato, no paga el espejo O(N), §2 corolario) en vez de `fetchAllGroupMembers`. CERRADO.
- **tsc rojo en Fase 4** por el cambio de firmas de gating: 2 call sites (`rodeo/[id].tsx`/`lote/[id].tsx`) ajustados MÍNIMAMENTE (solo la llamada al service). Verificado que NO toqué la lista/FlatList/loader (sigue Fase 4).
- **Precedencia AND/OR del keyset**: cada disyunto parentizado → verificado por el threading real (T-RG.2 recorre 6 filas exactas, sin dup/salto).
- **Orden de args** en los UNION scopeados (synced ++ overlay ++ keyset ++ LIMIT): verificado ejecutando el SQL real contra node:sqlite (los tests fallarían si desalinearan columnas/args).
- **Divergencia castrate SQL vs `buildBulkCandidates`**: el count es `male AND is_castrated=0` (design "exacto"); `buildBulkCandidates` suma `category ∈ {ternero,torito,toro}`, redundante para un macho entero → sin divergencia real; over-offer transitorio (si lo hubiera) es seguro (la selección real decide con el set completo). Consistente con la dirección de seguridad del design §5.2.
- **Código muerto**: `buildBulkCandidates` sigue vivo (pantallas de masiva con el set completo); `fetchGroupProfilesForCounts`/`countCandidates` removidos sin refs colgantes (tsc verde). Sin imports rotos.
- **Overlay + offline**: todas las queries nuevas UNIONan `pending_*` (verificado con `insPendingAnimal`), leen del SQLite local (runLocalQuery). RG6.3/6.4 OK.
- **RG7.1 (no tocar la tab)**: verificado — `buildAnimalsListQuery`/`fetchAnimals`/`searchAnimals` sin cambios; drift-guard de `in_treatment`; `buildSearchUnion` sin `groupScope` = SQL+args idénticos (test T-RG.9).

## Reconciliación de specs

- `design-rodeo-grande.md`: §5.2 nota de reconciliación (firma con `establishmentId` + `buildGroupRodeoIdsQuery` + firmas de gating + call sites mínimos); §1 tabla actualizada (builders as-built, `animals.ts` aditivo, `group-page-cursor.ts`).
- `tasks-rodeo-grande.md`: T-RG.1..18 `[x]` + changelog con el approach de tests de servicio (in-memory builders + composición, ya que los services importan el SDK y no corren en node:test — patrón as-built de `sigsa-export-service.test.ts`) y las reconciliaciones.
- `requirements-rodeo-grande.md`: sin cambios de EARS necesarios (el *qué* no cambió; solo detalles de firma/builder que viven en design).

## Verificación (network-free)

- `cd app && pnpm typecheck` (tsc --noEmit) → **verde** (sin output).
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test app/src/services/powersync/local-reads.test.ts app/src/utils/group-page-cursor.test.ts` → **tests 170 / pass 170 / fail 0**.
- `node … --test app/src/utils/group-actions.test.ts app/src/utils/bulk-candidates.test.ts app/src/utils/bulk-selection.test.ts` → **50/50** (cero regresión).
- **NO** se corrió `check.mjs` ni E2E (pegan a la DB compartida → rate-limit; la UI no está hecha aún). Confirmado.
