// Tests de la lógica PURA del connector: credenciales + clasificación de errores de upload
// (spec 15, T1.5 / R3.1, R3.4, R3.5). node:test. connector.ts (I/O) importa supabase → no carga acá.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCredentials,
  buildCrudUpsert,
  buildCrudPatch,
  decodeJsonbColumns,
  isTransientUploadError,
  isPermanentServerCode,
} from './upload-classify.ts';

const ENDPOINT = 'https://inst.powersync.journeyapps.com';

// ─── fetchCredentials (R3.1) ──────────────────────────────────────────────────────────

test('R3.1: con sesión Supabase → { endpoint, token: access_token }', () => {
  const creds = buildCredentials(ENDPOINT, { access_token: 'jwt-123' });
  assert.deepEqual(creds, { endpoint: ENDPOINT, token: 'jwt-123' });
});

test('R3.1: SIN sesión → null (contrato del SDK: no conectar hasta el login)', () => {
  assert.equal(buildCredentials(ENDPOINT, null), null);
  assert.equal(buildCredentials(ENDPOINT, undefined), null);
});

test('R3.1: sesión sin access_token (o vacío/null) → null (no conectar con token vacío)', () => {
  assert.equal(buildCredentials(ENDPOINT, {}), null);
  assert.equal(buildCredentials(ENDPOINT, { access_token: '' }), null);
  assert.equal(buildCredentials(ENDPOINT, { access_token: null }), null);
});

// ─── Clasificación transitorio vs permanente (R3.4 / R3.5) ────────────────────────────

test('R3.4: error de red (por mensaje) → transitorio (deja en cola para reintento)', () => {
  for (const msg of ['Failed to fetch', 'network error', 'fetch failed', 'NetworkError', 'request timed out']) {
    assert.equal(isTransientUploadError({ message: msg }), true, `"${msg}" debería ser transitorio`);
  }
});

test('R3.4: 5xx / 429 → transitorio', () => {
  assert.equal(isTransientUploadError({ status: 500 }), true);
  assert.equal(isTransientUploadError({ status: 503 }), true);
  assert.equal(isTransientUploadError({ status: 429 }), true);
});

test('R3.5: RLS 42501 → permanente (descarta la op, no loop)', () => {
  assert.equal(isTransientUploadError({ code: '42501', message: 'permission denied' }), false);
});

test('R3.5: constraints clase 23 (not_null/fk/unique/check) → permanente', () => {
  for (const code of ['23502', '23503', '23505', '23514']) {
    assert.equal(isTransientUploadError({ code }), false, `${code} debería ser permanente`);
  }
});

test('R3.5: 4xx (no 429) → permanente (rechazo del cliente)', () => {
  assert.equal(isTransientUploadError({ status: 400 }), false);
  assert.equal(isTransientUploadError({ status: 403 }), false);
  assert.equal(isTransientUploadError({ status: 409 }), false);
});

test('sin señal clara de rechazo → conservador: transitorio (mejor reintentar un dato de campo)', () => {
  assert.equal(isTransientUploadError({}), true);
  assert.equal(isTransientUploadError(null), true);
  assert.equal(isTransientUploadError({ message: 'algo raro sin code ni status' }), true);
});

test('isPermanentServerCode: clases 22/23/42 + 42501; vacío/otros → no permanente', () => {
  assert.equal(isPermanentServerCode('42501'), true);
  assert.equal(isPermanentServerCode('22001'), true);
  assert.equal(isPermanentServerCode('23505'), true);
  assert.equal(isPermanentServerCode('42P01'), true);
  assert.equal(isPermanentServerCode(''), false);
  assert.equal(isPermanentServerCode('08006'), false); // connection_exception → no es 22/23/42
  assert.equal(isPermanentServerCode('P0002'), false); // not found (manejo idempotente Run T6)
});

// ─── buildCrudUpsert: plan de upsert PUT, special-case de PK COMPUESTA (spec 03 M5-C.1) ────────

test('buildCrudUpsert: tabla normal (PK id real) → re-inyecta id en el payload, SIN onConflict (= comportamiento previo)', () => {
  const plan = buildCrudUpsert('weight_events', 'evt-1', { animal_profile_id: 'ap-1', weight_kg: 385 });
  assert.equal(plan.onConflict, undefined);
  assert.deepEqual(plan.payload, { animal_profile_id: 'ap-1', weight_kg: 385, id: 'evt-1' });
});

