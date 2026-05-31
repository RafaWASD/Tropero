// app/(auth)/forgot-password.tsx — Recuperar contraseña (spec 01, R1.5 / T3.4).
//
// Input de email → supabase.auth.resetPasswordForEmail (vía requestPasswordReset del
// AuthContext). Por seguridad NO revelamos si el email existe o no (evita enumeración
// de cuentas): tras enviar, mostramos siempre el mismo mensaje neutro.
//
// El wiring fino del deep-link que abre UpdatePassword (rafq:// + universal link) es
// de la Fase 5; acá la pantalla de update existe como ruta stub (update-password.tsx).
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería.

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormError, FormField, InfoNote, LinkButton } from '@/components';
import { useAuth } from '@/contexts';
import { authErrorMessage, isNetworkOrRateLimit } from '@/utils/auth-errors';
import { isValidEmail, type FieldError } from '@/utils/validation';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<FieldError>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    setFormError(null);
    if (!isValidEmail(email)) {
      setEmailError('Ingresá un email válido.');
      return;
    }
    setEmailError(null);

    setSubmitting(true);
    const result = await requestPasswordReset(email);
    setSubmitting(false);

    // No filtramos existencia de cuenta: salvo error de red/rate-limit, mostramos el
    // estado "enviado" igual. Si fue un fallo real (sin red), sí lo informamos.
    if (result.ok) {
      setSent(true);
      return;
    }
    // Solo cortamos el flujo si es un problema accionable por el usuario (red/limit).
    // Decidimos por el error CRUDO (status/code/name), no por el texto traducido: el
    // copy puede cambiar y rompería esta rama en silencio. Cualquier otro error → no
    // revelamos nada (anti-enumeración): mostramos "Revisá tu email" igual.
    if (isNetworkOrRateLimit(result.error)) {
      setFormError(authErrorMessage(result.error, 'reset'));
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <AuthScreenShell
        title="Revisá tu email"
        subtitle="Si hay una cuenta con ese email, te mandamos un link para crear una contraseña nueva."
      >
        <YStack gap="$4" marginTop="$2">
          <InfoNote>Abrí el link del email para elegir tu nueva contraseña. Revisá el spam si no lo ves.</InfoNote>
          <Button variant="primary" fullWidth onPress={() => router.replace('/(auth)/sign-in')}>
            Volver a iniciar sesión
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell
      title="Recuperar contraseña"
      subtitle="Ingresá tu email y te mandamos un link para crear una nueva."
    >
      <YStack gap="$4" marginTop="$2">
        <FormField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={emailError}
          placeholder="tu@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={submitting} onPress={onSubmit}>
          {submitting ? 'Enviando…' : 'Enviar link de recuperación'}
        </Button>

        <YStack alignItems="center" marginTop="$2">
          <LinkButton label="Volver a iniciar sesión" onPress={() => router.replace('/(auth)/sign-in')} />
        </YStack>
      </YStack>
    </AuthScreenShell>
  );
}
