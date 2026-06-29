# Spec 02 — Delta APTITUD REPRODUCTIVA + estado reproductivo visible — Requirements (EARS)

**Status**: `spec_ready` — delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`), con un slice de spec 03 (aplicabilidad de inseminación). El baseline NO se reescribe; este delta trae su propio set.
**Fecha**: 2026-06-29.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-aptitud-reproductiva.md` (Gate 0 aprobado por Raf, 2026-06-29). Las 6 decisiones + edge cases vienen lockeados — acá NO se re-deciden, se traducen a EARS.
**Origen**: correcciones del testeo en vivo #6 (prompt de aptitud en el alta), #1b (inseminación solo a hembra apta), #5 (estado reproductivo visible). `docs/correcciones-prueba-en-vivo-2026-06-27.md`.
**Related**: `requirements-c6-categoria-espejo.md` (RC6 — patrón de espejo client-side display-only que este delta replica), `requirements-cut-ficha.md` (RCUT — `is_cut`/badge CUT), `requirements-puesta-en-servicio.md` (RPS.5 — denominador de servidas, `0105`, NO se toca), spec 03 `requirements.md` (R6.3 tacto vaquillona, R6.5 inseminación). ADR-028 (delta-spec), ADR-008 (categorías), ADR-021 (gating por rodeo), ADR-023 (tokens / sin hardcode).

> **Notación EARS** (`docs/specs.md`). **Numeración `RAR.<n>`** ("Aptitud Reproductiva") para no colisionar con `R<n>` (base), `RT2.<n>`, `RC6.<n>`, `RCUT.<n>`, `RPS.<n>`. IDs estables; cada `RAR.<n>` verificable por ≥1 test.

---

## Resumen

La aptitud reproductiva de la vaquillona **ya existe en el backend** (`heifer_fitness` ∈ apta/no_apta/diferida, columna de `reproductive_events` cuando `event_type='tacto_vaquillona'`, migración `0053`) y el denominador de servidas (`0105`) **ya gatea por ella en vivo**. Faltaba: (1) capturarla en el **alta** de una vaquillona; (2) **mostrar** el estado reproductivo (aptitud + preñez) en lista y ficha — hoy solo vive en el timeline; (3) que la **inseminación** no se ofrezca a machos / hembras no aptas. Todo se deriva de eventos existentes (sin columna nueva), se computa **client-side, display-only** (patrón espejo C6) y es **consistente con `0105`** (no lo contradice ni lo modifica).

---

## RAR.1 — Alta: prompt de aptitud para vaquillona (decisión 1, 2)

**RAR.1.1** Cuando el usuario elija la categoría `vaquillona` en el alta guiada (paso 3, `crear-animal.tsx`), el sistema deberá ofrecer en el paso 4 un prompt de aptitud reproductiva con exactamente tres opciones es-AR: **"Sí, apta"** / **"Aún no sé"** / **"No es apta"**, reusando el lenguaje visual de `TactoVaquillonaStep` (apta=verde, diferida=ámbar, no apta=terracota).

**RAR.1.2** Mientras la categoría elegida en el alta NO sea `vaquillona`, el sistema no deberá mostrar el prompt de aptitud (gateado por categoría, igual que el resto de los campos extra del paso 4).

**RAR.1.3** Cuando el usuario complete el alta de una vaquillona habiendo seleccionado una opción de aptitud, el sistema deberá crear —post-create, con el patrón soft-fail existente— un evento `reproductive_events` con `event_type='tacto_vaquillona'` y `heifer_fitness` = `apta` ("Sí, apta") / `diferida` ("Aún no sé") / `no_apta` ("No es apta").

**RAR.1.4** El prompt de aptitud deberá ser **opcional**: si el usuario no elige ninguna opción, el sistema deberá crear el animal sin evento de aptitud (no bloquea el alta), igual que los demás campos extra (condición/preñez).

**RAR.1.5** Si `createAnimal` tuvo éxito pero la creación del evento de aptitud falla, entonces el sistema deberá conservar el animal creado y avisar de forma suave (mismo patrón soft-fail que condición/preñez), sin perder el alta ni re-crear el animal.

