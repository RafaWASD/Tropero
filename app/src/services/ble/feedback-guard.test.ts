// GUARDS del canal sensorial del bastón, escritos sobre la AUSENCIA (unidad «el bastón tiene que sonar
// y vibrar de verdad», 2026-08-06). Complemento de `read-dispatch.test.ts`, que vigila los NOMBRES; acá
// se vigilan los MÓDULOS y los ASSETS, que es la mitad que un patrón de nombres no puede cubrir.
//
// ── POR QUÉ HACEN FALTA LOS DOS ──────────────────────────────────────────────────────────────────────
// El guard de nombres (`SENSORY_EMIT`) enumera formas de escribir un emisor. Siempre se puede inventar
// un nombre que no esté en la lista — es la limitación estructural de verificar la FORMA del código. Lo
// que NO se puede inventar es el módulo: para hacer vibrar o sonar un teléfono hay que importar algo, y
// ese conjunto es chico y enumerable. Por eso la regla de acá se escribe sobre los imports:
//
//   «En el camino de la lectura (`src/services/ble/**`), el ÚNICO archivo que puede importar un módulo
//    capaz de producir un efecto sensorial es el punto único (R4.7).»
//
// Un canal nuevo (una lib de sonido distinta, expo-speech para que el teléfono CANTE el número, un
// vibrador propio) nace en ROJO hasta que alguien venga acá y escriba por qué corresponde.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decideFeedback,
  FEEDBACK_AUDIO_MODE,
  type FeedbackPlatform,
  type ReadOutcome,
  type SoundCue,
} from './feedback-logic.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..', '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** EL punto único del efecto físico (R4.7). `feedback-logic.ts` NO está: es la decisión pura, no emite. */
const EFFECT_FILE = 'src/services/ble/feedback.ts';

/**
 * Los MÓDULOS con los que se le puede hacer sentir algo al operario. No es "los que usamos": es el
 * inventario de lo que existe en este stack y podría usarse.
 */
const SENSORY_MODULES = ['expo-haptics', 'expo-audio', 'expo-av', 'expo-speech'];

/** `from 'x'` / `require('x')` para cualquiera de los módulos sensoriales. */
const SENSORY_IMPORT = new RegExp(
  String.raw`(?:from|require\s*\(|import\s*\()\s*['"](${SENSORY_MODULES.join('|')})['"]`,
);

/**
 * `Vibration` de `react-native` — el canal sensorial que NO se puede cercar por módulo (medio repo importa
 * `react-native` por `Platform`), así que se cerca por SÍMBOLO.
 */
const VIBRATION_SYMBOL = /\bVibration\b/;

/**
 * ── DUEÑOS DE CADA CANAL SENSORIAL, EN TODA LA APP (🟠-4 del review, 2026-08-06) ──────────────────────
 *
 * La primera versión de este guard acotaba el barrido a `src/services/ble/**`, y el reviewer lo pasó por
 * arriba con **una indirección de un directorio**: `src/utils/manga-buzz.ts` importando `expo-haptics`,
 * llamado desde `handleReading` ANTES del gate → **suite completa (2837 tests) en verde** con el 🔴-2
 * restaurado para el canal táctil. El guard de NOMBRES tampoco lo veía, porque `buzzManga()` no matchea
 * ningún patrón. Con `expo-audio` sí moría, y esa asimetría era la pista: el chequeo de `expo-audio` ya
 * era app-wide y los otros no.
 *
 * Ahora los cuatro módulos y el símbolo `Vibration` se barren en TODA la app contra esta tabla. No
 * prohíbe la háptica en el producto: obliga a que un canal sensorial nuevo tenga **dueño escrito**. El
 * costo de agregar uno legítimo es una línea acá con su motivo; el costo del falso negativo es una
 * confirmación falsa en la manga.
 */
const SENSORY_OWNERS: Record<string, { files: string[]; why: string }> = {
  'expo-haptics': {
    files: [EFFECT_FILE],
    why: 'canal táctil rico de la lectura del bastón (R4.1), aguas abajo del gate de read-dispatch',
  },
  'expo-audio': { files: [EFFECT_FILE], why: 'canal sonoro de la lectura del bastón (R4.2)' },
  'expo-av': { files: [], why: 'reemplazado por expo-audio; nadie debería volver a él' },
  'expo-speech': { files: [], why: 'no está en deps; que el teléfono HABLE sería una decisión de producto' },
  Vibration: {
    files: [EFFECT_FILE, 'src/utils/haptics.ts'],
    why:
      '`feedback.ts` lo usa como RESPALDO del canal táctil (APK sin el módulo nativo); `utils/haptics.ts` ' +
      'es el helper de ticks de UI (reorder + rueda), que NO está en el camino de la lectura y por eso ' +
      'queda fuera del barrido de nombres de read-dispatch',
  },
};

function listFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) found.push(...listFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(p);
  }
  return found;
}

/** `<rel>:<línea>` de cada línea que cumple el predicado, con los comentarios blanqueados. */
function scanTree(predicate: (line: string, rel: string) => boolean): string[] {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const rel = relative(APP_ROOT, file).split(sep).join('/');
      stripSourceComments(readFileSync(file, 'utf8'))
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (predicate(line, rel)) hits.push(`${rel}:${i + 1}`);
        });
    }
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (1) LOS MÓDULOS: en el camino de la lectura, solo el punto único puede importar un canal sensorial
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('GUARD: en `services/ble/**` solo el punto único importa un módulo capaz de emitir', () => {
  const intrusos = scanTree(
    (line, rel) => rel.startsWith('src/services/ble/') && rel !== EFFECT_FILE && SENSORY_IMPORT.test(line),
  );
  assert.deepEqual(
    intrusos,
    [],
    'Un archivo del camino de la lectura importa un módulo sensorial fuera del punto único ' +
      `(${SENSORY_MODULES.join(' / ')}). El invariante R4.7 no es "no llamar a playFeedback": es que ` +
      `ninguna confirmación salga sin haber decidido antes que hay consumidor. Enchufalo dentro de ` +
      `\`${EFFECT_FILE}\`, que es el único lugar aguas abajo del gate.`,
  );
});

test('GUARD: el punto único SÍ importa los dos canales (si no, este guard pasaría por no mirar nada)', () => {
  // Sin esto, borrar el sonido y la háptica dejaría el guard de arriba VERDE (cero intrusos porque cero
  // canales) y el producto de vuelta en la vibración de 50 ms que 🟡-11 vino a cerrar.
  const effect = stripSourceComments(readFileSync(join(APP_ROOT, EFFECT_FILE), 'utf8'));
  assert.match(effect, /require\('expo-haptics'\)/, 'el punto único dejó de usar el canal TÁCTIL rico (R4.1)');
  assert.match(effect, /require\('expo-audio'\)/, 'el punto único dejó de usar el canal SONORO nativo (R4.2)');
  // Y el fallback táctil sigue existiendo: sin `expo-haptics` en el APK instalado (build anterior a la
  // dep) el peón NO puede quedarse sin ningún canal táctil — eso sería un retroceso, no una degradación.
  assert.match(
    effect,
    /Vibration\s*\}\s*=\s*require\('react-native'\)/,
    'se cayó el fallback a `Vibration`: un APK sin el módulo nativo quedaría SIN feedback táctil (R4.1).',
  );

  // ── Y el respaldo usa EL PATRÓN PURO, no un literal propio (mutante RR-B3 del fix-loop) ───────────
  // Que `fallbackVibrationPattern` distinga los dos desenlaces (verificado ejecutándola en
  // `feedback.test.ts`) no sirve de NADA si el efecto real la esquiva. Lo probé: reemplazar la llamada
  // por `Vibration.vibrate(50)` dejaba la suite entera en verde con la función pura decorativa y los dos
  // patrones colapsados — o sea 🟡-12 restaurado en los equipos donde el respaldo es el único canal
  // táctil. Es el mismo agujero que el literal propio en lugar de `FEEDBACK_AUDIO_MODE` (mutante M17).
  assert.match(
    effect,
    /Vibration\.vibrate\(\s*fallbackVibrationPattern\(\s*pattern\s*\)\s*\)/,
    'el respaldo táctil NO pasa por `fallbackVibrationPattern(pattern)`: o lo reescribió con un literal ' +
      'propio, o dejó de depender del desenlace. En un APK sin el módulo nativo ese es el ÚNICO canal ' +
      'táctil, así que ahí "entró" y "no servía" volverían a ser indistinguibles (R4.8 / 🟡-12).',
  );
});

