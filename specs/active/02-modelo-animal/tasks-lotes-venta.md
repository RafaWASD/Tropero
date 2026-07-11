# Tasks — LOTES OPERABLES (venta/descarte en tanda) — delta spec 02

> Delta-spec (ADR-028, Nivel B). Cubre `requirements-lotes-venta.md` (RLV.*) según `design-lotes-venta.md`.
> El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificar. Cada task cita los `RLV.n` que cubre.
> **Sin migración prevista** (loop client-side reusando `exit_animal_profile` 0044). Si el diseño cambiara a
> una RPC batch → agregar Fase 0 de migración (≥0123) + Gate 1 obligatorio antes de Puerta 1.

## Fase 1 — Lógica pura (sin I/O, node:test)

- [x] **T1.1** — `services/exit-animal.ts`: exponer el set de motivos de la TANDA `BATCH_EXIT_MAPPINGS` =
  subconjunto **Venta / Muerte** de `EXIT_REASON_MAPPINGS` (`sale`→`sold`/`sale`, `death`→`dead`/`death`), **sin
  agregar `culling` ni tocar `ExitReasonChoice`** (decisión "Venta simple" de Raf, Puerta 1), sin romper el set
  de 3 de la ficha (`app/animal/baja.tsx`). Cubre: RLV.4, RLV.4.1, RLV.4.2. — As-built: DERIVADO por `.filter`
  de `EXIT_REASON_MAPPINGS` (fuente única, no reescrito) + `batchExitReasonToStatus`/`isBatchExitChoice`.
- [x] **T1.2** — `services/exit-animal.ts`: `resolveEffectiveSaleData(...)` (override gana sobre común; nullable).
  Cubre: RLV.5.2, RLV.6.
- [x] **T1.3** — `utils/batch-exit-selection.ts`: estado de selección del subconjunto (toggle por animal,
  seleccionar/deseleccionar todos, contador, ¿hay selección?). Cubre: RLV.3, RLV.3.1, RLV.3.2. — + `resolveSelectedIds`
  (descarta ids que ya no son miembros, RLV.21.1).
- [x] **T1.4** — `services/powersync/local-reads.ts`: `buildSessionEmptyFemalesQuery(sessionId)` (`reproductive_events`,
  `event_type='tacto'`, `pregnancy_status='empty'`, no borrado, DISTINCT por animal, unido a `animal_profiles`
  activos). Cubre: RLV.10.1. — **RECONCILIADO: SIN overlay UNION** (el tacto de manga es CRUD-plano a la tabla
  synced → ya está local; `pending_reproductive_events` solo tiene partos, nunca un tacto `empty`). Ver RLV.10.1.
- [x] **T1.5** — Tests unit: `exit-animal.test.ts` (`BATCH_EXIT_MAPPINGS` = Venta/Muerte sin culling +
  `resolveEffectiveSaleData`), `batch-exit-selection.test.ts`, extender `local-reads.test.ts`
  (`buildSessionEmptyFemalesQuery`, SQL sin overlay + comportamiento DISTINCT sobre node:sqlite). Cubre: RLV.3,
  RLV.4.1, RLV.5.2, RLV.6, RLV.10.1.

## Fase 2 — Servicios (I/O: outbox + writes locales)

- [x] **T2.1** — `exitAnimalsBatch(input)` (nuevo **`services/batch-exit.ts`**): por animal seleccionado →
  `enqueueExitAnimal(...)` con su `(status, exit_reason)`, fecha común y precio/peso efectivo +
  `assignAnimalToGroup(profileId, null)`. Devuelve `{ ok, count }`; fail-closed en error de DB local; el rechazo
  server-side lo maneja la outbox. Cubre: RLV.7, RLV.7.1, RLV.8, RLV.9, RLV.9.1, RLV.22, RLV.23. — As-built: la
  lógica del loop es PURA en **`utils/batch-exit-plan.ts`** (`planBatchExit` + `runBatchExit` con deps inyectadas);
  `services/batch-exit.ts` es el thin wrapper que pasa `enqueueExitAnimal`/`assignAnimalToGroup` reales.
- [x] **T2.2** — `fetchSessionEmptyFemales(sessionId)` (thin sobre `runLocalQuery(buildSessionEmptyFemalesQuery)`,
  en `services/sessions.ts`) → `{ profileId, hero }[]`. Cubre: RLV.10.1, RLV.10.2.
- [x] **T2.3** — Test del loop `runBatchExit` con deps FAKE (encola N + limpia N membresías, orden enqueue→clear,
  fail-closed) + `planBatchExit` (params por animal, Muerte fuerza null, override gana) sin red — `batch-exit-plan.test.ts`.
  Cubre: RLV.7, RLV.8, RLV.9.1, RLV.22.

## Fase 3 — UI: baja en tanda desde el lote

