# review — delta `campanas-congeladas` (feature 07-reportes-basicos)

- **Fecha**: 2026-08-07
- **Revisor**: `reviewer` (read-only: no se editó código, tests, migraciones ni specs)
- **Input**: `specs/active/07-reportes-basicos/{requirements,design,tasks}-campanas-congeladas.md` (148 `RCC.<n>`,
  87 tareas) · `progress/security_spec_07-campanas-congeladas.md` (Gate 1 PASS) ·
  `progress/impl_campanas-congeladas.md` · `progress/repro_reportes-campanas-congeladas.md` ·
  `docs/adr/ADR-032` · `CHECKPOINTS.md` · `docs/architecture.md` · `docs/conventions.md` · `docs/verification.md`
- **Baseline del diff**: `19dd826e` (declarado por el implementer)

---

## Veredicto

**CHANGES_REQUESTED**

Dos cosas distintas, y conviene no mezclarlas:

1. **El trabajo del implementer es sólido y verifiqué lo verificable.** Los tres defectos que la implementación
   encontró en la spec (R1 lista blanca, R3 `oidvectortypes`, R6 `entry_date`) son reales y los **re-medí contra
   el remoto**: la corrección de R3 devuelve 8 hoy / 9 post-apply, y el barrido de la lista blanca corregida
   devuelve **0 filas** (o sea: las migraciones ya no abortan). El orden `guard → cota → cortocircuito` está bien
   en **las siete** (lo verifiqué posicionalmente por mi cuenta, no confié en el análisis del implementer). Los
   8 mutantes que escribí contra `campaignStateView` mueren todos.

2. **Hay hallazgos que sí bloquean**, y uno de ellos es exactamente la clase que se pidió cazar: **un oráculo
   que asserta lo contrario de lo que su nombre dice, y que codifica un defecto de UI en vez de prevenirlo**
   (H-1). Sumado a eso, la red de regresión de la **otra** suite que consume las funciones reescritas quedó sin
   auditar y se vuelve dependiente del calendario post-apply (H-2), y una rama de elegibilidad reescrita
   (`ai_females`) no tiene oráculo en la suite del delta (H-3).

No rechazo por el rojo estructural de `check.mjs` (es el patrón declarado del repo), pero sí lo dejo asentado
como condición de cierre: **18 de los 35 tests de la suite del delta nunca corrieron en verde**, así que la
verificación de esta unidad está pendiente por construcción y la Puerta 2 no puede cerrarse con este veredicto.

---

## 1. Qué corrí y qué medí (no "lo leí")

| # | Qué | Resultado MEDIDO |
|---|---|---|
| V1 | `node --test supabase/tests/reports/run.cjs` | **17 pass / 18 fail** de 35 — **confirma** lo que declara el implementer. Revisé los 18 uno por uno: 16 son `PGRST202 close_campaign no existe` / `PGRST205 rodeo_membership_history no existe` / asserts de catálogo sobre objetos ausentes; **TR.12c y TR.13 fallan porque el defecto está vivo** (el diff muestra `serviced: 4 → 0` tras venta+transferencia+`no_apta`, que es literalmente el probe). **Ningún rojo es una regresión disfrazada.** |
| V2 | `node scripts/check.mjs` | **exit 1**. Unit **3021/3021 verde** (incluye los 12 casos nuevos de `campaignStateView`), typecheck verde, anti-hardcode verde, RLS 22/22 verde. Aborta en la suite **Edge** con `Request rate limit reached` (flake documentado de 2 terminales, `reference_check_red_rate_limit`), **antes** de llegar a la suite de reportes. |
| V3 | Query de descubrimiento de **TR.21** contra el remoto (Management API, read-only) | **8 funciones** hoy (`rodeo_{calving_by_stage,calving_kpi,ccl_distribution,pregnancy_kpi,repro_denominator,service_campaign,serviced_females,weaning_kpi}`), **9 post-apply** con `rodeo_campaign_status`. El piso `>= 9` es correcto y hoy es rojo legítimo. **La corrección R3 funciona.** |
| V4 | Predicado del **loop (1)** del smoke-check (`rodeo\_%`/`campaign\_%`/`close\_%`/`reopen\_%` + `animal_category_at`, menos la lista blanca de 14) contra el remoto | **0 filas** → la lista blanca corregida es completa y `0128`/`0129`/`0130` no van a abortar por R1. También confirma que `has_function_privilege('public', …)` **no tira error** en este Postgres (el smoke-check depende de eso). |
| V5 | Orden `guard → cota → cortocircuito`, **posicional sobre el `.sql`**, en las 13 funciones de `0129`+`0130` | **13/13 OK** (offsets: p.ej. `rodeo_serviced_females` 636 < 924 < 1281; `rodeo_weaning_kpi` 618 < 901 < 946; `close_campaign` 1051 < 1386 < 2498). Las 3 internas tienen guard+cota y **no** cortocircuitan (correcto por diseño). El análisis **sí** distingue el bug del arreglo para esta propiedad (es orden de sentencias en un cuerpo lineal), pero **no** sustituye a TR.21, que es conductual y corre post-apply. |
| V6 | Mutante por sustitución del guard de clase de **TR.17** contra el remoto | `pg_get_functiondef ilike '%session_id%'` da **true** en `rodeo_sessions_list` y `session_event_summary`, **false** en las 7 de campaña. El guard **ve** el síntoma → no es vacuo. |
| V7 | Mutantes contra **TR.19** (ausencia en `rafaq.yaml`) | Caza el mutante en MAYÚSCULAS y el calificado por schema (`public.rodeo_campaign_snapshot_animals`). No vacuo. |
| V8 | **8 mutantes** escritos y ejecutados contra `campaignStateView` (sobre una copia aislada, el repo no se tocó) | **8/8 muertos.** `primaryAction` sin `canClose` → 2 rojos · aviso "a medias" gateado por `canReopen` → 1 · fecha ISO cruda en vez de es-AR → 3 · un solo aviso → 1 · plural siempre → 1 · sugerencia sin `canClose` → 1 · `missing` ignora preñadas → 1 · detail vacío → 1. Baseline y restauración: 66/66. |
| V9 | Riesgo de apply de `0127`: nulls en la fuente del backfill | `animal_profiles.rodeo_id` es **NOT NULL** con **0** nulls en 6362 filas → el backfill no puede abortar con `23502`. `entry_date` NULL en 5731/6362, pero dominado por `Campo Perf 5k (TEST)` (5000) y fixtures de suites; **"La Facundina" tiene solo 3/353 sin `entry_date` y membresía desde 2012-10-03** → T74 arranca en buenas condiciones. |
| V10 | Dependencias de las 4 migraciones contra el catálogo remoto | Existen y son alcanzables: `establishment_of_profile` (EXECUTE a authenticated ✓, necesario para la policy de `0127`), `has_role_in`, `is_owner_of`, `animal_category_history.{to_category_id,changed_at}`, `birth_calves.{birth_event_id,calf_profile_id}`, `user_roles.member_name`, `reproductive_events.{heifer_fitness,service_type,pregnancy_status}`. `is_owner_or_vet_of` no existe (esperado). |
| V11 | `reference_function_recreate_base`: cuerpo **vigente del remoto** de `rodeo_calving_kpi` y `rodeo_weaning_kpi` vs. la reescritura | El remoto **es** el de `0117` y `0118` (no `0106`) → el molde citado es correcto. Comparé fórmula por fórmula: `pregnant`, `calved`, `pending_pregnant` y el `status` de `calving` son **equivalentes**; el `status` de `weaning` es idéntico. La **única** diferencia de conjunto es la declarada en `design` §15 R7 (`weaned`/`pending_weaning` pasan a un parto por madre). |
| V12 | ¿Quién más consume las 7 funciones? | Solo `supabase/tests/puesta-en-servicio/run.cjs` además de `reports`. → ver **H-2**. |
| V13 | ¿Qué tests importan `services/reports.ts` o la pantalla de reportes? | **Ninguno** (unit ni e2e). El `assertOnline` de `callRpcScalar` y el cableado `cclMonths` no tienen oráculo posible hoy — no hace falta escribir el mutante: no hay nada que se pueda poner rojo. |

---

## 2. Hallazgos

### 🟠 H-1 — El oráculo de `campaignStateView(null)` asserta lo contrario de su propio nombre, y con eso congela un defecto de UI

**Dónde**: `app/src/utils/reports-format.ts:631-638` · `app/src/utils/reports-format.test.ts:646-653` ·
`app/app/(tabs)/reportes.tsx:260-266` · `app/src/hooks/use-reports.ts:107-113`.

El test se llama **"campaignStateView: status null → no afirma nada ni ofrece acciones"** y lo que asserta es
`assert.equal(v.badge, 'en-curso')` + `assert.equal(v.title, 'Campaña en curso')`. O sea: **afirma**. Y la
función hace exactamente eso — su comentario dice *"Defensivo: sin estado no afirmamos nada sobre la campaña"*
mientras devuelve `badge: 'en-curso', title: 'Campaña en curso'`.

