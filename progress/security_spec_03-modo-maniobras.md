# Security Spec Review — 03-modo-maniobras (Gate 1, modo `spec`) — RE-AUDITORÍA DEL DELTA (hardening leader s18)

## VEREDICTO: **PASS**

> El **delta de hardening** (R4.7 cambio de rodeo de la sesión; R4.4 mejorado con rodeo de origen; R10.8
> surfacing de rechazos de sync; nota de orden de cierre offline en design §5; afinado del trigger dientes/CUT
> aditivo-vs-sustractivo; R6.9 captura explícita de peso) **NO introduce regresiones ni vulnerabilidades nuevas
> HIGH**. Los **3 HIGH** previos (SEC-SPEC-03-01/02/03) siguen **CERRADOS**; el afinado del trigger dientes/CUT
> **no abre bypass** (todo cambio aditivo se gatea; todo sustractivo es provablemente seguro). Las 2 MEDIUM
> (03-04/05) y la LOW (03-06) siguen cerradas. Lo único pendiente son **decisiones de PRODUCTO** (D8
> enforce-vs-excluir dientes/CUT — ya resuelta a ENFORCE AFINADO por Raf; D9 re-verificación cross-spec del
> find-or-create en Gate 2) → **NEEDS_CLARIFICATION para la puerta humana**, NO motivo de FAIL.

**Agente**: security_analyzer (Gate 1, modo `spec`) — **re-auditoría del DELTA** sobre spec que ya pasó Gate 1 PASS.
**Fecha**: 2026-05-30 (sesión 18).
**Alcance de esta corrida**: confirmar que el delta foldeado tras el cuestionamiento del leader (aprobado por Raf)
NO introduce regresiones ni huecos nuevos, y que los findings previos (SEC-SPEC-03-01..06) siguen cerrados.
**Naturaleza**: modo `spec` — no hay diff de código (migrations 0050-0055 NO existen aún; `git status` no muestra
cambios en `supabase/`). Se auditó el **SQL firme propuesto en `design.md`** + su reflejo en requirements/tasks.
NO se corrió `sentry-skills:security-review` (sin diff de código — corresponde al Gate 2 `code`).

---

## Verificación as-built (re-corrida en esta auditoría del delta)

| Premisa load-bearing (relevante al delta) | Verificación esta corrida | Resultado |
|---|---|---|
| `current_animal_rodeo` / `get_rodeo_data_keys` NO existen as-built | grep sobre `supabase/migrations/` | **0 hits** (confirmado, "No files found") |
| Última migración real = `0049` → próximo libre = `0050` (árbol sin cambios desde la corrida previa) | glob `supabase/migrations/*.sql` | confirmado (`0049_birth_calves_service_role_grant.sql` es la última; 0050+ no existen) |
| trigger de **mismo-sistema** que valida UPDATE de `animal_profiles.rodeo_id` (base de R4.4/R4.7) | `0047_rodeo_change_same_system.sql` existe en el árbol | confirmado (presente) |
| `animal_profiles.rodeo_id` (resolución inline del gating y del check (b)) | `0020_animal_profiles.sql` presente | confirmado (NOT NULL verificado corrida previa; archivo sin cambios) |
| policy `animal_profiles_update` solo `has_role_in` (hueco que cierra 03-01 / trigger afinado) | `0022_rls_animals_and_profiles.sql` presente | confirmado (sin cambios desde corrida previa) |
| `establishment_of_profile(uuid)` (tenant-check) | `0023_event_helpers.sql` presente | confirmado |
| `tg_force_created_by_auth_uid()` (created_by forzado) | `0043_animal_profiles_created_by.sql` presente | confirmado |
| join `rodeo_data_config`/`field_definitions` del gating | `0018_field_template_and_rodeo_config.sql` presente | confirmado |
| `session_id uuid` ya existe en las 5 tablas (sin FK) | `0025-0029` presentes | confirmado |

