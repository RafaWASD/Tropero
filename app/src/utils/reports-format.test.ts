// Tests de la lógica PURA de presentación de reportes (spec 07 Stream C — FRONTEND). node:test.
// Foco: el guard de denominador 0 (R7.5.4/R7.6.3: nunca NaN/Infinity, "—"), el formato es-AR de
// porcentaje/peso/delta (referencia es-AR — coma decimal, punto miles), y los labels de kind/etapa/animal.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safePercent,
  formatPercentAR,
  formatKgAR,
  formatKgDeltaAR,
  formatCountDelta,
  eventKindLabel,
  cclStageLabel,
  cclBarsForMonths,
  kpiValueFontToken,
  daysSinceLabel,
  animalLabel,
  sessionDateLabel,
  sessionRangeLabel,
  defaultCampaignYear,
  compareSessions,
  compareWeights,
  calvingCardView,
  asCalvingStatus,
  CALVING_PENDING_LEGEND,
  weaningCardView,
  asWeaningStatus,
  WEANING_PENDING_LEGEND,
  SESSION_EVENT_KINDS,
} from './reports-format';

// ─── safePercent: guard de 0 (R7.5.4 / R7.6.3) ──────────────────────────────────────────────────────

test('safePercent: cálculo normal', () => {
  assert.equal(safePercent(41, 50), 82);
  assert.equal(safePercent(46, 50), 92);
  // 41/46 ≈ 89,13
  const p = safePercent(41, 46);
  assert.ok(p !== null && Math.abs(p - 89.130434) < 1e-4);
});

test('safePercent: denominador 0 → null (NUNCA NaN/Infinity)', () => {
  assert.equal(safePercent(0, 0), null);
  assert.equal(safePercent(5, 0), null);
  assert.equal(safePercent(0, -3), null);
});

test('safePercent: numerador 0 con denominador > 0 → 0 (no null)', () => {
  // 0 servidas preñadas de 30 servidas = 0%, NO "sin datos" (sí hay datos: ninguna preñó).
  assert.equal(safePercent(0, 30), 0);
});

test('safePercent: entradas no finitas → null', () => {
  assert.equal(safePercent(NaN, 10), null);
  assert.equal(safePercent(10, NaN), null);
  assert.equal(safePercent(Infinity, 10), null);
});

// ─── formatPercentAR ────────────────────────────────────────────────────────────────────────────────

test('formatPercentAR: coma decimal es-AR, sin decimal superfluo, % pegado', () => {
  assert.equal(formatPercentAR(84.6), '84,6 %');
  assert.equal(formatPercentAR(50), '50 %');
  assert.equal(formatPercentAR(0), '0 %');
  assert.equal(formatPercentAR(100), '100 %');
  // redondea a 1 decimal
  assert.equal(formatPercentAR(89.130434), '89,1 %');
});

test('formatPercentAR: null (denominador 0) → "—"', () => {
  assert.equal(formatPercentAR(null), '—');
  assert.equal(formatPercentAR(NaN), '—');
  assert.equal(formatPercentAR(Infinity), '—');
});

// ─── formatKgAR (R7.9.3 / R7.9.4) ────────────────────────────────────────────────────────────────────

test('formatKgAR: coma decimal + punto miles es-AR, " kg"', () => {
  assert.equal(formatKgAR(385.5), '385,5 kg');
  assert.equal(formatKgAR(312), '312 kg');
  assert.equal(formatKgAR(1050), '1.050 kg');
  assert.equal(formatKgAR(1234.5), '1.234,5 kg');
});

test('formatKgAR: null (categoría sin pesaje, R7.9.4) → "—" (NO "0 kg")', () => {
  assert.equal(formatKgAR(null), '—');
  assert.equal(formatKgAR(NaN), '—');
});

// ─── formatKgDeltaAR (comparativa de peso, R7.9.5) ───────────────────────────────────────────────────

test('formatKgDeltaAR: signo explícito con menos tipográfico', () => {
  assert.equal(formatKgDeltaAR(12.5), '+12,5 kg');
  assert.equal(formatKgDeltaAR(-8), '−8 kg'); // U+2212
  assert.equal(formatKgDeltaAR(0), '0 kg');
  assert.equal(formatKgDeltaAR(1050), '+1.050 kg');
});

test('formatKgDeltaAR: null (una sesión sin peso en esa categoría) → "—"', () => {
  assert.equal(formatKgDeltaAR(null), '—');
});

