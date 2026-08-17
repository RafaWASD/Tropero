# Review — 24-audit-viewer · DELTA cloudflare-access (backend EF + web + Pages Function)

- Veredicto: APPROVED
- Fecha: 2026-08-17
- Reviewer: reviewer (read-only)
- Alcance: delta de auth (login Supabase -> Cloudflare Access). Backend EF + config.toml + web + Pages Function. Runtime deploy-gated (NO se corrio check.mjs ni se deployo). No se toco app/.

---

## Trazabilidad RCFA <-> test / garantia (completa)

### Pages Function (RCFA.1.x) — audit_query.test.mjs 6/6 (manual, node:test)
- RCFA.1.1 POST-only -> audit_query.js:20 exporta solo onRequestPost; toda la suite ejerce el handler.
- RCFA.1.2 401 sin header + sin fetch -> tests audit_query.test.mjs:34 y :47 (asertan fetch.calls.length===0); audit_query.js:26-32.
- RCFA.1.3 reenvia JWT+body crudo+CT+proxy -> test :58; audit_query.js:35-53.
- RCFA.1.4 respuesta upstream tal cual -> tests :58 (200) y :82 (400); audit_query.js:56-59.
- RCFA.1.5 sin credenciales de negocio -> code review: solo MITROPERO_AUDIT_EF_URL (binding publico) + X-Mitropero-Proxy-Secret (M-1, defensa en profundidad); sin anon key/DB creds.
- RCFA.1.6 no confia en headers del cliente -> test :96 (Authorization/apikey/proxy-secret spoofeado NO llegan; exactamente 3 headers, proxy secret del env); audit_query.js:41-51.

### EF auth (RCFA.2.x)
- RCFA.2.1 / 2.12 quitar requireUser/createUserClient/parseStaffAllowlist + gate MITROPERO_STAFF_USER_IDS -> grep: index.ts ya no los importa (index.ts:24-30).
- RCFA.2.2 JWT solo de Cf-Access-Jwt-Assertion, ausente->401 -> index.ts:75-78 (estatico) + smoke T5.5.
- RCFA.2.3 RS256 explicito -> access.ts:42 algorithms [RS256] (estatico; integracion deploy-gated) + smoke T5.5(c).
- RCFA.2.4 JWKS cacheado a nivel modulo -> access.ts:18-24 (estatico).
- RCFA.2.5 aud EXACTO -> access.ts:44 audience aud (estatico) + smoke T5.5(c).
- RCFA.2.6 iss EXACTO -> access.ts:43 (estatico).
- RCFA.2.7 exp -> jwtVerify default, clockTolerance 0 (estatico).
- RCFA.2.8 fallo->401 sin bypass -> access.ts:47-50 catch mapea TODA excepcion a HttpError(401) (estatico) + smoke T5.5(a).
- RCFA.2.9 identidad SOLO del payload verificado, no header crudo -> access.ts:52 payload.email; grep confirma Cf-Access-Authenticated-User-Email NO se lee en codigo (solo comentario que lo prohibe, access.ts:27).
- RCFA.2.10 email ausente/no-string->401 -> access.ts:53-55 (estatico).
- RCFA.2.11 config ausente->401 (fail-closed) -> access.ts:35-37 (string vacio falsy tambien corta) (estatico).
- RCFA.2.13 email allowlist opcional -> access-helpers.test.ts:19-46 (4 tests parseEmailAllowlist) + index.ts:87-90.
- RCFA.2.14 rate-limit por email -> index.ts:93 isRateLimited(email) (estatico; key ex-user.id->email).
- RCFA.2.15 query/db/no-leak intactos -> git diff --stat HEAD VACIO en query.ts y db.ts; query.test.ts 22/22.

### M-1 secreto proxy (design 6-bis) — access-helpers.test.ts (9 tests)
Orden correcto: index.ts:64-71 (proxy secret) ANTES de index.ts:75-82 (JWT). Tiempo constante: access-helpers.ts:20-27 timingSafeEqualBytes (XOR-acumula sobre largo max, sin early-return por contenido). Fail-closed env ausente: access-helpers.ts:37 + tests :76. Header exigido + match byte-exacto: tests :82,:88,:92. Function manda el header del env: audit_query.test.mjs:58,:121.

