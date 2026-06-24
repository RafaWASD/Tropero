# Requirements — Feature 07: Reportes / Analytics (Stream C del modelo reproductivo)

> EARS estricto (`docs/specs.md`). IDs `R7.x` estables — no reordenar después de aprobar.
> Fuente de verdad primaria: `specs/active/07-reportes-basicos/context.md` (Gate 0 aprobado por Raf, 2026-06-23) +
> `docs/modelo-reproductivo-puesta-en-servicio.md` (cross-spec) + catálogo de KPIs `research-kpis-cria.md`.
> Esta feature es el **Stream C** (reportes reproductivos) que CONSUME el Stream A as-built
> (`rodeo_service_campaign` / `rodeo_serviced_females` / `rodeo_repro_denominator`, `rodeos.service_months`,
> `compute_category` sin service) y el `pregnancy_status` del tacto (Stream B / B2 + `pregnancy-buckets.ts`).
>
> **Scope lockeado por Raf/Facundo (NO reabrir, ver context.md §3-§5):** MVP = 4 KPIs (resumen de sesión, %preñez,
> %parición, peso prom. por categoría + comparativa) + distribución CCL + 2 alertas (dosis vencida, sin pesar) +
> denominador explícito. Cómputo ONLINE-only, server-side, tenant-scoped. FUERA: benchmarking cross-campo (Plan Pro),
> export PDF (post-MVP), predicciones/IA (Plan Pro), reportes de otros sistemas (MVP es cría).

## Convenciones de este documento

- **"establecimiento activo"** = el `establishment_id` del `EstablishmentContext` (multi-tenant, `CLAUDE.md` ppio 6).
- **"rol activo"** = el usuario tiene `has_role_in(establishment_id)` (cualquier rol del establecimiento puede LEER reportes).
- **"reporte"** = resultado de una agregación server-side leída con conexión (online-only, context.md §7).
- **"campaña reproductiva (rodeo, año)"** = la ventana derivada de `rodeos.service_months` para un año, según
  `rodeo_service_campaign` (Stream A). Es la unidad temporal de los KPIs reproductivos (context.md §12).
- **CCL** = distribución cabeza/cuerpo/cola de las preñeces (cabeza=`large`, cuerpo=`medium`, cola=`small`;
  mapea 1:1 a `pregnancy_status`, Gate 0 §4). El nº de buckets depende de los meses de servicio del rodeo.
- **Servidas / entoradas / paridas / preñadas** = denominadores reproductivos (convención Bavera, context.md §11):
  - **servidas** = `rodeo_serviced_females(rodeo, año)` (unión distinct natural∪IA, Stream A).
  - **entoradas** = `serviced − retiradas` (`rodeo_repro_denominator`, Stream A).
  - **preñadas** = del conjunto servidas, las con último `tacto` vigente `pregnancy_status≠empty` sin aborto posterior.
  - **paridas** = del conjunto servidas, las con ≥1 evento `birth` mapeable a esa campaña (offset gestación por MES).
- **Gestación = 284 días, mapeo por MES** (Facundo 2026-06-23, Gate 0 §5): mes de parto − 9 = mes de concepción.
  No se resta 284 días exactos; se trabaja a granularidad de mes.

---

## R7.1 — Acceso a la pantalla de Reportes (tab raíz)

**R7.1.1** El sistema deberá exponer una pantalla "Reportes" como uno de los 5 items del bottom nav (ADR-018),
reemplazando el stub actual (`app/app/(tabs)/reportes.tsx`).

**R7.1.2** Mientras haya un establecimiento activo, la pantalla Reportes deberá mostrar los KPIs y alertas
acotados a ese establecimiento (multi-tenant).

**R7.1.3** Cuando el usuario cambie de establecimiento activo, el sistema deberá recomputar/recargar los
reportes para el nuevo establecimiento y nunca mostrar datos del establecimiento anterior.

**R7.1.4** El sistema deberá usar el **rodeo** como unidad primaria de los KPIs reproductivos y de peso
(reusa el Inicio rodeo-céntrico de spec 10), permitiendo elegir el rodeo a reportar (context.md §8).

---

## R7.2 — Cómputo online-only y estado offline gracioso

**R7.2.1** El sistema deberá computar todos los reportes **server-side** (Postgres, tenant-scoped); el cliente
no deberá replicar la lógica de agregación (context.md §7).

**R7.2.2** Mientras no haya conexión, el sistema deberá mostrar un estado claro de "necesitás conexión para ver
reportes" (mensaje accionable, no spinner infinito ni stack trace) y no deberá intentar computar offline (context.md §7).

