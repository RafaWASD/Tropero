// app/onboarding.tsx — OnboardingWizard (spec 01, T4.3 / R6.5).
//
// Aparece cuando el usuario verificado no tiene NINGÚN user_roles activo
// (EstablishmentState 'no_establishments'). El gating raíz (RootGate) nos manda acá.
//
// CTA dual (R6.5), jerarquía clara:
//   (a) PRIMARIO — "Crear mi primer campo" → /crear-campo (flujo de alta, R3.1/R3.8).
//   (b) SECUNDARIO — "Pegar link de invitación" → STUB Fase 5 (B.1.3). El flujo de
//       pegar/extraer token + AcceptInvitation se construye en la Fase 5; acá solo el
//       botón con copy honesto. NO se construye el input de pegar ni la aceptación.
//
// El mismo wizard sirve a productores y a vets/operarios (no se segmenta por rol; el rol
// vive en user_roles, no en el signup — ver Decisiones tomadas).
//
// Cero hardcode (ADR-023 §4): AuthScreenShell + Button + InfoNote de la librería + tokens.

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, InfoNote } from '@/components';
import { useAuth } from '@/contexts';

export default function OnboardingScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const firstName =
    state.status === 'authenticated' ? firstNameOf(state.user.name) : null;

  // STUB Fase 5: el flujo de pegar link de invitación (extraer token + AcceptInvitation)
  // es B.1.3. Acá solo informamos al tocar, sin construir el input ni la aceptación.
  const [showInviteStub, setShowInviteStub] = useState(false);

  return (
    <AuthScreenShell
      title={firstName ? `¡Bienvenido, ${firstName}!` : '¡Bienvenido!'}
      subtitle="Para empezar, sumá tu primer campo. Si te invitaron a uno, pegá el link que te pasaron."
    >
      <YStack gap="$4" marginTop="$2">
        {/* CTA primario (R6.5 a): crear mi primer campo → flujo de alta. */}
        <Button variant="primary" fullWidth onPress={() => router.push('/crear-campo')}>
          Crear mi primer campo
        </Button>

        {/* CTA secundario (R6.5 b): pegar link de invitación. STUB Fase 5 (B.1.3). */}
        <Button variant="secondary" fullWidth onPress={() => setShowInviteStub(true)}>
          Pegar link de invitación
        </Button>

        {showInviteStub ? (
          <InfoNote>
            La aceptación de invitaciones por link llega muy pronto. Mientras tanto, pedile
            al dueño del campo que te agregue, o creá tu propio campo.
          </InfoNote>
        ) : null}
      </YStack>
    </AuthScreenShell>
  );
}

/** Primer nombre del nombre completo guardado en el perfil (para el saludo). */
function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}
