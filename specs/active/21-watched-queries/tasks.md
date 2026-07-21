# Tasks — feature 21: watched queries para reactividad real

> Plan de implementación. Cada tarea con checkbox + los `R21.<n>` que cubre + su verificación.
> **Regla de oro**: el cambio es de DISPARADOR, no de lógica. NO se toca `utils/establishment.ts`, ni los
> services (`establishments.ts`/`rodeos.ts`/`management-groups.ts`/`local-reads.ts`), ni ninguna migración/
> RLS/stream, ni `campo-perdido.tsx`, ni nada de BLE. La resolución de la 20 se re-corre tal cual.
> Baseline commit: `6ff78cb4ffcd59f96d7cd0ba676a99eb809dcf6a` (fijado por el implementer al arrancar, 2026-07-21).

---

## Fase A — `EstablishmentContext.tsx` (contexto raíz)

- [x] **T1** — Reemplazar el efecto reactivo por-sync por `db.onChange`. Sacar `import { useStatus }` y las
  líneas `const syncStatus = useStatus(); const lastSyncedMs = …`. Agregar `import { usePowerSync } from
  '@powersync/react'` + `const db = usePowerSync();`. Reemplazar el `useEffect([lastSyncedMs, userId,
  refreshEstablishments])` por el efecto `db.onChange({ onChange: () => void refreshEstablishments() },
  { tables: ['user_roles','establishments'] })` con `return () => dispose()`. Actualizar el comentario largo
  (deja de hablar de `lastSyncedMs`/patrón canónico; pasa a watched query, ADR-030). **NO** tocar
  `refreshEstablishments`, `applyMemberships`, `confirmDisappearance`, el diferimiento D1, ni el bootstrap.
  Cubre: R21.1, R21.4, R21.5, R21.7, R21.10, R21.15. Verificación: inspección del reviewer (disparador,
  tablas, dispose, sin `lastSyncedAt`, sin cambio de firma) + los E2E de A1/A2.

- [x] **T2** — Verificar que la revocación (D2) dispara por `user_roles`: el `onChange` sobre `user_roles`
  corre `refreshEstablishments` → `confirmDisappearance` → evidencia `absent_or_inactive` → `active_lost`.
  Cubre: R21.8. Verificación: E2E T20/T21 (aviso apenas baja la fila, sin esperar `lastSyncedAt`).

---

## Fase B — `RodeoContext.tsx`

- [x] **T3** — Reemplazar el efecto reactivo por-sync por `db.onChange`. Sacar `useStatus`/`lastSyncedMs`.
  Agregar `usePowerSync` + `const db = usePowerSync();`. Reemplazar el `useEffect([lastSyncedMs, userId,
  establishmentId, load])` por `db.onChange({ onChange: () => void load(userId, establishmentId) },
  { tables: ['rodeos','user_roles'] })` con `return () => dispose()`. Actualizar el comentario. **NO** tocar
  `load`, `applyRodeos`, la guarda R20.18 (`protectingResolved` + `assessDisappearance`), ni el efecto de
  bootstrap/cambio-de-campo `useEffect([userId, establishmentId, load])`. Cubre: R21.2, R21.4, R21.5, R21.9,
  R21.11, R21.15. Verificación: inspección del reviewer + E2E de rodeo en caliente (A1) y de maniobra (T21,
  riesgo 7: no se navega a `/crear-rodeo`).

---

## Fase C — `lotes.tsx` (pantalla, `useQuery`)

- [x] **T4** — Migrar la lista a `useQuery`. Agregar `import { useQuery, useStatus } from '@powersync/react'`
  + `buildManagementGroupsQuery`. Derivar `const { sql, args } = buildManagementGroupsQuery(establishmentId ??
  '')` y `const { data: groups, isLoading, error } = useQuery<ManagementGroup>(sql, args, { rowComparator:
  { keyBy: (g) => g.id, compareBy: (g) => g.name } })` + `const { hasSynced } = useStatus()` (SOLO para el
  affordance del estado vacío, R21.34 — no como disparador). Cubre: R21.3, R21.6, R21.20, R21.34.
  Verificación: E2E T19 (lote en caliente, lista no se blanquea).

