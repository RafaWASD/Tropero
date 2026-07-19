// Tests de la lógica pura del teléfono (spec 01, delta TELÉFONO). node:test, sin RN ni red.
//
// La mitad de normalización NO vive acá: vive en `phone-vectors.json`, la tabla COMPARTIDA que también
// recorre `supabase/tests/user_private/run.cjs` contra el CHECK real (RTEL.2.9.1 / RTEL.14.11). Si el
// encoding TypeScript y el del CHECK divergen en cualquier borde, una de las dos suites se pone roja.
// Acá se recorre el JSON (encoding TS) y se cubre lo que el CHECK no puede ver: máscara, backspace,
// detección del 15 y el invariante de que esa detección NO participa de la normalización.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EMPTY_PHONE_INPUT,
  PHONE_AR_TYPING_MAX_DIGITS,
  PHONE_HELP_AR,
  PHONE_HELP_INTL,
  PHONE_HELP_INTL_ZERO,
  PHONE_HELP_REQUIRED,
  PHONE_HELP_STORED_UNREADABLE,
  PHONE_HELP_TRUNK_15,
  PHONE_MAX_STORED_LENGTH,
  arAreaCodeLength,
  detectArTrunkPrefix,
  formatPhoneDisplay,
  isValidPhone,
  maskArPhone,
  normalizePhone,
  phoneDiagnosis,
  phoneInputChange,
  phoneInputFromValue,
  phoneValueFrom,
  phoneValueFromStored,
  renderPhoneInput,
  samePhoneValue,
  type PhoneInputState,
  type PhoneValue,
} from './phone.ts';

type Vectors = {
  canonicalRegex: string;
  normalizable: { input: string; expected: string; rule: string; why: string }[];
  rejected: { input: string; reason: 'empty' | 'unrecognized'; why: string }[];
};

const vectors: Vectors = JSON.parse(
  readFileSync(new URL('./phone-vectors.json', import.meta.url), 'utf8'),
);

// ─── RTEL.2.9.1 / RTEL.14.11 — la tabla compartida, encoding TypeScript ─────────────────────────

test('vectores compartidos: cada entrada normalizable da su canónico exacto', () => {
  assert.ok(vectors.normalizable.length >= 20, 'la tabla de vectores no debería encogerse');
  for (const v of vectors.normalizable) {
    const result = normalizePhone(v.input);
    assert.equal(result.ok, true, `[${v.rule}] "${v.input}" debería normalizar (${v.why})`);
    if (result.ok) {
      assert.equal(result.canonical, v.expected, `[${v.rule}] "${v.input}" → ${v.why}`);
    }
  }
});

test('vectores compartidos: cada canónico esperado satisface el regex del CHECK server', () => {
  // Espeja `user_private_phone_format_chk`. Si alguien afloja normalizePhone, esto se pone rojo ACÁ
  // antes de que un 23514 llegue al server (y con él el DETAIL con PII — R-7).
  const re = new RegExp(vectors.canonicalRegex);
  for (const v of vectors.normalizable) {
    assert.match(v.expected, re, `el canónico de "${v.input}" debe pasar el CHECK`);
    assert.ok(
      v.expected.length <= PHONE_MAX_STORED_LENGTH,
      `el canónico de "${v.input}" no debe exceder ${PHONE_MAX_STORED_LENGTH} chars (RTEL.1.5)`,
    );
  }
});

test('vectores compartidos: cada entrada rechazada NO normaliza, con su razón', () => {
  for (const v of vectors.rejected) {
    const result = normalizePhone(v.input);
    assert.equal(result.ok, false, `"${v.input}" NO debería normalizar (${v.why})`);
    if (!result.ok) assert.equal(result.reason, v.reason, `razón de "${v.input}"`);
  }
});

test('vectores compartidos: ningún rechazado produce por accidente un valor canónico', () => {
  // Si un "rechazado" fuera canónico-válido, el test backend gemelo pasaría por la razón equivocada
  // (el CHECK lo aceptaría y el assert de rechazo fallaría, o peor: se relajaría el vector).
  const re = new RegExp(vectors.canonicalRegex);
  for (const v of vectors.rejected) {
    assert.ok(!re.test(v.input.trim()), `"${v.input}" no debe ser canónico`);
  }
});

