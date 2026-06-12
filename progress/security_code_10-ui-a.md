# Security Gate (modo code) — Spec 10, chunk UI-A (vista de grupo + Inicio rodeo-céntrico)

- **Fecha**: 2026-06-12
- **Baseline**: `7840b43` (diff = working tree sin commitear, `main`)
- **Alcance**: frontend puro de display/navegación. Sin mutaciones, sin migraciones, sin Edge Functions.
- **Skill**: `sentry-skills:security-review` aplicada sobre el diff completo.

## Veredicto: PASS

Cero findings HIGH. Cero findings MEDIUM accionables. El chunk no agrega superficie de ataque:
no escribe, no llama red, no interpola input de usuario en SQL, no renderiza HTML.

---

## Foco 1 — Registro de rutas en `_layout.tsx` (¿bypass de auth?): NO HAY BYPASS

Evidencia (`app/app/_layout.tsx`):

- `GROUP_DESTINATIONS = {rodeo, lote, seleccion-masiva, vacunacion-masiva}` (líneas 138–143) solo
  participa en la condición de **de-strand** (líneas 350–355), que vive DENTRO de la rama
  `est.status === 'active'` con `rodeo.status !== 'no_rodeos'` (líneas 324–358). Es decir: solo
  decide si NO te expulsa a `(tabs)` cuando ya pasaste TODOS los gates.
- Los gates de auth corren ANTES e incondicionalmente para todo top-segment que no esté en
  `PUBLIC_ROUTES` o `DEV_WEB_ROUTES`:
  - `unauthenticated` → `router.replace('/(auth)/sign-in')` (línea 257–262).
  - `!emailVerified` → `/verify-email` (línea 264–269).
  Las 4 rutas nuevas **NO** están en `PUBLIC_ROUTES` (línea 87: solo `update-password`, `invite`)
  ni en `DEV_WEB_ROUTES` (línea 153: solo `baston-test`, y web-only). Un deep-link a
  `/rodeo/<id>` sin sesión rebota a sign-in.
- Gating de establecimiento/rodeo: en `no_establishments` / `choosing` / `active_lost` las rutas
  nuevas NO están exentas (las exenciones ahí son `onCrearCampo` / `onFase5Destination`, líneas
  318–323) → se re-rutean a onboarding/mis-campos/campo-perdido. En `no_rodeos` solo pasa
  `crear-rodeo` (línea 338) → se re-rutean al wizard. Sin campo activo no se llega a la vista de grupo.
- Patrón idéntico al as-built de `ANIMAL_DESTINATIONS` / `RODEO_DESTINATIONS`: misma posición en
  la condición de de-strand, mismas garantías.

Nota no-security (claridad, no finding): `!onGroupDestination` en la condición de de-strand es
lógicamente inalcanzable (un `top` no puede ser a la vez stranded-route y group-destination), igual
que `!onRodeoDestination`/`!onAnimalDestination` preexistentes. Defensivo, sin impacto.

## Foco 2 — Lecturas scopeadas / multi-tenant: OK

- `buildRodeoHeadCountsQuery` / `buildGroupHeadCountsQuery` (`app/src/services/powersync/local-reads.ts:592-628`):
  SQL **parametrizado** (`?`, args), ambas ramas del UNION filtran `establishment_id = ?` +
  `status = 'active'` + `deleted_at IS NULL` + ocultación de exits pendientes. El `establishmentId`
  viene del `EstablishmentContext` (campo activo), nunca de input de usuario.
- `app/app/rodeo/[id].tsx:49`: la lista sale de `fetchAnimals(establishmentId, { rodeoId, status:'active' })`
  → doble filtro establishment + rodeo. Un `rodeoId` ajeno (deep-link manipulado) devuelve lista vacía.
- `app/app/lote/[id].tsx:56`: `fetchGroupMembers(establishmentId, groupId)` delega en
  `fetchAnimals(establishmentId, …)` y filtra por `managementGroupId` en memoria → scopeado.
- `fetchRodeoGroupActions(rodeoId)` / `fetchRodeoConfig` (vía `group-data.ts`) leen el
  `rodeo_data_config` por `rodeo_id` sin filtro adicional de establishment. NO es finding:
  (a) el SQLite local solo contiene datos de establecimientos donde el usuario ES miembro
  (streams self-only, ADR-026 — defensa estructural); (b) es gating de DISPLAY de botones, no
  autorización (la autorización real de las mutaciones es del próximo chunk, server-side).
- Conteos del Inicio (`index.tsx`): `loadGroups(estId)` usa los builders scopeados de arriba +
  `fetchManagementGroups(establishmentId)`; guard de secuencia descarta respuestas tardías al
  cambiar de campo (sin leak visual cross-campo).

## Foco 3 — Sin mutaciones nuevas: CONFIRMADO

