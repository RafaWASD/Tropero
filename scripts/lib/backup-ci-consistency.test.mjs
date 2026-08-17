// scripts/lib/backup-ci-consistency.test.mjs — GUARD del contrato entre el script de backup y el CI.
//
// POR QUÉ EXISTE. El nombre del dump de PROD se decide en UN solo lugar (`backupFilename()` en
// `backup-cmd.mjs`) pero se CONSUME en otro (`.github/workflows/backup-prod.yml`): el paso de cifrado
// busca el archivo con un glob, el job de verificación lo baja por nombre de artifact. Nada ataba las dos
// puntas. Cambiar el prefijo en el script y olvidar el glob del workflow rompe el backup diario de PROD
// EN SILENCIO: `gpg` no encuentra el `.sql.gz`, no hay `.gpg` para subir, y lo único que queda es un job
// rojo a las 3 AM que nadie mira. Es exactamente la clase de falla muda que costó 8 corridas el
// 2026-08-09, y la peor de todas: se descubre el día que hace falta restaurar.
//
// CÓMO ESTÁ ESCRITO. Sobre la AUSENCIA y por DERIVACIÓN: el guard no sabe cómo se llama el backup. Le
// pregunta a `backupFilename()` (comportamiento, no regex sobre el fuente) y con ese nombre real exige que
// TODA referencia del workflow sea consistente. Si mañana alguien renombra el prefijo, este test nace en
// rojo sin que nadie se acuerde de venir a actualizarlo — que es el único guard que sirve.
//
// LO QUE NO PUEDE VER. Que el workflow CORRA verde. Este oráculo es estático: dice que los nombres son
// coherentes entre sí, no que el secret exista ni que PROD conteste. El workflow corre contra PROD y NO se
// dispara para probar.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backupFilename, isoStamp } from './backup-cmd.mjs';
import { prodConfirmed, ACCEPTED_CONFIRM_PROD_ENVS } from './env-target.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = join(repoRoot, '.github', 'workflows');
const BACKUP_WORKFLOW = join(WORKFLOWS_DIR, 'backup-prod.yml');
const BACKUP_SCRIPT = join(repoRoot, 'scripts', 'backup-db.mjs');

const workflow = readFileSync(BACKUP_WORKFLOW, 'utf8');
const workflowLines = workflow.split(/\r?\n/);

// La línea que EJECUTA el script (un `run:`, no una mención en un comentario: si el ancla se pudiera
// satisfacer con prosa, el guard se desactivaría solo el día que alguien borre el paso y deje el comentario).
const RUN_LINE_RE = /^\s*run:\s*node\s+scripts\/backup-db\.mjs/;
const runLine = workflowLines.find((l) => RUN_LINE_RE.test(l));

// ─── Derivación del contrato (NADA hardcodeado) ──────────────────────────────────────────────────────
// Una fecha fija cualquiera: lo único que importa es que el stamp sea determinista para poder partir el
// filename en prefijo + stamp + extensión sin conocer ninguno de los tres.
const NOW = new Date('2026-07-14T03:00:05.123Z');
const REAL_NAME = backupFilename(NOW); // p.ej. "<prefijo>-2026-07-14T03-00-05-123Z.sql.gz"
const REAL_NAME_GPG = `${REAL_NAME}.gpg`; // lo que produce el paso de cifrado
const STAMP = isoStamp(NOW);
const STAMP_AT = REAL_NAME.indexOf(STAMP);
const PREFIX = STAMP_AT > 0 ? REAL_NAME.slice(0, STAMP_AT) : '';

/** Un glob de shell (`*`, `?`) a RegExp anclada. `*` y `?` NO se escapan: son los comodines. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Tokens de PATH con comodín que terminan en `.sql.gz` / `.sql.gz.gpg`, en cualquier workflow.
 * El token se corta solo en espacios (las comillas van adentro: `"$RUNNER_TEMP"/pre-*.sql.gz` es UN path
 * para el shell). De `${{ runner.temp }}/*.sql.gz.gpg` sale `}}/*.sql.gz.gpg` porque la expresión de
 * GitHub lleva espacios — no importa: de ese solo se mira el basename.
 */
const GLOB_RE = /[^\s]*\*[^\s]*\.sql\.gz(?:\.gpg)?/g;

function collectDumpGlobs(text, file) {
  const out = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    for (const m of line.match(GLOB_RE) ?? []) {
      const slash = m.lastIndexOf('/');
      out.push({
        file,
        line: i + 1,
        raw: m,
        dir: slash >= 0 ? m.slice(0, slash) : '',
        basename: slash >= 0 ? m.slice(slash + 1) : m,
      });
    }
  }
  return out;
}

