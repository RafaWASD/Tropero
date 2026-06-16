// Tests de la lógica PURA del wizard de config de jornada (spec 03 M1.4). node:test (sin RN/Jest).
// Cubre: labels es-AR de las 12 maniobras (10 fábrica + antiparasitario/antibiótico, sesión 26), reorder
// (drag, R1.12), toggle (orden de selección), armado del config snapshot (R1.13, shape §2.1.1),
// autocompletar (R1.8).

import test from 'node:test';
import assert from 'node:assert/strict';

import { ALL_MANEUVERS, type ManeuverKind } from './maneuver-gating';
import { extractManeuvers } from './maneuver-config';
import {
  MANEUVER_LABELS,
  maneuverLabel,
  maneuverDetail,
  moveManeuver,
  toggleManeuver,
  buildJornadaConfig,
  filterAutocomplete,
  splitMultiPreconfig,
  joinMultiPreconfig,
} from './maneuver-wizard';

// ─── Labels (R1.6 / UI) ────────────────────────────────────────────────────────────────

test('MANEUVER_LABELS cubre TODAS las maniobras del catálogo (ningún token sin label es-AR)', () => {
  for (const m of ALL_MANEUVERS) {
    assert.equal(typeof MANEUVER_LABELS[m], 'string');
    assert.ok(MANEUVER_LABELS[m].length > 0, `falta label para ${m}`);
  }
  assert.equal(Object.keys(MANEUVER_LABELS).length, ALL_MANEUVERS.length);
});

test('maneuverLabel devuelve el label es-AR; fallback al token crudo si desconocido', () => {
  assert.equal(maneuverLabel('tacto'), 'Tacto de preñez');
  assert.equal(maneuverLabel('tacto_vaquillona'), 'Tacto de aptitud reproductiva');
  assert.equal(maneuverLabel('raspado'), 'Raspado de toros');
  // @ts-expect-error — probamos el fallback defensivo con un token fuera del enum.
  assert.equal(maneuverLabel('inexistente'), 'inexistente');
});

// ─── maneuverDetail (detalle de preconfig para el resumen, R1.9) ─────────────────────────

test('maneuverDetail: texto libre (string) → ese texto trimmeado', () => {
  assert.equal(maneuverDetail({ vacunacion: '  Brucelosis ' }, 'vacunacion'), 'Brucelosis');
});

test('maneuverDetail: string vacío / solo espacios → null (sin detalle)', () => {
  assert.equal(maneuverDetail({ vacunacion: '   ' }, 'vacunacion'), null);
  assert.equal(maneuverDetail({ vacunacion: '' }, 'vacunacion'), null);
});

test('maneuverDetail: maniobra sin preconfig → null', () => {
  assert.equal(maneuverDetail({ tacto: 'X' }, 'vacunacion'), null);
  assert.equal(maneuverDetail(undefined, 'vacunacion'), null);
  assert.equal(maneuverDetail({}, 'vacunacion'), null);
});

test('maneuverDetail: objeto con products[] → lista "A, B" (filtra vacíos)', () => {
  assert.equal(
    maneuverDetail({ vacunacion: { products: ['Aftosa', ' ', 'Mancha'] } }, 'vacunacion'),
    'Aftosa, Mancha',
  );
});

test('maneuverDetail: objeto con campo escalar conocido (pajuela)', () => {
  assert.equal(maneuverDetail({ inseminacion: { pajuela: 'Toro 123' } }, 'inseminacion'), 'Toro 123');
});

test('maneuverDetail: payload no entendido (number/array/objeto vacío) → null (no inventa)', () => {
  // @ts-expect-error — payload corrupto: number.
  assert.equal(maneuverDetail({ tacto: 5 }, 'tacto'), null);
  assert.equal(maneuverDetail({ tacto: ['a'] as unknown as string }, 'tacto'), null);
  assert.equal(maneuverDetail({ tacto: { foo: 'bar' } }, 'tacto'), null);
});

// ─── moveManeuver (drag-reorder, R1.12) ──────────────────────────────────────────────────

