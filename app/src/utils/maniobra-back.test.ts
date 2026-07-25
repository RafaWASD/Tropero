// Tests de la DECISIÓN PURA del back de hardware (Android) en el flujo de MODO MANIOBRAS (spec 03).
// node:test (sin RN/Jest). `BackHandler` no emite en react-native-web → el comportamiento REAL es veredicto
// de device Android (ADR-029); lo que se blinda acá es la PRECEDENCIA (qué gana sobre qué) y, sobre todo,
// que el back NUNCA caiga en la salida de la pantalla mientras hay una guarda abierta arriba.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cargaBackAction,
  identifyBackAction,
  jornadaBackAction,
  shouldRegisterHardwareBack,
  type CargaBackState,
  type IdentifyBackState,
  type JornadaBackState,
} from './maniobra-back';

const jornada = (over: Partial<JornadaBackState> = {}): JornadaBackState => ({
  preconfigSheetOpen: false,
  otherShellSheetOpen: false,
  tactoConfigOpen: false,
  ...over,
});

const identify = (over: Partial<IdentifyBackState> = {}): IdentifyBackState => ({
  sugerenciaOpen: false,
  exitOpen: false,
  otherRodeoOpen: false,
  ambiguousOpen: false,
  ...over,
});

const carga = (over: Partial<CargaBackState> = {}): CargaBackState => ({
  skipSheetOpen: false,
  loteSheetOpen: false,
  ...over,
});

// ─── Gate de plataforma: solo Android tiene botón atrás de hardware ────────────────────────────

test('shouldRegisterHardwareBack: SOLO android registra el listener', () => {
  assert.equal(shouldRegisterHardwareBack('android'), true);
  // En web `BackHandler` nunca emite (y su stub llega a loguear un console.error que en DEV monta el
  // LogBox y tapa la pantalla); en iOS no hay botón atrás.
  assert.equal(shouldRegisterHardwareBack('web'), false);
  assert.equal(shouldRegisterHardwareBack('ios'), false);
  assert.equal(shouldRegisterHardwareBack('windows'), false);
});

// ─── Wizard de jornada (R1.2): el back retrocede de etapa, no destruye la config ───────────────

test('jornadaBackAction: sin nada abierto → el MISMO camino que el chevron ‹ (retroceder de etapa)', () => {
  assert.equal(jornadaBackAction(jornada()), 'screen-back');
});

test('jornadaBackAction: con el sheet de PRECONFIG montado DIFIERE (la pantalla no puede cerrarlo)', () => {
  // Cerrarlo desde la pantalla saltearía el flush del texto tipeado del preconfig (UX 4) → nunca. El
  // caller avisa en dev, así el desliz de precedencia no queda mudo.
  assert.equal(jornadaBackAction(jornada({ preconfigSheetOpen: true })), 'defer-to-preconfig-sheet');
});

test('jornadaBackAction: los OTROS sheets del shell se cierran como ÚLTIMO RECURSO (no botón muerto)', () => {
  // SavePresetSheet / CustomFieldSheet: su cierre es un reset de estado, no hay nada que perder. Si la
  // precedencia falla, el back degrada en un cierre correcto en vez de quedar inerte.
  assert.equal(jornadaBackAction(jornada({ otherShellSheetOpen: true })), 'close-shell-sheet');
});

test('jornadaBackAction: el preconfig GANA sobre todo lo demás', () => {
  assert.equal(
    jornadaBackAction(
      jornada({ preconfigSheetOpen: true, otherShellSheetOpen: true, tactoConfigOpen: true }),
    ),
    'defer-to-preconfig-sheet',
  );
});

test('jornadaBackAction: los sheets del shell GANAN sobre el TactoConfigSheet y sobre la salida', () => {
  assert.equal(
    jornadaBackAction(jornada({ otherShellSheetOpen: true, tactoConfigOpen: true })),
    'close-shell-sheet',
  );
});

test('jornadaBackAction: TactoConfigSheet (sin shell) → lo cierra la pantalla, NO retrocede de etapa', () => {
  // Sin esto el back correría `onBack()` POR DEBAJO del modal (retrocedería de etapa con el sheet abierto).
  assert.equal(jornadaBackAction(jornada({ tactoConfigOpen: true })), 'close-tacto-config');
});

// ─── Identificación (R10.7): el back nunca saltea el ExitJornadaSheet ──────────────────────────

