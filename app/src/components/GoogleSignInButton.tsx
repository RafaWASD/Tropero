// GoogleSignInButton — botón "Continuar con Google" (spec 19, T12 / R4.2, R4.6, R4.8).
//
// Un solo archivo (NO importa la lib nativa de Google — el login lo dispara el servicio platform-split
// vía onPress). El logo es el "G" oficial de 4 colores en SVG inline (react-native-svg). Los 4 hex del
// branding de Google son una EXCEPCIÓN intencional al anti-hardcode (ADR-023 §4 / R4.6): son la marca,
// NO tokens del design system, y NO se pueden recolorear → van como constantes justificadas con
// design-lint-disable. El chrome del botón (fondo, borde, texto) SÍ usa tokens de la casa.
//
// Manga-first (R4.8): alto mínimo $touchMin, ancho completo, forma pill como el CTA primario.

import { ActivityIndicator, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { getTokenValue, Text, View, XStack } from 'tamagui';

import { buttonA11y } from '../utils/a11y';

// Colores oficiales del logo de Google (branding, R4.6 — NO recolorear). Única excepción al lint.
const GOOGLE_BLUE = '#4285F4'; // design-lint-disable-line -- color oficial del logo de Google (branding, R4.6)
const GOOGLE_RED = '#EA4335'; // design-lint-disable-line -- color oficial del logo de Google (branding, R4.6)
const GOOGLE_YELLOW = '#FBBC05'; // design-lint-disable-line -- color oficial del logo de Google (branding, R4.6)
const GOOGLE_GREEN = '#34A853'; // design-lint-disable-line -- color oficial del logo de Google (branding, R4.6)

const LABEL = 'Continuar con Google';

export type GoogleSignInButtonProps = {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

function GoogleLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill={GOOGLE_BLUE}
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill={GOOGLE_GREEN}
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <Path
        fill={GOOGLE_YELLOW}
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill={GOOGLE_RED}
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
    </Svg>
  );
}

export function GoogleSignInButton({ onPress, disabled = false, loading = false }: GoogleSignInButtonProps) {
  const isDisabled = disabled || loading;
  const spinnerColor = getTokenValue('$textMuted', 'color');
  const a11y = buttonA11y(Platform.OS, { label: LABEL, disabled: isDisabled });
  return (
    <View
      width="100%"
      minHeight="$touchMin"
      borderRadius="$pill"
      borderWidth={1}
      borderColor="$divider"
      backgroundColor="$white"
      paddingHorizontal="$5"
      alignItems="center"
      justifyContent="center"
      opacity={isDisabled ? 0.5 : 1}
      pressStyle={{ backgroundColor: '$surface' }}
      onPress={isDisabled ? undefined : onPress}
      {...a11y}
    >
      <XStack alignItems="center" justifyContent="center" gap="$3">
        {loading ? <ActivityIndicator color={spinnerColor} /> : <GoogleLogo size={20} />}
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="600"
          color="$textPrimary"
          numberOfLines={1}
        >
          {LABEL}
        </Text>
      </XStack>
    </View>
  );
}
