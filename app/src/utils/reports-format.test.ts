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
  splitKpiValue,
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
  campaignStateView,
  campaignCclMonths,
  campaignCloseActions,
  type CampaignStatusLike,
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
  assert.equal(cv.legend, CALVING_PENDING_LEGEND); // "Todavía hay vacas que no parieron, esto puede afectar el dato"
  assert.equal(cv.muted, false);
});

test('calvingCardView: ok con serviced=0 → "—" ("Sin datos de esta campaña"), NO 0% (RPF.2.5 guard)', () => {
  const cv = calvingCardView({ status: 'ok', calved: 0, serviced: 0, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'Sin datos de esta campaña');
  assert.equal(cv.muted, true);
  assert.equal(cv.detail, undefined);
  assert.equal(cv.legend, undefined);
});

test('calvingCardView: not_calving_season → "—" + "Todavía no es época de parición", NO 0% prematuro (RPF.2.4)', () => {
  const cv = calvingCardView({ status: 'not_calving_season', calved: 0, serviced: 46, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'Todavía no es época de parición');
  assert.equal(cv.muted, true);
  assert.equal(cv.legend, undefined); // leyenda D4 SOLO en 'ok' (RPF.4.3)
});

test('calvingCardView: no_service_months → "—" + "Sin meses de servicio configurados" (RPF.1.3)', () => {
  const cv = calvingCardView({ status: 'no_service_months', calved: 0, serviced: 0, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'Sin meses de servicio configurados');
  assert.equal(cv.muted, true);
});

test('calvingCardView: not_applicable_12m → "—" + "No aplica (servicio todo el año)" (RPF.3.3)', () => {
  const cv = calvingCardView({ status: 'not_applicable_12m', calved: 0, serviced: 46, pendingPregnant: 0 });
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'No aplica (servicio todo el año)');
  assert.equal(cv.muted, true);
});

test('calvingCardView: kpi=null → "—" ("Sin datos"), sin crash (defensivo)', () => {
  const cv = calvingCardView(null);
  assert.equal(cv.value, '—');
  assert.equal(cv.note, 'Sin datos');
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
  assert.equal(wv.legend, WEANING_PENDING_LEGEND); // "Todavía hay crías sin destetar, esto puede afectar el dato"
  assert.equal(wv.muted, false);
});

test('weaningCardView: ok con %>100% (mellizos: weaned>serviced) → NO trunca (RWK.1.3)', () => {
  // 2 crías destetadas de 1 servida = 200% → correcto (mide terneros logrados por vaca servida).
  const wv = weaningCardView({ status: 'ok', weaned: 2, serviced: 1, pendingWeaning: 0 });
  assert.equal(wv.value, '200 %'); // safePercent(2,1)=200, sin truncar
  assert.equal(wv.detail, '2 destetados / 1 servidas');
  assert.equal(wv.muted, false);
});

test('weaningCardView: ok con serviced=0 → "—" ("Sin datos de esta campaña"), NO 0% (RWK.1.4)', () => {
  const wv = weaningCardView({ status: 'ok', weaned: 0, serviced: 0, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'Sin datos de esta campaña');
  assert.equal(wv.muted, true);
  assert.equal(wv.detail, undefined);
  assert.equal(wv.legend, undefined);
});

test('weaningCardView: not_weaning_season → "—" + "Todavía no empezó el destete", NO 0% prematuro (RWK.3.3)', () => {
  const wv = weaningCardView({ status: 'not_weaning_season', weaned: 0, serviced: 46, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'Todavía no empezó el destete');
  assert.equal(wv.muted, true);
  assert.equal(wv.legend, undefined); // leyenda D4 SOLO en 'ok' (RWK.4.2)
});

test('weaningCardView: no_service_months → "—" + "Sin meses de servicio configurados" (RWK.5.4)', () => {
  const wv = weaningCardView({ status: 'no_service_months', weaned: 0, serviced: 0, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'Sin meses de servicio configurados');
  assert.equal(wv.muted, true);
});

test('weaningCardView: not_applicable_12m → "—" + "No aplica (servicio todo el año)" (RWK.5.5)', () => {
  const wv = weaningCardView({ status: 'not_applicable_12m', weaned: 0, serviced: 46, pendingWeaning: 0 });
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'No aplica (servicio todo el año)');
  assert.equal(wv.muted, true);
});

test('weaningCardView: kpi=null → "—" ("Sin datos"), sin crash (defensivo)', () => {
  const wv = weaningCardView(null);
  assert.equal(wv.value, '—');
  assert.equal(wv.note, 'Sin datos');
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

// ─── splitKpiValue (separa número + "%" — anti-recorte bug F; adjustsFontSizeToFit es no-op en rn-web) ─
// El valor viene del caller con el "%" pegado (formatPercentAR); el KpiCard lo separa para renderizar el
// número GRANDE (héroe) y la unidad "%" más chica al lado → libera el ancho del "%" que truncaba la media
// card a 320-360px. Sólo separa un "%" AL FINAL; un valor sin "%" ("—") se devuelve entero con percent=null.

test('splitKpiValue: separa el número de la unidad "%" (con y sin decimal)', () => {
  assert.deepEqual(splitKpiValue('84,6 %'), { number: '84,6', percent: '%' });
  assert.deepEqual(splitKpiValue('89,1 %'), { number: '89,1', percent: '%' });
  assert.deepEqual(splitKpiValue('100 %'), { number: '100', percent: '%' });
  assert.deepEqual(splitKpiValue('50 %'), { number: '50', percent: '%' });
  assert.deepEqual(splitKpiValue('0 %'), { number: '0', percent: '%' });
  assert.deepEqual(splitKpiValue('200 %'), { number: '200', percent: '%' }); // destete >100% (mellizos)
  assert.deepEqual(splitKpiValue('150,5 %'), { number: '150,5', percent: '%' });
});

test('splitKpiValue: valor sin "%" ("—" muted, o cualquier otra unidad) → entero, percent=null', () => {
  assert.deepEqual(splitKpiValue('—'), { number: '—', percent: null });
  assert.deepEqual(splitKpiValue(''), { number: '', percent: null });
  // defensivo: una unidad que NO es "%" no se parte (se renderiza entera al tamaño del número).
  assert.deepEqual(splitKpiValue('385,5 kg'), { number: '385,5 kg', percent: null });
});

// ─── kpiValueFontToken (web-safe, length-aware sobre el NÚMERO; adjustsFontSizeToFit no-op en rn-web) ──
// Ahora el tamaño se decide por la longitud del NÚMERO (sin la unidad "%"): ≤3 chars → $10 (38px), 4+ → $9
// (30px). Con el "%" separado, el número entra completo en media card a 320px sin truncar (ver comentario
// del módulo: anchos reales medidos con el faux-bold de la web build).

test('kpiValueFontToken: número ≤3 chars → $10; 4+ chars → $9 (no truncar en media card 320px)', () => {
  assert.deepEqual(kpiValueFontToken('—'), { fontSize: '$10', lineHeight: '$10' }); // número "—" (1)
  assert.deepEqual(kpiValueFontToken('50 %'), { fontSize: '$10', lineHeight: '$10' }); // número "50" (2)
  assert.deepEqual(kpiValueFontToken('100 %'), { fontSize: '$10', lineHeight: '$10' }); // número "100" (3)
  assert.deepEqual(kpiValueFontToken('200 %'), { fontSize: '$10', lineHeight: '$10' }); // número "200" (3)
  assert.deepEqual(kpiValueFontToken('82,6 %'), { fontSize: '$9', lineHeight: '$9' }); // número "82,6" (4)
  assert.deepEqual(kpiValueFontToken('89,1 %'), { fontSize: '$9', lineHeight: '$9' }); // número "89,1" (4)
  assert.deepEqual(kpiValueFontToken('100,0 %'), { fontSize: '$9', lineHeight: '$9' }); // número "100,0" (5)
  assert.deepEqual(kpiValueFontToken('150,5 %'), { fontSize: '$9', lineHeight: '$9' }); // número "150,5" (5)
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

// ─── campaignStateView: el estado de campaña (delta campañas congeladas, RCC.10.3) ──────────────────
//
// Es la única lógica de presentación del delta, y la pantalla no tiene ninguna: si esta función se
// equivoca, la UI ofrece cerrar una campaña que el server va a rechazar (que es el modo de falla que
// Gate 1 N-3 encontró) o esconde que un número es una foto sacada a medias.

const openStatus: CampaignStatusLike = {
  isClosed: false, closedAt: null, closedByName: null, closedIncomplete: false, missingAtClose: null,
  pendingPregnant: 2, pendingWeaning: 5, canClose: true, canReopen: false, cycleComplete: false,
  hasNewData: false,
};
const closedStatus: CampaignStatusLike = {
  isClosed: true, closedAt: '2026-03-14', closedByName: null, closedIncomplete: false, missingAtClose: null,
  pendingPregnant: 0, pendingWeaning: 0, canClose: false, canReopen: true, cycleComplete: true,
  hasNewData: false,
};

test('campaignStateView: en curso sin sugerencia → ofrece cerrar, sin aviso', () => {
  const v = campaignStateView(openStatus);
  assert.equal(v.badge, 'en-curso');
  assert.equal(v.title, 'Campaña en curso');
  assert.equal(v.detail, 'Los números se actualizan con cada dato nuevo');
  assert.equal(v.notice, null);
  assert.equal(v.primaryAction, 'close');
  assert.equal(v.tone, 'neutral');
});

test('campaignStateView: en curso con el ciclo completo → sugiere cerrar (D1)', () => {
  const v = campaignStateView({ ...openStatus, cycleComplete: true, pendingPregnant: 0, pendingWeaning: 0 });
  assert.equal(v.notice, 'El ciclo de esta campaña está completo. ¿La cerrás?');
  assert.equal(v.primaryAction, 'close');
  assert.equal(v.tone, 'info');
});

test('campaignStateView: cerrada → dice que es una FOTO y con qué fecha (es-AR)', () => {
  const v = campaignStateView(closedStatus);
  assert.equal(v.badge, 'cerrada');
  assert.equal(v.title, 'Campaña cerrada');
  assert.equal(v.detail, 'Foto del 14/03/2026');
  assert.equal(v.notice, null);
  assert.equal(v.primaryAction, 'reopen');
});

test('campaignStateView: cerrada con autor → lo nombra en el detalle', () => {
  const v = campaignStateView({ ...closedStatus, closedByName: 'Facundo' });
  assert.equal(v.detail, 'Foto del 14/03/2026 · la cerró Facundo');
});

test('campaignStateView: cerrada A MEDIAS → badge + aviso de qué faltaba (F8/RCC.10.11)', () => {
  const v = campaignStateView({
    ...closedStatus, closedIncomplete: true, missingAtClose: '2 preñadas sin parir · 5 crías sin destetar',
  });
  assert.equal(v.badge, 'cerrada-a-medias');
  assert.equal(v.title, 'Campaña cerrada a medias');
  assert.equal(v.detail, 'Foto del 14/03/2026');
  assert.equal(
    v.notice,
    'Se cerró con 2 preñadas sin parir · 5 crías sin destetar. Los números no incluyen eso.',
  );
  assert.equal(v.tone, 'warning');
});

test('campaignStateView: cerrada con datos nuevos → avisa y ofrece reabrir (DL10)', () => {
  const v = campaignStateView({ ...closedStatus, hasNewData: true });
  assert.equal(v.notice, 'Hay datos nuevos sin reflejar en la foto. Reabrí la campaña para incorporarlos.');
  assert.equal(v.primaryAction, 'reopen');
  assert.equal(v.tone, 'info');
});

test('campaignStateView: cerrada a medias Y con datos nuevos → los DOS avisos, uno por línea', () => {
  const v = campaignStateView({
    ...closedStatus, closedIncomplete: true, missingAtClose: '5 crías sin destetar', hasNewData: true,
  });
  const lines = String(v.notice).split('\n');
  assert.equal(lines.length, 2, 'son dos hechos distintos: ninguno reemplaza al otro');
  assert.match(lines[0], /Se cerró con 5 crías sin destetar/);
  assert.match(lines[1], /Hay datos nuevos sin reflejar en la foto/);
});

test('campaignStateView: SIN permiso pero cerrada a medias → el aviso SÍ se muestra, la acción no', () => {
  // RCC.10.11 + RCC.10.8: "cerrada a medias" es información del reporte, no una acción. El field_operator
  // tiene que poder ver que ese número se congeló antes de que terminara la parición.
  const v = campaignStateView({
    ...closedStatus, canReopen: false, closedIncomplete: true, missingAtClose: '5 crías sin destetar',
  });
  assert.equal(v.primaryAction, null, 'sin permiso no se ofrece reabrir');
  assert.match(String(v.notice), /Se cerró con 5 crías sin destetar/, 'pero el aviso se muestra igual');
  assert.equal(v.badge, 'cerrada-a-medias');
});

test('campaignStateView: canClose=false con el ciclo incompleto → NO ofrece cerrar ni reconocer (N-3)', () => {
  // `canClose` refleja los TRES gates duros del server (rol · corte ya ocurrido · serviced > 0). Ofrecer el
  // cierre acá lleva al usuario a un 23514 que NO es reconocible, y de ahí a clickear "cerrar igual con
  // estos datos incompletos" — que también falla. Eso degrada a ruido el control que protege DP-10.
  const v = campaignStateView({ ...openStatus, canClose: false, cycleComplete: false });
  assert.equal(v.primaryAction, null);
  assert.equal(v.notice, null, 'ni siquiera se sugiere');
});

test('campaignStateView: canClose=false con el ciclo completo → tampoco sugiere cerrar', () => {
  const v = campaignStateView({ ...openStatus, canClose: false, cycleComplete: true });
  assert.equal(v.primaryAction, null);
  assert.equal(v.notice, null);
  assert.equal(v.tone, 'neutral');
});

test('campaignStateView: `missing` enumera en es-AR, con singular y plural', () => {
  assert.deepEqual(campaignStateView(openStatus).missing, ['2 preñadas sin parir', '5 crías sin destetar']);
  assert.deepEqual(
    campaignStateView({ ...openStatus, pendingPregnant: 1, pendingWeaning: 0 }).missing,
    ['1 preñada sin parir'],
  );
  assert.deepEqual(
    campaignStateView({ ...openStatus, pendingPregnant: 0, pendingWeaning: 1 }).missing,
    ['1 cría sin destetar'],
  );
  assert.deepEqual(campaignStateView({ ...openStatus, pendingPregnant: 0, pendingWeaning: 0 }).missing, []);
});

test('campaignStateView: status null → NO afirma (badge desconocido), sin fecha ni acciones', () => {
  // Este test se llamaba "no afirma nada" y asserteaba `badge: 'en-curso'` + `title: 'Campaña en curso'`.
  // O sea: verificaba la afirmación que su nombre prometía que no existía, y con eso CONGELABA el defecto.
  // Ahora asserta la AUSENCIA de afirmación, que es lo que el nombre dice.
  const v = campaignStateView(null);
  assert.equal(v.badge, 'desconocido', 'ni en curso ni cerrada: TODAVÍA NO SE SABE');
  assert.notEqual(v.badge, 'en-curso', 'sin estado NO se puede decir que la campaña está en curso');
  assert.equal(v.title, 'Campaña', 'título neutro: no califica los números de abajo');
  assert.ok(!/en curso|cerrada|foto/i.test(v.title), 'el título no afirma ningún estado');
  assert.equal(v.detail, null, 'sin fecha de foto: no hay foto que fechar');
  assert.equal(v.notice, null);
  assert.equal(v.primaryAction, null, 'no se ofrece cerrar ni reabrir algo cuyo estado se desconoce');
  assert.deepEqual(v.missing, []);
});

test('campaignStateView: un estado CONOCIDO nunca queda en `desconocido`', () => {
  // Control de no-vacuidad del test de arriba: si alguien "arreglara" el badge devolviendo siempre
  // `desconocido`, esto se pone rojo.
  assert.equal(campaignStateView(openStatus).badge, 'en-curso');
  assert.equal(campaignStateView(closedStatus).badge, 'cerrada');
  assert.equal(
    campaignStateView({ ...closedStatus, closedIncomplete: true, missingAtClose: '1 cría sin destetar' }).badge,
    'cerrada-a-medias',
  );
});

// ─── campaignCclMonths: con qué meses se dibujan las barras del CCL (RCC.10.4 / F5) ─────────────────

test('campaignCclMonths: campaña ABIERTA → los meses del rodeo de hoy', () => {
  assert.deepEqual(campaignCclMonths({ ...openStatus, serviceMonths: [1, 2] }, [6, 7]), [6, 7]);
  assert.deepEqual(campaignCclMonths(null, [6, 7]), [6, 7]);
  assert.equal(campaignCclMonths(null, null), null);
});

test('campaignCclMonths: campaña CERRADA → los meses CONGELADOS, no los del rodeo de hoy (F5)', () => {
  // El productor editó la estación después de cerrar: la foto NO puede cambiar de número de barras.
  assert.deepEqual(campaignCclMonths({ ...closedStatus, serviceMonths: [6, 7] }, [10, 11, 12]), [6, 7]);
});

test('campaignCclMonths: cerrada con `serviceMonths` NULL → NULL, NO los del rodeo (el caso que mata al `??`)', () => {
  // Una campaña cerrada SIN estación configurada congela `service_months = null`. Escrito como
  // `campaign?.serviceMonths ?? rodeo?.serviceMonths` —que es la forma natural y la que tenía la pantalla—
  // ese null cae al valor de HOY y la foto vuelve a depender del presente: F5 reintroducida por un `??`.
  assert.equal(campaignCclMonths({ ...closedStatus, serviceMonths: null }, [10, 11, 12]), null);
  assert.equal(campaignCclMonths({ ...closedStatus }, [10, 11, 12]), null, 'sin la clave, igual: la foto manda');
});

test('campaignStateView: `closedAt` con la forma REAL del contrato (timestamptz) usa el día LOCAL', () => {
  // El fixture de los otros casos usa '2026-03-14' (date-only), pero `rodeo_campaign_status.closed_at` es
  // **timestamptz**: con ese fixture, el mutante "formatear el instante con getters UTC en vez de locales"
  // —el drift de −1 día que la convención es-AR existe para evitar— NO se puede matar. Este caso lo cierra.
  // La expectativa se COMPUTA con los getters locales en vez de hardcodearse: hardcodear '14/03/2026' sería
  // verde en Argentina y rojo en un runner UTC, o sea un test que depende del huso del que lo corre.
  const iso = '2026-03-15T01:30:00Z';
  const d = new Date(iso);
  const esperado = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const v = campaignStateView({ ...closedStatus, closedAt: iso, closedByName: null });
  assert.equal(v.detail, `Foto del ${esperado}`);
  assert.ok(!/T01:30|Z|2026-03/.test(String(v.detail)), 'nunca el ISO crudo');
});

// ─── campaignCloseActions: qué controles ofrece la hoja, y con qué peso (Gate 2.5) ──────────────────

const baseActions = { cycleComplete: false, acknowledgeAvailable: false, rodeoCount: 1, incompleteCount: 0, busy: false };

test('campaignCloseActions: sin rechazo previo → UN primario, que es el cierre sin reconocimiento', () => {
  const a = campaignCloseActions(baseActions);
  const primary = a.filter((x) => x.kind === 'primary');
  assert.equal(primary.length, 1, 'exactamente un control con peso de primario');
  assert.equal(primary[0].id, 'close');
  assert.equal(primary[0].acknowledge, false, 'el primer intento NUNCA reconoce nada');
  assert.equal(a.at(-1).id, 'cancel', 'y siempre hay salida');
});

test('campaignCloseActions: TRAS EL RECHAZO no queda NINGÚN primario, y el intento que falló desaparece', () => {
  // El invariante de Gate 2.5. El botón relleno "Cerrar campaña" manda `onConfirm(false)`, que es
  // exactamente lo que el server acaba de rechazar: dejarlo como la acción de más peso visual y mejor
  // target de Fitts es ofrecer, con el control más atractivo de la pantalla, la única cosa que no puede
  // funcionar. Y dos labels que arrancan igual, pegados, uno relleno y otro no, es un slip esperando pasar.
  const a = campaignCloseActions({ ...baseActions, acknowledgeAvailable: true });
  assert.deepEqual(a.filter((x) => x.kind === 'primary'), [], 'ningún control primario');
  assert.deepEqual(a.filter((x) => x.id === 'close'), [], 'el intento sin reconocimiento ya no se ofrece');
  const ack = a.find((x) => x.id === 'close-ack');
  assert.ok(ack, 'el reconocimiento SÍ se ofrece');
  assert.equal(ack.acknowledge, true);
  assert.equal(ack.kind, 'secondary', 'reconocer es deliberado: contorno, nunca relleno');
});

test('campaignCloseActions: ninguna acción que RECONOZCA puede tener peso de primario', () => {
  // Barre el espacio de estados en vez de un caso: el reconocimiento no puede volverse el héroe visual
  // por ningún camino (DP-10).
  for (const ackAvail of [false, true]) {
    for (const rodeoCount of [1, 4]) {
      for (const incompleteCount of [0, 2]) {
        const a = campaignCloseActions({ ...baseActions, acknowledgeAvailable: ackAvail, rodeoCount, incompleteCount });
        for (const x of a.filter((y) => y.acknowledge === true)) {
          assert.notEqual(x.kind, 'primary', `${x.id} con acknowledge=true NO puede ser primario`);
        }
        if (ackAvail) {
          assert.deepEqual(a.filter((y) => y.kind === 'primary'), [], 'tras el rechazo, cero primarios');
        }
      }
    }
  }
});

test('campaignCloseActions: el masivo va en dos pasadas y la segunda queda acotada a los rechazados', () => {
  const first = campaignCloseActions({ ...baseActions, rodeoCount: 4 });
  assert.ok(first.some((x) => x.id === 'close-all' && x.acknowledge === false), 'primera pasada sin reconocer');
  assert.ok(!first.some((x) => x.id === 'close-all-ack'), 'sin rechazados no se ofrece la segunda');

  const second = campaignCloseActions({ ...baseActions, rodeoCount: 4, incompleteCount: 2 });
  const ack = second.find((x) => x.id === 'close-all-ack');
  assert.ok(ack, 'con rechazados aparece la segunda pasada');
  assert.match(ack.label, /2 incompletos/, 'y nombra CUÁNTOS, no "todos"');
  const uno = campaignCloseActions({ ...baseActions, rodeoCount: 4, incompleteCount: 1 });
  assert.equal(uno.find((x) => x.id === 'close-all-ack').label, 'Cerrar igual el rodeo incompleto',
    'singular es-AR: "el rodeo incompleto", no "los 1 incompletos"');
  assert.ok(!second.some((x) => x.id === 'close-all'), 'y la primera ya no se re-ofrece');
});

test('campaignCloseActions: `busy` solo cambia el label del primario, no la forma de la hoja', () => {
  const a = campaignCloseActions({ ...baseActions, busy: true });
  assert.equal(a.find((x) => x.id === 'close').label, 'Cerrando…');
  assert.equal(a.length, campaignCloseActions(baseActions).length);
});
