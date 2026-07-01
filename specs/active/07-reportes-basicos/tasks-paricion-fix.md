# Spec 07 — Delta %PARICIÓN: fix del 0% + lógica de meses de parto (#8) — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** · **Gate 1 OBLIGATORIO** · **Deploy AUTORIZADO** (leader aplica por MCP).
**Orden**: backend (migración + tests) → frontend → capture. La migración la aplica el **leader por Supabase MCP** tras Gate 1 + reviewer + Gate 2 + Gate 2.5. NO se aplica desde el implementer.

Cada tarea lleva `[ ]` (la marca el implementer) + los `RPF.<n>` que cubre. El reviewer rechaza si queda `[ ]` sin justificación.

---

## Bloque A — Backend (migración)

- [x] **T1 — Verificar el cuerpo VIGENTE de `rodeo_calving_kpi` en el remoto** antes de escribir la migración (regla `reference_function_recreate_base`). Confirmar que coincide con `0106:285-343` (firma, guard, denominador, `calved`). Si difiere, moldear sobre el remoto. Cubre: RPF.5.1, RPF.5.2.

- [x] **T2 — Crear `supabase/migrations/0117_calving_kpi_status.sql`**: `begin;` → `DROP FUNCTION public.rodeo_calving_kpi(uuid, int);` → `CREATE FUNCTION rodeo_calving_kpi(p_rodeo_id uuid, p_year int) returns table(is_configured boolean, serviced int, entoradas int, pregnant int, calved int, status text, pending_pregnant int) ...`. Preservar guard/cota/denominador/`pregnant`/`calved` del vigente. Cubre: RPF.5.1, RPF.5.2, RPF.5.3.

- [x] **T3 — `calved`/`pregnant` sin cambios de conteo** dentro de la nueva función (set-membership concepción−9 ∈ (p_year, service_months), incl. wrap; `pregnant` = tacto+ vigente). Cubre: RPF.5.2.

- [x] **T4 — `pending_pregnant` (D4)**: `count(distinct)` de servidas preñadas (tacto+ vigente, `<> empty` sin aborto posterior) SIN parto contado en la ventana. Cubre: RPF.4.1.

- [x] **T5 — `status` con precedencia**: `no_service_months` (NULL/`{}`) → `not_applicable_12m` (cardinality=12) → `not_calving_season` (`current_date < min(make_date(p_year,m,1)+9mo)`) → `ok`. `calved`/`pending_pregnant` se computan SIEMPRE (status gatea solo display). Cubre: RPF.1.1, RPF.2.1, RPF.2.2, RPF.2.3, RPF.3.1, RPF.3.2.

- [x] **T6 — Re-`revoke`/`grant` + smoke-check + `notify pgrst`** por firma `(uuid, int)` (el DROP+CREATE resetea privilegios): `revoke execute ... from public, anon` + `grant execute ... to authenticated` + smoke-check fail-closed acotado a `rodeo_calving_kpi` (patrón `0106:730-750`) + `notify pgrst, 'reload schema'; commit;`. Cubre: RPF.5.5.

- [x] **T7 — No tocar las otras 8 RPC de `0106`** ni Stream A (`0105`). La migración `0117` contiene SOLO `rodeo_calving_kpi`. Cubre: RPF.5.6.

## Bloque B — Backend (tests no-bypass)

- [x] **T8 — Extender `supabase/tests/reports/run.cjs` (TR.4 / TR.4b)**, fechas relativas a `new Date()`:
  - `service_months=[]` y NULL → `status='no_service_months'` (RPF.8.1).
  - `service_months=[mesActual]`, `p_year=thisYear()` → ventana +9 futura → `status='not_calving_season'` (RPF.8.2).
  - `service_months` con ventana +9 ya pasada + partos ∈ ventana → `status='ok'` + `calved` esperado; **conservar** el caso wrap `[11,12,1]` con `calved=2` (RPF.8.3, RPF.8.6).
  - `service_months` = los 12 meses → `status='not_applicable_12m'` (RPF.8.4).
  - `pending_pregnant`: 2 preñadas, 1 con parto → `pending_pregnant=1`; agregar el 2º parto → `0` (RPF.8.5).
  - Preservar asserts vigentes de TR.4 (wrap, `pregnant≥calved`, serviced=0 sin NaN) + IDOR 42501 (RPF.8.6).

## Bloque C — Frontend (datos + presentación pura)

