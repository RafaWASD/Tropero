// app/app.config.ts — Configuración dinámica de Expo (reemplaza app.json). Spec 16, R2.
//
// El discriminador es `process.env.APP_VARIANT`, que EAS setea por build profile:
//   - development → variante "miTropero (Dev)" con id `ar.rafq.app.dev` (instalable JUNTO al de prod, R2.4).
//   - preview/production/ausente → "miTropero" con id `ar.rafq.app` (R2.3).
//
// El NOMBRE visible es "miTropero" (rebrand fase 1) pero los IDENTIFICADORES siguen siendo `ar.rafq.app`
// / slug `rafaq-app` / scheme `rafq` / owner `rafaqsorg`: cambiarlos es fase 2 y depende de trabajo en
// consolas externas (Apple/Google/EAS/Resend). Nombre e id no tienen por qué coincidir.
//
// Preserva TODO lo que tenía app.json (as-built al migrar):
//   - OAuth/scheme de la FEATURE 19: scheme 'rafq', ios.usesAppleSignIn, plugin google-signin
//     (iosUrlScheme), plugin expo-apple-authentication.
//   - Fase 0 (chore): plugin expo-sharing.
//   - Base: notifications, router, splash, adaptive icons, permisos, web.favicon, extra (router/eas),
//     eas.projectId, owner.
//
// Dependencia de Fase 0 (OTA): el bloque `updates` (updates.url/runtimeVersion) + el plugin
// expo-updates los aporta Fase 0; esta config queda estructurada para recibirlos sin conflicto y NO
// los redacta (design §1).
//
// PURA de expo en runtime: el default export es una función de `process.env.APP_VARIANT`, así
// `app.config.test.ts` la ejerce bajo node:test sin cargar expo (el `import type` se erasa).
import type { ExpoConfig } from 'expo/config';

const APP_ID = 'ar.rafq.app';

// Texto que iOS le muestra AL USUARIO en el diálogo de permiso de Bluetooth. Va en español (es la UI
// del SO, no un mensaje técnico) y nombra el para-qué en términos del campo: Apple rechaza los
// genéricos tipo "esta app usa Bluetooth". Una sola constante para las dos claves de abajo: que
// puedan divergir es una forma de que una de las dos quede genérica sin que nadie lo note.
const BLUETOOTH_PURPOSE =
  'miTropero se conecta por Bluetooth con el bastón lector para leer las caravanas electrónicas de los animales.';

