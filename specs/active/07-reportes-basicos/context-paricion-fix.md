# Spec 07 — Delta %PARICIÓN: fix del 0% + lógica de meses de parto (#8) — Contexto (Gate 0)

**Status**: `context_ready` · Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** (RPC `rodeo_calving_kpi`) · Gate 1 OBLIGATORIO.
**Fecha**: 2026-06-30.
**Origen**: corrección **#8** del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`). Segmento B (reportes reproductivos).
**Deploy**: **Raf autorizó el deploy en sesión (2026-06-30, "yo apruebo el deploy")** → el leader aplica la migración por Supabase MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5.
**Gate 0**: aprobado por el leader en modo autónomo — la **semántica ya la decidió Raf** (ronda 2026-06-29, `docs/correcciones-prueba-en-vivo-2026-06-27.md` §"Decisiones de dominio confirmadas"); acá NO se re-decide.

---

## Problema

El KPI de **%parición** (`rodeo_calving_kpi`, `supabase/migrations/0106_reports_rpcs.sql:285-343`) mostró **0%** en el testeo aunque había partos cargados. Raíz: la fórmula cuenta partos cuya concepción (`event_date − 9 meses`) cae en los `service_months` del año; si el rodeo tiene `service_months` **NULL/`{}`** (sin meses de servicio configurados), la guarda nunca deja contar → **0% silencioso**. Un 0% con partos cargados rompe la confianza en el toque (sobre todo para el dueño que entra desde la ciudad a mirar cómo va el campo).

## Decisiones de dominio (YA confirmadas por Raf — NO re-decidir)

De `docs/correcciones-prueba-en-vivo-2026-06-27.md` §"Decisiones de dominio confirmadas (ronda 2026-06-29)":

> Nota: los copys de card citados abajo se muestran con casing corregido a sentence-case (2026-07-10) — inicial en mayúscula, resto idéntico. La decisión de dominio no cambia.

- **D1 — Meses de parto = meses de servicio + 9** (NO 284 días). El servicio se anota por **mes** (monta natural), no por día. La ventana de parto de la campaña son esos meses corridos +9.
- **D2 — %parición se muestra SOLO en los meses de parto.** Antes de la ventana la parición es estructuralmente 0% (todavía no pudo haber partos) → NO se reporta la métrica antes de que sus eventos puedan ocurrir. Fuera de la ventana, la card muestra un estado "Todavía no es época de parición" (no un 0%).
- **D3 — `service_months` vacío ≠ 0%.** Si el rodeo no tiene meses de servicio configurados, la card debe decir **"Sin meses de servicio configurados"** (o equivalente accionable), NO un 0% engañoso.
- **D4 — Leyenda OBLIGATORIA al activarse el mes de parto**: si todavía hay vacas **preñadas que no parieron ni abortaron**, mostrar el aviso *"Todavía hay vacas que no parieron, esto puede afectar el dato"* (denominador/numerador incompleto). Mismo patrón que el cartel de destete parcial de #10.
- **D5 — Rodeos de servicio continuo 12 meses**: NO hacen tacto ni controlan preñez → **no mostrar parición** (ni la mayoría de KPIs repro) para esos rodeos. Usan la app para consultar/cargar animales.

## Alcance

- **Backend (deploy)**: nueva migración `CREATE OR REPLACE` de `rodeo_calving_kpi` (moldear sobre el **cuerpo VIGENTE en el remoto**, no solo sobre `0106` — regla `reference_function_recreate_base`; confirmado que ninguna migración posterior lo tocó, pero verificar el remoto igual). La RPC debe devolver, además del %, un **estado** que distinga: `not_calving_season` (fuera de meses de parto, D2), `no_service_months` (D3), `not_applicable_12m` (D5), y `ok` (con el %); y un flag/dato para la **leyenda D4** (¿quedan preñadas sin parir?). Sin romper el contrato de los otros KPIs del reporte ni los callers existentes.
- **Frontend**: la `KpiCard` de parición (`reports.ts`/`use-reports.ts`/`KpiCard.tsx`) consume el nuevo estado y renderiza: el % (solo en meses de parto), o el mensaje de estado (fuera de ventana / sin meses / N/A 12m), + la leyenda D4. es-AR, tokens, anti-recorte.
- **Gate 1**: OBLIGATORIO (RPC SECURITY DEFINER de reportes, tenant-scoped — molde de las 9 RPC de `0106`, anti-IDOR ya auditado). El delta re-audita el cambio de `rodeo_calving_kpi`.
- **Gate 2.5**: es UI → capture file `app/e2e/captures/paricion-fix.capture.ts` con los estados de la card (en meses de parto con %, fuera de ventana, sin meses de servicio, 12m N/A, con leyenda de preñadas sin parir).

## No-alcance

- **#10 (%destete)** — RPC nuevo `rodeo_weaning_kpi`, depende de #7 (captura de destete + peso). Delta aparte.
- Cambiar la derivación de "servidas"/denominador de `0105` (Stream A) — se reusa como está.
- Insem. artificial / pajuela (mencionado en D1 como aparte, futuro).

## Preguntas abiertas para la spec

- El **denominador exacto** del %parición (¿vacas servidas del rodeo en la campaña, de `0105`? ¿o preñadas confirmadas?) — el `0106` ya tiene una fórmula; el spec_author la lee del cuerpo vigente y ajusta solo lo que las decisiones D1–D5 exigen, sin re-inventar el denominador (que ya estaba bien salvo el bug del `service_months` vacío).
- Cómo se detecta un **rodeo de servicio 12 meses** (D5): `service_months` con los 12 meses, o un flag. El spec_author lo resuelve leyendo el modelo de `service_months` (0102).

## Tareas para la spec

El spec_author redacta `{requirements,design,tasks}-paricion-fix.md` (numeración `RPF.<n>`), traduciendo D1–D5 a EARS, moldeando el cambio del RPC sobre el cuerpo VIGENTE, con el capture file del Gate 2.5 como deliverable. Gate 1 obligatorio.
