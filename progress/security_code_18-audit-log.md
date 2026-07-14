# Security review (modo `code`) — 18-audit-log

**Veredicto: PASS**

**Decisión del frontier WAL de PowerSync — VEREDICTO EXPLÍCITO: ACEPTAR el streams-frontier (SEGURO). NO se exige convertir la publication a `FOR TABLE`.** Detalle abajo (§Frontier).

- baseline_commit: `6960238ede92478e6d8b96b8a88a8b82613a5843` (registrado en `progress/impl_18-audit-log.md` L1).
- Diff calculado desde el baseline: **todo sin commitear** (baseline == HEAD; `git diff <baseline>..HEAD` vacío, cambios en working tree). Trabajado sobre `main`, no `main...HEAD`.
- Skill `sentry-skills:security-review` corrida sobre el diff (metodología trace-data-flow + verify-exploitability). Cobertura de la skill = TS/JS de las EFs; el grueso del cambio (migración Postgres: triggers, grants, RLS-equivalente por REVOKE, PowerSync WAL) es **cobertura indirecta** → revisión manual RAFAQ-específica (abajo).

---

## §Frontier — VERIFICADO POR MÍ (decisión clave a adjudicar)

**Contexto.** La spec 18 asumió que la publication `powersync` era `FOR TABLE <lista>` (`puballtables=false`) y ordenaba PARAR si fuese `FOR ALL TABLES`. La infra real es **`FOR ALL TABLES`** (`puballtables=true`). El implementer reconcilió a "aceptar el frontier de sync streams" en vez de convertir la publication.

**Verificación propia sobre `sync-streams/rafaq.yaml` (leído completo):**

1. **Cada stream es un `SELECT ... FROM <tabla nombrada>`.** Los `*` que aparecen (`SELECT * FROM species`, etc.) son wildcard de **columnas**, nunca de tabla. No existe ningún `FROM *`, `FROM public.*`, ni patrón/regex de tabla. No hay stream "catch-all".
2. **Ninguna stream referencia `audit` ni `record_version`.** Grep manual sobre el YAML activo (stripeando comentarios): 0 matches. (El único uso de la palabra "audit" es el comentario en prosa `# audit de exports` de `sigsa_export_log`, que no es config.)
3. `audit.record_version` (schema nuevo `audit`) **no está** en ninguna de las 31 streams (17 paso1 + 8 paso2 + 3 custom + 3 SIGSA).

**Análisis de exploitabilidad (cómo llega —o no— un dato a un device):** con `FOR ALL TABLES`, el replicador de PowerSync **recibe** el WAL de `audit.record_version` (INSERT-only). Pero PowerSync evalúa cada fila del WAL contra las sync rules/streams; una fila que **no matchea ningún bucket** se **descarta** — no se persiste en el storage de PowerSync ni se envía a ningún device. Es EXACTAMENTE el mecanismo que hoy mantiene fuera de los devices a `animals`, `users`, `import_log` (están en `FOR ALL TABLES` pero fuera de las streams). El objetivo de seguridad de **D5 (audit forense no fuga a devices) SE CUMPLE** — por el frontier de streams, no por la publication.

**Residual (NO es leak):** costo de procesamiento de WAL/replication slot (cada fila de audit fluye al servicio y se descarta). Para el incremento 1 (solo `user_roles`, INSERT-only, bajo volumen) es despreciable. Para `animals` (mayor volumen) el costo está **separadamente gateado** por el gate DURO de volumen (T12/R5.4) → animals no se prende hasta medir. Correcto.

**Veredicto explícito:** **ACEPTAR el streams-frontier.** Es seguro para el objetivo de D5. **NO** exijo convertir `powersync` a `FOR TABLE`: (a) no aporta seguridad (el dato ya no llega a devices), solo recortaría costo de WAL; (b) es un cambio de infra más pesado y riesgoso (enumerar ~31 tablas; si falta una se rompe el sync silenciosamente) que excede spec 18. La reconciliación de R4.1/R4.2/R4.3/D5 es correcta. **No es blocker.**

**Watch-item (LOW — no bloquea, dejar registrado):** con la publication en `FOR ALL TABLES`, el frontier de `audit.*` pasa a ser un **invariante por convención** (ninguna stream lo referencia + no hay catch-all), reforzado por el file-check **TA.11**, no por el límite físico de la publication. Una stream futura con un `FROM audit....` o un catch-all fugaría a TODOS los devices los snapshots cross-tenant de `record_version` (incluye `member_name` = PII M3, y cambios de rol de todos los establishments). Hoy NO es explotable (no existe tal stream). Mitigación vigente y suficiente para MVP: **mantener el assert TA.11** (falla el build si `audit`/`record_version` aparecen en `rafaq.yaml`). Recomendación de bajo costo a futuro: agregar el mismo assert en `scripts/powersync-deploy.sh` (validación pre-deploy del YAML) para que el guard también corra fuera de la suite backend gateada.

---

## Focos auditados (todos PASS)

