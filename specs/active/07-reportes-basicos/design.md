# Design — Feature 07: Reportes / Analytics (Stream C)

> Cómo se construye lo de `requirements.md`. Cubre: la decisión **RPC vs Edge Function** para el cómputo
> server-side (con su alternativa descartada), el shape de cada reporte, la estrategia online-only, la seguridad
> (tenant-scope, anti-IDOR), y la UI. Apoyado en `architecture.md`, `conventions.md`, `docs/specs.md` y el
> Stream A as-built (`0102`/`0104`/`0105`).
>
> **Lo que esta feature CONSUME (ya deployado / a deployar por el leader):**
> - `rodeos.service_months smallint[]` (`0102`) — meses de servicio del rodeo (NULL = sin configurar).
> - `rodeo_service_campaign(p_rodeo_id, p_year)` (`0105`) → `is_configured, n_months, months, window_start, window_end`.
> - `rodeo_serviced_females(p_rodeo_id, p_year)` (`0105`) → `(animal_profile_id, source)` — el conjunto SERVIDAS.
> - `rodeo_repro_denominator(p_rodeo_id, p_year)` (`0105`) → `(serviced, retired, entoradas)` — denominador explícito.
> - `compute_category` sin service (`0104`) y `pregnancy_status` del tacto (`0026`, Stream B).
> - `pregnancy-buckets.ts` (regla CCL cliente, DD-PSC-3) — **fuente única** de la regla de buckets por meses.

> **Cambios in-place posteriores (Nivel A — ADR-028):**
> - **#9 copy "KPIs"→"Datos" (2026-06-29):** en `app/app/(tabs)/reportes.tsx` el texto visible al usuario dejó
>   de decir "KPIs" — el spinner ahora dice "Calculando los datos…" y el empty de servicio "…ni los datos
>   reproductivos." (los identificadores de código `KpiCard`/`useRodeoKpis`/`kpis` NO cambian, no son visibles).

---

## Deltas posteriores (ADR-028)

> Índice de los delta-specs que extienden esta feature `done` (Stream C). El baseline no se reescribe; cada
> delta vive en su propio `{context,requirements,design,tasks}-<slug>.md` en esta carpeta.

| Slug | Qué agrega | Estado |
|---|---|---|
| `paricion-fix` | **#8** — el KPI `rodeo_calving_kpi` daba **0% engañoso** con `service_months` vacío. Migración `0117` (DROP+CREATE, agrega `status` [`no_service_months`/`not_calving_season`/`not_applicable_12m`/`ok`] + `pending_pregnant`; el conteo `calved` NO cambia). La card muestra "—" + mensaje accionable en vez del 0%, % real en `ok`, leyenda si quedan preñadas sin parir. `calvingCardView` puro. **CON BACKEND** (`0117`, deployado). | done (Puerta 2, 2026-07-10) |
| `destete-kpi` | **#10** — RPC **nueva** `rodeo_weaning_kpi` (migración `0118`, CREATE): cierra el ciclo servida→parida→**destetada** (%destete = destetados/servidas, imputado por año de servicio). `status` (no_service_months / not_applicable_12m / **not_weaning_season** data-driven / ok) + leyenda de destete parcial. Card **Destete** nueva. `weaningCardView` puro (espejo de `calvingCardView`). **CON BACKEND** (`0118`, deployado). | done (Puerta 2, 2026-07-10) |

> **Fix de casing es-AR (2026-07-10, foldeado con la Puerta 2):** los mensajes de estado (`note`) y las 2
> leyendas de ambas cards (`calvingCardView`/`weaningCardView` en `reports-format.ts`) estaban en **minúscula
> inicial** (único caso user-facing de la app; el resto va sentence-case) — Raf lo cazó en la Puerta 2. Se
> corrigieron a **sentence-case** (solo la inicial): "Todavía no es época de parición", "Sin meses de servicio
> configurados", "No aplica (servicio todo el año)", "Todavía no empezó el destete", "Sin datos", etc. El copy
> citado en `design-paricion-fix.md`/`design-destete-kpi.md`/requirements/context/tasks quedó reconciliado.

---

## 0. Resumen de la decisión arquitectónica

**El cómputo de reportes se hace con funciones SQL `SECURITY DEFINER STABLE` (RPC vía PostgREST), NO con Edge
Functions.** Es la continuación natural del Stream A (el denominador YA son 3 RPCs de ese tipo): las
agregaciones se expresan limpio en SQL, el tenant-scoping reusa el mismo guard `has_role_in`, y se evita una
segunda superficie de auth en Deno. El cliente las llama con `supabase.rpc(...)` (online-only) a través de una
capa `services/reports.ts`. Detalle y alternativa descartada en §3.

---

## 1. Archivos a crear / modificar

### Backend (SQL — migraciones nuevas, las aplica el leader post-Gate-1/2)

| Archivo | Qué |
|---|---|
| `supabase/migrations/01NN_reports_session_summary.sql` | RPC `session_event_summary(p_session_id)` + `rodeo_sessions_list(p_rodeo_id)`. Conteo por tipo de evento de una sesión (R7.3) + lista de sesiones (R7.3.6). |
| `supabase/migrations/01NN_reports_repro_kpis.sql` | RPC `rodeo_pregnancy_kpi(p_rodeo_id, p_year)` (R7.5), `rodeo_calving_kpi(p_rodeo_id, p_year)` (R7.6), `rodeo_ccl_distribution(p_rodeo_id, p_year)` (R7.7), `rodeo_calving_by_stage(p_rodeo_id, p_year)` (R7.8). Consumen las 3 RPC de Stream A. |
| `supabase/migrations/01NN_reports_weight_by_category.sql` | RPC `rodeo_weight_by_category(p_rodeo_id)` (R7.9). |
| `supabase/migrations/01NN_reports_alerts.sql` | RPC `establishment_overdue_doses(p_establishment_id, p_lookback_days, p_limit)` (R7.10 — con cota de escaneo, M4) + `establishment_unweighed(p_establishment_id, p_threshold_days, p_category_codes)` (R7.11, parametrizada — `[SUPUESTO]`). Las dos abren con `has_role_in(p_establishment_id)` como 1ª sentencia (M1). |

> Numeración real (`01NN`) la asigna el implementer según el último prefijo libre. Cada migración incluye
> `revoke ... from public, anon` + `grant ... to authenticated` + smoke-check fail-closed (patrón `0105`) en la
> misma migración (`conventions.md` — SQL).

### Cliente (RN/Expo — TypeScript)

| Archivo | Qué |
|---|---|
| `app/app/(tabs)/reportes.tsx` | Reemplaza el stub. Pantalla Reportes: selector de rodeo + cards de KPIs + alertas + acceso a resumen/comparativa de sesión (R7.1). |
| `app/app/reportes/sesion/[id].tsx` | Resumen de una sesión (R7.3). |
| `app/app/reportes/comparar.tsx` | Comparativa de dos sesiones del mismo rodeo (R7.4). |
| `app/src/services/reports.ts` | Capa `services` (boundary I/O): llama las RPC vía `supabase.rpc`, traduce a `Result<T, AppError>`, detecta offline. Única capa que toca I/O de reportes (`architecture.md`). |
| `app/src/hooks/use-reports.ts` | Hooks que orquestan `reports.ts` y exponen estado a las pantallas (loading/online/error). |
| `app/src/utils/calving-stage.ts` | **Helper PURO** del mapeo nacimiento↔etapa por MES (mes de parto − 9 → bucket del rodeo), espejo de `pregnancy-buckets.ts`. Testeable con `node:test`. Se usa para etiquetar la distribución de nacimientos en la UI y como espejo de la lógica SQL (R7.8). |
| `app/src/components/reports/*` | Cards/empty-states reutilizables (KpiCard, CclBars, AlertList, EmptyState). Sin fetch directo (`architecture.md`). **Sin `DenominatorToggle`** — base única servidas sin selector (Puerta de spec 2026-06-24, R7.5.3/R7.6.4). |

