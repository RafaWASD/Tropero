baseline_commit: 42f76c5dcb1de7262aab439c31feed8fe137b39e

# Bitácora — LOTES OPERABLES (venta/descarte en tanda) — delta spec 02 (feature A)

> Delta-spec ADR-028 Nivel B. Frontend puro (Gate 1 N/A, sin migración, sin RPC nueva). Puerta 1 APROBADA.
> Baja en tanda = LOOP CLIENT-SIDE de `exit_animal_profile` (0044) vía outbox (`enqueueExitAnimal`) N veces
> + clear de membresía por animal. Sugerencia post-tacto de vacías (elegir/crear lote). **NO toca `supabase/`.**

## Estado: COMPLETO (listo para reviewer / Gate 2 / Gate 2.5). Tasks T1.1–T5.2 + T6.1 marcadas [x]. T5.3 + T6.2 = leader.

## Archivos

### Creados
- `app/src/utils/batch-exit-selection.ts` — estado PURO de la selección del subconjunto (toggle, todos, contador, `resolveSelectedIds`). T1.3.
- `app/src/utils/batch-exit-selection.test.ts` — tests (RLV.3/3.1/3.2/21.1).
- `app/src/utils/batch-exit-plan.ts` — lógica PURA del loop: `planBatchExit` (params por animal) + `runBatchExit` (loop con deps inyectadas, fail-closed). T2.1 (núcleo).
- `app/src/utils/batch-exit-plan.test.ts` — tests con deps FAKE (RLV.7/8/9.1/22 + planificación). T2.3.
- `app/src/services/batch-exit.ts` — `exitAnimalsBatch(input)` (thin wrapper I/O: pasa `enqueueExitAnimal`/`assignAnimalToGroup` reales). T2.1 (I/O).
- `app/app/lote/venta.tsx` — pantalla de baja en tanda (2 pasos). T3.2.
- `app/app/lote/_components/BatchSaleAnimalRow.tsx` — fila con override de precio/peso. T3.3.
- `app/app/maniobra/_components/SugerenciaVaciasSheet.tsx` — picker de lote para las vacías. T4.3.
- `app/e2e/maniobra-vacias-lote.spec.ts` — E2E sugerencia (crear/elegir/Ahora no). T5.2. **NO ejecutado.**

### Modificados
- `app/src/services/exit-animal.ts` — `BATCH_EXIT_MAPPINGS` (subconjunto Venta/Muerte por `.filter`), `batchExitReasonToStatus`, `isBatchExitChoice`, `resolveEffectiveSaleData`. T1.1/T1.2.
- `app/src/services/exit-animal.test.ts` — tests de lo anterior. T1.5.
- `app/src/services/powersync/local-reads.ts` — `buildSessionEmptyFemalesQuery` (SIN overlay, reconciliado). T1.4.
- `app/src/services/powersync/local-reads.test.ts` — SQL + comportamiento node:sqlite. T1.5.
- `app/src/services/sessions.ts` — `fetchSessionEmptyFemales` (+ tipo `SessionEmptyFemale`). T2.2.
- `app/app/lote/[id].tsx` — acción "Vender / Descartar" + modo selección + reset on-focus. T3.1.
- `app/app/maniobra/_components/ExitJornadaSheet.tsx` — sugerencia en fase 'terminated' (`emptyCount`/`onElegirLote`). T4.2.
- `app/app/maniobra/identificar.tsx` — cálculo de vacías + lotes al abrir el sheet; handlers elegir/crear+asignar. T4.1.
- `app/app/_layout.tsx` — registro de la ruta `lote/venta`.
- `app/e2e/lotes.spec.ts` — E2E venta en tanda (subconjunto → menos cabezas + oráculo server). T5.1. **NO ejecutado.**
- `app/e2e/helpers/ui.ts` — `gotoLoteGroup` helper.
- `scripts/run-tests.mjs` — registra `batch-exit-selection.test.ts` + `batch-exit-plan.test.ts` en la suite unit.
- Specs reconciliadas: `requirements-lotes-venta.md`, `design-lotes-venta.md`, `tasks-lotes-venta.md`. T6.1.

## Decisiones de criterio propio (as-built)

1. **Split pure/io del loop.** `exitAnimalsBatch` (I/O, importa el SDK → no carga bajo node:test) es un thin
   wrapper sobre `planBatchExit`+`runBatchExit` (PUROS, deps inyectadas). Así el loop (N encolas + N clears,
   orden, fail-closed) se testea con fakes sin red — mismo patrón `exit-animal.ts`↔`animals.ts`.
