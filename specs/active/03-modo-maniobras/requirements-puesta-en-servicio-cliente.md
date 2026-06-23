# Spec 03 — Stream B: puesta en servicio (cliente / manga) — Requirements (EARS)

**Status**: `spec_ready` (frontend; **Gate 1 N/A** salvo que algo reabra schema/RLS/Edge — ver design §0; **Gate 2 por chunk**). Delta de cliente sobre spec 03 base; **consume** el backend de Stream A (spec 02 delta `RPS.x`, migraciones `0102`–`0105`, ya as-built/deployado). **No** reabre `requirements.md` base de spec 03 ni las deltas previas (M5/M6/M7).
**Fecha**: 2026-06-23 (sesión de cierre del modelo reproductivo, Stream B).
**Autor**: spec_author.
**Fuente de verdad**: `docs/modelo-reproductivo-puesta-en-servicio.md` (Gate 0 aprobado por Raf/Facundo, Puerta 1 2026-06-23) — §3 (aptitud), §4 (CCL: buckets por nº de meses de servicio + tacto configurable), §6 (selector de 12 meses), §8 (Stream B scope), §9 (pendientes de Facundo = defaults provisionales). El **dominio** viene **firme** de ese doc; acá **no se re-decide** — se aterriza el CÓMO (UX + plomería) a nivel spec.
**Stream A consumido (as-built, NO se toca)**: `specs/active/02-modelo-animal/{requirements,design}-puesta-en-servicio.md` (`RPS.x`); columna `rodeos.service_months smallint[]` (`0102`); RPC `create_rodeo(... p_service_months smallint[])` (`0103`); RPC `set_rodeo_service_months(p_rodeo_id, p_service_months)` (`0103`); enum `heifer_fitness_result('apta','no_apta','diferida')` (`0053`); `compute_category` ya **sin** `service` (`0104`); contrato de derivación `rodeo_serviced_females`/`rodeo_repro_denominator`/`rodeo_service_campaign` (`0105`, lo consume Stream C, no este delta).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". **IDs estables, no reordenar tras aprobar. Cada `R<n>` verificable por ≥1 test.**

> **Numeración**: este delta usa el prefijo **`RPSC.x`** (Requirements Puesta en Servicio — Cliente) para **no colisionar** con la spec 03 base (`R1`..`R14`/US-x), ni con el delta backend de spec 02 (`RPS.x`). Toda referencia `R<n>`/`RPS.<n>` sin prefijo `RPSC` apunta a esas specs.

---

## Resumen del delta

El Gate 0 movió el **servicio natural a nivel rodeo** (qué meses hace servicio cada rodeo) y separó **categoría** de **elegibilidad reproductiva**. Stream A entregó el backend (schema + RPC + reescritura de `compute_category` + contrato de derivación). Stream B es el **frontend que lo pone en servicio**, en cuatro piezas decomponibles:

1. **B1 — Selector de 12 meses en el wizard de alta/edición de rodeo de cría** (consume `create_rodeo(p_service_months)` y `set_rodeo_service_months`). Touchpoint **cross-spec: el wizard de rodeo vive en spec 02 C1** (`crear-rodeo.tsx` / `editar-plantilla.tsx` / `rodeos.ts`); este delta lo extiende.
2. **B2 — Tacto de preñez configurable** ("¿medir tamaño? sí/no" con default derivado del rodeo) + `TactoStep` adapta cuántos botones de tamaño muestra según el nº de meses de servicio (regla de buckets CCL del Gate 0 §4).
3. **B3 — Baja de la carga manual per-vaca de "servicio natural"** (el servicio natural es ahora nivel-rodeo). **La inseminación (IA/IATF) NO se toca** (sigue per-vaca, `service_type='ai'`). Los eventos `service` históricos quedan en el timeline.
4. **B4 — Slice del espejo client-side** (RPS.7.4, **URGENTE** — cierra el drift vivo): quitar `hasService` de la rama `vaquillona` de `computeCategoryCode` (`animal-category.ts`) para que el espejo == `compute_category` server (que ya no usa service). Touchpoint **cross-spec: el espejo vive en spec 02 C6** (`animal-category.ts` / `animal-category.test.ts`); este delta lo alinea + el preview offline (R8.4, spec 03) que depende de él.

**Decisiones del Gate 0 que NO se re-discuten** (cerradas por Raf/Facundo): servicio = nivel rodeo; categoría ≠ elegibilidad; default de campaña = primavera (Oct/Nov/Dic) pre-tildado; regla de buckets CCL por nº de meses (1 mes → preñada/vacía; 2 → cabeza/cola; 3 → cabeza/cuerpo/cola; 4–12 → tercios; 12 → preñada/vacía); aptitud = veredicto del vet (APTA/NO_APTA/DIFERIDA, sin cálculo de 66%).

