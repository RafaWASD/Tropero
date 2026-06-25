# Security Review — Spec 08 / capa DB (migraciones 0107-0112) — Modo: code (Gate 2)

**Fecha**: 2026-06-24
**Analista**: security_analyzer
**Skill**: `sentry-skills:security-review` (metodología: trace data flow + verify exploitability antes de reportar)
**Baseline**: `559864423de4ee53fb02d33c40dbe090481210d6` (de `progress/impl_08-sigsa-db.md:1`)
**Alcance**: las 6 migraciones de la capa DB del export SIGSA (ya aplicadas al remoto). NADA de PowerSync/servicio/UI.
**Veredicto**: **PASS**

---

## Resumen ejecutivo

**PASS — 0 HIGH nuevos, 0 MEDIUM nuevos.**

Los 6 folds de Gate 1 (HIGH-1, HIGH-2, MEDIUM-1..4) están **correctamente implementados en el AS-BUILT** y **verificados contra el remoto en vivo** (las migraciones ya están aplicadas). Las 2 redefiniciones de objetos `SECURITY DEFINER` deployados (`tg_reproductive_events_create_calf` en 0108, `register_birth` en 0109) son mínimas y preservan íntegros sus controles de seguridad: la adición de `breed_id` no introduce SQL dinámico, ni lookup no-scopeado, ni nueva superficie. El guard de idempotencia anti-IDOR de `register_birth` (HIGH-D1) y la autorización por fila real de la madre (`has_role_in`) quedan byte-idénticos al as-built previo (0075). No se introdujo ningún HIGH nuevo.

Confianza: **alta**. Cada finding cerrado se verificó por triple vía — (1) lectura del `.sql`, (2) diff contra el as-built previo, (3) query en vivo contra el catálogo de Postgres del remoto + la suite SIGSA 63/63 que ejercita los caminos como clientes PostgREST autenticados reales.

---

## Verificación de los 6 folds de Gate 1 (AS-BUILT vs remoto)

### HIGH-1 — Audit spoofing `declared_by` / `generated_by` → CERRADO en as-built

- **0111:87-101** define `tg_force_declared_by_auth_uid` (`NEW.declared_by := auth.uid()`) + trigger `sigsa_declarations_set_declared_by BEFORE INSERT`.
- **0112:78-92** idem para `tg_force_generated_by_auth_uid` + `export_log_set_generated_by BEFORE INSERT`.
- **Remoto confirmado**: ambos triggers existen, `timing=BEFORE`, `evt=INSERT`, `tgenabled=O`, ligados a las funciones force. `prosecdef=false` + `proconfig=null` — **correcto** para estos triggers (asignación trivial sobre `NEW`, sin lookup de esquema ni SQL dinámico → corren como invoker; idéntico al patrón as-built 0043/0073, no necesitan `search_path` hardening).
- **Runtime probado** (suite, no solo existencia): `run.cjs:766` T5(h) inserta `declared_by: outsider.id` como ownerA y asserta que persiste `ownerA.id` (`!= outsider.id`). `run.cjs:869` T6(h) idem para `generated_by`. **No spoofeable.**

### HIGH-2 — `file_content` / `file_name` sin tope → CERRADO en as-built

- **0112:39-41**: `CHECK (octet_length(file_content) <= 5000000)` + `CHECK (char_length(file_name) <= 255)`.
- **Remoto confirmado**: `export_log_file_content_size_chk` y `export_log_file_name_len_chk` presentes con la definición exacta.
- `octet_length` (bytes reales del TXT UTF-8) es la métrica correcta contra storage-exhaustion (no `char_length`, que subcontaría multibyte). 5 MB ≈ 138k animales/export, documentado. **Runtime**: T6(g) prueba rechazo > 5 MB y > 255.

### MEDIUM-1 — Escritura owner-only de `renspa` → CERRADO en as-built

- **0110:44-66**: RPC `update_renspa(uuid,text)` `SECURITY DEFINER SET search_path = public`, guard `IF NOT public.is_owner_of(p_establishment_id) THEN RAISE ... ERRCODE 42501` **ANTES** del UPDATE, + `REVOKE EXECUTE FROM public, anon` + `GRANT EXECUTE TO authenticated`.
- El guard corre antes del UPDATE (verificado por lectura: el `if not is_owner_of ... raise` es la primera sentencia del cuerpo; el UPDATE viene después). `is_owner_of` (0005) ya filtra `establishments.deleted_at is null`; el UPDATE re-filtra `deleted_at IS NULL` (doble guarda). Sin SQL dinámico; `p_renspa` entra bindado.
- **No se creó policy UPDATE nueva más permisiva**: la existente `establishments_update` (0007, `is_owner_of(id)`) ya bloquea cualquier UPDATE directo de no-owners vía PostgREST (T4(d)).
- **Remoto confirmado**: `update_renspa` → `prosecdef=true`, `proconfig=[search_path=public]`, EXECUTE solo a `authenticated`+`postgres` (sin `public`/`anon`).

