# Tasks — LOTES OPERABLES (venta/descarte en tanda) — delta spec 02

> Delta-spec (ADR-028, Nivel B). Cubre `requirements-lotes-venta.md` (RLV.*) según `design-lotes-venta.md`.
> El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificar. Cada task cita los `RLV.n` que cubre.
> **Sin migración prevista** (loop client-side reusando `exit_animal_profile` 0044). Si el diseño cambiara a
> una RPC batch → agregar Fase 0 de migración (≥0123) + Gate 1 obligatorio antes de Puerta 1.

## Fase 1 — Lógica pura (sin I/O, node:test)

- [ ] **T1.1** — `services/exit-animal.ts`: extender el motivo a `culling` y agregar el mapping **Descarte**
  (`{ choice:'culling', status:'sold', exitReason:'culling', label:'Descarte', capturesSaleData:true }`).
  Exponer un set de la TANDA (Venta/Descarte/Muerte) SIN romper el set de 3 de la ficha (`app/animal/baja.tsx`).
  Cubre: RLV.4, RLV.4.1, RLV.4.2.
- [ ] **T1.2** — `services/exit-animal.ts`: `resolveEffectiveSaleData(...)` (override gana sobre común; nullable).
  Cubre: RLV.5.2, RLV.6.
- [ ] **T1.3** — `utils/batch-exit-selection.ts`: estado de selección del subconjunto (toggle por animal,
  seleccionar/deseleccionar todos, contador, ¿hay selección?). Cubre: RLV.3, RLV.3.1, RLV.3.2.
- [ ] **T1.4** — `services/powersync/local-reads.ts`: `buildSessionEmptyFemalesQuery(sessionId)` (reproductive_events
  synced + overlay `pending_reproductive_events`, `event_type='tacto'`, `pregnancy_status='empty'`, no borrado,
  DISTINCT por animal, unido a `animal_profiles` activos del establecimiento). Cubre: RLV.10.1.
- [ ] **T1.5** — Tests unit: `exit-animal.test.ts` (Descarte + `resolveEffectiveSaleData`),
  `batch-exit-selection.test.ts`, extender `local-reads.test.ts` (`buildSessionEmptyFemalesQuery`, incl. overlay
  y el filtro DISTINCT). Cubre: RLV.3, RLV.4.1, RLV.5.2, RLV.6, RLV.10.1.

## Fase 2 — Servicios (I/O: outbox + writes locales)

- [ ] **T2.1** — `exitAnimalsBatch(input)` (en `management-groups.ts` o nuevo `batch-exit.ts`): por animal
  seleccionado → `enqueueExitAnimal(...)` con su `(status, exit_reason)`, fecha común y precio/peso efectivo +
  `assignAnimalToGroup(profileId, null)`. Devuelve `{ ok, count }`; fail-closed en error de DB local; el rechazo
  server-side lo maneja la outbox. Cubre: RLV.7, RLV.7.1, RLV.8, RLV.9, RLV.9.1, RLV.22, RLV.23.
- [ ] **T2.2** — `fetchSessionEmptyFemales(sessionId)` (thin sobre `runLocalQuery(buildSessionEmptyFemalesQuery)`)
  → `{ profileId, hero }[]`. Cubre: RLV.10.1, RLV.10.2.
- [ ] **T2.3** — Test de servicio del loop `exitAnimalsBatch` (encola N intents `exit_animal_profile` + N clears
  de membresía; overlay optimista; fail-closed) sin red. Cubre: RLV.7, RLV.8, RLV.9.1, RLV.22.

## Fase 3 — UI: baja en tanda desde el lote

- [ ] **T3.1** — `app/lote/[id].tsx`: acción "Vender / Descartar" (visible con ≥1 activo) → **modo selección**
  (checkbox por `AnimalRow`, "seleccionar todos", contador) + CTA "Registrar salida (N)" (habilitado con ≥1).
  Navega a `app/lote/venta.tsx` con los `profileId`s + `groupId`. Cubre: RLV.2, RLV.3, RLV.3.1, RLV.3.2.
