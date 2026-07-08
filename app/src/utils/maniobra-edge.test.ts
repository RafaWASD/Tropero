// Tests PUROS de los edge cases diferidos del identify (spec 03 M2.1-edge). node:test, sin RN/red/SDK.
// Cubren R4.4 (otro rodeo del mismo establecimiento), R4.7 (heurística de rodeo de jornada mal elegido,
// tracker de racha) y R4.2 (info distintiva del candidato del picker).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MISCONFIGURED_RODEO_THRESHOLD,
  isOtherRodeo,
  canChangeSessionRodeo,
  emptyStreak,
  pushSeenRodeo,
  dismissStreak,
  shouldWarnMisconfiguredRodeo,
  candidateDominantId,
  candidateDistinguisher,
  type AnimalRodeo,
  type SessionRodeo,
  type DisambiguationCandidate,
} from './maniobra-edge.ts';

// ─── R4.4 — otro rodeo del mismo establecimiento ───────────────────────────────────────────────

const session: SessionRodeo = { rodeoId: 'rod-A', systemId: 'sys-cria' };

test('R4.4 — mismo rodeo que la sesión → NO es otro rodeo (camino feliz)', () => {
  const animal: AnimalRodeo = { rodeoId: 'rod-A', rodeoName: 'Cría hembras', systemId: 'sys-cria' };
  assert.equal(isOtherRodeo(animal, session), false);
  assert.equal(canChangeSessionRodeo(animal, session), false);
});

test('R4.4 — otro rodeo MISMO sistema → es otro rodeo Y se puede cambiar la jornada', () => {
  const animal: AnimalRodeo = { rodeoId: 'rod-B', rodeoName: 'Vaquillonas', systemId: 'sys-cria' };
  assert.equal(isOtherRodeo(animal, session), true);
  assert.equal(canChangeSessionRodeo(animal, session), true);
});

test('R4.4 — otro rodeo de OTRO sistema → es otro rodeo pero NO se puede cambiar (solo saltar)', () => {
  const animal: AnimalRodeo = { rodeoId: 'rod-C', rodeoName: 'Invernada', systemId: 'sys-invernada' };
  assert.equal(isOtherRodeo(animal, session), true);
  // El cambio de jornada rompería el gating (otro sistema) → no se ofrece (solo saltar).
  assert.equal(canChangeSessionRodeo(animal, session), false);
});

// ─── R4.7 — tracker de racha de otro rodeo ─────────────────────────────────────────────────────

test('R4.7 — el umbral default es 3', () => {
  assert.equal(MISCONFIGURED_RODEO_THRESHOLD, 3);
});

test('R4.7 — 3 consecutivos del MISMO otro rodeo → dispara el aviso', () => {
  let s = emptyStreak();
  assert.equal(shouldWarnMisconfiguredRodeo(s), false);
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 1
  assert.equal(shouldWarnMisconfiguredRodeo(s), false);
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 2
  assert.equal(shouldWarnMisconfiguredRodeo(s), false);
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 3 → dispara
  assert.equal(s.streakCount, 3);
  assert.equal(s.streakRodeoName, 'Vaquillonas');
  assert.equal(shouldWarnMisconfiguredRodeo(s), true);
});

test('R4.7 — un animal del rodeo CORRECTO de la sesión ROMPE la racha (no es mal-elegido)', () => {
  let s = emptyStreak();
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 1 (otro rodeo)
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 2 (otro rodeo)
  s = pushSeenRodeo(s, 'rod-A', 'Cría hembras', 'rod-A'); // CORRECTO → reset
  assert.equal(s.streakCount, 0);
  assert.equal(s.streakRodeoId, null);
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 1 de nuevo
  assert.equal(s.streakCount, 1);
  assert.equal(shouldWarnMisconfiguredRodeo(s), false);
});

test('R4.7 — cambiar de otro-rodeo a un tercer rodeo REINICIA la racha (no acumula distintos)', () => {
  let s = emptyStreak();
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 1 de rod-B
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 2 de rod-B
  s = pushSeenRodeo(s, 'rod-C', 'Toros', 'rod-A'); // cambia a rod-C → racha nueva count=1
  assert.equal(s.streakRodeoId, 'rod-C');
  assert.equal(s.streakCount, 1);
  assert.equal(shouldWarnMisconfiguredRodeo(s), false);
});

test('R4.7 — descartar el aviso lo silencia para ESTA racha aunque siga sumando', () => {
  let s = emptyStreak();
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A');
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A');
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 3 → dispararía
  assert.equal(shouldWarnMisconfiguredRodeo(s), true);
  s = dismissStreak(s);
  assert.equal(shouldWarnMisconfiguredRodeo(s), false);
  // Sigue sumando del mismo rodeo → NO re-abre (dismissed se preserva al sumar el mismo rodeo).
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A'); // 4
  assert.equal(s.streakCount, 4);
  assert.equal(shouldWarnMisconfiguredRodeo(s), false);
});

