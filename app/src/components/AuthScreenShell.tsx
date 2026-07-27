// AuthScreenShell — layout compartido de las pantallas de auth (spec 01, Fase 3).
//
// Da el marco consistente a SignIn / SignUp / ForgotPassword / VerifyEmail /
// UpdatePassword: safe-area, fondo $bg, scroll que respeta el teclado, wordmark
// RAFAQ, título + subtítulo, y un slot para el contenido (form + CTAs). Cero
// hardcode (ADR-023 §4): todo via tokens. No es una pantalla — es un componente de
// la librería que componen las pantallas (ADR-023).
//
// ── TECLADO (bug 🔴 Android, unidad «teclado Android») ────────────────────────
// Acá el CTA NO vive en un footer fijo: es un elemento más del scroll. El
// mecanismo que lo mantiene alcanzable es el SCROLL, y para que el scroll exista
// el viewport tiene que ACHICARSE cuando aparece el teclado — si no, el contenido
// entra completo en un viewport de pantalla entera, nada desborda, nada scrollea,
// y el CTA se queda quieto debajo del teclado (eso es lo que pasaba en Android:
// "al enfocar la contraseña el botón queda tapado"). El `KeyboardAvoidingShell`
// es justo eso: en iOS por `behavior='padding'` y en Android por `paddingBottom`
// = alto del teclado. La reserva de abajo del contentContainer NO se toca (vive
// DENTRO del scroll: con el teclado arriba es un poco de recorrido de más, no un
// hueco visible).

import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, YStack } from 'tamagui';

import { KeyboardAvoidingShell } from './KeyboardAvoidingShell';

// Estilo de una API no-Tamagui (el contenedor del shell del teclado). `flex` no es color ni spacing con
// token semántico → no aplica el lint anti-hardcode (ADR-023 §4). Mismo `{ flex: 1 }` que tenía el
// KeyboardAvoidingView que este shell reemplazó: la geometría no cambió.
const fillStyle = { flex: 1 } as const;

export type AuthScreenShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function AuthScreenShell({ title, subtitle, children }: AuthScreenShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <KeyboardAvoidingShell style={fillStyle}>
        <ScrollView
          flex={1}
          width="100%"
          maxWidth="100%"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top,
            // Aire inferior token + safe-area bottom inset (mismo patrón que el ScrollView de
            // crear-animal): sin el `$6` el último botón (ej. "Cancelar" de editar/crear campo) queda
            // glued al borde del teléfono cuando el inset es 0. El `flexGrow:1` mantiene el top-align.
            paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
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
      </KeyboardAvoidingShell>
    </YStack>
  );
}
