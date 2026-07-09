baseline_commit: 5aa9e21d6ca7bbe60d3087d4f74f3942a8c9d8c7

# Impl — Delta `identificadores-unificados` — Fase B (frontend + PowerSync = design §11 PASO 1)

**Scope de esta sesión**: SOLO frontend + PowerSync (design §11 PASO 1). TODO lo que DEJA de referenciar
`visual_id_alt` + agrega el apodo, TOLERANDO que la columna + los RPC viejos aún existan en el server.
NO se tocó `supabase/migrations/**` (Fase A = otro build), NO se corrió e2e:build/suite/captures (el leader
veta — Fase E), NO se commiteó.

**Fuera de scope (otros builds / el leader)**: Fase A (migración `0122`, RPC, `assert_custom_value_valid`),
Fase E (E2E + capturas Gate 2.5), Fase F (reconciliación de deltas previos + fold al baseline, Puerta 2).

## Estado: `done` (Fase B+C+D frontend completas) — pasa al reviewer.

`pnpm exec tsc --noEmit` **verde (exit 0)**. `node scripts/check.mjs --fast` **verde** (0 violaciones
anti-hardcode). Unit de lo tocado **verde** (ver mapa abajo). Grep de completitud **cero** referencias de
CÓDIGO a `visual_id_alt`/`visualIdAlt`/`visualId` en `app/` (solo comentarios que explican la eliminación).

---

## Archivos tocados

### Utils PUROS (nuevos helpers + reescrituras)
- `app/src/utils/animal-input.ts` — `sanitizeApodoInput` + `APODO_MAX_LENGTH=15` + charset `ñ`/tildes (§5); QUITADO `sanitizeVisualInput`/`VISUAL_MAX_LENGTH` (sin uso tras eliminar visual_id_alt).
- `app/src/utils/animal-identifier.ts` — reescrito `SearchPlan`/`classifySearchQuery` al modelo de 3 (`tryTagExact`/`tryIdvExact`/`tryIdvSubstring`/`tryApodo`); QUITADO `classifyIdentifier`/`IdentifierKind` (colapsa a idv — design C2); AGREGADO `pickHeroIdentifier` + `HeroKind`/`HeroResult` (§10) + `isApodoDuplicateInField` (§9).
- `app/src/utils/link-calf-query.ts` — `classifyCalfQuery` acepta alfanumérico + apodo (IDU.4.7); QUITADO `CALF_MIN_DIGITS` + rama `too-short`.
- `app/src/utils/maniobra-identify.ts` — `ManualCandidate.visualIdAlt`→`apodo`; `isExactMatch` compara idv/apodo/tag (IDU.4.11); `resolvePrefilledCreateParams` colapsa a `{ tag?, idv? }` (IDU.4.10).
- `app/src/utils/maniobra-edge.ts` — `DisambiguationCandidate.visualIdAlt`→`apodo`; `candidateDominantId` = apodo→idv.
- `app/src/utils/reports-format.ts` — `animalLabel(idv)` (1-arg, degrada a "Sin identificación", design §3).
- `app/src/utils/selection-display.ts` — `DisplayProfile.visualIdAlt`→`apodo`; `identifierOf`/`filterBySearch` por apodo.
- `app/src/utils/animal-form.ts` — QUITADO `hasAtLeastOneIdentifier` (IDU.1.4/1.5: alta en blanco persiste).
- `app/src/utils/import/{column-mapping,normalize-row,validate-rows,import-write,import-ui}.ts` — `visual_id_alt` fuera del CensusField/mapeo/contrato (IDU.3.7); "identificación visual"/"seña" ahora mapean al idv.

### PowerSync
- `app/src/services/powersync/schema.ts` — quitado `visual_id_alt` de `animal_profiles` + `pending_animal_profiles` (IDU.3.1).
- `app/src/services/powersync/local-reads.ts` — quitado `visual_id_alt` de `LOCAL_LIST_SELECT`/`_OVERLAY`/detalle/madre/whitelist de `buildSearchLikeQuery`/insert del overlay; AGREGADO `apodoValueSubquery`/`apodoEnabledSubquery` (enriquecimiento lista + detalle §8) + `buildApodoSearchQuery` (§7) + `buildApodoListQuery` (§9); FIX de `injectProjection` (ver decisiones).
- `app/src/services/powersync/upload.ts` — el connector deja de mapear `p_visual_id_alt` (IDU.3.3).

