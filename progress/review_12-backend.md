# Review - Feature 12 (Importacion masiva de rodeo) - BACKEND (Fase 2, T2.1-T2.5)

Reviewer: reviewer agent. Fecha: 2026-06-06 (sesion 23).
Scope: SOLO backend (migrations 0073/0074 + suite supabase/tests/import/run.cjs + bitacora progress/impl_12-backend.md). El cliente/UI (Fases 1,3,4,5) lo hace otro run - NO revisado aca.

## Veredicto: APPROVED

22/22 tests verde contra el remoto; node scripts/check.mjs verde end-to-end (sin regresion de specs 01/02/03/13/14); las 5 tasks T2.1-T2.5 estan realmente hechas y cubiertas por codigo + test; las afirmaciones del as-built fueron verificadas contra las migraciones reales y son correctas; el reforzamiento de seguridad (campos forzados server-side, RLS multi-tenant, EXECUTE revocado) esta implementado y ejercitado por casos negativos reales.

## Trazabilidad R<n> a test (backend)

- R11.1 -> 0073 tabla import_log ; inserts de la suite (owner/vet) usan el shape completo. OK
- R11.2 (RLS scoped; SELECT has_role_in) -> 0073 policy import_log_select ; "outsider sin rol NO ve" + "outsider NO inserta cross-tenant". OK
- R11.3 (imported_by forzado) -> 0073 trigger tg_force_imported_by_auth_uid ; test asserta =ownerA.id y distinto de outsider.id. OK
- R11.4 (CHECK octet_length + char_length) -> 0073 2 constraints ; "error_details >256KB rechazado" (+ sanity chico SI entra) + "file_name >255 rechazado". OK
- R2.4 (solo owner/vet) -> 0073 policy INSERT vet inline + 0074 re-validacion inline ; field_operator NO inserta / RECHAZADO en RPC ; vet SI. OK
- R9.1 (establishment_id forzado) -> 0074 deriva est del rodeo ; test "establishment_id del rodeo, no del payload" + PROBE 2. OK
- R9.2 (rodeo en est; no cross-tenant) -> 0074 deriva+revalida + trigger rodeo_check 0021 (DB) ; rodeoB rechazado / rol solo en otro est rechazado. OK
- R9.3 (created_by/imported_by) -> trigger 0043 + 0073 ; test created_by = caller. OK
- R9.4 (RPC SECURITY DEFINER, 5 controles) -> 0074 + smoke-check ; field_op/otro-est/rodeo-ajeno/rodeo-inexistente/anon rechazados. OK
- R9.5 (CHECK 0070 + unique capa final) -> 0074 no bypassa ; TAG >64 error de fila + TAG dup skip. OK
- R8.1 (animals+profiles por fila) -> 0074 2 inserts/fila ; test owner importa 2 filas verifica 2 perfiles. OK
- R8.2/R8.4 (import parcial) -> 0074 begin..exception por fila ; TAG dup se saltea (1 err), 2 ok ; adversarial verifica TAG existe 1 vez. OK
- R10.3/R10.5 (override vs placeholder por sexo) -> 0074 resolucion category_code ; PROBE 4/5. SIN test persistente en run.cjs (ver nota 2). OK con nota

Conclusion: cada R de backend (R8.1/R8.2/R8.4, R9.1-R9.5, R11.1-R11.5, R2.4) tiene >=1 test concreto por la razon correcta. R10.3/R10.5 es la unica sin test persistente, fuera de T2.4/T2.5, cubierto por sondas PROBE 4/5 + logica correcta por inspeccion (catalogos torito/vaquillona en 0015/0059). No bloquea.

## Tasks completas: SI

T2.1, T2.2, T2.3, T2.4, T2.5 todas marcadas [x] en tasks.md y realmente hechas (verificado contra codigo). Ninguna de la Fase 2 sin justificacion. Las Fases 1/3/4/5/6 quedan abiertas: correcto, son del run del cliente/UI (out of scope, documentado en la bitacora).

## CHECKPOINTS

- C3 (arquitectura): [x] solo capas backend previstas (supabase/migrations, supabase/tests); sin establishment_id hardcodeado (se deriva del rodeo / contexto).
- C4 (verificacion real): [x] runner 22 tests >0, todos verdes; fixtures reales (JWTs reales + service_role), no mocks; test de aislamiento cross-tenant presente.
- C6 (SDD): [x] los 3 archivos de spec existen; EARS estricto; cada R de backend cubierto por >=1 test.
- C7 (multi-tenant): [x] import_log tiene establishment_id FK + RLS enabled; helpers has_role_in/is_owner_of usados (vet inline justificado: no existe has_role generico, verificado 0005); test cross-tenant (outsider + ownerB + rodeoB).
- C5 (cierre): [x] parcial; la bitacora documenta apply al remoto y borrado de scripts/sondas temporales; el cierre formal (history.md) es del leader.
- C1/C2/C8: N/A para este run de backend. C8 (offline-first) NO aplica: import es operacion de oficina/onboarding online por diseno (R12.1/R12.2, design seccion 7), PowerSync no entra (justificado en la spec).

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id (multi-tenancy / RLS): APLICA
- [x] enable row level security en import_log (0073 L57).
- [x] Policies SELECT (has_role_in) + INSERT (owner/vet) segun ADR-004. Sin UPDATE/DELETE policy: tabla append-only (grants solo select,insert), correcto para audit.
- [x] Helpers has_role_in/is_owner_of usados; predicado veterinarian inline JUSTIFICADO (no existe has_role generico en as-built, verificado 0005). No es SQL duplicado evitable.
- [x] Test de aislamiento cross-tenant: outsider sin rol NO ve/escribe; ownerB rechazado al importar a rodeoA (RPC); rodeoB de otro est rechazado.
- [N/A] deleted_at IS NULL en RLS SELECT: import_log NO tiene deleted_at (audit append-only inmutable). Las queries de dedup del cliente (T3.1, otro run) si filtran deleted_at sobre animals/profiles. No aplica a esta tabla.

