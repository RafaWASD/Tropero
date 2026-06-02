// Tests de la lógica pura de la cronología (spec 02 C3.1, R10). Pura, sin RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTimelineRow,
  parseTimeline,
  collectCategoryIds,
  resolveCategoryNames,
  formatEventDate,
  isDateOnlyKind,
  humanizeReproEventType,
  humanizePregnancyStatus,
  humanizeSanitaryEventType,
  humanizeSampleType,
  humanizeRoute,
  describeCategoryChange,
  deriveCurrentState,
  type TimelineRow,
} from './event-timeline.ts';

// ─── Parseo por kind (los 7 orígenes de la RPC 0035) ─────────────────────────────────────

test('parseTimelineRow: weight', () => {
  const row: TimelineRow = {
    event_kind: 'weight',
    event_id: 'w1',
    event_date: '2025-03-15T10:00:00Z',
    payload: { weight_kg: 320.5, source: 'manual', notes: 'pesado en manga' },
  };
  const item = parseTimelineRow(row);
  assert.equal(item?.kind, 'weight');
  if (item?.kind === 'weight') {
    assert.equal(item.weightKg, 320.5);
    assert.equal(item.source, 'manual');
    assert.equal(item.notes, 'pesado en manga');
    assert.equal(item.eventId, 'w1');
  }
});

test('parseTimelineRow: weight con numeric como string ("320.50")', () => {
  const item = parseTimelineRow({
    event_kind: 'weight',
    event_id: 'w2',
    event_date: '2025-03-15T10:00:00Z',
    payload: { weight_kg: '320.50' },
  });
  assert.equal(item?.kind, 'weight');
  if (item?.kind === 'weight') assert.equal(item.weightKg, 320.5);
});

test('parseTimelineRow: reproductive con todos los campos', () => {
  const item = parseTimelineRow({
    event_kind: 'reproductive',
    event_id: 'r1',
    event_date: '2025-02-01T00:00:00Z',
    payload: { event_type: 'tacto', pregnancy_status: 'medium', calf_id: null, notes: null },
  });
  assert.equal(item?.kind, 'reproductive');
  if (item?.kind === 'reproductive') {
    assert.equal(item.eventType, 'tacto');
    assert.equal(item.pregnancyStatus, 'medium');
    assert.equal(item.calfId, null);
  }
});

test('parseTimelineRow: sanitary', () => {
  const item = parseTimelineRow({
    event_kind: 'sanitary',
    event_id: 's1',
    event_date: '2025-01-10T00:00:00Z',
    payload: { event_type: 'vaccination', product_name: 'Aftosa', route: 'subcutaneous', notes: null },
  });
  assert.equal(item?.kind, 'sanitary');
  if (item?.kind === 'sanitary') {
    assert.equal(item.eventType, 'vaccination');
    assert.equal(item.productName, 'Aftosa');
    assert.equal(item.route, 'subcutaneous');
  }
});

test('parseTimelineRow: condition_score', () => {
  const item = parseTimelineRow({
    event_kind: 'condition_score',
    event_id: 'c1',
    event_date: '2025-01-05T00:00:00Z',
    payload: { score: 3.25, notes: null },
  });
  assert.equal(item?.kind, 'condition_score');
  if (item?.kind === 'condition_score') assert.equal(item.score, 3.25);
});

test('parseTimelineRow: lab_sample', () => {
  const item = parseTimelineRow({
    event_kind: 'lab_sample',
    event_id: 'l1',
    event_date: '2025-01-01T00:00:00Z',
    payload: { sample_type: 'blood', tube_number: '12', result: 'negativo', received: '2025-01-05' },
  });
  assert.equal(item?.kind, 'lab_sample');
  if (item?.kind === 'lab_sample') {
    assert.equal(item.sampleType, 'blood');
    assert.equal(item.tubeNumber, '12');
    assert.equal(item.result, 'negativo');
    assert.equal(item.receivedDate, '2025-01-05');
  }
});

test('parseTimelineRow: category_change (UUID from/to, sin nombre resuelto aún)', () => {
  const item = parseTimelineRow({
    event_kind: 'category_change',
    event_id: 'cat1',
    event_date: '2024-12-01T00:00:00Z',
    payload: { from: null, to: 'uuid-vaquillona', reason: 'initial' },
  });
  assert.equal(item?.kind, 'category_change');
  if (item?.kind === 'category_change') {
    assert.equal(item.fromCategoryId, null);
    assert.equal(item.toCategoryId, 'uuid-vaquillona');
    assert.equal(item.fromCategoryName, null);
    assert.equal(item.reason, 'initial');
  }
});