### Servicios de dominio
- `app/src/services/animals.ts` — `AnimalListItem`/`AnimalDetail`: `visualIdAlt`→`apodo`+`rodeoUsesApodo`; `LocalListRow`/`LocalDetailRow` idem; `searchAnimals` plan nuevo (tag exacto → idv exacto → idv/tag substring → **apodo**); `findOrCreateLookup`/`LookupResult` precarga `{ idv }`; `createAnimal`/`CreateAnimalInput` sin `visualIdAlt`; `decodeApodo` (helper); `fetchFieldApodos` (nuevo, warning-soft).
- `app/src/services/events.ts` — label de madre `idv → tag → "Madre"` (sin visual); overlay de cría sin fallback `visual_id_alt` (SUPERA PCV.4.5).
- `app/src/services/bulk-selection-data.ts` — `GroupSelectionProfile.visualIdAlt`→`apodo`+`rodeoUsesApodo`.
- `app/src/services/reports.ts` — `OverdueDose`/`UnweighedAnimal` sin `visualIdAlt` (no mapea la columna del retorno).
- `app/src/services/import-rodeo.ts` — comentario del contrato `p_rows` sin visual_id_alt.

### Componentes / pantallas
- `app/src/components/AnimalRow.tsx` — quitado `visualId`; sumado `apodo`+`rodeoUsesApodo`; hero por `pickHeroIdentifier` (hero + secundario muted).
- `app/app/animal/[id].tsx` — hero (`heroLabel` + `AnimalHero`) por `pickHeroIdentifier` + caravana secundaria; ELIMINADA la fila "Nombre / seña".
- `app/app/crear-animal.tsx` — quitado el guard "al menos un identificador" (IDU.1.4) + el path `prefillKind==='visual'`; el no-match precarga en idv.
- `app/app/maniobra/_components/CustomFieldInput.tsx` — prop OPCIONAL/ADITIVA `sanitize?` en la rama `text` (§5.2).
- `app/app/maniobra/_components/CustomPropertiesSection.tsx` — apodo (`data_key==='apodo'`): `sanitize={sanitizeApodoInput}` + warning-soft inline (alta sin propio; ficha excluye el propio, IDU.5.6) vía `fetchFieldApodos` + `isApodoDuplicateInField`.
- `app/app/(tabs)/animales.tsx` — `AnimalRow` apodo/rodeoUsesApodo; no-match precarga `{ idv }`; quitado `classifyIdentifier`.
- `app/app/(tabs)/reportes.tsx` — `animalLabel(d.idv)` (1-arg).
- `app/app/_components/FindOrCreateOverlay.tsx` + `app/app/asignar-caravanas.tsx` — candidatos por `pickHeroIdentifier`.
- `app/app/maniobra/identificar.tsx` — mapea `apodo` a `ManualCandidate`; labels sin visual.
- `app/app/maniobra/carga.tsx` — `displayIdentity`/`mutedTag` sin visual (idv→tag).
- `app/app/maniobra/_components/CandidatePicker.tsx` + `SpikeIdentityHeader.tsx` — comentarios/jerarquía al modelo apodo/idv (usan los helpers puros ya migrados).
- `app/app/{lotes,lote/[id],rodeo/[id],seleccion-masiva,vacunacion-masiva}.tsx` — `AnimalRow`/label sin visualIdAlt.
- `app/src/components/LinkCalfPrompt.tsx` — `calfLabel` idv→apodo→tag; quitada la rama `too-short`.

### Tests (unit) actualizados/agregados
- `animal-input.test.ts`, `animal-identifier.test.ts`, `link-calf-query.test.ts`, `maniobra-identify.test.ts`, `maniobra-edge.test.ts`, `selection-display.test.ts`, `reports-format.test.ts`, `animal-form.test.ts`, `schema.test.ts`, `upload.test.ts`, `local-reads.test.ts` (+ behavior test de `buildApodoSearchQuery` contra node:sqlite), import (`column-mapping/normalize-row/validate-rows/import-write/import-ui`).

---

## Trazabilidad R<n> → archivo:test (los IDU que caen en Fase B/C/D)

