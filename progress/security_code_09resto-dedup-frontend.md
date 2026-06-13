# Security code review (Gate 2) — chunk "09 resto · dedup A/B" — FRONTEND (Runs 2/3/4/4b)

**Modo**: `code` (Gate 2, ADR-019). **Fecha**: 2026-06-13 (sesión 25). **Analista**: security_analyzer.
**Input**: delta FRONTEND del chunk dedup sobre `main` (baseline `f743a97…`). El RPC `assign_tag_to_animal` (0089) + service offline ya pasaron Gate 2 en Run 1 (`progress/security_code_09resto-dedup.md`, PASS) → NO se re-audita; acá se audita el FRONTEND que lo consume.
**Contra qué validé**: los 6 focos del prompt + el estándar de triple-guard del chunk BLE global (`progress/security_code_09resto-ble-global.md`).

---

## VEREDICTO: **PASS** (0 findings HIGH)

El frontend que consume el RPC `assign_tag_to_animal` no abre ninguna superficie de seguridad nueva. El flag E2E del bastón mock está **triple-aislado** de producción (idéntico estándar al chunk BLE global). El service-role del oráculo `admin.ts` vive 100% Node-side en `e2e/` y **no se bundlea** (0 imports desde `app/src` o `app/app`). El camino de asignación pasa SOLO `profileId` + `eid` al service → el cliente no puede forzar `animal_id`/tenant (el RPC server-side lo deriva, RD7.2). El scoping multi-tenant del builder de candidatos, el lookup y `injectProjection` se conservan (siempre por `establishment_id` activo del contexto). La prevención client-side de dup es defensa-en-profundidad fail-closed (el RPC sigue siendo la autoridad). Ningún copy expone `sqlerrm` crudo ni datos cross-tenant. **Ningún HIGH. Ningún MEDIUM bloqueante.**

---

## Los 6 focos — verificación con evidencia file:line

### Foco 1 — Aislamiento del flag E2E mock (CRÍTICO) — **CIERRA (triple-guard, paridad chunk BLE global)**

El bastón mock se activa SOLO con `globalThis.__RAFAQ_BLE_E2E__ === true`, marca que únicamente Playwright pone vía `addInitScript` ANTES del bundle (`e2e/baston-dedup.spec.ts:52-54`, `dedup-screenshot.spec.ts:51-53`). El discriminador es DELIBERADO — no `NODE_ENV` — y NO hay camino desde la UI ni desde input de usuario para setearlo (`ble-e2e-flag.ts:8-11` lo documenta; `isBleE2E()` solo LEE `globalThis`, nunca escribe — `ble-e2e-flag.ts:21-30`).

**Triple-guard verificado** (un build prod tendría `isBleE2E() === false` → ninguna capa se monta):
1. **Provider** (`_layout.tsx:508`): `<BleStickListenerProvider mode={isBleE2E() ? 'mock' : 'auto'}>` → sin el flag el transporte es `'auto'` (web-serial/manual real), **no se instancia `MockAdapter`**.
2. **Bridge no se monta** (`_layout.tsx:445`): `{isBleE2E() ? <BleE2EBridge /> : null}` → sin el flag el componente que publica `window.__rafaqBle` ni siquiera entra al árbol.
3. **Re-chequeo + type-guard dentro del bridge** (`BleE2EBridge.tsx:39, 28-33`): `if (!isBleE2E()) return;` (doble guard) **Y** `asMockAdapter(api?.transport)` retorna `null` si `transport.kind !== 'mock'` → aunque alguien forzara el bridge sin `mode='mock'`, NO habría handle (el transporte real no es un MockAdapter).

El handle (`window.__rafaqBle`) expone solo `tagRead`/`connectMock`/`disconnectMock` (`BleE2EBridge.tsx:43-50`) y se LIMPIA en el cleanup (`BleE2EBridge.tsx:53-57`). La superficie del `MockAdapter` es **inerte**: Sets de listeners in-memory + emisión de un string; CERO red, CERO DB, CERO secretos (`adapter-mock.ts:11-76`). Un EID inyectado sigue EXACTAMENTE el mismo camino que el bastón real (validación del contrato BLE → `lookupByTag` local → `assignTagToAnimal` → RPC server-side autoritativo) — el mock no es un bypass de authz, solo una FUENTE de tags de test.

### Foco 2 — Multi-tenant en el frontend — **CIERRA (scoping por establishment activo en todo el camino)**

