// app/maniobra/_components/LabSampleStep.tsx — PASO de SANGRADO (brucelosis) — 1 número de tubo (spec 03
// M3.2b, R6.4).
//
// El sangrado toma una muestra de sangre y la rotula con un NÚMERO DE TUBO → un lab_samples
// (sample_type='blood', tube_number). El resultado llega después por import de laboratorio (spec 06), así
// que acá SOLO se captura el tubo. Hero = el número de tubo tipeado; CTA "Confirmar".
//
// TUBE_NUMBER = TEXTO, NO keypad numérico (decisión as-built): la columna `lab_samples.tube_number` es
// `text not null` (0029) y los códigos de tubo de laboratorio son ALFANUMÉRICOS en la práctica (ej.
// "A-104", "CEDIVE-23"), no solo dígitos. Un input de texto grande (manga-friendly, $searchBarLg=56) cubre
// numérico y alfanumérico; un keypad numérico excluiría los códigos con letras/guiones (y el lab los usa).
// El tube_number ES un código de máquina → NO se le aplica formato es-AR (memoria reference_es_ar_number_format).
//
// El tubo es REQUERIDO (R5.7): la columna es NOT NULL y una muestra sin tubo no se puede vincular al
// resultado (spec 06) → "Confirmar" se deshabilita si el tubo está vacío (no se persiste una muestra sin
// rótulo). El frame persiste el lab_samples con session_id (R5.11).
//
// LAYOUT (dirección del leader, fix-loop M3.2b — CERO ESPACIO MUERTO, Gate 0): el label + input + hint van
// en una CARD DOMINANTE de superficie (figura-fondo) centrada que ocupa el ALTO ÚTIL (`flex={1}`) → la
// pantalla queda BALANCEADA sin el gran vacío de arriba. El input es grande (manga, $tubeText=24); el CTA
// gigante queda abajo en la zona del pulgar.
//
// Cero hardcode (ADR-023 §4): tokens. Recorte de descendentes: lineHeight matching. es-AR NO aplica al tubo.

import { useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { Check } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';

// Tope de caracteres del tubo = cap server-side de lab_samples.tube_number (CHECK <= 64, 0070). El input
// no deja tipear más → el INSERT nunca viola el CHECK al subir.
const TUBE_MAX = 64;

export type LabSampleStepProps = {
  /** Tubo ya cargado (corrección desde el resumen, R5.9) o '' si es la 1ra captura. */
  initialTube?: string;
  /** Devuelve el número de tubo confirmado (no vacío). El frame persiste el lab_samples blood con session_id. */
  onConfirm: (tubeNumber: string) => void;
  bottomPad: number;
};

export function LabSampleStep({ initialTube = '', onConfirm, bottomPad }: LabSampleStepProps) {
  const [tube, setTube] = useState<string>(initialTube);

  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');

  const trimmed = tube.trim();
  const canConfirm = trimmed.length > 0;

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      {/* CARD DOMINANTE de superficie (figura-fondo): label + input grande + hint, centrados, ocupando el
          alto útil (flex:1) → pantalla balanceada, sin vacío grande arriba. */}
      <YStack
        flex={1}
        marginTop="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$5"
        justifyContent="center"
        gap="$4"
      >
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary" numberOfLines={1}>
          Número de tubo
        </Text>
        <TextInput
          value={tube}
          onChangeText={(t) => setTube(t.slice(0, TUBE_MAX))}
          placeholder="Ej.: A-104"
          placeholderTextColor={placeholderColor}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={TUBE_MAX}
          onSubmitEditing={() => canConfirm && onConfirm(trimmed)}
          testID="tube-input"
          style={{
            minHeight: inputMinHeight,
            borderRadius: radius,
            borderWidth: 1,
            borderColor,
            backgroundColor: surfaceColor,
            paddingHorizontal: padH,
            fontSize: getTokenValue('$tubeText', 'size'),
            fontFamily: 'Inter',
            fontWeight: '700',
            color: textColor,
          }}
          {...labelA11y(Platform.OS, 'Número de tubo')}
        />
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textMuted" numberOfLines={2}>
          El resultado del laboratorio se vincula después por este número.
        </Text>
      </YStack>

      {/* CTA "Confirmar" full-width. Deshabilitado si no hay tubo (muestra sin rótulo no se persiste, R5.7). */}
      <View
        testID="confirm-step"
        backgroundColor={canConfirm ? '$primary' : '$divider'}
        borderRadius="$pill"
        minHeight="$touchMin"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        opacity={canConfirm ? 1 : 0.7}
        pressStyle={canConfirm ? { backgroundColor: '$primaryPress' } : undefined}
        onPress={canConfirm ? () => onConfirm(trimmed) : undefined}
        {...buttonA11y(Platform.OS, { label: 'Confirmar', disabled: !canConfirm })}
      >
        <Check size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          Confirmar
        </Text>
      </View>
    </YStack>
  );
}
