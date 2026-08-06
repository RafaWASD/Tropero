// Tests del caché en memoria de la preferencia de sonido (🟡-11). node:test, PURO.
//
// Por qué existe este archivo y no un guard de forma: el fix de 🟡-11 es "sacar `readBeepEnabled()` del
// camino caliente", y eso se puede fingir de mil maneras que un regex no distingue. Lo que importa es la
// SEMÁNTICA del caché —qué devuelve antes de saber, qué devuelve después de escribir, y cuándo se
// invalida—, y eso solo se verifica ejecutándolo. Por eso el caché es un módulo puro y no dos líneas
// adentro de `feedback-pref.ts` (que importa expo-secure-store y RN, o sea que node:test no lo puede
// cargar).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cachedBeepEnabled,
  beepPrefIsKnown,
  beepWriteCount,
  rememberBeepEnabled,
  settleReadBeepEnabled,
  forgetBeepEnabledForTest,
} from './beep-pref-cache.ts';
import { BEEP_DEFAULT_ENABLED } from './feedback-logic.ts';

test('sin valor conocido devuelve el DEFAULT (el primer bastonazo del que estrena no puede ser mudo)', () => {
  forgetBeepEnabledForTest();
  assert.equal(beepPrefIsKnown(), false);
  assert.equal(cachedBeepEnabled(), BEEP_DEFAULT_ENABLED);
  assert.equal(cachedBeepEnabled(), true, 'el default del proyecto es ON (R4.2)');
});

test('recordar un valor lo devuelve tal cual, incluido el `false`', () => {
  forgetBeepEnabledForTest();
  rememberBeepEnabled(false);
  assert.equal(beepPrefIsKnown(), true);
  assert.equal(cachedBeepEnabled(), false, 'un `?? default` mal escrito sobre `false` lo pisaría con ON');
  rememberBeepEnabled(true);
  assert.equal(cachedBeepEnabled(), true);
});

test('INVALIDACIÓN: el valor nuevo manda desde la llamada siguiente (no espera a que persista)', () => {
  // El caso real: el peón apaga el sonido en /baston y bastonea el animal siguiente. Si el caché se
  // actualizara recién cuando SecureStore contesta, el teléfono le sonaría igual en esa ventana — y con
  // el storage caído, para siempre.
  forgetBeepEnabledForTest();
  rememberBeepEnabled(true);
  assert.equal(cachedBeepEnabled(), true);
  rememberBeepEnabled(false);
  assert.equal(cachedBeepEnabled(), false);
});

test('el caché es SÍNCRONO: leerlo no devuelve una promesa (ese ERA el 🟡-11)', () => {
  forgetBeepEnabledForTest();
  const value = cachedBeepEnabled();
  assert.equal(typeof value, 'boolean');
  assert.ok(!(value as unknown as { then?: unknown })?.then, 'devolvió algo thenable en vez de un booleano');
});

test('leerlo N veces no cambia nada (el camino caliente lo llama una vez por bastonazo)', () => {
  forgetBeepEnabledForTest();
  rememberBeepEnabled(false);
  for (let i = 0; i < 100; i += 1) assert.equal(cachedBeepEnabled(), false);
  assert.equal(beepPrefIsKnown(), true);
});

// ─── La CARRERA lectura-en-vuelo vs. toque del operario (autorrevisión, 2026-08-06) ─────────────────

test('CARRERA: si el operario toca el switch mientras la lectura está en vuelo, GANA ÉL', () => {
  // El caso real, con dos disparadores de lectura (el warm-up del provider y la pantalla /baston):
  //   t0  la pantalla monta y arranca `readBeepEnabled()`  → el storage todavía tiene '1' (ON)
  //   t1  el peón apaga el sonido                          → caché = false
  //   t2  la lectura vuelve con `true`
  // Sin árbitro, t2 pisa el caché Y el switch: el peón ve el switch volver solo a ON y el próximo
  // bastonazo le suena. Un ajuste que se des-toca solo es peor que no tener el ajuste.
  forgetBeepEnabledForTest();
  const writesAtStart = beepWriteCount(); // t0
  rememberBeepEnabled(false); // t1 — el operario apaga
  const vigente = settleReadBeepEnabled(true, writesAtStart); // t2 — la lectura vieja vuelve
  assert.equal(vigente, false, 'la lectura vieja le ganó al toque del operario');
  assert.equal(cachedBeepEnabled(), false, 'la lectura vieja pisó el caché');
});

test('SIN carrera: la lectura del storage SÍ asienta el valor (si no, el caché nunca se llenaría)', () => {
  // El contrafactual. Sin este lado, "descartar siempre la lectura" pasaría el test de arriba y la
  // preferencia persistida no se aplicaría nunca.
  forgetBeepEnabledForTest();
  const writesAtStart = beepWriteCount();
  const vigente = settleReadBeepEnabled(false, writesAtStart);
  assert.equal(vigente, false);
  assert.equal(cachedBeepEnabled(), false);
  assert.equal(beepPrefIsKnown(), true);
});

test('la lectura que asienta NO cuenta como escritura del operario (no puede ganarle a la siguiente)', () => {
  // Si `settleReadBeepEnabled` incrementara el contador, una lectura que llega justo antes de otra
  // lectura en vuelo la invalidaría sin motivo, y el warm-up del provider y el de la pantalla se
  // anularían mutuamente según quién conteste primero.
  forgetBeepEnabledForTest();
  const before = beepWriteCount();
  settleReadBeepEnabled(false, before);
  assert.equal(beepWriteCount(), before, 'una lectura del storage se contó como toque del operario');
});

test('el contador de escrituras solo CRECE y se mueve una vez por toque', () => {
  forgetBeepEnabledForTest();
  assert.equal(beepWriteCount(), 0);
  rememberBeepEnabled(true);
  rememberBeepEnabled(false);
  rememberBeepEnabled(false); // apagar dos veces sigue siendo dos toques
  assert.equal(beepWriteCount(), 3);
});
