// Tests de la lógica pura del EstablishmentContext (spec 01, Fase 4).
// node:test + type-stripping nativo (Node 24), sin Jest (mismo patrón que B.1.1).
//
// Cubre: landing por cantidad (R6.7), active_lost (R6.10), orden de "Mis campos" (R6.6.1),
// y la derivación de "recientes" para el dropdown (R6.8.1/R6.9).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessDisappearance,
  buildRecents,
  detectActiveLost,
  formatHectares,
  hasDuplicateName,
  isManeuverRouteSegment,
  localityOf,
  parseHectares,
  resolveState,
  roleLabel,
  sameEstablishmentList,
  sameResolvedEstablishmentState,
  shouldEmitDeferredRevocation,
  shouldShowReadyBanner,
  sortMyEstablishments,
  type EstablishmentState,
  type MembershipEstablishment,
} from './establishment.ts';

function est(id: string, name: string, role: MembershipEstablishment['role'] = 'owner'): MembershipEstablishment {
  return { id, name, province: 'Buenos Aires', city: null, role };
}

// ─── resolveState (R6.7 / R6.4) ─────────────────────────────────────────────────

test('R6.7/R6.5: 0 campos → no_establishments', () => {
  const s = resolveState({ available: [], preferredId: null });
  assert.equal(s.status, 'no_establishments');
});

test('R6.4: exactamente 1 campo y sin preferido → active (auto-activo)', () => {
  const a = est('a', 'La Juanita');
  const s = resolveState({ available: [a], preferredId: null });
  assert.equal(s.status, 'active');
  if (s.status === 'active') {
    assert.equal(s.current.id, 'a');
    assert.equal(s.role, 'owner');
  }
});

test('R6.7: ≥2 campos sin preferido → choosing (Mis campos como landing)', () => {
  const s = resolveState({ available: [est('a', 'A'), est('b', 'B')], preferredId: null });
  assert.equal(s.status, 'choosing');
  if (s.status === 'choosing') assert.equal(s.available.length, 2);
});

test('R6.3/R6.9: preferido presente → active sobre ese, aunque haya ≥2 campos', () => {
  const s = resolveState({
    available: [est('a', 'A'), est('b', 'B'), est('c', 'C')],
    preferredId: 'b',
  });
  assert.equal(s.status, 'active');
  if (s.status === 'active') assert.equal(s.current.id, 'b');
});

test('R6.9: preferido inaccesible (no está en available) → se ignora y cae al landing', () => {
  // Preferido apunta a un campo que ya no está → con ≥2 restantes va a choosing.
  const s = resolveState({
    available: [est('a', 'A'), est('b', 'B')],
    preferredId: 'zzz',
  });
  assert.equal(s.status, 'choosing');
});

test('R6.9: preferido inaccesible con 1 campo restante → auto-activo sobre el que queda', () => {
  const s = resolveState({ available: [est('a', 'A')], preferredId: 'zzz' });
  assert.equal(s.status, 'active');
  if (s.status === 'active') assert.equal(s.current.id, 'a');
});

// ─── detectActiveLost (R6.10) ───────────────────────────────────────────────────

test('R6.10: el activo sigue presente → no lost', () => {
  const r = detectActiveLost({ currentId: 'a', available: [est('a', 'A'), est('b', 'B')] });
  assert.equal(r.lost, false);
});

test('R6.10: el activo desapareció del set (rol revocado / campo borrado) → lost', () => {
  const r = detectActiveLost({ currentId: 'a', available: [est('b', 'B')] });
  assert.equal(r.lost, true);
});

test('R6.10: sin activo previo (currentId null) → no lost (no hay nada que perder)', () => {
  const r = detectActiveLost({ currentId: null, available: [] });
  assert.equal(r.lost, false);
});

test('R6.10: el activo era el único y desapareció → lost (queda 0, re-rutea a wizard luego)', () => {
  const r = detectActiveLost({ currentId: 'a', available: [] });
  assert.equal(r.lost, true);
});