- **IDU.1.3** (apodo ≤15 charset) → `animal-input.test.ts` (sanitizeApodoInput: charset/ñ/tildes/cap).
- **IDU.1.4/1.5** (0 identificadores) → `animal-form.test.ts` (nota: guard eliminado; el alta en blanco persiste) + verificado en `crear-animal.tsx` (guard removido). *(La persistencia server-side sin 23514 la testea Fase A/E2E E2.)*
- **IDU.3.1** (schema) → `schema.test.ts` (animal_profiles/pending sin visual_id_alt).
- **IDU.3.2/4.5** (reads sin visual, sin canal visual) → `local-reads.test.ts` (LOCAL_LIST_SELECT/detalle/madre/whitelist buildSearchLikeQuery); `animal-identifier.test.ts` (classifySearchQuery sin tryVisual).
- **IDU.3.3** (connector) → `upload.test.ts` (create_animal sin p_visual_id_alt).
- **IDU.3.4** (tipos/servicios) → tsc verde (AnimalListItem/AnimalDetail/GroupSelectionProfile/OverdueDose sin visualIdAlt) + `selection-display.test.ts` + `reports-format.test.ts`.
- **IDU.3.5** (AnimalRow sin visualId) → tsc + `pickHeroIdentifier` (`animal-identifier.test.ts`).
- **IDU.3.6** (ficha sin "Nombre / seña") → verificado en `animal/[id].tsx` (fila eliminada).
- **IDU.3.7** (import sin la columna) → `import-{column-mapping,normalize-row,validate-rows,import-write,import-ui}.test.ts`.
- **IDU.4.1/4.2/4.3** (plan de búsqueda de 3) → `animal-identifier.test.ts` (classifySearchQuery).
- **IDU.4.4** (canal apodo) → `local-reads.test.ts` (buildApodoSearchQuery SQL + behavior sqlite scopeado por campo).
- **IDU.4.6** (buscador general) → `searchAnimals` ejecuta el plan (cubierto por unit del plan + behavior del canal apodo).
- **IDU.4.7** (cría al pie idv alfanum + apodo) → `link-calf-query.test.ts`.
- **IDU.4.8/4.11** (maniobra manual + match exacto) → `maniobra-identify.test.ts` (apodo exacto → found; substring → ambiguous).
- **IDU.4.9** (Bastonear solo-electrónica) → verificado: `assignTagToAnimal`/`TagScanSheet` intactos (no se agregó idv/apodo).
- **IDU.4.10** (precarga colapsa a idv) → `maniobra-identify.test.ts` (resolvePrefilledCreateParams) + `findOrCreateLookup` (prefilled `{ idv }`).
- **IDU.5.1** (sanitizeApodoInput) → `animal-input.test.ts`.
- **IDU.5.2/5.3** (aplicar sanitize en alta + ficha) → `CustomFieldInput.tsx` (prop sanitize) + `CustomPropertiesSection.tsx` (data_key==='apodo').
- **IDU.5.4/5.5/5.6/5.7** (warning-soft) → `animal-identifier.test.ts` (isApodoDuplicateInField: case-insensitive/trim/vacío/excluye-propio) + `local-reads.test.ts` (buildApodoListQuery scopeado por campo) + wiring en `CustomPropertiesSection.tsx`.
- **IDU.6.1/6.4/6.6** (hero) → `animal-identifier.test.ts` (pickHeroIdentifier: prioridad + secondary + none).
- **IDU.6.2** (hero en lista) → `AnimalRow.tsx` (pickHeroIdentifier) + `animales.tsx` (pasa apodo/rodeoUsesApodo).
- **IDU.6.3** (hero en ficha) → `animal/[id].tsx` (AnimalHero por pickHeroIdentifier + secundario).
- **IDU.6.5** (leer apodo + apodo_enabled por animal) → `local-reads.ts` (apodoValueSubquery/apodoEnabledSubquery, overlay-aware) + `animals.ts` (decodeApodo + toBool).
- **IDU.7.1** (rename "Nombre/Apodo") → **Fase A** (`update field_definitions set label` en `0122`). El frontend ya no muestra "Nombre / seña" (removido). *(El label lo consume el CustomFieldInput desde field_definitions → llega con el rename tras Fase A.)*

**IDU.2.x** (backend: drop trigger/columna, re-create RPC) = **Fase A** (fuera de scope).

---

## Decisiones (as-built)

1. **Ubicación de `pickHeroIdentifier` + `isApodoDuplicateInField`**: en `animal-identifier.ts` (util PURO ya existente, sin RN/SDK). Lo importan `AnimalRow`/`animal/[id]`/`FindOrCreateOverlay`/`asignar-caravanas` (RN) y `animals.ts` (servicio) — todos sin ciclo. Design §10 dejaba la ubicación al implementer.

