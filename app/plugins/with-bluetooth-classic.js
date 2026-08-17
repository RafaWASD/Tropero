// Config plugin de Expo para el bastón Bluetooth Classic (RMV5.8).
//
// POR QUÉ EXISTE: `react-native-bluetooth-classic` NO trae config plugin (se verificó el contenido
// del paquete publicado: no hay `app.plugin.js`). En un repo CNG —`app/android` es artefacto, todo
// sale de `app.config.ts`— eso significa que sin este archivo no hay dónde declarar la política de
// permisos Bluetooth de la app. El `android.permissions` de `app.config.ts` tampoco sirve: es una
// lista de nombres y los permisos Bluetooth necesitan ATRIBUTOS (`maxSdkVersion`,
// `usesPermissionFlags="neverForLocation"`, `tools:node`).
//
// QUÉ HACE, y la parte importante — QUÉ SACA:
// La librería declara en SU manifiesto `ACCESS_FINE_LOCATION` SIN tope de API (verificado en
// `node_modules/react-native-bluetooth-classic/android/src/main/AndroidManifest.xml`), y el manifest
// merger lo mete en el APK. Dejarlo entrar sin tope sería pedir permiso de UBICACIÓN en Android 12+,
// donde la app NO lo necesita: ruido en la ficha de Play, superficie de permisos de más y una pregunta
// incómoda en la revisión. Se lo topea a `maxSdkVersion=30` con `tools:node="replace"` (el `replace` es
// lo que hace la decisión DETERMINÍSTICA en vez de depender de cómo el merger resuelva atributos entre
// dos declaraciones).
//
// El resto se declara explícito acá aunque la lib también lo declare: el manifiesto de la app es
// donde se lee la política, y así no depende de que una versión futura de la lib no la cambie.
//
// ── RECONCILIACIÓN 2026-08-17 (delta `ios-ble-mfi`, F2 / RBM7.6) ─────────────────────────────────────
// Este archivo decía dos cosas que dejaron de ser ciertas con el transporte `ble-gatt`, y conviene que
// quede escrito el porqué en vez de sólo el qué:
//
//  1. **`BLUETOOTH_SCAN` YA SE USA.** Antes estaba declarado "para un descubrimiento futuro" y no se
//     pedía en runtime, porque el único transporte (`spp`) NO descubre: lista los devices ya emparejados
//     en el sistema (el RS420 se empareja una vez desde los ajustes de Android, es slave, PIN 1234). El
//     transporte BLE **escanea**, así que en API ≥ 31 `BLUETOOTH_SCAN` es un permiso de runtime que la
//     app pide de verdad (`permissions-android.ts`, tabla por transporte, RBM2.13).
//  2. **El tope de `ACCESS_FINE_LOCATION` sigue igual, pero por otro motivo.** Antes el argumento era
//     "este camino no descubre, así que la ubicación no hace falta nunca". Ahora sí hace falta… pero
//     **solo en API ≤ 30**, que es exactamente la ventana que el tope deja abierta: antes de Android 12
//     el escaneo BLE se autoriza con un permiso de ubicación, y desde Android 12 se autoriza con
//     `BLUETOOTH_SCAN` + `neverForLocation`. O sea que la política de permisos **no cambió**: lo que
//     cambió es que ahora se piden en runtime los que ya estaban declarados.
//
// ── EL SEGUNDO PLUGIN QUE ESCRIBE ESTE MANIFIESTO (y por qué importa) ────────────────────────────────
// Desde el mismo delta, `react-native-ble-plx` aporta su propio config plugin, enganchado en
// `app.config.ts` con `neverForLocation: true`. Ese plugin agrega `ACCESS_COARSE_LOCATION` y
// `ACCESS_FINE_LOCATION` en el array **`uses-permission-sdk-23`** — que NO es el que toca este archivo,
// así que el `tools:node="replace"` de acá no los alcanza. Con `neverForLocation: true` entran topeados a
// `maxSdkVersion=30`; con el default de la lib (`false`) entrarían **sin tope**. La política combinada
// (los dos plugins, en los dos órdenes posibles de mods) se verifica ejecutándola en
// `with-bluetooth-classic.test.ts`, incluida la falsificación del mundo malo.
//
// La lógica pura (`applyBluetoothPermissions`) se exporta aparte y se testea bajo node:test sin
// cargar `expo/config-plugins` (que se requiere PEREZOSAMENTE dentro del plugin).

