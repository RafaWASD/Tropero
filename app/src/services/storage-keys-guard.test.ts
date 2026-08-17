// GUARD: las OCHO claves de storage `rafq.*` que YA VIVEN EN LOS DEVICES INSTALADOS están DECLARADAS,
// y renombrar cualquiera de ellas nace en ROJO.
//
// ── EL PROBLEMA QUE CIERRA (auditoría del rebrand, 2026-08-17) ───────────────────────────────────────
// Ocho prefijos de `AsyncStorage`/`SecureStore`/`localStorage` empiezan con **`rafq.`** — la variante
// SIN la "a", que es OTRA CADENA que el nombre viejo de la marca. Renombrarlas **le borra el estado a
// todo device ya instalado**: no hay OTA, no hay migración, y el usuario se entera en la manga.
//
// Hasta hoy nadie las había declarado en ningún lado. `brand-name-guard.test.ts` sólo conoce `rafaq`
// (con "a"), así que ninguna regla las miraba: alguien que "terminara el rebrand" cambiando el prefijo
// pasaba en VERDE por las 22 stages del check. La exención de `rafaq.db` de aquel guard existe con su
// motivo escrito justamente por esta propiedad — estas ocho no tenían ni eso.
//
// ── LAS DOS DIRECCIONES QUE VIGILA ───────────────────────────────────────────────────────────────────
//   1. NINGUNA CLAVE SIN DECLARAR — todo literal del árbol de producción que arranque con `rafq.` tiene
//      que estar en `STORAGE_KEYS`. Una clave nueva hardcodeada nace en rojo (escrito sobre la AUSENCIA:
//      se enumera el ÁRBOL, no una lista de archivos que alguien recordó).
//   2. NINGUNA DECLARACIÓN HUÉRFANA — cada clave declarada tiene que seguir existiendo en su módulo. Si
//      alguien la renombra, el barrido no la encuentra y el mensaje dice QUÉ SE PIERDE en el device y
//      que el rename correcto es una MIGRACIÓN (leer la vieja, escribir la nueva, borrar la vieja en el
//      primer arranque), no un swap de literal.
//   3. …y cada clave vive en el módulo que el registro dice, y en ÉSE (una copia pegada en otra pantalla
//      es dos dueños para el mismo dato del device).
//
// ── POR QUÉ NO HAY UNA CONSTANTE `STORAGE_PREFIX` (el fix que proponía el backlog, DESCARTADO) ────────
// El backlog proponía centralizar el prefijo en una constante única de la que salieran las ocho. Se
// descartó por dos motivos, y quedan escritos acá para que nadie lo "arregle" de vuelta:
//
//   (a) CENTRALIZAR EL PREFIJO HACE QUE LA OPERACIÓN PELIGROSA CUESTE UNA LÍNEA. Es al revés de lo que
//       queremos. El riesgo acá no es la duplicación del literal —ocho literales duplicados no rompieron
//       nada nunca— es que nadie había DECLARADO que estas claves viven en el device. Con un
//       `STORAGE_PREFIX`, renombrar las ocho de golpe es un diff de una línea que pasa desapercibido en
//       un review; con ocho literales + este registro, renombrar es ruidoso y caro: hay que tocar ocho
//       módulos y venir a discutir con ocho motivos escritos. La fricción es la defensa.
//   (b) ROMPERÍA UN GUARD VIVO DE OTRA UNIDAD. `app/src/services/ble/wiring.test.ts` exige que el
//       literal del bastón recordado viva en EXACTAMENTE UN módulo, buscándolo como literal. Si
//       `remembered-device.ts` pasara a construir su clave desde un prefijo compartido, ese literal
//       desaparece del árbol y aquel guard se pone rojo sin que se haya roto nada de lo que él cuida.
//
// ── ALCANCE DECLARADO: QUÉ **NO** CUBRE ESTE GUARD ───────────────────────────────────────────────────
// La forma que aísla las claves de storage del resto de los `rafq` del repo es «comilla (o backtick)
// seguida INMEDIATAMENTE de `rafq.`». Los otros cuatro usos de `rafq` NO matchean esa forma y están
// FUERA DE ESTE GUARD A PROPÓSITO — son identidad de app y dominio, se difieren junto con el bundle id,
// y ya están registrados en `docs/backlog.md`:
//   · `ar.rafq.app` / `.dev` / `.web` — bundle id y Services ID de Apple (va con el bundle id).
//   · `rafq://`                       — scheme de deep-link (sin OTA, cambiarlo mata las builds vivas).
//   · `noreply@rafq.ar`               — remitente de Resend; la REGLA E de `brand-name-guard` EXIGE que
//                                       siga (Resend verifica el dominio, no el display name).
//   · `app.rafq.ar`                   — el dominio MUERTO; lo prohíbe el `DEAD_ORIGIN` de aquel guard.
// Si mañana alguien quiere cubrir esos cuatro, es OTRA regla con OTRO criterio: acá se rechazan por
// forma, no por olvido.
//
// LÍMITE de la forma, declarado: una clave ARMADA por concatenación (`` `${NS}.lockout.${x}` ``) no la
// ve la regla 1 — no hay literal que matchear. Pero eso NO es un agujero para las ocho que existen: si
// alguien reescribe una de ellas así, el literal desaparece del árbol y la regla 2 se pone ROJA por
// huérfana. O sea, el guard es fail-closed para lo que ya vive en los devices; lo que sí podría entrar
// sin declarar es una clave NUEVA construida a mano, y para eso está el review.
//
// Tampoco cubre las MENCIONES fuera de `app/app` + `app/src`: hoy tres specs de `app/e2e` hardcodean
// tres de estas claves (`baston-feedback-sensorial.spec.ts`, las dos capturas de `ios-ble-mfi`,
// `reactividad-sync.spec.ts`). No se asertan acá para no acoplar este guard a un directorio de tests que
// se reescribe seguido — pero el mensaje de la regla 2 las ENUMERA cuando una clave desaparece, así el
// rename incompleto se ve entero de una.
//
// ── NOTA SOBRE ESTE ARCHIVO Y EL GUARD DEL BASTÓN ────────────────────────────────────────────────────
// El registro de abajo escribe los ocho literales COMPLETOS, incluido el del bastón recordado. Eso no
// choca con el guard de `wiring.test.ts` («ese literal vive en exactamente un módulo») porque los
// escaneos de árbol de este repo excluyen los `.test.*` — el propio `wiring.test.ts` contiene ese
// literal en su código y se auto-reportaría si no fuera así.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`. Un guard que no corre no
// existe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../utils/strip-comments';
import { assertScanCoverage } from '../utils/scan-coverage';