2. **`buildApodoSearchQuery` (§7) reusa `buildSearchUnion`**: el canal apodo se implementa como un `EXISTS` correlado sobre el perfil (no un JOIN → no multiplica filas) DENTRO de `buildSearchUnion` → devuelve `LocalListRow` idéntico a las otras ramas (el motor dedupe/concat uniforme) **y hereda el `LIMIT 20` del UNION** (cierra LOW-1 del Gate 1). El `overlay pendiente` (§7): el apodo recién cargado offline vive en `custom_attributes` local (setCustomAttribute con el mismo profileId) → la subconsulta lo encuentra sin rama overlay extra (verificable; no hizo falta `pending_custom_attributes`).

3. **`AnimalDetail` ENRIQUECIDA con `apodo` + `rodeoUsesApodo`** (leve as-built vs. design §10): en vez de plomear el apodo desde el hijo `CustomPropertiesFicha` al `heroLabel` del padre, `buildAnimalDetailQuery` proyecta las MISMAS subconsultas del apodo que la lista → `fetchAnimalDetail` las devuelve → `[id].tsx` usa `pickHeroIdentifier` self-contained. Es la lectura correcta de "la ficha ya lee custom_attributes → tiene el apodo" (design §10), por el mismo mecanismo que la lista. Más robusto y testeable que el data-plumbing cross-componente.

4. **`injectProjection` FIX (bug cazado en la autorrevisión)**: buscaba el PRIMER ` FROM `, que tras el enriquecimiento del apodo ahora es el de una SUBCONSULTA correlada (`FROM custom_attributes …`) → inyectaba el alias `updated_at` DENTRO de la subconsulta → "ORDER BY term does not match any column" (rojo en el behavior test de la lista). Fix: inyecta antes del FROM de la tabla PRINCIPAL (`FROM animal_profiles ap` / `FROM pending_animal_profiles pap`). Cazado + verde por el behavior test contra node:sqlite.

5. **`classifyIdentifier`/`IdentifierKind` ELIMINADOS** (design C2 permitía "o la función se elimina"): ya no hay ramificación idv-vs-visual — el no-match precarga SIEMPRE en idv (IDU.4.10). `findOrCreateLookup` + `animales.tsx` + `resolvePrefilledCreateParams` colapsan a idv.

6. **`hasAtLeastOneIdentifier` ELIMINADO** (IDU.1.4/1.5): el guard cliente existía SOLO porque el server rechazaba con 23514 (trigger de completitud). Fase A dropea el trigger → el alta en blanco persiste → el guard es obsoleto. Se removió del alta (`crear-animal.tsx`) + de `animal-form.ts`.

7. **Import: sinónimos "visuales" → `idv`** (no un campo nuevo): al eliminar el CensusField `visual_id_alt`, los headers "identificación visual"/"seña"/"marca" se re-mapean al `idv` (la caravana visual alfanumérica), no se pierden. El apodo NO es una columna de censo (es custom).

8. **`apodo_enabled` overlay-aware**: `COALESCE(pending_rodeo_data_config, rodeo_data_config, 0)` — un toggle offline del campo apodo se refleja en el hero al instante. El apodo fd id se resuelve CORRELADO por el establishment del propio perfil (1 apodo fd por campo, seed 0119).

---

## Autorrevisión adversarial (paso 8)

**Qué busqué y qué encontré:**
- **Bug de `injectProjection`** (ver decisión 4) — ENCONTRADO por el behavior test de la lista contra node:sqlite. Corregido + re-verde.
- **Placeholder-count del canal apodo**: verifiqué que `buildApodoSearchQuery` no introduce `?` de más — las subconsultas del apodo usan `data_key='apodo'` LITERAL y correlación por columna (`ap.id`/`ap.establishment_id`), sin placeholders; el único `?` es el `LIKE` del EXISTS → `buildSearchUnion` lo alinea. Verde en el behavior test.
- **Scope multi-tenant**: `buildApodoSearchQuery`/`buildApodoListQuery`/enriquecimiento → todos scopeados por `establishment_id` (param del contexto activo, nunca hardcode) + `data_key='apodo'` constante (no input) + LIKE escapado (`escapeLike`) → sin injection ni cross-tenant. Test de escape (`50%_x` → `%50\%\_x%`).
- **`decodeApodo` tolerante**: value JSON-string / texto plano / null / '' → resuelve a string o null (empty→null). Sin crash.
- **Offline-first**: todos los reads nuevos son SQLite local (searchAnimals, hero, warning) — sin red nueva. El apodo optimista de un alta reciente lo encuentra la subconsulta (mismo profileId).
- **IDU.5.6 (no duplicarse consigo mismo)**: en la ficha, `isApodoDup` excluye el `profileId` propio; en el alta, el animal aún no existe → exclude null. Verificado en el wiring.
- **IDU.4.9 (Bastonear solo-electrónica)**: NO toqué `TagScanSheet`/`assignTagToAnimal` — el duplicate-check sigue EID-only.
- **Grep de completitud**: cero referencias de CÓDIGO a `visual_id_alt`/`visualIdAlt`/`visualId` en `app/` (solo comentarios que explican la eliminación).

