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

test('mapIntentToRpc: soft_delete_* (incl. maneuver_preset, spec 03 M1.3) → rpc SIN p_client_op_id', () => {
  for (const opType of [
    'soft_delete_management_group',
    'soft_delete_rodeo',
    'soft_delete_animal_event',
    'soft_delete_event',
    'soft_delete_maneuver_preset',
  ]) {
    const plan = mapIntentToRpc({ id: 'c', opData: { op_type: opType, params_json: '{"p_preset_id":"p1"}' } });
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

test('mapIntentToRpc: assign_tag_to_animal → rpc con p_client_op_id = op.id inyectado (passthrough, NO ancla la dedup, spec 09 / 0089)', () => {
  // op_type = NOMBRE EXACTO de la RPC (fold MED-1 de Gate 1): el mapeo genérico (rpcName: opType) lo cubre
  // sin case especial. SÍ recibe p_client_op_id (su firma (uuid,text,uuid) lo tiene) — passthrough del
  // contrato del intent; la dedup es STATE-BASED (RD1.6), no depende de este valor.
  const plan = mapIntentToRpc({
    id: 'cop-at',
    opData: {
      op_type: 'assign_tag_to_animal',
      params_json: JSON.stringify({ p_profile_id: 'prof-1', p_tag_electronic: '012345678901234' }),
    },
  });
  assert.equal(plan.kind, 'rpc');
  if (plan.kind !== 'rpc') return;
  assert.equal(plan.rpcName, 'assign_tag_to_animal', 'rpcName === op_type (sin remapeo)');
  assert.equal(plan.args.p_profile_id, 'prof-1');
  assert.equal(plan.args.p_tag_electronic, '012345678901234');
  // p_client_op_id = el id de la fila op_intents (passthrough; la RPC NO lo usa para la dedup state-based).
  assert.equal(plan.args.p_client_op_id, 'cop-at');
});

test('mapIntentToRpc: create_animal → RPC atómica 0083 con args p_* (payload COMPLETO traducido)', () => {
  // Run create-animal-rpc: el alta YA NO son 2 upserts (perdían el dato bajo reintento, backlog
  // 2026-06-10) — mapea a supabase.rpc('create_animal', p_*). El shape del intent es el HISTÓRICO
  // ({ animals, animal_profiles }) → compat con los op_intents ya encolados en devices.
  const plan = mapIntentToRpc({
    id: 'cop-3',
    opData: {
      op_type: 'create_animal',
      params_json: JSON.stringify({
        animals: { id: 'a1', sex: 'female', species_id: 'sp1', tag_electronic: 'TAG1', birth_date: '2024-07-01' },
        animal_profiles: {
          id: 'p1', animal_id: 'a1', establishment_id: 'e1', rodeo_id: 'r1', category_id: 'c1',
          category_override: true, status: 'active', idv: 'IDV1', visual_id_alt: 'V1', breed: 'Angus',
          coat_color: 'negro', entry_date: '2026-06-01', entry_weight: 180.5, management_group_id: 'mg1',
          teeth_state: '2d', nursing: true,
        },
      }),
    },
  });
  assert.equal(plan.kind, 'rpc');
  assert.equal(plan.rpcName, 'create_animal');
  assert.equal(plan.args.p_animal_id, 'a1');
  assert.equal(plan.args.p_profile_id, 'p1');
  assert.equal(plan.args.p_establishment_id, 'e1');
  assert.equal(plan.args.p_rodeo_id, 'r1');
  assert.equal(plan.args.p_category_id, 'c1');
  assert.equal(plan.args.p_sex, 'female');
  assert.equal(plan.args.p_species_id, 'sp1');
  assert.equal(plan.args.p_category_override, true);
  assert.equal(plan.args.p_status, 'active');
  assert.equal(plan.args.p_tag_electronic, 'TAG1');
  assert.equal(plan.args.p_birth_date, '2024-07-01');
  assert.equal(plan.args.p_idv, 'IDV1');
  assert.equal(plan.args.p_visual_id_alt, 'V1');
  assert.equal(plan.args.p_breed, 'Angus');
  assert.equal(plan.args.p_coat_color, 'negro');
  assert.equal(plan.args.p_entry_date, '2026-06-01');
  assert.equal(plan.args.p_entry_weight, 180.5);
  assert.equal(plan.args.p_management_group_id, 'mg1');
  assert.equal(plan.args.p_teeth_state, '2d');
  assert.equal(plan.args.p_nursing, true);
  // create_animal NO recibe p_client_op_id (dedup natural por los ids de cliente, R6.10).
  assert.ok(!('p_client_op_id' in plan.args), 'create_animal NO debe llevar p_client_op_id');
});

test('mapIntentToRpc: create_animal MINIMAL (intent VIEJO ya encolado, keys opcionales ausentes) → nulls + defaults', () => {
  // Compat hacia atrás OBLIGATORIA: los op_intents encolados por el camino viejo solo llevan las keys
  // presentes (createAnimal omite tag/birth_date/idv/etc. si no vinieron). El mapeo debe traducir ESE
  // shape: opcionales ausentes → null (la RPC aplica sus defaults server-side).
  const plan = mapIntentToRpc({
    id: 'cop-old',
    opData: {
      op_type: 'create_animal',
      params_json: JSON.stringify({
        animals: { id: 'a2', sex: 'male', species_id: 'sp1' },
        animal_profiles: {
          id: 'p2', animal_id: 'a2', establishment_id: 'e1', rodeo_id: 'r1', category_id: 'c2',
          category_override: false, status: 'active', idv: 'IDV2',
        },
      }),
    },
  });
  assert.equal(plan.kind, 'rpc');
  assert.equal(plan.rpcName, 'create_animal');
  assert.equal(plan.args.p_animal_id, 'a2');
  assert.equal(plan.args.p_profile_id, 'p2');
  assert.equal(plan.args.p_idv, 'IDV2');
  // Opcionales ausentes en el intent viejo → null explícito (NO undefined: el arg viaja y la RPC decide).
  assert.equal(plan.args.p_tag_electronic, null);
  assert.equal(plan.args.p_birth_date, null);
  assert.equal(plan.args.p_visual_id_alt, null);
  assert.equal(plan.args.p_breed, null);
  assert.equal(plan.args.p_coat_color, null);
  assert.equal(plan.args.p_entry_date, null);
  assert.equal(plan.args.p_entry_weight, null);
  assert.equal(plan.args.p_management_group_id, null);
  assert.equal(plan.args.p_teeth_state, null);
  assert.equal(plan.args.p_nursing, null);
});

test('mapIntentToRpc: create_animal SIN ids de cliente → PermanentIntentError (sin ids no hay idempotencia)', () => {
  assert.throws(
    () =>
      mapIntentToRpc({
        id: 'cop-bad',
        opData: {
          op_type: 'create_animal',
          params_json: JSON.stringify({ animals: { sex: 'female' }, animal_profiles: { establishment_id: 'e1' } }),
        },
      }),
    PermanentIntentError,
  );
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
  // spec 03 M1.3 — el soft-delete de preset reintentado (preset ya borrado) → descarte idempotente.
  assert.equal(classifyIntentUploadError({ code: 'P0002' }, 'soft_delete_maneuver_preset'), 'idempotent_discard');
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

test('create_animal como RPC (0083): 42501 / 23505 tag-idv → permanent_reject; red → transient; replay = 2xx sin error', () => {
  // El replay (mismos ids de cliente) es un no-op EXITOSO de la RPC (ON CONFLICT DO NOTHING) → 2xx,
  // NO produce error → no necesita idempotent_discard. Cualquier error es transient o un rechazo real.
  // 42501 = sin rol en el establishment (o guard anti-IDOR de la RPC); 23505 = tag de OTRO animal /
  // idv duplicado (el ON CONFLICT de la RPC targetea SOLO la PK → los UNIQUE de dominio SÍ revientan).
  assert.equal(classifyIntentUploadError({ code: '42501' }, 'create_animal'), 'permanent_reject');
  assert.equal(
    classifyIntentUploadError({ code: '23505', message: 'animals_tag_unique' }, 'create_animal'),
    'permanent_reject',
  );
  assert.equal(
    classifyIntentUploadError(
      { code: '23505', message: 'duplicate key value violates unique constraint "animal_profiles_idv_unique"' },
      'create_animal',
    ),
    'permanent_reject',
  );
  // Red caída a mitad del drenado (la cadena del bug del backlog 2026-06-10) → transient: la tx queda
  // en cola y el REINTENTO contra la RPC atómica es un no-op seguro (ya no se auto-envenena con 42501).
  assert.equal(classifyIntentUploadError({ message: 'fetch failed' }, 'create_animal'), 'transient');
  assert.equal(classifyIntentUploadError({ status: 503 }, 'create_animal'), 'transient');
});

test('assign_tag_to_animal: 23505 (dup global) / 23514 (race o formato) / 42501 (sin rol) / 23503 (perfil inexistente) → permanent_reject; red → transient (spec 09)', () => {
  // El default `permanent_reject` (rama 3 del clasificador) cubre TODOS los rechazos reales del RPC SIN un
  // case nuevo: el replay idempotente devuelve 2xx con {replay:true} (NO entra al clasificador). Por eso
  // classifyIntentUploadError queda SIN cambios para esta op (design §2.3 / RD2.4, ratificado por Gate 1).
  assert.equal(
    classifyIntentUploadError({ code: '23505', message: 'duplicate key value violates unique constraint "animals_tag_unique"' }, 'assign_tag_to_animal'),
    'permanent_reject',
  );
  assert.equal(classifyIntentUploadError({ code: '23514', message: 'animal already has a tag (race)' }, 'assign_tag_to_animal'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ code: '23514', message: 'tag_electronic must be exactly 15 digits' }, 'assign_tag_to_animal'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ code: '42501' }, 'assign_tag_to_animal'), 'permanent_reject');
  assert.equal(classifyIntentUploadError({ code: '23503' }, 'assign_tag_to_animal'), 'permanent_reject');
  // CRÍTICO: un 23505 de assign_tag_to_animal NO debe caer en el idempotent_discard de register_birth (ese
  // case matchea por opType === 'register_birth' + el nombre del índice reproductive_events_client_op_id_uq).
  // El dup global de TAG es un rechazo de dominio REAL (rollback + surface "ese TAG ya está en otro animal").
  assert.equal(
    classifyIntentUploadError({ code: '23505', message: 'duplicate key ... reproductive_events_client_op_id_uq' }, 'assign_tag_to_animal'),
    'permanent_reject',
  );
  // Red / 5xx → transitorio (queda en cola, NO toca nada — no hay overlay para esta op).
  assert.equal(classifyIntentUploadError({ message: 'fetch failed' }, 'assign_tag_to_animal'), 'transient');
  assert.equal(classifyIntentUploadError({ status: 503 }, 'assign_tag_to_animal'), 'transient');
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
