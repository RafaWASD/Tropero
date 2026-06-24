baseline_commit: ad9c0ba9786833f6838f5f6aa665438a1e3143a7

# impl 07-reportes-basicos — FRONTEND (Stream C, design-spike) — implementer Opus

> Feature `07-reportes-basicos` (`in_progress`). El BACKEND (9 RPC + suite 14/14 + helper puro
> `calving-stage.ts`) YA está aplicado y verde (ledger `progress/impl_07-reportes-backend.md`).
> Este ledger cubre el **FRONTEND**: `reports.ts` (service online-only) + `use-reports.ts` (hook) +
> las pantallas de reportes + componentes + capturas para el veto `design-review` del leader.
>
> **Visual antes de plomería (ADR-023):** construyo el service + las pantallas + capturas; el leader
> vetea con `design-review` ANTES de mostrar a Raf. NO marco `done` ni la feature. Frontend consume
> RPCs ya gateadas → Gate 1 N/A.

## Tareas del frontend (de tasks.md, fase 5-8)

- [x] **T5.3** — `app/src/services/reports.ts`: wrappers `supabase.rpc(...)` de las 9 RPC; mapeo
  snake→camel; detección de offline ANTES de llamar (`assertOnline` → `{kind:'offline'}`);
  traducción de errores a `ReportError` accionable. Cubre: R7.2.1, R7.2.2, R7.2.4.
- [x] **T5.4** — `app/src/hooks/use-reports.ts`: orquesta `reports.ts`; estado loading/online/error;
  anti-parpadeo (`loading && data===null` vía `reportView`); recarga al cambiar de rodeo/campaña/
  establecimiento (deps primitivas + guard de secuencia). Cubre: R7.2.2, R7.2.4, R7.1.3.
- [x] **T6.1** — `app/app/(tabs)/reportes.tsx`: reemplaza el stub; selector de rodeo (Select) + selector
  de campaña (año, stepper; default = última campaña con datos vía `defaultCampaignYear`); scope por
  establecimiento activo (rodeo del RodeoContext del campo activo). Cubre: R7.1.1, R7.1.2, R7.1.3,
  R7.1.4, R7.5.7, R7.5.8.
- [x] **T6.2** — Cards de KPI (`KpiCard`): %preñez + %parición con % grande + num/den absolutos
  ("41 preñadas / 46 servidas"). Base ÚNICA servidas, SIN toggle. "—" si servidas=0 (`safePercent`/
  `formatPercentAR`). Cubre: R7.5.1, R7.5.3, R7.5.4, R7.5.5, R7.6.1, R7.6.3, R7.6.4, R7.6.5.
- [x] **T6.3** — `CclBars`: barras cabeza/cuerpo/cola, nº decidido por `cclBarsForMonths` →
  `sizeBucketsForServiceMonths` (fuente única); oculta CCL para 1/12/sin config con nota; empty si
  total=0; muestra total base. Cubre: R7.7.1-R7.7.5.
- [x] **T6.4** — Cruce tacto↔nacimientos junto al CCL (segundo set de barras `bornBars`); degrada si no
  hay nacimientos (bornTotal=0). Cubre: R7.8.1, R7.8.2, R7.8.3.
- [x] **T6.5** — Peso por categoría: AVG + nº animales; es-AR (`formatKgAR`); sin peso → "—". Cubre:
  R7.9.1, R7.9.2, R7.9.3, R7.9.4.
- [x] **T6.6** — Estado "configurá la estación de servicio" si `is_configured=false`, CTA a
  /editar-servicio. Cubre: R7.5.6, R7.6.6.
- [x] **T6.7** — Alertas (`AlertList`): dosis vencida + sin pesar, ítems accionables (→ ficha) + empty
  states positivos. Cubre: R7.10.2, R7.10.4, R7.11.3, R7.11.5.
