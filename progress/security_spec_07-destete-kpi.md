# Gate 1 (spec mode) — Delta %DESTETE: RPC nueva `rodeo_weaning_kpi` (#10) — spec 07

**Analista**: security_analyzer (modo `spec`) · **Fecha**: 2026-07-01
**Input**: `specs/active/07-reportes-basicos/{context,requirements,design,tasks}-destete-kpi.md`
**Molde auditado**: `rodeo_calving_kpi` (`0117`, ya aprobado en Gate 1/2 de #8), Stream A (`0105`), `compute_nursing` (`0061`), `birth_calves` (`0045`).
**Skill**: metodología `sentry-skills:security-review` aplicada a nivel spec (trace data-flow + verify exploitability antes de reportar).

## Veredicto: **PASS**

RPC de reporte read-only, clon fiel de un patrón ya auditado y deployado (`0117`), extendido por **un solo hop de JOIN** (`birth_calves → weaning`) que queda anclado al mismo conjunto tenant-guarded (`rodeo_serviced_females`). El vector HIGH propio de una RPC nueva (grant `EXECUTE` a `PUBLIC` por default) está cubierto explícitamente por RWK.6.5 + T7 + el SQL del design §2.2. Sin findings HIGH ni MEDIUM.

---

## Findings HIGH

Ninguno.

## Findings MEDIUM

Ninguno.

---

## Verificación de los 5 focos de seguridad del prompt

### 1. Fail-closed de RPC NUEVA (el vector HIGH) — OK

- RWK.6.5 (requirements) exige textualmente: *"revocar `execute` de `public`/`anon` y otorgarlo solo a `authenticated`, verificado por un smoke-check fail-closed dentro de la migración `0118` (RPC nueva → Postgres otorga `EXECUTE` a `PUBLIC` por default; el revoke es OBLIGATORIO)"*.
- Design §2.1 lo justifica explícitamente y §2.2 muestra el SQL: `revoke execute on function public.rodeo_weaning_kpi (uuid, int) from public, anon;` + `grant ... to authenticated;` + `do $$ ... has_function_privilege ... raise exception ... end$$;` + `notify pgrst`, todo dentro de `begin/commit`.
- **Match 1:1 con el patrón vigente `0117:163-185`** (verificado leyendo el as-built). El smoke-check itera `unnest(array['anon','public'])` y hace `raise exception` (→ ROLLBACK de la migración = fail-closed a nivel migración) si la función quedó EXECUTE-able por anon/public.
- Tasks T7 lo codifica como tarea propia por firma `(uuid, int)`. RWK.9.7 + T10 exigen el test no-bypass de que anon/public NO ejecutan la RPC (agregada al array de 10 RPC de TR.10).
- **Conclusión**: el revoke obligatorio está exigido en requirements, diseñado en el SQL, tareado y testeado. Sin este control una RPC de datos de campo sería ejecutable por `anon` — acá está cerrado.

### 2. Anti-IDOR / tenant-scoping — OK

- **Tenant derivado del rodeo, nunca de un param del cliente**: `select establishment_id ... from rodeos where id = p_rodeo_id and deleted_at is null` → `P0002` si no existe/borrado → `has_role_in(v_est)` fail-closed → `42501`. Copia idéntica del guard `0117:43-52` (verificado). El cliente NO pasa `establishment_id`.
- **La cadena de JOINs no abre camino cross-tenant**. Como la RPC es `SECURITY DEFINER` (bypassa RLS), el scope tiene que venir enteramente del anclaje, y así es:
  - `rodeo_serviced_females(p_rodeo_id, p_year) s` — re-guarda `has_role_in(v_est)` + `p.establishment_id = v_est` internamente (`0105:100-110`, verificado). Es el ancla tenant.
  - `reproductive_events b` anclado por `b.animal_profile_id = s.animal_profile_id` → parto de una servida de ESTE rodeo/tenant.
  - `birth_calves bc` anclado por `bc.birth_event_id = b.id` → cría de ese parto.
  - `reproductive_events w` (weaning) anclado por `w.animal_profile_id = bc.calf_profile_id` → destete de esa cría.
  - **Cada hop cuelga del conjunto tenant-guarded; no hay predicado que dependa de un id del cliente.** Es exactamente la superficie de `calved`/`pending_pregnant` de `0117` (que ya hace `join reproductive_events by animal_profile_id` del mismo `rodeo_serviced_females`), extendida un paso — misma clase de seguridad ya aprobada.
- **`birth_calves` no es forjable desde el cliente**: `0045` confirma tabla select-only, SIN policy INSERT para `authenticated`, poblada solo server-side (trigger mono-ternero + `register_birth`, ambos `SECURITY DEFINER` con herencia de tenant de la fila real de la madre, NUNCA del payload — `0045:213-225`, `269`). SEC-SPEC-04. El vínculo cría↔parto no se puede fabricar por PostgREST → no se puede inyectar una cría ajena en el conteo.
- **El JOIN es el molde `compute_nursing` (`0061:29-42`)**, que en su header declara *"NO escribe ni cruza tenant (RT2.12.1)"* — misma estructura `parto → birth_calves → weaning`. Verificado 1:1.
- **Conclusión**: ningún `weaning`/`birth_calves` de otro tenant puede colarse. El conteo son crías DISTINCT ancladas a partos de servidas de este rodeo; no expone dato de otro tenant.

### 3. Inputs — OK

- `p_year` acotado a `1900..extract(year from current_date)::int + 1` → `22023`, **antes** de cualquier `extract`/aritmética de fecha (RWK.6.3, design §2.2:98-100, molde `0117:50-52`).
- `p_rodeo_id` validado por pertenencia real (`P0002` si no existe/borrado) + `has_role_in` (RWK.6.4).
- Sin texto libre, sin SQL dinámico, sin `.or()/.filter()/.textSearch()`, sin `ilike '%term%'`, sin prompt LLM. La UI es una `KpiCard` "tonta" que consume `status`/`weaned`/`pending_weaning`. Los dos params vienen de estado de app (rodeo seleccionado + año), no de campos tipeados por el usuario.
- Frontend: `mapRpcError` (verificado en `app/src/services/reports.ts:143-158`) mapea CÓDIGOS (`42501`/`P0002`→`forbidden`, `22023`→`validation`) a mensajes estáticos genéricos; **nunca** devuelve `err.message` crudo al usuario (B1 limpio). `fetchWeaningKpi` reusa `callRpcSingle`→`mapRpcError`, hereda el comportamiento.

### 4. Sin romper las otras 10 RPC — OK

- Es `CREATE FUNCTION` directo, **no** `DROP`/`CREATE OR REPLACE` (design §2.1). `rodeo_weaning_kpi` verificado **inexistente** en `supabase/migrations/*.sql` (grep vacío) → T1 confirma antes de escribir.
- RWK.6.6 + T8: la migración `0118` contiene SOLO `rodeo_weaning_kpi`; no toca `rodeo_calving_kpi` ni Stream A ni las otras 8 RPC de `0106`. Al no haber DROP, no hay reseteo de privilegios de las existentes ni cambio de su tipo de retorno.

### 5. `pending_weaning` / `status` — OK

- Mismo conjunto de partos tenant-guarded que `weaned` (RWK.3.1), split por `not exists weaning`. Datos del propio rodeo, sin fuga.
- `status` computado localmente sobre `v_months`/`weaned` (precedencia `no_service_months → not_applicable_12m → not_weaning_season → ok`); no consulta otros tenants. `weaned`/`pending_weaning` se computan siempre; `status` gatea solo el display de la card. Sin superficie de seguridad nueva.

---

## Tabla de inputs (campos que llegan al backend)

| campo | límite (largo/charset/formato/rango) | validación | OK? |
|---|---|---|---|
| `p_rodeo_id` (uuid) | tipo `uuid` + debe existir y no estar borrado | server-side autoritativa: `P0002` si no existe + `has_role_in(v_est)`→`42501` | ✅ |
| `p_year` (int) | `1900 .. current+1` | server-side autoritativa: `22023` fuera de rango, antes de toda aritmética de fecha | ✅ |

No hay formularios, buscadores, texto libre ni prompts en este delta. La card de Destete es display-only; no captura input del usuario.

## Tabla de rate limits (acciones abusables tocadas)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `rodeo_weaning_kpi` (SELECT read-only vía PostgREST) | n.a. | tenant-guarded (`has_role_in`) + `authenticated` | sí (guard rechaza → `42501`) | No es Edge Function; no manda email/SMS, no pega a API externa, no es bulk/import. Agregado de una sola fila (5 escalares) sobre el rodeo propio; sin fan-out ni result-set sin tope (E1/E2 n.a.). Cost-profile idéntico al ya-aprobado `0117`. |

---

## Anexo LOW (informativo, no bloqueante)

- **L1 — Sin cap de costo por request a nivel RPC** (E1/E2, defensa en profundidad). La consulta es un agregado sobre `rodeo_serviced_females → reproductive_events → birth_calves → reproductive_events`, acotado al rodeo propio (decenas de miles de animales como techo real), devuelve 1 row. No es un vector de amplificación ni de result-set sin tope. Índices existentes (`birth_calves_by_event`, `birth_calves_by_calf`) cubren el JOIN. Es el mismo perfil que las 9 RPC de reportes vigentes; no se pide cambio. Se anota solo por trazabilidad.

---

## Dominios revisados

- **A1** — Service-role / `SECURITY DEFINER` bypassa RLS → scoping manual verificado (`has_role_in(v_est)` derivado del rodeo + `rodeo_serviced_females` re-guarda). OK.
- **A3** — IDOR por FK → cadena de JOINs anclada al conjunto tenant-guarded; `birth_calves`/`reproductive_events` alcanzados solo desde ahí. OK.
- **A4** — Function-level authz → cualquier rol del establecimiento lee reportes (`has_role_in`), consistente con las otras 9 RPC de `0106`. OK.
- **A2** — Mass assignment → n.a., RPC read-only, sin `insert/update` de payload del cliente.
- **B1** — Information disclosure → `raise` con mensajes genéricos; `mapRpcError` mapea códigos, no `err.message`. OK.
- **Inputs / F1** — Injection / filter injection → params tipados y acotados server-side, sin texto libre ni SQL dinámico. OK.
- **Fail-closed grants** (vector HIGH de RPC nueva) → `revoke public/anon` + `grant authenticated` + smoke-check exigidos (RWK.6.5) y testeados (RWK.9.7). OK.
- **E1/E2** — Abuso a escala → read-only, tenant-bounded, 1 row de salida. OK.

## Dominios excluidos (con justificación)

- **RLS policies nuevas/modificadas** — no se crean tablas ni se modifica RLS. `birth_calves` (RLS existente `0045`) solo se LEE vía `SECURITY DEFINER`; su policy no cambia.
- **Edge Functions** — n.a.: es RPC Postgres vía PostgREST, no Edge Function. No hay `Deno.env`, `fetch()`, email/SMS.
- **Auth / tokens / sessions / secrets (D3)** — intactos; no se introducen secretos ni credenciales.
- **Rate limiting nativo (`[auth.rate_limit]`)** — no se toca `config.toml`; la RPC no es endpoint de email/SMS/OTP.
- **C (offline / PowerSync / Realtime / data-at-rest)** — reportes son online-only/server-side (R7.2); `reproductive_events`/`birth_calves` no se sincronizan para reportes. No hay sync rule nueva ni escritura local.
- **F2/F3/F4 (import CSV/formula injection, SSRF, XSS en email)** — n.a.: sin import de archivos, sin `fetch()` a URL del usuario, sin templates de email.
- **G (BLE)** — n.a.: este delta no toca el trust boundary del bastón.
- **I (compliance / mobile hardening)** — n.a.: KPI derivado, sin borrado/retención de PII ni pantallas sensibles nuevas.

---

## Nota para el leader

Sin correcciones que foldear antes de implementar. La spec ya exige el revoke fail-closed (RWK.6.5/T7), el guard tenant derivado del rodeo (RWK.6.2), la cota de `p_year` (RWK.6.3), y el aislamiento cross-tenant/IDOR testeado (RWK.9.7/T9/T10). El único punto de atención para el **reviewer/Gate 2 (modo code)**: verificar que el SQL de `0118` efectivamente reproduce el revoke+grant+smoke-check por firma `(uuid, int)` y que el smoke-check hace `raise exception` (ROLLBACK), tal como está en el diseño §2.2 — el diseño está correcto, resta que el implementer no lo omita al escribir la migración.
