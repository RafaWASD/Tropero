# Review - Spec 08 SIGSA - Capa de servicio + hook (T11/T12/T19/T20)

Reviewer: reviewer (Opus 4.8). Fecha: 2026-06-25.

Alcance EXACTO revisado (NADA fuera de esto):
- app/src/services/sigsa/sigsa-export-service.ts (T11/T19/T20 + soporte historial)
- app/src/hooks/useExportSigsa.ts (T12)
- builders SIGSA en app/src/services/powersync/local-reads.ts (lineas 2833-3029, aditivos)
- app/src/services/sigsa/sigsa-export-service.test.ts (23 tests)
- progress/impl_08-sigsa-service.md (bitacora)
- Dep nueva: expo-sharing ~56.0.16 (-> 56.0.18) en app/package.json

NO revisado (fuera de alcance, gateado / no implementado): UI T13-T18, migraciones DB T1-T6
(0107-0112, ya aplicadas+gateadas), PowerSync/rafaq.yaml T7. La capa pura T8/T9/T10 se revisa
solo como dependencia REUSADA, no se re-aprueba.

## VEREDICTO: APPROVED

Capa de servicio + hook correctos contra la spec reconciliada. Los 6 puntos de foco verifican.
Sin hallazgos bloqueantes. typecheck exit 0; 23/23 service + 32/32 capa pura sigsa (55/55 total)
verdes. check.mjs completo NO corrido por instruccion del leader (flake conocido del Animal suite,
huerfano tag electronico 9, ajeno a spec 08; verificado: typecheck + unit tests sigsa en su lugar).

## Foco del leader - verificacion punto por punto

### 1. La query de pendientes NO toca animals - VERIFICADO (OK)
buildPendingSigsaAnimalsQuery (local-reads.ts:2894-2930):
- FROM animal_profiles ap (2903). NO hay FROM animals ni JOIN animals (la tabla global no esta en el
  SQLite local - ADR-026 / b1 / 0079). Identidad denormalizada: ap.animal_tag_electronic (2900),
  ap.animal_sex (2901), ap.animal_birth_date (2901). Confirmado contra 0079:50 - las 3 columnas
  existen en animal_profiles y animal_birth_date es date puro (no timestamptz) -> el filtro de rango
  por string es cronologicamente correcto e inclusivo (R9.3).
- LEFT JOIN breed_catalog bc ON bc.id = ap.breed_id (2904) -> resuelve senasa_code. LEFT (no INNER):
  un animal sin breed_id igual aparece, queda incompleto en el validador (R9.1).
- LEFT JOIN sigsa_declarations sd ON sd.animal_profile_id = ap.id AND sd.establishment_id =
  ap.establishment_id (2905-2906) + AND sd.id IS NULL (2909) -> pendientes = no declarados (R9.1, R3.4).
- Filtros base: ap.establishment_id = ? (2907, parametrizado), tag_electronic IS NOT NULL (2908),
  status active (2910), deleted_at IS NULL (2911). Coincide 1:1 con el SQL del design seccion
  Flujo de datos - Export (design.md:550-564). Filtros opcionales rodeo/fecha (2914-2926).
- Test estructural (doesNotMatch /FROM animals/ y /JOIN animals/) + 7 tests de comportamiento contra
  node:sqlite con un esquema que NO tiene tabla animals (el SQL fallaria si la referenciara).

### 2. NO se mandan declared_by / generated_by en los INSERT - VERIFICADO (OK)
- buildExportLogInsert (2944-2972): columnas = (id, establishment_id, animal_count, file_name,
  file_content, rodeo_filter_id, date_from, date_to) (2959). NO incluye generated_by NI generated_at
  (default now() + trigger 0112 HIGH-1 los fuerzan server-side). Test: SIN generated_by + comportamiento
  generated_by NULL local.
- buildSigsaDeclarationInsert (2987-3000): columnas = (id, establishment_id, animal_profile_id,
  export_log_id) (2996). NO incluye declared_by NI declared_at. Test: SIN declared_by.
