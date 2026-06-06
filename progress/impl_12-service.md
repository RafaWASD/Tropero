baseline_commit: e2ee99742fc24f675913c08bc4050904d4f91343

# impl_12-service — Feature 12 (Importación masiva de rodeo), Fase 3 service de escritura + dedup

> **Alcance de este run**: SOLO la capa I/O del import (tasks T3.1–T3.5): el service
> `app/src/services/import-rodeo.ts` que ata los utils puros (ya hechos, `app/src/utils/import/`)
> + el RPC `import_rodeo_bulk` (ya hecho/aplicado, `0074`). NO se toca backend/migraciones, NO los
> utils (solo se IMPORTAN), NO la UI (Fase 4, otro run), NO `scripts/run-tests.mjs` (lo engancha el leader).

## Feature en curso

- **Feature 12 — Importación masiva de rodeo** (`feature_list.json` id 12, `status: in_progress`, `sdd: true`).
- Spec: `specs/active/12-import-rodeo/{requirements,design,tasks}.md` (Gate 1 PASS, Puerta 1 aprobada por Raf).

## Plan (tasks de este run)

- T3.1 — dedup pre-check contra existentes (idv en animal_profiles activos + tag en animals no-soft-deleted, en LOTE).
- T3.2 — resolución de category_code (texto, NO category_id — lo resuelve el RPC) + lote por nombre → management_group_id + raza texto libre.
- T3.3 — armado del `p_rows` (shape EXACTO del header de 0074) + escritura en chunks vía RPC import_rodeo_bulk, import parcial.
- T3.4 — insert de import_log al finalizar (también 0 escritas) con error_details ACOTADO/TRUNCADO (R11.5, CHECK 256KB).
- T3.5 — guards de input: tamaño ANTES de parsear (R3.1), parse falla aborta (R3.6), escapeIlike (R3.5), offline informa sin encolar (R12.2).

## Constantes de verdad (del as-built, NO inventadas)

- Contrato `p_rows` del RPC: `row_index`, `sex`, `tag_electronic`, `birth_date`, `idv`, `visual_id_alt`,
  `breed`, `category_code`, `category_override`, `management_group_id`. El RPC NO lee
  `establishment_id`/`created_by`/`imported_by`/`species_id`/`system_id`/`rodeo_id` del payload (header `0074`).
- RPC topa 5000 filas/llamada → chunks ≤ 5000 (usamos ~150).
- import_log: `octet_length(error_details::text) ≤ 262144` (256KB, CHECK `0073`); `char_length(file_name) ≤ 255`.
- import_file_format enum: `csv` | `xlsx` | `sigsa_txt`.
- Tope de tamaño de archivo: 5 MB (R3.1, design §3 — antes de leer/parsear).
- Dedup: `animal_profiles.idv` (establishment + deleted_at null) ; `animals.tag_electronic` (deleted_at null, global).

---

## Resultado del run (2026-06-06)

**DONE — T3.1 a T3.5.** Service de I/O + lógica pura separada, siguiendo el patrón del repo
(`establishment-store.ts` ↔ `utils/establishment.ts`).

### Archivos creados

- `app/src/utils/import/import-write.ts` — **LÓGICA PURA** (sin RN/expo/supabase): merge de dedup contra
  existentes, resolución de category_code (texto, el id lo resuelve el RPC), normalización de lote,
  armado del `p_rows` (shape EXACTO del header 0074), chunking (filas + IN-list del dedup), resumen/
  truncado del error_details (presupuesto < CHECK 256KB), guard de tamaño (R3.1), escapeIlike (R3.5).
- `app/src/utils/import/import-write.test.ts` — **32 tests `node:test`** de toda la lógica pura.
- `app/src/services/import-rodeo.ts` — **ÚNICA capa I/O**: queries de dedup en lote (T3.1), resolución
  de lotes (T3.2), escritura batch vía RPC `import_rodeo_bulk` en chunks (T3.3), insert de `import_log`
  acotado (T3.4), orquestación `confirmImport` con guard de conexión (R12.2). Importa los utils puros.

### Por qué se separó la lógica pura

El intento inicial de testear `import-rodeo.test.ts` importando del service FALLÓ: el service importa
`./supabase` → `expo-secure-store` (módulo RN/expo que no carga bajo `node:test`). El patrón del repo
(verificado en `establishment-store.test.ts`) es: lógica pura en un módulo sin imports RN/expo, I/O en
el service. Refactoricé a `import-write.ts` (puro, testeable) + `import-rodeo.ts` (I/O, cubierto por la
suite del RPC `supabase/tests/import/run.cjs`). Borré el `import-rodeo.test.ts` muerto.