const HERE = resolve(fileURLToPath(import.meta.url), '..'); // app/src/services
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/**
 * Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Medido hoy: 406. Mismo piso que
 * `brand-name-guard`, que barre exactamente el mismo universo. Ver `utils/scan-coverage.ts`.
 */
const SCANNED_FILES_FLOOR = 300;

// ── EL REGISTRO ──────────────────────────────────────────────────────────────────────────────────────

interface StorageKey {
  /**
   * El literal TAL COMO APARECE EN EL CÓDIGO: desde `rafq.` hasta donde deja de ser texto literal. Para
   * las claves parametrizadas (template literals) termina en el punto que precede a la interpolación.
   */
  literal: string;
  /** La clave COMPLETA que termina en el device, con sus partes variables. */
  shape: string;
  /** El módulo DUEÑO, relativo a `app/`. La clave tiene que vivir ahí, y sólo ahí. */
  module: string;
  /** QUÉ SE PIERDE en todo device ya instalado si se renombra. Texto real, no una etiqueta. */
  breaks: string;
}

const STORAGE_KEYS: readonly StorageKey[] = [
  {
    literal: 'rafq.ble.beep_enabled',
    shape: 'rafq.ble.beep_enabled',
    module: 'src/services/ble/feedback-pref.ts',
    breaks:
      'la preferencia de BEEP del bastón. El operario que la apagó a propósito (porque trabaja con el ' +
      'teléfono en el bolsillo y el pitido lo confunde) vuelve al default sin avisar, y se entera con ' +
      'el rodeo encerrado.',
  },
  {
    literal: 'rafq.ble.remembered_device',
    shape: 'rafq.ble.remembered_device',
    module: 'src/services/ble/remembered-device.ts',
    breaks:
      'el BASTÓN RECORDADO. La app deja de reconectar sola y hay que RE-EMPAREJAR EN LA MANGA, con los ' +
      'animales adentro y una mano ocupada. Es la peor de las ocho: no es un default que se pierde, es ' +
      'una tarea manual en el peor momento posible.',
  },
  {
    literal: 'rafq.est_trail.',
    shape: 'rafq.est_trail.<uid>',
    module: 'src/services/establishment-store.ts',
    breaks:
      'el rastro de campos recientes por usuario — y con él el campo ACTIVO, que es su head. El usuario ' +
      'con dos campos aterriza en el que no estaba usando y puede cargar datos en el establecimiento ' +
      'equivocado antes de darse cuenta.',
  },
  {
    literal: 'rafq.banner_dismissed.',
    shape: 'rafq.banner_dismissed.<uid>',
    module: 'src/services/establishment-store.ts',
    breaks:
      'el set de banners "establecimiento listo" que el usuario ya descartó. Vuelven a aparecer todos, ' +
      'uno por campo, en gente que ya los había cerrado hace meses.',
  },
  {
    literal: 'rafq.lockout.',
    shape: 'rafq.lockout.<hash-del-email>',
    module: 'src/services/lockout-store.ts',
    breaks:
      'el contador de intentos fallidos de login por email: AFLOJA UNA DEFENSA. El bloqueo se reinicia ' +
      'para todos a la vez, así que el rename le regala al atacante casual una tanda entera de intentos ' +
      'sin espera. (El rate-limit de Supabase Auth sigue siendo la defensa real; esto es el freno de UX ' +
      'que persiste del lado del cliente — el único que sobrevive a un reload.)',
  },
  {
    literal: 'rafq.active_rodeo.',
    shape: 'rafq.active_rodeo.<uid>.<estId>',
    module: 'src/services/rodeo-store.ts',
    breaks:
      'el RODEO ACTIVO por (usuario, campo). La jornada en curso pierde el rodeo y el operario tiene ' +
      'que volver a elegirlo — en la pantalla de maniobra, que es donde menos tiempo hay.',
  },
  {
    literal: 'rafq.last_rodeo.',
    shape: 'rafq.last_rodeo.<uid>.<estId>',
    module: 'src/services/last-rodeo.ts',
    breaks:
      'el último rodeo usado por (usuario, campo), que es el DEFAULT de las altas. Sin él, cada alta ' +
      'arranca sin rodeo preseleccionado y hay que elegirlo animal por animal.',
  },
  {
    literal: 'rafq.pending_invitation_token',
    shape: 'rafq.pending_invitation_token',
    module: 'src/services/pending-invitation.ts',
    breaks:
      'UNA INVITACIÓN EN CURSO. El token se guarda cuando el invitado abre el link sin estar logueado y ' +
      'tiene que sobrevivir el signup + la verificación de email + un kill de la app (spec 01, R5.13). ' +
      'Perderlo deja al invitado adentro de la app pero fuera del campo, sin nada que reintentar: el ' +
      'link ya lo usó.',
  },
];

