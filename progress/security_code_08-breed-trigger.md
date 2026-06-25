# Gate 2 — Security (modo `code`) — chunk Run 3 spec 08: trigger derive-breed_id (0113) + edición de raza en la ficha

**Agente**: security_analyzer
**Modo**: `code`
**Fecha**: 2026-06-25
**Baseline**: `5598644` (registrado en `progress/impl_08-sigsa-breed-trigger.md:1`). Trabajamos sobre `main`; el chunk completo está en working-tree (sin commitear) → `git diff 5598644..HEAD` da vacío; el diff real es `git status --porcelain` + lectura directa de los archivos.
**Skill usada**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability; refs `injection.md`, `business-logic.md`, `authorization.md`).

---

## Veredicto: **PASS**

El AS-BUILT (migración `0113` + ficha-edit) **coincide línea por línea con el diseño que Gate 1 aprobó** (`progress/security_spec_08-breed-trigger.md`). La ficha-edit **no abre superficie nueva**: el cliente manda SOLO `breed` (texto, nombre del catálogo), NUNCA `breed_id`; el UPDATE va parametrizado y está gateado por el RLS `animal_profiles_update` (`has_role_in`) → un no-miembro no puede editar la raza de un animal ajeno. Sin findings HIGH. El único MEDIUM de Gate 1 (no-match → NULL) está **resuelto y documentado** en la migración como fail-safe intencional (decisión del leader, no re-litigada).

---

## 1. AS-BUILT (migración 0113) == diseño Gate-1'd — verificación línea por línea

