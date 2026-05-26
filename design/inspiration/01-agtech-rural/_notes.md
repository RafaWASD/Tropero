# 01 — Agtech / Tracking de seres vivos / Apps de campo argentino

Mix de **refs cercanas via Mobbin** (Fi, Withings — tracking de seres vivos) + **capturas device de Raf de Auravant** (la ref agtech argentina más directa).

---

## Fi (collar tracker mascotas) — Mobbin

### fi-home-tracker.png ⭐ — Pattern directo para ficha de animal

Header con nombre "Tilda" + breed "SCOTTISH FOLD" pequeño debajo + iconos (regalo + bell). Card mapa con badge "67% · Online · Now" + chevron de battery + ubicación dentro de un cuadrado amarillo. Dos cards "Rest" y "Activity" con métrica + sparkline pequeño verde. Sección "Last time outside" + bottom nav Live/Health/Community/Tilda.

- [pattern] **identidad animal arriba (nombre + sub-categoría) + status + métricas en cards** — molde de ficha de animal RAFAQ
- [layout] hero map + cards 2-col + sección scrollable
- [keep] **estructura entera adaptable**: cambiar gato por vaca, breed por categoría (vaquillona/vaca/toro), location por rodeo actual, métricas por peso/preñez/última vacunación
- [adapt] paleta neutra → dirección design system que ganemos
- [mobbin] https://mobbin.com/screens/0664355c-9bc5-4a8a-8b06-ea31593f8601

### fi-discover-timeline.png — Cards + empty state ilustrado

Continuación del scroll del home. "Naps Today" + "Active Time" cards en grid 2-col con número grande color + ilustraciones pequeñas. Sección "Last time outside" + card "Your cat's time outside of the safe zone will show up here" + ilustración trees.

- [pattern] mix de cards metrics + cards informacionales + empty states ilustrados con micro-copy
- [keep] **empty state con micro-ilustración** ("Your cat's time will show up here") = pattern para "Aún no cargaste eventos en este animal"
- [mobbin] https://mobbin.com/screens/9ab8e5f6-2417-44c8-82e9-b585908c9407

### withings-home-greeting.png — Greeting personal + tasks

"Good morning, John" headline + avatar circular arriba izq + bell + plus + scale icons. Card "You have no new notifications" + sección "Today's Missions" con 2 cards (Article + scale ✓ tarea) + sección "Latest Measurements" con weight + bottom nav.

- [pattern] greeting personal + tasks pendientes en cards + métricas latest
- [keep] **"Good morning, [nombre]" como header de home** es cálido sin ser cursi (MP también lo usa: "Hola, Rafael")
- [keep] **lista de tareas pendientes en cards** = pattern R6.5 expandido
- [mobbin] https://mobbin.com/screens/c3703a14-d83b-4170-863f-fd17c6a31b2b

---

## Auravant — Capturas device de Raf

> ⚠ **Caso especial híbrido**: Raf marcó que estéticamente le parece **fea** pero **funcionalmente es directamente aplicable**. Es la **referencia funcional más importante** para MODO MANIOBRAS (spec 03) — su flujo "crear actividad" mapea casi 1:1 con el flujo de "iniciar sesión de maniobras" que necesitamos.
>
> **Lectura del material**: separar `[anti]` (estética a NO copiar) de `[keep]` / `[function-ref]` (arquitectura funcional a adoptar).

### auravant-crear-registro-01-empty-state.jpeg ⭐ — Top bar persistente con contexto activo

Top bar negro chips angulados **persistente** mostrando contexto activo:
- `Season 25/26` / `Farm Trial` / `Field Lote1` (jerarquía visible)
- Burger izq + share icon der

Below: header negro `Activities` + X close. Sección con label `Filters` + chips horizontales scrolleables (`Season` activo azul, `Farm`, `Fields`, `Crops`). Empty state centered con **ilustración line-art de caja vacía** + texto `There are no work records for the selected filters`. CTA verde brand pill `New Register` fixed bottom.

- [function-ref] ⭐⭐ **top bar persistente con contexto activo jerárquico (Season/Farm/Field)** — patrón excelente para RAFAQ: barra siempre visible con `Establecimiento activo / Rodeo activo` para que el operador NUNCA pierda contexto en la manga
- [function-ref] **chips de filtro horizontales scrolleables** + chip activo destacado — pattern para listas de animales filtrables
- [function-ref] **empty state centered + ilustración + microcopy + CTA fixed bottom** — pattern universal
- [anti] paleta gris-azul-saturado oscuro top + verde lima brillante CTA = sin armonía cromática
- [anti] chips angulados con bordes oblicuos = diseño caprichoso, no aporta legibilidad
- [anti] tipografía sin jerarquía clara (Activities, Filters, content todo similar tamaño)

### auravant-crear-registro-02-tipo-actividad-options.jpeg ⭐⭐ — Grid 2x2 select type

