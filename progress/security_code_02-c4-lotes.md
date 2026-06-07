# Security code review — spec 02 C4 (Lotes / frontend de management_groups)

**Modo**: `code` (Gate 2, ADR-019)
**Fecha**: 2026-06-07
**Baseline**: `b897703` (registrado en `progress/impl_02-c4-lotes.md:1`)
**Fuente de verdad**: `specs/active/02-modelo-animal/context-c4-lotes.md`
**Reviewer previo**: APPROVED (`progress/review_02-c4-lotes.md`)

## Veredicto: PASS (0 HIGH)

C4 es frontend puro: no agrega schema/RLS/Edge/trigger nuevos. El soft-delete usa el RPC
pre-existente `soft_delete_management_group` (`0041`, ya desplegado + gateado). Cada hecho se
verificó contra el código y las migraciones reales (no contra la prosa). `node scripts/check.mjs`
VERDE (typecheck 0 err; 628 unit + backend RLS/Edge/Import verdes).

---

## Archivos analizados (diff vs baseline)

- `app/src/services/management-groups.ts` (CRUD + assign/clear + softDelete vía RPC + fetchGroupMembers)
- `app/src/services/animals.ts` (aditivo: `managementGroupId` en `LIST_SELECT`/`toListItem`/`AnimalListItem`)
- `app/src/utils/management-group.ts` + `.test.ts` (lógica pura: validación + gating)
- `app/app/lotes.tsx` (NUEVA pantalla)
- `app/app/animal/[id].tsx` (LoteControl)
- `app/app/_layout.tsx`, `app/app/rodeos.tsx`, `app/app/(tabs)/mas.tsx` (solo nav, sin authz/data)
- `app/e2e/lotes.spec.ts` (E2E)
- `scripts/run-tests.mjs`, `specs/.../tasks.md`, `feature_list.json`, `progress/*` (no-código)

---

## Findings HIGH (Sentry security-review + RAFAQ-SPECIFIC)

**Ninguno.**

La skill `sentry-skills:security-review` no se invoca con valor agregado sobre este diff: la superficie
es 100% client-side TypeScript que llama supabase-js, sin servidor nuevo, sin sinks de injection/XSS,
sin manejo de secrets. El análisis de exploitabilidad se hizo manual contra el modelo RLS/trigger
real (abajo). Se documenta como **cobertura indirecta** en la sección final.

---

## Catálogo A–I aplicado (verificación de exploitabilidad)

### 1. Authz / IDOR multi-tenant (A1/A3/A4) — OK

- **Clear-NULL del borrado** (`management-groups.ts:206-209`):
  `UPDATE animal_profiles SET management_group_id=NULL WHERE management_group_id=<groupId>` **sin
  filtro `establishment_id`**. Verifiqué que NO es cross-tenant: la policy `animal_profiles_update`
  (`0022:13-15`) tiene `has_role_in(establishment_id)` en USING **y** WITH CHECK → el UPDATE solo
  alcanza filas de establishments donde el caller tiene rol. Un `groupId` de otro tenant no toca un
  solo perfil ajeno (la RLS lo filtra silenciosamente; las filas ajenas ni se ven). No hay
  `createAdminClient()`/service-role en este path — todo corre con el JWT del usuario bajo RLS.
- **Asignar lote** (`assignAnimalToGroup`, `:235-256`): UPDATE de `animal_profiles` vía RLS
  (`has_role_in`), con `count:'exact'` → un bloqueo de RLS o perfil inexistente devuelve `count=0`
  → copy genérico, sin falso OK. El trigger 0037 (`0037:36-55`,
  `tg_animal_profiles_management_group_check`) re-valida server-side que el lote sea del MISMO
  establishment del perfil (`v_est <> new.establishment_id` → 23514): no se puede asignar un lote de
  otro campo aunque el cliente mande el `groupId` cruzado. Doble barrera (RLS + trigger).
- **Soft-delete del lote**: vía RPC `soft_delete_management_group` (`0041:50-65`), SECURITY DEFINER
  que **re-valida** `is_owner_of(v_est)` → 42501 si no es owner; P0002 si no existe. La UI gatea
  owner-only (`canManageGroups`), pero la barrera autoritativa es el RPC. No hay escalada.
