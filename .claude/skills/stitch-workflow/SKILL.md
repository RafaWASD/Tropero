---
name: stitch-workflow
description: "Flujo adaptado para importar designs de Google Stitch al proyecto RAFAQ (React Native + Expo + Tamagui + Reanimated). Pipeline: conectar Stitch MCP → listar/importar proyecto → adaptar si Stitch exportó código web → auditar contra stack target → aplicar fixes en orden → validar con check.mjs → levantar Metro. TRIGGERS OBLIGATORIOS: 'stitch workflow', 'importá de stitch', 'pasá esto de stitch a RAFAQ', 'auditá lo importado de stitch', 'stitch-to-RN'. TRIGGERS FUERTES (con contexto de import): 'traete este flujo de stitch', 'el proyecto X de stitch ya está listo', 'meté esto en el repo'. NO disparar para diseños hechos en Figma manualmente, exports de otros sistemas, o cuando no hay un proyecto de Stitch identificado."
---

# Stitch → RAFAQ Workflow

> Versión adaptada del prompt original "Diseños con Stitch y Claude Code" al stack RAFAQ. La estructura general (fases + puertas + checklist + diff contra `/imported`) se preserva. El contenido específico (animaciones, tokens, server, validaciones) está reescrito para React Native + Expo + Tamagui + Reanimated.

---

## Stack target obligatorio

Este flujo asume el stack de RAFAQ:

- **React Native + Expo** (no React DOM, no Next.js, no Vite).
- **TypeScript strict**.
- **Tamagui** (no Tailwind, no CSS Modules, no styled-components).
- **Reanimated + Moti** (no Framer Motion).
- **Expo Router** (no react-router, no next/router).
- **PowerSync** (offline-first).
- **Supabase** (auth + DB + Edge Functions + Storage).

**Si Stitch exporta código web (HTML + Tailwind + Framer Motion + React DOM)**, el primer paso después de importar **NO es auditar** — es **traducir a React Native + Tamagui**. Marcarlo como CRÍTICO en la auditoría inicial. No tocar fixes hasta que la traducción esté hecha o se confirme que no hace falta.

---

## Fase 0 — Conectar Stitch MCP

Usar la configuración MCP de Stitch ya instalada en el repo. Verificar que la conexión esté activa listando los proyectos disponibles.

Si falla, reportar el error exacto y **frenar ahí**. No improvisar workarounds (ej: pedirle al usuario que pegue el código manual).

Una vez conectado:

- Listar todos los proyectos y diseños disponibles en Stitch:
  - Nombre
  - ID
  - Última modificación
  - Descripción (si existe)

Mostrarlos numerados y esperar a que el usuario elija uno antes de hacer cualquier otra cosa.

---

## Fase 1 — Importar

Cuando el usuario confirme:

Importar el diseño seleccionado vía MCP. Traer absolutamente todo:

- Código de componentes
- Assets (imágenes, SVGs, fonts si las hay)
- Layout
- Estilos embebidos
- Cualquier metadata útil (design tokens si Stitch los exporta, etc.)

Guardar la importación cruda en `/imported/<nombre-proyecto>/` sin modificar nada.

Ese directorio es la **fuente de verdad inmutable**. Nunca recrear ni inferir el diseño desde memoria — trabajar únicamente con lo que devuelva el MCP.

Después de importar:

Mostrar el árbol completo de archivos y esperar confirmación del usuario antes de seguir.

---

## Fase 2 — Análisis de compatibilidad con stack target (NUEVO — CRÍTICO)

**Antes de auditar nada de calidad, validar compatibilidad con stack RAFAQ.**

Escanear lo importado y clasificar:

### 2.1 — ¿El código importado es web o React Native?

| Indicador | Si está presente → | Acción |
|---|---|---|
| Elementos HTML (`<div>`, `<span>`, `<button>`, `<img>`) | **WEB** | Necesita traducción a primitives RN (`View`, `Text`, `Pressable`, `Image`) |
| Imports de `react-dom` | **WEB** | Crítico — no existe en RN |
| Imports de `next/*` o `vite/*` | **WEB** | Crítico — incompatible |
| Tailwind classes (`className="bg-blue-500 p-4"`) | **WEB** | Crítico — RAFAQ usa Tamagui, no Tailwind. Hay NativeWind pero no es el patrón canónico |
| CSS imports (`.css`, `.scss`, `.module.css`) | **WEB** | Crítico — no funciona en RN |
| `motion.*` de Framer Motion | **WEB** | Reemplazar por `Animated.View` de Reanimated o `MotiView` |
| `useReducedMotion` de framer-motion | **WEB** | Existe en RN pero distinto: `useReducedMotion` de `react-native` |
| APIs DOM (`document.*`, `window.*`, `localStorage`) | **WEB** | Crítico — no existe en RN. Usar `AsyncStorage` o equivalentes |
| Media queries (`@media (min-width: ...)`) | **WEB** | RN usa `Dimensions` API + estilos condicionales |
| Hover states (`:hover`) | **WEB** | RN no tiene hover (solo `:pressed`) — adaptar o eliminar |

