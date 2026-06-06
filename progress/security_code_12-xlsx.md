# Security Code Review — feature 12, parser `.xlsx` (R3.8)

**Modo**: `code` (Gate 2). **Fecha**: 2026-06-06.
**Baseline**: `67d8619f28d438adc6d39413ad1e7a306667359b` (de `progress/impl_12-xlsx.md`).
**Veredicto**: **PASS**

---

## Resumen

El parser `.xlsx` (R3.8) usa la distribución **oficial vetada de SheetJS desde el CDN**
(`xlsx@0.20.3`, tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), NO la npm `xlsx`
vulnerable. Versión ≥0.20.2 → post-fix de CVE-2023-30533 (prototype pollution) y CVE-2024-22363
(ReDoS). Las cuatro defensas pedidas (supply-chain, cap-al-parsear, no-eval-de-fórmulas, no
prototype-pollution) están implementadas y verificadas empíricamente por la suite (14/14 verdes,
incl. el test adversarial de 50k filas). El zip-bomb residual está correctamente acotado y es
aceptable para el threat model (op de owner/vet autenticado). **Sin findings HIGH.**

---

## Findings HIGH de Sentry

Ninguno. La skill `sentry-skills:security-review` (lentes `supply-chain` + `modern-threats`)
no identificó vulnerabilidades HIGH-confidence en el diff. Trazado el data flow:
bytes del archivo (untrusted, del document-picker) → `XLSX.read` con caps → `sheet_to_json` en
modo array → `String()` por celda → `{ headers, rows }`. No hay sink ejecutable, ni construcción
de objeto con claves controladas por el archivo, ni concatenación a query/prompt/HTML en este módulo.

## Findings RAFAQ-SPECIFIC

Ninguno. Detalle de la verificación punto por punto (foco del leader):

### 1. Supply-chain (catálogo D) — VERIFICADO OK

- **Fuente/dominio (D1/D2)**: `app/package.json:47` → `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`.
  `app/pnpm-lock.yaml:102-103` → specifier Y resolution apuntan al MISMO tarball del CDN oficial
  (`cdn.sheetjs.com`, dominio exacto, sin typosquat). `pnpm-lock.yaml:4275-4278`: `version: 0.20.3`,
  `resolution: {tarball: https://cdn.sheetjs.com/...}`. NO es la npm `xlsx` (que quedó pinneada en
  ≤0.18 con los CVEs). El lockfile está commiteado (no en `.gitignore` — `git check-ignore` = exit 1).
- **Versión vs CVEs (R3.8)**: `0.20.3` ≥ `0.20.2`. CVE-2023-30533 (prototype pollution, fix en 0.19.3)
  y CVE-2024-22363 (ReDoS, fix en 0.20.2) ambos PARCHEADOS. Confirmado contra el paquete instalado:
  `app/node_modules/xlsx/package.json` → `name: xlsx`, `version: 0.20.3`, `homepage: https://sheetjs.com/`.
- **Postinstall / allowlist (clave para D)**: el paquete instalado declara `scripts`:
  `{pretest, test, pretest-only, tests-only, build, lint, dtslint}` — **NINGUNO es un lifecycle hook
  de install** (`preinstall`/`install`/`postinstall`/`prepare`/`prepublish` ausentes). pnpm nunca
  ejecutó script alguno. `app/package.json:60-66` (`pnpm.onlyBuiltDependencies`) NO incluye `xlsx`
  (sigue siendo `expo, expo-modules-core, @expo/cli, esbuild, supabase`) → **no se agregó allowlist
  de build para xlsx**, correcto. `dependencies: {}` → cero deps transitivas (sin fan-out de cadena;
  `pnpm-lock.yaml:9520` → `xlsx@...: {}`).

### 2. Cap al parsear (R3.3 / anti-DoW) — VERIFICADO OK