**Conclusión as-built**: el árbol de migraciones NO cambió desde la corrida PASS previa (sigue terminando en
`0049`, sin migrations 0050+). Las funciones fantasma siguen inexistentes (0 hits). El trigger `0047`
(mismo-sistema) que respalda R4.4/R4.7 está presente. Todas las premisas del delta se sostienen.

---

## El DELTA auditado (cambios nuevos sobre la spec que ya pasó)

| # | Cambio del delta | Foco de seguridad | Veredicto |
|---|---|---|---|
| D-Δ1 | **R4.7** + design §2.3 nota: cambiar `sessions.rodeo_id` a mitad de jornada | ¿abre bypass del gating o del tenant-check intra (b)? ¿cruza tenant? | **N-A (sin hueco)** |
| D-Δ2 | **R4.4 mejorado**: confirmación muestra rodeo de origen | ¿filtra dato cross-tenant? | **N-A (sin hueco)** |
| D-Δ3 | **R10.8** + design §5: surfacing de eventos rechazados al sincronizar | ¿el motivo del rechazo revela config/datos de otro tenant? | **N-A (sin hueco)** |
| D-Δ4 | **design §5**: orden de cierre offline + check intra-tenant (a) "active" | ¿se relaja el rechazo / hay camino fail-open? | **N-A (fail-closed intacto)** |
| D-Δ5 | **R6.9**: captura explícita de peso | UX; sin superficie de seguridad | **N-A (out of scope)** |
| D-Δ6 | **Afinado del trigger dientes/CUT** (aditivo gatea, sustractivo permite) | ¿el afinado abre bypass de ADR-021 (capa 2)? | **CERRADO (afinado seguro)** |

Findings nuevos HIGH en esta re-auditoría del delta: **ninguno**.

---

## Análisis del delta, ítem por ítem

### [D-Δ1] R4.7 — cambiar `sessions.rodeo_id` a mitad de jornada — **N-A (sin hueco)**

**Premisa del delta**: el check intra-tenant (b) del tenant-check (design §2.3, `v_event_rod is distinct from
v_session_rod`) exige que el rodeo del animal del evento coincida con `sessions.rodeo_id`. R4.7 ofrece **cambiar
el rodeo de la sesión** cuando la jornada se configuró con el rodeo equivocado, en vez de mover N animales uno
por uno.

**¿Abre bypass del gating de eventos (capa 2)?** **No.** El gating de capa 2 sobre eventos
(`assert_data_keys_enabled`, design §4) resuelve el rodeo **del animal** inline desde `animal_profiles.rodeo_id`
del perfil activo, **independiente** de `sessions.rodeo_id`. Cambiar el rodeo de la sesión no toca ese eje: un
evento sobre un animal cuyo rodeo no tiene el `data_key` habilitado se sigue rechazando.

**¿Abre bypass del tenant-check intra (b)?** **No.** El trigger `tg_event_session_tenant_check` lee
`sessions.rodeo_id` **fresco en cada insert** (design §2.3: `select ... rodeo_id ... from public.sessions where
id = new.session_id`). Tras cambiar el rodeo de la sesión, los eventos siguientes se validan contra el rodeo
NUEVO. No hay ventana donde el check (b) deje de aplicar.

**¿Cruza tenant?** **No.** Todo UPDATE de `sessions.rodeo_id` dispara `tg_sessions_rodeo_check` (`before insert
or update`, design §2.1), que exige que el nuevo rodeo pertenezca al **mismo establishment** de la sesión y esté
activo, levantando `23514` si no. Un rodeo de otro tenant no es elegible. Sumado a la RLS de `sessions`
(`has_role_in(establishment_id)`), no hay camino cross-tenant. **Verificación importante**: el cambio de
`sessions.rodeo_id` está cubierto por `tg_sessions_rodeo_check` que el design ya define como `before insert OR
UPDATE` — o sea, R4.7 NO requiere un trigger nuevo y no introduce superficie nueva; reusa el guard ya auditado.

