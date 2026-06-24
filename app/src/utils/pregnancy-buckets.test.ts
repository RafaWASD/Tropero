// Tests de la regla de BUCKETS CCL del tacto de preñez (spec 03 Stream B / B2 — DD-PSC-3). node:test.
// FUENTE ÚNICA de la regla del Gate 0 §4 (RPSC.4.5/RPSC.5.8). Foco:
//   - el nº de buckets por cada nº de meses (null/0/1/2/3/4–11/12/13/negativo/no-entero) — RPSC.5.2–5.5.
//   - el mapeo 1:1 label↔status (Cabeza→large, Cuerpo→medium, Cola→small) — RPSC.5.6.
//   - defaultMeasureSize derivado (2/3/4–11 → SÍ; 1/12/0/NULL → NO) — RPSC.4.2.
//   - effectiveSizeBuckets con override del operario (NO fuerza []; SÍ vale el rodeo; undefined = default) — RPSC.4.3/4.4.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sizeBucketsForServiceMonths,
  defaultMeasureSize,
  effectiveSizeBuckets,
  type SizeBucket,
} from './pregnancy-buckets';

/** Helper: extrae sólo los labels (orden importa) para aserciones legibles. */
function labels(buckets: SizeBucket[]): string[] {
  return buckets.map((b) => b.label);
}

// ─── sizeBucketsForServiceMonths: nº y nombres de buckets por nº de meses (Gate 0 §4) ────────────────

test('sizeBucketsForServiceMonths: NULL (sin configurar) → [] (RPSC.5.2 / RPSC.4.2)', () => {
  assert.deepEqual(sizeBucketsForServiceMonths(null), []);
});

test('sizeBucketsForServiceMonths: 0 (vacío / no hace servicio) → []', () => {
  assert.deepEqual(sizeBucketsForServiceMonths(0), []);
});

test('sizeBucketsForServiceMonths: 1 mes → [] (todas la misma edad → preñada/vacía) (RPSC.5.2)', () => {
  assert.deepEqual(sizeBucketsForServiceMonths(1), []);
});

test('sizeBucketsForServiceMonths: 2 meses → [Cabeza, Cola] (sin Cuerpo) (RPSC.5.3)', () => {
  const b = sizeBucketsForServiceMonths(2);
  assert.equal(b.length, 2);
  assert.deepEqual(labels(b), ['Cabeza', 'Cola']);
});

test('sizeBucketsForServiceMonths: 3 meses → [Cabeza, Cuerpo, Cola] (tercios exactos) (RPSC.5.4)', () => {
  const b = sizeBucketsForServiceMonths(3);
  assert.equal(b.length, 3);
  assert.deepEqual(labels(b), ['Cabeza', 'Cuerpo', 'Cola']);
});

test('sizeBucketsForServiceMonths: 4..11 meses → 3 buckets [Cabeza, Cuerpo, Cola] (tercios) (RPSC.5.5 [TENTATIVO])', () => {
  for (let n = 4; n <= 11; n += 1) {
    const b = sizeBucketsForServiceMonths(n);
    assert.equal(b.length, 3, `n=${n} debería dar 3 buckets`);
    assert.deepEqual(labels(b), ['Cabeza', 'Cuerpo', 'Cola'], `n=${n}`);
  }
});

test('sizeBucketsForServiceMonths: 12 meses (continuo) → [] (sin CCL) (RPSC.5.2 [TENTATIVO política 12m])', () => {
  assert.deepEqual(sizeBucketsForServiceMonths(12), []);
});

test('sizeBucketsForServiceMonths: defensivo — > 12, negativo, no entero → [] (contrato duro)', () => {
  assert.deepEqual(sizeBucketsForServiceMonths(13), []);
  assert.deepEqual(sizeBucketsForServiceMonths(24), []);
  assert.deepEqual(sizeBucketsForServiceMonths(-1), []);
  assert.deepEqual(sizeBucketsForServiceMonths(2.5), []);
  assert.deepEqual(sizeBucketsForServiceMonths(Number.NaN), []);
});

test('sizeBucketsForServiceMonths: devuelve un array NUEVO cada vez (no comparte la referencia interna)', () => {
  const a = sizeBucketsForServiceMonths(3);
  const b = sizeBucketsForServiceMonths(3);
  assert.notEqual(a, b); // referencias distintas
  assert.deepEqual(a, b); // mismo contenido
  a.push(HEAD_LIKE); // mutar uno no debe afectar al otro ni a llamadas futuras
  assert.equal(sizeBucketsForServiceMonths(3).length, 3);
});
const HEAD_LIKE: SizeBucket = { label: 'Cabeza', status: 'large' };

// ─── Mapeo 1:1 label ↔ pregnancy_status (RPSC.5.6) ───────────────────────────────────────────────────

