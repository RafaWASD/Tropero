// Tests de la lógica PURA del primitivo footer-fijo con CTA (U2) + de la reserva inferior compartida
// de toda la app (unidad «aire»). node:test.
// Foco: (1) reserva de safe-area = max(inset vigente, inset arranque, PISO) + AIRE-solo-donde-aplica,
// con blindaje frame-0 Android (U7); (2) padding del footer keyboard-aware (no dejar hueco con el
// teclado abierto); (3) decisión del peek.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSafeBottomInset,
  resolveFooterPaddingBottom,
  shouldShowScrollPeek,
} from './footer-action.ts';

// Tokens reales del design system (tamagui.config.ts).
const PISO = 12; // $navBottomMin — respiro mínimo cuando NO hay inset del sistema
const GAP = 16; // $navBarGap — aire contra la BARRA DE NAVEGACIÓN del SO (solo Android)

/** Reserva de una plataforma SIN barra de navegación dibujada sobre el contenido (iOS, web). */
const noBar = (liveInsetBottom: number, initialInsetBottom = liveInsetBottom, own = {}) =>
  computeSafeBottomInset({
    liveInsetBottom,
    initialInsetBottom,
    minInset: PISO,
    gap: GAP,
    applyGap: false,
    ...own,
  });

/** Reserva de Android: el inset ES la barra de navegación → se le suma el aire. */
const android = (liveInsetBottom: number, initialInsetBottom = liveInsetBottom, own = {}) =>
  computeSafeBottomInset({
    liveInsetBottom,
    initialInsetBottom,
    minInset: PISO,
    gap: GAP,
    applyGap: true,
    ...own,
  });

// ─── computeSafeBottomInset — la tabla de la decisión ─────────────────────────────────────

test('REGRESIÓN del bug 🔴 — Android 3 botones (inset 48): reserva 64, ESTRICTAMENTE mayor que el inset', () => {
  // EL BUG (device Samsung, build 7402575a): con `max(insets.bottom, mínimo=12)` la reserva daba 48
  // (= exactamente la barra de navegación) y el CTA quedaba a 1dp de la barra. Este assert es el que
  // impide volver a esa fórmula: cualquier `max` puro devuelve 48 acá y cae.
  assert.equal(android(48), 64);
  assert.ok(android(48) > 48, 'en Android la reserva DEBE superar al inset (el inset ES la barra)');
});

test('Android gestos (inset ~24): 24 + 16 = 40, también estrictamente mayor que el inset', () => {
  assert.equal(android(24), 40);
  assert.ok(android(24) > 24);
});

test('REGRESIÓN de la fórmula aditiva-en-TODAS-las-plataformas (descartada): iOS 34 → 34, NO 50', () => {
  // En iOS el inset de 34pt es espacio pintado con el fondo de la app con el home indicator (una
  // pildorita fina) adentro: el inset ya ES el aire. Sumarle 16 hacía la tab bar 110pt (33% más alta
  // que la nativa de iOS) y le comía zona de pulgar a cada CTA. El aire es SOLO para Android.
  assert.equal(noBar(34), 34);
  assert.notEqual(noBar(34), 34 + GAP);
});

test('REGRESIÓN del piso perdido: web (sin inset) → 12, NO 16', () => {
  // El $navBottomMin=12 tiene que existir: es el respiro cuando NO hay inset. La versión aditiva pura
  // lo había borrado y web pasaba a 16 sin ninguna razón de diseño.
  assert.equal(noBar(0, 0), PISO);
  assert.notEqual(noBar(0, 0), GAP);
});

test('el PISO solo puede ganar cuando el inset del sistema es menor que él', () => {
  assert.equal(noBar(0), 12); // web
  assert.equal(noBar(5), 12); // inset raro chiquito → manda el piso
  assert.equal(noBar(12), 12); // empate
  assert.equal(noBar(13), 13); // a partir de acá manda el inset
  assert.equal(noBar(34), 34); // iOS
});

