# Review (reviewer) -- spec 09 chunk 09 resto - dedup A/B -- Run 1 (backend)

Fecha: 2026-06-13 (sesion 25). Reviewer: reviewer (Opus).
Run revisado: Run 1 -- Fases 1/2/3 (RPC assign_tag_to_animal + suite backend + service offline cliente).
Baseline: f743a97cc3959c755d32bc2b991d24c662ec886d.
Insumos: requirements-09resto-dedup.md (RD1/RD2), design-09resto-dedup.md (s1/s2/s8.1), tasks-09resto-dedup.md (F1/F2/F3), security_spec_09resto-dedup.md (Gate 1 PASS), impl_09resto-dedup.md, molde 0087_transfer_animal_rpc.sql.

---

## VEREDICTO: APPROVED

El RPC assign_tag_to_animal (0089) es paridad fiel del contrato que Gate 1 aprobo: orden (a) a (f) tal cual, idempotencia state-based pura (sin columna ni tabla de audit), p_client_op_id puro passthrough, 23505 propagado sin capturar, cierre de superficie identico en estructura a 0087. La suite backend cubre los 6 escenarios + 3 extras con guard assertRpcExists y la condicion DA-1 de Gate 1 testeada. El cliente (outbox + mapping + clasificacion + service) esta correcto, sin regresion y sin case especial fragil (fold MED-1). Typecheck, lint anti-hardcode y units cliente verdes. La suite assign_tag_to_animal FALLA con PGRST202 (migracion no aplicada) -- ESPERADO; va verde post-deploy del leader (F1.3 gated).

---

## 1. Fidelidad al contrato de Gate 1 (RPC 0089) -- OK

- Orden (a) derivar / (b) authz / (c) formato / (d) idempotencia / (e) UPDATE guard / (f) race: L50-100, identico al design s1.2, NO conmutable. OK
- (a) anti-IDOR: v_est + v_animal_id derivados de la fila real del perfil activo no soft-deleted (L52-60); NULL -> 23503. El UPDATE (e) usa SOLO v_animal_id derivado, nunca un id del payload. OK
- (b) authz has_role_in(v_est) sobre el tenant DERIVADO (cualquier rol activo, D-d) -> 42501; corre ANTES de la dedup (L65-67). OK
- (c) formato regex 15 digitos o NULL -> 23514 (L71-73, short-circuit del NULL antes del regex). OK
- (d) idempotencia STATE-BASED: EXISTS animals con id=v_animal_id y tag=p_tag_electronic -> replay:true (L80-86). Anclada a v_animal_id del tenant ya autorizado -> sin oraculo cross-tenant. NO columna last_assign_op_id, NO tabla de audit. OK
- p_client_op_id puro passthrough: confirmado por grep, NO aparece en ningun select/update/exists/where del cuerpo (solo firma + comentarios). OK
- (e) UPDATE con guard AND tag_electronic IS NULL (L91-93). OK
- (f) if not found -> 23514 race (L98-100). El IF EXISTS de (d) NO resetea FOUND; el UPDATE de (e) lo setea. Idiom correcto. OK
- 23505 propaga sin capturar: no hay exception when unique_violation; el dup global del indice animals_tag_unique (0019) sube crudo -> permanent_reject en sync. OK

## 2. Cierre de superficie (RD1.8) -- paridad con 0087, OK

- revoke from public/anon + grant to authenticated con firma tipada (uuid, text, uuid) (L124-125).
- Smoke-check fail-closed: do-block que itera anon/public y raise si tienen EXECUTE (L127-139), estructura identica a 0087:279-291.
- notify pgrst reload schema (L141) + search_path fijo en la definicion (L45).
- Funcion NUEVA -> sin firma vieja que dropear ni grant colgando (Gate 1 punto 6).

## 3. Suite backend (supabase/tests/animal/run.cjs L3562-3784) -- 6 escenarios + 3 extras, OK

- Esc.1 NULL->valor OK + replay:false + propagacion 0079 a animal_profiles.animal_tag_electronic (RD1.9). OK
- Esc.2 valor->valor rebota 23514 (guard IS NULL -> 0 filas) + caravana original no pisada. OK
- Esc.3 anti-IDOR: perfil de OTRO campo (caller sin rol) -> 42501 + el animal ajeno NO recibe la caravana. OK
- Esc.4 rol sin acceso (userC nuevo) -> 42501. OK
- Esc.5 idempotencia state-based: replay con MISMO client_op_id -> replay:true; + replay con client_op_id DISTINTO sobre el mismo estado -> replay:true (condicion DA-1 de Gate 1: la dedup es por ESTADO, no por client_op_id). OK
- Esc.6 dup global: TAG en OTRO animal -> 23505, distinguido del race; el 2do animal sigue sin caravana. OK
- Extras: grants anon fail-closed (pasa aunque la fn no exista -- anon nunca tiene EXECUTE); formato no-15-dig (5 inputs) -> 23514; perfil inexistente -> 23503.
- Guard assertRpcExists (L3580-3584) en cada escenario que asertea un codigo de error -> un PGRST202 NO pasa por la razon equivocada. eid15() (L3589-3594) genera 15 dig que cumplen el regex.

