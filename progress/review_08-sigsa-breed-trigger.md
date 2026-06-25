# Review — Spec 08 Run 3: cierre del GAP breed_id (T18) — trigger derive-breed_id + edicion de raza en la ficha

**Agente**: reviewer
**Fecha**: 2026-06-25
**Alcance**: chunk Run 3 — migracion 0113 + edicion de raza en la ficha + seccion T18 + units. NO re-litiga la capa DB previa (0107-0112) ni la seguridad del trigger (Gate 1 PASS, progress/security_spec_08-breed-trigger.md).

---

## Veredicto: APPROVED

El trigger as-built coincide con el diseno, el guard de herencia funciona y esta testeado, la ficha edita SOLO breed (nunca breed_id), la cobertura R->test esta completa, y las specs quedaron reconciliadas con el as-built. Tests verdes (verificados de forma independiente): SIGSA 72/72 (incl. seccion T18), units breed-picker+local-reads 153/153.

---

## Trazabilidad R<n> <-> test (completa para el delta Run 3)

| R | Test concreto | Estado |
|---|---|---|
| R1.4 (derivacion breed_id desde breed, match exacto) | run.cjs T18(a) INSERT Aberdeen Angus->breed_id=AA; T18(d) UPDATE Hereford->H; T18(e) case/trim-insensitive; e2e alta (server-side breed_id=AA, sigsa-breed-renspa.spec.ts:95-117) + ficha-edit (server-side breed=Hereford+breed_id=H, :169-190) | OK verde 72/72 |
| R1.4 (sin match -> NULL, no inventa codigo) | run.cjs T18(b) breed nomatch_xyz->NULL; T18(d-bis) UPDATE a texto sin match->breed_id vuelve a NULL (no queda colgado) | OK |
| R1.4 (cliente manda SOLO breed) | unit local-reads.test.ts:1867 buildSetBreedUpdate -> SQL UPDATE animal_profiles SET breed=? + assert.doesNotMatch breed_id + deleted_at IS NULL; :1877 sin raza->breed=null | OK 153/153 |
| R1.4 UX (completar raza desde la ficha / alta) | e2e Ficha editar la raza (CTA->BreedPickerSheet->Hereford queda); helper breedCodeForName (breed-picker.test.ts:171-195, 6 casos) | OK |
| R1.7 (guard: ternero al pie preserva breed_id heredado) | run.cjs T18(c) breed NULL + breed_id=AA seteado -> PRESERVADO. Path REAL ejercido por T2(f)/T2(f-bis) (trigger mono) + T3 (RPC register_birth mellizos) end-to-end | OK |

> Foco #2 — el guard se ejercita de verdad: T18(c) prueba el guard directo y aislado (insert breed NULL + breed_id explicito). El path REAL del ternero (breed NULL + breed_id heredado por 0108/0109) lo cubren T2(f)/(f-bis)/T3, que crean terneros via el trigger mono y la RPC mellizos y verifican herencia/null del breed_id de la madre. Las 3 pasan en el suite 72/72 con 0113 aplicado.

---

## Foco del chunk — hallazgos

### 1. El trigger as-built coincide con el diseno — OK
0113_derive_breed_id_from_breed.sql:52-81 vs design.md seccion Migration 0113:397-415: identicos (funcion + revoke + drop/create trigger).
- before insert or update of breed on animal_profiles (0113:80) OK
- Guard if new.breed is not null then ... end if (0113:57-63) — sin rama ELSE, con breed NULL NO toca breed_id (preserva herencia) OK
- Match lower(trim(bc.name)) = lower(trim(new.breed)) limit 1 (0113:60-61) — mismo criterio que el best-effort 0108 OK
- NOT SECURITY DEFINER (INVOKER; breed_catalog tiene SELECT abierto a authenticated, 0107) OK
- revoke execute from public, authenticated, anon (0113:76) — no invocable como RPC OK
- Idempotente: create or replace function + drop trigger if exists + create trigger (0113:52,78,79) OK
- NO-match -> breed_id NULL: decision del leader DOCUMENTADA en el comentario de la migracion (0113:15-22), con justificacion (consistencia breed/breed_id, fail-safe para el TXT SENASA). OK

### 2. Sin interferencia / sin recursion — OK
0113 es el UNICO trigger que escucha OF breed (grep en migraciones: solo 0113). Los otros BEFORE OF col de animal_profiles (0079 identidad, 0052 session_id, etc.) son ortogonales — ninguno lee/escribe breed/breed_id. Setear NEW.breed_id dentro de un OF breed no re-dispara. breed_id no entra en compute_category. OK

### 3. La ficha edita SOLO breed, nunca breed_id — OK (offline-safe, patron CUT/0040)
- buildSetBreedUpdate (local-reads.ts:1661-1666): UPDATE animal_profiles SET breed = ? WHERE id = ? AND deleted_at IS NULL — solo breed. OK
- setBreed (animals.ts:1459-1466): runLocalWrite(buildSetBreedUpdate(...)) -> CrudEntry PATCH -> uploadData (mismo patron que setFutureBull/moveAnimalToRodeo). NO hardcodea establishment_id (profileId identifica el perfil). OK
- onSelectBreed ([id].tsx:636-657): persiste newBreed (el NOMBRE); el param _breedId se IGNORA (underscore-prefijado, :637). Sin raza->null. Optimismo en sitio + revert + refresh silencioso. OK
- RLS NO inventada: animal_profiles_update for update using (has_role_in(establishment_id)) with check (has_role_in(establishment_id)) (0022:13-15) — verificado. Cualquier rol activo del campo puede UPDATE de breed (mismo path que la CUT-ficha). OK
- breed sin guard de inmutabilidad: 0036 (immutability_identifiers) inmutabiliza identificadores, NO breed; ninguna migracion referencia OLD.breed. El UPDATE de breed pasa. OK

