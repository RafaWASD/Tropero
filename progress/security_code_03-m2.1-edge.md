# security_code — spec 03 M2.1-edge (Gate 2, modo `code`, ADR-019)

**Veredicto: PASS**

Chunk: edge cases del identify en MODO MANIOBRAS — R4.2 (desambiguación manual multi-candidato),
R4.4 (pasar el animal a otro rodeo), R4.7 (cambiar rodeo de jornada). Frontend puro sobre backend done
(triggers `0047`/`0021`/`0050` + RLS de spec 02/03, ya lockeados). Sin DDL nueva → Gate 1 puntual N/A.

baseline_commit: `f518ea56b8dec3db34ec5e8427a6f1b95b0a858b` (de `progress/impl_03-m2.1-edge.md`).

Skill `sentry-skills:security-review` corrida sobre el diff in-scope (no sobre el baseline completo de
spec 03). **0 findings HIGH.** Validación manual + verificación server-side confirman que el cliente NO
es la única barrera en ninguno de los 3 flujos.

---

## Findings HIGH (Sentry + RAFAQ-SPECIFIC)

**Ninguno.** No se identificaron vulnerabilidades de alta confianza.

---

## FOCO 1 — R4.4 mover animal (`moveAnimalToRodeo` / `buildMoveAnimalToRodeoUpdate`) — IDOR / cross-tenant

**Cadena de autoridad server-side verificada (el cliente NO es la única barrera):**

`buildMoveAnimalToRodeoUpdate` (`local-reads.ts:1620-1625`) emite literalmente:
```sql
UPDATE animal_profiles SET rodeo_id = ? WHERE id = ? AND deleted_at IS NULL
```
SQL FIJO con `?`/`args` (no spread de body del cliente → sin mass-assignment; `establishment_id` NO está
en el SET → no se puede flipear). `moveAnimalToRodeo` (`animals.ts:1304-1311`) solo encola el UPDATE local
(CRUD-plano → CrudEntry → `uploadData`). Tres defensas server-side re-validan al subir:

1. **RLS `animal_profiles_update`** (`0022_rls_animals_and_profiles.sql:13-15`):
   `USING (has_role_in(establishment_id)) WITH CHECK (has_role_in(establishment_id))`. Un `profileId`
   manipulado de un animal AJENO → el caller no tiene rol en ese establishment → la fila es
   invisible/un-updatable. **No IDOR sobre el animal.**
2. **`tg_animal_profiles_rodeo_check`** (`0021_animal_profiles_validations.sql:25-43`): el `rodeo_id`
   destino debe cumplir `r.establishment_id = new.establishment_id` (el del PROPIO perfil) + `active` +
   `deleted_at IS NULL`. Como el UPDATE no cambia `establishment_id`, `new.establishment_id` = el del
   perfil → un `rodeo_id` spoofeado a un rodeo de OTRO establecimiento es rechazado (23514).
   **No escape cross-tenant en el destino.**
3. **`tg_animal_profiles_rodeo_same_system_check`** (`0047_rodeo_change_same_system.sql:11-31`): rechaza
   el cruce de sistemas productivos (23514, R4.5.1).

El `rodeoId` destino que pasa la UI es `sessionRodeoId` (`identificar.tsx:331-332`), derivado de
`session.rodeoId` (sesión propia leída local) — no de un `rodeo.available` arbitrario; aun así, si fuera
spoofeable, el server lo rechaza. **No spoofeable a un rodeo ajeno. PASS.**

## FOCO 2 — R4.7 `setSessionRodeo` / `buildSetSessionRodeoUpdate` — IDOR sobre sessions

`buildSetSessionRodeoUpdate` (`local-reads.ts:1734-1739`):
```sql
UPDATE sessions SET rodeo_id = ? WHERE id = ? AND status = 'active' AND deleted_at IS NULL
```
SQL fijo, parametrizado, sin spread. Server-side:
- **RLS `sessions_update`** (`0050_sessions.sql:72-74`): `USING/WITH CHECK has_role_in(establishment_id)`
  → solo la sesión PROPIA (de un establishment donde el caller tiene rol). No IDOR sobre sessions ajenas.
