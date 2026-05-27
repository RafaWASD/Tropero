# Spec 09 — BUSCAR ANIMAL — Requirements

**Status**: Aprobada (2026-05-26 por Raf). Backend logic + UI tentativa lista para implementar tras spec 02.
**Fecha**: 2026-05-26
**Autor**: spec_author

## Historial de refinamiento

- **2026-05-26 (aprobación humana)** — Raf aprobó la spec entera tras lectura del resumen ejecutivo. Las 6 requirements UI tentativas (R1, R2, R4, R5, R7, R8) pueden recibir refinamiento incremental cuando se cierre el design system (mismo patrón que R14 de spec 02). Las 6 definitivas (R3, R6, R9, R10, R11, R12) son canónicas. Próximo paso: cuando el slot `one_feature_at_a_time` quede libre, el leader puede arrancar implementación de las fases ejecutables sin design system (0, 1, 5, 6 parcial).
- **2026-05-26 (R12 destrabada)** — Raf eligió opción A del análisis de tensión R12 ↔ R4.13. Spec 02 R4.13 fue refinada: `NULL → valor` queda permitido (asignación inicial de caravana), `valor → otro valor` sigue prohibido (preserva trazabilidad), `valor → NULL` también prohibido (defensivo). Trigger `tg_animals_block_tag_change` actualizado con condición `old IS NULL ⇒ return new`. **R12 deja de ser un TODO bloqueante**: los flujos R7 (opción A) y R8 (opción B) quedan habilitados para implementación end-to-end. R12 reescrita debajo como "resuelto". Criterios de aceptación globales actualizados (ya no dicen "implementación bloqueada"). Ver `progress/current.md` sesión 11 para el análisis completo de las 3 opciones evaluadas.
- **2026-05-26 — Creación inicial.** Spec redactado siguiendo decisiones de sesiones 9, 10 y 11 del proyecto (ver `progress/current.md`). Consume `02-modelo-animal` (aprobada con R14 tentativo) y declara dependencia con `04-bluetooth-baston` (pending) + ADR-018 (estructura de navegación principal, pending). Disclaimer aplicado a todas las requirements de UI (mismo patrón que R14 de spec 02).

## Resumen

Feature **CORE** del producto (junto con MODO MANIOBRAS). Resuelve la operación más frecuente del operador en campo: encontrar un animal por su identificador y cargar/editar sus datos.

Dos puertas de entrada convergen en el mismo motor `find-or-create`:

1. **Puerta manual** — Tab dedicada `Animales` en la navegación principal con un campo de búsqueda permanente (ID visual o IDV tipeado).
2. **Puerta BLE** — Bastón Allflex (spec 04) actúa como listener global activo en cualquier pantalla excepto MODO MANIOBRAS. Al bastonear un animal, el sistema captura el TAG y dispara el flujo encima de la pantalla actual.

Resolución:

- **Match en el establecimiento activo** → abre pantalla EDIT con datos precargados + timeline append-only (consume `animal_timeline()` de spec 02 R10).
- **No match** → abre pantalla CREATE con el ID precargado e inmutable durante el alta + selección de rodeo + form dinámico según `system_id` del rodeo.

Cubre además los duplicados lógicos del MVP (animal cargado con solo visual al que después se le pone caravana electrónica) con dos flujos manuales: **opción A** (búsqueda intermedia previa al alta cuando se bastonea algo sin match) y **opción B** (flujo dedicado de asignación masiva de caravanas). La **opción C** (detección automática + merge guiado) queda **diferida a post-MVP** (anotada en `CONTEXT/07-pendientes.md`).

Spec 09 **consume** los primitivos de spec 02 (`animals`, `animal_profiles`, `animal_events`, `rodeos`, `categories_by_system`, función `animal_timeline()`, RLS, motor de form dinámico por rodeo). **No** redefine ni amplía el modelo de datos. Las únicas excepciones potenciales — donde aparece tensión con R4.13 de spec 02 — quedan documentadas como TODOs en R12 (no se resuelven en este spec).

## Decisiones tomadas

Antes de las requirements, registro las decisiones cerradas en sesiones 9-11 que esta spec materializa:

- **Dos puertas que convergen** — manual desde tab `Animales` + BLE como listener global (excepto MODO MANIOBRAS). Ambas terminan en el mismo motor find-or-create. El bastón **no es un modo**: es un listener pasivo siempre activo en las pantallas habilitadas. Se excluye MODO MANIOBRAS porque spec 03 tiene su propio wizard que también usa el bastón en bloque.
- **Find-or-create unificado** — ID llega (TAG o visual/IDV) por cualquier puerta → match en el establecimiento activo abre EDIT con timeline; no match abre CREATE con ID precargado + selección de rodeo + form dinámico por sistema.
- **Selección de rodeo al crear**:
  - 1 rodeo activo → preseleccionado y no-cambiable.
  - ≥2 rodeos activos → combo con default `lastRodeoSelected`. Siempre modificable.
