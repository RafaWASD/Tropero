// Tests de la lógica PURA del selector de meses de servicio (spec 03 Stream B / B1 — DD-PSC-5).
// node:test. Foco en los BORDES que el dominio offline-first/multi-tenant exige + la CONTIGÜIDAD POR
// CONSTRUCCIÓN (RPSC.2.3/RPSC.2.8/RPSC.2.9, constraint nuevo Raf 2026-06-23):
//   - parseo TOLERANTE del TEXT/JSON de PowerSync (RPSC.3.7): null/''/no-array/corrupto → null ("sin
//     configurar"); array vacío → [] ("no hace servicio"); fuera de 1–12 → se filtra; NUNCA tira.
//   - mapeo set→array ordenado/único/en-rango (RPSC.2.6).
//   - isMonthChecked (pintar chips del run; null = sin configurar).
//   - default de primavera (RPSC.2.2) + atajos contiguos + atajo activo (RPSC.3.2: "sin configurar" no resalta).
//   - isContiguousWrap: contiguo simple, contiguo con WRAP (Nov-Dic-Ene), disjunto → false, vacío/1/los 12.
//   - buildContiguousRun: run inicio→fin hacia adelante con WRAP; vuelta completa → los 12.
//   - serviceRunBounds: extremos en orden de servicio (incl. wrap), null si disjunto/vacío.
//   - nextRangeSelection: máquina de 2 taps (inicio→fin), 3er tap reinicia, tap único = 1 mes, wrap.
//   - describeServicePeriod: label "Oct → Dic" / "Nov → Ene" / "Todo el año" / "sin configurar" / disjunto.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPRING_DEFAULT,
  ALL_MONTHS,
  MIN_MONTH,
  MAX_MONTH,
  MONTHS_IN_YEAR,
  monthShortLabel,
  monthFullLabel,
  parseServiceMonths,
  toServiceMonthsArray,
  isMonthChecked,
  isContiguousWrap,
  buildContiguousRun,
  serviceRunBounds,
  SERVICE_MONTHS_SHORTCUTS,
  sameMonthSet,
  activeShortcutId,
  initialRangeSelection,
  nextRangeSelection,
  applyShortcutSelection,
  isPendingAnchor,
  describeServicePeriod,
  type RangeSelection,
} from './service-months';

// ─── Constantes de dominio ──────────────────────────────────────────────────────────────────────

test('SPRING_DEFAULT = Oct/Nov/Dic (RPSC.2.2)', () => {
  assert.deepEqual([...SPRING_DEFAULT], [10, 11, 12]);
});

