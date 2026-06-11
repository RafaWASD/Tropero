# Security (code) — 02 C6: espejo client-side de categoría + visibilidad del override

Security analyzer (modo `code`). Fecha: 2026-06-11. Baseline: `b23c4cd` (HEAD == baseline; todo el chunk vive en el working tree sin commitear → diff auditado = `git diff` + untracked, acotado a los archivos C6 listados por el leader).

## Veredicto: PASS

**Conteo: 0 HIGH · 0 MEDIUM · 2 LOW (anexo).**

Skill `sentry-skills:security-review` corrida sobre el diff con validación manual: **no high-confidence vulnerabilities identified**. El checklist RAFAQ-específico y el catálogo A–I tampoco arrojan findings HIGH/MEDIUM. Detalle abajo.

## Verificación Gate 1 N/A (frontend puro) — CONFIRMADA

`git status --porcelain` del working tree: **cero** archivos bajo `supabase/migrations`, `supabase/functions` o `supabase/tests/sync_streams` modificados por esta línea (el único `supabase/`-adjacente en status es `progress/security_spec_10-*`, de la otra línea, excluido). El diff C6 toca solo `app/` + specs + docs. No hay RLS nueva, ni trigger, ni Edge Function, ni stream → Gate 1 N/A sostenido contra el diff real.

## Foco 1 — El revert (`revertCategoryOverride`): la única escritura del chunk

- **Única escritura, verificado por grep**: el único `runLocalWrite` de `app/src/services/animals.ts` está en la línea **927**, dentro de `revertCategoryOverride`. No hay otro write en el diff.
- **Aborta ANTES del write si la derivada no resuelve (RC6.4.5)** — dos guards pre-write con error es-AR y `return` temprano:
  - `animals.ts:877-880` — sin `system_id` → no ejecuta ("No pudimos determinar la categoría automática…").
  - `animals.ts:915-922` — `buildCategoryIdByCodeQuery(systemId, derivedCode)` sin fila → no ejecuta ("No pudimos calcular la categoría automática… Quitá la fijación cuando se sincronice el campo"). El `runLocalWrite` solo corre tras resolver `catRes.value.id` de una fila REAL del catálogo local (`categories_by_system`, `active = 1`) → **nunca puede llegar un `category_id` inválido al server** (el flujo aborta antes; 0021 quedaría como segunda red, no como primera).
- **Sin mass assignment (A2)**: el UPDATE setea exactamente 2 columnas (`category_override = 0`, `category_id = ?`) con valores derivados LOCALMENTE — `derivedCode` sale del enum cerrado `MirrorCategoryCode` (10 literales) computado por `computeCategoryCode`, y el id sale del catálogo sincronizado. Nada del cliente se spreadea. `buildRevertCategoryOverrideUpdate` (`local-reads.ts:1088-1095`) es un statement único parametrizado con `WHERE id = ? AND deleted_at IS NULL`.
- **El gating de UI no esconde un camino sin RLS**: `canRevertOverride` (`[id].tsx:230`) gatea `override=true ∧ status='active'` y permite cualquier rol activo. Verifiqué que eso es EXACTAMENTE lo que la barrera server-side permite: la RLS `animal_profiles_update` (`0022_rls_animals_and_profiles.sql:13-15`) es `has_role_in(establishment_id)` en `using` Y `with check` — cualquier rol del establishment puede UPDATE. UI ≡ RLS ≡ spec RC6.4.2 (que documenta explícitamente este modelo). No existe el escenario "rol activo sin permiso server-side que encola un write condenado": todo rol activo pasa `has_role_in`; un no-miembro no tiene el animal en su sync set local (la query devuelve "No se encontró el animal", `animals.ts` guard post-`buildAnimalDetailQuery`).
- **Camino de subida**: CRUD plano PowerSync → un solo UPDATE PostgREST con el JWT del usuario (no hay admin-client en código de app: grep `service_role|createAdminClient` sobre el diff = 0 matches). La autorización real se re-evalúa server-side al sincronizar (cubre stale-auth C4 — ver anexo LOW-2).

## Foco 2 — Espejo display-only: write-free estructural (RC6.3.5)