**Marca `[TENTATIVO]` (Gate 0 §9 — espera input de Facundo a la universidad):** el bucketing CCL de 4–12 meses (tercios), el override "sin distinción", y la política de tacto de rodeos de 12 meses son **defaults provisionales del Gate 0**. Se implementan como tales; un cambio de Facundo entra como reconciliación de esta spec (preservando los IDs `RPSC.x`), no reabre el modelo.

---

## RPSC.1 — B4: alinear el espejo client-side de categoría (URGENTE — cierra el drift vivo)

> Gate 0 §2 / RPS.4.1 / RPS.7.4. **Es el chunk más chico y va PRIMERO**: hoy `compute_category` server (`0104`, aplicado) ya **no** usa `service`, pero el espejo cliente `computeCategoryCode` (`app/src/utils/animal-category.ts`, C6) **sí** usa `hasService` en su rama `vaquillona` (líneas 261/269) → una ternera-con-servicio/IA muestra `vaquillona` en el cliente y `ternera` en el server = **drift display-only vivo**. Cierra la invariante anti-drift RC6.5 (espejo == server).

**RPSC.1.1** El sistema **no** deberá usar la existencia de un evento `service` para computar `vaquillona` en el espejo client-side `computeCategoryCode` (`app/src/utils/animal-category.ts`): la rama `vaquillona` deberá dejar de evaluar `hasService` (eliminar el término del `if` de la rama hembra), espejando exactamente la reescritura server-side `compute_category` (`0104`, RPS.4.1).

**RPSC.1.2** El sistema deberá conservar en `computeCategoryCode` la transición a `vaquillona` por **destete** (`hasWeaning`) y por **corte de edad** (edad ≥ 365 días con `birthDate` conocido): tras quitar `service`, una hembra con destete, o de ≥ 1 año con fecha conocida, deberá seguir computando `vaquillona` (espejo de RPS.4.2).

**RPSC.1.3** El sistema deberá conservar **sin cambios** en `computeCategoryCode` las ramas que NO dependen de `service`: el conteo de partos (`multipara`, `vaca_segundo_servicio`), el tacto+ vigente (`vaquillona_prenada`), la rama macho completa, los cortes de edad 1/2 años, y la **precedencia LOAD-BEARING** de ramas (no reordenar). El contrato de retorno (`MirrorCategoryCode`) **no** deberá cambiar (espejo de RPS.4.3).

**RPSC.1.4** El sistema deberá actualizar la suite del espejo (`app/src/utils/animal-category.test.ts`) para reflejar el nuevo contrato: los casos que hoy afirman **`ternera <1 año + service → vaquillona`** (T2.23, líneas ~261/264) deberán pasar a afirmar que un `service` **NO** promueve por sí solo (una ternera <1 año con solo `service` y sin destete computa **`ternera`**; una vaquillona ya vaquillona por edad/destete sigue `vaquillona`). Los casos que combinan `service` con un evento dominante (parto/tacto+) deberán seguir dando el mismo resultado (el evento dominante manda) — solo se verifica que `service` ya no es el disparador.

**RPSC.1.5** El sistema deberá alinear el **preview de transición offline** (`app/src/utils/maneuver-category-preview.ts`, spec 03 R8.4), que reusa `computeCategoryCode`: tras RPSC.1.1, una **inseminación** capturada en la manga sobre una `ternera` **no** deberá anticipar una transición a `vaquillona` (hoy `capturedReproEvents` mapea `kind:'inseminacion'` → evento `service` que promovía; y `syntheticEventsForFemaleCategory('vaquillona')` reconstruye con `[service]`). El preview deberá quedar consistente con lo que el server computará (categoría ≠ elegibilidad, RPS.4.8): la IA registra la servida (Stream C), no cambia la categoría. La suite `maneuver-category-preview.test.ts` deberá actualizarse en consecuencia (el caso "ternera + inseminación → vaquillona" deja de aplicar).

**RPSC.1.6** El sistema **no** deberá quitar el `event_type='service'` del conjunto de tipos que el espejo LEE del SQLite (`MIRROR_EVENT_TYPES` en `local-reads.ts`): el `service` se sigue trayendo (un `service`/IA histórico es un evento del timeline y el espejo debe poder verlo), solo que ya **no** influye en el `code` computado (RPSC.1.1). Quitar el tipo de la query es innecesario y arriesga el timeline; el cambio es **solo** en la lógica de `computeCategoryCode`.

**RPSC.1.7** El sistema deberá actualizar la **nota de mantenimiento anti-drift** del header de `animal-category.ts` (RC6.5.1) para reflejar que `compute_category` ya **no** usa `service` (la migración espejada pasa de `0062` a `0104` en lo que toca la rama `vaquillona`), de modo que el comentario no quede mintiendo respecto del as-built server.

## RPSC.2 — B1: selector de 12 meses de servicio en el wizard de alta de rodeo de cría

> Gate 0 §6 + RPS.1.6 / RPS.3.1. **Touchpoint cross-spec: el wizard de alta vive en spec 02 C1** (`app/app/crear-rodeo.tsx` → `createRodeo` en `app/src/services/rodeos.ts` → outbox `enqueueCreateRodeo` → RPC `create_rodeo`). Este delta agrega un paso/sección de selección de meses que viaja por ese mismo camino offline (un parámetro `p_service_months` más). **Necesita design-spike + veto del leader** (UI nueva de wizard).

