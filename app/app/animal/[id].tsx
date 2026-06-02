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
import { ChevronLeft, ClipboardList, Clock, Gauge, Mars, Plus, Tag, Venus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Button, Card, CategoryBadge, InfoNote, FormError, TimelineEvent } from '@/components';
import { fetchAnimalDetail, type AnimalDetail } from '@/services/animals';
import { fetchTimeline, type TimelineItem } from '@/services/events';
import {
  deriveCurrentState,
  formatEventDate,
  type CurrentState,
} from '@/utils/event-timeline';
import { formatConditionScore } from '@/utils/event-input';
import { buttonA11y, labelA11y } from '@/utils/a11y';

export default function AnimalDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : null;

  const [detail, setDetail] = useState<AnimalDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
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
    setTimelineError(null);
    // Detalle + timeline en paralelo (R10/R14): un solo loading para la ficha entera. El timeline
    // tiene su propio error blando (si falla, la cabecera sigue mostrándose).
    const [detailR, timelineR] = await Promise.all([
      fetchAnimalDetail(profileId),
      fetchTimeline(profileId),
    ]);
    setLoading(false);
    if (!detailR.ok) {
      setError(
        detailR.error.kind === 'network'
          ? 'Sin conexión: no pudimos cargar el animal.'
          : detailR.error.message,
      );
      return;
    }
    setDetail(detailR.value);
    if (timelineR.ok) {
      setTimeline(timelineR.value);
    } else {
      setTimeline(null);
      setTimelineError(
        timelineR.error.kind === 'network'
          ? 'Sin conexión: no pudimos cargar el historial.'
          : 'No pudimos cargar el historial.',
      );
    }
  }, [profileId]);

  // Recargar al enfocar (volver de agregar-evento, o tras crear) → el timeline se refresca y el
  // evento nuevo aparece arriba sin parpadeo (un solo fetch al re-enfocar).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const goToAddEvent = useCallback(() => {
    if (!detail) return;
    router.push({
      pathname: '/agregar-evento',
      params: { profileId: detail.profileId, establishmentId: detail.establishmentId },
    });
  }, [detail, router]);

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

            {/* Estado actual (fix-loop 2 FIX C): el VALOR VIGENTE de cada medición tipada (peso /
                condición corporal) = el del último evento de ese tipo. Es un ATRIBUTO del animal,
                no solo historia. El timeline de abajo sigue siendo la auditoría completa. */}
            <CurrentStateSection timeline={timeline} />

            {/* Historial real (C3.1): riel de eventos + CTA "Agregar evento". */}
            <HistorySection
              timeline={timeline}
              error={timelineError}
              onAddEvent={goToAddEvent}
              onRetry={() => void load()}
            />
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
        <XStack alignItems="center" gap="$1" {...labelA11y(Platform.OS, `Sexo ${sexLabel}`)}>
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

// ─── Sección "Estado actual" (FIX C): valor vigente de cada medición tipada ───────────
//
// El peso/condición actuales son DATOS del animal (el del evento más reciente de cada tipo), no solo
// historia. Esta sección los muestra como atributos; el Historial de abajo es la auditoría completa.
// Se muestra SIEMPRE (enseña qué se trackea): si no hay evento de un tipo → "Sin registrar" (muted,
// consistente con los "—" del resto de la ficha).
//
// Arquitectura a futuro (C3.2): escala a estado reproductivo (preñez) y última sanidad cuando esos
// eventos se puedan cargar. `deriveCurrentState` es el punto de extensión (suma campos al CurrentState
// y acá se agregan filas). La observación libre NO va acá (solo timeline: no tiene "valor actual").
function CurrentStateSection({ timeline }: { timeline: TimelineItem[] | null }) {
  // `now` para el timestamp relativo de cada valor (un Date por render, determinístico acá).
  const now = new Date();
  const state: CurrentState = deriveCurrentState(timeline);

  const weightValue = state.weight
    ? `${formatKg(state.weight.kg)} kg · ${formatEventDate(state.weight.date, now, { dateOnly: true })}`
    : null;
  const scoreValue = state.conditionScore
    ? `${formatConditionScore(state.conditionScore.score)} / 5 · ${formatEventDate(state.conditionScore.date, now, { dateOnly: true })}`
    : null;

  return (
    <DetailSection icon={Gauge} title="Estado actual">
      <CurrentStateRow label="Peso actual" value={weightValue} />
      <CurrentStateRow label="Condición corporal" value={scoreValue} />
    </DetailSection>
  );
}

