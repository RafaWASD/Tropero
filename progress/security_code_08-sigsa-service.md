# Gate 2 (security_analyzer, modo code) — spec 08 SIGSA, capa de servicio

**Veredicto: PASS** — 0 HIGH / 0 MEDIUM. (Reporte devuelto inline por el agente; persistido por el leader.)

Alcance: `sigsa-export-service.ts`, `useExportSigsa.ts`, builders SIGSA en `local-reads.ts` (2833-3030), dep `expo-sharing`.
Metodología: sentry-skills:security-review (data-flow → exploitability → HIGH only). Capas DB/PowerSync ya gateadas
(`security_code_08-sigsa-db.md` + `security_code_08-sigsa-t7-powersync.md`).
Verificación: typecheck exit 0; 23/23 unit tests del service. (check.mjs NO corrido — flake Animal suite, ajeno.)

## Findings: ninguno (HIGH ni MEDIUM, Sentry ni RAFAQ-specific).

## Foco-por-foco
1. **SQLi local**: CLEAR — los 5 builders usan `?` placeholders + `args.push`; único literal interpolado es `status='active'` (constante). `buildPendingSigsaAnimalsQuery` (local-reads.ts:2914-2926); `establishmentId` (:2912), `exportLogId` (:3011) parametrizados.
2. **Path traversal en `saveAndShare(fileName)`**: CLEAR — `buildFileName` (useExportSigsa.ts:111) hace `.replace(/[^a-z0-9]+/g,'-')` → colapsa `/ \ . :` + null bytes. 13 payloads probados empíricamente (`../../../etc/passwd`, `..\..\windows`, `con:$tream`, etc.), todos neutralizados. `new File(Paths.cache, fileName)` confinado. redownload reusa `file_name` ya saneado al escribir.
3. **Information disclosure**: CLEAR — `mapError` (useExportSigsa.ts:89-95) reemplaza errores `unknown` por copy genérica; el crudo del SO/SQL no llega a la UI (B1 OK).
4. **expo-sharing dep**: CLEAR — first-party Expo 56.0.18, SDK-56-aligned, integrity-pinned (sha512), sola dep `@expo/config-plugins`, sin postinstall lifecycle. Lockfile +51 líneas solo inserciones.
5. **RFID logging**: CLEAR — 0 `console.*` en ambos archivos; el TXT solo va a cache + share sheet del usuario + `export_log.file_content` (INSERT parametrizado).

## Catálogo RAFAQ (cliente)
- A2 mass assignment: N/A — INSERTs enumeran columnas explícitas (no spread de body).
- A1/A3 authz/IDOR: server-side, ya gateado (0111/0112). Cliente NO re-enforza (correcto); NO manda `declared_by`/`generated_by` (tests lo aseguran). `establishment_id` por param, nunca hardcode.
- Rate-limit: N/A — sin Edge Function nueva, sin email/SMS/API externa, sin bulk fan-out. Escrituras por cola de sync de PowerSync.

## Inputs
| campo | límite | validación | OK? |
|---|---|---|---|
| rodeoId | UUID, bound param | server (param) | sí |
| dateFrom/dateTo | ISO date, bound param | server (param) | sí |
| fileName | derivado; slug [a-z0-9-], ≤80; CHECK DB ≤255 | server (regex + CHECK) | sí |

## Nota al leader (no finding)
El add de `expo-sharing` (package.json + pnpm-lock.yaml) está sin commitear junto al resto de la capa.
Foldear el lockfile en el mismo commit que el código del servicio.