- **`lastRodeoSelected`** — Variable de estado de cliente, scope app session. Persiste en memoria + AsyncStorage como respaldo mientras la app esté abierta. Al reabrir, fallback al "último rodeo usado por este usuario en este establecimiento" (query a la DB sobre el último `animal_profiles.rodeo_id` que el usuario tocó en ese establishment). El combo siempre permite cambiarlo — el default es atajo de productividad, no restricción.
- **Identificación dual al crear** — Se muestran AMBOS campos (`tag_electronic` + `idv`). El identificador que vino por la puerta queda precargado y **no modificable durante el alta** (la R4.13 de spec 02 lo enforce post-alta también). El otro queda vacío, **recomendado pero no obligatorio** (R4.2 de spec 02 ya se cubre con el precargado). `visual_id_alt` es opcional, texto libre.
- **Form dinámico por rodeo** — El motor vive en spec 02 (`design.md` § "Motor de form dinámico por rodeo"). En MVP solo `(bovino, cría)` está activo; el conjunto de campos es el superset razonable de `animals` + `animal_profiles`. Categoría inicial autocalculada (R4.7 de spec 02) mostrada read-only con opción de override manual.
- **Timeline append-only en EDIT** — Pantalla EDIT tiene dos zonas: atributos editables (categoría, breed, coat_color, status...) sobreescribibles; timeline de eventos (scrollable, debajo) que consume `animal_timeline()` de spec 02 R10 con los 7 orígenes (5 tipados + observación + cambios de categoría). Append-only con `edit_window_until` de 15 min para corregir el propio evento. Botón "+ agregar evento" abre sub-flujo: elegir tipo primero, después render del form específico. En MVP los 5 tipados se cargan principalmente desde MODO MANIOBRAS, pero también se admite carga unitaria desde acá (consistente con spec 02 R6.6..R6.8). El tipo `observacion` siempre se admite desde acá (R6.10..R6.13 de spec 02).
- **Duplicados lógicos opciones A + B en MVP, C diferida**:
  - **Opción A** — Búsqueda intermedia previa al alta. Cuando el operador bastonea algo que no matchea ningún `tag_electronic`, antes de mostrar el form CREATE el sistema muestra una pantalla intermedia "¿Es este uno de tus animales sin caravana electrónica?" con resultados de animales del establecimiento que **solo tienen `visual_id_alt` o `idv` (sin `tag_electronic`)**, ordenados por relevancia (recientes primero). El operador elige uno → flujo se desvía a "asignar TAG a este animal" → form que actualiza `animals.tag_electronic` del existente. Si elige "no, es nuevo" → continúa al form CREATE.
  - **Opción B** — Flujo dedicado de asignación masiva de caravanas. Pantalla aparte (accesible desde tab `Más` o desde tab `Animales` con filtro "sin caravana electrónica"), donde el operador va bastoneando animales en serie y para cada bastoneo elige de una lista a qué animal asignar el TAG. Optimizado para la sesión de "ponerle caravana a todo el rodeo de una vez".
  - **Opción C** — Detección automática + merge guiado. **Diferida a post-MVP**, anotada en `CONTEXT/07-pendientes.md` sección "Funcionalidades a priorizar después del MVP".
- **Tensión con R4.13 de spec 02** — R4.13 dice "no modificar `tag_electronic` post-alta". Las opciones A y B operan sobre un animal existente cambiando su `tag_electronic` de NULL a un valor. Resolución de criterio para esta spec: **agregar un TAG donde no había (NULL → valor) es un caso permitido**; lo prohibido es **modificar un TAG existente** (valor → otro valor). Esto requiere refinar R4.13 de spec 02 o documentar la excepción acá. **TODO marcado en R12** — la spec 09 deja el contrato definido pero **no modifica spec 02**; el leader decide cuándo refinar en sesión posterior.
- **Terminología canónica** (ADR-016) — "rodeo" + "sistema" en todo el spec. Nunca "lote" como sinónimo.
- **Disclaimer UI tentativo** — Las requirements de UI (R1, R2, R4, R5, R7, R8) llevan disclaimer al principio, igual al patrón de R14 de spec 02. Las requirements de contratos de datos y comportamiento (R3, R6, R10, R11, R12) son definitivas.
- **Dependencia spec 04** — La puerta BLE necesita el listener global del bastón (hook `useBleStickListener` o similar, nombre lo define spec 04). Mientras spec 04 no esté implementada, la puerta BLE no funciona; la puerta manual sí. Spec 09 está diseñada para que la implementación se pueda partir: primero puerta manual, después agregar puerta BLE.
- **Dependencia ADR-018** — La estructura `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]` es tentativa hasta cerrar ADR-018. Spec 09 puede asumirla y mencionarla como tal.

## Requirements (EARS)

### R1. Puerta manual: tab `Animales`

> **TENTATIVA UI** (creada con disclaimer el 2026-05-26). Las requirements R1.1..R1.5 describen QUÉ tiene que hacer la tab `Animales` a nivel funcional — independiente del design system. Cuando se cierre el design system (item A.1 del `progress/plan.md`) y cuando ADR-018 (estructura de navegación principal) quede aprobado, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout específico, componentes visuales, microinteractions, empty states, copy final, etc. La aprobación firme de R1 ocurre cuando se redacte el bloque "Refinamientos post-design-system" en el design.md de implementación frontend (mismo patrón que se usará en spec 02 R14 y en spec 01).

