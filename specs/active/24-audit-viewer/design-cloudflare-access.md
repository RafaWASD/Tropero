# Design (delta spec 24) — Auth del visor por Cloudflare Access

> Fuente de verdad: `context-cloudflare-access.md` (Gate 0, Raf 2026-08-17) + `requirements-cloudflare-access.md`.
> Reconciliado contra el **as-built** de la EF (`supabase/functions/audit_query/{index.ts,query.ts,db.ts}`) y
> de la web (`docs/internal/audit-viewer/{index.html,app.js,_headers}`). Delta ADR-028 Nivel B: NO se reescribe
> `design.md` base; el hardening §8 del baseline (M2 SQL parametrizado, M3 pin+lockfile, LOW-1/2/3) se
> **mantiene intacto** — este delta solo cambia el **gate de auth** (paso 2–3 del pipeline) y el **transporte**
> del cliente.
>
> **Naming:** identificadores nuevos = `mitropero`/`CF_ACCESS_*`. Headers de correlación heredados de
> `serveEf` (`X-Mitropero-Request-Id`) sin cambios.

## 0. Arquitectura (antes → después)

```
ANTES (v1):
  Staff → login Supabase (email/pass) → JWT en memoria
        → web (Cloudflare) ── POST fetch, Authorization: Bearer <JWT supabase>, filtros en body ──▶ EF audit_query
        → EF: requireUser(JWT) + gate MITROPERO_STAFF_USER_IDS

DESPUÉS (este delta):
  Staff → [Cloudflare Access en el borde: policy = allowlist de mails + One-time PIN]
        → web (Cloudflare Pages, detrás de Access) — SIN login propio, arranca en la consola
        → POST fetch same-origin a /api/audit_query (filtros en body, sin Authorization)
        → Pages Function (mismo dominio, detrás del mismo Access):
              lee Cf-Access-Jwt-Assertion (Access lo inyectó server-side)
              → fetch a la EF audit_query reenviando ese header + el body
        → EF audit_query (verify_jwt=false en el gateway):
              1. método POST                                          → si no, 405 (R1.2, sin cambios)
              2. verifyAccessJwt(Cf-Access-Jwt-Assertion)             → si falla, 401  ← REEMPLAZA requireUser+staff gate
                 (firma RS256 vs JWKS del team + aud EXACTO + iss + exp; extrae email)
              3. [opcional] email ∈ CF_ACCESS_EMAIL_ALLOWLIST         → si no, 401/403
              4. rate limit por email                                 → si excede, 429 (R3.5, re-key)
              5. validateFilters(body) autoritativo                   → si inválido, 400 (R2.x, sin cambios)
              6. queryAudit(filtros) — conexión DIRECTA a Postgres    → SQL parametrizado (R4.1, sin cambios)
              7. resuelve actor + table_label + id string             → { rows, next_cursor } (R5.x, sin cambios)
```

**Por qué la Pages Function y no el navegador directo a la EF** (del context.md): la cookie de Access
(`CF_Authorization`) es **HttpOnly** → el JS del browser no la lee; y la EF vive en otro dominio
(`*.supabase.co`) → el browser no reenvía el token cross-dominio. La Pages Function corre en el **mismo
dominio** del visor, detrás del **mismo** Access, así que recibe el `Cf-Access-Jwt-Assertion` (que Access
inyecta server-side) y lo reenvía a la EF. La web nunca ve el JWT.

## 1. Archivos a crear / modificar

### Crear
- `docs/internal/audit-viewer/functions/api/audit_query.js` — la Pages Function (proxy same-origin).
- `supabase/functions/audit_query/access.ts` — verificación del JWT de Access (jose + JWKS remoto), aislada
  para poder mockearla en los tests de handler (mismo patrón que `db.ts`).

### Modificar
- `supabase/functions/audit_query/index.ts` — swap del paso de auth: fuera `createUserClient`/`requireUser`/
  gate `MITROPERO_STAFF_USER_IDS`; dentro `verifyAccessJwt` + rate-limit keyeado por email.