// ─── Invariante "crear campo" (fix loop: falso active_lost al crear) ─────────────
//
// Modela la composición exacta del wiring de crear-campo: refreshEstablishments(nuevoId)
// trae un set FRESCO que solo AGREGÓ el campo nuevo (no quitó ninguno) y fija el preferido
// en el nuevo. El invariante: agregar un campo NUNCA dispara active_lost, y deja `active`
// sobre el campo recién creado. El bug NO estaba en estas funciones puras (son correctas)
// sino en el WIRING — la verdadera validación del wiring es la prueba en web de Raf (no hay
// infra de render-testing). Estos tests fijan el invariante de las primitivas que el wiring
// compone, para que si alguien las toca, el contrato del fix no se rompa silenciosamente.

test('crear PRIMER campo: no había activo (currentId null) → no lost + active sobre el nuevo', () => {
  const nuevo = est('new', 'La Juanita');
  // Antes de crear: no_establishments → currentId null. Tras el refresh el set es [nuevo].
  const lost = detectActiveLost({ currentId: null, available: [nuevo] });
  assert.equal(lost.lost, false, 'agregar el primer campo no debe falsear active_lost');
  const resolved = resolveState({ available: [nuevo], preferredId: 'new' });
  assert.equal(resolved.status, 'active');
  if (resolved.status === 'active') assert.equal(resolved.current.id, 'new');
});

test('crear SEGUNDO campo: el activo previo sigue en el set → no lost + active sobre el nuevo', () => {
  const campo1 = est('a', 'Campo Uno');
  const nuevo = est('new', 'Campo Dos');
  // Antes de crear: active sobre 'a' → currentId 'a'. Tras el refresh el set es [a, nuevo].
  const lost = detectActiveLost({ currentId: 'a', available: [campo1, nuevo] });
  assert.equal(lost.lost, false, 'agregar un 2º campo no debe falsear active_lost sobre el 1º');
  const resolved = resolveState({ available: [campo1, nuevo], preferredId: 'new' });
  assert.equal(resolved.status, 'active');
  if (resolved.status === 'active') assert.equal(resolved.current.id, 'new');
});

// ─── sortMyEstablishments (R6.6.1) ──────────────────────────────────────────────

test('R6.6.1: activo/último PRIMERO, resto alfabético', () => {
  const list = [est('c', 'Zorzal'), est('a', 'Bella Vista'), est('b', 'Don Alfredo')];
  const sorted = sortMyEstablishments(list, 'c');
  assert.deepEqual(sorted.map((e) => e.id), ['c', 'a', 'b']); // c primero; resto: Bella<Don
});

test('R6.6.1: sin head (null) → todo alfabético', () => {
  const list = [est('c', 'Zorzal'), est('a', 'Bella Vista'), est('b', 'Don Alfredo')];
  const sorted = sortMyEstablishments(list, null);
  assert.deepEqual(sorted.map((e) => e.name), ['Bella Vista', 'Don Alfredo', 'Zorzal']);
});

test('R6.6.1: orden alfabético acento-insensitive (Á junto a A)', () => {
  const list = [est('1', 'Ángel'), est('2', 'Alba'), est('3', 'Bravo')];
  const sorted = sortMyEstablishments(list, null);
  // "Alba" antes que "Ángel" (l < n con base sensitivity), ambos antes de "Bravo".
  assert.deepEqual(sorted.map((e) => e.name), ['Alba', 'Ángel', 'Bravo']);
});

test('R6.6.1: head inexistente en la lista → solo alfabético (no rompe)', () => {
  const list = [est('a', 'A'), est('b', 'B')];
  const sorted = sortMyEstablishments(list, 'zzz');
  assert.deepEqual(sorted.map((e) => e.id), ['a', 'b']);
});

// ─── buildRecents (R6.8.1 / R6.9) ───────────────────────────────────────────────

