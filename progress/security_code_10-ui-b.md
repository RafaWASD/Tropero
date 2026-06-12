# Security Gate 2 (modo code) — spec 10 chunk UI-B: selección masiva + bottom-sheet + wiring de mutaciones

- **Fecha**: 2026-06-12
- **Baseline**: `10a9f4e` (diff = working tree sin commitear, confirmado vía `git status --porcelain`)
- **Alcance**: wiring UI → services gateados en Fase 3. La lógica de mutación (`bulk-operations.ts` /
  `bulk-operations-plan.ts` / `animals.ts`) NO se re-gateó — se verificó que el wiring no afloje sus invariantes.
- **Metodología**: skill `sentry-skills:security-review` (trace data flow + verify exploitability) + checklist RAFAQ.

## Veredicto: **PASS**

Cero findings HIGH-confidence. 1 MEDIUM + 2 LOW → backlog (abajo).

---

## Confirmación explícita de las 2 invariantes pedidas

### Foco 1 — `author_id` NUNCA en el payload de la observación ✅ CONFIRMADO

Path completo trazado: `BulkConfirmSheet.onConfirm` → `seleccion-masiva.tsx:213` `applyBulkCastration(selectedCandidates)`
→ `bulk-operations.ts:162-167` `planCastration(...)` con builder inyectado → `buildAddObservationInsert`.

SQL literal as-built (`app/src/services/powersync/local-reads.ts:1146-1149`):

```sql
INSERT INTO animal_events (id, animal_profile_id, establishment_id, event_type, text)
VALUES (?, ?, ?, 'observacion', ?)
```

- `author_id` NO figura en la lista de columnas ni en los args (`[id, profileId, establishmentId, text]`). Lo fuerza
  el trigger 0034 al subir (= usuario actual del JWT).
- Pineado por test: `local-reads.test.ts:977` `assert.doesNotMatch(q.sql, /author_id/)` (+ `edit_window_until`).
- El chunk UI-B **no tocó** este builder ni `bulk-operations.ts` (confirmado por `git diff --name-only`: ninguno
  de los dos está en el diff). El wiring pasa `GroupSelectionProfile[]` pero el planner solo consume `profileId`
  (el `establishment_id` de la observación se deriva del PERFIL vía `buildProfileEstablishmentsQuery` batched,
  `bulk-operations.ts:154-160` — nunca del objeto que armó la UI; y el trigger 0034 lo re-valida igual, 23514 si
  no coincide).

### Foco 2 — Autorización server-side, NO el gating de display ✅ CONFIRMADO

- **No hay canal nuevo de escritura.** Las 3 escrituras que la UI dispara son exactamente los paths gateados:
  1. Castración: `applyBulkCastration` (Fase 3) → `buildSetCastratedUpdate` (UPDATE columnas FIJAS
     `is_castrated`/`future_bull`, `WHERE id = ? AND deleted_at IS NULL`) + observación (arriba).
  2. Destete: `applyBulkWeaning` (Fase 3) → `buildAddWeaningInsert` (UUIDv5 + barrera idempotente
     `buildExistingWeaningIdsQuery`).
  3. Override-revert (foco 4): `seleccion-masiva.tsx:242` llama `revertCategoryOverride` as-built de C6
     (`animals.ts:1017-1031`) — UN solo UPDATE vía `buildRevertCategoryOverrideUpdate`, la pantalla NO arma SQL
     propio ni abre un write nuevo.
- Todas van por `runLocalWrite` → CrudEntry → `uploadData` (spec 15) → Postgres con el JWT del usuario → cada
  mutación la re-valida la RLS as-built (`animals_update` 0071 sobre `animal_profiles`, policies de
  `reproductive_events`, trigger 0034 sobre `animal_events`). N mutaciones = N validaciones independientes.
  **Cero `createAdminClient`, cero REST directo, cero spread del input del cliente en un insert/update**
  (los builders arman columnas fijas, whitelist implícita).
- **Mass assignment**: la UI pasa objetos `GroupSelectionProfile` enteros, pero los builders solo extraen
  `profileId` (+ params constantes). Ningún campo del objeto UI llega al SQL.

### Foco 3 — `buildGroupCandidateFlagsQuery` (deep-link a grupo ajeno) ✅