Si **cualquiera** de los indicadores web está presente → el código es **WEB** y necesita traducción.

### 2.2 — Si es WEB, parar y reportar

NO continuar con la auditoría de calidad. Reportar al usuario:

```
El proyecto importado de Stitch contiene código web.
Componentes detectados: [lista]
Tecnologías web encontradas: [Tailwind / Framer Motion / etc.]

Opciones:
1. TRADUCIR a React Native + Tamagui antes de continuar.
   Estimación: depende del tamaño del proyecto, típicamente 1-3 sesiones.
   Pro: el código termina utilizable en RAFAQ.
   Contra: trabajo significativo.

2. DESCARTAR este import y volver a generar en Stitch pidiendo explícitamente
   "React Native + Tamagui" en el prompt original.
   Pro: ahorra trabajo de traducción.
   Contra: Stitch puede no soportar bien generar RN nativo.

3. USAR como REFERENCIA VISUAL solamente.
   Vos extraés mentalmente la dirección visual del HTML/CSS importado y yo
   ayudo a recrearla en Tamagui desde cero. No se preserva código.
   Pro: limpio, código nuevo cumple convenciones desde día 1.
   Contra: perdés el "exportable a code" que Stitch promete.
```

Esperar decisión del usuario antes de continuar.

### 2.3 — Si es RN/compatible, continuar a Fase 3

Si Stitch exportó componentes RN compatibles (raro hoy pero podría pasar con configuración específica), seguir directo a auditoría.

---

## Fase 3 — Auditoría de calidad

> Solo correr esta fase si Fase 2 dio "código compatible con stack" o si la traducción ya fue completada y aplicada.

Escanear todo el código importado/traducido y generar checklist numerada usando:

✅ OK
⚠️ Menor
❌ Crítico

**Criterio para "skip"**: solo saltar un punto si el código no contiene ese tipo de elemento (ej: si no hay imágenes, el punto de `alt` no aplica). Documentar el skip con razón explícita. **NO saltar por "parece menor" o "se ve bien" — esos son menores con ⚠️, no skips.**

### Revisar

**1. Tipografías**
- Múltiples familias usadas de forma inconsistente.
- Pesos hardcodeados vs heredados.
- Fonts cargadas vía `expo-font` con assets locales (NO vía `<link>` web).
- Headings con fuente distinta entre secciones.

**2. Tamaños de headings**
- H1/h2/h3 (en RN típicamente `<Text variant="h1">` con Tamagui) inconsistentes entre secciones.
- Mezcla de unidades arbitrarias en lugar de tokens del theme.

**3. Colores**
- Hex / rgb hardcodeados en lugar de tokens Tamagui.
- Sin sistema de tokens en `tamagui.config.ts`.
- Mismo color visual usado de forma inconsistente entre componentes.
- Colores fuera de la paleta canónica del design system.

**4. Animaciones**
- Mezcla de Reanimated + Moti en el mismo componente sin razón.
- Animaciones de entrada faltantes en pantallas críticas.
- Stagger inconsistente.
- Ausencia de exit animations donde corresponde.
- No respeta `useReducedMotion` de RN.

**5. Estados interactivos**
- `Pressable` sin `onPressIn` / `onPressOut` para feedback visual.
- Falta de `disabled` state visual.
- Touch feedback inconsistente entre botones.
- En vez de `:hover` (web) → estados `pressed` y `focused` de RN.

**6. Espaciado**
- Padding/margin hardcodeados en lugar de tokens Tamagui (`$2`, `$4`, `$space.md`).
- Mezcla de unidades.
- Inconsistencia entre pantallas equivalentes.

**7. Z-index**
- En RN se usa `zIndex` en estilos (sí funciona). Valores ilógicos o sobrepuestos.
- Posibles overlays mal renderizados por orden de stack en lugar de zIndex.

