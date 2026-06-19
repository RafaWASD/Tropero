// Tests de la lógica PURA del WHEEL PICKER (spec 03 M6 — CE, R14.5/R14.6/R14.7). node:test.
// Foco: rango/paso → conteo y valores; snap+clamp; offset↔índice↔valor; formato es-AR (coma); edad
// prellenada desde birth_date (DM6-6, reusa monthsBetween) + default cuando es desconocida.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AGE_DEFAULT_MONTHS,
  AGE_MAX_MONTHS,
  AGE_MIN_MONTHS,
  AGE_WHEEL,
  CE_DEFAULT_CM,
  CE_MAX_CM,
  CE_MIN_CM,
  CE_STEP_CM,
  CE_WHEEL,
  formatAgeLabel,
  formatCmAR,
  formatCmWithUnitAR,
  formatMonthsAR,
  formatMonthsNum,
  indexToOffset,
  indexToValue,
  initialAgeIndex,
  isOffsetSnapped,
  offsetToIndex,
  parseCmInput,
  prefillAgeMonths,
  snapOffset,
  snapToWheel,
  valueToIndex,
  wheelCount,
  wheelValues,
} from './wheel-picker';

// ─── Parámetros (R14.5: CE 20–50/0,5, default 36; edad 6–120/1, default 24) ────────────────────────

test('R14.5: la rueda de CE es 20–50 con paso 0,5 y default 36', () => {
  assert.equal(CE_MIN_CM, 20);
  assert.equal(CE_MAX_CM, 50);
  assert.equal(CE_STEP_CM, 0.5);
  assert.equal(CE_DEFAULT_CM, 36);
});

test('R14.5: la rueda de CE tiene 61 valores (20,0; 20,5; …; 50,0)', () => {
  assert.equal(wheelCount(CE_WHEEL), 61);
  const vals = wheelValues(CE_WHEEL);
  assert.equal(vals.length, 61);
  assert.equal(vals[0], 20);
  assert.equal(vals[1], 20.5);
  assert.equal(vals[vals.length - 1], 50);
  // Sin drift de coma flotante en ningún paso.
  for (const v of vals) assert.equal(v, Math.round(v * 2) / 2);
});

test('R14.7: la rueda de meses es 6–120 con paso 1 (115 valores) y default 24', () => {
  assert.equal(AGE_MIN_MONTHS, 6);
  assert.equal(AGE_MAX_MONTHS, 120);
  assert.equal(AGE_DEFAULT_MONTHS, 24);
  assert.equal(wheelCount(AGE_WHEEL), 115);
});

// ─── snapToWheel: clamp + snap a celda ─────────────────────────────────────────────────────────────

test('snapToWheel: un valor ya en grilla queda igual', () => {
  assert.equal(snapToWheel(36, CE_WHEEL), 36);
  assert.equal(snapToWheel(36.5, CE_WHEEL), 36.5);
  assert.equal(snapToWheel(20, CE_WHEEL), 20);
  assert.equal(snapToWheel(50, CE_WHEEL), 50);
});

test('snapToWheel: clampa fuera de rango (CE)', () => {
  assert.equal(snapToWheel(10, CE_WHEEL), 20);
  assert.equal(snapToWheel(0, CE_WHEEL), 20);
  assert.equal(snapToWheel(99, CE_WHEEL), 50);
  assert.equal(snapToWheel(-5, CE_WHEEL), 20);
});

test('snapToWheel: snapea entre celdas a la más cercana', () => {
  assert.equal(snapToWheel(36.24, CE_WHEEL), 36); // más cerca de 36 que de 36,5
  assert.equal(snapToWheel(36.26, CE_WHEEL), 36.5);
  assert.equal(snapToWheel(36.75, CE_WHEEL), 37); // empate hacia arriba (Math.round)
});

test('snapToWheel: NaN/∞ → min (fail-safe)', () => {
  assert.equal(snapToWheel(NaN, CE_WHEEL), 20);
  assert.equal(snapToWheel(Infinity, CE_WHEEL), 20);
  assert.equal(snapToWheel(-Infinity, AGE_WHEEL), 6);
});

// ─── índice ↔ valor ↔ offset ───────────────────────────────────────────────────────────────────────

