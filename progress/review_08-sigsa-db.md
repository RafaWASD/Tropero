# Review - spec 08 (export SIGSA), CAPA DB (migraciones 0107-0112 + suite RLS)

Revisor: reviewer (independiente). Fecha: 2026-06-24.
Alcance: SOLO la capa DB. supabase/migrations/0107..0112 + supabase/tests/sigsa/run.cjs + su hook en scripts/run-tests.mjs + progress/impl_08-sigsa-db.md. NADA de PowerSync (T7), servicio (T11/T12/T19/T20) ni UI (T13-T18) - no implementados, fuera de alcance.

## Veredicto: APPROVED

---

## 1. Las 2 redefiniciones deployadas (mayor riesgo) - VERIFICADO INDEPENDIENTE

Diffee yo mismo cada redefinicion contra el as-built con diff mecanico (no me confie de la bitacora).

### Trigger tg_reproductive_events_create_calf - 0048 (as-built) -> 0108 (redefinido)
diff de la funcion arroja EXACTAMENTE 4 cambios de codigo (mas comentarios): (1) declaracion v_mother_breed_id uuid; (2) SELECT agrega p.breed_id + into-target v_mother_breed_id; (3) INSERT columna breed_id; (4) INSERT valor v_mother_breed_id. NO se perdio nada: SECURITY DEFINER (0108:59), set search_path = public (0108:60), los 3 guards de early-return (event_type/calf_id/calf_sex, 0108:73-75), el exception-when-others-then-raise de rollback atomico R9.4 (0108:114-116). El trigger AFTER reproductive_events_link_birth_calf de 0048 (puente birth_calves) NO se toca - correcto, no lee breed.

### RPC register_birth - 0075 (as-built) -> 0109 (redefinido)
diff del cuerpo: create-function -> create-or-replace-function, + v_mother_breed_id uuid;, p.breed_id en el SELECT de autorizacion + into-target, + breed_id / + v_mother_breed_id en el INSERT de cada ternero (mas comentarios). TODO lo de seguridad se preserva byte-a-byte:
- SECURITY DEFINER + search_path=public (0109:55-56).
- Authz por la fila REAL de la madre (has_role_in(v_est) derivado de la fila, NO del payload - 0109:80-91), rige PRIMERO.
- Guard de idempotencia HIGH-D1 scopeado al caller (mismo p_mother_profile_id + mismo v_est, vivo - 0109:101-115): intacto, incluido el comentario anti-oraculo cross-tenant.
- Herencia de tenant del server (v_est, no del payload - 0109:161). Rollback atomico del loop (R9.4/R9.5). Validacion del payload jsonb. GRANT/REVOKE de la firma de 4 args (0109:193-194) re-aplicados.
- create-or-replace (en vez del drop+create de 0075) es correcto: la firma de 4 args ya existe post-0075 -> REPLACE preserva grants; la firma vieja de 3 args ya estaba dropeada por 0075 y NO se reintroduce -> sin ambiguedad de overload.

Prueba en vivo: la suite SIGSA (T2(f), T3 mellizos) corre contra el remoto y verde -> las redefiniciones DEPLOYADAS heredan breed_id en ambos caminos. La Animal suite (spec 02, que ejercita ternero mono + register_birth) sigue 100% verde en check.mjs -> CERO regresion del path existente.

## 2. R1.6 no-op - VERIFICADO CONTRA LA DB VIVA
- select breed from reproductive_events -> 42703 column-does-not-exist -> la columna texto-libre NO existe; el UPDATE best-effort del design original habria abortado la migracion. Omitirlo es CORRECTO.
- select breed_id from reproductive_events -> existe -> R1.6 (agregar breed_id FK nullable) cumplido.
- select breed, breed_id from animal_profiles -> ambas seleccionables -> coexistencia legacy R1.4 OK.
Reconciliado en design.md sec 0109 + nota bajo R1.6 en requirements.md + bitacora. Spec NO quedo mintiendo.

## 3. RENSPA sin unique (decision 3) - VERIFICADO CONTRA LA DB VIVA
- Dos establishments con el MISMO renspa (DUP-REV-001) insertan ambos sin error -> NO hay indice unique (ni global ni por-dueno). Correcto.
- renspa de 21 chars -> 23514 (CHECK violation) -> el CHECK de largo (1-20) esta vivo.
- 0110 solo tiene el CHECK chk_establishments_renspa_length + la RPC update_renspa owner-gate. Sin create-unique-index. Test T4(f) cubre el no-unique como guard anti-regresion.

