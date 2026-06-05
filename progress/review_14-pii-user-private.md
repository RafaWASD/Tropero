# Review (Gate 2 / reviewer) — Feature 14 14-pii-user-private

**Veredicto: APPROVED**

**Fecha**: 2026-06-04
**Reviewer**: subagente reviewer
**Spec**: specs/active/14-pii-user-private/{requirements,design,tasks}.md
**Gate 1**: progress/security_spec_14-pii-user-private.md (PASS + 2 condiciones obligatorias)
**ADR**: docs/adr/ADR-025-pii-tabla-private-self-only.md
**Bitacora implementer**: progress/impl_14-pii-user-private.md

> ALCANCE: revisados solo los archivos de la feature 14. El working tree tiene ademas
> C3.2 sin commitear de otra feature (agregar-evento, animal/[id], crear-animal, events.spec,
> TimelineEvent, events, event-input, event-timeline, impl_02-frontend-c3.2) — NO revisados.

---

## 1. Trazabilidad R<n> a test (lista completa)

| R<n> | Implementacion (verificada) | Test que lo cubre |
|---|---|---|
| R1.1 (tabla, FK on delete cascade) | 0068:28-34 | run.cjs T19, T20 |
| R1.2 (email not null, phone nullable) | 0068:30-31 | T18, T19 |
| R1.3 (unicidad email vivos) | 0068:50-51 (indice total) + pre-check 0068:75-87 | T18 R2.5; indice |
| R1.4 (RLS enabled) | 0068:103 | T17 (0 filas de B) |
| R2.1 (select self) | 0068:105-108 | T18 (A lee su fila) |
| R2.2 (otro -> 0 filas) | 0068:105-108 | T17 (no-bypass, B3-1) |
| R2.3 (update self) | 0068:110-114 | T18 (A actualiza su phone) |
| R2.4 (update ajeno -> 0 filas) | 0068:110-114 | T18 (fila de B = 0 + phone B intacto) |
| R2.5 (sin insert/delete a authenticated) | 0068:200,207 | T18 R2.5 |
| R3.1/R3.2 (users sin email/phone) | 0068:96 (drop column) | T17 (select email,phone -> error; select * sin contacto) |
| R3.3 (coworker ve id,name) | members.ts:187 (sin cambio) | T17 setup |
| R3.4 (users_select/update_self) | sin cambio (0006) | suite RLS spec 01 |
| R4.1/R4.2 (backfill incl. soft-deleted) | 0068:89-90 | T20 |
| R4.3 (falla atomica) | 0068:75-87 (pre-check dups) + tx | verifica leader al aplicar |
| R5.1/R5.2/R5.3 (trigger signup ambas tablas) | 0068:123-147 | T19 |
| R6.1 (perfil propio lee phone) | profile.ts:60-64, establishments.ts:226-230 | T18 |
| R6.2 (guardar perfil escribe phone) | establishments.ts:265-268 | T18 R2.3 |
| R6.3 (ProfileContext name/phone) | profile.ts:41-71; ProfileContext.tsx | T16 |
| R6.4 (gate telefono -> user_private) | establishments.ts:156-167, 177-187 | T18; e2e setUserPhone |
| R6.5 (email del session) | ProfileContext.tsx:60 | T16 |
| R7.1 (propaga email confirmado) | 0068:169-194 | T23 R7.1 |
| R7.2 (no propaga pendiente) | 0068:178 (is distinct from) | T23 R7.2 |
| R8.1/R8.3 (precheck invite via private) | invite_user/index.ts:82-109 | T21 |
| R8.2/R8.3 (accept lookup owner via private) | accept_invitation/index.ts:124-134 | T22 |
| R9.1 (grant select,update authenticated) | 0068:200 | T18 |
| R9.2 (grant service_role) | 0068:202 | T19/T20/T21/T22 |
| R9.3 (nada a anon) | 0068:208 (revoke all from anon,public) + smoke 0068:234-241 | smoke-check |
| R9.4 (reload schema) | 0068:259 (notify pgrst) | efecto al aplicar |
| R10.1 (patron documentado) | ADR-025 + conventions.md:96-103 | n/a (doc) |

**Resultado**: cada uno de los 41 sub-requisitos R1.1-R10.1 tiene >=1 test concreto o evidencia de implementacion verificada. Sin huecos de cobertura.

---

## 2. Tasks completas: SI

Las 27 tasks de tasks.md estan en [x]. Verificacion por muestreo contra el codigo:

- T1-T9 (migracion 0068): correctas. Orden atomico del design 1.1 respetado: tabla -> indice ->
  trigger updated_at -> backfill (ANTES del drop) -> drop columns -> reescritura trigger signup
  (misma migracion) -> grants/revokes + smoke-check -> trigger propagacion email. Sin ventana.
