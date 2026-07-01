# Spec 07 — Delta %DESTETE: RPC nuevo `rodeo_weaning_kpi` (#10) — Requirements (EARS)

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** (RPC NUEVA `rodeo_weaning_kpi`) · **Gate 1 OBLIGATORIO** · **Deploy AUTORIZADO** por Raf (la migración `0118` la aplica el leader por Supabase MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5).
**Fecha**: 2026-07-01.
**Fuente de verdad**: `specs/active/07-reportes-basicos/context-destete-kpi.md` (Gate 0 aprobado). Las decisiones de dominio D1–D5 ya las cerró Raf — acá se traducen a EARS, no se re-deciden.
**Molde**: delta #8 (%parición, `requirements-paricion-fix.md`, RPF.*) — #10 es análogo, un paso más adelante en el ciclo (servida → parto → cría → **destete**). Numeración propia `RWK.<n>` ("Reporte Weaning Kpi"). El baseline `R7.*` NO se toca.

---

## Cobertura de las decisiones de dominio (context §"Decisiones de dominio")

| Decisión (context) | Requisito(s) que la cubre |
|---|---|
| **D1** — %destete = terneros destetados / servidas (puede >100% con mellizos) | RWK.1.1, RWK.1.3, RWK.1.4 |
| **D2** — imputación por AÑO DE SERVICIO (campaña): servida → parto (concepción ∈ campaña) → `birth_calves` → cría → `weaning` | RWK.2.1, RWK.2.2, RWK.2.3, RWK.2.4 |
| **D3** — mostrar desde el 1er destete de la campaña; `weaned=0` → "todavía no empezó el destete", NO 0% | RWK.3.1, RWK.3.2, RWK.3.3 |
| **D4** — cartel de destete parcial si quedan crías al pie sin destetar | RWK.4.1, RWK.4.2 |
| **D5** — `service_months` vacío/NULL o 12 meses → mismos estados que #8, con precedencia | RWK.5.1, RWK.5.2, RWK.5.3, RWK.5.4, RWK.5.5 |

Requisitos transversales (contrato/seguridad/UI/capture/tests): RWK.1.2, RWK.6, RWK.7, RWK.8, RWK.9.

---

## RWK.1 — RPC nueva `rodeo_weaning_kpi`: contrato + %destete (D1)

- **RWK.1.1** — El sistema deberá proveer una RPC `rodeo_weaning_kpi(p_rodeo_id uuid, p_year int)` que devuelva `is_configured boolean`, `serviced int`, `weaned int`, `pending_weaning int` y `status text`.
- **RWK.1.2** — El sistema deberá derivar `serviced` del mismo denominador de Stream A (`rodeo_repro_denominator` / `rodeo_serviced_females`, `0105`) que usa `rodeo_calving_kpi`, sin re-derivarlo a mano.
- **RWK.1.3** — Cuando `status = 'ok'`, el sistema deberá exponer el %destete como `weaned / serviced × 100` (denominador = servidas), aceptando valores mayores a 100 % (mellizos: dos crías destetadas de una servida) sin truncarlos.
- **RWK.1.4** — Si `serviced = 0`, entonces el sistema no deberá dividir: devolverá `weaned = 0` y `pending_weaning = 0` sin NaN/Infinity (la UI muestra "—").

## RWK.2 — `weaned` imputado por AÑO DE SERVICIO (campaña) (D2)