test('R4.7 — una racha NUEVA (otro rodeo) reabre la posibilidad del aviso tras un dismiss', () => {
  let s = emptyStreak();
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A');
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A');
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A');
  s = dismissStreak(s); // descartó el de rod-B
  // Ahora aparecen 3 de rod-C (racha distinta) → el aviso vuelve a ser ofrecible.
  s = pushSeenRodeo(s, 'rod-C', 'Toros', 'rod-A'); // racha nueva, dismissed reseteado
  assert.equal(s.dismissed, false);
  s = pushSeenRodeo(s, 'rod-C', 'Toros', 'rod-A');
  s = pushSeenRodeo(s, 'rod-C', 'Toros', 'rod-A');
  assert.equal(shouldWarnMisconfiguredRodeo(s), true);
});

test('R4.7 — umbral configurable: con threshold=2 dispara antes', () => {
  let s = emptyStreak();
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A');
  s = pushSeenRodeo(s, 'rod-B', 'Vaquillonas', 'rod-A');
  assert.equal(shouldWarnMisconfiguredRodeo(s, 2), true);
  assert.equal(shouldWarnMisconfiguredRodeo(s, 3), false);
});

// ─── R4.2 — info distintiva del candidato ──────────────────────────────────────────────────────

test('R4.2 — el dominante es la caravana visual (visual > idv)', () => {
  const c: DisambiguationCandidate = {
    profileId: 'p1',
    apodo: '0385',
    idv: '4721',
    tagElectronic: '982000111122223',
    rodeoName: 'Cría hembras',
    categoryName: 'Vaquillona',
  };
  assert.equal(candidateDominantId(c), '0385');
});

test('R4.2 — sin visual, el dominante cae al idv', () => {
  const c: DisambiguationCandidate = {
    profileId: 'p2',
    apodo: null,
    idv: '4721',
    tagElectronic: null,
    rodeoName: 'Cría hembras',
    categoryName: 'Vaquillona',
  };
  assert.equal(candidateDominantId(c), '4721');
});

test('R4.2 — sin visual ni idv, el dominante es null (la UI mostrará el tag)', () => {
  const c: DisambiguationCandidate = {
    profileId: 'p3',
    apodo: null,
    idv: null,
    tagElectronic: '982000111122223',
    rodeoName: 'Cría hembras',
    categoryName: 'Vaquillona',
  };
  assert.equal(candidateDominantId(c), null);
});

test('R4.2 — el distinguidor es "rodeo · categoría" y omite las partes vacías (sin idv suelto)', () => {
  const full: DisambiguationCandidate = {
    profileId: 'p1', apodo: '0385', idv: null, tagElectronic: null,
    rodeoName: 'Cría hembras', categoryName: 'Vaquillona',
  };
  assert.equal(candidateDistinguisher(full), 'Cría hembras · Vaquillona');

  const noCat: DisambiguationCandidate = { ...full, categoryName: '' };
  assert.equal(candidateDistinguisher(noCat), 'Cría hembras');

  const empty: DisambiguationCandidate = { ...full, rodeoName: '', categoryName: '' };
  assert.equal(candidateDistinguisher(empty), '');
});

test('R4.2 — cuando el VISUAL está duplicado (mismo dominante), el idv interno DESEMPATA en el distinguidor', () => {
  // El caso real de R4.2: dos animales con el MISMO visual + mismo rodeo + misma categoría. El idv
  // interno (único por establecimiento) es lo que los distingue → debe aparecer en el distinguidor.
  const a: DisambiguationCandidate = {
    profileId: 'a', apodo: '0385', idv: '5001', tagElectronic: null,
    rodeoName: 'Cría hembras', categoryName: 'Vaquillona',
  };
  const b: DisambiguationCandidate = { ...a, profileId: 'b', idv: '5002' };
  // Mismo dominante (la caravana visual duplicada)…
  assert.equal(candidateDominantId(a), '0385');
  assert.equal(candidateDominantId(b), '0385');
  // …pero el distinguidor incluye el idv → se diferencian.
  assert.equal(candidateDistinguisher(a), 'N° 5001 · Cría hembras · Vaquillona');
  assert.equal(candidateDistinguisher(b), 'N° 5002 · Cría hembras · Vaquillona');
  assert.notEqual(candidateDistinguisher(a), candidateDistinguisher(b));
});

test('R4.2 — si el visual NO existe, el idv YA es el dominante → no se repite en el distinguidor', () => {
  const c: DisambiguationCandidate = {
    profileId: 'c', apodo: null, idv: '5001', tagElectronic: null,
    rodeoName: 'Cría hembras', categoryName: 'Vaquillona',
  };
  assert.equal(candidateDominantId(c), '5001');
  assert.equal(candidateDistinguisher(c), 'Cría hembras · Vaquillona'); // sin "N° 5001" duplicado
});
