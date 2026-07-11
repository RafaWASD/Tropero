// Tests de la lógica PURA de la baja / egreso de animal (spec 02 C3.3, R4.14 / R14.9).
// node:test + type-stripping nativo, sin Jest. La lógica pura vive en services/exit-animal.ts (sin
// imports de RN/expo/supabase); el servicio I/O (animals.ts::exitAnimalProfile) importa `./supabase`
// → expo-secure-store y NO carga bajo node:test, así que testeamos el módulo puro (mismo patrón que
// establishment-store.test.ts ↔ utils/establishment).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  exitReasonToStatus,
  classifyExitError,
  validateExitWeight,
  validateExitPrice,
  sanitizePriceInput,
  archivedBadgeLabel,
  EXIT_REASON_MAPPINGS,
  EXIT_ERROR_COPY,
  BATCH_EXIT_MAPPINGS,
  batchExitReasonToStatus,
  isBatchExitChoice,
  resolveEffectiveSaleData,
  type ExitReasonChoice,
} from './exit-animal.ts';

// ─── Mapeo motivo → (status, exit_reason) ─────────────────────────────────────────────

test('R14.9: Venta → (sold, sale) + captura datos de venta', () => {
  const m = exitReasonToStatus('sale');
  assert.ok(m);
  assert.equal(m.status, 'sold');
  assert.equal(m.exitReason, 'sale');
  assert.equal(m.label, 'Venta');
  assert.equal(m.capturesSaleData, true);
});

test('R14.9: Muerte → (dead, death) sin datos de venta', () => {
  const m = exitReasonToStatus('death');
  assert.ok(m);
  assert.equal(m.status, 'dead');
  assert.equal(m.exitReason, 'death');
  assert.equal(m.label, 'Muerte');
  assert.equal(m.capturesSaleData, false);
});

test('R14.9: Transferencia → (transferred, transfer) sin datos de venta', () => {
  const m = exitReasonToStatus('transfer');
  assert.ok(m);
  assert.equal(m.status, 'transferred');
  assert.equal(m.exitReason, 'transfer');
  assert.equal(m.label, 'Transferencia');
  assert.equal(m.capturesSaleData, false);
});

test('MVP expone EXACTAMENTE los 3 motivos (no los 6 del enum DB)', () => {
  assert.equal(EXIT_REASON_MAPPINGS.length, 3);
  const choices = EXIT_REASON_MAPPINGS.map((m) => m.choice).sort();
  assert.deepEqual(choices, ['death', 'sale', 'transfer']);
  // culling/theft/other NO se exponen en MVP (D1 del context — diferidos a validar con Facundo).
  for (const m of EXIT_REASON_MAPPINGS) {
    assert.ok(!['culling', 'theft', 'other'].includes(m.choice));
  }
});

test('SOLO Venta captura peso + precio (D2): los otros 2 no', () => {
  const withSaleData = EXIT_REASON_MAPPINGS.filter((m) => m.capturesSaleData);
  assert.equal(withSaleData.length, 1);
  assert.equal(withSaleData[0].choice, 'sale');
});

test('exitReasonToStatus es ESTABLE 1:1 (status nunca active, exitReason==choice)', () => {
  for (const m of EXIT_REASON_MAPPINGS) {
    const resolved = exitReasonToStatus(m.choice);
    assert.deepEqual(resolved, m);
    assert.notEqual(m.status, 'active'); // el RPC rechaza 'active' (23514)
    assert.equal(m.exitReason, m.choice); // mapeo 1:1 en MVP
  }
});

test('exitReasonToStatus con un motivo fuera del MVP → null (defensivo)', () => {
  // La UI nunca pasa esto, pero el contrato es fail-safe.
  const bogus = 'culling' as unknown as ExitReasonChoice;
  assert.equal(exitReasonToStatus(bogus), null);
});

// ─── Clasificación de errores del RPC exit_animal_profile (0044) ──────────────────────