### 4. R->test (R1.4 derivacion + R1.7 guard) — cubierto, ver tabla arriba.

---

## Tasks completas: si (con salvedad documentada por instruccion del leader)
tasks.md T18 sigue en [~] (PARCIAL) con la nota se cierra en Run 3 con el trigger derive-breed_id. Instruccion explicita del leader (impl_08-sigsa-breed-trigger.md:82 + design changelog): el leader flipea T18 a [x] al cerrar; el implementer NO toca tasks.md. Justificacion documentada -> no es un [ ] huerfano. El resto de spec 08 (T1-T17, T19, T20) en [x].

> Accion pendiente para el leader al cerrar: flipear tasks.md T18 [~]->[x] (unico box no-cerrado; su cierre depende de este chunk).

## Exactitud de specs (codigo -> spec) — OK
- design.md seccion Migration 0113:376-423 (SQL real + edicion de ficha) + changelog AS-BUILT Run 3 (:694-718) — describen el as-built sin contradiccion (SQL byte-identico, guard, NOT SECURITY DEFINER, revoke, ficha escribe solo breed, RLS 0022 no-inventada).
- requirements.md nota de reconciliacion bajo R1.4 (:36-47): poblacion de breed_id centralizada en el trigger; R1.7 sin cambio (el guard la cumple). EARS original intacto + nota. OK
- No hay specs viejas mintiendo tras el chunk. OK

---

## CHECKPOINTS

- C1 — [x] harness completo; [x] check.mjs: SIGSA 72/72 + units 153/153 verificados; las 2 fallas del Animal suite son spec-13 INPUT-1 CHECK (ajenas a breed/0113, NO regresion del chunk).
- C2 — [x] una feature in_progress (08); [x] tests verdes en lo tocado.
- C3 — [x] capas previstas (migracion + service + hook-de-ficha + util puro); [x] sin deps nuevas; [x] sin logs/TODOs sueltos; [x] NO hardcodea establishment_id.
- C4 — [x] test por modulo con logica (T18, buildSetBreedUpdate, breedCodeForName); [x] fixtures reales (run.cjs contra remoto, JWTs reales); [x] runner >0 y verde; [x] cross-tenant cubierto (capa DB previa T5/T6; el trigger lee breed_catalog global, Gate 1 PASS).
- C6 — [x] 3 archivos de spec; [x] EARS; [~] T18 [~] (cierre = accion del leader, documentada); [x] cada R<n> del delta con >=1 test.
- C7 — [x] N/A tabla nueva (el chunk no crea tablas); [x] has_role_in usado (0022, no SQL inline); [x] cross-tenant cubierto (breed_catalog global, Gate 1 PASS).
- C8 — [x] offline-first (UPDATE de breed por upload queue, optimismo en sitio); [x] bucket (animal_profiles ya en el sync set, sin stream nueva); [x] conflict resolution LWW explicito (JSDoc local-reads.ts:1651-1656, breed_id local stale hasta re-sync, benigno).

---

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id (RLS) — parcial / N/A para tabla nueva
El chunk NO crea tablas. Toca el write-path de animal_profiles (existente, RLS 0022).
- [x] RLS ya habilitada en animal_profiles (specs previas).
- [x] Policy UPDATE segun ADR-004 / 0022 (has_role_in) — NO se invento policy.
- [x] Helper has_role_in() usado (no SQL inline).
- [x] Aislamiento cross-tenant: el trigger lee breed_catalog global (sin tenant); el UPDATE de breed lo scopea has_role_in (0022) al subir. Gate 1 sin fuga.
- [x] deleted_at IS NULL filtrado en el UPDATE de la ficha (buildSetBreedUpdate).

### B. Carga/edicion en campo (offline-first) — aplica
- [x] Funciona offline (UPDATE local -> upload queue; optimismo en sitio; trigger server-side al subir).
- [x] Sin requests sincronos a Supabase desde la pantalla — setBreed -> runLocalWrite (SQLite local); fetchBreedCatalog lee del SQLite local.
- [x] Conflict resolution: LWW explicito (JSDoc; breed_id local stale hasta re-sync, benigno).
- [x] Bucket correcto: breed_catalog global; animal_profiles scoped por establishment (ya en el sync set).

### C. BLE — N/A (el chunk no toca BLE).

### D. UI de campo (ficha) — aplica (BreedRow)
- [x] Target size: CTA minHeight touchMin (Fitts, [id].tsx:1697).
- [x] Fuente legible: CTA value fontSize 5 con lineHeight 5 matching (descender clipping fix); label 3.
- [x] Una decision por pantalla: fila editable que abre un sheet, no form largo.
- [x] Estado de loading: optimismo en sitio + revert si falla + refresh silencioso (feedback inmediato).

### E. Edge Functions — N/A (la derivacion es un trigger DB, no Edge Function).

---

## Cambios requeridos
Ninguno. (Recordatorio operativo para el leader: flipear tasks.md T18 [~]->[x] al cerrar — depende de este chunk, por instruccion propia.)

## Nota menor (no bloqueante, no exige cambio)
El comentario-header del hook SIGSA en scripts/run-tests.mjs:111-115 enumera 0107-0112 pero no menciona 0113/T18 (el hook corre el archivo completo, T18 incluido — sin impacto funcional). El leader puede sumar 0113 (T18) a ese comentario al cerrar. No afecta la ejecucion ni el veredicto.
