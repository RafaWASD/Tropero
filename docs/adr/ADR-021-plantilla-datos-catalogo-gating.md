# ADR-021 — Plantilla de datos por sistema: catálogo global + defaults por sistema + toggle por rodeo + gating de maniobras

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf (catálogo de cría validado con Facundo pendiente — seed TENTATIVO)
**Related**: ADR-016 (terminología rodeo/sistema), ADR-020 (lote), ADR-008 (transiciones de categoría)
**Nota de relación**: el trabajo previo de spec 02 R2.B (tablas `system_data_templates` + `rodeo_data_config`, en working tree sin commitear) modelaba el catálogo **por sistema**, lo cual tenía un bug conocido. Este ADR establece la forma canónica corregida. La refundición de spec 02 reemplaza R2.B por lo definido acá.

## Contexto

El producto soporta múltiples sistemas productivos (cría, recría, invernada, feedlot, tambo, cabaña), cada uno con datos distintos a trackear. Para que el catálogo de datos sea configurable sin tocar código, en spec 02 R2.B se modeló una plantilla por sistema.

El modelo de R2.B tenía un **bug estructural**: la tabla `system_data_templates(system_id, data_key)` define cada `data_key` **atado a un sistema**. Eso impide reusar un dato entre sistemas. El caso que lo rompe: un **rodeo de tambo que también quiere tactear preñez**. Si `prenez` está definido solo bajo el sistema cría, un rodeo de tambo no lo puede habilitar — el dato no "existe" para ese sistema. La realidad del campo es más flexible: muchos sistemas comparten datos (peso, condición corporal, preñez, vacunación) y un productor puede querer trackear en un rodeo un dato que no es default de su sistema.

Además, durante el discovery quedó pendiente:
- Cerrar el catálogo concreto de `data_keys` de cría (hecho ahora, ver Decisión).
- Definir el **gating de maniobras** (qué data_keys habilitan qué maniobra en spec 03), que se recomendó como doble capa (UI + DB) pero no estaba escrito.

## Decisión

### 1. Catálogo global + defaults por sistema + toggle por rodeo (tres tablas)

Se corrige el bug separando "qué datos existen" (global) de "qué datos son default en cada sistema" (por sistema) de "qué datos están activos en este rodeo" (por rodeo):

```
field_definitions          -- catálogo GLOBAL: cada data_key existe UNA vez
  id
  data_key          -- clave estable única global (ej. 'prenez', 'peso')
  label             -- texto humano para UI
  description       -- opcional
  category          -- reproductivo | productivo | sanitario | manejo | comercial | identificacion
  data_type         -- maniobra | evento_individual | evento_grupal | propiedad
  ui_component      -- numeric | numeric_stepped | enum_single | enum_multi | date | silent_apply | composite | text
  config_schema     -- JSONB, configuración específica
  schema_version    -- INT
  active
  created_at, updated_at

system_default_fields      -- qué fields son default/required POR SISTEMA
  id
  system_id              -- FK systems_by_species
  field_definition_id    -- FK field_definitions
  default_enabled        -- viene tildado al crear rodeo de ese sistema
  required_for_system    -- si true, no se puede destildar a nivel rodeo
  sort_order
  UNIQUE(system_id, field_definition_id)

rodeo_data_config          -- estado efectivo POR RODEO
  rodeo_id               -- FK rodeos ON DELETE CASCADE
  field_definition_id    -- FK field_definitions
  enabled                -- estado actual (toggle del owner)
  custom_config          -- JSONB, overrides opcionales al config_schema
  PK(rodeo_id, field_definition_id)
  created_at, updated_at
```

**Diferencia clave con el modelo buggeado**: un `data_key` se define una sola vez en `field_definitions` (global). `system_default_fields` solo marca cuáles son default de cada sistema. Un rodeo de tambo puede habilitar `prenez` (que existe globalmente) aunque no sea default de tambo — su `rodeo_data_config` tiene la fila con `enabled = true`. El bug desaparece.

**Auto-poblado**: al crear un rodeo, un trigger AFTER INSERT popula `rodeo_data_config` con una fila por cada `field_definition` que tenga registro en `system_default_fields` para el sistema del rodeo, copiando `default_enabled` como `enabled` inicial. Un rodeo nunca queda con config vacía.

**Habilitar un field no-default**: el owner puede agregar a su rodeo un `field_definition` que no estaba en los defaults de su sistema (INSERT en `rodeo_data_config` con `enabled = true`). Esto cubre el caso "tambo que tactea preñez".

**Catálogo es read-only para clientes**: `field_definitions` y `system_default_fields` son tablas de catálogo (mismo patrón que `species`, `categories_by_system`): se modifican vía migration, SELECT abierto a `authenticated`, sin INSERT/UPDATE/DELETE de cliente. Solo `rodeo_data_config` es mutable por el owner.