**RAR.1.6** El evento `tacto_vaquillona` con `heifer_fitness='diferida'` creado por el alta ("Aún no sé") deberá **excluir** a la vaquillona del conjunto de servidas de `rodeo_serviced_females` (`0105`) **aunque** tenga edad de servicio (el veredicto explícito gana sobre el fallback de edad — decisión 2). *(Verificable contra la función `0105` existente; el denominador NO se modifica — RAR.7.1.)*

## RAR.2 — Espejo client-side de estado reproductivo vigente (decisión 5, insumo §4)

**RAR.2.1** El sistema deberá proveer una función **pura** que derive la **aptitud reproductiva vigente** de una hembra a partir de su último evento `tacto_vaquillona` no borrado, eligiendo el "último" por la tupla `(event_date, created_at)` con la semántica null-as-newest de RC6.1.4: `apta` / `no_apta` / `diferida`, o `null` si no hay veredicto.

**RAR.2.2** El sistema deberá derivar el **estado reproductivo unificado** (single-slot) **reutilizando** `deriveCurrentState` (`event-timeline.ts`) para el eje de preñez —sin reimplementarlo— y componiéndolo con la aptitud (RAR.2.1), el `is_cut`, la categoría guardada y la evidencia de servicio.

**RAR.2.3** La derivación deberá ser **sin red** (todos los inputs del SQLite local) y **sin escritura** (display-only), análoga al espejo de categoría C6.

**RAR.2.4** El estado unificado deberá resolverse a **un único slot** por hembra, en este orden de precedencia (load-bearing):

- **RAR.2.4.1** Si el animal es macho **o** de categoría `ternera`, entonces el estado deberá ser **"sin estado"** (no aplica — no se muestra badge).
- **RAR.2.4.2** Mientras el animal tenga `is_cut = true`, el estado deberá ser **"No apta"** (CUT — decisión 4), sin leer columna de flag aparte de `is_cut`.
- **RAR.2.4.3** Mientras `deriveCurrentState` determine preñez (tacto con tamaño / parto / aborto), el estado deberá ser **"Preñada"** (preñada) o **"Vacía"** (vacía).
- **RAR.2.4.4** Si no hay preñez determinada pero el animal está en categoría probada (`vaquillona_prenada` / `vaca_segundo_servicio` / `multipara` / `vaca_cabana`) **o** tiene un evento `service` no borrado, entonces el estado deberá ser **"Servida sin tacto"**.
- **RAR.2.4.5** Si no aplica lo anterior y la categoría es `vaquillona` con veredicto de aptitud vigente, entonces el estado deberá ser **"Apta"** / **"Diferida"** / **"No apta"** según `heifer_fitness`.
- **RAR.2.4.6** En cualquier otro caso (hembra sin preñez, sin servicio y sin veredicto de aptitud), el estado deberá ser **"Sin evaluar"**.

## RAR.3 — Badge ÚNICO en la lista (decisión 3)

**RAR.3.1** Mientras una hembra tenga un estado reproductivo derivado distinto de "sin estado", la fila de la lista (`AnimalRow`, vista normal de la tab Animales) deberá mostrar **un único** chip con la etiqueta es-AR del estado.

**RAR.3.2** Mientras el animal sea macho o de categoría `ternera`, la lista no deberá mostrar chip de estado reproductivo (RAR.2.4.1).

**RAR.3.3** La lista no deberá mostrar **más de un** chip de estado reproductivo por animal (single-slot — nunca aptitud y preñez a la vez).

**RAR.3.4** El chip deberá usar estas etiquetas es-AR: `apta`→"Apta", `diferida`→"Diferida", `no_apta`/CUT→"No apta", preñada→"Preñada", vacía→"Vacía", servida-sin-tacto→"Servida sin tacto", sin-evaluar→"Sin evaluar".

## RAR.4 — Estado reproductivo desglosado en la ficha (decisión 3)

**RAR.4.1** En la ficha de una hembra, el sistema deberá mostrar la **aptitud reproductiva vigente** (Apta / Diferida / No apta / Sin evaluar) en una fila propia de la sección "Estado actual", cuando la aptitud aplique a su fase (vaquillona con o sin veredicto). Para hembras adultas probadas (sin eje de aptitud) la fila de aptitud podrá omitirse.

**RAR.4.2** En la ficha de una hembra, el sistema deberá mostrar el **estado de preñez/servicio** en la fila "Estado reproductivo": "Preñada" / "Vacía" / "Servida sin tacto" / "Sin registrar" (extiende la fila actual, que hoy solo muestra preñez).

