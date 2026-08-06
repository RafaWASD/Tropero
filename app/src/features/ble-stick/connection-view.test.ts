// Tests de la presentación PURA de la pantalla de conexión (RMV3.4/3.7/3.8/4.6). node:test, sin RN.
// Imports relativos con `.ts` (patrón de las suites ble: el `@/` alias no lo resuelve el loader de
// node:test). Cubre el mapeo estado→vista, binding→fila, y la marca "DEMO".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  connectionRowStatus,
  connectionStatusView,
  deviceRowView,
  pairedDevicesView,
  readingBadge,
  readsEmptyHint,
  toneColorToken,
  type PairedListState,
  type ViewTone,
} from './connection-view.ts';
import { RS420_DRIVER } from '../../services/ble/driver-rs420.ts';
import type { ReaderBinding } from '../../services/ble/selection-priority.ts';
import type { ConnectionStatus } from '../../services/ble/stick-adapter.ts';

// Los 6 estados del core (union completa de ConnectionStatus). Compartidos por las dos ramas de
// transporte (con y sin) para que ninguna quede probada sobre un subconjunto.
const ALL_STATES: ConnectionStatus[] = [
  'off',
  'permission_denied',
  'scanning',
  'connecting',
  'connected',
  'disconnected',
];

/** Entorno CON transporte instanciado (web-serial en web, mock en E2E, spp-android en Fase 4). */
const WITH_TRANSPORT = { hasTransport: true } as const;
/** Entorno SIN transporte (native manual-first hoy: instantiateTransport('manual') → null). */
const NO_TRANSPORT = { hasTransport: false } as const;

// ─── RMV3.4: cada ConnectionStatus tiene label/hint/cta es-AR, no bloqueante ────────────────

test('RMV3.4: connectionStatusView cubre los 6 estados con label + hint no vacíos', () => {
  for (const s of ALL_STATES) {
    const v = connectionStatusView(s, WITH_TRANSPORT);
    assert.ok(v.label.length > 0, `label vacío en ${s}`);
    assert.ok(v.hint.length > 0, `hint vacío en ${s}`);
    // El CTA es coherente con su label: 'none' ⇔ sin ctaLabel; los demás ⇔ con ctaLabel.
    if (v.cta === 'none') assert.equal(v.ctaLabel, null, `cta 'none' con label en ${s}`);
    else assert.ok(v.ctaLabel && v.ctaLabel.length > 0, `cta sin label en ${s}`);
  }
});

test('RMV3.4: connected → cta disconnect + connected true; off/disconnected → cta connect', () => {
  const connected = connectionStatusView('connected', WITH_TRANSPORT);
  assert.equal(connected.connected, true);
  assert.equal(connected.cta, 'disconnect');
  assert.equal(connected.tone, 'success');

  const off = connectionStatusView('off', WITH_TRANSPORT);
  assert.equal(off.connected, false);
  assert.equal(off.cta, 'connect');
  assert.equal(off.ctaLabel, 'Conectar bastón');

  const disconnected = connectionStatusView('disconnected', WITH_TRANSPORT);
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.cta, 'connect');
});

test('RMV3.4: permission_denied → retry; en progreso (connecting/scanning) → sin CTA', () => {
  assert.equal(connectionStatusView('permission_denied', WITH_TRANSPORT).cta, 'retry');
  assert.equal(connectionStatusView('connecting', WITH_TRANSPORT).cta, 'none');
  assert.equal(connectionStatusView('connecting', WITH_TRANSPORT).ctaLabel, null);
  assert.equal(connectionStatusView('scanning', WITH_TRANSPORT).cta, 'none');
});

// ─── BUGFIX 2026-07-29 (device Android de Raf): SIN TRANSPORTE, NUNCA se ofrece conectar ─────
// El botón "Conectar bastón" en native disparaba `transport.connect()` sobre un transporte null
// (no-op silencioso). La decisión vive en la función PURA: sin transporte, `cta: 'none'`.

test('sin transporte: NINGÚN estado ofrece un CTA (cta none + ctaLabel null en los 6)', () => {
  for (const s of ALL_STATES) {
    const v = connectionStatusView(s, NO_TRANSPORT);
    assert.equal(v.cta, 'none', `sin transporte, ${s} ofrece un CTA accionable`);
    assert.equal(v.ctaLabel, null, `sin transporte, ${s} trae ctaLabel`);
    assert.equal(v.connected, false, `sin transporte, ${s} se declara conectado`);
  }
});

