# Review — spec 07-reportes-basicos · BACKEND (Stream C)

Reviewer (agente). Alcance: SOLO el backend de Stream C — supabase/migrations/0106_reports_rpcs.sql
(9 funciones SECURITY DEFINER STABLE), supabase/tests/reports/run.cjs (suite no-bypass, roja-hasta-apply por
diseño), app/src/utils/calving-stage.ts (+ .test.ts). La migración NO está aplicada al remoto (la aplica el
leader con OK de Raf). Revisión del SQL ESTATICO + código de la suite; NO se esperó verde de reports/run.cjs.

## Veredicto: APPROVED

## 1. Gates duros

- node scripts/check.mjs verde: OK exit 0 (Entorno listo / All tests passed). Los 15 tests de
  calving-stage.test.ts corren en la suite unit (verde); reports/run.cjs correctamente COMENTADO en
  scripts/run-tests.mjs:81 (roja-hasta-apply esperado, patrón puesta-en-servicio).
- Cada R7.x backend ligado a test: OK (ver seccion 2).
- Tasks del backend en [x]: OK (ver seccion 3).
- design/requirements vs as-built: OK reconciliado en design seccion 11 (6 precisiones); requirements.md sin
  tocar (EARS literal). Ver seccion 4.
- Seccion RAFAQ aplicable sin [ ] injustificado: OK A + E aplican; B/C/D = N/A. Ver seccion 7.

## 2. Trazabilidad R7.x -> test (backend)

Tests del backend = supabase/tests/reports/run.cjs (TR.1-TR.10, roja-hasta-apply) + helper puro
calving-stage.test.ts. Las R de UI las cubre el FRONTEND (sesion aparte, design seccion 1): R7.1.x, R7.2.x,
R7.4.x (comparativa UI), R7.5.7 (default ultima campaña con datos = cliente; la RPC toma p_year explicito),
R7.7.3 (oculta CCL = cliente), R7.10.4/R7.11.5 (empty states), R7.14. El design las asigna a la UI. Para el
stream bajo review, todo R backend tiene test.

