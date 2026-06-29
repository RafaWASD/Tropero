// Tests de la lógica PURA del estado reproductivo vigente (delta spec 02 "aptitud reproductiva", RAR.2/RAR.6).
// node:test (mismo patrón que animal-category.test.ts / event-timeline.test.ts).
// Foco: matriz de la precedencia single-slot RAR.2.4 + edge cases RAR.7.4–7.6 + isReproApt con el fallback de
// edad (RAR.6, decisión de Raf en Puerta 1) + reproStatusLabel (RAR.3.4) + ageInDaysFromBirthDate.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ageInDaysFromBirthDate,
  deriveReproAptitude,
  deriveReproStatus,
  isReproApt,
  reproStatusLabel,
  PROVEN_FEMALE_CATEGORY_CODES,
  SERVICE_AGE_THRESHOLD_DAYS,
  type ReproEventInput,
  type ReproStatus,
} from './repro-status.ts';

// ─── Factory de eventos crudos (todos los campos; el SQL los proyecta) ─────────────────────────

function ev(partial: Partial<ReproEventInput> & { eventType: string; eventDate: string }): ReproEventInput {
  return {
    createdAt: null,
    pregnancyStatus: null,
    heiferFitness: null,
    serviceType: null,
    ...partial,
  };
}

const tactoVaq = (date: string, fitness: ReproEventInput['heiferFitness'], createdAt: string | null = null) =>
  ev({ eventType: 'tacto_vaquillona', eventDate: date, heiferFitness: fitness, createdAt });
const tacto = (date: string, status: string | null, createdAt: string | null = null) =>
  ev({ eventType: 'tacto', eventDate: date, pregnancyStatus: status, createdAt });
const service = (date: string, createdAt: string | null = null) =>
  ev({ eventType: 'service', eventDate: date, serviceType: 'natural', createdAt });
const birth = (date: string, createdAt: string | null = null) =>
  ev({ eventType: 'birth', eventDate: date, createdAt });

// ════════════════════════════════════════════════════════════════════════════════════════════
// deriveReproAptitude (RAR.2.1)
// ════════════════════════════════════════════════════════════════════════════════════════════

test('deriveReproAptitude: sin eventos → null (sin veredicto)', () => {
  assert.equal(deriveReproAptitude([]), null);
});

test('deriveReproAptitude: un solo tacto_vaquillona → su heifer_fitness', () => {
  assert.equal(deriveReproAptitude([tactoVaq('2026-03-01', 'apta')]), 'apta');
  assert.equal(deriveReproAptitude([tactoVaq('2026-03-01', 'no_apta')]), 'no_apta');
  assert.equal(deriveReproAptitude([tactoVaq('2026-03-01', 'diferida')]), 'diferida');
});

test('deriveReproAptitude: ignora eventos que NO son tacto_vaquillona', () => {
  assert.equal(deriveReproAptitude([tacto('2026-03-01', 'large'), service('2026-02-01'), birth('2026-01-01')]), null);
});

test('deriveReproAptitude: elige el ÚLTIMO por event_date (mayor gana)', () => {
  const events = [tactoVaq('2026-01-01', 'no_apta'), tactoVaq('2026-05-01', 'apta')];
  assert.equal(deriveReproAptitude(events), 'apta');
  // orden de entrada inverso → mismo resultado (no asume orden)
  assert.equal(deriveReproAptitude([...events].reverse()), 'apta');
});

test('deriveReproAptitude: mismo event_date, created_at null-as-newest (RC6.1.4)', () => {
  // El de created_at null (recién insertado local) GANA al de created_at presente, a igual event_date.
  const events = [
    tactoVaq('2026-05-01', 'no_apta', '2026-05-01T10:00:00Z'),
    tactoVaq('2026-05-01', 'apta', null),
  ];
  assert.equal(deriveReproAptitude(events), 'apta');
});

test('deriveReproAptitude: mismo event_date, ambos null → desempata el índice (insertado después gana)', () => {
  const events = [tactoVaq('2026-05-01', 'no_apta', null), tactoVaq('2026-05-01', 'apta', null)];
  assert.equal(deriveReproAptitude(events), 'apta'); // el segundo (índice mayor) gana
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// deriveReproStatus — matriz de precedencia RAR.2.4
// ════════════════════════════════════════════════════════════════════════════════════════════

test('RAR.2.4.1: macho → none (no aplica, sin badge)', () => {
  assert.deepEqual(deriveReproStatus({ sex: 'male', categoryCode: 'toro', isCut: false, events: [] }), {
    kind: 'none',
  });
});

test('RAR.2.4.1: ternera (hembra) → none', () => {
  assert.deepEqual(deriveReproStatus({ sex: 'female', categoryCode: 'ternera', isCut: false, events: [] }), {
    kind: 'none',
  });
});

test('RAR.2.4.1: sexo desconocido (null) → none', () => {
  assert.deepEqual(deriveReproStatus({ sex: null, categoryCode: 'vaquillona', isCut: false, events: [] }), {
    kind: 'none',
  });
});

test('RAR.2.4.2: CUT → cut ("No apta") — gana a la preñez y a la aptitud', () => {
  // CUT precede a TODO (RAR.2.4.2): aunque tenga tacto+ y veredicto apta, el badge es "No apta" por CUT.
  const status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'cut',
    isCut: true,
    events: [tacto('2026-05-01', 'large'), tactoVaq('2026-04-01', 'apta')],
  });
  assert.deepEqual(status, { kind: 'cut' });
});