- **RWK.2.1** — El sistema deberá calcular `weaned` como la cantidad de crías DISTINCT vinculadas por `birth_calves` a un parto (`reproductive_events.event_type = 'birth'`, `deleted_at is null`) de una hembra del conjunto servidas cuya concepción (`event_date − interval '9 months'`) cae en `p_year` con mes ∈ `service_months` (set-membership, MISMA ventana de campaña que `calved` de #8), y que tienen al menos un evento `weaning` (`event_type = 'weaning'`, `deleted_at is null`) sobre el perfil de la cría.
- **RWK.2.2** — El sistema deberá imputar cada destete a la campaña de ORIGEN de la cría (por la concepción de su parto), NO por el año calendario del evento `weaning` (que cae ~6–8 meses después del parto, ya en el año siguiente).
- **RWK.2.3** — El sistema deberá contar crías DISTINCT (no eventos): dos o más eventos `weaning` sobre la misma cría cuentan una sola vez.
- **RWK.2.4** — El sistema no deberá contar partos ni destetes con `deleted_at` no nulo (parto o destete borrado → la cría deja de aportar al conteo).

## RWK.3 — `pending_weaning` + estado `not_weaning_season` (D3)

- **RWK.3.1** — El sistema deberá calcular `pending_weaning` como la cantidad de crías DISTINCT de los partos de la campaña (el MISMO conjunto de partos que RWK.2.1) SIN ningún evento `weaning` no borrado (todavía al pie).
- **RWK.3.2** — Cuando `weaned = 0` y el rodeo tiene entre 1 y 11 meses de servicio, el sistema deberá devolver `status = 'not_weaning_season'`.
- **RWK.3.3** — Cuando la card de Destete recibe `status = 'not_weaning_season'`, el sistema deberá mostrar "todavía no empezó el destete" en lugar de un 0 %.
- **RWK.3.4** — Cuando la card de Destete recibe `status = 'ok'`, el sistema deberá mostrar el %destete (`weaned / serviced × 100`, formato es-AR) y el detalle "N destetados / M servidas".

## RWK.4 — Leyenda de destete parcial (D4)

- **RWK.4.1** — Cuando `status = 'ok'` y `pending_weaning > 0`, el sistema deberá mostrar la leyenda "todavía hay crías sin destetar, esto puede afectar el dato".
- **RWK.4.2** — Si `pending_weaning = 0` o `status <> 'ok'`, entonces el sistema no deberá mostrar la leyenda.

## RWK.5 — `service_months` vacío/NULL o 12 meses → estados con precedencia (D5)

- **RWK.5.1** — Cuando el rodeo tiene `service_months` NULL o de cardinalidad 0, el sistema deberá devolver `status = 'no_service_months'`.
- **RWK.5.2** — Cuando el rodeo tiene los 12 meses en `service_months` (cardinalidad = 12), el sistema deberá devolver `status = 'not_applicable_12m'`.
- **RWK.5.3** — El sistema deberá evaluar el `status` con la precedencia: `no_service_months` → `not_applicable_12m` → `not_weaning_season` → `ok` (un rodeo de 12 meses nunca cae en `not_weaning_season`).
- **RWK.5.4** — Cuando la card de Destete recibe `status = 'no_service_months'`, el sistema deberá mostrar "sin meses de servicio configurados" en lugar de un porcentaje.
- **RWK.5.5** — Cuando la card de Destete recibe `status = 'not_applicable_12m'`, el sistema deberá mostrar "no aplica (servicio todo el año)" en lugar de un porcentaje.

## RWK.6 — Contrato de seguridad (Gate 1) — RPC nueva SECURITY DEFINER

- **RWK.6.1** — El sistema deberá definir `rodeo_weaning_kpi` como `SECURITY DEFINER STABLE` con `set search_path = public` (read-only; no escribe).
- **RWK.6.2** — El sistema deberá derivar el tenant (`establishment_id`) de la fila del rodeo (no de un parámetro del cliente) y, si el invocador no tiene rol en ese establecimiento, rechazar con `42501` (guard `has_role_in`, fail-closed, no un resultado vacío silencioso).
- **RWK.6.3** — El sistema deberá acotar `p_year` a `1900..current+1` y rechazar un valor fuera de rango con `22023`.
- **RWK.6.4** — Si el rodeo no existe o está borrado (`deleted_at`), entonces el sistema deberá rechazar con `P0002`.
- **RWK.6.5** — El sistema deberá revocar `execute` de `public`/`anon` y otorgarlo solo a `authenticated`, verificado por un smoke-check fail-closed dentro de la migración `0118` (RPC nueva → Postgres otorga `EXECUTE` a `PUBLIC` por default; el revoke es OBLIGATORIO).
- **RWK.6.6** — El sistema no deberá modificar `rodeo_calving_kpi` ni ninguna de las otras 9 RPC de reportes: la migración `0118` deberá contener SOLO la creación de `rodeo_weaning_kpi`.

## RWK.7 — Consumo frontend (`reports.ts` / `reports-format.ts` / `use-reports.ts` / pantalla)

- **RWK.7.1** — El sistema deberá mapear las columnas `status`/`weaned`/`pending_weaning` a un tipo `WeaningKpi` (`status: WeaningStatus`, `weaned`, `pendingWeaning`) en la capa de datos (`reports.ts`/`fetchWeaningKpi`), con default defensivo (`status` ausente/desconocido → `'ok'`; `pending_weaning` ausente → 0).
- **RWK.7.2** — La card de Destete deberá derivar su presentación (porcentaje / mensaje de estado / leyenda) del `status` + `pendingWeaning` mediante una función pura testeable `weaningCardView`, reusando `KpiCard`, `safePercent` y `formatPercentAR`.
- **RWK.7.3** — El sistema deberá renderizar la card de Destete en la sección Reproductivo de la pantalla de reportes junto a las cards de Preñez y Parición.
- **RWK.7.4** — El sistema deberá respetar tokens (ADR-023), formato es-AR (coma decimal) y anti-recorte de descendentes (`lineHeight` matcheado) en todos los textos nuevos ("Destete", "todavía no empezó el destete", "sin meses de servicio configurados", la leyenda D4).
- **RWK.7.5** — El sistema no deberá romper el render de las otras secciones de la pantalla de reportes (preñez, parición, distribución CCL, cruce con nacimientos, peso por categoría, alertas, sesiones).

## RWK.8 — Gate 2.5: capture file de los estados de la card

- **RWK.8.1** — El sistema deberá incluir `app/e2e/captures/destete-kpi.capture.ts` que capture los estados de la card de Destete: (a) `ok` con %, (b) `not_weaning_season`, (c) `no_service_months`, (d) `not_applicable_12m`, (e) `ok` con la leyenda de destete parcial.
- **RWK.8.2** — El capture deberá verificar anti-recorte de descendentes (`scrollHeight ≤ clientHeight`) en los textos con descendentes: "Destete", "todavía no empezó el destete", "sin meses de servicio configurados".

## RWK.9 — Tests no-bypass del backend (suite `supabase/tests/reports/run.cjs`)

- **RWK.9.1** — La suite deberá verificar que con `service_months` NULL o `{}` la RPC devuelve `status = 'no_service_months'`.
- **RWK.9.2** — La suite deberá verificar que un rodeo con los 12 meses de servicio devuelve `status = 'not_applicable_12m'` (precedencia sobre `not_weaning_season`).
- **RWK.9.3** — La suite deberá verificar que, con una campaña con partos cargados pero sin ningún destete, la RPC devuelve `status = 'not_weaning_season'` y `weaned = 0`.
- **RWK.9.4** — La suite deberá verificar que, con crías destetadas de la campaña, la RPC devuelve `status = 'ok'` con el `weaned` correcto (incluido el wrap de fin de año) y el %destete derivable.
- **RWK.9.5** — La suite deberá verificar que `pending_weaning > 0` cuando quedan crías de la campaña sin destetar y `= 0` cuando todas están destetadas, y que un evento `weaning` con `deleted_at` no cuenta como destetada.
- **RWK.9.6** — La suite deberá verificar que la imputación es por campaña de origen (un parto cuya concepción cae fuera de `service_months` NO aporta ni a `weaned` ni a `pending_weaning`) y el conteo de mellizos (2 crías destetadas de un mismo parto → `weaned` puede exceder `serviced`).
- **RWK.9.7** — La suite deberá verificar tenant-isolation/IDOR (`42501` para un usuario sin rol en el establecimiento), que `anon`/`public` no ejecutan `rodeo_weaning_kpi`, y que la RPC es read-only (no muta filas).

---

## Trazabilidad y reconciliación

- Cada `RWK.<n>` es verificable por ≥1 test: RWK.1–RWK.6 y RWK.9 por la suite `supabase/tests/reports/run.cjs` (TR.11 nuevo + TR.10 extendido); RWK.7 por `app/src/utils/reports-format.test.ts` (función pura `weaningCardView`); RWK.8 por el capture file (Gate 2.5). El mapa `RWK.<n> → archivo:test` lo documenta el implementer en `progress/impl_destete-kpi.md`.
- **Reconciliación de cierre (Puerta 2)**: al cerrar el delta se folda al baseline un puntero + nota as-built bajo R7.6 (`requirements.md`) y una entrada en el bloque "Deltas posteriores" de `design.md` baseline (ADR-028). No se reescribe el baseline; el `tasks.md` original NO se toca.
- Toda corrección surgida en Gate 1 / reviewer / Gate 2 se reconcilia en estos tres archivos antes de commitear (regla `feedback_correcciones_en_specs`).

---

## Historial de refinamiento

- **2026-07-01** — Redacción inicial del delta #10 desde `context-destete-kpi.md` (Gate 0 aprobado por el leader en modo autónomo; semántica decidida por Raf). Sin cambios de IDs. Pendiente Gate 1 (`security_analyzer` modo `spec`) + Puerta 1.
