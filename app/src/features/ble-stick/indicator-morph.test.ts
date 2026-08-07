// Tests de CUÁNDO el indicador del bastón se estira a pill (`indicator-morph.ts`). node:test, puro, con
// reloj de mentira.
//
// El caso que manda es el (2): **el backoff de reconexión no puede hacer parpadear la pill**. El adapter
// cicla `connecting` ↔ `scanning` durante minutos; si cada uno de esos cambios abriera la pill, el
// indicador quedaría abriéndose y cerrándose solo en un rincón — que es, con otra cara, exactamente el
// "estorba" que esta unidad vino a arreglar.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MORPH_MIN_GAP_MS,
  announceKeyFor,
  planMorph,
  type StickAnnounceKey,
} from './indicator-morph.ts';

const T0 = 1_000_000;

test('(1) la clase de aviso es exhaustiva y agrupa el ciclo del backoff', () => {
  assert.equal(announceKeyFor('connected'), 'connected');
  assert.equal(announceKeyFor('disconnected'), 'lost');
  assert.equal(announceKeyFor('permission_denied'), 'blocked');
  assert.equal(announceKeyFor('off'), 'idle');
  // EL AGRUPAMIENTO QUE IMPIDE EL PARPADEO: los dos estados del reintento son la MISMA noticia.
  assert.equal(announceKeyFor('connecting'), 'working');
  assert.equal(announceKeyFor('scanning'), 'working');
  assert.equal(announceKeyFor('connecting'), announceKeyFor('scanning'));
});

test('(2) EL BACKOFF NO PARPADEA: 20 vueltas de connecting↔scanning anuncian UNA vez', () => {
  // Simula la cadena real: primer intento, y después el ciclo de reintentos del adapter.
  const cycle: Array<'connecting' | 'scanning'> = [];
  for (let i = 0; i < 20; i++) cycle.push(i % 2 === 0 ? 'connecting' : 'scanning');

  const lastAnnouncedAt: Partial<Record<StickAnnounceKey, number>> = {};
  let prevKey: StickAnnounceKey | null = null;
  let announcements = 0;
  cycle.forEach((status, i) => {
    const nextKey = announceKeyFor(status);
    const now = T0 + i * 3_000; // ~3 s por vuelta del backoff
    const plan = planMorph({ prevKey, nextKey, now, lastAnnouncedAt });
    if (plan.expand) {
      announcements++;
      lastAnnouncedAt[nextKey] = now;
    }
    prevKey = nextKey;
  });
  assert.equal(announcements, 1, 'el ciclo entero del backoff es UNA sola noticia');
});

test('(3) la primera aparición SÍ anuncia (el indicador nace informando)', () => {
  const plan = planMorph({ prevKey: null, nextKey: 'working', now: T0, lastAnnouncedAt: {} });
  assert.deepEqual(plan, { expand: true, reason: 'primera-vez' });
});

test('(4) la secuencia normal anuncia cada tramo, aunque sea rápida', () => {
  // «Conectando…» y un segundo después «Conectado»: son DOS noticias distintas y las dos importan. El
  // amortiguador anti-parpadeo NO puede comerse esta (es por clase, no por tiempo global).
  const lastAnnouncedAt: Partial<Record<StickAnnounceKey, number>> = {};
  const first = planMorph({ prevKey: null, nextKey: 'working', now: T0, lastAnnouncedAt });
  assert.equal(first.expand, true);
  lastAnnouncedAt.working = T0;
  const second = planMorph({ prevKey: 'working', nextKey: 'connected', now: T0 + 1_000, lastAnnouncedAt });
  assert.deepEqual(second, { expand: true, reason: 'cambio' });
});

test('(5) LINK QUE TITILA: la segunda vuelta ya no anuncia', () => {
  // El escenario `flap` del banco de pruebas: conecta, se cae, conecta… Se ve la primera vuelta; después
  // el indicador se queda en círculo (el ícono y el color siguen diciendo la verdad).
  const lastAnnouncedAt: Partial<Record<StickAnnounceKey, number>> = { connected: T0, lost: T0 + 2_000 };
  const again = planMorph({ prevKey: 'lost', nextKey: 'connected', now: T0 + 3_000, lastAnnouncedAt });
  assert.deepEqual(again, { expand: false, reason: 'anti-parpadeo' });
  // Pero pasado el piso, una noticia vieja vuelve a ser noticia.
  const later = planMorph({
    prevKey: 'lost',
    nextKey: 'connected',
    now: T0 + MORPH_MIN_GAP_MS + 1,
    lastAnnouncedAt,
  });
  assert.equal(later.expand, true);
});

test('(6) el piso es POR CLASE, no un silencio global', () => {
  // Contra-prueba de (5): con `connected` recién anunciado, una noticia DISTINTA sí pasa.
  const lastAnnouncedAt: Partial<Record<StickAnnounceKey, number>> = { connected: T0 };
  const plan = planMorph({ prevKey: 'connected', nextKey: 'blocked', now: T0 + 100, lastAnnouncedAt });
  assert.deepEqual(plan, { expand: true, reason: 'cambio' });
});

test('(7) el mismo estado repetido nunca anuncia (renders de más no abren la pill)', () => {
  // Un re-render por cualquier otra razón (cambio de ruta, de tema, del provider) no puede disparar el
  // aviso: el componente llama a esto en cada render y la decisión tiene que depender solo del estado.
  for (const key of ['connected', 'working', 'lost', 'blocked', 'idle'] as StickAnnounceKey[]) {
    assert.deepEqual(
      planMorph({ prevKey: key, nextKey: key, now: T0 + 999_999, lastAnnouncedAt: {} }),
      { expand: false, reason: 'misma-clase' },
    );
  }
});

test('(8) sin memoria previa de esa clase, el piso no aplica', () => {
  assert.equal(
    planMorph({ prevKey: 'working', nextKey: 'lost', now: T0, lastAnnouncedAt: { working: T0 } }).expand,
    true,
  );
});