**RAR.4.3** Para un macho, la ficha no deberá mostrar filas de aptitud ni de estado reproductivo (paridad con la regla actual solo-hembras de la sección "Estado actual").

**RAR.4.4** La ficha deberá conservar el **timeline** (auditoría completa) sin cambios de contrato; el desglose de RAR.4.1/RAR.4.2 es adicional, no lo reemplaza.

## RAR.5 — Presentación del badge (UI de campo — MUSTs)

**RAR.5.1** El chip/fila de estado reproductivo deberá usar **solo tokens** de `tamagui.config.ts` (sin hex/px hardcodeado, ADR-023 §4), en tres tiers visuales: **verde** (`$greenLight`/`$primary`) para Apta y Preñada; **ámbar** (`$amber` sobre `$surface`, outline) para Diferida y Vacía; **neutro** (`$textMuted`/`$divider` sobre `$surface`, outline) para Servida sin tacto, No apta y CUT.

**RAR.5.2** El estado deberá comunicarse por **texto** además del color (el color es señal adicional, no la única — accesibilidad/daltonismo), con `lineHeight` matcheado al `fontSize` (regla anti-recorte de descendentes).

**RAR.5.3** El chip deberá llevar `accessibilityLabel` es-AR vía helper (`labelA11y`), no crudo (un `View` de Tamagui no mapea `accessibilityLabel` a `aria-label` en web).

**RAR.5.4** El chip es **display** (no tappable) y no deberá reducir el target de la fila (`AnimalRow` ≥72px normal / ≥56px compacto se conservan).

## RAR.6 — Inseminación: aplicabilidad hembra + apta (decisión 3 / corrección #1b)

**RAR.6.1** El sistema deberá extender `AnimalApplicabilityInfo` (`maneuver-applicability.ts`) con la **aptitud reproductiva vigente** del animal (derivada del último `tacto_vaquillona`, RAR.2.1) **y su edad** (de `birth_date`, para el fallback de edad de RAR.6.2), provistas por el caller desde el espejo/datos locales.

**RAR.6.2** `appliesToAnimal('inseminacion', animal)` deberá devolver `true` **SSI** el animal es hembra **Y** reproductivamente apta, donde "apta" = categoría probada (`vaquillona_prenada`/`vaca_segundo_servicio`/`multipara`/`vaca_cabana`) **o** `vaquillona` con último `heifer_fitness='apta'` **o** `vaquillona` **sin veredicto** de aptitud con **edad de servicio ≥365 días** (fallback de edad, **consistente con `0105`** — decisión de Raf en Puerta 1, 2026-06-29).

