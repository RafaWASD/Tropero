# Security review (Gate 2 · modo `code`) — 16-ambientes-y-release · Run C

**Veredicto: PASS**

Endpoint público de health (`verify_jwt=false`) input-free que corre con service_role y devuelve
`{ok, schema_version, env}`. Sin findings HIGH ni MEDIUM. La postura de rate-limit / DoW queda documentada
como aceptada (endpoint read-only trivial, sin costo-por-request; monitoreo en feature 17). Detalle abajo.

- **baseline_commit**: `6b07bcaee159d9763d38ecbb08946d61cb2c4ecd` (= HEAD; trabajamos sobre `main`, todo el
  cambio de Run C está sin commitear → diff calculado sobre working tree, no `main...HEAD`).
- **Skill**: `sentry-skills:security-review` corrida sobre el diff. Sin findings HIGH de la skill.
- **Alcance**: solo Run C. La función DB `public.health_status()` (`0125_health_status.sql`) NO entra en
  este diff (committeada en Run B, ya revisada en su Gate 2: REVOKE FROM PUBLIC + anon/authenticated +
  GRANT service_role). Se la trata acá como dependencia trusted verificada.

## Archivos analizados (working tree, desde baseline)

| Archivo | Cambio | Relevancia security |
|---|---|---|
| `supabase/functions/health/index.ts` | nuevo | EF pública input-free (foco principal) |
| `supabase/config.toml` | mod | `[functions.health] verify_jwt = false` |
| `supabase/tests/health/run.cjs` | nuevo | test suite (no es superficie de ataque) |
| `scripts/run-tests.mjs` | mod | hook de la suite `health` **comentado** (l.151) |
| `supabase/functions/_shared/{cors,errors,supabase}.ts` | sin cambios | dependencias reusadas, leídas para el trace |
| `specs/.../{requirements,design,tasks}.md`, `progress/*` | mod | docs, fuera de superficie |

## Trace de data flow (endpoint público → service_role)

1. Request HTTP público (cualquier método, sin JWT) → `Deno.serve` handler.
2. `handleOptions(req)`: OPTIONS → 204. Otros métodos siguen. Solo lee `req.method`.
3. **Input-free**: NO se llama `req.json()` ni se lee query string / headers de usuario. La respuesta NO
   depende de nada attacker-controlled (`index.ts:30-31`, comentado como invariante).
4. `createAdminClient()`: service_role desde `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` — env server-only
   del runtime deployado, nunca en el bundle Expo (`_shared/supabase.ts:16-28`).
5. `admin.rpc('health_status')`: nombre de RPC **hardcodeado**. No hay `rpc(userInput)` — cero camino a
   invocación arbitraria de funciones aunque el client sea service_role (RLS-bypass).
6. `health_status()` (SECURITY DEFINER, `search_path=''`): read acotado de `ops.applied_migrations`,
   devuelve prefijo de 4 dígitos o `'unknown'`. REVOKE FROM PUBLIC/anon/authenticated + GRANT service_role
   (revisado en Run B) → el único path que ejecuta esta RPC es esta EF.
7. Respuesta: `{ok:true, schema_version, env:RAFAQ_ENV??'unknown'}`.
8. Fallo (RPC `error` o excepción) → `serverError(code, detail)`: `console.error` server-side + al cliente
   `jsonError(500, code, 'Error interno, probá de nuevo.')` — sin `.message` del driver Postgres/Deno
   (`_shared/errors.ts:30-33`).

## Foco del gate (checklist verificado)

### 1. Superficie mínima / input-free — OK
- El handler NO lee body/params/headers de usuario. `req` solo se pasa a `handleOptions` (lee `.method`) y
  después se ignora. No hay camino de inyección (SQL/command/template/SSRF): no arma queries con input, no
  hace `fetch()` a URLs de usuario, no invoca RPC dinámica. Corre service_role pero cero input attacker-
  controlled entra al code-path privilegiado.

### 2. No leak — OK
- Respuesta = literal `{ok, schema_version, env}`. `schema_version` = prefijo numérico de 4 dígitos vía
  `health_status()` (NO el filename completo → no filtra nombres de features/migraciones/roadmap). `env` =
  `RAFAQ_ENV` (`development|production|unknown`, no sensible; distingue DEV de PROD para el monitor). Sin
  conteos de filas, nombres de tabla, ni PII.
- En fallo NO expone driver/stack/sqlerrm: `serverError` devuelve copy genérico + `code` estable
  (`health_db`/`health_unexpected`), y loguea el detalle solo server-side. Helper hardeneado y testeado por
  spec 13.
- El test C4(c) asserta keys ⊆ `{ok,schema_version,env}` + blob-check anti-leak. Doble candado.

