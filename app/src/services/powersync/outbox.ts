// outbox.ts — I/O del camino OFFLINE de las (b) RPC-bound (spec 15, T6 / R6.8–R6.12).
//
// Encola una INTENCIÓN (op_type + params_json + client_op_id) en `op_intents` (insertOnly → genera
// CrudEntry → uploadData la mapea a supabase.rpc) JUNTO con su EFECTO OPTIMISTA en el overlay `pending_*`
// (localOnly → NO genera CrudEntry), TODO en UNA writeTransaction local atómica (§5.3.2/§5.3.3). Así la op
// (b) genera EXACTAMENTE UNA CrudEntry (su op_intent) → la RPC corre una sola vez (no doble-upload, R6.12).
//
// Importa el SDK (vía getPowerSync) → NO entra al grafo de node:test. Los SQL builders puros viven en
// local-reads.ts (testeables sin SDK); acá solo se orquesta la transacción + se elige qué builders correr.
//
// El éxito/fallo REAL de la RPC se resuelve al SUBIR (connector.uploadData → ACK limpia overlay / rechazo
// permanente rollbackea overlay, §5.4.4). El encolado SIEMPRE tiene éxito offline (devuelve la intención).

import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { getPowerSync } from './database';
import {
  buildOpIntentInsert,
  buildPendingAnimalInsert,
  buildPendingAnimalProfileInsert,
  buildPendingReproductiveEventInsert,
  buildPendingBirthCalfInsert,
  buildPendingStatusOverrideInsert,
  buildPendingRodeoInsert,
  buildPendingRodeoConfigInsert,
  buildDeletePendingRodeoConfig,
  buildPendingRodeoServiceMonthsInsert,
  buildDeletePendingRodeoServiceMonths,
  buildClearOverlayDelete,
  PENDING_OVERLAY_TABLES,
  type LocalQuery,
  type PendingProfileFields,
  type StatusOverrideEffect,
} from './local-reads';

/** Una escritura local a ejecutar dentro de la writeTransaction de la outbox. */
type TxWrite = LocalQuery;

/** Resultado del encolado: SIEMPRE ok offline salvo fallo del DB local (defensivo). */
export type OutboxResult =
  | { ok: true }
  | { ok: false; error: { kind: 'unknown'; message: string } };

/** UUID v4 de cliente. crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
export function newClientOpId(): string {
  return globalThis.crypto.randomUUID();
}

/** ISO now() para created_at de la intención y del overlay. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Núcleo: en UNA writeTransaction local, inserta el op_intent + todas las filas del overlay. Si el DB
 * local falla (no booteado / SQL malformado) devuelve error `unknown` (defensivo) — NUNCA por un reject
 * de upload (eso lo maneja uploadData por el canal de status). El local write siempre tiene éxito offline.
 */
async function enqueue(
  intent: LocalQuery,
  overlay: TxWrite[],
  db: AbstractPowerSyncDatabase,
): Promise<OutboxResult> {
  try {
    await db.writeTransaction(async (tx) => {
      await tx.execute(intent.sql, intent.args);
      for (const w of overlay) {
        await tx.execute(w.sql, w.args);
      }
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'unknown', message: message || 'Error al encolar la operación.' } };
  }
}

// ─── create_animal — alta (animals + animal_profiles cross-tabla) ─────────────────────

export type EnqueueCreateAnimalInput = {
  /** ids de cliente que la RPC/upsert reusarán (idempotencia por PK, R6.10). */
  animalId: string;
  profileId: string;
  /** Params del intent: los 2 payloads cross-tabla (shape HISTÓRICO — mapIntentToRpc los traduce a los
   *  args p_* de la RPC atómica create_animal 0083; NO cambiar el shape: los intents ya encolados en
   *  devices llevan este formato). */
  params: { animals: Record<string, unknown>; animal_profiles: Record<string, unknown> };
  /** Campos para el overlay optimista (lo que la ficha/lista muestra offline). */
  overlay: {
    animal: { tagElectronic: string | null; speciesId: string | null; sex: string | null; birthDate: string | null };
    profile: PendingProfileFields;
  };
};