- `computeDisplayOverrides` / `computeCategoryCode` / `deriveDisplayCategory` (`animal-category.ts`) son funciones **puras** — sin imports de I/O, incapaces de escribir.
- `computeMirrorOverrides` (`animals.ts:206-265`) usa exclusivamente `runLocalQuery` (SELECT). Todos sus fail-paths (`!eventsRes.ok`, catálogo ilegible, sin `system_id`) devuelven Map vacío/parcial → la fila muestra la guardada. **No hay camino donde un valor derivado se persista o viaje al server**: el espejo pisa `categoryCode/categoryName` en memoria dentro de `toLocalListItem`/`fetchAnimalDetail` y nada más.
- Defensa adicional ya en suite: test SELECT-puro de los builders del path de display (`local-reads.test.ts:584-598`).

## Foco 3 — Inputs del espejo desde SQLite local (inyección + tenant)

- **Inyección SQL: limpio.** `buildCategoryMirrorEventsQuery` (`local-reads.ts:706-727`): placeholders `?` para TODOS los `profileIds` (`map(() => '?')`), `MIRROR_EVENT_TYPES` es una constante literal del módulo (no input). `buildRevertCategoryOverrideUpdate`, `buildCategoryIdByCodeQuery` (:342-345), `buildSystemCategoriesQuery` (:103-109): parametrizados. Los builders de búsqueda pre-existentes que ahora alimentan el espejo (`buildSearchLikeQuery` :599-611) usan `escapeLike(term)` + `ESCAPE '\\'` y el nombre de columna viene de un union type cerrado, no del usuario. Cero concatenación de input en SQL.
- **Tenant scoping: patrón de la suite respetado, sin aperturas nuevas.** `buildCategoryMirrorEventsQuery` keyea por `animal_profile_id IN (...)` donde los ids salen de filas YA scopeadas (las queries de lista/búsqueda filtran por `establishmentId`; el detalle por `profileId` existente en el SQLite local). La frontera real es el sync set (streams `est_*`) — patrón gateado en spec 15 — y este diff **no agrega streams ni relaja proyecciones**: las columnas nuevas (`category_override`, `animal_birth_date`, `r.system_id`) ya están en el sync set del propio tenant. Sin re-filtrado faltante que abra datos cruzados.
- **B3 (over-fetching)**: las columnas extra las consume solo el mirror en la capa service; el shape público `AnimalListItem` no las expone. Sin exposición nueva.

## Foco 4 — e2e/helpers: uso de service_role

`e2e/helpers/admin.ts` solo EXTIENDE `seedAnimal` con 3 opts (`categoryCode`, `categoryOverride`, `birthDate`) dentro de la misma clase ya gateada (seeding de fixtures de test con admin client, fuera del bundle de la app). Los valores van por supabase-js parametrizado (`.eq()`, payload de insert campo por campo). `events.spec.ts` no usa admin client directo (solo helpers). **Sin ampliación de la clase.** El admin client no entra al grafo de la app (vive en `e2e/`).

## Catálogo A–I sobre el diff (aplicable a frontend)

| Dominio | Estado |
|---|---|
| A1 service-role | N/A en app code (0 usos); e2e dentro de clase gateada |
| A2 mass assignment | OK — UPDATE de 2 columnas con valores derivados de enum cerrado + catálogo |
| A3 IDOR por FK | OK — `profileId` de ruta solo resuelve contra el SQLite local (sync set del usuario); server re-valida vía RLS al subir |
| A4 BFLA | OK — UI ≡ RLS (`has_role_in`), sin función privilegiada nueva |
| B1 info disclosure | LOW-1 (anexo): `err.message` crudo de SQLite local puede llegar a la card — local-only, no cruza trust boundary |
| B2 PII en logs | OK — 0 `console.log/warn/error` en el diff (grep) |
| C1-C4 offline/sync | OK — sin streams nuevas; revert re-autorizado server-side al sync (LOW-2 anexo); display converge al sync por diseño |
| D secrets/supply | OK — 0 secrets en diff; sin deps nuevas |
| E1 queries sin tope | N/A riesgo — queries sobre SQLite local del propio dispositivo (self-DoS no aplica como vector); batched sin N+1 |
| F1 filter injection | OK — todo parametrizado (Foco 3) |
| F2-F4, G, H, I | N/A — sin import, sin fetch, sin BLE, sin auth/sesión, sin retención tocados |

## Tabla de inputs

Este chunk **no agrega ningún campo que el usuario tipee** (ni form, ni buscador nuevo, ni texto libre, ni prompt). La única interacción nueva es un botón con confirmación inline ("Quitar fijación") sin payload de usuario: todos los valores escritos se derivan del estado local.

