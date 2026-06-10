// upload.ts — lógica PURA del drenado de la outbox: mapeo intent→RPC + clasificación de errores de la
// upload queue para las (b) RPC-bound (spec 15, T6 / §5.4.2/§5.4.3/§5.4.4). SIN imports de supabase/RN/SDK
// → testeable con node:test. El I/O (supabase.rpc, tx.complete, clear/rollbackOverlay) vive en connector.ts.
//
// Dos piezas:
//  (1) mapIntentToRpc(op): traduce una CrudEntry de op_intents a { kind:'rpc', rpcName, args }. TODAS las
//      ops (b) mapean a una RPC — incluido create_animal (RPC atómica 0083, Run create-animal-rpc: los 2
//      upserts no atómicos del camino viejo PERDÍAN datos bajo reintento, backlog 2026-06-10 REABIERTO).
//      Para create_animal el mapeo TRADUCE el shape histórico del intent ({ animals, animal_profiles })
//      a los args p_* de la RPC → los op_intents YA ENCOLADOS en devices drenan por el camino nuevo.
//      p_client_op_id SOLO a register_birth (las demás firmas no lo tienen).
//  (2) classifyIntentUploadError(error, opType): decide el destino de un error de la RPC:
//        - 'transient'           → re-throw (queda en cola, reintenta) — NO toca overlay (R3.4/R6.9).
//        - 'idempotent_discard'  → la op YA corrió server-side (reintento at-least-once): descartar SIN
//                                  rollback + limpiar overlay (la fila real ya/va a bajar por la stream).
//                                  Casos: P0002 de un soft_delete_* ya aplicado; 23505 del índice
//                                  reproductive_events_client_op_id_uq de register_birth (MED-1, race del
//                                  mismo caller). NO se superficia (es un no-op exitoso).
//        - 'permanent_reject'    → rechazo real (RLS 42501, FK 23503, check 23514, otro 23505 — p.ej. tag
//                                  duplicado): rollback del overlay + descarte + superficia (R3.5/R8.1/R10.2).

/** Forma mínima de una CrudEntry de op_intents que precisamos (subset de CrudEntry). */
export type OpIntentEntry = {
  /** id de la fila op_intents = client_op_id (clave de idempotencia, R6.10). */
  id: string;
  /** opData de la fila op_intents: op_type + params_json (+ created_at, no usado acá). */
  opData?: Record<string, unknown> | null;
};

/** Resultado del mapeo de un intent a su forma de aplicación en uploadData (siempre una RPC). */
export type IntentPlan = { kind: 'rpc'; rpcName: string; args: Record<string, unknown> };

/** op_types que se mapean a una RPC con los params del intent TAL CUAL (create_animal se mapea aparte:
 *  su params_json histórico es { animals, animal_profiles } y se TRADUCE a los args p_* de la RPC 0083). */
const RPC_OP_TYPES = new Set([
  'register_birth',
  'exit_animal_profile',
  'soft_delete_management_group',
  'soft_delete_rodeo',
  'soft_delete_animal_event',
  'soft_delete_event',
  // Run T9.8 — alta de rodeo OFFLINE: create_rodeo SÍ es RPC (0081). SIN p_client_op_id (dedup natural por
  // el id de cliente del rodeo + UPSERT de toggles → replay = no-op total, R6.10).
  'create_rodeo',
  // Run T9.9 — editar plantilla del rodeo OFFLINE: set_rodeo_config (0082). SIN p_client_op_id (su firma no
  // lo tiene; dedup natural por el UPSERT idempotente de toggles → replay = no-op total, R6.10).
  'set_rodeo_config',
]);

/**
 * Mapea una CrudEntry de op_intents a su plan de aplicación. PURA (testeable).
 *   - create_animal → { kind:'rpc', rpcName:'create_animal', args: p_* } (RPC ATÓMICA 0083; TRADUCE el
 *     shape histórico del intent { animals: {...}, animal_profiles: {...} } — los intents ya encolados
 *     en devices drenan por el camino nuevo; dedup NATURAL por los ids de cliente, replay = no-op 2xx).
 *   - register_birth → { kind:'rpc', args: { ...params, p_client_op_id: op.id } } (dedup EXPLÍCITA por
 *     client_op_id, delta 0075 — la ÚNICA RPC que recibe p_client_op_id; las demás firmas no lo tienen).
 *   - exit_animal_profile / soft_delete_* → { kind:'rpc', args: params } (dedup NATURAL, sin client_op_id).
 *
 * Tira si el op_type es desconocido o el params_json no parsea (defensivo: una intención corrupta es un
 * rechazo PERMANENTE — el catch de uploadData la descarta sin loop).
 */