/**
 * LA FORMA que aísla una clave de storage: comilla simple, doble o backtick seguida INMEDIATAMENTE de
 * `rafq.`. Captura el literal desde `rafq.` hasta el primer carácter que no puede ser parte de la clave
 * (la interpolación `${…}` de un template, o la comilla de cierre).
 *
 * Es lo que deja afuera —por forma, no por lista— a `ar.rafq.app`, `app.rafq.ar` y `noreply@rafq.ar`
 * (el `rafq.` va precedido de `.` o `@`, no de la comilla) y a `rafq://` (no hay punto después).
 */
const KEY_LITERAL_RE = /['"`](rafq\.[\w.-]*)/g;

/** Los literales de clave que aparecen en un texto YA SIN COMENTARIOS. Puro: falsificable con casos. */
function literalsIn(code: string): string[] {
  return [...code.matchAll(KEY_LITERAL_RE)].map((m) => m[1]);
}

// ── Motor de escaneo ─────────────────────────────────────────────────────────────────────────────────

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
    if (statSync(p).isDirectory()) {
      found.push(...listFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      // Los `.test.*` quedan fuera: traen los literales en sus casos sintéticos (este archivo, el
      // primero) y se auto-reportarían.
      found.push(p);
    }
  }
  return found;
}

/** Nº de línea (1-based) del índice `i` dentro de `src`. */
function lineAt(src: string, i: number): number {
  let line = 1;
  for (let k = 0; k < i; k++) if (src[k] === '\n') line++;
  return line;
}