test('GUARD APP-WIDE (🟠-4): cada canal sensorial tiene DUEÑO escrito, en todo el árbol', () => {
  // Cierra el agujero real que encontró el reviewer: el barrido acotado a `services/ble/**` se esquivaba
  // con un archivo en `src/utils/` llamado desde el camino de la lectura, con la suite entera en verde.
  // Acá NO importa dónde viva el archivo: importa quién puede nombrar cada canal.
  for (const [canal, { files, why } ] of Object.entries(SENSORY_OWNERS)) {
    const matcher =
      canal === 'Vibration'
        ? (line: string) => VIBRATION_SYMBOL.test(line)
        : (line: string) => new RegExp(String.raw`['"]${canal}['"]`).test(line);
    const found = [...new Set(scanTree((line) => matcher(line)).map((h) => h.split(':')[0]))].sort();
    const intrusos = found.filter((f) => !files.includes(f));
    assert.deepEqual(
      intrusos,
      [],
      `\`${canal}\` se usa desde un archivo sin dueño declarado: ${intrusos.join(', ')}.\n` +
        `Dueños actuales: ${files.length ? files.join(', ') : '(ninguno)'} — ${why}.\n` +
        'Un canal sensorial nuevo NO está prohibido para siempre: está prohibido EN SILENCIO. Si ' +
        'corresponde, agregalo a `SENSORY_OWNERS` con su motivo. Si es en el camino de la lectura, ' +
        `enchufalo en \`${EFFECT_FILE}\`, que es el único punto aguas abajo del gate (R4.7).`,
    );
    // Y el dueño declarado tiene que USARLO de verdad: una tabla que nombra archivos que ya no lo tocan
    // deja de describir la app (y el barrido pasaría verde por no encontrar nada).
    const fantasmas = files.filter((f) => !found.includes(f));
    assert.deepEqual(fantasmas, [], `\`${canal}\`: dueños declarados que ya no lo usan: ${fantasmas.join(', ')}`);
  }
});

test('PIN: la tabla de dueños es EXACTAMENTE la declarada (auto-agregarse cuesta romper dos asserts)', () => {
  // ⚪-B de la re-review: el barrido app-wide es genérico y correcto, pero agregarse a `SENSORY_OWNERS`
  // costaba UNA línea en un solo lugar. Su hermano `PROVIDER_SENSORY_ALLOWED` (en `read-dispatch.test.ts`)
  // está pinchado con un `deepEqual`, así que tocarlo obliga a romper dos asserts y el diff se ve. Acá va
  // el mismo pin: no impide agregar un dueño legítimo —eso es el contrato del diseño—, encarece hacerlo
  // en silencio.
  assert.deepEqual(Object.keys(SENSORY_OWNERS).sort(), ['Vibration', 'expo-audio', 'expo-av', 'expo-haptics', 'expo-speech']);
  assert.deepEqual(SENSORY_OWNERS['expo-haptics'].files, [EFFECT_FILE]);
  assert.deepEqual(SENSORY_OWNERS['expo-audio'].files, [EFFECT_FILE]);
  assert.deepEqual(SENSORY_OWNERS['expo-av'].files, []);
  assert.deepEqual(SENSORY_OWNERS['expo-speech'].files, []);
  assert.deepEqual(SENSORY_OWNERS.Vibration.files, [EFFECT_FILE, 'src/utils/haptics.ts']);
  // Y todo dueño tiene motivo escrito: una allowlist sin porqué es una lista de excepciones.
  for (const [canal, { why }] of Object.entries(SENSORY_OWNERS)) {
    assert.ok(why.length > 20, `\`${canal}\` está en la tabla sin un motivo escrito`);
  }
});

test('el guard APP-WIDE DETECTA el mutante EXACTO del review (indirección de un directorio)', () => {
  // El reviewer creó `src/utils/manga-buzz.ts` con `expo-haptics` y lo llamó desde `handleReading` antes
  // del gate: 2837/2837 en verde. Se simula el barrido sobre una ruta de mentira para probar que el
  // predicado la marcaría — el mutante real se corre aparte, contra el árbol.
  const intruso = 'src/utils/manga-buzz.ts';
  for (const [canal, { files }] of Object.entries(SENSORY_OWNERS)) {
    assert.ok(!files.includes(intruso), `${intruso} no puede ser dueño de ${canal}`);
  }
  assert.ok(SENSORY_IMPORT.test("import * as Haptics from 'expo-haptics';"));
  assert.ok(VIBRATION_SYMBOL.test("const { Vibration } = require('react-native');"));
  assert.ok(VIBRATION_SYMBOL.test("import { Vibration } from 'react-native';"));
  // Y no marca un `react-native` cualquiera.
  assert.ok(!VIBRATION_SYMBOL.test("import { Platform } from 'react-native';"));
});

