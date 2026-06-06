baseline_commit: ebec9d5dc2474aec10c1196ba3e52c775528c583

# impl_12-utils — Feature 12 (Importación masiva de rodeo), Fase 1 utils PUROS

> **Alcance de este run**: SOLO los utils puros de parseo/validación de `app/src/utils/import/`
> (tasks T1.1–T1.12), **EXCEPTO el parseo `.xlsx`** (otro run, necesita SheetJS vetada — no se
> agregan dependencias acá). NO se toca backend/migraciones/UI/`scripts/run-tests.mjs`/`parser-rs420.ts`.

## Feature en curso

- **Feature 12 — Importación masiva de rodeo** (`feature_list.json` id 12, `status: in_progress`, `sdd: true`).
- Spec: `specs/active/12-import-rodeo/{requirements,design,tasks}.md` (Gate 1 PASS, Puerta 1 aprobada por Raf).

## Plan (tasks de este run)

- T1.1 + T1.2 — `parse-csv.ts` + test
- T1.3 + T1.4 — `parse-sigsa-txt.ts` + test
- T1.5 + T1.6 — `breed-senasa.ts` + test
- T1.7 + T1.8 — `column-mapping.ts` + test
- T1.9 + T1.10 — `normalize-row.ts` + test (reusa `parser-rs420.ts`)
- T1.11 + T1.12 — `validate-rows.ts` + test

## Constantes de verdad (del as-built, NO inventadas)

- Caps `0070` (espejo cliente, R3.4): `idv`≤64, `visual_id_alt`≤64, `breed`≤64, `coat_color`≤64,
  `tag_electronic`≤64, `entry_origin`≤120, `notes`≤4000.
- TAG: `normalizeTag` + `isValidTag` de `app/src/services/ble/parser-rs420.ts` (15 díg FDX-B).
- Razas SENASA: 32 códigos de `specs/active/08-export-sigsa/razas-senasa-codigos.md` (Tabla 1).
- SIGSA TXT: `DISPOSITIVO-SEXO-RAZA-MM/AAAA;…` (research-findings §2), parse POR POSICIÓN.

---

## Resultado del run (2026-06-06)

**DONE — T1.1 a T1.12.** 6 módulos puros + 6 suites `node:test` en `app/src/utils/import/`.
**72/72 tests verdes** + `cd app && pnpm.cmd typecheck` verde + `node scripts/check.mjs` verde
end-to-end (sin regresión de specs 01/02/03/13/14).

Comando de verificación (desde la raíz):
```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test \
  app/src/utils/import/parse-csv.test.ts app/src/utils/import/parse-sigsa-txt.test.ts \
  app/src/utils/import/breed-senasa.test.ts app/src/utils/import/column-mapping.test.ts \
  app/src/utils/import/normalize-row.test.ts app/src/utils/import/validate-rows.test.ts
```

### Archivos creados (todos PUROS, sin I/O)

- `app/src/utils/import/parse-csv.ts` (+ `.test.ts`, 14 tests)
- `app/src/utils/import/parse-sigsa-txt.ts` (+ `.test.ts`, 11 tests)
- `app/src/utils/import/breed-senasa.ts` (+ `.test.ts`, 6 tests)
- `app/src/utils/import/column-mapping.ts` (+ `.test.ts`, 11 tests)
- `app/src/utils/import/normalize-row.ts` (+ `.test.ts`, 16 tests)
- `app/src/utils/import/validate-rows.ts` (+ `.test.ts`, 14 tests)

### NO tocado (otros runs)

- Backend / migraciones / RPC (Fase 2), service de I/O (Fase 3), hook+UI (Fase 4), entry point (Fase 5).
- `scripts/run-tests.mjs` (el leader engancha los tests — T6.1; evita colisión con el run de backend en paralelo).
- `app/src/services/ble/parser-rs420.ts` (solo IMPORTADO, no modificado).
- **`.xlsx` (parse-xlsx.ts)**: DEFERIDO a un run posterior (necesita SheetJS vetada R3.8; este run NO agrega deps).

## Mapa de trazabilidad `R<n> → archivo:test`