/**
 * Encola un alta `create_animal`: intent (con los 2 payloads cross-tabla + ids de cliente) + overlay
 * (pending_animals + pending_animal_profiles). La lista/ficha lo muestran al instante; al subir, uploadData
 * lo mapea a la RPC ATÓMICA `create_animal` (0083): una transacción server-side, idempotente por los ids
 * de cliente (ON CONFLICT (id) DO NOTHING → reintento no duplica; sana huérfanos del camino viejo).
 */
export async function enqueueCreateAnimal(
  input: EnqueueCreateAnimalInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(clientOpId, 'create_animal', JSON.stringify(input.params), createdAt);
  const overlay: TxWrite[] = [
    buildPendingAnimalInsert(input.animalId, clientOpId, input.overlay.animal),
    buildPendingAnimalProfileInsert(input.profileId, clientOpId, input.overlay.profile),
  ];
  return enqueue(intent, overlay, db);
}

// ─── create_rodeo — alta de rodeo (rodeo + plantilla rodeo_data_config, atómico server-side) ───

/** Una entrada de la plantilla optimista a escribir en pending_rodeo_data_config (id sintético de cliente). */
export type EnqueueRodeoConfigOverlayRow = {
  fieldDefinitionId: string;
  enabled: boolean;
};

export type EnqueueCreateRodeoInput = {
  /** id de CLIENTE del rodeo (el mismo que la RPC create_rodeo reusará por ON CONFLICT → idempotente). */
  rodeoId: string;
  /** Params del intent = exactamente los de la RPC create_rodeo (p_id, p_establishment_id, p_name, …, p_toggles). */
  params: Record<string, unknown>;
  /** Campos del rodeo optimista (lo que la lista de rodeos muestra offline). */
  overlay: {
    establishmentId: string;
    name: string;
    speciesId: string;
    systemId: string;
    /** spec 03 Stream B / B1: TEXT/JSON del array de meses de servicio (RPSC.2.4), o null. La pantalla de
     *  edición lo muestra offline antes del ACK (overlay). createRodeo siempre lo pasa (al menos primavera). */
    serviceMonths: string | null;
  };
  /** Plantilla COMPUTADA en el cliente (defaults del sistema + diff de toggles): lo que "editar plantilla"
   *  / el form dinámico muestran offline. Cada fila → pending_rodeo_data_config. */
  configRows: EnqueueRodeoConfigOverlayRow[];
};

/**
 * Encola un alta de rodeo `create_rodeo`: intent (params de la RPC; uploadData mapea a supabase.rpc(
 * 'create_rodeo', params) SIN p_client_op_id — dedup natural por el id de cliente) + overlay (el rodeo en
 * pending_rodeos + la plantilla COMPUTADA en pending_rodeo_data_config). El rodeo Y su plantilla aparecen al
 * instante OFFLINE (vía UNION en buildRodeosQuery / buildRodeoConfigQuery); al subir, create_rodeo crea el
 * rodeo (el trigger 0018 seedea la config) + aplica los toggles ATÓMICO server-side, y el ACK limpia el
 * overlay (las filas reales bajan por est_rodeos / est_rodeo_data_config → sin duplicado, R6.11).
 * Idempotencia natural (ON CONFLICT por el id del rodeo + UPSERT de toggles → replay = no-op total, R6.10).
 */
export async function enqueueCreateRodeo(
  input: EnqueueCreateRodeoInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(clientOpId, 'create_rodeo', JSON.stringify(input.params), createdAt);
  const overlay: TxWrite[] = [
    buildPendingRodeoInsert(input.rodeoId, clientOpId, {
      establishmentId: input.overlay.establishmentId,
      name: input.overlay.name,
      speciesId: input.overlay.speciesId,
      systemId: input.overlay.systemId,
      serviceMonths: input.overlay.serviceMonths,
      createdAt,
    }),
  ];
  for (const row of input.configRows) {
    overlay.push(
      buildPendingRodeoConfigInsert(
        newClientOpId(), clientOpId, input.rodeoId, row.fieldDefinitionId, row.enabled,
      ),
    );
  }
  return enqueue(intent, overlay, db);
}

// ─── set_rodeo_config — editar plantilla del rodeo (UPSERT idempotente del diff, atómico server-side) ───