**RAR.6.3** `appliesToAnimal('inseminacion', animal)` deberá devolver `false` para **machos** (cierra la corrección #1b: hoy cae a `default: return true` y deja inseminar machos).

**RAR.6.4** `appliesToAnimal('inseminacion', animal)` deberá devolver `false` para la categoría `ternera`.

**RAR.6.5** `appliesToAnimal('inseminacion', animal)` deberá devolver `false` para una `vaquillona` con `heifer_fitness` `no_apta` o `diferida`. Para una `vaquillona` **sin veredicto** de aptitud, deberá devolver `true` si su edad es **≥365 días** (fallback de edad, RAR.6.2) y `false` si es menor (o si no hay `birth_date`). Así la aplicabilidad de inseminación queda **alineada con la elegibilidad de servidas de `0105`** (decisión de Raf en Puerta 1).

**RAR.6.6** `appliesToAnimal('inseminacion', animal)` deberá devolver `false` para un animal CUT (categoría `cut`).

**RAR.6.7** El fix deberá ser **client-side** (igual que el resto del gating per-animal de `maneuver-applicability.ts`); este delta **no** introduce guard server-side de macho en servicio/inseminación (excluido — `docs/backlog.md`, decisión 5).

## RAR.7 — Consistencia con `0105` y edge cases (decisión 6, edge cases)

**RAR.7.1** El sistema **no deberá** modificar `rodeo_serviced_females` / `rodeo_repro_denominator` / `rodeo_service_campaign` (`0105`) ni el denominador de servidas/entoradas.

**RAR.7.2** La derivación del badge (RAR.2) **no deberá** contradecir la elegibilidad de `0105`: una vaquillona `apta` se trata como apta/servible; `no_apta`/`diferida` no; CUT queda fuera (No apta).

**RAR.7.3** El fallback de edad de `0105` (vaquillona ≥365 d sin veredicto → servida) se **mantiene** tal cual en el denominador (decisión 6); el badge no lo modifica.

**RAR.7.4** Para una hembra `apta` que pasa a tener evento `service` y luego un tacto, el badge deberá transicionar en **un solo slot**: "Apta" → "Servida sin tacto" → "Vacía"/"Preñada" (RAR.2.4 secuencial).

**RAR.7.5** El sistema **no deberá** marcar `is_cut` automáticamente cuando una hembra resulte `no_apta` (son ejes distintos: `no_apta` = reproductivo, CUT = descarte); el badge muestra "No apta" sin tocar `is_cut`.

**RAR.7.6** Cuando un animal deje de ser CUT (un-CUT, `is_cut=false`), el badge deberá volver a reflejar su estado derivado vigente (aptitud / preñez / servicio), sin columna de flag.

## RAR.8 — No-write, offline-first y anti-drift

**RAR.8.1** La derivación del estado y el badge **no deberán** escribir nada (ni `category_id`, ni eventos, ni overlay `pending_*`, ni reconciliación): display-only (consistente con RC6.3.5).

**RAR.8.2** La **única** escritura del delta deberá ser el evento `tacto_vaquillona` del alta (RAR.1.3), por CRUD plano local **offline-safe** (mismo camino que `addTacto`; éxito local inmediato, RLS al subir). El alta y el badge deberán funcionar sin conexión.

**RAR.8.3** El módulo del espejo deberá llevar en su header una **nota anti-drift**: cualquier cambio a la elegibilidad de `0105` o al enum `heifer_fitness` (`0053`) actualiza este espejo + sus fixtures (espeja RC6.5.1).

---

## Trazabilidad context → requirements

| Caso/decisión del `context.md` | Requirement(s) |
|---|---|
| 1 — Aptitud DERIVADA, alta crea `tacto_vaquillona` | RAR.1.1–1.5, RAR.2.1, RAR.8.2 |
| 2 — "Aún no sé" = `diferida`, no servida hasta apta real | RAR.1.3, RAR.1.6, RAR.7.3 |
| 3 — Un badge en lista, desglosado en ficha; fases | RAR.2.4, RAR.3, RAR.4, RAR.5 |
| 3 — Inseminación = hembra + apta | RAR.6 |
| 4 — CUT → "No apta" | RAR.2.4.2, RAR.3.4 |
| 5 — Fix inseminación client-side, guard server-side a backlog | RAR.6.2, RAR.6.7 |
| 6 — Fallback de edad se mantiene | RAR.7.3 |
| Edge: apta→servida→vacía (un solo slot) | RAR.2.4, RAR.7.4 |
| Edge: diferida→apta entra a servidas en vivo (`0105`) | RAR.7.1, RAR.7.2 |
| Edge: un-CUT vuelve a su derivado | RAR.7.6 |
| Edge: `no_apta` ≠ CUT automático | RAR.7.5 |
| Espejo client-side de aptitud vigente (insumo §4) | RAR.2 |

---

## Historial de refinamiento

- 2026-06-29 — redacción inicial del delta (Gate 0 aprobado por Raf 2026-06-29). Decisiones de criterio propio del `spec_author` elevadas a Puerta 1 (detalle en `design-aptitud-reproductiva.md` §Decisiones de criterio propio): (a) colores del badge en 3 tiers semánticos; (b) "No apta" en neutro/gris (no terracota) para no saturar la lista de alertas; (c) etiqueta "Sin evaluar" para la vaquillona sin veredicto; (d) inseminación NO aplica el fallback de edad (estricto a "apta/probada").
- 2026-06-29 — **Puerta 1 aprobada por Raf**, con UN cambio: (d) **revertida** → la inseminación **SÍ aplica el fallback de edad** (vaquillona ≥365 d sin veredicto = inseminable, alineada con `0105`). RAR.6.1/6.2/6.5 + `design` §2/§6/§10 reconciliados. (a)/(b)/(c) avaladas por el leader y aceptadas. Resto del delta sin cambios.