**R1.1** El sistema deberá exponer una pantalla `AnimalsTabScreen` accesible como tab dedicada de la navegación principal de la app (estructura tentativa `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]` sujeta a ADR-018 pending). La pantalla deberá listar los `animal_profiles` activos del establecimiento activo con scoping por establishment del `EstablishmentContext` de spec 01.

**R1.2** La pantalla `AnimalsTabScreen` deberá exponer un campo de búsqueda permanente (sin entrar a otro screen) que permita tipear texto libre y ejecute, sobre cada cambio (con debounce ~250 ms), las búsquedas de R5 de spec 02 contra el establishment activo: match exacto por TAG, match exacto por IDV, búsqueda fuzzy por `visual_id_alt`.

**R1.3** Cuando el usuario tipea un identificador en el campo de búsqueda y presiona la acción "buscar" (o toca un resultado intermedio) y el sistema encuentra un `animal_profile` activo del establishment, el sistema deberá invocar la pantalla EDIT de R5 con ese `animal_profile_id` precargado.

**R1.4** Cuando el usuario tipea un identificador en el campo de búsqueda y la búsqueda no encuentra ningún `animal_profile` activo del establishment, el sistema deberá ofrecer al usuario un CTA explícito "Dar de alta este animal" que abre la pantalla CREATE de R4 con el identificador tipeado precargado en el campo apropiado (`idv` si parece numérico/estructurado del establishment, `visual_id_alt` si es texto libre — heurística definida en design).

**R1.5** La pantalla `AnimalsTabScreen` deberá ofrecer al menos los siguientes filtros visibles para acotar la lista: por rodeo, por estado (`active | sold | dead | transferred`), y por "sin caravana electrónica" (es decir, `animals.tag_electronic IS NULL`).

### R2. Puerta BLE: listener global del bastón

> **TENTATIVA UI + dependencia spec 04** (creada con disclaimer el 2026-05-26). Las requirements R2.1..R2.5 describen QUÉ tiene que hacer el listener global del bastón a nivel funcional — independiente del design system y del detalle de bajo nivel BLE (que vive en spec 04). Cuando se cierre el design system y cuando spec 04 quede implementada, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout del modal/overlay, microinteractions de la captura del TAG, fallback visual si el bastón se desconecta, etc. **La puerta BLE solo es operativa cuando spec 04 esté implementada**; mientras tanto, la puerta manual (R1) cubre el uso.

**R2.1** El sistema deberá montar un `BleStickListenerProvider` global en el root de la app (encima de `AppStack`) que escuche TAGs leídos por el bastón Allflex vía el hook expuesto por spec 04 (nombre tentativo `useBleStickListener`; el nombre canónico lo define spec 04).

**R2.2** Mientras la pantalla activa **no** sea una pantalla del flujo MODO MANIOBRAS (spec 03), el sistema deberá tener el listener BLE activo y reaccionar a cada TAG leído por el bastón.

**R2.3** Mientras la pantalla activa **sea** una pantalla del flujo MODO MANIOBRAS, el sistema deberá desmontar (o desactivar) el listener BLE global para que el wizard de spec 03 procese los TAGs por su cuenta sin interferencia.

**R2.4** Cuando el listener BLE recibe un TAG y el sistema no está en MODO MANIOBRAS, el sistema deberá disparar el motor find-or-create de R3 con el TAG recibido y abrir el resultado (EDIT o CREATE / pantalla intermedia de R7) **encima de la pantalla actual** (vía modal full-screen o navegación en stack que preserve la pantalla anterior para volver tras cerrar el flujo).

**R2.5** Si el bastón se desconecta durante el uso, el sistema no deberá bloquear la puerta manual (R1) ni el resto de la app. El estado de conexión del bastón deberá ser visible al usuario en un punto consistente de la UI (ubicación específica definida cuando se cierre design system).

### R3. Motor `find-or-create` unificado

**R3.1** El sistema deberá exponer una función de cliente `findOrCreateAnimal(identifier: { tag?: string, idv?: string, visual?: string }, establishment_id: uuid)` que lookee contra los primitivos de R5 de spec 02 en el siguiente orden de prioridad:
- Si `identifier.tag` está presente, match exacto contra `animals.tag_electronic` dentro del establishment (vía `animal_profiles.animal_id` con `has_role_in(establishment_id) = true`).
- Si `identifier.idv` está presente, match exacto contra `animal_profiles.idv` filtrado por `establishment_id` y `deleted_at IS NULL`.
- Si `identifier.visual` está presente, búsqueda fuzzy contra `animal_profiles.visual_id_alt` (similarity ≥ 0.3) filtrada por establishment y `deleted_at IS NULL`, retornando los resultados ordenados por similarity desc.

**R3.2** Cuando el lookup de R3.1 encuentra exactamente un `animal_profile` activo en el establishment, el sistema deberá retornar el resultado `{ found: true, mode: 'edit', profile: AnimalProfile, animal: Animal }` para que el caller invoque la pantalla EDIT (R5).