- `docs/internal/audit-viewer/index.html` — sacar la vista login + el `<script>` de supabase-js (+ SRI);
  arranca en la consola; CSP del `<meta>` actualizado.
- `docs/internal/audit-viewer/app.js` — sacar auth supabase-js / login / logout / whoami; `EF_URL` pasa a
  `/api/audit_query` same-origin; sin `Authorization`/`apikey`; manejo de `401` = "recargá".
- `docs/internal/audit-viewer/_headers` — CSP: `script-src 'self'` (sin jsDelivr), `connect-src 'self'`
  (sin el origen Supabase).
- `supabase/config.toml` — agregar `[functions.audit_query] verify_jwt = false` (patrón del bloque `health`).
- `supabase/functions/audit_query/deno.lock` — regenerar con el import de `jose` pineado (deploy-gated, M3).

### NO se toca
- `supabase/functions/audit_query/query.ts` — validación de filtros, allowlists, labels: **sin cambios**.
- `supabase/functions/audit_query/db.ts` — conexión directa + SQL parametrizado + resolución de actor:
  **sin cambios** (M2/M3/LOW-1 intactos).
- `_shared/*` — `serveEf` se reutiliza tal cual. **Ninguna migración** (R4.4 preservado).

## 2. Pages Function `functions/api/audit_query.js` (contrato)

Cloudflare Pages Functions rutea por método: exportar `onRequestPost` cubre POST-only (otros métodos → Pages
responde `405` sin invocar el handler).

```js
// docs/internal/audit-viewer/functions/api/audit_query.js
// Proxy same-origin: reenvía el JWT de Access (que Cloudflare inyecta server-side) + el body a la EF.
// SIN secretos, SIN lógica de negocio. La autorización real la hace la EF (verifica el JWT). RCFA.1.x.
export async function onRequestPost(context) {
  const { request, env } = context;

  // Access inyecta este header server-side en todo request que pasa por su policy. Un cliente NO puede
  // spoofearlo (Access lo sobreescribe). Si no vino, alguien pegó sin pasar Access → 401. (RCFA.1.2)
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) {
    return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Sin acceso.' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await request.text(); // se reenvía crudo, sin parsear (RCFA.1.3)
  const efUrl = env.MITROPERO_AUDIT_EF_URL; // binding público de Pages (no secreto): URL de la EF

  const upstream = await fetch(efUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cf-Access-Jwt-Assertion': assertion, // el ÚNICO header de confianza que se reenvía (RCFA.1.3)
    },
    body,
  });

  // Respuesta tal cual (status + body). (RCFA.1.4)
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

Notas:
- **Sin `Authorization`/`apikey`**: la EF se despliega con `verify_jwt=false` (§4), así que el gateway de
  Supabase no exige JWT de Supabase. La Pages Function no maneja ninguna credencial (RCFA.1.5).
- **`MITROPERO_AUDIT_EF_URL`** es la URL pública de la EF (`https://xrhlxxdnfzvdnztacofj.supabase.co/functions/v1/audit_query`
  en DEV) — se setea como variable de entorno del proyecto Pages, NO es un secreto (RCFA.1.5).
- La Pages Function **no** lee ni confía en ningún otro header del cliente (RCFA.1.6).

## 3. EF `audit_query` — verificación del JWT de Access

### 3.1 Librería: `jose` (pin EXACTO + lockfile, §8 M3)

`npm:jose@5.9.6` (versión EXACTA — mismo criterio que `npm:postgres@3.4.5` del baseline; confirmar el patch
vigente al implementar y commitear el `deno.lock`). `jose` es la lib estándar de JWT para Deno/Node, mantenida,
con `createRemoteJWKSet` (fetch + cache + rotación de JWKS) y `jwtVerify` (firma + claims). **No** se escribe
verificación de firma a mano.

### 3.2 `access.ts` (nuevo módulo, aislado para mockear en tests)

