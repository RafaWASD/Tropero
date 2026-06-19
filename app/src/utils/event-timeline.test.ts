// Tests de la lógica pura de la cronología (spec 02 C3.1, R10). Pura, sin RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTimelineRow,
  parseTimeline,
  collectCategoryIds,
  resolveCategoryNames,
  applyReproMeta,
  formatEventDate,
  isDateOnlyKind,
  humanizeReproEventType,
  humanizePregnancyStatus,
  humanizeServiceType,
  humanizePregnancyState,
  humanizeSanitaryEventType,
  humanizeSampleType,
  humanizeRoute,
  describeCategoryChange,
  deriveCurrentState,
  hasAbortion,
  scrotalRowsToTimelineItems,
  sortTimelineItems,
  describeScrotalTimeline,
  formatAgeMonthsAR,
  type TimelineRow,
  type TimelineItem,
  type PregnancyState,
  type ScrotalTimelineRow,
} from './event-timeline.ts';

// ─── Parseo por kind (los 7 orígenes de la RPC 0035) ─────────────────────────────────────

test('parseTimelineRow: weight', () => {
  const row: TimelineRow = {
    event_kind: 'weight',
    event_id: 'w1',
    event_date: '2025-03-15T10:00:00Z',
    created_at: '2025-03-15T10:05:00Z',
    payload: { weight_kg: 320.5, source: 'manual', notes: 'pesado en manga' },
  };
  const item = parseTimelineRow(row);
  assert.equal(item?.kind, 'weight');
  if (item?.kind === 'weight') {
    assert.equal(item.weightKg, 320.5);
    assert.equal(item.source, 'manual');
    assert.equal(item.notes, 'pesado en manga');
    assert.equal(item.eventId, 'w1');
    // createdAt viene de la RPC (0069) para TODOS los kinds → el parser lo copia a `base`.
    assert.equal(item.createdAt, '2025-03-15T10:05:00Z');
  }
});

test('parseTimelineRow: created_at ausente/vacío → createdAt null (defensivo)', () => {
  // RPC vieja / shape raro: sin created_at en la fila → createdAt null (el orden cae al eventId).
  const noField = parseTimelineRow({
    event_kind: 'weight',
    event_id: 'w-no',
    event_date: '2025-03-15T10:00:00Z',
    // sin created_at a propósito (cast para simular una fila incompleta sin romper el tipo).
    payload: { weight_kg: 300 },
  } as unknown as TimelineRow);
  assert.equal(noField?.createdAt, null);
  const empty = parseTimelineRow({
    event_kind: 'weight',
    event_id: 'w-empty',
    event_date: '2025-03-15T10:00:00Z',
    created_at: '',
    payload: { weight_kg: 300 },
  });
  assert.equal(empty?.createdAt, null);
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
    // spec 10 T-UI.8: created_by se proyecta en el read local (para gatear el borrado owner|autor).
    payload: { event_type: 'tacto', pregnancy_status: 'medium', calf_id: null, notes: null, created_by: 'user-7' },
  });
  assert.equal(item?.kind, 'reproductive');
  if (item?.kind === 'reproductive') {
    assert.equal(item.eventType, 'tacto');
    assert.equal(item.pregnancyStatus, 'medium');
    assert.equal(item.calfId, null);
    // service_type NO viene en la RPC 0035 → el parser lo deja null (lo completa applyServiceTypes).
    assert.equal(item.serviceType, null);
    assert.equal(item.createdBy, 'user-7'); // T-UI.8: autor del evento (gating del borrado)
  }
});

test('parseTimelineRow: reproductive SIN created_by (RPC online legacy) → createdBy null', () => {
  const item = parseTimelineRow({
    event_kind: 'reproductive',
    event_id: 'r2',
    event_date: '2025-02-01T00:00:00Z',
    payload: { event_type: 'weaning', pregnancy_status: null, calf_id: null, notes: null },
  });
  assert.equal(item?.kind, 'reproductive');
  if (item?.kind === 'reproductive') assert.equal(item.createdBy, null);
});

