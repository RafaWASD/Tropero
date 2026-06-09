# Gate 2 — Security review (modo `code`) — 15-powersync · Run 1

> `security_analyzer` modo `code` (ADR-019). Skill: `sentry-skills:security-review` (trace data flow + verify exploitability) corrida sobre el diff del Run 1.
> Fecha: 2026-06-08. baseline_commit: `1618a9566037eeca65cf2fa8841c86379ba35809` (todos los cambios sin commitear sobre ese SHA — `git status --porcelain`).
> Alcance: cimientos del cliente PowerSync + YAML de streams. NO swap de services, NO backend, NO deploy (Run 1 cerrado).

## Veredicto: **PASS**

**0 findings HIGH.** El manejo del token/credenciales es limpio (no se loguea, devuelve `null` sin sesión), el `uploadData` base no abre bypass (op_intents → throw; CRUD plano re-validado server-side), el YAML materializado NO tiene drift de scoping respecto del design §2 gateado (HIGH-1 NO se reintrodujo), y `.env.example` tiene solo placeholders. 2 notas LOW (anexo), no bloqueantes.

---

## Punto 1 (foco principal) — Token / credenciales: NO se loguea, falla cerrado — **OK**

Tracé el data flow completo del `access_token`:

- **`connector.fetchCredentials()` (connector.ts:29-33)**: `await supabase.auth.getSession()` → `data.session` → delega a `buildCredentials(getEnv().powersyncUrl, data.session)`. NO hay `console.*`, NO hay `throw` en este método, NO se asigna la sesión/token a ningún estado observable fuera del retorno que el SDK consume internamente para conectar. El retorno es el contrato del SDK (`PowerSyncCredentials | null`).
- **`buildCredentials()` (upload-classify.ts:23-30)**: PURA, testeada. `const token = session?.access_token; if (!token) return null;` — trata `''`/`null`/`undefined` como "sin sesión" (testeado en `upload-classify.test.ts:27-30`). Sin token → `null` → el SDK no conecta (no fuerza, no expone). NO loguea ni filtra el token. Espeja la convención de `supabase.ts:8-9` ("NUNCA se loguea el contenido de la sesión (tokens)").
- **Único `console.*` de toda la superficie** = `surfaceUploadRejection` (connector.ts:96): loguea SOLO `{ table: op?.table, op: op?.op, code }`. Verificado:
  - `op?.table` = nombre de tabla del AppSchema (server-controlled, no PII).
  - `op?.op` = enum `UpdateType` (PUT/PATCH/DELETE).
  - `code` = solo si `typeof code === 'string'` (connector.ts:99); es un errcode de Postgres/PostgREST (ej. `42501`, `23505`), no PII.
  - **NO loguea `opData`** (el comentario connector.ts:83-84 lo declara y el código lo cumple — confirmado por grep: la única referencia a `opData` es el upsert/update, nunca un log).
  - **NO loguea el token/sesión** (confirmado por grep: cero `console.*` toca `token`/`session`/`error.message`).
- **Re-throw transitorio (connector.ts:80)**: propaga el error al SDK para reintento; NO hay `console.error(error)` que imprima el error crudo de PostgREST. Y el token NUNCA vive en el error de upload (path separado del de credenciales) → no hay fuga por esa vía.
- **`endpoint` (POWERSYNC_URL)**: `EXPO_PUBLIC_POWERSYNC_URL` es endpoint PÚBLICO por diseño (no secreto; .env.example:11-13). No es un finding que aparezca en credenciales/estado.

**Conclusión P1: el token no toca ningún log ni estado observable; `fetchCredentials` falla cerrado (null sin sesión). OK.**

## Punto 2 — `uploadData` base: sin bypass — **OK**

