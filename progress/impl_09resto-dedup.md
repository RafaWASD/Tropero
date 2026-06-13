baseline_commit: f743a97cc3959c755d32bc2b991d24c662ec886d

# impl — spec 09 chunk "09 resto · dedup A/B" — Run 1 (backend)

**Feature**: 09-buscar-animal · chunk dedup A/B (asignación de caravana).
**Run**: Run 1 — Fases 1, 2, 3 (RPC `assign_tag_to_animal` + suite backend + service offline cliente). Fases 4-6 (UI/E2E) son runs posteriores, NO tocadas.
**Spec**: APROBADA (Puerta de spec + Gate 1 PASS, `progress/security_spec_09resto-dedup.md`). Deploy **PRE-AUTORIZADO** por Raf, pero la migración la aplica el LEADER (gated).
**Fecha**: 2026-06-13.

## ⚠ MIGRACIÓN A APLICAR (leader, vía MCP/Management API)

**`supabase/migrations/0089_assign_tag_to_animal_rpc.sql`** — número libre ≥0089 confirmado (último as-built en disco: 0088). Hasta que el leader la aplique, la suite backend `assign_tag_to_animal` FALLA con PGRST202 (función inexistente) — ESPERADO (patrón 0075-0088). Todo el resto queda verde.

## Plan (tasks de este run)

- T1 = F1.1 — migración 0089: RPC `assign_tag_to_animal` SECURITY DEFINER, orden (a)→(f). ✅
- T2 = F1.2 — cierre de superficie (revoke/grant tipado + smoke-check fail-closed + notify). ✅
- T3 = F2.1 — suite backend node:test (6 escenarios + 3 extra) en `supabase/tests/animal/run.cjs`. ✅ (verde post-deploy)
- T4 = F3.1 — `enqueueAssignTag` en `outbox.ts` (sin overlay). ✅
- T5 = F3.2 — `assign_tag_to_animal` en `RPC_OP_TYPES` + rama `p_client_op_id` en `mapIntentToRpc` (`upload.ts`). ✅
- T6 = F3.3 — units del mapeo + clasificación en `upload.test.ts`. ✅
- T7 = F3.4 — service `assignTagToAnimal` en `animals.ts`. ✅

## Archivos escritos / modificados

| Archivo | Acción |
|---|---|
| `supabase/migrations/0089_assign_tag_to_animal_rpc.sql` | **+** RPC + cierre de superficie (NO aplicado al remoto) |
| `supabase/tests/animal/run.cjs` | **mod** suite `assign_tag_to_animal` (9 tests) antes del `cleanup` final |
| `app/src/services/powersync/outbox.ts` | **+** `enqueueAssignTag` + `EnqueueAssignTagInput` |
| `app/src/services/powersync/upload.ts` | **mod** `assign_tag_to_animal` en `RPC_OP_TYPES` + rama `p_client_op_id` |
| `app/src/services/powersync/upload.test.ts` | **+** 2 tests (mapeo + clasificación de assign_tag) |
| `app/src/services/animals.ts` | **+** service `assignTagToAnimal(profileId, tag)` + import `OutboxResult` |
| `specs/active/09-buscar-animal/tasks-09resto-dedup.md` | **mod** F1.1/F1.2/F2.1/F3.1-F3.4 marcadas `[x]` con notas AS-BUILT |

## Contrato del RPC (as-built = design §1.2, TAL CUAL)

Firma: `assign_tag_to_animal(p_profile_id uuid, p_tag_electronic text, p_client_op_id uuid) returns jsonb`, SECURITY DEFINER, `set search_path = public`. Orden NO conmutable:
- (a) DERIVAR `v_est, v_animal_id` de `animal_profiles WHERE id=p_profile_id AND status='active' AND deleted_at IS NULL` → NULL → `23503`.
- (b) `if not has_role_in(v_est) → 42501` (tenant DERIVADO, cualquier rol activo).
- (c) `if p_tag_electronic is null or !~ '^\d{15}$' → 23514`.
- (d) idempotencia STATE-BASED: `if exists(animals WHERE id=v_animal_id AND tag_electronic=p_tag_electronic) → return {…, replay:true}`.
- (e) `UPDATE animals SET tag_electronic=p_tag_electronic WHERE id=v_animal_id AND tag_electronic IS NULL`.
- (f) `if not found → 23514` ("animal already has a tag (race)").
- Dup global: el UPDATE choca `animals_tag_unique` (0019) → `23505` PROPAGADO (NO capturado).
- `p_client_op_id` = PASSTHROUGH (NO referenciado en ninguna query; NO se cuelga de columna/índice — RD1.6).

## Trazabilidad R<n> → test

| RD | Test que lo cubre (archivo:test) |
|---|---|
| RD1.1 (RPC existe/asigna) | `supabase/tests/animal/run.cjs::escenario 1 (NULL→valor OK)` |
| RD1.2 (anti-IDOR + 23503) | `run.cjs::escenario 3 (anti-IDOR → 42501, no toca ajeno)` + `run.cjs::perfil inexistente → 23503` |
| RD1.3 (authz 42501) | `run.cjs::escenario 3` + `run.cjs::escenario 4 (sin rol activo → 42501)` |
| RD1.4 (formato 23514) | `run.cjs::formato: no-15-díg → 23514` |
| RD1.5 (guard IS NULL / race 23514) | `run.cjs::escenario 2 (valor→valor rebota 23514)` |
| RD1.6 (idempotencia state-based) | `run.cjs::escenario 5 (replay:true, mismo y distinto client_op_id)` |
| RD1.7 (unicidad global 23505) | `run.cjs::escenario 6 (dup global → 23505)` |
| RD1.8 (cierre de superficie) | `run.cjs::grants: NO invocable por anon (fail-closed)` + smoke-check en la migración |
| RD1.9 (propagación 0079 al perfil) | `run.cjs::escenario 1 (animal_tag_electronic propagado al perfil)` |
| RD2.1 (service offline) | `app/src/services/animals.ts::assignTagToAnimal` (typecheck; SDK-bound, sin unit propio como exitAnimalProfile) |
| RD2.2 (enqueueAssignTag sin overlay) | `app/src/services/powersync/outbox.ts::enqueueAssignTag` (typecheck; SDK-bound) |
| RD2.3 (RPC_OP_TYPES + p_client_op_id) | `upload.test.ts::mapIntentToRpc: assign_tag_to_animal → p_client_op_id inyectado` |
| RD2.4 (clasificación errores) | `upload.test.ts::assign_tag_to_animal: 23505/23514/42501/23503 → permanent_reject; red → transient` |
| RD2.5 (offline-first, replay=2xx) | verificado en `connector.ts::uploadData` (§9.3): replay devuelve `data` sin `error` → ACK (clearOverlay), no clasificador |

> Nota: `enqueueAssignTag`/`assignTagToAnimal` son SDK-bound (`outbox.ts` importa `react-native` vía `./database`) → fuera del grafo node:test, igual que `enqueueExitAnimal`/`exitAnimalProfile` (as-built sin unit propio). Su shape se verifica por typecheck + el unit del mapeo (la fuente de verdad de cómo el intent se traduce a la RPC) + la suite backend (el contrato real del RPC).

## Autorrevisión adversarial (paso 8) — sobre el RPC + el camino de sync

Revisión hostil, control por control:

1. **Anti-IDOR — busqué: ¿el UPDATE usa un id del payload?** → NO. `v_animal_id` se deriva SOLO de la fila real de `animal_profiles WHERE id=p_profile_id`; el UPDATE (e) usa `WHERE id=v_animal_id` (derivado). No existe param `animal_id`. Cross-tenant: un `p_profile_id` ajeno se encuentra pero rebota 42501 en (b) → el animal ajeno no se toca (escenario 3 lo verifica leyendo `animals.tag_electronic` del ajeno = NULL tras el reject). **CERRADO**.

2. **Authz — ¿`has_role_in` sobre el tenant del payload o el derivado? ¿corre ANTES de la dedup?** → sobre `v_est` (DERIVADO), en (b), ANTES de la dedup (d) y del UPDATE (e). Un caller de otro campo nunca llega a (d) → la dedup NO es oráculo cross-tenant (Gate 1 punto 4). **CERRADO**.

3. **Idempotencia — ¿se cuelga de una columna/índice nuevo? ¿se confunde replay con dup global?** → state-based puro: `exists(animals WHERE id=v_animal_id AND tag_electronic=p_tag_electronic)`. `p_client_op_id` NO se referencia en ninguna query (lo prohíbe RD1.6). El replay legítimo (propio animal, mismo TAG) → `replay:true`; el dup de OTRO animal → 23505 del índice en (e). Escenario 5 verifica AMBOS sub-casos (DA-1 condición de Gate 1): replay con mismo y con DISTINTO client_op_id → ambos `replay:true` (la dedup es por estado, no por client_op_id). Escenario 6 verifica que el dup global NO se confunde con replay. **CERRADO**.

4. **Guard NULL→valor + race — ¿el `if not found` refleja el UPDATE correcto?** → busqué si algún statement entre (d) y (e) resetea `FOUND`. El `IF EXISTS(subquery)` de (d) NO setea `FOUND` (no es SELECT INTO ni PERFORM); el `SELECT INTO` de (a) lo dejó en true, y el UPDATE de (e) lo resetea según su row count. Entonces `if not found` en (f) refleja exactamente el UPDATE (0 filas = el animal ya tenía caravana = race → 23514). Verificado contra el idiom as-built de 0082. Escenario 2 lo ejercita (valor→valor → 23514, caravana original NO pisada). **CERRADO**.

