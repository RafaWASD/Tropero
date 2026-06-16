// app/maniobra/_components/DientesStep.tsx — PASO de DIENTES + prompt CUT (spec 03 M3.2a, R6.7/R6.8).
//
// Dientes = PROPIEDAD (R6.7): sobrescribe `animal_profiles.teeth_state` (enum 0020), NO es evento con
// historial. El operario elige UN estado dentario tocando un bloque GIGANTE (lenguaje visual de manga:
// bloques full-width que se reparten el alto, R5.2/R12.5). Los 8 valores del enum vienen ordenados de boca
// joven a gastada (teeth-options.ts).
//
// PROMPT CUT (R6.8): si el valor elegido es "boca de descarte" (1/2, 1/4, sin_dientes — el set
// CUT_PROMPT_TEETH) Y el animal NO es ternero (shouldOfferCutPrompt), se abre un SHEET de confirmación
// ("Esta boca indica vaca CUT. ¿Marcar como CUT?") con [Marcar CUT] / [No, solo registrar dientes]:
//   - Marcar CUT  → onConfirm(teethState, cut:true)  → el frame persiste teeth_state + la transición CUT
//                   (is_cut, category_id CUT, override) reusando el camino de categoría as-built.
//   - No, solo …  → onConfirm(teethState, cut:false) → solo teeth_state (registrar dientes sin CUT).
// Si el valor NO dispara CUT (o es ternero) → onConfirm(teethState, cut:false) directo, sin sheet.
//
// El gate "no para terneros" (R6.8) lo decide `shouldOfferCutPrompt` (maneuver-applicability.ts) con la
// categoría real del animal (el frame se la pasa). El sheet espeja el patrón as-built (ManeuverConfigSheet/
// BulkConfirmSheet): scrim tappable que cierra + YStack anclado abajo con grip + safe-area.
//
// Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. Recorte de descendentes: lineHeight
// matching en todo Text con numberOfLines ("registrar", "Marcar", "Sin dientes" — descendentes g/j/p).

import { useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, YStack } from 'tamagui';
import { AlertTriangle } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import { TEETH_OPTIONS } from '@/utils/teeth-options';
import { shouldOfferCutPrompt, type AnimalApplicabilityInfo } from '@/utils/maneuver-applicability';

export type DientesStepProps = {
  /** Atributos del animal para el gate del prompt CUT (R6.8: no para terneros). Lo pasa el frame. */
  animal: AnimalApplicabilityInfo;
  /** Devuelve el estado dentario elegido + si se confirmó CUT. El frame persiste teeth_state (+ CUT). */
  onConfirm: (teethState: string, cut: boolean) => void;
  bottomPad: number;
};

export function DientesStep({ animal, onConfirm, bottomPad }: DientesStepProps) {
  // El valor pendiente de decisión CUT (mientras el sheet está abierto). null = sheet cerrado.
  const [pendingCut, setPendingCut] = useState<string | null>(null);

  function pickTeeth(value: string) {
    // ¿Esta boca + este animal disparan el prompt CUT (R6.8)? → abrir sheet; si no → registrar sin CUT.
    if (shouldOfferCutPrompt(value, animal)) {
      setPendingCut(value);
    } else {
      onConfirm(value, false);
    }
  }

  return (
    <YStack flex={1} backgroundColor="$bg">
      {/* ── BLOQUES GIGANTES verticales: un valor del enum por bloque. Tocar uno = elige (o abre prompt CUT). ── */}
      <ScrollView
        flex={1}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$2', 'space'),
          paddingBottom: bottomPad,
          gap: getTokenValue('$2', 'space'),
          flexGrow: 1,
        }}
      >
        {TEETH_OPTIONS.map((opt) => (
          <View
            key={opt.value}
            testID={`teeth-block-${opt.value}`}
            flexGrow={1}
            flexBasis={0}
            minHeight={getTokenValue('$searchBarLg', 'size')}
            backgroundColor="$surface"
            borderRadius="$card"
            borderWidth={2}
            borderColor="$divider"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$greenLight' }}
            onPress={() => pickTeeth(opt.value)}
            {...buttonA11y(Platform.OS, { label: opt.label })}
          >
            <Text fontFamily="$heading" fontSize="$9" lineHeight="$9" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {opt.label}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* ── PROMPT CUT (R6.8): sheet de confirmación si la boca es de descarte y el animal NO es ternero. ── */}
      {pendingCut != null ? (
        <CutPromptSheet
          onMarkCut={() => {
            const v = pendingCut;
            setPendingCut(null);
            onConfirm(v, true);
          }}
          onJustTeeth={() => {
            const v = pendingCut;
            setPendingCut(null);
            onConfirm(v, false);
          }}
          onDismiss={() => setPendingCut(null)}
        />
      ) : null}
    </YStack>
  );
}