`parse-xlsx.ts:83-91` → `XLSX.read(data, { type:'array', sheetRows: MAX_ROWS + 1, ... })`. `sheetRows`
detiene la materialización en MAX_ROWS+1 (no parsea hojas de 10^6 filas a memoria). El test adversarial
"50k filas NO materializa 50k" pasa en ~1.19s materializando ≤MAX_ROWS — el cap es real a nivel de
celdas, no post-hoc. Rechaza-y-reporta (R3.2): `parse-xlsx.ts:112-117` lee las dimensiones ORIGINALES
de `sheet['!fullref']` (que SheetJS setea solo cuando `sheetRows` truncó) SIN materializarlas, y marca
`rowsExceeded`; doble detector con el conteo materializado en `:144-147`. No hay truncado silencioso:
las filas excedentes nunca se devuelven como si el archivo estuviera completo. Bordes probados
(MAX_ROWS exacto / +1 / +500 / 50k).

### 3. Fórmulas / valores no confiables (R3.5) — VERIFICADO OK

`parse-xlsx.ts:83-91` pasa `cellFormula: false`, `cellHTML: false`, `cellStyles: false`. SheetJS es
parser, NO motor de cálculo: nunca recomputa fórmulas en `read`. `:123-128` usa
`sheet_to_json({ raw:false })` → toma el valor CACHEADO/formateado (`.w`/`.v`), nunca la fórmula. Tests:
`=1+1` → `"2"` (cacheado), `=cmd()` / `=HYPERLINK("http://evil")` / `@SUM(1)` / `+1+1` → strings
literales (no ejecutados, el string de la fórmula nunca aparece). NO se reexporta a Excel. La
neutralización para filtros DB (`escapeIlike`) vive aguas abajo en el service (verificado:
`app/src/services/import-rodeo.ts:48` reexporta `escapeIlike` de `utils/import/import-write.ts`,
reuso de F1-1 spec 13) — correcto, este módulo solo lee texto.

### 4. Prototype pollution — VERIFICADO OK (doble defensa)

Defensa primaria: la VERSIÓN parchea CVE-2023-30533 (≥0.19.3). Defensa estructural del código:
`parse-xlsx.ts:123` usa `sheet_to_json({ header: 1 })` → devuelve **array-de-arrays** (`unknown[][]`),
NO el modo objeto donde los headers del archivo se vuelven CLAVES de objeto (el vector clásico de
pollution vía un header `__proto__`/`constructor`). El parser nunca construye un objeto keyeado por
contenido del archivo: `toStringRow` (`:164-177`) produce `string[]` vía `String(v)`. Grep confirmó:
los únicos `...` spreads (`:75`, `:95`) esparcen `empty` (constante literal server-controlled), no
input del archivo → sin mass-assignment ni pollution. Sin `Object.assign`/`fromEntries`/`reduce`
sobre claves del archivo.

### 5. Zip-bomb (residual) — RESIDUAL ACEPTABLE, no es finding

