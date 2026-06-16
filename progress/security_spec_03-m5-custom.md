# Gate 1 (security modo `spec`) — Spec 03 / chunk M5 (datos/maniobras CUSTOM) — delta backend

> **RE-GATE 2026-06-13 (tras fix-loop).** Veredicto final: **PASS**. Los 5 findings de la pasada original (2 HIGH + 3 MEDIUM) quedaron **CERRADOS**; el hardening **no introdujo findings nuevos**. Detalle del re-gate al final (§RE-GATE). La pasada original se conserva abajo para trazabilidad.

---

## RE-GATE (2026-06-13) — verificación del fix-loop

**Alcance re-auditado** (igual que la pasada original, acotado al delta M5): `design.md` §11 (incl. los nuevos §11.1d.1 / §11.1d.2 / §11.1e endurecido / §11.4b endurecido), `requirements.md` US-13 (ahora R13.1–R13.27), `tasks.md` chunk M5 (M5-B.1/B.2/B.4 ampliados + M5-B.6 casos g–m). Gate 0: `context-m5-custom-maniobras.md`. **NO** auditado: M1-M4 (frontend), `0050-0057`.

**Metodología del re-gate**: por cada finding, se confirmó (a) que el fix está en el SQL de diseño (§11), (b) que tiene requirement EARS nuevo o reforzado, y (c) que tiene ≥1 test declarado en `tasks.md` M5-B.6. Además se trazó cada CHECK nuevo **fila por fila contra las 25 globales del seed de `0018`** (verificación de no-abort de la migración) y se barrió el hardening en busca de huecos nuevos.

### Estado de los 5 findings

| Finding | Severidad orig. | Estado | Evidencia del cierre |
|---|---|---|---|
| **M5-SEC-01** | HIGH | ✅ **CERRADO** | (a) §11.4b `assert_custom_value_valid` ahora tiene la rama **`else raise exception ... using errcode = '23514'`** (design.md l.959-966) → un `ui_component` no reconocido **rechaza** (fail-closed). (b) §11.1d.1 agrega `field_definitions_custom_ui_component_valid check (establishment_id is null or ui_component in (<los 7>))` (l.667-670) → cierra el vector en la raíz: una fila custom no puede crearse con `ui_component` fuera de R13.8; las globales (`is null`) quedan exentas. R13.25 nueva. Tests M5-B.6 (g)+(h). |
| **M5-SEC-02** | HIGH (REQUIERE_DECISION) | ✅ **CERRADO** | Decisión del leader tomada (INMUTABILIDAD). §11.1e guard, path UPDATE (l.722-730): `if tg_op='UPDATE' and (old.establishment_id is distinct from new.establishment_id OR old.data_type IS DISTINCT FROM new.data_type OR old.data_key ... OR old.ui_component ...) then raise ... 42501`. Editable post-creación = solo `label`/`config_schema`/`active`/`deleted_at` (soft-delete por UPDATE de `deleted_at` sigue OK). Espeja `tg_animals_block_tag_change` (`0036`, mismo `IS DISTINCT FROM`+errcode). Cierra la apropiación A→B y la fuga WAL. R13.26 nueva. Test M5-B.6 (i) — incl. el caso owner-de-A+B. |
| **M5-SEC-03** | MEDIUM | ✅ **CERRADO** | §11.1d.2 (l.681-690): `data_key` ≤64 + slug `^[a-z0-9_]+$`; `description` ≤500; `data_type` set cerrado (4 tipos a nivel tabla); `category` custom ≤32. §11.1e guard estrecha `data_type` de cliente a (`maniobra`,`propiedad`) (l.736-739). R13.27 nueva. Tests M5-B.6 (j)+(k). |
| **M5-SEC-04** | MEDIUM | ✅ **CERRADO** | §11.1e guard (l.746-764): para `enum_single`/`enum_multi`, `config_schema.options` debe ser array, cardinalidad 1..50, cada opción string ≤60. §11.4b (l.950-953): array de `enum_multi` en captura capeado a ≤50 elementos seleccionados. Refuerza R13.17. Test M5-B.6 (l). |
| **M5-SEC-05** | MEDIUM | ✅ **CERRADO** | §11.2 (l.814-816): `constraint custom_measurements_notes_len check (notes is null or char_length(notes) <= 500)`. Paridad (más estricta) con los `*.notes ≤4000` de `0070`. Test M5-B.6 (m) + aceptación M5-B.2 (l.258). |