5. **Formato — ¿NULL pasa el regex?** → no: `p_tag_electronic is null or !~ '^\d{15}$'`. El `or` corta antes del regex si es NULL. Escenario formato cubre `'123'`, 14 díg, 16 díg, alfabético, 15 chars con una letra → todos 23514. **CERRADO**.

6. **Cierre de superficie — ¿revoke/grant/smoke-check/notify/search_path?** → revoke from public/anon + grant to authenticated con firma tipada `(uuid,text,uuid)` + `do $$` que itera anon/public y `raise` si tienen EXECUTE + `notify pgrst` + `set search_path = public` en la definición. Función NUEVA → sin firma vieja que dropear ni grant colgando (Gate 1 punto 6). Test de grants anon (fail-closed) lo ejercita end-to-end. **CERRADO**.

7. **23505 — ¿se captura por error?** → NO hay `exception when unique_violation`; el 23505 del índice global propaga crudo → `permanent_reject` en sync (correcto, RD1.7). **CERRADO**.

8. **Camino de sync — ¿el replay 2xx se trata como error?** → verificado en `connector.ts::uploadData` (líneas 129-135): `supabase.rpc(...)` con `{replay:true}` devuelve `data` sin `error` → no `throw` → `clearOverlay` (ACK). `classifyIntentUploadError` solo se alcanza en el `catch`. Sin case nuevo en el clasificador (design §2.3). **CERRADO**.

9. **Multi-tenant / sin hardcode** → el RPC no hardcodea `establishment_id` (lo deriva); el service `assignTagToAnimal` solo recibe `profileId`+`tag`, el tenant se deriva server-side. Lint anti-hardcode: 0 violaciones (no toqué UI). **CERRADO**.

10. **Test que pasa por la razón equivocada** → guard `assertRpcExists` (PGRST202 → `assert.fail`) en CADA escenario que assertea un código de error: sin él, un PGRST202 que contenga "42501"/"23514" haría pasar el assert por la razón equivocada. **CERRADO**.

**Hueco no cubierto por Gate 0/Gate 1 encontrado**: NINGUNO. El mecanismo de idempotencia (DA-1 state-based), la authz (DA-2 cualquier rol activo) y la NO-tabla-de-audit están ratificados por Gate 1; los implementé tal cual. No improvisé ni desvié.

## Reconciliación specs ↔ as-built

El as-built coincide EXACTAMENTE con `design-09resto-dedup.md` §1.2/§1.3 (contrato del RPC), §2.1-§2.4 (cliente) y §8.1 (los 6 escenarios). No hubo desviación de comportamiento, contrato ni estructura → no hace falta reconciliar `requirements`/`design` (quedan fieles). `tasks-09resto-dedup.md` marcado con las tasks reales `[x]` + notas AS-BUILT. F1.3 (deploy) queda GATED para el leader; F2.1 queda "verde post-deploy" (documentado). Fases 4-6 sin tocar (runs posteriores).

## Verificación — `node scripts/check.mjs`

- **typecheck cliente**: ✅ verde (`tsc --noEmit` exit 0).
- **lint anti-hardcode (ADR-023)**: ✅ 0 violaciones.
- **client unit tests**: ✅ verde — `upload.test.ts` 23/23 (incluye los 2 nuevos de assign_tag); suites afectadas (local-reads, transfer-animal, exit-animal, tag-lookup) 174/174.
- **suites backend existentes**: ✅ CERO regresión — Animal (spec 02/11/13/15) 100/109 pasan; sync_streams 25/25; operaciones_rodeo 22/22. RLS/Edge/Maneuvers/user_private/Import no tocan animals/outbox/upload.
- **suite `assign_tag_to_animal`**: ⏳ 9/9 FALLAN con PGRST202 (RPC 0089 NO deployada) — **ESPERADO** (patrón 0075-0088). Va verde tras el deploy del leader (F1.3). El guard `assertRpcExists` garantiza que no pasan por la razón equivocada.

**Resumen**: todo verde EXCEPTO la suite `assign_tag_to_animal` (pendiente de deploy del leader, PGRST202 esperado). `check.mjs` da exit 1 SOLO por esos 9 fallos esperados — no hay fallo real ni regresión.

## Para el leader

1. Revisar `supabase/migrations/0089_assign_tag_to_animal_rpc.sql` + Gate 2 (security_analyzer modo code, diff desde `baseline_commit`).
2. Aplicar la **migración 0089** al remoto vía MCP/Management API (deploy pre-autorizado por Raf).
3. Re-correr `node scripts/check.mjs` → la suite `assign_tag_to_animal` debe pasar 9/9 (PGRST202 desaparece).
4. Pasar al reviewer. NO marco `done` yo mismo.

---

# impl — spec 09 chunk "09 resto · dedup A/B" — Run 2 (UI opción A)

**Run**: Run 2 — Fase 4 (UI opción A: modo `assign_or_create` del bottom-sheet). Backend (Run 1) + service offline ya DONE y deployado → se CONSUMEN. NO se tocan Fase 5 (masiva opción B) ni Fase 6 (E2E) — runs posteriores.
**Fecha**: 2026-06-13.
**baseline_commit**: el mismo de Run 1 (`f743a97...`) — feature multi-sesión, NO se sobreescribe.

## Plan (tasks de este run)

- T1 = F4.1 — `resolveCreateOrAssign(noTagCandidateCount)` puro en `tag-lookup.ts` + unit en `tag-lookup.test.ts` (0 → create, ≥1 → assign_or_create). Molde `resolveTagLookup`.
- T2 = F4.2 — `local-reads.ts`: variante candidatos `noTag` ordenada por `updated_at DESC` (opción `orderBy` en `buildAnimalsListQuery`) + test del builder (SQL/args + integración SQLite) en `local-reads.test.ts`.
- T3 = F4.3 — `FindOrCreateOverlay.tsx`: rama `create` → computar conteo candidatos `noTag` → `resolveCreateOrAssign` → si `assign_or_create`, render `AssignOrCreateBody`; si 0 candidatos → CREATE directo (RD3.2). Reusa seqRef/establishment-change/close.
- T4 = F4.4 — `AssignOrCreateBody`: encabezado EID + título + buscador (`searchAnimals` scopeado a `noTag`) + lista scrollable de candidatos (idv/visual/category/sex/rodeo) + CTA "Es un animal nuevo → dar de alta". Tocar candidato → confirmar → `assignTagToAnimal(profileId, eid)` → cerrar + `/animal/[id]`.
- T5 = screenshot del overlay en modo `assign_or_create` (≥3 candidatos + buscador) en `design/veto-dedup-opcionA/` para el veto del leader.

## Archivos escritos / modificados (Run 2)

| Archivo | Acción |
|---|---|
| `app/src/services/tag-lookup.ts` | **+** `resolveCreateOrAssign(count)` + `CreateOrAssignResult` |
| `app/src/services/tag-lookup.test.ts` | **+** 4 tests de `resolveCreateOrAssign` (0/1/≥2/negativo) |
| `app/src/services/powersync/local-reads.ts` | **mod** `orderBy` en `buildAnimalsListQuery` + helper `injectProjection` + `buildNoTagCandidatesCountQuery` |
| `app/src/services/powersync/local-reads.test.ts` | **mod** tests builder `updated_at DESC` + count (SQL/args + 2 de comportamiento node:sqlite) |
| `app/src/services/animals.ts` | **mod** `FetchAnimalsFilter`/`fetchAnimals` con `orderBy` |
| `app/tamagui.config.ts` | **mod** token JIT `candidateListMax` (300) |
| `app/app/_components/FindOrCreateOverlay.tsx` | **mod** `onTagRead` (conteo + decisión) + `OverlayBody` (routing) + `AssignOrCreateBody` + helpers `CandidateSearchBar`/`CandidateRow`/`CandidateSummary` |
| `app/e2e/dedup-screenshot.spec.ts` | **+** captura del modo `assign_or_create` para el veto del leader |
| `design/veto-dedup-opcionA/assign-or-create.png` | **+** screenshot 412×915 (3+ candidatos + buscador + CTA "es nuevo") |
| `specs/active/09-buscar-animal/tasks-09resto-dedup.md` | **mod** F4.1-F4.4 marcadas `[x]` con notas AS-BUILT |
| `specs/active/09-buscar-animal/design-09resto-dedup.md` | **mod** §3.6 AS-BUILT + tabla §6 reconciliadas al as-built |

## Trazabilidad R<n> → test (Run 2)

| RD | Test que lo cubre (archivo:test) |
|---|---|
| RD8.1 (decisión pura intermedia vs create) | `tag-lookup.test.ts::resolveCreateOrAssign 0/1/≥2/negativo` |
| RD8.2 (decisión sobre datos locales, sin red) | `local-reads.test.ts::buildNoTagCandidatesCountQuery (SQL no usa has_role_in; arg = establishment) + comportamiento` |
| RD3.1 (≥1 candidato → assign_or_create) | `tag-lookup.test.ts::resolveCreateOrAssign(1/7)` + host: `onTagRead` rama create computa count → `resolveCreateOrAssign` |
| RD3.2 (0 candidatos → CREATE directo) | `tag-lookup.test.ts::resolveCreateOrAssign(0)` + host: count 0 → `CreateBody` |
| RD3.3 (lista noTag updated_at DESC, idv/visual/category/sex/rodeo) | `local-reads.test.ts::buildAnimalsListQuery orderBy updated_at (SQL/args + comportamiento orden synced+overlay)` + `CandidateRow` (UI) |
| RD3.4 (buscador noTag) | `searchAnimals` + filtro client-side `tagElectronic == null` en `AssignOrCreateBody` (cubierto E2E/screenshot; el buscador en sí es as-built de spec 02) |
| RD3.5 (info mínima del candidato) | `CandidateRow` (idv/visual + CategoryBadge + sexo + rodeo) — verificado en el screenshot del veto |
| RD3.6 (asignar → ficha) | `AssignOrCreateBody::onAssign` → `assignTagToAnimal` (Run 1, suite backend) → `router.push('/animal/[id]')` |
| RD3.7 ("es nuevo" → CREATE) | `AssignOrCreateBody::onCreateNew` → `/crear-animal?tag=<eid>` |
| RD3.8 (intermedia SOLO BLE) | host: `onTagRead` solo computa intermedia en rama `create` del lookup BLE; la tab Animales (manual) usa `searchAnimals`+`/crear-animal` directo, NO `lookupByTag` (no tocado) |
| RD4.2 (live-rescan re-computa) | host: `seqRef`/`ticket` re-chequeado tras lookup+count; `AssignOrCreateBody key={eid}` remonta con EID nuevo |
| RD4.3 (cambio de campo cierra) | host: `useEffect` sobre `establishmentId` → `close()` (reusado del chunk BLE global, sin tocar) |
| RD4.5 (un bastoneo = una decisión) | `onAssign` cierra + navega; sin cola persistente (eso es opción B) |

