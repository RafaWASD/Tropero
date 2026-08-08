# impl — delta `campanas-congeladas` (feature 07-reportes-basicos)

baseline_commit: 19dd826e95db4992059df925ffd3cd5e1eac4a83

> Punto desde el cual el Gate 2 calcula el diff. Trabajamos sobre `main` (no hay feature-branches):
> **NO** se usa `main...HEAD`. Si esta feature sigue en otra sesión, este SHA **no se sobreescribe**.

- **Spec**: `specs/active/07-reportes-basicos/{context,requirements,design,tasks}-campanas-congeladas.md`
- **ADR**: `docs/adr/ADR-032-campanas-cerradas-foto-inmutable.md`
- **Gate 1**: PASS (`progress/security_spec_07-campanas-congeladas.md`)
- **Puerta 1**: aprobada por Raf 2026-08-07 (DP-22 = campaña cerrada del demo 2024)
- **Evidencia del defecto**: `progress/repro_reportes-campanas-congeladas.md` (sus números son los casos de test)
- **`progress/current.md` NO se toca** (otra terminal es su dueña — instrucción del leader). El estado de esta
  feature vive acá.

## Estado

| Bloque | Tareas | Estado |
|---|---|---|
| A — verificación del as-built | T1–T3 | ✅ |
| B — `0127_rodeo_membership_history.sql` | T4–T11 | ✅ escrita, **NO aplicada** |
| C — `0128_campaign_snapshots.sql` | T12–T20-bis | ✅ escrita, **NO aplicada** |
| D — `0129_reports_historical_compute.sql` | T21–T33 | ✅ escrita, **NO aplicada** |
| E — `0130_campaign_close_rpcs.sql` | T34–T42 | ✅ escrita, **NO aplicada** |
| F — tests no-bypass (`supabase/tests/reports/run.cjs`) | T43–T57 | ✅ (roja-hasta-apply) |
| G — frontend | T58–T66 | ✅ verde |
| H — capture (Gate 2.5) | T67 ✅ · T68 = **leader** (veto) | 9 PNG generadas |
| I — cierre | T69–T71 ✅ · T72–T76 = **leader** | — |

**No se aplicó ninguna migración ni se tocó la DB remota con escrituras.** Las únicas llamadas al remoto
fueron `select` de catálogo (T1–T3 + la verificación de los mutantes), por el mismo transporte que
`scripts/apply-migration.mjs`, con un guard que aborta si la query no es de solo lectura. **No** se corrió el
re-seed de La Facundina (T74 es del leader).

---

## 1. Qué quedó implementado

### Backend (4 migraciones, escritas — las aplica el leader en T73, en orden)

| Archivo | Qué |
|---|---|
| `supabase/migrations/0127_rodeo_membership_history.sql` | Enum `rodeo_membership_reason` + tabla `rodeo_membership_history` (intervalo **medio-abierto** `[from_date, to_date)`) + 3 índices (incl. el único parcial de "una sola membresía vigente") + RLS de solo lectura por `establishment_of_profile()` + trigger `tg_animal_profiles_record_rodeo_change` (`SECURITY DEFINER`, 5 ramas) + backfill idempotente + la deuda de DL7 en el `comment on table`. |
| `supabase/migrations/0128_campaign_snapshots.sql` | `is_owner_or_vet_of` + 4 helpers de capa 0 (`campaign_tacto_bounds`, `animal_category_at`, `campaign_cycle_complete`, `campaign_missing_summary`) + las 2 tablas de snapshot (cabecera con los 21 KPI + los parámetros congelados + `closed_incomplete`/`missing_at_close`; detalle enum multi-fila con la **FK compuesta** `(snapshot_id, establishment_id)`) + RLS **solo SELECT** + el smoke-check de lista blanca con **los dos loops**. |
| `supabase/migrations/0129_reports_historical_compute.sql` | Las 3 set-functions internas (`rodeo_campaign_tacto` / `_births` / `_calves`) + `CREATE OR REPLACE` de **las 7** funciones de campaña: cortocircuito por snapshot **después** del guard y de la cota, cómputo histórico a la fecha de corte (membresía, categoría, aptitud y edad), ventana del tacto de DL5, `retired := 0`. + re-`revoke`/`grant` + smoke-check + guard de contrato (`prosecdef`/`stable`/`search_path`). |
| `supabase/migrations/0130_campaign_close_rpcs.sql` | `close_campaign` (VOLATILE, `search_path = public, pg_temp`, 3 gates duros, computa TODO antes de escribir, temporales crear-o-truncar, detalle por bucket), `reopen_campaign`, `rodeo_campaign_status` (STABLE, `has_role_in`, `can_close` con **los tres** gates, `closed_by_name` de `user_roles.member_name`, `has_new_data`) + grants + smoke-check + guard de volatilidad. |

### Tests no-bypass — `supabase/tests/reports/run.cjs`

TR.12 (inmutabilidad) · TR.12b/TR.12c (los dos contrafactuales) · TR.13 (cómputo histórico) · TR.14 (authz) ·
TR.14b (grants de función) · TR.14c (el cierre no muta datos) · TR.14d (F8: los 3 gates) · TR.14e (grants de
tabla) · TR.14f (rol caducado) · TR.14g (catálogo) · TR.14h + TR.14h-bis (procedencia del tenant) · TR.15
(membresía) · TR.16 (DL10) · TR.17 (tacto sin jornada + guard de clase) · TR.18 (denominador, asserteado
**dentro de `kpiBundle`** → vale en todos los escenarios) · TR.19 (ausencia en las sync rules) · TR.20
(detalle↔cabecera) · **TR.21** (guard y cota antes del cortocircuito, sobre el conjunto **descubierto**).
+ helpers de fixture (T43) + el `entry_date` de `createAnimal` + la verificación de cascada en el `cleanup`.

### Frontend

`app/src/services/reports.ts` (kind `conflict`, `CampaignStatus`, `fetchCampaignStatus`/`closeCampaign`/
`reopenCampaign`, los dos de escritura con `assertOnline` antes → DL9) · `app/src/utils/reports-format.ts`
(`campaignStateView` puro + `CampaignStatusLike`) · `app/src/utils/reports-format.test.ts` (**12 casos
nuevos**) · `app/src/hooks/use-reports.ts` (`useCampaignStatus` + `closeAction`/`reopenAction`/
`closeAllAction` en dos pasadas) · `app/src/components/reports/CampaignStateBar.tsx` **(nuevo)** ·
`app/src/components/reports/CampaignCloseSheet.tsx` **(nuevo)** · `app/src/components/reports/index.ts` ·
`app/app/(tabs)/reportes.tsx` (barra entre el `YearStepper` y Reproductivo, hint con el estado,
`serviceMonths` congelados al CCL, recarga en el `useFocusEffect`, hoja de confirmación) ·
`app/app/reportes-spike.tsx` (9 variantes mock) · `app/e2e/captures/campanas-congeladas.capture.ts` **(nuevo)**.

> **`app/app/(tabs)/reportes.tsx`**: el hunk sin commitear de la otra terminal (`useStickStatusSurface
> ('screen-band')`) quedó **intacto** — verificado con `git diff`. No se tocó el `Shell` ni el header: la hoja
> de confirmación se monta como **hermano** del `Shell` (su scrim tiene que cubrir la pantalla entera).

---

## 2. Trazabilidad `RCC.<n>` → artefacto

