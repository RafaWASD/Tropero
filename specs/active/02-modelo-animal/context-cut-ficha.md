# Context (Gate 0) — Marcar CUT (descarte) desde la ficha + indicador amarillo

> **Estado:** refinamiento de contexto (Gate 0, ADR-022). ⏸ Pendiente de aprobación de Raf para pasar a
> `context_ready` → spec. Pedido original (Raf, 2026-06-17): *"que a las vacas hembras me permitas marcarlas
> como CUT desde la ficha del animal. Además que al mostrar la categoría CUT no lo hagas verde como el resto,
> algún amarillo o rojo en el indicador para que se vea fácil que es para descarte."*

## Objetivo

Dos cosas, ambas sobre una categoría que **ya existe** en el modelo:

1. **Marcar CUT desde la ficha** del animal (hoy solo se puede desde MODO MANIOBRAS, vía el prompt de
   dientes gastados — spec 03 M3.2a). Agregar la afordancia equivalente en la ficha, para hembras.
2. **Indicador de categoría CUT en AMARILLO**, no en verde como el resto, para que el descarte se lea de un
   vistazo (en la ficha y en toda la app donde aparece el badge).

## Qué es CUT (as-built — no se redefine acá)

- **CUT = "Criando Último Ternero"** = vaca de **descarte** por edad/dientes (ADR-008). Es **female-only**
  por definición.
- En datos: categoría `code='cut'`, `name='CUT'` (seed `0015`, orden 70) + flag denormalizado
  `animal_profiles.is_cut` + `category_override=true`.
- "Marcar CUT" as-built (maniobra dientes+CUT) = **UPDATE** `is_cut=1, category_id=<cut>, category_override=1`
  → builder existente **`buildSetCutUpdate`** (gateado por `dientes`, ver edge cases).
- "Desmarcar CUT" as-built = `is_cut=0, category_id=<derivada>, category_override=0` → builder
  **`buildUnsetCutUpdate`** (cambio sustractivo, **no** gateado).
- `resolveCutCategory(profileId)` ya resuelve el `cutCategoryId` + la `derivedCategoryId` (offline, local).

→ **El plumbing ya existe**: este trabajo es (a) una afordancia nueva en la ficha que reusa esos builders,
y (b) una variante de color del `CategoryBadge`.

## Decisiones cerradas (Raf, 2026-06-17)

| # | Decisión | Valor elegido |
|---|---|---|
| D1 | Color del indicador CUT | **Amarillo (token nuevo)** — se agrega un par amber al design system (ver edge case de contraste) |
| D2 | A qué hembras se ofrece "Marcar CUT" | **Todas menos ternera** (vaquillona, vaquillona preñada, vaca 2º servicio, multípara) |
| D3 | Machos | **No** — CUT es female-only por definición |

## Enfoque técnico propuesto (a confirmar en design)

- **Servicio (animals.ts):** `setCut(profileId)` = `resolveCutCategory` + `runLocalWrite(buildSetCutUpdate)`;
  `unsetCut(profileId)` = `buildUnsetCutUpdate` con la derivada. Reuso casi total de lo existente.
- **Ficha (`app/app/animal/[id].tsx`):** hoy la sección "Manejo" se renderiza **solo para machos** (castrado +
  futuro torito). Se agrega afordancia para **hembras** (activas, categoría ≠ ternera): "Marcar como CUT
  (descarte)" con confirmación inline (mismo patrón que la fila de castración). Si la hembra **ya es CUT** →
  mostrar "Quitar CUT" (que llama a `unsetCut`, **resetea `is_cut`**) en vez de la card genérica
  "Quitar fijación".
- **Badge (`CategoryBadge`):** variante amarilla cuando la categoría es CUT. Blast radius = **6 sitios**
  (hero de la ficha, `AnimalRow` de la lista, asignar-caravanas, import-rodeo, CandidatePicker,
  FindOrCreateOverlay). Detección preferida por `code==='cut'`; fallback por `name==='CUT'` (el name es un
  valor fijo del catálogo) para los call-sites que no tienen el code a mano.
- **Token (`tamagui.config.ts`):** par `$warning` (amber oscuro, texto) + `$warningLight` (amber pálido, fondo)
  — espejo del par `$primary`/`$greenLight` que usa hoy el badge.

## Edge cases / riesgos

1. **Gating `dientes` (0054):** `buildSetCutUpdate` hace `is_cut` false→true = cambio **aditivo** → el trigger
   `tg_animal_profiles_teeth_gating` exige `dientes` **enabled** en el rodeo. `dientes` es **ON por default**
   en cría (ADR-021) ⇒ el camino común funciona. Si un rodeo tiene `dientes` deshabilitado, el write local
   tiene éxito pero **uploadData lo rechaza** (23514). **Mitigación recomendada:** gatear la acción en el
   cliente por `dientes` enabled (leer `rodeo_data_config` local, best-effort) para no ofrecer algo que el
   server va a rechazar. Es **consistente** con la maniobra (CUT vive en rodeos que trackean dientes).
2. **Consistencia `is_cut` ↔ override:** la card genérica **"Quitar fijación"** (`revertCategoryOverride`)
   **NO** resetea `is_cut` → dejaría un `is_cut=1` con categoría no-CUT (inconsistente). Por eso el desmarcado
   de un CUT **debe** usar `unsetCut`/`buildUnsetCutUpdate`. La ficha debe exponer `is_cut` en `AnimalDetail`
   para distinguir "es CUT" y elegir la afordancia correcta.
3. **Legibilidad del amarillo sobre blanco:** un amarillo claro de texto sobre fondo blanco da contraste malo.
   El par debe ser **amber oscuro** para texto (objetivo ≥ 4.5:1) sobre fondo amber pálido / blanco. Se
   **mide** el contraste antes de mostrar (skill design-review). Es un cambio de design system → cuidado.
4. **Colisión con terminal paralela:** `tamagui.config.ts`, `animals.ts` y `local-reads.ts` están con cambios
   **sin commitear** de la terminal de spec 03/08. La implementación va a tocar al menos los dos primeros.
   Plan: implementar en **worktree aislado** o **secuenciar** tras el commit de esa terminal, y commitear solo
   mi slice (no pisar su trabajo — ver memoria `feedback_parallel_terminals`).

## Fuera de alcance

- Descarte de machos (CUT es female-only). Si más adelante hay un concepto de descarte de macho, es otra feature.
- Cambiar el modelo de gating de dientes/CUT (no se toca 0054).
- Un editor genérico de categoría en la ficha (esto es solo la afordancia CUT).
- Analytics/reportes de descarte.

## Definition of done (borrador)

- Desde la ficha de una hembra activa (≠ ternera, en rodeo con `dientes` enabled): "Marcar como CUT" →
  confirma → la categoría pasa a CUT, `is_cut=1`, override; offline. Si ya es CUT → "Quitar CUT" lo revierte
  (resetea `is_cut`, vuelve a la categoría derivada).
- El badge CUT se ve **amarillo** (no verde) en la ficha y en la lista, con contraste medido OK.
- E2E (Playwright) cubre marcar/quitar CUT desde la ficha + el color del badge. Tests unitarios del servicio.
- Specs (requirements/design/tasks) reconciliadas; reviewer + Gate 2 (security) en verde.
