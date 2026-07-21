# Security (code) — feature 21: watched queries (`db.onChange` / `useQuery`)

> Gate 2 (ADR-019), modo `code`. Auditoría del DELTA de la feature 21, árbol sin commitear.
> Baseline: `6ff78cb4ffcd59f96d7cd0ba676a99eb809dcf6a`. Skill Sentry `security-review` corrida sobre el diff + checklist RAFAQ.
> La lógica de resolución de seguridad (revocación/evidencia afirmativa/fail-safe) tiene git diff = 0 y NO se re-audita (ya pasó Gate 2 en la feature 20, `progress/security_code_20-reactividad-sync.md`).

## Veredicto: PASS

Cero findings HIGH-confidence. El cambio es de DISPARADOR (de `lastSyncedMs` a `db.onChange`/`useQuery`); re-corre callbacks EXISTENTES sin tocar el veredicto de seguridad. 0 archivos de frontera tocados (RLS/migración/stream/Edge Function). SQL parametrizado. Sin nuevo input de usuario.

---

## Archivos analizados (delta vs baseline)

- `app/app/lotes.tsx` — swap a `useQuery` + empty-state (`hasSynced`) + optimismo vía write local.
- `app/src/contexts/EstablishmentContext.tsx` — efecto `db.onChange({tables:['user_roles','establishments']})`.
- `app/src/contexts/RodeoContext.tsx` — efecto `db.onChange({tables:['rodeos','user_roles']})`.
- `app/e2e/reactividad-sync.spec.ts` + `app/e2e/lotes.spec.ts` — reconciliación E2E (retries/forcer fuera, timeouts ajustados).

Fuera del delta pero leídos para trazar el data-flow del `useQuery` nuevo: `app/src/services/powersync/local-reads.ts` (`buildManagementGroupsQuery`, `notHiddenByOverride`), `app/src/services/powersync/local-query.ts` (`SYNCING_MESSAGE`), `@powersync/react` (`useQuery`/`useWatchedQuery`/`checkQueryChanged`).

---

## Foco 1 — ¿El disparador `db.onChange` saltea el fail-safe / muestra un revocado como activo / filtra datos de otro campo?

NO. Sin finding.

- El `onChange` re-corre la resolución EXISTENTE (`refreshEstablishments` → `applyMembershipsResult` / `load` → `assessDisappearance`), 0-diff (`utils/establishment.ts` y services intactos). El VEREDICTO lo sigue decidiendo la evidencia afirmativa (`roleEvidence === 'absent_or_inactive'` sobre el rol local `active=0`), independiente del disparador. Un disparo MÁS frecuente converge ANTES al veredicto correcto, nunca peor (design §4).
- `triggerImmediate` es `false` (default) → el `onChange` NO dispara al registrarse: la carga inicial la sigue haciendo el efecto de bootstrap SEPARADO e intacto (`EstablishmentContext.tsx` bootstrap `bootedForUser`; `RodeoContext.tsx:266` `useEffect([userId, establishmentId, load])`). Sin doble carga ni ventana nueva.
- Fuga de datos de otro campo: IMPOSIBLE por este cambio. El SQLite local solo contiene establishments que el usuario sincronizó (scoping server-side de las streams por `has_role_in`/`org_scope`, 0-diff). El `onChange` solo NOTIFICA sobre tablas locales ya sincronizadas; no puede materializar filas de un tenant sin acceso porque esas filas no están en el SQLite local.
- El disparo más frecuente que `lastSyncedMs` no abre ninguna ventana explotable: la guarda R20.18 (`RodeoContext.tsx:247` aprox.) + el diferimiento D1 (`EstablishmentContext.tsx`) están intactos; E2E T21 asserta ≥20 s de revocación propagable SIN navegar a `/campo-perdido` ni `/crear-rodeo` (deferido correctamente).

## Foco 2 — Lifecycle del listener (fuga / doble suscripción / DoS local)

NO. Sin finding.

- Ambos efectos retornan `() => dispose()` (`EstablishmentContext.tsx:525` aprox.; `RodeoContext.tsx:294` aprox.). React corre el cleanup del efecto anterior ANTES de re-suscribir → el listener viejo se libera primero → sin fuga ni doble suscripción.
- `dispose` es la función devuelta por `db.onChange` (tipo verificado en `@powersync/common/.../AbstractPowerSyncDatabase.d.ts`).
- Deps estables: `[userId, refreshEstablishments, db]` / `[userId, establishmentId, load, db]`. `refreshEstablishments`/`load` son `useCallback` estables (cambian solo con `userId`/`establishmentId`); `db` es el singleton del `PowerSyncProvider`. El efecto NO se re-suscribe por render, solo al cambiar usuario/campo. Sin thrash de suscripción.
- Logout / sin campo: early return (`if (!userId) return` / `if (!userId || !establishmentId) return`); el cleanup del ciclo previo ya liberó el listener.

## Foco 3 — `lotes.tsx` `useQuery` scoping por `establishment_id` (incl. transición de campo) / null-empty over-match

NO. Sin finding.

