# Review — feature 21: watched queries (db.onChange / useQuery)

> Reviewer, 2026-07-21. Foco en el DELTA. La resolucion de la 20 (que ya paso reviewer + Gate 2) se preserva intacta.
> E2E revisada por LECTURA del spec (no ejecutada) por instruccion del leader. Unit + typecheck + lint corridos por el reviewer, verdes.

## Veredicto: APPROVED

---

## Verificacion de los 7 puntos pedidos (evidencia archivo:linea)

### 1. Resolucion intacta — OK
git diff --stat da 0 lineas en: utils/establishment.ts, services/establishments.ts, services/rodeos.ts, services/powersync/local-reads.ts, services/powersync/local-query.ts, app/campo-perdido.tsx. El nuevo disparador re-corre los callbacks EXISTENTES (refreshEstablishments/load), no los reescribe:
- EstablishmentContext.tsx:517-524 — db.onChange sobre tablas [user_roles, establishments].
- RodeoContext.tsx:290-293 — db.onChange sobre tablas [rodeos, user_roles].
- Suites de la 20 verdes: establishment.test.ts 238/238, local-reads.test.ts 169/169 (incluye buildManagementGroupsQuery linea 1423: active=1 + deleted_at IS NULL + overlay soft_deleted).

### 2. Lifecycle del listener (obs de Gate 1) — OK
- db.onChange devuelve dispose de tipo funcion — verificado en node_modules AbstractPowerSyncDatabase.d.ts:587.
- Cleanup llama dispose: EstablishmentContext.tsx:525 (return de la funcion dispose); RodeoContext.tsx:294 idem.
- Re-suscripcion correcta: deps [userId, refreshEstablishments, db] (Est :526) y [userId, establishmentId, load, db] (Rodeo :295). db = singleton estable del PowerSyncProvider. Cadena estable: applyRodeos deps [] (:169), load deps [applyRodeos] (:261); refreshEstablishments deps [userId, applyMembershipsResult] (:376) — misma estabilidad que en la 20.
- Sin leak ni doble suscripcion: React corre el cleanup (dispose) ANTES de re-suscribir, y triggerImmediate false hace que una re-suscripcion no dispare recarga espuria.

### 3. Carga inicial al montar (R21.35) — OK
- triggerImmediate false: el onChange NO carga al montar.
- Bootstrap SEPARADO e INTACTO (fuera del diff): EstablishmentContext.tsx:443-490 (bootedForUser ref, loadTrail, waitForUsableSync, loadMemberships, applyMembershipsResult); RodeoContext.tsx:264-267 (useEffect [userId, establishmentId, load]). En lotes.tsx la carga inicial la hace useQuery mismo (isLoading en la 1a carga). Sin doble carga.

### 4. lotes.tsx (R21.32-34) — OK
- Desambiguacion correcta y en el ORDEN del design 3.3 (lotes.tsx:227-246): error+vacio -> FormError + Reintentar (refresh); isLoading+vacio -> Cargando lotes; vacio + no hasSynced -> SYNCING_MESSAGE (R21.32, ANTES del vacio genuino); vacio + hasSynced -> sin lotes copy owner/no-owner (R21.33); si no, la lista.
- useStatus volvio SOLO como affordance del vacio (lotes.tsx:95), NO como disparador (grep: no queda lastSyncedMs funcional).
- rowComparator keyBy g.id / compareBy g.name (lotes.tsx:87-89) reemplaza sameManagementGroups (helper ELIMINADO).
- Optimismo del write local, sin parches: setGroups + snapshots de revert eliminados de crear (:138) / renombrar (:522) / borrar (:171-186). El soft-delete escribe el overlay pending_status_overrides local; buildManagementGroupsQuery deja de listar; un borrado rechazado no escribe overlay (nada que revertir).
- No se blanquea: useQuery no re-pone isLoading en re-emisiones (ReadonlyQueryResult, watch-types.d.ts:56-70).

### 5. Thrash / E2 (R21.19-21) — OK
Guards de equivalencia de la 20 preservados en la resolucion intacta: sameRodeoState (RodeoContext.tsx:167), sameResolvedEstablishmentState/sameEstablishmentList (probados en establishment.test.ts, 0 diff). rowComparator en lotes. Throttle trailing 30 ms (default del SDK).

