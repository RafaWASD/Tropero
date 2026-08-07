// GUARD: todo motor de búsqueda de animales consume `idvExactTerms` — nadie corre el canal IDV con el
// término compactado a secas.
//
// ── EL BUG QUE CIERRA (🔴 A.1, QA de maniobras en device 2026-08-06) ─────────────────────────────────
// `classifySearchQuery` compacta el término (borra espacio, guion, punto y barra) y los motores corrían el
// canal idv con ESE compacto — pero el idv GUARDADO conserva el guion. Tipear `PERF-00500`, que es el
// string exacto que la propia app muestra en su lista de resultados, no encontraba al animal: la app
// contestaba "Animal nuevo · Dalo de alta". Un toque = animal DUPLICADO, con la jornada del día repartida
// entre los dos registros. Es la peor clase de pérdida de datos: silenciosa, y se descubre meses después.
//
// ── POR QUÉ UN GUARD Y NO SOLO LOS TESTS DEL PLAN ───────────────────────────────────────────────────
// Porque el bug NO estaba en el plan: estaba en QUIÉN LO CONSUME. `classifySearchQuery` puede devolver los
// términos correctos y un motor seguir pasando `plan.compact` al canal idv, con todos los tests puros en
// verde. Y el bug apareció por DUPLICADO —`searchAnimals` (tab Animales + manga + cría al pie + asignar
// caravanas + find-or-create) y `searchGroupAnimals` (buscador dentro de un rodeo/lote)— porque el segundo
// motor se escribió espejando al primero. Un TERCER motor nacería con el mismo agujero.
// Por eso el guard DERIVA del árbol la lista de motores (todo archivo de `app/src` que llame a
// `classifySearchQuery`) en vez de enumerarla: el motor que se agregue mañana nace en ROJO hasta que
// consuma los términos correctos.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../utils/strip-comments';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const SRC = join(APP_ROOT, 'src');

/** Los dos motores que hoy existen. El guard NO usa esta lista para escanear: la usa para verificar que su
 *  propia detección sigue viendo lo que tiene que ver (si el archivo se renombra, el guard avisa). */
const KNOWN_ENGINES = ['src/services/animals.ts', 'src/services/group-page.ts'];

function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) found.push(...listFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(p);
  }
  return found;
}

const rel = (f: string): string => relative(APP_ROOT, f).split(sep).join('/');

/**
 * Los archivos que EJECUTAN el plan de búsqueda: lo IMPORTAN y lo LLAMAN. Las dos condiciones juntas, para
 * no confundir al motor con la DEFINICIÓN (`utils/animal-identifier.ts` contiene la firma
 * `export function classifySearchQuery(` y matchearía cualquier detección por "llamada" sola).
 */
function engines(): { rel: string; code: string }[] {
  const IMPORTS = /import\s*\{[^}]*\bclassifySearchQuery\b[^}]*\}\s*from/;
  const CALLS = /\bclassifySearchQuery\s*\(/;
  const out: { rel: string; code: string }[] = [];
  for (const file of listFiles(SRC)) {
    const code = stripSourceComments(readFileSync(file, 'utf8'));
    if (IMPORTS.test(code) && CALLS.test(code)) out.push({ rel: rel(file), code });
  }
  return out;
}

test('el guard encuentra los motores de búsqueda (si no, no está mirando nada)', () => {
  const found = engines().map((e) => e.rel).sort();
  for (const known of KNOWN_ENGINES) {
    assert.ok(found.includes(known), `${known} tiene que estar entre los motores detectados (vio: ${found.join(', ')})`);
  }
});

test('A.1: todo motor de búsqueda consume `idvExactTerms` (el término TAL CUAL, no solo el compacto)', () => {
  const offenders = engines()
    .filter((e) => !/\bplan\.idvExactTerms\b/.test(e.code))
    .map((e) => e.rel);
  assert.deepEqual(
    offenders,
    [],
    'Un motor llama a `classifySearchQuery` y NO usa `plan.idvExactTerms` para el canal idv: está ' +
      'buscando el idv solo por el término COMPACTADO, y el idv guardado conserva los separadores. Eso es ' +
      'el 🔴 A.1 — tipear la caravana como está impresa devuelve "Animal nuevo" y ofrece duplicar el ' +
      'animal. Iterá `for (const term of plan.idvExactTerms)` como hace `searchAnimals`.',
  );
});

test('A.1: ningún motor pasa `plan.compact` al canal EXACTO de idv (es la firma exacta del bug)', () => {
  const BAD = /buildSearchByIdvQuery\s*\([^)]*plan\.compact/;
  const offenders = engines().filter((e) => BAD.test(e.code)).map((e) => e.rel);
  assert.deepEqual(
    offenders,
    [],
    '`buildSearchByIdvQuery(est, plan.compact)` es la línea que produjo el bug: compara `PERF00500` contra ' +
      'un idv guardado `PERF-00500`. El término del canal exacto sale de `plan.idvExactTerms`.',
  );
});

test('A.1: el canal TAG sigue usando el compacto (no se "arregló" de más)', () => {
  // El contrafactual del fix: si alguien aplicara `idvExactTerms` también al TAG, un tipeo con espacios
  // (`982 000 364 696 050`, que es como el operario copia una electrónica) dejaría de matchear los 15
  // dígitos puros que guarda la columna. El compactado ahí es CORRECTO y tiene que quedarse.
  const TAG_EXACT = /buildSearchByTagQuery\s*\(\s*establishmentId\s*,\s*plan\.compact/;
  for (const e of engines()) {
    if (!/buildSearchByTagQuery\s*\(/.test(e.code)) continue;
    assert.match(
      e.code,
      TAG_EXACT,
      `${e.rel}: el match exacto de caravana electrónica se hace con \`plan.compact\` (15 díg puros)`,
    );
  }
});

test('A.1: el LIKE de idv corre con el compacto (la COLUMNA es la que se compacta, no el término)', () => {
  // Las dos mitades del fix tienen que quedar alineadas: `buildSearchLikeQuery` compara contra
  // `REPLACE(...ap.idv...)`, así que pasarle el término NORMALIZADO (con separadores) no matchearía nunca.
  const BAD = /buildSearchLikeQuery\s*\(\s*establishmentId\s*,\s*'idv'\s*,\s*plan\.normalized/;
  const offenders = engines().filter((e) => BAD.test(e.code)).map((e) => e.rel);
  assert.deepEqual(
    offenders,
    [],
    'El LIKE de idv compara contra la columna COMPACTADA: el término también tiene que ir compacto ' +
      '(`plan.compact`). Con el normalizado, el canal substring quedaría mudo.',
  );
});
