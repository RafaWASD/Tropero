# Spec 02 — Delta PARTO: RODEO + CARAVANA VISUAL DEL TERNERO (#4 / #1a) — Contexto (Gate 0)

**Status**: `context_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 · **frontend-only** (backend ya deployado).
**Fecha**: 2026-06-30.
**Origen**: correcciones **#4** ("rodeo al parto") + **#1a** ("caravana visual al parto") del testeo en vivo con Facundo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`). Segundo cluster del segmento A (ternero), después de #15 (`cria-al-pie-alta`).
**Gate 0**: aprobado por el **leader** en modo autónomo (Raf: "segui con lo que te parezca", 2026-06-30). Las decisiones de criterio propio se marcan abajo para confirmar en la Puerta 1/2.

---

## Problema

Al registrar un **parto** (`app/app/agregar-evento.tsx`, `eventType='birth'`), el operario puede cargar, por cada ternero, su **sexo**, **peso** y **caravana electrónica (tag)**. Pero NO puede:
- **#4** elegir el **rodeo** del ternero — los terneros heredan siempre el rodeo de la madre.
- **#1a** cargar la **caravana visual (idv)** del ternero — solo la electrónica.

En el campo, un ternero recién nacido a veces va a un rodeo distinto del de la madre (p.ej. un rodeo de terneros/destete), y muchas veces se le pone la caravana visual en el momento. Hoy eso obliga a un segundo paso (mover de rodeo / asignar visual desde la ficha después).

## Estado as-built relevante

- El parto se registra vía `registerBirth` (`events.ts`) → RPC `register_birth` **6-arg** (`0116`), que YA acepta `p_calf_rodeo_id` y `p_calf_idv` (se agregaron para el delta #15 `cria-al-pie-alta`). **El backend ya está deployado** → este delta es **frontend-only**.
- ⚠️ **Restricción del RPC**: `p_calf_rodeo_id` y `p_calf_idv` son **escalares únicos** (un valor para toda la camada del parto), porque se diseñaron para el camino de **1 ternero** de #15. El parto soporta **mellizos** (lista dinámica de N terneros, R9.5), cada uno con su sexo/peso/tag electrónico (en el jsonb `p_calves`). El `idv` NO está en ese jsonb.
- El form de parto vive en `agregar-evento.tsx` (lista dinámica `calves: CalfRow[]` con `sex`/`weightRaw`/`tagRaw`). Es la misma pantalla que se usa desde la ficha y desde la maniobra.

## Decisiones (Gate 0)

**D1 — Rodeo del ternero al parto (#4): un picker a nivel parto, para TODA la camada.** Como `p_calf_rodeo_id` es único, el rodeo elegido aplica a todos los terneros del parto (single y mellizos — los mellizos típicamente van juntos). UX calcada de #15: picker con el **rodeo de la madre preseleccionado** + leyenda **"(Mismo rodeo que la madre)"**, editable a otro rodeo del campo del **mismo sistema productivo**. → `calfRodeoId`. *(Funciona para single y mellizos.)*

**D2 — Caravana visual del ternero al parto (#1a): campo idv SOLO cuando hay 1 ternero (caso común).** Como `p_calf_idv` es único, ofrecer un campo de caravana visual **por ternero** rompería con mellizos (el RPC no puede tomar N idvs). **Decisión de criterio propio del leader**: el campo de caravana visual aparece **solo cuando la camada tiene 1 ternero** (la inmensa mayoría de los partos). → `calfIdv`. Cuando el operario agrega un 2º ternero (mellizos), el campo de visual **desaparece** y se muestra una nota: *"Las caravanas visuales de mellizos se asignan después desde la ficha de cada ternero."* (eso ya lo cubre el delta `caravana-ficha`). El **tag electrónico** sigue siendo **por ternero** (sin cambios — ya está en el jsonb). *(A confirmar en Puerta 1. Alternativa si Raf lo quiere para mellizos: extender el jsonb `p_calves` con `calf_idv` por ternero → backend + deploy, NO autónomo, queda para una iteración posterior.)*

**D3 — Frontend-only, sin migración.** No se toca `supabase/`. `register_birth` 6-arg ya valida server-side (rodeo activo/del tenant de la madre/mismo sistema → `23514`; idv único/inmutable). **Gate 1 N/A** (se confirma con `git diff supabase/` vacío). El cliente solo pasa `calfRodeoId`/`calfIdv` a `registerBirth` (que ya los soporta).

**D4 — Reúso de patrones de #15.** El picker de rodeo y el campo de idv reusan los patrones/validaciones del prompt de #15 (`LinkCalfPrompt`/`crear-animal`): leyenda "(Mismo rodeo que la madre)", filtro por sistema, `sanitizeIdvInput`, es-AR, anti-recorte, validación inline, tokens (ADR-023).

**D5 — Gate 2.5 (ADR-029).** Es UI → el implementer entrega `app/e2e/captures/parto-rodeo-caravana.capture.ts` con capturas nombradas de cada estado (parto single con rodeo+idv, parto mellizos sin idv + nota, picker de rodeo abierto + leyenda, rodeo cambiado). El leader veta visualmente antes de la Puerta 2.

## Edge cases

- **Mellizos**: rodeo aplica a todos; idv NO se ofrece (nota). El tag electrónico sigue por ternero.
- **Rodeo de otro sistema / otro tenant**: el RPC rebota (`23514`); el picker ya filtra por sistema del rodeo de la madre y por campo activo (anti-IDOR client-side + server-side).
- **idv duplicado/ inmutable**: el RPC valida la unicidad parcial `(establishment_id, idv)` y la inmutabilidad; el rechazo real lo resuelve `uploadData` al subir (offline-first).
- **Offline**: todo el form es offline (lectura local de rodeos vía `useRodeo()`, escritura por outbox). Sin red nueva.
- **Parto desde la ficha vs. maniobra**: misma pantalla (`agregar-evento.tsx`) → un solo cambio cubre ambos contextos.

## Alcance / no-alcance

- **SÍ**: rodeo picker (todos los terneros) + idv (single calf) en el form de parto; nota de mellizos; capture file; reconciliación de specs.
- **NO** (este delta): idv por-ternero para mellizos (necesita backend+deploy → backlog/iteración posterior); peso de destete (#10, a charlar con Facundo); %parición/%destete (#8/#10, RPC+deploy).

## Tareas para la spec

El spec_author redacta `{requirements,design,tasks}-parto-rodeo-caravana.md` (numeración `RPRC.<n>`) traduciendo D1–D5 a EARS, con el mapa de reúso de #15 y el capture file del Gate 2.5 como deliverable.