/**
 * Fila de "Estado actual": label muted arriba, valor abajo. Si no hay valor → "Sin registrar" muted
 * (mismo lenguaje que los "—" del resto de la ficha). El valor presente va con su timestamp embebido
 * (ej. "320 kg · Hoy"). Reusa el patrón de AttributeRow para coherencia visual.
 */
function CurrentStateRow({ label, value }: { label: string; value: string | null }) {
  return (
    <YStack gap="$1">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      {value ? (
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
      ) : (
        <Text fontFamily="$body" fontSize="$5" fontWeight="500" color="$textMuted">
          Sin registrar
        </Text>
      )}
    </YStack>
  );
}

/** Formatea kg sin decimales innecesarios ("320.00" → "320", "320.50" → "320,5"). Espeja el de
 * TimelineEvent (el riel y el estado actual muestran el peso igual). */
function formatKg(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

// ─── Sección Historial (C3.1): riel de eventos + CTA "Agregar evento" ─────────────────

/**
 * Historial de eventos del animal (R10/R14). Header "Historial" + botón primario "Agregar evento"
 * (zona pulgar, ≥$touchMin). Debajo, el riel de TimelineEvent. Estados:
 *   - error blando → FormError + reintentar (la cabecera de la ficha ya se mostró).
 *   - sparse/empty → si el único evento es el `initial` de categoría (o no hay ninguno), un empty
 *     cálido $greenLight invita a cargar el primer evento (el timeline NUNCA está 100% vacío:
 *     siempre hay al menos el `initial`, pero un animal recién creado "se siente" vacío).
 *   - con eventos → la lista, el más reciente arriba.
 */
function HistorySection({
  timeline,
  error,
  onAddEvent,
  onRetry,
}: {
  timeline: TimelineItem[] | null;
  error: string | null;
  onAddEvent: () => void;
  onRetry: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  // `now` se calcula UNA vez por render de la sección (no por fila) — determinístico dentro del render.
  const now = new Date();

  // "Sparse": no hay eventos, o el único que hay es el `initial` (el alta). El operario aún no
  // cargó nada propio → mostramos un empty cálido en vez de un riel de un solo nodo solitario.
  const isSparse =
    timeline != null &&
    (timeline.length === 0 ||
      (timeline.length === 1 &&
        timeline[0].kind === 'category_change' &&
        timeline[0].reason === 'initial'));

  return (
    <YStack width="100%" gap="$3">
      <XStack width="100%" alignItems="center" gap="$2">
        <View
          width={28}
          height={28}
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
        >
          <Clock size={16} color={primary} strokeWidth={2.5} />
        </View>
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
          Historial
        </Text>
      </XStack>

      <AddEventButton onPress={onAddEvent} />

      {error ? (
        <YStack gap="$2">
          <FormError message={error} />
          <Button variant="secondary" fullWidth onPress={onRetry}>
            Reintentar
          </Button>
        </YStack>
      ) : timeline == null ? (
        <InfoNote>Cargando el historial…</InfoNote>
      ) : isSparse ? (
        <YStack width="100%" backgroundColor="$greenLight" borderRadius="$card" padding="$4" gap="$2">
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
            Todavía no hay eventos
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$primary">
            Cargá el primer evento de este animal —un pesaje, su condición corporal o una
            observación— y va a aparecer acá arriba.
          </Text>
        </YStack>
      ) : (
        <Card gap="$1">
          {timeline.map((item, i) => (
            <TimelineEvent
              key={`${item.kind}-${item.eventId}`}
              item={item}
              isLast={i === timeline.length - 1}
              now={now}
            />
          ))}
        </Card>
      )}
    </YStack>
  );
}

// CTA primario "Agregar evento" con ícono lucide (el Button canónico solo acepta `children: string`,
// así que para el ícono + texto armamos el botón a mano replicando su forma con TOKENS — pill,
// $touchMin, $primary, texto blanco). a11y por helper (web=ARIA, native=accessibility*) — NUNCA
// accessibilityLabel crudo en el Pressable de RN-web (BUG del LogBox que tapa la pantalla, lección C1).
function AddEventButton({ onPress }: { onPress: () => void }) {
  const white = getTokenValue('$white', 'color');
  return (
    <Pressable
      style={{ width: '100%' }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label: 'Agregar evento' })}
    >
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        borderRadius="$pill"
        backgroundColor="$primary"
        paddingHorizontal="$5"
        pressStyle={{ backgroundColor: '$primaryPress' }}
      >
        <Plus size={20} color={white} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
          Agregar evento
        </Text>
      </XStack>
    </Pressable>
  );
}