### Web (RCFA.3.x) — verificacion estatica (grep/lectura)
- RCFA.3.1 sin login view -> index.html sin view-login (unica vista view-console, :179).
- RCFA.3.2 sin supabase-js/anon key -> grep limpio (solo comentarios).
- RCFA.3.3 arranca en consola -> view-console sin hidden; app.js:414 init sin gate de login.
- RCFA.3.4 same-origin sin Authorization/apikey -> app.js:20 EF_URL = /api/audit_query; app.js:162-175 callEf solo Content-Type.
- RCFA.3.5 401->recarga, sin 403 not_staff -> app.js:228-233 (ERROR_COPY.unauthorized, :47); rama not_staff eliminada.
- RCFA.3.6 CSP self -> _headers:8 + index.html:13 (script-src self, connect-src self, sin jsDelivr/Supabase).
- RCFA.3.7 filtros/tabla/diff/es-AR intactos -> renderDiff con textContent (app.js:312-316,:319-361); grep innerHTML=0.

### Access + deploy (RCFA.4.x)
- RCFA.4.1/4.2/4.3 -> provisiona Raf (T0.1-T0.3, T5.1 gated).
- RCFA.4.4 verify_jwt=false -> config.toml:398-399 scopeado SOLO a [functions.audit_query] (no afloja otras EFs) + smoke T5.5(a).

Cobertura: RCFA con test puro corrido -> 1.x (6), 2.13, M-1 (9). RCFA con garantia estatica (codigo explicito, verificado por lectura) + smoke deploy-gated T5.5 -> 2.2/2.3/2.5-2.11/2.14/4.4. Es el LIMITE explicito del leader: access.ts importa npm:jose (Deno-only, no importable por node:test) e index.ts invoca serveEf/Deno.serve en top-level -> jose/JWKS y los caminos del handler son integracion deploy-gated (T4.1/T4.4 reconciliados como tal; oraculo = smoke T5.5). No quedo logica falsificable a nivel node sin test.

---

## Tasks completas: si (con [ ] justificados)
Todas las tasks de CODIGO en [x] (Fase 1, 2, 3 + testables de Fase 4: T4.2, T4.3, T4.5). Los [ ]:
- T0.1-T0.3 [RAF] — insumos de Raf (Access app + policy + team domain/AUD). Deploy-gated. Justificado.
- T4.1 / T4.4 — DEPLOY-GATED documentado: jose/serveEf Deno-only, no importables por node:test; el gate se falsifica por helpers puros (T4.2) + smoke T5.5. Justificado.
- T5.1-T5.5 [gate] — deploy (acciones externas, OK de Raf). Justificado.
- T6.1 / T6.2 — reconciliacion al cerrar (puntero en design/context BASE). Ver NB-1.

