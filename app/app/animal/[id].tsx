// app/animal/[id].tsx — ficha del animal con IDENTIDAD RAFAQ (spec 09 R5 versión C2 / spec 02 R14
// parcial). Fix-loop C2 FIX 1: era una lista label-valor pelada en negro (genérica); ahora tiene
// jerarquía y marca.
//
// Aterrizaje del find-or-create (match → EDIT, post-create → R4.7) y del tap en la lista (R1.3).
// Anatomía:
//   - HERO header (capa de identidad): el identificador visual/IDV grande (Inter 700) + CategoryBadge
//     (firma verde de RAFAQ) + sexo con ícono en color ($primary) + rodeo. "La ficha de ESTE animal".
//   - Secciones (Identificación · Datos del animal): cards bone ($surface) con header de sección
//     (ícono lucide chico $primary) + filas label/valor. Identificadores largos truncados (no wrap).
//   - "Historial de eventos": teaser cálido ($greenLight + reloj $primary), NO un cuadro gris muerto.
// Las zonas Timeline + Editar + Agregar evento son C3.
//
// Criticidad 🟡. Cero hardcode (ADR-023 §4): tokens + componentes; íconos lucide con getTokenValue.
// Voseo es-AR. a11y por helper (utils/a11y).

import { useCallback, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronLeft, ClipboardList, Clock, Mars, Tag, Venus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Card, CategoryBadge, InfoNote, FormError } from '@/components';
import { fetchAnimalDetail, type AnimalDetail } from '@/services/animals';
import { buttonA11y } from '@/utils/a11y';

export default function AnimalDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : null;

  const [detail, setDetail] = useState<AnimalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profileId) {
      setError('No se encontró el animal.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchAnimalDetail(profileId);
    setLoading(false);
    if (!r.ok) {
      setError(r.error.kind === 'network' ? 'Sin conexión: no pudimos cargar el animal.' : r.error.message);
      return;
    }
    setDetail(r.value);
  }, [profileId]);

  // Recargar al enfocar (volver de C3 cuando exista, o tras crear).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Barra superior compacta: solo el back (el título es el HERO, abajo). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => router.back()} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$1', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$4', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {loading ? (
          <InfoNote>Cargando ficha…</InfoNote>
        ) : error ? (
          <FormError message={error} />
        ) : detail ? (
          <>
            <AnimalHero detail={detail} />

            {/* Identificación: los 3 identificadores, truncados si son largos. */}
            <DetailSection icon={Tag} title="Identificación">
              <AttributeRow label="Caravana electrónica" value={detail.tagElectronic ?? '—'} />
              <AttributeRow label="Caravana / IDV" value={detail.idv ?? '—'} />
              <AttributeRow label="Identificación visual" value={detail.visualIdAlt ?? '—'} />
            </DetailSection>

            {/* Datos del animal. */}
            <DetailSection icon={ClipboardList} title="Datos del animal">
              <AttributeRow label="Sexo" value={detail.sex === 'male' ? 'Macho' : 'Hembra'} />
              <AttributeRow label="Nacimiento" value={detail.birthDate ?? '—'} />
              <AttributeRow label="Rodeo" value={detail.rodeoName || '—'} />
              <AttributeRow label="Lote" value={detail.managementGroupName ?? 'Sin lote'} />
              {detail.breed ? <AttributeRow label="Raza" value={detail.breed} /> : null}
              {detail.coatColor ? <AttributeRow label="Pelaje" value={detail.coatColor} /> : null}
            </DetailSection>

            {/* Teaser cálido del Historial — C3 (Próximamente). */}
            <TimelineTeaser />
          </>
        ) : null}
      </ScrollView>
    </YStack>
  );
}

// ─── Hero de identidad del animal ─────────────────────────────────────────────────────

/**
 * Hero header: el identificador HERO grande (idv → visual → caravana) + CategoryBadge (firma verde)
 * + sexo con ícono en color + rodeo muted. Es la "cara" de la ficha — da personalidad donde antes
 * había un título negro pelado.
 */
