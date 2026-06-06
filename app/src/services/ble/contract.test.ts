// Tests del contrato de ingesta de EID (R1, R2, R3). node:test, PURO (sin RN).
// Cubre: normalización/validación reusando el parser (R1.1-R1.4), timestamp del teléfono +
// forma del evento (R1.5, R1.6), el gate de confirmación pre-commit (R2), y la integración
// dedup↔contrato (R3) en el motor con estado.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ingestRawLine,
  ingestEid,
  buildTagReadEvent,
  buildConnectionEvent,
  EidIngestEngine,
} from './contract.ts';
import { TagDedup } from './dedup.ts';

// Capturas reales (field-findings.md): header 1000000 + EID + ts.
const RAW_982 = '1000000982000364696050260530101701'; // EID 982000364696050
const RAW_032 = '1000000032010006382438260530102708'; // EID 032010006382438
const EID_982 = '982000364696050';
const EID_032 = '032010006382438';

// ─── R1: normalización + validación reusando parser-rs420 ────────────────────────────────

test('R1.2/R1.3: ingestRawLine extrae el EID de una línea cruda real (descarta framing) y valida', () => {
  assert.deepEqual(ingestRawLine(RAW_982), { ok: true, eid: EID_982 });
  assert.deepEqual(ingestRawLine(RAW_032), { ok: true, eid: EID_032 });
});

test('R1.2: ingestRawLine tolera el byte de control STX y los terminadores \\r\\n (vía parser)', () => {
  assert.deepEqual(ingestRawLine('\x021000000982000364696050260530101701\r\n'), {
    ok: true,
    eid: EID_982,
  });
});

test('R1.4: ingestRawLine rechaza líneas malformadas SIN tirar (parse_failed / invalid_eid / empty)', () => {
  // Cabecera incorrecta → parseRs420Line null → parse_failed.
  assert.deepEqual(ingestRawLine('1000001982000364696050260530101701'), { ok: false, reason: 'parse_failed' });
  // EID de 14 dígitos → el parser anclado falla → parse_failed.
  assert.deepEqual(ingestRawLine('100000098200036469605260530101701'), { ok: false, reason: 'parse_failed' });
  // Basura → parse_failed.
  assert.deepEqual(ingestRawLine('hola mundo'), { ok: false, reason: 'parse_failed' });
  // Vacío / solo control → empty.
  assert.deepEqual(ingestRawLine(''), { ok: false, reason: 'empty' });
  assert.deepEqual(ingestRawLine('\x02\r\n'), { ok: false, reason: 'empty' });
});

test('R1.4: ingestRawLine nunca tira ante input no-string (defensivo)', () => {
  // @ts-expect-error: contrato robusto en runtime.
  assert.deepEqual(ingestRawLine(null), { ok: false, reason: 'empty' });
  // @ts-expect-error
  assert.deepEqual(ingestRawLine(undefined), { ok: false, reason: 'empty' });
});

test('R7.1/R1.3: ingestEid acepta un EID ya limpio (manual/mock) sin pasar por el parser de stream', () => {
  assert.deepEqual(ingestEid(EID_982), { ok: true, eid: EID_982 });
  assert.deepEqual(ingestEid('032010006382438'), { ok: true, eid: EID_032 });
});

test('R1.3: ingestEid normaliza bordes (espacios/control) antes de validar', () => {
  assert.deepEqual(ingestEid('  982000364696050  '), { ok: true, eid: EID_982 });
});

test('R1.4: ingestEid rechaza un identificador que NO es un EID válido (15 díg)', () => {
  assert.deepEqual(ingestEid('A123'), { ok: false, reason: 'invalid_eid' }); // IDV alfanumérico
  assert.deepEqual(ingestEid('98200036469605'), { ok: false, reason: 'invalid_eid' }); // 14 díg
  assert.deepEqual(ingestEid('982 000364696050'), { ok: false, reason: 'invalid_eid' }); // espacio interno
  assert.deepEqual(ingestEid(''), { ok: false, reason: 'empty' });
});

// ─── R1.5 / R1.6: timestamp del teléfono + forma exacta del evento de spec 09 ───────────

test('R1.6: buildTagReadEvent produce la forma EXACTA { kind:"tag_read", tag, timestamp } de spec 09', () => {
  const ev = buildTagReadEvent(EID_982, 1717000000000);
  assert.deepEqual(ev, { kind: 'tag_read', tag: EID_982, timestamp: 1717000000000 });
});