test('buildCrudUpsert: custom_attributes (PK compuesta) → DESCARTA el id sintético + onConflict por la PK natural + value PARSEADO a jsonb nativo', () => {
  // El id local es sintético (animal_profile_id:field_definition_id) y NO es columna real → mandarlo a
  // PostgREST sería 42703. El upsert va por (animal_profile_id, field_definition_id). value se PARSEA del
  // JSON-TEXT local a su tipo nativo (string aquí) → PostgREST lo sube como jsonb del tipo correcto.
  const plan = buildCrudUpsert('custom_attributes', 'ap-1:fd-color', {
    animal_profile_id: 'ap-1',
    field_definition_id: 'fd-color',
    value: '"overo"',
  });
  assert.equal(plan.onConflict, 'animal_profile_id,field_definition_id');
  assert.deepEqual(plan.payload, {
    animal_profile_id: 'ap-1',
    field_definition_id: 'fd-color',
    value: 'overo', // ← jsonb string nativo (no '"overo"' double-encoded)
  });
  assert.ok(!('id' in plan.payload), 'el id sintético NO debe ir en el payload (columna inexistente → 42703)');
});

test('buildCrudUpsert: custom_attributes NUMÉRICO → value sube como NÚMERO jsonb (no string) — exigencia de jsonb_typeof', () => {
  const plan = buildCrudUpsert('custom_attributes', 'ap-1:fd-peso', {
    animal_profile_id: 'ap-1',
    field_definition_id: 'fd-peso',
    value: '385',
  });
  assert.equal(plan.payload.value, 385); // número nativo, no '385'
  assert.equal(typeof plan.payload.value, 'number');
});

test('buildCrudUpsert: custom_attributes — incluso si opData TRAJERA un id, se descarta', () => {
  const plan = buildCrudUpsert('custom_attributes', 'ap-1:fd-x', {
    id: 'ap-1:fd-x',
    animal_profile_id: 'ap-1',
    field_definition_id: 'fd-x',
    value: '3',
  });
  assert.ok(!('id' in plan.payload));
  assert.equal(plan.onConflict, 'animal_profile_id,field_definition_id');
  assert.equal(plan.payload.value, 3); // número nativo
});

test('buildCrudUpsert: opData null/undefined → payload mínimo (tabla normal solo el id)', () => {
  const plan = buildCrudUpsert('weight_events', 'evt-9', null);
  assert.deepEqual(plan.payload, { id: 'evt-9' });
  assert.equal(plan.onConflict, undefined);
});

test('buildCrudUpsert: NO muta el opData del caller (clona)', () => {
  const opData = { animal_profile_id: 'ap-1', field_definition_id: 'fd-1', value: '1' };
  const before = { ...opData };
  buildCrudUpsert('custom_attributes', 'ap-1:fd-1', opData);
  assert.deepEqual(opData, before, 'opData original intacto');
});

test('buildCrudUpsert: custom_measurements va por el camino NORMAL (id uuid REAL, no compuesta) pero value SÍ se parsea a jsonb nativo', () => {
  const plan = buildCrudUpsert('custom_measurements', 'cm-uuid', {
    animal_profile_id: 'ap-1',
    field_definition_id: 'fd-1',
    value: '42.5',
  });
  assert.equal(plan.onConflict, undefined, 'measurements tiene id real → upsert por id, sin onConflict');
  assert.equal(plan.payload.id, 'cm-uuid');
  assert.equal(plan.payload.value, 42.5); // número jsonb nativo (no '42.5')
  assert.equal(typeof plan.payload.value, 'number');
});

// ─── buildCrudPatch: PATCH plano, special-case de PK compuesta (re-edición de atributo) ────────

test('buildCrudPatch: tabla normal → match por { id }, payload sin tocar', () => {
  const plan = buildCrudPatch('weight_events', 'evt-1', { weight_kg: 390 });
  assert.deepEqual(plan.match, { id: 'evt-1' });
  assert.deepEqual(plan.payload, { weight_kg: 390 });
});

