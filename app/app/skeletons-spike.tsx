// app/skeletons-spike.tsx — DESIGN SPIKE de los SKELETON LOADERS (polish U6b, docs/plan-mejoras-2026-07-20.md).
//
// ⚠️ SPIKE VISUAL, sin servicios/sesión/persistencia. Renderiza los skeletons de PRIMERA carga de las 4
// pantallas de mayor tráfico usando los MISMOS componentes que producción (AnimalRowSkeleton /
// GroupSummaryCardSkeleton / LoteCardSkeleton / ReportSkeleton) → lo que se vetea acá ES lo que ve el
// operario mientras baja la primera carga. Alcanzable directo en web sin auth (DEV_WEB_ROUTES) para el
// capture del Gate 2.5. Una VARIANTE por `?variant=`:
//   - 'animales' → lista de Animales (8 filas skeleton, espejo de AnimalRow).
//   - 'home'     → sección "Mis rodeos" (3 cards skeleton, espejo de GroupSummaryCard).
//   - 'lotes'    → lista de Lotes (3 cards skeleton, espejo de LoteCard).
//   - 'reportes' → sección "Reproductivo" (KPIs skeleton, espejo de KpiCard/KpiRow).
//
// Cero hardcode (ADR-023 §4): tokens + componentes. Voseo argentino.

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, XStack, YStack, getTokenValue } from 'tamagui';

import { AnimalRowSkeleton, GroupSummaryCardSkeleton, LoteCardSkeleton } from '@/components';
import { ReportSkeleton, ReportSectionHeader } from '@/components/reports';

type SkeletonSpikeVariant = 'animales' | 'home' | 'lotes' | 'reportes';

export default function SkeletonsSpikeScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ variant?: string }>();
  const variant = (typeof params.variant === 'string' ? params.variant : 'animales') as SkeletonSpikeVariant;

  const title =
    variant === 'home'
      ? 'Inicio'
      : variant === 'lotes'
        ? 'Lotes'
        : variant === 'reportes'
          ? 'Reportes'
          : 'Animales';

  // La lista de Animales corre a sangre completa (cada AnimalRow ya trae su padding lateral, como en la
  // tab real); el resto de las pantallas van con el padding $4 del contenedor.
  const horizontalPadding = variant === 'animales' ? 0 : getTokenValue('$4', 'space');

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" paddingVertical="$3">
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            {title}
          </Text>
        </XStack>
      </YStack>
      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$3', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {variant === 'animales' ? <AnimalesSkeletonVariant /> : null}
        {variant === 'home' ? <HomeSkeletonVariant /> : null}
        {variant === 'lotes' ? <LotesSkeletonVariant /> : null}
        {variant === 'reportes' ? <ReportesSkeletonVariant /> : null}
      </ScrollView>
    </YStack>
  );
}

function AnimalesSkeletonVariant() {
  return (
    <YStack width="100%">
      {Array.from({ length: 8 }).map((_, i) => (
        <AnimalRowSkeleton key={i} />
      ))}
    </YStack>
  );
}

function HomeSkeletonVariant() {
  return (
    <YStack width="100%" gap="$3">
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
        Mis rodeos
      </Text>
      {Array.from({ length: 3 }).map((_, i) => (
        <GroupSummaryCardSkeleton key={i} />
      ))}
    </YStack>
  );
}

function LotesSkeletonVariant() {
  return (
    <YStack width="100%" gap="$3">
      {Array.from({ length: 3 }).map((_, i) => (
        <LoteCardSkeleton key={i} />
      ))}
    </YStack>
  );
}

function ReportesSkeletonVariant() {
  return (
    <>
      <ReportSectionHeader title="Reproductivo" hint="Campaña · base servidas" />
      <ReportSkeleton />
    </>
  );
}