**R3.3** Cuando el lookup de R3.1 no encuentra ningún `animal_profile` activo en el establishment para los identificadores provistos:
- Si la puerta fue **manual** y el identificador es `idv` o `visual_id_alt`, el sistema deberá retornar `{ found: false, mode: 'create', prefilled: { idv? | visual? } }` para que el caller invoque la pantalla CREATE (R4) con ese identificador precargado en el campo correspondiente.
- Si la puerta fue **BLE** (es decir, el identificador es `tag`), el sistema deberá interponer la opción A de R7 (pantalla intermedia "¿Es este uno de tus animales sin caravana electrónica?") **antes** de invocar la pantalla CREATE. Solo si el operador confirma "no, es nuevo" desde esa pantalla, el sistema deberá invocar la pantalla CREATE con el TAG precargado.

**R3.4** Si el lookup de R3.1 con `identifier.tag` encuentra un `animal` global con ese `tag_electronic` que **no** tiene `animal_profile` activo en el establishment activo (es decir, el animal existe en otro campo o quedó soft-deleted en el campo activo), el sistema deberá retornar `{ found: 'global_only', mode: 'transfer_or_alta', animal: Animal }` para que el caller ofrezca al usuario "dar de alta en este campo" (consistente con spec 02 R5.1). El flujo de alta-en-este-campo es una variante de CREATE: reusa el form de R4 con el `animal_id` global preseleccionado y solo crea un nuevo `animal_profile`, sin crear un `animals` nuevo.

**R3.5** El sistema deberá ejecutar el motor `findOrCreateAnimal` íntegramente sobre la copia local de PowerSync (SQLite), sin requerir red, salvo el caso de R3.4 cuando el animal global no esté en el set sincronizado del usuario (caso raro — el bucket `est_animals_local` ya filtra por animales presentes en sus establishments; ver design).

### R4. Pantalla CREATE — alta interactiva

> **TENTATIVA UI** (creada con disclaimer el 2026-05-26). Las requirements R4.1..R4.10 describen QUÉ tiene que mostrar y hacer la pantalla CREATE a nivel funcional. Cuando se cierre el design system, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout específico, componentes visuales (cards, steppers, etc.), microinteractions, copy final, validación inline visual, empty states, etc.

**R4.1** El sistema deberá exponer una pantalla `AnimalCreateScreen` que orqueste el alta de un animal nuevo (`animals` + `animal_profiles` en un solo flujo). La pantalla deberá ser invocable desde la puerta manual (R1.4), desde la puerta BLE (R2.4 + R3.3) y desde la pantalla intermedia de R7 ("es nuevo, continuar").

**R4.2** La pantalla `AnimalCreateScreen` deberá mostrar el identificador con el que se entró al flujo **precargado y no-modificable durante el alta**: si se entró por BLE → `tag_electronic` precargado y read-only; si se entró por puerta manual con `idv` → `idv` precargado y read-only; si se entró con `visual_id_alt` → `visual_id_alt` precargado y read-only.

**R4.3** La pantalla deberá mostrar también, en posición visible y accesible, los **otros dos identificadores** vacíos y editables, marcados como "recomendados pero no obligatorios". La validación de R4.2 de spec 02 (al menos uno no vacío) ya queda cubierta por el identificador precargado.

**R4.4** La pantalla deberá ofrecer un control de selección de rodeo con las siguientes reglas:
- Si el establishment activo tiene **exactamente 1 rodeo activo**, el control deberá mostrar ese rodeo preseleccionado, en estado read-only (sin combo).
- Si el establishment activo tiene **≥2 rodeos activos**, el control deberá ser un combo/dropdown con default = `lastRodeoSelected` (R6) y deberá permitir cambiarlo en cualquier momento del alta.

**R4.5** La pantalla deberá renderizar los campos del form según el `system_id` del rodeo seleccionado, consumiendo el motor de form dinámico documentado en `design.md` de spec 02 § "Motor de form dinámico por rodeo". Para el MVP `(bovino, cría)`, los campos del form deberán incluir como mínimo: `species_id` (oculto/preseleccionado si solo hay uno activo), `sex` (radio macho/hembra, obligatorio), `birth_date` (date picker, opcional), `breed` (texto libre, opcional), `coat_color` (texto libre, opcional), `entry_date` (date picker, opcional), `entry_weight` (numérico, opcional), `entry_origin` (texto libre, opcional). La categoría inicial se autocalcula según R4.7 de spec 02 y se muestra read-only con opción de override manual (R4.8 de spec 02).

**R4.6** Cuando el usuario completa los campos requeridos (al menos `sex` + identificador precargado) y confirma el alta, el sistema deberá llamar a la primitive de mutación `useCreateAnimal` (definida en spec 02 design.md como hook que orquesta el patrón split insert + select sobre `animals` + `animal_profiles`) con los datos del form.

**R4.7** Si la mutación de R4.6 retorna éxito, el sistema deberá redirigir al usuario a la pantalla EDIT de R5 con el `animal_profile_id` recién creado precargado, para que pueda revisar lo cargado y opcionalmente agregar el primer evento.

