# Dominio — Modelo de categorías de cría + datos por categoría + analytics (sesión Facundo 2026-06-03)

> **Estado**: capturado del intercambio Raf ↔ Facundo (vet socio) del 2026-06-03. Las partes derivadas
> de capturas de WhatsApp (`tests/respuesta facundo1.png` / `2.png`) están marcadas; **pendiente
> confirmación final de Raf** por si hubo mala lectura.
> **Alcance**: cría bovina (MVP). Es el insumo de dominio para: (1) **enmienda a ADR-008** (máquina de
> estados de categorías), (2) **chunk backend del modelo de categorías** (categorías nuevas + castración
> + cría al pie + flag de aborto + reescritura de `compute_category`/triggers → Gate 1), (3) **rediseño
> del alta "guiada" manga-friendly** (Gate 0 propio; reusa el motor find-or-create de C2), (4) **fórmulas
> de feature 07 (reportes/analytics)**, (5) extensión de ADR-021 (datos no solo por rodeo, también **por
> categoría**).
> **No improvisar**: nada de esto se mete en el frontend de C3.2 en curso. Son chunks propios con sus gates.

---

## 1. Máquina de estados de categorías (cría bovina)

### Machos
- `ternero` → **al destete** (o **al cumplir 1 año** si no hay destete cargado) → `torito` (entero) / `novillito` (castrado).
- `torito` → **a los 2 años** → `toro`.
- `novillito` → **a los 2 años** → `novillo`.
- (`toro` = entero, +2 años · `novillo` = castrado, +2 años.)

### Hembras
- `ternera` → **al destete, o al servicio, o al cumplir 1 año** → `vaquillona`.
- `vaquillona` → **tacto positivo** → `vaquillona preñada`.
- `vaquillona` / `vaquillona preñada` → **PARE (1er parto)** → `vaca 2º servicio` → **2º parto** → `multípara`.
- Sin tope de edad: la vaquillona pasa a vaca **solo al parir** (confirmado P4).

### Reglas transversales
- **Servicio sobre una ternera** → la promueve a `vaquillona` (sin importar la edad) — confirmado A1.
- **Aborto** → revierte la preñez: `vaquillona preñada → vaquillona`; una `vaca 2º servicio`/`multípara`
  que aborta **queda igual** (ya tiene partos contados). Además: **queda MARCADO permanentemente** con
  un flag visible (marquita roja "tuvo aborto") en la ficha/lista — A2. (El flag se deriva de la
  existencia de un evento de aborto; no es una columna de estado.)
- **Cría al pie** (estado de la madre): `con cría al pie` (post-parto) / `sin cría al pie` (post-destete
  de su ternero) — A4.

### Castración (define torito vs novillito)
- Es un **estado del animal** (`is_castrated`), no cambia categoría por sí mismo en el ternero: la
  castración se hace **antes del destete**, y al destetar es **automático** qué machos van a `torito`
  (enteros) y cuáles a `novillito` (castrados). Si el animal ya pasó el destete (es `torito`/`toro`),
  castrarlo lo pasa a `novillito`/`novillo` en el momento.
- **Carga (opinión del leader, aceptada a discutir)**: es una **operación masiva** (encaja en spec 10 —
  operaciones masivas por rodeo): *"castrar el rodeo/lote → marca todos los machos como castrados → paso
  de EXCLUSIÓN (multi-select) para dejar enteros los que elegís: tus futuros toritos/toros"*. NO es config
  del rodeo (eso es plantilla de datos), NO es evento de manga individual. Corrección individual = toggle
  "castrado/entero" en la ficha.

---

## 2. Datos por categoría (cría bovina) — qué pregunta el alta guiada

> El alta deja de ser un form genérico y pasa a ser un **wizard guiado manga-friendly**:
> `rodeo (→ sistema) → sexo → categoría → datos que correspondan`. Si el alta es parte de una **maniobra**
> (ej. tacto), sigue con las preguntas de esa maniobra. Los datos dependen de **(sistema, sexo, categoría)**:
> ej. el **peso** solo tiene sentido en recría/engorde, no en una multípara de cría.

**Base (TODAS las categorías):** identificación (caravana electrónica / IDV / visual) · **raza** ·
**pelaje (color de capa)** · **año de nacimiento** (al menos el año, si se tiene el dato) · lote (opcional).

### Reglas de datos (correcciones de Facundo, capturas 2026-06-03)
- **Peso**: solo categorías de **recría / engorde**. En rodeo de cría, el peso de los adultos no importa
  (se maneja por condición corporal); en cría se pesa principalmente **al destete**.
- **Condición corporal**: **NO en recrías**. SÍ en **vaca 2º servicio + multípara** (+ a lo sumo
  `vaquillona preñada`). **Toros: NO se scorean en la práctica en cría** (refinamiento Facundo 2026-06-04;
  quizá sí en recría/engorde). La app igual **ofrece la opción** de cargar condición corporal en cualquier
  categoría (por si alguien quiere hacerlo), pero no es el dato esperado/default por categoría → en el
  wizard de "Agregar evento" NO se gatea por categoría (es nuance del **alta guiada**, no prohibición).
- **Dientes (boca)**: **solo en vacas (2º serv + multíparas) y toros**. Valores:
  **SIN D · 1/4 D · 1/2 D · 2D · 4D · 6D · BLL (boca llena)**.
- **Tamaño de preñez** (cabeza/cuerpo/cola): en **toda hembra preñada** → `vaquillona preñada` **y vacas**
  (2º serv / multíparas) preñadas.
