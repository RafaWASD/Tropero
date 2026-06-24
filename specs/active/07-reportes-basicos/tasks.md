# Tasks — Feature 07: Reportes / Analytics (Stream C)

> Pasos discretos en orden, cada uno con `[ ]` y los `R<n>` que cubre (`docs/specs.md`). El implementer marca
> `[x]`. El reviewer rechaza si queda `[ ]` sin justificar.
>
> **Gates (context.md §11):**
> - **Gate 1 (security spec)** — OBLIGATORIO. Corre **antes de la Puerta de spec humana**, sobre este design
>   (RPC cross-tabla tenant-scoped). No se implementa nada de SQL hasta Gate 1 PASS + aprobación humana de la spec.
> - **Gate 2 (security code)** — por chunk de implementación, después del reviewer.
> - **Veto `design-review`** del leader sobre cada pantalla antes de mostrarla a Raf.
>
> **Dependencias:** Stream A (`0102`/`0104`/`0105`) y Stream B (tacto con `pregnancy_status`) deben estar
> aplicados en remoto para que la suite de Stream C corra verde. Hasta el apply, `reports/run.cjs` es
> roja-hasta-apply (esperado, patrón `puesta-en-servicio`).
>
> **Estado BACKEND (Stream C, 2026-06-24, ledger `progress/impl_07-reportes-backend.md`):** las 9 RPC (T1.1-T4.2)
> + la suite no-bypass (T1.3/T2.5/T2.6/T3.2/T4.3) + el helper puro `calving-stage.ts` (T5.1/T5.2) están
> IMPLEMENTADOS. **Reconciliaciones de as-built** (regla dura `docs/specs.md`; detalle en design §11):
> - **Una sola migración** `supabase/migrations/0106_reports_rpcs.sql` (dispatch del leader), no las 4 `01NN_*`
>   separadas que listaba design §1. Las 9 funciones viven en `0106` con un único bloque de grants + smoke-check.
> - **`rodeo_weight_by_category(p_rodeo_id, p_session_id uuid default null)`**: la variante "por sesión" se
>   implementó como **parámetro opcional** (no función `_for_session` aparte) — design §2.6 la dejaba a elección
>   del implementer. Defensa anti-IDOR extra: si `p_session_id` no es de ese rodeo/tenant → `42501`.
> - **Wrap de fin de año (R7.5.8)**: el `calved`/`calving_by_stage` anclan cada mes de concepción a su AÑO
>   calendario `p_year` (`extract(year from event_date − 9mo) = p_year AND month ∈ service_months`), espejo de
>   cómo Stream A define servidas. Precisión sobre la nota de design §2.3 ("paren entre p_year y p_year+1"): para
>   un servicio con wrap {11,12,1}, las concebidas en Ene(p_year) PAREN en Oct(p_year) (mismo año), no p_year+1.
> - **Alerta dosis vencida — "dosis posterior" (R7.10.1)** se define como "`se` es la ÚLTIMA APLICACIÓN del
>   producto sobre el animal por `(event_date, created_at)`" (no por `next_dose_date`): el overdue refleja el
>   estado vigente (una re-vacunación posterior con turno futuro cubre la vencida vieja). design §2.7 decía
>   genéricamente "NOT EXISTS una dosis posterior"; esto lo precisa sin cambiar el *qué*.
>
> Pendiente del backend: leader aplica `0106` (con OK de Raf) → descomenta el hook de `reports/run.cjs` →
> suite verde → reviewer + Gate 2. **Frontend (T5.3-T7.3 + T6.x) va aparte**, después.

---

## Fase 0 — Gate 1 (pre-implementación, pre-Puerta de spec)

- [ ] **T0.1** — Gate 1: `security_analyzer` modo `spec` audita `design.md` §2 y §5 (RPC `SECURITY DEFINER`
  tenant-scoped, guard `has_role_in` fail-closed, revoke anon/public, read-only, sin PII de `_private`).
  Output: `progress/security_spec_07-reportes.md` (ya generado, PASS — 2026-06-24). Veredicto PASS requerido. Cubre: R7.12.
