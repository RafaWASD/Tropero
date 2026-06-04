// Tests de nav.ts — back robusto (backOr) con canGoBack + fallback.
// node:test + type-stripping nativo (sin Jest; mismo patrón que el resto de utils).
//
// La propiedad load-bearing (el BUG que arregla): cuando el stack NO permite volver
// (canGoBack()===false: web-refresh / hot-reload / deep-link / cold-start en ruta profunda),
// backOr NO llama back() (que fallaría silenciosamente y dejaría al usuario trabado) sino
// replace(fallback) hacia una ruta segura. Cuando SÍ se puede volver, back() (caso normal / E2E).
//
// Mock MÍNIMO del router (la unión `ImperativeRouter` tiene muchos métodos que backOr no toca):
// stubbeamos solo canGoBack/back/replace y casteamos a ImperativeRouter para el typecheck.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Href, ImperativeRouter } from 'expo-router';
import { backOr } from './nav.ts';

type Call = { method: 'back' } | { method: 'replace'; href: Href };

/** Router-doble determinístico: registra qué se llamó, según un canGoBack fijo. */
function makeRouter(canGoBack: boolean): { router: ImperativeRouter; calls: Call[] } {
  const calls: Call[] = [];
  const router = {
    canGoBack: () => canGoBack,
    back: () => {
      calls.push({ method: 'back' });
    },
    replace: (href: Href) => {
      calls.push({ method: 'replace', href });
    },
  } as unknown as ImperativeRouter;
  return { router, calls };
}

const FALLBACK: Href = '/(tabs)/animales';

test('backOr: canGoBack()===true → llama back() y NO replace()', () => {
  const { router, calls } = makeRouter(true);
  backOr(router, FALLBACK);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { method: 'back' });
  // Garantía dura: el fallback NO se usó (no replaceamos cuando hay a dónde volver).
  assert.ok(!calls.some((c) => c.method === 'replace'), 'no debe llamar replace cuando canGoBack');
});

test('backOr: canGoBack()===false → llama replace(fallback) y NO back()', () => {
  const { router, calls } = makeRouter(false);
  backOr(router, FALLBACK);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { method: 'replace', href: FALLBACK });
  // Garantía dura: NO intentamos back() con el stack vacío (eso era el bug — fallaba sin volver).
  assert.ok(!calls.some((c) => c.method === 'back'), 'no debe llamar back cuando NO canGoBack');
});

test('backOr: pasa el fallback EXACTO recibido a replace (objeto Href con params)', () => {
  const { router, calls } = makeRouter(false);
  const href: Href = { pathname: '/animal/[id]', params: { id: 'abc-123' } };
  backOr(router, href);
  assert.deepEqual(calls[0], { method: 'replace', href });
});
