// app/verify-email.tsx — EmailVerificationGate (spec 01, R1.3 / T3.3).
//
// Se muestra cuando el AuthState es `authenticated` pero `emailVerified === false`
// (el gating de nav raíz nos manda acá). CTAs: "Reenviar email" + "Cerrar sesión".
// Auto-refresh: re-chequea la sesión periódicamente y al re-enfocar la pantalla, así
// cuando el usuario verifica desde el mail (en otra pestaña/app) el gate avanza solo.
//
// ── SEAM R5.13 (token de invitación pendiente) — CENTRALIZADO en RootGate ──────────
// El re-ruteo a /invite?token= cuando hay un token de invitación pendiente vive AHORA en una
// FUENTE ÚNICA: el RootGate (_layout.tsx, Opción A del fix de B.1.3). RootGate lo dispara apenas el
// usuario queda authenticated && emailVerified, ANTES del gating de establecimiento, así cubre TODOS
// los aterrizajes post-auth (incluido el usuario existente con campos, que no pasa por esta pantalla
// ni por onboarding). Por eso esta pantalla YA NO necesita su propio seam: al verificar, el gate de
// emailVerified de RootGate la saca de acá y el check de token pendiente re-rutea a /invite. Tener el
// seam acá además causaría doble-ruteo. Ver _layout.tsx (RootGate, paso 3.5) e impl_01-frontend-fase5.md.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería.

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormError, InfoNote, LinkButton } from '@/components';
import { useAuth } from '@/contexts';
import { authErrorMessage } from '@/utils/auth-errors';

const REFRESH_INTERVAL_MS = 5000;

export default function VerifyEmailScreen() {
  const { state, signOut, resendVerification, refreshSession } = useAuth();

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const email = state.status === 'authenticated' ? state.user.email : null;

  // Auto-refresh por polling: re-chequea si el email ya quedó verificado. Cuando el
  // estado cambie a emailVerified=true, el gating de nav raíz saca esta pantalla.
  useEffect(() => {
    const id = setInterval(() => {
      refreshSession();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshSession]);

  // Re-chequeo al re-enfocar (el usuario vuelve de su app de mail).
  useFocusEffect(
    useCallback(() => {
      refreshSession();
    }, [refreshSession]),
  );

  // (El re-ruteo R5.13 al verificar con token pendiente lo hace RootGate — ver header.)

  async function onResend() {
    setFormError(null);
    setResending(true);
    const result = await resendVerification();
    setResending(false);
    if (result.ok) {
      setResent(true);
    } else {
      setFormError(authErrorMessage(result.error, 'resend'));
    }
  }

  return (
    <AuthScreenShell
      title="Verificá tu email"
      subtitle={
        email
          ? `Te mandamos un email a ${email}. Abrí el link para activar tu cuenta.`
          : 'Te mandamos un email con un link para activar tu cuenta.'
      }
    >
      <YStack gap="$4" marginTop="$2">
        <InfoNote>
          Apenas confirmes desde el email, esta pantalla avanza sola. Revisá el spam si no lo ves.
        </InfoNote>

        {resent ? <InfoNote>Listo, reenviamos el email. Puede tardar unos minutos en llegar.</InfoNote> : null}

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={resending} onPress={onResend}>
          {resending ? 'Reenviando…' : 'Reenviar email'}
        </Button>

        <Button variant="secondary" fullWidth onPress={() => refreshSession()}>
          Ya verifiqué · Refrescar
        </Button>

        <YStack alignItems="center" marginTop="$2">
          <LinkButton label="Cerrar sesión" onPress={signOut} />
        </YStack>
      </YStack>
    </AuthScreenShell>
  );
}