| R<n> | Qué exige | Cubierto por |
|---|---|---|
| R3.2 (tope de filas, sin truncar silencioso) | `parse-csv.ts` MAX_ROWS + `rowsExceeded` | `parse-csv.test.ts`: "> MAX_ROWS → corta y SEÑALA excedido"; "exactamente MAX_ROWS → NO marca excedido"; "fila excedente SIN newline final" · `parse-sigsa-txt.test.ts`: "> MAX_SIGSA_RECORDS → corta y señala"; "cap DURANTE el scan sin sep final" |
| R3.3 (cap DURANTE la lectura, no después) | scan char-by-char + `break` al tope (csv y sigsa); cap de celdas/fila | `parse-csv.test.ts`: "cap de celdas por fila"; el cap de filas materializa solo MAX_ROWS · `parse-sigsa-txt.test.ts`: cap durante scan |
| R3.4 (topes de largo espejo de 0070) | `normalize-row.ts` `FIELD_CAPS` (idv/visual/breed/coat≤64, entry_origin≤120, notes≤4000) | `normalize-row.test.ts`: "campo > tope → issue + null"; "exactamente en el tope → pasa" · `validate-rows.test.ts`: "field_over_cap → error" |
| R3.5 (valor no confiable, no fórmula) | parsers tratan toda celda como texto literal | `parse-csv.test.ts`: "`=cmd()` se trata como TEXTO literal" |
| R3.6 (parse falla / registro malformado → fila con error, no rompe el resto) | `parse-sigsa-txt.ts` error por registro | `parse-sigsa-txt.test.ts`: "registro malformado → fila con error, NO rompe el resto"; "RFID no-15-díg → error"; "campos de más → error" |
| R4.1 (auto-detección headers → campo del censo) | `column-mapping.ts` `autoDetectMapping`/`detectField` | `column-mapping.test.ts`: "headers conocidos → mapeo esperado"; "normalización tildes/may"; "ambiguo → sin mapear" · `parse-csv.test.ts`: headers correctos |
| R4.2 (ajuste manual del mapeo) | `applyMappingOverride` (single-source, puro) | `column-mapping.test.ts`: "override respetado"; "reasigna → limpia anterior"; "override a null"; "índice fuera de rango" |
| R4.3 (sexo tolerante → male/female; basura → error) | `normalize-row.ts` `normalizeSex` | `normalize-row.test.ts`: "sexo tolerante → male/female"; "sexo basura/vacío → null" · `validate-rows.test.ts`: "sin sexo / no mapeable → error" |
| R4.4 (fecha DD/MM/AAAA·MM/AAAA·AAAA → ISO o NULL) | `normalize-row.ts` `parseBirthDate` | `normalize-row.test.ts`: "3 formatos → ISO"; "fecha inválida (13/13, 31/02, día 32, mes 0) → NULL sin romper" |
| R4.5 (TAG vía parser-rs420 REAL) | `normalize-row.ts` importa `normalizeTag`+`isValidTag` | `normalize-row.test.ts`: "TAG válido 15 díg → se acepta"; "14/16/no-numérico → null (descarta)" |
| R5.1 (≥1 identificador, ADR-005) | `validate-rows.ts` `hasIdentifier` | `validate-rows.test.ts`: "sin id → error a completar"; "TAG válido/visual cuentan"; "TAG inválido sin otro id → missing_identifier" |
| R5.2 (sexo presente y mapeable) | `validate-rows.ts` `row.sex===null → missing_sex` | `validate-rows.test.ts`: "sin sexo / sexo no mapeable → error" |
| R6.1/R6.3 (raza texto libre, nunca bloquea fila) | `normalize-row.ts` breed capado; `validate-rows` no la exige | `normalize-row.test.ts`: breed > 64 → issue (no bloquea por ausencia); `validate-rows` no marca error por raza |
| R6.2 (código SENASA → nombre; posición; desconocido → código tal cual) | `breed-senasa.ts` + `parse-sigsa-txt.ts` posicional | `breed-senasa.test.ts`: "AA→Aberdeen Angus, H→Hereford, S/E→Sin Especificar"; "fuera de tabla → conserva"; 32 códigos · `parse-sigsa-txt.test.ts`: "H en SEXO=Hembra / H en RAZA=Hereford por POSICIÓN" |
| R7.1 (dedup intra-archivo → conflicto a completar) | `validate-rows.ts` `computeIntraDuplicates` (idv + tag) | `validate-rows.test.ts`: "mismo idv → ambas conflicto"; "mismo tag → conflicto"; "grupo de 3"; "idvs distintos no colisionan"; "errores no entran al dedup" |
| R10.1 (campos del censo desde el TXT SIGSA) | `parse-sigsa-txt.ts` rfid/sex/breed/birth | `parse-sigsa-txt.test.ts`: "TXT del manual → RFID/sexo/raza/fecha" |

## Autorrevisión adversarial (paso 8)

Pasada hostil sobre el propio código antes de reportar. Qué busqué / qué encontré / cómo lo cerré:

1. **¿El cap de filas corta DURANTE la lectura o después?** — En `parse-csv.ts` el cap corta DURANTE el
   scan char-by-char (`commitRecord` hace `break` al alcanzar el tope; no materializa el excedente).
   **Encontré un gap en `parse-sigsa-txt.ts`**: la 1ra versión hacía `text.split(/;|\n/)` (materializa TODO
   el array de chunks antes de iterar = "después", viola R3.3). **Corregido**: reescrito a scan char-by-char
   con `flush()` por `;`/newline y `return` temprano al tope — ahora cap DURANTE la lectura, consistente con
   el CSV. Test agregado: "cap aplicado DURANTE el scan (sin sep final)".
2. **¿Un CSV con `=cmd()` se trata como texto (no fórmula)?** — Sí, el parser no interpreta/evalúa: la celda
   es el string literal `=cmd()`. Test explícito. (La neutralización de metacaracteres para filtros DB —
   `escapeIlike` — es del service, no de estos utils puros; documentado en los headers, R3.5.)
3. **¿La fecha `13/13/2024` cae a NULL sin romper?** — Sí (`buildDate` valida rango mes 1-12, día 1-31, y
   rechaza overflow con round-trip UTC: 31/02 → marzo → null). Tests: 13/13, 31/02, día 32, mes 00. Ninguna lanza.
4. **¿Un TAG de 14 díg se rechaza?** — Sí, vía el `isValidTag` REAL (`/^\d{15}$/`). Tests: 14, 16, no-numérico → null.
5. **Edge cap en el flush final** — pregunté: ¿una fila excedente que cae al flush final (archivo sin
   newline/`;` final) igual marca excedido? Sí, agregué tests en CSV y SIGSA que lo prueban (no se materializa).
6. **Extensión de imports** — el typecheck (`tsc`, moduleResolution bundler) rechaza imports con `.ts` en
   código fuente; el runner de tests (`ts-ext-resolver.mjs`) los exige en los `.test.ts`. **Encontré 2
   imports `.ts` en fuente** (`normalize-row.ts`→parser-rs420, `validate-rows.ts`→normalize-row): los pasé a
   extensionless (convención del repo). Tras el fix, typecheck verde Y tests verdes (el resolver agrega `.ts`).
7. **dedup vs filas ya erradas** — verifiqué que el dedup intra-archivo corre SOLO sobre filas candidatas
   (que pasaron las reglas por-fila): dos filas sin id no se reportan también como "duplicado" (serían ruido).
   Test explícito.
8. **breed/fecha vacíos en SIGSA con 4 campos** — `032010000000000-M--` (breed vacío) y `...-AA-` (fecha
   vacía) NO son error estructural (raza opcional R6.3, fecha nullable R4.4): se validan downstream. Test agregado.
9. **Multi-tenant / offline** — N/A a esta capa: son utils PUROS de parseo/validación, sin `establishment_id`,
   sin red, sin escritura. El forzado server-side (R9) y el dedup contra existentes (R7.2) viven en el service
   (otro run). No hay nada que hardcodear ni nada de red que testear acá (R12.1 dice parseo/validación local).

## Notas / disclaimers para el reviewer y los runs siguientes

- **Sinónimos de `column-mapping.ts` = TENTATIVOS** (R4.1): no hay archivo real del beta ni validación con
  Facundo. La auto-detección es exact-match-on-normalized (no fuzzy) para evitar falsos positivos greedy; el
  override manual (R4.2) es la red de seguridad. Comentado en el header del módulo. Se afina con planilla real.
- **`normalizeSex` acepta también nombres de categoría** (`ternero`/`vaca`/`novillo`…) como tolerancia a una
  columna de sexo "sucia" — superset seguro (no mapea al sexo equivocado). El sexo real igual lo decide R5.2.
- **El service (Fase 3) debe consumir estos utils así**: `parseCsv`/`parseSigsaTxt` → (CSV) `autoDetectMapping`
  + override → extraer celdas por `columnIndexFor` → `normalizeRow` por fila (resolviendo el código SENASA con
  `breedNameFromCode` para el path SIGSA ANTES de pasar `breed` a `normalizeRow`) → `validateRows` → dedup
  contra existentes (I/O) → escritura. Los tipos exportados (`NormalizedRow`, `RowError`, `IntraDuplicateGroup`,
  `ParsedTable`, `SigsaRecord`, `ColumnMapping`, `CensusField`) son el contrato hacia el service.
- **`rowsExceeded`/`recordsExceeded`/`cellsExceeded`** los expone el parser para que el service/hook rechace-y-
  reporte (R3.2) en vez de truncar. El service NO debe ignorarlos.
- **NO marco `done` yo**: espera al reviewer + Gate 2 (code).
</content>
</invoke>