test('parseTimelineRow: sanitary', () => {
  const item = parseTimelineRow({
    event_kind: 'sanitary',
    event_id: 's1',
    event_date: '2025-01-10T00:00:00Z',
    payload: {
      event_type: 'vaccination',
      product_name: 'Aftosa',
      route: 'subcutaneous',
      notes: null,
      created_by: 'user-9',
    },
  });
  assert.equal(item?.kind, 'sanitary');
  if (item?.kind === 'sanitary') {
    assert.equal(item.eventType, 'vaccination');
    assert.equal(item.productName, 'Aftosa');
    assert.equal(item.route, 'subcutaneous');
    assert.equal(item.createdBy, 'user-9'); // T-UI.8: autor del evento (gating del borrado)
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

// ─── parseTimeline: ORDEN por (día calendario desc, createdAt desc, eventId desc) — EL BUG ─────────
// El bug que esto cierra: un evento TIPADO (date-only, vuelve 00:00 UTC) cargado HOY caía POR DEBAJO
// de los eventos del mismo día con hora real (category_change=changed_at, observacion=created_at). El
// fix ordena por DÍA calendario y, dentro del día, por created_at (instante real de inserción) desc.

// (a) MISMO día: un date-only (servicio, createdAt NUEVO) vs un timestamp (category_change, createdAt
//     VIEJO). El recién registrado (servicio) debe ir ARRIBA. Antes iba al fondo (00:00 < hora real).
test('parseTimeline (a): mismo día, date-only recién cargado va ARRIBA del timestamp viejo del mismo día', () => {
  // El servicio (date-only) llega como UTC-medianoche del día tipeado; el category_change (instante)
  // tiene la hora real. Ambos son del MISMO día calendario (15 may). created_at: el servicio se cargó
  // a las 18:30 (recién); el category_change (Alta) ocurrió a las 09:00. El servicio debe ganar.
  const rows: TimelineRow[] = [
    {
      event_kind: 'category_change',
      event_id: 'cat-alta',
      event_date: '2025-05-15T09:00:00Z', // instante real (changed_at)
      created_at: '2025-05-15T09:00:00Z',
      payload: { from: null, to: 'uuid-vaq', reason: 'initial' },
    },
    {
      event_kind: 'reproductive',
      event_id: 'svc-hoy',
      event_date: '2025-05-15T00:00:00Z', // date-only → UTC-medianoche (mismo día calendario)
      created_at: '2025-05-15T18:30:00Z', // cargado RECIÉN, después del alta
      payload: { event_type: 'service' },
    },
  ];
  const items = parseTimeline(rows);
  // El servicio (createdAt 18:30) va ARRIBA del category_change (createdAt 09:00) del MISMO día.
  assert.deepEqual(
    items.map((i) => i.eventId),
    ['svc-hoy', 'cat-alta'],
  );
});

// (b) BACKDATED: un date-only con fecha VIEJA pero createdAt NUEVO NO debe saltar al tope. Cae en SU
//     día (el orden por día manda); el createdAt solo desempata DENTRO del día.
test('parseTimeline (b): evento backdated (fecha vieja, createdAt nuevo) cae en SU día, NO al tope', () => {
  const rows: TimelineRow[] = [
    {
      event_kind: 'observacion',
      event_id: 'obs-hoy',
      event_date: '2025-06-10T12:00:00Z', // hoy (instante real)
      created_at: '2025-06-10T12:00:00Z',
      payload: { text: 'de hoy' },
    },
    {
      event_kind: 'weight',
      event_id: 'peso-backdated',
      event_date: '2025-03-01T00:00:00Z', // fecha VIEJA (1 mar) — date-only
      created_at: '2025-06-10T18:00:00Z', // pero cargado RECIÉN (hoy, más nuevo que la obs)
      payload: { weight_kg: 300 },
    },
  ];
  const items = parseTimeline(rows);
  // Aunque el peso tenga el createdAt MÁS NUEVO, su DÍA (1 mar) es más viejo → va ABAJO. No salta al
  // tope por haberse cargado recién. El día manda; createdAt solo ordena dentro del día.
  assert.deepEqual(
    items.map((i) => i.eventId),
    ['obs-hoy', 'peso-backdated'],
  );
});

// (c) ORDEN ENTRE DÍAS: el día más reciente arriba, sin importar el created_at.
test('parseTimeline (c): orden entre días — el día más reciente arriba (created_at irrelevante entre días)', () => {
  const rows: TimelineRow[] = [
    { event_kind: 'weight', event_id: 'd-feb', event_date: '2025-02-10T00:00:00Z', created_at: '2025-06-01T10:00:00Z', payload: { weight_kg: 280 } },
    { event_kind: 'weight', event_id: 'd-may', event_date: '2025-05-20T00:00:00Z', created_at: '2025-05-20T08:00:00Z', payload: { weight_kg: 320 } },
    { event_kind: 'weight', event_id: 'd-ene', event_date: '2025-01-05T00:00:00Z', created_at: '2025-01-05T08:00:00Z', payload: { weight_kg: 260 } },
  ];
  const items = parseTimeline(rows);
  // may > feb > ene por DÍA, aunque feb tenga el created_at más nuevo (jun): el día manda.
  assert.deepEqual(
    items.map((i) => i.eventId),
    ['d-may', 'd-feb', 'd-ene'],
  );
});

// (d) TZ-INDEPENDIENTE: el día de un date-only se toma de los componentes UTC (la fecha tipeada); el de
//     un instante real se toma del día LOCAL. Verificamos SIN mutar process.env.TZ (V8 cachea el huso →
//     mutarlo mid-proceso no es confiable, mismo criterio que los tests de formatEventDate): construimos
//     el instante "hoy" a partir de componentes LOCALES (toISOString) y el date-only con el MISMO día
//     calendario como literal UTC-medianoche. Así, sea cual sea el huso del runner, ambos caen en el
//     mismo día calendario y el orden lo decide el createdAt.
test('parseTimeline (d): TZ-independiente — date-only y timestamp del mismo día calendario se ordenan por createdAt', () => {
  // Instante real "hoy a las 09:00 LOCAL" del 12 jun 2025 (su día LOCAL es el 12, en cualquier huso).
  const localInstant = new Date(2025, 5, 12, 9, 0, 0); // 12 jun, 09:00 local
  const obsIso = localInstant.toISOString();
  // Un createdAt posterior al instante de la obs, también construido local (12 jun 20:00 local).
  const tactoCreated = new Date(2025, 5, 12, 20, 0, 0).toISOString();
  const rows: TimelineRow[] = [
    {
      event_kind: 'observacion',
      event_id: 'obs-manana',
      event_date: obsIso, // instante real → día LOCAL = 12 jun
      created_at: obsIso,
      payload: { text: 'de la mañana' },
    },
    {
      event_kind: 'reproductive',
      event_id: 'tacto-tarde',
      event_date: '2025-06-12T00:00:00+00:00', // date-only del 12 jun → día calendario (UTC) = 12 jun
      created_at: tactoCreated, // cargado por la tarde, después de la obs
      payload: { event_type: 'tacto', pregnancy_status: 'medium' },
    },
  ];
  const items = parseTimeline(rows);
  // Ambos son del MISMO día calendario (12 jun) en cualquier huso → se ordenan por createdAt: el tacto
  // (20:00) es posterior a la obs (09:00) → el tacto va ARRIBA. Si el día NO se computara consistente
  // (date-only por UTC, instante por local), caerían en días distintos y el orden cambiaría (el bug).
  assert.deepEqual(
    items.map((i) => i.eventId),
    ['tacto-tarde', 'obs-manana'],
  );
});

// Fecha inválida → se trata como el día MÁS VIEJO (cae al fondo) sin romper el orden del resto.
test('parseTimeline: eventDate inválido cae al fondo (no rompe el orden)', () => {
  const rows: TimelineRow[] = [
    { event_kind: 'weight', event_id: 'mal', event_date: 'no-es-fecha', created_at: '2025-06-01T10:00:00Z', payload: { weight_kg: 300 } },
    { event_kind: 'weight', event_id: 'bien', event_date: '2025-04-01T00:00:00Z', created_at: '2025-04-01T10:00:00Z', payload: { weight_kg: 310 } },
  ];
  const items = parseTimeline(rows);
  assert.deepEqual(
    items.map((i) => i.eventId),
    ['bien', 'mal'],
  );
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

// ─── applyReproMeta (enriquece SOLO service_type; createdAt viene de la RPC) ──────────────────

test('applyReproMeta: setea serviceType al item reproductive por eventId (NO toca createdAt)', () => {
  // createdAt viene de la FILA (RPC 0069); applyReproMeta solo agrega serviceType y lo PRESERVA.
  const items = parseTimeline([
    { event_kind: 'reproductive', event_id: 'r1', event_date: '2025-03-01T00:00:00Z', created_at: '2025-03-01T12:34:56Z', payload: { event_type: 'service' } },
  ]);
  const out = applyReproMeta(items, { r1: { serviceType: 'ai' } });
  const it = out[0];
  assert.equal(it.kind, 'reproductive');
  if (it.kind === 'reproductive') {
    assert.equal(it.serviceType, 'ai');
    // createdAt NO lo toca applyReproMeta: sigue siendo el de la fila.
    assert.equal(it.createdAt, '2025-03-01T12:34:56Z');
  }
});

test('applyReproMeta: serviceType no-enum → null (tolerante); createdAt de la fila intacto', () => {
  const items = parseTimeline([
    { event_kind: 'reproductive', event_id: 'r1', event_date: '2025-03-01T00:00:00Z', created_at: '2025-03-01T09:00:00Z', payload: { event_type: 'tacto', pregnancy_status: 'small' } },
  ]);
  // meta con serviceType basura → null. createdAt no se toca.
  const out = applyReproMeta(items, { r1: { serviceType: 'basura' } });
  const it = out[0];
  if (it.kind === 'reproductive') {
    assert.equal(it.serviceType, null);
    assert.equal(it.createdAt, '2025-03-01T09:00:00Z');
  }
});

test('applyReproMeta: id faltante en el mapa → serviceType null (createdAt de la fila intacto)', () => {
  const items = parseTimeline([
    { event_kind: 'reproductive', event_id: 'r1', event_date: '2025-03-01T00:00:00Z', created_at: '2025-03-01T07:00:00Z', payload: { event_type: 'tacto', pregnancy_status: 'medium' } },
  ]);
  const out = applyReproMeta(items, {}); // r1 ausente
  const it = out[0];
  if (it.kind === 'reproductive') {
    assert.equal(it.serviceType, null);
    assert.equal(it.createdAt, '2025-03-01T07:00:00Z');
  }
});

test('applyReproMeta: NO muta el input + deja intactos los NO reproductive', () => {
  const items = parseTimeline([
    { event_kind: 'reproductive', event_id: 'r1', event_date: '2025-03-01T00:00:00Z', created_at: '2025-03-01T08:00:00Z', payload: { event_type: 'service' } },
    { event_kind: 'weight', event_id: 'w1', event_date: '2025-02-01T00:00:00Z', created_at: '2025-02-01T08:00:00Z', payload: { weight_kg: 300 } },
  ]);
  const before = items.find((i) => i.eventId === 'r1')!;
  const out = applyReproMeta(items, { r1: { serviceType: 'natural' } });
  // el original sigue con serviceType null (no se mutó).
  if (before.kind === 'reproductive') {
    assert.equal(before.serviceType, null);
  }
  // el weight pasa intacto.
  const w = out.find((i) => i.eventId === 'w1')!;
  assert.equal(w.kind, 'weight');
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

test('humanizePregnancyStatus: B1 término de campo SOLO (Cabeza/Cuerpo/Cola)', () => {
  assert.equal(humanizePregnancyStatus('empty'), 'Vacía');
  assert.equal(humanizePregnancyStatus('small'), 'Cola');
  assert.equal(humanizePregnancyStatus('medium'), 'Cuerpo');
  assert.equal(humanizePregnancyStatus('large'), 'Cabeza');
  assert.equal(humanizePregnancyStatus(null), null);
  assert.equal(humanizePregnancyStatus('xx'), null);
});

test('humanizeServiceType: los 3 valores + null/desconocido', () => {
  assert.equal(humanizeServiceType('natural'), 'Monta natural');
  assert.equal(humanizeServiceType('ai'), 'Inseminación (IA)');
  assert.equal(humanizeServiceType('te'), 'Transferencia embrionaria (TE)');
  assert.equal(humanizeServiceType(null), null);
  assert.equal(humanizeServiceType(undefined), null);
  assert.equal(humanizeServiceType('xx'), null);
});

test('humanizePregnancyState: B1 "Preñada (cola/cuerpo/cabeza)" + Vacía + undefined', () => {
  const small: PregnancyState = { kind: 'pregnant', status: 'small', date: '2025-03-01T00:00:00Z' };
  const medium: PregnancyState = { kind: 'pregnant', status: 'medium', date: '2025-03-01T00:00:00Z' };
  const large: PregnancyState = { kind: 'pregnant', status: 'large', date: '2025-03-01T00:00:00Z' };
  const empty: PregnancyState = { kind: 'empty', date: '2025-03-01T00:00:00Z', via: 'tacto' };
  // La fila de estado lleva "Preñada (...)" con el término de campo, SIN palabra de tamaño.
  assert.equal(humanizePregnancyState(small), 'Preñada (cola)');
  assert.equal(humanizePregnancyState(medium), 'Preñada (cuerpo)');
  assert.equal(humanizePregnancyState(large), 'Preñada (cabeza)');
  assert.equal(humanizePregnancyState(empty), 'Vacía');
  assert.equal(humanizePregnancyState(undefined), null);
  // Ninguna lleva la palabra de tamaño (chica/media/grande).
  assert.doesNotMatch(humanizePregnancyState(small)!, /chica|media|grande/i);
  assert.doesNotMatch(humanizePregnancyState(large)!, /chica|media|grande/i);
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
  assert.equal(humanizeRoute('intranasal'), 'Intranasal'); // 0090: vacunas respiratorias vivas
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
// created_at default = event_date (la RPC 0069 lo trae top-level; en los tests de estado vigente, donde
// importa el orden dentro del día, se pasa explícito vía reproItemsWithCreatedAt).
function weightRow(id: string, date: string, kg: number | null): TimelineRow {
  return { event_kind: 'weight', event_id: id, event_date: date, created_at: date, payload: { weight_kg: kg } };
}
function scoreRow(id: string, date: string, score: number | null): TimelineRow {
  return { event_kind: 'condition_score', event_id: id, event_date: date, created_at: date, payload: { score } };
}
function reproRow(
  id: string,
  date: string,
  eventType: string,
  pregnancyStatus: string | null = null,
  createdAt: string = date,
): TimelineRow {
  return {
    event_kind: 'reproductive',
    event_id: id,
    event_date: date,
    created_at: createdAt,
    payload: { event_type: eventType, pregnancy_status: pregnancyStatus },
  };
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

// ─── deriveCurrentState: estado reproductivo (preñez) — C3.2a ──────────────────────────────

test('deriveCurrentState: preñez del último TACTO positivo (status medium)', () => {
  const items = parseTimeline([
    reproRow('t1', '2025-02-01T00:00:00Z', 'tacto', 'small'),
    reproRow('t2', '2025-04-01T00:00:00Z', 'tacto', 'medium'), // más reciente
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'pregnant',
    status: 'medium',
    date: '2025-04-01T00:00:00Z',
  });
});

test('deriveCurrentState: tacto EMPTY → vacía (via tacto)', () => {
  const items = parseTimeline([reproRow('t1', '2025-03-01T00:00:00Z', 'tacto', 'empty')]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'empty',
    via: 'tacto',
    date: '2025-03-01T00:00:00Z',
  });
});

test('deriveCurrentState: BIRTH posterior a un tacto positivo → vacía (via birth)', () => {
  // Tacto positivo en feb; parto en jun (más reciente) → ya no está preñada.
  const items = parseTimeline([
    reproRow('t1', '2025-02-01T00:00:00Z', 'tacto', 'large'),
    reproRow('b1', '2025-06-01T00:00:00Z', 'birth', null),
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'empty',
    via: 'birth',
    date: '2025-06-01T00:00:00Z',
  });
});

test('deriveCurrentState: ABORTION → vacía (via abortion)', () => {
  const items = parseTimeline([
    reproRow('t1', '2025-02-01T00:00:00Z', 'tacto', 'medium'),
    reproRow('ab1', '2025-05-01T00:00:00Z', 'abortion', null),
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'empty',
    via: 'abortion',
    date: '2025-05-01T00:00:00Z',
  });
});

test('deriveCurrentState: service/weaning/drying/rejection NO determinan preñez (se ignoran)', () => {
  // Un tacto positivo viejo + un servicio nuevo: el servicio NO cambia el estado → sigue preñada
  // por el tacto. (El servicio es un registro, no un diagnóstico de preñez.)
  const items = parseTimeline([
    reproRow('t1', '2025-02-01T00:00:00Z', 'tacto', 'small'),
    reproRow('sv1', '2025-09-01T00:00:00Z', 'service', null), // más reciente pero NO determina
    reproRow('we1', '2025-08-01T00:00:00Z', 'weaning', null),
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'pregnant',
    status: 'small',
    date: '2025-02-01T00:00:00Z',
  });
});

test('deriveCurrentState: sin eventos reproductivos determinantes → pregnancy ausente', () => {
  const items = parseTimeline([
    weightRow('w1', '2025-03-01T00:00:00Z', 300),
    reproRow('sv1', '2025-04-01T00:00:00Z', 'service', null), // solo un servicio: no determina
  ]);
  assert.equal(deriveCurrentState(items).pregnancy, undefined);
});

test('deriveCurrentState: tacto con status null/desconocido → pregnancy ausente (no a ciegas)', () => {
  const items = parseTimeline([reproRow('t1', '2025-03-01T00:00:00Z', 'tacto', null)]);
  assert.equal(deriveCurrentState(items).pregnancy, undefined);
});

test('deriveCurrentState: empate de fecha entre repro determinantes → desempata por eventId mayor', () => {
  const items = parseTimeline([
    reproRow('t-aaa', '2025-03-01T00:00:00Z', 'tacto', 'small'),
    reproRow('t-zzz', '2025-03-01T00:00:00Z', 'tacto', 'empty'), // misma fecha, id mayor → gana
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'empty',
    via: 'tacto',
    date: '2025-03-01T00:00:00Z',
  });
});

// ─── deriveCurrentState: desempate por orden de inserción (seq) en eventos repro del MISMO día (TAREA 2) ─
// El bug que esto cierra: tacto y parto/aborto el mismo eventDate (columna `date`, sin hora). El eventId
// es un UUID random → desempatar por él era ~50/50. El parto/aborto cargado DESPUÉS del tacto el mismo día
// SIEMPRE debe ganar (parió/abortó → ya no está preñada). El desempate es por `seq` (orden de inserción
// local = orden de lectura del SQL), que es fiel al server (sella created_at = now() en orden de subida =
// inserción) y robusto al mix de created_at NULL (CRUD-plano sin sellar) / cliente (overlay) / server. En
// TODOS estos tests el eventId del tacto es MAYOR que el del birth/aborto (t-zzz > b-aaa): si decidiera el
// eventId ganaría el tacto (el bug); con seq gana el insertado después.

/**
 * Arma items repro con created_at via el path real: la RPC 0069 trae created_at en la FILA → parseTimeline
 * lo lee en `base`. Un createdAt null se modela con una fila SIN created_at (string vacío) → parser → null.
 *
 * `seq` (TAREA 2): emula FIELMENTE lo que hace fetchTimeline = índice de fila tras el ORDER BY del SQL
 * `buildTimelineQuery`: `event_date ASC, (created_at IS NULL) ASC, created_at ASC` (created_at presentes
 * ascendentes; NULL al FINAL = recién insertado = más reciente; empate de created_at → orden de inserción
 * = el orden de `specs`). Calculamos ese orden acá y asignamos `seq` = posición resultante. Así el `specs`
 * representa el ORDEN DE INSERCIÓN local (su orden), y el `seq` el orden de lectura del SQL (lo que decide).
 */
function reproItemsWithCreatedAt(
  specs: { id: string; date: string; type: string; preg?: string | null; createdAt: string | null }[],
) {
  // Orden del SQL: event_date ASC, NULL-created_at al final, created_at ASC, y a igualdad el orden de
  // inserción (índice original en specs). Sort ESTABLE (Array.prototype.sort lo es en Node).
  const withIdx = specs.map((s, i) => ({ s, i }));
  withIdx.sort((a, b) => {
    if (a.s.date !== b.s.date) return a.s.date < b.s.date ? -1 : 1; // event_date ASC
    const aNull = a.s.createdAt === null;
    const bNull = b.s.createdAt === null;
    if (aNull !== bNull) return aNull ? 1 : -1; // NULL al final
    if (!aNull && !bNull && a.s.createdAt !== b.s.createdAt) {
      return a.s.createdAt! < b.s.createdAt! ? -1 : 1; // created_at ASC
    }
    return a.i - b.i; // empate → orden de inserción (estable)
  });
  // seqById: posición de cada spec en el orden del SQL = su seq.
  const seqById = new Map<string, number>();
  withIdx.forEach((w, pos) => seqById.set(w.s.id, pos));
  const rows: TimelineRow[] = specs.map((s) => ({
    ...reproRow(s.id, s.date, s.type, s.preg ?? null, s.createdAt ?? ''),
    seq: seqById.get(s.id)!,
  }));
  return parseTimeline(rows);
}

test('deriveCurrentState: tacto y BIRTH mismo día, created_at del birth posterior → vacía (gana birth)', () => {
  const day = '2025-06-01T00:00:00Z'; // mismo eventDate (columna date, sin hora)
  // eventId del tacto MAYOR que el del birth a propósito: si decidiera el eventId, ganaría el tacto y
  // veríamos "preñada" (el bug). Con created_at el birth (insertado después) gana → "vacía".
  const a = reproItemsWithCreatedAt([
    { id: 't-zzz', date: day, type: 'tacto', preg: 'large', createdAt: '2025-06-01T10:00:00Z' },
    { id: 'b-aaa', date: day, type: 'birth', createdAt: '2025-06-01T10:05:00Z' }, // posterior
  ]);
  assert.deepEqual(deriveCurrentState(a).pregnancy, { kind: 'empty', via: 'birth', date: day });
  // …y DETERMINÍSTICO sin importar el orden de entrada: invertimos y debe dar lo mismo.
  const b = reproItemsWithCreatedAt([
    { id: 'b-aaa', date: day, type: 'birth', createdAt: '2025-06-01T10:05:00Z' },
    { id: 't-zzz', date: day, type: 'tacto', preg: 'large', createdAt: '2025-06-01T10:00:00Z' },
  ]);
  assert.deepEqual(deriveCurrentState(b).pregnancy, { kind: 'empty', via: 'birth', date: day });
});

test('deriveCurrentState: tacto y ABORTION mismo día, created_at del aborto posterior → vacía (gana aborto)', () => {
  const day = '2025-05-10T00:00:00Z';
  const items = reproItemsWithCreatedAt([
    { id: 't-zzz', date: day, type: 'tacto', preg: 'medium', createdAt: '2025-05-10T09:00:00Z' },
    { id: 'ab-aaa', date: day, type: 'abortion', createdAt: '2025-05-10T09:30:00Z' }, // posterior
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, { kind: 'empty', via: 'abortion', date: day });
});

// ── TAREA 2: los 3 casos a igualdad de event_date (espejo de RC6.1.4 de animal-category.test.ts) ──
// El bug original: con created_at NULL/parcial el desempate caía al eventId UUID random (~50/50). Ahora
// es DETERMINÍSTICO por `seq` (orden de inserción local = proxy fiel de quién quedará posterior server-
// side). En TODOS estos tests el eventId del TACTO es lexicográficamente MAYOR que el del birth/aborto
// (t-zzz > b-aaa): si decidiera el eventId, ganaría el tacto (el bug); con seq gana el insertado después.

// CASO 1 — ambos created_at PRESENTES y distintos → gana el mayor (orden total ya sellado). (Cubierto
// también por los tests de arriba; lo repetimos explícito para la matriz de los 3 casos.)
test('deriveCurrentState (TAREA 2, caso 1): ambos created_at presentes → gana el MAYOR (birth posterior → vacía)', () => {
  const day = '2025-06-01T00:00:00Z';
  const items = reproItemsWithCreatedAt([
    { id: 't-zzz', date: day, type: 'tacto', preg: 'small', createdAt: '2025-06-01T10:00:00Z' },
    { id: 'b-aaa', date: day, type: 'birth', createdAt: '2025-06-01T10:05:00Z' }, // created_at posterior
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, { kind: 'empty', via: 'birth', date: day });
});

// CASO 2 — created_at en UNO solo. El caso REALISTA del e2e: el PARTO/ABORTO recién cargado (created_at aún
// NULL local, el trigger lo sella al SUBIR) + el tacto ya sincronizado (created_at PRESENTE) del mismo día.
// El SQL ordena los NULL al FINAL → el parto/aborto (null) queda con seq MAYOR = insertado después → GANA →
// "Vacía" (parió/abortó ⇒ ya no está preñada). Antes caía al eventId random (~50/50, el bug del e2e).
test('deriveCurrentState (TAREA 2, caso 2): birth recién cargado (created_at null) + tacto synced (presente) → gana el null (vacía)', () => {
  const day = '2025-06-01T00:00:00Z';
  const items = reproItemsWithCreatedAt([
    { id: 't-zzz', date: day, type: 'tacto', preg: 'medium', createdAt: '2025-06-01T10:00:00Z' }, // ya synced
    { id: 'b-aaa', date: day, type: 'birth', createdAt: null }, // recién cargado, sin sellar → MÁS RECIENTE
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, { kind: 'empty', via: 'birth', date: day });
});

// CASO 2 — DETERMINÍSTICO sin importar el orden de entrada (invertimos las filas → mismo resultado). El
// eventId del tacto es MAYOR (t-zzz > b-aaa): si decidiera el eventId ganaría el tacto ("preñada", el bug).
test('deriveCurrentState (TAREA 2, caso 2 invertido): mismo resultado sin importar el orden de entrada', () => {
  const day = '2025-06-01T00:00:00Z';
  const items = reproItemsWithCreatedAt([
    { id: 'b-aaa', date: day, type: 'birth', createdAt: null },
    { id: 't-zzz', date: day, type: 'tacto', preg: 'medium', createdAt: '2025-06-01T10:00:00Z' },
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, { kind: 'empty', via: 'birth', date: day });
});

// CASO 2 SIMÉTRICO — aborto recién cargado (null) sobre una hembra con tacto+ ya synced del mismo día →
// el aborto (null, seq al final = insertado después) revierte → "Vacía". Espeja el 2do test "one null" de RC6.1.4.
test('deriveCurrentState (TAREA 2, caso 2 simétrico): aborto recién cargado (null) + tacto+ synced → gana el aborto (vacía)', () => {
  const day = '2025-06-01T00:00:00Z';
  const items = reproItemsWithCreatedAt([
    { id: 't-zzz', date: day, type: 'tacto', preg: 'large', createdAt: '2025-06-01T09:00:00Z' },
    { id: 'ab-a', date: day, type: 'abortion', createdAt: null },
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, { kind: 'empty', via: 'abortion', date: day });
});

// CASO 3 — ambos created_at NULL (los dos CRUD plano offline aún sin sellar). created_at no decide →
// desempata `seq` = orden de inserción local. El parto, insertado DESPUÉS del tacto, GANA → vacía. Antes
// caía al eventId UUID random (~50/50 → el flake). Es el caso REALISTA del backlog.
test('deriveCurrentState (TAREA 2, caso 3): AMBOS null → gana el INSERTADO DESPUÉS (parto → vacía)', () => {
  const day = '2025-06-01T00:00:00Z';
  // Orden de inserción: tacto PRIMERO (seq 0), birth DESPUÉS (seq 1) → birth gana.
  const items = reproItemsWithCreatedAt([
    { id: 't-zzz', date: day, type: 'tacto', preg: 'small', createdAt: null },
    { id: 'b-aaa', date: day, type: 'birth', createdAt: null },
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, { kind: 'empty', via: 'birth', date: day });
});

// CASO 3 SIMÉTRICO — el orden de inserción inverso (aborto y LUEGO un tacto+ re-servicio el mismo día,
// ambos sin sellar): el tacto (insertado después, seq mayor) GANA → preñada. Prueba que es el seq (orden
// de inserción), NO una preferencia hardcodeada por birth/aborto, lo que decide. Espeja el simétrico de
// RC6.1.4 de animal-category.test.ts.
test('deriveCurrentState (TAREA 2, caso 3 simétrico): AMBOS null, tacto insertado DESPUÉS del aborto → gana el tacto (preñada)', () => {
  const day = '2025-06-01T00:00:00Z';
  // Orden de inserción: aborto PRIMERO (seq 0), tacto+ DESPUÉS (seq 1) → el tacto gana.
  const items = reproItemsWithCreatedAt([
    { id: 'ab-aaa', date: day, type: 'abortion', createdAt: null },
    { id: 't-zzz', date: day, type: 'tacto', preg: 'medium', createdAt: null },
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'pregnant',
    status: 'medium',
    date: day,
  });
});

// Fallback: SIN seq en las filas (RPC que no lo aporta / shape legado) y ambos created_at NULL → cae al
// desempate estable por eventId (comportamiento previo, no rompe; determinístico aunque no resuelve el
// caso ambiguo del mismo día). Construimos los items SIN seq a mano (no via reproItemsWithCreatedAt).
test('deriveCurrentState (TAREA 2): sin seq y ambos created_at null → fallback estable por eventId', () => {
  const day = '2025-06-01T00:00:00Z';
  const items: TimelineItem[] = [
    { kind: 'reproductive', eventId: 't-zzz', eventDate: day, createdAt: null, eventType: 'tacto', pregnancyStatus: 'small', calfId: null, serviceType: null, notes: null },
    { kind: 'reproductive', eventId: 'b-aaa', eventDate: day, createdAt: null, eventType: 'birth', pregnancyStatus: null, calfId: null, serviceType: null, notes: null },
  ];
  // Sin seq: eventId mayor (t-zzz) gana → preñada (el fallback documentado).
  assert.deepEqual(deriveCurrentState(items).pregnancy, { kind: 'pregnant', status: 'small', date: day });
});

test('deriveCurrentState: created_at NO afecta cuando los eventDate DIFIEREN (la fecha manda)', () => {
  // Fecha distinta: aunque el tacto tenga created_at posterior al birth, el birth es de un día MAYOR
  // → el birth gana por eventDate. created_at solo desempata el mismo día.
  const items = reproItemsWithCreatedAt([
    { id: 't1', date: '2025-02-01T00:00:00Z', type: 'tacto', preg: 'large', createdAt: '2025-06-02T10:00:00Z' },
    { id: 'b1', date: '2025-06-01T00:00:00Z', type: 'birth', createdAt: '2025-06-01T08:00:00Z' },
  ]);
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'empty',
    via: 'birth',
    date: '2025-06-01T00:00:00Z',
  });
});

test('deriveCurrentState: preñez NO rompe weight/conditionScore (los tres conviven)', () => {
  const items = parseTimeline([
    weightRow('w1', '2025-03-01T00:00:00Z', 330),
    scoreRow('s1', '2025-04-10T00:00:00Z', 3.5),
    reproRow('t1', '2025-05-01T00:00:00Z', 'tacto', 'large'),
  ]);
  const state = deriveCurrentState(items);
  assert.deepEqual(state.weight, { kg: 330, date: '2025-03-01T00:00:00Z' });
  assert.deepEqual(state.conditionScore, { score: 3.5, date: '2025-04-10T00:00:00Z' });
  assert.deepEqual(state.pregnancy, { kind: 'pregnant', status: 'large', date: '2025-05-01T00:00:00Z' });
});

// ─── hasAbortion (flag "tuvo aborto" derivado del timeline — A2) ────────────────────────────

test('hasAbortion: hay un evento abortion → true', () => {
  const items = parseTimeline([
    reproRow('t1', '2025-02-01T00:00:00Z', 'tacto', 'medium'),
    reproRow('ab1', '2025-05-01T00:00:00Z', 'abortion', null),
  ]);
  assert.equal(hasAbortion(items), true);
});

test('hasAbortion: NO hay aborto (solo tacto/servicio/parto) → false', () => {
  const items = parseTimeline([
    reproRow('t1', '2025-02-01T00:00:00Z', 'tacto', 'medium'),
    reproRow('sv1', '2025-03-01T00:00:00Z', 'service', null),
    reproRow('b1', '2025-09-01T00:00:00Z', 'birth', null),
    weightRow('w1', '2025-04-01T00:00:00Z', 300),
  ]);
  assert.equal(hasAbortion(items), false);
});

test('hasAbortion: timeline vacío / null / undefined → false', () => {
  assert.equal(hasAbortion([]), false);
  assert.equal(hasAbortion(null), false);
  assert.equal(hasAbortion(undefined), false);
});

test('hasAbortion: PERMANENTE — un aborto seguido de una preñez posterior sigue marcando true', () => {
  // Aborta, luego vuelve a preñarse (tacto positivo posterior): el flag NO se limpia (es historia).
  const items = parseTimeline([
    reproRow('ab1', '2025-03-01T00:00:00Z', 'abortion', null),
    reproRow('t2', '2025-08-01T00:00:00Z', 'tacto', 'large'), // preñada de nuevo, más reciente
  ]);
  assert.equal(hasAbortion(items), true);
  // …y el estado vigente SÍ es la preñez nueva (deriveCurrentState toma el más reciente): el flag y el
  // estado son señales independientes (uno es historia permanente, el otro el estado actual).
  assert.deepEqual(deriveCurrentState(items).pregnancy, {
    kind: 'pregnant',
    status: 'large',
    date: '2025-08-01T00:00:00Z',
  });
});

test('hasAbortion: ignora un kind no-reproductive con eventType "abortion" espurio (defensivo)', () => {
  // Solo cuentan los reproductive con eventType abortion. Una observación no aporta (no tiene esa forma).
  const items = parseTimeline([
    { event_kind: 'observacion', event_id: 'o1', event_date: '2025-01-01T00:00:00Z', payload: { text: 'aborto?' } },
  ]);
  assert.equal(hasAbortion(items), false);
});

// ─── Circunferencia escrotal (spec 03 M6, R14.14): composición en el cliente del riel ─────

test('scrotal: es date-only (measured_at es columna date, sin hora)', () => {
  assert.equal(isDateOnlyKind('scrotal'), true);
});

test('formatAgeMonthsAR: es-AR, singular/plural, null → null, no snapea', () => {
  assert.equal(formatAgeMonthsAR(24), '24 meses');
  assert.equal(formatAgeMonthsAR(1), '1 mes');
  assert.equal(formatAgeMonthsAR(null), null);
  assert.equal(formatAgeMonthsAR(undefined), null);
  // NO clampa al rango de la rueda de meses (snapshot histórico): un 200 se muestra tal cual redondeado.
  assert.equal(formatAgeMonthsAR(200), '200 meses');
  assert.equal(formatAgeMonthsAR(26.4), '26 meses'); // redondea
});

test('describeScrotalTimeline: "36,5 cm · 24 meses"; edad null → solo cm', () => {
  assert.equal(describeScrotalTimeline({ circumferenceCm: 36.5, ageMonths: 24 }), '36,5 cm · 24 meses');
  assert.equal(describeScrotalTimeline({ circumferenceCm: 38, ageMonths: null }), '38 cm');
  assert.equal(describeScrotalTimeline({ circumferenceCm: 36.5, ageMonths: 1 }), '36,5 cm · 1 mes');
});

test('scrotalRowsToTimelineItems: mapea filas a TimelineItem kind scrotal; eventId=id, eventDate=measuredAt', () => {
  const rows: ScrotalTimelineRow[] = [
    { id: 'ce1', circumferenceCm: 34, ageMonths: 18, measuredAt: '2025-03-01', createdAt: '2025-03-01T10:00:00Z' },
    { id: 'ce2', circumferenceCm: 37.5, ageMonths: 24, measuredAt: '2025-09-01', createdAt: null },
  ];
  const items = scrotalRowsToTimelineItems(rows);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    kind: 'scrotal',
    eventId: 'ce1',
    eventDate: '2025-03-01',
    createdAt: '2025-03-01T10:00:00Z',
    circumferenceCm: 34,
    ageMonths: 18,
  });
  assert.equal(items[1].kind, 'scrotal');
  if (items[1].kind === 'scrotal') {
    assert.equal(items[1].ageMonths, 24);
    assert.equal(items[1].createdAt, null);
  }
});

test('scrotalRowsToTimelineItems: null/[] → []; descarta fila sin measuredAt (defensivo)', () => {
  assert.deepEqual(scrotalRowsToTimelineItems(null), []);
  assert.deepEqual(scrotalRowsToTimelineItems([]), []);
  const items = scrotalRowsToTimelineItems([
    { id: 'bad', circumferenceCm: 30, ageMonths: null, measuredAt: '', createdAt: null },
    { id: 'ok', circumferenceCm: 35, ageMonths: null, measuredAt: '2025-01-01', createdAt: null },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].eventId, 'ok');
});

test('sortTimelineItems: mergea la CE compuesta con el riel del server y re-ordena (día desc)', () => {
  // Riel del server (un pesaje 2025-06) + dos CE compuestas en cliente (2025-03 y 2025-09). El merge
  // re-ordena por DÍA calendario descendente → CE-sep arriba, pesaje-jun medio, CE-mar abajo.
  const serverItems = parseTimeline([
    { event_kind: 'weight', event_id: 'w1', event_date: '2025-06-01T00:00:00Z', payload: { weight_kg: 400 } },
  ]);
  const scrotal = scrotalRowsToTimelineItems([
    { id: 'ce-mar', circumferenceCm: 34, ageMonths: 18, measuredAt: '2025-03-01', createdAt: null },
    { id: 'ce-sep', circumferenceCm: 38, ageMonths: 24, measuredAt: '2025-09-01', createdAt: null },
  ]);
  const merged = sortTimelineItems([...serverItems, ...scrotal]);
  assert.deepEqual(
    merged.map((i) => i.eventId),
    ['ce-sep', 'w1', 'ce-mar'],
  );
});

test('sortTimelineItems: no muta el array de entrada', () => {
  const a = scrotalRowsToTimelineItems([
    { id: 'a', circumferenceCm: 30, ageMonths: null, measuredAt: '2025-01-01', createdAt: null },
    { id: 'b', circumferenceCm: 31, ageMonths: null, measuredAt: '2025-02-01', createdAt: null },
  ]);
  const before = a.map((i) => i.eventId);
  sortTimelineItems(a);
  assert.deepEqual(a.map((i) => i.eventId), before); // la entrada quedó igual (sort copia)
});

test('deriveCurrentState: ignora la CE (no es peso/condición/preñez) — no rompe', () => {
  const items = sortTimelineItems(
    scrotalRowsToTimelineItems([
      { id: 'ce1', circumferenceCm: 36, ageMonths: 24, measuredAt: '2025-09-01', createdAt: null },
    ]),
  );
  // La CE no aporta weight/conditionScore/pregnancy → estado vacío (no la confunde con un peso).
  assert.deepEqual(deriveCurrentState(items), {});
});
