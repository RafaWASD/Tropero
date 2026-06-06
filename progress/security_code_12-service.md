# Security Gate 2 (modo `code`) — Feature 12, Fase 3 SERVICE (capa I/O del import masivo)

**Veredicto: PASS** — 0 HIGH, 0 RAFAQ-SPECIFIC bloqueante. Las 2 notas carry-forward del Gate 2 de utils quedan cerradas (con 1 matiz de orden que es responsabilidad del hook, Fase 4 — ver §Notas para Fase 4).

- **Modo**: `code`. **Baseline**: `e2ee99742fc24f675913c08bc4050904d4f91343` (registrado en `progress/impl_12-service.md`).
- **Alcance**: 2 archivos nuevos (untracked vs baseline):
  - `app/src/services/import-rodeo.ts` — ÚNICA capa I/O (dedup queries + RPC + import_log insert + orquestación).
  - `app/src/utils/import/import-write.ts` — lógica PURA (sin red/DB) + `import-write.test.ts` (tests).
- **Herramienta**: skill `sentry-skills:security-review` (trace-data-flow + verify-exploitability) + checklist RAFAQ + verificación CONTRA EL AS-BUILT real del RPC `0074` y la tabla `0073` (no solo el código del cliente — el contrato server-side es la frontera autoritativa).
- **Naturaleza**: el service procesa **input no confiable a escala** (archivo del usuario, hasta 5000 filas) y lo escribe vía un RPC `SECURITY DEFINER`. El mandato ampliado (límites de input + validación server-side + multi-tenancy) + el Catálogo (A1 service-role/RPC-definer, A2 mass assignment, A3 IDOR-por-FK, B1 information disclosure, E1/E2 DoW) aplican de lleno.

---

## Archivos analizados

| Archivo | Capa | Veredicto |
|---|---|---|
| `app/src/services/import-rodeo.ts` | I/O (dedup, RPC, log, orquestación) | OK |
| `app/src/utils/import/import-write.ts` | PURO (merge dedup, buildRpcRow, chunking, summarize, checkFileSize, escapeIlike) | OK |

Verificado contra el as-built (no solo el cliente): `supabase/migrations/0074_import_rodeo_bulk_rpc.sql` (RPC), `0073_import_log.sql` (tabla + CHECKs + trigger), `0022_rls_animals_and_profiles.sql` (RLS de animals/animal_profiles), `0037_management_groups.sql` (RLS lotes), `app/src/services/animals.ts` (referencia F1-1/escapeIlike), `specs/active/13-hardening-seguridad/design.md` §F1-1 (set canónico de metacaracteres).

---

## Findings HIGH (Sentry + manual)

**Ninguno.** No se identificaron vulnerabilidades HIGH-confidence.

## Findings RAFAQ-SPECIFIC

**Ninguno bloqueante.** Una nota de orden (responsabilidad del hook de Fase 4) abajo, NO un finding del service.

---

## Foco del mandato — resultado por punto

### 1. R3.1 — `checkFileSize` ANTES de leer/parsear (la nota carry-forward) — VERIFICADO con matiz de orden

`checkFileSize` (`import-write.ts:137-150`) es PURO y opera sobre `sizeBytes` (lo da `expo-document-picker`/file-system, **no** se lee el contenido). Es la barrera real contra el char-flood de 1 celda gigante que los utils puros NO atajan (confirmado en el Gate 2 de utils, observación de cobertura). El service lo **re-exporta** (`import-rodeo.ts:48`) para que el hook lo llame ANTES de leer el archivo.

**Matiz honesto (no es un finding del service)**: el ORDEN real "size-check → leer → parsear" lo **ejecuta el hook `useImportRodeo` (Fase 4)**, que no existe todavía. El service de Fase 3 entra recién en `confirmImport`, que recibe `candidates` YA parseadas/validadas — para entonces el archivo ya fue leído. Es decir: la barrera EXISTE y está expuesta, pero su invocación-antes-de-leer es un contrato que **Fase 4 debe cumplir**. Esto es estructural (el service no controla el orden del hook) y está documentado en el header del service (`import-rodeo.ts:160-161` del impl) + el plan "Para Fase 4". **El Gate 2 de la Fase 4 (UI) DEBE verificar que el hook llama `checkFileSize(size)` antes de `parseCsv`/`parseSigsaTxt`** — lo arrastro como nota de carry-forward (abajo). No bloquea este run porque el service no es el punto donde se decide el orden.

