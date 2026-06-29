# Spec 02 — Delta REFINAMIENTO DEL FORMULARIO DE ALTA (#3 / #13 / #14) — Requirements (EARS)

**Status**: `spec_ready` — delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`), **frontend puro**. El baseline NO se reescribe; este delta trae su propio set `{requirements,design,tasks}-alta-form-refinamiento.md`.
**Fecha**: 2026-06-29.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-alta-form-refinamiento.md` (Gate 0 **auto-aprobado** bajo la instrucción de trabajo autónomo de Raf, 2026-06-29 — defaults del leader, **se confirman en Puerta 2**). Las decisiones vienen lockeadas en ese contexto; acá NO se re-deciden, se traducen a EARS.
**Origen**: correcciones del testeo en vivo #3 (fecha dd/mm separada del año), #13 (condición corporal stepper), #14 (destildar opcionales). `docs/correcciones-prueba-en-vivo-2026-06-27.md`.
**Related**: `requirements-aptitud-reproductiva.md` (RAR.1 — prompt de aptitud en el paso 4, selector que este delta vuelve deseleccionable), `requirements-tier2-categorias.md` (RT2 — campos dinámicos por categoría del paso 4), spec 03 `requirements.md` (R6.6 — stepper de condición corporal de la maniobra, `condition-stepper.ts` / `CondicionCorporalStep`). ADR-028 (delta-spec), ADR-023 (tokens / sin hardcode), memoria `feedback_ux_basicos_sheets_forms` (MUSTs de forms), `reference_es_ar_number_format`.

> **Notación EARS** (`docs/specs.md`). **Numeración `RAF2.<n>`** ("Refinamiento Alta Form, spec 2") para no colisionar con `R<n>` (baseline), `RT2.<n>`, `RC6.<n>`, `RCUT.<n>`, `RPS.<n>`, `RAR.<n>`. IDs estables; cada `RAF2.<n>` verificable por ≥1 test.

---

## Resumen

Tres correcciones del testeo en vivo, **todas en el paso 4 del wizard de alta** (`app/app/crear-animal.tsx`) + utils puras, **sin tocar DB** (`animals.birth_date` ya es `DATE`; condición y opcionales ya existen → **Gate 1 N/A**):

1. **#3 — Fecha dd/mm separada del año.** Hoy la fecha de nacimiento es solo **año** (`birthYear`, `crear-animal.tsx:183`) → `birth_date` = midpoint `AAAA-07-01` (`birthYearToDate`, `animal-birth-year.ts:67`). Se agrega un campo **opcional día/mes (DD/MM)** separado: con DD/MM → fecha exacta; solo año → midpoint actual (no se rompe).
2. **#13 — Condición corporal stepper.** Hoy es `ScoreChips` (17 chips, `crear-animal.tsx:1251` uso / `:1333` definición). Se reemplaza por el **stepper +/−** del lenguaje de la maniobra, **reusando** `condition-stepper.ts` (sin duplicar aritmética).
3. **#14 — Destildar opcionales.** Hoy un opcional del paso 4 tocado por error no tiene afordancia de "quitar". Se agrega: re-tap deselecciona los selectores cerrados (`OptionRows`, `crear-animal.tsx:1384`), el stepper de condición es limpiable (distinguiendo "tocado" de "default 3,00"), y vaciar un input = "sin cargar". Lo "sin cargar" NO se envía a `create_animal`.

---

## RAF2.1 — Fecha de nacimiento: día/mes opcional separado del año (#3)

**RAF2.1.1** El sistema deberá conservar el campo "Año de nacimiento" del paso 4 (opcional, 4 dígitos AAAA, `sanitizeBirthYearInput` + `validateBirthYear`) sin cambios de comportamiento.

**RAF2.1.2** El sistema deberá ofrecer en el paso 4 un campo opcional adicional de **día y mes (DD/MM)**, con teclado numérico y orden día-primero (es-AR), separado del campo Año.

**RAF2.1.3** Cuando el usuario haya cargado un año válido **sin** día/mes, el sistema deberá fijar `birth_date` = `AAAA-07-01` (midpoint, comportamiento actual `birthYearToDate`).

**RAF2.1.4** Cuando el usuario haya cargado un año válido **y** un día/mes válidos, el sistema deberá fijar `birth_date` = la fecha exacta `AAAA-MM-DD`.

**RAF2.1.5** Si el usuario carga día/mes **sin** año, entonces el sistema deberá rechazar el alta y mostrar un error inline en el campo de día/mes (con scroll-al-campo y borde rojo), sin crear el animal (no hay fecha sin año).

