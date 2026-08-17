// GUARD: TODO ADAPTADOR DECLARA CÓMO ENTRA SU LECTURA AL CONTRATO (🟡-1 del review de `dad711f`).
//
// ── EL BUG DE CLASE QUE CIERRA ────────────────────────────────────────────────────────────────────
// El provider decidía si una lectura entra como LÍNEA CRUDA (`processRawLine` → `parseRs420Line`) o
// como EID limpio (`processEid`) con una comparación de DOS LITERALES escrita inline:
//
//     const isRawStream = transport.kind === 'web-serial' || transport.kind === 'spp-android';
//
// Si a esa lista le faltara `spp-android`, cada trama del RS420 iría por `processEid` →
// `normalizeTag` le saca el STX → quedan 34 dígitos → `isValidTag` false → **`invalid_eid`, cero
// lecturas**, y NADA lo vería: no había un solo test de `isRawStream` (grep, ejecutado), el provider
// es `.tsx` y no lo cubre ninguna suite node:test, y el E2E corre en web con mock/manual/simulator.
// El bastón quedaría mudo con la suite entera en verde. Es la TERCERA repetición de la misma clase en
// este camino (framing invertido → cero lecturas; `pairDevice()` colgado; y esto).
//
// ── EL GUARD SE ESCRIBE SOBRE LA AUSENCIA, EN DOS CAPAS ──────────────────────────────────────────
//  1. TIPO — `ADAPTER_INGEST_MODE` está declarado `satisfies Record<AdapterKind, IngestMode>`: un
//     `AdapterKind` nuevo **no compila** hasta declarar su modo. Un adapter nuevo nace en rojo.
//     (Verificado sacando `simulator` del mapa: `tsc --noEmit` → TS1360 + TS7053.)
//  2. TIPO — `ADAPTER_KINDS` (la lista enumerada a mano que recorre este test) está anclada al union
//     con un `Exclude<…> extends never` en el MISMO archivo: tampoco puede quedar vieja en silencio.
//     Ojo: esa ancla vive en `adapter-selection.ts` y NO acá, porque `app/tsconfig.json` EXCLUYE
//     `**​/*.test.ts` — una aserción de tipos escrita en un test no la chequea nadie (node:test solo
//     borra los tipos). Un "guard de tipos" en un archivo de test de este repo es decorativo.
//  3. RUNTIME (este archivo) — se recorre esa lista y se exige que cada kind tenga un modo válido, y
//     que el mapa no acumule filas de kinds que ya no existen.
//  4. CALL SITE — el provider tiene que DELEGAR en `ingestModeFor`, no volver a comparar literales.
//     (Verificado re-metiendo la comparación inline: este test falla.)
//
// ── LO QUE ESTE GUARD NO PUEDE VER ──────────────────────────────────────────────────────────────
// Que el modo declarado sea el CORRECTO para un adapter futuro (eso es lectura del reviewer + el
// banco). Sí fija los dos que hoy están verificados en device: web-serial y spp-android entregan la
// línea cruda del lector.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ADAPTER_INGEST_MODE,
  ADAPTER_KINDS,
  ingestModeFor,
  type IngestMode,
} from './adapter-selection.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** La lista enumerada a mano + su ancla de exhaustividad viven en el módulo (ver el header, punto 2). */
const ALL_KINDS = ADAPTER_KINDS;

const VALID_MODES: IngestMode[] = ['raw-line', 'eid'];

test('🟡-1: TODOS los AdapterKind declaran su modo de ingesta (un adapter nuevo nace en rojo)', () => {
  for (const kind of ALL_KINDS) {
    const mode = (ADAPTER_INGEST_MODE as Record<string, IngestMode | undefined>)[kind];
    assert.ok(
      mode != null,
      `el adapter '${kind}' no declara su modo de ingesta: sus lecturas entrarían por la puerta equivocada del contrato y el bastón quedaría mudo con la suite en verde`,
    );
    assert.ok(
      mode != null && VALID_MODES.includes(mode),
      `modo inválido para '${kind}': ${String(mode)}`,
    );
    assert.equal(ingestModeFor(kind), mode);
  }
});

test('🟡-1: el mapa no declara kinds que no existen (no acumula filas muertas)', () => {
  for (const kind of Object.keys(ADAPTER_INGEST_MODE)) {
    assert.ok(
      (ALL_KINDS as readonly string[]).includes(kind),
      `'${kind}' está en el mapa pero no es un AdapterKind`,
    );
  }
});

