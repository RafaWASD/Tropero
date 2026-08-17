// Tests del FORMATO del bastón recordado (RBM5.6/RBM5.7, delta ios-ble-mfi T4.5). node:test, PURO.
//
// Lo que hay que fijar acá no es "serializa y parsea": es que **un teléfono con el formato viejo
// guardado no se quede sin bastón** (RBM5.7) y que **una preferencia de transporte solo salga de un
// registro que la declara de verdad** (RBM5.6). Las dos mitades tienen un mundo malo concreto:
//   · si el viejo se leyera como "no hay nada", cada operario con un bastón emparejado tendría que
//     volver a elegirlo — en la manga, con el animal en el brete;
//   · si un `adapterKind` cualquiera del storage se aceptara, un valor manoseado (o de una versión más
//     nueva) elegiría qué transporte monta la app.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRememberedValue,
  rememberedDeviceIdFor,
  serializeRememberedValue,
} from './remembered-format.ts';
import { ADAPTER_KINDS } from './adapter-selection.ts';

const MAC = '11:22:33:44:55:66';

// ─── RBM5.7: el formato VIEJO (string pelado) se lee como "sin preferencia", sin romper ─────────────

test('RBM5.7: un valor VIEJO (el id pelado) sigue dando el device, SIN preferencia de transporte', () => {
  const rec = parseRememberedValue(MAC);
  assert.deepEqual(rec, { deviceId: MAC });
  // La mitad que importa: no hay `adapterKind`, así que la selección cae al piso por plataforma.
  assert.equal(rec?.adapterKind, undefined);
});

test('RBM5.7: un id viejo que ES JSON válido pero NO un objeto también se lee como formato viejo', () => {
  // El discriminante NO puede ser "¿JSON.parse tiró?": un id de solo dígitos parsea como NÚMERO y uno
  // que diga `true` como BOOLEANO. Si el discriminante fuera el throw, esos dos ids se perderían — y un
  // id numérico es exactamente lo que devuelve un puerto/serial, no una hipótesis.
  assert.deepEqual(parseRememberedValue('12345'), { deviceId: '12345' });
  assert.deepEqual(parseRememberedValue('1.5'), { deviceId: '1.5' });
  assert.deepEqual(parseRememberedValue('true'), { deviceId: 'true' });
  assert.deepEqual(parseRememberedValue('null'), { deviceId: 'null' });
  assert.deepEqual(parseRememberedValue('[1,2]'), { deviceId: '[1,2]' }); // array ≠ registro
});

test('sin valor guardado → null (y el string vacío también: no hay device con el que reconectar)', () => {
  assert.equal(parseRememberedValue(null), null);
  assert.equal(parseRememberedValue(undefined), null);
  assert.equal(parseRememberedValue(''), null);
});

// ─── RBM5.6: el formato NUEVO lleva la preferencia de transporte ────────────────────────────────────

test('RBM5.6: round-trip completo — lo que escribe el adapter es lo que lee el provider', () => {
  const value = serializeRememberedValue(MAC, { adapterKind: 'ble-gatt' });
  assert.ok(value !== null);
  assert.deepEqual(parseRememberedValue(value), { deviceId: MAC, adapterKind: 'ble-gatt' });
});

test('RBM5.6: el round-trip es IDEMPOTENTE y no crece con claves fantasma', () => {
  const once = serializeRememberedValue(MAC, { adapterKind: 'spp-android', vendorId: 'allflex-rs420' });
  assert.ok(once !== null);
  const rec = parseRememberedValue(once);
  assert.deepEqual(rec, { deviceId: MAC, adapterKind: 'spp-android', vendorId: 'allflex-rs420' });
  // Volver a serializar lo leído da EXACTAMENTE el mismo valor: si `parse` inventara un `vendorId:
  // undefined` o `serialize` escribiera nulls, esto divergiría.
  assert.equal(serializeRememberedValue(rec!.deviceId, rec!), once);
});

test('sin meta, el registro nuevo NO declara preferencia (un escritor que no la sabe no la inventa)', () => {
  const value = serializeRememberedValue(MAC);
  assert.equal(value, JSON.stringify({ deviceId: MAC }));
  assert.deepEqual(parseRememberedValue(value!), { deviceId: MAC });
});

