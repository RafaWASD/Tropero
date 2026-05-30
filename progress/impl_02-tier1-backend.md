baseline_commit: 9f1803740290cf5a28374738612ba5eb69238d53

# Impl — 02-modelo-animal · Tier 1 backend (delta s17/s18, migrations 0043-0047)

> Feature `02-modelo-animal` reabierta como **bloque backend Tier 1** (sesión 20). Spec aprobado por Raf + Gate 1 (security spec) PASS tras endurecimiento. Fuente de verdad: `design.md` § "Fold del Tier 1 — bloque backend delta s17/s18" (l.741+).
>
> **baseline_commit** = SHA previo a la primera task de este bloque. Gate 2 (modo `code`) computa el diff desde ahí. NO es el baseline de sesión 15 (`impl_02-modelo-animal.md`, otro SHA).

## Plan (T1..Tn)

- **T1 — 0043** `created_by` en `animal_profiles` + trigger `tg_force_created_by_auth_uid` (SEC-SPEC-03, R4.1).
- **T2 — 0044** `exit_reason` text→enum + RPC `exit_animal_profile` SECURITY DEFINER (SEC-SPEC-01, R4.14/R4.15).
- **T3 — 0045** tabla `birth_calves` (select-only) + extensión del trigger mono-ternero + RPC `register_birth` atómico (SEC-SPEC-02/04, R7.9/R9.4/R9.5) + `compute_category` cuenta eventos `birth`.
- **T4 — 0046** trigger recálculo de categoría AFTER UPDATE/DELETE de `reproductive_events` (R6.14).
- **T5 — 0047** trigger BEFORE UPDATE de `rodeo_id` mismo-sistema (R4.5.1).
- **T6 — Tests** T2.19 (6 casos no-bypass) + control de rollback atómico, en `supabase/tests/animal/run.cjs`.

## Estado por task

| Task | Estado | Archivo | Nota |
|---|---|---|---|
| T1 (0043) | ✅ aplicada | `0043_animal_profiles_created_by.sql` | `created_by` FK nullable + `tg_force_created_by_auth_uid` (siempre sobreescribe). |
| T2 (0044) | ✅ aplicada | `0044_exit_reason_enum.sql` | enum + RPC `exit_animal_profile` (guarda `has_role_in` + owner/creator, firma tipada). |
| T3 (0045) | ✅ aplicada | `0045_birth_calves.sql` | tabla select-only + trigger mono extendido + RPC `register_birth` atómico + `compute_category` re-emitida (conteo por evento). |
| T4 (0046) | ✅ aplicada | `0046_category_recompute_on_event_change.sql` | trigger AFTER UPDATE/DELETE recompute si `override=false`. |
| T5 (0047) | ✅ aplicada | `0047_rodeo_change_same_system.sql` | trigger BEFORE UPDATE of `rodeo_id` mismo-sistema. |
| T6 (tests) | ✅ verde | `supabase/tests/animal/run.cjs` | T2.19 (6 casos no-bypass + L2 + R4.5.1 + control rollback). Suite animal 19 → **28** (node `tests` count). |

**db push**: 0043-0049 aplicadas a remoto (DB MVP, sin datos reales). `migration list` Local=Remote=0001..0049.

## Verificación

- `node scripts/check.mjs` **verde**: typecheck client + RLS suite (15) + Edge Functions suite (26) + Animal suite (**28**, 0 fail).
- Suite animal: los **19 tests as-built** siguen verdes (T2.1..T2.18); T2.19 agrega **9 sub-tests** (6 casos no-bypass SEC-SPEC-01..04 + L2 mono/mellizos + R4.5.1 cambio de rodeo + control de rollback atómico). Node reporta `tests 28`.

## Desviaciones

Tres desviaciones, todas **mecánicas de implementación** (no tocan el contrato de seguridad de Gate 1 ni el diseño); documentadas para Gate 2.

1. **`birth_calves` del caso mono-ternero se puebla en un trigger AFTER INSERT separado, no en el BEFORE INSERT** (migration `0048`).
   - El design (l.1574) decía "extender el mismo trigger [BEFORE INSERT] con un INSERT a `birth_calves` tras setear `calf_id`". Eso **no es posible**: en un BEFORE INSERT la fila de `reproductive_events` aún no existe, así que `insert into birth_calves(birth_event_id = new.id)` viola el FK `birth_calves_birth_event_id_fkey` (23503, `Key (birth_event_id)=... is not present in table reproductive_events`).
   - **Fix**: el BEFORE INSERT (`tg_reproductive_events_create_calf`) vuelve a su forma as-built (crea ternero + setea `calf_id`, sin tocar la puente); un trigger **AFTER INSERT** nuevo (`tg_reproductive_events_link_birth_calf`) inserta la fila puente con la del evento ya persistida. Ambos `SECURITY DEFINER` (el cliente no tiene GRANT INSERT — SEC-SPEC-04 intacto). Atomicidad (R9.4) conservada: el AFTER trigger corre en la misma transacción del INSERT; cualquier excepción revierte el parto. Verificado por T2.7 (mono as-built sigue verde) + T2.19 casos 4/6.
   - **No cambia el contrato**: la tabla sigue server-only, select-only para el cliente. `register_birth` (mellizos) ya poblaba `birth_calves` por dentro con el id del evento ya capturado (`returning ... into v_birth_event_id`), así que no sufría el bug y no se modifica.