- [x] **T6.8** — Estado offline (`ReportOffline`) + error con reintento (`ReportError`) por sección.
  Cubre: R7.2.2, R7.2.4.
- [x] **T7.1** — `app/app/reportes/sesion/[id].tsx` (detalle) + `app/app/reportes/sesiones.tsx` (lista):
  conteos por tipo + marco temporal + animales; empty si no hay eventos; lista de sesiones del rodeo.
  Cubre: R7.3.1, R7.3.2, R7.3.5, R7.3.6.
- [x] **T7.2** — `app/app/reportes/comparar.tsx`: 2 sesiones del MISMO rodeo (lista scopeada al rodeo);
  tabla con delta por tipo de evento (`compareSessions`). Cubre: R7.4.1, R7.4.2, R7.4.3.
- [x] **T7.3** — Comparativa de peso por categoría entre 2 sesiones del mismo rodeo (`compareWeights`,
  reusa `rodeo_weight_by_category(rodeoId, sessionId)`). Cubre: R7.9.5.

## Plan de ejecución

1. `reports.ts` — la capa I/O: tipos camelCase de cada RPC + wrappers `callRpc` con `assertOnline`
   first + mapeo. Lógica PURA testeable: el mapeo de filas + `%` (con guard de 0) + es-AR.
2. Tests puros de `reports.ts` (lo testeable sin SDK: mappers + pct + formato).
3. `use-reports.ts` — hooks de orquestación (estado loading/online/error, anti-parpadeo).
4. Componentes reutilizables `components/reports/*` (KpiCard, CclBars, AlertList, ReportState).
5. Pantalla `reportes.tsx` (selector rodeo + campaña + KPIs + CCL + cruce + peso + alertas + estados).
6. `reportes/sesion/[id].tsx` + `reportes/comparar.tsx`.
7. Capturas Playwright (harness gitignored `tests/stream-c/`) de los estados clave 360/412.
8. Autorrevisión adversarial + mapa R→test + reconciliación specs.

---
## Archivos creados / modificados

**Service + lógica pura (testeable):**
- `app/src/services/reports.ts` (NUEVO) — capa I/O: 9 wrappers `supabase.rpc(...)` online-only
  (`assertOnline` ANTES de llamar → `{kind:'offline'}`), mapeo snake→camel, `mapRpcError` (42501→forbidden,
  P0002→forbidden, 22023→validation, fetch→network, resto→server).
- `app/src/utils/reports-format.ts` (NUEVO, PURO) — `safePercent` (guard de 0), `formatPercentAR`/`formatKgAR`/
  `formatKgDeltaAR`/`formatCountDelta` (es-AR), `cclBarsForMonths` (usa `sizeBucketsForServiceMonths` — fuente
  única; pliega `body`→`head` en 2 buckets), `compareSessions`/`compareWeights` (deltas), `defaultCampaignYear`
  (última campaña con datos, TZ-safe), labels (kind/etapa/animal/fecha/días).
- `app/src/utils/reports-format.test.ts` (NUEVO) — 33 tests node:test.
- `app/src/hooks/use-reports.ts` (NUEVO) — `useReport` genérico (anti-parpadeo + guard de secuencia),
  `useRodeoKpis`/`useEstablishmentAlerts`/`useRodeoSessions`/`useSessionSummary`, `reportView`.

**Componentes (cero hardcode):**
- `app/src/components/reports/{ReportStates,KpiCard,CclBars,AlertList,index}.tsx` (NUEVOS).

**Pantallas:**
- `app/app/(tabs)/reportes.tsx` (REEMPLAZA el stub) — selector rodeo + campaña + KPIs + CCL + cruce + peso +
  alertas + nav a sesiones/comparar + estados.
