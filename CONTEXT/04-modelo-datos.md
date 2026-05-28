# 04 — Modelo de Datos

## Principios

- **Soft deletes** en todas las entidades de negocio
- **Timestamps** (`created_at`, `updated_at`) en todo
- **Multi-tenant** desde día 1 (todo dato pertenece a un establishment)
- **UUIDs** para todas las primary keys
- **Categorías y enums** centralizados en tablas de configuración para soportar múltiples especies/sistemas

## Jerarquía general

```
USUARIO
  └─ ESTABLECIMIENTOS
       └─ RODEOS (especie + sistema)
            └─ ANIMALES
```

Nivel `Rodeo` es donde se define la combinación **especie + sistema productivo**. Un mismo establecimiento puede tener varios rodeos de tipos distintos.

### Los tres ejes ortogonales de organización del animal

Un animal vive en tres dimensiones independientes (ADR-020). Lo que las distingue es **qué dispara un cambio en cada una**:

| Eje | Representa | Cambia cuando… | Cómo |
|---|---|---|---|
| **Rodeo** (`animal_profiles.rodeo_id`) | sistema productivo (define qué datos se cargan, vía `rodeo_data_config`) | cambia el sistema productivo del animal | manual / semi-auto, baja frecuencia |
| **Categoría** (`animal_profiles.category_id`) | estado biológico | cambia el estado biológico (tacto, parto) | **automático por evento** (trigger, ADR-008) |
| **Lote** (`animal_profiles.management_group_id`) | agrupación de manejo | el productor decide reagrupar | **siempre manual, nunca por evento** |

Los tres son ortogonales: una transición de categoría no toca rodeo ni lote; asignar lote no cambia categoría ni rodeo. **Regla de display**: agrupar por lote si el animal lo tiene, si no por categoría.

## Bloques principales

### 1. Usuarios y Roles

```
users
  id, name, email, phone, password_hash
  created_at, updated_at, deleted_at

user_roles  (tabla pivot)
  id, user_id, establishment_id, role
  active, created_at
  -- role: owner | field_operator | veterinarian
  -- un mismo usuario puede tener distintos roles en distintos campos
```

### 2. Establecimientos y configuración

```
species  (tabla de configuración)
  id, name, icon, active
  -- bovino (active=true), equino, porcino (active=false en MVP)

systems_by_species
  id, species_id, name, active
  -- (bovino, cría) active=true
  -- (bovino, invernada/feedlot/tambo/cabaña) active=false en MVP

categories_by_system
  id, system_id, name, parent_category_id, auto_transitions
  -- ej: (cría, vaquillona), (cría, vaquillona_preñada, parent=vaquillona)

-- Plantilla de datos configurable por rodeo (ADR-021). Tres tablas:
field_definitions  (catálogo GLOBAL de datos tracqueables — read-only desde cliente)
  id, data_key (unique global), label, description
  category  -- reproductivo | productivo | sanitario | manejo | comercial | identificacion
  data_type  -- maniobra | evento_individual | evento_grupal | propiedad
  ui_component, config_schema (jsonb), schema_version, active
  -- cada dato existe UNA vez (no atado a sistema); ej: prenez, peso, vacunacion, dientes
  -- seed MVP: 26 fields de cría (TENTATIVO hasta validar con Facundo)

system_default_fields  (qué fields son default/required POR SISTEMA — read-only desde cliente)
  id, system_id, field_definition_id
  default_enabled  -- viene tildado al crear un rodeo de ese sistema
  required_for_system, sort_order
  -- unique(system_id, field_definition_id)

establishments
  id, name, owner_id, province, city
  latitude, longitude (nullable)
  total_hectares (nullable)
  plan_type, plan_started_at, plan_limits  -- preparado para billing
  active, created_at, updated_at

rodeos
  id, establishment_id, name
  species_id, system_id  -- FK a species y systems_by_species
  active, created_at, updated_at
  -- NO hay rodeo default: el usuario crea el primero vía wizard (ADR-021/spec 02 R2.6)

rodeo_data_config  (estado efectivo POR RODEO — toggle del owner)
  rodeo_id, field_definition_id, enabled, custom_config (jsonb)
  -- PK (rodeo_id, field_definition_id); ON DELETE CASCADE desde rodeos
  -- un trigger AFTER INSERT en rodeos lo pre-popula con los system_default_fields del sistema
  -- el owner puede habilitar cualquier field del catálogo global, incluso uno no-default
  --   de su sistema (ej. rodeo de tambo que también tactea preñez)
  -- sustrato del gating de maniobras de spec 03

management_groups  (lote — agrupación de manejo, ADR-020. UI lo muestra como "Lote")
  id, establishment_id, name (texto libre, sin presets)
  active, created_at, updated_at, deleted_at
  -- scope establishment (NO rodeo): habilita lotes "cruzando rodeos"
  -- crear/editar/borrar: solo owner. asignar animal: cualquier rol operativo
```