Modal blanco con headline `Select the type of activity`. **Grid 2x2 de cards** con borde + ilustración line-art + label:
- `Sowing` (planta) / `Application` (jerry can con planta)
- `Harvest` (cosechadora) / `Other labours` (planta + pala)

CTA `Back` dark pill fixed bottom centered.

- [function-ref] ⭐ **grid 2x2 de cards "tipo de algo"** — molde directo para "Seleccionar maniobra" del spec 03 MVP:
  - MOVILIZACIÓN / PESAJE / VACUNACIÓN / TACTO o las 4 más usadas
  - Cada card con ilustración line-art representativa + label
- [function-ref] **modal sheet sobre contenido** permite ver el contexto debajo (parcialmente blurred/disabled)
- [anti] iconografía line-art muy básica, sin personalidad
- [anti] cards rectangulares con corners agudos = look "Material 2017"

### auravant-crear-registro-03-cultivo-choice.jpeg — Form sheet modal

Modal blanco con campos:
- `Crop: No crop` (label bold + valor)
- Body `Choose the crop for the activity`
- Radio `Skip the crop` + label
- Input search-style `Crops in fields` underline
- Body small `Can't find your crop?` + linkstyle `Add crop +`
- Separator
- `Field: Lote1` underline

CTA dual fixed bottom: `Back` dark pill + `Go` verde lima pill.

- [function-ref] **opción "Skip" para pasos opcionales** — pattern útil si en MODO MANIOBRAS algunos campos son opcionales
- [function-ref] **link inline "¿No encontrás X? Add X +"** — pattern para extensibilidad sin frustrar
- [function-ref] **CTA dual Back + Go (forward)** en modal sheet
- [anti] forms underline-only sin border = se ven HTML default
- [anti] paleta verde lima CTA primario = comunica poca autoridad

### auravant-crear-registro-04-cultivo-combo.jpeg — Selector con search

Modal sheet top header negro `Crops` + X close. Search bar pill `Search crop` con icono lupa azul circular en círculo. Sección label bold `All crops`. Lista vertical de items con separator: Cotton / Rice / Pea / Oats / Sugar cane / Barley / Rye / Canola / Chickpea.

- [function-ref] ⭐ **selector con search bar + lista scrolleable** — pattern para seleccionar entre N opciones (categorías de animales, sistemas de cría, vacunas, etc.)
- [function-ref] **header con título + close X consistente** en todos los modal sheets
- [anti] lista plana sin grouping = poca jerarquía si la lista es larga

### auravant-crear-registro-05-fecha.jpeg — Date range picker

Modal sobre form previo (stack de modales). Header `Date` + body `Please select a time period for this crop`. Dos labels `From` + input pill con fecha `Jan 01, '25` + icono calendario / `To` + input pill `Jul 01, '25`. CTA verde lima `Save` pill centrado.

- [function-ref] **date range picker From/To** — pattern para filtros de período en reportes (spec 07) o para "duración de tratamiento" en eventos
- [function-ref] **modal stacked sobre modal previo** — el contenido anterior queda visible disabled para no perder contexto
- [anti] CTA verde lima sin contraste con fondo blanco

### auravant-crear-registro-06a-info-extra.jpeg + 06b-info-extra-scroll.jpeg ⭐⭐⭐ — Form principal Harvest

Fondo gris azulado oscuro full-screen (no modal). Header negro `Harvest`. Sección label uppercase `HARVEST DATA`. Toggle "Does this activity close the crop cycle?" off.

**Form denso con cards lila claro por campo**, cada uno con label uppercase grey + valor:
- `CROP / Corn` con chevron
- `DATE / May 26, '26`
- Chip "Planned" en yellow outline + pencil icon (estado del registro)
- `HARVESTED AREA / 216.7941951612385 ha` con unit dropdown
- `EXPECTED YIELD / ex: 20000 Tn/ha` placeholder
- `REAL YIELD / ex: 20000 Tn/ha`
- Card blanca "+ Storage of harvest in warehouse" (acción inline)
- `MOISTURE / ex: 14`
- `QUALITY / ex: Good`

Sección `NOTES` con textarea `Write some note......`. Sección `COSTS` con tabla mini (Harvest / 217 ha / 0 / US$/ha / Total / 0 / US$). Sección `ADVANCED ACTIVITIES` con 2 mini-cards: `Add machinery` (tractor icon) + `Add person` (people icon).

CTA dual fixed bottom: `Cancel` linkstyle + `Save` verde lima pill.