/** Nombres de artifact de cada paso `actions/upload-artifact` / `actions/download-artifact`. */
function collectArtifactNames(lines, kind) {
  const names = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`uses:\\s*actions/${kind}-artifact`).test(lines[i])) continue;
    // Avanzar dentro del MISMO paso: un `- ` al inicio de línea abre el paso siguiente (y ese paso puede
    // tener su propio `name:`, que no es el del artifact).
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*-\s/.test(lines[j])) break;
      const m = lines[j].match(/^\s*name:\s*(.+?)\s*$/);
      if (m) {
        names.push({ name: m[1].replace(/^['"]|['"]$/g, ''), line: j + 1 });
        break;
      }
    }
  }
  return names;
}

// ─── El guard ────────────────────────────────────────────────────────────────────────────────────────

test('GUARD-BK-0: el contrato se puede DERIVAR del script (si esto falla, todo lo de abajo miente)', () => {
  assert.ok(STAMP_AT > 0, `backupFilename() no tiene un prefijo antes del timestamp: "${REAL_NAME}"`);
  assert.ok(PREFIX.length > 0, 'el prefijo derivado quedó vacío');
  assert.ok(
    REAL_NAME.endsWith('.sql.gz'),
    `este guard extrae los globs del CI buscando ".sql.gz"; backupFilename() ahora devuelve "${REAL_NAME}". ` +
      'Si cambió la compresión, hay que revisar el workflow Y este guard.',
  );
});

test('GUARD-BK-1: el CI corre EL script del que se deriva el nombre (ancla del guard)', () => {
  // Sin esto, el guard podría estar derivando el prefijo de un módulo que el workflow ni ejecuta.
  assert.ok(
    runLine,
    'ningún paso del workflow corre `node scripts/backup-db.mjs`: este guard está atando dos cosas que no se hablan',
  );
  assert.match(
    readFileSync(BACKUP_SCRIPT, 'utf8'),
    /from\s+'\.\/lib\/backup-cmd\.mjs'/,
    'backup-db.mjs ya no toma el nombre del archivo de lib/backup-cmd.mjs',
  );
});

test('GUARD-BK-2: TODO glob de dump en .github/workflows encuentra el archivo que el script genera', () => {
  // Se barren TODOS los workflows, no solo backup-prod.yml: si mañana otro job manipula el dump, nace
  // sujeto al mismo contrato en vez de nacer roto.
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f));
  const globs = files.flatMap((f) => collectDumpGlobs(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'), f));

  // Cota anti-vacío: hoy son 3 (cifrado, path del upload, descifrado). Un guard que no extrajo nada
  // pasaría en verde sin haber mirado nada, que es peor que no tenerlo.
  assert.ok(
    globs.length >= 3,
    `esperaba al menos 3 globs de dump en los workflows y encontré ${globs.length}: ` +
      `${JSON.stringify(globs.map((g) => g.raw))}. ¿Se borró un paso o cambió la forma del path?`,
  );

  for (const g of globs) {
    const target = g.basename.endsWith('.gpg') ? REAL_NAME_GPG : REAL_NAME;
    assert.ok(
      globToRegExp(g.basename).test(target),
      `${g.file}:${g.line} — el glob "${g.raw}" NO matchea "${target}", que es lo que produce ` +
        `backupFilename(). En el runner ese paso no encontraría el archivo y el backup se pierde EN SILENCIO ` +
        `(gpg/ls fallan sobre un glob sin expandir). Sincronizá el prefijo con scripts/lib/backup-cmd.mjs.`,
    );
  }
});

test('GUARD-BK-3: los globs buscan el dump en el MISMO dir al que el script lo escribe (--out-dir)', () => {
  // H1/R5.10: la Action pasa `--out-dir "$RUNNER_TEMP"`. Si el glob del cifrado mira otro dir, tampoco
  // encuentra nada — mismo silencio, otra causa.
  const m = runLine?.match(/--out-dir[= ]+("?[^\s"]+"?)/);
  assert.ok(m, `no pude leer el --out-dir de la invocación a backup-db.mjs: "${runLine}"`);
  const outDir = m[1].replace(/"/g, '');

  const plainGlobs = collectDumpGlobs(workflow, 'backup-prod.yml').filter((g) => !g.basename.endsWith('.gpg'));
  assert.ok(plainGlobs.length >= 1, 'no encontré ningún glob del .sql.gz sin cifrar (paso de cifrado)');
  for (const g of plainGlobs) {
    assert.equal(
      g.dir.replace(/"/g, ''),
      outDir,
      `backup-prod.yml:${g.line} — el glob busca en "${g.dir}" pero el dump se escribe en "${outDir}"`,
    );
  }
});

test('GUARD-BK-4: los artifacts se nombran con el prefijo derivado, en el upload Y en el download', () => {
  const uploads = collectArtifactNames(workflowLines, 'upload');
  const downloads = collectArtifactNames(workflowLines, 'download');

  // Cotas anti-vacío (dump + manifiesto, subidos por `backup` y bajados por `verify-restore`).
  assert.ok(uploads.length >= 2, `esperaba ≥2 upload-artifact y encontré ${uploads.length}`);
  assert.ok(downloads.length >= 2, `esperaba ≥2 download-artifact y encontré ${downloads.length}`);

  for (const a of [...uploads, ...downloads]) {
    assert.ok(
      a.name.startsWith(PREFIX),
      `backup-prod.yml:${a.line} — el artifact "${a.name}" no arranca con el prefijo "${PREFIX}" que ` +
        'deriva de backupFilename(). Renombrar el backup y dejar los artifacts con el nombre viejo deja ' +
        'el rebrand a medias justo en la red de seguridad de PROD.',
    );
  }

  // El par upload/download es DENTRO DEL MISMO RUN: `verify-restore` solo puede bajar lo que subió el job
  // `backup`. Renombrar una sola de las dos puntas hace que el download falle recién en el runner.
  const uploaded = new Set(uploads.map((a) => a.name));
  for (const d of downloads) {
    assert.ok(
      uploaded.has(d.name),
      `backup-prod.yml:${d.line} — se baja el artifact "${d.name}" y NINGÚN paso lo sube ` +
        `(subidos: ${JSON.stringify([...uploaded])}). El job de verificación fallaría en el runner.`,
    );
  }
});

// ─── El otro contrato mudo del mismo workflow: la variable de confirmación de PROD ───────────────────
// `backup-db.mjs` aborta con exit 2 si no está confirmado el destino PROD, y el ÚNICO lugar que lo
// confirma en CI es este workflow. El nombre de esa variable se renombró `RAFAQ_CONFIRM_PROD` →
// `MITROPERO_CONFIRM_PROD` (rebrand fase 7): renombrarlo en el script y no en el workflow (o al revés)
// corta el backup nocturno de PROD y el único síntoma es un job rojo a las 3 AM. Mismo modo de falla que
// el glob del nombre del dump, mismo remedio: DERIVAR la respuesta del módulo real, no hardcodear.

/** `NOMBRE: 'valor'` con forma de asignación YAML (no una mención en un comentario). */
const CONFIRM_ASSIGN_RE = /^\s*([A-Z0-9_]*CONFIRM_PROD)\s*:\s*'?([^'\s#]+)'?\s*$/;

function collectConfirmAssignments(text, file) {
  const out = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const m = line.match(CONFIRM_ASSIGN_RE);
    if (m) out.push({ file, line: i + 1, name: m[1], value: m[2] });
  }
  return out;
}

test('GUARD-BK-5: la confirmación de PROD que setea el CI es la que el script ACEPTA', () => {
  const assignments = collectConfirmAssignments(workflow, 'backup-prod.yml');

  // Cota anti-vacío: sin esto, borrar la línea del workflow dejaría el guard pasando en verde sobre un
  // conjunto vacío — y el backup abortaría en el runner por falta de confirmación.
  assert.equal(
    assignments.length,
    1,
    `esperaba EXACTAMENTE una variable de confirmación de PROD en backup-prod.yml y encontré ` +
      `${assignments.length}: ${JSON.stringify(assignments)}`,
  );

  for (const a of assignments) {
    assert.ok(
      prodConfirmed({ [a.name]: a.value }),
      `backup-prod.yml:${a.line} — el CI setea ${a.name}='${a.value}' y prodConfirmed() NO lo acepta ` +
        `(acepta: ${ACCEPTED_CONFIRM_PROD_ENVS.join(', ')} con valor '1'). backup-db.mjs abortaría con ` +
        'exit 2 y el backup diario de PROD se pierde con un job rojo a las 3 AM.',
    );
  }
});

test('GUARD-BK-6: backup-db.mjs decide la confirmación con el módulo compartido, no a mano', () => {
  // Sin este ancla, GUARD-BK-5 sería vacuo: el script podría leer `process.env.LO_QUE_SEA` por su cuenta
  // y el guard seguiría preguntándole a un módulo que el script no usa.
  const script = readFileSync(BACKUP_SCRIPT, 'utf8');
  assert.match(script, /from\s+'\.\/lib\/env-target\.mjs'/, 'backup-db.mjs ya no importa lib/env-target.mjs');
  assert.match(
    script,
    /prodConfirmedVia\(process\.env\)/,
    'backup-db.mjs dejó de decidir la confirmación de PROD con prodConfirmedVia(): si la lee a mano, el ' +
      'nombre aceptado vuelve a estar duplicado y el contrato con el CI deja de estar atado.',
  );
  assert.ok(
    !/process\.env\.[A-Z0-9_]*CONFIRM_PROD/.test(script),
    'backup-db.mjs volvió a leer una variable *CONFIRM_PROD directo de process.env',
  );
});

test('GUARD-BK-7 (L6): NINGÚN otro workflow ni otro job confirma destino PROD', () => {
  // Invariante L6 de la spec 16: la confirmación existe SOLO en el job read-only de backup. Hasta hoy era
  // prosa en el design; acá se vuelve ejecutable, y barre TODOS los workflows (no una lista) para que un
  // job nuevo que se auto-autorice a escribir en PROD nazca en rojo.
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f));
  const all = files.flatMap((f) => collectConfirmAssignments(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'), f));
  assert.deepEqual(
    all.map((a) => a.file),
    ['backup-prod.yml'],
    `la confirmación de destino PROD aparece fuera del job de backup: ${JSON.stringify(all)}`,
  );
});
