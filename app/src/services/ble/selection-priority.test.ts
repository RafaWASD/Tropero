// Tests del MOTOR DE SELECCIÓN POR CAPACIDAD (RMV2) + regresión de selectTransportAdapter
// (RMV2.7) + confirmación de arquitectura MFi (RMV6.1/6.2). node:test, PURO (todo inyectado, sin
// device). Casos clave del design §4:
//   - RS420 android → {spp-android, spp}; web → {web-serial, serial, available:true}
//   - RS420 iOS → null  (declara solo spp+serial; en iOS ninguno tiene adapter mapeado → manual)
//   - driver HID genérico en iOS/android → {hid-wedge, ble-hid, available:false}
//   - ambigüedad SPP+HID en android → spp gana determinístico
//   - driver mfi-only → adapter null → binding null (arch-ready, RMV6.1/6.2)
//   - available reflejado desde builtAdapters inyectado
// + regresión: selectTransportAdapter(auto/mock/manual) idéntico al as-built.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  platformTransportPriority,
  adapterForTransport,
  selectReaderBinding,
  type BindingEnv,
} from './selection-priority.ts';
import { selectTransportAdapter } from './adapter-selection.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { parseRs420Line } from './parser-rs420.ts';
import type { ReaderDriver } from './driver-types.ts';

// Drivers sintéticos para probar los transportes que el RS420 NO declara.
const HID_DRIVER: ReaderDriver = {
  vendorId: 'generic-hid',
  displayName: 'Generic HID Reader',
  transports: [{ kind: 'ble-hid', params: {} }],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /hid/i },
  streaming: false,
};
const SPP_AND_HID_DRIVER: ReaderDriver = {
  vendorId: 'dual-spp-hid',
  displayName: 'Dual SPP+HID Reader',
  transports: [
    { kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '1234' } },
    { kind: 'ble-hid', params: {} },
  ],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /dual/i },
  streaming: true,
};
const MFI_ONLY_DRIVER: ReaderDriver = {
  vendorId: 'mfi-only',
  displayName: 'MFi-only Reader',
  transports: [{ kind: 'mfi', params: { protocolString: 'com.example.reader' } }],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /mfi/i },
  streaming: true,
};

const ALL_BUILT = ['manual', 'mock', 'web-serial', 'spp-android', 'hid-wedge', 'simulator'] as const;

function env(platformOS: string, driver: ReaderDriver, builtAdapters: readonly string[] = ALL_BUILT): BindingEnv {
  return { platformOS, driver, builtAdapters: [...builtAdapters] as BindingEnv['builtAdapters'] };
}

// ─── RMV2.1: tabla de prioridad por plataforma, determinística ──────────────────────────────

test('RMV2.1: platformTransportPriority por plataforma (ios HID>GATT>MFi; android SPP>GATT>HID; web serial)', () => {
  assert.deepEqual(platformTransportPriority('ios'), ['ble-hid', 'ble-gatt', 'mfi']);
  assert.deepEqual(platformTransportPriority('android'), ['spp', 'ble-gatt', 'ble-hid']);
  assert.deepEqual(platformTransportPriority('web'), ['serial']);
  assert.deepEqual(platformTransportPriority('otro'), []);
});

// ─── RMV2.2 / RMV6.2 / RMV6.3: mapeo transporte → AdapterKind ────────────────────────────────

test('RMV2.2: adapterForTransport mapea spp+android→spp-android, serial+web→web-serial, ble-hid→hid-wedge', () => {
  assert.equal(adapterForTransport('spp', 'android'), 'spp-android');
  assert.equal(adapterForTransport('spp', 'ios'), null); // no hay SPP adapter en iOS
  assert.equal(adapterForTransport('serial', 'web'), 'web-serial');
  assert.equal(adapterForTransport('serial', 'android'), null);
  assert.equal(adapterForTransport('ble-hid', 'ios'), 'hid-wedge');
  assert.equal(adapterForTransport('ble-hid', 'android'), 'hid-wedge');
});

test('RMV6.2/6.3: ble-gatt y mfi no tienen adapter buildable (null)', () => {
  assert.equal(adapterForTransport('ble-gatt', 'ios'), null);
  assert.equal(adapterForTransport('mfi', 'ios'), null);
});

// ─── RMV2.3/2.4: selectReaderBinding elige el transporte de mayor prioridad + available ──────

test('RMV2.3/2.4: RS420 en android → {spp-android, spp}; available desde builtAdapters', () => {
  const built = selectReaderBinding(env('android', RS420_DRIVER, ALL_BUILT));
  assert.deepEqual(built, { adapterKind: 'spp-android', transportKind: 'spp', driver: RS420_DRIVER, available: true });
  // Sin el spp-android construido (sin dev build) → available:false, mismo binding (RMV2.4/RMV3.7).
  const notBuilt = selectReaderBinding(env('android', RS420_DRIVER, ['manual', 'mock', 'web-serial']));
  assert.deepEqual(notBuilt, {
    adapterKind: 'spp-android',
    transportKind: 'spp',
    driver: RS420_DRIVER,
    available: false,
  });
});

test('RMV2.3: RS420 en web → {web-serial, serial, available:true}', () => {
  const b = selectReaderBinding(env('web', RS420_DRIVER, ALL_BUILT));
  assert.deepEqual(b, { adapterKind: 'web-serial', transportKind: 'serial', driver: RS420_DRIVER, available: true });
});

// ─── RMV2.5: RS420 en iOS → null (declara solo spp+serial; ninguno mapeado en iOS) ──────────