### MEDIUM-2 — Sync rules PowerSync → FUERA DE ESTE CHUNK

T7 (PowerSync) NO está en estas 6 migraciones (`impl_08-sigsa-db.md:6` lo excluye explícitamente). El cierre documentado en Gate 1 (YAML en design.md) se verificará cuando se implemente la capa de sync. No aplica a este Gate 2.

### MEDIUM-3 — `markAsDeclared` guard de rol → FUERA DE ESTE CHUNK

T19 es capa de servicio (diferida). El control de DB que lo respalda (RLS INSERT owner/vet en `sigsa_declarations`) SÍ está en 0111 y se verifica abajo. El test de servicio se valida cuando se implemente T19.

### MEDIUM-4 — IDOR en INSERT de `sigsa_declarations` → CERRADO en as-built

- **0111:62-81**: el `WITH CHECK` tiene el triple predicado:
  1. `has_role_in(establishment_id)`,
  2. `EXISTS (user_roles ur WHERE ur.user_id=auth.uid() AND ur.establishment_id = sigsa_declarations.establishment_id AND ur.role IN ('owner','veterinarian') AND ur.active)`,
  3. `EXISTS (animal_profiles ap WHERE ap.id = sigsa_declarations.animal_profile_id AND ap.establishment_id = sigsa_declarations.establishment_id AND ap.deleted_at IS NULL)`.
- **Anclaje del EXISTS (analizado para bypass)**: el predicado 3 liga `animal_profile_id` al **mismo `establishment_id` que se está escribiendo** (igualdad de valores de la propia fila, no de la visibilidad del atacante). Un owner del campo A que envíe `(establishment_id=A, animal_profile_id=<animal de B>)` no encuentra ninguna fila en `animal_profiles` que satisfaga `id=<animal de B> AND establishment_id=A` → rechazo. La igualdad es independiente de si la RLS de `animal_profiles` muestra o no la fila de B; doble barrera (la RLS de `animal_profiles` (0022) tampoco mostraría B al atacante). **No bypasseable.**
- **Remoto confirmado**: el `check_expr` de `sigsa_declarations_insert` matchea exactamente los 3 predicados.
- **Runtime probado**: `run.cjs:780` T5(i) ejecuta el ataque cross-tenant (`establishment_id: estA, animal_profile_id: profB1`) como ownerA → asserta `error != null` Y re-consulta vía admin que la fila NO quedó (`deepEqual(data, [])`). No es false-green.

---

## Foco 1 — Redefiniciones `SECURITY DEFINER` deployadas (el punto más riesgoso)

Verifiqué por `diff` contra el as-built previo que ambas redefiniciones son mínimas y preservan los controles.

### `tg_reproductive_events_create_calf` (0108 redefine 0048)

`diff` 0048 → 0108 del cuerpo de la función = **exactamente 4 adiciones de `breed_id`**: (i) declaración `v_mother_breed_id uuid`, (ii) `p.breed_id` agregado al SELECT de la fila de la madre, (iii) columna `breed_id` en el INSERT del `animal_profiles` del ternero, (iv) valor `v_mother_breed_id`. Todo lo demás byte-idéntico. Verificado:
- `security definer` + `set search_path = public` **preservados** (0108:59-60; remoto: `prosecdef=true`, `proconfig=[search_path=public]`).
- `exception when others then raise` (rollback atómico del parto, R9.4) **preservado** (0108:114-116).
- `breed_id` se lee de la **misma fila de la madre** ya consultada (`from animal_profiles p join animals a join rodeos r where p.id = new.animal_profile_id`) → **sin query extra, sin lookup no-scopeado, sin nueva superficie**.
- Sin SQL dinámico (todo es DML estático con binds).
- Las líneas "extra" en 0048 que no están en 0108 son una **función distinta** (`tg_reproductive_events_link_birth_calf`), que 0108 correctamente NO toca.

### `register_birth` (0109 redefine 0075)

