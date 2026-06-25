# Security Review — Spec 08 / capa de SYNC (T7: PowerSync sync streams + schema local) — Modo: code (Gate 2)

**Fecha**: 2026-06-24
**Analista**: security_analyzer
**Skill**: `sentry-skills:security-review` (metodología: trace data flow + verify exploitability ANTES de reportar)
**Baseline**: `559864423de4ee53fb02d33c40dbe090481210d6` (de `progress/impl_08-sigsa-db.md:1`; trabajamos sobre `main`, sin feature-branch → el as-built de T7 está sin commitear, confirmado por `git status --porcelain`)
**Alcance EXACTO**: SOLO el diff de los 3 streams nuevos de la sección "── SIGSA (spec 08) ──" en `sync-streams/rafaq.yaml` (líneas 260-285) + las 3 tablas locales nuevas y la columna `animal_profiles.breed_id` en `app/src/services/powersync/schema.ts`. NO se re-auditan los streams ni tablas pre-existentes (ya gateados).
**Veredicto**: **PASS**

> ⚠️ CONTEXTO ESPECIAL atendido: el run del implementer de T7 corrió con el clasificador de seguridad CAÍDO y se cortó por error de API. Por eso este Gate verificó el as-built contra GROUND TRUTH (las migraciones 0107/0111/0112 ya aplicadas) y no solo contra la intención de la spec. Resultado: el as-built coincide con la intención; no quedó nada a medio escribir que abra un hueco.

---

## Resumen ejecutivo

**PASS — 0 HIGH, 0 MEDIUM.**

Los 3 streams nuevos están **correctamente scopeados** y el schema local **no materializa nada cross-tenant**. El control crítico de la feature — `sigsa_export_log` (cuyo `file_content` es el TXT completo con TODOS los RFIDs del lote) — usa **exactamente** el `org_scope` estándar, byte-idéntico al de los 22 streams per-establishment ya probados. Un usuario con rol solo en el campo A **NO** recibe en su SQLite local el `file_content` (ni ninguna fila) de `export_log`/`sigsa_declarations` del campo B. El catálogo global de razas (`catalog_breed`) no contiene datos de tenant → su bucket global read-only es el trato correcto.

Confianza: **alta**. Triple vía: (1) lectura del diff exacto, (2) verificación de las columnas referenciadas contra las migraciones as-built ya aplicadas (`establishment_id` existe y es `NOT NULL`; `deleted_at` NO existe en ninguna de las 3 tablas), (3) comparación mecánica del `org_scope` de los 2 streams scope-establishment nuevos contra el de los pre-existentes (`uniq` colapsa a **un único** cuerpo de CTE, 22 ocurrencias idénticas + las 2 nuevas).

---

## Foco 1 (control #1) — `sigsa_export_log`: el scope de `file_content`

`rafaq.yaml:279-285`:
```yaml
sigsa_export_log:
  auto_subscribe: true
  with:
    org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
  queries:
    - SELECT * FROM export_log WHERE establishment_id IN org_scope
```

- **Scope = `org_scope` estándar, EXACTO.** El cuerpo del CTE en línea 282 es byte-idéntico al de `est_animal_profiles` (línea 126), `est_sessions` (133), etc. Verificado mecánicamente: `grep -oE 'org_scope:\s*SELECT.*active = true'` sobre todo el archivo colapsa (`uniq`) a **una sola** definición distinta repetida 22 veces; las dos SIGSA (líneas 275, 282) caen dentro de esas 22. No hay deriva de una sola letra.
- **NO es más amplio.** No usa `owner_scope` (sería incorrecto en otra dirección — R4.2 dice que todo rol activo ve el historial; restringir a owner sería un bug funcional, no de seguridad), no omite el `WHERE`, no agrega `OR`, no JOINea otra tabla que enumere campos ajenos.
- **`establishment_id` existe y es la columna correcta.** Ground truth: `0112_export_log.sql:26` → `establishment_id uuid NOT NULL references establishments(id)`. El filtro `WHERE establishment_id IN org_scope` se ancla a una columna real, no-nullable → ninguna fila escapa al filtro por `establishment_id NULL`.
- **Sin filtro `deleted_at`** — **correcto**: `export_log` no tiene columna `deleted_at` (0112 no la declara; es append-only audit, R11.3). Igual que `est_animal_category_history`. No es un over-sync: el scope por `establishment_id IN org_scope` es completo para esta tabla.
- **Exploitability del leak cross-tenant**: para que el campo B fugue a A, A necesitaría que `B.establishment_id ∈ (SELECT establishment_id FROM user_roles WHERE user_id = A AND active = true)`. Eso requiere que A tenga un rol ACTIVO en B — es decir, A ya es miembro de B y el acceso es legítimo. El `auth.user_id()` lo fija el JWT de Supabase server-side (no es spoofeable desde el cliente Expo). **No bypasseable.**

