# Spec 02 — Modelo de Animal

**Status**: Aprobada 2026-05-26 · refundida 2026-05-28 (incorpora ADR-020 lote + ADR-021 plantilla de datos) · refinamiento de edge cases 2026-05-29 (sesión 17 — baja de animal, mellizos, transiciones por edad, corrección de eventos, TAG no reusable, etc.). **TENTATIVOS**: R14 (ficha — hasta cerrar design system) y el seed de cría de `field_definitions` (hasta validar con Facundo).
**Fecha original**: 2026-05-25
**Autor**: spec_author (Raf)

> El historial de refinamientos vive en el **Changelog** al final de este documento (audit trail, no se borra — mismo principio de inmutabilidad que los ADRs). La entrada de sesión 17 (2026-05-29) está al tope del Changelog.

## Resumen

Segundo bloque fundacional del producto. Parte del sustrato de `01-identity-multitenancy` (`users`, `establishments`, `user_roles`, RLS, helpers `has_role_in` / `is_owner_of`) y agrega el modelo central de la app: **animal, perfil de animal y eventos cronológicos**, junto con:

- la capa de configuración multi-especie (`species`, `systems_by_species`, `categories_by_system`),
- la jerarquía intermedia `rodeos`,
- la **plantilla de datos configurable por rodeo** (`field_definitions` + `system_default_fields` + `rodeo_data_config`, ADR-021),
- y los **lotes** como tercer eje de organización (`management_groups`, ADR-020).

### Los tres ejes ortogonales de organización de un animal

Un animal vive en tres dimensiones independientes (regla maestra de ADR-020). Lo que las distingue es **qué dispara un cambio en cada una**:

| Eje | Representa | Cambia cuando… | Cómo |
|---|---|---|---|
| **Rodeo** | sistema productivo (define qué datos se cargan, vía `rodeo_data_config`) | cambia el SISTEMA productivo del animal | semi-automático o manual, baja frecuencia |
| **Categoría** | estado biológico | cambia el ESTADO biológico (tacto, parto) | automático por evento (ADR-008) |
| **Lote** (`management_group`) | agrupación de manejo | el productor DECIDE reagrupar | **siempre manual, nunca por evento biológico** |

Los tres ejes son ortogonales: una transición de categoría no toca el rodeo ni el lote; asignar un lote no cambia categoría ni rodeo.

Cubre los cuatro acceptance criteria del feature:

1. Crear un animal con al menos uno de TAG, IDV o `visual_id_alt`.
2. Categoría se autocalcula según especie + sistema, con override manual.
3. Ternero al pie como entidad independiente desde nacimiento.
4. Ficha de animal con cronología de eventos.

Sirve como sustrato de `03-modo-maniobras`: las maniobras del wizard cargan eventos sobre `animal_profiles`, y el **gating de maniobras** (qué maniobra está disponible en un rodeo) se apoya en `rodeo_data_config`. Este spec define **la entidad, la cronología y el modelo de configuración**; la carga masiva por wizard y el enforcement del gating los hace la feature 03.

## Decisiones tomadas

Antes de las requirements, dejo registradas las decisiones cerradas para esta spec:

- **Animal global vs perfil por campo**: dos tablas según `ADR-004`. `animals` es global (identificado por `tag_electronic` cuando existe), `animal_profiles` es la presencia del animal en un establecimiento específico con sus datos locales.
- **Identificación flexible**: al menos uno de `tag_electronic`, `idv` o `visual_id_alt` (`ADR-005`). Validado con `CHECK` constraint a nivel DB.
- **Unicidad de identificadores**:
  - `tag_electronic`: único globalmente (un mismo chip no puede estar en dos animales).
  - `idv`: único por establecimiento (`(establishment_id, idv)` compuesto, parcial sobre `deleted_at IS NULL`).
  - `visual_id_alt`: sin unicidad enforced — texto libre.
- **Categorías en tablas de configuración**: `species`, `systems_by_species`, `categories_by_system` con seed de bovino + cría + categorías del MVP. Otras combinaciones quedan en seed con `active = false` (`ADR-008`, `CONTEXT/04-modelo-datos.md`).
- **MVP solo activa bovino + cría**: la UI solo muestra esa combinación seleccionable aunque el schema admita el resto. Los demás sistemas (tambo, cabaña, invernada, feedlot) se muestran grisados con badge "Próximamente".
- **No hay rodeo default**: el usuario crea su primer rodeo manualmente vía wizard tras el alta del establishment (R2.6). No existe trigger de auto-creación de "Rodeo principal". Un establecimiento recién creado arranca con cero rodeos hasta que el owner cierra el wizard (el cliente bloquea el resto de la app hasta entonces — ver R2.6).
- **Plantilla de datos: catálogo global + defaults por sistema + toggle por rodeo** (`ADR-021`, ver R2.B): un **catálogo global** (`field_definitions`) define cada dato tracqueable **una sola vez**; `system_default_fields` marca cuáles vienen tildados/requeridos por sistema; `rodeo_data_config` guarda el estado efectivo por rodeo. Un rodeo puede habilitar cualquier dato del catálogo global, incluso uno que no es default de su sistema (caso real: un rodeo de tambo que igual quiere tactear preñez). Modelo elegido por sobre JSONB y por sobre catálogo-por-sistema porque analytics es pilar del producto y necesita type-safety a nivel DB + datos reusables entre sistemas.
- **Lote como agrupación de manejo** (`ADR-020`, ver R2.C): tabla `management_groups` (scope establishment, nombre libre, sin presets) + columna `animal_profiles.management_group_id` nullable. Asignación exclusiva (uno a la vez), manual, sin historial en MVP. La app **nunca** auto-asigna lote. Regla de display: agrupar por lote si el animal tiene `management_group_id`, si no por categoría. Nombre canónico de la tabla resuelto en esta spec (ADR-020 lo dejó "tentativo, validar en spec"): **`management_groups`** (la UI lo muestra como "Lote" al productor).
- **Transiciones automáticas con override**: `ADR-008`. Trigger en Postgres sobre `reproductive_events` evalúa transición y actualiza `animal_profiles.category_id` si `category_override = false`. Cambio manual de categoría desde la ficha pone `category_override = true` automáticamente. Las transiciones **no tocan** `rodeo_id` ni `management_group_id` (ortogonalidad, R7.7).
- **CUT manual con prompt al cargar dientes 1/2, 1/4 o sin dientes**: la transición a CUT nunca es automática. El cliente muestra el prompt; si el operador confirma, hace un UPDATE explícito que pone `is_cut = true` y `category_id = (categoría CUT del sistema)` con `category_override = true`. El dato de `teeth_state` se guarda en `animal_profiles` (propiedad sobreescribible, sin historial — confirmado en `CONTEXT/03-flujos-maniobras.md` § Dientes).
- **Ternero al pie**: entidad independiente. Al cargar un evento `reproductive_event` con `event_type = 'birth'` y `calf_*` provistos, el sistema crea automáticamente un `animals` + `animal_profile` nuevos para el ternero, los linkea vía `reproductive_events.calf_id`, y los hereda al mismo `establishment_id` + `rodeo_id` que la madre (el `management_group_id` del ternero queda `NULL` — el productor lo asigna si quiere). La categoría inicial del ternero se setea según el sexo (ternero/ternera).
- **Rodeos en este spec**: la jerarquía `establishments → rodeos → animal_profiles` se cierra acá. Un rodeo es `(establishment_id, species_id, system_id, name)` + su configuración de datos tracqueados (`rodeo_data_config`, ver R2.B). Un establecimiento puede tener varios rodeos (post-MVP: distintos sistemas conviviendo); en MVP típicamente uno solo (bovino + cría).
- **Gating de maniobras (doble capa)**: el mapeo maniobra→data_keys requeridos es hardcodeado (lógica de dominio estable, ADR-021). La capa UI (spec 03) solo ofrece maniobras cuyos data_keys están `enabled` en el rodeo; la capa DB (spec 03) rechaza persistir un evento gateado si el rodeo no tiene los data_keys habilitados. Spec 02 expone el sustrato (las tablas + el mapeo documentado + RLS); el enforcement vive en spec 03 (ver R2.7).
- **Eventos cubiertos por este spec — modelo Híbrido (ADR-017 matizado)**: se conservan las 5 tablas tipadas (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) con su schema, RLS y triggers de transición de categoría, **y se agrega una 6ta tabla `animal_events`** acotada por CHECK a `event_type IN ('observacion','otro')` para observaciones libres y casos sin schema. Los otros tipos del ADR-017 original (`salud`, `reproduccion`, `traslado`, `pesaje`, `identificacion`) **no** van en `animal_events` porque ya están cubiertos por las 5 tablas tipadas. El motivo de esta convivencia: data analytics es pilar del producto y requiere type-safety a nivel DB sobre los datos que se cuentan/filtran/grafican; el cuaderno libre vive al lado para lo que no es analytics. La feature 03 sigue siendo dueña de la carga masiva por wizard sobre las 5 tablas tipadas. Se permite carga unitaria desde la ficha del animal (un evento a la vez) para que la cronología sea verificable end-to-end.
- **Inmutabilidad de identificadores post-completitud** (R4.13): `NULL → valor` permitido (completar info que faltaba al alta — flujo de asignación de caravanas de spec 09); `valor → otro valor` y `valor → NULL` prohibidos (rompen trazabilidad SENASA). `visual_id_alt` queda fuera del bloqueo (texto libre). Regla del modelo, no UX.
- **Soft deletes**: en `animals`, `animal_profiles`, `rodeos`, `management_groups`, y en cada tabla de eventos (`deleted_at` nullable timestamptz). RLS filtra `deleted_at IS NULL` por default. `rodeo_data_config` no tiene soft-delete (el toggle vive en `enabled`).
- **RLS scoping**: toda tabla con `establishment_id` (directo o transitivo) protegida por `has_role_in(establishment_id)`. Para `animals` (que es global), el acceso se deriva: el usuario ve un `animal` si tiene rol en algún establishment donde hay un `animal_profile` activo de ese animal.
- **Offline-first**: PowerSync sincroniza `animals`, `animal_profiles`, `rodeos`, `management_groups`, `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`, `rodeo_data_config`, y todas las tablas de eventos. La carga de animales, eventos individuales y la asignación de lote deben funcionar offline.
- **Backend-only en MVP, fasado igual que feature 01**: el spec cubre todas las capas (Fase 0..7), pero las tasks están agrupadas por fase para que se pueda cerrar solo Fase 1+2 (schema + triggers + tests) y diferir el frontend hasta que retomemos el cliente.
- **Triggers preferidos sobre Edge Functions** (`ADR-012`): la lógica de transición automática de categoría, la creación del ternero al pie y el auto-poblado de `rodeo_data_config` viven en Postgres como triggers, no en Edge Functions.
- **Patrón split insert + select** (`ADR-012`): los inserts en `animal_profiles` (y eventos que derivan transiciones) se hacen sin `.select()` y luego un select separado, porque el RETURNING evalúa la policy de SELECT antes de que la fila quede visible para `has_role_in`. Aplicable a cualquier insert que dispare triggers de membership o de categoría.
- **Baja / egreso de animal (sesión 17, ver `R4.14`/`R4.15`)**: dar de baja un animal es un cambio de `status` (`sold`/`dead`/`transferred`) con `exit_reason` **enum** (`sale | death | transfer | culling | theft | other`), **no** un soft-delete (`deleted_at` queda `NULL`, el perfil queda archivado y sale del rodeo activo). Lo pueden hacer el owner y el operario que cargó el animal. Preserva eventos y vínculos reproductivos; nunca se hard-deletea un perfil referenciado como `calf_id`/`bull_id`.
- **Mellizos en MVP (sesión 17, ver `R7.9`/`R9.5`)**: un parto es **un** evento `birth` con **N terneros** asociados (uno-a-muchos), no un evento por ternero. El conteo de partos para transiciones de categoría cuenta **eventos de parto distintos**, no terneros. Corrige el modelo previo de "un ternero por evento `birth`".
- **Transiciones por edad NO automáticas por reloj (sesión 17, ver `R7.8`)**: no hay cron. Las transiciones etáreas (destete) ocurren por **evento de destete** (`weaning`) o manualmente. La edad/`birth_date` solo fija el punto de partida en el alta (`R4.7`); para `birth_date IS NULL` el default conservador propuesto es adulto-por-sexo sin evento (hembra `vaquillona`, macho `torito`) — **requiere confirmación** (`R4.7.1`).
- **Corrección de eventos tipados sin ventana de tiempo (sesión 17, ver `R6.8.1`/`R6.14`)**: los 5 eventos tipados se editan/borran libremente por owner o autor (corregir un peso viejo es legítimo). La ventana de 15 min de `R6.12` aplica **solo** a `animal_events` (observaciones libres), no a los tipados — corrige la inconsistencia de spec 09 R5.5. Editar/borrar un evento que disparó una transición recalcula la categoría vía `compute_category` (si no hay override).
- **Cambio de rodeo permitido dentro del mismo sistema (sesión 17 → relajada en fold Tier 1, sesión 20, ver `R4.5.1`)**: se puede mover un animal a otro rodeo **del mismo `system_id`** (mismo establecimiento). Lo que queda bloqueado es el cambio **cross-sistema** (rodeo destino de otro `system_id`), que se rechaza a nivel DB por trigger para evitar el dead-end de categoría cross-sistema (`R4.6`). En MVP, con solo `(bovino, cría)` activo, todos los rodeos comparten sistema, así que el cambio de rodeo es siempre válido. La resolución de categoría cross-sistema se habilita cuando exista multi-sistema. **Limitación conocida acotada al cruce de sistemas.**
- **`entry_origin` enum → backlog (sesión 17)**: hoy `entry_origin` es texto libre; conviene convertirlo a **enum** cuando se aborde analytics post-MVP (los valores de origen de ingreso son un dominio acotado y analytics necesita type-safety). **No** se cambia ahora — anotado para el backlog de analytics.

