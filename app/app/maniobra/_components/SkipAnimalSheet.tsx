// app/maniobra/_components/SkipAnimalSheet.tsx — BOTTOM SHEET de confirmación de SALTEAR un animal (spec 03
// delta `skip-animal-maniobra`, ítem C triage demo-facundo-padre 2026-07-10, R5.15).
//
// Lo abre la afordancia "Saltear" del header de la carga rápida (SpikeIdentityHeader). Confirma antes de
// abandonar el animal → previene el tap accidental en la manga (guante, barro, una mano). Consistente con
// ExitJornadaSheet (siempre confirma salir). El TONO se adapta a si hay datos parciales cargados:
//   - SIN datos (caso dominante del pedido — "no cargarle ninguna maniobra"): liviano, sin ícono de alarma.
//   - CON datos: aviso terracota (color de aviso del DS, no rojo de pánico) — "Se descarta lo cargado".
//
// FAIL-CLOSED: `onConfirm` hace el descarte y devuelve null al OK (→ `onDone` navega al próximo animal) o un
// mensaje es-AR al fallo (→ NO navega: superficia + reintenta — mismo espíritu que ExitJornadaSheet /
// ManeuverErrorBanner). El descarte NO incrementa el contador de animales procesados (lo maneja el caller: al
// saltear NO llama setSessionCounts).
//
// PATRÓN del sheet (idiom LOCKEADO de ExitJornadaSheet / ConfirmDeleteSheet): backdrop $scrim tappable que
// descarta (= seguir en este animal) + sheet anclado abajo con grip + safe-area. ⚠️ GUARD ANTI TAP-THROUGH
// (web táctil, `reference_rn_web_pitfalls`): el scrim ignora presses hasta el próximo frame (doble rAF +
// fallback setTimeout(0)) — el click huérfano del open no lo auto-cierra; un tap deliberado posterior sí.
//
// RECORTE DE DESCENDENTES (regla dura): título ("¿Saltear este animal?" trae j) + Text con numberOfLines
// llevan lineHeight matching. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. es-AR voseo.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { SkipForward } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';

export type SkipAnimalSheetProps = {
  /** Cantidad de maniobras ya cargadas en este animal (0 = nada cargado → tono liviano; ≥1 → aviso descarte). */
  capturedCount: number;
  /**
   * Ejecuta el descarte de lo cargado (soft-delete de las filas de evento de este animal). Devuelve null al OK
   * (→ el sheet llama `onDone` para navegar) o un mensaje es-AR al fallo (→ NO navega, se superficia + reintenta
   * — fail-closed). Con 0 maniobras el caller no descarta nada y devuelve null directo.
   */
  onConfirm: () => Promise<string | null>;
  /** Navegar al próximo animal (identify-first), SIN incrementar el contador. Se llama tras un descarte OK. */
  onDone: () => void;
  /** Cerrar sin saltear (seguir en este animal / tap en el scrim). */
  onClose: () => void;
};

export function SkipAnimalSheet({ capturedCount, onConfirm, onDone, onClose }: SkipAnimalSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));
  const hasData = capturedCount > 0;

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
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

  // ¿Saltear en vuelo? (deshabilita el botón para no disparar dos descartes / dos navegaciones).
  const [skipping, setSkipping] = useState(false);
  // Error (fail-closed): onConfirm devolvió un mensaje → NO se navega, se superficia + reintenta.
  const [error, setError] = useState<string | null>(null);

  const handleSkip = async () => {
    if (skipping) return;
    setSkipping(true);
    setError(null);
    const err = await onConfirm();
    if (err == null) {
      onDone(); // descarte OK (o nada que descartar) → navegar al próximo animal.
      return;
    }
    setSkipping(false);
    setError(err);
  };

  const TERRACOTA = getTokenValue('$terracota', 'color');
  const maniobrasWord = capturedCount === 1 ? 'maniobra' : 'maniobras';

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra (= seguir en este animal).
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      {/* El scrim descarta (= seguir en este animal), pero su accessible name es genérico "Cerrar" para NO
          compartir nombre con el botón de cancelar visible ("Seguir en este animal") — evita que dos elementos
          expongan el mismo accessible name (olor de a11y + ambigüedad de locators). El botón visible queda como
          el ÚNICO "Seguir en este animal". */}
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="skip-animal-scrim"
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
        testID="skip-animal-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Encabezado. Con datos: ícono de aviso terracota + copy de descarte. Sin datos: copy liviano. */}
        <YStack gap="$3">
          <View
            width={48}
            height={48}
            borderRadius="$pill"
            backgroundColor={hasData ? '$surface' : '$greenLight'}
            borderWidth={hasData ? 2 : 0}
            borderColor={hasData ? '$terracota' : undefined}
            alignItems="center"
            justifyContent="center"
          >
            <SkipForward
              size={getTokenValue('$icon', 'size') * 0.55}
              color={hasData ? TERRACOTA : getTokenValue('$primary', 'color')}
              strokeWidth={2.5}
            />
          </View>
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={2}>
            ¿Saltear este animal?
          </Text>
          {hasData ? (
            <Text fontFamily="$body" fontSize="$5" lineHeight="$6" fontWeight="600" color="$terracota" numberOfLines={3}>
              Se descarta lo cargado (
              <Text fontWeight="800" color="$terracota">{capturedCount}</Text> {maniobrasWord}) y seguís con el próximo.
            </Text>
          ) : (
            <Text fontFamily="$body" fontSize="$5" lineHeight="$6" fontWeight="500" color="$textMuted" numberOfLines={3}>
              No cargaste ninguna maniobra en este animal. Seguís con el próximo.
            </Text>
          )}
        </YStack>

        {/* ERROR (fail-closed): el descarte no se pudo encolar → no navegamos, dejamos reintentar. Terracota. */}
        {error ? (
          <View
            testID="skip-animal-error"
            backgroundColor="$surface"
            borderWidth={1}
            borderColor="$terracota"
            borderRadius="$card"
            paddingHorizontal="$4"
            paddingVertical="$3"
            {...labelA11y(Platform.OS, error)}
          >
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$terracota" numberOfLines={3}>
              {error}
            </Text>
          </View>
        ) : null}

        {/* ACCIONES — una columna, targets manga ≥$touchMin. "Saltear animal" primero (lo que el operario vino a
            hacer); con datos = terracota (aviso de descarte), sin datos = verde primario (nada que perder).
            "Seguir en este animal" = camino seguro (secundario outline). */}
        <YStack gap="$2">
          <Pressable
            onPress={skipping ? undefined : () => void handleSkip()}
            testID="skip-animal-confirm"
            {...buttonA11y(Platform.OS, { label: 'Saltear animal', disabled: skipping })}
          >
            <View
              backgroundColor={hasData ? '$terracota' : '$primary'}
              borderRadius="$pill"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              opacity={skipping ? 0.5 : 1}
              pressStyle={{ opacity: 0.85 }}
            >
              <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
                {skipping ? 'Salteando…' : 'Saltear animal'}
              </Text>
            </View>
          </Pressable>
          <Button variant="secondary" fullWidth disabled={skipping} onPress={onClose}>
            Seguir en este animal
          </Button>
        </YStack>
      </YStack>
    </View>
  );
}