test('identifyBackAction: sin nada abierto → abre el ExitJornadaSheet (lo mismo que el chevron ‹)', () => {
  // Es EL punto del delta: antes el back popeaba la ruta y salteaba el cierre guardado de la jornada.
  assert.equal(identifyBackAction(identify()), 'open-exit');
});

test('identifyBackAction: con el ExitJornadaSheet abierto → lo cierra (seguir en la jornada)', () => {
  assert.equal(identifyBackAction(identify({ exitOpen: true })), 'close-exit');
});

test('identifyBackAction: la sugerencia de vacías gana sobre todo (se abre POR ENCIMA del exit)', () => {
  assert.equal(
    identifyBackAction(identify({ sugerenciaOpen: true, exitOpen: true, ambiguousOpen: true })),
    'close-sugerencia',
  );
});

test('identifyBackAction: CandidatePicker (R4.2) / OtherRodeoSheet (R4.4) → volver a escuchar', () => {
  assert.equal(identifyBackAction(identify({ ambiguousOpen: true })), 'back-to-listening');
  assert.equal(identifyBackAction(identify({ otherRodeoOpen: true })), 'back-to-listening');
});

test('identifyBackAction: el exit sheet gana sobre los sheets de identidad (está por encima)', () => {
  assert.equal(
    identifyBackAction(identify({ exitOpen: true, otherRodeoOpen: true, ambiguousOpen: true })),
    'close-exit',
  );
});

// ─── Carga rápida (R5.15): el back pasa por la confirmación que descarta lo ya persistido ──────

test('cargaBackAction: sin nada abierto → abre el SkipAnimalSheet (salida guardada del frame)', () => {
  // Un pop pelado dejaría las filas de evento ya persistidas (R5.8, per-step) huérfanas y sin aviso.
  assert.equal(cargaBackAction(carga()), 'open-skip-sheet');
});

test('cargaBackAction: con el SkipAnimalSheet abierto → lo cierra (no lo re-abre ni queda inerte)', () => {
  assert.equal(cargaBackAction(carga({ skipSheetOpen: true })), 'close-skip-sheet');
});

test('cargaBackAction: con el LotePickerSheet abierto → lo cierra (el lote es opcional, R9.1/R9.3)', () => {
  assert.equal(cargaBackAction(carga({ loteSheetOpen: true })), 'close-lote-sheet');
});

test('cargaBackAction: el skip sheet gana sobre el picker de lote', () => {
  assert.equal(
    cargaBackAction(carga({ skipSheetOpen: true, loteSheetOpen: true })),
    'close-skip-sheet',
  );
});

// ─── Invariante transversal: con CUALQUIER guarda abierta, el back NUNCA cae en la salida ──────

test('invariante: ninguna pantalla corre su salida mientras hay una guarda abierta arriba', () => {
  assert.notEqual(jornadaBackAction(jornada({ preconfigSheetOpen: true })), 'screen-back');
  assert.notEqual(jornadaBackAction(jornada({ otherShellSheetOpen: true })), 'screen-back');
  assert.notEqual(jornadaBackAction(jornada({ tactoConfigOpen: true })), 'screen-back');
  for (const k of ['sugerenciaOpen', 'exitOpen', 'otherRodeoOpen', 'ambiguousOpen'] as const) {
    assert.notEqual(identifyBackAction(identify({ [k]: true })), 'open-exit');
  }
  for (const k of ['skipSheetOpen', 'loteSheetOpen'] as const) {
    assert.notEqual(cargaBackAction(carga({ [k]: true })), 'open-skip-sheet');
  }
});

test('invariante: SOLO el preconfig difiere; los demás sheets siempre tienen una acción de cierre', () => {
  // Un `defer` es la única rama que puede dejar el back inerte si la precedencia falla → tiene que estar
  // acotada al ÚNICO sheet cuyo cierre la pantalla no puede ejecutar sin perder datos.
  assert.equal(jornadaBackAction(jornada({ otherShellSheetOpen: true })), 'close-shell-sheet');
  assert.equal(jornadaBackAction(jornada({ tactoConfigOpen: true })), 'close-tacto-config');
  for (const s of [
    jornada(),
    jornada({ otherShellSheetOpen: true }),
    jornada({ tactoConfigOpen: true }),
  ]) {
    assert.notEqual(jornadaBackAction(s), 'defer-to-preconfig-sheet');
  }
});