test('parseTimelineRow: observacion', () => {
  const item = parseTimelineRow({
    event_kind: 'observacion',
    event_id: 'o1',
    event_date: '2025-03-20T14:30:00Z',
    payload: {
      event_type: 'observacion',
      text: 'Renguea de la pata derecha',
      author_id: 'user-1',
      edit_window_until: '2025-03-20T14:45:00Z',
    },
  });
  assert.equal(item?.kind, 'observacion');
  if (item?.kind === 'observacion') {
    assert.equal(item.text, 'Renguea de la pata derecha');
    assert.equal(item.authorId, 'user-1');
  }
});

test('parseTimelineRow: payload INCOMPLETO (campos faltantes → null, no crashea)', () => {
  const item = parseTimelineRow({
    event_kind: 'weight',
    event_id: 'w3',
    event_date: '2025-03-15T10:00:00Z',
    payload: {}, // sin weight_kg ni nada
  });
  assert.equal(item?.kind, 'weight');
  if (item?.kind === 'weight') {
    assert.equal(item.weightKg, null);
    assert.equal(item.source, null);
    assert.equal(item.notes, null);
  }
});

test('parseTimelineRow: payload NULL no crashea', () => {
  const item = parseTimelineRow({
    event_kind: 'observacion',
    event_id: 'o2',
    event_date: '2025-03-20T14:30:00Z',
    payload: null,
  });
  assert.equal(item?.kind, 'observacion');
  if (item?.kind === 'observacion') {
    assert.equal(item.text, null);
  }
});

test('parseTimelineRow: kind desconocido → null (descartado por el caller)', () => {
  const item = parseTimelineRow({
    event_kind: 'futuro_kind',
    event_id: 'x1',
    event_date: '2025-03-20T14:30:00Z',
    payload: {},
  });
  assert.equal(item, null);
});

test('parseTimelineRow: string vacío → null (no string vacío como valor)', () => {
  const item = parseTimelineRow({
    event_kind: 'sanitary',
    event_id: 's2',
    event_date: '2025-01-10T00:00:00Z',
    payload: { event_type: 'vaccination', product_name: '', route: '', notes: '' },
  });
  assert.equal(item?.kind, 'sanitary');
  if (item?.kind === 'sanitary') {
    assert.equal(item.productName, null);
    assert.equal(item.route, null);
    assert.equal(item.notes, null);
  }
});

// ─── parseTimeline: orden desc + descarta kinds desconocidos ──────────────────────────────

test('parseTimeline: ordena por event_date desc y descarta desconocidos', () => {
  const rows: TimelineRow[] = [
    { event_kind: 'weight', event_id: 'a', event_date: '2025-01-01T00:00:00Z', payload: {} },
    { event_kind: 'futuro', event_id: 'z', event_date: '2025-05-01T00:00:00Z', payload: {} },
    { event_kind: 'weight', event_id: 'b', event_date: '2025-03-01T00:00:00Z', payload: {} },
    { event_kind: 'weight', event_id: 'c', event_date: '2025-02-01T00:00:00Z', payload: {} },
  ];
  const items = parseTimeline(rows);
  assert.equal(items.length, 3); // 'futuro' descartado
  assert.deepEqual(
    items.map((i) => i.eventId),
    ['b', 'c', 'a'], // mar, feb, ene
  );
});

test('parseTimeline: empate de fecha → orden estable por eventId (determinístico)', () => {
  const rows: TimelineRow[] = [
    { event_kind: 'weight', event_id: 'aaa', event_date: '2025-03-01T00:00:00Z', payload: {} },
    { event_kind: 'condition_score', event_id: 'bbb', event_date: '2025-03-01T00:00:00Z', payload: {} },
  ];
  const items = parseTimeline(rows);
  // mismo timestamp → desempate por eventId desc (estable, no flako).
  assert.deepEqual(
    items.map((i) => i.eventId),
    ['bbb', 'aaa'],
  );
});

test('parseTimeline: vacío → []', () => {
  assert.deepEqual(parseTimeline([]), []);
});

// ─── Resolución de nombres de categoría (sin N+1) ─────────────────────────────────────────