`diff` 0075 → 0109 = **4 adiciones de `breed_id`** (idéntico patrón) + `create function`→`create or replace function` (header) + **solo texto de comentarios**. Lógica byte-idéntica salvo el breed_id. Verificado el guard HIGH-D1 y la authz:
- **Guard de idempotencia anti-IDOR (HIGH-D1) INTACTO** (0109:101-115): el lookup del parto existente sigue scopeado a `re.animal_profile_id = p_mother_profile_id AND p.establishment_id = v_est` (misma madre del intent + tenant ya autorizado). NO aparece en el diff → byte-idéntico a 0075. El comentario explica por qué re-ancla en `p_mother_profile_id + v_est` (has_role_in valida la madre pasada, no la del parto colisionante).
- **Autorización por fila REAL de la madre INTACTA** (0109:80-91): `select p.establishment_id ... where p.id = p_mother_profile_id and p.deleted_at is null` → `if v_est is null raise 23503` → `if not has_role_in(v_est) raise 42501`. Corre **PRIMERO**, antes del guard y de cualquier rama. `breed_id` se agrega a **este mismo SELECT** (misma fila de la madre, sin query extra).
- **Herencia de tenant del server** (0109:161, `v_est`, no del payload) y de `breed_id` (0109:166, `v_mother_breed_id`) → ambos de la fila real de la madre, no del cliente.
- `security definer` + `set search_path = public` preservados (0109:55-56). Firma de 4 args preservada (CREATE OR REPLACE no la dropea) → `REVOKE ... FROM public, anon` + `GRANT ... TO authenticated` de 0075 siguen vigentes; 0109:193-194 los re-aplica por defensa.
- **Remoto confirmado**: `register_birth` → `prosecdef=true`, `proconfig=[search_path=public]`, EXECUTE solo `authenticated`+`postgres`.

**Conclusión foco 1**: la adición de `breed_id` no introduce ningún problema. Sin SQL dinámico nuevo, sin lookup no-scopeado, guards de seguridad intactos en ambos caminos.

---

## Foco 2 — RLS de `sigsa_declarations` (0111)

Cubierto en MEDIUM-4 arriba. El triple predicado del INSERT está completo y el EXISTS del IDOR-check está bien anclado a `establishment_id` de la propia fila. SELECT = `has_role_in(establishment_id)`. Sin UPDATE/DELETE policy (append-only). No bypasseable.

## Foco 3 — Triggers force `declared_by`/`generated_by`

Cubierto en HIGH-1. Ambos BEFORE INSERT, ignoran el payload (`NEW.col := auth.uid()`), probados en runtime (T5(h)/T6(h)). Correcto.

## Foco 4 — CHECKs de `export_log`

Cubierto en HIGH-2. `octet_length(file_content) <= 5000000` + `char_length(file_name) <= 255`, presentes en remoto, probados (T6(g)).

## Foco 5 — RPC `update_renspa`

Cubierto en MEDIUM-1. Guard `is_owner_of` antes del UPDATE, `SECURITY DEFINER SET search_path = public`, REVOKE public/anon. Correcto.

## Foco 6 — `breed_catalog` read-only

- **0107:34-44**: RLS enabled, `GRANT SELECT TO authenticated`, `GRANT ALL TO service_role`, **una sola** policy `breed_catalog_select_authenticated` (SELECT, USING true). **Sin** policy INSERT/UPDATE/DELETE.
- **Remoto confirmado**: única policy = SELECT/USING true; grants a `authenticated` = solo `SELECT` (+ defaults schema `REFERENCES/TRIGGER/TRUNCATE`). El cliente no puede mutar el catálogo. Correcto.

## Foco 7 — GRANTs (over-exposure)

**Remoto confirmado** (`information_schema.role_table_grants`):

| Tabla | authenticated | anon |
|---|---|---|
| `breed_catalog` | SELECT | (ninguno de datos) |
| `sigsa_declarations` | SELECT, INSERT | (ninguno de datos) |
| `export_log` | SELECT, INSERT | (ninguno de datos) |

- **Ningún UPDATE ni DELETE** a `authenticated`/`anon` en las 3 tablas → append-only (R11.3) reforzado a nivel grant, además de las policies ausentes. Probado en runtime (T5 R11.3: UPDATE y DELETE de cliente fallan o afectan 0 filas, fila persiste).
- `service_role` = ALL (normal y esperado: es el rol admin server-side; no llega desde el cliente Expo, que usa anon/JWT).
- `REFERENCES/TRIGGER/TRUNCATE` a `authenticated`/`anon` son los **defaults de schema de Supabase** (presentes en toda tabla del proyecto), NO privilegios sobre datos: TRUNCATE requiere ownership de la tabla, TRIGGER/REFERENCES son DDL sobre objetos propios. No explotables. No es finding.

---

## Findings HIGH de Sentry (skill)