test('buildCrudPatch: custom_attributes (RE-EDICIÓN) → decodifica la PK natural del id sintético + match por (animal,field) + value parseado', () => {
  // La re-edición la trackea PowerSync como PATCH con solo `value` y el id sintético 'ap-1:fd-color'.
  const plan = buildCrudPatch('custom_attributes', 'ap-1:fd-color', { value: '"colorado"' });
  assert.deepEqual(plan.match, { animal_profile_id: 'ap-1', field_definition_id: 'fd-color' });
  assert.ok(!('id' in plan.match), 'NO debe filtrar por `id` (columna inexistente → 42703)');
  assert.deepEqual(plan.payload, { value: 'colorado' }); // jsonb string nativo (no double-encoded)
});

test('buildCrudPatch: custom_attributes RE-EDICIÓN numérica → value patcheado como NÚMERO jsonb (no string)', () => {
  const plan = buildCrudPatch('custom_attributes', 'ap-1:fd-peso', { value: '390' });
  assert.equal(plan.payload.value, 390);
  assert.equal(typeof plan.payload.value, 'number');
});

test('buildCrudPatch: custom_attributes — si opData TRAJERA un id sintético, se descarta del payload', () => {
  const plan = buildCrudPatch('custom_attributes', 'ap-1:fd-x', { id: 'ap-1:fd-x', value: '5' });
  assert.ok(!('id' in plan.payload));
  assert.deepEqual(plan.match, { animal_profile_id: 'ap-1', field_definition_id: 'fd-x' });
});

test('buildCrudPatch: custom_attributes con id MAL FORMADO (sin separador) → cae al filtro por id (defensivo)', () => {
  const plan = buildCrudPatch('custom_attributes', 'idsinseparador', { value: '1' });
  assert.deepEqual(plan.match, { id: 'idsinseparador' });
});

test('buildCrudPatch: opData null/undefined → payload vacío', () => {
  const plan = buildCrudPatch('weight_events', 'evt-2', null);
  assert.deepEqual(plan.payload, {});
  assert.deepEqual(plan.match, { id: 'evt-2' });
});

test('buildCrudPatch: NO muta el opData del caller', () => {
  const opData = { value: '"x"', id: 'a:f' };
  const before = { ...opData };
  buildCrudPatch('custom_attributes', 'a:f', opData);
  assert.deepEqual(opData, before);
});

// ─── decodeJsonbColumns: parseo del jsonb-as-TEXT a tipo nativo (anti doble-encoding, M5-C.1) ────

test('decodeJsonbColumns: custom_measurements/custom_attributes value (número/bool/string/array) → tipo nativo', () => {
  assert.deepEqual(decodeJsonbColumns('custom_measurements', { value: '42.5' }), { value: 42.5 });
  assert.deepEqual(decodeJsonbColumns('custom_measurements', { value: 'true' }), { value: true });
  assert.deepEqual(decodeJsonbColumns('custom_attributes', { value: '"overo"' }), { value: 'overo' });
  assert.deepEqual(decodeJsonbColumns('custom_attributes', { value: '["a","b"]' }), { value: ['a', 'b'] });
});

test('decodeJsonbColumns: deja intactas las columnas no-jsonb y las de tablas no listadas', () => {
  // tabla NO listada → sin cambios (value sigue siendo el string crudo).
  assert.deepEqual(decodeJsonbColumns('weight_events', { value: '385', weight_kg: 385 }), {
    value: '385',
    weight_kg: 385,
  });
  // misma tabla, columna no-jsonb (notes) intacta; solo value se parsea.
  assert.deepEqual(decodeJsonbColumns('custom_measurements', { value: '7', notes: 'pezuña' }), {
    value: 7,
    notes: 'pezuña',
  });
});

test('decodeJsonbColumns: value ausente / null / ya-nativo → no rompe', () => {
  assert.deepEqual(decodeJsonbColumns('custom_measurements', { notes: 'x' }), { notes: 'x' });
  assert.deepEqual(decodeJsonbColumns('custom_measurements', { value: null }), { value: null });
  // ya nativo (un connector que ya parseó) → se deja (typeof !== 'string').
  assert.deepEqual(decodeJsonbColumns('custom_measurements', { value: 42 }), { value: 42 });
});

test('decodeJsonbColumns: value con JSON inválido (no debería pasar) → se deja como está, no tira', () => {
  assert.deepEqual(decodeJsonbColumns('custom_measurements', { value: 'no-es-json{' }), {
    value: 'no-es-json{',
  });
});

test('decodeJsonbColumns: NO muta el objeto de entrada (clona)', () => {
  const data = { value: '42.5' };
  const before = { ...data };
  decodeJsonbColumns('custom_measurements', data);
  assert.deepEqual(data, before);
});
