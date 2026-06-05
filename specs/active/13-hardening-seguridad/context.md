# Spec 13 — Hardening de seguridad (baseline) — Refinamiento de contexto (Gate 0)

**Status**: Decisiones tomadas con Raf (vía AskUserQuestion, 2026-06-04). **Pendiente lectura/aprobación final de este `context.md`** antes de pasar a `context_ready`.
**Fecha**: 2026-06-04.
**Conducido por**: leader + Raf.
**Origen**: auditoría baseline de seguridad del código YA MERGEADO contra el nuevo Catálogo de dominios A–I del `security_analyzer` (`progress/security_baseline_shipped.md`, 3 HIGH / 6 MEDIUM / 4 LOW). Los 3 HIGH fueron re-verificados por el leader contra el source. Triage completo en `docs/backlog.md` (entrada 2026-06-04 "Baseline de seguridad").
**Related**: spec 01 (auth, RLS de `users`, Edge Functions, `remove_member`/`change_member_role`), spec 02 (schema de `animals`/`animal_profiles`/`animal_events`, RLS `animals_update`), spec 09 (buscador), ADR-019 (gates de seguridad), ADR-022 (este Gate 0).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.

## Contexto validado

La premisa de fondo del rubric: **RLS no es la única frontera entre tenants** y **el cliente Expo es attacker-controlled** (escribe a PostgREST directo; los topes/validaciones del cliente son UX, bypasseables con un JWT de miembro). La auditoría encontró que varios controles que el equipo creía cubiertos viven solo en el cliente o tienen un hueco concreto. Esta spec **cierra el cluster code/DB** de esos findings con incrementos acotados sobre el backend ya cerrado de specs 01/02 (migrations nuevas, **NO** se reabren las viejas).

Lo que la auditoría confirmó **verde** (no se toca): authz de las 8 Edge Functions (service-role siempre scopeado por tenant + rol; inserts campo-por-campo, sin mass assignment), secreto en cliente (solo anon key), `.limit()` + `max_rows=1000`, escape de email (`escapeHtml`).

## Alcance

**Dentro (esta spec):**
- **INPUT-1 (HIGH)** — tope de largo server-side en columnas de texto de usuario.
- **B1-1 (MEDIUM)** — copy genérico al cliente en las Edge Functions (no exponer `err.message` crudo).
- **A1-1 (MEDIUM)** — `animals_update` con `with check (true)` → re-validar `has_role_in`.
- **F1-1 (MEDIUM)** — escaping + tope del término del buscador.
- **H1-1 (MEDIUM)** — invalidar la sesión del target al remover/degradar miembro.

**Fuera (decidido):**
- **B3-1 (HIGH)** — PII column-level de coworkers (`users_select_coworkers` expone la fila completa). **Decisión arquitectónica EN DISCUSIÓN** (Raf eligió "discutámoslo aparte"): patrón `view users_public` / `RPC get_coworkers` / column-grants. NO entra hasta cerrar el patrón. Es el otro HIGH explotable-hoy → tratarlo pronto, en paralelo.
- **E2-1 (MEDIUM, latente)** — rate limit propio para Edge Functions (denial-of-wallet de la cadena `invite→accept`). **Fuera de spec 13** (decisión Raf): queda en backlog condicionado a configurar `RESEND_API_KEY` (hoy latente, Resend sin key). Requiere tabla `rate_limits` + lógica → spec/tarea propia.
- **E3-1 (MEDIUM)** — captcha + `enable_confirmations`: decisión de producto/seguridad (captcha = setup con provider+key; email-confirmation = trade-off UX de campo).
- **H2-1 / CORS-1** — fixes de config (`config.toml` password 6→8; `cors.ts` `*`→dominios): se manejan como cambios de config aparte, no por SDD.
- **No auditable hoy** (re-auditar al implementarse): C (PowerSync sync rules/Realtime/SQLite-at-rest, no wired), G (BLE spec 04 sin shippear), F2/F3 (import CSV / SSRF, spec 12 sin código).

**Candidato a foldear** (mismas migrations / mismo barrido authz, a confirmar en design): deudas ya en backlog — `soft_delete_event` sin `has_role_in` (L1, 2026-05-30), `created_by` no-spoofeable en tablas de evento (SEC-SPEC-03, 2026-06-01), `register_birth` sin tope de terneros (VERIFY-001, 2026-06-04). Son de la misma familia (authz/integridad intra-tenant). El `spec_author` evalúa si entran sin inflar la spec.

## Casos y decisiones

