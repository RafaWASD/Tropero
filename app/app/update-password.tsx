// app/update-password.tsx — Crear nueva contraseña (spec 01, R1.5 / T3.4).
//
// Destino del link de recuperación que manda ForgotPassword. Actualiza la password
// del usuario en la sesión de recuperación vía supabase.auth.updateUser.
//
// ── SEAM Fase 5 (B.1.3) ──────────────────────────────────────────────────────────
// El wiring fino del deep-link queda para la Fase 5: cuando el usuario toca el link
// de reset, Supabase abre una sesión de RECOVERY y emite el evento PASSWORD_RECOVERY.
// En web, `detectSessionInUrl` (cliente Supabase) ya parsea el fragment del URL y
// crea esa sesión. Falta:
//   TODO B.1.3: suscribirse a onAuthStateChange('PASSWORD_RECOVERY') y re-rutear
//   AUTOMÁTICAMENTE a esta pantalla (hoy se llega navegando manualmente / por el link
//   en web). También: configurar el universal link/`rafq://` para que el link de
//   reset abra esta ruta en native. Ver design.md §Edge Functions / R5.13.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería.

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormError, FormField } from '@/components';
import { supabase } from '@/services/supabase';
import { authErrorMessage } from '@/utils/auth-errors';
import { isValidPassword, type FieldError } from '@/utils/validation';

export default function UpdatePasswordScreen() {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<FieldError>(null);
  const [confirmError, setConfirmError] = useState<FieldError>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    setFormError(null);
    const pwErr: FieldError = isValidPassword(password)
      ? null
      : 'La contraseña tiene que tener al menos 8 caracteres.';
    const confErr: FieldError = password === confirm ? null : 'Las contraseñas no coinciden.';
    setPasswordError(pwErr);
    setConfirmError(confErr);
    if (pwErr || confErr) return;

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setFormError(authErrorMessage(error, 'generic'));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <AuthScreenShell title="Contraseña actualizada" subtitle="Ya podés usar tu nueva contraseña.">
        <YStack gap="$4" marginTop="$2">
          <Button variant="primary" fullWidth onPress={() => router.replace('/')}>
            Continuar
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  return (
    <AuthScreenShell title="Nueva contraseña" subtitle="Elegí una contraseña para tu cuenta.">
      <YStack gap="$4" marginTop="$2">
        <FormField
          label="Nueva contraseña"
          value={password}
          onChangeText={setPassword}
          error={passwordError}
          placeholder="Al menos 8 caracteres"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
        />
        <FormField
          label="Repetí la contraseña"
          value={confirm}
          onChangeText={setConfirm}
          error={confirmError}
          placeholder="Repetí la contraseña"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={submitting} onPress={onSubmit}>
          {submitting ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}
