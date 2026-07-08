# Gate 2 (ADR-019) — Security code: delta `identificadores-unificados`

**Modo**: `code` · **Feature**: spec 02 + spec 09 delta Nivel B · **Auditor**: security_analyzer (Opus 4.8)
**Fecha**: 2026-07-08
**Baseline**: `5aa9e21` (registrado en `progress/impl_identificadores-unificados.md` L1)
**Diff auditado**: `5aa9e21..HEAD` = 2 commits — `98fd836` (migración `0122`, Fase A, hand-written por el leader) + `865e954` (Fase B frontend + PowerSync).
**Skill Sentry**: `sentry-skills:security-review` corrida sobre el diff (foco: migración `0122` + `local-reads.ts`). Metodología (trace data-flow + verify exploitability) aplicada + verificación manual contra los objetos DB vigentes (`0083`, `0096`, `0097`, `0121`).

---

## VEREDICTO: **PASS** — 0 findings HIGH · 0 findings MEDIUM

La migración hand-written `0122` y el frontend de la Fase B **no abren hueco** de authz / tenant / injection / grants. El watch M1 de Gate 1 (re-grants fail-closed de los DROP+CREATE) se **verificó byte a byte y pasa**. La resolución server-side de M1 (validación autoritativa del apodo) está **correctamente cableada por trigger** — no es bypassable. Habilitado a la puerta de deploy (que aplica el leader con autorización de Raf).

---

## Findings HIGH de Sentry

**Ninguno.** La skill no identificó vulnerabilidad HIGH-confidence en el diff, y mi verificación manual (más profunda que el pattern-match de la skill: authz de RPC SECURITY DEFINER, alineación exacta de grants, cableado del trigger de validación) **confirma** la ausencia.

## Findings RAFAQ-SPECIFIC

**Ninguno.** Los dominios RAFAQ que el diff toca (A1 service-role/RLS-bypass, A2 mass-assignment, A3/A4 IDOR/BFLA, B1 info-disclosure, F1 filter-injection, validación de inputs) se verificaron uno por uno abajo y **pasan**.

---

## Verificación del watch M1 (Gate 1) — grants fail-closed de los DROP+CREATE

Un `DROP FUNCTION` en Postgres **resetea EXECUTE a PUBLIC**. Cada re-create debe re-emitir `revoke ... from public, anon` + `grant ... to authenticated` con la **firma de tipos EXACTA de la firma NUEVA**. Verificado:

| función | tipo de recreate | firma nueva (tipos) | revoke/grant emitido | ¿alinea? |
|---|---|---|---|---|
| `create_animal` | **DROP+CREATE** (quita `p_visual_id_alt` → 20→19 args) | `uuid,uuid,uuid,uuid,uuid, text, uuid, boolean, text, text, date, text, text, text, date, numeric, uuid, text, boolean` (19) | `0122` L207-208, **idéntico** | ✅ 19/19 exacto |
| `establishment_overdue_doses` | **DROP+CREATE** (RETURNS TABLE sin `visual_id_alt`) | `(uuid, integer, integer)` | L402-403 `(uuid, integer, integer)` | ✅ |
| `establishment_unweighed` | **DROP+CREATE** (RETURNS TABLE sin `visual_id_alt`) | `(uuid, integer, text[])` | L440-441 `(uuid, integer, text[])` | ✅ |
| `register_birth` | CREATE OR REPLACE (misma firma 6-arg) | `(uuid, date, jsonb, uuid, uuid, text)` | L135-136 (redundante, grants ya preservados) | ✅ |
| `import_rodeo_bulk` | CREATE OR REPLACE (firma intacta) | `(uuid, jsonb)` | L289-290 (redundante) | ✅ |
| `transfer_animal` | CREATE OR REPLACE (firma intacta) | `(uuid, uuid, uuid, uuid, uuid)` | L371-372 (redundante) | ✅ |
| `assert_custom_value_valid` | CREATE OR REPLACE (firma intacta `(uuid, jsonb)`) | — | **NO re-emite (correcto)** — CREATE OR REPLACE preserva el `revoke from public, authenticated, anon` de `0096` L83 / `0097` L26. Es un helper de trigger, **debe** quedar revocado de TODOS. | ✅ |

