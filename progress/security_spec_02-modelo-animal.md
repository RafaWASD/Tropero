# Security Spec Review — 02-modelo-animal (Gate 1, modo `spec`) — DELTA TIER 1

---

## Re-audit sesión 20 (FAIL→fix verificado)

**Agente**: security_analyzer (Gate 1, modo `spec`, RE-AUDIT).
**Fecha**: 2026-05-30 (sesión 20).
**Naturaleza**: re-corrida de Gate 1 sobre el **delta Tier 1** después de que el `spec_author` endureció `design.md` + `tasks.md` para cerrar los 4 findings del FAIL previo. Más **scan focalizado de regresión** sobre el SQL nuevo (en particular el RPC `register_birth(uuid, date, jsonb)` que pasó de prosa a SQL firme).
**Input re-auditado**:
- `design.md` § "Fold del Tier 1" + sub-bloque Changelog "Endurecimiento Gate 1 (FAIL → fix)" (l.2274-2279).
- `design.md` SQL endurecido: `0043` trigger `tg_force_created_by_auth_uid` (l.766-790); `0044` `exit_animal_profile` (l.831-881); `0045` RLS+grant `birth_calves` (l.1526-1565) + RPC `register_birth` (l.1583-1631).
- `tasks.md` T2.19 (l.443-453) — 6 casos de no-bypass.
- Patrón canónico `0041_soft_delete_rpcs.sql` (re-leído como referencia de cierre).

### Veredicto re-audit: **PASS**

Los 4 findings están **efectivamente cerrados** en el SQL/spec actual, verificados contra el patrón canónico `0041`. El scan de regresión sobre `register_birth` (el único SQL realmente nuevo, no una mutación de un bloque existente) **no encontró huecos nuevos**: grant acotado, `revoke from public, anon`, `search_path = public`, authz `has_role_in` sobre el establishment derivado de la **fila real** de la madre antes de cualquier INSERT, y atomicidad declarada. La T2.19 cubre los 6 vectores con su variante de control. Una nota MEDIUM **no-bloqueante** sobre atomicidad declarativa (R2-NEW, ver abajo) queda asentada para el implementer/Gate 2, no para el gate de spec.

### Estado por finding

