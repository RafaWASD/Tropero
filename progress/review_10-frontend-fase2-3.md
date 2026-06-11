# Review — spec 10 base NO-UI del frontend (Fase 2 utils + Fase 3 services/hooks)

Reviewer: agente revisor. Fecha: 2026-06-11.
Baseline del diff: 95e3177. Reportes impl: progress/impl_10-frontend-fase2.md + progress/impl_10-frontend-fase3.md (ignorado el template caido impl_10-frontend-fase2-3.md).
Alcance: SOLO la base NO-UI (T-CL.1 a T-CL.13). Backend Fase 1 (0084/0085/0086) ya gateado+commiteado, NO re-revisado. Fase 4 (UI) fuera de alcance.

## Veredicto: APPROVED

---

## Verificacion que corri

- node scripts/check.mjs -> exit 0. Todas las suites verdes: typecheck client + client unit (con las 5 suites nuevas enganchadas) + RLS + Edge + Animal + Maneuvers + user_private + Import + Sync-streams + Operaciones-rodeo Fase 1 (22/22). Sin flake.
- Suites nuevas/tocadas (conteo directo verificado):
  - bulk-candidates 13/13 (coincide con el reporte)
  - bulk-selection 17/17
  - bulk-idempotency 15/15
  - bulk-operations-plan 16/16. El reporte de Fase 3 dice 17/17; el conteo REAL es 16 (todos verdes). Discrepancia menor de conteo, NO de cobertura. No bloqueante.
  - castration-copy 3/3
  - animal-category 75/75 (69 C6 previos intactos + 6 nuevos T-CL.7, cero regresion)
  - local-reads (+14 nuevos para los builders de spec 10, ejecucion real SQLite)
  - schema (+1 dedicado + GUARD COLUMNS_READ_BY_BUILDERS.animal_profiles += is_castrated/future_bull)
- UUIDv5 validado independientemente: reimplemente UUIDv5 con node:crypto (SHA-1 nativo) y compare contra el vector pineado -> uuidv5(DNS, www.example.com) = 2ed6657d-e927-568b-95e1-2665a8aea6a2 EXACTO. El SHA-1 puro del repo es correcto (no solo self-consistente). Los vectores FIPS 180-1 (vacio, abc, 56B, 64B) blindan el padding big-endian multi-bloque.

## Trazabilidad Rn <-> test (completa)

- R11.3 (castracion pre-tilda SOLO ternero + future_bull falso; estrella/adultos NO) -> bulk-selection.test SOLO terneros comunes + estrella NUNCA arranca tildado aunque sea el unico. OK
- R11.4 (destete pre-tilda TODOS) -> bulk-selection.test destete pre-tilda a TODOS. OK
- R11.2 (castracion = machos no-castrados ternero/torito/toro) -> bulk-candidates.test SOLO machos no castrados + is_castrated true NO candidato aunque code drift. OK
- R11.4 cand (destete = ternero/ternera sin weaning) -> bulk-candidates.test ambos sexos sin weaning. OK
- R7.2 (destete cross-rodeo: exclusion + contador) -> bulk-candidates.test excluye + cuenta + contador NO incluye ya-destetados. OK
- R4.1 (vacunacion todo + filtro cat/sexo) -> bulk-candidates.test default todos + filtros cat/sexo/AND/vacio. OK
- R3.5 (mellizos = c/u candidato) -> bulk-candidates.test mellizos cada uno. OK
- R6.1 (UUIDv5 deterministico, namespace congelado) -> bulk-idempotency.test vector RFC 4122 + FIPS + namespace CONGELADO pin + misma clave = mismo id. OK
- R6.2/R6.3 (excluir ya-procesados, re-ejecutar 0 nuevos, dedup intra-batch) -> bulk-idempotency.test filterNewEventKeys excluye + re-ejecutar = 0 nuevos + duplicadas colapsan. OK
- R3.1/R3.2 (vacunacion/destete = 1 INSERT/animal, UUIDv5, pre-config) -> bulk-operations-plan.test + local-reads.test builders. OK
- R3.3/R13.7 (castracion = EXACTAMENTE 2 CrudEntries: UPDATE is_castrated=1 + future_bull=0 + INSERT obs Castrado) -> bulk-operations-plan.test SIEMPRE 2 statements (totalStatements = 2 x N) + id obs distinto del UUIDv5 de evento + SQLite N=3. OK
- R10.2/R10.5 (batches ~100, fallo a mitad = exitosas persisten, fallidas reportadas, sin rollback) -> bulk-operations-plan.test batches default 100 + fallo a mitad por animal sin rollback + obs falla = UPDATE no re-ejecuta. OK
- R6.3 drain (re-intento NO duplica) -> bulk-operations-plan.test idempotencia filtro = drenado vacio (0 writes). OK
- R13.1/R13.4/R12.4 (setCastrated true=1+future_bull=0; false=solo 0; obs simetrica) -> local-reads.test buildSetCastratedUpdate(true/false) + SQLite real + castration-copy.test copy simetrico. OK
- R12.2 (setFutureBull solo future_bull, NO is_castrated, NO obs) -> local-reads.test sin is_castrated. OK
- R13.7 (obs sin author_id, establishment del PERFIL) -> local-reads.test NUNCA manda author_id + bulk-operations-plan.test SQLite (author_id IS NULL, est del perfil). OK
- R13.6/R10.6 (espejo con is_castrated REAL, precedencia + fallback) -> animal-category.test 6 nuevos T-CL.7: novillito/novillo offline + revert torito/toro + real GANA al code + SIN isCastrated = fallback + ternero no transiciona. OK
- R13.3/R12.1 (columnas declaradas en schema local) -> schema.test T-CL.12 animal_profiles declara is_castrated + future_bull + GUARD. OK