test('collectCategoryIds: junta los from/to únicos de los category_change', () => {
  const items = parseTimeline([
    { event_kind: 'category_change', event_id: 'c1', event_date: '2025-01-01T00:00:00Z', payload: { from: null, to: 'A', reason: 'initial' } },
    { event_kind: 'category_change', event_id: 'c2', event_date: '2025-02-01T00:00:00Z', payload: { from: 'A', to: 'B', reason: 'auto_transition' } },
    { event_kind: 'weight', event_id: 'w', event_date: '2025-03-01T00:00:00Z', payload: {} },
  ]);
  const ids = collectCategoryIds(items).sort();
  assert.deepEqual(ids, ['A', 'B']);
});

test('resolveCategoryNames: completa los nombres desde el mapa, deja null si falta', () => {
  const items = parseTimeline([
    { event_kind: 'category_change', event_id: 'c2', event_date: '2025-02-01T00:00:00Z', payload: { from: 'A', to: 'B', reason: 'auto_transition' } },
  ]);
  const resolved = resolveCategoryNames(items, { A: 'Vaquillona', B: 'Vaquillona preñada' });
  const it = resolved[0];
  assert.equal(it.kind, 'category_change');
  if (it.kind === 'category_change') {
    assert.equal(it.fromCategoryName, 'Vaquillona');
    assert.equal(it.toCategoryName, 'Vaquillona preñada');
  }
});

test('resolveCategoryNames: id sin nombre en el mapa → null (no crashea)', () => {
  const items = parseTimeline([
    { event_kind: 'category_change', event_id: 'c1', event_date: '2025-01-01T00:00:00Z', payload: { from: null, to: 'X', reason: 'initial' } },
  ]);
  const resolved = resolveCategoryNames(items, {});
  const it = resolved[0];
  if (it.kind === 'category_change') assert.equal(it.toCategoryName, null);
});

// ─── formatEventDate (PURA, `now` fijo) ───────────────────────────────────────────────────

const NOW = new Date(2025, 2, 15, 12, 0, 0); // 15 mar 2025, 12:00 local

test('formatEventDate: HOY → "Hoy HH:MM"', () => {
  const iso = new Date(2025, 2, 15, 9, 5, 0).toISOString();
  assert.equal(formatEventDate(iso, NOW), 'Hoy 09:05');
});

test('formatEventDate: AYER → "Ayer"', () => {
  const iso = new Date(2025, 2, 14, 18, 0, 0).toISOString();
  assert.equal(formatEventDate(iso, NOW), 'Ayer');
});

test('formatEventDate: mismo año → "DD MMM" (mes es-AR)', () => {
  const iso = new Date(2025, 0, 8, 0, 0, 0).toISOString(); // 8 ene 2025
  assert.equal(formatEventDate(iso, NOW), '8 ene');
});

test('formatEventDate: otro año → "DD/MM/AAAA"', () => {
  const iso = new Date(2023, 11, 25, 0, 0, 0).toISOString(); // 25 dic 2023
  assert.equal(formatEventDate(iso, NOW), '25/12/2023');
});

test('formatEventDate: ISO inválido o null → ""', () => {
  assert.equal(formatEventDate('no-es-fecha', NOW), '');
  assert.equal(formatEventDate(null, NOW), '');
  assert.equal(formatEventDate(undefined, NOW), '');
});

test('formatEventDate: ayer cruzando inicio de mes', () => {
  const now = new Date(2025, 2, 1, 10, 0, 0); // 1 mar
  const iso = new Date(2025, 1, 28, 22, 0, 0).toISOString(); // 28 feb (ayer)
  assert.equal(formatEventDate(iso, now), 'Ayer');
});

// ─── formatEventDate con dateOnly (columnas `date`: weight/condition/sanitary/lab/repro) ──────
// El valor llega como UTC-medianoche del día tipeado (la RPC 0035 castea `date`→timestamptz). Sus
// componentes UTC SON la fecha calendario. Tests TZ-independientes: el ISO es literal con +00:00 y
// `now` se construye con componentes locales explícitos → no dependen del TZ del runner/CI.