### B. Offline-first: N/A. Import = operacion de oficina/onboarding, online por diseno. PowerSync fuera de la feature.

### C. BLE: N/A. El backend no toca BLE.

### D. UI de campo: N/A (run solo backend).

### E. Edge Functions: N/A. No hay Edge Function nueva. El RPC import_rodeo_bulk es funcion SQL SECURITY DEFINER llamada por el cliente directo. Aun asi, controles analogos: valida auth.uid() al inicio (L67-69), valida permisos via user_roles/is_owner_of antes de operar (L84-99), errores con errcode apropiado (42501 authz / 23503 not-found), cubierto por tests Node (deno test no aplica).

## Reconciliacion spec a codigo (regla dura)

as-built reconciliado: requirements.md (R3.8/R9.4 firmes por Puerta 1 D1/D2), design.md (seccion 1.2 migrations 0073/0074 reales, seccion 3.1 Escenario B firme, seccion 6 decision Puerta 1, seccion 9 decisiones cerradas) y tasks.md (T2.1-T2.5 marcadas con anotacion impl_12-backend aplicada al remoto) estan reconciliados con el codigo aplicado. NO quedan contradicciones spec a codigo.

Desviaciones documentadas en la bitacora (todas legitimas):
1. Contrato de p_rows definido por el implementer (la spec no lo fijaba): documentado en header de 0074 y replicado en design seccion 1.2. El cliente (T3.3) arma este shape.
2. Placeholder de categoria D3 interino (por sexo, override=false forzado): alineado al default de design seccion 5 y a compute_category 0062 (verificado: rama sin birth_date/eventos da vaquillona).
3. El RPC NO inserta el import_log (eso es del cliente T3.4). Bloqueo owner/vet en DOS lugares (RPC + policy import_log): coherente.
4. import_log.rodeo_id sin trigger rodeo-en-establishment: decision consciente (metadata de audit del propio tenant, no load-bearing para authz; alineado al patron lab_samples). Ver nota 1.

## Hallazgos / notas (NO bloqueantes)

1. import_log.rodeo_id sin cross-check est/rodeo (bitacora punto 4). Verificado correcto. Un usuario solo inserta import_log en SU establishment (policy INSERT owner/vet de su est). Podria poner un rodeo_id de otro tenant en su propio log: corrompe solo su propia metadata de audit, no leakea ni escribe cross-tenant (SELECT sigue scopeado por has_role_in sobre establishment_id). Dano nulo fuera del propio tenant. Atarlo seria un trigger nuevo fuera del scope aprobado. Aceptable, anotar a futuro (docs/backlog.md).

2. R10.3/R10.5 sin test persistente en run.cjs. La resolucion de categoria (override true con match / placeholder por sexo sin match) esta en 0074 (L110-137) y cubierta por sondas adversariales (PROBE 4/5), pero NO por un test persistente. Recomendacion (no bloqueante): cuando el run del cliente (T3.2) ejercite category_code, agregar 1-2 asserts en run.cjs verificando category_override resultante (true con code valido / false con code inexistente). Las tasks T2.4/T2.5 NO lo listaban, su ausencia no es incumplimiento de la spec.

## Verificacion de los 5 controles del Escenario B (R9.4 / design seccion 6-B): TODOS PRESENTES

- (a) re-valida is_owner_of(v_establishment_id) OR vet inline activo adentro (0074 L84-99); caller sin rol da raise 42501. Test: field_op/ownerB rechazados.
- (b) deriva est/species/system DEL RODEO (L74-82); rodeo inexistente/soft-deleted da raise 23503. Test: rodeo inexistente rechazado.
- (c) setea establishment_id/created_by(0043)/imported_by(0073)/species_id/system_id server-side, NO del payload (L141-168). Test: establishment del rodeo, created_by=caller; PROBE 2.
- (d) revoke all from public, anon + grant execute to authenticated + smoke-check fail-closed (L200-220). Diferencia DELIBERADA con 0058 (service-role-only) documentada en header: correcto, lo llama el cliente directo. Test: anon NO ejecuta.
- (e) CHECK char_length 0070 + unique enforzados dentro del definer (el definer saltea RLS, NO constraints/triggers). Test: TAG>64 error de fila; TAG dup skip; triggers 0021 (identity/rodeo/category) + 0037 (mgmt_group) disparan igual.

## Coordinacion

- [x] NO toco scripts/run-tests.mjs: verificado, la suite import (L67-70) fue enganchada por el leader. Corre como parte de check.mjs (no solo standalone): enganche real, NO verde-falso (leccion spec 03 cubierta).
- [x] NO toco el cliente/UI: solo 0073, 0074, supabase/tests/import/run.cjs y progress/impl_12-backend.md. Fases 1/3/4/5/6 intactas.

## Migrations: idempotencia / numeracion

- [x] Numeracion correcta: 0072 es la mas alta pre-existente; 0073/0074 son las siguientes secuenciales. NO reclaman numeros usados.
- [x] Sin secretos hardcodeados (keys del test vienen de .env.local via env, no inline).
- [x] El smoke-check de 0074 es fail-closed (RAISE EXCEPTION si anon/public quedaran con EXECUTE).

Cierre: backend de la feature 12 (Fase 2) APROBADO. Listo para que el leader cierre Gate 2 de esta porcion. Recomendaciones (no bloqueantes): (1) considerar atar import_log.rodeo_id en est a futuro; (2) agregar asserts de category_override en la suite cuando el run del cliente aterrice T3.2.
