// app/maniobra/tacto-spike.tsx — DESIGN SPIKE (spec 03 Stream B / B2): TACTO DE PREÑEZ CONFIGURABLE.
//
// ⚠️ SPIKE VISUAL, 100% MOCK. NO hay servicios, RPC, jornada ni persistencia: el resultado vive en estado
// local efímero y NO se guarda (onConfirm/onSave acá solo loggean). El objetivo es mostrar para el veto del
// leader (design-review), ANTES de cablearlo a la jornada real (eso es POST-VETO):
//   1. el `TactoStep` ADAPTATIVO (cuántos bloques de TAMAÑO muestra según los meses de servicio del rodeo,
//      RPSC.5.2–5.5), preservando el lenguaje visual aprobado (bloques gigantes, "PREÑADA" sin recorte).
//   2. el config "¿medir tamaño? sí/no" (`TactoConfigSheet`) con el default DERIVADO del rodeo (RPSC.4.2).
// Paridad con los spikes de PESAJE (`maniobra/paso`, M2.0), RUEDA de CE (`maniobra/rueda-ce`, M6-C.0) y
// SELECTOR DE MESES (`maniobra/service-months-spike`, B1): se alcanza directo en web sin auth
// (DEV_WEB_ROUTES) para la captura e2e a 360/412 en web TÁCTIL.
//
// La pantalla muestra UNA de cinco VARIANTES según `?variant=` (default 'two'):
//   - 'two'        → TactoStep con 2 bloques (rodeo de 2 meses: CABEZA/COLA). ← LA que Raf quiere ver.
//   - 'three'      → TactoStep con 3 bloques (rodeo de 3 meses: CABEZA/CUERPO/COLA). Control.
//   - 'none'       → TactoStep con 0 bloques (rodeo de 1 mes / "no medir"): PREÑADA va DIRECTO sin sub-paso.
//   - 'config-yes' → TactoConfigSheet con sugerido SÍ (rodeo de 3 meses).
//   - 'config-no'  → TactoConfigSheet con sugerido NO (rodeo sin configurar).
//
// Cero hardcode (ADR-023 §4): tokens. Light-only (MVP). Voseo argentino.

import { useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';

import { SpikeIdentityHeader } from './_components/SpikeIdentityHeader';
import { TactoStep } from './_components/TactoStep';
import { TactoConfigSheet } from './_components/TactoConfigSheet';
import { sizeBucketsForServiceMonths, defaultMeasureSize } from '@/utils/pregnancy-buckets';

type SpikeVariant = 'two' | 'three' | 'none' | 'config-yes' | 'config-no';

/** Identidad mock del animal en el brete (idéntica estructura a carga.tsx / rueda-ce.tsx). */
const MOCK_ANIMAL = {
  idv: 'ARG 0734',
  tagElectronic: '982 000734512098',
  rodeo: 'Vacas de cría',
  categoria: 'Vaquillona',
  progreso: 'Animal 7',
} as const;

/** Nº de meses de servicio del rodeo de la jornada según la variante (mock). */
function serviceMonthsCountFor(variant: SpikeVariant): number | null {
  switch (variant) {
    case 'two':
      return 2; // rodeo de 2 meses → 2 bloques (cabeza/cola)
    case 'three':
    case 'config-yes':
      return 3; // rodeo de 3 meses → 3 bloques / sugerido SÍ
    case 'none':
      return 1; // rodeo de 1 mes → sin tamaño (preñada/vacía)
    case 'config-no':
      return null; // sin configurar → sugerido NO
  }
}

function titleFor(variant: SpikeVariant): string {
  switch (variant) {
    case 'two':
      return 'Tacto · rodeo de 2 meses';
    case 'three':
      return 'Tacto · rodeo de 3 meses';
    case 'none':
      return 'Tacto · rodeo de 1 mes';
    case 'config-yes':
      return 'Config tacto · sugerido SÍ';
    case 'config-no':
      return 'Config tacto · sin configurar';
  }
}

function isConfigVariant(variant: SpikeVariant): boolean {
  return variant === 'config-yes' || variant === 'config-no';
}

export default function TactoSpike() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ variant?: string }>();
  const raw = Array.isArray(params.variant) ? params.variant[0] : params.variant;
  const variant: SpikeVariant =
    raw === 'three' || raw === 'none' || raw === 'config-yes' || raw === 'config-no' ? raw : 'two';

  const count = serviceMonthsCountFor(variant);
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // El config sheet vive como overlay sobre un fondo de contexto; lo mantenemos abierto en el spike.
  const [configOpen, setConfigOpen] = useState(true);
  // Último pregnancy_status confirmado (spike): lo surfaceamos en el DOM para que la captura PRUEBE
  // DD-PSC-2 (un rodeo de 1 mes / sin tamaño → PREÑADA persiste 'large', NO vacío ni nada).
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── Header de identidad (sticky, contexto), idéntico al de carga.tsx / rueda-ce.tsx ── */}
      <SpikeIdentityHeader
        idv={MOCK_ANIMAL.idv}
        tagElectronic={MOCK_ANIMAL.tagElectronic}
        rodeo={MOCK_ANIMAL.rodeo}
        categoria={MOCK_ANIMAL.categoria}
        progreso={MOCK_ANIMAL.progreso}
      />

      {/* ── Línea fina de contexto del spike (qué variante) ── */}
      <XStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$1" alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1} flexShrink={1}>
          {titleFor(variant)}
        </Text>
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textFaint" numberOfLines={1}>
          · B2 spike
        </Text>
      </XStack>

      {isConfigVariant(variant) ? (
        // ── VARIANTE config: el TactoConfigSheet sobre un fondo de contexto ──
        configOpen ? (
          <TactoConfigSheet
            suggested={defaultMeasureSize(count)}
            serviceMonthsCount={count}
            onSave={(measureSize) => {
              setConfigOpen(false);
              if (Platform.OS === 'web') {
                // eslint-disable-next-line no-console
                console.log('[spike tacto-config] guardado (mock, no se persiste): measureSize =', measureSize);
              }
            }}
            onClose={() => setConfigOpen(false)}
          />
        ) : (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$2">
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" color="$textMuted">
              Config cerrada (spike). Recargá para reabrir.
            </Text>
          </YStack>
        )
      ) : (
        // ── VARIANTE TactoStep: adaptativo según los buckets del rodeo (RPSC.5) ──
        <>
          {/* Status confirmado (spike): la captura lo lee para PROBAR DD-PSC-2 (preñada sin tamaño → 'large'). */}
          {lastStatus !== null ? (
            <Text
              testID="tacto-confirmed-status"
              fontFamily="$body"
              fontSize="$2"
              lineHeight="$3"
              color="$textFaint"
              paddingHorizontal="$4"
              paddingBottom="$1"
            >
              confirmado: {lastStatus}
            </Text>
          ) : null}
          <TactoStep
            bottomPad={bottomPad}
            buckets={sizeBucketsForServiceMonths(count)}
            onConfirm={(status) => {
              setLastStatus(status);
              if (Platform.OS === 'web') {
                // eslint-disable-next-line no-console
                console.log('[spike tacto] confirmado (mock, no se guarda):', status);
              }
            }}
          />
        </>
      )}
    </YStack>
  );
}