## 4. RLS / seguridad de las tablas nuevas - OK
- breed_catalog (0107): RLS ON, SELECT-only a authenticated (USING true), grant all solo a service_role, SIN policies de escritura -> read-only fail-closed. T1(b) verifica no-mutacion adversarial (con admin).
- sigsa_declarations (0111): RLS ON; SELECT has_role_in; INSERT has_role_in + EXISTS owner/vet + IDOR-check (animal_profile_id pertenece al establishment_id y deleted_at IS NULL); trigger BEFORE INSERT tg_force_declared_by_auth_uid fuerza declared_by=auth.uid(); sin GRANT/policy UPDATE/DELETE (append-only R11.3). Sin deleted_at -> el SELECT no lo filtra (correcto; fix del veto del leader preservado).
- export_log (0112): RLS ON; SELECT has_role_in; INSERT has_role_in + EXISTS owner/vet; trigger fuerza generated_by=auth.uid(); CHECK octet_length(file_content)<=5000000 + char_length(file_name)<=255; sin UPDATE/DELETE. FK export_log_id ON DELETE SET NULL al final.
- Helpers has_role_in()/is_owner_of() (0005, SECURITY DEFINER/STABLE/search_path; has_role_in ya filtra deleted_at) reusados - sin SQL de rol duplicado inline salvo el narrowing owner/vet intencional (patron import_log 0073).
- update_renspa (0110): SECURITY DEFINER + search_path=public + guard is_owner_of + REVOKE public/anon + GRANT authenticated. Gate de UPDATE directo = policy establishments_update (0007, is_owner_of(id) en USING y WITH CHECK) - verificado en el source. T4(d) lo cubre.
- Triggers force-auth.uid() SIN SECURITY DEFINER/search_path: correcto e identico al patron as-built 0043/0073 (asignacion trivial sobre NEW, corre como invoker, sin acceso a tablas).

## 5. Seed - VERIFICADO 1:1 PROGRAMATICO
Cross-check (node) seed 0107 vs app/src/utils/import/breed-senasa.ts: 32 total, 28 bovine+active, S/E generic, ME/JA/MU bubaline active=false, 0 mismatches codigo<->nombre, 0 nombres duplicados case-insensitive (-> el best-effort lower(trim(name)) de 0108 es determinista). Live breed_catalog count = 32. Grafias literales (Bosmara, S/E con barra, FS=Simmental, SI=San Ignacio) presentes; T1 las testea como muestra anti-regresion.

## 6. Trazabilidad R<n> <-> test (capa DB) - COMPLETA, path real

| R | Migracion | Test (supabase/tests/sigsa/run.cjs) |
|---|---|---|
| R1.1 | 0107 | T1(a) SELECT ok |
| R1.2 | 0107 | T1(c) 28 bovinas activas, T1(d) S/E generic, T1(e) ME/JA/MU active=false, T1 grafias |
| R1.3 | 0107 | T1(a) SELECT, T1(b) INSERT/UPDATE/DELETE rechazados (no-mutacion adversarial) |
| R1.4 | 0108 | T2(a) NULL, T2(b) breed_id valido, T2(c) FK inexistente rechazada |
| R1.5 | 0108 | T2(d/e) aberdeen-angus->AA, texto_raro->NULL (replica del predicado exacto de 0108) |
| R1.6 | 0109 | T3(a) NULL, T3(b) FK valida/inexistente, T3(c) columna breed NO existe -> best-effort no-op |
| R1.7 | 0108+0109 | T2(f) mono hereda AA, T2(f-bis) madre sin breed->NULL, T3 mellizos heredan H, T3 madre sin breed->NULL |
| R2.1 | 0110 | T4(f) dos est mismo renspa sin error |
| R2.2 | 0110 | T4(e) vacio/>20 rechazado por CHECK; valido entra |
| R2.3 | 0110 | T4(a) owner ok, T4(b) vet 42501, T4(c) field_op 42501, T4(d) UPDATE directo vet bloqueado (0007), cross-tenant 42501, anon revocado |
| R3.1 | 0111 | T5(a) owner inserta, T5(d) 2do par viola UNIQUE |
| R3.2 | 0111 | T5(g) mismo animal en 2 campos, declaraciones independientes, sin cross-leak |
| R3.5 | 0111 | T5(a) owner, T5(b) vet, T5(c) field_op rechazado, T5(e/f) cross-tenant no ve |
| R3.6 | 0111 | T5(h) declared_by=auth.uid() aunque el payload mande otro UUID |
| R3.7 | 0111 | T5(i) animal_profile_id de otro est rechazado con establishment_id propio (IDOR) |
| R4.1 | 0112 | T6(a) owner inserta, T6(g) file_content>5MB y file_name>255 rechazados |
| R4.2 | 0112 | T6(a) owner, T6(b) vet, T6(c) field_op rechazado, T6(d) cross-tenant no ve |
| R4.4 | 0112 | T6(h) generated_by=auth.uid() aunque el payload mande otro UUID |
| R11.1 | 0112 | T6(a)/(h) |
| R11.2 | 0111+0112 | T5(h), T6(e) FK real/inexistente, T6(f) ON DELETE SET NULL |
| R11.3 | 0111+0112 | T5 R11.3 (cliente no UPDATE/DELETE), sin grant update/delete en ambas |

