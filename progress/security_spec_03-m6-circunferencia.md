# Gate 1 (security modo `spec`) — Spec 03 / chunk M6 (Circunferencia escrotal) — delta backend

> **Veredicto: PASS.** Sin findings HIGH. 2 MEDIUM (no bloquean la Puerta 1; anotados para el implementer) + 1 LOW. El delta M6-BACKEND reusa fielmente los primitivos de seguridad ya gateados (`0077` anti-spoof, `0056` session tenant-check, `0054` gating fail-closed, patrón RLS de M5 `custom_measurements`) y no introduce vectores cross-tenant / fail-open / anti-spoof nuevos. Habilitado para la Puerta 1.

**Fecha**: 2026-06-17 (sesión 27). **Modo**: `spec` (diseño, NO código aplicado — no hay `.sql` todavía).

**Alcance auditado**: `design.md` §12 (12.1–12.8, foco en §12.3 tabla/RLS/triggers, §12.4 data_key+seed+gating, §12.5 sync) + `requirements.md` US-14 (R14.1–R14.18) + `context-m6-circunferencia-escrotal.md` (Gate 0).

**NO auditado**: M1-M5 (ya gateados — M5 PASS en `security_spec_03-m5-custom.md`), spec-08/SIGSA (otra terminal), cliente M6-C.0..C.2 (frontend → Gate 2).

**Metodología**: cada bloque SQL de diseño se trazó contra el **as-built real** (no contra la prosa del spec): `0077` (`tg_force_establishment_id_from_profile`), `0056`/`0052` (`tg_event_session_tenant_check`), `0054` (`assert_data_keys_enabled`), `0025`/`0028` (tablas de evento tipadas + `event_source` + RLS), `0043` (force `created_by`), `0093` (guard custom de `field_definitions` + sus CHECKs de tabla), `0094` (RLS de `custom_measurements` = el precedente post-M5 contra la columna denorm), `0005` (`has_role_in`/`is_owner_of`), `0023` (`establishment_of_profile`), `0018` (catálogo). Precedente espejado: `security_spec_03-m5-custom.md` (RE-GATE PASS).

---

## FOCOS VERIFICADOS OK (no son findings) — trazabilidad

Antes de los MEDIUM, dejo asentado lo que verifiqué a fondo y **pasa**. Es el corazón del Gate 1 (fail-closed / cross-tenant / anti-spoof), así que va exhaustivo.

### Foco 1 — RLS tenant de `scrotal_measurements` (§12.3, R14.15) — OK

Las 3 policies (design.md l.1568-1574):
```sql
select  using (has_role_in(establishment_id) and deleted_at is null);
insert  with check (has_role_in(establishment_id));
update  using (is_owner_of(establishment_id) or recorded_by = auth.uid())
        with check (is_owner_of(establishment_id) or recorded_by = auth.uid());
```

- **No es una divergencia del patrón** (mi sospecha inicial era que `weight_events` `0025` deriva el tenant por FK `has_role_in(establishment_of_profile(animal_profile_id))`, no por la columna denorm). **Resuelto**: M6 espeja el patrón **post-M5**, no el de spec 02. `custom_measurements` (`0094` l.57-62, ya gateado PASS) usa **exactamente** RLS contra la columna denorm `has_role_in(establishment_id)` + `establishment_id` forzado por trigger desde el perfil. M6 = misma fórmula. El `establishment_id` que ve el `with check` del INSERT es el **ya forzado** por el trigger (BEFORE INSERT corre antes del RLS WITH CHECK) → un INSERT con `animal_profile_id` de otro tenant termina con el `establishment_id` del perfil real y `has_role_in` lo rechaza. Cross-tenant cerrado.
- **SELECT**: `has_role_in(establishment_id) and deleted_at is null` — un `userB` sin rol activo en el establishment ve 0 filas. Paridad `0094`/`0025`. ✓
- **UPDATE (corrección R14.17) — NO es IDOR**: `using (is_owner_of(establishment_id) or recorded_by = auth.uid())`. Es **más estricto** que `custom_measurements` (que permite a cualquier rol, DM5-3) y espeja **exacto** `weight_events` (`0025` l.40-45: `is_owner_of(...) or created_by = auth.uid()`). Un tercero (rol operativo no-owner que no grabó la fila) NO puede editar/soft-deletear: `is_owner_of` exige owner activo y `recorded_by = auth.uid()` ata la fila al grabador real. Cross-tenant imposible (ambos helpers chequean los roles del caller contra el establishment de la fila). Append-only correction sound. ✓
- Test declarado: M6-B.5 (a) RLS tenant + (h) corrección append-only (owner/`recorded_by` sí, tercero no). ✓