### Tests (runners Node-nativos backend — `architecture.md`)

| Archivo | Qué |
|---|---|
| `supabase/tests/reports/run.cjs` | Suite no-bypass de las RPC de reportes: tenant-scope/anti-IDOR, read-only, revoke anon/public, 0-denominador sin NaN, exclusión de borrados/archivados, %preñez/%parición/CCL/peso correctos sobre fixtures, alertas. Mismo patrón que `supabase/tests/puesta-en-servicio/run.cjs`. **Roja-hasta-apply** (las migraciones no se aplican hasta Gate 2 + autorización de Raf). |
| `app/src/utils/calving-stage.test.ts` | Tests puros del mapeo por mes (node:test, espejo de `service-months.test`). |

> Los tests de UI (Jest/RNTL) aún no están seteados (`conventions.md` — Tests); la cobertura autoritativa de esta
> feature es la suite backend de las RPC + el helper puro. La UI se valida con el veto `design-review` del leader
> + (si corresponde) E2E Playwright cuando el shell de reportes sea navegable.

---

## 2. Shape de cada reporte (contratos de las RPC)

> Todas las RPC son `language plpgsql security definer stable set search_path = public`, con **guard
> `has_role_in` al entrar** y cota de `p_year` cuando aplica (patrón `0105`). Devuelven `TABLE(...)` o un row.
> Los nombres de columna van en snake_case; el cliente los mapea a camelCase en `reports.ts`.

### 2.1 Resumen de sesión — `session_event_summary(p_session_id uuid)` (R7.3)

Guard: deriva `establishment_id` de la sesión (`sessions.establishment_id`, validando `deleted_at IS NULL`) y exige
`has_role_in(v_est)` como 1ª sentencia tras el lookup (§5.1). Devuelve un conteo por tipo de evento de esa
`session_id` sobre las **7 tablas con FK `session_id` del as-built** (`weight_events`, `reproductive_events`,
`sanitary_events`, `condition_score_events`, `lab_samples`, `scrotal_measurements`, `custom_measurements`), todos
`deleted_at IS NULL`. El tenant en cada una se asegura por el **join a `animal_profiles` con `p.establishment_id =
v_est`** (M2, §5.5) — defensa en profundidad sobre el guard de entrada. Para el histórico de sesión, R7.13.2
**incluye** animales hoy archivados (la jornada es un hecho pasado — **decisión CERRADA en la Puerta de spec
2026-06-24**), así que este conteo **no** filtra `p.status='active'` (a diferencia de los KPIs de rodeo, §5.6); sí
filtra `p.deleted_at IS NULL` siempre (M3).
**`animal_events` NO tiene `session_id`** (verificado `0034`/`0052`) → no entra:

```
returns table (
  event_kind   text,    -- 'weight' | 'reproductive' | 'sanitary' | 'condition' | 'lab' | 'scrotal' | 'custom'
  event_count  int,
  animals      int      -- animales DISTINTOS con ≥1 evento de ese kind en la sesión
)
```
La pantalla además lee de la fila `sessions` (vía service/PowerSync local ya existente) `started_at/ended_at/
status/rodeo_id` para el marco temporal (R7.3.2/.4) y el total de animales intervenidos (distinct sobre todos
los kinds). Empty state si todos los `event_count = 0` (R7.3.5).

`rodeo_sessions_list(p_rodeo_id uuid)` (R7.3.6): lista `(id, started_at, ended_at, status, animal_count,
event_count)` de las sesiones no borradas del rodeo, `order by started_at desc`, con guard de tenant. *(Alternativa
de implementación: la lista de sesiones del rodeo ya puede leerse del SQLite local vía `sessions.ts` —
`sessions` es una tabla sincronizada. El implementer elige; si usa la lectura local existente, esta RPC no se
crea y R7.3.6 se cubre client-side. Documentar la elección al implementar.)*

### 2.2 %Preñez — `rodeo_pregnancy_kpi(p_rodeo_id uuid, p_year int)` (R7.5)

```
returns table (
  is_configured boolean,   -- de rodeo_service_campaign; false → la UI muestra "configurá la estación" (R7.5.6)
  serviced      int,       -- de rodeo_serviced_females (denominador base)
  entoradas     int,       -- de rodeo_repro_denominator
  pregnant      int,       -- numerador: servidas con tacto+ vigente (R7.5.2)
  empty         int        -- servidas con último tacto = 'empty' (insumo de %pérdida; research §1)
)
```
Numerador `pregnant` = del conjunto `rodeo_serviced_females(p_rodeo_id, p_year)`, las hembras cuyo **último**
`tacto` (event_type='tacto', `order by event_date desc, created_at desc`) tiene `pregnancy_status ≠ 'empty'`
sin `abortion` posterior — **misma subquery que `compute_category` RT2.7.5** (`0104` líneas 91-104), para no
duplicar la regla. La UI calcula `pregnant/serviced×100` — **base ÚNICA servidas, sin toggle** (Puerta de spec
2026-06-24, R7.5.3); `serviced = 0` → la UI muestra "—" (R7.5.4), la RPC nunca divide. Se devuelven absolutos
para el denominador explícito (R7.5.5: "preñadas 41 / servidas 46"). `entoradas` se sigue devolviendo como insumo
(uso interno / coherencia con la firma de Stream A), pero el %preñez **no** ofrece alternar a esa base en el MVP.

### 2.3 %Parición — `rodeo_calving_kpi(p_rodeo_id uuid, p_year int)` (R7.6)

```
returns table (
  is_configured boolean,
  serviced      int,
  entoradas     int,
  pregnant      int,   -- insumo de la pérdida preñez→parición: se ve comparando %preñez vs %parición (R7.6.4), NO como base alterna
  calved        int    -- numerador: servidas con ≥1 birth mapeable a la campaña (R7.6.2)
)
```
`calved` = del conjunto servidas, las hembras con ≥1 `reproductive_events` (event_type='birth', no borrado) cuyo
**mes de concepción derivado** = `(extract(month from birth.event_date) - 9)` normalizado a 1-12 (wrap), y ese
mes ∈ `service_months` del rodeo (Gate 0 §5; alinea paridas con servidas, misma campaña). El año del `birth`
relevante = `p_year + 1` para meses de parto que caen después de la concepción (la concepción es en `p_year`, el
parto ~9 meses después). **Esta ventana temporal del parto es el punto fino**: el MVP la deriva del mes de
concepción ∈ `service_months` y el rango de fechas de parto coherente con `p_year` (concebidas en la campaña
`p_year` → paren entre `p_year` y `p_year+1`). Se documenta y se cubre con fixtures en `reports/run.cjs`.

