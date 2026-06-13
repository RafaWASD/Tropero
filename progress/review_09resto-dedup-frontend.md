# Review - spec 09 chunk "09 resto - dedup A/B" - FRONTEND (Runs 2/3/4 + 4b)

Reviewer: reviewer (Opus 4.8). Fecha: 2026-06-13. Alcance: delta de frontend (opcion A modo assign_or_create, opcion B BulkTagAssignmentScreen, prevencion dup client-side RD6.1, builders/services puros, entry points, anti-stacking, E2E). El backend (RPC 0089 + service + outbox/mapping de Run 1) fue revisado+aprobado+gateado - NO re-revisado salvo la integracion.

## Veredicto: APPROVED

---

## Trazabilidad RD a test (delta de frontend)

- RD3.1 (>=1 cand a assign_or_create): tag-lookup.test.ts resolveCreateOrAssign(1) + baston-dedup.spec.ts (a).
- RD3.2 (0 cand a CREATE directo): tag-lookup.test.ts resolveCreateOrAssign(0) + baston-dedup.spec.ts (a-prima) (NO abre intermedia).
- RD3.3 (lista noTag updated_at DESC): local-reads.test.ts buildAnimalsListQuery orderBy updated_at (SQL + node:sqlite) + CandidateRow.
- RD3.4 (buscador noTag): searchAnimals + filtro client-side tagElectronic null en AssignOrCreateBody/BulkEidBody.
- RD3.5 (info minima): CandidateRow (idv/visual + CategoryBadge + sexo + rodeo + chevron).
- RD3.6 (asignar a ficha): onAssign a assignTagToAnimal a /animal/[id]; baston-dedup (a) + oraculo server waitForServerTagAssigned (offline-sync-RPC-0079).
- RD3.7 (es nuevo a CREATE): onCreateNew a /crear-animal?tag=; baston-dedup (b) (Creando: EID).
- RD3.8 (intermedia SOLO BLE): host solo en rama create del lookup BLE; puerta manual no usa lookupByTag.
- RD4.2/4.3/4.4: host seqRef/ticket re-chequeado tras AMBOS awaits; key=eid remonta; useEffect([estId]) cierra.
- RD5.2/5.3/5.5: sessionReducer + BulkEidBody + SessionCounter; baston-dedup (c) (contador llega a 2).
- RD2.5 (candidato sale client-side): assignedProfileIds + visibleCandidates.filter; baston-dedup (c) (5001 no re-aparece).
- RD5.6 (es nuevo, sesion sigue): onCreateNew a skipHead + router.push (no replace).
- RD6.1 (prevencion dup): onTagRead async (lookupByTag ANTES de encolar; edit/transfer a banner sin encolar; fail-closed); baston-dedup (d) + dedup-screenshot.
- RD6.2/6.3 (residual = LIM, no canal nuevo): upload.test.ts (23505/23514 a permanent_reject); connector.ts NO tocado.
- RD7.1 (scoping campo activo): loaders con establishmentId del contexto; buildNoTagCandidatesCountQuery test excluye est-2.
- RD7.3 (re-escopeo cambio campo): prevEstablishmentRef + useEffect([estId]) a reset + banner; currentEid null a EmptyQueueState.
- RD8.1/8.2 (decision pura, datos locales): tag-lookup.test.ts (0/1/>=2/negativo) + buildNoTagCandidatesCountQuery (sin red, sin has_role_in).
- anti-stacking: FindOrCreateOverlay route-aware useSegments() + useEffect cierra stale; E2E masiva no apila overlay.

Sin RD de frontend sin test.

## Tasks completas: SI
Todas las tasks de implementacion (F1.1-F1.2, F2.1, F3.1-F3.4, F4.1-F4.4, F5.1-F5.5, F6.1, F7.1-F7.3) en [x] con AS-BUILT. Los [ ] restantes son del LEADER, justificados:
- F0.1 (Gate 1) ya PASS (security_spec_09resto-dedup.md).
- F1.3 (deploy gated) ya aplicado (0089 deployada; suite backend verde).
- 2x Veto de diseno del leader, marcados [PENDIENTE - es del leader, no del implementer].

## CHECKPOINTS
- C1 [x] check.mjs exit 0 (All tests passed + Entorno listo).
- C2 [x] una feature in_progress; suites verdes.
- C3 [x] capas respetadas; sin hardcode de establishment_id (grep limpio); sin TODO/console.log reales.
- C4 [x] builders con comportamiento real contra node:sqlite; E2E con fixtures reales (seed + first-sync).
- C6 [x] EARS; tasks [x]; cada RD con test.
- C7 [x] multi-tenant: loaders/lookup/count scopeados al campo activo; count test excluye est-2; RPC deriva tenant (RD7.2).
- C8 [x] offline-first: cola/listas/buscador/encolado local; RPC al sync; lookupByTag local; banner dup sin red.

## Checklist RAFAQ-especifico
- A (RLS): N/A frontend - el chunk NO crea tablas ni policies (RD1.9). Superficie RLS = Run 1 (gateado).
- B (offline-first): OK - funciona offline; scoped por establishment_id activo; conflictos documentados (RD6.1 prevencion + RD6.2 residual LIM); sin requests sincronos a Supabase (outbox + lecturas locales).
- C (BLE): OK - listener de spec 04 (gateado); modo manual fallback (es-nuevo/saltar/buscador <=1 tap); correlacion TAG-accion (lookup local); logs no bloquean (route-aware).
- D (UI manga): OK - targets grandes via token (touchMin/searchBarLg/chipMin); fuente $8/$7/$6; una decision por pantalla (key=eid remonta); loading visible.
- E (Edge Functions): N/A - usa RPC SECURITY DEFINER (Run 1).

## Exactitud de specs (codigo a spec, paso 6)
design-09resto-dedup.md describe el as-built REAL sin contradicciones: 3.6 (resolveCreateOrAssign, buildNoTagCandidatesCountQuery, ResolvedBody, key=eid, chevron); 4.5 (anti-stacking CORREGIDO de useBusyWhileMounted a route-aware useSegments, confirmado en FindOrCreateOverlay lineas 100-104/131/179-181); 5 (RD6 prevencion client-side 5.0 + LIM 5.1 + historico refutado 5.2, coincide con onTagRead). requirements base R7/R8/R12 + requirements-09resto-dedup reconciliados con notas AS-BUILT finales. No quedan specs viejas mintiendo.

## Focos (respuesta puntual)
1. Spec-compliance: OK (intermedia solo BLE; 0 cand a CREATE directo fail-safe; assign a ficha; masiva contador/sale/no-rollback; re-escopeo nunca campo no-activo; dup lookupByTag antes de encolar; fail-CLOSED).
2. Multi-tenant: OK (todo scopeado al campo activo; cambio en vuelo manejado con establishmentIdRef + reset; count test excluye est-2).
3. Consistencia + manga: OK (CandidateRow masiva reusa el patron vetado de opcion A con chevron; cero hardcode; voseo).
4. Anti-stacking: OK (route-aware useSegments robusto; otras rutas el overlay funciona normal; cierra stale al entrar).
5. Calidad E2E: OK (5 escenarios de comportamiento; oraculo server waitForServerTagAssigned prueba la cadena real; espera first-sync; flag __RAFAQ_BLE_E2E__ aislado de produccion via isBleE2E, sin camino de usuario).
6. Sin regresion: OK (check.mjs exit 0 verificado por el reviewer; assign_tag 0089 verde; sin regresion en operaciones-rodeo/sync_streams/RLS).

## Cambios requeridos
Ninguno.
