# Review -- 02-modelo-animal (Fase 1 + Fase 2, backend)

Agente: reviewer
Fecha: 2026-05-28
Spec: specs/active/02-modelo-animal/ (aprobada 2026-05-26, refundida 2026-05-28)
baseline_commit (implementer): c1cae843d144cd5f663fdbbd9085d2c1aeb2134c
Alcance revisado: migrations 0013..0041, supabase/tests/animal/run.cjs, hook en scripts/run-tests.mjs, checkboxes de tasks.md. Fase 3+ (cliente/PowerSync/Detox) NO revisada -- pausada intencionalmente.

---

## Veredicto

APPROVED

Backend de spec 02 (Fase 1 schema/triggers/RLS + Fase 2 tests reales) cumple el contrato. check.mjs verde, todos los R-n de Fase 1/2 con test concreto, todas las tasks T1.x/T2.x en [x], RLS multi-tenant solido, y las 4 desviaciones documentadas son tecnicamente correctas y estan cubiertas por tests (incluida la prueba de no-bypass del RPC SECURITY DEFINER). Quedan follow-ups documentales (no de codigo) para el leader/spec_author.

---

## check.mjs

VERDE -- node scripts/check.mjs termina exit 0: typecheck client OK, RLS suite 15/15, Edge suite 26, Animal suite (spec 02) 18/18.

Nota operativa: en la primera corrida la suite RLS fallo con TypeError fetch failed / ECONNRESET (blip de red al llamar auth.admin.createUser). Probe conectividad directa al host Supabase (HTTP 401 = host alcanzable) y re-corri: RLS 15/15, Animal 18/18, pipeline completo verde. El fallo inicial fue transitorio del entorno (no atribuible a la feature ni al codigo). NO es un fallo de tests rojos del trabajo revisado.

---

## Trazabilidad R-n vs test (Fase 1/2)

Suite: supabase/tests/animal/run.cjs (+ herencia RLS de spec 01). Solo R-n con alcance Fase 1/2; R13.x (PowerSync) y R14.x (ficha cliente) son Fase 4/5 -> diferidos.