> Los `TR.*` son tests de `supabase/tests/reports/run.cjs`. Los `test(...)` de `campaignStateView` están en
> `app/src/utils/reports-format.test.ts`.

| Requisito | Implementado en | Verificado por |
|---|---|---|
| RCC.1.1–1.3 (tabla, medio-abierto, una vigente) | `0127` (1)(2) | TR.15 (1)(2)(5) |
| RCC.1.4–1.7 (las 5 ramas del trigger) | `0127` (4) | TR.15 (1)(2)(3)(4) |
| RCC.1.8 (backfill idempotente) | `0127` (5) | TR.15 (6) |
| RCC.1.9 (deuda de DL7 declarada) | `comment on table rodeo_membership_history` | — (documental) |
| RCC.1.10 / RCC.4.9 (fuera de PowerSync) | ausencia en `sync-streams/rafaq.yaml` | **TR.19** (case-insensitive) |
| RCC.1.11 (RLS solo lectura) | `0127` (3) | TR.15 (7) + **TR.14e** |
| RCC.1.12 (tenant de la fila padre) | `0127` (4) | TR.15 (1) |
| RCC.1.13 (`transfer_animal` no re-apunta) | ausencia de código + `comment on function` | — (no se tocó `0087`) |
| RCC.2.1–2.2 (fecha de corte) | `0129` (2) paso (3) | TR.13 (a)(b) + TR.20 (`state_as_of` congelado) |
| RCC.2.3–2.5 (membresía en vez de `status`) | `0129` (2) CTE `member` | TR.13 (a)(b)(c) |
| RCC.2.6–2.8 (categoría y aptitud al corte) | `animal_category_at` + `rv.event_date <= v_state_as_of` | TR.13 (d) + **TR.12c** |
| RCC.2.9 (fallback por edad al corte) | `0129` (2) `v_state_as_of - a.birth_date` | TR.13 (e) |
| RCC.2.10 (rama IA histórica) | `0129` (2) `ai_females` | (cubierto por el `join member` común) |
| RCC.2.11 (un solo dueño de la elegibilidad) | `0129` (2) | TR.17 + revisión |
| RCC.2.12 (`retired = 0`) | `0129` (3) | **TR.18** dentro de `kpiBundle` |
| RCC.3.1–3.5 (ventana del tacto, un dueño) | `campaign_tacto_bounds` + `rodeo_campaign_tacto` | TR.12 (mutación 1) + TR.12b |
| RCC.3.6–3.7 (partos y crías, un dueño) | `rodeo_campaign_births` / `_calves` | TR.12 (T0 `calved`/`pending_weaning`) |
| RCC.3.8 (las fórmulas no cambian) | `0129` (5)(7)(8) | TR.4/TR.4b/TR.6/TR.11 preexistentes (verdes) |
| RCC.4.1–4.3 (qué se congela) | `0128` (3) + `0130` (1) paso 8 | TR.20 |
| RCC.4.4–4.7 (detalle por animal) | `0128` (4) + `0130` (1) paso 9 | **TR.20** (conteo por bucket == cabecera) |
| RCC.4.8 / 4.8.a (RLS + procedencia) | `0128` (5) + `0130` paso 8/9 | **TR.14e** |
| RCC.4.8.b (FK compuesta) | `0128` (4) | **TR.14h** (+ `not null` de las 2 columnas) |
| RCC.4.10 (un solo vigente) | índice único parcial | TR.14 (idempotencia) + TR.16 |
| RCC.4.11 (cerrada a medias persistida) | `closed_incomplete` / `missing_at_close` | TR.14d (b)(c) |
| RCC.5.1–5.3 (RPC + guard + helper) | `0130` (1) + `0128` (1) | TR.14 + **TR.14f** |
| RCC.5.4–5.5 (computa antes de escribir) | `0130` (1) paso 7 | TR.20 (los números coinciden con los de antes) |
| RCC.5.6 (idempotencia) | `0130` (1) paso 6 | TR.14 |
| RCC.5.7 / 5.7.e (G1 y G2 no reconocibles) | `0130` (1) pasos 5 y 7-bis-α | **TR.14d (f)** y **TR.14d (G2)** |
| RCC.5.7.a–d (G3 reconocible) | `0130` (1) paso 7-bis + insert | TR.14d (a)(b)(c)(e) |
| RCC.5.8 (cotas) | `0130` (1) pasos 1 y 3 | TR.14 |
| RCC.5.9 (no muta datos) | ausencia de escrituras | **TR.14c** |
| RCC.5.10 / 5.10.a (masivo, 2 pasadas) | `use-reports.ts::closeAllAction` + la hoja | `campaignStateView` + capture 08 |
| RCC.5.11 (online-only) | `assertOnline` en `callRpcScalar` | — (patrón del módulo, ya testeado) |
| RCC.6.1–6.5 (reapertura) | `0130` (2) | TR.14 + **TR.16** (4) |
| RCC.7.1–7.2 (leer del snapshot) | cortocircuito en las 7 | **TR.12** + TR.20 |
| RCC.7.3 (no se endurece la lectura) | `has_role_in` en las 7 + status | TR.14 (`field_operator` lee) |
| RCC.7.4–7.5 (contrato intacto) | `CREATE OR REPLACE` | TR.1–TR.11 preexistentes verdes + `0129` (9) |
| RCC.7.6 / 7.6.a / 7.7 (`rodeo_campaign_status`) | `0130` (3) | TR.14d + `test('canClose=false …')` |
| RCC.8.1–8.4 (DL10) | ausencia de trigger + `has_new_data` | **TR.16** + capture 07 |
| RCC.9.1–9.4 (contrato §5) | `0129`/`0130` | TR.14 + **TR.21** + `0129` (9) |
| RCC.9.5–9.6.a (grants) | los 2 loops en `0128`/`0129`/`0130` | **TR.14b** + TR.10 (extendido) |
| RCC.9.7 (trigger definer) | `0127` (4) | TR.14g (por catálogo) |
| RCC.9.8 (carrera) | `on conflict` + `unique_violation` | TR.14 (cerrar dos veces → 1 fila) |
| RCC.9.9 (detalle no expuesto) | RLS de las 2 tablas | TR.14e + **TR.21** |
| RCC.9.10–9.11 (costo y piso de años) | G2 + §5.B W8 | TR.14d (G2) |
| RCC.9.12 (`member_name`) | `0130` (3) | (lectura del reviewer; `users` no se referencia) |
| RCC.10.1–10.3 (presentación) | `campaignStateView` + `CampaignStateBar` | 12 tests + captures 01/05/06 |
| RCC.10.4 (CCL congelado) | `reportes.tsx::cclMonths` | — (lectura; el dato lo prueba TR.20) |
| RCC.10.5 (sugerencia) | `campaignStateView` | `test('en curso con el ciclo completo')` + capture 02 |
| RCC.10.6 (masivo) | `CampaignCloseSheet` + `closeAllAction` | capture 08 |
| RCC.10.7 / .a / .b (confirmación) | `CampaignCloseSheet` | captures 03 y 04 |
| RCC.10.8 / 10.11 (sin permiso / a medias) | `campaignStateView` | `test('SIN permiso pero cerrada a medias')` + capture 09 |
| RCC.10.9 (tokens/es-AR/descendentes) | los 2 componentes | `assertTextNotClipped` × 8 en el capture |
| RCC.10.10 (no romper lo existente) | montaje aditivo | typecheck + capture (las cards siguen) |
| RCC.11.* (re-seed) | — | **T74, del leader** |
| RCC.12.1–12.2 (tacto sin jornada) | ausencia de `session_id` | **TR.17** (+ el TR.12 de spec 02) |
| RCC.12.3–12.4 (no tocar las otras) | no se tocaron | TR.7/TR.8/TR.9 verdes |
| RCC.12.5–12.6 (sin NaN / año vacío) | `safePercent` + membresía | TR.3 preexistente + TR.13 (f) |
| RCC.13.* (oráculos) | ver la columna "Verificado por" | ídem |
| RCC.14.1–14.2 (capture) | `campanas-congeladas.capture.ts` | 9 PNG generadas, 1 passed |

