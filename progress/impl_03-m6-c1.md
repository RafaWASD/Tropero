baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

# impl 03 — M6-C.1 — Cablear la maniobra Circunferencia escrotal (CE) al flujo real de MODO MANIOBRAS

Feature `03-modo-maniobras` (in_progress). Chunk **M6-CLIENTE / M6-C.1**. Frontend puro (write-path local + 3 módulos puros + wiring del frame). El **backend M6 ya está APLICADO al remoto** (0098/0099/0100 live — suite `supabase/tests/scrotal/run.cjs` 12/12 verde = oráculo server). El design spike de la rueda (v2) **ya está APROBADO por Raf** (`CircunferenciaEscrotalStep.tsx` + `WheelPicker.tsx` + `wheel-picker.ts`) → lo ENCHUFO, no lo rediseño. Gate 1 N/A (frontend); Gate 2 después.

## Verificación de partida
- `node scripts/check.mjs` rojo SOLO por el flake conocido `animals_tag_unique` (23505) de la suite backend `animal/run.cjs` (terminales paralelas contra DB compartida — memoria `reference_check_red_rate_limit` + history). NO es regresión: M6-C.1 es frontend + write-path; no toca el alta de animales.
- `supabase/tests/scrotal/run.cjs` 12/12 VERDE → backend M6 confirmado live en remoto (tabla, data_key global, seed cría, gating fail-closed, CHECK rango, audit anti-spoof, RLS, append-only, WAL, session_id no-bypass).

## Estado heredado del working-tree (chunks previos M6-BACKEND + M6-C.0, sin commitear)
- `schema.ts` Table `scrotal_measurements` (CRUD-plano), `sync-streams/rafaq.yaml` stream `ev_scrotal_measurements`, `upload-rejections.ts` label "Circunferencia escrotal" → YA presentes (§12.5 de M6-BACKEND). NO los reescribo.
- `CircunferenciaEscrotalStep.tsx` + `WheelPicker.tsx` + `wheel-picker.ts` → componente aprobado. Lo enchufo.
- migraciones 0098/0099/0100 untracked (deploy-gate del leader; ya aplicadas al remoto).

## Plan (T1..Tn)
- **T1** `maneuver-gating.ts`: `'circunferencia_escrotal'` en `ManeuverKind` + `MANEUVER_DATA_KEY_REQS` (`{dataKeys:['circunferencia_escrotal'], match:'all'}`). `ALL_MANEUVERS` y `MANEUVER_DATA_KEYS` se derivan solos. + test.
- **T2** `maneuver-step-kind.ts`: StepKind `'rueda'` + mapeo `circunferencia_escrotal → 'rueda'` (factory-only). + test.
- **T3** `maneuver-applicability.ts`: `isCastrated: boolean | null` en `AnimalApplicabilityInfo` + `BULL_ENTIRE_CATEGORY_CODES = {torito, toro}` + `case 'circunferencia_escrotal'` (categoría ∈ {torito,toro} ∧ isCastrated !== true; null → incluye R14.3). + test.
- **T4** `maneuver-sequence.ts`: variante `{ kind:'scrotal'; circumferenceCm; ageMonths }` en `StepValue` + `describeStepValue` (es-AR). + test.
- **T5** `maneuver-event-query.ts`: `case 'scrotal'` → `buildAddScrotalInsert` (sin corrección in-place por ahora — paridad con la 1ra captura; la corrección R14.17 desde la ficha es M6-C.2). + test.
- **T6** write-path: `app/src/services/scrotal.ts` (`addScrotalMeasurement`) + `buildAddScrotalInsert`/`buildScrotalHistoryQuery` en `local-reads.ts`. + tests de builders.
- **T7** `carga.tsx`: `case 'rueda':` → `CircunferenciaEscrotalStep` con `initialCm` (última medida local de `buildScrotalHistoryQuery` o 36) + `ageMonths` (prefill de `birthDate` con `prefillAgeMonths`); `toApplicabilityInfo` suma `isCastrated`. El frame lee la última CE.
- **T8** Polish del campo editable: suprimir el outline naranja default del navegador (web focus) usando token verde/`$primary`. Sin hardcode.
- **T9** e2e + capturas 360/412 web táctil de la CE en el flujo real + verificación de la fila server.
- **T10** autorrevisión adversarial + reconciliación design §12 (AS-BUILT) + tasks M6-C.1 [x].

