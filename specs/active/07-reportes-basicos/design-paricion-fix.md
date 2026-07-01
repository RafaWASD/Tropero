# Spec 07 — Delta %PARICIÓN: fix del 0% + lógica de meses de parto (#8) — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** (RPC `rodeo_calving_kpi`) · **Gate 1 OBLIGATORIO** · **Deploy AUTORIZADO** por Raf.
**Fecha**: 2026-06-30.
**Cubre**: RPF.1–RPF.8 (ver `requirements-paricion-fix.md`).

---

## §0 — As-built vigente (lo que YA existe; no se re-inventa)

**Cuerpo VIGENTE de `rodeo_calving_kpi`** = `supabase/migrations/0106_reports_rpcs.sql:285-343` (verificado: `rg rodeo_calving_kpi supabase/migrations/*.sql` devuelve **solo** `0106` → ninguna migración posterior la tocó). Firma actual:

```
rodeo_calving_kpi(p_rodeo_id uuid, p_year int)
  returns table (is_configured boolean, serviced int, entoradas int, pregnant int, calved int)
  language plpgsql security definer stable set search_path = public
```

Hechos del cuerpo vigente que el delta **preserva tal cual**:
- **Guard/cota**: lee `establishment_id, service_months` del rodeo (`deleted_at is null`), P0002 si no existe, `has_role_in(v_est)` fail-closed → 42501, cota `p_year` (1900..current+1) → 22023. (RPF.5.3/5.4)
- **Denominador**: `is_configured`/`serviced`/`entoradas` vienen de `rodeo_service_campaign` + `rodeo_repro_denominator` (`0105`, Stream A) — no se re-derivan. (RPF.5.1)
- **`pregnant`**: `distinct on` del último tacto por hembra servida, `pregnancy_status <> 'empty'` sin `abortion` posterior (espejo `compute_category` RT2.7.5). Insumo de la pérdida preñez→parición.
- **`calved`** (líneas 330-340): `count(distinct s.animal_profile_id)` de servidas con ≥1 `birth` no borrado donde **`v_months is not null and cardinality(v_months) >= 1`** (← guarda: la raíz del 0% silencioso cuando `service_months` está vacío) y `extract(year from (b.event_date - interval '9 months')) = p_year` y `extract(month from ...) = any(v_months)` (set-membership, incluye wrap). (RPF.5.2 — se conserva la fórmula del numerador **tal cual**; el fix NO cambia el conteo, cambia el **estado de presentación**.)
- **Grants** (`0106:713/723`) y smoke-check fail-closed (`0106:730-750`) por firma `(uuid, int)`.

**Denominador `service_months`** (modelo, `0102_rodeo_service_months.sql`): `rodeos.service_months smallint[]`, nullable, 1..12, sin duplicados, ≤12. **NULL** = "sin configurar"; **`{}`** = "no hace servicio"; los **12 meses** = servicio continuo (D5). Detección del 12m = `cardinality(service_months) = 12` (consistente con `service-months.ts` `isContiguousWrap`/`n >= MONTHS_IN_YEAR` y con `rodeo_calving_by_stage` `0106:440` `v_n >= 12 → todo 0`).

**Frontend vigente**:
- `app/src/services/reports.ts` — `CalvingKpi` + `CalvingRow` + `fetchCalvingKpi`.
- `app/src/hooks/use-reports.ts` — `useRodeoKpis().calving` (genérico, **no cambia**).
- `app/src/utils/reports-format.ts` — módulo PURO (mappers/%/es-AR), testeable con `node:test`. `safePercent`/`formatPercentAR`/`kpiValueFontToken`.
- `app/src/components/reports/KpiCard.tsx` — `KpiCard` (label/value/detail/footnote/muted). **No cambia** (se reusa).
- `app/app/(tabs)/reportes.tsx` — `ReproSection` renderiza la card de Parición como `formatPercentAR(safePercent(calv.calved, calv.serviced))` **siempre** → hoy muestra "0 %" cuando `serviced>0 && calved=0` (bug D2), y "—" cuando `serviced=0`.
- `app/app/reportes-spike.tsx` + `app/e2e/captures/reportes-spike.capture.ts` — spike MOCK con variantes `?variant=`.

**Diagnóstico del 0%** (para el diseño): el 0% engañoso aparece cuando el rodeo TIENE meses de servicio y hay servidas (`serviced>0`) pero `calved=0` porque **todavía no es época de parición** (los partos aún no pudieron ocurrir) → hoy `safePercent(0, serviced)=0` → "0 %". D2 lo resuelve gateando el **display** por `status`. El caso `service_months` vacío se cubre por D3 (`no_service_months`).

