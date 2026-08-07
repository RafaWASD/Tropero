// Tests de la lógica PURA de fijar la categoría a mano desde la ficha (delta spec 02
// `ficha-categoria-tacto`): `categoryAgeMismatch` (RCM.4.3–4.7) + `canPinCategory` (RCM.7.1/7.2).
//
// `today` se inyecta SIEMPRE (fecha fija) → los tests no dependen del día en que corran, ni de la hora
// (el ancla es el día LOCAL, `localDayAnchorUtc`, así que un `today` a las 22:00 y otro a las 02:00 del
// mismo día LOCAL dan la misma edad — hay un caso explícito abajo por el 🔴 A.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canPinCategory,
  categoryAgeMismatch,
  isPinnableCategoryCode,
  resolveCategoryPinEffect,
  CATEGORY_PIN_FORBIDDEN_CODES,
  COHERENCE_WINDOWS,
} from './category-pin.ts';
import { pickableCategories } from './animal-category-picker.ts';
import { ONE_YEAR_DAYS, TWO_YEAR_DAYS } from './animal-category.ts';
import { decideCategoryPin } from '../services/category-pin-core.ts';

/** Un `Date` (instante local, mediodía) a N días de `birthDate` — para construir edades exactas. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Construye el `today` tal que la edad del animal nacido en `birthIso` sea EXACTAMENTE `ageDays`. */
function todayForAge(birthIso: string, ageDays: number, hourLocal = 12): Date {
  const [y, m, d] = birthIso.split('-').map(Number);
  // Instante LOCAL: `new Date(y, m-1, d, hour)` usa el husario local, que es el dominio de la app.
  const birthLocalNoon = new Date(y, m - 1, d, hourLocal, 0, 0, 0);
  return new Date(birthLocalNoon.getTime() + ageDays * DAY_MS);
}

const BIRTH = '2024-03-10';

// ─── categoryAgeMismatch — fronteras EXACTAS de cada ventana ───────────────────────────────────

test('RCM.4.3 — ternera: 364 d coherente, 365 d incoherente (frontera exacta del corte de 1 año)', () => {
  assert.equal(
    categoryAgeMismatch({ chosen: 'ternera', sex: 'female', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, ONE_YEAR_DAYS - 1) }),
    null,
  );
  const out = categoryAgeMismatch({ chosen: 'ternera', sex: 'female', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, ONE_YEAR_DAYS) });
  assert.notEqual(out, null, '365 d ya NO es ternera');
  assert.equal(out?.ageDays, ONE_YEAR_DAYS);
  assert.equal(out?.expectedCode, 'vaquillona');
});

test('RCM.4.3 — ternero: 364 d coherente, 365 d incoherente; expectedCode respeta is_castrated', () => {
  assert.equal(
    categoryAgeMismatch({ chosen: 'ternero', sex: 'male', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, 0) }),
    null,
    'recién nacido = ternero coherente (piso 0)',
  );
  const entero = categoryAgeMismatch({ chosen: 'ternero', sex: 'male', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, ONE_YEAR_DAYS) });
  assert.equal(entero?.expectedCode, 'torito');
  const castrado = categoryAgeMismatch({ chosen: 'ternero', sex: 'male', birthDate: BIRTH, isCastrated: true, today: todayForAge(BIRTH, ONE_YEAR_DAYS) });
  assert.equal(castrado?.expectedCode, 'novillito', 'un castrado de 1 año es novillito, no torito');
});

test('RCM.4.3 — torito/novillito: [365, 730). 364 fuera, 365 dentro, 729 dentro, 730 fuera', () => {
  const at = (age: number, code: string, isCastrated: boolean) =>
    categoryAgeMismatch({ chosen: code, sex: 'male', birthDate: BIRTH, isCastrated, today: todayForAge(BIRTH, age) });
  assert.notEqual(at(ONE_YEAR_DAYS - 1, 'torito', false), null, '364 d → torito incoherente');
  assert.equal(at(ONE_YEAR_DAYS, 'torito', false), null, '365 d → torito coherente');
  assert.equal(at(TWO_YEAR_DAYS - 1, 'torito', false), null, '729 d → torito coherente');
  const fuera = at(TWO_YEAR_DAYS, 'torito', false);
  assert.notEqual(fuera, null, '730 d → torito incoherente');
  assert.equal(fuera?.expectedCode, 'toro');
  // Mismo par de fronteras para el castrado.
  assert.equal(at(ONE_YEAR_DAYS, 'novillito', true), null);
  assert.equal(at(TWO_YEAR_DAYS - 1, 'novillito', true), null);
  assert.equal(at(TWO_YEAR_DAYS, 'novillito', true)?.expectedCode, 'novillo');
});