- [ ] **T3.2** — `app/lote/venta.tsx` (molde de `app/animal/baja.tsx`): paso 1 motivo (Venta/Descarte/Muerte);
  paso 2 fecha común (default hoy) + precio/peso comunes (motivos con `capturesSaleData`) + lista de N animales
  con override de precio/peso + resumen + aviso irreversibilidad + botón "Registrar salida" (guard anti
  doble-tap, disabled en vuelo). Al OK → `exitAnimalsBatch` → `router.back()` al lote. Cubre: RLV.4, RLV.5,
  RLV.5.1, RLV.5.2, RLV.6, RLV.6.1, RLV.17, RLV.18, RLV.19, RLV.20, RLV.21.1.
- [ ] **T3.3** — `app/lote/_components/BatchSaleAnimalRow.tsx` (opcional): fila con override de precio/peso
  (reusa `FormField` + sanitizadores). Cubre: RLV.6, RLV.6.1.

## Fase 4 — UI: sugerencia post-tacto de las vacías

- [ ] **T4.1** — `maniobra/identificar.tsx`: al cerrar la jornada, si la config incluyó tacto → calcular
  `emptyCount`/lista con `fetchSessionEmptyFemales(sessionId)` y pasarlos al `ExitJornadaSheet`. Cubre: RLV.10,
  RLV.10.2, RLV.15, RLV.20.
- [ ] **T4.2** — `ExitJornadaSheet.tsx`: en fase `'terminated'`, si `emptyCount > 0` mostrar la sugerencia
  saltable "Encontramos {N} vacías. ¿Agregarlas a un lote?" con "Elegir lote" / "Ahora no". Cubre: RLV.10,
  RLV.10.2, RLV.11.
- [ ] **T4.3** — `SugerenciaVaciasSheet.tsx` (molde de `LotePickerSheet`): lista de lotes del campo +
  "Crear lote nuevo" (default "Descarte"). Al elegir/crear → `assignAnimalToGroup` por cada vaca → confirmación
  → salir del flujo. Cubre: RLV.12, RLV.13, RLV.14, RLV.16, RLV.22, RLV.23.

## Fase 5 — E2E + Gate 2.5 (capturas)

- [ ] **T5.1** — Extender `app/e2e/lotes.spec.ts`: Vender/Descartar → selección de subconjunto → registrar
  salida → el lote queda con menos cabezas. Importar de `./helpers/fixtures`. Cubre: RLV.2, RLV.3, RLV.7, RLV.9.
- [ ] **T5.2** — `app/e2e/maniobra-lote.spec.ts` (o spec nuevo): terminar jornada con vacías → sugerencia →
  crear "Descarte" (y caso: elegir existente) → las vacías quedan en el lote; + caso "Ahora no" (saltar). Cubre:
  RLV.10, RLV.11, RLV.12, RLV.13, RLV.14.
- [ ] **T5.3** — Capturas Gate 2.5 (ADR-029): sugerencia post-tacto con conteo · lote con "Vender/Descartar" ·
  modo selección · form de venta (comunes + override) · post-venta (lote más chico). Cubre: veto visual.

## Fase 6 — Reconciliación de specs (regla dura, pre-Puerta 2)

- [ ] **T6.1** — Reconciliar al as-built cualquier ajuste de fix-loop/Gate 2 en
  `requirements-lotes-venta.md` / `design-lotes-venta.md` / este `tasks-lotes-venta.md` (nota bajo el `RLV.n`
  afectado; no reescribir EARS por gusto).
- [ ] **T6.2** — Al cerrar (Puerta 2), el leader folda al baseline `design.md` un puntero + nota as-built bajo
  los `R<n>` de lotes/baja afectados y agrega la fila `lotes-venta` a la tabla "Deltas posteriores" (NO lo toca
  el spec_author ni el implementer).