**R4.8** Si la mutación de R4.6 falla por validación de cliente (R13.3 de spec 02: los tres identificadores vacíos) o por error del server (unique violation de TAG, etc.), el sistema deberá mantener al usuario en la pantalla CREATE con los datos cargados, mostrar un mensaje accionable y permitir corregir y reintentar.

**R4.9** Mientras el usuario está en la pantalla CREATE, el sistema deberá actualizar `lastRodeoSelected` (R6) cada vez que el usuario cambie manualmente el rodeo del combo de R4.4.

**R4.10** Donde el flujo invocador es el caso R3.4 (`mode: 'transfer_or_alta'`), la pantalla CREATE deberá omitir la creación de un nuevo `animals` global y solo crear el `animal_profile` para el `animal_id` ya existente, conservando el `tag_electronic` del animal global como identificador precargado.

### R5. Pantalla EDIT — atributos + timeline append-only

> **TENTATIVA UI** (creada con disclaimer el 2026-05-26). Las requirements R5.1..R5.9 describen QUÉ tiene que mostrar y hacer la pantalla EDIT a nivel funcional. Cuando se cierre el design system, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout específico, render de cada tipo de evento en el timeline, microinteractions del botón "+ agregar evento", copy final, etc. Esta pantalla **complementa** a R14 de spec 02 (pantalla "Ficha de animal"): R14 de spec 02 cubre el caso de **navegación desde lista**, R5 de spec 09 cubre el caso de **resultado del flujo find-or-create**; ambas pantallas pueden compartir el mismo componente concreto en implementación, reusando los hooks de spec 02.

**R5.1** El sistema deberá exponer una pantalla `AnimalEditScreen` invocable desde el motor find-or-create de R3 (caso `mode: 'edit'`) y desde la lista de `AnimalsTabScreen` (R1.3). La pantalla deberá recibir un `animal_profile_id` y cargar los datos vía `useAnimal(profileId)` (definido en spec 02 design.md).

**R5.2** La pantalla deberá mostrar dos zonas claramente diferenciadas:
- **Zona de atributos editables del animal**: muestra `tag_electronic` (read-only por R4.13 de spec 02), `idv` (read-only por R4.13 de spec 02), `visual_id_alt` (editable), `category` (editable manualmente — dispara R4.8 de spec 02), `breed` (editable), `coat_color` (editable), `status` (editable), y resto de columnas de `animal_profiles` que el contexto declare como mutables.
- **Zona de timeline de eventos**: scrollable, debajo, append-only, consume `useAnimalTimeline(profileId)` (definido en spec 02 design.md, que llama a la función SQL `animal_timeline(profile_id)`).

**R5.3** El timeline deberá renderizar las filas retornadas por `animal_timeline()` con los 7 orígenes (`weight | reproductive | sanitary | condition_score | lab_sample | category_change | observacion`), cada uno con un componente específico por tipo (consistente con R14.3 de spec 02). El orden deberá ser descendente por `event_date` (más reciente arriba).

**R5.4** La pantalla EDIT deberá ofrecer un botón explícito "+ agregar evento" que abre un sub-flujo en dos pasos:
- **Paso 1**: el sistema deberá pedir al usuario que elija el tipo de evento (`observacion | salud | reproduccion | traslado | pesaje | identificacion | otro` — los tipos cargables desde acá son los 5 tipados de spec 02 R6.1..R6.5 + `observacion` de R6.10..R6.13, mapeados al UI según copy del design system).
- **Paso 2**: el sistema deberá renderizar el form específico del tipo elegido y, al confirmar, deberá invocar el service correspondiente (`createWeightEvent | createReproductiveEvent | createSanitaryEvent | createConditionScoreEvent | createLabSample | createObservation`, todos definidos en spec 02 design.md) con `animal_profile_id` precargado.

**R5.5** Mientras un evento del timeline tenga `created_at` dentro de los últimos 15 minutos **y** el usuario actual sea el `created_by` (o `author_id` en el caso de `animal_events`), el sistema deberá habilitar la edición de ese evento desde la UI. Pasada la ventana o si el usuario no es el creador, la edición deberá estar deshabilitada (el server enforce R6.12 de spec 02 vía trigger).

**R5.6** Mientras un evento del timeline tenga `deleted_at IS NULL`, el sistema deberá ofrecer un control "soft-delete" si el usuario actual es el creador (`created_by` o `author_id`) o tiene rol `owner` en el establishment, consistente con R6.8 y R6.13 de spec 02.

**R5.7** Cuando el usuario edita un atributo mutable de la zona de atributos (R5.2) y confirma, el sistema deberá invocar el service `useUpdateAnimal` (definido en spec 02 design.md) y reflejar el cambio en la UI tras el commit. Si la actualización dispara una transición automática de categoría (raro desde acá, pero posible), el resultado del server deberá ser refrescado en la UI.