test('en Android el aire se suma DESPUÉS del piso (nunca reemplaza al inset)', () => {
  assert.equal(android(0), PISO + GAP); // Android viejo con botones físicos (inset 0)
  assert.equal(android(5), PISO + GAP); // gana el piso, y encima el aire
  assert.equal(android(48), 48 + GAP);
});

test('Android frame-cero (live=0) pero el arranque midió 48 (3 botones): usa el de arranque → 64', () => {
  // Blindaje U7 CONSERVADO: sin el piso de arranque, live=0 daría 12+16=28 y el nav saltaría un frame
  // después. `initialWindowMetrics` llega sincrónico desde getConstants en nativo.
  assert.equal(android(0, 48), 64);
  assert.equal(android(0, 24), 40);
});

test('toma el MAYOR entre inset vigente y de arranque, y recién ahí aplica piso y aire', () => {
  assert.equal(android(48, 24), 64); // vigente creció (cambió el nav-mode) → 48 + 16
  assert.equal(noBar(0, 34), 34); // frame-cero clásico en iOS: gana el de arranque
  assert.equal(android(24, 48), 64); // gana el de arranque
});

test('el aire se suma UNA sola vez (no una por inset)', () => {
  assert.equal(android(48, 48), 64);
});

// ─── Aire/piso PROPIOS de una superficie (esta unidad agrega aire, nunca lo saca) ─────────

test('`extra` (aire propio) se suma al inset y NO se duplica con el piso en web', () => {
  // Superficies que ya tenían más aire que el resto (TagScanSheet / FindOrCreateOverlay: inset + $6).
  const own = { extra: 32 };
  assert.equal(noBar(0, 0, own), 32, 'web: su propio aire, NO piso+aire (44)');
  assert.equal(noBar(34, 34, own), 66, 'iOS: idéntico al baseline (inset + 32)');
  assert.equal(android(48, 48, own), 96, 'Android: inset + su aire + el aire canónico');
});

test('`extra` chico: el PISO sigue siendo el mínimo absoluto', () => {
  // Los footers que sumaban 12 sobre el inset: en web `max(0+12, 12) = 12` (= baseline), no 24.
  assert.equal(noBar(0, 0, { extra: 12 }), 12);
  assert.equal(noBar(34, 34, { extra: 12 }), 46);
  assert.equal(android(48, 48, { extra: 12 }), 76);
  // Un extra menor que el piso tampoco baja de 12.
  assert.equal(noBar(0, 0, { extra: 4 }), 12);
});

test('`floor` (piso propio) compite en el max, no se suma (los sheets que usaban max(inset, $4))', () => {
  const own = { floor: 18 };
  assert.equal(noBar(0, 0, own), 18, 'web: su piso propio (= baseline)');
  assert.equal(noBar(34, 34, own), 34, 'iOS: manda el inset (= baseline), el piso no aporta');
  assert.equal(android(48, 48, own), 64, 'Android: inset + aire canónico');
  // Un floor menor que el canónico no baja nada.
  assert.equal(noBar(0, 0, { floor: 4 }), 12);
});

test('los 3 sheets que tenían `paddingBottom="$6"` FIJO: qué cambia por plataforma al plegarlos al hook', () => {
  // ── QUÉ FIJA ESTE TEST ────────────────────────────────────────────────────────────────────────────
  // `TreatmentStartSheet`, `TreatmentApplicationSheet` y `BulkConfirmSheet` tenían la reserva escrita como
  // un TOKEN SUELTO (`paddingBottom="$6"` = 32 en la escala `space`), sin pasar nunca por la reserva
  // canónica: en Android con barra de 3 botones (inset 48) sus CTAs quedaban a 32dp del borde de PANTALLA,
  // o sea DEBAJO de una barra de 48. La unidad «aire» no los vio porque su guard prohíbe RE-IMPLEMENTAR la
  // fórmula, no OMITIRLA. Se plegaron con `floor: $6` (el knob que conserva el aire propio que ya tenían).
  // El delta se fija acá con números, no en prosa: es un cambio de geometría con el teclado CERRADO y no
  // puede viajar de contrabando dentro de una barrida de teclado.
  const SEIS = 32; // $6 de la escala `space` (default de @tamagui/config/v4)
  const own = { floor: SEIS };
  assert.equal(noBar(0, 0, own), SEIS, 'web: 32 → 32, IDÉNTICO a lo que había (cero cambio observable)');
  assert.equal(noBar(34, 34, own), 34, 'iOS: 32 → 34 (el inset del home indicator manda)');
  assert.equal(android(24, 24, own), 48, 'Android gestos (inset 24): 32 → 48');
  assert.equal(android(48, 48, own), 64, 'Android 3 botones (inset 48): 32 → 64 — el CTA sale de la barra');
  // Y la propiedad que hace que el fix sea un fix: en Android la reserva es ESTRICTAMENTE mayor que el
  // inset, o sea que el contenido nunca queda apoyado sobre la barra.
  for (const inset of [24, 48]) assert.ok(android(inset, inset, own) > inset);
});