function AnimalHero({ detail }: { detail: AnimalDetail }) {
  const primary = getTokenValue('$primary', 'color');
  const hero = detail.idv ?? detail.visualIdAlt ?? detail.tagElectronic ?? 'Animal';
  const SexIcon = detail.sex === 'male' ? Mars : Venus;
  const sexLabel = detail.sex === 'male' ? 'Macho' : 'Hembra';
  const categoryLabel = detail.categoryName || detail.categoryCode;

  return (
    <YStack width="100%" gap="$3" paddingTop="$1">
      {/* Identificador hero: grande, bold, truncado a 1 línea (un IDV de 40 díg no wrappea).
          lineHeight="$9" (= fontSize "$9") para que el line-box no clipee el glifo arriba/abajo
          (mismo bug que el título "Equipo" de B.1.3, resuelto seteando lineHeight al fontSize). */}
      <Text
        fontFamily="$body"
        fontSize="$9"
        lineHeight="$9"
        fontWeight="700"
        color="$textPrimary"
        numberOfLines={1}
        minWidth={0}
      >
        {hero}
      </Text>

      {/* Fila de chips de identidad: categoría (verde) · sexo (ícono color) · rodeo. */}
      <XStack width="100%" alignItems="center" gap="$2" flexWrap="wrap">
        <CategoryBadge label={categoryLabel} manual={detail.categoryOverride} size="md" />
        <XStack alignItems="center" gap="$1" accessibilityLabel={`Sexo ${sexLabel}`}>
          <SexIcon size={18} color={primary} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
            {sexLabel}
          </Text>
        </XStack>
        {detail.rodeoName ? (
          <>
            <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textFaint">
              ·
            </Text>
            <Text
              fontFamily="$body"
              fontSize="$4"
              fontWeight="500"
              color="$textMuted"
              numberOfLines={1}
              flexShrink={1}
              minWidth={0}
            >
              {detail.rodeoName}
            </Text>
          </>
        ) : null}
      </XStack>
    </YStack>
  );
}

// ─── Sección de detalle (card bone con header de ícono $primary) ──────────────────────

/**
 * Card bone con un header de sección: ícono lucide chico en $primary dentro de un halo $greenLight
 * + título $6/600. Da calidez y jerarquía (no flat white). Reusable (base de la capa de identidad
 * que C3 va a reusar para la ficha completa).
 */
function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <Card gap="$3">
      <XStack alignItems="center" gap="$2">
        <View
          width={28}
          height={28}
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
        >
          <Icon size={16} color={primary} strokeWidth={2.5} />
        </View>
        <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
          {title}
        </Text>
      </XStack>
      <YStack gap="$3">{children}</YStack>
    </Card>
  );
}

// ─── Fila de atributo (label arriba muted, valor abajo, truncado) ─────────────────────

function AttributeRow({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$1">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      <Text
        fontFamily="$body"
        fontSize="$5"
        fontWeight="600"
        color="$textPrimary"
        numberOfLines={1}
        minWidth={0}
      >
        {value}
      </Text>
    </YStack>
  );
}

// ─── Teaser cálido del Historial — C3 (Próximamente) ──────────────────────────────────

/**
 * Teaser del historial de eventos: card $greenLight suave con un reloj $primary + copy cálido. NO un
 * cuadro gris muerto (el "Próximamente" plano anterior). Comunica valor por venir, con la marca.
 */
function TimelineTeaser() {
  const primary = getTokenValue('$primary', 'color');
  return (
    <YStack
      width="100%"
      backgroundColor="$greenLight"
      borderRadius="$card"
      padding="$4"
      gap="$2"
    >
      <XStack alignItems="center" gap="$2">
        <Clock size={20} color={primary} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
          Historial de eventos
        </Text>
      </XStack>
      <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$primary">
        Pronto vas a ver acá la cronología del animal —pesos, sanidad, reproducción— y vas a poder
        agregar eventos.
      </Text>
    </YStack>
  );
}