**RAF2.1.6** Si el usuario carga el día/mes de forma **incompleta** (solo el día o solo el mes), entonces el sistema deberá rechazar el alta y mostrar el error inline (todo-o-nada: ambos o ninguno).

**RAF2.1.7** Si el día o el mes están **fuera de rango** (mes ∉ 1–12; día ∉ 1–últimoDíaDelMes; 00/00; 31/02; 31 en un mes de 30; etc.), entonces el sistema deberá rechazar el alta y mostrar el error inline, **sin clamp silencioso**.

**RAF2.1.8** Si la fecha indicada es **29/02 de un año no bisiesto**, entonces el sistema deberá rechazar el alta y mostrar el error inline (no clamp silencioso al 28/02 ni al 01/03).

**RAF2.1.9** Si el año más el día/mes forman una **fecha futura**, entonces el sistema deberá rechazar el alta y mostrar el error inline. *(Decisión de criterio propio del leader — extiende a la fecha exacta el "año no futuro" que ya aplica `validateBirthYear`; a confirmar en Puerta 2, ver `design` §Decisiones de criterio propio.)*

**RAF2.1.10** El sistema deberá proveer una **util pura nueva** en `animal-birth-year.ts` que, dado el año y el día/mes crudos, devuelva la fecha exacta ISO `AAAA-MM-DD` o un resultado de error de validación, cubriendo los bordes de día/mes (RAF2.1.6–2.1.8), el año bisiesto y el caso año-solo (RAF2.1.3), **sin duplicar** la aritmética de `birthYearToDate` (que queda intacto).

**RAF2.1.11** El sistema deberá **sanitizar en vivo** el input de día/mes a solo dígitos en orden día-primero con separador "/" (prevenir-no-errorear), mediante una función pura nueva.

## RAF2.2 — Condición corporal: stepper +/− (#13)

**RAF2.2.1** El sistema deberá reemplazar el selector de chips (`ScoreChips`) de condición corporal del paso 4 por un **stepper +/− con valor hero**, con el lenguaje visual del stepper de la maniobra (`CondicionCorporalStep`).

**RAF2.2.2** El stepper de condición corporal del alta deberá **reusar la util pura `condition-stepper.ts`** (clamp/snap a la grilla de 0,25, incremento/decremento, formato es-AR) **sin duplicar** su aritmética.

**RAF2.2.3** El stepper deberá operar en el rango **1,00–5,00 con paso 0,25** y mostrar el valor con **coma decimal y dos decimales fijos** (`formatScoreAR`, es-AR).

**RAF2.2.4** El sistema deberá deshabilitar el botón − en el piso **1,00** (`isScoreAtMin`) y el botón + en el tope **5,00** (`isScoreAtMax`).

**RAF2.2.5** El valor hero del stepper deberá renderizarse **sin recortarse ni truncarse** (full-width, `lineHeight` matcheado al `fontSize` — regla anti-recorte de descendentes).

**RAF2.2.6** El sistema deberá presentar el stepper reusando aritmética, tokens y labels de la maniobra, ya sea mediante un **componente compartido** entre maniobra y alta o —si el layout full-screen de la maniobra no encaja en el scroll del paso 4— mediante una **versión compacta embebida** (decisión de layout del implementer; la aritmética/tokens/labels se conservan).

## RAF2.3 — Destildar / quitar los opcionales del paso 4 (#14)

**RAF2.3.1** Cuando el usuario **re-toque la opción ya seleccionada** de un selector cerrado **opcional** del paso 4 (dientes, estado de preñez, cría al pie, aptitud de vaquillona), el sistema deberá deseleccionarla y volver el campo a **"sin cargar"**.

**RAF2.3.2** El sistema deberá proveer una **afordancia explícita** ("Sin cargar"/limpiar) para volver la condición corporal a "sin cargar" después de haberla tocado.

**RAF2.3.3** Mientras el usuario **no haya cargado explícitamente** la condición corporal, el sistema deberá tratarla como "sin cargar" (no enviarla), aunque el stepper muestre el valor de inicio **3,00** (distinguir "tocado" de "default").

**RAF2.3.4** Cuando el usuario **vacíe** un input opcional del paso 4 (raza —vía "Sin raza"—, pelaje, peso, día/mes), el sistema deberá tratar ese campo como "sin cargar".

**RAF2.3.5** El sistema **no deberá** enviar a `create_animal` ni a sus eventos post-create (condición, preñez, aptitud, custom) ningún campo opcional que haya quedado en **"sin cargar"** (NULL u omitido), igual que un campo nunca tocado.

**RAF2.3.6** El sistema **no deberá** volver deseleccionables los selectores **requeridos** del wizard (sexo del paso 2, rodeo del paso 1 con ≥2 rodeos, categoría del paso 3): el toggle de deselección deberá aplicar **solo** a los selectores opcionales del paso 4.

