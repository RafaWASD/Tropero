baseline_commit: d18384a18ef74934214e6e90144f5146160d135b

# impl — delta 24-audit-viewer / cloudflare-access (BACKEND, solo `supabase/**`)

Feature: **24-audit-viewer**, delta **cloudflare-access**. Swap del gate de auth de la EF `audit_query`
(login Supabase → JWT de Cloudflare Access) + secreto compartido Function↔EF (M-1, Gate 1). Alcance de esta
corrida: **solo `supabase/**`**. La web + Pages Function (`docs/internal/**`) las hace otra corrida — NO
tocadas acá.

> Coordinación: `progress/current.md` estaba sucio por una corrida paralela (ios-ble-mfi). Por la regla de
> terminales paralelas, el estado de esta feature vive acá + en `tasks-cloudflare-access.md`, no en `current.md`.

## Archivos

Creados:
- `supabase/functions/audit_query/access.ts` — `verifyAccessJwt(token)`: `npm:jose@5.9.6` (pin EXACTO),
  `createRemoteJWKSet` cacheado a nivel módulo, `jwtVerify` con `algorithms:['RS256']` explícito + `issuer`
  (`https://<team>`) + `audience` (`CF_ACCESS_AUD`) + `exp` por default. Fail-closed si faltan
  `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` → `HttpError(401)`. Cualquier excepción de `jwtVerify` → `HttpError(401)`
  sin propagar detalle. Devuelve `{email}` del PAYLOAD verificado (nunca de header crudo), lowercased.
- `supabase/functions/audit_query/access-helpers.ts` — helpers PUROS (sin deps Deno-only): `parseEmailAllowlist`
  (`null` = Access-como-autoridad, Set lowercased si poblado), `proxySecretMatches` (M-1, fail-closed) y
  `timingSafeEqualBytes` (comparación en tiempo constante, XOR-acumulado sin early-return por contenido).
- `supabase/functions/audit_query/access-helpers.test.ts` — 13 tests node:test (parseEmailAllowlist + M-1).

Modificados:
- `supabase/functions/audit_query/index.ts` — swap del gate. Orden as-built: (1) POST/405 → (2) **[M-1] proxy
  secret en tiempo constante ANTES del JWT** (env ausente/vacío ⇒ 401 fail-closed; header ausente/mismatch ⇒
  401) → (3) `Cf-Access-Jwt-Assertion` ausente ⇒ 401, si no `verifyAccessJwt` → (4) email allowlist opcional
  (403) → (5) rate-limit por `email` → (6-8) validateFilters/queryAudit/render IDÉNTICOS. Quitados los imports
  `createUserClient`/`requireUser`/`parseStaffAllowlist` y el gate `MITROPERO_STAFF_USER_IDS`.
- `supabase/config.toml` — `[functions.audit_query] verify_jwt = false` (patrón del bloque `health`).
- `scripts/run-tests.mjs` — stage nuevo `audit_query access helpers (spec 24 cloudflare-access)`.

INTACTOS (verificado con `git diff --stat` vacío): `query.ts`, `db.ts`, `_shared/*`. Sin migración (R4.4).

## Verificación (ejecutada)

- `node --test .../access-helpers.test.ts` → **13/13 pass**.
- `node --test .../query.test.ts` (suite existente, `query.ts` intacto) → **22/22 pass**.
- `node --test scripts/lib/stage-runner.test.mjs` (guard estático del orquestador tras registrar el stage) →
  **27/27 pass** (single execSync, ningún TEST fatal, ≥22 stages declarados).
- NO se corrió `check.mjs` ni las suites de DB (per instrucción: runtime verify-JWT + query es deploy-gated;
  no gastar el flake de rate-limit de auth de la DEV compartida).

## Deploy-gated (queda afuera de esta corrida — acción externa, OK de Raf)

- **Verificación del JWT (jose/JWKS)**: `access.ts` importa `npm:jose@5.9.6` (specifier Deno-only, NO
  importable por node:test). Es INTEGRACIÓN → se ejerce en el smoke end-to-end del deploy (T5.5): directo sin
  JWT → 401 · desde el visor tras Access → 200 · JWT con `aud` de otra app → 401. Garantía estática en código:
  `algorithms:['RS256']` + `audience`/`issuer` explícitos + fail-closed sin bypass.
- **`deno.lock`**: Deno NO está instalado en la máquina (`deno --version` → command not found) y el baseline
  (`db.ts` con `npm:postgres@3.4.5`) tampoco tiene lock committeado. El import queda pineado EXACTO
  (`npm:jose@5.9.6`); el lock se genera en el deploy con `deno cache` (necesita Deno + red npm — gateados),
  igual que el postgres del baseline (design §9 paso 3, T5.2).