**Ninguno.** El pase de la skill `sentry-skills:security-review` sobre el diff (con threat model: cliente Expo attacker-controlled escribiendo a PostgREST/PowerSync; RLS + CHECK + force-triggers como única capa autoritativa) no arrojó findings HIGH-confidence. Las categorías evaluadas y su resultado:

- **Authorization / IDOR (CWE-639/862)**: el INSERT de `sigsa_declarations` tiene object-level check (predicado 3 ancla `animal_profile_id` al `establishment_id` de la fila). No IDOR.
- **Mass assignment (CWE-915)**: `declared_by`/`generated_by` son los únicos campos sensibles atacables por over-posting; el force-trigger los sobrescribe. El resto de columnas escribibles (`establishment_id`, `animal_profile_id`, `file_content`, etc.) están gateadas por RLS WITH CHECK + CHECK constraints. No mass-assignment explotable.
- **Injection (SQL/dynamic)**: ninguna de las funciones usa SQL dinámico (`EXECUTE`/`format`/concatenación). Todo DML estático con binds. `search_path=public` fijado en las 3 SECURITY DEFINER. No injection.
- **Storage exhaustion / DoS (CWE-770)**: cubierto por los CHECK de tamaño (`octet_length`/`char_length`).
- **Privilege escalation vertical**: el predicado owner/vet del INSERT (predicado 2) impide que `field_operator` declare/exporte (T5(c)/T6(c)).

## Findings RAFAQ-SPECIFIC

**Ninguno.** Los chequeos RAFAQ-específicos (RLS testeada cross-tenant, triggers SECURITY DEFINER bypasseables, secrets hardcodeados/logueados, service-role bypass) no arrojaron problema:
- RLS testeada cross-tenant: sí (T5(e/f/i), T6(d)).
- Triggers SECURITY DEFINER: los 2 redefinidos preservan `search_path`+guards; los 2 force NO son SECURITY DEFINER (correcto).
- Secrets: ninguno en estas migraciones. Sin `console.log`/`raise notice` que filtre datos sensibles (los `raise exception` usan mensajes genéricos + ERRCODE, sin volcar valores de usuario).
- Service-role bypass: no hay Edge Functions nuevas en este chunk; el único uso de privilegio elevado son las 3 SECURITY DEFINER, todas con guard de rol propio (`is_owner_of`/`has_role_in`).

## False positives descartados (para trazabilidad)

| Observación | Por qué NO es finding |
|---|---|
| Force-triggers sin `SET search_path` | Asignación trivial `NEW.col := auth.uid()` sin lookup de esquema ni SQL dinámico; corren como invoker (`prosecdef=false`). Idéntico al as-built 0043/0073. `search_path` injection no es reachable. |
| `breed_id` FK puede apuntar a raza bubalina inactiva | Integridad de datos (edge case post-MVP bovino), no vector de ataque. `breed_catalog` es catálogo global read-only; no hay cross-tenant leak. Ya anotado como LOW en Gate 1 (F6). |
| `reproductive_events.breed_id` nullable sin path de población | Columna forward-compat; nada la lee en MVP (el código RAZA del TXT sale de `animal_profiles.breed_id` del ternero). Reconciliación documentada, no superficie de ataque. |
| `user_roles_insert_self_owner` permite auto-grant de owner | Propiedad pre-existente de spec-01 (0008); estas 6 migraciones NO tocan policies de `user_roles`. Los 2 primeros predicados del INSERT heredan esa confianza, pero el predicado 3 (IDOR) es independiente y cierra el cross-tenant. Fuera de scope de este Gate 2. |
| `REFERENCES/TRIGGER/TRUNCATE` a authenticated/anon | Defaults de schema de Supabase, no privilegios de datos; TRUNCATE requiere ownership. No explotable. |

---

## Tabla de inputs (campos server-side de la capa DB)

| Campo | Límite | Validación (server/cliente/ausente) | OK? |
|---|---|---|---|
| `establishments.renspa` | 1-20 chars (CHECK `chk_establishments_renspa_length`, 0110) | Server (CHECK DB + RPC guard `is_owner_of`) | OK |
| `export_log.file_content` | 5 MB (`octet_length <= 5000000`, 0112) | Server (CHECK DB autoritativo, confirmado en remoto) | OK |
| `export_log.file_name` | 255 chars (`char_length <= 255`, 0112) | Server (CHECK DB autoritativo, confirmado en remoto) | OK |
| `export_log.generated_by` | Forzado a `auth.uid()` (trigger BEFORE INSERT) | Server (no spoofeable, T6(h)) | OK |
| `sigsa_declarations.declared_by` | Forzado a `auth.uid()` (trigger BEFORE INSERT) | Server (no spoofeable, T5(h)) | OK |
| `sigsa_declarations.animal_profile_id` | FK + EXISTS verifica pertenencia al `establishment_id` | Server (WITH CHECK, T5(i)) | OK |
| `animal_profiles.breed_id` / `reproductive_events.breed_id` | FK a `breed_catalog(id)` | Server (FK constraint) | OK |
| `tag_electronic` (RFID 15 dígitos) | NO validado en esta capa DB | n/a en este chunk — la validación de formato es capa pura T9/T10 + gate duro de export (documentado en Gate 1) | n/a — fuera de scope |

