// app/maniobra/_components/OtherRodeoSheet.tsx — aviso "animal de OTRO RODEO del mismo campo" (spec 03
// M2.1-edge, R4.4).
//
// Cuando el animal identificado (found) está en OTRO rodeo del MISMO establecimiento que el de la sesión,
// NO se carga directo: el tenant-check del DB rechazaría el evento ("una sesión = un rodeo", §4 design).
// Se le ofrece al operario (honrando el EARS R4.4):
//   (a) PASAR EL ANIMAL A ESTE RODEO (R4.4) = UPDATE de `animal_profiles.rodeo_id` al rodeo de la SESIÓN
//       (mover el animal, no la jornada) — solo si es del MISMO sistema (canChange); lo valida el trigger
//       same-system server-side (spec 02 R4.5.1, 0047). Mostramos el RODEO DE ORIGEN del animal en el
//       cuerpo (R4.4: "vas a sacarlo de <origen>") para no mover a ciegas.
//   (b) SALTAR — no frena la fila; el animal queda en su rodeo, se sigue escaneando.
//
// Si el animal es de OTRO SISTEMA (canChange=false), se ofrece SOLO saltar (pasarlo a un rodeo de otro
// sistema sería un dead-end de categoría — lo rechaza el trigger, R4.6).
//
// Sheet anclado abajo (patrón ManeuverConfigSheet): backdrop $scrim tappable que cierra (= saltar) +
// grip + safe-area. El "rodeo de origen" del animal es VISIBLE (R4.4: evitar movimientos a ciegas).
// Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. es-AR.
//
// ROBUSTEZ DE NOMBRES LARGOS (fix-loop, bug visual real): en prod un rodeo puede llamarse "Rodeo de cría
// de reposición 2024". El botón primario "Pasar el animal a este rodeo" NO lleva el nombre del rodeo en
// el label (va en el cuerpo) → no desborda. El nombre de rodeo del CUERPO va con numberOfLines + ellipsize.
//
// RECORTE DE DESCENDENTES (regla dura): título ("Está en otro rodeo") + nombres de rodeo (j/g) llevan
// numberOfLines → lineHeight matching.

import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Boxes } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y } from '@/utils/a11y';

export type OtherRodeoSheetProps = {
  /** Caravana/identidad del animal (para confirmar SOBRE cuál se decide). */
  animalLabel: string;
  /** Rodeo de ORIGEN del animal (R4.4: "vas a sacarlo de <origen>"). */
  animalRodeoName: string;
  /** Rodeo actual de la JORNADA (a dónde se PASARÍA el animal). */
  sessionRodeoName: string;
  /** ¿Se puede pasar el animal al rodeo de la jornada? (mismo sistema, canChangeSessionRodeo). */
  canChange: boolean;
  /** Pasar el animal al rodeo de la JORNADA (R4.4 = UPDATE de animal_profiles.rodeo_id) → cargar sobre él. */
  onMoveAnimal: () => void;
  /** Saltar el animal (no frenar la fila) → volver a escanear. */
  onSkip: () => void;
};

export function OtherRodeoSheet({
  animalLabel,
  animalRodeoName,
  sessionRodeoName,
  canChange,
  onMoveAnimal,
  onSkip,
}: OtherRodeoSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));
  const iconColor = getTokenValue('$primary', 'color');
  const heroIcon = getTokenValue('$heroIcon', 'size');

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra = SALTAR (no carga).
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable style={{ flex: 1, width: '100%' }} onPress={onSkip} {...buttonA11y(Platform.OS, { label: 'Cerrar y saltar' })} />

      <YStack
        width="100%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="other-rodeo-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        <YStack alignItems="center" gap="$3">
          <View
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$icon', 'size')}
            borderRadius="$pill"
            backgroundColor="$greenLight"
            alignItems="center"
            justifyContent="center"
          >
            <Boxes size={heroIcon * 0.5} color={iconColor} strokeWidth={2} />
          </View>

          <YStack alignItems="center" gap="$2">
            <Text fontFamily="$heading" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" textAlign="center" numberOfLines={1}>
              Está en otro rodeo
            </Text>
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center" numberOfLines={4}>
              <Text fontWeight="700" color="$textPrimary">{animalLabel}</Text> está en{' '}
              <Text fontWeight="700" color="$textPrimary">{animalRodeoName}</Text>.{' '}
              {canChange ? (
                <>
                  Para cargarlo en esta jornada hay que pasarlo a{' '}
                  <Text fontWeight="700" color="$textPrimary">{sessionRodeoName}</Text> (lo sacás de{' '}
                  <Text fontWeight="700" color="$textPrimary">{animalRodeoName}</Text>).
                </>
              ) : null}
            </Text>
          </YStack>
        </YStack>

        {/* Acciones. Si es del mismo sistema → ofrecemos pasar el animal (primary). Siempre, saltar.
            El botón primario NO lleva el nombre del rodeo en el label (va en el cuerpo) → no desborda con
            nombres de rodeo largos (robustez fix-loop). */}
        <YStack gap="$3">
          {canChange ? (
            <>
              <Button variant="primary" fullWidth onPress={onMoveAnimal}>
                Pasar el animal a este rodeo
              </Button>
              <Button variant="secondary" fullWidth onPress={onSkip}>
                Saltar este animal
              </Button>
            </>
          ) : (
            <>
              {/* Otro sistema: no se puede pasar el animal (dead-end de categoría, R4.6). Solo saltar. */}
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" textAlign="center" numberOfLines={2}>
                Ese rodeo es de otro sistema productivo: no se puede pasar el animal a esta jornada.
              </Text>
              <Button variant="primary" fullWidth onPress={onSkip}>
                Saltar este animal
              </Button>
            </>
          )}
        </YStack>
      </YStack>
    </View>
  );
}