```ts
// access.ts — verificación del JWT de Cloudflare Access (spec 24, delta cloudflare-access).
// Aislado de index.ts para mockearlo en los tests de handler. La EF ya NO confía en Supabase Auth ni en
// ningún header de identidad crudo: SOLO en este JWT verificado criptográficamente (RCFA.2.9).
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { HttpError } from '../_shared/auth.ts';

// JWKS remoto cacheado a nivel módulo: createRemoteJWKSet cachea las claves y refetchea ante kid desconocido
// (rotación). Persiste mientras la instancia de EF esté caliente (RCFA.2.4).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(teamDomain: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  }
  return jwks;
}

export async function verifyAccessJwt(token: string): Promise<{ email: string }> {
  const teamDomain = Deno.env.get('CF_ACCESS_TEAM_DOMAIN'); // <team>.cloudflareaccess.com
  const aud = Deno.env.get('CF_ACCESS_AUD');                // AUD tag de NUESTRA app

  // Fail-closed ante config ausente: sin secrets, NADIE entra (RCFA.2.11).
  if (!teamDomain || !aud) {
    throw new HttpError(401, 'unauthorized', 'Sin acceso.');
  }

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, getJwks(teamDomain), {
      algorithms: ['RS256'],                    // SOLO RS256: rechaza alg:none / HS256 / substitution (RCFA.2.3)
      issuer: `https://${teamDomain}`,          // iss EXACTO = team (RCFA.2.6)
      audience: aud,                            // aud EXACTO = nuestra app, no cualquiera del team (RCFA.2.5)
      // exp lo valida jwtVerify por defecto (RCFA.2.7). clockTolerance queda en 0 (estricto).
    }));
  } catch (_e) {
    // Firma inválida / aud|iss distinto / exp vencido / forma inválida / JWKS inalcanzable → 401 (RCFA.2.8).
    // No se propaga el detalle del error de jose al cliente (no-leak, R7.2).
    throw new HttpError(401, 'unauthorized', 'Sin acceso.');
  }

  const email = payload.email;
  if (typeof email !== 'string' || email === '') {
    throw new HttpError(401, 'unauthorized', 'Sin acceso.'); // RCFA.2.10
  }
  return { email: email.toLowerCase() };
}
```

Puntos de seguridad (foco Gate 1):
- **`algorithms: ['RS256']`** es obligatorio: sin restringir, un atacante podría intentar `alg:none` o HS256
  usando la clave pública del JWKS como secreto HMAC (algorithm-substitution). jose sin `algorithms` acepta
  los algoritmos de las claves; fijarlo a RS256 cierra ese vector (RCFA.2.3).
- **`audience: aud` EXACTO**: `jwtVerify` exige `aud` === `CF_ACCESS_AUD`. Un JWT legítimo emitido por Access
  para OTRA application del mismo team (otro `aud`) **no pasa** (RCFA.2.5). Este es el punto que evita que
  "cualquier app del team" alcance el forense.
- **`issuer` EXACTO** = `https://<team>.cloudflareaccess.com` (RCFA.2.6).
- **Fail-closed sin bypass**: cualquier excepción de `jwtVerify` → `HttpError(401)`. No hay rama que acepte el
  token sin verificar, ni que lea el `email` de un header crudo (RCFA.2.8, RCFA.2.9).
- **JWKS cacheado** a nivel módulo (RCFA.2.4): no se refetchea por request; `createRemoteJWKSet` maneja el
  refresh ante `kid` nuevo. No es un secreto (el JWKS es público).

### 3.3 `index.ts` — el swap (diff conceptual)

QUITAR:
```ts
import { createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireUser } from '../_shared/auth.ts';
import { parseStaffAllowlist, TABLE_LABELS, validateFilters } from './query.ts';
...
const userClient = createUserClient(req);
const user = await requireUser(userClient);
const staff = parseStaffAllowlist(Deno.env.get('MITROPERO_STAFF_USER_IDS'));
if (staff.size === 0 || !staff.has(user.id.toLowerCase())) {
  return jsonError(403, 'not_staff', 'No tenés acceso a esta herramienta.');
}
if (isRateLimited(user.id)) { ... }
```

