# Security Gate 2 (modo `code`) — Feature 12, utils puros de parseo/validación

**Veredicto: PASS** — 0 HIGH, 0 RAFAQ-SPECIFIC bloqueante.

- **Modo**: `code`. **Baseline**: `ebec9d5` (registrado en `progress/impl_12-utils.md`).
- **Alcance**: 6 utils PUROS + sus tests en `app/src/utils/import/` (untracked vs baseline — son nuevos).
- **Naturaleza**: funciones puras, sin I/O, sin red, sin DB, sin `establishment_id`. Procesan **input no confiable a escala** (archivo subido por el usuario). El mandato ampliado (límites de input + validación + DoW) aplica de lleno; los dominios de authz/RLS/secrets/multi-tenant **no** aplican a esta capa (viven en el service/RPC — otro run, ver `security_code_12-backend.md`).
- **Herramienta**: skill `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability) + checklist RAFAQ + **verificación empírica** de los vectores (proto pollution, ReDoS, cap-durante-scan, char-flood).

---

## Archivos analizados

| Archivo | Rol | Veredicto |
|---|---|---|
| `parse-csv.ts` | parser CSV (RFC-4180-ish), cap filas/celdas durante scan | OK |
| `parse-sigsa-txt.ts` | parser TXT SIGSA posicional, cap registros durante scan | OK |
| `breed-senasa.ts` | lookup código SENASA → nombre (32 códigos) | OK |
| `column-mapping.ts` | auto-detección + override de mapeo header→campo | OK |
| `normalize-row.ts` | normaliza sexo/fecha/TAG/raza + topes de largo | OK |
| `validate-rows.ts` | validez por fila + dedup intra-archivo | OK |

Tests revisados (no son target de hallazgos, pero confirman comportamiento): las 6 suites `.test.ts` (72 tests). Cubren cada vector con casos hostiles explícitos.

---

## Findings HIGH (Sentry + manual)

**Ninguno.** No se identificaron vulnerabilidades HIGH-confidence.

## Findings RAFAQ-SPECIFIC

**Ninguno bloqueante.** Una observación de cobertura (no-finding) abajo.

---

## Foco del mandato — resultado por punto

### 1. DoW / cap durante el parseo (R3.3) — VERIFICADO en código + empírico

El cap de filas corta **DURANTE el scan**, no después de materializar. `parse-csv.ts`
escanea char-by-char; `commitRecord` (`parse-csv.ts:164-175`) hace `break` al alcanzar
`MAX_ROWS+1` y NO materializa el registro excedente (`state.current = []`). `parse-sigsa-txt.ts`
hace lo mismo en `flush()` (`parse-sigsa-txt.ts:83-94`) con `return` temprano al tope.

Prueba empírica: 50.000 filas de entrada → **exactamente 5.000** materializadas,
`rowsExceeded=true`, en 12ms. Confirmado: no se materializa el excedente. Un archivo de
10⁷ filas se corta temprano, no congela ni OOM por conteo de filas.

### 2. ReDoS — VERIFICADO: ninguna regex peligrosa

Inventario completo de regex sobre input del atacante, todas **lineales** (anclas +
char-classes + cuantificadores no anidados, sin alternancia solapada ni `(x+)+`):

| Regex | Archivo:línea | Forma |
|---|---|---|
| `/^\d{15}$/` | `parse-sigsa-txt.ts:55` | conteo fijo anclado |
| `/^(\d{4})-(\d{2})-(\d{2})$/` | `normalize-row.ts:112` | conteo fijo anclado |
| `/[/\-.]/` (split) | `normalize-row.ts:115` | char-class |
| `/^\d+$/` | `normalize-row.ts:220` | un solo `+` anclado |
| `/[̀-ͯ]/g`, `/[^a-z0-9]+/g` | `column-mapping.ts:87-88` | char-class |

Prueba empírica (inputs adversariales de 2M chars / 50k separadores / 100k espacios):
todas corren en **1-3ms**. Sin backtracking catastrófico.

### 3. Valores no confiables / formula injection (R3.5) — VERIFICADO

Ningún parser interpreta, evalúa, ni construye nada ejecutable. Toda celda es texto opaco.
`parse-csv.ts` trata `=cmd()` / `=HYPERLINK(...)` como string literal (test explícito,
`parse-csv.test.ts:45-52`). No hay `eval`/`Function`/`new Function`/template execution en
ninguno de los 6 archivos. La neutralización de metacaracteres para filtros DB (`escapeIlike`)
es responsabilidad del **service** (downstream, R3.5/F1-1) — correctamente fuera de esta capa
pura, documentado en los headers de `parse-csv.ts:13-15`.

### 4. Topes de largo (R3.4) — VERIFICADO con un matiz no-finding

`normalize-row.ts` aplica `FIELD_CAPS` (espejo de los CHECK `char_length` de 0070) a
`idv`/`visual_id_alt`/`breed` vía `normalizeCapped` (`normalize-row.ts:164-178`): un campo
sobre-tope se vuelve `null` + issue → la fila se marca error en `validate-rows.ts`
(`field_over_cap`) y **no se escribe**. No trunca silencioso. TAG va por el parser real
(`isValidTag` 15 díg).

**Matiz verificado (no-finding)**: `category` y `lote` (`normalize-row.ts:206-207`) usan
`normalizeText` SIN cap. Tracé el data flow: ninguno se escribe verbatim — `category` se
matchea contra el catálogo `categories_by_system` por `code` (R10.3; no-match → "a completar"
R10.5) y `lote` contra `management_groups` por nombre (R10.4; no-match → `NULL`, no se crea).
Un valor gigante simplemente no matchea nada. Correcto por diseño (comentado en
`normalize-row.ts:212`). El service debe seguir resolviéndolos por match, no insertarlos crudos
(ya es su contrato — verificar en el run de service).

### 5. Prototype pollution — VERIFICADO: ninguna, en código + empírico

Único acceso por bracket con key del atacante: `breed-senasa.ts:66`
(`SENASA_BREEDS[trimmed.toUpperCase()]`) y `:75` (`trimmed.toUpperCase() in SENASA_BREEDS`).
Ambos son **lecturas** (no escritura → no hay pollution posible) y siempre uppercasean, así
que nunca matchean `__proto__`/`constructor`/`prototype` (lowercase). El mapeo header→campo
de `column-mapping.ts` usa un **`Map`** (`SYNONYM_INDEX`, `:93`), no un objeto plano — `.get()`
sobre Map trata `__proto__` como key común. El resultado siempre es un `CensusField` de un set
fijo; las keys del atacante nunca se usan como key de escritura en objeto plano.

Prueba empírica: `breedNameFromCode("__proto__"|"constructor"|"toString")` → devuelve el string
literal (fallback `?? trimmed`), `isKnownBreedCode(...)` → `false`, y `Object.prototype`
queda intacto tras las llamadas.

### 6. Validación robusta / fail-safe — VERIFICADO: never throws

Las 6 funciones públicas son fail-safe ante input basura:
- guards `typeof !== 'string'`/`!Array.isArray` al inicio de cada entry point
  (`parse-csv.ts:60`, `parse-sigsa-txt.ts:68`, `column-mapping.ts:83/126`,
  `normalize-row.ts:91/107/157`, `breed-senasa.ts:63/72`).
- `parseBirthDate`/`buildDate` rechazan rangos inválidos y overflow (13/13, 31/02, día 32,
  mes 00) con round-trip UTC → `null` sin throw (`normalize-row.ts:139-149`; tests
  `normalize-row.test.ts:55-63`).
- registro SIGSA malformado → record con `error`, NO rompe el resto (`parse-sigsa-txt.ts:111-138`;
  tests "no rompe el resto").
- TAG/sexo/fecha maliciosos → `null` + issue, nunca excepción.
- tests de input no-string (`null`/`undefined`) en cada suite → resultado vacío defensivo.

---

## False positives descartados (trazabilidad)

La skill no levantó findings sobre estos archivos (es código puro sin sinks de inyección/I/O).
Vectores que evalué y descarté tras trazar el data flow:

1. **`breed-senasa.ts` bracket-access con key del atacante** → descartado: lectura, no
   escritura; uppercase nunca alcanza keys de prototipo; sin uso peligroso del valor leído.
2. **`column-mapping` mapeo header→campo** → descartado: usa `Map`, no objeto plano; output
   de set fijo.
3. **`category`/`lote` sin cap** → descartado: no se escriben verbatim (match-only downstream).

---

## Tabla de inputs (campos que el usuario controla vía el archivo)

| campo | límite | validación (server / cliente / ausente) | OK? |
|---|---|---|---|
| filas (N) | `MAX_ROWS=5000`, cap durante scan | cliente (UX/perf) + DB autoritativa (R9.5) | ✓ |
| celdas/fila | `MAX_CELLS_PER_ROW=256` | cliente | ✓ |
| registros SIGSA | `MAX_SIGSA_RECORDS=5000`, cap durante scan | cliente | ✓ |
| `idv` | `≤64` (espejo 0070) | cliente + **DB CHECK** autoritativa | ✓ |
| `visual_id_alt` | `≤64` | cliente + **DB CHECK** | ✓ |
| `breed` | `≤64` | cliente + **DB CHECK** | ✓ |
| `tag_electronic` | `isValidTag` 15 díg (parser real) | cliente + **DB CHECK ≤64 + unique** | ✓ |
| `sex` | set cerrado → `male`/`female`/null | cliente + enum DB | ✓ |
| `birth_date` | rango+overflow validado → ISO o null | cliente + DATE DB | ✓ |
| `category` | match-only contra catálogo (no verbatim) | resuelto a FK en service | ✓ |
| `lote` | match-only contra `management_groups` (no verbatim) | resuelto a FK en service | ✓ |
| headers (mapeo) | set fijo de `CensusField` vía Map | cliente | ✓ |

Todo campo de entrada tiene **límite claro + validación**, con la **DB como capa
autoritativa final** (R9.5). El cap del cliente es barrera UX/perf; la spec lo declara
explícitamente y el run de service/RPC (Gate 2 backend) verifica el enforcement server-side.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| parseo/validación local | n.a. | n.a. | n.a. | utils puros sin red ni I/O; no son endpoint. Rate-limit de **frecuencia de import** es R3.7 (control diferido, backlog) y vive en service/RPC — no en esta capa |

---

## Cobertura indirecta de Deno / RLS / PowerSync / BLE

- **Deno / Edge Functions**: N/A — estos utils corren en el cliente RN, no en Deno.
- **RLS / multi-tenant / service-role**: N/A a esta capa (sin `establishment_id`, sin queries).
  Se verifica en el run de service + RPC `import_rodeo_bulk` (`security_code_12-backend.md`).
- **PowerSync**: N/A — el import es online por diseño (R12.1), no sincroniza.
- **BLE**: reuso de `parser-rs420.ts` (`normalizeTag`/`isValidTag`) — solo IMPORTADO, no
  modificado; el trust boundary BLE (spec 04) no se toca acá.

**Observación de cobertura (defense-in-depth, NO finding HIGH)**: estos utils no se
autoprotegen del **char-flood** — una sola celda CSV entrecomillada sin cerrar acumula char
a char sin tope de longitud por campo durante el scan (`parse-csv.ts:128`, `state.field += ch`;
mismo patrón en `parse-sigsa-txt.ts:102`, `chunk += ch`). Probado: una celda abierta de 8M
chars materializa un string de 8M (406ms, ~8MB, no OOM). El cap de **filas/registros** no se
dispara porque no hay separador de registro. La defensa real es **R3.1 (tope de 5 MB de tamaño
de archivo, ANTES de parsear)**, que la spec asigna al service/UI — fuera del alcance de los
utils puros. Con R3.1 enforced upstream, el input a estos parsers nunca supera 5 MB y el vector
queda cubierto. **Gate 2 del run de service debe confirmar que R3.1 (rechazo por tamaño) se
aplica antes de llamar a `parseCsv`/`parseSigsaTxt`.** No bloquea este run.

---

## Conclusión

Los 6 utils puros de parseo/validación son **fail-safe, sin ReDoS, sin prototype pollution,
sin interpretación de valores no confiables, con cap-durante-scan correcto y topes de largo
espejo de 0070**. Cada vector del mandato fue verificado en código y comprobado empíricamente.
El único vector residual (char-flood en una sola celda) está cubierto por R3.1 upstream
(responsabilidad del service, no de esta capa). **PASS.**
