# Spec 07 — Delta %PARICIÓN: fix del 0% + lógica de meses de parto (#8) — Requirements (EARS)

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** (RPC `rodeo_calving_kpi`) · **Gate 1 OBLIGATORIO** · **Deploy AUTORIZADO** por Raf (2026-06-30 — la migración la aplica el leader por Supabase MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5).
**Fecha**: 2026-06-30.
**Fuente de verdad**: `specs/active/07-reportes-basicos/context-paricion-fix.md` (Gate 0 aprobado). Las decisiones de dominio D1–D5 ya las cerró Raf — acá se traducen a EARS, no se re-deciden.
**Baseline**: `requirements.md` R7.6 (%parición). Este delta NO reescribe el baseline; los IDs `R7.*` no se tocan. Numeración propia `RPF.<n>` ("Reporte Parición Fix").

---

## Cobertura de las decisiones de dominio (context §"Decisiones de dominio")

| Decisión (context) | Requisito(s) que la cubre |
|---|---|
| **D1** — meses de parto = meses de servicio **+9** (por mes, no por día) | RPF.2.1 |
| **D2** — %parición se muestra SOLO en/desde los meses de parto; fuera → "Todavía no es época de parición" (no 0%) | RPF.2.2, RPF.2.3, RPF.2.4, RPF.2.5 |
| **D3** — `service_months` vacío/NULL ≠ 0% → "Sin meses de servicio configurados" | RPF.1.1, RPF.1.2, RPF.1.3 |
| **D4** — leyenda OBLIGATORIA si quedan preñadas sin parir ni abortar | RPF.4.1, RPF.4.2, RPF.4.3 |
| **D5** — rodeo de servicio continuo 12 meses → no mostrar parición | RPF.3.1, RPF.3.2, RPF.3.3 |

Requisitos transversales (contrato/seguridad/UI/tests): RPF.5, RPF.6, RPF.7, RPF.8.

> **Reconciliación (casing corregido a sentence-case, 2026-07-10)**: los copys user-facing de la card citados abajo se muestran con inicial en mayúscula (sentence-case, resto idéntico), alineados con el resto de la app. Solo cambia la primera letra; la lógica no se toca.

---

## RPF.1 — `service_months` vacío/NULL → estado `no_service_months`, NO 0% (D3)

- **RPF.1.1** — Cuando se invoca `rodeo_calving_kpi(p_rodeo_id, p_year)` y el rodeo tiene `service_months` NULL o de cardinalidad 0, el sistema deberá devolver `status = 'no_service_months'`.
- **RPF.1.2** — Si el estado es `no_service_months`, entonces el sistema no deberá exponer un porcentaje de parición (la card no calcula ni muestra `calved / serviced × 100`).
- **RPF.1.3** — Cuando la card de Parición recibe `status = 'no_service_months'`, el sistema deberá mostrar el mensaje accionable "Sin meses de servicio configurados" en lugar de un 0%.

> Nota de composición (no re-decisión): con `service_months` NULL, la sección Reproductivo ya corta antes con la card "Configurá la estación de servicio" (`is_configured = false`, baseline R7.5.6 sin cambios). El estado `no_service_months` de la RPC se materializa en la card de Parición en el caso `{}` (array vacío = "no hace servicio", `is_configured = true`) y como cinturón defensivo. Ver design §3.3.

## RPF.2 — Ventana de meses de parto = servicio +9; fuera de la ventana → `not_calving_season` (D1/D2)

- **RPF.2.1** — El sistema deberá derivar el inicio de la ventana de meses de parto de la campaña como el menor `make_date(p_year, m, 1) + interval '9 months'` sobre cada `m ∈ service_months` (mes de parto = mes de servicio +9; año calendario derivado de esa suma, consistente con el modelo set-membership vigente).
- **RPF.2.2** — Mientras `current_date` sea anterior al inicio de la ventana de meses de parto de la campaña (y el rodeo no sea de servicio continuo 12 meses), el sistema deberá devolver `status = 'not_calving_season'`.
- **RPF.2.3** — Cuando `current_date` sea igual o posterior al inicio de la ventana de meses de parto (y el rodeo tenga entre 1 y 11 meses de servicio), el sistema deberá devolver `status = 'ok'`.
- **RPF.2.4** — Cuando la card de Parición recibe `status = 'not_calving_season'`, el sistema deberá mostrar "Todavía no es época de parición" en lugar de un 0%.
- **RPF.2.5** — Cuando la card de Parición recibe `status = 'ok'`, el sistema deberá mostrar el %parición (`calved / serviced × 100`, formato es-AR) y el detalle "N paridas / M servidas".

## RPF.3 — Rodeo de servicio continuo 12 meses → estado `not_applicable_12m` (D5)

- **RPF.3.1** — Cuando el rodeo tiene los 12 meses en `service_months` (cardinalidad = 12), el sistema deberá devolver `status = 'not_applicable_12m'`.
- **RPF.3.2** — El sistema deberá evaluar `not_applicable_12m` con precedencia sobre `not_calving_season` (un rodeo de 12 meses nunca cae en `not_calving_season`).
- **RPF.3.3** — Cuando la card de Parición recibe `status = 'not_applicable_12m'`, el sistema deberá mostrar "No aplica (servicio todo el año)" en lugar de un porcentaje.

## RPF.4 — Leyenda de preñadas que no parieron (D4)

