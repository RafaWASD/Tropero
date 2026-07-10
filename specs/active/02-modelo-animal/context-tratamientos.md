# Gate 0 — Contexto: TRATAMIENTOS en la ficha del animal (delta spec 02)

> Refinamiento de contexto (ADR-022) del ítem **E** del triage `docs/correcciones-demo-facundo-padre-2026-07-10.md`.
> Pedido de Facundo + su padre (productor real). Estructura base ("tabla `treatments` header") **APROBADA por Raf**
> (2026-07-10); este doc cierra el contexto y las decisiones finas antes de la spec. **Toca schema → Gate 1
> obligatorio + deploy gateado a Raf.** Delta Nivel B (ADR-028).

## 1. Problema / pedido

El productor necesita **vigilar y controlar los tratamientos** que se aplican en el campo — sobre todo lo que hace
el **peón** cuando él no está. Caso dominante: **terneros diarreicos** que el peón trata varios días con un
antibiótico/antiparasitario. El productor quiere poder revisar **desde donde sea**: **QUÉ** se aplicó, **CUÁNTO**,
**CADA CUÁNTO** y **A QUÉ ANIMAL** — para asegurarse de que el peón hace las cosas bien y no aplica cualquier cosa.

Requisitos funcionales (del pedido):
- **Iniciar tratamiento** a un animal desde su ficha: cargar **qué** se le dio (antibiótico o antiparasitario) + un **comentario**.
- **Marcar cada aplicación** de ese tratamiento (el peón lo aplica N días).
- **Finalizar tratamiento** (alta).
- El animal en tratamiento queda con una **marca de color** para reconocerlo rápido en la ficha.
- Los animales en tratamiento van **arriba de todo** (prioridad) en la **lista del rodeo** y en la **lista general de animales**.
- Al finalizar, se **desmarca** y **sale de prioridad**.

## 2. Estado actual (lo que ya existe)

- **`sanitary_events`** (`0027`): eventos sanitarios PUNTUALES, con `event_type` ∈ {`vaccination`, `deworming` (antiparasitario), `treatment` (antibiótico), `test`, `other`}, `product_name`, `active_ingredient`, `dose_ml`, `route`, `event_date`, **`next_dose_date`**, `result`, `adverse_reaction`.
- **NO hay estado**: no existe "tratamiento en curso" (inicio → N aplicaciones → fin) ni flag "en tratamiento" en `animal_profiles`.
- **Listas** (`local-reads.ts:723`): ordenan por `created_at DESC`; **sin pin ni marca de color** hoy.
- La ficha ya muestra el timeline de eventos (incluye sanitarios).

## 3. Modelo propuesto (estructura aprobada)

**Capa de ESTADO sobre el evento que ya existe** (no se reinventa el registro de aplicación):

- **Tabla nueva `treatments` (header)**: `id`, `animal_profile_id`, `establishment_id` (multi-tenant), `kind` (`antibiotico` | `antiparasitario` | `otro`), `product_name`, `notes` (comentario), `started_at`, `ended_at` (NULL = **en curso**), `created_by`, `deleted_at`. RLS por tenant (patrón de las 5 tablas de evento).
- **Aplicaciones = `sanitary_events`** linkeadas por un **`treatment_id`** FK nuevo (nullable — los sanitarios sueltos de maniobra siguen sin header). Cada aplicación reusa `product_name`/`dose_ml`/`route`/`event_date`/`next_dose_date` que ya tiene.
- **"En tratamiento" = derivado** (existe un `treatments` del animal con `ended_at IS NULL`) → sin flag redundante en `animal_profiles`. La marca + el pin se computan de eso.
- **Orden de listas**: nuevo `ORDER BY` que pone los en-tratamiento primero (pin), después el orden actual.

### Ciclo de vida (mente del productor)
1. **Iniciar** (ficha → sección "Tratamientos" → "Iniciar tratamiento"): elegís `kind` (antibiótico/antiparasitario/otro) + `product_name` + `notes`. Crea el header (abierto) + opcionalmente la 1ª aplicación.
2. **Registrar aplicación** (cada día que el peón aplica): agrega un `sanitary_event` linkeado (dosis/fecha; opcional próxima dosis).
3. **Finalizar** ("Dar de alta"/"Finalizar tratamiento"): setea `ended_at` → desmarca + despinnea.
4. **Vigilancia**: la ficha muestra el tratamiento con sus aplicaciones (qué/cuánto/cada cuánto); la lista muestra los en-tratamiento arriba con la marca.

