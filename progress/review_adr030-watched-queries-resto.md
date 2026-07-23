# review — ADR-030 migracion incremental de watched queries (resto de proxy-consumers)

**Veredicto: CHANGES_REQUESTED**

Delta frontend-puro (swap de disparador useStatus + lastSyncedAt/statusChanged a db.onChange), 5 consumidores.
El WIRING es correcto y verificado independiente en verde. Se rechaza por UN solo motivo acotado: una
reconciliacion de comentario INCOMPLETA que este delta mismo dejo stale (regla dura: nunca dejar codigo
contradiciendo el as-built tras un fix; la autorrevision paso 9 del impl afirma haber reconciliado los
comentarios de mas.tsx, pero quedo uno). Fix de 1 linea, re-review trivial.

## Trazabilidad ADR-030 a test (completa)
- animales.tsx (T1): db.onChange sobre animal_profiles, pending_animal_profiles, pending_status_overrides,
  treatments, rodeos, categories_by_system. Cubre: animals.spec.ts (33 pass; empty-state + boot + lista). OK
- index.tsx/home (T2): db.onChange sobre animal_profiles, pending_animal_profiles, pending_status_overrides,
  user_roles, invitations, management_groups. Cubre: reactividad-sync.spec.ts (home bootea + cards). OK
- ProfileContext.tsx (T3): db.onChange sobre user_roles, user_private. Cubre: profile.spec.ts 3/3. OK
- useGroupView.ts (T4): db.onChange sobre animal_profiles, pending_animal_profiles, pending_status_overrides,
  treatments, rodeos, categories_by_system. Cubre: rodeo-grande.spec.ts 6/6. OK
- mas.tsx RenspaBanner (T5): db.onChange sobre establishments. Cubre: typecheck + patron. OK

Cobertura de tablas verificada contra el CODIGO real de cada resolucion (no de memoria):
- buildAnimalsListQuery (local-reads.ts:715): animal_profiles(ap) + JOIN INNER rodeos(r) + JOIN INNER
  categories_by_system(c) + UNION overlay pending_animal_profiles(pap) + EXISTS treatments(t) +
  notHiddenByOverride/HIDE_EXITED_PROFILE (a pending_status_overrides). = las 6 observadas EXACTO. El apodo
  (custom_attributes/rodeo_data_config) queda fuera a proposito (converge por foco).
- home: counts + head-counts (animal_profiles/pending/overrides) + countTeam (user_roles/invitations) +
  loadGroups (management_groups). = las 6 observadas. species/systems_by_species (cosmetico) excluidos.
- ProfileContext: SELECT member_name FROM user_roles (local-reads:277) + SELECT phone FROM user_private
  (local-reads:262). = las 2 observadas EXACTO.
- useGroupView: misma familia que la lista. OK.
- RenspaBanner: SELECT ... renspa FROM establishments (local-reads:301). = la 1 observada EXACTO.
- Las 11 tablas registradas en AppSchema (schema.ts:711) con clave = nombre, validas para onChange.

## API / no-loop / invariantes (verificado)
- Firma db.onChange(handler, tables) a dispose confirmada en @powersync/common
  (AbstractPowerSyncDatabase.d.ts:587), IDENTICA al patron feature 21 (EstablishmentContext:521). Los 5
  llaman return dispose() en el cleanup.
- triggerImmediate default false confirmado (AbstractPowerSyncDatabase.js:913, solo emite inmediato si
  truthy). NO dispara al registrarse; la carga inicial la dan los useFocusEffect/efectos de mount.
- Deps de efecto PRIMITIVAS en los 5 (establishmentId/activeId/userId strings, group memoizado por
  primitivas, callbacks estables, singleton db); NO reintroduce el loop de la feat 20. Confirmado por
  reactividad-sync T22 (offline puro: sin cambio de tabla, sin disparo espurio) + boot sano.
- Stale-while-revalidate intacto: guards de secuencia/estId-ref/loadedRef conservados; useGroupView mantiene
  el guard hasLoadedOnceRef DENTRO del callback; unit maneuver-gating-load (218 pass) cubre revalidacion
  background sin re-flip de loading.
- Logica de resolucion NO reimplementada (solo cambia el disparador) en los 5.

## Exclusiones (verificado)
- use-reports NO migrado: online-only (KPIs server-side, sin tabla local), onChange seria espurio. OK.
- miembros/animal[id]/export-sigsa NO tocados: focus-only, no usan el proxy. OK.
- Usos legitimos de status PRESERVADOS: useStatus.connected (FindOrCreateOverlay:103) + useIsOffline
  (mas.tsx:63 via subscribeSyncUiState) + useStatus.hasSynced (lotes.tsx:95). OK.
