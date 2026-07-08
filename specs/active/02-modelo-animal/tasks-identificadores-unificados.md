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

- [ ] **B1** — `schema.ts`: quitar `visual_id_alt` de `animal_profiles` y `pending_animal_profiles`. Cubre: IDU.3.1.
- [ ] **B2** — `local-reads.ts`: quitar `visual_id_alt` de `LOCAL_LIST_SELECT`, `LOCAL_LIST_SELECT_OVERLAY`, la whitelist de `buildSearchLikeQuery`, y la lectura de la madre del vínculo cría-al-pie (synced + overlay). Cubre: IDU.3.2, IDU.4.5.
- [ ] **B3** — `upload.ts`: el connector deja de mapear `visual_id_alt` (INSERT/PATCH de `animal_profiles`) y `p_visual_id_alt` (replay de `create_animal`). Cubre: IDU.3.3.
- [ ] **B4** — `local-reads.ts`: `buildApodoSearchQuery(establishmentId, term)` (join `custom_attributes`+`field_definitions` por `data_key='apodo'`, scope `ap.establishment_id`, LIKE escapado sobre `value`) devolviendo `LocalListRow`. Cubre: IDU.4.4. `[unit]` test del SQL builder.
- [ ] **B5** — `local-reads.ts`: enriquecer `LOCAL_LIST_SELECT`/`_OVERLAY` con `apodo` (LEFT JOIN custom_attributes+fd) + `apodo_enabled` (LEFT JOIN `rodeo_data_config` con overlay `pending_rodeo_data_config`, subconsulta del apodo fd id) (design §8). Cubre: IDU.6.5.
- [ ] **B6** — `local-reads.ts`: `buildApodoListQuery(establishmentId)` (todos los apodos activos del campo con su `profile_id`) para el warning-soft. Cubre: IDU.5.4.

## Fase C — Clasificadores + búsqueda (utils PUROS + data-layer)

- [ ] **C1** — `animal-identifier.ts`: reescribir `SearchPlan` + `classifySearchQuery` al modelo de 3 (`tryTagExact`/`tryIdvExact`/`tryIdvSubstring`/`tryApodo`, sin `tryVisual`; idv habilitado para todo término no vacío; design §6). `[unit]` tests. Cubre: IDU.4.1, IDU.4.2, IDU.4.3, IDU.4.5.
- [ ] **C2** — `animal-identifier.ts`: colapsar `classifyIdentifier` (precarga) a destino `idv` (o eliminar si el caller ya no ramifica); idem la réplica `resolvePrefillIdentifier` en `maniobra-identify.ts`. `[unit]` tests. Cubre: IDU.4.10.
- [ ] **C3** — `animals.ts` `searchAnimals`: ejecutar el plan nuevo (tag exacto → idv exacto → idv/tag substring → apodo), quitar la rama `visual_id_alt`, dedupe por `profileId` con exactos priorizados. Cubre: IDU.4.2, IDU.4.3, IDU.4.4, IDU.4.6.
- [ ] **C4** — `link-calf-query.ts` `classifyCalfQuery`: aceptar idv alfanumérico + apodo en la rama `search` (relajar el gate `^\d+$`/`too-short`); `eid` (15 díg) intacto. `[unit]` tests. Cubre: IDU.4.7.
- [ ] **C5** — `maniobra-identify.ts`: `ManualCandidate` cambia `visualIdAlt`→`apodo`; `candidateMatchesExactly` compara idv/apodo/tag. Verificar `identificar.tsx` + `CandidatePicker.tsx` + `FindOrCreateOverlay.tsx` (búsqueda por los 3, sin visual). `[unit]` tests. Cubre: IDU.4.8, IDU.4.11.
- [ ] **C6** — Verificar que el "Bastonear" duplicate-check de ficha/alta sigue **solo-electrónica** (NO agregar canales). Cubre: IDU.4.9.

## Fase D — Frontend: hero, apodo (formato + warning), remoción de visual_id_alt

- [ ] **D1** — `animal-input.ts`: `sanitizeApodoInput` + `APODO_MAX_LENGTH` (charset design §5, incluye `ñ`/tildes por default — flag Puerta 1). `[unit]` tests (símbolos descartados, espacios/guiones OK, cap 10, `ñ`/tildes conservados). Cubre: IDU.5.1.
- [ ] **D2** — `pickHeroIdentifier` (PURO, design §10) + `[unit]` tests (prioridad apodo→idv→tag→none; secondary cuando hero=apodo). Cubre: IDU.6.1, IDU.6.4, IDU.6.6.
- [ ] **D3** — `isApodoDuplicateInField` (PURO, design §9) + `[unit]` tests (case-insensitive, trim, excluye propio, vacío no matchea). Cubre: IDU.5.4, IDU.5.6, IDU.5.7.
- [ ] **D4** — `AnimalRow.tsx`: quitar prop `visualId`; sumar `apodo`/`rodeoUsesApodo`; render por `pickHeroIdentifier` (hero + secundario muted). Cubre: IDU.3.5, IDU.6.2.
- [ ] **D5** — `animales.tsx` / `seleccion-masiva.tsx` / `asignar-caravanas.tsx` / `bulk-selection-data.ts` / `selection-display.ts`: pasar `apodo`+`rodeoUsesApodo` desde la lista enriquecida (B5); quitar `visualIdAlt`. Cubre: IDU.3.4, IDU.6.2, IDU.6.5.
- [ ] **D6** — `CustomFieldInput.tsx`: prop OPCIONAL/ADITIVA `sanitize?` en la rama `text`; el caller la setea a `sanitizeApodoInput` cuando `data_key==='apodo'`. Cubre: IDU.5.2, IDU.5.3.
- [ ] **D7** — `crear-animal.tsx` (CustomPropertiesForm): aplicar `sanitize` del apodo + el warning-soft (lectura `buildApodoListQuery` → `isApodoDuplicateInField`, aviso inline muted, no bloquea). Cubre: IDU.5.2, IDU.5.4, IDU.5.5.
- [ ] **D8** — `animal/[id].tsx`: eliminar la fila "Nombre / seña" (`visual_id_alt`); hero por `pickHeroIdentifier` (`heroLabel`); en la edición del apodo aplicar `sanitize` + warning-soft (excluye el propio, IDU.5.6). Cubre: IDU.3.6, IDU.6.3, IDU.5.3, IDU.5.4, IDU.5.6.
- [ ] **D9** — Quitar `visualIdAlt`/`visual_id_alt` de los servicios/tipos restantes: `animals.ts` (`LocalAnimalRow`/`NewAnimalInput`/`createAnimal`), `events.ts` (overlay de cría + `coalesce` del label de madre → `idv ?? tag`), `import-rodeo.ts`, `reports.ts` + `reports-format.ts` (`animalLabel(idv)` → `idv ?? 'Sin identificación'`), `AlertList.tsx`/`reportes.tsx`. Cubre: IDU.3.4.
- [ ] **D10** — Flujo de import (`normalize-row.ts`, `validate-rows.ts`, `import-write.ts`, `column-mapping.ts`, `import-ui.ts`): dejar de mapear la columna `visual_id_alt`. `[unit]` tests actualizados. Cubre: IDU.3.7.

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