## 4. Decisiones para cerrar el Gate 0 (Raf)

> **✅ GATE 0 CERRADO (2026-07-10, Raf una-por-una):**
> - **D-3 Tipos** → **antibiótico + antiparasitario + otro** (con comentario libre). Vacuna NO (es campaña, por maniobra).
> - **D-2 Quién** → **cualquier rol del campo, incluido el peón** (el peón aplica → registra → vigilancia real).
> - **D-6 Dónde se inicia** → **solo desde la ficha del animal** (v1). Iniciar desde la maniobra = v2 (diferido).
> - **D-1 Marca** → **color distintivo propio** (el leader diseña un azul/turquesa "sanitario", distinto del terracota de alertas y del amarillo de CUT; se veta en Gate 2.5). NO reusar terracota.
> - **D-4 Pin** → **ambas listas** (rodeo + general), en-tratamiento arriba (default confirmado, ya en el pedido).
> - **D-5 `next_dose_date`** → opcional por aplicación, se muestra en la ficha; sin push (post-MVP).
> - **D-7 Reporte "N en tratamiento"** → post-MVP, fuera de alcance.
>
> Próximo: `spec_author` redacta `{requirements,design,tasks}-tratamientos.md` → Gate 1 (schema) → Puerta 1 → implementer → deploy gateado a Raf.



| # | Decisión | Mi recomendación (default si no decís otra) |
|---|---|---|
| **D-1** | **Color de la marca** "en tratamiento" | **Terracota/naranja** (ya es el color de alerta/acción del DS — coherente con el warning del skip). Rojo lo reservamos para destructivo. Confirmar el par de tokens (contraste WCAG). |
| **D-2** | **Quién puede** iniciar/aplicar/finalizar | **Cualquier rol del campo** (incluido el peón — es quien aplica). Es lo que da la vigilancia. |
| **D-3** | **Tipos** | **antibiótico + antiparasitario + "otro"** (con comentario libre). ¿Agregás vacuna acá o esa va solo por maniobra? (rec: vacuna NO — es campaña, no tratamiento individual). |
| **D-4** | **Pin** ¿en ambas listas? | **Sí** — lista del rodeo + lista general. Los en-tratamiento arriba, con la marca. |
| **D-5** | **"Cada cuánto"** ¿usamos `next_dose_date`? | Sí, opcional por aplicación (el peón puede anotar "próxima en X"); mostrarlo en la ficha. Sin recordatorio push por ahora (post-MVP). |
| **D-6** | **Iniciar tratamiento también desde la MANIOBRA** (no solo la ficha), ya que el antibiótico/antiparasitario existen como maniobras | Diferir a v2: por ahora **solo desde la ficha** (el pedido es ese). La maniobra sigue registrando el evento puntual suelto. Confirmar. |
| **D-7** | **¿Reporte "N animales en tratamiento"** en Reportes? | Post-MVP (nice-to-have de vigilancia agregada). Fuera del alcance de este delta. |

## 5. Alcance

**Dentro**: tabla `treatments` + `treatment_id` en `sanitary_events` + RLS/grants + iniciar/aplicar/finalizar desde la ficha + marca de color + pin en las 2 listas + timeline del tratamiento en la ficha.
**Fuera (v2/post-MVP)**: iniciar desde la maniobra (D-6), recordatorios push de próxima dosis, reporte agregado (D-7), integración con `deworming`/`treatment` puntuales existentes (migración de datos — beta sin data real, N/A).

## 6. Gates
- **Gate 1 obligatorio** (schema nuevo + RLS + FK). Deploy gateado a Raf.
- Delta Nivel B (ADR-028): `{context,requirements,design,tasks}-tratamientos.md` en esta carpeta.
- Gate 2.5 (capturas): ficha con marca + iniciar/aplicar/finalizar + lista con pin.