---

## §1 — Archivos a crear / modificar

**Backend (deploy — lo aplica el leader por MCP):**
- **CREAR** `supabase/migrations/0117_calving_kpi_status.sql` — `DROP FUNCTION` + `CREATE` de `rodeo_calving_kpi` con `status`/`pending_pregnant`; re-`revoke`/`grant` + smoke-check + `notify pgrst`.

> **Reconciliación as-built (número de migración)**: la spec nombraba `0107_calving_kpi_status.sql`, pero `0107` ya estaba ocupado por `0107_breed_catalog.sql` (SIGSA). El as-built es **`0117_calving_kpi_status.sql`** (siguiente libre; ya aplicada al remoto por el leader). El cuerpo base sigue siendo `0106:285-343`. Las demás referencias a la migración en este design ya están actualizadas a `0117`.

**Backend (tests):**
- **MODIFICAR** `supabase/tests/reports/run.cjs` — extender TR.4 (o TR.4b nuevo) con los 4 estados + `pending_pregnant` (RPF.8).

**Frontend:**
- **MODIFICAR** `app/src/services/reports.ts` — `CalvingRow` (+`status`,`pending_pregnant`), `CalvingKpi` (+`status`,`pendingPregnant`), mapeo en `fetchCalvingKpi`.
- **MODIFICAR** `app/src/utils/reports-format.ts` — `type CalvingStatus`, función pura `calvingCardView(...)` (D1–D5 → presentación).
- **MODIFICAR** `app/src/utils/reports-format.test.ts` — casos de `calvingCardView`.
- **MODIFICAR** `app/app/(tabs)/reportes.tsx` — `ReproSection` consume `calvingCardView` + leyenda D4 (InfoNote).
- **MODIFICAR** `app/app/reportes-spike.tsx` — variantes `?variant=paricion-*` para las capturas.

**Capture (Gate 2.5):**
- **CREAR** `app/e2e/captures/paricion-fix.capture.ts`.

**Reconciliación de cierre (Puerta 2):** puntero + nota bajo R7.6 en `requirements.md` baseline; bloque "Deltas posteriores" en `design.md` baseline.

---

## §2 — Backend: nueva migración `0117_calving_kpi_status.sql`

### §2.1 — Por qué DROP + CREATE (no `CREATE OR REPLACE`)

El delta agrega columnas (`status`, `pending_pregnant`) al `returns table(...)`. Postgres **no permite cambiar el tipo de retorno** con `CREATE OR REPLACE FUNCTION` (el `returns table` es el tipo compuesto de salida) → hay que `DROP FUNCTION public.rodeo_calving_kpi(uuid, int)` y `CREATE` de cero. La RPC **no tiene dependientes SQL** (solo la invoca el cliente vía PostgREST) → el DROP es seguro. Como el DROP+CREATE resetea privilegios, la migración **re-aplica** `revoke public/anon` + `grant authenticated` + smoke-check (RPF.5.5). Regla `reference_function_recreate_base`: moldear el `CREATE` sobre el **cuerpo VIGENTE del remoto** (verificar el remoto antes de aplicar; hoy = `0106:285-343`).

### §2.2 — Nueva firma + lógica de estado

```
rodeo_calving_kpi(p_rodeo_id uuid, p_year int)
  returns table (
    is_configured boolean, serviced int, entoradas int, pregnant int, calved int,
    status text,            -- 'ok' | 'not_calving_season' | 'no_service_months' | 'not_applicable_12m'
    pending_pregnant int    -- D4: preñadas vigentes sin parto contado en la campaña
  )
```

Cuerpo (moldeado sobre el vigente; se **agrega** el cálculo de `status`/`pending_pregnant`, se **conserva** todo lo demás):

1. **Guard/cota idénticos** al vigente (lee `establishment_id, service_months`; P0002; `has_role_in` → 42501; cota `p_year` → 22023).
2. **`is_configured`/`serviced`/`entoradas`** de Stream A — sin cambios.
3. **`pregnant`** (distinct-on último tacto+ vigente) — sin cambios.
4. **`calved`** (set-membership concepción ∈ (p_year, service_months)) — **sin cambios**.
5. **`pending_pregnant`** (nuevo, D4): del conjunto servidas, las **preñadas** (mismo criterio de `pregnant`: último tacto+ `<> 'empty'` sin aborto posterior) que **NO** tienen un `birth` no borrado con concepción ∈ (p_year, service_months). Concretamente `= (# preñadas) − (# preñadas con parto contado)`; se implementa como un `count(distinct)` con `not exists (birth ... contado)`.
6. **`status`** (nuevo) — árbol de decisión con **precedencia** (RPF.3.2):
   - `service_months is null or cardinality(service_months) < 1` → `'no_service_months'` (RPF.1.1)
   - `cardinality(service_months) = 12` → `'not_applicable_12m'` (RPF.3.1)
   - `current_date < v_calving_window_start` → `'not_calving_season'` (RPF.2.2)
   - en otro caso → `'ok'` (RPF.2.3)
   - donde `v_calving_window_start := (select min(make_date(p_year, m, 1) + interval '9 months')::date from unnest(service_months) as m)` (RPF.2.1 — mes de parto = mes de servicio +9; el `min` sobre los meses da el arranque de la temporada de parición de la campaña).