- [x] **T9 — `app/src/services/reports.ts`**: `CalvingRow` += `status`,`pending_pregnant`; `CalvingKpi` += `status: CalvingStatus`,`pendingPregnant`; `fetchCalvingKpi` mapea (default defensivo: status ausente→`'ok'`, pending ausente→0). Cubre: RPF.6.1, CD-6.

- [x] **T10 — `app/src/utils/reports-format.ts`**: `export type CalvingStatus`; `export function calvingCardView(kpi)` que devuelve `{value, detail?, note?, legend?, muted}` según la tabla de design §3.2 (reusa `safePercent`/`formatPercentAR`). Cubre: RPF.6.2, RPF.1.3, RPF.2.4, RPF.2.5, RPF.3.3, RPF.4.2, RPF.4.3.

- [x] **T11 — `app/src/utils/reports-format.test.ts`**: casos de `calvingCardView` — ok con %, ok con leyenda (pendingPregnant>0), ok sin leyenda (pending=0), ok serviced=0 → "—", not_calving_season, no_service_months, not_applicable_12m, kpi=null. Cubre: RPF.6.2 (verifica RPF.1.3/2.4/2.5/3.3/4.2/4.3).

## Bloque D — Frontend (pantalla + spike)

- [x] **T12 — `app/app/(tabs)/reportes.tsx` `ReproSection`**: la card de Parición usa `calvingCardView(calv)` (value/detail(note)/muted); leyenda D4 vía `InfoNote` bajo el `KpiRow` cuando `cv.legend`. Sin tocar preñez/CCL/cruce/peso/alertas ni los gates de sección. Cubre: RPF.6.4, RPF.4.2.

- [x] **T13 — `app/app/reportes-spike.tsx`**: variantes `paricion-ok`, `paricion-leyenda`, `paricion-fuera-ventana`, `paricion-sin-meses`, `paricion-12m` (reusan `calvingCardView`+`KpiCard`+`InfoNote`). Extender `SpikeVariant` + el switch. Cubre: RPF.6.2, RPF.6.3.

- [x] **T14 — Anti-recorte + es-AR + tokens** en todos los textos nuevos (leyenda, notas de estado): `lineHeight` matcheado, coma decimal, cero hardcode. Cubre: RPF.6.3.

## Bloque E — Gate 2.5 (capture)

- [x] **T15 — Crear `app/e2e/captures/paricion-fix.capture.ts`** (**as-built: molde ADR-029** `cria-al-pie-alta.capture.ts`/`parto-rodeo-caravana.capture.ts`, no `reportes-spike.capture.ts`): 5 capturas NOMBRADAS de los 5 estados navegando al spike (`?variant=paricion-*`) a viewport mobile 412×915 + `assertTextNotClipped` sobre "Parición", "todavía no es época de parición", "sin meses de servicio configurados". Salida `e2e/captures/__shots__/paricion-fix/<NN>-<estado>.png` (gitignored). Cubre: RPF.7.1, RPF.7.2.

- [x] **T16 — Correr el capture** (`playwright.capture.config.ts`) y vetar (leader design-review) antes de mostrar a Raf; revertir `design/**` si el build re-renderizó PNGs (`reference_e2e_design_png_rerender`). Cubre: RPF.7.1.

## Bloque F — Cierre

- [x] **T17 — Autorrevisión adversarial del implementer** (paso 8 de su protocolo) + `progress/impl_paricion-fix.md` con el mapa `RPF.<n> → archivo:test`. Cubre: trazabilidad.

- [x] **T18 — Reconciliación**: si Gate 1/reviewer/Gate 2 cambian algo, reflejarlo en `{requirements,design,tasks}-paricion-fix.md` antes de commitear (regla `feedback_correcciones_en_specs`). Al cerrar (Puerta 2): puntero + nota as-built bajo R7.6 en `requirements.md` baseline + bloque "Deltas posteriores" en `design.md` baseline (ADR-028).

- [ ] **T19 — Deploy (LEADER, no implementer)**: aplicar `0117_calving_kpi_status.sql` por Supabase MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5; correr `supabase/tests/reports/run.cjs` verde post-apply; `node scripts/check.mjs` verde. Cubre: RPF.5.5, RPF.8.*. — *Estado (as-built): la migración `0117` ya está APLICADA al remoto por el leader (reports suite 15/15 verde incl. TR.4b). El cierre final / Puerta 2 queda del leader → checkbox sin marcar (tarea del leader, no del implementer).*