- **DROP de `create_animal` matchea la vigente**: la vigente es `0083` (único definer previo — `grep` confirma solo `0083` y `0122` definen la función). Su firma de 20 tipos (`0083` L183) == la lista del `drop function if exists` de `0122` L139, byte a byte → el DROP **sí** dropea la función real (no queda overload huérfano world-executable). ✅
- **`security definer` + `set search_path = public`** presentes en las 7 funciones re-creadas. ✅
- **Recomendación operativa (deploy)**: tras aplicar `0122`, re-verificar con `has_function_privilege('public', <fn>, 'EXECUTE') = false` (o el patrón de `0097`) sobre las 3 DROP+CREATE (`create_animal`, los 2 reportes) para confirmar el fail-closed en el remoto. Es la validación real del watch M1 en producción. NO bloquea el gate (la migración es correcta); es checklist de la puerta de deploy.

---

## Resolución de M1 — apodo server-autoritativo (¿bypassable?)

**Cableado (lo crítico):** la validación del apodo vive en `assert_custom_value_valid` (`0122` L479-485), invocada por el trigger `custom_attributes_gating` **`BEFORE INSERT OR UPDATE ON custom_attributes`** (`0096` L106-108, vía `tg_custom_attributes_gating` → `perform assert_custom_value_valid`). ⇒ **TODO** camino de escritura del apodo (incluido un `PATCH` crudo a PostgREST que saltee el cliente, tanto INSERT como UPDATE) pasa por la validación. **No es bypassable.** M1 cerrado de verdad.

**Corrección de la validación (`0122` L479-485):**
```sql
if v_dk = 'apodo' then
  v_str := p_value #>> '{}';
  if char_length(v_str) > 15 then raise exception 'apodo excede 15 caracteres' using errcode = '23514'; end if;
  if v_str ~ '[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ \-]' then raise ... using errcode = '23514'; end if;
end if;
```
- `char_length ≤ 15` (cuenta caracteres, no bytes → paridad con el cap de UX del cliente `APODO_MAX_LENGTH=15`; un apodo de 15 ñ es válido en ambos lados). ✅
- Regex = **clase de caracteres negada simple** (allowlist: A-Za-z0-9 + á/é/í/ó/ú/ü/ñ ambas cajas + espacio + guion). Tiempo lineal, sin backtracking → **sin ReDoS**. `\-` dentro del bracket = guion literal; el espacio es literal. ✅
- `data_key='apodo'` sale de `field_definitions` (seed `0119`, **server-controlled**) — el atacante no lo puede setear ni renombrar para esquivar la rama. ✅
- `raise ... errcode='23514'` (check_violation) con mensaje de dominio, sin `err.message` crudo. Llega antes de reaching la rama, `p_value` ya se garantizó `string` (L473). ✅

---

## False positives descartados / no-findings (trazabilidad)

- **`drop function ... tg_reproductive_events_create_calf() cascade` (`0122` L35)** — NO es finding de seguridad (no es objeto RLS/authz; función huérfana verificada por el leader vía `pg_trigger`, Gate 1 LOW-2). El `cascade` podría, ante drift, dropear un trigger en silencio → riesgo de **completitud**, no de seguridad. Se mantiene como LOW/anexo (abajo).
- **`import_rodeo_bulk` sin cambio de rate/authz** — el delta solo le quita `visual_id_alt` del INSERT. Conserva `is_owner_of` OR veterinarian (BFLA, L228-233), cap de 5000 filas por request (E1/import fan-out, L235-237), tenant-scope por `rodeos.establishment_id`. Sin regresión. No-finding.
- **`transfer_animal` anti-IDOR** — conserva la doble barrera `has_role_in(target)` + `has_role_in(source) AND (is_owner_of(source) OR created_by=auth.uid())` (L314-319) + same-est guard + system-compat guard. El delta solo deja de leer/insertar `visual_id_alt`. No-finding.
- **`create_animal` anti-IDOR** — conserva `has_role_in` PRIMERO (L154), guard de match del intent (L169-176), guard c-bis de pertenencia del perfil (L196-202). El delta solo saca la columna del INSERT (L179-193). No-finding.
- **`register_birth`** — conserva authz-first (L63), idempotencia por `client_op_id` (L65-73), cota de fecha, cap tag ≤15, herencia `breed_id`. Quita el fallback `visual_id_alt` **en la misma transacción** que dropea el trigger de completitud → coherencia atómica (ver abajo). No-finding.
- **`selection-display.test.ts` L44/L80 (`visualId`)** — son nombres de test (strings), no referencias de código vivo. El `grep` de completitud confirma cero refs de código a `visual_id_alt`/`visualIdAlt`/`visualId` en `app/src` (solo comentarios que explican la eliminación). No-finding.