2. **`buildSessionEmptyFemalesQuery` SIN overlay UNION.** El plan/spec preveía UNION a
   `pending_reproductive_events`. As-built NO: un tacto de manga es CRUD-plano a la tabla synced
   `reproductive_events` → ya está local (offline-first cumplido); el overlay solo tiene partos (`birth`,
   pregnancy_status NULL), nunca un tacto `empty` → UNION sería dead code. Reconciliado (RLV.10.1, design §4.2).
3. **"Crear lote nuevo" (RLV.13) gateado a OWNER.** RLS 0037 `management_groups_insert = is_owner_of`. Un
   no-owner que crease "Descarte" dejaría un INSERT rechazado al subir + la asignación de las vacías colgando
   (FK a lote inexistente). Un no-owner solo elige existentes (RLV.12, cualquier rol). Reconciliado (RLV.13).
4. **Clear de membresía por animal** (`assignAnimalToGroup(id, null)`, RLV.9.1) además de la baja, para que
   "dejan el lote" sea literal (§2.3 del design). Trigger 0037 early-return con NULL → válido sobre archivado.
5. **Anti-IDOR de la tanda (RLV.21.1):** `venta.tsx` arma la lista operable de `fetchGroupMembers` (RLS-scopeado)
   ∩ los profileIds recibidos → un id ajeno/tampereado que no sea miembro se descarta. El RPC re-valida por-llamada.
6. **Reset del modo selección al re-enfocar el lote** (volver de `venta.tsx`) → vista normal con menos cabezas.
7. **E2E de la sugerencia en spec NUEVO** (`maniobra-vacias-lote.spec.ts`, no folded en maniobra-lote.spec.ts):
   es un flujo de TACTO, separado del lote-opcional-desde-el-resumen (pesaje) de maniobra-lote.

## Trazabilidad RLV → test

| RLV | Test |
|---|---|
| RLV.2, RLV.3, RLV.3.1, RLV.3.2 | `batch-exit-selection.test.ts` (selección) + `lotes.spec.ts` (E2E Vender/Descartar → selección) |
| RLV.4, RLV.4.1, RLV.4.2 | `exit-animal.test.ts` (BATCH_EXIT_MAPPINGS Venta/Muerte sin culling) + `batch-exit-plan.test.ts` (motivo inválido → plan vacío) |
| RLV.5.1 | `batch-exit-plan.test.ts` (fecha común a todos) |
| RLV.5.2, RLV.6 | `exit-animal.test.ts` (resolveEffectiveSaleData) + `batch-exit-plan.test.ts` (override gana / Muerte fuerza null) |
| RLV.6.1 | reuso `validateExitPrice/Weight` (ya testeados) — validación en `venta.tsx` |
| RLV.7, RLV.7.1 | `batch-exit-plan.test.ts` (runBatchExit encola N + clears N) + `lotes.spec.ts` (oráculo server sold) |
| RLV.8 | `batch-exit-plan.test.ts` (fail-closed enqueue/clear) |
| RLV.9, RLV.9.1 | `batch-exit-plan.test.ts` (clear por animal) + `lotes.spec.ts` (E2E: archivado sin lote, no-seleccionado intacto) |
| RLV.10, RLV.10.2 | `maniobra-vacias-lote.spec.ts` (sugerencia con conteo) |
| RLV.10.1 | `local-reads.test.ts` (buildSessionEmptyFemalesQuery: SQL + DISTINCT + exclusiones sobre node:sqlite) |
| RLV.11 | `maniobra-vacias-lote.spec.ts` (caso "Ahora no": sigue sin lote) |
| RLV.12, RLV.14 | `maniobra-vacias-lote.spec.ts` (elegir existente → oráculo server) |
| RLV.13, RLV.14 | `maniobra-vacias-lote.spec.ts` (crear "Descarte" → oráculo server: lote llamado "Descarte") |
| RLV.15 | `identificar.tsx`: fetch de vacías gateado a `extractManeuvers(config).includes('tacto')` |
| RLV.16 | reuso `assignAnimalToGroup` (asignación manual ya existente) |
| RLV.17, RLV.18, RLV.19 | `venta.tsx` (resumen N + aviso irreversibilidad + busyRef/disabled) — veto en E2E/Gate 2.5 |
| RLV.20, RLV.21, RLV.21.1 | `venta.tsx` (targets de fetchGroupMembers ∩ ids; solo p_profile_id al RPC) + `lotes.spec.ts` (oráculo server) |
| RLV.22, RLV.23 | `batch-exit-plan.test.ts` (loop sin red) + offline-first del outbox/CRUD-plano local |

