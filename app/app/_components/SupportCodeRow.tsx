// SupportCodeRow — "Código de soporte: XXXX" + Copiar. Presentacional, reusable (spec 23, US5 / R5.8).
//
// Se muestra cuando algo sale mal, para que el operario le dicte/pegue a soporte un id de correlación:
//   - crash de render  → el requestId generado en RootErrorBoundary.componentDidCatch (taggeado en Sentry)
//   - rechazo de manga → el id de la op (UploadRejection.id), findable en el evento upload_rejected de Sentry
// Presentación UNIFICADA entre ambas superficies (R5.8): un solo componente.
//
// Manga-friendly (R5.10 / regla del repo): target ≥ $touchMin, tap DIRECTO en la pieza Tamagui — onPress +
// a11y en el MISMO XStack que el pressStyle. NO un <Pressable> de RN envolviendo un Tamagui con pressStyle:
// en new-arch roba el responder de touch y onPress no dispara en nativo (patrón probado en ShareLink/AnimalRow).
//
// COPIAR (D-E del design): expo-clipboard YA es dependencia (app/package.json "~56.0.4") → se usa
// Clipboard.setStringAsync en try/catch best-effort — NUNCA rompe. Además el código queda `selectable`, así se
// lee/copia a mano si el portapapeles fallara. Feedback "Copiado" efímero (2s), idéntico a ShareLink.
//
// RECORTE DE DESCENDENTES (regla dura): "Código de soporte"/"Copiar"/"Copiado" traen descenders (p/g) →
// lineHeight matching en TODO Text. Cero hardcode (ADR-023 §4): tokens; el color a lucide vía getTokenValue.

import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { Check, Copy } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';

export type SupportCodeRowProps = {
  /** El código de soporte a mostrar/copiar (uuid de correlación, sin PII). */
  supportCode: string;
};

export function SupportCodeRow({ supportCode }: SupportCodeRowProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primary = getTokenValue('$primary', 'color');
  const iconSize = getTokenValue('$icon', 'size') * 0.4;

  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(supportCode);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Portapapeles no disponible: el código sigue visible y `selectable` para copiarse a mano.
    }
  }, [supportCode]);

  return (
    <YStack width="100%" gap="$1">
      <Text fontFamily="$body" fontSize="$2" lineHeight="$2" color="$textMuted" numberOfLines={1}>
        Código de soporte
      </Text>
      {/* La fila entera copia (target grande, una mano). onPress + a11y DIRECTO en el XStack (misma pieza que
          el pressStyle) — nunca un <Pressable> de RN envolviéndolo (regla del repo). */}
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="space-between"
        gap="$2"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$divider"
        borderRadius="$card"
        paddingHorizontal="$3"
        paddingVertical="$2"
        pressStyle={{ backgroundColor: '$divider' }}
        onPress={() => void onCopy()}
        {...buttonA11y(Platform.OS, {
          label: copied ? 'Código de soporte copiado' : `Copiar código de soporte ${supportCode}`,
        })}
      >
        <Text
          flex={1}
          minWidth={0}
          fontFamily="$body"
          fontSize="$4"
          lineHeight="$4"
          fontWeight="600"
          color="$textPrimary"
          numberOfLines={1}
          ellipsizeMode="middle"
          selectable
        >
          {supportCode}
        </Text>
        <XStack alignItems="center" gap="$1" flexShrink={0}>
          {copied ? (
            <Check size={iconSize} color={primary} strokeWidth={2.5} />
          ) : (
            <Copy size={iconSize} color={primary} strokeWidth={2.5} />
          )}
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="600" color="$primary">
            {copied ? 'Copiado' : 'Copiar'}
          </Text>
        </XStack>
      </XStack>
    </YStack>
  );
}