test('RCM.4.3 — toro/novillo: [730, ∞). 729 fuera, 730 dentro, 5000 dentro', () => {
  const at = (age: number, code: string, isCastrated: boolean) =>
    categoryAgeMismatch({ chosen: code, sex: 'male', birthDate: BIRTH, isCastrated, today: todayForAge(BIRTH, age) });
  assert.notEqual(at(TWO_YEAR_DAYS - 1, 'toro', false), null, '729 d → toro incoherente');
  assert.equal(at(TWO_YEAR_DAYS, 'toro', false), null, '730 d → toro coherente');
  assert.equal(at(5000, 'toro', false), null);
  assert.notEqual(at(TWO_YEAR_DAYS - 1, 'novillo', true), null);
  assert.equal(at(TWO_YEAR_DAYS, 'novillo', true), null);
});

test('RCM.4.3 — vaquillona y los estados post-vaquillona: piso 365 d, SIN techo (P5)', () => {
  for (const code of ['vaquillona', 'vaquillona_prenada', 'vaca_segundo_servicio', 'multipara']) {
    const joven = categoryAgeMismatch({ chosen: code, sex: 'female', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, ONE_YEAR_DAYS - 1) });
    assert.notEqual(joven, null, `${code} a 364 d debe avisar`);
    assert.equal(joven?.expectedCode, 'ternera');
    assert.equal(
      categoryAgeMismatch({ chosen: code, sex: 'female', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, ONE_YEAR_DAYS) }),
      null,
      `${code} a 365 d NO avisa`,
    );
    assert.equal(
      categoryAgeMismatch({ chosen: code, sex: 'female', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, 9000) }),
      null,
      `${code} a 24 años tampoco avisa (sin techo)`,
    );
  }
});

test('P5 — "Multípara" en una hembra de 14 meses NO dispara aviso (no se inventan mínimos)', () => {
  // 14 meses ≈ 426 d: por encima del único piso asertable (365 d) → sin aviso, a propósito.
  assert.equal(
    categoryAgeMismatch({ chosen: 'multipara', sex: 'female', birthDate: BIRTH, isCastrated: false, today: todayForAge(BIRTH, 426) }),
    null,
  );
});

test('RCM.4.5 — sin birth_date, con fecha inválida o con fecha FUTURA → null (no se juzga)', () => {
  const today = new Date(2026, 7, 7, 12, 0, 0);
  assert.equal(categoryAgeMismatch({ chosen: 'multipara', sex: 'female', birthDate: null, isCastrated: false, today }), null);
  assert.equal(categoryAgeMismatch({ chosen: 'multipara', sex: 'female', birthDate: 'ayer', isCastrated: false, today }), null);
  assert.equal(categoryAgeMismatch({ chosen: 'multipara', sex: 'female', birthDate: '2026-02-31', isCastrated: false, today }), null, 'fecha desbordada');
  assert.equal(categoryAgeMismatch({ chosen: 'ternera', sex: 'female', birthDate: '2030-01-01', isCastrated: false, today }), null, 'nacimiento futuro');
});

test('code SIN ventana de coherencia (cut / vaca_cabana / custom) → null, nunca se juzga', () => {
  const today = todayForAge(BIRTH, 30);
  for (const code of ['cut', 'vaca_cabana', 'lechera_alta', '']) {
    assert.equal(
      categoryAgeMismatch({ chosen: code, sex: 'female', birthDate: BIRTH, isCastrated: false, today }),
      null,
      `${code || '(vacío)'} no debería juzgarse`,
    );
  }
});

test('el `code` elegido se compara TRIMEADO (el catálogo puede traer espacios)', () => {
  const today = todayForAge(BIRTH, 30);
  assert.notEqual(
    categoryAgeMismatch({ chosen: '  multipara  ', sex: 'female', birthDate: BIRTH, isCastrated: false, today }),
    null,
    'con trim, "multipara" en una ternera de 30 d SÍ avisa',
  );
});

