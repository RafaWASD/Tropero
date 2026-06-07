# Spec 02 — Frontend C4 (Lotes / `management_groups`) — Refinamiento de contexto (Gate 0)

**Status**: decisiones tomadas por Raf (vía AskUserQuestion). Pendiente green-light final para implementar.
**Fecha**: 2026-06-07.
**Conducido por**: leader + Raf.
**Origen**: chunk C4 de la descomposición del frontend de spec 02 (`context-frontend.md`): "C4 — Lotes: `management-groups.ts` + `ManagementGroupsScreen` + asignar desde ficha (spec 02 T3.7/T4.5)".
**Related**: ADR-020 (lote = agrupación de manejo, dominio lockeado), ADR-018 (nav), spec 02 (sustrato `management_groups` 0037), spec 10 (vista de grupo rodeo-céntrica — consumidor downstream, NO se toca acá).

> Gate 0 (ADR-022): contexto validado + edge cases resueltos. El implementer lo lee como fuente de verdad. Cada "Caso y decisión" debe quedar cubierto por la implementación.

## Contexto validado

El **lote** (`management_groups`, ADR-020) es el tercer eje de organización ortogonal a rodeo y categoría: agrupación de manejo libre, definida por el productor (ej. "Otoño 2026", "Entore 1"), scope establishment (cruza rodeos), asignación **exclusiva** (un animal en a lo sumo un lote), **nullable** (`NULL` = sin lote → agrupa por categoría), **manual** (ningún evento biológico la dispara). Regla de display ADR-020: *"lote si tiene; si no, categoría"*.

El **backend ya está aplicado** (`0037`): tabla `management_groups` (`name`, `active`, soft-delete `deleted_at`, check `name` no vacío) + `animal_profiles.management_group_id` (FK nullable, trigger valida mismo-establishment) + RLS (SELECT cualquier rol activo; INSERT/UPDATE solo owner; asignar = UPDATE de `animal_profiles.management_group_id` por cualquier rol operativo vía `animal_profiles_update`). Ya existe `services/management-groups.ts` con **solo** `fetchManagementGroups` (lectura, hecha en C2 para el selector del alta).

C4 construye la capa de gestión que falta: **CRUD de lotes + asignar desde la ficha + ver los miembros de un lote.**

## Alcance

**Dentro (C4)**:
1. **CRUD de lotes** (owner-only en UI; la RLS ya lo fuerza): crear (nombre libre), renombrar, borrar.
2. **Asignar / cambiar / quitar lote desde la ficha del animal** (cualquier rol operativo): selector de lote en `animal/[id].tsx` (reusa `fetchManagementGroups`; UPDATE de `management_group_id`, incluyendo `→ NULL` para quitar).
3. **Ver miembros de un lote**: tap en un lote → lista de sus animales activos (reusa el componente de lista de C2).

**Fuera (otras features / capas)**:
- **Vista de grupo rodeo-céntrica + agrupamiento en Inicio + aviso "N sin lote asignado"** → **spec 10** (vista de grupo). C4 NO toca Inicio ni implementa el agrupamiento global "lote si tiene / si no categoría" en las vistas de lista; solo provee el CRUD + asignación + ver-miembros. (decisión Raf: scope "CRUD + asignar + ver miembros")
- **Offline / PowerSync** → C5. C4 es **online-first** detrás de services swappables (mismo patrón que C1-C3); `management_groups`/`management_group_id` entran a los buckets de PowerSync en C5 (ADR-020 nota de impl).
- **Auto-sugerencia de lote tras evento de servicio** (ADR-020 pt 6) → post-MVP, fuera de C4.
- **Historial de lotes** (movimientos entre lotes) → ADR-020: sin historial en MVP (solo estado actual).
- **Toggle `active` (archivar/reactivar)** → NO se expone en MVP. "Borrar" = soft-delete (`deleted_at`). La columna `active` existe en el schema pero C4 no la maneja.

## Casos y decisiones

### D1 — Borrar un lote con animales asignados (decisión Raf: reasignar a NULL + borrar)
Al borrar un lote que tiene N animales, esos animales pasan a `management_group_id = NULL` (vuelven a agruparse por su categoría, regla ADR-020) y el lote se soft-deletea. El animal nunca queda huérfano ni apuntando a un lote borrado.
- **Orden obligatorio (anti-FK-colgante)**: primero `UPDATE animal_profiles SET management_group_id = NULL WHERE management_group_id = <lote>`; **después** soft-delete del lote (`UPDATE management_groups SET deleted_at = now()`). Nunca al revés (borrar-primero dejaría animales apuntando a un lote filtrado por `deleted_at`).
- **Mecanismo del soft-delete (CORRECCIÓN 2026-06-07)**: el soft-delete del lote se hace con el RPC **`soft_delete_management_group(p_group_id)` que YA EXISTE** (`0041_soft_delete_rpcs.sql`, SECURITY DEFINER owner-only, ya desplegado + gateado en su momento). NO se hace por `UPDATE management_groups SET deleted_at` directo: ese write devuelve **42501** porque PostgREST exige que la fila siga visible bajo la policy de SELECT (`deleted_at is null`) tras el UPDATE → el soft-delete por UPDATE directo cae fuera del SELECT y es rechazado. Esto está **documentado en el header de 0041** como el mecanismo de soft-delete de spec 02 (rodeos, management_groups, eventos). Usar el RPC pre-existente **no agrega backend nuevo** → C4 sigue siendo frontend puro (Gate 1 N/A). *(El Gate 0 original asumió "sin RPC"; era un error mío — el RPC ya estaba.)*
- **Atomicidad**: paso 1 (reasignar animales a NULL) = UPDATE directo de `animal_profiles` (no cambia su visibilidad SELECT → funciona); paso 2 = el RPC de soft-delete. **No es atómico entre ambos** — si el RPC falla, los animales quedan en NULL y el lote vivo (recuperable: reintento; estado consistente, no corrupto). La atomicidad real llega con C5/PowerSync. Mismo criterio que la no-atomicidad de `createAnimal` (split) ya asumida en el código.
- Confirmación destructiva antes de borrar: "Vas a borrar el lote «X». Sus N animales quedan sin lote (se agrupan por categoría)." + botón destructivo.