---

## 3. Qué queda ROJO, y por qué

### 3.1 `node scripts/check.mjs` → **FAIL en la suite de reportes** (esperado, roja-hasta-apply)

`scripts/run-tests.mjs:142` corre `supabase/tests/reports/run.cjs` contra la **DB remota**, y las migraciones
`0127`–`0130` **no están aplicadas** (las aplica el leader en T73). Es el patrón declarado del repo
(`0075-0082` / `0093-0097` / `0105-0106` / `0118`) y la spec lo dice en §6 y en la cabecera de los tasks. El
hook se deja **como está** (instrucción del leader).

**Medido** (`node --test supabase/tests/reports/run.cjs`): **17 pass / 19 fail** de **36** tras el
fix-loop (era 17/18 de 35; TR.14i es nuevo).

- **Los 17 verdes incluyen TODOS los preexistentes**: TR.1, TR.2, TR.3, TR.4, TR.4b, TR.5, TR.6, TR.7, TR.8,
  TR.9, TR.11, el **TR.12 del delta `ficha-categoria-tacto`** (spec 02, de la otra terminal) y los dos TR.10.
  O sea: **el cambio de `createAnimal` (`entry_date`) no rompió nada**, y los guards del delta que no dependen
  del apply (TR.17 y TR.19) ya corren en verde.
- **Los 18 rojos son todos del delta y todos por el apply que falta**, agrupados por causa:
  - `PGRST202 Could not find the function public.close_campaign(...)` → TR.12, TR.12b, TR.14, TR.14c, TR.14d,
    TR.16, TR.20, TR.21, TR.14h;
  - `Could not find the table 'public.rodeo_membership_history'` / `relation … does not exist` → TR.15,
    TR.14e, `cleanup`;
  - `is_owner_or_vet_of: existe` / `las 7 internas existen` / `las 3 tablas tienen su policy de SELECT` →
    TR.14f, TR.14g, TR.14b (asserts de catálogo sobre objetos que todavía no existen);
  - **`campaña ABIERTA: las 3 mutaciones de estado no mueven ningún KPI` (TR.12c) y `(a) el que entró DESPUÉS
    del corte no cuenta` (TR.13)**: estos dos fallan **porque el defecto todavía está vivo** — son la
    reproducción del probe, y son exactamente los que tienen que ponerse verdes con `0129`.

**Post-apply (T73) deben quedar 35/35.** Si alguno sigue rojo, no es "roja-hasta-apply": es un defecto.

### 3.2 Todo lo demás está VERDE

- `tsc --noEmit` (app): **0 errores**.
- Unit del frontend: `reports-format.test.ts` **66/66** (12 casos nuevos de `campaignStateView`).
- El resto de `check.mjs` hasta la suite de reportes: verde (lint, anti-hardcode, guards de clase, RLS, Edge,
  Animal, Maneuvers, puesta-en-servicio). Las suites **posteriores** al hook de reportes no llegan a correr
  porque `run-tests.mjs` aborta en la primera roja — no las toca este delta (ninguna migración aplicada).
- Capture del Gate 2.5: **1 passed**, 9 PNG en `app/e2e/captures/__shots__/campanas-congeladas/`, `design/**`
  sin re-renderizar (verificado con `git status design/`).

---

## 4. Mutantes (¿los oráculos saben fallar?)

> Un guard que pasa con el bug puesto no sirve. Los mutantes del **frontend** se ejecutaron de verdad (unit
> puro). Los del **backend** que dependen del apply **no se pueden ejecutar todavía** — para esos se
> ejercitó el **mecanismo** del oráculo contra el catálogo real, que es lo máximo observable hoy, y queda
> declarado como tal.

| # | Oráculo | Mutante inyectado | Esperado | **Resultado (ejecutado)** |
|---|---|---|---|---|
| **M1** | `campaignStateView`: sin `canClose` no se ofrece cerrar (N-3) | `primaryAction: 'close'` fijo | rojo | ✅ **2 tests en rojo** (`canClose=false con el ciclo incompleto` + `con el ciclo completo`) |
| **M2** | El aviso de "cerrada a medias" se muestra **sin** permiso (RCC.10.11) | gatear el aviso con `s.canReopen` | rojo | ✅ **rojo** (`SIN permiso pero cerrada a medias`) |
| **M3** | Los dos avisos conviven (a medias + datos nuevos) | `if (s.hasNewData && notices.length === 0)` | rojo | ✅ **rojo** (`los DOS avisos, uno por línea`) |
| **M4** | `missing` en es-AR con singular/plural | plural siempre | rojo | ✅ **rojo** (`missing enumera en es-AR`) |
| **M5** | TR.17: guard de clase "ninguna de las 7 referencia `session_id`" | mutante **por sustitución**: correr el mismo predicado sobre funciones que **sí** lo referencian | detecta | ✅ `rodeo_sessions_list` y `session_event_summary` → `true`; las 7 de campaña → `false`. El guard **ve** el síntoma. |
| **M6** | TR.19: guard de ausencia en `rafaq.yaml`, **case-insensitive** | agregar `SELECT * FROM RODEO_MEMBERSHIP_HISTORY` (mayúsculas) a una copia del YAML | detecta | ✅ **lo caza** en mayúsculas y en minúsculas |
| **M7** | TR.21: el **descubrimiento** de funciones del catálogo | correr la query de la spec contra el remoto | ≥ 8 hoy | ❌ **devolvió 0** → **defecto de la spec, corregido** (ver §5 R3). Con `oidvectortypes`: **8 hoy**, 9 post-apply. |
| **M8** | Orden **guard → cota → cortocircuito** en las 10 funciones + las 3 RPC | análisis posicional del `.sql` (guard vs `22023` vs `from public.rodeo_campaign_snapshots`) | orden correcto en todas | ✅ **13/13 OK**. *(Es una verificación estática mía, NO el oráculo: el oráculo es TR.21, conductual, y corre post-apply.)* |
| **M9** | `close_campaign` computa **antes** de escribir | análisis posicional (G1 → idempotencia → temporales → 5 KPI → G2 → G3 → insert cabecera → insert detalle) | orden correcto | ✅ **OK** |

**Los mutantes que NO se pudieron ejecutar** (dependen del apply): invertir el orden guard↔cortocircuito en una
de las 7 (lo mata TR.21a), invertir cota↔cortocircuito (TR.21b), sacar `ur.active = true` de
`is_owner_or_vet_of` (TR.14f(a)), un `grant insert` a `authenticated` en una tabla de snapshot (TR.14e), y
desalinear el `establishment_id` del detalle (TR.14h). **Quedan para el leader en T73**: si algún oráculo del
delta pasa a verde sin que su condición se cumpla, es un falso verde.