**Conclusión foco 1: el dato más sensible de la feature está scopeado exactamente como debe. PASS.**

---

## Foco 2 — `sigsa_declarations`

`rafaq.yaml:272-277`:
```yaml
sigsa_declarations:
  with:
    org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
  queries:
    - SELECT * FROM sigsa_declarations WHERE establishment_id IN org_scope
```

- **Mismo `org_scope` estándar** (línea 275, byte-idéntico). Mismo análisis de no-leak que foco 1.
- **`establishment_id NOT NULL`** confirmado en ground truth (`0111_sigsa_declarations.sql:33`).
- **Sin filtro `deleted_at` — correcto y verificado**: la tabla NO tiene `deleted_at` (append-only inmutable, R11.3; `0111:31-40` no la declara, y el comentario 0111:20-23 documenta el fix del veto del leader 2026-06-13 que removió una referencia a `deleted_at` sobre columna inexistente). Mismo patrón que `est_animal_category_history` (rafaq.yaml:202-207, que también omite `deleted_at` a propósito). Que la stream NO filtre `deleted_at` es la decisión correcta porque la columna no existe. **No es finding.**

**Conclusión foco 2: PASS.**

---

## Foco 3 — `catalog_breed` (global)

`rafaq.yaml:264-270`:
```yaml
catalog_breed:
  auto_subscribe: true
  queries:
    - SELECT * FROM breed_catalog
```

- **Global read-only sin `with:` es el trato correcto.** Ground truth `0107_breed_catalog.sql:19-27`: `breed_catalog` **NO tiene `establishment_id`** ni ninguna columna de tenant. Es un catálogo público cerrado de 32 razas con códigos SENASA oficiales (28 bovinas + S/E + 3 bubalinas). No hay nada que scopear: el mismo universo de 32 filas es válido para todos los tenants. Mismo patrón exacto que `catalog_species`/`catalog_categories` (rafaq.yaml:44-55).
- **No expone nada sensible**: las columnas (`senasa_code`, `name`, `species`, `active`, `sort_order`, `created_at`) son referencia pública del manual SIGSA v2.42.80; sin PII, sin RFIDs, sin datos de campo.
- **`SELECT *` sin `WHERE active = true` — verificado como decisión deliberada, no descuido**: el comentario 267-269 lo justifica (sincronizar las 32 incl. las bubalinas `active=false` evita el edge F6 — un `breed_id` de raza inactiva igual resuelve nombre/código offline). No es un leak: las filas inactivas son del mismo catálogo público. Sin impacto de seguridad.
- **No mutable desde el cliente**: `0107:38-44` define una única policy SELECT/USING true, sin INSERT/UPDATE/DELETE; grant a `authenticated` = solo SELECT (confirmado en el Gate 2 de DB, foco 6). El cliente recibe el catálogo read-only.

**Conclusión foco 3: PASS.**

---

## Foco 4 — Patrón JOIN-FREE / short-hand `org_scope`

- Los 2 streams scope-establishment usan el patrón V3 **correcto**: filtro DIRECTO `WHERE establishment_id IN org_scope`, **sin JOINs**. Ninguno introduce un `INNER JOIN establishments` (la causa documentada del fallo V2 que enumeraba 102 campos vivos por stream, header líneas 10-14). El bucket count se mantiene independiente del volumen de data.
- El short-hand `WHERE col IN org_scope` (CTE de 1 columna) está bien aplicado en ambos — `org_scope` proyecta una sola columna (`establishment_id`), requisito de la sintaxis de PowerSync streams (header línea 36-37).
- `catalog_breed` no usa `with:` (no lo necesita) → 1 bucket global, no escala con campos. La bucket-math actualizada (comentario 294-296: ~52 buckets para 2 campos, << 1000) es coherente.

**Conclusión foco 4: el modelo JOIN-free se respeta; sin explosión de buckets, sin JOIN que fugue. PASS.**

---

## Foco 5 — `schema.ts`: materialización local

Las 3 tablas locales nuevas (`schema.ts:478-518`) + `animal_profiles.breed_id` (`schema.ts:203`):

