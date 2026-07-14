// AppleSignInButton (BASE = impl web-safe) — botón "Continuar con Apple" (spec 19, T13 / R4.3).
//
// Split base + `.native` (2 archivos, ver design §Arquitectura). Este BASE es la impl WEB (botón propio
// negro + logo Apple monocromo SVG): tsc y el bundle web lo usan. NO importa `expo-apple-authentication`
// (R2.5) → el bundle web queda limpio. En iOS/Android Metro resuelve `AppleSignInButton.native.tsx`
// (HIG nativo en iOS, `null` en Android).
//
// El negro del botón usa el token de la casa `$textPrimary` (near-black) y el logo el `$white` — sin
// hardcode. El logo Apple es monocromo (blanco sobre negro), no tiene colores de marca que preservar.

import { ActivityIndicator, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { getTokenValue, Text, View, XStack } from 'tamagui';

import { buttonA11y } from '../utils/a11y';

const LABEL = 'Continuar con Apple';

export type AppleSignInButtonProps = {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

function AppleLogo({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
      />
    </Svg>
  );
}

export function AppleSignInButton({ onPress, disabled = false, loading = false }: AppleSignInButtonProps) {
  const isDisabled = disabled || loading;
  const white = getTokenValue('$white', 'color');
  const a11y = buttonA11y(Platform.OS, { label: LABEL, disabled: isDisabled });
  return (
    <View
      width="100%"
      minHeight="$touchMin"
      borderRadius="$pill"
      backgroundColor="$textPrimary"
      paddingHorizontal="$5"
      alignItems="center"
      justifyContent="center"
      opacity={isDisabled ? 0.5 : 1}
      pressStyle={{ opacity: 0.85 }}
      onPress={isDisabled ? undefined : onPress}
      {...a11y}
    >
      <XStack alignItems="center" justifyContent="center" gap="$3">
        {loading ? <ActivityIndicator color={white} /> : <AppleLogo size={20} color={white} />}
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="600"
          color="$white"
          numberOfLines={1}
        >
          {LABEL}
        </Text>
      </XStack>
    </View>
  );
}