test('formatEventDate dateOnly: HOY → "Hoy" SIN hora', () => {
  // FIX 1, caso AR: un evento de HOY cargado en huso AR (UTC-3). El instante UTC-medianoche cae el
  // día anterior en hora local — pero como FECHA calendario es HOY. dateOnly:true lo arregla.
  const iso = '2026-06-02T00:00:00+00:00';
  const now = new Date(2026, 5, 2, 9, 30, 0); // 2 jun 2026, mañana local (cualquier hora)
  assert.equal(formatEventDate(iso, now, { dateOnly: true }), 'Hoy');
  // Y a la tardecita (hora local alta) sigue siendo "Hoy" — la hora local no mueve la fecha.
  const nowLate = new Date(2026, 5, 2, 23, 45, 0);
  assert.equal(formatEventDate(iso, nowLate, { dateOnly: true }), 'Hoy');
});

test('formatEventDate: MISMO ISO sin dateOnly se ubica por su día LOCAL (por eso el flag importa)', () => {
  // Demostración del problema original: como INSTANTE, 2026-06-02T00:00:00+00:00 se interpreta en
  // hora LOCAL del runner; en cualquier huso al OESTE de UTC (ej. AR UTC-3) cae el día calendario
  // ANTERIOR (2026-06-01 21:00 local) → "Ayer" respecto del 2 jun. El flag dateOnly es lo que evita
  // ese corrimiento. Construimos `now` como "el día local de `iso` + 1 día", DST-proof: tomamos los
  // componentes LOCALES del instante y armamos `now` al mediodía del día siguiente local (el mediodía
  // nunca cae en un salto DST).
  const iso = '2026-06-02T00:00:00+00:00';
  const local = new Date(iso); // mismo instante, leído en el huso del runner
  const now = new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1, 12, 0, 0);
  // Como instante, `iso` cae el día local `local`; `now` es el día siguiente → "Ayer".
  assert.equal(formatEventDate(iso, now), 'Ayer');
  // …y con dateOnly el MISMO par no es "Ayer": la fecha calendario (UTC) es el 2 jun, distinta del
  // 3 jun de `now` → "DD MMM" (no "Ayer"). Confirma que el flag cambia el resultado.
  assert.notEqual(formatEventDate(iso, now, { dateOnly: true }), 'Ayer');
});

test('formatEventDate dateOnly: AYER → "Ayer"', () => {
  const iso = '2026-06-01T00:00:00+00:00';
  const now = new Date(2026, 5, 2, 8, 0, 0); // 2 jun local
  assert.equal(formatEventDate(iso, now, { dateOnly: true }), 'Ayer');
});

test('formatEventDate dateOnly: mismo año → "DD MMM" (es-AR, sin hora)', () => {
  const iso = '2026-01-08T00:00:00+00:00';
  const now = new Date(2026, 5, 2, 12, 0, 0);
  assert.equal(formatEventDate(iso, now, { dateOnly: true }), '8 ene');
});

test('formatEventDate dateOnly: otro año → "DD/MM/AAAA" (sin hora)', () => {
  const iso = '2023-12-25T00:00:00+00:00';
  const now = new Date(2026, 5, 2, 12, 0, 0);
  assert.equal(formatEventDate(iso, now, { dateOnly: true }), '25/12/2023');
});

test('formatEventDate dateOnly: ayer cruzando inicio de mes (1 mar → 28 feb)', () => {
  const iso = '2025-02-28T00:00:00+00:00';
  const now = new Date(2025, 2, 1, 10, 0, 0); // 1 mar
  assert.equal(formatEventDate(iso, now, { dateOnly: true }), 'Ayer');
});

test('formatEventDate dateOnly: ISO inválido/null → ""', () => {
  const now = new Date(2026, 5, 2, 12, 0, 0);
  assert.equal(formatEventDate('no-es-fecha', now, { dateOnly: true }), '');
  assert.equal(formatEventDate(null, now, { dateOnly: true }), '');
});

test('formatEventDate sin dateOnly (instante): HOY conserva la hora local', () => {
  const iso = new Date(2025, 2, 15, 9, 5, 0).toISOString(); // instante local 09:05
  assert.equal(formatEventDate(iso, NOW, { dateOnly: false }), 'Hoy 09:05');
});

// ─── isDateOnlyKind (ruteo del flag por kind) ─────────────────────────────────────────────────

test('isDateOnlyKind: true para los 5 kinds con columna `date`', () => {
  for (const k of ['weight', 'condition_score', 'sanitary', 'lab_sample', 'reproductive']) {
    assert.equal(isDateOnlyKind(k), true, `${k} debería ser date-only`);
  }
});

