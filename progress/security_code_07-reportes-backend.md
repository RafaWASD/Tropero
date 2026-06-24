# Security code review — spec 07 (reportes) Stream C / backend

**Modo:** `code` (Gate 2, ADR-019). **Veredicto: PASS.**

Auditoría estática del SQL (la migración NO está aplicada al remoto; la aplica el leader con OK de Raf). Gate 1
(spec) ya pasó PASS con M1-M4 foldeados; este review verifica que el **código los implementa**.

## Artefactos analizados
- `supabase/migrations/0106_reports_rpcs.sql` — 9 funciones `SECURITY DEFINER STABLE` + grants/revoke + smoke-check.
- `supabase/tests/reports/run.cjs` — suite no-bypass (TR.1-TR.10), roja-hasta-apply.
- Helpers consumidos (leídos para validar las afirmaciones de scoping, NO modificados):
  `0005_rls_helpers.sql` (`has_role_in`), `0105_repro_denominator.sql` (las 3 RPC de Stream A),
  `0023_event_helpers.sql` (`establishment_of_profile`), `0015_categories_by_system.sql` (tabla de referencia).

Baseline: `5c29d81` (de `progress/impl_07-reportes-backend.md`). Los 6 artefactos del feature están sin commitear
(untracked/modified); ninguno fuera de scope. NO corrí `sentry-skills:security-review`: es PL/pgSQL `SECURITY
DEFINER` sobre Postgres/RLS/multi-tenant — dominio que la skill cubre de forma indirecta (ver "Cobertura"); la
auditoría es manual contra el checklist RAFAQ + el foco del dispatch, que es lo discriminante acá.

---

## Foco del dispatch — resultado

### 1. Tenant-scope sin fuga (lo crítico en reportes) — OK
Verifiqué las 9 RPC: **todo agregado pasa por el JOIN a `animal_profiles` con el establishment del actor**, nunca
por la columna denorm de las tablas de evento (`0077`, plumbing del sync). Evidencia (`0106`):
- **(1) `session_event_summary`** y **(2) `rodeo_sessions_list`**: cada una de las 7 ramas `union all` joinea
  `public.animal_profiles p on p.id = <ev>.animal_profile_id` y filtra `p.establishment_id = v_est`
  (`0106:81-119`, `0106:186-187`). No hay tabla de evento que se cuente sin ese join.
- **(7) `rodeo_weight_by_category`** (`0106:540-543`), **(8) `establishment_overdue_doses`** (`0106:599-606`),
  **(9) `establishment_unweighed`** (`0106:667-669`): idéntico — el scope vive en el join a `animal_profiles`,
  `= v_est` (rodeo) o `= p_establishment_id` (alertas).
- **(3)-(6) KPIs reproductivos**: NO re-derivan el set; agregan sobre `rodeo_serviced_females(p_rodeo_id, p_year)`
  (Stream A). Confirmé en `0105` que esa función **re-deriva `v_est` del rodeo, vuelve a llamar `has_role_in(v_est)`
  y filtra `p.establishment_id = v_est`** (`0105:101-120`), igual que `rodeo_service_campaign`/
  `rodeo_repro_denominator`. Defensa en profundidad real: aun si el guard de la KPI fallara, el set servidas no
  cruza tenant. `count(distinct ...)`/`avg`/`sum` de las KPIs operan SOLO sobre ese set ya scopeado + sus
  `reproductive_events` por `animal_profile_id` (no por un barrido global de la tabla).

**El join tenant (M2) es correcto y exhaustivo: no hay ninguna tabla que se agregue sin él.** Validado además que
`categories_by_system` (`0015:6-17`) es **tabla de referencia GLOBAL** (keyeada por `system_id`, SIN
`establishment_id`) — joinearla sin predicado de tenant en (7) y (9) es correcto: no aporta filas de ningún tenant.

