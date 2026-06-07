# Security Gate 2 (modo `code`) — Feature 12, Fase 4 UI (wizard de importación de rodeo)

**Veredicto: PASS** — 0 HIGH, 0 RAFAQ-SPECIFIC bloqueante. **Los 3 carry-forwards del Gate 2 del service quedan CERRADOS** (verificados empíricamente, no por confianza en el implementer — que cortó por TIMEOUT antes de su autorrevisión).

- **Modo**: `code`. **Baseline**: `dfef10f58ab4e264beceac3ad822fff0dec5b308` (registrado en `progress/impl_12-ui.md:1`).
- **Naturaleza del run**: el implementer cortó por timeout de API ANTES de su autorrevisión adversarial. Por eso este gate verifica con rigor reforzado: typecheck corrido a mano (PASS), tests de la capa corridos a mano (15/15 PASS incl. el test de no-leak de sqlerrm), data flow trazado a mano en los 4 focos.
- **Herramienta**: skill `sentry-skills:security-review` (trace-data-flow + verify-exploitability, refs `modern-threats.md` prototype-pollution + `error-handling.md` information-disclosure) + checklist RAFAQ + verificación contra el as-built de las fases previas (hook→service→RPC).

---

## Archivos analizados (diff vs baseline + uncommitted)

| Archivo | Capa | Veredicto |
|---|---|---|
| `app/app/import-rodeo.tsx` | wizard (4 pasos, gates UI) | OK |
| `app/src/hooks/useImportRodeo.ts` | pick/parse/orquestación + size-check | OK |
| `app/src/utils/import/import-ui.ts` | mapeo de motivos→copy + preview model (PURO) | OK |
| `app/app/_layout.tsx` | registro de ruta + `RODEO_DESTINATIONS` | OK |
| `app/package.json` + `pnpm-lock.yaml` | deps nuevas (`expo-document-picker`, `expo-file-system`) | OK |

Verificado contra el as-built de fases previas (no solo el cliente): `app/src/utils/import/column-mapping.ts` (sink de headers), `app/src/utils/import/normalize-row.ts` (`RawMappedRow` tipado fijo), `app/src/services/import-rodeo.ts` (`classifyError`/`mapErrorToCopy` boundary), `app/src/utils/import/import-write.ts` (`checkFileSize`), `progress/security_code_12-service.md` (las 3 notas carry-forward).

Estado de build (timed-out implementer): `pnpm typecheck` → **PASS** (tsc --noEmit clean). `import-ui.test.ts` bajo el resolver del repo → **15/15 PASS**.

---

## Estado de los 3 carry-forwards del Gate 2 del service — TODOS CERRADOS

### Carry-forward #1 (R3.1) — size-check ANTES de leer/parsear: ✓ CERRADO

El ORDEN es correcto y verificado en `useImportRodeo.ts`. La secuencia de `pickFile` es:
1. `DocumentPicker.getDocumentAsync(...)` (`:238`) — el picker da metadata (`asset.size`), NO el contenido.
2. `const size = typeof asset.size === 'number' ? asset.size : NaN` (`:249`).
3. **`checkFileSize(size)` (`:254`) — PRIMERA barrera, sobre `asset.size` en bytes, sin tocar el contenido.** Si `!ok` → `setError` + `return` (`:255-258`).
4. RECIÉN DESPUÉS: `readFileText`/`readFileBytes` (`:271`, `:305`, `:302`) materializan el contenido, y los parsers corren (`:272`, `:303`, `:306`).

`checkFileSize` (`import-write.ts:137-150`) es PURO, opera sobre `sizeBytes`, no lee el archivo. El `MAX_FILE_BYTES = 5MB` (`import-write.ts:14`) rechaza un archivo de **1 celda de 50MB** por tamaño antes de que `readFileText`/`parseCsv` lo materialicen en memoria — el char-flood que el cap de filas del parser NO cubre. **El contrato que el service de Fase 3 no podía garantizar (el orden vive en el hook) está cumplido.** `readFileText`/`readFileBytes` además documentan en su comentario "SOLO se llama DESPUÉS del size-check (R3.1)" (`:151`).

Defensa-en-profundidad redundante aguas abajo: aunque pasara el size-check, los parsers topan a 5000 filas (`recordsExceeded`/`rowsExceeded` → error legible, `:273-280`, `:316-323`) y el RPC enforça `<= 5000` server-side. El size-check es la barrera específica del char-flood; está primero.

