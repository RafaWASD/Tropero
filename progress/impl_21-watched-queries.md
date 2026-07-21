baseline_commit: 6ff78cb4ffcd59f96d7cd0ba676a99eb809dcf6a

# Impl — feature 21: watched queries (`db.onChange` / `useQuery`) para reactividad real

> Estado: implementación COMPLETA, lista para el reviewer. Spec aprobado (Puerta 1, Raf, 2026-07-21).
> **El cambio es de DISPARADOR, no de lógica.** La resolución de la feature 20 se re-corrió INTACTA
> (0 diff en `utils/establishment.ts` y en los services). Baseline = SHA previo a la 1ª task.

---

## 1. Qué cambió por consumidor (el disparador, nada más)

### `EstablishmentContext.tsx` (T1/T2)
- **Sale**: `import { useStatus }`, `const syncStatus = useStatus(); const lastSyncedMs = …`, y el efecto
  reactivo `useEffect([lastSyncedMs, userId, refreshEstablishments])`.
- **Entra**: `import { usePowerSync }` + `const db = usePowerSync();`, y el efecto:
  ```ts
  useEffect(() => {
    if (!userId) return;
    const dispose = db.onChange(
      { onChange: () => { void refreshEstablishments(); } },
      { tables: ['user_roles', 'establishments'] },
    );
    return () => dispose();
  }, [userId, refreshEstablishments, db]);
  ```
- **Tablas**: `user_roles` (🔴 watched query de revocación D2 — `self_user_roles`/RG-1 sobrevive con
  `active=0` → el aviso deja de esperar `lastSyncedAt`) + `establishments` (alta/rename/baja).
- **Preservado INTACTO**: `refreshEstablishments`, `applyMembershipsResult`, `applyMemberships`,
  `confirmDisappearance`, `emitActiveLost`, `finishResolve`, `switchEstablishment`, el diferimiento D1
  (efecto de emisión al salir de maniobra) y el efecto de **bootstrap** (`bootedForUser`). El `onChange`
  re-corre la resolución existente; sólo cambia CUÁNDO se re-lee.

### `RodeoContext.tsx` (T3)
- **Sale**: `useStatus`/`lastSyncedMs` y el efecto reactivo `useEffect([lastSyncedMs, userId, establishmentId, load])`.
- **Entra**: `usePowerSync` + `db.onChange({ onChange: () => void load(userId, establishmentId) }, { tables: ['rodeos','user_roles'] })` con `return () => dispose()`, deps `[userId, establishmentId, load, db]`.
- **Tablas**: `rodeos` (alta/borrado/rename de un coworker) + `user_roles` (🔴 sostiene la guarda R20.18
  que hace posible D1 — al revocarse el acceso el bucket de rodeos se vacía; observar `user_roles`
  re-evalúa apenas baje el rol, aunque la remoción del bucket llegue en otro checkpoint).
- **Preservado INTACTO**: `load` (con `targetRef` + `lastAppliedSeq` anti-starvation), `applyRodeos`,
  la guarda R20.18 (`protectingResolved` + `assessDisappearance`), `sameRodeoState`/`sameRodeo`, y el
  efecto de **bootstrap/switch** `useEffect([userId, establishmentId, load])`.

### `lotes.tsx` (T4-T7)
- **Sale**: `useStatus`/`lastSyncedMs`, el efecto mount-only, el efecto reactivo, la función `load`, el
  helper `sameManagementGroups`, los estados `groups`/`loading`/`error`, `fetchManagementGroups`, y TODOS
  los parches optimistas manuales de la lista (`setGroups(prev…)` de crear/renombrar/borrar + snapshot/revert).
- **Entra**:
  ```ts
  const { sql, args } = buildManagementGroupsQuery(establishmentId ?? '');
  const { data: groups, isLoading, error, refresh } = useQuery<ManagementGroup>(sql, args, {
    rowComparator: { keyBy: (g) => g.id, compareBy: (g) => g.name },
  });
  const { hasSynced } = useStatus(); // SOLO affordance del vacío (R21.34), no disparador
  const groupList: ManagementGroup[] = [...groups]; // copia mutable para props/helpers (data es readonly)
  ```
