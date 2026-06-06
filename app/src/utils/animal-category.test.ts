// Tests de la categoría inicial al alta (spec 02 R4.7 / RT2.20) — espejo de compute_category sin
// eventos (0062, is_castrated=false en el alta) + la lógica pura de override (alta guiada A #4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeInitialCategoryCode, categoryOverrideFor } from './animal-category.ts';

// Fecha fija para determinismo.
const TODAY = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

function isoDaysAgo(n: number): string {
  const d = new Date(TODAY.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ─── computeInitialCategoryCode (RT2.20) ──────────────────────────────────────────────────

test('RT2.20 macho < 1 año → ternero', () => {
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(180), TODAY), 'ternero');
});

test('RT2.20 macho 1–2 años → torito', () => {
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(540), TODAY), 'torito');
});

test('RT2.20 macho ≥ 2 años → toro (corte de 2 años, lo que el espejo viejo NO distinguía)', () => {
  // 730 días = exactamente 2 años → toro (≥ 730).
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(730), TODAY), 'toro');
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(900), TODAY), 'toro');
});

test('RT2.20 macho borde del corte de 2 años: 729 días = torito, 730 días = toro', () => {
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(729), TODAY), 'torito');
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(730), TODAY), 'toro');
});

test('RT2.20 macho sin fecha → torito (default conservador, = backend)', () => {
  assert.equal(computeInitialCategoryCode('male', null, TODAY), 'torito');
});

test('RT2.20 hembra < 1 año → ternera', () => {
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(180), TODAY), 'ternera');
});

test('RT2.20 hembra ≥ 1 año → vaquillona (sin corte de 2 años para hembras en el alta)', () => {
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(540), TODAY), 'vaquillona');
  // Una hembra de 3 años sin eventos sigue siendo vaquillona en el cómputo del alta (las hembras
  // adultas suben de categoría por PARTOS/tactos, no por edad — el override las preserva si la
  // realidad es otra; ver tests de override).
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(1200), TODAY), 'vaquillona');
});

test('RT2.20 hembra sin fecha → vaquillona (default conservador, = backend)', () => {
  assert.equal(computeInitialCategoryCode('female', null, TODAY), 'vaquillona');
});

test('RT2.20 borde de 1 año: exactamente 365 días NO es cría (≥ 1 año)', () => {
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(365), TODAY), 'vaquillona');
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(364), TODAY), 'ternera');
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(365), TODAY), 'torito');
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(364), TODAY), 'ternero');
});

test('RT2.20 fecha inválida/futura se trata como desconocida (default por sexo)', () => {
  // Fecha futura → no es cría conocida → default por sexo.
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(-10), TODAY), 'torito');
  // Formato basura → desconocida.
  assert.equal(computeInitialCategoryCode('female', 'no-es-fecha', TODAY), 'vaquillona');
});

// ─── categoryOverrideFor (alta guiada A #4) ───────────────────────────────────────────────

test('override=false cuando la elegida COINCIDE con la computada (ternero recién nacido → ternero)', () => {
  // macho < 1 año computa ternero; el usuario elige "ternero" → coincide → no override.
  assert.equal(categoryOverrideFor('ternero', 'male', isoDaysAgo(180), TODAY), false);
});

test('override=false: hembra <1 año elige ternera (coincide con la computada)', () => {
  assert.equal(categoryOverrideFor('ternera', 'female', isoDaysAgo(180), TODAY), false);
});

test('override=true cuando la elegida DIFIERE de la computada (multípara sin historial → preserva)', () => {
  // Una hembra con fecha vieja computa vaquillona; el usuario elige "multipara" (vaca comprada) →
  // difiere → override (el recálculo por edad/eventos NO la revierte a vaquillona). A5.
  assert.equal(categoryOverrideFor('multipara', 'female', isoDaysAgo(1200), TODAY), true);
  // Y sin fecha también computa vaquillona → multípara difiere → override.
  assert.equal(categoryOverrideFor('multipara', 'female', null, TODAY), true);
});

test('override=true: macho adulto elegido toro coincide (≥2 años) → false; pero elegido toro <1 año → true', () => {
  // ≥ 2 años computa toro → elegir "toro" coincide → no override.
  assert.equal(categoryOverrideFor('toro', 'male', isoDaysAgo(900), TODAY), false);
  // < 1 año computa ternero → elegir "toro" difiere → override (preserva).
  assert.equal(categoryOverrideFor('toro', 'male', isoDaysAgo(180), TODAY), true);
});