- **`export_log` (507-518)**: declara `file_content: column.text`. **Sí se materializa el TXT con RFIDs en el SQLite local — y es CORRECTO**: la fila ya viene scopeada por el stream `sigsa_export_log` (foco 1), así que el SQLite local solo contiene el `file_content` de los campos del propio usuario. La re-descarga (R10.1) lo lee de ahí offline. El comentario 501-506 documenta exactamente esta cadena de razonamiento (materializar es seguro PORQUE el scope del stream es correcto). No hay columna de más; las columnas declaradas espejan el as-built de 0112.
- **`sigsa_declarations` (492-499)**: columnas espejan 0111. `declared_by` se materializa pero es el `auth.uid()` forzado server-side (no PII de coworkers; es el propio actor). Scopeado por el stream. OK.
- **`breed_catalog` (478-485)**: columnas del catálogo público. Sin dato sensible. OK.
- **`breed_id` en `animal_profiles` (203, `column.text`)**: bien tipado — `breed_id` es `uuid` en Postgres (`0108`), y la convención del schema (comentario 16) mapea `uuid → TEXT` (PowerSync no tipa, SQLite es laxo). Es FK al catálogo público; baja por `est_animal_profiles` (`SELECT *`), que YA está scopeado por `org_scope` (stream pre-existente, no tocado). No agrega superficie de leak: `breed_id` es un código de raza, no un dato cross-tenant; y la fila de `animal_profiles` que lo porta ya está scopeada por su propio establishment. OK.
- **Nada se declara `localOnly`/`insertOnly` incorrectamente**: las 3 tablas son CRUD-plano sincronizado normal (entran al `Schema` en 713-716), no overlay ni outbox. Coherente con que son datos reales server-poblados/sync.

**Conclusión foco 5: ninguna columna sensible se materializa fuera de su scope; `file_content` se materializa pero correctamente gateado por el stream; `breed_id` bien tipado. PASS.**

---

## Comparación obligatoria — SIGSA vs streams per-establishment ya gateados

| Stream | `with:` scope | cuerpo del CTE | `deleted_at` filter | ¿coincide con est_*? |
|---|---|---|---|---|
| `est_animal_profiles` (ref) | `org_scope` | `SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true` | sí (tabla tiene deleted_at) | — (baseline) |
| `est_sessions` (ref) | `org_scope` | idem byte-idéntico | sí | — (baseline) |
| `est_animal_category_history` (ref) | `org_scope` | idem byte-idéntico | NO (tabla sin deleted_at) | — (baseline) |
| **`sigsa_declarations`** (nuevo) | `org_scope` | **idem byte-idéntico (línea 275)** | NO (tabla sin deleted_at, verificado en 0111) | **SÍ** (== est_animal_category_history: scope + omisión deleted_at justificada) |
| **`sigsa_export_log`** (nuevo) | `org_scope` | **idem byte-idéntico (línea 282)** | NO (tabla sin deleted_at, verificado en 0112) | **SÍ** |
| **`catalog_breed`** (nuevo) | (ninguno) | global, `SELECT *` | n/a (catálogo público) | **SÍ** (== catalog_species/catalog_categories) |

**Verificación mecánica**: `grep -oE 'org_scope:\s*SELECT.*active = true' | sort | uniq -c` → **una sola** definición distinta del CTE, 22 ocurrencias (las pre-existentes + las 2 SIGSA). Cero deriva. Ningún stream SIGSA usa `owner_scope` (correcto: R4.2 = todo rol activo ve el historial).

**No difieren → no hay finding.**

---

## Findings HIGH de Sentry (skill)

**Ninguno.** El pase de la skill `sentry-skills:security-review` sobre el diff (threat model: cliente Expo attacker-controlled; las sync rules son la ÚNICA capa de autorización del wire de sync — no hay RLS por encima del WAL, ADR-025) no arrojó findings HIGH-confidence. Categorías evaluadas:

- **Broken object-level authz / cross-tenant leak (CWE-639/200)** — el vector central de esta capa: los 2 streams scope-establishment filtran por `establishment_id IN org_scope` anclado a `auth.user_id()` del JWT (server-fixed). No leak.
- **Information disclosure (CWE-200)**: `file_content` (RFIDs) y `sigsa_declarations` solo bajan a usuarios con rol activo en el establishment dueño. `catalog_breed` no tiene dato sensible.
- **Injection en las queries de sync**: las data queries son SQL estático con un short-hand CTE (`IN org_scope`); ningún valor del cliente se concatena en el texto de la query (el `auth.user_id()` lo resuelve PowerSync server-side, no es interpolación de payload). No injection.
- **Over-materialization local (data-at-rest)**: `file_content` se materializa en SQLite pero gateado por el stream; es el comportamiento esperado para la re-descarga offline. No es exposición indebida.