### D2 — Entry point (decisión Raf: junto a Rodeos)
La gestión de lotes (crear/renombrar/borrar + ver miembros) vive **en la misma zona que Rodeos** (modelo mental "configuro los grupos de mi campo": rodeo = sistema productivo, lote = agrupación de manejo). Concreto: pantalla `Lotes` (ruta nueva, ej. `/lotes`) accesible desde la zona de Rodeos (link desde `RodeosScreen` y/o el acceso "Gestionar rodeos" del Inicio). La asignación día-a-día sigue ocurriendo desde la **ficha del animal** (no hace falta entrar a Lotes para asignar). Layout/copy exactos → veto de diseño del leader antes de mostrar.

### D3 — Alcance ver-miembros (decisión Raf: incluido)
Tap en un lote (en `LotesScreen`) → lista de los animales activos de ese lote (`management_group_id = <lote>` AND `status = 'active'` AND `deleted_at IS NULL`), reusando el componente de lista de C2 (`AnimalListItem`/equivalente). NO se construye la vista de grupo rodeo-céntrica de spec 10; es una lista simple de los miembros del lote.

## Defaults menores (asumidos por el leader — vetar si algo no va)
- **Nombres duplicados de lote**: aviso blando (reusar patrón `hasDuplicateName` de campos/rodeos), **no se bloquea** (ADR-020: texto libre, el productor decide).
- **Asignar desde la ficha sin lotes existentes**: el selector ofrece los lotes activos + (si el usuario es **owner**) opción inline "Crear lote nuevo" (quick-create sin salir de la ficha). Un no-owner sin lotes disponibles ve el selector vacío con copy "Todavía no hay lotes; pedíle al dueño que cree uno" (no puede crear, RLS owner-only).
- **Gating de UI por rol**: owner ve crear/renombrar/borrar; no-owner ve la lista read-only y **sí** puede asignar/quitar (RLS lo permite). La RLS es la barrera autoritativa; la UI solo evita ofrecer botones muertos (honestidad, no seguridad).
- **`active` no se expone** (ver Alcance "Fuera"); "borrar" = soft-delete.
- **RLS-on-RETURNING gotcha**: el soft-delete (UPDATE `deleted_at`) y los inserts NO usan `.select()` en el mismo roundtrip (la policy SELECT filtra `deleted_at is null` → returning vacío). Split write + read si hace falta el dato de vuelta.
- **Errores crudos → copy genérico** (deuda transversal del backlog): los `kind:'unknown'` muestran copy es-AR accionable, no el `message` de PostgREST.

## Verificación
- Tests unit puros para la lógica nueva (validación de nombre, mapeo de estados de borrado, gating por rol) en `app/src/utils/**` o `app/src/services/*.test.ts` (node:test, patrón C1-C3).
- E2E Playwright: extender la suite (`app/e2e/`) con el flujo de lotes (crear → asignar desde ficha → ver miembros → borrar con reasignación) — regla de memoria "testear con Playwright, no a mano".
- `node scripts/check.mjs` verde (typecheck + unit + anti-hardcode).
- Veto de diseño del leader (skill `design-review`) ANTES de mostrar a Raf.

## Gates
- **Gate 1 (security spec)**: **N/A** — C4 es frontend puro, no toca schema/RLS/Edge nuevos (el backend `0037` ya está gateado). Mismo criterio que C3.3. (Si Raf pide el RPC atómico de D1, ahí sí aplicaría Gate 1.)
- **Gate 2 (security code)**: SÍ, en cada run del implementer (superficie limitada; foco: que la UI no fuerce permisos que la RLS no tenga, que no haya leak de datos cross-tenant, que el borrado no deje FKs colgando).
- **Puerta de código humana (Raf)**: visto bueno en vivo (pnpm web) antes de cerrar.

## Aprobación
- Decisiones D1/D2/D3 **aprobadas por Raf** (2026-06-07, AskUserQuestion). Defaults menores pendientes de veto. Green-light final de Raf para arrancar el implementer.
