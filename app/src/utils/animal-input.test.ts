// Tests de los sanitizadores de input del alta (spec 02/09 fix-loop C2, FIX 2). Pura, sin RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeTagInput,
  sanitizeIdvInput,
  sanitizeVisualInput,
  maskDateInput,
  sanitizeWeightInput,
  isValidTagElectronic,
  TAG_ELECTRONIC_LENGTH,
  IDV_MAX_LENGTH,
  VISUAL_MAX_LENGTH,
} from './animal-input.ts';

// ─── Caravana electrónica: solo dígitos, máx 15 ─────────────────────────────────────────

test('FIX2 sanitizeTagInput: filtra no-dígitos y acota a 15', () => {
  assert.equal(sanitizeTagInput('982000123456789'), '982000123456789');
  // letras y símbolos descartados
  assert.equal(sanitizeTagInput('982-abc-000'), '982000');
  // 40+ dígitos → recortado a 15 (bug que Raf vio: aceptaba 40+ chars)
  assert.equal(sanitizeTagInput('1234567890123456789012345'), '123456789012345');
  assert.equal(sanitizeTagInput('1234567890123456789012345').length, TAG_ELECTRONIC_LENGTH);
  assert.equal(sanitizeTagInput(''), '');
  assert.equal(sanitizeTagInput('asdasd'), '');
});

test('FIX2 isValidTagElectronic: vacío OK (opcional) o exactamente 15 dígitos', () => {
  assert.equal(isValidTagElectronic(''), true);
  assert.equal(isValidTagElectronic('   '), true);
  assert.equal(isValidTagElectronic('982000123456789'), true); // 15
  assert.equal(isValidTagElectronic('98200012345678'), false); // 14
  assert.equal(isValidTagElectronic('9820001234567890'), false); // 16
});

// ─── IDV: caravana VISUAL alfanumérica (CUIG/binomio), acotada ──────────────────────────

test('FIX2 sanitizeIdvInput: alfanumérico (CUIG/binomio), máx IDV_MAX_LENGTH', () => {
  // Dígitos puros (compat retro con la vieja numérica) se conservan.
  assert.equal(sanitizeIdvInput('0241'), '0241');
  // Las LETRAS ya NO se comen (bug: la caravana visual argentina es alfanumérica).
  assert.equal(sanitizeIdvInput('abc123'), 'abc123');
  // Formato CUIG real (2 letras + 3 díg + individual) se conserva intacto.
  assert.equal(sanitizeIdvInput('AB123A0001'), 'AB123A0001');
  // Separadores/espacios se descartan, pero las letras quedan.
  assert.equal(sanitizeIdvInput('AB123-A0001'), 'AB123A0001');
  assert.equal(sanitizeIdvInput('ARG 0241'), 'ARG0241');
  // NO fuerza mayúsculas: se acepta como se tipea.
  assert.equal(sanitizeIdvInput('ab123'), 'ab123');
  // Cap a IDV_MAX_LENGTH (=15) sobre cualquier mezcla larga.
  const long = 'A9'.repeat(40);
  assert.equal(sanitizeIdvInput(long).length, IDV_MAX_LENGTH);
  assert.equal(IDV_MAX_LENGTH, 15);
});

// ─── Visual: texto libre acotado ────────────────────────────────────────────────────────

test('FIX2 sanitizeVisualInput: NO filtra caracteres, solo acota el largo', () => {
  assert.equal(sanitizeVisualInput('vaca blanca'), 'vaca blanca');
  assert.equal(sanitizeVisualInput('R-14'), 'R-14');
  const long = 'a'.repeat(60);
  assert.equal(sanitizeVisualInput(long).length, VISUAL_MAX_LENGTH);
});

// ─── Fecha: máscara AAAA-MM-DD en vivo ──────────────────────────────────────────────────

test('FIX2 maskDateInput: inserta los guiones solos y descarta basura', () => {
  assert.equal(maskDateInput('2024'), '2024');
  assert.equal(maskDateInput('202401'), '2024-01');
  assert.equal(maskDateInput('20240115'), '2024-01-15');
  // no se puede tipear "asdasd" (bug que Raf vio)
  assert.equal(maskDateInput('asdasd'), '');
  assert.equal(maskDateInput('abc2024'), '2024');
  // dígitos de más (más de 8) se recortan
  assert.equal(maskDateInput('2024011599'), '2024-01-15');
  // un guion suelto tipeado a mano se ignora (siempre se reconstruye de los dígitos)
  assert.equal(maskDateInput('2024-'), '2024');
});

test('FIX2 maskDateInput: re-mascara un valor ya enmascarado (idempotente para el flujo onChange)', () => {
  // El TextInput entrega el valor con guiones ya puestos; re-correr la máscara no debe romperlo.
  assert.equal(maskDateInput(maskDateInput('20240115')), '2024-01-15');
  assert.equal(maskDateInput('2024-01-15'), '2024-01-15');
  // borrar el último dígito (backspace): "2024-01-1" → mantiene parcial
  assert.equal(maskDateInput('2024-01-1'), '2024-01-1');
});

// ─── Peso: decimal con un solo separador es-AR ──────────────────────────────────────────

test('FIX2 sanitizeWeightInput: dígitos + UN separador, descarta letras', () => {
  assert.equal(sanitizeWeightInput('180'), '180');
  assert.equal(sanitizeWeightInput('320,5'), '320,5');
  assert.equal(sanitizeWeightInput('32.5'), '32.5');
  // no se puede tipear "dasdas" (bug que Raf vio)
  assert.equal(sanitizeWeightInput('dasdas'), '');
  assert.equal(sanitizeWeightInput('abc12'), '12');
  // segundo separador descartado
  assert.equal(sanitizeWeightInput('1,2,3'), '1,23');
  assert.equal(sanitizeWeightInput('1.2.3'), '1.23');
  // separador inicial permitido (el validador de submit lo resuelve)
  assert.equal(sanitizeWeightInput(',5'), ',5');
});

test('FIXB sanitizeWeightInput: parte entera acotada a 4 dígitos (ningún bovino llega a 5 cifras)', () => {
  // 5+ dígitos enteros → recortado a 4 (bug que Raf marcó: aceptaba 5 cifras).
  assert.equal(sanitizeWeightInput('12345'), '1234');
  assert.equal(sanitizeWeightInput('99999'), '9999');
  // El récord histórico (1.740 kg) y un peso normal NO se tocan.
  assert.equal(sanitizeWeightInput('1740'), '1740');
  assert.equal(sanitizeWeightInput('320,5'), '320,5');
  // 9999 (4 cifras, máximo) intacto.
  assert.equal(sanitizeWeightInput('9999'), '9999');
  // El cap es SOLO sobre la parte entera: los decimales se mantienen aunque haya 5+ dígitos tipeados.
  assert.equal(sanitizeWeightInput('12345,5'), '1234,5');
  assert.equal(sanitizeWeightInput('99999,99'), '9999,99');
  // Dígitos enteros de más DESPUÉS de ya tener 4 + separador no rompen el orden.
  assert.equal(sanitizeWeightInput('1234567'), '1234');
});