---

## 5. Reconciliación de specs (T71)

Detalle completo en `design-campanas-congeladas.md` **§15** (tabla R1–R11) + notas bajo `RCC.9.6.a`,
`RCC.13.5.d` y `RCC.13.5.e` + fila nueva en el "Historial de refinamiento" + notas as-built en T20, T42, T44,
T48-α, T48-ε y T64. Los **tres defectos de la spec que la implementación encontró al ejecutarla**:

- **R1 — las migraciones no aplicaban.** La lista blanca de §6-bis tenía 11 entradas, pero el barrido por
  `rodeo\_%` alcanza también a `rodeo_sessions_list(uuid)` y `rodeo_weight_by_category(uuid,uuid)`, que son
  públicas y están concedidas a `authenticated` (verificado en el catálogo del remoto) → el loop (1) las
  tomaba por internas y **abortaba `0128`, `0129` y `0130`**. Se agregan a la lista blanca (con
  `is_owner_or_vet_of`) y se suman los prefijos `close\_%`/`reopen\_%` al barrido, para que un typo en la
  lista no deje `close_campaign` fuera de **los dos** loops (el N-2 de Gate 1, un nivel más abajo).
- **R3 — el oráculo de Gate 1 H-1 no podía correr.** `pg_get_function_identity_arguments(oid)` devuelve
  `"p_rodeo_id uuid, p_year integer"` (**con** los nombres de los parámetros), así que la comparación con
  `'uuid, integer'` no matchea nunca: el descubrimiento daba **0** funciones, el piso `>= 9` quedaba rojo para
  siempre y **los dos oráculos de tenant/cota no se ejecutaban jamás**. Se resuelve con
  `oidvectortypes(p.proargtypes)`. Es `reference_function_recreate_base` aplicada al catálogo: lo que "dice"
  una función del catálogo se verifica **ejecutándola**.
- **R6 — la suite se ponía roja por el calendario.** Los fixtures no escribían `entry_date`, así que el
  trigger de `0127` abre la membresía **hoy** y los animales no pertenecen al rodeo en la fecha de corte de
  una campaña pasada: **TR.4b y TR.11** (que usan `lastYear`) se habrían puesto rojas post-apply sin ninguna
  regresión detrás. `createAnimal` ahora escribe `entry_date` (default: la fecha de nacimiento) y los
  escenarios del delta **retrodatan** además `animal_category_history.changed_at` — el mismo requisito que
  RCC.11.2/11.3 le piden al re-seed, un nivel más abajo.

Las otras 8 (R2, R4, R5, R7–R11) son de mecanismo y están en la §15.

---

## 6. Autorrevisión adversarial (T69)

**Qué busqué, qué encontré, cómo lo cerré.** Lo que encontré está **corregido y re-verificado**, no anotado
para después.

| Foco | Hallazgo | Cierre |
|---|---|---|
| (a) ¿el cortocircuito está **después** del guard y de la cota en las 7? | Sí en las 10 + las 3 RPC. Lo verifiqué **posicionalmente sobre el `.sql`**, no de memoria (M8). | — |
| (b) ¿`close_campaign` computa antes de insertar? ¿el gate F8 corre antes de la primera escritura? | Sí (M9): G1 → idempotencia → 4 temporales → 5 KPI → **G2** → **G3** → cabecera → detalle. | — |
| (c) ¿queda alguna copia de `last_tacto`, de la ventana de concepción o del predicado de ciclo? | `last_tacto` **solo** en `rodeo_campaign_tacto`; `interval '9 months'` **solo** en `rodeo_campaign_births` (+ la ventana de `calving_status`, que es otro concepto y RCC.3.8 dice que no cambia); el predicado de ciclo **solo** en `campaign_cycle_complete`. | — |
| (d) ¿alguna función de escritura quedó `STABLE` o sin `search_path`? | No. Además lo **verifican dos guards**: uno dentro de la migración (aborta el apply) y TR.14g desde la suite. | — |
| (e) ¿el `revoke`/`grant` de `close_campaign` usa `(uuid, int, boolean)`? | Se **deriva del catálogo** → la firma no puede quedar vieja. El `42883` deja de ser posible. | R2 |
| (f) ¿algún call site manda `acknowledge = true` sin confirmación explícita? | **No**: el único `true` literal está en el botón "Cerrar igual con estos datos incompletos", que solo se renderiza **después** de que el server rechazó el primer intento; el masivo con `true` solo aparece con `bulkResult.incomplete.length > 0`. Auditado con grep sobre `app/`. | — |
| **Smoke-check** | 🔴 **La migración abortaba** con la lista blanca de la spec. | R1 |
| **Oráculo de H-1** | 🔴 **Descubría 0 funciones** → el test de tenant del camino cerrado nunca corría. | R3 |
| **Fixtures** | 🔴 **TR.4b y TR.11 se habrían puesto rojas post-apply** por la membresía sembrada hoy. | R6 |
| **Tests que pasan por la razón equivocada** | (1) Los `insert` de TR.14e usaban payloads incompletos: un rechazo por `23502 not-null` se vería igual que uno por permisos → payloads **completos y válidos**. (2) Su regex aceptaba "no existe la tabla", así que habría quedado verde si alguien dropeaba una de las 3 → acotado a `42501 / permission denied / violates row-level` (las 3 tablas **sí** están en el schema cache: `authenticated` tiene SELECT). | corregido |
| **Contrafactual de TR.12c** | Sin retrodatar `animal_category_history`, `animal_category_at` cae en la degradación de RCC.2.7 (categoría **actual**) y el `cut` posterior **sí** habría movido el KPI → el test habría fallado por el motivo equivocado (y el próximo lo habría "arreglado" aflojando la aserción). | helper `backdateCategoryHistory` |
| **Concurrencia / carrera** | `on conflict … do nothing` + `exception when unique_violation` + re-`select`: dos cierres concurrentes devuelven el mismo snapshot. El índice único parcial lo hace estructural. | — |
| **NULL / vacío / límites** | `serviced = 0` → G2 (`23514`) y `safePercent` sin NaN; `service_months` NULL o `{}` → corte 31/12 y ventana = año calendario; `exit_date` nulo → `greatest(…, current_date)` (declarado); `to_date >= from_date` protegido con `greatest` en las 3 ramas que cierran (un `entry_date` futuro no puede violar el CHECK). | — |
| **Multi-tenant** | Ningún `establishment_id` hardcodeado: el tenant sale **siempre** de la fila del rodeo (`v_est`) o de la fila padre. Las 3 RPC nuevas no reciben `establishment_id`. | — |
| **Offline-first** | El cierre es online-only por diseño (DL9) y el `assertOnline` corre **antes** de la RPC. La carga de eventos de una campaña cerrada **no se bloquea** (DL10 = ausencia de código, testeada en TR.16): el peón cargó bien, la sincronización llegó tarde. El movimiento de rodeo sigue siendo un UPDATE plano que sube por la cola de CRUD. | — |
| **Guard de clase del repo** | `sheet-keyboard-dismiss-guard` cazó el sheet nuevo en el primer `check.mjs` (funcionó como fue diseñado). | `useDismissKeyboardOnOpen()` |

### Límites declarados (no promesas)