test('R6.9: recientes respetan el orden del rastro (más reciente primero)', () => {
  const available = [est('a', 'A'), est('b', 'B'), est('c', 'C')];
  const recents = buildRecents(['c', 'a'], available);
  // c y a del rastro (en ese orden) + b (no estaba en el rastro) al final alfabético.
  assert.deepEqual(recents.map((e) => e.id), ['c', 'a', 'b']);
});

test('R6.9: ids del rastro ya inaccesibles se descartan', () => {
  const available = [est('a', 'A'), est('b', 'B')];
  const recents = buildRecents(['zzz', 'b', 'gone'], available);
  // 'zzz'/'gone' no están en available → fuera. 'b' del rastro primero, 'a' al final.
  assert.deepEqual(recents.map((e) => e.id), ['b', 'a']);
});

test('R6.9: rastro vacío → todos los disponibles, alfabético (primer arranque)', () => {
  const available = [est('b', 'Bravo'), est('a', 'Alfa')];
  const recents = buildRecents([], available);
  assert.deepEqual(recents.map((e) => e.name), ['Alfa', 'Bravo']);
});

test('R6.9: el rastro no duplica si un id aparece dos veces', () => {
  const available = [est('a', 'A'), est('b', 'B')];
  const recents = buildRecents(['a', 'a', 'b'], available);
  assert.deepEqual(recents.map((e) => e.id), ['a', 'b']);
});

// ─── parseHectares / formatHectares (crear/editar campo) ─────────────────────────

test('parseHectares: vacío o basura → null; números válidos → number', () => {
  assert.equal(parseHectares(''), null);
  assert.equal(parseHectares('   '), null);
  assert.equal(parseHectares('abc'), null);
  assert.equal(parseHectares('1200'), 1200);
  assert.equal(parseHectares('1.200'), 1200); // punto de miles
  assert.equal(parseHectares('1200,5'), 1200.5); // coma decimal
  assert.equal(parseHectares('-5'), null); // negativo rechazado
});

test('formatHectares: null/undefined → vacío; entero sin decimales; decimal con coma', () => {
  assert.equal(formatHectares(null), '');
  assert.equal(formatHectares(undefined), '');
  assert.equal(formatHectares(1200), '1200');
  assert.equal(formatHectares(1200.5), '1200,5');
});

test('parseHectares ∘ formatHectares es estable (round-trip de edición)', () => {
  // Lo que mostramos en el input al editar debe re-parsear al mismo número (no se pierde
  // el valor al guardar sin cambios). Garantiza que editar-campo pre-cargado no corrompe ha.
  for (const v of [0, 100, 1200, 1200.5, 999.25]) {
    assert.equal(parseHectares(formatHectares(v)), v);
  }
  // null pre-cargado → input vacío → parsea de vuelta a null.
  assert.equal(parseHectares(formatHectares(null)), null);
});

// ─── roleLabel (Run 2 e) — etiqueta de rol canónica ──────────────────────────────

test('roleLabel: las 3 etiquetas canónicas en español', () => {
  assert.equal(roleLabel('owner'), 'Dueño');
  assert.equal(roleLabel('field_operator'), 'Operario');
  assert.equal(roleLabel('veterinarian'), 'Veterinario');
});

// ─── localityOf (Run 2 e) — localidad de desambiguación ──────────────────────────

test('localityOf: usa city si existe y no está vacía', () => {
  assert.equal(localityOf({ city: 'Chascomús', province: 'Buenos Aires' }), 'Chascomús');
});

test('localityOf: cae a province si city es null/vacía/espacios', () => {
  assert.equal(localityOf({ city: null, province: 'Buenos Aires' }), 'Buenos Aires');
  assert.equal(localityOf({ city: '', province: 'Córdoba' }), 'Córdoba');
  assert.equal(localityOf({ city: '   ', province: 'Santa Fe' }), 'Santa Fe');
});

test('localityOf: trim de city', () => {
  assert.equal(localityOf({ city: '  Tandil  ', province: 'Buenos Aires' }), 'Tandil');
});