- **fetchGroupMembers** (`:272-279`): delega en `fetchAnimals(establishmentId, {status:'active'})`,
  que filtra `.eq('establishment_id', …)` + `.is('deleted_at', null)` + RLS `animal_profiles_select`
  (`0022:6-7`). El filtro por `groupId` es client-side sobre filas YA scopeadas al tenant → no puede
  filtrar miembros de otro campo (las filas ajenas nunca llegan).

### 2. UI authz vs RLS — OK (la UI no es la barrera)

- `canManageGroups` (owner) gatea crear/renombrar/borrar; `canAssignGroup` (cualquier rol) gatea
  asignar (`management-group.ts:37-48`). La RLS/RPC/trigger son las barreras reales; la UI solo evita
  botones muertos. Ninguna acción expuesta escala privilegios respecto de lo que la RLS permite.
- Multi-tenant en la ficha: el selector y el quick-create usan `detail.establishmentId` (campo del
  PERFIL), no el contexto activo (`[id].tsx:117,246,255`). `canQuickCreateLote` es conservador
  (`:212-217`): solo si el animal pertenece al campo activo Y el rol activo es owner — si el animal es
  de otro campo no se ofrece crear (no se conoce el rol ahí). Mismo cuidado que `canExit`. Correcto.

### 3. Input validation (F1) — OK, con tope server-side real

- Nombre de lote: validación cliente `validateGroupName` (`management-group.ts:21-30`, trim + vacío +
  tope `MANAGEMENT_GROUP_NAME_MAX=80`) — es UX/bypasseable. El **control autoritativo** existe en DB:
  CHECK `management_groups_name_not_empty = length(trim(name)) > 0` (`0037:15`). El tope de 80 es
  defensivo client-side (no hay límite server-side de largo superior); aceptable porque `name` es
  `text` libre por diseño (ADR-020) y no alimenta ningún sink. El servicio re-trimea por defensa
  (`createManagementGroup:107`). Ver tabla de inputs.

### 4. Error leak (B1) — OK

- Ningún `message`/`sqlerrm` crudo de PostgREST/RPC llega al usuario en los paths de C4:
  - `classifyDeleteError` (`management-groups.ts:56-68`) mapea 42501→"solo el dueño", P0002→"ya no
    existe", network→copy de conexión, resto→genérico. NUNCA el `error.message` crudo.
  - `renameManagementGroup`/`assignAnimalToGroup`: en `count=0` devuelven copy fijo es-AR.
  - **Excepción acotada**: `createManagementGroup` (`:124`) y la rama `kind:'unknown'` de
    crear/renombrar (`lotes.tsx:124`, `RenameForm:492`) propagan `r.error.message` al usuario. Ese
    `message` proviene de `classifyError` (`:33-37`), que para `unknown` devuelve el `error.message`
    de PostgREST crudo. En la práctica los errores esperables de crear/renombrar son 42501 (RLS
    owner-only, pero la UI ya gatea owner) o el CHECK de nombre vacío (ya pre-validado), así que es un
    camino frío. Es **deuda transversal ya conocida** ("errores crudos → copy genérico", default del
    context-c4-lotes:54 y backlog): C4 la HEREDA del patrón `classifyError` de C1-C3, **no la empeora**
    ni introduce un sink nuevo. No-bloqueante; ver MEDIUM-1.

### 5. Filter injection / `.or()` / `ilike` — OK (C4 no agrega sinks)

- C4 NO construye ningún filtro con input de usuario. Los `.ilike()` de `animals.ts` (`:309,321,346`)
  son de `searchAnimals` (pre-existente, fuera del diff de C4), ya en forma parametrizada
  `(column, pattern)` + `escapeIlike` (hardening F1-1 previo). El cambio de C4 en `animals.ts` es
  estrictamente aditivo (`management_group_id` en el SELECT y el mapper). `fetchGroupMembers` filtra
  por `groupId` con `.filter` de JS (Array.filter), no un filtro PostgREST. Sin superficie nueva.

### 6. created_by / autoría (A2 mass assignment) — OK / N/A

- C4 no escribe autoría. `createManagementGroup` (`:117-120`) hace `insert({establishment_id, name})`
  campo por campo (NO spread del input del cliente) → sin mass-assignment. `management_groups` no
  tiene columna `created_by` (`0037:7-16`). La deuda SEC-SPEC-03 (`animal_profiles.created_by`) es de
  otro chunk y C4 no la toca. Sin over-posting de `role`/`establishment_id`/`id`.