test('🟡-1: los adaptadores de STREAM entregan LÍNEA CRUDA (los dos primeros, verificados en device)', () => {
  // spp-android: la trama del RS420 llega con STX + cabecera fija + timestamp → tiene que pasar por
  // `parseRs420Line`. Verificado leyendo una trama real del emulador en el A07 (banco §2).
  assert.equal(ingestModeFor('spp-android'), 'raw-line');
  assert.equal(ingestModeFor('web-serial'), 'raw-line');
  // ble-gatt (delta ios-ble-mfi, RBM2.11): el lector notifica su TRAMA por la característica, partida en
  // trozos de ≤ MTU−3 bytes. Si esta fila dijera 'eid', el `normalizeTag` le sacaría el STX y `isValidTag`
  // rechazaría los 34 dígitos → CERO lecturas con la suite en verde. ⚠️ Todavía NO verificado en device:
  // eso es el banco del ESP32 en `MODO_GATT` (RBM6.1, F6).
  assert.equal(ingestModeFor('ble-gatt'), 'raw-line');
});

test('🟡-1: los adaptadores que ya entregan el EID limpio NO pasan por el parser del lector', () => {
  assert.equal(ingestModeFor('manual'), 'eid');
  assert.equal(ingestModeFor('mock'), 'eid');
  assert.equal(ingestModeFor('simulator'), 'eid');
  assert.equal(ingestModeFor('hid-wedge'), 'eid');
});

test('🟡-1: el provider DELEGA la decisión y no vuelve a comparar kinds a mano', () => {
  const file = resolve(HERE, 'BleStickListenerProvider.tsx');
  const src = stripSourceComments(readFileSync(file, 'utf8'));

  // Desde el fix del review de F1 el provider delega las DOS mitades de una sola vez
  // (`readSourceFor` → `ingestModeFor` + `resolveFrameParser`, en la capa pura). Que el `mode` del
  // `ReadSource` sea EXACTAMENTE `ingestModeFor(kind)` para todos los kinds ya no se vigila con un
  // regex: se verifica por COMPORTAMIENTO en `frame-parser-resolve.test.ts` (bloque D).
  assert.ok(
    src.includes('readSourceFor('),
    'BleStickListenerProvider tiene que resolver el `ReadSource` con readSourceFor() —que delega en ' +
      'ingestModeFor + resolveFrameParser—, no decidir el modo ni el parser inline',
  );
  // La firma exacta del bug: comparar el kind del transporte contra un literal para decidir la
  // ingesta. Si vuelve, el guard cae.
  const inlineKindCompare = /kind\s*===\s*'(web-serial|spp-android)'/.exec(src);
  assert.equal(
    inlineKindCompare,
    null,
    `volvió la comparación inline de kinds en el provider (${inlineKindCompare?.[0]}): esa lista es la que se olvida`,
  );
});

// ── LA OTRA MITAD DE LA MISMA DECISIÓN: CON QUÉ PARSER (delta ios-ble-mfi, RBM1.7) ────────────────
//
// `ingestModeFor` dice POR QUÉ PUERTA entra la lectura; `resolveFrameParser` dice CON QUÉ se
// desframea. El bug de clase es idéntico —una decisión que se escribe a mano en la superficie que
// cablea el adaptador— y la consecuencia también: un lector de otro fabricante queda MUDO con la
// suite entera en verde.
//
// ── POR QUÉ ESTE GUARD CAMBIÓ DE FORMA (review de F1, 2026-08-17) ────────────────────────────────
// La versión anterior prohibía TRES GRAFÍAS conocidas (`parseRs420Line`, importar un `./parser-*`,
// `RS420_DRIVER`). El reviewer la falsificó: `resolveFrameParser(...) ?? DRIVER_REGISTRY[0].frameParser`
// no nombra ninguna de las tres, compila, reintroduce el fallback silencioso que RBM1.4 prohíbe, y
// dejaba las 233 suites BLE en verde (mutante MR1b). Perseguir grafías es exactamente el método que
// este repo ya se comió cuatro veces.
//
// Ahora son DOS oráculos distintos, y el que manda es el primero:
//  1. COMPORTAMIENTO — `readSourceFor` se mudó a `adapter-selection.ts` (es pura) y se ejerce con
//     aserciones de IDENTIDAD en `frame-parser-resolve.test.ts` (bloque D). MR1b y **cualquier otra
//     grafía del fallback** caen ahí por lo que HACEN. Ese es el fix del review; esto es la red.
//  2. ESTÁTICO (este test) — las dos superficies que cablean el adaptador tienen que ser CIEGAS AL
//     FABRICANTE, y eso se escribe sobre la AUSENCIA: se derivan del árbol los módulos de fabricante
//     (`parser-*.ts`, `driver-*.ts` salvo `driver-types.ts`, que son solo tipos) y se prohíbe (a)
//     mencionar cualquiera de sus exports y (b) importar de ellos por cualquier vía (incluido un
//     `import * as`). Un `parseHr5Line`, un `HR5_DRIVER` o un `DRIVER_REGISTRY` futuros caen sin que
//     nadie actualice este archivo.

