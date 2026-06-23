# Gate 1 (modo `spec`) — Stream A: modelo de puesta en servicio (delta backend de spec 02)

**Veredicto: PASS**

**Fecha**: 2026-06-23
**Auditor**: security_analyzer (modo `spec`, ADR-019)
**Input auditado**:
- `specs/active/02-modelo-animal/requirements-puesta-en-servicio.md` (RPS.x)
- `specs/active/02-modelo-animal/design-puesta-en-servicio.md` (SQL diseñado)
- `specs/active/02-modelo-animal/tasks-puesta-en-servicio.md` (TPS.x)
- Contexto Gate 0: `docs/modelo-reproductivo-puesta-en-servicio.md`
**As-built verificado contra disco** (no solo citado por la spec): `0005`, `0017`, `0020`, `0026`, `0053`, `0054`, `0062`, `0066`, `0070`, `0079`, `0081`, `0082` + Glob de `supabase/migrations/*.sql` (techo real = `0101`, coincide con RPS.7.2).

---

## Resumen ejecutivo

El delta **NO debilita** ninguna propiedad de seguridad del backend deployado. Es un delta escrito con conciencia de seguridad inusualmente alta: cada superficie nueva **reusa literalmente** un patrón ya validado por Gate 1 en el as-built, y lo cité contra el archivo real:

| Superficie nueva | Patrón as-built que espeja | Verificado |
|---|---|---|
| `set_rodeo_service_months` (anti-IDOR por derivación del est del rodeo) | `set_rodeo_config` `0082:53-70` (hermético por construcción) | ✓ idéntico |
| `create_rodeo` +param (authz-first + guard c-bis anti-IDOR) | `create_rodeo` `0081:51-99` | ✓ preserva ambos guards |
| 3 funciones de derivación SECURITY DEFINER (guard `has_role_in` al entrar + revoke/grant + smoke-check) | `refresh_age_categories` `0066:53-79` | ✓ mismo patrón fail-closed |
| `assert_service_months_valid` (helper interno revocado de todos los roles cliente, invocado por DEFINER) | `assert_data_keys_enabled` `0054:33-66` | ✓ mismo patrón |
| CHECK de cardinalidad/rango de `service_months` (cota INPUT-1 server-side) | INPUT-1 `0070` (capa autoritativa contra input abusivo) | ✓ |
| `compute_category` reescritura quirúrgica | `0062` (preserva SECURITY DEFINER STABLE + search_path + grant) | ✓ diff = solo 3 líneas |

No hay findings **HIGH**. Hay 1 MEDIUM (cota de `p_year`, ya anticipada por el design como tarea del implementer pero NO presente en el SQL) y 3 LOW de robustez. Ninguno bloquea PASS; van como reconciliación recomendada en la spec (preservando IDs `RPS.x`, regla RPS.7.5).

---

## Findings HIGH

**Ninguno.** Detalle de por qué cada foco del prompt cierra:

### Foco 1 — Escritura de `service_months` (owner-only + anti-IDOR + validación + idempotencia + firma)
- **Owner-only**: `create_rodeo` valida `is_owner_of(p_establishment_id)` ANTES de cualquier escritura (design §3.1 `(a)`, espeja `0081:53`). `set_rodeo_service_months` valida `is_owner_of(v_est)` (design §3.2 `(b)`, espeja `0082:68`). Un `field_operator`/`veterinarian`/sin-rol → 42501. ✓ (RPS.3.3)
- **Anti-IDOR por derivación**: en `set_rodeo_service_months` el establishment **se deriva del rodeo** (`select establishment_id into v_est from rodeos where id = p_rodeo_id`, design §3.2 `(a)`), NO es parámetro → un `p_rodeo_id` de otro tenant da `is_owner_of(est ajeno)=false` → 42501 sin tocar nada. Es el patrón **hermético por construcción** de `0082` (verificado en `0082:53-70`). En `create_rodeo` el rodeo aún no existe → se conserva el guard c-bis post-INSERT de `0081:94-99` (el rodeo con `p_id` debe pertenecer a `p_establishment_id`). ✓ (RPS.3.4)
- **Validación server-side autoritativa**: doble capa — (1) CHECK de columna `rodeos_service_months_valid` (design §2: rango 1–12, sin duplicados, ≤12; NULL pasa), que es la **única capa autoritativa** porque el cliente Expo escribe a PostgREST directo; (2) helper `assert_service_months_valid` re-validado dentro de ambas RPC para dar error accionable antes de persistir. ✓ (RPS.1.3–1.5, RPS.3.5)
- **Idempotencia**: alta vía `ON CONFLICT (id) DO NOTHING` (replay no crea 2º rodeo); edición vía UPDATE que setea el array (replay = no-op). ✓ (RPS.3.6)
- **Cambio de firma de `create_rodeo`**: el design lo marca explícitamente (§3.1 ⚠️ + §3.3): DROP de la firma vieja `(uuid,uuid,text,uuid,uuid,jsonb)` + CREATE de la nueva `(...,smallint[])` + revoke/grant sobre la firma resultante + smoke-check de grants (patrón `0081:133-134`). Esto **cierra** el riesgo de overload ambiguo y de firma vieja sin revoke. TPS.4 lo exige. ✓