## Qué se cableó (T1–T8)
- **T1 `maneuver-gating.ts`**: `circunferencia_escrotal` en `ManeuverKind` + `MANEUVER_DATA_KEY_REQS` (`{dataKeys:['circunferencia_escrotal'],match:'all'}`). `ALL_MANEUVERS`/`MANEUVER_DATA_KEYS` derivan → ahora 13 maniobras.
- **T2 `maneuver-step-kind.ts`**: `StepKind 'rueda'` + `circunferencia_escrotal → 'rueda'` (factory-only; el render genérico M5 custom NO lo usa).
- **T3 `maneuver-applicability.ts`**: `isCastrated:boolean|null` en `AnimalApplicabilityInfo` + `BULL_ENTIRE_CATEGORY_CODES={torito,toro}` (verificado en `animal-category.ts`: castrados = novillito/novillo) + `case 'circunferencia_escrotal'` (categoría ∈ {torito,toro} ∧ isCastrated !== true; null=desconocida → INCLUYE R14.3; categoría null → se salta).
- **T4 `maneuver-sequence.ts`**: variante `StepValue { kind:'scrotal'; circumferenceCm; ageMonths }` + `describeStepValue` es-AR (reusa `formatCmAR`).
- **T5 `maneuver-event-query.ts`**: `case 'scrotal'` → INSERT (`buildAddScrotalInsert`) / UPDATE de corrección (`buildUpdateManeuverScrotal`, isCorrection).
- **T6 write-path**: `app/src/services/scrotal.ts` (`addScrotalMeasurement` + `fetchScrotalHistory`/`fetchLastScrotalCm`) + builders en `local-reads.ts` (`buildAddScrotalInsert`/`buildUpdateManeuverScrotal`/`buildScrotalHistoryQuery`). `establishment_id`/`recorded_by`/`source` los FUERZA el trigger (no se mandan; CRUD-plano sin RPC).
- **T7 `carga.tsx`**: `case 'rueda':` → `CircunferenciaEscrotalStep`; `initialCm`= corrección en curso, o última medida (`fetchLastScrotalCm`, leída en el frame al conocer el perfil), o 36; `ageMonths`= corrección en curso, o `prefillAgeMonths(animal.birthDate)`. `toApplicabilityInfo` suma `isCastrated`.
- **T8 polish**: el `<input>` editable suprime el outline naranja del UA web en foco (`outlineStyle:'none'`/`outlineWidth:0`, web-only) → tratamiento verde = borde `$divider→$primary` de la caja (sin hardcode). Verificado en `ce-flujo-input-412.png` (borde verde, sin outline naranja).

## Trazabilidad R<n> → test
- **R14.1** (CE ofrecida, gateada) → `maneuver-gating.test.ts` ("la CE single-key APLICA si enabled; NO si off/ausente" + "filterApplicableManeuvers"); e2e `maniobra-circunferencia-escrotal.spec.ts` ("TORITO entero … aparece en la secuencia").
- **R14.2** (solo machos enteros no-ternero) → `maneuver-applicability.test.ts` ("CE APLICA a torito/toro", "NO a hembra/ternero/novillo", "is_castrated=true → no"); e2e ("CE NO aparece para HEMBRA ni TERNERO", "castrado la saltea").
- **R14.3** (castración desconocida → incluye) → `maneuver-applicability.test.ts` ("castración DESCONOCIDA (null) … INCLUYE"); e2e ("castración desconocida … la INCLUYE").
- **R14.4** (saltea-y-sigue, mismo patrón raspado) → `maneuver-applicability.test.ts` ("filterByAnimalApplicability saca la CE … preserva el resto y el orden" + "secuencia: TORO entero … la hembra la saltea"); e2e (secuencia vacía → "Sin maniobras para este animal").
- **R14.5** (rueda, inicial=última o 36) → `wheel-picker.test.ts` (preexistente, snap/grilla); `local-reads.test.ts` (`buildScrotalHistoryQuery` más reciente primero); e2e (rueda visible, campo editable + teclado "38,5").
- **R14.6** (edad prellenada de birth_date) → `wheel-picker.test.ts` (`prefillAgeMonths`, preexistente); e2e ("≈ N meses" en la pill cuando hay birth_date).
- **R14.7** (edad ajustable + puede quedar desconocida) → e2e ("Edad sin definir" sin fecha → sheet → "Usar esta edad" → "≈ N meses"); `maneuver-event-query.test.ts` ("CE con edad DESCONOCIDA (null) → age_months null").
- **R14.8** (snapshot edad, nullable) → `maneuver-sequence.test.ts` (describe con/sin edad); `local-reads.test.ts` (age null preservado); e2e (server `ageMonths` no nulo cuando hay edad).
- **R14.9** (establishment_id/recorded_by forzados) → `maneuver-event-query.test.ts` + `local-reads.test.ts` (el INSERT NO manda establishment_id/recorded_by); e2e oráculo server (`establishmentId === establishmentId`, `recordedBy === user.id`).
- **R14.10** (CRUD-plano, client UUID, offline, sin RPC) → `local-reads.test.ts` (INSERT plano, 6 placeholders, node:sqlite ejecución real); `maneuver-event-query.test.ts` (1ra captura = INSERT con session_id); e2e (fila en `scrotal_measurements` post-sync).
- **R14.17** (corrección append-only por edición) → `maneuver-event-query.test.ts` ("CE CORRECCIÓN → UPDATE … por id, NO re-INSERT"); `local-reads.test.ts` (`buildUpdateManeuverScrotal` filtra deleted_at).

