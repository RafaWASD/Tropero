# Review — spec 10 chunk UI-C: la FICHA del animal (T-UI.7 + T-UI.8)

**Veredicto: APPROVED**

- Reviewer: reviewer (Gate post-implementer).
- Fecha: 2026-06-12.
- Baseline: 55e25b56c97492df7b486a0363619584675ebc98 (== HEAD; cambios sin commitear en working tree, documentado en el impl report).
- Alcance: frontend puro. app/app/animal/[id].tsx + animal-category.ts (util puro nuevo) + services (animals.ts, events.ts, local-reads.ts, event-timeline.ts) + sus tests + reconciliacion de specs (design/tasks) + capturas. SIN migraciones, SIN connector, SIN schema.ts, SIN E2E (proximo chunk).
- node scripts/check.mjs: exit 0 (verde, incl. supabase LIVE de spec 10/15 sin flake; unit lint OK).
- Unit de los 3 archivos afectados: 263 verdes (animal-category.test.ts +8 de resolveCastrationTargetCategory, event-timeline.test.ts +createdBy, local-reads.test.ts +3 soft-delete).
- Gate 2 (security, modo code): PASS 0 HIGH (progress/security_code_10-ui-c.md).
- Design-review visual del leader: PASS (design/spec10-ui-c/).

## Trazabilidad R <-> test (este chunk)

| R<n> | Test concreto | Estado |
|---|---|---|
| R13.1 (castrado editable + anticipa recalculo) | animal-category.test.ts resolveCastrationTargetCategory: castrar torito->novillito, toro->novillo, revert simetrico, ternero no transiciona, override->null, sin catalogo->null, destete adelanta (8 tests) + UI CastrationRow/previewCastrationCategory (captura ficha-macho-confirmar.png) | OK |
| R13.2 (sin evento tipado, observacion) | castration-copy.test.ts (copy) + local-reads.test.ts (buildAddObservationInsert NUNCA manda author_id) heredado T-CL.13 Fase 3; el flip aparece como observacion, no evento tipado | OK |
| R13.7 (observacion automatica) | setCastrated encadena buildAddObservationInsert (reuso Fase 3 testeado T-CL.13) | OK |
| R12.2 (futuro torito toggle solo ficha) | FutureBullRow/setFutureBull (UI, captura ficha-macho-manejo.png); buildSetFutureBullUpdate sin observacion (local-reads.test.ts) | OK |
| R12.3 (badge solo positivo + oculto en toro) | shouldShowFutureBullBadge (AnimalRow.tsx:114-117) reusado en FutureBullRow | OK |
| R4.5 (correccion individual de eventos) | local-reads.test.ts buildSoftDeleteEventUpdate (SQL + ejecucion SQLite in-memory: borra deleted_at + idempotente) + DELETABLE_EVENT_TABLE whitelist (positivo+negativo); event-timeline.test.ts createdBy (presencia+ausencia); UI deleteTypedEvent/canDeleteEvent/DeletableTimelineEvent | OK |
| Solo-machos (invariante) | captura ficha-hembra-sin-manejo.png + guarda detail.sex==='male' ([id].tsx:510) | OK |

Cada R de este chunk tiene >=1 test concreto. Sin huerfanos.

## Tasks completas: SI (las de este chunk)

- T-UI.7 [x] seccion Manejo solo-machos + CastrationRow (confirma anticipa recalculo) + FutureBullRow.
- T-UI.8 [x] DeletableTimelineEvent + deleteTypedEvent + buildSoftDeleteEventUpdate.
- Pendientes [ ] que NO son de este chunk (justificados): T-G1.2 (re-gate LIM-2 leader-owned), T-UI.9/10/11 (E2E, chunk posterior). No bloquean el cierre de UI-C.

## Foco verificado punto por punto

