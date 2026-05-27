# Spec 02 — Modelo de Animal

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25
**Autor**: spec_author (Raf)

## Historial de refinamiento

- **2026-05-26 (refinamiento R4.13 — destrabar tensión con spec 09 R12)** — Raf eligió la opción A del análisis de tensión R12 ↔ R4.13. La inmutabilidad de `tag_electronic` e `idv` se relaja de "post-alta absoluta" a "post-completitud": **`NULL → valor` queda permitido** (completar información que faltaba al alta inicial — caso de uso central del flujo de asignación de caravanas de spec 09 R7/R8); **`valor → otro valor` sigue prohibido** (reescribir identidad rompe trazabilidad SENASA); **`valor → NULL` también queda prohibido** (no hay caso de uso real; defensivo). Migration `0035_immutability_identifiers.sql` actualizada con la condición `old IS NULL ⇒ return new` antes del check. R4.13 reescrita debajo. Tests requeridos en T2.x: caso permitido (NULL → valor), caso prohibido (valor → otro valor), caso prohibido defensivo (valor → NULL). Razón de fondo: la distinción semántica entre "completar info" y "reescribir identidad" es defensible y desbloquea R7/R8 de spec 09 con cambio mínimo (2 líneas SQL por trigger) y backwards compatible si en el futuro se quiere sumar audit granular vía Edge Function.
- **2026-05-26 (aprobación)** — Spec aprobado por Raf con condición: **R14 (pantalla "Ficha de animal") queda marcada como TENTATIVA** hasta que se cierre el design system (item A.1 del `progress/plan.md`). Las requirements R1..R13 y R6.B son definitivas. R14 puede sufrir refinamiento incremental cuando se aborde la Fase 4 (frontend) del `tasks.md`, sin reabrir el spec entero. El backend (Fase 1+2) queda libre para implementar — no depende del design system. Patrón ya validado en spec 01.
- **2026-05-26** — Refinamiento previo a aprobación. Cambios:
  - Adoptado **modelo Híbrido de eventos**: se conservan las 5 tablas tipadas (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) y se agrega una 6ta tabla `animal_events` acotada a `event_type IN ('observacion','otro')` para observaciones libres y casos sin schema. ADR-017 queda matizado: el cuaderno genérico convive con los tipados, no los reemplaza. Type-safety a nivel DB se preserva para el pilar analytics.
  - Agregada sección R6.B (R6.10–R6.13) que describe la tabla `animal_events`, append-only con `edit_window_until` (15 min), soft-delete, RLS por `establishment_id` y trigger `author_id` automático.
  - Extendida R10.1: la función `animal_timeline` ahora incluye un séptimo origen `event_kind = 'observacion'` proveniente de `animal_events`.
  - **Eliminada R15 completa** (R15.1..R15.5): la UX de búsqueda + alta interactiva se mueve a spec 09 `09-buscar-animal`. Spec 02 queda como modelo de datos puro. Los datos y RLS que spec 09 consume siguen acá (R5 búsqueda, R10 cronología, R4 perfil).
  - Agregada **R4.13 (inmutabilidad de identificadores post-alta)**: tras el INSERT inicial, `animals.tag_electronic` y `animal_profiles.idv` no se pueden modificar. `visual_id_alt` sí (texto libre). Corrección de identificador equivocado se resuelve por soft-delete + alta nuevo (el flujo masivo "asignación de caravanas" queda fuera de scope de MVP en spec 02 y se cubre desde spec 09).
  - Confirmada terminología **rodeo + sistema** según ADR-016 (era consistente en los 3 archivos, validado).
  - Confirmada referencia al **motor de form dinámico por rodeo** en design.md (se agrega sección breve apuntando a `categories_by_system` + posible `system_field_config`).
  - Criterios de aceptación globales ajustados: removida toda referencia a R15; agregada referencia a `animal_events` para el criterio de cronología.

## Resumen

Segundo bloque fundacional del producto. Parte del sustrato de `01-identity-multitenancy` (`users`, `establishments`, `user_roles`, RLS, helpers `has_role_in` / `is_owner_of`) y agrega el modelo central de la app: **animal, perfil de animal y eventos cronológicos básicos**, junto con la capa de configuración multi-especie (`species`, `systems_by_species`, `categories_by_system`) y la jerarquía intermedia `rodeos`.

Cubre los cuatro acceptance criteria del feature:

1. Crear un animal con al menos uno de TAG, IDV o `visual_id_alt`.
2. Categoría se autocalcula según especie + sistema, con override manual.
3. Ternero al pie como entidad independiente desde nacimiento.
4. Ficha de animal con cronología de eventos.

Sirve como sustrato de `03-modo-maniobras`: las maniobras del wizard cargan eventos sobre `animal_profiles`. Este spec define **la entidad y la cronología**; la carga masiva por wizard la hace la feature 03.

## Decisiones tomadas

Antes de las requirements, dejo registradas las decisiones cerradas para esta spec:

- **Animal global vs perfil por campo**: dos tablas según `ADR-004`. `animals` es global (identificado por `tag_electronic` cuando existe), `animal_profiles` es la presencia del animal en un establecimiento específico con sus datos locales.
- **Identificación flexible**: al menos uno de `tag_electronic`, `idv` o `visual_id_alt` (`ADR-005`). Validado con `CHECK` constraint a nivel DB.
- **Unicidad de identificadores**:
  - `tag_electronic`: único globalmente (un mismo chip no puede estar en dos animales).
  - `idv`: único por establecimiento (`(establishment_id, idv)` compuesto, parcial sobre `deleted_at IS NULL`).
  - `visual_id_alt`: sin unicidad enforced — texto libre.
- **Categorías en tablas de configuración**: `species`, `systems_by_species`, `categories_by_system` con seed de bovino + cría + categorías del MVP. Otras combinaciones quedan en seed con `active = false` (`ADR-008`, `CONTEXT/04-modelo-datos.md`).
- **MVP solo activa bovino + cría**: la UI solo muestra esas opciones aunque el schema admita el resto.
- **Transiciones automáticas con override**: `ADR-008`. Trigger en Postgres sobre `reproductive_events` evalúa transición y actualiza `animal_profiles.category_id` si `category_override = false`. Cambio manual de categoría desde la ficha pone `category_override = true` automáticamente.
- **CUT manual con prompt al cargar dientes 1/2, 1/4 o sin dientes**: la transición a CUT nunca es automática. El cliente muestra el prompt; si el operador confirma, hace un UPDATE explícito que pone `is_cut = true` y `category_id = (categoría CUT del sistema)` con `category_override = true`. El dato de `teeth_state` se guarda en `animal_profiles` (propiedad sobreescribible, sin historial — confirmado en `CONTEXT/03-flujos-maniobras.md` § Dientes).
- **Ternero al pie**: entidad independiente. Al cargar un evento `reproductive_event` con `event_type = 'birth'` y `calf_*` provistos, el sistema crea automáticamente un `animals` + `animal_profile` nuevos para el ternero, los linkea vía `reproductive_events.calf_id`, y los hereda al mismo `establishment_id` + `rodeo_id` que la madre. La categoría inicial del ternero se setea según el sexo (ternero/ternera).
- **Rodeos en este spec**: la jerarquía `establishments → rodeos → animal_profiles` se cierra acá. Un rodeo es `(establishment_id, species_id, system_id, name)`. Un establecimiento puede tener varios rodeos (post-MVP: distintos sistemas conviviendo); en MVP típicamente uno solo (bovino + cría).
- **Eventos cubiertos por este spec — modelo Híbrido (ADR-017 matizado, 2026-05-26)**: se conservan las 5 tablas tipadas (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) con su schema, RLS y triggers de transición de categoría, **y se agrega una 6ta tabla `animal_events`** acotada por CHECK a `event_type IN ('observacion','otro')` para observaciones libres y casos sin schema. Los otros tipos del ADR-017 original (`salud`, `reproduccion`, `traslado`, `pesaje`, `identificacion`) **no** van en `animal_events` porque ya están cubiertos por las 5 tablas tipadas. El motivo de esta convivencia: data analytics es pilar del producto y requiere type-safety a nivel DB sobre los datos que se cuentan/filtran/grafican; el cuaderno libre vive al lado para lo que no es analytics. La feature 03 sigue siendo dueña de la carga masiva por wizard sobre las 5 tablas tipadas. Se permite carga unitaria desde la ficha del animal (un evento a la vez) para que la cronología sea verificable end-to-end.
- **Inmutabilidad de identificadores post-alta**: tras el INSERT inicial, `animals.tag_electronic` y `animal_profiles.idv` no se pueden modificar (regla del modelo, no UX). `visual_id_alt` sí es modificable porque es texto libre que en la práctica se carga incompleto al inicio. La corrección de un identificador equivocado se hace por soft-delete + alta nuevo. El flujo masivo "asignación de caravanas" (animal que solo tenía visual y después se le pone electrónica) queda fuera de scope MVP de este spec y se cubre desde spec 09.
- **Soft deletes**: en `animals`, `animal_profiles`, `rodeos`, y en cada tabla de eventos (`deleted_at` nullable timestamptz). RLS filtra `deleted_at IS NULL` por default.
- **RLS scoping**: toda tabla con `establishment_id` (directo o transitivo) protegida por `has_role_in(establishment_id)`. Para `animals` (que es global), el acceso se deriva: el usuario ve un `animal` si tiene rol en algún establishment donde hay un `animal_profile` activo de ese animal.
- **Offline-first**: PowerSync sincroniza `animals`, `animal_profiles`, `rodeos`, `species`, `systems_by_species`, `categories_by_system`, y todas las tablas de eventos. La carga de animales y eventos individuales debe funcionar offline.
- **Backend-only en MVP, fasado igual que feature 01**: el spec cubre todas las capas (Fase 0..7), pero las tasks están agrupadas por fase para que se pueda cerrar solo Fase 1+2 (schema + triggers + tests) y diferir el frontend hasta que retomemos el cliente.
- **Triggers preferidos sobre Edge Functions** (`ADR-012`): la lógica de transición automática de categoría y la creación del ternero al pie viven en Postgres como triggers, no en Edge Functions. El cliente hace un insert simple en `reproductive_events` y el resto lo resuelve la DB en la misma transacción.
- **Patrón split insert + select** (`ADR-012`): los inserts en `animal_profiles` (y eventos que derivan transiciones) se hacen sin `.select()` y luego un select separado, porque el RETURNING evalúa la policy de SELECT antes de que la fila quede visible para `has_role_in`. Aplicable a cualquier insert que dispare triggers de membership o de categoría.