### Foco 2 — Anti-spoof de columnas forzadas (§12.3, R14.9) — OK

- **`establishment_id`**: reusa **literalmente** `tg_force_establishment_id_from_profile` (`0077`), trigger `before insert or update` (design.md l.1551-1553). Verificado contra `0077` l.53-71: deriva `establishment_id` del `animal_profiles` real del `new.animal_profile_id`, **ignora el payload** (`new.establishment_id := v_est`), y si el perfil no existe → `raise 23503`. El `before insert OR UPDATE` cierra el vector "pisar la columna con un UPDATE por PostgREST directo" (mismo criterio que `0077` documenta como crítico para el WAL, l.22-31). Spoof de `establishment_id` desde el cliente = imposible (INSERT y UPDATE). ✓
- **`recorded_by`**: `tg_scrotal_force_recorded_by` (design.md l.1539-1548), `before insert` only, `new.recorded_by := auth.uid()`. Espeja el patrón "siempre sobreescribe" de `0043` (`tg_force_created_by_auth_uid`), **más** hardening que `0043`: M6 declara `security definer set search_path = public` + `revoke execute ... from public, authenticated, anon` (l.1540, 1545) — cumple SEC-HIGH-01. INSERT-only es correcto: `recorded_by` se fija en la creación y NO se re-pisa en la corrección (si lo corrige el owner, no queremos cambiar el grabador). Spoof de `recorded_by` = imposible. ✓
- **Orden `SET NOT NULL` tras el trigger — sin ventana de NULL**: `alter ... set not null` (l.1556) corre en la MISMA migración, **después** de crear el trigger force (l.1551-1553) y **antes** de cualquier INSERT de cliente (la tabla nace vacía, sin backfill — es tabla nueva). El trigger BEFORE INSERT siempre setea `establishment_id` no-NULL antes de que el constraint se evalúe. Cero ventana de NULL. Paridad con el orden de `0077` (ADD nullable → trigger → SET NOT NULL), que ahí incluso tenía backfill y no rompió. ✓
- **Orden de firing de los 4 triggers BEFORE INSERT — sin hazard**: PostgreSQL los dispara alfabético por nombre: `scrotal_force_establishment_id` < `scrotal_force_recorded_by` < `scrotal_gating` < `scrotal_measurements_session_tenant_check`. Ni el gating ni el session-check leen las columnas forzadas (`tg_scrotal_gating` y `tg_event_session_tenant_check` resuelven todo desde `new.animal_profile_id`/`new.session_id`, verificado en `0054` l.33-65 y `0052` l.27-77) → el orden no importa. Las columnas forzadas solo las consume el RLS WITH CHECK, que corre DESPUÉS de todos los BEFORE triggers → ve los valores forzados. ✓

### Foco 3 — Gating capa 2 FAIL-CLOSED (§12.4, R14.11/R14.12) — OK