**RPSC.2.1** Cuando el operario crea un rodeo del sistema **cría** (wizard de alta), el sistema deberá ofrecer un **selector de los 12 meses** del año (1=enero … 12=diciembre) en el que marcar en qué meses ese rodeo hace servicio.

**RPSC.2.2** El sistema deberá pre-tildar, al abrir el selector en el alta, el **default de primavera** = octubre, noviembre y diciembre (`{10,11,12}`), para no friccionar el alta (caso dominante en cría, Gate 0 §6).

**RPSC.2.3** El sistema deberá permitir al operario **destildar y tildar** cualquiera de los 12 meses libremente (incluido el caso de **ninguno tildado** = el rodeo no hace servicio, y el caso de **los 12** = servicio continuo).

**RPSC.2.4** Cuando el operario confirma el alta del rodeo con el selector de meses, el sistema deberá enviar el conjunto de meses tildado como el parámetro `p_service_months` de la RPC `create_rodeo` (`0103`, RPS.3.1), por el **mismo camino offline** que el resto del alta (outbox `op_intents` + overlay optimista, sin requerir conexión).

**RPSC.2.5** Si el operario no toca el selector y confirma el alta, entonces el sistema deberá persistir el default de primavera `{10,11,12}` (consistente con RPSC.2.2; equivalente a omitir `p_service_months`, que el server defaultea a primavera — RPS.1.6).

**RPSC.2.6** El sistema deberá enviar `p_service_months` como un **array de enteros 1–12 únicos** (el shape `smallint[]` que la RPC espera, DD-PS-1): el cliente mapea los checkboxes tildados a ese array sin duplicados y dentro de rango.

**RPSC.2.7** El sistema **no** deberá bloquear el alta ni mostrar el alta como fallida cuando la escritura de `service_months` la rechaza el server (un no-owner que llegara a la pantalla, o un valor inválido): el rechazo lo resuelve el camino de outbox al subir (clasificación del error, rollback del overlay, superficie por el canal de status) — igual que el resto del alta de rodeo (RPS.3.3/RPS.3.5, patrón as-built de `createRodeo`). La barrera de UX es que solo el **owner** ve la gestión de rodeos (spec 02 C1).

## RPSC.3 — B1: ver y editar la config de servicio en rodeos existentes (offline)

> Gate 0 §6 ("Editable. Rodeos existentes sin config → invitar a configurar") + RPS.2 / RPS.3.2. **Touchpoint cross-spec: la edición de rodeo vive en spec 02 C1** (`app/app/editar-plantilla.tsx` / `rodeos.ts` / outbox). Stream A dejó los rodeos existentes con `service_months = NULL` ("sin configurar", RPS.2.1).

**RPSC.3.1** El sistema deberá ofrecer, para un rodeo de cría existente (owner), una superficie para **ver y editar** sus meses de servicio (el mismo selector de 12 meses de RPSC.2.1), accesible desde la gestión del rodeo (entrada en `rodeos.tsx` / pantalla de edición, junto a "Editar plantilla").

**RPSC.3.2** Mientras se edita un rodeo con `service_months = NULL` ("sin configurar"), el sistema deberá presentarlo como **"sin configurar"** (no como "no hace servicio"), distinguiéndolo de un conjunto vacío explícito, e **invitar a configurarlo** (Gate 0 §6/§7) — sin pre-tildar primavera por default en la EDICIÓN (a diferencia del alta: no se inventa una campaña que el productor no declaró, espejo de DD-PS-3; el operario elige explícitamente).

**RPSC.3.3** Cuando el operario guarda un cambio de meses de servicio de un rodeo existente, el sistema deberá invocar la RPC `set_rodeo_service_months(p_rodeo_id, p_service_months)` (`0103`, RPS.3.2) por el **camino de outbox** (mismo patrón que `set_rodeo_config`: intent `op_type='set_rodeo_service_months'` + overlay optimista sobre el rodeo), de modo que la edición funcione **offline** y se drene al reconectar.

**RPSC.3.4** El sistema deberá reflejar el cambio de meses de servicio **al instante y en el lugar** (actualización optimista, `conventions.md` §UI): la pantalla de edición muestra el nuevo conjunto sin re-fetch que parpadee; el server sigue siendo la verdad (la RPC re-valida y la fila real baja por la stream).

**RPSC.3.5** El sistema deberá garantizar que el camino de edición de meses es **idempotente** ante el at-least-once de la outbox: re-aplicar el mismo conjunto deja el rodeo igual (lo cubre la RPC `set_rodeo_service_months`, UPDATE idempotente — RPS.3.6; el cliente no necesita `client_op_id`).

