# Gate 2 (code) — Run 2 migración 0075 (2026-06-08)

> `security_analyzer` modo `code` (ADR-019). Re-verificación del **SQL real** del fix HIGH-D1 (IDOR cross-tenant) que pidió el Gate 1 sobre la spec.
> Delta de backend de Run 2: `supabase/migrations/0075_register_birth_idempotency.sql` (untracked) + tests en `supabase/tests/animal/run.cjs` (suite top-level "spec 15-powersync — register_birth idempotencia", L2059-2244).
> baseline_commit `1618a9566037eeca65cf2fa8841c86379ba35809`; todos los cambios sin commitear (`git status --porcelain` confirma: 0075 untracked, run.cjs `M`). Branch `main`.
> Comparado contra el as-built `0045_birth_calves.sql`, helpers `0005_rls_helpers.sql`, y la cadena de triggers de `reproductive_events` (0026/0031/0046/0048/0054/0061/0063/0067).
> Skill `sentry-skills:security-review` invocada sobre el diff; refs cargadas `authorization.md` (IDOR) + `business-logic.md` (race/idempotency). La skill no cubre semántica PL/pgSQL/RLS → el análisis del guard es manual (ver "Cobertura indirecta").

## Veredicto: **PASS** (0 HIGH)

El fix HIGH-D1 está implementado correctamente en SQL: el guard idempotente **no devuelve datos cross-tenant** y **no es oráculo de existencia**. `has_role_in(v_est)` derivado de la fila REAL de la madre rige PRIMERO. El tenant de los terneros se hereda del server (`v_est`), nunca del payload. Firma/grants correctos. Sin regresión sobre policies/triggers/gating as-built. La race de idempotencia es **MED** (UX/cola, no seguridad). Sin findings HIGH ni MEDIUM de seguridad.

---

## Punto 1 (FOCO) — Escenario de ataque IDOR cross-tenant: **B NO obtiene NADA de A**

**Ataque construido** (exactamente el test caso 2 / T7.7, L2138-2214): usuario B, owner de `estB`, SIN rol en `estA`, observa por replay un `client_op_id = X` de un parto de A y llama:
`register_birth(p_mother_profile_id := <madre de B>, p_event_date, p_calves := [...], p_client_op_id := X)`.

**Trace del data flow por la RPC `0075` (línea por línea):**

1. **Authz primero, anclada a la fila real (0075:93-104).** El `SELECT ... INTO v_est` resuelve `establishment_id` desde `animal_profiles WHERE p.id = p_mother_profile_id`. B pasó SU madre → `v_est = estB`. `has_role_in(estB)` → **true** (B es owner de estB). La authz pasa, pero `v_est` quedó anclado a **estB**, no a estA. has_role_in valida la madre que el caller PASÓ, no la del parto que quiere replayear. Correcto.

2. **Guard idempotente scopeado (0075:114-128).** El lookup del parto existente es:
   ```sql
   select re.id into v_existing_id
   from public.reproductive_events re
   join public.animal_profiles p on p.id = re.animal_profile_id
   where re.client_op_id     = p_client_op_id        -- = X (de A)
     and re.animal_profile_id = p_mother_profile_id  -- = madre de B
     and p.establishment_id   = v_est                -- = estB
     and re.deleted_at is null
   limit 1;
   ```
   El parto de A tiene `client_op_id = X` **pero** `animal_profile_id = madre de A` y `establishment_id = estA`. Las tres condiciones de scoping (`animal_profile_id = madre de B` **y** `establishment_id = estB`) **fallan** contra la fila de A → `v_existing_id` queda **NULL** → **NO se devuelve nada** (no entra el `return v_existing_id` de L124). No hay lectura del `id`/datos del parto de A. **No hay IDOR.**

3. **Cae al camino de creación.** B inserta su PROPIO evento con `(animal_profile_id = madre de B, client_op_id = X)` (0075:143-145). El índice único es **COMPUESTO PARCIAL** `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` (0075:52-54). La tupla de B `(madre de B, X)` ≠ la de A `(madre de A, X)` → **NO colisiona** (madre distinta) → el INSERT de B entra en su propia tupla. B crea su propio parto en estB. `rB.data ≠ birthIdA`.