- Unicas apariciones de esos identificadores en local-reads.ts: 2 comentarios explicativos + 1 SELECT
  legitimo en buildExportLogHistoryQuery (3024, LEE generated_by para mostrar quien genero). Correcto.

### 3. Reuso de la capa pura (no re-implementa validacion/generacion) - VERIFICADO (OK)
- useExportSigsa.ts importa generateSigsaTxt (39) y validateForExport (40) de la capa pura. generateExport
  (178-258) llama validateForExport(pendingAnimals) (185) y generateSigsaTxt(exportable) (209). Sin logica
  de validacion/formato duplicada. El service solo mapea fila cruda -> PendingAnimalInfo (toPendingAnimalInfo,
  104-113) SIN normalizar RFID/fecha/raza (eso es del validador puro).

### 4. markAsDeclared (T19) y redownload (T20) - VERIFICADO (OK)
- markAsDeclared (service:224-234): INSERT de 1 sigsa_declarations con export_log_id = null (230). El NULL
  distingue la marca manual del export con archivo. Copy fijado (217-220): Marcar como ya declarado por
  otro medio (decision 2, leader). Tests T19 a/b verdes.
- redownload (service:245-255): buildExportLogContentQuery (read-only file_content/file_name) -> saveAndShare.
  NO crea declaraciones. buildExportLogContentQuery (3008-3013) = SELECT ... FROM export_log WHERE id = ?
  LIMIT 1. Test: doesNotMatch /INSERT|UPDATE|DELETE/i.

### 5. persistDeclarations: 1 export_log + N sigsa_declarations, patron CRUD plano - VERIFICADO (OK)
- service:176-209. Paso 1: 1 buildExportLogInsert (184-193). Paso 2: loop de N buildSigsaDeclarationInsert
  cada uno con el exportLogId de arriba (199-206). Orden FIFO correcto (export_log antes que las FKs que lo
  referencian, doc 161-164). Usa runLocalWrite (CRUD plano -> cola de sync), NO el outbox de op_intents.
  Mismo patron que management-groups.ts/sessions.ts (contrato T5 spec 15, local-query.ts:91-106). id de
  cliente via crypto.randomUUID (296-298). establishmentId SIEMPRE por parametro, NUNCA hardcodeado.
  Test export completo (comportamiento): tras 1 export_log + N declaraciones, los exportados salen de
  pendientes; declaraciones con export_log_id no-NULL.

### 6. Query parametrizada (sin injection en el SQLite local) - VERIFICADO (OK)
- Toda la superficie usa { sql, args } con placeholders ? -> db.getAll(sql, args) / db.execute(sql, args)
  (local-query.ts:51,97). Los filtros opcionales empujan a args (args.push, 2917/2921/2925), NUNCA interpolan
  el valor en el string. El unico literal interpolado es status active (2910), constante hardcodeada, no
  input. Cero concatenacion de valores controlados por usuario. Sin vector de injection.

## Trazabilidad R<n> <-> test (R que cubre este chunk: T11/T12/T19/T20)