## 4. Service cliente (RD2) -- OK

- enqueueAssignTag (outbox.ts L346-356): SIN overlay (enqueue del intent con overlay vacio) -- animals no esta local (ADR-026 b1). op_type = nombre exacto del RPC. OK
- RPC_OP_TYPES (upload.ts L52): incluye assign_tag_to_animal. Rama p_client_op_id (L138-141): generica (register_birth o assign_tag_to_animal); rpcName = opType sin case especial (fold MED-1). OK
- classifyIntentUploadError SIN cambios para esta op: 23505/23514/42501/23503 -> permanent_reject por el default; el 23505 de assign_tag NO cae en el idempotent_discard de register_birth (gateado por opType register_birth). Replay = 2xx (no entra al clasificador). Verificado en connector.ts uploadData (bitacora paso 8). OK
- units upload.test.ts (L98-116 mapeo + L326-348 clasificacion): 23/23 verde. OK
- assignTagToAnimal(profileId, tag) (animals.ts L996-998): thin sobre la outbox, contrato literal de design s2.4. OK

## 5. Sin regresion + convenciones -- OK

- typecheck (tsc --noEmit): exit 0.
- lint anti-hardcode (ADR-023 s4): 0 violaciones. Grep de UUID en los 4 archivos del run: 0 matches.
- units cliente (upload.test.ts): 23/23.
- suite Animal: 100/109 -- los 9 fails = exclusivamente PGRST202 de assign_tag (8 escenarios + 1 contenedor padre), gateados por assertRpcExists. Cero fail de la suite Animal preexistente (spec 02/11/13/15) fuera de assign_tag.
- Scope: solo los 6 archivos del run + reconciliacion de specs (notas AS-BUILT en requirements.md base R7/R8/R12, del spec_author/leader) + bitacoras. No se toco codigo fuera de scope.
- voseo es-AR en comentarios, codigo en ingles. OK

---

## Trazabilidad RD <-> test (completa)

- RD1.1 (RPC existe/asigna) -> run.cjs::escenario 1 (NULL->valor OK)
- RD1.2 (anti-IDOR + 23503) -> run.cjs::escenario 3 + run.cjs::perfil inexistente -> 23503
- RD1.3 (authz 42501) -> run.cjs::escenario 3 + run.cjs::escenario 4 (sin rol activo)
- RD1.4 (formato 23514) -> run.cjs::formato no-15-dig -> 23514 (5 inputs)
- RD1.5 (guard IS NULL / race 23514) -> run.cjs::escenario 2 (valor->valor rebota 23514, original no pisada)
- RD1.6 (idempotencia state-based) -> run.cjs::escenario 5 (replay:true con mismo Y distinto client_op_id -- condicion DA-1)
- RD1.7 (unicidad global 23505) -> run.cjs::escenario 6 (dup global, distinguible del race)
- RD1.8 (cierre de superficie) -> run.cjs::grants NO invocable por anon (fail-closed) + smoke-check en 0089
- RD1.9 (propagacion 0079) -> run.cjs::escenario 1 (animal_tag_electronic propagado al perfil)
- RD2.1 (service offline) -> animals.ts::assignTagToAnimal (typecheck; SDK-bound, sin unit propio como exitAnimalProfile)
- RD2.2 (enqueueAssignTag sin overlay) -> outbox.ts::enqueueAssignTag (typecheck + inspeccion: overlay vacio)
- RD2.3 (RPC_OP_TYPES + p_client_op_id) -> upload.test.ts::mapIntentToRpc assign_tag_to_animal -> p_client_op_id inyectado
- RD2.4 (clasificacion errores) -> upload.test.ts::assign_tag_to_animal 23505/23514/42501/23503 -> permanent_reject; red -> transient; NO idempotent_discard
- RD2.5 (offline-first, replay=2xx ACK) -> connector.ts uploadData (replay devuelve data sin error -> ACK) + esc.5

Cobertura: cada RD del Run 1 (RD1.1 a 1.9, RD2.1 a 2.5) tiene 1 o mas tests concretos. Sin huecos. RD3 a RD9 (UI opcion A/B, E2E) son de Runs 2-4 (Fases 4-6), NO entran en este Run.

## Tasks completas: SI (para el scope del Run 1)