### 3. Animal (entidad central)

```
animals  (entidad global)
  id  -- UUID, persistente entre transferencias entre campos
  tag_electronic  (nullable, ISO 11784/11785)
  species_id
  sex
  birth_date (nullable)
  created_at, updated_at

animal_profiles  (datos por establecimiento)
  id, animal_id, establishment_id, rodeo_id
  management_group_id  -- FK nullable a management_groups (lote, ADR-020). NULL = sin lote
  idv  -- caravana visual, única por campo
  visual_id_alt  -- identificación alternativa (tatuaje, hierro, descripción)
  category_id  -- FK a categories_by_system
  category_override  -- boolean, si true no se auto-calcula
  breed, coat_color
  birth_weight (nullable)
  teeth_state  -- enum, propiedad actualizable, sin historial
  is_cut  -- boolean, criando último ternero
  entry_date, entry_weight, entry_origin
  exit_date, exit_reason, exit_weight, exit_price
  status  -- active | sold | dead | transferred
  notes
  created_at, updated_at, deleted_at
```

**Regla crítica de identificación**: al menos uno de `tag_electronic`, `idv` o `visual_id_alt` tiene que existir. Ver `docs/adr/ADR-005-flexible-animal-identification.md`.

### 4. Sesiones (MODO MANIOBRAS)

```
sessions
  id, establishment_id, rodeo_id
  management_group_id  -- FK nullable a management_groups (reconciliado 2026-05-28: era lote_label texto;
                       --   ahora apunta al lote real de ADR-020. spec 03 implementa el detalle)
  session_type  -- maniobras | weighing_only | sanitary_only | etc
  selected_maneuvers  -- JSON con qué maniobras están activas
  maneuver_config  -- JSON con pre-config (vacuna, pajuelas)
  operator_id, veterinarian_id (nullable)
  date, start_time, end_time
  weather, feed_supplied (nullable)
  notes, total_animals
  created_at, updated_at

maneuver_presets
  id, user_id, name
  selected_maneuvers  -- JSON
  default_config  -- JSON
  created_at, updated_at
```

### 5. Eventos por animal

```
weight_events
  id, animal_profile_id, session_id (nullable)
  weight_kg, weight_date, time
  source  -- bluetooth | manual | import_xml
  notes, created_at

reproductive_events
  id, animal_profile_id, session_id (nullable)
  event_type  -- service | tacto | birth | abortion | weaning | drying | rejection
  event_date
  service_type  -- natural | ai | te (nullable)
  bull_id  -- FK a animal_profiles (nullable, padre del ternero)
  semen_id  -- FK a semen_registry (nullable)
  pregnancy_status  -- empty | small | medium | large (resultado tacto)
  estimated_days, estimated_birth
  calf_id  -- FK a animal_profiles (nullable, ternero nacido)
  calf_weight, calf_sex
  notes, created_by, created_at

sanitary_events  (registro individual)
  id, animal_profile_id, session_id (nullable), campaign_id (nullable)
  event_type  -- vaccination | deworming | treatment | test | other
  product_name
  active_ingredient, dose_ml, route
  event_date, next_dose_date
  result (nullable)  -- para tests (positivo/negativo/sospechoso)
  adverse_reaction (boolean)
  notes, created_by, created_at

sanitary_campaigns  (planificación poblacional)
  id, establishment_id, rodeo_id (nullable)
  management_group_id  -- FK nullable a management_groups (reconciliado 2026-05-28: era lote_label texto)
  name, campaign_type
  product_name, active_ingredient, dose_ml, route
  planned_date, executed_date, next_dose_date
  total_animals, batch_number
  veterinarian_id (nullable)
  status  -- planned | in_progress | completed | cancelled
  notes, created_by, created_at, updated_at

condition_score_events  (evento con historial)
  id, animal_profile_id, session_id (nullable)
  score  -- 1.00 a 5.00, incrementos 0.25
  event_date
  created_by, created_at
```

