# ADR-013 — Stack de frontend para RAFAQ

**Status**: Accepted (pendiente de validación al ejecutar Fase 3+ del spec 01)
**Fecha**: 2026-05-25
**Decisores**: Raf

## Contexto

RAFAQ tiene un posicionamiento de "el mejor en el primer try" frente a competencia naciente (ver memoria `product-positioning`). El frontend de la app va a ser el principal diferenciador percibido por el usuario: necesita ser hiper-profesional, polish nivel B2B premium, y al mismo tiempo **manga-friendly** (operario con barro, sangre, guantes, una mano, sol directo, sin red).

El desarrollo lo hace una sola persona (Raf) en su tiempo libre, con apoyo de Claude Code. Las decisiones de stack tienen que:

1. **Permitir alta calidad de UX sin requerir un equipo de diseño**: defaults sensatos, design tokens, componentes accesibles por default.
2. **Performance real en device de gama media** (probable equipo del peón): nada de jank, animaciones a 60fps, listas largas fluidas.
3. **Iteración rápida**: pushes OTA sin pasar por App Store cada vez que hay un fix, dev builds rápidos, hot reload confiable.
4. **Observabilidad temprana**: ver cómo el operario real usa la app en producción para iterar el UX antes de escalar.
5. **Cero costo inicial**: tiers gratuitos suficientes para MVP con 1-3 campos beta.

El backend ya está definido por `ADR-002` (Expo + Supabase + PowerSync + TypeScript). Este ADR cubre solo la capa de presentación dentro de Expo/React Native.

## Decisión

Adoptamos el siguiente stack de frontend, en capas:

### Capa 1 — Design system y componentes
**`Tamagui`** como design system + biblioteca de componentes + sistema de theming.

- Tokens centralizados (colores, tipografía, espaciado).
- Optimizing compiler que reduce el bundle y mejora performance vs alternativas.
- Responsive props inline (`size="$4" sm={{ size: "$3" }}`), perfecto para portrait/landscape de manga.
- Accessibility por default (roles ARIA, focus management).
- Soporta también web (Expo Web) sin código duplicado, útil para landing y eventual admin web.

### Capa 2 — Routing
**`Expo Router`** (file-based routing).

- Reemplaza la configuración imperativa de React Navigation (que ya está en el repo via `@react-navigation/native`). La migración se hace antes de empezar Fase 3 del spec 01 — es mínima porque hay cero pantallas.
- Deep linking automático (necesario para `R5.4` aceptación de invitaciones via magic link).
- Tipado fuerte de rutas.
- Convenciones de layout que disciplinan la estructura de pantallas.

### Capa 3 — Animaciones y gestos
**`react-native-reanimated 3`** + **`react-native-gesture-handler`** + **`moti`**.

- Reanimated 3 corre las animaciones en el UI thread (60fps reales, sin bloqueo cuando JS está ocupado).
- Gesture handler resuelve swipes, long-press, pinch en manga con guantes (toques imprecisos).
- Moti es la capa declarativa encima de Reanimated — trivializa transitions de entrada/salida, perfecta para micro-interacciones de polish.
- **`lottie-react-native`** para animaciones de éxito/error/loading (After Effects → JSON → reproducible en mobile).

### Capa 4 — Manga-friendly específico
- **`expo-haptics`** — feedback táctil. El operario con guantes/barro siente la vibración aunque no vea la pantalla.
- **`expo-speech`** — dictado de notas (texto-a-voz). Útil para anotar observaciones sin tipear.
- **`@react-native-voice/voice`** — voz-a-texto. "Cargá observación: vaca preñada, cuerpo 3" sin tocar pantalla.
- **`expo-screen-orientation`** — bloquear orientación según pantalla (landscape para listas anchas, portrait para wizard).
- **`expo-keep-awake`** — pantalla siempre prendida durante sesión de manga.

### Capa 5 — Build, deploy y OTA
**`EAS Build`** + **`EAS Update`** (servicios de Expo).

- EAS Build hace builds nativos en la nube — necesario porque Raf no tiene Mac local para iOS.
- EAS Update permite pushes Over-The-Air al usuario: bug fix → 5 min → todos los dispositivos actualizan al abrir la app, sin pasar por App Store review.
- Tier gratuito (30 builds/mes + updates ilimitados) sobra para MVP con 1-3 campos.

### Capa 6 — Testing E2E
**`Maestro`** en lugar de Detox.

