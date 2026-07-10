# Spec 07 — Delta %DESTETE: RPC nuevo `rodeo_weaning_kpi` (#10) — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** · **Gate 1 OBLIGATORIO** · **Deploy AUTORIZADO** (leader aplica por MCP). **Migración nueva: `0118`**.
**Orden**: backend (migración + tests) → frontend (datos → pura → hook → pantalla → spike) → capture. La migración la aplica el **leader por Supabase MCP** tras Gate 1 + reviewer + Gate 2 + Gate 2.5. NO se aplica desde el implementer.

Cada tarea lleva `[ ]` (la marca el implementer) + los `RWK.<n>` que cubre. El reviewer rechaza si queda `[ ]` sin justificación.

---

## Bloque A — Backend (migración `0118`)

- [x] **T1 — Verificar que `rodeo_weaning_kpi` NO existe en el remoto** (`rg rodeo_weaning_kpi supabase/migrations/*.sql` → vacío) antes de escribir la migración. Confirmar que `0118` es el siguiente número libre (0117 = última). Cubre: RWK.6.6.

- [x] **T2 — Crear `supabase/migrations/0118_weaning_kpi.sql`**: `begin;` → `create function public.rodeo_weaning_kpi(p_rodeo_id uuid, p_year int) returns table(is_configured boolean, serviced int, weaned int, pending_weaning int, status text) language plpgsql security definer stable set search_path = public ...`. Guard/cota/tenant moldeados sobre `0117:43-52`. Cubre: RWK.1.1, RWK.6.1, RWK.6.2, RWK.6.3, RWK.6.4.

- [x] **T3 — Denominador de Stream A** dentro de la función: `is_configured` de `rodeo_service_campaign`, `serviced` de `rodeo_repro_denominator` (sin re-derivar). Cubre: RWK.1.2.

- [x] **T4 — `weaned` (RWK.2)**: `count(distinct bc.calf_profile_id)` de crías vinculadas por `birth_calves` a un parto de una servida cuya concepción (`event_date − interval '9 months'`) ∈ (p_year, mes ∈ service_months) — mismo set-membership que `calved` (`0117:84-94`, incl. wrap) — con `exists` de un `weaning` no borrado sobre la cría. JOIN molde `compute_nursing` (`0061:29-42`). Imputación por año de servicio. Cubre: RWK.2.1, RWK.2.2, RWK.2.3, RWK.2.4.

- [x] **T5 — `pending_weaning` (D4)**: mismo JOIN que T4 con `not exists` del `weaning` no borrado (crías de la campaña todavía al pie). Cubre: RWK.3.1.

- [x] **T6 — `status` con precedencia**: `no_service_months` (NULL/`{}`) → `not_applicable_12m` (cardinality=12) → `not_weaning_season` (`weaned = 0`) → `ok`. `weaned`/`pending_weaning` se computan SIEMPRE (status gatea solo el display). Cubre: RWK.3.2, RWK.5.1, RWK.5.2, RWK.5.3.

- [x] **T7 — Re-`revoke`/`grant` + smoke-check + `notify pgrst`** por firma `(uuid, int)` (RPC nueva → default = EXECUTE a PUBLIC): `revoke execute ... from public, anon` + `grant execute ... to authenticated` + smoke-check fail-closed acotado a `rodeo_weaning_kpi` (patrón `0117:169-185`) + `notify pgrst, 'reload schema'; commit;`. Cubre: RWK.6.5.

- [x] **T8 — No tocar `rodeo_calving_kpi` ni las otras 9 RPC** ni Stream A. La migración `0118` contiene SOLO `rodeo_weaning_kpi`. Cubre: RWK.6.6.

## Bloque B — Backend (tests no-bypass)

- [x] **T9 — Extender `supabase/tests/reports/run.cjs` con TR.11** (`rodeo_weaning_kpi`), fechas relativas a `new Date()`; para vincular cría↔parto usar el trigger mono-ternero (`insert birth {calf_sex}` → crea la cría + `birth_calves`) o `register_birth` (mellizos), luego `weaning` sobre el `calf_profile_id`:
  - `service_months` NULL y `{}` → `status='no_service_months'` (RWK.9.1).
  - los 12 meses → `status='not_applicable_12m'`, precede a la ventana (RWK.9.2).
  - partos de la campaña SIN destete → `status='not_weaning_season'`, `weaned=0` (RWK.9.3).
  - crías destetadas de la campaña → `status='ok'`, `weaned` correcto + caso wrap `[11,12,1]` (RWK.9.4).
  - `pending_weaning`: 2 crías, 1 destetada → `weaned=1`/`pending_weaning=1`; destetar la 2ª → `weaned=2`/`pending_weaning=0`; `weaning` soft-deleteado → vuelve a `pending` (RWK.9.5).
  - parto fuera de `service_months` → no aporta; mellizos (2 crías destetadas de 1 servida) → `weaned=2 > serviced=1` (RWK.9.6).
  - IDOR (owner B → `42501`) (RWK.9.7).

- [x] **T10 — Extender TR.10 (transversal)**: agregar `rodeo_weaning_kpi` al array de `anon`/`public`-no-ejecuta (10 RPC) y una llamada a `rodeo_weaning_kpi` en el test read-only (no muta filas). Cubre: RWK.9.7.

