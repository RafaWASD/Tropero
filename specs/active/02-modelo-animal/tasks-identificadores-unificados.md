# Spec 02 — Delta IDENTIFICADORES UNIFICADOS — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** · Gate 1 APLICA · Gate 2 (siempre) · Gate 2.5 (UI).
**Fuente de verdad**: `context-identificadores-unificados.md`. **Requirements**: `IDU.<n>`. **Design**: `design-identificadores-unificados.md`.

**Convenciones de deploy (recordar en cada task de DB/sync):**
- `[BACKEND/Gate1]` — toca migración/RPC/trigger/RLS → pasa por Gate 1 antes de Puerta 1. La migración `0122` lleva banner `🔴 NO aplicar desde acá`; **el deploy lo hace el LEADER por Supabase MCP con autorización explícita de Raf** (memoria `project_supabase_mcp_write`). El implementer NO aplica migraciones.
- `[FRONTEND/PowerSync]` — el cambio de `schema.ts` (schema local) viaja en el bundle; **el deploy del schema/sync-rules del servicio PowerSync lo coordina/gestiona Raf** (contexto §6). El implementer NO deploya PowerSync.
- **Orden de deploy (design §11)**: PASO 1 (frontend + schema PowerSync tolerantes, dejan de referenciar la columna) **antes** de PASO 2 (migración DB que dropea trigger + columna). Coordinado por Raf.

---

## Fase A — Backend: migración + RPC `[BACKEND/Gate1]`

- [ ] **A1** — Redactar `supabase/migrations/0122_drop_visual_id_alt.sql` (esqueleto design §4), banner `🔴 NO aplicar`. Migración atómica `begin/commit`. Cubre: IDU.2.7.
- [ ] **A2** — En `0122`: drop del trigger `animal_profiles_identity_check` + `drop function tg_animal_profiles_identity_check()`. Cubre: IDU.2.1, IDU.1.4, IDU.1.5.
- [ ] **A3** — En `0122`: `register_birth` `CREATE OR REPLACE` (misma firma 6-arg) **moldeando sobre el cuerpo VIGENTE del remoto** (el leader lo pasa — `reference_function_recreate_base`), quitando (a) la decl del fallback, (b) la columna `visual_id_alt` del INSERT, (c) la expresión del `case ... v_visual_fallback` (design §2). Re-grants fail-closed. Cubre: IDU.2.2.
- [ ] **A4** — En `0122`: re-create de los demás RPC sin `visual_id_alt` (design §3), moldeando sobre el remoto vigente: `create_animal` (DROP+CREATE, sin `p_visual_id_alt`, re-grant), `import_rodeo` (CREATE OR REPLACE, sin la columna en INSERT + comentario de `p_rows`), `transfer_animal` (CREATE OR REPLACE, sin el SELECT ni el INSERT de la columna), reportes `0106` (DROP+CREATE, sin `visual_id_alt` en `RETURNS TABLE` ni SELECT, re-grant). Cubre: IDU.2.5.
- [ ] **A5** — En `0122`: `update field_definitions set label='Nombre/Apodo' where data_key='apodo'`. Cubre: IDU.7.1.
- [ ] **A6** — En `0122`: drop explícito de dependientes (`animal_profiles_visual_alt_trgm`, constraints `animal_profiles_visual_id_alt_len_chk` y `animal_profiles_local_id_check`) + `alter table animal_profiles drop column if exists visual_id_alt`. NO tocar la lógica de inmutabilidad `0036` (solo comentario). `notify pgrst`. Cubre: IDU.2.3, IDU.2.4, IDU.2.6.
- [ ] **A7** — `[BACKEND/Gate1]` Suites backend `supabase/tests/`: extender `register_birth` (parto/mellizos sin fallback; **cría sin tag ni idv persiste con idv/tag NULL sin 23514** — IDU.1.4; mellizos idv distinto siguen OK; 23505 por idv duplicado → rollback atómico). Cubre: IDU.2.2, IDU.1.4.
- [ ] **A8** — `[BACKEND/Gate1]` Suites backend: aserción de que `create_animal`/`import_rodeo`/`transfer_animal` insertan/leen sin `visual_id_alt`; que los reportes retornan sin la columna; que un `animal_profile` con los 3 identificadores NULL persiste. Re-correr TODAS las suites que tocan estos RPC (animal + SIGSA por `breed_id` + parto/mellizos + transfer + reportes). Cubre: IDU.2.5, IDU.1.4, IDU.1.6.

## Fase B — PowerSync: schema + reads + connector `[FRONTEND/PowerSync]`