test('isDateOnlyKind: false para los kinds con instante real (timestamptz)', () => {
  assert.equal(isDateOnlyKind('observacion'), false); // created_at
  assert.equal(isDateOnlyKind('category_change'), false); // changed_at
});

test('isDateOnlyKind: false para kind desconocido (defensivo)', () => {
  assert.equal(isDateOnlyKind('futuro_kind'), false);
});

// ─── Humanizadores ────────────────────────────────────────────────────────────────────────

test('humanizeReproEventType', () => {
  assert.equal(humanizeReproEventType('tacto'), 'Tacto');
  assert.equal(humanizeReproEventType('birth'), 'Parto');
  assert.equal(humanizeReproEventType('weaning'), 'Destete');
  assert.equal(humanizeReproEventType(null), 'Reproducción');
  assert.equal(humanizeReproEventType('desconocido'), 'Reproducción');
});

test('humanizePregnancyStatus', () => {
  assert.equal(humanizePregnancyStatus('empty'), 'Vacía');
  assert.equal(humanizePregnancyStatus('large'), 'Preñez grande (cola)');
  assert.equal(humanizePregnancyStatus(null), null);
  assert.equal(humanizePregnancyStatus('xx'), null);
});

test('humanizeSanitaryEventType', () => {
  assert.equal(humanizeSanitaryEventType('vaccination'), 'Vacunación');
  assert.equal(humanizeSanitaryEventType('deworming'), 'Desparasitación');
  assert.equal(humanizeSanitaryEventType(null), 'Sanidad');
});

test('humanizeSampleType', () => {
  assert.equal(humanizeSampleType('blood'), 'Sangre');
  assert.equal(humanizeSampleType('scrape_tricho'), 'Raspaje (trichomonas)');
  assert.equal(humanizeSampleType(null), null);
});

test('humanizeRoute', () => {
  assert.equal(humanizeRoute('subcutaneous'), 'Subcutánea');
  assert.equal(humanizeRoute('IM'), 'Intramuscular');
  assert.equal(humanizeRoute('algo-raro'), 'algo-raro'); // pasa el valor tal cual si no mapea
  assert.equal(humanizeRoute(null), null);
});

// ─── describeCategoryChange (hito) ────────────────────────────────────────────────────────

test('describeCategoryChange: initial → "Alta" + categoría inicial', () => {
  const d = describeCategoryChange({ reason: 'initial', fromCategoryName: null, toCategoryName: 'Vaquillona' });
  assert.equal(d.title, 'Alta');
  assert.equal(d.detail, 'Categoría inicial: Vaquillona');
});

test('describeCategoryChange: auto_transition → "Cambió a X (automático)"', () => {
  const d = describeCategoryChange({
    reason: 'auto_transition',
    fromCategoryName: 'Vaquillona',
    toCategoryName: 'Vaquillona preñada',
  });
  assert.equal(d.title, 'Cambió a Vaquillona preñada');
  assert.equal(d.detail, '(automático)');
});

test('describeCategoryChange: manual_override → "(manual)"', () => {
  const d = describeCategoryChange({ reason: 'manual_override', fromCategoryName: 'A', toCategoryName: 'B' });
  assert.equal(d.title, 'Cambió a B');
  assert.equal(d.detail, '(manual)');
});

test('describeCategoryChange: nombre no resuelto → fallback "categoría"', () => {
  const d = describeCategoryChange({ reason: 'initial', fromCategoryName: null, toCategoryName: null });
  assert.equal(d.detail, 'Categoría inicial: categoría');
});

// ─── deriveCurrentState (FIX C): valor vigente de cada medición tipada ─────────────────────

// Helper para armar items rápido a partir de filas crudas (ejerce el path real parseTimelineRow).
function weightRow(id: string, date: string, kg: number | null): TimelineRow {
  return { event_kind: 'weight', event_id: id, event_date: date, payload: { weight_kg: kg } };
}
function scoreRow(id: string, date: string, score: number | null): TimelineRow {
  return { event_kind: 'condition_score', event_id: id, event_date: date, payload: { score } };
}

test('deriveCurrentState: timeline vacío o null → {}', () => {
  assert.deepEqual(deriveCurrentState([]), {});
  assert.deepEqual(deriveCurrentState(null), {});
  assert.deepEqual(deriveCurrentState(undefined), {});
});