// ─── FAIL-CLOSED: qué se descarta al leer ──────────────────────────────────────────────────────────

test('un `adapterKind` que este build NO conoce se DESCARTA y el device se conserva', () => {
  // Mundo malo: un registro escrito por una versión más nueva (o un storage manoseado) diciendo un kind
  // que acá no existe. Aceptarlo sería dejar que un dato de storage elija el transporte; tirar el
  // registro entero sería costarle el bastón al operario por un campo que no entendemos.
  const raw = JSON.stringify({ deviceId: MAC, adapterKind: 'transporte-del-futuro' });
  assert.deepEqual(parseRememberedValue(raw), { deviceId: MAC });
});

test('todo miembro de ADAPTER_KINDS sí se acepta (el filtro no está de adorno ni es una allowlist vieja)', () => {
  // Contraprueba del test de arriba: si `asAdapterKind` estuviera comparando contra una lista
  // desactualizada —o siempre devolviera undefined— el test del kind desconocido pasaría igual y la
  // preferencia NUNCA se leería. Recorre la lista canónica, así un kind nuevo entra solo.
  assert.ok(ADAPTER_KINDS.length >= 7, 'la lista canónica se quedó corta: ¿se rompió el import?');
  for (const kind of ADAPTER_KINDS) {
    const raw = JSON.stringify({ deviceId: MAC, adapterKind: kind });
    assert.deepEqual(
      parseRememberedValue(raw),
      { deviceId: MAC, adapterKind: kind },
      `el kind '${kind}' no sobrevivió el parseo`,
    );
  }
});

test('un registro sin `deviceId` usable → null (no sirve para reconectar)', () => {
  for (const raw of [
    JSON.stringify({ adapterKind: 'ble-gatt' }),
    JSON.stringify({ deviceId: '' }),
    JSON.stringify({ deviceId: '   ' }),
    JSON.stringify({ deviceId: 42 }),
    JSON.stringify({ deviceId: null, adapterKind: 'ble-gatt' }),
  ]) {
    assert.equal(parseRememberedValue(raw), null, `debería descartarse: ${raw}`);
  }
});

test('un `vendorId` que no es string se descarta sin llevarse el resto', () => {
  const raw = JSON.stringify({ deviceId: MAC, vendorId: 7, adapterKind: 'ble-gatt' });
  assert.deepEqual(parseRememberedValue(raw), { deviceId: MAC, adapterKind: 'ble-gatt' });
});

// ─── El saneado, y por qué es lo que hace SEGURA la discriminación de formatos ──────────────────────