Defensa-en-profundidad real ya presente aunque el hook fallara: el RPC `0074:107-110` enforça `jsonb_array_length(p_rows) <= 5000` como tope DURO server-side, y el cap de filas/celdas DURANTE el scan vive en los parsers (Gate 2 utils PASS). El vector de char-flood que estos no cubren es exactamente el que `checkFileSize` ataja — por eso el orden importa, y por eso queda como gate de Fase 4.

### 2. Campos forzados server-side (mass assignment / A2) — VERIFICADO, doble barrera

**`buildRpcRow` (`import-write.ts:216-231`) arma EXACTAMENTE los 10 campos del contrato `p_rows` del header de `0074`** — NO incluye `establishment_id`/`category_id`/`imported_by`/`created_by`/`species_id`/`system_id`/`rodeo_id`. No hay spread del input del cliente (no es `.insert(body)`); cada campo se setea explícitamente. Un test (`import-write.test.ts:150-163`) enumera las keys y FALLA si aparece alguno de los 7 prohibidos.

**Confirmado contra el RPC (la barrera autoritativa, no el cliente)**: aunque un atacante con curl agregara `establishment_id`/`category_id`/`imported_by`/etc. al payload, el RPC `0074` **los ignora**:
- `establishment_id`/`species_id`/`system_id` se derivan del rodeo (`0074:74-78` `select … from rodeos where id = p_rodeo_id`), NO se leen del payload.
- `created_by` lo fuerza el trigger `tg_force_created_by_auth_uid` (`0043`); `imported_by` del log lo fuerza `tg_force_imported_by_auth_uid` (`0073:42-55`, "ignora cualquier valor del payload").
- `category_id` NUNCA viene del cliente: el cliente manda `category_code` TEXTO (`import-write.ts:48-62`, `RpcRow.category_code: string | null`), y el RPC lo resuelve contra `categories_by_system` del system del rodeo (`0074:129-143`). **Confirmado: el cliente manda code texto, no id.**
- `category_override`: el cliente lo manda `true` si hubo columna (`resolveCategory` `import-write.ts:172-178`), pero el RPC lo **fuerza a `false`** si el code no matchea (`0074:135-137`) → no se puede forzar un override falso de una categoría inexistente.

Resultado: incluso un payload hostil no puede inyectar autoría, tenant, especie, sistema ni un category_id de otro catálogo. Doble barrera (cliente honesto + RPC autoritativo).

### 3. Inyección (R3.5 / F1-1 / A1) — VERIFICADO: dedup parametrizado, escape correcto

Las 2 queries de dedup usan `.in('idv', chunk)` (`import-rodeo.ts:126`) y `.in('tag_electronic', chunk)` (`import-rodeo.ts:138`) — el cliente supabase-js serializa el array como filtro `in.(…)` con los valores **como datos**, no por interpolación de string en la gramática del filtro. **Ningún valor del archivo se concatena en un `.or()`/`.filter()`/`.like()`/`.ilike()` en el service** (grep confirmado: el único uso de `escapeIlike` en el repo dentro de un patrón `ilike` es `animals.ts`, no este service). `resolveLotes` (`import-rodeo.ts:166-170`) hace match **en memoria** sobre los nombres normalizados (`normalizeLoteName`), no manda el nombre del archivo a una query — trae los grupos del establishment por `.eq('establishment_id', …)` y matchea client-side. Sin sink de inyección.