- [ ] **T0.2** — ⏸ **Puerta de spec (humana)**: Raf aprueba requirements/design/tasks (tras Gate 1 PASS). *(No es
  tarea del implementer; la ejecuta el leader. Bloquea todo lo de abajo.)*

---

## Fase 1 — Backend: resumen de sesión + lista de sesiones

- [x] **T1.1** — Migración `01NN_reports_session_summary.sql`: RPC `session_event_summary(p_session_id uuid)` →
  conteo por tipo de evento de la sesión (las **7 tablas con FK `session_id`**: weight/reproductive/sanitary/
  condition/lab/scrotal/custom — NO `animal_events`, que no tiene `session_id`; `deleted_at IS NULL`) + animales
  distintos por kind. Guard `has_role_in` derivado de `sessions.establishment_id`, `STABLE`, revoke anon/public + grant
  authenticated + smoke-check fail-closed. Cubre: R7.3.1, R7.3.2, R7.3.3, R7.12.2, R7.12.4.
- [x] **T1.2** — En la misma migración: `rodeo_sessions_list(p_rodeo_id uuid)` (lista de sesiones del rodeo,
  `order by started_at desc`, guard de tenant) **o** documentar que la lista se lee del SQLite local existente
  (`sessions.ts`) y omitir la RPC. Decisión documentada en el header de la migración / `impl_*`. Cubre: R7.3.6.
- [x] **T1.3** — Test (`reports/run.cjs`): resumen cuenta por tipo, excluye borrados (R7.3.3), funciona en sesión
  `active` (R7.3.4) y vacía → conteos 0 (R7.3.5); anti-IDOR cross-tenant (sesión de otro establecimiento →
  `42501`); read-only; anon/public sin EXECUTE. Cubre: R7.3.1, R7.3.3, R7.3.4, R7.3.5, R7.12.1, R7.12.3, R7.12.4.

## Fase 2 — Backend: KPIs reproductivos (consumen Stream A)

- [x] **T2.1** — Migración `01NN_reports_repro_kpis.sql`: RPC `rodeo_pregnancy_kpi(p_rodeo_id, p_year)` → invoca
  `rodeo_service_campaign` (is_configured), `rodeo_serviced_females`, `rodeo_repro_denominator`; numerador
  `pregnant` = tacto+ vigente (misma subquery que `compute_category` RT2.7.5). Guard + cota `p_year` + grants +
  smoke-check. Cubre: R7.5.1, R7.5.2, R7.5.5, R7.5.6, R7.5.7, R7.12.2, R7.12.4.
- [x] **T2.2** — RPC `rodeo_calving_kpi(p_rodeo_id, p_year)`: numerador `calved` = servidas con ≥1 `birth` cuyo
  **mes de concepción** (mes parto − 9, wrap 1-12) ∈ `service_months` (alinea con servidas, Gate 0 §5); devuelve
  `serviced/entoradas/pregnant/calved`. Cubre: R7.6.1, R7.6.2, R7.6.5, R7.6.6.
- [x] **T2.3** — RPC `rodeo_ccl_distribution(p_rodeo_id, p_year)` → conteo head/body/tail (`large/medium/small`)
  del último tacto+ vigente de las preñadas de la campaña + `n_months` + `total`. Cubre: R7.7.1, R7.7.5.
- [x] **T2.4** — RPC `rodeo_calving_by_stage(p_rodeo_id, p_year)` → nacimientos por tercio de `service_months`
  (mes de concepción ubicado en cabeza/cuerpo/cola). Documentar la deuda de consistencia con `pregnancy-buckets`
  (bucketing 4-11 `[SUPUESTO]`, Gate 0 §9). Cubre: R7.8.1.
