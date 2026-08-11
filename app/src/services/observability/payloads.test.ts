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
  UPLOAD_REJECTED_EVENT,
  DOMAIN_EVENTS,
} from './payloads.ts';

test('R4.1/R4.2: upload_rejected lleva SOLO {table, op, code} — JAMÁS opData', () => {
  const op = {
    table: 'animals',
    op: 'PUT',
    id: 'row-1',
    // opData con datos del campo: NO debe salir NUNCA.
    opData: { peso: 385, tag: '982000123456789', nombre: 'La Vaca' },
  } as unknown as Parameters<typeof buildUploadRejectedPayload>[0];
  const payload = buildUploadRejectedPayload(op, { code: '42501', message: 'RLS' });

  assert.deepEqual(payload, { table: 'animals', op: 'PUT', code: '42501' });
  // Blindaje explícito: ni la clave opData ni ningún dato del campo.
  assert.equal('opData' in payload, false);
  const keys = Object.keys(payload).sort();
  assert.deepEqual(keys, ['code', 'op', 'table']);
  const s = JSON.stringify(payload);
  assert.equal(s.includes('385'), false);
  assert.equal(s.includes('982000123456789'), false);
  assert.equal(s.includes('La Vaca'), false);
});

test('R4.2: upload_rejected omite las claves ausentes (op null / sin code)', () => {
  assert.deepEqual(buildUploadRejectedPayload(null, {}), {});
  assert.deepEqual(
    buildUploadRejectedPayload({ table: 't' } as never, { code: undefined }),
    { table: 't' },
  );
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