test('valueToIndex / indexToValue son inversas y clampean', () => {
  assert.equal(valueToIndex(20, CE_WHEEL), 0);
  assert.equal(valueToIndex(50, CE_WHEEL), 60);
  assert.equal(valueToIndex(36, CE_WHEEL), 32); // (36-20)/0,5 = 32
  assert.equal(indexToValue(0, CE_WHEEL), 20);
  assert.equal(indexToValue(60, CE_WHEEL), 50);
  assert.equal(indexToValue(32, CE_WHEEL), 36);
  // Fuera de rango se clampa.
  assert.equal(valueToIndex(999, CE_WHEEL), 60);
  assert.equal(indexToValue(999, CE_WHEEL), 50);
  assert.equal(indexToValue(-5, CE_WHEEL), 20);
});

test('offsetToIndex: el centro de la celda más cercano a la línea de selección', () => {
  const CELL = 64;
  assert.equal(offsetToIndex(0, CELL, CE_WHEEL), 0);
  assert.equal(offsetToIndex(CELL, CELL, CE_WHEEL), 1);
  assert.equal(offsetToIndex(CELL * 32, CELL, CE_WHEEL), 32); // 36 cm
  // Offset entre celdas → la más cercana.
  assert.equal(offsetToIndex(CELL * 1.4, CELL, CE_WHEEL), 1);
  assert.equal(offsetToIndex(CELL * 1.6, CELL, CE_WHEEL), 2);
  // Clamp: offset gigante no sale del rango.
  assert.equal(offsetToIndex(CELL * 999, CELL, CE_WHEEL), 60);
  // cellHeight inválido → 0 (defensivo).
  assert.equal(offsetToIndex(100, 0, CE_WHEEL), 0);
});

test('indexToOffset: inversa de offsetToIndex (round-trip)', () => {
  const CELL = 64;
  for (const idx of [0, 1, 32, 60]) {
    assert.equal(offsetToIndex(indexToOffset(idx, CELL), CELL, CE_WHEEL), idx);
  }
});

// ─── snap determinístico del LOCK al soltar (R14.5/R14.7) ──────────────────────────────────────────

test('snapOffset: un offset a mitad de camino LOCKEA en la celda más cercana (CE)', () => {
  const CELL = 64;
  // 64*2,7 → más cerca del índice 3 que del 2 → lockea EXACTO en indexToOffset(3)=192.
  const a = snapOffset(CELL * 2.7, CELL, CE_WHEEL);
  assert.equal(a.index, 3);
  assert.equal(a.offset, 192); // múltiplo exacto de CELL (lockeado)
  assert.equal(a.value, indexToValue(3, CE_WHEEL)); // 21,5 cm
  // 64*2,4 → más cerca del índice 2 → 128.
  const b = snapOffset(CELL * 2.4, CELL, CE_WHEEL);
  assert.equal(b.index, 2);
  assert.equal(b.offset, 128);
  assert.equal(b.value, indexToValue(2, CE_WHEEL)); // 21 cm
  // Empate (x,5) → Math.round redondea hacia arriba.
  const half = snapOffset(CELL * 2.5, CELL, CE_WHEEL);
  assert.equal(half.index, 3);
  assert.equal(half.offset, 192);
});

test('snapOffset: clampa en los bordes (no lockea fuera del rango por el padding)', () => {
  const CELL = 64;
  // Offset negativo (rebote/overscroll arriba) → índice 0, offset 0, valor min.
  const lo = snapOffset(-40, CELL, CE_WHEEL);
  assert.equal(lo.index, 0);
  assert.equal(lo.offset, 0);
  assert.equal(lo.value, CE_MIN_CM); // 20
  // Offset gigante (overscroll abajo / momentum) → último índice, NO fuera del rango.
  const last = wheelCount(CE_WHEEL) - 1; // 60
  const hi = snapOffset(CELL * 999, CELL, CE_WHEEL);
  assert.equal(hi.index, last);
  assert.equal(hi.offset, last * CELL);
  assert.equal(hi.value, CE_MAX_CM); // 50
});

test('snapOffset: AGE_WHEEL lockea igual (rueda de meses, mismo idiom)', () => {
  const CELL = 64;
  // 64*5,7 → índice 6 (meses = 6+6 = 12), offset 384.
  const a = snapOffset(CELL * 5.7, CELL, AGE_WHEEL);
  assert.equal(a.index, 6);
  assert.equal(a.offset, 384);
  assert.equal(a.value, indexToValue(6, AGE_WHEEL)); // 12 meses
  // Borde superior: índice último = 114 (120 meses).
  const last = wheelCount(AGE_WHEEL) - 1;
  const hi = snapOffset(CELL * 9999, CELL, AGE_WHEEL);
  assert.equal(hi.index, last);
  assert.equal(hi.value, AGE_MAX_MONTHS); // 120
});

