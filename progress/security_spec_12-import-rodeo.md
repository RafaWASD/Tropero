# Gate 1 (security_spec) — Feature 12: Importación masiva de rodeo

**Modo**: `spec`
**Fecha**: 2026-06-06
**Input revisado**: `specs/active/12-import-rodeo/{requirements,design,context}.md`
**As-built verificado contra**: migraciones reales `0003`, `0005`, `0015`, `0019`, `0020`, `0021`, `0022`, `0029`, `0043`, `0058`, `0059`, `0070` + `supabase/config.toml` + `app/src/services/animals.ts`.

---

## Veredicto: **PASS**

0 findings HIGH. La spec define límite + validación autoritativa server-side para cada input del archivo, fuerza los campos sensibles server-side de forma no-spoofeable, y la verificación del as-built confirma que TODAS las afirmaciones del design sobre las migraciones existentes son correctas. Hay **4 findings MEDIUM** y **1 LOW** que el leader debería folear como ajustes antes de cerrar la Puerta 1, pero ninguno bloquea (ninguno es un hueco explotable con el diseño actual). La recomendación de seguridad es **Escenario A** (ver §Recomendación).

---

## Verificación del as-built (todas las afirmaciones del design CONFIRMADAS)

| Afirmación del design | Verificado | Resultado |
|---|---|---|
| `0005` define solo `has_role_in(est)` e `is_owner_of(est)`, sin `has_role(role,est)` genérico | `0005_rls_helpers.sql` L9-48 | **CORRECTO** — solo esos dos helpers; ambos `security definer stable`, EXECUTE revocado de public |
| `user_roles` tiene `(user_id, establishment_id, role, active)` | `0003_user_roles.sql` L17-25 | **CORRECTO** — columnas exactas; `role` es enum `user_role` (`owner`/`field_operator`/`veterinarian`); unique-activo por `(user_id, establishment_id) where active` |
| Predicado inline `veterinarian` de la policy INSERT de `import_log` | design §2.2 L123-129 | **CORRECTO** — `ur.user_id=auth.uid() and ur.establishment_id=import_log.establishment_id and ur.role='veterinarian' and ur.active=true` mapea 1:1 al schema de `0003`. Nombres de columna y valor de enum válidos. |
| Trigger `tg_force_created_by_auth_uid` (`0043`) fuerza `created_by=auth.uid()` ignorando el payload | `0043_animal_profiles_created_by.sql` L15-29 | **CORRECTO** — SIEMPRE sobreescribe (no "solo si NULL"); BEFORE INSERT sobre `animal_profiles`. R9.3 se apoya bien en él. |
| CHECK char_length de `0070`: `idv`≤64, `visual_id_alt`≤64, `breed`≤64, `tag_electronic`≤64, `notes`≤4000, `entry_origin`≤120 | `0070` L185-199 | **CORRECTO** — todos presentes con esos topes exactos. Ver MEDIUM-1 (matiz NOT VALID en tag). |
| `animals_tag_unique` global (`tag_electronic is not null and deleted_at is null`) | `0019_animals.sql` L22-24 | **CORRECTO** |
| `animal_profiles_idv_unique` por `(establishment_id, idv)` parcial | `0020_animal_profiles.sql` L51-53 | **CORRECTO** |
| `animal_profiles_active_animal_unique` (un perfil activo por animal) | `0020` L56-58 | **CORRECTO** |
| Catálogo `categories_by_system` post-Tier-2: 12 codes incl. `novillito`/`novillo` | `0015` L31-42 (10) + `0059` L17-21 (2) | **CORRECTO** — los 12 codes de R10.3 existen |
| Patrón de RPC SECURITY DEFINER con EXECUTE revocado (precedente Escenario B) | `0058_delete_account_tx` L53-54 + smoke-check L56+ | **CORRECTO** — `revoke all from public, authenticated, anon` + grant solo service_role + smoke-check fail-closed. Es el patrón exacto que R9.4/§6-B debe seguir. |
| `escapeIlike` existe (defensa filter-injection reusable) | `animals.ts` L346 | **CORRECTO** |

**Hallazgo adicional (refuerza el PASS, no en el design): trigger `tg_animal_profiles_rodeo_check` (`0021` L25-43).**
La spec afirma R9.2 ("`rodeo_id` destino pertenece al establecimiento activo, aun si el cliente lo intentara"). Verificado: existe un trigger BEFORE INSERT OR UPDATE sobre `animal_profiles` que rechaza con `errcode 23514` si el `rodeo_id` no pertenece a `establishment_id` (o el rodeo está inactivo/soft-deleted). **R9.2 está enforced a nivel DB de forma no-bypasseable, en AMBOS escenarios** (no depende del RPC). Igual para `tg_animal_profiles_identity_check` (L6-22 → R5.1 ≥1 identificador) y `tg_animal_profiles_category_check` (L46-63 → R10.3/R10.5 category∈system). El cliente no puede saltearse ninguno: son la capa autoritativa real.