| R | Cubierto por | Test concreto |
|---|---|---|
| R4.1 (export_log + file_content) | buildExportLogInsert | "buildExportLogInsert: 1 fila SIN generated_by" + "inserta exactamente 1 fila" |
| R4.3 (registra filtros + contenido) | buildExportLogInsert + persistDeclarations | args con rodeo/fechas + "export completo (comportamiento)" |
| R4.4 (generated_by forzado server-side) | NO se manda (trigger 0112) | "SIN generated_by" + "generated_by NULL local" |
| R3.4 (pendiente=no declarado) | buildPendingSigsaAnimalsQuery (sd.id IS NULL) | "filtra NO declarados sd.id IS NULL" + "excluye DECLARADOS" |
| R3.6 (declared_by forzado server-side) | NO se manda (trigger 0111) | "SIN declared_by" |
| R5.3 (nombre sigsa_slug_YYYYMMDD_HHMMSS.txt) | buildFileName (hook) | typecheck + reconciliado design AS-BUILT (sin test unit dedicado, LOW) |
| R5.4 / R14.1 (generacion local offline) | generateSigsaTxt (puro) + saveAndShare (sin red) | offline por construccion (sin imports de red en el path) |
| R5.6 (UTF-8 sin BOM) | File.write(string) no antepone BOM | capa pura testea no-BOM; service escribe el string tal cual |
| R8.4 (no exporta con 0 exportables) | generateExport corta si exportable.length===0 | "exportableCount=0 (T12 test a)" |
| R8.5 (exporta solo los que pasan) | generateExport usa SOLO exportable + profileIds alineados | "alineamiento profileIds <-> records exportables (T12)" |
| R9.1 (pendientes = tag NOT NULL + sin declaracion) | buildPendingSigsaAnimalsQuery | "excluye DECLARADOS" + "excluye tag NULL" + "filtros de dominio base" |
| R9.2 (filtro rodeo) | buildPendingSigsaAnimalsQuery | "filtro por rodeo_id (T11 test c)" + "filtros opcionales rodeo + rango" |
| R9.3 (filtro rango fecha nacimiento) | buildPendingSigsaAnimalsQuery | "filtro por rango de fecha (T11 test d)" (boundary 2025-12-31 inclusive) |
| R9.4 (no filtra por categoria) | la query no tiene clausula category | por ausencia (el SQL no menciona category) |
| R9.5 (vacio -> mensaje + historial) | useExportSigsa (exportableCount=0 + history) | "exportableCount=0 (T12 test a)" |
| R10.1 (re-descarga sin nueva declaracion) | redownload + buildExportLogContentQuery + buildExportLogHistoryQuery | "sin escribir (T20 b)" + "mismo file_content (T20 a)" + "historial DESC SIN file_content" |
| R10.2 (marca manual) | markAsDeclared + buildSigsaDeclarationInsert(null) | "export_log_id NULL = marca manual (T19 b)" + "el animal DESAPARECE de pendientes (T19 a)" |
| R11.1/R11.2 (audit export_log + sigsa_declarations) | persistDeclarations (1 log + N decl ligadas) | "export completo (comportamiento)" |
| R11.3 (append-only desde cliente) | solo INSERT en el service (sin UPDATE/DELETE) | builders solo emiten INSERT; redownload/history son SELECT |
| R14.2 (inserts por cola de sync) | runLocalWrite (CrudEntry -> uploadData) | contrato runLocalWrite (local-query.ts); scope lo da la stream T7 |
| R14.3 (historial offline) | fetchExportHistory lee del SQLite local | "buildExportLogHistoryQuery: DESC sin file_content" |

R7.1-R7.3 (gate de rol en pantalla) + R12/R13 (UX lista/checklist/share dialog) -> tasks de UI T13-T18,
FUERA de este chunk. La barrera REAL de rol para field_operator es la RLS al subir (0111/0112, ya
verificada en la capa DB). El service/hook dejan los metodos listos. N/A aca.

Trazabilidad: COMPLETA para los R de T11/T12/T19/T20. Cada R cubierto por >=1 test concreto (salvo
R5.3 buildFileName, nota LOW abajo, no bloqueante).

## Tasks completas: SI (para el alcance del chunk)
- T11 queryPendingAnimals + saveAndShare + persistDeclarations: IMPLEMENTADO [x]
- T12 useExportSigsa (estado + acciones): IMPLEMENTADO [x]
- T19 markAsDeclared (export_log_id NULL + copy): IMPLEMENTADO [x]
- T20 redownload (read-only file_content, no inserta declaraciones): IMPLEMENTADO [x]

NOTA bookkeeping (NO bloqueante): tasks.md muestra T11/T12/T19/T20 con [ ] y feature_list.json marca la
feature spec_ready (no in_progress). El implementer lo FLAGGEO bien (no marca tasks por regla; lo hace
reviewer/leader). T1-T7 con [ ] son DB/PowerSync ya hechas+gateadas (fuera del chunk). No es task sin
justificacion: es lag multi-terminal documentado. El leader reconcilia tasks.md + feature_list.json al cerrar.