/** Los dos archivos que CABLEAN un adaptador y por lo tanto tienen que ser ciegos al fabricante. */
const VENDOR_BLIND_FILES = ['BleStickListenerProvider.tsx', 'adapter-selection.ts'];

/**
 * `driver-types.ts` NO es un módulo de fabricante: son los TIPOS del registro (`FrameParser`,
 * `ReaderDriver`, `DiscoveredDevice`). Importarlos es justamente cómo se habla con cualquier lector
 * sin conocer ninguno. Es la única excepción, y por eso está escrita con su motivo.
 */
const TYPES_ONLY_MODULE = 'driver-types.ts';

/** Los módulos de FABRICANTE del directorio (derivados del árbol, no enumerados a mano). */
function vendorModules(): string[] {
  return readdirSync(HERE)
    .filter((f) => /^(parser|driver)-.+\.ts$/.test(f) && !f.endsWith('.test.ts') && f !== TYPES_ONLY_MODULE)
    .sort();
}

/** Los VALORES exportados por esos módulos: nombrar uno es conocer a un fabricante (o al registro). */
function vendorExports(): string[] {
  const names = new Set<string>();
  for (const file of vendorModules()) {
    const src = stripSourceComments(readFileSync(resolve(HERE, file), 'utf8'));
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

test('el extractor de módulos de fabricante VE lo que tiene que ver (guard de las superficies de cableado)', () => {
  // Meta-test: un regex que no matchea nada deja el guard de abajo en verde para siempre.
  const mods = vendorModules();
  const names = vendorExports();
  for (const esperado of ['parser-rs420.ts', 'driver-rs420.ts', 'driver-registry.ts']) {
    assert.ok(mods.includes(esperado), `el extractor no vio ${esperado} (vio: ${mods.join(', ')})`);
  }
  assert.equal(mods.includes(TYPES_ONLY_MODULE), false, 'driver-types.ts son TIPOS: no puede entrar al guard');
  // Las tres grafías del bug histórico + la del mutante MR1b tienen que estar en la lista prohibida.
  for (const esperado of ['parseRs420Line', 'RS420_DRIVER', 'DRIVER_REGISTRY', 'findDriverForDevice']) {
    assert.ok(names.includes(esperado), `el extractor no encontró ${esperado} (vio: ${names.join(', ')})`);
  }
  // Y los tipos del registro NO pueden contar como conocimiento de un fabricante.
  for (const tipo of ['FrameParser', 'ReaderDriver']) {
    assert.equal(names.includes(tipo), false, `${tipo} es un tipo del registro, no un fabricante`);
  }
});

test('RBM1.7: el provider resuelve el parser POR EL DRIVER del adapter, no con uno fijo', () => {
  const src = stripSourceComments(readFileSync(resolve(HERE, 'BleStickListenerProvider.tsx'), 'utf8'));

  assert.ok(
    src.includes('readSourceFor('),
    'el provider dejó de resolver el parser por el `ReaderDriver` del adapter (RBM1.1): con un parser ' +
      'fijo, el registro de drivers vuelve a ser decorativo y un transporte nuevo solo puede hablar ' +
      'con un RS420.',
  );

  // El provider PIDE su `ReadSource`, no lo FABRICA. Es la única regla que cierra el agujero de fondo
  // de este archivo: lo que se decide adentro del provider no lo puede ejercer ninguna suite
  // (importa `react-native`), así que solo se lo puede vigilar por regex — y un regex de nombres se
  // esquiva escribiendo el fallback a mano (`?? { parse: (raw) => ({ eid: raw.slice(7, 22) }) }`: el
  // framing del RS420 reimplementado inline, sin nombrar a nadie). Prohibir que este archivo
  // CONSTRUYA un parser o un `ReadSource` empuja toda esa decisión a la capa pura, donde
  // `frame-parser-resolve.test.ts` la prueba por comportamiento.
  for (const [campo, patron] of [
    ['frameParser', /\bframeParser\s*:/],
    ['parse', /\bparse\s*:/],
  ] as const) {
    assert.equal(
      patron.test(src),
      false,
      `el provider construye un objeto con \`${campo}:\`. Acá no se fabrica ni un parser ni un ` +
        '`ReadSource`: se los pide a `readSourceFor` (capa pura, `adapter-selection.ts`), que es la ' +
        'única que se puede probar por comportamiento. Un parser escrito a mano en este archivo es el ' +
        'fallback silencioso de RBM1.4 sin nombrar a ningún fabricante — invisible para todo guard de ' +
        'nombres.',
    );
  }

  // Y el fail-closed tiene que dejar rastro EN LOS DOS MOMENTOS: sin el log, "el bastón no lee" es
  // indistinguible de "el operario no está bastoneando" — el síntoma que costó el terminador
  // equivocado del SPP (`term cr` → 0 ingestas, 0 errores, en device).
  //   · `at:'mount'` → se montó un transporte que NO PUEDE parsear nada (aparece una vez);
  //   · `at:'read'`  → se descartó UNA lectura concreta (aparece por bastonazo y correlaciona con lo
  //                    que el operario está haciendo, que es lo único que hace diagnosticable el
  //                    "bastoneo y no pasa nada").
  // Se exigen los dos por separado a propósito: con un solo `includes('parser_unresolved')`, borrar
  // el del camino de lectura dejaba el guard en verde y el síntoma invisible.
  assert.match(
    src,
    /parser_unresolved[^\n]*at: 'mount'/,
    'el aviso de que el transporte montado no tiene parser desapareció (RBM1.4)',
  );
  assert.match(
    src,
    /parser_unresolved[^\n]*at: 'read'/,
    'el descarte POR LECTURA dejó de loguearse: el bastonazo perdido vuelve a ser silencio puro (RBM1.4)',
  );
});

test('RBM1.7 (GUARD): las superficies que CABLEAN un adaptador son CIEGAS AL FABRICANTE', () => {
  const prohibidos = vendorExports();
  const modulos = vendorModules().map((f) => f.replace(/\.ts$/, ''));

  for (const archivo of VENDOR_BLIND_FILES) {
    const src = stripSourceComments(readFileSync(resolve(HERE, archivo), 'utf8'));

    // (a) NINGÚN export de un módulo de fabricante, nombrado como sea. Acá caen `parseRs420Line`
    //     inline, `RS420_DRIVER.frameParser` (el mutante "elegante") y `DRIVER_REGISTRY[0].frameParser`
    //     (MR1b, el del reviewer) — y también el `HR5_DRIVER` que todavía no existe.
    for (const nombre of prohibidos) {
      assert.equal(
        new RegExp(`\\b${nombre}\\b`).test(src),
        false,
        `\`${archivo}\` menciona \`${nombre}\`, que es de un módulo de FABRICANTE. Esta superficie cablea ` +
          'el adaptador y no puede conocer a ningún lector: el `frameParser` sale del `ReaderDriver` que ' +
          'trae el adapter (`readSourceFor`). Si el uso es un FALLBACK ("si no hay driver, este parser"), ' +
          'es peor: produce lecturas para UN lector y silencio total para todos los demás, que es ' +
          'indistinguible de "el operario no está bastoneando" (RBM1.4).',
      );
    }

    // (b) Y NINGÚN import de esos módulos por ninguna vía — un `import * as drivers from …` no nombra
    //     un solo export y evadiría la regla (a) entera.
    for (const modulo of modulos) {
      const imp = new RegExp(`from '\\./${modulo}'`).exec(src);
      assert.equal(
        imp,
        null,
        `\`${archivo}\` importa de \`${modulo}\` (${imp?.[0]}): el fabricante entra por el adapter, no por ` +
          'un import de esta capa. Los TIPOS del registro (`FrameParser`, `ReaderDriver`) sí se importan, ' +
          `pero de \`${TYPES_ONLY_MODULE.replace(/\.ts$/, '')}\`, que no conoce a nadie.`,
      );
    }
  }
});