**Las 5 cerradas.** Cada una con fix en el SQL + requirement EARS + test no-bypass declarado.

### Verificación de no-abort de la migración contra `0018` (M5-SEC-03 — pedido explícito del leader)

Trazado fila por fila contra el seed de `0018` (25 filas globales, todas `establishment_id IS NULL`):

- **`field_definitions_custom_ui_component_valid`** (`establishment_id is null or ...`): todas las globales matchean la primera rama → no se evalúa el `IN` → **no aborta**. Las globales con `composite`/`silent_apply`/`text` pasan por el `is null`. ✓
- **`field_definitions_data_type_valid`** (aplica a TODAS las filas, sin cláusula `is null or`): es el CHECK de mayor riesgo. Las 25 globales usan solo `maniobra`/`evento_individual`/`evento_grupal` (`0018` l.30-59) — todos ∈ el set permitido `('maniobra','evento_individual','evento_grupal','propiedad')` → **no aborta**. ✓
- **`field_definitions_data_key_slug`** (`^[a-z0-9_]+$`): todos los `data_key` del seed son lowercase + underscore (`prenez`, `tamano_prenez`, `antiparasitario_interno`, `raspado_toros`, …), sin tildes/mayúsculas/espacios → **no aborta**. ✓
- **`field_definitions_data_key_len`** (≤64): el data_key más largo es `antiparasitario_interno/externo` (23 chars) → **no aborta**. ✓
- **`field_definitions_description_len`** (≤500): las descriptions del seed rondan ≤45 chars → **no aborta**. ✓
- **`field_definitions_custom_category_len`** (`establishment_id is null or char_length(category) <= 32`): globales por la rama `is null`; de paso, las categories más largas (`identificacion`=14, `reproductivo`=12) caben holgadas → **no aborta**. ✓
- **`field_definitions_label_len`** (≤80) / **`field_definitions_config_size`** (<4096): labels cortos, `config_schema` NULL en el seed → **no aborta**. ✓

**Confirmado: ningún CHECK aborta contra las filas globales as-built.** La afirmación del spec_author se sostiene. (Nota menor de exactitud, no-bloqueante: el comentario de `0018` dice "26 fields" pero el `INSERT` tiene 25 filas — irrelevante para el análisis de no-abort.)

### Barrido de findings NUEVOS introducidos por el hardening — **ninguno**

1. **`establishment_id` → NULL en una fila custom (escaparía el CHECK de `ui_component`)** — **cerrado, confirmado**. El CHECK `field_definitions_custom_ui_component_valid` dejaría pasar cualquier `ui_component` si `establishment_id` fuera NULL. Pero el guard §11.1e impone doble barrera: (a) `if new.establishment_id is null then raise 42501` para todo cliente autenticado (l.703-706), y (b) la inmutabilidad `old.establishment_id is distinct from new.establishment_id → 42501` (l.722-730). Un cliente no puede setear ni mutar `establishment_id` a NULL. Solo el seed/service_role (`auth.uid()` null, early-return l.699) puede, y eso es backend trusted. Sin hueco.
2. **La inmutabilidad rompe un flujo legítimo del Gate 0** — **no**. El context-m5 contempla: soft-delete (`deleted_at` UPDATE → permitido), toggle `active` (permitido), editar `label`/opciones (`config_schema` → permitido). La inmutabilidad solo congela `establishment_id`/`data_type`/`data_key`/`ui_component`, y la corrección de mal-clasificación es explícitamente "soft-delete + recrear" (context-m5 l.39, R13.19). El guard permite explícitamente `label`/`config_schema`/`active`/`deleted_at` (l.721). Ningún flujo legítimo se traba. El `data_type not in (maniobra,propiedad) → 42501` corre también en UPDATE, pero como `data_type` es inmutable, un update legítimo de una custom maniobra/propiedad siempre lo satisface → no traba el update de `label`.
3. **`search_path` + EXECUTE revocado en las funciones nuevas/editadas** — **conservados**. `tg_field_definitions_custom_guard`: `security definer set search_path = public` (l.695) + `revoke execute ... from public, authenticated, anon` (l.768). `assert_custom_value_valid`: `set search_path = public` (l.927) + `revoke execute ...` (l.968). Ninguna queda como RPC. Paridad SEC-HIGH-01 intacta.