/** Error de mapeo de un intent CORRUPTO (op_type desconocido / params inválidos). Marcado como
 *  PERMANENTE: classifyIntentUploadError lo descarta (no loop infinito de reintento transitorio). */
export class PermanentIntentError extends Error {
  readonly isPermanentIntentError = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentIntentError';
  }
}

export function mapIntentToRpc(op: OpIntentEntry): IntentPlan {
  const data = op.opData ?? {};
  const opType = typeof data.op_type === 'string' ? data.op_type : '';
  const rawParams = typeof data.params_json === 'string' ? data.params_json : '{}';
  let params: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawParams);
    params = parsed != null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new PermanentIntentError('op_intent params_json inválido');
  }

  if (opType === 'create_animal') {
    // RPC atómica 0083 (Run create-animal-rpc). El shape del intent es el HISTÓRICO de
    // enqueueCreateAnimal ({ animals: {...}, animal_profiles: {...} }, ids de cliente adentro) — NO se
    // cambió a propósito: los op_intents ya encolados en devices (camino viejo de 2 upserts) drenan por
    // esta misma traducción. Las keys ausentes del payload viajan como null → la RPC aplica sus defaults
    // server-side (coalesce de status/category_override/nursing; nullif/trim de los textos).
    const animals = (params.animals ?? {}) as Record<string, unknown>;
    const profile = (params.animal_profiles ?? {}) as Record<string, unknown>;
    if (typeof animals.id !== 'string' || typeof profile.id !== 'string') {
      // Sin ids de cliente no hay idempotencia posible → intent corrupto = rechazo PERMANENTE (no loop).
      throw new PermanentIntentError('create_animal sin ids de cliente (intent corrupto)');
    }
    return {
      kind: 'rpc',
      rpcName: 'create_animal',
      args: {
        p_animal_id: animals.id,
        p_profile_id: profile.id,
        p_establishment_id: profile.establishment_id ?? null,
        p_rodeo_id: profile.rodeo_id ?? null,
        p_category_id: profile.category_id ?? null,
        p_sex: animals.sex ?? null,
        p_species_id: animals.species_id ?? null,
        p_category_override: profile.category_override ?? false,
        p_status: profile.status ?? 'active',
        p_tag_electronic: animals.tag_electronic ?? null,
        p_birth_date: animals.birth_date ?? null,
        p_idv: profile.idv ?? null,
        p_visual_id_alt: profile.visual_id_alt ?? null,
        p_breed: profile.breed ?? null,
        p_coat_color: profile.coat_color ?? null,
        p_entry_date: profile.entry_date ?? null,
        p_entry_weight: profile.entry_weight ?? null,
        p_management_group_id: profile.management_group_id ?? null,
        p_teeth_state: profile.teeth_state ?? null,
        p_nursing: profile.nursing ?? null,
      },
    };
  }

  if (!RPC_OP_TYPES.has(opType)) {
    throw new PermanentIntentError(`op_intent op_type desconocido: ${opType || '(vacío)'}`);
  }

  // p_client_op_id SOLO a register_birth (su firma 4-arg lo tiene; las demás no — pasarlo daría
  // "function ... does not exist" / arg desconocido). El client_op_id = el id de la fila op_intents.
  const args =
    opType === 'register_birth' ? { ...params, p_client_op_id: op.id } : params;
  return { kind: 'rpc', rpcName: opType, args };
}

/** Destino de un error de la RPC de un intent (§5.4.4). */
export type IntentErrorDisposition = 'transient' | 'idempotent_discard' | 'permanent_reject';

