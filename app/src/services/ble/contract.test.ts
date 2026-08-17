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
import { RS420_DRIVER } from './driver-rs420.ts';
import type { FrameParser } from './driver-types.ts';

// Capturas reales (field-findings.md): header 1000000 + EID + ts.
const RAW_982 = '1000000982000364696050260530101701'; // EID 982000364696050
const RAW_032 = '1000000032010006382438260530102708'; // EID 032010006382438
const EID_982 = '982000364696050';
const EID_032 = '032010006382438';

// ── El parser de trama entra por PARÁMETRO (RBM1.1/RBM1.2, delta ios-ble-mfi 2026-08-17) ──────────
// `contract.ts` ya no importa `parseRs420Line`: el desframeo sale del `ReaderDriver` del adaptador
// que produjo la línea. Estos tests siguen usando el del RS420 porque las capturas de arriba SON
// tramas del RS420 — o sea que este archivo cubre exactamente el mismo comportamiento que antes
// (regresión, RBM1.5), solo que el parser ahora llega desde el registro de drivers. Que un driver
// DISTINTO se ingiera de punta a punta sin tocar este módulo lo cubre `frame-parser-resolve.test.ts`
// (RBM1.6), y que nadie vuelva a hardcodearlo acá, su guard estático (RBM1.7).
const RS420_PARSER = RS420_DRIVER.frameParser;

// ─── R1: normalización + validación reusando parser-rs420 ────────────────────────────────

test('R1.2/R1.3: ingestRawLine extrae el EID de una línea cruda real (descarta framing) y valida', () => {
  assert.deepEqual(ingestRawLine(RAW_982, RS420_PARSER), { ok: true, eid: EID_982 });
  assert.deepEqual(ingestRawLine(RAW_032, RS420_PARSER), { ok: true, eid: EID_032 });
});

test('R1.2: ingestRawLine tolera el byte de control STX y los terminadores \\r\\n (vía parser)', () => {
  assert.deepEqual(ingestRawLine('\x021000000982000364696050260530101701\r\n', RS420_PARSER), {
    ok: true,
    eid: EID_982,
  });
});

test('R1.4: ingestRawLine rechaza líneas malformadas SIN tirar (parse_failed / invalid_eid / empty)', () => {
  // Cabecera incorrecta → parseRs420Line null → parse_failed.
  assert.deepEqual(ingestRawLine('1000001982000364696050260530101701', RS420_PARSER), { ok: false, reason: 'parse_failed' });
  // EID de 14 dígitos → el parser anclado falla → parse_failed.
  assert.deepEqual(ingestRawLine('100000098200036469605260530101701', RS420_PARSER), { ok: false, reason: 'parse_failed' });
  // Basura → parse_failed.
  assert.deepEqual(ingestRawLine('hola mundo', RS420_PARSER), { ok: false, reason: 'parse_failed' });
  // Vacío / solo control → empty.
  assert.deepEqual(ingestRawLine('', RS420_PARSER), { ok: false, reason: 'empty' });
  assert.deepEqual(ingestRawLine('\x02\r\n', RS420_PARSER), { ok: false, reason: 'empty' });
});

test('R1.4: ingestRawLine nunca tira ante input no-string (defensivo)', () => {
  // @ts-expect-error: contrato robusto en runtime.
  assert.deepEqual(ingestRawLine(null, RS420_PARSER), { ok: false, reason: 'empty' });
  // @ts-expect-error
  assert.deepEqual(ingestRawLine(undefined, RS420_PARSER), { ok: false, reason: 'empty' });
});

// ── RBM1.1/RBM1.2: el parser ENTRA POR PARÁMETRO y es el que MANDA ──────────────────────────────

test('RBM1.1: ingestRawLine usa EL PARSER QUE SE LE PASA (no uno propio) — con otro parser, otro resultado', () => {
  // El oráculo que distingue "el parser entra por parámetro" de "el contrato tiene el suyo": con un
  // parser sintético, la MISMA línea del RS420 tiene que fallar, y una línea que solo ese parser
  // entiende tiene que salir. Si `contract.ts` volviera a llamar `parseRs420Line` por su cuenta, las
  // dos aserciones se invierten.
  const OTRO: FrameParser = { parse: (raw) => (raw.startsWith('#') ? { eid: raw.slice(1) } : null) };
  assert.deepEqual(ingestRawLine(RAW_982, OTRO), { ok: false, reason: 'parse_failed' });
  assert.deepEqual(ingestRawLine(`#${EID_982}`, OTRO), { ok: true, eid: EID_982 });
  // Y al revés, para que no pase por casualidad: el parser del RS420 no entiende la trama del otro.
  assert.deepEqual(ingestRawLine(`#${EID_982}`, RS420_PARSER), { ok: false, reason: 'parse_failed' });
});