`local-reads.ts:1311-1327`: 100% parametrizada (`IN (${placeholders})` con `?` generados + args spread — los
profileIds nunca se interpolan). No está scopeada por establishment per se, pero:
1. Sus inputs son los `profileId` de `fetchAnimals(establishmentId, {rodeoId, status:'active'})` /
   `fetchGroupMembers(establishmentId, groupId)` — ambos filtran `ap.establishment_id = ?` con el id del
   **contexto activo** (nunca de la URL).
2. Un deep-link `/seleccion-masiva?groupId=<ajeno>` → el filtro establishment+rodeo da 0 filas → lista vacía →
   la flags-query ni corre (`items.length === 0` early-return en `bulk-selection-data.ts:64`).
3. La SQLite local solo contiene datos del propio usuario (streams self-only) — no HAY filas ajenas que leer.
4. Aun con cliente tampered que inyecte profileIds ajenos: la lectura local da vacío y la escritura la rechaza
   la RLS al subir. La barrera es server-side.

### Foco 4 — Override-revert ✅ (cubierto en foco 2: reusa C6, no abre escritura nueva)

El sheet solo lo ofrece si `summary.overrideCount > 0` y opera sobre `selectedCandidates` con
`categoryOverride === true` (`seleccion-masiva.tsx:238`). Nota no-security: el loop ignora el `ServiceResult`
de cada revert (LOW-2, backlog).

### Foco 5 — Fan-out ✅ (LOW, backlog)

`DEFAULT_BATCH_SIZE` ~100 (R10.5) es batching del **encolado local** con yield a UI (`InteractionManager`),
no un cap del N total. El N está acotado por el tamaño del grupo (datos propios, misma SQLite), cada mutación
es una CrudEntry independiente re-validada por RLS, y el efecto es idéntico a hacer las N operaciones de a una
(que el usuario ya puede). Sin amplificación cross-tenant ni server-side no autenticada → **LOW** (self-DoS
del propio tenant en el peor caso), no bloquea. → LOW-1.

### Foco 6 — Inputs ✅

Un solo texto libre nuevo: el buscador de la selección. Es filtro **100% client-side in-memory**
(`filterBySearch`, `selection-display.ts:62-72`): `includes()` sobre strings ya fetcheados. NO toca SQL, NO va
al server, NO se concatena en `.or()/.filter()/ilike` ni en prompts. El resto son booleanos (checkboxes) +
profileIds de la lista ya autorizada + copy constante.

---

## Findings HIGH

**Ninguno.**

## MEDIUM → backlog

