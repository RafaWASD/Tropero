# A.1 — Home de RAFAQ, Incremento 1 (ADR-023, design system derivado de la home)

> Infraestructura/diseño incremental, NO una feature con spec (igual naturaleza que B.0).
> Construye la home a mano como "test de cobertura" del design system (ADR-023 §5):
> derivamos los tokens/componentes que faltan al armarla. Modo colaborativo/incremental:
> SOLO lo del incremento 1, verde y renderizable. NO dropdown del switch (R6.8.1), NO
> "Mis campos"/EstablishmentCard, NO otras pantallas.

baseline_commit: 9f1803740290cf5a28374738612ba5eb69238d53

## Plan (tareas del incremento 1)

- [x] T1 — Cargar la fuente Inter de verdad (gate de splash en `_layout.tsx`).
- [x] T2 — Componente `Button` (pill, primary/secondary, fullWidth, $touchMin).
- [x] T3 — Componente `Card` (surface bone, radius $card, sombra suave).
- [x] T4 — Componente `Stepper` (riel vertical, círculos centrados, active/future).
- [x] T5 — Home real en `app/(tabs)/index.tsx` (header + saludo + banner descartable + wizard + CTA).
- [x] T6 — Verificación: typecheck + check.mjs + expo export web.

## Estado: COMPLETO — typecheck verde + check.mjs verde + expo export -p web OK (dist/ generado).

> Nota sobre tests: igual que B.0, este es un incremento de infra/diseño SIN spec
> (no hay R<n>). No existe runner de tests unitarios de UI en `app/` (no hay jest;
> el testCommand del harness = typecheck del cliente + suites backend). El gate de
> verificación de frontend, por precedente de B.0 y por consigna explícita de la
> tarea, es: typecheck + check.mjs + expo export web bundleando sin error. Los 3 verdes.

---

## 1. Carga de fuente Inter (T1)

- Instalado vía `expo install`: `@expo-google-fonts/inter@^0.4.2` + `expo-splash-screen@~56.0.10`
  (este último agregó su config plugin a `app.json` automáticamente). `expo-font` ya
  estaba (transitive). `expo install` también trajo `react-dom` (peer de web, útil para
  `expo export -p web`).
- En `app/app/_layout.tsx`: `SplashScreen.preventAutoHideAsync()` a nivel módulo +
  `useFonts({...})` mapeando los módulos del paquete a los NOMBRES DE FAMILIA que el
  `face` de `tamagui.config.ts` espera:
  - `Inter` ← `Inter_400Regular`
  - `Inter-Medium` ← `Inter_500Medium`
  - `Inter-SemiBold` ← `Inter_600SemiBold`
  - `Inter-Bold` ← `Inter_700Bold`
- **Gate**: el árbol NO se renderiza (`return null`) hasta `fontsLoaded || fontError`.
  Al estar listo se llama `SplashScreen.hideAsync()` (vía effect + onLayout). Si las
  fuentes fallan, seguimos igual (cae a system sans, no pantalla negra eterna).
- **Config**: cambié `interFont.family` de la lista CSS `'Inter, System, …'` a solo
  `'Inter'`. En native RN el `fontFamily` debe ser un nombre de familia REAL (una lista
  con comas se interpretaría literal y no resolvería). Por peso el `face` pisa la base
  con la familia exacta cargada. Verificado: el export bundleó los 7 pesos como assets
  `.ttf` y el plugin de Tamagui corrió OK sobre todas las pantallas/componentes.

## 2. Componentes creados (`app/src/components/`, exportados por el barrel)

### `Button` — `Button.tsx`
API (`ButtonProps`):
- `children: string` (label).
- `variant?: 'primary' | 'secondary'` (default `primary`). primary = relleno `$primary`
  + texto `$white` + press `$primaryPress`; secondary = outline `$primary` + texto
  `$primary` + transparente + press `$surface`.
- `fullWidth?: boolean` (default `false`). true → `alignSelf:'stretch'` + `width:100%`.
- `disabled?: boolean` → opacidad 0.5 + bloquea onPress + `accessibilityState`.
- resto de props del frame (`onPress`, márgenes, etc.) vía spread.
- Forma pill (`$pill`), `minHeight: $touchMin` (56px), Inter 600 16px (`$5`). `borderWidth:2`
  siempre (transparente en primary) para que primary/secondary tengan el mismo alto.

### `Card` — `Card.tsx`
API (`CardProps` = `GetProps` del frame): cualquier prop de `View` de Tamagui.
- Fondo `$surface` (bone), `borderRadius: $card` (16), `padding: $4`, + `shadows.card`
  (objeto de estilo del config, ver §3). Es un `styled(View)` re-exportado, así que
  acepta overrides (ej. `marginTop="$4"`).

### `Stepper` — `Stepper.tsx`
API (`StepperProps`): `{ steps: StepperStep[] }`. `StepperStep = { title, body,
state: 'active'|'future', children? }`.
- Riel vertical: línea conectora (2 segmentos por paso, hairline 1px `$divider`) que pasa
  por el centro de TODOS los círculos (mismo diámetro `$icon`=48). active = relleno
  `$primary` + icono lucide `Plus`; future = borde `$divider` 2px, fondo `$surface`,
  número en `$textMuted` (Inter 600). Título Inter 600 `$textPrimary` + body Inter 400
  `$textMuted` debajo. `children` = slot debajo del body (el CTA del paso activo).