**R7.2.3** Donde exista un último resultado de reporte ya cargado en esta sesión de app, el sistema podrá
mostrarlo en modo read-only mientras está offline, marcándolo explícitamente como "datos de la última carga"
(nice-to-have, context.md §7). *(Opcional — no bloquea el MVP.)*

**R7.2.4** Si una llamada de reporte falla por red o error del servidor, entonces el sistema deberá mostrar un
mensaje accionable y un control para reintentar, sin romper la pantalla (`docs/conventions.md` — errores).

---

## R7.3 — Resumen por sesión (jornada de maniobra)

**R7.3.1** Cuando el usuario elija una sesión (`sessions`) de un rodeo, el sistema deberá mostrar un resumen de
esa jornada con el conteo de eventos **por tipo de evento** asociados a esa `session_id`, sobre las tablas de
evento que tienen FK `session_id` en el as-built: `weight_events`, `reproductive_events`, `sanitary_events`,
`condition_score_events`, `lab_samples` (`0052`), `scrotal_measurements` (`0098`) y `custom_measurements`
(`0094`) (context.md §4a/§5).

> *Nota de as-built (corrige context.md §5 "las 7 tablas"):* las tablas con FK `session_id` son **siete**:
> `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`,
> `scrotal_measurements`, `custom_measurements`. **`animal_events` NO tiene `session_id`** (verificado en
> `0034`/`0052`) → queda fuera del resumen por sesión. El implementer cuenta exactamente esas siete.

**R7.3.2** El resumen de sesión deberá mostrar el marco temporal de la jornada (`started_at` / `ended_at`) y el
conteo de animales intervenidos (animales distintos con ≥1 evento de la sesión).

**R7.3.3** El sistema deberá excluir del resumen de sesión todo evento con `deleted_at IS NOT NULL` (context.md §9).

**R7.3.4** Mientras una sesión esté `active` (abierta), el sistema deberá igualmente computar su resumen,
reflejando el estado al momento de la consulta (context.md §9, default: sí aplica a abiertas).

**R7.3.5** Cuando una sesión no tenga ningún evento, el sistema deberá mostrar un empty state cálido
("todavía no hay eventos en esta jornada"), no "0" crudos ni error (context.md §9).

**R7.3.6** El sistema deberá listar las sesiones de un rodeo (las disponibles para elegir) ordenadas por fecha
de inicio descendente (más reciente primero).

---

## R7.4 — Comparativa entre dos sesiones del mismo rodeo

**R7.4.1** Cuando el usuario elija dos sesiones del **mismo** `rodeo_id`, el sistema deberá mostrar sus
resúmenes lado a lado con el **delta** por tipo de evento (context.md §4f/§8).

**R7.4.2** Si el usuario intenta comparar dos sesiones de rodeos distintos, entonces el sistema no deberá
permitir la comparativa (la elección de la segunda sesión se restringe al mismo rodeo de la primera).

**R7.4.3** Cuando una de las dos sesiones no tenga un tipo de evento que la otra sí tiene, el sistema deberá
mostrar `0` para esa celda y el delta correspondiente (no omitir la fila).

---

## R7.5 — % Preñez por rodeo

**R7.5.1** Cuando el usuario pida el %preñez de un rodeo para una campaña (año), el sistema deberá calcularlo
como **preñadas / servidas × 100**, donde el denominador es **servidas** (`rodeo_serviced_females`, Stream A) —
**base ÚNICA, sin selector** (Puerta de spec 2026-06-24; context.md §5).

**R7.5.2** El sistema deberá contar como **preñada** a la hembra del conjunto servidas cuyo **último** evento
`tacto` (por `event_date`, desempate `created_at`) tiene `pregnancy_status ≠ 'empty'` y NO tiene un evento
`abortion` posterior (misma regla "tacto+ vigente" que `compute_category` RT2.7.5; Gate 0 §2).

**R7.5.3** El sistema deberá usar **servidas como base fija** del %preñez (sin toggle de base). El selector para
alternar entre servidas/entoradas/preñadas queda **descartado** (Puerta de spec 2026-06-24: Raf "solo esa base").
*(El denominador explícito de R7.5.5 igual hace visibles los absolutos. Selector de base = post-MVP si hace falta.)*

**R7.5.4** Si **servidas** es **0**, entonces el sistema deberá mostrar "—" o "sin datos" y nunca dividir por
cero ni mostrar `NaN`/`Infinity` (context.md §9).