- [x] **T5** — Sacar lo que `useQuery` reemplaza: `useStatus`/`lastSyncedMs`, el `useEffect` mount-only, el
  `useEffect` reactivo, la función `load`, el helper `sameManagementGroups`, los estados `groups`/`loading`.
  Cubre: R21.4, R21.20. Verificación: inspección (no queda `lastSyncedAt` ni `load`; `error`→`refresh()`).

- [x] **T6** — Sacar los parches optimistas manuales de la LISTA en crear/renombrar/borrar (`setGroups(prev
  => …)` + snapshots de revert): el write local reflejado por `useQuery` los hace innecesarios (el borrado
  rechazado no escribe overlay → la fila queda; no hay que revertir). Conservar el manejo de error de cada
  acción (`createError`, `Alert` del delete) y los estados de UI (`creating`, `newName`, `renamingId`,
  `deletingId`, `expandedId`, `busyRef`). El acordeón "ver miembros" (`GroupMembers`) queda tal cual.
  Cubre: R21.20. Verificación: E2E de lotes (crear/renombrar/borrar siguen funcionando; la lista refleja el
  cambio) + inspección.

- [x] **T7** — Derivar los estados de display de `{ groups, isLoading, error, hasSynced }` **con la
  desambiguación vacío/sincronizando (design §3.3, veto de design-review)**: error+"Reintentar" (`refresh()`)
  con `error`; "Cargando lotes…" con `isLoading` (carga inicial); **"Sincronizando datos del campo…" cuando
  `groups` vacío Y `!hasSynced`** (R21.32 — reusar `SYNCING_MESSAGE`); "Este campo todavía no tiene lotes…"
  (copy owner/no-owner) solo cuando `groups` vacío Y `hasSynced` (R21.33, vacío genuino); la lista si hay
  lotes. Cubre: R21.32, R21.33, R21.34. Verificación: E2E de estado vacío (campo con lotes aún sin sincronizar
  → "Sincronizando…", NO "sin lotes"; campo sincronizado sin lotes → "sin lotes") + inspección.

---

## Fase D — E1 / E2 / E3 (verificación de que la resolución preservada sigue valiendo)

- [x] **T8** — Confirmar por inspección que la resolución de la 20 quedó INTACTA: `assessDisappearance`,
  `shouldEmitDeferredRevocation`, `sameResolvedEstablishmentState`, `sameRodeo`/`sameRodeoState`,
  `hasActiveLocalRole`, `buildActiveRoleQuery` — ningún archivo puro ni de servicio cambió. Correr la suite
  unitaria existente (`establishment.test.ts` + `local-reads.test.ts`) y confirmar verde SIN tests nuevos
  (la lógica no cambió). Cubre: R21.12, R21.13, R21.14, R21.16, R21.17, R21.19. Verificación: suite unit
  verde + inspección de que no hay diff en los puros.

- [x] **T9** — Verificar E2 (thrash): inspección de que los guards de equivalencia siguen antes de cada
  `setState` en ambos contextos, y que `lotes.tsx` usa `rowComparator` (no `sameManagementGroups`). Cubre:
  R21.19, R21.20, R21.21. Verificación: inspección + E2E A1 (el campo activo no cambia al aparecer uno nuevo).