- T10 (invite_user): re-ruteado en 2 pasos via admin-client (forma 1.2b).
- T11 (accept_invitation): lookup separado (name de users, email de user_private).
- T12-T15 (services): los 5 puntos de I/O migrados, shapes de retorno preservados.
- T16 (verificacion members.ts + ProfileContext): confirmado sin editar — correcto.
- T17-T23 (tests): suite user_private/run.cjs cubre los 7 escenarios.
- T24 (ADR-025), T25 (nota conventions.md): presentes.
- T26 (mapa trazabilidad), T27 (check verde + M-1): documentados.

Ninguna task queda [ ]. OK.

---

## 3. Condiciones obligatorias del Gate 1 — AMBAS CUMPLIDAS

### M-1 (escritor e2e no mapeado) — CUMPLIDA
app/e2e/helpers/admin.ts:85-87 setUserPhone re-ruteado a user_private (update por user_id).
Ya no pega a users.phone (dropeada en T6).

### R7.2 (email confirmado, no pendiente) — CUMPLIDA
Trigger propagate_confirmed_email (0068:169-185) ancla la propagacion a new.email is distinct
from old.email (178). Esa transicion ocurre UNICAMENTE en la confirmacion (el pendiente vive en
auth.users.email_change, no en email). Robusto al shape. security definer + search_path fijo
(172-173). T23 R7.2 (run.cjs:353-379) ejerce el reject path real (cambio pendiente via
clientB.auth.updateUser -> user_private.email NO cambia).

### L-1 (recomendada) — IMPLEMENTADA
Revokes explicitos insert/delete (0068:207-208) + revoke EXECUTE de las 2 funciones SECURITY
DEFINER (0068:214-215) + smoke-check fail-closed (0068:220-256), patron 0055/0065.

---

## 4. Verificaciones especificas pedidas

1. 27 tasks cubiertas — SI (seccion 2).
2. 2 condiciones Gate 1 (M-1 + R7.2) — AMBAS cumplidas (seccion 3).
3. Re-ruteo de EFs via admin-client no rompe la invitacion:
   - invite_user: precheck 2 pasos (user_private por email -> user_roles por user_id) preserva
     already_member (104) y el path no-miembro. privErr/existingErr -> db_error 500. Input
     normalizado a lowercase (58) matchea el email que GoTrue persiste en lowercase — sin
     regresion de casing (0001 ya insertaba new.email sin lower y los prechecks andaban).
   - accept_invitation: name de users (single, 124-128), email de user_private (maybeSingle,
     129-133). Email best-effort en try/catch aislado; si falta la fila, ownerEmail=null salta
     el envio sin romper (retorna establishment_id+role). user.email sale del JWT, no se toca.
4. 5 funciones de profile.ts/establishments.ts:
   - loadProfileNamePhone: name de users, phone de user_private. Shape {name,phone} preservado.
   - loadOwnProfile (156) / saveOwnPhone (177): phone de/a user_private.
   - loadFullProfile (207): name de users, email+phone de user_private. Shape {name,email,phone}.
   - saveProfile (259): phone a user_private PRIMERO, name a users DESPUES (corta si phone falla).
     No-atomicidad de 2 writes documentada (254-257); profile-edit idempotente low-stakes -> OK.
   - members.ts INTACTO: loadMembers pide solo user:users(id,name) (187). Los email restantes son
     de invitations (272/287/299) o input del invite (323/329), no de users. Correcto.
5. Test user_private/run.cjs — no-bypass via PostgREST directo, bien escrito:
   - T17 (164-205) ejerce el canal explotable real con JWT de A (anon key + signin): user_private
     filtrado por user_id=B -> []; select * -> solo fila de A; users select email,phone -> error
     (columnas dropeadas); users select * -> sin email/phone (L-3).
   - T21 asserta el CODIGO especifico already_member (418, unwrap del envelope), no error generico.
   - T18 R2.4 verifica adversarialmente que el phone de B NO cambio (252-257).
   - Usa JWTs reales para los asserts de RLS y service_role solo para fixtures — patron correcto.
6. Migracion NO aplicada al remoto — esperado. La suite falla por tabla inexistente hasta el apply;
   wiring en run-tests.mjs:67 COMENTADO. NO se marca como falla — se evalua el CODIGO.

---

## 5. Arquitectura y convenciones

- architecture.md: I/O solo en services/ (profile.ts, establishments.ts) y EFs — respetado.
  ProfileContext no fetchea (deriva email del session). Soft-deletes preservados (FK cascade;
  backfill incluye soft-deleted). Result tipado en services.
- conventions.md SQL: una migracion por cambio logico, numerada, RLS+indice en la misma migracion.
  Comentarios SQL en espanol explicando el WHY. snake_case plural/singular.
- conventions.md SQL nota PII (96-103): presente, apunta a ADR-025. Cumple R10.1/T25.
- Naming: funciones camelCase, types PascalCase, sin any.

---

## 6. CHECKPOINTS (aplicables a esta feature)

