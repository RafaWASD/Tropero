# Security Spec Review — Delta %PARICIÓN fix (#8) sobre spec 07

**Modo**: `spec` (Gate 1, pre-implementación)
**Fecha**: 2026-07-01
**Input**: `specs/active/07-reportes-basicos/{requirements,design,tasks,context}-paricion-fix.md`
**Delta**: CON BACKEND — `DROP FUNCTION` + `CREATE` de la RPC SECURITY DEFINER `rodeo_calving_kpi(p_rodeo_id uuid, p_year int)` vía migración nueva `0107` (agrega `status text` + `pending_pregnant int` al `returns table`).
**Skill**: `sentry-skills:security-review` invocada (metodología data-flow + verify-exploitability aplicada sobre el as-built `0106`/`0105`/`0005`).

---

## Veredicto: **PASS**

La spec preserva el contrato de seguridad de las 9 RPC de reportes de `0106` de forma explícita y verificable, y **exige por escrito** los tres controles críticos que un DROP+CREATE de una función SECURITY DEFINER podría romper: (1) derivación de tenant server-side + guard fail-closed, (2) re-`revoke`/`grant` + smoke-check tras el DROP, (3) scoping del dato nuevo por el conjunto tenant-guarded. No hay findings HIGH ni MEDIUM. Un único LOW pre-existente (no introducido por el delta) queda anexado para trazabilidad.

---

## Findings HIGH

Ninguno.

## Findings MEDIUM

Ninguno.

---

## Verificación de los 5 focos de seguridad (contra el as-built)

### Foco 1 — Tenant-scoping / anti-IDOR — **OK**

El as-built (`0106:291-296`) deriva el tenant del **rodeo**, no de un param del cliente, y valida membresía real fail-closed:

```sql
select establishment_id, service_months into v_est, v_months
from public.rodeos where id = p_rodeo_id and deleted_at is null;
if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
if not public.has_role_in(v_est) then
  raise exception 'not authorized...' using errcode = '42501';
end if;
```

- `has_role_in` (`0005:9-25`) es fail-closed: `exists(user_roles where user_id = auth.uid() and establishment_id = est_id and active = true ...)` → devuelve `false` (no NULL, no bypass) si no hay rol.
- El `p_rodeo_id` del cliente NO permite leer KPIs de otro tenant: podés pasar cualquier UUID, pero si no tenés rol en el establishment de ese rodeo, 42501.
- Los insumos del `calved`/`pregnant`/`pending_pregnant` vienen de `rodeo_serviced_females` (`0105:95-120`), que **re-deriva `v_est`, re-guarda `has_role_in(v_est)` y filtra `p.establishment_id = v_est`** (defensa en profundidad, no confía en el caller). `rodeo_repro_denominator` (`0105:190-198`) idem.

La spec exige preservar esto tal cual: **RPF.5.3** ("`has_role_in(v_est)` fail-closed y cota de `p_year`"), **RPF.5.4** (rol ausente → 42501, no valor vacío silencioso), **design §0/§2.3**, y **RPF.8.6** declara un test de IDOR 42501 sobre `rodeo_calving_kpi` en la suite no-bypass. Cobertura correcta.

### Foco 2 — Fail-closed de privilegios tras el DROP — **OK**

Riesgo real: `DROP FUNCTION` + `CREATE` resetea grants, y **el default de Postgres es `EXECUTE` a `PUBLIC`** → si la migración olvida el revoke, la función queda ejecutable por `anon`. La spec lo cubre de forma explícita y redundante:

- **RPF.5.5**: "dejar la RPC revocada para `public`/`anon` y con `grant execute` a `authenticated` tras recrearla, verificado por smoke-check fail-closed".
- **design §2.1/§2.3**: "Como el DROP+CREATE resetea privilegios, la migración re-aplica `revoke public/anon` + `grant authenticated` + smoke-check" por firma `(uuid, int)`, patrón `0106:730-750`.
- **tasks T6**: tarea dedicada — `revoke execute ... from public, anon` + `grant execute ... to authenticated` + smoke-check acotado a `rodeo_calving_kpi` + `notify pgrst, 'reload schema'; commit;`.
- **tasks T2**: la migración abre `begin;` → el smoke-check corre dentro de la transacción; si detecta que la función quedó EXECUTE-able por anon/public, `raise` y **rollback de toda la migración** (fail-closed a nivel migración). El smoke-check del as-built (`0106:731-750`) usa `has_function_privilege(rolname, oid, 'EXECUTE')` — genuino safety-net contra el default PUBLIC.