Por qué importa, y no es una prolijidad de copy: la barra se monta **incondicionalmente** en `reportes.tsx`
(entre el `YearStepper` y los números, que es exactamente donde tiene que estar), y `useReport`
(`use-reports.ts:90-113`) **no blanquea `data` al cambiar el fetcher** (anti-parpadeo: correcto para números,
**equivocado para la etiqueta que los califica**). Consecuencias, leídas del código:

- **Primera carga**: mientras `rodeo_campaign_status` está en vuelo, la pantalla afirma "Campaña en curso" y el
  hint de la sección dice "Campaña 2025 · en curso · base servidas" para una campaña que puede estar
  **cerrada**. Es la afirmación exacta que ADR-032 existe para impedir.
- **Cambio de año o de rodeo**: `data` conserva el estado **anterior** → una campaña 2025 abierta se muestra
  como "Campaña cerrada · Foto del 14/03/2026 · la cerró Facundo" hasta que vuelve la RPC. En una conexión de
  campo eso son segundos, no un frame.

Nada lo cubre: el capture usa el spike con un `status` fijo (`reportes-spike.tsx:88-121`), así que el estado
"todavía no sé" no se renderiza nunca.

**Qué pido**: (a) un tercer estado explícito en `CampaignStateView` (p. ej. `badge: 'desconocido'` con `title`
neutro y `primaryAction: null`) o gatear el montaje de la barra hasta tener `status.data`; (b) que la etiqueta
**no** sobreviva a un cambio de `(rodeoId, year)` — el `data` retenido pertenece a otra campaña; (c)
renombrar/reescribir el test para que su aserción coincida con su nombre; (d) una captura del estado "cargando".
Se reconcilia en `design` §7.2 y en RCC.10.1/10.2/10.3.

### 🟠 H-2 — La corrección R6 (`entry_date` en los fixtures) se aplicó a **una sola** de las dos suites que ejercitan las funciones reescritas

**Dónde**: `supabase/tests/puesta-en-servicio/run.cjs:148-173` (su `createAnimal` **no** escribe `entry_date`)
· TPS.9 (`:518-544`) · TPS.15 (`:566-660`).

Medido (V12): además de `reports`, **`puesta-en-servicio/run.cjs` llama `rodeo_serviced_females` y
`rodeo_repro_denominator`** (13 call sites: líneas 540/609/625/634/639/660/671/676/681/688/693/701/702). Sus
perfiles nacen sin `entry_date` → post-`0127` la membresía abre **hoy**, y la pertenencia se evalúa contra la
fecha de corte `window_end(thisYear())`. Con `service_months = [11]` el corte es el **30/11 del año en curso**:

- Hoy (07/08/2026) el corte está en el **futuro** → `from_date (hoy) <= corte` → los fixtures son miembros y la
  suite pasa. **No es un rojo inmediato.**
- Desde el **1/12** de cada año el corte queda en el pasado → `from_date (hoy) > corte` → **ningún** fixture es
  miembro y TPS.9 + TPS.15 se caen enteras (`ids.has(vaca…)`, `…vqPren…`, `…vqApta…`, `…vqEdad…`, `…iaIn…`).
  `check.mjs` corre esa suite: es un rojo repo-wide con fecha de vencimiento.

Y hay un efecto más sutil, que es el que interesa. TPS.15:645 asserta
`after.serviced === before.serviced - 1` con el mensaje *"una baja de rama natural sale del set serviced
(membresía active)"* y el comentario *"la vacaBaja sale del set serviced al no estar 'active'"*. Post-delta esa
aserción **sigue verde pero por otro motivo**: `p.status = 'active'` ya no existe (es la fuga F2 que el delta
tapa); lo que la saca es que el trigger cierra la membresía con `to_date = hoy`, anterior al corte de
noviembre. El comentario y el mensaje quedan **falsos**, y el test pasa por la razón equivocada — que es justo
el patrón que R6 identificó y corrigió en la otra suite.

**Qué pido**: auditar `puesta-en-servicio/run.cjs` con el mismo criterio de R6 (escribir `entry_date` en su
`createAnimal`, o fijar `service_months` a un mes ya pasado y sembrar la entrada antes del corte), y reescribir
el comentario/mensaje de TPS.15:645. Ampliar `design` §15 R6, que hoy habla solo de `tests/reports/run.cjs`.

### 🟠 H-3 — La rama `ai_females` se reescribió y no tiene oráculo en la suite del delta

**Dónde**: `supabase/migrations/0129_reports_historical_compute.sql:253-266` · trazabilidad del implementer
(*"RCC.2.10 → (cubierto por el join member común)"*).

La rama de IA cambió: se le agrega `join member`, se elimina `p.status`, y conserva su filtro de `event_date`.
No es "lo mismo con otro join": es la mitad del conjunto de elegibilidad, y `docs/verification.md` pone
*"Cálculos de KPIs y analítica"* en la lista de **testing obligatorio no negociable**. Medido: en toda
`supabase/tests/reports/run.cjs` la cadena `'ai'` aparece **una sola vez**, y es la aserción inversa
(`TR.20:2153`: `servicedRows.every(x => x.source === 'natural')`). Ninguna hembra entra por IA en ningún
escenario del delta.

Existe cobertura preexistente en `puesta-en-servicio` (TPS.9 y TPS.15 asertan `source === 'ai'`), lo cual
mitiga — pero esa suite es la de H-2, y ninguno de sus casos ejercita el predicado **histórico** (entrada
después del corte, salida antes del corte) sobre la rama IA.

**Qué pido**: un caso en TR.13 con una hembra cuyo único camino al conjunto es un `service`/`ai` dentro de la
campaña, con los dos contrafactuales de membresía, y su fila `source = 'ai'` en el bucket `serviced` de TR.20.

### 🟡 H-4 — Cabecera y detalle del snapshot salen de **snapshots de transacción distintos**; `design` §2.4 afirma lo contrario

**Dónde**: `supabase/migrations/0130_campaign_close_rpcs.sql:89-128` · `design` §2.4 · RCC.4.7.

`close_campaign` es `VOLATILE`. En `READ COMMITTED`, **cada sentencia** que ejecuta una función `VOLATILE` toma
un snapshot nuevo. El detalle sale de las 4 temporales (materializadas en las sentencias de las líneas 89-119) y
la cabecera de una **segunda** invocación de las 5 RPC de KPI (líneas 123-128). Si un `reproductive_events`
concurrente commitea entre medio, `count(*)` por bucket ≠ el número congelado — el invariante que RCC.4.7
declara **estructural** y que `design` §2.4 justifica con *"el detalle ES la evidencia del número y sale del
MISMO select que lo calculó, sin un paso de transformación en el medio que pueda mentir"*. Como está
construido, **no es el mismo select**. TR.20 no lo puede ver (fixture quieto).

Ventana chica y consecuencia acotada (una fila de diferencia), pero es una **spec que miente sobre el
as-built**, que es rechazo por el paso 6 del protocolo. Salidas: computar la cabecera desde las temporales
(choca con DL2/RCC.5.4, que exige invocar las mismas RPC que la lectura en vivo) o **declarar la ventana** en
`design` §2.4 + RCC.4.7. Cualquiera sirve; lo que no sirve es dejar la §2.4 como está.

### 🟡 H-5 — El loop (2) del smoke-check no puede fallar, y el hueco que queda es el único que el barrido no cubre

**Dónde**: `0128:310-376`, `0129:619-671`, `0130:423-478` (los tres son la misma forma).

El loop (0) hace el `revoke ... from public, anon` sobre **la misma** enumeración que después verifica el loop
(2), en el mismo bloque `DO` y unas líneas antes. El loop (2) es por lo tanto **tautológico**: no existe un
estado alcanzable en el que falle. No es un problema en sí (la propiedad la garantiza el loop (0), que es más
fuerte que verificarla), pero RCC.9.6.a se escribió para que *"una función nueva a la que se le olvide el
revoke"* aborte, y conviene que el requisito y el mecanismo digan lo mismo.

El hueco real: una entrada de la lista blanca **con un typo** cuyo nombre **no matchee ninguno de los 4
prefijos** queda fuera de los **dos** loops → nace `EXECUTE`-able por `PUBLIC` sin que nada se ponga rojo. Hoy
hay exactamente una función así: **`is_owner_or_vet_of`** (no matchea `rodeo\_%` / `campaign\_%` / `close\_%` /
`reopen\_%`). Verifiqué (V4) que hoy la lista está bien escrita, pero el mecanismo no protege ese caso.

**Qué pido**: un tercer assert fail-closed en `0130` (donde ya existen las 14) que exija que **cada** nombre de
`v_public` resuelva a ≥1 fila de `pg_proc`. Media docena de líneas y cierra la clase entera.

### 🟡 H-6 — Requisitos sin oráculo (los enumero para que la decisión sea explícita, no por omisión)