## Autorrevisión adversarial
Pasada hostil sobre el propio código antes del reviewer:
- **Buscado: desviación del spec.** R14.1–R14.10 + R14.17 todos cubiertos con ≥1 test concreto (mapa arriba). El único añadido fuera del plan (`buildUpdateManeuverScrotal`) es consistente con las otras maniobras (paridad `buildUpdateManeuverWeight`) y reconciliado en design §12.4 + tasks AS-BUILT.
- **CAZADO — fixture e2e errónea (ternero):** el primer e2e falló porque seedeé un `ternero` SIN `birth_date` → el espejo client-side (`computeCategoryCode`, RT2.20) recomputa la categoría por sexo+birth_date+is_castrated (NO por el `category_code` guardado) → un macho sin fecha cae a `torito` (default conservador) → la CE aplicaba. CERRADO: el ternero del test ahora tiene `birth_date` reciente (~4 meses) → el espejo lo computa `ternero` → la CE se saltea de verdad. Esto NO es un bug del código (la regla `BULL_ENTIRE_CATEGORY_CODES ∋ torito` es correcta; el espejo es el as-built); fue una suposición errónea de la prueba. Re-corrido 3/3 verde.
- **Edge: corrección vs última medida.** En `carga.tsx` el `initialCm`/`ageMonths` priorizan la captura EN CURSO (`captured?.kind==='scrotal'`) sobre la última medida/prefill → al corregir desde el resumen la rueda re-abre con lo capturado, no con la medida histórica. Verificado por lectura del dispatcher.
- **Edge: lectura de última CE falla / animal sin CE.** `fetchLastScrotalCm` devuelve null en error o sin filas (`emptyIsSyncing:false` → [] no degrada) → la rueda arranca en 36 (CE_DEFAULT_CM). No rompe la carga.
- **Edge: age null.** El builder y el StepValue propagan `age_months` null (R14.7/R14.8) — testeado en builder + event-query + describe + e2e (entero sin fecha → ajusta → snapshot).
- **Seguridad.** El cliente NUNCA es autoridad: `establishment_id`/`recorded_by` los fuerza el trigger server-side (verificado por el oráculo e2e: ambos === lo esperado, no spoofeables); gating capa 2 fail-closed + session_id tenant-check re-validan al subir (backend suite 12/12). La aplicabilidad es UX (R14.3 incluye desconocida) — documentado "no es seguridad". Sin RPC nueva, sin hardcode de establishment_id (anti-hardcode 0).
- **Tests que pasan por la razón correcta.** El e2e verifica la FILA server real (no solo UI); la aplicabilidad verifica el skip REAL (secuencia vacía → "Sin maniobras"); el caso desconocida verifica que la CE APARECE; el campo editable se ejercita tipeando "38,5" + Enter + assert del valor.
- **No-bypass de la categoría null.** `appliesToAnimal('circunferencia_escrotal', {categoryCode:null})` → false (no se ofrece la CE a un animal sin categoría resuelta) — testeado.