- **Desambiguación vacío/sincronizando (R21.32/33/34)** — orden de ramas del display:
  `error && groups.length===0` → FormError + "Reintentar" (`refresh?.()`) →
  `isLoading && groups.length===0` → "Cargando lotes…" →
  `groups.length===0 && !hasSynced` → `SYNCING_MESSAGE` (R21.32, NO "sin lotes") →
  `groups.length===0 && hasSynced` → "Este campo todavía no tiene lotes…" (R21.33, copy owner/no-owner) →
  la lista de LoteCards.
- **Optimismo GRATIS (R21.20)**: crear/renombrar/borrar son writes LOCALES (`management_groups` / overlay
  `pending_status_overrides`) → `useQuery` re-emite reflejado, sin `setGroups`. Un borrado rechazado no
  escribió overlay → la fila sigue (nada que revertir). Se conservan `createError`, el `Alert` del delete,
  y los estados de UI (`creating`, `newName`, `renamingId`, `deletingId`, `expandedId`, `busyRef`).
- `onRenamed` pasó de `(newName)=>{setGroups(...); load(...)}` a `()=>{ setRenamingId(null) }`.

**NO se tocó**: ninguna firma pública de contexto, ninguna migración/RLS/stream/EF, ni `campo-perdido.tsx`,
ni `utils/establishment.ts`, ni los services, ni nada de BLE (`ble/**`, `baston.tsx`, `*-multivendor*`,
`__RAFAQ_BLE_E2E__` init-script de T21).

---

## 2. Lifecycle del listener (obs no bloqueante de Gate 1 — cuidada)

`db.onChange(handler, { tables })` devuelve `() => void` (dispose, verificado en
`node_modules/@powersync/common/lib/client/AbstractPowerSyncDatabase.d.ts:587`). En ambos contextos:
- **El cleanup del `useEffect` llama `dispose()`.** React corre el cleanup del efecto anterior ANTES de
  re-ejecutar el efecto → al re-suscribir (cambio de `userId` / `establishmentId`) el listener viejo se
  libera primero → **sin fuga de listeners ni doble suscripción**.
- **Re-suscripción sólo cuando cambian las deps reales**: `refreshEstablishments`/`load` son `useCallback`
  estables (cambian sólo con `userId`/`establishmentId`); `db` es el singleton del `PowerSyncProvider`.
  Así el efecto NO se re-suscribe en cada render, sólo al cambiar usuario/campo.
- **`triggerImmediate` es `false` (default)** → el `onChange` NO dispara al registrarse → **la carga
  inicial NO la hace el onChange** (la sigue haciendo el bootstrap SEPARADO). Sin doble carga inicial.
- **Logout / sin campo**: el efecto retorna temprano (`if (!userId) return;` / `if (!userId || !establishmentId) return;`); el cleanup del ciclo previo ya liberó el listener → sin leak.

---

## 3. Trazabilidad `R21.<n> → verificación`

