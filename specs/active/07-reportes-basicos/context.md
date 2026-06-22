# Contexto (Gate 0) — Feature 07: Reportes / Analytics

> Artefacto de refinamiento de contexto (ADR-022). Se aprueba (Puerta 1) **antes** de escribir la spec.
> Refinado por el leader con Raf el **2026-06-19**.

## 1. Por qué esta feature importa (no es "reportes básicos")

Según `CONTEXT/01-producto.md`, **esta es la capa diferencial del producto**. El competidor dominante (Control Ganadero) entrega "informes estáticos en PDF que el productor mira y archiva". La propuesta de valor de RAFAQ es la *capa de inteligencia*: KPIs que muestran **tendencias**, **comparativas** y **alertas**, no fotos puntuales. Toda la manga construida (specs 02/03/10) es la materia prima; spec 07 es donde esa materia prima se vuelve la razón por la que el dueño paga.

## 2. Estado de partida (as-built 2026-06-19)

- **La DB está 100% lista.** Todas las tablas de evento (`reproductive_events`, `weight_events`, `sanitary_events`, `condition_score_events`, `scrotal_measurements`, `custom_measurements`/`custom_attributes`, `animal_events`) tienen `establishment_id`, `rodeo`/`animal_profile_id`, `event_date`, `session_id` FK y `deleted_at`. Existen catálogo de categorías, `compute_category()` y la vista `animal_timeline`.
- **Las fórmulas reproductivas ya están cerradas con Facundo** (`specs/active/02-modelo-animal/dominio-categorias-facundo-2026-06-03.md`): %preñez = tacto+/hembras; %destete = weaning/terneros.
- **El ítem (b) del acceptance — "ficha individual con cronología" — YA está construido** (la vista `animal_timeline` se usa hoy en `app/app/animal/[id].tsx`). NO es trabajo nuevo de spec 07.
- **No existe ningún motor de agregación / KPI / pantalla de reportes en `app/src`.** Todo el cálculo y la UI están por escribir.

## 3. Decisiones lockeadas por Raf (2026-06-19)

1. **Alcance = núcleo de KPIs + alertas automáticas.** (Benchmarking anónimo cross-campo queda **FUERA del MVP** → Plan Pro, ya documentado así en `CONTEXT/08`; requiere agregación cross-tenant con privacidad + Gate 1 pesado.)
2. **Cómputo online-only, server-side.** Las agregaciones viven en Postgres (vistas / RPC scopeadas por `establishment_id`), la app pide el reporte con señal. Razón: reportes = actividad de "sentarse a revisar" con conexión, no de manga; evita replicar la lógica de agregación client-side; y no depende del dev build de Android (que hoy bloquea PowerSync nativo).

**Refinamiento 2026-06-19 (Facundo + Raf):**
3. **Alerta "partos próximos" ELIMINADA** — Facundo: *"no hay manera de garantizar nada"*. La fecha estimada de parto no es confiable como base de una alerta. Quedan **2 alertas** (sin pesar + próxima dosis vencida).
4. **% parición = total paridas / total servidas × 100** (definición de Facundo — cierra D1).
5. **"Próxima dosis vencida" CONFIRMADA** por Facundo.
6. **Exportar a PDF = post-MVP** (Raf — cierra D3).

## 4. Alcance — Dentro / Fuera del MVP

**Dentro:**
- (a) **Resumen por sesión** (jornada de maniobra): totales por tipo de evento, conteos, marco temporal.
- (c) **% preñez** por rodeo.
- (d) **% parición** por rodeo *(definición exacta a confirmar — ver §10)*.
- (e) **Peso promedio por categoría**.
- (f) **Comparativa entre dos sesiones** del mismo rodeo.
- **Alertas automáticas** (2, ver §6).
- Pantalla **"Reportes"** (tab reservado en el bottom nav por ADR-018).

**Fuera (post-MVP / Plan Pro):**
- Benchmarking anónimo entre campos (Plan Pro).
- Reportes de otros sistemas (invernada/feedlot/tambo/cabaña) — MVP es cría.
- Exportación a PDF/Excel del reporte (a evaluar; el diferencial es la pantalla viva, no el PDF).
- Predicciones / IA (Plan Pro).
- Protocolos sanitarios reutilizables (Plan Pro) — afecta el alcance de la alerta de vacunas (ver §6.3).

## 5. KPIs del MVP + fórmulas

| KPI | Fórmula | Fuente | Estado fórmula |
|---|---|---|---|
| % preñez (rodeo) | hembras con último tacto+ vigente (sin aborto posterior) / hembras activas | `reproductive_events` (tacto + `pregnancy_status≠empty`) + categoría hembra | ✅ cerrada (Facundo) — la lógica "tacto+ vigente" ya vive en `compute_category` |
| % parición (rodeo) | **total paridas / total servidas × 100** | `reproductive_events` (`event_type='birth'` vs `'service'`) | ✅ cerrada (Facundo, 2026-06-19) |
| Peso prom. por categoría | AVG(weight_kg) GROUP BY categoría | `weight_events` ⨝ `animal_profiles.category_id` ⨝ catálogo | ✅ trivial |
| Resumen por sesión | COUNT por tipo de evento con `session_id = X` | `sessions` + las 7 tablas de evento (FK `session_id`) | ✅ directo |
| Comparativa entre sesiones | aplicar lo de arriba a 2 sesiones del mismo `rodeo_id` y mostrar delta | ídem | ✅ |