### Carry-forward #2 (no sqlerrm crudo al operador): ✓ CERRADO

**Ningún `error.message`/`sqlerrm`/motivo crudo de DB llega al JSX.** Trazado exhaustivo de todos los sinks de error en la UI:

- **`state.error?.message`** (único `.message` renderizado, `import-rodeo.tsx:195` vía `<FormError>`): el hook construye `error` SOLO desde (a) strings de copy fijos en español (`:244`, `:276-279`, `:283`, `:311-314`, `:319-322`, `:327-329`, `:342`, `:353`) o (b) `mapErrorToCopy(error)` (`:170-178`), que hace `switch` **únicamente sobre `error.kind`** (`'offline'`/`'network'`/`'unknown'`) y devuelve copy fijo — **nunca lee `error.message`**. El `classifyError` del service (`import-rodeo.ts:58-63`) sí guarda el `msg` crudo de PostgREST en `AppError.message`, pero ese campo **muere en el boundary del hook**: `mapErrorToCopy` lo descarta. Confirmado por grep: el único `.message` en el JSX es `state.error?.message`.
- **`checkFileSize().message`** (`:256`): es copy UX fijo ("El archivo pesa X MB y supera el máximo…", `import-write.ts:146`), no un error de DB.
- **Motivos por fila en el PREVIEW** (`item.reason`, `import-rodeo.tsx:744`): vienen de `buildPreviewItems` → `rowErrorCopy`/`existingDuplicateCopy`/`intraDuplicateCopy` (import-ui.ts), todos diccionarios `Record<reason, copyFijo>` con fallback fijo. No hay sqlerrm.
- **Motivos write-time en el RESULTADO** (`writeErrorCopy(e.reason)`, `import-rodeo.tsx:814`): este es el ÚNICO punto donde un `reason` puede traer un string crudo del service (en `import-rodeo.ts:224`, un fallo de red de chunk setea `reason = appErr.message`). Pero **SIEMPRE pasa por `writeErrorCopy`** (import-ui.ts:160-166), que lowercasea, matchea substrings conocidos (`duplicate`/`unique`/`23505`) y, para CUALQUIER otra cosa, devuelve el fijo `'No se pudo escribir esta fila.'`. El `appErr.message` crudo nunca se muestra. **Test unitario explícito** `writeErrorCopy: NUNCA devuelve el sqlerrm crudo (nota de seguridad #2)` → PASS.

No hay `{error.message}`, `{e.reason}` sin mapear, `String(error)`, ni `JSON.stringify(err)` en el JSX. Cumple el patrón "generic message to client" de `error-handling.md` §Information Disclosure.

### Carry-forward #3 (field_operator gateado en UI): ✓ CERRADO

`import-rodeo.tsx:85-104` lee el rol del contexto de membership correctamente: `role = estState.status === 'active' ? estState.role : null` (`:85`), `isFieldOperator = role === 'field_operator'` (`:86`). Si `isFieldOperator` → render temprano de `<BlockShell>` con "Solo el dueño o el veterinario pueden importar un rodeo." + botón Volver (`:95-104`), **ANTES de montar el wizard**. El gate es un early-return: el `field_operator` no ve ni el pick de archivo ni ningún paso.

Defensa en profundidad confirmada en 2 capas más abajo: el RPC `import_rodeo_bulk` (`0074:84-99`) re-valida `is_owner_of`/veterinarian a nivel DB (rechaza `42501` si no), así que aunque el gate UI se saltara (cliente attacker-controlled), la escritura falla server-side. El gate UI es la capa de UX/defensa-en-profundidad que pedía la nota #3.

El **routing** (`_layout.tsx`) NO introduce bypass: `import-rodeo` se agrega a `RODEO_DESTINATIONS` (destinos que no se re-rutean al wizard cuando hay rodeo activo) + `<Stack.Screen name="import-rodeo" />`. Es registro de ruta navegable; el gate de rol vive en la pantalla, no en el router (correcto — el router no conoce el rol). El entry point que ofrece el link lo hace OTRO run (no en este diff).

---

## Foco del mandato — resultado por punto

### Superficie de input de la UI (mapeo de columnas + pick) — sin sink nuevo

**Prototype pollution por headers del archivo (atacante-controlado): NO exploitable.** Trazado el data flow completo de los headers:

- Los headers del archivo NUNCA se usan como claves de objeto. El único objeto construido desde datos del archivo es `RawMappedRow` en `rowToRawMapped` (`import-ui.ts:73-85`), que itera sobre el **allowlist fijo `CENSUS_FIELDS`** como keys (`raw[field]`, donde `field ∈ {tag_electronic, idv, …}`) y lee el valor por **índice entero** `cells[col]`. El header solo decide, vía `columnIndexFor(mapping, field)`, QUÉ índice de columna leer — nunca QUÉ key escribir.
- `ColumnMapping` es `(CensusField | null)[]` — un array indexado por posición de columna, no un objeto keyed por header. Un header se transforma SOLO vía `normalizeHeader` (`column-mapping.ts:82-90`: `NFD` → strip diacríticos → lowercase → `[^a-z0-9]+ → ' '` → trim) y se matchea contra un `SYNONYM_INDEX` (`ReadonlyMap`) que produce únicamente `CensusField | null`. No hay `key in source`, no hay merge recursivo, no hay `obj[userControlledKey] = ...`.
- `RawMappedRow` (`normalize-row.ts:58+`) es un tipo de shape FIJO (keys = census fields conocidos). Un header `"__proto__"` normaliza a `"proto"` (los `_` → espacio → trim) y, aunque matcheara algo, solo seleccionaría un `CensusField` del enum. Imposible contaminar `Object.prototype`.

Coincide con los patrones SAFE de `modern-threats.md` (claves fijas / no-merge-de-input). **No es un finding.**

**`expo-document-picker` filtra por tipo pero la seguridad real es server-side: correcto.** `pickFile` pasa `type: SPREADSHEET_MIME|SIGSA_MIME` (`useImportRodeo.ts:128-135, 235`) — esto es un filtro de UX del picker, fácilmente bypasseable (el usuario elige "todos los archivos", o el MIME miente). El código NO confía en ello: el `format` se deriva de la EXTENSIÓN (`deriveFormat`, `:138-141`) solo para elegir el parser (csv/xlsx/sigsa), y la validación autoritativa de cada VALOR ocurre aguas abajo (parsers → `validateRows` → CHECKs/unique del RPC `SECURITY DEFINER`, verificado en el Gate 2 del service). Un archivo renombrado a `.csv` que sea basura cae en `parseError`/`rowsExceeded`/0-filas → error legible, no crash. Correcto.

### Dependencia (`expo-document-picker` / `expo-file-system`) — oficiales, sin postinstall

- **`expo-document-picker@56.0.4`** y **`expo-file-system@56.0.7`**: `repository` apunta a `github.com/expo/expo` (monorepo oficial, `directory: packages/expo-{document-picker,file-system}`). **NO typo-squat.**
- **Sin postinstall malicioso**: los `scripts` son solo el tooling estándar `expo-module` (`build`/`clean`/`lint`/`test`/`expo-module`) — NO hay `postinstall`/`preinstall`/`install` que corra en el install del consumidor.
- **Versionado**: alineadas a la línea SDK 56 (`~56.0.x`), peer `expo: '*'` resuelto contra `expo@56.0.4`. Lockfile pinea integrity SHA-512 (`sha512-75Apf74…`, `sha512-dcKzo8…`). Resolución determinista.
- Consistente con la defensa anti-postinstall del repo (pnpm + `onlyBuiltDependencies`, memoria de proyecto).

---

## False positives descartados (trazabilidad)

La skill no levantó findings HIGH (el wizard no tiene sinks de inyección/XSS/deserialización/SSRF/merge-de-input). Vectores evaluados y descartados tras trazar el data flow:

1. **Prototype pollution por headers** (modern-threats.md §Prototype Pollution): descartado — headers nunca son keys; `RawMappedRow` tiene shape fijo; `ColumnMapping` es array por índice. Ver §Superficie de input.
2. **Information disclosure de `error.message`** (error-handling.md §Information Disclosure): descartado — `mapErrorToCopy` switchea sobre `kind`, no lee `message`; `writeErrorCopy` lava cualquier reason crudo. Test unitario lo cubre. Ver carry-forward #2.
3. **`catch {}` que traga excepciones** (`useImportRodeo.ts:243`, `:340`): los `catch` del pick/lectura NO son fail-open de seguridad — setean un error legible + `setError` y abortan el flujo (no continúan a escribir). No hay decisión de autorización dentro del `try`. No es el patrón fail-open de error-handling.md. Descartado.
4. **`readFileText` usa `fetch(uri)` en web** (`:155`): el `uri` es el `blob:`/`file:` URI que devuelve el propio picker para el archivo que el usuario YA eligió localmente — no es una URL atacante-controlada apuntando a un host (no es SSRF; corre en el cliente, no en un server). Descartado.
5. **`router.replace`/`router.push` con rutas** (`:113`, `:228`): destinos son string literals constantes (`/rodeos`, `/crear-rodeo`, `/(tabs)`), no input de usuario. Sin open-redirect. Descartado.

