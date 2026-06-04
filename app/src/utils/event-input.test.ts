// Tests de la lógica pura de inputs de carga de evento (spec 02 C3.1). Pura, sin RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONDITION_SCORES,
  isValidConditionScore,
  formatConditionScore,
  validateWeight,
  WEIGHT_KG_LIMIT,
  validateEventDate,
  sanitizeObservationInput,
  validateObservation,
  OBSERVATION_MAX_LENGTH,
  PREGNANCY_OPTIONS,
  SERVICE_TYPE_OPTIONS,
  SEX_OPTIONS,
  validateCalves,
  shouldWarnUnconfirmedBirth,
  reproductiveWarning,
  UNCONFIRMED_BIRTH_WARNING,
  UNCONFIRMED_ABORTION_WARNING,
  SERVICE_ON_PREGNANT_WARNING,
  REPRODUCTIVE_WARNING_CONFIRM_LABEL,
  type CalfDraft,
} from './event-input.ts';

// ─── Condición corporal: 17 valores cerrados (1.00 → 5.00 paso 0.25) ──────────────────────

test('CONDITION_SCORES: exactamente 17 valores de 1.00 a 5.00 paso 0.25', () => {
  assert.equal(CONDITION_SCORES.length, 17);
  assert.equal(CONDITION_SCORES[0], 1);
  assert.equal(CONDITION_SCORES[CONDITION_SCORES.length - 1], 5);
  // Sin error de punto flotante acumulado: cada valor es múltiplo exacto de 0.25.
  for (const s of CONDITION_SCORES) {
    assert.ok(Math.abs(s * 4 - Math.round(s * 4)) < 1e-9, `${s} no es múltiplo de 0.25`);
  }
  // Cubre los esperados del CHECK del server (0028).
  assert.deepEqual(
    [...CONDITION_SCORES],
    [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5],
  );
});

test('isValidConditionScore: acepta los válidos, rechaza intermedios/fuera de rango', () => {
  assert.equal(isValidConditionScore(3.25), true);
  assert.equal(isValidConditionScore(1), true);
  assert.equal(isValidConditionScore(5), true);
  assert.equal(isValidConditionScore(3.1), false); // no es paso 0.25
  assert.equal(isValidConditionScore(0.75), false); // < 1
  assert.equal(isValidConditionScore(5.25), false); // > 5
});

test('formatConditionScore: entero sin decimales, fracción con coma es-AR', () => {
  assert.equal(formatConditionScore(3), '3');
  assert.equal(formatConditionScore(3.25), '3,25');
  assert.equal(formatConditionScore(3.5), '3,5');
  assert.equal(formatConditionScore(4.75), '4,75');
});

// ─── Peso: validación de submit (> 0, parte entera ≤ 4 cifras / < 10000) ──────────────────

test('validateWeight: número válido', () => {
  const r = validateWeight('320,5'); // coma es-AR
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 320.5);
  const r2 = validateWeight('180');
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.value, 180);
  // El bovino más pesado registrado (1.740 kg) pasa.
  const r3 = validateWeight('1740');
  assert.equal(r3.ok, true);
  if (r3.ok) assert.equal(r3.value, 1740);
});

test('validateWeight: vacío → error (requerido)', () => {
  const r = validateWeight('');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /kilos/);
});

test('validateWeight: <= 0 → error', () => {
  assert.equal(validateWeight('0').ok, false);
});

test('FIXB validateWeight: 4 cifras (9999) OK; 5 cifras (10000) → error de dominio', () => {
  // 9999 (límite máximo de 4 cifras) pasa.
  const ok = validateWeight('9999');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value, 9999);
  // 9999,99 (4 cifras enteras + decimales) sigue OK.
  assert.equal(validateWeight('9999,99').ok, true);
  // 10000 (5 cifras) → rechazado con el copy de dominio.
  const bad = validateWeight('10000');
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /4 cifras/);
  // El límite es EXCLUSIVO: WEIGHT_KG_LIMIT (10000) mismo es rechazado.
  assert.equal(validateWeight(String(WEIGHT_KG_LIMIT)).ok, false);
});

test('validateWeight: basura → error (defensa; el sanitizer ya filtra en vivo)', () => {
  assert.equal(validateWeight('abc').ok, false);
});

