baseline_commit: 6960238ede92478e6d8b96b8a88a8b82613a5843

# Chore Fase 0 — Fix build Gradle APK EAS + higiene SDK 56

**Tipo**: chore PRE-SDD (no es feature SDD, no pasa por puertas).

## Objetivo
Arreglar el fallo de build EAS release en `hermesc`
(`:app:createBundleReleaseJsAndAssets`, "Invalid expression encountered") + higiene
de `expo doctor` en SDK 56.

## Causa raíz (confirmada, con fuentes)
`@supabase/supabase-js` >=2.106 trae en su build ESM (`dist/index.mjs`) un import
dinámico con especificador variable — `import(OTEL_PKG)` sobre `@opentelemetry/api`.
Metro (Expo SDK 53+) elige el ESM vía package exports; hermesc no parsea import
dinámico con especificador variable → build roto. El build CJS (`dist/main`) usa
`require()` → Hermes-safe.
Fuentes: supabase/supabase-js#2380, expo/expo Discussion #36551, docs Metro de Expo.
Actualizar supabase-js NO arregla (verificado hasta 2.110.3).

## Plan
- T1. Fix Hermes: `resolveRequest` quirúrgico en `metro.config.js` que fuerza solo
  `@supabase/supabase-js` (+ subpaths) a resolver con package exports OFF (→ CJS).
- T2a. Remover `@react-navigation/{bottom-tabs,native,native-stack}` (leftover B.0,
  cero imports en fuente) + actualizar lockfile.
- T2b. Alinear 9 paquetes expo desalineados del patch SDK 56 (solo PATCH).
- T3. NO tocar OTA/expo-updates.

## Progreso

