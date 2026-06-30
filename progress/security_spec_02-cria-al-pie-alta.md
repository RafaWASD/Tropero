# Gate 1 — Security review (modo `spec`) · Delta VINCULAR LA CRÍA AL PIE (#15)

**Feature**: `02-cria-al-pie-alta` (delta Nivel B, ADR-028, CON BACKEND)
**Input**: `specs/active/02-modelo-animal/{context,requirements,design,tasks}-cria-al-pie-alta.md`
**Fecha**: 2026-06-30 · **Modo**: spec (ADR-019, Gate 1 OBLIGATORIO)
**Veredicto**: **PASS** (con 2 endurecimientos MEDIUM recomendados para foldear en tasks + observaciones LOW)

---

## Resumen ejecutivo

La spec está escrita con conciencia de seguridad de primer nivel: ambos RPC nuevos/extendidos calcan
patrones ya gateados y verificados (`0075` idempotencia anti-oráculo, `0087` anti-IDOR + smoke-check
fail-closed, `0045` `birth_calves` sin `GRANT INSERT`, `0067` trigger nursing). Verifiqué cada afirmación
de seguridad de `design §2/§3/§6` contra el SQL real as-built y **todas se sostienen**:

- Tenant SIEMPRE derivado de filas reales (madre y ternero), nunca del payload.
- Ternero derivado **scopeado al tenant de la madre** con `23503` genérico para "no existe" y "otro tenant"
  (sin oráculo cross-tenant) — calca `0075`/`0087`.
- `has_role_in(v_est)` sobre el tenant DERIVADO, antes de cualquier rama.
- Idempotencia anclada a `(madre, client_op_id, tenant)` + índice único compuesto `(animal_profile_id,
  client_op_id)` (NO global) — hereda el fix HIGH-D1 de `0075`.
- Re-link rechazado (`23514`) DESPUÉS del replay (no rompe idempotencia legítima).
- `birth_calves` conservada SIN `GRANT INSERT` a `authenticated` (verificado en `0045:35-39`): el cliente NO
  puede fabricar parentescos por PostgREST; solo el DEFINER puebla.
- Superficie cerrada: `SECURITY DEFINER` + `search_path=public` + revoke public/anon + grant authenticated +
  smoke-check fail-closed + `notify pgrst`.
- `register_birth` extendido con `p_calf_rodeo_id default null`: default NULL preserva el comportamiento
  as-built (callers inalterados); rodeo validado activo + `establishment_id = v_est` (tenant de la madre) +
  mismo sistema → `23514` (calca `0087:115`); DROP de la firma vieja `(uuid,date,jsonb,uuid)` — la correcta
  as-built tras `0075:62` — + CREATE de la nueva, revoke/grant sobre la firma nueva (sin grant colgando).
- **No introduce tablas, columnas, índices ni policies nuevas** (confirmado en `design §1/§2/§3`).

**No hay findings HIGH.** Los dos MEDIUM son endurecimientos de robustez **bajo concurrencia** (mismo
tenant, no cross-tenant, no disclosure) que la spec promete como invariantes pero apoya en checks no
atómicos; ambos tienen fix concreto y barato.

---

## Findings HIGH

Ninguno.

---

## Findings MEDIUM

### MED-1 — Re-link guard es TOCTOU: la invariante "un ternero, una madre" (RCAP.6.6) no es atómica bajo concurrencia

**Evidencia (`design §2`, paso f):**
```sql
if exists (
  select 1 from birth_calves bc
  join reproductive_events re on re.id = bc.birth_event_id
  where bc.calf_profile_id = p_calf_profile_id and re.deleted_at is null
) then raise 23514 'calf already linked to a mother'; end if;
```
Es un `SELECT ... EXISTS` seguido de `INSERT` (paso h), **sin lock ni constraint** que serialice. La PK de
`birth_calves` es `(birth_event_id, calf_profile_id)` (`0045:16`) y los índices `birth_calves_by_calf`
(`0045:19`) **no son únicos** sobre `calf_profile_id`. No existe constraint que impida que el mismo
`calf_profile_id` aparezca en DOS eventos `birth` distintos.

**Exploit (mismo tenant):** dos `link_calf_to_mother` concurrentes para el MISMO `calf_profile_id` hacia dos
madres distintas (ambas del mismo establecimiento — el ternero se deriva scopeado a `v_est`, así que ambas
madres son del tenant del ternero). Bajo `READ COMMITTED` (default PG), ninguna transacción ve la fila
`birth_calves` no-commiteada de la otra → ambas pasan el `EXISTS` → ambas insertan → **el ternero queda
ligado a dos madres**, cada madre cuenta un parto (recompute `0046`) → KPI reproductivo corrupto y linaje
inconsistente. No es cross-tenant ni disclosure (por eso MEDIUM, no HIGH), pero **viola una invariante que la
spec promete explícitamente** (RCAP.6.6, `design §6` "un ternero solo puede tener una madre").