// ─── RTEL.14.8 (MEDIUM-1) — el borde que alinea cliente y CHECK ─────────────────────────────────

test('RTEL.14.8: un código de país que empieza con 0 se rechaza EN EL CLIENTE (nunca sale al server)', () => {
  const result = normalizePhone('+0123456789');
  assert.equal(result.ok, false);
  assert.equal(isValidPhone('+0123456789'), false);
  // Y el estado del campo queda `incomplete` → PhoneField nunca entrega un canónico que el CHECK
  // rechazaría con 23514 (que es lo que volvía ALCANZABLE el leak de PII de R-7).
  assert.equal(phoneValueFrom('0123456789', true).kind, 'incomplete');
});

// ─── RTEL.4.3 / DP1 — agrupación por largo de código de área ────────────────────────────────────

test('RTEL.4.3: arAreaCodeLength distingue áreas de 2, 3 y 4 dígitos', () => {
  assert.equal(arAreaCodeLength('1123456789'), 2); // Buenos Aires
  assert.equal(arAreaCodeLength('3414567890'), 3); // Rosario
  assert.equal(arAreaCodeLength('2241430000'), 4); // Chascomús (primer cliente beta)
  assert.equal(arAreaCodeLength('2914567890'), 3); // Bahía Blanca (sí listada)
  assert.equal(arAreaCodeLength('2901123456'), 4); // no listada → 4 (default exhaustivo)
});

test('RTEL.4.3: la máscara agrupa según el área (incluye Chascomús 2241)', () => {
  assert.equal(maskArPhone('1123456789'), '11 2345-6789');
  assert.equal(maskArPhone('3414567890'), '341 456-7890');
  assert.equal(maskArPhone('2241430000'), '2241 43-0000');
});

test('RTEL.4.4: la máscara NUNCA deja un separador colgando al final', () => {
  // Tipeo progresivo de 11 2345-6789: en ningún paso el render termina en espacio ni en guión.
  const digits = '1123456789';
  const renders: string[] = [];
  for (let i = 1; i <= digits.length; i++) renders.push(maskArPhone(digits.slice(0, i)));

  assert.deepEqual(renders, [
    '1',
    '11',
    '11 2',
    '11 23',
    '11 234',
    '11 2345',
    '11 2345-6',
    '11 2345-67',
    '11 2345-678',
    '11 2345-6789',
  ]);
  for (const r of renders) {
    assert.ok(!/[ -]$/.test(r), `"${r}" no debería terminar en separador`);
  }
});

