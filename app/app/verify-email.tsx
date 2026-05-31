// app/verify-email.tsx — EmailVerificationGate (spec 01, R1.3 / T3.3).
//
// Se muestra cuando el AuthState es `authenticated` pero `emailVerified === false`
// (el gating de nav raíz nos manda acá). CTAs: "Reenviar email" + "Cerrar sesión".
// Auto-refresh: re-chequea la sesión periódicamente y al re-enfocar la pantalla, así
// cuando el usuario verifica desde el mail (en otra pestaña/app) el gate avanza solo.
//
// ── SEAM R5.13 (token de invitación pendiente) ────────────────────────────────────
// El flujo de signup (design.md paso 8) dice: ANTES de mostrar el wizard, chequear si
// hay un token de invitación pendiente en almacenamiento seguro (R5.13) y, si lo hay,
// re-rutear a AcceptInvitation. Acá dejamos el HOOK consultando el store
// (getPendingInvitationToken). AcceptInvitation se construye en la Fase 5:
//   TODO B.1.3: cuando exista AcceptInvitationScreen, al pasar el gate (emailVerified
//   pasa a true), si getPendingInvitationToken() devuelve un token → router.replace a
//   /accept-invitation?token=… (en vez del wizard/landing de la Fase 4). Tras consumir
//   el token (aceptación OK o error terminal) → clearPendingInvitationToken().
// Por ahora solo logueamos en dev que hay un token pendiente, sin re-rutear.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería.

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormError, InfoNote, LinkButton } from '@/components';
import { useAuth } from '@/contexts';
import { authErrorMessage } from '@/utils/auth-errors';
import { getPendingInvitationToken } from '@/services/pending-invitation';

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

  // SEAM R5.13: consultamos el store de token pendiente. El re-ruteo real a
  // AcceptInvitation es TODO B.1.3 (ver cabecera). Acá solo lo observamos.
  useEffect(() => {
    let active = true;
    getPendingInvitationToken().then((token) => {
      if (active && token && process.env.NODE_ENV !== 'production') {
        // TODO B.1.3: re-rutear a /accept-invitation?token=token al verificar.
        console.warn('[invite] hay un token de invitación pendiente; AcceptInvitation llega en Fase 5.');
      }
    });
    return () => {
      active = false;
    };
  }, []);

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