> **Base del %parición (R7.6.4, Puerta de spec 2026-06-24):** la UI calcula `calved/serviced×100` — **base ÚNICA
> servidas, sin toggle**, igual que %preñez. La **pérdida preñez→parición** se hace visible **comparando los dos
> KPIs sobre la misma base servidas** (%preñez = `pregnant/serviced`, %parición = `calved/serviced`), no con un
> selector de base "/ preñadas". Por eso `pregnant` se devuelve como insumo, pero la UI no lo usa como denominador
> alterno. Selector de base = post-MVP si hace falta.
>
> **Wrap de fin de año (R7.5.8, Puerta de spec 2026-06-24):** el criterio `mes de concepción ∈ service_months` ya
> resuelve por **set-membership** (no `BETWEEN window_start..window_end` con wrap) los servicios Nov-Dic-Ene —
> consistente con cómo Stream A trata `p_year` ("conjunto de meses del año", `0105`). Esto aplica tanto acá como
> en `rodeo_ccl_distribution`/`rodeo_calving_by_stage` (mismo conjunto servidas y mismo bucketing por mes).

### 2.4 Distribución CCL — `rodeo_ccl_distribution(p_rodeo_id uuid, p_year int)` (R7.7)

```
returns table (
  n_months  int,    -- de rodeo_service_campaign (gobierna cuántos buckets — R7.7.2)
  head      int,    -- preñadas con pregnancy_status = 'large'
  body      int,    -- 'medium'
  tail      int,    -- 'small'
  total     int     -- head+body+tail (base del %, R7.7.5)
)
```
Conteo del **último tacto+ vigente** de cada hembra preñada de la campaña, agrupado por `pregnancy_status`.
**El nº de buckets a mostrar lo decide el CLIENTE** con `sizeBucketsForServiceMonths(n_months)` de
`pregnancy-buckets.ts` (fuente única, evita drift cuando Facundo afine 4-11, Gate 0 §9): si la regla devuelve
`[]` (1/12/sin config) → la UI oculta CCL (R7.7.3); si devuelve `[Cabeza, Cola]` (2 meses) → la UI suma `body`
dentro de uno de los dos o lo omite según la convención del helper. La RPC devuelve los 3 conteos crudos; la
**presentación** (cuántas barras) la gobierna el helper compartido. Empty state si `total = 0` (R7.7.4).

### 2.5 Cruce tacto↔nacimientos — `rodeo_calving_by_stage(p_rodeo_id uuid, p_year int)` (R7.8)

```
returns table (
  n_months    int,
  head_born   int,  -- nacimientos cuyo mes-de-concepción cae en el tercio "cabeza" de service_months
  body_born   int,
  tail_born   int,
  total_born  int
)
```
Para cada `birth` de la campaña (mismo criterio de `calved`, R7.6.2), se ubica su **mes de concepción** en el
bucket (cabeza/cuerpo/cola) según la posición del mes dentro de `service_months` ordenado (tercios para 3-11;
cabeza/cola para 2). **La asignación mes→bucket es la misma lógica que el cliente** (`calving-stage.ts` la
refleja para etiquetar); la RPC la implementa server-side sobre `service_months`. La UI muestra esta
distribución **junto a** `rodeo_ccl_distribution` (R7.8.2) → el "cruce de oro" (Gate 0 §5). Degradado si
`total_born = 0` (R7.8.3).

> **Nota de consistencia (importante):** el bucketing por mes (tercios de `service_months`) vive en DOS lugares
> con la MISMA regla: (a) la asignación de un `birth` a su tercio (esta RPC) y (b) la regla de cuántos buckets
> mostrar (`pregnancy-buckets.ts`, cliente). La regla "cuántos buckets según n_months" es la **fuente única** de
> `pregnancy-buckets.ts`; la asignación "qué mes cae en qué tercio" es nueva y se implementa server-side +
> espejada en `calving-stage.ts` para la UI. Cuando Facundo cierre el bucketing 4-11 (Gate 0 §9), se ajustan
> ambos. Esto se anota como deuda de consistencia en `tasks.md`.

### 2.6 Peso por categoría — `rodeo_weight_by_category(p_rodeo_id uuid)` (R7.9)

```
returns table (
  category_id    uuid,
  category_code  text,
  category_name  text,
  avg_weight     numeric,  -- AVG del ÚLTIMO weight_event no borrado por animal activo
  n_animals      int       -- nº de animales que aportan (R7.9.2)
)
```
"Último peso por animal" vía `distinct on (animal_profile_id) ... order by animal_profile_id, weight_date desc,
created_at desc` (`weight_events.deleted_at IS NULL`), con el animal scopeado por el **join a `animal_profiles`**
filtrando `p.establishment_id = v_est` + `p.deleted_at IS NULL` + `p.status = 'active'` **en el join** (M2/M3,
§5.5-§5.6 — no por la columna denorm de `weight_events`, que es plumbing del sync), luego `avg`/`count` group by
categoría. Categorías del
rodeo sin ningún peso → no aparecen en la RPC; la UI las muestra como "sin pesar" si quiere listarlas todas
(R7.9.4). Formato es-AR (coma decimal) lo aplica la UI (R7.9.3). La **comparativa de peso** (R7.9.5) = la UI
llama la RPC para **dos sesiones del mismo rodeo** y computa el delta client-side (Puerta de spec 2026-06-24: la
comparativa del MVP es **por sesiones**, no por campañas). Para "por sesión" se filtra por los animales/eventos de
cada `session_id` (variante `..._for_session(p_session_id)` o parámetro opcional — el implementer elige;
documentar). *(La comparativa por campaña queda post-MVP — no se implementa la variante de dos campañas en el MVP.)*

### 2.7 Alertas

`establishment_overdue_doses(p_establishment_id uuid, p_lookback_days int default 365, p_limit int default 500)` (R7.10):
```
returns table (
  animal_profile_id uuid, idv text, visual_id_alt text,
  product_name text, next_dose_date date
)
```
`sanitary_events` no borrados, animal `status='active'` del establecimiento, `next_dose_date < current_date`, y
NOT EXISTS una dosis posterior del **mismo `product_name`** sobre el **mismo animal** (R7.10.1/.3). El animal se
scopea por el **join a `animal_profiles`** filtrando `p.establishment_id = v_est` (la columna denorm de
`sanitary_events` existe — 0077 — pero es plumbing del sync; la fórmula de tenant canónica de la tabla es por el
perfil; ver M2 en §5.5) **con `p.deleted_at IS NULL` + `p.status = 'active'` en el propio join, no vía el helper
`establishment_of_profile`** (M3, §5; el helper no filtra `deleted_at`). Guard `has_role_in(p_establishment_id)`
como **1ª sentencia ejecutable** (M1, §5.1) — no derivado de ninguna fila, el `p_establishment_id` viene del
cliente.
**Cota de escaneo (M4, §5.4):** la RPC es la única sin cota de input as-built (las de rodeo tienen `p_year`,
`establishment_unweighed` tiene `p_threshold_days`); para no escanear años de `sanitary_events` con un NOT EXISTS
correlacionado caro, acota la ventana con `p_lookback_days` (piso `next_dose_date >= current_date -
make_interval(days => p_lookback_days)`) y aplica `LIMIT p_limit` server-side (alerta = lista accionable, no
export). Validar `p_lookback_days >= 0` y `p_limit between 1 and 1000` tras el guard (raise `22023` fuera de
rango), espejo de la cota de `p_year` de `0105`. La UI ordena por `next_dose_date asc` (lo más vencido primero).

