// Tests de la lógica PURA del ciclo de vida de carga del gating (stale-while-revalidate). node:test
// (mismo runner que el resto de la suite unit, sin Jest/RN). Regresión del bug s27: un sync de fondo
// re-cargaba el gating y flipeaba `loading=true` → la carga rápida caía al spinner y desmontaba el paso en
// curso, perdiendo lo tecleado. El fix: solo la carga INICIAL del rodeo muestra loading; la revalidación en
// background del MISMO rodeo es silenciosa; el cambio de rodeo sí vuelve a loading.

import test from 'node:test';
import assert from 'node:assert/strict';

import { initialLoadingFor, shouldShowLoadingForLoad } from './maneuver-gating-load.ts';

// ─── shouldShowLoadingForLoad ──────────────────────────────────────────────────────────

test('carga INICIAL de un rodeo (sin config previo) → muestra loading', () => {
  assert.equal(shouldShowLoadingForLoad('rodeo-A', null), true);
});

test('revalidación del MISMO rodeo (ya cargado) → NO muestra loading (silenciosa)', () => {
  assert.equal(shouldShowLoadingForLoad('rodeo-A', 'rodeo-A'), false);
});

test('CAMBIO de rodeo (cargado A, ahora B) → muestra loading (config viejo no aplica)', () => {
  assert.equal(shouldShowLoadingForLoad('rodeo-B', 'rodeo-A'), true);
});

test('sin rodeo objetivo (null) → no hay nada que cargar → no muestra loading', () => {
  assert.equal(shouldShowLoadingForLoad(null, null), false);
  assert.equal(shouldShowLoadingForLoad(null, 'rodeo-A'), false);
});

// ─── initialLoadingFor (valor inicial de `loading` al montar el hook) ───────────────────

test('initialLoadingFor: con rodeo → arranca cargando; sin rodeo → no', () => {
  assert.equal(initialLoadingFor('rodeo-A'), true);
  assert.equal(initialLoadingFor(null), false);
});

// ─── Simulación del ciclo de vida del hook (la máquina de estados que usa useManeuverGating) ───
//
// Reproducimos el reducer del hook SIN React: estado { loading, config, loadedRodeo } + un load(rodeoId,
// fetchResult) que aplica EXACTAMENTE las mismas reglas que el useCallback `load` del hook. Así probamos el
// escenario real del bug (sync de fondo durante la carga) de forma determinista y pura.

type GatingState = {
  loading: boolean;
  config: Record<string, unknown> | null;
  loadedRodeo: string | null;
};

function makeState(rodeoId: string | null): GatingState {
  return { loading: initialLoadingFor(rodeoId), config: null, loadedRodeo: null };
}

// Espeja `load()` del hook: rodeoId null cortocircuita; si no, flip de loading SOLO en carga inicial del
// rodeo, fetch, y al éxito fija config + loadedRodeo. `fetch` simula fetchRodeoGating (ok/err).
function load(
  state: GatingState,
  rodeoId: string | null,
  fetch: { ok: true; value: Record<string, unknown> } | { ok: false },
): GatingState {
  if (rodeoId === null) {
    return { loading: false, config: null, loadedRodeo: null };
  }
  const next: GatingState = { ...state };
  if (shouldShowLoadingForLoad(rodeoId, next.loadedRodeo)) next.loading = true;
  if (!fetch.ok) {
    next.loading = false;
    return next;
  }
  next.loadedRodeo = rodeoId;
  next.config = fetch.value;
  next.loading = false;
  return next;
}

test('escenario: carga inicial → loading true→false y config queda cargado', () => {
  let s = makeState('rodeo-A');
  assert.equal(s.loading, true); // monta cargando (aún no hay config)
  s = load(s, 'rodeo-A', { ok: true, value: { tacto: { enabled: true, required: false } } });
  assert.equal(s.loading, false);
  assert.deepEqual(s.config, { tacto: { enabled: true, required: false } });
  assert.equal(s.loadedRodeo, 'rodeo-A');
});