2. **`grant select on public.birth_calves to service_role`** (migration `0049`).
   - El bloque de design de `0045` solo emitió `grant select ... to authenticated`. La **convención dura RAFAQ** (Auto-expose / default privileges OFF) exige GRANT explícito a `service_role` en cada tabla nueva — como hacen todas las tablas de spec 02 (`grant all on public.<tabla> to service_role`, ver `0019`/`0025`). Sin él, `service_role` (fixtures + lecturas de verificación de la suite) recibía `42501 permission denied for table birth_calves`.
   - **Fix**: grant `select` a `service_role` (alcanza para verificación de estado; el cleanup de datos va por CASCADE desde `reproductive_events`/`establishments`). La superficie del **cliente** (`authenticated`) NO cambia: sigue select-only, sin INSERT (SEC-SPEC-04 intacto).

3. **`compute_category` re-emitida en `0045`** (idéntica al as-built `0031`, sin cambio funcional). El design pedía dejar firme el comentario "cuenta eventos `birth` distintos, no terneros". El SQL as-built ya contaba por evento; se re-emitió con `create or replace` (idempotente) solo para fijar el comentario explícito de mellizos. Verificado por T2.19 caso 2 (mellizos = 1 parto: madre → `vaca_segundo_servicio`, no `multipara`).

**Nota para Gate 2** (R2-NEW del re-audit de Gate 1): el cuerpo de `register_birth` **no** captura excepciones con `exception when others then ... return` — propaga cualquier fallo, así que un ternero intermedio inválido revierte el parto completo. Cubierto por el sub-test "control: register_birth con ternero intermedio inválido → rollback total" (TAG duplicado en el ternero #2 → 0 perfiles, 0 evento, madre no transiciona).

## Trazabilidad R<n> → test (`supabase/tests/animal/run.cjs`)

| Requirement / contrato | Migration | Test (sub-test bajo T2.19, salvo nota) |
|---|---|---|
| R4.1 (`created_by` load-bearing, forzado server-side, SEC-SPEC-03) | `0043` | `caso 5: created_by forzado a auth.uid() aunque el cliente mande otro` |
| R4.14/R4.15 (baja vía `exit_animal_profile`, authz rol activo, SEC-SPEC-01) | `0044` | `caso 1: exit_animal_profile autor-sin-rol -> 42501, status sin cambiar` (+ variante control owner) |
| R7.9 / R9.5 (mellizos, alta N terneros, conteo por evento, SEC-SPEC-02) | `0045`/`0048` | `caso 2: register_birth cross-tenant -> 42501, nada creado; control crea todo` |
| R9.4 (rollback atómico del parto) | `0045` | `control: register_birth con ternero intermedio inválido -> rollback total` + T2.7 (mono, TAG dup) |
| SEC-SPEC-04 (`birth_calves` sin INSERT de cliente) | `0045`/`0049` | `caso 3: INSERT directo a birth_calves -> bloqueado` |
| SEC-SPEC-04.a (`birth_calves` filtra parto soft-deleted) | `0045` | `caso 4: SELECT de birth_calves filtra parto soft-deleted` |
| R6.14 (recálculo de categoría al editar/borrar evento) | `0046` | T2.4/T2.5 (transiciones + override siguen verdes; el recompute reusa `apply_auto_transition`); cobertura indirecta vía rollback (caso 2/control: el soft-delete del parto no deja la categoría desactualizada) |
| R4.5.1 (cambio de rodeo mismo-sistema, relajada) | `0047` | `caso 7 (R4.5.1): mover animal a otro rodeo del mismo sistema es permitido` (path de aceptación del trigger). El rechazo cross-sistema queda firme para multi-sistema: con un solo system MVP (`cria`) no se puede construir el caso de cruce, así que el trigger nunca rechaza en la práctica. `caso 6 (L2)` confirma que el alta del ternero (rodeo de la madre, sin cambio) no aplica el trigger (es `before update of rodeo_id`) |
| L2 (alta de ternero no bloqueada por triggers) | `0045`/`0047`/`0048` | `caso 6 (L2): alta de ternero al pie (mono y mellizos) no bloqueada por triggers` |
| R11.x (aislamiento multi-tenant) | `0044`/`0045` | casos 1, 2 (cross-tenant) + T2.18 (as-built) |

**No marco `done` — espera al reviewer + Gate 2 (modo `code`).**