> **`calved`/`pending_pregnant` se computan SIEMPRE** (son el conteo honesto), independientes de `status`. `status` gatea solo el **display** en la card. Esto mantiene válidos los asserts de conteo de TR.4 sin importar la fecha del CI (RPF.8.3/8.6).

### §2.3 — Contrato de seguridad (Gate 1) — sin regresión

- `SECURITY DEFINER STABLE set search_path = public` (read-only; el `status` no escribe). RPF.5.3.
- Guard `has_role_in(v_est)` como en el vigente; fail-closed 42501. RPF.5.4.
- `pending_pregnant` y `calved` scopean tenant **por el conjunto servidas** (`rodeo_serviced_females`, que re-guarda el tenant) + el JOIN a `reproductive_events` por `animal_profile_id` de ese conjunto → misma superficie que el `calved`/`pregnant` vigentes; **sin nuevas tablas ni columnas denorm** (defensa M2/M5 de `0106` preservada).
- `current_date`/`make_date` sobre `p_year` ya acotado → sin fechas absurdas.
- Post-CREATE: `revoke execute ... from public, anon` + `grant execute ... to authenticated` por firma `(uuid, int)` + smoke-check fail-closed (patrón `0106:730-750`, acotado a `rodeo_calving_kpi`). `notify pgrst, 'reload schema'`. RPF.5.5.
- Las otras 8 RPC de `0106` **no se tocan** (RPF.5.6).

### §2.4 — Aplicación (deploy)

La migración **no se aplica desde el archivo**; la aplica el **leader por Supabase MCP** tras Gate 1 (PASS) + reviewer (APPROVED) + Gate 2 (PASS) + Gate 2.5 (capturas OK). El hook de `supabase/tests/reports/run.cjs` en `scripts/run-tests.mjs` ya está activo (spec 07 aplicada) → la suite corre en verde una vez aplicada la `0117`. Deploy autorizado por Raf (context §Deploy).

---

## §3 — Frontend

### §3.1 — Capa de datos (`reports.ts`)

- `CalvingRow` += `status: string; pending_pregnant: number`.
- `CalvingKpi` += `status: CalvingStatus; pendingPregnant: number` (importa `CalvingStatus` de `reports-format.ts`).
- `fetchCalvingKpi` mapea `status`/`pending_pregnant` → `status`/`pendingPregnant` (con default defensivo: `status` desconocido/ausente → `'ok'`, para no romper si el cliente corre contra una DB sin la `0117` aún; `pending_pregnant` ausente → 0).
- `use-reports.ts` — **sin cambios** (`useReport` es genérico).

### §3.2 — Lógica de presentación PURA (`reports-format.ts`) — testeable

```ts
export type CalvingStatus = 'ok' | 'not_calving_season' | 'no_service_months' | 'not_applicable_12m';

export type CalvingCardView = {
  value: string;        // "84,6 %" | "—"
  detail?: string;      // "38 paridas / 46 servidas"
  note?: string;        // mensaje de estado / "sin datos"
  legend?: string;      // leyenda D4 (solo ok + pendingPregnant>0)
  muted: boolean;       // true → valor atenuado ("—")
};

export function calvingCardView(kpi: {
  status: CalvingStatus; calved: number; serviced: number; pendingPregnant: number;
} | null): CalvingCardView;
```

Mapeo (D1–D5):
| `status` | `value` | `detail`/`note` | `legend` |
|---|---|---|---|
| `ok` (serviced>0) | `formatPercentAR(safePercent(calved, serviced))` | detail "N paridas / M servidas" | "todavía hay vacas que no parieron, esto puede afectar el dato" si `pendingPregnant>0` |
| `ok` (serviced=0) | "—" (muted) | note "sin datos de esta campaña" | — |
| `not_calving_season` | "—" (muted) | note "todavía no es época de parición" | — |
| `no_service_months` | "—" (muted) | note "sin meses de servicio configurados" | — |
| `not_applicable_12m` | "—" (muted) | note "no aplica (servicio todo el año)" | — |
| `kpi === null` | "—" (muted) | note "sin datos" | — |