**Reachability:** la outbox drena FIFO/secuencial por device → un device no se corre solo; requiere dos
sesiones/devices del mismo campo linkeando el mismo ternero a la vez, o un retry at-least-once inflight. Baja
probabilidad, consecuencia silenciosa y difícil de detectar.

**Fix concreto (elegir uno, foldear en T1/`design §2`):**
- **(preferido)** Tomar un lock de fila sobre el ternero al inicio del flujo de escritura, antes del guard f:
  `perform 1 from animal_profiles where id = p_calf_profile_id for update;` (ya se deriva el ternero en el
  paso d — agregar `for update` a ese `select` lo cubre). Serializa concurrentes sobre el mismo ternero sin
  tocar otras filas. O `pg_advisory_xact_lock(hashtextextended(p_calf_profile_id::text, 0))`.
- Una unique parcial sobre `birth_calves(calf_profile_id)` NO es viable directamente porque el "está vivo" del
  vínculo vive en `reproductive_events.deleted_at` (otra tabla) → el lock de fila es el camino limpio.

**Nota de duda HIGH/MEDIUM:** lo dejo en MEDIUM porque es integridad **dentro del mismo trust boundary**
(mismo tenant), sin disclosure ni escalación. Si el leader considera la corrupción de KPI reproductivo como
impacto de release-blocker, súbanlo a HIGH — el fix es el mismo y barato.

### MED-2 — La clasificación de error idempotente del outbox no se extiende a `link_calf_to_mother` (re-abre MED-1 de `0075` bajo carrera concurrente)

**Evidencia (`upload.ts:207-218`, as-built):**
```ts
if (
  code === '23505' &&
  opType === 'register_birth' &&                                 // ← solo register_birth
  /reproductive_events_client_op_id_uq|client_op_id/i.test(`${msg} ${details}`)
) {
  return 'idempotent_discard';
}
```
La spec (`design §4`, T12) agrega `link_calf_to_mother` a `RPC_OP_TYPES` y a la rama de inyección de
`p_client_op_id` (`upload.ts:146`) — correcto. Pero `link_calf_to_mother` inserta en `reproductive_events`
con `client_op_id` (RCAP.6.8, `design §2` paso g) → comparte el MISMO índice único compuesto
`reproductive_events_client_op_id_uq`. El guard procedural de replay (RCAP.6.7) cubre el caso **secuencial**
(ACK perdido → 2ª llamada ve el evento → `2xx {replay:true}`), pero una **carrera concurrente** del mismo
caller (dos inserts inflight del mismo `client_op_id` antes de commitear) levanta `23505` sobre ese índice.

Como la clasificación de `upload.ts:212` está hardcodeada a `opType === 'register_birth'`, un `23505` de
`link_calf_to_mother` cae a `permanent_reject` (`upload.ts:222`) → **rollback del overlay optimista +
superficia un error**, aunque la op SÍ se aplicó server-side (uno de los dos inserts commiteó). Esto
contradice RCAP.8.3 ("un reintento at-least-once … no cree un segundo vínculo … sin error que rompa el ACK")
bajo concurrencia, y re-abre exactamente el finding MED-1 que se documentó y arregló para `register_birth`
en `0075`/`upload.ts`. No hay pérdida de dato (el `birth_calves` real baja por la stream de sync), pero el
usuario ve un error espurio + flicker del estado optimista.

**Severidad:** MEDIUM — robustez/idempotencia (no disclosure, no cross-tenant). La ventana concurrente es
chica, pero la spec promete at-least-once safety y este es el patrón MED-1 conocido que el delta debería
heredar.

**Fix concreto (foldear en T12 / `design §4`):** extender el guard de `upload.ts:212` para incluir
`link_calf_to_mother` (o generalizarlo a cualquier op que escriba `reproductive_events.client_op_id`):
`(opType === 'register_birth' || opType === 'link_calf_to_mother')`. Y declararlo en RCAP.8.3 explícitamente.

---

## Anexo LOW (observaciones — no bloquean)