test('isOffsetSnapped: true SOLO cuando el offset descansa en el centro de una celda válida', () => {
  const CELL = 64;
  // Ya lockeado (múltiplo exacto dentro del rango) → no-op del lock (no relockea, no spamea).
  assert.equal(isOffsetSnapped(0, CELL, CE_WHEEL), true);
  assert.equal(isOffsetSnapped(CELL, CELL, CE_WHEEL), true);
  assert.equal(isOffsetSnapped(CELL * 32, CELL, CE_WHEEL), true);
  // Sub-píxel del scroller (dentro de eps) → cuenta como snapeado (no jitter).
  assert.equal(isOffsetSnapped(CELL * 32 + 0.3, CELL, CE_WHEEL), true);
  // A mitad de camino → NO snapeado (hay que lockear).
  assert.equal(isOffsetSnapped(CELL * 2.7, CELL, CE_WHEEL), false);
  assert.equal(isOffsetSnapped(CELL * 2.4, CELL, CE_WHEEL), false);
  // Más allá del último índice (overscroll) aunque caiga en múltiplo: su celda real está clampeada
  // adentro → NO snapeado, debe relockear hacia el rango.
  const beyond = wheelCount(CE_WHEEL) * CELL; // un múltiplo, pero fuera del último índice
  assert.equal(isOffsetSnapped(beyond, CELL, CE_WHEEL), false);
  // cellHeight inválido → false (defensivo, no rompe).
  assert.equal(isOffsetSnapped(100, 0, CE_WHEEL), false);
});

// ─── formato es-AR ─────────────────────────────────────────────────────────────────────────────────

test('formatCmAR: coma decimal, sin decimales superfluos', () => {
  assert.equal(formatCmAR(36.5), '36,5');
  assert.equal(formatCmAR(36), '36');
  assert.equal(formatCmAR(40.5), '40,5');
  assert.equal(formatCmAR(20), '20');
  // Snapea antes de formatear (un valor sucio no rompe el display).
  assert.equal(formatCmAR(36.24), '36');
});

test('formatCmWithUnitAR: agrega " cm"', () => {
  assert.equal(formatCmWithUnitAR(36.5), '36,5 cm');
  assert.equal(formatCmWithUnitAR(37), '37 cm');
});

// ─── parseCmInput: teclado manual (input híbrido, R14.5 sub-cláusula) ───────────────────────────────

test('parseCmInput: coma decimal es-AR → número de la grilla', () => {
  assert.equal(parseCmInput('36,5'), 36.5);
  assert.equal(parseCmInput('36'), 36);
  assert.equal(parseCmInput('40,5'), 40.5);
  // Tolera espacios y la unidad pegada (tipeada o pegada del display).
  assert.equal(parseCmInput(' 38 '), 38);
  assert.equal(parseCmInput('36,5 cm'), 36.5);
});

test('parseCmInput: acepta también punto decimal (no solo coma)', () => {
  assert.equal(parseCmInput('36.5'), 36.5);
  assert.equal(parseCmInput('42.0'), 42);
});

test('parseCmInput: redondea al 0,5 más cercano (misma grilla que la rueda)', () => {
  assert.equal(parseCmInput('36,2'), 36); // más cerca de 36
  assert.equal(parseCmInput('36,3'), 36.5); // más cerca de 36,5
  assert.equal(parseCmInput('36,7'), 36.5);
  assert.equal(parseCmInput('36,8'), 37);
  assert.equal(parseCmInput('41'), 41); // entero ya en grilla
});

test('parseCmInput: clampa al rango [20, 50] de la rueda', () => {
  assert.equal(parseCmInput('10'), 20); // por debajo del piso
  assert.equal(parseCmInput('0'), 20);
  assert.equal(parseCmInput('99'), 50); // por encima del techo
  assert.equal(parseCmInput('100,5'), 50);
});