Leí `supabase/migrations/0113_derive_breed_id_from_breed.sql` verbatim y lo comparé contra cada eje que Gate 1 aprobó. La migración es **idempotente** (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`) → el archivo ES lo que se aplica al remoto, sin transformación. No hizo falta introspección de DB en vivo (no hay `supabase` CLI en PATH; y el archivo determinista es la fuente de verdad del apply).

| Requisito del diseño Gate-1'd | AS-BUILT en 0113 | ¿Coincide? |
|---|---|---|
| **NOT SECURITY DEFINER** (corre como INVOKER) | L52-53: `create or replace function ... returns trigger language plpgsql as $$` — **sin** cláusula `SECURITY DEFINER` → default INVOKER. | ✅ |
| **Guard `NEW.breed IS NOT NULL`** (no pisa el breed_id heredado del ternero) | L57: `if new.breed is not null then` | ✅ |
| **Sin SQL dinámico** (match estático parametrizado) | L58-62: `new.breed_id := ( select bc.id from public.breed_catalog bc where lower(trim(bc.name)) = lower(trim(new.breed)) limit 1 )`. `new.breed` es **variable de fila bindeada**, no concatenación. Sin `EXECUTE`/`format()`/`quote_*`. | ✅ |
| **No-match → `breed_id := NULL`** (MEDIUM de Gate 1, resuelto: mantener NULL, fail-safe documentado) | El escalar se asigna **incondicionalmente dentro del guard** → sin match devuelve NULL. **Documentado** L15-22 como decisión deliberada (consistencia breed↔breed_id + fail-safe SENASA: NULL → "a completar" → excluido del TXT, nunca código equivocado). | ✅ |
| **REVOKE EXECUTE** de public/authenticated/anon (no invocable como RPC) | L76: `revoke execute on function public.tg_derive_breed_id_from_breed () from public, authenticated, anon;` | ✅ |
| **`BEFORE INSERT OR UPDATE OF breed`**, modifica solo `breed_id` (sin recursión) | L79-81: `before insert or update of breed on public.animal_profiles for each row execute function ...`. Setear `NEW.breed_id` en un BEFORE escuchando `OF breed` NO re-dispara (es la misma fila NEW en vuelo; el filtro es `OF breed`, no `OF breed_id`). | ✅ |
| **breed_catalog global → sin cross-tenant** | El catálogo no tiene `establishment_id` (verificado `0107`); el `breed_id` derivado apunta a una fila global compartida → no hay tenant que cruzar. | ✅ |

**Conclusión**: cero divergencia. El as-built es exactamente el diseño que Gate 1 firmó. **Nada cambió vs lo que aprobó Gate 1.**

### Confirmación cruzada con el reference de la skill
- `injection.md` (L55-74): el patrón VULNERABLE es string-concat / interpolación (`"... WHERE name = '" + user_input`). El trigger usa **comparación parametrizada** (variable de fila), que el propio reference lista como SAFE → no es inyectable aunque `new.breed` sea atacante-controlado (texto libre). El peor caso de un `breed` malicioso es "no matchea → breed_id NULL".
- `business-logic.md`: el único riesgo de lógica es el no-match→NULL, que Gate 1 ya clasificó MEDIUM y el leader resolvió como comportamiento intencional fail-safe. No hay TOCTOU ni workflow-bypass (un solo statement atómico server-side).

---

## 2. Ficha-edit — ¿abre superficie nueva? **NO**

Tracé el data flow completo cliente→server de la edición de raza.

### 2a. El cliente manda SOLO `breed`, NUNCA `breed_id` — verificado en los 3 archivos
- `app/app/animal/[id].tsx:636-657` (`onSelectBreed`): el callback recibe `(_breedId, senasaCode)` y **descarta `_breedId`** (underscore-prefijado, nunca usado). Computa `newBreed` = el NOMBRE del catálogo (`selectedBreedLabel(...).name`) o `null` para "Sin raza", y llama `setBreed(detail.profileId, newBreed)`. **`breed_id` no se toca en ningún punto.**
- `app/src/services/animals.ts:1459-1466` (`setBreed`): orquestador delgado → `runLocalWrite(buildSetBreedUpdate(profileId, breed))`. No agrega `breed_id`.
- `app/src/services/powersync/local-reads.ts:1661-1666` (`buildSetBreedUpdate`): `UPDATE animal_profiles SET breed = ? WHERE id = ? AND deleted_at IS NULL`, `args: [breed, profileId]`. **SET de UNA sola columna (`breed`); `breed_id` NO está en el statement.** → la CrudEntry PATCH que drena PowerSync solo porta `breed`. El `breed_id` lo deriva el trigger server-side al subir (anti-drift, fuente única).

→ **A2 (mass-assignment de breed_id desde el cliente): NO explotable.** Aun si un atacante pegara `breed_id` arbitrario en un PATCH directo a PostgREST, cualquier UPDATE que toque `breed` lo RE-DERIVA server-side (el trigger pisa `NEW.breed_id`). El único hueco residual (UPDATE de OTRA columna sin tocar `breed`, que NO dispara el trigger `OF breed` y dejaría pasar un `breed_id` del payload) **es el estado pre-existente de 0108, NO lo introduce este chunk** — y está cubierto por la RLS `WITH CHECK (has_role_in)` + el hecho de que `breed_id` FK a un catálogo global (no hay objeto ajeno que referenciar, A3 N/A).

### 2b. UPDATE parametrizado — sí
`buildSetBreedUpdate` usa placeholders posicionales (`?`) con `args: [breed, profileId]`. `injection.md` lista exactamente este patrón como SAFE (parametrizado). Sin string-building. ✅

### 2c. Gateado por RLS `animal_profiles_update` — verificado, NO se inventó policy
`0022_rls_animals_and_profiles.sql:13-15`:
```sql
create policy animal_profiles_update on public.animal_profiles
  for update using (has_role_in(establishment_id))
  with check (has_role_in(establishment_id));
```
→ **Un no-miembro NO puede editar la raza de un animal ajeno.** El UPDATE de `breed` drena por PostgREST PATCH al sincronizar y choca contra esta policy (mismo path que la CUT-ficha, que ya actualiza `animal_profiles`). El `WHERE id = ? AND deleted_at IS NULL` del builder + el `USING/WITH CHECK` de la RLS = doble barrera. No hay IDOR: el `profileId` lo provee el contexto de la ficha de un animal que el usuario YA tiene sincronizado (= ya pasó el scoping de la stream), y la RLS server-side es la barrera final al subir.

### 2d. Stale-auth en replay offline (C4) — cubierto
El UPDATE encolado offline se re-autoriza server-side al drenar (la RLS `has_role_in` evalúa el rol VIGENTE al momento del PATCH, no el que tenía el cliente al editar). Si el rol se revocó entre la edición offline y el sync, el PATCH falla cerrado. ✅ — comportamiento estándar del path PowerSync→PostgREST, no debilitado por este chunk.

---

## 3. ¿El UPDATE de breed puede setear un breed_id cross-tenant? **NO**

`breed_catalog` es **global, sin `establishment_id`** (`0107`: RLS on + `GRANT SELECT TO authenticated` + policy `USING(true)`). El trigger deriva `breed_id` del catálogo global, **no de datos de otro tenant**. El universo de `breed_id` es común a todos los campos por diseño → no existe forma de que la derivación asigne un `breed_id` "ajeno". El catálogo es read-only para el cliente (sin policies INSERT/UPDATE/DELETE; solo `service_role`) → tampoco hay forma de envenenarlo para que el trigger derive un id manipulado. ✅

---

## Findings HIGH de Sentry

**Ninguno.** La skill (con `injection.md` / `business-logic.md`) no produce findings HIGH sobre este chunk: el match del trigger es comparación parametrizada (no string-building), el UPDATE del cliente es parametrizado, no hay SQL dinámico, no hay DEFINER (sin search-path hijack), no hay recursión, y el cliente no puede mass-assignar `breed_id`. **No high-confidence vulnerabilities identified.**

## Findings RAFAQ-SPECIFIC

**Ninguno.** Verificado contra el checklist RAFAQ:
- **RLS testeada cross-tenant**: la policy `animal_profiles_update` (`has_role_in`) es pre-existente (0022) y ya gateada; este chunk la REUSA (no la modifica). El nuevo trigger no toca el scoping de `animal_profiles`. La suite `run.cjs §T18` (a/b/c/d/d-bis/e, gated al apply de 0113) cubre el guard de herencia + derivación + no-match + case/trim. **NO se inventó policy** (verificado contra 0022).
- **Trigger nuevo bypasseable / DEFINER mal usado**: el trigger es INVOKER **a propósito** (el writer ya puede leer `breed_catalog` sin elevar) — la decisión correcta de mínimo privilegio. `revoke execute ... from public, authenticated, anon` (defensa: no invocable como RPC; el firing del trigger no depende del GRANT — alinea con el patrón 0084). Si se lo hubiera promovido a DEFINER sin `SET search_path`, sería search-path hijacking — **no es el caso** (verificado: sin cláusula DEFINER en L52-53).
- **Secrets / console.log**: el chunk no maneja secretos; sin `console.log` de datos sensibles. N/A.
- **Inmutabilidad**: `breed` es **intencionalmente mutable** (verificado `0036_immutability_identifiers.sql`: inmutabiliza `idv` y `tag_electronic` vía `BEFORE UPDATE OF idv`/`OF tag_electronic`, **no** `breed`). La ficha-edit es un caso de uso legítimo, no un bypass de inmutabilidad.

## False positives descartados (trazabilidad)

- **"new.breed concatenado en el SELECT del trigger = SQLi"** → DESCARTADO: `new.breed` es una **variable de fila bindeada** dentro de un `SELECT` plpgsql normal, no concatenación de string ni `EXECUTE`. `injection.md` lista la comparación parametrizada como SAFE. El peor caso de un `breed` hostil es no-match → `breed_id` NULL.
- **"el cliente puede mandar breed_id arbitrario (mass assignment)"** → DESCARTADO para este chunk: `buildSetBreedUpdate` hace `SET breed = ?` (una sola columna); `onSelectBreed` descarta `_breedId`. Y todo UPDATE que toque `breed` re-deriva `breed_id` server-side. El hueco residual (UPDATE de otra columna con `breed_id` en el payload) es estado pre-existente de 0108, no de este delta, y está bajo la RLS `WITH CHECK`.
- **"derivación a NULL borra un breed_id correcto = vuln de integridad"** → es el **MEDIUM-1 de Gate 1**, no un HIGH nuevo: dirección fail-safe para el TXT SENASA (excluye, no exporta mal), **resuelto por el leader** (mantener NULL = consistencia breed↔breed_id + documentado L15-22 de la migración). No bloquea Gate 2.

---

## Tabla de inputs (campos nuevos/modificados que el usuario tipea)

| Campo | Límite | Validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `animal_profiles.breed` (vía BreedPickerSheet en la ficha → setea el NOMBRE EXACTO del catálogo; o PATCH directo / import con texto arbitrario) | Server: `CHECK (char_length(breed) <= 64)` **VALIDADA** (`0070:192-193`, no solo NOT VALID) → cap de largo autoritativo, no bypasseable. Charset: libre (texto). | **Server** (autoritativa): (1) el cap de largo de 0070; (2) el trigger 0113 deriva `breed_id` server-side — el cliente nunca confía/manda `breed_id`. El BreedPicker (lista cerrada, cliente) es UX, **no** el control. | ✅ — el largo está acotado server-side; el trigger neutraliza texto no-catalogado a `breed_id` NULL (fail-safe). No hay buscador que pegue a DB con el término (el filtro del picker es en-memoria sobre la lista ya sincronizada — sin enumeración ni inyección). |

> No hay prompts LLM ni buscadores que peguen a DB en este chunk. El search-box del `BreedPickerSheet` filtra **en memoria** la lista ya cargada (`filterBreedOptions` sobre el array local) → no hay enumeración ni `ilike`/`.or()` con texto del usuario.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| (ninguna nueva) | n.a. | n.a. | n.a. | El chunk es un trigger DB + un UPDATE puntual de `breed` dentro del write-path de `animal_profiles` ya existente. No agrega Edge Function, endpoint, email/SMS, API externa ni operación bulk. El UPDATE drena por el connector de outbox (mismo path que CUT-ficha / asignar-lote), cubierto por el rate-limit de Auth + el connector. Sin acción nueva que rate-limitear. |

---

## Archivos analizados

- `supabase/migrations/0113_derive_breed_id_from_breed.sql` (trigger AS-BUILT — leído verbatim, comparado L-por-L con Gate 1).
- `app/src/services/powersync/local-reads.ts` (`buildSetBreedUpdate`, L1661-1666).
- `app/src/services/animals.ts` (`setBreed`, L1459-1466; nota de `createAnimal` que excluye `breed_id`, L802-810).
- `app/app/animal/[id].tsx` (`onSelectBreed` L636-657, carga del catálogo L254-261, `BreedRow`/`BreedPickerSheet` wiring L759-855).
- `app/src/utils/breed-picker.ts` (`breedCodeForName`/`selectedBreedLabel`/`breedPickerOptions` — puros, sin I/O ni red).
- **Verificación de invariantes** (read-only): `0022:13-15` (RLS update `has_role_in`), `0107:34-42` (breed_catalog global, SELECT-open), `0036` (inmutabilidad idv/tag, NO breed), `0070:192-193` (breed cap 64 validado), `grep breed_id` en migraciones (solo 0108/0109/0113 lo escriben; solo 0113 vía trigger).

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: N/A — este chunk no toca ninguna Edge Function. La skill de Sentry no aplica a Deno aquí porque no hay Deno en el diff.
- **RLS**: la skill de Sentry NO razona sobre policies de Postgres RLS — lo cubrí **manualmente** (§2c): `animal_profiles_update` (`has_role_in`) es la barrera del UPDATE, reusada de 0022, no inventada. La derivación del trigger no toca el scoping.
- **PowerSync / sync rules**: el UPDATE de `breed` genera UNA CrudEntry PATCH (`buildSetBreedUpdate` → `runLocalWrite`); no agrega sync stream nueva. La re-autorización server-side al drenar (C4) la da la RLS. El `breed_id` queda STALE en el SQLite local hasta el re-sync (benigno: la ficha muestra `breed`, el export lee el set sincronizado — documentado en el JSDoc del builder). Sin fuga cross-tenant por sync (catálogo global; `animal_profiles` ya scopeado por la stream).

---

## Resumen para el leader

- **PASS.** El AS-BUILT (migración 0113) **es idéntico al diseño que Gate 1 aprobó** — verificado línea por línea (INVOKER, guard `breed IS NOT NULL`, match parametrizado sin SQL dinámico, no-match→NULL documentado como fail-safe, REVOKE EXECUTE, sin recursión). **Nada divergió.**
- La **ficha-edit no abre superficie nueva**: el cliente manda SOLO `breed` (texto), NUNCA `breed_id` (lo deriva el trigger); el UPDATE es parametrizado (`SET breed = ?`) y está gateado por el RLS `animal_profiles_update` (`has_role_in`) → un no-miembro no puede editar raza ajena. Sin cross-tenant (catálogo global). El cap de largo `breed ≤ 64` es server-side y validado.
- **Sin findings HIGH ni RAFAQ-SPECIFIC.** El único MEDIUM (no-match→NULL) es de Gate 1 y está resuelto/documentado por el leader. Sin `REQUIERE_DECISION_ARQUITECTONICA`.
- **Nota operativa (no es finding)**: los tests `run.cjs §T18` (a/d/d-bis/e) y los server-side asserts de breed_id del e2e pasan verde **recién post-apply de 0113** (corren contra la DB remota). Confirmar el apply + suite §T18 72/72 antes de cerrar, como indica el impl.