test('sin transporte: el copy es honesto (no promete conectar) y ofrece la salida manual (RMV3.6)', () => {
  const v = connectionStatusView('off', NO_TRANSPORT);
  assert.ok(v.label.length > 0);
  assert.ok(v.hint.length > 0);
  // No promete conectar: ni el label ni el hint usan el imperativo "conectá"/"conectar".
  assert.doesNotMatch(v.label, /conect(á|ar)\b/i, `label promete conectar: "${v.label}"`);
  assert.doesNotMatch(v.hint, /conect(á|ar)\b/i, `hint promete conectar: "${v.hint}"`);
  // NO bloquea (RMV3.6): apunta a la carga manual.
  assert.match(v.hint, /mano/i);
  assert.equal(v.tone, 'idle');
});

test('sin transporte gana sobre el status: el "connected" transitorio tampoco ofrece desconectar', () => {
  // Caso de borde real: el transporte se desmonta en caliente (cambio de `mode` del provider) y el
  // status previo queda pegado un render. El corte va ANTES del switch, así que no hay CTA muerto.
  const v = connectionStatusView('connected', NO_TRANSPORT);
  assert.equal(v.cta, 'none');
  assert.equal(v.connected, false);
});

test('regresión web: CON transporte, los 6 estados quedan EXACTAMENTE como antes del bugfix', () => {
  // El fix no puede tocar web (ahí el transporte SIEMPRE existe: web-serial). Fijamos el mapeo.
  // El `icon` va acá porque el mapeo estado→ícono ES el que tenía el `statusIcon()` del componente
  // antes de mudarse a la vista pura: fijarlo es lo que garantiza que la mudanza no cambió nada.
  const expected: Record<
    ConnectionStatus,
    { label: string; cta: string; ctaLabel: string | null; icon: string }
  > = {
    connected: { label: 'Bastón conectado', cta: 'disconnect', ctaLabel: 'Desconectar', icon: 'bluetooth-connected' },
    connecting: { label: 'Conectando…', cta: 'none', ctaLabel: null, icon: 'bluetooth-searching' },
    scanning: { label: 'Reintentando…', cta: 'none', ctaLabel: null, icon: 'bluetooth-searching' },
    disconnected: { label: 'Bastón desconectado', cta: 'connect', ctaLabel: 'Volver a conectar', icon: 'bluetooth' },
    permission_denied: { label: 'Sin permiso', cta: 'retry', ctaLabel: 'Reintentar', icon: 'alert' },
    off: { label: 'Bastón sin conectar', cta: 'connect', ctaLabel: 'Conectar bastón', icon: 'bluetooth' },
  };
  for (const s of ALL_STATES) {
    const v = connectionStatusView(s, WITH_TRANSPORT);
    assert.equal(v.label, expected[s].label, `label cambió en ${s}`);
    assert.equal(v.cta, expected[s].cta, `cta cambió en ${s}`);
    assert.equal(v.ctaLabel, expected[s].ctaLabel, `ctaLabel cambió en ${s}`);
    assert.equal(v.icon, expected[s].icon, `ícono cambió en ${s}`);
  }
});

// El ícono era el ÚNICO elemento de la card que NO pasaba por la vista pura (el componente lo derivaba
// del status crudo con su propio `statusIcon()`), así que podía contradecir al label. Ahora sale de acá.
test('sin transporte: el ícono no puede contradecir al label ("Bastón no disponible")', () => {
  for (const s of ALL_STATES) {
    const v = connectionStatusView(s, NO_TRANSPORT);
    assert.equal(v.icon, 'bluetooth', `sin transporte, ${s} muestra un ícono que contradice el label`);
    assert.notEqual(v.icon, 'bluetooth-connected');
  }
});

// ─── RMV3.1: estado CORTO para la fila de acceso al bastón del tab "Más" ─────────────────────
// La fila existe para que el operario sepa si el bastón está conectado SIN entrar a la pantalla. El
// copy es de este archivo (no inline en `mas.tsx`) para que no pueda contradecir a la card.

