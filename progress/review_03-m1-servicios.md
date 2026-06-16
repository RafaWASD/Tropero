# Review - Spec 03 MODO MANIOBRAS - chunk M1-SERVICIOS (M1.1/M1.2/M1.3)

Reviewer: reviewer (Opus). Fecha: 2026-06-14.
Alcance revisado (SOLO estos; el drift de spec 08 en el working tree NO se reviso).

## Veredicto: CHANGES_REQUESTED

Un unico cambio, NO bloqueante de funcionalidad (no rompe tests ni el check) pero exigido por la regla dura de reconciliacion de specs (memoria correcciones-se-reflejan-en-specs + protocolo paso 6): el design.md quedo MINTIENDO en su shape canonico de config tras el rename ManeuverKind del as-built. El propio codigo de este chunk (extractManeuvers) trata el token del ejemplo como basura y lo descarta. Reconciliacion pendiente = CHANGES_REQUESTED. Todo lo demas (codigo, tests, trazabilidad, RAFAQ checklist) esta APROBADO.

---

## Cambios requeridos (accionables - para un fix-loop del implementer)

1. specs/active/03-modo-maniobras/design.md:232 - el shape canonico de config (sec 2.1.1) persiste el token tacto_vaca en el array maniobras: [pesaje, tacto_vaca, vacunacion, sangrado]. Contradice el ManeuverKind as-built (tacto, NO tacto_vaca) que el MISMO chunk reconcilio en sec 3 (l.396) y en tasks.md (l.160). Peor: extractManeuvers (app/src/utils/maneuver-config.ts) FILTRA tacto_vaca como valor desconocido (test l.49-52 lo confirma) -> un config escrito literalmente segun ese ejemplo perderia esa maniobra en silencio.
   Fix: cambiar el ejemplo a [pesaje, tacto, vacunacion, sangrado] (token real del enum). Es la unica ocurrencia stale; raspado_toros en sec 3/sec 4 (l.413/483/535) es el data_key real (correcto, NO tocar) - solo tacto_vaca como token de maniobras esta mal.

El resto del design ya esta reconciliado (ruta real, fetchRodeoGating, required de system_default_fields, resolucion inline del rodeo). requirements.md (EARS) NO contradice el as-built. Es UN string olvidado.

---

## Trazabilidad R<n> a test (chunk M1-SERVICIOS - todas cubiertas)

| R<n> | Test concreto |
|---|---|
| R1.4 / R1.5 (gating UI capa 1) | maneuver-gating.test.ts -> filterApplicableManeuvers separa habilitadas de omitidas |
| R1.9 / R1.10 / R1.11 (sesion persistida, id cliente, config snapshot) | maneuver-reads.test.ts -> buildCreateSessionInsert (status active, contadores 0, config TEXT, started_at de cliente, created_by NULL) |
| R2.1 / R2.4 / R2.5 (preset scope est, id cliente) | maneuver-reads.test.ts -> buildCreateManeuverPresetInsert + buildManeuverPresetsQuery (excluye otros est) |
| R2.2 (presets al tope, lista ordenada) | maneuver-reads.test.ts -> buildManeuverPresetsQuery (orden por nombre, borrados excluidos) |
| R2.3 (preset filtra maniobras OFF + avisa) | maneuver-gating.test.ts -> R2.3 preset con maniobra OFF cae en omitted; loadPreset reusa filterApplicableManeuvers |
| R5.3 (rodeo real del perfil activo) | maneuver-reads.test.ts -> buildActiveProfileRodeoQuery (perfil soft-deleted -> 0 filas, fail-safe) |
| R5.4 (mapeo maniobra->data_keys) | maneuver-gating.test.ts -> R5.4 MANEUVER_DATA_KEYS cubre las 10 + multi-key tacto |
| R5.5 (omite maniobra si data_key OFF) | maneuver-gating.test.ts -> single/multi-key NO aplica (ausente / disabled / falta uno) |
| R5.6 / R5.7 (required vs opcional; bloqueo) | maneuver-gating.test.ts -> requiredDataKeys (enabled+required reporta; disabled no) |
| R9.4 (work_lot_label informativo no-autoritativo) | maneuver-reads.test.ts -> buildSetWorkLotLabelUpdate (set/clear) |
| R10.3 (gating cacheado local offline) | fetchRodeoGating lee SQLite local; builders en maneuver-reads.test.ts |
| R10.5 / R10.6 (sesion activa unica, reanudacion) | maneuver-reads.test.ts -> buildActiveSessionQuery (solo activa; 2 activas -> mas reciente por started_at) |
| R10.7 (cerrar sesion) | maneuver-reads.test.ts -> buildCloseSessionUpdate (closed + ended_at; ignora borrada) |
| R6.11 (soft-delete optimista oculta) | maneuver-reads.test.ts -> buildManeuverPresetsQuery overlay-hide |
| op_type soft_delete_maneuver_preset (wiring) | upload.test.ts -> mapIntentToRpc soft_delete_* SIN p_client_op_id + P0002 idempotent_discard |
| config jsonb pass-through tolerante | maneuver-config.test.ts -> parseo (null/malformado/escalar) + extractManeuvers (filtra basura, dedup, no-strings) |
| schema: columnas sessions/presets declaradas | schema.test.ts -> guard de columnas sessions/maneuver_presets |

