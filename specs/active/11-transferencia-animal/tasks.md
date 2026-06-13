# Spec 11 — Transferencia de animal entre campos — Tasks

**Status**: `spec_ready` (2026-06-12, sesión 23). Pendiente Gate 1 + Puerta 1.
El implementer marca `[x]` a medida que completa. El reviewer rechaza si queda `[ ]` sin justificación documentada. Cada task mapea a ≥1 `R<n>`. La trazabilidad `R<n> → archivo:test` va en `progress/impl_11-transferencia-animal.md`.

> **Orden de fases**: Backend (RPC + tests, FIRME, buildable-hoy) → Cliente service (ONLINE-only, buildable-hoy) → Cliente UI (TENTATIVO, depende del frontend de spec 09 que está `deferred`).
> **No aplicar al remoto desde el repo**: la migración la aplica el leader por Management API tras Gate 1 + Gate 2 + reviewer. Hasta entonces los tests de la suite `transfer_animal RPC` FALLAN (esperado, patrón 0074-0086).

---

## Fase 1 — Backend: RPC `transfer_animal` (FIRME)

- [x] **T1.1** — Migración `0087_transfer_animal_rpc.sql`: crear la función `public.transfer_animal(p_source_profile_id, p_target_establishment_id, p_target_rodeo_id, p_target_profile_id, p_target_category_id)` `SECURITY DEFINER` + `set search_path = public`, con el cuerpo de design §3.2. Cubre: R2.1, R3.1–R3.9, R4.1–R4.3.
- [x] **T1.2** — En T1.1: bloque (a) authz — derivar `establishment_id`/`animal_id`/`created_by`/`idv`/descriptivos de la **fila real** del perfil de origen (status active, no soft-deleted); **authz ASIMÉTRICA (FIX Gate-1 HIGH-1)**: `has_role_in(Y)` para el destino (CREATE) **+** `has_role_in(X) AND (is_owner_of(X) OR created_by=auth.uid())` para el origen (BAJA, **paridad EXACTA con `exit_animal_profile` 0044/SEC-SPEC-01**) — todo antes de cualquier escritura; guard origen≠destino; rechazo `23503` si el perfil no está activo/no existe. Cubre: R5.1, R5.2, R5.3, R5.4, R5.6.
- [x] **T1.3** — En T1.1: bloque (0) idempotencia AL INICIO del RPC (**FIX Gate-1 HIGH-2**, antes del select active-only del origen y antes de la authz) — no-op + return si ya existe un perfil con `p_target_profile_id` en Y (replay por ACK perdido). Molde `create_animal` 0083. Cubre: R6.1, R6.2.
- [x] **T1.4** — En T1.1: bloque (b) mismo sistema — el rodeo destino debe existir, ser activo, del establishment Y, y tener el mismo `system_id` que el rodeo de origen; rechazo `23514` si no. Cubre: R1.6, R2.2.
- [x] **T1.5** — En T1.1: bloque (c) idv — conservar el `idv` del viejo; si colisiona en Y → `NULL` + flag `idv_dropped` en el resultado. Cubre: R2.4, R2.5.
- [x] **T1.6** — En T1.1: bloque (d) archivar el perfil viejo PRIMERO (`status='transferred'`, `exit_reason='transfer'`, `exit_date`, `deleted_at` intacto) para liberar el unique parcial antes de crear el nuevo. Cubre: R4.1, R4.2.
- [x] **T1.7** — En T1.1: bloque (e) crear el perfil nuevo en Y con `p_target_profile_id`, `management_group_id=NULL`, `category_override=false`, `status='active'`, `idv` resuelto. NO setear `created_by`/`animal_*`/`is_castrated`/`future_bull` (los fuerzan/defaultean 0043/0079/0084/0085). Cubre: R2.1, R2.3, R2.6, R2.7, R2.8, R2.9, R2.10, R2.11.
- [x] **T1.8** — En T1.1: bloque (f) re-apuntar las 5 tablas tipadas (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`): `animal_profile_id → nuevo`, `establishment_id → Y`, `session_id → NULL`. Cubre: R3.1, R3.6, R3.8.
- [x] **T1.9** — En T1.1: bloque (f) re-apuntar `animal_category_history` (`animal_profile_id` + `establishment_id → Y`). Cubre: R3.3, R3.6.
- [x] **T1.10** — En T1.1: bloque (f) re-apuntar `birth_calves` del animal-como-ternero (`calf_profile_id → nuevo`) + el UPDATE de §4.4 para `birth_calves` del animal-como-madre (`establishment_id → Y` de las filas cuyo `birth_event_id` pertenece a los partos re-apuntados). Cubre: R3.5, R3.6 (DEC-A2/DEC-A3).
- [x] **T1.11** — En T1.1: bloque (g) re-apuntar los vínculos `bull_id`/`calf_id` de eventos de OTROS animales (descendencia que queda en X) → al perfil nuevo, SIN tocar su `animal_profile_id`/`establishment_id` (el evento sigue en X). Cubre: R3.4, R8.1.
- [x] **T1.12** — Delta sobre `0034` (spec 02), migración nueva `0088_animal_events_transfer_guc.sql`: extender `tg_animal_events_enforce_edit_window` con early-return cuando la GUC `rafaq.is_transfer` está `'on'`; el RPC setea esa GUC (`set_config('rafaq.is_transfer','on',true)`) antes de re-apuntar `animal_events` y la limpia después. Re-apuntar `animal_events` (`animal_profile_id` + `establishment_id → Y`). Cubre: R3.2, R3.7 (DEC-A1). **Reconciliar `design.md` de spec 02 con este delta (T5.1).**
- [x] **T1.13** — En T1.1: `revoke execute ... from public, anon` + `grant execute ... to authenticated` con firma tipada completa + smoke-check fail-closed + `notify pgrst`. Cubre: R5.5.

## Fase 2 — Backend: tests (suite `transfer_animal RPC` en `supabase/tests/animal/run.cjs`)

- [x] **T2.1** — Test camino feliz: usuario con rol en X y Y transfiere un animal con historia (≥1 evento de cada tabla + 1 observación + 1 category_history + 1 parto como madre con 1 ternero). Asserts: 1 perfil activo en Y, perfil viejo `status='transferred'`, eventos re-apuntados con `animal_profile_id`=nuevo + `establishment_id`=Y + `session_id` NULL. Cubre: R2.1, R3.1, R3.2, R3.3, R3.6, R3.8, R3.9, R4.1.
- [x] **T2.2** — Test invariante de unicidad: en ningún punto hay 0 ni 2 perfiles activos; el unique parcial `animal_profiles_active_animal_unique` nunca se viola. Cubre: R4.2.
- [x] **T2.3** — Test atomicidad: forzar un fallo a mitad (ej. `p_target_category_id` inválido para el system destino) → rollback total; el animal queda exactamente como antes (activo en X, historia intacta en X). Cubre: R4.3.
- [x] **T2.4** — Test seguridad: caller con rol SOLO en Y (no en X) → `42501`, nada creado/re-apuntado/archivado. Cubre: R5.1, R5.2.
- [x] **T2.5** — Test seguridad: caller con rol SOLO en X (no en Y) → `42501`, sin efectos. Cubre: R5.3.
- [x] **T2.6** — Test seguridad: caller con rol en X+Y pero ni owner ni creador del animal → `42501` (anti-IDOR / paridad 0044; la derivación de X de la fila real lo cubre). Cubre: R5.4 (+ R5.1 paridad de baja).
- [x] **T2.7** — Test: `p_source_profile_id` ya inactivo/transferido/inexistente → rechazo `23503` sin efectos. Cubre: R5.6.
- [x] **T2.8** — Test idv: (a) idv del viejo libre en Y → se conserva; (b) idv colisiona en Y → perfil nuevo con `idv=NULL` + `idv_dropped=true`, transferencia completa igual. Cubre: R2.4, R2.5.
- [x] **T2.9** — Test rodeo destino: (a) rodeo de otro system → `23514`; (b) rodeo de Y mismo system → OK. Cubre: R1.6, R2.2.
- [x] **T2.10** — Test idempotencia: invocar dos veces con el mismo `p_target_profile_id` → la 2da es no-op (mismo resultado, sin segundo perfil ni doble re-apuntado). Cubre: R6.1, R6.2.
- [x] **T2.11** — Test linaje cruzado: animal madre/toro con cría que QUEDA en X → tras transferir, el `bull_id`/`calf_id` del evento de la descendencia (en X) apunta al perfil nuevo (Y); el evento sigue en X (su `establishment_id` NO cambió). Cubre: R3.4, R8.1.
- [x] **T2.12** — Test denormalización (aislamiento de sync): tras transferir, NINGUNA fila hija re-apuntada queda con `establishment_id` = X; `animal_events` re-apuntado tiene `establishment_id` = Y y el trigger de inmutabilidad NO lo rechazó (vía GUC). Cubre: R3.6, R3.7.
- [x] **T2.13** — Test grants: `transfer_animal` NO es invocable por anon (fail-closed end-to-end; el smoke-check del 0087 falla el deploy si quedara EXECUTE-able por anon/public). Cubre: R5.5.
- [x] **T2.14** — Test is_castrated / future_bull: animal con `is_castrated=true` → perfil nuevo lo preserva; `future_bull` arranca `false` en Y aunque el viejo lo tuviera `true`. Cubre: R2.7, R2.8.
- [x] **T2.15** — Suite enganchada: vive dentro de `supabase/tests/animal/run.cjs` (ya corre vía `check.mjs`); el unit test del cliente se enganchó en `scripts/run-tests.mjs`. Cubre: (infra de verificación).

## Fase 3 — Cliente: service (ONLINE-only, buildable-hoy)

- [x] **T3.1** — `app/src/services/animals.ts`: `transferAnimal(input): Promise<ServiceResult<TransferAnimalResult>>` que llama `supabase.rpc('transfer_animal', {...})`. ONLINE-only: NO escribe al SQLite local / outbox de PowerSync; `assertOnline` fast-fail si no hay red → `ServiceResult` error `kind:'network'` accionable. Mapeo `42501`/`23514`/`23503`/`23505` a copy es-AR sin leak de `sqlerrm` (lógica PURA testeable en `app/src/services/transfer-animal.ts`). Cubre: R7.1, R5.2 (copy).
- [x] **T3.2** — El cliente genera `p_target_profile_id` (UUID estable, `newTransferTargetProfileId()`) y debe persistirlo para el reintento del mismo intent (documentado en el JSDoc; el call-site UI lo persistirá en Fase 4). Cubre: R6.2.
- [x] **T3.3** — Resolver `p_target_category_id` con el catálogo del system del rodeo destino: el input `targetCategoryId` lo provee el call-site reusando la resolución por catálogo (mismo patrón que el alta CREATE; el RPC re-valida server-side vía `tg_animal_profiles_category_check` 0021). La resolución concreta del catálogo es del call-site UI (Fase 4, deferred). Cubre: R2.9.

## Fase 4 — Cliente: UI find-or-create (TENTATIVO — depende de spec 09 deferred)

> Estas tasks NO se construyen hasta que el frontend del find-or-create de spec 09 exista (`deferred`). Se reconcilian R1.x con el estado real de esas pantallas al implementar spec 09.

- [ ] **T4.1** — (TENTATIVO) En el find-or-create D2: cuando el TAG/ID resuelve a un animal activo en otro campo X con rol del usuario, ofrecer "Transferir a este campo" en vez del error. Cubre: R1.1, R1.2.
- [ ] **T4.2** — (TENTATIVO) Preview de confirmación con el campo origen + aviso "con su historia / dejará de estar activo en X". Cubre: R1.3.
- [ ] **T4.3** — (TENTATIVO) Selección de rodeo destino en Y (1 → fijo; ≥2 mismo system → combo default `lastRodeoSelected`); bloquear si Y no tiene rodeo del mismo system. Cubre: R1.5, R1.6.
- [ ] **T4.4** — (TENTATIVO) Gate online: deshabilitar la acción sin conexión. Cubre: R1.4, R7.1.
- [ ] **T4.5** — (TENTATIVO) Tras `idv_dropped`, avisar al operario que complete el `idv` (R4.13.a permite NULL→valor). Cubre: R2.5.
- [ ] **T4.6** — (TENTATIVO) Copy "madre/padre en otro campo" en la ficha del ternero cuando el viewer no tiene rol en Y. Cubre: R8.2.

## Fase 5 — Reconciliación + cierre

- [x] **T5.1** — Reconciliado `specs/active/02-modelo-animal/design.md` con el delta del trigger de `animal_events` (nota junto a `tg_animal_events_enforce_edit_window`) + verificada la coherencia del fold "R4.11 → feature 11" (línea 760, ya correcta). Reconciliada también la spec 11 design §3.2 con las 2 divergencias as-built menores (rodeo_id en el SELECT (a); migración split 0087+0088). Cubre: (regla de reconciliación de specs).
- [x] **T5.2** — Mapa `R<n> → archivo:test` documentado en `progress/impl_11-transferencia-animal.md`. Cubre: (trazabilidad).
- [x] **T5.3** — Autorrevisión adversarial (paso 8) documentada en `progress/impl_11-transferencia-animal.md`: foco en los vectores cross-tenant de design §7 (fuga de aislamiento de sync, doble/cero perfil activo, idempotencia, authz a paridad 0044, grants fail-closed, GUC no seteable por cliente, tests que pasan por la razón equivocada → cazado y cerrado). Cubre: (calidad).

---

## Notas de scope para el implementer
- **Buildable hoy**: Fase 1, 2, 3 (el backend + service no dependen de design system ni del frontend de spec 09).
- **Diferido**: Fase 4 (UI) hasta el frontend de spec 09.
- **Gate 1 OBLIGATORIO** antes de Puerta 1: write cross-tenant + re-parenting masivo. Confirmar DEC-A1/A2/A3 de design §7.
- **Decisiones menores para Raf** (Puerta 1): TODO-D1..D5 de `requirements.md`.