4. **No hay oráculo de existencia.** Esta es la parte clave del fix vs. la versión vulnerable. Con un índice GLOBAL `(client_op_id)` único, el INSERT de B habría dado `23505` SOLO si X ya existía en cualquier tenant → la presencia/ausencia del error sería un bit que revela "existe un parto con client_op_id X en algún lado" (oráculo binario cross-tenant). El índice **compuesto por (madre, client_op_id)** elimina ese diferencial: el INSERT de B nunca colisiona con la fila de A porque la madre es distinta → el resultado de B es independiente de si X existe en estA. No se puede inferir nada del parto de A.

**Resultado del escenario:** B recibe el id de SU PROPIO parto (sobre la madre de B, en estB), o —en el sub-caso donde B reusara X sobre su propia madre dos veces— un `23505` genérico. **Jamás** `rB.data === birthIdA`, jamás el id/datos del parto de A, jamás un oráculo de existencia. El parto de A queda intacto (verificado por el test L2203-2213: mismos terneros, mismo `animal_profile_id`, mismo `client_op_id`). **No IDOR — fix HIGH-D1 confirmado en el SQL real.**

> Nota de defensa-en-profundidad: aunque por un bug el lookup hubiera matcheado la fila de A, la authz de la línea 102 ya falló para cualquier intento de B sobre una madre de A (cross-tenant directo → 42501, cubierto por el test SEC-SPEC-02 L1144-1165 del as-built). El ataque por `client_op_id` es el único vector nuevo que abre 0075, y está cerrado por el doble anclaje `animal_profile_id = p_mother_profile_id AND establishment_id = v_est`.

## Punto 2 — Authz preservada: `has_role_in(v_est)` intacto y primero — **OK**

- El bloque de authz (0075:91-104) es **byte-por-byte** el del as-built (0045:213-225): mismo JOIN `animal_profiles → animals → rodeos`, mismo `WHERE p.id = p_mother_profile_id AND p.deleted_at IS NULL`, mismo `raise 23503` si NULL, mismo `if not has_role_in(v_est) → 42501`. Sin debilitamiento.
- El guard idempotente (a-bis) corre **DESPUÉS** de has_role_in (0075:106-128), nunca antes. Un caller sin rol en `v_est` muere en L102-104 antes de tocar el guard.
- `v_est` se deriva de la fila real de la madre (server), no de ningún parámetro. El payload de B no puede mentir el tenant: aunque inyecte campos extra en `p_calves`, los terneros heredan `establishment_id = v_est` (0075:173) y `rodeo_id = v_rodeo_id` (0075:174) del lookup server-side. `p_calves` solo controla `calf_sex`/`calf_weight`/`calf_tag_electronic` (validados en L152-157). Sin mass assignment de tenant.

## Punto 3 — Firma / grants: **OK**

- `drop function if exists public.register_birth (uuid, date, jsonb)` (0075:62) elimina la firma vieja de 3 args → no quedan grants colgando de ella (el `grant ... to authenticated` de 0045:298 se va con el DROP).
- `create function ... (uuid, date, jsonb, uuid)` (0075:64-68) con `p_client_op_id uuid default null`. DROP+CREATE en la misma migración atómica → sin hueco de resolución de overload.
- `revoke execute on function public.register_birth (uuid, date, jsonb, uuid) from public, anon` (0075:203) + `grant ... to authenticated` (0075:204). La función queda invocable **solo por `authenticated`**, no por `anon` ni `public`. Correcto: es el camino de carga de partos del cliente. El call online de 3 args resuelve por el `default null` del 4to param (misma firma, sin ambigüedad porque la de 3 args ya no existe).
- `language plpgsql security definer set search_path = public` (0075:70-71) — idéntico al as-built. `search_path` fijado → sin riesgo de search-path hijacking. SECURITY DEFINER necesario (puebla `birth_calves`/`animal_profiles` que el cliente no puede escribir directo — SEC-SPEC-04).
- `notify pgrst, 'reload schema'` (0075:206) presente.

## Punto 4 — Índice compuesto parcial: **OK**