**RPSC.3.6** Si el rodeo objetivo de la edición ya no existe / fue soft-deleteado (la RPC devuelve `P0002`), entonces el sistema deberá **revertir el overlay optimista** y descartar el intent (rechazo permanente), igual que el camino as-built de `set_rodeo_config` (`classifyIntentUploadError`, `permanent_reject`).

**RPSC.3.7** El sistema deberá **parsear** el valor de `service_months` que PowerSync materializa client-side como **TEXT/JSON** (PowerSync mapea el `smallint[]` de Postgres a una columna no-escalar → texto; nota de Stream A design §2): el cliente lee la columna del rodeo del SQLite local y la convierte a un array de números de forma **tolerante** (un valor null/ausente/corrupto → "sin configurar", no rompe la pantalla). **Dependencia anotada:** el schema de PowerSync (`app/src/services/powersync/schema.ts`, tabla `rodeos`) debe incluir `service_months` como columna `column.text` para que la lectura no falle (mismo cuidado que tuvo `impl_15` con columnas nuevas).

## RPSC.4 — B2: tacto de preñez configurable (¿medir tamaño? sí/no, default derivado del rodeo)

> Gate 0 §4 ("Tacto configurable: al elegir el tacto, un wizard pregunta '¿tamaño? sí/no'. El default se deriva de la config del rodeo. El operario puede override"). Patrón as-built `ManeuverConfigSheet` (spec 03 M1.4). **Necesita design-spike + veto del leader** (config nuevo de manga). **Toca solo la maniobra `tacto` (tacto de vaca); `tacto_vaquillona` —aptitud— NO se toca.**

**RPSC.4.1** Cuando el operario elige la maniobra de **tacto de preñez** (`tacto`) en el wizard de configuración de jornada, el sistema deberá ofrecer una preconfig de tanda que pregunte **"¿medir tamaño de preñez?"** con opción **sí / no** (patrón `ManeuverConfigSheet`, una decisión por pantalla, manga-friendly), y persistir esa elección en el `config` de la jornada (preconfig de la maniobra `tacto`).

**RPSC.4.2** El sistema deberá **derivar el default** de "¿medir tamaño?" de la config del **rodeo de la jornada** (`service_months`), según la regla del Gate 0 §4: si el rodeo tiene **2, 3 o 4–11 meses** de servicio (distinción de etapas posible) → default **SÍ**; si tiene **1 mes**, **12 meses**, **sin configurar (NULL)**, o **ninguno (vacío)** → default **NO**. El operario puede **override** el default en cualquier sentido.

**RPSC.4.3** El sistema deberá tratar la elección de "¿medir tamaño?" como **default de tanda** (precarga), no como un bloqueo: el operario puede cambiarla al configurar la jornada (RPSC.4.1) y la captura por animal respeta lo configurado (cuántos botones muestra `TactoStep`, RPSC.5).

**RPSC.4.4** Donde el rodeo de la jornada esté **sin configurar (`service_months = NULL`)**, el sistema deberá defaultear "¿medir tamaño?" a **NO** (RPSC.4.2) y **no** deberá frenar la jornada por eso (degradar con gracia, Gate 0 §7): se puede tactear preñada/vacía sin tamaño; el operario puede activar el tamaño manualmente si quiere.

**RPSC.4.5** El sistema deberá derivar el default sin re-implementar la regla de buckets en dos lugares: la decisión "¿este nº de meses admite distinción de tamaño?" deberá vivir en una **función pura** reutilizable (testeable con node:test, mismo patrón que `maneuver-config.ts`/`maneuver-gating.ts`) consumida tanto por el default del config (RPSC.4.2) como por el nº de botones de `TactoStep` (RPSC.5) — una sola fuente de verdad de la regla CCL del Gate 0 §4. [TENTATIVO en su parametrización fina — Gate 0 §9.]

## RPSC.5 — B2: `TactoStep` adapta los botones de tamaño según los meses de servicio del rodeo

> Gate 0 §4 (regla de buckets) + as-built `TactoStep.tsx` (spec 03 M2.2, sub-paso 2 de tamaño cabeza/cuerpo/cola → `large`/`medium`/`small`). El enum `pregnancy_status` (small/medium/large) **no cambia** (mapea 1:1, Gate 0 §4). **Necesita el veto del leader sobre el render** (botones gigantes manga, recorte de descendentes en "PREÑADA").

**RPSC.5.1** Mientras se captura el tacto de preñez de un animal con la maniobra `tacto`, el sistema deberá presentar siempre el sub-paso binario **PREÑADA / VACÍA** (sin cambio respecto del as-built): VACÍA persiste `pregnancy_status='empty'` y cierra la maniobra.

**RPSC.5.2** Cuando el operario marca **PREÑADA** y la jornada tiene "medir tamaño = NO" (RPSC.4) **o** el rodeo es de **1 mes** o **12 meses** de servicio, el sistema **no** deberá ofrecer el sub-paso de tamaño: deberá persistir la preñez **sin tamaño**. *(Reconciliación de modelo, ver RPSC.5.7: el enum no tiene un "preñada sin tamaño" — el valor persistido en este caso se fija en design §4.)*