| R7.x | Test |
|---|---|
| R7.3.1 conteo por tipo (7 tablas) | TR.1 (7 kinds; weight=2, sanitary=1) |
| R7.3.2 marco temporal / animales | TR.1 (animals distinct) + TR.2 (sessions_list) |
| R7.3.3 excluye borrados | TR.1 (weight borrado NO cuenta) |
| R7.3.4 sesion active igual computa | TR.1 (sesion active) |
| R7.3.5 vacia -> conteos 0 | TR.1 (7 kinds, todos 0) |
| R7.3.6 lista desc | TR.2 (order by started_at desc) |
| R7.5.1/.2 preñadas/servidas; tacto+ vigente | TR.3 (pregnant=2; aborto posterior revierte -> 1) |
| R7.5.3 base unica servidas, sin toggle | TR.3/TR.4 (RPC devuelve absolutos; el % lo hace la UI) |
| R7.5.4 servidas 0 -> sin NaN | TR.3 (serviced=0, pregnant=0) |
| R7.5.5 absolutos num/den | TR.3 (serviced/entoradas/pregnant/empty) |
| R7.5.6 sin service_months -> is_configured=false | TR.3 (rNoCfg) |
| R7.5.8 wrap por set-membership | TR.4 (servicio 11,12,1; concepcion Ene cuenta en el MISMO año) — traza independiente |
| R7.6.1/.2 paridas/servidas; concepcion in service_months | TR.4 (calved=2: Nov + Ene-wrap; Jun fuera) |
| R7.6.3 servidas 0 -> sin NaN | TR.4 (calved=0) |
| R7.6.4 base unica; perdida visible | TR.4 (pregnant >= calved) |
| R7.6.5 absolutos | TR.4 (serviced/entoradas/pregnant/calved) |
| R7.7.1/.5 CCL head/body/tail + total | TR.5 (1/1/1, total=3; empty NO cuenta) |
| R7.7.2 n_months gobierna buckets | TR.5 (n_months=3) + helper sizeBucketsForServiceMonths |
| R7.7.4 sin preñeces -> total=0 | TR.5 (rEmpty) |
| R7.8.1 nacimientos por etapa | TR.6 (1/1/1) + calving-stage.test.ts (15 tests) |
| R7.8.3 sin nacimientos degrada | TR.6 (total_born=0; 1 mes -> 0) |
| R7.9.1/.3 AVG ultimo peso, excluye borrados | TR.7 (AVG=450; 300 y borrado 999 excluidos) |
| R7.9.2 n_animals | TR.7 (n_animals=2) |
| R7.9.4 categoria sin peso ausente | TR.7 (vaquillona no aparece) |
| R7.9.5 comparativa por sesion | TR.7 (variante p_session_id; AVG=410) |
| R7.10.1 vencida sin dosis posterior | TR.8 (a1 aparece; a2 cubierta NO) |
| R7.10.2 identifica animal/producto/fecha | TR.8 (idv/product_name/next_dose_date) |
| R7.10.3 excluye archivados/borrados | TR.8 (a4 archivado NO) |
| R7.10.5 cota de escaneo M4 | TR.8 (ventana 5d/600d; LIMIT=1; lookback<0 y limit fuera 1..1000 -> 22023) |
| R7.11.1 sin pesar / umbral | TR.9 (u1 nunca; u2 >180d; u3 reciente no) |
| R7.11.2 p_category_codes | TR.9 (filtro multipara) |
| R7.11.3 identifica animal/categoria/dias | TR.9 (days_since; nunca -> null) |
| R7.11.4 excluye archivados | TR.9 (u4 archivado NO) |
| R7.11.6 cota de input M4 | TR.9 (threshold fuera 0..3650 -> 22023; cardinality 65 -> 22023) |
| R7.12.1 no expone sin rol | TR.1-9 (field_operator de A lee) + TR.10 (isolation A vs B) |
| R7.12.2 guard antes de devolver | TR.1-9 (guard 1ra) |
| R7.12.3 IDOR -> rechazo, no vacio | TR.1/3/4/5/6/7 (owner B -> 42501) + TR.8/TR.9 (M1 -> 42501) |
| R7.12.4 read-only, revoke anon/public | TR.10 (anon sin EXECUTE; count read-only) |
| R7.13.1/.3 KPI excluye archivados/borrados | TR.7 (status=active en el join) + deleted_at en todas |
| R7.13.2 historico de sesion INCLUYE archivados | TR.1 (a2 archivado SIGUE contando) |

Conclusion: ningun R7.x backend queda sin test concreto.

## 3. Tasks (tasks.md)

Backend (alcance de este review), todas [x]:
- T1.1, T1.2, T1.3 (session_summary + sessions_list + TR.1/TR.2).
- T2.1-T2.6 (4 KPIs + TR.3-TR.6).
- T3.1, T3.2 (peso por categoria + TR.7).
- T4.1, T4.2, T4.3 (2 alertas + TR.8/TR.9).
- T5.1, T5.2 (helper puro + 15 tests).

[ ] pendientes con justificacion (NO bloquean este review):
- T0.1/T0.2 — Gate 1 PASS + Puerta de spec ya ocurrieron; son del leader (lo dice la task). Spec LOCKEADA 6a3b532.
- T5.3-T7.3, T6.x — FRONTEND, sesion aparte (doc cabecera tasks.md + ledger).
- T8.1 — contenido sustantivo (join no helper; status en el join) IMPLEMENTADO y testeado (TR.7/TR.1); el
  checkbox de cierre lo marca el leader.
- T8.2/T8.3/T8.4/T8.5/T8.6 — frontend / leader / gate (autorrevision y mapa R->test ya en impl_07-reportes-backend.md).

Veredicto: las tasks del backend todas [x]; los [ ] restantes son frontend o pasos de leader/gate fuera de este
dispatch. Aceptable.

## 4. Exactitud de specs (codigo -> spec) — regla dura

design seccion 11 reconcilia 6 desvios as-built, verificados contra el codigo:
- 11.1 una sola migracion 0106 (no 4 archivos). Confirmado (unico bloque de grants/smoke-check).
- 11.2 rodeo_weight_by_category(p_rodeo_id, p_session_id default null) + guard anti-IDOR del session_id (sesion
  ajena -> 42501). Confirmado (l.522-531) + testeado (TR.7 crossSess -> 42501).