| Req | Cómo se verificó |
|---|---|
| R21.1 | inspección (EstablishmentContext onChange sobre `establishments`/`user_roles`) + E2E `reactividad-sync` T17 (campo en caliente) |
| R21.2 | inspección (RodeoContext onChange sobre `rodeos`/`user_roles`) + E2E T18 (rodeo en caliente) |
| R21.3 | inspección (lotes `useQuery`) + E2E T19 (lote en caliente) |
| R21.4 | inspección: cero `lastSyncedAt`/`lastSyncedMs` en los 3 archivos (grep) |
| R21.5 | inspección: `dispose()` en el cleanup de ambos efectos (§2) |
| R21.6 | inspección: `useQuery(sql,args,{rowComparator})` en lotes |
| R21.7 | inspección: tabla `user_roles` observada en EstablishmentContext |
| R21.8 | E2E T20/T21 (aviso apenas baja la fila; medido <300 ms del disparo) |
| R21.9 | inspección: tabla `user_roles` observada en RodeoContext |
| R21.10 | inspección: resolución re-corrida sin cambio (0 diff en la lógica) + unit `establishment.test.ts` verde |
| R21.11 | inspección: `load`/`applyRodeos`/guarda R20.18 sin cambio |
| R21.12 | unit `establishment.test.ts` (238) — `assessDisappearance` sin cambio |
| R21.13 | unit + E2E T21 (revocación en maniobra: no patea, avisa al salir) |
| R21.14 | inspección: `campo-perdido.tsx` intacto (0 diff) |
| R21.15 | inspección: 0 cambios en firmas de contexto / RLS / migración / stream (git scope) |
| R21.16/17 | unit `establishment.test.ts` (`inconclusive` sin timer) |
| R21.18 | inspección: `sync-streams/rafaq.yaml` SIN `priority` (grep vacío) |
| R21.19 | unit (guards de equivalencia) + E2E T17 (campo activo no cambia al aparecer uno nuevo) |
| R21.20 | inspección (`rowComparator`, sin `setGroups`) + E2E `lotes.spec.ts` T2 (crear/renombrar NO blanquea) + T19 |
| R21.21 | inspección: throttle trailing 30 ms del SDK (verificado en `SQLOnChangeOptions`) |
| R21.22/23 | E2E `reactividad-sync` T22 (offline puro: sin cambios de tabla, el onChange no dispara) |
| R21.24/25 | inspección: copy/doc no prometen revocación instantánea (design §6; E4 preservado) |
| R21.26 | inspección: `test.describe.configure({ retries })` ELIMINADO |
| R21.27 | inspección: `forceSyncTick`/`syncUntil` ELIMINADOS (adiciones asertan directo) |
| R21.28 | E2E: oráculos estrictos intactos (incl. `assertServerSessionsRevoked` 1º de T21) |
| R21.29 | E2E: 6 casos preservados, sólo se sacó retries+forzador |
| R21.30 | git diff acotado a 3 consumidores + E2E (+ docs) |
| R21.31 | specs reconciliadas (spec 15/20 + backlog + ADR-030) |
| R21.32 | inspección del orden de ramas del display (racy en E2E — reconciliado en requirements §11) |
| R21.33 | E2E DETERMINISTA nuevo `lotes.spec.ts` ("campo sincronizado sin lotes → 'sin lotes'") |
| R21.34 | inspección: `useStatus().hasSynced` sólo en las ramas de vacío, no como disparador |
| R21.35 | inspección: bootstrap SEPARADO intacto en ambos contextos + E2E de arranque (waitForHome/lotes cargan al montar) |

---

## 4. Evidencia de determinismo de la E2E (D3 — objetivo central, SIN retries)

`app/e2e/reactividad-sync.spec.ts` sin `retries` ni forzador. **Todas las corridas (sin cherry-pick):**

| Corrida | Resultado | T20 (revocación fuera) | T21 (revocación en maniobra, tras salir) |
|---|---|---|---|
| Run 1 | **6/6 passed** (1.0 m) | aviso a **217 ms** | aviso a **264 ms** |
| Run 2 | **6/6 passed** (1.0 m) | **223 ms** | **266 ms** |
| Run 3 | **6/6 passed** (59.3 s) | **224 ms** | **297 ms** |
| Stress `--repeat-each=3` | **18/18 passed** (3.0 m) | 222 / 231 / 228 ms | 330 / 232 / 282 ms |
| Final (spec de entrega, sin instrumentación `[MEASURE]`) | **6/6 passed** (1.0 m) | — | — |

**Total: 42 ejecuciones, 0 fallos, 0 retries, 0 flaky.** Determinismo confirmado.

**Timeout de revocación MEDIDO y elegido acorde**: la latencia real desde el disparo hasta el aviso es
**<350 ms** en las 8 mediciones (la propagación server→SQLite se solapa con `waitForServerRoleInactive`,
y al aterrizar la fila el `onChange` sobre `user_roles` dispara al instante). El timeout se fijó en **45 s**
para las revocaciones (margen amplio para la variación de propagación del servicio — E4/R21.24 reconoce que
la ENTREGA sigue siendo async y se disrupta con reconnects — SIN reintroducir flakiness), y **30 s** para
las adiciones. Ambos MUY por debajo del ~120 s que en la 20 cubría el freeze de señal (~90 s), que
desapareció. No se re-agregó ningún retry (eso derrotaría el propósito de la feature). La instrumentación
`[MEASURE]` temporal se removió del archivo de entrega (es inerte: sólo logs; el spec final se re-corrió
verde 6/6).

