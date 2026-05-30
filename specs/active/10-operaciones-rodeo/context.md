# Spec 10 — Operaciones masivas por rodeo + vista de grupo — Refinamiento de contexto (Gate 0)

**Status**: Decisiones aprobadas por Raf (sesión 18, vía AskUserQuestion). Pendiente lectura/aprobación final del `context.md` escrito.
**Fecha**: 2026-05-29 (sesión 18)
**Conducido por**: leader + Raf.
**Origen**: surgió del audit profundo de 03 MODO MANIOBRAS (Raf: "quiero que cuando ves un rodeo y su configuración haya opciones manuales de generar eventos en todo el rodeo — destetar todo, castrar todo").
**Related**: spec 02 (rodeos, `rodeo_data_config`, tablas de evento, `management_groups`, transiciones, `sanitary_campaigns`), spec 03 (maniobras — comparten tablas de evento + gating), spec 09 (ficha/EDIT — eventos individuales), ADR-018 (navegación), ADR-020 (lote), ADR-021 (plantilla/gating).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.

## Contexto validado

Una **vista de grupo** (rodeo o lote) que muestra el grupo + su configuración + sus animales, con **acciones manuales que generan un evento sobre todo el grupo de una** (o un subconjunto filtrado): *vacunar todo, destetar todo, castrar todo*. Es **distinto de MODO MANIOBRAS** (spec 03 = animal-por-animal escaneando con el bastón); esto es "aplicá este evento a todo el rodeo/lote sin escanear cada uno". Reusa las tablas de evento de spec 02 + el gating (`rodeo_data_config`) + cada evento queda individualmente corregible (R6.8.1 de spec 02). Caso que lo motivó: "los destetes se hacen de todo el rodeo junto".

## Alcance

**Dentro (MVP)**: vista de rodeo (y de lote) con su config + animales; **3 operaciones masivas**: vacunación masiva, destete masivo, castración masiva; selección "todo el grupo + filtro opcional + preview + skip-and-report"; offline; gating reusado.

**Fuera (post-MVP / otras features)**:
- Sangrado / raspado masivos → **NO** (la toma de muestra es individual: cada animal tiene su propio nº de tubo). Se cargan animal-por-animal (manga / ficha).
- Devolución del laboratorio (leer Excel/PDF, anotar resultados) → **feature 06** (import labs); el modelo ya tiene dónde (`lab_samples.result`).
- Castración como **maniobra de manga** → "quizás a futuro" (hoy castración = evento individual + esta operación masiva).
- Otros eventos masivos (condición corporal, pesaje masivo, etc.) → no en MVP salvo que aparezca el caso real.

**Depende de**: spec 02 (rodeos, tablas de evento, gating, `management_groups`, `sanitary_campaigns`, transiciones), ADR-018 (navegación). Comparte sustrato con spec 03 (mismas tablas + gating).

## Casos y decisiones

### Navegación (decisión Raf: Opción 1 — Inicio rodeo-céntrico)
- **Inicio se vuelve rodeo-céntrico**: greeting + **cards de rodeo** del establecimiento activo (nombre, sistema, cabezas, métrica clave —%preñez/última maniobra—, señal de atención) + accesos rápidos. ADR-018 ya define Inicio como "resumen de rodeos del establecimiento activo" → **NO reabre ADR-018** (es realizar ese rol, no cambiar la estructura de tabs).
- **Tap en una card → vista de rodeo**: su config (`rodeo_data_config`) + sus animales + **acciones masivas**.
- **Lotes** (`management_groups`, cross-rodeo) también son grupos: aparecen en Inicio como **grupos secundarios** y tienen su propia **vista de lote** con las mismas acciones masivas (la operación masiva aplica a **rodeo o lote**). La vista generaliza a "**vista de grupo**".
- **Animales (tab) queda intacta**: lupa + lista + filtros (R1.5 de spec 09) + asignación masiva de caravanas (R8). Es la puerta de búsqueda; **no** lleva gestión de rodeo. Separación: Inicio = "gestiono mis grupos" (deliberado); Animales = "encuentro UN animal" (transaccional).

### Las 3 operaciones masivas MVP
- **Vacunación masiva**: vacunar todo el grupo (o subconjunto). Ya tiene sustrato (`sanitary_campaigns` + `sanitary_events` de spec 02). Genera N `sanitary_events`. La más clara/pedida. Requiere `vacunacion` enabled en el rodeo (gating).
- **Destete masivo**: destetar todos los terneros/as del grupo → dispara la transición de categoría de R7.8 de spec 02 (ternero→torito / ternera→vaquillona) por cada uno. Genera N eventos de destete (`weaning`). Caso motivador.
- **Castración masiva**: castrar todos los machos (o selección). Genera N eventos de castración. ⚠️ **Efecto de categoría pendiente de Facundo** (cría no tiene "novillo"; ver CONTEXT/07). Requiere data_key `castracion` (delta de catálogo, spec 02 R2.13/ADR-021).

