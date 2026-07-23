baseline_commit: aa2cb6f6d3709c83233b65e2fe8664879e159bbb

# impl — ADR-030 migración incremental de watched queries (resto de proxy-consumers)

**Feature/delta**: continuación de la migración incremental de ADR-030 (frontend puro). Migrar los
consumidores que TODAVÍA usan el disparador `useStatus()` + `lastSyncedAt`/`lastSyncedMs` (el proxy NO
determinista del cambio de dato) a watched queries reales (`db.onChange`), siguiendo el patrón ya
establecido por la feature 21 (`EstablishmentContext`/`RodeoContext`/`lotes.tsx`) y la feature 22
(`useManeuverGating`). NO hay `specs/active/<name>/` — la autoridad es `docs/adr/ADR-030` + el mensaje del
leader. Cliente puro (sin Gate 1; `git diff supabase/ sync-streams/` debe quedar VACÍO).

## Paso 1 — Inventario AUTORITATIVO (grep, no memoria)

Grep de `useStatus(` + `lastSyncedAt|lastSyncedMs` en `app/app/` + `app/src/`.

**Consumidores que TODAVÍA usan el proxy `lastSyncedMs` (= objetivo de esta migración):**
1. `app/app/(tabs)/animales.tsx` — re-carga lista + búsqueda al avanzar el sync.
2. `app/app/(tabs)/index.tsx` (home) — re-lee conteos (animales/equipo) + grupos (cards de rodeo/lote).
3. `app/src/contexts/ProfileContext.tsx` — re-lee el perfil (name/phone) del saludo.
4. `app/src/hooks/useGroupView.ts` — re-lee la ventana/meta/búsqueda de la vista de grupo (rodeo/lote grande).

**`useStatus` pero NO el proxy (NO se tocan):**
- `app/app/lotes.tsx` — `useStatus().hasSynced` para desambiguar vacío-vs-sincronizando (as-built feature 21,
  R21.34). Ya migrado a `useQuery`. NO usa `lastSyncedAt`. **Fuera de alcance.**
- `app/app/_components/FindOrCreateOverlay.tsx` — `useStatus().connected` → `isOnline` (affordance del botón
  de transfer online-only). NO es un disparador de re-lectura reactiva. **NO migrar** (no hay tabla local a
  observar; `connected` es el uso legítimo de `useStatus`).
- `app/src/services/powersync/status.ts` — la ABSTRACCIÓN de status (deriva `lastSyncedAt` para la
  instrumentación de la feature 22). No es consumidor de UI. **NO tocar.**

**Ya migrados (feature 21/22) — NO tocar:** `EstablishmentContext`, `RodeoContext`, `lotes.tsx`,
`useManeuverGating`.

**Divergencia con la lista de memoria del backlog/ADR-030.** El backlog nombraba como candidatos a
`miembros`, `use-reports`, `animal/[id]`, `export-sigsa`. El grep autoritativo confirma que **NINGUNO usa
el proxy `lastSyncedAt`/`lastSyncedMs`** (ver Paso 2). El objetivo de ADR-030 es ELIMINAR el proxy no
determinista → los consumidores a migrar son los que lo USAN (los 4 de arriba), no la lista de memoria.

## Paso 2 — Assessment por consumidor

| Consumidor | ¿Lee tablas locales? | Disparador actual | Veredicto |
|---|---|---|---|
| animales.tsx | SÍ (animal_profiles + overlays + JOINs) | `lastSyncedMs` | **Migrar → `db.onChange`** |
| index.tsx (home) | SÍ (counts animales/equipo/grupos) | `lastSyncedMs` | **Migrar → `db.onChange`** |
| ProfileContext.tsx | SÍ (user_roles.member_name + user_private) | `lastSyncedMs` | **Migrar → `db.onChange`** |
| useGroupView.ts | SÍ (window/meta del grupo) | `lastSyncedMs` | **Migrar → `db.onChange`** |
| lotes.tsx | SÍ | `useQuery` (feat 21) + `hasSynced` | Ya migrado |
| FindOrCreateOverlay.tsx | — | `useStatus().connected` (online) | N/A (no es proxy) |
| miembros.tsx | SÍ (user_roles/invitations local) | **focus-only** (useFocusEffect) | N/A este delta (no usa el proxy) |
| animal/[id].tsx | SÍ (detail/timeline/etc. local) | **focus-only** (useFocusEffect) | N/A este delta (no usa el proxy) |
| export-sigsa.tsx | parcial (est detail local; export online) | **focus-only** (useFocusEffect) | N/A este delta (no usa el proxy) |
| use-reports.ts | **NO** — KPIs calculados ONLINE (RPC/edge) | fetchers online por foco/params | **N/A (online-only, Paso 2)** — sin tabla local que observar; NO meter `db.onChange` |

