// app/maniobra/_components/TactoConfigSheet.tsx — BOTTOM SHEET de preconfig de tanda del TACTO DE PREÑEZ
// (spec 03 Stream B / B2, RPSC.4 — "¿medir tamaño de preñez? sí/no"). Patrón as-built `ManeuverConfigSheet`
// (M1.4): scrim tappable + scrim-guard contra el click huérfano (BUG web) + header FIJO / cuerpo / footer
// FIJO → el título nunca se recorta al crecer el contenido.
//
// A DIFERENCIA de `ManeuverConfigSheet` (input de texto libre de vacuna/pajuela), esta preconfig es UNA
// DECISIÓN BINARIA (una decisión por pantalla, manga-friendly, CLAUDE.md ppio 4):
//   ¿Medir tamaño de preñez?   [ SÍ ]   [ NO ]   (segmentado gigante, ≥ $touchMin)
//
// 🔑 DEFAULT DERIVADO DEL RODEO (RPSC.4.2, DD-PSC-3): el caller calcula `suggested` con
// `defaultMeasureSize(nMonths)` (FUENTE ÚNICA). El sheet MUESTRA el sugerido explícito ("Sugerido: SÍ —
// este rodeo tiene 3 meses de servicio") y PRE-SELECCIONA esa opción, pero el operario puede OVERRIDE de
// un toque (RPSC.4.3). Es default de TANDA (precarga), no un bloqueo. Un rodeo "sin configurar" → sugerido
// NO + copy que no frena la jornada (RPSC.4.4, degradar con gracia).
//
// ⚠️ DESIGN-SPIKE (B2): este sheet es VISUAL + estado controlado. El CABLEADO a `config.preconfig` de la
// jornada (persistir la elección en el jsonb de `sessions`/`maneuver_presets`) lo hace el caller POST-VETO.
//
// Cero hardcode (ADR-023 §4): tokens; lo que cruza a APIs no-Tamagui (lucide) vía getTokenValue. Targets
// manga ≥$touchMin. Recorte de descendentes (memoria): el título ("¿Medir tamaño…?" trae '¿','g','ñ') y
// todo Text con numberOfLines llevan lineHeight matching.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, X } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';

export type TactoConfigSheetProps = {
  /** Default DERIVADO del rodeo (`defaultMeasureSize(nMonths)`). Pre-selecciona y se muestra como sugerido. */
  suggested: boolean;
  /** Nº de meses de servicio del rodeo de la jornada (para el copy del sugerido). `null` = sin configurar. */
  serviceMonthsCount: number | null;
  /** Valor ACTUAL persistido en el config, si ya se configuró antes (override previo). `undefined` = usar el sugerido. */
  value?: boolean;
  /** Guardar: el caller persiste en `config.preconfig.tacto.measureSize` la elección. */
  onSave: (measureSize: boolean) => void;
  /** Cerrar sin guardar. */
  onClose: () => void;
};

const TITLE = '¿Medir tamaño de preñez?';
const COPY =
  'Si lo activás, al marcar PREÑADA vas a elegir el tamaño (cabeza / cuerpo / cola). Alimenta la distribución de preñez por etapa.';

/** Copy del sugerido, derivado del nº de meses del rodeo (RPSC.4.2/RPSC.4.4). */
function suggestedCopy(suggested: boolean, count: number | null): string {
  const verdict = suggested ? 'SÍ' : 'NO';
  if (count === null) {
    return `Sugerido: ${verdict} — este rodeo todavía no tiene meses de servicio configurados.`;
  }
  if (count === 0) {
    return `Sugerido: ${verdict} — este rodeo no hace servicio.`;
  }
  const meses = count === 1 ? '1 mes' : `${count} meses`;
  return `Sugerido: ${verdict} — este rodeo tiene ${meses} de servicio.`;
}

/** Un botón del segmentado Sí/No (gigante, manga-friendly). Activo = $primary lleno; inactivo = outline. */
function SegmentButton({
  label,
  active,
  icon,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{ flex: 1 }}
      {...buttonA11y(Platform.OS, { label, selected: active })}
    >
      <View
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor={active ? '$primary' : '$divider'}
        backgroundColor={active ? '$primary' : '$white'}
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        pressStyle={{ opacity: 0.7 }}
      >
        {icon}
        <Text
          fontFamily="$body"
          fontSize="$6"
          lineHeight="$6"
          fontWeight="700"
          color={active ? '$white' : '$textPrimary'}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function TactoConfigSheet({
  suggested,
  serviceMonthsCount,
  value,
  onSave,
  onClose,
}: TactoConfigSheetProps) {
  const insets = useSafeAreaInsets();

  // Scrim-guard contra el "click huérfano" del tap que abrió el sheet (BUG web, idéntico a
  // ManeuverConfigSheet): arranca false al montar y se arma en el próximo frame (doble rAF). El scrim
  // ignora presses hasta entonces; un tap DELIBERADO posterior sí cierra. Fallback setTimeout(0).
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

  // Selección actual: lo persistido (override previo) o el sugerido derivado del rodeo (RPSC.4.2).
  const [measureSize, setMeasureSize] = useState<boolean>(value ?? suggested);

  const PRIMARY = getTokenValue('$primary', 'color');
  const TEXT_PRIMARY = getTokenValue('$textPrimary', 'color');
  const WHITE = getTokenValue('$white', 'color');
  const ICON = getTokenValue('$navIcon', 'size');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$4', 'space'));

  const a11ySuggested = labelA11y(Platform.OS, suggestedCopy(suggested, serviceMonthsCount));

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
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="tacto-config-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="tacto-config-sheet"
      >
        {/* ── HEADER FIJO (grip + título). flexShrink:0 → el título nunca se recorta. ── */}
        <YStack flexShrink={0} gap="$4">
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />
          <YStack gap="$1">
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {TITLE}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$4" color="$textMuted" numberOfLines={3}>
              {COPY}
            </Text>
          </YStack>
        </YStack>

        {/* ── CUERPO: sugerido + segmentado Sí/No ── */}
        <YStack gap="$3">
          {/* Sugerido derivado del rodeo (RPSC.4.2), visible y explícito. */}
          <View
            testID="tacto-config-suggested"
            width="100%"
            backgroundColor="$surface"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$divider"
            paddingHorizontal="$4"
            paddingVertical="$3"
            {...a11ySuggested}
          >
            <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="500" color="$textMuted">
              {suggestedCopy(suggested, serviceMonthsCount)}
            </Text>
          </View>

          {/* Segmentado Sí/No gigante (una decisión por pantalla, override de un toque). */}
          <XStack width="100%" gap="$3">
            <SegmentButton
              testID="tacto-config-yes"
              label="SÍ"
              active={measureSize}
              icon={<Check size={ICON} color={measureSize ? WHITE : PRIMARY} strokeWidth={3} />}
              onPress={() => setMeasureSize(true)}
            />
            <SegmentButton
              testID="tacto-config-no"
              label="NO"
              active={!measureSize}
              icon={<X size={ICON} color={!measureSize ? WHITE : TEXT_PRIMARY} strokeWidth={3} />}
              onPress={() => setMeasureSize(false)}
            />
          </XStack>
        </YStack>

        {/* ── FOOTER FIJO (Guardar/Cancelar). flexShrink:0 → siempre abajo. ── */}
        <YStack flexShrink={0} gap="$2">
          <Button variant="primary" fullWidth onPress={() => onSave(measureSize)}>
            Guardar
          </Button>
          <Button variant="secondary" fullWidth onPress={onClose}>
            Cancelar
          </Button>
        </YStack>
      </YStack>
    </View>
  );
}