### Foco 2 — Las 3 funciones de derivación SECURITY DEFINER
- **Guard al entrar**: `rodeo_service_campaign`/`rodeo_serviced_females`/`rodeo_repro_denominator` derivan `v_est` del rodeo y exigen `has_role_in(v_est)` **antes** de leer datos de elegibilidad (design §5.1 `:445-448`, §5.2 `:502-504`, §5.3 `:578-580`). El SECURITY DEFINER se usa para encapsular la lógica de elegibilidad, NO para saltear el authz — el guard rige primero. ✓ (RPS.5.6)
- **IDOR cross-tenant**: un `p_rodeo_id` ajeno → `has_role_in` false → 42501; inexistente → P0002. Verificado que `has_role_in` (`0005:9-25`) chequea `user_roles` de `auth.uid()` activo en ese est. ✓
- **`has_role_in` (cualquier rol) vs `is_owner_of`**: correcto para lectura de reportes (cualquier miembro del establecimiento lee KPIs), simétrico a `rodeos_select` = `has_role_in` (`0017:50-51`). ✓
- **Revoke/grant**: design §5.4 revoca `execute … from public, anon` y grantea solo a `authenticated`, con smoke-check fail-closed estilo `0066:63-79`. TPS.14 lo exige. ✓
- **Read-only**: las 3 son STABLE y solo hacen SELECT; el design lo declara (§5 "Read-only garantizado", RPS.5.9) y el SQL no contiene DML. ✓
- **No filtra otro tenant en la lógica de elegibilidad**: todas las subconsultas de `rodeo_serviced_females` están scopeadas a `p.rodeo_id = p_rodeo_id` + `p.establishment_id = v_est` (design §5.2 `:513-514`, `:545-546`); las subconsultas a `reproductive_events rv` joinan por `rv.animal_profile_id = p.id` (p ya tenant-scopeado). No hay lectura cross-tenant. ✓

### Foco 3 — Reescritura de `compute_category`
Diff verificado **línea por línea** contra `0062`:
- `v_has_service` aparece en `0062` en exactamente 3 lugares: declaración (`0062:25`), `SELECT EXISTS … event_type='service'` (`0062:42-44`), y el término `or v_has_service` en la rama vaquillona (`0062:93`). El design (§4 `:325`, `:341`, `:384`) elimina **exactamente esos 3** y deja todo lo demás idéntico.
- **Preserva**: `SECURITY DEFINER STABLE` (`:315`), `set search_path = public` (`:316`), `grant execute … to authenticated` (`:397`, idéntico a `0062:108`), contrato de retorno `returns uuid` (`:314`), precedencia LOAD-BEARING de ramas, rama macho completa, cortes de edad, tacto+ vigente RT2.7.5, conteo de partos. ✓ (RPS.4.6)
- **Sin grants nuevos / sin lectura-escritura cross-tenant**: deriva todo del `profile_id` vía sus joins (`animal_profiles`/`animals`/`rodeos`), igual que `0062` (RT2.12.3). Quitar un término de **lectura** (`v_has_service`) no puede abrir ningún camino de seguridad — solo deja de leer un evento. ✓
- **Consistencia incremental↔recompute** (RPS.4.7): ambos caminos (`0063`, `0046`) **delegan** en `compute_category` → heredan el cambio por construcción, una sola fuente de verdad. El design recomienda no tocar el guard `0063` (dejar `'service'`, recompute idempotente) — verificado que es inocuo: un recompute de más recomputa la misma categoría. ✓

