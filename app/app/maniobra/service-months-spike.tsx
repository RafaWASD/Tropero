// app/maniobra/service-months-spike.tsx — DESIGN SPIKE (spec 03 Stream B / B1): SELECTOR DE MESES de
// servicio del rodeo (ServiceMonthsSelector), RE-ITERACIÓN con CONTIGÜIDAD POR CONSTRUCCIÓN.
//
// ⚠️ SPIKE VISUAL, 100% MOCK. NO hay servicios, RPC, outbox ni persistencia: el conjunto de meses vive
// en estado local efímero del componente y NO se guarda (el `onChange` acá sólo actualiza el estado y
// loggea). El objetivo es mostrar el selector 🔴 form-de-wizard para el veto del leader (design-review)
// ANTES de cablearlo al alta/edición real de rodeo (eso es POST-VETO). Paridad con el spike de la RUEDA
// de CE (`maniobra/rueda-ce`, M6-C.0) y el de PESAJE (`maniobra/paso`, M2.0): se alcanza directo en web
// sin auth (DEV_WEB_ROUTES) para la captura e2e a 360/412 en web TÁCTIL.
//
// 🔑 Constraint nuevo (Raf 2026-06-23): UN solo período CONTIGUO por rodeo, con WRAP de fin de año. La
// selección manual es "inicio → fin" (2 taps): imposible armar un set disjunto. Ver `service-months.ts`.
//
// La pantalla muestra UNO de tres ESTADOS según el query param `?state=` (default 'alta'):
//   - 'alta'      → wizard de alta: PRIMAVERA pre-tildada (RPSC.2.2). value = [10,11,12] (Oct → Dic).
//   - 'edicion'   → rodeo existente SIN configurar: estado "sin configurar" + invita a elegir
//                   (RPSC.3.2). value = null.
//   - 'custom'    → un período CON WRAP ya cerrado (Nov → Ene). value = [1,11,12]. El label muestra
//                   "Nov → Ene · 3 meses" (orden de servicio, no min/max).
// El ESTADO INTERMEDIO (inicio tocado, esperando el fin) NO es un value inicial — es resultado de tocar
// un chip; la captura (service-months-spike.capture.ts) lo reproduce tocando un mes y screenshoteando.
//
// Cada estado renderiza un selector INTERACTIVO real (se puede tocar para vetar el comportamiento).
//
// Cero hardcode (ADR-023 §4): tokens. Light-only (MVP). Voseo argentino.

import { useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { getTokenValue, ScrollView, Text, YStack } from 'tamagui';

import { ServiceMonthsSelector, type ServiceMonthsSelectorMode } from '../_components/ServiceMonthsSelector';
import { SPRING_DEFAULT } from '@/utils/service-months';

type SpikeState = 'alta' | 'edicion' | 'custom';

/** Estado inicial del selector según el caso del spike (mock). */
function initialValueFor(state: SpikeState): number[] | null {
  switch (state) {
    case 'alta':
      return [...SPRING_DEFAULT]; // primavera pre-tildada (RPSC.2.2) — Oct → Dic
    case 'edicion':
      return null; // "sin configurar" (RPSC.3.2)
    case 'custom':
      return [1, 11, 12]; // período con WRAP ya cerrado (Nov → Dic → Ene), ordenado asc
  }
}

function modeFor(state: SpikeState): ServiceMonthsSelectorMode {
  return state === 'alta' || state === 'custom' ? 'alta' : 'edicion';
}

function titleFor(state: SpikeState): string {
  switch (state) {
    case 'alta':
      return 'Crear rodeo · meses de servicio';
    case 'edicion':
      return 'Editar rodeo · meses de servicio';
    case 'custom':
      return 'Crear rodeo · período con wrap';
  }
}

export default function ServiceMonthsSpike() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ state?: string }>();
  const raw = Array.isArray(params.state) ? params.state[0] : params.state;
  const state: SpikeState = raw === 'edicion' || raw === 'custom' ? raw : 'alta';

  const [value, setValue] = useState<number[] | null>(() => initialValueFor(state));

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* Header mínimo de contexto del spike (NO es el chrome real del wizard — eso lo decide el cableado). */}
      <YStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2" gap="$1">
        <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
          {titleFor(state)}
        </Text>
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textFaint">
          Design-spike B1 · estado: {state}
        </Text>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$2', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        <ServiceMonthsSelector
          value={value}
          mode={modeFor(state)}
          onChange={(months) => {
            setValue(months);
            if (Platform.OS === 'web') {
              // SPIKE: no se persiste. Log para inspección manual en el dev build.
              // eslint-disable-next-line no-console
              console.log('[spike service-months] onChange (mock, no se guarda):', months);
            }
          }}
        />
      </ScrollView>
    </YStack>
  );
}
