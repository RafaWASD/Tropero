// Tests de la lógica PURA del snapshot de jornada/preset (spec 03 M1.2/M1.3). node:test.
// Foco: parseo TOLERANTE del config TEXT + extracción de maniobras VÁLIDAS (filtra basura del jsonb
// pass-through, dedup, orden).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseManeuverConfig,
  extractManeuvers,
  extractCustomManiobras,
  preconfigStringFor,
  preconfigHistory,
  pajuelasFor,
  tactoMeasureSizeFromConfig,
} from './maneuver-config';

// ─── parseManeuverConfig: tolerante ───────────────────────────────────────────────────

test('parseManeuverConfig: objeto válido → se devuelve tal cual', () => {
  const cfg = parseManeuverConfig('{"maniobras":["tacto"],"preconfig":{"vacuna":"Aftosa"}}');
  assert.deepEqual(cfg.maniobras, ['tacto']);
  assert.deepEqual(cfg.preconfig, { vacuna: 'Aftosa' });
});

test('parseManeuverConfig: null/undefined → {}', () => {
  assert.deepEqual(parseManeuverConfig(null), {});
  assert.deepEqual(parseManeuverConfig(undefined), {});
});

test('parseManeuverConfig: JSON malformado → {} (no tira)', () => {
  assert.deepEqual(parseManeuverConfig('{ no es json'), {});
});

// Round-trip server↔local (M2.2 fix): PowerSync materializa el jsonb como OBJETO al bajar del server.
test('parseManeuverConfig: OBJETO ya parseado (jsonb del server) → se devuelve tal cual', () => {
  const obj = { maniobras: ['tacto', 'pesaje'], preconfig: { vacunacion: 'Aftosa' } };
  assert.deepEqual(parseManeuverConfig(obj), obj);
});

// Fila SINCRONIZADA: PowerSync materializa el jsonb DOBLEMENTE serializado (string que contiene un string
// JSON) → el 1er JSON.parse da un string; hay que parsear una vez más. Sin esto, el config caía a {} tras
// el sync y la carga rápida veía "sin maniobras" (bug M2.2).
test('parseManeuverConfig: string DOBLEMENTE serializado (jsonb sincronizado) → objeto con maniobras', () => {
  const inner = JSON.stringify({ maniobras: ['tacto', 'pesaje'] });
  const doubled = JSON.stringify(inner); // '"{\\"maniobras\\":[...]}"'
  assert.deepEqual(parseManeuverConfig(doubled), { maniobras: ['tacto', 'pesaje'] });
});

test('parseManeuverConfig: doble-encoding que al final no es objeto → {} (defensivo)', () => {
  assert.deepEqual(parseManeuverConfig(JSON.stringify(JSON.stringify('hola'))), {});
});

test('parseManeuverConfig: array como objeto (no plano) → {}', () => {
  assert.deepEqual(parseManeuverConfig(['tacto']), {});
});

test('parseManeuverConfig: número/boolean (no string ni objeto) → {}', () => {
  assert.deepEqual(parseManeuverConfig(42), {});
  assert.deepEqual(parseManeuverConfig(true), {});
});

test('parseManeuverConfig: array o escalar (no objeto plano) → {}', () => {
  assert.deepEqual(parseManeuverConfig('[1,2,3]'), {});
  assert.deepEqual(parseManeuverConfig('42'), {});
  assert.deepEqual(parseManeuverConfig('"hola"'), {});
  assert.deepEqual(parseManeuverConfig('null'), {});
});

// ─── extractManeuvers: filtra, ordena, dedup ──────────────────────────────────────────

test('extractManeuvers: lista válida → preserva orden', () => {
  assert.deepEqual(
    extractManeuvers({ maniobras: ['vacunacion', 'tacto', 'pesaje'] }),
    ['vacunacion', 'tacto', 'pesaje'],
  );
});

test('extractManeuvers: maniobras ausente o no-array → []', () => {
  assert.deepEqual(extractManeuvers({}), []);
  assert.deepEqual(extractManeuvers({ maniobras: 'tacto' as unknown as never }), []);
  assert.deepEqual(extractManeuvers({ maniobras: undefined }), []);
});

test('extractManeuvers: filtra valores que NO son maniobras conocidas (jsonb pass-through hostil)', () => {
  const cfg = { maniobras: ['tacto', 'no_existe', 'pesaje', '', 'drop table'] as unknown as never };
  assert.deepEqual(extractManeuvers(cfg), ['tacto', 'pesaje']);
});

test('extractManeuvers: deduplica preservando la primera aparición', () => {
  const cfg = { maniobras: ['tacto', 'pesaje', 'tacto', 'pesaje'] as unknown as never };
  assert.deepEqual(extractManeuvers(cfg), ['tacto', 'pesaje']);
});

