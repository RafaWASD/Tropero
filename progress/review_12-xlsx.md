# Review — parser .xlsx de feature 12 (R3.8)

**Veredicto: APPROVED**
**Reviewer**: reviewer agent · **Fecha**: 2026-06-06 · **Feature**: 12 (in_progress) · Run aislado: solo parse-xlsx.

> Alcance: app/src/utils/import/parse-xlsx.ts + parse-xlsx.test.ts + progress/impl_12-xlsx.md, contra
> specs/active/12-import-rodeo/requirements.md (R3.8/R3.2/R3.3/R3.5/R3.6/R4.1) + design seccion 4, espejando el
> contrato de app/src/utils/import/parse-csv.ts.

## 1. Contrato intercambiable con parse-csv.ts — OK

- parseXlsx devuelve ParsedXlsxTable = ParsedTable + parseError opcional. El nucleo es la MISMA forma que parse-csv.ts
  (headers, rows, rowsExceeded, cellsExceeded). Reusa el tipo ParsedTable por import directo (parse-xlsx.ts:44), no lo
  redeclara, asi no puede divergir.
- Reusa MAX_ROWS / MAX_CELLS_PER_ROW de parse-csv.ts (un solo tope = 5000; parse-xlsx.ts:44,46). No hay segundo tope.
- parseError es OPCIONAL y aditivo (R3.6): los consumidores CSV existentes lo ignoran; el hook de Fase 4 lo lee para
  distinguir corrupto (abort) de vacio legitimo. Coherente: null / bytes corruptos -> parseError true; workbook
  valido-pero-vacio -> SIN parseError (parse-xlsx.ts:74-76, 92-96, 100-106, 130-132). Test 184-194 lo verifica.

## 2. Cap durante el parseo (R3.3) + reject-and-report (R3.2) — OK

- Cap AL PARSEAR: XLSX.read(data, { sheetRows: MAX_ROWS + 1 }) (parse-xlsx.ts:83-91). Corta la materializacion de celdas,
  no despues. Verificado adversarialmente: test "50k filas NO materializa 50k" (parse-xlsx.test.ts:81-91) deja rows <= MAX_ROWS.
- rowsExceeded con DOBLE detector, sin silent-truncation: (a) sheet['!fullref'] (SheetJS lo setea SOLO cuando sheetRows
  trunco, con dims originales) -> dataRowCountFromRef decodifica el alto original sin materializar (parse-xlsx.ts:108-117,
  184-194); (b) si las filas materializadas > MAX_ROWS (caso MAX_ROWS+1) parse-xlsx.ts:144-148. El excedente NUNCA se
  devuelve (slice(0, MAX_ROWS)).
- Bordes probados: MAX_ROWS exacto -> no excede (93-101); MAX_ROWS+1 -> excede (103-111); MAX_ROWS+500 (66-79) y 50k (81-91)
  -> excede + acotado. Aritmetica header (dataRows = totalRows - 1) verificada.

## 3. Formulas no se evaluan (R3.5) — OK

- cellFormula:false + sheet_to_json({ raw:false }) -> toma el valor CACHEADO/formateado, nunca recomputa (parse-xlsx.ts:
  83-91, 123-128). SheetJS es parser, no motor de calculo.
- Test "celda con FORMULA =1+1 valor cacheado 2 -> '2'" + assert de que '1+1' NUNCA aparece en ninguna celda (test 113-130).
- Test CSV-injection "=cmd() / =HYPERLINK(...) / @SUM(1) / +1+1 -> strings literales" (132-145). La neutralizacion para
  filtros DB vive aguas abajo (escapeIlike del service) — bien documentado, no es responsabilidad de este util.
- Valores numericos/mixtos coaccionados a String (51-64): todo sale como texto opaco, nunca se reexporta a Excel.

## 4. Tests reales, no verde-falso — OK

- 14 tests, todos construyen un workbook REAL en memoria con la MISMA libreria vetada (aoa_to_sheet + write) y lo parsean
  de vuelta — NO hay mock. Ejercitan el path real read(sheetRows) -> sheet_to_json.
- Cubren los 3 casos pedidos: >MAX_ROWS (66-79, 81-91, 103-111), formula (113-130), archivo corrupto (147-155) + null (157-162).
  Mas: primera-hoja-sola (164-182), celdas faltantes rectangulares (196-211), Uint8Array y ArrayBuffer (41-49).
- Ejecutado aislado: 14/14 verde. Dentro de check.mjs: enganchado en run-tests.mjs y corriendo (client unit tests = 542 pass).

## 5. Dependencia vetada (R3.8) — OK (Gate 2 cierra el detalle fino)