Grep de `insert|update|upsert|delete|rpc|execute|writeTransaction|supabase|fetch(` sobre TODOS los
archivos nuevos (`group-data.ts`, `useGroupView.ts`, `group-actions.ts`, `group-nav.ts`,
`animal-age.ts`, `onboarding.ts`, `GroupViewScreen/Bits/ActionsBar/SummaryCard.tsx`, `AnimalRow.tsx`,
`rodeo/[id].tsx`, `lote/[id].tsx`, `seleccion-masiva.tsx`, `vacunacion-masiva.tsx`): **0 matches**.
- `GroupActionsBar` → `navigateToGroupAction` (`group-nav.ts`) → `router.push` a stubs. Solo navegación.
- Los stubs `seleccion-masiva.tsx` / `vacunacion-masiva.tsx` son pantallas estáticas sin I/O.
- `animals.ts` diff: solo agrega 2 campos READ al mapper (`animalBirthDate`, `futureBull`).

## Foco 4 — Inputs: n.a. (sin superficie de entrada nueva)

El chunk no agrega ningún campo tipeable. El único "input" nuevo son **route params de deep-link**
(`[id]`, `groupType`, `groupId`, `op`):
- Se type-guardean (`typeof params.id === 'string'`) y se usan SOLO como valores parametrizados en
  SQL local (`?` args) o en comparaciones estrictas (`params.op === 'wean'`, `seleccion-masiva.tsx:25`).
- Se renderizan vía `<Text>` de RN (auto-escape, sin `dangerouslySetInnerHTML`/WebView/`Linking`).
- El "stepper hide" es lógica pura booleana (`utils/onboarding.ts`), sin entrada de usuario.

### Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| route param `id` (rodeo/lote) | n.a. (no tipeable; deep-link) | type-guard string + SQL parametrizado + scoping por establishment activo | OK |
| route params `groupType`/`op` (stubs) | n.a. | comparación estricta contra valores conocidos; display-only | OK |
| — formularios/buscadores/texto libre nuevos | — | **no hay** en este chunk | n.a. |

### Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| — | n.a. | n.a. | n.a. | Sin acciones server-side nuevas: cero Edge Functions, cero llamadas de red, cero bulk. Todas las lecturas son SQLite local. Las mutaciones masivas (donde SÍ aplicará: tope de fan-out + autorización server) son del próximo chunk — **revisar ahí**. |

## Findings HIGH de la skill `sentry-skills:security-review`

Ninguno. ("No high-confidence vulnerabilities identified.")

## Findings RAFAQ-SPECIFIC

Ninguno.

## False positives descartados

- **`fetchRodeoConfig(rodeoId)` sin filtro de establishment** (vía `group-data.ts`): descartado como
  finding — el dato ya está limitado por las streams self-only de PowerSync (ADR-026) y su único uso
  es habilitar/deshabilitar botones de navegación (display, no autorización). Si el próximo chunk
  usara este gating como autorización de la mutación, AHÍ sería finding — la autorización debe ser
  server-side.
- **SQL construido por concatenación en `local-reads.ts`**: las concatenaciones son de CONSTANTES
  del módulo (`HIDE_EXITED_PROFILE`, `notHiddenByOverride` con literales); los valores dinámicos van
  todos como `?` args. No es injection.

## MEDIUM/LOW → backlog

Nada accionable de este chunk. Recordatorio para el gate del **próximo chunk** (mutaciones masivas):
autorización server-side por operación (no el gating de display), tope de fan-out por request
(E2/amplificación) e idempotencia del replay offline (C4).

## Archivos analizados

`app/app/_layout.tsx`, `app/app/(tabs)/index.tsx`, `app/app/(tabs)/mas.tsx`, `app/app/animal/[id].tsx`,
`app/app/rodeo/[id].tsx`, `app/app/lote/[id].tsx`, `app/app/seleccion-masiva.tsx`,
`app/app/vacunacion-masiva.tsx`, `app/src/components/{GroupViewScreen,GroupViewBits,GroupActionsBar,GroupSummaryCard,AnimalRow,index}.tsx`,
`app/src/hooks/{useGroupView.ts,index.ts}`, `app/src/services/{group-data.ts,animals.ts}`,
`app/src/services/powersync/local-reads.ts`, `app/src/utils/{group-actions,group-nav,animal-age,onboarding}.ts`,
`app/tsconfig.json`, `scripts/run-tests.mjs`. Tooling DEV no-producto (`playwright.capture.config.ts`,
`app/e2e/captures/`, `design/*`): sin código de runtime, excluido de tsconfig — sin hallazgos.

## Cobertura indirecta

- La skill de Sentry no cubre **expo-router gating** ni **PowerSync streams** como dominios propios →
  revisados manualmente (focos 1 y 2 arriba).
- Las **sync rules de PowerSync** (server-side) no se tocaron en este chunk; el scoping local depende
  de que las streams self-only (ADR-026) sigan correctas — fuera del diff, sin cambios.

## Dominios del catálogo excluidos

A (authz service-role), B1 (err.message), D (secretos/supply chain salvo imports — sin deps nuevas),
E (abuso a escala — sin endpoints), F (ingesta/SSRF — sin red), G (BLE), H (auth/sesión — solo se
verificó que el gate no se debilitó), I (compliance): **no aplican** — el diff no toca Edge Functions,
DB remota, red, ni storage. Justificación: chunk 100% display/navegación sobre SQLite local.