- `tg_scrotal_gating` (design.md l.1615-1624) invoca `assert_data_keys_enabled(new.animal_profile_id, array['circunferencia_escrotal'])`. **Reusa el helper de `0054`** (no crea uno nuevo). Verificado contra `0054` l.33-65 que el helper es **fail-closed por construcción**:
  - rodeo no resoluble (perfil inexistente **o `deleted_at IS NOT NULL`**) → `raise 23514`, NUNCA pasa (l.42-46). **No hay early-return fail-open.** ✓
  - data_key faltante / no-enabled → `v_have < v_need` → `raise 23514` (l.60-64). ✓
- Single-key (`array['circunferencia_escrotal']`) entra limpio en el assert genérico (igual que `tg_weight_events_gating` con `['peso']`, `0054` l.73-82). ✓
- **Independiente de la UI / no-bypass por rol** (R14.12, defensa en profundidad): es un trigger `BEFORE INSERT` server-side → un INSERT directo por PostgREST/sync sobre un rodeo sin `circunferencia_escrotal` enabled se rechaza aunque la UI nunca lo ofreciera. SECURITY DEFINER + EXECUTE revocado (l.1616, 1621) → no es RPC, no se puede invocar suelto. ✓
- Perfil soft-deleted → `select ... where deleted_at is null` no encuentra fila → `v_rodeo IS NULL` → `23514`. Fail-closed ante perfil soft-deleted confirmado. ✓
- Test declarado: M6-B.5 (c) gating fail-closed (enabled OK / disabled `23514` / soft-deleted `23514` / no-bypass `service_role`). ✓

### Foco 4 — `session_id` tenant-check (§12.3, reuso de `0056`) — OK (con nota de cobertura → MEDIUM-2)

- El design reusa `tg_event_session_tenant_check` (design.md l.1563-1565). **Verificación pedida explícitamente por el spec_author** ("Gate 1 debe verificar que el trigger no asume columnas que `scrotal_measurements` no tenga"): trazado contra `0052` l.27-77 — la función lee **solo** `new.session_id` (l.36) y `new.animal_profile_id` (l.40, 43), **ambas presentes** en `scrotal_measurements`. No toca ninguna columna específica de tabla (no lee `weight_kg`, `event_type`, etc.). El reuso es estructuralmente sano → **no hace falta clonar** `tg_scrotal_session_tenant_check` (la DM6-divergencia "reuso vs clon" se resuelve a favor de reuso). ✓
- La función valida cross-tenant (sesión de otro establishment → `23514`), intra-tenant a (sesión no-`active` → `23514`), intra-tenant b (rodeo del animal ≠ rodeo de la sesión → `23514`). `session_id NULL` → `return new` (carga desde ficha, legítimo, R14.10). Cubre el vector "colar un `session_id` de otro tenant/sesión/rodeo". ✓
- **Sutileza de la forma del trigger — verificada, NO es un bug**: M6 usa `before insert or update` (SIN `of session_id`), l.1564. `0056` existió **precisamente** para arreglar un bug donde `before insert or update OF session_id` **no disparaba en INSERT** (`0056` l.5-9). La forma de M6 (sin la lista de columnas `OF`) **sí dispara en INSERT** (es la forma del trigger `_ins` del split de `0056`) y además dispara en todo UPDATE (más amplio que `before update of session_id`, pero más amplio = más seguro, solo re-valida de más). **Confirmado que la forma de M6 NO recae en el bug de `0052` que `0056` arregló.** ✓ → ver MEDIUM-2 por la falta de test, no por la forma.

### Foco 5 — Seed del data_key GLOBAL (§12.4a, R14.18) — OK

El INSERT del data_key global (`establishment_id NULL`) corre como migración (`0099`, service_role, `auth.uid()` NULL). Verifiqué que **NO abre un camino de cliente** para insertar `field_definitions` globales y **NO relaja** los guards de M5:

- **El guard `tg_field_definitions_custom_guard` (`0093`) NO bloquea el seed**: su primera rama `if auth.uid() is null then return new` (`0093` l.87-89) deja pasar el seed por migración. Un **cliente** authenticated sigue rechazado: `establishment_id is null → 42501` (`0093` l.92-95) + la policy INSERT exige `establishment_id is not null` (`0093` l.166-169). El seed no le abre nada al cliente. ✓
- **El seed satisface TODOS los CHECKs de tabla que `0093` aplica a las filas globales** (trazado fila por fila, igual que el RE-GATE de M5 hizo contra `0018`):
  - `field_definitions_data_type_valid` (TODAS las filas): seed usa `data_type='maniobra'` ∈ set permitido → no aborta. ✓
  - `field_definitions_data_key_slug` (`^[a-z0-9_]+$`): `circunferencia_escrotal` es lowercase+underscore → no aborta. ✓
  - `field_definitions_data_key_len` (≤64): `circunferencia_escrotal` = 23 chars → no aborta. ✓
  - `field_definitions_description_len` (≤500): "Medida de aptitud reproductiva del toro (cm)" ~44 chars → no aborta. ✓
  - `field_definitions_label_len` (≤80): "Circunferencia escrotal" = 23 → no aborta. ✓
  - `field_definitions_custom_ui_component_valid` (`establishment_id is null OR ...`): seed `establishment_id=null` → primer disyunto true → no evalúa el `IN` → no aborta (queda libre para `numeric_stepped`, que de hecho está en el set). ✓
  - `field_definitions_custom_category_len` (`establishment_id is null OR ...`): null → exenta → no aborta. ✓
- **El UNIQUE parcial de `data_key` (`0093` l.38-39, `field_definitions_data_key_global WHERE establishment_id is null`) NO se viola**: `circunferencia_escrotal` es nuevo (verificado: grep sobre `supabase/` → 0 ocurrencias previas). Una sola global por data_key se preserva. ✓
- El seed en `system_default_fields` (cría, `default_enabled=true`, `required_for_system=false`) no toca RLS ni catálogos globales de cliente. ✓
- Test declarado: M6-B.2 verifica "NO rompe el UNIQUE parcial doble"; M6-B.5 (d) binding-test + (e) seed cría. ✓

### Foco 6 — Funciones SECURITY DEFINER nuevas — OK

- `tg_scrotal_force_recorded_by` (l.1540): `security definer set search_path = public` + `revoke execute ... from public, authenticated, anon` (l.1545). ✓
- `tg_scrotal_gating` (l.1616): `security definer set search_path = public` + `revoke execute ...` (l.1621). ✓
- Ninguna es RPC (ambas son funciones de trigger `returns trigger`, EXECUTE revocado). Paridad SEC-HIGH-01 / R13.24. ✓
- (`tg_force_establishment_id_from_profile` y `tg_event_session_tenant_check` se reusan tal cual de `0077`/`0052` — ya tienen `search_path=public` + EXECUTE revocado, verificado.) ✓

### Foco 7 — Frontera WAL del sync (§12.5, R14.16) — OK

```yaml
ev_scrotal_measurements:
  with: org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
  queries: - SELECT * FROM scrotal_measurements WHERE establishment_id IN org_scope AND deleted_at IS NULL
```
- **Paridad exacta** con `ev_weight_events`/`ev_condition_score_events`: denorm `establishment_id IN org_scope`, JOIN-free, filtra `deleted_at IS NULL`. ✓
- `org_scope` con `active = true` → un device cuyo usuario no tiene rol activo en el establishment NO recibe las filas de CE de ese campo (frontera WAL). La revocación de rol (trigger `0076` → `active=false`) saca al device del scope. ✓
- El `establishment_id` que el stream filtra es el **forzado** (Foco 2) → no se puede inyectar una fila a un scope ajeno por el WAL. ✓
- Test declarado: M6-B.5 (g) frontera WAL (espejo `sync_streams/run.cjs`). ✓

### Foco 8 — Caps de input autoritativos server-side — OK (con 1 nota → LOW)