R1.1 species bovino active -> T2.16 + seed en setup. OK.
R1.2 systems_by_species cria active -> T2.16, T2.9. OK.
R1.3 categories_by_system 10 cria -> T2.3 + seed. OK.
R1.4 catalogos read-only -> T2.16 Caso 3. OK.
R1.5 lectura catalogos authenticated -> T2.16 Caso 1/2. OK.
R2.1/R2.2 crear rodeo owner -> T2.1 setup, T2.9. OK.
R2.3 field_operator no crea rodeo -> T2.8, T2.9. OK.
R2.4 species-system inactivo rechazado -> T2.9 (bovino+invernada 23514). OK.
R2.5 soft-delete rodeo -> T2.9 (RPC soft_delete_rodeo). OK.
R2.6 sin rodeo default -> T2.9 (count=0). OK.
R2.7 gating sustrato -> T2.16 tablas+RLS; enforcement spec 03. SUSTRATO.
R2.8 field_definitions catalogo global -> T2.16 Caso 1 (26). OK.
R2.9 system_default_fields -> T2.16 Caso 2 (26; 23 ON / 3 OFF). OK.
R2.10 rodeo_data_config -> T2.16 Caso 4. OK.
R2.11 pre-populate trigger -> T2.9, T2.16 Caso 4. OK.
R2.12 toggle/habilitar owner-only -> T2.16 Caso 5/6/7. OK.
R2.13 seed 26 cria TENTATIVO -> T2.16 Caso 1/2. OK.
R2.14 management_groups -> T2.17 Caso 1. OK.
R2.15 management_group_id -> T2.17 Caso 2/3/4/5/6. OK.
R2.16 regla display sustrato -> T2.17 FK expuesto. SUSTRATO.
R2.17 lote owner / asignar cualquier rol / soft-delete owner -> T2.17 Caso 1/2/8 (RPC soft_delete_management_group). OK.
R2.18 no auto-asignacion + ortogonalidad -> T2.4 + T2.17 Caso 7. OK.
R3.1-R3.4 animals -> T2.2. OK.
R3.5 animal global visible por rol -> T2.8 (userC sin rol 0). OK.
R4.1 animal_profiles + management_group_id -> T2.2 + T2.17. OK.
R4.2 identificacion flexible -> T2.2 Caso 1-4. OK.
R4.3 est-idv unico -> T2.2 Caso 6. OK.
R4.4 visual_id_alt fuzzy -> T2.11. OK.
R4.5 rodeo del mismo est/activo -> trigger 0021 + T2.9/T2.17. OK.
R4.6 category del system del rodeo -> trigger 0021. OK.
R4.7 compute_category inicial -> T2.3. OK.
R4.8 override manual -> T2.5 manual_override. OK.
R4.9 override bloquea auto -> T2.4. OK.
R4.10 revert recompute -> T2.5 revert_to_auto. OK.
R4.11 unique perfil activo -> schema + T2.2. OK.
R4.12 status enum -> schema. OK.
R4.13 inmutabilidad post-completitud -> T2.14 Caso 1-5. OK.
R5.1-R5.4 busqueda TAG/IDV/visual -> T2.11. OK.
R6.1-R6.5 tablas tipadas -> T2.10/T2.15, T2.4/T2.7, schema-lab. OK.
R6.6 FK animal_profile activo -> schema/FK. OK.
R6.7 created_by auth.uid -> trigger 0024 + T2.13. OK.
R6.8 update solo owner/created_by -> T2.8. OK.
R6.9 cronologia funcion -> = R10.1 animal_timeline (T2.10/T2.15). OK.
R6.10-R6.13 animal_events hibrido -> T2.13 Caso 1-10. OK.
R7.1-R7.5 transiciones auto -> T2.4. OK.
R7.6 compute_category -> T2.5. OK.
R7.7 ortogonalidad -> T2.4 + T2.17 Caso 7. OK.
R8.1/R8.2 teeth_state -> schema + T2.6. OK.
R8.4/R8.5 CUT -> T2.6 (prompt UX = Fase 4). OK.
R9.1-R9.4 ternero al pie -> T2.7 (management_group_id NULL + rollback TAG dup). OK.
R10.1 timeline 7 origenes -> T2.10 v1 + T2.15 v2 observacion. OK.
R10.2 RLS timeline -> T2.10/T2.15 userC 0. OK.
R10.3 category_change history -> T2.4 + T2.5. OK.
R11.1-R11.5 aislamiento/roles -> T2.8 + T2.16/T2.17. OK.
R12.1 deleted_at en entidades -> schema. OK.
R12.2 created_at/updated_at -> schema. OK.
R12.3 soft-deleted no aparece en SELECT -> T2.13 Caso 7, T2.15, T2.9. OK.
R12.4 history por cambio -> T2.4. OK.

Conclusion: ningun R-n de Fase 1/2 queda sin test concreto. R8.3 (no mostrar dientes/CUT para ternero) es UX cliente -> Fase 4 (guideline, no rompe Fase 1/2). R13.x/R14.x diferidos.

---

## Tasks completas

- Fase 1 (T1.1-T1.28): TODAS en [x].
- Fase 2 (T2.1-T2.17): TODAS en [x] (T2.12 = hook al runner, presente en scripts/run-tests.mjs linea 52).
- Fase 3 (T3.1-T3.8), Fase 4 (T4.1-T4.5), Fase 5 (T5.1-T5.4), Fase 6 (T6.1-T6.3): [ ] -- diferidas, frontend pausado (mismo patron que spec 01). Justificacion documentada en spec (Resumen Backend-only en MVP) y en progress/impl_02-modelo-animal.md.

Si -- todas las tasks aplicables a este alcance (Fase 1+2) estan completas.

---

## CHECKPOINTS

