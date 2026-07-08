# Gate 1 (ADR-019) — Security spec: delta `identificadores-unificados`

**Modo**: `spec` · **Feature**: spec 02 + spec 09 delta Nivel B · **Auditor**: security_analyzer (Opus 4.8)
**Fecha**: 2026-07-08
**Input**: `context/requirements/design/tasks-identificadores-unificados.md`
**Skill Sentry**: `sentry-skills:security-review` — metodología (trace data-flow + verify exploitability) aplicada manualmente sobre la spec + verificación contra los objetos DB reales del remoto (migraciones `0021/0022/0032/0036/0039/0079/0083/0095/0096/0121`). La skill es code-oriented; a nivel spec el trazado se hizo a mano contra el schema vigente.

---

## VEREDICTO: NEEDS_CLARIFICATION

Los **6 focos** del design §13 (drop del trigger de identidad, `register_birth` sin fallback, re-create de RPC, canal de búsqueda por apodo, orden de deploy, drop de columna) **pasan con evidencia** — el modelo server-side de aislamiento y anti-spoof queda intacto y coherente. **Un único bloqueante**: el tercer identificador (**apodo**), que este delta promueve a identificador de primera clase (buscable + hero + warning), **no tiene límite ni charset autoritativos server-side** — su formato (≤10 + charset) vive sólo en el sanitizer de cliente. Por la regla dura de Raf ("límite claro + validación server-side en CADA campo de entrada para aprobar"), no puede PASS sin una decisión explícita en Puerta 1.

---

## Findings HIGH

Ninguno. Los focos 1/2/3/5/6 se auditaron contra los objetos DB reales y **no** abren hueco de tenant/authz/injection. Detalle de la verificación en "Dominios revisados".

---

## Findings MEDIUM

### M1 — Apodo: cap (10) y charset son client-only; el servidor no acota el campo `apodo` más allá del tope genérico de 4096 bytes

**Requisitos/diseño afectados**: IDU.1.3, IDU.5.1; design §5 (`sanitizeApodoInput`).

**Evidencia**:
- El formato del apodo (letras+dígitos+espacios+guiones, cap 10) se define y aplica **sólo** en `sanitizeApodoInput`, que el propio design §5 declara cliente/UX:
  > "Filtra en vivo (onChangeText) — PREVENIR, no errorear."
  Y se cablea vía la prop `sanitize?` de `CustomFieldInput` (`data_key==='apodo'`) — es decir, en el `onChangeText` del RN. **Attacker-controlled** (bypasseable pegando directo a PostgREST).
- Server-side, el apodo es un `custom_attributes.value` de `ui_component='text'`. La única validación autoritativa es `assert_custom_value_valid` (`0096`), y para `text` sólo verifica el **tipo**:
  ```sql
  elsif v_uic in ('text','date') then
    if jsonb_typeof(p_value) <> 'string' then
      raise exception 'custom value for % must be string' ... using errcode = '23514'; end if;
  ```
  → **no** hay cap de 10 caracteres ni restricción de charset para `data_key='apodo'`.
- El único respaldo server-side es el CHECK genérico de `0095`: `custom_attributes_value_size check (octet_length(value::text) < 4096)`. O sea: un caller con `has_role_in(establishment_id)` puede escribir en `apodo` **hasta ~4096 bytes de cualquier UTF-8** (símbolos, control chars, emoji, `%`/`_`/comillas, etc.).

**Contraste con los otros 2 identificadores** (por qué esto destaca): `idv` y `tag_electronic` SÍ tienen tope autoritativo server-side — CHECK de largo `≤64` (`0070`), índices únicos (`animal_profiles_idv_unique`, `animals_tag_unique`), inmutabilidad (`0036`), identidad forzada (`0079`), y cap `≤15` explícito en los RPC (`register_birth` L102). El apodo es el único de los 3 sin control server-side de formato.