| input | cap server-side | dónde | OK |
|---|---|---|---|
| `circumference_cm` | `numeric(4,1)` + `CHECK >= 20 and <= 50` | tabla (l.1519) | ✓ autoritativo, espeja rango de rueda R14.5 |
| `age_months` | `int` + `CHECK (null or (>= 0 and <= 600))` | tabla (l.1520) | ✓ nullable correcto (snapshot R14.8); 600 meses = 50 años, holgado pero acotado |
| `notes` | `CHECK (null or char_length <= 500)` | tabla (l.1527) | ✓ paridad `0070`/`custom_measurements` |
| `measured_at` | `date not null`, **sin cota de rango** | tabla (l.1521) | ver LOW-1 |
| `session_id` | FK + tenant-check (Foco 4) | l.1559-1565 | ✓ |
| `establishment_id`/`recorded_by` | forzados por trigger (Foco 2) | l.1546-1553 | ✓ no son input |

Todos los inputs que el cliente tipea/elige (`circumference_cm`, `age_months`, `notes`) tienen cap autoritativo server-side (CHECK de DB). El cliente Expo escribe por CRUD-plano → PostgREST → el CHECK es la capa autoritativa (el sanitizador de la rueda en RN es UX, bypasseable). ✓

---

## FINDINGS

### Sin findings HIGH.

Trazadas todas las cadenas cross-tenant / fail-open / anti-spoof contra el as-built, ninguna queda abierta. El delta reusa primitivos ya gateados (M5 PASS + spec 02/15 done) sin relajarlos.

---

### M6-SEC-01 (MEDIUM) — el data_key de la CE nace `required_for_system = false`, pero el gating capa 2 es single-key AND-trivial → un rodeo con la CE **deshabilitada** rechaza la escritura; verificar que el cliente (capa 1) y el seed no dejen un hueco de UX donde la maniobra se ofrece pero el INSERT se rechaza

**Dónde**: `design.md` §12.4 (seed `default_enabled=true, required_for_system=false`) + §12.1 (gating capa 1 cliente) + R14.18.

**No es un hueco de seguridad** (el gating capa 2 fail-closed es correcto y es justo lo que queremos): es un riesgo de **fail-closed sobre-disparado** que puede degradar a un rechazo de sync silencioso si la capa 1 (cliente) y la capa 2 (DB) divergen para un rodeo donde el operario deshabilitó `circunferencia_escrotal`. El seed lo deja `default_enabled=true` en cría → la capa 1 lo ofrece por default; si el owner lo apaga por rodeo (`rodeo_data_config.enabled=false`), la capa 1 debe dejar de ofrecerlo (R1.4/R5.3) **y** la capa 2 lo rechazará (`23514`). Si la capa 1 tiene un desalineamiento (p.ej. cachea el config viejo), el INSERT se rechaza post-sync y cae al surfacing R10.8.

**Por qué MEDIUM (no LOW)**: el surfacing de rechazos (R10.8, §12.5 nota) **depende** de que `scrotal_measurements` esté en `MANEUVER_TABLE_LABELS` para que el rechazo permanente sea visible. El design lo contempla (l.1650), pero es un tweak de cliente que vive en M6-CLIENTE (Gate 2) — si se olvida, un rechazo de gating de CE quedaría **invisible** (el operario cree que guardó y no). Es defensa-en-profundidad correcta del lado DB; el riesgo es de observabilidad del rechazo, no de fuga.

**Remediación** (para el implementer, se cierra en M6-CLIENTE/Gate 2, NO bloquea Gate 1):
- Confirmar que M6-B.4 efectivamente agrega `MANEUVER_TABLE_LABELS['scrotal_measurements'] = 'Circunferencia escrotal'` y que `isManeuverRejection` la incluye (el banner 🔴 manga nombra el rechazo).
- Agregar a M6-B.5 / e2e un test: deshabilitar `circunferencia_escrotal` en el rodeo → la capa 1 NO ofrece la CE (R1.4) **y** un INSERT directo se rechaza `23514` (R14.12) **y** el rechazo se superficia (R10.8). Cierra el loop capa1↔capa2↔surfacing.