- **Stub `op_intents` (connector.ts:50-53)**: `if (op.table === OP_INTENTS_TABLE) throw new Error(...)` se ejecuta ANTES del `switch (op.op)` de CRUD plano → una intención NUNCA se aplica como upsert/update plano (que bypassearía la RPC/idempotencia del futuro Run T6). El throw se clasifica como transitorio (sin `code`/`status` → `isTransientUploadError` conservador → true, upload-classify.ts:65-66) → la tx queda en cola, el intent NO se descarta. Safe.
- **Mass assignment `{...op.opData, id: op.id}` (connector.ts:59) / `op.opData` en update (connector.ts:64)**: el payload viene de la CrudEntry de la cola local (refleja escrituras del cliente Expo → attacker-controlled en device comprometido). PERO el camino es PostgREST → **RLS + triggers + CHECKs siguen rigiendo** (mismo path que cualquier escritura del cliente hoy). Los triggers fuerzan `created_by`/`author_id` desde `auth.uid()` ignorando el payload, RLS valida tenant, CHECKs validan largos/jsonb. Esto fue confirmado en el Gate 1 PASS (security_spec §confirmaciones positivas #4 y dominio A2). NO introduce superficie nueva (la app ya escribe a PostgREST). No es bypass ni escalada. La op rechazada por RLS (42501) se descarta sin loop (R8.1). OK.
- **DELETE plano (connector.ts:68-72)**: no-op deliberado (el soft-delete va por outbox→RPC en Run T6). No abre nada.

## Punto 3 (foco principal) — YAML `rafaq.yaml` SIN drift de scoping — **OK**

El YAML materializado debe espejar el design §2 **gateado** (Gate 1 PASS final, `security_spec_15-powersync.md`). Verifiqué que NINGÚN WHERE se relajó (la reintroducción de HIGH-1 sería un leak cross-tenant/temporal por el WAL — la stream es la ÚNICA frontera de read-authz, ADR-025).

**Barrido programático del YAML (evidencia):**

| Control | Esperado (design gateado) | Encontrado en `rafaq.yaml` | OK? |
|---|---|---|---|
| Subselects con JOIN canónico (`JOIN establishments e ON e.id = ur.establishment_id`) | 19 (alias `ur`) | 19 | ✅ |
| JOIN canónico alias `me` (est_members, 2 queries) | 2 | 2 | ✅ |
| `e.deleted_at IS NULL` dentro de subselects | ≥21 | 23 (incl. el del predicado-doc L19) | ✅ |
| Subselects "bare" (`FROM user_roles WHERE active=true` SIN JOIN, scoping-relevant) | 0 | 0 | ✅ |
| `role = 'owner'` gating | est_members q2 (MED-1) + est_invitations (MED-2) | L102 + L122 | ✅ |

- **Predicado canónico presente en las 20 streams per-establishment** (cada WHERE con `JOIN establishments e ... AND e.deleted_at IS NULL` + `ur.active = true` + `ur.user_id = auth.user_id()`). Espeja `has_role_in` (0005:16-24). HIGH-1 (campo soft-deleteado sigue sincronizando) NO se reintrodujo.
- **Proyección `SELECT ... AS id, *`** en las 3 tablas de PK especial (`self_user_private` L61, `est_rodeo_data_config` L140, `ev_birth_calves` L317): cambio de SINTAXIS del SDK (PowerSync exige columna `id` por fila), **authz-neutral** — no toca el WHERE de scoping (verificado: el WHERE de cada una es idéntico al predicado canónico/derivado aprobado).
- **`est_members` query (1) — nombres (L84-92)**: ahora incluye `WHERE ur.active = true` en el inner select (L87). Esto es **MÁS ESTRICTO** que el design auditado (cierra el LOW-1 residual que el Gate 1 dejó como recomendación opcional — espeja `users_select_coworkers` `them.active = true`). Más estricto = authz-safe, no es drift permisivo. El outer mantiene su JOIN a establishments + `e.deleted_at IS NULL` (L90-92).
- **`est_members` query (2) — roles (L96-102)**: gateada a owner (`me.role = 'owner'`, L102) + `active = true` (L98) — espeja `is_owner_of` (MED-1 cerrado). Sin cambios respecto del gateado.
- **`est_invitations` (L114-122)**: predicado canónico + `role='owner'` + `status='pending'` + `deleted_at IS NULL` (MED-2 cerrado). Sin cambios.
- **Filtros `deleted_at IS NULL` de tabla base mantenidos** y excepciones legítimas intactas (`rodeo_data_config`/`animal_category_history` sin `deleted_at` propio; `user_roles` usa `active`; `birth_calves` deriva de `reproductive_events.deleted_at` + `animal_profiles.deleted_at`).
- **Catálogos globales** (5 streams, L35-54): `SELECT *` sin filtro — correcto (read-only global, sin PII).

**Conclusión P3: el YAML es fiel al design §2 gateado. Cero WHERE relajado. HIGH-1 no reintroducido. OK.**

## Punto 4 — Secrets / env — **OK**

- **`.env.example`**: solo placeholders (`<project-ref>`, `<anon-key>`, `<instance-id>`, `<service-role-key>`, `<personal-access-token>`, `<expo-access-token>`, `<resend-key>`, `<figma-key>`, `<stitch-key>`). Sin valores reales. La sección server-only (L15-28) está marcada "NUNCA exponer al cliente" + "Bypassea RLS. Rotar antes de producción". Correcto.
- **`env-resolve.ts`**: PURO; arma/valida SOLO las 3 vars públicas `EXPO_PUBLIC_*`. NO toca `SUPABASE_SERVICE_ROLE_KEY` ni ningún secreto server-only. El error de fail-closed (L28-31) nombra las vars pero NO expone valores. OK.
- **`env.ts`**: lee de `process.env` / `Constants.expoConfig.extra` (deployment config, server/build-controlled). Solo `EXPO_PUBLIC_*`. OK.
- **No hay service_role en el bundle del cliente** (D1): la superficie del Run 1 solo usa `anon`/`publishable` vía `supabase.ts`; service_role no aparece en ningún archivo del cliente.

## Punto 5 — localOnly overlay / insertOnly outbox — **OK**

- **`op_intents` (insertOnly, schema.ts:361-368)**: genera CrudEntry pero el connector la intercepta (throw, Run 1) → no sube datos como CRUD plano. NO se hace `supabase.from('op_intents')` (confirmado: la tabla vive solo en AppSchema; comentario schema.ts:360). No expone datos al server inadvertidamente.
- **`pending_*` (localOnly, schema.ts:376-435)**: `localOnly: true` → NO genera CrudEntry → NUNCA se sube al server (overlay optimista local). Correcto: el efecto optimista no se duplica como upload. No hay superficie de stream/RLS para estas tablas. OK.

---

## Findings RAFAQ-SPECIFIC

Ninguno bloqueante. Ver anexo LOW.

## False positives descartados (skill + validación manual)

- **Mass assignment en `{...op.opData, id: op.id}` (connector.ts:59)**: patrón que la guía `api-security.md` marca como mass-assignment. **Descartado como finding**: re-validado server-side por RLS + triggers (force `created_by`/`author_id` desde `auth.uid()`) + CHECKs; mismo PostgREST que cualquier escritura del cliente; sin superficie nueva. Confirmado en Gate 1 PASS (dominio A2). No es bypass.
- **`require()` dinámico en database.ts (L26/L32-33)**: NO es injection — el argumento es un string literal constante (`'@powersync/web'` / `'@powersync/react-native'`), no input de usuario. Guardado por `Platform.OS`. Patrón del repo (`services/ble/feedback.ts`).
- **`supabase.from(op.table)` (connector.ts:56)**: `op.table` NO es SQL libre — es un nombre de tabla del AppSchema (set cerrado), no concatenación de input de usuario. PostgREST lo trata como identificador de recurso, no como query. No es injection.
- **`console.warn` en surfaceUploadRejection (connector.ts:96)**: la skill podría marcar logging — descartado: loguea solo `{table, op, code}` (todos server-controlled / errcode), nunca opData/token/PII.

---

## Tabla de inputs (campos de usuario nuevos/modificados en el Run 1)

> El Run 1 NO introduce formularios/buscadores/campos nuevos. Es plumbing del cliente de sync + YAML de streams. Los inputs que cruzan al server por el upload reusan tablas YA gateadas (specs 02/03/13) con sus CHECKs server-side (verificado en Gate 1).

| campo / input | límite | validación | OK? |
|---|---|---|---|
| `op.opData` (payload de la cola CRUD → upsert/update) | CHECKs de DB de cada tabla (0070 largos, jsonb < 16 KiB) | server (RLS + triggers + CHECK) — aplica vía PostgREST | ✅ |
| `EXPO_PUBLIC_*` (env vars) | n.a. (deployment config, no input de usuario) | server/build-controlled (`resolveEnv` fail-closed) | ✅ |
| `op.id` / `op.table` (CrudEntry) | set cerrado del AppSchema / PK | identificador, no SQL libre | ✅ |

**Recordatorio heredado del Gate 1 (para Run T3-T6, buscador local SQLite):** cuando se implemente el `LIKE '%term%'` local sobre SQLite (design §5.1), verificar que el término del usuario se pase como **bind param** (`?`) en `db.getAll`/`db.watch`, NO interpolado por template-string. NO aplica al Run 1 (el buscador local no se implementó en este run).

## Tabla de rate limits (acciones abusables tocadas por el Run 1)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `fetchCredentials` (getSession + token) | hereda autoRefresh de Supabase Auth | per-user (sesión) | sí (sin sesión → `null`, no conecta) | no toca `config.toml`; no afloja `[auth.rate_limit]`. ✅ |
| sync set (download) | acotado por el scoping de la stream (no por rate) | per-`establishment_id` activo | sí (sin rol activo → 0 filas) | el tamaño lo controla el WHERE; sin drift (P3). ✅ |
| upload queue drain (PostgREST) | n.a. nuevo | — | — | mismo PostgREST que un cliente normal; sin superficie nueva. No regresión. |

El Run 1 **no manda email/SMS, no pega a APIs externas, no agrega Edge Functions nuevas, no afloja Auth rate limits** → sin vectores de denial-of-wallet nuevos.

---

## Anexo LOW (no bloqueante)

### LOW-1 — `disconnect()` no wipea la SQLite local en logout (data-at-rest)

`provider.tsx:39` hace `db.disconnect()` en logout pero NO borra el DB local (comentario L37-38 lo declara explícito: "el wipe en logout es decisión aparte, fuera de este run"). La SQLite local retiene el dataset del campo tras el logout. **No es finding del Run 1** (lo hereda de ADR-002/PowerSync; el Gate 1 ya lo marcó como nota C3 para un ADR de hardening del device — SQLite encriptada at-rest + wipe en logout). Recomendación: ADR de hardening del device post-MVP. NO bloquea.

### LOW-2 — `getEnv()` se evalúa en import-time en `supabase.ts` (no introducido por el Run 1)

`supabase.ts:70` llama `getEnv()` en import-time (top-level). Si falta `EXPO_PUBLIC_POWERSYNC_URL`, ahora `resolveEnv` falla (porque se agregó como var requerida) y rompe el import de `supabase` — comportamiento esperado/documentado (impl §Pendiente para Raf). NO es un problema de seguridad (fail-closed con error accionable), solo una nota de DX: el error es accionable y en es-AR. No bloquea.

---

## Archivos analizados (superficie del Run 1)

- `app/src/services/powersync/connector.ts` — fetchCredentials + uploadData base + surfaceUploadRejection
- `app/src/services/powersync/upload-classify.ts` — buildCredentials + clasificación de errores (PURO)
- `app/src/services/powersync/database.ts` — factory por plataforma + singleton
- `app/src/services/powersync/schema.ts` — AppSchema (26 sync + op_intents insertOnly + 5 pending_* localOnly)
- `app/src/services/powersync/provider.tsx` — PowerSyncProvider (connect/disconnect por sesión)
- `app/src/services/powersync/status.ts` + `status-derive.ts` — estado de sync UI (PURO)
- `app/src/services/powersync/platform-select.ts` — selección de paquete (PURO)
- `app/src/utils/env.ts` + `env-resolve.ts` — resolución/validación de env
- `app/app/_layout.tsx` — montaje del PowerSyncProvider (dentro de AuthProvider)
- `sync-streams/rafaq.yaml` — 26 sync streams (no deployado)
- `.env.example` — plantilla de env

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia)