## Requirements (EARS)

### R1. Configuración multi-especie

**R1.1** El sistema deberá modelar la tabla `species` con `(id, name, icon, active, created_at, updated_at)`. En MVP la única fila con `active = true` deberá ser `bovino`.

**R1.2** El sistema deberá modelar la tabla `systems_by_species` con `(id, species_id, name, active, created_at, updated_at)`. En MVP la única fila con `active = true` deberá ser `(bovino, cría)`.

**R1.3** El sistema deberá modelar la tabla `categories_by_system` con `(id, system_id, name, code, parent_category_id, sort_order, active, created_at, updated_at)`. Las categorías sembradas para `(bovino, cría)` deberán cubrir como mínimo: `ternero`, `ternera`, `vaquillona`, `vaquillona_prenada`, `vaca_segundo_servicio`, `multipara`, `cut`, `vaca_cabana`, `toro`, `torito`.

**R1.4** El sistema no deberá permitir que un usuario autenticado modifique las tablas `species`, `systems_by_species` y `categories_by_system` desde el cliente. Las modificaciones se hacen vía migration por el equipo.

**R1.5** El sistema deberá permitir lectura de las tres tablas de configuración a cualquier usuario autenticado (sin filtro por establecimiento — son globales).

### R2. Rodeos

**R2.1** El sistema deberá modelar la tabla `rodeos` con `(id, establishment_id, name, species_id, system_id, active, created_at, updated_at, deleted_at)`.

**R2.2** El sistema deberá permitir que un `owner` de un establecimiento cree un rodeo en ese establecimiento.

**R2.3** Mientras un usuario tenga rol `field_operator` o `veterinarian` en un establecimiento, el sistema no deberá permitirle crear ni editar rodeos en ese establecimiento.

**R2.4** El sistema deberá rechazar la creación de un rodeo cuya combinación `(species_id, system_id)` no exista en `systems_by_species` o tenga `active = false`. En MVP esto significa que solo `(bovino, cría)` es aceptable.

**R2.5** El sistema deberá permitir que un `owner` haga soft-delete de un rodeo (set `deleted_at`). Si el rodeo tiene `animal_profiles` activos referenciándolo, el sistema deberá rechazar el soft-delete con un error claro.

**R2.6** Cuando un usuario crea su primer establecimiento (cubierto por spec 01), el sistema deberá crear automáticamente un rodeo default `(bovino, cría)` con `name = 'Rodeo principal'` en ese establecimiento. La membership se hereda transitivamente vía el establecimiento.

### R3. Animal (entidad global)

**R3.1** El sistema deberá modelar la tabla `animals` con `(id, tag_electronic, species_id, sex, birth_date, created_at, updated_at, deleted_at)`.

**R3.2** El sistema deberá enforce que `tag_electronic` sea único globalmente cuando no es `NULL` (unique index parcial sobre filas con `tag_electronic IS NOT NULL AND deleted_at IS NULL`).

**R3.3** El sistema deberá rechazar la creación de un `animal` cuyo `species_id` no exista en `species` o tenga `active = false`. En MVP solo `bovino` es aceptable.

**R3.4** El sistema deberá rechazar la creación de un `animal` cuyo `sex` no esté en `('male', 'female')`.

**R3.5** El sistema deberá permitir lectura de un `animal` global a cualquier usuario que tenga rol activo en algún establishment con un `animal_profiles` activo de ese animal.

### R4. AnimalProfile (presencia en establecimiento)

**R4.1** El sistema deberá modelar la tabla `animal_profiles` con `(id, animal_id, establishment_id, rodeo_id, idv, visual_id_alt, category_id, category_override, breed, coat_color, birth_weight, teeth_state, is_cut, entry_date, entry_weight, entry_origin, exit_date, exit_reason, exit_weight, exit_price, status, notes, created_at, updated_at, deleted_at)`.

**R4.2** El sistema deberá enforce, vía CHECK constraint a nivel DB, que al menos uno de `animals.tag_electronic`, `animal_profiles.idv` o `animal_profiles.visual_id_alt` no sea `NULL` y no sea string vacío para cada `animal_profile` activo. Si los tres son `NULL` o vacíos, la operación deberá ser rechazada (cubre `ADR-005`).