// ─── Fecha del evento: formato + no-futura ────────────────────────────────────────────────

const TODAY = new Date(Date.UTC(2025, 2, 15)); // 15 mar 2025

test('validateEventDate: fecha válida pasada', () => {
  const r = validateEventDate('2025-01-10', TODAY);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, '2025-01-10');
});

test('validateEventDate: HOY es válida (no es futura)', () => {
  assert.equal(validateEventDate('2025-03-15', TODAY).ok, true);
});

test('validateEventDate: vacío → error (requerida)', () => {
  assert.equal(validateEventDate('', TODAY).ok, false);
});

test('validateEventDate: parcial / formato inválido → error', () => {
  assert.equal(validateEventDate('2025-03', TODAY).ok, false);
  assert.equal(validateEventDate('2025-13-01', TODAY).ok, false); // mes 13
  assert.equal(validateEventDate('2025-02-30', TODAY).ok, false); // 30 feb no existe
});

test('validateEventDate: futura → error', () => {
  const r = validateEventDate('2025-03-16', TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /futura/);
});

// ─── Observación: tope de largo + validación ──────────────────────────────────────────────

test('sanitizeObservationInput: acota al tope, no filtra caracteres', () => {
  assert.equal(sanitizeObservationInput('Renguea de la pata'), 'Renguea de la pata');
  const long = 'a'.repeat(OBSERVATION_MAX_LENGTH + 50);
  assert.equal(sanitizeObservationInput(long).length, OBSERVATION_MAX_LENGTH);
});

test('validateObservation: texto válido', () => {
  const r = validateObservation('  Renguea de la pata derecha  ');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 'Renguea de la pata derecha'); // trimmeado
});

test('validateObservation: vacío o solo espacios → error', () => {
  assert.equal(validateObservation('').ok, false);
  assert.equal(validateObservation('    ').ok, false);
});

test('validateObservation: dentro del tope', () => {
  const r = validateObservation('x'.repeat(OBSERVATION_MAX_LENGTH));
  assert.equal(r.ok, true);
});

// ─── Reproductivo: listas cerradas de opciones (R6.2) ──────────────────────────────────────

test('PREGNANCY_OPTIONS: 4 opciones con los values del enum pregnancy_status', () => {
  assert.equal(PREGNANCY_OPTIONS.length, 4);
  assert.deepEqual(
    PREGNANCY_OPTIONS.map((o) => o.value),
    ['empty', 'small', 'medium', 'large'],
  );
  // Labels presentes y no vacíos (es-AR).
  for (const o of PREGNANCY_OPTIONS) assert.ok(o.label.length > 0, `label vacío para ${o.value}`);
  // El value 'empty' es "Vacía" (consistente con humanizePregnancyStatus).
  assert.equal(PREGNANCY_OPTIONS[0].label, 'Vacía');
  // B1 (dominio Facundo §4): SOLO el término de campo (Cabeza/Cuerpo/Cola), sin "preñez chica/media/
  // grande". Mapeo al enum DB: small=cola, medium=cuerpo, large=cabeza — antídoto contra re-inversión.
  const byValue = Object.fromEntries(PREGNANCY_OPTIONS.map((o) => [o.value, o.label]));
  assert.equal(byValue.small, 'Cola');
  assert.equal(byValue.medium, 'Cuerpo');
  assert.equal(byValue.large, 'Cabeza');
  // Ninguna etiqueta debe contener la palabra de tamaño (chica/media/grande): solo término de campo.
  for (const o of PREGNANCY_OPTIONS) {
    assert.doesNotMatch(o.label, /chica|media|grande/i, `${o.value} no debe llevar tamaño`);
  }
});

test('SERVICE_TYPE_OPTIONS: 3 opciones con los values del enum service_type', () => {
  assert.equal(SERVICE_TYPE_OPTIONS.length, 3);
  assert.deepEqual(
    SERVICE_TYPE_OPTIONS.map((o) => o.value),
    ['natural', 'ai', 'te'],
  );
  for (const o of SERVICE_TYPE_OPTIONS) assert.ok(o.label.length > 0, `label vacío para ${o.value}`);
  assert.equal(SERVICE_TYPE_OPTIONS[0].label, 'Monta natural');
});

