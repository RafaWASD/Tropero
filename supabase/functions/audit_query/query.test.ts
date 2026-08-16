// query.test.ts — falsifica los helpers PUROS de la EF `audit_query` (spec 24). node:test, sin Deno.
//
// Ejerce las MISMAS funciones que corren en producción (importadas de ./query.ts, no un espejo): el gate
// de staff (fail-closed) y la validación autoritativa de filtros — la frontera que impide que un valor
// malformado o inyectivo llegue a la query. El armado del SQL vive en db.ts (tagged-templates de
// Postgres.js, no testeable sin Deno-runtime); su garantía "sin concat/unsafe" es estática (grep). Lo que
// SÍ es falsificable acá: que `validateFilters` RECHACE lo malformado y produzca SOLO escalares validados.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampLimit,
  OP_ALLOWLIST,
  parseStaffAllowlist,
  TABLE_ALLOWLIST,
  TABLE_LABELS,
  validateFilters,
} from './query.ts';

const UUID_A = '11111111-2222-4333-8444-555555555555';
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// ── parseStaffAllowlist: FAIL-CLOSED (R1.4 / R1.7) ───────────────────────────────────────────────────

test('R1.7: secret ausente (undefined) → allowlist vacía (nadie es staff)', () => {
  assert.equal(parseStaffAllowlist(undefined).size, 0);
  assert.equal(parseStaffAllowlist(null).size, 0);
});

test('R1.7: secret vacío / solo espacios → allowlist vacía', () => {
  assert.equal(parseStaffAllowlist('').size, 0);
  assert.equal(parseStaffAllowlist('   ').size, 0);
  assert.equal(parseStaffAllowlist(',,, , ,').size, 0);
});

test('R1.7: secret con basura (no-uuid) → allowlist vacía (la basura NO ensancha el acceso)', () => {
  assert.equal(parseStaffAllowlist('foo,bar,not-a-uuid').size, 0);
  // Falsifica un parser laxo: un token "casi-uuid" (largo mal) no debe entrar.
  assert.equal(parseStaffAllowlist('11111111-2222-4333-8444-55555555').size, 0);
});

test('R1.4: uuids válidos (mixed case + espacios) → set normalizado a lowercase', () => {
  const set = parseStaffAllowlist(`  ${UUID_A.toUpperCase()} , ${UUID_B}  `);
  assert.equal(set.size, 2);
  assert.ok(set.has(UUID_A.toLowerCase()));
  assert.ok(set.has(UUID_B));
  // Falsifica el gate: el uuid en MAYÚSCULAS del JWT matchea porque comparamos lowercase.
  assert.ok(set.has(UUID_A.toUpperCase().toLowerCase()));
});

test('R1.4: mezcla válido + basura → solo entran los uuids válidos', () => {
  const set = parseStaffAllowlist(`${UUID_A},garbage,${UUID_B},,`);
  assert.equal(set.size, 2);
  assert.ok(set.has(UUID_A));
  assert.ok(set.has(UUID_B));
  assert.equal(set.has('garbage'), false);
});

// ── clampLimit: cap duro (R3.2) ──────────────────────────────────────────────────────────────────────

test('R3.2: limit ausente/no-parseable → default 50', () => {
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit(null), 50);
  assert.equal(clampLimit('abc'), 50);
  assert.equal(clampLimit({}), 50);
  assert.equal(clampLimit(NaN), 50);
});

test('R3.2: limit > 100 se recorta a 100', () => {
  assert.equal(clampLimit(101), 100);
  assert.equal(clampLimit(100000), 100);
  assert.equal(clampLimit('500'), 100);
});

test('R3.2: limit ≤0 o no-entero → default 50', () => {
  assert.equal(clampLimit(0), 50);
  assert.equal(clampLimit(-5), 50);
  assert.equal(clampLimit('-5'), 50);
  assert.equal(clampLimit(3.7), 50);
});

test('R3.2: limit válido dentro del rango se respeta', () => {
  assert.equal(clampLimit(25), 25);
  assert.equal(clampLimit(1), 1);
  assert.equal(clampLimit(100), 100);
  assert.equal(clampLimit('30'), 30);
});

// ── validateFilters: rechazo autoritativo + forma de los `Filtros` (R2.x) ────────────────────────────

const FILTRO_KEYS = [
  'from',
  'to',
  'auth_uid',
  'establishment_id',
  'request_id',
  'table_name',
  'op',
  'before',
  'limit',
].sort();

test('body vacío → ok, todos los filtros null + limit default (sin filtrar por ausentes, R2.8)', () => {
  const r = validateFilters({});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.filtros).sort(), FILTRO_KEYS);
  assert.equal(r.filtros.from, null);
  assert.equal(r.filtros.auth_uid, null);
  assert.equal(r.filtros.table_name, null);
  assert.equal(r.filtros.op, null);
  assert.equal(r.filtros.before, null);
  assert.equal(r.filtros.limit, 50);
});

test('body no-objeto (null / string) → ok con defaults (no rompe)', () => {
  for (const b of [null, undefined, 'x', 42]) {
    const r = validateFilters(b);
    assert.equal(r.ok, true, `body=${JSON.stringify(b)}`);
  }
});

test('R2.3–R2.5: uuid inválido en cualquier campo uuid → 400', () => {
  for (const f of ['auth_uid', 'establishment_id', 'request_id']) {
    const r = validateFilters({ [f]: 'not-a-uuid' });
    assert.equal(r.ok, false, `campo ${f} debería rechazar basura`);
  }
});

test('R2.3–R2.5: uuid tipo no-string (number) → 400', () => {
  const r = validateFilters({ auth_uid: 12345 });
  assert.equal(r.ok, false);
});

