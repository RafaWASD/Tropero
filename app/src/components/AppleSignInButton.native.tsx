// AppleSignInButton.native — botón de Apple en iOS/Android (spec 19, T13 / R4.3, R4.4, R2.5, R2.6).
//
// En iOS renderiza el botón custom armonizado (`AppleSignInButtonView`): mismo diseño que el de Google
// (negro + logo Apple monocromo + "Continuar con Apple" en español, Inter), no el botón nativo del sistema
// (San Francisco / "Continue with Apple" en inglés / tamaños distintos). Apple permite botones custom de
// Sign in with Apple por su HIG mientras sigan siendo reconocibles (logo Apple + texto aprobado), así que
// unificamos la UI. En Android devuelve `null` (no hay Apple nativo — D2/R2.6; el botón tampoco lo monta
// la pantalla).
//
// Ya NO importa `expo-apple-authentication`: el FLUJO de auth (nonce, tokens) sigue en el servicio
// platform-split. R8.9 / R6.1: este componente NO dispara el flujo ni maneja tokens; solo invoca el
// `onPress` que la pantalla cablea a `signInWithApple()`.

import { Platform } from 'react-native';

import { AppleSignInButtonView } from './AppleSignInButtonView';
import type { AppleSignInButtonProps } from './AppleSignInButton';

export function AppleSignInButton(props: AppleSignInButtonProps) {
  // Android → sin botón de Apple (D2/R2.6). Defensa en profundidad: la pantalla ya no lo monta.
  if (Platform.OS !== 'ios') return null;

  // iOS → botón custom armonizado (mismo que web), no el nativo del sistema.
  return <AppleSignInButtonView {...props} />;
}
