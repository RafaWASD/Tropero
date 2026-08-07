// GUARD: el "valor vigente" de CADA medición desempata igual — y nunca por el UUID del evento.
//
// ── EL BUG QUE CIERRA (🔴 A.5, QA de maniobras en device 2026-08-06) ──────────────────────────────────
// `deriveCurrentState` tenía DOS desempates: la rama reproductiva usaba la escalera buena (`seq` →
// `created_at` → `eventId`) y las ramas de peso y condición corporal saltaban directo a `eventId`, que es
// un **UUID v4 random**. Como `event_date` es una columna `date` SIN hora, dos cargas del mismo día
// SIEMPRE empatan ahí ⇒ el vigente se decidía a cara o ceca. Medido en `PERF-02001`, que pasó dos veces
// por la manga el mismo día: el peso salió bien (318) y la condición mal (2,25 en vez de 3,75). Repesar un
// animal es rutina, y "Peso actual" es de lo que se alimenta el pilar de analytics.
//
// ── POR QUÉ UN GUARD, Y POR QUÉ SOBRE LA CLASE ───────────────────────────────────────────────────────
// El bug no fue "una rama mal escrita": fue **una rama arreglada y las otras no**. El fix del desempate
// reproductivo (TAREA 2) resolvió su instancia y dejó las hermanas rotas, y nada se puso rojo. Con un test
// por rama volvería a pasar: la rama que se agregue mañana (una nueva medición vigente en la ficha) nace
// con el mismo agujero y nadie se entera.
// Por eso el guard NO enumera las ramas rotas: (a) DERIVA del código la lista de kinds que
// `deriveCurrentState` maneja y exige que estén todos en la tabla de este archivo — una rama nueva nace en
// ROJO hasta que alguien la declare; (b) para cada uno EJECUTA la sonda del bug (dos eventos del mismo día,
// el VIEJO con el eventId lexicográficamente MAYOR) y exige que gane el nuevo; y (c) verifica
// estructuralmente que hay UN SOLO comparador y que su escalera mira `seq` y `createdAt` ANTES que
// `eventId`.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from './strip-comments';
import { deriveCurrentState, parseTimeline, type CurrentState, type TimelineRow } from './event-timeline.ts';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SOURCE = join(HERE, 'event-timeline.ts');

/** Cuerpo `{…}` que arranca en la primera llave desde `from`, por balanceo. */
function braceBody(src: string, from: number): string {
  const open = src.indexOf('{', from);
  assert.ok(open >= 0, 'no se encontró la llave de apertura');
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error('llave sin cerrar');
}

/**
 * Cuerpo de la función declarada en `at`. Salta la LISTA DE PARÁMETROS antes de buscar la llave: una firma
 * con un tipo objeto inline (`best: { item: …; ms: number } | null`) tiene llaves ANTES del cuerpo, y
 * tomarlas por cuerpo dejaba al guard leyendo cuatro palabras y fallando por la razón equivocada.
 */
function functionBody(src: string, at: number): string {
  let i = src.indexOf('(', at);
  assert.ok(i >= 0, 'la función tiene que tener lista de parámetros');
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) {
      i++;
      break;
    }
  }
  return braceBody(src, i);
}

function sourceCode(): string {
  return stripSourceComments(readFileSync(SOURCE, 'utf8'));
}

function deriveCurrentStateBody(): string {
  const code = sourceCode();
  const at = code.indexOf('export function deriveCurrentState');
  assert.ok(at >= 0, '`deriveCurrentState` tiene que existir en event-timeline.ts con ese nombre');
  return functionBody(code, at);
}

/**
 * Los `kind` que `deriveCurrentState` maneja, leídos DEL CÓDIGO (no de una lista escrita a mano).
 * Tolera las tres formas de escribir la comparación (`===`/`==`, comillas simples/dobles/backtick).
 *
 * ⚠️ Y DECLARA LO QUE NO VE: si en el cuerpo aparece un `it.kind` que este extractor no entiende (por
 * ejemplo pasado antes a una variable, `const k = it.kind`), el conteo no cuadra y el test de abajo se pone
 * ROJO en vez de reportar una rama de menos. Un extractor que se queda corto en silencio es la misma clase
 * de falla que este guard existe para cerrar.
 */
