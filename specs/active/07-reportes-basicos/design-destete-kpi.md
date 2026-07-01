# Spec 07 — Delta %DESTETE: RPC nuevo `rodeo_weaning_kpi` (#10) — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** (RPC NUEVA `rodeo_weaning_kpi`) · **Gate 1 OBLIGATORIO** · **Deploy AUTORIZADO** por Raf. **Migración nueva: `0118`** (0117 es la última).
**Fecha**: 2026-07-01.
**Cubre**: RWK.1–RWK.9 (ver `requirements-destete-kpi.md`).
**Molde**: `rodeo_calving_kpi` (`0117_calving_kpi_status.sql`) para la RPC; `compute_nursing` (`0061_nursing_column.sql`) para el JOIN cría↔destete; `calvingCardView` (#8) para la card. #10 = #8 un paso más adelante en el ciclo.

---

## §0 — As-built vigente (lo que YA existe; no se re-inventa)

**Molde de RPC — `rodeo_calving_kpi`** = `supabase/migrations/0117_calving_kpi_status.sql` (as-built VIGENTE, aplicada al remoto por el leader; regla `reference_function_recreate_base`: se moldea sobre el cuerpo vigente). De ahí se copian **tal cual**:
- Guard/cota: lee `establishment_id, service_months` del rodeo (`deleted_at is null`), P0002 si no existe, `has_role_in(v_est)` fail-closed → 42501, cota `p_year` (1900..current+1) → 22023. (RWK.6.2/6.3/6.4)
- Denominador de Stream A: `serviced` de `rodeo_service_campaign` + `rodeo_repro_denominator` (`0105`) — no se re-deriva. (RWK.1.2)
- `SECURITY DEFINER STABLE set search_path = public` (RWK.6.1); revoke public/anon + grant authenticated + smoke-check fail-closed + `notify pgrst`, dentro de `begin/commit`. (RWK.6.5)
- Ventana de campaña del `calved` (`0117:84-94`): set-membership `extract(year from (b.event_date - interval '9 months')) = p_year` y `extract(month ...) = any(v_months)` (incluye wrap de fin de año). #10 reusa la MISMA ventana, un paso más (parto → cría → destete).

**Molde del JOIN cría↔destete — `compute_nursing`** = `supabase/migrations/0061_nursing_column.sql:29-42`. Ya implementa exactamente el vínculo **madre → `reproductive_events(birth)` → `birth_calves` → cría → `reproductive_events(weaning)`**: `nursing = exists(parto no borrado de la madre join birth_calves donde el ternero NO tiene weaning no borrado)`. #10 lo generaliza a un `count(distinct)` sobre el conjunto servidas + la ventana de campaña.

**Modelo de datos reusado (no se crea nada):**
- `birth_calves` (`0045`): tabla puente parto↔cría (`birth_event_id`, `calf_profile_id`), select-only para el cliente, poblada server-side (trigger mono-ternero + `register_birth`). Un parto = UN evento `birth` con N crías (mellizos). El conteo de crías usa `birth_calves`, NO `calf_id` (compat as-built = solo la 1ª cría).
- `reproductive_events.event_type`: dominio incluye `'birth'` y `'weaning'` (`0026`). El evento `weaning` está sobre el perfil de la **cría** (`animal_profile_id = ternero`; `buildAddWeaningInsert`, destete masivo `applyBulkWeaning`).
- Stream A (`0105`): `rodeo_serviced_females(p_rodeo_id, p_year)`, `rodeo_service_campaign`, `rodeo_repro_denominator`. Cada uno re-guarda el tenant (`has_role_in`) + cota `p_year`.

**Denominador `service_months`** (`0102`): `smallint[]`, nullable, 1..12, sin duplicados, ≤12. **NULL** = "sin configurar"; **`{}`** = "no hace servicio"; **12 meses** = servicio continuo (D5). Detección 12m = `cardinality(service_months) = 12` (consistente con #8).

**Frontend vigente (con el delta #8 ya integrado en el árbol):**
- `app/src/services/reports.ts` — `CalvingKpi` + `fetchCalvingKpi` + helper `callRpcSingle`/`toNum`.
- `app/src/hooks/use-reports.ts` — `useRodeoKpis` devuelve `{pregnancy, calving, ccl, calvingByStage, weight}` (cada uno un `ReportPhase`).
- `app/src/utils/reports-format.ts` — `safePercent`/`formatPercentAR`/`calvingCardView`/`CalvingStatus`/`asCalvingStatus`/`CALVING_PENDING_LEGEND` (molde directo de #8).
- `app/app/(tabs)/reportes.tsx` — `ReproSection` renderiza `KpiRow` con Preñez | Parición (`cv = calvingCardView(calv)`) + `InfoNote` para `cv.legend`.
- `app/app/reportes-spike.tsx` — spike MOCK con variantes `?variant=` (incl. `paricion-*` de #8) + `ParicionVariant`.
- `app/e2e/captures/paricion-fix.capture.ts` — molde ADR-029 del capture de estados.

---

## §1 — Archivos a crear / modificar

**Backend (deploy — lo aplica el leader por MCP):**
- **CREAR** `supabase/migrations/0118_weaning_kpi.sql` — `CREATE FUNCTION public.rodeo_weaning_kpi(p_rodeo_id uuid, p_year int)` + `revoke public/anon` + `grant authenticated` + smoke-check fail-closed + `notify pgrst`, dentro de `begin/commit`. (RWK.1, RWK.2, RWK.3, RWK.5, RWK.6)

**Backend (tests):**
- **MODIFICAR** `supabase/tests/reports/run.cjs` — TR.11 nuevo (los 4 estados + `weaned`/`pending_weaning` + wrap + mellizos + imputación por campaña + IDOR) y extender TR.10 (grants: `rodeo_weaning_kpi` en el array de anon-no-ejecuta → 10 RPC; read-only). (RWK.9)

**Frontend:**
- **MODIFICAR** `app/src/utils/reports-format.ts` — `type WeaningStatus`, `WEANING_STATUSES`, `asWeaningStatus`, `WEANING_PENDING_LEGEND`, `type WeaningCardView`, función pura `weaningCardView(...)`. (RWK.7.2)
- **MODIFICAR** `app/src/services/reports.ts` — `type WeaningKpi`, `WeaningRow` (snake), `fetchWeaningKpi(rodeoId, year)` (import `asWeaningStatus`/`WeaningStatus`). (RWK.7.1)
- **MODIFICAR** `app/src/hooks/use-reports.ts` — `RodeoKpis += weaning`; `weaningFetcher` memoizado por `(rodeoId, year)`; `weaning: useReport(ready ? weaningFetcher : null)`. (RWK.7.1)
- **MODIFICAR** `app/src/utils/reports-format.test.ts` — casos de `weaningCardView`.
- **MODIFICAR** `app/app/(tabs)/reportes.tsx` — `ReproSection` consume `kpis.weaning`, agrega la card de Destete + leyenda D4; `useFocusEffect` + `reloadRepro` recargan `weaning`. (RWK.7.3, RWK.7.5)
- **MODIFICAR** `app/app/reportes-spike.tsx` — `SpikeVariant += destete-*`; `DesteteVariant`; wiring del switch. (RWK.7.2/7.4)

**Capture (Gate 2.5):**
- **CREAR** `app/e2e/captures/destete-kpi.capture.ts`. (RWK.8)

**Reconciliación de cierre (Puerta 2):** puntero + nota bajo R7.6 en `requirements.md` baseline; entrada en "Deltas posteriores" de `design.md` baseline.

---

## §2 — Backend: nueva migración `0118_weaning_kpi.sql`

### §2.1 — Por qué `CREATE FUNCTION` directo (no DROP, no `CREATE OR REPLACE`)

`rodeo_weaning_kpi` **no existe** (verificar antes de aplicar: `rodeo_weaning_kpi` no aparece en `supabase/migrations/*.sql`) → se crea de cero, sin DROP. **PERO** Postgres otorga `EXECUTE` a `PUBLIC` por default al crear una función → el `revoke execute ... from public, anon` + `grant execute ... to authenticated` + smoke-check fail-closed son **OBLIGATORIOS** (RWK.6.5), igual que en un DROP+CREATE. Número de migración: **`0118`** = siguiente libre tras `0117` (la última). La migración contiene SOLO esta función (RWK.6.6).

### §2.2 — Firma + cuerpo (SQL clave)

```sql
-- 0118_weaning_kpi.sql
-- Delta %DESTETE (#10) — spec 07 (RWK.1–RWK.9). RPC NUEVA rodeo_weaning_kpi: cierra el ciclo servida →
-- parida → DESTETADA. Moldeada sobre rodeo_calving_kpi (0117) — mismo guard/cota/tenant, mismo denominador de
-- Stream A (0105), mismo SECURITY DEFINER STABLE + revoke/grant + smoke-check. JOIN cría↔destete = compute_nursing
-- (0061). RPC NUEVA → CREATE directo (no DROP), pero el revoke public/anon es OBLIGATORIO (default = EXECUTE a
-- PUBLIC). NO toca rodeo_calving_kpi ni las otras 9 RPC de reportes (RWK.6.6).

begin;

create function public.rodeo_weaning_kpi (p_rodeo_id uuid, p_year int)
returns table (
  is_configured boolean,
  serviced int,
  weaned int,            -- numerador: crías destetadas de la campaña (RWK.2.1)
  pending_weaning int,   -- crías de la campaña al pie, sin destetar (RWK.3.1, D4)
  status text            -- 'ok' | 'not_weaning_season' | 'no_service_months' | 'not_applicable_12m' (RWK.5)
)
language plpgsql security definer stable
set search_path = public as $$
declare
  v_est uuid; v_months smallint[]; v_cfg record; v_denom record;
begin
  -- ── Guard/cota IDÉNTICOS a 0117:43-52 — tenant derivado del RODEO, no del cliente (RWK.6.2/6.3/6.4). ──
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s weaning kpi' using errcode = '42501';
  end if;
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  -- ── Denominador de Stream A (0105) — sin re-derivar (RWK.1.2). ──
  select * into v_cfg   from public.rodeo_service_campaign(p_rodeo_id, p_year);
  select * into v_denom from public.rodeo_repro_denominator(p_rodeo_id, p_year);
  is_configured := v_cfg.is_configured;
  serviced      := v_denom.serviced;

  -- ── weaned (RWK.2): crías DISTINCT vinculadas por birth_calves a un parto de una SERVIDA cuya CONCEPCIÓN
  -- (parto − 9 meses) ∈ (p_year, mes ∈ service_months) — MISMA ventana que `calved` (0117:84-94), un paso más
  -- (parto → birth_calves → cría → weaning). JOIN molde = compute_nursing (0061:29-42). Imputación por AÑO DE
  -- SERVICIO (la cría se cuenta en la campaña que la concibió, NO por el año calendario del weaning — RWK.2.2). ──
  select count(distinct bc.calf_profile_id)::int
  into weaned
  from public.rodeo_serviced_females(p_rodeo_id, p_year) s
  join public.reproductive_events b
    on  b.animal_profile_id = s.animal_profile_id
    and b.event_type = 'birth' and b.deleted_at is null
    and v_months is not null and cardinality(v_months) >= 1
    and extract(year  from (b.event_date - interval '9 months'))::int = p_year
    and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
  join public.birth_calves bc on bc.birth_event_id = b.id
  where exists (
    select 1 from public.reproductive_events w
    where w.animal_profile_id = bc.calf_profile_id
      and w.event_type = 'weaning' and w.deleted_at is null
  );

  -- ── pending_weaning (RWK.3.1, D4): crías DISTINCT del MISMO conjunto de partos de la campaña SIN evento
  -- weaning no borrado (todavía al pie). = (# crías de la campaña) − weaned. Mismo JOIN, `not exists`. ──
  select count(distinct bc.calf_profile_id)::int
  into pending_weaning
  from public.rodeo_serviced_females(p_rodeo_id, p_year) s
  join public.reproductive_events b
    on  b.animal_profile_id = s.animal_profile_id
    and b.event_type = 'birth' and b.deleted_at is null
    and v_months is not null and cardinality(v_months) >= 1
    and extract(year  from (b.event_date - interval '9 months'))::int = p_year
    and extract(month from (b.event_date - interval '9 months'))::int = any(v_months)
  join public.birth_calves bc on bc.birth_event_id = b.id
  where not exists (
    select 1 from public.reproductive_events w
    where w.animal_profile_id = bc.calf_profile_id
      and w.event_type = 'weaning' and w.deleted_at is null
  );

  -- ── status (RWK.5) — precedencia: no_service_months → not_applicable_12m → not_weaning_season → ok. ──
  -- CRITERIO PROPIO (CD-2): not_weaning_season es DATA-DRIVEN (`weaned = 0`), NO date-driven como el
  -- not_calving_season de #8 (`current_date < ventana +9`). El destete NO tiene una ventana determinística:
  -- cae ~6-8 meses tras el parto, muy variable → no se puede computar un "inicio de temporada de destete".
  -- D3 lo define como "antes del 1er destete de la campaña" = `weaned = 0`. weaned/pending_weaning se
  -- computan SIEMPRE (conteo honesto); el status gatea solo el DISPLAY de la card.
  if v_months is null or cardinality(v_months) < 1 then
    status := 'no_service_months';
  elsif cardinality(v_months) = 12 then
    status := 'not_applicable_12m';
  elsif weaned = 0 then
    status := 'not_weaning_season';
  else
    status := 'ok';
  end if;

  return next;
end; $$;

comment on function public.rodeo_weaning_kpi is
  '%Destete de un rodeo en una campaña (delta #10/RWK): numerador weaned = crías DISTINCT (via birth_calves) '
  'de partos de servidas cuya concepción (parto − 9 meses) ∈ (p_year, mes ∈ service_months) que tienen evento '
  'weaning no borrado. Imputación por AÑO DE SERVICIO (no por año calendario del destete). %destete = '
  'weaned/serviced (puede >100% con mellizos). status (RWK.5) gatea el display: no_service_months (D5) / '
  'not_applicable_12m (D5, precede) / not_weaning_season (D3, weaned=0) / ok. pending_weaning (D4) = crías de '
  'la campaña al pie. Read-only/STABLE, SECURITY DEFINER, guard has_role_in + cota p_year. Denominador de Stream A.';

-- ── Grants (RPC nueva → default = EXECUTE a PUBLIC; el revoke es OBLIGATORIO — RWK.6.5). ──
revoke execute on function public.rodeo_weaning_kpi (uuid, int) from public, anon;
grant  execute on function public.rodeo_weaning_kpi (uuid, int) to authenticated;

-- ── Smoke-check fail-closed (patrón 0117:169-185, acotado a rodeo_weaning_kpi). ──
do $$
declare v_bad record;
begin
  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'rodeo_weaning_kpi'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (RWK.6.5): % is EXECUTE-able by % (must be revoked from anon/public)',
      v_bad.proname, v_bad.rolname;
  end loop;
  raise notice 'grant check OK (RWK.6.5): rodeo_weaning_kpi revoked from anon/public';
end$$;

notify pgrst, 'reload schema';

commit;
```

### §2.3 — Contrato de seguridad (Gate 1)

- `SECURITY DEFINER STABLE set search_path = public` (read-only; el `status` no escribe). RWK.6.1.
- Guard `has_role_in(v_est)` fail-closed → 42501; tenant derivado de la fila del rodeo. RWK.6.2.
- `weaned`/`pending_weaning` scopean tenant **por el conjunto servidas** (`rodeo_serviced_females`, que re-guarda `has_role_in` + establishment) + el JOIN a `reproductive_events`/`birth_calves` por `animal_profile_id`/`birth_event_id` de ese conjunto → misma superficie que el `calved`/`pregnant`/`pending_pregnant` de `0117`; **sin nuevas tablas ni columnas denorm**. `birth_calves` es select-only + poblada server-side (no fabricable desde PostgREST, `0045` SEC-SPEC-04) → el vínculo cría↔parto no es manipulable por el cliente.
- `p_year` acotado antes de cualquier `extract`/aritmética de fecha → sin fechas absurdas. RWK.6.3.
- Post-CREATE: `revoke ... from public, anon` + `grant ... to authenticated` por firma `(uuid, int)` + smoke-check fail-closed. `notify pgrst`. RWK.6.5.
- Las otras 9 RPC de reportes + `rodeo_calving_kpi` **no se tocan** (RWK.6.6).

### §2.4 — Aplicación (deploy)

La migración **no se aplica desde el archivo**; la aplica el **leader por Supabase MCP** tras Gate 1 (PASS) + reviewer (APPROVED) + Gate 2 (PASS) + Gate 2.5 (capturas OK). El hook de `supabase/tests/reports/run.cjs` ya está activo → la suite (incl. TR.11) queda en verde una vez aplicada la `0118`. Deploy autorizado por Raf (context §Deploy).

---

## §3 — Frontend

### §3.1 — Capa de datos (`reports.ts`)

```ts
export type WeaningKpi = {
  isConfigured: boolean;
  serviced: number;
  weaned: number;
  pendingWeaning: number;
  status: WeaningStatus;
};

type WeaningRow = {
  is_configured: boolean; serviced: number;
  weaned?: number | string; pending_weaning?: number | string; status?: string;
};

export function fetchWeaningKpi(rodeoId: string, year: number): Promise<ReportResult<WeaningKpi | null>> {
  return callRpcSingle<WeaningRow, WeaningKpi>(
    'rodeo_weaning_kpi',
    { p_rodeo_id: rodeoId, p_year: year },
    (r) => ({
      isConfigured: r.is_configured,
      serviced: toNum(r.serviced),
      weaned: toNum(r.weaned),
      pendingWeaning: toNum(r.pending_weaning),
      status: asWeaningStatus(r.status),   // default defensivo → 'ok' si ausente (CD-6)
    }),
  );
}
```

`callRpcSingle`/`toNum`/`mapRpcError` (que mapea `42501`→`forbidden`, `P0002`→`forbidden`, `22023`→`validation`) se reusan tal cual (RWK.6 se refleja en la UI vía el error tipado, sin código nuevo).

### §3.2 — Lógica de presentación PURA (`reports-format.ts`) — testeable

```ts
export type WeaningStatus = 'ok' | 'not_weaning_season' | 'no_service_months' | 'not_applicable_12m';

export const WEANING_STATUSES: readonly WeaningStatus[] = [
  'ok', 'not_weaning_season', 'no_service_months', 'not_applicable_12m',
];

export function asWeaningStatus(raw: unknown): WeaningStatus {
  return typeof raw === 'string' && (WEANING_STATUSES as readonly string[]).includes(raw)
    ? (raw as WeaningStatus) : 'ok';
}

export const WEANING_PENDING_LEGEND = 'todavía hay crías sin destetar, esto puede afectar el dato';

export type WeaningCardView = {
  value: string; detail?: string; note?: string; legend?: string; muted: boolean;
};

export function weaningCardView(
  kpi: { status: WeaningStatus; weaned: number; serviced: number; pendingWeaning: number } | null,
): WeaningCardView;
```

Mapeo (D1–D5):
| `status` | `value` | `detail`/`note` | `legend` |
|---|---|---|---|
| `ok` (serviced>0) | `formatPercentAR(safePercent(weaned, serviced))` | detail "N destetados / M servidas" | `WEANING_PENDING_LEGEND` si `pendingWeaning>0` |
| `ok` (serviced=0) | "—" (muted) | note "sin datos de esta campaña" | — (defensivo; con serviced=0 → weaned=0 → status ya sería `not_weaning_season`) |
| `not_weaning_season` | "—" (muted) | note "todavía no empezó el destete" | — |
| `no_service_months` | "—" (muted) | note "sin meses de servicio configurados" | — |
| `not_applicable_12m` | "—" (muted) | note "no aplica (servicio todo el año)" | — |
| `kpi === null` | "—" (muted) | note "sin datos" | — |

Reusa `safePercent`/`formatPercentAR` (guard de 0 → nunca NaN; `%destete>100` se formatea normal, ej. "150 %"). RWK.7.2. Espejo 1:1 de `calvingCardView` (misma forma de retorno, solo cambian los copys y el numerador `weaned`).

### §3.3 — Hook (`use-reports.ts`)

`RodeoKpis += weaning: ReportPhase<WeaningKpi | null>`. `weaningFetcher = useCallback(() => fetchWeaningKpi(rodeoId, year), [rodeoId, year])`; `weaning: useReport(ready ? weaningFetcher : null)`. Independiente de los otros (un fallo de destete no tumba preñez/parición).

### §3.4 — Pantalla (`app/app/(tabs)/reportes.tsx`, `ReproSection`)

- `ReproSection` recibe `kpis.weaning`; `const wv = weaningCardView(weaning.data);`.
- **Layout** (criterio propio CD-3): la card de Destete va en un **segundo `KpiRow`** debajo de Preñez | Parición (funnel reproductivo servida → preñada → parida → **destetada**). Un `KpiCard` solo en el `KpiRow` estira a ancho completo (`flex=1`) → número hero más grande, lectura de "resultado del ciclo". Estructura:
  ```
  <KpiRow> Preñez | Parición </KpiRow>
  {cv.legend  ? <InfoNote>{cv.legend}</InfoNote>  : null}   // leyenda de parición (#8)
  <KpiRow> Destete </KpiRow>
  {wv.legend  ? <InfoNote>{wv.legend}</InfoNote>  : null}   // leyenda D4 destete (RWK.4)
  ```
  `<KpiCard label="Destete" value={wv.value} detail={wv.detail ?? wv.note} muted={wv.muted} />`.
- `useFocusEffect` + `reloadRepro(kpis)` agregan `kpis.weaning.reload()`.
- No se tocan los gates de sección (`is_configured===false` → "Configurá la estación", `noData` → empty) ni Preñez/Parición/CCL/peso/alertas/sesiones (RWK.7.5).
- **Descartada 3-across** (Preñez | Parición | Destete en una fila): a 412px cada card ~118px, texto útil ~86px → "84,6 %" a `$9` (30px) trunca. El `KpiRow` de 2 es el molde; Destete full-width en su fila evita el recorte y respeta el manga-friendly (número grande).

### §3.5 — Spike (`app/app/reportes-spike.tsx`)

`SpikeVariant += 'destete-ok' | 'destete-leyenda' | 'destete-sin-destete' | 'destete-sin-meses' | 'destete-12m'`. `DesteteVariant` (molde `ParicionVariant`) reusa `weaningCardView` + `KpiCard` + `InfoNote` (mismos componentes que producción). Datos mock por estado:
- `destete-ok` — `status:'ok'`, `weaned:40`, `serviced:46`, `pendingWeaning:0` → "87 %" (o similar), sin leyenda.
- `destete-leyenda` — `status:'ok'`, `weaned:28`, `serviced:46`, `pendingWeaning:9` → % + leyenda.
- `destete-sin-destete` — `status:'not_weaning_season'`, `weaned:0`, `serviced:46`, `pendingWeaning:0`.
- `destete-sin-meses` — `status:'no_service_months'`, `weaned:0`, `serviced:0`, `pendingWeaning:0`.
- `destete-12m` — `status:'not_applicable_12m'`, `weaned:0`, `serviced:46`, `pendingWeaning:0`.

---

## §4 — Gate 2.5: `app/e2e/captures/destete-kpi.capture.ts`

Molde = `paricion-fix.capture.ts` (convención ADR-029: `test`/`expect` de `./helpers/fixtures`; viewport mobile 412×915 de `playwright.capture.config.ts`; `shot(page, name)` + `assertTextNotClipped`; salida a `e2e/captures/__shots__/destete-kpi/<NN>-<estado>.png`, gitignored). `.capture.ts` → NO corre en `pnpm e2e`. Para cada estado: `goto('/reportes-spike?variant=destete-*')` → asserts del texto clave visible → screenshot nombrado:
- `01-ok-con-porcentaje` — el %destete + "N destetados / M servidas" (sin leyenda).
- `02-not-weaning-season` — "todavía no empezó el destete" (NO 0%).
- `03-no-service-months` — "sin meses de servicio configurados".
- `04-not-applicable-12m` — "no aplica (servicio todo el año)".
- `05-ok-con-leyenda` — % + "todavía hay crías sin destetar, esto puede afectar el dato".

Anti-recorte (RWK.8.2) sobre "Destete", "todavía no empezó el destete", "sin meses de servicio configurados" (memoria `feedback_descender_clipping`: g/j/p/q/y). Cuidado `reference_e2e_design_png_rerender`: revertir `design/**` si el build re-renderiza PNGs (no `git add -A` tras el capture).

---

## §5 — Tests no-bypass backend (`supabase/tests/reports/run.cjs`)

**TR.11 nuevo** (`rodeo_weaning_kpi`), fechas RELATIVAS a `new Date()` (determinismo del CI; molde TR.4b). Reusa fixtures `createRodeo`/`setServiceMonths`/`createAnimal`/`reproductive_events`. Para vincular cría↔parto sin `register_birth`, sembrar el `birth_calves` por `admin` (service_role bypassa RLS) — o insertar un `birth` con `calf_sex` para que el trigger mono-ternero cree la cría + la fila `birth_calves`, y leer la cría creada (`calf_id`/`birth_calves`). **Preferir el trigger** (`insert reproductive_events {event_type:'birth', calf_sex:'female', event_date}` → crea la cría + `birth_calves`), luego `weaning` sobre `bc.calf_profile_id`.

- **RWK.9.1** — `service_months` NULL y `{}` → `status='no_service_months'`.
- **RWK.9.2** — los 12 meses → `status='not_applicable_12m'` (precede a `not_weaning_season`).
- **RWK.9.3** — campaña con partos (concepción ∈ ventana ya pasada, ej. `service_months=[1]`, `p_year=lastYear`) pero SIN destete → `status='not_weaning_season'`, `weaned=0`.
- **RWK.9.4** — destetar la(s) cría(s) de la campaña (`weaning` sobre el `calf_profile_id`) → `status='ok'`, `weaned` correcto; incluir el caso wrap (`service_months=[11,12,1]`, parto cuya concepción ∈ {11,12,1}).
- **RWK.9.5** — `pending_weaning`: 2 crías de la campaña, 1 destetada → `weaned=1`, `pending_weaning=1`; destetar la 2ª → `weaned=2`, `pending_weaning=0`. Un `weaning` con `deleted_at` no borrado-cuenta (soft-delete → vuelve a `pending`).
- **RWK.9.6** — parto fuera de `service_months` (concepción en un mes no incluido) → NO aporta a `weaned` ni a `pending_weaning`. Mellizos: `register_birth` con 2 crías, ambas destetadas, de 1 servida → `weaned=2 > serviced=1` (%>100%).
- **RWK.9.7** — IDOR: `clientB.rpc('rodeo_weaning_kpi', {rodeo de A})` → `42501`. Extender **TR.10** grants: agregar `['rodeo_weaning_kpi', {p_rodeo_id: ghost, p_year: thisYear()}]` al array de `anon`-no-ejecuta (10 RPC). Read-only: agregar una llamada a `rodeo_weaning_kpi` en el test de "no mutan filas".

La suite ya corre contra el remoto y falla-hasta-apply; verde tras aplicar `0118`.

### §5.1 — As-built del delta (reconciliación implementer, 2026-07-01)

Notas de cómo quedó construido TR.11 (no cambian el contrato ni la semántica; robustez de test + defensa):

- **Crías MACHO en todos los seed (determinismo del CI).** Un evento `weaning` sobre una cría HEMBRA la promueve a `vaquillona` vía `compute_category` (`0062:94`, `v_has_weaning`); si el CI corre >365 días después del parto sembrado, esa `vaquillona` entraría al fallback por edad de `rodeo_serviced_females` (`0105:141`) e inflaría `serviced` → non-determinismo por fecha. `rodeo_serviced_females` filtra `a.sex='female'`, así que una cría MACHO (`ternero`/`torito`) NUNCA infla `serviced`. Por eso el seed usa `calf_sex:'male'` en todos los partos (mono y mellizos), incluido el caso `weaned=2 > serviced=1` (%>100%). No afecta `weaned`/`pending_weaning` (cuentan crías vía `birth_calves`, independientes del sexo/categoría de la cría).
- **Imputación por año de servicio verificada explícitamente.** El `weaning` de la cría de la campaña `lastYear` se sella en `lastYear+1` (año calendario siguiente al parto) y la RPC se llama con `p_year=lastYear` → `weaned=1`: prueba que la imputación es por la campaña de ORIGEN (RWK.2.2), no por el año calendario del destete.
- **Asserts defensivos agregados (RWK.6.3/6.4):** además del IDOR (42501), TR.11 verifica la cota `p_year` (1800 → `22023`) y el rodeo inexistente (`P0002`), reflejando el guard del design §2.2/§2.3. Son cobertura extra sobre lo listado en `tasks-destete-kpi.md` T9 (que sólo nombraba el IDOR); no cambian el contrato.
- **Capture NO depende del apply.** `app/e2e/captures/destete-kpi.capture.ts` recorre el spike MOCK (`?variant=destete-*`, mismos componentes que producción), igual que `paricion-fix.capture.ts` — NO necesita la migración `0118` aplicada. El leader puede correrlo en el Gate 2.5 sin esperar el deploy (a diferencia de la suite backend TR.11, que sí es roja-hasta-apply).

---

## §6 — Alternativa descartada

**Descartada: derivar el %destete en el FRONTEND** (que no haya RPC y el cliente cruce partos + destetes con datos locales de PowerSync).
**Por qué no**: (a) los reportes son **online-only / server-side** (`reports.ts` §, R7.2): los eventos crudos (`reproductive_events`, `birth_calves`) no se sincronizan para reportes → el cliente NO tiene el grafo parto→cría→destete cargado; (b) la ventana de campaña (concepción −9 ∈ `service_months`, con wrap) + el vínculo `birth_calves` ya viven server-side en `calved`/`compute_nursing` → duplicarlos en el cliente rompe la fuente única (design §5.7 de `0106`). Poner el KPI en una RPC nueva mantiene un solo lugar auditable (Gate 1) y una card "tonta". El costo (una migración `CREATE` + re-grant) es aceptable y está autorizado.

**También descartada: reutilizar/ampliar `rodeo_calving_kpi` agregando columnas `weaned`/`pending_weaning`/`status_weaning`** al mismo `returns table`.
**Por qué no**: (a) obligaría a un DROP+CREATE de una RPC ya cerrada y deployada (#8) — más superficie de regresión, y el context (No-alcance) dice explícitamente "NO cambiar `rodeo_calving_kpi`"; (b) mezcla dos KPIs con estados independientes (`not_calving_season` date-driven vs `not_weaning_season` data-driven) en un contrato → más difícil de testear y de mapear. Una RPC por KPI (como las 9 vigentes) es el patrón del repo. Se elige la **RPC nueva** `rodeo_weaning_kpi`.

---

## §7 — Decisiones de criterio propio (a confirmar en Puerta 1)

- **CD-1 — Shape del contrato**: `rodeo_weaning_kpi` devuelve exactamente `is_configured, serviced, weaned, pending_weaning, status` (5 columnas; NO incluye `entoradas`/`pregnant` — el %destete solo necesita servidas + destetadas). RPC NUEVA → `CREATE` directo, con revoke public/anon OBLIGATORIO. (§2.1/§2.2)
- **CD-2 — `not_weaning_season` DATA-DRIVEN (`weaned = 0`)**, no date-driven. A diferencia de `not_calving_season` de #8 (`current_date < ventana +9`), el destete no tiene ventana determinística (cae 6-8 meses tras el parto, muy variable). D3 lo define como "antes del 1er destete de la campaña" → `weaned = 0`. *A confirmar*: que "mostrar desde el 1er destete" se lee como "en cuanto se destete ≥1 cría de la campaña", no "durante una ventana calendárica de destete".
- **CD-3 — Layout de la card**: Destete en un segundo `KpiRow` a ancho completo, debajo de Preñez | Parición (funnel del ciclo). Descartado el 3-across por riesgo de recorte a 412px. (§3.4)
- **CD-4 — Definición exacta de `weaned`/`pending_weaning`**: crías DISTINCT (`birth_calves.calf_profile_id`) de partos de servidas con concepción ∈ (p_year, service_months), split por `exists`/`not exists` de un `weaning` no borrado sobre la cría. `weaned` cuenta crías (no eventos, no partos) → mellizos suman ambos; `%destete` puede exceder 100 % (D1, correcto). (§2.2)
- **CD-5 — El JOIN de la ventana** reusa TAL CUAL el set-membership del `calved` de `0117:84-94` (concepción = `event_date − interval '9 months'`, set-membership con wrap), extendido con `join birth_calves` + `exists/not exists weaning` (molde `compute_nursing` `0061`). (§2.2)
- **CD-6 — Copys es-AR** propuestos (a ajustar por Raf): "todavía no empezó el destete" · "sin meses de servicio configurados" · "no aplica (servicio todo el año)" · leyenda D4 textual del context ("todavía hay crías sin destetar, esto puede afectar el dato") · detalle "N destetados / M servidas".
- **CD-7 — Default defensivo del cliente**: `status` ausente/desconocido → `'ok'`; `pending_weaning` ausente → 0 (compat si el cliente corre antes de aplicar `0118`).

---

## §8 — Orden de ejecución (resumen; detalle en `tasks-destete-kpi.md`)

Backend primero (migración `0118` + suite TR.11), frontend después (datos → pura → hook → pantalla → spike), capture al final. La migración la aplica el **leader por MCP** tras Gate 1 + reviewer + Gate 2 + Gate 2.5. Nunca se aplica desde el implementer.