test('RAR.2.4.3: tacto+ (large) → pregnant', () => {
  const status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'vaquillona_prenada',
    isCut: false,
    events: [tacto('2026-05-01', 'large')],
  });
  assert.deepEqual(status, { kind: 'pregnant', status: 'large' });
});

test('RAR.2.4.3: tacto empty → empty (vacía)', () => {
  const status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'multipara',
    isCut: false,
    events: [tacto('2026-05-01', 'empty')],
  });
  assert.deepEqual(status, { kind: 'empty' });
});

test('RAR.2.4.3: birth → empty (parió, ya no está preñada) — preñez gana a la categoría probada', () => {
  // multipara (probada) PERO con un parto reciente → "Vacía" (preñez determinada precede a served_untested).
  const status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'multipara',
    isCut: false,
    events: [birth('2026-05-01')],
  });
  assert.deepEqual(status, { kind: 'empty' });
});

test('RAR.2.4.4: categoría probada sin preñez → served_untested ("Servida sin tacto")', () => {
  for (const code of PROVEN_FEMALE_CATEGORY_CODES) {
    const status = deriveReproStatus({ sex: 'female', categoryCode: code, isCut: false, events: [] });
    assert.deepEqual(status, { kind: 'served_untested' }, `${code} probada → served_untested`);
  }
});

test('RAR.2.4.4: vaquillona con evento service (sin tacto aún) → served_untested', () => {
  const status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'vaquillona',
    isCut: false,
    events: [service('2026-05-01'), tactoVaq('2026-04-01', 'apta')],
  });
  assert.deepEqual(status, { kind: 'served_untested' });
});

test('RAR.2.4.5: vaquillona con veredicto apta/diferida/no_apta → fitness', () => {
  const base = { sex: 'female' as const, categoryCode: 'vaquillona', isCut: false };
  assert.deepEqual(deriveReproStatus({ ...base, events: [tactoVaq('2026-04-01', 'apta')] }), {
    kind: 'fitness',
    fitness: 'apta',
  });
  assert.deepEqual(deriveReproStatus({ ...base, events: [tactoVaq('2026-04-01', 'diferida')] }), {
    kind: 'fitness',
    fitness: 'diferida',
  });
  assert.deepEqual(deriveReproStatus({ ...base, events: [tactoVaq('2026-04-01', 'no_apta')] }), {
    kind: 'fitness',
    fitness: 'no_apta',
  });
});

test('RAR.2.4.6: vaquillona sin preñez, sin servicio, sin veredicto → unknown ("Sin evaluar")', () => {
  assert.deepEqual(deriveReproStatus({ sex: 'female', categoryCode: 'vaquillona', isCut: false, events: [] }), {
    kind: 'unknown',
  });
});

// ─── Edge cases RAR.7.4–7.6 ────────────────────────────────────────────────────────────────

test('RAR.7.4: apta → servida → vacía en UN solo slot (secuencial)', () => {
  // (1) solo el veredicto apta → "Apta"
  let status: ReproStatus = deriveReproStatus({
    sex: 'female',
    categoryCode: 'vaquillona',
    isCut: false,
    events: [tactoVaq('2026-03-01', 'apta')],
  });
  assert.deepEqual(status, { kind: 'fitness', fitness: 'apta' });

  // (2) + servicio (post-servicio, sin tacto) → "Servida sin tacto"
  status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'vaquillona',
    isCut: false,
    events: [tactoVaq('2026-03-01', 'apta'), service('2026-04-01')],
  });
  assert.deepEqual(status, { kind: 'served_untested' });

  // (3) + tacto vacía (post-tacto) → "Vacía"
  status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'vaquillona',
    isCut: false,
    events: [tactoVaq('2026-03-01', 'apta'), service('2026-04-01'), tacto('2026-06-01', 'empty')],
  });
  assert.deepEqual(status, { kind: 'empty' });
});

test('RAR.7.5: no_apta NO implica CUT (ejes distintos) — isCut=false → fitness no_apta, NO cut', () => {
  const status = deriveReproStatus({
    sex: 'female',
    categoryCode: 'vaquillona',
    isCut: false,
    events: [tactoVaq('2026-04-01', 'no_apta')],
  });
  assert.deepEqual(status, { kind: 'fitness', fitness: 'no_apta' });
  assert.notEqual(status.kind, 'cut');
});