- **LOW-1 (FUNCIONAL, no security) — el identificador tipeado no fluye al CREATE.** RCAP.2.4 dice
  "precargando el identificador ingresado", pero el payload del camino CREATE en `design §5` es
  `registerBirth(madre, [{sex, birthDate?}], calfRodeoId)` — **omite la caravana**. El ternero nuevo no
  recibiría la caravana que disparó el find-or-create. Desde seguridad es benigno (menos input sin validar
  llega al server); lo marco para que el leader/spec_author lo resuelva como completitud funcional, no como
  gate de seguridad. (Si se decide pasarla, va por `p_calves[].calf_tag_electronic`, que `register_birth`
  ya trimmea/`nullif`ea — ver LOW-2.)

- **LOW-2 (pre-existente, no introducido por el delta) — `calf_tag_electronic` sin tope de largo/charset
  server-side.** Si el CREATE termina pasando la caravana, `register_birth` (`0075:157`) solo hace
  `nullif(trim(...))` sin validar largo ni formato (FDX-B 15 dígitos). Es comportamiento as-built que este
  delta NO cambia, pero como `0115` reescribe la función (DROP+CREATE) es la oportunidad barata de sumar un
  guard de largo/charset. Recomendado, no bloqueante.

- **LOW-3 — `p_event_date` sin validación de rango server-side.** Ambos RPC aceptan `p_event_date date` del
  cliente sin acotar (futuro/absurdo). Impacto bajo: setea la fecha del evento `birth` de la madre;
  `compute_category` cuenta eventos `birth` sin mirar la fecha (`0045:75`) → sin efecto de categoría/seguridad.
  Data-quality. Opcional: rechazar `p_event_date > current_date` o `< '1990-01-01'`.

---

## Tabla de inputs (cada campo que el usuario tipea en el flujo)

| Campo | Límite (largo/charset/formato/rango) | Validación | OK? |
|---|---|---|---|
| Caravana del ternero (EID/IDV) | EID: largo/dígitos por `classifyIdentifier` (RCAP.2.5); IDV: por motor spec 09 | Cliente clasifica + valida (RCAP.2.5 error inline). **El server NO recibe la caravana cruda en el link**: recibe `p_calf_profile_id` (uuid) resuelto por el find-or-create local, y lo valida contra la fila real scopeada al tenant de la madre (RCAP.6.4). | ✅ (link: el server valida el uuid contra fila real, no el texto) |
| Sexo del ternero (CREATE) | enum `male`/`female` | **AUTORITATIVA server-side**: `register_birth` rechaza `calf_sex ∉ {male,female}` con `23514` (`0075:153`). Cliente exige sexo (RCAP.4.2). | ✅ |
| Fecha de nacimiento (CREATE, opcional) | tipo `date`; es-AR DD/MM sin clamp (RCAP.9.4) | Tipo `date` enforced; sin rango server (LOW-3). | ⚠️ LOW-3 |
| Rodeo del ternero (CREATE) | uuid | **AUTORITATIVA server-side**: `register_birth` valida activo + `establishment_id = v_est` (tenant madre) + mismo sistema → `23514` (RCAP.7.3, calca `0087:115`). | ✅ |
| `p_event_date` del link | tipo `date` | Tipo enforced; sin rango (LOW-3). Bajo impacto (no afecta categoría ni el calf). | ⚠️ LOW-3 |
| Caravana → CREATE (precarga) | n/a | Inconsistencia RCAP.2.4 vs `design §5` (LOW-1). Si se pasa, ver LOW-2. | ⚠️ LOW-1 (funcional) |

**Veredicto inputs:** todos los inputs que alcanzan el server tienen validación autoritativa server-side
(uuid contra fila real, enum de sexo, rodeo validado). Las observaciones LOW son de rango de fecha y de
completitud funcional, no huecos de validación que bloqueen el PASS.

## Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `link_calf_to_mother` (RPC) | n.a. | n.a. | n.a. (authz fail-closed) | No manda email/SMS, no pega API externa, no es bulk (1 fila evento + 1 puente por call). Costo trivial. Authz `has_role_in` + scoping al tenant la cierra. Un abuso a escala desde un caller autenticado sería self-tenant y acotado por el guard re-link (`23514`). Rate limit propio NO requerido. |
| `register_birth` extendido (RPC) | n.a. | n.a. | n.a. | Mismo razonamiento; el delta solo agrega `p_calf_rodeo_id`, no cambia el perfil de abuso as-built. No es endpoint de costo (sin email/SMS/API externa). Crea ≤N filas por call acotado por `p_calves`. |
| Find-or-create / lookup (cliente) | n.a. | n.a. | n.a. | Lectura LOCAL PowerSync (RCAP.2.2 "sin red, lectura local") → no pega al server, no enumera remoto. Sin superficie de DoS server. |