**Nota de data-integrity (NO bloqueante, como marca el leader)**: `config_schema` (y por tanto `config_schema.options`) sigue editable post-creación. Editar las `options` de un `enum` sobre el que ya hay `custom_measurements`/`custom_attributes` cargadas (p.ej. quitar una opción ya usada) es un tema de **integridad de datos**, no de seguridad — la validación de `value` es point-in-time al INSERT, no re-valida histórico. Lo dejo anotado para el cliente M5 (que la UI de edición de opciones advierta o impida quitar opciones en uso), pero **no afecta Gate 1**. Mantener `config_schema` editable es lo correcto desde seguridad (permite ampliar opciones sin recrear el dato).

### Trazabilidad spec ↔ fix (3 niveles consistentes)

- **design.md §11**: SQL endurecido (§11.1d.1, §11.1d.2, §11.1e guard, §11.4b). Tabla §10 cobertura design→requirements extendida (l.1079-1085) con R13.25/R13.26/R13.27.
- **requirements.md US-13**: R13.25 (M5-SEC-01), R13.26 (M5-SEC-02), R13.27 (M5-SEC-03) agregadas al final sin renumerar; M5-SEC-04 refuerza R13.17, M5-SEC-05 sin R nueva. Tabla de cobertura (l.433-435) y Historial (l.467-471) reflejan el fix-loop.
- **tasks.md chunk M5**: M5-B.1/B.2/B.4 ampliados; M5-B.6 casos (g)..(m) — uno por fix, todos no-bypass contra la DB remota; aceptación "cada R13.x de backend con ≥1 test (incl. R13.25/R13.26/R13.27)".

### Veredicto del re-gate: **PASS**

Los 5 findings cerrados con fix server-side autoritativo + requirement + test. El hardening es aditivo, no rompe flujos del Gate 0, no introduce findings nuevos, y no aborta la migración contra el as-built. Sin findings HIGH ni MEDIUM abiertos. **Gate 1 (security modo `spec`) del delta backend M5 → PASS.** Habilitado para la Puerta 1 (aprobación humana de la spec). Recordatorio de orden, no bloqueante de Gate 1: el deploy de las migraciones `0090..` + del YAML de PowerSync lo gatea el leader; el chunk **M5-CLIENTE** (UI de creación, render genérico, services de captura) es frontend → su seguridad se audita en el **Gate 2 (code)**.

---
---

## PASADA ORIGINAL (2026-06-13) — conservada para trazabilidad

**Veredicto: FAIL** (1 HIGH + 1 HIGH "REQUIERE_DECISION", 3 MEDIUM). Hay un fix-loop chico con el `spec_author` antes de la Puerta 1.

**Alcance auditado**: `design.md` §11 (11.1–11.5), `requirements.md` US-13 (R13.1–R13.24), `tasks.md` chunk M5 (M5-B.1..B.6). Gate 0: `context-m5-custom-maniobras.md` (aprobado). **NO** auditado: cliente M1-M4 (Gate 1 N/A), backend `0050-0057` (ya pasó Gate 1 s18).

**Metodología**: cada finding se trazó contra el as-built real (no contra la prosa del spec): `0018` (`field_definitions` actual), `0005` (`is_owner_of`/`has_role_in`), `0023` (`establishment_of_profile`), `0077` (patrón denorm anti-spoof), `0070` (caps de input INPUT-1), `sync-streams/rafaq.yaml` (frontera WAL probada, ADR-025/026). Solo se reportan findings HIGH-confidence con cita literal + fix.

---

## FOCOS VERIFICADOS OK (no son findings)

Antes de los findings, dejo trazabilidad de lo que verifiqué y **pasa**:

- **Foco 1 (RLS reabierta de `field_definitions` §11.1f + guard §11.1e)** — OK. El SELECT aísla bien (`establishment_id IS NULL` a todos / custom solo `has_role_in`). El INSERT/UPDATE exige `establishment_id IS NOT NULL AND is_owner_of(...)` en la policy **y** el trigger `tg_field_definitions_custom_guard` rechaza el alta global de cliente (`42501` si `establishment_id IS NULL` con `auth.uid()` no-NULL) y fuerza `is_owner_of`. Doble barrera (policy + trigger). El `auth.uid() is null → return new` es seguro: el cliente PostgREST siempre porta `auth.uid()`; el branch solo cubre el seed por migración/service_role. **Verificado contra `0005`**: `is_owner_of(NULL)` retorna `false` (el `where ur.establishment_id = est_id` nunca matchea NULL), así que aunque el guard fallara, la policy `with check` igual bloquea. Defensa redundante correcta. (Ver finding M5-SEC-02 para el hueco del **UPDATE de apropiación** que esta capa NO cubre.)
- **Foco 3 (gating genérico fail-closed §11.4a)** — OK. `assert_custom_field_enabled` resuelve rodeo inline, rodeo NULL → `23514` (no early-return), field no-enabled → `23514`, EXECUTE revocado. Paridad exacta con `assert_data_keys_enabled` (SEC-SPEC-03-03, ya gateado s18).
- **Foco 5 (anti-spoof / denorm §11.2/11.3)** — OK. `establishment_id` forzado por trigger desde `establishment_of_profile(animal_profile_id)` (no del payload), `recorded_by`/`updated_by` a `auth.uid()`. Paridad exacta con el patrón `0077` (`tg_force_establishment_id_from_profile`), que ya pasó Gate 1. El trigger es `BEFORE INSERT` en measurements y `BEFORE INSERT OR UPDATE` en attributes → cubre el vector "pisar `establishment_id` con UPDATE" que `0077` documenta como crítico. **Un cross-tenant via `animal_profile_id` ajeno NO se cuela**: el `establishment_id` se deriva del perfil real, y la policy RLS `has_role_in(establishment_id)` luego rechaza si el caller no tiene rol en ESE establishment → un INSERT con `animal_profile_id` de otro tenant termina con `establishment_id` ajeno y la policy lo bloquea.
- **Foco 6b/6c (streams custom §11.5)** — OK. Las 3 streams custom scopean `establishment_id IN org_scope`, patrón JOIN-free idéntico al probado `est_rodeo_data_config`/`est_animal_profiles` del `rafaq.yaml` as-built. `org_scope` con `active = true` + el trigger `0076` (rol revocado → `active=false` → sale del scope) cubre la revocación. (Ver M5-SEC-02 y M5-SEC-05 para los dos huecos de §11.5.)
- **Foco 8 (higiene SECURITY DEFINER)** — OK. Las 6 funciones nuevas (`tg_field_definitions_custom_guard`, `tg_custom_measurements_force_audit`, `tg_custom_attributes_force_audit`, `assert_custom_field_enabled`, `assert_custom_value_valid`, `tg_custom_*_gating`) tienen `set search_path = public` + `revoke execute ... from public, authenticated, anon`. Ninguna queda como RPC. Paridad SEC-HIGH-01.
- **Foco 2 (parcial)** — La relajación del UNIQUE de `data_key` a doble parcial (global / per-est) preserva "una sola global por `data_key`" y `rodeo_data_config`/`system_default_fields` FK-ean por `id`, no por `data_key` (verificado en `0018` l.75 y l.111). El shadowing por `data_key` **no es explotable por el gating** porque tanto el gating de fábrica (`assert_data_keys_enabled`, join `fd.data_key = any(...)` PERO scopeado por `rdc.rodeo_id`) como el custom (`assert_custom_field_enabled`, por `field_definition_id`) resuelven contra el `rodeo_data_config` del rodeo del animal, que FK-ea por `id`. (Ver M5-SEC-04 para el residual del gating de fábrica que SÍ resuelve por `data_key`.)

---

## FINDINGS HIGH

### M5-SEC-01 (HIGH) — `assert_custom_value_valid` no es fail-closed para `ui_component` desconocido + la creación NO restringe `ui_component` a los 7 válidos → bypass total de la validación de `value`