**Tolerancia al server viejo (design §11 PASO 1)**: el connector llama `create_animal` SIN `p_visual_id_alt` (el RPC viejo lo tiene con DEFAULT NULL → válido); `reports.ts` no mapea la columna del retorno (aunque el RPC viejo aún la devuelva); el schema local ignora la columna server presente. Cero ventana rota.

---

## Reconciliación de specs (al as-built)
- `design.md` (§7 canal apodo LIMIT, §8 injectProjection fix, §10 AnimalDetail enriquecida) + `tasks.md` (B/C/D [x]) reconciliados abajo. Las notas de as-built van bajo cada sección.
- `requirements.md`: sin reescritura de EARS (el *qué* no cambió; el *cómo* de la ficha se documenta en design §10 as-built).

## Pendiente (fuera de este pass)
- **Fase E** (E2E + capturas Gate 2.5) — el leader corre el capture + veta el diseño. El feature TOCA UI → el `app/e2e/captures/identificadores-unificados.capture.ts` es deliverable de Fase E (E5), NO de este pass (instrucción explícita: "NO corras e2e:build/suite"). Documentado como N/A-en-este-pass.
- **Optimización potencial** (no bloqueante): el enriquecimiento apodo/apodo_enabled es per-row correlado (≤200 filas MVP, OK). Design §8 ofrece cachear el set de rodeos-con-apodo si pesa.

---

## Fase E backend (A7 + A8) — suites `supabase/tests/` sobre el remoto YA MIGRADO (0122)

**Contexto**: la migración `0122` YA está desplegada + verificada por el leader. Este pass actualiza/extiende las
suites backend al schema NUEVO (sin `visual_id_alt`, sin trigger de completitud, `create_animal` 19 args, apodo
server-validado) y las corre VERDES contra el remoto. NO se tocó `supabase/migrations/**` ni frontend.

### Barrido de `visual_id_alt` / `p_visual_id_alt` / `visualAlt` (schema nuevo)
- **Helpers `createAnimal` (INSERT directo a `animal_profiles`)** de `animal`/`reports`/`maneuvers`/`operaciones_rodeo`/
  `puesta-en-servicio`: quitado el param `visualAlt` + la línea `profilePayload.visual_id_alt = visualAlt` (ningún
  caller lo pasaba). El perfil sin idv/tag ahora persiste (trigger de completitud dropeado).
- **`sigsa`**: `visualAlt` era el identificador de ~25 fixtures → **remapeado a `idv`** (la caravana visual es ahora
  el idv alfanumérico). Helper: quitado `visualAlt`; callers `visualAlt:` → `idv:`; el insert directo del perfil
  destino (T5g) `visual_id_alt:` → `idv:`. Sin colisiones de idv (verificado: 72/72 verde; SIGSA no asserta idv).
- **`import`**: `makeRow` usaba `visual_id_alt` como identidad mínima → **remapeado a `idv`** (el `import_rodeo_bulk`
  re-creado lee `v_row->>'idv'`, ya no `visual_id_alt`). Callers `{ visual_id_alt: X }` → `{ idv: X }`; los filtros
  `.like('visual_id_alt', …)` → `.like('idv', …)`; el `.select` de verificación idem.
- **Llamadas al RPC `create_animal`**: son named-param (objeto), NUNCA pasaban `p_visual_id_alt` → compatibles con la
  firma nueva de 19 args sin tocarlas.
- Grep final: CERO referencias de código a `visual_id_alt`/`visualAlt`/`p_visual_id_alt` (solo comentarios que explican la eliminación).