| Requisito | Qué dice el implementer | Qué medí |
|---|---|---|
| **RCC.5.11 / DL9** (online-only) | *"patrón del módulo, ya testeado"* | **Inexacto.** `online-guard.test.ts` prueba el predicado puro; **ningún test importa `services/reports.ts`** (V13), así que nada asserta que `closeCampaign`/`reopenCampaign` pasen por `assertOnline`. Sacar `reports.ts:212` no pone nada en rojo. (La mitad de "no ofrecer" queda cubierta de rebote: sin status, `campaignStateView(null)` no ofrece acciones — pero ver H-1: `data` se retiene.) |
| **RCC.10.4** (CCL con `service_months` congelados) | *"— (lectura; el dato lo prueba TR.20)"* | El cableado es `reportes.tsx:230` (`cclMonths`). TR.20 prueba que el **server** congela; nada prueba que la **pantalla** los use. El capture no lo puede ver: `CampanaVariant` (`reportes-spike.tsx:697-725`) renderiza la barra + un `KpiRow`, **no** el bloque CCL. |
| **RCC.9.12** (`member_name`, no la tabla `users`) | *"(lectura del reviewer)"* | Lo verifiqué: `0130` no referencia `public.users` en ningún cuerpo. Sin guard automatizado. |
| **RCC.4.6 / RCC.7.2** (el detalle sobrevive a la baja; la cerrada devuelve filas con `animal_profile_id` nulo) | TR.20 | TR.20 asserta que el `idv` está congelado, pero **ningún test borra un `animal_profiles`** ni ejercita la fila con `animal_profile_id` NULL. |
| **RCC.9.8** (carrera de dos cierres concurrentes) | *"TR.14 (cerrar dos veces → 1 fila)"* | Eso es **idempotencia secuencial**, no una carrera. El `on conflict` + `unique_violation` + re-`select` está bien escrito, pero su oráculo no lo ejercita. |
| **RCC.11.10** (dos cierres en la **misma transacción**) | crear-o-truncar de las temporales | Sin test. TR.14 cierra `CC_YEAR` y `CC_YEAR+1` en **dos** transacciones. El requisito existe porque el runbook del re-seed (§9) lo necesita: si falla, falla en T74. |
| **RCC.1.13** + rama `transfer_in` del trigger | *"ausencia de código"* | Sin guard. La GUC `rafaq.is_transfer` (`0127:124-126`) y el ciclo archivar-origen/crear-destino de `transfer_animal` no se ejercitan en ningún test. |

Ninguno de estos, solo, justifica el rechazo. **Juntos** dejan siete `RCC.<n>` apoyados en lectura, y el
protocolo del repo es explícito (`docs/verification.md` §N4). Pido cerrar al menos **RCC.5.11**, **RCC.10.4** y
**RCC.4.6/7.2** (los tres son baratos) y **declarar** los otros cuatro como límite en `design` §13, con el
motivo, en vez de dejarlos como cobertura implícita en la tabla de trazabilidad.

### 🟡 H-7 — El fixture de `closedAt` no tiene la forma del contrato

`reports-format.test.ts:534` usa `closedAt: '2026-03-14'` (date-only), pero `rodeo_campaign_status.closed_at`
es **`timestamptz`** (`0130:306`). `formatDateEsAr` maneja los dos casos (verificado en
`format-date-es-ar.ts:40-56`), así que no hay bug — pero el test no ejercita la forma real, y el mutante
"formatear el instante con getters UTC en vez de locales" (el drift −1 día que la convención es-AR existe para
evitar) **no se puede matar** con este fixture. Un caso con `'2026-03-15T01:30:00Z'` lo cierra.

### ⚪ H-8 — Menores

- **T57** está en `[x]` (*"correr la suite dos veces seguidas y confirmar que no quedan huérfanos"*), pero la
  verificación de cascada (`run.cjs:2237-2248`) es uno de los 18 rojos: no se pudo confirmar. Buena noticia: leí
  el bloque y `await cleanup()` corre **antes** del assert, así que el rojo **no** deja huérfanos en DEV (lo
  confirmé en la corrida V1).
- **`v_serviced` en `rodeo_campaign_status`** sale de `v_wean.serviced` en la rama abierta (`0130:387`), o sea de
  `rodeo_weaning_kpi`, que a su vez lo saca del denominador. Correcto, pero es el tercer camino distinto para el
  mismo número dentro de la misma función; vale un comentario.
- **RCC.11.\*** (re-seed de La Facundina) no está implementado: es **T74 del leader**, declarado. No es deuda
  del implementer, pero la sección entera queda sin cobertura hasta que corra.

---

## 3. Trazabilidad `RCC.<n>` ↔ test

Leyenda: **✅** oráculo concreto identificado y verde hoy · **🟡** oráculo débil / indirecto · **❌** sin
oráculo · **⏳** oráculo escrito pero **nunca ejecutado en verde** (roja-hasta-apply).

| Requisito | Artefacto | Oráculo | Estado |
|---|---|---|---|
| RCC.1.1–1.3 | `0127` (1)(2) | TR.15 (1)(2)(5) | ⏳ |
| RCC.1.4–1.7 | `0127` (4), 5 ramas | TR.15 (1)(2)(3)(4) | ⏳ (rama `reactivation` sin caso) |
| RCC.1.8 | `0127` (5) | TR.15 (6) | ⏳ |
| RCC.1.9 | `comment on table rodeo_membership_history` | — documental, verificado por lectura | ✅ |
| RCC.1.10 / RCC.4.9 | ausencia en `rafaq.yaml` | **TR.19**, mutado por mí (V7): caza mayúsculas y schema-qualified | ✅ verde hoy |
| RCC.1.11 | `0127` (3) | TR.15 (7) + TR.14e | ⏳ |
| RCC.1.12 | `0127` (4) `new.establishment_id` | TR.15 (1) | ⏳ |
| RCC.1.13 | ausencia de código en `0087` | — | ❌ H-6 |
| RCC.2.1–2.2 | `0129` (2) paso (3) | TR.13 (a)(b) + TR.20 (`state_as_of` congelado) | ⏳ |
| RCC.2.3–2.5 | `0129` (2) CTE `member` | TR.13 (a)(b)(c) | ⏳ (hoy rojo = el defecto vivo) |
| RCC.2.6–2.8 | `animal_category_at` + `rv.event_date <= v_state_as_of` | TR.13 (d) + TR.12c | ⏳ (hoy rojo = el defecto vivo) |
| RCC.2.9 | `v_state_as_of - a.birth_date` | TR.13 (e) + su control de no-vacuidad (`ageToday >= 365`) | ⏳ |
| RCC.2.10 | `0129` (2) `ai_females` | — en la suite del delta | ❌ **H-3** |
| RCC.2.11 | `0129` (2) | TR.17 + revisión | 🟡 |
| RCC.2.12 | `0129` (3) `retired := 0` | **TR.18 dentro de `kpiBundle`** (vale en todos los escenarios) | ⏳ · buen diseño |
| RCC.3.1–3.5 | `campaign_tacto_bounds` + `rodeo_campaign_tacto` | TR.12 (mutación 1) + TR.12b | ⏳ |
| RCC.3.6–3.7 | `rodeo_campaign_births` / `_calves` | TR.12 (T0 `calved`/`pending_weaning`) | ⏳ |
| RCC.3.8 | `0129` (5)(7)(8) | TR.4/TR.4b/TR.6/TR.11 **verdes hoy** + V11 (comparación con el cuerpo vigente del remoto) | ✅ |
| RCC.4.1–4.3 | `0128` (3) + `0130` paso 8 | TR.20 (`service_months`, `state_as_of`, `tacto_from/to`) | ⏳ |
| RCC.4.4–4.5 | `0128` (4) enum multi-fila | TR.20 | ⏳ |
| RCC.4.6 | `on delete set null` + `idv` | TR.20 (solo el `idv`) | ❌ parcial (H-6) |
| RCC.4.7 | 5 `insert … select` desde las temporales | TR.20 (conteo por bucket == cabecera) | ⏳ · **H-4** (no es estructural) |
| RCC.4.8 / 4.8.a | `0128` (5) + `0130` pasos 8/9 | **TR.14e** (payloads completos + regex acotado) | ⏳ |
| RCC.4.8.b | FK compuesta + `not null` en las 2 columnas | **TR.14h** (`23503` + `information_schema.is_nullable`) · verificado por lectura en `0128:231-238`: ambas `not null` | ⏳ · ✅ estructural |
| RCC.4.10 | índice único parcial | TR.14 (idempotencia) + TR.16 | ⏳ |
| RCC.4.11 | `closed_incomplete` / `missing_at_close` | TR.14d (b)(c) | ⏳ |
| RCC.5.1–5.3 | `0130` (1) + `0128` (1) | TR.14 + **TR.14f** (rol caducado, con control de no-vacuidad) | ⏳ |
| RCC.5.4–5.5 | `0130` (1) paso 7 | TR.20 | ⏳ · ver H-4 |
| RCC.5.6 | `0130` (1) paso 6 | TR.14 (mismo id, 1 sola fila) | ⏳ |
| RCC.5.7 / 5.7.e | G1 y G2 | **TR.14d (f)** y **TR.14d (G2)**, ambos con `ack = true` → sigue fallando | ⏳ · buen diseño |
| RCC.5.7.a–d | G3 | TR.14d (a)(b)(c)(e) + assert de que **no se escribió ninguna fila** | ⏳ |
| RCC.5.8 | cotas | TR.14 | ⏳ |
| RCC.5.9 | ausencia de escrituras | **TR.14c** (conteo de perfiles/eventos/pesos antes y después) | ⏳ |
| RCC.5.10 / 5.10.a | `use-reports.ts::closeAllAction` (2 pasadas) | capture 08 + lectura | 🟡 (los hooks no tienen unit — límite declarado) |
| RCC.5.11 | `assertOnline` en `callRpcScalar` | — | ❌ **H-6** |
| RCC.6.1–6.5 | `0130` (2) | TR.14 + **TR.16** (4) | ⏳ |
| RCC.7.1–7.2 | cortocircuito en las 7 | **TR.12** + TR.20 | ⏳ (la mitad de `animal_profile_id` nulo: ❌) |
| RCC.7.3 | `has_role_in` en las 7 + status | TR.14 (`field_operator` lee KPI y status) | ⏳ |
| RCC.7.4–7.5 | `CREATE OR REPLACE` | TR.1–TR.11 **verdes hoy** + guard de contrato `0129` (9) | ✅ |
| RCC.7.6 / 7.6.a / 7.7 | `0130` (3) | TR.14d (`can_close = false` en G1 y G2) + `test('canClose=false …')`, mutado por mí: mata | ✅ frontend / ⏳ backend |
| RCC.8.1–8.4 | ausencia de trigger + `has_new_data` | **TR.16** + capture 07 | ⏳ |
| RCC.9.1–9.4 | `0129`/`0130` | TR.14 + **TR.21** + guard de contrato `0129` (9) + **V5** (orden posicional 13/13) | ⏳ · reforzado por V5 |
| RCC.9.5–9.6.a | los 2 loops en `0128`/`0129`/`0130` | **TR.14b** (catálogo: `auth/anon/pub = false` en las 7 internas) + TR.10 extendido + **V4** | ⏳ · **H-5** |
| RCC.9.7 | `0127` (4) | TR.14g (por catálogo) | ⏳ |
| RCC.9.8 | `on conflict` + `unique_violation` | TR.14 (idempotencia ≠ carrera) | ❌ parcial (H-6) |
| RCC.9.9 | RLS de las 2 tablas | TR.14e + **TR.21** | ⏳ |
| RCC.9.10–9.11 | G2 + §5.B W8 | TR.14d (G2) | ⏳ |
| RCC.9.12 | `0130` (3) `user_roles.member_name` | — (verificado por lectura: `0130` no referencia `public.users`) | ❌ H-6 |
| RCC.10.1–10.3 | `campaignStateView` + `CampaignStateBar` | 12 tests unit · **8 mutantes míos, 8 muertos** · captures 01/05/06 | ✅ · **H-1** en el borde `null`/stale |
| RCC.10.4 | `reportes.tsx:230` `cclMonths` | — | ❌ **H-6** |
| RCC.10.5 | `campaignStateView` | `test('en curso con el ciclo completo')` (mutante M7 lo mata) + capture 02 | ✅ |
| RCC.10.6 | `CampaignCloseSheet` + `closeAllAction` | capture 08 | 🟡 |
| RCC.10.7 / .a / .b | `CampaignCloseSheet` | captures 03 y 04 (asertan **ausencia** de `campaign-confirm-missing`/`-ack` con ciclo completo) | ✅ |
| RCC.10.8 / 10.11 | `campaignStateView` | `test('SIN permiso pero cerrada a medias')` (mutante M2 lo mata) + capture 09 | ✅ |
| RCC.10.9 | los 2 componentes | `assertTextNotClipped` × 8 + verifiqué `lineHeight` matcheado en los 12 `<Text>` con `fontSize` | ✅ |
| RCC.10.10 | montaje aditivo | typecheck + capture | 🟡 |
| RCC.11.1–11.10 | — | — | ❌ **T74 del leader, no ejecutado** |
| RCC.12.1–12.2 | ausencia de `session_id` | **TR.17** — **verde hoy** y mutado por sustitución (V6) | ✅ |
| RCC.12.3–12.4 | no se tocaron | TR.7/TR.8/TR.9 verdes + `git diff` de `0105`/`0087` vacío | ✅ |
| RCC.12.5–12.6 | `safePercent` + membresía | TR.3 verde + TR.13 (f) | ⏳ |
| RCC.13.1–13.13 | los `TR.*` | ídem cada fila | ⏳ salvo TR.17/TR.19 |
| RCC.14.1–14.2 | `campanas-congeladas.capture.ts` | 9 capturas + 8 `assertTextNotClipped` | ✅ (T68, el veto, es del leader) |