- `create unique index if not exists reproductive_events_client_op_id_uq on (animal_profile_id, client_op_id) where client_op_id is not null` (0075:52-54).
- **PARCIAL** (`WHERE client_op_id IS NOT NULL`): los partos online históricos y los nuevos sin `p_client_op_id` quedan con `client_op_id = NULL` → **fuera del índice** → no se les impone unicidad. Verificado por el test caso 3 (L2216-2238): parto online de 3 args → `client_op_id` NULL, mismo comportamiento que el as-built, 2 terneros, madre transiciona. Sin efecto sobre históricos.
- **COMPUESTO** `(animal_profile_id, client_op_id)`: el ancla de tenancy es `animal_profile_id` porque `reproductive_events` NO tiene `establishment_id` denormalizado (0026:32-52 — confirmado, no existe esa columna). Esto cierra el oráculo de existencia (ver P1 punto 4).

## Punto 5 — Sin regresión de superficie as-built — **OK**

Verifiqué que 0075 NO toca ninguna policy/RLS/trigger/función as-built (solo agrega 1 columna, 1 índice y reemplaza la RPC):

- **RLS de `reproductive_events`** (0026:62-72) y de `birth_calves` (0045:24-39): **intactas**. 0075 no emite `alter ... policy` ni `create policy`. El `client_op_id` queda cubierto por la policy de SELECT existente (filtra por `animal_profile_id` derivado → tenant) — no es columna sensible expuesta cross-tenant porque la fila entera ya está scopeada por RLS.
- **SEC-HIGH-01 (apply_auto_transition expuesto como RPC)**: NO reintroducido. 0075 no toca `apply_auto_transition` ni su `revoke` (cerrado por 0042/0065). El trigger `tg_reproductive_events_apply_transition` (0031:80 / 0063:20) lee de `new.event_type`/`new.animal_profile_id`/`animal_profiles` — **nunca** `client_op_id` → la columna nueva es transparente; el trigger sigue corriendo como SECURITY DEFINER owner-del-schema (conserva su EXECUTE pese al revoke).
- **INSERT del evento con `calf_sex` NULL no rompe el gating** (0054:128-143): el trigger de gating de `reproductive_events` solo gatea `tacto`/`tacto_vaquillona`/`service+ai` — **`birth` NO se gatea** (0054:21,126). El INSERT del birth pasa el gating igual que el as-built. Además `calf_sex` es `text CHECK (calf_sex in ('male','female'))` **sin NOT NULL** (0026:46) → `calf_sex` NULL pasa el CHECK (en Postgres el CHECK no se evalúa sobre NULL). El INSERT con `calf_sex` implícito NULL (0075:143-145) es legal — idéntico al as-built (0045:239-241), solo añade la columna `client_op_id`.
- **Triggers BEFORE/AFTER de la cadena de parto** (mono-ternero 0048:21-77, puente 0048:82-100, nursing 0061/0067): todos filtran por `event_type='birth'` / `calf_id` / `calf_sex is null` → ninguno lee `client_op_id`. El camino mellizos (calf_sex NULL en el evento) sigue saltando el BEFORE mono-ternero (0048:37) y poblando `birth_calves` por dentro de la RPC (0075:184-185) → nursing recomputa por el trigger de `birth_calves` (0067). Sin cambio de comportamiento.
- **Atomicidad (R9.4/R9.5)**: el loop de terneros (0075:150-190) es idéntico al as-built; cualquier excepción (ternero intermedio inválido, TAG duplicado) propaga y revierte todo. El INSERT del `client_op_id` está dentro de la misma transacción → si el parto falla, no queda el `client_op_id` "consumido".

## Punto 6 — Race de idempotencia: **MED (UX/cola, NO seguridad)**

Dos reintentos concurrentes del MISMO caller (misma madre, mismo X) que entran al guard antes de que ninguno commitee: ambos ven `v_existing_id = NULL` (la fila del otro aún no es visible), ambos van a crear. El índice único compuesto `(madre, X)` garantiza que **uno** commitea y el otro choca con `23505` (unique_violation) al insertar el evento → su transacción revierte entera (atomicidad). Resultado neto: **exactamente un parto**, nunca dos. No hay doble-apply.