La skill `sentry-skills:security-review` (orientada a patrones JS/TS/web) **no cubre directamente** la semántica de las **sync rules de PowerSync** (que son authz paralela a la RLS, ADR-025). Esa frontera la audité **manualmente** contra el predicado canónico del Gate 1 PASS (P3 arriba, barrido programático + lectura línea-por-línea). El **upload re-validado server-side** (RLS/triggers/CHECKs) se confirma por el Gate 1 PASS, no por la skill. No hay Edge Functions / Deno nuevos en este run.

---

## Resumen para el leader

- **Veredicto: PASS** (0 HIGH).
- **P1 (token-logging)**: limpio. El `access_token` no toca ningún `console.*` ni estado observable; `fetchCredentials`/`buildCredentials` devuelven `null` sin sesión (fail-closed); el único log (`surfaceUploadRejection`) emite solo `{table, op, code}`, nunca opData/token/PII. Espeja la convención de `supabase.ts`.
- **P3 (drift del YAML)**: SIN drift. Barrido programático + lectura confirman las 20 streams per-est con el predicado canónico (`JOIN establishments e ... AND e.deleted_at IS NULL`), 0 subselects bare, owner-gating en est_members q2 + est_invitations. Los alias `id` y el `ur.active=true` agregado en est_members q1 son authz-neutral / más estrictos. **HIGH-1 NO se reintrodujo.**
- **P2/P4/P5**: op_intents → throw (sin bypass); CRUD plano re-validado server-side (no mass assignment explotable); `.env.example` solo placeholders; overlay localOnly / outbox insertOnly no exponen datos al server.
- **LOW-1/LOW-2**: no bloqueantes (wipe de SQLite en logout = ADR de hardening post-MVP, ya marcado en Gate 1; getEnv import-time = fail-closed accionable).