## CHECKPOINTS
- C1 — [x] harness base presente. C1.4 check.mjs exit 0: NO corrido este review (por instruccion); suites puras verde segun impl (13/13 + 22/22 + 6/6 + stage-runner 27/27).
- C2 — [x] una sola feature in_progress (24, no done, deploy pendiente). current.md sucio por corrida paralela ios-ble-mfi (documentado).
- C3 — [x] capas previstas (EF + web estatica + Pages Function). Sin dep externa nueva en app/package.json (jose es specifier npm: del runtime Deno de la EF). Sin logs de debug, sin establishment_id hardcodeado (cross-tenant forense por diseno).
- C4 — [x] test por modulo con logica falsificable; runner >0 verde; C4.4 RLS cross-tenant: N/A (sin migracion, sin RLS nueva; lectura forense por conexion directa, muro spec 18 intacto).
- C5 — N/A (review, no cierre). Untracked = fuente nueva legitima (access.ts, access-helpers.ts, access-helpers.test.ts).
- C6 — [x] specs/active/24-audit-viewer/ con los 3 delta + base. EARS estricto (debera). Todas-las-tasks no exigible aun (feature in_progress). Cada RCFA con test/garantia+smoke.
- C7 — N/A — sin tabla nueva, sin migracion, cross-tenant forense por diseno; muro spec 18 intacto.
- C8 — N/A — web de escritorio, sin PowerSync (design 11).
- C9 — Deferido a Gate 2.5 post-deploy (deploy-gated): visor estatico standalone, NO parte del harness app/e2e; chrome no cambio (unico delta visual: sin pantalla de login). Captura post-deploy contra pagina viva (T5.5) + veto del leader. No es gate de este reviewer.

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS) — N/A: sin tablas nuevas, sin migracion, sin cambios de RLS/grants de audit.
- B (offline-first) — N/A: web de escritorio, no toca PowerSync/SQLite (design 11).
- C (BLE) — N/A.
- D (UI de campo/manga) — N/A: tool interna de escritorio para staff, no UI de manga.
- E (Edge Functions) — APLICA (adaptado al modelo Access):
  - [x] Auth al inicio -> X-Mitropero-Proxy-Secret (tiempo constante) + verifyAccessJwt(Cf-Access-Jwt-Assertion) como primeros pasos del try (index.ts:64-82). Reemplaza auth.uid(): identidad = JWT de Access verificado.
  - [x] Validacion de permisos -> allowlist en la policy de Access (borde) + aud EXACTO in-EF; user_roles N/A a proposito (forense cross-tenant, design 10). Hook opcional CF_ACCESS_EMAIL_ALLOWLIST presente y apagado por default.
  - [x] Errores con codigo HTTP + mensaje claro -> 405/401/403/429/400/5xx generico (index.ts), copy es-AR.
  - [~] deno test verde -> N/A/deploy-gated: Deno no instalado; tests puros en node:test (jose Deno-only no ejecutable aca); runtime validado en smoke T5.5.

---

## Observaciones (NO bloqueantes — a resolver antes de DONE)
- NB-1 (reconciliacion base, T6.1/T6.2): design.md BASE (:19 Authorization Bearer JWT) y requirements.md BASE describen el auth v1 (superseded) SIN puntero al delta. La supersesion SI esta documentada en requirements-cloudflare-access.md (tabla SUPERSEDED, R1.3-R1.7/R6.2/R6.4/R6.9/R6.11) y el design DELTA esta reconciliado con el as-built (notas As-built backend 2026-08-17 en 3.3 y 6-bis). Falta solo el breadcrumb desde los docs base (ADR-028 Nivel B: base no se reescribe, pero necesita el puntero). No contradice las specs del delta (fuente autoritativa del cambio); completar T6.1/T6.2 antes de marcar done.
- NB-2 (dead code): query.ts:51 parseStaffAllowlist sigue exportada y con tests en query.test.ts pero ya NO se importa desde index.ts. Se dejo porque query.ts se fijo INTACTO (preservar 8 M2/M3 + su suite). Documentado en T4.5. Podar en follow-up.
- NB-3 (deno.lock): ausente. Deploy-gated (T5.2): Deno no instalado; consistente con el baseline (postgres@3.4.5 tampoco tiene lock committeado). El pin npm:jose@5.9.6 EXACTO esta presente (access.ts:11). El lock se genera en el deploy (deno cache). Aceptable dentro del scope deploy-gated.

## Nucleo de seguridad (Gate 1 M-1 foldeado) — verificado por lectura, sin bypass
Proxy secret en tiempo constante ANTES del JWT (fail-closed si el env falta); verifyAccessJwt con algorithms RS256 + audience==CF_ACCESS_AUD + issuer==team + exp; email del payload verificado (nunca del header crudo); toda excepcion -> 401 generico sin propagar detalle de jose; JWKS cacheado; query.ts/db.ts intactos (SQL tagged-template); muro fail-closed spec 18 intacto, sin migracion; no-leak: JWT/proxy-secret no se loguean (serve-log solo lee Authorization, que la Function ya no manda).

APPROVED. El delta de codigo esta completo y correcto; el gate de seguridad (el nudo del delta) es solido. Los pendientes son deploy-gated / RAF-gated / reconciliacion-al-cerrar, todos con justificacion documentada. NB-1/NB-2/NB-3 son follow-ups no bloqueantes a cerrar antes de done.
