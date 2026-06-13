// Tests de la lógica PURA de la transferencia de animal entre campos (spec 11, Fase 3 / T3.1-T3.3).
// node:test + type-stripping nativo, sin Jest. La lógica pura vive en services/transfer-animal.ts (sin
// imports de RN/expo/supabase); el servicio I/O (animals.ts::transferAnimal) importa `./supabase` →
// expo-secure-store y NO carga bajo node:test, así que testeamos el módulo puro (mismo patrón que
// exit-animal.test.ts ↔ services/exit-animal).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTransferError,
  mapTransferResult,
  TRANSFER_ERROR_COPY,
  TRANSFER_OFFLINE_MESSAGE,
  type TransferAnimalRpcRow,
} from './transfer-animal.ts';

// ─── mapTransferResult: jsonb del RPC → resultado de dominio (R6.1 replay, R2.5 idv_dropped) ──

test('mapTransferResult: mapea el jsonb del RPC a camelCase', () => {
  const row: TransferAnimalRpcRow = {
    target_profile_id: 'tgt-1',
    idv_dropped: false,
    source_profile_id: 'src-1',
    replay: false,
  };
  const r = mapTransferResult(row, 'fallback');
  assert.equal(r.targetProfileId, 'tgt-1');
  assert.equal(r.idvDropped, false);
  assert.equal(r.sourceProfileId, 'src-1');
  assert.equal(r.replay, false);
});

test('mapTransferResult: idv_dropped=true se propaga (R2.5 — avisar al operario)', () => {
  const row: TransferAnimalRpcRow = {
    target_profile_id: 'tgt-2',
    idv_dropped: true,
    source_profile_id: 'src-2',
    replay: false,
  };
  const r = mapTransferResult(row, 'fallback');
  assert.equal(r.idvDropped, true);
});

test('mapTransferResult: replay=true se propaga (R6.1 — idempotencia)', () => {
  const row: TransferAnimalRpcRow = {
    target_profile_id: 'tgt-3',
    idv_dropped: false,
    source_profile_id: 'src-3',
    replay: true,
  };
  const r = mapTransferResult(row, 'fallback');
  assert.equal(r.replay, true);
});

test('mapTransferResult: row null → usa el fallback targetProfileId y defaults seguros', () => {
  const r = mapTransferResult(null, 'fallback-id');
  assert.equal(r.targetProfileId, 'fallback-id');
  assert.equal(r.idvDropped, false, 'idv_dropped ausente → false (no asume drop)');
  assert.equal(r.replay, false, 'replay ausente → false');
});

test('mapTransferResult: shape inesperado (sin replay/idv_dropped) → defaults false', () => {
  // Simula una versión vieja del RPC o un shape parcial: solo target/source.
  const partial = { target_profile_id: 'tgt-4', source_profile_id: 'src-4' } as TransferAnimalRpcRow;
  const r = mapTransferResult(partial, 'fb');
  assert.equal(r.targetProfileId, 'tgt-4');
  assert.equal(r.idvDropped, false);
  assert.equal(r.replay, false);
});

// ─── classifyTransferError: errcode del RPC → AppError accionable (sin leak de sqlerrm) ──

test('classifyTransferError: 42501 → no autorizado (R5.2), copy accionable sin sqlerrm', () => {
  const e = classifyTransferError({ code: '42501', message: 'not authorized to remove the animal from the source field' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, TRANSFER_ERROR_COPY.unauthorized);
  assert.doesNotMatch(e.message, /source field|errcode|42501/i, 'NO expone el sqlerrm crudo');
});

test('classifyTransferError: 23514 → rodeo destino inválido (R1.6/R2.2)', () => {
  const e = classifyTransferError({ code: '23514', message: 'target rodeo belongs to a different productive system' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, TRANSFER_ERROR_COPY.invalidTarget);
});

test('classifyTransferError: 23503 → origen no disponible / ya transferido (R5.6)', () => {
  const e = classifyTransferError({ code: '23503', message: 'source profile not found, not active, or already transferred' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, TRANSFER_ERROR_COPY.gone);
});

test('classifyTransferError: 23505 → carrera / ya no disponible (R6.3)', () => {
  const e = classifyTransferError({ code: '23505', message: 'duplicate key value' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, TRANSFER_ERROR_COPY.conflict);
});

test('classifyTransferError: red (sin code, por mensaje) → kind network (R7.1)', () => {
  for (const msg of ['Network request failed', 'Failed to fetch', 'fetch failed', 'NetworkError when attempting']) {
    const e = classifyTransferError({ message: msg });
    assert.equal(e.kind, 'network', `"${msg}" debe clasificarse como network`);
    assert.equal(e.message, TRANSFER_ERROR_COPY.network);
  }
});

test('classifyTransferError: red gana sobre el code (un fetch fallido no trae code de Postgres)', () => {
  const e = classifyTransferError({ message: 'Network request failed', code: '' });
  assert.equal(e.kind, 'network');
});

test('classifyTransferError: code desconocido → unknown genérico (nunca el message crudo)', () => {
  const e = classifyTransferError({ code: 'XX999', message: 'internal weird postgres detail' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, TRANSFER_ERROR_COPY.unknown);
  assert.doesNotMatch(e.message, /weird postgres/i);
});

test('classifyTransferError: error null → unknown genérico', () => {
  const e = classifyTransferError(null);
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, TRANSFER_ERROR_COPY.unknown);
});

test('TRANSFER_OFFLINE_MESSAGE: copy accionable para el fast-fail online-only (R7.1)', () => {
  assert.equal(TRANSFER_OFFLINE_MESSAGE, TRANSFER_ERROR_COPY.network);
  assert.match(TRANSFER_OFFLINE_MESSAGE, /conexión|internet/i);
});