**Dónde**: `design.md` §11.4b (`assert_custom_value_valid`, l.830-861) + §11.1d (caps de creación, l.645-651).

**Evidencia (la función de validación, l.841-859)**:
```sql
if v_uic in ('numeric','numeric_stepped') then ...
elsif v_uic = 'boolean' then ...
elsif v_uic = 'enum_single' then ...
elsif v_uic = 'enum_multi' then ...
elsif v_uic in ('text','date') then ...
end if;   -- <-- NO hay ELSE. ui_component fuera de los 7 => la función no valida NADA y retorna void (acepta cualquier value).
```

**Por qué es explotable**:
1. La función ramifica por los 7 `ui_component` esperados y **no tiene rama `else`**. Si `field_definitions.ui_component` no es uno de los 7, la función **cae al final sin lanzar y acepta cualquier `value`** (fail-open). R13.16 exige rechazar todo `value` que no respete el `ui_component` — esta función no lo cumple para un `ui_component` arbitrario.
2. El leader pregunta "el CHECK de creación que restringe `ui_component` a los 7, ¿dónde vive?". **Respuesta verificada: NO existe en el delta.** El §11.1d solo agrega `field_definitions_label_len` (≤80) y `field_definitions_config_size` (<4096). **No hay `CHECK (ui_component IN ('numeric','numeric_stepped','enum_single','enum_multi','text','boolean','date'))`** en ningún lado de §11. R13.8 enumera los 7 tipos como los "ofrecidos" por la UI, pero la UI es **attacker-controlled** (el owner escribe a `field_definitions` por PostgREST directo, con `grant insert to authenticated`). Más aún: el as-built `0018` ya tiene filas con `ui_component` fuera de los 7 (`silent_apply`, `composite`) → el dominio del campo es abierto.
3. **Cadena de ataque (autenticado, owner de su propio campo, dato custom enabled en un rodeo)**: el owner crea una `field_definitions` custom con `ui_component='composite'` (o `'whatever'`, o `NULL`) vía PostgREST. La RLS lo permite (es owner, `establishment_id` propio). Luego un INSERT a `custom_measurements`/`custom_attributes` con `value = <cualquier jsonb hasta 4 KiB>` (un blob arbitrario, no-numérico, no-enum) → `tg_custom_*_gating` corre `assert_custom_value_valid` → **cae sin lanzar → acepta**. La integridad de `value` (la única defensa autoritativa server-side que R13.16 promete, "el cliente escribe a PostgREST directo y el input no es confiable") **queda anulada** para cualquier campo con `ui_component` no reconocido.

**Severidad HIGH** (no MEDIUM): R13.16 es un control de seguridad explícito ("validar server-side el `value`... porque el cliente escribe a PostgREST directo"). Un fail-open en el único control autoritativo de integridad de datos custom es exactamente lo que la regla dura RAFAQ prohíbe ("no PASS a una spec con campos de entrada sin validación autoritativa server-side"). El blast radius es intra-tenant (el atacante es owner de su propio campo), pero ensucia analytics/seguimiento custom (spec 07) con garbage no validado, que es precisamente lo que el gating genérico pretende impedir.

**Fix propuesto (dos capas, ambas necesarias)**:
- **(a) Fail-closed en `assert_custom_value_valid`**: agregar `else raise exception 'custom value: unsupported ui_component % for field %', v_uic, p_field_definition_id using errcode = '23514';` al final del `if/elsif`. Así un `ui_component` no reconocido **rechaza** en vez de aceptar.
- **(b) CHECK de dominio en la creación** (`§11.1d`, paridad con cómo `0018` enumera dominios): el CHECK debe aplicar solo a filas custom (`establishment_id is not null and ui_component in (<los 7>)`) y dejar las globales sin tocar — `check (establishment_id is null or ui_component in ('numeric','numeric_stepped','enum_single','enum_multi','text','boolean','date'))`. Esto cierra el vector en la raíz (no se puede crear un dato custom con `ui_component` raro) y deja (a) como defensa en profundidad.
- Agregar a `tasks.md` M5-B.4 un test: crear `field_definitions` custom con `ui_component='composite'` → la creación falla (`23514`); y un test de no-bypass.

