// app/(auth)/sign-up.tsx — Crear cuenta (spec 01, R1.1/R1.2 / T3.2).
//
// Form name + email + password. Validación (validateSignUp: nombre no vacío, email
// válido, password ≥8). Errores de Auth en voseo (authErrorMessage). Tras signUp
// exitoso, Supabase manda el email de verificación (R1.2) y —con confirmación de
// email habilitada— NO crea sesión, así que mostramos un estado "Verificá tu email"
// en esta misma pantalla (el gate de nav no cambia porque seguimos unauthenticated).
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería.

import { useState } from 'react';
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
  InfoNote,
  LinkButton,
} from '@/components';
import { useAuth } from '@/contexts';
import { authErrorMessage } from '@/utils/auth-errors';
import { validateSignUp, type FieldError } from '@/utils/validation';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp, signInWithGoogle, signInWithApple } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nameError, setNameError] = useState<FieldError>(null);
  const [emailError, setEmailError] = useState<FieldError>(null);
  const [passwordError, setPasswordError] = useState<FieldError>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [signedUpEmail, setSignedUpEmail] = useState<string | null>(null);

  async function onSubmit() {
    setFormError(null);
    const v = validateSignUp({ name, email, password });
    setNameError(v.name);
    setEmailError(v.email);
    setPasswordError(v.password);
    if (!v.valid) return;

    setSubmitting(true);
    const result = await signUp({ name, email, password });
    setSubmitting(false);

    if (result.ok) {
      setSignedUpEmail(email.trim());
      return;
    }
    setFormError(authErrorMessage(result.error, 'signup'));
  }

  // Login social (spec 19). Mismo patrón que sign-in (mismo layout, R4.7). Cancelar → silencio (R6.1);
  // el RootGate re-rutea al cambiar el AuthState (sin navegación manual). OAuth nace verificado (R5.3).
  async function onGoogle() {
    setFormError(null);
    setGoogleBusy(true);
    const result = await signInWithGoogle();
    setGoogleBusy(false);
    if (result.ok) return;
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

  // Estado post-signup: "Verificá tu email". Si la confirmación de email está
  // habilitada en el proyecto, no hay sesión todavía; el usuario verifica desde el
  // mail y luego inicia sesión (o, si el proyecto auto-loguea, el gate avanza solo).
  if (signedUpEmail) {
    return (
      <AuthScreenShell
        title="Verificá tu email"
        subtitle={`Te mandamos un email a ${signedUpEmail} con un link para confirmar tu cuenta.`}
      >
        <YStack gap="$4" marginTop="$2">
          <InfoNote>
            Abrí el link del email para activar tu cuenta. Revisá la carpeta de spam si no lo ves.
            Después volvé e iniciá sesión.
          </InfoNote>
          <Button variant="primary" fullWidth onPress={() => router.replace('/(auth)/sign-in')}>
            Ir a iniciar sesión
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell title="Crear cuenta" subtitle="Necesitás tu nombre, un email y una contraseña.">
      <YStack gap="$4" marginTop="$2">
        <FormField
          label="Nombre"
          value={name}
          onChangeText={setName}
          error={nameError}
          placeholder="Tu nombre"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
        />
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
          placeholder="Al menos 8 caracteres"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={anyBusy} onPress={onSubmit}>
          {submitting ? 'Creando cuenta…' : 'Crear cuenta'}
        </Button>

        <AuthDivider />
        <GoogleSignInButton onPress={onGoogle} disabled={anyBusy} loading={googleBusy} />
        {(Platform.OS === 'ios' || Platform.OS === 'web') && (
          <AppleSignInButton onPress={onApple} disabled={anyBusy} loading={appleBusy} />
        )}

        <YStack alignItems="center" marginTop="$2">
          <LinkButton label="Ya tengo cuenta · Iniciar sesión" onPress={() => router.push('/(auth)/sign-in')} />
        </YStack>
      </YStack>
    </AuthScreenShell>
  );
}
