// Tests del estado VACÍO de la asignación masiva de caravanas (spec 09 dedup opción B, RD5.2) frente al
// bugfix 2026-07-29 ("el bastón no existe en este dispositivo"). node:test, sin RN.
//
// Los dos lados están cubiertos a propósito: neutralizar el corte `if (!hasTransport)` deja en rojo los
// casos "sin transporte"; devolver SIEMPRE la rama sin transporte deja en rojo el de regresión. Un fix
// que sea no-op en cualquiera de las dos direcciones no pasa esta suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bulkAssignEmptyView } from './bulk-assign-empty.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..', '..'); // app/

/** La frase canónica de "sin bastón" — UNA sola redacción en toda la app (ver §COPY del módulo). */
const CANONICAL = 'El bastón no está disponible en este dispositivo';

// ─── SIN TRANSPORTE: el vacío dice la verdad en vez de pedir un bastoneo imposible ───────────

test('sin transporte: el vacío NO pide bastonear (esta pantalla no tiene otra entrada de datos)', () => {
  const v = bulkAssignEmptyView(false);
  assert.equal(v.waiting, false);
  // Ni el título ni el cuerpo le piden al operario lo único que su dispositivo NO puede hacer.
  assert.doesNotMatch(v.title, /baston(e|é)/i, `el título pide bastonear: "${v.title}"`);
  assert.doesNotMatch(v.body, /baston(e|é)/i, `el cuerpo pide bastonear: "${v.body}"`);
  assert.doesNotMatch(v.body, /pasá el bastón/i, `el cuerpo pide pasar el bastón: "${v.body}"`);
});

test('sin transporte: dice la frase canónica y ofrece una salida REAL (la ficha del animal)', () => {
  const v = bulkAssignEmptyView(false);
  assert.equal(v.notice, CANONICAL, 'el aviso no es la frase canónica de "sin bastón"');
  assert.ok(v.title.length > 0);
  // La salida existe de verdad: el TagScanSheet de la ficha carga el EID a mano sin transporte.
  assert.match(v.body, /ficha/i, `el cuerpo no apunta a la salida real: "${v.body}"`);
});

// ─── CON TRANSPORTE: regresión (web / Fase 4). El copy queda EXACTAMENTE como antes del bugfix ─

test('regresión: CON transporte el vacío queda literalmente igual que antes del bugfix', () => {
  const v = bulkAssignEmptyView(true);
  assert.equal(v.title, 'Bastoneá para empezar');
  assert.equal(
    v.body,
    'Pasá el bastón por la caravana del animal. Acá vas a elegir a cuál de tus animales sin caravana se la asignás.',
  );
  assert.equal(v.notice, null, 'con bastón no corresponde el aviso de "no disponible"');
  assert.equal(v.waiting, true);
});

test('las dos ramas son distintas y ambas están completas (ni no-op ni copy vacío)', () => {
  const sin = bulkAssignEmptyView(false);
  const con = bulkAssignEmptyView(true);
  assert.notEqual(sin.title, con.title, 'el fix es un no-op: las dos ramas dicen lo mismo');
  assert.notEqual(sin.body, con.body);
  for (const v of [sin, con]) {
    assert.ok(v.title.length > 0, 'título vacío');
    assert.ok(v.body.length > 0, 'cuerpo vacío');
  }
  // El aviso existe SOLO cuando el bastón no está: es lo que lo hace informativo y no ruido.
  assert.equal(con.notice, null);
  assert.ok(sin.notice && sin.notice.length > 0);
});

// ─── GUARD DE DRIFT DE COPY: una sola redacción para el mismo hecho ──────────────────────────
// La regla "reusá la copy, no inventes una tercera redacción" no se puede sostener con una nota en un
// comentario: si alguien reescribe el hero de `identificar` y deja este módulo con la frase vieja, la app
// dice el mismo hecho de dos maneras y nadie se entera. El guard es estático (node:fs) porque la
// alternativa (E2E) no ve las 3 superficies en una sola corrida.

test('guard: la frase de "sin bastón" es LITERALMENTE la misma en las 3 superficies', () => {
  const surfaces = [
    join(APP_ROOT, 'app', 'maniobra', 'identificar.tsx'),
    join(APP_ROOT, 'src', 'components', 'TagScanSheet.tsx'),
  ];
  for (const file of surfaces) {
    const src = readFileSync(file, 'utf8');
    assert.ok(
      src.includes(CANONICAL),
      `${file} ya no dice "${CANONICAL}" — si cambió la redacción, actualizá también bulk-assign-empty.ts (una sola frase para el mismo hecho)`,
    );
  }
  assert.equal(bulkAssignEmptyView(false).notice, CANONICAL);
});