**Nota RFID**: el formato 15 dígitos del RFID NO se valida en estas 6 migraciones. Es correcto y esperado: vive en la capa pura (T9/T10, ya done y aprobada en `security_code_08-sigsa-capa-pura.md`) + el gate duro de formato al exportar. Documentado y aceptado en Gate 1. No es un gap de este chunk.

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| INSERT `export_log` / `sigsa_declarations` | n.a. | n/a | n/a | Mutación DB-local vía PostgREST/PowerSync; sin Edge Function nueva, sin email/SMS/API externa. El abuse vector (storage) está cubierto por los CHECK de tamaño, no por rate limit. |
| RPC `update_renspa` / `register_birth` | n.a. | n/a | n/a | RPC SECURITY DEFINER local; sin costo por request externo. Gateadas por rol. |

**Conclusión rate limits**: este chunk NO introduce ninguna Edge Function ni vector de API externa nuevo. El flujo es 100% DB-local. Ninguna acción nueva requiere rate limit adicional. (Confirmado: el único costo de abuso a escala es storage, mitigado por CHECK.)

---

## Archivos analizados

- `supabase/migrations/0107_breed_catalog.sql`
- `supabase/migrations/0108_animal_profiles_breed_id.sql`
- `supabase/migrations/0109_reproductive_events_breed_id.sql`
- `supabase/migrations/0110_establishments_renspa.sql`
- `supabase/migrations/0111_sigsa_declarations.sql`
- `supabase/migrations/0112_export_log.sql`

Soporte (para grounding de exploitability, NO en scope de cambios): `0005_rls_helpers.sql` (`has_role_in`/`is_owner_of`), `0008_rls_membership.sql` (`user_roles` policies), `0022_rls_animals_and_profiles.sql` (`animal_profiles` RLS), as-built previo `0048`/`0075` (diff de las redefiniciones), `supabase/tests/sigsa/run.cjs` (assertions de runtime).

Diff confirmado: `git diff --name-only 559864423de4ee..HEAD` vacío + `git status --porcelain` lista las 6 migraciones como untracked-new (trabajamos sobre `main`, sin feature-branch). Scope exacto.

---

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: N/A — este chunk no tiene Edge Functions. La skill de Sentry no las cubriría, pero no hace falta.
- **RLS**: la skill de Sentry no entiende nativamente RLS de Postgres. **Cobertura por revisión manual** (este informe) + suite SIGSA (clientes PostgREST autenticados reales) + verificación en vivo del catálogo de Postgres del remoto. Las policies fueron leídas, su exploitability trazada (anclaje del EXISTS, predicados owner/vet) y probada en runtime.
- **PowerSync sync rules (T7)**: **NO cubierto — fuera de este chunk** (diferido). Es autorización PARALELA a RLS: cuando se implemente T7, una sync rule laxa replicaría `file_content` (TXT con RFIDs) cross-tenant al SQLite local aunque la RLS de DB esté perfecta. **Revisión manual obligatoria en el Gate 2 de la capa de sync** (el cierre de MEDIUM-2 en Gate 1 definió el YAML `org_scope`; hay que verificar que el as-built de `rafaq.yaml` lo respete). Lo dejo señalado explícitamente para el leader.

---

## Veredicto final

**PASS** — Los 6 folds de Gate 1 están bien implementados en el AS-BUILT y verificados contra el remoto en vivo. Las 2 redefiniciones SECURITY DEFINER son mínimas y preservan sus controles (guard idempotencia HIGH-D1, authz por fila real, rollback atómico, search_path). No se introdujo ningún HIGH ni MEDIUM nuevo. La capa DB del export SIGSA está lista desde la perspectiva de seguridad.

**Recordatorio para el leader**: el gate de PowerSync (T7) queda pendiente — cuando se implemente la capa de sync, correr un Gate 2 específico sobre las sync rules de `sigsa_declarations`/`export_log` (el `file_content` con RFIDs es el dato más sensible de la feature; su scope de sync es el control crítico que esta capa DB NO cubre).
