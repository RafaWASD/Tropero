# ADR-020 — Lote como agrupación de manejo (activación de la cláusula reservada en ADR-016)

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf
**Complementa**: ADR-016 (terminología rodeo/sistema). **No lo supersede** — la decisión central de ADR-016 sigue vigente.
**Related**: ADR-008 (transiciones automáticas de categoría), ADR-017 (timeline de eventos)

## Contexto

ADR-016 cerró la terminología del proyecto: **rodeo** es el grupo de animales gestionado como unidad productiva, **sistema** es su tipo productivo (cría, recría, etc.). En ese mismo ADR se mató el uso de "lote" como sinónimo de rodeo, pero se **reservó explícitamente** la palabra para un caso futuro:

> Reservado para una posible necesidad futura de "agrupación temporal dentro de un rodeo o cruzando rodeos" (ej. armar un lote para mandar al remate, asignar un grupo a un potrero específico, separar terneros para vacunación). Esa necesidad no está confirmada para MVP. Si surge post-MVP, evaluar entonces.

Esa necesidad surgió y se confirmó como real para MVP: **muchísimos campos separan sus vientres por temporada de servicio** (multíparas otoño vs multíparas primavera), y más en general el productor reagrupa animales por criterios de manejo que no son ni el sistema productivo (rodeo) ni el estado biológico (categoría).

Este ADR activa la cláusula reservada de ADR-016 e introduce "lote" como tercer eje de organización. No contradice ADR-016: lo que ADR-016 prohibió fue lote-como-sinónimo-de-rodeo; lo que este ADR introduce es lote-como-agrupación-de-manejo, que es exactamente el uso reservado.

## La regla maestra: tres ejes ortogonales con disparadores distintos

Un animal vive en tres dimensiones independientes. Lo que las distingue no es solo qué representan, sino **qué dispara un cambio en cada una**:

| Eje | Representa | Cambia cuando... | Cómo |
|---|---|---|---|
| **Rodeo** | sistema productivo (define qué datos se cargan) | cambia el SISTEMA productivo del animal | semi-automático o manual, baja frecuencia |
| **Categoría** | estado biológico | cambia el ESTADO biológico (tacto, parto) | automático, por evento (ADR-008) |
| **Lote** | agrupación de manejo | el productor DECIDE reagrupar | **siempre manual, nunca por evento biológico** |

La fila crítica es la del lote: **el lote nunca se dispara solo por un evento biológico ni por una transición de categoría. Es siempre una decisión humana explícita del productor.**

## Decisión

### 1. Lote es una entidad libre, creada por el productor

Se modela una tabla `lotes` (nombre tentativo, validar en spec) con identidad propia, scope a nivel establishment:

```
lotes
  id
  establishment_id   -- FK; el lote pertenece al establecimiento, NO a un rodeo
  name               -- texto libre, definido por el productor
  active             -- boolean
  created_at, updated_at, deleted_at
```

- El productor crea los lotes que quiera con los nombres que quiera. **La app no presetea ningún lote.** No existe "otoño/primavera" hardcodeado: el productor puede nombrarlos "Otoño 2026", "A", "B", "Lote Rojo", "Entore 1", lo que sea.
- El lote es **a nivel establishment**, no de rodeo. Esto habilita el caso reservado de ADR-016 "cruzando rodeos" (ej. un lote de venta que junta animales de cría e invernada).

### 2. Asignación al lote: exclusiva, nullable, manual

```
animal_profiles
  + lote_id   FK nullable a lotes
```

- **Exclusiva**: un animal está en a lo sumo un lote a la vez. Mover de lote es reasignar el FK (no hay historial de lotes en MVP).
- **Nullable**: `lote_id = NULL` significa "sin grupo de manejo custom".
- **Manual**: la asignación la hace el productor explícitamente. Ningún trigger ni evento biológico asigna lote automáticamente.

### 3. Agrupamiento para display: lote si tiene, si no categoría

La regla de presentación que unifica las tres dimensiones para el usuario:

