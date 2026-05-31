# Security Code Review — 03-modo-maniobras (Gate 2, modo `code`, ADR-019)

## VEREDICTO: **PASS**

> El backend de spec 03 (migraciones 0050–0057 + suite `supabase/tests/maneuvers/run.cjs`) **NO
> introduce vulnerabilidades HIGH**. Los 9 focos de seguridad del Gate 2 verifican **CERRADO** contra
> el SQL real. La clase SEC-HIGH-01 de spec 02 (SECURITY DEFINER expuesta como RPC) **no se
> reintroduce** — las 10 funciones internas tienen `set search_path = public` + `revoke execute from
> public, authenticated, anon`, y 0055 lo reconfirma con un smoke-check fail-closed en runtime. El
> gating es fail-closed; el rodeo se resuelve inline; el trigger dientes/CUT afinado no abre bypass
> aditivo; el FIX 0056 cierra el bypass cross-tenant del tenant-check de `session_id` que 0052
> dejaba abierto; `created_by` se fuerza server-side; las RLS son canónicas sin DELETE de cliente; el
> soft-delete por RPC re-valida `has_role_in` dentro de la SECURITY DEFINER. Único pendiente: la
> re-verificación cross-spec del find-or-create inline (D9/T2.12), **diferida legítimamente** a la
> integración de spec 09 — NO es FAIL.

**Agente**: security_analyzer (Gate 2, modo `code`).
**Fecha**: 2026-05-30 (sesión 18).
**baseline_commit**: `56f27438ed19535e86506190ff7606a3d4f3ae6b` (de `progress/impl_03-modo-maniobras.md`).
**Alcance**: Fase 1/2 backend (migraciones 0050–0057 + `supabase/tests/maneuvers/run.cjs`). Cliente
(Fase 3/4: BLE, services, hooks, pantallas, PowerSync) **diferido** — fuera de alcance.
**Metodología**: trace data-flow + verificación de exploitability ANTES de reportar (per
`sentry-skills:security-review`). La skill de Sentry es una skill de **metodología** (no agente
autónomo): se cargó y se aplicó su procedimiento manualmente sobre los 8 archivos SQL + la suite,
leídos completos. Complementado con el checklist RAFAQ-específico (RLS / SECURITY DEFINER / tenant
isolation) que la skill no cubre nativamente para Postgres/PL-pgSQL.

---

## Archivos analizados (leídos completos)

| Archivo | Líneas | Rol |
|---|---|---|
| `supabase/migrations/0050_sessions.sql` | 81 | tabla `sessions` + RLS + `tg_sessions_rodeo_check` |
| `supabase/migrations/0051_maneuver_presets.sql` | 45 | tabla `maneuver_presets` + RLS |
| `supabase/migrations/0052_event_session_fk.sql` | 100 | FK `session_id` + `tg_event_session_tenant_check` |
| `supabase/migrations/0053_tacto_vaquillona.sql` | 16 | enum `tacto_vaquillona` + `heifer_fitness` |
| `supabase/migrations/0054_gating_db_layer.sql` | 173 | `assert_data_keys_enabled` + 6 triggers de gating |
| `supabase/migrations/0055_check_grants.sql` | 55 | grants/revokes + smoke-check fail-closed |
| `supabase/migrations/0056_event_session_tenant_check_split.sql` | 64 | FIX del bug `OF session_id` de 0052 |
| `supabase/migrations/0057_soft_delete_maneuver_preset.sql` | 35 | RPC soft-delete con re-check `has_role_in` |
| `supabase/tests/maneuvers/run.cjs` | 761 | suite (T2.1–T2.11 + cleanup) |

`git status` confirma: las 8 migraciones y `supabase/tests/maneuvers/` son **untracked** (nuevas). El
diff vs baseline para untracked es vacío por definición — se auditaron los archivos directos.

---

## Focos de seguridad del Gate 2 — estado

