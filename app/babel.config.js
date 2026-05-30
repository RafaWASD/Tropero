// babel.config.js — RAFAQ (B.0 scaffold, ADR-013)
//
// Orden de plugins (importa):
//   1. @tamagui/babel-plugin — optimizing compiler de Tamagui (extrae estilos,
//      reduce el bundle). Va antes que el de worklets.
//   2. react-native-worklets/plugin — DEBE ir ÚLTIMO. En Reanimated 4 el babel
//      plugin se movió de `react-native-reanimated/plugin` a este paquete.
//      Reanimated lo exige como el último plugin de la cadena.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        '@tamagui/babel-plugin',
        {
          components: ['tamagui'],
          config: './tamagui.config.ts',
          logTimings: true,
          disableExtraction: process.env.NODE_ENV === 'development',
        },
      ],
      // DEBE ir último (ver nota arriba).
      'react-native-worklets/plugin',
    ],
  };
};
