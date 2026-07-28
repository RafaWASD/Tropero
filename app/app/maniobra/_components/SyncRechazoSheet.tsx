// app/maniobra/_components/SyncRechazoSheet.tsx — BOTTOM SHEET de RECHAZOS DE SYNC (spec 03 R10.8 / M4.2).
//
// Cierra el gap del dead-letter silencioso: una maniobra cargada OFFLINE que el server RECHAZA al
// sincronizar (gating capa 2 `23514` / RLS `42501` / tenant-check del session_id) se DESCARTA en
// connector.uploadData para no trabar la cola; hoy solo dejaba un console.warn. Este sheet le muestra al
// operario cada rechazo de MANIOBRA — su TIPO (Pesaje/Vacuna/…), el MOTIVO en es-AR y CUÁNDO pasó — para
// que no se pierda el dato de campo. Lo abre el BANNER terracota del landing (maniobra.tsx).
//
// SIN botón "rehacer": el re-hacer es MANUAL — el operario rehace la maniobra en su próxima jornada (el
// motivo le dice qué pasó, ej. "el rodeo dejó de habilitar esa maniobra" o "el animal cambió de campo").
// "Entendido" marca los rechazos como vistos (acknowledgeUploadRejections) y cierra.
//
// NADA es ROJO: un rechazo de sync no es un peligro que el operario pueda revertir desde acá — es un AVISO.
// El color de aviso del DS es $terracota (no hay token de error; mismo criterio que ExitJornadaSheet /
// SavePresetSheet / ManeuverErrorBanner). El ⚠ y el borde del banner/iconos van en terracota.
//
// PATRÓN del sheet (idiom LOCKEADO de ExitJornadaSheet / SavePresetSheet): backdrop $scrim tappable que
// descarta + sheet anclado abajo con grip + safe-area inferior. La lista de rechazos puede ser larga →
// va en un ScrollView acotado en alto (no empuja "Entendido" fuera de pantalla).
//
// ⚠️ GUARD ANTI TAP-THROUGH (web táctil, regla del repo `reference_rn_web_pitfalls`): el scrim lleva el
// guard `readyToDismissRef` armado en el próximo frame (doble requestAnimationFrame + fallback
// setTimeout(0)), igual que los otros sheets — el `click` huérfano del open (touch→mouse emulado del tap
// del banner) NO debe auto-cerrarlo (~1ms). Un tap DELIBERADO posterior SÍ cierra.
//
// RECORTE DE DESCENDENTES (regla dura): título + todo Text con numberOfLines llevan lineHeight matching.
// Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. es-AR voseo. Targets manga ≥$touchMin.

import { useEffect, useRef } from 'react';
import { Platform, Pressable } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { AlertTriangle } from 'lucide-react-native';

import { useDismissKeyboardOnOpen } from '@/hooks/useDismissKeyboardOnOpen';
import { useSafeBottomInset } from '@/hooks/useSafeBottomInset';
import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import {
  rejectionReason,
  rejectionWhenLabel,
  rejectionBannerTitle,
  type UploadRejection,
} from '@/services/powersync/upload-rejections';

export type SyncRechazoSheetProps = {
  /** Los rechazos de MANIOBRA a mostrar (ya filtrados por isManeuverRejection en el caller). */
  rejections: readonly UploadRejection[];
  /** "Entendido": marca estos rechazos como vistos (acknowledge) y cierra. */
  onAcknowledge: () => void;
  /** Cerrar el sheet sin marcar vistos (tap en el scrim). Quedan para volver a verlos. */
  onClose: () => void;
};

export function SyncRechazoSheet({ rejections, onAcknowledge, onClose }: SyncRechazoSheetProps) {
  // ABRIR EL SHEET BAJA EL TECLADO (bug 🔴 device Android): este sheet aparece SOLO (lo dispara la llegada de
  // rechazos de sync), o sea que puede montarse en cualquier momento — incluido mientras se tipea.
  useDismissKeyboardOnOpen();

  const bottomPad = useSafeBottomInset();

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  // Idéntico a ExitJornadaSheet/SavePresetSheet: el banner abre el sheet con un onPress; en web táctil el
  // browser emula touch→mouse→click ~20ms después y ese click cae sobre el scrim recién montado → lo
  // cerraría a ~1ms. El scrim ignora presses hasta estar "listo para descartar" (armado en el PRÓXIMO
  // frame vía doble rAF). El click huérfano del open ya pasó; un tap DELIBERADO posterior SÍ cierra.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      readyToDismissRef.current = true;
    };
    if (typeof requestAnimationFrame === 'function') {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(arm);
      });
    } else {
      timer = setTimeout(arm, 0);
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

  const TERRACOTA = getTokenValue('$terracota', 'color');
  // Título con pluralización es-AR correcta (sustantivo + verbo).
  const title = rejectionBannerTitle(rejections.length);
  // Subtítulo de ayuda, también concordado en número (1 → "Esta carga la"; N → "Estas cargas las").
  const subtitle =
    rejections.length === 1
      ? 'Esta carga la rechazó el servidor. Volvé a hacerla en tu próxima jornada.'
      : 'Estas cargas las rechazó el servidor. Volvé a hacerlas en tu próxima jornada.';

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra (= ver después).
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="sync-rechazo-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="sync-rechazo-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Título + ayuda. ⚠ terracota (aviso, no peligro). lineHeight matching ("sincronizaron" trae descenders). */}
        <XStack alignItems="center" gap="$2">
          {/* ⚠ del aviso: ~half del contenedor de ícono canónico ($icon=48 → 24px), tamaño de glifo
              consistente con los headers de los otros sheets (Check de ExitJornadaSheet = heroIcon*0.5). */}
          <AlertTriangle size={getTokenValue('$icon', 'size') * 0.5} color={TERRACOTA} />
          <YStack flex={1} minWidth={0} gap="$1">
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={2}>
              {title}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={2}>
              {subtitle}
            </Text>
          </YStack>
        </XStack>

        {/* LISTA de rechazos: tipo + motivo + cuándo. ScrollView acotado para que "Entendido" no se vaya
            de pantalla con muchos rechazos. */}
        <ScrollView maxHeight={getTokenValue('$candidateListMax', 'size')} showsVerticalScrollIndicator={false}>
          <YStack gap="$3">
            {rejections.map((r) => (
              <RechazoRow key={r.id} rejection={r} />
            ))}
          </YStack>
        </ScrollView>

        {/* "Entendido": marca vistos + cierra. Primaria (es la única acción; no destructiva). */}
        <Button variant="primary" fullWidth onPress={onAcknowledge} testID="sync-rechazo-entendido">
          Entendido
        </Button>
      </YStack>
    </View>
  );
}

/** Una fila de la lista: tipo de maniobra + motivo es-AR + cuándo. Borde terracota (aviso). */
function RechazoRow({ rejection }: { rejection: UploadRejection }) {
  // El motivo ya incluye el TIPO de maniobra como prefijo (rejectionReason → "Pesaje: …"). Lo mostramos
  // como una línea fuerte; el "cuándo" abajo, atenuado.
  const reason = rejectionReason(rejection.table, rejection.code);
  const when = rejectionWhenLabel(rejection.at);
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      gap="$1"
      {...labelA11y(Platform.OS, `${reason} (${when})`)}
    >
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$textPrimary" numberOfLines={3}>
        {reason}
      </Text>
      <Text fontFamily="$body" fontSize="$2" lineHeight="$2" color="$textMuted" numberOfLines={1}>
        {when}
      </Text>
    </View>
  );
}