export type EnqueueSetRodeoConfigInput = {
  /** id del rodeo cuya plantilla se edita (el mismo que la RPC set_rodeo_config recibe en p_rodeo_id). */
  rodeoId: string;
  /** Params del intent = exactamente los de la RPC set_rodeo_config (p_rodeo_id, p_toggles). */
  params: Record<string, unknown>;
  /** Filas EFECTIVAS cambiadas (el diff computeEditDiff): lo que el overlay optimista pisa en
   *  pending_rodeo_data_config para que "editar plantilla"/el form dinámico vean el cambio offline. */
  configRows: EnqueueRodeoConfigOverlayRow[];
};

/**
 * Encola una edición de plantilla `set_rodeo_config`: intent (params de la RPC; uploadData mapea a
 * supabase.rpc('set_rodeo_config', params) SIN p_client_op_id — dedup natural por el UPSERT idempotente) +
 * overlay (las filas EFECTIVAS cambiadas en pending_rodeo_data_config). El cambio aparece al instante OFFLINE
 * (vía buildRodeoConfigQuery, que ahora hace overlay-OVERRIDE: el overlay PISA la fila synced del mismo
 * field); al subir, set_rodeo_config aplica el UPSERT del diff ATÓMICO server-side, y el ACK limpia el
 * overlay (las filas reales bajan por est_rodeo_data_config → sin duplicado, R6.11). Idempotencia natural
 * (UPSERT del mismo end-state → replay = no-op total, R6.10). Si el rodeo ya no existe (P0002), el rechazo
 * permanente rollbackea el overlay (§5.4.4 / classifyIntentUploadError).
 *
 * DELETE-PRIOR (fix rowid (Run T9.9 follow-up, 2026-06-09)): por cada fila del diff, ANTES del INSERT del overlay se borra cualquier fila
 * previa de pending_rodeo_data_config de ese (rodeo_id, field_definition_id) —de CUALQUIER client_op_id—. Esto
 * mantiene el INVARIANTE de ≤1 fila por (rodeo_id, field_definition_id) que buildRodeoConfigQuery necesita (su
 * UNION ALL del overlay ya no dedupa por rowid: `rowid` no existe sobre las views de PowerSync). Sin el
 * delete-prior, dos ediciones offline del MISMO field antes de syncear dejarían 2 filas → field DUPLICADO en la
 * plantilla. Efecto sobre clearOverlay/rollbackOverlay (borran por client_op_id): si la 2da edición REEMPLAZA la
 * fila de un op viejo, el clear/rollback de ESE op viejo ya no encontrará su fila (la borró el delete-prior). Es
 * BENIGNO: el clear es un best-effort de limpieza del overlay y la fila REAL del nuevo end-state baja por la
 * stream al ACK; el rollback de un op viejo que igual fue PISADO por uno nuevo no debe restaurar un estado
 * stale. La idempotencia del replay no se rompe (no depende del overlay: el UPSERT server-side es el end-state).
 */
export async function enqueueSetRodeoConfig(
  input: EnqueueSetRodeoConfigInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(clientOpId, 'set_rodeo_config', JSON.stringify(input.params), createdAt);
  const overlay: TxWrite[] = [];
  for (const row of input.configRows) {
    // DELETE-PRIOR antes del INSERT del overlay de este field: garantiza ≤1 fila por (rodeo_id, field) (fix rowid (Run T9.9 follow-up, 2026-06-09)).
    overlay.push(buildDeletePendingRodeoConfig(input.rodeoId, row.fieldDefinitionId));
    overlay.push(
      buildPendingRodeoConfigInsert(
        newClientOpId(), clientOpId, input.rodeoId, row.fieldDefinitionId, row.enabled,
      ),
    );
  }
  return enqueue(intent, overlay, db);
}

// ─── set_rodeo_service_months — editar meses de servicio del rodeo (spec 03 Stream B / B1, DD-PSC-4) ───