Documentado en `impl_12-xlsx.md` (autorrevisión #4): `XLSX.read` descomprime el ZIP entero
(incl. `sharedStrings.xml`) aunque `sheetRows` solo RETENGA MAX_ROWS+1 filas. Acotado por **R3.1**
(tope 5 MB del archivo COMPRIMIDO, enforced en el service ANTES del parser — verificado: `checkFileSize`
en `import-write.ts`, reexportado por `import-rodeo.ts:48`) **+ `sheetRows`**. Threat model: op de
**owner/vet autenticado**, mismo-tenant, no es endpoint público (R3.7). La defensa es razonable y
proporcional: dos cotas independientes (bytes comprimidos + filas materializadas). No hay barrera de
tamaño DESCOMPRIMIDO independiente, pero no es necesaria para MVP y está anotada como endurecimiento
futuro. **Residual aceptable, NO finding.** (Nota menor de defensa-en-profundidad, LOW, no bloquea —
ver anexo.)

## False positives descartados (trazabilidad)

- **Prototype pollution vía headers del archivo** (patrón candidato de la lente `modern-threats`):
  descartado — el modo `header: 1` evita el sink (arrays, no objetos keyeados por el archivo) + la
  versión está parcheada. Doble defensa, no explotable.
- **CSV/formula injection a nivel de este parser**: descartado como finding DE ESTE MÓDULO — los
  metacaracteres se conservan como TEXTO opaco (comportamiento correcto y deseado, R3.5). La
  neutralización para sinks (filtros `.ilike`) es responsabilidad aguas abajo (`escapeIlike`, ya
  presente). Reportarlo acá sería un falso positivo de límite de capa.
- **"Dependencia sin pinear"** (lente supply-chain): descartado — está pinneada a un tarball exacto
  con versión exacta en el lockfile commiteado; no es un rango `^`/`~`/`latest`.

## Tabla de inputs

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| bytes del archivo `.xlsx` (untrusted, document-picker) | tamaño ≤5 MB (R3.1, service) · filas ≤MAX_ROWS=5000 (`sheetRows`) · celdas/fila ≤MAX_CELLS_PER_ROW=256 | server (cap durante parseo + reject-and-report; reforzado por RPC bulk autoritativo R9.4) | OK |
| celdas / headers (valores) | coerción a `String()`, texto opaco; largo por columna acotado aguas abajo (R3.4, constraints DB) | server (no-eval, valor cacheado; `escapeIlike` antes de sinks) | OK |

> Este módulo es un parser puro (sin UI propia): no introduce formularios/buscadores nuevos. El único
> "input" es el archivo, acotado por los caps de arriba.

## Tabla de rate limits

| acción | rate limit (sí/no/n.a.) | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| corrida de import `.xlsx` (frecuencia) | no (diferido) | per-user/establishment (propuesto) | n.a. | R3.7: control de FRECUENCIA diferido a `docs/backlog.md`, aceptado para MVP (op de oficina autenticada, mismo-tenant, no endpoint público; Gate 1 MEDIUM-4 ya foldeado). Cada corrida SÍ está acotada en tamaño (R3.1/R3.2/R3.3). No es regresión de este run. |

## Archivos analizados

- `app/src/utils/import/parse-xlsx.ts` (nuevo) — parser.
- `app/src/utils/import/parse-xlsx.test.ts` (nuevo) — 14 tests, verdes (corridos con `ts-ext-resolver`).
- `app/package.json` — dependencia `xlsx` (CDN tarball).
- `app/pnpm-lock.yaml` — resolution del tarball.
- `specs/active/12-import-rodeo/requirements.md` R3.8 + `design.md` §4 (contrato/decisión).
- `app/node_modules/xlsx/package.json` — metadata del paquete instalado (scripts/deps).
- Aguas abajo (contexto R3.5): `app/src/services/import-rodeo.ts`, `app/src/utils/import/import-write.ts`
  (`escapeIlike`, `checkFileSize`).

## Cobertura indirecta de Deno / RLS / PowerSync

N/A para este diff. El parser es un util TS puro (corre bajo `node:test`), no toca Edge Functions
(Deno), ni RLS/migrations, ni PowerSync/Realtime, ni BLE. La skill de Sentry cubrió bien el ángulo
relevante (supply-chain JS + prototype pollution); el resto del catálogo RAFAQ (A service-role, C sync,
F SSRF) no aplica a este módulo. El RPC bulk `SECURITY DEFINER` (D2/R9.4) y la RLS de `import_log`
NO son parte de este run — fueron cubiertos por `security_code_12-backend.md`.

---

## Anexo LOW (no bloquea, informativo)

- **LOW — barrera de tamaño descomprimido**: hoy no existe un límite de `octet_length` del XML
  descomprimido independiente de R3.1 (bytes comprimidos). El residual zip-bomb está acotado por la
  doble cota actual y es aceptable para el threat model autenticado. Si en el futuro se abre el import
  a un actor menos confiable o se sube el tope de 5 MB, conviene agregar una cota de descomprimido.
  Ya anotado en la autorrevisión del implementer.