---

## Mandato ampliado — tabla de inputs (cada campo del archivo)

Por CADA campo importable: ¿límite claro? ¿validación autoritativa server-side (DB/trigger/constraint), no solo cliente?

| Campo del archivo | Límite | Validación autoritativa server-side | OK? |
|---|---|---|---|
| `tag_electronic` (TAG/RFID) | char_length ≤64 (`0070`, NOT VALID pero enforça inserts) + unicidad global (`animals_tag_unique`) + formato cliente `isValidTag` 15díg FDX-B (R4.5) | DB: CHECK largo + unique global. Formato 15-díg NO está en DB (decisión explícita `0070` L60-63 / R1.49). | **Sí** (largo+unicidad en DB; formato es cliente — aceptable, ver MEDIUM-3) |
| `idv` | char_length ≤64 (`0070`) + unique `(establishment_id, idv)` (`0020`) | DB: CHECK + unique parcial | **Sí** |
| `visual_id_alt` | char_length ≤64 (`0070`) | DB: CHECK | **Sí** |
| `sex` | enum `male`/`female` (`animals.sex` CHECK `0019` L11) + mapeo tolerante R4.3 | DB: CHECK `sex in ('male','female')` | **Sí** |
| `birth_date` | tipo `date` (`0019` L12), nullable, parse cliente R4.4 | DB: tipo date (rechaza no-fecha) | **Sí** |
| `breed` (texto libre) | char_length ≤64 (`0070`) | DB: CHECK | **Sí** |
| `category` (columna→code) | FK a `categories_by_system` + trigger `category∈system` (`0021` L46-63) | DB: FK NOT NULL + trigger | **Sí** |
| `lote` (→management_group por nombre) | match contra `management_groups` existentes; no crea (R10.4) → NULL si no matchea | DB: FK nullable; el match es lookup server-controlled | **Sí** |
| `file_name` (`import_log`) | char_length ≤255 (CHECK propuesto §2.2 L85) | DB: CHECK propuesto | **Sí** (ver MEDIUM-2: justificar 255) |
| `error_details` (jsonb, `import_log`) | octet_length ≤262144 (CHECK propuesto §2.2 L87) | DB: CHECK propuesto octet_length | **Sí** |
| `establishment_id` | NO viene del archivo — forzado del `EstablishmentContext` (R9.1) | Trigger `rodeo_check` ata est↔rodeo; RLS scopea | **Sí (forzado, no spoofeable)** |
| `imported_by` / `created_by` | NO viene del archivo — forzado `auth.uid()` (triggers `0043` + `tg_force_imported_by_auth_uid` propuesto) | Trigger BEFORE INSERT sobreescribe | **Sí (forzado, no spoofeable)** |

**Conclusión de inputs**: cada campo que entra del archivo tiene (a) límite claro y (b) validación autoritativa server-side (CHECK / unique / FK / trigger / tipo de columna). El cliente (`parse-csv`, `normalize-row`, `validate-rows`) es barrera de UX/perf; la DB es la capa final (R9.5). **Cumple el requisito de Raf** ("límites claros y validación en cada formulario/entrada"). No hay campo que llegue a la DB sin un constraint que lo acote.

---

## Tabla de rate limits / anti-DoW (acciones abusables tocadas)

| Acción abusable | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Subir archivo (parse) | Tope tamaño 5MB (R3.1) + tope filas 5000 con cap durante parseo (R3.2/R3.3) | per-corrida (cliente) | Sí (rechaza-y-reporta, no trunca) | Cap ANTES de materializar evita OOM/freeze. Es defensa de cliente. |
| Escritura batch (N inserts) | Topes R3 + chunks ~100-200/req (§3.1) + dedup en lote con `= any()` (§3.2, 1 query por lote no por fila) | per-corrida | n.a. | Acotado por el tope de 5000 filas. Ver MEDIUM-4: no hay límite de **corridas/hora** server-side. |
| `import_log` insert | RLS owner/vet only; sin cuota por hora | per-user/establishment (RLS) | Sí (RLS) | Una corrida fallida igual escribe un `import_log` (R11.1) → un atacante podría spamear logs (acotado a su propio tenant). MEDIUM-4. |

