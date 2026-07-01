# Spec 07 — Delta %DESTETE: RPC nuevo `rodeo_weaning_kpi` (#10) — Contexto (Gate 0)

**Status**: `context_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** (RPC nuevo) · Gate 1 OBLIGATORIO.
**Fecha**: 2026-07-01.
**Origen**: corrección **#10** del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`). Segmento B (reportes reproductivos). Análogo a #8 (%parición), un paso más adelante en el ciclo.
**Deploy**: **Raf autorizó el deploy en sesión** → el leader aplica la migración por Supabase MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5.
**Gate 0**: aprobado por el leader en modo autónomo — la **semántica la corrigió/decidió Raf** (2026-07-01): #10 **NO depende de #7** (peso al destetar es aparte); **%destete = servidas vs terneros destetados**; imputación **por año de servicio (campaña)**; cartel de parcial **mismo patrón que #8**.

---

## Problema

Hoy **no existe** un KPI de %destete (`rodeo_weaning_kpi`). El destete es solo un evento individual (`reproductive_events.event_type='weaning'`, 0026; se registra por ternero, `buildAddWeaningInsert(profileId=ternero)`; hay destete masivo `applyBulkWeaning`). Falta el número de campaña "de las vacas que servimos, ¿cuántos terneros llegamos a destetar?" — el indicador productivo que cierra el ciclo servida→parida→destetada.

## Decisiones de dominio (confirmadas por Raf, 2026-07-01)

- **D1 — %destete = terneros destetados / servidas.** Numerador = terneros **destetados** (evento `weaning`) de la campaña; denominador = **servidas** del rodeo en la campaña (mismo `rodeo_repro_denominator` que parición). *(Puede superar 100% con mellizos — es correcto: mide terneros logrados por vaca servida.)*
- **D2 — Imputación por AÑO DE SERVICIO (campaña).** Un destete se imputa a la campaña de la que viene el ternero: se sigue el vínculo **servida → parto (concepción ∈ meses de servicio del `p_year`) → `birth_calves` → cría → evento `weaning` de la cría**. El %destete de la campaña `p_year` cuenta crías de esa campaña que se destetaron, **sin importar el año calendario** del destete (el destete cae ~6-8 meses tras el parto, ya en el año siguiente). *(NO se cuenta por año calendario del evento de destete — mezclaría camadas.)*
- **D3 — Mostrar desde el 1er destete de la campaña.** Antes de que se destete la primera cría de la campaña → estado `not_weaning_season` ("todavía no empezó el destete"), NO 0% prematuro (mismo espíritu que `not_calving_season` de #8).
- **D4 — Cartel de destete parcial (mismo patrón que #8/D4).** Si quedan **crías al pie de la campaña sin destetar** (`pending_weaning > 0`), mostrar la leyenda "todavía hay crías sin destetar, esto puede afectar el dato".
- **D5 — `service_months` vacío / 12 meses**: mismos estados que #8 (`no_service_months` / `not_applicable_12m`), por consistencia (un rodeo sin meses de servicio o de servicio continuo no reporta destete de campaña).

## Alcance

- **Backend (deploy)**: RPC **nueva** `rodeo_weaning_kpi(p_rodeo_id uuid, p_year int)` — **moldeada sobre `rodeo_calving_kpi` (0117, el as-built vigente)**: mismo guard/cota/tenant-scoping (`has_role_in`→42501, `p_year` acotado), mismo denominador (`rodeo_repro_denominator`), mismo `SECURITY DEFINER STABLE` + revoke public/anon + grant authenticated + smoke-check fail-closed. Devuelve: `is_configured`, `serviced`, `weaned` (numerador), `pending_weaning` (crías al pie de la campaña sin destetar, D4), y `status` (`no_service_months`/`not_applicable_12m`/`not_weaning_season`/`ok`).
  - **`weaned`** = # distinct crías con evento `weaning` (no borrado) donde la cría está vinculada por `birth_calves` a un parto de una servida cuya concepción ∈ (`p_year`, `service_months`) — misma ventana de campaña que el `calved` de #8, un paso más (parto→cría→destete).
  - **`pending_weaning`** = # crías de partos de la campaña (mismo set que arriba) **sin** evento `weaning` (todavía al pie).
  - **`status`**: `no_service_months` (D5) → `not_applicable_12m` (D5, precedencia) → `not_weaning_season` (D3: `weaned = 0`, aún no empezó el destete de la campaña) → `ok`.
- **Frontend**: una `KpiCard` de **Destete** nueva en la sección Reproductivo de reportes (`reports.ts` + `reports-format.ts` `weaningCardView` puro + `reportes.tsx` + `reportes-spike.tsx` variantes), consumiendo el `status` + `pendingWeaning`. Misma UX que la card de Parición de #8 (muted "—" + mensaje accionable fuera de estado `ok`; % en `ok`; leyenda D4). es-AR, tokens, anti-recorte.
- **Gate 1**: OBLIGATORIO (RPC nueva SECURITY DEFINER). **Gate 2.5**: capture file `app/e2e/captures/destete-kpi.capture.ts` con los estados de la card (ok con %, not_weaning_season, no_service_months, not_applicable_12m, ok+leyenda de parcial).

## No-alcance

- **#7 (peso al destetar)** — columna `weaning_weight` + captura del peso. Aparte, NO lo necesita este KPI (Raf: "#7 es solo el peso al destetar"). El %destete solo cuenta EXISTENCIA del evento `weaning`, no su peso.
- No cambiar `rodeo_calving_kpi` (#8, ya cerrado) ni el modelo del evento `weaning` (ya existe).

## Reúso

- Helpers Stream A: `rodeo_serviced_females(p_rodeo_id, p_year)`, `rodeo_repro_denominator`, `rodeo_service_campaign` (0105).
- Molde de RPC: `rodeo_calving_kpi` (0117) — guard, denominador, status con precedencia, re-grant, smoke-check.
- Vínculo cría↔parto: `birth_calves` (0045). Evento destete: `reproductive_events.event_type='weaning'`.
- Frontend: `calvingCardView`/`CalvingStatus` de #8 como molde de `weaningCardView`/`WeaningStatus`; `KpiCard`; `formatPercentAR`.

## Tareas para la spec

El spec_author redacta `{requirements,design,tasks}-destete-kpi.md` (numeración `RWK.<n>`, "Reporte Weaning Kpi"), moldeando la RPC nueva sobre `rodeo_calving_kpi` (0117), con la suite `supabase/tests/reports/run.cjs` (tests no-bypass por estado + tenant-isolation) y el capture del Gate 2.5. Gate 1 obligatorio. Marcá decisiones de criterio propio (p.ej. el enum de status, la definición exacta de `pending_weaning`, la próxima migración libre = `0118`).