`establishment_unweighed(p_establishment_id uuid, p_threshold_days int default 180, p_category_codes text[] default null)` (R7.11 — umbral 180 d = default-MVP CERRADO, parametrizado; alcance/categorías sigue `[SUPUESTO]`/Facundo):
```
returns table (
  animal_profile_id uuid, idv text, visual_id_alt text,
  category_code text, category_name text,
  last_weight_date date,  -- null = nunca pesado
  days_since int          -- null = nunca pesado
)
```
Animales activos del establecimiento sin `weight_event` no borrado, o con último pesaje `< current_date -
p_threshold_days` (R7.11.1, umbral **default-MVP 180 d CERRADO** — Puerta de spec 2026-06-24); filtrado por
`p_category_codes` si se pasa (default null = el cliente pasa el conjunto `[SUPUESTO]` de categorías que se pesan
en cría — **esto sigue abierto/Facundo, D2**) (R7.11.2). Mismo scoping que arriba: **join a
`animal_profiles` con `p.establishment_id = v_est` + `p.deleted_at IS NULL` + `p.status = 'active'` en el join**
(M2/M3), excluyendo `weight_events` con `deleted_at` (R7.11.4). **Umbral y alcance siguen siendo parámetros** (no
hardcode): el umbral por una razón de tuneabilidad ("quizá lo modifiquemos", Raf) aunque ya esté decidido el
default; el alcance/categorías porque Facundo aún no lo cerró — cuando lo haga (D2), se cambia el conjunto que
pasa el cliente sin tocar la lógica. Guard `has_role_in(p_establishment_id)` como 1ª sentencia (M1). **Cota de input (M4 menor):**
validar `p_threshold_days between 0 and 3650` (0 a 10 años — tope concreto y holgado sobre cualquier cadencia
real de pesaje; lo hace testeable de forma determinística, espejo de la cota cerrada de `p_year` de `0105` y del
`p_limit between 1 and 1000` de `establishment_overdue_doses`) — raise `22023` fuera de rango — y acotar la
cardinalidad de `p_category_codes` (`cardinality <= 64`, holgado sobre el nº de categorías del sistema — L1) para
que un array gigante no fuerce un escaneo desmedido; los params son tipados de PostgREST, no SQL string, no son
vector de inyección (§5.8).

> **Por qué la alerta lleva los parámetros y no constantes hardcodeadas:** el **alcance/categorías** sigue abierto
> a Facundo (D2) → parametrizarlo es necesario para cerrarlo después sin reescribir la RPC. El **umbral (180 d)**
> ya está DECIDIDO para el MVP (Puerta de spec 2026-06-24) pero se deja parametrizado igual porque Raf lo dejó
> tuneable ("por ahora, quizá lo modifiquemos"): el default de la firma es 180, ajustable sin migración nueva.

---

## 3. Decisión: RPC `SECURITY DEFINER` vs Edge Function (con alternativa descartada)

### Decisión — **RPC SQL `SECURITY DEFINER STABLE`** (vía PostgREST, `supabase.rpc`)

**Por qué:**
1. **Continuidad del contrato.** El denominador reproductivo (lo más sensible) YA son 3 RPC `SECURITY DEFINER
   STABLE` (`0105`). Construir los KPIs como RPC que **las invocan** mantiene un único modelo de cómputo y un
   único lugar de authz (el guard `has_role_in`). Una Edge Function tendría que re-llamar esas RPC igual → capa
   extra sin valor.
2. **Las agregaciones se expresan limpio en SQL.** `architecture.md` reserva Edge Functions para "operaciones que
   **no** se expresan limpio en RLS" (invitaciones, validaciones complejas, integraciones externas). Un
   `count(*) group by`, `avg`, `distinct on` son exactamente lo que Postgres hace mejor; mover eso a Deno sería
   ir contra la guía.
3. **Una sola superficie de auth.** El guard `has_role_in` dentro de la función (fail-closed, patrón `0105`) es
   el mismo mecanismo ya auditado en Gate 1 de Stream A. Edge Function = una segunda superficie (JWT parsing,
   `requireUser`, `requireRoleIn`) que duplica lo que el guard SQL ya hace.
4. **Menos latencia y menos partes móviles.** RPC = un round-trip PostgREST. Edge = cold start de Deno + el
   round-trip a Postgres igual. Para "sentarse a revisar reportes" la diferencia no es crítica, pero no hay razón
   para pagarla.
5. **Read-only y `STABLE`.** Los reportes no escriben; `STABLE` permite que el planner los trate como funciones
   puras de lectura. Encaja perfecto con RPC; una Edge Function no aporta nada acá.

**Tenant-scoping (idéntico a `0105`):** cada RPC deriva el `establishment_id` de su argumento (de `rodeos`,
`sessions`, o recibe `p_establishment_id`) y exige `has_role_in(...)` **antes** de devolver datos; revoke a
`anon/public`, grant a `authenticated`; smoke-check fail-closed en la migración. SECURITY DEFINER ⇒ la RLS no
protege la función ⇒ el guard interno es la defensa (Gate 1 lo audita).

### Alternativa descartada — **Edge Function `reports` (Deno) que orquesta las queries**

- **Pros:** lógica de agregación en TypeScript (testeable con el toolchain del cliente); un solo endpoint que
  devuelve "todo el dashboard de un rodeo" en una llamada; más fácil componer respuestas anidadas.
- **Contras (por qué se descarta):**
  - Duplica la superficie de auth: tendría que re-implementar el tenant-check que el guard SQL ya hace, o llamar
    las RPC de Stream A igual (entonces, ¿para qué la Edge?).
  - Contradice `architecture.md` (Edge = lo que NO se expresa limpio en RLS; las agregaciones SÍ se expresan).
  - Cold start + doble hop. Sin beneficio offline (los reportes son online-only de todos modos).
  - Más difícil de auditar en Gate 1: el security_analyzer ya tiene el patrón `0105` para RPC; meter Deno agrega
    una superficie nueva (parsing de JWT, manejo de service-role key) sin necesidad.
  - **Cuándo SÍ reconsiderar (anotado, no MVP):** export PDF (post-MVP) — generar un PDF server-side sí es un caso
    de Edge Function (render + storage). Pero el PDF está fuera de MVP (context.md §3-D3), así que no entra acá.

> **Sub-alternativa también descartada — vistas SQL planas (`CREATE VIEW`)** en vez de funciones parametrizadas:
> el denominador es "de esta campaña" (rodeo + año), parametrizado; una vista plana no toma `p_year` y forzaría
> filtrar en el cliente o materializar todo. `0105` ya documentó esto (DD-PS-5: función parametrizada, no vista).
> Los reportes de Stream C heredan la misma forma por coherencia.

---

## 4. Estrategia online-only y estado offline (R7.2)

- **Online-only por diseño** (context.md §7). `reports.ts` detecta ausencia de red **antes** de llamar la RPC
  (estado de conectividad del runtime / un ping liviano) y, si está offline, devuelve `Result.err({ kind:
  'offline' })` sin disparar la RPC. La pantalla muestra el estado "necesitás conexión para ver reportes"
  (R7.2.2) — copy accionable, botón "reintentar" (R7.2.4).
- **Sin replicación client-side de la agregación** (R7.2.1): el cliente solo dibuja lo que la RPC devuelve. La
  única lógica de cliente es **presentación** (formato es-AR, mostrar los absolutos num/den, cuántas barras CCL
  vía el helper compartido). No recomputa KPIs ni alterna bases (base única servidas, R7.5.3/R7.6.4).
- **Carga vs refresh (anti-parpadeo, `conventions.md` UI):** el spinner que reemplaza el contenido se muestra
  SOLO en la primera carga sin datos (`loading && data === null`); al cambiar de rodeo/campaña, el refresh no
  blanquea el contenido previo de golpe (se mantiene montado hasta que llega el nuevo resultado).