**R5.8** Donde el animal es ternero/ternera (tiene `reproductive_events.calf_id` apuntando a su `animal_profile_id`), la pantalla deberá mostrar un link visible a la ficha de la madre, derivado consultando `reproductive_events` donde `calf_id = animal_profile_id` y navegando al `animal_profile_id` de la madre (consistente con R14.7 de spec 02).

**R5.9** El sistema deberá permitir editar `visual_id_alt` desde la zona de atributos en cualquier momento (texto libre, sin restricción de inmutabilidad — consistente con R4.13 de spec 02 que explícitamente deja `visual_id_alt` editable).

### R6. `lastRodeoSelected` — estado de cliente

**R6.1** El sistema deberá modelar una variable de estado de cliente `lastRodeoSelected: { [establishment_id]: rodeo_id }` scoped al usuario actual, persistida en memoria de la app durante la sesión y respaldada en AsyncStorage para sobrevivir background/foreground transitions de la app.

**R6.2** Cuando el usuario abre la pantalla CREATE (R4) con `establishment_id` activo, el sistema deberá usar como default del combo de rodeo el valor `lastRodeoSelected[establishment_id]` si existe y referencia un rodeo activo del establishment.

**R6.3** Si `lastRodeoSelected[establishment_id]` no existe en memoria/AsyncStorage al momento de necesitarlo (caso típico: primera vez en la sesión post-cold-start de la app), el sistema deberá calcular el default consultando la base local (PowerSync SQLite) por **el `rodeo_id` más reciente** tocado por el usuario actual en `animal_profiles` de ese establishment (`max(updated_at)` sobre filas creadas/modificadas por el usuario), y deberá usar ese rodeo como default del combo.

**R6.4** Si la query de R6.3 retorna vacío (caso: usuario nuevo en el establishment, nunca tocó animales), el sistema deberá usar como default el rodeo default del establishment (`name = 'Rodeo principal'` creado por trigger en R2.6 de spec 02).

**R6.5** Cuando el usuario cambia manualmente el rodeo en el combo de la pantalla CREATE (R4.4 / R4.9), el sistema deberá actualizar `lastRodeoSelected[establishment_id]` con el nuevo valor en memoria + AsyncStorage en la misma operación.

**R6.6** Si el establishment activo cambia (vía `EstablishmentContext` de spec 01), el sistema deberá usar el `lastRodeoSelected` correspondiente al nuevo establishment activo (la variable es un map indexado por `establishment_id`, no un valor global).

### R7. Duplicados lógicos — opción A: búsqueda intermedia previa al alta

> **TENTATIVA UI** (creada con disclaimer el 2026-05-26). Las requirements R7.1..R7.5 describen QUÉ tiene que hacer la pantalla intermedia a nivel funcional. Cuando se cierre el design system, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout específico, render de los resultados sugeridos, copy del título y del CTA "no, es nuevo", microinteractions, etc.

**R7.1** Cuando el motor find-or-create de R3 detecta que la puerta fue BLE (R3.3) y no encuentra match por `tag_electronic`, el sistema deberá exponer una pantalla `AssignTagSearchScreen` (modal o full-screen, definir en design) **antes** de invocar la pantalla CREATE.

**R7.2** La pantalla `AssignTagSearchScreen` deberá listar los `animal_profiles` del establishment activo que cumplan **todas** las condiciones:
- `animals.tag_electronic IS NULL` (el animal global no tiene caravana electrónica).
- `animal_profiles.deleted_at IS NULL` (perfil activo).
- `animal_profiles.status = 'active'`.
- Ordenados por `animal_profiles.updated_at DESC` (recientes primero, heurística simple de relevancia para MVP).

**R7.3** La pantalla deberá mostrar para cada candidato la información mínima necesaria para que el operador lo identifique visualmente: `idv` (si existe), `visual_id_alt` (si existe), `category`, `sex`, `birth_date` (si existe), `rodeo`, último evento si lo hay (en MVP, opcional — confirmar con design).

**R7.4** Cuando el operador toca un candidato, el sistema deberá invocar la pantalla `AssignTagModalScreen` (definida en design) que muestra "Asignar caravana electrónica `<TAG>` a este animal" con confirmación. Si confirma, el sistema deberá actualizar `animals.tag_electronic` del animal seleccionado de `NULL` al TAG bastoneado y, tras el éxito, deberá invocar la pantalla EDIT (R5) con el `animal_profile_id` correspondiente. **Nota**: este UPDATE entra en tensión con R4.13 de spec 02 (inmutabilidad de `tag_electronic` post-alta) — ver R12 para el TODO de refinamiento.

**R7.5** La pantalla `AssignTagSearchScreen` deberá ofrecer un CTA siempre visible "No, es un animal nuevo — continuar con alta" que invoca la pantalla CREATE de R4 con el TAG bastoneado precargado, omitiendo la pantalla intermedia.

### R8. Duplicados lógicos — opción B: asignación masiva de caravanas

> **TENTATIVA UI** (creada con disclaimer el 2026-05-26). Las requirements R8.1..R8.6 describen QUÉ tiene que hacer la pantalla de asignación masiva a nivel funcional. Cuando se cierre el design system, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout específico, render del bastoneo, microinteractions, indicadores de progreso de la sesión, etc.