tasks-09resto-dedup.md: F1.1 [x], F1.2 [x], F2.1 [x], F3.1 [x], F3.2 [x], F3.3 [x], F3.4 [x] -- todas con notas AS-BUILT.

[ ] justificadas (NO bloquean el Run 1):
- F0.1 (Gate 1): lo corre el leader; YA esta PASS (security_spec_09resto-dedup.md).
- F1.3 (GATED): deploy de la migracion, lo aplica el leader via MCP tras APPROVE + Gate 2 (autorizacion de Raf documentada). Es la razon ESPERADA del PGRST202.
- F4.x / F5.x / F6.x / F7.x: Runs posteriores (UI opcion A/B, E2E, cierre). Fuera del Run 1.

---

## CHECKPOINTS (aplicables al Run 1)

- C1 [x] check.mjs: los unicos rojos son PGRST202 esperado (deploy gated) + flake de rate-limit en Edge (terminales paralelas, no regresion, no toca el Run 1).
- C2 [x] una sola feature in_progress; current.md describe la sesion activa.
- C3 [x] respeta arquitectura (services/migrations); sin deps nuevas; sin logs de debug; sin establishment_id hardcodeado.
- C4 [x] test por modulo con logica (RPC -> suite backend; mapeo/clasificacion -> units); fixtures reales (clientes A/B/C, animales seedeados); cross-tenant testeado (esc.3 anti-IDOR).
- C6 [x] specs/active con los 3 archivos del chunk; EARS; tasks del run [x]; cada RD con 1+ test.
- C7 [x] multi-tenant: el RPC deriva tenant de la fila real + has_role_in(v_est) (helper, no SQL inline); test cross-tenant esc.3/esc.4. No tabla nueva con establishment_id; consume RLS de spec 02 (RD1.9).
- C8 [x] offline-first: encolado via outbox sin red (DEC-2); bucket existente (animal_profiles, sin stream nueva); conflict resolution documentada (race -> 23514, dup -> 23505, replay state-based).
- C5 [ ] cierre de sesion: N/A para un run intermedio (lo cierra el leader al final del chunk).

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id / RLS -- APLICA (via RPC SECURITY DEFINER)
- [x] enable RLS: el chunk NO crea tablas (RD1.9); consume la RLS de spec 02 sobre animal_profiles/animals. El RPC es SECURITY DEFINER que re-implementa el control via anti-IDOR + has_role_in.
- [x] Policies: N/A (no se crean policies nuevas).
- [x] Helpers has_role_in() usados (no SQL duplicado inline): L65 public.has_role_in(v_est).
- [x] Test de aislamiento cross-tenant: esc.3 (perfil de otro campo -> 42501, animal ajeno intacto) + esc.4.
- [x] deleted_at IS NULL: el derivado del perfil lo filtra (L56-57).

### B. Datos en campo (offline-first) -- APLICA
- [x] Funciona offline: encolado via outbox sin red (DEC-2 / RD2.5).
- [x] Sync bucket correcto: el efecto baja por animal_profiles.animal_tag_electronic (stream existente scopeada por establishment); no se agrega stream.
- [x] Resolucion de conflictos documentada: race (guard IS NULL -> 23514), dup global (23505), replay (state-based -> 2xx). design s2.3/s5 + RD6.
- [x] No hace requests sincronos a Supabase desde la pantalla: el service encola en la outbox (SQLite local); el RPC corre al drenar. (UI = Runs 2-3.)

### C. BLE -- N/A
La rama BLE (listener / bastoneo) es de Runs 2-3 (UI). El Run 1 es RPC + service + suite. El EID se re-valida server-side (regex 15 digitos).

### D. UI de campo -- N/A
No hay UI en el Run 1 (modo assign_or_create = Run 2; BulkTagAssignmentScreen = Run 3).

### E. Edge Functions -- N/A
El chunk usa un RPC SECURITY DEFINER (no Edge Function). Igual cumple el espiritu: authz al inicio (deriva tenant + has_role_in), errores con codigo apropiado (23503/42501/23514/23505), test backend (node:test) escrito (verde post-deploy).

---

## Cambios requeridos

Ninguno. APPROVED.

### Notas para el leader (no bloquean)
1. Aplicar la migracion 0089 al remoto via MCP (deploy pre-autorizado, gated) -> re-correr la suite Animal: los 9 fails de PGRST202 deben pasar a verde. Unica accion pendiente para cerrar la verificacion backend.
2. Los rojos de la suite Edge (spec 13) en check.mjs son Request rate limit reached (flake de auth por terminales paralelas) -- NO regresion, NO toca el Run 1.
3. Runs 2-4 (UI opcion A/B, E2E, cierre + reconciliacion final F7.3) pendientes.