- **Cache read-only de la última carga (R7.2.3, opcional):** `use-reports.ts` puede retener el último resultado
  en memoria para mostrarlo marcado "datos de la última carga" si se pierde la señal. No se persiste a disco en
  MVP (no es offline-first real; los reportes no son dato de campo). Es nice-to-have; no bloquea.
- **No hay buckets de PowerSync nuevos:** los reportes no sincronizan (no son entidades offline). Las tablas que
  agregan ya sincronizan para otras features; Stream C solo **lee** server-side. Por eso esta sección NO define
  buckets ni estrategia de conflictos (no aplica: cómputo online, read-only).

---

## 5. Seguridad (Gate 1 — OBLIGATORIO, context.md §7/§11)

> Gate 1 aplica porque se crean funciones nuevas que leen cross-tabla scopeadas por tenant. Foco del
> security_analyzer modo `spec`: que ninguna agregación filtre datos de un establecimiento donde el usuario no
> tiene rol activo, y que las RPC tengan EXECUTE/grants correctos.

Checklist de diseño (lo que las RPC DEBEN cumplir — espejo de `0105`, R7.12). **Los puntos §5.1/§5.4/§5.5/§5.6
incorporan los 4 MEDIUM de Gate 1 (`progress/security_spec_07-reportes.md`, M1-M4) — son el contrato que Gate 2
valida sobre el código.**

### §5.1 — Guard `has_role_in` al entrar, antes de devolver nada (fail-closed)
- Para RPC con `p_rodeo_id`/`p_session_id`: derivar `establishment_id` de la fila (`rodeos`/`sessions`, validando
  `deleted_at IS NULL`) y exigir `has_role_in(v_est)`; raise `42501` si no.
- Para RPC con `p_establishment_id` (las **2 RPC de alerta** — `establishment_overdue_doses`,
  `establishment_unweighed`): **(M1)** el `p_establishment_id` lo manda el cliente → es la superficie IDOR más
  directa (no se deriva de ninguna fila, a diferencia de las RPC de rodeo/sesión). Por eso `if not
  public.has_role_in(p_establishment_id) then raise exception ... using errcode = '42501'; end if;` debe ser la
  **1ª sentencia ejecutable** de la función (antes de cualquier SELECT/escaneo). Fail-closed: rechazar con `42501`,
  **nunca** devolver un set vacío silencioso (R7.12.3). Es el patrón "no confiar en el `establishment_id` del
  cliente".

### §5.2 — `SECURITY DEFINER STABLE set search_path = public` (no escribe; read-only).

### §5.3 — Cota de `p_year` tras el guard (1900..current+1, igual que `0105` RPS.5.10) en las RPC que reciben año.

### §5.4 — Cota de escaneo en TODA RPC (no solo `p_year`) — **(M4, INPUT-1)**
SECURITY DEFINER ⇒ ningún escaneo puede quedar sin cota de input. Estado por RPC:
- KPIs de rodeo (`rodeo_pregnancy_kpi`/`calving_kpi`/`ccl_distribution`/`calving_by_stage`): acotadas por `p_year`
  (§5.3). OK.
- `establishment_unweighed`: acotada por `p_threshold_days`; **además** validar `p_threshold_days between 0 and
  3650` (tope concreto = 10 años, testeable; §2.7) y `cardinality(p_category_codes) <= 64` (M4 menor + L1).
- `establishment_overdue_doses`: **era la única RPC sin cota** (predicado `next_dose_date < current_date` + NOT
  EXISTS correlacionado, sin piso ni LIMIT → escaneo de todo el historial de `sanitary_events` del tenant). **Fix
  (M4):** parámetro de **ventana acotada** `p_lookback_days int default 365` (piso `next_dose_date >= current_date
  - make_interval(days => p_lookback_days)`) **y** `LIMIT p_limit` server-side (`p_limit int default 500`,
  validado `between 1 and 1000`); raise `22023` para `p_lookback_days < 0` o `p_limit` fuera de rango, tras el
  guard (espejo de la cota de `p_year`). No es rate-limit (Supabase no rate-limitea RPC; sin email/SMS/escritura →
  sin denial-of-wallet): la defensa correcta contra el self-DoS es la cota de escaneo (Gate 1, tabla de rate
  limits). Cubre R7.10.5.

