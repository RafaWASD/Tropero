// app/maniobra.tsx — INICIO de MODO MANIOBRAS (spec 03 M1.4, US-2/R2.2).
//
// Destino del FAB central elevado (presentación modal, ver _layout.tsx raíz). Pantalla de arranque del
// wizard de jornada:
//   - PRESETS AL TOPE (R2.2): filas tappables de presets del establecimiento; tap arranca la jornada
//     desde el preset (navega al wizard con presetId → el wizard carga sus maniobras aplicables y avisa
//     las omitidas por gating del rodeo, R2.3). Cualquier rol operativo activo los ve (scope establishment).
//   - CTA grande "Nueva jornada": arranca el wizard desde cero (etapa 1 = elegir rodeo).
//
// Servicios consumidos (M1-SERVICIOS, NO se tocan): fetchPresets (lista local offline). El establishment
// activo SIEMPRE del contexto (NUNCA hardcodeado, CLAUDE.md ppio 6).
//
// 🟡 mixto: targets grandes + CTA primario en zona del pulgar, pero permite la densidad de la lista de
// presets. RECORTE DE DESCENDENTES (memoria): headings ≥$6 y Text con numberOfLines llevan lineHeight
// matching. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue.

import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronRight, Sparkles, X, Zap } from 'lucide-react-native';

import { Button, Card, InfoNote } from '@/components';
import { useEstablishment } from '@/contexts';
import { fetchPresets, type ManeuverPreset } from '@/services/maneuver-presets';
import { extractManeuvers } from '@/utils/maneuver-config';
import { maneuverLabel } from '@/utils/maneuver-wizard';

export default function ManiobraInicioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state: estState } = useEstablishment();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const [presets, setPresets] = useState<ManeuverPreset[]>([]);
  const [loading, setLoading] = useState(true);

  // Cargamos presets al enfocar (local, offline). Un campo sin presets es válido (solo "Nueva jornada").
  useFocusEffect(
    useCallback(() => {
      if (!establishmentId) {
        setPresets([]);
        setLoading(false);
        return;
      }
      let active = true;
      setLoading(true);
      void (async () => {
        const r = await fetchPresets(establishmentId);
        if (!active) return;
        setPresets(r.ok ? r.value : []);
        setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [establishmentId]),
  );

  const onNuevaJornada = useCallback(() => {
    router.push('/maniobra/jornada');
  }, [router]);

  const onPreset = useCallback(
    (preset: ManeuverPreset) => {
      // Arranca el wizard desde el preset: el wizard pide el rodeo (etapa 1) y al elegirlo carga el
      // preset contra ese rodeo (loadPreset filtra maniobras gateadas OFF + avisa las omitidas, R2.3).
      router.push({ pathname: '/maniobra/jornada', params: { presetId: preset.id } });
    },
    [router],
  );

  const PRIMARY = getTokenValue('$primary', 'color');
  const MUTED = getTokenValue('$textMuted', 'color');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── HEADER: título + cerrar (es modal) ── */}
      <XStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2" alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap="$2">
          <Zap size={26} color={PRIMARY} fill={PRIMARY} />
          {/* "MODO MANIOBRAS" — heading, lineHeight matching por convención. */}
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
            Modo maniobras
          </Text>
        </XStack>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12}>
          <X size={26} color={MUTED} />
        </Pressable>
      </XStack>

      <ScrollView
        flex={1}
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$2', 'space'),
          paddingBottom: getTokenValue('$6', 'space'),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── PRESETS AL TOPE (R2.2) ── */}
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1} marginBottom="$2">
          Tus rutinas
        </Text>

        {loading ? (
          <InfoNote>Cargando rutinas…</InfoNote>
        ) : presets.length === 0 ? (
          <InfoNote>Todavía no tenés rutinas guardadas. Arrancá una jornada nueva y, cuando quieras, guardala como rutina.</InfoNote>
        ) : (
          <YStack gap="$3">
            {presets.map((p) => (
              <PresetRow key={p.id} preset={p} onPress={onPreset} />
            ))}
          </YStack>
        )}
      </ScrollView>

      {/* ── CTA "Nueva jornada" (zona del pulgar) ── */}
      <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad}>
        <Button fullWidth onPress={onNuevaJornada}>
          Nueva jornada
        </Button>
      </YStack>
    </YStack>
  );
}

function PresetRow({ preset, onPress }: { preset: ManeuverPreset; onPress: (p: ManeuverPreset) => void }) {
  const PRIMARY = getTokenValue('$primary', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  // Resumen legible de las maniobras del preset (filtra desconocidas vía extractManeuvers).
  const maniobras = extractManeuvers(preset.config);
  const summary = maniobras.length > 0 ? maniobras.map(maneuverLabel).join(' · ') : 'Sin maniobras';
  return (
    <Pressable onPress={() => onPress(preset)} accessibilityRole="button" accessibilityLabel={`Arrancar rutina ${preset.name}`}>
      <Card>
        <XStack alignItems="center" gap="$3">
          <View backgroundColor="$greenLight" borderRadius="$pill" width={44} height={44} alignItems="center" justifyContent="center">
            <Sparkles size={22} color={PRIMARY} />
          </View>
          <YStack flex={1} minWidth={0} gap="$1">
            {/* Nombre del preset — lineHeight matching (puede traer descendentes). */}
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {preset.name}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
              {summary}
            </Text>
          </YStack>
          <ChevronRight size={22} color={FAINT} />
        </XStack>
      </Card>
    </Pressable>
  );
}