Cobertura correcta. La firma del `DROP`/`grant`/`revoke` es `(uuid, int)`, idéntica a la firma que ya matchea `0106:713/723`.

### Foco 3 — Sin fuga por `status` / `pending_pregnant` — **OK**

Los dos datos nuevos se computan **sobre el conjunto ya tenant-guarded**:

- `pending_pregnant` (`design §2.2/§2.3`, T4): `count(distinct)` sobre `rodeo_serviced_females(p_rodeo_id, p_year)` (re-guarda tenant + `establishment_id = v_est`) con `not exists (birth ... contado)`, join a `reproductive_events` por `animal_profile_id` de ese conjunto. Misma superficie que el `pregnant` del as-built (`0106:308-325`), ya auditada. Sin tablas ni columnas denorm nuevas (design §2.3 preserva la defensa M2/M5 de `0106`).
- `status`: derivado de `service_months` del **propio rodeo del tenant** (ya leído de `v_est`), `current_date` y `p_year` (acotado). No cruza datos de otro tenant ni permite inferir datos ajenos — solo se computa para rodeos donde el caller ya pasó `has_role_in`.

Cobertura correcta (design §2.3 lo afirma y lo fundamenta).

### Foco 4 — No romper dependientes SQL — **OK (verificado por mí)**

Verifiqué con `grep`: `rodeo_calving_kpi` aparece SOLO en `supabase/migrations/0106_reports_rpcs.sql` y `supabase/tests/reports/run.cjs`. **No hay vistas ni otras funciones SQL que la invoquen** — la llama únicamente el cliente vía PostgREST. El `DROP FUNCTION public.rodeo_calving_kpi(uuid, int)` es seguro. La spec lo afirma (design §2.1) y **tasks T7** acota la migración `0107` a SOLO esta RPC (no toca las otras 8 ni Stream A `0105`); **RPF.5.6** lo blinda. Confirmado independientemente.

### Foco 5 — Inputs — **OK**

Dos únicos inputs, ambos server-authoritative:

- `p_year`: cota `1900..current+1` → `22023` fuera de rango (as-built `0106:297-299`, preservado por RPF.5.3, design §0/§2.3). El nuevo `make_date(p_year, m, 1)` opera sobre `p_year` ya acotado y `m ∈ service_months` (constraint DB `0102`: 1..12, sin duplicados) → sin fechas absurdas (design §2.3).
- `p_rodeo_id`: tipo `uuid` (PostgREST rechaza no-UUID), validado por pertenencia vía `has_role_in(v_est)`.

No hay texto libre, buscador, `.or()/.filter()`, `ilike`, ni prompt LLM. La RPC usa SQL parametrizado plpgsql (`= any(v_months)`, `make_date`, comparaciones) — **sin `EXECUTE`/`format()` con concatenación de input** → sin superficie de inyección.

---

## Tabla de inputs

| campo | límite (largo/charset/formato/rango) | validación | OK? |
|---|---|---|---|
| `p_rodeo_id` | tipo `uuid` (PostgREST casta/rechaza no-UUID) | server: pertenencia vía `has_role_in(establishment del rodeo)` → 42501 | ✅ |
| `p_year` | rango `1900..current_date+1` | server: cota en la RPC → 22023 | ✅ |

No hay campos de texto libre, buscadores ni prompts en este delta (RPC de reporte read-only con 2 params tipados).

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `rodeo_calving_kpi` (lectura KPI vía PostgREST) | n.a. | — | — | RPC read-only STABLE, sin costo por request (email/SMS/API externa), no bulk, no fan-out. Gateada por `has_role_in` (solo authenticated con rol). No es acción abusable que amerite rate limit propio; queda bajo el rate-limit global de PostgREST/Supabase. El delta no afloja `[auth.rate_limit]` en `config.toml` (no lo toca). |