- [x] **B1** — `schema.ts`: quitar `visual_id_alt` de `animal_profiles` y `pending_animal_profiles`. Cubre: IDU.3.1.
- [x] **B2** — `local-reads.ts`: quitar `visual_id_alt` de `LOCAL_LIST_SELECT`, `LOCAL_LIST_SELECT_OVERLAY`, la whitelist de `buildSearchLikeQuery`, y la lectura de la madre del vínculo cría-al-pie (synced + overlay). Cubre: IDU.3.2, IDU.4.5.
- [x] **B3** — `upload.ts`: el connector deja de mapear `visual_id_alt` (INSERT/PATCH de `animal_profiles`) y `p_visual_id_alt` (replay de `create_animal`). Cubre: IDU.3.3.
- [x] **B4** — `local-reads.ts`: `buildApodoSearchQuery(establishmentId, term)` (EXISTS correlado sobre `custom_attributes`+`field_definitions` por `data_key='apodo'`, scope `ap.establishment_id`, LIKE escapado sobre `value`) devolviendo `LocalListRow` vía `buildSearchUnion` (hereda `LIMIT 20` → cierra LOW-1). Cubre: IDU.4.4. `[unit]` test del SQL builder + behavior sqlite.
- [x] **B5** — `local-reads.ts`: enriquecer `LOCAL_LIST_SELECT`/`_OVERLAY` **y `buildAnimalDetailQuery`** con `apodo` (subconsulta correlada custom_attributes+fd) + `apodo_enabled` (COALESCE overlay `pending_rodeo_data_config` → synced `rodeo_data_config`, apodo fd id correlado por establishment) (design §8). Cubre: IDU.6.5. **As-built**: subconsultas correladas (no LEFT JOIN → no multiplica filas); FIX de `injectProjection` (buscaba el FROM de la subconsulta → ahora el de la tabla principal).
- [x] **B6** — `local-reads.ts`: `buildApodoListQuery(establishmentId)` (todos los apodos activos del campo con su `profile_id`) para el warning-soft + `fetchFieldApodos` en `animals.ts`. Cubre: IDU.5.4.

## Fase C — Clasificadores + búsqueda (utils PUROS + data-layer)

- [x] **C1** — `animal-identifier.ts`: reescrito `SearchPlan` + `classifySearchQuery` al modelo de 3 (`tryTagExact`/`tryIdvExact`/`tryIdvSubstring`/`tryApodo`, sin `tryVisual`; idv habilitado para todo término no vacío; design §6). `[unit]` tests. Cubre: IDU.4.1, IDU.4.2, IDU.4.3, IDU.4.5.
- [x] **C2** — `animal-identifier.ts`: `classifyIdentifier`/`IdentifierKind` **ELIMINADOS** (el caller ya no ramifica: precarga siempre en idv); `resolvePrefilledCreateParams` (maniobra-identify) colapsa a `{ tag?, idv? }`. `[unit]` tests. Cubre: IDU.4.10.
- [x] **C3** — `animals.ts` `searchAnimals`: ejecuta el plan nuevo (tag exacto → idv exacto → idv/tag substring → apodo), sin rama `visual_id_alt`, dedupe por `profileId` con exactos priorizados. Cubre: IDU.4.2, IDU.4.3, IDU.4.4, IDU.4.6.
- [x] **C4** — `link-calf-query.ts` `classifyCalfQuery`: acepta idv alfanumérico + apodo (relajado el gate `^\d+$`/`too-short` → eliminado `too-short`/`CALF_MIN_DIGITS`); `eid` (15 díg) intacto. `[unit]` tests. Cubre: IDU.4.7.
- [x] **C5** — `maniobra-identify.ts`: `ManualCandidate.visualIdAlt`→`apodo`; `isExactMatch` compara idv/apodo/tag; `maniobra-edge.ts` `DisambiguationCandidate.apodo` + `candidateDominantId`. Verificados `identificar.tsx` + `CandidatePicker.tsx` + `FindOrCreateOverlay.tsx` (búsqueda por los 3, sin visual). `[unit]` tests. Cubre: IDU.4.8, IDU.4.11.
- [x] **C6** — Verificado: el "Bastonear" duplicate-check de ficha/alta sigue **solo-electrónica** (`TagScanSheet`/`assignTagToAnimal` intactos, sin idv/apodo). Cubre: IDU.4.9.

## Fase D — Frontend: hero, apodo (formato + warning), remoción de visual_id_alt