- Ya migrados (feat 21/22) NO tocados: EstablishmentContext / RodeoContext / lotes / useManeuverGating. OK.
- Grep autoritativo: NINGUN lastSyncedAt/lastSyncedMs/statusChanged-como-data-trigger queda como CODIGO en
  la UI de usuario (el unico uso-codigo de lastSyncedAt es la abstraccion status.ts). OK.

## Verificacion independiente (corrida por el reviewer)
- typecheck: VERDE.
- unit adyacente (group-view-model + maneuver-gating-load + local-reads + schema + status-derive): 218/218.
- E2E (dist 00:29 mas nuevo que fuentes 00:20-00:24, refleja la migracion; retries=0):
  - profile.spec.ts 3/3 VERDE (ejercita T3 directo, saludo reactivo).
  - rodeo-grande.spec.ts 6/6 VERDE (ejercita T4).
  - reactividad-sync.spec.ts 8 pass / 1 fail; el fail es createTestUser JWT kid nil ES256 (admin.ts:76,
    PRE-UI) = flake infra de la sesion (current.md 2026-07-23 linea 12). NO regresion.
  - animals.spec.ts 33 pass / 4 fail; 1 = mismo flake createTestUser; 3 = toBeVisible en tests alta-guiada
    sobre la FICHA (animal[id].tsx, lineas 115/391/423, DESPUES de Identificacion visible, ya en la ficha).
    NO regresion de este delta: (a) la ficha NO esta en el diff; (b) el animal se crea OK y la app navega a
    la ficha (el YAML del error-context muestra 6111388160 Vaquillona renderizado); .first() matchea un span
    hidden/clipeado del hero (gotcha rn-web de clipping); (c) el impl corrio el MISMO codigo y estos tests
    PASARON; (d) sesion con degradacion de auth JWT documentada.
- Frontend-puro: git diff --stat supabase/ sync-streams/ VACIO. Confirmado.

## Tasks (impl)
T1-T5 en [x]. Todas justificadas y cubiertas. T5 (RenspaBanner) hallado en autorrevision = mismo
anti-patron via statusChanged, correctamente migrado. Si, completas.

## Reconciliacion de specs / as-built
- ADR-030 y backlog.md actualizados al as-built. Correcto.
- ProfileContext.tsx: comentarios propios reconciliados (lastSyncedAt a db.onChange). Correcto.
- DEFECTO: app/app/(tabs)/mas.tsx:294 comentario STALE sin reconciliar. Dice: el sync-down posterior
  (efecto de lastSyncedAt en ProfileContext) re-lee y reconcilia. Este delta migro ese efecto de
  ProfileContext de lastSyncedAt a db.onChange (user_roles/user_private). El comentario ahora contradice el
  as-built (ProfileContext ya NO tiene un efecto de lastSyncedAt). La autorrevision paso 9 AFIRMA
  comentarios reconciliados en ProfileContext.tsx y mas.tsx, pero esta referencia cruzada quedo vieja. Es
  la clase de referencia stale que este delta se propone eliminar.

## CHECKPOINTS.md
N/A: este delta no tiene entradas propias en CHECKPOINTS.md (feature ADR-driven, sin specs/active/name/).

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS): N/A, frontend-puro, sin cambios de tabla/policy (diff supabase/ vacio). La
  reactividad es UX; la frontera authz (RLS server-side) no cambia.
- B (offline-first): APLICA y OK. db.onChange reacciona al SQLite LOCAL (offline-correcto); el overlay
  optimista (pending_*) esta entre las tablas observadas, un alta offline dispara la re-lectura. Las
  lecturas siguen pegando al repositorio local (local-reads), no a Supabase sincrono. reactividad-sync T22
  (offline puro) verde. No toca el write path (conflictos sin cambios).
- C (BLE): N/A.
- D (UI de campo): N/A, swap de disparador, cero cambio de render/layout/target size. Gate 2.5 visual = N/A.
  Pendiente veredicto DEVICE (ADR-029), fuera de alcance web, diferido.
- E (Edge Functions): N/A.

## Cambios requeridos
1. app/app/(tabs)/mas.tsx:294 reconciliar el comentario stale. El efecto de lastSyncedAt en ProfileContext
   ya no existe: ProfileContext re-lee via db.onChange (user_roles/user_private) desde este delta.
   Actualizar la referencia al mecanismo. Completa la reconciliacion que el paso 9 del impl declara hecha
   para mas.tsx.

## No bloqueantes
- Los 3 fails E2E de alta-guiada (ficha) + los 2 createTestUser = flake infra de la sesion (JWT kid nil
  ES256) + gotcha rn-web de clipping en una pantalla NO tocada. No es regresion.
- Comentarios stale PRE-EXISTENTES fuera de alcance (deuda feat 21/22): carga.tsx:445 (useManeuverGating),
  _layout.tsx:80/286 (statusChanged EstablishmentContext), lotes.tsx:66 (narrativa historica).
