// metro.config.js — RAFAQ (B.0 scaffold, ADR-013)
//
// Base de Expo (getDefaultConfig) envuelta por el plugin de Tamagui.
// `isCSSEnabled: true` habilita el pipeline de CSS que Tamagui usa en web;
// en native es inocuo. La generación de CSS estático (tamagui generate) NO se
// usa todavía — se evalúa al endurecer el design system (A.1).
const { getDefaultConfig } = require('expo/metro-config');
const { withTamagui } = require('@tamagui/metro-plugin');

const config = getDefaultConfig(__dirname, { isCSSEnabled: true });

const tamaguiConfig = withTamagui(config, {
  components: ['tamagui'],
  config: './tamagui.config.ts',
});

// --- Fix Hermes: forzar @supabase/supabase-js al build CJS ---
//
// @supabase/supabase-js >=2.106 trae en su build ESM (dist/index.mjs) un import
// dinámico con especificador variable — `import(OTEL_PKG)` sobre @opentelemetry/api.
// Metro (Expo SDK 53+) elige el ESM vía package exports, y hermesc NO parsea un
// import dinámico con especificador variable: el build EAS release rompe en
// `:app:createBundleReleaseJsAndAssets` con "Invalid expression encountered".
// El build CJS (dist/main) usa require() en vez de import() → es Hermes-safe.
//
// Solución quirúrgica: SOLO para @supabase/supabase-js (y subpaths) resolvemos con
// package exports DESACTIVADO, lo que hace que Metro caiga al campo "main" (CJS).
// NO se desactiva package exports global (rompería @powersync/web, que depende de
// exports). NO se stubbea @opentelemetry/api (no arregla nada: es un error de
// PARSEO de Hermes, no de resolución de módulos). Encadenamos al resolveRequest
// upstream (Tamagui/Expo) si existiera para no pisar su lógica.
//
// Fuentes: supabase/supabase-js#2380, expo/expo Discussion #36551, docs Metro de Expo.
// Actualizar supabase-js NO arregla (verificado hasta 2.110.3).
const upstreamResolveRequest = tamaguiConfig.resolver.resolveRequest;
tamaguiConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === '@supabase/supabase-js' ||
    moduleName.startsWith('@supabase/supabase-js/')
  ) {
    return context.resolveRequest(
      { ...context, unstable_enablePackageExports: false },
      moduleName,
      platform,
    );
  }
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = tamaguiConfig;