- Sintaxis YAML legible (no JS), tests más mantenibles.
- Ejecución más rápida que Detox.
- Mejor soporte de comunidad y documentación al 2026.
- Funciona contra simulador y device real.

### Capa 7 — Observabilidad
**`Sentry`** (errors + performance) + **`PostHog`** (analytics + session recordings).

- Sentry tier gratuito (5k events/mes) cubre MVP. Crítico para detectar crashes en device real desde día 1.
- PostHog tier gratuito (1M eventos + 5k recordings/mes) habilita session recordings: ver cómo el operario real usa la app en manga. **Esto es el research tool más poderoso que tenemos** — vemos donde se traba, donde duda, donde abandona.

### Capa 8 — Asistencia y design integration (Claude Code)
**`Figma MCP`** + **`Supabase MCP`** instalados en Claude Code.

- Figma MCP permite que Claude lea archivos de Figma y los traduzca a componentes Tamagui con fidelidad alta. Pipeline: Raf diseña en Figma → Claude implementa.
- Supabase MCP permite que Claude consulte la DB en vivo para debugging de RLS y verificación de datos durante implementación.

## Alternativas consideradas

### Native CSS-in-JS (StyleSheet de RN o styled-components)
- **Pros**: cero deps externas, control total.
- **Contras**: hay que reinventar tokens, theming, dark mode, accessibility. Cuatro meses de trabajo para tener algo equivalente a Tamagui. **Descartada por costo/oportunidad**.

### NativeWind (Tailwind para RN)
- **Pros**: productividad altísima si vienes de web, comunidad grande.
- **Contras**: no es un design system completo (te da utilities pero no componentes ni tokens estructurados). Performance peor que Tamagui en pantallas con muchas listas. Mantenimiento histórico con baches. **Descartada por menor robustez**.

### Gluestack UI v2 (componentes copy-paste)
- **Pros**: componentes muy polished, templates listos, copy-paste a tu proyecto (no es dep).
- **Contras**: menos performance que Tamagui en listas largas (caso típico en RAFAQ: lista de animales). Menos optimización compile-time. **Cerca de ganar — pero la performance en manga manda**.

### Detox para E2E
- **Pros**: ecosistema maduro, integración con CI estándar.
- **Contras**: sintaxis JS más verbose, ejecución lenta, configuración compleja. **Descartada por mantenibilidad**.

### Firebase Analytics + Crashlytics en lugar de Sentry+PostHog
- **Pros**: stack Google estándar, integración con BigQuery.
- **Contras**: PostHog session recordings es el feature killer aquí — Firebase no lo tiene. Sentry tiene mejor performance monitoring. **Descartada**.

## Consecuencias

**Positivas**:

- Stack opinionated pero documentado. Cualquier futura decisión de "agregar X" se evalúa contra estas elecciones.
- Toda la cadena de polish está cubierta: design tokens (Tamagui) → routing (Expo Router) → animaciones (Reanimated + Moti) → feedback (Haptics + Lottie) → observabilidad (Sentry + PostHog).
- Costo recurrente cero hasta volumen real (>5k users + miles de session recordings).
- Compatibilidad con Expo SDK 56 (ya en el repo) verificada para todas las libs elegidas.

**Negativas**:

- Tamagui tiene curva de aprendizaje moderada (1-2 días). Mitigado porque toda nueva pantalla la implementamos juntos.
- Expo Router cambia el patrón de navegación. Hay que migrar el setup actual de `@react-navigation/native` — pero como aún no se escribió código de cliente, el costo es mínimo.
- Maestro requiere instalar el CLI por separado en máquina de dev (no es paquete npm). Curva inicial de 30 min.
- Cada herramienta adicional (Sentry, PostHog) implica una cuenta más para administrar.

**Notas de implementación**:

- La adopción es **incremental**. No agregamos todo el stack de una. Cuando arranque Fase 3, agregamos Tamagui + Expo Router + Reanimated (las 3 capas críticas). Sentry/PostHog en Fase 5-6 (antes de beta). Maestro en Fase 8 (QA).
- Antes de Fase 3 conviene migrar el routing a Expo Router (ya está el scaffold base). Es 30 min de trabajo y evita reescribir después.
- Si alguna lib del stack tiene un breaking change que la rompe en futuro Expo SDK, evaluar antes de migrar el SDK.
- Las MCPs (Figma + Supabase) no son del proyecto — son herramientas del entorno de Raf. Pero documentamos su uso porque cambian cómo Claude opera en este repo.
