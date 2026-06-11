// Tests de la categoría inicial al alta (spec 02 R4.7 / RT2.20) — espejo de compute_category sin
// eventos (0062, is_castrated=false en el alta) + la lógica pura de override (alta guiada A #4).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeInitialCategoryCode,
  categoryOverrideFor,
  computeCategoryCode,
  inferIsCastrated,
  deriveDisplayCategory,
  computeDisplayOverrides,
  type ReproEventInput,
  type MirrorRowInput,
  type CategoryCatalogEntry,
} from './animal-category.ts';

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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// FIXTURES ESPEJO (RC6.1.6) — matriz RT2.x replicada caso por caso de supabase/tests/animal/run.cjs.
// Misma tabla de casos, dos implementaciones (mitigación de drift #1 del Gate 0). Cada bloque referencia
// el T2.x server que espeja. Si alguno FALLA tras tocar 0062, este espejo driftó → ACTUALIZAR ambos.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Helper: arma un ReproEventInput. createdAt default null (fila local) salvo que se pase. */
function ev(
  eventType: string,
  eventDate: string,
  extra: { createdAt?: string | null; pregnancyStatus?: string | null } = {},
): ReproEventInput {
  return {
    eventType,
    eventDate,
    createdAt: extra.createdAt ?? null,
    pregnancyStatus: extra.pregnancyStatus ?? null,
  };
}

/** computeCategoryCode con today fijo + sin eventos por default (azúcar para los fixtures). */
function mirror(
  sex: 'male' | 'female',
  birthDate: string | null,
  opts: { isCastrated?: boolean; events?: ReproEventInput[] } = {},
): string {
  return computeCategoryCode({
    sex,
    birthDate,
    isCastrated: opts.isCastrated ?? false,
    events: opts.events ?? [],
    today: TODAY,
  });
}

// ─── T2.21 — compute_category rama MACHO (RT2.3.x) ────────────────────────────────────────
test('RC6.1.6/T2.21: macho <1 año entero → ternero', () => {
  assert.equal(mirror('male', isoDaysAgo(180)), 'ternero');
});
test('RC6.1.6/T2.21: macho 1–2 años entero → torito', () => {
  assert.equal(mirror('male', isoDaysAgo(400)), 'torito');
});
test('RC6.1.6/T2.21: macho ≥2 años entero → toro', () => {
  assert.equal(mirror('male', isoDaysAgo(800)), 'toro');
});
test('RC6.1.6/T2.21: macho 1–2 años castrado → novillito', () => {
  assert.equal(mirror('male', isoDaysAgo(400), { isCastrated: true }), 'novillito');
});
test('RC6.1.6/T2.21: macho ≥2 años castrado → novillo', () => {
  assert.equal(mirror('male', isoDaysAgo(800), { isCastrated: true }), 'novillo');
});
test('RC6.1.6/T2.21: macho birth_date NULL entero → torito (default conservador)', () => {
  assert.equal(mirror('male', null), 'torito');
});
test('RC6.1.6/T2.21: macho birth_date NULL castrado → novillito (sin corte de 2 años sin edad)', () => {
  // Espeja el `else` de 0062 (líneas 56-59): sin edad NO se aplica el corte de 2 años → novillito, no novillo.
  assert.equal(mirror('male', null, { isCastrated: true }), 'novillito');
});

// ─── T2.22 — compute_category rama HEMBRA (RT2.4.x) ───────────────────────────────────────
test('RC6.1.6/T2.22: hembra <1 año sin eventos → ternera', () => {
  assert.equal(mirror('female', isoDaysAgo(180)), 'ternera');
});
test('RC6.1.6/T2.22: hembra ≥1 año sin eventos → vaquillona', () => {
  assert.equal(mirror('female', isoDaysAgo(550)), 'vaquillona');
});
test('RC6.1.6/T2.22: hembra birth_date NULL sin eventos → vaquillona (default conservador)', () => {
  assert.equal(mirror('female', null), 'vaquillona');
});