1. Solo-machos OK: {detail.sex === 'male' ? <ManagementSection/> : null} ([id].tsx:510-521). Para hembras ni se monta. Captura ficha-hembra-sin-manejo.png lo asevera.
2. Anticipacion sin duplicar el espejo OK: resolveCastrationTargetCategory (animal-category.ts:390-414) llama a computeCategoryCode (el espejo C6) con isCastrated: args.nextCastrated. Cero re-implementacion. Destinos correctos: torito->novillito (>=1ano), toro->novillo (>=2anos); revert simetrico. Tests cubren ambas direcciones + override + fail-safe.
3. Castrado toggle -> setCastrated OK: buildSetCastratedUpdate(true) = is_castrated=1, future_bull=0 (R12.4 auto-clear); (false) = solo is_castrated=0. Encadena buildAddObservationInsert. author_id NUNCA en el payload (buildAddObservationInsert solo manda id/profile/establishment/text, local-reads.ts:1170-1180; el trigger 0034 lo fuerza). Invariante Fase 3 intacta, no reintroducida. El flip es observacion, no evento tipado (D10).
4. Toggle futuro torito -> setFutureBull OK: UN UPDATE de future_bull, sin observacion. Badge oculto si toro via shouldShowFutureBullBadge (categoryCode !== 'toro'). La fila se oculta ademas si isCastrated.
5. T-UI.8 borrado de eventos OK:
   - Soft-delete: UPDATE table SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL (idempotente).
   - WHITELIST cerrado: DELETABLE_EVENT_TABLE = const de 2 entradas; table es union literal; kind viene del literal del SQL del timeline, no de input. Sin SQL injection por nombre de tabla. No permite borrar tablas arbitrarias.
   - Gating de cliente best-effort (canDeleteEvent: solo vacunacion/destete activos + owner|autor); el cliente NO asume autorizacion propia, el control real es la RLS UPDATE server-side (is_owner_of OR created_by=auth.uid(), spec 02).
   - Recalculo al borrar weaning: lo dispara el trigger 0046 server-side (AFTER UPDATE OF deleted_at sobre reproductive_events); vaccination no transiciona -> no recalcula. Correcto.
   - created_by proyectado en buildTimelineQuery -> TimelineItem.createdBy -> alimenta el gating owner|autor. Parser testeado (presencia + null).
6. No-regresion de la ficha OK: identificacion/datos/lote/timeline/baja intactos (solo se inyecto la seccion Manejo + el wrapper DeletableTimelineEvent en el map del timeline, condicionado por canDeleteEvent; el resto cae al TimelineEvent canonico sin tocar su contrato). El created_by nuevo en buildTimelineQuery es una columna json_object adicional; el parser lo lee con str(p,'created_by') -> null si ausente -> no rompe consumidores. Schema/GUARD no afectado (no se toco schema.ts en este chunk).

## CHECKPOINTS

- C2 (estado coherente): [x]
- C3 (arquitectura): [x] capas respetadas; UI en app/, util puro en utils/, I/O en services/; componentes sin fetch directo; sin hardcode de establishment_id; sin logs/TODOs sueltos; tokens/iconos (ADR-023).
- C4 (verificacion real): [x] >=1 test por modulo con logica; fixtures reales + ejecucion SQLite in-memory para el soft-delete; runner >0 verde.
- C6 (SDD): [x] 3 archivos de spec; tasks del chunk en [x]; cada R con >=1 test; design.md reconciliado al as-built (AS-BUILT UI-C 1.1, T-UI.7/T-UI.8); requirements.md no contradice. No queda spec vieja mintiendo.
- C7 (multi-tenant): N/A reforzado, frontend puro; el aislamiento lo enforce la RLS server-side existente; el cliente deriva establishment_id del PERFIL.
- C8 (offline-first): [x] CRUD plano local; espejo C6 refleja al instante; RLS al subir.

## Checklist RAFAQ-especifico

- A. Multi-tenancy / RLS: N/A (no toca tablas ni policies; frontend puro). El borrado se apoya en la RLS UPDATE owner|autor as-built.
- B. Offline-first: aplica.
  - [x] Funciona offline (CRUD plano -> SQLite -> upload queue).
  - [x] Sync set correcto (animal_profiles, animal_events, reproductive/sanitary_events en sync-streams/rafaq.yaml).
  - [x] Conflictos: last-write-wins por valor (UPDATE idempotente; observacion+UPDATE independientes, residual aceptado documentado R10.2).
  - [x] No hace requests sincronos a Supabase desde la pantalla; usa services que tocan SQLite local.
- C. BLE: N/A.
- D. UI de campo: aplica.
  - [x] Targets tactiles >=$touchMin (56dp) en los CTA (minHeight="$touchMin"); links con hitSlop=8.
  - [x] Fuente legible (estado $5, labels $3, patron as-built).
  - [x] Una decision por interaccion (confirmacion inline castrado / toggle / confirmacion inline borrar).
  - [x] Estado de loading visible (Guardando/Quitando/Borrando + disabled; busy no se resetea en exito para evitar parpadeo).
- E. Edge Functions: N/A.

## Cambios requeridos

Ninguno.
