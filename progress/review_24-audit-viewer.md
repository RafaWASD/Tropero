# Review — 24 · Visor web interno del audit log (staff miTropero)

> Revisor. Read-only. Alcance: EF backend (supabase/functions/audit_query/**) + web
> (docs/internal/audit-viewer/**) contra specs/active/24-audit-viewer/{requirements,design}.md
> (seccion 8 hardening foldeado). check.mjs NO corrido (instruccion explicita: cambio 100% estatico
> en supabase/functions + docs/internal, deploy-gated). Corri los tests puros + verificacion estatica.

## Veredicto: APPROVED (code-complete / pre-deploy)

Feature lista para el gate de deploy. Los items runtime/E2E/hosting (T16-T23) quedan deploy-gated y
justificados en tasks.md; T24 (reconciliacion final) pendiente. Una deriva menor de texto en
requirements.md R2.4 (no bloqueante, ver Observaciones): T24 la barre antes de cerrar.

---

## 1. Completitud — 49 requirements mapeados (el enunciado decia 44; el conteo real es 49)

Cada Rn tiene 1+ mecanismo. TEST = pure query.test.ts (29/29 verde) o serve-log.test.ts (spec 23).
ESTATICO = lectura de wiring/grep/git-diff. DEPLOY-GATED = smoke T19 contra la EF deployada (aceptado
por scope; NO se marca como falla).

### US1 — Gate de staff
- R1.1 EF serveEf(audit_query) — index.ts:44 + export serveEf en serve.ts:22 (wiring OK). Estatico/smoke T19.
- R1.2 metodo no-POST devuelve 405 — index.ts:46-48. Estatico + smoke T19.
- R1.3 requireUser devuelve 401 — index.ts:52-53 + auth.ts:13-19 (throw HttpError 401) + createUserClient pasa Authorization (supabase.ts:42-52). Estatico + smoke.
- R1.4 allowlist del secret — TEST query.test.ts uuids validos, mezcla valido+basura (verde).
- R1.5 fuera de allowlist devuelve 403 y NO lee audit — index.ts:58-61 gate ANTES de queryAudit (index.ts:80); TEST parseStaffAllowlist + mutante. Verificado que el gate corre antes de la DB.
- R1.6 staff NO del body/headers — index.ts:59 usa user.id del JWT. Estatico.
- R1.7 secret ausente/vacio devuelve 403 fail-closed — TEST 3 casos (undefined/null/vacio, basura) + mutante (verde).

### US2 — Filtros validados
- R2.1 filtros en body no URL — app.js callEf (body-only, sin querystring) + index.ts:69 req.json(). Estatico + smoke web.
- R2.2 from/to ISO, invalido devuelve 400 — TEST no-string, no parseable, ISO valido.
- R2.3 auth_uid uuid regex — TEST uuid invalido, no-string.
- R2.4 establishment_id uuid + filtro — TEST inyectivo devuelve 400; filtro en db.ts:69 (coalesce, LOW-1) deploy-gated. Ver observacion de drift.
- R2.5 request_id uuid — TEST loop de uuidFields.
- R2.6 table_name allowlist — TEST fuera devuelve 400, user_roles ok.
- R2.7 op allowlist — TEST op fuera devuelve 400, op valido.
- R2.8 AND / ignora ausentes — TEST body vacio, claves desconocidas + db.ts fragmentos condicionales.
- R2.9 SQL parametrizado, sin concat — db.ts tagged-template + grep M2 = 0 unsafe/concat (solo comentarios prohibitivos) + TEST solo escalares validados.

### US3 — Paginacion
- R3.1 order id DESC — db.ts:98 order by record_version.id desc. Estatico.
- R3.2 cap 100 — TEST 4 casos clampLimit.
- R3.3 before cursor — TEST no-digitos rebota, digitos ok + db.ts:74 id menor que before::bigint.
- R3.4 next_cursor/null — index.ts:86-87,115 (hasMore/slice/nextCursor) + db.ts:99 limit+1. Estatico + smoke web (null oculta Ver mas).
- R3.5 rate limit devuelve 429 — index.ts:33-42,64 (in-memory, DESPUES del gate, Map acotado a staff). Deploy-gated (Deno). Smoke T19.
- R3.6 id string — db.ts:87 id::text as id + index.ts:97 String(r.id). Estatico.

### US4 — Lectura scopeada, muro intacto
- R4.1 conexion directa Postgres — db.ts:20,56 npm:postgres@3.4.5. Deploy-gated. Estatico.
- R4.2 sin credenciales al cliente — app.js solo URL+anon (grep: sin service_role/DB_URL). OK
- R4.3 no toca grants/muro — git diff: 0 migraciones, config.toml sin cambios, sin grants. OK (T18)
- R4.4 sin migracion — git status supabase/migrations/ vacio. OK
- R4.5 columnas forenses (9) — db.ts:85-100 select + index.ts:96-112 mapeo (id, record_id, op, ts, auth_uid, request_id, table_name, record, old_record). Estatico.
- R4.6 cross-tenant salvo est filter — db.ts sin auto-scope; est opcional. Estatico.

### US5 — Resolucion legible
- R5.1 actor batch (sin N+1) — db.ts:110-115 un query any(uids::uuid[]). Deploy-gated. Estatico (single query).
- R5.2 actor null si no resuelve — index.ts:94,102-104. Estatico. Handler test T16 gated.
- R5.3 table_label es-AR — TEST TABLE_LABELS user_roles + index.ts:108-109.
- R5.4 diff antes/despues — app.js renderDiff. Smoke web 1 (PASS) + estatico.
- R5.5 labels es-AR + resalte — app.js FIELD_LABELS + CSS val-old/val-new. Smoke web 1.

### US6 — Web
- R6.1 estatico versionado — docs/internal/audit-viewer/{index.html,app.js,_headers} presentes. OK
- R6.2 JWT en memoria — persistSession:false (app.js:22); grep localStorage/sessionStorage = 0.
- R6.3 form filtros — index.html filters (from/to/uid/est/req/table/op). Smoke.
- R6.4 POST Bearer body — app.js callEf (Bearer+apikey+body, sin querystring). Smoke.
- R6.5 columnas fila — app.js renderRow. Smoke.
- R6.6 expandir diff — app.js toggle/renderDiff. Smoke.
- R6.7 paginacion — app.js loadMore/updateMore. Smoke.
- R6.8 fecha es-AR — DATE_FMT es-AR + tz Buenos_Aires.
- R6.9 403 sin acceso, sin datos — app.js handleError (clearResults+notice). Smoke web 2 (PASS).
- R6.10 HTTPS Cloudflare + noindex — meta robots noindex + _headers X-Robots-Tag. HTTPS/deploy = T22.
- R6.11 sin secretos — solo URL+anon (publicas). OK

### US7 — Seguridad transversal
- R7.1 no loguea body/JWT — TEST serve-log.test.ts (spec 23, mismo wrapper) + serve.ts:36,45 (solo content-length + error.code).
- R7.2 5xx copy generico — errors.ts:30-33 serverError (copy Error interno) + index.ts:82,123. Estatico.
- R7.3 no loguea record/old_record/email — grep 0 console.* en el dir; serverError loguea el error del driver, no resultados. Estatico.
- R7.4 PII a staff, documentada — design.md sec 2.6/sec 7/R7.4. Gate + doc.
- R7.5 scraping acotado — cap 100 (R3.2, TEST) + rate limit (R3.5).

Wiring real (typecheck NO basta) — verificado:
- Gate de staff ANTES de la DB: index.ts orden 405, 401, 403 staff, 429, 400, queryAudit. OK
- Filtros validados llegan al query: index.ts:74,80 pasa parsed.filtros; db.ts solo lee escalares de Filtros; el body crudo nunca llega a db.ts. OK
- next_cursor (limit+1): db.ts:99 limit+1, index.ts:86-87,115. OK
- Web postea el contrato sec 2.1 y renderiza actor/diff/paginacion. OK

## 2. Seccion 8 hardening — aplicado
- M1 supabase-js pineado + SRI: index.html:297-301 supabase-js 2.112.3 dist/umd/supabase.js + integrity sha384 + crossorigin. OK
- M2 db.ts sin sql.unsafe/concat: grep = 0 (solo comentarios prohibitivos). Todo el WHERE + batch por fragmentos sql-tagged con valor ligado. OK
- M3 postgres pin exacto: db.ts:20 npm:postgres@3.4.5 (deno.lock = deploy-gated, documentado). OK
- LOW-1 coalesce(record, old_record) sobre establishment_id: db.ts:67-70. OK
- LOW-2 guards typeof string en from/to antes del new Date: query.ts:121-124. OK (y app.js dateToIso)
- LOW-3 web sin innerHTML: grep = 0 en codigo (solo comentarios); todo por createElement + textContent. OK

## 3. Muro fail-closed — preservado
git diff NO toca supabase/migrations/ (vacio) ni config.toml (schemas public/graphql_public intacto,
audit fuera de PostgREST) ni grants de audit (0124). Sin migracion (R4.4). OK

## 4. No-leak — OK
serveEf no loguea body/JWT (serve.ts + guard serve-log.test.ts). 0 console.* en audit_query/. 5xx por
serverError = copy generico, .message del driver solo a logs. OK

## 5. Tests — 29/29 verde, falsificables, registrados
- node --test supabase/functions/audit_query/query.test.ts devuelve 29 pass / 0 fail (ejecutado por mi).
- Falsifican de verdad: fail-closed de staff (secret ausente/vacio/basura da set vacio), rechazo de
  uuid/fecha/table_name/op/before malformados, cap de limit, solo escalares validados, claves desconocidas
  no llegan. El impl reporta 2 mutantes muertos (allowlist sin filtro-uuid; op sin allowlist).
- Registrado en scripts/run-tests.mjs:175-178 (audit_query pure helpers spec 24), entra en check.mjs.

---

## Tasks completas: NO — pero todo [ ] esta justificado
[x] T1-T14. [~] T15 (parte pura hecha; texto SQL deploy-gated + garantia estatica M2). [ ] con
justificacion documentada: T16/T17 (Deno-runtime, sin harness Deno en el repo), T18 (guard de muro = git
diff verificado aca), T19 (smoke E2E deploy-gated), T20 (insumo de Raf), T21/T22 (deploy Supabase/Cloudflare
gated), T23 (Gate 2.5 leader), T24 (reconciliacion final). Ninguna [ ] sin motivo.

## CHECKPOINTS
- C1 [~] check.mjs NO corrido (instruccion); la parte del feature (pure helpers spec 24) corrida directa da verde. Full run deferido (agregaria flake de rate-limit por terminal paralela, sin senal util).
- C2 [x] Sin conflicto de estado; no toca coordinacion compartida mas que registrar el test.
- C3 [x] EF sigue patron _shared; web sigue precedente landing-proximamente; sin debug logs/TODO reales; establishment_id es input de filtro, no hardcodeado.
- C4 [x] 1+ test por modulo con logica (query.ts da 29); runner mayor que 0 verde. db.ts/index.ts deploy-gated (Deno). Aislamiento = gate de staff fail-closed (pure) + smoke T19.
- C5 [ ] N/A — no se cierra sesion (pre-deploy).
- C6 [x] 3 archivos + context; EARS estricto; cada R con mecanismo; tasks [ ] justificadas.
- C7 [~] N/A tablas nuevas (0 migraciones). Cross-tenant intencional (staff); muro spec 18 intacto.
- C8 [x] Offline-first N/A documentado (design sec 5).
- C9 [~] Web de escritorio, no RN, harness ADR-029 (mobile 412x915) N/A documentado; Gate 2.5 = veto leader (T23, pendiente); smokes Playwright ad-hoc PASS.

## Checklist RAFAQ-especifico
- A. Multi-tenancy/RLS — N/A: 0 tablas nuevas, 0 migraciones. Cross-tenant es por diseno (staff). Muro fail-closed (spec 18) preservado (git diff limpio). Aislamiento = gate de staff (non-staff da 403 fail-closed; pure test + smoke T19 gated).
- B. Offline-first — N/A (herramienta web interna, design sec 5).
- C. BLE — N/A.
- D. UI de campo (manga) — N/A (consola de escritorio para staff, no manga). Estado loading presente.
- E. Edge Functions — APLICA:
  - [x] Validacion de auth.uid() al inicio: requireUser primer paso (R1.3).
  - [x] Validacion de permisos antes de la operacion: adaptado, allowlist de staff por secret (design decision 2, 2 personas) en vez de user_roles; corre ANTES de la lectura (R1.5). Aceptable y documentado.
  - [x] Errores HTTP apropiados + mensaje claro: 405/401/403/429/400/500 mapeados (design sec 2.1).
  - [~] deno test verde: Deno NO instalado en la maquina; los helpers puros corren por node:test (29/29 verde); los tests de handler Deno (T16) son deploy-gated y justificados.

---

## Observaciones (no bloqueantes)

NIT-1 requirements.md R2.4 — deriva de texto vs as-built.
requirements.md:63-64 dice literal filtrar por record sobre establishment_id, pero el as-built usa
coalesce(record, old_record) sobre establishment_id (db.ts:69, hardening sec 8 LOW-1, para no perder los
DELETE donde record es NULL). No bloquea porque: (a) el sec 8 LOW-1, mismo bundle de spec, mismo dia
2026-08-15, ya manda el coalesce como texto controlante; (b) design.md sec 2.4 esta reconciliado con el
codigo; (c) NO es una spec vieja tras un fix (el coalesce se foldeo al spec ANTES de implementar; el codigo
lo cumple desde el pase 1); (d) T24 (Reconciliacion, [ ] justificada) existe y su objeto es exactamente
barrer requirements/design/tasks contra el as-built antes de cerrar. Recomendacion: en T24, actualizar R2.4
para usar coalesce(record, old_record) o citar sec 8 LOW-1, para que R2.4 no quede mostrando un fragmento
superado.

INFO Deploy-gated (no son fallas, no cerrar la feature sin ellos): deno.lock con hashes (T21), secret
MITROPERO_STAFF_USER_IDS (T20/T21), deploy EF + Cloudflare Pages (T21/T22), smoke E2E real (T19), Gate 2.5
web (T23). Si al apuntar a PROD cambia el origen Supabase, ajustar connect-src del CSP en index.html +
_headers y la URL/anon en app.js.