---

## Coherencia atómica (IDU.2.7)

`0122` envuelve TODO en `begin; ... commit;` (L28 / L502). El `drop trigger animal_profiles_identity_check` (L31) + `register_birth` sin fallback (L38-133) están en la MISMA transacción → una cría both-null (sin tag ni idv) persiste **sin** disparar 23514. No hay ventana donde el trigger exista pero el fallback ya no. ✅ El **anti-spoof `0079`** y la **unicidad del idv** (`animal_profiles_idv_unique`) **no se referencian** en la migración → siguen forzados. ✅

---

## Tabla de inputs (campo nuevo/modificado que el usuario tipea)

| campo | límite | validación | OK? |
|---|---|---|---|
| `apodo` (Nombre/Apodo) | ≤15 char + charset alfanum/ñ/tildes/espacio/guion | **SERVER-AUTORITATIVA** (`assert_custom_value_valid` L479-485, vía trigger `custom_attributes_gating` on INSERT **or UPDATE**) + UX en cliente (`sanitizeApodoInput`) | ✅ server-autoritativo — **M1 cerrado** |
| término de búsqueda por apodo | escapado (`escapeLike`) + LIMIT 20 | `LIKE ? ESCAPE '\'` parametrizado; `data_key='apodo'` constante; corre sobre SQLite local (tenant-scoped por stream + `ap.establishment_id = ?`) | ✅ injection-safe, tenant-safe, acotado |
| `idv` / `tag_electronic` | sin cambio (server CHECK ≤64 + único + inmutable) | sin cambio | ✅ (heredado, fuera del delta) |

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Búsqueda por apodo / lista warning-soft | n.a. | — | — | Lectura **SQLite local** (PowerSync), sin round-trip al server. Sin superficie de abuso remota; acotada por term escapado + LIMIT 20. |
| Escritura del apodo (`custom_attributes`) | n.a. (sin cambio) | — | — | Camino de escritura custom existente (outbox → INSERT/UPDATE con trigger de gating). El delta agrega **validación**, no un endpoint nuevo. |
| RPC re-creados (`create_animal`/`register_birth`/`import`/`transfer`/reportes) | n.a. (sin cambio) | — | — | Existentes; el delta solo les quita `visual_id_alt`. No cambia su perfil de rate ni expone superficie nueva. Rate de estos RPC = deuda pre-existente, fuera de scope. |

**Conclusión rate**: el delta NO toca Edge Functions, email/SMS, API externa, ni `config.toml` `[auth.rate_limit]` → rate limiting **no aplica** (sin superficie abusable server nueva). `import_rodeo_bulk` conserva su cap de 5000 filas/request (fan-out acotado).

---

## Dominios revisados (Catálogo RAFAQ)

