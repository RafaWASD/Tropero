// Tests del store de RECLAMO del lugar del indicador global del bastón (`stick-status-surface.ts`).
// node:test, sin React y sin navegación: el store es el que decide, y se ejercita entero acá.
//
// Lo que se fija:
//   (a) el indicador global se calla si —y SOLO si— hay alguna superficie reclamando;
//   (b) N reclamos simultáneos conviven y se liberan en CUALQUIER orden (es el caso real: al navegar de
//       una pantalla que reclama a otra que también reclama, las dos están vivas un instante, y en un
//       stack la de abajo sigue montada);
//   (c) liberar dos veces es idempotente y no emite de más (un reclamo liberado no puede "des-liberar"
//       el de otro);
//   (d) el snapshot es ESTABLE por identidad mientras nada cambie — sin eso, `useSyncExternalStore`
//       re-renderiza infinito, que es un bug que solo aparece en runtime y tumba la app entera.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _resetStickStatusSurfacesForTest,
  claimStickStatusSurface,
  getStickStatusSurfaceClaims,
  isStickStatusSurfaceClaimed,
  subscribeStickStatusSurfaces,
} from './stick-status-surface.ts';

test.beforeEach(() => {
  _resetStickStatusSurfacesForTest();
});

test('sin superficies, el indicador global se muestra (nadie reclamó)', () => {
  assert.equal(isStickStatusSurfaceClaimed(), false);
  assert.deepEqual(getStickStatusSurfaceClaims(), []);
});

test('un reclamo calla al indicador global; liberarlo lo devuelve', () => {
  const release = claimStickStatusSurface('header-chip');
  assert.equal(isStickStatusSurfaceClaimed(), true);
  assert.deepEqual(getStickStatusSurfaceClaims(), ['header-chip']);
  release();
  assert.equal(isStickStatusSurfaceClaimed(), false);
  assert.deepEqual(getStickStatusSurfaceClaims(), []);
});

test('DOS superficies a la vez: el indicador vuelve recién cuando se van las DOS', () => {
  // El caso real: en un stack, la pantalla de abajo sigue montada mientras la de arriba se enfoca. Con un
  // booleano en vez de un conteo por token, la primera liberación habría "devuelto" el indicador global
  // arriba de una pantalla que todavía lo está mostrando.
  const releaseChip = claimStickStatusSurface('header-chip');
  const releaseCard = claimStickStatusSurface('screen-card');
  assert.deepEqual(getStickStatusSurfaceClaims(), ['header-chip', 'screen-card']);

  releaseChip();
  assert.equal(isStickStatusSurfaceClaimed(), true, 'todavía queda la card reclamando');
  assert.deepEqual(getStickStatusSurfaceClaims(), ['screen-card']);

  releaseCard();
  assert.equal(isStickStatusSurfaceClaimed(), false);
});

test('la liberación funciona en CUALQUIER orden (no es una pila)', () => {
  const a = claimStickStatusSurface('header-chip');
  const b = claimStickStatusSurface('header-chip');
  const c = claimStickStatusSurface('screen-card');
  b();
  assert.deepEqual(getStickStatusSurfaceClaims(), ['header-chip', 'screen-card']);
  c();
  assert.deepEqual(getStickStatusSurfaceClaims(), ['header-chip']);
  a();
  assert.deepEqual(getStickStatusSurfaceClaims(), []);
});

test('DOS reclamos de la MISMA clase no se pisan (la clave es el token, no la clase)', () => {
  // Pasa de verdad: `BleConnectionChip` se monta en dos pantallas y las dos pueden estar montadas.
  const first = claimStickStatusSurface('header-chip');
  claimStickStatusSurface('header-chip');
  first();
  assert.equal(isStickStatusSurfaceClaimed(), true, 'el segundo chip sigue reclamando');
});

test('liberar DOS veces es idempotente y no toca los reclamos ajenos', () => {
  const release = claimStickStatusSurface('header-chip');
  const other = claimStickStatusSurface('screen-card');
  release();
  release();
  release();
  assert.deepEqual(getStickStatusSurfaceClaims(), ['screen-card']);
  other();
  assert.deepEqual(getStickStatusSurfaceClaims(), []);
});

test('cada cambio NOTIFICA a los suscriptos, y la liberación repetida NO', () => {
  let notifications = 0;
  const unsubscribe = subscribeStickStatusSurfaces(() => {
    notifications++;
  });
  const release = claimStickStatusSurface('header-chip');
  assert.equal(notifications, 1, 'el reclamo notifica');
  release();
  assert.equal(notifications, 2, 'la liberación notifica');
  release();
  assert.equal(notifications, 2, 'liberar de nuevo NO notifica (nada cambió)');
  unsubscribe();
  claimStickStatusSurface('screen-card');
  assert.equal(notifications, 2, 'después de desuscribirse no llegan más avisos');
});

test('el SNAPSHOT es estable por identidad mientras nada cambie', () => {
  // Sin esto, `useSyncExternalStore` ve un valor nuevo en cada render → re-render infinito. Es un bug de
  // runtime que ningún typecheck ve y que tumba la app entera, así que se fija acá.
  const before = getStickStatusSurfaceClaims();
  assert.equal(getStickStatusSurfaceClaims(), before, 'dos lecturas seguidas devuelven el MISMO array');
  const release = claimStickStatusSurface('header-chip');
  const during = getStickStatusSurfaceClaims();
  assert.notEqual(during, before, 'al cambiar, la referencia cambia (si no, nadie se entera)');
  assert.equal(getStickStatusSurfaceClaims(), during);
  release();
});

test('el snapshot es INMUTABLE (un consumidor no puede vaciar el store por accidente)', () => {
  claimStickStatusSurface('header-chip');
  const claims = getStickStatusSurfaceClaims();
  assert.throws(() => (claims as StickStatusSurfaceKindArray).push('screen-card'));
  assert.deepEqual(getStickStatusSurfaceClaims(), ['header-chip']);
});

/** Alias local para poder intentar el `push` prohibido sin apagar el tipo en la aserción de arriba. */
type StickStatusSurfaceKindArray = Array<'header-chip' | 'screen-card'>;

test('el reset de tests deja el store limpio aunque queden reclamos vivos', () => {
  claimStickStatusSurface('header-chip');
  claimStickStatusSurface('screen-card');
  _resetStickStatusSurfacesForTest();
  assert.deepEqual(getStickStatusSurfaceClaims(), []);
});