**R4.3** El sistema deberá enforce que `(establishment_id, idv)` sea único cuando `idv` no es `NULL` y el perfil no está soft-deleted (unique index parcial).

**R4.4** El sistema no deberá enforce unicidad sobre `visual_id_alt` — es texto libre. La búsqueda fuzzy se resuelve con índice GIN trigram (ver design).

**R4.5** El sistema deberá enforce que `rodeo_id` referencie un rodeo activo del mismo `establishment_id`. Si el rodeo es de otro establecimiento, soft-deleted o inactivo, el insert deberá ser rechazado.

**R4.6** El sistema deberá enforce que `category_id` referencie una categoría que pertenezca al mismo `system_id` que el rodeo del perfil. Si el `category_id` es de otro sistema, el insert/update deberá ser rechazado.

**R4.7** Cuando un usuario inserta un `animal_profile` sin especificar `category_id`, el sistema deberá calcular la categoría inicial según el sistema del rodeo, el `sex` del animal y el `birth_date` (si está disponible). Para `(bovino, cría)`: hembra con `birth_date` < 1 año → `ternera`; hembra ≥ 1 año sin eventos previos → `vaquillona`; macho < 1 año → `ternero`; macho ≥ 1 año sin eventos → `torito` (default conservador, override manual disponible).

**R4.8** Cuando un usuario actualiza manualmente `category_id` desde la ficha del animal, el sistema deberá setear `category_override = true` automáticamente.

**R4.9** Mientras `category_override = true`, el sistema no deberá modificar `category_id` por triggers de transición automática.

**R4.10** El sistema deberá permitir que un usuario con rol activo en el establecimiento revierta el override (set `category_override = false`), y al hacerlo deberá recalcular la categoría según los eventos cronológicos del animal.

**R4.11** El sistema deberá rechazar la creación de un `animal_profile` activo para un `animal_id` que ya tiene otro `animal_profile` activo en otro establishment. Un animal solo puede estar en un establecimiento por vez (transferencia futura: soft-delete del perfil viejo + alta del nuevo).

**R4.12** Mientras un `animal_profile` tenga `deleted_at IS NULL`, el sistema deberá considerarlo "presente" en el establecimiento. Cuando `status` cambia a `sold`, `dead` o `transferred`, el sistema deberá permitir mantener el perfil visible para historial pero deberá excluirlo de las queries de "rodeo actual" (vía filtro `status = 'active'`).

**R4.13** El sistema deberá enforce, vía trigger Postgres a nivel DB, una **inmutabilidad post-completitud** sobre `animals.tag_electronic` y `animal_profiles.idv` con tres reglas separadas:
- **R4.13.a — Caso permitido**: UPDATE que pase un identificador de `NULL` a un valor concreto (`NULL → 'ARG001'`) deberá ser aceptado. Este caso cubre la **asignación inicial de caravana** cuando un animal se cargó originalmente sin TAG o sin IDV (escenario central de los flujos R7 y R8 de spec 09 — asignación de caravanas a animales viejos). Es "completar información que faltaba al alta", no "reescribir identidad".
- **R4.13.b — Caso prohibido (reescribir identidad)**: UPDATE que cambie un identificador de un valor concreto a otro valor concreto (`'ARG001' → 'ARG002'`) deberá ser rechazado con error claro. Cambiar un TAG/IDV ya cargado rompe trazabilidad y audit trail SENASA: la historia previa registrada bajo el valor original queda colgada de un identificador distinto. La corrección de un identificador equivocado se realiza mediante soft-delete del `animal_profile`/`animal` y alta nuevo.
- **R4.13.c — Caso prohibido (volver a NULL)**: UPDATE que pase un identificador de un valor concreto a `NULL` (`'ARG001' → NULL`) deberá ser rechazado. No hay caso de uso real para "quitarle la caravana" a un animal que ya la tenía; defensivo.
- **`animal_profiles.visual_id_alt` queda completamente fuera del bloqueo**: es texto libre que típicamente se carga incompleto en el momento del alta y puede actualizarse libremente.

### R5. Identificación al cargar

**R5.1** El sistema deberá permitir buscar un animal por `tag_electronic` (match exacto, scope global) en el contexto del establecimiento activo. Si encuentra un `animal_profile` activo en ese establecimiento, lo retorna; si encuentra el animal pero no tiene perfil activo acá, deberá ofrecer "transferir/dar de alta en este campo".

**R5.2** El sistema deberá permitir buscar un animal por `idv` (match exacto, scope `establishment_id` activo).

**R5.3** El sistema deberá permitir búsqueda fuzzy de `visual_id_alt` (similarity ≥ 0.3) dentro del establecimiento activo.

**R5.4** Cuando el usuario no encuentra un animal por ninguno de los tres métodos, el sistema deberá ofrecer crear un animal nuevo en el momento desde la misma pantalla de búsqueda.

### R6. Eventos cronológicos

