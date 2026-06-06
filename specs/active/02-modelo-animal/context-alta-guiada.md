# Spec 02 — Frontend: rediseño "alta guiada" (Gate 0 / contexto)

**Status**: Gate 0 — scope acordado con Raf (2026-06-05); pendiente diseño + spec/brief + Puerta humana.
**Tipo**: rediseño **frontend** de "cargar animal" (rework de C2). **Frontend-puro** (los datos del dominio ya
existen en la DB tras el chunk del modelo de categorías) → **sin Gate 1; Gate 2 (code) sí** (es alta, security-sensitive).

## Driver

En la sesión con Facundo (2026-06-03/04) Raf rediseñó "cargar animal": en vez del **form plano** actual (C2,
`crear-animal.tsx`, todos los campos juntos), un **wizard guiado manga-friendly** que pregunta
`rodeo → sexo → categoría → datos que correspondan a esa categoría`, mostrando solo lo relevante (ej. una
multípara de cría pide dientes + condición, no peso). Es "alta = mini-maniobra", convergente con MODO MANIOBRAS.
Ahora **se puede** porque el modelo de categorías (novillito/novillo + transiciones + datos por categoría) ya
está en backend (commit `0496387`).

## Fuente de verdad del dominio
- `specs/active/02-modelo-animal/dominio-categorias-facundo-2026-06-03.md` §2 — la **tabla de datos por categoría**
  (qué pregunta el alta por categoría) + las correcciones de Facundo (CC no en recría; dientes solo vacas/toros; etc.).
- ADR-008 enmendado — la máquina de estados (las categorías que el picker ofrece).
- ADR-021 — plantilla de datos (este rediseño la **extiende conceptualmente** a "por categoría", hardcodeado por ahora).

## Scope (acordado con Raf)

### ENTRA (frontend)
1. **Wizard guiado** que reemplaza el form plano de C2:
   `ID (find-or-create, sin cambios) → rodeo (1 fijo / ≥2 combo, sin cambios) → sexo → categoría → datos por categoría`.
   Reusa el motor find-or-create + `createAnimal` (services de C2): **no se tira nada**, se reorganiza el form en pasos guiados.
2. **Selección de categoría** filtrada por (sistema, sexo): hembra cría → ternera/vaquillona/vaq.preñada/vaca 2ºserv/multípara;
   macho cría → ternero/torito/toro/novillito/novillo. Una decisión por pantalla, targets grandes (manga-friendly).
3. **Datos por categoría** (hardcodeado, la tabla del dominio §2): el paso final muestra **solo los campos relevantes**
   a (sistema, sexo, categoría) — todos ya existen en la DB:
   - base (todas): identificación (del find-or-create) · raza · pelaje · **año de nacimiento** (al menos el año) · lote.
   - recría (ternero/a, vaquillona, novillito/o, torito): peso.
   - adultas repro (vaca 2ºserv, multípara): dientes (`teeth_state`) · condición corporal · estado de preñez (tacto) · cría al pie (`nursing`).
   - toro: dientes · condición corporal. *(circ. escrotal DIFERIDA — ver abajo.)*
   - vaquillona preñada: tamaño de preñez · (condición corporal a lo sumo).
4. **`category_override` correcto**: la categoría elegida se setea; si coincide con la que `compute_category` daría por
   sexo/edad (ej. ternero recién nacido) → `override=false` (auto-transiciona); si NO (ej. comprás una multípara sin
   historial) → `override=true` (preserva la elección, A5 "vaca comprada"). Cierra la decisión A5 del dominio.
   - **Refinamiento B (preñez capturada)**: la comparación incluye la **preñez capturada en el alta**. Si elegís
     `vaquillona_prenada` Y cargás un tacto+ (Cabeza/Cuerpo/Cola), la computada-con-preñez también es
     `vaquillona_prenada` → coincide → `override=false` (es DERIVABLE: un tacto+ la transiciona server-side; un parto
     futuro la lleva a vaca). Sin la preñez, computa `vaquillona` → difiere → `override=true`. Las vacas con partos
     (`multipara`/`vaca_segundo_servicio`) NO son derivables del alta (no capturamos partos) → siempre `override=true`.
     Implementado en `categoryOverrideFor(chosen, sex, birthDate, { pregnant })` + `computeInitialCategoryCode(..., { pregnant })`.
5. **RT2.20 — alinear el espejo cliente** `app/src/utils/animal-category.ts::computeInitialCategoryCode`: hoy solo
   arroja ternero/torito/ternera/vaquillona; sumar `novillito`/`novillo` + la rama de castración, para que la lógica
   de override (#4) y el alta de machos castrados adultos resuelvan bien. (Cierra el RT2.20 que el backend dejó anotado.)

### QUEDA AFUERA (diferido)
- **Circunferencia escrotal (CE)** — único dato del dominio que NO existe en la DB; modelado a refinar con Facundo
  (CONTEXT/07, 2026-06-05). Follow-up chico (tabla `scrotal_circumference_events` + campo en el wizard de toritos/toros).
- **Datos por categoría como CONFIG** (extensión formal de ADR-021): hardcodeado para MVP; configurable es post-MVP.
- **Importación masiva** (feature 12) — el camino del usuario nuevo con rodeo entero; ya es feature aparte.

## Decisiones tomadas (defaults del leader, no se re-preguntan)
- Datos por categoría = **hardcodeado** (la tabla es fija; config = over-engineering MVP).
- Override por coincidencia con `compute_category` (#4).
- Manga-friendly (una decisión por pantalla en los pasos de selección; el paso de datos es un form con los campos relevantes — el alta entra desde la tab Animales, lugar cómodo, 🟡, pero igual con targets grandes y validación robusta).

## Edge cases / a cuidar
- **Año-de-nacimiento (year-only)**: el alta hoy pide fecha completa opcional. Permitir "solo año" (cuando no se sabe
  el día) — convención sobre `birth_date` (ej. `AAAA-01-01` + marca, o un campo de precisión). Resolver en el diseño.
- **Find-or-create intacto**: el ID precargado (no editable) del match/no-match no cambia; el wizard arranca DESPUÉS del ID.
- **Validación robusta** (lección de C2 fix-loop): cada input acotado en vivo (caravana 15 díg, peso decimal, dientes
  selector cerrado, etc.). El selector de categoría y el de dientes son CERRADOS.
- **Categoría inválida por sexo**: el picker de categoría solo ofrece las del sexo elegido (no se puede elegir "toro" para una hembra).

## Decomposición sugerida (chunks de implementer, cada uno con veto de diseño)
- **A — el wizard de selección** (`ID → rodeo → sexo → categoría`) + la lógica de override (#4) + RT2.20 (espejo cliente).
  El esqueleto guiado + la categoría correcta.
- **B — el paso "datos por categoría"** (el form dinámico que muestra los campos relevantes por categoría, hardcodeado §2) +
  el wiring a `createAnimal` (que ahora recibe la categoría elegida + el override + los datos).
> Se puede hacer en un run si sale acotado; si no, A y B secuenciales (lección "ficha completa demasiado para un run").

## Gates
- **Sin Gate 1** (frontend, no toca schema/RLS/Edge — todo el sustrato ya existe). **Gate 2 (code) SÍ** (alta = security-sensitive: createAnimal, multi-tenant, override).
- Veto de render del leader (Playwright) antes de mostrar a Raf (lección C2 "salió genérico").