- [x] **T10** — Verificar E3 (offline): el caso E2E offline de la 20 (T22) sigue verde con el disparador
  nuevo (app quieta, sin cambios de tabla → `onChange` no dispara → sin cambio de estado). Ajustar solo el
  comentario del caso (deja de hablar de "señal congelada / guard `=== 0`"; pasa a "sin cambios de tabla, el
  `onChange` no dispara"). Cubre: R21.22, R21.23. Verificación: E2E T22.

- [x] **T11** — Verificar R21.18 por inspección/argumento: `sync-streams/rafaq.yaml` no declara prioridades
  → cada checkpoint es una vista consistente → `onChange` no observa buckets a medio aplicar (feature 20
  design §4.2, evidencia 1-4). Cubre: R21.18. Verificación: inspección + referencia a la evidencia de la 20.

- [x] **T11b** — Verificar la CARGA INICIAL al montar (R21.35). Confirmar por inspección que el efecto que se
  reemplazó en cada contexto es EL REACTIVO (el de `lastSyncedMs`), y que el efecto de bootstrap SEPARADO
  quedó intacto: `EstablishmentContext` (`bootedForUser` ref → `loadTrail`/`waitForUsableSync`/
  `loadMemberships`) y `RodeoContext` (`useEffect([userId, establishmentId, load])`). En `lotes.tsx` la carga
  inicial la hace `useQuery` mismo. Confirmar por E2E que la home resuelve y `/lotes` muestra su lista AL
  MONTAR, sin depender del `onChange` (`triggerImmediate` es false). Cubre: R21.35. Verificación: inspección
  + E2E de arranque (home + `/lotes` cargan al entrar) — ya cubierto por los E2E de arranque existentes de
  la 20/lotes.

---

## Fase E — E2E determinista (D3, objetivo Gate 2.5: SIN retries)

- [x] **T12** — `reactividad-sync.spec.ts`: sacar `test.describe.configure({ retries: 2 })`. Cubre: R21.26.
  Verificación: la línea ya no existe; el spec corre sin retries.

- [x] **T13** — Sacar el forzador de blip de las ADICIONES: eliminar `forceSyncTick`/`syncUntil` (y sus
  helpers si quedan sin uso) de T17 (campo), T18 (rodeo), T19 (lote). Asertar directo con timeouts razonables
  (Playwright estándar). Cubre: R21.27. Verificación: los casos pasan sin blips.

- [x] **T14** — Revocaciones (T20/T21): sacar retries; asertar directo. Conservar `assertServerSessionsRevoked`
  como PRIMER assert de T21 (candado anti-falso-verde) y todos los oráculos estrictos (copy de E5, no navegó a
  `/crear-rodeo`, diferimiento D1). Bajar los timeouts de ~120 s a un valor acorde a la propagación real (el
  lag de señal desaparece; el implementer lo mide). Cubre: R21.28, R21.29. Verificación: T20/T21 verdes,
  deterministas.

- [x] **T15** — Offline (T22): conservar el `context.setOffline`; no usa forzador. Actualizar el header del
  spec (reactividad determinista vía watched query; sin eventual-consistency/retries/forzador). Cubre:
  R21.29. Verificación: T22 verde; header reescrito.

- [x] **T16** — Correr la suite E2E completa del spec (los 6 casos), 2-3 corridas, SIN retries → verde
  determinista. **NO** correr `e2e:report`/build de capturas (churnea `design/**/*.png`; revertir `design/`
  si se tocó). Cubre: R21.1, R21.8, R21.13, R21.20, R21.22, R21.23 (verificación E2E) + A4. Verificación:
  ≥2 corridas limpias sin retry.

---

## Fase F — Migración incremental + ADR + reconciliación (D4)

- [x] **T17** — Confirmar que SOLO se tocaron los 3 consumidores (+ la E2E de la 20): las 5 pantallas
  focus-only y el resto de la app quedaron sin tocar. Cubre: R21.30. Verificación: `git diff --stat` acotado
  a `EstablishmentContext.tsx` + `RodeoContext.tsx` + `lotes.tsx` + `reactividad-sync.spec.ts` (+ docs).

- [x] **T18** — Reconciliación de specs (regla dura, ANTES de cerrar):
  - `specs/active/15-powersync/design.md` — nota de "cero watched queries" → "los 3 consumidores migrados;
    el resto pendiente" (R21.31).
  - `specs/active/20-reactividad-sync/design.md` §10-bis(g)/§9.1 + header del E2E — nota as-built: disparador
    migrado a watched query en la feature 21; forzador+retries retirados (D3).
  - `specs/active/20-reactividad-sync/requirements.md` — nota bajo R20.6/R20.7/R20.8 (el disparador
    `lastSyncedMs` + guard `=== 0` fueron reemplazados; la propiedad offline se preserva).
  - `docs/backlog.md` — cerrar/acotar el ítem `db.watch` (3 consumidores hechos; resto = migración
    incremental pendiente, ADR-030).
  - `docs/adr/ADR-030-…` — anotar la precisión `db.watch` → `db.onChange` para los contextos (design §2), si
    hace falta.
  Cubre: R21.31. Verificación: leader exige specs reconciliadas como pre-condición de `done`.

- [x] **T19** — Autorrevisión adversarial del implementer (paso obligatorio): confirmar (a) el `dispose` se
  llama en el cleanup de los 2 efectos (sin leak de listeners al re-suscribir por cambio de usuario/campo);
  (b) ninguna re-lectura concluye revocación sin evidencia afirmativa (la resolución no cambió); (c) el
  disparo frecuente no starvea `RodeoContext.load` (`lastAppliedSeq` ordena, no cancela — preservado); (d)
  `lotes.tsx` no blanquea la lista en las re-emisiones (`useQuery` no re-pone `isLoading`); (e) cero cambios
  de firma pública/RLS/stream; (f) cero archivos de BLE tocados. Cubre: R21.5, R21.11, R21.12, R21.15, R21.20.
  Verificación: writeup en `progress/impl_21-watched-queries.md` + verde de `node scripts/check.mjs`.

---

## Mapa de cobertura `R21.<n> → tarea/verificación`

| Req | Tarea(s) | Tipo de verificación |
|---|---|---|
| R21.1 | T1, T16 | inspección + E2E A1 |
| R21.2 | T3, T16 | inspección + E2E A1 (rodeo) |
| R21.3 | T4, T7, T16 | inspección + E2E T19 |
| R21.4 | T1, T3, T5 | inspección (sin `lastSyncedAt` en los 3) |
| R21.5 | T1, T3, T19 | inspección (dispose en cleanup) |
| R21.6 | T4, T7 | inspección |
| R21.7 | T1 | inspección (tabla `user_roles`) |
| R21.8 | T2, T16 | E2E T20/T21 |
| R21.9 | T3 | inspección (tabla `user_roles` en RodeoContext) |
| R21.10 | T1 | inspección (resolución re-corrida sin cambio) |
| R21.11 | T3, T19 | inspección |
| R21.12 | T8, T19 | unit (sin cambio) + inspección |
| R21.13 | T8, T14 | unit + E2E T21 |
| R21.14 | T8 | inspección (`campo-perdido.tsx` intacto) |
| R21.15 | T1, T3, T17, T19 | inspección (firmas/RLS/stream) |
| R21.16 | T8, T11 | unit `assessDisappearance` + inspección |
| R21.17 | T8 | unit (`inconclusive` sin timer) |
| R21.18 | T11 | inspección/argumento (sin prioridades) |
| R21.19 | T8, T9 | unit (guards) + E2E A1 |
| R21.20 | T4, T6, T9 | inspección (`rowComparator`) + E2E T19 |
| R21.21 | T9 | inspección (throttle del SDK) |
| R21.22 | T10, T16 | E2E T22 |
| R21.23 | T10 | E2E T22 (offline no concluye en contra) |
| R21.24 | T14, T18 | inspección (copy/doc no prometen instantáneo) |
| R21.25 | T18 | inspección (design §6) |
| R21.26 | T12 | el spec corre sin retries |
| R21.27 | T13 | inspección (sin forzador) |
| R21.28 | T14 | E2E (oráculos estrictos) |
| R21.29 | T14, T15 | E2E (casos preservados) |
| R21.30 | T17 | `git diff --stat` acotado |
| R21.31 | T18 | specs reconciliadas |
| R21.32 | T4, T7 | inspección del orden de ramas del display (`groups.length===0 && !hasSynced` → SYNCING antes del vacío genuino) — la ventana de primer-sync es racy para E2E (reconciliado, requirements §11) |
| R21.33 | T7 | E2E DETERMINISTA `lotes.spec.ts` ("campo sincronizado sin lotes → 'sin lotes' (no 'Sincronizando…')") |
| R21.34 | T4, T7 | inspección (`useStatus` solo affordance del vacío, no disparador) |
| R21.35 | T1, T3, T11b | inspección (bootstrap separado) + E2E de arranque |

## Gate 2.5 — capturas

**N/A para capturas nuevas.** La feature no agrega ni rediseña pantallas: cambia el DISPARADOR de la
reactividad. El único cambio visible es de comportamiento (que algo aparezca/desaparezca en ~1,5 s
determinista), que no se ve en una captura estática — se prueba por E2E. No se corre `e2e:report` (churnea
`design/**/*.png`).
</content>