// ─── T2.23 — transición SERVICIO (RT2.5.x) ────────────────────────────────────────────────
test('RC6.1.6/T2.23: ternera <1 año + service → vaquillona (servicio gradúa)', () => {
  assert.equal(mirror('female', isoDaysAgo(180), { events: [ev('service', isoDaysAgo(1))] }), 'vaquillona');
});
test('RC6.1.6/T2.23: vaquillona + service → sigue vaquillona (no avanza ni retrocede)', () => {
  assert.equal(mirror('female', isoDaysAgo(550), { events: [ev('service', isoDaysAgo(1))] }), 'vaquillona');
});
test('RC6.1.6/T2.23: preñada + service → NO retrocede (el tacto+ vigente domina)', () => {
  // tacto+ vigente + service → vaquillona_prenada (el tacto+ precede a la rama vaquillona). RT2.5.2.
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [ev('tacto', isoDaysAgo(10), { pregnancyStatus: 'large' }), ev('service', isoDaysAgo(1))],
    }),
    'vaquillona_prenada',
  );
});

// ─── T2.24 — transición DESTETE (RT2.6.x) ─────────────────────────────────────────────────
test('RC6.1.6/T2.24: ternero macho entero + weaning → torito', () => {
  assert.equal(mirror('male', isoDaysAgo(180), { events: [ev('weaning', isoDaysAgo(1))] }), 'torito');
});
test('RC6.1.6/T2.24: ternero macho castrado + weaning → novillito', () => {
  assert.equal(
    mirror('male', isoDaysAgo(180), { isCastrated: true, events: [ev('weaning', isoDaysAgo(1))] }),
    'novillito',
  );
});
test('RC6.1.6/T2.24: ternera + weaning → vaquillona', () => {
  assert.equal(mirror('female', isoDaysAgo(180), { events: [ev('weaning', isoDaysAgo(1))] }), 'vaquillona');
});
test('RC6.1.6/T2.24: torito (≥1 año) + weaning → sigue torito (no retrocede)', () => {
  assert.equal(mirror('male', isoDaysAgo(400), { events: [ev('weaning', isoDaysAgo(1))] }), 'torito');
});

// ─── T2.25 — PARTO desde cualquier categoría + mellizos (RT2.7.1/2.7.2) ───────────────────
test('RC6.1.6/T2.25: vaquillona + 1 birth → vaca_segundo_servicio', () => {
  assert.equal(mirror('female', isoDaysAgo(550), { events: [ev('birth', isoDaysAgo(1))] }), 'vaca_segundo_servicio');
});
test('RC6.1.6/T2.25: ternera + 1 birth → vaca_segundo_servicio (salto desde ternera)', () => {
  assert.equal(mirror('female', isoDaysAgo(300), { events: [ev('birth', isoDaysAgo(1))] }), 'vaca_segundo_servicio');
});
test('RC6.1.6/T2.25: 2 births → multipara', () => {
  assert.equal(
    mirror('female', isoDaysAgo(300), { events: [ev('birth', isoDaysAgo(60)), ev('birth', isoDaysAgo(1))] }),
    'multipara',
  );
});
test('RC6.1.6/T2.25: mellizos = UN evento birth → avanza una sola vez (no doble-cuenta)', () => {
  // El conteo es por EVENTOS birth, NUNCA por terneros (RT2.7.2): un parto de mellizos = 1 evento birth →
  // vaca_segundo_servicio (no multipara). El overlay/SQL trae UNA fila birth por parto.
  assert.equal(mirror('female', isoDaysAgo(550), { events: [ev('birth', isoDaysAgo(1))] }), 'vaca_segundo_servicio');
});

