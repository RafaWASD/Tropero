// app/campo-perdido.tsx — aviso de pérdida del campo activo (spec 01, R6.10 / active_lost).
//
// El establecimiento activo dejó de ser válido para el usuario (rol removido/revocado o el
// owner soft-deleteó el campo). El gating raíz (RootGate) nos manda acá cuando el contexto
// entra en 'active_lost'. NO se fuerza logout (R7.4): el usuario sigue autenticado; solo
// pierde el contexto del campo que ya no le pertenece.
//
// Pantalla TRANSITORIA (design.md §Navegación raíz): muestra un aviso LEGIBLE según
// `reason` y, al reconocerlo, re-rutea según R6.7 sobre los campos restantes (`available`)
// vía acknowledgeActiveLost(): ≥2 → "Mis campos"; 1 → home; 0 → wizard. El re-ruteo lo
// dispara el gating al ver el nuevo estado.
//
// Cero hardcode (ADR-023 §4): AuthScreenShell + Button + InfoNote de la librería + tokens.

import { YStack } from 'tamagui';

import { AuthScreenShell, Button, InfoNote } from '@/components';
import { useEstablishment } from '@/contexts';

export default function CampoPerdidoScreen() {
  const { state, acknowledgeActiveLost } = useEstablishment();

  // Si por carrera ya no estamos en active_lost (el estado se resolvió), salimos a la home;
  // el gating reubica igual. Defensa contra render fuera de estado.
  if (state.status !== 'active_lost') {
    return (
      <AuthScreenShell title="Un momento…" subtitle="Te estamos reubicando.">
        <YStack gap="$4" marginTop="$2">
          <InfoNote>Cargando tus campos…</InfoNote>
        </YStack>
      </AuthScreenShell>
    );
  }

  const { reason, lostEstablishmentName, available } = state;

  // Copy legible según el caso (R6.10):
  //   role_revoked        → "Ya no tenés acceso a <campo>"
  //   establishment_deleted → "<campo> fue eliminado"
  const title =
    reason === 'establishment_deleted'
      ? `${lostEstablishmentName} fue eliminado`
      : `Ya no tenés acceso a ${lostEstablishmentName}`;

  const subtitle =
    reason === 'establishment_deleted'
      ? 'El dueño eliminó este campo. Tu cuenta sigue activa.'
      : 'Te quitaron el acceso a este campo. Tu cuenta sigue activa.';

  // El destino tras reconocer depende de cuántos campos quedan (R6.7), pero el re-ruteo lo
  // hace el gating; acá solo mostramos un copy honesto del próximo paso.
  const nextHint =
    available.length === 0
      ? 'Podés crear un campo nuevo o aceptar una invitación.'
      : available.length === 1
        ? 'Te llevamos a tu otro campo.'
        : 'Te llevamos a la lista de tus campos.';

  return (
    <AuthScreenShell title={title} subtitle={subtitle}>
      <YStack gap="$4" marginTop="$2">
        <InfoNote>{nextHint}</InfoNote>
        <Button
          variant="primary"
          fullWidth
          onPress={() => {
            // Re-resuelve sobre los campos restantes (R6.10 → R6.7). El gating raíz (RootGate)
            // detecta el NUEVO estado (no_establishments / choosing / active) y navega al
            // destino correcto — NO navegamos a mano para no flashear (tabs) cuando quedan 0
            // o ≥2 campos.
            acknowledgeActiveLost();
          }}
        >
          Entendido
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}