test('🔴 A.2 — la edad NO se corre por la hora: 22:00 y 02:00 del mismo día LOCAL dan lo mismo', () => {
  // El bug histórico anclaba el día en UTC: en AR (UTC−3), a las 22:00 el día UTC ya es el siguiente y el
  // animal figuraba un día más viejo → el corte de 365 d se cruzaba tres horas antes todos los días.
  const noche = todayForAge(BIRTH, ONE_YEAR_DAYS - 1, 22);
  const madrugada = todayForAge(BIRTH, ONE_YEAR_DAYS - 1, 2);
  const args = { chosen: 'ternera', sex: 'female' as const, birthDate: BIRTH, isCastrated: false };
  assert.equal(categoryAgeMismatch({ ...args, today: noche }), null, 'a las 22:00 sigue siendo ternera de 364 d');
  assert.equal(categoryAgeMismatch({ ...args, today: madrugada }), null);
});

test('la tabla de ventanas se construye con los cortes del espejo (anti-drift), no con literales', () => {
  assert.equal(COHERENCE_WINDOWS.ternera.maxAge, ONE_YEAR_DAYS);
  assert.equal(COHERENCE_WINDOWS.torito.minAge, ONE_YEAR_DAYS);
  assert.equal(COHERENCE_WINDOWS.torito.maxAge, TWO_YEAR_DAYS);
  assert.equal(COHERENCE_WINDOWS.toro.minAge, TWO_YEAR_DAYS);
  assert.equal(COHERENCE_WINDOWS.toro.maxAge, Infinity);
  assert.equal(COHERENCE_WINDOWS.cut, undefined, 'cut NO tiene ventana');
  assert.equal(COHERENCE_WINDOWS.vaca_cabana, undefined, 'vaca_cabana NO tiene ventana');
});

// ─── canPinCategory (RCM.7.1 / RCM.7.2 / RCM.1.3) ──────────────────────────────────────────────

test('RCM.7.1 — activo + no-CUT + con opciones → true', () => {
  assert.equal(canPinCategory({ status: 'active', isCut: false, optionCount: 5 }), true);
  assert.equal(canPinCategory({ status: 'active', isCut: false, optionCount: 1 }), true);
});

test('RCM.7.2 — un CUT NO ofrece "Cambiar" (aunque esté activo y con opciones)', () => {
  assert.equal(canPinCategory({ status: 'active', isCut: true, optionCount: 5 }), false);
});

test('RCM.1.3 — archivado (sold/dead/transferred) → false', () => {
  for (const status of ['sold', 'dead', 'transferred', '']) {
    assert.equal(canPinCategory({ status, isCut: false, optionCount: 5 }), false, status);
  }
});

test('RCM.2.6 — sin opciones (catálogo no sincronizado) → false (fail-safe)', () => {
  assert.equal(canPinCategory({ status: 'active', isCut: false, optionCount: 0 }), false);
  assert.equal(canPinCategory({ status: 'active', isCut: false, optionCount: -1 }), false);
});

// ─── isPinnableCategoryCode (RCM.2.4, la SEGUNDA cerradura del borde de escritura) ─────────────

test('RCM.2.4 — `cut` NO es fijable por el selector (acopla is_cut → estado inconsistente RCUT.2.3)', () => {
  assert.equal(isPinnableCategoryCode('cut'), false);
  assert.equal(isPinnableCategoryCode('  cut  '), false, 'con espacios tampoco (se compara trimeado)');
});

test('las categorías que el selector SÍ ofrece son todas fijables (las dos cerraduras no se contradicen)', () => {
  // Si `pickableCategories` ofreciera algo que el servicio va a rechazar, la UI mostraría una opción muerta.
  // Este test ata las dos listas sobre el catálogo real de cría.
  const catalog = [
    { code: 'ternero', name: 'Ternero' },
    { code: 'ternera', name: 'Ternera' },
    { code: 'vaquillona', name: 'Vaquillona' },
    { code: 'vaquillona_prenada', name: 'Vaquillona preñada' },
    { code: 'vaca_segundo_servicio', name: 'Vaca segundo servicio' },
    { code: 'multipara', name: 'Multípara' },
    { code: 'cut', name: 'CUT' },
    { code: 'vaca_cabana', name: 'Vaca cabaña' },
    { code: 'toro', name: 'Toro' },
    { code: 'torito', name: 'Torito' },
    { code: 'novillito', name: 'Novillito' },
    { code: 'novillo', name: 'Novillo' },
  ];
  for (const sex of ['male', 'female'] as const) {
    for (const castrated of [false, true]) {
      for (const opt of pickableCategories(catalog, sex, castrated)) {
        assert.equal(isPinnableCategoryCode(opt.code), true, `${opt.code} se ofrece pero no es fijable`);
      }
    }
  }
});