test('el id se SANEA al escribir: un id con forma de JSON no puede inyectar una preferencia', () => {
  // El `deviceId` no lo escribimos nosotros: viene del SO (una MAC en Android, un UUID en iOS) y, en el
  // camino SPP, de la lista de emparejados —donde la fila deja tocar CUALQUIER device a propósito—. Si
  // no se saneara, un nombre/id hostil podría cerrar el JSON y agregar `"adapterKind":"hid-wedge"`, o
  // sea elegir el transporte que la app monta desde un dato de afuera.
  const hostil = '{"deviceId":"X","adapterKind":"hid-wedge"}';
  const value = serializeRememberedValue(hostil);
  assert.ok(value !== null);
  const rec = parseRememberedValue(value);
  assert.equal(rec?.adapterKind, undefined, 'la inyección no puede producir una preferencia');
  assert.equal(/["{}]/.test(rec!.deviceId), false, 'el id guardado no conserva comillas ni llaves');
});

test('el saneado del id es el MISMO charset de antes del delta (un id ya guardado se re-escribe igual)', () => {
  // La clave de storage NO se renombra (auditoría `rafq.*`) y el charset tampoco: si el saneado cambiara,
  // un id ya guardado se reescribiría distinto y la reconexión apuntaría a otro string.
  assert.equal(parseRememberedValue(serializeRememberedValue(MAC)!)?.deviceId, MAC, 'una MAC sobrevive intacta');
  assert.equal(
    parseRememberedValue(serializeRememberedValue('AA_bb.cc-11:22')!)?.deviceId,
    'AA_bb.cc-11:22',
    'los caracteres permitidos ([A-Za-z0-9._:-]) no se tocan',
  );
  assert.equal(
    parseRememberedValue(serializeRememberedValue('a b/c')!)?.deviceId,
    'a_b_c',
    'los prohibidos se reemplazan por _ (igual que el `safe()` de antes)',
  );
});

test('un id que no sobrevive el saneado no se guarda (no hay registro vacío)', () => {
  assert.equal(serializeRememberedValue(''), null);
  assert.equal(serializeRememberedValue('   '), null);
});

// ─── 🟠-2 del review de F4: el id recordado es de UN transporte, y no se presta ─────────────────────
//
// Mientras el transporte montado lo decidía el propio registro (RBM5.6), el id y el `adapterKind` no
// podían divergir: el que dialaba el id era siempre el que lo había escrito. Desde que el operario puede
// ELEGIR el transporte por gesto (`transportChoices`), sí pueden — y el mundo malo no es un error visible:
// abrir un RFCOMM contra un device que solo anuncia GATT (o `connectToDevice()` contra una MAC de Classic)
// **se queda esperando**, que es el síntoma más caro de esta unidad.

test('🟠-2: cada transporte solo usa el id que ÉL recordó (un registro del otro no se dialla)', () => {
  const ble = { deviceId: 'DE:AD:BE:EF:00:01', adapterKind: 'ble-gatt' } as const;
  const spp = { deviceId: MAC, adapterKind: 'spp-android' } as const;
  assert.equal(rememberedDeviceIdFor(ble, 'ble-gatt', { acceptsLegacy: false }), ble.deviceId);
  assert.equal(rememberedDeviceIdFor(spp, 'spp-android', { acceptsLegacy: true }), spp.deviceId);
  // Cruzados: `null` = "no tengo device previo" → el transporte ESCANEA / pide elegir, que es lo correcto.
  assert.equal(rememberedDeviceIdFor(spp, 'ble-gatt', { acceptsLegacy: false }), null);
  assert.equal(rememberedDeviceIdFor(ble, 'spp-android', { acceptsLegacy: true }), null);
});

test('RBM5.7/🟠-2: el formato VIEJO lo acepta SOLO el SPP (era su único escritor)', () => {
  // Un registro sin `adapterKind` es el formato viejo, y antes de este delta el único escritor era el SPP
  // (en Android, la única plataforma donde corre). Negárselo le costaría el bastón recordado a todo
  // teléfono ya instalado — que es exactamente lo que RBM5.7 vino a evitar.
  const viejo = parseRememberedValue(MAC);
  assert.deepEqual(viejo, { deviceId: MAC });
  assert.equal(rememberedDeviceIdFor(viejo, 'spp-android', { acceptsLegacy: true }), MAC);
  // Y el BLE NO lo acepta: sería dialar una MAC de Bluetooth Classic desde el transporte equivocado, o sea
  // el mismo bug entrando por la puerta de la compatibilidad.
  assert.equal(rememberedDeviceIdFor(viejo, 'ble-gatt', { acceptsLegacy: false }), null);
});

test('🟠-2: sin registro no hay id (y el `null` no se convierte en un id vacío)', () => {
  assert.equal(rememberedDeviceIdFor(null, 'ble-gatt', { acceptsLegacy: false }), null);
  assert.equal(rememberedDeviceIdFor(null, 'spp-android', { acceptsLegacy: true }), null);
});

test('🟠-2: el filtro es EXHAUSTIVO sobre `AdapterKind` — ningún kind ajeno se cuela', () => {
  // Recorre TODO el union como "kind que pregunta" contra un registro de `ble-gatt`: solo uno tiene que
  // recibir el id. Sin esto, el test viviría de los dos kinds que importan hoy y un kind nuevo (F5:
  // `mfi-ios`) heredaría el id del BLE sin que nada se pusiera rojo.
  const ble = { deviceId: 'DE:AD:BE:EF:00:01', adapterKind: 'ble-gatt' } as const;
  const aceptaron = ADAPTER_KINDS.filter(
    (kind) => rememberedDeviceIdFor(ble, kind, { acceptsLegacy: true }) !== null,
  );
  assert.deepEqual(aceptaron, ['ble-gatt']);
});