- **El `23514 → conflict` de `mapRpcError` no tiene unit test.** `services/reports.ts` importa `supabase` y el
  online-guard (React Native), así que no es cargable desde `node:test` — por eso ningún service de este
  módulo tiene unit. Está cubierto **de punta a punta** (el server emite `23514` en TR.14d; la UI decide por
  `canClose`/`cycleComplete`, no por el texto), pero el mapeo en sí lo verifica la lectura del reviewer.
- **Los hooks no tienen unit** (el repo no monta react-testing-library): `closeAllAction` y su clasificación
  reconocible/no-reconocible se verifican por lectura + el capture del resultado masivo.
- **`rodeo_campaign_calves` parte de `rodeo_campaign_births`** (distinct-on por madre): si una madre tuviera
  **dos** partos imputables a la misma campaña, `weaned`/`pending_weaning` cuentan solo las crías del primero.
  Declarado en el `comment on function` y en §15 R7.
- **El crear-o-truncar de las temporales** sigue el diseño auditado por Gate 1 (sin SQL dinámico). Riesgo
  residual conocido de plpgsql: un plan cacheado que referencie una temporal recreada. **Para T73**: si el
  segundo `close_campaign` de la misma sesión fallara con un error de plan cacheado, la salida es `execute`
  con un string **constante** (no hay input de usuario en la cadena).

---

## 7. Para el leader

1. **T73 (apply)**: `0127` → `0128` → `0129` → `0130`, en ese orden, y **parar** si una falla. Las tres
   migraciones con smoke-check abortan solas si algo quedó abierto. Post-apply: `node --test
   supabase/tests/reports/run.cjs` debe dar **35/35** (hoy 17/35). Si TR.12c o TR.13 siguen rojas, `0129` no
   quedó bien aplicada.
2. **T74 (re-seed)**: **no ejecutado** (es tuyo). Recordá N-1: la impersonación va **solo** en el paso de los
   dos `close_campaign`. Y medí el wall-time del cierre para foldearlo en §5.B W8.
3. **Gate 2.5**: las 9 capturas están en `app/e2e/captures/__shots__/campanas-congeladas/` (gitignored). El
   `.capture.ts` **sí** se commitea. `design/**` quedó sin tocar tras correr el build.
4. **Colisión de rótulo TR.12** con el delta `ficha-categoria-tacto` (spec 02, otra terminal): los dos
   conviven, los míos llevan "(campañas congeladas)" en el título. Si la otra terminal renumera, el header de
   la suite hay que actualizarlo.
5. **`feature_list.json`, `progress/current.md` y todo lo de la lista de exclusión**: sin tocar.


---
---

# FIX-LOOP de la Puerta 2 (2026-08-07)

**Input**: `progress/review_campanas-congeladas.md` (reviewer, **CHANGES_REQUESTED**) +
`progress/security_code_07-campanas-congeladas.md` (Gate 2, **FAIL**). Orden de ejecución: el bloqueante de
seguridad → los dos oráculos que pasaban por el motivo equivocado → la rama sin cobertura → el resto.
Sigue sin aplicarse ninguna migración y sin correr el re-seed.

## 8. Qué cerró cada finding, y con qué oráculo

| Finding | Qué se cambió | **Oráculo que lo cierra** |
|---|---|---|
| **H-C1** (Gate 2, HIGH) | `revoke all … from public, anon, authenticated` en las 3 tablas, **antes** de los `grant select` (`0127`, `0128`) + el `comment on column` reescrito: antes afirmaba "no existe grant de escritura a authenticated" —falso al momento del apply— y nombraba como guard a TR.14e, que **no puede ver un grant de TRUNCATE**. Ahora dice qué sostiene el invariante de verdad (los `revoke` explícitos) y que la condición del schema es general (35 tablas, barrido en `docs/backlog.md`). | **TR.14e**, bloque nuevo: `has_table_privilege` sobre las 3 tablas × {anon, authenticated} × {TRUNCATE, INSERT, UPDATE, DELETE} + `anon`/SELECT, **más** el control de no-vacuidad (`authenticated`/SELECT = true). Resuelve el **valor del ACL**, no el comportamiento por PostgREST. |
| **H-1** (reviewer, 🟠 — el único con impacto de usuario) | (a) `campaignStateView(null)` devuelve `badge: 'desconocido'` / `title: 'Campaña'` / sin fecha / sin acciones; (b) `CampaignStateBar` lo dibuja atenuado y con ícono propio; (c) el hint de la sección se calla igual; (d) **`useCampaignStatus` etiqueta el resultado con la clave `(rodeo, año)`** y lo descarta si cambió, así la etiqueta no sobrevive al cambio de año/rodeo (el `useReport` genérico **no se toca**: su anti-parpadeo es correcto para los números); (e) el test reescrito. | **3 tests unit** (`status null → NO afirma`, el control de no-vacuidad `un estado CONOCIDO nunca queda en desconocido`, y el de `canClose`) + **capture 10** (`10-campana-desconocida`, con asserts de ausencia de "Campaña en curso"/"Campaña cerrada"/detalle/botones). Mutante **M12** medido. |
| **H-2** (reviewer, 🟠) | `entry_date` propagado a `supabase/tests/puesta-en-servicio/run.cjs` (el otro consumidor, 13 call sites) + el comentario y el mensaje de TPS.15:645 reescritos: post-delta "sale del set serviced (membresía active)" es **falso** — lo que la saca es la membresía cerrada al corte, no `p.status`. | La **propia suite**: `node --test supabase/tests/puesta-en-servicio/run.cjs` → **11/11 verde** hoy, y deja de ser calendario-dependiente (sin el fix, roja desde el 1/12). **Tercer consumidor: NO hay** — medido con grep sobre todo el repo: solo `reports` y `puesta-en-servicio` invocan las 7. |
| **H-3** (reviewer, 🟠) | La rama `ai_females` deja de estar cubierta solo por una aserción inversa. | **TR.13(g)**: una **ternera** (no elegible por categoría ni por el fallback de edad → su único camino es la IA) entra con `source = 'ai'`, y sus dos contrafactuales históricos (entró al rodeo después del corte / salió antes) **no** entran. **TR.20**: el detalle congela la mezcla real (3 `natural` + 1 `ai`) en vez del `every(source === 'natural')`. |
| **H-4** (reviewer, 🟡) | En vez de declarar la ventana, se cierra: `close_campaign` cuenta las filas del detalle recién insertadas y las compara con los 5 números de la cabecera; si difieren **aborta con `40001`** y no queda snapshot. La spec (§2.4, RCC.4.7, §5.C) queda diciendo lo que el código hace. | El **propio `close_campaign`** (fail-closed en tiempo de escritura, que es más fuerte que un test sobre un fixture quieto) + la fila nueva de `40001` en el contrato de errores. |
| **H-5** (reviewer, 🟡) | Tercer loop en `0130`: **cada nombre de la lista blanca tiene que resolver a ≥1 función**. Es el único hueco real (un typo en un nombre sin prefijo —hoy `is_owner_or_vet_of`— escapaba a los dos loops). El loop (2) queda con un comentario que dice **qué es**: verificación del estado final, no un oráculo independiente. | El **smoke-check de `0130`**, fail-closed: aborta el apply. |
| **H-6** (reviewer, 🟡) | **RCC.5.11** → guard de cableado nuevo; **RCC.10.4** → función pura `campaignCclMonths`; **RCC.4.6/7.2** → borrado real de un perfil en TR.20; **RCC.9.12** → assert textual rotulado; **RCC.9.8** → carrera real; **RCC.11.10** → dos cierres en una transacción. **RCC.1.13** y los 3 de UI quedan **declarados** como límite en `design` §15.2, con el motivo. | `reports-online-guard.test.ts` (4 tests, registrado en `run-tests.mjs`) · 3 tests de `campaignCclMonths` · TR.20 (fila huérfana con `idv` congelado + `animal_profile_id` nulo) · TR.14g (cuerpo de `rodeo_campaign_status`) · **TR.14i** (carrera con `Promise.all` + dos cierres en una transacción con `rollback`). |
| **H-7** (reviewer, 🟡) | Caso de `closedAt` con la forma real del contrato (`timestamptz` con hora). | Test unit con la expectativa **computada** con getters locales (hardcodear `14/03/2026` sería verde en AR y rojo en un runner UTC). |
| **M-C1** (Gate 2) | El `comment on table` de `0127` decía "no sincroniza porque no está en el YAML". Reescrito con el texto de `0124`: la publicación es **FOR ALL TABLES**, las filas **sí** cruzan al slot, y la frontera de devices son las **sync streams**. | **TR.19** suma el assert de `puballtables = true`: si esa premisa cambia, el comentario se pone rojo. |
| **M-C2** (Gate 2) | El smoke-check barre por **`oid`** en vez de por `proname` en las 3 migraciones. | Los mismos dos loops, ahora sobre funciones y no sobre nombres. |
| **M-C3** (Gate 2) | Los 3 comentarios que afirmaban "nace con `EXECUTE` a `PUBLIC`" — cierto para Postgres, **falso en esta base**. | **Medido** (`pg_default_acl`, objtype `f`, ns `public`, creador `postgres`): `postgres=X/postgres`, o sea **sin `PUBLIC`**. Texto corregido en `0128` (×2) y `0130`. |