**Veredicto rate limits:** ninguna acción del delta es de costo/bulk/comunicación externa → rate limit propio
no aplica. La defensa real es authz + scoping (fail-closed). Documentado.

---

## Dominios revisados (catálogo RAFAQ)

- **A1 Service-role bypass RLS** — n.a. (no usa `createAdminClient`; el bypass de RLS es por `SECURITY
  DEFINER`, mitigado con authz manual `has_role_in(v_est)` + scoping a `v_est` en cada derivación). ✅
- **A2 Mass assignment** — ✅ RPC con params escalares tipados; `establishment_id`/`rodeo_id`/`category`/
  `entry_origin` derivados server-side, nunca del payload. `p_calves` parseado por whitelist
  (`calf_sex`/`calf_weight`/`calf_tag`).
- **A3 IDOR por FK** — ✅ el ternero (hijo del evento) se valida contra su fila real scopeada al tenant de la
  madre antes de insertar el puente; el rodeo del CREATE se valida contra el tenant de la madre.
- **A4 Function-level authz** — ✅ `has_role_in` (cualquier rol activo, paridad con `register_birth`/
  `create_animal`); fail-closed `42501`.
- **B1 Information disclosure** — ✅ mismo `23503` para "no existe" y "otro tenant" (sin oráculo); replay
  anclado en `animal_profile_id` (sin lookup global por `client_op_id`). RPC devuelve `jsonb` mínimo
  (`birth_event_id`, `replay`), no `err.message` crudo.
- **B3 Over-fetching column-level** — n.a. (no cambia selects de cliente; `birth_calves_select` intacta).
- **C1/C2 Sync rules / Realtime** — `birth_calves` ya en el sync set (downstream read), RLS deriva tenant de
  la madre + filtra `deleted_at` (`0045:26-34`). El delta no agrega tablas al sync set. ✅
- **C4 Stale-auth en replay / integridad append-only** — ✅ la re-autorización corre server-side al sync
  (`has_role_in` cada vez); idempotencia scopeada. **MED-1 y MED-2** son los matices de concurrencia.
- **D1 service_role en cliente** — n.a. (sin cambios de claves; RPC vía `authenticated`).
- **E1 Queries sin tope / E2 denial-of-wallet** — n.a. (sin email/SMS/API externa; ops acotadas).
- **F1 PostgREST filter injection** — ✅ el server NO recibe texto libre concatenado: el link toma uuids; el
  find-or-create es lectura local (motor spec 09).
- **H1 Invalidación de sesión** — n.a. (no toca auth/roles).
- **Schema sin declarar** — ✅ verificado: `design §1/§2/§3` afirman "no crea tablas/columnas/índices/
  policies"; reusa `reproductive_events.client_op_id` + índice de `0075`, `birth_calves`/triggers de
  `0045`/`0046`/`0067`. No detecté schema oculto.
- **Offline/bypass** — ✅ los `pending_*` son overlay LOCAL; la única vía de escritura upstream es el
  op_intent → RPC (`upload.ts mapIntentToRpc`); `birth_calves` sin `GRANT INSERT` (`0045:35-39`) → un cliente
  no puede fabricar el puente por PostgREST aunque manipule su SQLite local.

## Dominios excluidos (con justificación)

- **F2 Import de archivos / F3 SSRF / F4 XSS email** — el delta no importa archivos, no hace `fetch()` a URLs
  de usuario, no manda email. Fuera de alcance.
- **G BLE** — el delta no toca el canal BLE (la caravana entra por teclado / find-or-create, no por bastón en
  este flujo).
- **E3 Bot defense / E4 Enumeration / H2 credenciales / I compliance** — el delta no toca signup/auth/
  borrado de cuenta/PII regulada nueva. Fuera de alcance.

---

## Recomendación al leader

**PASS.** La spec es segura para el caso común y calca patrones gateados. Recomiendo **foldear MED-1 y MED-2
en las tasks antes de implementar** (T1 + `design §2` para el lock de fila del ternero; T12 + RCAP.8.3 para la
clasificación idempotente de `link_calf_to_mother`): son fixes de una línea cada uno que cierran la invariante
prometida bajo concurrencia. LOW-1 (caravana al CREATE) es una decisión funcional del spec_author/Raf, no de
seguridad. La migración la aplica el leader post-Gate-2; no hay SQL aplicado aún — esta auditoría es sobre la
spec.