/**
 * Sheet de confirmación del prompt CUT (R6.8). Patrón as-built (ManeuverConfigSheet/BulkConfirmSheet):
 * scrim tappable que descarta (vuelve al selector, NO marca CUT) + YStack anclado abajo con grip +
 * safe-area. [Marcar CUT] (destructivo, terracota) / [No, solo registrar dientes] (neutro). El tap fuera =
 * cerrar sin elegir (vuelve al selector de dientes).
 */
function CutPromptSheet({
  onMarkCut,
  onJustTeeth,
  onDismiss,
}: {
  onMarkCut: () => void;
  onJustTeeth: () => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const TERRACOTA = getTokenValue('$terracota', 'color');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$4', 'space'));

  // NOTA (bugfix-config-sheet, 2026-06-15): este sheet NO necesita el guard del "click huérfano" que sí
  // lleva ManeuverConfigSheet. Razón verificada con repro táctil (touchscreen.tap + logging): el bloque de
  // dientes abre el sheet con el `onPress` de Tamagui (driven por el evento `click`), que CONSUME ese click
  // → no queda un click suelto que caiga sobre el scrim recién montado. El race solo aparece cuando el sheet
  // lo abre un `Gesture.Tap()` de react-native-gesture-handler (driven por `pointerup`, que deja el `click`
  // nativo libre para bubblear al scrim) — ese es el caso de ManeuverConfigSheet (cuerpo de fila = bodyTap).
  // El scrim acá descarta directo, sin gating (no rompe nada y no hay race que mitigar).

  return (
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable style={{ flex: 1, width: '100%' }} onPress={onDismiss} {...buttonA11y(Platform.OS, { label: 'Cerrar' })} />

      <YStack
        width="100%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="cut-prompt-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Ícono de alerta + título + explicación. lineHeight matching (g/j en "indica"/"registrar"). */}
        <YStack alignItems="center" gap="$2">
          <View
            width="$icon"
            height="$icon"
            borderRadius="$pill"
            backgroundColor="$surface"
            alignItems="center"
            justifyContent="center"
          >
            <AlertTriangle size={getTokenValue('$fabIcon', 'size')} color={TERRACOTA} strokeWidth={2.5} />
          </View>
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" textAlign="center" numberOfLines={2}>
            ¿Marcar como CUT?
          </Text>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center" numberOfLines={3}>
            Esta boca indica vaca CUT (de descarte). Si la marcás, su categoría pasa a CUT.
          </Text>
        </YStack>

        {/* Acciones GIGANTES (manga): Marcar CUT (destructivo, terracota) / No, solo registrar dientes. */}
        <YStack gap="$2">
          <View
            testID="cut-confirm"
            backgroundColor="$terracota"
            borderRadius="$pill"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ opacity: 0.85 }}
            onPress={onMarkCut}
            {...buttonA11y(Platform.OS, { label: 'Marcar como CUT' })}
          >
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
              Marcar CUT
            </Text>
          </View>
          <View
            testID="cut-decline"
            backgroundColor="$surface"
            borderRadius="$pill"
            borderWidth={1}
            borderColor="$divider"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$greenLight' }}
            onPress={onJustTeeth}
            {...buttonA11y(Platform.OS, { label: 'No, solo registrar dientes' })}
          >
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              No, solo registrar dientes
            </Text>
          </View>
        </YStack>
      </YStack>
    </View>
  );
}