PONER:
```ts
import { HttpError } from '../_shared/auth.ts';         // se conserva HttpError para el catch → jsonError
import { TABLE_LABELS, validateFilters } from './query.ts'; // parseStaffAllowlist ya no se importa
import { verifyAccessJwt } from './access.ts';
...
// 2. Auth (RCFA.2.2): el JWT de Access viene en Cf-Access-Jwt-Assertion. Ausente → 401 sin leer nada.
const assertion = req.headers.get('Cf-Access-Jwt-Assertion');
if (!assertion) {
  return jsonError(401, 'unauthorized', 'Sin acceso.');
}
const { email } = await verifyAccessJwt(assertion); // tira HttpError(401) si no verifica (RCFA.2.8)

// 3. [opcional] defensa en profundidad por email allowlist (RCFA.2.13). Ausente ⇒ Access es la autoridad.
const emailAllow = parseEmailAllowlist(Deno.env.get('CF_ACCESS_EMAIL_ALLOWLIST'));
if (emailAllow !== null && !emailAllow.has(email)) {
  return jsonError(403, 'not_staff', 'Sin acceso.');
}

// 4. Rate limit keyeado por el email verificado (RCFA.2.14; cap/ventana de R3.5 sin cambios).
if (isRateLimited(email)) {
  return jsonError(429, 'rate_limited', 'Demasiadas consultas, probá en un momento.');
}
// 5–7. validateFilters / queryAudit / armado de respuesta: IDÉNTICOS al baseline (R2.x/R4.x/R5.x).
```

- `parseEmailAllowlist(secret)`: devuelve `null` si el secret está ausente/vacío (⇒ Access es la autoridad,
  no se filtra por email), o un `Set<string>` de emails lowercased si viene poblado. **[As-built backend
  2026-08-17]** vive en un módulo PURO nuevo `access-helpers.ts` (no en `query.ts`): la corrida de backend
  fijó `query.ts`/`db.ts` INTACTOS para preservar §8 M2/M3 y su suite, así que los helpers puros del gate
  (allowlist + comparación en tiempo constante del proxy secret) se aislaron en `access-helpers.ts` — sin
  deps Deno-only, importable por node:test igual que `query.ts`, y separado de `access.ts` (que importa
  `npm:jose`, no node-importable). **Importante:** `null` (ausente) NO es fail-open — es el modo explícito
  "Access-como-autoridad"; el gate real (JWT válido para nuestro `aud`) ya corrió.
- El `catch` del handler ya mapea `HttpError` → `jsonError(status, code, message)` (baseline), así que el
  `401` de `verifyAccessJwt` sale bien tipado. Todo otro error → `serverError` (5xx genérico, R7.2).
- **Rate-limit key**: el `email` es estable por persona (lo emite Access). Reemplaza al `user.id` que ya no
  existe. El bucket in-memory best-effort no cambia (design baseline §2.5).

### 3.4 Nota sobre `serveEf` reutilizado

`serveEf` loguea un `sub` best-effort del JWT del header `Authorization` (spec 23). Con este delta ya no viene
un `Authorization` de Supabase (la Pages Function no lo manda), así que ese `sub` queda vacío/ausente — sin
impacto funcional ni de seguridad (nunca fue autoritativo; era etiqueta de traza). El `Cf-Access-Jwt-Assertion`
**no** se loguea (no-leak, R7.1/R7.3): `serveEf` no loguea headers de auth.

## 4. Config del gateway: `verify_jwt=false` (decisión)

Se despliega la EF con `verify_jwt=false` (`[functions.audit_query]` en `config.toml` + `--no-verify-jwt` en
el deploy remoto, patrón del bloque `health`). Razón:

- El gateway de Supabase con `verify_jwt=true` exige un JWT firmado por el proyecto (la **anon key** califica).
  Como la anon key es **pública** (viajaba en la web v1), ese gate no aporta protección real; solo obligaría a
  la Pages Function a portar la anon key (acoplamiento sin beneficio).
- Con `verify_jwt=false` la EF queda como **único gate**, y ese gate es la verificación criptográfica del JWT
  de Access (`aud` EXACTO + firma RS256). Un request directo a la EF sin un JWT de Access válido → `401`
  (RCFA.4.4). El posture de seguridad no depende del gateway.