| # | Foco | Evidencia | Estado |
|---|---|---|---|
| 1 | SECURITY DEFINER: `search_path` + revoke EXECUTE (internas) / grant deliberado (RPC) | 0050:48,60 · 0052:28,78 · 0054:34,66,74,79,…,161 · 0055:13–21 · 0057:18-19,32 | **CERRADO** |
| 2 | Gating fail-closed (SEC-SPEC-03-03) | 0054:43-46, 61-64 | **CERRADO** |
| 3 | Rodeo inline (SEC-SPEC-03-02) | 0054:38-40 | **CERRADO** |
| 4 | Trigger dientes/CUT afinado (SEC-SPEC-03-01 + D8) | 0054:148-171 | **CERRADO** |
| 5 | tenant-check `session_id` + FIX 0056 | 0052:27-97 + 0056:16-61 | **CERRADO** |
| 6 | `created_by` forzado server-side | 0050:38-40 · 0051:23-25 | **CERRADO** |
| 7 | RLS sessions/presets + grants mínimos + smoke-check | 0050:66-78 · 0051:31-42 · 0055:25-52 | **CERRADO** |
| 8 | Soft-delete por RPC re-valida `has_role_in` | 0057:17-32 + run.cjs:643,675 | **CERRADO** |
| 9 | CHECK tamaño config jsonb (SEC-SPEC-03-06) | 0050:30 · 0051:18 | **CERRADO** |

**9/9 focos CERRADOS.** Cero findings HIGH nuevos.

---

## Análisis foco por foco (data-flow + exploitability)

### Foco 1 — SECURITY DEFINER endurecidas — CERRADO
Las **10** funciones SECURITY DEFINER nuevas:

| Función | `set search_path=public` | revoke / grant | Tipo |
|---|---|---|---|
| `tg_sessions_rodeo_check` (0050:48) | sí | revoke (0050:60, re-0055:15) | interna |
| `tg_event_session_tenant_check` (0052:28) | sí | revoke (0052:78, re-0055:14) | interna |
| `assert_data_keys_enabled` (0054:34) | sí | revoke (0054:66, re-0055:13) | interna |
| `tg_weight_events_gating` (0054:74) | sí | revoke (0054:79, re-0055:16) | interna |
| `tg_condition_score_gating` (0054:86) | sí | revoke (0054:91, re-0055:17) | interna |
| `tg_sanitary_events_gating` (0054:98) | sí | revoke (0054:105, re-0055:18) | interna |
| `tg_lab_samples_gating` (0054:112) | sí | revoke (0054:121, re-0055:19) | interna |
| `tg_reproductive_events_gating` (0054:129) | sí | revoke (0054:140, re-0055:20) | interna |
| `tg_animal_profiles_teeth_gating` (0054:149) | sí | revoke (0054:161, re-0055:21) | interna |
| `soft_delete_maneuver_preset` (0057:18) | sí | **grant a authenticated** (0057:32) — RPC legítima | RPC |

Las 9 internas (helpers de trigger) quedan NO invocables como RPC por authenticated/anon/public.
`soft_delete_maneuver_preset` es la única RPC intencional (grant deliberado a `authenticated`, con
re-check de authz por dentro — ver Foco 8). El **smoke-check de 0055:25-52** itera las 9 internas y
hace `raise exception` si alguna quedó `has_function_privilege(...,'EXECUTE')` para
authenticated/anon/public → la migración FALLA fail-closed si el revoke se rompe. El impl note
confirma `NOTICE: grant check OK` en el push real. Patrón anti-SEC-HIGH-01 **intacto**.

### Foco 2 — Gating fail-closed (SEC-SPEC-03-03) — CERRADO
`assert_data_keys_enabled` (0054:33-65). Data-flow:
- Resuelve `v_rodeo` del perfil activo (0054:38-40, `deleted_at is null`).
- Rodeo NULL (perfil inexistente/soft-deleted) → `raise … errcode '23514'` (0054:43-46). **No hay
  early-return fail-open antes del raise.**
- `v_need is null` → `return` (0054:49-51) sólo DESPUÉS del raise de NULL: rodeo-existence siempre
  validado primero. Correcto.
- `v_have < v_need` → `raise … '23514'` (0054:61-64). Falta de cualquier data_key requerido = rechazo.

Exploitability: no existe entrada que produzca un pase silencioso. Testeado en T2.4b (run.cjs:490-512:
perfil soft-deleted → 23514; perfil ghost → 23514/23503; control enabled → OK). **Fail-closed real.**