test('override=true: elegir novillito/novillo (castrado) SIEMPRE difiere de la computada (alta entera)', () => {
  // El alta computa entero (torito/toro/ternero…), nunca novillito/novillo (sin toggle de castración).
  // Elegir un castrado → difiere → override (preserva la elección hasta que el toggle exista).
  assert.equal(categoryOverrideFor('novillito', 'male', isoDaysAgo(540), TODAY), true); // computa torito
  assert.equal(categoryOverrideFor('novillo', 'male', isoDaysAgo(900), TODAY), true); // computa toro
});

test('override insensible a espacios accidentales en el code elegido', () => {
  // El picker emite el code crudo del catálogo, pero por robustez la comparación hace trim.
  assert.equal(categoryOverrideFor('  ternero  ', 'male', isoDaysAgo(180), TODAY), false);
});

// ─── Refinamiento B: preñez capturada en el alta ──────────────────────────────────────────

test('B: computeInitialCategoryCode(hembra, pregnant) → vaquillona_prenada (derivable por tacto+)', () => {
  // Una hembra con tacto+ capturado computa vaquillona_prenada (el server transiciona por el tacto+).
  assert.equal(
    computeInitialCategoryCode('female', isoDaysAgo(540), { today: TODAY, pregnant: true }),
    'vaquillona_prenada',
  );
  // La preñez GANA al corte de edad: aún una "ternera por edad" (<1 año) con tacto+ → vaquillona_prenada
  // (un tacto+ la promueve a vaquillona y luego a preñada server-side).
  assert.equal(
    computeInitialCategoryCode('female', isoDaysAgo(180), { today: TODAY, pregnant: true }),
    'vaquillona_prenada',
  );
  // Sin fecha + preñez → igual vaquillona_prenada.
  assert.equal(
    computeInitialCategoryCode('female', null, { today: TODAY, pregnant: true }),
    'vaquillona_prenada',
  );
});

test('B: pregnant NO afecta al macho (no existe macho preñado)', () => {
  // Un macho con `pregnant:true` (caso imposible/defensivo) computa por edad, sin tocar la rama hembra.
  assert.equal(
    computeInitialCategoryCode('male', isoDaysAgo(180), { today: TODAY, pregnant: true }),
    'ternero',
  );
});

test('B: vaquillona_prenada elegida + preñez capturada → override=FALSE (corrige el sobre-bloqueo de A)', () => {
  // El caso clave: elegís "vaquillona_prenada" Y capturás preñez → la computada-con-preñez también es
  // vaquillona_prenada → COINCIDE → override=false (un parto futuro la transiciona a vaca).
  assert.equal(
    categoryOverrideFor('vaquillona_prenada', 'female', isoDaysAgo(540), { today: TODAY, pregnant: true }),
    false,
  );
});

test('B: vaquillona_prenada elegida SIN preñez capturada → override=TRUE (computa vaquillona, difiere)', () => {
  // Sin la preñez, la computada es vaquillona → difiere de vaquillona_prenada → override=true.
  assert.equal(
    categoryOverrideFor('vaquillona_prenada', 'female', isoDaysAgo(540), { today: TODAY, pregnant: false }),
    true,
  );
});

test('B: multipara/vaca_segundo_servicio → override=TRUE aunque se capture preñez (no derivable: no capturamos partos)', () => {
  // Una multípara/vaca preñada NO es derivable del alta (no capturamos partos). La computada-con-preñez
  // es vaquillona_prenada (no multipara) → difiere → override=true (el owner la gestiona manual).
  assert.equal(
    categoryOverrideFor('multipara', 'female', isoDaysAgo(1200), { today: TODAY, pregnant: true }),
    true,
  );
  assert.equal(
    categoryOverrideFor('vaca_segundo_servicio', 'female', isoDaysAgo(1200), { today: TODAY, pregnant: true }),
    true,
  );
});

test('B: recría coincidente sigue override=false con la firma de opciones', () => {
  // La firma nueva (objeto de opciones) no rompe el caso base: ternera <1 año elegida ternera → false.
  assert.equal(
    categoryOverrideFor('ternera', 'female', isoDaysAgo(180), { today: TODAY }),
    false,
  );
  // Y un macho ternero coincidente con opciones vacías → false (today default; isoDaysAgo es relativo a
  // TODAY, así que pasamos today para determinismo).
  assert.equal(categoryOverrideFor('ternero', 'male', isoDaysAgo(180), { today: TODAY }), false);
});