export type EnqueueSetRodeoServiceMonthsInput = {
  /** id del rodeo cuyos meses se editan (el mismo que la RPC set_rodeo_service_months recibe en p_rodeo_id). */
  rodeoId: string;
  /** TEXT/JSON del array de meses tildados (ej. '[6,7]'), o '[]' (no hace servicio). El overlay optimista lo
   *  pisa en pending_rodeo_service_months para que la pantalla de edición muestre el cambio offline (RPSC.3.4). */
  serviceMonthsText: string;
  /** Params del intent = exactamente los de la RPC set_rodeo_service_months (p_rodeo_id, p_service_months). */
  params: Record<string, unknown>;
};

/**
 * Encola una edición de meses de servicio `set_rodeo_service_months` (spec 03 Stream B / B1, RPSC.3.3): intent
 * (params de la RPC; uploadData mapea a supabase.rpc('set_rodeo_service_months', params) SIN p_client_op_id —
 * la firma no lo tiene; dedup natural por el UPDATE idempotente, RPSC.3.5) + overlay (pending_rodeo_service_months
 * con DELETE-PRIOR → invariante ≤1 fila por rodeo). El cambio aparece al instante OFFLINE (buildRodeosQuery
 * COALESCEa el overlay sobre rd.service_months → PISA la fila synced); al subir, la RPC re-valida (owner-only,
 * establishment derivado del rodeo anti-IDOR) y aplica el UPDATE ATÓMICO, y el ACK limpia el overlay (la fila real
 * con el nuevo service_months baja por est_rodeos → sin duplicado). Si el rodeo ya no existe (P0002), el rechazo
 * PERMANENTE rollbackea el overlay (§5.4.4 / classifyIntentUploadError → 'set_rodeo_service_months' → P0002 →
 * permanent_reject). GEMELO de enqueueSetRodeoConfig (mismo patrón outbox + overlay + DELETE-PRIOR).
 */
export async function enqueueSetRodeoServiceMonths(
  input: EnqueueSetRodeoServiceMonthsInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(
    clientOpId, 'set_rodeo_service_months', JSON.stringify(input.params), createdAt,
  );
  const overlay: TxWrite[] = [
    // DELETE-PRIOR: ≤1 fila por rodeo (el COALESCE de buildRodeosQuery toma una fila por rodeo).
    buildDeletePendingRodeoServiceMonths(input.rodeoId),
    buildPendingRodeoServiceMonthsInsert(
      newClientOpId(), clientOpId, input.rodeoId, input.serviceMonthsText,
    ),
  ];
  return enqueue(intent, overlay, db);
}

// ─── register_birth — parto (evento + N terneros, atómico server-side) ────────────────

export type EnqueueBirthCalfOverlay = {
  /** profileId PROVISIONAL del ternero (cliente; el real lo asigna la RPC). */
  calfProfileId: string;
  /** animalId PROVISIONAL del ternero. */
  calfAnimalId: string;
  profile: PendingProfileFields;
  animal: { tagElectronic: string | null; speciesId: string | null; sex: string | null; birthDate: string | null };
};

export type EnqueueRegisterBirthInput = {
  /** Params del intent = exactamente los de la RPC register_birth (p_mother_profile_id, p_event_date, p_calves). */
  params: Record<string, unknown>;
  /** profileId de la madre (para el overlay del evento de parto). */
  motherProfileId: string;
  eventDate: string;
  /** profileId PROVISIONAL del evento de parto (cliente). */
  birthEventId: string;
  /** Los N terneros optimistas. */
  calves: EnqueueBirthCalfOverlay[];
};

/**
 * Encola un parto `register_birth`: intent (params de la RPC; uploadData le pasa p_client_op_id = el
 * client_op_id) + overlay (el parto en pending_reproductive_events + por cada ternero pending_animals +
 * pending_animal_profiles + pending_birth_calves). El parto + terneros aparecen en la ficha de la madre
 * (vía UNION del timeline/madre) ANTES de que la RPC corra; al subir, register_birth crea el parto + N
 * terneros ATÓMICO server-side con ids REALES, y el ACK limpia el overlay (las filas reales bajan por la
 * stream → sin duplicado, R6.11). Idempotencia explícita por client_op_id (delta 0075, R6.10).
 */