**Alternativa descartada:** mantener `verify_jwt=true` y que la Pages Function mande `Authorization: Bearer
<anon_key>`. Descartada: la anon key es pública ⇒ cero protección incremental + acopla la Pages Function a un
"secreto" que no lo es. La verificación in-EF del JWT de Access es la autoridad real en ambos casos.

## 5. Secrets / config (delta)

| Nombre | Dónde | Qué es | Acción |
|---|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | EF secret | `<team>.cloudflareaccess.com` (host, sin scheme) | **AGREGAR** (lo da Raf) |
| `CF_ACCESS_AUD` | EF secret | AUD tag de nuestra Access application | **AGREGAR** (lo da Raf) |
| `CF_ACCESS_EMAIL_ALLOWLIST` | EF secret | emails de staff separados por coma (opcional) | **OPCIONAL** (default: no setear) |
| `MITROPERO_STAFF_USER_IDS` | EF secret | allowlist de uuids (v1) | **RETIRAR** (RCFA.2.12) |
| `MITROPERO_AUDIT_EF_URL` | Pages env (no secreto) | URL pública de la EF | **AGREGAR** (binding de Pages) |
| `SUPABASE_DB_URL` | EF secret auto-inyectado | conexión directa a Postgres | sin cambios |
| `MITROPERO_AUDIT_PROXY_SECRET` | EF secret + Pages env | secreto compartido Function↔EF (random) | **AGREGAR** (§6-bis, Gate 1 M-1) |

## 6. Defensa en profundidad: email allowlist in-EF (decisión → NO por default)

**Recomendación: Access-como-autoridad alcanza; no setear `CF_ACCESS_EMAIL_ALLOWLIST` por default.** Motivos:

1. La policy de Access **ya es** la allowlist (la provisiona Raf, RCFA.4.2). Duplicar los mails en un secret de
   la EF crea **drift**: alta/baja en dos lugares; olvidar uno degrada (deja entrar a quien Access ya sacó, o
   traba a quien Access dejó).
2. El check de `aud` EXACTO (RCFA.2.5) ya garantiza que el token fue emitido para NUESTRA app específicamente
   — no alcanza con ser del team.
3. El blast radius está acotado: solo quien pasa la policy de Access obtiene un token.

Por eso el hook queda **opcional y apagado por default** (`parseEmailAllowlist` → `null` ⇒ no filtra). Si Raf
quisiera un segundo muro más adelante (p.ej. rotar staff sin tocar Access), setear el secret lo activa sin
tocar código. Se implementa el hook (RCFA.2.13) para dejar la puerta, pero no se activa.

## 6-bis. Defensa en profundidad: secreto Function↔EF (FOLDEADO de Gate 1 M-1, 2026-08-17)

Del `progress/security_spec_24-cloudflare-access.md` (PASS, M-1 MEDIUM recomendado). Con `verify_jwt=false` la
EF queda **directamente expuesta a internet** y el JWT de Access es el ÚNICO gate frente al dato más sensible
del proyecto. Se AGREGA un secreto compartido Function↔EF como belt-and-suspenders:

- **Secret nuevo `MITROPERO_AUDIT_PROXY_SECRET`** (valor random fuerte): en el proyecto **Pages** (env de la
  Function) Y en la **EF** (secret). Lo genera el leader al deployar (random, no reusar nada).
- **Pages Function**: setea `X-Mitropero-Proxy-Secret: <MITROPERO_AUDIT_PROXY_SECRET>` en el `fetch` a la EF
  (amenda §2: la Function ahora SÍ tiene UN secret — solo éste). No reenvía ningún otro header del cliente.