- 11.3 9 funciones (la 9a rodeo_sessions_list era OPCIONAL). Confirmado.
- 11.4 wrap = anclaje por AÑO CALENDARIO de la concepcion (precision de seccion 2.3, imprecisa). Confirmado:
  extract(year from event_date menos 9mo) = p_year; traza independiente confirma c2 (Ene-wrap) en el mismo año.
- 11.5 dosis posterior = ultima APLICACION del producto por (event_date, created_at), no por next_dose_date.
  Confirmado (l.613-619) + testeado (TR.8 a2).
- 11.6 rodeo_calving_by_stage un parto por hembra (distinct on), total_born == calved. Confirmado.

requirements.md sin tocar; los EARS se cumplen literal (reconciliaciones son del COMO). No hay spec mintiendo.

## 5. Seguridad (Gate 1 M1-M4) + correctitud — verificado en SQL estatico

- Guard fail-closed 1ra sentencia (M1): las 2 alertas (overdue_doses l.585, unweighed l.651) tienen
  has_role_in(p_establishment_id) como 1ra sentencia, raise 42501. Las 7 RPC con p_rodeo_id/p_session_id derivan
  el est de la fila (validando deleted_at IS NULL), P0002 si no existe, luego has_role_in(v_est) -> 42501. Espejo 0105.
- Cotas (M4): p_year en 1900..current+1 en las 4 KPI; p_lookback_days>=0 + p_limit en 1..1000 + piso de ventana
  + LIMIT en overdue_doses; p_threshold_days en 0..3650 + cardinality<=64 en unweighed. Tras el guard, raise 22023.
- Tenant por join a animal_profiles (M2): p.establishment_id = v_est en el JOIN, no por la columna denorm de la
  tabla de evento (verificado en las 7 tablas de session_summary, weight_by_category, ambas alertas). Espejo de
  rodeo_serviced_females (0105:117-122).
- deleted_at/status en el join, no en el helper (M3): p.deleted_at IS NULL siempre; p.status=active en KPIs +
  alertas; historico de sesion (session_summary, sessions_list) exento de status (R7.13.2) pero con deleted_at.
  No usa establishment_of_profile (que no filtra deleted_at).
- No re-deriva el denominador: pregnancy_kpi/calving_kpi invocan rodeo_service_campaign / rodeo_serviced_females /
  rodeo_repro_denominator.
- Sin shadowing de OUT params: captura en RECORDs (v_cfg/v_denom) y asigna a OUT explicitamente.
- Sin SQL dinamico: params tipados de PostgREST; any(p_category_codes) no es concatenacion. Sin ilike ni .or().
- revoke/grant + smoke-check fail-closed en las 9 (raise si alguna queda EXECUTE-able por anon/public). Espejo 0105.
- PII: outputs = idv/visual_id_alt/product_name (ya visibles por RLS del tenant); ninguna tabla _private.

Correctitud de KPIs (trazas independientes ejecutadas por el reviewer):
- v_start del run + bucketing mes->tercio de calving_by_stage = espejo EXACTO de serviceRunBounds /
  stageForPosition de calving-stage.ts (probado 10,11,12 / 11,12,1 / 12,1,2 / 1..6 / 3,4,5,6 / 6,7 / 10,11 — MATCH).
- calved year-anchoring = espejo de como 0105 define servidas (set-membership, no BETWEEN); c2 (Ene-wrap) en el
  MISMO año calendario p_year.
- 0-denominador: la RPC devuelve serviced/total/total_born = 0 sin dividir -> NaN/Inf imposible server-side.
- preñez/paricion sobre servidas (base unica, sin toggle); absolutos num/den expuestos.

Schema as-built verificado (columnas/tipos reales): 7 tablas con session_id (5 de 0025-0029 via 0052 +
custom_measurements 0094 + scrotal_measurements 0098); sanitary_events (product_name NOT NULL, next_dose_date,
event_date, created_at); reproductive_events (pregnancy_status_enum, repro_event_type con tacto/birth/abortion);
animal_profiles (idv, visual_id_alt, category_id NOT NULL, status con active/sold); weight_events (weight_kg,
weight_date); categories_by_system (code/name/sort_order); has_role_in fail-closed.