## 6. Alertas automáticas (2 — computables con el schema de hoy)

> Umbrales = **defaults propuestos por el leader**, ajustables por Raf/Facundo antes de la spec.
> **"Partos próximos" descartada** (Facundo 2026-06-19: la fecha estimada de parto no se puede garantizar → no sirve de base de alerta).

1. **Próxima dosis vencida** (vacunas/tratamientos) — `sanitary_events.next_dose_date < hoy` sin dosis posterior del mismo producto/animal. (`next_dose_date` ya existe.) **CONFIRMADA por Facundo.** **Sin modelo de protocolo/calendario**: la alerta se apoya en el `next_dose_date` que el operador carga al registrar el evento; un calendario sanitario completo es Plan Pro (`campaign_id` es un TODO en `0027`).
2. **Animales sin pesar** — activos sin ningún `weight_event`, o con último pesaje hace > **180 días** (cadencia de cría; **tentativo → validar con Facundo** umbral + a qué animales aplica, para que no sea ruido: en cría el adulto casi no se pesa, el pesaje relevante es el del ternero al destete).

## 7. Arquitectura de cómputo

- **Server-side, online-only.** Vistas SQL y/o RPC `SECURITY DEFINER` que agregan, scopeadas por `establishment_id` (paridad con la RLS as-built; nunca exponer datos cross-tenant en una agregación).
- **Estado offline gracioso**: sin señal → la pantalla informa "necesitás conexión para ver reportes" (nice-to-have: cachear el último resultado read-only). NO se intenta computar offline en MVP.
- **SCHEMA/RLS-sensitive** (vistas/RPC nuevas que leen across tablas) → **Gate 1 (security_analyzer modo spec) OBLIGATORIO** antes de la Puerta de spec. Foco: que ninguna agregación filtre datos de un establecimiento donde el usuario no tiene rol activo; RPC con EXECUTE/grants correctos.

## 8. Granularidad, filtros, navegación

- **Nivel rodeo** como unidad primaria (reusa el Inicio rodeo-céntrico de spec 10) + **rango de fechas / período**.
- **Resumen por sesión**: se elige la jornada (lista de `sessions` del rodeo).
- **Comparativa**: dos sesiones del mismo `rodeo_id` lado a lado con delta (alcance del acceptance).
- **Navegación**: pantalla "Reportes" en el tab reservado por ADR-018. Estructura tentativa: KPIs del rodeo (cards) · alertas · acceso a resumen de sesión + comparativa. Diseño se cierra en la spec con veto design-review.

## 9. Edge cases a cubrir en la spec

- Rodeo sin hembras / sin eventos → empty states cálidos, no "0%/NaN".
- Denominador cero en %preñez/%parición → mostrar "—" o "sin datos", nunca división por cero.
- Animales archivados (`status≠active`) → excluidos de KPIs de rodeo (¿incluibles en histórico de sesión? → spec).
- Eventos `deleted_at` → siempre excluidos.
- Sesión abierta (`status='active'`) vs cerrada → ¿el resumen aplica a abiertas? (default: sí, refleja el estado al momento).
- Multi-tenant: toda agregación scopeada por establecimiento activo.

## 10. Decisiones abiertas (para la spec / Facundo)

- ~~**D1 — Definición exacta de % parición.**~~ ✅ **RESUELTA (Facundo 2026-06-19): total paridas / total servidas × 100.**
- **D2 — Alerta "sin pesar": EN CONSULTA ACTIVA con Facundo (2026-06-20), antes de escribir la spec** (Raf). El `spec_author` queda EN ESPERA hasta cerrarla. Preguntas a Facundo:
  1. ¿La alerta de "sin pesar" tiene valor real en cría, o el pesaje es tan esporádico que no aplica como alerta? Si tiene valor, ¿en qué **categorías** (terneros al pie/destete · recría · vaquillonas de reposición · vacas adultas)?
  2. ¿Conviene medirla por **"días desde el último pesaje"** o atarla a un **hito**? Ej: terneros que pasan el destete sin peso registrado · **vaquillonas que llegan al entore sin peso objetivo** (~60-65% del peso adulto, ~300 kg). ¿Cuál es más accionable?
  3. **Umbral concreto**: si es por cadencia, ¿cada cuánto debería pesarse cada categoría que sí se pesa? Si es por hito, ¿qué hito y qué peso objetivo?
  4. ¿La **condición corporal** (CC, escala 1-9; ya existe `condition_score_events`) reemplaza al peso para las vacas adultas? ¿La alerta debería mirar CC en vez de / además de peso para adultos?
  *(El umbral de "partos próximos" quedó sin efecto: la alerta se eliminó.)*
