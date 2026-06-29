# Contexto (Gate 0) — Refinamiento del formulario de alta (#3 / #13 / #14)

> Delta Nivel B (ADR-028) sobre spec 02, **frontend puro** (sin migración → Gate 1 N/A). Junta 3 correcciones del
> testeo en vivo que tocan el alta guiada (`crear-animal.tsx`). Origen: `docs/correcciones-prueba-en-vivo-2026-06-27.md`.
>
> **Nota de proceso (trabajo autónomo)**: Raf pidió (2026-06-29) "hacé todo lo que puedas, no necesites nada de mí".
> Las decisiones de este contexto son **defaults menores del leader** (CLAUDE.md: "defaults menores → proponer
> default + commit"); **Puerta 0 auto-aprobada bajo esa instrucción**. Se confirman/ajustan en **Puerta 2** (la
> puerta humana que se preserva). Si algún default no le cierra a Raf, se revierte ahí.

## Contexto validado (as-built)

`app/app/crear-animal.tsx` = wizard de 4 pasos (rodeo → sexo → categoría → datos). El paso 4 (`Step4Data`) muestra
campos **opcionales** gateados por categoría (`fieldsForCategory`): año nac, raza, pelaje, peso, dientes, condición
corporal, preñez, cría al pie (+ aptitud, del delta recién cerrado). Hoy:
- **Fecha de nacimiento** = solo **año** (`birthYear`, `animal-birth-year.ts`) → se guarda `AAAA-07-01` (midpoint,
  minimiza sesgo de edad). `animals.birth_date` ya es `DATE` → **sin migración**.
- **Condición corporal** = `ScoreChips` (17 chips 1,00–5,00). En la **maniobra** es un **stepper +/−**
  (`CondicionCorporalStep.tsx` + util pura `condition-stepper.ts`).
- **Campos opcionales**: son estado React; una vez tocados se editan/vacían a mano, pero **no hay afordancia
  explícita de "quitar/destildar"** un opcional cargado por error.

## Alcance

**Entra** (3 correcciones, todas frontend de `crear-animal.tsx` + utils):
- **#3** — Fecha de nacimiento opcional **dd/mm** en un campo **separado** del año.
- **#13** — Condición corporal en el alta como en la maniobra: **stepper +/−** (reusa `condition-stepper.ts`).
- **#14** — Poder **destildar/quitar** los datos opcionales (volver a "sin cargar") tras tocarlos sin querer.

**No entra**: #2 (nombre/apodo por toggle de rodeo — toca `rodeo_data_config`, va en su propio delta); nada de DB.

## Casos y decisiones (defaults del leader, confirmables en Puerta 2)

**#3 — Fecha dd/mm separada del año**
- Se mantiene el campo **Año** como está. Se agrega un campo **opcional "Día / Mes" (DD/MM)** separado, debajo/al
  lado del año, teclado numérico, formato es-AR día-primero.
- Si cargan DD/MM → `birth_date` = fecha exacta (`AAAA-MM-DD`). Si cargan **solo año** → se mantiene el midpoint
  `AAAA-07-01` (comportamiento actual, no se rompe).
- **Validación**: DD/MM es **todo-o-nada** (ambos o ninguno); requiere que el **año** esté cargado (no hay fecha sin
  año); día/mes válidos (rechazar 31/02, 00/00, etc.); 29/02 en año no bisiesto → inválido (error inline, no clamp
  silencioso). Error con scroll-al-campo + borde rojo + mensaje inline (regla UX de sheets/forms del proyecto).

**#13 — Condición corporal stepper**
- Reemplazar `ScoreChips` por el **stepper +/−** del lenguaje de la maniobra (valor hero + botones − / + ; rango
  1,00–5,00 paso 0,25; default 3,00; coma decimal es-AR), **reusando la util pura `condition-stepper.ts`** (no
  duplicar la aritmética). Idealmente extraer el cuerpo del stepper a un componente compartido entre maniobra y
  alta; si el layout full-screen de la maniobra no encaja en el scroll del paso 4, embeber una versión compacta
  (decisión de layout del implementer, conservando la aritmética/los tokens/los labels).

**#14 — Destildar opcionales**
- Todo campo **opcional** del paso 4 debe poder volver a **"sin cargar"** después de tocado:
  - **Selectores cerrados** (OptionRows: dientes, preñez, cría al pie, aptitud) → **re-tap del valor seleccionado lo
    deselecciona** (toggle a sin-cargar). Patrón intuitivo, sin agregar un control extra.
  - **Stepper de condición** → un "Sin cargar"/limpiar (vuelve a no-enviar el dato; el default 3,00 NO se persiste si
    el usuario no confirmó cargarlo — distinguir "tocado" de "default").
  - **Inputs de texto/número** (raza, pelaje, peso, día/mes) → vaciar el input = sin-cargar (ya funciona); agregar
    una "✕" de limpiar rápido si el campo tiene valor (opcional, a criterio del implementer).
- Regla: lo que quedó en "sin cargar" **no se envía** al `create_animal` (NULL), igual que hoy un campo nunca tocado.

## Pendientes (CONTEXT/07)
- Ninguno. Sin DB, sin Facundo.

## Insumos para spec_author
- `app/app/crear-animal.tsx` (Step4Data ~1009-1280; `birthYear` ~182; `ScoreChips` ~1225; `fieldsForCategory`
  ~225; submit/post-create ~517-567), `app/src/utils/animal-birth-year.ts` (`birthYearToDate`),
  `app/src/utils/condition-stepper.ts` (a reusar), `app/app/maniobra/_components/CondicionCorporalStep.tsx`
  (lenguaje del stepper a compartir/replicar), `app/src/utils/event-input.ts` (CONDITION_SCORES).
- Migración: **ninguna** (`birth_date` ya es DATE; condición/opcionales ya existen). **Gate 1 N/A.**
- Regla UX de forms del proyecto (memoria `feedback_ux_basicos_sheets_forms`): validación = scroll-al-campo +
  borde rojo + error inline; título no se recorta; es-AR; tokens (sin hardcode); lineHeight matching.

## Aprobación
- **Puerta 0 — auto-aprobada bajo la instrucción de trabajo autónomo de Raf (2026-06-29).** Defaults del leader,
  a confirmar en **Puerta 2**. Fecha: 2026-06-29.