test('localityOf: ambas vacías/ausentes → cadena vacía (caller no renderiza "·" colgando)', () => {
  assert.equal(localityOf({ city: null, province: null }), '');
  assert.equal(localityOf({}), '');
  assert.equal(localityOf({ city: '', province: '' }), '');
});

// ─── hasDuplicateName (Run 2 f) — advertir nombres repetidos ─────────────────────

const named = (id: string, name: string) => ({ id, name });

test('hasDuplicateName: match exacto → true', () => {
  assert.equal(hasDuplicateName('La Juanita', [named('a', 'La Juanita')]), true);
});

test('hasDuplicateName: distinto case → true (case-insensitive)', () => {
  assert.equal(hasDuplicateName('la juanita', [named('a', 'LA JUANITA')]), true);
});

test('hasDuplicateName: acentos ignorados → true', () => {
  assert.equal(hasDuplicateName('chascomus', [named('a', 'Chascomús')]), true);
  assert.equal(hasDuplicateName('Ángel', [named('a', 'angel')]), true);
});

test('hasDuplicateName: trim en ambos lados → true', () => {
  assert.equal(hasDuplicateName('  La Juanita  ', [named('a', 'La Juanita')]), true);
});

test('hasDuplicateName: nombre distinto → false', () => {
  assert.equal(hasDuplicateName('El Ombú', [named('a', 'La Juanita')]), false);
});

test('hasDuplicateName: nombre vacío/blanco → false (no advierte antes de tipear)', () => {
  assert.equal(hasDuplicateName('', [named('a', 'La Juanita')]), false);
  assert.equal(hasDuplicateName('   ', [named('a', 'La Juanita')]), false);
});

test('hasDuplicateName: lista vacía → false', () => {
  assert.equal(hasDuplicateName('La Juanita', []), false);
});

test('hasDuplicateName edición: excluye el propio campo por id → false al no cambiar el nombre', () => {
  // Editando el campo 'a' (La Juanita) sin cambiar el nombre: NO debe advertir contra sí mismo.
  assert.equal(
    hasDuplicateName('La Juanita', [named('a', 'La Juanita'), named('b', 'El Ombú')], 'a'),
    false,
  );
});

test('hasDuplicateName edición: OTRO campo homónimo SÍ advierte (su id no se excluye)', () => {
  // Editando 'a' y poniéndole el nombre de 'b' (que ya existe): debe advertir.
  assert.equal(
    hasDuplicateName('El Ombú', [named('a', 'La Juanita'), named('b', 'El Ombú')], 'a'),
    true,
  );
});

// ─── shouldShowReadyBanner (Run 2 c) — banner per-campo + dismiss persistido ─────

test('shouldShowReadyBanner: sin campo activo (null) → false', () => {
  assert.equal(shouldShowReadyBanner(null, []), false);
  assert.equal(shouldShowReadyBanner(null, ['a']), false);
});

test('shouldShowReadyBanner: activo NO descartado → true', () => {
  assert.equal(shouldShowReadyBanner('a', []), true);
  assert.equal(shouldShowReadyBanner('a', ['b', 'c']), true);
});

test('shouldShowReadyBanner: activo descartado → false (no resucita)', () => {
  assert.equal(shouldShowReadyBanner('a', ['a']), false);
  assert.equal(shouldShowReadyBanner('a', ['b', 'a', 'c']), false);
});

test('shouldShowReadyBanner: descartar campo A no afecta a campo B (per-campo)', () => {
  // El bug de Raf: descartar en A no debe ocultar el banner de B.
  assert.equal(shouldShowReadyBanner('b', ['a']), true);
  assert.equal(shouldShowReadyBanner('a', ['a']), false);
});

// ─── spec 20 — E1: veredicto por EVIDENCIA AFIRMATIVA (R20.12-R20.15, R20.30) ───
//
// El latch de un solo disparo existía para "evitar falsos active_lost por downloads parciales".
// Al re-leer en CADA avance de sync, la garantía la da esta función: la revocación se concluye a
// partir de un hecho leído (la fila local de rol propia), NUNCA por inferencia de ausencia.
// Sin timers, sin contadores, sin segunda lectura (design §9.2).