### 2. IDOR de las 2 alertas (M1) — OK
`p_establishment_id` viene del cliente. En ambas el `has_role_in(p_establishment_id)` es **la 1ª sentencia
ejecutable** del cuerpo, fail-closed con `42501` (NO set vacío):
- `establishment_overdue_doses`: `0106:584-587` (el guard es lo primero tras `begin`).
- `establishment_unweighed`: `0106:650-653` (idem).
Las cotas de input se chequean DESPUÉS del guard, así que un actor no autorizado se rechaza antes de tocar
cualquier parámetro o tabla. **Cubierto por test:** TR.8 (`run.cjs:677-679`) y TR.9 (`run.cjs:737-739`) afirman
`owner B → est_A` ⇒ `notEqual(error, null)` + `match(/42501|not authorized/)` (explícitamente "no vacío"). Las 7
RPC con `p_rodeo_id`/`p_session_id` derivan el est de la fila y guardan igual (`P0002` si no existe → no filtra
existencia de otro tenant); IDOR cubierto en TR.1/TR.2/TR.3/TR.4/TR.5/TR.6/TR.7.

### 3. SECURITY DEFINER seguro — OK
- Las 9 declaran `language plpgsql security definer stable set search_path = public` (`0106:61-62, 155-156,
  214-215, 283-284, 356-357, 417-418, 513-514, 581-582, 647-648`). `search_path` fijo ⇒ sin secuestro de
  resolución de objetos. `STABLE` correcto (read-only).
- **Sin SQL dinámico**: no hay `execute`/`format()`/concatenación. Todos los parámetros son tipados de PostgREST
  (`uuid`/`int`/`text[]`) e interpolados por el planner, no por string. `= any(p_category_codes)` es operador de
  array nativo (no inyectable). **No hay superficie de SQLi.**
- **Read-only**: ninguna función hace `insert`/`update`/`delete`/DDL. TR.10 (`run.cjs:783-786`) lo prueba con
  conteos antes/después.
- **Grants**: revoke `public, anon` + grant `authenticated` para las 9 (`0106:704-722`) + **smoke-check
  fail-closed** (`0106:725-744`) que hace `raise exception` si alguna quedó EXECUTE-able por `anon`/`public`.
  Patrón idéntico a `0105` (4). TR.10 (`run.cjs:759-764`) lo ejerce con un cliente anon real contra las 9.
- `notify pgrst, 'reload schema'` dentro de la transacción `begin/commit` — correcto.

### 4. INPUT-1 (cotas server-side) — OK
Todo parámetro no-uuid tiene cota tras el guard, `raise 22023` fuera de rango:
- `p_year ∈ [1900, current+1]` en las 4 KPIs reproductivas (`0106:224-226, 293-295, 365-367, 428-430`).
- `p_lookback_days >= 0` y `p_limit ∈ [1,1000]` + `limit p_limit` server-side en overdue_doses (`0106:589-594,
  621`).
- `p_threshold_days ∈ [0,3650]` y `cardinality(p_category_codes) <= 64` en unweighed (`0106:655-660`).
- Las RPC sin parámetro de rango (`session_event_summary`, `rodeo_sessions_list`, `rodeo_weight_by_category`)
  solo toman uuids — sin cota numérica necesaria. **No queda ningún input numérico/array sin cota.** Las cotas
  se prueban en ambos extremos en TR.3 (`run.cjs:413`), TR.8 (`run.cjs:665-674`) y TR.9 (`run.cjs:727-734`).

> Nota M4 — bound de fan-out en overdue_doses: el `LIMIT p_limit` (default 500, máx 1000) acota la respuesta;
> `establishment_unweighed` NO tiene `LIMIT` explícito, pero su salida está acotada por el universo de animales
> activos del establecimiento (no es un fan-out amplificable por el cliente, y el tenant ya está scopeado). No es
> finding: la spec/Gate-1 definió la cota de esta alerta como `p_threshold_days` + cardinalidad de categorías, no
> un LIMIT de filas. Lo dejo anotado como observación (ver LOW-1), no como hueco.