### §5.5 — Defensa en profundidad de tenant en los joins — **(M2)**
Filtrar el tenant en el **join a `animal_profiles`**, no con un `establishment_id = v_est` literal sobre la tabla
de evento. Precisión sobre el as-built (corrige la redacción anterior, que decía "filtrar `establishment_id = v_est`
en las tablas"):
- `weight_events` / `reproductive_events` / `sanitary_events` / `condition_score_events` / `lab_samples`: 0077 les
  agregó una columna `establishment_id` denormalizada, pero es **plumbing del sync JOIN-free de PowerSync** y su
  **RLS canónica deriva el tenant por FK al perfil** (`has_role_in(establishment_of_profile(animal_profile_id))`,
  0077:33-36). En una RPC SECURITY DEFINER la RLS no protege ⇒ la RPC scopea **a mano por el join a
  `animal_profiles` con `p.establishment_id = v_est`** (canónico, espejo de `rodeo_serviced_females` en `0105`
  líneas 117-122), **no** por la columna denorm de la tabla de evento.
- `custom_measurements` (0094) / `scrotal_measurements` (0098): su columna `establishment_id` denorm **sí** es su
  fórmula de tenant canónica (su propia RLS usa `has_role_in(establishment_id)`); filtrar directo por esa columna
  es válido. Aun así, pasar por el join a `animal_profiles` es uniforme y es donde viven los filtros de M3
  (`deleted_at`/`status` del perfil), así que el join se usa igual.
- Afecta a `session_event_summary` (cuenta sobre las 7 tablas), `rodeo_weight_by_category`,
  `establishment_overdue_doses`, `establishment_unweighed`.

### §5.6 — Excluir el perfil archivado/borrado **en el join, no en el helper** — **(M3, R7.13)**
`establishment_of_profile` (0023:9) es `select establishment_id from animal_profiles where id = profile_id` **sin**
`deleted_at IS NULL` ni `status`. No es fuga cross-tenant (el guard de entrada corre igual), pero arrastraría
perfiles archivados/borrados a los agregados (viola R7.13.1/.3 e infla los KPIs). Por eso **cada RPC que toque
`animal_profiles` filtra en el propio join `p.deleted_at IS NULL` (siempre) y `p.status = 'active'` (KPIs de
rodeo/alertas; salvo el histórico de sesión R7.13.2)** — no se confía en el helper. Es el mismo criterio que
`rodeo_serviced_females` (`0105:121-122`: `p.status = 'active' and p.deleted_at is null` en el join).

### §5.7 — Las RPC de KPI reproductivo NO re-derivan el denominador a mano
Invocan `rodeo_serviced_females` / `rodeo_repro_denominator` (que ya re-guardan el tenant), evitando divergencia de
la regla de elegibilidad y manteniendo un solo lugar auditable (DD-PS-5).

### §5.8 — `revoke execute ... from public, anon` + `grant ... to authenticated` + smoke-check fail-closed
En la misma migración (raise si alguna queda EXECUTE-able por anon/public). Patrón literal de `0105` (4).

### §5.9 — Sin PII en los outputs más allá de lo necesario
Las alertas devuelven `idv`/`visual_id_alt`/`product_name` (datos operativos del tenant, ya visibles a roles del
establecimiento vía RLS de las tablas base) — no email/teléfono ni nada de `*_private` (ADR-025). No se cruza
ninguna tabla `_private`.

### §5.10 — Input abusivo / inyección
`p_category_codes` de la alerta sin pesar acota por `code` con cardinalidad topada (§5.4). Todos los parámetros son
tipados de PostgREST (uuid/int/text[]), **no** SQL string concatenado → sin vector de inyección. Sin buscadores
`ilike '%term%'` ni `.or()/.filter()` con input de usuario.

> **No se modifica RLS de tablas existentes** ni se crean tablas nuevas: Stream C solo agrega funciones de
> lectura. El schema de `service_months` y el denominador (lo schema-sensitive) ya pasaron Gate 1 en Stream A.

---

## 6. UI (🟡 densidad mixta — oficina + campo, context.md §8)

> Reportes se ven "sentado a revisar" (oficina) pero también en el campo desde el teléfono. Densidad OK pero
> legible: cards grandes, números grandes para el KPI rey, tipografía legible a distancia de brazo. Se aplica el
> veto `design-review` del leader antes de mostrar a Raf (UX básicos: títulos sin recorte de descendentes con
> `lineHeight` matching, empty states cálidos, estados de error accionables).

- **Pantalla Reportes (`reportes.tsx`)** — estructura (ADR-018, context.md §8):
  - **Selector de rodeo** arriba (reusa el contexto rodeo-céntrico de spec 10). Al elegir rodeo → se cargan sus KPIs.
  - **Cards de KPI del rodeo**: %preñez (R7.5), %parición (R7.6), distribución CCL como barras
    cabeza/cuerpo/cola (R7.7) + el cruce con nacimientos (R7.8) cuando hay datos, peso por categoría (R7.9). Cada
    KPI con: % grande y **numerador/denominador absolutos** debajo (denominador explícito, ej. "preñadas 41 /
    servidas 46"). **Base ÚNICA = servidas, SIN toggle de base** (Puerta de spec 2026-06-24, R7.5.3/R7.6.4) — el
    `DenominatorToggle` queda fuera del MVP. La **pérdida preñez→parición** se lee comparando %preñez vs %parición
    (misma base servidas), no con un selector.
  - **Selector de campaña (año)** por rodeo (default = **última campaña con datos** del rodeo, R7.5.7; el wrap de
    fin de año se resuelve por set-membership server-side, R7.5.8) — permite mirar campañas anteriores.
  - **Estado "configurá la estación de servicio"** cuando `is_configured = false` (R7.5.6/R7.6.6/R7.7.3) con CTA que
    lleva a la edición del rodeo (cross-spec spec 02).
  - **Alertas**: dos secciones (dosis vencida R7.10, sin pesar R7.11) con lista accionable + empty states positivos.
  - **Acceso a "Resumen de sesión"** (lista de sesiones del rodeo, R7.3.6) y a **"Comparar sesiones"** (R7.4).
- **Resumen de sesión (`reportes/sesion/[id].tsx`)**: conteos por tipo de evento, marco temporal, animales
  intervenidos; empty state si no hay eventos (R7.3.5).
- **Comparativa (`reportes/comparar.tsx`)**: elegir 2 sesiones del **mismo** rodeo (la 2ª restringida al rodeo de
  la 1ª, R7.4.2); tabla lado a lado con delta por tipo de evento (R7.4.1/.3).
- **Formato es-AR** en todos los pesos/decimales de la UI (coma decimal, ej. "385,5 kg"); NO en datos de máquina.
- **Estados transversales**: offline (R7.2.2), error con reintento (R7.2.4), loading sin blanqueo en refresh
  (`conventions.md` UI). Empty states cálidos en todos los KPIs con denominador 0 / sin datos (no `NaN`/`0%` crudos).
- **El vet es canal de adquisición** (CLAUDE.md ppio 5): los reportes reproductivos (%preñez, CCL, cruce
  tacto↔nacimientos) son justamente lo que le sirve al vet — no se degradan ni se esconden tras paywall en MVP
  (el paywall es benchmarking cross-campo, que está fuera).

---

## 7. No-goals (explícitos, context.md §3-§4)

- **Benchmarking anónimo entre campos** → Plan Pro (requiere agregación cross-tenant con privacidad + Gate 1
  pesado). FUERA del MVP.
- **Export a PDF / Excel** del reporte → post-MVP (context.md §3-D3). Si se hace, sería el caso que justifica una
  Edge Function (render + storage) — no entra ahora.
- **Predicciones / IA** → Plan Pro.
- **Reportes de otros sistemas** (invernada/feedlot/tambo/cabaña) → MVP es cría.
- **Reimplementar la ficha individual de animal** → ya construida (`animal_timeline`, R7.14).
- **KPIs de tendencia / IEP / reposición / repetición** → requieren historia multi-año; la UI debe degradar con
  gracia el año 1 (`research-kpis-cria.md §7`), pero no son KPIs del MVP.
- **Mortandad fina peri/posnatal, kg/ha, márgenes $** → gaps de datos (evento de muerte fino, superficie ha);
  backlog (`research-kpis-cria.md §7`, Gate 0 §7).

---

## 8. Notas para el implementer

- **No reabrir Stream A.** `rodeo_serviced_females` / `rodeo_repro_denominator` / `rodeo_service_campaign` son el
  contrato. Si una RPC de Stream C necesita algo que Stream A no expone (ej. la lista de `animal_profile_id`
  preñadas, no solo el conteo), se RESUELVE dentro de la RPC de Stream C reusando el conjunto servidas
  (`select ... from rodeo_serviced_females(...) s join ...`), no modificando Stream A.
- **Una sola fuente de la regla CCL por meses.** El nº de barras lo decide `pregnancy-buckets.ts`
  (`sizeBucketsForServiceMonths`). No re-implementar la regla 1/2/3/4-11/12 en otro lado. La asignación mes→tercio
  (nueva, R7.8) va en la RPC + espejada en `calving-stage.ts`; documentar la deuda de consistencia para el día que
  Facundo cierre el bucketing 4-11 (Gate 0 §9).
- **Roja-hasta-apply esperada.** El runner `supabase/tests/reports/run.cjs` falla hasta que el leader aplique las
  migraciones post-Gate-2 + autorización de Raf (mismo patrón que `puesta-en-servicio`). El hook en
  `scripts/run-tests.mjs` queda comentado hasta el apply.
- **Mapeo `R<n> → archivo:test`** en `progress/impl_07-reportes-basicos.md` (trazabilidad, `docs/specs.md`).

---

## 9. Reconciliación Gate 1 (security spec) — 4 MEDIUM foldeados

> Origen: `progress/security_spec_07-reportes.md` (PASS, 2026-06-24). Los 4 MEDIUM eran lagunas de redacción del
> design (el patrón seguro ya estaba elegido, espejo `0105`), no decisiones nuevas — ninguno requirió decisión de
> Raf/Facundo. Foldeados **antes** de la Puerta de spec para que Gate 2 valide contra el contrato afinado. Qué
> sección/criterio/test tocó cada uno:

| Gate 1 | Qué precisa | Design | Requirements | Tasks (test) |
|---|---|---|---|---|
| **M1** — `p_establishment_id` del cliente = IDOR más directo (2 RPC de alerta) | `has_role_in(p_establishment_id)` como **1ª sentencia ejecutable**, fail-closed (rechazar `42501`, no vacío) | §5.1 (reescrita) + §2.7 (las 2 alertas) + §1 (tabla) | R7.12.3 (ya lo cubría — sin cambio de EARS) | T4.3 (assert IDOR nombrado: JWT tenant B pide `establishment_overdue_doses(est_A)` → `42501`) |
| **M2** — scoping por el join a `animal_profiles`, no por filtro literal en las tablas de evento | Las 5 tablas de evento (0025-0029) tienen `establishment_id` denorm pero es plumbing del sync (0077); su RLS canónica es por FK al perfil → la RPC SECDEF scopea por el **join a `animal_profiles`** (espejo `0105:117-122`); `custom_measurements`/`scrotal_measurements` denorm es su RLS canónica pero se usa el join igual | §5.5 (reescrita) + §2.1 (session_summary) + §2.6 (weight_by_category) + §2.7 (alertas) | — (precisión de implementación, no cambia el *qué*) | T4.3 / T1.3 / T3.2 (tenant-scope ya cubierto; el scoping correcto se valida con los asserts anti-IDOR existentes) |
| **M3** — filtrar `deleted_at IS NULL` + `status='active'` **en el join**, no confiar en `establishment_of_profile` | El helper (0023:9) no filtra `deleted_at`; cada RPC sobre `animal_profiles` filtra `p.deleted_at IS NULL` (siempre) + `p.status='active'` (KPIs/alertas; histórico de sesión exento, R7.13.2) en el propio join | §5.6 (nueva) + §2.1 + §2.6 + §2.7 | R7.13.1/.3 (ya lo cubrían — se ancla "en el join, no en el helper") | T8.1 (anclado a "en el join a `animal_profiles`, no en el helper") |
| **M4** — `establishment_overdue_doses` sin cota de escaneo (INPUT-1, única RPC sin cota) | Ventana acotada `p_lookback_days` (piso de fecha) + `LIMIT p_limit` server-side, validados tras el guard (raise `22023` fuera de rango); cota menor de `p_threshold_days` + cardinalidad de `p_category_codes` en `establishment_unweighed` | §5.4 (nueva) + §2.7 (firma `establishment_overdue_doses(..., p_lookback_days, p_limit)`) + §1 (tabla) | **R7.10.5 (nuevo)** + R7.11.6 (nuevo, cota de `establishment_unweighed`) | T4.3 (assert de cota: ventana/LIMIT respetados; `p_lookback_days < 0`/`p_limit` fuera de rango → `22023`; cardinalidad de `p_category_codes`) |

> **Nota de IDs:** M4 agrega **R7.10.5** y **R7.11.6** (criterios nuevos al final de su grupo — IDs estables, no
> se reordena nada existente, `docs/specs.md`). M1/M2/M3 NO agregan EARS: el *qué* (rechazo IDOR, exclusión de
> archivados/borrados, aislamiento de tenant) ya estaba en R7.12.3 / R7.13 / R7.12 — son precisiones de *cómo* que
> viven en el design y en los asserts de tasks. LOW L1 (cardinalidad de `p_category_codes`) absorbida en §5.4/R7.11.6;
> L2 (`p_year+1` de `rodeo_calving_kpi`) ya estaba acotado por la cota de `p_year` (§5.3) — sin cambio.

---

## 10. Reconciliación Puerta de spec — 5 decisiones de Raf (2026-06-24)

> Decisiones CERRADAS de Raf en la Puerta de spec. Se quitaron los `[SUPUESTO]`/preguntas-abiertas y se lockearon.
> Qué sección de design / requirements tocó cada una:

| Decisión (Raf, 2026-06-24) | Design | Requirements |
|---|---|---|
| **D1** — Umbral "sin pesar" = **180 d default-MVP CERRADO**, parametrizado (alcance/categorías sigue Facundo) | §2.7 (firma `establishment_unweighed` — umbral cerrado, alcance abierto; nota "por qué parámetros") | R7.11.1 (180 d confirmado) + §Supuestos (umbral cerrado / alcance pending) |
| **D2** — Comparativa de peso = **por sesiones** (MVP) | §2.6 (`rodeo_weight_by_category` — dos sesiones del mismo rodeo; campaña→post-MVP) | R7.9.5 (lockeado a sesiones) |
| **D3** — %preñez y %parición = **base ÚNICA servidas, sin selector**; se mantiene denominador explícito | §2.2 (%preñez `pregnant/serviced`, sin toggle) + §2.3 (nota: %parición sin toggle; pérdida visible comparando KPIs) + §1 (sin `DenominatorToggle`) + §4 + §6 (UI sin toggle de base) | R7.5.1/R7.5.3/R7.5.4 + R7.6.4 (toggle descartado; absolutos num/den se mantienen, R7.5.5) |
| **D4** — Año default = **última campaña con datos**; wrap por **set-membership** | §2.3 (nota wrap `mes ∈ service_months`, no `BETWEEN`) + §6 (selector de campaña = última con datos) | R7.5.7 (default última con datos) + **R7.5.8 (nuevo)** (wrap por set-membership) |
| **D5** — Archivados = **INCLUIR** en histórico de sesión | §2.1 (session_summary no filtra `status`, sí `deleted_at`) + §5.6 (histórico de sesión exento del filtro `status`) | R7.13.2 (lockeado a "incluir") |

> **Nota de IDs:** la única adición de EARS de este fold es **R7.5.8** (wrap por set-membership, al final del grupo
> R7.5 — IDs estables, sin reordenar). D1-D3/D5 lockean criterios existentes sin agregar IDs. Ningún cambio de
> seguridad (no reabre Gate 1): D5 ya estaba alineado con §5.6 (histórico de sesión exento del filtro `status`);
> D1 mantiene la cota `[0,3650]` de R7.11.6 intacta.

---

## 11. Reconciliación al as-built — BACKEND Stream C (2026-06-24)

> El BACKEND (las 9 RPC + suite no-bypass + helper puro) se implementó en `progress/impl_07-reportes-backend.md`
> (dispatch del leader, separado del frontend). Diferencias entre lo construido y §1/§2 de arriba (regla dura
> `docs/specs.md` — el design describe lo que el código REALMENTE hace). Ninguna reabre Gate 1 (el contrato de
> seguridad §5.1-§5.10 se cumple LITERAL; estas son precisiones de empaquetado/derivación, no del *qué*).

### 11.1 — Una sola migración `0106_reports_rpcs.sql` (no 4 archivos `01NN_*`)
§1 listaba 4 migraciones (`01NN_reports_session_summary` / `_repro_kpis` / `_weight_by_category` / `_alerts`).
**As-built:** las 9 funciones viven en **una sola** migración `supabase/migrations/0106_reports_rpcs.sql` (el
leader la pidió consolidada), con un único bloque final de `revoke/grant` + smoke-check fail-closed (§5.8). El
número real es `0106` (último as-built `0105`; `0092` saltada/spec-08). Mismo contrato; menos archivos.

### 11.2 — `rodeo_weight_by_category(p_rodeo_id, p_session_id uuid default null)` — variante por sesión como parámetro
§2.6 dejaba a elección "variante `..._for_session(p_session_id)` o parámetro opcional". **As-built:** parámetro
opcional `p_session_id` (default null → toda la campaña; no-null → solo los pesajes de esa sesión, comparativa
R7.9.5). **Defensa anti-IDOR adicional** sobre ese parámetro: si `p_session_id` no pertenece al mismo
rodeo/tenant → `42501` (el guard de rodeo ya cubre el tenant; esto evita cruzar pesos de una sesión ajena al
rodeo). Firma para grants: `(uuid, uuid)`.

### 11.3 — Las 9 funciones (vs "8 RPC" del scope)
El cómputo son 8 RPC (resumen sesión, %preñez, %parición, CCL, cruce por etapa, peso, 2 alertas). Se agregó la
**9ª** `rodeo_sessions_list(p_rodeo_id)` (R7.3.6) como lister tenant-scopeado — §2.1 la marcaba OPCIONAL (la lista
también se puede leer del SQLite local). Se expone igual para que el frontend elija; es read-only y barata.

### 11.4 — Wrap de fin de año: anclaje por AÑO CALENDARIO de la concepción (precisión de §2.3)
`rodeo_calving_kpi.calved` y `rodeo_calving_by_stage` cuentan un `birth` en la campaña `p_year` sii
`extract(year from (event_date − interval '9 months')) = p_year AND extract(month …) = any(service_months)` —
**espejo EXACTO de cómo Stream A (`0105`) define servidas** (cada mes tomado en su año calendario `p_year`, set-
membership, no rango contiguo con wrap — R7.5.8). **Precisión sobre la frase de §2.3** ("la concepción es en
`p_year`, el parto ~9 meses después" / "paren entre `p_year` y `p_year+1`"): para un servicio con wrap
`{11,12,1}`, las concebidas en **Ene(`p_year`)** PAREN en **Oct(`p_year`)** — el MISMO año, no `p_year+1` (Ene +
9 meses = Oct del mismo año). Las de Nov/Dic(`p_year`) sí paren en `p_year+1` (Ago/Sep). El anclaje por año
calendario de la concepción lo resuelve correctamente sin lógica de wrap especial. (Se cubre en `reports/run.cjs`
TR.4 con el caso wrap.)

### 11.5 — Alerta dosis vencida: "dosis posterior" = última APLICACIÓN del producto (precisión de §2.7)
§2.7/R7.10.1 decían "NOT EXISTS una dosis posterior del mismo `product_name`". **As-built:** "posterior" se
keyea por `(event_date, created_at)` — `se` aparece sii es la **última aplicación** del producto sobre ese animal
y su `next_dose_date < hoy`. Así el overdue refleja el estado VIGENTE: una re-vacunación posterior (aunque su
próximo turno sea futuro) cubre la vencida vieja; si la última aplicación quedó con `next_dose` vencido, ESA
aparece. (Antes se keyeaba tentativamente por `next_dose_date`; se corrigió en la autorrevisión para no marcar
"cubierta" una vencida vieja por una posterior con turno aún más viejo. No cambia el *qué* de R7.10.1.)

### 11.6 — `rodeo_calving_by_stage`: un parto por hembra/campaña (`distinct on`)
La asignación por tercio toma **un** `birth` por hembra servida (el de concepción más temprana) → `total_born ==
calved` (evita doble-conteo de mellizos o partos repetidos en la misma campaña). El bucketing mes→tercio
(orden de servicio con wrap, tercios enteros `⌊n/3⌋`/`⌊2n/3⌋`) es el **espejo server-side** de
`app/src/utils/calving-stage.ts` (T5.1). **Deuda de consistencia** (Gate 0 §9, ya anotada en §2.5/§8): el
bucketing 4-11 `[SUPUESTO]` se ajusta en AMBOS lugares (esta RPC + `calving-stage.ts` + `pregnancy-buckets.ts`)
cuando Facundo cierre.

---

## 12. Reconciliación al as-built — FRONTEND Stream C (2026-06-24)

> El FRONTEND (service online-only + pantallas + componentes + capturas) se implementó en
> `progress/impl_07-reportes-frontend.md` (dispatch del leader, separado del backend). Diferencias de
> empaquetado entre lo construido y §1/§6 (regla dura `docs/specs.md` — el design describe lo que el código
> REALMENTE hace). Ninguna cambia el *qué* ni la seguridad (frontend consume las RPC ya gateadas → Gate 1
> N/A); son precisiones de organización de archivos/contrato de error.

### 12.1 — Lógica pura separada en `app/src/utils/reports-format.ts`
§1 listaba `services/reports.ts` + `hooks/use-reports.ts` + el helper `calving-stage.ts` (ya existente).
**As-built:** la lógica PURA de presentación (porcentaje con guard de 0, formato es-AR de %/peso/delta, armado
de barras CCL vía `cclBarsForMonths`→`sizeBucketsForServiceMonths`, comparativas `compareSessions`/
`compareWeights`, `defaultCampaignYear`) vive en `reports-format.ts` (testeable con node:test, 33 tests). Es el
mismo criterio del split `online-guard.ts`/`online-guard-pure.ts`: lo testeable fuera del módulo que importa el
SDK (`reports.ts` importa `supabase`). `reports.ts` queda como pura capa I/O.

### 12.2 — `reports.ts` `ReportError` granular (superset de `{kind:'offline'}`)
§4/§1 decían `Result.err({ kind: 'offline' })`. **As-built:** `ReportError` con kinds
`offline | network | server | forbidden | validation` — para mapear los códigos del CONTRATO de las RPC
(`42501`/`P0002` → `forbidden`, NO vacío silencioso, R7.12.3; `22023` → `validation`; fetch sin status →
`network`). Superset del contrato; el *qué* (offline detectado ANTES de llamar, R7.2.2) se cumple igual
(`assertOnline` como 1ª sentencia de cada wrapper).

### 12.3 — Pantallas: `reportes/sesiones.tsx` agregada (lista) + `reportes-spike.tsx` (veto)
§1 listaba `reportes/sesion/[id].tsx` + `reportes/comparar.tsx`. **As-built:** se agregó
`reportes/sesiones.tsx` (la LISTA de sesiones del rodeo, R7.3.6) como entrada separada del detalle — §6 dice
"Acceso a 'Resumen de sesión' (lista de sesiones del rodeo)", y la lista necesita su propia pantalla; el
detalle es `sesion/[id]`. Además se agregó `reportes-spike.tsx` (spike VISUAL 100% mock, en `DEV_WEB_ROUTES`,
para el veto `design-review` del leader sin seed/login — reusa los componentes reales; NO es producción,
paridad con los spikes de Stream B). Las 3 rutas standalone (`reportes/sesiones`, `reportes/sesion/[id]`,
`reportes/comparar`) se registran en `app/app/_layout.tsx` + `REPORT_DESTINATIONS` (no se re-rutean al wizard).

### 12.4 — Selector de campaña = stepper con default `defaultCampaignYear`
§6 decía "selector de campaña (año) … default = última campaña con datos". **As-built:** stepper ← año → con
default derivado del año de la sesión más reciente del rodeo (`defaultCampaignYear` — no hay RPC de "años con
datos"; el año de la última sesión es el proxy honesto de "última campaña con actividad", R7.5.7). Tope superior
= año+1 (espeja la cota `p_year` del server). El wrap de fin de año lo resuelve el server por set-membership
(R7.5.8) — el cliente solo manda `p_year`.

### 12.5 — R7.2.3 (cache "datos de la última carga" offline) NO implementado (nice-to-have)
R7.2.3 es explícitamente "Opcional — no bloquea el MVP". **As-built:** el anti-parpadeo (`reportView`)
conserva el último `data` en memoria durante un refresh fallido (no blanquea), pero NO lo marca como "datos de
la última carga". Si se quiere, es un add-on chico (flag `stale` en `reportView`). Anotado como limitación
conocida en el ledger; no se reclama R7.2.3 cubierto.
