baseline_commit: 3d3afc9d7ff4eea12f4acd00205060914f8ce6be

# impl — 24-audit-viewer · BACKEND (Edge Function `audit_query`)

> Alcance de ESTA corrida: solo `supabase/functions/audit_query/**` + registro de tests en
> `scripts/run-tests.mjs`. La web (`docs/internal/**`) la hace OTRA corrida en paralelo — NO tocada.
> Reconciliación backend de specs incluida (design §2.4 + tasks T1–T6/T14–T17). `docs/` NO tocado.

## Archivos

Creados:
- `supabase/functions/audit_query/query.ts` — helpers **PUROS** (sin deps Deno-only): `UUID_RE`,
  `TABLE_ALLOWLIST` (`{user_roles}`), `OP_ALLOWLIST` (`{INSERT,UPDATE,DELETE}`), `TABLE_LABELS`
  (`user_roles→'Roles de miembro'`), `clampLimit` (1..100, default 50), `parseStaffAllowlist(secret)`
  (fail-closed) y `validateFilters(body)` → `{ ok, filtros }` | `{ ok:false, error }`.
- `supabase/functions/audit_query/db.ts` — conexión DIRECTA a Postgres (`npm:postgres@3.4.5` EXACTO,
  `SUPABASE_DB_URL`, `{max:1,prepare:false}`, cierre en `finally`). Query del audit + batch de actores 100%
  por **tagged-template** (fragmentos `sql\`…\`` condicionales, placeholders ligados). Sin `sql.unsafe`, sin
  concat. **[deploy-gated]** (Deno + `SUPABASE_DB_URL`).
- `supabase/functions/audit_query/index.ts` — handler `serveEf('audit_query', …)`: POST→405 / requireUser→401
  / gate staff (fail-closed)→403 / rate limit 60·60s→429 / validateFilters→400 / lectura db.ts / armado
  `{ rows, next_cursor }` con `id` string, `actor` batch, `table_label`. **[deploy-gated]** (Deno).
- `supabase/functions/audit_query/query.test.ts` — 29 tests `node:test` sobre `query.ts` (falsificables).

Modificados:
- `scripts/run-tests.mjs` — registra el `run('audit_query pure helpers (spec 24)', …)` junto al guard puro
  de serve-log (ambos corren sin Deno ni keys).
- `specs/active/24-audit-viewer/design.md` — reconciliación as-built §2.4 (expresiones SQL reales +
  deno.lock deploy-gated).
- `specs/active/24-audit-viewer/tasks.md` — T1–T6 y T14 `[x]`; T15 `[~]` (pura hecha, SQL-text gated);
  T16/T17 anotadas como Deno-runtime/gated.

Sin migración (R4.4). `_shared/*` reutilizados sin tocar. `config.toml` NO tocado (schema `audit` sigue
fuera de PostgREST). Grants de `audit` intactos.

## Verificación (sin deploy)

- **Tests puros `query.ts`**: `node --import ./scripts/ts-ext-resolver.mjs --test
  supabase/functions/audit_query/query.test.ts` → **29 pass / 0 fail**.
- **Falsificabilidad (2 mutantes, ambos muertos)**:
  - allowlist SIN filtro por `UUID_RE` → `27 pass / 2 fail` (abriría el gate a basura).
  - `op` SIN chequeo contra `OP_ALLOWLIST` → `27 pass / 2 fail`.
  - restaurado → `29 pass / 0 fail`.
- **`deno check`**: NO corrido — Deno no está instalado en la máquina (`deno --version` → not found).
- **`check.mjs`**: NO corrido (instrucción explícita; solo los tests de `query.ts`).

## Deploy-gated (para el reviewer / Gate 2 / T19–T21)

1. **Runtime `index.ts` + `db.ts`** — importan `Deno.*` / `npm:postgres`; necesitan `SUPABASE_DB_URL` +
   deploy. No ejercitables en node. Smoke E2E = T19.
2. **`deno.lock` de la function ([§8 M3])** — el pin EXACTO (`npm:postgres@3.4.5`) está en el `import`
   (el control de M3 a nivel fuente). Generar el lockfile con integrity requiere `deno cache` (toolchain
   Deno + red a npm), ambos gateados → se genera y commitea en T21 (deploy). Confirmar en el deploy que
   3.4.5 sigue siendo la 3.x intencionada.
3. **Secret `MITROPERO_STAFF_USER_IDS`** — lo aporta Raf (T20) + se setea en Supabase (T21). Sin él, la EF
   responde 403 a TODOS (fail-closed, verificado por test).
4. **Tests de handler T16/T17** — requieren `Deno.test` (mock de `db.ts`); el repo no tiene harness Deno
   → gated. El no-leak del wrapper `serveEf` ya está cubierto por `serve-log.test.ts` (spec 23), que es el
   mismo wrapper que monta esta EF.

## Trazabilidad R<n> → test / mecanismo

