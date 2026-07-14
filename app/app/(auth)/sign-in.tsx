// app/(auth)/sign-in.tsx — Iniciar sesión (spec 01, R1.4 / T3.2 + lockout R1.7/T3.5).
//
// Form email + password. Validación de formato (validateSignIn). Errores de Auth
// traducidos a voseo (authErrorMessage). Lockout local liviano: 5 fallos en 10 min
// → bloqueo 15 min (R1.7), persistido por email. La defensa real es el rate-limit de
// Supabase Auth; esto es feedback inmediato + evita spamear el endpoint.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería.

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import {
  AppleSignInButton,
  AuthDivider,
  AuthScreenShell,
  Button,
  FormError,
  FormField,
  GoogleSignInButton,
  LinkButton,
} from '@/components';
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
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<FieldError>(null);
  const [passwordError, setPasswordError] = useState<FieldError>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
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

  // Login social (spec 19, R8.5): NO se gatea por `locked` ni toca el estado de lockout del password
  // (el OAuth no es brute-forceable). Cancelar el picker → { ok:false } sin error → silencio (R6.1).
  async function onGoogle() {
    setFormError(null);
    setGoogleBusy(true);
    const result = await signInWithGoogle();
    setGoogleBusy(false);
    if (result.ok) return; // el RootGate re-rutea al cambiar el AuthState (sin navegación manual)
    if (result.error) setFormError(authErrorMessage(result.error, 'social'));
  }

  async function onApple() {
    setFormError(null);
    setAppleBusy(true);
    const result = await signInWithApple();
    setAppleBusy(false);
    if (result.ok) return;
    if (result.error) setFormError(authErrorMessage(result.error, 'social'));
  }

  const anyBusy = submitting || googleBusy || appleBusy;

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

        <Button variant="primary" fullWidth disabled={anyBusy || locked} onPress={onSubmit}>
          {submitting ? 'Ingresando…' : 'Iniciar sesión'}
        </Button>

        <AuthDivider />
        <GoogleSignInButton onPress={onGoogle} disabled={anyBusy} loading={googleBusy} />
        {(Platform.OS === 'ios' || Platform.OS === 'web') && (
          <AppleSignInButton onPress={onApple} disabled={anyBusy} loading={appleBusy} />
        )}

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
