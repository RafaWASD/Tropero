// KeyboardAvoidingShell — EL primitivo de "no me tapes con el teclado" del repo. Un solo lugar donde se
// decide cómo cada plataforma le hace lugar al teclado; los consumidores solo lo envuelven.
// Este archivo es la implementación de **iOS y WEB**; la de **Android** vive en
// `KeyboardAvoidingShell.android.tsx` (resolución por extensión de plataforma del bundler, el mismo
// mecanismo que ya usa `AppleSignInButton.native.tsx`).
//
// ── EL BUG 🔴 QUE LO CREA (Raf, device Samsung con barra de 3 botones, APK release 7402575a) ──────────
// Al enfocar el input del sheet de Vacunación, **el teclado tapaba el sheet ENTERO**. En iOS el MISMO
// sheet sube bien. Fallaban DOS mecanismos apilados, y ninguno de los dos era visible desde web:
//
//  1. **`KeyboardAvoidingView` estaba en modo no-op en Android.** Los 4 call sites pasaban
//     `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`. En el componente de RN
//     (`Libraries/Components/Keyboard/KeyboardAvoidingView.js`) la rama `default` —behavior sin definir—
//     renderiza un `<View>` pelado, sin padding ni height: literalmente "en Android no hagas nada".
//     El comentario que acompañaba a esas 4 líneas decía que en Android "lo resuelve el `adjustResize` de
//     la ventana". Eso era cierto cuando se escribió y HOY ES FALSO, por (2).
//
//  2. **El `adjustResize` en el que se apoyaba está desactivado por el EDGE-TO-EDGE.** El manifest
//     generado sigue diciendo `adjustResize`, pero el build fuerza edge-to-edge y con eso el sistema deja
//     de encoger la ventana. Cadena verificada sobre los artefactos que genera el build real:
//     `android/gradle.properties (edgeToEdgeEnabled=true)` → `BuildConfig.IS_EDGE_TO_EDGE_ENABLED` →
//     `ReactNativeApplicationEntryPoint.setEdgeToEdgeFeatureFlagOn()` → `ReactActivityDelegate` →
//     `WindowUtil.kt` → `WindowCompat.setDecorFitsSystemWindows(window, false)`. En TODO `ReactAndroid`
//     hay 3 referencias al inset del IME (`ReactRootView.java:971,976,978`) y las tres viven en un método
//     que solo **emite un evento a JS**: nadie compensa el layout. Confirmado en las capturas del device:
//     las tarjetas de fondo quedan en el MISMO `y` con y sin teclado.
//     No se puede apagar: `@expo/prebuild-config` removió la llave de `app.config.ts` ("Android 16 makes
//     edge-to-edge mandatory"), `/android` está gitignoreado, y `expo-modules-core` lo re-enciende con
//     default `?: true`.
//
//  3. **Y la fuente de datos del teclado de RN también está mal**, así que NO alcanzaba con cambiarle el
//     `behavior` a `'padding'` en Android: `ReactRootView.java:978` calcula
//     `height = imeInsets.bottom - barInsets.bottom` — le **resta la barra de navegación** (~48dp en el
//     device de Raf), cálculo escrito para el mundo pre-edge-to-edge. Y `KeyboardAvoidingView` consume
//     `endCoordinates.screenY`, que bajo una ventana que NO encoge es el bottom de la ventana → el padding
//     que calcularía da ~0.
//
// ── POR QUÉ SEPARADO POR EXTENSIÓN DE PLATAFORMA Y NO CON UN `if (Platform.OS)` ───────────────────────
// La implementación de Android usa `useAnimatedKeyboard()` (un HOOK): no se puede llamar condicionalmente
// ni envolver en un `if`. Y no queremos que iOS/web paguen ni un listener de más: iOS **anda hoy**
// (verificado por Raf en device) y no se puede re-testear hasta el 1/8 → esta implementación es
// byte-idéntica a lo que había en los 4 call sites, a propósito.
//
// ⚠️ PRECONDICIÓN DE ADOPCIÓN: **no se anidan dos shells**. Cada shell le hace lugar al teclado entero;
// dos anidados descuentan el teclado dos veces (en iOS pasaría lo mismo con dos `KeyboardAvoidingView`
// anidados). Un sheet que se monta como overlay va como HERMANO del shell de la pantalla, no adentro
// (así están hoy `crear-animal` ↔ `BreedPickerSheet` y `maniobra/carga` ↔ `LotePickerSheet`).

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';

export type KeyboardAvoidingShellProps = {
  /** Contenido que tiene que quedar por encima del teclado. */
  children: ReactNode;
  /**
   * Estilo del CONTENEDOR (el que recibe el padding del teclado). Se pasa tal cual: es el mismo estilo que
   * los call sites le daban al `KeyboardAvoidingView` (típicamente `{ flex: 1 }`).
   */
  style?: StyleProp<ViewStyle>;
};

/**
 * iOS: `behavior='padding'` — el contenedor se achica desde abajo por el alto del teclado, así que lo que
 * esté anclado al fondo (el footer con el CTA, el sheet) queda justo por encima.
 * WEB: `behavior` sin definir → react-native-web lo renderiza como un `<View>` con el estilo tal cual. Es
 * lo correcto: en web no hay teclado virtual que tape nada (el `Keyboard` de RNW nunca emite).
 */
export function KeyboardAvoidingShell({ children, style }: KeyboardAvoidingShellProps) {
  return (
    <KeyboardAvoidingView style={style} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {children}
    </KeyboardAvoidingView>
  );
}
