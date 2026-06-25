baseline_commit: 559864423de4ee53fb02d33c40dbe090481210d6

# impl 08 — SIGSA export: capa de servicio (T11, T12, T19, T20)

> Feature en curso: **08-export-sigsa**, chunk **capa de servicio / hook** (P3 del plan del leader).
> NO incluye UI (T13-T18), DB (T1-T6, ya aplicada+gateada) ni PowerSync (T7, ya hecho+gateado).
> La capa PURA (T8/T9/T10: types + generador TXT + validador) se REUSA tal cual.

## Pre-condiciones verificadas
- Spec 08 aprobado: Puerta 1 PASS + Gate 1 PASS (2026-06-13). 3 archivos presentes en `specs/active/08-export-sigsa/`.
- Capas previas DONE+gateadas (ver `current.md`): pura (T8-T10), DB (0107-0112 aplicadas), PowerSync (T7).
- ⚠ **DISCREPANCIA de bookkeeping**: `feature_list.json` marca la feature `spec_ready`, no `in_progress`.
  El `current.md` y el commit log muestran la feature ACTIVA en implementación (P0/P1/P2 done; P3 = esta task).
  El label es lag multi-terminal (el leader flipea statuses en reconvergencia). El leader me dispatchó este
  chunk explícitamente. Procedo. NO toco `feature_list.json` (lo reconcilia el leader). FLAG en el reporte.

## Plan (tasks de esta sesión)
- [ ] **T11** `sigsa-export-service.ts`: `queryPendingAnimals` (query local SIN JOIN animals, columnas
      denormalizadas 0079) + `saveAndShare` (expo-file-system File API + expo-sharing) + `persistDeclarations`
      (INSERT local 1 export_log + N sigsa_declarations; SIN declared_by/generated_by — los fuerza el trigger).
- [ ] **T12** `useExportSigsa.ts`: orquesta cargar pendientes → validateForExport → generateSigsaTxt →
      saveAndShare → persistDeclarations. Estado: pendingAnimals, exportableCount, incompleteAnimals,
      isGenerating, lastExport.
- [ ] **T19** `markAsDeclared(animalProfileId, establishmentId)`: INSERT 1 sigsa_declarations SIN export_log_id.
- [ ] **T20** `redownload(exportLogId)`: lee file_content de export_log local → saveAndShare. NO inserta declaraciones.
- [ ] Builders de SQL puros en `local-reads.ts` (query pendientes + inserts) + tests node:sqlite.
- [ ] Registrar el test nuevo en `scripts/run-tests.mjs`.
- [ ] Verificación: `pnpm typecheck` + `node --test` sobre los tests nuevos (NO check.mjs completo — flake del huérfano del leader en el Animal suite).

## Decisión de dependencia
- `expo-sharing` NO estaba instalado. La feature lo requiere (design.md §"Flujo de datos": `Sharing.shareAsync`).
  Agregado `expo-sharing: ~56.0.16` (canal SDK-aligned 56.0.x del repo, igual que expo-file-system/document-picker)
  → instaló 56.0.18. Lockfile diff = +51 líneas, SOLO inserciones; deps críticas intactas (powersync/supabase/
  tamagui/expo-router/file-system/document-picker OK). `expo-file-system` v56 usa el File API moderno
  (`new File(dir, name).create()/.write(content)`), ya usado en el repo (useImportRodeo `new File(uri).text()`).

## Patrón de PowerSync seguido (read + write)
- LECTURA: `build<Algo>Query` puro en `local-reads.ts` → `{sql,args}` → el service hace `runLocalQuery(...)`
  (local-query.ts) y mapea. NO re-scopea tenant (la stream ya scopeó); SÍ conserva filtros de dominio.