### 6. E1 fail-safe — OK
assessDisappearance sin cambios (0 diff). El onChange re-corre la resolucion existente; la evidencia afirmativa (hasActiveLocalRole, resultado absent_or_inactive) sigue siendo la unica puerta a confirmed, con independencia del disparador (mas frecuente = converge antes, nunca peor). Diferimiento D1 intacto (EstablishmentContext.tsx:536-564). Guarda R20.18 intacta (RodeoContext.tsx:247-252).

### 7. Firmas / fencing / reconciliacion — OK
- Firmas publicas: 0 cambios en tipos exportados de contexto (grep). El cambio de firma de onRenamed es de LoteCard/RenameForm, funciones LOCALES de lotes.tsx (:347/:485), no API publica.
- Fencing: 0 archivos BLE / RLS / migracion / stream / EF tocados (git status sobre supabase, sync-streams, ble, baston.tsx = vacio). usePowerSync disponible: PowerSyncProvider (_layout.tsx:604) envuelve EstablishmentProvider (:614) / RodeoProvider (:619).
- Reconciliacion de specs: ADR-030 (titulo db.watch a db.onChange + precision de nomenclatura), backlog (3 consumidores HECHOS; resto incremental), spec 15 design (cero watched queries a 3 migrados), spec 20 design 9.1/10-bis(g)+(h) + requirements (nota bajo R20.5), spec 21 requirements 11 + tasks mapa — todas coherentes con el codigo.

---

## Trazabilidad R21.n / verificacion (completa)

| R | Verificacion concreta | Estado |
|---|---|---|
| R21.1 | E2E T17 (campo en caliente) + insp. onChange Est | OK |
| R21.2 | E2E T18 (rodeo en caliente) + insp. onChange Rodeo | OK |
| R21.3 | E2E T19 + local-reads.test.ts:1423 (buildManagementGroupsQuery) | OK |
| R21.4 | insp. grep 0 lastSyncedMs funcional en los 3 | OK |
| R21.5 | insp. dispose en cleanup (Est:525 / Rodeo:294) | OK |
| R21.6 | insp. useQuery + rowComparator lotes:83-90 | OK |
| R21.7 | E2E T20/T21 (revocacion dispara por user_roles) | OK |
| R21.8 | E2E T20/T21 (aviso apenas baja la fila) | OK |
| R21.9 | insp. tabla user_roles en RodeoContext:292 | OK |
| R21.10 | establishment.test.ts (238) + 0 diff | OK |
| R21.11 | insp. load/applyRodeos/guarda R20.18 (0 diff) + E2E T21 | OK |
| R21.12 | establishment.test.ts (assessDisappearance) | OK |
| R21.13 | establishment.test.ts (shouldEmitDeferredRevocation) + E2E T21 | OK |
| R21.14 | insp. campo-perdido.tsx 0 diff | OK |
| R21.15 | insp. tipos exportados 0 diff + typecheck | OK |
| R21.16/17 | establishment.test.ts (inconclusive sin timer) | OK |
| R21.18 | insp. rafaq.yaml sin priority | OK |
| R21.19 | establishment.test.ts (guards de equivalencia) | OK |
| R21.20 | E2E lotes.spec.ts (crear/renombrar NO blanquea) + T19 | OK |
| R21.21 | insp. throttle trailing 30 ms (SDK) | OK |
| R21.22/23 | E2E T22 (offline puro) | OK |
| R21.24/25 | insp. copy/doc no prometen instantaneo | OK |
| R21.26 | insp. grep test.describe.configure eliminado | OK |
| R21.27 | insp. grep forceSyncTick/syncUntil eliminados | OK |
| R21.28 | E2E assertServerSessionsRevoked primer assert de T21 (:358) | OK |
| R21.29 | E2E 6 casos presentes (T17-T22) | OK |
| R21.30 | git diff --stat acotado a 3 consumidores + E2E + docs | OK |
| R21.31 | specs reconciliadas (insp.) | OK |
| R21.32 | insp. orden de ramas (no hasSynced antes del vacio genuino) — 1er-sync racy, justificado en requirements 11 | OK |
| R21.33 | E2E DETERMINISTA lotes.spec.ts (synced-empty a sin lotes) | OK |
| R21.34 | insp. useStatus solo affordance (lotes:95) | OK |
| R21.35 | insp. bootstrap separado (Est:443-490 / Rodeo:264-267) + E2E arranque | OK |