> **[RE-GATE 2026-06-13] CERRADO.** (a) §11.4b ahora tiene `else raise ... 23514`. (b) §11.1d.1 agrega `field_definitions_custom_ui_component_valid`. R13.25 nueva. Tests M5-B.6 (g)+(h).

---

### M5-SEC-02 (HIGH — REQUIERE_DECISION_ARQUITECTONICA) — el UPDATE de `field_definitions` permite a un owner mover `establishment_id` de una fila custom (apropiación cross-tenant via WAL)

**Dónde**: `design.md` §11.1e (`tg_field_definitions_custom_guard`, l.655-678) + §11.1f (policy `field_definitions_update`, l.691-696) + §11.5 (stream `est_field_definitions_custom`, l.905-910).

**Evidencia (el guard, l.663-672)** — valida que el caller sea owner del `establishment_id` de la fila NUEVA, pero **no compara `OLD.establishment_id` vs `NEW.establishment_id`**:
```sql
if new.establishment_id is null then raise ... 42501; end if;
if not public.is_owner_of(new.establishment_id) then raise ... 42501; end if;
return new;   -- nunca mira OLD.establishment_id
```
La policy `field_definitions_update` usa `is_owner_of(establishment_id)` en `using` (sobre OLD) y en `with check` (sobre NEW), pero un owner que tiene rol en **dos** establishments (caso real RAFAQ) pasa ambos chequeos.

**Por qué es explotable** (owner de campo A **y** campo B):
1. Owner crea un dato custom en campo A (`establishment_id = A`). Lo carga con `custom_measurements`/`custom_attributes`.
2. `UPDATE field_definitions SET establishment_id = B WHERE id = <la custom de A>`. El `using` (is_owner_of(A)) pasa, el `with check` (is_owner_of(B)) pasa, el guard pasa. **La fila se muda a B.**
3. La stream `est_field_definitions_custom` (`WHERE establishment_id IN org_scope`) **replica esa `field_definitions` a todos los devices con rol en B** — incluyendo coworkers de B que NUNCA tuvieron nada que ver con A. La definición del dato (su `label`, `config_schema`) cruza de tenant.

**Por qué REQUIERE_DECISION**: el `establishment_id` de `field_definitions` no tiene precedente as-built de inmutabilidad post-creación. Opciones para el leader/Raf:
- **Opción 1 (recomendada, mínima)**: `establishment_id` **inmutable en UPDATE** en el guard (`OLD IS DISTINCT FROM NEW → 42501`). Espeja `0077`/`animals_block_tag_change`. Cero impacto en flujos legítimos.
- **Opción 2**: revocar `UPDATE (establishment_id)` column-level (más frágil).
- **Opción 3**: aceptar el riesgo (NO recomendado).

**Fix mínimo**: Opción 1 + test en M5-B.6.

> **[RE-GATE 2026-06-13] CERRADO.** Decisión del leader: INMUTABILIDAD (Opción 1, ampliada a `establishment_id`/`data_type`/`data_key`/`ui_component`). §11.1e guard path UPDATE (l.722-730) con `IS DISTINCT FROM → 42501`. R13.26 nueva. Test M5-B.6 (i) incl. el caso owner-de-A+B.

---

## FINDINGS MEDIUM

### M5-SEC-03 (MEDIUM) — `field_definitions` pasa a ser escribible por el cliente pero solo `label`/`config_schema` reciben cap; `description`/`category`/`data_key`/`data_type` quedan sin tope autoritativo (regresión de INPUT-1)

**Dónde**: `design.md` §11.1d + contraste con `0070` (INPUT-1) l.56-57.

**Evidencia**: `0070` **excluyó explícitamente `field_definitions`** (l.56-57: "catálogos globales read-only sin grant de escritura a authenticated"). M5 rompe esa premisa: §11.1f agrega `grant select, insert, update on public.field_definitions to authenticated`. Ahora `description`/`category`/`data_key`/`data_type` quedan sin cap autoritativo.

**Fix propuesto**: caps/CHECKs para las columnas ahora-escribibles (`data_key` ≤64 + slug, `description` ≤4000, `category` set cerrado custom, `data_type` set cerrado custom).