> Nota: el `AssignOrCreateBody` es un componente de UI (RN/Tamagio) → fuera del grafo node:test (igual que `FindOrCreateOverlay`/`CreateBody`/`TransferBody`, sin unit propio). Su comportamiento se cubre con: la decisión pura unit-testeada (`resolveCreateOrAssign`), los builders unit-testeados (`buildNoTagCandidatesCountQuery`/`orderBy updated_at`, incl. comportamiento contra node:sqlite), `assignTagToAnimal`/RPC de Run 1 (suite backend verde), y el screenshot del veto. La E2E formal de la intermedia es Fase 6 (run posterior) — el `dedup-screenshot.spec.ts` ya ejercita end-to-end el camino (bastoneo mock → intermedia → buscador + lista + CTA visibles) como sub-producto de la captura.

## Autorrevisión adversarial (paso 8) — Run 2 (host BLE + AssignOrCreateBody)

Revisión hostil, punto por punto del checklist:

1. **¿La intermedia es SOLO BLE (RD3.8)?** → SÍ. `onTagRead` (host BLE) es el ÚNICO disparador del modo `assign_or_create`, y solo en la rama `mode:'create'` del lookup por TAG. La puerta MANUAL (tab Animales: tipear idv/visual) usa `searchAnimals` + `/crear-animal` directo (`animales.tsx`) — NO pasa por `lookupByTag` ni por el overlay → sigue yendo directo a CREATE. Verificado leyendo `animales.tsx` (no lo toqué). **CERRADO**.

2. **¿0 candidatos → CREATE directo (RD3.2)?** → SÍ. `resolveCreateOrAssign(0) → { mode:'create' }` → `OverlayBody` renderiza `CreateBody`. Fail-safe extra: si la lectura del conteo FALLA, `count = 0` → CREATE directo (nunca bloqueamos el alta por no poder contar). Unit lo cubre (0 + negativo → create). **CERRADO**.

3. **¿El assign navega a la ficha (RD3.6)?** → SÍ. `onAssign` → al `res.ok` del encolado: `onClose()` + `router.push('/animal/[id]', { id: profileId })`. El UPDATE real lo aplica el RPC al sync; la ficha lee el denorm local (offline-first, design §3.3). **CERRADO**.

4. **¿Live-rescan / cambio-de-campo / cierre reusan la maquinaria sin romperla (RD4.2/4.3/4.4)?** → SÍ + UN BUG ENCONTRADO Y CERRADO. El guard `seqRef`/`ticket` se re-chequea DESPUÉS de AMBOS awaits (lookup y count) → un bastoneo nuevo / cierre / cambio de campo descarta el resultado tardío sin tocar `setState`. El `close()` (incrementa `seqRef`) y el `useEffect` de establishment-change quedaron INTACTOS. **BUG**: `AssignOrCreateBody` NO tenía `key` → un live-rescan con EID distinto preservaría su sub-estado interno (`confirming` = candidato a confirmar) mientras el prop `eid` cambia → se asignaría el EID NUEVO al candidato del flujo VIEJO sin re-confirmar. **CERRADO** agregando `key={eid}` → remonta limpio con cada EID nuevo.

5. **¿Cero hardcode (ADR-023)?** → SÍ. Lint `check-hardcode.mjs`: 0 violaciones. Todo color/spacing/size por token; el tope de alto del scroll es un token JIT nuevo (`candidateListMax`), los íconos lucide vía `getTokenValue`, a11y vía `buttonA11y`/`labelA11y`, safe-area del host reusado. **CERRADO**.

6. **¿El buscador trae animales CON caravana que matchean el término?** → SÍ puede (searchAnimals no scopea noTag), pero el filtro client-side `res.value.filter((a) => a.tagElectronic == null)` los excluye → la lista de la intermedia es SOLO candidatos sin caravana (RD3.3). **CERRADO**.

7. **¿`updated_at DESC` con synced + overlay column-aligned?** → SÍ. La rama synced proyecta `ap.updated_at` REAL; la overlay (sin esa columna) proyecta `pap.created_at AS updated_at` (frescura del alta optimista). El test de COMPORTAMIENTO contra node:sqlite verifica el orden mezclado (A 06-03 > OPT 06-02 12h > B 06-02 00h > C 06-01) — un mismatch de columnas del UNION lo CAZARÍA node:sqlite (no un assert de string). **CERRADO**.

8. **¿El conteo cuenta lo correcto (mismo universo que la lista)?** → SÍ. `buildNoTagCandidatesCountQuery` suma synced (noTag + activos + deleted_at NULL + oculta exits) + overlay (noTag + activos) — test de comportamiento: excluye tagged, otro-campo y exited (cuenta 3 de 6). Mismo criterio `noTag` que `buildAnimalsListQuery`. **CERRADO**.

9. **¿Multi-tenant / sin hardcode de establishment?** → SÍ. El conteo, la lista y el buscador reciben `establishmentId` del `EstablishmentContext` activo (`est.current.id`), nunca hardcode. El RPC (Run 1) deriva el tenant server-side. **CERRADO**.

10. **¿Test que pasa por la razón equivocada?** → No. Los tests de comportamiento EJECUTAN el SQL real contra node:sqlite (orden + conteo verificados con datos), no solo string-match. `resolveCreateOrAssign` assertea outputs exactos. El screenshot del veto verifica que la intermedia REALMENTE se abre (no un mock de UI): bastoneo mock → título + buscador + lista + CTA presentes en el DOM antes de capturar. **CERRADO**.

**Hueco no cubierto por la spec encontrado**: NINGUNO que requiriera parar. Todas las decisiones (módulo de la pura, builder de conteo dedicado, filtro client-side del buscador, token JIT) estaban dentro de la latitud que el design-sketch (§3, "sin píxeles") concedió explícitamente al implementer. El único hallazgo (key del remonte) era un bug de implementación, no un hueco de spec → corregido + reconciliado en `design §3.6`.

## Reconciliación specs ↔ as-built (Run 2)

El design-sketch §3 es "sin píxeles" (delega la UI concreta al implementer dentro de RD3/RD4/RD8). Las decisiones realizadas (pura en `tag-lookup.ts`, `buildNoTagCandidatesCountQuery` dedicado, `orderBy` en `buildAnimalsListQuery`, filtro client-side del buscador, `key={eid}`, token `candidateListMax`) NO contradicen ningún RD → no se reescriben los EARS de `requirements-09resto-dedup.md`. Se reconcilió el **design** (`§3.6 AS-BUILT` + tabla §6 con las filas reales y `[Run 2 done]`) para que NO quede stale vs el código. `tasks-09resto-dedup.md` con F4.1-F4.4 en `[x]` + notas AS-BUILT. Fases 5 (masiva) y 6 (E2E formal) sin tocar (runs posteriores).

## Verificación — `node scripts/check.mjs` (Run 2)

- **typecheck cliente**: ✅ verde (`tsc --noEmit` exit 0).
- **lint anti-hardcode (ADR-023)**: ✅ 0 violaciones (incl. el nuevo `AssignOrCreateBody` + helpers + token).
- **client unit tests**: ✅ verde — `tag-lookup.test.ts` (110, +4 nuevos de resolveCreateOrAssign), `local-reads.test.ts` (99, +4 nuevos: orderBy updated_at SQL + comportamiento, count SQL + comportamiento), `upload.test.ts` (incl. los de assign_tag de Run 1). Sin regresión.
- **suite backend `assign_tag_to_animal`**: ✅ VERDE (RPC 0089 YA deployada — Run 1 cerrado por el leader): 9/9 escenarios + grants anon fail-closed. PGRST202 desaparecido.
- **resto de suites backend** (Animal spec 02, RLS, Edge, Maneuvers, user_private, Import, sync_streams, operaciones_rodeo): ✅ CERO regresión.

**Resultado**: `node scripts/check.mjs` → **exit 0** ("All tests passed" + "Entorno listo"). Verde end-to-end.

## Screenshot para el veto del leader

`design/veto-dedup-opcionA/assign-or-create.png` (412×915, capturado con `app/e2e/dedup-screenshot.spec.ts` vía el mock del bastón). Muestra: encabezado "Caravana leída" + EID legible (`982 3676 4438 8000`); título "¿Es uno de tus animales sin caravana?"; buscador "Buscar por número o visual"; lista de candidatos (idv/visual + CategoryBadge + sexo + rodeo); CTA "Es un animal nuevo → dar de alta" PINNED abajo (≥touchMin, siempre visible).