export async function enqueueRegisterBirth(
  input: EnqueueRegisterBirthInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(clientOpId, 'register_birth', JSON.stringify(input.params), createdAt);
  const overlay: TxWrite[] = [
    buildPendingReproductiveEventInsert(input.birthEventId, clientOpId, {
      animalProfileId: input.motherProfileId,
      eventType: 'birth',
      eventDate: input.eventDate,
      notes: null,
      createdAt,
    }),
  ];
  for (const calf of input.calves) {
    overlay.push(buildPendingAnimalInsert(calf.calfAnimalId, clientOpId, calf.animal));
    overlay.push(buildPendingAnimalProfileInsert(calf.calfProfileId, clientOpId, calf.profile));
    overlay.push(
      buildPendingBirthCalfInsert(newClientOpId(), clientOpId, input.birthEventId, calf.calfProfileId),
    );
  }
  return enqueue(intent, overlay, db);
}

// ─── exit_animal_profile — baja (override 'exited') ───────────────────────────────────

export type EnqueueExitInput = {
  /** Params del intent = los de la RPC exit_animal_profile. */
  params: Record<string, unknown>;
  profileId: string;
  /** status de egreso (sold/dead/transferred) — el override lo refleja en la ficha + oculta de la lista. */
  status: string;
  /** Fecha de egreso (la que el usuario eligió = exactamente la que persiste la RPC). El overlay la
   *  lleva para que el badge "Vendido el {fecha}" funcione OFFLINE (residual #2). */
  exitDate: string;
};

/**
 * Encola una baja `exit_animal_profile`: intent (params de la RPC) + overlay pending_status_overrides
 * (effect 'exited', status, exit_date). La lista activa OCULTA el animal y la ficha marca el status +
 * la FECHA al instante (el badge muestra "Vendido el {fecha}" OFFLINE, igual que la fila real al
 * sincronizar — la exit_date del overlay es la MISMA que la RPC persiste → sin doble badge ni mismatch
 * al reconciliar, residual #2). La fila sincronizada NO se toca (R6.11). Idempotencia natural
 * (transición de status, sin delta — §5.4.3(2)).
 */
export async function enqueueExitAnimal(
  input: EnqueueExitInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(clientOpId, 'exit_animal_profile', JSON.stringify(input.params), createdAt);
  const overlay: TxWrite[] = [
    buildPendingStatusOverrideInsert(
      newClientOpId(), clientOpId, 'animal_profiles', input.profileId, 'exited', input.status, input.exitDate,
    ),
  ];
  return enqueue(intent, overlay, db);
}

// ─── assign_tag_to_animal — asignar caravana (NULL→valor sobre animals, SIN overlay local) ───────

export type EnqueueAssignTagInput = {
  /** Params del intent = los de la RPC assign_tag_to_animal (p_profile_id, p_tag_electronic). El
   *  p_client_op_id lo reinyecta mapIntentToRpc desde el id del op_intents (passthrough; NO ancla la dedup,
   *  que es state-based — RD1.6 / design §1.2 d). NO se manda en los params para no duplicarlo. */
  params: { p_profile_id: string; p_tag_electronic: string };
};

/**
 * Encola una asignación de caravana `assign_tag_to_animal`: intent (con p_profile_id + p_tag_electronic) y
 * NADA de overlay. Molde de enqueueExitAnimal/enqueueSoftDelete pero SIN overlay optimista: `animals` está
 * FUERA del sync set (ADR-026 b1) — la tabla NI EXISTE en el SQLite local → no hay fila optimista que pisar.
 * El efecto (animal_profiles.animal_tag_electronic, vía la propagación del trigger 0079) baja por la stream
 * al sincronizar; la salida del candidato de las listas de sesión es client-side (RD2.5 / RD5.3). El encolado
 * SIEMPRE tiene éxito al instante OFFLINE (DEC-2); el dup/race se resuelve al SUBIR (uploadData clasifica
 * 23505/23514/42501/23503 → permanent_reject por el default del clasificador; el replay idempotente devuelve
 * 2xx con {replay:true} → ACK normal, NO es error → no requiere un case nuevo en classifyIntentUploadError).
 *
 * El op_type = `assign_tag_to_animal` = NOMBRE EXACTO de la RPC (fold MED-1 de Gate 1): así el mapeo
 * genérico (rpcName: opType) lo cubre sin un case especial frágil, y el intent NO cae en PermanentIntentError.
 */