### Foco 4 — Cota/validación autoritativa server-side de cada input
- `service_months`: CHECK de columna + helper (autoritativo). ✓
- `p_rodeo_id`: validado por existencia del rodeo + guard de tenant. ✓
- `p_year`: **ver MEDIUM-1** — la cota está anticipada en prosa pero NO en el SQL.

### Foco 5 — Multi-tenant en todo el delta (RPS.7.1)
Escritura owner-only por est derivado; lectura tenant-guarded por est derivado; `compute_category` deriva todo del `profile_id`; agregar la columna `service_months` a `rodeos` hereda la RLS existente (`0017:50-58`) sin abrir camino cross-tenant (verificado: no se agrega grant nuevo; `0017:60` ya tiene `grant select,insert,update … to authenticated`). ✓

---

## Findings MEDIUM (no bloquean PASS — reconciliar en la spec, RPS.7.5)

### MEDIUM-1 — `p_year` sin cota en el SQL diseñado (gap entre prosa y código)
**Evidencia**: el design §5 (Seguridad del contrato, `design-puesta-en-servicio.md:612`) dice *"el implementer agrega una cota razonable, p.ej. `1900 ≤ p_year ≤ extract(year from now())+1`"*, y TPS.11 menciona "cota de `p_year`". **Pero el SQL de `rodeo_service_campaign` (§5.1 `:456-458`) llama `make_date(p_year, …)` sin validar `p_year`.** Los otros dos usos de `p_year` son comparaciones (`extract(year from rv.event_date)::int = p_year`, §5.2 `:550`) que no rompen.

**Exploitabilidad (por qué es MEDIUM y no HIGH)**: un `p_year` absurdo solo afecta al **propio** rodeo del caller (ya pasó el guard de tenant, que corre ANTES del `make_date` en §5.1 `:446`). El peor caso es un **error 500** de `make_date` (date field out of range) o un **set vacío** — NO hay cross-tenant, NO hay disclosure, NO hay amplificación/DoS (cómputo de una fila). Es defense-in-depth de robustez de input, no un hueco explotable.

**Por qué igual lo reporto como MEDIUM** (no LOW): el prompt pide explícitamente verificar "cada input de usuario con cota/validación autoritativa server-side", y `p_year` es input de usuario que hoy queda **sin cota en el contrato firme** — depende de que el implementer la agregue sin un requirement que lo ate. Una spec sin cota explícita para un input no debería pasar el listón de "límite + validación por cada campo".

**Propuesta de cambio** (preservando IDs `RPS.x`):
1. Agregar un sub-requirement a RPS.5 (p.ej. **RPS.5.10**): *"Las funciones de derivación deberán acotar `p_year` a un rango razonable server-side (p.ej. `1900 ≤ p_year ≤ extract(year from now())::int + 1`), rechazando fuera de rango con un error accionable (23514) antes de derivar fechas, para que no se generen `make_date` inválidos."*
2. Reflejar la cota en el **SQL de §5.1** (no solo en la prosa de §5) y en TPS.11/TPS.15 como caso de test (año fuera de rango → 23514). Validar `p_year` **después** del guard de tenant (mantener el orden: tenant primero, luego input — para no filtrar timing/errores distintos a un caller no autorizado).

---

## Findings LOW (anexo — no bloquean; a criterio del implementer/leader)