- **Secrets EF** (T5.1, gate): AGREGAR `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `MITROPERO_AUDIT_PROXY_SECRET`
  (random fuerte); RETIRAR `MITROPERO_STAFF_USER_IDS`. `CF_ACCESS_EMAIL_ALLOWLIST` opcional (default: no setear).
- **Deploy EF** (T5.3): `supabase functions deploy audit_query --no-verify-jwt`.

## Trazabilidad (RCFA → test / garantía)

| Requirement | Cubierto por |
|---|---|
| RCFA.2.3 (RS256 explícito) | `access.ts:42` `algorithms:['RS256']` (estático) + smoke T5.5(c) |
| RCFA.2.5 (aud EXACTO) | `access.ts:44` `audience: aud` (estático) + smoke T5.5(c) |
| RCFA.2.6 (iss EXACTO) | `access.ts:43` `issuer` (estático) |
| RCFA.2.7 (exp) | `jwtVerify` default (estático) |
| RCFA.2.8 (fallo ⇒ 401 sin bypass) | `access.ts` catch → `HttpError(401)` (estático) + smoke T5.5(a) |
| RCFA.2.9 (email del payload verificado, no header crudo) | `access.ts:52` `payload.email`; grep confirma que `Cf-Access-Authenticated-User-Email` NO se lee |
| RCFA.2.10 (email ausente/no-string ⇒ 401) | `access.ts:53-55` (estático) |
| RCFA.2.11 (config ausente ⇒ 401) | `access.ts:35-37` (estático) |
| RCFA.2.12 (retiro staff allowlist) | grep: `index.ts` sin `requireUser`/`parseStaffAllowlist`/`MITROPERO_STAFF_USER_IDS` |
| RCFA.2.13 (email allowlist opcional) | `access-helpers.test.ts` (4 tests parseEmailAllowlist) + `index.ts:87-90` |
| RCFA.2.14 (rate-limit por email) | `index.ts:93` `isRateLimited(email)` |
| RCFA.2.15 (query/db/no-leak intactos) | `git diff --stat` vacío en `query.ts`/`db.ts`; `query.test.ts` 22/22 |
| RCFA.4.4 (verify_jwt=false) | `config.toml` `[functions.audit_query]` + smoke T5.5(a) |
| §6-bis M-1 (proxy secret tiempo constante ANTES del JWT, fail-closed) | `access-helpers.test.ts` (9 tests proxySecretMatches/timingSafeEqualBytes) + `index.ts:64-71` (orden) |

## Autorrevisión adversarial (paso 8)

Busqué y verifiqué:
- **¿proxy secret en tiempo constante y ANTES del JWT?** Sí: `index.ts` paso 2 (antes del paso 3 JWT);
  `timingSafeEqualBytes` XOR-acumula sin early-return por contenido. Residual conocido y documentado: puede
  filtrar el LARGO del secreto (no el contenido) — despreciable para token random detrás de Access.
- **¿fail-closed si el env secret falta?** Sí: `proxySecretMatches` → `false` si `envSecret` ausente/vacío
  (aunque el header venga poblado) ⇒ 401. Test explícito.
- **¿email del payload verificado, NO del header `Cf-Access-Authenticated-User-Email`?** Sí: `payload.email`;
  grep confirma que ese header crudo no aparece en código (solo en un comentario que lo prohíbe).
- **¿`algorithms:['RS256']` explícito?** Sí (anti alg-substitution / alg:none / HS256).
- **¿imports de requireUser/staff quitados?** Sí (grep vacío).
- **¿query.ts/db.ts intactos?** Sí (`git diff --stat` vacío).
- **Edge cases revisados**: token vacío → `if(!assertion)` corta antes de jose (empty string es falsy);
  `payload.email` es `unknown` → guard `typeof`/vacío; `parseEmailAllowlist` de solo-comas/espacios → `null`
  (no fail-open, el `aud` ya gateó); OPTIONS/preflight lo maneja `serveEf` (204) sin tocar el gate.
- **CORS / `X-Mitropero-Proxy-Secret`**: la Pages Function llama server-to-server (Cloudflare Worker), NO
  browser → sin preflight CORS. No hace falta agregar el header a `_shared/cors.ts` (y no se tocó `_shared`).
- **Identidad de `HttpError`**: `access.ts` e `index.ts` importan la MISMA clase de `../_shared/auth.ts` →
  `err instanceof HttpError` en el catch funciona cross-módulo. Verificado.

Nada quedó abierto; no hubo fixes pendientes tras la autorrevisión.

## Reconciliación de specs (paso 9)

1. **`parseEmailAllowlist` + helpers M-1 → `access-helpers.ts`, no `query.ts`.** La instrucción fijó
   `query.ts`/`db.ts` INTACTOS (preservar §8 M2/M3 + su suite). El design §3.3 los ubicaba en `query.ts`;
   reconciliado con nota as-built en `design-cloudflare-access.md` §3.3 y §6-bis, y en `tasks` T2.2.
2. **T4.1 (test jose de `access.ts`) y T4.4 (handler test) → DEPLOY-GATED.** `npm:jose` y
   `serveEf`/`Deno.serve` son Deno-only, no importables por node:test. La corrida downscopeó los tests puros a
   `access-helpers.ts`; la verificación jose/JWKS y los caminos del handler se cubren en el smoke T5.5.
   Reconciliado en `tasks` T4.1/T4.4.
3. **`parseStaffAllowlist` queda como DEAD CODE en `query.ts`** (ya no se importa). No se removió porque
   `query.ts` se fijó intacto — item menor para el reviewer (¿podar en un follow-up?). Anotado en `tasks` T4.5.

## Riesgos / notas para reviewer + Gate 2

- **`access.ts` no tiene test unitario** (jose Deno-only). El reviewer debe verificar por lectura que
  `algorithms:['RS256']`/`audience`/`issuer` están explícitos y que TODO fallo cae en `HttpError(401)` sin
  rama de bypass. El smoke T5.5 es el oráculo de runtime (deploy-gated).
- **`index.ts` no tiene handler test** (serveEf top-level). El gate se falsifica por sus helpers puros + el
  orden estático (revisable por lectura) + T5.5.
- **`deno.lock` sin committear** — se genera en el deploy (T5.2). Consistente con el baseline (postgres).
- **Header comment de `run-tests.mjs`** dice "22 stages/3 guards" pero ya venía desfasado por otro guard
  agregado en paralelo (rafq storage keys); no lo perseguí (drift preexistente, el guard estático solo exige
  ≥22 y no valida el contador del comentario).
- **Residual de timing** en `timingSafeEqualBytes`: filtra el largo del secreto, no el contenido. Aceptado
  (token random detrás de Access + JWT). Documentado en el código y en design §6-bis.