test('el guard de MÓDULOS DETECTA las formas de importar (no pasa verde por mirar un patrón muerto)', () => {
  const MUTANTES = [
    "import * as Haptics from 'expo-haptics';",
    "import { createAudioPlayer } from 'expo-audio';",
    "const { createAudioPlayer } = require('expo-audio');",
    "const Haptics = require( 'expo-haptics' );",
    "const mod = await import('expo-audio');",
    "export { speak } from 'expo-speech';",
    "import { Audio } from 'expo-av';",
  ];
  for (const linea of MUTANTES) {
    assert.ok(SENSORY_IMPORT.test(linea), `el guard de módulos NO ve: ${linea}`);
  }
  // Falsos positivos: importar CUALQUIER otra cosa no puede disparar.
  for (const linea of [
    "import { Platform } from 'react-native';",
    "import * as SecureStore from 'expo-secure-store';",
    "import { cachedBeepEnabled } from './beep-pref-cache';",
    "const audioLabel = 'expo-audio es el módulo';",
  ]) {
    assert.ok(!SENSORY_IMPORT.test(linea), `falso positivo del guard de módulos: ${linea}`);
  }
});

test('AUTO-VERIFICACIÓN: el guard escaneó el árbol real y encontró el punto único', () => {
  const scanned = ROOTS.flatMap(listFiles).map((f) => relative(APP_ROOT, f).split(sep).join('/'));
  assert.ok(scanned.length >= 300, `el guard debería escanear el árbol real (vio ${scanned.length})`);
  assert.ok(scanned.includes(EFFECT_FILE), `${EFFECT_FILE} tiene que existir con ese path exacto`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (2) LOS ASSETS: cada cue que la DECISIÓN puede pedir tiene su .wav en el repo
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SOUNDS_DIR = join(APP_ROOT, 'assets', 'sounds');

/** Los cues que `decideFeedback` puede llegar a pedir, derivados EJECUTÁNDOLA sobre todo el espacio. */
function reachableCues(): SoundCue[] {
  const cues = new Set<SoundCue>();
  for (const platform of ['web', 'native'] as FeedbackPlatform[]) {
    for (const beep of [true, false]) {
      for (const outcome of ['accepted', 'rejected', 'duplicate'] as ReadOutcome[]) {
        const { sound } = decideFeedback(platform, beep, outcome);
        if (sound) cues.add(sound.cue);
      }
    }
  }
  return [...cues].sort();
}

test('GUARD: todo cue alcanzable por la decisión tiene su asset en el repo, y el punto único lo pide', () => {
  // No es la lista de assets que HAY: es la lista de los que la decisión puede PEDIR, obtenida
  // ejecutándola. Un cue nuevo sin .wav nace en rojo acá y no en el bundler de otra persona.
  const cues = reachableCues();
  assert.deepEqual(cues, ['read-error', 'read-ok'], 'cambió el set de cues alcanzables');

  // `stripSourceComments` y no el crudo (⚪ del review): sin esto, un `require` COMENTADO satisfacía el
  // chequeo de abajo — Metro no lo empaquetaría y el cue quedaría mudo con el guard en verde.
  const effect = stripSourceComments(readFileSync(join(APP_ROOT, EFFECT_FILE), 'utf8'));
  for (const cue of cues) {
    const file = join(SOUNDS_DIR, `${cue}.wav`);
    assert.ok(existsSync(file), `falta el asset del cue \`${cue}\`: ${file} (corré scripts/gen-baston-sounds.mjs)`);
    // Un .wav de 44 bytes es una cabecera RIFF sin muestras: existe y no suena.
    assert.ok(statSync(file).size > 2000, `el asset de \`${cue}\` está vacío o truncado (${statSync(file).size} bytes)`);
    assert.ok(
      effect.includes(`assets/sounds/${cue}.wav`),
      `el punto único no hace \`require\` del asset de \`${cue}\`: Metro no lo empaqueta y el cue es mudo`,
    );
  }
});

test('GUARD: los .wav son PCM 16-bit mono decodificables (no un archivo cualquiera renombrado)', () => {
  // El oráculo barato de "esto suena": cabecera RIFF/WAVE válida, mono, y con muestras que NO son todas
  // cero. Un asset silencioso pasaría cualquier chequeo de existencia y dejaría al peón sin aviso.
  for (const cue of reachableCues()) {
    const buf = readFileSync(join(SOUNDS_DIR, `${cue}.wav`));
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF', `${cue}: no es un RIFF`);
    assert.equal(buf.toString('ascii', 8, 12), 'WAVE', `${cue}: no es un WAVE`);
    assert.equal(buf.readUInt16LE(20), 1, `${cue}: no es PCM sin comprimir`);
    assert.equal(buf.readUInt16LE(22), 1, `${cue}: no es mono`);
    assert.equal(buf.readUInt16LE(34), 16, `${cue}: no es 16-bit`);
    const dataBytes = buf.readUInt32LE(40);
    assert.equal(buf.length, 44 + dataBytes, `${cue}: el tamaño declarado no coincide con el archivo`);
    let peak = 0;
    for (let i = 44; i < 44 + dataBytes; i += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
    assert.ok(peak > 16384, `${cue}: el asset es (casi) SILENCIO (pico ${peak}/32767) — no se va a oír en la manga`);
    const durationMs = (dataBytes / 2 / buf.readUInt32LE(24)) * 1000;
    assert.ok(durationMs >= 50 && durationMs <= 600, `${cue}: dura ${durationMs.toFixed(0)} ms (se pide corto)`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (3) EL MODO DE AUDIO: el beep no puede cortarle la radio al peón
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('GUARD: el aviso NO pide foco de audio (si no, cada bastonazo le corta la radio al peón)', () => {
  // Es la clave más cara del archivo y la que nadie va a notar en una revisión de código: sin fijar el
  // modo, iOS deja la sesión en `soloAmbient` (el default del SO) y CADA bastonazo interrumpe la música
  // o la radio de fondo. En una manga donde se trabaja con la radio prendida, el peón apaga el aviso el
  // primer día y volvemos al 🟡-11 por la puerta de atrás. Se verifica el VALOR, no el texto del archivo.
  assert.equal(
    FEEDBACK_AUDIO_MODE.interruptionMode,
    'mixWithOthers',
    'el aviso de lectura pasó a pedir foco de audio: le va a cortar la radio al operario en cada animal',
  );
  assert.equal(FEEDBACK_AUDIO_MODE.shouldPlayInBackground, false, 'un pip no necesita audio en background');
  assert.equal(FEEDBACK_AUDIO_MODE.allowsRecording, false, 'el aviso NO graba: eso arrastraría el micrófono');
  assert.equal(FEEDBACK_AUDIO_MODE.shouldRouteThroughEarpiece, false, 'tiene que salir por el parlante, no por el auricular');
  // Decisión de producto documentada en `feedback-logic.ts`: suena con el teléfono en silencio. Este
  // assert obliga a venir a cambiarlo a conciencia — y lo que hay que saber al hacerlo es que revertirlo
  // NO es "volver al default": en Android el default del módulo ya es `true` (`AudioModule.kt:63`) y con
  // `false` el `Function("play")` hace un `return` ANTES de tocar (`AudioModule.kt:472`), o sea que el
  // pip queda MUDO con el timbre en silencio o en vibración.
  assert.equal(FEEDBACK_AUDIO_MODE.playsInSilentMode, true);

  // Y el punto único LO USA: la constante más correcta del mundo no sirve si nadie la pasa.
  const effect = stripSourceComments(readFileSync(join(APP_ROOT, EFFECT_FILE), 'utf8'));
  assert.match(
    effect,
    /setAudioModeAsync\(\{\s*\.\.\.FEEDBACK_AUDIO_MODE\s*\}\)/,
    'el punto único no fija el modo de audio con `FEEDBACK_AUDIO_MODE` (o lo reescribió con un literal ' +
      'propio, que es lo mismo que no tener la constante).',
  );
});

test('GUARD: el aviso NEGATIVO no es el mismo archivo que el positivo (🟡-12)', () => {
  // El fix entero de 🟡-12 se puede anular copiando un .wav sobre el otro: los dos desenlaces volverían a
  // ser indistinguibles para el peón y toda la lógica de arriba seguiría en verde.
  const ok = readFileSync(join(SOUNDS_DIR, 'read-ok.wav'));
  const bad = readFileSync(join(SOUNDS_DIR, 'read-error.wav'));
  assert.ok(!ok.equals(bad), 'el aviso de "no sirvió" es byte a byte el mismo que el de "entró"');
  // Y son distinguibles en la dimensión que se percibe con ruido y con guante: la DURACIÓN.
  const ms = (b: Buffer) => (b.readUInt32LE(40) / 2 / b.readUInt32LE(24)) * 1000;
  assert.ok(
    ms(bad) > ms(ok) * 1.5,
    `el aviso negativo (${ms(bad).toFixed(0)} ms) tiene que ser claramente más largo que el positivo ` +
      `(${ms(ok).toFixed(0)} ms): con ruido de manga, el largo se distingue antes que el timbre`,
  );
});