## Requirements (EARS)

### R1. Configuración multi-especie

**R1.1** El sistema deberá modelar la tabla `species` con `(id, name, icon, active, created_at, updated_at)`. En MVP la única fila con `active = true` deberá ser `bovino`.

**R1.2** El sistema deberá modelar la tabla `systems_by_species` con `(id, species_id, name, active, created_at, updated_at)`. En MVP la única fila con `active = true` deberá ser `(bovino, cría)`. Las combinaciones `(bovino, tambo)`, `(bovino, cabaña)`, `(bovino, invernada)`, `(bovino, feedlot)` existen en seed con `active = false`.

**R1.3** El sistema deberá modelar la tabla `categories_by_system` con `(id, system_id, name, code, parent_category_id, sort_order, active, created_at, updated_at)`. Las categorías sembradas para `(bovino, cría)` deberán cubrir como mínimo: `ternero`, `ternera`, `vaquillona`, `vaquillona_prenada`, `vaca_segundo_servicio`, `multipara`, `cut`, `vaca_cabana`, `toro`, `torito`.

**R1.4** El sistema no deberá permitir que un usuario autenticado modifique las tablas `species`, `systems_by_species` y `categories_by_system` desde el cliente. Las modificaciones se hacen vía migration por el equipo.

**R1.5** El sistema deberá permitir lectura de las tres tablas de configuración a cualquier usuario autenticado (sin filtro por establecimiento — son globales).

### R2. Rodeos

**R2.1** El sistema deberá modelar la tabla `rodeos` con `(id, establishment_id, name, species_id, system_id, active, created_at, updated_at, deleted_at)`.

**R2.2** El sistema deberá permitir que un `owner` de un establecimiento cree un rodeo en ese establecimiento.

**R2.3** Mientras un usuario tenga rol `field_operator` o `veterinarian` en un establecimiento, el sistema no deberá permitirle crear ni editar rodeos en ese establecimiento.

**R2.4** El sistema deberá rechazar la creación de un rodeo cuya combinación `(species_id, system_id)` no exista en `systems_by_species` o tenga `active = false`. En MVP esto significa que solo `(bovino, cría)` es aceptable.

**R2.5** El sistema deberá permitir que un `owner` haga soft-delete de un rodeo (set `deleted_at`). Si el rodeo tiene `animal_profiles` activos referenciándolo, el sistema deberá rechazar el soft-delete con un error claro.

**R2.6** El sistema **no deberá** crear ningún rodeo automáticamente al crearse un establecimiento. Tras el alta del establishment (spec 01), el cliente deberá llevar al usuario a un wizard de "Crear rodeo" donde:
- el usuario elige un **sistema productivo activo** entre los disponibles para la especie seleccionada (en MVP: solo `(bovino, cría)` está `active = true`; el resto —tambo, cabaña, invernada, feedlot— aparecen en la UI pero **grisados / no seleccionables**, con badge "Próximamente" o equivalente);
- el usuario nombra el rodeo (`name`);
- el usuario revisa y tilda/destilda los datos de la **plantilla del sistema** elegido (ver R2.B). Los datos vienen pre-tildados según `system_default_fields` del sistema y se persisten en `rodeo_data_config` (R2.10, R2.11).

El primer rodeo de un establecimiento se crea con este mismo wizard — no hay shortcut "Rodeo principal" autogenerado. Un establecimiento recién creado puede quedar con cero rodeos; mientras tanto el cliente deberá bloquear la navegación al resto de la app y mostrar el wizard de "Crear rodeo" como primera pantalla (empty state de bloqueo total).

**R2.7** El sistema deberá tratar la configuración de datos tracqueados de un rodeo (`rodeo_data_config`, ver R2.B) como **sustrato del gating de maniobras** definido en spec 03 `03-modo-maniobras`. El **mapeo maniobra → data_keys requeridos** es lógica de dominio estable y hardcodeado (ADR-021):

| Maniobra (spec 03) | Requiere `enabled` en el rodeo |
|---|---|
| Tacto (vaca) | `prenez` Y `tamano_prenez` |
| Tacto vaquillona | `tacto_vaquillona` |
| Sangrado | `brucelosis` |
| Vacunación | `vacunacion` |
| Inseminación | `inseminacion` |
| Condición corporal | `condicion_corporal` |
| Dientes | `dientes` |
| Pesaje / Pesaje de ternero | `peso` |
| Raspado de toros | `raspado_toros` |

Para el alcance de spec 02 esto significa: las tres tablas de plantilla quedan modeladas, seedeadas (seed de cría TENTATIVO, R2.13) y accesibles por RLS; el **enforcement de doble capa** (capa UI: el wizard solo ofrece maniobras cuyos data_keys están `enabled`; capa DB: rechaza persistir un evento gateado si el rodeo no tiene los data_keys habilitados) se define como **requirement firme en spec 03**. Esta nota queda asentada para que el implementer de spec 03 pueda referenciarla sin reabrir spec 02.

### R2.B. Plantilla de datos: catálogo global + defaults por sistema + toggle por rodeo (`ADR-021`)

> Las tres tablas son **firmes**. El **seed de cría** de `field_definitions` queda **TENTATIVO** (R2.13) hasta validar con Facundo. Este modelo reemplaza el catálogo-por-sistema buggeado de versiones previas (ver Changelog).

**R2.8** El sistema deberá modelar la tabla **`field_definitions`** (catálogo GLOBAL — cada dato tracqueable existe una sola vez) con `(id, data_key, label, description, category, data_type, ui_component, config_schema, schema_version, active, created_at, updated_at)`, donde:
- `data_key` es la clave estable **única global** (ej. `prenez`, `peso`, `vacunacion`); `UNIQUE(data_key)`.
- `label` es el texto humano para la UI (ej. "Preñez").
- `description` es texto explicativo opcional.
- `category` es el agrupador para la UI: `reproductivo | productivo | sanitario | manejo | comercial | identificacion`.
- `data_type`: `maniobra | evento_individual | evento_grupal | propiedad`.
- `ui_component`: `numeric | numeric_stepped | enum_single | enum_multi | date | silent_apply | composite | text`.
- `config_schema` (JSONB): configuración específica del dato; `schema_version` (int).

La tabla es de **catálogo** (mismo patrón que `species`, `categories_by_system`): se modifica vía migration, RLS con SELECT abierto a `authenticated`, sin INSERT/UPDATE/DELETE de cliente.

**R2.9** El sistema deberá modelar la tabla **`system_default_fields`** (qué datos son default/required por sistema) con `(id, system_id, field_definition_id, default_enabled, required_for_system, sort_order)` y `UNIQUE(system_id, field_definition_id)`, donde:
- `system_id` referencia `systems_by_species(id)`, `field_definition_id` referencia `field_definitions(id)`.
- `default_enabled`: el dato viene tildado al crear un rodeo de ese sistema.
- `required_for_system`: si `true`, no se puede destildar a nivel rodeo. En cría MVP ninguno es required (la identificación TAG/IDV/visual_id_alt es el único requisito real, cubierto por R4.2).

También es tabla de catálogo (read-only para clientes, modificable vía migration).