**Nota sobre los focus-only (miembros/animal[id]/export-sigsa):** leen tablas locales pero NUNCA usaron el
proxy `lastSyncedAt` — recargan por `useFocusEffect`. NO son objetivo de "matar el proxy". Darles
reactividad en vivo (`db.onChange`) sería una feature NUEVA (no un swap de disparador) y cada una amerita
su propia decisión (¿reactividad viva vale en la ficha del animal / en export-sigsa?). Queda como posible
follow-up separado, NO en este delta.

## Tablas observadas por consumidor (determinadas del código)

- **animales.tsx** (`buildAnimalsListQuery` + search): `animal_profiles`, `pending_animal_profiles`,
  `pending_status_overrides` (HIDE_EXITED), `treatments` (pin in_treatment + reorden), `rodeos` +
  `categories_by_system` (INNER JOINs — sin sus filas la fila del animal no aparece en el 1er sync).
- **index.tsx**: `animal_profiles`, `pending_animal_profiles`, `pending_status_overrides` (counts +
  head-counts), `user_roles` + `invitations` (countTeam), `management_groups` (lotes de las cards). NO se
  observan `species`/`systems_by_species` (catálogo global estático del subtítulo de la card = cosmético;
  loadGroups los re-lee cuando dispara por animal_profiles; converge por foco).
- **ProfileContext.tsx**: `user_roles` (name = `member_name` denormalizado, ADR-026) + `user_private` (phone).
- **useGroupView.ts**: `animal_profiles`, `pending_animal_profiles`, `pending_status_overrides`,
  `treatments`, `rodeos`, `categories_by_system` (misma familia que la lista de animales; drivea window +
  count + opciones de chips). La gating de acciones masivas (rodeo_data_config/reproductive_events) NO se
  observa aquí (secundaria + fail-closed; converge por foco).

Todas las tablas existen en `AppSchema` (`schema.ts`) → nombres válidos para `db.onChange`.

## Plan (tasks)

- [x] T1 — animales.tsx: `useStatus`/`lastSyncedMs` → `db.onChange` (re-corre loadList + runSearch).
- [x] T2 — index.tsx (home): `useStatus`/`lastSyncedMs` → `db.onChange` (re-corre loadAnimalCount + loadTeamCount + loadGroups).
- [x] T3 — ProfileContext.tsx: `useStatus`/`lastSyncedMs` → `db.onChange` (re-corre loadFor).
- [x] T4 — useGroupView.ts: `useStatus`/`lastSyncedMs` → `db.onChange` (re-corre loadMeta + refreshWindow/runSearch).
- [x] T5 — mas.tsx `RenspaBanner`: `statusChanged` (vía `subscribeSyncUiState`, proxy NO determinista NO cubierto
  por el grep inicial) → `db.onChange` sobre `establishments` (re-corre `reload()`). **Consumidor EXTRA
  hallado en la autorrevisión**: es el MISMO anti-patrón que ADR-030 mata (señal gruesa de status como
  disparador de una re-lectura de tabla local), vía otra API. El `useIsOffline` de mas.tsx (que usa
  `subscribeSyncUiState` para `connected`, online/offline) NO se toca (uso legítimo de status, no data-proxy).

## Invariantes preservados en cada consumidor (patrón feat 21/22)
- Carga inicial por `useFocusEffect`/efecto de mount intacta (`db.onChange` NO dispara al registrarse —
  `triggerImmediate` default false).
- Lógica de resolución/veredicto NO se reimplementa (solo cambia el disparador).
- Stale-while-revalidate intacto (no re-flip de `loading` en revalidación del mismo target).
- Dep de efecto PRIMITIVA (id string / callbacks estables / `group` memoizado por primitivas) — sin el loop
  de la feature 20 (objeto de status recreado cada render).
- `dispose()` en el cleanup al cambiar el target / desmontar.
- Se saca `useStatus`/`lastSyncedMs` de estos 4 archivos.

## Verificación

