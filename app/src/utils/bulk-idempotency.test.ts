// Tests de la idempotencia de eventos de masiva (spec 10, T-CL.6 / R6.1, R6.2, R6.3).
// PURO: sin SDK/RN/supabase → corre siempre con node:test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bulkEventId,
  idempotencyName,
  filterNewEventKeys,
  uuidv5,
  sha1,
  BULK_EVENT_NAMESPACE,
  type IdempotencyKey,
} from './bulk-idempotency.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ─── UUIDv5 contra el vector canónico de RFC 4122 (ancla de correctitud del SHA-1 propio) ───

test('uuidv5: vector canónico RFC 4122 (namespace DNS + www.example.com)', () => {
  // El vector de referencia de la implementación estándar (uuid lib / RFC). Si el SHA-1 puro o el
  // ensamblado de bits de versión/variante driftan, este test ROMPE de inmediato.
  const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert.equal(uuidv5('www.example.com', DNS), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
});

test('uuidv5: namespace DNS + nombre vacío (segundo vector estable)', () => {
  const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  // Determinístico y bien formado (version 5 + variant RFC4122).
  const id = uuidv5('', DNS);
  assert.match(id, UUID_RE);
  // Mismo input ⇒ mismo output (re-cálculo).
  assert.equal(uuidv5('', DNS), id);
});

test('sha1: vector vacío FIPS 180-1 (da9039...)', () => {
  // SHA-1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709.
  const hex = [...sha1(new Uint8Array(0))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
});

test('sha1: vector "abc" FIPS 180-1 (a9993e...)', () => {
  const hex = [...sha1(new TextEncoder().encode('abc'))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('sha1: vector MULTI-BLOQUE 56 bytes FIPS 180-1 (84983e...) — blinda el padding de 2 bloques', () => {
  // 56 bytes fuerza un segundo bloque de padding (el más propenso a bugs de longitud big-endian).
  const s = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
  const hex = [...sha1(new TextEncoder().encode(s))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, '84983e441c3bd26ebaae4aa1f95129e5e54670f1');
});

test('sha1: vector 64 bytes (boundary exacto de bloque) — 0098ba...', () => {
  const hex = [...sha1(new TextEncoder().encode('a'.repeat(64)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  assert.equal(hex, '0098ba824b5c16427bd7a1122a5a442a25ec644d');
});

// ─── R6.1: misma clave ⇒ mismo id; claves distintas ⇒ ids distintos ─────────────────────────

test('R6.1: bulkEventId es determinístico — misma clave ⇒ mismo id (en dos llamadas)', () => {
  const key: IdempotencyKey = { animalProfileId: 'prof-1', type: 'weaning', date: '2026-06-11' };
  const id1 = bulkEventId(key);
  const id2 = bulkEventId({ ...key });
  assert.equal(id1, id2);
  assert.match(id1, UUID_RE);
});

test('R6.1: claves distintas ⇒ ids distintos (animal / tipo / fecha cambian el id)', () => {
  const base: IdempotencyKey = { animalProfileId: 'prof-1', type: 'weaning', date: '2026-06-11' };
  const idBase = bulkEventId(base);
  const idOtroAnimal = bulkEventId({ ...base, animalProfileId: 'prof-2' });
  const idOtroTipo = bulkEventId({ ...base, type: 'vaccination' });
  const idOtraFecha = bulkEventId({ ...base, date: '2026-06-12' });
  const all = [idBase, idOtroAnimal, idOtroTipo, idOtraFecha];
  // Los 4 son distintos entre sí.
  assert.equal(new Set(all).size, 4);
});

test('R6.1: distintos tipos del MISMO animal+fecha NO colisionan (tipo va primero en el name)', () => {
  const animal = 'prof-x';
  const date = '2026-06-11';
  assert.notEqual(
    bulkEventId({ animalProfileId: animal, type: 'vaccination', date }),
    bulkEventId({ animalProfileId: animal, type: 'weaning', date }),
  );
});

test('idempotencyName: formato canónico estable <type>:<animal>:<date>', () => {
  assert.equal(
    idempotencyName({ animalProfileId: 'p1', type: 'vaccination', date: '2026-06-11' }),
    'vaccination:p1:2026-06-11',
  );
});

test('el namespace de RAFAQ es un UUID válido y CONGELADO (cambiarlo rompería la dedup)', () => {
  assert.match(BULK_EVENT_NAMESPACE, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  // Pin del valor: si alguien lo toca por accidente, este test lo caza.
  assert.equal(BULK_EVENT_NAMESPACE, '6b9a7d2e-1c4f-5a83-9e0b-2f3c4d5e6a7b');
});

// ─── R6.2 / R6.3: re-ejecución excluye los ya-procesados ────────────────────────────────────

test('R6.3: filterNewEventKeys excluye las claves cuyo id determinístico YA existe localmente', () => {
  const keys: IdempotencyKey[] = [
    { animalProfileId: 'a', type: 'weaning', date: '2026-06-11' },
    { animalProfileId: 'b', type: 'weaning', date: '2026-06-11' },
    { animalProfileId: 'c', type: 'weaning', date: '2026-06-11' },
  ];
  // Simula: 'b' ya fue destetado en una corrida anterior (su id ya está en el SQLite).
  const existing = new Set<string>([bulkEventId(keys[1])]);
  const result = filterNewEventKeys(keys, existing);
  const animals = result.map((r) => r.key.animalProfileId).sort();
  assert.deepEqual(animals, ['a', 'c']); // 'b' excluido
  // Cada salida trae su id determinístico (el que se usará como PK del INSERT).
  for (const r of result) assert.equal(r.id, bulkEventId(r.key));
});

test('R6.3: re-ejecutar la MISMA masiva completa ⇒ 0 mutaciones nuevas (todos ya presentes)', () => {
  const keys: IdempotencyKey[] = [
    { animalProfileId: 'a', type: 'vaccination', date: '2026-06-11' },
    { animalProfileId: 'b', type: 'vaccination', date: '2026-06-11' },
  ];
  // Primera corrida: ninguno presente → ambos nuevos.
  const first = filterNewEventKeys(keys, new Set());
  assert.equal(first.length, 2);
  // "Se aplicaron": sus ids quedan en el local. Segunda corrida idéntica → 0 nuevos.
  const applied = new Set(first.map((r) => r.id));
  const second = filterNewEventKeys(keys, applied);
  assert.equal(second.length, 0);
});

test('R6.2: claves DUPLICADAS dentro del mismo batch colapsan a una sola (dedup intra-batch)', () => {
  const dup: IdempotencyKey = { animalProfileId: 'a', type: 'weaning', date: '2026-06-11' };
  const result = filterNewEventKeys([dup, { ...dup }, { ...dup }], new Set());
  assert.equal(result.length, 1);
});

test('R6.2: lista vacía ⇒ sin mutaciones nuevas', () => {
  assert.deepEqual(filterNewEventKeys([], new Set()), []);
});