test('ALL_MONTHS = 1..12 en orden', () => {
  assert.deepEqual([...ALL_MONTHS], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(MIN_MONTH, 1);
  assert.equal(MAX_MONTH, 12);
  assert.equal(MONTHS_IN_YEAR, 12);
});

// ─── Etiquetas es-AR ──────────────────────────────────────────────────────────────────────────────

test('monthShortLabel: 3 letras capitalizadas es-AR', () => {
  assert.equal(monthShortLabel(1), 'Ene');
  assert.equal(monthShortLabel(10), 'Oct');
  assert.equal(monthShortLabel(12), 'Dic');
});

test('monthShortLabel / monthFullLabel: fuera de rango → ""', () => {
  assert.equal(monthShortLabel(0), '');
  assert.equal(monthShortLabel(13), '');
  assert.equal(monthShortLabel(1.5), '');
  assert.equal(monthFullLabel(0), '');
  assert.equal(monthFullLabel(13), '');
});

test('monthFullLabel: nombre completo es-AR', () => {
  assert.equal(monthFullLabel(1), 'Enero');
  assert.equal(monthFullLabel(9), 'Septiembre');
  assert.equal(monthFullLabel(12), 'Diciembre');
});

// ─── parseServiceMonths — el corazón tolerante (RPSC.3.7) ───────────────────────────────────────────

test('parse: null/undefined → null ("sin configurar")', () => {
  assert.equal(parseServiceMonths(null), null);
  assert.equal(parseServiceMonths(undefined), null);
});

test('parse: string vacía / solo espacios → null', () => {
  assert.equal(parseServiceMonths(''), null);
  assert.equal(parseServiceMonths('   '), null);
});

test('parse: JSON corrupto → null (no tira)', () => {
  assert.equal(parseServiceMonths('[10,11,'), null);
  assert.equal(parseServiceMonths('not json'), null);
  assert.equal(parseServiceMonths('{broken'), null);
});

test('parse: TEXT JSON de PowerSync "[10,11,12]" → [10,11,12]', () => {
  assert.deepEqual(parseServiceMonths('[10,11,12]'), [10, 11, 12]);
});

test('parse: array-literal de Postgres "{10,11,12}" → [10,11,12]', () => {
  assert.deepEqual(parseServiceMonths('{10,11,12}'), [10, 11, 12]);
  assert.deepEqual(parseServiceMonths('{}'), []); // array vacío literal → [] (no null)
});

test('parse: strings numéricas dentro del JSON ("10") → number', () => {
  assert.deepEqual(parseServiceMonths('["10","11","12"]'), [10, 11, 12]);
});

test('parse: array JS ya parseado (no string) también funciona', () => {
  assert.deepEqual(parseServiceMonths([10, 11, 12]), [10, 11, 12]);
});

test('parse: array vacío → [] ("no hace servicio", distinto de null)', () => {
  assert.deepEqual(parseServiceMonths([]), []);
  assert.deepEqual(parseServiceMonths('[]'), []);
});

test('parse: ordena y deduplica', () => {
  assert.deepEqual(parseServiceMonths('[12,10,11,10]'), [10, 11, 12]);
  assert.deepEqual(parseServiceMonths([3, 1, 2, 2, 1]), [1, 2, 3]);
});

test('parse: filtra valores fuera de 1–12 / no enteros (los válidos quedan)', () => {
  assert.deepEqual(parseServiceMonths('[0,10,13,11,12,99]'), [10, 11, 12]);
  assert.deepEqual(parseServiceMonths([1.5, 2, 3]), [2, 3]);
  assert.deepEqual(parseServiceMonths([-1, 5]), [5]);
});

test('parse: array de solo basura → [] (había intención de array, no null)', () => {
  assert.deepEqual(parseServiceMonths('[0,13,99]'), []);
  assert.deepEqual(parseServiceMonths([true, 'x', null, {}]), []);
});

test('parse: NaN / Infinity en el array se filtran', () => {
  assert.deepEqual(parseServiceMonths([NaN, Infinity, 6]), [6]);
});

test('parse: no-array (objeto / número suelto / bool) → null', () => {
  assert.equal(parseServiceMonths('{"a":1}'), null);
  assert.equal(parseServiceMonths('10'), null); // número suelto, no array
  assert.equal(parseServiceMonths(10), null);
  assert.equal(parseServiceMonths(true), null);
  assert.equal(parseServiceMonths({ months: [10] }), null);
});

test('parse: los 12 meses (servicio continuo)', () => {
  assert.deepEqual(parseServiceMonths('[1,2,3,4,5,6,7,8,9,10,11,12]'), [...ALL_MONTHS]);
});

test('parse: un dato disjunto persistido se LEE tal cual (no se filtra — RPSC.2.9)', () => {
  // La contigüidad la enforza el SELECTOR; el parseo no rechaza un set disjunto histórico.
  assert.deepEqual(parseServiceMonths('[10,3]'), [3, 10]);
});

// ─── toServiceMonthsArray — set → array para la RPC (RPSC.2.6) ───────────────────────────────────────

test('toServiceMonthsArray: set → ordenado, único, en rango', () => {
  assert.deepEqual(toServiceMonthsArray(new Set([12, 10, 11])), [10, 11, 12]);
  assert.deepEqual(toServiceMonthsArray(new Set([1])), [1]);
});

test('toServiceMonthsArray: set vacío → [] (no hace servicio)', () => {
  assert.deepEqual(toServiceMonthsArray(new Set()), []);
});

test('toServiceMonthsArray: filtra defensivamente fuera de rango / no entero', () => {
  assert.deepEqual(toServiceMonthsArray(new Set([0, 5, 13, 1.5, 8])), [5, 8]);
});

test('toServiceMonthsArray: los 12', () => {
  assert.deepEqual(toServiceMonthsArray(new Set(ALL_MONTHS)), [...ALL_MONTHS]);
});

// ─── isMonthChecked — pintar el chip ────────────────────────────────────────────────────────────────

test('isMonthChecked: true sólo para los presentes', () => {
  assert.equal(isMonthChecked([10, 11, 12], 11), true);
  assert.equal(isMonthChecked([10, 11, 12], 1), false);
});

test('isMonthChecked: null ("sin configurar") → ningún mes en el run', () => {
  for (const m of ALL_MONTHS) assert.equal(isMonthChecked(null, m), false);
});

test('isMonthChecked: [] ("no hace servicio") → ningún mes en el run', () => {
  for (const m of ALL_MONTHS) assert.equal(isMonthChecked([], m), false);
});

// ─── isContiguousWrap — la INVARIANTE del constraint nuevo (RPSC.2.9) ────────────────────────────────

test('isContiguousWrap: vacío → true (ninguno, trivial)', () => {
  assert.equal(isContiguousWrap([]), true);
});

test('isContiguousWrap: un mes → true', () => {
  assert.equal(isContiguousWrap([3]), true);
  assert.equal(isContiguousWrap([12]), true);
});

test('isContiguousWrap: contiguo SIMPLE → true', () => {
  assert.equal(isContiguousWrap([10, 11, 12]), true); // primavera
  assert.equal(isContiguousWrap([6, 7]), true); // otoño
  assert.equal(isContiguousWrap([3, 4, 5, 6]), true);
});

test('isContiguousWrap: contiguo con WRAP de fin de año → true (CLAVE)', () => {
  assert.equal(isContiguousWrap([11, 12, 1]), true); // Nov-Dic-Ene
  assert.equal(isContiguousWrap([12, 1]), true); // Dic-Ene
  assert.equal(isContiguousWrap([12, 1, 2]), true); // Dic-Ene-Feb
  assert.equal(isContiguousWrap([11, 12, 1, 2, 3]), true); // wrap más largo
});

test('isContiguousWrap: orden de entrada no importa (se ordena)', () => {
  assert.equal(isContiguousWrap([1, 12, 11]), true); // mismo set que [11,12,1]
  assert.equal(isContiguousWrap([12, 10, 11]), true);
});

test('isContiguousWrap: los 12 → true (continuo)', () => {
  assert.equal(isContiguousWrap([...ALL_MONTHS]), true);
});

test('isContiguousWrap: DISJUNTO → false (CLAVE — el constraint que se enforza)', () => {
  assert.equal(isContiguousWrap([10, 3]), false); // Oct y Mar separados
  assert.equal(isContiguousWrap([1, 2, 5, 6]), false); // primavera + otoño en un set = PROHIBIDO
  assert.equal(isContiguousWrap([10, 11, 12, 6, 7]), false); // primavera + otoño juntos
  assert.equal(isContiguousWrap([1, 3]), false); // Ene y Mar (sin Feb) — hueco interno
  assert.equal(isContiguousWrap([1, 2, 4]), false); // hueco en Mar
});

test('isContiguousWrap: null → false ("sin configurar" no es un período)', () => {
  assert.equal(isContiguousWrap(null), false);
});

// ─── buildContiguousRun — run inicio→fin hacia adelante con WRAP (RPSC.2.8) ───────────────────────────

test('buildContiguousRun: simple Oct→Dic', () => {
  assert.deepEqual(buildContiguousRun(10, 12), [10, 11, 12]);
});

test('buildContiguousRun: WRAP Nov→Ene → [1,11,12] ordenado asc', () => {
  assert.deepEqual(buildContiguousRun(11, 1), [1, 11, 12]); // Nov-Dic-Ene
});

test('buildContiguousRun: WRAP Dic→Feb', () => {
  assert.deepEqual(buildContiguousRun(12, 2), [1, 2, 12]); // Dic-Ene-Feb
});

test('buildContiguousRun: un mes (inicio == fin)', () => {
  assert.deepEqual(buildContiguousRun(10, 10), [10]);
  assert.deepEqual(buildContiguousRun(1, 1), [1]);
});

test('buildContiguousRun: vuelta COMPLETA (fin justo antes del inicio) → los 12', () => {
  assert.deepEqual(buildContiguousRun(10, 9), [...ALL_MONTHS]);
  assert.deepEqual(buildContiguousRun(1, 12), [...ALL_MONTHS]);
});

test('buildContiguousRun: el resultado SIEMPRE es contiguo (propiedad)', () => {
  for (let s = 1; s <= 12; s += 1) {
    for (let e = 1; e <= 12; e += 1) {
      assert.equal(isContiguousWrap(buildContiguousRun(s, e)), true, `run ${s}->${e} debe ser contiguo`);
    }
  }
});

test('buildContiguousRun: fuera de rango → []', () => {
  assert.deepEqual(buildContiguousRun(0, 5), []);
  assert.deepEqual(buildContiguousRun(5, 13), []);
  assert.deepEqual(buildContiguousRun(1.5, 5), []);
});

// ─── serviceRunBounds — extremos en orden de SERVICIO (incl. wrap) ───────────────────────────────────

test('serviceRunBounds: simple → {start:10, end:12}', () => {
  assert.deepEqual(serviceRunBounds([10, 11, 12]), { start: 10, end: 12 });
});

test('serviceRunBounds: WRAP [1,11,12] → {start:11, end:1} (Nov → Ene)', () => {
  assert.deepEqual(serviceRunBounds([1, 11, 12]), { start: 11, end: 1 });
});

test('serviceRunBounds: un mes → {start:m, end:m}', () => {
  assert.deepEqual(serviceRunBounds([7]), { start: 7, end: 7 });
});

test('serviceRunBounds: los 12 → {start:1, end:12}', () => {
  assert.deepEqual(serviceRunBounds([...ALL_MONTHS]), { start: 1, end: 12 });
});

test('serviceRunBounds: disjunto → null (no hay run bien definido)', () => {
  assert.equal(serviceRunBounds([10, 3]), null);
  assert.equal(serviceRunBounds([1, 2, 5, 6]), null);
});

test('serviceRunBounds: vacío / null → null', () => {
  assert.equal(serviceRunBounds([]), null);
  assert.equal(serviceRunBounds(null), null);
});

test('serviceRunBounds: round-trip con buildContiguousRun (start/end se recuperan)', () => {
  for (let s = 1; s <= 12; s += 1) {
    for (let e = 1; e <= 12; e += 1) {
      const run = buildContiguousRun(s, e);
      if (run.length >= 12) continue; // los 12 normaliza a {1,12} (no al s/e original)
      assert.deepEqual(serviceRunBounds(run), { start: s, end: e }, `bounds de ${s}->${e}`);
    }
  }
});

// ─── Atajos + atajo activo (Gate 0 §6 / RPSC.3.2) ───────────────────────────────────────────────────

test('SERVICE_MONTHS_SHORTCUTS: ids y conjuntos esperados', () => {
  const byId = Object.fromEntries(SERVICE_MONTHS_SHORTCUTS.map((s) => [s.id, [...s.months]]));
  assert.deepEqual(byId.primavera, [10, 11, 12]);
  assert.deepEqual(byId.otono, [6, 7]);
  assert.deepEqual(byId.todo, [...ALL_MONTHS]);
  assert.deepEqual(byId.ninguno, []);
});

test('SERVICE_MONTHS_SHORTCUTS: TODOS los atajos son contiguos (RPSC.2.8)', () => {
  for (const s of SERVICE_MONTHS_SHORTCUTS) {
    assert.equal(isContiguousWrap([...s.months]), true, `atajo ${s.id} debe ser contiguo`);
  }
});

test('sameMonthSet: compara como SET (ignora orden/dups)', () => {
  assert.equal(sameMonthSet([12, 10, 11], [10, 11, 12]), true);
  assert.equal(sameMonthSet([10, 10, 11, 12], [10, 11, 12]), true);
  assert.equal(sameMonthSet([10, 11], [10, 11, 12]), false);
});

test('sameMonthSet: [] coincide con [] (Ninguno explícito)', () => {
  assert.equal(sameMonthSet([], []), true);
});

test('sameMonthSet: null nunca coincide (ni con [])', () => {
  assert.equal(sameMonthSet(null, []), false);
  assert.equal(sameMonthSet(null, [10, 11, 12]), false);
});

test('activeShortcutId: primavera tildada → "primavera"', () => {
  assert.equal(activeShortcutId([10, 11, 12]), 'primavera');
});

test('activeShortcutId: los 12 → "todo"', () => {
  assert.equal(activeShortcutId([...ALL_MONTHS]), 'todo');
});

test('activeShortcutId: [] explícito → "ninguno"', () => {
  assert.equal(activeShortcutId([]), 'ninguno');
});

test('activeShortcutId: selección custom (Nov-Dic-Ene) → null', () => {
  assert.equal(activeShortcutId([11, 12, 1]), null);
});

test('activeShortcutId: "sin configurar" (null) NO resalta nada (RPSC.3.2)', () => {
  // Clave: un rodeo nunca configurado no debe resaltar "Ninguno" (sería "no hace servicio", mentira).
  assert.equal(activeShortcutId(null), null);
});

test('activeShortcutId: otoño (Jun/Jul) → "otono"', () => {
  assert.equal(activeShortcutId([6, 7]), 'otono');
  assert.equal(activeShortcutId([7, 6]), 'otono'); // orden no importa
});

// ─── Interacción de rango "inicio → fin" — CONTIGUA POR CONSTRUCCIÓN (RPSC.2.8) ──────────────────────

test('initialRangeSelection: value se vuelve el run, anchor arranca null', () => {
  assert.deepEqual(initialRangeSelection([10, 11, 12]), { months: [10, 11, 12], anchor: null });
  assert.deepEqual(initialRangeSelection(null), { months: [], anchor: null });
  assert.deepEqual(initialRangeSelection([]), { months: [], anchor: null });
});

test('nextRangeSelection: 1er tap INICIA un período de 1 mes (anchor = ese mes)', () => {
  const s0 = initialRangeSelection(null);
  const s1 = nextRangeSelection(s0, 10);
  assert.deepEqual(s1, { months: [10], anchor: 10 });
});

test('nextRangeSelection: 2º tap CIERRA el período hacia adelante (Oct→Dic)', () => {
  let s: RangeSelection = initialRangeSelection(null);
  s = nextRangeSelection(s, 10); // inicio Oct
  s = nextRangeSelection(s, 12); // fin Dic
  assert.deepEqual(s, { months: [10, 11, 12], anchor: null });
});

test('nextRangeSelection: 2º tap con WRAP (Nov→Ene) → [1,11,12]', () => {
  let s: RangeSelection = initialRangeSelection(null);
  s = nextRangeSelection(s, 11); // inicio Nov
  s = nextRangeSelection(s, 1); // fin Ene (wrap)
  assert.deepEqual(s, { months: [1, 11, 12], anchor: null });
  assert.equal(isContiguousWrap(s.months), true);
});

test('nextRangeSelection: tap ÚNICO = período de 1 mes (queda con anchor a la espera)', () => {
  const s = nextRangeSelection(initialRangeSelection(null), 5);
  assert.deepEqual(s.months, [5]); // ya es un run de 1 mes válido
  assert.equal(s.anchor, 5); // esperando un eventual fin; si no, queda en 1 mes
});

test('nextRangeSelection: 3er tap REINICIA un período nuevo (no extiende el cerrado)', () => {
  let s: RangeSelection = initialRangeSelection(null);
  s = nextRangeSelection(s, 10); // inicio
  s = nextRangeSelection(s, 12); // cierra Oct→Dic (anchor null)
  s = nextRangeSelection(s, 3); // 3er tap → NUEVO inicio en Mar
  assert.deepEqual(s, { months: [3], anchor: 3 });
});

test('nextRangeSelection: fin == inicio en el 2º tap → período de 1 mes', () => {
  let s: RangeSelection = initialRangeSelection(null);
  s = nextRangeSelection(s, 7); // inicio Jul
  s = nextRangeSelection(s, 7); // fin Jul → 1 mes
  assert.deepEqual(s, { months: [7], anchor: null });
});

test('nextRangeSelection: fin "hacia atrás" en calendario envuelve (Dic→Feb, no Feb..Dic)', () => {
  let s: RangeSelection = initialRangeSelection(null);
  s = nextRangeSelection(s, 12); // inicio Dic
  s = nextRangeSelection(s, 2); // fin Feb → wrap Dic-Ene-Feb (3 meses), NO los 11 de Feb..Dic
  assert.deepEqual(s, { months: [1, 2, 12], anchor: null });
});

test('nextRangeSelection: NUNCA produce un set disjunto (propiedad sobre todos los pares)', () => {
  for (let a = 1; a <= 12; a += 1) {
    for (let b = 1; b <= 12; b += 1) {
      let s: RangeSelection = initialRangeSelection(null);
      s = nextRangeSelection(s, a);
      s = nextRangeSelection(s, b);
      assert.equal(isContiguousWrap(s.months), true, `inicio ${a} fin ${b} debe ser contiguo`);
    }
  }
});

test('nextRangeSelection: tap fuera de rango se ignora (no muta)', () => {
  const s0 = initialRangeSelection([10, 11, 12]);
  assert.deepEqual(nextRangeSelection(s0, 0), s0);
  assert.deepEqual(nextRangeSelection(s0, 13), s0);
  assert.deepEqual(nextRangeSelection(s0, 1.5), s0);
});

test('nextRangeSelection: partir de un value cargado → 1er tap reinicia (no extiende)', () => {
  // Edición de un rodeo que ya tiene Oct-Dic: tocar Mar NO arma Oct..Mar, INICIA un período nuevo en Mar.
  const s0 = initialRangeSelection([10, 11, 12]);
  const s1 = nextRangeSelection(s0, 3);
  assert.deepEqual(s1, { months: [3], anchor: 3 });
});

test('applyShortcutSelection: setea el run del atajo y limpia el anchor', () => {
  const primavera = SERVICE_MONTHS_SHORTCUTS.find((s) => s.id === 'primavera')!;
  assert.deepEqual(applyShortcutSelection(primavera), { months: [10, 11, 12], anchor: null });
  const ninguno = SERVICE_MONTHS_SHORTCUTS.find((s) => s.id === 'ninguno')!;
  assert.deepEqual(applyShortcutSelection(ninguno), { months: [], anchor: null });
});

test('applyShortcutSelection: descarta un período en progreso (anchor pendiente)', () => {
  let s: RangeSelection = initialRangeSelection(null);
  s = nextRangeSelection(s, 5); // inicio pendiente en Mayo
  const todo = SERVICE_MONTHS_SHORTCUTS.find((x) => x.id === 'todo')!;
  s = applyShortcutSelection(todo);
  assert.deepEqual(s, { months: [...ALL_MONTHS], anchor: null }); // el anchor de Mayo se descartó
});

test('isPendingAnchor: true sólo para el mes anchor a la espera del fin', () => {
  let s: RangeSelection = initialRangeSelection(null);
  s = nextRangeSelection(s, 8); // inicio Ago, esperando fin
  assert.equal(isPendingAnchor(s, 8), true);
  assert.equal(isPendingAnchor(s, 9), false);
  s = nextRangeSelection(s, 10); // cierra → anchor null
  assert.equal(isPendingAnchor(s, 8), false);
});

// ─── describeServicePeriod — el LABEL que el usuario VE (Nielsen #1, RPSC.2.8) ───────────────────────

test('describeServicePeriod: null → "Todavía sin configurar" · 0', () => {
  assert.deepEqual(describeServicePeriod(null), { text: 'Todavía sin configurar', count: 0 });
});

test('describeServicePeriod: [] → "No hace servicio" · 0', () => {
  assert.deepEqual(describeServicePeriod([]), { text: 'No hace servicio', count: 0 });
});

test('describeServicePeriod: los 12 → "Todo el año" · 12', () => {
  assert.deepEqual(describeServicePeriod([...ALL_MONTHS]), { text: 'Todo el año', count: 12 });
});

test('describeServicePeriod: 1 mes → "Oct" · 1', () => {
  assert.deepEqual(describeServicePeriod([10]), { text: 'Oct', count: 1 });
});

test('describeServicePeriod: contiguo simple → "Oct → Dic" · 3', () => {
  assert.deepEqual(describeServicePeriod([10, 11, 12]), { text: 'Oct → Dic', count: 3 });
});

test('describeServicePeriod: WRAP → "Nov → Ene" · 3 (orden de servicio, no min/max)', () => {
  assert.deepEqual(describeServicePeriod([1, 11, 12]), { text: 'Nov → Ene', count: 3 });
  assert.deepEqual(describeServicePeriod([11, 12, 1]), { text: 'Nov → Ene', count: 3 }); // orden de entrada no importa
});

test('describeServicePeriod: otoño → "Jun → Jul" · 2', () => {
  assert.deepEqual(describeServicePeriod([6, 7]), { text: 'Jun → Jul', count: 2 });
});

test('describeServicePeriod: disjunto persistido → cuenta sin inventar rango', () => {
  // Sólo posible desde un dato persistido; la grilla nunca produce esto.
  assert.deepEqual(describeServicePeriod([10, 3]), { text: '2 meses (sin período definido)', count: 2 });
});