- [x] **T2.5** — Test (`reports/run.cjs`) de los 4 KPIs sobre fixtures: %preñez y %parición con valores
  conocidos; **denominador 0 → la RPC devuelve serviced=0 sin NaN** (R7.5.4/R7.6.3); rodeo sin `service_months`
  → `is_configured=false` (R7.5.6/R7.6.6); CCL vacío → total=0 (R7.7.4); cruce nacimientos degrada con total_born=0
  (R7.8.3); tenant-scope/anti-IDOR/read-only/grants en las 4. Cubre: R7.5.4, R7.6.3, R7.7.4, R7.8.3, R7.12.x.
- [x] **T2.6** — Test: con **base única servidas** (sin alternar — R7.5.3/R7.6.4, Puerta de spec 2026-06-24), el
  %preñez = `pregnant/serviced` y el %parición = `calved/serviced` salen correctos sobre los absolutos que devuelve
  la RPC; la **pérdida preñez→parición** se verifica comparando los dos KPIs sobre la misma base servidas
  (`pregnant ≥ calved`), no con una base alterna. La RPC sigue devolviendo `entoradas`/`pregnant` como insumo (no
  se eliminan del shape), pero el test NO ejercita un toggle de base. Cubre: R7.5.3, R7.6.4.

## Fase 3 — Backend: peso por categoría

- [x] **T3.1** — Migración `01NN_reports_weight_by_category.sql`: RPC `rodeo_weight_by_category(p_rodeo_id)` →
  AVG del último `weight_event` no borrado por animal activo, group by categoría, con `n_animals`; guard +
  grants + smoke-check. Variante/param para "por sesión" (comparativa, R7.9.5). Cubre: R7.9.1, R7.9.2, R7.9.4,
  R7.9.5, R7.12.2, R7.12.4.
- [x] **T3.2** — Test (`reports/run.cjs`): promedio correcto sobre fixtures, excluye borrados (R7.9.3), categoría
  sin peso ausente (la UI la marca "sin pesar", R7.9.4), tenant-scope/read-only/grants. Cubre: R7.9.1, R7.9.3,
  R7.9.4, R7.12.x.

## Fase 4 — Backend: alertas

- [x] **T4.1** — Migración `01NN_reports_alerts.sql`: RPC `establishment_overdue_doses(p_establishment_id uuid,
  p_lookback_days int default 365, p_limit int default 500)` → `sanitary_events` no borrados, animal activo,
  `next_dose_date < hoy`, sin dosis posterior del mismo producto/animal; identifica animal+producto+fecha. **Guard
  `has_role_in(p_establishment_id)` como 1ª sentencia ejecutable** (M1, design §5.1; el `p_establishment_id` viene
  del cliente, no se deriva de una fila). **Tenant en el join a `animal_profiles` (`p.establishment_id = v_est`),
  no por la columna denorm de `sanitary_events`** (M2, §5.5), con **`p.deleted_at IS NULL` + `p.status='active'` en
  el join** (M3, §5.6). **Cota de escaneo** (M4, §5.4): piso `next_dose_date >= current_date - make_interval(days
  => p_lookback_days)` + `LIMIT p_limit`; validar `p_lookback_days >= 0` y `p_limit between 1 and 1000` tras el
  guard (raise `22023`). Grants + smoke-check. Cubre: R7.10.1, R7.10.2, R7.10.3, R7.10.5, R7.12.2, R7.12.4.
- [x] **T4.2** — En la misma migración: RPC `establishment_unweighed(p_establishment_id, p_threshold_days int
  default 180, p_category_codes text[] default null)` → activos sin peso o último pesaje > umbral, filtrado por
  categorías; identifica animal+categoría+días. **El umbral 180 d es el default-MVP CERRADO** (Puerta de spec
  2026-06-24), parametrizado por tuneabilidad ("quizá lo modifiquemos", Raf); **el alcance/categorías sigue
  `[SUPUESTO]`/Facundo (D2)**. Parámetros, no hardcode. Mismo guard 1ª-sentencia (M1) + scoping por el join a
  `animal_profiles` con `deleted_at`/`status` en el join (M2/M3). **Cota de input** (M4-menor/L1): validar
  `p_threshold_days between 0 and 3650` (tope concreto = 10 años, testeable) y `cardinality(p_category_codes) <= 64`
  (raise `22023` fuera de rango). Cubre: R7.11.1, R7.11.2, R7.11.3, R7.11.4, R7.11.6.
