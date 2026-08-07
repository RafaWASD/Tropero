// Tests de la FUENTE ÚNICA de "hoy" date-only (hallazgo A.2 del QA de maniobras en device).
// node:test + type-stripping nativo (sin Jest; consistente con el resto).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { todayIsoLocal } from './today-iso.ts';

test('todayIsoLocal: `AAAA-MM-DD` del wall-clock LOCAL, con cero-padding', () => {
  assert.equal(todayIsoLocal(new Date(2026, 0, 5)), '2026-01-05'); // enero, día 5 → los dos padeados
  assert.equal(todayIsoLocal(new Date(2026, 11, 31)), '2026-12-31'); // diciembre, día 31
  assert.equal(todayIsoLocal(new Date(2026, 7, 6, 14, 30)), '2026-08-06'); // media tarde, sin sorpresas
});

// ── EL CASO DEL BUG 🔴 ────────────────────────────────────────────────────────────────────────────
// Este es el test que hay que mirar. Con la implementación vieja (`toISOString().slice(0, 10)`, que es
// UTC), TODOS los de acá abajo devolvían el día SIGUIENTE, y el dato entraba corrido en una columna
// `date`. La ejecución fija el huso a Argentina para que el caso sea determinista en cualquier máquina.
test('A.2: la última hora del día LOCAL sigue siendo hoy (en UTC−3 el bug la mandaba a mañana)', () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // El caso exacto que se midió en el A07: 6-ago-2026, 22:54 hora de Argentina.
  assert.equal(todayIsoLocal(new Date(2026, 7, 6, 22, 54, 0)), '2026-08-06', `(huso del runner: ${tz})`);
  // Los dos bordes del día local.
  assert.equal(todayIsoLocal(new Date(2026, 7, 6, 23, 59, 59)), '2026-08-06');
  assert.equal(todayIsoLocal(new Date(2026, 7, 7, 0, 0, 0)), '2026-08-07');

  // ── CONTRAFACTUAL: que el test esté MIDIENDO algo ─────────────────────────────────────────────────
  // Lo que hace al bug un bug es que el día LOCAL y el día UTC difieren en las puntas del día. Se elige
  // el instante que produce esa divergencia en el huso REAL del runner (tarde-noche si está al oeste de
  // UTC, madrugada si está al este) y se verifica que la forma vieja daba otro día. Un runner en UTC
  // exacto no puede exhibir la divergencia: ahí se declara en vez de dar un verde mentiroso.
  const probe = new Date(2026, 7, 6, 12, 0, 0);
  const offsetMin = probe.getTimezoneOffset(); // >0 = al OESTE de UTC (AR = 180)
  if (offsetMin === 0) {
    assert.ok(true, `runner en UTC (${tz}): la divergencia local↔UTC no existe acá — caso no ejercitado`);
    return;
  }
  const boundary =
    offsetMin > 0
      ? new Date(2026, 7, 6, 23, 30, 0) // oeste: la noche local ya es el día siguiente en UTC
      : new Date(2026, 7, 6, 0, 30, 0); // este: la madrugada local todavía es el día anterior en UTC
  const utcDay = boundary.toISOString().slice(0, 10); // la forma VIEJA, tal cual estaba escrita
  assert.equal(todayIsoLocal(boundary), '2026-08-06', 'el día local del instante es el 6');
  assert.notEqual(
    utcDay,
    todayIsoLocal(boundary),
    `con el huso del runner (${tz}, offset ${offsetMin}) la forma vieja TIENE que dar otro día; si no, ` +
      'este test no está midiendo nada',
  );
  assert.equal(utcDay, offsetMin > 0 ? '2026-08-07' : '2026-08-05');
});

test('todayIsoLocal: el orden lexicográfico del string es el orden de fecha (se compara sin parsear)', () => {
  const a = todayIsoLocal(new Date(2026, 0, 31));
  const b = todayIsoLocal(new Date(2026, 1, 1));
  assert.ok(a < b, `${a} < ${b}`);
  assert.ok(todayIsoLocal(new Date(2025, 11, 31)) < todayIsoLocal(new Date(2026, 0, 1)), 'cruce de año');
});

test('todayIsoLocal: sin argumento usa el ahora del sistema (y tiene la forma correcta)', () => {
  const now = new Date();
  assert.equal(todayIsoLocal(), todayIsoLocal(now).slice(0, 10)); // mismo día (la corrida no cruza medianoche)
  assert.match(todayIsoLocal(), /^\d{4}-\d{2}-\d{2}$/);
});