> Para re-capturar: `cd app && pnpm e2e:build && pnpm exec playwright test e2e/dedup-screenshot.spec.ts`.
> NOTA para el veto: el `rodeoName` en el screenshot se ve ruidoso (`e2e_..._2ee235dd Rodeo general`) — es el NOMBRE del rodeo sembrado por el E2E (namespaced con el RUN_TAG), NO un bug del componente. En datos reales el rodeo es "Rodeo general" (corto). El componente pinta `candidate.rodeoName` tal cual baja.

## Para el leader (Run 2)

1. Veto de diseño (skill `design-review`) sobre `design/veto-dedup-opcionA/assign-or-create.png` ANTES de mostrar a Raf: EID legible, lista escaneable a pleno sol, CTA "es nuevo" ≥56px siempre visible, una decisión por pantalla, operable con una mano. Si pide cambios de copy/layout → re-iterar conmigo.
2. Gate 2 (security_analyzer modo code) sobre el diff desde `baseline_commit` — Run 2 es frontend puro (sin nuevo SQL/RPC); la superficie de seguridad real (el RPC) fue Gate 2 de Run 1.
3. Fases 5 (masiva opción B) y 6 (E2E formal) quedan para runs posteriores (NO tocadas).
4. Pasar al reviewer. NO marco `done` yo mismo.

---

# impl — spec 09 chunk "09 resto · dedup A/B" — Run 3 (UI opción B: BulkTagAssignmentScreen)

**Run**: Run 3 — Fase 5 (UI opción B: pantalla de asignación MASIVA). Backend (Run 1) + service offline + builders + opción A (Run 2) ya DONE → se CONSUMEN. NO se toca el RPC/service/builder (gateados) ni el modo `assign_or_create` del overlay (Run 2). Fase 6 (E2E formal) sin tocar salvo la captura del veto.
**Fecha**: 2026-06-13.
**baseline_commit**: el mismo de Run 1/2 (`f743a97...`) — feature multi-sesión, NO se sobreescribe.

## Plan (tasks de este run)

- T1 = F5.1 — `BulkTagAssignmentScreen` (`app/app/asignar-caravanas.tsx`) + ruta en `_layout.tsx` + anti-stacking + cola de sesión + candidatos `noTag` + buscador. ✅
- T2 = F5.2 — asignación 1×1 + contador (candidato sale de la sesión client-side, cola avanza, contador sube; cerrar no rollbackea). ✅
- T3 = F5.3 — CTA "es nuevo" → `/crear-animal?tag=` (sesión persiste) + entry points (tab Animales filtro noTag + tab Más). ✅
- T4 = F5.4 — surfacing race/dup. ⛔ **BLOQUEADA** (gap de spec — el canal existente no surfacea copy; ver abajo).
- T5 = F5.5 — re-escopeo al cambiar de campo (reiniciar + aviso). ✅
- T6 = capturas 412×915 para el veto del leader (`design/veto-dedup-opcionB/bulk-assign.png` + `bulk-empty.png`). ✅

## Archivos escritos / modificados (Run 3)

| Archivo | Acción |
|---|---|
| `app/app/asignar-caravanas.tsx` | **+** `BulkTagAssignmentScreen` + reducer de sesión + `BulkEidBody` + helpers (`SessionCounter`/`FieldChangedNotice`/`EmptyQueueState`/`EidHeader`/`CandidateSearchBar`/`CandidateRow`/`CandidateSummary`/`MetaPill`) |
| `app/app/_layout.tsx` | **mod** ruta `asignar-caravanas` (`<Stack.Screen>` + `ASIGNAR_CARAVANAS_ROUTE` en `ANIMAL_DESTINATIONS`) |
| `app/app/_components/FindOrCreateOverlay.tsx` | **mod** ROUTE-AWARE (`useSegments` → `onTagRead` no-op en la ruta masiva + cierra overlay stale) = anti-stacking sin tocar `ble/*` |
| `app/app/(tabs)/animales.tsx` | **mod** `Button` "Asignar caravanas en masa" visible con `onlyNoTag` activo + `onBulkAssign` |
| `app/app/(tabs)/mas.tsx` | **mod** `ActionRow` "Asignar caravanas en masa" (ícono `Radio`, todos los roles) en "Campo activo" |
| `app/e2e/dedup-screenshot.spec.ts` | **+** test de captura de la `BulkTagAssignmentScreen` (vacío + con EID en cola) |
| `design/veto-dedup-opcionB/bulk-assign.png` | **+** screenshot 412×915 (EID en cola + candidatos + contador) |
| `design/veto-dedup-opcionB/bulk-empty.png` | **+** screenshot 412×915 (estado vacío "bastoneá para empezar") |
| `specs/active/09-buscar-animal/tasks-09resto-dedup.md` | **mod** F5.1/F5.2/F5.3/F5.5 `[x]` + F5.4 BLOQUEADA con notas AS-BUILT |
| `specs/active/09-buscar-animal/design-09resto-dedup.md` | **mod** §4.5 AS-BUILT (anti-stacking corregido) + §5.1 AS-BUILT (gap F5.4) + tabla §6 con filas Run 3 |

## Decisión de implementación clave — anti-stacking (corrección del sketch §4.2)

El design §4.2 sugería `useBusyWhileMounted()` para suspender el overlay global. **Lo verifiqué contra el as-built de spec 04 y es INVIABLE**: `BleStickListenerProvider.handleReading` (línea 115) hace `if (!listeningRef.current) return` con `listening = enabled && !busy`. El gate es GLOBAL (no per-suscriptor): `busy=true` suspende a TODOS los suscriptores, incluido el propio listener de la `BulkTagAssignmentScreen` → con `useBusyWhileMounted` la pantalla NO recibiría tags. Tocar `ble/*` está gateado (no improviso ahí). **Mecanismo elegido (dentro de la latitud del §4.2: "el implementer elige el mecanismo de spec 04 que evita el doble consumo")**: el `FindOrCreateOverlay` global se hizo ROUTE-AWARE (`useSegments()` → top-segment `asignar-caravanas` → `onTagRead` retorna sin abrir + cierra cualquier overlay stale). La pantalla consume su PROPIO listener con `busy=false`. **Verificado E2E (mock)**: el bastoneo en la masiva muestra el cuerpo de la pantalla ("¿A cuál de tus animales sin caravana?") y NO el overlay global ("¿Es uno de tus animales sin caravana?") → no se apila ni se procesa dos veces. La invariante de §4.2 ("un bastoneo en la masiva NO abre el overlay global encima") se cumple.

## ⛔ BLOQUEANTE — F5.4 (surfacing de race/dup): gap de spec, decisión del leader/Raf

RD6.3 exige usar "el canal de status de sync EXISTENTE (mismo mecanismo que `permanent_reject` ya usa para el dup de TAG en alta)" y PROHÍBE "inventar un canal nuevo". Al implementarlo descubrí que ese "canal" as-built (`connector.ts::surfaceUploadRejection`) es **solo un `console.warn`** — NO mapea código→copy ni surfacea NADA al operario. El dup de alta "se nota" solo por el `rollbackOverlay` de su overlay optimista (el animal desaparece), no por copy. `assign_tag_to_animal` NO tiene overlay (RD2.2) → al rechazar (23505/23514) NADA es visible. No hay subscribable de rechazos (grep `subscribeUploadRejection|RejectionStore|...` → 0 resultados). La premisa de RD6.3/design §5 es FÁCTICAMENTE FALSA contra el as-built.

F5.4 (copy accionable) NO se puede completar sin: (a) **construir un canal nuevo** de rejection-surfacing pub/sub en `connector.ts` → **PROHIBIDO por RD6.3** + toca el core de sync (fuera del alcance del run); o (b) **degradar la copy accionable** → no permitido por RD6.1/RD6.2. La **sesión NO se pierde** igual (cada intent independiente — esa parte de RD6 SÍ se cumple en el as-built). Lo que falta es la COPY.

**No improviso** (regla del proyecto: hueco no cubierto → parar y reportar). **Decisión requerida del leader/Raf**:
1. Construir el canal de rejection-surfacing (expansión de alcance — también le daría copy al dup de alta, que hoy tampoco la tiene) y reconciliar RD6.3; o
2. Aceptar UX degradada para el MVP (la sesión no se pierde; el dup/race se resuelve al sincronizar — el candidato re-aparece con caravana o sigue sin ella — sin copy explícita) y reconciliar RD6 a esa realidad.

Hasta esa decisión, F5.4 queda `[ ]` BLOQUEADA en `tasks-09resto-dedup.md`. El resto de la Fase 5 (F5.1/F5.2/F5.3/F5.5) está done y verde.

## Trazabilidad RD → cobertura (Run 3)