export default (): ExpoConfig => {
  const isDev = process.env.APP_VARIANT === 'development';
  // Id distinto por variante → el `.dev` y el de prod coexisten instalados en el mismo device (R2.4).
  const appId = isDev ? `${APP_ID}.dev` : APP_ID;

  return {
    name: isDev ? 'miTropero (Dev)' : 'miTropero', // R2.2 / R2.3
    slug: 'rafaq-app',
    scheme: 'rafq', // feature 19 (deep-link OAuth) — PRESERVADO
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: appId, // R2.2 / R2.3
      usesAppleSignIn: true, // feature 19 — PRESERVADO
      infoPlist: {
        UIBackgroundModes: ['remote-notification'],
        // Export compliance (TestFlight/App Store): la app NO usa criptografía propia — solo HTTPS y
        // el keychain/SecureStore del SO, ambos exentos. Sin esta clave, App Store Connect frena
        // CADA build subido con la pregunta manual de encriptación antes de habilitarlo a testers.
        ITSAppUsesNonExemptEncryption: false,
        // Bluetooth del bastón (spec 04). Son DOS consecuencias distintas y conviene no mezclarlas:
        //  · INCONDICIONAL — sin esta clave, el validador de App Store Connect RECHAZA la entrega
        //    (ITMS-90683, que es como apareció: build 5 de iOS, 2026-08-10). No depende de que la app
        //    ejecute nada: alcanza con que el binario linkee CoreBluetooth, y lo linkea porque
        //    `react-native-bluetooth-classic` está instalado.
        //  · CONDICIONAL — si además la app instancia el manager de CoreBluetooth sin la clave, iOS
        //    ABORTA el proceso. Hoy en iOS eso NO pasa: no hay transporte (`selectTransportAdapter`
        //    devuelve `manual` y `isSppNativeAvailable()` corta por `Platform.OS !== 'android'` antes
        //    de tocar el módulo nativo), así que la pantalla del bastón en iPhone es manual-first y no
        //    llega a CoreBluetooth. El día que se destrabe el camino iOS pasa a ser el modo de falla
        //    principal — pero la clave hace falta ya, por el punto de arriba.
        NSBluetoothAlwaysUsageDescription: BLUETOOTH_PURPOSE,
        // Deprecada desde iOS 13 (la reemplazó la de arriba) y muy probablemente innecesaria: se
        // declara A PROPÓSITO igual. Un build de EAS es un recurso agotable —plan Free, 30 por mes,
        // ya se agotaron una vez y dejaron el proyecto dos semanas sin poder buildear— así que un
        // segundo aviso del validador cuesta un ciclo entero. Una clave de más es una línea; una
        // clave de menos son 40 minutos y un build.
        NSBluetoothPeripheralUsageDescription: BLUETOOTH_PURPOSE,
        // MFi / External Accessory. NO es una purpose string: es la lista de protocolos de accesorio
        // que la app declara soportar. Se declara igual —y VACÍA— por un force-cast de la librería del
        // bastón: `react-native-bluetooth-classic`, en el `init()` de su módulo nativo
        // (`ios/RNBluetoothClassic.swift:68-69`), hace
        //     Bundle.main.object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as! [String]
        // `object(forInfoDictionaryKey:)` devuelve un opcional: SIN la clave es `nil as! [String]`, que
        // TRAPEA. O sea que el módulo no falla al usarse, falla al INSTANCIARSE. Y en bridgeless
        // (RN 0.85) instanciarlo es más fácil de lo que parece: leer `NativeModules.RNBluetoothClassic`
        // ya crea el objeto nativo (BridgelessNativeModuleProxy → RCTTurboModuleManager →
        // `[moduleClass new]`), así que hasta el chequeo defensivo `NativeModules.X == null` de
        // `loadRNBC()` sería el disparador. Hoy no se dispara porque en iOS `isSppNativeAvailable()`
        // corta antes por `Platform.OS !== 'android'` — pero eso es un guard de JS a un `if` de
        // distancia del crash.
        // POR QUÉ VACÍA: con `[]` el cast tiene éxito y el módulo arranca con la lista vacía, que es
        // exactamente la verdad de hoy — no tenemos NINGÚN protocolo MFi aprobado. Convierte un crash
        // posible en un no-evento sin declarar nada falso (un protocol string inventado sí sería
        // mentirle al SO, y no habilitaría ningún accesorio).
        // QUÉ LA VA A LLENAR: el trámite MFi (gateado, ítem de Facundo). Cuando salga, acá va el
        // protocol string real del RS420 que publique el fabricante (`com.<fabricante>.<protocolo>`),
        // no antes. Declararla vacía NO habilita el bastón en iOS: solo evita el trap.
        UISupportedExternalAccessoryProtocols: [],
      },
    },
    android: {
      package: appId, // R2.2 / R2.3
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      permissions: ['NOTIFICATIONS'],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      [
        'expo-notifications',
        {
          color: '#1A73E8',
          defaultChannel: 'default',
        },
      ],
      'expo-router',
      'expo-splash-screen',
      'expo-sharing', // Fase 0 (chore) — PRESERVADO
      [
        '@react-native-google-signin/google-signin', // feature 19 — PRESERVADO
        {
          iosUrlScheme:
            'com.googleusercontent.apps.167085605126-8ihanu72oludhp533vtnp9114j7nqakf',
        },
      ],
      'expo-apple-authentication', // feature 19 — PRESERVADO
      // Bastón Bluetooth Classic (spec 04 / RMV5.8). `react-native-bluetooth-classic` NO trae
      // config plugin propio, así que la política de permisos Android del bastón vive acá:
      // BLUETOOTH_CONNECT (Android 12+), BLUETOOTH/BLUETOOTH_ADMIN topeados a API 30, BLUETOOTH_SCAN
      // con `neverForLocation`, y ACCESS_FINE_LOCATION —que la lib mete sin tope— acotado a API 30.
      // ⚠️ Reconciliado 2026-08-17 (delta ios-ble-mfi / RBM7.6): este comentario decía que
      // BLUETOOTH_CONNECT era "el único de runtime" y que "este camino NO hace discovery". Con el
      // transporte `ble-gatt` las dos afirmaciones dejaron de ser ciertas: el escaneo BLE pide
      // BLUETOOTH_SCAN en runtime (API ≥ 31) y ACCESS_FINE_LOCATION en API ≤ 30 — que es justo la
      // ventana que el tope deja abierta. La POLÍTICA no cambió; cambió quién la usa. El detalle está
      // en la cabecera de `plugins/with-bluetooth-classic.js` y en `services/ble/permissions-android.ts`.
      './plugins/with-bluetooth-classic',
      // ── Bastón por BLE GATT (spec 04, delta ios-ble-mfi / RBM2.15, RBM2.17) ────────────────────
      // `react-native-ble-plx` SÍ trae config plugin propio (`app.plugin.js` → `plugin/build/withBLE`),
      // así que no hace falta `@config-plugins/react-native-ble-plx`. Las cuatro opciones están
      // EXPLÍCITAS a propósito, aunque tres coincidan con el default de la lib: cada una es una
      // decisión con consecuencia, y un default que cambie en una versión futura de la lib no puede
      // cambiarnos la política en silencio.
      [
        'react-native-ble-plx',
        {
          // ⛔ BACKGROUND BLE PROHIBIDO (RBM2.15 / R6.9 foreground-only). `isBackgroundEnabled` es lo
          // que agregaría `<uses-feature android:name="android.hardware.bluetooth_le" required="true"/>`
          // al manifiesto (que además excluiría de Play a los devices sin BLE), y `modes` es lo que
          // escribiría `UIBackgroundModes: ['bluetooth-central']` en el Info.plist. Los dos apagados:
          // el bastón se usa con la app en la mano, en la manga, y declarar background en iOS arrastra
          // escrutinio de App Review por una capacidad que no usamos.
          isBackgroundEnabled: false,
          modes: [],
          // Política de permisos de Android (RBM2.13). Con `neverForLocation: true` el plugin declara
          // `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION` TOPEADAS a `maxSdkVersion=30` y el
          // `BLUETOOTH_SCAN` con el flag `neverForLocation`. Con el default (`false`) las declararía
          // SIN TOPE, que es exactamente lo que `plugins/with-bluetooth-classic.js` existe para evitar:
          // una app de ganado no pide ubicación. Y es verdad, no una conveniencia: el escaneo se filtra
          // por `serviceUuid` para encontrar un bastón, nunca para inferir dónde está el teléfono.
          neverForLocation: true,
          // El texto del diálogo de iOS es NUESTRO. `withBluetoothPermissions` del plugin ESCRIBE
          // `NSBluetoothAlwaysUsageDescription` en el Info.plist y, si no se le pasa nada, puede dejar
          // su default en inglés ("Allow $(PRODUCT_NAME) to connect to bluetooth devices"). Pasarle la
          // misma constante que `ios.infoPlist` hace el resultado independiente del orden en que Expo
          // aplique los mods. Es la premisa que el guard de purpose strings tenía escrita como límite
          // nº5 ("ningún plugin nuestro toca el Info.plist"): este es el primero que sí lo toca, y así
          // queda cerrado.
          bluetoothAlwaysPermission: BLUETOOTH_PURPOSE,
        },
      ],
      [
        'expo-build-properties',
        {
          ios: {
            // Fix pod install iOS: GoogleSignIn 9.x -> AppCheckCore (Swift) depende de GoogleUtilities y
            // RecaptchaInterop, que no definen módulos → no integrables como static libs. Les habilitamos
            // modular headers (lo que pide el propio error de CocoaPods). El plugin de google-signin solo
            // cubría GoogleSignIn, no estas transitivas de AppCheck.
            extraPods: [
              { name: 'GoogleUtilities', modular_headers: true },
              { name: 'RecaptchaInterop', modular_headers: true },
              { name: 'AppCheckCore', modular_headers: true },
            ],
          },
        },
      ],
    ],
    extra: {
      // supabaseUrl ELIMINADO (spec 16 A2/R2.5): grep de `expoConfig.extra.supabaseUrl` en app/src
      // → sin consumidores (env.ts lee extra[EXPO_PUBLIC_*], nunca la clave `supabaseUrl`).
      router: {},
      eas: {
        projectId: 'd8cf3a19-e8f7-4d7f-b417-54123e7f0d3e',
      },
    },
    owner: 'rafaqsorg',
  };
};
