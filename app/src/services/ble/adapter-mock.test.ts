// Tests del adapter-mock + del pipeline completo del contrato ejercitado por el mock (R10).
// node:test, PURO (el mock y el contrato no importan RN). Replica el E2E sin device de T7.2:
// un mockTagRead dispara validate→dedup→candidato; 3 EIDs distintos = asignación masiva;
// disable no dispara (R10.5/R10.8).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MockAdapter } from './adapter-mock.ts';
import { EidIngestEngine, buildTagReadEvent } from './contract.ts';
import type { BleStickEvent } from './stick-adapter.ts';

const EID_A = '982000364696050';
const EID_B = '032010006382438';
const EID_C = '982000364696099';

/**
 * Cablea un MockAdapter al contrato como lo hace el provider: cada lectura del adapter pasa
 * por el motor (validate + dedup); el caller "confirma" cada candidato (commit) y registra
 * el tag_read resultante. Devuelve los eventos emitidos.
 */
function wireMockToEngine(adapter: MockAdapter, now = () => 1000): BleStickEvent[] {
  const engine = new EidIngestEngine();
  const events: BleStickEvent[] = [];
  adapter.onTagRead((eid) => {
    const candidate = engine.processEid(eid, now());
    if (candidate && 'eid' in candidate) {
      events.push(engine.commit(candidate.eid, now())); // confirmación inmediata (simula UI)
    }
  });
  return events;
}

test('R10.1: mockTagRead inyecta una lectura que dispara el pipeline → tag_read', () => {
  const adapter = new MockAdapter();
  const events = wireMockToEngine(adapter);
  adapter.enable();
  adapter.mockTagRead(EID_A);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], buildTagReadEvent(EID_A, 1000));
});

test('R10.8/R3.2: 3 EIDs distintos → 3 tag_read al instante (asignación masiva spec 09 R8)', () => {
  const adapter = new MockAdapter();
  const events = wireMockToEngine(adapter);
  adapter.enable();
  adapter.mockTagRead(EID_A);
  adapter.mockTagRead(EID_B);
  adapter.mockTagRead(EID_C);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => (e.kind === 'tag_read' ? e.tag : null)), [EID_A, EID_B, EID_C]);
});

test('R10.8/R3.1: el mismo EID re-inyectado en la ventana se ignora (dedup en el contrato)', () => {
  const adapter = new MockAdapter();
  let clock = 1000;
  const events = wireMockToEngine(adapter, () => clock);
  adapter.enable();
  adapter.mockTagRead(EID_A);
  clock = 1500; // <3s
  adapter.mockTagRead(EID_A);
  assert.equal(events.length, 1); // el re-escaneo no produce un segundo evento
});

test('R10.5/R10.8: con disable, mockTagRead NO dispara (MODO MANIOBRAS suspende la escucha)', () => {
  const adapter = new MockAdapter();
  const events = wireMockToEngine(adapter);
  adapter.disable();
  adapter.mockTagRead(EID_A);
  assert.equal(events.length, 0);
  // Re-habilitar reanuda la escucha (R10.5).
  adapter.enable();
  adapter.mockTagRead(EID_A);
  assert.equal(events.length, 1);
});

test('R1.4: un EID inválido inyectado NO produce tag_read (validación en el contrato)', () => {
  const adapter = new MockAdapter();
  const events = wireMockToEngine(adapter);
  adapter.enable();
  adapter.mockTagRead('A123'); // IDV alfanumérico, no es un EID de 15 díg
  adapter.mockTagRead('98200036469605'); // 14 díg
  assert.equal(events.length, 0);
});

test('R10.1/R9.4: mockConnectionChange emite el status por onStatus', () => {
  const adapter = new MockAdapter();
  const statuses: string[] = [];
  adapter.onStatus((s) => statuses.push(s));
  adapter.mockConnectionChange(true);
  adapter.mockConnectionChange(false);
  assert.deepEqual(statuses, ['connected', 'disconnected']);
  assert.equal(adapter.isConnected, false);
});

test('unsubscribe de onTagRead deja de recibir lecturas', () => {
  const adapter = new MockAdapter();
  adapter.enable();
  const seen: string[] = [];
  const unsub = adapter.onTagRead((eid) => seen.push(eid));
  adapter.mockTagRead(EID_A);
  unsub();
  adapter.mockTagRead(EID_B);
  assert.deepEqual(seen, [EID_A]);
});
