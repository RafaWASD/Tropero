# ADR-008 — Transiciones Automáticas de Categoría con Override Manual

**Status**: Accepted · **Enmendado 2026-06-03** (sesión con Facundo — modelo de categorías de cría completo: `novillito`/`novillo`, castración como eje, destete como disparador, cortes de edad 1 y 2 años, aborto que revierte + flag, cría al pie). Ver **§ Enmienda 2026-06-03**.
**Fecha**: 2026-05 · enmienda 2026-06-03
**Decisores**: Raf + Facundo (vet socio, dominio)

## Contexto

En cría bovina, los animales se mueven entre categorías productivas según eventos biológicos:

| Categoría | Definición |
|---|---|
| Ternero/Ternera | Animal al pie de la madre, sin destete |
| Vaquillona | Hembra destetada, pre-servicio |
| Vaquillona preñada | Vaquillona con tacto positivo |
| Vaca segundo servicio | Hembra que parió una vez |
| Multípara | Hembra que parió dos o más veces |
| CUT | Criando Último Ternero (vaca de descarte por edad/dientes) |
| Toro | Macho reproductor |

En sistemas tradicionales (papel, Excel), el productor mueve manualmente animales entre categorías. Esto genera errores: animales que parieron pero quedaron como "vaquillona preñada" para siempre, vacas viejas que nunca se marcan CUT, etc.

Si la app puede **inferir las transiciones automáticamente** desde los eventos cargados, el productor no se olvida y los reportes son siempre correctos.

Pero hay casos edge donde la inferencia automática puede equivocarse:
- Vaca comprada como multípara sin historial cargado en el sistema
- Aborto que el productor no carga
- Vaquillona que falla pero el campo decide darle segunda oportunidad
- Hembras de cabaña con tratamiento reproductivo experimental

## Decisión

**Transiciones automáticas activas por defecto, con flag `category_override` para forzar manual**.

### Transiciones automáticas

| Desde | Hacia | Trigger |
|---|---|---|
| Vaquillona | Vaquillona preñada | Registro de tacto con `pregnancy_status` distinto de `empty` |
| Vaquillona preñada | Vaca segundo servicio | Registro de evento `birth` (parto) |
| Vaca segundo servicio | Multípara | Registro de segundo evento `birth` |
| Cualquier vaca | CUT | Manual (con prompt automático al cargar dientes 1/2, 1/4 o sin dientes) |

### Override manual

Cada `animal_profile` tiene un boolean `category_override`:
- `false` (default): la categoría se recalcula automáticamente al cargar eventos
- `true`: la categoría queda fija, no se modifica por eventos

El override se activa cuando el usuario cambia manualmente la categoría desde la ficha del animal.

### Categorías especiales: CUT y Dientes

CUT (Criando Último Ternero) es siempre manual, pero la app **sugiere automáticamente** marcar CUT cuando se carga estado de dientes 1/2, 1/4 o sin dientes (lo que indica vaca de descarte por edad).

UX del prompt:
```
Cargaste dientes: 1/2
Este estado indica vaca vieja.
¿Marcar como CUT (Criando Último Ternero)?

[ Sí, marcar CUT ]  [ No, solo dientes ]
```

## Enmienda 2026-06-03 (sesión con Facundo) — modelo de categorías de cría completo

> Esta enmienda **extiende y precisa** la Decisión original con el modelo de dominio validado con Facundo
> (vet socio). El detalle fino (datos por categoría, fórmulas de analytics, mecánica de castración, escala
> de dientes) vive en `specs/active/02-modelo-animal/dominio-categorias-facundo-2026-06-03.md`. Acá queda
> la **máquina de estados** y las **reglas de transición**, que son el corazón de este ADR. La tabla de
> transiciones original (4 filas) queda **subsumida** por la de abajo.

### Categorías de cría — set completo

- **Machos**: `ternero` · `torito` · `toro` · **`novillito`** (NUEVO) · **`novillo`** (NUEVO).
- **Hembras**: `ternera` · `vaquillona` · `vaquillona preñada` · `vaca 2º servicio` · `multípara`.
- `CUT` (Criando Último Ternero) sigue siendo una **marca de descarte ortogonal** (manual, con prompt al
  cargar dientes gastados), no un estado de la máquina.

`novillito`/`novillo` **no existían** en el modelo original → se agregan al seed `categories_by_system`.

### Eje nuevo: castración (`is_castrated`)

La castración es el eje que separa `torito ↔ novillito` y `toro ↔ novillo`. Es un **atributo del animal**
(`is_castrated`), no un evento de categoría por sí mismo:
- Se hace **antes del destete** en general → al destetar es **automático**: enteros → `torito`, castrados → `novillito`.
- Si el animal ya pasó el destete (`torito`/`toro`), castrarlo lo pasa a `novillito`/`novillo` **en el momento**.
- **Carga**: operación **masiva** "castrar rodeo/lote con **exclusiones**" (los que quedan enteros como
  futuros toritos/toros) → encaja en **spec 10** (operaciones masivas). Corrección individual = toggle en la ficha.

### Máquina de estados — MACHOS

| Desde | Hacia | Disparador |
|---|---|---|
| `ternero` | `torito` (entero) / `novillito` (castrado) | **destete** (primario); o **al cumplir 1 año** si no hay destete cargado (fallback por edad). La castración decide cuál. |
| `torito` | `toro` | **a los 2 años** (edad) |
| `novillito` | `novillo` | **a los 2 años** (edad) |

### Máquina de estados — HEMBRAS