### A7 — `register_birth` + mono-ternero (trace `IDU.<n> → archivo:test`)
- **IDU.1.4 / IDU.2.2** (cría both-null persiste sin 23514 + `birth_calves` creada) → `animal/run.cjs::IDU.1.4/2.2: ternero sin idv ni tag → persiste con idv/tag NULL (sin 23514) + birth_calves creada`.
- **IDU.2.2** (mellizos idv distinto siguen OK) → `animal/run.cjs::PCV.5.1/5.2` (idv per-cría, tag null).
- **IDU.1.6** (idv duplicado → 23505 + rollback atómico) → `animal/run.cjs::PCV.5.3` (mellizos mismo idv; idv del rebaño).
- **IDU.2.2** (mono-ternero por trigger `tg_reproductive_events_create_calf`, INSERT directo de `reproductive_events` con `calf_sex`, sin tag → cría persiste) → `animal/run.cjs::T2.7 ternero al pie` (sin tag → idv NULL; con tag → idv NULL).
- **IDU.1.4** (regresión mellizos sin caravana) → `animal/run.cjs::PCV.4.6/IDU.1.4`.

### A8 — resto de RPC + apodo server-side (trace)
- **IDU.1.4 / IDU.2.5** (`create_animal` 19 args, 0 identificadores persiste) → `animal/run.cjs::caso 8 (IDU.1.4): create_animal sin idv ni tag → persiste con idv/tag NULL`.
- **IDU.1.4 / IDU.2.5** (alta directa sin identificadores persiste) → `animal/run.cjs::T2.2 Caso 3` (reemplaza el viejo "solo visual" + "sin ninguno → 23514") + `T2.14 Caso 4`.
- **IDU.2.5** (`import_rodeo_bulk` sin `visual_id_alt`, importa por `idv`) → `import/run.cjs::T2.5 R8.1/R8.2/R8.4/SEC-12B` (todo el bloque RPC).
- **IDU.2.5** (`transfer_animal` sin leer/escribir `visual_id_alt`, historia preservada) → `animal/run.cjs::spec 11 transfer_animal` (T2.1 camino feliz — el perfil destino ya no proyecta la columna).
- **IDU.2.5** (reportes `establishment_overdue_doses`/`establishment_unweighed` retornan sin la columna, leen `idv`) → `reports/run.cjs::TR.8` (`rowA1.idv`) + `TR.9`.
- **IDU.4.3 / IDU.4.5** (búsqueda por substring sobre `idv`, no `visual_id_alt`; anti-injection) → `animal/run.cjs::T2.11 búsqueda` + `R8.1 .ilike(col, pattern) parametrizado`.
- **IDU.5.1b** (apodo server-autoritativo: ≤15 + charset alfanum/ñ/tildes/espacio/guion; `#`/`!`/emoji → 23514) → `custom/run.cjs::(p) delta #2 NOMBRE/APODO` (bloque IDU.5.1b agregado; `assert_custom_value_valid` vía trigger `custom_attributes_gating`).
- **IDU.2.1** (trigger de completitud `animal_profiles_identity_check` ELIMINADO — ya no está entre los BEFORE) → `operaciones_rodeo/run.cjs::T-DB.4(f)` (assert `idx(...)===-1`).

### Resultado de las suites (remoto migrado, verde)
| suite | tests | resultado |
|---|---|---|
| `animal` | 139 | ✅ pass |
| `sigsa` | 72 | ✅ pass |
| `import` | 25 | ✅ pass |
| `reports` | 16 | ✅ pass |
| `custom` | 20 | ✅ pass |
| `maneuvers` | 14 | ✅ pass |
| `operaciones_rodeo` | 22 | ✅ pass (T-DB.4(f) actualizado; T-DB.9/T-DB.10 fueron flake de rate-limit del Management API en la 1ª corrida, verde al reintentar) |
| `puesta-en-servicio` | 11 | ✅ pass |
| `scrotal` | 12 | ✅ pass (regresión — inserta en `animal_profiles`) |
| `sync_streams` | 25 | ✅ pass (regresión) |

### Autorrevisión adversarial (Fase E backend)
- **¿Quedó algún `visual_id_alt` vivo?** No — grep final: solo comentarios. Ningún `.select`/`.like`/insert/param lo referencia.
- **¿Algún `create_animal` con 20 args?** No — todas las llamadas son named-param sin `p_visual_id_alt`; la firma nueva (19) las acepta.
- **¿Los asserts prueban el comportamiento NUEVO?** Sí — cría both-null PERSISTE (no fallback, no 23514) + `birth_calves` creada; create_animal 0-identificadores persiste; mono-ternero por trigger persiste; apodo server-rechaza >15/charset. Se ELIMINÓ el viejo assert "sin identificador → 23514" (T2.2) y "visual_id_alt = fallback" (parto) y "visual_id_alt editable" (T2.14) y "identity_check existe" (T-DB.4(f)).
- **Falsos verdes**: el 23505 de idv duplicado sigue verificando el reject real + rollback (0/0 eventos/terneros). El apodo-charset verifica el reject con errcode 23514 (no un OK espurio). El mono-ternero verifica que la cría SÍ se crea (calf_id no null + categoría).
- **Multi-tenant**: SIGSA idv remapeado NO cruza campos (idv unique per-est; ests frescos por corrida). `establishment_id` siempre del contexto, nunca hardcode.
- **Flake vs regresión**: T-DB.9/T-DB.10 (Management API) fallaron 1 vez con `adminQuery HTTP` (rate-limit, no tocan `visual_id_alt`) → reintento verde. T-DB.4(f) fue regresión REAL (trigger dropeado) → corregido, no reintentado a ciegas.