**R8.1** El sistema deberá exponer una pantalla `BulkTagAssignmentScreen` accesible desde la tab `Más` de la navegación principal y/o desde la tab `Animales` con filtro "sin caravana electrónica" (R1.5) vía un CTA explícito "Asignar caravanas en masa".

**R8.2** La pantalla `BulkTagAssignmentScreen` deberá usar el listener BLE global (R2) en modo "asignación" mientras esté en foreground: cada TAG bastoneado se acumula en una cola local de la sesión y el sistema muestra al operador la lista de candidatos del establishment con `tag_electronic IS NULL` (mismo criterio que R7.2) para que asigne el TAG bastoneado a uno de ellos.

**R8.3** La pantalla deberá permitir al operador seleccionar un candidato de la lista para el TAG actual y confirmar la asignación, actualizando `animals.tag_electronic` del candidato seleccionado de `NULL` al TAG bastoneado. Tras la confirmación, el sistema deberá quitar al candidato de la lista (ya tiene TAG) y dejar al operador listo para el siguiente bastoneo.

**R8.4** Si el operador bastonea un TAG que ya existe en otro `animals` del sistema (TAG duplicado), el sistema deberá rechazar la asignación con un mensaje accionable ("este TAG ya está asignado a otro animal") y no perder el progreso de la sesión.

**R8.5** El sistema deberá mostrar al operador un contador visible de la sesión actual ("X caravanas asignadas hoy") y deberá permitir cerrar la pantalla sin perder los TAGs ya asignados (cada asignación es una transacción independiente que commitea al instante; cerrar la pantalla no rollbackea nada).

**R8.6** La pantalla `BulkTagAssignmentScreen` deberá ofrecer un CTA "Bastoneé un animal nuevo, no estaba en la lista" que invoca el flujo CREATE de R4 con el TAG bastoneado precargado, permitiendo el alta inmediata sin salir del modo masivo.

### R9. Opción C diferida a post-MVP

**R9.1** El sistema **no deberá** implementar en MVP detección automática de duplicados lógicos ni merge guiado entre dos `animals` distintos que refieren al mismo animal físico. La opción C queda diferida a post-MVP, anotada en `CONTEXT/07-pendientes.md` sección "Funcionalidades a priorizar después del MVP".

**R9.2** El sistema deberá cubrir el caso de uso "animal cargado con solo visual al que después se le pone caravana electrónica" exclusivamente con los flujos manuales de R7 (opción A) y R8 (opción B) en MVP.

### R10. Aislamiento multi-tenant

**R10.1** El sistema deberá enforce, a nivel de cliente, que todas las queries de búsqueda (R3) y todas las pantallas (R1, R4, R5, R7, R8) operen exclusivamente sobre el `establishment_id` del `EstablishmentContext` activo de spec 01. Cambiar de establishment debe purgar el estado de cliente scopeado al anterior (`lastRodeoSelected` ya está indexado por `establishment_id` por R6.6; otros caches del flujo find-or-create se invalidan).

**R10.2** El sistema deberá apoyarse en las policies RLS de spec 02 R11 como red de seguridad final: cualquier query que escape el scoping del cliente (bug, race condition) deberá ser bloqueada por las policies del server. Spec 09 no agrega RLS nueva — consume la de spec 02.

**R10.3** El sistema deberá garantizar que el listener BLE global (R2) sea consciente del `establishment_id` activo y que cualquier TAG bastoneado se procese contra ese establishment exclusivamente. Si el usuario cambia de establishment mientras hay un flujo find-or-create abierto, el flujo deberá cancelarse o reescoparse al nuevo establishment (decisión de detalle en design).

### R11. Sincronización offline

**R11.1** El sistema deberá permitir ejecutar la puerta manual (R1), el motor find-or-create (R3), la pantalla CREATE (R4), la pantalla EDIT (R5) sin atributos del timeline reciente (carga inicial cubierta por PowerSync) y la pantalla intermedia de duplicados (R7) **sin requerir red**, leyendo y escribiendo contra la copia local de PowerSync (SQLite), consistente con R13.1..R13.2 de spec 02.

**R11.2** Cuando el cliente está offline, las mutaciones del flujo (alta de animal por R4.6, edición de atributos por R5.7, agregar evento por R5.4, asignación de TAG por R7.4 o R8.3) deberán encolarse en la cola de PowerSync y aplicarse al servidor cuando vuelva la red. La UI deberá reflejar el cambio inmediatamente sobre la copia local.

**R11.3** La puerta BLE (R2) requiere que el bastón esté conectado por BLE al device (relación local, no requiere internet). El resto del flujo opera offline igual que la puerta manual. La spec 04 detalla el manejo de conexión del bastón; spec 09 solo asume que el hook expuesto por spec 04 funciona offline.

**R11.4** Mientras el cliente está offline, las validaciones locales (al menos un identificador no vacío, formato de fechas, campos numéricos, etc.) deberán rechazar el form antes de encolar la mutación, consistente con R13.3 de spec 02 (validación local de identidad) — Spec 09 implementa el form que dispara esa validación.