**Severidad de seguridad: ninguna.** No es TOCTOU explotable: el invariante de seguridad (un solo parto, sin datos cross-tenant) lo **garantiza el índice único a nivel DB**, no el check procedural — el guard es defensa-en-profundidad/optimización, el índice es la barrera dura (patrón correcto según `business-logic.md` §Idempotency + §Race: "Database-Level Locking / unique constraint"). El perdedor recibe un `23505` genérico (no filtra datos ajenos — además es el MISMO caller, mismo tenant). El único efecto es de **UX/cola**: el reintento perdedor ve un error en vez de un no-op limpio. Eso es problema de la outbox de PowerSync (clasificar `23505` sobre `op_intents` como "ya aplicado, descartar de la cola" en lugar de reintentar en loop), a manejar en **Run T6** (upload.ts / clasificación de errores). Lo marco como **nota MED no-bloqueante de seguridad** (es robustez de cola, no un hueco). Recomendación para Run T6: que el connector trate `23505` sobre el índice `reproductive_events_client_op_id_uq` como éxito idempotente (descartar la op, no reintentar).

---

## Findings HIGH (Sentry + RAFAQ-SPECIFIC)

**Ninguno.** 0 HIGH.

## Findings MEDIUM

- **MED-1 (robustez de cola, no hueco de seguridad)** — race de idempotencia concurrente → el reintento perdedor recibe `23505` en vez de no-op. No explotable (el índice garantiza un solo parto, sin fuga cross-tenant). A resolver en Run T6 (clasificar `23505` sobre `reproductive_events_client_op_id_uq` como descarte idempotente). Ver Punto 6. NO bloquea Gate 2.

## False positives descartados (skill + validación manual)

- **"Función SECURITY DEFINER que devuelve un id por `client_op_id` del cliente" → potencial IDOR (api-security/authorization)**. **Descartado**: el lookup está doble-anclado a `animal_profile_id = p_mother_profile_id AND establishment_id = v_est` (0075:118-121), y `v_est`+authz se derivan de la fila real de la madre ANTES (0075:93-104). El `client_op_id` del cliente NO es la clave de acceso — es un filtro adicional sobre una fila YA scopeada al tenant del caller. No es CWE-639 (authz bypass por user-controlled key) porque la key no controla el scope.
- **"`p_calves` (jsonb del cliente) → mass assignment"** (api-security). **Descartado**: el loop arma el objeto del INSERT campo-por-campo (0075:163-182); del payload solo se leen `calf_sex` (validado contra set `male/female`, L153-154), `calf_weight` (cast numeric, L156), `calf_tag_electronic` (trim/nullif, L157). `establishment_id`/`rodeo_id`/`status`/`entry_origin` se setean server-side desde `v_est`/`v_rodeo_id`/constantes. No hay spread del payload.
- **"Race condition en el guard idempotente" → TOCTOU (business-logic)**. **Descartado como vuln**: el invariante lo garantiza el unique index a nivel DB, no el check (ver Punto 6). Reclasificado a MED-1 (robustez de cola).
- **"`search_path` / inyección SQL en PL/pgSQL"**. **Descartado**: `set search_path = public` fijo (0075:71); cero SQL dinámico (no hay `execute format(...)` ni concatenación); todas las queries son estáticas con parámetros bind. `p_client_op_id` es `uuid` (tipado, no interpolable como texto).
- **Tests (`run.cjs`)** — fuera de scope de reporte de vulns (la skill excluye test files); revisados solo como evidencia de que el escenario de ataque está cubierto. Cubren caso 1 (no doble-apply), caso 2 (cross-tenant IDOR, OBLIGATORIO T7.7), caso 3 (online intacto). Adecuados.

---

## Tabla de inputs (campos del cliente nuevos/modificados en Run 2)

| campo / input | límite | validación | OK? |
|---|---|---|---|
| `p_client_op_id` (uuid de idempotencia) | tipo `uuid` (no interpolable) | server: tipado por firma; usado solo como filtro sobre fila ya tenant-scopeada + clave del índice compuesto | ✅ |
| `p_mother_profile_id` (uuid) | tipo `uuid` | server: `has_role_in(v_est)` sobre la fila real (0075:102) — fail-closed 42501 | ✅ |
| `p_calves[].calf_sex` | set cerrado `{male,female}` | server: `not in (male,female) → 23514` (0075:153-154) | ✅ |
| `p_calves[].calf_weight` | numeric(7,2) (col) | server: cast `::numeric` + CHECK de columna 0026:45 | ✅ |
| `p_calves[].calf_tag_electronic` | text, unique global (animals) | server: trim/nullif + unique constraint de `animals.tag_electronic` (rollback atómico si dup) | ✅ |
| `p_event_date` (date) | tipo `date` | server: tipado por firma | ✅ |

