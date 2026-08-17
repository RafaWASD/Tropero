# Contexto — 24 · DELTA: auth del visor por Cloudflare Access (Gate 0)

> Delta de la feature 24 (visor de audit). Cambia el MODELO DE AUTH: de login Supabase (usuarios de la app)
> a **Cloudflare Access** (identidad aislada, provisionada por Raf). Aprobado por Raf 2026-08-17.
> No toca el resto de 24 (filtros, query, render). El deploy va gateado.

## Problema

El visor v1 autentica al staff con **Supabase Auth = las mismas cuentas de usuario de la app** (`auth.users`).
Raf lo objetó (con razón): acoplar una herramienta forense cross-tenant al auth de los clientes es la
superficie más débil — cualquier debilidad del auth de la app (OAuth/signup/bug) se vuelve superficie del
forense. Además vos/Facundo entran con Google (sin password) y el visor apunta a DEV donde esas cuentas no
sirven. Se quiere **credenciales completamente aisladas, sin vínculo con los usuarios, dadas de alta por Raf**.

## Objetivo

Que el acceso al visor sea una **identidad organizacional aislada** (modelo banco: alta por IT), sin tocar
`auth.users`, sin reinventar auth (nada de tabla de credenciales a mano = footgun).

## Decisión (Raf, 2026-08-17): **Cloudflare Access (Zero Trust)**

Producto probado, gratis para el tamaño, gatea en el borde. La allowlist la da de alta Raf. Login por
**One-time PIN al mail** (sin password, sin Google).

## Arquitectura

```
Staff → [Cloudflare Access gatea en el borde: policy = allowlist de mails + One-time PIN]
      → Página del visor (Cloudflare Pages, detrás de Access) — SIN login propio (Access ES el login)
      → llama a /api/audit_query (MISMO dominio, Pages Function, detrás del mismo Access)
          · CF Access le inyecta el header `Cf-Access-Jwt-Assertion`
          · la Function lo REENVÍA a la EF audit_query (Supabase) + pasa el body
      → EF audit_query
          · VERIFICA el JWT de Access (RS256 contra las claves del team + aud + exp + iss)  ← reemplaza requireUser
          · (defensa en profundidad opcional: el email del JWT en una allowlist)
          · valida filtros + query parametrizada (IGUAL que v1)
```

**Por qué la Pages Function (no el navegador directo a la EF):** la cookie de Access (`CF_Authorization`) es
**HttpOnly** → el JS del navegador NO la puede leer, y la EF vive en otro dominio (`supabase.co`) → el browser
no puede reenviar el token cross-dominio. La Pages Function corre en el **mismo dominio** del visor, detrás del
mismo Access, así que recibe el `Cf-Access-Jwt-Assertion` (que Access inyecta server-side) y lo reenvía a la EF.

## Alcance del delta

1. **Pages Function** `docs/internal/audit-viewer/functions/api/audit_query.js` (Cloudflare Pages Functions):
   proxy fino. Lee `Cf-Access-Jwt-Assertion` del request, hace `fetch` a la EF `audit_query` reenviando ese
   header + el body, devuelve la respuesta. Sin lógica de negocio, sin secretos (la credencial de DB sigue solo
   en la EF). Si no viene el header (alguien pega directo sin pasar Access) → 401.
2. **EF `audit_query` — swap de auth**:
   - QUITAR `requireUser` (JWT de Supabase) y el gate por `MITROPERO_STAFF_USER_IDS`.
   - AGREGAR verificación del **JWT de Cloudflare Access** (`Cf-Access-Jwt-Assertion`): firma RS256 contra el
     JWKS del team (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, cacheado), `aud` = el AUD tag de
     la Access application, `exp`/`iss` válidos. Si falla → 401. Extrae `email` (identidad de staff).
   - Gate = un JWT de Access válido para NUESTRO `aud` (CF Access ya aplicó la allowlist). Defensa en
     profundidad opcional: chequear el `email` contra una allowlist propia (secret) — evaluar en design.
   - Config nueva (secrets de la EF, los da Raf tras crear la app): `CF_ACCESS_TEAM_DOMAIN`
     (`<team>.cloudflareaccess.com`) + `CF_ACCESS_AUD` (el AUD tag). Se retira `MITROPERO_STAFF_USER_IDS`.
   - Filtros/paginación/query/rate-limit/no-leak = **sin cambios** (todo el hardening §8 se mantiene).
3. **Página web**: sacar el login email/password + supabase-js-auth. La página ya no loguea (Access lo hace en
   el borde); arranca directo en la consola y llama a `/api/audit_query` (same-origin) en vez de a la EF de
   Supabase directo. Se elimina la dependencia de supabase-js (y su SRI) del front. La copy de login desaparece.
4. **Lo que provisiona Raf** (en Cloudflare Zero Trust → Access → Applications → Add → Self-hosted, sobre el
   dominio del visor): la **policy** (allow por mails específicos) + **One-time PIN** como login. Después me
   pasa el **team domain** + el **AUD tag** para los secrets de la EF. (El token CF que ya dio es solo de Pages;
   Access lo crea Raf en el dashboard, o me pasa un token con permisos de Zero Trust para hacerlo por API.)

## Seguridad (Gate 1 OBLIGATORIO — foco)

- **Verificación correcta del JWT de Access**: RS256 contra el JWKS del team, `aud` EXACTO de la app (no
  cualquier app del team), `exp` no vencido, `iss` = team. Un JWT de otra app/team NO debe pasar. Es el nudo
  del gate — que no haya bypass (aceptar sin verificar firma/aud, o confiar en un header sin validar).
- **La EF ya no confía en Supabase Auth ni en un header de identidad crudo** — solo en el JWT de Access
  verificado criptográficamente. Un request directo a la EF sin ese JWT → 401.
- **El muro fail-closed del audit (spec 18) sigue intacto** (la EF sigue siendo la única puerta; sin migración).
- **La Pages Function no agrega superficie**: es proxy sin secretos; su única "confianza" es estar detrás de
  Access (que inyecta el header). No debe poder ser usada para reenviar un header falso (Access lo controla).
- No-leak / PII / query parametrizada = igual que v1 (§8).

## Gates / deploy

- **Gate 1 (security_analyzer modo spec) OBLIGATORIO** (cambia el gate de seguridad de la EF).
- Sin migración. UI cambia (se saca el login) → veto de diseño liviano + captura.
- **Deploy-ordering**: Raf crea la Access app PRIMERO (sin eso no hay JWT). Después: seteo secrets de la EF +
  deploy EF (verify Access) + deploy Pages Function + re-deploy web (sin login). Si la EF exige Access-JWT
  antes de que la Function lo reenvíe → roto; se deploya el trío junto.
- Es DELTA de la feature 24 (sigue in_progress); no es feature nueva.
