// Tests de la lógica PURA del preview de transición de categoría offline (spec 03 R8.4). node:test.
// Foco: ANTIDRIFT (round-trip contra computeCategoryCode), las reglas de null (override/male/sin-cambio/
// sin-catálogo/sin-evento) y el caso canónico (vaquillona + tacto+ → vaquillona_prenada).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  previewManeuverCategoryTransition,
  syntheticEventsForFemaleCategory,
} from './maneuver-category-preview';
import { computeCategoryCode } from './animal-category';
import type { CaptureMap } from './maneuver-sequence';

// `today` FIJO para tests deterministas (sin depender del wall-clock).
const TODAY = new Date('2026-06-17T12:00:00Z');

/** Catálogo code→name mínimo del sistema cría (lo que el server tiene en categories_by_system, 0015). */
const CATALOG: readonly { code: string; name: string }[] = [
  { code: 'ternera', name: 'Ternera' },
  { code: 'vaquillona', name: 'Vaquillona' },
  { code: 'vaquillona_prenada', name: 'Vaquillona preñada' },
  { code: 'vaca_segundo_servicio', name: 'Vaca de segundo servicio' },
  { code: 'multipara', name: 'Multípara' },
];

/** birthDate "consistente" por code para el round-trip: ternera < 1 año; el resto, cualquiera (gana el evento). */
function consistentBirthDate(code: string): string {
  // ternera: < 1 año (el corte de edad la hace ternera sin eventos). El resto: > 2 años (da igual, el
  // evento calificante gana al corte de edad — multipara/vaca por partos, vaquillona por servicio, preñada
  // por tacto+). Usamos > 2 años para PROBAR que el evento gana incluso a la edad más alta.
  return code === 'ternera' ? '2026-01-01' : '2020-01-01';
}

// ─── ANTIDRIFT: round-trip contra computeCategoryCode (el test que ATRAPA el drift de compute_category) ──

test('antidrift: syntheticEventsForFemaleCategory(code) reproduce el code vía computeCategoryCode', () => {
  for (const code of ['ternera', 'vaquillona', 'vaquillona_prenada', 'vaca_segundo_servicio', 'multipara']) {
    const events = syntheticEventsForFemaleCategory(code);
    assert.notEqual(events, null, `code ${code} debe ser reconstruible`);
    const round = computeCategoryCode({
      sex: 'female',
      birthDate: consistentBirthDate(code),
      isCastrated: false,
      events: events!,
      today: TODAY,
    });
    assert.equal(round, code, `round-trip de ${code} debe dar ${code} (drift de compute_category)`);
  }
});

test('syntheticEventsForFemaleCategory: code desconocido / no-cría → null (fail-safe)', () => {
  assert.equal(syntheticEventsForFemaleCategory('torito'), null);
  assert.equal(syntheticEventsForFemaleCategory('novillo'), null);
  assert.equal(syntheticEventsForFemaleCategory(''), null);
  assert.equal(syntheticEventsForFemaleCategory('cualquier_cosa'), null);
});

// ─── Helpers para armar args del preview ───────────────────────────────────────────────────────

function preview(
  overrides: Partial<Parameters<typeof previewManeuverCategoryTransition>[0]> & {
    currentCode: string;
    captured: CaptureMap;
  },
) {
  return previewManeuverCategoryTransition({
    sex: 'female',
    birthDate: '2020-01-01',
    currentName: 'Vaquillona',
    categoryOverride: false,
    catalog: CATALOG,
    today: TODAY,
    ...overrides,
  });
}

const TACTO_POS: CaptureMap = { tacto: { kind: 'tacto', pregnancy: 'medium' } };
const TACTO_EMPTY: CaptureMap = { tacto: { kind: 'tacto', pregnancy: 'empty' } };
const INSEM: CaptureMap = { inseminacion: { kind: 'inseminacion', semenName: 'Toro X' } };

// ─── Reglas de null tempranas ────────────────────────────────────────────────────────────────

test('override=true → null (el server no recalcula con override, R8.1)', () => {
  assert.equal(
    preview({ currentCode: 'vaquillona', captured: TACTO_POS, categoryOverride: true }),
    null,
  );
});

test('macho → null (ningún evento de manga lo transiciona vía compute_category)', () => {
  assert.equal(preview({ currentCode: 'vaquillona', captured: TACTO_POS, sex: 'male' }), null);
});

// ─── Caso canónico: tacto+ sobre vaquillona / ternera → vaquillona_prenada ──────────────────────