`escapeIlike` (`import-write.ts:156-158`, `/[%_,]/g → ' '`) es **idéntico** al de `animals.ts:346-348` (F1-1). Cubre el set canónico que la spec 13 §F1-1 define como suficiente cuando el término va a un `ilike` parametrizado: `% _` (comodines de `ilike`) + `,` (separador de filtros de `.or()` de PostgREST). El set ampliado `% _ , . ( ) : *` + comillas que F1-1 menciona SOLO aplica si el término crudo va dentro de un `.or()` — que acá NO ocurre (el dedup usa `.in()` parametrizado). Por eso `escapeIlike` es **defensa-en-profundidad** correctamente dimensionada para su uso real (por si un valor cayera a un `ilike` futuro); su set es el adecuado para ese caso. Correcto.

### 4. Multi-tenancy / IDOR (A3 / R9.1-R9.2 / R7.2) — VERIFICADO

- **Dedup de `idv`** (`import-rodeo.ts:121-126`): scopeado al establishment activo con `.eq('establishment_id', establishmentId)` + `.is('deleted_at', null)` + RLS (`animal_profiles_select` de `0022:6-7` = `has_role_in(establishment_id) and deleted_at is null`). Doble defensa (filtro explícito + RLS). El `establishmentId` viene del `EstablishmentContext` (parámetro de `confirmImport`), no del archivo. No hay IDOR: un idv de otro tenant no se lee (RLS) y aunque se leyera el `.eq` lo filtra.
- **Dedup de `tag`** (`import-rodeo.ts:133-138`): global por diseño (TAG es unique GLOBAL por SENASA), sin filtro de establishment — **intencional y correcto**. Solo `.select('tag_electronic')`: lee UNA columna, no datos de otro tenant. La RLS `animals_select` (`0022:21-29`) exige que el animal tenga un `animal_profiles` en un establishment donde el caller tiene rol → un tag de OTRO tenant da **falso-negativo** (no visible), que el unique global ataja en el insert (R8.4, `0074:183-186` `unique_violation` → skip+report). NO se usa service-role para anticiparlo (sería el leak cross-tenant que LOW-1 prohíbe). Confirmado: la query no puede leakear `tag_electronic` de otro tenant porque la RLS lo oculta; lo único que "ve" es lo que ya está en su propio scope.
- **El service no puede ser engañado para escribir/leer en otro establishment**: la escritura va 100% por el RPC `import_rodeo_bulk` (`import-rodeo.ts:208-211`), que deriva el establishment del `p_rodeo_id` y **re-valida `is_owner_of`/veterinarian en ESE establishment** (`0074:84-99`) — un rodeo de otro tenant es rechazado (`42501`). El cliente solo pasa `p_rodeo_id` + `p_rows`; no puede dirigir la escritura por payload.
- **`management_group_id`**: el cliente lo resuelve por nombre dentro del establishment (`resolveLotes` con `.eq('establishment_id', …)`), y el RPC lo inserta vía trigger `0037` que valida que el grupo pertenezca al mismo establishment (`0074:36-37`, `162-164`). Un uuid de lote de otro tenant en el payload sería rechazado por el trigger. Sin IDOR-por-FK.

### 5. R11.5 — truncado de `error_details` bajo el CHECK octet_length — VERIFICADO en bytes UTF-8

`summarizeErrorDetails` (`import-write.ts:310-342`) presupuesta a `MAX_ERROR_DETAILS_BYTES = 200*1024` (`import-write.ts:27`), **por debajo** del CHECK real `octet_length(error_details::text) <= 262144` de `0073:31`. El budget se mide con `byteLengthUtf8` (`import-write.ts:374-377`, `TextEncoder().encode(s).length`) → **BYTES UTF-8, no chars** — alineado al `octet_length` de Postgres (test `import-write.test.ts:327-331`: `'ñ' = 2 bytes`). 

Garantía de no-exceder: si el resumen no entra, recorta el `sample` iterativamente (`:330-334`) y, en última instancia, también `by_reason` con `capByReason` (`:336-337`, `:348-367`) hasta `sample: []`. El peor caso (5000 errores con `sqlerrm` largos y ÚNICOS → `by_reason` explota) está testeado (`import-write.test.ts:300-317`) y SIEMPRE entra. **El `summarizeErrorDetails` se llama en `confirmImport` (`import-rodeo.ts:343`) ANTES del insert** (`import-rodeo.ts:262-273`), así que el jsonb que llega al CHECK nunca lo excede → el insert del log no falla por tamaño y el audit no se pierde.