- `app/app/reportes/sesiones.tsx` (NUEVO) — lista de sesiones del rodeo (R7.3.6).
- `app/app/reportes/sesion/[id].tsx` (NUEVO) — detalle de una sesión (R7.3.1/.2/.5).
- `app/app/reportes/comparar.tsx` (NUEVO) — comparativa de 2 sesiones (R7.4 + R7.9.5).
- `app/app/reportes-spike.tsx` (NUEVO, DEV_WEB_ROUTES) — spike visual mock para el veto del leader.
- `app/app/_layout.tsx` (MOD) — registra las rutas + `REPORT_DESTINATIONS` (no se re-rutean) + spike en
  DEV_WEB_ROUTES.
- `scripts/run-tests.mjs` (MOD) — agrega `reports-format.test.ts` a la suite unit.
- `app/e2e/captures/reportes-spike.capture.ts` (NUEVO) — capturas para el veto.

## Mapa R<n> → archivo:test (trazabilidad)

| R<n> | Cubierto por |
|---|---|
| R7.1.1/.2/.4 | `reportes.tsx` (tab, scope establecimiento+rodeo, rodeo como unidad) |
| R7.1.3 | `reportes.tsx` (rodeo del RodeoContext del campo activo; `useFocusEffect` deps `[rodeoId,year,establishmentId]`) + `use-reports.ts` (recarga por deps) |
| R7.2.1 | `reports.ts` (no replica agregación; solo dibuja la RPC) |
| R7.2.2 | `reports.ts` `assertOnline` ANTES de la RPC → `{kind:'offline'}`; `ReportStates.ReportOffline`; `reports-format.test.ts` (safePercent/format) + captura `offline-{360,412}.png` |
| R7.2.4 | `ReportStates.ReportError`/`ReportOffline` con reintento; `use-reports.ts` `reload` |
| R7.3.1/.2/.5 | `reportes/sesion/[id].tsx` (`session_event_summary` + `getSessionById`) + captura `sesion-{w}.png` |
| R7.3.6 | `reportes/sesiones.tsx` (`rodeo_sessions_list`) |
| R7.4.1/.2/.3 | `reportes/comparar.tsx` + `reports-format.test.ts` (`compareSessions`: delta, kind faltante=0, orden) |
| R7.5.1/.3/.4/.5 | `reportes.tsx` ReproSection (`safePercent(pregnant,serviced)` base única; "—" si 0; absolutos) + `reports-format.test.ts` (safePercent guard 0; formatPercentAR null→"—") |
| R7.5.6/R7.6.6 | `reportes.tsx` (is_configured=false → "Configurá la estación" + CTA) + captura `config-{w}.png` |
| R7.5.7/.8 | `reportes.tsx` YearStepper + `defaultCampaignYear` (`reports-format.test.ts`: última con datos, no actual); wrap = server (set-membership) |
| R7.6.1/.3/.4/.5 | `reportes.tsx` (`safePercent(calved,serviced)` base única; absolutos) |
| R7.7.1-.5 | `CclBars` + `cclBarsForMonths` (`reports-format.test.ts`: 1/12/0→[], 3→tercios, 2→cabeza/cola pliega body, total0→0%) + captura `kpis-{w}.png` |
| R7.8.1/.2/.3 | `reportes.tsx` CclBlock (`bornBars` junto al CCL; degrada bornTotal=0) + `calving-stage.ts` (backend ya testeado) |
| R7.9.1-.4 | `reportes.tsx` WeightSection (`formatKgAR`; "—" sin peso) + `reports-format.test.ts` (formatKgAR null→"—") |
| R7.9.5 | `reportes/comparar.tsx` WeightCompare (`compareWeights` por sesiones) + `reports-format.test.ts` |
| R7.10.2/.4 | `reportes.tsx` OverdueSection + `AlertList` + empty positivo; captura `alertas-{w}.png`/`vacio-{w}.png` |
| R7.11.3/.5 | `reportes.tsx` UnweighedSection + `daysSinceLabel` (`reports-format.test.ts`: null→"Nunca pesado") + empty positivo |