**Trazabilidad**: R14.11, R14.12, R14.18, R10.8.

---

### M6-SEC-02 (MEDIUM) — la suite no-bypass M6-B.5 NO declara un test explícito del `session_id` tenant-check sobre `scrotal_measurements`

**Dónde**: `tasks.md` M6-B.5 (casos a–h) + `design.md` §12.3 nota tenant-check.

**Evidencia**: M6-B.5 cubre RLS tenant (a), audit forzado (b), gating fail-closed (c), binding (d), seed (e), range CHECK (f), WAL (g), corrección append-only (h). **No hay un caso que pruebe** que un `session_id` de otra sesión cross-tenant / de una sesión cerrada (`status≠'active'`) / de un rodeo distinto al del animal sea **rechazado** (`23514`) en `scrotal_measurements`. El trigger ESTÁ cableado (Foco 4, reuso correcto de `0056`), pero el reuso de un trigger genérico sobre una tabla nueva **sin test propio** es exactamente el tipo de regresión silenciosa que `0056` documenta (un trigger mal-formado que "pasaba SIN validar al insertarse — bypass total", `0056` l.8-9). Como M6 elige `before insert or update` (forma distinta a las dos del split de `0056`), **un test de no-bypass del INSERT sobre esta tabla es la única garantía de que la forma elegida dispara**.

**Por qué MEDIUM (no HIGH)**: analíticamente la forma de M6 SÍ dispara en INSERT (verificado en Foco 4) y la función es correcta; el riesgo es de **regresión no cubierta**, no de hueco actual. Pero dado el precedente exacto de `0052→0056` (donde la forma del trigger sí causó un bypass total que solo cazó la suite T2.6), exigir el test es proporcional.

**Remediación** (anotada para el implementer en M6-B.5, NO bloquea Gate 1):
- Agregar a `supabase/tests/scrotal/run.cjs` un caso (i) **session tenant-check**: (1) `session_id` de otra establishment → reject `23514`; (2) `session_id` de una sesión `status≠'active'` → reject `23514`; (3) `session_id` de un rodeo distinto al rodeo real del animal → reject `23514`; (4) `session_id NULL` (carga desde ficha) → OK. Espejo del test de orden de cierre T2.6 de las 5 tablas de evento.
- Verificar en ese test que el trigger **dispara en INSERT** (no solo en UPDATE) — es la garantía contra recaer en el bug de `0052`.

**Trazabilidad**: R5.11 (session_id), R14.9, R7.4 (tenant-safe).

---

## ANEXO — LOW (no bloqueante, mejora de consistencia)

### LOW-1 — `measured_at` sin cota de rango de fecha (acepta futuro lejano / pasado absurdo)

`measured_at date not null` (l.1521) no tiene `CHECK` de rango → admite `9999-12-31` o `1900-01-01`. **No lo escalo a finding** porque es **paridad exacta con el as-built**: `weight_events.weight_date`, `condition_score_events.event_date` (verificado `0028` l.11) son también `date not null` **sin cota**. Un absurdo en `measured_at` no cruza tenants, no fuga, no bypassea gating — solo ensucia la tarjeta de tendencia (R14.14) de ese animal (intra-tenant, dato de baja calidad). Marcar M6 como FAIL por esto sería inconsistente con la convención del proyecto y un false-positive de escalado.

**Sugerencia opcional** (si el equipo quiere endurecer la convención de fechas de evento de forma transversal — fuera de M6): un `CHECK (measured_at <= now()::date + interval '1 day')` evitaría fechas futuras, pero debería aplicarse a las 5 tablas de evento por consistencia, no solo a CE → es una decisión de convención, no de M6. Anotar en `docs/backlog.md` si interesa.