---

## Fase E frontend (E1–E5) — E2E de regresión + capturas Gate 2.5 (contra el remoto MIGRADO 0122)

**Scope**: SOLO e2e nuevos + capture (Fase E, tareas E1–E5). NO se tocó código de app ni tests unit ni migraciones.
El frontend (Fase B/C/D, commit `865e954`) + la migración `0122` YA están en `main`/el remoto. `e2e:build` (dist)
+ los e2e corren contra ese estado. Archivos NUEVOS (los únicos del diff de esta pasada):
- `app/e2e/identificadores-unificados.spec.ts` — red de regresión E1–E4 (8 tests).
- `app/e2e/captures/identificadores-unificados.capture.ts` — capture Gate 2.5 (3 tests → 9 capturas nombradas).

**Import de fixtures**: `test`/`expect` de `./helpers/fixtures` (NO `@playwright/test`) + `type Page` de `@playwright/test`
(fixtures no exporta `Page`; `e2e/` está EXCLUIDO del tsconfig → Playwright compila con esbuild, tsc no lo mira).

### Resultado de las corridas (remoto migrado)
| suite/capture | tests | resultado |
|---|---|---|
| `identificadores-unificados.spec.ts` | 8 | ✅ 8/8 pass (59.5s) |
| `identificadores-unificados.capture.ts` (`playwright.capture.config.ts`, 412×915) | 3 | ✅ 3/3 pass → 9 PNGs |

Capturas (gitignored en `app/e2e/captures/__shots__/identificadores-unificados/`, NO staged): `01-lista-hero-por-apodo-vs-caravana`,
`02-busqueda-electronica-exacta`, `03-busqueda-idv-alfanumerico`, `04-busqueda-por-apodo`, `05-ficha-hero-por-apodo`,
`06-ficha-identificacion-sin-nombre-sena`, `07-alta-paso4-sin-caravana`, `08-ficha-alta-sin-caravana-hero-animal`,
`09-warning-apodo-duplicado`. El leader las veta visualmente antes de la Puerta 2.

### Trazabilidad IDU.<n> → test (Fase E)
- **IDU.4.3** (idv alfanumérico exacto/parcial) → `identificadores-unificados.spec.ts::E1a` (búsqueda "VAQ12" → "VAQ12AB") + `::E1c` (maniobra manual "VQ88AB").
- **IDU.4.4** (apodo, custom_attributes) → `::E1a` (búsqueda "Manchada") + `::E1d` (maniobra manual "Pinta").
- **IDU.4.6** (los 3 en el buscador general) → `::E1a` (electrónica exacta 15 díg + idv alfanum + apodo).
- **IDU.4.7** (cría al pie / classifyCalfQuery: idv alfanum + apodo + eid) → `::E1b` (LinkCalfPrompt: "CR12XY" → found · "Lucera" → found · tag 15 díg → eid→edit→found).
- **IDU.4.8** (maniobra manual "sin bastón") → `::E1c` (idv alfanumérico → found → auto-avance) + `::E1d` (apodo → found → auto-avance).
- **IDU.1.4** (0 identificadores persiste, sin 23514) → `::E2a` (alta en blanco → perfil con idv NULL + tag NULL, oráculo server `waitForSoleProfile`) + `::E2b` (parto de cría sin caravana → `waitForServerBirth` calfCount=1, birth_calves server-only prueba que register_birth no rechazó con 23514).
- **IDU.6.2** (hero apodo en lista) → `::E3` (fila "Manchada" hero + "· #AA111" secundaria; contraste "AA222" idv hero sin "· #AA222").
- **IDU.6.3** (hero apodo en ficha) → `::E3` (ficha "Manchada" hero + "#AA111" secundaria + "Datos personalizados").
- **IDU.6.4** (sin apodo → idv/tag hero) → `::E3` (A2 en rodeo sin apodo → "AA222" caravana grande).
- **IDU.5.4** (aviso de duplicado por campo) → `::E4` (apodo "Pinta" ya usado en el campo activo → aviso inline).
- **IDU.5.5** (no bloquea el guardado) → `::E4` ("Crear animal" con el aviso presente → ficha + `waitForServerAnimalProfile`).
- **IDU.5.7** (mismo apodo en OTRO campo → sin aviso) → `::E4` ("Manchada" solo en field2 → NO aparece el aviso en field1, 2 campos).
- **IDU.3.6** (ficha sin "Nombre / seña") → `capture::06` (aserción `getByText('Nombre / seña').toHaveCount(0)` + shot de la sección Identificación).

