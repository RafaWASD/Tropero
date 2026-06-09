// Tests del mapeo intent→RPC + clasificación de errores de la outbox (spec 15, T6 / §5.4.2–§5.4.4).
// node:test. PURO: upload.ts no carga el SDK/supabase → corre siempre.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapIntentToRpc, classifyIntentUploadError, PermanentIntentError } from './upload.ts';

// ─── mapIntentToRpc (§5.4.2) ────────────────────────────────────────────────────────

test('mapIntentToRpc: register_birth → rpc con p_client_op_id = op.id inyectado (dedup explícita, delta 0075)', () => {
  const plan = mapIntentToRpc({
    id: 'cop-1',
    opData: {
      op_type: 'register_birth',
      params_json: JSON.stringify({ p_mother_profile_id: 'm1', p_event_date: '2026-06-09', p_calves: [{ calf_sex: 'male' }] }),
    },
  });
  assert.equal(plan.kind, 'rpc');
  if (plan.kind !== 'rpc') return;
  assert.equal(plan.rpcName, 'register_birth');
  // CRÍTICO: register_birth recibe p_client_op_id = el id de la fila op_intents (idempotencia at-least-once).
  assert.equal(plan.args.p_client_op_id, 'cop-1');
  assert.equal(plan.args.p_mother_profile_id, 'm1');
});

test('mapIntentToRpc: exit_animal_profile NO recibe p_client_op_id (su firma no lo tiene, dedup natural)', () => {
  const plan = mapIntentToRpc({
    id: 'cop-2',
    opData: {
      op_type: 'exit_animal_profile',
      params_json: JSON.stringify({ p_profile_id: 'p1', p_status: 'sold', p_exit_reason: 'sale', p_exit_date: '2026-06-09' }),
    },
  });
  assert.equal(plan.kind, 'rpc');
  if (plan.kind !== 'rpc') return;
  assert.equal(plan.rpcName, 'exit_animal_profile');
  assert.ok(!('p_client_op_id' in plan.args), 'exit_animal_profile NO debe llevar p_client_op_id');
});

test('mapIntentToRpc: soft_delete_management_group / soft_delete_rodeo → rpc SIN p_client_op_id', () => {
  for (const opType of ['soft_delete_management_group', 'soft_delete_rodeo', 'soft_delete_animal_event', 'soft_delete_event']) {
    const plan = mapIntentToRpc({ id: 'c', opData: { op_type: opType, params_json: '{"p_rodeo_id":"r1"}' } });
    assert.equal(plan.kind, 'rpc');
    if (plan.kind !== 'rpc') continue;
    assert.equal(plan.rpcName, opType);
    assert.ok(!('p_client_op_id' in plan.args), `${opType} NO debe llevar p_client_op_id`);
  }
});

test('mapIntentToRpc: create_rodeo → rpc SIN p_client_op_id (dedup natural por el id de cliente, Run T9.8)', () => {
  const plan = mapIntentToRpc({
    id: 'cop-r',
    opData: {
      op_type: 'create_rodeo',
      params_json: JSON.stringify({
        p_id: 'rod-1', p_establishment_id: 'est-1', p_name: 'Rodeo principal',
        p_species_id: 'sp-1', p_system_id: 'sys-1',
        p_toggles: [{ field_definition_id: 'fd-peso', enabled: false }],
      }),
    },
  });
  assert.equal(plan.kind, 'rpc');
  if (plan.kind !== 'rpc') return;
  assert.equal(plan.rpcName, 'create_rodeo');
  // create_rodeo NO recibe p_client_op_id (idempotencia natural por ON CONFLICT del id + UPSERT de toggles).
  assert.ok(!('p_client_op_id' in plan.args), 'create_rodeo NO debe llevar p_client_op_id');
  assert.equal(plan.args.p_id, 'rod-1');
  assert.deepEqual(plan.args.p_toggles, [{ field_definition_id: 'fd-peso', enabled: false }]);
});