### Selección de alcance + seguridad (decisión Raf: todo + filtro + preview + skip-and-report)
- **Default = todo el grupo**, con **filtro opcional** por categoría/sexo (ej. castrar solo machos; destetar solo terneros/as).
- **Preview obligatorio antes de aplicar**: "vas a crear N eventos sobre N animales" + confirmación explícita (es acción de alta consecuencia).
- **Skip-and-report**: los animales que **no aplican** (ternero ya destetado, macho ya castrado, animal archivado/baja) se **saltan** y se **reportan** ("M saltados: …"). No se duplica el evento.
- **Cada evento queda individualmente corregible** (R6.8.1 de spec 02: editar/borrar por owner/autor sin ventana; borrar uno recalcula su categoría si aplica).
- **(scan s18) Un evento por animal**: la operación masiva genera **N eventos individuales** (uno por animal), NO un evento colectivo. Mellizos: cada ternero recibe su propio evento de destete (se desteta el ternero, no el parto). El preview lo refleja ("N eventos, uno por animal").
- **(scan s18) Filtro de candidatos = `status = 'active'`**: la operación opera solo sobre animales activos del grupo; los archivados/baja (`status ≠ active`) o soft-deleted se excluyen de entrada (consistente con el filtro de spec 09 R1.5 y la lista de "rodeo activo" de spec 02 R4.12).
- **(scan s18) Animales con `category_override = true`**: una operación que debería transicionar (ej. destete) **no** cambia la categoría de un animal con override (el override manda, R4.9 de spec 02). El **preview avisa** ("N animales tienen categoría manual y no van a transicionar") y **ofrece revertir el override** para incluirlos. Evita el "creé el evento pero la categoría no cambió" silencioso. (decisión Raf)

### Gating
- Las operaciones masivas respetan el **mismo gating** que las maniobras (ADR-021): una operación masiva solo se ofrece si su data_key está `enabled` en el `rodeo_data_config` del rodeo; la capa DB (trigger de spec 03) igual valida por animal. Para lotes cross-rodeo: el gating se evalúa por el rodeo de **cada** animal (un lote puede tener animales de rodeos con configs distintas) — definir en design cómo se resuelve (criterio: ofrecer la op si algún rodeo del lote la tiene; saltar los animales cuyos rodeos no).

### Offline-first
- Una operación masiva genera **N mutaciones** que se encolan en PowerSync y sincronizan después (igual que la carga individual). El preview + la creación funcionan offline. Ojo con el volumen (un rodeo grande = muchas filas) — nota de performance para design.
- **(scan s18) Mutaciones independientes, no transacción atómica**: cada uno de los N eventos es una mutación independiente. Si la sync falla a mitad, las que entraron quedan guardadas y las que fallan se reportan **por animal** vía el path de error de sync (spec 09 R11.5), con un **contador "X de N sincronizados"**. No se hace todo-o-nada (sería peor offline) ni se generan duplicados (cada evento es idempotente por animal+tipo+fecha si el design lo asegura). (decisión Raf)

### Roles
- Quién puede disparar operaciones masivas: a definir en el Gate 0 fino — criterio propuesto: **owner + operario** (consistente con que field_operator puede insertar eventos, R11.5 de spec 02). Vacunación/destete/castración son trabajo de campo. (Confirmable.)

## Pendientes (CONTEXT/07)
- **Efecto de categoría de la castración** (¿agregar `novillo` a cría, o solo evento sanitario?) → **Facundo** (ya en CONTEXT/07).
- **Destete: ¿marca algo en la madre?** → Facundo (ya en CONTEXT/07).
- Gating de operaciones masivas sobre un **lote cross-rodeo** (animales de rodeos con configs distintas): resolver en design.
- Performance de N mutaciones offline en rodeos grandes: nota para design.

## Insumos para spec_author
- spec 02: `rodeos`, `rodeo_data_config` (gating), tablas de evento (`sanitary_events`, `weight_events`, etc.), `management_groups` (lote), `sanitary_campaigns`, transiciones (R7, R7.8), corrección de eventos (R6.8.1).
- spec 03 `context.md`: maniobras comparten tablas + gating; las operaciones masivas son la contraparte "por grupo" de las maniobras "por animal".
- ADR-018 (Inicio = resumen de rodeos; esta feature lo realiza sin reabrir el ADR), ADR-020 (lote), ADR-021 (gating/plantilla).
- spec 09: la vista de grupo lista animales (reusa `AnimalCard`/list de spec 09); la ficha (EDIT) sigue siendo el lugar del evento individual.

## Aprobación
- **Decisiones aprobadas por Raf (sesión 18)**: nav=Inicio rodeo-céntrico, 3 ops masivas (vacunación/destete/castración), selección todo+filtro+preview+skip-report, scope rodeo o lote, sangrado/raspado masivo descartado, castración no-maniobra (efecto categoría→Facundo). Edge cases del scan cruzado (s18) foldeados: override→preview-avisa+revertir, offline mutaciones independientes, 1-evento-por-animal, filtro status=active. **APROBADO por Raf (sesión 18, 2026-05-29)** → 10 pasa a `context_ready`. La spec se redacta just-in-time (post-MVP-core; comparte sustrato con 03, conviene cerca de implementar 03).