**Exploitabilidad (por qué MEDIUM y no HIGH)**:
- **Cross-tenant**: NO — RLS `has_role_in(establishment_id)` en `custom_attributes` (`0095`) + `establishment_id` forzado desde el perfil por trigger. Sólo se escribe en campos donde el caller tiene rol.
- **Injection**: NO — el `value` almacenado es dato, nunca patrón: la búsqueda lo matchea como *heno* con `LIKE ? ESCAPE '\'` (término escapado), y la UI lo renderiza en `<Text>` de RN (sin ejecución HTML/JS → sin XSS).
- **Storage/DoS**: acotado a 4096 bytes por el CHECK genérico.
- Queda como **gap de validación de input / integridad de dato**: un apodo de 4096 bytes o con caracteres arbitrarios se convierte en el **hero** (lista + ficha) y en el heno de búsqueda. Degrada UX/consistencia, no es un exploit directo.

**Ask para Puerta 1 (decisión de Raf — elegir una)**:
- **(a) Cerrar server-side** (recomendado por coherencia con idv/tag): agregar validación autoritativa del apodo. Opciones de implementación: extender `assert_custom_value_valid` con una rama apodo-específica por `data_key='apodo'` (cap 10 + charset), o un CHECK/constraint dedicado. Requiere una regla apodo-específica en el gating (el design ya reconoce que el apodo "no es la validación genérica de custom fields").
- **(b) Aceptar el riesgo, documentado**: dejar el apodo con enforcement sólo-cliente + backstop de 4096 bytes, justificando en la spec que es un campo **soft, opt-in, por-campo, sin injection y tenant-scoped** (perfil de riesgo bajo, a diferencia del idv que cae en la superficie SIGSA). Si se elige esto, agregar el EARS de aceptación de riesgo a IDU.5 para que quede trazable y no se relea como olvido en 6 meses.

> Nota: no es una regresión introducida por el delta (el apodo custom ya era client-capped antes), pero **este** delta es el que formaliza el límite del apodo (IDU.1.3/IDU.5.1) y lo promueve a identificador buscable/hero → es el lugar correcto para resolver el server-cap.

---

## Focos del design §13 — resultado con evidencia (todos PASS)

### Foco 1 — Drop del trigger `animal_profiles_identity_check`: COMPLETITUD, no tenant/authz ✓
`0021`/`0039` (`tg_animal_profiles_identity_check`): el cuerpo sólo hace `coalesce(nullif(trim(v_tag),''), nullif(trim(new.idv),''), nullif(trim(new.visual_id_alt),'')) is null → raise 23514 'animal must have at least one of tag_electronic, idv or visual_id_alt'`. Lee `animals.tag_electronic` (vía `security definer`) **sólo** para chequear presencia — no filtra por establishment ni por rol. Es una **regla de completitud de dato**. Quitarla habilita "0 identificadores de usuario"; **no** habilita ver/escribir datos de otro campo. La identidad server-side sigue forzada por el anti-spoof `tg_force_animal_identity_on_profile` (`0079`, **no se toca**) y la unicidad del idv por `animal_profiles_idv_unique` (**no se toca**). **Sin hueco.**

### Foco 2 — `register_birth` sin fallback: seguro por coherencia atómica ✓
Verificado contra el cuerpo **vigente** (`0121`). El diff del design §2 es fiel: (a) quita `v_visual_fallback`, (b) quita `visual_id_alt` de la lista de columnas del INSERT (L119), (c) quita la expresión `case ... v_visual_fallback` (L126). Se conserva TODO lo demás: `has_role_in(v_est)` (L60, authz-first, 42501), idempotencia por `client_op_id` (L62-70), cota de fecha (L72-74), cap tag ≤15 (L102), herencia `breed_id` (`v_mother_breed_id`, L127), atomicidad (una sola función). El fallback era **load-bearing sólo para el trigger de completitud** (comentarios de `0121` L22-27 lo confirman) → quitarlo es seguro **porque el trigger se elimina en la MISMA migración** (`0122`, `begin/commit`, IDU.2.7). Una cría both-null persiste con `idv`/`tag` NULL sin 23514. `CREATE OR REPLACE` (misma firma 6-arg) **preserva grants**; el re-emit `revoke public,anon` + `grant authenticated` es defensa redundante. **Coherente y seguro.**