| Finding | Estado | Por qué |
|---|---|---|
| **SEC-SPEC-01** (HIGH) — `exit_animal_profile` authz sin `has_role_in` | **CERRADO** | La guarda pasó a `has_role_in(v_est) and (is_owner_of(v_est) or v_creator = auth.uid())` (design l.855-858), **idéntica** al patrón canónico `soft_delete_animal_event` (`0041` l.78). `v_est` se deriva de la fila real (`where id = p_profile_id and deleted_at is null`, l.844-845). `search_path = public` (l.841). Revoke/grant con **firma tipada completa** de `public, anon` → `authenticated` (l.878-879) + `notify pgrst` (l.880). Es la propuesta de cambio concreta del reporte previo, aplicada al pie. Test: T2.19 caso 1 (espejo de T2.18): autor con `user_roles.active = false` → `42501` + `status` sin cambiar, leído con `service_role`; variante de control con owner → procede. |
| **SEC-SPEC-02** (HIGH) — RPC mellizos en prosa, sin contrato de seguridad | **CERRADO** | El RPC dejó de ser "lo define el implementer": ahora es **SQL firme** `register_birth(p_mother_profile_id uuid, p_event_date date, p_calves jsonb)` (l.1584-1608). (a) authz derivada de la **fila real** de la madre: `select establishment_id into v_est from animal_profiles where id = p_mother_profile_id and deleted_at is null` (l.1594-1596), **nunca** de un parámetro de tenant del cliente (l.1611-1613, explícito); (b) `has_role_in(v_est)` **antes** de cualquier INSERT (l.1600-1602); (c) `revoke execute ... from public, anon` + `grant ... to authenticated` con firma tipada `(uuid, date, jsonb)` + `notify pgrst` (l.1618-1620); (d) `set search_path = public` (l.1590); (e) herencia de tenant: cada ternero hereda `v_est`, no un valor del payload (l.1604, l.1613). El reparto trigger-mono ↔ RPC-N quedó **fijado** (l.1627-1631), no a criterio. Test: T2.19 caso 2 (cross-tenant A→B → `42501` + nada creado; control con madre propia → crea todo en transacción). |
| **SEC-SPEC-03** (MEDIUM) — `created_by` solo-si-NULL, spoofeable + load-bearing | **CERRADO** | Trigger **nuevo** `tg_force_created_by_auth_uid` que **siempre** sobreescribe (`new.created_by := auth.uid();` incondicional, l.778) — **no** reusa el helper "solo si NULL". Comentario `comment on function` deja explícito el contraste con `tg_set_created_by_auth_uid` (audit-only) (l.782-785). Es exactamente la "variante para animal_profiles" propuesta en el reporte previo. Test: T2.19 caso 5 (INSERT con `created_by = <uid ajeno>` → la fila queda con `created_by = <uid del caller>`; corolario: ese otro usuario no puede dar de baja vía `v_creator = auth.uid()`). |
| **SEC-SPEC-04** (MEDIUM) — `birth_calves` INSERT directo + RLS sin `deleted_at` | **CERRADO** | (a) Se **quitó** `insert` del grant: solo `grant select on public.birth_calves to authenticated` (l.1560). No hay policy de INSERT para `authenticated` (l.1553-1557) — la tabla se puebla **solo** desde el flujo server-side `SECURITY DEFINER` (trigger mono extendido + `register_birth`). Esto cierra ambos vectores del finding: parentesco falso y cruce de tenant del ternero, ahora imposibles sin superficie PostgREST. (b) `re.deleted_at is null` agregado a la policy de SELECT (l.1549). Tests: T2.19 caso 3 (INSERT directo → `42501`/permission denied, sin fila) + caso 4 (SELECT filtra parto soft-deleted: 0 filas para `authenticated`, filas físicas presentes con `service_role`). |

### Scan de regresión — fixes no introdujeron hueco nuevo

El único SQL **genuinamente nuevo** (no una mutación de un bloque ya auditado) es el RPC `register_birth`. Lo audité como cualquier `SECURITY DEFINER` que escribe `animal_profiles`:

- **Grant / revoke**: `revoke ... from public, anon` + `grant ... to authenticated` con firma tipada completa `(uuid, date, jsonb)` (l.1618-1619). Cierra el `EXECUTE TO PUBLIC` por default de Postgres y el acceso anónimo. Correcto que **sí** se conceda a `authenticated` (a diferencia de `apply_auto_transition`, que se revocó a los tres): es el camino de carga de mellizos del cliente, justificado en l.1623. **OK**.
- **`search_path` pinning**: `set search_path = public` (l.1590). Cierra el vector de search_path hijacking en SD. **OK**.
- **Authz sobre el establishment derivado de la fila real**: `v_est` sale de `animal_profiles.establishment_id where id = p_mother_profile_id and deleted_at is null` (l.1594-1596), y `has_role_in(v_est)` se evalúa **antes** del INSERT (l.1600-1602). El design es explícito (l.1611) en que **nunca** se confía en `establishment_id`/tenant del payload — es la defensa exacta contra el cross-tenant que produjo SEC-HIGH-01. **OK**.
- **Atomicidad**: el contrato declara "una transacción … Rollback total si cualquiera falla" (l.1605, l.1575, l.1625). Una función plpgsql corre dentro de una transacción implícita, así que cualquier excepción no capturada revierte el lote completo — consistente con lo declarado. **OK a nivel contrato** (ver R2-NEW: el implementer no debe meter un `exception when others` que trague el error y rompa la atomicidad).
- **`p_calves jsonb` como input attacker-controlled**: el payload solo aporta atributos de dominio del ternero (`calf_sex`, `calf_weight?`, `calf_tag_electronic?`). El tenant del ternero **no** viene del payload (se hereda `v_est`). No hay `EXECUTE`/`format()` dinámico sobre el JSON (no es SQL injection). El parseo del jsonb queda en el cuerpo a cargo del implementer — ver R1-NEW como nota de revisión `code`, no como bloqueo de spec. **OK** para el contrato firme.
- **No re-abre superficie de `birth_calves`**: el RPC inserta en `birth_calves` por dentro (SD, bypassa RLS), coherente con que el cliente perdió el `GRANT INSERT` (SEC-SPEC-04). El fix de SEC-SPEC-04 y el de SEC-SPEC-02 son **mutuamente consistentes** (no se pisan). **OK**.