**8. Responsive**
- Tap targets ≥ **60-64px** para CTAs primarios (CLAUDE.md principio 4 — operador con guante).
- Tap targets ≥ 48px para secundarios.
- Layout adapta entre device chico (iPhone SE) y device grande (iPhone Pro Max).
- Texto mínimo 16px para legibilidad al sol.
- Densidad visual respeta el principio "una decisión por pantalla".

**9. Estructura de componentes**
- Falta de `key` en listas (`FlatList` / `SectionList` / `map`).
- Props sin default donde corresponde.
- Prop drilling innecesario (¿debería estar en Context o Zustand?).
- Componentes > 200 líneas que deberían extraerse.
- Uso de `<View>` cuando un `<Pressable>` sería más correcto, etc.

**10. State management**
- Estado compartido mal ubicado (en componente cuando debería ser global).
- Posibles race conditions con queries async.
- Falta uso de los Contexts/hooks ya provistos por specs (AuthContext, EstablishmentContext, RodeoContext de spec 02).

**11. Performance**
- Assets pesados (imágenes > 500KB sin optimizar).
- Lazy loading faltante para pantallas no críticas (con `expo-router` lazy routes).
- Re-renders innecesarios (¿falta `React.memo`, `useMemo`, `useCallback`?).
- Listas largas sin `FlatList` virtualizado.

**12. Accesibilidad**
- `accessibilityLabel` faltantes en elementos interactivos.
- `accessibilityRole` correcto (`button`, `header`, `link`).
- Imágenes sin `accessibilityLabel` o marcadas como decorativas.
- Contraste insuficiente (validar WCAG AA mínimo, AAA preferido para uso al sol).
- Tamaño de fuente respeta `Dynamic Type` / `PixelRatio.getFontScale()` para usuarios con configuración de accesibilidad activa.

**13. Dead code**
- Imports sin usar.
- Comentarios viejos del código web original que ya no aplican.
- Duplicados.
- Ramas inalcanzables.
- Restos de Tailwind / CSS / Framer Motion que sobraron de la traducción.

**14. Environment**
- URLs / API keys hardcodeadas en el código.
- Falta de uso de `expo-constants` o `process.env.EXPO_PUBLIC_*` para variables de entorno.
- Secrets que deberían estar en Supabase Edge Functions Secrets (`supabase secrets set`).

**15. Consola**
- Warnings de RN en Metro bundler.
- Keys faltantes en listas.
- Referencias undefined.
- Warnings de Reanimated sobre worklets.

**16. Compatibilidad con stack target (PUNTO NUEVO — CRÍTICO)**
- ¿Sobrevive algún `<div>`, `<span>`, `<button>` HTML? → Crítico (queda código web).
- ¿Algún import de Framer Motion / react-dom / next/* / vite/*? → Crítico.
- ¿Tailwind classes? → Crítico (debería ser Tamagui).
- ¿Hover states sin equivalente RN? → Menor.
- ¿APIs DOM (`document`, `window`, `localStorage`)? → Crítico.

**17. Convenciones RAFAQ (PUNTO NUEVO)**
- ¿Idioma de UI en español? (CLAUDE.md convención).
- ¿Idioma de código (variables, funciones, comments) en inglés? (CLAUDE.md convención).
- ¿Multi-tenant respetado? (toda query con `establishment_id` del context activo).
- ¿Offline-first? (¿el componente asume conectividad o maneja estado sin red?).
- ¿Patrón split insert + select de ADR-012 donde aplica?

### Al final mostrar

- Total de críticos
- Total de menores
- Skips documentados con razón

Y pedir confirmación antes de tocar nada.

---

## Fase 4 — Fixes (construir encima del importado)

**Siempre hacer diff contra `/imported/<nombre-proyecto>/`.**

Si un fix requiere borrar más de 20 líneas originales, **avisar al usuario antes** y explicar por qué.

Aplicar en este orden exacto.

### 4.1 — Sistema de tokens (Tamagui)

Extraer a `tamagui.config.ts` (o equivalente del proyecto):

```typescript
import { createTokens, createTamagui } from 'tamagui'

const tokens = createTokens({
  color: {
    /* colores del design system canónico */
  },
  space: {
    /* spacing scale */
  },
  size: {
    /* sizing scale */
  },
  radius: {
    /* border-radius scale */
  },
  zIndex: {
    /* z-index scale */
  },
  // ...
})