### Foco 3 — Re-create de `create_animal`/`import_rodeo`/`transfer_animal`/reportes: fail-closed ✓ (con watch de Gate 2)
`create_animal` (`0083`) verificado: `SECURITY DEFINER` + `set search_path = public` + `has_role_in` PRIMERO (42501) + guards anti-IDOR post-insert + grants fail-closed (`revoke ... from public, anon; grant ... to authenticated`). El design mantiene ese patrón. `import_rodeo`/`transfer_animal` = `CREATE OR REPLACE` (firma intacta → grants preservados). `create_animal` y reportes (`0106`) = **DROP+CREATE** (cambia firma / `RETURNS TABLE`), con re-grant en la nueva firma (design §3/§4).
- **Watch para Gate 2 (no bloquea spec)**: un `DROP+CREATE` en Postgres **resetea** `EXECUTE` a `PUBLIC` por default → el `revoke public/anon` + `grant authenticated` con **la lista exacta de tipos de la firma NUEVA** es OBLIGATORIO. Si el implementer se equivoca en un tipo de la firma del `grant`, la sentencia apunta a una función inexistente (o deja la real con `PUBLIC EXECUTE`). El code-review de Gate 2 debe verificar: (1) `create_animal` re-grantea con la firma sin `p_visual_id_alt` (19 args), (2) las 2 funciones de reportes re-grantean con su nuevo `RETURNS TABLE`, (3) las 4 siguen `SECURITY DEFINER` + `set search_path=public`.

### Foco 4 — Canal de búsqueda por apodo: scopeado + parametrizado ✓
`buildApodoSearchQuery` (design §7): `JOIN custom_attributes/field_definitions/animal_profiles` con `WHERE fd.data_key='apodo' AND fd.establishment_id IS NOT NULL AND ap.establishment_id = ? AND ap.deleted_at IS NULL AND ap.status='active' AND ca.value LIKE ? ESCAPE '\'`.
- **Tenant**: doble barrera — `ap.establishment_id = ?` en la query + RLS `has_role_in(establishment_id)` sobre `custom_attributes` (`0095`) + la stream `est_custom_attributes` per-establishment + el hecho de que la búsqueda corre sobre el **SQLite local** (sólo contiene datos de los campos que el usuario sincroniza). Un `ca` sólo matchea cuando su perfil está en el establishment activo. **Sin fuga cross-tenant.**
- **Injection**: `data_key='apodo'` es literal constante (no input). El término va parametrizado (`?`) y escapado por el helper **verificado** `escapeLike` (`local-reads.ts` L871-873: `replace(/[\\%_]/g, ...)` + `ESCAPE '\'`). La columna del `buildSearchLikeQuery` es whitelist, no input. **Sin injection.**
- Lista (§8) y warning-soft (§9) usan el **mismo** scope `ap.establishment_id = ?` → IDU.5.7 (por campo) cubierto.

### Foco 5 — Orden de deploy (§11): estado intermedio fail-closed ✓
PASO 1 (frontend + schema PowerSync dejan de leer/escribir/proyectar la columna, tolerando que exista) → PASO 2 (migración dropea trigger + re-crea RPC + dropea columna). En el intervalo, el server conserva la columna + los RPC viejos (que la escriben con NULL) y ningún cliente la lee/manda → **cero ventana rota**. El único borde es **skew de versión de cliente** (una app sin actualizar que llame `create_animal` con `p_visual_id_alt` tras el drop del param → PostgREST no encuentra la firma → error → el alta queda en la outbox y reintenta al actualizar). Eso es **disponibilidad, no seguridad**, y **fail-closed** (sin pérdida ni corrupción: la outbox es durable). **Sin hueco de seguridad en la ventana.**