interface Hit {
  literal: string;
  /** Path relativo a `app/`, con `/` (mismo formato que `StorageKey.module`). */
  file: string;
  line: number;
  /** La línea CRUDA, para que el mensaje muestre el código real. */
  text: string;
}

interface Scan {
  files: string[];
  hits: Hit[];
}

let cached: Scan | null = null;

function scanTree(): Scan {
  if (cached) return cached;
  const files = ROOTS.flatMap(listFiles);
  const hits: Hit[] = [];
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const code = stripSourceComments(raw);
    const rel = relative(APP_ROOT, file).split(sep).join('/');
    const rawLines = raw.split(/\r?\n/);
    let m: RegExpExecArray | null;
    const re = new RegExp(KEY_LITERAL_RE.source, KEY_LITERAL_RE.flags);
    while ((m = re.exec(code)) !== null) {
      const line = lineAt(code, m.index);
      hits.push({ literal: m[1], file: rel, line, text: (rawLines[line - 1] ?? '').trim() });
    }
  }
  cached = { files, hits };
  return cached;
}

/**
 * Otros archivos del árbol de `app/` (incluidos los tests y las specs de `app/e2e`) que mencionan el
 * literal. Se usa SÓLO para el mensaje de la regla 2: cuando una clave desaparece de su módulo, estas
 * son las puntas que quedaron diciendo el nombre viejo. No se asertan (ver "ALCANCE DECLARADO").
 */
function mirrorsOf(literal: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name === '.expo') continue;
      const p = join(dir, name);
      // Este helper sólo alimenta un MENSAJE de error: un archivo ilegible (symlink roto, permiso) no
      // puede convertir una aserción con diagnóstico en una excepción sin él.
      try {
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && p !== fileURLToPath(import.meta.url)) {
          if (readFileSync(p, 'utf8').includes(literal)) out.push(relative(APP_ROOT, p).split(sep).join('/'));
        }
      } catch {
        /* ignorado a propósito: ver arriba */
      }
    }
  };
  walk(APP_ROOT);
  return out;
}

const fmt = (h: Hit) => `${h.file}:${h.line}  ${h.text}`;

// ── ANTI-VACUIDAD (va PRIMERO: un guard sin entrada se ve igual que un guard verde) ──────────────────