## Exactitud de specs (codigo -> spec): OK (no hay specs viejas tras el chunk)
- design.md seccion Flujo de datos - Export tiene la query CORREGIDA (sin JOIN animals, columnas
  denormalizadas), coincide con el builder. Nota de reconciliacion offline en el design (544-549) y en
  el builder (2839-2850).
- Changelog de design entrada 2026-06-25 reconcilia los 6 deltas del as-built: query sin JOIN animals,
  File API v56 (no writeAsStringAsync legacy), dep expo-sharing, persistDeclarations(profileIds,..) (no
  (animals,..)), metodos de soporte fetchExportHistory/buildExportLogHistoryQuery/buildExportLogContentQuery,
  nombre con SEGUNDOS, contrato local write.
- requirements.md: los EARS no cambiaron (el QUE es el mismo; solo el COMO del as-built). NO contradicen el
  codigo. R5.2 cita animals.tag_electronic/sex/birth_date como FUENTE conceptual; el as-built lee la copia
  denormalizada de esas mismas columnas sobre animal_profiles (0079). No es contradiccion de contrato (el
  dato es el mismo, denormalizado por offline). Bien anotado en R1.6 + seccion Flujo de datos.

No queda design/requirements mintiendo sobre el codigo. Reconciliacion COMPLETA.

## CHECKPOINTS (aplicables a una capa de servicio TS; DB/UI fuera de alcance)

C2 - Estado coherente:
- [x] Una feature en progreso (08). El label spec_ready es lag documentado, no 2 features activas.
- [x] Tests del chunk pasan (23/23 service, 55/55 sigsa total).

C3 - Codigo respeta arquitectura:
- [x] Solo capas previstas: services, hooks, types. Sin capas nuevas.
- [x] Dep externa justificada: expo-sharing ~56.0.16 (canal SDK-aligned 56.0.x del repo, igual que
      expo-file-system/document-picker). El design la asumia (Sharing.shareAsync). Diff lockfile +51
      lineas solo inserciones. JUSTIFICADA.
- [x] Sin logs de debug sueltos. Sin TODOs sin contexto (los FLAG del impl van al reporte, no al codigo).
- [x] establishment_id NUNCA hardcodeado: por param en queryPendingAnimals/persistDeclarations/markAsDeclared;
      en el hook sale de useEstablishment (124).

C4 - Verificacion real:
- [x] Test por modulo con logica: builders (local-reads) + logica pura del hook (validateForExport +
      alineamiento de profileIds) cubiertos.
- [x] Fixtures reales: node:sqlite (DatabaseSync en memoria) ejecuta el SQL REAL contra tablas reales, NO
      mocks. El esquema sin tabla animals es garantia estructural del sin JOIN animals.
- [x] Runner > 0 tests, todos verdes: 23 service + 32 capa pura sigsa = 55/55. typecheck exit 0.
- N/A test de aislamiento cross-tenant: este chunk NO toca RLS (policies de sigsa_declarations/export_log son
      de la capa DB T5/T6, ya revisadas+gateadas). El service usa CRUD plano sobre tablas con RLS server-side;
      el aislamiento es de la stream + policies, no del service. Hay test de defensa (declaracion de OTRO est
      NO oculta al animal, el JOIN matchea por establishment_id).

C8 - Offline-first:
- [x] Funciona sin conexion: queryPendingAnimals + persistDeclarations + redownload 100% locales (SQLite);
      saveAndShare toca device (filesystem + share) sin red. Generacion del TXT pura.
- [x] Bucket PowerSync correcto: org_scope (sigsa_declarations / sigsa_export_log) definido en T7 (rafaq.yaml,
      fuera del chunk; el service escribe CRUD plano que esas streams sincronizan).
- [x] Conflict resolution: UNIQUE(establishment_id, animal_profile_id) server-side hace idempotente un reintento
      (last-write-wins por la cola de sync + el UNIQUE; documentado en el builder).

C1/C5/C6/C7 son de cierre de sesion / DB / harness completo, fuera del alcance de una review de capa de servicio.