**R6.1** El sistema deberá modelar la tabla `weight_events` con `(id, animal_profile_id, session_id, weight_kg, weight_date, time, source, notes, created_by, created_at, deleted_at)`.

**R6.2** El sistema deberá modelar la tabla `reproductive_events` con `(id, animal_profile_id, session_id, event_type, event_date, service_type, bull_id, semen_id, pregnancy_status, estimated_days, estimated_birth, calf_id, calf_weight, calf_sex, notes, created_by, created_at, deleted_at)`. `event_type` es enum: `service | tacto | birth | abortion | weaning | drying | rejection`. `pregnancy_status` enum: `empty | small | medium | large` (corresponde a vacía / cabeza / cuerpo / cola — `CONTEXT/03-flujos-maniobras.md`).

**R6.3** El sistema deberá modelar la tabla `sanitary_events` con `(id, animal_profile_id, session_id, campaign_id, event_type, product_name, active_ingredient, dose_ml, route, event_date, next_dose_date, result, adverse_reaction, notes, created_by, created_at, deleted_at)`. `event_type` enum: `vaccination | deworming | treatment | test | other`.

**R6.4** El sistema deberá modelar la tabla `condition_score_events` con `(id, animal_profile_id, session_id, score, event_date, created_by, created_at, deleted_at)`. `score` numeric(3,2) con CHECK constraint `score IN (1.00, 1.25, 1.50, ..., 5.00)`.

**R6.5** El sistema deberá modelar la tabla `lab_samples` con `(id, animal_profile_id, session_id, sample_type, tube_number, collection_date, lab_destination, result, result_interpretation, result_received_date, notes, created_by, created_at, deleted_at)`. `sample_type` enum: `blood | scrape_tricho | scrape_campylo | other`.

**R6.6** Toda tabla de eventos del R6.1 al R6.5 deberá enforce que `animal_profile_id` exista y no esté soft-deleted al momento del insert.

**R6.7** El sistema deberá registrar `created_by = auth.uid()` por trigger automático en todas las tablas de eventos.

**R6.8** Toda tabla de eventos deberá ser accesible (SELECT, INSERT) por usuarios con rol activo en el `establishment_id` derivado del `animal_profile_id`. UPDATE y DELETE de eventos solo por `owner` o por el `created_by` del evento (corrección de propio error).

**R6.9** El sistema deberá exponer una "cronología del animal" — un ordenamiento de todos los eventos de un `animal_profile_id` por `event_date` (o `weight_date` / `collection_date` según la tabla) descendente, con tipo de evento etiquetado para que el cliente pueda renderizar la ficha.

### R6.B Eventos libres / observaciones (`animal_events`) — modelo Híbrido

> Adoptado en refinamiento 2026-05-26 tras matización del ADR-017. Esta tabla **no reemplaza** a las 5 tablas tipadas del R6.1..R6.5; convive con ellas y solo cubre los tipos `observacion` y `otro`. El motivo: data analytics es pilar del producto y necesita type-safety a nivel DB sobre lo que se cuenta/filtra/grafica (las 5 tablas tipadas resuelven eso); las observaciones libres del operador (sin schema) se modelan acá.

**R6.10** El sistema deberá modelar la tabla `animal_events` con `(id, animal_profile_id, establishment_id, author_id, created_at, event_type, text, structured_payload, edit_window_until, deleted_at)`. La columna `establishment_id` deberá estar denormalizada (referenciando `establishments(id)` directamente) para que las policies RLS evalúen sin joins, replicando el patrón de performance del resto del sistema.

**R6.11** El sistema deberá enforce vía CHECK constraint a nivel DB que `event_type` solo acepte los valores `'observacion'` y `'otro'`. Cualquier otro valor del enum del ADR-017 original (`salud`, `reproduccion`, `traslado`, `pesaje`, `identificacion`) **no** deberá ser aceptado por esta tabla, ya que esos casos están cubiertos por las 5 tablas tipadas del R6.1..R6.5.

**R6.12** El sistema deberá tratar `animal_events` como append-only con ventana de corrección:
- `edit_window_until` deberá settearse por default a `now() + interval '15 minutes'` en el INSERT.
- El sistema deberá rechazar cualquier UPDATE de las columnas `text`, `structured_payload` o `event_type` después de `edit_window_until`.
- El sistema deberá permitir soft-delete vía `deleted_at` en cualquier momento (auditable; el evento permanece en DB).
- Las queries normales deberán filtrar `deleted_at IS NULL` por default.

**R6.13** El sistema deberá registrar `author_id = auth.uid()` automáticamente vía trigger BEFORE INSERT en `animal_events` (mismo patrón que `tg_set_created_by_auth_uid` de las tablas tipadas, adaptado al nombre `author_id`). La policy RLS deberá permitir:
- SELECT a cualquier usuario con rol activo en el `establishment_id` (`has_role_in(establishment_id) AND deleted_at IS NULL`).
- INSERT a cualquier usuario con rol activo en el `establishment_id`.
- UPDATE solo al `author_id` original y solo mientras `now() < edit_window_until` (o al `owner` del establishment como excepción administrativa de auditoría — definir en design).
- Soft-delete (UPDATE `deleted_at`) solo al `author_id` original o al `owner`.