### Autorrevisión adversarial (Fase E)
- **¿Los tests prueban el comportamiento REAL o pasan por casualidad?** Sí — self-review VISUAL de las capturas: `01`
  muestra "Manchada"/"La Colorada" como HERO con "· #idv" secundario vs "AR0912"/"AR1050" con la caravana grande;
  `05` muestra la ficha "Manchada" hero + "#AB123A0001" secundario + Identificación SIN "Nombre / seña" (solo
  electrónica/visual); `08` muestra el hero "Animal" (0 identificadores) + afordancias vacías; `09` muestra el aviso
  muted bajo el input + "Crear animal" habilitado (no bloquea). No son pantallas en blanco.
- **Oráculos server-side (no solo UI)**: E2a poll de `animal_profiles` (idv NULL) + `animals.tag_electronic` NULL;
  E2b `waitForServerBirth` (calfCount=1, `birth_calves` es server-only → la RPC corrió sin 23514); E4 `waitForServerAnimalProfile`.
  Evita el patrón-trampa del backlog 2026-06-10 (asertar solo el overlay).
- **Multi-tenant**: `establishmentId` SIEMPRE del contexto (seeds namespaced RUN_TAG); IDU.5.7 prueba el scope por
  campo (Manchada en field2 no filtra a field1). Cero hardcode de `establishment_id`.
- **Offline-first**: la búsqueda (general/cría al pie/maniobra), el hero y el warning son lecturas LOCALES (SQLite
  PowerSync); se esperó el sync a la lista antes de cada búsqueda (proxy de "ya bajó al local").
- **NO se usó `visual_id_alt` en ningún seed** (la columna se dropeó): los animales se siembran con `idv`/`tag`/apodo
  (custom_attribute) solamente. `seedAnimal` sin `visualAlt` no toca la columna eliminada.
- **Bug cazado + fijado en la autorrevisión**: la lista queda MONTADA (hidden) detrás de la ficha pusheada →
  `getByText(hero).first()` agarraba el nodo OCULTO de la lista (E3 + capture rojos). Fix: `.filter({ visible: true }).first()`
  para apuntar a la ficha (memoria `reference_e2e_sheet_no_nav_oracle`). Re-verde. Idem el shot `09`: scrolleaba el header
  de sección (recortaba el aviso contra el footer) → scroll del AVISO mismo a la vista → shot bien enmarcado.

### Reconciliación de specs (Fase E)
- `tasks-identificadores-unificados.md` E1–E5 pasan a `[x]` con el as-built (los archivos + qué cubre cada uno).
- Sin cambio de `requirements`/`design` (el *qué*/*cómo* no cambió; los e2e solo VERIFICAN los IDU ya especificados).
- **`design/` NO fue tocado** por esta corrida aislada (mis specs no escriben a `design/`; `e2e:build`/mi capture tampoco).
  `git status` = solo los 2 archivos nuevos; ningún PNG staged; los `__shots__/*.png` gitignored.

### Pendiente (fuera de esta pasada, para el leader / otras terminales)
- **Suite e2e PRE-EXISTENTE con `visualAlt`**: `app/e2e/helpers/admin.ts` (`seedAnimal.visualAlt`, `waitForServerAnimalProfile.visualAlt`,
  `adminQueryProfileByVisual`) y varios specs (`maniobra-identify`, `events`, `sigsa`, …) SIGUEN referenciando `visual_id_alt`.
  Contra el remoto migrado, un `seedAnimal({ visualAlt })` fallaría (columna inexistente) y el test de parto que asserta el
  fallback "recién nacido — pendiente de caravana" ya no aplica. NO lo toqué (fuera del scope E1–E5, cambio transversal a
  la suite existente) — se registra para reconciliar la suite legacy al schema nuevo en un pass aparte.
