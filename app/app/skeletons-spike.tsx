// app/skeletons-spike.tsx — DESIGN SPIKE de los SKELETON LOADERS (polish U6b, docs/plan-mejoras-2026-07-20.md).
//
// ⚠️ SPIKE VISUAL, sin servicios/sesión/persistencia. Renderiza los skeletons de PRIMERA carga de las
// pantallas cubiertas usando los MISMOS componentes que producción (AnimalRowSkeleton /
// GroupSummaryCardSkeleton / LoteCardSkeleton / ReportSkeleton + AnimalFichaSkeleton / RodeoCardSkeleton /
// MemberRowSkeleton) → lo que se vetea acá ES lo que ve el operario mientras baja la primera carga.
// Alcanzable directo en web sin auth (DEV_WEB_ROUTES) para el capture del Gate 2.5. Una VARIANTE por
// `?variant=`:
//   1er incremento (commit 54c13ea):
//   - 'animales' → lista de Animales (8 filas skeleton, espejo de AnimalRow).
//   - 'home'     → sección "Mis rodeos" (3 cards skeleton, espejo de GroupSummaryCard).
//   - 'lotes'    → lista de Lotes (3 cards skeleton, espejo de LoteCard).
//   - 'reportes' → sección "Reproductivo" (KPIs skeleton, espejo de KpiCard/KpiRow).
//   2do incremento (U6b):
//   - 'ficha'    → ficha de animal (hero + 2 cards de sección, espejo de AnimalHero/DetailSection).
//   - 'rodeos'   → lista de Rodeos (3 cards skeleton owner, espejo de RodeoCard).
//   - 'miembros' → equipo (Card con 4 filas SIN avatar, espejo de MemberRow).
//
// Cero hardcode (ADR-023 §4): tokens + componentes. Voseo argentino.

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View, XStack, YStack, getTokenValue } from 'tamagui';

import {
  AnimalRowSkeleton,
  AnimalFichaSkeleton,
  Card,
  GroupSummaryCardSkeleton,
  LoteCardSkeleton,
  MemberRowSkeleton,
  RodeoCardSkeleton,
} from '@/components';
import { ReportSkeleton, ReportSectionHeader } from '@/components/reports';

type SkeletonSpikeVariant =
  | 'animales'
  | 'home'
  | 'lotes'
  | 'reportes'
  | 'ficha'
  | 'rodeos'
  | 'miembros';

const TITLES: Record<SkeletonSpikeVariant, string> = {
  animales: 'Animales',
  home: 'Inicio',
  lotes: 'Lotes',
  reportes: 'Reportes',
  ficha: '', // la ficha real no tiene título (el hero lo es) — solo la barra de back.
  rodeos: 'Rodeos',
  miembros: 'Equipo',
};

export default function SkeletonsSpikeScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ variant?: string }>();
  const variant = (typeof params.variant === 'string' ? params.variant : 'animales') as SkeletonSpikeVariant;
  const title = TITLES[variant] ?? 'Animales';

  // La lista de Animales corre a sangre completa (cada AnimalRow ya trae su padding lateral, como en la
  // tab real); el resto de las pantallas van con el padding $4 del contenedor.
  const horizontalPadding = variant === 'animales' ? 0 : getTokenValue('$4', 'space');

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" paddingVertical="$3" minHeight="$touchMin">
          {title ? (
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
              {title}
            </Text>
          ) : null}
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
          gap: getTokenValue(variant === 'ficha' ? '$4' : '$3', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {variant === 'animales' ? <AnimalesSkeletonVariant /> : null}
        {variant === 'home' ? <HomeSkeletonVariant /> : null}
        {variant === 'lotes' ? <LotesSkeletonVariant /> : null}
        {variant === 'reportes' ? <ReportesSkeletonVariant /> : null}
        {variant === 'ficha' ? <AnimalFichaSkeleton /> : null}
        {variant === 'rodeos' ? <RodeosSkeletonVariant /> : null}
        {variant === 'miembros' ? <MiembrosSkeletonVariant /> : null}
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

// Vista owner (la que más filas de acción muestra) — 3 cards de rodeo.
function RodeosSkeletonVariant() {
  return (
    <YStack width="100%" gap="$3" marginTop="$2">
      {Array.from({ length: 3 }).map((_, i) => (
        <RodeoCardSkeleton key={i} actions={3} />
      ))}
    </YStack>
  );
}

// Card única (padding 0, overflow hidden) con 4 filas SIN avatar, separadas por divider — espejo de la
// lista real de Miembros.
function MiembrosSkeletonVariant() {
  return (
    <Card padding="$0" gap="$0" overflow="hidden" marginTop="$2">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i}>
          {i > 0 ? <View height={1} backgroundColor="$divider" marginHorizontal="$4" /> : null}
          <MemberRowSkeleton />
        </View>
      ))}
    </Card>
  );
}
