// TagScanCta + CapturedTagRow — afordancias COMPARTIDAS del bastoneo de la caravana electrónica (delta
// caravana-ficha bastoneo, RCF.6; generalizado a ALTA y PARTO en el delta bastoneo-captura-alta-parto).
//
// TagScanCta: el CTA prominente que ABRE el TagScanSheet (el bastón es el 95% del flujo en manga). Target
//   grande (≥ $touchMin, Fitts, una mano) con el StickIcon $primary + label $textPrimary (regla B, design-system
//   §2.1) sobre $greenLight — lo distingue de un input plano, legible al sol. Nace en la FICHA (app/animal/[id].tsx,
//   definido local); acá se EXTRAE para reusarlo en
//   el alta (crear-animal) y el parto (agregar-evento, por ternero). `label` configurable ("Bastonear la
//   caravana" en la ficha; "Bastonear la caravana (opcional)" en alta/parto, donde el tag es recomendado).
//
// CapturedTagRow: el estado READ-ONLY tras CAPTURAR un EID en un form (alta/parto). A diferencia de la ficha
//   —donde el tag es INMUTABLE una vez asignado—, en un form el EID vive en el estado y un mis-scan se debe
//   poder corregir ANTES de confirmar → muestra el EID legible (formatEidReadable) + un link "Cambiar" que lo
//   LIMPIA (→ vuelve a aparecer el CTA para re-escanear). NO se usa en la ficha (ahí el valor asignado es final).
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para el ícono lucide (size/strokeWidth son API no-Tamagui,
// fuera del lint). Voseo es-AR. lineHeight matching en el label (tiene descendentes: g/j/p/q/y). a11y por helper.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { Tag } from 'lucide-react-native';

import { StickIcon } from '@/theme/icons';
import { formatEidReadable } from '@/utils/eid-format';
import { buttonA11y } from '@/utils/a11y';

export type TagScanCtaProps = {
  onPress: () => void;
  /** Copy del CTA (default "Bastonear la caravana"; en alta/parto "Bastonear la caravana (opcional)"). */
  label?: string;
  /** testID del target (default 'tag-scan-open'; en parto se distingue por ternero, ej. 'tag-scan-open-0'). */
  testID?: string;
};

export function TagScanCta({ onPress, label = 'Bastonear la caravana', testID = 'tag-scan-open' }: TagScanCtaProps) {
  return (
    <XStack
      testID={testID}
      minHeight="$touchMin"
      alignItems="center"
      gap="$2"
      backgroundColor="$greenLight"
      borderRadius="$pill"
      paddingHorizontal="$4"
      pressStyle={{ opacity: 0.7 }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label })}
    >
      <StickIcon size={20} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
      <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={1}>
        {label}
      </Text>
    </XStack>
  );
}

export type CapturedTagRowProps = {
  /** El EID capturado (15 díg crudos). Se muestra agrupado legible con formatEidReadable. */
  eid: string;
  /** Limpia el tag capturado (→ el caller re-muestra el TagScanCta para re-escanear). */
  onClear: () => void;
  /** Label de la fila (default "Caravana electrónica"). */
  label?: string;
  /** testID del contenedor (default 'tag-captured'; en parto se distingue por ternero). */
  testID?: string;
  /** testID del link "Cambiar" (default 'tag-captured-clear'; en parto se distingue por ternero). */
  clearTestID?: string;
};

export function CapturedTagRow({
  eid,
  onClear,
  label = 'Caravana electrónica',
  testID = 'tag-captured',
  clearTestID = 'tag-captured-clear',
}: CapturedTagRowProps) {
  return (
    <YStack gap="$2" testID={testID}>
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      <XStack alignItems="center" gap="$2" minHeight="$touchMin">
        <Tag size={20} color={getTokenValue('$primary', 'color')} strokeWidth={2.25} />
        <Text
          flex={1}
          minWidth={0}
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="700"
          color="$textPrimary"
          letterSpacing={1}
          numberOfLines={1}
        >
          {formatEidReadable(eid)}
        </Text>
        <Pressable
          testID={clearTestID}
          hitSlop={8}
          onPress={onClear}
          {...buttonA11y(Platform.OS, { label: 'Cambiar la caravana' })}
        >
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$primary">
            Cambiar
          </Text>
        </Pressable>
      </XStack>
    </YStack>
  );
}