**R2.10** El sistema deberá modelar la tabla **`rodeo_data_config`** (estado efectivo por rodeo) con `(rodeo_id, field_definition_id, enabled, custom_config, created_at, updated_at)`, PK compuesta `(rodeo_id, field_definition_id)`, donde:
- `rodeo_id` referencia `rodeos(id)` con `ON DELETE CASCADE`.
- `field_definition_id` referencia `field_definitions(id)` (catálogo global — NO se valida contra el sistema del rodeo, justamente para permitir habilitar un dato que no es default del sistema).
- `enabled` (boolean, not null): estado actual del toggle.
- `custom_config` (JSONB, nullable): overrides opcionales al `config_schema` del field.
- no hay `deleted_at` — el toggle vive en `enabled`.

**R2.11** Cuando se inserta un nuevo `rodeo`, el sistema deberá popular automáticamente `rodeo_data_config` vía trigger AFTER INSERT con una fila por cada `field_definition` que tenga registro en `system_default_fields` para el `system_id` del rodeo, copiando `default_enabled` como `enabled` inicial. Esto garantiza que un rodeo recién creado nunca queda con configuración vacía. (acotación, sesión 17) Esta garantía vale **solo para sistemas que tengan `system_default_fields` seedeados**. En MVP solo `(bovino, cría)` los tiene; por eso solo cría puede crear rodeos no vacíos hoy. **Activar un sistema productivo nuevo** (invernada, feedlot, tambo, cabaña) **requiere seedear sus `system_default_fields` en la misma migration** que lo activa — de lo contrario un rodeo de ese sistema nacería con `rodeo_data_config` vacía. Queda documentado como precondición de activación de cualquier sistema futuro.

**R2.12** El sistema deberá permitir que **solo el `owner`** del establecimiento gestione `rodeo_data_config` de sus rodeos:
- **Toggleear** (`UPDATE enabled`) una fila existente.
- **Habilitar un dato no-default** del sistema (INSERT en `rodeo_data_config` con `enabled = true` para un `field_definition_id` que no estaba en los `system_default_fields` del sistema). Esto cubre el caso real "rodeo de tambo que también quiere tactear preñez": `prenez` existe en el catálogo global, así que el rodeo de tambo lo puede habilitar aunque no sea default de tambo.
- El sistema no deberá permitir DELETE de filas de `rodeo_data_config` desde el cliente (deshabilitar = `enabled = false`; el borrado real solo ocurre por CASCADE al eliminar el rodeo).
- Mientras un usuario tenga rol `field_operator` o `veterinarian`, el sistema no deberá permitirle modificar la configuración de datos del rodeo.

**R2.12.1** (nueva, sesión 17 — el timeline muestra historial aunque el data_key esté deshabilitado) El timeline del animal (`R6.9`, `R10`) deberá **siempre** renderizar los eventos históricos ya cargados, **aunque** el `field_definition` correspondiente esté `enabled = false` en el `rodeo_data_config` del rodeo (data_key destildado) o aunque el propio `field_definition.active = false`. Destildar un dato apaga la **carga futura** de ese dato (gating de maniobras de spec 03), pero **no oculta** ni borra lo ya registrado: el historial es inmutable de cara a la visualización. Cuando el `owner` destilda en un rodeo un data_key que **ya tiene eventos cargados**, el sistema deberá **avisarle** (p. ej. "este dato tiene N eventos cargados; se dejará de pedir pero el historial se conserva"); el aviso es de cliente. Esta requirement vive en spec 02 porque es donde está `rodeo_data_config`; el enforcement del gating de carga sigue en spec 03 (`R2.7`).

**R2.13** El **seed inicial** de `field_definitions` para `(bovino, cría)` queda **TENTATIVO** hasta validar con Facundo. Comprende **26 fields** (23 con `default_enabled = true`, 3 con `default_enabled = false`: `inseminacion`, `peso_nacimiento`, `tuberculosis`), distribuidos por categoría (reproductivo, productivo, sanitario, manejo, comercial). El detalle completo está en `ADR-021` y en el `design.md`. `evaluacion_toro` queda diferido post-MVP (no se seedea). Otros sistemas (recría, invernada, feedlot, tambo, cabaña) reciben su seed de `system_default_fields` cuando se activen post-MVP; los `field_definitions` universales (peso, condición corporal, vacunación, etc.) ya quedan disponibles globalmente para reusarse. Este seed puede refinarse vía migration sin reabrir spec 02.

### R2.C. Lotes — agrupación de manejo (`ADR-020`)

> Tercer eje de organización (regla maestra del Resumen). Activa la cláusula reservada de ADR-016. Tabla `management_groups` (la UI la muestra como "Lote").

**R2.14** El sistema deberá modelar la tabla **`management_groups`** con `(id, establishment_id, name, active, created_at, updated_at, deleted_at)`, donde:
- `establishment_id` referencia `establishments(id)` — el lote pertenece al **establecimiento**, NO a un rodeo (habilita el caso "cruzando rodeos", ej. un lote de venta que junta animales de cría e invernada).
- `name` es texto libre definido por el productor. La app **no presetea ningún lote** (no hay "otoño/primavera" hardcodeado).

**R2.15** El sistema deberá agregar la columna `animal_profiles.management_group_id` (FK nullable a `management_groups(id)`), con asignación:
- **Exclusiva**: un animal está en a lo sumo un lote a la vez. Mover de lote es reasignar el FK.
- **Nullable**: `management_group_id = NULL` significa "sin grupo de manejo custom".
- **Manual**: la asigna el productor explícitamente. Ningún trigger ni evento biológico asigna lote automáticamente.
- El sistema deberá validar que el `management_group` referenciado pertenezca al mismo `establishment_id` que el `animal_profile`.

**R2.16** El sistema deberá soportar la regla de display "agrupar por lote si tiene, si no por categoría": al agrupar animales para presentación, si el animal tiene `management_group_id`, se agrupa por ese lote; si es `NULL`, se agrupa por su `category`. (La categoría provee agrupamiento automático gratis; el lote es un override opcional solo donde el productor lo necesita.) La implementación visual de esta regla es del cliente; spec 02 expone los datos para soportarla.

**R2.17** El sistema deberá permitir:
- **Crear / editar / soft-delete** de `management_groups`: solo `owner` (consistente con gestión de rodeos). Soft-delete de un lote con animales asignados deberá reasignar esos animales a `management_group_id = NULL` o rechazarse con error claro (definir en design).
- **Asignar / transferir** un animal a un lote (`UPDATE animal_profiles.management_group_id`): cualquier rol operativo activo (`owner`, `field_operator`, `veterinarian`). La transferencia de lote es un UPDATE simple del FK, **sin historial en MVP** (solo estado actual).

**R2.18** El sistema **no deberá** auto-asignar lotes bajo ninguna circunstancia:
- Ningún trigger ni evento biológico (servicio, tacto, parto) deberá modificar `management_group_id`.
- Las transiciones automáticas de categoría (R7) **no** deberán tocar `management_group_id` (ortogonalidad — confirmado en R7.7).
- Lo máximo permitido en MVP es una **sugerencia genérica** en el cliente tras un evento de servicio ("¿querés asignar esta vaca a algún lote?") que ofrece los lotes existentes para que el productor elija; el sistema nunca asume el mapeo fecha→lote (esa UX es de spec 03/09, acá solo se asienta el principio).

### R3. Animal (entidad global)

**R3.1** El sistema deberá modelar la tabla `animals` con `(id, tag_electronic, species_id, sex, birth_date, created_at, updated_at, deleted_at)`.

**R3.2** El sistema deberá enforce que `tag_electronic` sea único globalmente cuando no es `NULL` (unique index parcial sobre filas con `tag_electronic IS NOT NULL AND deleted_at IS NULL`).

**R3.3** El sistema deberá rechazar la creación de un `animal` cuyo `species_id` no exista en `species` o tenga `active = false`. En MVP solo `bovino` es aceptable.

**R3.4** El sistema deberá rechazar la creación de un `animal` cuyo `sex` no esté en `('male', 'female')`.

**R3.5** El sistema deberá permitir lectura de un `animal` global a cualquier usuario que tenga rol activo en algún establishment con un `animal_profiles` activo de ese animal.

### R4. AnimalProfile (presencia en establecimiento)

**R4.1** El sistema deberá modelar la tabla `animal_profiles` con `(id, animal_id, establishment_id, rodeo_id, management_group_id, idv, visual_id_alt, category_id, category_override, breed, coat_color, birth_weight, teeth_state, is_cut, entry_date, entry_weight, entry_origin, exit_date, exit_reason, exit_weight, exit_price, status, notes, created_by, created_at, updated_at, deleted_at)`. La columna `management_group_id` es FK nullable a `management_groups(id)` (ver R2.C). (fold Tier 1, sesión 20) La columna **`created_by`** es FK **nullable** a `users(id)` y registra al usuario que dio de alta el perfil; se setea por trigger BEFORE INSERT a `auth.uid()` cuando viene `NULL` (mismo patrón que `tg_set_created_by_auth_uid` de las tablas de evento). Es la columna de autoría de la que depende la baja de animal (`R4.14`: "el operario que cargó el animal").

**R4.2** El sistema deberá enforce, vía CHECK constraint a nivel DB, que al menos uno de `animals.tag_electronic`, `animal_profiles.idv` o `animal_profiles.visual_id_alt` no sea `NULL` y no sea string vacío para cada `animal_profile` activo. Si los tres son `NULL` o vacíos, la operación deberá ser rechazada (cubre `ADR-005`).

**R4.3** El sistema deberá enforce que `(establishment_id, idv)` sea único cuando `idv` no es `NULL` y el perfil no está soft-deleted (unique index parcial).

**R4.4** El sistema no deberá enforce unicidad sobre `visual_id_alt` — es texto libre. La búsqueda fuzzy se resuelve con índice GIN trigram (ver design).

**R4.5** El sistema deberá enforce que `rodeo_id` referencie un rodeo activo del mismo `establishment_id`. Si el rodeo es de otro establecimiento, soft-deleted o inactivo, el insert deberá ser rechazado.