const config = createTamagui({
  tokens,
  themes: {
    light: { /* ... */ },
    dark: { /* ... */ },
  },
  // ...
})

export default config
```

Reemplazar **todos** los hardcoded values en los componentes por referencias a tokens (`$color.brandPrimary`, `$space.md`, `$radius.lg`, etc.).

Después de este paso: no puede quedar ningún valor crudo (hex, rgb, px hardcoded, números arbitrarios) en los componentes.

### 4.2 — Tipografía

Definir escala consistente en `tamagui.config.ts`:

```typescript
const fonts = {
  heading: createFont({ /* Inter o la que canonice el design system */ }),
  body: createFont({ /* idem */ }),
  mono: createFont({ /* monospace para códigos / datos */ }),
}
```

Cargar las fonts con `expo-font` + `useFonts` hook al boot:

```typescript
import { useFonts } from 'expo-font'

const [fontsLoaded] = useFonts({
  'Inter-Regular': require('./assets/fonts/Inter-Regular.ttf'),
  // ...
})
```

Si la fuente es ambigua entre dos opciones del design system: **preguntar al usuario** antes de elegir.

Corregir:
- Headings (`<H1>`, `<H2>`, `<H3>` de Tamagui)
- Subheadings
- Labels
- Captions
- Body (`<Paragraph>`, `<Text>`)

Normalizar pesos. Evitar FOUT con splash screen hasta que `fontsLoaded === true`.

### 4.3 — Consistencia de color

Eliminar colores crudos restantes. Validar que toda referencia de color use el token system.

Si el design system tiene dark/light theme:
- Definir ambos en `tamagui.config.ts`.
- Componentes usan tokens semánticos (`$color.background`, `$color.text`) que cambian según theme.
- No hardcodear colores específicos del light o dark.

Validar contraste WCAG AA mínimo, AAA preferido. Para uso al sol en campo, AAA es target.

### 4.4 — Spacing y layout

Normalizar:
- Padding / margin → tokens `$space.*`.
- Gap en stacks → tokens.
- Tamaños fijos → tokens `$size.*`.

Revisar layouts equivalentes en diferentes devices:
- iPhone SE (375x667)
- iPhone Pro Max (430x932)
- iPad mini (744x1133) — si aplica

Usar `Dimensions` API + Tamagui media queries (`$gtSm`, `$gtMd`) en lugar de hardcoded breakpoints.

### 4.5 — Limpieza de componentes

Extraer JSX inline > 40 líneas a componentes propios.

Eliminar dead code:
- Imports sin usar (`pnpm run typecheck` + `pnpm run lint`).
- Comentarios viejos.
- Duplicados.
- Restos de la versión web (si hubo traducción).

Agregar:
- `key` en listas.
- Default props donde corresponde.
- Tipado TypeScript estricto (no `any`).

Reemplazar magic numbers por constantes nombradas.

### 4.6 — Animaciones y microinteracciones (REESCRITO PARA REANIMATED/MOTI)

**Antes de tocar código**:

Listar todos los elementos animables agrupados por:
- Entradas
- Salidas
- Pressed states (no hover en RN)
- Scroll
- Condicionales
- Loaders

Mostrar lista al usuario. Esperar confirmación.

**Regla**: elegir un solo sistema por elemento:
- **Reanimated 3** → para animaciones controladas (worklets en UI thread).
- **Moti** → para animaciones declarativas estilo Framer Motion (wrapper sobre Reanimated).

Nunca mezclar ambos en el mismo elemento sin razón documentada.

**Entradas (secciones / cards / headings)** — vía Moti:

```typescript
<MotiView
  from={{ opacity: 0, translateY: 28 }}
  animate={{ opacity: 1, translateY: 0 }}
  transition={{
    type: 'timing',
    duration: 700,
    easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
  }}
>
  {content}
</MotiView>
```

Nota: blur no es directo en RN (requiere `expo-blur` + animar `intensity`). Si el design system pide blur en entradas, evaluar caso por caso — puede degradarse a fade simple si performance lo justifica.

**Headline palabra por palabra** — vía Moti + stagger manual:

```typescript
{words.map((word, i) => (
  <MotiText
    key={i}
    from={{ opacity: 0, translateY: 40 }}
    animate={{ opacity: 1, translateY: 0 }}
    transition={{
      delay: i * 100,
      duration: 700,
      easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
    }}
  >
    {word}{' '}
  </MotiText>
))}
```

**Lists / grids** — `child stagger 90ms` con `delay: i * 90`.

**Pressable cards (no hay hover en RN)**:

```typescript
<Pressable
  onPressIn={() => scale.value = withSpring(0.98, { stiffness: 300, damping: 22 })}
  onPressOut={() => scale.value = withSpring(1, { stiffness: 300, damping: 22 })}