test('ANTI-VACÍO — el barrido encuentra el árbol y encuentra las claves', () => {
  const { files, hits } = scanTree();

  assert.ok(
    files.length >= SCANNED_FILES_FLOOR,
    `el barrido devolvió ${files.length} archivos y el piso es ${SCANNED_FILES_FLOOR}: el listado se ` +
      'rompió (¿se movió/renombró `app/app` o `app/src`?). Un guard que mira menos archivos de los que ' +
      'cree NO se pone rojo solo, se pone VERDE — y este en particular pasaría a decir que las ocho ' +
      'claves "ya no existen" o que "no hay ninguna sin declarar", las dos cosas mentira.',
  );

  assert.ok(
    hits.length >= STORAGE_KEYS.length,
    `el barrido encontró ${hits.length} literales \`rafq.*\` y el registro declara ${STORAGE_KEYS.length}. ` +
      'Hay DOS causas posibles y las dos importan: (a) desapareció una clave del árbol —la nombra la ' +
      'regla 2, que falla junto con esta y dice QUÉ SE PIERDE en el device—, o (b) el escáner dejó de ' +
      'ver el código real (cambió la forma del literal, se rompió el blanqueo de comentarios, el regex ' +
      'dejó de matchear). Que reviente acá con el número a la vista: si (b) pasara en silencio, las tres ' +
      'reglas de abajo se volverían tests que no pueden fallar — la 1 no tendría nada que rechazar y la ' +
      '2 acusaría a las ocho de huérfanas por un motivo falso. (Hoy: 8 en código + 3 menciones en ' +
      'comentarios que el blanqueo descarta.)',
  );
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  assertScanCoverage({
    guard: 'storage-keys',
    files: scanTree().files,
    minFiles: SCANNED_FILES_FLOOR,
    label: (f) => relative(APP_ROOT, f).split(sep).join('/'),
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripSourceComments,
  });
});

// ── LAS DOS DIRECCIONES ──────────────────────────────────────────────────────────────────────────────

test('1 — NINGUNA clave de storage sin declarar (una clave nueva hardcodeada nace en rojo)', () => {
  const declared = new Set(STORAGE_KEYS.map((k) => k.literal));
  const undeclared = scanTree().hits.filter((h) => !declared.has(h.literal));

  assert.deepEqual(
    undeclared.map(fmt),
    [],
    'Estos literales `rafq.*` no están en `STORAGE_KEYS`. Una clave de storage es ESTADO QUE YA VIVE EN ' +
      'LOS DEVICES INSTALADOS: no hay OTA y no hay migración automática, así que renombrarla o borrarla ' +
      'destruye lo que el usuario tenía. Declarala en el registro de este archivo con su módulo dueño y ' +
      'con QUÉ SE PIERDE si se renombra (texto real, no una etiqueta) — o, si lo que agregaste no es una ' +
      'clave de storage, no la escribas con esa forma.',
  );
});

test('2 — NINGUNA declaración huérfana (renombrar una clave viva pone esto en ROJO)', () => {
  const { hits } = scanTree();
  const orphans = STORAGE_KEYS.filter((k) => !hits.some((h) => h.literal === k.literal));

  assert.deepEqual(
    orphans.map((k) => {
      const mirrors = mirrorsOf(k.literal);
      return (
        `${k.shape} (dueño: ${k.module}) — SE PIERDE: ${k.breaks}` +
        (mirrors.length > 0 ? ` · todavía la nombran: ${mirrors.join(', ')}` : '')
      );
    }),
    [],
    'Estas claves están declaradas pero YA NO EXISTEN en el árbol: alguien las renombró o las borró. ' +
      'Renombrar una clave de storage NO es un swap de literal — es una MIGRACIÓN: en el primer arranque ' +
      'se LEE la clave vieja, se ESCRIBE la nueva y recién ahí se BORRA la vieja; el código de migración ' +
      'se deja puesto hasta que se pueda asumir que todos los devices arrancaron al menos una vez. Sin ' +
      'eso, todo device ya instalado pierde ese estado en silencio y el usuario se entera usando la app. ' +
      'Si de verdad la clave dejó de existir a propósito (se borró la feature), sacá la entrada del ' +
      'registro EN EL MISMO COMMIT y decí por qué.',
  );
});

test('3 — cada clave vive en el módulo que declara el registro, y en ÉSE', () => {
  const { hits } = scanTree();
  const intrusos: string[] = [];
  for (const k of STORAGE_KEYS) {
    for (const h of hits.filter((x) => x.literal === k.literal && x.file !== k.module)) {
      intrusos.push(`${k.shape} declarada en ${k.module} pero también en ${fmt(h)}`);
    }
  }
  assert.deepEqual(
    intrusos,
    [],
    'Una clave de storage con dos dueños es una clave que se renombra a medias: el que edita un módulo ' +
      'no sabe que el otro escribe el mismo slot del device. Dejá la clave en su módulo y exportá una ' +
      'función para leerla/escribirla. (Si el dueño CAMBIÓ a propósito, actualizá el registro.)',
  );
});