- **RPF.4.1** — El sistema deberá calcular `pending_pregnant` = cantidad de hembras servidas actualmente preñadas (último tacto+ vigente: `pregnancy_status <> 'empty'` sin aborto posterior, mismo criterio que `pregnant`) que NO tienen un parto contado en la ventana de la campaña.
- **RPF.4.2** — Cuando `status = 'ok'` y `pending_pregnant > 0`, el sistema deberá mostrar la leyenda "Todavía hay vacas que no parieron, esto puede afectar el dato".
- **RPF.4.3** — Si `pending_pregnant = 0` o `status <> 'ok'`, entonces el sistema no deberá mostrar la leyenda.

## RPF.5 — Preservar denominador + tenant-scoping + contrato de seguridad (as-built de `0106`)

- **RPF.5.1** — El sistema deberá conservar el denominador vigente (`serviced`/`entoradas` derivados de `rodeo_repro_denominator` / `rodeo_serviced_females`) sin re-derivarlo a mano.
- **RPF.5.2** — El sistema deberá conservar la definición vigente de `calved` (servidas con ≥1 `birth` no borrado cuya concepción `event_date − interval '9 months'` cae en `p_year` con mes ∈ `service_months`, por set-membership — no `BETWEEN`).
- **RPF.5.3** — El sistema deberá mantener `rodeo_calving_kpi` como `SECURITY DEFINER STABLE` con `set search_path = public`, guard `has_role_in(v_est)` fail-closed y cota de `p_year` (1900..current+1).
- **RPF.5.4** — Si un usuario sin rol en el establecimiento del rodeo invoca la RPC, entonces el sistema deberá rechazar con `42501` (no devolver un estado/valor vacío silencioso).
- **RPF.5.5** — El sistema deberá dejar la RPC revocada para `public`/`anon` y con `grant execute` a `authenticated` tras recrearla, verificado por smoke-check fail-closed.
- **RPF.5.6** — El sistema no deberá alterar el contrato ni el comportamiento de las otras 8 RPC de `0106_reports_rpcs.sql`.

## RPF.6 — Consumo frontend (`reports.ts` / `reports-format.ts` / `KpiCard` / pantalla)

- **RPF.6.1** — El sistema deberá mapear la nueva columna `status` a un enum `CalvingStatus` y `pending_pregnant` a `pendingPregnant` en la capa de datos (`CalvingKpi`).
- **RPF.6.2** — La card de Parición deberá derivar su presentación (porcentaje / mensaje de estado / leyenda) del `status` + `pendingPregnant` mediante una función pura testeable, reusando `KpiCard` y `formatPercentAR`.
- **RPF.6.3** — El sistema deberá respetar tokens (ADR-023), formato es-AR (coma decimal) y anti-recorte de descendentes (`lineHeight` matcheado) en todos los textos nuevos.
- **RPF.6.4** — El sistema no deberá romper el render de las otras secciones de la pantalla de reportes (preñez, distribución CCL, cruce con nacimientos, peso por categoría, alertas, sesiones).

## RPF.7 — Gate 2.5: capture file de los estados de la card

- **RPF.7.1** — El sistema deberá incluir `app/e2e/captures/paricion-fix.capture.ts` que capture los estados de la card de Parición: (a) `ok` con %, (b) `not_calving_season`, (c) `no_service_months`, (d) `not_applicable_12m`, (e) `ok` con la leyenda de preñadas sin parir.
- **RPF.7.2** — El capture deberá verificar anti-recorte de descendentes (`scrollHeight ≤ clientHeight`) en los textos con descendentes: "Parición", "Todavía no es época de parición", "Sin meses de servicio configurados".

## RPF.8 — Tests no-bypass del backend (suite `supabase/tests/reports/run.cjs`)

- **RPF.8.1** — La suite deberá verificar que con `service_months` NULL o `{}` la RPC devuelve `status = 'no_service_months'` (y no un porcentaje/`calved` que la UI lea como 0%).
- **RPF.8.2** — La suite deberá verificar que, con la campaña cuyo inicio de ventana de parto es futuro respecto de `current_date`, la RPC devuelve `status = 'not_calving_season'`.
- **RPF.8.3** — La suite deberá verificar que, dentro/después de la ventana de parto y con partos cargados, la RPC devuelve `status = 'ok'` con el `calved` correcto (incluido el wrap de fin de año, R7.5.8).
- **RPF.8.4** — La suite deberá verificar que un rodeo con los 12 meses de servicio devuelve `status = 'not_applicable_12m'`.
- **RPF.8.5** — La suite deberá verificar que `pending_pregnant > 0` cuando quedan hembras preñadas sin parto contado, y `= 0` cuando todas las preñadas tienen parto en la campaña.
- **RPF.8.6** — La suite deberá preservar los asserts vigentes de TR.4 (wrap, `pregnant ≥ calved`, `serviced = 0` sin NaN) y de tenant-isolation/IDOR (42501) sobre `rodeo_calving_kpi`.

---

## Trazabilidad y reconciliación

- Cada `RPF.<n>` es verificable por ≥1 test: RPF.1–RPF.5 y RPF.8 por la suite `supabase/tests/reports/run.cjs`; RPF.6 por `app/src/utils/reports-format.test.ts` (función pura `calvingCardView`); RPF.7 por el capture file (Gate 2.5). El mapa `RPF.<n> → archivo:test` lo documenta el implementer en `progress/impl_paricion-fix.md`.
- **Reconciliación de cierre (Puerta 2)**: al cerrar el delta se folda al baseline un puntero + nota as-built bajo R7.6 (`requirements.md`) y un bloque "Deltas posteriores" en `design.md` baseline (ADR-028). No se reescribe el baseline.
- Toda corrección surgida en Gate 1 / reviewer / Gate 2 se reconcilia en estos tres archivos antes de commitear (regla `feedback_correcciones_en_specs`).