// ─── formatCountDelta (R7.4.1) ───────────────────────────────────────────────────────────────────────

test('formatCountDelta: entero con signo, 0 sin signo', () => {
  assert.equal(formatCountDelta(3), '+3');
  assert.equal(formatCountDelta(-1), '−1'); // U+2212
  assert.equal(formatCountDelta(0), '0');
});

// ─── calvingCardView + asCalvingStatus: presentación de la card de Parición (delta #8, RPF.6.2) ──────
// Verifica la traducción status → presentación (tabla design §3.2): el % SOLO en 'ok' con servidas>0, los
// mensajes accionables (NO un 0% engañoso) en los otros estados, la leyenda D4 SOLO con ok + pending>0, y el
// normalizador defensivo de status (CD-6). Es la cobertura frontend de RPF.1.3/2.4/2.5/3.3/4.2/4.3.

test('calvingCardView: ok con servidas>0 → % es-AR + detalle "N paridas / M servidas", sin leyenda (RPF.2.5)', () => {
  const cv = calvingCardView({ status: 'ok', calved: 38, serviced: 46, pendingPregnant: 0 });
  assert.equal(cv.value, '82,6 %'); // safePercent(38,46)=82.6086…, coma decimal es-AR
  assert.equal(cv.detail, '38 paridas / 46 servidas');
  assert.equal(cv.legend, undefined); // pending=0 → sin leyenda (RPF.4.3)
  assert.equal(cv.muted, false);
  assert.equal(cv.note, undefined);
});

test('calvingCardView: ok con pendingPregnant>0 → leyenda D4 (RPF.4.2)', () => {
  const cv = calvingCardView({ status: 'ok', calved: 30, serviced: 46, pendingPregnant: 8 });
  assert.equal(cv.value, '65,2 %');
  assert.equal(cv.detail, '30 paridas / 46 servidas');
  assert.equal(cv.legend, CALVING_PENDING_LEGEND); // "todavía hay vacas que no parieron, esto puede afectar el dato"
  assert.equal(cv.muted, false);
});