test('mapIntentToRpc: set_rodeo_config → rpc SIN p_client_op_id (dedup natural por el UPSERT, Run T9.9)', () => {
  const plan = mapIntentToRpc({
    id: 'cop-src',
    opData: {
      op_type: 'set_rodeo_config',
      params_json: JSON.stringify({
        p_rodeo_id: 'rod-7',
        p_toggles: [
          { field_definition_id: 'fd-preñez', enabled: true },
          { field_definition_id: 'fd-peso', enabled: false },
        ],
      }),
    },
  });
  assert.equal(plan.kind, 'rpc');
  if (plan.kind !== 'rpc') return;
  assert.equal(plan.rpcName, 'set_rodeo_config');
  // set_rodeo_config NO recibe p_client_op_id (su firma no lo tiene; idempotencia natural por el UPSERT).
  assert.ok(!('p_client_op_id' in plan.args), 'set_rodeo_config NO debe llevar p_client_op_id');
  assert.equal(plan.args.p_rodeo_id, 'rod-7');
  assert.deepEqual(plan.args.p_toggles, [
    { field_definition_id: 'fd-preñez', enabled: true },
    { field_definition_id: 'fd-peso', enabled: false },
  ]);
});

test('mapIntentToRpc: create_animal → plan especial con los 2 payloads (NO hay RPC create_animal)', () => {
  const plan = mapIntentToRpc({
    id: 'cop-3',
    opData: {
      op_type: 'create_animal',
      params_json: JSON.stringify({
        animals: { id: 'a1', sex: 'female', species_id: 'sp1' },
        animal_profiles: { id: 'p1', animal_id: 'a1', establishment_id: 'e1' },
      }),
    },
  });
  assert.equal(plan.kind, 'create_animal');
  if (plan.kind !== 'create_animal') return;
  assert.equal(plan.animals.id, 'a1');
  assert.equal(plan.animal_profiles.id, 'p1');
  assert.equal(plan.animal_profiles.animal_id, 'a1');
});

test('mapIntentToRpc: op_type desconocido → tira (rechazo permanente → uploadData descarta sin loop)', () => {
  assert.throws(() => mapIntentToRpc({ id: 'c', opData: { op_type: 'rm_rf', params_json: '{}' } }));
});

test('mapIntentToRpc: params_json corrupto → tira', () => {
  assert.throws(() => mapIntentToRpc({ id: 'c', opData: { op_type: 'register_birth', params_json: '{not json' } }));
});

// ─── classifyIntentUploadError (§5.4.4) ───────────────────────────────────────────────

test('clasificación: red / 5xx / timeout → transient (re-throw, queda en cola, NO toca overlay)', () => {
  assert.equal(classifyIntentUploadError({ message: 'Network request failed' }, 'register_birth'), 'transient');
  assert.equal(classifyIntentUploadError({ message: 'fetch failed' }, 'exit_animal_profile'), 'transient');
  assert.equal(classifyIntentUploadError({ status: 503 }, 'register_birth'), 'transient');
  assert.equal(classifyIntentUploadError({ status: 429 }, 'register_birth'), 'transient');
  assert.equal(classifyIntentUploadError({ message: 'timed out' }, 'soft_delete_rodeo'), 'transient');
  // sin señal clara → conservador: transitorio (mejor reintentar que descartar un dato de campo).
  assert.equal(classifyIntentUploadError({}, 'register_birth'), 'transient');
});

test('clasificación: 42501 (RLS) / 23503 (FK) / 23514 (check) → permanent_reject (rollback + superficia)', () => {
  assert.equal(classifyIntentUploadError({ code: '42501' }, 'exit_animal_profile'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ code: '23503' }, 'register_birth'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ code: '23514' }, 'soft_delete_rodeo'), 'permanent_reject');
});

test('create_rodeo: 42501 (no-owner) / 23514 (system inválido) → permanent_reject; NO hay idempotent_discard (Run T9.8)', () => {
  // create_rodeo es idempotente NATURAL por ON CONFLICT DO NOTHING → un replay devuelve 2xx (ACK normal),
  // NO un error. Por eso NO necesita un caso idempotent_discard: cualquier error es transient o un rechazo real.
  assert.equal(classifyIntentUploadError({ code: '42501' }, 'create_rodeo'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ code: '23514' }, 'create_rodeo'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ message: 'fetch failed' }, 'create_rodeo'), 'transient');
});

