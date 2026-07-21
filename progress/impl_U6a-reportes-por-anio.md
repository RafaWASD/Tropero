# impl U6a — Reportes no filtran por año/campaña

baseline_commit: 080100b399dd75467130295b5ef6abb5f7130cc1

> Bugfix U6a (tanda `docs/plan-mejoras-2026-07-20.md`, Tier 1). Feature madre: 07-reportes-basicos.
> Estado: **BLOCKED** — el fix requiere una decisión de dominio (redefinición del denominador
> reproductivo, spec-locked como [TENTATIVO], equity-relevant) + un deploy de migración (Gate 1) que
> el implementer no puede hacer, y cuya verificación E2E depende de ese deploy. Ver §Decisión.

---

## 1. Qué se investigó

Camino completo del año desde el selector hasta el SQL desplegado:

- **Selector + estado (frontend)** — `app/app/(tabs)/reportes.tsx`
- **Hooks orquestadores** — `app/src/hooks/use-reports.ts`
- **Capa de datos / RPC** — `app/src/services/reports.ts`
- **RPC desplegadas (SQL)** — `supabase/migrations/0105_repro_denominator.sql`,
  `0106_reports_rpcs.sql`, `0117_calving_kpi_status.sql`, `0118_weaning_kpi.sql`
- **Spec madre** — `specs/active/07-reportes-basicos/{requirements,context}.md`

Se verificó que **ninguna migración posterior** redefine las funciones del denominador (grep sobre
`supabase/migrations`: solo 0105/0106/0117/0118 las tocan) → el comportamiento desplegado = el de esas
migraciones. Análisis firme sin necesidad de golpear el remoto.

## 2. Causa raíz (con archivo:línea)

**El frontend NO tiene el bug.** El año fluye y re-consulta correctamente end-to-end:

- `reportes.tsx:83` `pickedYear` (state) · `:91` `year = pickedYear ?? defaultYear` · `:94`
  `useRodeoKpis(rodeoId, year)` · `:168` `YearStepper onChange → setPickedYear(y)`.
- `use-reports.ts:141-164` los fetchers están memoizados en `[rodeoId, year]`; `:82-113` `useReport`
  re-corre cuando cambia el fetcher (guard de secuencia incluido). **Cambiar el año SÍ dispara re-fetch.**
- `reports.ts:279/294/311/328/337` cada RPC recibe `p_year: year` en los args. **El año llega al server.**

**El bug es 100% server-side, en el denominador reproductivo** `rodeo_serviced_females` y en los
numeradores basados en tacto:

1. **`rodeo_serviced_females` — rama NATURAL (el caso dominante en cría)** —
   `0105_repro_denominator.sql:113-146`. NO tiene NINGÚN filtro por `p_year`. Su única condición
   ligada al año es `v_months is not null and cardinality(v_months) >= 1` (`:124`) — o sea, que el
   rodeo TENGA ventana de servicio configurada, no en qué campaña. Membresía + elegibilidad se evalúan
   contra el estado **ACTUAL** (`p.status='active'`, categoría actual, último veredicto de aptitud).
   → Para cualquier año dentro de cota, el conjunto servidas natural es **idéntico**. **"Servidas" es
   año-independiente.**
   - La rama **AI** (`:147-165`) SÍ filtra por año (`:161` `extract(year from rv.event_date) = p_year`).
     Por eso el bug se ve en rodeos de monta natural, no (o menos) en los de IA per-vaca.