### INPUT-1 — tope de largo server-side (decisión Raf: TECHO HOLGADO)
- **Problema**: ninguna columna de texto de usuario tiene `varchar(n)` ni `CHECK char_length`; los topes viven solo en el cliente (`validation.ts`, `animal-input.ts`, `event-input.ts`). El cliente escribe a PostgREST directo → un atacante con JWT manda `text` de varios MB y se persiste (storage exhaustion / amplificación / desbordar UI de otros). Evidencia: `0020_animal_profiles.sql` (idv/visual_id_alt/breed/coat_color/notes/entry_origin = `text` pelado), `0002`, `0001`, `0034`.
- **Decisión**: agregar `CHECK (char_length(col) <= N)` por columna vía migration nueva, con **N = techo holgado** (no espejo exacto del cliente). El **cliente sigue siendo la barrera de UX**; el CHECK es la capa autoritativa contra abuso, holgada para no rechazar input válido ni acoplarse a cada cambio de copy.
- **Techos propuestos** (el `spec_author` los reconcilia contra el schema as-built — ver notas de columnas que ya cambiaron):

  | Columna | Cap cliente (UX) | Techo server (CHECK) propuesto | Nota |
  |---|---|---|---|
  | `users.name` | 80 | **120** | |
  | `users.phone` | 15 díg / 20 char | **32** | |
  | `users.email` | regex | **320** | RFC 5321; Auth valida formato |
  | `establishments.name` | no-vacío | **160** | |
  | `establishments.province` / `city` | no-vacío | **96** | |
  | `animals.tag_electronic` | 15 exacto | **32** | opción: CHECK de formato 15 díg (FDX-B); ver design |
  | `animal_profiles.idv` | 20 | **64** | |
  | `animal_profiles.visual_id_alt` | 30 | **64** | |
  | `animal_profiles.breed` | — | **64** | interino; se ajusta al adoptar catálogo SENASA (spec 08) |
  | `animal_profiles.coat_color` | — | **64** | |
  | `animal_profiles.entry_origin` | — | **120** | enum futuro (backlog 2026-05-29) |
  | `animal_profiles.notes` | — | **4000** | texto largo |
  | `animal_events.text` (observación) | 1000 | **4000** | |

  - `animal_profiles.exit_reason` ya es **enum** (delta Tier 1 de spec 02, migration 0044) → **excluida** (ya acotada).
  - Columnas de **selector cerrado / numéricas** (peso `numeric(7,2)`, score/enums) ya están respaldadas por la DB → fuera de alcance.
- **Verificación**: test que escribe vía **PostgREST directo** (no por la UI) un valor sobre el techo y espera rechazo (`23514` check_violation). Espeja el patrón de tests de RLS/no-bypass ya existentes.

### B1-1 — no exponer `err.message` crudo al cliente
- **Problema**: 32 ocurrencias en 8 EFs + `_shared/auth.ts:44` devuelven `err.message`/`(err as Error).message` de Postgres/Deno al cliente (information disclosure de schema). El `unexpected` (catch genérico) es el más riesgoso. Distinto de `console.error`, que es correcto.
- **Decisión**: un helper en `_shared/errors.ts` (ej. `serverError(code)`) que **loguea el detalle con `console.error`** y devuelve **copy genérico estable** al cliente (`'Error interno, probá de nuevo.'` + code estable). Reemplazar las 32 ocurrencias.
- **Cierra** la entrada de backlog 2026-06-01 ("Mapear errores crudos del backend a copy genérico"), lado Edge Functions. La parte cliente de esa entrada (services que muestran `kind:'unknown'` con `message` crudo) es UX-adyacente: el `spec_author` decide si la folea acá o queda como pulido de UX aparte.
- **Verificación**: test de que un 5xx no contiene el `message` crudo del driver.

### A1-1 — `animals_update with check (true)` permite mutación cross-tenant de animal compartido
- **Problema**: `0022_rls_animals_and_profiles.sql:34-40` — la policy `animals_update` valida el `using` con `has_role_in` sobre algún perfil, pero el `with check (true)` no re-valida nada. `animals` es global (ADR-004): si un animal tiene perfil en el campo A y en el B (transferencia/compartido), un user del campo A puede reescribir `tag_electronic`/`sex`/`birth_date` que ve el campo B (fuga de **integridad**, no de lectura).
- **Decisión**: migration que recrea la policy con `with check` que **re-afirma `has_role_in` sobre algún perfil del animal** (espejo del `using`). Evaluar en design si además conviene blindar `tag_electronic` como inmutable desde el cliente (ya existe `0036_immutability_identifiers.sql` para el path RPC; confirmar que cubra el UPDATE directo del cliente).
- **Verificación**: test cross-tenant — user con rol solo en A no puede `UPDATE` la fila de un animal compartido con B.