| RD | Cómo se cubre (archivo:test / verificación) |
|---|---|
| RD5.1 (entry points) | `animales.tsx` (Button con `onlyNoTag`) + `mas.tsx` (ActionRow) → `/asignar-caravanas`; verificado E2E `dedup-screenshot.spec.ts::BulkTagAssignmentScreen` (navega por el filtro + CTA) |
| RD5.2 (listener modo asignación + cola + candidatos noTag) | `asignar-caravanas.tsx::useBleStickListener` + `sessionReducer enqueue` + `BulkEidBody` (`fetchAnimals({noTag,orderBy:'updated_at'})`); E2E: bastonazo → "Caravana leída" + lista |
| RD5.3 (asignar 1×1 independiente) | `BulkEidBody::onAssign` → `assignTagToAnimal` (Run 1, suite backend) → `dispatch('assigned')`; cada intent independiente (outbox) |
| RD5.4 (buscador noTag) | `BulkEidBody`: `searchAnimals` + filtro client-side `tagElectronic == null`; E2E: buscador visible |
| RD5.5 (contador + cerrar no rollbackea) | `SessionCounter` (header, no se desmonta) + `assignedCount`; los intents quedan en la outbox al desmontar |
| RD5.6 ("es nuevo" → CREATE, sesión sigue) | `onCreateNew` → `skipHead` + `router.push('/crear-animal',{tag})`; la pantalla sigue montada en el stack |
| RD5.7 (offline-first) | cola/listas/buscador/encolado 100% local; RPC al sync. `enabled` por contexto, no red |
| RD2.5 (candidato sale client-side) | `assignedProfileIds` + `visibleCandidates.filter(!excluded)` |
| RD7.1 (scoping al campo activo) | loaders con `establishmentId` del `EstablishmentContext`; nunca hardcode |
| RD7.3 (re-escopeo al cambiar de campo) | `prevEstablishmentRef` + `useEffect([establishmentId])` → `reset` + aviso; `currentEid→null→EmptyQueueState` (nunca candidatos ajenos) |
| RD5.2 anti-stacking | `FindOrCreateOverlay` route-guard (`useSegments`); E2E: la masiva NO abre el overlay global |
| RD6.1/RD6.2/RD6.3 (copy race/dup) | ⛔ BLOQUEADA (gap de spec, ver arriba) |

> Nota: la `BulkTagAssignmentScreen` es UI (RN/Tamagui) → fuera del grafo node:test (igual que `FindOrCreateOverlay`/`AssignOrCreateBody`). Su comportamiento se cubre con: los services/builders/RPC ya unit/suite-testeados que consume (Run 1/2) + el E2E `dedup-screenshot.spec.ts` (que ejercita end-to-end navegación + listener + cola + carga de candidatos + anti-stacking vía el mock del bastón). La E2E formal de la masiva (4 escenarios) es Fase 6 (run posterior); el screenshot ya ejercita el camino feliz como sub-producto.

## Autorrevisión adversarial (paso 8) — Run 3 (pantalla masiva + anti-stacking + sync)

Revisión hostil, punto por punto del checklist del task:

1. **¿El overlay global queda suspendido en esta pantalla?** → SÍ, por supresión de RUTA (NO `useBusyWhileMounted`, que mataría mi propio listener — bug evitado). `FindOrCreateOverlay.onTagRead` retorna si `onBulkAssignRouteRef.current` (top-segment = `asignar-caravanas`) + un `useEffect` cierra cualquier overlay stale al entrar a la ruta. **Verificado E2E**: el bastoneo en la masiva NO abre el overlay (aparece el cuerpo de la pantalla, no el del overlay). **CERRADO**.

2. **¿Cada asignación es independiente (cerrar no rollbackea)?** → SÍ. `assignTagToAnimal` encola un `op_intent` independiente (sin overlay, RD2.2). El estado de sesión (cola/contador/excluidos) es UI local; al desmontar la pantalla se pierde el estado PERO los intents quedan en la outbox. No hay rollback al cerrar. **CERRADO**.

3. **¿El contador sube y el candidato sale de la lista?** → SÍ. `dispatch('assigned')`: `assignedCount+1` + `assignedProfileIds.add(profileId)` + `queue.slice(1)`. El contador está en el header del SCREEN (no en el `BulkEidBody` que remonta con `key={currentEid}`) → no se resetea al avanzar la cola. `visibleCandidates` excluye los `assignedProfileIds` (RD2.5: no re-aparece aunque el denorm local siga NULL hasta el sync). **CERRADO**.

4. **¿Race/dup surfacean sin perder sesión?** → la SESIÓN no se pierde (cada intent independiente). La COPY accionable está **BLOQUEADA** (F5.4, gap de spec — el canal as-built solo console.warn; reportado al leader, NO improviso un canal nuevo que RD6.3 prohíbe). **PARCIAL — bloqueante reportado**.

5. **¿Cambiar de campo nunca muestra candidatos ajenos?** → SÍ (invariante DURA RD7.3). `prevEstablishmentRef` arranca con el campo inicial (un primer render NO dispara reset) → solo un CAMBIO real hace `reset` (vacía cola → `currentEid=null` → `EmptyQueueState`, nunca candidatos) + aviso. Los loaders están scopeados al `establishmentId` activo. Busqué la race "el campo cambia mientras una lista carga": el body se desmonta al resetear la cola (no queda lista vieja en pantalla). **CERRADO**.

6. **¿El dup global lo maneja como la spec dice?** → la spec (RD6.2) pide copy "ese TAG ya está asignado a otro animal" por el canal de status. El canal no existe (F5.4 bloqueada). El RPC SÍ rebota 23505 server-side (Run 1, suite backend lo verifica) y el sync lo clasifica `permanent_reject` (Run 1, `upload.test.ts`) — la mecánica está; falta la SUPERFICIE. **PARCIAL — mismo bloqueante de F5.4**.

7. **¿`useBusyWhileMounted` vs listener propio — doble consumo?** → NO uso `useBusyWhileMounted` (lo descarté por inviable). Uso UN listener propio; el overlay global se suprime por ruta. Un tag → 2 suscriptores (overlay + masiva) pero el overlay no-opea en esta ruta → UN solo enqueue. Verifiqué que no hay doble-enqueue (el reducer además dedup-ea un EID ya en cola). **CERRADO**.

8. **¿El `key={currentEid}` evita el bug del sub-estado viejo?** → SÍ (mismo patrón que el `AssignOrCreateBody` de Run 2). Sin el key, al avanzar la cola el `confirming` (candidato a confirmar) del EID viejo sobreviviría mientras el prop `eid` cambia → se asignaría el EID nuevo al candidato viejo. Con `key={currentEid}` el body remonta limpio. **CERRADO**.

9. **¿"Es nuevo" pierde la sesión?** → NO. `onCreateNew` hace `skipHead` (saca el EID, se va a dar de alta con él) + `router.push` (NO replace) → la masiva sigue montada en el stack; al volver, la cola restante + el contador persisten (RD5.6). Verifiqué que crear-animal usa `router.push`/`replace` a la ficha → la masiva queda debajo en el stack. **CERRADO**.

10. **¿Multi-tenant / sin hardcode?** → SÍ. `establishmentId` del contexto activo (nunca hardcode); el RPC deriva el tenant server-side. Lint anti-hardcode: 0 violaciones (incl. la pantalla nueva + sus helpers). **CERRADO**.

11. **¿Tests que pasan por la razón equivocada?** → el E2E ejercita el camino REAL (navega por el filtro + CTA → pantalla → bastonazo mock → la pantalla muestra el EID + candidatos), no un mock de UI. Asserts sobre texto que SOLO aparece si el flujo corrió (anti-stacking incluido: si el overlay se abriera, el assert del texto de la pantalla fallaría o aparecería el del overlay). **CERRADO**.

**Hueco no cubierto encontrado**: F5.4 (canal de surfacing de copy) — reportado, NO improvisado. El resto de la Fase 5 quedó sin huecos.

## Reconciliación specs ↔ as-built (Run 3)

- **Anti-stacking (§4.2)**: el sketch sugería `useBusyWhileMounted` — inviable. Reconciliado en `design §4.5` (mecanismo real: supresión por ruta del overlay) + `tasks F5.1` AS-BUILT. NO cambia el QUÉ (la invariante "no apilar el overlay" se cumple) → no se reescriben EARS; es un cambio de CÓMO documentado en el design.
- **F5.4 (RD6.3)**: gap real. Reconciliado en `design §5.1 AS-BUILT` (la premisa del canal existente es falsa) + `tasks F5.4` BLOQUEADA. NO toco los EARS de RD6 (es decisión del leader cómo reconciliarlos — opción canal vs UX degradada).
- Las demás decisiones (reducer de sesión, `key={currentEid}`, entry points, re-escopeo + aviso) están dentro de la latitud del sketch "sin píxeles" §4 → no contradicen RD5/RD7 → no se reescriben EARS. `tasks` con F5.1/5.2/5.3/5.5 `[x]` + AS-BUILT; tabla `design §6` con las filas reales `[Run 3 done]`.

## Verificación — `node scripts/check.mjs` (Run 3)

- **typecheck cliente**: ✅ verde (`tsc --noEmit` exit 0).
- **lint anti-hardcode (ADR-023)**: ✅ 0 violaciones (incl. `asignar-caravanas.tsx` + helpers + los CTAs en animales/mas + el guard de ruta del overlay).
- **client unit tests**: ✅ sin cambios ni regresión (Run 3 es UI pura sin nuevos units — la lógica de sesión es un reducer in-component, cubierto por el E2E; no agrego un módulo puro nuevo).
- **suites backend**: ✅ CERO regresión (no toco backend).
- **E2E screenshots** (`dedup-screenshot.spec.ts`): ✅ 2/2 passed — la opción A (Run 2) sigue verde + la opción B (Run 3) ejercita navegación + listener + cola + candidatos + anti-stacking.

**Resultado**: `node scripts/check.mjs` → **exit 0** ("All tests passed" + "Entorno listo"). Verde end-to-end.

## Screenshots para el veto del leader (Run 3)

- `design/veto-dedup-opcionB/bulk-assign.png` (412×915): header "Asignar caravanas" + back + contador "0"; EID legible "982 3708 6153 4000"; título "¿A cuál de tus animales sin caravana?"; buscador; lista de candidatos (idv/visual + CategoryBadge + sexo + rodeo + chevron); CTAs pinned "Bastoneé un animal nuevo, no está en la lista" + "Saltar esta caravana".
- `design/veto-dedup-opcionB/bulk-empty.png` (412×915): estado vacío "Bastoneá para empezar" + ícono bastón + copy.