### Foco 3 — Rodeo inline (SEC-SPEC-03-02) — CERRADO
0054:38-40 lee `rodeo_id` de `animal_profiles` (perfil activo) inline. No invoca `current_animal_rodeo`
ni `get_rodeo_data_keys` (funciones fantasma inexistentes as-built, confirmadas en Gate 1). El
tenant-check usa el mismo patrón inline (0052:43-45). Sin dependencia fantasma.

### Foco 4 — Trigger dientes/CUT afinado (SEC-SPEC-03-01 + D8) — CERRADO
`tg_animal_profiles_teeth_gating` (0054:148-171). Condición interna (0054:155-156):
```
if (new.teeth_state is distinct from old.teeth_state and new.teeth_state is not null)
   or (new.is_cut is distinct from old.is_cut and new.is_cut = true) then
  perform public.assert_data_keys_enabled(new.id, array['dientes']);
```
Tabla de verdad (construida contra el código real):

| Transición | ¿gatea? | Seguro |
|---|---|---|
| teeth_state NULL→no-NULL (aditivo) | SÍ | ✅ escribe dato → gatea |
| teeth_state no-NULL→otro no-NULL (aditivo) | SÍ | ✅ |
| teeth_state no-NULL→NULL (sustractivo) | NO (`not null` falso) | ✅ sólo limpia |
| is_cut false→true (aditivo) | SÍ | ✅ |
| is_cut NULL→true (aditivo) | SÍ (`is distinct` ∧ `=true`) | ✅ |
| is_cut true→false (sustractivo) | NO (`=true` falso) | ✅ |
| is_cut true→NULL (sustractivo) | NO | ✅ |
| teeth_state no-NULL **igual** a old | NO (`is distinct` falso) | ✅ no introduce dato nuevo |
| category_id solo (sin teeth/is_cut) | NO | ✅ transición de spec 02, no debe gatear |

Único modo de tener teeth_state no-NULL sin gatear = el valor no cambia → no introduce dato prohibido
nuevo. **No hay bypass aditivo.** El trigger se ancla `before update of teeth_state, is_cut,
category_id` con guarda `WHEN (new.teeth_state is distinct from old.teeth_state or new.is_cut is
distinct from old.is_cut)` (0054:166-171), NULL-safe → UPDATE de lote (R9.2) y de rodeo (R4.4) NO
gatean. Testeado exhaustivo en T2.11 (run.cjs:696-754): A/B aditivo rechazado, C/D control enabled OK,
E/F sustractivo aceptado, lote/rodeo no gatea.

### Foco 5 — tenant-check `session_id` + FIX 0056 — CERRADO (el punto de mayor riesgo)
`tg_event_session_tenant_check` (0052:27-77). Si `session_id` no es null valida:
- `v_session_est is null` → `raise '23503'` (0052:52-54): sesión inexistente/borrada.
- **cross-tenant**: `v_session_est is distinct from v_event_est` → `raise '23514'` (0052:57-60).
  `v_event_est` = `establishment_of_profile(animal_profile_id)`; `v_session_est` = de la sesión.
- **intra (a)**: `v_session_st <> 'active'` → `raise '23514'` (0052:63-66): no colgar de sesión cerrada.
- **intra (b)**: `v_event_rod is distinct from v_session_rod` → `raise '23514'` (0052:71-74): rodeo del
  animal debe coincidir con `sessions.rodeo_id` (R1.1 una sesión = un rodeo). `v_event_rod` se lee
  inline del perfil activo (0052:43-45) → fresco en cada insert, sin ventana stale al cambiar el rodeo
  de la sesión (R4.7).

