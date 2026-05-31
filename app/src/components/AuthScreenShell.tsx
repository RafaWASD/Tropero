// AuthScreenShell — layout compartido de las pantallas de auth (spec 01, Fase 3).
//
// Da el marco consistente a SignIn / SignUp / ForgotPassword / VerifyEmail /
// UpdatePassword: safe-area, fondo $bg, scroll que respeta el teclado, wordmark
// RAFAQ, título + subtítulo, y un slot para el contenido (form + CTAs). Cero
// hardcode (ADR-023 §4): todo via tokens. No es una pantalla — es un componente de
// la librería que componen las pantallas (ADR-023).

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView, Text, YStack } from 'tamagui';

export type AuthScreenShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function AuthScreenShell({ title, subtitle, children }: AuthScreenShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          flex={1}
          width="100%"
          maxWidth="100%"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}
          showsHorizontalScrollIndicator={false}
        >
          <YStack flex={1} width="100%" paddingHorizontal="$4" paddingTop="$6" gap="$5">
            {/* Wordmark de marca (identidad consistente con la home). */}
            <Text
              fontFamily="$body"
              fontSize="$7"
              fontWeight="700"
              color="$primary"
              letterSpacing={1}
              alignSelf="center"
            >
              RAFAQ
            </Text>

            <YStack gap="$2" marginTop="$4">
              <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
                {title}
              </Text>
              {subtitle ? (
                <Text fontFamily="$body" fontSize="$5" fontWeight="400" color="$textMuted">
                  {subtitle}
                </Text>
              ) : null}
            </YStack>

            {children}
          </YStack>
        </ScrollView>
      </KeyboardAvoidingView>
    </YStack>
  );
}