>
  <Animated.View style={animatedStyle}>{content}</Animated.View>
</Pressable>
```

**Botones**:
- `onPressIn` → `scale 0.95` con spring `400/20`.
- `onPressOut` → `scale 1` con mismo spring.
- Íconos direccionales (flecha): `translateX 3` al press.

**Links** — sin scale (igual que web). Subline animado con `scaleX 0 → 1`, duración 250ms.

**Elementos condicionales** — usar `AnimatePresence` de Moti:

```typescript
<AnimatePresence>
  {isVisible && (
    <MotiView
      from={{ opacity: 0, scale: 0.9, translateY: 10 }}
      animate={{ opacity: 1, scale: 1, translateY: 0 }}
      exit={{ opacity: 0, scale: 0.95, translateY: -6 }}
    />
  )}
</AnimatePresence>
```

**Counters** — animar de 0 al valor final con `useDerivedValue` + `withTiming({ duration: 1400 })` + `useAnimatedReaction` para mostrar el valor int en cada frame.

**Dividers** — `scaleX 0 → 1` con `transformOrigin: 'left'`, duración 900ms.

**Media (imágenes que aparecen)** — `scale 0.92 + opacity 0 → scale 1 + opacity 1`, duración 650ms.

**Transiciones de pantalla** — manejadas por `expo-router` con shared element transitions cuando aplique. Para custom: configurar `screenOptions` con `animation` y `animationDuration`.

**Scroll linked** — `useAnimatedScrollHandler` de Reanimated:
- Fondo parallax 0.4x.
- Foreground 0.85x.
- Hero scale 1 → 1.08 al scroll up.

**Reduced motion** — usar `useReducedMotion()` de `react-native`:

```typescript
import { AccessibilityInfo } from 'react-native'