| campo | límite | validación | OK? |
|---|---|---|---|
| — (sin inputs tipeados nuevos) | n.a. | n.a. | ✅ n.a. |

(Los buscadores pre-existentes que el diff refactorea — `searchAnimals` — conservan sus sanitizadores y builders escapados; el refactor solo cambia el TIMING del mapeo, no el plan de búsqueda ni la validación.)

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Revert override (UPDATE vía PowerSync) | n.a. | — | — | 1 UPDATE PostgREST bajo RLS por acción; sin email/SMS/API externa/fan-out; no es vector de amplificación ni Denial-of-Wallet |

Sin Edge Functions nuevas ni cambios a `[auth.rate_limit]` (confirmado: `supabase/config.toml` no está en el diff).

## Findings HIGH de Sentry

Ninguno. La skill no identificó vulnerabilidades high-confidence; mi validación manual coincide.

## Findings RAFAQ-SPECIFIC

Ninguno HIGH/MEDIUM.

## False positives descartados

- **"SQL armado por concatenación" en `buildCategoryMirrorEventsQuery`** (la string-building de placeholders y `MIRROR_EVENT_TYPES` podría parecer interpolación): descartado — los placeholders son `?` generados por count, los valores van en `args`, y la lista de event types es constante de módulo, no input.
- **"UI permite revert a cualquier rol" como gating laxo**: descartado como finding — coincide 1:1 con la RLS `animal_profiles_update` (`has_role_in`, 0022) y con la spec RC6.4.2; no hay control server-side más estricto que la UI esté ocultando.
- **`seedAnimal` con `category_override` arbitrario vía admin client**: test tooling fuera del bundle, misma clase ya gateada — la skill correctamente no flaggea test files.

## Anexo LOW

- **LOW-1 · `err.message` crudo de SQLite en la card** — `app/app/animal/[id].tsx` (`onRevertOverride`, ~:232-247) muestra `r.error.message` cuando `kind !== 'network'`; ese message puede ser la excepción cruda del SDK (`local-query.ts:53` y `:99-103`, **baseline, no tocado por C6**). No es B1 clásico: el error es del SQLite LOCAL del propio dispositivo, lo ve el mismo usuario, no cruza trust boundary ni filtra estado del server. Impacto real: copy en inglés/técnico en un fail raro. Patrón pre-existente en toda la capa local (mismo shape que `onAssignLote`). Sugerencia no bloqueante para backlog: mensaje genérico es-AR para `kind:'unknown'` en la capa UI.
- **LOW-2 · Stale-auth en replay (C4), clase ya aceptada** — el revert offline es optimista: si el rol se revoca entre el UPDATE local y el sync, el server rechaza al subir (RLS, fail-closed server-side: correcto) pero el cliente ya mostró éxito y queda divergente hasta resolverse la cola. Es la clase aceptada y gateada para TODO el CRUD plano en spec 15 (mismo path que `assignAnimalToGroup`); C6 no la empeora. Sin acción nueva requerida.

## Archivos analizados

- `app/src/utils/animal-category.ts` + `animal-category.test.ts`
- `app/src/services/powersync/local-reads.ts` + `local-reads.test.ts`
- `app/src/services/animals.ts`
- `app/app/animal/[id].tsx`
- `app/e2e/events.spec.ts` + `app/e2e/helpers/admin.ts`
- Contexto (lectura, fuera del diff): `local-query.ts`, `0022_rls_animals_and_profiles.sql`, `0071_animals_update_with_check.sql`, specs c6, `progress/{impl,review}_02-c6-categoria-espejo.md`

## Cobertura indirecta

- **RLS**: la skill no evalúa policies Postgres; la barrera del revert (`animal_profiles_update`) la verifiqué manualmente contra `0022` (using == with check, `has_role_in`). El diff no crea RLS nueva — cobertura suficiente para este chunk.
- **PowerSync upload path**: la materialización CrudEntry→PostgREST no es visible desde el diff; me apoyo en la clase gateada en spec 15 (mismo patrón CRUD plano) + en que 0040/0030/0021 (triggers baseline) re-validan server-side.
- **Drift del espejo**: riesgo de CORRECTITUD (categoría mostrada desactualizada), no de seguridad — display-only, server sigue siendo la verdad; mitigado por fixtures espejo + banner anti-drift. Fuera de scope de este gate.