> Nota: la trazabilidad de seguridad/cómputo (R7.12/R7.13 + correctitud server-side de cada KPI) la cubre la
> suite backend `supabase/tests/reports/run.cjs` (14/14, ledger backend). El frontend consume las RPC ya
> gateadas → su cobertura autoritativa es la lógica pura (`reports-format.test.ts`) + el veto visual.

## Capturas para el veto (tests/stream-c/, gitignored) — 14 PNG, captura 2/2 passed

- (a) KPIs poblados (preñez/parición + CCL + cruce + peso): `kpis-360.png` / `kpis-412.png`
- (b) Resumen de sesión: `sesion-360.png` / `sesion-412.png`
- (c) Alertas con ítems: `alertas-360.png` / `alertas-412.png`
- (d) Estado vacío (sin datos + alertas resueltas): `vacio-360.png` / `vacio-412.png`
- (e) Estado offline: `offline-360.png` / `offline-412.png`
- (f) Configurar estación de servicio: `config-360.png` / `config-412.png`
- (g) Comparativa de 2 sesiones (delta eventos + peso, pills verde/terracota): `comparar-360.png` / `comparar-412.png`
- Anti-recorte de descendentes verificado en cada estado (Preñez/Jornada/Reproductivo/Configurá…) por bounding-box.
- **Bug cazado en la autorrevisión visual + corregido**: a 360px el valor "82,6 %" se TRUNCABA ("82,6…") por
  `adjustsFontSizeToFit` (NO-OP en rn-web, gotcha `reference_rn_web_pitfalls`) en la media card. Fix:
  `kpiValueFontToken` (length-aware, web-safe: ≤5 chars → $10, 6+ → $9) en `KpiCard` + se quitó
  `adjustsFontSizeToFit`. Re-captura confirma "89,1 %"/"82,6 %" completos a 360px.

## Decisiones de diseño

- **Patrón KPI hero**: número GRANDE ($10=38px) + label arriba + absolutos abajo ("41 preñadas / 46 servidas").
  Inspirado en Mercado Pago. `adjustsFontSizeToFit` para que "100 %" no recorte en 360px.
- **CCL = barras horizontales** con label + conteo + % a la derecha + barra proporcional. El cruce de oro
  (R7.8) = dos sets superpuestos: "Al tacto" ($primary lleno) vs "Nacimientos" ($greenLight) → se lee la
  pérdida por etapa de un vistazo.
- **Online-only**: `assertOnline` ANTES de cada RPC (no cuelga la pantalla). Estado `ReportOffline` con copy
  accionable + reintentar.
- **Vacío / 0-servidas / sin-config**: empty states cálidos específicos (no "0%"/NaN). Servidas=0 → ReproSection
  muestra "Sin datos de esta campaña" (antes de las barras); `safePercent` devuelve null → KPI "—".
- **Selector de campaña**: stepper ← año → (default = última campaña con datos vía `defaultCampaignYear`, no el
  año calendario — R7.5.7). Tope en año+1 (espeja la cota `p_year` del server).
- **Rodeo para reportes = estado LOCAL** (no cambia el rodeo activo global): elegir un rodeo a reportar no
  debe mover el rodeo activo de toda la app. Default = el activo.

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:
- **Desviaciones del spec**: ✅ base única servidas sin toggle (no construí `DenominatorToggle`); absolutos
  num/den visibles; comparativa por SESIONES (no campañas); archivados los maneja el server (frontend solo
  consume). Cubierto.
- **Edge cases / NaN**: `safePercent` con guard de den≤0 → null → "—" (testeado: 0/0, 5/0, num finito). Peso
  sin categoría → "—" (no "0 kg"). `cclBarsForMonths` total=0 → 0% (no NaN). `formatKgDeltaAR(null)` → "—".
  `defaultCampaignYear` con fechas inválidas → ignora. **Bug encontrado y corregido**: `defaultCampaignYear`
  usaba `getFullYear()` (LOCAL) → flake TZ (2023-01-01Z daba 2022 en Argentina); reescrito a `isoYear`
  (parse del `YYYY-` literal, determinístico) — test pasó.
