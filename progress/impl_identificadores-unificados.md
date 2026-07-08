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
- **Fase A** (migración `0122` + RPC + `assert_custom_value_valid`) — otro build.
- **Fase E** (E2E + capturas Gate 2.5) — el leader corre el capture + veta el diseño. El feature TOCA UI → el `app/e2e/captures/identificadores-unificados.capture.ts` es deliverable de Fase E (E5), NO de este pass (instrucción explícita: "NO corras e2e:build/suite"). Documentado como N/A-en-este-pass.
- **Optimización potencial** (no bloqueante): el enriquecimiento apodo/apodo_enabled es per-row correlado (≤200 filas MVP, OK). Design §8 ofrece cachear el set de rodeos-con-apodo si pesa.