**R4.5.1** (refina R4.5, sesión 17; **relajada en el fold Tier 1, sesión 20** — cambio de rodeo permitido dentro del mismo sistema) El sistema **deberá** permitir cambiar el `rodeo_id` de un `animal_profile` después del alta **únicamente cuando el rodeo destino pertenezca al mismo sistema productivo que el rodeo origen** (es decir, `system_id` del rodeo destino == `system_id` del rodeo origen). El rodeo destino debe además ser un rodeo **activo del mismo `establishment_id`** (la condición ya enforced por `R4.5`). Reglas:
- **Mismo sistema → permitido**: mover un animal de un rodeo de cría a otro rodeo de cría del mismo establecimiento es válido. La categoría del animal (`R4.6`) sigue siendo válida porque pertenece al mismo `system_id`, así que **no** se recalcula ni se invalida por el cambio de rodeo (los tres ejes son ortogonales — el cambio de rodeo no toca `category_id` ni `management_group_id`).
- **Cambio de sistema → rechazado**: si el rodeo destino es de un `system_id` distinto al origen, el sistema deberá **rechazar** el UPDATE con un error claro. Mover cross-sistema introduciría el dead-end de "categoría válida para el sistema A pero no para el B" (`R4.6`); esa resolución de categoría cross-sistema (con re-mapeo de categoría) se difiere hasta que el flujo multi-sistema esté especificado. Es una **limitación conocida** acotada al cruce de sistemas, no al cambio de rodeo en sí.
- En MVP solo `(bovino, cría)` está activo, así que en la práctica todos los rodeos de un establecimiento comparten sistema y todos los cambios de rodeo caen en la rama permitida. La validación de mismo-sistema se enforce **a nivel DB** (trigger BEFORE UPDATE de `rodeo_id`, ver design) para que la garantía valga aunque exista multi-sistema en el futuro.

**R4.6** El sistema deberá enforce que `category_id` referencie una categoría que pertenezca al mismo `system_id` que el rodeo del perfil. Si el `category_id` es de otro sistema, el insert/update deberá ser rechazado.

**R4.7** Cuando un usuario inserta un `animal_profile` sin especificar `category_id`, el sistema deberá calcular la categoría inicial según el sistema del rodeo, el `sex` del animal y el `birth_date` (si está disponible). Para `(bovino, cría)`: hembra con `birth_date` < 1 año → `ternera`; hembra ≥ 1 año sin eventos previos → `vaquillona`; macho < 1 año → `ternero`; macho ≥ 1 año sin eventos → `torito` (default conservador, override manual disponible).

**R4.7.1** (refina R4.7, sesión 17 — `birth_date IS NULL`) Este cálculo de categoría inicial usa la edad **solo en el momento del alta** para elegir el punto de partida; **no** se re-evalúa por paso del tiempo (ver `R7.8`). Cuando `birth_date` es `NULL` (animal cargado sin fecha de nacimiento — caso frecuente en animales viejos o comprados sin papeles), el sistema **no deberá** asumir "adulto" a ciegas ni "ternero" a ciegas. El **default propuesto** (criterio del autor de spec, **requiere confirmación de Raf/Facundo**) es: tratar la ausencia de fecha como **categoría adulta por sexo sin evento reproductivo** — hembra → `vaquillona`, macho → `torito` (ambas con `category_override` quedando en `false` para que un evento reproductivo posterior pueda corregir vía `R7`). El sustento es que un ternero/ternera al pie casi siempre se carga con fecha conocida (nace en el campo, `R9`), mientras que un animal sin fecha suele ser adulto; aun así, el operario puede ajustar manualmente en el alta. Si el sistema productivo o el flujo de alta diera señales de duda (p. ej. peso de ingreso muy bajo), el cliente debería sugerir confirmar la categoría antes de guardar.

**R4.8** Cuando un usuario actualiza manualmente `category_id` desde la ficha del animal, el sistema deberá setear `category_override = true` automáticamente.

**R4.9** Mientras `category_override = true`, el sistema no deberá modificar `category_id` por triggers de transición automática.

**R4.10** El sistema deberá permitir que un usuario con rol activo en el establecimiento revierta el override (set `category_override = false`), y al hacerlo deberá recalcular la categoría según los eventos cronológicos del animal.

**R4.11** El sistema deberá rechazar la creación de un `animal_profile` activo para un `animal_id` que ya tiene otro `animal_profile` activo en otro establishment. Un animal solo puede estar en un establecimiento por vez (transferencia futura: soft-delete del perfil viejo + alta del nuevo).

**R4.12** Mientras un `animal_profile` tenga `deleted_at IS NULL`, el sistema deberá considerarlo "presente" en el establecimiento. Cuando `status` cambia a `sold`, `dead` o `transferred`, el sistema deberá permitir mantener el perfil visible para historial pero deberá excluirlo de las queries de "rodeo actual" (vía filtro `status = 'active'`). La baja/egreso de un animal (cambio de `status`) está especificada en `R4.14`; **no** es soft-delete (`deleted_at` queda `NULL`).

**R4.13** El sistema deberá enforce, vía trigger Postgres a nivel DB, una **inmutabilidad post-completitud** sobre `animals.tag_electronic` y `animal_profiles.idv` con tres reglas separadas:
- **R4.13.a — Caso permitido**: UPDATE que pase un identificador de `NULL` a un valor concreto (`NULL → 'ARG001'`) deberá ser aceptado. Este caso cubre la **asignación inicial de caravana** cuando un animal se cargó originalmente sin TAG o sin IDV (escenario central de los flujos R7 y R8 de spec 09 — asignación de caravanas a animales viejos). Es "completar información que faltaba al alta", no "reescribir identidad".
- **R4.13.b — Caso prohibido (reescribir identidad)**: UPDATE que cambie un identificador de un valor concreto a otro valor concreto (`'ARG001' → 'ARG002'`) deberá ser rechazado con error claro. Cambiar un TAG/IDV ya cargado rompe trazabilidad y audit trail SENASA: la historia previa registrada bajo el valor original queda colgada de un identificador distinto. La corrección de un identificador equivocado se realiza mediante **soft-delete del `animal_profile` + `animal`** (set `deleted_at`) y **alta correctiva** del animal con el identificador correcto. (refina, sesión 17) El TAG electrónico **no se reusa**: el unique parcial de `animals.tag_electronic` (`R3.2`) está acotado a `deleted_at IS NULL`, por lo que soft-deletear el animal con el TAG equivocado **libera** ese TAG para el alta correctiva sin violar la unicidad. Eso es consistente con SENASA (un chip físico es único de por vida, pero acá se está reasignando el registro lógico de un alta errónea al chip correcto, no reciclando un chip).
- **R4.13.c — Caso prohibido (volver a NULL)**: UPDATE que pase un identificador de un valor concreto a `NULL` (`'ARG001' → NULL`) deberá ser rechazado. No hay caso de uso real para "quitarle la caravana" a un animal que ya la tenía; defensivo.
- **`animal_profiles.visual_id_alt` queda completamente fuera del bloqueo**: es texto libre que típicamente se carga incompleto en el momento del alta y puede actualizarse libremente.

**R4.14** (nueva, sesión 17 — baja / egreso de animal) El sistema deberá permitir **dar de baja** (egreso) un `animal_profile` activo registrando el motivo, **sin** hacer soft-delete (preserva la historia). La baja consiste en un UPDATE que setea `status` (a `sold`, `dead` o `transferred`), `exit_date`, `exit_reason`, y opcionalmente `exit_weight` y `exit_price`. Las columnas `status`, `exit_date`, `exit_reason`, `exit_weight`, `exit_price` ya existen en `animal_profiles` (`R4.1`). Reglas:
- **`exit_reason` pasa a ser enum**: `sale | death | transfer | culling | theft | other` (venta / muerte / transferencia / descarte / robo / otro). Es ortogonal a `status`: por ejemplo `culling`, `theft` u `other` típicamente acompañan a `status = sold` o `dead` según el caso real; la combinación válida la resuelve el cliente/diseño. (Conversión de la columna `exit_reason` de texto libre a enum: la hace el implementer vía migration; spec 02 define el conjunto de valores.)
- **No es soft-delete**: el perfil mantiene `deleted_at IS NULL`, queda **visible / archivado**, y **sale del rodeo activo** (excluido de las queries de "rodeo actual" por el filtro `status = 'active'`, consistente con `R4.12`).
- **Quién puede dar de baja**: el `owner` del establecimiento **y** el operario que registró el alta del animal (`created_by` del `animal_profile`, o el equivalente de autoría disponible). Otros roles operativos no pueden dar de baja un animal que no cargaron.
- **Acción desde la ficha del animal** (la UI vive en `R14` / spec 09).
- **Preserva eventos y vínculos**: dar de baja no borra los eventos cronológicos (`R6`) ni los vínculos reproductivos (`reproductive_events.calf_id` / `bull_id`), ver `R4.15`.

**R4.15** (nueva, sesión 17 — la baja de madre/toro preserva el vínculo) Dar de baja (`R4.14`) un `animal_profile` que está referenciado por otro como **madre** (`reproductive_events.calf_id` apunta a un hijo suyo) o como **toro/padre** (`reproductive_events.bull_id`) **no deberá** romper el vínculo: la baja es un cambio de `status` (archivado), nunca un hard-delete. El sistema **nunca** deberá hard-deletear un `animal_profile` que esté referenciado como `calf_id` o `bull_id`. Las pantallas que navegan a la ficha de la madre (`R5.8` de spec 09 / `R14.7`) o del toro deberán **tolerar** que ese perfil tenga `status ≠ active` (mostrarlo como "vendida" / "muerta" / "transferida" según `exit_reason`, sin dead-end ni crash). La relación se sigue resolviendo vía los FKs de `reproductive_events`.

### R5. Identificación al cargar

**R5.1** El sistema deberá permitir buscar un animal por `tag_electronic` (match exacto, scope global) en el contexto del establecimiento activo. Si encuentra un `animal_profile` activo en ese establecimiento, lo retorna; si encuentra el animal pero no tiene perfil activo acá, deberá ofrecer "transferir/dar de alta en este campo".

**R5.2** El sistema deberá permitir buscar un animal por `idv` (match exacto, scope `establishment_id` activo).

**R5.3** El sistema deberá permitir búsqueda fuzzy de `visual_id_alt` (similarity ≥ 0.3) dentro del establecimiento activo.

**R5.4** Cuando el usuario no encuentra un animal por ninguno de los tres métodos, el sistema deberá ofrecer crear un animal nuevo en el momento desde la misma pantalla de búsqueda.