test('R2.3: uuid válido en mayúsculas → aceptado y normalizado a lowercase', () => {
  const r = validateFilters({ auth_uid: UUID_A.toUpperCase() });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.filtros.auth_uid, UUID_A.toLowerCase());
});

test('R2.4: establishment_id inyectivo (no-uuid) → 400 (no se pasa crudo a la query)', () => {
  // Falsifica que un intento de inyección en un campo NO llega jamás a filtros.
  const r = validateFilters({ establishment_id: "'; drop table audit.record_version; --" });
  assert.equal(r.ok, false);
});

test('R2.2 / §8 LOW-2: from/to no-string (number) → 400 antes del new Date', () => {
  assert.equal(validateFilters({ from: 20260101 }).ok, false);
  assert.equal(validateFilters({ to: { x: 1 } }).ok, false);
});

test('R2.2: from/to fecha no parseable → 400', () => {
  assert.equal(validateFilters({ from: 'ayer' }).ok, false);
  assert.equal(validateFilters({ to: '2026-13-45' }).ok, false);
});

test('R2.2: from/to ISO válido → normalizado a ISO canónico', () => {
  const r = validateFilters({ from: '2026-08-01T00:00:00Z', to: '2026-08-16T23:59:59Z' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.filtros.from, new Date('2026-08-01T00:00:00Z').toISOString());
  assert.equal(r.filtros.to, new Date('2026-08-16T23:59:59Z').toISOString());
});

test('R2.6: table_name fuera de la allowlist → 400', () => {
  assert.equal(validateFilters({ table_name: 'users' }).ok, false);
  assert.equal(validateFilters({ table_name: 'user_private' }).ok, false);
  assert.equal(validateFilters({ table_name: 'user_roles; --' }).ok, false);
});

test('R2.6: table_name en la allowlist → aceptado', () => {
  const r = validateFilters({ table_name: 'user_roles' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.filtros.table_name, 'user_roles');
});

test('R2.7: op fuera de INSERT|UPDATE|DELETE → 400 (case-sensitive)', () => {
  assert.equal(validateFilters({ op: 'SELECT' }).ok, false);
  assert.equal(validateFilters({ op: 'update' }).ok, false); // minúsculas no matchean el enum
  assert.equal(validateFilters({ op: 'UPDATE; DROP' }).ok, false);
  assert.equal(validateFilters({ op: 'TRUNCATE' }).ok, false); // existe en el enum pero no se ofrece
});

test('R2.7: op válido → aceptado', () => {
  for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
    const r = validateFilters({ op });
    assert.equal(r.ok, true, op);
    if (r.ok) assert.equal(r.filtros.op, op);
  }
});

test('R3.3: before no-dígitos → 400 (cursor inyectivo rebota)', () => {
  assert.equal(validateFilters({ before: '1 OR 1=1' }).ok, false);
  assert.equal(validateFilters({ before: 'abc' }).ok, false);
  assert.equal(validateFilters({ before: -1 }).ok, false); // number → rechazado (se exige string)
  assert.equal(validateFilters({ before: '12; drop' }).ok, false);
});

test('R3.3: before string de dígitos → aceptado como string', () => {
  const r = validateFilters({ before: '  99999999999999999  ' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.filtros.before, '99999999999999999');
});

test('R2.8: claves desconocidas del body NO llegan a filtros (solo se leen los campos previstos)', () => {
  const r = validateFilters({ evil: "'; drop", extra: 1, __proto__: { polluted: true }, limit: 10 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.filtros).sort(), FILTRO_KEYS);
  assert.equal((r.filtros as Record<string, unknown>).evil, undefined);
  assert.equal((r.filtros as Record<string, unknown>).extra, undefined);
  assert.equal(r.filtros.limit, 10);
});

test('forma de filtros: body completo válido → SOLO escalares validados (lo que db.ts liga)', () => {
  const r = validateFilters({
    from: '2026-08-01T00:00:00Z',
    to: '2026-08-16T00:00:00Z',
    auth_uid: UUID_A,
    establishment_id: UUID_B,
    request_id: UUID_A,
    table_name: 'user_roles',
    op: 'UPDATE',
    before: '500',
    limit: 25,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const f = r.filtros;
  assert.equal(f.auth_uid, UUID_A);
  assert.equal(f.establishment_id, UUID_B);
  assert.equal(f.request_id, UUID_A);
  assert.equal(f.table_name, 'user_roles');
  assert.equal(f.op, 'UPDATE');
  assert.equal(f.before, '500');
  assert.equal(f.limit, 25);
  // Cada valor es un escalar primitivo (string/number/null) — nada de objetos/fragmentos crudos.
  for (const [k, v] of Object.entries(f)) {
    assert.ok(
      v === null || typeof v === 'string' || typeof v === 'number',
      `filtros.${k} debe ser escalar, es ${typeof v}`,
    );
  }
});

test('un solo filtro malformado invalida TODO el request (no se cuela parcial)', () => {
  const r = validateFilters({ auth_uid: UUID_A, op: 'HACK' });
  assert.equal(r.ok, false);
});

// ── allowlists + labels (constantes de negocio) ──────────────────────────────────────────────────────

test('R5.3: TABLE_LABELS mapea user_roles a es-AR', () => {
  assert.equal(TABLE_LABELS['user_roles'], 'Roles de miembro');
});

test('allowlists cerradas: solo user_roles y solo INSERT/UPDATE/DELETE', () => {
  assert.deepEqual([...TABLE_ALLOWLIST].sort(), ['user_roles']);
  assert.deepEqual([...OP_ALLOWLIST].sort(), ['DELETE', 'INSERT', 'UPDATE']);
});