### 1. `resolve_actor()` total — hot-path airtight ✅
`audit.resolve_actor()` (0124 L96-121): todo el cuerpo envuelto en `begin … exception when others` → cae a `auth.uid()`; el handler interno vuelve a envolver `auth.uid()` en `exception when others then return null`. **Ninguna ruta lanza** (parse de `request.jwt.claims`, parse de `request.headers`, regex del uuid, cast `::uuid`, o incluso una falla de `auth.uid()`) → siempre devuelve un uuid o NULL, nunca propaga. Bajo `search_path=''` los nombres están calificados (`auth.uid()`) y el resto es `pg_catalog` (`coalesce/nullif/current_setting/::jsonb/~`). En el trigger, modo `best_effort` (que es el que usará `animals`, línea gateada con `best_effort => true`) envuelve `to_record_id` + `primary_key_columns` + `resolve_actor` + el `insert` **todos dentro** del `begin…exception when others then null; end` (L134-147) → el write del operario en la manga **no se traba jamás**. Invariante offline-first sostenido.

### 2. Anti-spoof del header ✅
`resolve_actor` confía en `X-Rafaq-Actor` **solo si** `nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role' = 'service_role'` (L104-105). Usa el **claim del JWT** (GUC de sesión), NO `current_user` — correcto bajo SECURITY DEFINER (con `current_user` el definer rompería el chequeo). Un `authenticated` tiene `role=authenticated` en su claim → el header se ignora → `auth.uid()` real. No puede forzar el GUC `request.jwt.claims` (lo fija PostgREST tras validar el JWT; no hay RPC que lo re-setee a service_role). Verificado end-to-end por **TA.13** (owner con header forjado `= userB.id` → `auth_uid = ownerA.id` real, header ignorado).

### 3. Fail-closed de lectura ✅
`REVOKE ALL ON SCHEMA audit` + `REVOKE ALL ON ALL TABLES` + `REVOKE ALL ON ALL FUNCTIONS` de `public, anon, authenticated` (L197-199). El schema `audit` **no** se agrega a los expuestos por PostgREST; el REVOKE USAGE es el backstop duradero aunque alguien lo exponga por error (queda 42501). Smoke-check **doble in-migration** (DO block L221-244) que aborta el deploy si (a) alguna función quedó EXECUTE-able por rol cliente o (b) el muro de lectura (USAGE de schema / SELECT de tabla) quedó abierto para anon/authenticated. `service_role` recibe solo `SELECT` (L204-205) — y ni siquiera lo puede usar por PostgREST (schema no expuesto); el lector forense real es la Management API (`postgres`). Runtime: TA.7/TA.8 (anon/auth reciben error), TA.9 (privilegios en false).

### 4. Append-only real ✅
Ningún rol tiene INSERT/UPDATE/DELETE directo sobre `audit.record_version`: `service_role` = SELECT-only; anon/authenticated = sin USAGE. Los únicos writers son el **trigger SECURITY DEFINER** (INSERT, corre como owner=postgres) y `purge_old_record_versions()` (DELETE, SECURITY DEFINER). Verificado por TA.10 (anon/auth sin UPDATE/DELETE). Tabla sin FK/CHECK (R1.10) → un usuario borrado no rompe el write trackeado.

### 5. EFs — actor del JWT validado, sin nueva superficie IDOR ✅
Diff de las 4 EFs = **una línea aditiva** cada una: `createAdminClient()` → `createAdminClient(user.id)`, donde `user = await requireUser(userClient)` y `requireUser` valida el JWT vía `userClient.auth.getUser()` (`_shared/auth.ts` L9-25). El actor es SIEMPRE el `user.id` del llamante validado, **nunca del body**: en `change_member_role`/`remove_member` el `body.user_id` es el TARGET (la authz sigue por `requireOwnerOf`), no el actor; `delete_account` no lee user_id del body (identidad solo del JWT). El header `X-Rafaq-Actor` solo transporta el uuid propio del caller; no cambia authz, no expone secreto, no abre IDOR. `createAdminClient(actorId?)` es aditivo (sin `actorId` = comportamiento idéntico previo). En `accept_invitation` el admin client se movió a DESPUÉS de `requireUser` (necesita `user.id`) — sin impacto de authz.

### 6. Retención `pg_cron` — no borra de más ✅
`purge_old_record_versions()` (L186-193): `delete from audit.record_version where ts < now() - interval '90 days'` — solo filas >90d, jamás recientes. SECURITY DEFINER + `search_path=''` + nombre calificado; EXECUTE revocado a public/anon/authenticated (L213); verificado por TA.16. Cron `'0 4 1 * *'` idempotente (unschedule defensivo, L259-261). TA.15 verifica (fila 100d purgada, fila reciente permanece). Nota de contexto (no finding): los 90d aplican al log **forense de seguridad**, NO a las declaraciones SENASA (`sigsa_declarations`/`export_log`, append-only, no purgadas) → sin conflicto de compliance ADR-017.

---

## Checklist RAFAQ-específico (Catálogo)

