# Tasks — 24 · Visor web interno del audit log (staff miTropero)

> Pasos discretos en orden. Cada uno con los `R<n>` que cubre. El implementer marca `[x]`; el reviewer
> rechaza si queda `[ ]` sin justificación.
>
> Convenciones de marcado:
> - **(DB/deploy-gated)** — requiere deploy de la EF a Supabase o config externa (Cloudflare/secret). Gateado:
>   script + OK de Raf en sesión (memoria [[reference_supabase_deploy_from_session]]).
> - **(Raf)** — insumo que aporta Raf antes del deploy (user_ids de staff, confirmar hosting).
> - Sin migración en toda la feature (R4.4): la EF solo LEE `audit.record_version`.

## Fase EF — `audit_query`

- [x] T1 — Crear `supabase/functions/audit_query/query.ts` (puro): `UUID_RE`, `parseStaffAllowlist(secret)`,
  `TABLE_ALLOWLIST`, `OP_ALLOWLIST`, `TABLE_LABELS`, `clampLimit`, `validateFilters(body)` → devuelve
  `{ ok, filtros }` o `{ ok:false, error }`. Cubre: R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R3.2, R5.3.
- [x] T2 — Crear `supabase/functions/audit_query/db.ts`: apertura de la conexión directa a Postgres
  (`npm:postgres@3.4.5` EXACTO, `SUPABASE_DB_URL`, `{ max:1, prepare:false }`) + cierre en `finally`. Aislado
  para poder mockearlo. Cubre: R4.1, R4.2. (runtime deploy-gated — no corre en node)
- [x] T3 — Crear `supabase/functions/audit_query/index.ts` con `serveEf('audit_query', …)`:
  método POST (else 405) → `createUserClient`/`requireUser` (else 401) → gate de staff contra
  `MITROPERO_STAFF_USER_IDS` (else 403 `not_staff`, fail-closed si vacío) → rate limit 60/60s (else 429) →
  `validateFilters` (else 400 `invalid_filter`). Cubre: R1.1, R1.2, R1.3, R1.4, R1.5, R1.6, R1.7, R3.5.
- [x] T4 — Query de lectura parametrizada sobre `audit.record_version` (WHERE condicional por filtro, orden
  `id DESC`, `limit+1` para el cursor). SQL 100% ligado, sin concatenar input crudo. Cubre: R2.1, R2.8, R2.9,
  R3.1, R3.3, R3.4, R4.5, R4.6.
- [x] T5 — Resolución de actor (batch, `public.users` + `public.user_private` por `id = any($uids::uuid[])`) +
  armado de la respuesta `{ rows, next_cursor }`, `id` como string, `actor` null si no resuelve, `table_label`.
  Cubre: R3.6, R5.1, R5.2, R5.3.
- [x] T6 — Manejo de errores: `HttpError` → `jsonError`; 5xx → `serverError` (copy genérico, sin message del
  driver). No loguear `record`/`old_record` ni el email del actor. Cubre: R7.2, R7.3.

## Fase Web — `docs/internal/audit-viewer/`

- [x] T7 — `index.html`: estructura login + consola (estilo landing, paleta miTropero, es-AR),
  `<meta noindex>`. Cubre: R6.1, R6.10.
- [x] T8 — `app.js` auth: supabase-js por CDN, `signInWithPassword`, JWT en memoria
  (`persistSession:false`), toggle login/consola, manejo de 403 `not_staff`. Cubre: R6.2, R6.9, R6.11.
- [x] T9 — `app.js` filtros + fetch: formulario (fecha/usuario/campo/operationId/tabla/op), `POST` a la EF con
  `Authorization: Bearer` y filtros en el body (nunca en la URL). Cubre: R6.3, R6.4.
- [x] T10 — `app.js` render: tabla de resultados (actor legible, tabla label, fecha es-AR, request_id, op),
  formato de fecha es-AR. Cubre: R6.5, R6.8.
- [x] T11 — `app.js` diff expandible: unión de claves `record`/`old_record`, antes → después con resalte,
  labels es-AR de campos, colapso de lo que no cambió (INSERT/UPDATE/DELETE). Cubre: R5.4, R5.5, R6.6.
- [x] T12 — `app.js` paginación: "Ver más" con `before = next_cursor`; ocultar cuando `next_cursor === null`.
  Cubre: R6.7.