**Resumen**: 148 requisitos. **7 sin ningún oráculo** (RCC.1.13, RCC.2.10, RCC.4.6 parcial, RCC.5.11, RCC.9.8
parcial, RCC.9.12, RCC.10.4) + **RCC.11.\*** delegado al leader. El resto tiene oráculo escrito, pero la gran
mayoría en estado ⏳: **nunca corrió en verde**.

---

## 4. Tasks completas: **sí, con salvedad**

**No** hay tareas `[ ]` sin justificación. 81/87 en `[x]`; las 6 abiertas son **todas del leader** y están
rotuladas como tal en el propio `tasks.md`:

| Tarea | Dueño | Estado |
|---|---|---|
| T68 — correr el capture + veto visual | leader | `[ ]` — Gate 2.5 |
| T72 — Gate 1 | leader | `[ ]` (ya está **PASS** en `progress/security_spec_07-campanas-congeladas.md`; solo falta tildarla) |
| T73 — apply `0127`→`0130` | leader | `[ ]` — gateado por el OK de deploy de Raf |
| T74 — re-seed de La Facundina | leader | `[ ]` — cubre RCC.11.\* |
| T75 — fold al baseline (ADR-028) | leader | `[ ]` |
| T76 — nota de `entoradas` en `docs/backlog.md` | leader | `[ ]` (ya hay una entrada del tema del 2026-08-07, de la fase de repro; falta actualizarla con el as-built `retired := 0`) |

Salvedad: **T57** está en `[x]` pero su verificación no se pudo ejecutar — ver H-8.

---

## 5. CHECKPOINTS

| # | Checkpoint | Estado |
|---|---|---|
| **C1** | Archivos base + docs + 5 agentes | `[x]` |
| C1 | `node scripts/check.mjs` exit 0 | **`[ ]`** — exit 1. Causas: (a) suite Edge con `Request rate limit reached` (flake de 2 terminales, `reference_check_red_rate_limit`, ajeno al delta); (b) la suite de reportes es **roja-hasta-apply** por diseño declarado. Unit (3021/3021), typecheck, lint, anti-hardcode y RLS **verdes**. |
| **C2** | Como mucho una feature `in_progress` | `[x]` — **cero**; el delta es Nivel B (ADR-028) sobre `07-reportes-basicos` (`done`), que es el modelo declarado |
| C2 | Toda feature `done` con tests que pasan | **`[ ]`** — 07 está `done` y su suite tiene 18/35 en rojo hasta el apply |
| C2 | `progress/current.md` describe la sesión activa | `[x]` — lo escribe la otra terminal; este delta **no lo tocó** (verificado con `git diff`) |
| **C3** | Solo capas previstas | `[x]` — `services` → `hooks` → `screens`/`components`; los 2 componentes nuevos son presentacionales puros (sin fetch) |
| C3 | Sin deps nuevas | `[x]` — `package.json` sin cambios |
| C3 | Sin logs de debug / TODOs sin contexto | `[x]` |
| C3 | Sin `establishment_id` hardcodeado | `[x]` — el tenant sale siempre de la fila del rodeo (`v_est`) o de la fila padre; las 3 RPC no reciben `establishment_id` |
| **C4** | ≥1 test por módulo con lógica | `[x]` en el frontend puro; **`[ ]`** en `ai_females` (H-3) |
| C4 | Fixtures reales, sin mocks de I/O crítico | `[x]` — la suite corre contra la DB remota |
| C4 | Runner > 0 tests y todos verdes | **`[ ]`** — 17/35 |
| C4 | Test de aislamiento cross-tenant | `[x]` escrito y **bien diseñado** (TR.21 sobre el conjunto **descubierto**, con la campaña CERRADA) · ⏳ sin ejecutar |
| **C5** | Sin artefactos temporales sin trackear | `[x]` — `__shots__/` gitignored; `design/**` sin re-renderizar |
| C5 | Entrada en `progress/history.md` | `[ ]` — la escribe el leader al cerrar |
| C5 | Última feature en su estado correcto | `[x]` |
| **C6** | 3 archivos de spec presentes | `[x]` (+ `context`) |
| C6 | EARS estricto | `[x]` |
| C6 | Tasks `[x]` | `[x]` con la salvedad de las 6 del leader |
| C6 | Cada `R<n>` cubierto por ≥1 test | **`[ ]`** — 7 requisitos sin oráculo (§3) |
| **C7** | Tablas nuevas con `establishment_id` FK | `[x]` — las 3 |
| C7 | RLS habilitado | `[x]` — `0127:90`, `0128:274-275` |
| C7 | Helpers `has_role_in` / `is_owner_of` | `[x]` — `has_role_in` en las policies y en las 10 lecturas; `is_owner_or_vet_of` es **copia literal** de `is_owner_of` con el rol ampliado (verificado línea por línea contra `0005`) |
| C7 | Test cross-tenant | `[x]` escrito (TR.21 + TR.14 + TR.14e + TR.15 (7)) · ⏳ |
| **C8** | Feature de carga en campo funciona sin conexión | N/A — el cierre es **online-only por decisión de dominio** (DL9); la **carga** de eventos de una campaña cerrada **no se bloquea** (DL10 = ausencia de trigger, TR.16) |
| C8 | Bucket de PowerSync correcto | `[x]` — las 3 tablas **no** entran a `sync-streams/rafaq.yaml` (DL8), con guard case-insensitive **verde hoy** (TR.19) |
| C8 | Conflict resolution documentada | `[x]` — `design` §2.1 (intervalo medio-abierto, fecha de upload) + `0127` `comment on table` |
| **C9** | Suite E2E de regresión `app/e2e/*.spec.ts` verde | **`[ ]`** — **no existe** `.spec.ts` para el delta. Consistente con los dos deltas previos de spec 07 (`paricion-fix`, `destete-kpi`, ambos solo con capture) y con la nota del propio capture, pero el box queda vacío |
| C9 | Capture file con capturas nombradas | `[x]` — 9 estados + 8 anti-recorte |
| C9 | Gate 2.5 corrido por el leader | `[ ]` — T68 |
| C9 | `__shots__/*.png` no commiteados | `[x]` |