- **A1 (service-role bypassa RLS):** las EFs ya usaban `createAdminClient`; el diff no agrega ninguna query admin sin scoping. Las queries admin siguen scopeadas (`requireOwnerOf`, `.eq('user_id')`, `.eq('establishment_id')`). Sin regresión. ✅
- **A2 (mass assignment):** los inserts a `user_roles` usan objetos con campos explícitos (`{ user_id, establishment_id, role, active }`), no spread de `body`. Sin cambio. ✅
- **A3/A4 (IDOR/BFLA):** authz de las EFs intacta (mismo `requireOwnerOf`/`requireUser`). El actor no otorga permisos. ✅
- **B1 (info disclosure):** `serverError()` devuelve copy genérico y loguea el detalle; `requireOwnerOf` usa `console.error` + genérico. Ningún `err.message` crudo al cliente en el diff. ✅
- **D1/D3 (secretos):** sin service_role key en cliente; `Deno.env.get` en la factory; sin secretos hardcodeados; el header propagado es un uuid, no sensible. ✅
- **F1 (injection SQL en la migración):** `execute format('… %s … %L …', target, modo)` en `enable_tracking`/`disable_tracking` — `target` es `regclass` (OID tipado, no texto arbitrario) y el modo es literal constante; además EXECUTE revocado a clientes y solo se invoca en migración/tests como `postgres`. No attacker-controlled. ✅
- **C1 (PowerSync sync rules):** cubierto en §Frontier — audit fuera de streams, sin catch-all. ✅

## Tabla de inputs (campos que el usuario tipea, tocados por el diff)
| campo | límite | validación (server/cliente/ausente) | OK? |
|---|---|---|---|
| `X-Rafaq-Actor` (header, propagado por la EF) | uuid v4 regex en `resolve_actor` | server (regex uuid + solo bajo claim service_role) — no lo tipea el usuario, lo setea la EF con `user.id` validado | ✅ |
| (EFs) `body.token`/`user_id`/`establishment_id`/`new_role` | pre-existentes | server (`typeof === 'string'`, `ALLOWED_ROLES`, `requireOwnerOf`) — **no modificados por este diff** | ✅ (fuera de scope del cambio) |

_El diff no agrega ningún formulario, buscador ni texto libre nuevo. La feature es 100% backend/forense._

## Tabla de rate limits (acciones abusables tocadas por el diff)
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| INSERT en `audit.record_version` (vía trigger) | n.a. | n.a. | n.a. | no es endpoint; se dispara por el DML ya autorizado; volumen de `animals` gateado por T12; retención 90d |
| 4 EFs (accept/change/remove/delete) | sin cambio | pre-existente | sí (authz previa) | el diff no altera su superficie de rate; misma authz. Rate limit de estas EFs es un tema pre-existente fuera de spec 18 |

---

## False positives descartados (skill Sentry)
- **`execute format(%s)` en enable/disable_tracking** → NO es SQL injection: `target regclass` es una referencia OID tipada, no texto de usuario; EXECUTE revocado a clientes; invocado solo por `postgres` en migración/tests.
- **`X-Rafaq-Actor` header (input attacker-touchable)** → NO explotable: confiado solo bajo claim `service_role`; un authenticated lo ve ignorado (TA.13).
- Ningún hallazgo HIGH de la skill sobre el TS de las EFs (cambio aditivo de una línea, actor = JWT validado).

## Archivos analizados
- `supabase/migrations/0124_audit_log.sql`
- `supabase/functions/_shared/supabase.ts`
- `supabase/functions/accept_invitation/index.ts`
- `supabase/functions/change_member_role/index.ts`
- `supabase/functions/remove_member/index.ts`
- `supabase/functions/delete_account/index.ts`
- `supabase/functions/_shared/auth.ts`, `_shared/errors.ts` (contexto: `requireUser`/`serverError`)
- `supabase/tests/audit/run.cjs` (verificación de que los asserts ejercen los caminos de producción)
- `scripts/run-tests.mjs` (hook gateado/comentado hasta el deploy — correcto)
- `sync-streams/rafaq.yaml` (verificación del frontier)

## Cobertura indirecta / no cubierto por la skill
- La skill de Sentry **no cubre** semántica Postgres (SECURITY DEFINER, triggers, grants/REVOKE, `search_path`), PowerSync/WAL, ni RLS — el núcleo de esta feature. Todo eso se auditó **manualmente** (arriba). El TS de las EFs (lo que la skill sí cubre) es un cambio aditivo trivial sin hallazgos.
- **Pendiente POST-DEPLOY (no bloquea el gate de código, es verificación de deploy):** correr `supabase/tests/audit/run.cjs` (TA.1–TA.16) contra dev tras aplicar 0124 + redeploy de las 4 EFs; confirmar el smoke-check in-migration verde; T12 (gate de volumen de `animals`) antes de descomentar su tracking. El muro fail-closed y el anti-spoof están verificados estáticamente + encodeados en la suite; su confirmación runtime depende del deploy gateado.