### LOW-1 — `rodeo_serviced_females` lee `animals` global en vez de la identidad denormalizada en `animal_profiles`
**Evidencia**: el SQL §5.2 (`:511`, `:517`, `:534`) hace `join public.animals a on a.id = p.animal_id` y filtra por `a.sex = 'female'` y `a.birth_date`. El as-built `0079` **denormalizó** `animal_sex`/`animal_birth_date` sobre `animal_profiles` precisamente porque `animals` es GLOBAL (ADR-004, `0079:8-11`).
**No es hueco de seguridad**: la función es SECURITY DEFINER (el join a `animals` funciona) y `p` ya está tenant-scopeado (`p.rodeo_id`+`p.establishment_id`), así que el join por `a.id = p.animal_id` no abre cross-tenant. Es una nota de **consistencia/robustez**: preferir `p.animal_sex`/`p.animal_birth_date` (mantenidas anti-spoof por trigger force `0079:117-119`) evita acoplar la derivación a la tabla global y es lo coherente con el resto del modelo offline. El implementer puede usar las columnas denormalizadas; si insiste en `animals`, no hay riesgo de tenant-leak.

### LOW-2 — `assert_service_months_valid` con `errcode 23514` mientras el helper de gating usa el mismo y el cliente clasifica errores por código
**Evidencia**: el helper (§3.3 `:276/279/282`) usa `23514` (check_violation), igual que `create_rodeo` `0081:61/65` para validaciones de nombre. No es problema de seguridad; solo una nota para el implementer de que el cliente PowerSync clasifica los errores de la outbox por `errcode` (42501 = authz, P0002 = not found, 23514 = validación) — confirmar que `23514` de `service_months` se clasifique como **rechazo permanente** (rollback del overlay, no reintento infinito), igual que ya hace con las validaciones de `create_rodeo`/`set_rodeo_config`. Sin impacto de seguridad; es robustez de la outbox.

### LOW-3 — Dependencia frontend del espejo `computeCategoryCode` (drift transitorio, ya anotada)
**Evidencia**: verifiqué `app/src/utils/animal-category.ts:261` (`const hasService = inputs.events.some((e) => e.eventType === 'service')`) y `:269` (usado en la rama vaquillona) — exactamente donde el design (§4 `:410`) y RPS.7.4 lo dicen. Si el backend (`0104`) se aplica sin alinear el espejo, el badge client-side mostraría `vaquillona` para una ternera con solo IA mientras el server muestra `ternera` → **drift transitorio hasta el sync**. **No es un hueco de seguridad** (es UX/consistencia client-side, no una frontera de tenant), y el delta lo declara correctamente como dependencia frontend (Stream B / slice C6), NO de este chunk backend. Lo dejo registrado solo para que el leader **encadene** el slice frontend al aplicar el backend (ya está en RPS.7.4 + design §9 + TPS.19). Sin acción en este delta.

---

## Tabla de inputs (cada input de usuario del delta)

| Campo | Límite (rango/cardinalidad) | Validación | OK? |
|---|---|---|---|
| `service_months` (array de meses) | rango 1–12, sin duplicados, ≤12 elementos; NULL permitido (sin configurar), `{}` permitido (no hace servicio) | **server autoritativa doble**: CHECK de columna `rodeos_service_months_valid` (§2) + helper `assert_service_months_valid` dentro de ambas RPC (§3.3). El cliente Expo es attacker-controlled → el CHECK es la capa real. | ✓ |
| `p_rodeo_id` (uuid) | debe existir y no estar soft-deleted; debe pertenecer al tenant del caller | server: existencia (P0002) + guard `has_role_in`/`is_owner_of` del est derivado (anti-IDOR) | ✓ |
| `p_year` (int) | sin cota en el SQL diseñado (prosa la pide, código no la tiene) | server parcial: el guard de tenant corre antes; pero `make_date(p_year,…)` sin validar → 500/empty en el propio rodeo | ⚠ MEDIUM-1 |
| `p_name`, `p_species_id`, `p_system_id`, `p_toggles` (en `create_rodeo`) | sin cambio vs `0081` (nombre ≤120, species/system activos, toggles jsonb array) | server: heredan las validaciones de `0081:59-120` (no las reabre este delta) | ✓ (sin cambio) |

---