2. **Numerador de %Preñez** — `0106_reports_rpcs.sql:242-266`. Clasifica preñada/vacía por el
   **último tacto GLOBAL** de cada hembra (`distinct on (animal_profile_id) order by event_date desc`),
   sin filtro de campaña. → Muestra el estado de preñez ACTUAL del animal, no el de la campaña elegida.
   **%Preñez es año-independiente.** (Esto además está literal en el spec: R7.5.2 dice "su ÚLTIMO
   evento tacto" — global, `requirements.md:115-117`.)

3. **Distribución CCL** — `0106:376-401`. Mismo `last_tacto` global. **CCL es año-independiente.**

4. **%Parición** (`calved`, `0117:84-94`) y **%Destete** (`weaned`, `0118:51-65`) SÍ filtran el
   NUMERADOR por campaña (concepción = parto − 9 meses ∈ (p_year, mes ∈ service_months)) → sus
   numeradores varían por año. **Pero dividen por el `serviced` año-independiente** → el ratio también
   queda sutilmente mal entre años (denominador de la campaña equivocada).

5. **Peso por categoría** (`rodeo_weight_by_category`, `0106:515-564`) y **Alertas** (dosis vencida /
   sin pesar) NO reciben `p_year` — son fotos "de ahora" por diseño, fuera del concepto de campaña. OK
   que no cambien con el año.

## 3. KPIs afectados

| KPI | ¿Varía por año hoy? | Diagnóstico |
|---|---|---|
| **Servidas** (denominador) | ❌ No (natural) | Rama natural sin filtro `p_year` |
| **%Preñez** (+ absolutos) | ❌ No | Numerador = último tacto global; denom. año-indep. |
| **Distribución CCL** | ❌ No | Mismo último-tacto global |
| **%Parición** | ⚠️ Parcial | Numerador SÍ varía; denominador (servidas) NO |
| **%Destete** | ⚠️ Parcial | Ídem parición |
| Peso por categoría | n/a | Sin `p_year` — foto actual (correcto) |
| Alertas (dosis / sin pesar) | n/a | Establecimiento, sin `p_year` (correcto) |

El reporte de Raf ("Servidas muestra lo mismo sin importar el año") corresponde exactamente al #1, y
el bug es **transversal** al bloque reproductivo (afecta también %Preñez y CCL, y el denominador de
%Parición/%Destete). NO es solo "Servidas".

## 4. Por qué está BLOCKED (no es un bug mecánico, es una decisión de dominio + dependencia de deploy)

El código **coincide con el spec**. La año-independencia del denominador natural es una limitación
**[TENTATIVO] documentada** en `0105:88-94` ("el MVP toma la MEMBRESÍA ACTUAL del rodeo... El historial
de membresía por fecha NO se modela en MVP — no hay tabla de historia de `rodeo_id`") y el spec 07 la
consume as-built (`requirements.md`, nota "Spec 07 consume el contrato as-built"). El numerador de
preñez por "último tacto" también es literal en R7.5.2.

Hacer que "Servidas" (y %Preñez / CCL) respeten el año **requiere redefinir la semántica del
denominador reproductivo**, y eso:

- **Es una decisión de dominio que necesita a Facundo.** No existe ancla temporal en el modelo de datos
  (verificado: `service_months` es config estática de meses en `rodeos`, `0102`; NO hay registro de
  "servicio de la campaña 2024" con fecha). La única evidencia fechada de una campaña son los eventos
  `tacto` / `birth` / `service+ai`. Atar servidas a esa evidencia (la única vía para que años recientes
  difieran, que es lo que Raf necesita) **cambia números vivos**: una hembra servida pero **aún no
  tactada** dejaría de contar en la campaña vigente hasta que se la tacte → rompe la narrativa
  "entoradas antes del diagnóstico". Elegir esto mal = enviar números equivocados, justo lo que este
  bug busca evitar.
- **Es cross-spec (02 + 07) y equity-relevant** (son los KPIs que venden el producto y que tocan la
  discusión de equity con Facundo) → por CLAUDE.md es territorio de ADR, no de default menor.
- **Requiere un deploy de migración** (las RPC son SECURITY DEFINER server-side); solo el leader
  aplica migraciones tras Gate 1 + autorización de Raf. El implementer no deploya.
- **La verificación E2E depende del deploy.** Los reportes son ONLINE-ONLY y llaman `supabase.rpc`
  directo contra el remoto (no hay mock; `services/reports.ts:1-19`). Una E2E que asserte "Servidas /
  %Preñez cambian por año" **no puede dar verde honesto** hasta que la RPC arreglada esté desplegada.
  No voy a escribir una migración que cambie un contrato spec-locked sin sign-off, ni reclamar
  evidencia E2E que no puedo producir.

Por mi regla dura: *"si no podés completar una task sin desviarte del spec, parás y reportás; pedís
cambios al spec primero"* → **BLOCKED**, con el fix recomendado listo para que el leader decida.

## 5. Fix recomendado (para que el leader/Facundo decidan)

**Anclar el conjunto servidas (y los numeradores de tacto) a evidencia FECHADA de la campaña**, de
forma simétrica a cómo ya se derivan `calved`/`weaned`:

- **Servidas natural (nueva def. propuesta):** hembra elegible + membresía actual **Y** con evidencia
  fechada atribuible a la campaña Y: un `tacto` cuyo `event_date` mapea a la campaña (año + diagnóstico),
  o un `birth` cuya concepción (parto − 9m) ∈ (p_year, mes ∈ service_months). Combinado con la rama AI
  (que ya filtra por año). Efecto: campañas sin actividad registrada → servidas = 0 → "Sin datos de
  esta campaña" (correcto para el 2024/2025 de Raf, que no tiene datos).
- **Numerador de %Preñez / CCL:** clasificar por el último tacto **dentro de la campaña** (no el último
  global) → % de preñez de ESA campaña.

**Sub-decisiones que necesitan a Facundo (elegir A o B):**
- **(A)** Def. anclada a evidencia fechada (arriba). Simple, sin nueva tabla. **Costo:** una servida
  aún-no-tactada no cuenta en la campaña vigente hasta tactarla (el denominador "crece" con los tactos).
- **(B)** Introducir un registro explícito de **servicio a nivel rodeo por campaña** (fecha/año de
  entore) como ancla del denominador natural → servidas = membresía elegible a esa fecha, sin depender
  del tacto. Más fiel a "entoradas", pero es modelo de datos nuevo (tabla + UI de "abrir campaña") y
  scope mayor.

Recomiendo **(A)** para el MVP (barato, cierra el bug, usa datos ya existentes) con la limitación de
membresía-histórica documentada; (B) queda para cuando se modele el servicio a nivel rodeo por campaña.

**Nota de scoping (RLS/tenant):** el fix vive dentro de `rodeo_serviced_females` /
`rodeo_pregnancy_kpi` / `rodeo_ccl_distribution` — SECURITY DEFINER con guard `has_role_in(est del
rodeo)` + cota `p_year`. La redefinición **no cambia** la superficie de tenant (mismo guard, mismos
joins a `animal_profiles` con `establishment_id = v_est`, M2/M3 preservados). Aun así, por tocar el
cómputo de un contrato tenant-scoped, **corresponde pasar por security review (Gate 2, modo code) tras
implementar.**

## 6. Plan de ejecución (post-decisión) — para el follow-up

1. Migración `0127_repro_denominator_campaign_scope.sql`: redefinir la rama natural de
   `rodeo_serviced_females` con el ancla de campaña (def. A) + `last_tacto` scopeado a la campaña en
   `rodeo_pregnancy_kpi` y `rodeo_ccl_distribution`. Preservar guard/cota/tenant/revoke/grant/smoke-check.
2. Reconciliar spec 07 (`requirements.md` R7.5.1/R7.5.2 + `design.md`) y la nota [TENTATIVO] de
   `0105` (el contrato de Stream A cambia de "membresía actual" a "evidencia de campaña").
3. Unit tests de la lógica pura de mapeo campaña↔evento si se extrae algo a `reports-format.ts`.
4. E2E `app/e2e/reportes-por-anio.spec.ts`: sembrar (via `helpers/admin.ts`) un rodeo con
   `serviceMonths`, tactos/partos en **≥2 años distintos**, loguear, entrar a Reportes, cambiar el
   `YearStepper` y assertear que Servidas / %Preñez **cambian** y son correctos por año.
   **Requiere la migración desplegada por el leader (Gate 1) primero.**
5. Gate 2 (security, code) sobre el diff SQL.

## 7. Restricciones respetadas

- No se commiteó nada. No se corrió `check.mjs` full ni suites backend remotas. No se corrió
  `e2e:build` / capturas (cero churn de `design/*.png`). No se tocó BLE ni `app/app/maniobra*`
  (dominio de U5). No se aplicó ninguna migración al remoto.

## 8. Autorrevisión

- ¿El bug podía ser solo el numerador de parición (que ya varía)? No: Raf reporta "Servidas", que es
  el denominador — año-independiente en la rama natural. Confirmado leyendo `0105:113-146`.
- ¿Una migración posterior lo arregla y el spike miente? No: grep confirma que solo 0105/0106/0117/0118
  tocan estas funciones; 0117/0118 preservan explícitamente el `pregnant`/`last_tacto` global.
- ¿El frontend no re-fetchea (falsa pista)? Descartado: los fetchers dependen de `[rodeoId, year]` y
  `useReport` re-corre; los args RPC incluyen `p_year`. El plumbing es correcto.
- ¿Es un default menor que puedo decidir yo? No: redefine un contrato reproductivo cross-spec,
  equity-relevant, con decisión [TENTATIVO] locked y efectos en números vivos → ADR/Facundo.
