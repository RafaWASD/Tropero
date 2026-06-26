baseline_commit: 559864423de4ee53fb02d33c40dbe090481210d6

# impl 08 — SIGSA Run 3: cierre del GAP breed_id (T18) — trigger derive-breed_id + edición de raza en la ficha

> Cierra el GAP documentado en design.md changelog 2026-06-25: el BreedPicker setea `animal_profiles.breed`
> (TEXTO, nombre exacto del catálogo) pero NO `breed_id` → ningún animal nuevo obtiene breed_id → aparece
> "Falta la raza" → no exportable, y el link "A completar → ficha" no tenía dónde completar. Solución del
> leader (NO re-litigada): un trigger que DERIVA `breed_id` desde `breed` por match de nombre (arregla
> alta + import + edición uniformemente, sin cambiar firmas de RPC) + edición de raza en la ficha.

**Estado de entrada**: feature 08 `in_progress`, Puerta 1 aprobada. Capas pura/DB/PowerSync/servicio/UI ya
construidas y gateadas. Migraciones 0107-0112 APLICADAS al remoto (leader). Próxima migración libre = **0113**.

**Pre-condiciones verificadas**: feature `in_progress` ✅ · 3 archivos de spec presentes ✅ ·
`animal_profiles_update` RLS = `for update using (has_role_in(establishment_id)) with check (...)` (0022) →
cualquier rol activo puede UPDATE de `breed` (mismo path que la CUT-ficha) ✅ — NO se inventa policy.

**⛔ NO se aplicó la migración 0113** (deploy gateado por el leader). Tampoco se tocó connector / servicio
SIGSA / rafaq.yaml / otras migraciones. NO se marcó tasks.md. NO se corrió check.mjs completo (flake Animal suite).

---

## Plan (T1..T6 del run)

- [x] T1 — Migración `0113_derive_breed_id_from_breed.sql`
- [x] T2 — Tests de trigger en `supabase/tests/sigsa/run.cjs` (§T18, 6 casos)
- [x] T3 — Helper puro `breedCodeForName` + test
- [x] T4 — Edición de raza en la ficha (`[id].tsx` `BreedRow` + `setBreed` + `buildSetBreedUpdate`)
- [x] T5 — e2e (alta server-side assert breed_id + ficha-edit) + screenshot veto
- [x] T6 — Verificación + autorrevisión + reconciliación specs

---

## Referencias clave del repo (verificadas antes de codear)