const [reducedMotion, setReducedMotion] = useState(false)
useEffect(() => {
  AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion)
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion)
  return () => sub.remove()
}, [])
```

Si `reducedMotion === true`: reemplazar animaciones complejas (blur + transform) por fade simple.

### 4.7 — Responsive en RN

Revisar en 3 tamaños:
- 375px de ancho (iPhone SE)
- 430px de ancho (iPhone Pro Max)
- 768+ px de ancho (iPad si aplica)

Corregir:
- Overflow.
- Imágenes que se cortan.
- Texto que rompe layout.
- Comportamiento landscape (si la app lo soporta — confirmar antes).

Tap targets:
- Primarios (CTAs): mínimo **60-64px** (CLAUDE.md principio 4 — operador con guante).
- Secundarios: mínimo 48px.
- Density bajo el principio "una decisión por pantalla".

### 4.8 — Accesibilidad RN

Agregar:
- `accessibilityLabel` en cada elemento interactivo.
- `accessibilityRole` correcto.
- `accessibilityHint` cuando la acción no es obvia.
- `accessibilityState` en componentes con estado (selected, disabled, expanded).
- Imágenes decorativas marcadas con `accessibilityElementsHidden={true}`.
- Imágenes informativas con `accessibilityLabel` descriptivo.

Keyboard navigation no aplica en RN puro (solo en web). En iPad con teclado externo sí — testear si la app target lo incluye.

### 4.9 — Environment

Mover todo a `.env` con prefijo correcto:
- Variables del cliente Expo: `EXPO_PUBLIC_*` (ej: `EXPO_PUBLIC_SUPABASE_URL`).
- Variables del Edge Function: en `supabase secrets set` + `Deno.env.get('NAME')` desde el código.

Crear `.env.example` con placeholders + comentarios explicativos.

Verificar que `.env` está en `.gitignore`. Nunca commitear secrets reales.

Si encontrás secrets hardcodeados en código: ROTARLOS (asumir que están comprometidos) + reemplazar por lectura de env var.

### 4.10 — Auditoría final de consola

Levantar el dev server:

```bash
pnpm.cmd start
```

Notas Windows:
- Usar `pnpm.cmd` (NO `pnpm`) por Cylance Script Control.
- Expo abre Metro bundler en puerto 8081 + QR para device físico.
- Para device físico vía LAN: PC y device en misma red.
- Para tunnel (si LAN no funciona): `pnpm.cmd start --tunnel`.

Capturar logs de Metro + del device (Expo Dev Tools).

Corregir todo. No ocultar warnings sin explicar.

---

## Fase 5 — Verificación final

Diff entre `/imported/<nombre-proyecto>/` y estado actual del repo.

Mostrar:

**Archivos modificados**: qué cambió y por qué.

**Checklist final**: reevaluar todos los puntos de Fase 3. Todo debe quedar ✅ OK.

Si algo sigue crítico: explicar por qué y qué tiene que hacer el usuario.

**Validación con check.mjs del repo**:

```bash
node scripts/check.mjs
```

Tiene que quedar **verde** (typecheck + tests reales contra DB remota). Si falla:
- Si es typecheck: corregir los errores TS antes de declarar terminado.
- Si son tests RLS / Edge: NO debería romperse — el flujo de Stitch no toca DB. Si pasa, investigar si se introdujo algún import o cambio que rompe algo.

---

## Fase 6 — Server (cuando quede sin críticos)

Levantar Metro bundler:

```bash
pnpm.cmd start
```

Confirmar:
- Metro corriendo (output verde).
- QR code visible.
- Conexión desde device físico exitosa (cargar la app vía Expo Go o build dev).
- App carga sin pantalla roja.
- Terminal limpia sin errores ni warnings inesperados.

Si hay warnings esperados (ej: deprecations de librerías de terceros), documentarlos brevemente en el reporte de cierre.

---

## Fase 7 — Integración con SDD del proyecto (NUEVO)

Si el código importado introduce funcionalidad **no cubierta por specs activas**:

**DETENER**. La feature debe pasar por SDD (`spec_author` → aprobación humana → `implementer` → `reviewer`) antes de implementarse en el repo.

Este prompt **no reemplaza** el proceso SDD. Stitch puede generar pantallas hermosas que correspondan a una feature que todavía no tiene spec aprobada — en ese caso, la pantalla queda como **referencia visual** que después alimenta el `design.md` del spec correspondiente cuando se redacte.

Si el import es **refinamiento visual de algo ya specificado** (ej: pantalla SignUp del spec 01 que ya tiene R3.1..R3.8 aprobadas), continuar — es exactamente el caso de uso de este flujo.

Reglas de coherencia con SDD:

- El import nunca debe modificar `feature_list.json` directamente.
- El import nunca debe cambiar status de una spec sin pasar por el flujo de aprobación.
- El import nunca debe crear specs nuevas — eso es trabajo del `spec_author`.
- Si el import sugiere refinar una spec existente (ej: "necesito un campo nuevo que no está en R4 de spec 02"), **parar y reportar al leader** para que decida si refinar la spec o adaptar el import.

---

## Reporte de cierre

Al terminar Fase 5 o 6, generar reporte breve con:

1. **Proyecto Stitch importado**: nombre + ID + fecha.
2. **Decisión de Fase 2**: ¿se tradujo de web a RN? ¿se usó como referencia visual? ¿era nativo RN?
3. **Críticos resueltos**: lista con descripción de cada uno.
4. **Menores documentados pero no resueltos**: lista con razón.
5. **Skips documentados**: lista con razón.
6. **Archivos del repo modificados**: lista con conteo de líneas.
7. **Componentes nuevos creados**: lista con propósito.
8. **`check.mjs`**: verde / amarillo / rojo con detalle.
9. **Convenciones SDD respetadas**: confirmación de que no se cambió status de specs ni se introdujo funcionalidad sin spec aprobada.

---

## Cuando NO usar este flujo

- El usuario no mencionó Stitch ni tiene un proyecto Stitch identificado.
- El usuario quiere generar código RN desde cero sin import (eso es trabajo del `implementer` con spec aprobada).
- El usuario quiere editar componentes existentes que no vienen de un import de Stitch.
- El usuario quiere "auditar el proyecto entero" — eso requiere un flujo distinto, no este.
- El usuario quiere implementar una feature backend (DB, Edge Functions, RLS) — Stitch no genera eso, usar `implementer` directo.

## Cuando SÍ usar este flujo

- El usuario tiene un proyecto de Stitch listo y quiere traerlo al repo.
- El usuario dice "importá lo que generé en Stitch" o equivalente.
- El usuario quiere validar un design hecho en Stitch contra las convenciones de RAFAQ.
- El usuario quiere refinar visualmente una feature ya specificada usando algo que generó en Stitch como base.