test('R1.5: el timestamp es el del teléfono inyectado (no el del lector, ya descartado por el parser)', () => {
  // El RAW_982 lleva ts del lector 260530101701; el evento usa el `now` del teléfono.
  const phoneNow = 9999999999999;
  const res = new EidIngestEngine().processRawLine(RAW_982, 1000);
  assert.ok(res && 'eid' in res);
  const ev = buildTagReadEvent((res as { eid: string }).eid, phoneNow);
  assert.equal(ev.kind === 'tag_read' && ev.timestamp, phoneNow);
  assert.ok(!String(ev.kind === 'tag_read' && ev.timestamp).includes('260530101701'));
});

test('R9.4: buildConnectionEvent produce { kind:"connection_changed", connected }', () => {
  assert.deepEqual(buildConnectionEvent(true), { kind: 'connection_changed', connected: true });
  assert.deepEqual(buildConnectionEvent(false), { kind: 'connection_changed', connected: false });
});

// ─── R2 + R3: motor con estado (dedup + gate de confirmación pre-commit) ────────────────

test('R3.1: el motor descarta el re-escaneo del mismo EID dentro de la ventana (devuelve null)', () => {
  const eng = new EidIngestEngine();
  const first = eng.processRawLine(RAW_982, 1000);
  assert.deepEqual(first, { eid: EID_982 });
  const dupe = eng.processRawLine(RAW_982, 1500); // <3s → ignorado
  assert.equal(dupe, null);
});

test('R3.2: el motor pasa tres EIDs distintos al instante (no hay cooldown global)', () => {
  const eng = new EidIngestEngine();
  const now = 1000;
  assert.deepEqual(eng.processEid(EID_982, now), { eid: EID_982 });
  assert.deepEqual(eng.processEid(EID_032, now), { eid: EID_032 });
  assert.deepEqual(eng.processEid('982000364696099', now), { eid: '982000364696099' });
});

test('R1.4: el motor reporta el motivo de rechazo de un malformado (para loguear, no commitea)', () => {
  const eng = new EidIngestEngine();
  assert.deepEqual(eng.processRawLine('1000001982000364696050260530101701', 1000), { rejected: 'parse_failed' });
  assert.deepEqual(eng.processEid('A123', 1000), { rejected: 'invalid_eid' });
});

test('R2.3: commit produce el tag_read SOLO cuando se confirma; un candidato no confirmado no emite', () => {
  const eng = new EidIngestEngine();
  const cand = eng.processRawLine(RAW_982, 1000);
  assert.deepEqual(cand, { eid: EID_982 });
  // El caller que DESCARTA (R2.3) simplemente no llama commit → no hay evento. (Acá no llamamos.)
  // El caller que CONFIRMA llama commit → tag_read con ts del teléfono.
  const ev = eng.commit((cand as { eid: string }).eid, 1717000000000);
  assert.deepEqual(ev, { kind: 'tag_read', tag: EID_982, timestamp: 1717000000000 });
});

test('R2.5: confirmación encadenable — tras commitear un EID, otro EID distinto es candidato independiente al instante', () => {
  const eng = new EidIngestEngine();
  const c1 = eng.processEid(EID_982, 1000);
  assert.deepEqual(c1, { eid: EID_982 });
  eng.commit((c1 as { eid: string }).eid, 1000);
  // El siguiente bastoneo de un EID DISTINTO no espera ninguna ventana.
  const c2 = eng.processEid(EID_032, 1000);
  assert.deepEqual(c2, { eid: EID_032 });
});

test('R3.4: el motor acepta una ventana de dedup inyectada (ajustable)', () => {
  const eng = new EidIngestEngine(new TagDedup(500));
  assert.deepEqual(eng.processEid(EID_982, 0), { eid: EID_982 });
  assert.equal(eng.processEid(EID_982, 400), null); // dentro de 500ms
  assert.deepEqual(eng.processEid(EID_982, 500), { eid: EID_982 }); // pasada la ventana custom
});

test('reset() del motor limpia la dedup', () => {
  const eng = new EidIngestEngine();
  assert.deepEqual(eng.processEid(EID_982, 1000), { eid: EID_982 });
  assert.equal(eng.processEid(EID_982, 1100), null);
  eng.reset();
  assert.deepEqual(eng.processEid(EID_982, 1100), { eid: EID_982 });
});
