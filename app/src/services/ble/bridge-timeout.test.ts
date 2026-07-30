// Tests de `bridge-timeout.ts` — la pieza que impide que un await del puente nativo tome rehén al
// adapter (🔴-1 del review de `dad711f`, confirmado en device: 2 min 40 s sin un solo evento).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  withTimeout,
  withTimeoutOr,
  isBridgeTimeout,
  BridgeTimeoutError,
  DEFAULT_BRIDGE_TIMINGS,
} from './bridge-timeout.ts';

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('una promesa que resuelve a tiempo pasa por el mismo valor', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 1000, 'x'), 7);
});

test('una promesa que RECHAZA a tiempo propaga SU error, no un timeout', async () => {
  const boom = new Error('SecurityException');
  await assert.rejects(() => withTimeout(Promise.reject(boom), 1000, 'x'), (e) => {
    assert.equal(e, boom);
    assert.equal(isBridgeTimeout(e), false);
    return true;
  });
});

test('una promesa que NO RESUELVE NUNCA vence con BridgeTimeoutError (label + ms)', async () => {
  await assert.rejects(() => withTimeout(neverResolves<number>(), 5, 'connect_to_device'), (e) => {
    assert.ok(e instanceof BridgeTimeoutError);
    assert.equal(isBridgeTimeout(e), true);
    assert.equal((e as BridgeTimeoutError).label, 'connect_to_device');
    assert.equal((e as BridgeTimeoutError).ms, 5);
    return true;
  });
});

test('al vencer se llama onTimeout — es donde se cierra el socket que el nativo abra TARDE', async () => {
  // Caso real: `connectToDevice` vence y DESPUÉS resuelve con un socket abierto. Sin esta limpieza
  // el nativo lo retiene en `mConnections` y la sonda de liveness diría "vivo" sobre algo que nadie
  // lee (y el bastón quedaría ocupado para el próximo intento).
  let cleaned = 0;
  await assert.rejects(() => withTimeout(neverResolves<number>(), 5, 'x', () => { cleaned += 1; }));
  assert.equal(cleaned, 1);
});

test('un onTimeout que TIRA no cambia el error: la limpieza nunca propaga', async () => {
  await assert.rejects(
    () =>
      withTimeout(neverResolves<number>(), 5, 'x', () => {
        throw new Error('la limpieza explotó');
      }),
    (e) => isBridgeTimeout(e),
  );
});

test('un rechazo TARDÍO de la promesa vencida no queda como unhandledRejection', async () => {
  // Sin el handler vacío que `withTimeout` le adosa, este rechazo tardío tumbaría el proceso.
  let unhandled: unknown = null;
  const onUnhandled = (e: unknown) => {
    unhandled = e;
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    let rejectLate: (e: unknown) => void = () => undefined;
    const late = new Promise<number>((_, reject) => {
      rejectLate = reject;
    });
    await assert.rejects(() => withTimeout(late, 5, 'x'));
    rejectLate(new Error('el nativo contestó tarde, y mal'));
    await wait(20);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(unhandled, null);
});

test('ms no positivo o no finito = SIN timeout (puerta explícita para los tests)', async () => {
  assert.equal(await withTimeout(Promise.resolve(1), 0, 'x'), 1);
  assert.equal(await withTimeout(Promise.resolve(1), -1, 'x'), 1);
  assert.equal(await withTimeout(Promise.resolve(1), Number.NaN, 'x'), 1);
});

test('withTimeoutOr cae al fallback y avisa el motivo (nunca se traga el error en silencio)', async () => {
  const seen: unknown[] = [];
  const value = await withTimeoutOr(neverResolves<string>(), 5, 'ensure_permissions', 'unavailable', (e) =>
    seen.push(e),
  );
  assert.equal(value, 'unavailable');
  assert.equal(seen.length, 1);
  assert.equal(isBridgeTimeout(seen[0]), true);
});

test('withTimeoutOr NO usa el fallback si la promesa resuelve', async () => {
  assert.equal(await withTimeoutOr(Promise.resolve('granted'), 1000, 'x', 'unavailable'), 'granted');
});

test('ningún tiempo por defecto es 0 (0 = sin timeout / sin poll, o sea el bug de vuelta)', () => {
  for (const [key, ms] of Object.entries(DEFAULT_BRIDGE_TIMINGS)) {
    assert.ok(ms > 0, `${key} tiene que ser positivo`);
  }
});

test('los presupuestos están ordenados por lo que esperan (una persona tarda más que el puente)', () => {
  assert.ok(DEFAULT_BRIDGE_TIMINGS.prompt > DEFAULT_BRIDGE_TIMINGS.call);
  assert.ok(DEFAULT_BRIDGE_TIMINGS.connect > DEFAULT_BRIDGE_TIMINGS.call);
});

test('el poll de liveness acota el "Bastón conectado" mentiroso a menos de 30 s', () => {
  // El techo NO es un gusto: es cuánto puede durar la pantalla prometiendo un bastón muerto en la
  // manga (banco §4.1 — el operario bastonea 40 animales y no se registra ninguno). Si alguien lo
  // sube, tiene que ser una decisión, no un descuido.
  assert.ok(
    DEFAULT_BRIDGE_TIMINGS.livenessPoll <= 30_000,
    'el poll es la ÚNICA garantía independiente de eventos; no puede ser lento',
  );
  // Y tiene que caber varias veces en la ventana de mudez: el poll corre siempre, el log de mudez es
  // el evento raro.
  assert.ok(DEFAULT_BRIDGE_TIMINGS.silence > DEFAULT_BRIDGE_TIMINGS.livenessPoll);
});
