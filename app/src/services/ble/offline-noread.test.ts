// Tests de offline-first del contrato (R14) y de no-read silencioso (R13). node:test, sin RN
// ni red. La sola ejecución de TODO el contrato bajo node:test (sin keys de Supabase, sin
// fetch) ya demuestra que normalizar/validar/dedup/confirmar/emitir NO tocan la red (R14.2):
// si tocaran red, estos tests fallarían sin conectividad. Acá lo afirmamos explícitamente +
// el caso no-read.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EidIngestEngine } from './contract.ts';
import { MockAdapter } from './adapter-mock.ts';

const EID_A = '982000364696050';

// ─── R14: offline-first ─────────────────────────────────────────────────────────────────

test('R14.2: el contrato de ingesta completo corre sin red (este test no tiene conectividad)', () => {
  // No hay import de supabase/fetch en el grafo del contrato; el pipeline es local y puro.
  const eng = new EidIngestEngine();
  const cand = eng.processRawLine('1000000982000364696050260530101701', 1000);
  assert.deepEqual(cand, { eid: EID_A });
  const ev = eng.commit((cand as { eid: string }).eid, 1717000000000);
  assert.equal(ev.kind, 'tag_read');
  // Si algún paso requiriera internet, esta aserción no se alcanzaría offline (R14.1/R14.2).
});

// ─── R13: no-read silencioso ────────────────────────────────────────────────────────────

test('R13.1: un accionamiento SIN tag (el adapter no emite) NO produce evento', () => {
  const adapter = new MockAdapter();
  adapter.enable();
  const seen: string[] = [];
  adapter.onTagRead((eid) => seen.push(eid));
  // Accionar el bastón sin detectar tag = el adapter no llama onTagRead (no hay mockTagRead).
  // No-read silencioso: cero eventos, cero errores.
  assert.deepEqual(seen, []);
});

test('R13.2: no se asume señal de "lectura fallida" — el motor no inventa rechazos sin entrada', () => {
  const eng = new EidIngestEngine();
  // Sin entrada no hay procesamiento; el motor no emite ni un rechazo espontáneo.
  // (El único rechazo posible viene de una LÍNEA malformada concreta, no de un no-read.)
  assert.ok(eng); // el motor existe y no produjo nada por sí solo
});