## 6. CHECKPOINTS

- C3 arquitectura: [x] calving-stage.ts es helper PURO en utils/ (sin RN/red/supabase-js); RPC en migrations/;
  suite en tests/ (runner Node-nativo, no pgTAP, ADR-012). Sin hardcode de establishment_id. Sin TODOs/logs sueltos.
- C4 verificacion real: [x] >=1 test por unidad con logica (15 unit del helper + TR.1-TR.10 con fixtures reales,
  no mocks de I/O). check.mjs >0 tests, verde. Aislamiento cross-tenant (TR.10 + IDOR TR.1-9). reports/run.cjs
  roja-hasta-apply por diseño — cobertura confirmada al aplicar (esperado, patron puesta-en-servicio).
- C6 SDD: [x] 3 archivos de spec; EARS estricto; cada R backend con >=1 test.
- C7 multi-tenant: [x] no se crean tablas nuevas (solo funciones de lectura); tenant por guard has_role_in
  (canonico, no inline) en cada RPC; test cross-tenant presente. Ver 7.A.
- C8 offline-first: [ ] N/A — reportes online-only por diseño (R7.2, context seccion 7): no sincronizan, sin
  bucket PowerSync nuevo (design seccion 4). Justificado.
- C1/C2/C5 — fuera del alcance de un delta de backend (harness / cierre de sesion = leader).

## 7. Checklist RAFAQ-especifico

### A. Tablas con establishment_id (multi-tenancy/RLS) — APLICA (parcial)
No hay TABLAS nuevas; son 9 funciones SECURITY DEFINER de lectura. Los items de tabla nueva se leen como RPC
tenant-scoped.
- [x] enable RLS en tabla nueva — N/A (no hay tabla nueva).
- [x] policies CRUD por ADR-004 — N/A; las RPC son read-only con guard interno (SECURITY DEFINER, la RLS no las
  protege, el guard has_role_in 1ra-sentencia es la defensa).
- [x] helpers has_role_in() (no SQL inline) — las 9 usan public.has_role_in; los KPI reproductivos delegan en las
  RPC de Stream A (no re-derivan elegibilidad).
- [x] test de aislamiento cross-tenant — TR.10 (A vs B) + IDOR TR.1-9 (owner B -> 42501, no vacio).
- [x] deleted_at IS NULL en los joins de lectura — si, en todas las RPC que tocan animal_profiles/eventos (M3);
  + status=active salvo historico de sesion (R7.13.2, justificado).

### B. Carga/edicion en campo (offline-first) — N/A
Reportes online-only por diseño (R7.2, design seccion 4): no cargan datos en campo, no sincronizan, sin bucket.

### C. BLE — N/A.

### D. UI de campo — N/A en este review (el backend no toca UI; veto design-review + targets/fuentes = frontend, T8.3).

### E. Edge Functions — N/A estricto + nota
No hay Edge Function: la decision (design seccion 3) es RPC SECURITY DEFINER por sobre Edge (alternativa
descartada justificada). Los criterios analogos igual se cumplen: validacion de identidad/permiso (has_role_in
1ra sentencia = auth.uid()+permiso), errores con codigo apropiado (42501 authz, 22023 input, P0002 not-found),
test con runner Node-nativo (reports/run.cjs, roja-hasta-apply).

## 8. Cambios requeridos

Ninguno. El SQL estatico, la suite no-bypass y el helper puro cumplen la spec lockeada (commit 6a3b532), los 4
MEDIUM de Gate 1 (M1-M4) y las 5 decisiones de Raf de la Puerta de spec. check.mjs verde; reports/run.cjs
roja-hasta-apply es el estado esperado por diseño (lo confirma el leader al aplicar 0106).

## 9. Pendiente (leader, fuera de este review)
1. Aplicar 0106_reports_rpcs.sql al remoto (CLI/Management-API) con OK de Raf (depende de 0105 / Stream B).
2. Descomentar el hook de Reports suite en scripts/run-tests.mjs:81 -> correr la suite -> verde post-apply.
3. Gate 2 (security_analyzer modo code) sobre el diff -> Puerta 2 (humana).
4. Flipear feature_list.json feature 7 a su estado correspondiente.
