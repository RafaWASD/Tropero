// app/maniobra/_components/LabDoubleStep.tsx — PASO de RASPADO de toros — 2 números de tubo (spec 03 M3.2b,
// R6.11; solo machos, R6.12 — el skip de hembras lo hace maneuver-applicability ANTES de llegar acá).
//
// El raspado prepucial toma DOS muestras → DOS lab_samples (scrape_tricho = Tricomoniasis, scrape_campylo =
// Campylobacteriosis), cada una con su NÚMERO DE TUBO. Ambos campos visibles a la vez, CLARAMENTE etiquetados
// (Tricomoniasis / Campylobacteriosis): se rotulan los dos tubos del mismo raspado en una sola pasada (más
// manga-claro que dos pantallas secuenciales para una maniobra que produce ambas muestras juntas). CTA
// "Confirmar" → el frame persiste los 2 lab_samples con session_id (R5.11).
//
// TUBE_NUMBER = TEXTO (no keypad): igual que el sangrado (LabSampleStep) — la columna es `text`, los códigos
// de lab son alfanuméricos. Código de máquina → SIN formato es-AR.
//
// AMBOS tubos son REQUERIDOS (R5.7): cada lab_samples.tube_number es NOT NULL y una muestra sin rótulo no se
// vincula al resultado (spec 06) → "Confirmar" se deshabilita hasta que los DOS tengan número.
//
// LAYOUT (dirección del leader, fix-loop M3.2b — CERO ESPACIO MUERTO, Gate 0): los 2 campos etiquetados
// (Tricomoniasis / Campylobacteriosis) van en una CARD DOMINANTE de superficie (figura-fondo) centrada que
// ocupa el ALTO ÚTIL (`flex={1}`) → pantalla balanceada sin el gran vacío de arriba. Inputs grandes (manga,
// $tubeText=24); el CTA gigante queda abajo en la zona del pulgar.
//
// Cero hardcode (ADR-023 §4): tokens. Recorte de descendentes: lineHeight matching (Tricomoniasis trae 'g').

import { useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { Check } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';

const TUBE_MAX = 64;

export type LabDoubleStepProps = {
  /** Tubo de tricomoniasis ya cargado (corrección, R5.9) o ''. */
  initialTricho?: string;
  /** Tubo de campylobacteriosis ya cargado (corrección, R5.9) o ''. */
  initialCampylo?: string;
  /** Devuelve los 2 números de tubo (no vacíos). El frame persiste 2 lab_samples scrape_* con session_id. */
  onConfirm: (tubeTricho: string, tubeCampylo: string) => void;
  bottomPad: number;
};

export function LabDoubleStep({
  initialTricho = '',
  initialCampylo = '',
  onConfirm,
  bottomPad,
}: LabDoubleStepProps) {
  const [tricho, setTricho] = useState<string>(initialTricho);
  const [campylo, setCampylo] = useState<string>(initialCampylo);

  const trichoT = tricho.trim();
  const campyloT = campylo.trim();
  const canConfirm = trichoT.length > 0 && campyloT.length > 0;

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      {/* CARD DOMINANTE de superficie (figura-fondo): los 2 campos centrados, ocupando el alto útil (flex:1)
          → pantalla balanceada, sin vacío grande arriba. */}
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
        gap="$5"
      >
        <TubeField label="Tricomoniasis" value={tricho} onChange={setTricho} testID="tube-tricho" />
        <TubeField label="Campylobacteriosis" value={campylo} onChange={setCampylo} testID="tube-campylo" />
      </YStack>

      {/* CTA "Confirmar" full-width. Deshabilitado hasta que LOS DOS tubos tengan número (R5.7). */}
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
        onPress={canConfirm ? () => onConfirm(trichoT, campyloT) : undefined}
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

/** Un campo de tubo etiquetado (input de texto grande + label). Reusado por las 2 muestras del raspado. */
function TubeField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID: string;
}) {
  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');

  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.slice(0, TUBE_MAX))}
        placeholder="N° de tubo"
        placeholderTextColor={placeholderColor}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        maxLength={TUBE_MAX}
        testID={testID}
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
        {...labelA11y(Platform.OS, label)}
      />
    </YStack>
  );
}