## RAF2.4 — Alcance, offline-first y MUSTs de UI de campo

**RAF2.4.1** El delta **no deberá** introducir migraciones, cambios de schema, RLS, triggers ni RPC: `birth_date` ya es `DATE` y la condición/los opcionales ya existen (**frontend puro, Gate 1 N/A**).

**RAF2.4.2** El sistema deberá conservar **sin cambios** el contrato de `createAnimal`, el find-or-create y el resto del wizard (identificadores, lote, propiedades custom, pasos 1–3).

**RAF2.4.3** El alta y todas las validaciones/sanitizers nuevos deberán funcionar **sin conexión** (lógica pura client-side; el create y los eventos post-create siguen el camino offline-safe actual).

**RAF2.4.4** El sistema deberá presentar **todo error de validación del paso 4** con **scroll-al-campo + borde rojo + indicación inline**, sin banner global que tape el título (MUST de forms del proyecto).

**RAF2.4.5** El sistema deberá usar **solo tokens** del design system (sin hex/px hardcodeado, ADR-023 §4), **es-AR** (coma decimal) y `lineHeight` matcheado en todo heading y todo texto con `numberOfLines`.

---

## Trazabilidad context → requirements

Cada "Caso y decisión" del `context-alta-form-refinamiento.md` queda cubierto por ≥1 `RAF2.<n>`:

| Caso/decisión del `context.md` | Requirement(s) |
|---|---|
| #3 — campo Año se mantiene; DD/MM separado, opcional, es-AR día-primero | RAF2.1.1, RAF2.1.2, RAF2.1.11 |
| #3 — DD/MM → fecha exacta; solo año → midpoint (no romper) | RAF2.1.3, RAF2.1.4 |
| #3 — validación todo-o-nada, requiere año, día/mes válidos, 29/02 no bisiesto inválido | RAF2.1.5, RAF2.1.6, RAF2.1.7, RAF2.1.8 |
| #3 — error inline + scroll-al-campo + borde rojo | RAF2.1.5–2.1.8, RAF2.4.4 |
| #3 — extender `birthYearToDate` con util pura nueva (bordes/bisiesto/año-solo) | RAF2.1.10 |
| #13 — reemplazar `ScoreChips` por stepper +/− reusando `condition-stepper.ts` | RAF2.2.1, RAF2.2.2, RAF2.2.3, RAF2.2.4 |
| #13 — extraer a componente compartido o versión compacta embebida | RAF2.2.6 |
| #13 — conservar aritmética/tokens/coma es-AR/default 3,00; valor no se recorta | RAF2.2.3, RAF2.2.5, RAF2.3.3 |
| #14 — selectores cerrados: re-tap deselecciona (dientes/preñez/cría/aptitud) | RAF2.3.1 |
| #14 — stepper condición limpiable; distinguir "tocado" de "default 3,00" | RAF2.3.2, RAF2.3.3 |
| #14 — inputs (raza/pelaje/peso/dd-mm) vaciar = sin-cargar | RAF2.3.4 |
| #14 — lo "sin cargar" NO se envía a `create_animal` (NULL) | RAF2.3.5 |
| #14 — no romper los selectores requeridos (sexo/rodeo/categoría) | RAF2.3.6 |
| Restricción — sin migración, Gate 1 N/A | RAF2.4.1 |
| Insumos — offline-first + MUSTs de forms (es-AR, tokens, lineHeight) | RAF2.4.3, RAF2.4.4, RAF2.4.5 |
| Alcance — no regresión del resto del wizard / `createAnimal` | RAF2.4.2 |

---

## Historial de refinamiento

- 2026-06-29 — Redacción inicial del delta (Gate 0 auto-aprobado bajo la instrucción de trabajo autónomo de Raf; defaults del leader, a confirmar en Puerta 2). Decisiones de criterio propio del `spec_author` elevadas a Puerta 2 (detalle en `design-alta-form-refinamiento.md` §Decisiones de criterio propio): (a) RAF2.1.9 — rechazar fecha exacta futura (extiende el "año no futuro" a la fecha completa); (b) RAF2.2.6 — extraer un stepper presentacional compartido (preferido) vs. versión compacta duplicada; (c) RAF2.3.2/2.3.3 — el stepper arranca "sin cargar" mostrando 3,00 atenuado y el primer toque a −/+ lo marca cargado; "Sin cargar" lo limpia (cargar exactamente 3,00 = +/− o −/+); (d) RAF2.4.4 — extender el scroll-al-campo (hoy ausente) también a los errores existentes de año y peso, por coherencia con el MUST del proyecto.