> **Agrupar por lote si el animal tiene `lote_id`; si es NULL, agrupar por su categoría.**

Consecuencia directa: la categoría provee agrupamiento automático gratis. El lote es un **override opcional** sobre ese default, solo donde el productor necesita un grupo que la categoría no expresa.

Esto resuelve la tensión de UX central:

- Una vaquillona con `lote_id = NULL` aparece en el grupo "Vaquillonas" (su categoría), sin que el productor toque nada.
- El productor **nunca tiene que asignarle un lote a una vaquillona** para verla agrupada como vaquillona — eso es automático.
- El lote entra recién cuando el productor mueve al animal a un grupo de manejo custom (otoño/primavera), lo cual conceptualmente pasa cuando ya es vientre, no vaquillona.

Una multípara con `lote_id = NULL` cae en el grupo "Multíparas" (categoría); una con `lote_id = Otoño` cae en "Otoño". Ambas conviven sin conflicto.

### 4. Ortogonalidad: las transiciones de categoría no tocan el lote

Como categoría y lote son ejes independientes, un cambio de categoría no modifica el lote:

```
ANTES:    categoría = vaca segundo servicio   ×   lote = Otoño 2026
                          │ (segundo parto)
                          ▼
DESPUÉS:  categoría = multípara                ×   lote = Otoño 2026
```

El animal se mueve en el eje categoría y permanece en su lote. El sistema **nunca tiene que decidir** a qué lote mandar a un animal tras un parto, porque el parto no toca el lote. Esto elimina la pregunta ambigua "tras el segundo parto, ¿a qué lote entra, otoño o primavera?": la respuesta es "al que ya estaba; el parto no la mueve de lote".

### 5. El lote temporada se define en el servicio, no en la parición

La pertenencia a un lote de temporada (otoño/primavera) la determina el productor alrededor del **evento de servicio** (cuando mete al animal al entore), no en la parición. La parición solo avanza la categoría.

### 6. NO se automatiza la asignación de lote

Decisión explícita: **el sistema no auto-asigna lotes.** La razón es definitiva: la semántica del lote es definida por el productor y es desconocible para el sistema. "Otoño" es un nombre arbitrario; el sistema no puede saber que significa "servido en otoño". Auto-asignar produciría asignaciones incorrectas para todo productor que no use esa convención exacta de nombres.

Lo máximo permitido en MVP es una **sugerencia genérica** tras un evento de servicio ("esta vaca fue servida el DD/MM, ¿querés asignarla a algún lote?") que ofrece los lotes existentes para que el productor elija. El sistema no asume el mapeo fecha→lote.

### 7. Diferencia entre transferencia de rodeo y de lote

| | Transferencia de RODEO | Transferencia de LOTE |
|---|---|---|
| Qué cambia | sistema productivo → `rodeo_data_config` (qué datos se cargan) y categorías válidas | solo la agrupación de manejo |
| Categorías válidas | pueden cambiar (otro `system_id`) | idénticas |
| Validación al mover | revalidar que la categoría existe en el sistema destino; avisar si los `data_keys` difieren | ninguna, solo reasignar el FK |
| Peso del evento | hito de vida (ej. destete del ternero: cría → recría) | reorganización operativa |
| Frecuencia | baja | alta |
| Trazabilidad SENASA | relevante | poco relevante |
| Historial en MVP | candidato a tabla `movements` (decisión aparte, ver Notas) | sin historial — solo estado actual |

Aclaración sobre el destete como ejemplo de transferencia de rodeo: el destete cambia el rodeo **del ternero, no de la madre**, y solo si el campo tiene un rodeo de recría. La madre permanece en cría. Si el campo es cría pura, el ternero se vende (sale del sistema) sin cambio de rodeo.

## Reglas de auto-sugerencia configurables (post-MVP)

Se reconoce como evolución futura deseable: permitir que el productor defina, sobre un lote, una regla opcional de auto-sugerencia (ej. "sugerir para este lote los animales servidos entre marzo y mayo"). Esto sería automatización **configurada por el productor**, no preseteada por la app. Queda fuera de MVP.