### R7. Transiciones automáticas de categoría

**R7.1** Cuando se inserta un `reproductive_events` con `event_type = 'tacto'` y `pregnancy_status` distinto de `empty`, sobre un `animal_profile` con `category.code = 'vaquillona'` y `category_override = false`, el sistema deberá actualizar `category_id` a la categoría `vaquillona_prenada` del mismo sistema en la misma transacción.

**R7.2** Cuando se inserta un `reproductive_events` con `event_type = 'birth'`, sobre un `animal_profile` con `category.code = 'vaquillona_prenada'` y `category_override = false`, el sistema deberá actualizar `category_id` a `vaca_segundo_servicio`.

**R7.3** Cuando se inserta un segundo `reproductive_events` con `event_type = 'birth'` sobre un `animal_profile` con `category.code = 'vaca_segundo_servicio'` y `category_override = false`, el sistema deberá actualizar `category_id` a `multipara`.

**R7.4** El sistema no deberá hacer transiciones automáticas a `cut`. CUT es siempre manual (cubierto por R8).

**R7.5** Si un trigger de transición intenta cambiar a una categoría que no existe en `categories_by_system` para el sistema correspondiente, entonces el sistema deberá loggear el error pero NO bloquear el insert del evento (el evento se persiste; la categoría queda sin cambiar).

**R7.6** El sistema deberá exponer una vista o función `compute_category(animal_profile_id)` que recalcule la categoría a partir de cero leyendo todos los eventos del perfil. La función se invoca desde R4.10 al revertir un override y desde herramientas de mantenimiento.

### R8. CUT y dientes

**R8.1** El sistema deberá permitir que el usuario actualice `teeth_state` en `animal_profiles`. Valores válidos (enum): `'2d' | '4d' | '6d' | 'boca_llena' | '3/4' | '1/2' | '1/4' | 'sin_dientes'`.

**R8.2** `teeth_state` deberá ser sobreescribible sin generar historial (es propiedad, no evento). Su última escritura es el estado vigente.

**R8.3** El sistema no deberá mostrar `teeth_state` ni el prompt CUT en la UI para animales con `category.code IN ('ternero', 'ternera')`.

**R8.4** Cuando el usuario actualiza `teeth_state` a `1/2`, `1/4` o `sin_dientes` y el animal no tiene `is_cut = true`, el cliente deberá mostrar un prompt "¿Marcar como CUT (Criando Último Ternero)?" con dos opciones explícitas. Si el usuario confirma, el sistema deberá setear `is_cut = true`, `category_id = (categoría cut del sistema)` y `category_override = true` en el mismo update.

**R8.5** El sistema deberá permitir setear `is_cut` y la categoría CUT vía un endpoint/función explícito desde la ficha del animal, independiente del prompt automático del R8.4 (el usuario puede marcar CUT directamente sin tocar dientes).

### R9. Ternero al pie

**R9.1** Cuando se inserta un `reproductive_events` con `event_type = 'birth'`, `calf_weight` o `calf_sex` provisto, y `calf_id` aún `NULL`, el sistema deberá:
- Crear automáticamente una fila en `animals` con `species_id = (mismo que la madre)`, `sex = calf_sex`, `birth_date = event_date` (`tag_electronic = NULL` salvo que el cliente lo provea junto con el evento).
- Crear automáticamente una fila en `animal_profiles` con `animal_id = (la nueva)`, `establishment_id = (mismo que la madre)`, `rodeo_id = (mismo que la madre)`, `category_id = ternero | ternera` según `calf_sex`, `birth_weight = calf_weight`, `entry_date = event_date`, `entry_origin = 'born_here'`, `status = 'active'`, `category_override = false`.
- Linkear el `reproductive_events.calf_id` con el nuevo `animal_profiles.id`.
- Validar el constraint de identificación (R4.2): el ternero recién nacido puede no tener TAG ni IDV todavía; el sistema deberá poblar `visual_id_alt = 'recién nacido — pendiente de caravana'` como fallback hasta que el usuario complete la identificación. El cliente deberá generar un recordatorio de "completar caravana del ternero" dentro de los 7 días siguientes (la generación del recordatorio queda fuera de scope MVP de este spec; el campo `visual_id_alt` debe permitir el alta).

**R9.2** El ternero recién creado deberá ser una entidad independiente: editar sus datos, cargarle eventos propios y mostrarlo en su propia ficha. La relación con la madre se preserva exclusivamente vía `reproductive_events.calf_id`.

**R9.3** Si el cliente provee `tag_electronic` del ternero al insertar el `reproductive_events` (campo opcional), el sistema deberá usar ese TAG en el `animals` creado y no aplicar el fallback `visual_id_alt`.