- ESCRITURA: `build<Algo>Insert` puro → `runLocalWrite(...)` → PowerSync encola 1 CrudEntry por statement →
  uploadData sube al reconectar. El local write SIEMPRE devuelve ok offline; el reject de RLS (no-owner) lo
  resuelve uploadData (descarta + superficia), NO el return. `id` de cliente. `declared_by`/`generated_by`
  (audit) los FUERZA el trigger server-side (0111/0112) → NO se mandan (igual que created_by en los CRUD del repo).

## Archivos
- **NUEVO** `app/src/services/sigsa/sigsa-export-service.ts` — boundary de I/O (T11/T19/T20 + soporte historial).
- **NUEVO** `app/src/hooks/useExportSigsa.ts` — hook de orquestación (T12).
- **NUEVO** `app/src/services/sigsa/sigsa-export-service.test.ts` — 23 tests node:test+node:sqlite (puros, sin device).
- **EDIT** `app/src/services/powersync/local-reads.ts` — sección SIGSA: `buildPendingSigsaAnimalsQuery`,
  `buildExportLogInsert`, `buildSigsaDeclarationInsert`, `buildExportLogContentQuery`, `buildExportLogHistoryQuery`
  + tipos `SigsaPendingRow`/`SigsaPendingFilters`.
- **EDIT** `app/src/package.json` + `app/pnpm-lock.yaml` — `expo-sharing ~56.0.16` (→56.0.18).
- **EDIT** `scripts/run-tests.mjs` — registrado el test nuevo en la línea de "client unit tests".
- **EDIT** `specs/active/08-export-sigsa/design.md` — changelog AS-BUILT (reconciliación, abajo).
- (NO tocado: tasks.md checkboxes — el implementer NO marca tasks; lo hace el reviewer/leader.)

## Tasks (estado real, NO reflejado en tasks.md por la regla)
- [x] **T11** queryPendingAnimals + saveAndShare + persistDeclarations.
- [x] **T12** useExportSigsa (pendingAnimals/exportableCount/incompleteAnimals/isGenerating/lastExport + history/error/filters).
- [x] **T19** markAsDeclared (export_log_id NULL + copy decidido).
- [x] **T20** redownload (read-only de file_content, no inserta declaraciones).