- [x] **T4.3** — Test (`reports/run.cjs`): dosis vencida detecta el caso y excluye el que tiene dosis posterior
  (R7.10.1), excluye archivados/borrados (R7.10.3); sin pesar respeta umbral y `p_category_codes` (R7.11.1/.2),
  "nunca pesado" aparece (R7.11.3); empty = lista vacía (la UI muestra el positivo); tenant-scope/grants.
  **(M1) assert IDOR explícito** — al estilo de T1.3/T2.5: un JWT del tenant B que llama
  `establishment_overdue_doses(est_A, ...)` (y `establishment_unweighed(est_A, ...)`) recibe `42501`, **no** un set
  vacío silencioso (R7.12.3). **(M4) assert de cota de escaneo** — `establishment_overdue_doses` respeta la ventana
  `p_lookback_days` (una dosis vencida más vieja que la ventana NO aparece) y el `LIMIT`; `p_lookback_days < 0` o
  `p_limit` fuera de `[1,1000]` → `22023`; `establishment_unweighed` rechaza `p_threshold_days` fuera de `[0,3650]`
  (`< 0` y `> 3650`) y `cardinality(p_category_codes) > 64` con `22023`. Cubre: R7.10.x, R7.11.x, R7.12.1, R7.12.3, R7.12.4.

## Fase 5 — Cliente: capa de datos + helper puro

- [x] **T5.1** — `app/src/utils/calving-stage.ts` (PURO): mapeo mes-de-concepción → bucket (cabeza/cuerpo/cola)
  por tercios de `service_months`, espejo de la regla de la RPC (T2.4). Cubre: R7.8.1 (etiquetado UI).
- [x] **T5.2** — `app/src/utils/calving-stage.test.ts` (node:test): tercios para 3-11 meses, cabeza/cola para 2,
  vacío para 1/12/null (consistente con `pregnancy-buckets`). Cubre: R7.8.1.
- [x] **T5.3** — `app/src/services/reports.ts`: wrappers `supabase.rpc(...)` de TODAS las RPC; mapeo snake→camel;
  **detección de offline antes de llamar** (`assertOnline` → `{ kind: 'offline' }`); traducción de errores a
  `ReportError` accionable. Única capa I/O (architecture.md). Cubre: R7.2.1, R7.2.2, R7.2.4.
  *(As-built: la lógica PURA testeable [mapeo de %, formato es-AR, comparativas] vive en `app/src/utils/
  reports-format.ts` — split SDK/puro, mismo criterio que online-guard/online-guard-pure; el `ReportError`
  tiene kinds `offline|network|server|forbidden|validation` para mapear 42501/P0002/22023 del contrato. Detalle
  en `progress/impl_07-reportes-frontend.md` §Reconciliación.)*
- [x] **T5.4** — `app/src/hooks/use-reports.ts`: orquesta `reports.ts`; estado loading/online/error; **anti-
  parpadeo** (`loading && data===null` vía `reportView`; refresh sin blanquear, conventions.md UI). Cubre:
  R7.2.2, R7.2.4, R7.1.3. *(R7.2.3 cache "datos de la última carga" = nice-to-have NO implementado en el MVP —
  el anti-parpadeo conserva el `data` previo en memoria pero NO lo marca "stale"; anotado como limitación
  conocida en el ledger.)*

## Fase 6 — Cliente: pantalla Reportes (KPIs + alertas)

- [x] **T6.1** — `app/app/(tabs)/reportes.tsx`: reemplaza el stub; selector de rodeo + selector de campaña (año,
  **default = última campaña con datos** del rodeo — Puerta de spec 2026-06-24, NO el año calendario; el wrap de
  fin de año lo resuelve el server por set-membership, R7.5.8); scope por establecimiento activo (recarga al
  cambiar de establecimiento). Cubre: R7.1.1, R7.1.2, R7.1.3, R7.1.4, R7.5.7, R7.5.8.