- **typecheck** (`pnpm -C app typecheck`): VERDE.
- **anti-hardcode** (`node scripts/check-hardcode.mjs`): VERDE (0 violaciones).
- **`git diff supabase/ sync-streams/`**: VACÍO → frontend-puro confirmado (sin Gate 1).
- **Unit** (funciones puras adyacentes, network-free): 218 pass — `group-view-model` + `maneuver-gating-load`
  + `local-reads` + `schema` + `status-derive`. NO cambié ninguna función pura ni el schema → sin regresión
  de lógica (el cambio es swap de disparador en 5 archivos UI/hook/context; no hay renderer RN en unit).
- **E2E** (build `pnpm e2e:build` + specs targeteados; `design/` NO tocado):
  - `reactividad-sync.spec.ts` 6/6 VERDE — regresión de la reactividad 20/21 (contextos + lotes, NO tocados)
    intacta; el patrón `db.onChange` compartido + PowerSyncProvider siguen sanos y la app bootea por todo el
    árbol de providers (incluidas las pantallas migradas) sin loop. T22 offline-puro verde (sin cambio de
    tabla, sin disparo espurio).
  - `profile.spec.ts` 3/3 VERDE — **ejercita T3 directo**: "el saludo de la home se actualiza al editar el
    nombre" depende de la re-lectura reactiva (ahora `db.onChange` sobre `user_roles`); fallaría si el
    disparador no fira. + teléfono sanitizado + descarte de edición.
  - `rodeo-grande.spec.ts` VERDE (todos) — **ejercita T4** (vista de grupo paginada de useGroupView).
  - `animals.spec.ts` 38 pass / 5 fail — **los 5 fails son 100% flake de infra** (`createTestUser` en
    `helpers/admin.ts:76` → `invalid JWT ... unrecognized JWT kid <nil> for algorithm ES256`, ANTES de
    renderizar UI). Es el flake documentado del proyecto dev (current.md 2026-07-23 + memoria); no es
    regresión de T1. Los 38 que SÍ crearon usuario ejercitan la tab Animales migrada y pasan.
- **`node scripts/check.mjs`**: rojo SOLO en las suites backend (reports/etc.) que fallan al crear datos de
  prueba contra la DB dev con el MISMO `JWT kid <nil> ES256` (cascada `lookupSpeciesSystem`/`createRodeo`).
  Es el flake de infra documentado (NO interrumpir, NO regresión). TODO lo frontend-relevante en verde:
  estructura OK, anti-hardcode 0, typecheck OK, scripts unit OK, client unit tests OK. El cambio es
  frontend-puro → no puede afectar las suites backend (diff supabase/ vacío).

## Gate 2.5 (ADR-029) — capturas
**N/A visual.** El delta NO introduce ningún cambio visual/layout/componente/estado nuevo: es un swap del
DISPARADOR de reactividad (mismo render, mismos estados, misma resolución). No hay diseño nuevo que vetar por
captura (la reactividad se verifica funcionalmente por E2E, no por screenshot). Igual que las features 20/21
(también swaps de disparador). **Pendiente de veredicto DEVICE (nativo, ADR-029)**: que en iOS/Android el
`db.onChange` dispare la re-lectura al bajar el cambio al SQLite local (la reconexión que lo alimenta la
cerró la feature 22 / ADR-031). No verificable en web.

## Trazabilidad ADR-030 → test

| Consumidor migrado | Disparador nuevo | Tablas observadas | Test que lo cubre |
|---|---|---|---|
| animales.tsx (T1) | `db.onChange` | animal_profiles, pending_animal_profiles, pending_status_overrides, treatments, rodeos, categories_by_system | `animals.spec.ts` (38 pass; boot+lista) |
| index.tsx/home (T2) | `db.onChange` | animal_profiles, pending_animal_profiles, pending_status_overrides, user_roles, invitations, management_groups | `reactividad-sync.spec.ts` (home bootea + cards) |
| ProfileContext.tsx (T3) | `db.onChange` | user_roles, user_private | `profile.spec.ts:38` (saludo reactivo tras editar) |
| useGroupView.ts (T4) | `db.onChange` | animal_profiles, pending_animal_profiles, pending_status_overrides, treatments, rodeos, categories_by_system | `rodeo-grande.spec.ts` (vista de grupo) |
| mas.tsx RenspaBanner (T5) | `db.onChange` | establishments | `sigsa-breed-renspa.spec.ts` (banner RENSPA) — no re-corrido acá (mismo flake infra); cubierto por typecheck + patrón |
| **Regresión** contextos/lotes (feat 21, NO tocados) | — | — | `reactividad-sync.spec.ts` 6/6 verde |