// ── HIGIENE DEL REGISTRO (el patrón de las exenciones de `brand-name-guard`) ─────────────────────────

test('el registro declara las OCHO, sin duplicados, y cada motivo tiene sustancia', () => {
  // El conteo escrito: si alguien SACA una entrada para hacer callar la regla 2, este número lo delata.
  assert.equal(
    STORAGE_KEYS.length,
    8,
    'la auditoría del 2026-08-17 encontró OCHO claves `rafq.*` en el device. Si agregás o sacás una, ' +
      'actualizá este número Y el header de este archivo Y la entrada de `docs/backlog.md` en el mismo ' +
      'commit — un conteo que se desactualiza en silencio es la forma en que estas ocho se perdieron de ' +
      'vista la primera vez.',
  );

  const literales = STORAGE_KEYS.map((k) => k.literal);
  assert.equal(new Set(literales).size, literales.length, 'hay dos entradas con el mismo literal');

  for (const k of STORAGE_KEYS) {
    assert.ok(
      k.breaks.trim().length > 40,
      `la clave "${k.literal}" necesita un motivo ESCRITO de qué se pierde, no una etiqueta: es el texto ` +
        'que va a leer quien esté por renombrarla.',
    );
    assert.ok(
      k.shape.startsWith(k.literal),
      `"${k.shape}" no arranca con el literal "${k.literal}": la forma completa y el literal que el ` +
        'barrido busca tienen que ser la misma clave.',
    );
    assert.match(k.module, /^src\/services\/[\w/-]+\.ts$/, `el dueño de "${k.literal}" tiene que ser un módulo`);
    // El módulo dueño existe de verdad (un path podrido dejaría la regla 3 sin poder acusar a nadie).
    assert.ok(
      statSync(join(APP_ROOT, k.module)).isFile(),
      `el módulo dueño declarado para "${k.literal}" (${k.module}) no existe`,
    );
  }
});

// ── FALSIFICACIÓN: el extractor DETECTA, y no dispara donde no debe ──────────────────────────────────

test('el extractor DETECTA las formas reales (y NO los cuatro `rafq` fuera de alcance)', () => {
  // Las dos formas en que estas claves están escritas hoy: literal entero y template parametrizado.
  assert.deepEqual(literalsIn("const K = 'rafq.pending_invitation_token';"), ['rafq.pending_invitation_token']);
  assert.deepEqual(literalsIn('const K = "rafq.ble.beep_enabled";'), ['rafq.ble.beep_enabled']);
  assert.deepEqual(literalsIn('return `rafq.lockout.${hash}`;'), ['rafq.lockout.']);
  assert.deepEqual(literalsIn('return `rafq.active_rodeo.${safe(u)}.${safe(e)}`;'), ['rafq.active_rodeo.']);

  // Una clave NUEVA hardcodeada la ve, aunque nadie la haya declarado nunca (el caso 1 de la regla).
  assert.deepEqual(literalsIn("const K = 'rafq.algo_nuevo';"), ['rafq.algo_nuevo']);

  // LOS CUATRO FUERA DE ALCANCE: no matchean POR FORMA (el `rafq.` no va pegado a la comilla, o no hay
  // punto). Si alguna de estas empezara a disparar, el guard estaría pidiendo declarar el bundle id.
  assert.deepEqual(literalsIn("const APP_ID = 'ar.rafq.app';"), [], 'bundle id');
  assert.deepEqual(literalsIn("const S = 'ar.rafq.dev'; const W = 'ar.rafq.web';"), [], 'los otros dos ids');
  assert.deepEqual(literalsIn("const link = 'rafq://invite?token=' + t;"), [], 'scheme de deep-link');
  assert.deepEqual(literalsIn("const FROM = 'noreply@rafq.ar';"), [], 'remitente de Resend');
  assert.deepEqual(literalsIn("const DEAD = 'https://app.rafq.ar';"), [], 'el dominio muerto');

  // El nombre VIEJO de la marca (con "a") es OTRA cadena y la cuida `brand-name-guard`, no este guard.
  assert.deepEqual(literalsIn(`const DB = '${['raf', 'aq'].join('')}.db';`), [], 'el archivo SQLite local');

  // Y una MENCIÓN EN UN COMENTARIO no es una clave: sobre el árbol crudo el barrido da 11 hits y sólo 8
  // son código. Sin el blanqueo, tres comentarios contarían como claves vivas y la regla 2 no podría
  // ponerse roja al renombrar una (el comentario la seguiría "encontrando").
  assert.deepEqual(literalsIn(stripSourceComments("// la clave 'rafq.lockout.<hash>' no se renombra")), []);
  assert.deepEqual(literalsIn(stripSourceComments('/* ver `rafq.est_trail.<uid>` en el backlog */')), []);
  assert.deepEqual(
    literalsIn(stripSourceComments("// ojo: `rafq.*`\nconst K = 'rafq.ble.beep_enabled';")),
    ['rafq.ble.beep_enabled'],
    'el comentario se descarta pero el código de la línea siguiente NO',
  );
});