// ─── Parto: SEX_OPTIONS + validateCalves (R9 / R9.5 mellizos) ───────────────────────────────

test('SEX_OPTIONS: 2 opciones con los values del enum sex (male/female)', () => {
  assert.equal(SEX_OPTIONS.length, 2);
  assert.deepEqual(
    SEX_OPTIONS.map((o) => o.value),
    ['male', 'female'],
  );
  assert.equal(SEX_OPTIONS[0].label, 'Macho');
  assert.equal(SEX_OPTIONS[1].label, 'Hembra');
});

test('validateCalves: lista vacía → error (≥1 requerido)', () => {
  const r = validateCalves([]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /al menos un ternero/);
});

test('validateCalves: un ternero con sexo, sin peso ni tag → OK (peso/tag opcionales)', () => {
  const calves: CalfDraft[] = [{ sex: 'female', weightRaw: '', tagRaw: '' }];
  const r = validateCalves(calves);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 1);
    assert.equal(r.value[0].sex, 'female');
    assert.equal(r.value[0].weightKg, null);
    assert.equal(r.value[0].tag, null);
  }
});

test('validateCalves: mellizos (2 terneros) con sexos distintos → OK', () => {
  const calves: CalfDraft[] = [
    { sex: 'male', weightRaw: '35', tagRaw: '' },
    { sex: 'female', weightRaw: '', tagRaw: '982000123456789' },
  ];
  const r = validateCalves(calves);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.length, 2);
    assert.equal(r.value[0].sex, 'male');
    assert.equal(r.value[0].weightKg, 35);
    assert.equal(r.value[0].tag, null);
    assert.equal(r.value[1].sex, 'female');
    assert.equal(r.value[1].weightKg, null);
    assert.equal(r.value[1].tag, '982000123456789');
  }
});

test('validateCalves: falta el sexo de ALGÚN ternero → error claro', () => {
  const calves: CalfDraft[] = [
    { sex: 'male', weightRaw: '', tagRaw: '' },
    { sex: null, weightRaw: '', tagRaw: '' }, // el 2do no eligió sexo
  ];
  const r = validateCalves(calves);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /sexo de cada ternero/);
});

test('validateCalves: peso INVÁLIDO (si hay texto) → error; peso vacío → OK', () => {
  // 0 no es válido (> 0).
  const bad = validateCalves([{ sex: 'female', weightRaw: '0', tagRaw: '' }]);
  assert.equal(bad.ok, false);
  // 5 cifras (10000) → error de dominio (≤ 4 cifras).
  const bad2 = validateCalves([{ sex: 'female', weightRaw: '10000', tagRaw: '' }]);
  assert.equal(bad2.ok, false);
  // peso con coma es-AR válido.
  const ok = validateCalves([{ sex: 'female', weightRaw: '34,5', tagRaw: '' }]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value[0].weightKg, 34.5);
});

test('validateCalves: tag con espacios alrededor se limpia; vacío → null', () => {
  const r = validateCalves([{ sex: 'male', weightRaw: '', tagRaw: '  982000123456789  ' }]);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value[0].tag, '982000123456789');
  const r2 = validateCalves([{ sex: 'male', weightRaw: '', tagRaw: '   ' }]);
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.value[0].tag, null);
});

// ─── Aviso suave: PARTO sobre hembra que NO figura preñada (shouldWarnUnconfirmedBirth) ──────

test('shouldWarnUnconfirmedBirth: PARTO + NO preñada → avisa (true)', () => {
  assert.equal(shouldWarnUnconfirmedBirth('birth', false), true);
});

test('shouldWarnUnconfirmedBirth: PARTO + SÍ preñada → NO avisa (guarda directo)', () => {
  assert.equal(shouldWarnUnconfirmedBirth('birth', true), false);
});

test('shouldWarnUnconfirmedBirth: PARTO + estado indeterminado (null/undefined) → avisa (conservador)', () => {
  // No se pudo determinar la preñez → ante la duda, que el operario confirme.
  assert.equal(shouldWarnUnconfirmedBirth('birth', null), true);
  assert.equal(shouldWarnUnconfirmedBirth('birth', undefined), true);
});