## Reconciliación de specs
- **`design.md §12.4`** — AS-BUILT M6-C.1: documentado `buildUpdateManeuverScrotal` (corrección R14.17, paridad weight) + `fetchScrotalHistory`/`fetchLastScrotalCm` (lectura del frame para el initialCm) + el `StepValue {kind:'scrotal'}` + `describeStepValue` es-AR + el polish del outline del campo editable. El resto del §12.1/§12.2/§12.4 ya describía el as-built (escrito por spec_author + reconciliado en M6-C.0).
- **`tasks.md M6-C.1`** — `[x]` + bloque AS-BUILT (qué se cableó, el builder extra, ALL_MANEUVERS 12→13, verificación, capturas).
- **`requirements.md`** — NO se tocó: los EARS R14.1–R14.10/R14.17 se cumplen tal como están escritos (sin cambio del *qué*). No hubo reconciliación de requirement.
- **Numeración**: `ALL_MANEUVERS.length` pasó de 12 a 13 → los tests exhaustivos (gating "cubre las 12"→13, step-kind "TODA maniobra (12)"→13, wizard label-count derivado) actualizados.

## Cabos para el leader (Gate 2)
- **Gate 2 (security code)** sobre el delta M6-C.1: frontend puro + write-path CRUD-plano. El cliente NO es autoridad — `establishment_id`/`recorded_by`/`source` forzados server-side (verificado e2e), gating capa 2 fail-closed + session_id tenant-check ya gateados (Gate 1 PASS + backend suite 12/12). Sin RPC nueva, sin hardcode. El `buildUpdateManeuverScrotal` filtra `deleted_at IS NULL` + la RLS UPDATE owner|recorded_by es la barrera (R14.17). Sin inputs nuevos sin cota (la CE viene de la rueda acotada [20,50]/0,5 + el CHECK del DB; la edad de la rueda [6,120] + CHECK age_months 0..600).
- **`scrotal_measurements` ya en `MANEUVER_TABLE_LABELS`** (M6-BACKEND) → un rechazo de sync se surfacea (R10.8).
- **NO marqué la feature done.** Pendiente reviewer + Gate 2 + Puerta 2 humana. M6-C.2 (tarjeta de tendencia en la ficha) queda fuera de este chunk.
- Las migraciones 0098/0099/0100 + la suite scrotal + el componente siguen untracked (deploy-gate del leader; ya aplicadas al remoto). NO hice `git add -A`. NO toqué spec-08 ni `feature_list.json`.

## Reconciliación post-seed M6 — la plantilla de cría 26 → 27 (regresión real del seed 0099, 2026-06-18)

**Distinta del flake `animals_tag_unique`.** El seed `0099` (R14.18, ya live en el remoto) habilitó `circunferencia_escrotal` por defecto en cría → la plantilla de cría subió de **26 → 27** filas y los enabled de **23 → 24** (la CE nace `default_enabled=true`, no apagada). Verificado contra el remoto antes de tocar nada: `field_definitions` activos globales = 27; `system_default_fields` de cría = 27 (24 enabled, OFF = `inseminacion`/`peso_nacimiento`/`tuberculosis`); `rodeo_data_config` de un rodeo de cría (pre-poblado por el trigger `tg_rodeos_seed_data_config` 0018) = 27 (24 enabled). Varias count-assertions vivas de la suite spec-02 `supabase/tests/animal/run.cjs` hardcodeaban `26`/`23` → fallaban `27 != 26` / `24 != 23`. La suite es de spec-02 pero la rompió MI seed M6 → reconciliarla es correcto.