test('deriveCurrentState: toma el peso del evento MÁS RECIENTE (no asume orden de entrada)', () => {
  // Entrada DESORDENADA a propósito (el más reciente NO es el primero): debe elegir el de mayor fecha.
  const items = parseTimeline([
    weightRow('w-old', '2025-01-10T00:00:00Z', 300),
    weightRow('w-new', '2025-03-15T00:00:00Z', 320),
    weightRow('w-mid', '2025-02-01T00:00:00Z', 310),
  ]);
  const state = deriveCurrentState(items);
  assert.deepEqual(state.weight, { kg: 320, date: '2025-03-15T00:00:00Z' });
});

test('deriveCurrentState: NO confía en el orden de parseTimeline (recibe items crudos desordenados)', () => {
  // Pasamos los items SIN ordenar (construidos a mano, orden inverso) — deriveCurrentState igual elige
  // el máximo. Robusto ante cualquier orden, no solo el de parseTimeline.
  const raw = [
    { kind: 'weight' as const, eventId: 'a', eventDate: '2025-01-01T00:00:00Z', weightKg: 200, source: null, notes: null },
    { kind: 'weight' as const, eventId: 'b', eventDate: '2025-12-31T00:00:00Z', weightKg: 450, source: null, notes: null },
  ];
  assert.deepEqual(deriveCurrentState(raw).weight, { kg: 450, date: '2025-12-31T00:00:00Z' });
});

test('deriveCurrentState: peso Y condición vigentes a la vez, cada uno por su último', () => {
  const items = parseTimeline([
    weightRow('w1', '2025-02-01T00:00:00Z', 300),
    weightRow('w2', '2025-03-01T00:00:00Z', 330),
    scoreRow('s1', '2025-01-15T00:00:00Z', 3),
    scoreRow('s2', '2025-04-10T00:00:00Z', 3.5),
  ]);
  const state = deriveCurrentState(items);
  assert.deepEqual(state.weight, { kg: 330, date: '2025-03-01T00:00:00Z' });
  assert.deepEqual(state.conditionScore, { score: 3.5, date: '2025-04-10T00:00:00Z' });
});

test('deriveCurrentState: solo condición (nunca se pesó) → weight ausente', () => {
  const items = parseTimeline([scoreRow('s1', '2025-03-01T00:00:00Z', 4)]);
  const state = deriveCurrentState(items);
  assert.equal(state.weight, undefined);
  assert.deepEqual(state.conditionScore, { score: 4, date: '2025-03-01T00:00:00Z' });
});

test('deriveCurrentState: ignora eventos de peso/condición con valor null (payload incompleto)', () => {
  // Un weight con weight_kg null NO cuenta como "peso vigente" (no surfaceamos un peso sin número),
  // aunque sea el más reciente: caemos al último CON número.
  const items = parseTimeline([
    weightRow('w-good', '2025-02-01T00:00:00Z', 300),
    weightRow('w-null', '2025-05-01T00:00:00Z', null), // más reciente pero sin número
  ]);
  const state = deriveCurrentState(items);
  assert.deepEqual(state.weight, { kg: 300, date: '2025-02-01T00:00:00Z' });
});

test('deriveCurrentState: ignora kinds que no son medición (observación / category_change)', () => {
  const items = parseTimeline([
    { event_kind: 'observacion', event_id: 'o1', event_date: '2025-09-01T00:00:00Z', payload: { text: 'renguea' } },
    { event_kind: 'category_change', event_id: 'c1', event_date: '2025-08-01T00:00:00Z', payload: { reason: 'initial', to: 'x' } },
    weightRow('w1', '2025-03-01T00:00:00Z', 280),
  ]);
  const state = deriveCurrentState(items);
  // Solo el peso surfacea; observación/category_change no aportan "estado actual".
  assert.deepEqual(state.weight, { kg: 280, date: '2025-03-01T00:00:00Z' });
  assert.equal(state.conditionScore, undefined);
});

test('deriveCurrentState: empate de fecha exacta → desempata por eventId mayor (determinístico)', () => {
  const items = parseTimeline([
    weightRow('w-aaa', '2025-03-01T00:00:00Z', 300),
    weightRow('w-zzz', '2025-03-01T00:00:00Z', 400), // misma fecha, id mayor → gana
  ]);
  assert.deepEqual(deriveCurrentState(items).weight, { kg: 400, date: '2025-03-01T00:00:00Z' });
});