/** Todas las combinaciones de entrada de la fila: 6 estados × {con, sin} transporte × {agotado, no}. */
const ROW_ENVS = [
  { hasTransport: true },
  { hasTransport: false },
  { hasTransport: true, autoConnectExhausted: true },
  { hasTransport: false, autoConnectExhausted: true },
] as const;

test('RMV3.1 fila: los 6 estados (× transporte) tienen texto no vacío y CORTO (cabe en un trailing)', () => {
  for (const env of ROW_ENVS) {
    for (const s of ALL_STATES) {
      const row = connectionRowStatus(s, env);
      assert.ok(row.text.length > 0, `texto vacío en ${s} / ${JSON.stringify(env)}`);
      // Techo duro: el trailing convive con el label "Bastón" + el chevron en un ancho de teléfono.
      // "Reintentando…" (13) es el más largo hoy; 16 deja aire sin permitir una frase.
      assert.ok(row.text.length <= 16, `texto demasiado largo para un trailing: "${row.text}" (${s})`);
    }
  }
});

test('RMV3.1 fila: el texto NO repite "Bastón" (la fila ya lo dice como label)', () => {
  for (const env of ROW_ENVS) {
    for (const s of ALL_STATES) {
      const { text } = connectionRowStatus(s, env);
      assert.doesNotMatch(text, /bast[oó]n/i, `el trailing repite el label de la fila: "${text}" (${s})`);
    }
  }
});

test('RMV3.1 fila: el TONO nunca contradice a la card de la pantalla (misma entrada → mismo tono)', () => {
  // El invariante que justifica que esta función viva en este archivo: si la fila derivara su tono por
  // su cuenta, podría pintarse de "conectado" (verde) mientras la pantalla dice "no disponible".
  for (const env of ROW_ENVS) {
    for (const s of ALL_STATES) {
      assert.equal(
        connectionRowStatus(s, env).tone,
        connectionStatusView(s, env).tone,
        `la fila y la card discrepan de tono en ${s} / ${JSON.stringify(env)}`,
      );
    }
  }
});

test('RMV3.1 fila: sin transporte, TODOS los estados dicen lo mismo (ni "Conectado" transitorio)', () => {
  for (const s of ALL_STATES) {
    const row = connectionRowStatus(s, NO_TRANSPORT);
    assert.equal(row.text, 'No disponible', `sin transporte, ${s} muestra otro estado`);
    assert.equal(row.tone, 'idle');
  }
});

test('RMV3.1 fila: con transporte, cada estado dice algo DISTINTO (la fila informa de verdad)', () => {
  const expected: Record<ConnectionStatus, string> = {
    connected: 'Conectado',
    connecting: 'Conectando…',
    scanning: 'Reintentando…',
    disconnected: 'Desconectado',
    permission_denied: 'Sin permiso',
    off: 'Sin conectar',
  };
  const seen = new Set<string>();
  for (const s of ALL_STATES) {
    const { text } = connectionRowStatus(s, WITH_TRANSPORT);
    assert.equal(text, expected[s], `texto inesperado en ${s}`);
    assert.equal(seen.has(text), false, `dos estados comparten el mismo texto: "${text}"`);
    seen.add(text);
  }
  assert.equal(connectionRowStatus('connected', WITH_TRANSPORT).tone, 'success');
});

test('R6.4 fila: el auto-connect agotado no dice "Sin conectar" (y solo afecta al estado off)', () => {
  const agotado = connectionRowStatus('off', { hasTransport: true, autoConnectExhausted: true });
  assert.equal(agotado.text, 'No encontrado');
  assert.notEqual(agotado.text, connectionRowStatus('off', WITH_TRANSPORT).text);
  // El flag NO puede resucitar nada sin transporte, ni tocar los otros estados.
  assert.equal(connectionRowStatus('off', { hasTransport: false, autoConnectExhausted: true }).text, 'No disponible');
  for (const s of ['connected', 'connecting', 'scanning', 'disconnected', 'permission_denied'] as const) {
    assert.deepEqual(
      connectionRowStatus(s, { hasTransport: true, autoConnectExhausted: true }),
      connectionRowStatus(s, WITH_TRANSPORT),
      `el flag no debería cambiar el estado '${s}'`,
    );
  }
});

// ─── toneColorToken: la traducción tono → token del DS, canónica y exhaustiva ─────────────────