**Conclusión rate-limit**: los topes R3 (tamaño + filas + chunks) acotan el COSTO de UNA corrida y son la defensa principal de DoW por archivo gigante — adecuados para MVP online de setup. NO hay rate-limit server-side de **frecuencia de corridas** (cuántos imports/hora puede disparar un owner/vet autenticado). El riesgo es bajo (atacante autenticado, scopeado a su propio tenant, costo acotado por chunk), por eso es MEDIUM y no HIGH — pero conviene anotarlo (ver MEDIUM-4). El Auth nativo (`config.toml` `[auth.rate_limit]`) no se toca en esta spec — correcto, no aplica.

---

## Findings MEDIUM (ajustes recomendados, no bloquean)

### MEDIUM-1 — El CHECK de `tag_electronic` es `NOT VALID sin validate`: R9.5 debe afirmar que igual enforça inserts del import
**Evidence**: `0070` L185 — `animals_tag_electronic_len_chk ... not valid` (sin `validate constraint`, grandfather de basura e2e, documentado L177-184). R9.5 lo cita como "capa autoritativa final".
**Por qué importa**: un lector apurado de R9.5 podría creer que un CHECK `NOT VALID` no enforça nada. NO es el caso: Postgres saltea solo la validación de filas EXISTENTES; TODO INSERT futuro (incluido el del import) queda capeado (el propio `0070` L25-30 lo explica). El control existe y aplica al import. Pero la spec no lo dice, y un implementer podría "arreglar" el `NOT VALID` o no testear el caso.
**Fix**: en R9.5 (o design §2.1 L59), agregar una línea: "el CHECK de `animals.tag_electronic` es `NOT VALID` (grandfather de e2e, `0070`) pero IGUAL enforça los inserts del import — no requiere cambio; un test debe confirmar que un tag >64 del archivo es rechazado por la DB". Es nota de claridad, no cambio de control.

### MEDIUM-2 — `import_log.file_name` ≤255 y `error_details` ≤256KB: faltan R explícitas que aten los topes propuestos en el SQL
**Evidence**: design §2.2 L85/L87 propone `import_log_file_name_len_chk (char_length ≤255)` y `import_log_error_details_size_chk (octet_length ≤262144)`. R11.4 solo menciona el tope de `error_details` ("CHECK octet_length"), sin valor; R11 NO menciona un tope para `file_name`.
**Por qué importa**: `file_name` viene del cliente (nombre del archivo subido, attacker-controlled) y se escribe sin límite si la R no lo exige — un nombre de 1MB es storage abuse menor pero real. El valor 256KB de `error_details` no está justificado contra el peor caso (5000 filas × detalle por fila): conviene verificar que 256KB alcanza para el reporte de 5000 errores o que el cliente lo trunca antes.
**Fix**: (a) agregar a R11.4 (o R11.1) que `file_name` se topa server-side con CHECK char_length (≤255 está bien); (b) fijar el valor de `error_details` en la R (256KB) y especificar que si el detalle excede el tope, el cliente lo trunca/resume (ej. "primeras N filas con error + conteo") antes de insertar, para no chocar el CHECK y abortar el `import_log` (lo que perdería el audit). Sin esto, un import con miles de errores podría fallar al escribir su propio audit.

### MEDIUM-3 — Escenario A no enforça owner/vet a nivel DB para `animals`/`animal_profiles`: R2.4 se apoya solo en el cliente para la escritura del padrón
**Evidence**: `0022` L9-11 `animal_profiles_insert ... with check (has_role_in(establishment_id))` — **cualquier rol activo, incluido `field_operator`, puede insertar perfiles**. `0022` L31-32 `animals_insert ... with check (auth.uid() is not null)`. La policy de `import_log` SÍ restringe a owner/vet (§2.2 L115-131), pero las escrituras de `animals`/`animal_profiles` del Escenario A NO.
**Por qué importa**: R2.4 dice "únicamente owner/veterinarian pueden importar". En Escenario A, un `field_operator` que bypassea la UI (POST directo a PostgREST) PUEDE insertar `animal_profiles` en su establecimiento — la RLS as-built no se lo impide. El `import_log` con su policy owner/vet no cubre la escritura real (un field_operator podría escribir animales sin dejar `import_log`, o el insert de `import_log` falla pero los animales ya entraron). Esto NO es cross-tenant (sigue scopeado por `has_role_in`), por eso es MEDIUM y no HIGH: el field_operator solo puede escribir en SU propio tenant, donde ya tiene permiso de alta individual (spec 02/09 también dejan a field_operator insertar perfiles). O sea: el "import" no le da un poder cross-tenant nuevo; le da una vía masiva de algo que el modelo as-built ya le permite unitariamente.
**Fix**: decisión consciente, dos opciones — (a) **aceptar** que en Escenario A el gate de rol owner/vet es solo UI + el `import_log` (el field_operator no gana poder nuevo, solo escala lo que ya puede); documentarlo explícito en R2.4/design §6-A como límite conocido. (b) Si se quiere R2.4 enforced a nivel DB para la escritura masiva, ESO es exactamente lo que da el **Escenario B** (el RPC re-valida `is_owner_of OR veterinarian` adentro antes de insertar). Es un argumento de seguridad a favor de B que la spec no destaca. Recomiendo (a) para MVP + nota, porque el riesgo real es bajo (ver Recomendación).