> **[RE-GATE 2026-06-13] CERRADO.** §11.1d.2 + guard §11.1e (data_type cliente ∈ maniobra/propiedad). R13.27 nueva. Tests M5-B.6 (j)+(k). (Nota: el cap final de `description` quedó en ≤500, más estricto que el ≤4000 propuesto — OK.)

### M5-SEC-04 (MEDIUM) — `assert_custom_value_valid` no acota la cardinalidad/largo de `config_schema.options` ni el array de `enum_multi`

**Dónde**: `design.md` §11.1d (nota) + §11.4b.

**Evidencia**: ninguna función del delta acota cuántas `options` puede tener un enum ni el largo de cada una (R13.17 incumplido); `enum_multi` no acota cuántos elementos trae el array `value`.

**Fix propuesto**: validar cardinalidad/largo de `options` en la creación + `jsonb_array_length(p_value)` en `assert_custom_value_valid` para `enum_multi`.

> **[RE-GATE 2026-06-13] CERRADO.** Guard §11.1e: options array, cardinalidad 1..50, cada opción ≤60 (l.746-764). §11.4b: `enum_multi` array ≤50 (l.950-953). Refuerza R13.17. Test M5-B.6 (l).

### M5-SEC-05 (MEDIUM) — `custom_measurements.notes` es texto libre del cliente sin cap autoritativo

**Dónde**: `design.md` §11.2 (`notes text` sin CHECK).

**Evidencia**: `custom_measurements.notes` (l.718) sin CHECK de largo, mientras `value` sí tiene cap; mismo patrón que los `*.notes` que `0070` capeó. Verificado que la alineación soft-delete/sync de las streams §11.5 está correcta (`est_custom_measurements` filtra `deleted_at`; `est_custom_attributes` no, porque la tabla no tiene la columna).

**Fix propuesto**: `constraint custom_measurements_notes_len check (notes is null or char_length(notes) <= 4000)`.

> **[RE-GATE 2026-06-13] CERRADO.** §11.2 l.814-816: cap ≤500. Test M5-B.6 (m) + aceptación M5-B.2.

---

## Tabla de inputs (cada campo que el usuario tipea en el delta M5) — actualizada al RE-GATE

| campo | límite (largo/charset/formato/rango) | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `field_definitions.label` | ≤80 (CHECK §11.1d) | server (CHECK) | ✅ |
| `field_definitions.config_schema` (jsonb) | <4096 bytes total + options ≤50 / cada ≤60 (guard §11.1e) | server (CHECK + guard) | ✅ (M5-SEC-04 cerrado) |
| `field_definitions.ui_component` | custom ∈ los 7 (CHECK dominio §11.1d.1); inmutable | server (CHECK + guard) | ✅ (M5-SEC-01 cerrado) |
| `field_definitions.data_key` | ≤64 + slug `^[a-z0-9_]+$` (CHECK §11.1d.2); inmutable | server (CHECK + guard) | ✅ (M5-SEC-03 cerrado) |
| `field_definitions.description` | ≤500 (CHECK §11.1d.2) | server (CHECK) | ✅ (M5-SEC-03 cerrado) |
| `field_definitions.category` | custom ≤32 (CHECK §11.1d.2) | server (CHECK) | ✅ (M5-SEC-03 cerrado) |
| `field_definitions.data_type` | set cerrado (tabla) + cliente ∈ (maniobra,propiedad) (guard); inmutable | server (CHECK + guard) | ✅ (M5-SEC-03 cerrado) |
| `field_definitions.establishment_id` (UPDATE) | inmutable post-creación (guard §11.1e → 42501) | server (guard `IS DISTINCT FROM`) | ✅ (M5-SEC-02 cerrado) |
| `custom_measurements.value` (jsonb) | <4096 bytes + por `ui_component` (fail-closed) | server (CHECK + `assert_custom_value_valid` con `else`) | ✅ (M5-SEC-01 cerrado) |
| `custom_measurements.notes` | ≤500 (CHECK §11.2) | server (CHECK) | ✅ (M5-SEC-05 cerrado) |
| `custom_attributes.value` (jsonb) | <4096 bytes + por `ui_component` (fail-closed) | server (idem value) | ✅ (M5-SEC-01 cerrado) |