---

## 6. Checklist RAFAQ-específico

### A. Multi-tenancy / RLS — **aplica**
- [x] `enable row level security` en las 3 tablas nuevas (`0127:90`, `0128:274-275`).
- [x] Policies según ADR-004, y la asimetría de DP-19 está **declarada** (no derrapa):
      `rodeo_membership_history` usa la cadena de FK (`establishment_of_profile`) porque cuelga de una tabla
      escribible por el cliente; las 2 de snapshot scopean por la columna denormalizada porque **no hay camino
      de escritura del cliente**, y ese invariante lo verifica TR.14e. El desvío de ADR-026 está escrito **como
      desvío**, no disfrazado de cita.
- [x] Helpers `has_role_in()` / `is_owner_of()` usados; `is_owner_or_vet_of` es copia literal con
      `ur.active = true` y `e.deleted_at is null` intactos. TR.14f(a) es el oráculo real; TR.14f(b) está
      **rotulado** como no-falsable, que es la respuesta correcta a un estado inalcanzable.
- [x] Test de aislamiento cross-tenant, y además **con la campaña cerrada** (TR.21) — el hueco que Gate 1 H-1
      identificó. Sin ejecutar (roja-hasta-apply).
- [ ] `deleted_at IS NULL` en las policies de SELECT: **N/A explicado** — las 3 tablas nuevas **no tienen**
      `deleted_at` (son historia / append-only). La exclusión de perfiles borrados vive en el cómputo
      (`p.deleted_at is null`, RCC.2.5, `0129:227`), no en la policy.

### B. Offline-first — **aplica parcialmente**
- [x] La **carga** de datos no se rompe: DL10 es ausencia de código y TR.16 lo testea explícitamente.
- [x] No sincroniza (DL8), con guard de ausencia case-insensitive **verde hoy** y mutado por mí (V7).
- [x] Conflict resolution documentada (intervalo medio-abierto + limitación "fecha del upload, no del hecho").
- [x] La pantalla no hace requests síncronos: pasa por `services/reports.ts` (online-only por diseño, R7.2.2).
- [ ] **El cierre es online-only y eso está bien (DL9), pero sin oráculo** — H-6 / RCC.5.11.

### C. BLE — **N/A**
El delta no toca BLE. El único hunk de `useStickStatusSurface('screen-band')` en `reportes.tsx` es de **otra
terminal** y quedó **intacto** (verificado con `git diff`), sin conflicto con el montaje de la barra ni de la
hoja (la hoja se monta como hermano del `Shell`, no dentro del `ScrollView`).

### D. UI de campo — **aplica con matices**
La pantalla de reportes es superficie de **análisis**, no de manga.
- [x] Touch targets: los 6 `Button` usan `minHeight: $touchMin = 56` (`tamagui.config.ts:145`), el token del
      repo para todos los botones. Por debajo del 60dp genérico del checklist, pero es la convención app-wide,
      no una regresión del delta.
- [ ] Fuente ≥ 18pt: **no se cumple, y es la escala del repo** (`$3 = 13`, `$4 = 14`, `$5 = 16`, `$8 = 23`). El
      delta usa la misma escala que el resto de `reportes.tsx`. No es defecto del delta; queda documentado.
- [x] Una decisión por pantalla: la hoja pide **una** confirmación, y la segunda acción (reconocimiento) **solo
      aparece después** de que el server rechazó (RCC.10.7.a). Bien resuelto.
- [x] Estado de loading visible: `busy` deshabilita y el copy pasa a "Cerrando…". **Pero** ver **H-1**: falta el
      estado "todavía no sé si es foto o número vivo".
- [x] Anti-recorte: `lineHeight` matcheado en los 12 textos con `fontSize` de los dos componentes nuevos, y 8
      `assertTextNotClipped` sobre los textos con descendentes.
- [x] es-AR: fechas por `formatDateEsAr` (dd/mm/aaaa) y singular/plural en `missing`. Ambos con mutante que
      muere (V8). Sin números decimales nuevos.

### E. Edge Functions — **N/A**
El delta no toca `supabase/functions/`.

---

## 7. Cambios requeridos

Bloqueantes, en orden de valor:

1. **H-1** — `app/src/utils/reports-format.ts:631-638` + `reports-format.test.ts:646-653` +
   `app/app/(tabs)/reportes.tsx:260-266`: la barra afirma "Campaña en curso" mientras no sabe, y conserva la
   etiqueta de la campaña anterior al cambiar de año/rodeo. Agregar el estado "desconocido" (o gatear el
   montaje), invalidar la etiqueta al cambiar `(rodeoId, year)`, hacer que el test diga lo que asserta, y
   capturar el estado de carga. Reconciliar `design` §7.2 y RCC.10.1/10.2/10.3.
2. **H-2** — `supabase/tests/puesta-en-servicio/run.cjs:148-173`: aplicar la corrección R6 (`entry_date`)
   también acá; TPS.9 y TPS.15 quedan calendario-dependientes post-apply (rojas desde el 1/12). Y reescribir el
   comentario + mensaje de `:645` ("membresía active"), que post-delta es falso. Ampliar `design` §15 R6.
3. **H-3** — `supabase/tests/reports/run.cjs`, TR.13: agregar el caso de la rama **IA** con sus dos
   contrafactuales históricos, y su fila con `source = ai` en el bucket `serviced` de TR.20 (RCC.2.10).
4. **H-4** — `design` §2.4 + RCC.4.7: la cabecera y el detalle **no** salen del mismo snapshot de transacción
   (`0130:89-128`, función `VOLATILE` en `READ COMMITTED`). Corregir la construcción o declarar la ventana. La
   spec no puede quedar afirmando "el mismo select".
5. **H-5** — `supabase/migrations/0130_campaign_close_rpcs.sql:423-478`: agregar el assert fail-closed de que
   cada nombre de `v_public` resuelva a por lo menos una fila de `pg_proc` (el typo en un nombre sin prefijo
   —hoy `is_owner_or_vet_of`— escapa a los dos loops).
6. **H-6** — cerrar los tres baratos (RCC.5.11, RCC.10.4, RCC.4.6/7.2) y **declarar** los otros cuatro como
   límite en `design` §13, en vez de dejarlos como cobertura implícita en la tabla de trazabilidad.
7. **H-7** — `reports-format.test.ts:534`: un caso de `closedAt` con la forma real (`timestamptz` con hora).

Condición de cierre, no del implementer:

8. **T73** (leader, con OK de Raf): aplicar `0127` a `0130` **en ese orden** y volver a correr
   `node --test supabase/tests/reports/run.cjs`. **35/35 o no cierra.** Y medir los **5 mutantes que el
   implementer declaró como no ejecutables**: invertir guard/cortocircuito y cota/cortocircuito en una de las 7
   (TR.21a/b), sacar `ur.active` de `is_owner_or_vet_of` (TR.14f(a)), un `grant insert` a `authenticated` en una
   tabla de snapshot (TR.14e), y desalinear el `establishment_id` del detalle (TR.14h). Sin esas cinco
   mediciones, los oráculos que Gate 1 pidió siguen sin demostrar que saben fallar.
9. **T74** (leader): el re-seed cubre RCC.11. Dato útil que medí: *La Facundina* tiene solo **3 de 353**
   perfiles sin `entry_date`, y su membresía más vieja arranca en **2012-10-03**, así que el backfill de `0127`
   la deja en buenas condiciones. Ojo con **RCC.11.10** (dos `close_campaign` en la misma transacción): no tiene
   test y el runbook lo necesita.

---

## 8. Lo que quedó bien y conviene no perder en el fix-loop