## Bloque C — Frontend (datos + presentación pura)

- [x] **T11 — `app/src/utils/reports-format.ts`**: `export type WeaningStatus`; `WEANING_STATUSES`; `asWeaningStatus`; `WEANING_PENDING_LEGEND`; `export type WeaningCardView`; `export function weaningCardView(kpi)` que devuelve `{value, detail?, note?, legend?, muted}` según la tabla de design §3.2 (reusa `safePercent`/`formatPercentAR`; molde `calvingCardView`). Cubre: RWK.7.2, RWK.3.3, RWK.3.4, RWK.4.1, RWK.4.2, RWK.5.4, RWK.5.5, RWK.1.3, RWK.1.4.

- [x] **T12 — `app/src/services/reports.ts`**: `type WeaningKpi`; `WeaningRow` (snake); `fetchWeaningKpi(rodeoId, year)` (import `asWeaningStatus`/`WeaningStatus`; default defensivo: status ausente→`'ok'`, pending ausente→0). Cubre: RWK.7.1, CD-7.

- [x] **T13 — `app/src/hooks/use-reports.ts`**: `RodeoKpis += weaning`; `weaningFetcher` memoizado por `(rodeoId, year)`; `weaning: useReport(ready ? weaningFetcher : null)`. Cubre: RWK.7.1.

- [x] **T14 — `app/src/utils/reports-format.test.ts`**: casos de `weaningCardView` — ok con %, ok con leyenda (pendingWeaning>0), ok sin leyenda (pending=0), ok serviced=0 → "—", not_weaning_season, no_service_months, not_applicable_12m, kpi=null, y %>100% (mellizos, ej. weaned=2/serviced=1). Cubre: RWK.7.2 (verifica RWK.1.3/1.4/3.3/3.4/4.1/4.2/5.4/5.5).

## Bloque D — Frontend (pantalla + spike)

- [x] **T15 — `app/app/(tabs)/reportes.tsx` `ReproSection`**: consume `kpis.weaning`; `const wv = weaningCardView(weaning.data)`; card de Destete en un segundo `KpiRow` (ancho completo) debajo de Preñez | Parición; leyenda D4 vía `InfoNote` bajo ese `KpiRow` cuando `wv.legend`; `useFocusEffect` + `reloadRepro` recargan `weaning`. Sin tocar los gates de sección ni preñez/parición/CCL/peso/alertas. Cubre: RWK.7.3, RWK.7.5, RWK.4.1.

- [x] **T16 — `app/app/reportes-spike.tsx`**: variantes `destete-ok`, `destete-leyenda`, `destete-sin-destete`, `destete-sin-meses`, `destete-12m` + `DesteteVariant` (reusa `weaningCardView`+`KpiCard`+`InfoNote`). Extender `SpikeVariant` + el switch. Cubre: RWK.7.2, RWK.7.4.

- [x] **T17 — Anti-recorte + es-AR + tokens** en todos los textos nuevos ("Destete", notas de estado, leyenda): `lineHeight` matcheado, coma decimal, cero hardcode. Cubre: RWK.7.4.

## Bloque E — Gate 2.5 (capture)

- [x] **T18 — Crear `app/e2e/captures/destete-kpi.capture.ts`** (molde ADR-029 `paricion-fix.capture.ts`): 5 capturas NOMBRADAS de los 5 estados navegando al spike (`?variant=destete-*`) a viewport mobile 412×915 + `assertTextNotClipped` sobre "Destete", "Todavía no empezó el destete", "Sin meses de servicio configurados". Salida `e2e/captures/__shots__/destete-kpi/<NN>-<estado>.png` (gitignored). Cubre: RWK.8.1, RWK.8.2.

- [ ] **T19 — Correr el capture** (`playwright.capture.config.ts`) y vetar (leader design-review) antes de mostrar a Raf; revertir `design/**` si el build re-renderizó PNGs (`reference_e2e_design_png_rerender`). Cubre: RWK.8.1. **[LEADER — Gate 2.5]**: el `.capture.ts` está escrito y usa el spike MOCK (NO depende del apply de `0118`); el leader lo corre en el Gate 2.5.

## Bloque F — Cierre

- [x] **T20 — Autorrevisión adversarial del implementer** (paso 8 de su protocolo) + `progress/impl_destete-kpi.md` con el mapa `RWK.<n> → archivo:test`. Cubre: trazabilidad.

- [x] **T21 — Reconciliación**: si Gate 1/reviewer/Gate 2 cambian algo, reflejarlo en `{requirements,design,tasks}-destete-kpi.md` antes de commitear (regla `feedback_correcciones_en_specs`). Al cerrar (Puerta 2): puntero + nota as-built bajo R7.6 en `requirements.md` baseline + entrada en "Deltas posteriores" de `design.md` baseline (ADR-028).

- [ ] **T22 — Deploy (LEADER, no implementer)**: aplicar `0118_weaning_kpi.sql` por Supabase MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5; correr `supabase/tests/reports/run.cjs` verde post-apply (incl. TR.11); `node scripts/check.mjs` verde. Cubre: RWK.6.5, RWK.9.*. **[LEADER — pendiente]**: el implementer NO aplica la migración.