test('toneColorToken: los 4 tonos mapean a un token del DS (nunca un color hardcodeado)', () => {
  const tones: ViewTone[] = ['idle', 'progress', 'success', 'warning'];
  for (const tone of tones) {
    const token = toneColorToken(tone);
    assert.match(token, /^\$[a-zA-Z]+$/, `"${token}" no es un token del DS (ADR-023 §4)`);
  }
  assert.equal(toneColorToken('success'), '$primary');
  assert.equal(toneColorToken('progress'), '$primary');
  assert.equal(toneColorToken('warning'), '$terracota');
  assert.equal(toneColorToken('idle'), '$textMuted');
});

// ─── RMV3.7: binding available true/false → fila conectable / no-disponible ──────────────────

/** Binding CONECTABLE del RS420 en web (web-serial construido). */
const AVAILABLE_BINDING: ReaderBinding = {
  adapterKind: 'web-serial',
  transportKind: 'serial',
  driver: RS420_DRIVER,
  available: true,
};

test('RMV3.7: binding available:true (+ transporte) → fila conectable (actionable), con la marca del driver', () => {
  const row = deviceRowView({ driver: RS420_DRIVER, binding: AVAILABLE_BINDING, hasTransport: true });
  assert.equal(row.state, 'recognized-available');
  assert.equal(row.actionable, true);
  assert.equal(row.title, RS420_DRIVER.displayName);
});

test('RMV3.7: binding available:false → reconocido, NO disponible, NO accionable (no intenta conectar)', () => {
  const binding: ReaderBinding = {
    adapterKind: 'spp-android',
    transportKind: 'spp',
    driver: RS420_DRIVER,
    available: false,
  };
  const row = deviceRowView({ driver: RS420_DRIVER, binding, hasTransport: true });
  assert.equal(row.state, 'recognized-unavailable');
  assert.equal(row.actionable, false);
  // Ofrece la salida manual (no bloquea, RMV3.6).
  assert.match(row.subtitle, /mano/i);
});

// BUGFIX 2026-07-29: el binding es capacidad de BUILD, el transporte es "hay un adapter instanciado".
// Sin transporte, tocar la fila llamaría `transport?.connect()` sobre null → afordancia muerta.
test('sin transporte: un binding available:true NO deja la fila accionable (afordancia muerta)', () => {
  const row = deviceRowView({ driver: RS420_DRIVER, binding: AVAILABLE_BINDING, hasTransport: false });
  assert.equal(row.actionable, false, 'la fila ofrece conectar sin transporte instanciado');
  assert.equal(row.state, 'recognized-unavailable');
  // El subtitle NO invita a tocar para conectar; apunta a la salida manual (RMV3.6).
  assert.doesNotMatch(row.subtitle, /tocá para conectar/i);
  assert.match(row.subtitle, /mano/i);
});

// ─── RMV2.5: reconocido pero sin transporte alcanzable en la plataforma (RS420 en iOS) ───────

test('RMV2.5: driver reconocido pero binding null → recognized-unreachable + manual (no bloquea)', () => {
  const row = deviceRowView({ driver: RS420_DRIVER, binding: null, hasTransport: true });
  assert.equal(row.state, 'recognized-unreachable');
  assert.equal(row.actionable, false);
  assert.match(row.subtitle, /mano/i);
});

// ─── RMV3.8: device sin driver → "no reconocido" + manual ────────────────────────────────────

test('RMV3.8: sin driver ni binding → unrecognized, usa el nombre del device y ofrece manual', () => {
  const row = deviceRowView({ driver: null, binding: null, deviceName: 'Speaker XZ', hasTransport: true });
  assert.equal(row.state, 'unrecognized');
  assert.equal(row.actionable, false);
  assert.equal(row.title, 'Speaker XZ');
  assert.match(row.subtitle, /reconocido/i);
  assert.match(row.subtitle, /mano/i);
});

test('RMV3.8: unrecognized sin nombre → título de fallback (no vacío)', () => {
  const row = deviceRowView({ driver: null, binding: null, hasTransport: true });
  assert.equal(row.state, 'unrecognized');
  assert.ok(row.title.length > 0);
});