test('RMV2.5: RS420 en iOS → null (spp/serial sin adapter en iOS → no alcanzable → carga manual)', () => {
  assert.equal(selectReaderBinding(env('ios', RS420_DRIVER, ALL_BUILT)), null);
});

// ─── RMV2.2/2.4: driver HID genérico → hid-wedge, GATED (available:false) ────────────────────

test('RMV2.2/2.4: driver HID genérico en iOS → {hid-wedge, ble-hid, available:false} (HID gated)', () => {
  // hid-wedge NO está en builtAdapters (GATED en el core R8.7) → available:false.
  const built = ['manual', 'mock', 'web-serial', 'spp-android', 'simulator'];
  assert.deepEqual(selectReaderBinding(env('ios', HID_DRIVER, built)), {
    adapterKind: 'hid-wedge',
    transportKind: 'ble-hid',
    driver: HID_DRIVER,
    available: false,
  });
});

test('RMV2.2/2.4: driver solo-HID en android → {hid-wedge, ble-hid, available:false}', () => {
  const built = ['manual', 'mock', 'web-serial', 'spp-android', 'simulator'];
  assert.deepEqual(selectReaderBinding(env('android', HID_DRIVER, built)), {
    adapterKind: 'hid-wedge',
    transportKind: 'ble-hid',
    driver: HID_DRIVER,
    available: false,
  });
});

// ─── RMV2.8: ambigüedad (device alcanzable por >1 vía) → prioridad determinística ───────────

test('RMV2.8: driver SPP+HID en android → spp gana (prioridad determinística, no orden de descubrimiento)', () => {
  const b = selectReaderBinding(env('android', SPP_AND_HID_DRIVER, ALL_BUILT));
  assert.equal(b?.transportKind, 'spp');
  assert.equal(b?.adapterKind, 'spp-android');
});

test('RMV2.8: el MISMO driver SPP+HID en iOS → HID (spp no mapea en iOS) — determinístico por plataforma', () => {
  const built = ['manual', 'mock', 'web-serial', 'spp-android', 'simulator'];
  const b = selectReaderBinding(env('ios', SPP_AND_HID_DRIVER, built));
  assert.equal(b?.transportKind, 'ble-hid');
  assert.equal(b?.adapterKind, 'hid-wedge');
  assert.equal(b?.available, false);
});

// ─── RMV2.5: driver sin transporte alcanzable en la plataforma → null ───────────────────────

test('RMV2.5: driver SPP-only en web → null (web solo tiene serial); en iOS → null', () => {
  const SPP_ONLY: ReaderDriver = {
    ...RS420_DRIVER,
    transports: [{ kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '1234' } }],
  };
  assert.equal(selectReaderBinding(env('web', SPP_ONLY, ALL_BUILT)), null);
  assert.equal(selectReaderBinding(env('ios', SPP_ONLY, ALL_BUILT)), null);
});

// ─── RMV6.1/6.2: arquitectura MFi declarable pero sin adapter buildable → binding null ──────

test('RMV6.1/6.2: driver mfi-only en iOS → adapter null → binding null (arch-ready, adapter EA gated)', () => {
  // El driver declara transportKind:'mfi' con protocolString (RMV6.1) — arquitectura preparada —
  // pero adapterForTransport('mfi') es null (RMV6.2) → no alcanzable → manual como piso.
  assert.equal(selectReaderBinding(env('ios', MFI_ONLY_DRIVER, ALL_BUILT)), null);
  const mfi = MFI_ONLY_DRIVER.transports.find((t) => t.kind === 'mfi');
  assert.ok(mfi && mfi.kind === 'mfi');
  assert.equal(mfi.params.protocolString, 'com.example.reader'); // el campo existe y se declara
});

// ─── RMV2.6: determinismo — dos runs con las mismas entradas dan el mismo binding ───────────

test('RMV2.6: selectReaderBinding es determinístico (mismas entradas → mismo binding)', () => {
  const a = selectReaderBinding(env('android', RS420_DRIVER, ALL_BUILT));
  const b = selectReaderBinding(env('android', RS420_DRIVER, ALL_BUILT));
  assert.deepEqual(a, b);
});

// ─── RMV2.7: REGRESIÓN — selectTransportAdapter idéntico al as-built para auto/mock/manual ───

test('RMV2.7 regresión: selectTransportAdapter(auto/mock/manual) devuelve EXACTAMENTE lo de antes del delta', () => {
  // web
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'auto' }), 'web-serial');
  // mock en cualquier plataforma
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'mock' }), 'mock');
  // manual
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'manual' }), 'manual');
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'manual' }), 'manual');
  // auto en iOS → manual (sin transporte alcanzable: la vía del RS420 en iOS es MFi, gate externo)
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'auto' }), 'manual');
  // auto en Android → spp-android (Fase 4 construida 2026-07-29; ANTES devolvía 'manual').
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'auto' }), 'spp-android');
});

test('RMV4.3 (triple-guard 1): selectTransportAdapter NUNCA devuelve simulator salvo mode=demo', () => {
  for (const platformOS of ['web', 'ios', 'android', 'otro']) {
    for (const mode of ['auto', 'mock', 'manual'] as const) {
      assert.notEqual(selectTransportAdapter({ platformOS, mode }), 'simulator');
    }
    // solo mode='demo' → 'simulator'
    assert.equal(selectTransportAdapter({ platformOS, mode: 'demo' }), 'simulator');
  }
});
