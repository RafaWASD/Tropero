baseline_commit: 67d8619f28d438adc6d39413ad1e7a306667359b

# Impl 12 — parser `.xlsx` (R3.8) — bitácora

> Run aislado: SOLO el parser `.xlsx` de feature 12 (util puro adicional de la capa de
> parseo). NO toca backend/service/UI. Espeja el contrato de `parse-csv.ts`.
> Feature 12 = `in_progress`, spec aprobado (Puerta 1 D1 = `.xlsx` SÍ en MVP).

## Alcance de este run

- `app/src/utils/import/parse-xlsx.ts` (nuevo) — parser `.xlsx` DEFENSIVO con SheetJS vetado.
- `app/src/utils/import/parse-xlsx.test.ts` (nuevo) — `node:test`.
- Dependencia VETADA: SheetJS desde el CDN oficial (NO la npm `xlsx` con CVEs).

## Plan (tasks de este run)

- T1 — Instalar SheetJS desde `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
  (≥0.20.2, post-fix de CVE-2023-30533 prototype pollution + CVE-2024-22363 ReDoS).
  Verificar dominio exacto + sin postinstall (pnpm `onlyBuiltDependencies` lo bloquea).
- T2 — `parse-xlsx.ts`: `XLSX.read(data,{type:'array', sheetRows: MAX_ROWS+1})` (cap AL
  PARSEAR, anti-DoW), chequear dimensiones de hoja (`!ref`) → `rowsExceeded`, primera hoja,
  todo valor a string (no fórmulas, valores cacheados), MISMO contrato que `parse-csv.ts`.
- T3 — `parse-xlsx.test.ts`: workbook en memoria (aoa_to_sheet + write) → headers+filas;
  >MAX_ROWS → `rowsExceeded` y no materializa el excedente; fórmula → valor/texto, no se
  ejecuta; archivo corrupto → error manejado (no throw que rompa).

## Resultado

- **Archivo**: `app/src/utils/import/parse-xlsx.ts` (nuevo, util puro). Espeja el contrato
  de `parse-csv.ts` (`{ headers, rows, rowsExceeded, cellsExceeded }`) + un `parseError?`
  OPCIONAL (solo `.xlsx` hard-falla; CSV degrada a vacío) para que el hook de Fase 4
  distinga corrupto (R3.6) de vacío legítimo. Reusa `MAX_ROWS`/`MAX_CELLS_PER_ROW` de
  `parse-csv.ts` (mismo tope = 5000). Los dos parsers quedan intercambiables.
- **Test**: `app/src/utils/import/parse-xlsx.test.ts` (`node:test`, 14 tests, verdes).
  Construye workbooks en memoria con la MISMA librería vetada (no mock) y parsea de vuelta.
- **typecheck**: verde (`cd app && pnpm.cmd typecheck`). **check.mjs**: verde end-to-end (sin
  regresión; mi test aún NO está en `run-tests.mjs` — lo engancha el leader).

## Dependencia VETADA instalada

- `xlsx@0.20.3` (SheetJS oficial), fuente **`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`**
  — dominio exacto `cdn.sheetjs.com`, versión ≥0.20.2 (post-fix de CVE-2023-30533 prototype
  pollution + CVE-2024-22363 ReDoS). NO la npm `xlsx` vulnerable.
- Registrada en `app/package.json` (`"xlsx": "https://cdn.sheetjs.com/..."`) + `app/pnpm-lock.yaml`
  (resolution = tarball del CDN).
- **Postinstall**: NO ejecutó. El paquete no declara `postinstall`/`install`/`preinstall`/
  `prepare`; pnpm (`onlyBuiltDependencies` en `app/package.json`) NO pidió build/allowlist para
  xlsx. Verificado: `scripts` del paquete = `{build, test, lint,…}` (no son lifecycle hooks de
  install). No se allowlisteó nada nuevo.
- Warnings de peer deps (expo-linking/constants, react-navigation) son **pre-existentes** y no
  relacionados con xlsx.

## Trazabilidad R<n> → archivo:test

| R<n> | Cubierto por | Test (`parse-xlsx.test.ts`) |
|---|---|---|
| R3.8 (parser vetado SheetJS CDN ≥0.20.2, no npm con CVE) | `parse-xlsx.ts` (`import * as XLSX from 'xlsx'` desde el tarball del CDN) + `app/package.json`/lockfile | toda la suite usa la lib real (no mock) |
| R3.2 (rechaza-y-reporta > tope filas, no trunca silencioso) | `parse-xlsx.ts` (`rowsExceeded` vía `!fullref` + conteo materializado) | "> MAX_ROWS → rowsExceeded", "exactamente MAX_ROWS → no excede", "MAX_ROWS+1 → excede" |
| R3.3 (cap AL PARSEAR, antes de materializar) | `parse-xlsx.ts` (`XLSX.read(… sheetRows: MAX_ROWS+1)`) | "50k filas NO materializa 50k" (cap real) |
| R3.5 (valor no confiable: no fórmulas, no reexporta, texto) | `parse-xlsx.ts` (`cellFormula:false` + `raw:false` cached value + `String()`) | "FÓRMULA → valor cacheado, no ejecuta", "=cmd() → string literal", "numéricos → string" |
| R3.6 (parse falla → no rompe, no escribe) | `parse-xlsx.ts` (try/catch → `parseError:true`) | "bytes corruptos → parseError, no lanza", "null → parseError" |
| R4.1 (headers→`{headers, rows}`, primera fila headers) | `parse-xlsx.ts` (`sheet_to_json header:1`) | ".xlsx bien formado → headers+filas", "solo primera hoja", "hoja vacía", "celdas faltantes rellenadas" |

## Autorrevisión adversarial

Buscado como revisor hostil, encontrado y cerrado:

1. **¿`sheetRows` realmente capea o SheetJS materializa toda la hoja y descarta después?**
   — Verificado empíricamente: una hoja de 50.000 filas, leída con `sheetRows:5001`,
   materializa solo ≤MAX_ROWS filas en ~5ms de `sheet_to_json` (test "50k NO materializa 50k").
   El cap es real a nivel de materialización de celdas. `!fullref` (`A1:B50001`) reporta el
   tamaño ORIGINAL sin materializarlo → `rowsExceeded` sin tocar el excedente (R3.2/R3.3).

2. **Detección de exceso — doble detector, ¿off-by-one?** — `rowsExceeded` se setea por (a)
   `!fullref` (SheetJS lo pone SOLO cuando `sheetRows` truncó, con las dims originales) si sus
   filas de datos > MAX_ROWS, y (b) si las filas materializadas > MAX_ROWS (caso exacto
   MAX_ROWS+1 sin truncado de XML). Probados los 3 bordes: MAX_ROWS exacto (no excede),
   MAX_ROWS+1 (excede), MAX_ROWS+500 y 50k (excede + acotado). Aritmética header verificada
   (`dataRows = totalRows - 1`).

3. **¿Una fórmula se evalúa?** — NO. SheetJS es parser, no motor de cálculo: nunca recomputa
   en `read`. Uso `cellFormula:false` + `sheet_to_json({raw:false})` → toma el valor CACHEADO/
   formateado (`.w`/`.v`), nunca la fórmula. Probado: `=1+1`→`"2"` (cacheado), `=cmd()`→string
   literal `"=cmd()"`, y una fórmula SIN valor cacheado → celda error, dropea, el string de la
   fórmula NUNCA aparece en el output (verificado con `.includes`).

4. **Zip-bomb (residual, anotado).** Un `.xlsx` chico que descomprime a algo enorme: `XLSX.read`
   descomprime TODO el ZIP (incl. `sharedStrings.xml` de TODAS las filas) para encontrar los
   límites de fila, aunque `sheetRows` solo RETENGA las primeras MAX_ROWS+1. Ese parse interno
   es el residual. **Acotado por R3.1** (tope de 5 MB del archivo COMPRIMIDO, enforced en el
   service ANTES de que un byte llegue al parser) **+ `sheetRows`** (acota las filas
   materializadas). Cuantificado: un `.xlsx` repetitivo de ~5 MB (peor ratio de compresión vía
   shared-strings) contiene a lo sumo ~9.300 filas y `read`+cap tarda ~90ms reteniendo 5001
   filas. Un bomb de 32 MB (que SÍ OOM-ea el parse) NUNCA llega al parser: R3.1 lo rechaza
   antes. **Residual aceptable**: es op de owner/vet AUTENTICADO (threat model bajo, R3.7), con
   doble cota (bytes comprimidos R3.1 + filas materializadas `sheetRows`). NO hay barrera de
   tamaño DESCOMPRIMIDO independiente — si en el futuro se quiere endurecer, sería un límite de
   `octet_length` del sheet XML descomprimido (no necesario para MVP; anotado).

5. **¿Contrato intercambiable con `parse-csv.ts`?** — Sí: mismo `{headers, rows, rowsExceeded,
   cellsExceeded}`; reuso de `MAX_ROWS`/`MAX_CELLS_PER_ROW` (un solo tope, no diverge). El
   `parseError?` es OPCIONAL (los consumidores CSV existentes lo ignoran; el hook de Fase 4 lo
   lee para R3.6). Imports extensionless en el source (resuelve Metro + ts-ext-resolver);
   `.ts` solo en el test (patrón del repo).

## Para enganchar (leader)

Agregar `app/src/utils/import/parse-xlsx.test.ts` a la lista de `client unit tests` en
`scripts/run-tests.mjs` (junto a los demás `app/src/utils/import/*.test.ts`). NO toqué
`run-tests.mjs` (lo engancha el leader, evita colisión).
