baseline_commit: 6308ff5c1e806a007144d9b244a667767d0f735f

# impl 08 — SIGSA capa pura (T8 + T9 + T10)

Run aislado en terminal paralela (terminal NO dueña). Solo la capa pura de la spec 08:
types + generador TXT + validador. NO toca DB, migrations, PowerSync, pantallas ni specs.

## Scope (lo único que toco)
- `app/src/services/sigsa/types.ts` (T8)
- `app/src/services/sigsa/sigsa-txt-generator.ts` (T9)
- `app/src/services/sigsa/sigsa-validator.ts` (T10)
- `app/src/services/sigsa/sigsa-txt-generator.test.ts` (tests colocados)
- `app/src/services/sigsa/sigsa-validator.test.ts` (tests colocados)
- append de los 2 tests a `scripts/run-tests.mjs`

## Plan
- T8: tipos `AnimalExportRecord`, `SigsaTxtOptions`, `ExportValidationResult`, `PendingAnimalInfo` + `ExportValidationReason`.
- T9: `generateSigsaTxt(records, options)` puro, inverso exacto de `parse-sigsa-txt.ts`. Reusa `isKnownBreedCode` de `breed-senasa.ts`. RFID genérico `/^\d{15}$/` (NO el 982 del RS420).
- T10: `validateForExport(animals: PendingAnimalInfo[])` → `{ exportable, incomplete }`, colecciona TODAS las razones por animal.

## Progreso

- [x] T8 — `app/src/services/sigsa/types.ts`. Tipos: `AnimalExportRecord`, `SigsaTxtOptions`,
  `ExportValidationReason`, `PendingAnimalInfo`, `ExportValidationResult`.
- [x] T9 — `app/src/services/sigsa/sigsa-txt-generator.ts` (puro). `generateSigsaTxt(records, options)`.
  Reusa `isKnownBreedCode` de `breed-senasa.ts` (R6.5, no inventa códigos). RFID `/^\d{15}$/` genérico.
- [x] T10 — `app/src/services/sigsa/sigsa-validator.ts` (puro). `validateForExport(PendingAnimalInfo[])`
  → `{ exportable, incomplete }`. Colecciona TODAS las razones por animal (R8.3).
- [x] Tests colocados: `sigsa-txt-generator.test.ts` (16), `sigsa-validator.test.ts` (16). Total 32.
- [x] Append a `scripts/run-tests.mjs` (solo los 2 archivos, sin reordenar el resto).

NOTA: NO marco `[x]` en `specs/active/08-export-sigsa/tasks.md` — es archivo de coordinación de la
feature que reconcilia el leader al cerrar el gate (regla de aislamiento de terminal paralela). El
estado real de T8/T9/T10 queda registrado acá.

## Resolución de ambigüedad de contrato (T10)
La spec dice que el validador recibe `AnimalExportRecord[]`, pero los casos de aceptación usan campos
crudos nullables. Resuelto según el brief: el validador recibe `PendingAnimalInfo[]` (crudo, lo que
devuelve la query del design) y EMITE los `AnimalExportRecord` limpios para los exportables. Esto NO es
una desviación del *qué* (validar y separar exportables vs. a-completar) sino la forma correcta del
contrato de tipos. El leader debe reconciliar `design.md`/`tasks.md` T10 al cerrar el gate para reflejar
que el validador toma crudo y emite limpio (hoy el snippet del design solo tipa el generador, no el
validador, así que no hay contradicción dura — solo una precisión a anotar).

## Trazabilidad R<n> → archivo:test
| R | Test |
|---|---|
| R5.1 (formato registro) | `sigsa-txt-generator.test.ts` › "T9-a un animal genera {RFID}-{SEXO}-{RAZA}-{MM/AAAA}" |
| R5.2 (derivación campos: sexo M/H, MM/AAAA) | generator › "T9-a"; validator › "R5.2 mapeo de sexo"; validator › "R8.1 T10-g normalizado" |
| R5.5 (solo 4 campos, sin RENSPA/especie) | generator › "R5.5 el registro tiene EXACTAMENTE 4 campos" |
| R5.6 (UTF-8 sin BOM) | generator › "R5.6 T9-g output es UTF-8 sin BOM" |
| R6.1 (separador `-` intra-registro) | generator › "T9-a" |
| R6.2 (separador `;` entre registros, sin espacios) | generator › "R6.2 T9-b dos animales se separan con `;`" |
| R6.3 (trailingSemicolon configurable, default false) | generator › "T9-b" (false) + "R6.3 T9-c" (true) |
| R6.4 (mes 2 dígitos `08` no `8`) | generator › "R6.4 T9-d mes 01"; validator › "R6.4 MM/AAAA 2 dígitos" + "R6.4 ISO completo sin timezone shift" |
| R6.5 (códigos del catálogo oficial, no inventar) | generator › "R6.5 T9-f vacío" + "R6.5 desconocido" + "R6.5 acepta TODOS los códigos incl S/E" |
| R8.1 (separar exportables vs a-completar) | validator › "R8.1 T10-g" + "R8.1 lote mixto" |
| R8.2 (bloqueo por rfid/birth/breed null) | validator › "T10-a missing_rfid" + "T10-e missing_birth_date" + "T10-f missing_breed" |
| R8.3 (coleccionar TODAS las razones, plural) | validator › "R8.3 colecciona TODAS las razones" + "R8.3 invalid_rfid Y missing_breed" |
| R8.6 (RFID 15 dígitos numéricos) | generator › "R8.6 T9-e lanza si RFID no 15 dígitos"; validator › "T10-b 14 dígitos" + "T10-c 15 ok" + "T10-d con letras" |
| (gotcha 2) round-trip con el parser | generator › "round-trip contra parse-sigsa-txt reproduce el ejemplo del manual" |
| (integración) validador→generador | generator › "integración validador→generador genera el TXT sin lanzar" |

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **Round-trip real, no falso-verde**: el test parsea el ejemplo literal del manual con `parseSigsaTxt`,
  mapea a `AnimalExportRecord[]`, regenera y compara string exacto. Ejercita el path real. Verde.