| Desde | Hacia | Disparador |
|---|---|---|
| `ternera` | `vaquillona` | **destete**, **o** registro de **servicio**, **o** al **cumplir 1 año** (lo que ocurra primero) |
| `vaquillona` | `vaquillona preñada` | **tacto** con `pregnancy_status ≠ empty` *(igual que original)* |
| `vaquillona` / `vaquillona preñada` | `vaca 2º servicio` | **1er parto** *(la vaquillona pasa a vaca SOLO al parir — sin tope de edad)* |
| `vaca 2º servicio` | `multípara` | **2º parto** *(igual que original)* |

### Disparadores nuevos respecto al ADR original

- **Destete** (`reproductive_events` tipo `weaning`) → ahora es un disparador de transición (machos:
  `ternero→torito/novillito`; hembras: `ternera→vaquillona`). El ADR original no lo modelaba.
- **Servicio** → `ternera → vaquillona` (si la serviciás, ya es vaquillona, sin importar la edad).
- **Edad** → fallback `ternero/ternera → siguiente` al año; `torito/novillito → toro/novillo` a los 2 años.
- **Parto desde CUALQUIER categoría** (corrección 2026-06-04, Raf testeando): la madre va a `vaca 2º servicio`
  (1er parto) / `multípara` (2do+) **por conteo de partos, desde cualquier categoría previa** — incluida
  `ternera`. Una hembra que **pare no puede seguir siendo ternera**: si figuraba ternera, su categoría
  estaba desactualizada (biológicamente una ternera <1 año no pare; se saltearon las transiciones). El
  trigger incremental as-built (0031/0045) solo maneja `vaquillona preñada → vaca 2º servicio` → el chunk
  de backend debe cubrir el salto a vaca desde **cualquier** categoría femenina por el conteo de partos
  (`compute_category` ya cuenta partos; falta alinear el trigger incremental).

### Aborto

- **Revierte la preñez**: `vaquillona preñada → vaquillona`. Una `vaca 2º servicio`/`multípara` que aborta
  **queda igual** (sus partos ya están contados). `compute_category` deja de contar como preñez el tacto
  positivo previo a un aborto posterior.
- **Flag permanente "tuvo aborto"** (marquita roja en ficha/lista), **derivado** de la existencia de un
  evento de aborto (no es columna de estado). Es un evento importante que debe quedar visible.

### Cría al pie (estado de la madre)

Estado **derivado de eventos** (no es categoría): `con cría al pie` (post-parto) / `sin cría al pie`
(post-destete de su ternero). Se muestra en la ficha de la madre; insumo de analytics.

### Datos por categoría (extiende ADR-021)

La plantilla de datos pasa a depender de **(sistema, sexo, categoría)**, no solo del rodeo. La tabla
"qué datos pide el alta por categoría" vive en el doc de dominio. **Datos nuevos** que introduce: `dientes`
(escala `SIN D · 1/4 D · 1/2 D · 2D · 4D · 6D · BLL`, **solo vacas y toros**), `circunferencia escrotal`
(toritos + toros, **con historial** — 3 mediciones), `cría al pie`, `año de nacimiento` (al menos el año),
`pelaje` (pasa a base de todas las categorías). El prompt de CUT se mantiene, gatillado por los dientes
gastados (`1/2 D`, `1/4 D`, `SIN D`).

### Impacto en implementación

- `compute_category` se **reescribe**: rama macho (castración + cortes 1/2 años + destete) y rama hembra
  (destete/servicio/1 año → vaquillona; parto → vaca; 2º parto → multípara). El **trigger incremental** y
  el **recálculo completo** deben quedar **consistentes** (la castración y el destete tienen que estar en
  ambos, si no editar/borrar un evento revierte por edad).
- Nuevos disparadores en los triggers: evento `weaning` (destete), atributo `is_castrated`, evento `abortion`.
- Esto es un **chunk de backend propio con Gate 1** (categorías nuevas + columnas/atributos nuevos +
  reescritura de `compute_category`/triggers + seed). No se mete en el frontend de C3.2 en curso.

## Alternativas consideradas

### Solo categorías manuales (sin inferencia)
- **Pros**: simple, predecible
- **Contras**: errores garantizados con el tiempo, reportes deficientes

### Inferencia automática sin override
- **Pros**: data más consistente
- **Contras**: no maneja edge cases reales del campo, frustra a usuarios que necesitan corregir

### Inferencia con confirmación en cada caso
- **Pros**: máxima precisión
- **Contras**: fricción operativa inaceptable

### Categorías derivadas como views (no almacenadas)
- **Pros**: nunca se desincronizan
- **Contras**: imposible hacer override manual (categoría es función pura de eventos)

## Consecuencias

**Positivas**:
- Reportes consistentes: la categoría siempre refleja la realidad biológica conocida
- Productor no se olvida de mover animales entre categorías
- Casos edge (compra, aborto no cargado, decisiones de campo) se manejan con un toggle
- Validaciones cruzadas posibles: si la app espera parto pero no llega, se puede alertar

**Negativas**:
- Lógica de transiciones tiene que estar en backend (Edge Functions) para enforcement
- Hay que duplicarla en cliente para preview offline (riesgo de divergencia)
- Tests críticos para evitar regresiones

**Mitigaciones**:
- Lógica encapsulada en un módulo TypeScript reutilizado por cliente y edge function
- Tests unitarios de todos los caminos de transición
- Botón "ver historial de cambios de categoría" en ficha del animal (auditoría)

**Notas de implementación**:
- Trigger en Postgres al insertar `reproductive_events` que evalúa transición
- O alternativamente: lógica en Edge Function que se llama desde el cliente al cargar evento
- En offline: cliente calcula la transición localmente; al sincronizar, backend revalida
- `category_override = false` por default en nuevos animales
- Cambiar manualmente la categoría desde la ficha → `category_override = true` automáticamente
- Botón "permitir actualización automática" → vuelve `category_override = false` y recalcula