## 3. Tokens nuevos en `tamagui.config.ts` (y por qué)

- `size.avatar = 40` — diámetro del avatar de usuario del header (lo necesitaba la home).
- `size.icon = 48` — diámetro de contenedores de ícono circulares (el círculo del banner
  "establecimiento listo" y los círculos del Stepper). Unifica ambos.
- `export const shadows = { card: {...} }` — sombra suave de cards. Tamagui v4 NO expone
  tokens de sombra (shadowColor/Offset/Opacity/Radius/elevation son props de estilo, no
  un escalar tokenizable), así que se centraliza como OBJETO de estilo exportado (no token
  `$`). Sigue siendo fuente única del valor: `Card` y el FAB futuro lo importan en vez de
  hardcodear. `shadowColor` = `$textPrimary` (negro de marca, no #000), opacity 0.06, radius
  12, offset (0,2), elevation 2. Marcado PROVISIONAL (se evalúa un sistema de elevación al
  canonizar el design system).
- Nota: NO migré la sombra inline del FAB en `(tabs)/_layout.tsx` a `shadows.card` — son
  sombras distintas (el FAB es verde y más marcada) y el `_layout.tsx` está fuera del scope
  ("no lo toques salvo necesidad real"). Queda como limpieza futura al canonizar.

## 4. Home (`app/app/(tabs)/index.tsx`)

Reproduce `design/stitch-iter-4/00-home-CANONICAL.png`, ensamblada con Button/Card/Stepper:
- **Header propio** (tab con headerShown:false): switch `Building2 + "La Juanita" + ChevronDown`
  ESTÁTICO (Pressable sin onPress, TODO ref R6.8.1 — dropdown es incremento posterior);
  wordmark "RAFAQ" (Inter 700 `$primary`); avatar circular placeholder (`$avatar`, círculo
  `$surface` con ícono `User`).
- **Saludo** "¡Hola Lucas! 👋" (Inter 700 `$9` `$textPrimary`).
- **Banner descartable** (`ReadyBanner` con `Card`): círculo `$greenLight` + `Check` verde,
  texto "Tu establecimiento **La Juanita** está listo." (negrita en el nombre), `X` a la
  derecha. `useState(bannerVisible)`; tocar ✕ → `false` → desaparece.
- **Wizard**: `Stepper` con los 3 pasos del mockup; el CTA `Button` primary fullWidth
  "Crear rodeo" inyectado como `children` del paso activo (onPress TODO, fuera de scope).
- Fondo `$bg`; `paddingTop={insets.top}` (safe-area arriba); `ScrollView` para el cuerpo.
- Copy: voseo + tildes correctas (Creá, configurá, Definí, cría, recría, Cargá, Invitá,
  Sumá, específicos).

## 5. Desviaciones / decisiones de criterio

1. **Avatar = placeholder ícono `User` en círculo bone** (no foto). El mockup tiene una foto
   real; sin asset de avatar real, uso `$surface` + borde `$divider` + ícono `User` gris.
   Tamaño `$avatar`=40 (proporción del mockup respecto al header). Reversible cuando haya foto.
2. **Header construido a mano en la pantalla** (no como componente reusable todavía). El task
   pide "header propio de la pantalla"; lo dejé como sub-funciones locales (`HomeHeader`,
   `ReadyBanner`). Si se repite en otras pantallas se extrae a `src/components` (no era scope).
3. **`borderRadius={9999}` literal para círculos** (avatar, banner, círculos del stepper): es
   el valor del token `$pill`, pero para Views circulares de tamaño fijo el literal 9999 es lo
   idiomático y es lo que el propio config usa para `$pill`. No es color ni spacing semántico.
4. **`width={1}` / `borderWidth={2}`** en el Stepper: hairline de la línea conectora y grosor
   de borde de los círculos. Detalle de render sin token equivalente en la escala; documentado
   en el comentario del componente. NO son tokens de spacing/color.
5. **Sombra como objeto exportado, no token `$`** (ver §3): forzado por la API de Tamagui v4.
6. **Sin tests unitarios de UI**: no hay runner (ver nota de estado arriba). Gate = typecheck +
   check + export, por precedente B.0 y consigna de la tarea.

## 6. Verificación (3/3 verdes)

| Check | Resultado |
|---|---|
| `cd app && pnpm.cmd typecheck` | **VERDE** (tsc --noEmit, sin errores) |
| `node scripts/check.mjs` (root) | **VERDE** — typecheck cliente + RLS + Edge + Animal 19/19 (backend intacto) |
| `cd app && pnpm.cmd exec expo export -p web` | **OK** — 3471 módulos bundleados; plugin Tamagui corrió sobre index/Button/Card/Stepper (flat); 7 pesos Inter como assets .ttf; `dist/` generado (NO borrado, para screenshot) |

## 7. Fuera de scope (no construido, como pide la consigna)

- Dropdown del switch de establecimiento (R6.8.1) — switch estático con TODO.
- "Mis campos" / `EstablishmentCard` — no se tocó.
- Otras pantallas — solo la home.
- Navegación real de los CTAs ("Crear rodeo", switch) — TODOs.
- Backend / migrations / supabase/ — INTACTO. `(tabs)/_layout.tsx` no tocado.