## Tabla de rate limits (acciones abusables tocadas por el delta)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `create_rodeo` / `set_rodeo_service_months` (escritura de rodeo) | n.a. | per-user/per-est implícito por authz | sí (authz + CHECK + idempotencia) | Operación de baja frecuencia (crear/editar rodeo), owner-only, no manda email/SMS ni pega a API externa, no es bulk, idempotente. No es vector de abuso a escala. El CHECK `≤12` acota el payload (anti storage-exhaustion, INPUT-1). |
| `rodeo_service_campaign` / `rodeo_serviced_females` / `rodeo_repro_denominator` (lectura de reportes) | n.a. | per-user/per-est por guard `has_role_in` | sí (guard al entrar) | Read-only, cómputo on-read sobre el padrón de UN rodeo (chico en cría). No materializa nada, no fan-out, no costo por request externo. `p_year` no amplifica (una fila). No es vector de DoS de wallet ni de enumeración cross-tenant (guard de tenant). |
| `compute_category` (motor de categorías) | n.a. | invocado por triggers/cron, no es acción de usuario directa abusable | sí | Reescritura quirúrgica; no cambia su superficie de invocación ni su costo. |

**Conclusión rate limits**: el delta NO introduce ninguna acción abusable a escala (sin email/SMS, sin API externa, sin bulk fan-out, sin queries sin tope cross-tenant). Las lecturas están acotadas al padrón de un rodeo y tenant-guarded. No se requiere rate limit nuevo. Documentado por completitud (el prompt pide verificar rate limits en todo, no solo auth).

---

## Dominios de seguridad revisados (catálogo RAFAQ)

- **A1 service-role bypassa RLS**: N/A — el delta NO usa `createAdminClient()`/service-role en código de app; usa SECURITY DEFINER en SQL, auditado en Foco 1/2/3 (guard de tenant al entrar en todas).
- **A2 mass assignment**: ✓ sin riesgo — las RPC arman el INSERT/UPDATE campo por campo (no spread de input); `service_months` es el único campo nuevo y va validado. `compute_category` no escribe.
- **A3 IDOR por FK**: ✓ cubierto — `p_rodeo_id` se valida por existencia + tenant; la rama IA de `rodeo_serviced_females` joina `reproductive_events` por `animal_profile_id = p.id` (p ya tenant-scopeado).
- **A4 function-level authz (BFLA)**: ✓ — escritura owner-only (`is_owner_of`), lectura member-only (`has_role_in`); cada función declara y enforça su rol mínimo.
- **B1 information disclosure**: ✓ — los errores son mensajes fijos con errcode (42501/P0002/23514); no se devuelve `err.message` crudo (es SQL, no Edge Function); los datos derivados son del propio tenant.
- **B3 over-fetching column-level**: ✓ — `rodeo_serviced_females` devuelve solo `animal_profile_id`+`source`; no expone columnas sensibles de otros animales.
- **C1–C4 offline/sync**: ✓ — `service_months` entra por el mismo camino RPC offline-idempotente que `0081`/`0082` (overlay optimista + outbox at-least-once); la idempotencia hace seguro el replay; el authz se re-evalúa server-side en cada drain (stale-auth seguro, C4). Dependencia anotada: el `AppSchema` de PowerSync debe incluir `service_months` como TEXT (design §2 nota PowerSync) — es correctitud de sync, no seguridad.
- **E1 queries sin tope**: ✓ — las derivaciones operan sobre el padrón de UN rodeo (acotado por el join a `p.rodeo_id`), no sobre el establecimiento entero ni global.
- **F1 PostgREST/SQL injection**: ✓ — no hay concatenación de input en SQL dinámico; `p_year`/`p_rodeo_id`/`service_months` son parámetros tipados, no strings interpolados. `service_months` no se concatena en ningún `.or()/.filter()/ilike` ni prompt.
- **H1 invalidación de sesión**: N/A — el delta no toca auth/sesiones.
- **I2 audit tamper-evidence**: ✓ — las transiciones de categoría siguen registrándose por `apply_auto_transition` (`0066:48`)/history append-only existente; el delta no toca ese trail. Los eventos `service` históricos NO se borran (RPS.4.5, design §4 + §7) → el timeline queda íntegro y auditable.

## Dominios excluidos (con justificación)

