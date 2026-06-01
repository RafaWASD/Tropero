// app/cambiar-email.tsx — ChangeEmailScreen (spec 01, Fase 6 — R2.1/R2.2).
//
// Pantalla DEDICADA de cambio de email (patrón Mobbin: CVS Health / Gopuff): una decisión por
// pantalla, ruta propia (se descarta sola al volver — no persiste estado de edición como un form
// inline en el tab "Más"). Reemplaza al viejo EmailChangeForm que vivía bajo el Guardar/Cancelar
// del perfil.
//
// Flujo (R2.2 nativo de Supabase): `changeEmail(newEmail)` dispara `auth.updateUser({ email })` →
// Supabase manda verificación al email NUEVO y MANTIENE el viejo hasta que se confirme desde ahí.
// El display de "Más" sigue mostrando el viejo (del session) hasta la confirmación. Por eso el copy
// avisa ANTES de enviar que el actual sigue activo, y tras OK muestra el estado de confirmación.
//
// Cero hardcode (ADR-023 §4): AuthScreenShell + FormField + Button + FormError + InfoNote, tokens.
// Voseo argentino. Una decisión por pantalla (🟡 mixta): un solo campo + primario/secundario.

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormField, FormError, InfoNote } from '@/components';
import { useProfile } from '@/contexts';
import { changeEmail } from '@/services/account';
import { validateNewEmail } from '@/utils/validation';

// Copy accionable ante falta de conexión (cambiar email es operación online, R9.2).
const OFFLINE_COPY = 'Necesitás conexión para esto. Conectate a internet y volvé a intentar.';

export default function CambiarEmailScreen() {
  const router = useRouter();
  const { profile } = useProfile();
  const currentEmail = profile?.email ?? null;

  const [newEmail, setNewEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Email al que mandamos la verificación (para el copy de confirmación). null = sin submit OK aún.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  async function onSubmit() {
    setFieldError(null);
    setSubmitError(null);
    const candidate = newEmail.trim();
    const validationError = validateNewEmail({ newEmail: candidate, currentEmail });
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    setSubmitting(true);
    const result = await changeEmail(candidate);
    setSubmitting(false);

    if (result.ok) {
      setPendingEmail(candidate);
      return;
    }
    // Errores accionables (es-AR, voseo). Mismo mapeo que account-result (reason tipado).
    if (result.reason === 'email_taken') {
      setSubmitError('Ese email ya está registrado en otra cuenta.');
    } else if (result.reason === 'invalid') {
      setFieldError('Ingresá un email válido.');
    } else if (result.reason === 'network') {
      setSubmitError(OFFLINE_COPY);
    } else {
      setSubmitError('No pudimos cambiar tu email. Probá de nuevo.');
    }
  }

  // Estado de confirmación tras un submit OK: el usuario ya no edita, solo confirma desde su mail.
  if (pendingEmail) {
    return (
      <AuthScreenShell
        title="Cambiar email"
        subtitle="Revisá tu casilla para confirmar el cambio."
      >
        <YStack gap="$4" marginTop="$2">
          <InfoNote>
            {`Te mandamos un mail a ${pendingEmail}. Confirmá desde ahí para completar el cambio. ` +
              `Hasta entonces tu email sigue siendo ${currentEmail ?? 'el actual'}.`}
          </InfoNote>
          <Button variant="primary" fullWidth onPress={() => router.back()}>
            Volver
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell
      title="Cambiar email"
      subtitle="Te vamos a mandar un mail de verificación al nuevo. Tu email actual sigue activo hasta que lo confirmes."
    >
      <YStack gap="$4" marginTop="$2">
        <InfoNote>{`Email actual: ${currentEmail ?? '—'}`}</InfoNote>
        <FormField
          label="Nuevo email"
          value={newEmail}
          onChangeText={setNewEmail}
          placeholder="nuevo@email.com"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          error={fieldError}
        />
        <FormError message={submitError} />
        <Button
          variant="primary"
          fullWidth
          disabled={submitting || newEmail.trim().length === 0}
          onPress={() => void onSubmit()}
        >
          {submitting ? 'Enviando…' : 'Cambiar email'}
        </Button>
        <Button variant="secondary" fullWidth onPress={() => router.back()}>
          Cancelar
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}
