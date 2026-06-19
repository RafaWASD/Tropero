// app/maniobra/rueda-ce.tsx — DESIGN SPIKE (spec 03 M6-C.0): PASO de CIRCUNFERENCIA ESCROTAL (rueda inercial).
//
// ⚠️ SPIKE VISUAL, 100% MOCK. NO hay servicios, balanza, BLE ni persistencia: la CE/edad elegidas viven en
// estado local efímero del CircunferenciaEscrotalStep y NO se guardan (el onConfirm acá solo es un no-op
// loggeable). El objetivo es mostrar la RUEDA inercial 🔴 manga (wheel picker) para el veto del leader
// (design-review) ANTES de cablearla al frame (eso es M6-C.1). Paridad con el spike de PESAJE
// (`maniobra/paso`, M2.0): se alcanza directo en web sin auth (DEV_WEB_ROUTES) para la captura e2e a
// 360/412 en web TÁCTIL.
//
// Pantalla representada: carga de la CE del toro en el brete.
//   - Mismo header de identidad SIEMPRE visible (R12.4), via SpikeIdentityHeader (mock toro entero).
//   - Línea fina de maniobra + paso.
//   - CircunferenciaEscrotalStep: rueda de CE dominante + número grande "36,0 cm" + edad secundaria
//     prellenada ("≈ 24 meses", mock) + confirm gigante.
//
// VALOR INICIAL de la rueda (mock, dirección del leader): 36,0 cm. Edad prellenada (mock): 24 meses.
//
// Cero hardcode (ADR-023 §4): tokens. Light-only (MVP).

import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';

import { CircunferenciaEscrotalStep } from './_components/CircunferenciaEscrotalStep';
import { SpikeIdentityHeader } from './_components/SpikeIdentityHeader';

// ─── MOCK (hardcodeado — se reemplaza por datos reales en M6-C.1) ────────────────────────────────
const MOCK_ANIMAL = {
  idv: 'ARG 0512',
  tagElectronic: '982 000412345678',
  rodeo: 'Toros de servicio',
  categoria: 'Toro',
  progreso: 'Animal 4',
  maniobra: 'Circunferencia escrotal',
  pasoActual: 2,
  pasoTotal: 3,
} as const;

/** Valor inicial de la rueda de CE (mock, dirección del leader M6-C.0). */
const MOCK_INITIAL_CM = 36;
/** Edad prellenada en meses (mock — en M6-C.1 sale de animal_birth_date, R14.6). */
const MOCK_AGE_MONTHS = 24;

export default function RuedaCeSpike() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── HEADER DE IDENTIDAD (sticky, contexto), idéntico al de carga.tsx / paso.tsx ── */}
      <SpikeIdentityHeader
        idv={MOCK_ANIMAL.idv}
        tagElectronic={MOCK_ANIMAL.tagElectronic}
        rodeo={MOCK_ANIMAL.rodeo}
        categoria={MOCK_ANIMAL.categoria}
        progreso={MOCK_ANIMAL.progreso}
      />

      {/* ── LÍNEA FINA DE MANIOBRA + PASO ── */}
      <XStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$1" alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1} flexShrink={1}>
          {MOCK_ANIMAL.maniobra}
        </Text>
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" color="$textFaint" numberOfLines={1}>
          · {MOCK_ANIMAL.pasoActual} de {MOCK_ANIMAL.pasoTotal}
        </Text>
      </XStack>

      {/* ── PASO de CE (rueda inercial dominante + edad secundaria + confirm gigante). Mock onConfirm. ── */}
      <CircunferenciaEscrotalStep
        initialCm={MOCK_INITIAL_CM}
        ageMonths={MOCK_AGE_MONTHS}
        bottomPad={bottomPad}
        onConfirm={(result) => {
          // SPIKE: no se persiste. Log para inspección manual en el dev build.
          if (Platform.OS === 'web') {
            // eslint-disable-next-line no-console
            console.log('[spike rueda-ce] confirmado (mock, no se guarda):', result);
          }
        }}
      />
    </YStack>
  );
}
