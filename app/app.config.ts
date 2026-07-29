// app/app.config.ts — Configuración dinámica de Expo (reemplaza app.json). Spec 16, R2.
//
// El discriminador es `process.env.APP_VARIANT`, que EAS setea por build profile:
//   - development → variante "RAFAQ (Dev)" con id `ar.rafq.app.dev` (instalable JUNTO al de prod, R2.4).
//   - preview/production/ausente → "RAFAQ" con id `ar.rafq.app` (R2.3).
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

export default (): ExpoConfig => {
  const isDev = process.env.APP_VARIANT === 'development';
  // Id distinto por variante → el `.dev` y el de prod coexisten instalados en el mismo device (R2.4).
  const appId = isDev ? `${APP_ID}.dev` : APP_ID;

  return {
    name: isDev ? 'RAFAQ (Dev)' : 'RAFAQ', // R2.2 / R2.3
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
      // BLUETOOTH_CONNECT (Android 12+, el único de runtime), BLUETOOTH/BLUETOOTH_ADMIN topeados a
      // API 30, BLUETOOTH_SCAN con `neverForLocation`, y ACCESS_FINE_LOCATION —que la lib mete sin
      // tope— acotado a API 30: este camino NO hace discovery, solo lista los emparejados.
      './plugins/with-bluetooth-classic',
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