**R5.5** (nueva, sesión 17 — detección blanda de duplicado al alta) Al crear un `animal_profile` nuevo (offline o con conexión), el cliente deberá **avisar** si existe en el **mismo rodeo** otro `animal_profile` con un `visual_id_alt` o `idv` **parecido** al que se está cargando, usando el índice GIN trigram que ya existe (`R4.4` / `R5.3`), y preguntar "¿es el mismo animal?". El aviso **no bloquea** el alta: el operario puede confirmar que es un animal distinto y continuar. El objetivo es prevenir el duplicado **irreversible** en MVP, dado que el merge de duplicados se difirió a post-MVP (spec 09). El umbral de similitud sugerido reusa el de `R5.3` (≥ 0.3); ajustable. Es regla de cliente; el modelo expone el índice y la query de similitud.

**R5.6** (nueva, sesión 17 — TAG ya existente, incluso de un animal dado de baja) Cuando el usuario escanea o ingresa un `tag_electronic` que ya pertenece a un `animal` existente (la unicidad global de `R3.2` lo impide reasignar), el sistema deberá devolver un **error accionable** que identifique al animal dueño del TAG y su estado. Si ese animal está dado de baja (`status ≠ active`, ver `R4.14`), el mensaje deberá decirlo explícitamente, p. ej.: **"Este TAG pertenece a `<animal>`, dado de baja el `<fecha>`."** El flujo de corrección de un TAG cargado por error sigue `R4.13.b` (soft-delete del `animal_profile` + `animal` para liberar el TAG, luego alta correctiva). Un TAG de un animal **soft-deleted** (no solo dado de baja) sí queda libre para el alta correctiva por el unique parcial sobre `deleted_at IS NULL` (`R3.2`).

### R6. Eventos cronológicos

**R6.1** El sistema deberá modelar la tabla `weight_events` con `(id, animal_profile_id, session_id, weight_kg, weight_date, time, source, notes, created_by, created_at, deleted_at)`.

**R6.2** El sistema deberá modelar la tabla `reproductive_events` con `(id, animal_profile_id, session_id, event_type, event_date, service_type, bull_id, semen_id, pregnancy_status, estimated_days, estimated_birth, calf_id, calf_weight, calf_sex, notes, created_by, created_at, deleted_at)`. `event_type` es enum: `service | tacto | birth | abortion | weaning | drying | rejection`. `pregnancy_status` enum: `empty | small | medium | large` (corresponde a vacía / cabeza / cuerpo / cola — `CONTEXT/03-flujos-maniobras.md`).

**R6.3** El sistema deberá modelar la tabla `sanitary_events` con `(id, animal_profile_id, session_id, campaign_id, event_type, product_name, active_ingredient, dose_ml, route, event_date, next_dose_date, result, adverse_reaction, notes, created_by, created_at, deleted_at)`. `event_type` enum: `vaccination | deworming | treatment | test | other`.

**R6.4** El sistema deberá modelar la tabla `condition_score_events` con `(id, animal_profile_id, session_id, score, event_date, created_by, created_at, deleted_at)`. `score` numeric(3,2) con CHECK constraint `score IN (1.00, 1.25, 1.50, ..., 5.00)`.

**R6.5** El sistema deberá modelar la tabla `lab_samples` con `(id, animal_profile_id, session_id, sample_type, tube_number, collection_date, lab_destination, result, result_interpretation, result_received_date, notes, created_by, created_at, deleted_at)`. `sample_type` enum: `blood | scrape_tricho | scrape_campylo | other`.

**R6.6** Toda tabla de eventos del R6.1 al R6.5 deberá enforce que `animal_profile_id` exista y no esté soft-deleted al momento del insert.

**R6.7** El sistema deberá registrar `created_by = auth.uid()` por trigger automático en todas las tablas de eventos.

**R6.8** Toda tabla de eventos deberá ser accesible (SELECT, INSERT) por usuarios con rol activo en el `establishment_id` derivado del `animal_profile_id`. UPDATE y DELETE de eventos solo por `owner` o por el `created_by` del evento (corrección de propio error).

**R6.8.1** (refina R6.8, sesión 17 — corrección de eventos tipados sin ventana de tiempo) La edición y el soft-delete de los **5 eventos tipados** (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) deberán estar permitidos al `owner` o al `created_by` del evento **sin ventana de tiempo** — corregir un peso o un tacto viejo es una operación legítima (un dato cargado mal hace meses debe poder arreglarse). Esto **contrasta** explícitamente con la ventana de 15 minutos de `R6.12`, que aplica **solo** a las observaciones libres de `animal_events` (`'observacion' | 'otro'`), no a los eventos tipados. **Alineación con spec 09**: spec 09 `R5.5` debe interpretarse como "la ventana de 15 min aplica solo a `animal_events`; los eventos tipados se editan/borran por owner/autor sin límite temporal" — la versión de spec 09 R5.5 que asumía 15 min para *todos* los eventos del timeline es una inconsistencia a corregir en el lado de spec 09 (anotado para su refinamiento; spec 02 fija la regla de modelo acá).

**R6.9** El sistema deberá exponer una "cronología del animal" — un ordenamiento de todos los eventos de un `animal_profile_id` por `event_date` (o `weight_date` / `collection_date` según la tabla) descendente, con tipo de evento etiquetado para que el cliente pueda renderizar la ficha.

**R6.14** (nueva, sesión 17 — recálculo de categoría al corregir un evento que disparó transición) Cuando se **edita o soft-deletea** un evento tipado que había disparado una transición automática de categoría (típicamente un `reproductive_events` de `tacto` positivo o de `birth`, ver `R7`), y el `animal_profile` tiene `category_override = false`, el sistema deberá **recalcular la categoría** del perfil vía `compute_category` (`R7.6`) sobre el set de eventos resultante. Si `category_override = true`, no se recalcula (el override manda, `R4.9`). El recálculo deberá registrar el cambio resultante en `animal_category_history` (`R10.3`) con `reason` adecuado. Además, el cliente deberá **marcar en el timeline el evento como "corregido"** (editado o borrado) para que la cronología refleje que hubo una corrección, sin perder el audit trail (el soft-delete preserva la fila). El recálculo a nivel server lo hace un trigger sobre las tablas tipadas que participan de transiciones; el detalle vive en design.

> **Nota sobre gating (capa DB)**: el enforcement que rechaza persistir un evento cuyo data_key no está `enabled` en el `rodeo_data_config` del rodeo del animal (mapeo de R2.7) es **scope de spec 03**, no de spec 02. Spec 02 deja el sustrato (las tablas de plantilla, el mapeo documentado, RLS). Las tablas de eventos de R6 no incorporan ese check todavía.

### R6.B Eventos libres / observaciones (`animal_events`) — modelo Híbrido

> Esta tabla **no reemplaza** a las 5 tablas tipadas del R6.1..R6.5; convive con ellas y solo cubre los tipos `observacion` y `otro`. El motivo: data analytics es pilar del producto y necesita type-safety a nivel DB sobre lo que se cuenta/filtra/grafica (las 5 tablas tipadas resuelven eso); las observaciones libres del operador (sin schema) se modelan acá.

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

**R7.2** Cuando se registra un **parto** (un `reproductive_events` con `event_type = 'birth'`), sobre un `animal_profile` con `category.code = 'vaquillona_prenada'` y `category_override = false`, el sistema deberá actualizar `category_id` a `vaca_segundo_servicio`. (Ver `R7.9`: un parto es **un** evento `birth`, aunque haya parido N terneros — mellizos no cuentan como dos partos.)

**R7.3** Cuando se registra un **segundo parto** sobre un `animal_profile` con `category.code = 'vaca_segundo_servicio'` y `category_override = false`, el sistema deberá actualizar `category_id` a `multipara`. (refina, sesión 17) "Segundo parto" significa el **segundo evento `birth` distinto** sobre ese perfil, contando **partos**, no terneros: dos terneros mellizos nacidos en un mismo parto son **un** evento `birth` y por lo tanto **un** parto. El conteo de partos en `compute_category` (`R7.6`) debe contar eventos `birth` distintos (no sumar terneros). Ver `R7.9`.

**R7.4** El sistema no deberá hacer transiciones automáticas a `cut`. CUT es siempre manual (cubierto por R8).

**R7.5** Si un trigger de transición intenta cambiar a una categoría que no existe en `categories_by_system` para el sistema correspondiente, entonces el sistema deberá loggear el error pero NO bloquear el insert del evento (el evento se persiste; la categoría queda sin cambiar).

**R7.6** El sistema deberá exponer una vista o función `compute_category(animal_profile_id)` que recalcule la categoría a partir de cero leyendo todos los eventos del perfil. La función se invoca desde R4.10 al revertir un override y desde herramientas de mantenimiento.

**R7.7** El sistema **no deberá** modificar `rodeo_id` ni `management_group_id` en ninguna transición automática de categoría (ortogonalidad de los tres ejes, ADR-020). Un animal que pasa de `vaca_segundo_servicio` a `multipara` por un parto permanece en su mismo rodeo y su mismo lote.

**R7.8** (nueva, sesión 17 — las transiciones por EDAD no son automáticas por reloj en MVP) El sistema **no deberá** transicionar la categoría de un animal por el **paso del tiempo**. No hay cron ni job que re-evalúe la edad: un `ternero`/`ternera` no se convierte en `vaquillona`/`torito` solo porque cumplió un año. Las transiciones etáreas (destete) ocurren únicamente:
- por un **evento de destete** (`reproductive_events` con `event_type = 'weaning'` — la maniobra real que el operario registra), que dispara la transición de la categoría del ternero a la categoría destetada correspondiente del sistema; o
- **manualmente** (override desde la ficha, `R4.8`).

Las transiciones por **evento reproductivo** (tacto positivo, parto) siguen como en `R7.1`–`R7.3` (son por evento, no por reloj). Esta requirement aclara explícitamente el alcance: `compute_category` (`R7.6`) usa `birth_date`/edad **solo** para resolver el punto de partida en el alta (`R4.7`) y como desempate en ausencia de eventos, **no** como disparador continuo. El mapeo "evento de destete → categoría destino del ternero" para `(bovino, cría)` se detalla en design (criterio del autor de spec a confirmar: `ternero → torito`, `ternera → vaquillona`).