## Autorrevisión adversarial (paso 8)

Busqué activamente, con ojo hostil:
- **¿profileId cruza de tenant?** No: `venta.tsx` arma targets de `fetchGroupMembers` (RLS) ∩ ids; el loop
  solo manda `p_profile_id`; el RPC deriva el tenant server-side. Sugerencia: profileIds de
  `fetchSessionEmptyFemales` (session-scopeado) + groupId de `fetchManagementGroups`/lote creado (trigger 0037
  same-establishment). Sin `establishment_id` fabricado en el cliente. ✓
- **¿Overlay colgado si una baja falla local?** `enqueueExitAnimal` es atómico (intent+overlay en 1
  writeTransaction); si falla no escribe nada. Si el clear falla tras un enqueue OK, el animal igual queda
  oculto por el overlay 'exited'; el `management_group_id` no-limpiado es benigno (archivado) y reintentable. ✓
- **¿Clear sobre archivado válido?** Sí: trigger 0037 early-return con NULL; el UPDATE filtra `deleted_at IS
  NULL` (exit NO es soft-delete → deleted_at NULL → aplica). ✓
- **¿Query de vacías considera el overlay?** No hace falta (reconciliado): el tacto es CRUD-plano a la tabla
  synced → ya local. Verificado con node:sqlite (tacto offline encontrado). ✓
- **¿DISTINCT por animal?** Sí — test con 2 tactos 'empty' del mismo animal → 1 fila. ✓
- **¿Fecha TZ-safe?** `todayIso()` por componentes locales; `p_exit_date` es date-only string; el badge reusa
  `formatDateEsAr` (string-based). Sin `new Date` sobre date-only. ✓
- **¿Títulos recortados?** lineHeight matcheado en todos los headings (≥$6) y Text con numberOfLines; ojo
  especial con "Elegí"/"agregás"/"Registrando" (descenders g/j). ✓
- **¿Tests que pasan por la razón equivocada?** `runBatchExit` verifica la SECUENCIA real de llamadas (spy
  array) y el corte fail-closed; la query se testea contra node:sqlite real con exclusiones. ✓

Encontrado y cerrado durante la autorrevisión:
- 2 imports muertos (`View` en `lote/[id].tsx` y `BatchSaleAnimalRow.tsx`) → removidos.
- `resolveEffectiveSaleData` con override 0: `??` trataría 0 como presente, pero `validateExitPrice/Weight`
  rechazan 0 (>0) antes → nunca llega un 0 válido. Sin bug. Documentado.

## Verificación

- `pnpm -C app run typecheck` → **exit 0**.
- Unit (node:test) 4 suites tocadas → **190 pass / 0 fail** (`exit-animal`, `batch-exit-selection`,
  `batch-exit-plan`, `local-reads`).
- Anti-hardcode (ADR-023 §4) → **0 violaciones**.
- E2E: escritos (`lotes.spec.ts` +2, `maniobra-vacias-lote.spec.ts` nuevo) **NO ejecutados** (Gate 2.5, leader).
  Typecheck aislado de e2e: solo los "errores" ambientales del patrón `type Page` de `./helpers/fixtures` (import
  type-only que Playwright borra; idéntico a los specs existentes que pasan — el `e2e/` está excluido del tsc del
  proyecto a propósito).
- NO se corrió `node scripts/check.mjs` completo ni `e2e:build` (colisión de DB / re-render de design PNGs).

## Para el reviewer / Gate 2 / Gate 2.5

- **Reviewer:** confirmar wiring end-to-end (imports vivos ✓, ruta registrada ✓); trazabilidad RLV→test arriba.
- **Gate 2 (code, focos del design §7):** anti-IDOR de la tanda (targets de fetchGroupMembers ∩ ids; solo
  p_profile_id al RPC); no fabricar establishment_id; rechazo parcial no revierte ni cuelga overlay; clear de
  membresía sobre archivado (trigger 0037 NULL early-return). + revisar el owner-gating de "Crear lote" (RLV.13
  reconciliado).
- **Gate 2.5 (capturas, T5.3 = leader):** sugerencia post-tacto con conteo · lote con "Vender/Descartar" · modo
  selección de subconjunto · form de venta (comunes + override) · post-venta (lote más chico). Correr los 5 E2E
  nuevos/extendidos (`lotes.spec.ts`, `maniobra-vacias-lote.spec.ts`).
- **T6.2 (leader):** fold al baseline `design.md` (puntero + fila `lotes-venta` en "Deltas posteriores").
