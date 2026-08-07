# ADR-032 — Las campañas cerradas son una foto inmutable (snapshot al cierre + estado histórico del animal)

**Status**: Accepted
**Fecha**: 2026-08-07
**Decisores**: Raf (las 3 decisiones de la §4). Análisis y reproducción: leader.
**Reemplaza**: el `[TENTATIVO]` de `0105_repro_denominator.sql:88-94` ("el MVP toma la MEMBRESÍA ACTUAL del
rodeo… el historial de membresía por fecha NO se modela en MVP") — deja de ser una simplificación aceptada
y pasa a ser el defecto que este ADR corrige.

---

## 1. Contexto

Los reportes reproductivos (spec 07, Stream C) se computan como RPC parametrizadas por `(p_rodeo_id, p_year)`.
La intención declarada es "los KPI de esta campaña". El comportamiento real es otro: **el año casi no
participa del cómputo, y el reporte de una campaña pasada se recalcula con el estado de HOY de los animales.**

El benchmarking año a año es uno de los **tres pilares** del producto (`CONTEXT/01-producto.md`). Un productor
que compara la preñez 2024 vs 2025 para decidir si le sirvió cambiar de toro no está comparando dos campañas:
está comparando dos consultas sobre el padrón de hoy. Los números están, son creíbles, y cambian solos.

### 1.1 Reproducido en la DB de DEV, no deducido del SQL

Probe contra el proyecto DEV (2026-08-07). Rodeo de cría, `service_months = {6,7}`, 3 multíparas activas,
las 3 tactadas **preñadas** en sep-2025, una con parto en mar-2026. Ese es "el reporte que el productor
imprimió" al cerrar 2025:

| momento | acción | `rodeo_pregnancy_kpi(rodeo, **2025**)` |
|---|---|---|
| T0 | — | `serviced 3, pregnant 3, empty 0` → **100 % preñez** |
| T1 | se carga un **tacto vacío fechado en 2026** sobre la vaca A | `serviced 3, pregnant 2, empty 1` → **67 %** |
| T2 | se **vende** la vaca B (`status='sold'`) | `serviced 2, pregnant 1` — y `calved` cae de 1 a **0** |
| T3 | se **mueve** la vaca C a otro rodeo | `serviced 1, pregnant 0, empty 1` → **0 %** |

El reporte de 2025 pasó de **3 servidas / 3 preñadas** a **1 servida / 0 preñadas** sin que nadie tocara un
solo dato de 2025. Ninguna de las tres acciones es un error del usuario: son las tres cosas que un campo de
cría hace todos los años.

Dos hallazgos más del mismo probe, ambos verificados ejecutando:

- **El rodeo destino se queda con la historia ajena.** Tras T3, el KPI **2025** del rodeo nuevo devuelve
  `serviced 1, pregnant 1` — un rodeo que en 2025 no tuvo a esa vaca reporta su tacto de 2025 como propio.
- **El año es decorativo para el servicio natural.** Pedir el KPI de **2020** —un año en el que el campo no
  existía y sin un solo evento cargado— devuelve **exactamente el mismo reporte que 2025**
  (`serviced 3, pregnant 3`). El `YearStepper` de la UI, en un rodeo de servicio natural puro, no cambia nada
  salvo la rama de IA y los partos.

Probe 2 (mismo método) cerró dos puntos que el primero dejó abiertos:

- **Un cambio de categoría reescribe el pasado.** Pasar la multípara a `cut` la saca del denominador de 2025.
  Y un veredicto `tacto_vaquillona = 'no_apta'` **fechado en 2026** deja la campaña 2025 en `serviced: 0` —
  la campaña pasada no cambia de número: **desaparece**.
- **`entoradas = servidas − retiradas` nunca resta nada en cría natural.** `retired` se calcula sobre el
  conjunto servidas, pero la rama natural ya excluye `status <> 'active'` → la vendida jamás entra al
  conjunto y por lo tanto jamás se cuenta como retirada. Medido: se vende una vaca, `serviced` baja de 1 a 0
  y `retired` se queda en 0. El "denominador explícito" que la UI muestra es, en cría, siempre
  `entoradas == servidas`.

### 1.2 Las cuatro fugas, y qué historia existe para taparlas

| # | fuga | dónde | ¿hay historia para reconstruir? |
|---|---|---|---|
| F1 | el numerador toma el **último tacto de toda la vida** del animal, sin filtro de fecha | `0106:242-249` (y espejado en `0117`, `0106:308`, `0106:376`) | **no hace falta**: `reproductive_events.event_date` ya está |
| F2 | el estado se lee del `status` **actual** | `0105:122` | **sí** — `animal_profiles.exit_date`: **21/21** perfiles no-activos de DEV lo tienen poblado, y la RPC `exit_animal_profile` (0044) lo exige como parámetro sin default |
| F3 | la categoría se lee de la **actual** | `0105:121,127-144` | **sí** — `animal_category_history` (0030), con `from_category_id`/`to_category_id`/`changed_at` |
| F4 | la membresía de rodeo se lee de la **actual** | `0105:119` | **NO EXISTE.** `moveAnimalToRodeo` (`app/src/services/animals.ts:1683`) es un UPDATE plano de `rodeo_id`, sin evento ni fila de historia |

F4 es la peor de las cuatro porque **el rodeo es la llave de partición de todo reporte**: no hay un solo KPI
que no esté parametrizado por `p_rodeo_id`.

El audit forense de spec 18 (`0124_audit_log.sql`) **no sirve** para esto, verificado en DEV: hay un único
trigger `audit_i_u_d`, y está sobre `user_roles`. Aunque cubriera `animal_profiles`, su retención es de
**90 días** — una campaña del año pasado ya no estaría.

### 1.3 Superficie afectada

Las **6 RPC** parametrizadas por `p_year`: `rodeo_serviced_females` y `rodeo_repro_denominator` (0105) —
que son el denominador común— más `rodeo_pregnancy_kpi`, `rodeo_calving_kpi` (re-creada por `0117`),
`rodeo_ccl_distribution`, `rodeo_calving_by_stage` (0106) y `rodeo_weaning_kpi` (`0118`, **no estaba en el
inventario original del handoff**). Las 4 RPC sin `p_year` (`session_event_summary`, `rodeo_sessions_list`,
`rodeo_weight_by_category`, `establishment_overdue_doses`, `establishment_unweighed`) trabajan sobre el
presente por diseño y quedan fuera del alcance.

UI: `app/app/(tabs)/reportes.tsx` (`YearStepper`, `useRodeoKpis`, `defaultCampaignYear`).

### 1.4 Cuántos datos hay contaminados hoy

Barrido de DEV: **una sola campaña pasada con datos reales** — "La Facundina" (el campo demo de Facundo),
2 rodeos con `service_months` configurados y tactos de 2025 **y** 2026. Todo el resto de los rodeos con datos
tiene eventos de un único año (2026) o son fixtures de suites. **No hay ningún cliente productivo con
histórico que salvar.**

---

## 2. La arruga: la campaña no es el año calendario

Raf planteó el freeze como *"a partir del 1ro de enero de 2026 los reportes de 2025 se frizan"*. **Esa fecha
no puede ser el disparador**, y eso se verificó, no se supuso:

- el rodeo declara `service_months`, y el código maneja el cruce de fin de año por set-membership
  (`0106` cabecera, R7.5.8): un rodeo que sirve de noviembre a febrero tiene una campaña que cruza el almanaque;
- pero sobre todo, **una campaña sigue produciendo hechos mucho después del año en que se sirvió**. Servicio
  jun-jul 2025 → **partos** mar-abr 2026 → **destetes** ~sep-nov 2026, y las tres cosas se imputan a la
  campaña **2025**: `calved` usa `parto − 9 meses ∈ (p_year, service_months)` (`0117`), y `rodeo_weaning_kpi`
  imputa "por AÑO DE SERVICIO, no por año calendario del destete" (`0118:105-108`), con el propio código
  documentando que el destete "cae ~6-8 meses tras el parto, muy variable" (`0118:87-88`).

Congelar la campaña 2025 el 1/1/2026 dejaría **%parición y %destete de 2025 en 0 para siempre**. La campaña
2025 recién está completa a fines de 2026.

---

## 3. Decisión

**Un reporte de campaña cerrada es un snapshot persistido e inmutable. Y para que ese snapshot valga algo,
los KPI se computan sobre el estado que el animal tenía DURANTE la campaña, no sobre el de hoy.**

Las dos mitades son necesarias y ninguna reemplaza a la otra:

- El **cómputo histórico** hace que el número sea correcto el día que se lo toma. Sin él, congelar solo
  fotografía el error.
- El **snapshot** es lo único que da la garantía que Raf pidió (*"no se recalculan ni con ventas ni con nuevos
  datos ni con nada"*). Un cómputo histórico perfecto **igual se movería si mañana cambia la fórmula** — y las
  fórmulas de este producto ya cambiaron dos veces (`0117` el status de parición, `0118` el destete). Solo un
  valor persistido sobrevive a un cambio de fórmula.

---

## 4. Las tres decisiones de Raf (2026-08-07)

### 4.1 El cierre lo dispara el productor, y la app se lo sugiere

**Manual, por rodeo y por campaña.** La app detecta que el ciclo se completó (último destete de la campaña
cargado, o vencida la ventana) y **avisa**; el que cierra es el productor. Motivo: es el único que sabe si
terminó de cargar. Un cierre automático congela con los datos que todavía no subieron del cuaderno.

Corolarios que la spec tiene que resolver:
- **una campaña sin cerrar no está congelada**: se sigue computando en vivo, y la UI tiene que decirlo.
- **el cierre es un hecho con fecha y autor**, y tiene que poder deshacerse (con rastro) mientras nadie haya
  cerrado la campaña siguiente — un cierre por error a mitad de la parición no puede ser irreversible.
- el gesto de cierre vive en la pantalla de reportes del rodeo, no en un menú de configuración.

### 4.2 El pasado: se re-seedea La Facundina

Como la única campaña pasada con datos vive en un campo **seedeado para demo**, se lo regenera con su campaña
2025 ya cerrada y correcta, en vez de congelar un número contaminado. La demo a inversores muestra entonces
una comparativa 2025 vs 2026 real.

**No se hace backfill de campañas cerradas para nadie más**, porque no hay nadie más. El freeze arranca con la
primera campaña que se cierre con el mecanismo nuevo.

### 4.3 El alcance: se tapan las cuatro fugas, incluida la historia de rodeo

Se agrega la **historia de membresía de rodeo por fecha** (F4), que hoy no existe. Es la decisión más cara de
las tres y se tomó a conciencia: es el único camino a un histórico fiel, y destraba además la spec 11
(transferencias), que hoy pierde el rastro del origen.

Con las cuatro tapadas, el conjunto "servidas de la campaña N" pasa a significar *quiénes estuvieron en este
rodeo, en esta categoría y en el padrón durante la campaña N* — que es lo que su nombre siempre prometió.

---

## 5. Consecuencias

**A favor**
- El benchmarking año a año pasa a ser real. Es el pilar que justificaba el trabajo.
- Los reportes cerrados dejan de depender de la disponibilidad del servidor para recomputarse: un snapshot se
  lee, no se calcula (mejora la latencia y abre la puerta a la cache offline de R7.2.3, hoy no implementada).
- La historia de rodeo destraba la spec 11 y hace auditable la transferencia.

**En contra / costos**
- **Es un cambio de modelo de datos**, no un fix de query: tabla de snapshots + tabla de historia de membresía
  + backfill de la membresía actual como fila inicial. Toca DB → **Gate 1**.
- Las 6 RPC con `p_year` se reescriben. Su contrato de seguridad (`0106` cabecera §5.1-§5.10: guard
  `has_role_in` fail-closed como primera sentencia, `SECURITY DEFINER STABLE set search_path`, cota de
  `p_year`, tenant por el JOIN a `animal_profiles`) **se preserva íntegro** en cualquier RPC nueva o
  modificada.
- Aparece un estado nuevo en la UI ("campaña cerrada" vs "en curso") que hay que comunicar sin ensuciar la
  pantalla.
- **Riesgo asumido**: el cierre manual puede no ocurrir nunca (el productor no aprieta el botón). La campaña
  queda en vivo y sigue moviéndose. Se mitiga con el aviso, no se elimina.

**Lo que NO se rediscute**: que los reportes cerrados sean una foto inmutable. Eso es decisión de producto de
Raf del 2026-08-07 y este ADR la implementa, no la evalúa.

**Fuera de alcance de este ADR**: `entoradas = servidas − retiradas` está estructuralmente roto para servicio
natural (§1.1). Es un defecto **distinto** —el número está mal hoy, no solo en el pasado— y se anota en
`docs/backlog.md` para no mezclar dos problemas en una spec.

---

## 6. Alternativas consideradas

| alternativa | por qué no |
|---|---|
| **Solo arreglar el cómputo** (acotar por fecha, sin persistir) | No cumple la decisión de producto: el número se mueve igual si cambia la fórmula, y las fórmulas ya cambiaron dos veces (`0117`, `0118`). |
| **Solo snapshot** (congelar lo que la fórmula da hoy, sin tocar el cómputo) | Congela el error. Si alguien vendió o movió animales antes del cierre —lo normal—, el número congelado nace mal y queda mal para siempre. Era la opción barata y se descartó explícitamente. |
| **Congelar por fecha automática (1/1)** | Verificado imposible: dejaría %parición y %destete en 0 para siempre (§2). |
| **Reconstruir todo desde el audit log de spec 18** | El audit cubre solo `user_roles` (verificado en DEV) y tiene retención de 90 días. No alcanza ni de cerca. |

---

## 7. Trazabilidad

- Handoff de origen: `progress/handoff-reportes-campanas-congeladas.md`.
- Evidencia empírica de los dos probes: `progress/repro_reportes-campanas-congeladas.md`.
- Entrada de backlog: `docs/backlog.md`, 2026-08-07 (commit `f897fed`).
- Feature afectada: **07-reportes-basicos** (`done`) → el cambio se documenta como **delta-spec** sobre una
  feature cerrada, según **ADR-028**.
- Specs a reconciliar: `specs/active/07-reportes-basicos/{requirements,design,tasks}.md` y el `[TENTATIVO]` de
  membresía de `specs/active/02-modelo-animal` / `0105`.
