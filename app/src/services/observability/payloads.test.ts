// Tests de FORMA de los payloads outbound (feature 17, R4.2/R4.4/R6.4/R7.1/R3.3/R5.5). node:test.
// payloads.ts es PURO (sin SDK) → estas MISMAS funciones las llaman los sinks reales (connector /
// ble/logging / posthog) → no es un espejo. Falsifican: si alguien ensancha un payload con opData/PII/EID,
// el test cae en rojo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUploadRejectedPayload,
  buildBleBreadcrumb,
  buildNavigationBreadcrumb,
  buildTenantRegister,
  buildCaptureTags,
  UPLOAD_REJECTED_EVENT,
  REQUEST_ID_TAG,
  DOMAIN_EVENTS,
} from './payloads.ts';

test('R4.1/R4.2 (+ spec 23): upload_rejected lleva SOLO {id, table, op, code} — JAMÁS opData', () => {
  const op = {
    table: 'animals',
    op: 'PUT',
    id: 'row-1',
    // opData con datos del campo: NO debe salir NUNCA.
    opData: { peso: 385, tag: '982000123456789', nombre: 'La Vaca' },
  } as unknown as Parameters<typeof buildUploadRejectedPayload>[0];
  const payload = buildUploadRejectedPayload(op, { code: '42501', message: 'RLS' });

  // Spec 23: el payload incluye `id` (= op.id, id de la fila afectada, no-PII) para correlacionar
  // la op rechazada, ADEMÁS de table/op/code.
  assert.deepEqual(payload, { id: 'row-1', table: 'animals', op: 'PUT', code: '42501' });
  assert.equal(payload.id, 'row-1');
  // Blindaje explícito: ni la clave opData ni ningún dato del campo (falsifica: si alguien ensancha
  // el payload con opData/PII del CrudEntry, este test cae en rojo).
  assert.equal('opData' in payload, false);
  const keys = Object.keys(payload).sort();
  assert.deepEqual(keys, ['code', 'id', 'op', 'table']);
  const s = JSON.stringify(payload);
  assert.equal(s.includes('385'), false);
  assert.equal(s.includes('982000123456789'), false);
  assert.equal(s.includes('La Vaca'), false);
  assert.equal(s.includes('opData'), false);
});

test('R4.2: upload_rejected omite las claves ausentes (op null / sin code)', () => {
  assert.deepEqual(buildUploadRejectedPayload(null, {}), {});
  assert.deepEqual(
    buildUploadRejectedPayload({ table: 't' } as never, { code: undefined }),
    { table: 't' },
  );
});

test('R4.1 (spec 23): captureExceptionSafe adjunta el tag request_id con el valor del requestId', () => {
  // buildCaptureTags es la MISMA función que llama captureExceptionSafe (sentry.native.ts) para armar el
  // `tags` de la captura. Con un requestId, el tag `request_id` DEBE llevar ese valor exacto (correlación).
  const tags = buildCaptureTags({ mechanism: 'RootErrorBoundary', requestId: 'req-abc-123' });
  assert.equal(tags[REQUEST_ID_TAG], 'req-abc-123');
  assert.equal(tags.request_id, 'req-abc-123');
  assert.equal(tags.mechanism, 'RootErrorBoundary');
  // Solo las dos claves esperadas — falsifica: si alguien deja de adjuntar request_id, el test cae en rojo.
  assert.deepEqual(Object.keys(tags).sort(), ['mechanism', 'request_id']);
});

test('R4.4 (spec 23): el request_id es POR-CAPTURA — no se filtra a otra captura sin requestId', () => {
  // Una captura CON requestId y otra SIN: la segunda NO hereda el request_id de la primera (sin setTag global
  // sticky). buildCaptureTags no tiene estado → cada llamada es un objeto fresco.
  const withReq = buildCaptureTags({ mechanism: 'm', requestId: 'req-1' });
  const withoutReq = buildCaptureTags({ mechanism: 'm' });
  assert.equal(withReq.request_id, 'req-1');
  assert.equal('request_id' in withoutReq, false);
  // Dos requestIds distintos → tags independientes (no comparten referencia ni valor).
  const a = buildCaptureTags({ requestId: 'req-A' });
  const b = buildCaptureTags({ requestId: 'req-B' });
  assert.equal(a.request_id, 'req-A');
  assert.equal(b.request_id, 'req-B');
  assert.notEqual(a, b);
});

test('R4.4: buildCaptureTags omite las claves ausentes (hint vacío / sin hint → {})', () => {
  assert.deepEqual(buildCaptureTags(), {});
  assert.deepEqual(buildCaptureTags({}), {});
  assert.deepEqual(buildCaptureTags({ requestId: 'only-req' }), { request_id: 'only-req' });
  assert.deepEqual(buildCaptureTags({ mechanism: 'only-mech' }), { mechanism: 'only-mech' });
});

test('R4.4: breadcrumb BLE = kind + campos diagnósticos, sin EID crudo ni PII', () => {
  // eid_rejected NUNCA lleva el EID: solo el motivo (el union TransportLogEvent lo garantiza).
  const bc = buildBleBreadcrumb({ kind: 'eid_rejected', reason: 'invalid_eid' });
  assert.equal(bc.category, 'ble');
  assert.deepEqual(bc.data, { kind: 'eid_rejected', reason: 'invalid_eid' });
  // No hay ninguna clave de tag/eid/idv/opData.
  const keys = Object.keys(bc.data);
  for (const k of ['tag', 'eid', 'idv', 'opData', 'tag_electronic']) {
    assert.equal(keys.includes(k), false, `el breadcrumb BLE no debe llevar ${k}`);
  }
});

test('R3.2/R3.3: breadcrumb de navegación lleva SOLO el pathname (sin params)', () => {
  const bc = buildNavigationBreadcrumb('animal/[id]');
  assert.equal(bc.category, 'navigation');
  assert.deepEqual(bc.data, { pathname: 'animal/[id]' });
  assert.deepEqual(Object.keys(bc.data), ['pathname']);
});

test('R5.5: super props del tenant = {role, establishment_id, env}, sin PII', () => {
  const reg = buildTenantRegister('est-1', 'owner', 'production');
  assert.deepEqual(reg, { role: 'owner', establishment_id: 'est-1', env: 'production' });
  const keys = Object.keys(reg).sort();
  assert.deepEqual(keys, ['env', 'establishment_id', 'role']);
  // Ninguna clave de PII.
  for (const k of ['email', 'name', 'nombre', 'phone', 'telefono']) {
    assert.equal(k in reg, false);
  }
});

test('nombres de eventos estables (contrato con los dashboards)', () => {
  assert.equal(UPLOAD_REJECTED_EVENT, 'upload_rejected');
  assert.equal(DOMAIN_EVENTS.maniobraGuardada, 'maniobra_guardada');
  assert.equal(DOMAIN_EVENTS.importCompletado, 'import_completado');
  assert.equal(DOMAIN_EVENTS.invitacionEnviada, 'invitacion_enviada');
});