test('el code vacío no es fijable (no se escribe una categoría "ninguna")', () => {
  assert.equal(isPinnableCategoryCode(''), false);
  assert.equal(isPinnableCategoryCode('   '), false);
});

test('`vaca_cabana` NO está en la lista prohibida: queda fuera por ALCANCE, no por consistencia', () => {
  assert.equal(CATEGORY_PIN_FORBIDDEN_CODES.has('vaca_cabana'), false);
  assert.deepEqual([...CATEGORY_PIN_FORBIDDEN_CODES], ['cut']);
});

// ─── resolveCategoryPinEffect (RCM.3.4 no-op / RCM.5.3 copy) ───────────────────────────────────

test('RCM.3.4 — tocar la categoría VIGENTE derivada de un animal sin fijación → noop', () => {
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'vaquillona', currentCode: 'vaquillona', currentOverride: false, derivedCode: 'vaquillona' }),
    'noop',
  );
});

test('RCM.3.4 — tocar la MISMA categoría ya FIJADA (≠ derivada) → noop (el override no cambia)', () => {
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'multipara', currentCode: 'multipara', currentOverride: true, derivedCode: 'vaquillona' }),
    'noop',
  );
});

test('el falso no-op: override=true con la fijada IGUAL a la derivada → unpin, NO noop', () => {
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'vaquillona', currentCode: 'vaquillona', currentOverride: true, derivedCode: 'vaquillona' }),
    'unpin',
    'tocar esa misma categoría QUITA la fijación: hay algo que confirmar y que escribir',
  );
});

test('RCM.5.1 — elegir una categoría distinta de la derivada → pin', () => {
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'multipara', currentCode: 'vaquillona', currentOverride: false, derivedCode: 'vaquillona' }),
    'pin',
  );
});

test('RCM.5.2 (P2) — elegir la categoría DERIVADA sobre un animal fijado → unpin', () => {
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'vaquillona', currentCode: 'multipara', currentOverride: true, derivedCode: 'vaquillona' }),
    'unpin',
  );
});

test('derivada IRRESOLUBLE (null) → cualquier elección distinta es pin; la vigente ya fijada, noop', () => {
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'multipara', currentCode: 'vaquillona', currentOverride: false, derivedCode: null }),
    'pin',
  );
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'multipara', currentCode: 'multipara', currentOverride: true, derivedCode: null }),
    'noop',
  );
  // Sin derivada, tocar la vigente NO fijada sí es un cambio (pasa a override=true).
  assert.equal(
    resolveCategoryPinEffect({ chosen: 'vaquillona', currentCode: 'vaquillona', currentOverride: false, derivedCode: null }),
    'pin',
  );
});

test('COHERENCIA UI↔DATOS: el efecto que la confirmación PROMETE es el que el núcleo ESCRIBE', async () => {
  // El copy sale de `resolveCategoryPinEffect` (utils) y el write de `decideCategoryPin` (services). Si una
  // de las dos cambia sin la otra, la confirmación miente. Este test las ata sobre el producto cartesiano.
  const codes = ['vaquillona', 'multipara'];
  const derivedOptions: (string | null)[] = ['vaquillona', 'multipara', null];
  for (const chosen of codes) {
    for (const currentCode of codes) {
      for (const currentOverride of [false, true]) {
        for (const derivedCode of derivedOptions) {
          const effect = resolveCategoryPinEffect({ chosen, currentCode, currentOverride, derivedCode });
          if (effect === 'noop') continue; // el no-op no llega al núcleo (el sheet cierra sin escribir)
          const r = await decideCategoryPin({
            chosen: { code: chosen, categoryId: `id-${chosen}` },
            derived: derivedCode == null ? null : { code: derivedCode, categoryId: `id-${derivedCode}` },
            writePin: async () => ({ ok: true as const }),
            writeRevert: async () => ({ ok: true as const }),
          });
          assert.equal(r.ok, true);
          assert.equal(
            r.ok && r.value.override,
            effect === 'pin',
            `chosen=${chosen} current=${currentCode}/${currentOverride} derived=${derivedCode}: la UI dice ` +
              `"${effect}" y el núcleo escribe override=${r.ok && r.value.override}`,
          );
        }
      }
    }
  }
});
