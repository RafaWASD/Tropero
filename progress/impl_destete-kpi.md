baseline_commit: 6adb820a57934271dd683ae0fe81ac2125fb1dd3

# impl — Delta %DESTETE: RPC nueva `rodeo_weaning_kpi` (#10) — spec 07

**Feature**: delta Nivel B (ADR-028) sobre spec 07 (`done`) · CON BACKEND (RPC NUEVA `rodeo_weaning_kpi`) · Gate 1 PASS · Deploy autorizado (leader aplica la `0118` por MCP).
**Molde**: delta #8 (%parición, `0117_calving_kpi_status.sql` / `calvingCardView`) — #10 es análogo, un paso más adelante (servida → parto → cría → **destete**).

## Plan (T1..T22)
- Bloque A (migración 0118): T1 verificar RPC inexistente · T2 firma+guard · T3 denominador Stream A · T4 `weaned` · T5 `pending_weaning` · T6 `status` · T7 revoke/grant/smoke-check/notify · T8 solo esta RPC.
- Bloque B (tests backend): T9 TR.11 · T10 extender TR.10 (grants + read-only).
- Bloque C (frontend datos+pura): T11 `weaningCardView` + tipos · T12 `fetchWeaningKpi` · T13 hook · T14 test unit REAL de `weaningCardView`.
- Bloque D (pantalla+spike): T15 `ReproSection` card Destete · T16 spike variantes · T17 anti-recorte/es-AR/tokens.
- Bloque E (capture): T18 `destete-kpi.capture.ts` · T19 correr (leader en Gate 2.5).
- Bloque F (cierre): T20 autorrevisión + mapa RWK→test · T21 reconciliación · T22 deploy (leader).

## Tasks (tasks-destete-kpi.md)
- [x] T1–T8 — migración `supabase/migrations/0118_weaning_kpi.sql` (RPC nueva, guard/cota/denominador Stream A, `weaned`/`pending_weaning`, `status` con precedencia, revoke/grant/smoke-check/notify, SOLO esta RPC).
- [x] T9 — TR.11 en `supabase/tests/reports/run.cjs` (todos los estados + weaned/pending + wrap + mellizos + imputación por campaña + IDOR + cota p_year + P0002).
- [x] T10 — TR.10 extendido: `rodeo_weaning_kpi` en el array anon-no-ejecuta (10 RPC) + llamada read-only.
- [x] T11 — `weaningCardView` + `WeaningStatus`/`WEANING_STATUSES`/`asWeaningStatus`/`WEANING_PENDING_LEGEND`/`WeaningCardView` en `app/src/utils/reports-format.ts`.
- [x] T12 — `WeaningKpi`/`WeaningRow`/`fetchWeaningKpi` en `app/src/services/reports.ts`.
- [x] T13 — `weaning` en `RodeoKpis` + `weaningFetcher` en `app/src/hooks/use-reports.ts`.
- [x] T14 — 9 tests REALES de `weaningCardView`/`asWeaningStatus` en `app/src/utils/reports-format.test.ts` (ejercen la fn de verdad — ver autorrevisión (a)).
- [x] T15 — card de Destete (2º `KpiRow` full-width) + leyenda D4 + reloads en `app/app/(tabs)/reportes.tsx`.
- [x] T16 — variantes `destete-*` + `DesteteVariant` en `app/app/reportes-spike.tsx`.
- [x] T17 — anti-recorte/es-AR/tokens (reusa `KpiCard`/`InfoNote`, cero hardcode — check --fast 0 violaciones).
- [x] T18 — `app/e2e/captures/destete-kpi.capture.ts` (5 estados + anti-recorte).
- [ ] T19 — correr el capture → **LEADER, Gate 2.5** (usa el spike MOCK, NO depende del apply de 0118).
- [x] T20 — autorrevisión (abajo) + este mapa.
- [x] T21 — reconciliación (design §5.1; no cambia contrato — ver abajo).
- [ ] T22 — aplicar `0118` por MCP + correr la suite verde → **LEADER**.