test('extractManeuvers: filtra no-strings (numbers/objects) sin tirar', () => {
  const cfg = { maniobras: ['tacto', 42, { x: 1 }, null, 'sangrado'] as unknown as never };
  assert.deepEqual(extractManeuvers(cfg), ['tacto', 'sangrado']);
});

// ─── extractCustomManiobras: namespace PARALELO de maniobras custom (spec 03 M5-C.3, R13.8) ──

test('extractCustomManiobras: lista de field_definition_id → preserva orden', () => {
  assert.deepEqual(
    extractCustomManiobras({ customManiobras: ['fd-a', 'fd-b', 'fd-c'] }),
    ['fd-a', 'fd-b', 'fd-c'],
  );
});

test('extractCustomManiobras: ausente / no-array → [] (config solo con maniobras de fábrica)', () => {
  assert.deepEqual(extractCustomManiobras({}), []);
  assert.deepEqual(extractCustomManiobras({ maniobras: ['tacto'] }), []);
  assert.deepEqual(extractCustomManiobras({ customManiobras: 'fd-a' as unknown as never }), []);
});

test('extractCustomManiobras: descarta vacíos/no-strings y DEDUPLICA preservando orden', () => {
  const cfg = { customManiobras: ['fd-a', '  ', 42, null, 'fd-a', 'fd-b'] as unknown as never };
  assert.deepEqual(extractCustomManiobras(cfg), ['fd-a', 'fd-b']);
});

test('extractCustomManiobras: NO contamina extractManeuvers (namespaces paralelos)', () => {
  const cfg = parseManeuverConfig('{"maniobras":["tacto"],"customManiobras":["fd-x"]}');
  assert.deepEqual(extractManeuvers(cfg), ['tacto']);
  assert.deepEqual(extractCustomManiobras(cfg), ['fd-x']);
});

// ─── preconfigStringFor: producto de tanda por maniobra (R1.7) ─────────────────────────

test('preconfigStringFor: string directo (antiparasitario) → ese string trimeado', () => {
  const cfg = parseManeuverConfig('{"preconfig":{"antiparasitario":"  Ivermectina  "}}');
  assert.equal(preconfigStringFor(cfg, 'antiparasitario'), 'Ivermectina');
});

test('preconfigStringFor: multi coma-separado (vacunación) → string tal cual', () => {
  const cfg = parseManeuverConfig('{"preconfig":{"vacunacion":"Aftosa, Mancha"}}');
  assert.equal(preconfigStringFor(cfg, 'vacunacion'), 'Aftosa, Mancha');
});

test('preconfigStringFor: objeto con products[] → coma-join', () => {
  const cfg = { preconfig: { vacunacion: { products: ['Aftosa', '  Mancha  ', ''] } } };
  assert.equal(preconfigStringFor(cfg, 'vacunacion'), 'Aftosa, Mancha');
});

test('preconfigStringFor: objeto con default_pajuela → ese valor', () => {
  const cfg = { preconfig: { inseminacion: { default_pajuela: 'Toro 123' } } };
  assert.equal(preconfigStringFor(cfg, 'inseminacion'), 'Toro 123');
});

test('preconfigStringFor: sin preconfig / maniobra ausente / shape raro → ""', () => {
  assert.equal(preconfigStringFor({}, 'antiparasitario'), '');
  assert.equal(preconfigStringFor({ preconfig: {} }, 'antiparasitario'), '');
  assert.equal(preconfigStringFor({ preconfig: { antiparasitario: 42 } }, 'antiparasitario'), '');
  assert.equal(preconfigStringFor({ preconfig: ['x'] as unknown as Record<string, unknown> }, 'antiparasitario'), '');
  assert.equal(preconfigStringFor({ preconfig: { antiparasitario: {} } }, 'antiparasitario'), '');
});

// ─── preconfigHistory: histórico de valores usados antes (R1.8) ────────────────────────

test('preconfigHistory: aplana multi por coma + dedup case-insensitive', () => {
  const cfg = {
    preconfig: {
      vacunacion: 'Aftosa, Mancha',
      antiparasitario: 'Ivermectina',
      antibiotico: 'aftosa', // dup case-insensitive de "Aftosa" → no se repite
    },
  };
  const h = preconfigHistory(cfg);
  // Aftosa (primer casing visto), Mancha, Ivermectina.
  assert.deepEqual(h, ['Aftosa', 'Mancha', 'Ivermectina']);
});

test('preconfigHistory: sin preconfig → []', () => {
  assert.deepEqual(preconfigHistory({}), []);
  assert.deepEqual(preconfigHistory({ preconfig: {} }), []);
});