test('sin `extra`/`floor` el resultado es exactamente el canónico (defaults inocuos)', () => {
  for (const inset of [0, 12, 24, 34, 48]) {
    assert.equal(noBar(inset, inset, { extra: 0, floor: 0 }), noBar(inset));
    assert.equal(android(inset, inset, { extra: 0, floor: 0 }), android(inset));
  }
});

test('NaN / negativos / no-finitos → 0 (no rompen el layout)', () => {
  assert.equal(noBar(NaN, NaN), PISO);
  assert.equal(noBar(-10, -5), PISO);
  assert.equal(noBar(Infinity, 0), PISO);
  assert.equal(android(NaN, NaN), PISO + GAP);
  // parámetros rotos → no contaminan la reserva (nunca NaN en el layout).
  assert.equal(
    computeSafeBottomInset({
      liveInsetBottom: 48,
      initialInsetBottom: 48,
      minInset: NaN,
      gap: NaN,
      applyGap: true,
    }),
    48,
  );
  assert.equal(
    computeSafeBottomInset({
      liveInsetBottom: 48,
      initialInsetBottom: 48,
      minInset: PISO,
      gap: -8,
      applyGap: true,
      extra: NaN,
      floor: -3,
    }),
    48,
  );
});

// ─── resolveFooterPaddingBottom — keyboard-aware ──────────────────────────────────────────

test('teclado CERRADO → la reserva de safe-area plena', () => {
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: false, safeInset: 34, keyboardOpenGap: 8 }), 34);
});

test('teclado ABIERTO → solo el respiro chico (la safe-area la tapa el teclado → no reservarla)', () => {
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: true, safeInset: 34, keyboardOpenGap: 8 }), 8);
  // clave: con el teclado abierto NO se reserva el safe-inset (evita el hueco de ~34px sobre el teclado).
  assert.notEqual(
    resolveFooterPaddingBottom({ keyboardVisible: true, safeInset: 34, keyboardOpenGap: 8 }),
    34,
  );
});

test('resolveFooterPaddingBottom: valores raros → 0 (no rompen)', () => {
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: false, safeInset: NaN, keyboardOpenGap: 8 }), 0);
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: true, safeInset: 34, keyboardOpenGap: -5 }), 0);
});

// ─── shouldShowScrollPeek — decisión del affordance ───────────────────────────────────────

test('body que CABE entero (sin overflow) → NO peek', () => {
  assert.equal(shouldShowScrollPeek({ scrollY: 0, viewportHeight: 800, contentHeight: 600 }), false);
});

test('body con contenido oculto abajo (arriba del fold) → peek', () => {
  assert.equal(shouldShowScrollPeek({ scrollY: 0, viewportHeight: 400, contentHeight: 1200 }), true);
});

test('scrolleado hasta el fondo → NO peek (ya no hay nada oculto abajo)', () => {
  // maxScroll = 1200 - 400 = 800; en el fondo → bottom:false.
  assert.equal(shouldShowScrollPeek({ scrollY: 800, viewportHeight: 400, contentHeight: 1200 }), false);
});

test('scroll parcial con contenido restante → peek sigue visible', () => {
  assert.equal(shouldShowScrollPeek({ scrollY: 200, viewportHeight: 400, contentHeight: 1200 }), true);
});