R3.3/R3.4 (propiedades estructurales) y R15.x (multi-tenant transversal) cubiertos estructuralmente + por los cross-tenant de T5/T6; R3.4 re-export + R15.1 sync scope son de T11/T7 (capas diferidas, fuera de alcance). Sin falsos-verde: cada rechazo verifica no-mutacion con admin; T2(d/e) documenta que replica el predicado de la migracion (el one-shot no toca filas post-apply) ejerciendo la MISMA logica.

## Tasks completas: SI (para el alcance de este chunk)
T1-T6 marcadas en la bitacora del implementer (no en tasks.md por instruccion - los marca el leader al cerrar). T7-T20 quedan abiertas CON justificacion documentada: capas PowerSync/servicio/UI explicitamente DIFERIDAS y gateadas. No hay task abierta injustificada dentro del alcance.

## CHECKPOINTS
- C2 OK (estado coherente; tests done verdes)
- C3 OK (solo capa backend prevista; sin hardcode establishment_id; sin TODOs sueltos)
- C4 OK (63 tests > 0, todos verdes; fixtures reales contra remoto; cross-tenant presente)
- C6 OK (3 archivos de spec; EARS; cada R<n> de la capa DB con >=1 test; specs reconciliadas con as-built)
- C7 OK (tablas nuevas con establishment_id directo + RLS has_role_in; helpers reusados; cross-tenant T5(f)/T6(d))
- C8 N/A en este chunk (PowerSync/offline = T7, diferido)
- C1/C5 N/A (no es cierre de sesion, es review de chunk)

## Checklist RAFAQ-especifico
### A. Tablas con establishment_id (multi-tenancy / RLS) - APLICA
- [x] enable row level security en breed_catalog/sigsa_declarations/export_log.
- [x] Policies select/insert (sin update/delete) por ADR-004.
- [x] Helpers has_role_in()/is_owner_of() usados (no SQL duplicado inline).
- [x] Test de aislamiento cross-tenant (T5(e/f), T6(d), T4 cross-tenant + IDOR T5(i)).
- [x] deleted_at IS NULL filtrado en has_role_in (helper) + en el IDOR-check; sigsa_declarations/export_log NO tienen deleted_at (append-only, documentado) -> N/A en su SELECT (correcto).
### B. Offline-first - N/A en este chunk (capa DB pura; PowerSync = T7 diferido).
### C. BLE - N/A.
### D. UI de campo - N/A.
### E. Edge Functions - N/A (no hay Edge Function; el generador es modulo local, decision documentada en design).

## Estado de verificacion (re-corrido por el reviewer, independiente)
- node --test supabase/tests/sigsa/run.cjs -> 63/63 pass, 0 fail.
- node scripts/check.mjs -> VERDE (Tests verdes / All tests passed / Entorno listo). Animal suite (spec 02) verde -> sin regresion de creacion de ternero.
- diff mecanico 0048->0108 y 0075->0109 -> minimal, logica de seguridad preservada.
- DB viva: renspa sin unique + CHECK 21ch=23514; reproductive_events.breed ausente (42703) + breed_id presente; breed_catalog=32; animal_profiles.breed y breed_id coexisten.
- Seed 1:1 con breed-senasa.ts (32/0 mismatches), sin nombres duplicados.

## Cambios requeridos
Ninguno.

## Observacion (no bloqueante, para el leader)
feature_list.json: feature 08 esta en spec_ready (no in_progress); ningun feature en in_progress. Consistente con que esto es un chunk parcial (capa DB) y el flip de status quedo diferido a reconvergencia de terminales por los headers de la spec. No afecta el codigo en alcance. Al cerrar el chunk, marcar T1-T6 en tasks.md y reflejar el estado.