- [function-ref] ⭐⭐ **form principal con muchos campos + secciones agrupadas** (HARVEST DATA / NOTES / COSTS / ADVANCED) — molde directo para form de **cargar evento del animal** o **detalles de sesión de maniobra**
- [function-ref] ⭐ **"Add machinery / Add person" como mini-cards inline al final del form** — patrón excelente para "agregar entidades relacionadas" durante el flow. Para RAFAQ: `Add bastón / Add balanza / Add veterinario presente`
- [function-ref] **chip de estado** ("Planned" yellow outline + pencil) inline en el form — patrón para mostrar status del registro mientras se edita
- [function-ref] **dropdowns inline para unidades** (ha, Tn/ha) — patrón para campos con units (kg, %, días, dosis)
- [function-ref] **toggle inline para opciones binarias** ("¿cierra ciclo?")
- [function-ref] **placeholder con ejemplo** ("ex: 20000") — sutil indicación de formato esperado
- [function-ref] **sección COSTS con tabla mini-data** — patrón para mostrar cálculos en el form
- [anti] ⚠ **paleta gris azulado oscuro + lila claro cards + verde lima CTA** = mezcla cromática sin armonía
- [anti] labels uppercase grey en cards lila = look 2017 Material/Bootstrap default
- [anti] tipografía sin jerarquía, todo similar
- [anti] mostrar números con 13 decimales (`216.7941951612385 ha`) = problema de UX numérica, no truncan/redondean

### auravant-crear-registro-07-success.jpeg — Lista de activities con primer registro

Vuelta al screen lista. Filters chips arriba. Tabla header `Date / Information`. Grouping header card lila `Corn` (cultivo como agrupador). Row debajo: `May 26, '26` izq + dot verde + chip `Planned` yellow / Cosechadora icono + `Harvest / Lote1` / chevron down / kebab `⋮`. CTA verde lima `New Register` fixed bottom.

- [function-ref] ⭐ **lista agrupada por entidad parent** (cultivo en Auravant → puede ser rodeo o categoría en RAFAQ)
- [function-ref] **row de actividad con: fecha / status dot+chip / icono+nombre / chevron expand / kebab actions**
- [function-ref] **kebab `⋮` para "more actions"** en cada row — pattern universal
- [anti] paleta y tipografía iguales que las anteriores

### auravant-crear-registro-08-ellipsis-edit-menu.jpeg — Menú contextual

Mismo screen + **menú contextual flotante card blanca** sobre fondo grey blurred, con 3 opciones cada una con icono + label:
- `⊕ Change crop` (cambiar entidad asociada)
- `✏ Edit`
- `🗑 Delete`

- [function-ref] **menú contextual con 3 opciones primarias** (cambiar relación / editar / borrar) — pattern para acciones secundarias por entidad
- [function-ref] **iconos + label** en menús contextuales (mejor que solo label)

### auravant-crear-registro-09-edit-uses-same-form.jpeg ⭐⭐ — DRY: editar usa el MISMO form

**Mismo form que el de crear (06a)** pero con el contexto "Other Labours" en lugar de Harvest. Mismos labels (CROP / DATE / LABOUR TYPE dropdown / CURRENT AREA / INPUT con "+ Add Input" / NOTES / COSTS). CTA dual `Cancel / Save`.

- [function-ref] ⭐⭐ **el form de editar es IDÉNTICO al de crear** — DRY principle aplicado correctamente. Implementación: un solo componente form que se prepopula con datos cuando es edit.
- [function-ref] **misma plantilla de form para distintos tipos de actividad** (Harvest, Other Labours, Sowing, Application) — solo cambia título y campos específicos
- [keep] **principio para RAFAQ**: form de "crear evento" === form de "editar evento". Solo cambia título y CTA. Reduce código + UX consistente.

---

## Resumen del valor de Auravant para RAFAQ

**Para Raf el flujo le pareció "feo estéticamente pero parecido en funcionalidad a lo que tenemos que hacer"**. Es la **arquitectura del MODO MANIOBRAS (spec 03)** ya pensada por alguien más.

Lo que llevamos a `research-findings.md` de Auravant:

1. ⭐ **Top bar persistente con contexto activo jerárquico** (Establecimiento/Rodeo siempre visible).
2. ⭐ **Grid 2x2 de cards "tipo de algo"** para selección de maniobra principal.
3. ⭐ **Modal sheets stacked** que mantienen contexto previo visible (disabled).
4. ⭐ **Form principal con secciones agrupadas** (DATOS / NOTAS / COSTOS / AVANZADOS).
5. ⭐ **"Add X" como mini-cards inline** al final del form para entidades relacionadas (bastón, balanza, vet).
6. ⭐ **Chip de estado inline en el form** mientras se edita (Planificada / En curso / Confirmada).
7. ⭐ **Dropdowns inline para unidades** (kg, %, dosis, etc.).
8. ⭐ **Lista agrupada por entidad parent** con kebab `⋮` por row.
9. ⭐⭐ **Mismo form para crear y editar** (DRY).
10. **Selector full-sheet con search bar + lista** para elegir entre N opciones.
11. **Date range picker From/To** para filtros de período.
12. **Filtros chips horizontales scrolleables**.

**Lo que NO copiamos de Auravant**: paleta, tipografía sin jerarquía, chips angulados, forms underline-only, CTAs verde lima sin autoridad, números con 13 decimales sin truncar.

**Si RAFAQ adopta esta arquitectura funcional con Campo Profundo + disciplina Attio = es un upgrade enorme sobre Auravant**, ofreciendo a productores argentinos un agtech con estética B2B pro en lugar del look "Material 2017".