**R9.4** Si el insert del ternero falla por cualquier motivo (TAG duplicado, etc.), entonces el sistema deberá hacer rollback del `reproductive_events` completo y retornar un error claro al cliente.

### R10. Cronología (ficha del animal)

**R10.1** El sistema deberá exponer una función SQL `animal_timeline(profile_id uuid)` que retorne un set de eventos unificados con `(event_kind, event_id, event_date, payload_jsonb)` ordenados por `event_date desc, created_at desc`. `event_kind` enum/text: `weight | reproductive | sanitary | condition_score | lab_sample | category_change | observacion`. El séptimo origen `observacion` proviene de `animal_events` (R6.10..R6.13) y trae en `payload` al menos `{ event_type, text, structured_payload, author_id, edit_window_until }`. El `event_date` para este origen es `created_at` de la fila de `animal_events`.

**R10.2** El sistema deberá enforce vía RLS que la función `animal_timeline` solo retorne eventos cuyo `animal_profile_id` pertenezca a un establecimiento donde `auth.uid()` tiene rol activo.

**R10.3** El sistema deberá incluir en la cronología los cambios de categoría como `event_kind = 'category_change'`. Para esto, el spec introduce una tabla auxiliar `animal_category_history` con `(id, animal_profile_id, from_category_id, to_category_id, changed_at, changed_by, reason)` donde `reason` enum: `auto_transition | manual_override | revert_to_auto | initial`. Cada UPDATE de `animal_profiles.category_id` deberá grabar una fila en esta tabla vía trigger.

### R11. Aislamiento multi-tenant y RLS

**R11.1** El sistema deberá hacer cumplir el aislamiento entre tenants mediante RLS de Postgres para todas las tablas con `establishment_id` directo o transitivo (`rodeos`, `animal_profiles`, `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_category_history`, `animal_events`).

**R11.2** Para tablas con `animal_profile_id` (no tienen `establishment_id` directo), el sistema deberá derivar el establishment vía join al `animal_profiles` correspondiente para evaluar `has_role_in(...)` en las policies.

**R11.3** El sistema deberá garantizar que `animals` (tabla global) solo sea visible al usuario si tiene rol activo en algún establishment con un `animal_profile` activo o soft-deleted (`deleted_at IS NULL` o `deleted_at IS NOT NULL` pero el usuario sigue teniendo rol) de ese animal.

**R11.4** El sistema deberá garantizar que las operaciones administrativas sobre `rodeos` (INSERT, UPDATE, soft-DELETE) y sobre el bulk-edit de animales (UPDATE de varios `animal_profiles` a la vez) solo sean accesibles a usuarios con `role = 'owner'` en ese establishment.

**R11.5** Cualquier `field_operator` o `veterinarian` con rol activo deberá poder INSERT eventos en las tablas del R6 sobre `animal_profiles` de su establishment, e INSERT de nuevos `animal_profiles` (los animales se dan de alta en el campo durante la maniobra).

### R12. Soft deletes y auditoría

**R12.1** El sistema deberá incluir `deleted_at` (timestamp nullable) en `animals`, `animal_profiles`, `rodeos`, y todas las tablas de eventos del R6.

**R12.2** El sistema deberá incluir `created_at` y `updated_at` en todas las entidades (eventos solo `created_at`, son inmutables salvo borrado).

**R12.3** Cuando una entidad tiene `deleted_at IS NOT NULL`, las RLS policies por default no deberán retornarla en SELECT salvo en queries administrativas explícitas (consistente con spec 01).

**R12.4** El sistema deberá grabar en `animal_category_history` cada cambio de categoría con `reason` correspondiente para auditoría.

### R13. Sincronización offline

**R13.1** Las tablas `animals`, `animal_profiles`, `rodeos`, `species`, `systems_by_species`, `categories_by_system`, `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_category_history`, `animal_events` deberán estar configuradas en PowerSync como sincronizables. Los buckets se definen en `design.md`.

**R13.2** La carga unitaria de un animal nuevo y de eventos individuales sobre un animal deberá funcionar offline. Cuando hay conexión, PowerSync sincroniza; cuando no hay, los datos quedan en SQLite local con `pending_sync` lógico.

**R13.3** Mientras el cliente está offline, el sistema deberá permitir validar el constraint de identificación (R4.2) localmente — la validación CHECK del DB es la última red, pero el cliente debe rechazar el form si los tres identificadores están vacíos antes de enviarlo a la cola.

**R13.4** Mientras el cliente está offline, las transiciones automáticas de categoría (R7) deberán ser previsualizadas en el cliente vía un módulo TypeScript compartido. Al sincronizar, el trigger Postgres revalida; si hay divergencia (raro), gana el server (`last-write-wins`).

**R13.5** Las tablas de configuración (`species`, `systems_by_species`, `categories_by_system`) deberán cargarse en SQLite local al primer login y refrescarse periódicamente (TTL ~24 hs). Cambios de seed se propagan vía nueva migration y sync.