- [x] **T3.1** — `app/lote/[id].tsx`: acción "Vender / Descartar" (visible con ≥1 activo) → **modo selección**
  (checkbox por `AnimalRow`, "seleccionar todos", contador) + CTA "Registrar salida (N)" (habilitado con ≥1).
  Navega a `app/lote/venta.tsx` con los `profileId`s + `groupId`. Cubre: RLV.2, RLV.3, RLV.3.1, RLV.3.2. —
  As-built: reset del modo selección al re-enfocar (volver de `venta.tsx`) → la vista queda en modo normal con
  menos cabezas.
- [x] **T3.2** — `app/lote/venta.tsx` (molde de `app/animal/baja.tsx`): paso 1 motivo (Venta/Muerte);
  paso 2 fecha común (default hoy) + precio/peso comunes (motivos con `capturesSaleData`) + lista de N animales
  con override de precio/peso + resumen + aviso irreversibilidad + botón "Registrar salida" (guard anti
  doble-tap, disabled en vuelo). Al OK → `exitAnimalsBatch` → `router.back()` al lote. Cubre: RLV.4, RLV.5,
  RLV.5.1, RLV.5.2, RLV.6, RLV.6.1, RLV.17, RLV.18, RLV.19, RLV.20, RLV.21.1. — As-built: la lista operable se
  arma de `fetchGroupMembers` ∩ profileIds recibidos (anti-IDOR, RLV.21.1); ruta registrada en `app/_layout.tsx`.
- [x] **T3.3** — `app/lote/_components/BatchSaleAnimalRow.tsx`: fila expandible con override de precio/peso
  (reusa `FormField` + sanitizadores; placeholder hinta el común). Cubre: RLV.6, RLV.6.1.

## Fase 4 — UI: sugerencia post-tacto de las vacías

- [x] **T4.1** — `maniobra/identificar.tsx`: al abrir el sheet de salida, si la config incluyó tacto → calcular
  `emptyCount`/lista con `fetchSessionEmptyFemales(sessionId)` + los lotes del campo, y pasarlos al
  `ExitJornadaSheet`. Cubre: RLV.10, RLV.10.2, RLV.15, RLV.20.
- [x] **T4.2** — `ExitJornadaSheet.tsx`: en fase `'terminated'`, si `emptyCount > 0` mostrar la sugerencia
  saltable "Encontramos {N} vacías. ¿Agregarlas a un lote?" con "Elegir lote" / "Ahora no". Cubre: RLV.10,
  RLV.10.2, RLV.11.
- [x] **T4.3** — `SugerenciaVaciasSheet.tsx` (molde de `LotePickerSheet`): lista de lotes del campo +
  "Crear lote nuevo" (default "Descarte"). Al elegir/crear → `assignAnimalToGroup` por cada vaca → confirmación
  → salir del flujo. Cubre: RLV.12, RLV.13, RLV.14, RLV.16, RLV.22, RLV.23. — As-built: PRESENTACIONAL (el
  caller persiste); "Crear lote nuevo" gateado a owner (`canCreate`, RLS 0037) — ver reconciliación de RLV.13.

## Fase 5 — E2E + Gate 2.5 (capturas)

- [x] **T5.1** — Extender `app/e2e/lotes.spec.ts`: Vender/Descartar → selección de subconjunto → registrar
  salida → el lote queda con menos cabezas + oráculo server (archivado sold, sin lote; el no-seleccionado
  intacto). Importa de `./helpers/fixtures`. Cubre: RLV.2, RLV.3, RLV.7, RLV.9. — **NO ejecutado** (Gate 2.5, leader).
- [x] **T5.2** — `app/e2e/maniobra-vacias-lote.spec.ts` (spec NUEVO): terminar jornada con vacías → sugerencia →
  crear "Descarte" (+ caso elegir existente) → las vacías quedan en el lote; + caso "Ahora no" (saltar). Cubre:
  RLV.10, RLV.11, RLV.12, RLV.13, RLV.14. — **NO ejecutado** (Gate 2.5, leader).
- [ ] **T5.3** — Capturas Gate 2.5 (ADR-029): sugerencia post-tacto con conteo · lote con "Vender/Descartar" ·
  modo selección · form de venta (comunes + override) · post-venta (lote más chico). Cubre: veto visual. — **LEADER.**

## Fase 6 — Reconciliación de specs (regla dura, pre-Puerta 2)

- [x] **T6.1** — Reconciliado al as-built en `requirements-lotes-venta.md` (RLV.10.1 sin overlay; RLV.13 create
  owner-only) / `design-lotes-venta.md` (§4.1 split pure/io; §4.2 sin overlay UNION + owner-gating) / este
  `tasks-lotes-venta.md` (tasks `[x]` + notas as-built). Sin reescribir EARS.
- [ ] **T6.2** — Al cerrar (Puerta 2), el leader folda al baseline `design.md` un puntero + nota as-built bajo
  los `R<n>` de lotes/baja afectados y agrega la fila `lotes-venta` a la tabla "Deltas posteriores" (NO lo toca
  el spec_author ni el implementer). — **LEADER.**
