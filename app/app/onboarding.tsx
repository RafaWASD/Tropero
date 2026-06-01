// app/onboarding.tsx — OnboardingWizard (spec 01, T4.3 / R6.5).
//
// Aparece cuando el usuario verificado no tiene NINGÚN user_roles activo
// (EstablishmentState 'no_establishments'). El gating raíz (RootGate) nos manda acá.
//
// CTA dual (R6.5), jerarquía clara:
//   (a) PRIMARIO — "Crear mi primer campo" → /crear-campo (flujo de alta, R3.1/R3.8).
//   (b) SECUNDARIO — "Pegar link de invitación" → /invite (Fase 5, T5.4): abre el input para
//       pegar el link, extrae el token y completa la aceptación.
//
// El mismo wizard sirve a productores y a vets/operarios (no se segmenta por rol; el rol
// vive en user_roles, no en el signup — ver Decisiones tomadas).
//
// SEAM R5.13 — CENTRALIZADO en RootGate. El re-ruteo a /invite?token= cuando hay un token de
// invitación pendiente vive ahora en una FUENTE ÚNICA: el RootGate (_layout.tsx, Opción A del fix de
// B.1.3), que lo dispara apenas el usuario queda authenticated && emailVerified, ANTES del gating de
// establecimiento. Por eso este wizard YA NO necesita su propio seam: un invitado nuevo (0 campos)
// con token pendiente nunca llega acá — RootGate lo manda a /invite antes de resolver el estado
// no_establishments. Tener el seam acá además causaría doble-ruteo. Ver _layout.tsx (RootGate, paso
// 3.5) e impl_01-frontend-fase5.md.
//
// Cero hardcode (ADR-023 §4): AuthScreenShell + Button de la librería + tokens.

import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button } from '@/components';
import { useProfile } from '@/contexts';

export default function OnboardingScreen() {
  const router = useRouter();
  // Saludo desde ProfileContext (fuente única, public.users — Fase 6). Mientras carga o sin
  // nombre, saludo neutro (sin parpadear "¡Bienvenido, undefined!").
  const { profile, loading } = useProfile();
  const firstName = !loading ? firstNameOf(profile?.name ?? null) : null;

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

        {/* CTA secundario (R6.5 b): pegar link de invitación → /invite (T5.4). */}
        <Button variant="secondary" fullWidth onPress={() => router.push('/invite')}>
          Pegar link de invitación
        </Button>
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
