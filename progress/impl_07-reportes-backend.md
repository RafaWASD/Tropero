baseline_commit: 5c29d81e127092586d0665bf6cb3f3f64e2c132b

# impl_07-reportes-backend — Stream C (backend) de spec 07-reportes-basicos

> **Scope de esta sesión (dispatch del leader):** SOLO el BACKEND de Stream C — las **8 RPCs SQL
> `SECURITY DEFINER`** de cómputo server-side (+ 1 lister de sesiones opcional, 9 funciones en total) + su suite
> no-bypass + el helper puro `calving-stage.ts`. Frontend (Fases 5-7 de `tasks.md`) va aparte, después. NO se
> aplica la migración al remoto (la aplica el leader por CLI/Management-API con OK de Raf, patrón Stream A). La
> suite `reports` queda **roja-hasta-apply** (esperado); el RESTO de `check.mjs` queda verde.

## ⚠️ Nota de estado de `feature_list.json` (para el leader)
`feature_list.json` feature 7 está en `status: "context_ready"`, NO `in_progress`. El leader dispatchó este
trabajo explícitamente (spec LOCKEADA commit `6a3b532`, Gate 1 PASS `progress/security_spec_07-reportes.md`,
M1-M4 + 5 decisiones de Raf foldeadas — ver `current.md` "07 a flipear a spec-aprobado cuando arranque Stream
C") y me instruyó NO tocar `feature_list.json`. Procedí porque la spec es verificablemente aprobada+lockeada.
**Acción para el leader:** flipear feature 7 a `in_progress` (y, tras Gate 2 + Puerta 2, a su estado de cierre).

## Artefactos construidos
- **Migración** `supabase/migrations/0106_reports_rpcs.sql` — 9 funciones SQL `SECURITY DEFINER STABLE
  set search_path=public` + grants/revoke + smoke-check fail-closed. (Nº `0106`: último as-built `0105`; `0092`
  saltada/spec-08.)
- **Helper puro** `app/src/utils/calving-stage.ts` + `app/src/utils/calving-stage.test.ts` (15 tests, node:test).
- **Suite no-bypass** `supabase/tests/reports/run.cjs` (TR.1-TR.10).
- **Hook** en `scripts/run-tests.mjs`: `reports/run.cjs` enganchado COMENTADO (roja-hasta-apply); `calving-stage.test.ts`
  agregado a la lista de unit (corre verde en `check.mjs`).

## Las 9 RPC — guard, cota, scope (design §2/§5)
| RPC | Guard (§5.1) | Cota (§5.3/§5.4) | Tenant/scope (M2/M3, §5.5/§5.6) |
|---|---|---|---|
| `session_event_summary(p_session_id)` | est de `sessions` → `has_role_in`; P0002 si no existe | — | join a `animal_profiles` `est=v_est` + `deleted_at is null`; **SIN status** (R7.13.2 incluye archivados) |
| `rodeo_sessions_list(p_rodeo_id)` | est de `rodeos` → `has_role_in` | — | join a `animal_profiles` `est=v_est` + `deleted_at` (sin status, histórico) |
| `rodeo_pregnancy_kpi(p_rodeo_id, p_year)` | est de `rodeos` → `has_role_in` | `p_year ∈ [1900, current+1]` | reusa `rodeo_serviced_females`/`rodeo_repro_denominator` (§5.7, re-guardan tenant) |
| `rodeo_calving_kpi(p_rodeo_id, p_year)` | idem | `p_year` | idem; concepción ancla por año calendario `p_year` (R7.5.8) |
| `rodeo_ccl_distribution(p_rodeo_id, p_year)` | idem | `p_year` | idem (conjunto servidas) |
| `rodeo_calving_by_stage(p_rodeo_id, p_year)` | idem | `p_year` | idem; bucketing mes→tercio espejo de `calving-stage.ts` |
| `rodeo_weight_by_category(p_rodeo_id, p_session_id?)` | est de `rodeos` → `has_role_in`; `p_session_id` ajeno al rodeo → `42501` | — | join a `animal_profiles` `est=v_est` + `deleted_at` + **`status='active'`** (KPI de rodeo) |
| `establishment_overdue_doses(p_est_id, p_lookback_days=365, p_limit=500)` | **`has_role_in(p_est_id)` 1ª SENTENCIA** (M1) | `p_lookback_days>=0`, `p_limit ∈ [1,1000]`, ventana + `LIMIT` (M4) → `22023` | join a `animal_profiles` `est=p_est_id` + `deleted_at` + `status='active'` |
| `establishment_unweighed(p_est_id, p_threshold_days=180, p_category_codes?)` | **`has_role_in(p_est_id)` 1ª SENTENCIA** (M1) | `p_threshold_days ∈ [0,3650]`, `cardinality(p_category_codes) <= 64` (M4/L1) → `22023` | join a `animal_profiles` `est=p_est_id` + `deleted_at` + `status='active'` |

Grants: las 9 con `revoke execute from public, anon` + `grant to authenticated` + smoke-check fail-closed que
hace `raise` si alguna quedó EXECUTE-able por anon/public (R7.12.4, patrón `0105` (4)).

## Cómo scopeo por join (M2) — clave
Las tablas de evento `weight/reproductive/sanitary/condition/lab` tienen `establishment_id` DENORM (`0077`) que
es **plumbing del sync** (su RLS canónica es por FK al perfil). En una RPC SECDEF la RLS no protege ⇒ scopeo
**por el JOIN a `animal_profiles` con `p.establishment_id = v_est`**, NO por la columna denorm de la tabla de
evento (espejo de `rodeo_serviced_females` `0105:117-122`). `custom_measurements`/`scrotal_measurements` tienen
`establishment_id` como su RLS canónica, pero igual paso por el join (uniforme + es donde viven los filtros M3
`deleted_at`/`status`). `establishment_of_profile` (`0023:9`) NO filtra `deleted_at` → NO se usa (M3).

## Trazabilidad R<n> → archivo:test
> Tests del BACKEND = `supabase/tests/reports/run.cjs` (TR.x, roja-hasta-apply) + el helper puro
> `app/src/utils/calving-stage.test.ts`. La UI (R7.1, R7.2, R7.x de presentación, R7.4 comparativa, R7.14) la
> cubre el FRONTEND (sesión aparte). Acá mapeo lo que el backend cubre:

| R<n> | Cubierto por |
|---|---|
| R7.3.1/.2 (resumen por tipo, marco temporal) | `reports/run.cjs` TR.1 (`session_event_summary`) + `rodeo_sessions_list` started/ended |
| R7.3.3 (excluye borrados) | TR.1 (weight borrado NO cuenta) |
| R7.3.4 (sesión active igual computa) | TR.1 (sesión `active`) |
| R7.3.5 (vacía → empty state) | TR.1 (sesión vacía → 7 kinds con 0) |
| R7.3.6 (lista de sesiones desc) | TR.2 (`rodeo_sessions_list` order desc) |
| R7.5.1/.2 (%preñez = preñadas/servidas; tacto+ vigente) | TR.3 (pregnant=2, aborto revierte) |
| R7.5.4 (servidas 0 sin NaN) | TR.3 (rodeo sin servidas → serviced=0) |
| R7.5.5 (absolutos num/den) | TR.3 (serviced/entoradas/pregnant/empty devueltos) |
| R7.5.6 (sin service_months → is_configured=false) | TR.3 (rodeo sin service_months) |
| R7.5.8 (wrap por set-membership) | TR.4 (servicio {11,12,1}, concepción Ene cuenta) |
| R7.6.1/.2 (%parición = paridas/servidas; mes concepción ∈ service_months) | TR.4 (calved=2 por concepción) |
| R7.6.3 (servidas 0 sin NaN) | TR.4 (rEmpty → calved=0) |
| R7.6.4 (base única servidas; pérdida visible) | TR.4 (pregnant ≥ calved) + TR.3/TR.4 absolutos (sin toggle) |
| R7.7.1/.5 (CCL head/body/tail + total) | TR.5 (large/medium/small = 1/1/1, total=3) |
| R7.7.4 (sin preñeces → total=0) | TR.5 (rEmpty → total=0) |
| R7.8.1 (nacimientos por etapa) | TR.6 (head/body/tail_born = 1/1/1) + `calving-stage.test.ts` (mapeo puro) |
| R7.8.3 (sin nacimientos degrada) | TR.6 (rEmpty → total_born=0) |
| R7.7.2/.3 vía buckets (1/12 → sin distinción) | TR.6 (1 mes → total_born=0) + `calving-stage.test.ts` (1/12/null → null) |
| R7.9.1/.3 (AVG último peso, excluye borrados) | TR.7 (AVG=450, borrado excluido) |
| R7.9.2 (n_animals) | TR.7 (n_animals=2) |
| R7.9.4 (categoría sin peso ausente) | TR.7 (vaquillona sin peso no aparece) |
| R7.9.5 (comparativa por sesión) | TR.7 (variante `p_session_id` → solo esa sesión) |
| R7.10.1 (vencida sin dosis posterior) | TR.8 (a1 aparece; a2 cubierta NO) |
| R7.10.2 (identifica animal/producto/fecha) | TR.8 (idv/product_name/next_dose_date) |
| R7.10.3 (excluye archivados/borrados) | TR.8 (a4 archivado NO aparece) |
| R7.10.5 (cota de escaneo M4) | TR.8 (ventana corta/amplia, LIMIT, 22023 fuera de rango) |
| R7.11.1 (sin pesar/umbral) | TR.9 (u1 nunca pesado, u2 >180, u3 reciente no) |
| R7.11.2 (p_category_codes) | TR.9 (filtro multipara) |
| R7.11.3 (identifica animal/categoría/días) | TR.9 (idv/category/days_since) |
| R7.11.4 (excluye archivados) | TR.9 (u4 archivado NO aparece) |
| R7.11.6 (cota de input M4) | TR.9 (p_threshold_days [0,3650], cardinality≤64 → 22023) |
| R7.12.1/.2 (tenant-scope, guard antes de datos) | TR.1-TR.9 (field_operator lee; guard 1ª) + TR.10 (tenant-isolation) |
| R7.12.3 (IDOR → rechazo, no vacío) | TR.1/TR.3/TR.4/TR.5/TR.6/TR.7 (owner B → 42501) + TR.8/TR.9 (M1 alertas → 42501) |
| R7.12.4 (read-only, revoke anon/public) | TR.10 (anon sin EXECUTE en las 9; read-only count) |
| R7.13.1/.3 (KPI excluye archivados/borrados) | TR.7 (status='active' en el join) + exclusión de `deleted_at` en todas |
| R7.13.2 (histórico de sesión INCLUYE archivados) | TR.1 (a2 archivado SIGUE contando) |

## Autorrevisión adversarial (Gate-2-style anticipado)
Busqué, como revisor hostil:
- **(a) Desviaciones del spec / R<n> a medias.** El cruce de fin de año (R7.5.8): verifiqué que `calved`/
  `calving_by_stage` anclan la concepción por AÑO CALENDARIO `p_year` (espejo de Stream A), y descubrí que la
  nota de design §2.3 ("paren entre p_year y p_year+1") es imprecisa para el wrap-Ene (paren el MISMO año). La
  RPC está bien; reconcilié la precisión en design §11.4 y corregí el fixture de TR.4 (un test mío estaba mal:
  esperaba que un parto en Oct(year+1) contara como concepción Ene — en realidad Oct(year+1)−9mo = Ene(year+1) ≠
  p_year; el correcto es parto Oct(**year**)). **Bug de test cazado y corregido.**
- **(b) Bugs / edge cases.** `rodeo_calving_by_stage`: hice `births` `distinct on (animal)` para que
  `total_born == calved` (evita doble-conteo de mellizos). Probé el v_start del run con wrap (Nov→Dic→Ene) a mano
  contra `serviceRunBounds`. 0-denominador: la RPC devuelve `serviced=0`/`total=0`/`total_born=0` SIN dividir
  (la UI hace el %) → no hay NaN/Inf posible server-side (cubierto TR.3/TR.4/TR.5/TR.6).
- **(c) Seguridad.** Las 2 alertas: `has_role_in(p_establishment_id)` ES la 1ª sentencia (M1) — verificado; IDOR
  → `42501`, no vacío (TR.8/TR.9). Tenant por join a `animal_profiles` (M2), no por columna denorm — verificado
  en las 9. `deleted_at`/`status` en el join, no en `establishment_of_profile` (M3). Cotas de input en TODAS las
  que toman input no-uuid (M4: p_year, p_lookback_days/p_limit, p_threshold_days, cardinality). `revoke
  anon/public` + smoke-check. Sin SQL dinámico (todos los params son tipados de PostgREST). `rodeo_weight_by_category`:
  agregué guard anti-IDOR sobre el `p_session_id` opcional (sesión ajena al rodeo → 42501). `STABLE`, no escribe
  (TR.10 read-only). Sin PII más allá de idv/visual_id_alt/product_name (datos del tenant ya visibles por RLS;
  ningún `*_private`).
- **(d) "Posterior dose".** Cacé que keyear "dosis posterior" por `next_dose_date` (mi 1er intento) marcaba
  "cubierta" una vencida vieja por una posterior con turno aún más viejo. Lo cambié a "`se` es la ÚLTIMA
  APLICACIÓN del producto por `(event_date, created_at)`" → el overdue refleja el estado vigente. Reconcilié en
  design §11.5 y ajusté el fixture de a2 (re-vacunación con turno FUTURO cubre la vencida vieja).
- **(e) Tests que pasan por la razón equivocada.** TR.1 ejerce el path real (weight borrado NO cuenta, archivado
  SÍ — distinct animals=2). TR.8/TR.9 verifican el REJECT (42501) y no un set vacío. TR.10 prueba el revoke con
  anon real. Las cotas se prueban en ambos extremos (LB<0 y limit>1000; threshold<0 y >3650; cardinality 65).
- **Riesgo residual conocido (NO bug):** NO pude aplicar `0106` al remoto (sin MCP/deploy, prohibido por el
  dispatch) → la suite `reports` no corrió. Revisé la sintaxis SQL a mano (balance de `$$`, `return next`/`query`,
  records para evitar shadowing de OUT params, `date - int → date`, modulo int). El leader la aplica y corre la
  suite (verde post-apply confirma). Documentado como roja-hasta-apply.

## Reconciliación de specs al as-built (regla dura)
Reconciliado ANTES de reportar (detalle en `design.md §11` + nota de cabecera de `tasks.md`):
- **§11.1** una sola migración `0106` (no 4 `01NN_*`).
- **§11.2** `rodeo_weight_by_category` variante por sesión = parámetro opcional + guard anti-IDOR del session_id.
- **§11.3** 9 funciones (la 9ª `rodeo_sessions_list` era OPCIONAL en §2.1; se expone igual).
- **§11.4** wrap = anclaje por año calendario de la concepción (precisión de §2.3).
- **§11.5** alerta dosis vencida: "posterior" = última aplicación por event_date (precisión de §2.7).
- **§11.6** `calving_by_stage` un parto por hembra (`distinct on`), `total_born == calved`.
`requirements.md` NO se tocó: los EARS se cumplen tal cual (las reconciliaciones son del *cómo*, no del *qué*).
`tasks.md`: T1.1-T4.2 (RPC) + T1.3/T2.5/T2.6/T3.2/T4.3 (tests) + T5.1/T5.2 (helper) marcadas `[x]`.

## Verificación
- `node scripts/check.mjs` **VERDE** end-to-end (typecheck + unit [incl. los 15 de calving-stage] + RLS/Edge/
  Animal/Maneuvers/Custom/Scrotal/user_private/Import/Sync-streams/Operaciones-rodeo/Puesta-en-servicio). La suite
  `reports` NO corre (hook comentado) → **roja-hasta-apply** documentada.
- `node --check supabase/tests/reports/run.cjs` OK (sintaxis JS).

## Pendiente (para el leader)
1. Flipear `feature_list.json` feature 7 → `in_progress` (estaba `context_ready`).
2. Aplicar `supabase/migrations/0106_reports_rpcs.sql` al remoto (CLI/Management-API) **con OK de Raf** (patrón
   Stream A 0102-0105) — depende de `0105` (Stream A) y el tacto con `pregnancy_status` (Stream B), ya aplicados.
3. Descomentar el hook `run('Reports suite (spec 07 Stream C)', ...)` en `scripts/run-tests.mjs` → correr la suite
   → verde post-apply.
4. reviewer + Gate 2 (security code) sobre `0106` + la suite → Puerta 2.

## Bitácora
- Leí spec lockeada + as-built consumido (`0105` Stream A, `0104` compute_category, `0023`/`0005` helpers, `0050`
  sessions, `0020`/`0015` profiles/categories, `0025-0029`/`0077`/`0094`/`0098` event tables) + molde de suite
  (`puesta-en-servicio`/`operaciones_rodeo`) + helpers cliente (`pregnancy-buckets.ts`/`service-months.ts`).
- Baseline `check.mjs` VERDE (PAT rotado). Implementé helper puro → tests (15/15 verde) → migración 0106 → suite
  no-bypass → hook. Autorrevisión cazó 1 bug de test (wrap year) + 1 mejora de semántica (posterior dose por
  event_date) → corregidos + reconciliados. check.mjs final VERDE.

## Fix-loop #2 — 42702 `column reference "id" is ambiguous` en `rodeo_sessions_list` (TR.2)
> Dispatch del leader: fix SQL de calificación de refs (1 línea real) en `0106_reports_rpcs.sql`. NO aplico (lo
> re-aplica el leader + re-corre `reports/run.cjs`, debe quedar 14/14). Solo este archivo + el ledger.

**Causa raíz (verificada).** `rodeo_sessions_list` declara `returns table (id uuid, ...)` → `id` es un OUT
param, en scope PL/pgSQL en TODO el body. La derivación del tenant tenía `from public.rodeos where id =
p_rodeo_id and deleted_at is null` con `id` SIN calificar → choca con el OUT param `id` (42702). El fix-loop #1
había tocado `sess.id` (línea ~188/192), que YA estaba calificado por el alias de CTE → **red herring**; el real
era la línea de derivación del tenant (~159-160).

**Fix aplicado.** Aliasé la tabla `rodeos` como `r` y califiqué toda referencia de columna de esa sentencia:
`select r.establishment_id into v_est from public.rodeos r where r.id = p_rodeo_id and r.deleted_at is null;`
(`establishment_id`/`deleted_at` no son OUT params → no eran ambiguos; los califiqué igual por consistencia una
vez aliasada la tabla — cero cambio de semántica). Agregué comentario explicando por qué `id` colisiona acá.
También afiné el comentario de la línea `select sess.id from sess` para dejar claro que YA estaba bien (no era el
bug). M1-M4 + las decisiones de spec quedan intactas: sólo se calificaron refs.

**Barrido de las 9 funciones (mismo patrón: bare column que colisione con un OUT param de su `returns table`).**
Mapeo OUT params → bare refs revisado en las 9; la ÚNICA colisión real es la de arriba. Detalle:

| RPC | OUT params | bare `id`/colisión? |
|---|---|---|
| `session_event_summary` | event_kind, event_count, animals | `where id = p_session_id` (L66): no hay OUT `id` → **no ambiguo**. Resto qualified (`w./re./se./ce./ls./sm./cm./p./r./k.`). Aliases (`as event_count`, `as animals`) = definiciones. ✓ |
| **`rodeo_sessions_list`** | **id**, started_at, ended_at, status, work_lot_label, animal_count, event_count | **COLISIÓN en `where id` → corregida (`r.id`)**. `sess.id`/`s.id`/`s.status`/`s.started_at`… todos qualified; `select id…` de L152 es la decl de OUT. ✓ |
| `rodeo_pregnancy_kpi` | is_configured, serviced, entoradas, pregnant, empty | `where id` (L222): no OUT `id` → no ambiguo. OUT se asignan por `:=`/`into` (LHS variable, RHS `v_cfg.`/`v_denom.` qualified). `'empty'` = literal. ✓ |
| `rodeo_calving_kpi` | is_configured, serviced, entoradas, pregnant, calved | idem; `into pregnant` / `into calved` = asignación, no col ref. refs en CTE qualified (`lt./s./b./ab.`). ✓ |
| `rodeo_ccl_distribution` | n_months, head, body, tail, total | `where id` (L364): no OUT `id`. `into head, body, tail, total` = asignación; `'large'/'medium'/'small'` literales; refs qualified (`lt./ab.`). ✓ |
| `rodeo_calving_by_stage` | n_months, head_born, body_born, tail_born, total_born | `where id` (L427): no OUT `id`. `head_born := 0…` / `into head_born…` = asignación; `'head'/'body'/'tail'` literales; refs qualified (`s./b./circ./cur_nxt.`). ✓ |
| `rodeo_weight_by_category` | category_id, category_code, category_name, avg_weight, n_animals | `where id` (L521): OUT es `category_id`, NO `id` → no ambiguo. refs qualified (`w./p./lw./c.`); `as avg_weight`/`as n_animals` = aliases. ✓ |
| `establishment_overdue_doses` | animal_profile_id, idv, visual_id_alt, product_name, next_dose_date | sin `where id`. TODAS las refs qualified (`se./p./later.`); L581 = decl de OUT (bare correcto). ✓ |
| `establishment_unweighed` | animal_profile_id, idv, visual_id_alt, category_code, category_name, last_weight_date, days_since | sin `where id`. `p.id as animal_profile_id` = alias (definición, no ref). refs qualified (`p./c./w./aa./lw.`). ✓ |

**Por qué no califiqué los otros 5 `where id = p_rodeo_id`** (L222/292/364/427/521) ni el `where id = p_session_id`
(L66): sus funciones NO declaran `id` como OUT param → el bare `id` resuelve sin ambigüedad a la PK de la tabla.
El dispatch pedía calificar lo que *colisiona*; calificarlos sería ruido sin cambio de comportamiento. (Si a
futuro se agrega un OUT `id` a alguna, habría que calificarlas — anotado.)

**Verificación a mano (no apliqué, no pude correr la suite).** Grep de todo bare `id`/nombre-de-OUT-param sobre
WHERE/JOIN/SELECT/GROUP BY/ORDER BY en las 9: 0 colisiones restantes. Asignaciones por `:=`/`into` y record-field
(`v_cfg.x`) NO disparan 42702 (idioma estándar PL/pgSQL); aliases de SELECT (`x as y`) son definiciones, no refs;
literales (`'head'`, `'empty'`) no son columnas. Balance de `$$`, `return query`/`return next` y comments intactos.
**Para el leader:** re-aplicar `0106` + re-correr `supabase/tests/reports/run.cjs` → esperado **14/14** (TR.2 ya no
debe tirar 42702).
