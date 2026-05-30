# B.0 — Scaffold del stack frontend (ADR-013 + ADR-018)

> Infraestructura, NO una feature con spec. Ejecuta ADR-013 (stack), ADR-018 (bottom nav)
> y respeta ADR-023 (tokens, no hardcode). NO construye pantallas reales — solo scaffold +
> shell de navegación con stubs.

baseline_commit: 9f1803740290cf5a28374738612ba5eb69238d53

## Estado: COMPLETO — typecheck verde + `node scripts/check.mjs` verde + `expo export --platform ios` OK.

---

## 1. Dependencias instaladas (versiones resueltas)

Adopción **incremental** (ADR-013 línea 124): solo las 3 capas críticas + sus peers. NO se
instaló Sentry/PostHog/Maestro/Moti/Lottie/haptics/voice.

Versiones de runtime elegidas por `expo install` (compatibles con Expo SDK 56):

| Paquete | Versión | Cómo |
|---|---|---|
| `expo-router` | `~56.2.7` | `expo install` (agregó su config plugin a app.json) |
| `react-native-reanimated` | `4.3.1` | `expo install` |
| `react-native-worklets` | `0.8.3` | `expo install` — en Reanimated **4** el babel plugin se movió a `react-native-worklets/plugin` |
| `react-native-gesture-handler` | `~2.31.1` | `expo install` |
| `react-native-svg` | `15.15.4` | `expo install` — peer de lucide |
| `tamagui` | `2.0.0` | `pnpm add` (v2 = `latest`, estable may-2026) |
| `@tamagui/core` | `2.0.0` | `pnpm add` |
| `@tamagui/config` | `2.0.0` | `pnpm add` |
| `lucide-react-native` | `1.17.0` | `pnpm add` — icon set canónico (FRONTEND-STATUS) |
| `@react-navigation/bottom-tabs` | `7.16.2` | `pnpm add` — peer de `Tabs` de expo-router que **no venía** con expo-router (sí venían core/native/native-stack/elements/routers, faltaba bottom-tabs) |

Dev deps:

| Paquete | Versión |
|---|---|
| `@tamagui/babel-plugin` | `2.0.0` |
| `@tamagui/metro-plugin` | `2.0.0` |

`babel-preset-expo@56.0.12` ya estaba (transitive). `react-native-safe-area-context@5.8.0`
ya estaba (no se tocó).

## 2. Configuración

- **`babel.config.js`** (nuevo): preset `babel-preset-expo` + plugins en orden:
  1. `@tamagui/babel-plugin` (optimizing compiler).
  2. `react-native-worklets/plugin` — **ÚLTIMO** (requisito de Reanimated 4; reemplaza al viejo `react-native-reanimated/plugin`).
- **`metro.config.js`** (nuevo): `getDefaultConfig(__dirname, { isCSSEnabled: true })` envuelto por `withTamagui(...)` (patrón oficial del metro-plugin v2). `tamagui generate` (CSS estático) NO se usa todavía.
- **`tsconfig.json`**: agregado `paths` (`@/*` → `src/*`), `include` de `**/*.ts(x)` + `.expo/types` + `expo-env.d.ts`, `exclude` de babel/metro config. `strict` se mantiene.
- **`package.json`**: `main` cambiado de `index.ts` → `expo-router/entry`.
- **`app.json`**: `expo install` agregó el plugin `expo-router`. No toqué nada más.
- Eliminados: `index.ts` y `App.tsx` (reemplazados por file-based routing).

## 3. `tamagui.config.ts` (PROVISIONAL)

Sembrado con los tokens validados del design system v4 (FRONTEND-STATUS "Tokens validados").
Base = `defaultConfig` de `@tamagui/config/v4` (escalas space/size/zIndex/radius + themes de
componentes), sobre la que se monta:

- **Grupo `color`** (único lugar del frontend con hex literales): `white #FFFFFF`, `bg #faf9f9`
  (base neutro), `primary #1e5a3e` (verde botella), `primaryPress #184a33` (derivado provisional),
  `surface #F8F6F1` (bone, cards), `terracota #c84a2c` (alertas), `greenLight #93cfac` (icon
  containers), `textPrimary #0F0E0C`, `textMuted #707972`, `textFaint #A8A29D`, `divider #E5E5E3`.
  → usables como `$primary`, `$surface`, etc. en cualquier prop de color.
- **Radios semánticos**: `card: 16`, `pill: 9999` (sumados a la escala default 0–12).
- **Touch targets manga-friendly**: `size.touchMin: 56` (alto de botones primarios), `size.fab: 64` (diámetro del FAB, ADR-018).
- **Tipografía Inter** vía `createFont` (weights 700/600/500/400 + `face` mapeando peso→familia). **PROVISIONAL**: declara la familia pero las fuentes Inter reales NO se cargan todavía (expo-font/useFonts se agrega al construir la home, A.1); hasta entonces cae al sans-serif del sistema.
- **`settings.onlyAllowShorthands: false`** (override del default v4 que lo tenía `true`): las pantallas hand-crafted (ADR-023) son más legibles con props largas (`backgroundColor`, `marginTop`…). Sin este override, tsc rechaza las props largas.
- Tipado fuerte de tokens vía `declare module '@tamagui/core' { interface TamaguiCustomConfig extends AppConfig {} }`.

Comentario `// PROVISIONAL — se endurece al construir la home (A.1, ADR-023)` presente en cabecera.

## 4. Shell de navegación (ADR-018)

Estructura Expo Router file-based en `app/app/`:

```
app/_layout.tsx              raíz: GestureHandlerRootView > SafeAreaProvider > TamaguiProvider
                             + Stack (headerShown:false) con (tabs) + maniobra (modal)
app/(tabs)/_layout.tsx       bottom nav de 5 items con FAB central elevado
app/(tabs)/index.tsx         STUB Inicio
app/(tabs)/animales.tsx      STUB Animales (puerta manual BUSCAR ANIMAL, spec 09)
app/(tabs)/maniobra-fab.tsx  ruta placeholder del FAB (nunca se renderiza; el botón intercepta el press)
app/(tabs)/reportes.tsx      STUB Reportes
app/(tabs)/mas.tsx           STUB Más
app/maniobra.tsx             STUB MODO MANIOBRAS (modal destino del FAB, spec 03)
```

- **Bottom nav**: `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]`. Item activo verde botella (`$primary`), inactivos gris (`$textMuted`). Iconos Lucide: Home, PawPrint, Zap, BarChart3, Menu.
- **FAB central elevado** (`ManiobraFab`): `tabBarButton` custom en la `Tabs.Screen` "maniobra-fab" → rompe el layout plano. Círculo verde botella de `$fab` (64px) que sobresale sobre la barra (`marginTop: -fab/2`), borde blanco 4px, sombra, ícono rayo blanco (Zap fill), label "Maniobra" en gris. `onPress` → `router.push('/maniobra')` (no selecciona la tab vacía).
- **`/maniobra`**: stub navegable de MODO MANIOBRAS presentado como modal (botón "Cerrar" → `router.back()`). Queda como placeholder hasta spec 03 (Ola 3).

### Regla anti-hardcode (ADR-023 §4)

Las pantallas/shell NO hardcodean color/spacing: todo via tokens (`backgroundColor="$bg"`,
`color="$textPrimary"`, `padding="$4"`, `borderRadius="$pill"`, `height="$touchMin"`).
El único lugar con hex/px literal es `tamagui.config.ts`. Donde un valor cruza a una API
**no-Tamagui** (React Navigation `tabBarStyle`, color de íconos lucide), se lee del token vía
`getTokenValue('$token', grupo)` — sigue referenciando el design system, no es literal.
`getTokenValue` se llama **dentro** de los componentes (no a nivel de módulo) para garantizar
que `createTamagui` ya esté registrado al ejecutarse.