- C1 (harness completo) -- [x] (check.mjs exit 0)
- C2 (estado coherente) -- [x] (una feature in_progress)
- C3 (codigo respeta arquitectura) -- [x] backend en supabase/migrations + supabase/tests; sin establishment_id hardcodeado; el unico TODO (campaign_id en 0027) documentado con comment SQL y justificado en spec
- C4 (verificacion real) -- [x] 18 subtests Animal + 15 RLS, fixtures reales, cross-tenant presente (T2.8, T2.16 Caso 9, T2.17 Caso 9)
- C5 (sesion cerrada) -- [ ] N/A para reviewer de feature (cierre de sesion + history.md es del leader)
- C6 (SDD) -- [x] 3 archivos, EARS, cada R-n Fase 1/2 con test. Sub-box done-con-tasks no aplica: feature sigue in_progress
- C7 (multi-tenant) -- [x] toda tabla con establishment_id con RLS; helpers consistentes; cross-tenant test presente
- C8 (offline-first) -- [ ] diferido (Fase 5 PowerSync pausada); no aplica al cierre de backend

---

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id (RLS / multi-tenancy) -- APLICA (fuerte)
- [x] enable row level security en cada tabla nueva (18/18 tablas creadas tienen RLS).
- [x] Policies select/insert/update/delete segun ADR-004 (owner-only en admin: rodeos, rodeo_data_config, management_groups; operativo en eventos/profiles/lote-assign).
- [x] Helpers has_role_in / is_owner_of en todas las policies (sin SQL de autorizacion duplicado inline). Derivacion transitiva via establishment_of_profile (0023) para tablas con animal_profile_id; join a rodeos para rodeo_data_config.
- [x] Test de aislamiento cross-tenant: T2.8, T2.16 Caso 9, T2.17 Caso 9. RLS suite spec 01 (15/15) cubre sustrato.
- [x] deleted_at IS NULL en RLS policies de SELECT de toda tabla con soft-delete (weight/reproductive/sanitary/condition_score/lab/animal_events/animal_profiles/management_groups/semen_registry; rodeo_data_config via rodeos).

### B. Carga/edicion en campo (offline-first) -- N/A
PowerSync / offline es Fase 5, pausada. El sustrato (todas las tablas sincronizables, R13.1) esta modelado; wiring de buckets + tests offline diferido.

### C. BLE -- N/A
La feature no toca BLE (es modelo de datos backend).

### D. UI de campo -- N/A
Sin pantallas en este alcance (Fase 4 pausada).

### E. Edge Functions -- N/A
La logica vive en triggers/RPCs de Postgres (ADR-012). No se agregaron Edge Functions. Las RPCs/triggers SECURITY DEFINER se evaluan en Desviaciones (validan auth.uid/rol antes de operar).

---

## Evaluacion de las 4 desviaciones

### Desviacion 1 -- 0033/0035 alias en animal_timeline -- APROBADA
Fix de aliasing en el primer SELECT del UNION ALL para que order-by event_date desc resuelva. Comportamiento identico al disenado. Cubierto por T2.10/T2.15. Sin riesgo.

### Desviacion 2 -- 0039 identity_check a SECURITY DEFINER -- APROBADA (sin agujero)
- Por que: el trigger original (0021, NO security definer) corria con la RLS del usuario y veia NULL en animals.tag_electronic de una fila recien insertada (invisible porque animals_select deriva de un animal_profile que aun no existe) -> falso negativo de R4.2 en alta TAG-only.
- Abre agujero? NO. Lee SOLO animals.tag_electronic filtrado por id = new.animal_id (el animal del propio insert del usuario). El valor se usa internamente para el CHECK; NO se retorna al usuario. No es invocable fuera del trigger BEFORE INSERT/UPDATE de animal_profiles. search_path pinneado a public. No abusable para leer animals de otro tenant.

### Desviacion 3 -- 0040 revert respeta category_override false explicito -- APROBADA
- Short-circuit correcto: si old.category_override=true AND new.category_override=false entonces return new (respeta el revert, no re-marca override). Resto intacto.
- Consistencia contra R4.8/R4.10/R7.6: el trigger de history (0030 lineas 36-37) usa la MISMA condicion para grabar revert_to_auto. Alineados. T2.5 ejercita ambos caminos y asserta manual_override (R4.8) y revert_to_auto (R4.10/R7.6).