**RPSC.5.3** Cuando el operario marca PREÑADA y corresponde medir tamaño en un rodeo de **2 meses** de servicio, el sistema deberá ofrecer **dos** botones de tamaño: **CABEZA** (`large`) y **COLA** (`small`) — sin "CUERPO" (Gate 0 §4: 2 meses → cabeza/cola).

**RPSC.5.4** Cuando el operario marca PREÑADA y corresponde medir tamaño en un rodeo de **3 meses** de servicio, el sistema deberá ofrecer **tres** botones de tamaño: **CABEZA** (`large`), **CUERPO** (`medium`) y **COLA** (`small`) (Gate 0 §4: 3 meses → tercios exactos).

**RPSC.5.5** Cuando el operario marca PREÑADA y corresponde medir tamaño en un rodeo de **4 a 11 meses** de servicio, el sistema deberá ofrecer **tres** botones de tamaño (CABEZA/CUERPO/COLA = `large`/`medium`/`small`), agrupando los meses en **tercios** (Gate 0 §4: 4–12 → tercios). [TENTATIVO — Gate 0 §9, espera la confirmación de Facundo sobre si los tercios son exactos para 4–11 meses.]

**RPSC.5.6** El sistema deberá mapear los botones de tamaño a `pregnancy_status` **1:1**: **CABEZA → `large`**, **CUERPO → `medium`**, **COLA → `small`** (Gate 0 §4 / as-built `PREGNANCY_SIZE_LABEL`: small=Cola, medium=Cuerpo, large=Cabeza). El sistema **no** deberá cambiar el enum ni el schema (RPS.4.x no tocó `pregnancy_status`).

**RPSC.5.7** El sistema deberá persistir el tacto como **un único `reproductive_events`** (`event_type='tacto'`, sin cambio respecto del as-built M2.2): no deberá persistir un tacto incompleto. El criterio de qué valor lleva una preñez **sin tamaño** (rodeos 1/12 meses o "medir tamaño = NO") se fija en design §4 (decisión del spec_author) y deberá quedar cubierto por un test.

**RPSC.5.8** El sistema deberá determinar el nº de botones de tamaño a partir del **nº de meses de servicio del rodeo de la jornada** (`array_length(service_months)`), usando la **misma función pura** de la regla de buckets de RPSC.4.5 (una sola fuente de verdad CCL), no una segunda implementación dentro del componente.

**RPSC.5.9** El sistema deberá preservar el **lenguaje visual aprobado** de `TactoStep` (bloques de decisión full-width que se reparten el alto del viewport, alto contraste, label gigante centrado, recorte de descendentes vetado en "PREÑADA"): los cambios de RPSC.5.3–RPSC.5.5 ajustan **cuántos** bloques de tamaño se muestran, **no** rediseñan el paso. El render de N bloques de tamaño deberá pasar por el **veto de diseño del leader** antes de mostrarse a Raf (botones gigantes, ADR-023, `reference_rn_web_pitfalls` — vetar en web táctil real).

## RPSC.6 — B3: baja de la carga manual per-vaca de "servicio natural"

> Gate 0 §1 + §8 Stream B ("sacar/deprecar la maniobra de servicio manual; la IA NO se toca; los eventos `service` históricos quedan en el timeline"). **As-built verificado por el spec_author**: la carga manual de servicio NO está en el wizard de MODO MANIOBRAS (el catálogo `ManeuverKind` no tiene `servicio`; la manga solo tiene `inseminacion`=IA). La carga manual **per-vaca** de servicio vive en la pantalla **"Agregar evento" de la ficha** (`app/app/agregar-evento.tsx`), con un selector cerrado `service_type ∈ {natural, ai, te}` (`SERVICE_TYPE_OPTIONS`).

**RPSC.6.1** El sistema **no** deberá ofrecer, en la pantalla "Agregar evento" de la ficha del animal (`agregar-evento.tsx`), la carga manual per-vaca de un **servicio de monta natural** (`service_type='natural'`): el servicio natural es ahora nivel-rodeo (derivado de `service_months`, Gate 0 §1) → cargarlo a mano por animal queda deprecado.

**RPSC.6.2** El sistema **no** deberá tocar la **inseminación (IA/IATF)**: la carga de inseminación de la manga (`InseminacionStep`, `service_type='ai'`) **deberá seguir funcionando idéntica** (per-vaca, dato real). La decisión sobre el `service_type='te'` (transferencia embrionaria) en la ficha se fija en design §6 (decisión del spec_author: mantener TE/IA como carga reproductiva real per-vaca; deprecar solo `natural`).

**RPSC.6.3** El sistema **no** deberá borrar ni alterar los eventos `service` **históricos** ya cargados (servicio natural manual de antes de este delta): deberán seguir visibles en el timeline del animal (`animal_timeline` / `fetchTimeline` no filtra por tipo) con su `service_type` enriquecido (espejo de RPS.4.5). La baja es de la **vía de carga nueva**, no de la historia.