**Regresión del optimismo-vía-`useQuery`** (el cambio más riesgoso): `app/e2e/lotes.spec.ts` **5/5 passed**,
incluido **"crear/renombrar NO blanquea la lista (optimismo en sitio, sin 'Cargando lotes…')"** — confirma
que sacar los parches manuales y confiar en que `useQuery` refleja el write local funciona (crear→aparece,
renombrar→se actualiza, borrar→desaparece, sin flash del spinner). Y el nuevo test R21.33 (2/2 con
`--repeat-each=2`).

---

## 5. Autorrevisión adversarial (T19 — busqué mis propios defectos)

Pasada hostil buscando: fuga de listener, doble carga inicial, falso-vacío, thrash, y que la resolución
de la 20 quedó realmente intacta. Hallazgos y cierre:

- **(a) Fuga de listener / doble suscripción** → NO. El `dispose()` está en el cleanup de ambos efectos;
  React libera el listener viejo antes de re-suscribir; las deps son estables (re-suscribe sólo por
  usuario/campo). Verificado leyendo ambos efectos. (§2)
- **(b) Doble carga inicial** → NO. `triggerImmediate` es `false` → el `onChange` no dispara al montar;
  la carga inicial la hace SÓLO el bootstrap separado (intacto). Confirmado por E2E de arranque (home +
  `/lotes` cargan al entrar) y por T22 (la home hidrata desde cache offline).
- **(c) Falso-vacío en `lotes.tsx`** → cubierto: `groups.length===0 && !hasSynced` → "Sincronizando…"
  ANTES de la rama de vacío genuino (R21.32). El nuevo E2E R21.33 asserta que un campo synced-empty NO
  muestra "Sincronizando…". La lista no se blanquea en re-emisiones (`useQuery` no re-pone `isLoading`,
  sólo `isFetching`; `rowComparator` preserva refs) — validado por lotes.spec T2.
- **(d) Thrash / doble disparo** → los guards de equivalencia de la 20 (`sameResolvedEstablishmentState`,
  `sameRodeoState`) y el `rowComparator` de `useQuery` se preservan/usan; el throttle trailing (30 ms)
  del SDK coalesce ráfagas. El disparo más frecuente es el que la 20 ya endureció (`lastAppliedSeq`
  ordena sin cancelar).
- **(e) ¿La resolución de la 20 quedó realmente intacta?** SÍ. `git diff` de `utils/establishment.ts` y
  de los services = **0**. Las suites unit de la 20 (`establishment.test.ts` + `local-reads.test.ts`)
  siguen verdes (238 tests). El único diff en los contextos es el efecto reactivo (+ el import/`db`).
- **(f) Disparo frecuente que concluya revocación sin evidencia** → NO. `assessDisappearance` (sin
  cambio) sólo concluye `confirmed` con `roleEvidence === 'absent_or_inactive'`; el disparador no toca la
  evidencia. E2E T21 prueba que durante ≥20 s de revocación propagable NO se navega a `/campo-perdido`
  ni a `/crear-rodeo` (diferimiento D1 + guarda R20.18 intactos).
- **(g) Readonly de `useQuery`** → `data` es `ReadonlyArray<Readonly<ManagementGroup>>`; se hace copia
  mutable `groupList = [...groups]` para los props hijos/helpers. El `rowComparator` evita que este render
  corra en checkpoints no-op, así que la copia no genera trabajo espurio. Typecheck limpio.
- **(h) `refresh?` opcional** → el CTA "Reintentar" usa `refresh?.()` (guard) — seguro si el hook aún no
  expuso `refresh`.
- **Sin regresión de imports en otros consumidores**: `fetchManagementGroups` sigue importado/usado por
  `(tabs)/index.tsx`, `animal/[id].tsx`, `crear-animal.tsx`, `lote/[id].tsx` (sólo lo saqué de lotes.tsx).
  `sameManagementGroups` era local a lotes.tsx (no exportado) — removido limpio.

---

## 6. Reconciliación de specs (regla dura — antes del reviewer)

- `specs/active/15-powersync/design.md` — el bullet "One-shot `getAll`, NO `db.watch`" → los 3
  consumidores MIGRADOS a watched queries reales; el resto sigue como deuda incremental (R21.31).