- **MED-1 · Comentario de seguridad engañoso: el gating de destete NO tiene barrera server-side.**
  `app/app/seleccion-masiva.tsx:143` ("La barrera DEFINITIVA es server-side igual") y `:148` ("la RLS/gating
  capa 1 server-side decide al subir") afirman que el fail-open de display del gating R7.2 lo respalda el
  server. Es cierto para la **autorización** (RLS), pero **falso para el gating de destete**:
  `supabase/migrations/0054_gating_db_layer.sql:21` es explícito — "parto/aborto/**destete**/servicio-no-IA NO
  se gatean — US-8 nota de alcance" (`tg_reproductive_events_gating` solo cubre tacto/tacto_vaquillona/IA).
  Si el gating local no resuelve (offline parcial), un destete masivo puede aterrizar en un rodeo con `destete`
  deshabilitado y el server lo ACEPTA. **Por qué no es HIGH**: mismo tenant, usuario autorizado, integridad de
  regla de negocio excluida del enforcement por decisión de spec (US-8), y el mismo evento se puede crear de a
  uno desde la ficha. El riesgo real es que un dev futuro lea ese comentario y confíe en una barrera que no
  existe. **Fix**: corregir el comentario ("la AUTORIZACIÓN es server-side; el gating de destete es
  display-only por US-8") o, si Raf quiere enforcement, extender `tg_reproductive_events_gating` (decisión de
  spec, no de este chunk).

## LOW → backlog (anexo)

- **LOW-1 · Sin cap duro al N total del fan-out** (foco 5, arriba). Mitigado por batching+yield y por estar
  acotado al grupo propio. Si algún día la masiva cruza a un endpoint server-side (Edge Function), ahí SÍ va
  cap + cuota.
- **LOW-2 · `onRevertOverrides` ignora errores por animal** (`seleccion-masiva.tsx:241-243`): un revert
  fallido pasa en silencio (el reload refleja el estado real, y la RLS sigue siendo la barrera). Funcional,
  no security.
- **LOW-3 · `IN (...)` con un placeholder por profileId**: con grupos de miles se acerca al límite de variables
  de SQLite (32766 en builds modernos). Robustez, no seguridad.

## False positives descartados (trazabilidad skill)

| Patrón detectado | Por qué NO es finding |
|---|---|
| `` `IN (${placeholders})` `` en `buildGroupCandidateFlagsQuery` / `buildProfileEstablishmentsQuery` | Lo interpolado son `?` generados; los valores van por args parametrizados. |
| Texto libre del buscador | Nunca sale del proceso: filtro in-memory, sin SQL/server/DOM. |
| `rejections` renderiza `r.message` (mensaje de error crudo) | Error de write LOCAL (SQLite del propio device) mostrado al mismo usuario en `<Text>` RN (sin DOM/XSS). No es `err.message` de server cruzando un boundary. |
| `key={r.label}` duplicable / progreso | Bug cosmético React, no security. |
| Fail-open del predicado R7.2 | Es fail-open de DISPLAY de un gating display-only; la autorización (RLS) no depende de él. El problema real es el comentario (MED-1). |

## Tabla de inputs (campos nuevos/modificados que el usuario tipea)

| Campo | Límite (largo/charset/formato) | Validación | OK? |
|---|---|---|---|
| Buscador de selección (`SelectionSearchBar`) | Sin `maxLength` explícito | n.a. como control de seguridad: filtro client-side in-memory puro, jamás llega a SQL/server/prompt | ✅ |
| Checkboxes / todos-ninguno / CONFIRMAR | Booleanos + profileIds de la lista ya scopeada | RLS server-side re-valida cada mutación resultante | ✅ |
| Params de ruta (`op`/`groupType`/`groupId`) | `op` y `groupType` parseados a enum cerrado (default defensivo); `groupId` solo se usa como filtro parametrizado bajo el establishment activo | Server-side: RLS + streams self-only (deep-link ajeno → vacío) | ✅ |

No hay campos que persistan texto del usuario en este chunk (el copy de la observación es constante).

## Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Encolado masivo local (castrar/destetar N) | n.a. server-side (no hay endpoint: CrudEntries locales → sync estándar) | per-user implícito (su propia queue/JWT) | RLS valida cada mutación al subir | Sin email/SMS/API externa/Edge Function en el path. Cap de N = LOW-1 backlog. |
| Revert override (loop) | n.a. (mismo canal CrudEntry) | idem | idem | Reusa C6. |

## Archivos analizados

- `app/app/seleccion-masiva.tsx` (nuevo, reemplaza stub)
- `app/src/components/BulkConfirmSheet.tsx`, `BulkProgressPanel.tsx` (nuevos, presentacionales puros)
- `app/src/components/AnimalRow.tsx` (prop `highlight` display-only), `GroupViewScreen.tsx` (remoción de card
  display-only; gating sigue en `group-data.ts`), `index.ts` (exports)
- `app/src/services/bulk-selection-data.ts` (nuevo), `app/src/services/powersync/local-reads.ts`
  (`buildGroupCandidateFlagsQuery`) + `.test.ts`
- `app/src/utils/selection-display.ts` (+ test, puro), `app/tamagui.config.ts` (token `$scrim`, sin secretos),
  `scripts/run-tests.mjs` (registro de test)
- Leídos para validar el wiring (NO re-gateados): `bulk-operations.ts`, `animals.ts` (`revertCategoryOverride`),
  `management-groups.ts` (`fetchGroupMembers`), `0054_gating_db_layer.sql`

## Cobertura indirecta

- **RLS as-built** (`animals_update` 0071, policies de `reproductive_events`, trigger 0034): NO re-testeada en
  este gate — se apoya en el Gate 2 de Fase 3/backend delta. Este chunk no agrega migrations.
- **PowerSync upload path** (`runLocalWrite`/`uploadData`): as-built spec 15, fuera del diff.
- La skill no cubre RN/PowerSync de forma nativa → el análisis de esos dominios es manual (este reporte).