test('RTEL.4.4: el backspace saca un dígito (no queda trabado en el separador)', () => {
  // Simula el ciclo real del input: render → el usuario borra el último char → se re-derivan los
  // dígitos. Como no hay separador colgando, cada backspace baja exactamente un dígito.
  let digits = '1123456789';
  const seen: number[] = [];
  while (digits.length > 0) {
    const rendered = maskArPhone(digits);
    const afterBackspace = rendered.slice(0, -1);
    digits = afterBackspace.replace(/\D/g, '');
    seen.push(digits.length);
  }
  assert.deepEqual(seen, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('RTEL.4.4: el caso patológico — borrar el separador NO puede dejar el dígito intacto', () => {
  // Si el usuario borra justo el guión de "11 2345-6789" (edición en el medio), el texto entrante
  // tiene la MISMA cantidad de dígitos que antes. El componente descarta el último dígito; acá
  // verificamos la señal en la que se apoya: mismos dígitos + texto más corto.
  const rendered = maskArPhone('1123456789');
  const withoutSeparator = rendered.replace('-', '');
  assert.equal(withoutSeparator.replace(/\D/g, '').length, 10);
  assert.ok(withoutSeparator.length < rendered.length);
});

test('RTEL.10.1: formatPhoneDisplay muestra el canónico agrupado, nunca el crudo', () => {
  assert.equal(formatPhoneDisplay('+541123456789'), '+54 11 2345-6789');
  assert.equal(formatPhoneDisplay('+542241430000'), '+54 2241 43-0000');
  // Internacional: se muestra tal cual (no conocemos su agrupación).
  assert.equal(formatPhoneDisplay('+34600123456'), '+34600123456');
  // Sin teléfono → vacío (el caller pone "Sin teléfono", RTEL.10.2).
  assert.equal(formatPhoneDisplay(null), '');
  assert.equal(formatPhoneDisplay(''), '');
  // Legacy no canónico (una fila que quedara sin normalizar): se muestra tal cual, no se inventa nada.
  assert.equal(formatPhoneDisplay('11 2345 6789'), '11 2345 6789');
});

// ─── RTEL.14.12 (DP4) — detección del 15 para áreas de 2, 3 y 4 dígitos ─────────────────────────

test('RTEL.14.12: detecta el 15 y propone los 10 dígitos, para áreas de 2, 3 y 4', () => {
  assert.deepEqual(detectArTrunkPrefix('111523456789'), { suggestion: '1123456789' });
  assert.deepEqual(detectArTrunkPrefix('341154567890'), { suggestion: '3414567890' });
  assert.deepEqual(detectArTrunkPrefix('224115430000'), { suggestion: '2241430000' });
  // La sugerencia siempre es un número VÁLIDO de 10 dígitos (si no, la ayuda sería inútil).
  for (const d of ['111523456789', '341154567890', '224115430000']) {
    const hit = detectArTrunkPrefix(d);
    assert.ok(hit);
    assert.equal(hit.suggestion.length, 10);
    assert.equal(isValidPhone(hit.suggestion), true);
  }
});

test('RTEL.14.12: 12 dígitos SIN 15 en esa posición no producen sugerencia', () => {
  assert.equal(detectArTrunkPrefix('112345678901'), null); // área 2, siguen "23"
  assert.equal(detectArTrunkPrefix('341456789012'), null); // área 3, siguen "45"
  assert.equal(detectArTrunkPrefix('224143000012'), null); // área 4, siguen "43"
  // El 15 en OTRA posición tampoco dispara (no es el prefijo troncal).
  assert.equal(detectArTrunkPrefix('112345157890'), null);
  // Largos distintos de 12 nunca disparan.
  assert.equal(detectArTrunkPrefix('1123456789'), null);
  assert.equal(detectArTrunkPrefix('1115234567890'), null);
});

// ─── RTEL.14.13 (DP4) — el INVARIANTE: la detección propone, no escribe ─────────────────────────

test('RTEL.14.13: normalizePhone da el MISMO resultado con y sin la detección del 15', () => {
  // El invariante de seguridad de DP4: `detectArTrunkPrefix` no se invoca desde normalizePhone ni
  // desde ningún camino de escritura. Si alguien la enchufara ahí, estos valores pasarían a normalizar
  // (y un largo de área mal clasificado persistiría en silencio un teléfono incorrecto).
  for (const withTrunk of ['111523456789', '341154567890', '224115430000', '11 15 2345 6789']) {
    const result = normalizePhone(withTrunk);
    assert.equal(result.ok, false, `"${withTrunk}" NO debe normalizar (RTEL.2.8)`);
    // ...pero SÍ debe existir la sugerencia: la ayuda está, la escritura no.
    const diagnosis = phoneDiagnosis(withTrunk.replace(/\D/g, ''), { intl: false, required: true });
    assert.equal(diagnosis?.message, PHONE_HELP_TRUNK_15);
    assert.ok(diagnosis?.suggestion);
  }
});

test('RTEL.14.13 / RTEL.6.9: el valor aceptado desde la sugerencia atraviesa normalizePhone', () => {
  const digits = '111523456789';
  const hit = detectArTrunkPrefix(digits);
  assert.ok(hit);
  // Lo que el componente hace al aceptar: re-entra por el camino normal (mismo que tipear).
  const value = phoneValueFrom(hit.suggestion, false);
  assert.deepEqual(value, { kind: 'valid', canonical: '+541123456789' });
  // Y el canónico resultante es el que el CHECK acepta.
  assert.match(value.kind === 'valid' ? value.canonical : '', new RegExp(vectors.canonicalRegex));
});

// ─── RTEL.3.1.1 — los tres estados del valor ────────────────────────────────────────────────────

test('RTEL.3.1.1: phoneValueFrom distingue vacío / incompleto / válido', () => {
  assert.deepEqual(phoneValueFrom('', false), { kind: 'empty' });
  assert.deepEqual(phoneValueFrom('', true), { kind: 'empty' });
  assert.deepEqual(phoneValueFrom('112345', false), { kind: 'incomplete' });
  assert.deepEqual(phoneValueFrom('1123456789', false), {
    kind: 'valid',
    canonical: '+541123456789',
  });
  assert.deepEqual(phoneValueFrom('34600123456', true), {
    kind: 'valid',
    canonical: '+34600123456',
  });
  // Modo AR: 8 dígitos ya NO alcanzan (D2, cambio de criterio consciente).
  assert.deepEqual(phoneValueFrom('12345678', false), { kind: 'incomplete' });
});

test('RTEL.3.1.1: el valor solo transporta el canónico en el estado válido', () => {
  const values = [
    phoneValueFrom('', false),
    phoneValueFrom('11152345', false),
    phoneValueFrom('1123456789', false),
  ];
  for (const v of values) {
    if (v.kind !== 'valid') {
      assert.deepEqual(Object.keys(v), ['kind'], 'los estados no-válidos no transportan texto');
    }
  }
});

test('samePhoneValue compara por contenido (evita el re-seed en loop del componente)', () => {
  assert.equal(samePhoneValue({ kind: 'empty' }, { kind: 'empty' }), true);
  assert.equal(samePhoneValue({ kind: 'incomplete' }, { kind: 'incomplete' }), true);
  assert.equal(samePhoneValue({ kind: 'empty' }, { kind: 'incomplete' }), false);
  assert.equal(
    samePhoneValue({ kind: 'valid', canonical: '+541123456789' }, { kind: 'valid', canonical: '+541123456789' }),
    true,
  );
  assert.equal(
    samePhoneValue({ kind: 'valid', canonical: '+541123456789' }, { kind: 'valid', canonical: '+542241430000' }),
    false,
  );
});

// ─── Transición del input: lo que hace PhoneField en cada tecla ─────────────────────────────────
//
// El repo no tiene renderer de componentes, así que la lógica del input vive PURA en phone.ts y se
// testea acá. El E2E (e2e/telefono.spec.ts) verifica que el componente esté efectivamente cableado a
// esto en las dos pantallas.

/** Simula tipear carácter por carácter sobre el texto que el input muestra. */
function type(start: PhoneInputState, text: string): { state: PhoneInputState; value: PhoneValue } {
  let state = start;
  let value: PhoneValue = phoneValueFrom(state.digits, state.intl);
  for (const ch of text) {
    ({ state, value } = phoneInputChange(state, renderPhoneInput(state) + ch));
  }
  return { state, value };
}

/** Simula un backspace: borra el último carácter del texto VISIBLE (separador incluido). */
function backspace(state: PhoneInputState): { state: PhoneInputState; value: PhoneValue } {
  return phoneInputChange(state, renderPhoneInput(state).slice(0, -1));
}

test('RTEL.3.6: tipear letras no deja NINGÚN carácter en el campo', () => {
  assert.equal(renderPhoneInput(type(EMPTY_PHONE_INPUT, 'abcdef').state), '');
  // Mezcladas con dígitos: sobreviven solo los dígitos.
  assert.equal(renderPhoneInput(type(EMPTY_PHONE_INPUT, '11abc23de45').state), '11 2345');
});

test('RTEL.4.2/RTEL.3.7: en modo AR el tipeo se topea en 12 dígitos', () => {
  const { state, value } = type(EMPTY_PHONE_INPUT, '11234567890000');
  assert.equal(state.digits.length, PHONE_AR_TYPING_MAX_DIGITS);
  assert.equal(state.digits, '112345678900');
  assert.equal(renderPhoneInput(state), '11 2345-678900');
  // 12 dígitos que NO empiezan con 54 no normalizan: el tope es de BUFFER, no de validación.
  assert.deepEqual(value, { kind: 'incomplete' });
});

test('RTEL.4.2: el tope de 12 NO afloja la validación — 11 y 12 dígitos siguen sin ser válidos', () => {
  // El riesgo obvio de subir el tope sería que 11/12 dígitos pasaran a valer. No pasan: la validación
  // la sigue haciendo normalizePhone (RTEL.5.1), que no cambió.
  for (const digits of ['11234567890', '111523456789', '112345678901']) {
    assert.deepEqual(phoneValueFrom(digits, false), { kind: 'incomplete' }, digits);
    assert.equal(isValidPhone(digits), false, digits);
  }
});

test('RTEL.4.2: subir el tope destapa N3 y N4, que ANTES se truncaban a un número distinto', () => {
  // Con el tope en 10, tipear el 0 troncal o el 54 se recortaba a 10 dígitos que normalizaban a OTRO
  // número, válido y silencioso. Ahora el tipeo llega a la regla correcta.
  const troncal = type(EMPTY_PHONE_INPUT, '01123456789'); // N3
  assert.deepEqual(troncal.value, { kind: 'valid', canonical: '+541123456789' });
  const country = type(EMPTY_PHONE_INPUT, '541123456789'); // N4
  assert.deepEqual(country.value, { kind: 'valid', canonical: '+541123456789' });

  // Lo que el tope de 10 producía en su lugar (documentado como contraste, no como comportamiento):
  assert.deepEqual(phoneValueFrom('0112345678', false), {
    kind: 'valid',
    canonical: '+540112345678',
  });
});

test('RTEL.4.4: la máscara aguanta los estados transitorios de 11 y 12 dígitos', () => {
  // Ni separador colgando ni render roto en los largos que ahora son alcanzables tipeando.
  const cases: [string, string][] = [
    ['11152345678', '11 1523-45678'],
    ['111523456789', '11 1523-456789'],
    ['34115456789', '341 154-56789'],
    ['341154567890', '341 154-567890'],
    ['22411543000', '2241 15-43000'],
    ['224115430000', '2241 15-430000'],
  ];
  for (const [digits, rendered] of cases) {
    assert.equal(maskArPhone(digits), rendered, digits);
    assert.ok(!/[ -]$/.test(rendered), `"${rendered}" no debería terminar en separador`);
    assert.equal(rendered.replace(/\D/g, ''), digits, 'la máscara no pierde ni inventa dígitos');
  }
});

test('RTEL.4.4: el backspace sigue sacando un dígito por vez desde los 12', () => {
  let state = type(EMPTY_PHONE_INPUT, '111523456789').state;
  assert.equal(state.digits.length, 12);
  const lengths: number[] = [];
  while (state.digits.length > 0) {
    ({ state } = backspace(state));
    lengths.push(state.digits.length);
  }
  assert.deepEqual(lengths, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('RTEL.4.3: la máscara sigue el código de área mientras se tipea (2 / 3 / 4 dígitos)', () => {
  assert.equal(renderPhoneInput(type(EMPTY_PHONE_INPUT, '1123456789').state), '11 2345-6789');
  assert.equal(renderPhoneInput(type(EMPTY_PHONE_INPUT, '3414567890').state), '341 456-7890');
  assert.equal(renderPhoneInput(type(EMPTY_PHONE_INPUT, '2241430000').state), '2241 43-0000');
});

test('RTEL.4.4: el backspace saca un dígito aunque el cursor esté sobre un separador', () => {
  // Estado con separador JUSTO antes del cursor no existe (la máscara nunca deja uno colgando), pero
  // sí existe el caso de borrar el guión del medio si el usuario edita: mismos dígitos, texto más
  // corto → se descarta el último dígito, en vez de re-agregar el separador y trabar el campo.
  let state = type(EMPTY_PHONE_INPUT, '1123456789').state;
  const seen: string[] = [];
  while (state.digits.length > 0) {
    ({ state } = backspace(state));
    seen.push(renderPhoneInput(state));
  }
  assert.deepEqual(seen, [
    '11 2345-678',
    '11 2345-67',
    '11 2345-6',
    '11 2345',
    '11 234',
    '11 23',
    '11 2',
    '11',
    '1',
    '',
  ]);

  // Borrar el guión del medio (mismos dígitos, texto más corto) NO deja el campo trabado.
  const full = type(EMPTY_PHONE_INPUT, '1123456789').state;
  const withoutSeparator = phoneInputChange(full, renderPhoneInput(full).replace('-', ''));
  assert.equal(withoutSeparator.state.digits.length, 9);
});

test('RTEL.4.5: pegar un número normalizable lo adopta canónico (sin truncar en silencio)', () => {
  for (const [pasted, canonical, rendered] of [
    ['+54 9 11 2345-6789', '+541123456789', '11 2345-6789'],
    ['011 4567-8900', '+541145678900', '11 4567-8900'],
    ['2241430000', '+542241430000', '2241 43-0000'],
  ]) {
    const { state, value } = phoneInputChange(EMPTY_PHONE_INPUT, pasted);
    assert.deepEqual(value, { kind: 'valid', canonical });
    assert.equal(renderPhoneInput(state), rendered);
  }
});

test('RTEL.4.5: pegar algo NO normalizable conserva los dígitos (no los recorta a 10)', () => {
  const { state, value } = phoneInputChange(EMPTY_PHONE_INPUT, '11 15 2345 6789');
  assert.equal(state.digits, '111523456789', 'los 12 dígitos pegados se conservan');
  assert.equal(renderPhoneInput(state), '11 1523-456789', 'se ven los 12 dígitos, agrupados');
  assert.deepEqual(value, { kind: 'incomplete' });
  // Recortarlos a 10 los haría parecer VÁLIDOS y escondería el problema: el peor final posible.
  assert.notEqual(state.digits.length, 10);
});

// ─── DP4 por el camino de TIPEO (no solo al pegar) — el motivo de subir el tope a 12 ────────────

test('DP4: TIPEAR un celular con el 15 dígito a dígito llega a la sugerencia (no se trunca a 10)', () => {
  // EL test del cambio. Antes, con el tope en 10, este mismo tipeo terminaba en `11 1523-4567`:
  // 10 dígitos, `valid`, canónico `+541115234567` — el número EQUIVOCADO, guardado sin un aviso.
  const typed = '1115234567 89'.replace(/\D/g, ''); // 11 15 2345 6789
  let state = EMPTY_PHONE_INPUT;
  let value: PhoneValue = { kind: 'empty' };
  const suggestions: (string | null)[] = [];

  for (const ch of typed) {
    ({ state, value } = phoneInputChange(state, renderPhoneInput(state) + ch));
    suggestions.push(
      phoneDiagnosis(state.digits, { intl: state.intl, required: true })?.suggestion ?? null,
    );
  }

  // Ningún dígito se perdió por el camino y el render final muestra los 12.
  assert.equal(state.digits, '111523456789');
  assert.equal(renderPhoneInput(state), '11 1523-456789');
  // Y NO quedó válido: sigue bloqueado hasta que el usuario acepte la corrección (RTEL.5.1 intacta).
  assert.deepEqual(value, { kind: 'incomplete' });

  // La sugerencia aparece SOLO al completarse el patrón (12 dígitos con el 15 tras el área): no molesta
  // a mitad del número. En el paso 10 —el que antes era el final— no hay ninguna.
  assert.deepEqual(suggestions.slice(0, 11), Array(11).fill(null));
  assert.equal(suggestions[11], '1123456789');

  // Y el mensaje es el específico del 15, no el genérico.
  const diagnosis = phoneDiagnosis(state.digits, { intl: false, required: true });
  assert.equal(diagnosis?.message, PHONE_HELP_TRUNK_15);

  // Aceptar la sugerencia: mismo camino que un pegado → canónico correcto (RTEL.6.9).
  const applied = phoneInputChange(EMPTY_PHONE_INPUT, diagnosis?.suggestion ?? '');
  assert.deepEqual(applied.value, { kind: 'valid', canonical: '+541123456789' });
  assert.equal(renderPhoneInput(applied.state), '11 2345-6789');
});

test('DP4: el tipeo con 15 también dispara para áreas de 3 y 4 dígitos', () => {
  for (const [typed, suggestion, canonical] of [
    ['341154567890', '3414567890', '+543414567890'],
    ['224115430000', '2241430000', '+542241430000'],
  ]) {
    const { state, value } = type(EMPTY_PHONE_INPUT, typed);
    assert.equal(state.digits, typed, 'los 12 dígitos tipeados sobreviven');
    assert.deepEqual(value, { kind: 'incomplete' });
    const diagnosis = phoneDiagnosis(state.digits, { intl: false, required: true });
    assert.equal(diagnosis?.message, PHONE_HELP_TRUNK_15);
    assert.equal(diagnosis?.suggestion, suggestion);
    assert.deepEqual(phoneInputChange(EMPTY_PHONE_INPUT, suggestion).value, {
      kind: 'valid',
      canonical,
    });
  }
});

test('RTEL.4.7/RTEL.4.8: el "+" entra en modo internacional y vaciar vuelve al argentino', () => {
  const intl = type(EMPTY_PHONE_INPUT, '+34600123456');
  assert.equal(intl.state.intl, true);
  assert.equal(renderPhoneInput(intl.state), '+34600123456', 'sin máscara AR en modo internacional');
  assert.deepEqual(intl.value, { kind: 'valid', canonical: '+34600123456' });

  const cleared = phoneInputChange(intl.state, '');
  assert.equal(cleared.state.intl, false, 'al vaciar vuelve al modo argentino');
  assert.deepEqual(cleared.value, { kind: 'empty' });

  // El tope internacional es 15 dígitos (E.164), no 10.
  const long = type(EMPTY_PHONE_INPUT, '+1234567890123456789');
  assert.equal(long.state.digits.length, 15);
});

// ─── RTEL.14.10 (L-2) — emitir SIEMPRE, también al desarmar un número válido ────────────────────

test('RTEL.14.10: valid → incomplete emite `incomplete` (el caller NO conserva el canónico viejo)', () => {
  const full = type(EMPTY_PHONE_INPUT, '1123456789');
  assert.deepEqual(full.value, { kind: 'valid', canonical: '+541123456789' });

  const afterBackspace = backspace(full.state);
  assert.deepEqual(
    afterBackspace.value,
    { kind: 'incomplete' },
    'borrar un dígito de un número válido DEBE emitir incomplete: si el componente emitiera solo al ' +
      'alcanzar `valid`, el caller se quedaría con +541123456789 y persistiría un número que el ' +
      'usuario ya editó — y las tres capas lo dejarían pasar (el canónico stale es válido).',
  );
  assert.equal(afterBackspace.value.kind !== 'valid', true);
});

test('RTEL.14.10: valid → empty emite `empty` (y el perfil persiste null, no el número viejo)', () => {
  const full = type(EMPTY_PHONE_INPUT, '1123456789');
  const cleared = phoneInputChange(full.state, '');
  assert.deepEqual(cleared.value, { kind: 'empty' });
});

test('RTEL.14.10: cada paso del tipeo emite un valor coherente con lo que se ve', () => {
  // Recorrido completo: en NINGÚN paso el valor emitido puede ser un canónico distinto del contenido.
  let state = EMPTY_PHONE_INPUT;
  const digits = '1123456789';
  for (let i = 0; i < digits.length; i++) {
    const step = phoneInputChange(state, renderPhoneInput(state) + digits[i]);
    state = step.state;
    if (i < digits.length - 1) {
      assert.deepEqual(step.value, { kind: 'incomplete' }, `paso ${i + 1}: aún no está completo`);
    } else {
      assert.deepEqual(step.value, { kind: 'valid', canonical: '+541123456789' });
    }
  }
});

test('phoneInputFromValue: solo el estado válido rehidrata contenido', () => {
  assert.deepEqual(phoneInputFromValue({ kind: 'empty' }), EMPTY_PHONE_INPUT);
  assert.deepEqual(phoneInputFromValue({ kind: 'incomplete' }), EMPTY_PHONE_INPUT);
  assert.deepEqual(phoneInputFromValue({ kind: 'valid', canonical: '+541123456789' }), {
    digits: '1123456789',
    intl: false,
  });
  assert.deepEqual(phoneInputFromValue({ kind: 'valid', canonical: '+34600123456' }), {
    digits: '34600123456',
    intl: true,
  });
});

test('phoneValueFromStored: rehidrata lo almacenado; un legacy sucio no se muestra como válido', () => {
  assert.deepEqual(phoneValueFromStored(null), { kind: 'empty' });
  assert.deepEqual(phoneValueFromStored(''), { kind: 'empty' });
  assert.deepEqual(phoneValueFromStored('+541123456789'), {
    kind: 'valid',
    canonical: '+541123456789',
  });
  assert.deepEqual(phoneValueFromStored('11 15 2345 6789'), { kind: 'incomplete' });
});

// ─── RTEL.6.4 / RTEL.6.6 — copy accionable ──────────────────────────────────────────────────────

test('RTEL.6.4: 11–12 dígitos no reconocidos enseñan el formato esperado', () => {
  assert.equal(phoneDiagnosis('11234567890', { intl: false, required: true })?.message, PHONE_HELP_AR);
  assert.equal(phoneDiagnosis('112345678901', { intl: false, required: true })?.message, PHONE_HELP_AR);
  assert.match(PHONE_HELP_AR, /10 d[ií]gitos/);
  assert.match(PHONE_HELP_AR, /sin el 0 ni el 15/);
});

test('phoneDiagnosis: vacío es error solo si el campo es obligatorio (R3.8 vs perfil)', () => {
  assert.equal(phoneDiagnosis('', { intl: false, required: false }), null);
  assert.equal(phoneDiagnosis('', { intl: false, required: true })?.message, PHONE_HELP_REQUIRED);
});

test('phoneDiagnosis: un teléfono guardado ilegible avisa, en vez de bloquear en silencio', () => {
  // El dead-end que cerramos: `phoneValueFromStored` devuelve `incomplete` ante un legacy no
  // normalizable, pero `phoneInputFromValue` lo rehidrata VACÍO (solo `valid` transporta contenido).
  // El form quedaba bloqueado por `validateProfile` con el campo vacío, sin borde ni mensaje.
  const stored = phoneValueFromStored('11 15 2345 6789');
  assert.deepEqual(stored, { kind: 'incomplete' });
  assert.deepEqual(phoneInputFromValue(stored), EMPTY_PHONE_INPUT);

  // Con el campo vacío + el valor `incomplete`, hay mensaje (aunque el teléfono sea OPCIONAL).
  assert.equal(
    phoneDiagnosis('', { intl: false, required: false, unreadableStored: true })?.message,
    PHONE_HELP_STORED_UNREADABLE,
  );
  // Gana sobre `required`: el usuario no se olvidó de escribirlo, se lo perdimos nosotros.
  assert.equal(
    phoneDiagnosis('', { intl: false, required: true, unreadableStored: true })?.message,
    PHONE_HELP_STORED_UNREADABLE,
  );
  // Se apaga sola en cuanto hay un dígito tipeado (el estado deja de ser "vacío con valor detrás").
  assert.equal(
    phoneDiagnosis('112', { intl: false, required: false, unreadableStored: true })?.message,
    PHONE_HELP_AR,
  );
  // Y sin la bandera, el comportamiento previo no cambia.
  assert.equal(phoneDiagnosis('', { intl: false, required: false }), null);
});

test('phoneDiagnosis: un valor válido no reporta error', () => {
  assert.equal(phoneDiagnosis('1123456789', { intl: false, required: true }), null);
  assert.equal(phoneDiagnosis('34600123456', { intl: true, required: true }), null);
});

test('phoneDiagnosis: en modo internacional el 0 inicial tiene su propio mensaje', () => {
  assert.equal(phoneDiagnosis('0123456789', { intl: true, required: true })?.message, PHONE_HELP_INTL_ZERO);
  assert.equal(phoneDiagnosis('1234', { intl: true, required: true })?.message, PHONE_HELP_INTL);
  // Ninguno de los dos ofrece sugerencia: la tabla de áreas es argentina y NO aplica a intl.
  assert.equal(phoneDiagnosis('0123456789', { intl: true, required: true })?.suggestion, null);
});