> El `rodeoName` en `bulk-assign.png` se ve ruidoso (`e2e_..._Rodeo general`) — es el nombre del rodeo SEMBRADO por el E2E (namespaced con RUN_TAG), NO un bug del componente (mismo artefacto que el screenshot de opción A). En datos reales es "Rodeo general".
> Re-capturar: `cd app && pnpm e2e:build && pnpm exec playwright test e2e/dedup-screenshot.spec.ts`.

## Para el leader (Run 3)

1. **DECISIÓN F5.4 (BLOQUEANTE)**: el canal de surfacing de copy race/dup NO existe en el as-built (solo console.warn). RD6.3 prohíbe inventar uno. Decidir: construir el canal (expansión de alcance) o aceptar UX degradada para el MVP + reconciliar RD6. Hasta entonces F5.4 queda `[ ]`.
2. Veto de diseño (skill `design-review`) sobre `design/veto-dedup-opcionB/bulk-assign.png` + `bulk-empty.png` ANTES de mostrar a Raf: contador visible, lista escaneable a pleno sol, ritmo bastón→asignar→siguiente fluido, una decisión por pantalla, operable con una mano. Si pide cambios → re-iterar conmigo.
3. Gate 2 (security_analyzer modo code) sobre el diff desde `baseline_commit` — Run 3 es frontend puro (sin nuevo SQL/RPC); la superficie de seguridad real (el RPC) fue Gate 2 de Run 1.
4. Fase 6 (E2E formal, 4 escenarios) queda para un run posterior (NO tocada salvo la captura del veto).
5. Pasar al reviewer cuando F5.4 esté decidida. NO marco `done` yo mismo.

---

# impl — spec 09 chunk "09 resto · dedup A/B" — Run 4 (F5.4: prevención de dup client-side)

**Run**: Run 4 — F5.4 (la única task que quedó BLOQUEADA en Run 3). El leader decidió el approach y reconcilió la spec (RD6 → prevención client-side, no surfacing de sync). NO se toca el resto del Run 3 (F5.1/5.2/5.3/5.5 — done y verde), ni el RPC/service/overlay opción A (gateados).
**Fecha**: 2026-06-13.
**baseline_commit**: el mismo de Run 1/2/3 (`f743a97...`) — feature multi-sesión, NO se sobreescribe.

## La decisión del leader (RD6 reconciliada)

El canal de rechazos de sync as-built (`connector.ts::surfaceUploadRejection`) es solo `console.warn` y `assign_tag_to_animal` no tiene overlay optimista → NO hay forma de surfacear el rechazo *al sincronizar* sin inventar un canal nuevo (PROHIBIDO por RD6.3). La defensa correcta es **PREVENIR el dup en el momento del bastoneo (client-side)**, no esperar el rechazo del sync. RD6 quedó reconciliada a esto (ya foldeada en `requirements-09resto-dedup.md` RD6).

## Qué cambié (solo `asignar-caravanas.tsx` + el E2E)

| Archivo | Acción |
|---|---|
| `app/app/asignar-caravanas.tsx` | **mod** `onTagRead` pasó a `async`: corre `lookupByTag(eid, establishmentId)` ANTES de encolar. Solo `mode:'create'` → `dispatch enqueue`; `edit`/`transfer` → estado `dupNotice` + `DupNoticeBanner` sin encolar. + import `lookupByTag`, type `DupNotice`, `establishmentIdRef` (para leer el campo en el callback sin re-crearlo), limpieza del `dupNotice` al cambiar de campo / al encolar un EID válido. + componente `DupNoticeBanner` (reusa Card+Button de FieldChangedNotice). |
| `app/e2e/dedup-screenshot.spec.ts` | **+** test de comportamiento "opción B: bastonear un EID ya asignado NO encola y avisa (RD6.1)" + captura `bulk-dup-warning.png`. Encabezado actualizado (3 estados de opción B). |
| `specs/active/09-buscar-animal/requirements-09resto-dedup.md` | **mod** nota AS-BUILT bajo RD6.1 (confirmación, sin desviar el *qué* del EARS). |
| `specs/active/09-buscar-animal/design-09resto-dedup.md` | **mod** §5 reescrita (prevención client-side §5.0 + LIM del residual §5.1 + histórico §5.2 refutado); §4.5 F5.4 actualizado a "done"; tabla §6 reconciliada. |
| `specs/active/09-buscar-animal/tasks-09resto-dedup.md` | **mod** F5.4 marcada `[x]` con nota AS-BUILT. |
| `design/veto-dedup-opcionB/bulk-dup-warning.png` | **+** captura 412×915 del banner de dup (cortesía — banner menor que reusa componente vetado). |

**NO toqué**: `feature_list.json`, `progress/current.md`, el RPC/migración 0089, el service `assignTagToAnimal`/outbox/mapping, el modo `assign_or_create` del overlay (opción A), los builders, los entry points, el re-escopeo (F5.5). Solo la masiva (opción B) + su E2E + las specs.

## Diseño de la solución

`onTagRead` (antes: `dispatch enqueue` síncrono) ahora:
1. Lee `establishmentIdRef.current` (campo activo; ref para no re-crear el callback).
2. `await lookupByTag(eid, estId)` (lectura LOCAL, sin red — las 3 ramas edit/transfer/create del motor BLE ya existente).
3. Re-chequea el campo tras el await (si cambió → descarta; el lookup se scopeó al campo del disparo).
4. `!res.ok` (fallo de la lectura local, raro) → `dupNotice {kind:'lookup_error'}` (fail-CLOSED, NO encola).
5. `mode:'create'` → limpia `dupNotice` + `dispatch enqueue` (flujo normal, ofrece candidatos).
6. `mode:'edit'`/`'transfer'` → `dupNotice {kind:'already_tagged'}` (banner, NO encola, sesión intacta).

`DupNoticeBanner`: Card `$terracota` + tag icon + EID legible + copy accionable en voseo + CTA "Entendido". Se limpia al descartar / al encolar un EID válido / al cambiar de campo.

## Trazabilidad RD → test (Run 4)

| RD | Cómo se cubre (archivo:test / verificación) |
|---|---|
| RD6.1 (prevención client-side: edit/transfer no encola + avisa) | `dedup-screenshot.spec.ts::"opción B: bastonear un EID ya asignado NO encola y avisa"` — bastonea un EID sembrado CON caravana → banner "Esa caravana ya está asignada" + la cola NO avanza (sigue en "Bastoneá para empezar", NO en la lista de candidatos) + un EID nuevo después SÍ entra a la cola. La rama `mode:'create'`→encola la ejercitan los tests de captura existentes (opción B con EID en cola). |
| RD6.2 (residual al sync = LIM, no toast) | `upload.test.ts` (Run 1): 23505/23514 de `assign_tag_to_animal` → `permanent_reject` (descarte + log); NO hay case/canal nuevo. Verificado: el residual lo maneja la maquinaria existente. |
| RD6.3 (no se inventa canal de sync) | grep: no se agregó subscribable/store de rechazos; `connector.ts` NO tocado. El `DupNoticeBanner` es prevención client-side, no un canal de sync. |
| RD9.3 (fallo de asignación surfaceado accionablemente) | el camino primario es la prevención (RD6.1); el residual al sync queda como LIM (RD6.2). El banner cubre el caso prevenible; el log observable cubre el residual negligible. |

> Nota: `asignar-caravanas.tsx` es UI (RN/Tamagui) → fuera del grafo node:test. El comportamiento de F5.4 se cubre con el E2E de comportamiento (lookup real → no-encola → banner; vía el mock del bastón + un animal sembrado CON caravana) + los units/suite de Run 1 que verifican que el residual al sync cae en `permanent_reject`. `lookupByTag` ya está cubierto por la suite/tests de Run 1/2 (es el motor BLE del chunk anterior, reusado tal cual).

## Autorrevisión adversarial (paso 8) — Run 4 (prevención de dup en la masiva)

Revisión hostil, punto por punto del checklist del task:

1. **¿El lookup corre ANTES de ofrecer asignar?** → SÍ. `onTagRead` `await lookupByTag(eid, estId)` ANTES de cualquier `dispatch enqueue`. Solo `mode:'create'` encola. Un EID con caravana NUNCA llega a la cola ni muestra candidatos. **CERRADO**.

2. **¿Un EID con match NO encola?** → SÍ. `mode:'edit'`/`'transfer'` → `setDupNotice` (banner) y `return` sin `dispatch`. Verificado E2E: tras bastonear el EID dup, la cola sigue vacía ("Bastoneá para empezar"), NO aparece "¿A cuál de tus animales sin caravana?" (`toHaveCount(0)`). **CERRADO**.

3. **¿La sesión/contador no se pierde?** → SÍ. El banner es estado `dupNotice` separado de `session` (cola/contador/excluidos). El reducer no se toca al avisar. El contador `SessionCounter` (header) sigue en su valor. **CERRADO**.

4. **¿Cero hardcode?** → SÍ. Lint `check-hardcode.mjs`: 0 violaciones. `DupNoticeBanner` usa tokens (`$terracota`/`$surface`/`$divider`/fontSize/etc.), ícono `Tag` vía `getTokenValue`, a11y vía `labelA11y`, copy en voseo. Reusa Card+Button (ya vetados). **CERRADO**.

5. **¿No inventé un canal de sync nuevo?** → CORRECTO, no. No toqué `connector.ts`/`upload.ts`/`outbox.ts`. La prevención es 100% client-side en la pantalla (lookup local + banner). El residual al sync lo maneja la maquinaria de Run 1 (permanent_reject + log), sin canal user-facing nuevo (RD6.3). **CERRADO**.