// ─── T2.26 / T2.29 — ABORTO revierte + orden (event_date, created_at) (RT2.7.3-5) ─────────
test('RC6.1.6/T2.26: vaquillona + tacto+ → preñada; + abortion POSTERIOR → revierte a vaquillona', () => {
  assert.equal(
    mirror('female', isoDaysAgo(550), { events: [ev('tacto', isoDaysAgo(10), { pregnancyStatus: 'medium' })] }),
    'vaquillona_prenada',
  );
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [ev('tacto', isoDaysAgo(10), { pregnancyStatus: 'medium' }), ev('abortion', isoDaysAgo(1))],
    }),
    'vaquillona',
  );
});
test('RC6.1.6/T2.26: multipara (2 partos) que aborta queda multipara', () => {
  assert.equal(
    mirror('female', isoDaysAgo(900), {
      events: [ev('birth', isoDaysAgo(60)), ev('birth', isoDaysAgo(50)), ev('abortion', isoDaysAgo(1))],
    }),
    'multipara',
  );
});
test('RC6.1.6/T2.29: aborto ANTERIOR al tacto+ → el tacto+ vuelve a contar → preñada (por fecha)', () => {
  // RT2.7.5 por fecha: el aborto en daysAgo(20) es ANTERIOR al tacto+ en daysAgo(10) → no lo revierte.
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [ev('abortion', isoDaysAgo(20)), ev('tacto', isoDaysAgo(10), { pregnancyStatus: 'large' })],
    }),
    'vaquillona_prenada',
  );
});
test('RC6.1.6/T2.29: aborto POSTERIOR al tacto+ → revierte (por fecha)', () => {
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [ev('tacto', isoDaysAgo(20), { pregnancyStatus: 'large' }), ev('abortion', isoDaysAgo(10))],
    }),
    'vaquillona',
  );
});
test('RC6.1.6/T2.29: tacto+ y aborto MISMO event_date → desempata created_at (aborto posterior revierte)', () => {
  const sameDay = isoDaysAgo(10);
  // El aborto con created_at posterior (mismo event_date) revierte el tacto+.
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [
        ev('tacto', sameDay, { pregnancyStatus: 'large', createdAt: '2026-05-22T10:00:00Z' }),
        ev('abortion', sameDay, { createdAt: '2026-05-22T11:00:00Z' }),
      ],
    }),
    'vaquillona',
  );
  // Si el aborto tiene created_at ANTERIOR (mismo event_date) → el tacto+ es posterior → sigue preñada.
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [
        ev('abortion', sameDay, { createdAt: '2026-05-22T10:00:00Z' }),
        ev('tacto', sameDay, { pregnancyStatus: 'large', createdAt: '2026-05-22T11:00:00Z' }),
      ],
    }),
    'vaquillona_prenada',
  );
});

// ─── T2.30 — revert recalcula con is_castrated explícito (RT2.11.2) ───────────────────────
test('RC6.1.6/T2.30: torito castrado 400d → al recomputar con isCastrated=true resuelve novillito', () => {
  assert.equal(mirror('male', isoDaysAgo(400), { isCastrated: true }), 'novillito');
});

