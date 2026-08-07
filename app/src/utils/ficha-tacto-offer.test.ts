// Tests de la decisión PURA "qué tacto ofrece la ficha" (delta spec 02 `ficha-categoria-tacto`,
// RTF.1.1/RTF.1.2/RTF.1.4/RTF.2.1/RTF.2.2/RTF.2.3/RTF.2.4).
//
// El test que importa es el de DISYUNCIÓN: barre el producto cartesiano de estados y exige que los dos
// predicados de la manga nunca den true a la vez. Si esa propiedad se rompiera, la precedencia defensiva de
// `resolveFichaTactoOffer` seguiría dando UN solo CTA, pero el criterio de la ficha habría dejado de ser el
// de la manga — y eso es lo que C2.2 prohíbe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fichaTactoCtaLabel, resolveFichaTactoOffer } from './ficha-tacto-offer.ts';
import { appliesToAnimal, type AnimalApplicabilityInfo } from './maneuver-applicability.ts';
import type { RodeoDataKeyMap } from './maneuver-gating.ts';
import type { ReproStatus } from './repro-status.ts';

const on = { enabled: true, required: false };
const off = { enabled: false, required: false };

/** Rodeo con los 3 data_keys de los dos tactos habilitados (el default de un rodeo de cría). */
const RODEO_FULL: RodeoDataKeyMap = { prenez: on, tamano_prenez: on, tacto_vaquillona: on };
/** Rodeo sin ninguno (o sin sincronizar → mapa vacío). */
const RODEO_EMPTY: RodeoDataKeyMap = {};

/** Los 7 `ReproStatus` posibles (single-slot, RAR.2.4). */
const ALL_REPRO: ReproStatus[] = [
  { kind: 'none' },
  { kind: 'cut' },
  { kind: 'pregnant', status: 'large' },
  { kind: 'empty' },
  { kind: 'served_untested' },
  { kind: 'fitness', fitness: 'apta' },
  { kind: 'fitness', fitness: 'no_apta' },
  { kind: 'fitness', fitness: 'diferida' },
  { kind: 'unknown' },
];

const CATEGORIES = [
  'ternera',
  'vaquillona',
  'vaquillona_prenada',
  'vaca_segundo_servicio',
  'multipara',
  'cut',
  'ternero',
  'torito',
  null,
];

// ─── RTF.2.1 — DISYUNCIÓN de los predicados de la manga ────────────────────────────────────────

test('RTF.2.1 — `tacto` y `tacto_vaquillona` NUNCA aplican a la vez (barrido cartesiano)', () => {
  let bothTrue = 0;
  let anyTrue = 0;
  for (const sex of ['male', 'female', null] as const) {
    for (const categoryCode of CATEGORIES) {
      for (const isCastrated of [false, true, null]) {
        for (const reproStatus of [...ALL_REPRO, undefined]) {
          const animal: AnimalApplicabilityInfo = { sex, categoryCode, isCastrated, reproStatus };
          const a = appliesToAnimal('tacto', animal);
          const b = appliesToAnimal('tacto_vaquillona', animal);
          if (a && b) bothTrue += 1;
          if (a || b) anyTrue += 1;
        }
      }
    }
  }
  assert.equal(bothTrue, 0, 'hay estados donde los dos tactos aplican: la disyunción se rompió');
  assert.ok(anyTrue > 0, 'control de no-vacuidad: el barrido SÍ produce casos donde alguno aplica');
});

// ─── RTF.2.4 — el resultado es siempre uno de los tres valores ─────────────────────────────────

test('RTF.2.4 — el barrido completo devuelve solo prenez | aptitud | null, y produce los tres', () => {
  const seen = new Set<string>();
  for (const status of ['active', 'sold']) {
    for (const sex of ['male', 'female', null] as const) {
      for (const categoryCode of CATEGORIES) {
        for (const reproStatus of [...ALL_REPRO, undefined]) {
          for (const rodeoConfig of [RODEO_FULL, RODEO_EMPTY]) {
            const out = resolveFichaTactoOffer({
              status,
              sex,
              categoryCode,
              isCastrated: false,
              reproStatus,
              rodeoConfig,
            });
            assert.ok(out === 'prenez' || out === 'aptitud' || out === null, `valor inesperado: ${out}`);
            seen.add(String(out));
          }
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), ['aptitud', 'null', 'prenez'], 'el barrido ejercita los tres desenlaces');
});

// ─── Casos nombrados ───────────────────────────────────────────────────────────────────────────

const base = {
  status: 'active',
  sex: 'female' as const,
  isCastrated: false,
  rodeoConfig: RODEO_FULL,
};

test('hembra SERVIDA sin tactar (multípara) → prenez', () => {
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'multipara', reproStatus: { kind: 'served_untested' } }),
    'prenez',
  );
});

test('hembra ya tactada (preñada / vacía) → prenez (se puede re-tactar)', () => {
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'multipara', reproStatus: { kind: 'pregnant', status: 'medium' } }),
    'prenez',
  );
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'multipara', reproStatus: { kind: 'empty' } }),
    'prenez',
  );
});

test('vaquillona SIN evaluar → aptitud', () => {
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'vaquillona', reproStatus: { kind: 'unknown' } }),
    'aptitud',
  );
});