test('moveManeuver: mueve un elemento hacia adelante preservando el resto', () => {
  const base: ManeuverKind[] = ['pesaje', 'tacto', 'vacunacion', 'sangrado'];
  // pesaje (0) → posición 2: [tacto, vacunacion, pesaje, sangrado]
  assert.deepEqual(moveManeuver(base, 0, 2), ['tacto', 'vacunacion', 'pesaje', 'sangrado']);
});

test('moveManeuver: mueve un elemento hacia atrás (tacto al frente)', () => {
  const base: ManeuverKind[] = ['pesaje', 'tacto', 'vacunacion'];
  assert.deepEqual(moveManeuver(base, 1, 0), ['tacto', 'pesaje', 'vacunacion']);
});

test('moveManeuver: no muta el array original (inmutable)', () => {
  const base: ManeuverKind[] = ['pesaje', 'tacto'];
  const out = moveManeuver(base, 0, 1);
  assert.deepEqual(base, ['pesaje', 'tacto']); // original intacto
  assert.deepEqual(out, ['tacto', 'pesaje']);
  assert.notEqual(out, base);
});

test('moveManeuver: índices fuera de rango o iguales → copia sin cambios', () => {
  const base: ManeuverKind[] = ['pesaje', 'tacto', 'vacunacion'];
  assert.deepEqual(moveManeuver(base, 0, 0), base);
  assert.deepEqual(moveManeuver(base, -1, 1), base);
  assert.deepEqual(moveManeuver(base, 1, 9), base);
  assert.deepEqual(moveManeuver(base, 9, 1), base);
  // y devuelve una COPIA (no la misma ref), para que React detecte el "cambio" sin sorpresas.
  assert.notEqual(moveManeuver(base, 0, 0), base);
});

// ─── toggleManeuver (orden de selección, R1.12) ──────────────────────────────────────────

test('toggleManeuver: agrega AL FINAL (orden inicial = orden de selección)', () => {
  let chosen: ManeuverKind[] = [];
  chosen = toggleManeuver(chosen, 'pesaje');
  chosen = toggleManeuver(chosen, 'tacto');
  chosen = toggleManeuver(chosen, 'vacunacion');
  assert.deepEqual(chosen, ['pesaje', 'tacto', 'vacunacion']);
});

test('toggleManeuver: re-toggle quita preservando el orden del resto', () => {
  const chosen: ManeuverKind[] = ['pesaje', 'tacto', 'vacunacion'];
  assert.deepEqual(toggleManeuver(chosen, 'tacto'), ['pesaje', 'vacunacion']);
});

test('toggleManeuver: ignora un token desconocido (defensivo)', () => {
  const chosen: ManeuverKind[] = ['pesaje'];
  // @ts-expect-error — token fuera del enum.
  assert.deepEqual(toggleManeuver(chosen, 'xxx'), ['pesaje']);
});

// ─── buildJornadaConfig (R1.13, shape §2.1.1) ────────────────────────────────────────────

test('buildJornadaConfig: guarda maniobras EN ORDEN (drag) bajo la key maniobras', () => {
  const config = buildJornadaConfig(['pesaje', 'tacto', 'vacunacion']);
  assert.deepEqual(config.maniobras, ['pesaje', 'tacto', 'vacunacion']);
  assert.equal('preconfig' in config, false); // sin preconfig vacío
});

test('buildJornadaConfig: incluye preconfig solo si tiene claves', () => {
  const empty = buildJornadaConfig(['tacto'], {});
  assert.equal('preconfig' in empty, false);
  const withPre = buildJornadaConfig(['vacunacion'], { vacunacion: { products: ['Aftosa'] } });
  assert.deepEqual(withPre.preconfig, { vacunacion: { products: ['Aftosa'] } });
});

test('buildJornadaConfig: filtra maniobras desconocidas y deduplica preservando orden', () => {
  const config = buildJornadaConfig([
    'tacto',
    'tacto', // dup
    // @ts-expect-error — token inválido que la UI no debería mandar; lo filtramos defensivo.
    'inexistente',
    'pesaje',
  ]);
  assert.deepEqual(config.maniobras, ['tacto', 'pesaje']);
});