// ─── PRECEDENCIA de ramas LOAD-BEARING (RC6.1.2) — los desempates que rompen si 0062 reordena ──
// Estos tests FALLARÍAN si la precedencia de la máquina de estados difiriera de 0062 (el orden de los
// `if`/`elsif`). Son la defensa más fuerte del anti-drift: no solo cada rama suelta, sino su ORDEN.
test('RC6.1.2 precedencia: 1 birth GANA a un tacto+ vigente → vaca_segundo_servicio (no vaquillona_prenada)', () => {
  // 0062: partos=1 (línea 89) PRECEDE a tacto+ (línea 91). Una vaca de 1 parto que vuelve a quedar preñada
  // sigue siendo vaca_segundo_servicio (el parto manda sobre la preñez nueva). Si se invirtiera el orden,
  // este caso daría vaquillona_prenada (mal).
  assert.equal(
    mirror('female', isoDaysAgo(900), {
      events: [ev('birth', isoDaysAgo(60)), ev('tacto', isoDaysAgo(10), { pregnancyStatus: 'large' })],
    }),
    'vaca_segundo_servicio',
  );
});
test('RC6.1.2 precedencia: 2 births GANAN a tacto+ → multipara', () => {
  assert.equal(
    mirror('female', isoDaysAgo(900), {
      events: [
        ev('birth', isoDaysAgo(120)),
        ev('birth', isoDaysAgo(60)),
        ev('tacto', isoDaysAgo(10), { pregnancyStatus: 'large' }),
      ],
    }),
    'multipara',
  );
});
test('RC6.1.2 precedencia: tacto+ vigente GANA a destete/servicio/edad → vaquillona_prenada (no vaquillona)', () => {
  // 0062: tacto+ (línea 91) PRECEDE a la rama vaquillona (destete|servicio|≥1año, línea 93). Una hembra con
  // servicio + tacto+ es preñada, no "solo" vaquillona. Si se invirtiera, daría vaquillona (mal).
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [
        ev('service', isoDaysAgo(40)),
        ev('weaning', isoDaysAgo(30)),
        ev('tacto', isoDaysAgo(10), { pregnancyStatus: 'large' }),
      ],
    }),
    'vaquillona_prenada',
  );
});
test('RC6.1.2 precedencia (T2.29 secuencia): service+tacto+parto → vaca_segundo_servicio (el parto manda)', () => {
  // Espeja el caso final de T2.29 (secuencia completa): el parto (births=1) gana a todo lo previo.
  assert.equal(
    mirror('female', isoDaysAgo(300), {
      events: [
        ev('service', isoDaysAgo(40)),
        ev('tacto', isoDaysAgo(20), { pregnancyStatus: 'small' }),
        ev('birth', isoDaysAgo(1)),
      ],
    }),
    'vaca_segundo_servicio',
  );
});
test('RC6.1.2 precedencia macho: corte 2 años GANA al destete → toro/novillo (no torito/novillito)', () => {
  // 0062 rama macho: ≥730 (línea 48) PRECEDE a (destete|≥365) (línea 51). Un macho de >2 años con destete
  // es toro/novillo, no torito/novillito. Si se invirtiera, el destete lo dejaría en torito (mal).
  assert.equal(mirror('male', isoDaysAgo(800), { events: [ev('weaning', isoDaysAgo(1))] }), 'toro');
  assert.equal(
    mirror('male', isoDaysAgo(800), { isCastrated: true, events: [ev('weaning', isoDaysAgo(1))] }),
    'novillo',
  );
});

// ─── RC6.1.4 — tie-break createdAt null = "más reciente" (semántica offline propia del espejo) ──
test('RC6.1.4: tacto+ (created_at null = ahora) + aborto con created_at PRESENTE, mismo event_date → aborto NO revierte', () => {
  // El tacto+ recién insertado offline (createdAt null) se trata como MÁS RECIENTE que el aborto que ya
  // tiene created_at del server → el aborto NO es posterior → sigue preñada. Caso: tactear hoy, offline,
  // sobre una hembra que tuvo un aborto el mismo día (ya sincronizado).
  const sameDay = isoDaysAgo(5);
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [
        ev('abortion', sameDay, { createdAt: '2026-05-27T09:00:00Z' }),
        ev('tacto', sameDay, { pregnancyStatus: 'large', createdAt: null }),
      ],
    }),
    'vaquillona_prenada',
  );
});
test('RC6.1.4: aborto (created_at null = ahora) + tacto+ con created_at PRESENTE, mismo event_date → aborto revierte', () => {
  // El aborto recién insertado offline (createdAt null) se trata como MÁS RECIENTE que el tacto+ que ya
  // tiene created_at → el aborto ES posterior → revierte. Caso: cargar un aborto hoy, offline, sobre una
  // hembra preñada (tacto ya sincronizado del mismo día).
  const sameDay = isoDaysAgo(5);
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [
        ev('tacto', sameDay, { pregnancyStatus: 'large', createdAt: '2026-05-27T09:00:00Z' }),
        ev('abortion', sameDay, { createdAt: null }),
      ],
    }),
    'vaquillona',
  );
});
test('RC6.1.4: tacto + aborto MISMO día, AMBOS sin created_at (offline) → el aborto (insertado después) REVIERTE', () => {
  // Caso REALISTA offline (lo reproduce el e2e de aborto): tactear y luego abortar el MISMO día, ambos por
  // CRUD plano local → ambos created_at null. La query los entrega ORDER BY event_date, created_at; con
  // ambos null el orden es el de INSERCIÓN (rowid) → el aborto queda DESPUÉS en el array. El desempate por
  // ÍNDICE lo trata como posterior → revierte → vaquillona (igual que el server cuando selle los created_at
  // al subir: el aborto, insertado después, tendrá created_at mayor). Antes de este fix daba preñada (bug).
  const sameDay = isoDaysAgo(5);
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [
        ev('tacto', sameDay, { pregnancyStatus: 'large', createdAt: null }),
        ev('abortion', sameDay, { createdAt: null }),
      ],
    }),
    'vaquillona',
  );
});