test('R20.15 (TEST CENTRAL DE E1): activo ausente del set PERO rol local active=1 → inconclusive', () => {
  // Un checkpoint que trajo el resto pero todavía no la fila de `establishments`, con el rol local
  // todavía activo, NO concluye active_lost. Determinista, sin esperar nada.
  assert.equal(
    assessDisappearance({ hadValue: true, stillPresent: false, roleEvidence: 'active' }),
    'inconclusive',
  );
});

test('R20.14: rol local ausente/inactivo → confirmed CON SET VACÍO (la evidencia manda)', () => {
  assert.equal(
    assessDisappearance({ hadValue: true, stillPresent: false, roleEvidence: 'absent_or_inactive' }),
    'confirmed',
  );
});

test('R20.14: rol local ausente/inactivo → confirmed CON SET POBLADO (mismo veredicto)', () => {
  // Mismo input de evidencia; lo que cambiaba afuera es que el set traía otros campos. El veredicto
  // NO depende de la forma del set (R20.13 — la ausencia nunca es condición suficiente).
  assert.equal(
    assessDisappearance({ hadValue: true, stillPresent: false, roleEvidence: 'absent_or_inactive' }),
    'confirmed',
  );
});

test('R20.30: evidencia ilegible (unknown) → inconclusive (fail-safe, nunca contra el usuario)', () => {
  assert.equal(
    assessDisappearance({ hadValue: true, stillPresent: false, roleEvidence: 'unknown' }),
    'inconclusive',
  );
});

test('R20.32: el activo sigue en el set → present, cualquiera sea la evidencia (no se consulta)', () => {
  for (const roleEvidence of ['active', 'absent_or_inactive', 'unknown'] as const) {
    assert.equal(assessDisappearance({ hadValue: true, stillPresent: true, roleEvidence }), 'present');
  }
});

test('R20.12/R20.16: sin activo previo (hadValue=false) → present aunque el set esté vacío', () => {
  assert.equal(
    assessDisappearance({ hadValue: false, stillPresent: false, roleEvidence: 'absent_or_inactive' }),
    'present',
  );
});

test('R20.13: NINGÚN confirmed sale de una evidencia distinta de absent_or_inactive', () => {
  // Guard estructural: la única puerta a 'confirmed' es la evidencia afirmativa.
  for (const hadValue of [true, false]) {
    for (const stillPresent of [true, false]) {
      for (const roleEvidence of ['active', 'unknown'] as const) {
        assert.notEqual(assessDisappearance({ hadValue, stillPresent, roleEvidence }), 'confirmed');
      }
    }
  }
});

// ─── spec 20 — R20.18: el veredicto COMPARTIDO que usa RodeoContext para concluir `no_rodeos` ───
//
// RodeoContext (prong F) rutea por el MISMO `assessDisappearance` que EstablishmentContext, en vez de
// un `evidence !== 'active'` inline: para el contexto de rodeos, el establecimiento sigue "presente"
// sii su rol local está afirmativamente activo → `stillPresent = evidence === 'active'`, y se concluye
// `no_rodeos` SOLO con veredicto 'present'. Este test fija esa composición (behavior-idéntico al inline
// previo) y prueba que respeta R20.18 (active → concluye) y R20.30 (unknown → conserva, fail-safe).

const rodeoConcludesNoRodeos = (evidence: 'active' | 'absent_or_inactive' | 'unknown'): boolean =>
  assessDisappearance({ hadValue: true, stillPresent: evidence === 'active', roleEvidence: evidence }) === 'present';

test('R20.18: rol local active=1 + set de rodeos vacío → concluye no_rodeos', () => {
  assert.equal(rodeoConcludesNoRodeos('active'), true);
});