- [x] **T6.2** — Cards de KPI: %preñez (R7.5), %parición (R7.6) con **% grande + numerador/denominador absolutos**
  (denominador explícito, ej. "preñadas 41 / servidas 46"). **Base ÚNICA servidas, SIN toggle de denominador**
  (Puerta de spec 2026-06-24, R7.5.3/R7.6.4) — no se construye `DenominatorToggle`; la pérdida preñez→parición se
  lee comparando %preñez vs %parición. "—"/"sin datos" si servidas = 0 (no NaN). Cubre: R7.5.1, R7.5.3, R7.5.4,
  R7.5.5, R7.6.1, R7.6.3, R7.6.4, R7.6.5.
- [x] **T6.3** — Componente CCL (`components/reports/CclBars`): barras cabeza/cuerpo/cola, nº de barras decidido
  por `sizeBucketsForServiceMonths(n_months)` de `pregnancy-buckets.ts` (fuente única); oculta CCL para 1/12/sin
  config/override "sin distinción" con nota explicativa (R7.7.3); empty state si total=0 (R7.7.4); muestra el
  total base (R7.7.5). Cubre: R7.7.1, R7.7.2, R7.7.3, R7.7.4, R7.7.5.
- [x] **T6.4** — Cruce tacto↔nacimientos: muestra `rodeo_calving_by_stage` junto al CCL del tacto (R7.8.2);
  degrada con gracia si no hay nacimientos de la campaña (R7.8.3). Usa `calving-stage.ts` para etiquetar. Cubre:
  R7.8.1, R7.8.2, R7.8.3.
- [x] **T6.5** — Peso por categoría: lista categorías con AVG + nº de animales; formato es-AR (coma decimal);
  categorías sin peso → "sin pesar"/"—". Cubre: R7.9.1, R7.9.2, R7.9.3, R7.9.4.
- [x] **T6.6** — Estado "configurá la estación de servicio" cuando `is_configured=false`, con CTA a la edición del
  rodeo (cross-spec spec 02, `/editar-servicio`). Cubre: R7.5.6, R7.6.6.
- [x] **T6.7** — Sección de alertas: dosis vencida (R7.10) + sin pesar (R7.11) con ítems accionables (animal/
  producto/fecha · animal/categoría/días) y **empty states positivos**. Cubre: R7.10.2, R7.10.4, R7.11.3, R7.11.5.
- [x] **T6.8** — Estado offline ("necesitás conexión") + error con reintento, por sección. Cubre: R7.2.2, R7.2.4.

## Fase 7 — Cliente: resumen y comparativa de sesión

- [x] **T7.1** — `app/app/reportes/sesion/[id].tsx`: conteos por tipo de evento (RPC) + marco temporal
  (started/ended, lectura LOCAL `getSessionById`) + animales intervenidos; empty state si no hay eventos.
  *(As-built: la LISTA de sesiones para elegir [R7.3.6] se separó en `app/app/reportes/sesiones.tsx` — entrada
  desde la tab Reportes; el detalle es `sesion/[id]`. 3 archivos en vez de los 2 de design §1.)* Cubre:
  R7.3.1, R7.3.2, R7.3.5, R7.3.6.
- [x] **T7.2** — `app/app/reportes/comparar.tsx`: elegir 2 sesiones del **mismo** rodeo (la lista ya está
  scopeada al rodeo; la 2ª no puede repetir la 1ª); tabla lado a lado con delta por tipo de evento
  (`compareSessions`: 0 + delta en celdas faltantes, no se omite la fila). Cubre: R7.4.1, R7.4.2, R7.4.3.
- [x] **T7.3** — Comparativa de peso por categoría entre **dos sesiones del mismo rodeo** (`compareWeights`,
  delta por categoría), reusando `rodeo_weight_by_category(rodeoId, sessionId)`. **MVP = solo por sesiones**;
  la comparativa por campaña queda post-MVP (no se implementa). Cubre: R7.9.5.

## Fase 8 — Consistencia transversal + cierre