### T1 — Fix Hermes (metro.config.js) — HECHO
Agregado `resolveRequest` DESPUÉS del `withTamagui`, encadenando al upstream.
Solo `@supabase/supabase-js` (+ subpaths, match preciso `=== ` o `startsWith('.../')`)
resuelve con `unstable_enablePackageExports: false` → cae al `main` (CJS, `require()`, Hermes-safe).
NO se desactiva package exports global (rompería `@powersync/web`, que depende de exports).
NO se stubbea `@opentelemetry/api` (error de PARSEO de Hermes, no de resolución).
Comentario + fuentes en el archivo (supabase-js#2380, expo Discussion #36551, docs Metro).

### T2a — Remover @react-navigation — HECHO
`grep`/Grep previo: CERO imports de `@react-navigation` en `app/app/` ni `app/src/`
(solo aparecía en package.json + lockfile) → leftover del scaffold B.0, seguro remover.
`pnpm remove @react-navigation/bottom-tabs @react-navigation/native @react-navigation/native-stack`.
Bonus verificado: expo-router 56.2.14 ya NO lista `@react-navigation/*` en sus peerDependencies
(lo forkeó/vendoreó internamente — assets en `expo-router/assets/react-navigation/`), así que el
subárbol entero desapareció del lockfile (`grep -c @react-navigation pnpm-lock.yaml` = 0) sin
referencias colgantes. El web export (con routing) sigue bundleando OK.

### T2b — Alinear 9 paquetes expo (SDK 56, solo PATCH) — HECHO
`pnpm exec expo install --fix`. Bumps aplicados (todos PATCH, mismo minor):
- expo 56.0.4 → ~56.0.15
- expo-clipboard 56.0.3 → ~56.0.4
- expo-constants 56.0.15 → ^56.0.20
- expo-file-system 56.0.7 → ~56.0.8
- expo-linking 56.0.11 → ^56.0.15
- expo-notifications 56.0.13 → ^56.0.20
- expo-router 56.2.7 → ~56.2.14
- expo-sharing 56.0.18 → ~56.0.21
- expo-splash-screen 56.0.10 → ~56.0.12
`expo install --check` posterior = "Dependencies are up to date".
Side effect legítimo: `expo install --fix` agregó el config plugin `expo-sharing` a
`app/app.json` (expo-sharing 56.0.21 ahora ships plugin). Se mantiene (higiene correcta).

### T3 — OTA/expo-updates — NO TOCADO (como pide el plan).

## Skew transitivo NO bloqueante (documentado, fuera de scope)
`expo-doctor` (21 checks): **20/21 pasan**. El único fail es un skew de subdependencia
TRANSITIVA web/dev-only: `@expo/metro-runtime@56.0.13` vs `^56.0.16` que pide expo-router
56.2.14. NO es ninguno de los 2 ítems de higiene pedidos, y `@expo/metro-runtime` NO se
bundlea en el build Android/Hermes (es runtime de metro para web/Fast Refresh) → NO afecta
el fix crítico. Es un skew interno de publicación de Expo (el paquete `expo` 56.0.15 se aparea
con metro-runtime 56.0.13; expo-router 56.2.14 pide 56.0.16; el único patch publicado >=56.0.16
es 56.0.16 exacto). Se intentó un override pnpm `"@expo/metro-runtime": "56.0.16"` pero pnpm
lo mantiene en 56.0.13 (entra como peer auto-instalado; solo se redireccionaría con un
`--force` re-resolve completo del store, lento/pesado y sin beneficio para el objetivo). Se
REVIRTIÓ el override para no dejar config muerta. Queda como follow-up menor si Expo publica
un metro-runtime 56.0.16+ que empareje con el SDK.

## Verificación local (final, post todos los cambios)
- `pnpm -C app typecheck` → **VERDE** (exit 0).
- `cd app && pnpm exec expo export -p web` → **VERDE** ("Exported: dist", 13 web bundles, sin error).
  Confirma que: (a) remover `@react-navigation` no rompió imports; (b) los bumps PATCH no
  rompieron el bundle; (c) forzar supabase-js a CJS no rompe el bundle web.
- `design/**/*.png`: 0 cambios (el `export -p web` plano NO re-renderiza design; eso lo hace
  `e2e:build` con Playwright). Nada que revertir.
- **El build EAS release (Hermes) real queda para Raf** — no se puede ejercitar Hermes localmente;
  el web export NO ejercita hermesc. La causa raíz y el fix están confirmados con fuentes.

## Nota terminales paralelas
Otra terminal está trabajando features 16/17/18 (audit-log): modifica `feature_list.json`,
`progress/current.md`, `progress/plan.md`, `scripts/run-tests.mjs`, `supabase/functions/*`,
`specs/active/{16,17,18}/`, `supabase/migrations/0124_*`. NO toqué ninguno de esos.
Mis cambios: `app/metro.config.js`, `app/package.json`, `app/pnpm-lock.yaml`, `app/app.json`
(config plugin auto) y este archivo. Sin colisión (mis cambios son app-deps; los de la otra
terminal son backend/coordinación). NO commiteé (el task no lo pide; hay terminal paralela).

## Autorrevisión adversarial
- ✅ resolveRequest: match preciso (no captura `@supabase/supabase-js-helpers`); encadena upstream
  con `?? context.resolveRequest`; para el branch supabase va directo al resolver default de Metro
  con exports off (igual que el snippet pedido). Metro cargó la config sin error (web export verde)
  → chaining y sintaxis validados en runtime.
- ✅ package exports global sigue ON: `@powersync/web` (que depende de exports) bundlea OK en el
  web export → no lo rompí.
- ✅ react-navigation: verifiqué CERO imports en fuente ANTES de remover; expo-router no lo necesita
  (forkeado); lockfile a 0 refs; web export con routing OK.
- ✅ Bumps: todos PATCH dentro del mismo minor; `expo install --check` limpio.
- ⚠️ Encontrado y cerrado: el bump de expo-router destapó un skew transitivo web-only de
  `@expo/metro-runtime` (20/21 doctor). Analizado: no bloqueante, no afecta Hermes, fuera de los
  2 ítems de scope. Intento de override no prendió limpio → revertido para no dejar config muerta.
  Documentado como follow-up.
- ✅ OTA/expo-updates intacto.
- ✅ Idempotencia deps: package.json + lockfile en estado correcto y estable (react-nav ausente,
  override revertido). El churn "-43 packages" en reinstalls es prune de un dir hoisted phantom
  `node_modules/@react-navigation` (no está en `.pnpm` ni en el lockfile) — artefacto transitorio
  de node_modules, NO afecta los deliverables versionados.

**Resultado: chore completo. Verificación local verde. Build Hermes/EAS pendiente de Raf.**