test('R20.18: rol revocado (absent_or_inactive) + set vacío → NO concluye (protege D1, riesgo 7)', () => {
  assert.equal(rodeoConcludesNoRodeos('absent_or_inactive'), false);
});

test('R20.30: evidencia ilegible (unknown) + set vacío → NO concluye no_rodeos (fail-safe)', () => {
  assert.equal(rodeoConcludesNoRodeos('unknown'), false);
});

// ─── spec 20 — R20.35: guard de emisión de la revocación diferida (Gate 1 L2) ───

test('R20.35: pendiente vigente + evidencia absent_or_inactive → emite', () => {
  assert.equal(
    shouldEmitDeferredRevocation({ pendingId: 'a', currentId: 'a', roleEvidence: 'absent_or_inactive' }),
    true,
  );
});

test('R20.34/R20.35: cambió el campo activo durante el diferimiento → NO emite', () => {
  assert.equal(
    shouldEmitDeferredRevocation({ pendingId: 'a', currentId: 'b', roleEvidence: 'absent_or_inactive' }),
    false,
  );
});

test('R20.35: le reactivaron el rol mientras estaba en la maniobra → NO emite', () => {
  assert.equal(
    shouldEmitDeferredRevocation({ pendingId: 'a', currentId: 'a', roleEvidence: 'active' }),
    false,
  );
});

test('R20.35/R20.30: evidencia unknown al emitir → NO emite (no se concluye sin evidencia)', () => {
  assert.equal(
    shouldEmitDeferredRevocation({ pendingId: 'a', currentId: 'a', roleEvidence: 'unknown' }),
    false,
  );
});

test('R20.35: sin pendiente (o sin activo vigente) → NO emite', () => {
  assert.equal(
    shouldEmitDeferredRevocation({ pendingId: null, currentId: 'a', roleEvidence: 'absent_or_inactive' }),
    false,
  );
  assert.equal(
    shouldEmitDeferredRevocation({ pendingId: 'a', currentId: null, roleEvidence: 'absent_or_inactive' }),
    false,
  );
});

// ─── spec 20 — R20.20/R20.24: predicado de "hay maniobra en curso" ──────────────

test('R20.20: ruta de maniobra (sub-ruta) → true', () => {
  assert.equal(isManeuverRouteSegment(['maniobra', 'carga']), true);
  assert.equal(isManeuverRouteSegment(['maniobra', 'jornada']), true);
  assert.equal(isManeuverRouteSegment(['maniobra', 'identificar']), true);
});

test('R20.20: modal `maniobra` pelado → true', () => {
  assert.equal(isManeuverRouteSegment(['maniobra']), true);
});

test('R20.24: fuera del flujo de maniobra → false', () => {
  assert.equal(isManeuverRouteSegment(['(tabs)']), false);
  assert.equal(isManeuverRouteSegment(['(tabs)', 'index']), false);
  assert.equal(isManeuverRouteSegment(['mis-campos']), false);
  // `maniobra` que NO es top-segment no cuenta.
  assert.equal(isManeuverRouteSegment(['(tabs)', 'maniobra']), false);
});

test('R20.24: sin segmentos / null-safe → false', () => {
  assert.equal(isManeuverRouteSegment([]), false);
  assert.equal(isManeuverRouteSegment(null), false);
  assert.equal(isManeuverRouteSegment(undefined), false);
});

// ─── spec 20 — R20.11: guard de equivalencia (anti tormenta de re-render) ───────

test('R20.11: estados equivalentes (objetos distintos, mismos datos) → true', () => {
  const a1: EstablishmentState = {
    status: 'active',
    current: est('a', 'La Juanita'),
    available: [est('a', 'La Juanita'), est('b', 'El Ombu', 'veterinarian')],
    role: 'owner',
  };
  const a2: EstablishmentState = {
    status: 'active',
    current: est('a', 'La Juanita'),
    available: [est('a', 'La Juanita'), est('b', 'El Ombu', 'veterinarian')],
    role: 'owner',
  };
  assert.equal(sameResolvedEstablishmentState(a1, a2), true);
});