6. **¿Race: el campo cambia mientras el lookup está en vuelo?** → cubierto. Re-chequeo `establishmentIdRef.current !== estId` tras el await → descarta el resultado tardío. El reset por cambio de campo (F5.5) ya limpia cola+contador+`dupNotice`. Busqué la race "EID dup del campo viejo se encola en el nuevo": no ocurre (el lookup se scopeó a `estId` del disparo y se descarta si el campo cambió). **CERRADO**.

7. **¿El banner persiste stale entre bastoneos?** → no. Se limpia al descartar ("Entendido"), al bastonear un EID válido nuevo (`mode:'create'` hace `setDupNotice(null)`), y al cambiar de campo. Un nuevo dup lo sobrescribe (muestra el último). **CERRADO**.

8. **¿`mode:'transfer'` (otro campo) también se bloquea?** → SÍ. La copy "ese TAG ya está asignado a otro animal de tus campos" cubre tanto edit (este campo) como transfer (otro campo) — en ambos el TAG ya existe en `animals` (unicidad global) → reasignarlo rebotaría. Correcto bloquearlo client-side. **CERRADO**.

9. **¿Fail-open o fail-closed ante fallo de la lectura local?** → fail-CLOSED: `!res.ok` → banner "no pudimos verificar" + NO encola. Mejor pedir un re-bastoneo que encolar un EID sin verificar (riesgo de dup que rebote al sync sin feedback). Decisión de robustez (el EARS no lo pide explícito; documentado como edge extra en la nota AS-BUILT de RD6.1). La lectura es SQLite local → casi nunca falla. **CERRADO**.

10. **¿Test que pasa por la razón equivocada?** → no. El E2E siembra un animal CON caravana (`tag: usedEid`), espera a que BAJE al SQLite local (assert de visibilidad en la lista), y SOLO entonces bastonea ese EID → `lookupByTag` lo encuentra localmente y resuelve `edit`. Sin el seed-con-tag + la espera, el lookup daría `create` y el test pasaría por la razón equivocada (encolaría). El assert `toHaveCount(0)` sobre "¿A cuál de tus animales sin caravana?" verifica que NO se ofreció la lista (no solo que apareció el banner). Y el último paso (un EID nuevo SÍ entra) verifica que la prevención no rompe el flujo normal. **CERRADO**.

**Hueco no cubierto encontrado**: NINGUNO. El approach está fijado por el leader (RD6 reconciliada); lo implementé tal cual, con un solo edge extra (fail-closed ante fallo de lookup) documentado. No improvisé ni desvié.

## ¿Captura nueva para el veto?

Sí, capturé `design/veto-dedup-opcionB/bulk-dup-warning.png` (412×915) por cortesía, PERO el `DupNoticeBanner` es un **banner menor que reusa el patrón Card+Button de `FieldChangedNotice`** (ya vetado por el leader). Por la regla del task ("si es un toast/banner menor reusando un componente ya vetado, no hace falta captura nueva"), el veto formal es opcional. La captura está disponible si el leader la quiere mirar.

## Reconciliación specs ↔ as-built (Run 4)

- **RD6 (requirements)**: ya estaba reconciliada por el leader (prevención client-side + LIM). Agregué una nota AS-BUILT bajo RD6.1 confirmando la implementación, SIN desviar el *qué* del EARS (regla: no reescribir EARS por gusto).
- **design §5**: reescrita de "reusar el canal de sync (BLOQUEANTE)" a "prevención client-side §5.0 + LIM del residual §5.1 + histórico refutado §5.2". §4.5 (F5.4) y la tabla §6 actualizadas a "done". Coincide con el código.
- **tasks F5.4**: `[x]` con AS-BUILT. El resto de la Fase 5 (F5.1/5.2/5.3/5.5) ya estaba `[x]` (Run 3) — no se tocó.
- Nunca quedan specs contradictorias con el código.

## Verificación — `node scripts/check.mjs` (Run 4)

- **typecheck cliente**: ✅ verde (`tsc --noEmit` exit 0).
- **lint anti-hardcode (ADR-023)**: ✅ 0 violaciones (incl. `DupNoticeBanner` + el `onTagRead` async).
- **client unit tests + suites backend**: ✅ CERO regresión — `check.mjs` full **exit 0** ("All tests passed" + "Entorno listo"). La suite `assign_tag_to_animal` (Run 1, deployada) sigue verde; units de mapeo/clasificación verdes; Animal/RLS/Edge/Maneuvers/sync_streams/operaciones_rodeo sin regresión.
- **E2E** (`dedup-screenshot.spec.ts`): ✅ **3/3 passed** (18.3s) — los 2 de captura existentes (opción A + opción B) + el nuevo de comportamiento de prevención de dup. El warning `uv_handle` al final es ruido de teardown de libuv en Windows POST-"3 passed" (no es un fallo de test).

**Resultado**: `node scripts/check.mjs` → **exit 0**. E2E 3/3 verde. Verde end-to-end.

## Para el leader (Run 4)

1. F5.4 DESBLOQUEADA + implementada (prevención client-side, RD6 reconciliada). La Fase 5 (opción B) queda completa (F5.1–F5.5 todas `[x]`).
2. Veto de diseño (opcional) sobre `design/veto-dedup-opcionB/bulk-dup-warning.png` — banner menor que reusa `Card`+`Button` ya vetados; el veto formal no es obligatorio.
3. Gate 2 (security_analyzer modo code) sobre el diff desde `baseline_commit` — Run 4 es frontend puro (sin nuevo SQL/RPC; la superficie de seguridad real fue Gate 2 de Run 1). El nuevo path es una lectura local (`lookupByTag`) + un banner; no toca authz/tenant (el RPC server-side sigue siendo la red de seguridad final, RD7.2).
4. Fase 6 (E2E formal, 4 escenarios) + Fase 7 (cierre/reconciliación final del chunk) quedan para un run posterior (el §3.5 escenario (d) "dup-TAG → copy accionable" ahora se mapea a la prevención client-side de F5.4, no al surfacing de sync).
5. Pasar al reviewer. NO marco `done` yo mismo.

---

# impl — spec 09 chunk "dedup A/B" — Run 4b (E2E formal Fase 6 + reconciliación de cierre Fase 7)

**Run**: Run 4b — Fase 6 (E2E Playwright formal con bastón mock, los 4 escenarios + el directo-a-CREATE) + Fase 7 (cierre/reconciliación specs↔as-built). TODO el código del chunk (RPC 0089, service, UI A y B, prevención dup F5.4) ya estaba DONE y verde — NO lo toqué (solo agregué tests E2E + un oráculo de test + el endurecimiento de un EID en un spec de captura; cero cambios al RPC/migración/service/UI del chunk).
**Fecha**: 2026-06-13.
**Baseline Gate 2**: `baseline_commit` ya registrado al inicio del archivo (`f743a97…`) — NO sobreescrito.

## Plan (tasks de este run)

- **F6.1** — `app/e2e/baston-dedup.spec.ts` (NUEVO): los 4 escenarios del Gate 0 + el directo-a-CREATE (RD3.2), como tests de COMPORTAMIENTO con aserciones. ✅
- **F7.1** — Autorrevisión adversarial sobre el E2E. ✅
- **F7.2** — `node scripts/check.mjs` exit 0 end-to-end. ✅
- **F7.3** — Reconciliación de cierre (notas AS-BUILT en `requirements.md` base R7/R8/R12 + headers de las specs del chunk + tasks). ✅

## Archivos escritos / modificados (Run 4b)