Todo R21.n tiene al menos 1 verificacion; los que cambian comportamiento tienen test automatizado (unit/E2E); los inspection-only son propiedades de wiring/negativas/doc inherentes a un cambio de solo-disparador (estrategia aprobada Gate 0/1, verificada por el reviewer).

## Tasks completas: SI — T1-T19 todas [x] en tasks.md; mapa de cobertura actualizado (R21.32 insp., R21.33 E2E).

## Verificacion ejecutada (liviano/confiable)
- establishment.test.ts: 238/238 OK
- local-reads.test.ts: 169/169 OK
- tsc --noEmit (cliente): exit 0 OK
- check-hardcode.mjs: 0 violaciones OK
- E2E: NO ejecutada (instruccion del leader; impl reporta 42/42 sin retries). Revisada por LECTURA: retries + forzador eliminados, oraculos estrictos preservados, 6 casos, header reescrito, test R21.33 nuevo bien formado.
- node scripts/check.mjs full: NO corrido (correria E2E + build de capturas que churnea design png, y suites backend con flake de rate-limit). El FAIL conocido de 2 features in_progress (16+21) es coordinacion del leader, NO defecto de la 21.

## CHECKPOINTS
- C2 (<=1 feature in_progress): [ ] — hay 2 (16+21); coordinacion del leader (feature 16 fuera del scope de esta review), NO defecto de la 21.
- C3 (arquitectura): [x] — solo capas previstas; lotes.tsx usa useQuery + builder puro, patron sancionado por conventions UI-4; sin logs/TODOs; 0 establishment_id hardcodeado.
- C4 (verificacion real): [x] — unit verdes con fixtures reales; buildManagementGroupsQuery testeado.
- C6 (SDD): [x] — 3 specs presentes, EARS estricto, tasks [x], cada R con verificacion.
- C7 (multi-tenant): [x] — 0 tablas nuevas; RLS/streams intactos; deleted_at IS NULL preservado en la local read.
- C8 (offline-first): [x] — useQuery/onChange leen SQLite local; 0 red nueva; offline E2E T22 preservado; LWW intacto.
- C9 (E2E + visual): [x] E2E (reactividad-sync.spec.ts + lotes.spec.ts, verde per impl/leader); capturas N/A (feature de disparador, sin pantalla nueva).
- C1/C5 (infra/cierre): N/A al delta (harness ya existente; el leader coordina el arbol/commit).

## Checklist RAFAQ-especifico
- A. Multi-tenancy / RLS: N/A (0 tablas nuevas, 0 RLS/migracion/stream). Nota: buildManagementGroupsQuery conserva deleted_at IS NULL + active=1 en la read local; el enforcement real (has_role_in/streams) intacto.
- B. Offline-first (aplicable):
  - [x] Funciona offline (E2E T22: sin cambios de tabla el onChange no dispara; useQuery refleja local).
  - [x] Sync bucket scoped por establishment_id, sin cambios (streams intactos).
  - [x] Conflictos: LWW default sin cambios; el optimismo viene del write local reflejado por useQuery.
  - [x] Sin requests sincronos a Supabase desde la pantalla: useQuery lee SQLite local via builder puro.
- C. BLE: N/A (0 archivos BLE tocados; init-script de T21 sin editar).
- D. UI de campo: mayormente N/A (no cambia tamanos/fuentes/layout): [x] estado de loading visible (Cargando / Sincronizando explicitos, desambiguados del vacio).
- E. Edge Functions: N/A (0 EF tocadas).

## Observaciones menores (NO bloqueantes)
1. lotes.tsx:230 — el FormError muestra copy fijo generico (perdio la distincion network vs generico anterior). Correcto para este contexto: el error de useQuery sobre SQLite local es de programacion (SQL), no de red; generico + Reintentar es accionable. Alineado con design 3.3.
2. scripts/run-tests.mjs aparece modificado en el arbol pero NO es de la feature 21 (agrega tests BLE de taps sin commitear); el impl ya lo flageo; coordinacion del leader.

## Cambios requeridos: ninguno.