### MEDIUM-4 — Sin rate-limit de frecuencia de corridas de import (DoW por reintentos autenticados)
**Evidence**: R3 topa tamaño/filas/chunks de UNA corrida; nada en R3/R11/§4 limita cuántas corridas/hora puede disparar un owner/vet. `config.toml [auth.rate_limit]` no cubre Edge Functions ni PostgREST batch.
**Por qué importa**: un owner/vet autenticado (o credenciales robadas) puede disparar imports de 5000 filas en loop → 5000 × N inserts/corrida × M corridas. Está scopeado al propio tenant y acotado por chunk, pero es costo de DB amplificable. Cada corrida fallida igual graba un `import_log` (R11.1) → spam de audit.
**Fix**: para MVP, **aceptable sin rate-limit dedicado** (atacante autenticado, mismo-tenant, costo por corrida acotado por R3). Anotar en design §4 (tabla de riesgo DoW) que el rate-limit de FRECUENCIA queda fuera de MVP y se evalúa si el import pasa a Edge Function/RPC server-side (donde un contador per-establishment/hora sería el lugar natural — patrón a futuro). No bloquea; es trazabilidad de un control diferido conscientemente.

---

## Anexo LOW

### LOW-1 — Pre-check de dedup de TAG: falso-negativo por RLS (consistencia, no seguridad)
El pre-check de TAG (§3.2 L200-203) hace `select tag_electronic from animals where deleted_at is null and tag_electronic = any($tags)`. La RLS `animals_select` (`0022` L21-29) solo deja ver animals donde el user tiene rol en algún profile → el pre-check **NO leakea TAGs de otros tenants** (bien, confirmado: no hay info-disclosure cross-tenant). Efecto colateral: si un TAG ya pertenece a un animal de OTRO establecimiento, el pre-check no lo ve (falso negativo), el insert real choca contra `animals_tag_unique` global, y R8.4 lo captura como error de carrera (skip+report). Es consistencia correcta-por-diseño, no un hueco. La spec ya lo cubre (R8.4). Solo se documenta para que el implementer no se sorprenda del falso-negativo ni intente "arreglarlo" leyendo `animals` con service-role (lo que SÍ sería un leak cross-tenant — NO hacerlo).

---

## Recomendación de seguridad: Escenario A (con las notas de MEDIUM-3)

Desde la óptica de seguridad, **Escenario A (inserts directos)** es la opción recomendada para MVP:

- **Menor superficie**: el delta de DB es solo `import_log` (tabla scoped nueva, revisión liviana). NO introduce un SECURITY DEFINER nuevo que saltee RLS por-fila.
- **Reusa controles ya gateados**: `animals_insert`/`animal_profiles_insert` + los 3 triggers de `0021` (rodeo∈est, identity, category∈system) + `tg_force_created_by` (`0043`) ya enforçan R9.2/R9.3/R5.1/R10.3 a nivel DB, sin código nuevo que auditar.
- **R9.1/R9.2 NO dependen del RPC**: el trigger `rodeo_check` ata est↔rodeo en cualquier caso → el archivo no puede dirigir escritura cross-tenant ni en A ni en B.

El **único argumento de seguridad a favor de B** es MEDIUM-3 (B enforça owner/vet a nivel DB para la escritura masiva; A lo deja en UI+`import_log`). Pero ese gap es de bajo riesgo (field_operator escala lo que YA puede hacer unitariamente, mismo-tenant; no gana poder cross-tenant). No justifica, por sí solo, adoptar un SECURITY DEFINER masivo con la superficie de auditoría que eso agrega.