test('set_rodeo_config: 42501 (no-owner) / 23503 (field inexistente) → permanent_reject; red → transient (Run T9.9)', () => {
  // set_rodeo_config es idempotente NATURAL por el UPSERT → un replay devuelve 2xx (ACK normal), no un error.
  // 42501 = no-owner o p_rodeo_id ajeno (anti-IDOR por derivación del est); 23503 = field_definition_id que el
  // FK rechaza. Ambos son rechazos de dominio/authz → rollback del overlay optimista + descarte + superficia.
  assert.equal(classifyIntentUploadError({ code: '42501' }, 'set_rodeo_config'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ code: '23503' }, 'set_rodeo_config'), 'permanent_reject');
  // red / 5xx → transitorio (queda en cola, NO toca overlay).
  assert.equal(classifyIntentUploadError({ message: 'fetch failed' }, 'set_rodeo_config'), 'transient');
  assert.equal(classifyIntentUploadError({ status: 503 }, 'set_rodeo_config'), 'transient');
});

test('set_rodeo_config: P0002 (rodeo not found / soft-deleteado) → permanent_reject (rollback del overlay, Run T9.9)', () => {
  // CONTRASTE con soft_delete_* (donde P0002 = la baja YA ocurrió → idempotent_discard SIN rollback): acá el
  // rodeo a editar ya NO existe → la edición es void → rollback del overlay optimista + descarte. NO se trata
  // como idempotent_discard (no hubo un efecto real previo que preservar).
  assert.equal(classifyIntentUploadError({ code: 'P0002' }, 'set_rodeo_config'), 'permanent_reject');
});

test('IDEMPOTENCIA: P0002 (not found) de un soft_delete_* ya aplicado → idempotent_discard (sin rollback)', () => {
  assert.equal(classifyIntentUploadError({ code: 'P0002' }, 'soft_delete_management_group'), 'idempotent_discard');
  assert.equal(classifyIntentUploadError({ code: 'P0002' }, 'soft_delete_rodeo'), 'idempotent_discard');
  assert.equal(classifyIntentUploadError({ code: 'P0002' }, 'soft_delete_event'), 'idempotent_discard');
});

test('P0002 que NO es de un soft_delete (p.ej. register_birth) → permanent_reject (no idempotente acá)', () => {
  // register_birth no levanta P0002 por reintento (su dedup es por 23505 del índice); un P0002 ajeno NO
  // debe tratarse como descarte idempotente.
  assert.equal(classifyIntentUploadError({ code: 'P0002' }, 'register_birth'), 'permanent_reject');
});

test('IDEMPOTENCIA MED-1: 23505 del índice reproductive_events_client_op_id_uq de register_birth → idempotent_discard', () => {
  // race del MISMO caller: la RPC ya corrió server-side → descarte idempotente SIN rollback ni loop.
  assert.equal(
    classifyIntentUploadError(
      { code: '23505', message: 'duplicate key value violates unique constraint "reproductive_events_client_op_id_uq"' },
      'register_birth',
    ),
    'idempotent_discard',
  );
  // también por la columna en details.
  assert.equal(
    classifyIntentUploadError({ code: '23505', details: 'Key (animal_profile_id, client_op_id)=(...) already exists.' }, 'register_birth'),
    'idempotent_discard',
  );
});

test('NO confundir: 23505 de OTRO índice (tag duplicado) en register_birth → permanent_reject (rollback)', () => {
  // un ternero con tag ya asignado: 23505 del índice de tag, NO del de idempotencia → rechazo de dominio.
  assert.equal(
    classifyIntentUploadError(
      { code: '23505', message: 'duplicate key value violates unique constraint "animals_tag_unique"' },
      'register_birth',
    ),
    'permanent_reject',
  );
});

test('NO confundir: 23505 en create_animal (tag/idv duplicado) → permanent_reject', () => {
  assert.equal(
    classifyIntentUploadError({ code: '23505', message: 'animals_tag_unique' }, 'create_animal'),
    'permanent_reject',
  );
});

test('op corrupto: mapIntentToRpc tira PermanentIntentError → classifyIntentUploadError = permanent_reject (no loop)', () => {
  // Un intent corrupto (op_type desconocido / params inválidos) NO tiene code Postgres ni status: si se
  // clasificara como un Error plano, caería en "sin señal → transient" y loopearía para siempre. El marcador
  // PermanentIntentError lo fuerza a permanent_reject → uploadData lo descarta (rollback + complete, no loop).
  let thrown: unknown;
  try {
    mapIntentToRpc({ id: 'c', opData: { op_type: 'rm_rf', params_json: '{}' } });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof PermanentIntentError);
  assert.equal(classifyIntentUploadError(thrown, ''), 'permanent_reject');
  // un Error plano (sin el marcador) SÍ sería transient — confirmamos el contraste.
  assert.equal(classifyIntentUploadError(new Error('algo'), ''), 'transient');
});