### 5. `deleted_at`/`status` (M3) — OK
Filtrados **en el join**, no vía `establishment_of_profile`. Confirmé que `establishment_of_profile` (`0023:9`)
hace `select establishment_id from animal_profiles where id = profile_id` **SIN `deleted_at`** — por eso el código
correctamente NO lo usa y filtra a mano. Discriminación correcta entre histórico y KPI:
- **Histórico de sesión (R7.13.2)** — (1) y (2): `p.deleted_at is null` **sin** `p.status` ⇒ animal archivado
  SIGUE contando (`0106:83...119`, `0106:187`). TR.1 (`run.cjs:299, 308-309`) lo prueba (a2 archivado cuenta).
- **KPI/alertas** — (7), (8), (9): `p.deleted_at is null` **+** `p.status = 'active'` (`0106:544-545, 607-608,
  670-671`). TR.7/TR.8/TR.9 prueban exclusión de archivados.
- KPIs reproductivas: heredan `status='active'` + `deleted_at is null` del set Stream A.

---

## Checklist RAFAQ-específico (lo que el reviewer no mira con lente de security)
- **RLS testeada cross-tenant**: la migración no crea/modifica policies RLS (son funciones SECDEF que las
  bypassean por diseño); el control es el guard interno. TR.10 (`run.cjs:791-793`) agrega tenant-isolation A↮B
  (B lee su propio est, no filtra datos de A). OK.
- **`SECURITY DEFINER` correctamente usado**: estas funciones DEBEN ser SECDEF (necesitan leer event-tables cuya
  RLS es por FK al perfil, que el actor no siempre satisface fila-por-fila), y compensan con guard + scoping
  manual + revoke. Es el patrón correcto, no un bypass abusivo.
- **Secrets / PII en logs**: cero `raise notice`/log con datos de fila. Los `raise exception` solo emiten mensajes
  estáticos ("not authorized...", "out of range") — no filtran datos del tenant ni del actor. La PII devuelta
  (`idv`, `visual_id_alt`, `product_name`) es dato del propio tenant ya visible por RLS; ningún campo `*_private`.
  **No hay information disclosure** (sin `err.message` crudo: estas son RPC SQL, no Edge Functions; los mensajes
  son nuestros).
- **Mass assignment / `insert(body)`**: N/A — no hay escrituras.
- **`createAdminClient()` / service-role en runtime**: N/A — son RPC bajo el JWT del usuario (`authenticated`), no
  service-role. (El `run.cjs` usa service_role SOLO para fixtures de test, no es código de producción.)
- **Rate limiting**: ver tabla abajo.
- **Inputs**: ver tabla abajo.

## Tabla de inputs (parámetros de las RPC expuestas a `authenticated`)
| campo | límite | validación | OK? |
|---|---|---|---|
| `p_session_id` / `p_rodeo_id` (uuid) | tipo uuid (PostgREST) | guard deriva est de la fila + `has_role_in`; `P0002` si no existe | OK |
| `p_establishment_id` (uuid, alertas) | tipo uuid | `has_role_in(p_establishment_id)` **1ª sentencia**, `42501` | OK |
| `p_year` (int) | `[1900, current+1]` | server-side, `22023` | OK |
| `p_lookback_days` (int) | `>= 0` | server-side, `22023` | OK |
| `p_limit` (int) | `[1, 1000]` + `LIMIT` aplicado | server-side, `22023` | OK |
| `p_threshold_days` (int) | `[0, 3650]` | server-side, `22023` | OK |
| `p_category_codes` (text[]) | `cardinality <= 64`; `= any()` (no concatenado) | server-side, `22023`; sin SQLi | OK |
| `p_session_id` opcional (weight) | uuid; debe pertenecer al rodeo/tenant | guard anti-IDOR (`42501` si ajena) `0106:524-531` | OK |

