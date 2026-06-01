// ShareLink — bloque "compartí el link" reutilizable (spec 01, Fase 5 / R5.3).
//
// Muestra un accept_url de invitación destacado + dos acciones grandes (Copiar / Compartir).
// Lo usan la vista "Listo, compartí el link" (T5.2) y cada item de invitaciones pendientes (T5.3).
//
// Cuidado visual (lo que el leader veta):
//   - El accept_url es LARGO (~50+ chars) y NO debe desbordar horizontalmente a 360px. Lo
//     renderizamos en un contenedor con maxWidth 100% + overflow hidden y el Text con
//     numberOfLines + ellipsizeMode "middle" (se ve el principio y el final del link, que es lo
//     útil para reconocerlo) — mismo guard de overflow que la home. Es SELECCIONABLE
//     (selectable) para copiar a mano si los botones fallaran.
//   - Targets de Copiar/Compartir ≥ $touchMin (manga-friendly): botones pill grandes.
//
// Copiar usa expo-clipboard (Clipboard.setStringAsync). Compartir usa el Share nativo de RN
// (Share.share) → abre la share sheet (WhatsApp, mail, SMS, etc.). En web, Share.share puede no
// estar; lo envolvemos en try/catch y, si no hay share sheet, no rompemos (el botón Copiar es el
// fallback universal). Feedback de "copiado" efímero a cargo del componente.
//
// Cero hardcode (ADR-023 §4): tokens; los colores que cruzan a lucide se leen con getTokenValue.

import { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, Copy, Share2 } from 'lucide-react-native';

export type ShareLinkProps = {
  /** El accept_url shareable a copiar/compartir. */
  url: string;
  /** Mensaje opcional que acompaña el link en la share sheet (default: solo el link). */
  shareMessage?: string;
};

export function ShareLink({ url, shareMessage }: ShareLinkProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primary = getTokenValue('$primary', 'color');
  const white = getTokenValue('$white', 'color');

  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Si el portapapeles no está disponible, el link sigue visible y seleccionable.
    }
  }, [url]);

  const onShare = useCallback(async () => {
    try {
      await Share.share(
        Platform.OS === 'ios'
          ? { url, message: shareMessage ?? url }
          : { message: shareMessage ?? url },
      );
    } catch {
      // El usuario canceló o no hay share sheet (web). El botón Copiar es el fallback.
    }
  }, [url, shareMessage]);

  return (
    <YStack width="100%" maxWidth="100%" gap="$3">
      {/* El link destacado, en una "caja" — seleccionable, con guard de overflow horizontal. */}
      <View
        width="100%"
        maxWidth="100%"
        overflow="hidden"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$3"
      >
        <Text
          fontFamily="$body"
          fontSize="$4"
          fontWeight="500"
          color="$textPrimary"
          numberOfLines={2}
          ellipsizeMode="middle"
          selectable
        >
          {url}
        </Text>
      </View>

      {/* Acciones grandes (≥ $touchMin). Copiar = primario relleno; Compartir = outline. */}
      <XStack width="100%" gap="$3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Link copiado' : 'Copiar link'}
          onPress={() => void onCopy()}
          style={{ flex: 1 }}
        >
          <XStack
            width="100%"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            gap="$2"
            backgroundColor="$primary"
            borderRadius="$pill"
            paddingHorizontal="$4"
            pressStyle={{ backgroundColor: '$primaryPress' }}
          >
            {copied ? (
              <Check size={20} color={white} strokeWidth={2.5} />
            ) : (
              <Copy size={20} color={white} strokeWidth={2.5} />
            )}
            <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
              {copied ? 'Copiado' : 'Copiar'}
            </Text>
          </XStack>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Compartir link"
          onPress={() => void onShare()}
          style={{ flex: 1 }}
        >
          <XStack
            width="100%"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            gap="$2"
            backgroundColor="transparent"
            borderWidth={2}
            borderColor="$primary"
            borderRadius="$pill"
            paddingHorizontal="$4"
            pressStyle={{ backgroundColor: '$surface' }}
          >
            <Share2 size={20} color={primary} strokeWidth={2.5} />
            <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
              Compartir
            </Text>
          </XStack>
        </Pressable>
      </XStack>
    </YStack>
  );
}