const TOOLS_NS = 'http://schemas.android.com/tools';

/**
 * Política de permisos Bluetooth de la app. `attrs` son atributos XML tal cual van al manifiesto.
 * - BLUETOOTH / BLUETOOTH_ADMIN: modelo viejo, solo hasta Android 11 (API 30).
 * - BLUETOOTH_CONNECT: permiso de runtime (Android 12+) para hablar con un device — el emparejado del
 *   SPP y el GATT del BLE.
 * - BLUETOOTH_SCAN: permiso de runtime (Android 12+) del **escaneo BLE**, con `neverForLocation` (no se
 *   usa para derivar ubicación). Lo pide el transporte `ble-gatt`; el `spp` no (ver cabecera,
 *   reconciliación 2026-08-17).
 * - ACCESS_FINE_LOCATION: topeado a API 30 y con `tools:node=replace` (ver cabecera). En esa ventana
 *   —Android ≤ 11— es el permiso que autoriza el escaneo BLE.
 */
const BLUETOOTH_PERMISSIONS = [
  { name: 'android.permission.BLUETOOTH', attrs: { 'android:maxSdkVersion': '30' } },
  { name: 'android.permission.BLUETOOTH_ADMIN', attrs: { 'android:maxSdkVersion': '30' } },
  { name: 'android.permission.BLUETOOTH_CONNECT', attrs: {} },
  { name: 'android.permission.BLUETOOTH_SCAN', attrs: { 'android:usesPermissionFlags': 'neverForLocation' } },
  {
    name: 'android.permission.ACCESS_FINE_LOCATION',
    attrs: { 'android:maxSdkVersion': '30', 'tools:node': 'replace' },
  },
];

/**
 * Aplica la política sobre un AndroidManifest ya parseado (forma de xml2js que usa Expo:
 * `{ manifest: { $, 'uses-permission': [{ $: { 'android:name': ... } }] } }`).
 *
 * PURA e idempotente: correrla dos veces da el mismo resultado (upsert por `android:name`), que es
 * lo que necesita un prebuild que se re-corre. Devuelve el mismo objeto mutado (contrato de los
 * mods de Expo).
 */
function applyBluetoothPermissions(androidManifest) {
  const manifest = androidManifest && androidManifest.manifest;
  if (manifest == null) return androidManifest;

  manifest.$ = manifest.$ || {};
  // `tools:node` no existe sin el namespace declarado → el merger falla el build si falta.
  if (manifest.$['xmlns:tools'] == null) manifest.$['xmlns:tools'] = TOOLS_NS;

  if (!Array.isArray(manifest['uses-permission'])) manifest['uses-permission'] = [];
  const list = manifest['uses-permission'];

  for (const permission of BLUETOOTH_PERMISSIONS) {
    const existing = list.find((entry) => entry && entry.$ && entry.$['android:name'] === permission.name);
    if (existing) {
      Object.assign(existing.$, permission.attrs);
    } else {
      list.push({ $: Object.assign({ 'android:name': permission.name }, permission.attrs) });
    }
  }

  return androidManifest;
}

/** Plugin de Expo. `expo/config-plugins` se requiere adentro para no cargarlo en los tests puros. */
function withBluetoothClassic(config) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { withAndroidManifest } = require('expo/config-plugins');
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyBluetoothPermissions(cfg.modResults);
    return cfg;
  });
}

module.exports = withBluetoothClassic;
module.exports.applyBluetoothPermissions = applyBluetoothPermissions;
module.exports.BLUETOOTH_PERMISSIONS = BLUETOOTH_PERMISSIONS;