test('RC6.1.4: aborto + tacto MISMO día, AMBOS sin created_at (offline) → el tacto (insertado después) GANA', () => {
  // El simétrico: si el orden de inserción fue aborto y LUEGO un tacto+ (re-servicio + nuevo tacto el mismo
  // día), el tacto (índice mayor) es posterior → el aborto previo NO lo revierte → preñada.
  const sameDay = isoDaysAgo(5);
  assert.equal(
    mirror('female', isoDaysAgo(550), {
      events: [
        ev('abortion', sameDay, { createdAt: null }),
        ev('tacto', sameDay, { pregnancyStatus: 'large', createdAt: null }),
      ],
    }),
    'vaquillona_prenada',
  );
});

// ─── RC6.2.1 — inferencia de is_castrated del code guardado ────────────────────────────────
test('RC6.2.1: inferIsCastrated → true solo para novillito/novillo', () => {
  assert.equal(inferIsCastrated('novillito'), true);
  assert.equal(inferIsCastrated('novillo'), true);
  assert.equal(inferIsCastrated('torito'), false);
  assert.equal(inferIsCastrated('toro'), false);
  assert.equal(inferIsCastrated('ternero'), false);
  assert.equal(inferIsCastrated('vaquillona'), false);
  assert.equal(inferIsCastrated('multipara'), false);
  assert.equal(inferIsCastrated(null), false);
  assert.equal(inferIsCastrated(undefined), false);
  assert.equal(inferIsCastrated(''), false);
});

// ─── RC6.3.3 / RC6.3.4 — deriveDisplayCategory (override manda + fail-safe) ────────────────
const CATALOG = [
  { code: 'ternera', name: 'Ternera' },
  { code: 'vaquillona', name: 'Vaquillona' },
  { code: 'vaquillona_prenada', name: 'Vaquillona preñada' },
  { code: 'vaca_segundo_servicio', name: 'Vaca de segundo servicio' },
  { code: 'multipara', name: 'Multípara' },
];

test('RC6.3: override=false → muestra la DERIVADA resuelta en el catálogo', () => {
  const r = deriveDisplayCategory({
    storedCode: 'vaquillona',
    storedName: 'Vaquillona',
    categoryOverride: false,
    derivedCode: 'vaquillona_prenada',
    catalog: CATALOG,
  });
  assert.deepEqual(r, { code: 'vaquillona_prenada', name: 'Vaquillona preñada' });
});
test('RC6.3.3: override=true → muestra la GUARDADA tal cual (el espejo NO aplica)', () => {
  const r = deriveDisplayCategory({
    storedCode: 'multipara',
    storedName: 'Multípara',
    categoryOverride: true,
    derivedCode: 'vaquillona', // el espejo derivaría vaquillona, pero override manda
    catalog: CATALOG,
  });
  assert.deepEqual(r, { code: 'multipara', name: 'Multípara' });
});
test('RC6.3.4: code derivado SIN fila en el catálogo → FAIL-SAFE a la guardada', () => {
  const r = deriveDisplayCategory({
    storedCode: 'vaquillona',
    storedName: 'Vaquillona',
    categoryOverride: false,
    derivedCode: 'toro', // no está en CATALOG (catálogo de hembras) → fail-safe
    catalog: CATALOG,
  });
  assert.deepEqual(r, { code: 'vaquillona', name: 'Vaquillona' });
});
test('RC6.3.4: catálogo VACÍO → fail-safe a la guardada (nunca blanco)', () => {
  const r = deriveDisplayCategory({
    storedCode: 'vaquillona',
    storedName: 'Vaquillona',
    categoryOverride: false,
    derivedCode: 'vaquillona_prenada',
    catalog: [],
  });
  assert.deepEqual(r, { code: 'vaquillona', name: 'Vaquillona' });
});