## Tabla de rate limits (acciones abusables tocadas por Run 2)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `register_birth` (RPC, vía PostgREST) | n.a. (no nuevo) | per-user (authenticated) | sí (sin rol en v_est → 42501) | mismo PostgREST que el as-built; 0075 no afloja `[auth.rate_limit]` ni agrega Edge Function. El índice único acota el doble-apply por reintento. Sin denial-of-wallet nuevo (no email/SMS/API externa). |

Run 2 **no manda email/SMS, no pega a APIs externas, no agrega Edge Functions, no toca `config.toml`** → sin vectores de rate-limit nuevos.

---

## Archivos analizados (superficie de Run 2)

- `supabase/migrations/0075_register_birth_idempotency.sql` — columna + índice compuesto parcial + RPC `register_birth` (4 args) con guard idempotente scopeado.
- `supabase/tests/animal/run.cjs` (L2059-2244) — suite de idempotencia (casos 1/2/3) — evidencia del escenario de ataque cubierto.
- **Comparados (no modificados, contexto de no-regresión)**: `0045_birth_calves.sql` (as-built de la RPC), `0005_rls_helpers.sql` (`has_role_in`), `0026_reproductive_events.sql` (schema + RLS + CHECK de `calf_sex`), `0031`/`0063` (trigger de transición), `0046` (recompute), `0048` (mono+puente), `0054` (gating DB), `0061`/`0067` (nursing), `0042`/`0065` (revokes SEC-HIGH-01).

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia)

La skill `sentry-skills:security-review` (orientada a JS/TS/web) **no cubre directamente** la semántica de PL/pgSQL, RLS de Postgres ni el modelo de overloads de funciones. El análisis del **guard idempotente, el scoping del lookup, el índice compuesto y la no-regresión de triggers** es **manual** (trace línea-por-línea contra el as-built + cadena de triggers as-built), aplicando la metodología de la skill (`authorization.md` IDOR + `business-logic.md` idempotency/race). El escenario de ataque del Punto 1 **no se ejecutó contra el remoto** (la migración 0075 aún NO está aplicada — la aplica el leader por Management API tras este gate; los tests fallan hasta entonces, esperado). El análisis es estático sobre el SQL real; los tests `run.cjs` codifican el invariante y se ejecutarán post-deploy.

---

## Resumen para el leader

- **Veredicto: PASS** (0 HIGH, 1 MED no-bloqueante de cola).
- **Escenario de ataque (P1):** B (otro establecimiento, sin rol en estA) replayea el `client_op_id X` de un parto de A sobre una madre PROPIA de B → **B NO recibe el id ni datos del parto de A, ni un oráculo de existencia**. El lookup falla por doble anclaje (`animal_profile_id = madre de B` y `establishment_id = estB`), cae a creación, y el índice compuesto `(madre, client_op_id)` evita colisión con la tupla de A (madre distinta). B crea su propio parto en estB; el de A queda intacto. **Fix HIGH-D1 confirmado en el SQL real.**
- **Authz/tenant (P2):** `has_role_in(v_est)` de la fila real de la madre rige primero e intacto; terneros heredan tenant del server (`v_est`), nunca del payload.
- **Firma/grants (P3):** DROP firma vieja + CREATE 4-arg; `revoke from public, anon` + `grant to authenticated`; invocable solo por authenticated; `search_path` fijo; `notify pgrst`.
- **Índice (P4):** compuesto parcial correcto; sin efecto sobre partos online históricos (client_op_id NULL fuera del índice); cierra el oráculo de existencia.
- **No-regresión (P5):** 0075 no toca policies/RLS/triggers/gating as-built; SEC-HIGH-01 NO reintroducido; `calf_sex` NULL pasa el CHECK y no gatea (birth no se gatea); cadena de triggers transparente a `client_op_id`.
- **Race (P6):** garantía dura por el unique index (un solo parto, sin fuga). No es vuln; es robustez de cola → MED-1, a manejar en Run T6 (clasificar 23505 como descarte idempotente).