test('vaquillona NO APTA / DIFERIDA → aptitud (se re-evalúa)', () => {
  for (const fitness of ['no_apta', 'diferida'] as const) {
    assert.equal(
      resolveFichaTactoOffer({ ...base, categoryCode: 'vaquillona', reproStatus: { kind: 'fitness', fitness } }),
      'aptitud',
    );
  }
});

test('RTF.2.3 — vaquillona YA APTA sin servicio → null (no hay nada que tactar)', () => {
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'vaquillona', reproStatus: { kind: 'fitness', fitness: 'apta' } }),
    null,
  );
});

test('RTF.2.3 — ternera → null', () => {
  assert.equal(resolveFichaTactoOffer({ ...base, categoryCode: 'ternera', reproStatus: { kind: 'none' } }), null);
});

test('RTF.2.3 — MACHO (cualquier categoría/estado) → null', () => {
  for (const categoryCode of ['ternero', 'torito', 'toro', 'novillo']) {
    for (const reproStatus of ALL_REPRO) {
      assert.equal(
        resolveFichaTactoOffer({ ...base, sex: 'male', categoryCode, reproStatus }),
        null,
        `${categoryCode}/${reproStatus.kind} no debe ofrecer tacto a un macho`,
      );
    }
  }
});

test('RTF.2.3 — sexo DESCONOCIDO (null) → null (fail-safe: no se tacta sin sexo confirmado)', () => {
  assert.equal(
    resolveFichaTactoOffer({ ...base, sex: null, categoryCode: 'multipara', reproStatus: { kind: 'served_untested' } }),
    null,
  );
});

test('RTF.2.3 — animal CUT → null (ni preñez ni aptitud)', () => {
  assert.equal(resolveFichaTactoOffer({ ...base, categoryCode: 'cut', reproStatus: { kind: 'cut' } }), null);
});

test('RTF.1.2 — animal ARCHIVADO (sold/dead/transferred) → null aunque todo lo demás aplique', () => {
  for (const status of ['sold', 'dead', 'transferred', '']) {
    assert.equal(
      resolveFichaTactoOffer({ ...base, status, categoryCode: 'multipara', reproStatus: { kind: 'served_untested' } }),
      null,
      status,
    );
    assert.equal(
      resolveFichaTactoOffer({ ...base, status, categoryCode: 'vaquillona', reproStatus: { kind: 'unknown' } }),
      null,
      status,
    );
  }
});

// ─── RTF.1.4 — capa RODEO (los data_keys), incluido el AND de preñez ───────────────────────────

test('RTF.1.4 — rodeo SIN `prenez` (o sin `tamano_prenez`) no ofrece el tacto de preñez', () => {
  const servida = { ...base, categoryCode: 'multipara', reproStatus: { kind: 'served_untested' } as ReproStatus };
  assert.equal(resolveFichaTactoOffer({ ...servida, rodeoConfig: { prenez: off, tamano_prenez: on } }), null);
  assert.equal(resolveFichaTactoOffer({ ...servida, rodeoConfig: { prenez: on, tamano_prenez: off } }), null);
  assert.equal(
    resolveFichaTactoOffer({ ...servida, rodeoConfig: { prenez: on, tamano_prenez: on } }),
    'prenez',
    'control: con los DOS enabled sí se ofrece',
  );
});

test('RTF.1.4 — rodeo SIN `tacto_vaquillona` no ofrece el tacto de aptitud', () => {
  const vaq = { ...base, categoryCode: 'vaquillona', reproStatus: { kind: 'unknown' } as ReproStatus };
  assert.equal(resolveFichaTactoOffer({ ...vaq, rodeoConfig: { tacto_vaquillona: off } }), null);
  assert.equal(resolveFichaTactoOffer({ ...vaq, rodeoConfig: { prenez: on, tamano_prenez: on } }), null, 'ausente = off');
  assert.equal(resolveFichaTactoOffer({ ...vaq, rodeoConfig: { tacto_vaquillona: on } }), 'aptitud');
});

test('RTF.1.4 — config IRRESOLUBLE (mapa vacío) → null para los dos tactos (fail-safe conservador)', () => {
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'multipara', reproStatus: { kind: 'served_untested' }, rodeoConfig: RODEO_EMPTY }),
    null,
  );
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'vaquillona', reproStatus: { kind: 'unknown' }, rodeoConfig: RODEO_EMPTY }),
    null,
  );
});

test('reproStatus AUSENTE (undefined): la preñez cae al fail-safe de categoría probada; la aptitud se salta', () => {
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'multipara', reproStatus: undefined }),
    'prenez',
    'categoría PROBADA alcanza para el tacto de preñez (mismo fail-safe que la manga)',
  );
  assert.equal(
    resolveFichaTactoOffer({ ...base, categoryCode: 'vaquillona', reproStatus: undefined }),
    null,
    'sin estado no se ofrece aptitud',
  );
});

// ─── RTF.3.2 — copy del CTA ────────────────────────────────────────────────────────────────────

test('RTF.3.2 — el copy nombra el tacto, no un genérico', () => {
  assert.equal(fichaTactoCtaLabel('prenez'), 'Tacto de preñez');
  assert.equal(fichaTactoCtaLabel('aptitud'), 'Tacto de aptitud');
});