### 2. Seed inicial del sistema cría (TENTATIVO hasta validar con Facundo)

26 `field_definitions` seedeados con su default para `(bovino, cría)`. El campo `default_enabled` sigue la filosofía "casi todo ON, que el productor destilde".

**Reproductivo**

| data_key | label | default | gatea maniobra (spec 03) |
|---|---|---|---|
| `servicio` | Servicio / entore | ON | — (evento) |
| `prenez` | Preñez | ON | Tacto (vaca) |
| `tamano_prenez` | Tamaño de preñez | ON | Tacto (vaca) |
| `tacto_vaquillona` | Aptitud vaquillona | ON | Tacto vaquillona |
| `parto` | Parto | ON | — (evento fuera de manga) |
| `aborto` | Aborto | ON | — (evento) |
| `destete` | Destete | ON | — (usa pesaje en contexto) |
| `raspado_toros` | Raspado de toros | ON | Raspado de toros |
| `inseminacion` | Inseminación artificial | OFF | Inseminación |

**Productivo**

| data_key | label | default | gatea maniobra |
|---|---|---|---|
| `peso` | Pesaje | ON | Pesaje / Pesaje de ternero |
| `peso_destete` | Peso al destete | ON | (pesaje en contexto destete) |
| `condicion_corporal` | Condición corporal | ON | Condición corporal |
| `peso_nacimiento` | Peso al nacer | OFF | (parte de parto) |

**Sanitario**

| data_key | label | default | gatea maniobra |
|---|---|---|---|
| `vacunacion` | Vacunación | ON | Vacunación |
| `brucelosis` | Brucelosis (sangrado) | ON | Sangrado |
| `antiparasitario_interno` | Antiparasitario interno | ON | (maniobra silenciosa) |
| `antiparasitario_externo` | Antiparasitario externo | ON | (maniobra silenciosa) |
| `antibiotico` | Antibiótico | ON | (maniobra silenciosa) |
| `suplementacion` | Suplementación min/vit | ON | (maniobra silenciosa) |
| `tratamiento_curativo` | Tratamiento curativo | ON | (evento) |
| `enfermedad` | Episodio de enfermedad | ON | (evento) |
| `tuberculosis` | Tuberculosis | OFF | (evento/test) |

**Manejo**

| data_key | label | default | gatea maniobra |
|---|---|---|---|
| `dientes` | Estado de dientes | ON | Dientes (dispara prompt CUT) |
| `observacion` | Observación libre | ON | — (siempre disponible; tipo `observacion` de `animal_events`) |

**Comercial**

| data_key | label | default | gatea maniobra |
|---|---|---|---|
| `compra` | Compra / ingreso | ON | — (evento de alta) |
| `venta` | Venta / egreso | ON | — (evento de baja) |

**Diferido post-MVP (no se seedea)**: `evaluacion_toro` (circunferencia escrotal, capacidad de servicio) — más típico de cabaña, validado como post-MVP.

**Razón de los tres OFF**:
- `inseminacion`: la plantilla de cría defaultea a servicio natural (lo típico). Campos que hacen IATF lo tildan. Tener raspado + inseminación ambos ON sería ruido (son estrategias reproductivas alternativas).
- `peso_nacimiento`: minoría de la cría comercial pesa al nacer; cabaña sí.
- `tuberculosis`: minoría en cría (obligatorio en tambo, en cría solo para ciertas certificaciones).

Otros sistemas (recría, invernada, feedlot, tambo, cabaña) reciben su seed de `system_default_fields` cuando se activen post-MVP. Los `field_definitions` universales (peso, condición corporal, vacunación, etc.) ya quedan disponibles globalmente para reusarse.

### 3. Gating de maniobras: doble capa (UI + DB), mapeo hardcodeado

El gating define qué maniobras de spec 03 están disponibles según los `data_keys` activos del rodeo.

**El mapeo maniobra → data_keys requeridos es hardcodeado** (no configurable por el usuario), porque es lógica de dominio estable:

| Maniobra (spec 03) | Requiere enabled en el rodeo |
|---|---|
| Tacto (vaca) | `prenez` Y `tamano_prenez` |
| Tacto vaquillona | `tacto_vaquillona` |
| Sangrado | `brucelosis` |
| Vacunación | `vacunacion` |
| Inseminación | `inseminacion` |
| Condición corporal | `condicion_corporal` |
| Dientes | `dientes` |
| Pesaje | `peso` |
| Pesaje de ternero | `peso` |
| Raspado de toros | `raspado_toros` |

**Doble capa de enforcement**:

- **Capa UI**: el wizard de MODO MANIOBRAS solo **ofrece** las maniobras cuyos data_keys requeridos están todos `enabled` en el `rodeo_data_config` del rodeo de la sesión. Una maniobra con gating no satisfecho no aparece como opción.
- **Capa DB**: un check a nivel base de datos **rechaza** la persistencia de un evento gateado si el rodeo del animal no tiene los data_keys requeridos habilitados. Defensa en profundidad: aunque un cliente buggeado o desincronizado intente insertar un tacto sobre un rodeo sin `prenez` habilitado, la DB lo rechaza.

**El detalle de implementación del enforcement DB pertenece a spec 03** (consistente con spec 02 R2.7, que ya difería el enforcement a spec 03). Este ADR fija el principio (doble capa, mapeo hardcodeado) y el mapeo concreto; spec 03 implementa el check.

### 4. Relación con ADR-020 (lote)

ADR-020 referencia `rodeo_data_config` y `data_keys` en su punto 7 y notas ("sistema productivo → `rodeo_data_config` (qué datos se cargan)", "avisar si los `data_keys` difieren"). La **forma canónica** de ese modelo de plantilla de datos es la definida en este ADR-021 (catálogo global + defaults por sistema + toggle por rodeo). ADR-020 no se edita (es inmutable, aceptado); esta nota cruzada deja claro que el modelo por-sistema buggeado de R2.B **no** era la intención, y que la referencia de ADR-020 apunta al modelo de ADR-021.

## Alternativas consideradas

### Catálogo por sistema (`system_data_templates(system_id, data_key)`) — el modelo buggeado de R2.B
- **Pros**: parecía más simple, un data_key "pertenece" a un sistema.
- **Contras**: impide reusar datos entre sistemas (rompe "tambo que tactea preñez"). Bug estructural. Rechazado y reemplazado por este ADR.

### Catálogo global sin defaults por sistema (todo se togglea desde cero)
- **Pros**: máxima simplicidad de schema.
- **Contras**: UX horrible — crear un rodeo te enfrenta a 26+ campos sin orientación. Sin opinión del sistema. Rechazado.

### Hardcodear el catálogo en código TS por sistema
- **Pros**: type-safe.
- **Contras**: sumar sistema/dato requiere release; no permite personalización por rodeo. Rechazado (mismo razonamiento que el ADR original de templates).

### Gating configurable por el usuario (mapeo maniobra→data_keys editable)
- **Pros**: flexibilidad teórica.
- **Contras**: el mapeo es lógica de dominio estable (tacto siempre necesita preñez). Hacerlo configurable agrega complejidad sin caso de uso. Rechazado — hardcodeado.

### Gating solo en UI (sin capa DB)
- **Pros**: más simple.
- **Contras**: un cliente desincronizado offline o buggeado podría insertar eventos inconsistentes con la config del rodeo. La capa DB es la red de seguridad. Rechazado — doble capa.

## Consecuencias

### Positivas
- Bug resuelto: datos reusables entre sistemas; un rodeo puede habilitar cualquier dato del catálogo global.
- Sumar sistema o dato nuevo = filas en `field_definitions` / `system_default_fields`, cero código.
- Type-safety a nivel DB para analytics (pilar del producto): lo que se cuenta/filtra/grafica está tipado.
- Gating doble capa garantiza consistencia entre config de rodeo y eventos cargados.
- El catálogo de cría queda cerrado y trazable (seed versionado en Git).

### Negativas
- Tres tablas + trigger de auto-poblado + check de gating: más complejidad que un enum hardcodeado.
- El seed de cría es TENTATIVO hasta validación con Facundo; puede requerir ajuste por migration.
- La capa DB de gating (spec 03) agrega checks que hay que testear.

### Mitigaciones
- Seed en `supabase/seeds/field_definitions.json` y `system_default_fields.json`, versionado en Git.
- Cache de `rodeo_data_config` en cliente (no query por animal).
- Validador al togglear: si destildás un data_key que gatea una maniobra con eventos ya cargados, avisar (no romper datos históricos).

## Notas de implementación

- Granularidad: campos amplios + sub-catálogos. `vacunacion` es un solo `field_definition` + tabla `vaccine_catalog` aparte (el catálogo de productos vacunales cambia con el mercado; modelarlo como dato, no como schema).
- `required_for_system`: en cría, ninguno es estrictamente required (un campo puede trackear lo mínimo). La identificación (TAG/IDV/visual_id_alt) es el único requisito real y se maneja en R3/R4 de spec 02, fuera de este catálogo.
- Sincronización: `field_definitions`, `system_default_fields`, `rodeo_data_config` en buckets de PowerSync. Catálogo se cachea en SQLite local al login (TTL ~24h).
- Migrations: la refundición de spec 02 renumera/agrega las migrations para las tres tablas + trigger de auto-poblado, reemplazando la migration 0016 buggeada del working tree.

**Reversibilidad**: baja una vez que hay rodeos con config en producción. Por eso se cierra el modelo (no el seed, que es ajustable) antes de implementar.