test('REGRESIÓN s27: revalidación background (mismo rodeo, nuevo sync) → loading NO vuelve a true y config se actualiza', () => {
  let s = makeState('rodeo-A');
  s = load(s, 'rodeo-A', { ok: true, value: { tacto: { enabled: true, required: false } } });
  assert.equal(s.loading, false);

  // Llega un sync de fondo → el hook vuelve a load() para el MISMO rodeo. NO debe flipear loading (si lo
  // hiciera, carga.tsx caería al spinner y desmontaría el paso → se perdería lo tecleado).
  const before = s.loading;
  s = load(s, 'rodeo-A', { ok: true, value: { tacto: { enabled: true, required: true } } });
  assert.equal(before, false);
  assert.equal(s.loading, false, 'loading NO debe volver a true en una revalidación del mismo rodeo');
  // El config sí se refresca en silencio (la plantilla pudo cambiar).
  assert.deepEqual(s.config, { tacto: { enabled: true, required: true } });
});

test('múltiples syncs seguidos del mismo rodeo → loading queda en false todo el tiempo (cero parpadeo)', () => {
  let s = makeState('rodeo-A');
  s = load(s, 'rodeo-A', { ok: true, value: { v: 1 } });
  for (let i = 2; i <= 5; i++) {
    s = load(s, 'rodeo-A', { ok: true, value: { v: i } });
    assert.equal(s.loading, false, `sync #${i} no debe flipear loading`);
  }
  assert.deepEqual(s.config, { v: 5 });
});

test('CAMBIO de rodeo → loading SÍ vuelve a true (el config viejo no sirve para el rodeo nuevo)', () => {
  let s = makeState('rodeo-A');
  s = load(s, 'rodeo-A', { ok: true, value: { rodeo: 'A' } });
  assert.equal(s.loading, false);

  // El animal/pantalla pasa a un rodeo distinto. La regla detecta loadedRodeo (A) !== target (B) → loading.
  // Comprobamos la DECISIÓN ANTES de aplicar el fetch (que es lo que hace el hook: setLoading(true) y luego
  // espera el fetch).
  assert.equal(shouldShowLoadingForLoad('rodeo-B', s.loadedRodeo), true);
  s = load(s, 'rodeo-B', { ok: true, value: { rodeo: 'B' } });
  assert.equal(s.loadedRodeo, 'rodeo-B');
  assert.deepEqual(s.config, { rodeo: 'B' });
  assert.equal(s.loading, false); // tras resolver el fetch del rodeo nuevo
});

test('rodeoId pasa a null → reset (no loading, config null, loadedRodeo null) y un rodeo nuevo después vuelve a loading', () => {
  let s = makeState('rodeo-A');
  s = load(s, 'rodeo-A', { ok: true, value: { rodeo: 'A' } });
  // El caller deja de tener rodeo (p. ej. el animal no resolvió todavía).
  s = load(s, null, { ok: false });
  assert.equal(s.loading, false);
  assert.equal(s.config, null);
  assert.equal(s.loadedRodeo, null);
  // Al volver a haber rodeo, es carga INICIAL otra vez → loading.
  assert.equal(shouldShowLoadingForLoad('rodeo-A', s.loadedRodeo), true);
});

test('error transitorio en revalidación del mismo rodeo → loading NO se flipea a true por el load fallido (sigue sin parpadear)', () => {
  let s = makeState('rodeo-A');
  s = load(s, 'rodeo-A', { ok: true, value: { ok: 1 } });
  assert.equal(s.loading, false);
  // Un fetch que falla en background: como es el MISMO rodeo ya cargado, no flipeamos loading a true.
  s = load(s, 'rodeo-A', { ok: false });
  assert.equal(s.loading, false, 'un error en revalidación del mismo rodeo no debe blanquear con loading');
});

test('error en la carga INICIAL → loading termina en false (no cuelga el spinner) y loadedRodeo sigue null', () => {
  let s = makeState('rodeo-A');
  assert.equal(s.loading, true);
  s = load(s, 'rodeo-A', { ok: false });
  assert.equal(s.loading, false);
  assert.equal(s.loadedRodeo, null); // no se cargó → el próximo load sigue siendo "inicial"
  assert.equal(shouldShowLoadingForLoad('rodeo-A', s.loadedRodeo), true);
});