- El **descubrimiento por catálogo de TR.21** (el bug que la spec traía) está bien resuelto y **medido**: 8 hoy,
  9 post-apply. El piso de 9 es fail-closed de verdad.
- La **derivación de `revoke`/`grant` desde el catálogo** (R2) elimina por construcción la clase de error del
  `42883` con firma vieja. Es mejor que lo que pedía la spec.
- **TR.18 asserteado dentro de `kpiBundle`** (vale en todos los escenarios, no en uno elegido) y el **control de
  no-vacuidad de TR.13(e)** son dos ejemplos de oráculo escrito con la cabeza en el lugar correcto.
- La corrección de los `insert` de **TR.14e** (payloads completos + regex que **no** acepta "no existe la
  tabla") es exactamente la autorrevisión que se pide: el test dejó de poder pasar por la razón equivocada.
- **TR.14f(b) rotulado como no-falsable** en vez de disfrazado de cobertura.
- El orden guard / cota / cortocircuito está bien en **las siete** (verificado por mí, 13/13 con offsets), y
  `close_campaign` computa todo antes de escribir (G1, idempotencia, 4 temporales, 5 KPI, G2, G3, cabecera,
  detalle).
- El `cleanup()` corre **antes** de su propio assert de cascada: el rojo estructural **no** ensucia la DB de DEV.

---

## 9. Cruce con el Gate 2 (`progress/security_code_07-campanas-congeladas.md`)

El Gate 2 corrió en paralelo y también dio **FAIL** (1 HIGH + 3 MEDIUM). **No hay contradicción: es
complementario.** Su HIGH (H-C1) es un hallazgo que yo **no** tenía y que refuerza mi H-5 y mi H-6 desde otro
ángulo: por el `pg_default_acl` del schema `public`, las 3 tablas nuevas **nacen con `TRUNCATE` concedido a
`anon` y `authenticated`**, ninguna de las 4 migraciones lo revoca, y **TR.14e no lo puede ver** porque prueba
`insert`/`update`/`delete` por PostgREST, no `TRUNCATE`. O sea: el invariante que el `comment on column` de
`0128:196-203` declara —"no existe grant de escritura a `authenticated`"—, que es la justificación entera del
desvío de ADR-026 (DP-19), es **falso al momento del apply**, y su guard declarado es ciego al observable que
importa. Es exactamente la misma clase que mi H-5 (el guard no puede fallar) y que mi H-1 (el oráculo asserta
otra cosa que lo que su nombre promete).

**Para el leader**: los dos documentos se leen juntos. Orden sugerido del fix-loop: H-C1 del Gate 2 (6 líneas de
`revoke` + la aserción de `TRUNCATE` en TR.14e) → **H-1** y **H-2** de acá (los dos oráculos que pasan por el
motivo equivocado) → **H-3** (rama IA sin cobertura) → **H-4**/**H-5**/**H-6**/**H-7** → recién ahí T73.

---
---

# RE-REVIEW — tras el fix-loop (2026-08-07)

> El bloque de arriba queda **como registro** de la primera pasada. Esto es la segunda.
> Read-only otra vez: no se editó código, tests, migraciones ni specs. Todos los mutantes corrieron sobre
> **copias aisladas** en el scratchpad; verifiqué al final que el repo quedó byte-idéntico.

## Veredicto de la re-review

**CHANGES_REQUESTED** — pero por muy poco y por dos motivos de distinto peso, que conviene no mezclar:

1. **`node scripts/check.mjs` sigue en rojo (exit 1)** y su **única** causa ahora es la suite de reportes
   roja-hasta-apply. Todo lo demás del pipeline pasó en la misma corrida: typecheck ✓, scripts 28/28, unit
   **3030/3030**, RLS 22/22, **Edge 42/42** (sin el flake de rate-limit de la primera pasada), Animal
   **139/139**, Maneuvers 14/14, **Puesta-en-servicio 11/11**. Esto no es del implementer: es el gate de
   deploy de Raf (T73).
2. **Un hallazgo nuevo, y es de la clase que se me pidió cazar**: la corrección del **M-C2 del Gate 2**
   ("barrer por `oid` y no por `proname`") es **demostrablemente un no-op** para la amenaza que dice cerrar, y
   el comentario que la acompaña afirma una protección que no existe. Ver **RR-1**. Es la tercera vez en esta
   unidad que un texto afirma un invariante que el código no sostiene (el `comment on column` de H-C1, el
   nombre del test de H-1, y ahora este).

**Los 5 findings míos y los 3 del Gate 2 están cerrados, y lo verifiqué midiendo, no leyendo.** Salvo M-C2.

## Los 8 findings, uno por uno (verificado, no creído)

| # | Estado | Cómo lo verifiqué |
|---|---|---|
| **H-1** (oráculo que afirmaba lo que su nombre negaba) | ✅ **CERRADO** | `campaignStateView(null)` → `badge: 'desconocido'`, `title: 'Campaña'`, sin fecha y sin acciones (`reports-format.ts:663-670`). **Mutante N1** (revertir a `'en-curso'` / "Campaña en curso") → **rojo**. **Mutante N6** (dejar el badge en `desconocido` pero devolver el título viejo) → **rojo**: el test ahora asserta la ausencia (`!/en curso\|cerrada\|foto/`), no un string. Y el control de no-vacuidad **sabe fallar**: **mutante N2** (badge siempre `desconocido`) → **4 rojos**, uno de ellos el propio control. La trampa que buscaba en el componente también está cerrada: `CampaignStateBar.tsx:41` pasó de `closed = badge !== 'en-curso'` (que le habría puesto el ícono de **cámara** al estado desconocido) a un match exacto sobre los dos badges cerrados, con `HelpCircle` para `desconocido`. |
| **H-2** (R6 en una sola de las dos suites) | ✅ **CERRADO** | `puesta-en-servicio/run.cjs:173` escribe `entry_date` con el mismo default. **Corrí la suite: 11/11 verde**, y otra vez dentro de `check.mjs`. El comentario falso de TPS.15:645 ("al no estar `active`") está reescrito y ahora dice el motivo real (la membresía cerrada antes del corte). **Confirmé por mi cuenta que no hay un tercer consumidor**: `grep` de las 7 funciones sobre `supabase/tests/` da exactamente `reports` y `puesta-en-servicio`. |
| **H-3** (rama `ai_females` sin oráculo) | ✅ **ESCRITO**, ⏳ no ejecutable hoy | TR.13(g) siembra una `ternera` (único camino al conjunto = el evento de IA), asserta `source === 'ai'` y le aplica los **dos** contrafactuales de membresía. Fail-closed: `enableDataKey` **tira** si no puede habilitar y el `insert` de IA tiene su propio `assert.equal(aiErr, null)`. **Sobre el "no insertaba nada" que él mismo encontró**: hoy no puedo ejecutar las aserciones de (g) —TR.13 aborta antes, en (a), que es la reproducción del defecto vivo— **pero sí puedo probar que el sembrado corre**: TR.20 usa `withAi: true` y falla recién en `close_campaign`, o sea que `enableDataKey` + el `insert` de IA se ejecutaron sin error. El gating de `0054` está resuelto de verdad. |
| **H-4** (cabecera y detalle de snapshots distintos) | ✅ **CERRADO** (con matiz, RR-2) | `0130:249-265`: cuenta las filas de los 5 buckets recién insertadas y aborta con `40001` si difieren de los 5 números. Verifiqué el **orden** (los 5 `insert` terminan en :234, el conteo arranca en :249) y que el `raise` no está dentro de ningún bloque `exception` → tumba la transacción entera, no queda snapshot. `design` §2.4 quedó **reconciliado con honestidad**: dice explícitamente que "el mismo `select`" era más fuerte de lo que el código puede prometer. `40001` cae al default `server` de `mapRpcError`, que es lo que la tabla de §5.C declara. |
| **H-5** (loop (2) tautológico + hueco del typo) | ✅ **CERRADO** | Loop (3) en `0130:528-539`: cada nombre de `v_public` tiene que resolver a ≥1 fila de `pg_proc`. Cierra el caso del typo. Verifiqué las **tres** listas: 14 entradas, idénticas nombre a nombre. Y el loop (2) ahora **dice qué es** ("no es un oráculo independiente: verifica el estado final"), que era la mitad honesta que faltaba. |
| **H-6** (7 requisitos sin oráculo) | ✅ **CERRADO** | `RCC.5.11`: guard de cableado nuevo (`reports-online-guard.test.ts`), **registrado en `run-tests.mjs`** (verificado) y **no vacuo** — le tiré 3 mutantes sobre una copia: sacar `assertOnline` de `callRpcScalar` → rojo; moverlo **después** del `supabase.rpc` → rojo; hacer que `closeCampaign` llame `supabase.rpc` directo → **2 rojos** (incluido el control de no-vacuidad). `RCC.10.4`: la regla salió del `??` de la pantalla a la función pura `campaignCclMonths`; **mutantes N3** (volver al `??` encadenado) y **N4** (ignorar el snapshot) → **rojo los dos**. `RCC.4.6/7.2`: TR.20 **borra** un `animal_profiles` y verifica que la fila del detalle queda con `animal_profile_id` nulo, `idv` y `source` intactos, y que la RPC cerrada sigue devolviendo `serviced` filas. `RCC.9.12`: assert textual **rotulado** (correcto: `pg_depend` no registra referencias a tablas dentro de un cuerpo plpgsql). `RCC.9.8`/`RCC.11.10`: TR.14i, con la carrera declarada como probabilística y el assert final sobre el estado (no puede dar falso verde) y los dos cierres en **una** transacción con `rollback` + verificación de que no quedó rastro. |
| **H-7** (fixture `closedAt` date-only) | ✅ **CERRADO** | Caso nuevo con `'2026-03-15T01:30:00Z'` y la expectativa **computada** con getters locales. **Mutante N5** (formatear el instante con getters UTC — el drift −1 día que la convención es-AR existe para evitar) → **rojo**. Nota: ese mutante muere en huso AR; en un runner UTC el caso quedaría vacuo, que es el lado seguro del trade-off y está declarado en el propio test. |
| **H-C1** (Gate 2: TRUNCATE por `pg_default_acl`) | ✅ **CERRADO**, y su dato es correcto | Medí `pg_default_acl` yo mismo: tablas de `public` creadas por `postgres` → `anon=Dxtm, authenticated=Dxtm, service_role=Dxtm, powersync_role=r`. **`D` es TRUNCATE**: el hallazgo es real. `0127:118` y `0128:299-300` emiten `revoke all … from public, anon, authenticated` **antes** de los `grant select`, sin tocar `powersync_role` (correcto: su `SELECT` es lo que lee la replicación). El nuevo assert de TR.14e resuelve el **ACL crudo** con `has_table_privilege` y trae su control de no-vacuidad (`auth_sel === true`). **Y el dato del mutante por sustitución es cierto**: medido contra el remoto, `user_private` da `auth_truncate = true` / `anon_truncate = false` — `0068:208` revocó solo de `anon, public`, así que **el precedente que la migración cita no hace lo que la migración hace**; el delta es más estricto que él. Lo mismo para `animal_profiles`, `reproductive_events`, `rodeos`, `user_roles` y `animal_category_history`: TRUNCATE `true` para los dos roles. El barrido general está anotado en `docs/backlog.md`. |

## Hallazgos nuevos de la re-review

### 🟡 RR-1 — El "barrido por `oid`" (Gate 2 M-C2) es un **no-op demostrable**, y el comentario afirma una protección que no existe

**Dónde**: `0128:354-368` (y sus copias en `0129:637-646` y `0130:477-486`).

El comentario dice, literal:

> con el nombre, una SOBRECARGA futura de una pública (p. ej. `rodeo_serviced_females(uuid,int,uuid)`) se
> auto-concedería a `authenticated` en este mismo loop y además quedaría excluida del barrido de internas por
> compartir el nombre. Hoy no hay ninguna sobrecarga en la lista blanca (verificado en el catálogo), **y con
> esto tampoco puede aparecer**.

**Con esto sí puede aparecer, exactamente igual que antes.** El loop (0) sigue seleccionando **por nombre**
(`where n.nspname = 'public' and p.proname = any (v_public)`) y de esas mismas filas construye `v_oids`. Por lo
tanto, para toda función `f` del schema: `f.oid ∈ v_oids ⟺ f.proname ∈ v_public`. El predicado nuevo
`not (p.oid = any (v_oids))` es **idénticamente equivalente** al viejo `not (p.proname = any (v_public))`.

Consecuencia concreta: una sobrecarga interna futura llamada `rodeo_serviced_females(uuid,int,uuid)` **sigue**
siendo seleccionada por el loop (0), **sigue** recibiendo `grant execute … to authenticated`, y **sigue**
quedando fuera del barrido de internas. El cambio no mueve el agujero: no lo toca. Lo único que aporta es
compatibilidad hacia adelante (si algún día el loop (0) pasa a ser por firma, los otros dos ya lo siguen).

**Medido**: hoy **ninguno** de los 14 nombres de la lista blanca tiene sobrecarga (10 con exactamente una
función, 4 todavía inexistentes), así que **no hay impacto vivo** — por eso es 🟡 y no 🔴.

**Qué pido** (una de las dos, no las dos): (a) que el loop (0) se keye por **firma** —la lista blanca pasa a
ser de pares `(nombre, oidvectortypes)`, o se filtra `oidvectortypes(p.proargtypes)` contra lo esperado—, que
es lo que cerraría de verdad el M-C2; o (b) que se borre la frase "y con esto tampoco puede aparecer" y se diga
lo que el cambio es: alineación de los tres predicados, con la sobrecarga **declarada como hueco abierto**.
Lo que no puede quedar es un comentario de seguridad afirmando una protección inexistente, en el mismo archivo
en el que el Gate 2 acaba de encontrar otro comentario afirmando un invariante falso.

### ⚪ RR-2 — El `40001` cierra el detalle↔cabecera de los **5 buckets**, no la consistencia de los 21 números

Dos residuos, ninguno bloqueante, los dos por precisión de lo que la spec promete:

1. **Es una identidad de CONTEO, no de CONJUNTO.** Un cambio concurrente que saque un animal y meta otro entre
   la materialización de las temporales y las llamadas a los KPI deja los cinco conteos iguales y pasa. La
   ventana es de milisegundos y hace falta que el cambio afecte la **membresía a una fecha de corte pasada**,
   así que es remoto — pero "se cierra" es más de lo que el check hace.
2. **No cubre cabecera↔cabecera.** `ccl_total` sale de una **tercera** invocación de `rodeo_campaign_tacto`
   (`rodeo_ccl_distribution`), posterior a la de `rodeo_pregnancy_kpi`. Un tacto concurrente entre las dos deja
   congelado `pregnant = 3` y `ccl_total = 2` en la **misma fila**, y nada lo nota: el check compara el detalle
   contra `v_preg.pregnant`, no `v_ccl.total` contra `v_preg.pregnant`. RCC.4.7 solo habla de detalle↔cabecera,
   así que **el requisito se cumple**; lo que hay que ajustar es la frase de `design` §2.4 ("no se declara la
   ventana: se cierra") → "se cierra para los cinco conjuntos que tienen detalle".

### ⚪ RR-3 — El loop (3) vive solo en `0130` y su justificación se apoya en una premisa no verificada

El comentario dice "como las tres listas son idénticas, verificar acá cubre el typo de las tres". **Lo verifiqué
y hoy es cierto** (14 entradas, mismos nombres en el mismo orden en `0128`/`0129`/`0130`), pero nada lo hace
cumplir: son tres arrays hardcodeados en tres archivos. Y hay una consecuencia operativa: con un typo, `0128` y
`0129` **aplican bien** y recién `0130` aborta → el operador queda con dos migraciones committeadas y la tercera
caída. Es aceptable (el apply para y se ve), pero conviene que el runbook de T73 lo sepa.

### ⚪ RR-4 — Corrijo mi propia severidad de H-5: el hueco del typo era de **disponibilidad**, no de exposición

En la primera pasada escribí que un typo dejaría la función "abierta a `PUBLIC`". **Medí el `pg_default_acl` y
me equivoqué**: para funciones de `public` creadas por `postgres` el ACL default es `{postgres=X/postgres}` —
**sin `PUBLIC`**. O sea que un typo deja la función **sin el `grant` a `authenticated`** (inutilizable, 404 en
runtime), no expuesta. El loop (3) sigue valiendo la pena —convierte un 404 futuro en una migración que aborta—
pero el riesgo que cierra es otro. El §15-bis R16 ya corrige la misma premisa en las tres migraciones, y hace
bien: tres archivos afirmaban "una función nueva nace con `EXECUTE` a `PUBLIC`", que es el default **de
Postgres** y no el de **esta base**.

### ⚪ RR-5 — El key-tagging de `useCampaignStatus` no tiene oráculo automatizado, y la justificación de no tocar `useReport` es correcta a medias

Verificado por lectura: el `fetcher` recomputa la clave con el **mismo** closure con el que `useReport` se
keyea, y `status.data` se anula si `phase.data.key !== key`. Es correcto y el blast radius es mínimo (no toca el
hook que usan los otros 6 reportes). Pero la frase que lo justifica —"el anti-parpadeo **sí** es correcto para
los números"— es cierta a medias: al cambiar de año, las cards siguen mostrando los KPI del año anterior bajo
un encabezado que ya dice `Campaña <año nuevo>`. **Es comportamiento preexistente de spec 07**, no lo introduce
este delta, y el delta incluso lo mejora (con `desconocido`, el hint se calla el "foto/en curso"). Va a
`docs/backlog.md`, no a este fix-loop. El repo no monta RTL, así que el key-tagging queda sin oráculo: declararlo.

### ⚪ RR-6 — Menor

`mapRpcError` no tiene rama explícita para `40001`: cae al default `server` con el copy "No se pudo cargar el
reporte. Reintentá en un momento.", que se le muestra a alguien que apretó **"Cerrar campaña"**. La tabla de
`design` §5.C dice `server`, así que es fiel al contrato; el copy es genérico del módulo.

## El rojo declarado: 17/36, verificado uno por uno

`node --test supabase/tests/reports/run.cjs` → **17 pass / 19 fail** de 36 (antes 17/35; el test nuevo es
TR.14i). **Ninguna roja es nueva ni es una regresión**, y **ninguna verde se cayó**: los 17 verdes son los
mismos 17 de la pasada anterior (los 12 preexistentes + el TR.12 de spec 02 + TR.17 + TR.19 + los dos TR.10 +
`setup`). Las 19 rojas, agrupadas por causa medida:

| Causa | Tests |
|---|---|
| `PGRST202 close_campaign / rodeo_campaign_status no existe` | TR.12, TR.12b, TR.14, TR.14d, TR.21, TR.14i, TR.14h, TR.14f, TR.14c, TR.16, TR.20 |
| `PGRST205 / 42P01 rodeo_membership_history no existe` | TR.15, TR.14e, `cleanup` |
| asserts de catálogo sobre objetos que aún no existen | TR.14f (`is_owner_or_vet_of: existe`), TR.14g, TR.14b (`las 7 internas existen`) |
| **el defecto todavía vivo** (son la reproducción del probe) | **TR.12c** (`campaña ABIERTA: las 3 mutaciones no mueven ningún KPI`) y **TR.13** (`(a) el que entró DESPUÉS del corte no cuenta`) |

TR.19 pasó de verde-parcial a verde-con-más: su assert nuevo de `puballtables = true` **se ejecutó y pasó**, o
sea que la premisa del Gate 2 M-C1 (la publicación `powersync` es `FOR ALL TABLES`) está **medida**, no supuesta.

`node scripts/check.mjs` → **exit 1**, y la suite de reportes es la **única** roja del pipeline:

| Etapa | Resultado |
|---|---|
| typecheck client (`tsc --noEmit`) | ✓ 0 errores |
| scripts unit (spec 16 Run B) | 28 / 28 |
| client unit | **3030 / 3030** |
| RLS suite | 22 / 22 |
| Edge Functions | **42 / 42** (esta vez sin el flake de rate-limit) |
| Animal suite (spec 02) | 139 / 139 |
| Maneuvers suite (spec 03) | 14 / 14 |
| Puesta-en-servicio (spec 02 A) | **11 / 11** ← el fix de H-2, en el pipeline real |
| **Reports suite (spec 07 C)** | **17 / 36 — roja-hasta-apply** |

## Mutantes de esta pasada (todos ejecutados, todos sobre copias aisladas)

| # | Oráculo | Mutante | Resultado |
|---|---|---|---|
| N1 | `campaignStateView(null)` | revertir a `badge:'en-curso'` + "Campaña en curso" | ✅ rojo (1) |
| N2 | control "un estado CONOCIDO nunca queda en desconocido" | badge siempre `desconocido` | ✅ rojo (4, incluido el control) |
| N3 | `campaignCclMonths` | volver al `s?.serviceMonths ?? rodeoServiceMonths` | ✅ rojo (2) |
| N4 | `campaignCclMonths` | ignorar el snapshot y usar siempre los del rodeo | ✅ rojo (2) |
| N5 | `closedAt` timestamptz | formatear el instante con getters **UTC** | ✅ rojo (1) |
| N6 | título del estado desconocido | dejar el badge bien y el título "Campaña en curso" | ✅ rojo (1) |
| O1 | guard de cableado online | sacar `assertOnline` de `callRpcScalar` | ✅ rojo (1) |
| O2 | ídem | mover el chequeo **después** del `supabase.rpc` | ✅ rojo (1) |
| O3 | ídem | `closeCampaign` llama `supabase.rpc` directo | ✅ rojo (2, incluido el control) |
| S1 | TR.14e (ACL crudo) | **por sustitución** contra el remoto: mismo predicado sobre `animal_category_history` (sin `revoke`) y `user_private` (revoke parcial) | ✅ discrimina: molde → `auth_trunc`/`anon_trunc` **true**; `user_private` → `auth_trunc` **true**, `anon_trunc` **false** |
| S2 | barrido del smoke-check | simulación **por OID** del loop (1) contra el catálogo remoto | ✅ **0 filas** → las migraciones no abortan por la lista blanca |
| S3 | RR-1 | equivalencia `oid` vs `proname` | ❌ **el "fix" no cambia nada** (ver RR-1) |

Baseline y restauración verificados en las tres tandas (71/71 y 4/4). **Integridad**: `git status --porcelain`
del repo idéntico al de antes de mis mutantes.

## Trazabilidad — lo que cambió respecto de la primera pasada

De los **7 requisitos sin oráculo** que reporté, quedan **1**:

| Requisito | Antes | Ahora |
|---|---|---|
| RCC.2.10 (rama IA) | ❌ | ⏳ TR.13(g) + `source='ai'` en TR.20 (escrito; corre post-apply) |
| RCC.4.6 / RCC.7.2 | ❌ parcial | ⏳ TR.20 borra el perfil y verifica la fila huérfana |
| RCC.5.11 | ❌ | ✅ `reports-online-guard.test.ts` (**verde hoy**, 3 mutantes muertos) |
| RCC.9.8 | ❌ parcial | ⏳ TR.14i (carrera real con `Promise.all`) |
| RCC.9.12 | ❌ | ⏳ assert textual **rotulado** en TR.14g |
| RCC.10.4 | ❌ | ✅ `campaignCclMonths` (**verde hoy**, 2 mutantes muertos) |
| RCC.11.10 | ❌ | ⏳ TR.14i(b), dos cierres en una transacción con `rollback` |
| RCC.1.13 | ❌ | ⚪ **declarado como límite** en `design` §15.2, con el motivo (exigiría montar el flujo de transferencia entero para verificar que algo **no** pasó) y los tres apoyos que lo sostienen |
| **RCC.10.2.a** (nuevo) | — | ✅ el estado `desconocido`; requisito agregado a `requirements` a partir de H-1 |
| RCC.11.* (re-seed) | ❌ | ⚪ sigue siendo **T74 del leader** |

## CHECKPOINTS — deltas respecto de la primera pasada

- **C1** `check.mjs` exit 0 → sigue `[ ]`, pero ahora la **única** causa es la suite roja-hasta-apply (antes se
  sumaba el flake de Edge, que esta vez no apareció: 42/42).
- **C4** "≥1 test por módulo con lógica" → pasa a `[x]`: la rama `ai_females` tiene oráculo (TR.13(g)).
- **C6** "cada `R<n>` cubierto por ≥1 test" → pasa a `[x]` **con la salvedad** de RCC.1.13 (declarado como
  límite, con motivo) y RCC.11.* (leader).
- **C9** suite E2E de regresión → sigue `[ ]` (solo capture; consistente con los dos deltas previos de spec 07).
  El capture ganó el estado 10 (`campana-desconocida`) y la variante del spike existe.
- El resto, sin cambios.

## Cambios requeridos (esta pasada)

1. **RR-1** — `0128:354-368` (+ `0129`/`0130`): o el loop (0) se keye por **firma**, o se borra la frase "y con
   esto tampoco puede aparecer" y la sobrecarga queda **declarada como hueco abierto**. Es lo único de código /
   comentario que queda. **Gate 2 M-C2 sigue abierto**, aunque esté reportado como cerrado.
2. **RR-2** — `design` §2.4: "no se declara la ventana: se cierra" → acotar a "se cierra para los cinco
   conjuntos que tienen detalle" y decir que es identidad de **conteo**, no de conjunto.
3. **RR-3** / **RR-5** — dos líneas de declaración: la premisa "las tres listas son idénticas" no está
   enforced, y el key-tagging de `useCampaignStatus` no tiene oráculo (el repo no monta RTL).

## Y después de eso

El gate que queda **no es del implementer**: **T73** (apply `0127`→`0130` con el OK de Raf) y la re-corrida de
la suite, que tiene que dar **36/36**. Ahí recién se pueden medir los **5 mutantes que siguen sin ejecutarse**
(invertir guard↔cortocircuito y cota↔cortocircuito → TR.21a/b; sacar `ur.active` de `is_owner_or_vet_of` →
TR.14f(a); un `grant insert` a `authenticated` en una tabla de snapshot → TR.14e; desalinear el
`establishment_id` del detalle → TR.14h), más los dos que este fix-loop agregó a esa lista (revertir el `revoke
all` → el assert de ACL de TR.14e; sacar el conteo del `40001` → sin oráculo posible, es defensa en profundidad).
Y **T74** (re-seed, RCC.11.*), con el ojo puesto en RCC.11.10, que ahora **sí** tiene test (TR.14i(b)).

**Balance de la re-review**: el fix-loop hizo bien lo difícil —los dos oráculos que pasaban por el motivo
equivocado (H-1, H-2) están cerrados con mutantes que mueren, la rama sin cobertura tiene oráculo, y el
invariante de RCC.4.7 pasó de prometido a verificado— y tropezó una vez con lo fácil: un comentario que afirma
más de lo que su código hace. Eso es exactamente lo que esta unidad viene repitiendo, y por eso vale la pena
frenarlo una vez más antes del apply.