**Archivos/líneas tocados (todos los conteos VIVOS de la plantilla de cría):**
- `supabase/tests/animal/run.cjs` — **13 conteos** `26→27` / `23→24` (4 asserts de filas, 2 de enabled, + el guard de idempotencia 52→54) + **5 comentarios** alineados, todos con nota `// +1 por circunferencia_escrotal (spec 03 R14.18, seed 0099)`:
  - setup: línea 270 (comentario), 275 (filas 26→27), 276 (enabled 23→24).
  - R2.6 nuevo establishment: 617 (comentario), 621 (filas), 622 (enabled).
  - T2.16 Caso 1 (catálogo global activos): 888 (comentario), 891 (27 field_definitions activos).
  - T2.16 Caso 2 (system_default_fields cría): 896 (comentario), 902 (filas), 903 (enabled). `offKeys` (905) NO se tocó: las 3 OFF siguen igual (la CE es enabled).
  - T2.16 Caso 4 (pre-populate): 914 (comentario), 917 (filas), 918 (enabled).
  - T2.16 Caso 6: 932 (comentario "los 27 ya están").
  - T2.16 Caso 8 (CASCADE, rodeo fresco): 960 (before.count 27).
  - create_rodeo Caso 1: 2510 (comentario), 2513 (filas, assert + mensaje).
  - create_rodeo Caso 2 (idempotencia): 2554 (filas 26→27 + guard "no 52" → "no 54").
  - spec 13 prep (otro rodeo): 2654 (comentario "las 27 filas").
- `app/src/utils/rodeo-template.ts:13` — comentario "el cliente NO debe re-escribir las **27** filas" (conteo VIVO de las filas pre-pobladas que el diff respeta).
- `app/app/maniobra/_components/CircunferenciaEscrotalStep.tsx:3-6` — corregido el comentario STALE del header (decía "NO está cableado a carga.tsx … eso es M6-C.1"; ya quedó cableado en M6-C.1 — ahora describe el `case 'rueda':` real con initialCm/ageMonths/onConfirm→addScrotalMeasurement).
- `specs/active/03-modo-maniobras/design.md §12.4` — nota AS-BUILT de la reconciliación (plantilla 26→27, qué se tocó, qué quedó histórico-intacto).

**Referencias HISTÓRICAS dejadas SIN tocar (describen el origen del seed de spec-02, no el conteo vivo):**
- `supabase/migrations/0018_field_template_and_rodeo_config.sql:27,87` — describen lo que ESA migración literalmente seedea (26 filas). La CE entró por 0099, no por 0018. Cambiarlas haría que el comentario MIENTA sobre lo que hace 0018.
- `CONTEXT/04-modelo-datos.md:73` — "seed MVP: 26 fields de cría (TENTATIVO)" — ejemplo ilustrativo del modelo de datos / origen spec-02.
- `specs/active/02-modelo-animal/{tasks,requirements,design}.md` — spec-02 es dueña del seed original de 26; sus EARS/tasks/aceptación describen el seed de spec-02. Por la regla del brief NO se reescriben los EARS de spec-02; la reconciliación del conteo vivo vive en el design de spec-03 (la feature que introdujo el cambio).
- `progress/*` (history, impl_02, review_02, impl_15, review_15, plan, security_spec_03, review_03-m6-c1) — bitácoras históricas inmutables. `review_03-m6-c1.md` ya describe esta misma regresión (26→27) correctamente.
- `supabase/migrations/0099_scrotal_data_key_and_seed.sql:15,17` — "23 chars": es el LARGO del string `circunferencia_escrotal`, no el conteo de la plantilla. Match coincidente, irrelevante.

**Estado de `node scripts/check.mjs` (honesto):**
- (a) Todas las regresiones `27 != 26` / `24 != 23` de la plantilla de cría: **ARREGLADAS** (los bloques T2.16, setup, create_rodeo idempotencia ahora pasan).
- (b) Queda SOLO el flake conocido `animals_tag_unique` (23505): 2 "failing" reportados = el leaf `R2: INPUT-1 CHECK … borde 64` (`run.cjs:1924`) + su suite padre `spec 13 — INPUT-1 / A1-1 / F1-1` (cascada del hijo, no un 2do fallo independiente). 107 pass / 2 fail.
- (c) Otro rojo inesperado: **ninguno**.
- **Confirmación del flake**: el assert que falla usa el TAG literal `exact = '9'.repeat(64)` (`'9'×64`, línea 1922-1924), NO RUN_TAG-namespaced → dos terminales paralelas (la otra en spec-08) chocan en `tag_electronic` global-unique contra la DB compartida → 23505. Es el mismo flake del baseline M6-C.1 (`reference_check_red_rate_limit`), no una regresión nueva ni una colisión de RUN_TAG.
