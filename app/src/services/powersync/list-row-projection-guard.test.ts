// Guard de PARIDAD de proyección entre las queries que producen `LocalListRow`.
//
// EL BUG QUE LO ORIGINA (2026-08-09, cazado por `treatments.spec.ts`): `in_treatment` se inyectaba SOLO en
// `buildAnimalsListQuery`. Las tres búsquedas (`buildSearchByTagQuery` / `buildSearchByIdvQuery` /
// `buildSearchLikeQuery`, que delegan en `buildSearchUnion`) devolvían la columna ausente → `toBool(undefined
// ?? 0)` → false → **el chip "En tratamiento" desaparecía al buscar**. O sea: tipear la caravana, que es
// exactamente lo que hace el peón para encontrar al animal, borraba el aviso de que estaba bajo tratamiento,
// con período de retiro de por medio.
//
// POR QUÉ ESTE GUARD Y NO UN TEST POR BUILDER: el modo de falla no es "un builder lo hace mal", es "un
// builder NUEVO no lo hace". Un test por builder existente no habría cazado nada — los que existían estaban
// bien cada uno por su lado; lo que faltaba era la comparación ENTRE ellos. Por eso acá se enumera la lista
// de builders y se exige la columna a TODOS: el cuarto nace en rojo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAnimalsListQuery,
  buildSearchByTagQuery,
  buildSearchByIdvQuery,
  buildSearchLikeQuery,
} from './local-reads';

const EST = '11111111-1111-4111-8111-111111111111';

/**
 * TODA query que alimente una fila de la lista de animales. Agregar una nueva acá es OBLIGATORIO — es el
 * punto donde se decide si una superficie nueva hereda las marcas o nace muda.
 */
const BUILDERS: Array<{ nombre: string; sql: () => string }> = [
  { nombre: 'buildAnimalsListQuery', sql: () => buildAnimalsListQuery(EST, {}).sql },
  { nombre: 'buildSearchByTagQuery', sql: () => buildSearchByTagQuery(EST, '982000364696050').sql },
  { nombre: 'buildSearchByIdvQuery', sql: () => buildSearchByIdvQuery(EST, '0410').sql },
  { nombre: 'buildSearchLikeQuery', sql: () => buildSearchLikeQuery(EST, 'idv', '041').sql },
];

/**
 * Columnas computadas que la FILA de la lista consume y que NO salen del SELECT base: si una query las
 * omite, la UI no rompe — pinta de menos, en silencio. Ese silencio es el problema.
 */
const COLUMNAS_REQUERIDAS = ['in_treatment'];

for (const col of COLUMNAS_REQUERIDAS) {
  test(`toda query de lista proyecta \`${col}\` (la búsqueda también)`, () => {
    const sinLaColumna = BUILDERS.filter((b) => !b.sql().includes(col)).map((b) => b.nombre);
    assert.deepEqual(
      sinLaColumna,
      [],
      `Estos builders producen filas de la lista SIN proyectar \`${col}\`, así que la marca correspondiente ` +
        `desaparece en esa superficie: ${sinLaColumna.join(', ')}. Inyectala con injectProjection(...) usando ` +
        'la MISMA constante compartida (IN_TREATMENT_SYNCED / IN_TREATMENT_OVERLAY), no una copia.',
    );
  });
}

test('las dos ramas del UNION la proyectan (synced Y overlay), no solo una', () => {
  // Una sola rama alcanza para que el `includes` de arriba pase y la mitad de las filas siga muda.
  for (const b of BUILDERS) {
    const sql = b.sql();
    const ocurrencias = sql.split('in_treatment').length - 1;
    assert.ok(
      ocurrencias >= 2,
      `${b.nombre}: \`in_treatment\` aparece ${ocurrencias} vez/veces. Cada UNION tiene rama synced y rama ` +
        'overlay, y las dos tienen que proyectarla o las filas de una de ellas pierden la marca.',
    );
  }
});

test('la expresión synced es la MISMA en la lista y en la búsqueda (anti-drift)', () => {
  // Si alguien copia el EXISTS en vez de compartir la constante, las dos superficies pueden divergir en
  // silencio (ej. una filtra deleted_at y la otra no) y ningún test de una sola superficie lo vería.
  const exists = (sql: string): string | null => {
    const m = sql.match(/EXISTS \(SELECT 1 FROM treatments t[^)]*\)/);
    return m ? m[0] : null;
  };
  const lista = exists(buildAnimalsListQuery(EST, {}).sql);
  const busqueda = exists(buildSearchByTagQuery(EST, '982000364696050').sql);
  assert.ok(lista, 'la lista tiene que traer el EXISTS de treatments');
  assert.equal(busqueda, lista, 'la búsqueda usa una expresión DISTINTA de la lista: comparten la constante');
});