- ~~**D3 — ¿Exportar el reporte a PDF/archivo en MVP?**~~ ✅ **RESUELTA (Raf 2026-06-19): NO, post-MVP.**
- ~~**D4 — Período por defecto** de los KPIs.~~ ✅ **RESUELTA (Raf + Facundo 2026-06-19): campaña reproductiva (estación de servicio), configurable por rodeo/lote.** Ver §12.

> **Nota sobre D4 y %parición:** "paridas / servidas" sobre la *misma* ventana de calendario es engañoso, porque entre el servicio y el parto pasan ~9 meses (las que paren hoy se sirvieron el año pasado). La unidad natural en cría es la **campaña reproductiva** (entore → parición ~283 días después): el numerador (paridas) y el denominador (servidas) deben referirse al **mismo grupo de servicios**, no al mismo mes calendario. Por eso D4 no es cosmético.

## 11. Gates que aplican

- **Gate 0**: este documento → ⏸ **Puerta 1 (aprobación humana del contexto)**.
- **Gate 1 (security spec)**: OBLIGATORIO (vistas/RPC nuevas, lectura cross-tabla scopeada por tenant).
- **Gate 2 (security code)**: en cada chunk de implementación.
- Veto de diseño del leader (skill `design-review`) sobre toda pantalla antes de mostrársela a Raf.

## 12. Modelo de campaña reproductiva (estación de servicio) — cierra D4

> Validado por Facundo (2026-06-19) + fuentes (INTA, Producción Animal, Revista Chacra) — ver §13.

- **La campaña reproductiva es la unidad temporal de los KPIs reproductivos** (%preñez, %parición). El período por defecto al abrir reportes = la campaña vigente/última de ese rodeo.
- **Servicio estacionado de primavera = default dominante**: entore concentrado en **primavera-verano**, meses **OCT-NOV-DIC** (extensible a ENE). Objetivo zootécnico: hacer coincidir el pico de oferta forrajera con el pico de requerimientos (lactancia/celo) → 1 ternero/vaca/año.
- **Duración típica del entore: ~90 días** (ciclo estral de 21 días → 4 oportunidades de celo). **60 días** en vaquillonas de primer servicio.
- **Servicio de otoño** (JUN-JUL) = minoritario; quienes lo usan **suelen tener simultáneamente rodeos/lotes de primavera**.
- **CONSECUENCIA DE MODELADO (importante para la spec):** como un mismo establecimiento puede correr entore de primavera **y** de otoño en distintos rodeos/lotes a la vez, **la estación de servicio se configura a nivel rodeo/lote, NO a nivel establecimiento.** Numerador (paridas) y denominador (servidas) de %parición se acotan a la ventana de servicio de *ese* rodeo.
- **Mecanismo de config — RESUELTO (Raf 2026-06-19): config explícita por rodeo, selector de los 12 meses.**
  - Al **crear un rodeo de cría** se pregunta la estación de servicio mediante un **selector/tilde de los 12 meses**: el usuario marca en qué meses ese rodeo tiene servicio (ej. primavera = Oct/Nov/Dic tildados; otoño = Jun/Jul; o ambos; o continuo). Más flexible que "estación + duración": captura cualquier patrón directamente.
  - **Schema (delta sobre spec 02 `rodeos`):** un campo por rodeo con el conjunto de meses de servicio — ej. `service_months smallint[]` (1-12) o bitmask `service_months_mask smallint` (12 bits). El spec_author elige la representación. **Schema additivo → cae dentro del Gate 1 que ya aplica.**
  - **Cross-spec:** la pregunta vive en el **wizard de creación de rodeo** (spec 02 C1, ya construido) + **editable** en la edición del rodeo. Es un delta acotado a spec 02 (frontend + schema); coordinar al implementar (no colisiona con SIGSA/feature 8).
  - **Default + rodeos existentes:** default sugerido = **primavera (Oct/Nov/Dic)** pre-tildado (caso dominante, no fricciona el alta); los rodeos ya creados arrancan sin config → los KPIs reproductivos invitan a configurarla (o asumen el default). A definir en la spec.
  - **Cómo alimenta el KPI:** la ventana de campaña de un rodeo se deriva de sus meses de servicio tildados (+ el offset de gestación ~283 días para alinear paridas con servidas). %parición = paridas / servidas dentro de esa campaña.

## 13. Fuentes (investigación D4, 2026-06-19)

- INTA — Servicio estacionado: ¿en qué meses realizarlo? (repositoriosdigitales.mincyt.gob.ar)
- Producción Animal — Épocas de servicio y parición (produccion-animal.com.ar)
- Agrositio / Engormix — Manejo del rodeo de cría: elección de época y duración del servicio
- Revista Chacra / De Frente al Campo / Decisión Ganadera — Recomendaciones de estacionamiento de servicio (60-90 días, primavera-verano, 3% de toros)
