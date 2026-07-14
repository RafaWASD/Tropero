// AppleSignInButton.native — botón de Apple en iOS/Android (spec 19, T13 / R4.3, R4.4, R2.5).
//
// ÚNICO componente que importa `expo-apple-authentication` (R2.5): vive solo en el grafo native, no se
// filtra al bundle web (que resuelve el base `AppleSignInButton.tsx`). En iOS renderiza el botón HIG
// oficial (`AppleAuthenticationButton`), garantía de aprobación en la App Store (design §D). En Android
// devuelve `null` (no hay Apple nativo — D2/R2.6; el botón tampoco lo monta la pantalla).
//
// R8.9 / R6.1: este componente NO dispara el flujo ni maneja tokens; solo invoca el `onPress` que la
// pantalla cablea a `signInWithApple()` (el servicio hace el nonce y no loggea nada).

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { getTokenValue, View } from 'tamagui';

import type { AppleSignInButtonProps } from './AppleSignInButton';

export function AppleSignInButton({ onPress, disabled = false, loading = false }: AppleSignInButtonProps) {
  // Android → sin botón de Apple (D2/R2.6). Defensa en profundidad: la pantalla ya no lo monta.
  if (Platform.OS !== 'ios') return null;

  const isDisabled = disabled || loading;
  const cornerRadius = getTokenValue('$pill', 'radius');
  const height = getTokenValue('$touchMin', 'size');

  return (
    <View width="100%" opacity={isDisabled ? 0.5 : 1} pointerEvents={isDisabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={cornerRadius}
        style={{ width: '100%', height }}
        onPress={onPress}
      />
    </View>
  );
}