---

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| nombre de lote (crear `lotes.tsx`) | largo ≤80 (cliente, defensivo); no-vacío | cliente `validateGroupName` (UX) **+ servidor CHECK `length(trim(name))>0`** (`0037:15`, autoritativo) | ✓ |
| nombre de lote (renombrar `RenameForm`) | ídem | ídem (`renameManagementGroup` re-trim + CHECK DB) | ✓ |
| nombre de lote (quick-create ficha) | ídem | ídem (`createManagementGroup` re-trim + CHECK DB) | ✓ |
| selección de lote a asignar (`groupId`) | no es texto libre (id de la lista, o `null`) | trigger 0037 valida mismo-establishment + RLS | ✓ |

No hay buscadores ni texto-libre nuevos en C4. El único buscador (`searchAnimals`) es pre-existente y
ya endurecido (fuera del diff).

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| crear / renombrar / borrar lote | no | n.a. | n.a. (RLS/RPC owner-only) | CRUD de baja frecuencia, owner-only, sin costo externo (email/SMS/API). No es vector de abuso a escala material. No aplica un rate limit propio. |
| asignar/quitar lote (ficha) | no | n.a. | n.a. | UPDATE puntual de 1 fila, scopeado por RLS. Sin fan-out, sin costo externo. |
| clear-NULL (paso 1 del borrado) | no | n.a. | n.a. | UPDATE masivo de los miembros del lote (acotado a 1 establishment vía RLS) — N = animales del lote, no controlado por el atacante. Sin amplificación cross-tenant. |

Ninguna acción de C4 manda email/SMS, pega a API externa, ni es bulk/import → no requiere cuota
propia. El Auth nativo (`config.toml [auth.rate_limit]`) no se tocó.

---

## False positives descartados (skill)

N/A — la skill no se corrió como herramienta de hallazgos sobre este diff (sin sinks de su dominio).
Ver "Cobertura indirecta" abajo.

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: N/A — C4 no toca `supabase/functions/*`.
- **RLS / trigger / RPC** (NO cubierto por la skill de Sentry): revisado MANUALMENTE contra
  `0005`/`0022`/`0037`/`0041`. Barreras confirmadas: `animal_profiles_update`+trigger (asignar),
  `management_groups_*`+RPC owner-only (CRUD/borrar). El backend ya estaba gateado; C4 lo consume bien.
- **PowerSync / offline (C-domain)**: N/A en C4 (online-first, C5 diferido). Cuando entre PowerSync
  (C5), `management_groups` + `management_group_id` necesitan sync-rules scopeadas por establishment
  (C1 del catálogo) — fuera de alcance de este gate, anotado para C5.

---

## Observaciones MEDIUM / LOW (no bloqueantes — backlog)

- **[MEDIUM-1] Error crudo en crear/renombrar lote (rama `unknown`)**: `createManagementGroup`/
  `renameManagementGroup` pueden propagar `error.message` de PostgREST al usuario vía `classifyError`
  (`management-groups.ts:36`, `lotes.tsx:124`, `RenameForm:492`). Es deuda transversal heredada del
  patrón `classifyError` de C1-C3 (ya en backlog: "errores crudos → copy genérico"). C4 NO la empeora
  ni agrega un sink nuevo, y los errores esperables (RLS/CHECK) están pre-gateados por la UI/validación
  → camino frío. Reportado para que el fix transversal del backlog también cubra estos dos call-sites.
- **[LOW] Atomicidad del borrado**: clear-NULL + RPC son 2 pasos no atómicos
  (`management-groups.ts:191-219`). Si el RPC falla, animales en NULL + lote vivo = estado
  consistente y recuperable (clear idempotente). Documentado en el JSDoc; atomicidad real en C5.
  No es un hueco de seguridad (no deja FK colgante ni leak).
- **[LOW] fetchGroupMembers filtra client-side** sobre `fetchAnimals` (límite 200). Sin impacto de
  seguridad (las filas ya están scopeadas al tenant por RLS); solo un techo de completitud para
  rodeos de >200 activos. Refinamiento server-side posterior, ya documentado por el implementer.