- **EF `audit_query`**: chequea `X-Mitropero-Proxy-Secret` == el secret **ANTES** de `verifyAccessJwt` — si
  falta o no coincide → **401 inmediato** (comparación en **tiempo constante**, no `===` naïve). **[As-built
  backend 2026-08-17]** implementado como helper puro `proxySecretMatches(header, envSecret)` en
  `access-helpers.ts`, que compara byte-a-byte con `timingSafeEqualBytes` (XOR-acumula sobre el largo máximo,
  sin early-return por contenido → no filtra bytes del secreto por timing; residual aceptado: puede filtrar
  el LARGO, despreciable para un token random). Fail-closed: `MITROPERO_AUDIT_PROXY_SECRET` ausente/vacío en
  el env ⇒ `false` ⇒ nadie pasa. Beneficio
  doble: (a) un bug futuro de la verificación del JWT NO es game-over directo (el caller directo no tiene el
  proxy secret); (b) rechaza barato el flood no autenticado (Denial-of-Wallet) ANTES de gastar la verificación
  RS256 + el rate-limit.
- **Fail-closed**: EF sin `MITROPERO_AUDIT_PROXY_SECRET` seteado → rechaza todo (401), igual que los `CF_ACCESS_*`.

**L-1 (LOW → backlog):** acotar el CORS `*` de `_shared/cors.ts` (ya innecesario porque la web llama
same-origin; no explotable — un browser cross-origin no produce un Access-JWT válido). Transversal → backlog.
**L-2 (LOW):** documentar el supuesto "un solo team" del cache de JWKS (`getJwks` memoiza sin re-evaluar
`teamDomain` en caliente) — ok para un solo team.

## 7. Web (`docs/internal/audit-viewer/`)