## Tabla de rate limits (acciones abusables tocadas por el delta M5) — sin cambios del RE-GATE

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Crear `field_definitions` custom (owner, PostgREST) | no | n.a. | n.a. | Owner-only, acotado por `is_owner_of`. Sin email/SMS/API externa ni bulk → no es vector de abuso de costo prioritario. Cap de cardinalidad/storage cubre el abuso real. **n.a. justificado.** |
| Captura `custom_measurements`/`custom_attributes` (cualquier rol) | no | n.a. | n.a. | INSERT local CRUD-plano offline-first → un rate limit server-side no aplica al modelo (capturas encoladas offline). Control de abuso = cap de `value` (4 KiB) + cardinalidad + cap de `notes`. **n.a. justificado.** |
| Sync stream custom (PowerSync) | no (lo maneja PowerSync) | per-establishment (`org_scope`) | sí (scope vacío → 0 filas) | No es Edge Function custom; bucket model de PowerSync acota el fan-out. Frontera = `org_scope`. |

Ninguna acción de M5 manda email/SMS, pega a API externa, ni es bulk/import → **no hay Edge Function que requiera rate limit propio**. La superficie abusable real es storage/cardinalidad, cubierta por los caps (M5-SEC-03/04/05, todos cerrados).

---

## Dominios revisados (trazabilidad)

- **A1 service-role / RLS bypass**: N/A — M5 no crea Edge Functions ni usa `createAdminClient()`. Funciones nuevas = triggers SECURITY DEFINER con EXECUTE revocado. ✅
- **A2 mass assignment**: `value`/`establishment_id`/`recorded_by` forzados por trigger. `field_definitions.establishment_id` OK en INSERT (guard+policy) e inmutable en UPDATE (M5-SEC-02 cerrado). ✅
- **A3 IDOR por FK** (`animal_profile_id`, `field_definition_id`, `session_id`): `establishment_id` derivado del perfil real, RLS rechaza cross-tenant. ✅
- **A4 BFLA / function-level authz**: owner-only para creación (R13.2), cualquier rol para captura (R13.13). ✅
- **B1 information disclosure**: N/A — sin Edge Functions devolviendo `err.message`; los `raise` van a logs de Postgres, el cliente ve el SQLSTATE. ✅
- **B3 over-fetch column-level**: RLS row-level + SELECT de `field_definitions` expone el catálogo custom solo a quien tiene rol. ✅
- **C1 PowerSync sync rules / frontera WAL**: `catalog_field_definitions` restringido a `IS NULL`; 3 streams custom scope `org_scope`; apropiación WAL cerrada por la inmutabilidad de `establishment_id` (M5-SEC-02). ✅
- **C4 stale-auth replay**: `org_scope` con `active=true` + trigger `0076`. ✅
- **E1 queries sin tope / E2 denial-of-wallet / E5 cardinalidad**: storage acotado por caps; `options`/`enum_multi` acotados (M5-SEC-04 cerrado). ✅
- **F1 PostgREST filter injection**: N/A en spec (el `value` jsonb no se concatena en filtros server-side; buscadores = Gate 2). ✅
- **I2 audit tamper-evidence**: `custom_measurements` append-only + `recorded_by` forzado; `custom_attributes` current-value por diseño. ✅

## Dominios excluidos (con justificación)

- **D (secretos/supply chain), G (BLE), H (auth/sesión), F2/F3/F4 (import/SSRF/email)**: M5 no toca ninguno.
- **Cliente M5-C.1..C.3** (services de captura, UI de creación, render genérico): frontend → Gate 2 (code).
- **F1 / buscadores**: no hay buscador nuevo en el delta backend de M5.

---

## Resumen para el leader

**Pasada original**: FAIL (2 HIGH + 3 MEDIUM). **RE-GATE (2026-06-13)**: **PASS** — los 5 cerrados, sin findings nuevos, migración no aborta contra `0018`, funciones nuevas conservan `search_path` + EXECUTE revocado, la inmutabilidad no rompe flujos del Gate 0. Habilitado para la Puerta 1. Deploy de `0090..` + YAML PowerSync gateado por el leader; M5-CLIENTE → Gate 2.
