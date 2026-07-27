// Tests de `stripSourceComments` (+ su variante `stripSourceCommentsAndStrings`). El caso que le da
// sentido a la función es el del medio: el falso bloque abierto por un `/*` que vive DENTRO de un
// comentario de línea, que en el árbol de `fc4d164` se tragaba las líneas 91–229 de
// `FindOrCreateOverlay.tsx` (139 líneas, **84 de ellas código**) para los guards estáticos.

import test from 'node:test';
import assert from 'node:assert/strict';

import { stripSourceComments, stripSourceCommentsAndStrings } from './strip-comments';

/** Helper: la línea `n` (1-based) del resultado. */
const line = (src: string, n: number) => stripSourceComments(src).split('\n')[n - 1];

test('conserva el largo y la cantidad de líneas (los guards reportan `archivo:línea`)', () => {
  const src = 'const a = 1; // uno\n/* dos\n   tres */\nconst b = 2;\n';
  const out = stripSourceComments(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split('\n').length, src.split('\n').length);
});

test('blanquea comentario de línea y de bloque, y deja el código intacto', () => {
  const src = ['const a = 1; // TextInput', '/* <TextInput /> */', 'const b = 2;'].join('\n');
  const out = stripSourceComments(src);
  assert.match(out, /const a = 1;/);
  assert.match(out, /const b = 2;/);
  assert.doesNotMatch(out, /TextInput/, 'ninguna mención documental sobrevive');
});

test('un `//` dentro de una string NO abre comentario (URLs)', () => {
  const src = "const url = 'https://ejemplo.com/x'; const tag = <TextInput />;";
  const out = stripSourceComments(src);
  assert.match(out, /<TextInput \/>/, 'el código después de la URL sigue visible');
  assert.match(out, /https:\/\/ejemplo\.com/, 'la string no se toca');
});

test('un `/*` dentro de una string tampoco abre bloque', () => {
  const src = ['const glob = "src/*";', 'const tag = <TextInput />;'].join('\n');
  assert.match(stripSourceComments(src), /<TextInput \/>/);
});

test('comillas escapadas no cierran la string antes de tiempo', () => {
  const src = ["const s = 'no \\' cierra // acá';", 'const tag = <TextInput />;'].join('\n');
  assert.match(stripSourceComments(src), /<TextInput \/>/);
});

test('template literal multilínea con `//` adentro no se traga el código de abajo', () => {
  const src = ['const q = `', '  select 1 -- ojo // barra', '`;', 'const tag = <TextInput />;'].join('\n');
  assert.match(stripSourceComments(src), /<TextInput \/>/);
});

test('un bloque con una URL adentro se cierra donde corresponde', () => {
  // Este es el modo de falla del ORDEN INVERSO (blanquear `//` primero): el `*/` desaparecería con el
  // comentario de línea falso y el bloque se comería el resto del archivo.
  const src = ['/**', ' * ver https://ejemplo.com', ' */', 'const tag = <TextInput />;'].join('\n');
  assert.match(stripSourceComments(src), /<TextInput \/>/);
});

test('🔴 EL BUG: un `/*` dentro de un comentario de LÍNEA no abre un bloque falso', () => {
  // Réplica reducida de `app/_components/FindOrCreateOverlay.tsx:91` («La vía que NO toca `ble/*`.»):
  // con el blanqueo a dos regexes, ese `/*` se apareaba con el `*/` del bloque de MÁS ABAJO (línea 229) y
  // borraba todo lo del medio — incluida la declaración del componente y su JSX. 139 líneas de span, 84
  // de ellas código.
  const src = [
    "// la vía que NO toca `ble/*`.", // 1  ← el falso "abre bloque"
    'export function Pantalla() {', // 2  ← esto desaparecía
    '  return <TextInput />;', // 3  ← y esto
    '}', // 4
    '/** docblock cualquiera */', // 5  ← acá cerraba el falso bloque
  ].join('\n');

  const out = stripSourceComments(src);
  assert.match(out, /export function Pantalla/, 'la declaración tiene que seguir visible');
  assert.match(out, /<TextInput \/>/, 'el input tiene que seguir visible');
  assert.equal(line(src, 1).trim(), '', 'el comentario de línea sí se blanquea entero');
  assert.equal(line(src, 5).trim(), '', 'el docblock también');

  // Y la demostración del contrafáctico: el blanqueo VIEJO (dos regexes) sí borraba el componente.
  const viejo = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  assert.doesNotMatch(viejo, /export function Pantalla/, 'contrafáctico: así se perdía el archivo');
});

// ── `stripSourceCommentsAndStrings` — la variante que usa la auto-verificación de cobertura ─────────
// (cuenta llaves del CÓDIGO; una llave escrita dentro de un literal no es estructura)

test('la variante con strings blanquea el contenido de los literales y conserva las posiciones', () => {
  const src = 'const msg = "hola { mundo }"; const o = { a: 1 };';
  const out = stripSourceCommentsAndStrings(src);
  assert.equal(out.length, src.length, 'mismo largo (los guards reportan `archivo:línea`)');
  assert.doesNotMatch(out, /hola/, 'el contenido de la string se blanquea');
  assert.match(out, /const o = \{ a: 1 \};/, 'el código queda intacto');
  // Lo que importa para el balance: las llaves de la string NO cuentan y las del código SÍ.
  assert.equal((out.match(/\{/g) ?? []).length, 1);
  assert.equal((out.match(/\}/g) ?? []).length, 1);
});

test('la variante con strings atraviesa templates y escapes sin desbalancear', () => {
  const src = ['const q = `sin cerrar { y ${x} };`;', 'const o = { b: 2 };'].join('\n');
  const out = stripSourceCommentsAndStrings(src);
  assert.equal((out.match(/\{/g) ?? []).length, 1, 'solo la llave del objeto');
  assert.equal((out.match(/\}/g) ?? []).length, 1);
  assert.match(out, /const o = \{ b: 2 \};/);
});

test('la variante con strings sigue blanqueando comentarios (es un superconjunto)', () => {
  const out = stripSourceCommentsAndStrings('const a = 1; // { comentario }\n/* { bloque } */');
  assert.doesNotMatch(out, /comentario|bloque/);
  assert.match(out, /const a = 1;/);
  assert.equal((out.match(/[{}]/g) ?? []).length, 0);
});
