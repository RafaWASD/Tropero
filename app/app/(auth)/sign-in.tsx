// app/(auth)/sign-in.tsx — Iniciar sesión (spec 01, R1.4 / T3.2 + lockout R1.7/T3.5).
//
// Form email + password. Validación de formato (validateSignIn). Errores de Auth
// traducidos a voseo (authErrorMessage). Lockout local liviano: 5 fallos en 10 min
// → bloqueo 15 min (R1.7), persistido por email. La defensa real es el rate-limit de
// Supabase Auth; esto es feedback inmediato + evita spamear el endpoint.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería.

import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormError, FormField, LinkButton } from '@/components';
import { useAuth } from '@/contexts';
import { authErrorMessage } from '@/utils/auth-errors';
import { validateSignIn, type FieldError } from '@/utils/validation';
import {
  EMPTY_LOCKOUT,
  formatLockMinutes,
  isLockedOut,
  normalizeLockout,
  registerFailure,
  remainingLockMs,
  resetLockout,
  type LockoutState,
} from '@/utils/lockout';
import { loadLockout, saveLockout } from '@/services/lockout-store';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<FieldError>(null);
  const [passwordError, setPasswordError] = useState<FieldError>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockout, setLockout] = useState<LockoutState>(EMPTY_LOCKOUT);

  // Al cambiar el email, rehidratamos el lockout persistido de ESE email (normalizado
  // al ahora, así un bloqueo expirado se levanta solo).
  useEffect(() => {
    const trimmed = email.trim();
    if (!trimmed) {
      setLockout(EMPTY_LOCKOUT);
      return;
    }
    let active = true;
    loadLockout(trimmed).then((stored) => {
      if (active) setLockout(normalizeLockout(stored, Date.now()));
    });
    return () => {
      active = false;
    };
  }, [email]);

  const locked = isLockedOut(lockout, Date.now());

  async function onSubmit() {
    setFormError(null);
    const v = validateSignIn({ email, password });
    setEmailError(v.email);
    setPasswordError(v.password);
    if (!v.valid) return;

    const now = Date.now();
    if (isLockedOut(lockout, now)) {
      setFormError(
        `Demasiados intentos fallidos. Probá de nuevo en ${formatLockMinutes(remainingLockMs(lockout, now))}.`,
      );
      return;
    }

    setSubmitting(true);
    const result = await signIn({ email, password });
    setSubmitting(false);

    if (result.ok) {
      const cleared = resetLockout();
      setLockout(cleared);
      await saveLockout(email, cleared);
      // El gating de nav raíz re-rutea solo al cambiar el AuthState (no navegamos acá).
      return;
    }

    // Fallo: registramos el intento y persistimos. Si el server ya nos rate-limiteó
    // (429), el copy lo dice; si fueron credenciales, lo dice authErrorMessage.
    const next = registerFailure(lockout, Date.now());
    setLockout(next);
    await saveLockout(email, next);

    if (isLockedOut(next, Date.now())) {
      setFormError(
        `Demasiados intentos fallidos. Probá de nuevo en ${formatLockMinutes(remainingLockMs(next, Date.now()))}.`,
      );
    } else {
      setFormError(authErrorMessage(result.error, 'signin'));
    }
  }

  return (
    <AuthScreenShell title="Iniciar sesión" subtitle="Ingresá con tu email y contraseña.">
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
          returnKeyType="next"
        />
        <FormField
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          error={passwordError}
          placeholder="Tu contraseña"
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={submitting || locked} onPress={onSubmit}>
          {submitting ? 'Ingresando…' : 'Iniciar sesión'}
        </Button>

        <YStack gap="$3" alignItems="center" marginTop="$2">
          <LinkButton
            label="Olvidé mi contraseña"
            onPress={() => router.push('/(auth)/forgot-password')}
          />
          <LinkButton
            label="No tengo cuenta · Registrarme"
            onPress={() => router.push('/(auth)/sign-up')}
          />
        </YStack>
      </YStack>
    </AuthScreenShell>
  );
}