Reusa `safePercent`/`formatPercentAR` vigentes (guard de 0 → nunca NaN). RPF.6.2.

### §3.3 — Pantalla (`app/app/(tabs)/reportes.tsx`, `ReproSection`)

- Sin cambios en los gates de sección vigentes: `is_configured === false` → card "Configurá la estación de servicio" (NULL `service_months`); `noData` (serviced===0) → empty "Sin datos de esta campaña". (RPF.1 nota de composición.)
- La **card de Parición** deja de armar el valor a mano: `const cv = calvingCardView(calv);` y renderiza `<KpiCard label="Parición" value={cv.value} detail={cv.detail ?? cv.note} muted={cv.muted} />` (el `note` de estado ocupa el slot `detail` cuando no hay porcentaje).
- **Leyenda D4** (`cv.legend`): debajo del `KpiRow`, cuando existe, un `InfoNote` (`@/components`, ya usado en la pantalla) con el texto — mismo patrón "cartel de aviso" que pide D4. Tono informativo, tokens, sin recorte.
- La card de **Preñez** y el resto de la sección — sin cambios (RPF.6.4).

### §3.4 — Spike (`app/app/reportes-spike.tsx`)

Nuevas variantes MOCK que reusan `calvingCardView` + `KpiCard` + `InfoNote` (mismos componentes que producción, para vetar lo real):
- `paricion-ok` — `status:'ok'`, %, sin leyenda.
- `paricion-leyenda` — `status:'ok'`, %, `pendingPregnant>0` → leyenda visible.
- `paricion-fuera-ventana` — `status:'not_calving_season'`.
- `paricion-sin-meses` — `status:'no_service_months'`.
- `paricion-12m` — `status:'not_applicable_12m'`.

(El tipo `SpikeVariant` se extiende; el switch agrega los casos. Mantiene el chrome mock existente.)

---

## §4 — Gate 2.5: `app/e2e/captures/paricion-fix.capture.ts`

**Reconciliado a ADR-029 (as-built).** Molde = `cria-al-pie-alta.capture.ts` / `parto-rodeo-caravana.capture.ts` (convención ADR-029: `test`/`expect` de `./helpers/fixtures` — la `page` fixture aplica el env-shim sola; viewport mobile 412×915 de `playwright.capture.config.ts`; helper `shot(page, name)` + `assertTextNotClipped`). Para cada uno de los 5 estados: `goto('/reportes-spike?variant=paricion-*')` → asserts del texto clave visible → `page.screenshot` a **`e2e/captures/__shots__/paricion-fix/<NN>-<estado>.png`** (gitignored), con nombres `01-ok-con-porcentaje`, `02-not-calving-season`, `03-no-service-months`, `04-not-applicable-12m`, `05-ok-con-leyenda`. Anti-recorte (RPF.7.2) sobre "Parición", "todavía no es época de parición", "sin meses de servicio configurados". `.capture.ts` → NO corre en `pnpm e2e` (se dispara con `playwright.capture.config.ts`). Cuidado `reference_e2e_design_png_rerender`: revertir `design/**` si el build re-renderiza PNGs.
>
> *Cambio vs. borrador*: la spec original apuntaba al molde `reportes-spike.capture.ts` (context propio `hasTouch`/`isMobile`, anchos 360/412, salida `tests/stream-c/paricion-<variant>-<w>.png`). El as-built adopta la convención **ADR-029** (capturas nombradas por estado a `__shots__/<feature>/`, un solo viewport mobile 412×915) que es el estándar vigente del Gate 2.5. Un único viewport (no 360+412) porque la card entra completa a 412 y ADR-029 fija el device mobile real; los 5 estados quedan cubiertos por 5 capturas nombradas.

---

## §5 — Tests no-bypass backend (`supabase/tests/reports/run.cjs`)