**FIX 0056 (cierre del bypass)**: 0052:83-97 creó los triggers como `before insert or update of
session_id`. En Postgres, combinar `INSERT` con una lista de columnas `OF session_id` en un solo
trigger acota el firing a UPDATE-of-column → el trigger **no disparaba en INSERT**, dejando pasar sin
validar todo evento insertado con `session_id` cross-tenant / de otro rodeo / de sesión cerrada vía
PostgREST directo = **bypass total del tenant-check** (R7.4, SEC-SPEC-03-04). 0056:16-21 dropea los 5
triggers rotos y 0056:23-61 los recrea **split**: `before insert` (sin lista de columnas, dispara en
todo INSERT) + `before update of session_id` (cubre re-apuntar). La función no cambia. **Estado final
= bypass cerrado.** Exploitability post-fix: un INSERT directo por PostgREST con `session_id`
cross-tenant ahora dispara el trigger BEFORE INSERT → `raise '23514'`. Testeado en T2.6
(run.cjs:535-543: cross-tenant en weight_events Y sanitary_events → 23514; run.cjs:556-561: animal de
otro rodeo → 23514; run.cjs:562-568: sesión closed → 23514). **CERRADO.**

Nota de prolijidad (no de seguridad): 0052 queda aplicado al remoto con los triggers rotos y 0056 los
reemplaza; un entorno limpio aplica 0052→0056 y queda consistente. El implementer recomendó folear el
split en 0052 (cosmético, no afecta el estado final). No es FAIL.

### Foco 6 — `created_by` forzado server-side — CERRADO
`sessions` (0050:38-40) y `maneuver_presets` (0051:23-25) enganchan `tg_force_created_by_auth_uid`
(helper de spec 02, 0043) como `before insert`. Un payload con `created_by` ajeno queda sobrescrito a
`auth.uid()`. Testeado en T2.3 (run.cjs:379-397: insert con `created_by: userB.id` → almacenado
`userA.id` en session y preset). No spoofeable.

### Foco 7 — RLS sessions/maneuver_presets — CERRADO
- `sessions` (0050:66-78): RLS habilitada (0050:66). SELECT `has_role_in(establishment_id) and
  deleted_at is null`; INSERT/UPDATE `with check has_role_in(establishment_id)`. **Sin policy DELETE**
  → cliente no puede DELETE (cerrar = `status='closed'`, borrar = soft-delete por UPDATE). Grants
  mínimos: `select, insert, update` a authenticated (0050:77); `all` a service_role.
- `maneuver_presets` (0051:31-42): idéntico patrón, sin DELETE.
- `tg_sessions_rodeo_check` (0050:47-64): el rodeo de la sesión debe ser del mismo establishment,
  `active` y vivo, en `before insert OR update` → cubre el cambio de rodeo mid-jornada (R4.7) y
  bloquea cross-tenant del rodeo. Testeado T2.2 (run.cjs:336-376: rodeo ajeno → 23514; userC sin rol
  no ve ni crea; field_operator activo crea OK; DELETE de cliente → 0 filas).
- El smoke-check de 0055 (Foco 1) refuerza fail-closed en runtime.

### Foco 8 — Soft-delete por RPC re-valida authz — CERRADO
`soft_delete_maneuver_preset` (0057:17-30): SECURITY DEFINER que (a) resuelve `v_est` del preset vivo,
`raise 'P0002'` si no existe (0057:22-25); (b) **`if not public.has_role_in(v_est) then raise '42501'`**
(0057:26-28) — re-valida la MISMA autorización que la policy UPDATE antes del UPDATE interno
(0057:29). No hay bypass de tenant: sólo un caller con rol en el establishment del preset puede
borrarlo. Grant deliberado a `authenticated` (0057:32). Es el patrón de `soft_delete_management_group`
(0041, spec 02). Análogamente, T2.9 usa `soft_delete_event` (RPC de 0041) en vez de UPDATE directo de
`deleted_at` (run.cjs:675). Testeado en T2.8 (run.cjs:643-649: RPC soft-delete OK + preset desaparece
del SELECT) y la corrección cross-tenant negativa (run.cjs:690-691: userC no edita evento). **CERRADO.**

### Foco 9 — CHECK tamaño config jsonb (SEC-SPEC-03-06) — CERRADO
`sessions.config`: `check (octet_length(config::text) < 16384)` (0050:30). `maneuver_presets.config`:
idem (0051:18). Acota el jsonb libre del cliente encolado vía sync → previene DoS por payload gigante.
Testeado indirectamente (T2.8 name vacío → CHECK falla, run.cjs:632-636).

---