## Autorrevisión adversarial (paso 8)

Por consumidor:
- **¿Observa las tablas CORRECTAS?** Sí — derivadas del código de cada resolución (no de memoria). animales/
  useGroupView: la familia de la lista de animales + overlays + JOINs INNER (rodeos/categories, necesarios en
  1er sync). index: counts (animals+overlays) + team (user_roles+invitations) + lotes (management_groups).
  ProfileContext: `user_roles.member_name` (ADR-026, NO `users`) + `user_private`. mas: `establishments`.
- **¿Dep PRIMITIVA (no loop de la 20)?** Sí — todas: strings (`establishmentId`/`activeId`/`userId`) o
  callbacks `useCallback` estables o `group` memoizado-por-primitivas + singleton `db`. Ningún objeto de
  status recreado cada render. Verificado por reactividad-sync (bootea sin loop) + profile (reactivo sin loop).
- **¿Carga inicial por focus/mount preservada?** Sí — en los 5, los efectos de carga inicial /
  `useFocusEffect` quedan intactos; `db.onChange` NO dispara al registrarse (`triggerImmediate` default false).
- **¿Stale-while-revalidate intacto (no parpadea loading)?** Sí — se conservan los guards existentes (seq,
  loadedRef/estId-ref, rowComparator/keys estables, shouldYieldWindowRefresh). animales flipea `loading` en
  el reload pero NO blanquea la lista con datos presentes (skeleton solo con `list.length===0`) = comportamiento
  IDÉNTICO al pre-migración (lastSyncedMs también llamaba loadList).
- **¿dispose al cambiar target?** Sí — `return () => dispose()` en los 5, re-suscripción al cambiar la dep
  primitiva.
- **¿online-only bien documentado sin db.onChange espurio?** `use-reports` = KPIs server-side → SIN
  `db.onChange` (no hay tabla local). `FindOrCreateOverlay.connected` / `mas.useIsOffline.connected` =
  status de conexión, NO data-proxy → sin tocar.
- **¿`git diff supabase/ sync-streams/` vacío?** Sí.
- **Hallazgo de la autorrevisión**: T5 (mas.tsx RenspaBanner) — usaba `statusChanged` (vía
  `subscribeSyncUiState`) como data-proxy; el grep inicial (`useStatus`/`lastSyncedAt`) no lo cubría. Es el
  mismo anti-patrón → migrado también. Es la ÚLTIMA re-lectura por señal-gruesa-de-status que quedaba en la
  app de usuario.
- **Tests que pasan por la razón equivocada**: descartado — `profile.spec.ts:38` fallaría si el `db.onChange`
  no firara (el saludo no se actualizaría tras el save); `reactividad-sync T22` confirma que SIN cambio de
  tabla NO hay disparo espurio (offline puro). Los 5 fails de `animals` son pre-UI (createTestUser), no
  false-green.
- **NO hallado**: sin gaps de seguridad (frontend-puro, reactividad = UX, RLS server-side intacta), sin gaps
  offline (T22 verde), sin hardcode de tenant (no cambié args de query).

## Reconciliación de specs (paso 9)
- **ADR-030**: actualizado el bloque de migración incremental (los 4 proxy-consumers reales + T5 + la
  divergencia con la lista de memoria + `use-reports` online-only).
- **`docs/backlog.md`**: entrada 2026-07-20 de watched-queries actualizada (proxy `lastSyncedMs` eliminado de
  toda la UI de usuario; `subscribeSyncUiState`-como-data-proxy también; queda solo el veredicto device).
- **Comentarios reconciliados** en ProfileContext.tsx (3 refs a `lastSyncedAt` → `db.onChange`) y mas.tsx.
- **Pre-existente NO tocado** (fuera de alcance): `app/app/maniobra/carga.tsx:445` tiene un comentario stale
  de la feature 22 ("re-carga en focus + cada `lastSyncedAt`") sobre useManeuverGating (ya migrado a
  `db.onChange` en la 22) — deuda de comentario de la 22, no de este delta; no toco carga.tsx (flujo manga).

## Pendiente para veredicto DEVICE (nativo, ADR-029)
Que en iOS/Android el `db.onChange` de los 5 consumidores dispare la re-lectura al bajar el cambio al SQLite
local en sesión viva (alimentado por la reconexión de la feature 22/ADR-031). No verificable en web.