- **Builder de candidatos `noTag`**: `buildNoTagCandidatesCountQuery(establishmentId)` (`local-reads.ts:619-633`) y `buildAnimalsListQuery(establishmentId, {noTag, orderBy})` (`local-reads.ts:547-606`) filtran `ap.establishment_id = ?` + `pap.establishment_id = ?` en AMBAS ramas del UNION (synced + overlay). El `establishmentId` llega SIEMPRE del `EstablishmentContext` activo, nunca hardcode: overlay `est.current.id` (`FindOrCreateOverlay.tsx:106`), masiva `est.current.id` (`asignar-caravanas.tsx:123`).
- **`injectProjection` (manipulación de SQL) — revisado con cuidado, NO introduce injection ni rompe el scoping**: `injectProjection(select, expr)` (`local-reads.ts:533-537`) inserta `expr` en la lista de columnas justo antes del primer ` FROM `. El `expr` es una **constante del código** (`'ap.updated_at AS updated_at'` / `'pap.created_at AS updated_at'`, `local-reads.ts:576, 580`), NUNCA input de usuario → sin vector de injection. No toca el `WHERE` (el `establishment_id = ?` queda intacto). Verificado por el test de COMPORTAMIENTO contra node:sqlite (`local-reads.test.ts:454-498`): el orden `['p-A','p-OPT','p-B','p-C']` por `updated_at DESC` se ejercita con datos reales, y un mismatch de columnas del UNION haría FALLAR node:sqlite (no un assert de string). Args verificados `['est-1','active','est-1','active']` (`local-reads.test.ts:441`) → el scoping de tenant se preserva con la proyección inyectada.
- **`lookupByTag` (prevención de dup, Run 4)**: la masiva corre `lookupByTag(eid, estId)` con `estId = establishmentIdRef.current` del contexto activo (`asignar-caravanas.tsx:154, 157`), con re-chequeo del campo tras el await (`:160`) — descarta el resultado si el campo cambió. El lookup cross-campo (`buildLookupTagAcrossFieldsQuery`, `local-reads.ts:753-764`) NO re-filtra establishment a propósito (detecta el caso transfer), pero opera sobre el set local YA scopeado por la stream (solo campos del usuario) — no debilita la RLS (la barrera final es el server). El resultado `transfer`/`edit` en la masiva NO encola (es prevención), así que no hay write cross-tenant posible por esta vía.
- **`searchAnimals` de los buscadores**: ambas pantallas pasan `establishmentId` del contexto (`FindOrCreateOverlay.tsx:476-477`, `asignar-caravanas.tsx:421-422`); el término del usuario va por `buildSearchLikeQuery` que **escapa los comodines LIKE** del término (`escapeLike` neutraliza `% _ \` + `ESCAPE '\'`, `local-reads.ts:784-806`) y la columna es de una **whitelist del código** (no input de usuario, `local-reads.ts:786`) → sin injection de filtro PostgREST/LIKE (cubre F1 del catálogo).

### Foco 3 — El camino de asignación (¿el cliente puede forzar `animal_id`/tenant?) — **CIERRA (solo profileId + eid)**

`assignTagToAnimal(profileId, tag)` (`animals.ts:1003-1005`) llama `enqueueAssignTag({ params: { p_profile_id: profileId, p_tag_electronic: tag } })` — **solo 2 campos**. NO viaja `animal_id`, `establishment_id` ni ningún tenant en el payload (confirmado contra Run 1: `enqueueAssignTag` arma `{ p_profile_id, p_tag_electronic }` campo por campo, sin spread del input). Los call-sites pasan exactamente eso: overlay `assignTagToAnimal(confirming.profileId, eid)` (`FindOrCreateOverlay.tsx:495`), masiva `assignTagToAnimal(profileId, eid)` (`asignar-caravanas.tsx:439`). El RPC server-side **deriva** `v_est`/`v_animal_id` de la fila real del perfil (anti-IDOR, ya validado Gate 2 Run 1) → el frontend no abre ningún vector para forzar el tenant ni el animal. Mass assignment: descartado (no hay `.insert(body)`/spread del cliente — A2 del catálogo cumplido).

### Foco 4 — Prevención de dup / fail-closed — **CIERRA (defensa-en-profundidad, sin falso OK)**

- **El RPC sigue siendo la autoridad**: la prevención client-side (Run 4) corre `lookupByTag` ANTES de encolar; si el EID ya resuelve a `edit`/`transfer` (ya tiene caravana) NO encola y avisa (`asignar-caravanas.tsx:165-174`). Es defensa-en-profundidad: el RPC igual rebota 23505/23514 server-side si el dup llegara (residual = LIM documentada, `permanent_reject`). El frontend no asume autoridad — solo previene el caso común.
- **Fail-CLOSED ante fallo de lookup**: `!res.ok` (la lectura local raramente falla) → `dupNotice {kind:'lookup_error'}` + **NO encola** (`asignar-caravanas.tsx:161-163`). No genera un falso "OK": un EID sin verificar NO entra a la cola; se pide re-bastoneo. En la opción A (overlay), el fail-safe del conteo es a CREATE directo (`FindOrCreateOverlay.tsx:156`) — nunca abre una intermedia con candidatos sin verificar, y nunca bloquea el alta por no poder contar.
- **El encolado offline-first**: un `!res.ok` del encolado surfacea copy accionable genérica sin avanzar la cola/navegar (`FindOrCreateOverlay.tsx:496-500`, `asignar-caravanas.tsx:440-444`) — no se reporta éxito falso.

### Foco 5 — `admin.ts` (helper E2E service-role) — **CIERRA (Node-side, NO bundleado)**

- El cliente `admin` usa `serviceRoleKey` (`admin.ts:24, 41`) leído de `SUPABASE_SERVICE_ROLE_KEY` — **sin prefijo `EXPO_PUBLIC_`** → NO entra al bundle de Expo (`env.ts:8, 66`; `getE2EEnv` lo lee de `process.env` Node-side desde `.env.local` gitignored, `env.ts:60-85`).
- **0 imports desde la app**: grep `helpers/admin|serviceRoleKey|service_role|SERVICE_ROLE` sobre `app/src` → **sin matches**; sobre `app/app` → **sin matches**. El service-role vive exclusivamente en `e2e/helpers/admin.ts`, importado solo por specs `.spec.ts` (Playwright/Node). El bundle del browser solo conoce la anon/publishable key (D1 del catálogo: service_role JAMÁS en el cliente — cumplido).
- El oráculo `waitForServerTagAssigned(profileId, tag)` (`admin.ts:580-613`) pollea `animal_profiles` vía service_role atado al `profileId` exacto + el EID único de la corrida — es un oráculo de test correcto (mira el SERVER, no la UI stale, design §3.3), no una superficie de prod.

### Foco 6 — Surfacing (¿copy con `sqlerrm` crudo o datos cross-tenant?) — **CIERRA**

- Ningún copy re-emite `error.message` del backend al usuario en el camino de assign. Los mensajes de error son **literales fijos en es-AR**: `'No pudimos asignar la caravana. Probá de nuevo.'` (`FindOrCreateOverlay.tsx:499`, `asignar-caravanas.tsx:443`), `'No pudimos cargar tus animales sin caravana.'` (`FindOrCreateOverlay.tsx:481`, `asignar-caravanas.tsx:426`), banner de dup con copy fija (`asignar-caravanas.tsx:321-325`). El único `res.error.message` surfaceado en el overlay es del lookup (`FindOrCreateOverlay.tsx:140`) y del transfer (`:818`, `:821`) — ambos vienen de `classify*Error` (copy accionable mapeada, NUNCA `sqlerrm` crudo; ya validado en chunks previos), no del path de assign. No se pinta dato de otro tenant: las listas/candidatos están scopeadas al campo activo (Foco 2). El `eidReadable` mostrado es el EID que el propio operario bastoneó (confirmación SENASA, no leak).

---

## False positives descartados (trazabilidad)

- **`window.__rafaqBle` como superficie de inyección remota**: solo existe bajo el flag E2E (triple-guard, Foco 1). En prod no se monta. Aunque un atacante seteara `__RAFAQ_BLE_E2E__` en SU propia sesión browser, el handle solo inyecta un EID que sigue el camino normal (lookup local + RPC server-side con authz) — no es un bypass de authz ni de tenant. No explotable. Descartado.
- **`buildLookupTagAcrossFieldsQuery` sin filtro de establishment = leak cross-tenant**: el set local ya está scopeado por la sync stream (solo campos del usuario, `has_role_in`); la query NO re-filtra a propósito para detectar el caso transfer, pero no expone datos de un tenant ajeno al usuario. Y en la masiva el resultado `transfer` NO encola (previene). Mismo razonamiento ya aceptado en el chunk BLE global. Descartado.
- **`injectProjection` = SQL injection**: el `expr` inyectado es una constante del código, nunca input de usuario (`local-reads.ts:576, 580, 530-532`). Descartado.
- **Buscador con término de usuario en LIKE**: `escapeLike` neutraliza comodines + `ESCAPE '\'`; columna de whitelist. Descartado.

---

## Tabla de inputs (campos nuevos/modificados que el usuario tipea)

| campo | límite | validación (server/cliente/ausente) | OK? |
|---|---|---|---|
| EID bastoneado (BLE, no tipeado) | 15 díg FDX-B; validado/dedupeado por el contrato BLE (spec 04) + regex `^\d{15}$` en el RPC | **server autoritativa** (RPC 0089 → 23514; el frontend no transforma) | sí |
| término del buscador de candidatos (overlay + masiva) | LIMIT 20 server-side; debounce 250ms; `escapeLike` neutraliza comodines `% _ \`; columna de whitelist del código | **server autoritativa** (LIKE local parametrizado + `ESCAPE '\'`, `local-reads.ts:784-806`) | sí |

Ningún campo de entrada nuevo sin límite + validación autoritativa server-side. El EID NO es tipeado (viene del bastón/mock); el término del buscador es UX local sobre un set ya scopeado y acotado (LIMIT 20).

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| asignación de caravana (frontend → `assign_tag_to_animal`) | n.a. (heredado de Run 1) | — (RPC deriva tenant + `has_role_in`) | sí | El frontend solo encola; la autoridad/escritura es el RPC (Gate 2 Run 1: UPDATE barato, scopeado, sin email/SMS/API externa → no DoW; LOW-1 a futuro per-establishment). El diff frontend NO agrega un nuevo endpoint abusable ni afloja `[auth.rate_limit]`. |
| buscador de candidatos noTag (lectura LOCAL) | n.a. | per-establishment (scoping) | sí | 100% SQLite local (sin red), LIMIT 20/200 server-side en el builder → sin enumeración remota ni self-DoS de DB (E1/E4 del catálogo cubiertos). |

---

## Cobertura indirecta de Deno / RLS / PowerSync / BLE (advertencia de cobertura)

- **React Native / Tamagui (UI)**: la skill de Sentry no cubre el árbol de componentes RN nativamente → revisado **manualmente** (scoping de props, copy fijo, fail-closed, route-aware anti-stacking). Cubierto por revisión manual + el typecheck + los E2E de comportamiento.
- **SQL builders (PowerSync local / SQLite)**: `injectProjection`/`escapeLike`/UNION column-alignment → revisados manualmente + cubiertos por los units de `local-reads.test.ts` (incl. comportamiento contra node:sqlite). La skill no traza SQL-string-builders nativamente.
- **BLE trust boundary (G del catálogo)**: el EID inyectado (mock o real) se valida como cualquier input (contrato spec 04 + regex del RPC, G1/G3) antes de persistir; el mock no auto-persiste (pasa por el flujo find-or-create + confirmación). Revisado manualmente.
- **RLS / Deno**: este delta es frontend puro (sin nuevo SQL/RPC/Edge Function); la superficie RLS/RPC fue Gate 2 de Run 1. N/A para este diff.

---

## Archivos analizados (delta frontend)
- `app/app/_components/FindOrCreateOverlay.tsx` — modo `assign_or_create`, navegación, anti-stacking route-aware (`useSegments`).
- `app/app/_components/BleE2EBridge.tsx` + `ble-e2e-flag.ts` — flag + handle E2E (triple-guard).
- `app/app/_layout.tsx` — montaje gateado del provider mock + bridge + ruta `asignar-caravanas`.
- `app/app/asignar-caravanas.tsx` — `BulkTagAssignmentScreen` + prevención client-side de dup (`lookupByTag`).
- `app/src/services/powersync/local-reads.ts` (+ `.test.ts`) — `injectProjection`/`orderBy`/`buildNoTagCandidatesCountQuery`/`escapeLike`.
- `app/src/services/tag-lookup.ts` (`resolveCreateOrAssign`/`resolveTagLookup`).
- `app/src/services/animals.ts` (`assignTagToAnimal`, `orderBy` en fetchAnimals).
- `app/src/services/ble/stick.ts` + `adapter-mock.ts` (superficie del mock).
- `app/app/(tabs)/animales.tsx`, `mas.tsx` (entry points — `router.push('/asignar-caravanas')`, sin payload).
- `app/e2e/helpers/admin.ts` + `env.ts` (oráculo service-role Node-side, NO bundleado).
- `app/e2e/baston-dedup.spec.ts`, `dedup-screenshot.spec.ts` (cómo se inyecta el flag).

---

## Verificación de salud
- `pnpm exec tsc --noEmit` (typecheck client) → **OK (exit 0)**.
- check.mjs autoritativo VERDE (leader). Si la suite `edge` aparece roja por "Request rate limit reached", es el flake conocido de auth de Supabase por terminales paralelas ([[reference_check_red_rate_limit]]), NO regresión de este chunk (el diff frontend no toca `edge`/auth).
- NO toqué código — solo escribí este reporte.