**R11.5** Si una mutación encolada falla al sincronizar (ej. TAG ya asignado por otro device en el mismo tiempo, race condition), el sistema deberá capturar el error de sync y mostrar al usuario una alerta accionable con el contexto del error y opciones para corregir, consistente con la sección "Cola de sync local" de spec 02 design.md.

### R12. Compatibilidad con R4.13 de spec 02 — asignación inicial de TAG desde NULL (RESUELTO)

> **✅ RESUELTO el 2026-05-26 mediante refinamiento de R4.13 de spec 02** (opción A del análisis de tensión). Los flujos R7 (opción A) y R8 (opción B) quedan habilitados para implementación end-to-end. Esta sección queda como **trazabilidad histórica** del razonamiento — no es un bloqueo activo.

**R12.1** El sistema deberá apoyarse en la R4.13 refinada de spec 02 para los UPDATEs sobre `animals.tag_electronic` y `animal_profiles.idv` en los flujos R7 y R8. La R4.13 refinada distingue tres casos:
- **R4.13.a** — `NULL → valor`: permitido. Caso de uso de R7/R8.
- **R4.13.b** — `valor → otro valor`: prohibido (trigger lo enforce). La corrección de un TAG/IDV equivocado se hace por soft-delete + alta nuevo.
- **R4.13.c** — `valor → NULL`: prohibido (defensivo).

**R12.2** Los flujos R7.3 (asignar TAG al candidato seleccionado en pantalla intermedia) y R8.3 (asignar TAG al candidato seleccionado en pantalla masiva) deberán ejecutar el UPDATE como `UPDATE animals SET tag_electronic = $bastoned_tag WHERE id = $candidate_id AND tag_electronic IS NULL` (cláusula `IS NULL` defensiva en el WHERE, además del trigger). Si la cláusula falla por race condition (otro proceso completó el TAG mientras tanto), el cliente deberá mostrar mensaje accionable ("ese animal ya tiene caravana — refrescá la lista") y no perder el progreso de la sesión.

**R12.3** El sistema deberá tener tests específicos a nivel DB (en spec 02 task T2.x correspondiente, no acá) que validen los tres casos por separado: `NULL → 'ARG001'` (acepta), `'ARG001' → 'ARG002'` (rechaza con error claro), `'ARG001' → NULL` (rechaza con error claro).

**R12.4** Si en el futuro aparece la necesidad de audit granular ("cuándo se asignó esta caravana, por quién"), el upgrade es backwards-compatible: agregar una Edge Function dedicada `assign_tag_to_animal` que ejecute el UPDATE + inserte evento en `animal_events` (o tabla nueva `identification_events`) **sin** revertir la R4.13.a. La opción B del análisis original queda como upgrade path post-MVP. Por ahora, el `updated_at` de la fila cubre el audit suficiente.

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- El operador puede tipear un identificador (visual o IDV) en la tab `Animales` y, si existe en el establecimiento activo, aterrizar directamente en la pantalla EDIT con datos precargados y timeline cargado.
- El operador puede tipear un identificador inexistente en la tab `Animales` y, vía CTA "Dar de alta", aterrizar en la pantalla CREATE con el identificador precargado, seleccionar rodeo (si aplica), completar el form dinámico y crear el animal en una sola sesión.
- Cuando el bastón está conectado y funcional (asume spec 04 implementada), un bastoneo desde cualquier pantalla excepto MODO MANIOBRAS dispara el motor find-or-create y abre EDIT (si existe) o CREATE / pantalla intermedia (si no existe).
- El operador puede agregar un evento (tipado o `observacion`) desde el botón "+ agregar evento" de la pantalla EDIT y verlo aparecer en el timeline.
- El operador puede editar el propio evento dentro de los 15 minutos del INSERT; pasada la ventana, el sistema no permite editar (server enforce vía R6.12 de spec 02).
- `lastRodeoSelected` persiste durante la sesión, sobrevive background/foreground, y al cold-start hace fallback a la query DB del último rodeo usado por el usuario en el establishment.
- En el establecimiento con 1 solo rodeo activo, el control de selección de rodeo en CREATE viene preseleccionado y no-cambiable.
- En el establecimiento con ≥2 rodeos activos, el combo de selección permite cambiar el rodeo en cualquier momento del alta.
- Las opciones A y B de duplicados lógicos están **especificadas y habilitadas para implementación end-to-end** tras el refinamiento de R4.13 de spec 02 del 2026-05-26 (ver R12 destrabada). El UPDATE `NULL → valor` está permitido a nivel DB, el `valor → otro valor` sigue prohibido.
- Todo el flujo funciona offline (puerta manual + CREATE + EDIT + agregar evento). La puerta BLE requiere bastón conectado pero no internet.
- RLS de spec 02 R11 impide acceso cruzado entre establecimientos (validado con tests de spec 02 que siguen siendo válidos para spec 09).
- Conteo final: **R1..R12**, con **6 requirements UI tentativas** (R1, R2, R4, R5, R7, R8) y **6 requirements definitivas** (R3, R6, R9, R10, R11, R12).