- [ ] **T8.1** — Verificar exclusión transversal de archivados/borrados en todas las RPC de rodeo (R7.13.1,
  R7.13.3) **filtrando `p.deleted_at IS NULL` + `p.status='active'` en el join a `animal_profiles`, NO confiando en
  `establishment_of_profile`** (M3, design §5.6: el helper 0023 no filtra `deleted_at`); confirmar que el scoping
  de tenant va por ese mismo join (`p.establishment_id = v_est`), no por la columna denorm de las tablas de evento
  (M2, §5.5). Documentar la inclusión de archivados en el histórico de sesión (R7.13.2 — **CERRADO en la Puerta de
  spec 2026-06-24: INCLUIR**; el `session_event_summary` no filtra `status` pero sí `deleted_at`). Cubre: R7.13.1, R7.13.2, R7.13.3.
- [ ] **T8.2** — Confirmar que la ficha individual (`animal_timeline`) NO se reimplementa; dejar nota de
  trazabilidad. Cubre: R7.14.1.
- [ ] **T8.3** — Veto `design-review` del leader sobre `reportes.tsx`, `sesion/[id].tsx`, `comparar.tsx` (títulos
  sin recorte de descendentes, empty states cálidos, error accionable, densidad legible) **antes** de mostrar a Raf.
- [ ] **T8.4** — Autorrevisión adversarial del implementer (paso 8 del agente) + mapa `R<n> → archivo:test` en
  `progress/impl_07-reportes-basicos.md`; reconciliar specs↔as-built (regla dura `docs/specs.md`).
- [ ] **T8.5** — **Gate 2 (security code)** por chunk: `security_analyzer` modo `code` sobre el diff (RLS/guards
  de las RPC, grants, sin filtración cross-tenant). Output `progress/security_code_07-reportes-basicos.md`.
- [ ] **T8.6** — Leader aplica las migraciones en remoto (post-Gate-2 + autorización de Raf), descomenta el hook
  de `reports/run.cjs` en `scripts/run-tests.mjs`, corre la suite → verde. ⏸ Puerta 2 (humana) → `done`.

---

## Notas de ejecución

- **No tocar Stream A.** Si una RPC de Stream C necesita el conjunto de `animal_profile_id` (no solo conteos), lo
  resuelve reusando `rodeo_serviced_females(...)` dentro de la propia RPC (design §8).
- **Fuente única de la regla CCL por meses** = `pregnancy-buckets.ts` (nº de barras). La asignación mes→tercio
  (RPC T2.4 + `calving-stage.ts` T5.1) es la parte nueva; cuando Facundo cierre el bucketing 4-11 (Gate 0 §9), se
  ajustan ambos lugares (deuda anotada en T2.4).
- **Roja-hasta-apply** esperada para `reports/run.cjs` hasta T8.6 (patrón `puesta-en-servicio` / `0093-0097`).
- **Preguntas abiertas** (requirements §"Preguntas abiertas") — **4 de 5 CERRADAS por Raf en la Puerta de spec
  (2026-06-24)**: comparativa de peso = sesiones (R7.9.5), %preñez/%parición base única servidas sin selector
  (R7.5.3/R7.6.4), año default = última campaña con datos + wrap por set-membership (R7.5.7/R7.5.8), archivados
  incluidos en histórico de sesión (R7.13.2). **Único pendiente = alcance/categorías de la alerta "sin pesar"**
  (Facundo, D2 — el umbral 180 d YA está decidido, R7.11.1); la spec deja R7.11.2 parametrizado para cerrarlo sin
  reescribir.
- **Gate 1 (M1-M4) foldeado** antes de la Puerta de spec (`progress/security_spec_07-reportes.md`, PASS). El
  contrato de seguridad que Gate 2 valida vive en `design.md` §5 (§5.1 guard 1ª-sentencia/M1, §5.4 cota de
  escaneo/M4, §5.5 join a `animal_profiles`/M2, §5.6 `deleted_at`/`status` en el join/M3) + la tabla §9. Asserts:
  T4.3 (IDOR + cota), T8.1 (join, no helper). Sin reabrir decisiones de Gate 0.