// ─── RC6.3 — núcleo PURO del espejo de display (computeDisplayOverrides) ────────────────────
//
// Es el corazón del swap en memoria de la lista/ficha/búsqueda. Por construcción PURO ⇒ display-only:
// no puede escribir nada (RC6.3.5 es estructural). Verificamos la matriz de display sobre filas+eventos.

const SYS = 'sys-bovino';
const catalogMap = (entries: CategoryCatalogEntry[]) =>
  new Map<string, readonly CategoryCatalogEntry[]>([[SYS, entries]]);

function row(over: Partial<MirrorRowInput> & { profileId: string }): MirrorRowInput {
  return {
    sex: 'female',
    birthDate: isoDaysAgo(550),
    systemId: SYS,
    categoryOverride: false,
    storedCode: 'vaquillona',
    storedName: 'Vaquillona',
    ...over,
  };
}

test('RC6.3.1: override=false con tacto+ offline → la fila muestra la DERIVADA (vaquillona_prenada)', () => {
  const rows = [row({ profileId: 'p1' })];
  const events = new Map<string, readonly ReproEventInput[]>([
    ['p1', [{ eventType: 'tacto', eventDate: isoDaysAgo(10), createdAt: null, pregnancyStatus: 'large' }]],
  ]);
  const out = computeDisplayOverrides(rows, events, catalogMap(CATALOG));
  assert.deepEqual(out.get('p1'), { code: 'vaquillona_prenada', name: 'Vaquillona preñada' });
});

test('RC6.3.3: override=true → NO entra al Map (la vista usa la guardada tal cual)', () => {
  const rows = [row({ profileId: 'p2', categoryOverride: true, storedCode: 'multipara', storedName: 'Multípara' })];
  const events = new Map<string, readonly ReproEventInput[]>();
  const out = computeDisplayOverrides(rows, events, catalogMap(CATALOG));
  assert.equal(out.has('p2'), false);
});

test('RC6.3.4: code derivado sin fila en el catálogo del system → fail-safe a la guardada', () => {
  // hembra sin eventos ≥1 año → vaquillona; pero pasamos un catálogo SIN vaquillona → fail-safe.
  const rows = [row({ profileId: 'p3', storedCode: 'multipara', storedName: 'Multípara' })];
  const events = new Map<string, readonly ReproEventInput[]>();
  const out = computeDisplayOverrides(rows, events, catalogMap([{ code: 'ternera', name: 'Ternera' }]));
  assert.deepEqual(out.get('p3'), { code: 'multipara', name: 'Multípara' });
});

test('RC6.3.4: sin system_id → NO entra al Map (no se puede resolver code→name)', () => {
  const rows = [row({ profileId: 'p4', systemId: null })];
  const events = new Map<string, readonly ReproEventInput[]>();
  const out = computeDisplayOverrides(rows, events, new Map());
  assert.equal(out.has('p4'), false);
});

test('RC6.3.1: macho castrado inferido del code guardado (novillito) + destete offline → novillito', () => {
  // storedCode novillito → inferIsCastrated true; macho con weaning → novillito (no torito). Display-only.
  const rows = [
    row({
      profileId: 'p5',
      sex: 'male',
      birthDate: isoDaysAgo(180),
      storedCode: 'novillito',
      storedName: 'Novillito',
    }),
  ];
  const events = new Map<string, readonly ReproEventInput[]>([
    ['p5', [{ eventType: 'weaning', eventDate: isoDaysAgo(1), createdAt: null, pregnancyStatus: null }]],
  ]);
  const out = computeDisplayOverrides(
    rows,
    events,
    catalogMap([{ code: 'novillito', name: 'Novillito' }, { code: 'ternero', name: 'Ternero' }]),
  );
  assert.deepEqual(out.get('p5'), { code: 'novillito', name: 'Novillito' });
});