**RPSC.6.4** El sistema deberá dejar **definido qué pasa con presets y secuencias de jornada** que tuvieran "servicio": como el servicio natural manual **nunca fue una `ManeuverKind`** del wizard (verificado: no existe `servicio` en el catálogo; solo `inseminacion`), **no hay** preset ni secuencia de jornada que cargue servicio natural a deprecar → ningún preset existente queda roto por RPSC.6. Este requirement deberá quedar documentado en design §6 (no es un cambio de código, es la constatación que cierra el alcance de B3).

**RPSC.6.5** Cuando RPSC.6.1 quite la opción de servicio natural de "Agregar evento", el sistema deberá actualizar las suites afectadas (el e2e `app/e2e/events.spec.ts` ejercita hoy la carga de un "Servicio (Monta natural)" desde la ficha) para reflejar el nuevo comportamiento (el flujo de monta natural manual ya no existe; IA/TE y el resto de los eventos reproductivos siguen).

**RPSC.6.6** El sistema **no** deberá alterar el **backend** en B3: la baja es **frontend puro** (quitar una vía de carga). No deberá tocar el enum `service_type`, la tabla `reproductive_events`, ni `addService`/`buildAddServiceInsert` de forma que rompa la IA/TE — solo se deja de **ofrecer** la opción `natural` desde la UI de la ficha (Gate 1 N/A, ver design §0).

## RPSC.7 — Aptitud de la vaquillona (verificación de contrato cliente — sin cambio)

> Gate 0 §3 ("MVP = solo el veredicto de aptitud: APTA / NO_APTA / DIFERIDA"). **As-built verificado**: la maniobra `tacto_vaquillona` (`TactoVaquillonaStep`) ya captura los 3 veredictos (`HeiferFitness = 'apta' | 'no_apta' | 'diferida'`, `maneuver-sequence.ts`) y los persiste a `reproductive_events.heifer_fitness` (enum `0053`). Este delta **verifica** que sigue intacta; **no** agrega captura de peso (POST-MVP, Gate 0 §3).

**RPSC.7.1** El sistema deberá conservar, en la maniobra `tacto_vaquillona`, la captura de los **tres** veredictos de aptitud — **APTA / NO_APTA / DIFERIDA** (`HeiferFitness`) — persistidos en `reproductive_events.heifer_fitness` (espejo cliente de RPS.6.1). Stream B **no** modifica este paso.

**RPSC.7.2** El sistema **no** deberá derivar ninguna transición de categoría del veredicto de aptitud en el cliente (la aptitud es elegibilidad reproductiva, gatea el denominador de Stream C, **no** categoría — RPS.6.3 / Gate 0 §2): el `TactoVaquillonaStep` registra el veredicto sin disparar un cambio de badge de categoría.

**RPSC.7.3** El sistema **no** deberá capturar el **peso objetivo / diferencial del 66%** en la maniobra de aptitud (POST-MVP, Gate 0 §3; en el MVP el vet ya pondera el peso al dar el veredicto). Este delta lo deja explícitamente **fuera de alcance** (no agrega un sub-paso de peso a `tacto_vaquillona`).

**RPSC.7.4** El **copy/ayuda** de los tres veredictos (si la UI los explica) deberá reflejar la semántica precisada por **Facundo (2026-06-23, Gate 0 §3)**: **DIFERIDA** = "todavía le falta, pero podrá ser apta más adelante" (transitoria, se re-evalúa — NO descarte); **NO_APTA** = "no lo será nunca" (descarte permanente). Si los labels/ayuda actuales ya lo transmiten, no se cambia; si no, alinear (cambio de copy, no de flujo). El **hook NO_APTA → sugerir descarte/CUT** queda **POST-MVP** (fuera de alcance de Stream B; se conecta con la feature CUT de spec 02 más adelante).

## RPSC.8 — Multi-tenant, offline-first y reconciliación (transversal)

**RPSC.8.1** El sistema deberá mantener el aislamiento **multi-tenant** en todo el delta: la escritura de `service_months` (B1) va por las RPC owner-only de Stream A (la barrera real es server-side, RPS.3.3/RPS.3.4); el cliente nunca hardcodea `establishment_id` (lo deriva del contexto activo / la RPC lo deriva del rodeo). La UI de gestión de rodeos solo la ve el **owner** (spec 02 C1).

**RPSC.8.2** El sistema deberá garantizar que toda escritura de B1 (alta y edición de `service_months`) funciona **offline-first** (`CLAUDE.md` ppio 3): se encola y aplica al reconectar, con overlay optimista y clasificación de rechazos (espejo del camino as-built de `createRodeo`/`set_rodeo_config`).