### Foco 6 — Drop de la columna vs. RLS ✓
`0022` verificado: `animal_profiles_select/insert/update` y `animals_select/insert/update` se apoyan en `has_role_in(establishment_id)` / `deleted_at is null` / `EXISTS animal_profiles` — **ninguna** referencia a `visual_id_alt`. El drop no rompe RLS. Los dependientes que Postgres auto-dropea (CHECK `animal_profiles_local_id_check` no-op, CHECK `..._len_chk`, índice trgm `..._visual_alt_trgm`) no aportan garantía de seguridad (la completitud la daba el trigger; la unicidad del idv la da el índice intacto).

---

## Tabla de inputs (campo que el usuario tipea)

| campo | límite (largo/charset) | validación | OK? |
|---|---|---|---|
| `idv` (Caravana Visual) | ≤15 alfanum (UI) / ≤64 (server) | cliente `sanitizeIdvInput` + **server** CHECK `≤64` (0070) + índice único + inmutabilidad (0036) + identidad forzada (0079) | ✅ server-autoritativo (tope UI más estricto que el server, aceptable) |
| `tag_electronic` (Caravana Electrónica) | 15 díg (UI) / ≤64 (server) | cliente + **server** CHECK `≤64` (0070) + cap `≤15` en RPC (register_birth L102) + único global + inmutabilidad | ✅ server-autoritativo |
| `apodo` (Nombre/Apodo) | 10 + charset (UI) / **sólo 4096 bytes genérico (server)** | **solo-cliente** `sanitizeApodoInput`; server valida sólo `type=string` (0096) + backstop 4096 bytes (0095) | ⚠️ **cap/charset NO server-autoritativos → M1** |
| término de búsqueda (general / cría al pie / maniobra manual) | cap `SEARCH_TERM_MAX_LENGTH=64` (query builder) | término escapado (`escapeLike`) + parametrizado + `LIMIT 20`; corre sobre SQLite local (tenant-scoped por sync) | ✅ injection-safe, acotado (ver nota LOW sobre `buildApodoSearchQuery` LIMIT) |

---

## Tabla de rate limits (acciones abusables tocadas por el delta)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Búsqueda por los 3 (general / cría al pie / maniobra) | n.a. | — | — | Corre sobre **SQLite local** (PowerSync), sin round-trip al server. Sin superficie de abuso remota; acotada por term cap 64 + LIMIT 20. |
| `register_birth` / `create_animal` / `import_rodeo` / `transfer_animal` (re-created) | n.a. (sin cambio) | — | — | RPC existentes; el delta sólo les quita `visual_id_alt`, **no** cambia su perfil de rate ni expone superficie nueva. `import_rodeo` no se re-expone (mismo endpoint). Rate limiting de estos RPC = deuda pre-existente, fuera del scope de este delta. |
| Escritura del apodo (`custom_attributes`) | n.a. (sin cambio) | — | — | Camino de escritura custom existente (outbox → PATCH/RPC). El delta no agrega un endpoint. El único gap es de **validación** (M1), no de rate. |

**Conclusión rate**: el delta **no** toca Edge Functions, ni email/SMS, ni API externa, ni un endpoint bulk/import nuevo → rate limiting **no aplica** a este delta (no hay superficie abusable server nueva). Documentado para trazabilidad.

---

## Dominios revisados (Catálogo RAFAQ)

- **A1 (service-role bypass RLS)**: los RPC re-creados son `SECURITY DEFINER` (bypassean RLS) → verificados con scoping manual `has_role_in(establishment_id)` PRIMERO (register_birth L60, create_animal L83). ✓
- **A2 (mass assignment)**: los RPC arman los INSERT campo por campo (no spread de body); `establishment_id`/`created_by`/identidad denormalizada se **fuerzan** server-side (0043/0079), no vienen del cliente. ✓
- **A3/A4 (IDOR / BFLA)**: `create_animal` tiene guards anti-IDOR post-insert (L119-129, L160-168); authz por rol (`has_role_in`) parita con la policy INSERT. ✓
- **B1 (information disclosure)**: los RPC lanzan errcodes de dominio (23505/23514/42501) con mensajes genéricos, sin `err.message` crudo. ✓
- **B3 (over-fetch column-level)**: el canal apodo proyecta `LocalListRow` explícito (no `SELECT *`); `visual_id_alt` deja de proyectarse. ✓
- **C (offline/sync)**: la búsqueda/lista/hero/warning son lecturas locales; el scope de tenant viaja en las sync-rules (gestionadas por Raf) + `ap.establishment_id=?`. El drop de la columna del schema local es tolerante (PowerSync ignora columnas server ausentes del schema local). ✓ — nota de coordinación: si las sync-rules referencian `visual_id_alt` explícito, Raf las actualiza (design §11).
- **E1 (queries sin tope)**: term cap 64 + LIMIT 20 en las ramas existentes; ver LOW-1 sobre el LIMIT del canal apodo.
- **F1 (PostgREST/LIKE filter injection)**: término escapado + parametrizado + `data_key` constante. ✓
- **Validación de inputs**: ver tabla — **M1** (apodo) es el único gap.

