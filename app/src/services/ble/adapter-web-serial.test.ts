// Tests del framing por línea + soporte + backoff del adapter-web-serial (R5). node:test,
// PURO: se testea la lógica de LineFramer / isWebSerialSupported / backoffDelayMs (sin Web
// Serial real) y que cada línea CRUDA framed pase por el parser/contrato (R5.3). La I/O de
// navigator.serial (requestPort/open/read loop) NO se testea en CI (necesita Chrome+device);
// queda para la prueba real T2.5.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LineFramer, isWebSerialSupported, backoffDelayMs } from './line-framer.ts';
import { ingestRawLine } from './contract.ts';

// Capturas reales con framing del lector (header + EID + ts), terminadas en \n / \r\n.
const RAW_982 = '1000000982000364696050260530101701';
const RAW_032 = '1000000032010006382438260530102708';
const EID_982 = '982000364696050';
const EID_032 = '032010006382438';

// ─── R5.3: framing por línea (\n y \r\n) ─────────────────────────────────────────────────

test('R5.3: corta por \\n una línea completa en un solo chunk', () => {
  const f = new LineFramer();
  assert.deepEqual(f.push(`${RAW_982}\n`), [RAW_982]);
});

test('R5.3: tolera el terminador \\r\\n (el \\r queda en la línea, lo limpia el parser)', () => {
  const f = new LineFramer();
  const lines = f.push(`${RAW_982}\r\n`);
  assert.equal(lines.length, 1);
  // La línea framed va cruda al contrato; parseRs420Line/normalizeTag descartan el \r.
  assert.deepEqual(ingestRawLine(lines[0]), { ok: true, eid: EID_982 });
});

test('R5.3: bufferea fragmentos partidos entre chunks (Web Serial no garantiza 1 línea/chunk)', () => {
  const f = new LineFramer();
  // La línea llega en tres pedazos; solo se emite cuando aparece el \n.
  assert.deepEqual(f.push('10000009820003'), []);
  assert.deepEqual(f.push('64696050260530101701'), []);
  assert.deepEqual(f.push('\nbasura-sin-fin'), [RAW_982]);
});

test('R5.3: corta múltiples líneas en un mismo chunk y omite líneas vacías', () => {
  const f = new LineFramer();
  const lines = f.push(`${RAW_982}\n\n${RAW_032}\n`);
  assert.deepEqual(lines, [RAW_982, RAW_032]); // la línea vacía intermedia se omite
});

test('R5.3: cada línea framed reusada por el parser/contrato → EID correcto', () => {
  const f = new LineFramer();
  const lines = f.push(`\x02${RAW_982}\r\n\x02${RAW_032}\r\n`); // con STX como en el SPP real
  const eids = lines.map((l) => {
    const r = ingestRawLine(l);
    return r.ok ? r.eid : null;
  });
  assert.deepEqual(eids, [EID_982, EID_032]);
});

test('flush() devuelve el resto sin terminador y limpia el buffer', () => {
  const f = new LineFramer();
  f.push('linea-parcial-sin-newline');
  assert.equal(f.flush(), 'linea-parcial-sin-newline');
  assert.equal(f.flush(), null); // ya vaciado
});

test('flush() devuelve null si lo que queda es solo whitespace/\\r', () => {
  const f = new LineFramer();
  f.push('   \r');
  assert.equal(f.flush(), null);
});

// ─── R5.6: detección de soporte (degradación clara en navegadores sin Web Serial) ───────

test('R5.6: isWebSerialSupported es false en node (sin navigator.serial) — no rompe', () => {
  // En CI/node no hay navigator → false; en Chrome con Web Serial → true. No debe tirar.
  assert.equal(isWebSerialSupported(), false);
});

// ─── R5.5: backoff incremental de reconexión ────────────────────────────────────────────

test('R5.5: el backoff crece exponencialmente y se topea', () => {
  assert.equal(backoffDelayMs(0, 500, 8000), 500);
  assert.equal(backoffDelayMs(1, 500, 8000), 1000);
  assert.equal(backoffDelayMs(2, 500, 8000), 2000);
  assert.equal(backoffDelayMs(3, 500, 8000), 4000);
  assert.equal(backoffDelayMs(4, 500, 8000), 8000);
  assert.equal(backoffDelayMs(10, 500, 8000), 8000); // topeado al máximo
});