Matiz menor (no-finding): el presupuesto del cliente (200 KiB) deja margen sobre el CHECK (256 KiB), pero el CHECK aplica a `error_details::text` que es la serialización **Postgres** del jsonb, no exactamente la `JSON.stringify` del cliente (espaciado/orden de keys puede diferir en bytes). El margen de 56 KiB cubre holgadamente esa diferencia para los shapes acotados que produce el resumen (objeto chico + sample ≤50). No es exploitable: aunque el cálculo del cliente difiriera un poco del de Postgres, el margen absorbe la diferencia, y si AÚN así fallara, el insert del log devuelve `ok:false` y `confirmImport` sigue con `importLogId: null` (`import-rodeo.ts:355-357`) — la escritura de animales YA ocurrió, el audit es best-effort. Fail-safe, no fail-corrupt.

### 6. DoW / payload sin tope (E1/E2) — VERIFICADO

- **Dedup IN-list**: la lista de identificadores se parte en sub-lotes de `DEDUP_IN_CHUNK = 500` (`import-write.ts:38`, `import-rodeo.ts:120/133`) → para 5000 ids son ~10 queries URL-safe, no un GET con miles de valores que exceda el límite de URL. Previo dedup con `uniqueNonEmpty` (`import-rodeo.ts:111-112`) reduce el N real.
- **Escritura**: `writeInChunks` (`import-rodeo.ts:201-236`) parte en chunks de `CHUNK_ROWS = 150` (`import-write.ts:20`), MUY por debajo del tope del RPC. El RPC enforça su propio tope DURO `<= 5000` por llamada (`0074:107-110`); con chunks de 150 nunca se alcanza. Test `import-write.test.ts:186-191` confirma `CHUNK_ROWS <= 5000` y que 6000 filas chunkean ≤5000.
- **Tope de filas total**: el cap de 5000 filas/corrida (R3.2) lo enforça el parser DURANTE el scan (Gate 2 utils PASS) Y el RPC server-side (`0074:107`). El service no materializa más de lo que recibe en `candidates`.
- **R3.7 (frecuencia de import)**: control diferido por diseño (spec R3.7, backlog) — es op de oficina mismo-tenant autenticado, no endpoint público; la escala ya es posible vía alta unitaria. Documentado, no bloquea. (Nota: el RPC `import_rodeo_bulk` NO tiene rate-limit propio de frecuencia — aceptado para MVP por R3.7; ver tabla de rate limits.)

Sin punto donde un archivo grande genere payload/URL/memoria sin tope.

---

## False positives descartados (trazabilidad)

La skill no levantó findings (el service no tiene sinks de inyección/XSS/deserialización/SSRF; toda escritura va por un RPC parametrizado). Vectores que evalué y descarté tras trazar el data flow:

1. **`nullif(v_row->>'management_group_id', '')::uuid` en el RPC (`0074:177`)** → un `management_group_id` no-uuid del payload causaría un cast error → cae al `when others` (`0074:187-190`) → skip+report de esa fila, NO aborta el chunk ni inyecta nada (jsonb→text→uuid no es un sink de inyección SQL; es un cast tipado). El cliente además solo manda uuids ya resueltos por `resolveLotes` o `null`. Descartado.
2. **`randomUuid()` (`import-rodeo.ts:386-388`, `crypto.randomUUID()`)** → genera el `id` del `import_log`, no un token de seguridad ni nada adivinable-sensible. `crypto.randomUUID` es CSPRNG. No es security-sensitive (es un PK de audit). Descartado.
3. **`classifyError` devuelve `error.message` al caller (`import-rodeo.ts:58-64`)** → es el mensaje de error de Supabase/PostgREST que vuelve al **cliente RN del propio operador autenticado** (no a un tercero ni a un response HTTP público); B1 (information disclosure) aplica a respuestas server→cliente-no-confiable, no a un service del cliente clasificando su propio error de red/DB. El `sqlerrm` por-fila que sí se persiste en `error_details` (`0074:190`) es del RPC y lo acota R11.5 — revisado en §5. No es el patrón B1 de "devolver `err.message` crudo desde una Edge Function". Descartado.
4. **Prototype pollution en `summarizeErrorDetails`/`accumulateChunk`** → `by_reason[key]` (`import-write.ts:319`) usa `e.reason` (texto del RPC, p.ej. `sqlerrm`) como key de un objeto plano. Un `reason = "__proto__"` escribiría `by_reason["__proto__"]` — pero es **asignación de una propiedad numérica a un objeto local efímero** que se serializa con `JSON.stringify` y se inserta como jsonb; no se hace merge recursivo ni se usa la key para indexar `Object.prototype` ni para lookup peligroso. `JSON.stringify({__proto__: 5})` no contamina nada. Además el `reason` lo origina el RPC (server-controlled, `sqlerrm`/`'duplicate'`), no directamente el archivo. Descartado (no exploitable).

---

## Tabla de inputs (campos del payload `p_rows` que derivan del archivo)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| tamaño de archivo | `MAX_FILE_BYTES = 5MB` (`checkFileSize`) | cliente (UX/barrera real) — **el orden lo enforça el hook Fase 4** | ✓ (gate Fase 4) |
| N filas/corrida | 5000 (cap en scan) | cliente (scan) + **RPC `0074:107` tope DURO** autoritativo | ✓ |
| `tag_electronic` | ≤64 + 15 díg `isValidTag` (utils) | cliente + **DB CHECK char_length≤64 + unique global** (RPC insert) | ✓ |
| `idv` | ≤64 | cliente + **DB CHECK** + unique-por-est | ✓ |
| `visual_id_alt` | ≤64 | cliente + **DB CHECK** | ✓ |
| `breed` | ≤64 (texto libre) | cliente + **DB CHECK** | ✓ |
| `sex` | set `male`/`female` | cliente + **enum DB** (RPC CHECK-ea) | ✓ |
| `birth_date` | ISO o null | cliente + **cast `::date` en RPC** (`0074:159`) | ✓ |
| `category_code` (TEXTO) | match-only contra catálogo del system | **resuelto a FK en el RPC** (`0074:129-143`), no insertado crudo | ✓ |
| `category_override` | bool | cliente lo manda; **RPC lo fuerza a false si no matchea** (`0074:135-137`) | ✓ |
| `management_group_id` (uuid) | match-only por nombre (cliente) | **trigger `0037` valida est∈** (RPC) | ✓ |
| `row_index` | int | reporte interno, no se persiste como dato sensible | ✓ |
| `file_name` (log) | `.slice(0,255)` cliente + CHECK ≤255 (`0073:28`) | cliente + **DB CHECK** | ✓ |
| `error_details` (log) | `summarizeErrorDetails` < 200KiB | cliente acota + **DB CHECK octet_length≤256KiB** (`0073:31`) | ✓ |

Todo campo de entrada tiene **límite claro + validación con la DB como capa autoritativa final** (R9.5). El cliente es UX/bypasseable; el RPC `SECURITY DEFINER` + los CHECK/unique/triggers son la frontera real (confirmado contra `0073`/`0074`).

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `import_rodeo_bulk` (RPC bulk) | tope de FILAS por llamada (≤5000, `0074:107`) — **no** rate de frecuencia | per-call (tamaño del fan-out) | sí (rechaza el batch entero >5000) | el N del fan-out por request está capeado (E2: amplificación acotada). El rate de **frecuencia** (muchas corridas seguidas) es R3.7 = control diferido al backlog, aceptado para MVP (op autenticada mismo-tenant, no endpoint público) |
| queries de dedup (idv/tag) | n.a. (SELECT acotado, IN-list en sub-lotes de 500) | per-establishment (RLS) | n.a. | sin escritura; URL-safe; no abusable a escala más allá del cap de 5000 filas |
| insert `import_log` | n.a. | per-establishment (RLS `0073:68-81`) | n.a. | 1 insert por corrida; acotado por R11.4/R11.5 |