- **Seguridad**: N/A directo (frontend consume RPC ya gateadas, Gate 1 N/A). El `establishment_id`/`rodeo_id`
  NUNCA se hardcodean (vienen del contexto/params); la RPC re-valida tenant server-side (42501 → mapeado a
  `forbidden`, NO vacío silencioso). Sin `.or()/.filter()` con input de usuario; params tipados de PostgREST.
- **Tests que pasan por la razón equivocada**: los tests de `reports-format` ejercen el path real (no mocks);
  el de safePercent verifica el reject (null), no solo el happy path. `compareSessions` verifica que un kind
  faltante NO se omite (R7.4.3).
- **Hooks**: verifiqué que todos los hooks se llaman ANTES de los early-returns (no condicionales); `useReport`
  se llama incondicionalmente con `fetcher|null` (mismo nº de hooks por render).

## Limitaciones conocidas (NO bloquean el MVP)

- **R7.2.3 (cache read-only "datos de la última carga" offline) NO implementado** — es nice-to-have explícito
  ("Opcional — no bloquea el MVP", requirements R7.2.3). El anti-parpadeo conserva el último `data` en memoria
  durante un refresh fallido, pero NO lo marca como "datos de la última carga". Si Raf lo quiere, es un add-on
  chico sobre `reportView` (un flag `stale`). Anotado para no sobre-prometer.
- **Default de campaña** = año de la sesión más reciente (proxy de "última campaña con datos", no hay RPC de
  "años con datos"). Si el rodeo tuvo servicio pero ninguna sesión, cae al año actual. Honesto y ajustable con
  el stepper.

## Reconciliación specs ↔ as-built (regla dura docs/specs.md)

Lo construido quedó alineado con requirements/design salvo estas precisiones de empaquetado (NO cambian el
*qué*; se anotan en design §1 vía esta nota — el leader las folda al cerrar):
- **design §1 listaba `reportes/sesion/[id].tsx` + `reportes/comparar.tsx`**. As-built: se agregó
  `reportes/sesiones.tsx` (LISTA de sesiones, R7.3.6) como entrada separada del detalle — design §6 dice "Acceso
  a 'Resumen de sesión' (lista de sesiones del rodeo)" → la lista necesita su propia pantalla; el detalle es
  `sesion/[id]`. 3 archivos en vez de 2. Mismo contrato.
- **Se agregó `reportes-spike.tsx`** (no estaba en design §1) = spike visual mock para el veto (paridad con los
  spikes de Stream B). NO es producción (DEV_WEB_ROUTES). Reusa los componentes reales.
- **La lógica pura se separó en `reports-format.ts`** (design §1 no lo listaba explícito; mencionaba el helper
  `calving-stage.ts` ya existente). Mismo criterio que el split online-guard/online-guard-pure: lo testeable
  fuera del módulo con SDK.
- **`reports.ts` shape de error**: design decía `Result.err({kind:'offline'})` genérico; as-built usa
  `ReportError` con kinds `offline|network|server|forbidden|validation` (más granular para mapear 42501/P0002/
  22023 del contrato de las RPC). Superset del contrato; mismo *qué* (offline detectado antes de llamar).

tasks.md: T5.3/T5.4/T6.1-T6.8/T7.1-T7.3 → marco `[x]` con esta evidencia (las dejo para que el leader las
folde al cerrar — el frontend es un dispatch separado del backend ya `[x]`).

---
## Progreso (en vivo)
- check.mjs VERDE (typecheck + unit incl. reports-format 33/33 + anti-hardcode 0 + backend suites).
- Captura del veto 2/2 passed → 12 PNG en tests/stream-c/.
- PENDIENTE: veto `design-review` del leader (T8.3) → mostrar a Raf. NO marqué `done`.