test('NINGÚN estado de fila es accionable sin transporte (invariante, las 4 combinaciones)', () => {
  const rows = [
    deviceRowView({ driver: RS420_DRIVER, binding: AVAILABLE_BINDING, hasTransport: false }),
    deviceRowView({
      driver: RS420_DRIVER,
      binding: { ...AVAILABLE_BINDING, available: false },
      hasTransport: false,
    }),
    deviceRowView({ driver: RS420_DRIVER, binding: null, hasTransport: false }),
    deviceRowView({ driver: null, binding: null, deviceName: 'Speaker XZ', hasTransport: false }),
  ];
  for (const row of rows) {
    assert.equal(row.actionable, false, `fila accionable sin transporte: ${row.state}`);
  }
});

// ─── unrecognized-connectable: la lista de EMPAREJADOS reales deja probar un device desconocido ──

test('allowUnrecognized: un emparejado sin driver se puede PROBAR (el nombre BT del RS420 es hipótesis)', () => {
  const row = deviceRowView({
    driver: null,
    binding: null,
    deviceName: 'SPP-CA',
    hasTransport: true,
    allowUnrecognized: true,
  });
  assert.equal(row.state, 'unrecognized-connectable');
  assert.equal(row.actionable, true);
  assert.equal(row.title, 'SPP-CA');
  assert.match(row.subtitle, /probar/i);
});

test('allowUnrecognized es OPT-IN: sin el flag, RMV3.8 sigue igual (no accionable)', () => {
  const row = deviceRowView({ driver: null, binding: null, deviceName: 'Speaker XZ', hasTransport: true });
  assert.equal(row.state, 'unrecognized');
  assert.equal(row.actionable, false);
});

test('allowUnrecognized NO puede saltear el invariante de "sin transporte no hay tap"', () => {
  const row = deviceRowView({
    driver: null,
    binding: null,
    deviceName: 'Speaker XZ',
    hasTransport: false,
    allowUnrecognized: true,
  });
  assert.equal(row.state, 'unrecognized');
  assert.equal(row.actionable, false);
});

test('allowUnrecognized sin nombre → título de fallback no vacío', () => {
  const row = deviceRowView({ driver: null, binding: null, hasTransport: true, allowUnrecognized: true });
  assert.ok(row.title.length > 0);
  assert.equal(row.actionable, true);
});

// ─── pairedDevicesView: copy de la lista de emparejados (camino SPP-Android) ──────────────────

const ALL_PAIRED_STATES: PairedListState[] = [
  'idle',
  'loading',
  'ok',
  'empty',
  'permission_denied',
  'bluetooth_off',
  'unavailable',
  'error',
];

test('pairedDevicesView: los 8 estados tienen hint no vacío', () => {
  for (const s of ALL_PAIRED_STATES) {
    assert.ok(pairedDevicesView(s).hint.length > 0, `hint vacío en ${s}`);
  }
});

test('pairedDevicesView: mientras carga no hay botón; los estados accionables sí lo tienen', () => {
  assert.equal(pairedDevicesView('loading').ctaLabel, null);
  assert.equal(pairedDevicesView('unavailable').ctaLabel, null); // no hay nada que reintentar
  for (const s of ['idle', 'ok', 'empty', 'permission_denied', 'bluetooth_off', 'error'] as const) {
    assert.ok((pairedDevicesView(s).ctaLabel ?? '').length > 0, `sin CTA en ${s}`);
  }
});

test('pairedDevicesView: el copy habla de EMPAREJAR, no de escanear (este camino no hace discovery)', () => {
  for (const s of ['idle', 'ok', 'empty'] as const) {
    const hint = pairedDevicesView(s).hint;
    // `/emparej/` y no `/empareja/`: el voseo escribe "Emparejá" con tilde.
    assert.match(hint, /emparej/i, `el copy de ${s} no menciona emparejar: "${hint}"`);
    assert.doesNotMatch(hint, /escane/i, `el copy de ${s} promete un escaneo que no existe: "${hint}"`);
  }
});

test('pairedDevicesView: el estado sin bastón alcanzable ofrece la salida manual', () => {
  assert.match(pairedDevicesView('unavailable').hint, /mano/i);
  assert.match(pairedDevicesView('permission_denied').hint, /mano/i);
  assert.match(pairedDevicesView('error').hint, /manual/i);
});