Extender TR.4 (o TR.4b) — reusa fixtures existentes (`createRodeo`/`setServiceMonths`/`createAnimal`/`reproductive_events`). Determinismo de fechas: los estados temporales se siembran **relativos a `new Date()`**, no a meses fijos:
- **RPF.8.1** — rodeo con `service_months=[]` (y otro con NULL) → `status='no_service_months'`.
- **RPF.8.2** — `not_calving_season`: elegir `service_months=[mesActual]` con `p_year=thisYear()` → ventana de parto = mesActual+9 (futuro) → `status='not_calving_season'`.
- **RPF.8.3** — `ok` + `calved` correcto: elegir `service_months` cuya ventana +9 ya pasó respecto de hoy, cargar partos con concepción ∈ ventana → `status='ok'`, `calved` = lo esperado; **conservar** el caso wrap `[11,12,1]` con los asserts de `calved=2` (independiente de fecha, RPF.8.6).
- **RPF.8.4** — `service_months` = los 12 meses → `status='not_applicable_12m'`.
- **RPF.8.5** — `pending_pregnant`: 2 servidas preñadas (tacto+ vigente), 1 con parto en la ventana → `pending_pregnant=1`; agregar el parto de la otra → `pending_pregnant=0`.
- **RPF.8.6** — preservar asserts vigentes de TR.4 (wrap, `pregnant≥calved`, serviced=0 sin NaN) + IDOR 42501 sobre `rodeo_calving_kpi`.

La suite ya corre contra el remoto y falla-hasta-apply; verde tras aplicar `0117`.

---

## §6 — Alternativa descartada

**Descartada: gatear el %parición en el FRONTEND** (que la RPC siga devolviendo solo `calved`/`serviced` y el cliente derive "época de parición" y "sin meses" con `service-months.ts`).
**Por qué no**: (a) la "época de parición" depende de `service_months` + `p_year` + `current_date` y de la misma lógica de set-membership/+9 que ya vive server-side; duplicarla en el cliente rompe la **fuente única** (design §5.7 de `0106` — "los KPI no re-derivan"); (b) `pending_pregnant` (D4) exige cruzar tactos vigentes con partos por hembra — un cómputo agregado que ya es server-side y que el cliente NO replica (los eventos crudos no se sincronizan para reportes, `reports.ts` es online-only). Poner el estado en la RPC mantiene un solo lugar auditable (Gate 1) y una card "tonta". El costo (una migración DROP+CREATE con re-grant) es aceptable y está autorizado.

**También descartada: agregar el estado como columnas separadas booleanas** (`is_calving_season`, `has_service_months`, …) en vez de un `status` enumerado. Un único `status` con precedencia definida (12m > ventana) evita estados contradictorios y es más simple de testear y de mapear en la card. Se elige el enum.

---

## §7 — Decisiones de criterio propio (a confirmar en Puerta 1)

- **CD-1 — Shape del contrato**: `status text` con dominio `{'ok','not_calving_season','no_service_months','not_applicable_12m'}` + `pending_pregnant int`, agregados al `returns table`. Implica **DROP+CREATE** (no `CREATE OR REPLACE`) por el cambio de tipo de retorno, con re-`revoke`/`grant`/smoke-check. (§2.1)
- **CD-2 — "época de parición" (D2)**: `not_calving_season` = `current_date < min(make_date(p_year,m,1)+9mo)`. Es decir, se oculta el % **solo ANTES** del primer mes de parto (que es el problema del 0% prematuro); una vez llegada la temporada, se muestra el % **también después** de que la temporada termina (es el resultado final honesto de la campaña). *A confirmar*: que "solo en los meses de parto" se lee como "desde el primer mes de parto en adelante", no "únicamente durante la ventana y oculto al terminar".
- **CD-3 — Detección del 12m (D5)**: `cardinality(service_months) = 12`, evaluado con precedencia sobre la ventana. Alcance del delta: solo la **card de Parición** refleja `not_applicable_12m`; ocultar los OTROS KPIs repro de un rodeo 12m (que D5 también menciona) queda **fuera de alcance** de este delta (es #8 = parición), como cambio futuro separado.
- **CD-4 — `pending_pregnant` (D4)**: preñadas vigentes (tacto+ `<> empty` sin aborto posterior) **sin** parto contado en la ventana. La leyenda aparece solo con `status='ok'` y `pending_pregnant>0`.
- **CD-5 — Copys es-AR** propuestos (a ajustar por Raf): "sin meses de servicio configurados" · "todavía no es época de parición" · "no aplica (servicio todo el año)" · leyenda D4 textual del context ("todavía hay vacas que no parieron, esto puede afectar el dato").
- **CD-6 — Default defensivo del cliente**: `status` ausente/desconocido → `'ok'` (compat si el cliente corre antes de aplicar `0117`).

---

## §8 — Orden de ejecución (resumen; detalle en `tasks-paricion-fix.md`)

Backend primero (migración + suite), frontend después, capture al final. La migración la aplica el **leader por MCP** tras Gate 1 + reviewer + Gate 2 + Gate 2.5. Nunca se aplica desde el implementer.