**¿Eventos colgando con rodeo inconsistente?** Los eventos ya insertados con el rodeo viejo **no** se
re-validan retroactivamente (el trigger es per-row on insert / update-of-session_id, no on cambio de
`sessions.rodeo_id`). Eso es consistente con append-only (ADR-017) y con que "una sesión = un rodeo" es un check
**point-in-time** sobre el animal al momento del insert. **No es un hueco de seguridad**: (i) no hay leak
cross-tenant; (ii) el gating de analytics de cada evento se evaluó contra el rodeo REAL del animal al
insertarlo, no contra `sessions.rodeo_id`; (iii) la consistencia "todos los eventos de la sesión = mismo rodeo"
es metadata de auditoría de jornada, no un constraint de integridad de datos regulados. Es, a lo sumo, una
**observación de consistencia de auditoría** que el design ya reconoce (design §2.3, "Auditoría de movimientos
de rodeo" → backlog, no bloqueante). → **N-A para Gate 1.**

### [D-Δ2] R4.4 mejorado — confirmación muestra rodeo de origen — **N-A (sin hueco)**

R4.5 garantiza que el animal identificado de "otro rodeo" candidato a [pasar a este rodeo] es del **mismo
establishment** (un animal de otro establishment se salta, R4.5; no se ofrece moverlo). El nombre del rodeo de
origen se lee del propio `animal_profile` del animal, ya visible al usuario por RLS (`has_role_in`). No hay dato
de otro tenant en la confirmación. → **N-A.**

### [D-Δ3] R10.8 — surfacing de eventos rechazados al sincronizar — **N-A (sin hueco)**

El "hacer visible el rechazo" surfacea el **motivo** que produce el `raise exception` del trigger. Revisé los
mensajes de error de los dos triggers que pueden rechazar un evento al sincronizar:

- `tg_event_session_tenant_check` (design §2.3): los mensajes exponen `new.session_id`, `v_session_st`,
  `v_event_rod`, `v_session_rod` — **todo dato del propio tenant del caller** (su sesión, su animal). El mensaje
  cross-tenant dice únicamente *"event session belongs to a different establishment than the animal"* — **NO**
  revela id, nombre ni config del otro establishment.
- `assert_data_keys_enabled` (design §4): mensajes con `p_animal_profile_id`, `v_rodeo`, `p_data_keys` — dato del
  propio tenant.

Conclusión: surfacear estos motivos al operario **no expone información de otro tenant** (no hay config/datos de
otro establishment en ningún mensaje). El surfacing además NO es un dead-letter silencioso (principio
offline-first) — positivo. → **N-A (sin hueco).** *Nota para Gate 2 (`code`)*: cuando se implemente el cliente
(T4.6), verificar que la UI no concatene/derive datos de otro tenant al renderizar el motivo (hoy los mensajes
del trigger son tenant-safe; el riesgo sería un bug de UI, no del diseño).

### [D-Δ4] design §5 — orden de cierre offline + check (a) "sesión active" — **N-A (fail-closed intacto)**

La nota de design §5 NO relaja el rechazo. El check (a) (`tg_event_session_tenant_check`, design §2.3) sigue
siendo un rechazo duro: `if v_session_st <> 'active' then raise ... '23514'`. La nota aclara que, **offline**, el
orden create-events→close depende de que PowerSync re-aplique las mutaciones del cliente **en orden** (los
eventos creados antes del cierre suben antes que la mutación `status='closed'`). Eso evita **falsos rechazos** de
eventos legítimamente creados mientras la sesión estaba activa — NO crea un camino que deje pasar un evento
sobre una sesión ya cerrada. Una corrección tardía de un evento ya cerrado usa el edit per-evento de spec 02,
que **NO re-apunta `session_id`** → NO dispara el trigger. **No hay fail-open.** T2.6 testea explícitamente el
patrón create-events→close (no rechaza los ya creados) y el insert de evento NUEVO contra sesión closed (rechaza
`23514`). → **N-A (fail-closed no se debilitó).**

### [D-Δ5] R6.9 — captura explícita de peso — **N-A (out of scope)**

Acción explícita "pesar" sobre el animal en cepo (vs stream pasivo de balanza), para no adjudicar una lectura
con lag al animal equivocado. Es correctness/UX de campo; **sin superficie de auth, tenant ni secrets**. → **N-A.**

### [D-Δ6] Afinado del trigger dientes/CUT (aditivo-gatea / sustractivo-permite) — **CERRADO (afinado seguro)**

Este es el ítem crítico para regresión de **SEC-SPEC-03-01**. El trigger afinado (design §4) dispara con
`WHEN (new.teeth_state IS DISTINCT FROM old.teeth_state OR new.is_cut IS DISTINCT FROM old.is_cut)` y por dentro
**solo invoca `assert_data_keys_enabled`** cuando:

```sql
if (new.teeth_state is distinct from old.teeth_state and new.teeth_state is not null)
   or (new.is_cut is distinct from old.is_cut and new.is_cut = true) then
  perform public.assert_data_keys_enabled(new.id, array['dientes']);
end if;
```

**Verificación exhaustiva de que el afinado NO abre bypass** (un cambio sustractivo no puede introducir dato
prohibido; un aditivo siempre se gatea):

| Transición | ¿gateada? | ¿correcta? |
|---|---|---|
| `teeth_state` NULL → no-NULL (aditivo) | **SÍ** (distinct + not null) | ✅ escribe dato → debe gatearse |
| `teeth_state` no-NULL → otro no-NULL (`1/2`→`1/4`, aditivo) | **SÍ** (distinct + not null) | ✅ sigue escribiendo dato → gatea |
| `teeth_state` no-NULL → NULL (sustractivo) | NO | ✅ solo limpia; no puede meter dato prohibido |
| `is_cut` false → true (aditivo) | **SÍ** (distinct + =true) | ✅ marca CUT → gatea |
| `is_cut` NULL → true (aditivo) | **SÍ** (distinct + =true) | ✅ gatea |
| `is_cut` true → false (sustractivo) | NO | ✅ solo desmarca; seguro |
| `is_cut` true → NULL (sustractivo) | NO (`new.is_cut = true` es falso si NULL) | ✅ solo desmarca; seguro |
| `category_id` cambia solo (sin tocar teeth/is_cut) | NO | ✅ es la transición de categoría de spec 02 (R8.1); NO debe gatearse por dientes |
| `teeth_state` no-NULL **igual** a old (no cambia) | NO | ✅ no introduce dato nuevo (ya estaba) → sin bypass |

**Punto de bypass clave evaluado**: ¿se puede escribir un `teeth_state` no-NULL sobre un rodeo sin `dientes` SIN
ser gateado? El inner gating dispara siempre que `new.teeth_state IS NOT NULL AND new.teeth_state IS DISTINCT
FROM old.teeth_state`. La única forma de tener un `teeth_state` no-NULL y NO gatear es que el valor **no cambie**
(`IS NOT DISTINCT FROM old`) — y si no cambia, no se introduce dato prohibido nuevo (ya estaba en la fila). **No
hay bypass.** Todo aditivo se gatea; todo sustractivo es provablemente seguro (solo quita dato → no puede
ensuciar analytics de un rodeo sin `dientes`). El afinado es **estrictamente más permisivo solo en el eje
sustractivo**, que es inerte para ADR-021.

**Anti-regresión del enforcement**: el trigger sigue SECURITY DEFINER + `set search_path = public` + `revoke
execute ... from public, authenticated, anon`; reusa `assert_data_keys_enabled(new.id, ...)` que hereda la
resolución inline (03-02) y el fail-closed (03-03). Sin recursión (solo SELECT, no UPDATE sobre
`animal_profiles`). La guarda `WHEN` NULL-safe evita gatear UPDATE de lote (R9.2) y de rodeo (R4.4). Reflejado en
**R7.5** (requirements) y testeado en **T2.11** (tasks, incl. casos E/F sustractivos aceptados + guarda
lote/rodeo no-gatea + aditivos rechazados sobre rodeo sin `dientes`). → **SEC-SPEC-03-01 sigue CERRADO; el
afinado no lo regresó.**

**Residual (no bloqueante)**: la consistencia de `category_id`/`category_override` al **desmarcar** `is_cut`
(revertir a la categoría previa, R6.8) es **invariante de aplicación**, fuera del alcance del gate (el gate solo
previene contaminación de analytics; permitir el sustractivo es correcto). El design lo declara explícitamente
(D8, design §9). No es un hueco de seguridad; es un requisito de correctness de cliente a verificar en Gate 2
(`code`) cuando se implemente `maneuverEvents.ts` (T3.6).

---

## Trazabilidad de los findings previos (siguen CERRADOS tras el delta)

| id | sev (FAIL original) | estado tras delta | evidencia |
|---|---|---|---|
| **SEC-SPEC-03-01** | HIGH | **CERRADO** (afinado seguro, D-Δ6) | design §4 (trigger afinado aditivo/sustractivo + SECURITY DEFINER + revoke EXECUTE + guarda `IS DISTINCT FROM`); requirements **R7.5**; tasks **T2.11**. Hueco confirmado as-built (`0022` `animal_profiles_update` solo `has_role_in`). Producto D8 = ENFORCE AFINADO (resuelto por Raf) |
| **SEC-SPEC-03-02** | HIGH | **CERRADO** (dependencia eliminada) | design §4 (rodeo INLINE `animal_profiles.rodeo_id` perfil activo) + cabecera obsoletiza funciones fantasma; requirements R5.3/R5.6/R7.1. **0 hits as-built** de `current_animal_rodeo`/`get_rodeo_data_keys` (grep esta corrida) |
| **SEC-SPEC-03-03** | HIGH | **CERRADO** | design §4 (`if v_rodeo is null then raise '23514'`; prohíbe early-return fail-open; `v_have < v_need` → raise); requirements **R7.6**; tasks **T2.4b** |
| SEC-SPEC-03-04 | MED | **CERRADO** | design §2.3 (`status='active'` + rodeo igual + cross-tenant); tasks **T2.6**. El delta R4.7/§5 interactúa con este check y **no lo debilita** (D-Δ1, D-Δ4) |
| SEC-SPEC-03-05 | MED | **CERRADO** (dependencia de orden) | design §7 + §9 D9; tasks **T2.12** (re-check Gate 2 `code`). UNIQUE existe as-built (`0020`) |
| SEC-SPEC-03-06 | LOW | **CERRADO** | design §2.1 + §2.2 (CHECK `octet_length(config::text) < 16384`); tasks T1.1 / T1.2 |

**Clase SEC-HIGH-01 de spec 02 (no reintroducida)**: las 3 funciones SECURITY DEFINER del design
(`assert_data_keys_enabled`, `tg_event_session_tenant_check`, `tg_animal_profiles_teeth_gating`) tienen `revoke
execute ... from public, authenticated, anon` + `set search_path = public`; `created_by` forzado vía
`tg_force_created_by_auth_uid` (sessions / maneuver_presets); authz derivada de la fila real
(`establishment_of_profile` + lectura inline de `animal_profiles.rodeo_id`), no del payload. **Patrón intacto.**

NEEDS_CLARIFICATION abiertos (puerta humana — NO son FAIL):
- **D8** (design §9) — RESUELTO por Raf = ENFORCE AFINADO. Se mantiene como ítem de confirmación humana formal
  (decisión de producto, no de seguridad).
- **D9** (design §9) — find-or-create inline de spec 09: re-verificar en Gate 2 `code` cuando spec 09 esté
  integrada (dependencia de orden).

---

## Dominios revisados (trazabilidad de esta re-auditoría del delta)

| Dominio (delta) | Resultado |
|---|---|
| Cambio de `sessions.rodeo_id` mid-jornada (R4.7) — bypass gating/tenant-check | N-A (sin hueco; reusa `tg_sessions_rodeo_check`; D-Δ1) |
| Cambio de `sessions.rodeo_id` — cross-tenant | N-A (bloqueado por `tg_sessions_rodeo_check` + RLS; D-Δ1) |
| Confirmación con rodeo de origen (R4.4) — leak cross-tenant | N-A (mismo tenant por R4.5; D-Δ2) |
| Surfacing de rechazos de sync (R10.8) — leak de motivo cross-tenant | N-A (mensajes tenant-safe; D-Δ3) |
| Orden de cierre offline (§5) — fail-open / relajación del rechazo | N-A (fail-closed intacto; D-Δ4) |
| Afinado trigger dientes/CUT (aditivo/sustractivo) — bypass de ADR-021 | CERRADO (afinado seguro; D-Δ6) |
| Anti-regresión SEC-SPEC-03-01..06 | Todos CERRADOS |
| Anti-regresión clase SEC-HIGH-01 (revoke EXECUTE / search_path / created_by / authz fila real) | Patrón intacto |

## Dominios excluidos (con justificación)

- **R6.9 captura explícita de peso**: correctness/UX, sin superficie de auth/tenant/secrets (D-Δ5).
- **BLE / `StickReader`** (design §6): canal Bluetooth directo, no superficie de auth/red.
- **PowerSync sync rules** (design §5): el enforcement real es RLS (cubierto); verificar en `code` que el bucket
  de `sessions`/`maneuver_presets` scopee por `establishment_id` (T4.6).
- **Decisiones abiertas D1-D7** (design §9): producto/coordinación, no seguridad.

---

## Acción de seguimiento (para Gate 2 / leader)

1. **Puerta humana** — Raf confirma formalmente **D8** (ENFORCE AFINADO, ya resuelto) y **D9** (re-verificar
   find-or-create de spec 09 en Gate 2). Ninguna requiere ADR ni decisión arquitectónica nueva.
2. **Gate 2 (`code`) OBLIGATORIO** sobre el diff real de migrations 0050-0055 + cliente: correr
   `sentry-skills:security-review` sobre el TS y re-verificar el SQL firme materializado — con foco en (a) el
   afinado aditivo/sustractivo del trigger dientes/CUT, (b) `tg_sessions_rodeo_check` cubre el cambio de rodeo de
   sesión (R4.7) como `before insert OR update`, (c) que la UI de surfacing de rechazos (R10.8) no derive datos
   de otro tenant.

---

## Conclusión

**PASS.** El delta de hardening (R4.7 cambio de rodeo de sesión, R4.4 con rodeo de origen, R10.8 surfacing de
rechazos, nota de orden de cierre offline, afinado del trigger dientes/CUT, R6.9 captura explícita de peso)
**NO introduce regresiones ni vulnerabilidades nuevas HIGH**. El cambio de `sessions.rodeo_id` no abre bypass
del gating (resuelto por animal, no por sesión) ni del tenant-check (lee la sesión fresco en cada insert) ni
cruza tenant (`tg_sessions_rodeo_check` `before insert OR update` + RLS). El surfacing de rechazos usa mensajes
tenant-safe. El orden de cierre offline no debilita el fail-closed. El afinado del trigger dientes/CUT gatea todo
cambio aditivo y permite todo sustractivo (provablemente inerte para ADR-021) — sin bypass. Los 3 HIGH previos
siguen cerrados, las 2 MEDIUM y la LOW también, y el patrón de spec 02 (revoke EXECUTE, search_path, created_by
forzado, authz sobre fila real, RLS canónico) está intacto. Pendiente solo **decisiones de producto (D8/D9)** →
**NEEDS_CLARIFICATION para la puerta humana**, NO motivo de FAIL.

> Cobertura de esta corrida: `requirements.md`, `design.md`, `tasks.md` y reporte previo leídos completos. Grep
> as-built re-corrido esta corrida (0 hits funciones fantasma; árbol termina en `0049`; `0047` mismo-sistema
> presente). El re-grep fino del SQL materializado se delega a Gate 2 cuando existan las migrations 0050+.