### Verificación

- `cd app && pnpm.cmd typecheck` **verde**.
- `import-write.test.ts` **32/32 verde** (comando abajo).
- `node scripts/check.mjs` **verde end-to-end** (sin regresión; el nuevo test todavía NO está enganchado
  en `run-tests.mjs` — lo engancha el leader, ver "Para enganchar").

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test \
  app/src/utils/import/import-write.test.ts
```

### Para enganchar (run-tests.mjs — lo hace el leader, NO lo toqué)

Agregar `app/src/utils/import/import-write.test.ts` a la línea de `client unit tests` de
`scripts/run-tests.mjs` (junto a los `app/src/utils/import/*.test.ts` ya enganchados).

## Mapa de trazabilidad `R<n> → archivo:test`

| R<n> | Qué exige | Cubierto por |
|---|---|---|
| R3.1 (rechazo por TAMAÑO ANTES de parsear) | `import-write.ts` `checkFileSize` (re-exportado del service) | `import-write.test.ts`: "dentro del tope→ok"; "borde exacto→ok"; "1 byte arriba→rechazado"; "NaN/negativo→rechazado"; "char-flood de 1 celda gigante se ataja por TAMAÑO no por filas" |
| R3.5 (neutralizar metacaracteres en filtros) | `import-write.ts` `escapeIlike` (espejo F1-1) | `import-write.test.ts`: "neutraliza %/_ y la coma de PostgREST"; "valor normal intacto" |
| R3.6 (parse falla → abortar, no escribir) | el parse vive en el hook (Fase 4); el service NO escribe si no recibe candidatas | (flujo del hook — `confirmImport` solo recibe candidatas ya parseadas/validadas) |
| R7.2 (dedup idv contra animal_profiles activos del est) | `import-rodeo.ts` `dedupAgainstExisting` (query `.in('idv')` scoped) + `mergeDedupAgainstExisting` puro | `import-write.test.ts`: "idv YA existe→saltada (duplicate_idv_existing)"; I/O cubierto por `run.cjs` (unique idv) |
| R7.3 (reportar saltadas, distinguir motivo) | `ExistingDuplicate.reason` (`duplicate_idv_existing`/`duplicate_tag_existing`) en el resultado | `import-write.test.ts`: el `skipped[]` lleva reason + value distinguibles |
| R7.4 (TAG no reusable → siempre skip) | `mergeDedupAgainstExisting` prioriza tag; query `.in('tag_electronic')` global no-soft-deleted | `import-write.test.ts`: "TAG YA existe→duplicate_tag_existing NUNCA reasignación"; "colisión tag+idv→reporta UNA vez prioridad TAG" |
| R8.1 (escritura en lote animals+profiles) | `import-rodeo.ts` `writeInChunks` → RPC `import_rodeo_bulk` | I/O cubierto por `run.cjs` ("owner importa 2 filas→inserta animals+profiles") |
| R8.2 (import parcial, no all-or-nothing) | `writeInChunks` por-chunk + `accumulateChunk` puro; un chunk con error no aborta los demás | `import-write.test.ts`: "accumulateChunk suma sin mutar / tolera errors undefined"; I/O `run.cjs` ("TAG dup en batch→se saltea, resto entra") |
| R8.4 (carrera unique server-side → error de fila) | el RPC saltea unique_violation por fila → `errors[]`; `accumulateChunk` los mapea | I/O `run.cjs` ("TAG dup→1 error 2 ok"); `import-write.test.ts`: mapeo row_index→index |
| R9.1 (establishment_id del contexto, no del archivo) | `confirmImport` recibe `establishmentId` del contexto; el `p_rows` NO lo incluye | `import-write.test.ts`: "buildRpcRow NO incluye establishment_id" |
| R9.2 (rodeo∈establishment) | el RPC deriva est del rodeo + valida; el cliente solo manda `p_rodeo_id` | I/O `run.cjs` ("p_rodeo_id de otro est→RECHAZADO") |
| R9.3 (autoría forzada server-side) | `insertImportLog` OMITE `imported_by` (trigger 0073 lo fuerza); el `p_rows` no lleva `created_by` | `import-write.test.ts`: "buildRpcRow NO incluye imported_by/created_by"; I/O `run.cjs` (imported_by forzado) |
| R10.3 (categoría columna→code+override true) | `resolveCategory` puro → `category_code` + `category_override=true`; el RPC resuelve el id | `import-write.test.ts`: "categoría con texto→code normalizado+override=true"; "tildes/espacios→code" |
| R10.4 (lote por nombre→id, no crear) | `import-rodeo.ts` `resolveLotes` (match por nombre normalizado, no insert) + `normalizeLoteName` puro | `import-write.test.ts`: "normalizeLoteName lowercasea/sin tilde/colapsa"; "vacío→null"; I/O: solo SELECT, nunca INSERT de lote |
| R10.5 (sin columna/sin match→placeholder, no inferir) | `resolveCategory(null)`→`code=null`+`override=false`; el RPC pone placeholder por sexo | `import-write.test.ts`: "sin categoría→null+override=false"; "vacía→null+false" |
| R11.1 (import_log con conteos + error_details + file_name/format/rodeo) | `import-rodeo.ts` `insertImportLog` | I/O cubierto por `run.cjs` (insert + RLS) |
| R11.5 (acotar error_details bajo el CHECK octet_length) | `import-write.ts` `summarizeErrorDetails` (resumen por motivo + sample + recorte iterativo por bytes) | `import-write.test.ts`: "pocos→completo"; "más que sample→acotado+truncated"; **"5000 errores con sqlerrm largos ÚNICOS→NUNCA supera el presupuesto"**; "0 errores→vacío válido"; "byteLengthUtf8 cuenta bytes (multibyte)" |
| R12.2 (offline al confirmar→informar, NO encolar) | `confirmImport` `resolveOnline` (probe inyectable) → `kind:'offline'` sin escribir | (lógica de `confirmImport`; el probe real lo inyecta el hook con NetInfo en Fase 4) |
| R5.6 (0 válidas→informar, no log de éxito vacío) | `confirmImport` con 0 candidatas inserta log con `imported_ok=0` (no >0) | `import-write.test.ts`: "0 errores→audit vacío válido"; lógica del flujo |
| T3.1 (dedup EN LOTE, no N queries; URL-safe) | `dedupAgainstExisting` 2 queries `.in()` + `chunkRows(ids, DEDUP_IN_CHUNK)` | `import-write.test.ts`: "uniqueNonEmpty dedup"; "parte el .in() en sub-lotes URL-safe (pocas queries)" |
| T3.3 (chunks ≤ tope RPC 5000) | `chunkRows(rpcRows, CHUNK_ROWS=150)` | `import-write.test.ts`: "CHUNK_ROWS ≤ 5000"; "6000 filas→chunks ≤5000" |

## Autorrevisión adversarial (paso 8)

Pasada hostil sobre el propio código antes del reviewer. Qué busqué / qué encontré / cómo lo cerré:

1. **¿El guard de tamaño corre ANTES de parsear?** — `checkFileSize` es PURO y la primera barrera del
   flujo; lo expongo (re-export del service) para que el hook (Fase 4) lo llame ANTES de leer el
   contenido. El service no controla el orden del hook, pero provee la barrera + un test que prueba el
   char-flood de 1 celda gigante (50 MB) se ataja por TAMAÑO (el cap de FILAS del parser NO lo cubriría).
   Documentado en el header y en "Para Fase 4".
2. **¿El `p_rows` filtra algún campo forzado server-side?** — NO. `buildRpcRow` arma EXACTAMENTE los 10
   campos del header 0074; un test enumera las keys y FALLA si aparece `establishment_id`/`category_id`/
   `created_by`/`imported_by`/`species_id`/`system_id`/`rodeo_id`. El cliente manda `category_code`
   (texto), no el id — lo resuelve el RPC (incl. placeholder por sexo R10.5 + override forzado).
3. **¿El dedup es por LOTE (no N queries)?** — Sí: 2 queries base (idv + tag). **Encontré un riesgo**: un
   `.in($array)` con hasta 5000 valores arma un query-string que puede exceder el límite de URL de un GET
   de PostgREST. **Corregido**: parto la IN-list en sub-lotes de `DEDUP_IN_CHUNK=500` → unas pocas queries
   (10 para 5000 ids), URL-safe, SIGUE siendo en lote (no por fila). Test agregado.
4. **¿El error_details truncado rompe el CHECK?** — NO. `summarizeErrorDetails` presupuesta a 200 KB
   (< 262144 del CHECK de 0073) y recorta el sample iterativamente; si el peor caso (5000 motivos
   `sqlerrm` largos y ÚNICOS → by_reason explota) aún no entra, recorta también by_reason a sample vacío.
   Test CRÍTICO: 5000 errores con motivos largos+únicos → el JSON serializado SIEMPRE ≤ presupuesto.
   `byteLengthUtf8` cuenta BYTES UTF-8 (no chars) alineado al `octet_length` del CHECK (test del 'ñ'=2B).
5. **¿Un archivo sin conexión informa sin encolar?** — `confirmImport` chequea `resolveOnline` ANTES de
   tocar la DB → `kind:'offline'` sin escribir ni encolar (R12.2, online por diseño). El probe es
   inyectable (el hook le pasa NetInfo); default = `navigator.onLine` (web) / online-si-indeterminable
   (RN sin NetInfo → la escritura fallaría con `kind:'network'` y se reporta, no bloqueo por falso-offline).
6. **¿El dedup contra existentes hace UPDATE?** — NUNCA. `mergeDedupAgainstExisting` solo particiona en
   `toWrite`/`skipped`; las saltadas no van al RPC. TAG no reusable (R7.4): colisión de tag = siempre skip.
7. **¿La query de tag leakea datos cross-tenant?** — Corre bajo la RLS del usuario y solo SELECT-ea la
   columna `tag_electronic` (unique global por SENASA, sin filtro de est). Un tag de OTRO tenant da
   falso-negativo (el usuario no lo ve) → lo ataja el unique global en el insert (R8.4). NO uso
   service-role para anticiparlo (sería el leak cross-tenant que LOW-1 prohíbe explícitamente).
8. **¿Import parcial real?** — `writeInChunks`: un chunk con errores se acumula y sigue; un chunk con
   fallo de red SOLO aborta si es el primero y nada se escribió (offline real), si no reporta sus filas
   como error y sigue. `accumulateChunk` no muta el acumulado previo (test). Con 0 candidatas tras el
   dedup, igual se inserta el `import_log` (R5.6, audit de la corrida) con `imported_ok=0` (no >0).
9. **Columnas/filtros contra el as-built** — verifiqué `animal_profiles.idv` + `deleted_at` (0020),
   `animals.tag_electronic` + `deleted_at` (0019), `management_groups.deleted_at` + `name` (0037), enum
   `import_file_format` + CHECKs de 0073, shape `makeRow` del runner del RPC = mi `RpcRow`. Todo alineado.
10. **Multi-tenant / hardcode** — `establishment_id`/`rodeo_id` vienen del input (contexto activo), NUNCA
    hardcodeados; el RPC deriva est/species/system del rodeo. `check-hardcode.mjs` no aplica a services
    (solo `app/app/**` + `components/**`), pero igual no hay hex/px ni UUID literal.

## Desviaciones del spec / decisiones menores

- **Ninguna desviación de contrato.** El shape del `p_rows` y el del resultado del RPC son los del header
  de 0074. La categoría va como `category_code` (texto) por diseño explícito del header (el RPC resuelve
  el id + placeholder server-side), NO como `category_id` — coincide con el brief.
- **Default menor (DEDUP_IN_CHUNK=500)**: tamaño de sub-lote de la IN-list del dedup, para no exceder el
  límite de URL. No es arquitectónico (no se referencia en 6 meses como patrón) → default + comentario,
  sin ADR.
- **`confirmImport` (orquestación)**: tie de T3.1→T3.4 que el hook (Fase 4) llama tras la confirmación
  (R5.5). Es I/O-orchestration → vive en el service (no en el hook). El hook hace el parse/normalize/
  validate (utils puros) + preview, y le pasa las `candidates` + el `isOnline` (NetInfo).

## Para Fase 4 (UI/hook) — qué deja este run

- El hook `useImportRodeo` debe: (1) pick archivo → **llamar `checkFileSize(size)` ANTES de leer/parsear
  (R3.1)**; (2) leer contenido → `parseCsv`/`parseSigsaTxt` (+ `breedNameFromCode` para el path SIGSA);
  (3) CSV → `autoDetectMapping` + override → extraer celdas por `columnIndexFor`; (4) `normalizeRow` por
  fila → `validateRows`; (5) construir las `CandidateRow[]` (índice + NormalizedRow de las `valid`);
  (6) preview (válidas/errores/intra-dup) + `dedupAgainstExisting` para el preview de dup-contra-existente
  (R5.3/R5.4); (7) confirmación (R5.5) → `confirmImport({ ..., isOnline: NetInfo })`.
- El probe `isOnline` real (NetInfo) lo inyecta el hook. El service trae un default `navigator.onLine`.
- El resultado `ImportRunResult` (total/ok/errores/skippedExisting/writeErrors/importLogId) alimenta
  `ImportResultScreen` (R8.3).

## NO marco `done` yo

Espera al reviewer + Gate 2 (code). El `.xlsx` (R3.8) sigue diferido a otro run (no es parte de Fase 3).