### F1-1 — buscador: filter injection de `.or()` + término sin tope
- **Problema**: `animals.ts:341` `escapeIlike` solo reemplaza `% _ ,`; la sintaxis de `.or()` usa además `. ( ) : *`. La rama `.or(\`visual_id_alt.ilike.%${term}%\`)` (`:318`) construye el filtro como string con input de usuario → PostgREST filter injection (intra-tenant; RLS acota el blast radius al propio campo). Además el `TextInput` del buscador (`animales.tsx`) no tiene `maxLength` ni hay tope server-side del término.
- **Decisión**: (a) usar la forma **parametrizada** `.ilike(column, pattern)` en vez de `.or()` con string interpolado **o** escapar el set completo `%_,.():*` (+ comillas); (b) **acotar el largo del término server-side** (rechazar > N en el service antes de la query) + `maxLength` en el `TextInput` (UX). Cruza con INPUT-1.
- **Verificación**: test de que un término con metacaracteres no altera la estructura del filtro ni cruza columnas; test de tope de largo.

### H1-1 — sesión no invalidada al remover/degradar miembro
- **Problema**: `remove_member`/`change_member_role` hacen `user_roles.active = false` pero no invalidan la sesión activa del target; su JWT sigue válido hasta `jwt_expiry=1h`. La RLS (`has_role_in` re-evalúa `active`) lo corta igual en cada request → por eso MEDIUM. Impacto real con sesiones largas + offline (C4, futuro).
- **Decisión**: en ambas EFs, invalidar la sesión del target — `adminClient.auth.admin.signOut(targetUserId)` o revocar sus refresh tokens (espeja lo que `delete_account` ya hace para sí mismo). Documentar el modelo de invalidación.
- **Verificación**: test de que tras remover/degradar, la sesión del target queda invalidada.

## Pendientes / a resolver en design
- **B3-1** (PII coworkers): decisión arquitectónica de Raf **antes** de specear ese pedazo (no es de esta spec, pero es el HIGH gemelo — agendarlo).
- `tag_electronic`: ¿solo techo de largo (INPUT-1) o también CHECK de formato 15 díg + confirmar inmutabilidad desde cliente (A1-1)? → design.
- B1-1 lado cliente (copy genérico en services con `kind:'unknown'`): ¿folear o dejar como pulido UX? → spec_author.
- ¿Foldear las deudas authz de backlog (L1 / SEC-SPEC-03 / VERIFY-001) en el mismo barrido? → spec_author, sin inflar.
- Reconciliar la tabla de techos contra el schema as-built (exit_reason ya enum; breed migra a catálogo en spec 08).

## Insumos para spec_author
- **Reporte fuente**: `progress/security_baseline_shipped.md` (findings con file:line + evidencia + fix + las 3 tablas).
- **Catálogo de dominios A–I**: `.claude/agents/security_analyzer.md` (rubric).
- **Migrations a tocar (nuevas, no reabrir)**: CHECKs de largo (varias tablas), recrear policy `animals_update` (sobre `0022`).
- **Edge Functions**: `_shared/errors.ts` (helper), `_shared/auth.ts`, las 8 `*/index.ts` (B1-1); `remove_member`, `change_member_role` (H1-1).
- **Cliente**: `app/src/services/animals.ts` (`escapeIlike`/`.or()`), `app/app/(tabs)/animales.tsx` (`maxLength`).
- **Patrones de test**: suites `supabase/tests/*` (RLS/no-bypass cross-tenant) + tests puros de `app/src/utils`.

## Gate 1 (obligatorio)
Esta spec es **schema/RLS-sensitive** (CHECKs, recrea policy, toca EFs) → **Gate 1 (security_analyzer modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana.

## Aprobación
- **Decisiones tomadas con Raf (2026-06-04, vía AskUserQuestion)**: arrancar spec de hardening con el cluster code/DB (INPUT-1, B1-1, A1-1, F1-1, H1-1); INPUT-1 = **techo holgado**; E2-1 **fuera** (backlog condicionado a Resend); B3-1 **en discusión aparte**.
- **PENDIENTE**: lectura + aprobación final de este `context.md` por Raf → entonces 13 pasa a `context_ready` y se lanza `spec_author`.
