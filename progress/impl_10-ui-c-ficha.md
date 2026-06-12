baseline_commit: 55e25b56c97492df7b486a0363619584675ebc98

# impl spec 10 — chunk UI-C: la FICHA del animal (T-UI.7 + T-UI.8)

Feature: spec 10 operaciones-rodeo, chunk UI-C (Fase 4 parcial). in_progress.
Toca SOLO `app/app/animal/[id].tsx` (+ proyección de `created_by` en el timeline para gatear el borrado, + un util puro nuevo para el destino de categoría del toggle castrado). NADA de masivas ni E2E.

## Plan (este chunk)
- T-UI.7 — Castrado (estado) + Futuro torito (en la ficha)
  - Fila "Castrado Sí/No" SOLO machos, con confirmación que ANTICIPA el recálculo (espejo C6, mismo patrón que CategoryOverrideCard) → `setCastrated(profileId, value)`.
  - Toggle ⭐ "Futuro torito" SOLO machos, badge solo si positivo + oculto si `toro` (reusa `shouldShowFutureBullBadge`) → `setFutureBull(profileId, value)`.
  - Al refrescar tras castrar, `future_bull` se auto-limpia (server) → reflejar (no mostrar ⭐).
- T-UI.8 — Corrección individual de eventos (vacunación/destete) desde el timeline
  - Investigación spec 02 R6.8.1: server-side ya soporta soft-delete por owner|autor + recálculo (0046). NO existe edit/delete en la ficha as-built (TimelineEvent es display-only).
  - Implementar el MÍNIMO: borrar (soft-delete) un evento de vacunación/destete desde su nodo del timeline, gated por owner|autor.

## Util puro nuevo
- `app/src/utils/castration-toggle.ts` (PURO): resuelve el NOMBRE de la categoría DESTINO al flipear is_castrated (espejo C6 con el valor nuevo), para la confirmación que anticipa el recálculo (R13.1). Mismo patrón que `resolveRevertCategory` pero con el is_castrated invertido. Testeado.

## Investigación T-UI.8 (spec 02 R6.8.1) — qué YA existe
- Server-side COMPLETO: `sanitary_events`/`reproductive_events` tienen `deleted_at`; RLS UPDATE = `is_owner_of(...) OR created_by = auth.uid()` (owner|autor); soft-delete de `reproductive_events` (incl. `weaning`) dispara recálculo de categoría (0046, AFTER UPDATE OF deleted_at). `vaccination` no transiciona → su borrado no recalcula (correcto).
- Cliente: NO existe edit/delete de eventos en la ficha. `TimelineEvent` es display-only. → cerré el gap con el MÍNIMO = BORRADO (soft-delete), NO edición (alcance MVP del chunk).

## DONE — archivos tocados
- `app/app/animal/[id].tsx` — `ManagementSection`/`CastrationRow`/`FutureBullRow` (T-UI.7) + `DeletableTimelineEvent` + gating/handlers de borrado (T-UI.8). Sección "Manejo" solo-machos.
- `app/src/utils/animal-category.ts` — **función PURA nueva** `resolveCastrationTargetCategory` (anticipa el destino del flip; respeta override).
- `app/src/services/animals.ts` — service `previewCastrationCategory` (orquesta I/O, reusa el espejo C6).
- `app/src/services/events.ts` — service `deleteTypedEvent` (soft-delete owner|autor).
- `app/src/services/powersync/local-reads.ts` — `buildSoftDeleteEventUpdate` + `DELETABLE_EVENT_TABLE` + `created_by` proyectado en `buildTimelineQuery` (reproductive/sanitary).
- `app/src/utils/event-timeline.ts` — `TimelineItem.createdBy` (reproductive/sanitary) + parser.
- Tests: `animal-category.test.ts` (+8), `event-timeline.test.ts` (+2), `local-reads.test.ts` (+3 incl. SQLite in-memory).
- Capturas: `design/spec10-ui-c/{ficha-macho-manejo,ficha-macho-confirmar,ficha-hembra-sin-manejo}.png` + harness `e2e/captures/spec10-uic-screenshots.capture.ts`.

## Reuso (cero re-implementación)
- `setCastrated`/`setFutureBull` (Fase 3), `shouldShowFutureBullBadge` (AnimalRow), espejo C6 `computeCategoryCode` (para la anticipación), patrón `CategoryOverrideCard`/`previewRevertCategory` (confirmación inline + preview), `TimelineEvent` canónico (envuelto SIN tocar), `addObservation`/`buildAddObservationInsert` (vía setCastrated).