- **`tg_sessions_rodeo_check`** (`0050_sessions.sql:47-64`, `SECURITY DEFINER`, before insert OR update):
  el `rodeo_id` debe pertenecer al `establishment_id` de la sesión + estar activo/vivo → no se re-apunta
  a un rodeo de otro establecimiento (23514). El `EXECUTE` está revocado de `public/authenticated/anon`
  (`0050:60`) → solo corre como trigger interno.

El `toRodeoId` de la UI viene de `streak.streakRodeoId` (`identificar.tsx:349`), que se alimenta solo de
animales del campo activo vía `rodeo.available` (RodeoContext). **Solo cambia la sesión propia a un rodeo
del mismo establecimiento. PASS.**

## FOCO 3 — R4.2 picker (búsqueda manual → desambiguación)

- `maniobra-edge.ts` es 100% PURO (sin I/O, sin red, sin SDK): `candidateDominantId` /
  `candidateDistinguisher` / tracker R4.7 son reducers de presentación. Cero superficie de ataque.
- La búsqueda manual reusa `searchAnimals` (`animals.ts:417`), todo READ LOCAL scopeado por
  `establishmentId` (del contexto activo, nunca hardcodeado) + `deleted_at` + `status='active'`. El
  término del usuario pasa **parametrizado** a `db.getAll(sql, args)` (`local-query.ts:51`); los builders
  de búsqueda escapan los comodines LIKE (`buildSearchLikeQuery`) → sin SQL/PostgREST-filter injection.
- El término está **acotado server-side-en-el-builder**: `classifySearchQuery` hace
  `query.slice(0, SEARCH_TERM_MAX_LENGTH=64)` (`animal-identifier.ts:120`) ANTES de cualquier LIKE — no
  es solo el `maxLength` del TextInput (UX). El picker no introduce input libre nuevo.
- El "dar de alta" desde el picker (`onCreateFromPicker`, `identificar.tsx:317-321`) enruta a
  `/crear-animal` (alta REAL de spec 02/09); `createAnimal` (`animals.ts:718`) FUERZA `created_by` y la
  identidad denormalizada server-side (trigger) y respeta los UNIQUE de spec 02. No se replica validación
  en el cliente. **PASS.**

## FOCO 4 — Inputs de usuario

Único input de texto libre tocado: el término de búsqueda manual que alimenta el picker R4.2 — **ya
acotado (64 chars) + parametrizado**, auditado en M2.1-core y sin cambios aquí. Los 3 componentes nuevos
(`CandidatePicker`, `OtherRodeoSheet`, `RodeoMismatchBanner`) NO tienen campos de entrada: solo muestran
datos y disparan callbacks. Sin input libre nuevo sin cota.

## FOCO 5 — Multi-tenant

Ninguno de los 3 flujos permite operar cross-tenant (ver FOCO 1/2). Los rodeos ofrecidos en el cambio de
jornada (R4.7) y el destino del move (R4.4) salen de `rodeo.available` (RodeoContext = solo el campo
activo) y, aun si se forzara un id ajeno, el server lo rechaza (triggers `0021`/`0047`/`0050` + RLS).

## FOCO 6 — Secrets

Cero hardcode. Lint anti-hardcode (ADR-023 §4): **0 violaciones** (check.mjs). `establishmentId`/`rodeoId`
siempre por contexto/param. Sin secretos, sin `console.log` de datos sensibles en el código tocado.

---

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| término búsqueda manual (alimenta picker R4.2) | 64 chars (`SEARCH_TERM_MAX_LENGTH`), recorte en builder + `maxLength` UX | server-en-builder (`slice(0,64)`) + SQL parametrizado + escape LIKE; lookup scopeado por establishment | ✅ (sin cambios vs M2.1-core) |
| (componentes nuevos R4.2/R4.4/R4.7) | n.a. — no tienen campos de entrada (solo display + callbacks) | n.a. | ✅ |

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `moveAnimalToRodeo` (UPDATE rodeo_id) | n.a. | n.a. | sí (RLS + triggers rechazan al subir) | mutación CRUD-plano local→sync, no manda email/SMS ni pega a API externa; no es bulk (1 UPDATE por animal, gateado por el ritmo de manga). No es vector de abuso a escala. |
| `setSessionRodeo` (UPDATE sessions.rodeo_id) | n.a. | n.a. | sí | idem: 1 UPDATE de la sesión propia; sin costo externo. |
| búsqueda manual (picker R4.2) | n.a. | n.a. | sí (read local scopeado) | READ local SQLite (offline), no toca la red ni endpoint costoso; término acotado a 64 + sin paginación ilimitada (lista local). No enumera cross-tenant (RLS sync). |