**R7.9** (nueva, sesión 17 — mellizos: un parto = un evento con N terneros) El sistema deberá modelar un **parto** como **un** `reproductive_events` con `event_type = 'birth'` que puede tener **N terneros asociados** (no exactamente uno). El modelo actual, donde el trigger de ternero al pie crea exactamente un ternero por evento `birth` y `compute_category` cuenta eventos `birth` como partos, está **mal** para mellizos: dos eventos `birth` separados (uno por mellizo) marcarían erróneamente a la madre como multípara con un solo parto real. La corrección conceptual (el detalle de modelado lo define design; las migrations las hará el implementer, no este spec):
- un parto se registra como **un solo evento `birth`** sobre el perfil de la madre, al que se pueden asociar **uno o más terneros** (cada ternero sigue siendo un `animal` + `animal_profile` independiente, `R9`);
- la asociación madre→terneros deja de ser un único `reproductive_events.calf_id` por evento: se modela como **una relación uno-a-muchos** (un evento de parto → N terneros). El design propone el mecanismo concreto (p. ej. una tabla puente `birth_calves(birth_event_id, calf_profile_id)` o múltiples filas-hijo vinculadas al mismo evento de parto), preservando que cada ternero es entidad independiente y que el vínculo a la madre se sigue resolviendo (`R4.15`, `R9.2`);
- `compute_category` (`R7.6`) y los triggers de transición (`R7.2`/`R7.3`) deben contar **partos** (eventos `birth` distintos), **no** terneros. El conteo de partos = `count(distinct birth_event)`.

El alta del/los ternero(s) al pie (`R9`) sigue ocurriendo en el mismo flujo del evento de parto; `R9` se actualiza para soportar N terneros por evento.

### R8. CUT y dientes

**R8.1** El sistema deberá permitir que el usuario actualice `teeth_state` en `animal_profiles`. Valores válidos (enum): `'2d' | '4d' | '6d' | 'boca_llena' | '3/4' | '1/2' | '1/4' | 'sin_dientes'`.

**R8.2** `teeth_state` deberá ser sobreescribible sin generar historial (es propiedad, no evento). Su última escritura es el estado vigente.

**R8.3** El sistema no deberá mostrar `teeth_state` ni el prompt CUT en la UI para animales con `category.code IN ('ternero', 'ternera')`.

**R8.4** Cuando el usuario actualiza `teeth_state` a `1/2`, `1/4` o `sin_dientes` y el animal no tiene `is_cut = true`, el cliente deberá mostrar un prompt "¿Marcar como CUT (Criando Último Ternero)?" con dos opciones explícitas. Si el usuario confirma, el sistema deberá setear `is_cut = true`, `category_id = (categoría cut del sistema)` y `category_override = true` en el mismo update.

**R8.5** El sistema deberá permitir setear `is_cut` y la categoría CUT vía un endpoint/función explícito desde la ficha del animal, independiente del prompt automático del R8.4 (el usuario puede marcar CUT directamente sin tocar dientes).

### R9. Ternero al pie

**R9.1** Cuando se inserta un `reproductive_events` con `event_type = 'birth'`, `calf_weight` o `calf_sex` provisto, y `calf_id` aún `NULL`, el sistema deberá:
- Crear automáticamente una fila en `animals` con `species_id = (mismo que la madre)`, `sex = calf_sex`, `birth_date = event_date` (`tag_electronic = NULL` salvo que el cliente lo provea junto con el evento).
- Crear automáticamente una fila en `animal_profiles` con `animal_id = (la nueva)`, `establishment_id = (mismo que la madre)`, `rodeo_id = (mismo que la madre)`, `management_group_id = NULL` (el ternero no hereda el lote de la madre; el productor lo asigna si quiere), `category_id = ternero | ternera` según `calf_sex`, `birth_weight = calf_weight`, `entry_date = event_date`, `entry_origin = 'born_here'`, `status = 'active'`, `category_override = false`.
- Linkear el `reproductive_events.calf_id` con el nuevo `animal_profiles.id`.
- Validar el constraint de identificación (R4.2): el ternero recién nacido puede no tener TAG ni IDV todavía; el sistema deberá poblar `visual_id_alt = 'recién nacido — pendiente de caravana'` como fallback hasta que el usuario complete la identificación. El cliente deberá generar un recordatorio de "completar caravana del ternero" dentro de los 7 días siguientes (la generación del recordatorio queda fuera de scope MVP de este spec; el campo `visual_id_alt` debe permitir el alta).

**R9.2** El ternero recién creado deberá ser una entidad independiente: editar sus datos, cargarle eventos propios y mostrarlo en su propia ficha. La relación con la madre se preserva exclusivamente vía `reproductive_events.calf_id`.

**R9.3** Si el cliente provee `tag_electronic` del ternero al insertar el `reproductive_events` (campo opcional), el sistema deberá usar ese TAG en el `animals` creado y no aplicar el fallback `visual_id_alt`.

**R9.4** Si el insert del ternero falla por cualquier motivo (TAG duplicado, etc.), entonces el sistema deberá hacer rollback del `reproductive_events` completo y retornar un error claro al cliente.

**R9.5** (nueva, sesión 17 — N terneros por parto / mellizos) El alta del ternero al pie deberá soportar **uno o más terneros** asociados al **mismo** evento de parto (`R7.9`), no exactamente uno. Cuando un evento `birth` trae datos de **varios** terneros (cada uno con su `calf_sex` y opcionalmente `calf_weight` / `calf_tag_electronic`), el sistema deberá crear un `animal` + `animal_profile` independiente **por cada** ternero (cada uno con `category_id = ternero | ternera` según su sexo, heredando establishment + rodeo de la madre, `management_group_id = NULL`, `entry_origin = 'born_here'`, `status = 'active'`, `category_override = false`), y vincular **todos** al mismo evento de parto vía la relación uno-a-muchos de `R7.9`. El conteo de partos para la transición de categoría de la madre (`R7.2`/`R7.3`, `R7.6`) cuenta **el evento de parto una sola vez**, sin importar cuántos terneros tuvo. El fallback de identificación (`R9.1`, `visual_id_alt = 'recién nacido — pendiente de caravana'`) aplica por ternero. Si el insert de **cualquiera** de los terneros falla, el sistema deberá hacer rollback del evento de parto completo (`R9.4`). El mecanismo concreto (cómo el cliente envía N terneros y cómo el trigger/función los crea) lo define design.

### R10. Cronología (ficha del animal)

**R10.1** El sistema deberá exponer una función SQL `animal_timeline(profile_id uuid)` que retorne un set de eventos unificados con `(event_kind, event_id, event_date, payload_jsonb)` ordenados por `event_date desc, created_at desc`. `event_kind` enum/text: `weight | reproductive | sanitary | condition_score | lab_sample | category_change | observacion`. El séptimo origen `observacion` proviene de `animal_events` (R6.10..R6.13) y trae en `payload` al menos `{ event_type, text, structured_payload, author_id, edit_window_until }`. El `event_date` para este origen es `created_at` de la fila de `animal_events`.

**R10.2** El sistema deberá enforce vía RLS que la función `animal_timeline` solo retorne eventos cuyo `animal_profile_id` pertenezca a un establecimiento donde `auth.uid()` tiene rol activo.

**R10.3** El sistema deberá incluir en la cronología los cambios de categoría como `event_kind = 'category_change'`. Para esto, el spec introduce una tabla auxiliar `animal_category_history` con `(id, animal_profile_id, from_category_id, to_category_id, changed_at, changed_by, reason)` donde `reason` enum: `auto_transition | manual_override | revert_to_auto | initial`. Cada UPDATE de `animal_profiles.category_id` deberá grabar una fila en esta tabla vía trigger.

### R11. Aislamiento multi-tenant y RLS

**R11.1** El sistema deberá hacer cumplir el aislamiento entre tenants mediante RLS de Postgres para todas las tablas con `establishment_id` directo o transitivo (`rodeos`, `rodeo_data_config`, `management_groups`, `animal_profiles`, `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_category_history`, `animal_events`).

**R11.2** Para tablas con `animal_profile_id` (no tienen `establishment_id` directo), el sistema deberá derivar el establishment vía join al `animal_profiles` correspondiente para evaluar `has_role_in(...)` en las policies. Para `rodeo_data_config` (que tiene `rodeo_id`), el establishment se deriva vía join a `rodeos`.

**R11.3** El sistema deberá garantizar que `animals` (tabla global) solo sea visible al usuario si tiene rol activo en algún establishment con un `animal_profile` activo o soft-deleted (`deleted_at IS NULL` o `deleted_at IS NOT NULL` pero el usuario sigue teniendo rol) de ese animal.

**R11.4** El sistema deberá garantizar que las operaciones administrativas sobre `rodeos` (INSERT, UPDATE, soft-DELETE), sobre `rodeo_data_config` (toggle/habilitar field), sobre `management_groups` (crear/editar/soft-delete) y sobre el bulk-edit de animales (UPDATE de varios `animal_profiles` a la vez) solo sean accesibles a usuarios con `role = 'owner'` en ese establishment.

**R11.5** Cualquier `field_operator` o `veterinarian` con rol activo deberá poder INSERT eventos en las tablas del R6 sobre `animal_profiles` de su establishment, INSERT de nuevos `animal_profiles` (los animales se dan de alta en el campo durante la maniobra), y **asignar un animal a un lote** (`UPDATE animal_profiles.management_group_id`).

### R12. Soft deletes y auditoría

**R12.1** El sistema deberá incluir `deleted_at` (timestamp nullable) en `animals`, `animal_profiles`, `rodeos`, `management_groups`, y todas las tablas de eventos del R6. (`rodeo_data_config` no lleva `deleted_at` — el toggle vive en `enabled`.)

**R12.2** El sistema deberá incluir `created_at` y `updated_at` en todas las entidades (eventos solo `created_at`, son inmutables salvo borrado).

**R12.3** Cuando una entidad tiene `deleted_at IS NOT NULL`, las RLS policies por default no deberán retornarla en SELECT salvo en queries administrativas explícitas (consistente con spec 01).

**R12.4** El sistema deberá grabar en `animal_category_history` cada cambio de categoría con `reason` correspondiente para auditoría.

### R13. Sincronización offline

**R13.1** Las tablas `animals`, `animal_profiles`, `rodeos`, `management_groups`, `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`, `rodeo_data_config`, `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_category_history`, `animal_events` deberán estar configuradas en PowerSync como sincronizables. Los buckets se definen en `design.md`.

**R13.2** La carga unitaria de un animal nuevo, de eventos individuales sobre un animal, y la **asignación de lote** deberán funcionar offline. Cuando hay conexión, PowerSync sincroniza; cuando no hay, los datos quedan en SQLite local con `pending_sync` lógico.

**R13.3** Mientras el cliente está offline, el sistema deberá permitir validar el constraint de identificación (R4.2) localmente — la validación CHECK del DB es la última red, pero el cliente debe rechazar el form si los tres identificadores están vacíos antes de enviarlo a la cola.

**R13.4** Mientras el cliente está offline, las transiciones automáticas de categoría (R7) deberán ser previsualizadas en el cliente vía un módulo TypeScript compartido. Al sincronizar, el trigger Postgres revalida; si hay divergencia (raro), gana el server (`last-write-wins`).

