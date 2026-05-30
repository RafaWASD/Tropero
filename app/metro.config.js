// metro.config.js — RAFAQ (B.0 scaffold, ADR-013)
//
// Base de Expo (getDefaultConfig) envuelta por el plugin de Tamagui.
// `isCSSEnabled: true` habilita el pipeline de CSS que Tamagui usa en web;
// en native es inocuo. La generación de CSS estático (tamagui generate) NO se
// usa todavía — se evalúa al endurecer el design system (A.1).
const { getDefaultConfig } = require('expo/metro-config');
const { withTamagui } = require('@tamagui/metro-plugin');

const config = getDefaultConfig(__dirname, { isCSSEnabled: true });

module.exports = withTamagui(config, {
  components: ['tamagui'],
  config: './tamagui.config.ts',
});