test('42501 (no autorizado) → unknown con copy accionable, NO el message crudo', () => {
  const e = classifyExitError({ code: '42501', message: 'not authorized to exit this animal' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, EXIT_ERROR_COPY.unauthorized);
  // NUNCA se expone el sqlerrm/message crudo de Postgres.
  assert.ok(!/not authorized to exit/i.test(e.message));
});

test('23503 (animal no disponible) → unknown con copy "ya no está disponible"', () => {
  const e = classifyExitError({ code: '23503', message: 'animal_profile not found' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, EXIT_ERROR_COPY.gone);
  assert.ok(!/not found/i.test(e.message));
});

test('23514 (status active por error) → unknown con copy genérico', () => {
  const e = classifyExitError({ code: '23514', message: 'exit status must be sold/dead/transferred' });
  assert.equal(e.kind, 'unknown');
  assert.equal(e.message, EXIT_ERROR_COPY.invalidStatus);
});

test('error de red (por el MENSAJE, supabase-js no setea code) → kind network', () => {
  for (const msg of ['Failed to fetch', 'network error', 'TypeError: fetch failed', 'NetworkError']) {
    const e = classifyExitError({ message: msg });
    assert.equal(e.kind, 'network', `"${msg}" debería clasificar como network`);
    assert.equal(e.message, EXIT_ERROR_COPY.network);
  }
});

test('red tiene PRECEDENCIA sobre un code presente (un fetch que falla puede traer code basura)', () => {
  const e = classifyExitError({ code: '42501', message: 'Failed to fetch' });
  assert.equal(e.kind, 'network');
});

test('error desconocido (code raro / null / vacío) → unknown con copy genérico, nunca crudo', () => {
  for (const input of [
    { code: '99999', message: 'algo raro de postgres' },
    { code: '', message: '' },
    null,
  ]) {
    const e = classifyExitError(input);
    assert.equal(e.kind, 'unknown');
    assert.equal(e.message, EXIT_ERROR_COPY.unknown);
  }
  // El message crudo de Postgres NO se filtra al copy.
  const crudo = classifyExitError({ code: '99999', message: 'algo raro de postgres' });
  assert.ok(!/algo raro/i.test(crudo.message));
});

// ─── Validación OPCIONAL de peso/precio de venta (D2) ──────────────────────────────────

test('peso de salida VACÍO → ok con value null (opcional, no se manda)', () => {
  for (const raw of ['', '   ']) {
    const r = validateExitWeight(raw);
    assert.ok(r.ok);
    assert.equal(r.value, null);
  }
});

test('peso de salida válido → ok con el número (acepta coma es-AR)', () => {
  assert.deepEqual(validateExitWeight('320'), { ok: true, value: 320 });
  assert.deepEqual(validateExitWeight('320,5'), { ok: true, value: 320.5 });
});

test('peso de salida inválido (0, negativo no parseable, >= 10000) → error, no procede', () => {
  assert.equal(validateExitWeight('0').ok, false);
  assert.equal(validateExitWeight('abc').ok, false);
  assert.equal(validateExitWeight('10000').ok, false);
});

test('precio de salida VACÍO → ok con value null (opcional)', () => {
  const r = validateExitPrice('');
  assert.ok(r.ok);
  assert.equal(r.value, null);
});

test('precio de salida válido → ok con el número (coma es-AR)', () => {
  assert.deepEqual(validateExitPrice('1500'), { ok: true, value: 1500 });
  assert.deepEqual(validateExitPrice('1500,75'), { ok: true, value: 1500.75 });
});

test('precio de salida inválido (0, no número, gigante) → error', () => {
  assert.equal(validateExitPrice('0').ok, false);
  assert.equal(validateExitPrice('xx').ok, false);
  assert.equal(validateExitPrice('1000000000').ok, false);
});

test('sanitizePriceInput NO acota la parte entera a 4 díg (un animal se vende por 6-7 cifras)', () => {
  // El bug que esto previene: usar sanitizeWeightInput (cap 4 díg enteros) truncaría 250000 → 2500.
  assert.equal(sanitizePriceInput('250000'), '250000');
  assert.equal(sanitizePriceInput('1500000'), '1500000');
});

test('sanitizePriceInput descarta letras, acepta 1 separador es-AR y acota el largo total', () => {
  assert.equal(sanitizePriceInput('abc1200'), '1200');
  assert.equal(sanitizePriceInput('1500,75'), '1500,75');
  assert.equal(sanitizePriceInput('1,2,3'), '1,23'); // un solo separador
  // Largo total acotado (no se puede tipear basura sin fin).
  assert.ok(sanitizePriceInput('99999999999999999999').length <= 13);
});

// ─── Badge de modo archivada ───────────────────────────────────────────────────────────

test('badge: sold con fecha → "Vendido el {dd/mm/aaaa}" (es-AR, NO ISO crudo)', () => {
  // exit_date es columna `date` → formatDateEsAr string-puro, sin drift (07/06/2026, no 2026-06-07).
  assert.equal(archivedBadgeLabel('sold', '2026-06-07'), 'Vendido el 07/06/2026');
});

test('badge: dead/transferred con fecha → verbo correcto + fecha dd/mm/aaaa', () => {
  assert.equal(archivedBadgeLabel('dead', '2026-06-01'), 'Muerto el 01/06/2026');
  assert.equal(archivedBadgeLabel('transferred', '2026-05-20'), 'Transferido el 20/05/2026');
});

test('badge: archivado SIN fecha (datos viejos) → solo el verbo, NUNCA "null"', () => {
  assert.equal(archivedBadgeLabel('sold', null), 'Vendido');
  assert.equal(archivedBadgeLabel('dead', ''), 'Muerto');
  assert.equal(archivedBadgeLabel('transferred', '   '), 'Transferido');
  // El edge case del brief: badge con fecha null no debe renderizar "el null".
  assert.ok(!/null/i.test(archivedBadgeLabel('sold', null) as string));
});

test('badge: status active → null (la ficha NO muestra badge para un animal vivo)', () => {
  assert.equal(archivedBadgeLabel('active', '2026-06-07'), null);
  assert.equal(archivedBadgeLabel('active', null), null);
});

// ─── delta lotes-venta: BATCH_EXIT_MAPPINGS (RLV.4/RLV.4.1/RLV.4.2) ─────────────────────

test('RLV.4.1: la tanda ofrece EXACTAMENTE Venta + Muerte (subconjunto, no los 3 de la ficha)', () => {
  assert.equal(BATCH_EXIT_MAPPINGS.length, 2);
  const choices = BATCH_EXIT_MAPPINGS.map((m) => m.choice).sort();
  assert.deepEqual(choices, ['death', 'sale']);
});

test('RLV.4.1: Venta→(sold,sale)+captura datos; Muerte→(dead,death) sin datos', () => {
  const venta = BATCH_EXIT_MAPPINGS.find((m) => m.choice === 'sale');
  const muerte = BATCH_EXIT_MAPPINGS.find((m) => m.choice === 'death');
  assert.ok(venta && muerte);
  assert.deepEqual([venta.status, venta.exitReason, venta.capturesSaleData], ['sold', 'sale', true]);
  assert.deepEqual([muerte.status, muerte.exitReason, muerte.capturesSaleData], ['dead', 'death', false]);
});

test('RLV.4.2: la tanda NUNCA expone culling/transfer/theft/other (Venta simple, Puerta 1)', () => {
  for (const forbidden of ['culling', 'transfer', 'theft', 'other']) {
    assert.ok(!BATCH_EXIT_MAPPINGS.some((m) => m.choice === forbidden), `${forbidden} no va en la tanda`);
    assert.equal(batchExitReasonToStatus(forbidden), null, `${forbidden} → mapping null`);
    assert.equal(isBatchExitChoice(forbidden), false, `${forbidden} no es batch choice`);
  }
  // La transferencia SÍ sigue en la ficha per-animal (EXIT_REASON_MAPPINGS), NO en la tanda.
  assert.ok(EXIT_REASON_MAPPINGS.some((m) => m.choice === 'transfer'));
});

test('RLV.4.1: BATCH es un SUBCONJUNTO FIEL de EXIT_REASON_MAPPINGS (mismo status/label, sin duplicar)', () => {
  for (const m of BATCH_EXIT_MAPPINGS) {
    const src = exitReasonToStatus(m.choice);
    assert.deepEqual(src, m, `${m.choice} debe ser la MISMA entrada que en la ficha`);
  }
});

test('isBatchExitChoice / batchExitReasonToStatus resuelven Venta y Muerte', () => {
  assert.equal(isBatchExitChoice('sale'), true);
  assert.equal(isBatchExitChoice('death'), true);
  assert.equal(batchExitReasonToStatus('sale')?.status, 'sold');
  assert.equal(batchExitReasonToStatus('death')?.status, 'dead');
});

// ─── delta lotes-venta: resolveEffectiveSaleData (RLV.5.2/RLV.6) ────────────────────────

test('RLV.5.2: sin override, el animal usa el precio/peso COMÚN de la tanda', () => {
  const r = resolveEffectiveSaleData({ commonPrice: 250000, commonWeight: 380, overridePrice: null, overrideWeight: null });
  assert.deepEqual(r, { price: 250000, weight: 380 });
});

test('RLV.5.2: override undefined (el operario no tocó el animal) → cae al común', () => {
  const r = resolveEffectiveSaleData({ commonPrice: 250000, commonWeight: 380 });
  assert.deepEqual(r, { price: 250000, weight: 380 });
});

test('RLV.6: el override GANA sobre el común (precio y peso, independientes)', () => {
  const r = resolveEffectiveSaleData({ commonPrice: 250000, commonWeight: 380, overridePrice: 300000, overrideWeight: 410 });
  assert.deepEqual(r, { price: 300000, weight: 410 });
  // Solo uno de los dos con override → el otro sigue el común.
  const soloPrecio = resolveEffectiveSaleData({ commonPrice: 250000, commonWeight: 380, overridePrice: 300000 });
  assert.deepEqual(soloPrecio, { price: 300000, weight: 380 });
});

test('RLV.5.2/RLV.6: común null + sin override → null (no se manda); override 0 no aplica (validado aparte)', () => {
  // Ambos null → efectivo null (el RPC coalesce: null no pisa nada).
  assert.deepEqual(resolveEffectiveSaleData({ commonPrice: null, commonWeight: null }), { price: null, weight: null });
  // Override presente PISA un común null.
  assert.deepEqual(
    resolveEffectiveSaleData({ commonPrice: null, commonWeight: null, overridePrice: 100000, overrideWeight: 350 }),
    { price: 100000, weight: 350 },
  );
});