**R13.5** Las tablas de configuración (`species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`) deberán cargarse en SQLite local al primer login y refrescarse periódicamente (TTL ~24 hs). Cambios de seed se propagan vía nueva migration y sync.

### R14. Cliente: ficha del animal

> **⚠️ Sección TENTATIVA** (aprobada con reserva el 2026-05-26). Las requirements R14.1..R14.8 describen QUÉ tiene que mostrar y hacer la pantalla a nivel funcional — independiente del design system. Cuando se cierre el design system (item A.1 del `progress/plan.md`) y se aborde la Fase 4 (frontend) del `tasks.md`, esta sección puede recibir **refinamiento incremental** sin reabrir el spec entero: layout específico, componentes visuales, microinteractions, navegación entre tabs/scroll, empty states, copy final del prompt CUT, etc.

**R14.1** El sistema deberá exponer una pantalla "Ficha de animal" accesible desde una lista de animales o desde la búsqueda.

**R14.2** La pantalla deberá mostrar la cabecera con `tag_electronic`, `idv`, `visual_id_alt`, `category`, `sex`, `birth_date`, `breed`, `coat_color`, `status`, el **rodeo** y el **lote** (`management_group`, si tiene) del animal, y la cronología de eventos (R10) debajo.

**R14.3** Cada evento de la cronología deberá renderizarse con un componente específico por tipo (peso → kg, tacto → status, vacuna → producto, etc.) y un timestamp legible.

**R14.4** Donde el usuario tenga rol `owner` o sea el `created_by` del evento, la UI deberá permitir editar o soft-deletear ese evento desde la ficha. Para otros usuarios, los eventos se muestran read-only.

**R14.5** La pantalla deberá permitir editar la categoría manualmente (que dispara R4.8) y mostrar el toggle "categoría automática on/off" (que dispara R4.10).

**R14.6** La pantalla deberá ofrecer un botón "Marcar como CUT" que dispara R8.5 con confirmación.

**R14.7** Si el animal es ternero o ternera, la pantalla deberá mostrar un link a la ficha de la madre derivado del `reproductive_events.calf_id` (o de la relación uno-a-muchos de `R7.9`) que lo originó. (refina, sesión 17) El link deberá **tolerar** que la madre tenga `status ≠ active` (vendida / muerta / transferida por `R4.14`): se navega igual a su ficha y se la muestra como archivada con su `exit_reason`, sin dead-end ni crash (`R4.15`). Lo mismo aplica a cualquier navegación a la ficha del **toro/padre** (`bull_id`).

**R14.8** La pantalla deberá permitir **asignar o cambiar el lote** del animal (`management_group_id`), eligiendo entre los `management_groups` activos del establecimiento o "sin lote". Esta acción la puede hacer cualquier rol operativo activo (R2.17). La UI concreta del selector es TENTATIVA (sujeta a design system).

**R14.9** (nueva, sesión 17 — baja/egreso desde la ficha) La pantalla deberá ofrecer una acción **"Dar de baja"** (egreso, `R4.14`) que permita elegir el `status` destino y el `exit_reason` (enum `sale | death | transfer | culling | theft | other`), capturar `exit_date` y opcionalmente `exit_weight` / `exit_price`, y confirmar. La acción solo deberá estar disponible para el `owner` o el operario que cargó el animal (`R4.14`). Tras la baja, la ficha deberá mostrarse en modo "archivada" (con el motivo y la fecha de egreso), conservando la cronología. La UI concreta es TENTATIVA (sujeta a design system).

**R14.10** (nueva, sesión 17 — empty states, diferidos al refinamiento de R14) Los **empty states** de las pantallas de este spec quedan **diferidos al refinamiento de R14** (cuando se cierre el design system, ver el encabezado TENTATIVO de la sección). Se enumeran acá para no perderlos, sin definir los detalles ahora:
- **lista de animales vacía** (rodeo recién creado sin altas);
- **timeline vacío** (animal sin eventos cargados);
- **selector de lote sin lotes**, con CTA condicionado por rol — crear lote es **owner-only** (`R2.17`), así que el empty state ofrece "crear lote" solo al owner y un mensaje neutro al resto;
- **sin resultados de búsqueda** (TAG/IDV/`visual_id_alt` sin match).

El copy, los CTAs y el layout concretos se resuelven al refinar R14; acá solo queda el inventario.

### R15. — (eliminada)

La sección original R15 "Cliente: alta y búsqueda de animales" (R15.1..R15.5) **fue eliminada** porque la UX de búsqueda + alta interactiva se mueve a spec 09 `09-buscar-animal`. Spec 02 queda como modelo de datos puro: expone schema, RLS, triggers y la capacidad de búsqueda (R5) + cronología (R10), y spec 09 se encarga de toda la UX (form dinámico por rodeo, dos puertas — manual + bastón BLE —, find-or-create, selección de rodeo con `lastRodeoSelected`, etc.).

Las capacidades subyacentes del modelo siguen acá:
- R5.1..R5.4: búsqueda por TAG / IDV / `visual_id_alt` con scoping por establishment activo.
- R4.13: inmutabilidad de identificadores post-completitud (regla del modelo, no UX).
- R4.7: cálculo automático de categoría inicial.
- R2.B: el form dinámico de alta lee `rodeo_data_config` del rodeo elegido para saber qué datos ofrecer.
- R13.3: validación local de al menos un identificador antes de envío.
- R10: cronología (consumida por la pantalla de edit de spec 09).

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- Un usuario que crea un establishment llega a la app y **no tiene rodeo automático**: el wizard de "Crear rodeo" lo lleva a elegir sistema (solo `cría` seleccionable; resto grisado "Próximamente"), nombrar el rodeo y tildar/destildar los datos de la plantilla. Tras confirmar, queda creado el rodeo + las filas correspondientes en `rodeo_data_config` (con valores que respetan los toggles del usuario). Mientras no haya rodeo, la app bloquea el resto de la navegación.
- El catálogo `field_definitions` tiene los 26 fields de cría seedeados; un cliente authenticated puede leerlos pero no modificarlos.
- Al crear un rodeo de cría, `rodeo_data_config` queda pre-poblado con los `system_default_fields` de cría (23 en `true`, 3 en `false`).
- Un owner puede **habilitar en un rodeo un dato que no es default de su sistema** (caso "tambo que tactea preñez": habilita `prenez` aunque el sistema sea tambo) — el dato existe en el catálogo global, así que el INSERT en `rodeo_data_config` es aceptado.
- Un `field_operator` no puede modificar `rodeo_data_config` (RLS lo rechaza); un `owner` sí.
- Un usuario con rol activo puede crear un animal con **solo TAG**, **solo IDV** o **solo `visual_id_alt`** (cualquiera de los tres) y el sistema lo acepta. Intentar crearlo con los tres vacíos falla con error claro.
- Un usuario crea un animal hembra de < 1 año en cría bovina y el sistema le asigna `category = ternera` automáticamente. El mismo animal a 18 meses queda como `vaquillona`.
- Al registrar un tacto positivo sobre una vaquillona, su categoría pasa automáticamente a `vaquillona_preñada`. Al registrar el parto, pasa a `vaca_segundo_servicio`. Si el usuario cambió manualmente la categoría antes, el override se respeta. **En ninguno de estos cambios se modifica el `rodeo_id` ni el `management_group_id`** (ortogonalidad).
- Al registrar un parto con `calf_weight` y `calf_sex`, el sistema crea automáticamente el ternero como entidad independiente (con `management_group_id = NULL`) y linkea madre ↔ ternero vía `reproductive_events.calf_id`.
- Un owner puede crear un `management_group` ("Otoño 2026") y asignarle animales de distintas categorías; un `field_operator` puede asignar/transferir un animal a un lote pero no crear/borrar lotes. La regla de display agrupa por lote si tiene, si no por categoría.
- La ficha del animal muestra todos los eventos cargados ordenados cronológicamente, incluyendo los 5 tipos tipados (peso / reproductivo / sanitario / condition score / lab) **+ las observaciones libres de `animal_events`** (modelo Híbrido) **+ los `category_change` históricos**, más el rodeo y el lote del animal en la cabecera.
- Una observación libre creada por un usuario se puede editar dentro de los 15 minutos del INSERT (`edit_window_until`). Pasada la ventana, el sistema rechaza el UPDATE de `text`, `structured_payload` o `event_type` y solo permite soft-delete.
- Los identificadores formales (`tag_electronic`, `idv`) no se pueden modificar post-completitud (R4.13). `visual_id_alt` sí se puede actualizar.
- Cargar un animal en el campo (sin conexión), cargarle eventos y asignarle un lote funciona end-to-end: queda persistido local, sincroniza al volver red, los triggers del server revalidan y no hay divergencia.
- RLS impide que un usuario lea o modifique animales / eventos / lotes / config de rodeo de un establishment donde no tiene rol activo (validado con tests reales contra DB remota).
- Todo lo anterior funciona con Supabase + cliente React Native (frontend puede estar pausado en el backend-only en MVP, pero el spec describe ambos lados).

## Changelog

> Audit trail de la evolución del spec. No se borra (mismo principio de inmutabilidad que los ADRs). Entradas en orden cronológico inverso.