---

## Dominios revisados (trazabilidad)

- **A1 — Service-role bypassa RLS**: n.a. — la RPC NO usa `createAdminClient()`; es SECURITY DEFINER con guard `has_role_in` interno (patrón correcto, tenant derivado del rodeo).
- **A3 — IDOR por FK**: revisado — `p_rodeo_id` re-validado por pertenencia (Foco 1). ✅
- **A4 — Function-level authz (BFLA)**: revisado — cualquier rol del establishment puede leer el KPI (reporte); el guard es `has_role_in` (no owner-only), consistente con las otras 8 RPC de `0106`. ✅
- **B1 — Information disclosure en respuestas**: revisado — la RPC no devuelve `err.message` crudo al cliente; los `raise exception` usan errcodes SQL estándar (42501/P0002/22023) con mensajes fijos, no datos de otro tenant. ✅
- **B3 — Over-fetching column-level**: revisado — el `returns table` expone solo agregados (conteos + status) del propio rodeo, sin PII de miembros. ✅
- **F1 — PostgREST filter injection**: revisado — sin input de texto en `.or()/.filter()`; SQL parametrizado. ✅
- **Fail-closed de privilegios (DROP/grant)**: revisado (Foco 2). ✅
- **Inputs / cotas**: revisado (Foco 5). ✅

## Dominios excluidos (con justificación)

- **A2 — Mass assignment**: n.a. — RPC read-only, no hay `.insert(body)`/`.update(body)`.
- **C — Offline/sync (PowerSync/Realtime/data-at-rest)**: n.a. — `reports.ts` es online-only; los eventos crudos de reportes no se sincronizan (design §6). El delta no toca sync rules ni almacenamiento local.
- **D — Secretos/supply chain**: n.a. — migración SQL, sin secrets, sin imports Deno, sin service_role en cliente.
- **E — Abuso a escala**: n.a. relevante — RPC read-only agregada por rodeo, sin costo por request; ver tabla de rate limits.
- **G — BLE**: n.a. — no toca BLE.
- **H/I — Auth/sesión/compliance/mobile**: n.a. — no toca auth, retención, borrado ni pantallas sensibles.

---

## Anexo LOW (no bloqueante, NO introducido por este delta)

- **LOW-1 — Enumeración por distinción `P0002` vs `42501`**: la RPC (as-built `0106:293-296`, preservado por el delta) devuelve `P0002` ("rodeo not found") para un `p_rodeo_id` inexistente y `42501` ("not authorized") para uno que existe pero del que el caller no es miembro. Esto permite distinguir "el rodeo existe pero no lo puedo ver" de "no existe". **Por qué es LOW y no bloquea**: (a) los `rodeo_id` son UUIDv4 (122 bits, no enumerables en la práctica) → la explotabilidad es cercana a cero; (b) el leak es solo "este UUID es un rodeo", sin revelar tenant ni dato alguno; (c) es comportamiento pre-existente **uniforme en las 9 RPC de `0106`** y **no lo introduce este delta** — este delta preserva el guard verbatim (RPF.5.3/5.4); (d) uniformar los errcodes sería un cambio a las 9 RPC (decisión transversal), fuera del alcance de #8. Se deja anotado para eventual endurecimiento futuro; no requiere acción en este delta.

---

## Nota de cobertura de la skill

`sentry-skills:security-review` está orientada a diffs de código (file:line). En modo `spec` no hay diff aún; apliqué su metodología (trazado de data-flow + verify-exploitability) sobre el **as-built que el delta modifica** (`0106:285-343` + helpers `0005`/`0105`) y sobre el diseño de la migración `0107` descrito en la spec. La cobertura de dominios RAFAQ-específicos (tenant-scoping SECURITY DEFINER, fail-closed de grants tras DROP, cotas de input SQL) la aportó la revisión manual contra el catálogo, no la skill. Sin hallazgos que la skill descubriera y yo descartara.