### Notas nuevas surgidas del re-audit (no-bloqueantes — para `code`/Gate 2)

Ninguna bloquea el Gate 1 de spec: el contrato firme está bien especificado y cierra los 4 findings. Estas dos son verificaciones que **caen en el Gate 2 (modo `code`)** cuando el implementer escriba el cuerpo del RPC, asentadas acá para trazabilidad:

- **R1-NEW (verificar en `code`, no spec)**: el **cuerpo** de `register_birth` (creación de los N terneros + parseo de `p_calves`) queda a cargo del implementer (l.1606). El contrato de seguridad (firma, authz, grant, search_path, herencia de tenant) está firme y es lo que el Gate 1 certifica; el cuerpo debe re-revisarse en modo `code` para confirmar que (i) cada `animal_profile` de ternero hereda `v_est` literal (no relee un establishment de otra fila), (ii) el `visual_id_alt` / TAG por ternero no rompe la unicidad as-built, (iii) no hay `EXECUTE` dinámico sobre el jsonb. Esto NO es un finding de spec — es el alcance normal de Gate 2 sobre el diff real.
- **R2-NEW (MEDIUM, verificar en `code`)**: la atomicidad "rollback total" (l.1575, l.1605, l.1625) se cumple **solo si** el cuerpo no captura excepciones con un `exception when others then ... return` que las trague. El contrato lo declara correctamente; el riesgo es de implementación, no de diseño. T2.19 caso 2 (variante de control: madre propia crea parto + N terneros + N filas en una transacción) lo cubre parcialmente, pero el caso de **rollback parcial** (ternero #2 inválido → no debe quedar el evento ni el ternero #1) merece un sub-test explícito en `code`. Recomendación al implementer: que la suite verifique el rollback ante fallo de un ternero intermedio, no solo el camino feliz. No bloquea el spec.

### Cobertura de T2.19 (tests de no-bypass) — verificada

Los 6 casos de T2.19 (tasks.md l.446-451) cubren los 4 findings + las dos notas L2/control del reporte previo:

| Caso T2.19 | Cubre | Verificado |
|---|---|---|
| 1 — autor-sin-rol → `42501`, status sin cambiar | SEC-SPEC-01 | Sí — espejo de T2.18, con variante de control owner→procede. |
| 2 — `register_birth` cross-tenant A→B → `42501`, nada creado | SEC-SPEC-02 | Sí — verifica que NO se crea evento/animals/birth_calves; control madre-propia crea todo. |
| 3 — INSERT directo a `birth_calves` → bloqueado | SEC-SPEC-04 | Sí — sin GRANT INSERT, permission denied. |
| 4 — SELECT filtra parto soft-deleted | SEC-SPEC-04.a | Sí — 0 filas para `authenticated`, presentes con `service_role`. |
| 5 — `created_by` forzado server-side | SEC-SPEC-03 | Sí — `created_by = <uid ajeno>` ignorado; corolario de authz de R4.14. |
| 6 — L2: alta de ternero al pie no bloqueada por triggers | L2 anexo previo | Sí — no-regresión contra `rodeo_same_system_check` (`0047`) ni `category_check` as-built. |

Falta cubierto solo el **rollback parcial** de `register_birth` (R2-NEW), que es de Gate 2/code, no de spec.

### Conclusión del re-audit

**PASS.** Los 4 findings (2 HIGH + 2 MEDIUM) están cerrados con SQL firme alineado al patrón canónico `0041`/`0042` y al cierre de SEC-HIGH-01. El RPC nuevo `register_birth` no introduce regresión: contrato de seguridad completo (grant acotado, revoke from public/anon, search_path, authz sobre fila real, herencia de tenant). El delta Tier 1 puede avanzar a implementación. Las dos notas nuevas (R1-NEW informativa, R2-NEW rollback parcial) son alcance del Gate 2 (modo `code`) sobre el cuerpo real del RPC — el leader debería asegurarse de que el re-review `code` post-implementer chequee el rollback parcial y el cuerpo del `register_birth`, dado que la skill `sentry-skills:security-review` **no cubre PL/pgSQL ni el modelo de exposición RPC de PostgREST** (advertencia heredada del Gate 2 sesión 15).

---

## (HISTORIAL) Corrida previa — Gate 1 FAIL (sesión 20)

**Agente**: security_analyzer (Gate 1, modo `spec`).
**Fecha**: 2026-05-30 (sesión 20).
**Alcance**: SOLO el **delta Tier 1** del bloque backend de spec 02 (fold sesión 20) — los 5 items de las migrations **propuestas** `0043-0047`. El backend ya cerrado (migrations 0013-0042, Gate 2 sesión 15) NO se re-audita salvo donde el delta lo toca.
**Input auditado**:
- `requirements.md`: R4.1, R4.5.1, R4.14/R4.15, R6.14, R7.9/R9.5, R9.4, R10.3.
- `design.md` § "Fold del Tier 1 — bloque backend delta s17/s18" (l.741-894) + SQL de `compute_category`/`apply_auto_transition` reusado (l.1288-1419) + trigger as-built `tg_reproductive_events_create_calf` (l.1547-1614) + RLS as-built de `birth_calves` (l.1496-1531).
- Baseline as-built: `0041_soft_delete_rpcs.sql`, `0042_revoke_internal_function_grants.sql`, `0005_rls_helpers.sql`, `0020_animal_profiles.sql`.
**Naturaleza**: modo `spec`, **no hay diff de código** — las migrations 0043+ NO existían aún. Se auditó el **SQL propuesto en el design** como especificación firme.

### Veredicto previo: FAIL

Dos findings **HIGH** exploitables y dos **MEDIUM**. Los dos HIGH eran de la **misma clase que el SEC-HIGH-01** que se cerró en sesión 15 (autorización incompleta en `SECURITY DEFINER`): el RPC `exit_animal_profile` (item 2) y el RPC multi-ternero **no especificado** (item 3). El resto del delta (item 4 recálculo, item 5 cambio de rodeo) estaba sólido y reusaba correctamente los patrones as-built. FAIL por findings concretos de fix barato — no requería decisión arquitectónica.

### Findings HIGH (previos — todos CERRADOS en el re-audit)

#### [SEC-SPEC-01] `exit_animal_profile` — autorización por `created_by` sin chequear rol activo (CWE-862)
- **Location**: `design.md` (RPC `exit_animal_profile`, migration `0044`). Requirement: R4.14.
- **Confidence**: HIGH.

**Problema**: la rama `v_creator = auth.uid()` autorizaba la baja **sin verificar rol activo** en el establishment. `exit_animal_profile` es `SECURITY DEFINER` (bypassa RLS). Un usuario que cargó un animal y luego fue dado de baja del establecimiento (`user_roles.active = false`) seguía matcheando `v_creator = auth.uid()` y podía dar de baja el animal. Mismo-tenant authz bypass de un actor que ya no debería tener acceso. El patrón canónico `soft_delete_animal_event` (`0041` l.78) exige `has_role_in` **además** de la autoría; el RPC propuesto lo omitía.

**Propuesta de cambio dada**: `has_role_in(v_est) and (is_owner_of(v_est) or v_creator = auth.uid())` + test de no-bypass del autor-sin-rol. → **Aplicada literal (l.855-858 + T2.19 caso 1). CERRADO.**

**Nota colateral (deuda pre-existente)**: `soft_delete_event` genérico (`0041` l.110) también omite `has_role_in` (`is_owner_of(v_est) or v_created_by = auth.uid()`). Fuera del alcance Tier 1; candidato a `docs/backlog.md`.

#### [SEC-SPEC-02] RPC multi-ternero (mellizos) — `SECURITY DEFINER` solo en prosa, sin contrato de seguridad (CWE-862 / CWE-639 potencial)
- **Location**: `design.md` (caso multi-ternero, migration `0045`). Requirements: R7.9, R9.5, R9.4.
- **Confidence**: HIGH.

**Problema**: el RPC era funcionalmente idéntico, en superficie de riesgo, a `apply_auto_transition` (SEC-HIGH-01): un `SECURITY DEFINER` que **escribe `animal_profiles`** con input del cliente. El design lo dejaba sin SQL: no especificaba (a) `revoke ... from public, anon` + grant a `authenticated` con firma; (b) authz `has_role_in` sobre el establishment derivado de la **fila real** de la madre, no del cliente; (c) `set search_path = public`. "El RPC concreto y su firma los define el implementer" trasladaba el riesgo de SEC-HIGH-01 al implementer sin contrato firme.

**Propuesta de cambio dada**: especificar el SQL firme del RPC con grant acotado, search_path, authz sobre fila real, test de no-bypass cross-tenant; no soltarlo a implementación hasta especificarlo. → **Aplicada: el RPC `register_birth(uuid, date, jsonb)` es ahora SQL firme (l.1584-1625) + T2.19 caso 2. CERRADO.**

### Findings MEDIUM (previos — ambos CERRADOS en el re-audit)

#### [SEC-SPEC-03] `created_by` autopoblado solo cuando NULL → spoofeable y load-bearing para authz
- **Location**: `design.md` (trigger `animal_profiles_set_created_by`, migration `0043`, reusaba `tg_set_created_by_auth_uid`). Requirement: R4.1, consumido por R4.14.
- **Confidence**: MEDIUM.

**Problema**: el trigger solo seteaba `created_by` cuando venía NULL. En `animal_profiles`, `created_by` pasó a ser dato de **autorización** (`exit_animal_profile`, R4.14). Como la policy de INSERT solo exige `has_role_in`, cualquier rol operativo activo podía setear `created_by` a un UUID arbitrario (atribuir alta a otro / plantar cómplice para la baja vía `v_creator = auth.uid()`). MEDIUM (no cross-tenant, requiere rol).

**Propuesta de cambio dada**: trigger que **siempre** sobreescribe server-side. → **Aplicada: `tg_force_created_by_auth_uid` (l.775-789) + T2.19 caso 5. CERRADO.**

#### [SEC-SPEC-04] `birth_calves` — INSERT directo de cliente + RLS sin filtro `deleted_at`
- **Location**: `design.md` (RLS + grant de `birth_calves`, migration `0045`). Requirements: R7.9, R11.2.
- **Confidence**: MEDIUM.

**Problema 1**: la policy de INSERT solo validaba `has_role_in` sobre la madre; **no validaba nada sobre `calf_profile_id`** (ni mismo establishment, ni que sea ternero). Con `grant insert ... to authenticated`, un usuario podía linkear cualquier `calf_profile_id` a un parto, fabricando parentesco falso. **Problema 2**: ambas policies derivaban el establishment vía `reproductive_events re` **sin** `re.deleted_at is null` — tras soft-deletear el parto, las filas seguían visibles/insertables.

**Propuesta de cambio dada**: agregar `re.deleted_at is null`; quitar el INSERT del grant y poblar solo server-side. → **Aplicada: solo `grant select` (l.1560), sin policy de INSERT, `re.deleted_at is null` en SELECT (l.1549) + T2.19 casos 3 y 4. CERRADO.**

### Items revisados sin findings (delta Tier 1) — siguen OK

- **Item 4 — recálculo de categoría (`0046`, R6.14)**: `tg_reproductive_events_recompute_on_change` es `SECURITY DEFINER` con `search_path = public`, es **trigger** (no superficie RPC), respeta el override conservador (NULL = no recalcula), reusa `apply_auto_transition` (que conserva EXECUTE por ser SD pese al revoke de `0042`). Sin hallazgo.
- **Item 5 — cambio de rodeo mismo-sistema (`0047`, R4.5.1)**: `tg_animal_profiles_rodeo_same_system_check` enforce a nivel DB vía `before update of rodeo_id` (no evadible desde PostgREST), `SECURITY DEFINER` + `search_path = public` justificado, no es RPC. Sin hallazgo.
- **Item 2 — conversión `exit_reason` text→enum (`0044`, primera mitad)**: backfill defensivo + `nullif(trim(...),'')::enum`, sin `EXECUTE`/`format()` dinámico. Sin hallazgo.

### Dominios de seguridad revisados (trazabilidad, re-audit)

| Dominio | Cubierto | Resultado re-audit |
|---|---|---|
| RPC `SECURITY DEFINER` (authz + grant + search_path) | Sí | SEC-SPEC-01 CERRADO, SEC-SPEC-02 CERRADO; `register_birth` sin regresión |
| RLS de tabla nueva (`birth_calves`) + filtro `deleted_at` | Sí | SEC-SPEC-04 CERRADO |
| Trigger de autoría load-bearing para authz (`created_by`) | Sí | SEC-SPEC-03 CERRADO |
| Multi-tenant isolation (cross-establishment write) | Sí | Cerrado en items 4/5 y en RPCs (authz sobre fila real) |
| Triggers DB bypasseables desde cliente | Sí | Item 5 OK (BEFORE trigger); item 4 OK |
| SQL injection (EXECUTE/format dinámico) | Sí | Ninguno en el delta (incl. parseo jsonb de `register_birth`) |
| Secrets hardcodeados | Sí | Ninguno (migrations SQL) |
| `search_path` pinning en SD | Sí | OK en todos los SD del delta, incl. `register_birth` (l.1590) |
| Atomicidad / rollback de RPC multi-fila | Sí | Contrato OK; rollback **parcial** → verificar en `code` (R2-NEW) |

### Dominios excluidos (con justificación) — sin cambios

- **Tier 2** (`abortion`/`weaning`), **Tier 3** (razas SENASA, `castracion`), **Feature 11** (transferencia re-parenting): FUERA del fold, Gate 1 propio cuando apliquen.
- **Backend ya cerrado (0013-0042)**: re-auditado solo donde el delta lo toca.
- **PowerSync / offline** (`est_birth_calves` bucket): config de sync, no superficie de seguridad nueva.

### Advertencias de cobertura

- Modo `spec`: **no se corrió `sentry-skills:security-review`** (no hay diff de código; las migrations 0043+ no existen). Auditoría manual sobre el SQL firme del design. La skill **no cubre nativamente Postgres/PL-pgSQL/RLS ni el modelo de exposición RPC de PostgREST** — los findings cerrados y las notas R1/R2-NEW son justamente del ángulo RAFAQ-específico que la skill no atrapa.
- El **cuerpo** de `register_birth` (creación de N terneros) se escribe en implementación; debe re-revisarse en modo `code` antes de Gate 2 (R1-NEW, R2-NEW). El contrato de seguridad (lo que el Gate 1 certifica) está firme.

### Anexo LOW (trazabilidad, no bloqueante)
- **L1**: `soft_delete_event` (`0041` l.110, as-built ya mergeado) comparte la debilidad de SEC-SPEC-01 (omite `has_role_in`). Fuera del alcance Tier 1; candidato a `docs/backlog.md` como deuda de seguridad pre-existente.
- **L2**: el alta de ternero al pie (mono o mellizos) no debe ser bloqueada por `tg_animal_profiles_rodeo_same_system_check` (`0047`) ni por el `category_check` as-built. → Cubierto por T2.19 caso 6.