- [x] T13 — `_headers` de Cloudflare Pages: `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CSP acotado (jsDelivr pineado + origen Supabase).
  Cubre: R6.10, R6.11.

## Fase Tests

- [x] T14 — Unit puros (`query.ts`, `node:test`, 29 tests en `query.test.ts`, registrados en
  `scripts/run-tests.mjs`): allowlist de staff (vacía/basura → nadie; uuids válidos), validación de cada
  filtro (uuid inválido/fecha inválida/table_name fuera de allowlist/op inválido/before no-dígitos → error),
  cap de limit (default/>100/≤0), mapa de labels, forma de `filtros` (solo escalares validados, claves
  desconocidas descartadas). 2 mutantes verificados (allowlist sin filtro-uuid / op sin allowlist → rojos).
  Cubre: R1.4, R1.7, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R3.2.
- [~] T15 — Parte pura CUBIERTA en `query.test.ts` ("forma de filtros": input inyectivo en un campo
  no-uuid/no-allowlist → 400, jamás llega a `filtros`; claves desconocidas del body descartadas). La
  falsificación a nivel del TEXTO SQL (input malicioso aparece como parámetro, no en el string) vive en
  `db.ts` (tagged-template de Postgres.js, Deno-only) → **deploy-gated**; garantía estática por grep
  (`unsafe`/concat = 0 en el dir, [§8 M2]). Orden `id DESC` + `limit+1` implementados. Cubre: R2.9, R3.1.
- [ ] T16 — (Deno-runtime) Test de handler con mock de `db.ts` + user client (no-staff → 403; secret vacío →
  403; GET → 405; sin JWT → 401; rate limit → 429; `id` string; `actor` null si no resuelve). Requiere
  `Deno.test` (`index.ts`/`db.ts` importan `Deno`/`npm:postgres`, no corren en node) → **gated**; el smoke
  E2E T19 los ejerce end-to-end. Cubre: R1.2, R1.3, R1.5, R1.7, R3.5, R3.6, R5.2.
- [ ] T17 — Test no-leak: el NO-LEAK del wrapper `serveEf` (body/JWT) ya está falsificado por
  `_shared/serve-log.test.ts` (spec 23) — el mismo wrapper que monta esta EF. El handler no tiene `console.*`
  propio (grep = 0) y los 5xx salen por `serverError` (copy genérico, sin message del driver). La aserción
  runtime del handler es **gated** (T16/T19). Cubre: R7.1, R7.2, R7.3.
- [ ] T18 — Guard de muro: test/aserción de que el `git diff` de la feature no toca grants de `audit` ni
  agrega el schema a `config.toml`/`schemas`, y que no hay migración nueva. Cubre: R4.3, R4.4.
- [ ] T19 — (DB/deploy-gated) Smoke E2E contra la EF deployada en DEV: staff real lista filas de `user_roles`;
  filtros por `request_id`/`op` acotan; no-staff recibe 403; el cliente no puede leer `audit.record_version`
  directo (sigue 42501/PGRST106). Cubre: R1.5, R2.5, R2.7, R4.1, R4.5.

## Fase Deploy (gated)

- [ ] T20 — (Raf) Aportar los `user_id` de staff (Raf + Facundo) para `MITROPERO_STAFF_USER_IDS` y confirmar
  el hosting Cloudflare (Pages nuevo vs ruta en el Worker de la landing). Cubre: R1.4, R6.10.
- [ ] T21 — (DB/deploy-gated) Setear el secret `MITROPERO_STAFF_USER_IDS` en el proyecto Supabase (DEV) y
  deployar la EF `audit_query` (`npx supabase functions deploy audit_query`, molde de spec 23). Cubre: R1.1,
  R1.4.
- [ ] T22 — (deploy-gated) Publicar el estático en Cloudflare (Pages/Worker según T20), con `_headers` y
  HTTPS. Verificar `noindex` y que la consola cargue supabase-js del CDN. Cubre: R6.1, R6.10.
- [ ] T23 — Gate 2.5 (UI web): veto de diseño del leader (checklist web adaptado) + capturas de login,
  consola con resultados, y una fila expandida mostrando un diff antes → después legible. Cubre: R5.4, R5.5,
  R6.5, R6.6.

## Fase Reconciliación

- [ ] T24 — Reconciliar `requirements.md`/`design.md`/`tasks.md` con el as-built (driver pg real, forma de la
  respuesta, límites del rate limit, host Cloudflare elegido) antes de cerrar (regla de reconciliación,
  `docs/specs.md`).