test('shouldWarnUnconfirmedBirth: tacto/servicio/peso NUNCA avisan (solo el parto)', () => {
  // El aviso es EXCLUSIVO del parto, sin importar el estado de preñez.
  for (const t of ['tacto', 'service', 'weight', 'condition_score', 'observation']) {
    assert.equal(shouldWarnUnconfirmedBirth(t, false), false, `${t} no debería avisar`);
    assert.equal(shouldWarnUnconfirmedBirth(t, true), false, `${t} no debería avisar`);
    assert.equal(shouldWarnUnconfirmedBirth(t, null), false, `${t} no debería avisar`);
  }
});

// ─── reproductiveWarning: las 3 ramas que avisan + null (helper generalizado de avisos suaves) ──────

test('reproductiveWarning: BIRTH + NO preñada → aviso "no figura preñada" (parto)', () => {
  const w = reproductiveWarning('birth', false);
  assert.notEqual(w, null);
  assert.equal(w?.message, UNCONFIRMED_BIRTH_WARNING);
  assert.match(w!.message, /no figura preñada/i);
  assert.match(w!.message, /registrar el parto igual/i);
  assert.equal(w?.confirmLabel, REPRODUCTIVE_WARNING_CONFIRM_LABEL);
});

test('reproductiveWarning: BIRTH + estado indeterminado (null/undefined) → avisa (conservador)', () => {
  assert.notEqual(reproductiveWarning('birth', null), null);
  assert.notEqual(reproductiveWarning('birth', undefined), null);
});

test('reproductiveWarning: BIRTH + SÍ preñada → null (guarda directo)', () => {
  assert.equal(reproductiveWarning('birth', true), null);
});

test('reproductiveWarning: ABORTION + NO preñada → aviso "no figura preñada" (aborto)', () => {
  const w = reproductiveWarning('abortion', false);
  assert.notEqual(w, null);
  assert.equal(w?.message, UNCONFIRMED_ABORTION_WARNING);
  assert.match(w!.message, /no figura preñada/i);
  assert.match(w!.message, /registrar el aborto igual/i);
  assert.equal(w?.confirmLabel, REPRODUCTIVE_WARNING_CONFIRM_LABEL);
});

test('reproductiveWarning: ABORTION + estado indeterminado → avisa; + SÍ preñada → null', () => {
  assert.notEqual(reproductiveWarning('abortion', null), null);
  assert.notEqual(reproductiveWarning('abortion', undefined), null);
  assert.equal(reproductiveWarning('abortion', true), null); // figura preñada → coherente, sin aviso
});

test('reproductiveWarning: SERVICE + SÍ preñada → aviso "figura preñada" (servicio)', () => {
  const w = reproductiveWarning('service', true);
  assert.notEqual(w, null);
  assert.equal(w?.message, SERVICE_ON_PREGNANT_WARNING);
  assert.match(w!.message, /figura preñada/i);
  assert.match(w!.message, /registrar el servicio igual/i);
  assert.equal(w?.confirmLabel, REPRODUCTIVE_WARNING_CONFIRM_LABEL);
});

test('reproductiveWarning: SERVICE + NO preñada / indeterminado → null (sin aviso, directo)', () => {
  // Servicio sobre una hembra que NO figura preñada es lo normal → sin aviso. Indeterminado tampoco es
  // "figura preñada" → sin aviso (a diferencia de birth/abortion, el conservadurismo NO aplica acá:
  // un estado desconocido no significa que esté preñada).
  assert.equal(reproductiveWarning('service', false), null);
  assert.equal(reproductiveWarning('service', null), null);
  assert.equal(reproductiveWarning('service', undefined), null);
});

test('reproductiveWarning: tacto / pesaje / condición / observación → SIEMPRE null (no avisan)', () => {
  for (const t of ['tacto', 'weight', 'condition_score', 'observation']) {
    assert.equal(reproductiveWarning(t, false), null, `${t} no debería avisar`);
    assert.equal(reproductiveWarning(t, true), null, `${t} no debería avisar`);
    assert.equal(reproductiveWarning(t, null), null, `${t} no debería avisar`);
  }
});