- **No inventé códigos de raza**: reuso `isKnownBreedCode` de `breed-senasa.ts` (misma tabla de 32).
  Test que recorre AA/H/PH/BG/BF/SI/GC/OR/S-E (incl. el caso con barra). El generador LANZA ante código
  desconocido (`ZZ`) y ante vacío. Verifiqué que `S/E` no tiene `-` → no corrompe el split posicional.
- **RFID genérico, NO 982**: ambos módulos usan `/^\d{15}$/` (= `RFID_RE` del parser), NO `isValidTag`
  del RS420. Grep confirmó que `isValidTag`/`982` solo aparecen en comentarios. El ejemplo oficial usa
  prefijo `032` y mis tests lo aceptan.
- **Razones completas (R8.3 plural)**: el validador junta TODAS las razones aplicables por animal (no
  corta en la primera). Test con animal sin rfid+sin fecha+sin raza → 3 razones; otro con invalid_rfid +
  missing_breed → 2.
- **Edge cases del gate duro**: trailing semicolon (false por default + true explícito), BOM (assert que
  no hay U+FEFF), MM padding (`01` ok / `1/2024` lanza en el generador / `2025-8-15` → missing en el
  validador). Lista vacía → string vacío (sin `;` solitario aunque trailingSemicolon=true).
- **Edge encontrado y cerrado**: `monthYearFromIso` trabaja sobre los componentes del string (regex), NO
  construye `Date` → evita corrimiento de mes por timezone (test `2025-08-31T23:30:00Z` → `08/2025`).
  Mes fuera de 1-12 (`2025-13-01`) y formato no-ISO (`no-es-fecha`, `2025-8-15`) → `missing_birth_date`
  (fail-closed: mejor flaggear que emitir un MM/AAAA inválido). Agregué test que lo bloquea.
- **sex defensivo**: `male→M`, `female→H`; valor inesperado/null → `H` (no lanza). Documentado en
  comentario: R8.2 NO lista sex como bloqueante (schema spec 02 lo garantiza NOT NULL), así que no
  convertimos un caso imposible-por-schema en bloqueo de export.
- **Robustez de input**: ambos módulos toleran input no-array (generator lanza TypeError explícito;
  validator devuelve conjuntos vacíos) y el validador ignora filas null dentro del array.

Nada quedó abierto: lo que encontré (edge de fecha) lo testeé y cerré antes de reportar.

## Decisión técnica registrada (imports + tsconfig)
El `tsc` de la app NO tiene `allowImportingTsExtensions` y EXCLUYE `**/*.test.ts`. Por eso:
- archivos SOURCE (`sigsa-txt-generator.ts`, `sigsa-validator.ts`) importan EXTENSIONLESS
  (`'./types'`, `'../../utils/import/breed-senasa'`) — convención del repo (ver `import-ui.ts`,
  `connector.ts`); el runner `ts-ext-resolver.mjs` resuelve en runtime.
- archivos TEST mantienen extensión `.ts` (excluidos de tsc; el runner los resuelve).
Sin esta separación, `tsc --noEmit` fallaba con TS5097. Resuelto. Typecheck EXIT 0.

## Verificación final
- Unit tests nuevos: **32/32 pass** (16 generator + 16 validator), 0 fail.
- Typecheck `app/ tsc --noEmit`: **EXIT 0** (clean).
- NO corrí `check.mjs` ni suites de `supabase/tests/*` (terminal NO dueña, evita colisión + flake de
  rate-limit). Solo los 2 unit tests + typecheck, como pide el brief.
</content>
</invoke>