### 3. service_role no expuesto — OK
- El key nunca se devuelve ni se loguea al cliente. `createAdminClient` lo lee de env server-only. Al ser
  input-free + RPC hardcodeada, no hay forma de que el caller haga que el admin client ejecute algo distinto
  de `health_status()` (a su vez REVOKE'd de PUBLIC y acotada a un read trivial). No hay mass-assignment,
  IDOR ni query arbitraria alcanzables.

### 4. `verify_jwt=false` correcto y ACOTADO — OK
- `config.toml` tiene UN solo bloque `[functions.*]`: `[functions.health]` con `verify_jwt=false` (l.388-389,
  confirmado por grep). Todas las demás EFs (invite_user, accept_invitation, change_member_role,
  remove_member, delete_account, resend_invitation…) NO tienen bloque → default `verify_jwt=true`. El
  scoping per-function de config.toml garantiza que desactivar JWT en `health` NO toca las EFs de
  auth/miembros de spec 01/18.
- Nota operativa (no finding): `config.toml` aplica al `supabase start` local; el deploy remoto DEBE ir con
  `supabase functions deploy health --no-verify-jwt`. Documentado en el comentario de config.toml y en
  `impl_16-runC.md` §deploy. El gate remoto queda cubierto post-deploy por la suite `health` (C4(b)).

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| _(ninguno)_ | EF input-free: no lee body/query/headers de usuario | n/a — sin superficie de input | ✅ |

La única entrada externa es el `RAFAQ_ENV` de env (server-controlled, no attacker-controlled) → no aplica
validación de input de usuario. Confirmado que no hay formularios, buscadores, texto libre ni prompts.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `GET/POST /functions/v1/health` (público, sin JWT) | no (by design) | n/a | n/a | Health/monitoring endpoint DEBE ser pingeable sin auth. Operación read-only trivial (un aggregate acotado sobre `ops.applied_migrations`, ~125 filas), sin costo-por-request (no email/SMS/API externa), sin fan-out/amplificación. DoW despreciable. Postura documentada: read-only trivial + monitor en feature 17. DDoS L7 genérico es problema de plataforma (edge), no de esta EF. **Aceptado, no blocker.** |
| `[auth.rate_limit]` en config.toml | sin cambios | — | — | El diff NO afloja ni deshabilita ningún límite nativo de Auth (email_sent=2, sign_in_sign_ups=30, token_verifications=30, etc. intactos). |

## Findings RAFAQ-SPECIFIC

Ninguno HIGH/MEDIUM. Observaciones informativas (no bloquean, no requieren acción en Run C):

- **INFO** — CORS `Access-Control-Allow-Origin: '*'` (shared `_shared/cors.ts`, sin tocar). Correcto para
  un endpoint público que no expone nada sensible y que se pinguea desde un monitor server-side (UptimeRobot
  no es browser → CORS irrelevante para el caso de uso). Sin acción.
- **INFO** — `Access-Control-Allow-Methods: 'POST, OPTIONS'` en el header compartido, mientras la EF acepta
  GET. No es un problema de seguridad (el header solo gobierna preflight de browser; el monitor no hace
  preflight). Sin acción.

## False positives descartados / no aplicables

- **Service-role bypassa RLS (Catálogo A1)**: presente (`createAdminClient`), pero mitigado por input-free +
  RPC hardcodeada + `health_status()` REVOKE'd/acotada. No hay query admin sin scoping de tenant porque no
  toca datos de tenant (solo metadata `ops.applied_migrations`). No es finding.
- **Information disclosure `err.message` (Catálogo B1)**: NO aplica — `serverError` ya devuelve genérico; el
  `error`/`err` crudo va solo a `console.error`. Correcto.
- **Mass assignment (A2)**: no hay `.insert/.update` con input del cliente (EF read-only). No aplica.
- **Rate-limit nativo aflojado**: verificado que NO — `[auth.rate_limit]` intacto.
- **Test file (`run.cjs`)**: no se reporta como superficie (lee keys de `.env.local`, nada hardcodeado).
  Skipped per política de la skill (no flag test files salvo revisión de seguridad del test).

## Cobertura indirecta (Deno / RLS / PowerSync / RN)

- La skill `sentry-skills:security-review` no tiene guía Deno/Supabase-Edge nativa → el análisis de
  `Deno.serve`, `Deno.env`, `verify_jwt` y el modelo service_role/RLS-bypass se hizo por **revisión manual
  RAFAQ-specific** (este reporte), no por la skill. Confianza alta: superficie chica y totalmente trazada.
- RLS/PowerSync: N/A — `health` es infra/ops, no toca `establishment_id`, tablas de tenant ni sync offline.
- La verificación operativa de red (que `verify_jwt=false` efectivamente permite el ping sin JWT, y que
  `anon` NO puede el RPC directo) queda cubierta por la suite `health` (C4(b)/C4(d)) que corre **post-deploy**
  (hook comentado en `run-tests.mjs:151`, se descomenta cuando el leader deploya a DEV). El gate estático
  (código + config) PASA; el gate dinámico se confirma con la suite tras el deploy gateado.