---

## Tabla de inputs (cada campo que el usuario tipea/elige en el delta M6-BACKEND)

| campo | límite (largo/charset/formato/rango) | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `circumference_cm` (rueda) | `numeric(4,1)` + CHECK 20–50 | server (CHECK de DB) | ✅ |
| `age_months` (rueda meses, snapshot) | `int` + CHECK 0–600, nullable | server (CHECK de DB) | ✅ |
| `notes` (texto libre) | CHECK ≤500 | server (CHECK de DB) | ✅ |
| `measured_at` (date) | `date not null`, sin cota de rango | server parcial (NOT NULL + tipo `date`; sin rango) | ⚠️ LOW-1 (paridad as-built) |
| `session_id` (FK, no tipeado — del contexto) | FK + tenant-check `0056` | server (FK + trigger) | ✅ |
| `establishment_id` / `recorded_by` | forzados por trigger (no son input) | server (trigger anti-spoof) | ✅ |
| data_key `circunferencia_escrotal` (seed, no input de cliente) | satisface todos los CHECK de `0093` | server (migración service_role) | ✅ |

Todos los campos que el operario realmente tipea/gira (`circumference_cm`, `age_months`, `notes`) tienen cap autoritativo server-side. `measured_at` sin cota = LOW por paridad.

## Tabla de rate limits (acciones abusables tocadas por el delta M6-BACKEND)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| INSERT `scrotal_measurements` (cualquier rol con `has_role_in`) | no | n.a. | n.a. | CRUD-plano offline-first (captura encolada offline → sync). Un rate limit server-side no aplica al modelo (igual que weight_events/custom_measurements). Abuso real = storage, acotado por CHECK (`numeric(4,1)`, `notes ≤500`) + RLS por establishment. **n.a. justificado.** |
| Sync stream `ev_scrotal_measurements` (PowerSync) | no (lo maneja PowerSync) | per-establishment (`org_scope`) | sí (scope vacío → 0 filas) | No es Edge Function custom; bucket model de PowerSync acota el fan-out. |

M6-BACKEND no manda email/SMS, no pega a API externa, no es bulk/import → **ninguna Edge Function que requiera rate limit propio**. La superficie abusable real es storage, cubierta por los caps. ✓

---

## Dominios revisados (catálogo RAFAQ — trazabilidad)

- **A1 service-role / RLS bypass**: N/A — M6 no crea Edge Functions ni usa `createAdminClient()`. Las funciones nuevas son triggers SECURITY DEFINER con EXECUTE revocado (Foco 6). ✓
- **A2 mass assignment / over-posting**: `establishment_id`/`recorded_by` forzados por trigger (Foco 2); `circumference_cm`/`age_months`/`notes`/`measured_at` acotados por CHECK; el cliente NO manda `establishment_id`/`recorded_by` (el write-path §12.4 los omite). ✓
- **A3 IDOR por FK** (`animal_profile_id`, `session_id`): `establishment_id` derivado del perfil real → RLS rechaza cross-tenant; `session_id` con tenant-check (Foco 4). ✓
- **A4 BFLA / function-level authz**: INSERT cualquier rol operativo (R11.6 / `has_role_in`); UPDATE solo owner o `recorded_by` (R14.17). ✓
- **B1 information disclosure**: N/A — sin Edge Functions devolviendo `err.message`; los `raise ... 23514/42501` van a logs de Postgres, el cliente ve el SQLSTATE (clasificado por `classifyIntentUploadError` → surfacing R10.8). ✓
- **B3 over-fetch column-level**: RLS row-level por establishment; el stream filtra `establishment_id IN org_scope`. La tabla no tiene columnas de PII de otros miembros. ✓
- **C1 PowerSync sync rules / frontera WAL**: `ev_scrotal_measurements` scope `org_scope` + `deleted_at IS NULL`, paridad `ev_weight_events` (Foco 7). ✓
- **C4 stale-auth replay**: `org_scope` con `active=true` + trigger `0076` (rol revocado → fuera de scope). El INSERT offline re-pasa por gating capa 2 + RLS + tenant-check al sincronizar. ✓
- **E1 queries sin tope / E2 denial-of-wallet / storage**: storage acotado por CHECK (`numeric(4,1)`, `notes ≤500`, `age_months int`); sin endpoint de costo. ✓
- **F1 PostgREST filter injection**: N/A — no hay buscador nuevo ni texto de usuario concatenado en `.or()/.filter()`/`ilike` en el delta backend. ✓
- **I2 audit tamper-evidence**: `scrotal_measurements` append-only + `recorded_by` forzado + corrección por soft-delete (R14.17). ✓