## Mapa RWK.<n> → archivo:test
| RWK | Cubierto por |
|---|---|
| 1.1 contrato 5 cols | `0118_weaning_kpi.sql` (returns table) · `run.cjs` TR.11 (lee las 5) |
| 1.2 serviced de Stream A | `0118` (`v_denom.serviced`) · TR.11 (asserts `serviced`) |
| 1.3 %destete >100% (mellizos) | `reports-format.test.ts` "ok con %>100%" · TR.11 mellizos (`weaned>serviced`) |
| 1.4 serviced=0 sin NaN | `reports-format.test.ts` "ok con serviced=0 → —" · TR.11 no_service_months `weaned=0` |
| 2.1 weaned imputado (ventana) | `0118` weaned query · TR.11 ok/wrap + "outside" (fuera no aporta) |
| 2.2 por AÑO DE SERVICIO | TR.11 ok/wrap (weaning en `lastYear+1`, `p_year=lastYear` → `weaned=1`) |
| 2.3 crías DISTINCT | `0118` `count(distinct)` · TR.11 mellizos (2 crías distinct) |
| 2.4 excluye borrados | `0118` `deleted_at` filters · TR.11 soft-delete del weaning → vuelve a pending |
| 3.1 pending_weaning | `0118` pending query · TR.11 transiciones pending |
| 3.2 not_weaning_season (weaned=0) | `0118` status · TR.11 nws |
| 3.3 card "todavía no empezó" | `reports-format.test.ts` not_weaning_season |
| 3.4 card % + detalle | `reports-format.test.ts` ok |
| 4.1 leyenda D4 | `reports-format.test.ts` "ok con pendingWeaning>0" · `reportes.tsx` `wv.legend` |
| 4.2 sin leyenda | `reports-format.test.ts` (ok sin leyenda / not_weaning_season) |
| 5.1 no_service_months | `0118` status · TR.11 NULL/`{}` |
| 5.2 not_applicable_12m | `0118` status · TR.11 12m |
| 5.3 precedencia | `0118` elsif chain · TR.11 12m (weaned=0 → not_applicable_12m, no not_weaning_season) |
| 5.4 card no_service_months | `reports-format.test.ts` no_service_months |
| 5.5 card not_applicable_12m | `reports-format.test.ts` not_applicable_12m |
| 6.1 SECURITY DEFINER STABLE search_path | `0118` fn definition |
| 6.2 tenant + 42501 | `0118` guard `has_role_in` · TR.11 IDOR |
| 6.3 cota p_year 22023 | `0118` · TR.11 `badYear` (1800) |
| 6.4 rodeo inexistente P0002 | `0118` · TR.11 `ghostR` |
| 6.5 revoke/grant/smoke-check | `0118` revoke+grant+`do$$` · `run.cjs` TR.10 grants (anon no ejecuta) |
| 6.6 solo esta RPC | `0118` (una sola fn) · grep verificado (T1) |
| 7.1 fetchWeaningKpi + tipo | `reports.ts` `fetchWeaningKpi` · `use-reports.ts` `weaning` |
| 7.2 weaningCardView pura | `reports-format.ts` · `reports-format.test.ts` (9 tests) |
| 7.3 card en pantalla | `reportes.tsx` ReproSection Destete KpiRow |
| 7.4 tokens/es-AR/anti-recorte | `reportes.tsx`/`reportes-spike.tsx` (reusa KpiCard/InfoNote) · capture `assertTextNotClipped` |
| 7.5 no rompe otras secciones | `reportes.tsx` (KpiRow nuevo, no toca gates) · typecheck limpio |
| 8.1 capture 5 estados | `destete-kpi.capture.ts` |
| 8.2 anti-recorte capture | `destete-kpi.capture.ts` `assertTextNotClipped` |
| 9.1–9.7 backend no-bypass | `run.cjs` TR.11 (+ TR.10 grants/read-only) |

## Verificación (sin la migración aplicada)
- `cd app && pnpm typecheck` → **limpio** (0 errores).
- Unit `reports-format.test.ts` → **51 pass / 0 fail** (antes 42; **+9** tests nuevos de `weaningCardView`/`asWeaningStatus` que ejercen la fn de verdad — el número SUBE).
- `node scripts/check.mjs --fast` → **0 violaciones** anti-hardcode; entorno listo.
- `node -c supabase/tests/reports/run.cjs` → sintaxis OK.

## Qué queda ROJO-HASTA-APPLY (para el leader)
- **`supabase/tests/reports/run.cjs` TR.11** falla hasta que el leader aplique `0118` (la RPC `rodeo_weaning_kpi` no existe aún → cada `clientA.rpc('rodeo_weaning_kpi', ...)` da error). TR.1–TR.10 siguen verdes (0106 ya aplicada); TR.10 read-only llama a `rodeo_weaning_kpi` pero ignora su error (solo cuenta filas). Post-apply de `0118` → TR.11 verde.
- **El capture `destete-kpi.capture.ts` NO es rojo-hasta-apply**: usa el spike MOCK (`?variant=destete-*`), no la RPC. El leader lo corre en Gate 2.5 sin esperar el deploy (revertir `design/**` si el build re-renderiza PNGs — `reference_e2e_design_png_rerender`).
- NO corrí la reports suite ni el capture (per instrucción). NO apliqué la migración (la aplica el leader por MCP tras Gate 1+reviewer+Gate 2+Gate 2.5).