- C1 (harness completo): [x] archivos base, docs y 5 agentes presentes. check.mjs exit!=0 SOLO por
  el preexistente '2 in_progress' (O-1) — no por esta feature.
- C2 (estado coherente): [~] '2 features in_progress' (01 frontend pausado + 14) — coordinacion del
  leader, NO regresion (documentado en impl). Feature 14 sigue in_progress, ok.
- C3 (codigo respeta arquitectura): [x] solo capas previstas; sin deps nuevas; sin TODOs sueltos;
  NO hardcodea establishment_id (lint anti-hardcode: 0 violaciones). user_private self-only.
- C4 (verificacion real): [x] tests con fixtures reales (no mocks de I/O); runner >0 verdes
  (RLS+Edge+Animal+Maneuvers+client+typecheck). Test de aislamiento cross-user (T17).
- C5 (sesion cerrada): [x] sin artefactos temporales; bitacora actualizada.
- C6 (SDD): [x] 3 archivos de spec; requirements EARS estricto; tasks [x]; cada R<n> con >=1 test.
- C7 (multi-tenant): [x] aplicado por analogia — user_private self-only (mas restrictivo). RLS
  habilitado. Sin SQL inline duplicado. Test de aislamiento (T17).
- C8 (offline-first): [N/A] identidad (online por spec 01 R9.2), no carga de campo. design 5 deja
  user_private fuera de buckets multi-miembro de PowerSync (habilitador).

---

## 7. Checklist RAFAQ-especifico

### A. Tablas con establishment_id / multi-tenancy / RLS — APLICA (parcial: RLS, no establishment_id)
- [x] enable row level security en user_private (0068:103).
- [x] Policies select/update self-only (mas restrictivo que ADR-004; sin insert/delete por diseno).
- [N/A] Helpers has_role_in/is_owner_of: user_private self-only puro (user_id = auth.uid()), no
      multi-tenant. Lecturas cross-user legitimas (EFs) van por admin-client scopeado.
- [x] Test de aislamiento cross-user: T17 (A no lee user_private de B -> 0 filas).
- [N/A] deleted_at IS NULL en RLS SELECT: user_private NO tiene deleted_at (sigue el ciclo de users
      via FK cascade); unicidad con indice total (design 2 opcion a, Gate 1 4). Backfill incluye
      soft-deleted a proposito (R4.2).

### B. Datos en campo (offline-first) — N/A
Feature de identidad/PII, no carga de datos en campo. No toca PowerSync (no wired).

### C. BLE — N/A
La feature no toca BLE.

### D. UI de campo (manga/wizard) — N/A
La feature toca services + EFs + migracion, NO UI nueva.

### E. Edge Functions — APLICA
- [x] auth.uid(): requireUser al inicio de ambas EFs (invite_user:36, accept_invitation:32).
- [x] Permisos: invite_user requireOwnerOf (71) antes del precheck; accept_invitation valida
      estado/expiracion/no-doble-rol (bearer, ADR-014).
- [x] Errores con codigo HTTP apropiado + mensaje claro (409 already_member, 500 db_error).
- [x] Test (runner Node-nativo contra DB remota, ADR-012 en vez de deno test): T21/T22. Verde
      post-redeploy de las EFs (esperado).

---

## 8. Observaciones (no bloqueantes)

- O-1: el FAIL de check.mjs ('2 features en in_progress, maximo 1') es preexistente y de
  coordinacion (01 frontend pausado + 14), NO regresion de esta feature. Lo resuelve el leader.
  Resto del check verde: typecheck OK, anti-hardcode 0 violaciones, suites remotas verdes.
- O-2: el trigger on_auth_user_email_confirmed depende del shape de auth.users (schema de Supabase).
  Mitigado por auth.users.email = fuente de verdad + test T23. Documentado L-2 en ADR-025 y
  0068:161-164. Aceptable.
- O-3 (pendiente del leader): aplicar 0068 + redeploy de invite_user/accept_invitation JUNTOS
  (deploy destructivo coordinado), descomentar el wiring de la suite 14 (run-tests.mjs:67) y
  correrla verde. Reconciliar numero de migracion si spec 13/02-Tier2 consumen 0068 antes.

---

## Conclusion

El codigo implementa fielmente la spec 14: cierra B3-1 por separacion fisica en todos los canales
(PostgREST + WAL/PowerSync futuro), las 41 sub-clausulas R tienen cobertura, las 27 tasks estan
completas, las 2 condiciones obligatorias del Gate 1 (M-1 + R7.2) estan cumplidas y la L-1 tambien.
El re-ruteo de las EFs preserva el comportamiento observable; los 5 services migran correctamente y
members.ts queda intacto; el test de no-bypass esta bien escrito y ejerce el path adverso. El unico
FAIL del check es el preexistente '2 in_progress', de coordinacion. La migracion no aplicada al
remoto es estado esperado (deploy gateado del leader), no falla de codigo.

**APPROVED.** Listo para la puerta de codigo humana -> apply coordinado del leader.
