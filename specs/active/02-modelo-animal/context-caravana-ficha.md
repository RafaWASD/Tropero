# Contexto (Gate 0) — Agregar caravana desde la ficha (#6, parte manual)

> Delta Nivel B (ADR-028) sobre spec 02. Cubre la **parte manual** de la corrección #6 del testeo en vivo
> ("agregar caravana desde la ficha, visual y electrónica"). El **botón de bastoneo queda DEFERIDO** (hardware:
> bastón spp-android no probado). Origen: `docs/correcciones-prueba-en-vivo-2026-06-27.md`.
>
> **Nota de proceso (trabajo autónomo)**: Raf pidió (2026-06-29) "hacé todo lo que puedas, no necesites nada de
> mí". Decisiones = defaults menores del leader; **Puerta 0 auto-aprobada**, a confirmar en **Puerta 2** (post-hoc).

## Contexto validado (as-built)

- La ficha (`app/app/animal/[id].tsx`, sección **"Identificación"**) muestra hoy los 3 identificadores **solo
  lectura**: caravana electrónica (`tag_electronic`), caravana / IDV (`idv`), identificación visual
  (`visual_id_alt`). **No hay afordancia para asignar/editar** ninguno desde la ficha.
- **`tag_electronic`** vive en la tabla `animals` (global, **NO sincronizada** a PowerSync — ADR-026) → se asigna
  vía el **RPC existente `assign_tag_to_animal`** (0089; `assignTagToAnimal`, `animals.ts:1176`), **NULL→valor**
  solamente (inmutable post-completitud, R4.13). Es online (outbox→RPC).
- **`idv`** vive en `animal_profiles` (sincronizada) → es **NULL→valor** (inmutable, R4.13.a permitido) y se puede
  asignar por **UPDATE local** sobre `animal_profiles` (mismo patrón offline-safe que CUT, `buildSetCutUpdate`).
- **`visual_id_alt`** = texto libre editable. Por la decisión #2 (caravana 3→2), `visual_id_alt` pasa a ser
  **"Nombre/apodo"** atado a un toggle de rodeo → **fuera de este delta** (va en el delta de #2).

## Alcance

**Entra** (afordancia manual en la ficha):
- **Caravana electrónica** (`tag_electronic`): si está vacía → "Agregar caravana electrónica" (input 15 díg,
  valida `^\d{15}$`, llama `assignTagToAnimal`/RPC existente). Si ya tiene valor → read-only (inmutable R4.13).
- **Caravana visual** (`idv`): si está vacía → "Agregar caravana visual" (UPDATE local sobre `animal_profiles.idv`,
  NULL→valor; respeta unicidad `(establishment_id, idv)` + R4.13). Si ya tiene valor → read-only.

**No entra:**
- **Botón "Detectar bastoneo"** (leer EID del bastón y asignarlo al animal) → **DEFERIDO** (gated por dev build
  Android + bastón spp-android real, no probado; ver feature 04). Se anota como fast-follow del hardware. No se
  muestra un botón muerto.
- `visual_id_alt` "Nombre/apodo" → delta de #2.
- Edición de un identificador YA seteado (inmutabilidad R4.13 — no es caso de uso).

## Casos y decisiones (defaults del leader, confirmables en Puerta 2)

1. **Solo asignar lo que está vacío** (NULL→valor); lo ya seteado queda read-only con su valor. Coherente con la
   inmutabilidad R4.13 ya vigente; el gate de cliente evita ofrecer lo que el server/trigger rechazaría.
2. **Electrónica = RPC existente** (`assign_tag_to_animal`, online); **visual/idv = UPDATE local** (offline-safe,
   patrón CUT). Sin RPC/migración nuevos. (El spec_author confirma el builder de idv contra el trigger R4.13.)
3. **Detección de duplicado al asignar**: reusar las señales existentes — TAG ya existente → error accionable
   (R5.6, ya implementado en el alta); `idv` duplicado en el campo → el unique parcial lo rechaza al sincronizar
   (mismo manejo que el alta). No se inventa validación nueva.
4. **Bastoneo deferido**: no se muestra botón; se documenta para el chunk de hardware (feature 04 / dev build).
5. **UX de campo**: la afordancia respeta los MUSTs (target grande, una decisión, es-AR, validación scroll-al-campo
   + borde rojo + inline; tokens; lineHeight). Afordancia inline en la sección "Identificación" (o sheet).

## Pendientes (CONTEXT/07)
- Ninguno bloqueante. El bastoneo cuelga del hardware (ya en el plan de feature 04).

## Insumos para spec_author
- `app/app/animal/[id].tsx` (sección "Identificación" ~748, read-only hoy), `app/src/services/animals.ts`
  (`assignTagToAnimal` :1176; `buildSetCutUpdate`/`unsetCut` :1257-1275 como patrón de UPDATE local de
  `animal_profiles`), `app/src/services/powersync/outbox.ts` (`enqueueAssignTag` / op `assign_tag_to_animal`),
  `app/src/services/powersync/local-reads.ts` (builders de UPDATE local). Verificar el trigger R4.13
  (`tg_animals_block_tag_change` / inmutabilidad de idv) para el path de asignación de idv.
- Spec 02 R4.2/R4.3/R4.13 (identificadores, unicidad, inmutabilidad), R5.6 (TAG ya existente). ADR-026
  (`animals` no sincroniza → tag por RPC). ADR-028 (delta-spec).
- **Migración**: se estima **ninguna** (tag por RPC existente; idv por UPDATE local con trigger/unique ya
  vigentes). **Gate 1 N/A** salvo que el path de idv requiera un RPC nuevo o una policy nueva — el spec_author lo
  marca explícito si aparece.

## Aprobación
- **Puerta 0 — auto-aprobada bajo la instrucción de trabajo autónomo de Raf (2026-06-29).** Defaults del leader,
  a confirmar en **Puerta 2** post-hoc. Fecha: 2026-06-29.