test('pairedDevicesView: el PIN de emparejamiento del RS420 aparece en el copy (1234)', () => {
  // Es el dato que el operario necesita para emparejarlo en los ajustes de Android; si no está en
  // la pantalla, no está en ningún lado (no hay manual dentro de la app).
  assert.match(pairedDevicesView('idle').hint, /1234/);
  assert.match(pairedDevicesView('empty').hint, /1234/);
});

// ─── RMV4.6: lectura del simulador → marca "DEMO"; lectura real → sin marca ───────────────────

test('RMV4.6: readingBadge marca "DEMO" solo las lecturas del simulador', () => {
  assert.equal(readingBadge(true), 'DEMO');
  assert.equal(readingBadge(false), null);
});

// ─── Estado VACÍO de la lista de lecturas: tampoco promete conectar sin transporte ───────────

test('readsEmptyHint: sin transporte NO dice "conectá el bastón" y apunta a la carga manual', () => {
  const sin = readsEmptyHint(false);
  assert.doesNotMatch(sin, /conect(á|ar)\b/i, `el vacío promete conectar: "${sin}"`);
  assert.match(sin, /mano/i);

  // Con transporte, el copy original: conectar SÍ es la acción correcta.
  const con = readsEmptyHint(true);
  assert.match(con, /Conectá el bastón/);
  assert.notEqual(con, sin);
});

// ─── R6.4: el arranque intentó y se le agotó el tope (copy honesto, sin gritarle a nadie) ────

test('R6.4: con el auto-connect AGOTADO el copy no puede sonar a "nunca se intentó"', () => {
  const virgen = connectionStatusView('off', { hasTransport: true });
  const agotado = connectionStatusView('off', { hasTransport: true, autoConnectExhausted: true });

  // El estado es el MISMO ('off': no conectado y sin estar intentando) — lo que cambia es lo que se
  // dice. Sin esto, el operario que va a la pantalla a ver por qué el bastón no está lee "Conectá el
  // bastón", que sugiere que la app no hizo nada, cuando estuvo dos minutos buscándolo.
  assert.notEqual(agotado.label, virgen.label);
  assert.notEqual(agotado.hint, virgen.hint);
  assert.match(agotado.label, /No encontramos/i);
  assert.match(agotado.hint, /apagado|fuera de rango/i);
});

test('R6.4: el estado agotado SIEMPRE ofrece un CTA (era la trampa de `scanning`)', () => {
  // `scanning` devuelve `cta:'none'`: la app quedaba reintentando para siempre y sin botón. El estado
  // final del tope tiene que ser accionable, y su tap arranca una cadena SIN tope (eso lo garantiza el
  // adapter: `connect()` = trigger 'operator').
  const agotado = connectionStatusView('off', { hasTransport: true, autoConnectExhausted: true });
  assert.equal(agotado.cta, 'connect');
  assert.ok(agotado.ctaLabel != null && agotado.ctaLabel.length > 0);
  assert.equal(connectionStatusView('scanning', { hasTransport: true }).cta, 'none');
});

test('R6.4: el estado agotado NO dramatiza (tone idle) y sigue ofreciendo la carga manual', () => {
  // No se le grita a alguien que no pidió nada: el bastón apagado es el caso más probable, no una falla.
  const agotado = connectionStatusView('off', { hasTransport: true, autoConnectExhausted: true });
  assert.equal(agotado.tone, 'idle');
  assert.equal(agotado.connected, false);
  assert.match(agotado.hint, /mano/i, 'manual-first: la salida manual siempre a la vista (RMV3.6)');
});

test('R6.4: el flag NO puede resucitar un CTA donde no hay transporte, ni tocar otros estados', () => {
  // El corte por `hasTransport` va antes de todo: sin transporte no se ofrece conectar nada, agotado o
  // no. Y el flag solo aplica al estado 'off' (los demás describen otra cosa).
  const sinTransporte = connectionStatusView('off', { hasTransport: false, autoConnectExhausted: true });
  assert.equal(sinTransporte.cta, 'none');
  assert.match(sinTransporte.label, /no disponible/i);

  for (const s of ['connected', 'connecting', 'scanning', 'disconnected', 'permission_denied'] as const) {
    assert.deepEqual(
      connectionStatusView(s, { hasTransport: true, autoConnectExhausted: true }),
      connectionStatusView(s, { hasTransport: true }),
      `el flag no debería cambiar el estado '${s}'`,
    );
  }
});