| R | Cubierto por |
|---|---|
| R1.4 (allowlist del secret) | `query.test.ts` "uuids válidos → set lowercase", "mezcla válido+basura" |
| R1.7 (fail-closed secret ausente/vacío/basura) | `query.test.ts` 3 tests de `parseStaffAllowlist` + mutante |
| R1.1/R1.2/R1.3/R1.5/R1.6 (montaje, POST, auth, gate) | `index.ts` (deploy-gated; smoke T19) |
| R2.2 (from/to ISO + [§8 LOW-2] guard tipo) | `query.test.ts` "from/to no-string", "no parseable", "ISO válido" |
| R2.3/R2.4/R2.5 (uuids por regex antes del cast) | `query.test.ts` "uuid inválido", "no-string", "inyectivo→400" |
| R2.6 (table_name allowlist) | `query.test.ts` "fuera de allowlist→400", "user_roles→ok" |
| R2.7 (op allowlist, case-sensitive) | `query.test.ts` "op fuera→400", "op válido→ok" |
| R2.8 (filtros ausentes se ignoran / claves desconocidas fuera) | `query.test.ts` "body vacío", "claves desconocidas" |
| R2.9 (SQL parametrizado, sin concat) | `db.ts` tagged-template + grep estático `unsafe`/concat = 0 ([§8 M2]) |
| R3.2 (cap limit) | `query.test.ts` 4 tests de `clampLimit` |
| R3.3 (before cursor) | `query.test.ts` "before no-dígitos→400", "dígitos→ok" |
| R3.1/R3.4/R3.6 (orden id DESC, next_cursor, id string) | `db.ts` (`id::text`, `order by record_version.id desc`, `limit+1`) + `index.ts` |
| R4.1/R4.2/R4.3 (conexión directa, sin exponer schema/grants) | `db.ts` + `git diff` sin migración/grants (T18) |
| R4.4 (sin migración) | `git diff supabase/migrations/` vacío |
| R4.5/R4.6 (columnas forenses, cross-tenant) | `db.ts` select + `index.ts` mapeo |
| R5.1/R5.2/R5.3 (actor batch, null si no resuelve, table_label) | `db.ts` batch + `index.ts` `actorById`/`TABLE_LABELS` · `query.test.ts` label |
| R7.1/R7.2/R7.3 (no-leak) | `serve-log.test.ts` (spec 23) + handler sin `console.*` + `serverError` |

## Autorrevisión adversarial (paso 8)

Busqué, como revisor hostil:
- **SQL por string / `sql.unsafe` / concat** → `grep -rn "unsafe|\` +|+ sql"` en el dir: 0 (solo comentarios
  que lo PROHÍBEN). Todo el WHERE y el batch de actores va por fragmentos `sql\`…\`` con `${valor}` ligado.
- **Gate de staff abre por default si el secret falta** → NO: `parseStaffAllowlist` devuelve `Set` vacío ante
  `undefined`/`''`/basura, y el handler corta con `staff.size === 0 || !staff.has(...)` → 403. Test + mutante.
- **Filtro sin validar llega a la query** → NO: `db.ts` solo lee campos de `filtros` (producido por
  `validateFilters`); `index.ts` pasa `parsed.filtros`. El body crudo nunca llega a `db.ts`. Un filtro
  malformado corta en 400 antes de tocar la conexión.
- **Se loguea record/old_record/email** → NO: cero `console.*` en el dir; `serverError` (de `_shared`) loguea
  el detalle del DRIVER (error), no resultados. `record`/`old_record`/`email` son resultados de query, no
  aparecen en un error del driver.
- **Fuga de PII por el message del driver al cliente** → NO: `serverError` devuelve copy genérico
  ('Error interno, probá de nuevo.'), el `.message` de Postgres solo va a logs server-side (R7.2).
- **Leak de memoria del rate-limit** → NO: el chequeo está DESPUÉS del gate de staff → solo user.ids de staff
  entran al `Map` (acotado por la allowlist). Un no-staff nunca lo alimenta (403 antes).
- **Precisión del bigint** → `id::text as id` en el SELECT (no depende de si Postgres.js entrega number/BigInt)
  → string exacto; `order by record_version.id desc` qualificado para no ordenar por el alias text.
- **[§8 LOW-1] DELETE + filtro establishment_id** → `coalesce(record, old_record)->>'establishment_id'` (en un
  DELETE `record` es NULL → sin coalesce se perderían esos DELETE).

Nada requirió corrección: todo lo anterior ya estaba cerrado en el primer pase.

## Reconciliación de specs (paso 9)

`design.md §2.4` recibió un bloque "Reconciliación as-built (backend)" con las expresiones SQL reales
(`op::text = $op` en vez de `op = $op::audit.operation`; `id::text as id` + `order by record_version.id`;
composición por fragmentos `sql\`…\``; blank = filtro ausente; `before` string-only; deno.lock deploy-gated).
`tasks.md` refleja T1–T6/T14 hechas y T15–T17 con su estado real. `requirements.md` NO se tocó: el *qué*
(EARS) no cambió, solo el *cómo* del SQL.

## Riesgos / notas para el reviewer y el Gate 2 (modo code)

- **Gate 2 DEBE verificar [§8 M2] sobre el diff**: grep `unsafe`/concat en `audit_query/` = 0 (ya confirmado
  acá; el diff es el punto de control).
- **Postgres.js: cast de arrays** `any(${uids}::uuid[])` y de fechas/uuids sobre placeholders — validado por
  lectura, NO ejercido en runtime (deploy-gated). El smoke E2E (T19) es el oráculo empírico.
- **`postgres@3.4.5`**: versión elegida como 3.x estable; sin red para verificar "última 3.x". El deploy debe
  confirmarla y generar el `deno.lock`. Si 3.4.5 no resolviera, el deploy falla (fail-safe, no runtime-silent).
- El handler-test y el smoke E2E quedan gated (Deno/deploy); no es que falten por olvido — el repo no tiene
  harness Deno y el runtime necesita `SUPABASE_DB_URL`.