/** ¿El error es de red / 5xx / timeout (transitorio)? Mismo criterio que isTransientUploadError. */
function isTransient(msg: string, code: string, status: number | undefined): boolean {
  if (/network|failed to fetch|fetch failed|networkerror|timeout|timed out/i.test(msg)) return true;
  if (status !== undefined && (status >= 500 || status === 429)) return true;
  // Un código de Postgres conocido NO es transitorio.
  if (code) return false;
  // 4xx (no 429) = rechazo del cliente → no transitorio; lo decide la rama de permanente abajo.
  if (status !== undefined && status >= 400 && status < 500) return false;
  // Sin señal clara → conservador: transitorio (mejor reintentar que descartar un dato de campo).
  return true;
}

/**
 * Clasifica el error de aplicar un intent (§5.4.4). PURA (testeable). `opType` discrimina los casos
 * idempotentes específicos por op (el `code` solo no alcanza: 23505 puede ser dedup legítima de
 * register_birth O un tag duplicado; P0002 es idempotente solo para soft_delete_*).
 *
 * @param error  el error de supabase.rpc (PostgrestError-like: { message, code, details, status }).
 * @param opType el op_type del intent (register_birth / exit_animal_profile / soft_delete_* / create_animal).
 */
export function classifyIntentUploadError(error: unknown, opType: string): IntentErrorDisposition {
  const e = (error ?? {}) as {
    message?: unknown; code?: unknown; details?: unknown; status?: unknown; isPermanentIntentError?: unknown;
  };
  const msg = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const details = typeof e.details === 'string' ? e.details : '';
  const status = typeof e.status === 'number' ? e.status : undefined;

  // (0) Intent CORRUPTO (op_type desconocido / params inválidos): mapIntentToRpc lo marca → rechazo
  //     PERMANENTE (no loop transitorio). Va PRIMERO (no tiene code Postgres ni status → si no, caería
  //     en "sin señal → transient" y loopearía para siempre).
  if (e.isPermanentIntentError === true) return 'permanent_reject';

  if (isTransient(msg, code, status)) return 'transient';

  // (1) P0002 (not found) de un soft_delete_* cuya fila YA está borrada (reintento at-least-once cuyo ACK
  //     se perdió) → éxito idempotente: descartar sin rollback (la baja real ya ocurrió, §5.4.3(4)).
  if (code === 'P0002' && opType.startsWith('soft_delete_')) {
    return 'idempotent_discard';
  }

  // (1-bis) P0002 (rodeo not found) de set_rodeo_config (Run T9.9): el rodeo objetivo de la edición ya NO
  //     existe / fue soft-deleteado → la edición de su plantilla es VOID. A diferencia de los soft_delete_*
  //     (donde P0002 = la baja YA ocurrió → idempotent_discard SIN rollback), acá el rollback del overlay
  //     optimista ES lo correcto: el usuario editó la plantilla local de un rodeo que entretanto desapareció
  //     → revertir esa vista optimista (la plantilla nunca se persistirá) + descartar el intent. Por eso
  //     permanent_reject (rollback + descarte), NO idempotent_discard.
  if (code === 'P0002' && opType === 'set_rodeo_config') {
    return 'permanent_reject';
  }

  // (2) 23505 del índice UNIQUE de idempotencia de register_birth (reproductive_events_client_op_id_uq):
  //     race del MISMO caller — la RPC ya corrió server-side (finding MED-1, Run 2). Descarte idempotente
  //     SIN rollback ni loop de reintento. Un 23505 de OTRO índice (p.ej. tag duplicado) NO matchea acá →
  //     cae a permanente (rollback + superficia). La detección es por el nombre del índice/columna en el
  //     mensaje o details de Postgres (la colisión del índice compuesto los incluye).
  if (
    code === '23505' &&
    opType === 'register_birth' &&
    /reproductive_events_client_op_id_uq|client_op_id/i.test(`${msg} ${details}`)
  ) {
    return 'idempotent_discard';
  }

  // (3) Todo lo demás (RLS 42501, FK 23503, check 23514, otro 23505 de dominio, op_type/params corruptos):
  //     rechazo PERMANENTE → rollback del overlay + descarte + superficia.
  return 'permanent_reject';
}