**RPSC.8.3** El sistema deberá dejar **reconciliadas** las specs cross-tocadas: este delta **cita** (sin contradecir su as-built) la spec 02 C1 (wizard de rodeo, B1), la spec 02 C6 (espejo, B4), la spec 03 base (M2.2 `TactoStep`, B2; R8.4 preview, B4) y el delta backend `RPS.x` (Stream A, consumido). Cualquier cambio de comportamiento que surja en Gate 2 o de un fix se reconcilia en este delta antes de cerrar (`docs/conventions.md` §correcciones-en-specs).

**RPSC.8.4** El sistema **no** deberá reabrir schema/RLS/Edge Functions/migraciones en este delta (todo el backend lo hizo Stream A): si durante el diseño/implementación se descubriera que una pieza requiere tocar schema/RLS/Edge (p. ej. una columna nueva, una RPC nueva), entonces el chunk afectado deberá marcar **Gate 1 OBLIGATORIO** y parar antes de implementar (ver design §0). Por defecto, Stream B es **frontend puro → Gate 1 N/A, Gate 2 por chunk**.

**RPSC.8.5** Si Gate 2 (`security_analyzer` modo `code`) emite findings sobre cualquier chunk, entonces el sistema deberá reflejarlos en esta spec (reconciliación, sección "Historial de refinamiento") antes de cerrar el chunk, preservando los IDs `RPSC.x` ya asignados.

---

## Trazabilidad Gate 0 (`docs/modelo-reproductivo-puesta-en-servicio.md`) → requirement

| Sección / decisión del Gate 0 | Requirement(s) |
|---|---|
| §2 — categoría ≠ elegibilidad; eliminar `service→vaquillona` (espejo) | RPSC.1.1, RPSC.1.4, RPSC.1.5 |
| §2.1 / RPS.7.4 — alinear el espejo client-side (drift vivo) | RPSC.1 (todo) |
| §6 — selector de 12 meses, default primavera, alta | RPSC.2 |
| §6 — editable; rodeos existentes sin config → invitar | RPSC.3 |
| §6 — offline (outbox); PowerSync materializa array como TEXT | RPSC.2.4, RPSC.3.3, RPSC.3.7, RPSC.8.2 |
| §4 — tacto configurable ("¿tamaño? sí/no", default desde rodeo) | RPSC.4 |
| §4 — buckets por nº de meses (1/2/3/4–12/12) | RPSC.5.2–RPSC.5.5 |
| §4 — CCL mapea 1:1 a pregnancy_status (sin cambio schema) | RPSC.5.6 |
| §4 — rodeos de 12 meses: preñada/vacía sin tamaño por default | RPSC.4.2, RPSC.5.2 |
| §1 — servicio nivel rodeo (deprecar carga manual natural) | RPSC.6.1, RPSC.6.4 |
| §1 — IA NO se toca (per-vaca, service_type='ai') | RPSC.6.2 |
| §1 / RPS.4.5 — eventos `service` históricos quedan | RPSC.6.3 |
| §3 — aptitud = solo veredicto del vet (3 estados) | RPSC.7.1, RPSC.7.2 |
| §3 — diferencial de peso 66% = POST-MVP | RPSC.7.3 (fuera de alcance) |
| §8 Stream B — frontend; Gate 2 por chunk | RPSC.8.4, RPSC.8.5 |
| §9 — defaults provisionales de Facundo | RPSC.4.5, RPSC.5.5 ([TENTATIVO]) |

## Fuera de alcance (Stream B) — explícito

- **Reportes reproductivos** (%preñez, %parición, **distribución CCL**, cruce tacto↔nacimientos, denominador explícito) → **spec 07 / Stream C** (consume `rodeo_serviced_females`/`rodeo_repro_denominator`/`rodeo_service_campaign` de `0105`).
- **Backend de la puesta en servicio** (columna, RPC, `compute_category`, contrato de derivación) → **Stream A** (spec 02 delta `RPS.x`, ya as-built/deployado).
- **Captura del peso objetivo / 66% en la aptitud** → **POST-MVP** (Gate 0 §3; RPSC.7.3).
- **Catálogo de razas con datos agronómicos / gestación por raza** → **POST-MVP** (Gate 0 §5, §7).
- **Historia de membresía de rodeo por fecha** ("estaba en el rodeo durante la ventana aunque hoy esté en otro") → **no modelado en MVP** (Stream A design §5.2 [TENTATIVO]; afecta el denominador de Stream C, no a Stream B).

## Cobertura de tests (cada RPSC verificable)

