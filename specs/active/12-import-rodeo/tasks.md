# Spec 12 — Importación masiva de rodeo — Tasks

**Status**: spec_ready (pendiente Puerta 1 + Gate 1).
**Fecha**: 2026-06-06 (sesión 23).
**Fuente**: `requirements.md` + `design.md` de esta spec.

> Orden: **parser/validación puros (testeables sin I/O) primero**, luego DB (`import_log` + RPC condicional), luego el service de escritura, luego UI, luego entry point. Cada task lleva `[ ]` y los `R<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza si queda `[ ]` sin justificación documentada. Trazabilidad `R<n> → archivo:test` en `progress/impl_12-import-rodeo.md`.
>
> **Migrations**: número TBD-al-implementer, **siguiente libre tras `0072`** (≥ 0073). NO reclamar números usados.
> **Tests del cliente**: los utils puros corren bajo `node:test` (mismo patrón que `parser-rs420.ts` / `src/utils/*` — sin react-native, sin I/O). Los tests de RLS/RPC son runners Node (ADR-012, `supabase/tests/`).

## Fase 0 — Decisiones de Puerta 1 (pre-requisito, no es código)

- [ ] T0.1 — Confirmar con Raf los defaults abiertos del design §9 antes de implementar: D1 (`.xlsx` sí/no en MVP), D2 (inserts directos vs RPC bulk → determina si la Fase 3b aplica), D3 (categoría placeholder "a completar"), D4 (topes 5 MB / 5000 filas). Cubre: decisiones de diseño bloqueantes de R3, R10.5, §6.

## Fase 1 — Parser + validación puros (testeable sin I/O)

> **Run 1 (2026-06-06) — utils PUROS T1.1–T1.12 DONE** (`progress/impl_12-utils.md`, 72 tests `node:test` verdes + typecheck verde). 6 módulos en `app/src/utils/import/`: `parse-csv`, `parse-sigsa-txt`, `breed-senasa`, `column-mapping`, `normalize-row` (reusa el `parser-rs420.ts` REAL), `validate-rows`. **EXCEPCIÓN: el parseo `.xlsx` NO entra en este run** — necesita la librería SheetJS vetada (R3.8) y este run NO agrega dependencias. Queda para un run posterior: `parse-xlsx.ts` (R3.8 — SheetJS CDN ≥0.20.2, cap de dimensiones de hoja antes de iterar). Los tests de Fase 1 **todavía NO están enganchados** en `scripts/run-tests.mjs` (el leader los engancha — evita colisión con el run paralelo de backend; correr a mano con el comando del run mientras tanto). El enganche es parte de **T6.1**.

- [x] T1.1 — `app/src/utils/import/parse-csv.ts`: parser CSV (split líneas + comillas/escapes) → `{ headers, rows }`, con **cap de filas (MAX_ROWS) y celdas durante la lectura** (no después). Sin dependencias pesadas; si hace falta robustez, `papaparse` vetada (design §4). Cubre: R3.2, R3.3, R4.1.
- [x] T1.2 — Test (`node:test`): CSV bien formado → headers + filas correctas; CSV con comillas/comas internas; archivo con > MAX_ROWS → corta y señala excedido (no trunca silencioso). Cubre: R3.2, R3.3.
- [x] T1.3 — `app/src/utils/import/parse-sigsa-txt.ts`: parser del TXT SIGSA (`RFID-SEXO-RAZA-MM/AAAA;…`) **por posición** (la `H` es Hembra en pos SEXO / Hereford en pos RAZA — leer por orden, no por contenido). Cubre: R6.2, R10.1.
- [x] T1.4 — Test: TXT válido del ejemplo del manual → filas con RFID/sexo/raza/fecha; registro malformado → fila con error, no rompe el resto. Cubre: R6.2, R3.6.
- [x] T1.5 — `app/src/utils/import/breed-senasa.ts`: tabla de los 32 códigos SENASA (seed inline desde `specs/active/08-export-sigsa/razas-senasa-codigos.md`) → nombre legible; código desconocido → devolver el código tal cual. Cubre: R6.2.
- [x] T1.6 — Test: `AA`→"Aberdeen Angus", `H`→"Hereford", `OR`→"Otra Raza"; código fuera de tabla → se conserva. Cubre: R6.2.
- [x] T1.7 — `app/src/utils/import/column-mapping.ts`: auto-detección de headers → campo del censo (`tag_electronic`/`idv`/`visual_id_alt`/`sex`/`birth_date`/`breed`/`category`/`lote`) por coincidencia de nombre + API para aplicar el mapeo manual del operador. *(Sinónimos TENTATIVOS — disclaimer planilla real.)* Cubre: R4.1, R4.2.
- [x] T1.8 — Test: headers conocidos (`caravana`, `sexo`, `nacimiento`, `raza`, `categoria`, `lote`) → mapeo esperado; header ambiguo → sin mapear (el operador decide); override manual respetado. Cubre: R4.1, R4.2.
- [x] T1.9 — `app/src/utils/import/normalize-row.ts`: normaliza por fila — sexo tolerante → `male`/`female` (R4.3); fecha `DD/MM/AAAA`/`MM/AAAA`/`AAAA` → `YYYY-MM-DD` o `NULL` (R4.4); TAG vía `normalizeTag`+`isValidTag` de `app/src/services/ble/parser-rs420.ts` (R4.5); aplica **topes de largo** por campo (espejo de 0070: idv/visual/breed/coat≤64, entry_origin≤120, notes≤4000) (R3.4). **Reusa el parser real, no un módulo fantasma.** Cubre: R3.4, R4.3, R4.4, R4.5, R6.
- [x] T1.10 — Test: sexo `M`/`macho`/`toro`/`H`/`vaca` → enum correcto; sexo basura → marca error; fecha en los 3 formatos + fecha inválida → NULL; TAG válido 15 díg → se acepta, TAG inválido → se descarta (fila cae a otro id o error); campo > tope → error de fila. Cubre: R3.4, R4.3, R4.4, R4.5.
- [x] T1.11 — `app/src/utils/import/validate-rows.ts`: reglas de validez por fila (≥1 identificador no vacío ADR-005 R5.1; sexo presente y mapeable R5.2) + **dedup intra-archivo** (grupos por `idv`/`tag` repetido → conflicto "a completar" R7.1) → produce `{ valid[], errors[] (por motivo), intraDuplicates[] }`. Cubre: R5.1, R5.2, R7.1.
- [x] T1.12 — Test: fila sin ningún id → error "a completar"; fila sin sexo → error; dos filas mismo `idv` → ambas marcadas conflicto; dos filas mismo `tag` → conflicto; fila válida pasa. Cubre: R5.1, R5.2, R7.1.

## Fase 2 — Backend: `import_log` (+ RPC condicional según D2)

- [x] T2.1 — Migration `0073_import_log.sql` (≥0073): tabla `import_log` + enum `import_file_format` + índice por establishment + trigger `tg_force_imported_by_auth_uid` (fuerza `imported_by = auth.uid()`) + CHECK `char_length(file_name)≤255` + CHECK `octet_length(error_details::text)≤262144`. Cubre: R11.1, R11.3, R11.4. **(impl_12-backend, aplicada al remoto)**
- [x] T2.2 — Migration `0073_import_log.sql` (misma): RLS de `import_log` — SELECT `has_role_in`; INSERT `has_role_in AND (is_owner_of OR exists(user_roles role='veterinarian' active))` (inline — no existe `has_role` genérico, design §2.2). Grants `select, insert` a `authenticated`. Cubre: R2.4, R11.2. **(impl_12-backend)**
- [x] T2.3 — **(Escenario B / RPC bulk — Puerta 1 D2)** Migration `0074_import_rodeo_bulk_rpc.sql`: RPC `import_rodeo_bulk(p_rodeo_id, p_rows jsonb)` `SECURITY DEFINER` que (a) re-valida owner/vet adentro; (b) deriva est/species/system del rodeo (verifica `p_rodeo_id ∈` establishment del caller); (c) setea `establishment_id`/`created_by`/`imported_by` server-side (no del payload); (d) `revoke execute from public/anon`, grant solo `authenticated` + smoke-check fail-closed; (e) inserta cada animal como 2 inserts atómicos + import parcial por-fila (unique_violation se saltea, no aborta el chunk). Cubre: R9.4, R8.1, R8.2, R8.4. **(impl_12-backend, aplicada al remoto)**
- [x] T2.4 — Test runner (`supabase/tests/import/run.cjs`, ADR-012): `import_log` — un usuario sin rol en el establishment NO ve/escribe sus filas (cross-tenant); `imported_by` se fuerza aunque el payload mande otro uuid; un `field_operator` NO puede insertar (solo owner/vet); `error_details` gigante + `file_name` largo rechazados por el CHECK. Cubre: R9.3, R11.2, R11.3, R11.4, R2.4. **(impl_12-backend, 8 tests verde)**
- [x] T2.5 — Test runner del RPC: caller owner/vet del establishment correcto → inserta; caller con rol solo en otro establishment → rechazado; `p_rodeo_id` de otro establishment → rechazado; `field_operator` → rechazado; EXECUTE no concedido a `anon`/`public`; import parcial (TAG dup en batch → se saltea); TAG > 64 (CHECK 0070 dentro del definer). Cubre: R9.2, R9.4, R8.2, R8.4, R9.5. **(impl_12-backend, 10 tests verde)**

## Fase 3 — Service de escritura + dedup contra existentes (I/O)

- [ ] T3.1 — `app/src/services/import-rodeo.ts` — pre-check de dedup contra existentes: 1 query `idv = any($idvs)` sobre `animal_profiles` activos del establishment + 1 query `tag_electronic = any($tags)` sobre `animals` no soft-deleted → marca filas duplicado-contra-existente (skip, NUNCA update; TAG no reusable R7.4). En lote (no por fila). Reusa la detección blanda de spec 02 R5.5/R5.6 (vía spec 09). Cubre: R7.2, R7.3, R7.4.
- [ ] T3.2 — `import-rodeo.ts` — resolución de `category_id`: por `(systemId, code)` contra `categories_by_system` del rodeo destino (catálogo post-Tier-2 — reusa el patrón de `animals.ts createAnimal`); con columna que matchea → `category_override = true`; sin columna/sin match → placeholder "a completar" + `category_override = false` (D3). Match de raza → `breed` texto libre. Resolución de lote por nombre (no crear, R10.4). Cubre: R10.3, R10.4, R10.5, R6.1.
- [ ] T3.3 — `import-rodeo.ts` — escritura batch: **split insert+select** (UUIDs generados en cliente, sin `.insert().select()` — gotcha RLS-on-RETURNING) en **chunks** de ~100-200 filas; `establishment_id` del contexto activo (R9.1) + `species_id`/`system_id` del rodeo destino (R9.2 — `rodeo_id` ∈ establishment validado); **import parcial** (un chunk/fila que falla por carrera se reporta, no aborta el resto, R8.2/R8.4). Si D2=Escenario B, delega cada chunk al RPC `import_rodeo_bulk`. Cubre: R8.1, R8.2, R8.4, R9.1, R9.2, R10.1, R10.2.
- [ ] T3.4 — `import-rodeo.ts` — insert de `import_log` al finalizar (conteos: `total_records`/`imported_ok`/`imported_errors` + `error_details` + `file_name`/`file_format`/`rodeo_id`); también para corridas con 0 escritas. Cubre: R11.1, R5.6, R8.3.
- [ ] T3.5 — `import-rodeo.ts` — guards de input: rechazar archivo > tope de tamaño antes de leer (R3.1); rechazar > tope de filas (R3.2); abortar si parse falla (R3.6); neutralizar metacaracteres de valores parseados usados en filtros (`escapeIlike`, reuso F1-1) (R3.5); informar y NO encolar si no hay conexión al confirmar (R12.2). Cubre: R3.1, R3.2, R3.5, R3.6, R12.2.

## Fase 4 — Hook + UI (`[UI TENTATIVA]`, sujeta a design system)

- [ ] T4.1 — `app/src/hooks/useImportRodeo.ts`: orquesta pick → parse → mapeo → validar → preview → confirmar → escribir → resultado; expone estados (parsing/mapping/preview/writing/done) + progreso de escritura. Cubre: R1.3, R5, R8.
- [ ] T4.2 — `app/src/screens/import/ImportSourceScreen.tsx`: elegir fuente (CSV/Excel | TXT SIGSA) + pick archivo (`expo-document-picker`) + selección de rodeo destino (1 fijo / ≥2 selector, R2.2/R2.3); bloqueo si no hay rodeo (R1.4). Cubre: R1.3, R2.1, R2.2, R2.3, R1.4.
- [ ] T4.3 — `app/src/screens/import/ImportMappingScreen.tsx`: mapeo de columnas con auto-detección + ajuste manual (solo CSV/Excel). Cubre: R4.1, R4.2.
- [ ] T4.4 — `app/src/screens/import/ImportPreviewScreen.tsx`: preview con conteos válidos/errores/duplicados + desglose por motivo (id faltante, sexo, campo fuera de tope, dup intra-archivo, dup contra existente) + confirmación explícita; bloqueo si 0 válidas (R5.6). Cubre: R5.3, R5.4, R5.5, R5.6.
- [ ] T4.5 — `app/src/screens/import/ImportResultScreen.tsx`: resultado final (total/OK/errores/duplicados + detalle por fila). Cubre: R8.3.

## Fase 5 — Entry point (sobre flujos ya cerrados — no reimplementar)

- [ ] T5.1 — Cablear el CTA "Importar rodeo" en la pantalla de Rodeos (spec 02 C1, **reuso** — no reimplementar) → navega al flujo de import, re-ejecutable. Cubre: R1.1.
- [ ] T5.2 — Cablear el flag de onboarding: tras crear campo + rodeo (spec 01 Fase 4 / spec 02 C1, **reuso**), ofrecer el CTA de importar el rodeo existente. Cubre: R1.2.

## Fase 6 — Verificación + cierre

- [ ] T6.1 — Suite de utils puros (`node:test`) verde + enganchada en `scripts/run-tests.mjs` (que no quede verde-falso por suite no corrida, lección spec 03). Cubre: trazabilidad de Fase 1.
- [ ] T6.2 — `node scripts/check.mjs` verde end-to-end (sin regresión de specs 01/02/03/13). Cubre: cierre.
- [ ] T6.3 — Autorrevisión adversarial del implementer (mapa `R<n> → archivo:test` en `progress/impl_12-import-rodeo.md`; topes de input ejercitados; escritura cross-tenant imposible verificada) antes del reviewer. Cubre: trazabilidad (regla dura `docs/specs.md`).

## Notas de implementación

- **Reusos firmes (no duplicar)**: `normalizeTag`/`isValidTag` de `app/src/services/ble/parser-rs420.ts` (T1.9); patrón split insert+select + resolución de categoría de `app/src/services/animals.ts createAnimal` (T3.2/T3.3); detección blanda de dup de spec 02 R5.5/R5.6 (T3.1); tabla de razas de `specs/active/08-export-sigsa/razas-senasa-codigos.md` (T1.5); patrón de tabla scoped + trigger de audit de `0029_lab_samples.sql` + `0043` `tg_force_created_by_auth_uid` (T2.1).
- **Gate 1 (security_analyzer modo spec)**: APLICA (design §6) — acotado en el Escenario A (`import_log` tabla nueva con RLS + `imported_by` forzado), pesado en el Escenario B (RPC `SECURITY DEFINER` de bulk-insert). Se corre antes de la Puerta 1.
- **Gate 2 (code)**: siempre, tras el reviewer.
- **Dependencias**: spec 02 backend (done — sustrato animals/profiles/categorías/RLS); spec 04 R8 (parser-rs420.ts, done); spec 08 catálogo de razas (NO done → raza degrada a `breed` texto libre, se migra cuando 08 aterrice — no bloqueante); spec 02 C1 Rodeos + spec 01 onboarding (committeados — el entry point se cabla sobre ellos).