## Findings HIGH de Sentry (skill)
**Ninguno.** La skill `sentry-skills:security-review` es una skill de metodología (no agente
autónomo): cargada, su procedimiento (trace data-flow → verify exploitability → confidence-based
reporting) se aplicó manualmente sobre los 8 SQL + la suite. No emergió ningún HIGH al trazar los
flujos de datos: las únicas entradas attacker-controlled (payload de PostgREST del cliente Expo:
`establishment_id`, `rodeo_id`, `session_id`, `created_by`, `config`, `teeth_state`, `is_cut`) están
todas cubiertas por RLS (`has_role_in`), triggers de tenant-check, gating fail-closed, force-created-by
y CHECK de tamaño.

## Findings RAFAQ-SPECIFIC
**Ninguno HIGH.** Observaciones no bloqueantes:
- (LOW, prolijidad) 0052 queda en el remoto con los triggers `OF session_id` rotos; 0056 los
  reemplaza. Estado final correcto en cualquier entorno (0052→0056). Recomendación del implementer:
  folear el split en 0052 — cosmético, no de seguridad.
- (INFO) Los mensajes de `raise exception` del tenant-check (0052:58,64,72) y del gating (0054:44,62)
  exponen sólo datos del propio tenant del caller (su sesión, su animal, sus data_keys) — **no** id ni
  config de otro establishment. El surfacing de rechazos al sincronizar (R10.8) es tenant-safe a nivel
  de mensaje del trigger; cuando se implemente el cliente (Fase 4), verificar que la UI no derive datos
  cross-tenant al renderizar el motivo (riesgo de UI, no de este diseño).

## False positives descartados
N/A — la skill no emitió findings automáticos (es de metodología). No hubo candidatos que descartar.

## Cobertura indirecta de Deno / RLS / PowerSync (declaración)
- **PL/pgSQL + RLS + triggers SECURITY DEFINER**: NO cubiertos nativamente por la skill de Sentry
  (orientada a app code). Auditados por **revisión manual RAFAQ-específica** (Focos 1, 4, 5, 7, 8) —
  el núcleo de seguridad de spec 03 vive acá.
- **Deno / Edge Functions**: no aplica — spec 03 backend no agrega Edge Functions.
- **PowerSync sync rules** para `sessions`/`maneuver_presets` (T4.6): **fuera de alcance** (Fase 4). El
  enforcement real es RLS (cubierto acá); cuando se definan las sync rules, verificar que el bucket
  scopee por `establishment_id`.
- **BLE / React Native**: Fase 3/4, fuera de alcance.

---

## Pendiente diferido (NO es FAIL)
- **D9 / T2.12 — find-or-create inline cross-spec (SEC-SPEC-03-05)**: el contrato de no-bypass del alta
  inline en la manga (R4.1/R4.6: forzar `establishment_id` ACTIVO, respetar UNIQUE `tag_electronic`
  global y `(establishment_id, idv)`, `created_by` server-side) depende del motor de spec 09 (no
  integrada). **No testeable en spec 03 backend.** Se difiere legítimamente al Gate 2 del cliente
  cuando spec 09 esté integrada — entonces agregar un test de no-bypass cross-tenant del alta inline.
  Decisión de **orden de integración**, no hueco de seguridad del código actual.

---

## Conclusión
**PASS.** El backend de spec 03 implementa fielmente los findings cerrados en Gate 1 y no introduce
vulnerabilidades nuevas. Las 10 funciones SECURITY DEFINER están endurecidas (search_path + revoke) con
smoke-check fail-closed en runtime (0055); el gating es fail-closed (0054); el rodeo se resuelve inline
(0054/0052); el trigger dientes/CUT afinado no abre bypass aditivo (0054); el FIX 0056 cierra el bypass
cross-tenant del tenant-check de `session_id` que 0052 dejaba abierto (verificado en T2.6); `created_by`
se fuerza server-side (0050/0051); las RLS son canónicas sin DELETE de cliente; el soft-delete por RPC
re-valida `has_role_in` (0057). Único pendiente: la re-verificación cross-spec del find-or-create
(D9/T2.12), diferida a la integración de spec 09 — no bloquea este gate. **Listo para la Puerta 2
humana.**