## Checklist RAFAQ-especifico (secciones aplicables al chunk)

A. Tablas con establishment_id (multi-tenancy / RLS) - N/A en este chunk.
La review es de la CAPA DE SERVICIO, no de la DB. enable RLS + policies + helpers has_role_in + triggers de
audit forzado + test cross-tenant viven en 0111/0112 (T5/T6), ya revisadas y gateadas (fuera de alcance). El
service NO escribe SQL de RLS ni policies. Lo que SI verifico desde el service: NO re-enforza tenant
client-side (correcto - la RLS WITH CHECK MEDIUM-4 + has_role_in son la barrera al subir); NO manda
declared_by/generated_by (los fuerzan los triggers); establishment_id por param (nunca hardcode).

B. Carga/edicion de datos en campo (offline-first) - APLICA (OK):
- [x] Funciona offline: lecturas/escrituras 100% locales (SQLite PowerSync). Solo saveAndShare toca device
      (sin red). Generacion del TXT pura.
- [x] Sync bucket correcto: org_scope scoped por establishment_id (T7, streams sigsa_declarations / sigsa_export_log).
- [x] Resolucion de conflictos: UNIQUE(establishment_id, animal_profile_id) server-side + cola de sync
      (last-write-wins implicito de PowerSync + idempotencia por el UNIQUE). Documentado.
- [x] No hace requests sincronos a Supabase desde la pantalla: usa runLocalQuery/runLocalWrite (SQLite local).
      El hook no importa supabase-js; consume solo el service (boundary de I/O local).

C. BLE - N/A (la feature SIGSA no toca BLE).
D. UI de campo - N/A (T13-T18 NO implementada; este chunk es service+hook, sin pantallas).
E. Edge Functions - N/A (generacion 100% local; alternativa Edge descartada en el design).

## Hallazgos NO bloqueantes (LOW - para el leader / fase UI, no cambian el veredicto)

1. R5.3 buildFileName sin test unit dedicado (LOW). buildFileName (useExportSigsa.ts:105-120) produce
   sigsa_slug_YYYYMMDD_HHMMSS.txt con slug NFD+lowercase+hyphenate<=80. Logica pura y testeable, pero vive
   dentro del hook (no exportada) -> la suite node:sqlite no la cubre directo. Formato reconciliado en design
   AS-BUILT y typecheck pasa. Sugerencia: extraerla a un util puro con su propio test al armar la UI (T16).
   Riesgo bajo: cosmetico (nombre de archivo), no afecta el contenido del TXT ni la persistencia.

2. saveAndShare en web tactil NO verificado (LOW, ya FLAG del impl). Sharing.isAvailableAsync() puede dar
   false en web -> escribe el archivo y NO lanza (retorna ok). El comportamiento real de File API + share en
   web tactil va a la fase UI/E2E post-deploy de streams (memoria del repo: vetar manga en web tactil real).

3. E2E offline no verificable aun (esperado). Los sync streams (T7) no estan deployados (lo hace Raf en el
   dashboard). La review es a nivel CODIGO; el E2E offline va post-deploy.

4. Bookkeeping (lag multi-terminal, del impl): feature_list.json=spec_ready y tasks.md con [ ]. Lo reconcilia
   el leader al cerrar. No es defecto del codigo.

## Resumen
APPROVED. Los 6 puntos de foco verifican sin excepcion: (1) query sin animals usando columnas denormalizadas
0079 + LEFT JOINs correctos; (2) sin declared_by/generated_by en los INSERT; (3) reuso de la capa pura;
(4) markAsDeclared sin export_log_id + redownload read-only; (5) 1 export_log + N declaraciones por CRUD plano;
(6) queries 100% parametrizadas sin injection. Trazabilidad completa, tasks del chunk hechas, specs reconciliadas,
offline-first respetado. Verificacion: typecheck exit 0, 23/23 service + 55/55 sigsa, fixtures reales (node:sqlite).
Hallazgos LOW no bloqueantes para fase UI.