- [x] **D1** — `animal-input.ts`: `sanitizeApodoInput` + `APODO_MAX_LENGTH=15` (charset design §5, incluye `ñ`/tildes). QUITADO `sanitizeVisualInput`/`VISUAL_MAX_LENGTH` (sin uso). `[unit]` tests. Cubre: IDU.5.1.
- [x] **D2** — `pickHeroIdentifier` (PURO, en `animal-identifier.ts`, design §10) + `[unit]` tests. Cubre: IDU.6.1, IDU.6.4, IDU.6.6.
- [x] **D3** — `isApodoDuplicateInField` (PURO, en `animal-identifier.ts`, design §9) + `[unit]` tests. Cubre: IDU.5.4, IDU.5.6, IDU.5.7.
- [x] **D4** — `AnimalRow.tsx`: quitado `visualId`; sumado `apodo`/`rodeoUsesApodo`; render por `pickHeroIdentifier`. Cubre: IDU.3.5, IDU.6.2.
- [x] **D5** — `animales.tsx` / `seleccion-masiva.tsx` / `asignar-caravanas.tsx` / `bulk-selection-data.ts` / `selection-display.ts` (+ `lotes`/`lote/[id]`/`rodeo/[id]`/`vacunacion-masiva`): pasan `apodo`+`rodeoUsesApodo`; sin `visualIdAlt`. Cubre: IDU.3.4, IDU.6.2, IDU.6.5.
- [x] **D6** — `CustomFieldInput.tsx`: prop OPCIONAL/ADITIVA `sanitize?` en la rama `text`; el caller la setea a `sanitizeApodoInput` cuando `data_key==='apodo'`. Cubre: IDU.5.2, IDU.5.3.
- [x] **D7** — `crear-animal.tsx` (CustomPropertiesForm): `sanitize` del apodo + warning-soft (`fetchFieldApodos` → `isApodoDuplicateInField`, aviso inline muted, no bloquea). QUITADO el guard `hasAtLeastOneIdentifier` (IDU.1.4). Cubre: IDU.5.2, IDU.5.4, IDU.5.5.
- [x] **D8** — `animal/[id].tsx`: ELIMINADA la fila "Nombre / seña"; hero por `pickHeroIdentifier` (`heroLabel` + `AnimalHero` + secundario); edición del apodo en `CustomPropertiesFicha` con `sanitize` + warning-soft (excluye el propio). Cubre: IDU.3.6, IDU.6.3, IDU.5.3, IDU.5.4, IDU.5.6.
- [x] **D9** — Quitado `visualIdAlt`/`visual_id_alt` de: `animals.ts` (`LocalListRow`/`AnimalDetail`/`CreateAnimalInput`/`createAnimal`), `events.ts` (overlay de cría sin fallback + label madre `idv ?? tag`), `import-rodeo.ts`, `reports.ts` + `reports-format.ts` (`animalLabel(idv)`), `AlertList.tsx`/`reportes.tsx`. Cubre: IDU.3.4.
- [x] **D10** — Flujo de import (`normalize-row`/`validate-rows`/`import-write`/`column-mapping`/`import-ui`): dejó de mapear `visual_id_alt`; sinónimos "visuales" → `idv`. `[unit]` tests actualizados. Cubre: IDU.3.7.

## Fase E — E2E + capturas (Gate 2.5)

- [ ] **E1** — E2E búsqueda por los 3: electrónica exacta (15 díg), idv **alfanumérico** (letras), apodo — en buscador general + cría al pie + maniobra manual "sin bastón". Import de `test`/`expect` desde `./helpers/fixtures`. Cubre: IDU.4.3, IDU.4.4, IDU.4.6, IDU.4.7, IDU.4.8.
- [ ] **E2** — E2E alta y parto **sin ninguna caravana** → el animal/cría persiste (no rompe, sin 23514). Cubre: IDU.1.4.
- [ ] **E3** — E2E nombre como hero: rodeo con apodo habilitado → apodo grande en lista + ficha, caravana secundaria; contraste con rodeo sin apodo (caravana grande). Cubre: IDU.6.2, IDU.6.3, IDU.6.4.
- [ ] **E4** — E2E warning-soft de apodo duplicado en el mismo campo (aparece el aviso, NO bloquea el guardado); mismo apodo en otro campo → sin aviso. Cubre: IDU.5.4, IDU.5.5, IDU.5.7.
- [ ] **E5** — Capturas Gate 2.5 (`app/e2e/captures/identificadores-unificados.capture.ts`): búsqueda por los 3, alta sin caravana, hero por apodo (lista + ficha), warning de apodo, ficha sin "Nombre / seña". Veto visual del leader antes de mostrar a Raf. Recordatorio memoria `reference_e2e_design_png_rerender` (no `git add -A` tras e2e; revertir `design/`). Cubre: IDU.6.2, IDU.6.3.

## Fase F — Cierre + reconciliación (Puerta 2, leader)

- [ ] **F1** — Reconciliar deltas previos (design §0, IDU.8): nota "SUPERADA por `identificadores-unificados`" bajo `PCV.2.4` (+ refs §2c/§5) de `parto-caravana-visual-por-ternero`, `RCF.1.6` de `caravana-ficha`, y `D3` de `nombre-apodo`. NO reescribir los EARS. Cubre: IDU.8.1, IDU.8.2, IDU.8.3.
- [ ] **F2** — Folder al `design.md` baseline de spec 02 + `design.md` de spec 09 el bloque "Deltas posteriores" con puntero a este delta (bajo R4.2/R4.13 y R5). Cubre: IDU.8.4.
- [ ] **F3** — `impl_identificadores-unificados.md`: mapa `R<n> → archivo:test`. Verificar que cada IDU.<n> tiene ≥1 test. Reconciliar specs al as-built antes de commitear (memoria `feedback_correcciones_en_specs`).
- [ ] **F4** — Deploy (GATEADO a Raf): PASO 1 (frontend + schema PowerSync) → PASO 2 (migración `0122` por MCP con autorización de Raf) + coordinación del schema/sync-rules PowerSync con Raf (design §11).