### 7.1 `index.html`
- **Eliminar** el bloque `<main id="view-login">` completo (card, form email/password, copy "Ingresá con tu
  cuenta de miTropero", `#login-error`) — RCFA.3.1.
- **Eliminar** el `<script src="…supabase-js@2.112.3…" integrity=…>` — RCFA.3.2. La web ya no carga supabase-js.
- La vista consola (`#view-console`) pasa a ser la única; arranca visible (sin `hidden`) — RCFA.3.3.
- `whoami`/`logout` del topbar: la web **no conoce** el email (Access lo tiene, pero el JS no lee la cookie
  HttpOnly). Default: quitar `#whoami`. "Salir" (opcional) puede ser un link a `/cdn-cgi/access/logout`
  (endpoint de Access que cierra la sesión del borde) en vez del `signOut()` de supabase-js.
- **CSP `<meta>`**: `script-src 'self'` (sin `https://cdn.jsdelivr.net`); `connect-src 'self'` (sin el origen
  Supabase — ahora se llama same-origin) — RCFA.3.6.

### 7.2 `app.js`
- **Eliminar**: `SUPABASE_URL`/`SUPABASE_ANON_KEY`, `window.supabase.createClient`, `doLogin`, `doLogout`,
  `showLogin`, `setLoginError`, el wiring de `#login-form`/`#logout`, y `state.accessToken`/`state.email`.
- `EF_URL` pasa a la **ruta relativa** `'/api/audit_query'` (same-origin) — RCFA.3.4.
- `callEf`: sacar los headers `Authorization` y `apikey`; queda solo `Content-Type: application/json`. La
  cookie de Access viaja sola por ser same-origin (`fetch` la incluye por default en same-origin) — RCFA.3.4.
- `init`: arrancar directo en la consola (no hay `showConsole()` tras login; la consola ya está montada).
- **`handleError`**: la rama `403 not_staff` deja de aplicar (ya no existe ese código). En `401` mostrar
  "Tu sesión expiró, recargá la página." (Access re-autentica al recargar) — RCFA.3.5. Si Access ya expiró,
  el `fetch` same-origin puede recibir un redirect `302` al login de Access; se maneja como error de red /
  se sugiere recargar.
- **Sin cambios**: `collectFilters`, `renderRows`, `renderDiff` (textContent, §8 LOW-3), `formatDate` es-AR,
  paginación por `next_cursor`, mapas es-AR (RCFA.3.7).

### 7.3 `_headers` (Cloudflare Pages)
- `Content-Security-Policy`: `script-src 'self'` (sin jsDelivr); `connect-src 'self'` (sin el origen
  Supabase). El resto (`X-Robots-Tag`, `Referrer-Policy`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  `object-src 'none'`, `Permissions-Policy`) queda igual — RCFA.3.6.

## 8. Config que provisiona Raf (documentar, no implementar)

En **Cloudflare Zero Trust → Access → Applications → Add → Self-hosted**, sobre el dominio del visor:
1. **Application** self-hosted apuntando al dominio/subdominio del visor (cubre la web y `/api/*`) — RCFA.4.1.
2. **Policy**: action *Allow*, include = **Emails** (los mails de staff: Raf + Facundo) — RCFA.4.2.
3. **Login method**: **One-time PIN** (sin password, sin Google) — RCFA.4.2.
4. Tras crear la app, Raf pasa: **team domain** (`<team>.cloudflareaccess.com`) + **AUD tag** de la
   application → se setean como `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` en la EF (RCFA.4.3).
5. En el proyecto **Pages** del visor: variable `MITROPERO_AUDIT_EF_URL` = URL pública de la EF.

## 9. Deploy-ordering (gateado — OK de Raf)

El trío rompe si se despliega en desorden (la EF exigiendo Access-JWT antes de que la Function lo reenvíe, o
la web llamando a `/api/*` antes de que exista la Pages Function). Orden:

1. **Raf crea la Access application** (sin esto no hay JWT ni `aud`/team). Pasa team domain + AUD tag.
2. Setear secrets de la EF: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` (+ retirar `MITROPERO_STAFF_USER_IDS`).
3. Generar/commitear `deno.lock` con `jose` pineado (`deno cache`, gateado — M3).
4. **Deploy de la EF** `audit_query` con `--no-verify-jwt` (verify Access JWT).
5. **Deploy de la Pages Function** + la web actualizada + `MITROPERO_AUDIT_EF_URL`, todo detrás de la Access
   application.
6. Verificación: (a) request directo a la EF sin JWT → `401`; (b) desde el visor (tras pasar Access) → `200`
   con filas; (c) un JWT con `aud` de otra app → `401`.

Pasos 2–5 son acciones externas (Supabase / Cloudflare) → **gateadas** (OK de Raf), como el resto de la
feature 24. La web cambia (se saca el login) → **veto de diseño liviano + captura** (Gate 2.5 mínimo).

## 10. Multi-tenancy / RLS

Sin cambios respecto del baseline (§4 del `design.md` base): la feature sigue cross-tenant, gateada ahora por
Access (en vez de la allowlist de uuids). El **muro fail-closed de spec 18 se preserva** (R4.3 / RCFA.2.15):
no se tocan grants de `audit`, el schema sigue sin exponerse a PostgREST, no hay migración. La EF sigue siendo
la única puerta; lo único que cambia es **cómo** se autentica esa puerta.

## 11. Offline-first

**No aplica** (igual que el baseline §5): herramienta web interna de escritorio para staff; no corre en la app
RN, no toca PowerSync, no carga datos en campo.

## 12. Foco de Gate 1 (security_analyzer modo spec)

1. **Verificación del JWT de Access SIN bypass** (§3.2): firma **RS256 real** contra el **JWKS del team**,
   `algorithms:['RS256']` explícito (anti alg-substitution), `aud` **EXACTO** de nuestra app (un JWT de otra
   app/otro team NO pasa), `iss`/`exp`. Cualquier fallo → `401`. No hay rama que acepte el token sin verificar
   ni que confíe en un header de identidad crudo.
2. **La EF ya no confía en Supabase Auth ni en identidad cruda**; solo en el JWT de Access verificado. Con
   `verify_jwt=false`, la EF es el único gate y un request directo sin JWT → `401` (§4).
3. **Muro fail-closed intacto + fail-closed ante config ausente**: sin migración, sin tocar grants de `audit`;
   secrets `CF_ACCESS_*` ausentes ⇒ nadie entra (`401`, §3.2). La Pages Function es proxy sin secretos y no
   agrega superficie (su única confianza es estar detrás de Access, que controla el header inyectado).
4. **No-leak preservado**: el error de `jose` no se propaga al cliente (`401` genérico); `Cf-Access-Jwt-Assertion`
   no se loguea; §8 (M2/M3/LOW-1/2/3) del baseline sin cambios.