### Desviacion 4 -- 0041 soft-delete via RPC SECURITY DEFINER (CONTRATO) -- APROBADA (RPCs bien scopeados)
- Por que: PostgREST exige que la fila post-UPDATE siga visible segun la SELECT; las SELECT de spec 02 filtran deleted_at is null sobre la propia fila -> UPDATE deleted_at rechazado 42501. Relajar la SELECT romperia R12.3. La RPC SECURITY DEFINER preserva R12.3.
- Bypass de RLS? NO. Cada RPC re-valida la MISMA autorizacion que la policy de UPDATE, scopeando por el establishment del recurso real:
  - soft_delete_rodeo: is_owner_of(v_est) + rechaza si hay animal_profiles activos (R2.5/R11.4).
  - soft_delete_management_group: is_owner_of(v_est) (R2.17/R11.4).
  - soft_delete_animal_event: has_role_in(v_est) y (author=auth.uid o is_owner_of(v_est)) (R6.13).
  - soft_delete_event(kind,id): is_owner_of(v_est) o created_by=auth.uid (R6.8); kind valida la tabla.
  - Todas con search_path=public, auth.uid via helpers, P0002 si no existe.
- Guard critico testeado: T2.9 prueba que un field_operator NO puede usar soft_delete_rodeo (lineas 651-656) -> confirma que el SECURITY DEFINER NO bypassa la autorizacion. R12.3 verificado en T2.9 (rodeo soft-deleted deja de verse).
- Preserva R2.5/R6.8/R6.12/R12.3: si. Autorizacion y lecturas normales identicas al diseno.

Las 4 desviaciones quedan con sign-off del reviewer.

---

## Renumber +1 (offset de migrations)

Verificado: archivos 0001..0041 contiguos, SIN gaps ni colisiones. Spec 01 ocupa 0001..0012 (incluye 0012_invitations_email_nullable.sql ya aplicada en remoto). Spec 02 ocupa 0013..0041. La tabla de mapeo logico-archivo del progress file es coherente con los archivos en disco. El adelanto de 0016_generic_updated_at.sql (antes de rodeos/field_template por dependencia) esta justificado y es idempotente (create or replace). OK.

---

## Cambios requeridos (de codigo)

Ninguno. No se rechaza nada de codigo.

---

## Follow-ups documentales (NO bloquean -- para leader/spec_author, NO cambio de codigo)

1. design.md desactualizado vs as-built (soft-delete). El design modela soft-delete como UPDATE de deleted_at desde el cliente (lineas ~1517, ~1704-1706, hooks softDelete). El as-built lo hace via RPCs SECURITY DEFINER (soft_delete_*, migration 0041). spec_author deberia actualizar design.md para reflejar el mecanismo RPC y su impacto en PowerSync de Fase 5. Ya anotado por el implementer en CONTEXT/07-pendientes.md.
2. Triggers SECURITY DEFINER no previstos en design (0039 identity_check, 0030 record_category_change). Conviene que design.md mencione que corren como SECURITY DEFINER por la invisibilidad RLS de filas recien insertadas (patron split insert + select). Documental.
3. Seed de cria de field_definitions (26 fields) sigue TENTATIVO hasta validar con Facundo (R2.13). Pendiente de producto, no de codigo.
4. R2.17 soft-delete de lote con animales: el as-built deja los animal_profiles apuntando a un lote soft-deleted (cliente reasigna). Es la opcion que eligio el design (design.md linea 511/1859 + T2.17 Caso 8). Consistente; solo dejo constancia de que la rama rechazar del R2.17 no se implemento (se eligio reasigna en cliente), valido per el design.

---

## Notas finales

- La feature queda in_progress (NO se marca done -- eso es del leader + Raf, y Fase 3+ sigue pendiente).
- El backend (Fase 1+2) es operativo end-to-end contra Supabase remoto, verificado con tests reales (no mocks de I/O critico).
- Bloque de trabajo solido: RLS consistente, desviaciones bien razonadas y testeadas, trazabilidad completa.