const KIND_COMPARISON = /\bit\.kind\s*===?\s*['"`]([a-z_]+)['"`]/g;

function handledKinds(): string[] {
  const body = deriveCurrentStateBody();
  const found = new Set<string>();
  for (const m of body.matchAll(KIND_COMPARISON)) found.add(m[1]);
  return [...found].sort();
}

/** Cuántas veces se nombra `it.kind` vs. cuántas entiende el extractor (tienen que coincidir). */
function kindMentionAudit(): { mencionado: number; entendido: number } {
  const body = deriveCurrentStateBody();
  return {
    mencionado: (body.match(/\bit\.kind\b/g) ?? []).length,
    entendido: [...body.matchAll(KIND_COMPARISON)].length,
  };
}

// ── LA TABLA DE RAMAS ────────────────────────────────────────────────────────────────────────────────
// Una entrada por medición vigente. `row` arma un evento del kind; `read` saca de `CurrentState` el valor
// que esa rama produce. Si `deriveCurrentState` maneja un kind que no está acá, el primer test se pone
// rojo — que es exactamente lo que tiene que pasar con la rama que se agregue mañana.
type Probe = {
  kind: string;
  /** Un evento de ese kind. `old` distingue el valor viejo del nuevo para poder asertar cuál ganó. */
  row: (args: { id: string; date: string; createdAt: string | null; seq: number; old: boolean }) => TimelineRow;
  /** El valor observable en `CurrentState` (string para comparar sin ambigüedad). */
  read: (s: CurrentState) => string | undefined;
  /** Lo que tiene que quedar vigente = el valor del evento NUEVO. */
  expectNew: string;
};

const PROBES: Probe[] = [
  {
    kind: 'weight',
    row: ({ id, date, createdAt, seq, old }) => ({
      event_kind: 'weight',
      event_id: id,
      event_date: date,
      created_at: createdAt as string,
      seq,
      payload: { weight_kg: old ? 312 : 318 },
    }),
    read: (s) => (s.weight ? String(s.weight.kg) : undefined),
    expectNew: '318',
  },
  {
    kind: 'condition_score',
    row: ({ id, date, createdAt, seq, old }) => ({
      event_kind: 'condition_score',
      event_id: id,
      event_date: date,
      created_at: createdAt as string,
      seq,
      payload: { score: old ? 2.25 : 3.75 },
    }),
    read: (s) => (s.conditionScore ? String(s.conditionScore.score) : undefined),
    expectNew: '3.75',
  },
  {
    kind: 'reproductive',
    row: ({ id, date, createdAt, seq, old }) => ({
      event_kind: 'reproductive',
      event_id: id,
      event_date: date,
      created_at: createdAt as string,
      seq,
      payload: { event_type: 'tacto', pregnancy_status: old ? 'empty' : 'large' },
    }),
    read: (s) => (s.pregnancy ? `${s.pregnancy.kind}:${'status' in s.pregnancy ? s.pregnancy.status : ''}` : undefined),
    expectNew: 'pregnant:large',
  },
];

test('la tabla de ramas cubre TODOS los kinds que deriveCurrentState maneja (una rama nueva nace en rojo)', () => {
  assert.deepEqual(
    handledKinds(),
    PROBES.map((p) => p.kind).sort(),
    'Se agregó (o se quitó) una medición vigente en `deriveCurrentState` sin declararla acá. Agregá su ' +
      'entrada a PROBES: el desempate de una rama nueva es exactamente donde volvió a aparecer este bug ' +
      '(la rama reproductiva se arregló y las otras dos quedaron rotas, sin que nada se pusiera rojo).',
  );
  assert.ok(PROBES.length >= 3, 'la tabla no puede quedar vacía (sería un guard que no mira nada)');

  // Y el extractor declara lo que NO entiende: si alguien ramifica por un `it.kind` en una forma que este
  // regex no lee (a una variable, con un switch sobre otra expresión), el conteo no cuadra y esto cae.
  const { mencionado, entendido } = kindMentionAudit();
  assert.equal(
    entendido,
    mencionado,
    `\`deriveCurrentState\` nombra \`it.kind\` ${mencionado} veces y este guard solo entiende ${entendido}. ` +
      'Hay una ramificación que el extractor NO ve, así que la tabla de arriba puede estar incompleta sin ' +
      'que nada se ponga rojo. Escribí la comparación en la forma idiomática (`it.kind === \'x\'`) o ' +
      'enseñale la forma nueva al extractor.',
  );
});

for (const probe of PROBES) {
  test(`A.5 [${probe.kind}]: con dos cargas del MISMO día gana la última, no el UUID más alto`, () => {
    // El VIEJO lleva el eventId lexicográficamente MAYOR: si alguien vuelve a desempatar por `eventId`,
    // gana el viejo y este test cae. Sin esa elección, la sonda pasaría con el bug puesto (que es
    // literalmente cómo el bug llegó al device: en el peso la moneda salió bien).
    const rows = [
      probe.row({ id: 'zzz-viejo', date: '2026-08-06', createdAt: '2026-08-06T22:13:00Z', seq: 0, old: true }),
      probe.row({ id: 'aaa-nuevo', date: '2026-08-06', createdAt: '2026-08-06T22:40:00Z', seq: 1, old: false }),
    ];
    assert.equal(probe.read(deriveCurrentState(parseTimeline(rows))), probe.expectNew);
    // Y el orden de entrada no puede cambiarlo.
    assert.equal(probe.read(deriveCurrentState(parseTimeline([...rows].reverse()))), probe.expectNew);
  });

  test(`A.5 [${probe.kind}]: sin \`seq\` el desempate sigue siendo por created_at (no por UUID)`, () => {
    const rows = [
      probe.row({ id: 'zzz-viejo', date: '2026-08-06', createdAt: '2026-08-06T22:13:00Z', seq: 0, old: true }),
      probe.row({ id: 'aaa-nuevo', date: '2026-08-06', createdAt: '2026-08-06T22:40:00Z', seq: 1, old: false }),
    ].map((r) => {
      const { seq: _seq, ...rest } = r;
      return rest as TimelineRow;
    });
    assert.equal(probe.read(deriveCurrentState(parseTimeline(rows))), probe.expectNew);
  });
}

test('deriveCurrentState no desempata por su cuenta: delega en UN comparador, el mismo para todas', () => {
  const body = deriveCurrentStateBody();
  // (a) Ni una mención de `eventId` en el cuerpo: comparar ids ahí adentro ES el bug.
  assert.doesNotMatch(
    body,
    /\beventId\b/,
    'El cuerpo de `deriveCurrentState` no puede nombrar `eventId`: el desempate vive en el comparador ' +
      'compartido, y un id que se compara suelto en una rama es cómo nació este bug.',
  );
  // (b) Un solo comparador, invocado por TODAS las ramas.
  const calls = [...body.matchAll(/\bis(?:Newer|Later)[A-Za-z]*\s*\(/g)].map((m) => m[0].replace(/\s*\($/, ''));
  const distinct = [...new Set(calls)];
  assert.equal(
    distinct.length,
    1,
    `las ramas usan ${distinct.length} comparadores distintos (${distinct.join(', ')}); tiene que ser UNO. ` +
      'Dos comparadores es literalmente el estado que produjo el bug: uno se arregla y el otro no.',
  );
  assert.equal(
    calls.length,
    PROBES.length,
    `el comparador se llama ${calls.length} veces y hay ${PROBES.length} ramas: alguna rama no lo está usando`,
  );
});

test('el comparador mira `seq` y `created_at` ANTES que `eventId` (la escalera, no solo los ingredientes)', () => {
  const code = sourceCode();
  const at = code.indexOf('function isNewerItem');
  assert.ok(at >= 0, 'el comparador compartido tiene que llamarse `isNewerItem`');
  const body = functionBody(code, at);
  const iSeq = body.indexOf('seq');
  const iCreated = body.indexOf('createdAt');
  const iId = body.indexOf('eventId');
  assert.ok(iSeq >= 0, 'la escalera tiene que consultar `seq` (orden de inserción local)');
  assert.ok(iCreated >= 0, 'la escalera tiene que consultar `createdAt` (instante real de creación)');
  assert.ok(iId >= 0, '`eventId` sigue siendo el último recurso estable');
  assert.ok(
    iSeq < iId && iCreated < iId,
    'El `eventId` es un UUID v4 RANDOM: solo puede ser el ÚLTIMO escalón. Si se consulta antes que `seq` ' +
      'o que `createdAt`, el vigente vuelve a salir a cara o ceca.',
  );
});

test('el guard SABE FALLAR: con el desempate viejo (solo eventId) la sonda de cada rama se pone roja', () => {
  // Contrafactual EJECUTADO, no argumentado: se re-implementa acá el comparador VIEJO (fecha → eventId) y
  // se corre la misma sonda. Si el resultado fuera el mismo, la sonda no estaría midiendo nada y todos los
  // tests de arriba serían decorativos.
  const oldTiebreak = (a: { eventDate: string; eventId: string }, b: { eventDate: string; eventId: string }) => {
    const ma = Date.parse(a.eventDate);
    const mb = Date.parse(b.eventDate);
    if (Number.isFinite(ma) && Number.isFinite(mb) && ma !== mb) return ma > mb;
    return a.eventId > b.eventId;
  };
  const viejo = { eventDate: '2026-08-06', eventId: 'zzz-viejo' };
  const nuevo = { eventDate: '2026-08-06', eventId: 'aaa-nuevo' };
  assert.equal(
    oldTiebreak(nuevo, viejo),
    false,
    'con el desempate viejo el evento NUEVO no gana — que es exactamente el 🔴 A.5',
  );
  // Y con el comparador vigente, sí gana (mismo par de eventos, por el camino real).
  const rows = PROBES[0].row;
  const state = deriveCurrentState(
    parseTimeline([
      rows({ id: 'zzz-viejo', date: '2026-08-06', createdAt: '2026-08-06T22:13:00Z', seq: 0, old: true }),
      rows({ id: 'aaa-nuevo', date: '2026-08-06', createdAt: '2026-08-06T22:40:00Z', seq: 1, old: false }),
    ]),
  );
  assert.equal(PROBES[0].read(state), PROBES[0].expectNew);
});