- Instalada: xlsx@0.20.3 desde https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz (dominio exacto del CDN oficial, >=0.20.2,
  post-fix de CVE-2023-30533 prototype pollution + CVE-2024-22363 ReDoS). NO es la npm xlsx vulnerable. Registrada en
  app/package.json:47 + app/pnpm-lock.yaml (resolution = tarball del CDN).
- Sin postinstall: inspeccion del paquete instalado -> lifecycle hooks de install (preinstall/install/postinstall/prepare/
  prepublish) = NONE (los scripts build/test/lint que declara no son hooks de install). La bitacora lo documenta con
  precision (impl_12-xlsx.md:39-49). No se allowlisteo nada en onlyBuiltDependencies.
- El analisis fino de superficie/CVE es de Gate 2; aca se confirma que la bitacora lo documenta y que NO rompio nada:
  typecheck verde, check.mjs verde end-to-end.

## 6. Sin tocar lo ajeno — OK (con nota menor de bitacora)

- Solo agrego: parse-xlsx.ts (nuevo) + parse-xlsx.test.ts (nuevo) + la dep en package.json/pnpm-lock.yaml.
- NO toco backend/service/otros utils. parse-csv.ts intacto (solo lo IMPORTA).
- Nota menor (no bloqueante): la bitacora dice "NO toque run-tests.mjs (lo engancha el leader)" (impl_12-xlsx.md:106-110),
  pero scripts/run-tests.mjs SI aparece modificado — el enganche de parse-xlsx.test.ts ya esta aplicado (correcto, al final
  de la lista de client unit tests). Es el enganche esperado de T6.1 (lo hizo el leader). No es regresion ni invasion del run
  del implementer. Anotado para que la bitacora del leader lo refleje.

## Trazabilidad R<n> <-> test (completa)

| R<n> | Verificado por |
|---|---|
| R3.8 (parser vetado SheetJS CDN >=0.20.2, no npm CVE) | parse-xlsx.ts:42 import real + package.json:47/lockfile (tarball CDN); toda la suite usa la lib real. Confirmado xlsx@0.20.3, sin install hooks. |
| R3.2 (rechaza-y-reporta > tope, no trunca) | test "> MAX_ROWS" (66-79), "MAX_ROWS exacto no excede" (93-101), "MAX_ROWS+1 excede" (103-111) |
| R3.3 (cap AL PARSEAR, antes de materializar) | test "50k NO materializa 50k" (81-91) — cap real verificado |
| R3.5 (valor no confiable: no formulas, texto) | test "FORMULA->cacheado" (113-130), "=cmd()->literal" (132-145), "numericos->string" (51-64) |
| R3.6 (parse falla -> no rompe, no escribe) | test "corruptos->parseError" (147-155), "null->parseError" (157-162) |
| R4.1 (headers->{headers,rows}, primera fila) | test "bien formado" (24-39), "solo primera hoja" (164-182), "hoja vacia" (184-194), "celdas faltantes" (196-211) |

## Tasks completas (de este run aislado)

Si, para el alcance del run. Cubre el T1.x faltante de .xlsx (diferido del Run 1 de utils porque necesitaba la lib vetada),
documentado en tasks.md:20 (nota Run .xlsx). Las tasks [ ] restantes (Fase 4 hook/UI, Fase 5 entry point, Fase 6 cierre)
estan FUERA del scope de este run y justificadas en el header de tasks.md; no son deuda de este parser.

## CHECKPOINTS

No existe CHECKPOINTS.md en el repo -> N/A para este run.

## Checklist RAFAQ-especifico

- A (RLS/multi-tenancy): N/A — util puro de parseo, no toca tablas con establishment_id.
- B (offline-first): N/A — parser sin I/O; la escritura online del import vive en el service (otro run).
- C (BLE): N/A.
- D (UI de campo): N/A — sin UI (Fase 4).
- E (Edge Functions): N/A — no es Edge Function.

## Gates duros

- Tests rojos: NO -> 14/14 verde + check.mjs verde (542 client unit tests pass).
- check.mjs rojo: NO -> verde end-to-end.
- R<n> sin test: NO -> los 6 R<n> con >=1 test concreto (tabla arriba).
- Tasks [ ] sin justificacion: NO -> las pendientes son fuera-de-run, documentadas.

## Cambios requeridos

Ninguno bloqueante. Sugerencia (no bloquea el APPROVED): reconciliar la afirmacion "NO toque run-tests.mjs" de
impl_12-xlsx.md:106-110 con el estado real (ya enganchado) al cerrar/commitear, para no dejar la bitacora contradictoria
con el arbol.