test('calvingCardView: ok con serviced=0 → "—" ("sin datos de esta campaña"), NO 0% (RPF.2.5 guard)', () => {
  const cv = calvingCardView({ status: 'ok', calved: 0, serviced: 0, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'sin datos de esta campaña');
  assert.equal(cv.muted, true);
  assert.equal(cv.detail, undefined);
  assert.equal(cv.legend, undefined);
});

test('calvingCardView: not_calving_season → "—" + "todavía no es época de parición", NO 0% prematuro (RPF.2.4)', () => {
  const cv = calvingCardView({ status: 'not_calving_season', calved: 0, serviced: 46, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'todavía no es época de parición');
  assert.equal(cv.muted, true);
  assert.equal(cv.legend, undefined); // leyenda D4 SOLO en 'ok' (RPF.4.3)
});

test('calvingCardView: no_service_months → "—" + "sin meses de servicio configurados" (RPF.1.3)', () => {
  const cv = calvingCardView({ status: 'no_service_months', calved: 0, serviced: 0, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'sin meses de servicio configurados');
  assert.equal(cv.muted, true);
});

test('calvingCardView: not_applicable_12m → "—" + "no aplica (servicio todo el año)" (RPF.3.3)', () => {
  const cv = calvingCardView({ status: 'not_applicable_12m', calved: 0, serviced: 46, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'no aplica (servicio todo el año)');
  assert.equal(cv.muted, true);
});

test('calvingCardView: kpi=null → "—" ("sin datos"), sin crash (defensivo)', () => {
  const cv = calvingCardView(null);
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'sin datos');
  assert.equal(cv.muted, true);
});

test('asCalvingStatus: pasa los 4 estados válidos; ausente/desconocido → "ok" (CD-6 default defensivo)', () => {
  assert.equal(asCalvingStatus('ok'), 'ok');
  assert.equal(asCalvingStatus('not_calving_season'), 'not_calving_season');
  assert.equal(asCalvingStatus('no_service_months'), 'no_service_months');
  assert.equal(asCalvingStatus('not_applicable_12m'), 'not_applicable_12m');
  assert.equal(asCalvingStatus(undefined), 'ok'); // DB sin la migración 0117 → compat, muestra el %
  assert.equal(asCalvingStatus(null), 'ok');
  assert.equal(asCalvingStatus('garbage'), 'ok');
  assert.equal(asCalvingStatus(42), 'ok');
});

// ─── weaningCardView + asWeaningStatus: presentación de la card de Destete (delta #10, RWK.7.2) ──────
// Verifica la traducción status → presentación (tabla design §3.2): el %destete SOLO en 'ok' con servidas>0
// (incl. >100% con mellizos — RWK.1.3), los mensajes accionables (NO un 0% engañoso) en los otros estados, la
// leyenda D4 SOLO con ok + pendingWeaning>0, y el normalizador defensivo de status (CD-7). Es la cobertura
// frontend de RWK.1.3/1.4/3.3/3.4/4.1/4.2/5.4/5.5.

test('weaningCardView: ok con servidas>0 → %destete es-AR + detalle "N destetados / M servidas", sin leyenda (RWK.3.4)', () => {
  const wv = weaningCardView({ status: 'ok', weaned: 40, serviced: 46, pendingWeaning: 0 });
  assert.equal(wv.value, '87 %'); // safePercent(40,46)=86.9565…, redondea a 1 decimal → 87 %
  assert.equal(wv.detail, '40 destetados / 46 servidas');
  assert.equal(wv.legend, undefined); // pending=0 → sin leyenda (RWK.4.2)
  assert.equal(wv.muted, false);
  assert.equal(wv.note, undefined);
});

test('weaningCardView: ok con pendingWeaning>0 → leyenda D4 (RWK.4.1)', () => {
  const wv = weaningCardView({ status: 'ok', weaned: 28, serviced: 46, pendingWeaning: 9 });
  assert.equal(wv.value, '60,9 %'); // 28/46 = 60,8695… → 60,9 %
  assert.equal(wv.detail, '28 destetados / 46 servidas');
  assert.equal(wv.legend, WEANING_PENDING_LEGEND); // "todavía hay crías sin destetar, esto puede afectar el dato"
  assert.equal(wv.muted, false);
});

test('weaningCardView: ok con %>100% (mellizos: weaned>serviced) → NO trunca (RWK.1.3)', () => {
  // 2 crías destetadas de 1 servida = 200% → correcto (mide terneros logrados por vaca servida).
  const wv = weaningCardView({ status: 'ok', weaned: 2, serviced: 1, pendingWeaning: 0 });
  assert.equal(wv.value, '200 %'); // safePercent(2,1)=200, sin truncar
  assert.equal(wv.detail, '2 destetados / 1 servidas');
  assert.equal(wv.muted, false);
});

test('weaningCardView: ok con serviced=0 → "—" ("sin datos de esta campaña"), NO 0% (RWK.1.4)', () => {
  const wv = weaningCardView({ status: 'ok', weaned: 0, serviced: 0, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'sin datos de esta campaña');
  assert.equal(wv.muted, true);
  assert.equal(wv.detail, undefined);
  assert.equal(wv.legend, undefined);
});

test('weaningCardView: not_weaning_season → "—" + "todavía no empezó el destete", NO 0% prematuro (RWK.3.3)', () => {
  const wv = weaningCardView({ status: 'not_weaning_season', weaned: 0, serviced: 46, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'todavía no empezó el destete');
  assert.equal(wv.muted, true);
  assert.equal(wv.legend, undefined); // leyenda D4 SOLO en 'ok' (RWK.4.2)
});

test('weaningCardView: no_service_months → "—" + "sin meses de servicio configurados" (RWK.5.4)', () => {
  const wv = weaningCardView({ status: 'no_service_months', weaned: 0, serviced: 0, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'sin meses de servicio configurados');
  assert.equal(wv.muted, true);
});

test('weaningCardView: not_applicable_12m → "—" + "no aplica (servicio todo el año)" (RWK.5.5)', () => {
  const wv = weaningCardView({ status: 'not_applicable_12m', weaned: 0, serviced: 46, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'no aplica (servicio todo el año)');
  assert.equal(wv.muted, true);
});

test('weaningCardView: kpi=null → "—" ("sin datos"), sin crash (defensivo)', () => {
  const wv = weaningCardView(null);
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'sin datos');
  assert.equal(wv.muted, true);
});

test('asWeaningStatus: pasa los 4 estados válidos; ausente/desconocido → "ok" (CD-7 default defensivo)', () => {
  assert.equal(asWeaningStatus('ok'), 'ok');
  assert.equal(asWeaningStatus('not_weaning_season'), 'not_weaning_season');
  assert.equal(asWeaningStatus('no_service_months'), 'no_service_months');
  assert.equal(asWeaningStatus('not_applicable_12m'), 'not_applicable_12m');
  assert.equal(asWeaningStatus(undefined), 'ok'); // DB sin la migración 0118 → compat, muestra el %
  assert.equal(asWeaningStatus(null), 'ok');
  assert.equal(asWeaningStatus('garbage'), 'ok');
  assert.equal(asWeaningStatus(42), 'ok');
});

// ─── eventKindLabel (R7.3.1) ─────────────────────────────────────────────────────────────────────────

test('eventKindLabel: mapea los 7 kinds a es-AR', () => {
  assert.equal(eventKindLabel('weight'), 'Pesajes');
  assert.equal(eventKindLabel('reproductive'), 'Reproductivos');
  assert.equal(eventKindLabel('sanitary'), 'Sanitarios');
  assert.equal(eventKindLabel('condition'), 'Condición corporal');
  assert.equal(eventKindLabel('lab'), 'Muestras de lab');
  assert.equal(eventKindLabel('scrotal'), 'Circunferencia escrotal');
  assert.equal(eventKindLabel('custom'), 'Personalizados');
});

test('eventKindLabel: kind desconocido → el code crudo (defensivo)', () => {
  assert.equal(eventKindLabel('raro'), 'raro');
});

test('SESSION_EVENT_KINDS: son exactamente los 7 con FK session_id (animal_events NO)', () => {
  assert.equal(SESSION_EVENT_KINDS.length, 7);
  assert.deepEqual(
    [...SESSION_EVENT_KINDS],
    ['weight', 'reproductive', 'sanitary', 'condition', 'lab', 'scrotal', 'custom'],
  );
});

// ─── kpiValueFontToken (web-safe length-aware; adjustsFontSizeToFit es no-op en rn-web) ─────────────

test('kpiValueFontToken: valores cortos → $10, 6+ chars → $9 (no truncar en media card 360px)', () => {
  assert.deepEqual(kpiValueFontToken('—'), { fontSize: '$10', lineHeight: '$10' });
  assert.deepEqual(kpiValueFontToken('50 %'), { fontSize: '$10', lineHeight: '$10' });
  assert.deepEqual(kpiValueFontToken('100 %'), { fontSize: '$10', lineHeight: '$10' }); // 5 chars
  assert.deepEqual(kpiValueFontToken('82,6 %'), { fontSize: '$9', lineHeight: '$9' }); // 6 chars
  assert.deepEqual(kpiValueFontToken('100,0 %'), { fontSize: '$9', lineHeight: '$9' }); // 7 chars
});

// ─── cclStageLabel ───────────────────────────────────────────────────────────────────────────────────

test('cclStageLabel: cabeza/cuerpo/cola', () => {
  assert.equal(cclStageLabel('head'), 'Cabeza');
  assert.equal(cclStageLabel('body'), 'Cuerpo');
  assert.equal(cclStageLabel('tail'), 'Cola');
});

// ─── cclBarsForMonths (R7.7.2/R7.7.3/R7.7.5 — espejo de pregnancy-buckets) ──────────────────────────

test('cclBarsForMonths: 1/12/0/null → sin barras (R7.7.3: la UI oculta CCL)', () => {
  const counts = { head: 5, body: 3, tail: 2, total: 10 };
  assert.deepEqual(cclBarsForMonths(1, counts), []);
  assert.deepEqual(cclBarsForMonths(12, counts), []);
  assert.deepEqual(cclBarsForMonths(0, counts), []);
  assert.deepEqual(cclBarsForMonths(null, counts), []);
});

test('cclBarsForMonths: 3 meses → cabeza/cuerpo/cola con % sobre total', () => {
  const bars = cclBarsForMonths(3, { head: 5, body: 3, tail: 2, total: 10 });
  assert.equal(bars.length, 3);
  assert.deepEqual(bars.map((b) => b.stage), ['head', 'body', 'tail']);
  assert.deepEqual(bars.map((b) => b.label), ['Cabeza', 'Cuerpo', 'Cola']);
  assert.deepEqual(bars.map((b) => b.count), [5, 3, 2]);
  assert.deepEqual(bars.map((b) => b.percent), [50, 30, 20]);
});

test('cclBarsForMonths: 2 meses → cabeza/cola, pliega un medium extraviado en cabeza', () => {
  // medium=1 (anomalía de dato en un rodeo de 2 meses) → se pliega en cabeza para no perder el animal.
  const bars = cclBarsForMonths(2, { head: 6, body: 1, tail: 3, total: 10 });
  assert.equal(bars.length, 2);
  assert.deepEqual(bars.map((b) => b.stage), ['head', 'tail']);
  assert.deepEqual(bars.map((b) => b.count), [7, 3]); // 6+1 plegado, 3
  assert.deepEqual(bars.map((b) => b.percent), [70, 30]);
});

test('cclBarsForMonths: total 0 → barras con 0% (no NaN; la UI muestra empty, R7.7.4)', () => {
  const bars = cclBarsForMonths(3, { head: 0, body: 0, tail: 0, total: 0 });
  assert.equal(bars.length, 3);
  assert.deepEqual(bars.map((b) => b.percent), [0, 0, 0]);
});

test('cclBarsForMonths: 4-11 meses → tercios (cabeza/cuerpo/cola), espejo de pregnancy-buckets', () => {
  assert.equal(cclBarsForMonths(4, { head: 1, body: 1, tail: 1, total: 3 }).length, 3);
  assert.equal(cclBarsForMonths(11, { head: 1, body: 1, tail: 1, total: 3 }).length, 3);
});

// ─── daysSinceLabel (R7.11.3) ────────────────────────────────────────────────────────────────────────

test('daysSinceLabel: null → nunca pesado; singular/plural', () => {
  assert.equal(daysSinceLabel(null), 'Nunca pesado');
  assert.equal(daysSinceLabel(1), 'hace 1 día');
  assert.equal(daysSinceLabel(45), 'hace 45 días');
  assert.equal(daysSinceLabel(0), 'hace 0 días');
  // negativo (reloj raro) → clamp a 0
  assert.equal(daysSinceLabel(-5), 'hace 0 días');
});

// ─── animalLabel ─────────────────────────────────────────────────────────────────────────────────────

test('animalLabel (delta IDU): IDV si lo tiene, sino "Sin identificación" (sin visual_id_alt)', () => {
  assert.equal(animalLabel('AR123'), 'AR123');
  assert.equal(animalLabel(null), 'Sin identificación');
  assert.equal(animalLabel('  '), 'Sin identificación'); // IDV en blanco → fallback
  assert.equal(animalLabel(''), 'Sin identificación');
});

// ─── sessionDateLabel / sessionRangeLabel (R7.3.2 / R7.3.6) ─────────────────────────────────────────

test('sessionDateLabel: fecha es-AR dd/mm/aaaa o "Sin fecha"', () => {
  assert.equal(sessionDateLabel(null), 'Sin fecha');
  assert.equal(sessionDateLabel('no-es-fecha'), 'Sin fecha');
  // Instante real (started_at): día LOCAL. 10:00Z es media mañana en todo huso realista → sigue el 24.
  const s = sessionDateLabel('2026-06-24T10:00:00Z');
  assert.match(s, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.ok(s.includes('2026'));
});

test('sessionDateLabel: date-only (next_dose_date de la alerta de dosis) → dd/mm/aaaa SIN drift', () => {
  // `next_dose_date` es columna `date`: llega como `AAAA-MM-DD`. formatDateEsAr la formatea por string
  // → NO driftea −1 día en AR (el bug que traía `new Date().toLocaleDateString`). Determinístico.
  assert.equal(sessionDateLabel('2026-06-07'), '07/06/2026');
  assert.equal(sessionDateLabel('2026-01-01'), '01/01/2026');
});

test('sessionRangeLabel: abierta cuando no hay ended_at', () => {
  const s = sessionRangeLabel('2026-06-24T10:00:00Z', null);
  assert.ok(s.includes('abierta'));
});

test('sessionRangeLabel: mismo día no repite la fecha', () => {
  const s = sessionRangeLabel('2026-06-24T08:00:00Z', '2026-06-24T18:00:00Z');
  assert.ok(!s.includes('→'), `mismo día no debería mostrar flecha: "${s}"`);
});

// ─── compareSessions (R7.4.1/.3) ────────────────────────────────────────────────────────────────────

test('compareSessions: delta B−A por kind, kind faltante = 0 + delta (R7.4.3)', () => {
  const a = [{ kind: 'weight', eventCount: 10 }, { kind: 'sanitary', eventCount: 5 }];
  const b = [{ kind: 'weight', eventCount: 8 }, { kind: 'reproductive', eventCount: 3 }];
  const rows = compareSessions(a, b);
  // kinds presentes en alguna: weight, reproductive, sanitary (en el orden de SESSION_EVENT_KINDS).
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  assert.deepEqual(byKind.get('weight'), { kind: 'weight', label: 'Pesajes', a: 10, b: 8, delta: -2 });
  // sanitary: 5 en A, 0 en B → fila presente con delta -5 (NO se omite, R7.4.3)
  assert.deepEqual(byKind.get('sanitary'), { kind: 'sanitary', label: 'Sanitarios', a: 5, b: 0, delta: -5 });
  // reproductive: 0 en A, 3 en B → +3
  assert.deepEqual(byKind.get('reproductive'), {
    kind: 'reproductive',
    label: 'Reproductivos',
    a: 0,
    b: 3,
    delta: 3,
  });
});

test('compareSessions: kinds 0 en ambas se omiten (no aportan)', () => {
  const rows = compareSessions([{ kind: 'weight', eventCount: 2 }], [{ kind: 'weight', eventCount: 2 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'weight');
  assert.equal(rows[0].delta, 0);
});

test('compareSessions: respeta el orden de SESSION_EVENT_KINDS', () => {
  const a = [{ kind: 'custom', eventCount: 1 }, { kind: 'weight', eventCount: 1 }];
  const b: { kind: string; eventCount: number }[] = [];
  const rows = compareSessions(a, b);
  assert.deepEqual(rows.map((r) => r.kind), ['weight', 'custom']); // weight antes que custom
});

// ─── compareWeights (R7.9.5 / T7.3) ──────────────────────────────────────────────────────────────────

test('compareWeights: delta B−A por categoría; categoría ausente en una sesión → null', () => {
  const a = [
    { categoryId: 'c1', categoryName: 'Vacas', avgWeight: 400 },
    { categoryId: 'c2', categoryName: 'Vaquillonas', avgWeight: 300 },
  ];
  const b = [
    { categoryId: 'c1', categoryName: 'Vacas', avgWeight: 420 },
    { categoryId: 'c3', categoryName: 'Terneros', avgWeight: 180 },
  ];
  const rows = compareWeights(a, b);
  const byId = new Map(rows.map((r) => [r.categoryId, r]));
  assert.deepEqual(byId.get('c1'), {
    categoryId: 'c1',
    categoryName: 'Vacas',
    a: 400,
    b: 420,
    delta: 20,
  });
  // c2 sólo en A → b null, delta null (no se inventa delta contra ausente)
  assert.deepEqual(byId.get('c2'), {
    categoryId: 'c2',
    categoryName: 'Vaquillonas',
    a: 300,
    b: null,
    delta: null,
  });
  // c3 sólo en B → a null, delta null
  assert.deepEqual(byId.get('c3'), {
    categoryId: 'c3',
    categoryName: 'Terneros',
    a: null,
    b: 180,
    delta: null,
  });
});

test('compareWeights: orden alfabético por categoría', () => {
  const rows = compareWeights(
    [{ categoryId: 'c1', categoryName: 'Zaino', avgWeight: 1 }],
    [{ categoryId: 'c2', categoryName: 'Alazán', avgWeight: 1 }],
  );
  assert.deepEqual(rows.map((r) => r.categoryName), ['Alazán', 'Zaino']);
});

// ─── defaultCampaignYear (R7.5.7: última campaña con datos, NO año calendario) ──────────────────────

test('defaultCampaignYear: año de la sesión más reciente (no el actual)', () => {
  // sesiones de 2024 y 2025; el año actual es 2026 → default = 2025 (última con datos), NO 2026.
  assert.equal(
    defaultCampaignYear(['2024-05-01T00:00:00Z', '2025-11-01T00:00:00Z'], 2026),
    2025,
  );
});

test('defaultCampaignYear: sin sesiones → año actual (fallback)', () => {
  assert.equal(defaultCampaignYear([], 2026), 2026);
  assert.equal(defaultCampaignYear([null, 'no-fecha'], 2026), 2026);
});

test('defaultCampaignYear: ignora fechas inválidas, toma el máximo año válido', () => {
  assert.equal(
    defaultCampaignYear([null, '2023-01-01T00:00:00Z', 'basura', '2022-12-01T00:00:00Z'], 2026),
    2023,
  );
});