test('R1.13 round-trip: el config armado se re-parsea con extractManeuvers SIN perder orden', () => {
  // El service serializa config a TEXT (JSON.stringify) y al leer parseManeuverConfig+extractManeuvers
  // lo recuperan. Verificamos que el orden de drag sobrevive el round-trip (carga rápida R5.14).
  const order: ManeuverKind[] = ['pesaje', 'sangrado', 'tacto', 'vacunacion'];
  const config = buildJornadaConfig(order, { inseminacion: { default_pajuela: 'Toro 123' } });
  const serialized = JSON.stringify(config);
  // extractManeuvers opera sobre el objeto parseado (parseManeuverConfig lo haría en sessions.ts).
  const reparsed = extractManeuvers(JSON.parse(serialized));
  assert.deepEqual(reparsed, order, 'el orden de maniobras debe sobrevivir serialize→parse');
});

// ─── filterAutocomplete (R1.8) ───────────────────────────────────────────────────────────

test('filterAutocomplete: prefijo vacío → lista deduplicada completa (hasta el límite)', () => {
  assert.deepEqual(
    filterAutocomplete(['Aftosa', 'Mancha', 'Aftosa', 'Carbunclo'], ''),
    ['Aftosa', 'Mancha', 'Carbunclo'],
  );
});

test('filterAutocomplete: filtra por prefijo case-insensitive, excluye el match exacto', () => {
  assert.deepEqual(filterAutocomplete(['Aftosa', 'Aftosa Plus', 'Mancha'], 'aft'), [
    'Aftosa',
    'Aftosa Plus',
  ]);
  // tipeo EXACTO de un valor → no se sugiere a sí mismo (no aporta), pero sí los que lo extienden.
  assert.deepEqual(filterAutocomplete(['Aftosa', 'Aftosa Plus'], 'Aftosa'), ['Aftosa Plus']);
});

test('filterAutocomplete: descarta valores vacíos y respeta el límite', () => {
  assert.deepEqual(filterAutocomplete(['  ', 'A', 'B', 'C', 'D', 'E', 'F'], '', 3), ['A', 'B', 'C']);
});

// ─── splitMultiPreconfig / joinMultiPreconfig (vacunación multi-valor, R1.7) ─────────────────

test('splitMultiPreconfig: parte el string coma-separado en ítems, sin vacíos', () => {
  assert.deepEqual(splitMultiPreconfig('Brucelosis, Aftosa'), ['Brucelosis', 'Aftosa']);
  assert.deepEqual(splitMultiPreconfig('Brucelosis,  , Aftosa, '), ['Brucelosis', 'Aftosa']);
  assert.deepEqual(splitMultiPreconfig(''), []);
  assert.deepEqual(splitMultiPreconfig('   '), []);
});

test('splitMultiPreconfig: deduplica case-insensitive preservando el primer casing', () => {
  assert.deepEqual(splitMultiPreconfig('Aftosa, aftosa, AFTOSA, Mancha'), ['Aftosa', 'Mancha']);
});

test('joinMultiPreconfig: une los ítems en el string persistido (dedup + trim)', () => {
  assert.equal(joinMultiPreconfig(['Brucelosis', 'Aftosa']), 'Brucelosis, Aftosa');
  assert.equal(joinMultiPreconfig([' Brucelosis ', 'brucelosis', 'Aftosa']), 'Brucelosis, Aftosa');
  assert.equal(joinMultiPreconfig([]), '');
});

test('multi preconfig round-trip: split(join(x)) === dedup/trim de x', () => {
  const items = [' Brucelosis ', 'Aftosa', 'aftosa', 'Mancha'];
  const joined = joinMultiPreconfig(items);
  assert.deepEqual(splitMultiPreconfig(joined), ['Brucelosis', 'Aftosa', 'Mancha']);
  // y maneuverDetail muestra el string tal cual inline + en el resumen (R1.9).
  assert.equal(maneuverDetail({ vacunacion: joined }, 'vacunacion'), 'Brucelosis, Aftosa, Mancha');
});