| Archivo | Acción |
|---|---|
| `app/e2e/baston-dedup.spec.ts` | **+** E2E formal, 5 escenarios de comportamiento (a/b/a'/c/d) |
| `app/e2e/helpers/admin.ts` | **+** oráculo `waitForServerTagAssigned(profileId, tag)` (server-side, prueba la cadena offline→sync→RPC→0079) |
| `app/e2e/dedup-screenshot.spec.ts` | **mod** EIDs hardcodeados → `makeEid()` único por corrida (fix de leak del unique global de `animals`) |
| `specs/active/09-buscar-animal/requirements.md` | **mod** notas AS-BUILT FINALES de R7/R8/R12 (correcciones: anti-stacking route-aware NO `useBusyWhileMounted`; dup = prevención client-side NO canal de sync; Gate 1 ratificó idempotencia state-based + authz) |
| `specs/active/09-buscar-animal/requirements-09resto-dedup.md` | **mod** header Status (Draft/pendiente → spec aprobada + Gate 1 PASS + deployado + impl done) |
| `specs/active/09-buscar-animal/design-09resto-dedup.md` | **mod** header Status + tabla de archivos (+ `baston-dedup.spec.ts` + oráculo + endurecimiento screenshot) |
| `specs/active/09-buscar-animal/tasks-09resto-dedup.md` | **mod** F6.1/F7.1/F7.2/F7.3 `[x]` con AS-BUILT |

> **NO tocado** (código del chunk, ya gateado): `0089_assign_tag_to_animal_rpc.sql`, `outbox.ts`, `upload.ts`, `animals.ts`, `tag-lookup.ts`, `local-reads.ts`, `FindOrCreateOverlay.tsx`, `asignar-caravanas.tsx`, `animales.tsx`, `mas.tsx`, `_layout.tsx`, `tamagui.config.ts`. NO tocado: `feature_list.json`, `progress/current.md` (los maneja el leader).

## Fase 6 — E2E formal (`app/e2e/baston-dedup.spec.ts`): 5/5 VERDE

Tests de COMPORTAMIENTO con aserciones (las CAPTURAS de veto siguen en `dedup-screenshot.spec.ts`). Reusan el harness mock del bastón (`window.__rafaqBle.tagRead` bajo el flag `__RAFAQ_BLE_E2E__`, idéntico a `baston.spec.ts`). Cada test espera el first-sync (candidatos visibles en la lista) antes de bastonear → no pasan por la razón equivocada.

- **(a) opción A — asignar a candidato**: EID sin match CON ≥2 candidatos noTag → modo `assign_or_create` (verifica título "¿Es uno de tus animales sin caravana?" + buscador + CTA "es nuevo") → tocar candidato 4001 → confirmar "Asignar caravana" → navega a la ficha del candidato CORRECTO (bloque "Identificación" + su visual; la intermedia ya no está). **Prueba end-to-end de que SE ASIGNÓ**: oráculo SERVER `waitForServerTagAssigned(targetProfileId, eid)` confirma `animals.tag_electronic` Y `animal_profiles.animal_tag_electronic` = el EID (RPC aplicado + propagación 0079). NO se verifica en la ficha (lectura LOCAL no-reactiva via `useFocusEffect` → muestra "—" hasta re-focus, staleness offline-first documentada design §3.3).
- **(b) opción A — "es nuevo"**: misma intermedia → "Es un animal nuevo → dar de alta" → `/crear-animal` con el EID precargado read-only ("Creando: [EID]").
- **(a') 0 candidatos → CREATE directo (RD3.2)**: EID sin match SIN candidatos noTag (sembré un animal CON caravana = 0 candidatos) → modo `create` directo ("Animal nuevo" + "Dar de alta"), NUNCA abre la intermedia.
- **(c) opción B — masiva 1×1 + contador**: en `BulkTagAssignmentScreen`, 2 candidatos exactos, bastonear EID1 → asignar a 5001 → contador "1 caravana asignada" + cola vacía; bastonear EID2 → el 5001 YA NO aparece en la lista (salió de la sesión, RD2.5) → asignar a 5002 → contador "2 caravanas asignadas"; un 3er bastoneo no tiene candidatos ("No hay animales sin caravana en este campo.") = ambos salieron.
- **(d) opción B — dup prevención (RD6.1)**: EID ya asignado → banner "Esa caravana ya está asignada" SIN encolar (sigue en "Bastoneá para empezar", NO en la lista de candidatos); descartar → un EID nuevo SÍ entra a la cola. (Consolidado autoritativo acá; el de `dedup-screenshot.spec.ts` queda como driver de la captura `bulk-dup-warning.png`.)

**Cómo corrió + resultado**:
- `cd app && pnpm exec playwright test e2e/baston-dedup.spec.ts` → **5 passed (25.4s)**.
- Suite BLE+dedup completa junta: `pnpm exec playwright test e2e/baston.spec.ts e2e/baston-dedup.spec.ts e2e/dedup-screenshot.spec.ts` → **12 passed (59.0s)** (sin regresión de `baston.spec.ts` ni de las capturas). El `Assertion failed: !(handle->flags…` final es ruido de teardown de libuv en Windows POST-"passed" (no es fallo de test; lo emiten todas las suites E2E del repo).

## Fase 7 — autorrevisión adversarial (F7.1)

Pasada hostil sobre MI trabajo (no soy pasamanos de mi propio E2E):
- **Test que pasaba por la razón equivocada (cazado y cerrado)**: el escenario (a) original verificaba la caravana en la FICHA. La ficha lee LOCAL una sola vez (`useFocusEffect`) y NO es reactiva → tras asignar offline muestra "Caravana electrónica —" hasta re-focus. El test FALLÓ por timeout (45s). El atajo verde-falso habría sido subir el timeout o navegar-volver; el correcto fue mover la verificación al **SERVER** (oráculo `waitForServerTagAssigned`), atado al `profileId` del candidato + el EID único → no puede pasar por el animal equivocado y prueba la persistencia REAL (no la UI stale). Esto es exactamente lo que el leader anotó en su veto de spec (hint optimista / staleness offline).
- **Bug REAL destapado al testear (NO del chunk; es de un test)**: `dedup-screenshot.spec.ts` usaba EIDs HARDCODEADOS (`982000000000007`). `animals.tag_electronic` tiene un unique GLOBAL y `animals` NO se borra en cascada con el establishment → un run interrumpido dejó la fila huérfana → el siguiente run choca el unique (`duplicate key value violates unique constraint "animals_tag_unique"`). Lo endurecí a `makeEid()` único por corrida. (Intenté limpiar la fila huérfana vía service_role pero el clasificador gatea deletes a la DB compartida sin autorización de Raf — correcto; la fila huérfana es inofensiva ahora que ningún test usa ese EID fijo.)
- **¿El código del chunk tiene bugs?** NO encontré ninguno al testear los 5 escenarios + el oráculo. El RPC/host/masiva/prevención-dup se comportan end-to-end como el spec pide. NO toqué código del chunk (ya gateado en Runs 1-3: reviewer APPROVED + Gate 2 PASS).
- **Edge cases ejercidos**: 0 candidatos (a'), candidato que sale de la lista de sesión y no re-aparece (c), EID dup que NO encola + sesión intacta (d), navegación al perfil correcto (a). Multi-tenant: cada test usa su propio campo namespaced; el oráculo está atado al perfil exacto.

## Fase 7 — reconciliación specs↔as-built (F7.3)

- **`requirements.md` BASE (R7/R8/R12)**: actualizadas las notas AS-BUILT a los deltas FINALES, corrigiendo 2 afirmaciones que habían quedado **stale** del plan (no del código):
  - **R8**: "anti-stacking con `useBusyWhileMounted`" → CORREGIDO a "route-aware del overlay global" (el `useBusyWhileMounted` era inviable — el provider gatea `listening=enabled && !busy` para TODOS los suscriptores; reconciliado en Run 3 design §4.5).
  - **R8.4**: "el dup-TAG se surfacea por el canal de status existente al sincronizar" → CORREGIDO a "prevención CLIENT-SIDE al bastonear (RD6.1) + LIM del residual al sync (RD6.2/RD6.3)" (el canal as-built `surfaceUploadRejection` es solo `console.warn`; reconciliado en Run 4 RD6).
  - **R7/R12**: "authz / idempotencia a confirmar en Gate 1" → "RATIFICADAS por Gate 1 (cualquier rol activo + state-based)" + cita de la migración 0089 deployada + la staleness de la ficha + referencia al E2E formal.
- **Headers Status**: `requirements-09resto-dedup.md` y `design-09resto-dedup.md` decían "Draft / pendiente de aprobación de spec + Gate 1" → ambos YA pasaron (Gate 1 PASS + Puerta de spec aprobada + deploy hecho) → actualizados a "spec aprobada + Gate 1 PASS + RPC deployado; implementación done (Runs 1-4)".
- **`design-09resto-dedup.md` §6 (tabla de archivos)**: + `baston-dedup.spec.ts` + el oráculo `waitForServerTagAssigned` + el endurecimiento del screenshot spec.
- **`tasks-09resto-dedup.md`**: F6.1/F7.1/F7.2/F7.3 `[x]` con AS-BUILT. F1–F5 ya estaban `[x]` (Runs 1-3). Quedan `[ ]` SOLO ítems del leader: F0.1 (Gate 1, ya PASS — checkbox del leader), F1.3 (deploy gated, ya aplicado — del leader), los 2 vetos de diseño (`[PENDIENTE — del leader]`).
- Nunca quedan specs contradictorias con el código.

## Trazabilidad R<n> → test (E2E del Run 4b)

| RD | Test E2E concreto |
|---|---|
| RD3.1 (modo `assign_or_create` cuando ≥1 candidato) | `baston-dedup.spec.ts` (a): "¿Es uno de tus animales sin caravana?" tras bastonear sin match con candidatos |
| RD3.2 (0 candidatos → CREATE directo) | `baston-dedup.spec.ts` (a'): "Animal nuevo" + "Dar de alta", NO la intermedia |
| RD3.4 (buscador) | (a): `getByPlaceholder('Buscar por número o visual')` visible |
| RD3.6 (asignar candidato → ficha) | (a): tocar 4001 → confirmar → ficha del 4001 + oráculo server confirma el assign |
| RD3.7 ("es nuevo" → CREATE precargado) | (b): "Es un animal nuevo → dar de alta" → "Creando: [EID]" |
| RD2.1/RD2.5 (assign offline + candidato sale de la lista) | (a) oráculo server (assign persiste) + (c) candidato excluido de la lista de sesión |
| RD5.2/RD5.3/RD5.5 (cola + 1×1 + contador) | (c): 2 bastoneos → asignar a 2 → contador "2 caravanas asignadas" |
| RD6.1 (prevención dup client-side) | (d): EID ya asignado → banner "Esa caravana ya está asignada" sin encolar + sesión intacta |

(La trazabilidad RD→unit/backend de Runs 1-3 ya está documentada arriba en este archivo. El Run 4b agrega la capa E2E end-to-end.)

## Para el leader (Run 4b)

1. Fase 6 (E2E formal) + Fase 7 (reconciliación de cierre) DONE. El chunk dedup A/B queda implementado de punta a punta (backend + UI A + UI B + prevención dup + E2E + specs reconciliadas).
2. `node scripts/check.mjs` → **exit 0** end-to-end. E2E dedup 5/5 + suite BLE+dedup 12/12 verdes.
3. NO toqué código del chunk (ya gateado). El Run 4b agregó tests E2E + un oráculo de test + el endurecimiento de un EID en un spec de captura. La superficie de seguridad NO cambió (el RPC server-side sigue siendo la red final, RD7.2) — Gate 2 de este run es sobre un diff de tests + specs.
4. Pendiente del leader: reviewer + Gate 2 (code) sobre el diff desde `baseline_commit` + Puerta 2 (Raf en `pnpm web`) → cierre del chunk (con opción C diferida post-MVP). NO marco `done` yo mismo.