## 9. Mutantes nuevos (todos EJECUTADOS)

| # | Oráculo | Mutante | **Resultado medido** |
|---|---|---|---|
| **M8** | `reports-online-guard`: los helpers chequean conexión antes del fetch | sacarle el `assertOnline` a `callRpcScalar` | ✅ **rojo** (`cada helper que llama a supabase.rpc chequea la conexión ANTES`) |
| **M9** | ídem: ningún wrapper se saltea el helper | `reopenCampaign` llamando `supabase.rpc` directo | ✅ **2 rojos** (el barrido + el control de no-vacuidad) |
| **M10** | (control) baseline tras revertir M8/M9 | — | ✅ **4/4 verde** |
| **M11** | TR.14e: el assert de ACL crudo | **por sustitución**: el mismo predicado contra `animal_category_history` (el molde, **sin** `revoke`) y contra `user_private` (**con** `revoke`, `0068:208`) | ✅ **sabe fallar**: molde → `anon=Dxtm`, `authenticated=rDxtm` (TRUNCATE **true** en los dos) · `user_private` → sin entrada de `anon` (**false**). Dato útil: `user_private` igual da `auth_trunc = true` porque `0068` revocó solo de `anon, public` — **el `revoke` de este delta es más estricto que su precedente**. |
| **M12** | `campaignStateView(null)` no afirma | volver a `badge: 'en-curso'` / `title: 'Campaña en curso'` | ✅ **rojo** |
| **M13** | `campaignCclMonths` | escribirlo como el `??` encadenado original | ✅ **2 rojos** (incluido el caso `cerrada con serviceMonths NULL`, que es el bug real que había en la pantalla) |
| **M14** | Gramática de `GRANT ... ON FUNCTION f(argname argtype)` — el **A-4 "leído, no ejecutado"** del Gate 2, que si estaba mal mataba el apply en T73 | probe transaccional contra el remoto: `begin; grant execute on function public.rodeo_pregnancy_kpi(p_rodeo_id uuid, p_year integer) to authenticated; rollback;` | ✅ **ACEPTADO por el parser**. El grant elegido ya estaba vigente y va dentro de `begin/rollback`: privilegio medido **antes y después** = `true` en los dos → **delta de estado 0**. A-4 deja de ser una incógnita. |

**Siguen sin poder ejecutarse** (dependen del apply, y son la lista que T73 tiene que medir): invertir
guard↔cortocircuito y cota↔cortocircuito en una de las 7 (TR.21a/b), sacar `ur.active` de
`is_owner_or_vet_of` (TR.14f(a)), un `grant insert` a `authenticated` en una tabla de snapshot (TR.14e) y
desalinear el `establishment_id` del detalle (TR.14h). Se suman dos más de este loop: sacar el `revoke all`
de una tabla (TR.14e ACL) y romper el crear-o-truncar de las temporales (TR.14i(b)).

## 10. Autorrevisión adversarial del fix-loop

| Qué busqué | Qué encontré | Cómo lo cerré |
|---|---|---|
| **¿Mis propios arreglos rompen algo?** | 🔴 **Sí, y era grave**: al cambiar el barrido a `oid`, el reemplazo del loop (0) **no matcheó en `0129` ni en `0130`** (su texto difería), así que `v_oids` quedaba **vacío** en dos de las tres migraciones → el loop (1) habría marcado como internas a **todas** las públicas del namespace y **`0129`/`0130` abortaban en el apply**. Lo cacé verificando el resultado del edit en vez de asumirlo. | Loop (0) corregido en las dos + verificación estructural: las 3 migraciones tienen 1 recolección y 2 usos de `v_oids`. |
| **¿El caso IA realmente entra?** | 🔴 La primera corrida murió con `maneuver gated: rodeo … is missing enabled data_keys {inseminacion}`: sin habilitar el `data_key` (gating de `0054`) el evento de IA **no se puede insertar**, así que el oráculo de H-3 no se ejercitaba. | Helper `enableDataKey` (mismo procedimiento que la otra suite) en los dos sitios que siembran IA. Re-corrido: el error desapareció. |
| **¿El assert de ACL nuevo sabe fallar?** | Verificado por sustitución (M11) contra dos tablas reales, una con `revoke` y otra sin. | — |
| **¿El `40001` puede disparar de más?** | Solo corre en el camino de creación (después de los 5 `insert`), nunca en el idempotente ni en el de carrera resuelta. Si dispara, la excepción propaga y la transacción entera se va: **no queda snapshot a medias**. | — |
| **¿Rompí la suite del otro consumidor?** | No: `puesta-en-servicio` **11/11 verde** después del cambio de `entry_date`. Revisé además que ningún fixture suyo esté en el borde de los 365 días (las <365 son `ternera`, que no pasa por el fallback de edad). | — |
| **¿Rompí lo que otra terminal tiene sin commitear?** | `scripts/run-tests.mjs`: agregué mi guard **sobre la versión en disco**, así que sus entradas (`category-pin`, `ficha-tacto-offer`, `category-pin-core`) siguen ahí — verificado. `reportes.tsx` conserva el `useStickStatusSurface('screen-band')`. | — |
| **¿Algún test nuevo pasa por la razón equivocada?** | TR.14i(a) (la carrera) **puede** pasar sin haber interleaveado: es probabilístico. Va **declarado en el propio test**, y el assert que importa (una sola foto vigente) es sobre el estado final, así que no puede dar un falso verde silencioso. | Declarado en el test y en `design` §15-bis R20. |
| **¿El probe de gramática dejó estado?** | Privilegio medido antes y después: idéntico. El `grant` elegido ya estaba vigente **y** va dentro de `begin/rollback`. | — |

## 11. Estado final (medido, tras el fix-loop)