## Trazabilidad R → archivo → test
| R | dónde se cubre (archivo) | test concreto |
|---|---|---|
| R4.1/R4.3 (export_log + filtros + file_content) | `buildExportLogInsert` (local-reads) + `persistDeclarations` (service) | `buildExportLogInsert: 1 fila…` + `…inserta exactamente 1 fila…` + `export completo (comportamiento)…` |
| R4.2/R4.4 (RLS + generated_by forzado) | NO se manda generated_by (trigger 0112) | `buildExportLogInsert: …SIN generated_by` + `…generated_by NULL local` |
| R5.3 (nombre de archivo `sigsa_<slug>_<YYYYMMDD_HHMMSS>.txt`) | `buildFileName` (useExportSigsa) | typecheck + cubierto por el flujo (formato verificado en design AS-BUILT; la UI lo muestra) |
| R5.4/R14.1 (generación local offline) | `generateSigsaTxt` (puro) + `saveAndShare` (sin red) | (offline-first por construcción: sin imports de red en el path; ver §autorrevisión) |
| R5.6 (UTF-8 sin BOM) | `File.write(string)` no antepone BOM | (capa pura ya testea no-BOM; el service escribe el string tal cual) |
| R9.1 (pendientes = tag NOT NULL + sin sigsa_declarations) | `buildPendingSigsaAnimalsQuery` | `…excluye DECLARADOS…` + `…excluye tag NULL…` + `…NO referencia animals` |
| R9.2 (filtro rodeo) | `buildPendingSigsaAnimalsQuery` (rodeoId) | `…filtro por rodeo_id (T11 test c)` + `…filtros opcionales rodeo + rango…` |
| R9.3 (filtro rango fecha nacimiento) | `buildPendingSigsaAnimalsQuery` (dateFrom/dateTo) | `…filtro por rango de fecha (T11 test d)` |
| R9.4 (no filtra por categoría) | la query NO tiene cláusula de category | (por ausencia: el SQL no menciona category) |
| R9.5 (vacío → mensaje + historial) | `useExportSigsa` (exportableCount=0 + history) | `exportableCount=0 … (T12 test a)` |
| R10.1 (re-descarga sin nueva declaración) | `redownload` + `buildExportLogContentQuery` | `buildExportLogContentQuery: …sin escribir (T20 test b)` + `re-descarga (comportamiento): mismo file_content (T20 test a)` |
| R10.2 (marca manual) | `markAsDeclared` + `buildSigsaDeclarationInsert(…, null)` | `export_log_id NULL = marca manual (T19 test b)` + `…el animal DESAPARECE de pendientes (T19 test a)` |
| R11.1/R11.2 (audit export_log + sigsa_declarations) | `persistDeclarations` (1 log + N decl ligadas) | `export completo (comportamiento)…` (decl con export_log_id) |
| R14.1 (generación local sin round-trip) | service: query/persist locales; solo saveAndShare toca device | (sin imports de red en el path de generación) |
| R14.2 (inserts por cola de sync, scope org) | `runLocalWrite` (CrudEntry → uploadData); scope lo da la stream T7 | (contrato runLocalWrite; scope verificado en Gate 2 de T7) |
| R14.3 (historial offline) | `fetchExportHistory` lee del SQLite local | `buildExportLogHistoryQuery: …orden DESC, sin file_content` |
| R8.4 (no exporta con 0 exportables) | `generateExport` corta si exportable.length===0 | `exportableCount=0 … (T12 test a)` (invariante PURO) |
| R8.5 (exportar solo los que pasan) | `generateExport` usa SOLO `exportable` + profileIds alineados | `alineamiento profileIds ↔ records exportables (T12)` |
| R7.x (gate de rol field_operator) | la barrera real es la RLS al subir (0111/0112); el gate de UI va en T16 | (documentado; el local write no es la barrera — contrato T5) |

> R7.1-R7.3 (gate de rol en la PANTALLA) y R12/R13 (UX de lista + checklist + share dialog) son de las tasks
> de UI (T13-T18), FUERA de este chunk. El service/hook dejan los métodos listos; la pantalla los cablea.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
Pasada hostil sobre mi propio código, con foco en los dos puntos que el leader marcó + el checklist general:

1. **¿La query toca `animals`? (foco #1)** — NO. Render del SQL real: `\banimals\b` = `false`; la única
   aparición es `animal_profiles`/`animal_*`. Identidad 100% de las columnas denormalizadas 0079. Verificado
   por test explícito (`…NO referencia la tabla animals`) Y por inspección del string renderizado.
2. **¿Mando `declared_by`/`generated_by`? (foco #2)** — NO. Tests verifican que NINGUNA de las dos columnas
   aparece en el INSERT (`doesNotMatch /declared_by/` y `/generated_by/`), y que quedan NULL local (el trigger
   las setea al subir). Tampoco mando `declared_at`/`generated_at` (default now() server-side).
3. **Edge: formato de `animal_birth_date` vs filtro de rango.** Riesgo: si fuera timestamptz, `<= 'YYYY-MM-DD'`
   excluiría un nacimiento del mismo día. CERRADO: verifiqué en 0079/0019 que es `date` puro → PowerSync lo
   materializa `YYYY-MM-DD` → comparación string == cronológica, inclusiva. Test de boundary (`'2025-12-31'`
   incluido). No es bug.
4. **Edge: `null` en `pendingAnimals` rompería el alineamiento profileIds↔records.** CERRADO: el validador
   hace `if (animal == null) continue` (ni exportable ni incomplete); mi filtro tiene `a != null`. Alineamiento
   se sostiene con nulls (aunque la query nunca devuelve nulls). Test de alineamiento con caso mixto.
5. **Edge: `null ?? default` en el test helper.** ENCONTRADO (2 tests fallaban): `insProfile` usaba `p.tag ??`
   → un `tag:null`/`breed_id:null` EXPLÍCITO del test se reemplazaba por el default → los tests "excluye tag
   NULL" y "sin breed_id" pasaban por la razón equivocada (en realidad insertaban valores no-null). CORREGIDO:
   helper `pick` que mira `key in p` (distingue ausente de null) → ambos tests ahora ejercen el path real.
   Re-verificado: 23/23.
6. **Seguridad — IDOR/tenant en los INSERTs cliente.** El service pasa `establishmentId` del contexto y
   `animalProfileId` de la lista ya scopeada; NO re-enforza client-side (correcto: la RLS WITH CHECK MEDIUM-4
   es la barrera al subir). NO expongo helpers como RPC; son CRUD planos sobre tablas con INSERT-policy directa.
   `establishment_id` NUNCA hardcodeado (por param). Test cross-establishment (`declaración de OTRO est NO oculta`).
7. **Test "pasa por la razón equivocada".** Revisé cada test de comportamiento: todos ejercen el SQL/insert REAL
   contra node:sqlite (no string-only) y verifican el set de filas resultante, no solo que "no tira". Los
   asserts negativos (excluye/no-aparece) verifican exclusión efectiva, no ausencia de error.
8. **Offline-first.** queryPendingAnimals + persistDeclarations + redownload no importan nada de red; solo
   `saveAndShare` toca device (filesystem + share), también sin red. La generación del TXT es pura. R14.1 ✓.
9. **react-native-web (memoria del repo).** `saveAndShare` en web: `Sharing.isAvailableAsync()` puede dar false
   → escribe el archivo y NO lanza (retorna ok). NO lo testeo en device acá (chunk service-only); FLAG para la
   fase UI/E2E (post-deploy de streams): verificar el comportamiento real de File API + share en web táctil.

## Reconciliación de specs (paso 9)
Reconciliado en `design.md` §Changelog (entrada 2026-06-25): query sin JOIN animals (ya lo había hecho el
leader; confirmo as-built), File API v56 en vez de writeAsStringAsync, dependencia expo-sharing agregada,
`persistDeclarations(profileIds,…)` en vez de `(animals,…)`, métodos de soporte (fetchExportHistory/
buildExportLogHistoryQuery/buildExportLogContentQuery), nombre de archivo R5.3 con segundos, contrato del
local write. NO se reescribieron los EARS de requirements.md (el QUÉ no cambió; solo el CÓMO del as-built).
NO se tocaron los checkboxes de tasks.md (regla: el implementer no marca tasks).

## ⚠ FLAGS para el leader
1. **`feature_list.json` status = `spec_ready`** (no `in_progress`). Lag de bookkeeping multi-terminal —
   reconciliar al flip de `done`/al reconverger. NO lo toqué (es del leader + regla parallel-terminals).
2. **`expo-sharing` agregado a deps** (package.json + lockfile). Es runtime-necesario para el share sheet
   (design lo asumía). Si hay objeción a tocar el lockfile en paralelo, avisame; el diff es +51 líneas SOLO
   inserciones, deps críticas intactas.
3. **Verificación parcial deliberada**: corrí `pnpm typecheck` (verde) + `node --test` sobre mis tests (23/23)
   + las suites puras adyacentes (217/217). NO corrí `check.mjs` completo (flake del huérfano del Animal suite,
   que vos estás limpiando). Cuando esté limpio, el check completo debería pasar (mis cambios son aditivos +
   pasan typecheck + las suites que tocan local-reads).
4. **Web/E2E del share (post-deploy)**: la fase UI debería vetar `saveAndShare` en web táctil real (File API +
   Sharing.isAvailableAsync). No bloqueante para el chunk de servicio.