- **A1 (service-role bypassa RLS)**: las 7 funciones re-creadas son `SECURITY DEFINER` → verificadas con scoping manual `has_role_in(...)` / `is_owner_of(...)` PRIMERO + tenant-scope por `establishment_id`. ✅
- **A2 (mass assignment)**: los INSERT se arman campo por campo (sin spread de body); `establishment_id`/`created_by`/identidad denormalizada se **fuerzan** server-side (`0043`/`0079`, no tocados). ✅
- **A3/A4 (IDOR / BFLA)**: `create_animal` (guards match-intent + pertenencia), `transfer_animal` (doble authz + owner-or-creator), `import_rodeo_bulk` (owner/vet), reportes (`has_role_in` + tenant filter). ✅
- **B1 (information disclosure)**: errcodes de dominio (23505/23514/22023/42501/23503) con mensajes genéricos; sin `err.message` crudo al cliente. ✅
- **B3 (over-fetch column-level)**: `LOCAL_LIST_SELECT`/detalle proyectan columnas explícitas; `visual_id_alt` deja de proyectarse; el apodo se lee por subconsulta correlada scopeada. ✅
- **F1 (SQL/LIKE injection)**: `buildApodoSearchQuery`/`buildApodoListQuery`/`apodoValueSubquery`/`apodoEnabledSubquery` — `establishment_id` parametrizado (`?`), `data_key='apodo'` constante literal, término escapado (`escapeLike`: `/[\\%_]/g`) + parametrizado, alias `ap`/`pap` code-controlled. Sin concatenación de input de usuario. ✅
- **C (offline/sync)**: reads locales; tenant-scope por `ap.establishment_id = ?` + stream. El drop de columna del schema local es tolerante. Coordinación de sync-rules la gestiona Raf (design §11). ✅
- **Validación de inputs**: apodo ahora **server-autoritativo** (M1 cerrado). ✅

## Dominios excluidos (con justificación)

- **A (Edge Functions)** / **D (secretos/supply chain)** / **E2-E4 (denial-of-wallet/bot/enum)** / **F2-F4 (import archivos/SSRF/XSS email)** / **G (BLE)** / **H (auth/sesión)** / **I (compliance/mobile)**: el delta no toca `supabase/functions/*`, secrets, imports Deno, captcha, parsers/fetch/templates de email, el trust boundary BLE, auth/sesión, ni hardening mobile. N/A (idéntico al scoping de Gate 1).

---

## Archivos analizados

- `supabase/migrations/0122_drop_visual_id_alt.sql` (**foco principal**, hand-written) — completo.
- `app/src/services/powersync/local-reads.ts` — query builders del apodo (L505-546, L819-967) + `buildSearchUnion` + `escapeLike`.
- `app/src/services/powersync/upload.ts` (connector, L101-131 — dropea `p_visual_id_alt`).
- Verificación cruzada: `supabase/migrations/0083` (vigente `create_animal`), `0096` (trigger de gating + `assert_custom_value_valid` base), `0097` (grants), `0121` (`register_birth` vigente).
- Grep de completitud sobre `app/src/**/*.ts` (cero refs de código vivo a `visual_id_alt`).

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: N/A (el delta no toca `supabase/functions/*`).
- **RLS / triggers Postgres**: la skill es diff-based y no razona sobre RLS/triggers server → **verificación manual aplicada** (authz de los SECURITY DEFINER, cableado del trigger de gating, coherencia atómica del drop-trigger). Cubierto arriba.
- **PowerSync sync-rules (C1)**: fuera del diff de código; el tenant-scope de la búsqueda/lista se apoya en las sync-rules (gestionadas por Raf) + el `ap.establishment_id = ?` explícito. **Nota de coordinación**: si las sync-rules referencian `visual_id_alt` explícito, Raf las actualiza en el deploy (design §11). No es objeto de este gate.

---

## Anexo LOW (no bloquea; watch-list para el deploy)

- **LOW-1 — `cascade` en el drop de `tg_reproductive_events_create_calf` (`0122` L35)**: función huérfana verificada por el leader (`pg_trigger` vacío). Ante drift, `cascade` dropearía un trigger en silencio. Riesgo de **completitud**, no de seguridad. Verificar `pg_trigger` vacío al aplicar (o dropear el trigger por nombre explícito, más auditable). Ya anotado como Gate 1 LOW-2.
- **LOW-2 — verificación post-deploy de grants**: re-confirmar en el remoto (post-apply) que las 3 DROP+CREATE quedaron `EXECUTE` revocado de public/anon (patrón `0097`). La migración es correcta; esto es defensa operativa del fail-closed. Ver "Recomendación operativa" arriba.
- **LOW-3 — skew de versión de cliente** (Gate 1 Foco 5 / LOW-3): una app sin actualizar que llame `create_animal` con `p_visual_id_alt` tras el drop del param → PostgREST no encuentra la firma → el alta queda en la outbox y reintenta al actualizar. Disponibilidad, no seguridad, **fail-closed** (outbox durable). Se registra por completitud.