- **Unit del frontend**: `3030/3030` verde (la lista completa de `run-tests.mjs`, con los 4 tests del guard
  nuevo y los 5 de `campaignStateView`/`campaignCclMonths` agregados en este loop).
- **`tsc --noEmit`**: 0 errores. **Anti-hardcode**: 0 violaciones.
- **`supabase/tests/puesta-en-servicio/run.cjs`**: **11/11 verde**.
- **`supabase/tests/reports/run.cjs`**: **17 pass / 19 fail** de 36 — **roja-hasta-apply**, y **las 19
  siguen siendo todas atribuibles al apply que falta** (verificado una por una: función/tabla inexistente,
  asserts de catálogo sobre objetos ausentes, y TR.12c/TR.13 que fallan porque el defecto está vivo). Ningún
  rojo nuevo del fix-loop.
- **Capture**: **10 estados**, 1 passed, `design/**` sin re-renderizar (verificado con `git status design/`).
- **`node scripts/check.mjs`**: sigue en exit 1 por la suite de reportes (patrón declarado). El reviewer
  además midió un flake de rate-limit en la suite Edge, ajeno al delta.


---
---

# SEGUNDO FIX-LOOP (2026-08-07) — RR-1, el ⚪ de §2.4, y una premisa de las dos puertas que era falsa

## 12. RR-1 — el "arreglo" del M-C2 era un no-op, y el comentario lo negaba

El reviewer tiene razón y el diagnóstico es exacto: el loop (0) seguía **seleccionando por `proname`**, y de
esas mismas filas salía `v_oids`, así que `p.oid = any (v_oids)` era **idénticamente equivalente** a
`p.proname = any (v_public)`. Barrer por `oid` no cambiaba nada, y el comentario afirmaba *"y con esto tampoco
puede aparecer"*. Tercera vez en esta unidad que un texto promete lo que el código no sostiene — y esta la
escribí yo.

**Lo que quedó**: la lista blanca **enumera FIRMAS**, no nombres, y cada entrada se resuelve con
`to_regprocedure('public.' || firma)` al `oid` de esa función exacta. El `revoke`/`grant` se emite con `%s`
sobre `regprocedure` (la función ya identificada por el catálogo), así que ni siquiera depende de la gramática
de nombres de parámetro que M14 tuvo que ir a medir. Una sobrecarga tiene otra firma → no está en `v_oids` →
si alguien le concede `EXECUTE`, cae en el barrido de internas y **la migración muere**.

**El mutante, medido** (`begin; create function public.rodeo_serviced_females(uuid,integer,uuid); grant
execute … to authenticated; <los dos barridos>; rollback;`):

| Forma de la lista blanca | Filas que detecta con la sobrecarga concedida |
|---|---|
| por **NOMBRE** (la vieja, y la del "arreglo" equivalente) | **0** — invisible |
| por **FIRMA** (la nueva) | **3** (la sobrecarga, una fila por rol) |

Delta de estado del probe: **0** (medido antes/después; el DDL en Postgres es transaccional y además se emite
`drop function if exists` antes del `rollback`).

## 13. Una premisa que las DOS puertas dieron por verificada, y es FALSA

