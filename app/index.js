// index.js — entry custom de la app (patrón oficial de expo-router para polyfills).
//
// Importa los polyfills de runtime ANTES de `expo-router/entry` (el entry real que registra el
// root component). El ORDEN es CRÍTICO: expo-router/entry termina importando el árbol de la app
// —incluido services/supabase.ts, que corre createClient() a NIVEL MÓDULO— así que los polyfills
// de URL/crypto DEBEN estar aplicados antes. Ver polyfills.ts para el detalle del porqué.
//
// package.json apunta "main" a este archivo (en vez de "expo-router/entry" directo).
// En WEB este entry es inocuo: polyfills.ts es no-op ahí (URL/crypto ya existen) y expo-router/entry
// arranca igual que siempre.
import './polyfills';
import 'expo-router/entry';
