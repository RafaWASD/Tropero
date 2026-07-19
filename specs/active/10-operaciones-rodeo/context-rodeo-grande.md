# Context (Gate 0) — Vista de grupo para rodeos GRANDES: paginación + buscador + virtualización

**Delta a spec 10** (Operaciones masivas por rodeo + vista de grupo). Emergió del test de performance en device (Android A07 gama baja, seed de 5000 animales, 2026-07-18): la vista "dentro del rodeo/lote" no escala más allá de 200 y no tiene forma de encontrar un animal puntual.

## Problema (confirmado en device)

La vista de grupo (`app/app/rodeo/[id].tsx` y `app/app/lote/[id].tsx`, ambas vía `GroupViewScreen`):

1. **Tope de 200 (rodeo).** `rodeo/[id]` usa `fetchAnimals(est, {rodeoId})` → `buildAnimalsListQuery` termina en `LIMIT 200` (`local-reads.ts` ~l.749). Un rodeo de >200 muestra solo los 200 más recientes.
2. **Sin buscador.** A diferencia de la tab Animales (que tiene búsqueda permanente → cualquier animal es alcanzable tipeando), la vista de grupo NO tiene buscador → los animales #201+ son **inalcanzables**.
3. **No virtualizada.** `GroupViewScreen` renderiza con `ScrollView` + `GroupAnimalsList` (`.map()`). 200 filas el A07 las banca; miles no.
4. **Lote: bug de correctitud.** `fetchGroupMembers` (`management-groups.ts`) trae los **200 más recientes del CAMPO ENTERO** y recién ahí filtra al lote client-side. En un campo grande, un lote puede mostrar un **subconjunto incompleto y arbitrario** (ni siquiera "los primeros 200 del lote").

La tab Animales (LIMIT 200 + buscador) **NO se toca** — Raf confirmó que ahí el tope no molesta porque el buscador cubre el acceso.

## Decisiones refinadas (con resolución recomendada)

### D1 — Carga: **scroll infinito paginado** (no cargar-todo)
Resolución: **páginas** (keyset/OFFSET, tamaño a definir en design, ~50-100). Razón dura: `fetchAnimals` corre el **espejo de categoría + estado reproductivo O(N)** sobre TODA la lista cargada (batch-query de `reproductive_events` por perfil + cómputo). Sobre 5000 de una, eso es caro **aunque la lista virtualice**. Paginar acota compute + memoria por página; el A07 ya demostró que ~200 filas las procesa fluido. `onEndReached` carga la próxima página.

### D2 — Query **scopeada al grupo, sin tope de 200** + **count real**
Nueva query filtrada por `rodeo_id` (rodeo) o `management_group_id` (lote) que pagina sobre el grupo (no "200 del campo"). El header muestra el **total real del grupo** (COUNT scopeado), no `list.length`. Esto corrige de paso el **bug del lote** (deja de filtrar 200-del-campo → miembros completos).

### D3 — **Buscador + filtros in-grupo** (decisión Raf 2026-07-18)
Barra de búsqueda **fija** arriba de la lista (patrón de la tab Animales), **scopeada al rodeo/lote**, reusando el motor de `searchAnimals` (caravana/IDV/apodo) filtrado al grupo. **Además, chips de filtro** por **categoría** y **sexo** (mismo patrón visual que los chips de la tab Animales), scopeados al grupo y combinables con la búsqueda. Con búsqueda/filtro activo → la lista muestra el subconjunto del grupo que matchea; sin nada → la lista paginada completa del grupo. Edge: búsqueda y filtros corren sobre el **set completo del grupo** (query scopeada), no solo la página cargada (mismo requisito que E2).

### D4 — **Virtualización** + reestructura de `GroupViewScreen`
La lista pasa a **FlatList** (más predecible que FlashList en RN-web, donde corre la suite e2e). El header (meta + card de acciones) va como `ListHeaderComponent`; el **buscador queda fijo/sticky** arriba (siempre alcanzable). Hoy todo vive en un `ScrollView` único → hay que reestructurar. Aplica a **rodeo Y lote** (comparten `GroupViewScreen`) → el fix beneficia a ambos de una.

### D5 — Orden: **se mantiene el actual**
`in_treatment` pinneado arriba, luego `created_at DESC` (RTR.5). No se amplía scope con sorting configurable. (Reevaluable si Raf quiere orden por categoría/idv, pero no en este delta.)

## Edge cases a nailear en la spec

- **E1 — Acciones masivas con lista parcial.** Hoy el gating (¿hay candidatos para castrar/vacunar/destetar?) y la propia acción se apoyan en la lista cargada. Con paginación la lista es PARCIAL → el **gating debe basarse en un COUNT/EXISTS scopeado al grupo**, y la acción masiva debe operar sobre el **grupo entero server-side** (no solo la página cargada). Verificar `seleccion-masiva` / `vacunacion-masiva`: deben re-resolver el set completo del grupo, no recibir la página.
- **E2 — Búsqueda vs paginación.** La búsqueda va contra el **set completo del grupo** (query scopeada), no solo la página en memoria. Al limpiar la búsqueda, se vuelve a la lista paginada sin perder el scroll de forma molesta.
- **E3 — Refresh silencioso + sync.** `useGroupView` re-lee al enfocar y al avanzar el sync. Con paginación, un refresh no debe resetear al usuario a la página 1 de golpe ni saltar el scroll (mantener el patrón `silent`).
- **E4 — Overlay optimista offline.** Un animal recién dado de alta/movido offline (pending overlay) debe aparecer en la vista del grupo correcto también bajo el nuevo query paginado.
- **E5 — Count vs lista bajo overlay.** El COUNT real del header debe contemplar el overlay (altas/bajas pendientes) para no desalinearse con lo que se ve.

## Fuera de scope (scope discipline)

- La **tab Animales** (su LIMIT 200 + buscador queda igual — confirmado por Raf).
- **Sorting configurable** (se mantiene el orden actual: en-tratamiento arriba, luego más recientes).
- Virtualizar otras listas de la app (backlog aparte, 2026-07-18).

## Decisiones tomadas (Raf, 2026-07-18)

- **P1 → Buscador + filtros.** Dentro del rodeo/lote van AMBOS: el buscador in-grupo + chips de filtro por categoría y sexo (ver D3). Los filtros entran a scope.
- **P2 → Se mantiene el orden actual** (en-tratamiento arriba, luego `created_at DESC`).