## Dominios excluidos (con justificación)

- **A (Edge Functions)**: el delta no toca `supabase/functions/*` — sólo migración SQL + PowerSync + frontend RN. N/A.
- **D (secretos/supply chain)**: sin secrets nuevos, sin imports Deno nuevos, sin cambios de bundle de credenciales. N/A.
- **E2/E3/E4 (denial-of-wallet / bot / enumeration)**: sin endpoints de costo, captcha, ni respuestas de enumeración nuevas. N/A.
- **F2/F3/F4 (import archivos / SSRF / XSS email)**: el delta toca el mapeo de import sólo para **quitar** una columna (no agrega parser, fetch ni template de email). N/A.
- **G (BLE)**: el flujo "Bastonear" sigue solo-electrónica (IDU.4.9); no cambia el trust boundary BLE. N/A.
- **H (auth/sesión) / I (compliance/mobile)**: sin cambios de auth, sesión, retención ni hardening mobile. N/A.

---

## Anexo LOW (no bloquea; watch-list para Gate 2 / implementer)

- **LOW-1 — `buildApodoSearchQuery` sin `LIMIT` explícito**: el design §7 no muestra `LIMIT` (las otras ramas de búsqueda usan `LIMIT 20`, `local-reads.ts` L846). Es una lectura **local** (no DoS de server), pero por consistencia y para acotar el heno de un rodeo grande, el canal apodo debería llevar el mismo `LIMIT`. Verificar en Gate 2.
- **LOW-2 — `drop function ... tg_reproductive_events_create_calf() cascade` (design §4, 1b)**: `0032` crea la función **y** un trigger `reproductive_events_create_calf` sobre `reproductive_events` (L70-72). El leader verificó por `pg_trigger` que el trigger ya está dropeado (register_birth tomó la creación de crías) → la función es huérfana y el `cascade` no dropea nada extra. **Pero** si por drift el trigger siguiera vivo, `cascade` lo dropearía **en silencio**. El design ya manda "PARAR y avisar" si el implementer lo encuentra atado. Reforzar en Gate 2: verificar `pg_trigger` vacío al aplicar, o dropear el trigger por nombre explícito antes de la función (más auditable que `cascade`). No es objeto de seguridad (no RLS/authz) → LOW.
- **LOW-3 — skew de versión de cliente en el drop del param de `create_animal`** (ya cubierto en Foco 5): disponibilidad, no seguridad, y fail-closed. Se registra por completitud.

---

## Cobertura de la skill

`sentry-skills:security-review` es code-oriented (diff-based). A nivel **spec** el trazado data-flow + exploitability se hizo **manual** contra el schema DB vigente (migraciones citadas). **No cubierto por skill a nivel spec** (revisión manual aplicada): PowerSync sync-rules (C1 — dependen del deploy que gestiona Raf), triggers/RLS Postgres, y el modelo de identidad forzada (0079). Gate 2 (code) debe correr la skill sobre el diff real (migración `0122` + `local-reads.ts` + connector + frontend), con foco en: (1) los re-grants fail-closed de los DROP+CREATE (Foco 3 watch), (2) el escaping real de `buildApodoSearchQuery`, (3) si se resuelve M1 por (a), la nueva validación server-side del apodo.