test('parseCmInput: no-numérico / vacío → null (el caller revierte, no mueve la rueda)', () => {
  assert.equal(parseCmInput(''), null);
  assert.equal(parseCmInput('   '), null);
  assert.equal(parseCmInput('abc'), null);
  assert.equal(parseCmInput('cm'), null);
  assert.equal(parseCmInput(','), null);
  assert.equal(parseCmInput('.'), null);
  assert.equal(parseCmInput('-'), null);
  // @ts-expect-error — defensivo ante un no-string (no debería pasar por tipos, pero no debe tirar).
  assert.equal(parseCmInput(null), null);
});

test('parseCmInput: el resultado es SIEMPRE un valor exacto de la grilla de la rueda', () => {
  const grid = new Set(wheelValues(CE_WHEEL));
  for (const raw of ['20', '20,5', '33,3', '36,5', '49,9', '50', '37,49', '37,5']) {
    const v = parseCmInput(raw);
    assert.ok(v != null && grid.has(v), `"${raw}" → ${v} debe estar en la grilla`);
  }
});

test('formatMonthsAR: "N meses" (plural); clampa al rango de la rueda (min 6)', () => {
  assert.equal(formatMonthsAR(24), '24 meses');
  assert.equal(formatMonthsAR(6), '6 meses');
  assert.equal(formatMonthsAR(120), '120 meses');
  // La rueda de meses arranca en 6 → un valor menor se clampa (no hay "1 mes" en este rango).
  assert.equal(formatMonthsAR(1), '6 meses');
});

test('formatMonthsNum: SOLO el número (sin unidad, para las celdas de la rueda)', () => {
  assert.equal(formatMonthsNum(24), '24');
  assert.equal(formatMonthsNum(120), '120');
  assert.equal(formatMonthsNum(6), '6');
  // Clampa al rango (no hay celda fuera de 6–120).
  assert.equal(formatMonthsNum(1), '6');
});

test('formatAgeLabel: "≈ N meses" / "1 mes" / sin definir', () => {
  assert.equal(formatAgeLabel(24), '≈ 24 meses');
  assert.equal(formatAgeLabel(1), '≈ 1 mes');
  assert.equal(formatAgeLabel(null), 'Edad sin definir');
  assert.equal(formatAgeLabel(undefined), 'Edad sin definir');
  assert.equal(formatAgeLabel(NaN), 'Edad sin definir');
});

// ─── edad prellenada desde birth_date (R14.6, DM6-6) ─────────────────────────────────────────────────

test('prefillAgeMonths: calcula meses desde birth_date y clampa al rango', () => {
  const now = new Date('2026-06-17T12:00:00Z');
  // 2 años exactos → 24 meses.
  assert.equal(prefillAgeMonths('2024-06-17', now), 24);
  // ~18 meses.
  assert.equal(prefillAgeMonths('2024-12-17', now), 18);
  // Sin fecha → null (no se prellena; la edad puede quedar desconocida).
  assert.equal(prefillAgeMonths(null, now), null);
  assert.equal(prefillAgeMonths(undefined, now), null);
  // Fecha futura → null (no inventamos edad).
  assert.equal(prefillAgeMonths('2030-01-01', now), null);
  // Animal MUY viejo (>120 meses) se clampa al tope de la rueda.
  assert.equal(prefillAgeMonths('2000-01-01', now), AGE_MAX_MONTHS);
  // Recién destetado (<6 meses) se clampa al piso.
  assert.equal(prefillAgeMonths('2026-05-01', now), AGE_MIN_MONTHS);
});

test('prefillAgeMonths: año-solo (AAAA-07-01) se prellena igual (DM6-6, no se distingue precisión)', () => {
  const now = new Date('2026-06-17T12:00:00Z');
  // El alta guiada sintetiza el año-solo a AAAA-07-01; M6 lo prellena sin distinguirlo de una fecha exacta.
  const months = prefillAgeMonths('2024-07-01', now);
  assert.equal(months, 23); // jul-2024 → jun-2026 ≈ 23 meses (día 1 ≤ día 17 → mes completo)
});

test('initialAgeIndex: usa la edad prellenada o el default cuando es desconocida', () => {
  // Conocida → su índice en la rueda de meses.
  assert.equal(initialAgeIndex(24), valueToIndex(24, AGE_WHEEL));
  // Desconocida (null) → el default (24).
  assert.equal(initialAgeIndex(null), valueToIndex(AGE_DEFAULT_MONTHS, AGE_WHEEL));
  assert.equal(initialAgeIndex(undefined), valueToIndex(AGE_DEFAULT_MONTHS, AGE_WHEEL));
});