Backend Fase 1: R13.5/R12.x/R9.x cubiertos por la suite operaciones_rodeo (22/22, gateada+commiteada), fuera de re-revision.

## Tasks completas: SI

T-CL.1 a T-CL.13 todas [x] en tasks.md, con notas AS-BUILT detalladas. Cero [ ] sin justificar en el alcance. T-UI.* de Fase 4 son fase posterior, fuera de alcance.

## Foco-por-foco

1. Defaults de seleccion EXACTOS: OK. castrate pre-tilda terneros con futureBull distinto de true; estrella y adultos sin tildar (caso unico = estrella -> 0 tildados, testeado). Destete TODOS. El distinto-de-true (no igual-a-false) deja undefined defensivo SIN tildar.
2. Candidatos: OK. vacunacion base+filtro; castracion sex male && no castrado && categoria en {ternero,torito,toro}; destete {ternero,ternera} && no weaning + exclusion cross-rodeo con excludedByRodeoConfig. Drift testeado.
3. UUIDv5: OK. SHA-1 puro validado contra node:crypto (identico) + RFC 4122 + FIPS. BULK_EVENT_NAMESPACE congelado y pineado. Tipo primero en el name (no colision cross-tipo).
4. Planner: OK. castracion EXACTAMENTE 2 CrudEntries (totalStatements = 2 x N contra SQLite); evento 1 INSERT con UUIDv5; batches ~100; drainBulkPlan fallo a mitad = independencia (R10.2) + reporte por animal (R10.3) + no-duplicacion (plan vacio = 0 writes).
5. setCastrated/setFutureBull: OK. true => is_castrated=1, future_bull=0 + obs Castrado; false => solo is_castrated=0 + obs Correccion: marcado como no castrado (simetrico, NO toca future_bull); setFutureBull => 1 UPDATE SIN observacion.
6. Espejo C6 (T-CL.7): OK. computeDisplayOverrides usa r.isCastrated con fallback a inferIsCastrated(storedCode): el real (incl false) gana; solo null/undefined cae al fallback. Test de PRECEDENCIA explicito falla si cayera al fallback por error. 69 C6 intactos. animals.ts proyecta la columna en los 3 call-sites (lista/busqueda/detalle).
7. Schema PowerSync (T-CL.12): OK. is_castrated/future_bull declaradas (column.integer); proyectadas en LOCAL_LIST_SELECT (synced ap.is_castrated / overlay 0), detalle (synced is_castrated+future_bull / overlay 0,0), busqueda via buildSearchUnion. GUARD actualizado + test dedicado.
8. Service wrappers finos: OK. bulk-operations.ts resuelve existing-ids/establishments y delega TODA la decision al planner puro testeado, inyectando runLocalWrite + InteractionManager (yieldToUi tolerante). setCastrated/setFutureBull secuencias rectas de builders puros + runLocalWrite. NO hay logica no-testeada escondida. Genuinamente delgados.

## Exactitud de specs (codigo -> spec): reconciliado

design.md seccion 1.1 lista bulk-operations-plan.ts + castration-copy.ts como AS-BUILT (split puro/thin-service); seccion 4.4 documenta la proyeccion de columnas + el cableado del is_castrated real. tasks.md tiene notas AS-BUILT bajo cada T-CL. El design NO quedo mintiendo respecto del as-built. Sin contradiccion spec<->codigo pendiente.

## CHECKPOINTS
- C1 check.mjs exit 0: [x]
- C3 capas previstas (utils puros / services), sin hardcode de establishment_id (la observacion deriva el establishment del PERFIL, nunca del contexto activo), sin TODOs/debug sueltos: [x]
- C4 al menos 1 test por modulo con logica, fixtures reales (SQLite in-memory), runner mayor a 0 verde: [x]
- C6 feature sdd con specs/3 archivos, tasks [x], cada Rn con al menos 1 test: [x]
- C7 multi-tenant lado cliente: observacion valida establishment del perfil (no inventado); cross-tenant DB lo cubre la suite Fase 1 (T-DB.7): [x]
- C8 offline-first: todo CRUD plano local (runLocalWrite), sin requests sincronos, sube por uploadData: [x]
- C2/C5 estado/cierre de sesion: [ ] N/A a este chunk (lo cierra el leader; la feature NO se marco done).

## Checklist RAFAQ-especifico
- A (RLS / multi-tenancy): N/A en este chunk. El delta de tablas/RLS/triggers es Fase 1 (backend, ya gateado, suite operaciones_rodeo 22/22). El cliente no agrega tablas ni policies. La invariante client-side (author_id NUNCA en payload, establishment del perfil) esta testeada.
- B (offline-first): [x] funciona offline (CRUD plano runLocalWrite, sin requests sincronos a Supabase desde el planner/builders); scoped por la stream est_animal_profiles; conflict resolution = idempotencia por valor (castracion) + UUIDv5 deterministico (eventos) + independencia sin rollback (R10.2), documentada.
- C (BLE): N/A.
- D (UI de campo): N/A, chunk base NO-UI (targets/fonts/loading son Fase 4).
- E (Edge Functions): N/A, sin Edge Functions.

## Cambios requeridos (no bloqueantes)
- NIT (no bloqueante): el reporte impl_10-frontend-fase3.md afirma bulk-operations-plan 17/17; el conteo real es 16/16 (todos verdes). Corregir el numero en el reporte/current.md al cerrar para que la traza no quede inconsistente. NO afecta cobertura ni veredicto.

Razon del APPROVED: check.mjs verde, todas las tasks [x], cada Rn con al menos 1 test concreto, los 8 focos verificados, specs reconciliadas con el as-built. La unica observacion es un conteo de test mal transcrito en el reporte, cosmetico.
