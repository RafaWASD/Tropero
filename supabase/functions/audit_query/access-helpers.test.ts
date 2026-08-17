// access-helpers.test.ts — falsifica los helpers PUROS del gate de auth de la EF `audit_query` (delta
// cloudflare-access). node:test, sin Deno. Ejerce las MISMAS funciones que corren en producción (importadas
// de ./access-helpers.ts, no un espejo). La verificación del JWT (jose/JWKS, en access.ts) es integración
// deploy-gated (importa `npm:jose` — no importable por node); se cubre en el smoke end-to-end del deploy.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseEmailAllowlist,
  proxySecretMatches,
  timingSafeEqualBytes,
} from './access-helpers.ts';

const enc = (s: string) => new TextEncoder().encode(s);

// ── parseEmailAllowlist: null = Access-como-autoridad (NO fail-open), Set lowercased si poblado (RCFA.2.13) ──

test('RCFA.2.13: secret ausente (undefined/null) → null (no filtra por email, Access es la autoridad)', () => {
  assert.equal(parseEmailAllowlist(undefined), null);
  assert.equal(parseEmailAllowlist(null), null);
});

test('RCFA.2.13: secret vacío / solo espacios / solo comas → null (no filtra)', () => {
  assert.equal(parseEmailAllowlist(''), null);
  assert.equal(parseEmailAllowlist('   '), null);
  assert.equal(parseEmailAllowlist(',, , ,'), null);
});

test('RCFA.2.13: secret poblado → Set lowercased, trim, sin tokens en blanco', () => {
  const set = parseEmailAllowlist('  Raf@Mitropero.com , FACUNDO@mitropero.com , ,');
  assert.ok(set instanceof Set);
  if (!(set instanceof Set)) return;
  assert.equal(set.size, 2);
  // Falsifica el gate: un email en mayúsculas del JWT matchea porque el Set está lowercased.
  assert.ok(set.has('raf@mitropero.com'));
  assert.ok(set.has('facundo@mitropero.com'));
});

test('RCFA.2.13: email fuera de la allowlist queda EXCLUIDO (has() = false)', () => {
  const set = parseEmailAllowlist('raf@mitropero.com');
  assert.ok(set instanceof Set);
  if (!(set instanceof Set)) return;
  assert.equal(set.has('intruso@evil.com'), false);
  assert.equal(set.has('raf@mitropero.com'), true);
});

// ── timingSafeEqualBytes: sin early-return por contenido, false ante largo distinto ──────────────────────

test('timingSafeEqualBytes: bytes idénticos → true', () => {
  assert.equal(timingSafeEqualBytes(enc('s3cr3t-abc'), enc('s3cr3t-abc')), true);
});

test('timingSafeEqualBytes: mismo largo, un byte distinto → false', () => {
  assert.equal(timingSafeEqualBytes(enc('s3cr3t-abc'), enc('s3cr3t-abd')), false);
});

test('timingSafeEqualBytes: largos distintos → false (incluye prefijo que coincide)', () => {
  assert.equal(timingSafeEqualBytes(enc('abc'), enc('abcd')), false);
  assert.equal(timingSafeEqualBytes(enc('abcd'), enc('abc')), false);
});

test('timingSafeEqualBytes: ambos vacíos → true; uno vacío → false', () => {
  assert.equal(timingSafeEqualBytes(enc(''), enc('')), true);
  assert.equal(timingSafeEqualBytes(enc(''), enc('x')), false);
  assert.equal(timingSafeEqualBytes(enc('x'), enc('')), false);
});

test('timingSafeEqualBytes: case-sensitive y byte-exacto (unicode)', () => {
  assert.equal(timingSafeEqualBytes(enc('Secret'), enc('secret')), false);
  assert.equal(timingSafeEqualBytes(enc('ñoño'), enc('ñoño')), true);
});

// ── proxySecretMatches [M-1]: fail-closed ante env ausente, exige header, match byte-exacto ──────────────

test('[M-1] fail-closed: env secret ausente/vacío → false AUNQUE el header venga poblado', () => {
  assert.equal(proxySecretMatches('cualquier-cosa', undefined), false);
  assert.equal(proxySecretMatches('cualquier-cosa', null), false);
  assert.equal(proxySecretMatches('cualquier-cosa', ''), false);
});

test('[M-1] header ausente/vacío → false (aunque el env esté seteado)', () => {
  assert.equal(proxySecretMatches(null, 'the-secret'), false);
  assert.equal(proxySecretMatches(undefined, 'the-secret'), false);
  assert.equal(proxySecretMatches('', 'the-secret'), false);
});

test('[M-1] header == env secret (byte-exacto) → true', () => {
  assert.equal(proxySecretMatches('R4nd0m-Str0ng-T0k3n', 'R4nd0m-Str0ng-T0k3n'), true);
});

test('[M-1] mismatch → false (case-sensitive, sin trim implícito)', () => {
  assert.equal(proxySecretMatches('the-secret', 'the-Secret'), false);
  assert.equal(proxySecretMatches('the-secret ', 'the-secret'), false); // espacio al final NO se ignora
  assert.equal(proxySecretMatches('the-secret-x', 'the-secret'), false);
});