**Si Raf elige B** (por atomicidad/perf, no por seguridad), el design §6-B + R9.4 ya enumeran los 5 controles correctos (re-valida `is_owner_of OR veterinarian`, valida `rodeo∈est`, fuerza `establishment_id`/`created_by`/`imported_by` server-side, `EXECUTE` revocado de public/anon/authenticated con grant solo a... — ojo: si lo llama el cliente directo debe ser `authenticated`, no service_role; ver nota abajo, enforça topes/unique). El precedente exacto está en `0058`. En ese caso, Gate 2 (code) debe verificar el smoke-check fail-closed de grants como en `0055`/`0058`.

> **Nota para el implementer si se adopta B**: `0058` revoca EXECUTE de `authenticated` porque ese RPC lo llama el EDGE con service_role. El RPC de import (§6-B) lo llamaría el CLIENTE directo → necesita `grant execute to authenticated` (NO service_role-only) y la re-validación de rol owner/vet ADENTRO es lo que lo hace seguro (no el grant). Esta diferencia con el patrón de `0058` debe quedar explícita en la migración para que el reviewer/Gate 2 no la marque como error.

---

## Dominios de seguridad revisados (trazabilidad)

- **A1 service-role bypass**: N/A en Escenario A (no usa `createAdminClient`). El dedup de TAG global se lee con la RLS del usuario, NO con service-role (confirmado §3.2) → sin bypass. ✓
- **A2 mass assignment**: cubierto — el censo escribe campos whitelisted (R10.1/R10.2); `establishment_id`/`imported_by`/`created_by`/`rodeo_id` forzados server-side, no del archivo (R9.1-R9.4 + triggers `0021`/`0043`). ✓
- **A3 IDOR por FK**: `rodeo_id` validado ∈ establishment por trigger `rodeo_check` (`0021`); `category_id` ∈ system por `category_check`. ✓
- **A4 function-level authz**: R2.4 owner/vet (ver MEDIUM-3 para el matiz Escenario A). ✓ con nota
- **B1 information disclosure**: N/A — no hay Edge Function que devuelva `err.message` crudo (es flujo cliente↔PostgREST). El reporte de errores por fila es del propio archivo del usuario, no de otro tenant. ✓
- **B3 over-fetching column-level**: el pre-check de TAG lee SOLO la columna `tag_electronic` (§3.2 L206), no datos de otro tenant, y la RLS lo scopea igual. ✓
- **C offline/sync**: N/A — import es online por diseño, PowerSync no entra (R12). ✓
- **E1 queries sin tope**: topes R3 (5MB/5000) + chunks + dedup en lote. ✓ (ver MEDIUM-4 para frecuencia)
- **E2 denial-of-wallet**: sin endpoint de costo externo (no email/SMS/API). DoW por DB acotado por R3. ✓
- **F1 PostgREST filter-injection**: el dedup usa `.eq`/`= any($array)` (valores parametrizados), NO `.or()`/`ilike` con texto del archivo → no aplica. R3.5 además exige neutralizar metacaracteres si algún valor tocara un filtro. ✓
- **F2 import de archivos (CVE/formula/zip-bomb)**: `.xlsx` fuera de MVP (CVEs SheetJS) — CSV+TXT solo (§4, D1). CSV se trata como texto, no se reexporta a Excel → sin formula-injection efectiva (§4.4). Cap de filas/celdas antes de materializar (R3.3) → sin zip/row-bomb OOM. ✓
- **F3 SSRF**: N/A — no hay `fetch()` a URL del usuario. ✓
- **H2/H3 auth**: N/A — la spec no toca auth/sesiones/tokens. ✓
- **I2 audit tamper**: `import_log` append-only, `imported_by` forzado (R11.3). ✓

## Dominios excluidos (con justificación)

- **C (PowerSync/Realtime/data-at-rest)**: excluido — import es online, no sincroniza, no toca SQLite local (R12.1/R12.2). Justificado por diseño.
- **D (secrets/supply chain)**: parcial — `.xlsx`/SheetJS sacado del MVP justamente por CVEs (cubierto en F2). Sin secrets nuevos (no Edge Function nueva en MVP). Si se agrega `papaparse` (§4 alternativa), Gate 2 debe verificar pin de versión + `deno.lock`/lockfile.
- **G (BLE)**: N/A — el import no toca el transporte BLE; reusa solo `isValidTag`/`normalizeTag` como funciones puras (R4.5).
- **H1 (invalidación de sesión)**: N/A — el import no cambia roles ni revoca membresías.
- **I1 (retención/borrado)**: N/A — el import crea datos, no borra; el `delete_account` es otra feature.
