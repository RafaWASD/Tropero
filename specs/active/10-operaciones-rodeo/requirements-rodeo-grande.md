# Spec 10 — DELTA «rodeo grande»: paginación + buscador + virtualización de la vista de grupo — Requirements (EARS)

**Tipo**: delta-spec sobre feature 10 `done` (ADR-028 Nivel B — capacidad nueva; el baseline NO se reescribe, el `tasks.md` original NO se toca). Set hermano `{context,requirements,design,tasks}-rodeo-grande.md`.
**Status**: `spec_ready` (el flip/estado en `feature_list.json` lo coordina el leader — la feature 10 base sigue `done`; este delta corre su propio ciclo SDD).
**Gate 1 (security spec)**: **NO aplica** — el delta es 100% cliente (lecturas del SQLite local + reestructura de UI). No toca RLS, schema, Edge Functions, RPCs, auth/tokens ni datos regulados. No agrega superficie de autorización: el scoping por tenant ya lo imponen la RLS y las sync streams as-built (spec 15); el delta solo agrega filtros de DOMINIO (`rodeo_id`/`management_group_id`) a queries que ya corren scopeadas. (El leader confirma si igual lo lanza; la justificación de "no aplica" vive en design §7.)
**Puerta 1 (aprobación humana)**: ⏸ PENDIENTE.
**Fecha**: 2026-07-18.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/10-operaciones-rodeo/context-rodeo-grande.md` (Gate 0 aprobado por Raf, 2026-07-18) → as-built del baseline de spec 10 (requirements/design/tasks) → código as-built (`GroupViewScreen`, `useGroupView`, `local-reads.ts`, `animals.ts`, `management-groups.ts`, `group-data.ts`, `seleccion-masiva.tsx`, `vacunacion-masiva.tsx`).
**Related**: spec 10 baseline (vista de grupo R1.x, selección masiva R11.x, gating por candidatos design §3.4), spec 09 (`searchAnimals`, `AnimalRow`, patrón buscador+chips de la tab Animales), spec 15 (PowerSync, CRUD plano, overlay `pending_*`, ADR-026), delta lotes-venta (baja en tanda en `lote/[id].tsx` — interacción con la virtualización, ver RG5.6 + design §6.4).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". IDs estables con prefijo **RG** (Rodeo Grande) — namespace propio del delta, NO colisiona con R1–R13 del baseline.

> **El delta en una línea.** La vista "dentro del rodeo/lote" (`GroupViewScreen`, usada por `rodeo/[id].tsx` y `lote/[id].tsx`) hoy tope-a en 200 (rodeo), trae 200-del-campo-y-filtra (lote, bug), no virtualiza y no tiene buscador → los animales #201+ son inalcanzables. Este delta la vuelve **scopeada + paginada (scroll infinito) + con COUNT real + buscador + chips categoría/sexo + virtualizada (FlatList)**, aplica a rodeo Y lote, y desacopla las acciones masivas de la página cargada. **NO toca la tab Animales** (su LIMIT 200 + buscador queda igual — Raf confirmó).

---

## US-RG1 — Query scopeada al grupo + scroll infinito paginado (D1, D5)

> Como productor con un rodeo de miles de cabezas, quiero ver TODOS mis animales del grupo cargándose a medida que hago scroll, sin que la app se cuelgue ni me tope en 200. (context D1, D2)

**RG1.1** El sistema deberá cargar la lista de animales de la vista de grupo mediante una query **scopeada al grupo** (`rodeo_id = ?` para un rodeo; `management_group_id = ?` para un lote), **sin** el tope de 200 de la tab Animales.

**RG1.2** El sistema deberá cargar la lista del grupo en **páginas de tamaño fijo** `GROUP_PAGE_SIZE` (design §3.1: 60), leídas del SQLite local (spec 15).

**RG1.3** Cuando el usuario se acerca al final de la lista (`onEndReached`), el sistema deberá cargar la **siguiente página** y anexarla a las ya cargadas, sin recargar las previas.

**RG1.4** El sistema deberá paginar por **keyset (seek)** sobre la clave de orden compuesta `(in_treatment DESC, created_at DESC, id DESC)`, usando la clave de la **última fila cargada** como cursor — **no** OFFSET (design §3.1 justifica: estabilidad ante el overlay optimista y las altas/bajas concurrentes).

**RG1.5** Mientras una página devuelve **menos** de `GROUP_PAGE_SIZE` filas, el sistema deberá marcar la lista como **completa** y no deberá disparar más cargas de página.

**RG1.6** Si ya hay una carga de página en vuelo, entonces el sistema **no deberá** iniciar otra carga concurrente (un solo `loadMore` a la vez).

**RG1.7** El sistema deberá **mantener el orden actual** (baseline D5 / R RTR.5): en-tratamiento pinneado arriba, luego `created_at DESC`. El `id DESC` es únicamente el **desempate determinístico** que el keyset requiere (orden total estricto) y **no altera** la semántica de orden del baseline.

**RG1.8** El sistema deberá incluir en la lista del grupo **solo** animales `status='active'` y `deleted_at IS NULL` (consistente con el baseline R1.3), en la rama sincronizada y en el overlay.

---

## US-RG2 — COUNT real del grupo en el header (D2, E5)

> Como productor, quiero que el header me diga cuántos animales tiene el grupo DE VERDAD, no cuántos alcancé a scrollear. (context D2, E5)

**RG2.1** El sistema deberá mostrar en el header del grupo el **total real** de animales activos del grupo (COUNT scopeado), **no** el largo (`list.length`) de la lista cargada.

**RG2.2** El conteo del header deberá **contemplar el overlay** optimista (altas/bajas/mudanzas pendientes offline) para no desalinearse con lo que se ve (E5).

**RG2.3** Mientras el conteo real no cargó, el sistema **no deberá** mostrar un número engañoso en el header (muestra un placeholder tipo "…"/"Cargando", nunca "0 animales" prematuro).

**RG2.4** El sistema deberá formatear el conteo en **es-AR** (separador de miles con punto, ej. `1.050`), consistente con `animales.tsx`.

---

## US-RG3 — Buscador + filtros in-grupo (D3, E2)

> Como productor/operario, quiero encontrar un animal puntual DENTRO del rodeo/lote (tipeando la caravana) y filtrar por categoría o sexo, igual que en la tab Animales. (context D3, decisión Raf 2026-07-18)

**RG3.1** El sistema deberá exponer un **buscador fijo** arriba de la lista del grupo, **scopeado al grupo**, reusando el motor `searchAnimals` as-built (caravana electrónica / IDV / apodo).

**RG3.2** La búsqueda in-grupo deberá correr sobre el **set completo del grupo** (query scopeada), **no** solo sobre la página cargada en memoria (E2).

**RG3.3** El sistema deberá ofrecer **chips de filtro** por **categoría** y por **sexo**, scopeados al grupo, con el mismo patrón visual que los chips de la tab Animales (`FilterChip`/`FilterPopover`).

**RG3.4** Los filtros de categoría/sexo deberán ser **combinables** entre sí y con la **búsqueda de texto**.

**RG3.5** Mientras hay un filtro de categoría/sexo activo (sin texto de búsqueda), el sistema deberá listar el **subconjunto del grupo** que matchea, **paginado** por el mismo keyset (RG1.4), no la página sin filtrar.

**RG3.6** Mientras hay texto de búsqueda, el sistema deberá mostrar los resultados **scopeados al grupo** (motor `searchAnimals`) **intersectados** con los chips de categoría/sexo activos.

**RG3.7** Cuando el usuario cambia un chip o el texto de búsqueda, el sistema deberá **reiniciar la paginación** al primer resultado del nuevo criterio (cursor nuevo, lista desde el tope).

**RG3.8** Cuando el usuario limpia la búsqueda y los filtros, el sistema deberá volver a la **lista paginada completa** del grupo (RG1.2).

**RG3.9** El sistema deberá **derivar las opciones** de los chips de las categorías/sexos **presentes en el grupo** (query scopeada), no de un catálogo fijo: el chip de sexo se ofrece solo si hay ambos sexos; las opciones de categoría son las presentes (mismo criterio que `vacunacion-masiva` as-built).

**RG3.10** Todo control interactivo nuevo (buscador, chips, popovers) deberá implementar el tap con `onPress` + los helpers de a11y (`buttonA11y`/`labelA11y`) en la **misma pieza Tamagui** que lleva el `pressStyle`, **sin** envolver en un `<Pressable>` de RN — patrón nativo correcto (memoria del proyecto + `GoogleSignInButton`/`FilterChip`). **Crítico para nativo** (un `<Pressable>` externo roba el responder y `onPress` no dispara).

---

## US-RG4 — Virtualización con FlatList (D4)

> Como usuario en un device de gama baja, quiero que miles de filas no cuelguen la app. (context D4)

**RG4.1** El sistema deberá renderizar la lista del grupo con **`FlatList`** (virtualizada), reemplazando el `ScrollView` + `.map()` actual de `GroupViewScreen`.

**RG4.2** El sistema deberá usar **`FlatList`** (no `FlashList`) por su comportamiento más predecible en RN-web, donde corre la suite e2e.

**RG4.3** El sistema deberá renderizar el **header de metadatos + la card de acciones masivas** como `ListHeaderComponent` de la `FlatList` (scrollea con la lista).

**RG4.4** El sistema deberá mantener el **buscador + los chips FIJOS arriba** (fuera del scroller virtualizado), de modo que siempre sean alcanzables sin scrollear.

**RG4.5** El sistema deberá usar `profileId` como `keyExtractor` (keys estables) para preservar el scroll ante refreshes silenciosos (RG6.1).

**RG4.6** Mientras carga una página adicional, el sistema deberá mostrar un indicador en el pie de la lista (`ListFooterComponent`).

**RG4.7** El sistema deberá aplicar esta reestructura a la vista de grupo de **RODEO y de LOTE** (ambas comparten `GroupViewScreen`).

---

## US-RG5 — Acciones masivas sobre el grupo entero, no la página (E1) + fix del bug del lote

> Como operario, quiero que "Castrar/Vacunar/Destetar el grupo" opere sobre TODO el grupo aunque yo solo haya scrolleado la primera página. (context E1)

**RG5.1** El sistema deberá resolver el conjunto de una acción masiva (castrar/vacunar/destetar) sobre el **grupo entero**, no sobre la página cargada en la vista de grupo.

**RG5.2** El gating de una acción masiva (¿hay candidatos para ofrecerla?) deberá basarse en un **COUNT/EXISTS scopeado al grupo entero**, no en los candidatos de la página cargada (hoy `fetchRodeoGroupActions`/`fetchLoteGroupActions` reciben la lista mostrada → con paginación serían solo la página).

**RG5.3** La pantalla de selección masiva (`seleccion-masiva.tsx`) y la de vacunación (`vacunacion-masiva.tsx`) deberán cargar **todos los miembros activos del grupo** (query scopeada, sin tope), no un subconjunto.

**RG5.4** El sistema deberá **corregir el bug del lote**: `fetchGroupMembers` deberá leer por `management_group_id` scopeado (query directa), **no** traer los 200 más recientes del campo entero y filtrar client-side (que en un campo grande devuelve un subconjunto incompleto y arbitrario del lote).

**RG5.5** El sistema **no deberá** cambiar el modelo de mutación de las masivas (sigue siendo N mutaciones individuales, baseline R3.4): el delta solo garantiza que el **conjunto** sobre el que operan es el grupo entero.

**RG5.6** Cuando la vista de LOTE entra en modo selección de **baja en tanda** (delta lotes-venta, `lote/[id].tsx`), el sistema deberá operar sobre el **conjunto completo del lote** — no sobre la página cargada — de forma consistente con RG5.1 (design §6.4 detalla la reconciliación con la virtualización).

---

## US-RG6 — Refresh silencioso, overlay optimista y offline (E3, E4)

> Como peón que acaba de mover/dar de alta un animal offline, quiero verlo aparecer en el grupo correcto sin que la lista salte al tope ni parpadee. (context E3, E4)

**RG6.1** Cuando la vista de grupo se re-enfoca o baja un sync nuevo, el sistema deberá **refrescar en silencio la ventana cargada** (todas las páginas ya cargadas), **sin** resetear a la página 1 ni blanquear la vista (patrón `silent` as-built de `useGroupView`).

**RG6.2** Si un refresh silencioso falla transitoriamente, entonces el sistema **no deberá** descartar la lista ya montada (conserva los datos actuales — patrón as-built).

**RG6.3** El sistema deberá incluir en la query scopeada las filas del **overlay optimista** (`pending_animal_profiles`) del grupo, de modo que un animal **creado o movido offline** aparezca en la lista del grupo correcto bajo la paginación nueva (E4).

**RG6.4** El sistema deberá leer **todas** las lecturas de la vista de grupo (lista, count, búsqueda, filtros, candidatos) del **SQLite local** (PowerSync), operando 100% offline (spec 15).

**RG6.5** El sistema **no deberá** hardcodear `establishment_id`: se deriva del contexto activo y las queries lo scopean (multi-tenant, CLAUDE.md ppio 6). La RLS + las sync streams son la barrera de tenant real (design §7).

---

## US-RG7 — No-regresión y consistencia

**RG7.1** El sistema **no deberá** modificar la tab Animales ni el comportamiento de `buildAnimalsListQuery` (LIMIT 200): el delta agrega builders/queries/servicios nuevos para la vista de grupo y deja la tab intacta (context §"Fuera de scope").

**RG7.2** El sistema deberá mostrar todos los textos en **es-AR voseo** y todo número mostrado en formato es-AR (RG2.4).

**RG7.3** El sistema deberá aplicar `lineHeight` matching en headings ≥`$6` y en textos con `numberOfLines` (evitar el recorte de descendentes g/q/p/j/y — memoria del proyecto).

**RG7.4** El sistema **no deberá** ampliar el scope a sorting configurable ni a virtualizar otras listas de la app (context §"Fuera de scope").

---

## Cobertura del context (cada decisión/edge → ≥1 `RG<n>`)

| context | Requirements |
|---|---|
| D1 — scroll infinito paginado (páginas ~50–100, keyset, onEndReached; pagina para acotar el compute O(N) del espejo+repro) | RG1.1, RG1.2, RG1.3, RG1.4, RG1.5, RG1.6 |
| D2 — query scopeada al grupo sin tope de 200 + count real | RG1.1, RG2.1 |
| D3 — buscador in-grupo + chips categoría/sexo, combinables, sobre el set completo | RG3.1–RG3.10 |
| D4 — virtualización FlatList + reestructura de `GroupViewScreen`; buscador fijo; aplica a rodeo y lote | RG4.1–RG4.7 |
| D5 — se mantiene el orden actual (en-tratamiento arriba, luego `created_at DESC`) | RG1.7 |
| E1 — acciones masivas: gating por COUNT/EXISTS del grupo entero + acción sobre todo el grupo | RG5.1, RG5.2, RG5.3, RG5.5 |
| E1 (bug del lote) — `fetchGroupMembers` scopeado, no 200-del-campo | RG5.4 |
| E1 (baja en tanda del lote, delta lotes-venta) — opera sobre el conjunto completo | RG5.6 |
| E2 — búsqueda/filtros sobre el set completo, no la página | RG3.2, RG3.5, RG3.6 |
| E3 — refresh silencioso + sync sin resetear a página 1 ni saltar scroll | RG6.1, RG6.2, RG4.5 |
| E4 — overlay optimista offline aparece en el grupo bajo el query paginado | RG6.3 |
| E5 — count contempla el overlay | RG2.2 |
| Offline-first (spec 15) / multi-tenant | RG6.4, RG6.5 |
| Fuera de scope: tab Animales intacta / sin sorting configurable / no virtualizar otras listas | RG7.1, RG7.4 |
| es-AR voseo + descendentes | RG7.2, RG7.3, RG2.4 |

---

## Criterios de aceptación globales

Este delta se considera implementado cuando:

- La vista de grupo (rodeo y lote) carga por **query scopeada** (`rodeo_id`/`management_group_id`) **sin tope de 200**, **paginada por keyset** de 60 en 60, con **scroll infinito** (`onEndReached` anexa la próxima página) y **FlatList** virtualizada.
- El **header** muestra el **total real** del grupo (COUNT scopeado, overlay-aware), no `list.length`.
- Hay un **buscador fijo** arriba (scopeado al grupo, motor `searchAnimals`) + **chips de categoría y sexo** (patrón de la tab Animales), **combinables** y corriendo sobre el **set completo** del grupo; todo control nuevo usa el **tap nativo correcto** (onPress + a11y en la misma pieza Tamagui, sin `<Pressable>` externo).
- Las **acciones masivas** (castrar/vacunar/destetar) y su **gating** operan sobre el **grupo entero** (COUNT/EXISTS scopeado), no sobre la página; la **baja en tanda del lote** también.
- El **bug del lote** queda corregido: `fetchGroupMembers` lee scopeado por `management_group_id` y muestra **todos** los miembros.
- Refresh silencioso (foco/sync) **no** resetea a la página 1 ni salta el scroll; un animal creado/movido **offline** aparece en el grupo correcto (overlay); el count contempla el overlay.
- Todo lee del **SQLite local** (offline), **nunca** hardcodea `establishment_id`, muestra **es-AR voseo**, y **no toca** la tab Animales ni `buildAnimalsListQuery`.
- Cobertura E2E (Playwright, web): rodeo >200 carga más al scrollear; buscar dentro del grupo; filtrar por categoría/sexo; count real en el header; lote muestra TODOS sus miembros (regresión del bug); acción masiva opera sobre el grupo entero.

---

## Historial de refinamiento

- **2026-07-18 — Redacción inicial del delta** desde `context-rodeo-grande.md` (Gate 0 aprobado por Raf 2026-07-18). Traducción a EARS (namespace RG). Sin overrides del autor sobre decisiones cerradas en el context; las elecciones técnicas no cerradas por el context (tamaño de página = 60, keyset vs OFFSET, reuso de los head-count builders para el COUNT, gating por COUNT/EXISTS SQL, aproximación stored-category del filtro/gating de destete) están en `design-rodeo-grande.md` con su justificación y quedan sujetas a Puerta 1. Gate 1 marcado **NO aplica** (delta 100% cliente, sin RLS/schema/EF/RPC/datos regulados) — confirmación final del leader.