test('vaquillona + tacto+ (medium) → vaquillona_prenada (caso canónico R8.1)', () => {
  const r = preview({ currentCode: 'vaquillona', currentName: 'Vaquillona', captured: TACTO_POS });
  assert.deepEqual(r, {
    fromCode: 'vaquillona',
    fromName: 'Vaquillona',
    toCode: 'vaquillona_prenada',
    toName: 'Vaquillona preñada',
  });
});

test('ternera + tacto+ → vaquillona_prenada (un tacto+ la promueve, gana al corte de edad)', () => {
  const r = preview({
    currentCode: 'ternera',
    currentName: 'Ternera',
    birthDate: '2026-01-01',
    captured: TACTO_POS,
  });
  assert.equal(r?.toCode, 'vaquillona_prenada');
  assert.equal(r?.fromCode, 'ternera');
});

// ─── Sin cambio: partos ganan / preñada ya preñada → null ───────────────────────────────────────

test('multipara + tacto+ → null (los partos ganan, sin cambio)', () => {
  assert.equal(preview({ currentCode: 'multipara', captured: TACTO_POS }), null);
});

test('vaca_segundo_servicio + tacto+ → null (1 parto gana, sin cambio)', () => {
  assert.equal(preview({ currentCode: 'vaca_segundo_servicio', captured: TACTO_POS }), null);
});

test('vaquillona_prenada + tacto+ → null (ya preñada, sin cambio)', () => {
  assert.equal(preview({ currentCode: 'vaquillona_prenada', captured: TACTO_POS }), null);
});

// ─── Tacto vacío (no positivo) → null ───────────────────────────────────────────────────────────

test('vaquillona + tacto vacío (empty) → null (no positivo, no transiciona)', () => {
  assert.equal(preview({ currentCode: 'vaquillona', captured: TACTO_EMPTY }), null);
});

test('ternera + tacto vacío → null (no positivo)', () => {
  assert.equal(
    preview({ currentCode: 'ternera', birthDate: '2026-01-01', captured: TACTO_EMPTY }),
    null,
  );
});

// ─── Inseminación (service) ─────────────────────────────────────────────────────────────────────

test('ternera + inseminación (service) → vaquillona (el servicio la promueve)', () => {
  const r = preview({
    currentCode: 'ternera',
    currentName: 'Ternera',
    birthDate: '2026-01-01',
    captured: INSEM,
  });
  assert.equal(r?.toCode, 'vaquillona');
  assert.equal(r?.toName, 'Vaquillona');
});

test('vaquillona + inseminación (service) → null (ya vaquillona, sin cambio)', () => {
  assert.equal(preview({ currentCode: 'vaquillona', captured: INSEM }), null);
});

// ─── Catálogo / sin evento ──────────────────────────────────────────────────────────────────────

test('toCode no está en el catálogo (catálogo vacío) → null (fail-safe, nunca blanco)', () => {
  assert.equal(preview({ currentCode: 'vaquillona', captured: TACTO_POS, catalog: [] }), null);
});

test('sin tacto ni inseminación capturados → null (no hay evento que dispare transición)', () => {
  const noTrigger: CaptureMap = {
    vaquillona: { kind: 'vaquillona', fitness: 'apta' },
    pesaje: { kind: 'pesaje', weightKg: 380 },
  };
  assert.equal(preview({ currentCode: 'vaquillona', captured: noTrigger }), null);
});

test('captured vacío → null', () => {
  assert.equal(preview({ currentCode: 'vaquillona', captured: {} }), null);
});

test('code actual no-cría (no reconstruible) → null aunque haya tacto+', () => {
  assert.equal(preview({ currentCode: 'toro', captured: TACTO_POS }), null);
});

// ─── tacto_vaquillona (aptitud) NO alimenta compute_category ────────────────────────────────────

test('tacto_vaquillona (aptitud) NO dispara preview (event_type distinto, no alimenta compute_category)', () => {
  const aptitud: CaptureMap = { vaquillona: { kind: 'vaquillona', fitness: 'apta' } };
  assert.equal(preview({ currentCode: 'vaquillona', captured: aptitud }), null);
});

// ─── FROM siempre = el display actual (consistencia con el header) ──────────────────────────────

test('FROM = currentCode/currentName tal cual (consistencia con el header)', () => {
  const r = preview({
    currentCode: 'vaquillona',
    currentName: 'Vaquillona del campo',
    captured: TACTO_POS,
  });
  assert.equal(r?.fromCode, 'vaquillona');
  assert.equal(r?.fromName, 'Vaquillona del campo');
});