test('mapeo 1:1: Cabeza→large, Cuerpo→medium, Cola→small (RPSC.5.6, espejo de PREGNANCY_LABELS)', () => {
  const three = sizeBucketsForServiceMonths(3);
  const byLabel = new Map(three.map((b) => [b.label, b.status]));
  assert.equal(byLabel.get('Cabeza'), 'large');
  assert.equal(byLabel.get('Cuerpo'), 'medium');
  assert.equal(byLabel.get('Cola'), 'small');
});

test('mapeo 1:1: en 2 meses, Cabeza→large y Cola→small (sin medium)', () => {
  const two = sizeBucketsForServiceMonths(2);
  const byLabel = new Map(two.map((b) => [b.label, b.status]));
  assert.equal(byLabel.get('Cabeza'), 'large');
  assert.equal(byLabel.get('Cola'), 'small');
  assert.equal(byLabel.has('Cuerpo'), false);
  // Y ningún bucket persiste 'medium' en el caso de 2 meses.
  assert.equal(two.some((b) => b.status === 'medium'), false);
});

test('orden de buckets: SIEMPRE de la preñez más avanzada a la más reciente (Cabeza → … → Cola)', () => {
  // Estabilidad del orden (load-bearing para el render de bloques de arriba a abajo).
  assert.deepEqual(labels(sizeBucketsForServiceMonths(2)), ['Cabeza', 'Cola']);
  assert.deepEqual(labels(sizeBucketsForServiceMonths(3)), ['Cabeza', 'Cuerpo', 'Cola']);
  assert.deepEqual(labels(sizeBucketsForServiceMonths(7)), ['Cabeza', 'Cuerpo', 'Cola']);
});

// ─── defaultMeasureSize: derivado del rodeo (RPSC.4.2) ───────────────────────────────────────────────

test('defaultMeasureSize: 2/3/4–11 → SÍ (hay distinción) (RPSC.4.2)', () => {
  assert.equal(defaultMeasureSize(2), true);
  assert.equal(defaultMeasureSize(3), true);
  for (let n = 4; n <= 11; n += 1) {
    assert.equal(defaultMeasureSize(n), true, `n=${n}`);
  }
});

test('defaultMeasureSize: 1/12/0/NULL → NO (sin distinción) (RPSC.4.2 / RPSC.4.4)', () => {
  assert.equal(defaultMeasureSize(1), false);
  assert.equal(defaultMeasureSize(12), false);
  assert.equal(defaultMeasureSize(0), false);
  assert.equal(defaultMeasureSize(null), false);
});

test('defaultMeasureSize: consistente con sizeBucketsForServiceMonths (≥1 bucket ⟺ SÍ) para todos los nº', () => {
  for (let n = 0; n <= 13; n += 1) {
    const hasButtons = sizeBucketsForServiceMonths(n).length > 0;
    assert.equal(defaultMeasureSize(n), hasButtons, `n=${n}`);
  }
  assert.equal(defaultMeasureSize(null), sizeBucketsForServiceMonths(null).length > 0);
});

// ─── effectiveSizeBuckets: override del operario sobre el default del rodeo (RPSC.4.3/4.4) ────────────

test('effectiveSizeBuckets: override NO (false) → [] aunque el rodeo admita buckets (RPSC.4.3)', () => {
  assert.deepEqual(effectiveSizeBuckets(3, false), []);
  assert.deepEqual(effectiveSizeBuckets(2, false), []);
  assert.deepEqual(effectiveSizeBuckets(7, false), []);
});

test('effectiveSizeBuckets: override SÍ (true) → valen los buckets del rodeo (RPSC.4.3)', () => {
  assert.deepEqual(labels(effectiveSizeBuckets(3, true)), ['Cabeza', 'Cuerpo', 'Cola']);
  assert.deepEqual(labels(effectiveSizeBuckets(2, true)), ['Cabeza', 'Cola']);
});

test('effectiveSizeBuckets: override SÍ sobre un rodeo SIN distinción (1/12/NULL) → [] (degradar con gracia, RPSC.4.4)', () => {
  // El operario puede ACTIVAR "medir tamaño", pero un rodeo de 1/12 meses no produce buckets igual.
  assert.deepEqual(effectiveSizeBuckets(1, true), []);
  assert.deepEqual(effectiveSizeBuckets(12, true), []);
  assert.deepEqual(effectiveSizeBuckets(null, true), []);
});

test('effectiveSizeBuckets: sin decisión (undefined) → cae al default del rodeo', () => {
  assert.deepEqual(labels(effectiveSizeBuckets(3, undefined)), ['Cabeza', 'Cuerpo', 'Cola']);
  assert.deepEqual(effectiveSizeBuckets(1, undefined), []);
  assert.deepEqual(effectiveSizeBuckets(null, undefined), []);
});