test('preconfigHistory: enriquece con pajuelas multi de inseminación (shape pajuelas[])', () => {
  const cfg = {
    preconfig: {
      vacunacion: 'Aftosa',
      inseminacion: { pajuelas: ['Toro 123', 'Toro 456', 'aftosa'] },
    },
  };
  // Aftosa (de vacunación), luego las pajuelas; "aftosa" es dup case-insensitive → no se repite.
  assert.deepEqual(preconfigHistory(cfg), ['Aftosa', 'Toro 123', 'Toro 456']);
});

// ─── pajuelasFor: pajuelas disponibles de inseminación (R6.5: 1 vs >1) ─────────────────

test('pajuelasFor: string simple → 1 pajuela', () => {
  const cfg = parseManeuverConfig('{"preconfig":{"inseminacion":"  Toro 123  "}}');
  assert.deepEqual(pajuelasFor(cfg), ['Toro 123']);
});

test('pajuelasFor: string coma-separado → varias pajuelas (>1 → selector)', () => {
  const cfg = parseManeuverConfig('{"preconfig":{"inseminacion":"Toro 123, Toro 456"}}');
  assert.deepEqual(pajuelasFor(cfg), ['Toro 123', 'Toro 456']);
});

test('pajuelasFor: objeto con pajuelas[] → esa lista, dedup + sin vacíos', () => {
  const cfg = { preconfig: { inseminacion: { pajuelas: ['Toro 123', '', '  Toro 456  ', 'toro 123'] } } };
  assert.deepEqual(pajuelasFor(cfg), ['Toro 123', 'Toro 456']);
});

test('pajuelasFor: objeto con default_pajuela/pajuela string → 1 pajuela', () => {
  assert.deepEqual(pajuelasFor({ preconfig: { inseminacion: { default_pajuela: 'Toro 123' } } }), ['Toro 123']);
  assert.deepEqual(pajuelasFor({ preconfig: { inseminacion: { pajuela: 'Toro 9' } } }), ['Toro 9']);
});

test('pajuelasFor: sin preconfig / ausente / shape raro → [] (pide pajuela libre)', () => {
  assert.deepEqual(pajuelasFor({}), []);
  assert.deepEqual(pajuelasFor({ preconfig: {} }), []);
  assert.deepEqual(pajuelasFor({ preconfig: { inseminacion: 42 } }), []);
  assert.deepEqual(pajuelasFor({ preconfig: { inseminacion: {} } }), []);
  assert.deepEqual(pajuelasFor({ preconfig: ['x'] as unknown as Record<string, unknown> }), []);
});

test('pajuelasFor: pajuelas[] con no-strings → los descarta sin tirar', () => {
  const cfg = { preconfig: { inseminacion: { pajuelas: ['Toro 1', 42, null, { x: 1 }, 'Toro 2'] as unknown[] } } };
  assert.deepEqual(pajuelasFor(cfg as never), ['Toro 1', 'Toro 2']);
});

// ─── tactoMeasureSizeFromConfig: override "¿medir tamaño?" del tacto (B2, RPSC.4.1/4.3) ──────────

test('tactoMeasureSizeFromConfig: lee el booleano persistido (true y false)', () => {
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: { tacto: { measureSize: true } } }), true);
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: { tacto: { measureSize: false } } }), false);
});

test('tactoMeasureSizeFromConfig: sin configurar (ausente/preconfig vacío/sin tacto) → undefined (cae al default del rodeo)', () => {
  assert.equal(tactoMeasureSizeFromConfig({}), undefined);
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: {} }), undefined);
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: { vacunacion: 'Aftosa' } }), undefined);
});

test('tactoMeasureSizeFromConfig: shapes inesperados del jsonb → undefined, nunca tira', () => {
  // tacto no es objeto (string/number), measureSize no booleano, preconfig array.
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: { tacto: 'sí' } }), undefined);
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: { tacto: 1 } as unknown as Record<string, unknown> }), undefined);
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: { tacto: { measureSize: 'true' } } }), undefined);
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: { tacto: {} } }), undefined);
  assert.equal(tactoMeasureSizeFromConfig({ preconfig: ['x'] as unknown as Record<string, unknown> }), undefined);
});

test('tactoMeasureSizeFromConfig: round-trip por parseManeuverConfig (string JSON del INSERT local)', () => {
  // El config se persiste como JSON.stringify(config) en SQLite; al releerlo, parseManeuverConfig lo
  // recupera y tactoMeasureSizeFromConfig debe leer el override igual (camino real del cableado).
  const raw = JSON.stringify({ maniobras: ['tacto'], preconfig: { tacto: { measureSize: false } } });
  assert.equal(tactoMeasureSizeFromConfig(parseManeuverConfig(raw)), false);
});