test('R20.11: cambia el NOMBRE de un campo del set → false (el rename de un coworker se ve)', () => {
  const base: EstablishmentState = {
    status: 'active',
    current: est('a', 'La Juanita'),
    available: [est('a', 'La Juanita'), est('b', 'El Ombu')],
    role: 'owner',
  };
  const renamed: EstablishmentState = {
    status: 'active',
    current: est('a', 'La Juanita'),
    available: [est('a', 'La Juanita'), est('b', 'El Ombu Viejo')],
    role: 'owner',
  };
  assert.equal(sameResolvedEstablishmentState(base, renamed), false);
});

test('R20.11: cambia el ROL en el campo activo → false', () => {
  const owner: EstablishmentState = {
    status: 'active',
    current: est('a', 'La Juanita'),
    available: [est('a', 'La Juanita')],
    role: 'owner',
  };
  const vet: EstablishmentState = {
    status: 'active',
    current: est('a', 'La Juanita', 'veterinarian'),
    available: [est('a', 'La Juanita', 'veterinarian')],
    role: 'veterinarian',
  };
  assert.equal(sameResolvedEstablishmentState(owner, vet), false);
});

test('R20.11: cambia el ORDEN del set → false (alimenta "Mis campos"/recientes)', () => {
  const ab: EstablishmentState = { status: 'choosing', available: [est('a', 'A'), est('b', 'B')] };
  const ba: EstablishmentState = { status: 'choosing', available: [est('b', 'B'), est('a', 'A')] };
  assert.equal(sameResolvedEstablishmentState(ab, ba), false);
});

test('R20.11: cambia el STATUS → false', () => {
  assert.equal(
    sameResolvedEstablishmentState({ status: 'loading' }, { status: 'no_establishments' }),
    false,
  );
  assert.equal(
    sameResolvedEstablishmentState(
      { status: 'choosing', available: [est('a', 'A'), est('b', 'B')] },
      {
        status: 'active',
        current: est('a', 'A'),
        available: [est('a', 'A'), est('b', 'B')],
        role: 'owner',
      },
    ),
    false,
  );
});

test('R20.11: un campo NUEVO en el set → false (el campo en caliente SÍ re-renderiza)', () => {
  // El guard no puede tragarse el caso que la feature vino a arreglar (criterio A1).
  const one: EstablishmentState = {
    status: 'active',
    current: est('a', 'A'),
    available: [est('a', 'A')],
    role: 'owner',
  };
  const two: EstablishmentState = {
    status: 'active',
    current: est('a', 'A'),
    available: [est('a', 'A'), est('b', 'B')],
    role: 'owner',
  };
  assert.equal(sameResolvedEstablishmentState(one, two), false);
});

test('R20.11: active_lost con distinto campo perdido → false', () => {
  assert.equal(
    sameResolvedEstablishmentState(
      { status: 'active_lost', reason: 'role_revoked', lostEstablishmentName: 'A', available: [] },
      { status: 'active_lost', reason: 'role_revoked', lostEstablishmentName: 'B', available: [] },
    ),
    false,
  );
});

test('R20.11: loading vs loading → true (no re-renderiza de gusto)', () => {
  assert.equal(sameResolvedEstablishmentState({ status: 'loading' }, { status: 'loading' }), true);
  assert.equal(
    sameResolvedEstablishmentState({ status: 'no_establishments' }, { status: 'no_establishments' }),
    true,
  );
});

test('R20.11: sameEstablishmentList — largo distinto y contenido igual', () => {
  assert.equal(sameEstablishmentList([], []), true);
  assert.equal(sameEstablishmentList([est('a', 'A')], []), false);
  assert.equal(sameEstablishmentList([est('a', 'A')], [est('a', 'A')]), true);
  assert.equal(sameEstablishmentList([est('a', 'A')], [est('a', 'A2')]), false);
});