---

## Tabla de inputs (campos NUEVOS/modificados que el usuario aporta en la UI)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| archivo (pick) | `MAX_FILE_BYTES = 5MB` ANTES de leer (R3.1) | cliente (barrera real de char-flood) — **orden verificado en el hook** | ✓ |
| tipo de archivo (MIME) | filtro del picker (`SPREADSHEET_MIME`/`SIGSA_MIME`) | solo-cliente (UX, bypasseable) — **la validación de valores es server-side (parsers + RPC)** | ✓ |
| headers del archivo | opacos, normalizados (`[a-z0-9 ]`), match contra allowlist fijo | cliente (solo seleccionan índice de columna; nunca son keys) | ✓ |
| mapeo columna→campo | `field ∈ CensusField` enum cerrado; `columnIndex` validado in-range (`applyMappingOverride:149`) | cliente (UX) + **DB CHECKs/unique** aguas abajo (Gate 2 service) | ✓ |
| valores de celda (idv/tag/sexo/…) | caps + validación por fila | cliente (`validateRows`) + **DB CHECK/enum/unique del RPC** (autoritativo) | ✓ |

Cada campo de entrada de la UI tiene límite claro + la validación autoritativa final en la DB (verificado en el Gate 2 del service). El cliente es UX/bypasseable; el RPC `SECURITY DEFINER` + CHECKs/unique/triggers son la frontera real.

## Tabla de rate limits (acciones abusables tocadas por el diff de UI)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| pick + parse local | n.a. | per-device | n.a. | parseo LOCAL (R12.1), sin red; acotado por size-check (5MB) + cap de filas (5000) |
| `confirmImport` (escritura) | tope de FILAS por llamada (≤5000) — **no** rate de frecuencia | per-establishment (RPC re-deriva del rodeo) | sí (RPC rechaza batch >5000) | mismo control que el Gate 2 del service: fan-out capeado por request; frecuencia = R3.7 diferido al backlog (op autenticada mismo-tenant, no endpoint público). La UI no afloja nada |

La UI no introduce ninguna acción abusable nueva sin control: hereda el cap de fan-out del RPC y agrega el size-check del pick. La frecuencia de import queda como control diferido documentado (R3.7), igual que en el service.

---

## Cobertura indirecta de Deno / RLS / PowerSync / BLE

- **Deno / Edge Functions**: N/A — esta capa es UI React Native; la escritura va por el RPC plpgsql `0074` (verificado en el Gate 2 del service).
- **RLS / multi-tenant**: heredado del service/RPC (no se toca en la UI). El `establishmentId` viene del `EstablishmentContext` (`useImportRodeo.ts:186`), no del archivo; el RPC re-deriva todo lo sensible. La skill no traza RLS de Postgres — cubierto manualmente en el Gate 2 del service.
- **PowerSync**: N/A — import online por diseño (R12.1/R12.2); el guard de offline vive en el service (`mapErrorToCopy('offline')`), no encola.
- **BLE**: reuso indirecto de `normalizeTag`/`isValidTag` vía `normalize-row` (fase previa, no tocado). Trust boundary BLE (spec 04) no se toca.

---

## Conclusión

La capa de UI del import (wizard + hook + helpers de copy) es **segura**: el size-check corre ANTES de materializar el archivo (carry-forward #1 ✓, char-flood de 50MB rechazado por bytes), ningún `error.message`/`sqlerrm` crudo de la DB llega al operador (carry-forward #2 ✓, `mapErrorToCopy` switchea sobre `kind` y `writeErrorCopy` lava todo reason — con test unitario), y `field_operator` no ve el wizard (carry-forward #3 ✓, early-return + RPC server-side de respaldo). La superficie de input nueva (headers del archivo + mapeo + pick) NO introduce sinks: los headers nunca son claves de objeto (sin prototype pollution — son índices contra un allowlist fijo), el MIME del picker es UX y la validación real es server-side, y las deps nuevas son módulos oficiales de Expo sin postinstall. **Pese a que el implementer cortó por timeout antes de su autorrevisión, el typecheck pasa, los 15 tests de la capa pasan, y los 3 carry-forwards quedan empíricamente cerrados. PASS.**