- **2026-05-30 (sesión 20) — Fold del Tier 1 del bloque backend (delta s17/s18) a spec firme**. El backend de spec 02 estaba `done` (migrations 0013-0042); este bloque **reabre un incremento** sobre él. Se folda **solo el Tier 1** (5 items, sin dependencia externa) de las decisiones ya aprobadas en Gate 0 (refinamientos s17/s18). **No** se escriben migrations ni código; las migrations nuevas las hace el implementer y arrancan en **0043+**. Cambios en `requirements.md`:
  - **`created_by` en `animal_profiles`** (item 1): agregada la columna a la lista de **R4.1** (FK nullable a `users(id)`, seteada por trigger BEFORE INSERT a `auth.uid()`). Es la columna de autoría de la que ya dependía la baja de animal (`R4.14`).
  - **`exit_reason` text → enum** (item 2): `R4.14` ya define el conjunto `sale|death|transfer|culling|theft|other` desde sesión 17. El fold lo deja firme; el design especifica la migration de conversión texto→enum (creación del tipo + ALTER + backfill seguro).
  - **Mellizos / conteo de partos** (item 3): `R7.9`/`R9.5`/`R7.2`/`R7.3` ya definen el modelo (1 evento `birth` → N terneros; contar partos, no terneros) desde sesión 17. El fold lo deja firme; el design especifica la tabla puente `birth_calves`, el ajuste del trigger de alta de ternero (N terneros) y el conteo por evento `birth` en `compute_category`.
  - **Recálculo de categoría al corregir un evento** (item 4): `R6.14` ya está desde sesión 17. El fold lo deja firme; el design especifica el trigger AFTER UPDATE/DELETE sobre `reproductive_events` que recomputa vía `compute_category` si `category_override = false` y registra en `animal_category_history`.
  - **`R4.5.1` relajada** (item 5): **cambio de requirement** — de "cambio de rodeo bloqueado en MVP" a "**permitido cambiar `rodeo_id` dentro del mismo `system_id`**; rechazar cross-sistema (evita dead-end de categoría, `R4.6`)". Actualizada la entrada correspondiente de **Decisiones tomadas**. La validación de mismo-sistema se enforce a nivel DB (trigger BEFORE UPDATE de `rodeo_id`, ver design).
  - **DEFERIDO explícitamente (fuera del Tier 1)**: **Tier 2** — ramas de transición de **aborto** (`abortion`) y **destete** (`weaning`): los targets de categoría están **pendientes de Facundo**; no se escriben las ramas (nota "DEFERIDO Tier 2" en design, cerca de R7). **Tier 3** — catálogo de razas SENASA + migración de `breed` (texto→FK) y **castración** (`castracion`: data_key + efecto de categoría): **pendientes de Facundo/research** (nota "DEFERIDO Tier 3" en design). **Transferencia re-parenting** (R4.11→MVP): es **feature 11** (spec propia + Gate 1), **no** parte de este bloque.
  - **IDs preservados**: ninguna requirement se renumeró; el fold solo edita el contenido de R4.1 y R4.5.1, la entrada de Decisiones tomadas y agrega esta entrada de Changelog.
  - **Endurecimiento Gate 1 (FAIL → fix)**: el Gate 1 (security_analyzer modo `spec`) sobre el delta Tier 1 dio **FAIL** (2 HIGH + 2 MEDIUM, reporte `progress/security_spec_02-modelo-animal.md`). Los 4 findings (SEC-SPEC-01..04) se cerraron **en `design.md` + `tasks.md`** (guarda de `exit_animal_profile` con rol activo obligatorio; RPC `register_birth` de mellizos de prosa a SQL firme con authz derivada de la fila real de la madre; `created_by` forzado server-side; `birth_calves` `select`-only poblada server-side con filtro `deleted_at`). **No** se renumeró ni modificó ninguna requirement por estos fixes: son endurecimientos del SQL de diseño contra patrones ya canonizados (`0041`/`0042`, SEC-HIGH-01). `R4.14`/`R7.9`/`R9.5`/`R4.1` mantienen su texto; los tests de no-bypass viven en `tasks.md` T2.19. Ver el sub-bloque "Endurecimiento Gate 1" del Changelog de `design.md`.
- **2026-05-29 (sesión 17) — Refinamiento de edge cases (Gate 0 retroactivo)**. Decisiones tomadas por Raf en sesión 17 sobre la spec ya aprobada. **No** toca código/tests/migrations (las migrations correspondientes las hará el implementer); fija el modelo y los requirements. Cambios:
  - **Baja / egreso de animal**: nuevas **R4.14** (dar de baja con `status` + `exit_reason` enum `sale|death|transfer|culling|theft|other`, no soft-delete, owner + operario que cargó el animal, desde la ficha) y **R4.15** (preserva el vínculo madre/toro; nunca hard-delete de un perfil referenciado como `calf_id`/`bull_id`; las fichas toleran madre/toro `status ≠ active`). Refinadas **R4.12** (apunta a R4.14) y **R14.7** (tolera madre archivada); nueva **R14.9** (baja desde la ficha).
  - **Mellizos / conteo de partos**: nuevas **R7.9** (un parto = un evento `birth` con N terneros, relación uno-a-muchos; el conteo cuenta partos, no terneros) y **R9.5** (alta de N terneros por evento de parto). Refinadas **R7.2**/**R7.3** (conteo de partos distintos, no terneros).
  - **Transiciones por EDAD no automáticas por reloj**: nueva **R7.8** (no hay cron; destete por evento `weaning` o manual). Refinada **R4.7** con nueva **R4.7.1** (default conservador para `birth_date IS NULL` — adulto por sexo sin evento; **requiere confirmación**).
  - **Corrección de eventos tipados sin ventana de tiempo + recálculo**: nuevas **R6.8.1** (los 5 tipados se editan/borran por owner/autor sin límite temporal; la ventana de 15 min es solo de `animal_events`; corrige la inconsistencia de spec 09 R5.5) y **R6.14** (editar/borrar un evento que disparó transición recalcula la categoría vía `compute_category` si no hay override; timeline marca "corregido").
  - **Detección blanda de duplicado al alta + TAG no reusable**: nuevas **R5.5** (aviso no-bloqueante de `visual_id_alt`/`idv` parecido en el mismo rodeo, vía trigram existente) y **R5.6** (error accionable al escanear un TAG ya existente, incluso de un animal dado de baja). Refinada **R4.13.b** (corrección de TAG erróneo vía soft-delete que libera el TAG por el unique parcial).
  - **Cambio de rodeo bloqueado en MVP**: nueva **R4.5.1** (no se mueve de rodeo post-alta; la UI no lo ofrece; limitación conocida hasta multi-sistema).
  - **Plantilla / config de rodeo**: nueva **R2.12.1** (el timeline muestra historial aunque el data_key esté `enabled=false` o el field `active=false`; aviso al owner al destildar un dato con eventos cargados). Acotación de **R2.11** (la garantía de "nunca config vacía" vale solo para sistemas con `system_default_fields` seedeados; activar un sistema nuevo exige seedear sus defaults en la misma migration).
  - **Empty states**: nueva **R14.10** (enumerados —lista vacía, timeline vacío, selector de lote sin lotes con CTA owner-only, sin resultados de búsqueda— y **diferidos al refinamiento de R14**).
  - **Decisiones tomadas**: agregadas las 6 decisiones de sesión 17 (baja de animal, mellizos, transiciones por edad, corrección de eventos tipados, cambio de rodeo bloqueado, `entry_origin` enum → backlog post-MVP).
  - **Decisiones de criterio propio del autor de spec (a validar por Raf/Facundo)**: (1) default para `birth_date IS NULL` = adulto por sexo sin evento (hembra `vaquillona`, macho `torito`); (2) modelado de N terneros por parto como relación uno-a-muchos (tabla puente o filas-hijo vinculadas al evento de parto) — el mecanismo exacto se deja a design/implementer; (3) mapeo "evento de destete → categoría destino" (`ternero → torito`, `ternera → vaquillona`); (4) umbral de similitud para el duplicado blando reusa el ≥0.3 de R5.3.
- **2026-05-28 — Refundición consolidada (incorpora ADR-020 lote + ADR-021 plantilla de datos)**. Cierra los dos hilos abiertos sobre spec 02 en una sola pasada para no consolidar el bug ni tocar la spec dos veces. Cambios:
  - **Hilo A (plantilla de datos)**: se **reemplaza** el modelo buggeado de la versión 2026-05-27 (`system_data_templates` catálogo *por sistema*, que no soportaba "rodeo de tambo que tactea preñez") por el modelo canónico de ADR-021 — **tres tablas**: `field_definitions` (catálogo GLOBAL), `system_default_fields` (defaults/required por sistema), `rodeo_data_config` (toggle por rodeo, FK a `field_definitions`). Nuevas R2.8–R2.13. El seed de cría se cierra (26 fields, TENTATIVO hasta Facundo). Se documenta el mapeo maniobra→data_keys y el gating doble capa en R2.7 (enforcement en spec 03).
  - **Hilo B (lote)**: se incorpora lote como tercer eje (ADR-020). Nueva sección R2.C (R2.14–R2.18) con tabla `management_groups` (nombre canónico resuelto acá; ADR-020 lo dejó tentativo) + columna `animal_profiles.management_group_id`. Regla de display "lote si tiene, si no categoría". R7.7 nueva confirma ortogonalidad (transiciones no tocan rodeo ni lote).
  - **Migrations renumeradas**: la `0016` buggeada (`system_data_templates`) se reemplaza por `0016`/`0017`/`0018` (las tres tablas de plantilla + trigger de auto-poblado); `management_groups` + `animal_profiles.management_group_id` entran como `0034`. Resto corre. Detalle en `tasks.md` y `design.md`.
  - **Consolidación**: el cuerpo se reescribió para integrar plantilla y lote orgánicamente; el historial previo se movió a este Changelog. Se preservó todo el detalle ganado (R4.13 inmutabilidad post-completitud, split insert+select, modelo Híbrido `animal_events`, cálculo de categoría inicial R4.7, ternero al pie R9, transiciones R7).
  - **Empty state**: R2.6 ahora especifica bloqueo total (wizard como primera pantalla) hasta que exista al menos un rodeo.
- **2026-05-27 — Plantilla de datos por sistema + eliminación de rodeo default** *(superada parcialmente por la refundición 2026-05-28)*. Eliminó la auto-creación de "Rodeo principal" (R2.6 reescrita a wizard manual). Introdujo R2.B con `system_data_templates` + `rodeo_data_config` como catálogo **por sistema** — modelo que resultó tener un bug estructural (no permitía reusar un dato entre sistemas) y fue reemplazado por ADR-021 en la refundición 2026-05-28.
- **2026-05-26 — Refinamiento R4.13 (destrabar tensión con spec 09 R12)**. La inmutabilidad de `tag_electronic` e `idv` se relajó de "post-alta absoluta" a "post-completitud": `NULL → valor` permitido, `valor → otro valor` y `valor → NULL` prohibidos. Migration de inmutabilidad actualizada con la condición `old IS NULL ⇒ return new`.
- **2026-05-26 — Aprobación**. Spec aprobado por Raf con R14 (ficha) marcada como TENTATIVA hasta cerrar el design system. R1..R13 y R6.B definitivas. Backend (Fase 1+2) libre para implementar.
- **2026-05-26 — Refinamiento previo a aprobación**. Adoptado modelo Híbrido de eventos (5 tablas tipadas + `animal_events` para observaciones libres, ADR-017 matizado). Agregada R6.B. Extendida R10.1 con séptimo origen `observacion`. Eliminada R15 (UX de búsqueda/alta movida a spec 09). Agregada R4.13 (inmutabilidad). Confirmada terminología rodeo+sistema (ADR-016).