### 6. Laboratorio

```
lab_samples
  id, animal_profile_id, session_id (nullable)
  sample_type  -- blood (brucelosis) | scrape_tricho | scrape_campylo | other
  tube_number
  collection_date
  lab_destination
  result (nullable hasta que llega)
  result_interpretation (nullable)
  result_received_date (nullable)
  notes, created_by, created_at

lab_imports
  id, establishment_id, lab_provider
  file_name, file_format
  parser_used
  total_records, imported_ok, imported_errors
  error_details (JSON)
  imported_by, created_at
```

### 7. Semen y reproducción

```
semen_registry
  id, establishment_id
  pajuela_name  -- nombre/código de la pajuela
  bull_name, breed, supplier
  notes, created_at
  -- en MVP no se modela stock
```

### 8. Alertas

```
alerts
  id, establishment_id, animal_profile_id (nullable)
  alert_type  -- overdue_vaccination | overdue_weighing | upcoming_birth |
              -- animal_not_weighed | low_weight_gain | repeated_empty_cow |
              -- positive_lab_result_pending_action
  severity  -- low | medium | high
  title, description, due_date (nullable)
  resolved, resolved_at, resolved_by
  created_at
```

### 9. Lluvias

```
rain_gauges
  id, establishment_id, name
  active, created_at

rainfall_records
  id, rain_gauge_id
  mm, record_date
  recorded_by, notes, created_at
```

### 10. Sincronización offline

```
sync_queue
  id, device_id, table_name, record_id
  operation  -- insert | update | delete
  payload (JSON)
  synced (boolean), synced_at
  created_at
```

PowerSync maneja la mayor parte de esto automáticamente. La tabla `sync_queue` queda como fallback para casos de conflictos complejos.

## Transiciones automáticas de categoría

Implementadas como triggers en backend (Postgres) sobre `reproductive_events`. Ver `docs/adr/ADR-008-automatic-category-transitions.md`.

| De | A | Trigger |
|---|---|---|
| Vaquillona | Vaquillona preñada | Registro de tacto positivo |
| Vaquillona preñada | Vaca segundo servicio | Registro de parto |
| Vaca segundo servicio | Multípara | Registro de segundo parto |
| Cualquier vaca | CUT | Manual con prompt automático al cargar dientes 1/2, 1/4 o sin dientes |

**Ortogonalidad (ADR-020)**: estos triggers escriben **únicamente** `animal_profiles.category_id`. Nunca tocan `rodeo_id` ni `management_group_id` (lote). Un animal que transiciona de categoría permanece en su mismo rodeo y su mismo lote.

## Ternero al pie

Se registra como entidad separada (`animals` + `animal_profile`) desde el momento del nacimiento. Tiene su propio TAG y caravana visual desde día 1 (la caravana debe colocarse al nacimiento o dentro de esa semana por ley SENASA).

## Lo que NO se modela (decisión explícita)

- **Potreros** como entidades físicas georreferenciadas con movimientos entre ellos. *(El "lote" SÍ se modela ahora —`management_groups`, ADR-020— pero como **agrupación de manejo** lógica, distinta de rodeo y de potrero físico. No hay tracking de qué potrero ocupa cada lote.)*
- Stock de pajuelas
- Stock de medicamentos
- Historial de transferencias de lote o de rodeo (`movements`) — en MVP solo se guarda el estado actual (`management_group_id` / `rodeo_id`); el historial de movimientos queda como decisión separada post-MVP
- Movimientos de animales entre establecimientos a nivel transaccional (se modela en `entry_*` y `exit_*` de `animal_profiles`)
- Módulo financiero/contabilidad