test('RBM1.8: isValidTag se aplica igual venga el EID del parser que venga (integridad SENASA)', () => {
  // Un driver de un fabricante nuevo es código que NO controlamos: si su parser devuelve algo que no
  // es un EID (14 dígitos, alfanumérico, vacío), el contrato lo rechaza igual. Lo que RBM1 cambia es
  // de dónde sale el parser, NO la validación.
  const FLOJO: FrameParser = { parse: (raw) => ({ eid: raw }) }; // "parsea" cualquier cosa
  assert.deepEqual(ingestRawLine('98200036469605', FLOJO), { ok: false, reason: 'invalid_eid' }); // 14 díg
  assert.deepEqual(ingestRawLine('A12345678901234', FLOJO), { ok: false, reason: 'invalid_eid' });
  assert.deepEqual(ingestRawLine(EID_982, FLOJO), { ok: true, eid: EID_982 });
});

test('R15.2: un frameParser de un fabricante que TIRA no puede tumbar la ingesta (se rechaza, no propaga)', () => {
  // El read-loop del transporte no atrapa (verificado en `SppAndroidAdapter.emitTag`): una excepción
  // del parser de un driver de tercero mataba la ingesta del bastón hasta reconectar.
  const ROTO: FrameParser = {
    parse: () => {
      throw new Error('boom');
    },
  };
  assert.deepEqual(ingestRawLine(RAW_982, ROTO), { ok: false, reason: 'parser_threw' });
  assert.deepEqual(new EidIngestEngine().processRawLine(RAW_982, ROTO, 1000), { rejected: 'parser_threw' });
});

test('🟡-2: "el DRIVER está roto" y "el LECTOR mandó basura" NO se loguean igual (dos causas, dos acciones)', () => {
  // Hasta el review de F1 los dos eran `parse_failed`, byte por byte. Con un lector nuevo ésa es
  // justo la pregunta que hay que poder contestar desde el log: ¿el bastón manda cualquier cosa, o
  // el driver que escribimos está roto? La primera se arregla mirando el aparato; la segunda, el
  // código. La aserción es la DIFERENCIA, no los literales: si alguien vuelve a unificarlos, cae.
  const EXPLOTA: FrameParser = {
    parse: () => {
      throw new Error('boom');
    },
  };
  const NO_ENTIENDE: FrameParser = { parse: () => null };

  const roto = ingestRawLine(RAW_982, EXPLOTA);
  const basura = ingestRawLine(RAW_982, NO_ENTIENDE);
  assert.equal(roto.ok, false);
  assert.equal(basura.ok, false);
  assert.notDeepEqual(
    roto,
    basura,
    'el driver que explota y la trama que este parser no entiende volvieron a producir el MISMO ' +
      'rechazo: con eso, el diagnóstico de un lector nuevo es adivinar',
  );
});

test('RBM1.4: sin parser (llamada desde JS, sin tipos) NO se ingiere nada — se rechaza, no crashea', () => {
  // El parámetro es requerido POR TIPO, pero el runtime no lo sabe: un call site en un `.tsx` o un
  // camino que se salte el typecheck no puede lograr que una línea entre sin desframear, ni tumbar
  // el read-loop del transporte con un TypeError. Fail-closed también acá, y con el motivo del
  // DRIVER (el TypeError sale del `parse` que no existe, no de una trama mala).
  assert.deepEqual(ingestRawLine(RAW_982, null as unknown as FrameParser), { ok: false, reason: 'parser_threw' });
  assert.deepEqual(
    ingestRawLine(RAW_982, undefined as unknown as FrameParser),
    { ok: false, reason: 'parser_threw' },
  );
});

test('R15.2: un frameParser que devuelve una forma inesperada se rechaza (no explota aguas abajo)', () => {
  // `undefined` en vez de `null`, o un objeto sin `eid`: los dos son "no parseó", no un EID.
  const RARO: FrameParser = { parse: () => undefined as unknown as { eid: string } | null };
  assert.deepEqual(ingestRawLine(RAW_982, RARO), { ok: false, reason: 'parse_failed' });
  const SIN_EID: FrameParser = { parse: () => ({}) as { eid: string } };
  assert.deepEqual(ingestRawLine(RAW_982, SIN_EID), { ok: false, reason: 'parse_failed' });
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
  const res = new EidIngestEngine().processRawLine(RAW_982, RS420_PARSER, 1000);
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
  const first = eng.processRawLine(RAW_982, RS420_PARSER, 1000);
  assert.deepEqual(first, { eid: EID_982 });
  const dupe = eng.processRawLine(RAW_982, RS420_PARSER, 1500); // <3s → ignorado
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
  assert.deepEqual(eng.processRawLine('1000001982000364696050260530101701', RS420_PARSER, 1000), { rejected: 'parse_failed' });
  assert.deepEqual(eng.processEid('A123', 1000), { rejected: 'invalid_eid' });
});

test('R2.3: commit produce el tag_read SOLO cuando se confirma; un candidato no confirmado no emite', () => {
  const eng = new EidIngestEngine();
  const cand = eng.processRawLine(RAW_982, RS420_PARSER, 1000);
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