## Alternativas consideradas

### Lote como campo de texto libre en `animal_profiles`
- **Pros**: cero tablas nuevas.
- **Contras**: no modela "cruzando rodeos" (un lote que existe por encima del rodeo necesita identidad propia); genera lotes fantasma por typos ("Otoño 2026" vs "otoño 26"); no puede llevar metadata futura (reglas de sugerencia). Rechazado.

### Lote como relación muchos-a-muchos (animal en varios lotes)
- **Pros**: máxima flexibilidad.
- **Contras**: el productor confirmó que un animal está en un solo grupo físico a la vez (es excluyente). M2M agrega complejidad sin caso de uso confirmado. Rechazado para MVP; si surge necesidad de solapamiento, es un ADR futuro.

### Presetear otoño/primavera en la app
- **Pros**: arranque más guiado.
- **Contras**: la temporada de servicio es vocabulario y criterio del productor, no de la app. Presetear fuerza una convención que muchos campos no usan. Rechazado: la app provee el mecanismo, el productor el significado.

### Auto-asignar lote por fecha de servicio
- **Pros**: menos trabajo manual.
- **Contras**: la semántica del lote es desconocible para el sistema (los nombres son arbitrarios). Auto-asignar produce errores sistemáticos. Rechazado (ver Decisión punto 6).

### Modelar la temporada como atributo del ciclo reproductivo en vez de lote
- **Pros**: semánticamente más "correcto".
- **Contras**: más complejo, asume que el sistema entiende temporadas de servicio. El calendario reproductivo real ya vive en los `reproductive_events` con sus fechas; el lote solo necesita ser el asa organizativa. Rechazado para MVP por sobre-ingeniería.

## Consecuencias

### Positivas

- Tercer eje de organización resuelto sin contradecir ADR-016 (activa su cláusula reservada).
- Personalización total: el productor arma sus grupos con sus nombres.
- La categoría sigue dando agrupamiento automático gratis; el lote suma solo donde hace falta.
- Las transiciones de categoría no requieren lógica de reasignación de lote (ortogonalidad).
- Modelo de datos mínimo: una tabla nueva (`lotes`) + una columna nullable (`lote_id`).
- Cambio no destructivo: spec 02 está solo aprobada (sin implementar), así que lote entra como parte orgánica del modelo, no como parche.

### Negativas

- El productor que asigna lote a algunos animales de una categoría y a otros no, verá los sin-lote agrupados por categoría y los con-lote en su lote. Puede generar confusión "¿dónde está tal animal?".
  - **Mitigación (UX, no de modelo)**: la app puede mostrar "tenés N [categoría] sin lote asignado" para que no se escapen.
- La regla de display "lote si tiene, si no categoría" agrega lógica de presentación que hay que implementar consistentemente en todas las vistas de agrupamiento.

### Notas de implementación

- `lotes`: tabla nueva, scope establishment, RLS por `has_role_in(establishment_id)`. Crear/editar/borrar lotes: solo `owner` (consistente con gestión de rodeos). Asignar animales a lote: cualquier rol operativo activo.
- `animal_profiles.lote_id`: columna nueva, FK nullable a `lotes`, sin default. Validar que el lote pertenezca al mismo establishment del perfil.
- Transferencia de lote: `UPDATE animal_profiles SET lote_id = X`. Sin historial en MVP.
- Sincronización offline: `lotes` y `lote_id` deben estar en los buckets de PowerSync (la asignación de lote tiene que funcionar en el campo).
- La tabla `movements` para historial de transferencias de rodeo queda como **decisión separada** (no es parte de este ADR). Evaluar si entra a MVP cuando se aborde la spec de movimientos/transferencias.
- Validar el nombre definitivo de la tabla (`lotes` vs otra opción) y de la columna en la refundición de spec 02.

**Reversibilidad**: media-alta. Como es columna nullable + tabla nueva, sumarlo o quitarlo no rompe el resto del modelo. Si en el futuro se necesita M2M, se migra `lote_id` a tabla intermedia.