Gate 2 (**M-C3**) concluyó que en esta base *"las funciones nuevas NO nacen `EXECUTE`-ables por `PUBLIC`"*, y
el reviewer lo ratificó al auto-corregirse en H-5 (*"el hueco del typo era de disponibilidad, no de
exposición"*). **Yo lo apliqué a los comentarios de tres migraciones sin medirlo.** Es exactamente el error
que este repo castiga: tomar un "verifiqué" ajeno como medición propia.

**Medición directa** — crear una función sin ningún `grant`/`revoke`, dentro de `begin/rollback`:

```
quien_crea = postgres
proacl     = NULL          ← default built-in de Postgres
public_x   = TRUE   anon_x = TRUE   auth_x = TRUE
```

El `pg_default_acl` de `postgres` sobre funciones de `public` (`postgres=X/postgres`) **suma** privilegios; no
revoca el `EXECUTE` a `PUBLIC` del built-in. Las dos puertas infirieron el default mirando funciones cuyo ACL
era `postgres=X/postgres` — que son funciones a las que **su propia migración ya les hizo el `revoke`**:
inferir el default desde objetos modificados, que es la misma clase de error que el Gate 1 se marcó a sí mismo
con `0021`.

**Qué cambia** (no es una nota de color):

1. Los `revoke execute … from public, anon, authenticated` de las **7 internas** (4 en `0128`, 3 en `0129`) son
   **LOAD-BEARING**: sin ellos, `campaign_tacto_bounds`, `animal_category_at`, `campaign_cycle_complete`,
   `campaign_missing_summary`, `rodeo_campaign_tacto`, `_births` y `_calves` quedan **invocables por `anon`**
   desde PostgREST. No son "no-ops correctos" como yo había escrito.
2. El `revoke … from public, anon` del loop (0) es load-bearing para las 3 RPC nuevas — incluida
   `close_campaign`, que es de **escritura**.
3. El hueco del typo de H-5 era **de exposición**, no de disponibilidad.
4. El loop (2) verifica una propiedad real.

Los tres comentarios quedaron con la medición escrita. `design` §15-bis **R16 pasa a "RETIRADO: la premisa del
gate era falsa"**.

## 14. El ⚪ — §2.4 ya no promete de más

El `40001` garantiza **identidad de CONTEO por bucket contra los cinco números de la cabecera, verificada
antes del commit**. §2.4 ahora declara explícitamente lo que **no** garantiza: (a) no es identidad de
**conjunto** (en la misma ventana podría entrar un vientre y salir otro con el conteo intacto); (b) no cruza
**cabecera↔cabecera** (`ccl_total` vs `pregnant`, `born_total` vs `calved` — que además **no** son iguales por
diseño: `rodeo_calving_by_stage` devuelve 0 con `n_months < 2` o `>= 12`). Subir la garantía exige el único
cómputo interno que §5.B W8 ya deja anotado para después de la medición de T74.

## 15. Validación de los tres bloques `DO` contra el catálogo real (sin aplicar nada)

Cada bloque de smoke-check corrido **solo**, dentro de `begin; … rollback;` — los `revoke`/`grant` que emite
son sobre grants ya vigentes, y el rollback los deshace igual:

| Bloque | Resultado | Qué prueba |
|---|---|---|
| `0128` | **OK, no aborta** | El plpgsql compila, la lista por firma resuelve, y el barrido **no tiene falsos positivos** que matarían el apply |
| `0129` | **OK, no aborta** | ídem |
| `0130` | **ABORTA**, y nombra `close_campaign(uuid,integer,boolean)`, `reopen_campaign(uuid,integer)`, `rodeo_campaign_status(uuid,integer)`… | **El loop (3) funciona**: las 3 RPC nuevas todavía no existen. Post-apply existen y no aborta. Es el fail-closed de H-5 **medido**, no argumentado |

Delta de estado: **0** (huella de ACL antes/después idéntica).

## 16. Mutantes de este loop

| # | Oráculo | Mutante | Resultado medido |
|---|---|---|---|
| **M15** | Barrido de internas vs. sobrecarga de una pública | crear `rodeo_serviced_females(uuid,integer,uuid)` + concederla a `authenticated` | ✅ lista por **NOMBRE**: 0 detecciones · lista por **FIRMA**: 3. El agujero era real y ahora está cerrado |
| **M16** | La premisa "las funciones nuevas no nacen PUBLIC-ejecutables" | crear una función limpia y leer su `proacl` | ✅ **premisa refutada**: `proacl = NULL`, `public_x = anon_x = auth_x = true` |
| **M17** | Los 3 bloques `DO` del smoke-check | correrlos contra el catálogo real en `begin/rollback` | ✅ `0128`/`0129` limpios · `0130` **aborta nombrando las firmas ausentes** (loop 3 funcionando) |

## 17. Autorrevisión final

| Qué busqué | Resultado |
|---|---|
| ¿El arreglo de RR-1 es un arreglo o volví a mover el mismo predicado? | **Medido** con M15: 0 vs 3. Es un cambio de comportamiento, no de forma. |
| ¿La lista por firma introduce falsos positivos que aborten el apply? | **No**: M17 corre los bloques contra el catálogo real y `0128`/`0129` pasan limpios. `0130` aborta solo por las funciones que todavía no existen. |
| ¿Las firmas están bien escritas? | Las 14 resueltas contra el remoto una por una: las 10 que existen hoy resuelven exactamente; las 4 del delta dan `null` (esperado). Y si alguna estuviera mal escrita, la función real caería en el barrido y **el apply abortaría** — fail-closed. |
| ¿Quedó algún texto afirmando lo que el código no hace? | Barrí las 4 migraciones: la premisa del `PUBLIC` (corregida con la medición), la cita de `0068` (acotada: revoca de `anon, public`, **no** de `authenticated` — el `revoke` de este delta es más estricto que su precedente), el comentario del loop (2) (dice que verifica el estado final, no que sea un oráculo independiente) y §2.4 (dice qué garantiza el `40001` y qué no). |
| ¿Toqué algo de las otras terminales? | No. El diff sigue acotado a mis 13 archivos + los 8 nuevos. |
| ¿Cambió el estado de las suites? | Este loop tocó **solo** migraciones y specs: unit **3030/3030**, typecheck 0, anti-hardcode 0, `puesta-en-servicio` 11/11 y `reports` 17/36 (roja-hasta-apply) siguen igual. |

**Para T73**: si `0130` aborta con *"la lista blanca nombra funciones que NO existen"* después del apply de las
cuatro, no es un falso positivo — es que alguna de las 3 RPC no se creó.


---
---

# GATE 2.5 — veto visual (2026-08-07)

## 18. Los tres arreglos

| # | Qué estaba mal | Qué quedó | Oráculo |
|---|---|---|---|
| **1** 🟠 | Tras el rechazo del server, el **primario** seguía siendo `onConfirm(false)` — el que acababa de ser rechazado y estaba garantizado que volvía a fallar—, pegado al reconocimiento y con un label que **empieza con la misma palabra**. El control de más peso visual y mejor target de Fitts era el único que no podía funcionar. | Los controles salen de **`campaignCloseActions`** (pura, en `reports-format.ts`); el `.tsx` mapea `kind` → variante y nada más. Con `acknowledgeAvailable`: el intento sin reconocimiento **desaparece**, **no queda ningún primario**, y arriba del bloque va la explicación del rechazo. | **5 tests unit**, uno de ellos barriendo el espacio de estados (`acknowledgeAvailable` × `rodeoCount` × `incompleteCount`): ninguna acción con `acknowledge === true` puede ser primaria, y con `acknowledgeAvailable` la lista de primarios es **vacía**. + el capture asserta `campaign-confirm-primary` con `toHaveCount(0)`. |
| **2** 🟠 | "Reabrir campaña" era un botón de contorno a ancho completo: el elemento interactivo más grande sobre una campaña cerrada. La tarjeta decía "esto es una foto que no se mueve" y titulaba el deshacer. | Acción de **texto**, alineada a la derecha, con target real (`$chipMin` 40 + `hitSlop` 8). "Cerrar campaña" sigue siendo botón: la asimetría es deliberada (cerrar es lo que la app sugiere; reabrir es la salida de emergencia). | Capture: alto del target **≥ 40** y **< la mitad** del alto de la tarjeta. |
| **3** 🟡 | (a) Recuadro con borde dentro de una tarjeta con borde, los dos terracota. (b) Sospecha de que el detalle leía como color de alerta. | (a) El aviso pierde el borde propio. (b) **Medido**: el detalle es un gris-verde neutro, no de la familia del terracota; lo que leía como alerta era el chrome duplicado de (a). | El capture **mide el contraste** (título/detalle/aviso) y falla por debajo de 4,5:1. |

## 19. Contraste — números MEDIDOS sobre el render real (412×915, `getComputedStyle`)

| Elemento | Color | Fondo | Tamaño | Contraste | AA (4,5:1) |
|---|---|---|---|---|---|
| Título de la barra | `rgb(15,14,12)` (`$textPrimary`) | `rgb(248,246,241)` (`$surface`) | 16 px | **17,86:1** | ✔ |
| Detalle "Foto del 14/03/2026 · la cerró Facundo" | `rgb(92,101,95)` (`$textMuted`) | `rgb(248,246,241)` | 13 px | **5,58:1** | ✔ |
| Aviso "Se cerró con 2 preñadas sin parir…" | `rgb(23,23,23)` | `rgb(250,249,249)` (`$bg`) | 16 px | **17,06:1** | ✔ |

Cálculo cruzado offline sobre los tokens (misma fórmula WCAG 2.1): `$textMuted` sobre `$surface` = 5,58:1 —
coincide con lo medido en el navegador— y **`$textFaint` sobre `$surface` = 3,92:1**, que es el token que
**no** se usa acá y el caso que el repo ya se comió una vez. Por eso la medición quedó como assert
permanente del capture y no como una nota.

## 20. Mutantes de este loop

| # | Oráculo | Mutante | Resultado medido |
|---|---|---|---|
| **M18** | "Tras el rechazo no queda primario" | devolver `kind: 'primary'` para `close-ack` | ✅ **rojo** (2 tests: el del caso y el que barre el espacio de estados) |
| **M19** | "El intento que falló desaparece" | seguir emitiendo `close` con `acknowledgeAvailable` | ✅ **rojo** (unit) + el capture (`toHaveCount(0)`) |
| **M20** | Contraste AA del detalle | pasar el detalle a `$textFaint` | ✅ **rojo**: 3,92:1 < 4,5 — el assert nuevo del capture lo caza |

## 21. Autorrevisión

- **La segunda pasada del masivo cambió de forma y lo verifiqué**: con `incompleteCount > 0` ya no se re-ofrece
  "Cerrar los 4 rodeos del campo" (3 ya están cerrados; re-ofrecerlo era ofrecer trabajo ya hecho). El capture
  08 se actualizó para assertar la **segunda** pasada, y el label ganó singular es-AR ("Cerrar igual **el
  rodeo incompleto**", no "los 1 incompletos").
- **El mecanismo de dos pasos no se tocó**, como pediste: el reconocimiento sigue apareciendo **solo** después
  de un rechazo real del server, y sigue viajando explícito hasta la RPC.
- **Lo que NO cambié y podría discutirse**: "Cerrar campaña" en la barra sigue siendo botón secundario a ancho
  completo. Es intencional (D1: la app *sugiere* cerrar cuando el ciclo termina) y el veto solo objetó la
  jerarquía de *reabrir*.
- Capturas regeneradas: **10/10**, capture verde, `design/**` sin re-renderizar.