## Autorrevisión adversarial (paso 8)
Releído el SQL + frontend + tests como revisor hostil. Qué busqué y qué encontré:
- **(a) ¿`weaningCardView` testeada de verdad (lección #8)?** SÍ. `reports-format.test.ts` tiene 9 tests nuevos que INVOCAN `weaningCardView`/`asWeaningStatus` con asserts reales sobre `value`/`detail`/`note`/`legend`/`muted` (ok con %, leyenda D4, %>100% mellizos, serviced=0, los 4 estados, kpi=null, normalizer). El total subió 42→51. No hay import muerto: la fn se ejerce.
- **(b) ¿revoke de la RPC nueva?** SÍ. `0118` tiene `revoke execute ... from public, anon` + `grant ... to authenticated` + `do$$` smoke-check que hace `raise exception` (ROLLBACK) si quedó EXECUTE-able por anon/public. Testeado por TR.10 (anon no ejecuta). Match 1:1 con `0117`.
- **(c) ¿JOIN weaned/pending correcto?** SÍ. `count(distinct bc.calf_profile_id)` (crías, no eventos → mellizos suman, RWK.2.3); `b.deleted_at is null` (parto) + `w.deleted_at is null` (weaning) excluyen borrados (RWK.2.4); ventana `extract(year/month from event_date - 9mo) = p_year / any(v_months)` idéntica a `calved` (0117, incl. wrap); `pending` = mismo JOIN con `not exists`. Una cría cuelga de UN solo `birth_calves` → no hay doble conteo. Anclado a `rodeo_serviced_females` (tenant-guarded) — verificado por Gate 1.
- **(d) ¿anti-recorte / descendentes?** "Destete" no tiene descendente, igual el capture lo asserta. La nota "sin meses de servicio configurados" (la 'g' de "configurados") va al MISMO slot `detail` del `KpiCard` que ya usa la card de Parición (#8, capturada sin recorte) → mismo componente, mismo comportamiento. El capture asserta anti-recorte sobre "Destete" / "todavía no empezó el destete" / "sin meses de servicio configurados".
- **(e) ¿la card de Destete rompe el layout de Preñez/Parición?** NO. Va en un `KpiRow` NUEVO (2º, full-width por `flex=1` de `KpiCard`) DESPUÉS de la fila Preñez|Parición y su leyenda; no toca el 1er `KpiRow` ni los gates de sección (`isConfigured===false` → "Configurá la estación" se evalúa ANTES y hace return; `noData` → empty reemplaza el CclBlock, no la card). Estructura idéntica al design §3.4. Typecheck limpio.
- **Determinismo del CI (encontrado y cerrado):** un `weaning` sobre una cría HEMBRA la promueve a `vaquillona` (`compute_category` 0062:94, confirmado en `animal/run.cjs:1698`); si el CI corre >365 días tras el parto sembrado, entraría al fallback por edad de `rodeo_serviced_females` (0105:141) → `serviced` inflado → non-determinismo por fecha. **Fix:** todas las crías sembradas son MACHO (`ternero`/`torito`, filtradas por `a.sex='female'` → NUNCA servidas), incl. los mellizos del caso `weaned=2 > serviced=1`. No afecta `weaned`/`pending` (cuentan crías vía `birth_calves`, independiente del sexo). Documentado en design §5.1.
- **Multi-tenant / offline:** `fetchWeaningKpi(rodeoId, year)` toma el rodeo del selector (contexto), nunca hardcodea `establishment_id`; la RPC re-guarda `has_role_in`. Reportes son online-only por diseño (mismo path `callRpcSingle`→`assertOnline` que las otras 9 RPC); el gate offline del bloque cubre la card.

## Reconciliaciones (paso 9)
- El SQL de `0118` es COPIA VERBATIM del design §2.2 (aprobado en Gate 1) → sin desviación.
- Frontend: espejo 1:1 de #8 (`calvingCardView`→`weaningCardView`, layout CD-3) → sin desviación del design §3.
- **design §5.1 (nuevo):** nota as-built del implementer — crías macho en el seed (determinismo), imputación por año de servicio verificada, asserts defensivos extra (22023/P0002) sobre lo listado en T9, y que el capture NO depende del apply. No cambia el contrato ni la semántica (el *qué* no cambió) → `requirements.md` no se retoca.
- `tasks-destete-kpi.md`: T1–T18, T20, T21 en `[x]`; T19 (capture run) y T22 (deploy) quedan `[ ]` con nota **[LEADER]** (no los ejecuta el implementer).
