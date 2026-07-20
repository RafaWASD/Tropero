// Tests del SimulatorAdapter (RMV4.1/4.2). node:test, PURO (simulador + contrato no importan RN).
// El simulador emite EIDs sintéticos VÁLIDOS que corren por el MISMO contrato de ingesta que un
// EID real (validate + dedup + confirmación pre-commit) — replica el pipeline sin bastón físico.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SimulatorAdapter } from './adapter-simulator.ts';
import { EidIngestEngine, buildTagReadEvent } from './contract.ts';
import { isValidTag } from './parser-rs420.ts';
import type { BleStickEvent } from './stick-adapter.ts';

/**
 * Cablea el simulador al contrato como lo hace el provider (handleReading isRawStream=false):
 * cada lectura pasa por el motor (validate + dedup); el caller "confirma" cada candidato
 * (commit) y registra el tag_read. Devuelve los eventos emitidos.
 */
function wireSimToEngine(adapter: SimulatorAdapter, now = () => 1000): BleStickEvent[] {
  const engine = new EidIngestEngine();
  const events: BleStickEvent[] = [];
  adapter.onTagRead((eid) => {
    const candidate = engine.processEid(eid, now());
    if (candidate && 'eid' in candidate) {
      events.push(engine.commit(candidate.eid, now()));
    }
  });
  return events;
}

// ─── RMV4.1: kind + connect → 'connected' ───────────────────────────────────────────────────

test('RMV4.1: SimulatorAdapter tiene kind "simulator" y connect emite "connected"', async () => {
  const adapter = new SimulatorAdapter();
  assert.equal(adapter.kind, 'simulator');
  const statuses: string[] = [];
  adapter.onStatus((s) => statuses.push(s));
  await adapter.connect();
  assert.deepEqual(statuses, ['connected']);
  assert.equal(adapter.isConnected, true);
});

// ─── RMV4.2: emit() de EID válido dispara el pipeline (candidato → commit → tag_read) ───────

test('RMV4.2: emit() sin arg dispara el pipeline con un EID sintético válido → tag_read', () => {
  const adapter = new SimulatorAdapter();
  const events = wireSimToEngine(adapter);
  adapter.enable();
  adapter.emit();
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.kind, 'tag_read');
  if (ev.kind === 'tag_read') assert.equal(isValidTag(ev.tag), true); // el EID emitido es válido
});

test('RMV4.2: emit(eid) con un EID explícito lo procesa por el contrato', () => {
  const adapter = new SimulatorAdapter();
  const events = wireSimToEngine(adapter);
  adapter.enable();
  adapter.emit('982000364696050');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], buildTagReadEvent('982000364696050', 1000));
});

// ─── RMV4.2: EIDs sintéticos rotan por una lista REALISTA — válidos + distintos dentro de un ciclo ─

test('RMV4.2: N emits generan EIDs válidos y distintos → N tag_read (rotación realista, no contador)', () => {
  const adapter = new SimulatorAdapter();
  const seen: string[] = [];
  adapter.enable();
  adapter.onTagRead((eid) => seen.push(eid));
  // 8 < largo de la lista de EIDs demo (10) → todas las emisiones caen en un mismo ciclo → todas distintas.
  for (let i = 0; i < 8; i++) adapter.emit();
  assert.equal(seen.length, 8);
  for (const eid of seen) assert.equal(isValidTag(eid), true); // todos válidos (RMV4.1)
  assert.equal(new Set(seen).size, 8); // distintos dentro del ciclo → la dedup por-TAG no los descarta
  // Son EIDs REALISTAS: mezcla de prefijo país 032 (caravana oficial) + fabricante 982 (Allflex), NO un
  // contador obvio-fake tipo 032000000000000/032000000000001.
  assert.ok(
    seen.some((e) => e.startsWith('032')) && seen.some((e) => e.startsWith('982')),
    'los EIDs demo deben mezclar prefijos 032 y 982 (realistas)',
  );
});

// ─── RMV4.1: respeta enable/disable (como el mock) ──────────────────────────────────────────

test('RMV4.1: con disable, emit NO propaga (respeta la escucha lógica como el mock)', () => {
  const adapter = new SimulatorAdapter();
  const seen: string[] = [];
  adapter.onTagRead((eid) => seen.push(eid));
  adapter.disable();
  adapter.emit();
  assert.equal(seen.length, 0);
  adapter.enable();
  adapter.emit();
  assert.equal(seen.length, 1);
});

// ─── disconnect + auto-play cleanup ─────────────────────────────────────────────────────────

test('disconnect emite "disconnected" y detiene el auto-play', async () => {
  const adapter = new SimulatorAdapter();
  const statuses: string[] = [];
  adapter.onStatus((s) => statuses.push(s));
  adapter.enable();
  adapter.startAutoPlay(10_000); // no debe quedar un timer colgado tras disconnect
  await adapter.disconnect();
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(adapter.isConnected, false);
});

test('unsubscribe de onTagRead deja de recibir lecturas', () => {
  const adapter = new SimulatorAdapter();
  adapter.enable();
  const seen: string[] = [];
  const unsub = adapter.onTagRead((eid) => seen.push(eid));
  adapter.emit('982000364696050');
  unsub();
  adapter.emit('032010006382438');
  assert.deepEqual(seen, ['982000364696050']);
});
