# Build Android — plan del primer APK beta

> Creado 2026-07-06 (terminal paralela, trabajo colisión-safe mientras la otra terminal cierra fixes).
> Objetivo: primer APK instalable para que el peón (con Facundo al lado) pruebe la app en el campo de Chascomús.

## Estado de partida

- **Nunca se hizo un build nativo.** La app solo corrió en web (`expo export -p web` + Playwright) y el render en device jamás se validó (nota de B.0 en `progress/plan.md`).
- `@powersync/react-native` 1.35.3 ya instalado; la database factory web/native ya existe (spec 15 Run 1). **T8 (boot nativo de PowerSync en device) nunca corrió** — es EL riesgo técnico del primer APK.
- Sync streams principales deployadas (los 8 e2e offline de spec 15 pasaron con oráculos server-side). El YAML delta de SIGSA sigue sin deployar, pero no afecta al peón.
- `app.json` ya tiene package `ar.rafq.app`, adaptive icons y permisos. Assets presentes en `app/assets/`.
- `eas.json` creado (2026-07-06) con perfil `preview` → APK + las 3 `EXPO_PUBLIC_*` embebidas (son públicas por diseño; RLS protege los datos).

## Decisiones

- **Build en la nube (EAS)**, no local: evita instalar Android Studio/SDK. EAS genera y guarda el keystore automáticamente en el primer build.
- **Perfil `preview` = APK release** (sin dev client). `expo-dev-client` NO hace falta para el APK 1; recién sirve para iterar el bastón (APK 2, adapter `spp-android` de spec 04).
- **Rollout escalonado**: el APK va primero al teléfono de **Facundo** (boot + login + sync + una pasada de flujos); recién si eso pasa, al teléfono del peón. El teléfono del peón es en realidad el device target ideal (gama real de campo) — el escalón Facundo existe solo para no quemar la primera impresión con un blank-screen.
- **`expo-updates` (OTA) antes de entregar al peón**: permite empujar fixes de JS sin re-instalar APK — crítico porque el loop de debug remoto vía reportes verbales es carísimo. Requiere `pnpm add` (toca package.json/lockfile) → **esperar a que la otra terminal termine** para instalarlo. Al agregarlo, sumar `"channel"` a los perfiles de `eas.json`.

## Secuencia

1. ✅ `eas.json` (hecho).
2. ✅ Cuenta Expo `rafaqsorg` + login + `eas init` (2026-07-07): proyecto `@rafaqsorg/rafaq-app` linkeado, `projectId d8cf3a19-e8f7-4d7f-b417-54123e7f0d3e` escrito en `app.json`. Dashboard: https://expo.dev/accounts/rafaqsorg/projects/rafaq-app
3. ✅ `expo-updates` (OTA) instalado + configurado (2026-07-07) en la **rama `apk-prep`** (`5426d99`, hecha desde el worktree `C:\DEV\RAFAQ\apk-worktree` para no tocar el árbol principal): `expo-updates ~56.0.21`, `runtimeVersion policy appVersion`, `updates.url`, canales `preview`/`development`/`production` en `eas.json`. **Mergear `apk-prep` a `main` cuando la terminal de fixes cierre.**
4. ⚠️ **Build 1 intentado (2026-07-07) y FALLÓ en Gradle** (nube EAS, desde worktree limpio en `97f559b`): keystore + upload + versionCode 1 OK; error en fase "Run gradlew". **Diagnóstico pendiente** (bajar el log del build al retomar): https://expo.dev/accounts/rafaqsorg/projects/rafaq-app/builds/68cc88d7-e64b-4515-b4be-e887c7bc06e0 — este fallo va a reproducirse en el build 2 si no se arregla antes; es de código/config, no del WIP.
5. ⏳ Al cerrar la terminal de fixes: mergear `apk-prep` → diagnosticar/arreglar el error de Gradle → `npx eas-cli build -p android --profile preview` → APK.
6. Validación en el teléfono de Facundo (checklist abajo).
7. Fix-loop de lo que rompa (vía SDD normal; fixes de JS salen por OTA sin re-instalar APK).
8. Entrega al peón con Facundo presente los primeros días.

## Checklist de validación (escalón Facundo)

- [ ] Bootea (sin crash al abrir, splash → login).
- [ ] Login + verificación de sesión contra Supabase.
- [ ] **PowerSync nativo**: las pantallas de datos NO quedan en blanco; lista de animales carga (T8 spec 15 — síntoma conocido en web cuando falta env/boot: pantallas en blanco).
- [ ] Round-trip offline: modo avión → alta de animal / evento → volver la red → aparece en el server.
- [ ] MODO MANIOBRAS: sesión completa con carga manual.
- [ ] Render: fonts, safe areas, teclado numérico con coma es-AR, botones manga.
- [ ] Push token: sin `google-services.json` el registro remoto falla — confirmar que es best-effort silencioso (no crash, no toast molesto).

## Riesgos conocidos / fuera de alcance del APK 1

- **Bastón RS420**: adapter `spp-android` no escrito (placeholder, spec 04). APK 1 = carga manual (la app degrada manual-first por diseño). Bastón = APK 2 con dev build.
- **Push remoto**: sin FCM (`google-services.json`) en el APK 1. Aceptado.
- **SIGSA**: YAML delta sin deployar; el peón no toca esas pantallas.
- **Código web-first**: puede haber paths que asuman web (window/document, gotchas inversos a `reference_rn_web_pitfalls`). Se cazan en el escalón Facundo.
