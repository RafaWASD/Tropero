// EL PARSER DE TRAMA SALE DEL REGISTRO DE DRIVERS (delta ios-ble-mfi, T1 — RBM1.1…RBM1.8).
//
// ── LA DEUDA QUE ESTE ARCHIVO CIERRA ──────────────────────────────────────────────────────────────
// Hasta el 2026-08-17 `contract.ts` importaba y llamaba `parseRs420Line` HARDCODEADO. El delta
// multivendor lo dejó escrito como deuda y no como logro (RMV5.2: *"el `frameParser` no se usa en
// producción… con un segundo driver SPP de otro formato de trama, RMV1.6 no se cumple"*). Era teórico
// mientras todos los transportes hablaban con un RS420; con un transporte BLE deja de serlo: el
// adapter nuevo solo podría hablar con algo que emitiera tramas del RS420 — o sea, con nuestro propio
// emulador y con nada más.
//
// ── LOS CUATRO ORÁCULOS DE ESTE ARCHIVO, Y POR QUÉ HACEN FALTA LOS CUATRO ─────────────────────────
//  (A) `resolveFrameParser` EXHAUSTIVO sobre `ADAPTER_KINDS` (RBM1.4). Por COMPORTAMIENTO, incluido
//      el fail-closed: un adapter de modo `'raw-line'` sin driver devuelve `null` y avisa — NUNCA
//      cae al parser del RS420.
//  (B) `readSourceFor` — EL CAMINO QUE CORRE EL PROVIDER (RBM1.1/RBM1.4/RBM1.7). Es la composición
//      que el provider invoca al cablear cada adaptador: `kind` + `ingestModeFor` +
//      `resolveFrameParser`. Aserciones de IDENTIDAD.
//  (C) ADITIVIDAD REAL (RBM1.6): un `ReaderDriver` sintético con OTRO formato de trama se ingiere de
//      punta a punta —registro → resolución → contrato → dedup → commit— sin tocar `contract.ts`,
//      `stick-adapter.ts` ni ningún adapter.
//  (D) GUARD ESTÁTICO sobre `contract.ts` (RBM1.7): que no vuelva a mencionar el parser de NINGÚN
//      fabricante.
//
// ⚠️ (C) NO PUEDE REEMPLAZAR A (D), y es el punto central: si alguien deja el parámetro y ADEMÁS
// mete una caída a `parseRs420Line` en `contract.ts` para cuando el parser no viene ("por las
// dudas"), (C) SIGUE EN VERDE —siempre le pasa un parser— y la app vuelve a tener un fallback
// silencioso que produce lecturas para un lector y silencio total para todos los demás. Ese mutante
// lo mata (D), no (C). Es la cuarta repetición del verde mentiroso de esta feature, y por eso los
// guards de este archivo se falsificaron con mutantes (ver `progress/impl_ios-ble-mfi-f1.md`).
//
// ⚠️ Y (B) ES LA LECCIÓN DEL REVIEW DE F1: `readSourceFor` nació DENTRO del provider, donde ninguna
// suite `node:test` puede importarla (el provider importa `react-native`), así que su único oráculo
// era un regex sobre el fuente. El reviewer escribió `resolveFrameParser(...) ?? DRIVER_REGISTRY[0]
// .frameParser` —el mismo fallback prohibido, sin nombrar `parseRs420Line` ni `RS420_DRIVER`— y las
// 233 suites BLE quedaron en VERDE (mutante MR1b). La función se mudó a `adapter-selection.ts` (es
// pura) y este bloque la ejerce por COMPORTAMIENTO: cualquier grafía del fallback cae por lo que
// HACE. Un guard que enumera los nombres de hoy no vigila un invariante, vigila una moda.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ADAPTER_KINDS,
  ingestModeFor,
  readSourceFor,
  resolveFrameParser,
  type AdapterKind,
} from './adapter-selection.ts';
import { EidIngestEngine, ingestRawLine } from './contract.ts';
import { DRIVER_REGISTRY, driverByVendorId, findDriverForDevice } from './driver-registry.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { parseRs420Line } from './parser-rs420.ts';
import type { DiscoveredDevice, FrameParser, ReaderDriver } from './driver-types.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Un espía del sink de fail-closed: registra los kinds por los que `resolveFrameParser` avisó. */
function spy(): { calls: AdapterKind[]; sink: (kind: AdapterKind) => void } {
  const calls: AdapterKind[] = [];
  return { calls, sink: (kind) => calls.push(kind) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (A) resolveFrameParser — exhaustivo sobre ADAPTER_KINDS (RBM1.4)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test('RBM1.4: TODO kind de ingesta `raw-line` SIN driver → null + aviso (fail-closed, sin caer a RS420)', () => {
  const rawLineKinds = ADAPTER_KINDS.filter((k) => ingestModeFor(k) === 'raw-line');
  // Anti-vacuidad: si mañana ningún kind fuera 'raw-line', el `for` de abajo no probaría NADA y este
  // test pasaría igual. Un test que no puede fallar no es un oráculo.
  assert.ok(rawLineKinds.length > 0, 'ningún AdapterKind es raw-line: este test quedó vacío');

  for (const kind of rawLineKinds) {
    const { calls, sink } = spy();
    const parser = resolveFrameParser({ kind }, sink);
    assert.equal(
      parser,
      null,
      `'${kind}' es raw-line y no expone driver: tiene que quedar SIN parser. Devolver uno por ` +
        'default (p. ej. el del RS420) daría lecturas para un lector y SILENCIO TOTAL para el resto, ' +
        'que es indistinguible de "el operario no está bastoneando" (RBM1.4).',
    );
    assert.deepEqual(calls, [kind], `'${kind}' no avisó del fail-closed: el descarte quedaría mudo`);
  }
});

test('RBM1.4: el fail-closed NO devuelve el parser del RS420 (contraprueba explícita del fallback)', () => {
  // El mutante que este test mata es literal: `return adapter.driver?.frameParser ?? RS420_DRIVER.frameParser`.
  const { sink } = spy();
  for (const kind of ADAPTER_KINDS.filter((k) => ingestModeFor(k) === 'raw-line')) {
    assert.notEqual(resolveFrameParser({ kind }, sink), RS420_DRIVER.frameParser);
  }
});

test('RBM1.4: TODO kind de ingesta `eid` → null SIN aviso (no hay nada que desframear; es lo normal)', () => {
  const eidKinds = ADAPTER_KINDS.filter((k) => ingestModeFor(k) === 'eid');
  assert.ok(eidKinds.length > 0, 'ningún AdapterKind es eid: este test quedó vacío');

  for (const kind of eidKinds) {
    const { calls, sink } = spy();
    // Incluso si por error trajera un driver: su modo dice que ya entrega el EID limpio.
    assert.equal(resolveFrameParser({ kind, driver: RS420_DRIVER }, sink), null, kind);
    assert.equal(resolveFrameParser({ kind }, sink), null, kind);
    assert.deepEqual(
      calls,
      [],
      `'${kind}' avisó de fail-closed y no corresponde: entra por processEid, no desframea nada. ` +
        'Un aviso acá sería ruido por bastonazo y taparía el caso que SÍ importa.',
    );
  }
});

test('RBM1.1: un kind `raw-line` CON driver devuelve EXACTAMENTE el frameParser de ESE driver', () => {
  const rawLineKinds = ADAPTER_KINDS.filter((k) => ingestModeFor(k) === 'raw-line');
  const OTRO: ReaderDriver = { ...RS420_DRIVER, vendorId: 'otro', frameParser: { parse: () => null } };

  for (const kind of rawLineKinds) {
    const { calls, sink } = spy();
    // Identidad, no "hay algo": es lo que distingue "usó el del driver" de "usó cualquiera".
    assert.equal(resolveFrameParser({ kind, driver: RS420_DRIVER }, sink), RS420_DRIVER.frameParser);
    assert.equal(resolveFrameParser({ kind, driver: OTRO }, sink), OTRO.frameParser);
    assert.deepEqual(calls, [], `'${kind}' con driver no debería avisar de nada`);
  }
});

test('RBM1.4: un driver con `frameParser` roto (sin `parse`) cae del lado del descarte, no del throw', () => {
  // Un driver a medio escribir —o venido de una config— no puede tumbar el read-loop del transporte
  // con "frameParser.parse is not a function". Fail-closed = descartar, no explotar.
  const { calls, sink } = spy();
  const SIN_PARSE = { ...RS420_DRIVER, frameParser: {} as unknown as FrameParser };
  assert.equal(resolveFrameParser({ kind: 'spp-android', driver: SIN_PARSE }, sink), null);
  const NO_ES_FUNCION = { ...RS420_DRIVER, frameParser: { parse: 'nope' } as unknown as FrameParser };
  assert.equal(resolveFrameParser({ kind: 'spp-android', driver: NO_ES_FUNCION }, sink), null);
  assert.deepEqual(calls, ['spp-android', 'spp-android']);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (B) `readSourceFor` — EL CAMINO QUE CORRE EL PROVIDER, por COMPORTAMIENTO (RBM1.1/RBM1.4/RBM1.7)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// El provider llama EXACTAMENTE esto una vez por adaptador cableado (manual y transporte), y el
// `ReadSource` que sale viaja con cada lectura hasta el contrato. Todo lo que se rompa acá deja el
// bastón mudo en device sin que nada más se ponga rojo.

/** Un driver sintético, autocontenido: NO es de ningún fabricante real (RBM5.11). */
const DRIVER_SINTETICO: ReaderDriver = {
  ...RS420_DRIVER,
  vendorId: 'test-read-source',
  frameParser: { parse: (raw) => (raw.startsWith('X') ? { eid: raw.slice(1) } : null) },
};

test('RBM1.4 (readSourceFor): raw-line SIN driver → mode raw-line, parser NULL y UN aviso (fail-closed)', () => {
  const { calls, sink } = spy();

  const source = readSourceFor({ kind: 'spp-android' }, sink);

  // La forma ENTERA, no campo por campo: un `frameParser` que aparezca de la nada (el fallback) rompe
  // esta igualdad venga de donde venga —`RS420_DRIVER.frameParser`, `DRIVER_REGISTRY[0].frameParser`,
  // un `{ parse }` inline o el driver que se invente mañana—. Ese es el punto de tenerlo por
  // comportamiento: no hay grafía que esquivar.
  assert.deepEqual(source, { kind: 'spp-android', mode: 'raw-line', frameParser: null });
  assert.deepEqual(
    calls,
    ['spp-android'],
    'el fail-closed tiene que avisar EXACTAMENTE una vez: sin el aviso, un transporte que no puede ' +
      'parsear nada se ve igual que uno que nadie está usando',
  );

  // Contraprueba explícita contra el registro de PRODUCCIÓN entero (derivado, no un nombre a mano):
  // ningún driver registrado —hoy o mañana— puede ser el parser del fail-closed.
  for (const driver of DRIVER_REGISTRY) {
    assert.notEqual(
      source.frameParser,
      driver.frameParser,
      `el fail-closed cayó al parser de '${driver.vendorId}': eso da lecturas para UN lector y silencio ` +
        'total para todos los demás (RBM1.4)',
    );
  }
});

test('RBM1.1 (readSourceFor): CON driver, el ReadSource lleva EXACTAMENTE el frameParser de ESE driver', () => {
  const { calls, sink } = spy();

  const source = readSourceFor({ kind: 'spp-android', driver: DRIVER_SINTETICO }, sink);

  assert.equal(source.kind, 'spp-android');
  assert.equal(source.mode, 'raw-line');
  // IDENTIDAD, no `assert.ok`: "hay un parser" lo cumple también el fallback. Lo único que distingue
  // "usó el del driver de ESTE adapter" de "usó cualquiera" es la referencia.
  assert.equal(source.frameParser, DRIVER_SINTETICO.frameParser);
  assert.deepEqual(calls, [], 'con driver no hay nada que avisar');
});

test('RBM9.5 (readSourceFor): la puerta MANUAL entra por `eid`, sin parser y SIN aviso', () => {
  const { calls, sink } = spy();

  // El piso manual (R7) se cablea por la MISMA función que el transporte: si el fail-closed del
  // parser pudiera tocarlo, un error de cableado del bastón dejaría sin cargar a mano — que es
  // exactamente lo que RBM9.5 prohíbe.
  assert.deepEqual(readSourceFor({ kind: 'manual' }, sink), {
    kind: 'manual',
    mode: 'eid',
    frameParser: null,
  });
  assert.deepEqual(calls, [], 'un aviso acá sería ruido: la puerta manual no desframea nada');
});

test('RBM1.4 (readSourceFor): EXHAUSTIVO sobre ADAPTER_KINDS — el ReadSource nunca contradice la tabla', () => {
  for (const kind of ADAPTER_KINDS) {
    const { calls, sink } = spy();
    const sinDriver = readSourceFor({ kind }, sink);
    assert.equal(sinDriver.kind, kind, 'el ReadSource tiene que decir de QUÉ transporte vino');
    assert.equal(sinDriver.mode, ingestModeFor(kind), `'${kind}': el modo no puede divergir de la tabla`);
    assert.equal(sinDriver.frameParser, null, `'${kind}' sin driver no puede tener parser`);
    assert.deepEqual(calls, ingestModeFor(kind) === 'raw-line' ? [kind] : []);

    const conDriver = readSourceFor({ kind, driver: DRIVER_SINTETICO }, sink);
    assert.equal(
      conDriver.frameParser,
      ingestModeFor(kind) === 'raw-line' ? DRIVER_SINTETICO.frameParser : null,
      `'${kind}': con driver, el parser sale del driver si desframea, y es null si entrega EID limpio`,
    );
    // Y el segundo `readSourceFor` —el que SÍ tiene driver— no agregó ningún aviso: `calls` sigue
    // siendo lo que era. Un adapter bien cableado no puede ensuciar el log por bastonazo.
    assert.deepEqual(calls, ingestModeFor(kind) === 'raw-line' ? [kind] : [], `'${kind}': aviso de más`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (C) ADITIVIDAD REAL: un driver con OTRO formato de trama, ingerido de punta a punta (RBM1.6)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// Este es el test que ANTES DE T1 NO PODÍA PASAR: con `parseRs420Line` hardcodeado en el contrato,
// una trama que no fuera del RS420 era `parse_failed` sí o sí, cualquiera fuera el driver.

const EID_SINTETICO = '982000364696050';
/** Trama de un lector FICTICIO: nada que ver con la del RS420 (que es `1000000<eid><ts12>`). */
const TRAMA_OTRO_FORMATO = `EID:${EID_SINTETICO};T=260530101701`;
const TRAMA_RS420 = `1000000${EID_SINTETICO}260530101701`;

/**
 * Driver sintético de un lector que NO existe (RBM5.11: en el registro de PRODUCCIÓN no se inventa
 * ningún fabricante; este vive solo acá, en una copia del registry).
 */
const OTRO_FORMATO_DRIVER: ReaderDriver = {
  vendorId: 'test-otro-formato',
  displayName: 'Lector de prueba (otro formato de trama)',
  transports: [{ kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', delimiter: '\n' } }],
  frameParser: { parse: (raw) => {
    const m = /^EID:(\d{15});T=\d{12}$/.exec(raw.trim());
    return m ? { eid: m[1] } : null;
  } },
  deviceMatch: { namePattern: /OTRO-FORMATO/i },
  streaming: true,
};

test('RBM1.6: los dos formatos son REALMENTE distintos (si no, el test de aditividad no prueba nada)', () => {
  // Sin esta contraprueba, un `frameParser` sintético que por casualidad entendiera la trama del
  // RS420 dejaría el test de abajo en verde AUN con el parser hardcodeado de vuelta en el contrato.
  // Cada parser entiende LO SUYO (si no, los dos rechazos de abajo pasarían por basura, no por
  // formato distinto — un "no entiende" contra una trama inválida no prueba nada).
  assert.deepEqual(parseRs420Line(TRAMA_RS420), { eid: EID_SINTETICO });
  assert.deepEqual(OTRO_FORMATO_DRIVER.frameParser.parse(TRAMA_OTRO_FORMATO), { eid: EID_SINTETICO });
  // Y NINGUNO entiende el del otro.
  assert.equal(parseRs420Line(TRAMA_OTRO_FORMATO), null, 'el RS420 no puede entender la trama del otro');
  assert.equal(OTRO_FORMATO_DRIVER.frameParser.parse(TRAMA_RS420), null, 'el otro no puede entender la del RS420');
});

test('RBM1.6: un driver NUEVO con otro formato se ingiere de punta a punta SIN tocar el contrato', () => {
  // 1. Se agrega como FILA de datos en una copia del registro (nada más: cero cambios de código).
  const registry = [...DRIVER_REGISTRY, OTRO_FORMATO_DRIVER];
  const device: DiscoveredDevice = { id: 'AA:BB', name: 'OTRO-FORMATO-7', channel: 'classic-paired' };
  assert.equal(findDriverForDevice(device, registry), OTRO_FORMATO_DRIVER);

  // 2. Un adapter de stream (modo 'raw-line') que expone ESE driver — la forma de `StickAdapter`
  //    que T1.1 agregó, sin tocar ningún método de la interfaz.
  const adapter = { kind: 'spp-android' as const, driver: OTRO_FORMATO_DRIVER };
  const { calls, sink } = spy();
  const frameParser = resolveFrameParser(adapter, sink);
  assert.equal(frameParser, OTRO_FORMATO_DRIVER.frameParser);
  assert.deepEqual(calls, []);

  // 3. El contrato lo ingiere: parse (del driver) → isValidTag (del contrato) → dedup → commit.
  const engine = new EidIngestEngine();
  const candidate = engine.processRawLine(TRAMA_OTRO_FORMATO, frameParser as FrameParser, 1000);
  assert.deepEqual(candidate, { eid: EID_SINTETICO });
  const evento = engine.commit(EID_SINTETICO, 1717000000000);
  assert.deepEqual(evento, { kind: 'tag_read', tag: EID_SINTETICO, timestamp: 1717000000000 });

  // 4. Y la MISMA trama por el camino del RS420 se rechaza: el resultado depende del DRIVER, que es
  //    exactamente lo que RMV1.6 prometía y hasta hoy era falso.
  assert.deepEqual(
    new EidIngestEngine().processRawLine(TRAMA_OTRO_FORMATO, RS420_DRIVER.frameParser, 1000),
    { rejected: 'parse_failed' },
  );
});

test('RBM1.8: el EID del driver nuevo pasa por la MISMA validación y la MISMA dedup (integridad SENASA)', () => {
  const engine = new EidIngestEngine();
  // Dedup por-TAG (R3.1): el re-escaneo dentro de la ventana se ignora, venga del driver que venga.
  assert.deepEqual(engine.processRawLine(TRAMA_OTRO_FORMATO, OTRO_FORMATO_DRIVER.frameParser, 1000), {
    eid: EID_SINTETICO,
  });
  assert.equal(engine.processRawLine(TRAMA_OTRO_FORMATO, OTRO_FORMATO_DRIVER.frameParser, 1500), null);

  // isValidTag (R1.3) sigue mandando aunque el parser del fabricante devuelva cualquier cosa: un
  // driver de tercero NO puede saltearse la validación del EID que se declara ante SENASA.
  const FLOJO: FrameParser = { parse: (raw) => ({ eid: raw }) };
  assert.deepEqual(ingestRawLine('98200036469605', FLOJO), { ok: false, reason: 'invalid_eid' });
});

test('RBM5.11: el driver sintético NO entra al registro de producción (aislamiento del test)', () => {
  assert.equal(driverByVendorId('test-otro-formato'), null);
  // Ídem el del bloque (B): ningún driver de prueba puede filtrarse al registro que corre en device.
  assert.equal(driverByVendorId(DRIVER_SINTETICO.vendorId), null);
  assert.equal(findDriverForDevice({ id: 'AA:BB', name: 'OTRO-FORMATO-7', channel: 'classic-paired' }), null);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (D) GUARD ESTÁTICO: `contract.ts` no menciona el parser de NINGÚN fabricante (RBM1.7)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los DOS nombres de `parser-rs420.ts` que el contrato SÍ puede usar, con su motivo. No son del
 * fabricante: son reglas del CONTRATO —EID de 15 dígitos ISO 11784/11785 y normalización de bordes—
 * que se aplican a todo EID salga del `frameParser` que salga (RBM1.8, RBM1.2). Viven en ese archivo
 * por dónde se escribieron primero, no por pertenencia.
 */
const DEL_CONTRATO = new Set(['isValidTag', 'normalizeTag']);

/**
 * `driver-types.ts` NO es un módulo de fabricante: son los TIPOS del registro (`FrameParser`,
 * `ReaderDriver`). Importarlos es justamente cómo se habla con cualquier lector sin conocer ninguno.
 */
const TYPES_ONLY_MODULE = 'driver-types.ts';

/**
 * Los nombres exportados por CUALQUIER módulo de fabricante del directorio (`parser-*.ts` y
 * `driver-*.ts` salvo los tipos), derivados del árbol y no enumerados a mano.
 *
 * ⚠️ Los `driver-*.ts` entraron después del review de F1: el reviewer mostró (§7 de
 * `progress/review_ios-ble-mfi-f1.md`) que un fallback importado de `driver-rs420.ts` **no nombra
 * ningún `parser-*`** y esquivaba la versión anterior de este extractor. `RS420_DRIVER.frameParser`
 * y `DRIVER_REGISTRY[0].frameParser` son el MISMO bug que `parseRs420Line`, escrito de otra forma.
 */
function vendorModuleExports(): string[] {
  const files = readdirSync(HERE).filter(
    (f) => /^(parser|driver)-.+\.ts$/.test(f) && !f.endsWith('.test.ts') && f !== TYPES_ONLY_MODULE,
  );
  const names = new Set<string>();
  for (const file of files) {
    const src = stripSourceComments(readFileSync(resolve(HERE, file), 'utf8'));
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
      if (!DEL_CONTRATO.has(m[1])) names.add(m[1]);
    }
  }
  return [...names].sort();
}

test('el extractor de módulos de fabricante VE lo que tiene que ver (si no, el guard es decorativo)', () => {
  // Meta-test: sin esto, un regex que no matchea nada dejaría el guard de abajo en verde para
  // siempre — el modo de falla que este repo ya se comió cuatro veces.
  const names = vendorModuleExports();
  for (const esperado of ['parseRs420Line', 'RS420_DRIVER', 'DRIVER_REGISTRY']) {
    assert.ok(names.includes(esperado), `el extractor no encontró ${esperado} (vio: ${names.join(', ')})`);
  }
  assert.ok(!names.includes('isValidTag'), 'isValidTag es del contrato: no puede contar como parser de fabricante');
  assert.ok(!names.includes('ReaderDriver'), 'los TIPOS del registro no son un fabricante (driver-types.ts)');
});

test('RBM1.2/RBM1.7 (GUARD): `contract.ts` NO importa ni menciona el parser de ningún fabricante', () => {
  const src = stripSourceComments(readFileSync(resolve(HERE, 'contract.ts'), 'utf8'));

  for (const name of vendorModuleExports()) {
    assert.equal(
      new RegExp(`\\b${name}\\b`).test(src),
      false,
      `\`contract.ts\` volvió a mencionar \`${name}\`. El corazón del contrato NO puede conocer a un ` +
        'fabricante: con el parser hardcodeado, sumar una marca deja de ser una FILA en el registro y ' +
        'pasa a ser tocar el archivo que ningún transporte puede eludir (ADR-024 §1, RMV1.6). Y si el ' +
        'uso es un FALLBACK ("si no me pasan parser, RS420"), es peor: produce lecturas para un lector ' +
        'y silencio total para todos los demás (RBM1.4).',
    );
  }

  // La otra mitad del invariante: el parser tiene que ENTRAR POR PARÁMETRO. Sin esto, borrar la
  // llamada hardcodeada y no poner nada dejaría el guard de arriba en verde.
  assert.match(
    src,
    /export function ingestRawLine\(\s*line: string,\s*frameParser: FrameParser\s*\)/,
    '`ingestRawLine` dejó de recibir el `frameParser` por parámetro (RBM1.2)',
  );
  assert.match(src, /frameParser\.parse\(/, '`ingestRawLine` ya no invoca el parser que recibe');
  // Y el parámetro NO puede tener default: un default ES el fallback silencioso con otro nombre.
  assert.equal(
    /frameParser\s*:\s*FrameParser\s*=/.test(src),
    false,
    'el `frameParser` quedó con valor por default: eso reintroduce el fallback que RBM1.4 prohíbe, ' +
      'y encima deja de romper el typecheck en los call sites que se lo olviden.',
  );
});

// La otra mitad del guard de RBM1.7 —que el PROVIDER delegue en `resolveFrameParser` y no vuelva a
// nombrar un parser de fabricante— vive en `adapter-ingest-mode.test.ts`, que es el archivo que ya
// vigila el call site del provider para la decisión hermana (el MODO de ingesta, 🟡-1): las dos
// mitades de la misma decisión, vigiladas en el mismo lugar. No se comparte código entre los dos
// archivos a propósito (importar un `.test.ts` desde otro registra sus tests dos veces).