## Dominios excluidos (con justificación)

- **D (secretos/supply chain)**: M6 no toca secrets, imports Deno ni CI. N/A.
- **G (BLE)**: M6 captura por rueda (UI), no por bastón. La CE no entra por BLE. N/A.
- **H (auth/sesión)**: M6 no toca auth/tokens/login. N/A.
- **F2/F3/F4 (import/SSRF/email)**: M6 no importa archivos, no hace `fetch()` externo, no manda email. N/A.
- **Cliente M6-C.0..C.2** (design spike rueda, render/write-path, ficha/timeline): frontend → **Gate 2 (code)**. La rueda como input UX se valida ahí; la capa autoritativa (CHECK de DB) ya está cubierta en este Gate 1.
- **R14.13 clasificación apto/dudoso/bajo**: DIFERIDA fuera de M6 (analytics). N/A para Gate 1.

---

## Resumen para el leader

**Veredicto: PASS.** Sin findings HIGH. M6-BACKEND reusa fielmente los primitivos ya gateados (`0077` anti-spoof INSERT+UPDATE, `0056` session tenant-check genérico por `animal_profile_id`/`session_id`, `0054` gating fail-closed single-key, patrón RLS de M5 `custom_measurements` contra la columna denorm forzada) sin relajarlos. Cross-tenant, fail-open y anti-spoof: todos cerrados y trazados contra el as-built. El seed global no abre camino de cliente ni rompe los CHECKs/UNIQUE de M5. Caps de input autoritativos server-side presentes (`circumference_cm`/`age_months`/`notes`).

**2 MEDIUM (no bloquean la Puerta 1, para el implementer):**
- **M6-SEC-01**: confirmar el surfacing R10.8 de `scrotal_measurements` (label en `MANEUVER_TABLE_LABELS`) + test del loop capa1↔capa2↔surfacing cuando la CE está deshabilitada en el rodeo (se cierra en M6-CLIENTE/Gate 2).
- **M6-SEC-02**: agregar a M6-B.5 un test no-bypass del `session_id` tenant-check sobre `scrotal_measurements` (cross-tenant / sesión cerrada / rodeo distinto / NULL-OK) — el reuso del trigger genérico con una forma `before insert or update` distinta a las del split de `0056` exige cobertura propia (precedente: el bypass de `0052` que solo cazó la suite).

**1 LOW**: `measured_at` sin cota de fecha = paridad con el as-built (weight/condition); endurecer es decisión de convención transversal, no de M6 → `docs/backlog.md` si interesa.

**Recordatorio de orden (no bloquea Gate 1)**: el deploy de `0098/0099/0100` + del YAML de PowerSync lo gatea el leader (Supabase MCP en modo escritura); el implementer re-confirma el rango de migración libre contra el árbol y la otra terminal antes de crear los `.sql`. La suite M6-B.5 corre POST-APPLY (hook comentado hasta que el leader aplique al remoto). **Gate 1 (security modo `spec`) del delta backend M6 → PASS.** Habilitado para la Puerta 1.