### R14. Cliente: ficha del animal

> **⚠️ Sección TENTATIVA** (aprobada con reserva el 2026-05-26). Las requirements R14.1..R14.7 describen QUÉ tiene que mostrar y hacer la pantalla a nivel funcional — independiente del design system. Cuando se cierre el design system (item A.1 del `progress/plan.md`) y se aborde la Fase 4 (frontend) del `tasks.md`, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout específico, componentes visuales, microinteractions, navegación entre tabs/scroll, empty states, copy final del prompt CUT, etc. La aprobación firme de R14 ocurre cuando se redacte el bloque "Refinamientos post-design-system" en el design.md de implementación frontend (mismo patrón que se usará en spec 01).

**R14.1** El sistema deberá exponer una pantalla "Ficha de animal" accesible desde una lista de animales o desde la búsqueda.

**R14.2** La pantalla deberá mostrar la cabecera con `tag_electronic`, `idv`, `visual_id_alt`, `category`, `sex`, `birth_date`, `breed`, `coat_color`, `status` y la cronología de eventos (R10) debajo.

**R14.3** Cada evento de la cronología deberá renderizarse con un componente específico por tipo (peso → kg, tacto → status, vacuna → producto, etc.) y un timestamp legible.

**R14.4** Donde el usuario tenga rol `owner` o sea el `created_by` del evento, la UI deberá permitir editar o soft-deletear ese evento desde la ficha. Para otros usuarios, los eventos se muestran read-only.

**R14.5** La pantalla deberá permitir editar la categoría manualmente (que dispara R4.8) y mostrar el toggle "categoría automática on/off" (que dispara R4.10).

**R14.6** La pantalla deberá ofrecer un botón "Marcar como CUT" que dispara R8.5 con confirmación.

**R14.7** Si el animal es ternero o ternera, la pantalla deberá mostrar un link a la ficha de la madre derivado del `reproductive_events.calf_id` que lo originó.

### R15. — (eliminada en refinamiento 2026-05-26)

La sección original R15 "Cliente: alta y búsqueda de animales" (R15.1..R15.5) **fue eliminada** porque la UX de búsqueda + alta interactiva se mueve a spec 09 `09-buscar-animal`. Spec 02 queda como modelo de datos puro: expone schema, RLS, triggers y la capacidad de búsqueda (R5) + cronología (R10), y spec 09 se encarga de toda la UX (form dinámico por rodeo, dos puertas — manual + bastón BLE —, find-or-create, selección de rodeo con `lastRodeoSelected`, etc.).

Las capacidades subyacentes del modelo siguen acá:
- R5.1..R5.4: búsqueda por TAG / IDV / `visual_id_alt` con scoping por establishment activo.
- R4.13: inmutabilidad de identificadores post-alta (regla del modelo, no UX).
- R4.7: cálculo automático de categoría inicial.
- R13.3: validación local de al menos un identificador antes de envío.
- R10: cronología (consumida por la pantalla de edit de spec 09).

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- Un usuario con rol activo puede crear un animal con **solo TAG**, **solo IDV** o **solo `visual_id_alt`** (cualquiera de los tres) y el sistema lo acepta. Intentar crearlo con los tres vacíos falla con error claro.
- Un usuario crea un animal hembra de < 1 año en cría bovina y el sistema le asigna `category = ternera` automáticamente. El mismo animal a 18 meses queda como `vaquillona`.
- Al registrar un tacto positivo sobre una vaquillona, su categoría pasa automáticamente a `vaquillona_preñada`. Al registrar el parto, pasa a `vaca_segundo_servicio`. Si el usuario cambió manualmente la categoría antes, el override se respeta.
- Al registrar un parto con `calf_weight` y `calf_sex`, el sistema crea automáticamente el ternero como entidad independiente y linkea madre ↔ ternero vía `reproductive_events.calf_id`.
- La ficha del animal muestra todos los eventos cargados ordenados cronológicamente, incluyendo los 5 tipos tipados (peso / reproductivo / sanitario / condition score / lab) **+ las observaciones libres de `animal_events`** (modelo Híbrido) **+ los `category_change` históricos**.
- Una observación libre creada por un usuario se puede editar dentro de los 15 minutos del INSERT (`edit_window_until`). Pasada la ventana, el sistema rechaza el UPDATE de `text`, `structured_payload` o `event_type` y solo permite soft-delete.
- Los identificadores formales (`tag_electronic`, `idv`) no se pueden modificar post-alta (R4.13). `visual_id_alt` sí se puede actualizar.
- Cargar un animal en el campo (sin conexión) funciona end-to-end: el alta queda persistida local, sincroniza al volver red, los triggers del server revalidan y no hay divergencia.
- RLS impide que un usuario lea o modifique animales / eventos de un establishment donde no tiene rol activo (validado con tests reales contra DB remota).
- Todo lo anterior funciona con Supabase + cliente React Native (frontend puede estar pausado en el backend-only en MVP, pero el spec describe ambos lados).