El fan-out POR request está capeado (tope DURO server-side), que es el control de DoW relevante para un bulk-insert. La frecuencia queda como control diferido documentado (R3.7), no como hueco silencioso.

---

## Cobertura indirecta de Deno / RLS / PowerSync / BLE

- **Deno / Edge Functions**: N/A — el service corre en el cliente RN; la escritura va por un **RPC plpgsql** (`0074`), no una Edge Function. El RPC fue verificado directamente contra su SQL (authz inline, derivación server-side, tope de filas, import parcial por-fila).
- **RLS / multi-tenant / RPC-definer**: cubierto manualmente (la skill no traza RLS de Postgres ni `SECURITY DEFINER`). Verificado: dedup scopeado (`animal_profiles_select` `0022`), tag global sin leak (`animals_select` `0022` oculta cross-tenant), RPC re-valida rol owner/vet en el establishment del rodeo (`0074:84-99`), triggers de est∈ disparan bajo definer (`0074:162-164`). Sin bypass de tenant.
- **PowerSync**: N/A — el import es online por diseño (R12.1/R12.2); `confirmImport` informa offline sin encolar (`import-rodeo.ts:312-321`), no sincroniza.
- **BLE**: reuso indirecto de `isValidTag`/`normalizeTag` (vía los utils de parseo, no tocados en este run). Trust boundary BLE (spec 04) no se toca.

---

## Notas para el run de UI (Fase 4) — carry-forward

1. **R3.1 — ORDEN del size-check (la nota arrastrada del Gate 2 de utils, AÚN abierta para Fase 4)**: el hook `useImportRodeo` DEBE llamar `checkFileSize(size)` **ANTES** de leer el contenido / llamar `parseCsv`/`parseSigsaTxt`. El service expone la barrera (`checkFileSize` re-exportado) pero NO controla el orden — eso vive en el hook, que no existe todavía. **El Gate 2 de Fase 4 debe verificar empíricamente este orden** (que un archivo de 1 celda de 50MB se rechaza por tamaño antes de materializar). Sin esto, el char-flood que los parsers no atajan queda expuesto.
2. **`error.message` al usuario en la UI**: `confirmImport`/los services devuelven `AppError.message` (mensaje crudo de PostgREST/Supabase). La UI de Fase 4 **no** debería renderizar ese string crudo al operador (puede filtrar detalle de DB); mapear a copy genérico + log interno. No es B1 estricto (es el cliente del propio operador), pero es higiene de UX/seguridad — verificar en Fase 4 que `ImportResultScreen` muestra motivos legibles, no `sqlerrm` crudo.
3. **Roles en el entry point**: el RPC ya bloquea `field_operator` a nivel DB (`0074:84-99`). La UI (R2.4) debe además **no ofrecer** el flujo a `field_operator` (defensa-en-profundidad UX) — verificar en Fase 4.

---

## Conclusión

La capa I/O del import (service + lógica pura) es **segura contra el mandato ampliado**: dedup parametrizado (sin inyección), multi-tenancy enforced por filtro explícito + RLS + RPC `SECURITY DEFINER` que re-valida rol y deriva todo lo sensible server-side (sin mass assignment ni IDOR), `error_details` acotado en bytes UTF-8 bajo el CHECK (audit no se pierde), y fan-out capeado por request (DoW acotado). Los campos forzados server-side (`establishment_id`/`category_id`/autoría/`species_id`/`system_id`) **no se pueden inyectar** ni desde un payload hostil — verificado contra el RPC real, no solo el cliente. Las 2 notas del Gate 2 de utils quedan resueltas, salvo el **orden del size-check que es contrato de Fase 4** (arrastrado como gate de UI, no bloquea este run del service). **PASS.**