- `buildManagementGroupsQuery(establishmentId ?? '')` (`local-reads.ts:1530` aprox.) liga el tenant como PARÁMETRO: `WHERE mg.establishment_id = ?` con `args: [establishmentId]`. NO hay concatenación de string del establishmentId → sin injection y sin over-scope.
- `establishmentId` null/vacío → `''`, que no matchea ningún UUID → `data = []` → cae en el empty-state. Fail-safe: nunca "matchea de más".
- Transición de campo: al cambiar `establishmentId`, `args` cambia → `checkQueryChanged` (`@powersync/react/.../watch-utils.ts:31`) compara `stringifiedParams` → `queryChanged=true` → `useWatchedQuery.updateSettings({query})` re-ejecuta la query re-scopeada al NUEVO establishment. La query NO queda pegada al campo anterior. Durante la ventana breve de re-fetch (`isFetching=true`), `data` puede retener las filas del campo ANTERIOR — que son datos del PROPIO usuario (un campo donde tiene rol), transitorio, e idéntico a la semántica de la feature 20. Nunca datos de un tenant sin acceso. No es fuga cross-tenant.
- `notHiddenByOverride` (`local-reads.ts:548`) interpola SOLO constantes controladas por el código (nombre de tabla `'management_groups'`, columna `'mg.id'`, efecto literal `'soft_deleted'`) — ningún input de usuario → sin injection.
- La read local preserva el filtro `active = 1 AND deleted_at IS NULL` + overlay `soft_deleted` (defensa en profundidad; el enforcement real es la stream + RLS server-side, intactos).

## Foco 4 — Nuevo input de usuario / validación / rate limits / SQL parametrizado

NO hay nuevo input. Sin finding.

- El único input tipeado tocado por la pantalla es `newName` (crear/renombrar lote), PRE-EXISTENTE. Sigue validado por `validateGroupName(newName)` antes del write (`lotes.tsx:125` en create; en `RenameForm` el guard `valid` se preserva sobre `onRenamed()`). `validateGroupName` (`utils/management-group.ts`) es 0-diff. El delta solo removió el patch optimista manual; NO tocó ni debilitó la validación.
- Autoritativo server-side: el INSERT/UPDATE va al SQLite LOCAL; el enforcement real es la RLS al subir (`management_groups_insert = is_owner_of`, owner-only), 0-diff.
- SQL: todos los statements del path (`buildManagementGroupsQuery`, `buildCreateManagementGroupInsert`, `buildRenameManagementGroupUpdate`) usan placeholders `?` + `args`. Parametrizados.
- Sin secretos hardcodeados ni `console.log` de datos sensibles agregados en el diff.

---

## Tabla de inputs (campos que el usuario tipea, tocados por el delta)

| campo | límite | validación | OK? |
|---|---|---|---|
| `newName` (crear/renombrar lote) | largo/charset vía `validateGroupName` (pre-existente, 0-diff) | client `validateGroupName` + RLS `is_owner_of` server-side al subir | Sí — NO modificado por la feature 21 |

Ningún campo de entrada NUEVO introducido por el delta.

## Tabla de rate limits (acciones abusables tocadas por el delta)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `db.onChange` (contextos) | n.a. | — | — | Suscripción LOCAL a cambios del SQLite; no toca red ni backend. Throttle trailing 30 ms del SDK coalesce ráfagas. Sin superficie de abuso remota. |
| `useQuery` (lotes) | n.a. | — | — | Lectura LOCAL sobre SQLite vía builder puro. Sin request a Supabase desde la pantalla. |
| crear/renombrar/borrar lote | n.a. (delta) | — | — | Write LOCAL; el disparador cambió, la acción no. Sin email/SMS/API externa/bulk. Enforcement de rol por RLS al subir. |

No se tocó `[auth.rate_limit]` de `config.toml` ni ninguna Edge Function.

---

## False positives descartados (skill / patrón)

- **"useQuery sin scope de tenant"** → descartado: `establishment_id = ?` ligado por parámetro; `''` no matchea; re-scopea en transición (`checkQueryChanged`). El SQLite local ya está scopeado por la stream server-side.
- **"Interpolación de string en `notHiddenByOverride` → SQL injection"** → descartado: solo constantes code-controlled; el único valor derivado de contexto (establishmentId) va por `args`.
- **"Flash de datos de otro campo en transición"** → descartado como vuln: es el campo PROPIO del usuario (autorizado), transitorio, no cross-tenant; el local SQLite nunca contiene un tenant sin acceso.
- **"`db.onChange` puede concluir revocación sin evidencia"** → descartado: `assessDisappearance` (0-diff) solo concluye `confirmed` con evidencia afirmativa; el disparador no toca la evidencia.

## Fencing (confirmado)

- `git status` sobre `supabase/`, `sync-streams/`, `ble/`, `baston.tsx` = vacío. **0 RLS, 0 migración, 0 stream, 0 Edge Function.**
- La frontera real de tenant (`has_role_in` / `org_scope` en las streams + `management_groups_insert = is_owner_of` en RLS) está INTACTA.
- Suites unit de la resolución (feature 20) verdes por el reviewer: `establishment.test.ts` 238/238, `local-reads.test.ts` 169/169 (incluye `buildManagementGroupsQuery`: `active=1` + `deleted_at IS NULL` + overlay).

## Cobertura indirecta (declaración explícita)

La skill Sentry `security-review` NO cubre nativamente: RLS de Supabase, sync rules de PowerSync, ni el modelo de confianza offline. Esos dominios se revisaron MANUALMENTE arriba (Foco 1/3 + Fencing) y quedan sin cambios en este delta (0-diff), por lo que su postura de seguridad la sostiene el Gate 2 de la feature 20. BLE fuera de scope por instrucción (feature 04) — 0 archivos BLE en el diff, confirmado.
