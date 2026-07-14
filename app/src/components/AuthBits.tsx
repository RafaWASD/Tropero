// AuthBits — piezas chicas compartidas por las pantallas de auth (spec 01, Fase 3).
//
//   - FormError: banda de error a nivel de formulario (terracota, accesible).
//   - LinkButton: link de texto secundario ("Olvidé mi contraseña", "Registrarme").
//   - InfoNote: nota informativa neutra (ej. "Te mandamos un email…").
//
// Cero hardcode (ADR-023 §4): tokens. Split a11y web/native como Button.tsx.

import { Platform, Pressable } from 'react-native';
import { Text, View, XStack } from 'tamagui';

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  // role="alert" / accessibilityLiveRegion para que el lector anuncie el error.
  const a11y =
    Platform.OS === 'web'
      ? { role: 'alert' as const }
      : { accessibilityLiveRegion: 'polite' as const };
  return (
    <View
      width="100%"
      backgroundColor="$surface"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$terracota"
      paddingHorizontal="$4"
      paddingVertical="$3"
      {...a11y}
    >
      <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$terracota">
        {message}
      </Text>
    </View>
  );
}

export function InfoNote({ children }: { children: string }) {
  return (
    <View
      width="100%"
      backgroundColor="$surface"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$divider"
      paddingHorizontal="$4"
      paddingVertical="$3"
    >
      <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
        {children}
      </Text>
    </View>
  );
}

// AuthDivider — separador "o" entre el CTA de email/password y los botones sociales (spec 19, R4.1).
// Dos líneas con la conjunción "o" centrada. Cero hardcode: tokens ($divider, $textMuted). El testID
// da un ancla estable a la suite E2E (la letra "o" suelta no es scopeble por texto).
export function AuthDivider() {
  return (
    <XStack testID="auth-divider" alignItems="center" gap="$3" width="100%" marginVertical="$2">
      <View flex={1} height={1} backgroundColor="$divider" />
      <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
        o
      </Text>
      <View flex={1} height={1} backgroundColor="$divider" />
    </XStack>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const a11y =
    Platform.OS === 'web'
      ? { role: 'button' as const }
      : { accessibilityRole: 'button' as const };
  return (
    <Pressable accessibilityLabel={label} hitSlop={8} onPress={onPress} {...a11y}>
      <XStack minHeight="$chipMin" alignItems="center" justifyContent="center" paddingHorizontal="$2">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}