test('RAR.7.6: un-CUT (isCut=false) → vuelve a reflejar el estado derivado vigente', () => {
  // Mismo set de eventos: con isCut=true → cut; con isCut=false → el derivado (acá, apta).
  const events = [tactoVaq('2026-04-01', 'apta')];
  assert.deepEqual(deriveReproStatus({ sex: 'female', categoryCode: 'cut', isCut: true, events }), { kind: 'cut' });
  assert.deepEqual(deriveReproStatus({ sex: 'female', categoryCode: 'vaquillona', isCut: false, events }), {
    kind: 'fitness',
    fitness: 'apta',
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// reproStatusLabel (RAR.3.4)
// ════════════════════════════════════════════════════════════════════════════════════════════

test('reproStatusLabel: etiquetas es-AR de cada estado', () => {
  assert.equal(reproStatusLabel({ kind: 'none' }), null);
  assert.equal(reproStatusLabel({ kind: 'cut' }), 'No apta');
  assert.equal(reproStatusLabel({ kind: 'pregnant', status: 'large' }), 'Preñada');
  assert.equal(reproStatusLabel({ kind: 'empty' }), 'Vacía');
  assert.equal(reproStatusLabel({ kind: 'served_untested' }), 'Servida sin tacto');
  assert.equal(reproStatusLabel({ kind: 'fitness', fitness: 'apta' }), 'Apta');
  assert.equal(reproStatusLabel({ kind: 'fitness', fitness: 'diferida' }), 'Diferida');
  assert.equal(reproStatusLabel({ kind: 'fitness', fitness: 'no_apta' }), 'No apta');
  assert.equal(reproStatusLabel({ kind: 'unknown' }), 'Sin evaluar');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// isReproApt (RAR.6) — inseminación con FALLBACK DE EDAD (decisión de Raf en Puerta 1)
// ════════════════════════════════════════════════════════════════════════════════════════════

test('RAR.6.2: categoría probada → apta (sin gate)', () => {
  for (const code of PROVEN_FEMALE_CATEGORY_CODES) {
    assert.equal(isReproApt({ sex: 'female', categoryCode: code, aptitude: null, ageDays: 0 }), true, code);
  }
});

test('RAR.6.2: vaquillona con veredicto apta → true', () => {
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: 'apta', ageDays: 0 }), true);
});

test('RAR.6.3: macho → false (cierra #1b: no inseminar machos)', () => {
  assert.equal(isReproApt({ sex: 'male', categoryCode: 'toro', aptitude: null, ageDays: 9999 }), false);
});

test('RAR.6.3: sexo desconocido (null) → false', () => {
  assert.equal(isReproApt({ sex: null, categoryCode: 'vaquillona', aptitude: 'apta', ageDays: 9999 }), false);
});

test('RAR.6.4: ternera → false', () => {
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'ternera', aptitude: null, ageDays: 9999 }), false);
});

test('RAR.6.5: vaquillona no_apta / diferida → false', () => {
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: 'no_apta', ageDays: 9999 }), false);
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: 'diferida', ageDays: 9999 }), false);
});

test('RAR.6.2/6.5: vaquillona SIN veredicto ≥365 d → true (fallback de edad, alineado a 0105)', () => {
  assert.equal(
    isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: null, ageDays: SERVICE_AGE_THRESHOLD_DAYS }),
    true,
  );
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: null, ageDays: 1000 }), true);
});

test('RAR.6.5: vaquillona SIN veredicto <365 d → false', () => {
  assert.equal(
    isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: null, ageDays: SERVICE_AGE_THRESHOLD_DAYS - 1 }),
    false,
  );
});

test('RAR.6.5: vaquillona SIN veredicto y SIN edad (ageDays null) → false', () => {
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: null, ageDays: null }), false);
});

test('RAR.6.6: CUT (categoría cut) → false', () => {
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'cut', aptitude: null, ageDays: 9999 }), false);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// ageInDaysFromBirthDate
// ════════════════════════════════════════════════════════════════════════════════════════════

const NOW = new Date('2026-06-29T12:00:00Z');

test('ageInDaysFromBirthDate: null/vacío/inválida/futura → null', () => {
  assert.equal(ageInDaysFromBirthDate(null, NOW), null);
  assert.equal(ageInDaysFromBirthDate('', NOW), null);
  assert.equal(ageInDaysFromBirthDate('2026', NOW), null);
  assert.equal(ageInDaysFromBirthDate('2026-02-31', NOW), null); // desbordada
  assert.equal(ageInDaysFromBirthDate('2027-01-01', NOW), null); // futura → null
});

test('ageInDaysFromBirthDate: edad exacta y umbral de 365 d', () => {
  assert.equal(ageInDaysFromBirthDate('2026-06-29', NOW), 0);
  assert.equal(ageInDaysFromBirthDate('2025-06-29', NOW), 365); // exacto en el umbral
  assert.equal(ageInDaysFromBirthDate('2025-06-30', NOW), 364); // un día por debajo
});

test('integración: vaquillona ≥365 d sin veredicto → isReproApt true vía ageInDaysFromBirthDate', () => {
  const ageDays = ageInDaysFromBirthDate('2025-06-29', NOW);
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: null, ageDays }), true);
  const young = ageInDaysFromBirthDate('2025-06-30', NOW);
  assert.equal(isReproApt({ sex: 'female', categoryCode: 'vaquillona', aptitude: null, ageDays: young }), false);
});