- **A1 (service-role en Edge Functions)**, **B2 (PII en logs)**, **D1–D4 (secrets/supply chain)**, **E2–E4 (denial-of-wallet/bot/enumeration)**, **F2–F4 (import/SSRF/XSS email)**, **G1–G3 (BLE)**, **H2–H3 (credenciales/token en URL)**, **I1/I3 (retención/mobile hardening)**: **excluidos** — este delta es 100% SQL (4 migraciones de schema/RPC/funciones SECURITY DEFINER); no toca Edge Functions, no manda email/SMS, no pega a APIs externas, no ingiere archivos, no toca BLE, no toca el cliente RN (el espejo es una dependencia frontend de OTRO stream), no toca auth/sesiones/secretos. No hay superficie para esos dominios.

---

## Trazabilidad de verificación (qué leí del as-built, no solo lo que la spec cita)

| As-built | Qué verifiqué | Resultado |
|---|---|---|
| `0062` | `v_has_service` en 3 lugares exactos; SECURITY DEFINER STABLE + search_path + grant | el diff del design es quirúrgico y preserva todo lo de seguridad |
| `0081` | authz-first `is_owner_of` + guard c-bis anti-IDOR + revoke/grant | el `create_rodeo` del design los conserva + flag de cambio de firma |
| `0082` | anti-IDOR HERMÉTICO por derivación del est (no param) | `set_rodeo_service_months` lo clona fielmente |
| `0066` | revoke from public/authenticated/anon + smoke-check fail-closed | las 3 funciones de derivación espejan el patrón (revoke + grant authenticated + smoke-check) |
| `0054` | `assert_data_keys_enabled` revocado de roles cliente, invocado por DEFINER; IA = `service`+`ai` (`:135`) | valida el patrón de `assert_service_months_valid` + confirma RPS.4.8 |
| `0005` | `has_role_in`/`is_owner_of` chequean `auth.uid()` activo en el est | los guards de derivación/escritura son correctos |
| `0017` | RLS `rodeos` (`has_role_in` select, `is_owner_of` insert/update) + grant existente | agregar columna hereda la RLS sin abrir cross-tenant; sin grant nuevo |
| `0020`/`0026` | `animal_profiles` tiene establishment_id/status/rodeo_id; `reproductive_events` tiene service_type/event_type | los filtros de las derivaciones son válidos contra el schema real |
| `0070` | INPUT-1 caps server-side (capa autoritativa contra input attacker-controlled) | precedente correcto para el CHECK de cardinalidad de `service_months` |
| `0079` | denormalización `animal_sex`/`animal_birth_date` sobre `animal_profiles` (anti-spoof) | base del LOW-1 (preferir columnas denormalizadas vs `animals` global) |
| `animal-category.ts:261/269` | `hasService` en la rama vaquillona | confirma la dependencia frontend RPS.7.4 (LOW-3, no de este delta) |
| Glob migrations + grep `service_months` | techo = `0101`; `service_months` solo en spec/docs | RPS.7.2 correcto; la columna es net-new |

---

## Recomendación al leader

**PASS.** El delta es sólido y no debilita el backend deployado. Antes de la Puerta 1, reconciliar en la spec (preservando IDs `RPS.x`, regla RPS.7.5):

1. **MEDIUM-1 (obligatorio para cerrar el listón de inputs)**: agregar la cota de `p_year` como sub-requirement (sugerido **RPS.5.10**) y bajarla al SQL de `design §5.1` + caso de test en TPS.11/TPS.15. Validar `p_year` **después** del guard de tenant.
2. **LOW-1/LOW-2 (opcionales)**: anotar en el design que `rodeo_serviced_females` puede leer `animal_profiles.animal_sex/animal_birth_date` (denormalizadas, `0079`) en vez de `animals` global; confirmar que `23514` de `service_months` se clasifica como rechazo permanente en la outbox.
3. **LOW-3 (ya cubierto)**: el leader debe **encadenar** el slice frontend del espejo (`animal-category.ts`, quitar `hasService`) al aplicar `0104`, para no dejar drift transitorio. Ya está en RPS.7.4 / design §9 / TPS.19; solo reconfirmar que no se aplique `0104` aislado sin planificar ese slice.

Ninguno de los tres bloquea la implementación; el #1 es una reconciliación de spec de bajo costo que conviene cerrar antes de que el implementer escriba el SQL para que la cota quede en el contrato y no como decisión suelta.
