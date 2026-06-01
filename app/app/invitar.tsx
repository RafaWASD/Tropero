// app/invitar.tsx — Invitar miembro (spec 01, Fase 5 / T5.2 / R5.1/R5.2/R5.3).
//
// Form: rol OBLIGATORIO (Operario / Veterinario — NO se puede invitar como Dueño, R5.1) + email
// OPCIONAL (anotación para que el owner reconozca la invitación, no se valida al aceptar). Al crear
// OK (invite_user) → vista "Listo, compartí el link" con el accept_url destacado + Copiar/Compartir
// (ShareLink) + nota de expiración (7 días, cancelable/regenerable desde Miembros).
//
// Solo accesible al owner del campo activo (la entrada "Invitar" vive en Miembros, owner-only). Por
// las dudas, si el contexto no es 'active' o el usuario no es owner, mostramos una nota y no el form.
//
// 🟡 pantalla mixta (oficina + campo): targets ≥ $touchMin, voseo. Cero hardcode (ADR-023 §4).

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { Text, View, XStack, YStack } from 'tamagui';

import { AuthScreenShell, Button, FormField, FormError, InfoNote } from '@/components';
import { useEstablishment } from '@/contexts';
import { ShareLink } from '@/components';
import {
  createInvitation,
  type CreatedInvitation,
  type InvitableRole,
} from '@/services/members';
import { inviteErrorCopy } from '@/utils/invite';
import { isValidEmail } from '@/utils/validation';

const OFFLINE_COPY = 'Necesitás conexión para crear una invitación. Conectate a internet y volvé a intentar.';

// Roles invitables (R5.1): owner NO es opción.
const ROLE_OPTIONS: { value: InvitableRole; label: string; hint: string }[] = [
  { value: 'field_operator', label: 'Operario', hint: 'Carga datos en la manga y opera el campo.' },
  { value: 'veterinarian', label: 'Veterinario', hint: 'Ve y registra sanidad y reproducción.' },
];

export default function InvitarScreen() {
  const router = useRouter();
  const { state } = useEstablishment();

  const activeField =
    state.status === 'active' && state.role === 'owner'
      ? { id: state.current.id, name: state.current.name }
      : null;

  const [role, setRole] = useState<InvitableRole | null>(null);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);

  if (!activeField) {
    // Defensa: solo el owner del campo activo invita. No debería llegar acá sin ser owner.
    return (
      <AuthScreenShell title="Invitar" subtitle="Sumá a tu vet o capataz a este campo.">
        <YStack gap="$4" marginTop="$2">
          <InfoNote>Solo el dueño del campo activo puede invitar miembros.</InfoNote>
          <Button variant="secondary" fullWidth onPress={() => router.back()}>
            Volver
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  // Vista de éxito: "Listo, compartí el link".
  if (created) {
    return (
      <AuthScreenShell
        title="Listo, compartí el link"
        subtitle={`Mandale este link a quien quieras sumar a "${activeField.name}". Apenas lo abra y acepte, queda en el equipo.`}
      >
        <YStack gap="$5" marginTop="$2">
          <ShareLink
            url={created.acceptUrl}
            shareMessage={`Te invito a sumarte a "${activeField.name}" en RAFAQ. Abrí este link para aceptar: ${created.acceptUrl}`}
          />
          <InfoNote>
            Este link vence en 7 días. Podés cancelarlo o regenerar uno nuevo desde Miembros cuando
            quieras (regenerar deja inservible el anterior).
          </InfoNote>
          <Button variant="primary" fullWidth onPress={() => router.back()}>
            Listo
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  async function onSubmit() {
    setFormError(null);
    setEmailError(null);
    if (!role) {
      setFormError('Elegí un rol para la persona que vas a invitar.');
      return;
    }
    // Email opcional: solo validamos formato SI lo escribieron (es anotación, R5.1).
    const trimmedEmail = email.trim();
    if (trimmedEmail.length > 0 && !isValidEmail(trimmedEmail)) {
      setEmailError('Ese email no parece válido. Podés dejarlo vacío.');
      return;
    }

    setCreating(true);
    const result = await createInvitation({
      establishmentId: activeField!.id,
      role,
      email: trimmedEmail || null,
    });
    setCreating(false);

    if (result.ok) {
      setCreated(result.value);
    } else if (result.error.kind === 'network') {
      setFormError(OFFLINE_COPY);
    } else {
      setFormError(inviteErrorCopy(result.error.code));
    }
  }

  return (
    <AuthScreenShell
      title="Invitar al equipo"
      subtitle={`Sumá a alguien a "${activeField.name}". Elegí su rol y compartí el link que se genera.`}
    >
      <YStack gap="$5" marginTop="$2">
        {/* Selector de rol (R5.1, obligatorio). */}
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Rol
          </Text>
          <YStack gap="$3">
            {ROLE_OPTIONS.map((opt) => (
              <RoleOption
                key={opt.value}
                label={opt.label}
                hint={opt.hint}
                selected={role === opt.value}
                onPress={() => setRole(opt.value)}
              />
            ))}
          </YStack>
        </YStack>

        {/* Email opcional (anotación, R5.1). */}
        <FormField
          label="Email (opcional)"
          value={email}
          onChangeText={setEmail}
          placeholder="Para reconocer la invitación en tu lista"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          error={emailError}
        />

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={creating} onPress={onSubmit}>
          {creating ? 'Generando link…' : 'Generar link de invitación'}
        </Button>
        <Button variant="secondary" fullWidth onPress={() => router.back()}>
          Cancelar
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}

/** Opción de rol seleccionable (card tappable, ≥ $touchMin). Selected → borde + tinte primary. */
function RoleOption({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
    >
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        gap="$3"
        backgroundColor={selected ? '$greenLight' : '$surface'}
        borderWidth={selected ? 2 : 1}
        borderColor={selected ? '$primary' : '$divider'}
        borderRadius="$card"
        paddingHorizontal="$4"
        paddingVertical="$3"
      >
        {/* Radio visual. */}
        <View
          width="$dot"
          height="$dot"
          borderRadius="$pill"
          backgroundColor={selected ? '$primary' : 'transparent'}
          borderWidth={selected ? 0 : 2}
          borderColor="$textMuted"
        />
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            {label}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            {hint}
          </Text>
        </YStack>
      </XStack>
    </Pressable>
  );
}