Los tests son REALES, no humo: maneuver-reads.test.ts EJECUTA el SQL de los builders contra node:sqlite (DatabaseSync) -> verifica semantica (filtros deleted_at, orden, overlay-hide, fail-safe del rodeo del perfil), no string-matching. El gating puro testea accept Y reject (maniobra que NO aplica, multi-key parcial, rodeo vacio). El binding data_key a destino server-side queda cubierto por la suite backend Fase 2 (T2.5, ya done) - fuera de este chunk pero verificado verde.

## Tasks completas: si (para este chunk)
M1.1 / M1.2 / M1.3 [x] en tasks.md con archivos+tests as-built. M1.4 (UI wizard) y M2/M3/M4 quedan [ ] - justificado: este chunk es explicitamente logica pura + servicios, sin UI (brief + bitacora). No hay [ ] sin justificar dentro del alcance.

## CHECKPOINTS
- C1 [x] node scripts/check.mjs exit 0 (verde end-to-end).
- C2 [x] estado coherente; spec 03 sigue su pipeline por chunks.
- C3 [x] capas respetadas (utils puros, hook orquesta service, service = unico I/O, builders en powersync/); cero console/TODO sueltos; cero hardcode de establishment_id/rodeo_id (check-hardcode verde).
- C4 [x] al menos 1 test por modulo con logica; fixtures reales (node:sqlite, no mocks de I/O); runner con 1099 client unit + 13 backend maneuvers verdes.
- C6 [x] requirements.md EARS; cada R<n> del chunk con test. Salvedad C6/exactitud: design sec 2.1.1 con string stale -> motivo del CHANGES_REQUESTED.
- C7 [x] (capa cliente) cero hardcode; audit created_by/establishment_id NUNCA en payload (los fuerza el trigger 0050/0051); RLS has_role_in es la barrera (validada por la suite backend Fase 2).
- C8 [x] CRUD-plano offline (runLocalWrite -> CrudEntry -> uploadData); soft-delete por outbox/RPC 0057; LWW explicito en contadores absolutos (D5). Sync rules de DOWNLOAD = M4 (fuera de chunk, documentado).

## Checklist RAFAQ-especifico
- A (multi-tenancy / RLS): N/A en el cliente - este chunk NO crea tablas ni policies (backend 0050-0057 ya done). El cliente NUNCA re-filtra tenant (la stream scopea) y NUNCA manda audit cols. Consistente con el modelo.
- B (offline-first / carga en campo):
  - [x] Funciona offline: CRUD-plano local (runLocalWrite), lecturas locales (runLocalQuery).
  - [x] Sync bucket scoped por establishment: establishment_id llega del caller, nunca hardcode; schema declara las tablas.
  - [x] Conflictos: LWW explicito (contadores absolutos para no chocar con LWW, D5; comentado en sessions.ts/builder).
  - [x] Cero supabase.from() de escritura directa - TODO por runLocalWrite/uploadData; unico RPC-bound = softDeletePreset (outbox/RPC 0057, gotcha RLS-on-RETURNING). Verificado por grep.
  - [x] op_type nuevo soft_delete_maneuver_preset mapea bien al RPC p_preset_id (0057, firma uuid), passthrough generico en mapIntentToRpc, P0002 idempotente.
- C (BLE): N/A - este chunk no toca BLE.
- D (UI de campo): N/A - este chunk es logica+servicios, sin UI (el spike visual M2.0 ya paso aparte).
- E (Edge Functions): N/A - no toca Edge Functions.

## Otras verificaciones (autorrevision del reviewer)
- started_at de cliente: migracion 0050 confirma default now() SIN force-trigger (solo created_by se fuerza) -> el wall-clock del cliente PERSISTE al subir. Habilita reanudacion offline deterministica (R10.5).
- Error shapes alineados: LocalReadError (kind,message) de local-query.ts = lo que sessions.ts/maneuver-presets.ts destructuran (r.error.kind).
- useManeuverGating: doble-load del mount corregido (useFocusEffect carga inicial + useEffect de sync guardado en lastSyncedMs==0, patron useGroupView); reqIdRef descarta cargas obsoletas. Fail-safe UI: rodeoId null -> no-aplica.
- fetchRodeoGating: required de system_default_fields (no de un flag inexistente en rodeo_data_config) - correcto contra as-built 0018.