## 5. Verificación

| Check | Resultado |
|---|---|
| `cd app && pnpm.cmd typecheck` (tsc --noEmit) | **VERDE** |
| `node scripts/check.mjs` (root) | **VERDE** — incluye el typecheck del cliente + suites backend (RLS + Edge + Animal 19/19) que NO se rompieron |
| `pnpm.cmd exec expo export --platform ios` | **OK** — bundle de 3804 módulos, Hermes 6.7MB. El plugin de Tamagui corrió y optimizó las 7 pantallas; Metro + babel-preset-expo + worklets/plugin + tamagui/plugin + expo-router compilaron juntos sin error de config. (artefacto `dist-check` borrado) |

**No pude verificar** (no hay device/simulador acá): el render real en pantalla, el comportamiento
del FAB elevado in-app, la responsividad con safe-area en distintos tamaños, ni la carga de fuentes
Inter (no se cargan todavía — provisional). Eso se valida al construir la home corriendo en Expo (A.1).

## 6. Desviaciones / decisiones de criterio

1. **Reanimated 4 + worklets**: SDK 56 trae Reanimated 4.3.1, que separó el babel plugin a `react-native-worklets/plugin`. Instalé `react-native-worklets` explícito (vía expo install) y usé ese plugin (no el viejo `react-native-reanimated/plugin`). Decisión forzada por la versión, documentada.
2. **`@react-navigation/bottom-tabs` instalado a mano**: expo-router NO lo trae (sí trae core/native/native-stack/elements/routers). El `Tabs` de expo-router lo requiere. Instalé `7.16.2` (mismo major 7.x que el `@react-navigation/native@7.2.4` que pinea expo-router). **Warning de peer benigno**: bottom-tabs 7.16.2 quiere `@react-navigation/native@^7.2.5` y hay `7.2.4` (mismatch patch-level que controla expo-router). No bumpeé `native` para no desincronizar de expo-router; el API usado (`tabBarButton`/`tabBarIcon`) es estable en 7.2.x. El export bundleó OK.
3. **`settings.onlyAllowShorthands: false`**: override del default v4 (que es `true`). Sin esto, tsc rechaza props largas como `backgroundColor`/`marginTop`. Elegí permitir props largas porque son más legibles para pantallas hand-crafted (ADR-023). Reversible.
4. **Lucide SÍ disponible**: `lucide-react-native@1.17.0` (no hizo falta el fallback a `@expo/vector-icons`). Iconos Home/PawPrint/Zap/BarChart3/Menu bundlean OK.
5. **Colores de brand como token group `color`** (no como theme): en Tamagui v2/v4 los themes default no exponen nombres semánticos de brand; ponerlos en `tokens.color` los hace usables como `$primary` en cualquier prop de color, que es lo que ADR-023 pide (todo via token). Decisión menor.
6. **`@react-navigation/native` y `native-stack` quedan en deps**: ADR-013 dice que Expo Router reemplaza React Navigation, pero expo-router se construye SOBRE react-navigation internamente. Dejé las entradas explícitas para no romper resoluciones; son inofensivas. Anotado como posible limpieza menor futura.
7. **Node v20.13.1 < requerido 20.19.4**: expo tira un warning de Node desactualizado, pero el export completó igual. No bloquea el scaffold; conviene que Raf actualice Node a 20.19.4+ LTS cuando pueda.

## 7. Fuera de scope (intacto)

NO se tocó backend, migrations, `supabase/`, ni nada fuera de `app/`. Los servicios existentes
(`src/services/supabase.ts`, `push-notifications.ts`, `src/utils/env.ts`) y los barrels vacíos
de `src/` quedaron sin cambios. No se construyó la home ni pantallas reales (solo stubs).