- **Unit puro (node:test, `app/src/utils/...`)** — `computeCategoryCode`: ternera <1año + solo `service` → `ternera` (RPSC.1.1/RPSC.1.4); con destete → `vaquillona` (RPSC.1.2); ≥1año → `vaquillona` por edad (RPSC.1.2); parto/tacto+ con `service` presente → mismo resultado (RPSC.1.3); preview offline: inseminación sobre ternera → null/sin transición (RPSC.1.5). Regla de buckets CCL (función pura, RPSC.4.5/RPSC.5.8): 1→0 botones (sin tamaño), 2→2 (cabeza/cola), 3→3, 4–11→3 (tercios), 12→0, NULL→0/default-NO; default "¿medir tamaño?" derivado del rodeo (RPSC.4.2): 2/3/4–11→SÍ, 1/12/NULL/vacío→NO. Mapeo cabeza/cuerpo/cola→large/medium/small (RPSC.5.6). Parseo tolerante de `service_months` desde TEXT (RPSC.3.7): null/corrupto→sin configurar.
- **Componente (cuando la suite de cliente esté seteada) / e2e (Playwright, `app/e2e/...`)** — selector de 12 meses en el alta con primavera pre-tildada + persiste por outbox (RPSC.2.2/RPSC.2.4); editar meses de un rodeo existente offline + optimista + idempotente (RPSC.3.1/RPSC.3.3/RPSC.3.4/RPSC.3.5); rodeo "sin configurar" se presenta como tal e invita a configurar (RPSC.3.2); `TactoStep` muestra 2/3/0 botones de tamaño según el rodeo (RPSC.5.2–RPSC.5.5) con el lenguaje visual aprobado (botones gigantes, "PREÑADA" sin recorte — RPSC.5.9, veto del leader + web táctil); config "¿medir tamaño?" con default derivado + override (RPSC.4.1/RPSC.4.2); "Agregar evento" ya no ofrece monta natural pero sí IA/TE y el resto (RPSC.6.1/RPSC.6.2/RPSC.6.5); aptitud `tacto_vaquillona` sin cambios (RPSC.7.1).
- **Gate 1** — **N/A por defecto** (frontend puro; el schema/RLS/RPC lo hizo Stream A y ya pasó su Gate 1). Si algún chunk reabriera schema/RLS/Edge → Gate 1 OBLIGATORIO (RPSC.8.4). **Gate 2 (code) por chunk** (siempre).

## Historial de refinamiento

- 2026-06-23 — Redacción inicial del delta Stream B (cliente / manga) desde `docs/modelo-reproductivo-puesta-en-servicio.md` (Gate 0 aprobado Raf/Facundo, Puerta 1 2026-06-23) + el as-built de Stream A (spec 02 `RPS.x`, `0102`–`0105`) + el as-built del frontend tocado. IDs nuevos `RPSC.n` (no tocan los IDs estables de spec 03 base ni de `RPS.x`). **Hallazgos del spec_author al leer el as-built** (no re-decisiones de dominio): (1) la carga manual de "servicio natural" **NO** está en el wizard de MODO MANIOBRAS (`ManeuverKind` no tiene `servicio`; la manga solo tiene `inseminacion`=IA) → B3 deprecia la opción `natural` de **"Agregar evento" de la ficha** (`agregar-evento.tsx`), no una maniobra → RPSC.6 acotado a eso + RPSC.6.4 constata que no hay preset/secuencia rota; (2) el espejo (`computeCategoryCode`, B4) tiene el drift en las líneas 261/269 **y** ripplea al preview offline (`maneuver-category-preview.ts`, R8.4) que mapea `inseminacion→service→vaquillona` → RPSC.1.5 lo incluye; (3) `pregnancy_status` (small/medium/large) ya mapea 1:1 a cabeza/cuerpo/cola en el as-built (`PREGNANCY_SIZE_LABEL`) → B2 ajusta cuántos botones, sin tocar enum/schema; (4) el camino offline de rodeo ya existe (outbox `create_rodeo`/`set_rodeo_config`, overlay `pending_rodeos`) → B1 lo extiende con `p_service_months` + un gemelo `set_rodeo_service_months`; (5) la tabla `rodeos` del schema de PowerSync **aún no** tiene `service_months` → dependencia anotada (RPSC.3.7). **Orden recomendado de chunks: B4 (RPSC.1) primero** (cierra el drift vivo, es el más chico), luego B1/B2/B3 (independientes entre sí). **Gates: Gate 1 N/A (frontend puro, confirmado en design §0); Gate 2 por chunk; B1 (selector) y B2 (tacto config + buckets) necesitan design-spike + veto del leader (skill design-review) antes de mostrar a Raf.** Pendiente Puerta 1 (humana).
- 2026-06-23 — **VETO del leader: PASS** (sin cambios requeridos). Verificado: (1) DD-PSC-2 (`'large'` para "preñada sin tamaño") razonable — `null` se leería como no-preñada (bug), agregar valor al enum = Gate 1; `'large'`=cabeza es fiel para 1 mes y no contamina CCL (rodeos 1/12 no se reportan por CCL) + DD-PSC-8 oculta el tamaño no medido en el resumen; flageado para Facundo; (2) B4 bien mapeado (espejo + sintético + IA-preview + 2 suites, no "una línea"); (3) **coherencia con Stream A** — `rodeo_serviced_females` deriva el servicio natural de `service_months` (NO de eventos per-vaca) → deprecar la carga manual de monta natural (B3) NO rompe el denominador; (4) Gate 1 N/A re-confirmado por pieza (el `schema.ts` es el schema CLIENTE de PowerSync, TS, no migración). Listo para Puerta 2 (humana).