## Reconciliación de specs (as-built)
- `tasks.md` T-UI.7/T-UI.8 → [x] con bloque AS-BUILT.
- `design.md §1.1` → bloque AS-BUILT chunk UI-C.
- `requirements.md` NO cambia: R13.1/R13.2/R13.7/R12.2/R12.3/R4.5 se cumplen tal cual (R4.5 nombra "editar/soft-deletear" → el borrado es el subconjunto implementado; sin contradicción).

## Trazabilidad R → test/archivo
- R13.1 (castrado editable + anticipa recálculo) → `resolveCastrationTargetCategory` tests (animal-category.test.ts) + `CastrationRow`/`previewCastrationCategory` (UI, capturas ficha-macho-confirmar.png).
- R13.2 (sin evento tipado, observación) → `setCastrated` Fase 3 (encadena observación; testeado en T-CL.13) reusado por `onSetCastrated`.
- R13.7 (observación automática) → idem (Fase 3, reusado).
- R12.2 (futuro torito toggle solo ficha) → `FutureBullRow`/`setFutureBull` (UI, capturas ficha-macho-manejo.png).
- R12.3 (badge solo positivo + oculto en toro) → `shouldShowFutureBullBadge` reusado (test en AnimalRow/animal-row).
- R4.5 (corrección individual de eventos) → `buildSoftDeleteEventUpdate`+`DELETABLE_EVENT_TABLE` tests (local-reads.test.ts) + `deleteTypedEvent`/`canDeleteEvent`/`DeletableTimelineEvent` (UI).
- Solo-machos → capturas ficha-hembra-sin-manejo.png (assert toHaveCount(0) en el harness).

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
- **Desviación del spec (T-UI.8 "editable/borrable")**: implementé solo BORRADO, no edición. R4.5 nombra "editar/soft-deletear" → el borrado satisface el caso de corrección (un evento mal cargado se borra y se vuelve a cargar). Documentado como alcance MVP + reconciliado en design/tasks. NO es una desviación silenciosa.
- **Inyección SQL en `buildSoftDeleteEventUpdate(${table})`**: `table` es de tipo union literal y se resuelve SOLO vía `DELETABLE_EVENT_TABLE[kind]` (const de 2 valores), nunca de input crudo. Sin riesgo. Documentado.
- **author_id en la observación**: `setCastrated` (reusado) NO manda author_id (lo fuerza el server). Invariante de Fase 3, intacta — no la toqué.
- **⭐ en un `toro` entero**: el toggle se OFRECE (R12.2 solo dice "machos", no excluye toro) pero el badge se OCULTA (R12.3). Decisión: mantener el toggle disponible para poder LIMPIAR un future_bull colgado en un toro (R12.3 es display, R12.2 es edición — independientes). El texto "Sí/No" refleja el estado real; el badge es solo señal visual.
- **future_bull auto-clear al castrar**: la fila ⭐ se oculta con `!isCastrated` → tras castrar (recarga) desaparece; el server lo limpia (R12.4). Consistente.
- **created_by NULL local (evento offline propio)**: edge case → el autor no-owner no ve el botón borrar hasta el sync-down. Best-effort (la RLS lo permitiría). Limitación de UX documentada, NO de seguridad (el gating real es server-side).
- **Tests que pasan por la razón equivocada**: los tests de `buildSoftDeleteEventUpdate` ejercitan el path real (ejecución SQLite in-memory: borra la fila viva [changes=1] + re-borrar es no-op [changes=0] = idempotencia real, no mockeada). `resolveCastrationTargetCategory` testea ambas direcciones + override→null + fail-safe. El parser de createdBy testea presencia Y ausencia (null).
- **Edge: destino==actual (ternero)**: `onPreviewCastration` compara `r.value.code === detail.categoryCode` → null → la UI no muestra una "consecuencia" que no cambia nada (el flip + observación se aplican igual). Test `resolveCastrationTargetCategory` cubre que el destino de un ternero castrado sigue ternero.

## Verificación
- `pnpm typecheck` verde. `node scripts/check.mjs` exit 0 (Entorno listo). Anti-hardcode 0 violaciones. Unit tests: 263 verdes en los 3 archivos afectados; suite completa verde.
- NO toqué connector ni migraciones. NADA de masivas ni E2E (próximo chunk). NO marqué la feature done.