- `specs/active/20-reactividad-sync/design.md` — §9.1 (alternativa "watched queries" DESCARTADA→HECHA),
  §10-bis(g) (db.watch flageado→implementado como db.onChange/useQuery, <300 ms medido) y §(h) (forzador
  + retries RETIRADOS por D3).
- `specs/active/20-reactividad-sync/requirements.md` — nota as-built bajo R20.6/R20.7/R20.8 (el disparador
  `lastSyncedMs` + guard `=== 0` fueron reemplazados; la propiedad offline se preserva más fuerte).
- `specs/active/21-watched-queries/requirements.md` §11 + `tasks.md` mapa — R21.33 = E2E determinista;
  R21.32 = inspección (ventana de primer-sync racy, no se testea en E2E para no reintroducir no-determinación).
- `docs/backlog.md` — el ítem `db.watch` acotado: 3 consumidores HECHOS (feature 21); resto = migración
  incremental pendiente.
- `docs/adr/ADR-030-…` — título + Decisión: precisión de nomenclatura `db.watch` → **`db.onChange`** para
  los contextos (verificada en `node_modules`; `db.watch` entregaría filas que los contextos ignorarían).
- Header de `app/e2e/reactividad-sync.spec.ts` reescrito (reactividad determinista vía watched query;
  sin eventual-consistency/retries/forzador). Nuevo E2E R21.33 en `app/e2e/lotes.spec.ts`.

---

## 7. Verificación (`node scripts/check.mjs` + suites relevantes)

- **typecheck client** (`tsc --noEmit`): OK.
- **Lint anti-hardcode** (ADR-023 §4): 0 violaciones.
- **client unit tests**: **2339 passed, 0 fail** (incluye `establishment.test.ts`=238, `local-reads.test.ts`,
  `management-group.test.ts`, etc. — la lógica pura de la 20 intacta).
- **scripts unit tests**: 28 passed.
- **E2E `reactividad-sync.spec.ts`**: 42 ejecuciones, 0 fail, determinista sin retries (tabla §4).
- **E2E `lotes.spec.ts`**: 5/5 passed (regresión del optimismo + R21.33).
- **Suites backend remotas (RLS/Edge/Animal/…): NO corridas a propósito.** La feature no toca NINGÚN
  archivo backend (verificado por `git status` — 0 migraciones/YAML/EF/RLS), y correrlas con otra terminal
  activa gatilla rate-limits de Supabase (flakes, no regresión — memoria conocida). Se saltearon con
  `SUPABASE_SERVICE_ROLE_KEY=""`; el resto del check corrió verde.
- **`[FAIL]` de `check.mjs`** = coordinación: **2 features en `in_progress`** (16-ambientes-y-release + 21).
  Feature 16 no es mía; NO toqué `feature_list.json` (coordinación del leader). Feature 21 está correcta
  (`in_progress`, sdd=true, 3 specs presentes).

## 8. Notas para el leader

- **NO commiteé** (coordinación del árbol = leader). Mi diff de feature 21: `app/app/lotes.tsx`,
  `app/e2e/reactividad-sync.spec.ts`, `app/e2e/lotes.spec.ts`, `app/src/contexts/EstablishmentContext.tsx`,
  `app/src/contexts/RodeoContext.tsx` + docs de reconciliación (spec 15/20/21, backlog, ADR-030) +
  `progress/impl_21-watched-queries.md`.
- `scripts/run-tests.mjs` aparece modificado en el árbol pero **NO es mío** (agrega tests BLE a la lista —
  trabajo de taps pre-existente sin commitear). No lo toqué.
- Correr `e2e:build` + las suites E2E re-renderizó `design/**/*.png` (byte-diffs espurios, memoria conocida):
  **revertir `design/` antes de commitear**; NO `git add -A`. `app/dist/` es build efímero (gitignored).
- **Gate 2.5 / capturas**: N/A (spec tasks.md §Gate 2.5). La feature cambia el DISPARADOR de la reactividad;
  el único cambio visible es de comportamiento (algo aparece/desaparece en ~1,5 s determinista) + el estado
  "Sincronizando…"/"sin lotes" de lotes.tsx, ambos probados por E2E, no por captura estática. No se corrió
  `e2e:report` (churnea design/).