> Nota de cobertura: la skill de Sentry NO entiende nativamente la semántica de PowerSync sync streams ni de RLS de Postgres (ver § Cobertura indirecta). El veredicto se apoya en la revisión manual RAFAQ-específica + la verificación contra ground truth, que es donde vive la evidencia real de esta capa.

## Findings RAFAQ-SPECIFIC

**Ninguno.** Checklist RAFAQ aplicado al diff:

- **Sync rules como autorización paralela a RLS (ADR-025)**: los 2 streams scope-establishment replican el `org_scope` ya probado; no fugan cross-tenant. ✓
- **`file_content` con RFIDs (control #1)**: scope = `org_scope` estándar, byte-idéntico, verificado mecánicamente. ✓
- **Catálogo global**: `breed_catalog` sin `establishment_id` → global read-only correcto, sin dato sensible. ✓
- **JOIN-free V3**: respetado, sin explosión de buckets. ✓
- **Materialización local (C3 data-at-rest)**: `file_content` materializado pero gateado por stream; declarado conscientemente (comentario 501-506). ✓
- **Stale-auth / append-only (C4)**: `sigsa_declarations`/`export_log` son append-only (sin UPDATE/DELETE de cliente, reforzado a nivel grant en la capa DB ya gateada); las sync rules no introducen un path de mutación. ✓
- **Secrets**: ningún secreto en el diff; sin `console.log`. ✓

## False positives descartados (para trazabilidad)

| Observación | Por qué NO es finding |
|---|---|
| `sigsa_declarations`/`sigsa_export_log` no filtran `deleted_at` | Las tablas NO tienen columna `deleted_at` (verificado en 0111/0112 as-built; append-only inmutable R11.3). Filtrar una columna inexistente haría fallar el Validate del dashboard. Omisión correcta, idéntica a `est_animal_category_history`. |
| `catalog_breed` hace `SELECT *` sin `WHERE active = true` | Decisión deliberada documentada (267-269): evita el edge F6 (raza inactiva que no resolvería su código en la UI). Las 32 filas son catálogo público sin tenant. Sin impacto de seguridad. |
| `file_content` (TXT con RFIDs) se materializa en el SQLite local | Correcto y necesario para la re-descarga offline (R10.1). La fila ya viene scopeada por `sigsa_export_log` (org_scope) → el SQLite solo tiene el file_content de los propios campos. El riesgo de data-at-rest del device es el mismo que para CUALQUIER dato sincronizado (cubierto a nivel arquitectura por C3, no por T7). |
| `auto_subscribe: true` en los 3 streams | Coherente con todos los demás streams del archivo; no amplía el scope (cada stream sigue filtrando por `org_scope`/global). No es over-exposure. |

---

## Tabla de inputs (campos que el usuario tipea, tocados por T7)

| Campo | Límite | Validación (server/cliente/ausente) | OK? |
|---|---|---|---|
| (ninguno nuevo en T7) | — | — | — |

**Nota**: T7 es **config de sync + schema local**, no introduce formularios, buscadores ni texto libre. Los inputs de la feature (RFID 15 dígitos, `file_content`/`file_name` con sus CHECK de tamaño, `establishment_id`/`animal_profile_id` con IDOR-check) viven en la capa DB (0107-0112) y la capa pura (T9/T10), **ya gateadas con PASS** (`security_code_08-sigsa-db.md`, `security_code_08-sigsa-capa-pura.md`). T7 no agrega ni afloja ninguna validación de input. Sin campos de entrada nuevos → tabla vacía es correcta.

## Tabla de rate limits (acciones abusables tocadas por T7)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Sync de `export_log`/`sigsa_declarations`/`breed_catalog` al SQLite local | n.a. | n/a | n/a | Replicación de lectura vía PowerSync (WAL→bucket), scopeada server-side por `org_scope`. No es una Edge Function ni manda email/SMS/API externa. El abuse vector de escala (storage del `file_content`) está acotado por el CHECK `octet_length <= 5 MB` de la capa DB (0112), no por rate limit. La escritura (INSERT de export/declaración) es CRUD-plano gateado por RLS, sin costo por request externo. |

**Conclusión rate limits**: T7 no introduce ninguna Edge Function, API externa ni vector de costo nuevo. Es 100% sync de lectura + schema local. Ninguna acción nueva requiere rate limit.

---

## Archivos analizados

- `sync-streams/rafaq.yaml` — SOLO los 3 streams nuevos (líneas 260-285): `catalog_breed`, `sigsa_declarations`, `sigsa_export_log`.
- `app/src/services/powersync/schema.ts` — SOLO las 3 tablas locales nuevas (478-518: `breed_catalog`, `sigsa_declarations`, `export_log`) + `animal_profiles.breed_id` (203) + su registro en `Schema` (713-716).

Soporte (ground truth de columnas, NO en scope de cambios): `0107_breed_catalog.sql` (sin establishment_id), `0111_sigsa_declarations.sql` (establishment_id NOT NULL, sin deleted_at), `0112_export_log.sql` (establishment_id NOT NULL, sin deleted_at). Streams pre-existentes para comparación de scope: `est_animal_profiles`, `est_sessions`, `est_animal_category_history`, `catalog_species`/`catalog_categories`. Gate 2 de DB previo: `progress/security_code_08-sigsa-db.md` (que explícitamente difirió la verificación de T7 a este informe, líneas 202/210).

Diff confirmado: `git diff HEAD -- sync-streams/rafaq.yaml app/src/services/powersync/schema.ts` lista exactamente los 3 streams + las 3 tablas + breed_id; `git status --porcelain` los marca como modificados sin commitear (sobre `main`). Scope exacto, sin re-litigar lo ya gateado.

---

## Cobertura indirecta de Deno / RLS / PowerSync

- **PowerSync sync rules (el corazón de T7)**: **NO cubierto nativamente por la skill de Sentry** — la skill no entiende la semántica de buckets/streams ni que el WAL ignora RLS/views/GRANTs (ADR-025). **Cubierto por revisión manual** (este informe): comparación mecánica del `org_scope` contra los 22 streams pre-existentes (`uniq` → 1 sola definición), verificación de las columnas contra las migraciones as-built, y trazado de exploitability del leak cross-tenant (requiere rol activo en el campo dueño → acceso legítimo). Este es el ángulo donde vive la evidencia real; lo dejo explícito.
- **RLS de Postgres**: N/A para T7 — la capa DB (RLS de las 3 tablas) ya tiene Gate 2 PASS (`security_code_08-sigsa-db.md`). T7 NO toca migraciones ni policies. Pero el punto arquitectónico clave: para el wire de sync, las **sync rules** (no la RLS) son la autorización → verificadas acá.
- **Deno / Edge Functions**: N/A — T7 no tiene Edge Functions.
- **Validación en vivo del YAML**: el deploy del `rafaq.yaml` lo hace Raf en el dashboard (Validate → Deploy), como dice el header (línea 5). Este Gate audita el CONTENIDO antes del deploy; el Validate del dashboard es un check de sintaxis/columnas adicional (fallaría si las migraciones 0107/0111/0112 no estuvieran aplicadas — ya lo están).

---

## Veredicto final

**PASS** — Los 3 streams nuevos de la capa de sync de SIGSA están correctamente scopeados. El control #1 (`sigsa_export_log` con el `file_content` que contiene todos los RFIDs del lote) usa **exactamente** el `org_scope` estándar, byte-idéntico al de los 22 streams per-establishment ya probados — **un usuario con rol solo en el campo A NO recibe el file_content del campo B en su SQLite local**. `sigsa_declarations` idem. `catalog_breed` es un catálogo público sin datos de tenant → su bucket global read-only es correcto. El schema local no materializa nada cross-tenant (el `file_content` se materializa pero gateado por el stream). `breed_id` bien tipado. No se introdujo ningún HIGH ni MEDIUM. La capa de sync del export SIGSA está lista desde la perspectiva de seguridad.

**Nota para el leader**: este Gate cierra el MEDIUM-2 de Gate 1 y el recordatorio que dejó el Gate 2 de DB (`security_code_08-sigsa-db.md:210`). El deploy del YAML al dashboard de PowerSync queda en manos de Raf (Validate → Deploy); el contenido auditado acá es el que debe pegarse, sin cambios. Verificación extra por el contexto del clasificador caído: el as-built coincide con la intención de la spec y con las migraciones ya aplicadas — no quedó nada a medio escribir.