test('RC6.3.2: batch de varias filas — cada una resuelve por sus propios eventos', () => {
  const rows = [
    row({ profileId: 'pa', storedCode: 'vaquillona', storedName: 'Vaquillona' }), // → tacto+ → preñada
    row({ profileId: 'pb', storedCode: 'vaquillona', storedName: 'Vaquillona' }), // → sin eventos → vaquillona
    row({ profileId: 'pc', categoryOverride: true, storedCode: 'multipara', storedName: 'Multípara' }), // override
  ];
  const events = new Map<string, readonly ReproEventInput[]>([
    ['pa', [{ eventType: 'tacto', eventDate: isoDaysAgo(5), createdAt: null, pregnancyStatus: 'medium' }]],
  ]);
  const out = computeDisplayOverrides(rows, events, catalogMap(CATALOG));
  assert.deepEqual(out.get('pa'), { code: 'vaquillona_prenada', name: 'Vaquillona preñada' });
  assert.deepEqual(out.get('pb'), { code: 'vaquillona', name: 'Vaquillona' });
  assert.equal(out.has('pc'), false); // override → la guardada, no entra
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// T-CL.7 / R13.6 / R10.6 — el espejo se alimenta del is_castrated REAL (0084), degradando la inferencia.
// El input real (MirrorRowInput.isCastrated) tiene PRECEDENCIA sobre inferIsCastrated(storedCode): la
// castración offline da novillito/novillo AL INSTANTE (antes de que el server recompute el code) y el
// revert da torito/toro — sin esperar el sync-down. El fallback por inferencia se conserva SOLO cuando el
// caller no provee el real (legacy/Fase 3).
// ══════════════════════════════════════════════════════════════════════════════════════════════

const CATALOG_MACHO = [
  { code: 'ternero', name: 'Ternero' },
  { code: 'torito', name: 'Torito' },
  { code: 'toro', name: 'Toro' },
  { code: 'novillito', name: 'Novillito' },
  { code: 'novillo', name: 'Novillo' },
];

test('T-CL.7/R10.6: isCastrated=true REAL ⇒ espejo da novillito (1-2 años) y novillo (≥2 años) SIN sync', () => {
  // El code guardado todavía dice torito/toro (el server no recomputó) pero is_castrated REAL ya es true
  // (castración offline) → el espejo refleja novillito/novillo al instante. Esto la inferencia por code
  // NO lo cubría (storedCode torito/toro → inferiría false → torito/toro).
  const rows = [
    row({
      profileId: 'm-1-2',
      sex: 'male',
      birthDate: isoDaysAgo(400), // 1-2 años
      storedCode: 'torito',
      storedName: 'Torito',
      isCastrated: true,
    }),
    row({
      profileId: 'm-2plus',
      sex: 'male',
      birthDate: isoDaysAgo(800), // ≥2 años
      storedCode: 'toro',
      storedName: 'Toro',
      isCastrated: true,
    }),
  ];
  const out = computeDisplayOverrides(rows, new Map(), catalogMap(CATALOG_MACHO));
  assert.deepEqual(out.get('m-1-2'), { code: 'novillito', name: 'Novillito' });
  assert.deepEqual(out.get('m-2plus'), { code: 'novillo', name: 'Novillo' });
});

test('T-CL.7/R10.6: isCastrated=false REAL ⇒ espejo da torito/toro (revert visible offline)', () => {
  // El code guardado dice novillito/novillo (estaba castrado) pero is_castrated REAL ya es false (revert
  // offline) → el espejo vuelve a torito/toro al instante. La inferencia por code daría true (novillito/
  // novillo → castrado) → no reflejaría el revert.
  const rows = [
    row({
      profileId: 'r-1-2',
      sex: 'male',
      birthDate: isoDaysAgo(400),
      storedCode: 'novillito',
      storedName: 'Novillito',
      isCastrated: false,
    }),
    row({
      profileId: 'r-2plus',
      sex: 'male',
      birthDate: isoDaysAgo(800),
      storedCode: 'novillo',
      storedName: 'Novillo',
      isCastrated: false,
    }),
  ];
  const out = computeDisplayOverrides(rows, new Map(), catalogMap(CATALOG_MACHO));
  assert.deepEqual(out.get('r-1-2'), { code: 'torito', name: 'Torito' });
  assert.deepEqual(out.get('r-2plus'), { code: 'toro', name: 'Toro' });
});

test('T-CL.7: el is_castrated REAL GANA a lo que infiere el code (precedencia explícita)', () => {
  // storedCode novillito (inferiría castrado=true) pero el REAL dice false → debe ganar el real → torito.
  const rowReal = row({
    profileId: 'win',
    sex: 'male',
    birthDate: isoDaysAgo(400),
    storedCode: 'novillito',
    storedName: 'Novillito',
    isCastrated: false, // REAL: NO castrado
  });
  const out = computeDisplayOverrides([rowReal], new Map(), catalogMap(CATALOG_MACHO));
  assert.deepEqual(out.get('win'), { code: 'torito', name: 'Torito' });
});

test('T-CL.7: SIN isCastrated provisto (null/undefined) ⇒ DEGRADA al fallback por inferencia (legacy C6)', () => {
  // Call-site legacy (Fase 3 aún sin cablear): no pasa isCastrated → se infiere del code. storedCode
  // novillito → inferIsCastrated true → novillito (comportamiento IDÉNTICO al previo, sin regresión).
  const undefinedReal = row({
    profileId: 'legacy',
    sex: 'male',
    birthDate: isoDaysAgo(400),
    storedCode: 'novillito',
    storedName: 'Novillito',
    // isCastrated omitido → undefined → fallback
  });
  const nullReal = row({
    profileId: 'legacy-null',
    sex: 'male',
    birthDate: isoDaysAgo(400),
    storedCode: 'torito',
    storedName: 'Torito',
    isCastrated: null, // explícito null → fallback (storedCode torito → infiere false → torito)
  });
  const out = computeDisplayOverrides([undefinedReal, nullReal], new Map(), catalogMap(CATALOG_MACHO));
  assert.deepEqual(out.get('legacy'), { code: 'novillito', name: 'Novillito' });
  assert.deepEqual(out.get('legacy-null'), { code: 'torito', name: 'Torito' });
});

test('T-CL.7: castración offline de un TERNERO (is_castrated=true real) NO transiciona el code (sigue ternero)', () => {
  // En ternero el cambio de is_castrated no transiciona (compute devuelve ternero hasta destete/1 año),
  // en ambas direcciones — coherente con el server (0062) y con T-DB.5. El espejo no inventa novillito.
  const rowTern = row({
    profileId: 'tern',
    sex: 'male',
    birthDate: isoDaysAgo(120), // < 1 año
    storedCode: 'ternero',
    storedName: 'Ternero',
    isCastrated: true,
  });
  const out = computeDisplayOverrides([rowTern], new Map(), catalogMap(CATALOG_MACHO));
  assert.deepEqual(out.get('tern'), { code: 'ternero', name: 'Ternero' });
});

test('T-CL.7: computeCategoryCode directo con isCastrated real espeja al server (ancla de la precedencia)', () => {
  // El núcleo ya aceptaba isCastrated; T-CL.7 solo lo CABLEA en computeDisplayOverrides. Este test fija
  // que el contrato del núcleo no cambió (la precedencia es responsabilidad del wrapper, no del núcleo).
  assert.equal(mirror('male', isoDaysAgo(400), { isCastrated: true }), 'novillito');
  assert.equal(mirror('male', isoDaysAgo(400), { isCastrated: false }), 'torito');
  assert.equal(mirror('male', isoDaysAgo(800), { isCastrated: true }), 'novillo');
  assert.equal(mirror('male', isoDaysAgo(800), { isCastrated: false }), 'toro');
});