Cada parámetro tiene límite claro + validación autoritativa server-side (SQL). No hay forma de bypassear (el
contrato vive en la propia función, no en el cliente).

## Tabla de rate limits
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| 9 RPC de reporte (read-only) | n.a. (ver nota) | per-user vía JWT + scope per-establishment | sí (guard `42501` / cota `22023`) | Read-only, sin email/SMS/API externa/escritura. Cota de **escaneo** (ventana + LIMIT + threshold + cardinalidad) acota el costo por request (M4). Supabase no rate-limitea RPC por defecto; para un endpoint analítico read-only acotado en escaneo y tenant-scoped, no es un vector de Denial-of-Wallet ni de amplificación. Sin rate limit dedicado = aceptable. |

---

## False positives / cosas que miré y descarté
- **Join a `categories_by_system` sin predicado de tenant** (RPCs 7 y 9): NO es fuga — es tabla de referencia
  global (sin `establishment_id`, `0015`). Descartado.
- **`establishment_unweighed` sin `LIMIT`**: no es hueco de seguridad (salida acotada por animales activos del
  tenant, no amplificable). Observación de perf, no de security → LOW-1.
- **`v_months is null` en `rodeo_calving_kpi`/`by_stage`**: manejado (`cardinality(v_months) >= 1` guard,
  `0106:333`; `v_n < 2 → return`, `0106:436`) ⇒ sin NaN/Inf ni división server-side. Correcto.
- **Columna denorm `establishment_id` en event-tables**: el código deliberadamente NO la usa para scoping (usa el
  join al perfil). Correcto (M2).

## MEDIUM
Ninguno.

## LOW (no bloqueante)
- **LOW-1 (perf, no security):** `establishment_unweighed` no tiene `LIMIT` server-side (a diferencia de
  `overdue_doses`). En un establecimiento con decenas de miles de activos sin pesar, una sola llamada puede
  devolver un set grande. No es fuga ni amplificación (tenant-scopeado, read-only), pero a escala convendría un
  `p_limit` simétrico al de la alerta de dosis. Anotar en `docs/backlog.md` si no se folda ya. No bloquea Gate 2.
- **LOW-2 (trazabilidad):** la suite `run.cjs` corre contra la base REMOTA con `service_role` para fixtures —
  correcto para una suite no-bypass, pero depende de `.env.local`. Ya documentado como roja-hasta-apply; sin
  acción.

---

## Cobertura indirecta (Deno / RLS / PowerSync) — declaración
- **PL/pgSQL `SECURITY DEFINER` + RLS-bypass**: dominio NO cubierto directamente por `sentry-skills:security-review`
  (orientada a app code / OWASP web). **Revisado manualmente** contra el catálogo RAFAQ §A (authz service-role/
  SECDEF, IDOR) y el foco del dispatch — que es donde vive el riesgo real de esta migración.
- **PowerSync / Realtime / BLE / Edge Functions / inputs de formulario**: N/A — esta migración no toca ninguno.
- **Deno**: N/A — no hay Edge Functions en el diff.

## Conclusión
El backend de Stream C implementa correctamente los 4 MEDIUM del Gate 1 (M1 guard 1ª-sentencia fail-closed en las
2 alertas; M2 scoping por join a `animal_profiles`; M3 `deleted_at`/`status` en el join con la distinción
histórico↔KPI; M4 cotas de input server-side). SECURITY DEFINER endurecido (search_path fijo, sin SQL dinámico,
STABLE, revoke anon/public + smoke-check fail-closed). Sin findings HIGH ni MEDIUM. **PASS.**

> Recordatorio operativo (NO es finding): la verificación definitiva del contrato no-bypass / authz / KPIs llega
> cuando el leader **aplique `0106` al remoto** (con OK de Raf), **descomente el hook** de `reports/run.cjs` en
> `scripts/run-tests.mjs` y la suite quede **verde post-apply**. La auditoría estática cubre el SQL; la suite
> cierra el loop dinámico.