**R7.5.5** El sistema deberá mostrar, junto al %, el **numerador y el denominador absolutos** (ej. "preñadas 41
de 50", o "preñadas 41 / servidas 46"), no solo el porcentaje.

**R7.5.6** Cuando un rodeo no tenga `service_months` configurado (`is_configured = false` en
`rodeo_service_campaign`), el sistema deberá mostrar un estado "configurá la estación de servicio de este
rodeo" en lugar del %preñez, con acceso a configurarla (cross-spec spec 02; context.md §10-D4 / Gate 0 §6).

**R7.5.7** El sistema deberá computar el %preñez sobre la campaña vigente del rodeo por default, definida como la
**última campaña (año) con datos** del rodeo (Puerta de spec 2026-06-24: NO el año calendario actual), permitiendo
cambiar de campaña (año) (context.md §12; período por defecto = campaña reproductiva).

**R7.5.8** El sistema deberá resolver la pertenencia de una campaña que **cruza el fin de año** (servicio
Nov-Dic-Ene) por **set-membership** — un mes pertenece a la campaña si está en `service_months` del rodeo
(`mes ∈ service_months`, igual que Stream A), **no** por un rango `BETWEEN window_start..window_end` con wrap
(Puerta de spec 2026-06-24; `0105` trata `p_year` como "conjunto de meses del año", no rango con wrap).

---

## R7.6 — % Parición por rodeo

**R7.6.1** Cuando el usuario pida el %parición de un rodeo para una campaña, el sistema deberá calcularlo como
**paridas / servidas × 100** (definición de Facundo, context.md §5; cierra D1).

**R7.6.2** El sistema deberá considerar como **parida** a la hembra del conjunto servidas con ≥1 evento `birth`
(no borrado) cuyo **mes de concepción derivado** (mes de parto − 9, Gate 0 §5) cae en un mes de servicio de la
campaña de ese rodeo — de modo que numerador (paridas) y denominador (servidas) refieran al **mismo grupo de
servicios** (context.md "Nota sobre D4", §12).

**R7.6.3** Si la cantidad de servidas es **0**, entonces el sistema deberá mostrar "—"/"sin datos" y nunca
dividir por cero (context.md §9).

**R7.6.4** El sistema deberá usar **servidas como base fija** del %parición (sin toggle de base), consistente con
R7.5.3 (su definición ya es paridas/servidas, R7.6.1). El selector de base servidas/entoradas/preñadas queda
**descartado** (Puerta de spec 2026-06-24). La **pérdida preñez→parición** queda VISIBLE comparando los dos KPIs
sobre la misma base servidas (%preñez vs %parición), sin necesitar un selector dedicado. *(Selector de base =
post-MVP si hace falta.)*

**R7.6.5** El sistema deberá mostrar el numerador y el denominador absolutos junto al porcentaje.

**R7.6.6** Cuando el rodeo no tenga `service_months` configurado, el sistema deberá mostrar el mismo estado
"configurá la estación de servicio" que en R7.5.6 (la campaña no es derivable sin meses de servicio).

---

## R7.7 — Distribución CCL (cabeza / cuerpo / cola) por rodeo

**R7.7.1** Cuando el usuario pida la distribución CCL de un rodeo para una campaña, el sistema deberá mostrar,
para las hembras **preñadas** (R7.5.2) de esa campaña, el conteo y porcentaje por bucket
**cabeza (`large`) / cuerpo (`medium`) / cola (`small`)** (Gate 0 §4; `research-kpis-cria.md §1`, métrica diagnóstica).

**R7.7.2** El sistema deberá determinar **cuántos buckets** mostrar según el nº de meses de servicio del rodeo,
con la **misma regla** que `pregnancy-buckets.ts` (Gate 0 §4):
- 1 mes → **sin distinción** (no se muestra CCL; solo preñada/vacía).
- 2 meses → **cabeza / cola** (sin cuerpo).
- 3 meses → **cabeza / cuerpo / cola** (tercios exactos).
- 4 a 11 meses → **cabeza / cuerpo / cola** (tercios). *(Bucketing 4-11 = `[SUPUESTO]` provisional, ver §Supuestos.)*
- 12 meses (servicio continuo) → **sin CCL** (no hay meses contra los cuales comparar; Gate 0 §4).

**R7.7.3** Cuando el rodeo tenga 1 mes, 12 meses, override "sin distinción", o `service_months` sin configurar,
el sistema deberá ocultar el reporte de CCL y mostrar una nota explicando por qué no aplica (Gate 0 §4).

**R7.7.4** Si no hay preñeces diagnosticadas con tamaño en la campaña, entonces el sistema deberá mostrar un
empty state ("todavía no hay tactos con tamaño de preñez en esta campaña"), no `0%`/`NaN`.

**R7.7.5** El sistema deberá mostrar el total de preñeces sobre el que se calcula la distribución (base del %).

---

## R7.8 — Cruce tacto (CCL diagnosticado) vs distribución real de nacimientos

**R7.8.1** Donde el rodeo tenga distinción de etapas (2-11 meses, no "sin distinción"), el sistema deberá
mostrar, para una campaña, la distribución de **nacimientos por etapa** (cabeza/cuerpo/cola) derivada del mes
de concepción de cada `birth` (mes de parto − 9, Gate 0 §5) ubicado en el bucket correspondiente del rodeo
(Gate 0 §5, "el cruce de oro").

**R7.8.2** El sistema deberá mostrar la distribución de nacimientos por etapa **junto a** la distribución CCL
del tacto (R7.7), de modo que el usuario pueda comparar lo diagnosticado vs lo realmente nacido por etapa
(Gate 0 §5: localizar pérdidas, no solo contarlas).

**R7.8.3** Si una campaña aún no tiene nacimientos cargados (entore reciente, parición futura), entonces el
sistema deberá degradar con gracia la distribución de nacimientos ("todavía no hay pariciones de esta campaña"),
sin romper el reporte de CCL del tacto.

---

## R7.9 — Peso promedio por categoría + comparativa

**R7.9.1** Cuando el usuario pida el peso promedio por categoría de un rodeo, el sistema deberá mostrar
`AVG(weight_kg)` agrupado por la **categoría actual** del animal (`animal_profiles.category_id` →
`categories_by_system.name`), usando el **último** `weight_event` no borrado de cada animal activo (context.md §5).

**R7.9.2** El sistema deberá mostrar, por categoría, también el **número de animales** que aportan al promedio
(para que un promedio sobre 1 animal no se lea como representativo).

**R7.9.3** El sistema deberá mostrar el peso en formato es-AR (coma decimal, ej. "385,5 kg") en la UI
(referencia de formato es-AR; no aplica a formatos de máquina) y excluir `weight_events` con `deleted_at`.

**R7.9.4** Cuando una categoría del rodeo no tenga ningún animal con pesaje, el sistema deberá mostrarla como
"sin pesar" / "—", no como `0 kg`.

**R7.9.5** Donde el usuario pida una **comparativa de peso**, el sistema deberá comparar el peso promedio por
categoría entre **dos sesiones del mismo rodeo** y mostrar el delta por categoría (Puerta de spec 2026-06-24:
la comparativa del MVP es **por sesiones**, no por campañas; context.md §4e/§4f). *(La comparativa por campaña
queda post-MVP.)*

---

## R7.10 — Alerta: próxima dosis vencida

**R7.10.1** El sistema deberá listar como **dosis vencida** todo `sanitary_event` (no borrado) de un animal
activo del establecimiento con `next_dose_date < hoy` que NO tenga una dosis posterior del **mismo producto**
sobre el **mismo animal** (`next_dose_date IS NOT NULL`; context.md §6.1, confirmada por Facundo).

**R7.10.2** Cada ítem de la alerta deberá identificar el animal (IDV / visual_id_alt), el producto
(`product_name`) y la fecha vencida (`next_dose_date`), para que sea accionable.

**R7.10.3** El sistema deberá excluir de esta alerta a los animales con `status ≠ 'active'` y a los eventos con
`deleted_at IS NOT NULL`.

**R7.10.4** Cuando no haya ninguna dosis vencida, el sistema deberá mostrar un empty state positivo
("no hay dosis vencidas"), no una lista vacía sin contexto.

**R7.10.5** El sistema deberá acotar el escaneo de la alerta de dosis vencida con una **ventana de fecha**
configurable (piso `next_dose_date ≥ hoy − ventana`, default 365 días) y un **tope de resultados** server-side
(LIMIT, default 500), y deberá rechazar con error de validación los parámetros fuera de rango (ventana < 0, tope
fuera de `[1, 1000]`), de modo que la alerta nunca escanee todo el historial de `sanitary_events` del
establecimiento sin cota (Gate 1 M4 / INPUT-1; design §5.4).
> *Reconciliación Gate 1 (2026-06-24):* criterio nuevo que cierra el único escaneo sin cota detectado por el
> `security_analyzer` modo `spec` (M4). No reabre ninguna decisión de Gate 0; es una precisión técnica dentro del
> patrón aprobado (`0105` acota `p_year`; esta alerta no tenía análogo).

---

## R7.11 — Alerta: animales sin pesar

> **Umbral CERRADO (Puerta de spec, 2026-06-24): 180 días para el MVP, parametrizado.** Raf confirmó 180 d como
> default del MVP ("por ahora, quizá lo modifiquemos"); NO es un `[SUPUESTO]`. Se mantiene parametrizado
> (`p_threshold_days`, cota `[0, 3650]` de R7.11.6) para ajustarlo sin reescribir EARS.
> El **alcance/categorías (R7.11.2) SIGUE `[SUPUESTO]` en consulta con Facundo (D2)** — eso NO se cierra acá.

**R7.11.1** El sistema deberá listar como **sin pesar** a los animales activos del establecimiento que no tengan
ningún `weight_event` no borrado, o cuyo último pesaje sea anterior a un **umbral de días** configurable
(**default-MVP CONFIRMADO = 180 días**, parametrizado vía `p_threshold_days`; Puerta de spec 2026-06-24, context.md §6.2).

**R7.11.2** El sistema deberá acotar la alerta a las **categorías relevantes** de cría (`[SUPUESTO]` default =
las que sí se pesan en cría — terneros/recría/vaquillonas de reposición; el adulto casi no se pesa), de modo
que no sea ruido (context.md §6.2 / Gate 0 §9-D2). *(El alcance/categorías sigue en consulta con Facundo — D2.)*

**R7.11.3** Cada ítem deberá identificar al animal (IDV / visual_id_alt), su categoría y los días desde el
último pesaje (o "nunca pesado").

**R7.11.4** El sistema deberá excluir animales con `status ≠ 'active'` y eventos con `deleted_at IS NOT NULL`.

**R7.11.5** Cuando no haya animales sin pesar (según el umbral/alcance vigente), el sistema deberá mostrar un
empty state positivo.

**R7.11.6** El sistema deberá validar los parámetros de la alerta "sin pesar" (umbral de días en el rango
cerrado `[0, 3650]` — 0 a 10 años, holgado sobre cualquier cadencia real de pesaje; cardinalidad de la lista de
categorías ≤ 64) y rechazar con error de validación los que estén fuera de rango, de modo que ningún input
fuerce un escaneo desmedido (Gate 1 M4-menor / L1; design §5.4).
> *Reconciliación Gate 1 (2026-06-24):* criterio nuevo (precisión de cota de input). El umbral default y el
> alcance siguen `[SUPUESTO]` (D2, Facundo) — esto NO cierra D2; solo acota el rango admisible del parámetro.

---

## R7.12 — Multi-tenancy y aislamiento (Gate 1)

**R7.12.1** El sistema no deberá exponer en ningún reporte datos de un establecimiento donde el usuario no tenga
rol activo (`has_role_in`); toda agregación deberá estar scopeada por establecimiento (context.md §7, `architecture.md`).

**R7.12.2** Toda función/vista de agregación nueva que lea cross-tabla deberá aplicar el guard de tenant
(`has_role_in`) **antes** de devolver datos, con el mismo patrón fail-closed que las RPC de Stream A (`0105`).

**R7.12.3** Si el usuario pide un reporte de un rodeo de otro establecimiento (IDOR), entonces el sistema deberá
rechazar la operación (error de autorización), no devolver datos parciales ni vacíos silenciosos.

**R7.12.4** Las funciones de reporte deberán ser **read-only** (`STABLE`, sin escribir) y no deberán quedar
`EXECUTE`-able por `anon`/`public` (revoke + grant solo a `authenticated`, patrón `0105`).

---

## R7.13 — Animales archivados y eventos borrados (consistencia transversal)

**R7.13.1** El sistema deberá excluir de los KPIs de **rodeo** (preñez, parición, CCL, peso por categoría,
alertas) a los animales con `status ≠ 'active'`, salvo donde un denominador as-built ya los considere como
"retiradas" (`rodeo_repro_denominator`) (context.md §9).

**R7.13.2** El sistema deberá **incluir** animales archivados en el **histórico de una sesión** (R7.3), porque
una jornada pasada refleja el estado de ese día (Puerta de spec 2026-06-24: decisión CERRADA — el resumen de
sesión NO filtra `status='active'`; sí filtra `deleted_at IS NULL` siempre; context.md §9).

**R7.13.3** El sistema deberá excluir SIEMPRE los eventos con `deleted_at IS NOT NULL` de todo reporte
(context.md §9).

---

## R7.14 — Ficha individual de animal (ya construida — fuera de scope nuevo)

**R7.14.1** El sistema ya provee la ficha individual con cronología de eventos vía `animal_timeline` en
`app/app/animal/[id].tsx` (context.md §2). Esta feature **no** reimplementa la ficha individual; el ítem (b)
del `acceptance` original queda cubierto por el as-built.

> *Nota de trazabilidad:* este requirement existe para cerrar el `acceptance` ("Ficha animal lista eventos en
> orden cronológico") contra el as-built. No genera trabajo nuevo ni test nuevo en spec 07 (lo cubre spec 02).

---

## Cobertura del `acceptance` original (feature_list.json id 7)

| Criterio del acceptance | Requirements que lo cubren |
|---|---|
| "Resumen de sesión muestra totales, anomalías y promedios." | R7.3 (totales/conteos), R7.9 (promedios), R7.10/R7.11 (anomalías = alertas) |
| "Ficha animal lista eventos en orden cronológico." | R7.14 (as-built `animal_timeline`, no es trabajo nuevo) |
| "KPIs de rodeo calculables a demanda." | R7.5 (%preñez), R7.6 (%parición), R7.7 (CCL), R7.9 (peso), R7.2 (online/a demanda) |
| "Comparativa entre dos sesiones del mismo rodeo." | R7.4 (comparativa de sesiones), R7.9.5 (comparativa de peso) |

## Cobertura de cada "Caso y decisión" del context.md

| Caso / decisión (context.md) | Requirement(s) |
|---|---|
| §4a Resumen por sesión | R7.3 |
| §4c %preñez | R7.5 |
| §4d %parición = paridas/servidas | R7.6 |
| §4e Peso prom. por categoría | R7.9 |
| §4f Comparativa entre sesiones | R7.4, R7.9.5 |
| §5/§11 Denominador explícito (absolutos num/den; base ÚNICA servidas, sin toggle — Puerta de spec 2026-06-24) | R7.5.3, R7.5.5, R7.6.4, R7.6.5 |
| §6.1 Alerta dosis vencida (Facundo OK) | R7.10 (incl. R7.10.5 cota de escaneo — Gate 1 M4) |
| §6.2 / §10-D2 Alerta sin pesar (Facundo pending) | R7.11 (`[SUPUESTO]`; incl. R7.11.6 cota de input — Gate 1 M4) |
| §7 Cómputo online-only server-side + offline gracioso | R7.2, R7.12 |
| §9 Edge cases (0 denominador, archivados, borrados, sesión abierta, NaN) | R7.5.4, R7.6.3, R7.7.4, R7.9.4, R7.3.4/.5, R7.13 |
| §12 Campaña reproductiva como unidad temporal (default = última con datos; wrap por set-membership) | R7.5.7, R7.5.8, R7.6.2 |
| Gate 0 §4 Distribución CCL + buckets por meses | R7.7 |
| Gate 0 §5 Cruce nacimiento↔servicio (284d por mes) | R7.6.2, R7.8 |
| Gate 0 §6 Rodeo sin `service_months` → invita a configurar | R7.5.6, R7.6.6, R7.7.3 |
| ADR-018 Tab Reportes | R7.1 |

---

## Supuestos provisionales (Facundo-pending §9 — defaults, NO números firmes)

Estos son **defaults provisionales** marcados `[SUPUESTO]`. Se implementan parametrizados para ajustarlos sin
reescribir EARS cuando Facundo cierre (Gate 0 §9). No son decisiones firmes de la spec.

- **`[SUPUESTO]` Bucketing CCL 4-11 meses = tercios** (R7.7.2). Espejo de `pregnancy-buckets.ts` (misma fuente
  única de la regla). Si Facundo define otro bucketing, se cambia en un solo lugar (ver design §CCL).
- ~~`[SUPUESTO]` Umbral alerta "sin pesar" = 180 días~~ → **CERRADO (Puerta de spec 2026-06-24): 180 d = default
  del MVP confirmado por Raf, parametrizado** (`p_threshold_days`, cota `[0, 3650]`). Ya NO es supuesto. Ajustable
  sin reescribir EARS (R7.11.1).
- **`[SUPUESTO]` Alcance/categorías alerta "sin pesar" = categorías que se pesan en cría** (R7.11.2) — **SIGUE
  abierto, en consulta con Facundo (D2)**: ¿por días o por hito (destete sin peso / vaquillona al entore sin peso
  objetivo)?, ¿qué categorías?, ¿CC reemplaza al peso en adultos? (El umbral ya está cerrado; esto es lo único de
  R7.11 que falta.)
- **`[SUPUESTO]` "Retiradas" = no-activas hoy** (heredado de `rodeo_repro_denominator`, `0105` `[TENTATIVO]`): el
  recorte fino por "salió DURANTE la ventana" lo afina Stream C/Facundo. Spec 07 consume el contrato as-built.

---

## Preguntas abiertas (para que el leader las lleve a Raf/Facundo — NO inventadas en la spec)

> **Las 5 preguntas que estaban en esta sección se RESOLVIERON en la Puerta de spec (Raf, 2026-06-24).** Se dejan
> listadas con su decisión para trazabilidad. **Lo único que sigue abierto es el ALCANCE/categorías de la alerta
> "sin pesar"** (parte de #1 — Facundo, D2); el resto está cerrado.

1. **RESUELTA (parcial) — Alerta "sin pesar" (D2).** ✅ **Umbral CERRADO: 180 d = default del MVP** (Raf, "por
   ahora, quizá lo modifiquemos"), parametrizado (`p_threshold_days`, cota `[0,3650]`) → R7.11.1. ⏳ **SIGUE
   abierto el ALCANCE/categorías** (R7.11.2): ¿días vs hito?, ¿qué categorías?, ¿CC reemplaza peso en adultos? —
   en consulta con Facundo. La alerta funciona con el default `[SUPUESTO]` de categorías-que-se-pesan hasta que
   Facundo cierre. *(El `spec_author` NO cierra el alcance — context.md §10-D2 lo deja a Facundo.)*

2. **RESUELTA — Comparativa de peso (R7.9.5).** ✅ **Por SESIONES en el MVP** (Raf, Puerta de spec 2026-06-24); la
   comparativa por campaña queda post-MVP.

3. **RESUELTA — Base del %preñez (R7.5.3).** ✅ **Base ÚNICA = servidas, SIN selector** (Raf: "solo esa base").
   Por consistencia se aplicó lo mismo a %parición (R7.6.4): base fija servidas, sin toggle. Se mantiene el
   denominador explícito (absolutos num/den, R7.5.5). Selector de base = post-MVP si hace falta.

4. **RESUELTA — Año de campaña por default + wrap de fin de año (R7.5.7/R7.5.8).** ✅ **Default = última campaña
   con datos** del rodeo (NO el año calendario actual). ✅ **Wrap (Nov-Dic-Ene) por set-membership** (`mes ∈
   service_months`, igual que Stream A), no por rango `BETWEEN` con wrap.

5. **RESUELTA — Animales archivados en histórico de sesión (R7.13.2).** ✅ **INCLUIR** (Raf, Puerta de spec
   2026-06-24): la jornada es un hecho histórico; el resumen de sesión no filtra `status='active'` (sí
   `deleted_at IS NULL` siempre).

---

## Historial de refinamiento

- **2026-06-24** — Redacción inicial (spec_author) a partir de `context.md` (Gate 0 aprobado 2026-06-23),
  `docs/modelo-reproductivo-puesta-en-servicio.md` y el Stream A as-built (`0102`/`0104`/`0105`). Sin cambios de
  IDs (primera emisión).
- **2026-06-24** — Fold de los **4 MEDIUM de Gate 1** (`progress/security_spec_07-reportes.md`, PASS) **antes** de
  la Puerta de spec, para que Gate 2 valide contra el contrato afinado. Ninguno requirió decisión de Raf/Facundo
  (precisiones técnicas dentro del patrón seguro ya elegido, espejo `0105`). Cambios:
  - **M4** → **R7.10.5** (nuevo: cota de escaneo de la alerta de dosis vencida — ventana + LIMIT) y **R7.11.6**
    (nuevo: validación de cota de input de la alerta "sin pesar"). Únicos cambios de EARS — IDs nuevos al final de
    su grupo, **sin reordenar** los existentes.
  - **M1** (IDOR de `p_establishment_id` del cliente en las 2 RPC de alerta), **M2** (scoping por el join a
    `animal_profiles`, no por columna denorm de las tablas de evento) y **M3** (filtrar `deleted_at`/`status` en el
    join, no en `establishment_of_profile`) → **sin cambio de EARS**: el *qué* ya estaba en R7.12.3 / R7.12 / R7.13.
    Se precisó el *cómo* en `design.md` §5.1/§5.5/§5.6 y se anclaron los asserts en `tasks.md` (T4.3, T8.1).
  - Detalle sección↔criterio↔test en `design.md` §9 (tabla de reconciliación Gate 1).
  - **Pase de verificación del fold (mismo día):** se re-verificó cada afirmación del fold contra el as-built
    (`0005` `has_role_in` fail-closed; `0023:6-9` `establishment_of_profile` sin `deleted_at` → M3; `0077:33-36`
    las 5 tablas de evento scopean por FK al perfil, la columna denorm es plumbing del sync → M2; `0105:104-124`
    el patrón de `rodeo_serviced_females` — guard + join a `animal_profiles` + cota `p_year`/`22023`) — todas
    correctas. Dos precisiones de testabilidad (NO reabren Gate 0 ni decisiones cerradas):
    - **M4-menor concretado**: el "tope superior razonable" de `p_threshold_days` se fijó al rango cerrado
      **`[0, 3650]`** (10 años) en R7.11.6 + design §2.7/§5.4 + tasks T4.2/T4.3, para que el assert de `22023`
      fuera-de-rango sea determinístico (espejo de la cota cerrada de `p_year` de `0105` y del `p_limit
      between 1 and 1000`). El default 180 y el alcance de la alerta siguen `[SUPUESTO]`/Facundo (NO cierra D2).
      *(Estado al fold de Gate 1; el umbral 180 d se CERRÓ después como default-MVP en la Puerta de spec —
      ver la entrada del 2026-06-24 "Fold de las 5 decisiones de Raf", D1. El alcance/categorías sí sigue Facundo.)*
    - **Referencia corregida**: T0.1 apuntaba al output futuro `security_spec_07-reportes-basicos.md`; se alineó
      al archivo real `progress/security_spec_07-reportes.md` (ya generado, PASS) para no mentir sobre su ubicación.
- **2026-06-24** — Fold de las **5 decisiones de Raf en la Puerta de spec** (decisiones CERRADAS; se quitaron los
  `[SUPUESTO]`/preguntas-abiertas correspondientes y se lockearon). EARS estricto + tablas de trazabilidad
  mantenidas; sin reordenar IDs (solo se **agregó** R7.5.8 al final del grupo R7.5). *(Etiquetas Dec.1-Dec.5 =
  las 5 decisiones de la Puerta de spec; NO confundir con los "D1-D4" de Gate 0/context.md.)* Reconciliación
  R↔decisión:
  - **Dec.1 (umbral sin-pesar = 180 d MVP, parametrizado; alcance sigue Facundo)** → R7.11.1 (180 d = default-MVP
    confirmado, ya no `[SUPUESTO]`) + nota de cabecera de R7.11 + §Supuestos (umbral cerrado; alcance R7.11.2
    explícito como Facundo-pending). **NO cierra el D2 de context.md** (alcance/categorías). Cota `[0,3650]` de
    R7.11.6 intacta.
  - **Dec.2 (comparativa de peso = por sesiones, MVP)** → R7.9.5 (lockeado a "dos sesiones del mismo rodeo";
    campaña→post-MVP). Cierra pregunta abierta #2.
  - **Dec.3 (%preñez base ÚNICA = servidas, sin selector; ídem %parición)** → **R7.5.3** (toggle servidas/entoradas/
    preñadas **descartado**, base fija servidas) + R7.5.1/R7.5.4 (denominador = servidas) + **R7.6.4** (sin toggle,
    base fija servidas; pérdida preñez→parición visible comparando %preñez vs %parición). Se **mantiene** el
    denominador explícito (absolutos num/den) en R7.5.5. Fila de cobertura §5/§11 anotada. Cierra pregunta #3.
  - **Dec.4 (año default = última campaña con datos; wrap por set-membership)** → R7.5.7 (default = última campaña
    con datos, NO año calendario) + **R7.5.8 (nuevo)** (wrap Nov-Dic-Ene por `mes ∈ service_months`, no `BETWEEN`).
    Fila de cobertura §12 anotada. Cierra pregunta #4.
  - **Dec.5 (archivados → INCLUIR en histórico de sesión)** → R7.13.2 (lockeado a "deberá **incluir**"; sin filtro
    de `status` en el resumen de sesión, sí `deleted_at`). Cierra pregunta #5.
  - Sección "Preguntas abiertas" reescrita: 5 marcadas RESUELTAS; **único pendiente = alcance/categorías de la
    alerta sin-pesar (Facundo, D2 de context.md)**. Ningún cambio de código (lo hace el implementer);
    `feature_list.json` lo cambia el leader. Espejo en `design.md` §2/§5/§10 y `tasks.md`.