Justificación "n.a.": son escrituras CRUD-plano offline-first y lecturas locales — no hay endpoint
custom que mande email/SMS, pegue a API externa, ni fan-out masivo. El abuso a escala no aplica; la
defensa real es RLS + triggers al sincronizar, que fallan cerrado.

---

## False positives descartados

La skill no produjo findings que requirieran descarte. Riesgos teóricos considerados y por qué NO aplican:

- **Mass assignment via CrudEntry (PATCH path)**: el `uploadData` CRUD-plano hace
  `table.update(op.opData).eq('id', op.id)` (`connector.ts:83`), donde `op.opData` = columnas cambiadas
  en SQLite. Un device rooteado podría inyectar columnas extra (ej. `establishment_id`). **No es finding
  de este chunk**: (a) es el threat-model genérico de PowerSync, ya aceptado por toda escritura
  CRUD-plano del app (no lo introduce M2.1-edge); (b) el server re-valida — `animal_profiles_update`
  WITH CHECK `has_role_in(establishment_id)` rechazaría flipear el tenant, y `tg_animal_profiles_rodeo_check`
  re-valida rodeo↔establishment. La superficie no crece con este chunk.
- **IDOR por `profileId`/`rodeoId` manipulado**: descartado — ver FOCO 1/2 (RLS + triggers anclan a la
  fila/establishment reales, no a la claim del cliente).

---

## Archivos analizados

- `app/src/utils/maniobra-edge.ts` (puro)
- `app/src/services/animals.ts` (`moveAnimalToRodeo`, líneas 1304-1311)
- `app/src/services/sessions.ts` (`setSessionRodeo`, líneas 191-198)
- `app/src/services/powersync/local-reads.ts` (`buildMoveAnimalToRodeoUpdate` 1620, `buildSetSessionRodeoUpdate` 1734)
- `app/app/maniobra/identificar.tsx` (cableado R4.2/R4.4/R4.7)
- `app/app/maniobra/_components/{CandidatePicker,OtherRodeoSheet,RodeoMismatchBanner}.tsx`
- `app/src/services/powersync/local-query.ts` y `connector.ts` (verificación del path de upload — parametrización + PATCH)

Migrations leídas para confirmar la autoridad server-side (no modificadas por este chunk):
`0021`, `0022`, `0047`, `0050`.

---

## Cobertura indirecta de Deno / RLS / PowerSync

- **RLS / triggers de DB**: la skill Sentry NO razona sobre policies Postgres ni triggers `SECURITY
  DEFINER`. La verificación de que el cliente no es la única barrera se hizo por **revisión manual** de
  las migrations `0021`/`0022`/`0047`/`0050` (cubierto arriba). Estos triggers + RLS NO se tocaron en
  M2.1-edge (chunk frontend puro) → no requieren re-test de Gate 1, pero su existencia es el load-bearing
  de la seguridad de R4.4/R4.7.
- **PowerSync sync rules**: no wired aún (ADR-002 diferido). El aislamiento cross-tenant del READ local
  hoy descansa en el scoping por `establishment_id` de los builders + RLS al sincronizar; cuando se
  enchufen las sync rules, revisar que scopeen por establishment (riesgo C1 del catálogo) — fuera del
  alcance de este chunk.
- **Deno / Edge Functions**: este chunk no toca Edge Functions.

---

## check.mjs

**RC=0 reportado por el wrapper**, pero la corrida muestra **un rojo AJENO** en la suite Edge auth
(`R10.2 change_member_role ... Request rate limit reached` — `supabase/tests/edge/run.cjs:1146`): es el
flake de auth de Supabase por terminales paralelas (memoria `reference_check_red_rate_limit.md`), **NO un
finding ni una regresión** de M2.1-edge (el chunk no toca Edge Functions ni member-roles). Gates de
frontend relevantes: **typecheck client OK**, **anti-hardcode 0 violaciones**, **client unit** corre con
`maniobra-edge.test.ts` + `maneuver-reads.test.ts` incluidos. (El `import_rodeo_bulk`/spec-12 no apareció
rojo en esta corrida.)