export async function enqueueAssignTag(
  input: EnqueueAssignTagInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(clientOpId, 'assign_tag_to_animal', JSON.stringify(input.params), createdAt);
  // SIN overlay: animals no está en el SQLite local (ADR-026 b1) → no hay fila optimista que pisar.
  return enqueue(intent, [], db);
}

// ─── soft_delete_* — borrado (override 'soft_deleted') ────────────────────────────────

const SOFT_DELETE_OP_BY_ENTITY = {
  management_group: 'soft_delete_management_group',
  rodeo: 'soft_delete_rodeo',
  animal_event: 'soft_delete_animal_event',
  event: 'soft_delete_event',
  // spec 03 M1.3 — borrar un preset de maniobra: RPC SECURITY DEFINER (0057, has_role_in) — mismo gotcha
  // RLS-on-RETURNING que el soft-delete de lote (la fila sale de la SELECT-policy tras el UPDATE).
  maneuver_preset: 'soft_delete_maneuver_preset',
} as const;

const TARGET_TABLE_BY_ENTITY = {
  management_group: 'management_groups',
  rodeo: 'rodeos',
  animal_event: 'animal_events',
  event: 'reproductive_events', // (placeholder; sin call site hoy — los eventos tipados no se borran en MVP)
  maneuver_preset: 'maneuver_presets',
} as const;

export type SoftDeleteEntity = keyof typeof SOFT_DELETE_OP_BY_ENTITY;

export type EnqueueSoftDeleteInput = {
  entity: SoftDeleteEntity;
  /** id de la fila objetivo (lote/rodeo/evento). */
  targetId: string;
  /** Params del intent = los de la RPC soft_delete_* (p_group_id / p_rodeo_id / p_event_id / [p_kind,p_event_id]). */
  params: Record<string, unknown>;
  /** Override la tabla objetivo si difiere del default (p.ej. evento tipado → su tabla concreta). */
  targetTable?: string;
};

/**
 * Encola un soft-delete `soft_delete_<entity>`: intent (params de la RPC) + overlay pending_status_overrides
 * (effect 'soft_deleted'). La lista de lotes/rodeos OCULTA la fila al instante; la fila sincronizada NO se
 * toca. Idempotencia natural por la guarda `deleted_at IS NULL` (reintento → P0002 → descarte idempotente,
 * §5.4.3(4)).
 */
export async function enqueueSoftDelete(
  input: EnqueueSoftDeleteInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const opType = SOFT_DELETE_OP_BY_ENTITY[input.entity];
  const targetTable = input.targetTable ?? TARGET_TABLE_BY_ENTITY[input.entity];
  const intent = buildOpIntentInsert(clientOpId, opType, JSON.stringify(input.params), createdAt);
  const overlay: TxWrite[] = [
    buildPendingStatusOverrideInsert(
      newClientOpId(), clientOpId, targetTable, input.targetId, 'soft_deleted', null,
    ),
  ];
  return enqueue(intent, overlay, db);
}

// ─── clear / rollback del overlay (ACK / rechazo permanente, §5.4.4) ──────────────────

/**
 * Borra TODO el overlay `pending_*` de un client_op_id (las 5 tablas). Usado por:
 *   - clearOverlay: ACK (la RPC corrió → las filas reales bajan por la stream).
 *   - rollbackOverlay: rechazo PERMANENTE (la RPC rechazó atómico → el efecto optimista se revierte).
 * Ambos hacen lo mismo (borrar el overlay por client_op_id); se exponen como dos nombres por claridad
 * semántica en uploadData. Una sola writeTransaction. NUNCA toca tablas sincronizadas (solo localOnly).
 */
export async function clearOverlay(
  clientOpId: string,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<void> {
  const db = options.db ?? getPowerSync();
  await db.writeTransaction(async (tx) => {
    for (const table of PENDING_OVERLAY_TABLES) {
      const q = buildClearOverlayDelete(table, clientOpId);
      await tx.execute(q.sql, q.args);
    }
  });
}

/** Alias semántico de clearOverlay para el rechazo permanente (§5.4.4): revierte el efecto optimista. */
export const rollbackOverlay = clearOverlay;
