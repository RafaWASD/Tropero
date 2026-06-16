// app/maniobra/_components/PesajeStep.tsx — PASO de PESAJE cableado (spec 03 M2.2, R6.9/R6.10).
//
// Porta el lenguaje visual YA APROBADO del spike M2.0 (`app/maniobra/paso.tsx`) a un componente del frame:
// display de peso GIGANTE dominante (hero $11=64px estilo Cash App) + teclado numérico 3×4 PERFECTAMENTE
// SIMÉTRICO con bordes para contraste de manga + coma decimal es-AR + CTA confirmar full-width. NO se
// rediseña — se estructura como paso reutilizable que devuelve el peso al frame (onConfirm).
//
// DIFERENCIA con el spike: (a) recibe el valor inicial (corrección desde el resumen, R5.9) y el callback
// onConfirm(weightKg) — el frame persiste vía maneuver-events (con session_id, R5.11); (b) el CTA queda
// deshabilitado si el peso es 0/inválido (no se persiste un peso vacío). El header de identidad y la línea
// de maniobra los pone el FRAME (carga.tsx), no este componente (un paso no dibuja la identidad).
//
// es-AR (memoria): coma decimal + punto de miles. Cero hardcode (ADR-023 §4): tokens. Recorte de
// descendentes: lineHeight matching (la línea de maniobra y los headings la traen vía el frame; acá el
// display/teclas son numéricos pero llevan lineHeight por convención).

import { useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, Delete } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';

const KEY_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', 'del'],
];

const DECIMAL_SEP = ',';

/** Formatea el peso TECLEADO (string en curso, separador interno = coma es-AR) para el display. */
function formatPesoAR(raw: string): string {
  if (raw.length === 0) return '0';
  const [intPart, decPart] = raw.split(DECIMAL_SEP);
  const intNum = Number(intPart === '' ? '0' : intPart);
  const intFmt = Number.isFinite(intNum) ? intNum.toLocaleString('es-AR') : intPart;
  const hasDecimal = raw.includes(DECIMAL_SEP);
  return hasDecimal ? `${intFmt}${DECIMAL_SEP}${decPart}` : intFmt;
}

/** Parsea el string tecleado (coma es-AR) a número de kg. NaN/≤0 si no hay un peso válido (no se persiste). */
function parsePesoKg(raw: string): number {
  if (raw.length === 0) return NaN;
  const n = Number(raw.replace(DECIMAL_SEP, '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Estado de tipeo inicial a partir de un peso ya cargado (corrección desde el resumen). "" si no hay. */
function initialRaw(weightKg: number | null): string {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return '';
  // Reusa la coma es-AR para el estado de tipeo (el display la formatea); sin decimales si es entero.
  return Number.isInteger(weightKg) ? String(weightKg) : String(weightKg).replace('.', DECIMAL_SEP);
}

export type PesajeStepProps = {
  /** Peso ya cargado (corrección desde el resumen, R5.9) o null si es la 1ra captura. */
  initialWeightKg?: number | null;
  /** Devuelve el peso confirmado (kg > 0) al frame, que lo persiste con session_id. */
  onConfirm: (weightKg: number) => void;
  bottomPad: number;
};

export function PesajeStep({ initialWeightKg = null, onConfirm, bottomPad }: PesajeStepProps) {
  const [peso, setPeso] = useState<string>(() => initialRaw(initialWeightKg));

  const PRIMARY = getTokenValue('$primary', 'color');
  const KEY_ICON = getTokenValue('$icon', 'size');
  const kg = parsePesoKg(peso);
  const canConfirm = Number.isFinite(kg) && kg > 0;

  function pressKey(k: string) {
    if (k === 'del') {
      setPeso((p) => p.slice(0, -1));
      return;
    }
    if (k === DECIMAL_SEP) {
      setPeso((p) => (p.includes(DECIMAL_SEP) ? p : p.length === 0 ? `0${DECIMAL_SEP}` : p + DECIMAL_SEP));
      return;
    }
    setPeso((p) => (p.replace(DECIMAL_SEP, '').length >= 5 ? p : p + k));
  }

  return (
    <YStack flex={1} backgroundColor="$bg">
      {/* DISPLAY de peso GIGANTE dominante + unidad "kg" (sufijo chico). */}
      <XStack
        testID="weight-display"
        paddingHorizontal="$4"
        paddingTop="$2"
        paddingBottom="$3"
        alignItems="baseline"
        justifyContent="center"
        gap="$2"
      >
        <Text fontFamily="$heading" fontSize="$11" lineHeight="$11" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {formatPesoAR(peso)}
        </Text>
        <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="600" color="$textMuted" numberOfLines={1}>
          kg
        </Text>
      </XStack>

      {/* TECLADO NUMÉRICO GIGANTE 3×4 simétrico (bordes nítidos para manga a pleno sol). */}
      <YStack testID="action-zone" flex={1} paddingHorizontal="$4" gap="$2">
        {KEY_ROWS.map((row, ri) => (
          <XStack key={`row-${ri}`} flex={1} gap="$2">
            {row.map((k) => (
              <View
                key={k}
                flexGrow={1}
                flexShrink={1}
                flexBasis={0}
                minWidth={0}
                overflow="hidden"
                backgroundColor="$surface"
                borderRadius="$card"
                borderWidth={2}
                borderColor="$textFaint"
                alignItems="center"
                justifyContent="center"
                pressStyle={{ backgroundColor: '$greenLight' }}
                onPress={() => pressKey(k)}
                {...buttonA11y(Platform.OS, { label: k === 'del' ? 'Borrar' : k })}
              >
                {k === 'del' ? (
                  <Delete size={KEY_ICON} color={PRIMARY} />
                ) : (
                  <Text fontFamily="$heading" fontSize="$10" lineHeight="$10" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                    {k}
                  </Text>
                )}
              </View>
            ))}
          </XStack>
        ))}
      </YStack>

      {/* CTA "✓ Confirmar" full-width (zona del pulgar). Deshabilitado si no hay un peso válido (>0). */}
      <YStack
        paddingHorizontal="$4"
        paddingTop="$3"
        paddingBottom={bottomPad}
      >
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
          onPress={canConfirm ? () => onConfirm(kg) : undefined}
          {...buttonA11y(Platform.OS, { label: 'Confirmar peso', disabled: !canConfirm })}
        >
          <Check size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
            Confirmar
          </Text>
        </View>
      </YStack>
    </YStack>
  );
}