test('las reglas 1/2/3 DETECTAN sobre entradas sintéticas (los predicados, sin tocar el árbol)', () => {
  // Los mismos predicados que usan las reglas, ejercidos con hits fabricados. Sin esto, las tres podrían
  // estar comparando mal —o no comparando nada— y verse igual: verde.
  const declared = new Set(STORAGE_KEYS.map((k) => k.literal));
  const h = (literal: string, file: string): Hit => ({ literal, file, line: 1, text: '' });

  // (1) sin declarar
  assert.equal([h('rafq.algo_nuevo', 'src/services/x.ts')].filter((x) => !declared.has(x.literal)).length, 1);
  assert.equal(
    [h('rafq.lockout.', 'src/services/lockout-store.ts')].filter((x) => !declared.has(x.literal)).length,
    0,
  );
  // Un rename cae del lado de "sin declarar" además de dejar la vieja huérfana: las dos reglas disparan.
  assert.equal([h('mitropero.lockout.', 'src/services/lockout-store.ts')].filter((x) => !declared.has(x.literal)).length, 1);

  // (2) huérfana: con un conjunto de hits que NO trae la clave, la entrada queda sin match.
  const sinLockout = STORAGE_KEYS.filter((k) => k.literal !== 'rafq.lockout.').map((k) => h(k.literal, k.module));
  const huerfanas = STORAGE_KEYS.filter((k) => !sinLockout.some((x) => x.literal === k.literal));
  assert.deepEqual(huerfanas.map((k) => k.literal), ['rafq.lockout.']);
  // …y el motivo que se le muestra a quien la renombró nombra la defensa que se afloja.
  assert.match(huerfanas[0].breaks, /AFLOJA UNA DEFENSA/);
  assert.match(huerfanas[0].breaks, /intentos fallidos de login/);

  // El enumerador de MENCIONES que el mensaje de la regla 2 le muestra a quien renombró. Sólo aparece
  // cuando algo ya está roto, así que si no se ejerce acá nadie se entera de que dejó de funcionar — y el
  // mensaje que importa saldría con la lista vacía justo el día que hace falta.
  const espejos = mirrorsOf('rafq.lockout.');
  assert.ok(espejos.includes('src/services/lockout-store.ts'), `mirrorsOf no encontró el módulo: ${espejos}`);
  assert.deepEqual(mirrorsOf('rafq.clave_que_no_existe_en_ningun_lado'), [], 'y no inventa menciones');

  // (3) dueño equivocado: el mismo literal en otro módulo es un intruso.
  const k = STORAGE_KEYS.find((x) => x.literal === 'rafq.active_rodeo.');
  assert.ok(k);
  assert.equal([h(k.literal, 'src/services/otro-store.ts')].filter((x) => x.file !== k.module).length, 1);
  assert.equal([h(k.literal, k.module)].filter((x) => x.file !== k.module).length, 0);
});