- **Circunferencia escrotal (CE)**: importante en **toritos** (sobre todo) y **toros**; se mide en
  **3 momentos distintos** para ver la progresión (→ es un dato con historial, no un valor único).

### Tabla resultante (cría bovina)

**Hembras:**
| Categoría | Datos a preguntar |
|---|---|
| ternera | peso |
| vaquillona | peso |
| vaquillona preñada | tamaño de preñez · (condición corporal a lo sumo) |
| vaca 2º servicio | dientes · condición corporal · tamaño de preñez (si preñada) · cría al pie |
| multípara | dientes · condición corporal · tamaño de preñez (si preñada) · cría al pie |

**Machos:**
| Categoría | Datos a preguntar |
|---|---|
| ternero | peso |
| torito | peso · circunferencia escrotal |
| toro | dientes · circunferencia escrotal (condición corporal **opcional** — no se scorea en cría en la práctica) |
| novillito | peso |
| novillo | peso |

> **Nota de modelo**: esto **extiende ADR-021** — la plantilla de datos deja de ser solo por rodeo y pasa
> a depender también de la **categoría** (y del sexo). El "qué datos por categoría" de esta tabla es el
> corazón del rediseño del alta.

---

## 3. Datos NUEVOS que esto introduce (no existen hoy en el modelo)

- **Dientes (boca)** — enum: `SIN D | 1/4 D | 1/2 D | 2D | 4D | 6D | BLL`. (R8 de spec 02 ya menciona
  "CUT y dientes"; acá se fija la escala.)
- **Circunferencia escrotal (CE)** — numérico (cm), con **historial** (3 mediciones para progresión).
- **Cría al pie** — estado derivado/trackeado de la madre (con / sin).
- **Año de nacimiento** — al menos el año (cuando no se tiene la fecha exacta). El modelo hoy tiene
  `birth_date date`; hay que permitir "solo año".
- **Pelaje** — ya existe (`coat_color`), pero pasa a ser dato base de **todas** las categorías (no opcional).

(Ya existen: peso → `weight_events`; condición corporal → `condition_score_events`; tamaño de preñez →
`reproductive_events.pregnancy_status`.)

---

## 4. Etiquetas de tacto (B1) — frontend

Mostrar **solo el término de campo**: `Vacía` · `Cola` · `Cuerpo` · `Cabeza`. **Sin** "preñez chica/media/
grande". Equivalencia (sabida, no mostrada): **cabeza = grande, cuerpo = mediana, cola = chica**. Mapeo al
enum DB: `small = cola`, `medium = cuerpo`, `large = cabeza`. (Es un fix de frontend chico → va en C3.2.)

---

## 5. Servicio / reproductivo

- **Monta natural**: NO se anota el toro (entran en grupo, no de a uno).
- **IA / TE**: se puede saber la **pajuela (semen)** → permitir anotarla (semen_registry se completa en
  feature 03; mientras tanto, las notas opcionales del servicio pueden sostenerla).
- **Validación tacto ↔ parto**: implementar el cruce **tamaño de preñez predicho (cabeza/cuerpo/cola) vs
  fecha real de parto** → útil para ver si el vet está fallando o si se cargan mal datos. Feature confirmada
  (post-MVP del core, pero con valor claro).
- **Pesaje de ternero**: igual que el pesaje normal (mismo flujo, no hacer uno distinto). En cría se pesa al
  destete; peso al nacimiento solo en cabaña.

---

## 6. Fórmulas de reportes / analytics (feature 07) — confirmadas por Facundo

Denominador clave: **entoradas** = hembras puestas en servicio (lo deriva el evento de servicio / período
de entore).

- **% de preñez** = (vacas + vaquillonas **preñadas**) / **entoradas** × 100
- **% de destete** = terneros **destetados** / **entoradas** × 100
- **% cabeza** = (preñadas en cabeza **o** destetadas de cabeza) / terneros totales × 100  *(ídem cuerpo, ídem cola)*

El **"o"** es porque cada porcentaje se mide en **dos instantes**: al **tacto** (preñadas por tamaño) y al
**destete** (destetadas de ese tamaño). Guardar **ambos** números permite ver **cuáles se murieron** entre
tacto y destete (muertes de terneros / abortos). → Analytics debe persistir el tamaño de preñez por animal
en ambos momentos para reconstruir estas curvas.

---

## 7. Implicancias / próximos pasos

1. **Enmienda a ADR-008** (o ADR nuevo): la máquina de estados completa (§1) + castración + cría al pie +
   flag de aborto.
2. **Chunk backend "modelo de categorías"** (Gate 1): categorías `novillito`/`novillo` al seed; `is_castrated`;
   destete/servicio/edad/2-años como disparadores; reescritura de `compute_category` + triggers; `dientes`,
   `circunferencia_escrotal` (con historial), `cría al pie`, `año de nacimiento`; flag de aborto.
3. **Castración masiva con exclusiones** → encaja en **spec 10** (operaciones masivas por rodeo).
4. **Rediseño del alta "guiada"** (Gate 0 + spec): `rodeo → sexo → categoría → datos por categoría`,
   manga-friendly, convergente con MODO MANIOBRAS (spec 03). Reusa el motor find-or-create de C2; el form
   plano de C2 queda superado por el wizard guiado. Acopla 02 (alta) + 09 (find-or-create) + 03 (maniobras)
   + ADR-021 (datos por categoría).
5. **Feature 07 (reportes)**: las fórmulas de §6 son el insumo firme.
6. **B1 (etiquetas Cabeza/Cuerpo/Cola)** (§4): fix de frontend chico → C3.2.