- **Herencia del ternero al pie** (riesgo #1): el ternero entra con `breed` NULL + `breed_id` SETEADO
  por la madre, en DOS caminos: MONO = `tg_reproductive_events_create_calf` (0108, INSERT del perfil con
  `breed_id => v_mother_breed_id`, `breed` no se setea = NULL) y MELLIZOS = `register_birth` (0109, idem en
  el loop). → El guard `NEW.breed IS NOT NULL` del trigger nuevo asegura que NO pise ese breed_id heredado.
- **Triggers existentes de animal_profiles**: `compute_category` NO usa breed_id; los `BEFORE ... OF <col>`
  (0079 identidad, 0084 is_castrated, 0085 future_bull, 0054 teeth/is_cut/category) disparan por SUS columnas,
  no por `breed` → el nuevo `BEFORE INSERT OR UPDATE OF breed` es ortogonal. Setear `NEW.breed_id` NO re-dispara
  `UPDATE OF breed` (no recursión).
- **Patrón de UPDATE offline-safe de propiedad** (la ficha): `buildSetTeethStateUpdate`/`buildSetCutUpdate`
  (local-reads.ts) = `UPDATE animal_profiles SET <col> = ? WHERE id = ? AND deleted_at IS NULL` → CrudEntry
  PATCH → `uploadData` lo sube. Service fn delgado `setFutureBull`/`moveAnimalToRodeo` (animals.ts). El cliente
  manda SOLO `breed` (NUNCA breed_id — lo deriva el trigger; idéntico a `createAnimal` líneas 804-810).
- **BreedPickerSheet** (ya existe): props `{ open, onClose, breeds, selectedCode, onSelect(breedId, senasaCode) }`.
  El alta lo usa via `onSelectBreed` que toma `selectedBreedLabel(catalog, senasaCode)` → setea `breed` (nombre).
  La ficha necesita name→code para el `selectedCode` actual → helper nuevo `breedCodeForName`.

---

## Archivos tocados

**Migración (NO aplicada — deploy gateado por el leader):**
- `supabase/migrations/0113_derive_breed_id_from_breed.sql` (nueva)

**Backend tests (gated al apply de 0113):**
- `supabase/tests/sigsa/run.cjs` — §T18 (6 casos: a/b/c/d/d-bis/e) + header actualizado.

**Cliente:**
- `app/src/utils/breed-picker.ts` — helper puro `breedCodeForName` (name → senasa_code).
- `app/src/utils/breed-picker.test.ts` — 5 tests de `breedCodeForName`.
- `app/src/services/powersync/local-reads.ts` — `buildSetBreedUpdate(profileId, breed)`.
- `app/src/services/powersync/local-reads.test.ts` — 2 tests de `buildSetBreedUpdate`.
- `app/src/services/animals.ts` — `setBreed(profileId, breed)` + import del builder.
- `app/app/animal/[id].tsx` — `BreedRow` (fila Raza editable) + `onSelectBreed` + estado
  `breedCatalog`/`breedPickerOpen` + `canEditBreed`/`selectedBreedCode` + `useEffect` de `fetchBreedCatalog`
  + render del `BreedPickerSheet` + imports (setBreed, fetchBreedCatalog, BreedPickerSheet, breedCodeForName,
  selectedBreedLabel, BreedCatalogEntry, useEffect).

**e2e:**
- `app/e2e/sigsa-breed-renspa.spec.ts` — (1) alta test extendido con server-side assert breed_id=AA derivado
  (poll); (2) test nuevo "Ficha: editar la raza …" (CTA → sheet → Hereford → server-side assert breed+breed_id).
- `app/e2e/sigsa-run3-screenshot.spec.ts` — throwaway, capturas del veto (3 PNG en `design/veto-sigsa-run3/`).

**Specs reconciliadas (as-built):**
- `specs/active/08-export-sigsa/design.md` — §"Migration 0113" (SQL + edición de ficha) + changelog AS-BUILT Run 3.
- `specs/active/08-export-sigsa/requirements.md` — nota de reconciliación bajo R1.4 (población via trigger).
- `progress/current.md` — P4 Run 3 con el plan T1..T6.
- (tasks.md NO tocado — el leader flipea T18 a `[x]` al cerrar; instrucción explícita.)

---

## El SQL del trigger (0113)

```sql
create or replace function public.tg_derive_breed_id_from_breed ()
returns trigger language plpgsql as $$
begin
  if new.breed is not null then
    new.breed_id := (
      select bc.id from public.breed_catalog bc
      where lower(trim(bc.name)) = lower(trim(new.breed))
      limit 1
    );
  end if;
  return new;
end; $$;

revoke execute on function public.tg_derive_breed_id_from_breed () from public, authenticated, anon;

drop trigger if exists animal_profiles_derive_breed_id on public.animal_profiles;
create trigger animal_profiles_derive_breed_id
  before insert or update of breed on public.animal_profiles
  for each row execute function public.tg_derive_breed_id_from_breed();
```

Decisiones (todas verificadas contra el repo, NO re-litigadas):
- `BEFORE INSERT OR UPDATE OF breed` → solo dispara cuando `breed` está en el SET. Ortogonal a los otros
  `BEFORE ... OF <col>` de animal_profiles (0079 identidad, 0084 is_castrated, 0085 future_bull, 0054
  teeth/is_cut/category) — ninguno toca `breed`/`breed_id`.
- **NO SECURITY DEFINER**: corre en contexto del writer; `breed_catalog` tiene SELECT abierto a authenticated
  (0107) → el writer lo lee sin elevar. `revoke execute` (defensa: no invocable como RPC, alinea con 0084).
- **NO recursión**: setear `NEW.breed_id` NO re-dispara `OF breed` (misma fila NEW en vuelo; el trigger
  escucha `OF breed`, no `OF breed_id`).
- **NO interfiere con compute_category**: `breed_id` no entra en el cálculo de categoría (deriva de
  sexo+edad+eventos+is_castrated). Verificado: ningún trigger de categoría (0046/0086/0104) lee breed/breed_id.
- Idempotente: `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`.
- Verificado: SOLO 0113 setea `NEW.breed_id` via trigger; 0108/0109 setean `breed_id` en el INSERT del ternero
  (column list), no via trigger → sin conflicto.

## Cómo verifiqué el GUARD de la herencia (riesgo #1)

El ternero al pie se crea (0108 mono `tg_reproductive_events_create_calf` / 0109 mellizos `register_birth`)
con el INSERT del `animal_profiles` que enumera `breed_id => v_mother_breed_id` y NO enumera `breed` → `breed`
queda NULL. Mi trigger BEFORE INSERT corre, ve `breed IS NULL`, y con el guard `if new.breed is not null`
**NO entra** a la rama que setea `breed_id` → el `breed_id` heredado (aaId) se preserva.

Test **T18(c)** lo prueba directo: `createAnimal(..., breedId: aaId)` (sin `breed`) → INSERT con `breed_id=aaId`
+ `breed` NULL → assert `breed === null` (precondición) Y `breed_id === aaId` (el guard preservó). Sin el guard,
el trigger pondría `breed_id = NULL` (porque `lower(trim(NULL))` no matchea) → el ternero perdería la raza.

## El patrón de UPDATE de la ficha (offline-safe)

`buildSetBreedUpdate(profileId, breed)` = `UPDATE animal_profiles SET breed = ? WHERE id = ? AND deleted_at
IS NULL` — idéntico patrón a `buildSetTeethStateUpdate`/`buildSetCutUpdate` (propiedad de animal_profiles, no
evento; CrudEntry PATCH → uploadData lo sube). El service `setBreed` es un orquestador delgado (= setFutureBull
/moveAnimalToRodeo): un `runLocalWrite` + propagación de error. El cliente manda SOLO `breed` (el nombre);
**NUNCA breed_id** (lo deriva el trigger al subir, anti-drift) — idéntico a `createAnimal` (líneas 804-810).

RLS: `animal_profiles_update` = `for update using (has_role_in(establishment_id)) with check (...)` (0022) →
cualquier rol activo puede UPDATE de `breed` (mismo path que la CUT-ficha, que ya actualiza animal_profiles).
**Verificado contra el repo — NO se inventó policy.** `breed` no tiene trigger de inmutabilidad (verificado:
0036 inmutabiliza `idv`, no `breed`).

La ficha (`onSelectBreed`): optimismo EN SITIO (`setDetail({...d, breed: newBreed})`) + revert si falla + refresh
silencioso (no blanquea, no resetea scroll) — mismo patrón que `onAssignLote`/`onSetCastrated`. El `breed_id`
en el SQLite local queda STALE tras el UPDATE local hasta el re-sync (benigno: la ficha muestra `breed`, el
export lee el set sincronizado; documentado en el JSDoc de `buildSetBreedUpdate`).

---

## Trazabilidad R<n> → test

| R | Cobertura nueva (Run 3) |
|---|---|
| **R1.4** (población de breed_id going-forward) | Trigger: `run.cjs §T18(a)` (INSERT 'Aberdeen Angus' → breed_id=AA), `T18(d)` (UPDATE 'Hereford' → breed_id=H), `T18(d-bis)` (UPDATE sin match → NULL), `T18(e)` (case/trim-insensitive). Unit: `buildSetBreedUpdate` (local-reads.test.ts, SOLO breed, sin breed_id). e2e: alta (server-side breed_id=AA) + ficha-edit (server-side breed='Hereford'+breed_id=H). |
| **R1.4** (no inventa códigos / sin match → NULL) | `run.cjs §T18(b)` (breed 'nomatch_xyz' → breed_id NULL). |
| **R1.7** (guard: ternero al pie preserva breed_id heredado) | `run.cjs §T18(c)` (breed NULL + breed_id seteado → PRESERVADO). |
| **R1.4 UX** (completar la raza desde la ficha) | e2e `sigsa-breed-renspa.spec.ts` "Ficha: editar la raza …" (CTA "Completá la raza para SIGSA" → BreedPickerSheet → raza queda). Helper `breedCodeForName` (breed-picker.test.ts, name→code para el selectedCode). |
| **R8.2/R8.3** (cierre del loop "a completar") | El animal sin breed_id deja de estar "a completar" tras setear breed (el trigger deriva breed_id). Cubierto transitivamente por los asserts breed_id de e2e + el flujo UI capturado. |

> ⚠️ **GATING (igual que la capa DB original)**: los tests del trigger (`run.cjs §T18` a/d/d-bis/e) y los
> server-side asserts de breed_id en e2e PASAN VERDE **recién después de que el leader aplique 0113** al remoto
> (corren contra la DB remota; sin el trigger, breed_id queda NULL). T18(b) y T18(c) pasarían aun sin apply por
> coincidencia (b: NULL esperado; c: nada deriva → breed_id queda como se insertó), pero el suite §T18 como
> conjunto FALLA hasta el apply. Las unit (`breedCodeForName`, `buildSetBreedUpdate`) y el flujo UI del e2e
> (sin el breed_id assert) son verdes AHORA. Por eso NO corrí check.mjs completo.

---

## Verificación corrida

- `pnpm typecheck` (app) → **VERDE** (incluye `[id].tsx`, los services y los e2e specs).
- Unit suites pure (node:test, repo root + resolver): `breed-picker.test.ts` + `local-reads.test.ts` +
  `sigsa-*.test.ts` + `cut-service-core.test.ts` → **228/228 verde** (incluye los 5 `breedCodeForName` + 2
  `buildSetBreedUpdate` nuevos).
- e2e screenshot `sigsa-run3-screenshot.spec.ts` (build estático + Supabase remoto) → **PASS** (prueba el flujo
  UI de la ficha-edit end-to-end: CTA → sheet → raza elegida). 3 PNG en `design/veto-sigsa-run3/`.
- **NO se aplicó la migración 0113** (deploy gateado por el leader — yo NO aplico). NO se tocó connector /
  service SIGSA / rafaq.yaml / otras migraciones. NO se marcó tasks.md. NO se corrió check.mjs completo (flake
  Animal suite + el suite SIGSA §T18 falla hasta el apply).

### Mi veto de diseño (capturas `design/veto-sigsa-run3/`)
PASA. La fila "Raza" se integra limpia en "Datos del animal": empty → CTA "+ Completá la raza para SIGSA"
($primary, consistente con "Asignar a un lote"); con raza → valor + link "Cambiar" discreto a la derecha. El
BreedPickerSheet (reusado de Run 2, ya vetado) abre bien desde la ficha. Descendentes (á) sin recorte.
on-brand. El leader hace el veto final.

---

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré

Pasada hostil sobre mi propio trabajo (NO pasamanos). Foco: spec, edge cases, seguridad, offline, tests-que-
mienten.

1. **¿El guard realmente protege la herencia del ternero?** Re-leí 0108/0109: el INSERT del ternero setea
   `breed_id => v_mother_breed_id` y NO incluye `breed` (queda NULL). Confirmé que mi trigger `BEFORE INSERT`
   ve `breed IS NULL` → skip → breed_id preservado. **Cerré con test T18(c) explícito** (el riesgo #1). OK.

2. **Edge: `breed` = string vacío `''`.** `'' IS NOT NULL` es true → el trigger correría `'' = name` → sin
   match → breed_id NULL. ¿Llega `''` al trigger? NO: el alta usa `cleanStr` (empty→null) y la ficha
   `onSelectBreed` manda `null` para "sin raza". Aun si llegara `''`, el resultado (breed_id NULL) es correcto
   ("sin raza válida"). Sin bug. (No agregué test de `''` porque ningún path lo produce; el comportamiento es
   benigno igual.)

3. **Edge: UPDATE de `breed` a un texto sin match deja breed_id colgado en el valor viejo.** RIESGO REAL que
   casi se me escapa: si el trigger solo derivara "cuando hay match", cambiar de 'Hereford' a un texto raro
   dejaría breed_id=H (mentiroso). Mi trigger asigna SIEMPRE el resultado del SELECT (NULL si no hay match)
   cuando `breed IS NOT NULL` → limpia breed_id correctamente. **Agregué test T18(d-bis)** para fijarlo.

4. **¿Tests que pasan por la razón equivocada?** T18(b) (sin match → NULL) y T18(c) (guard) pasarían incluso
   sin el trigger aplicado (coincidencia). Los DEJÉ porque verifican el contrato correcto, pero lo DOCUMENTÉ
   en el header del §T18 y en la trazabilidad (gating) para que el leader no lea un "verde" engañoso pre-apply.
   T18(a)/(d)/(e) SÍ fallan sin el trigger → son los que prueban genuinamente la derivación.

5. **Anti-spoof / no exponer helper como RPC.** La trigger-fn lleva `revoke execute ... from public,
   authenticated, anon` (no invocable como RPC; el firing del trigger no depende del GRANT). Alinea con 0084.

6. **Multi-tenant.** `setBreed` no hardcodea establishment_id (el profileId identifica el perfil); RLS
   has_role_in es la barrera al subir. El trigger lee `breed_catalog` (global público) → sin fuga cross-tenant.

7. **Offline-first.** El UPDATE de `breed` va por la upload queue (CrudEntry PATCH); funciona offline, la ficha
   muestra el nombre optimista al instante. El trigger corre server-side al subir. NO requiere red para la UX.

8. **¿El cliente manda breed_id por accidente?** Verifiqué: `buildSetBreedUpdate` SOLO escribe `breed` (test
   `doesNotMatch(/breed_id/)`); `onSelectBreed` no toca breed_id; `createAnimal` ya lo excluye (804-810). El
   trigger es la ÚNICA fuente de breed_id going-forward → sin drift cliente/server.

9. **¿Dependencia de useCallback/useEffect mal armada en la ficha?** El `useEffect` de `fetchBreedCatalog` es
   one-shot (`[]`), no depende de `load` → no introduce loop en `useFocusEffect` (evité meter `breedCatalog` en
   las deps de `load`, que sí lo causaría). `onSelectBreed` deps `[detail, breedCatalog, load]` — correcto.
   typecheck verde.

10. **¿La fila Raza se rompe para hembras/machos/archivados?** `BreedRow` es sexo-agnóstica (la raza aplica a
    todos). Archivado (editable=false): muestra valor o "—" sin afordancia. Activo sin raza: CTA. Activo con
    raza: valor + "Cambiar". Cubre los 3 estados; capturado el flujo en las screenshots.

Nada quedó abierto. Todo lo encontrado (punto 3) se cerró con test + re-verificación (typecheck + unit verdes).

---

## Reconciliación de specs (paso 9)

El as-built quedó alineado con las specs:
- `design.md`: agregada §"Migration 0113" (SQL real + edición de ficha) + entrada de changelog AS-BUILT Run 3.
- `requirements.md`: nota de reconciliación bajo R1.4 (la población de breed_id se centraliza en el trigger;
  no se reescribió el EARS — nota, patrón de impl_13). R1.7 sin cambio (el guard la cumple).
- `tasks.md`: NO tocado (instrucción del leader: él flipea T18 a `[x]` al cerrar). T18 sigue `[~]` con la nota
  de Run 3; el as-built lo documenta este archivo + el design.
- NO hay specs que contradigan el código.

## Listo para el leader
Review del SQL de 0113 + (Gate 1 puntual, toca write-path de animal_profiles) + apply al remoto + correr
`supabase/tests/sigsa/run.cjs` §T18 (post-apply) + el e2e con los asserts de breed_id + gates (reviewer + Gate 2).

---

# POST-DEPLOY (2026-06-25) — Verificación con 0107-0113 aplicadas + sync rules deployadas: 2 fixes E2E

> Raf deployó las sync rules en el dashboard (las 3 tablas + columnas nuevas ya bajan al SQLite local). La
> corrida REAL de `sigsa-breed-renspa.spec.ts` (asserts de breed_id que NUNCA habían corrido verdes —
> gateados pre-apply) destapó 2 fallas DETERMINISTAS. Ambas root-causeadas con instrumentación (captura de
> `console`/`pageerror` del connector + dump directo de Postgres + reproducción de la RPC como usuario real).

## Falla 1 — `:50` breed_id del alta = null (poll 30s) — ROOT CAUSE: 23514, no el trigger

**Evidencia (no especulación):**
- Connector log: `[powersync] upload rechazado (descartado) {table: op_intents, op: PUT, code: 23514}`.
- Dump Postgres: `animal_profiles` del establishment = `[]` (vacío) durante 60s → el alta NUNCA aterrizó.
- Reproducción de `create_animal` como usuario real:
  `{code:"23514", message:"animal must have at least one of tag_electronic, idv or visual_id_alt"}`
  = `animal_profiles_identity_check` (0021 / R6.2).

**Por qué:** el test del alta clickeaba "Crear animal" SIN cargar ningún identificador. El overlay local lo
mostraba (la ficha pasaba), pero `create_animal` lo rechazaba al subir → rollback del overlay → nunca llegó a
Postgres → el poll de `breed_id` daba null. **El trigger 0113 estaba PERFECTO** — lo prueban el path de UPDATE
de la ficha (`:130`, server-side breed='Hereford'+breed_id=H VERDE) y el backend §T18 (72/72). No había fila
sobre la cual derivar. NO es regresión de spec 08: es la 1ª verificación real del assert (antes gateado).

**Fix (a) PRODUCTO — cross-spec, surfaced acá (silent data loss):**
- `app/src/utils/animal-form.ts`: helper puro `hasAtLeastOneIdentifier(tag, idv, visual)` (trim defensivo).
- `app/src/utils/animal-form.test.ts`: +2 tests (R6.2 mínima: vacíos/espacios → false; cualquiera presente → true).
- `app/app/crear-animal.tsx` `onSubmit`: valida `hasAtLeastOneIdentifier` ANTES de encolar el intent; sin
  identificador → `setFormError` accionable + return (no encola un alta condenada). El diseño original asumía
  identificador SIEMPRE precargado (R4.2), pero el ALTA EN BLANCO podía llegar al submit con los tres vacíos →
  `create_animal` perdía el animal en SILENCIO. Ahora espeja el constraint del server (0021). Cero regresión:
  30 e2e de alta (`animals` + `maniobra-identify`) verdes (todos prefijan o cargan un id).

**Fix (b) TEST:** `:50` carga un visual antes de "Crear animal" (gesto que TODO otro e2e de alta ya hacía).

## Falla 2 — `:222` el banner RENSPA no desaparece tras guardar — ROOT CAUSE: banner NO-reactivo

**Evidencia:** dump mostró `postgres.renspa="01.001.0.00001"` desde el 1er poll (la RPC `update_renspa`
persiste al instante → el assert server-side PASA) pero `bannerCount=1` durante 24s. El banner NUNCA re-leyó.

**Por qué:** `RenspaBanner` (`/mas`) leía `renspa` del SQLite LOCAL con un `useFocusEffect` de UNA lectura al
enfocar, NO-reactivo. El RENSPA se escribe por RPC (online) y BAJA al SQLite local async por la stream
`est_establishments` → al volver a "Más" el banner leía stale (NULL) y se quedaba para siempre.

**Fix (PRODUCTO):** `app/app/(tabs)/mas.tsx` — `RenspaBanner` ahora se suscribe a `subscribeSyncUiState` y
RE-LEE el renspa local en cada `statusChanged` (patrón `ProfileContext::loadFor` sobre `lastSyncedAt`) → el
banner desaparece cuando el valor recién guardado aterriza por sync-down. Dispose en blur. Sin re-set a
'loading' por tick (no flashea).

## Verificación final
- `cd app && pnpm e2e:build` + `playwright test e2e/sigsa-breed-renspa.spec.ts e2e/sigsa-export.spec.ts` →
  **10 passed / 0 failed** (sigsa-breed-renspa 4/4 incluidos los 2 que fallaban; sigsa-export 6/6 sin regresión).
- Regresión alta: `playwright test animals.spec.ts maniobra-identify.spec.ts` → **30 passed / 0 failed**.
- `pnpm typecheck` (app) VERDE. `animal-form.test.ts` 11/11 (incluye los 2 nuevos).

## Autorrevisión adversarial (paso 8)
1. **¿Causa raíz o síntoma?** Falla 1: el síntoma era "breed_id null"; la causa real era 23514 (alta sin id no
   persiste). Ataqué la causa (validar id antes de encolar) + corregí el test. Falla 2: causa = no-reactividad;
   ataqué la reactividad (no subí timeouts para "pintar verde").
2. **¿Rompe algo?** La validación de id es un gate que SOLO dispara con los 3 vacíos — verifiqué por inspección
   + 30 e2e de alta que todo flujo legítimo prefija/carga un id (un alta sin id es IMPOSIBLE en el server, 0021
   → cero riesgo de bloquear algo válido). El banner reactivo: dispose en blur (sin leak); re-lecturas son reads
   locales baratos; no flashea.
3. **¿Tests que mienten?** `:50` ahora ejercita el path INSERT real (RPC → trigger 0113 → breed_id=AA sobre la
   fila persistida); el poll solo pasa si la fila está EN Postgres con breed_id. `:222` el banner desaparece solo
   si el sync-down del renspa aterriza + el assert server-side confirma Postgres. Verificación genuina.
4. **Multi-tenant/offline:** la validación es client-side input (sin hardcode de establishment_id); MEJORA
   offline-first (no se pierde un alta en silencio). El banner lee `loadEstablishmentDetail(establishmentId)` del
   contexto del campo activo (sin hardcode).

## Reconciliación de specs (paso 9)
- `design.md`: entrada de changelog "VERIFICACIÓN POST-DEPLOY — 2 fixes E2E" (root-cause + fixes de ambas).
- `requirements.md`: nota de reconciliación bajo R13.3 (el banner debe ser reactivo al sync-down; el QUÉ no cambia).
- ⚠️ **Cross-spec (decisión del leader):** `hasAtLeastOneIdentifier` es robustez del ALTA (spec 02, R4.2/R6.2),
  surfaced por el e2e de spec 08. La home canónica de ese requisito es spec 02; lo documenté en el changelog de
  spec 08 + acá, pero NO toqué las specs de spec 02 (las gatea el leader). Recomiendo reconciliar spec 02
  (requirements: "el alta valida ≥1 identificador en cliente, espejando 0021") y/o anotar en backlog si se
  prefiere diferir. El fix de código ya está y es zero-risk.
