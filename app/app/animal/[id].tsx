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

import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Gauge,
  HeartCrack,
  Mars,
  Milk,
  Plus,
  Tag,
  Venus,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Button, Card, CategoryBadge, InfoNote, FormError, TimelineEvent } from '@/components';
import { fetchAnimalDetail, type AnimalDetail, type AnimalStatus } from '@/services/animals';
import { archivedBadgeLabel } from '@/services/exit-animal';
import { useAuth, useEstablishment } from '@/contexts';
import { fetchTimeline, fetchMother, type TimelineItem, type MotherLink } from '@/services/events';
import {
  deriveCurrentState,
  formatEventDate,
  hasAbortion,
  humanizePregnancyState,
  type CurrentState,
} from '@/utils/event-timeline';
import { formatConditionScore } from '@/utils/event-input';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

export default function AnimalDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : null;

  // Contexto de autorización para el gating del botón "Dar de baja" (C3.3, R4.14): el RPC enforça
  // server-side `has_role_in(est) AND (is_owner_of(est) OR created_by = auth.uid())`. El gating de
  // cliente es best-effort (el RPC es la barrera real), pero no mostramos el botón a quien no podría.
  const { state: authState } = useAuth();
  const { state: estState } = useEstablishment();
  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  const [detail, setDetail] = useState<AnimalDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  // Link a la madre (R14.7). null = no es ternero con parto registrado (o falló el fetch blando) → la
  // ficha NO muestra la card "Madre". El fetch es blando: si falla, la cabecera/timeline siguen vivos.
  const [mother, setMother] = useState<MotherLink | null>(null);
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
    // Detalle + timeline + madre en paralelo (R10/R14/R14.7): un solo loading para la ficha entera.
    // El timeline y la madre tienen su propio manejo blando (si fallan, la cabecera sigue).
    const [detailR, timelineR, motherR] = await Promise.all([
      fetchAnimalDetail(profileId),
      fetchTimeline(profileId),
      fetchMother(profileId),
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
    // Madre (R14.7): blando — un fallo (red) deja la card sin mostrar, no rompe la ficha. value puede
    // ser null (el animal no es un ternero con parto registrado) → tampoco se muestra la card.
    setMother(motherR.ok ? motherR.value : null);
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
    // Pasamos el SEXO del animal: el wizard oculta la sección "Reproductivo" (tacto/servicio/parto)
    // para machos — esos eventos son solo de hembras. detail.sex es 'male' | 'female'.
    //
    // Y pasamos si la hembra FIGURA PREÑADA en nuestros registros (deriveCurrentState del MISMO
    // timeline que ya alimenta la fila "Estado reproductivo"): el wizard usa esto para el AVISO SUAVE
    // al registrar un PARTO sobre una hembra que no figura preñada (no bloquea, solo confirma). Los
    // params de expo-router son strings → mandamos '1'/'0' y el wizard lo parsea. Si el timeline no
    // determina preñez (Sin registrar), pregnant=false → el wizard avisa (conservador).
    const pregnant = deriveCurrentState(timeline).pregnancy?.kind === 'pregnant';
    router.push({
      pathname: '/agregar-evento',
      params: {
        profileId: detail.profileId,
        establishmentId: detail.establishmentId,
        sex: detail.sex,
        pregnant: pregnant ? '1' : '0',
      },
    });
  }, [detail, timeline, router]);

  // Navegar a la ficha de la madre (R14.7). Tolerante a madre archivada (status ≠ active): la ficha
  // destino se carga igual (fetchAnimalDetail NO filtra por status), sin dead-end ni crash (R4.15).
  const goToMother = useCallback(() => {
    if (!mother) return;
    router.push({ pathname: '/animal/[id]', params: { id: mother.profileId } });
  }, [mother, router]);

  // Identificador HERO del animal (idv → visual → caravana → "Animal"): lo mismo que muestra el hero,
  // reusado para el resumen del sheet de baja. Memo: depende solo del detalle.
  const heroLabel = useMemo(
    () => detail?.idv ?? detail?.visualIdAlt ?? detail?.tagElectronic ?? 'Animal',
    [detail],
  );

  // ¿Mostramos "Dar de baja"? (C3.3, R4.14) Solo si:
  //   - el animal está ACTIVO (un archivado ya está de baja, no se vuelve a ofrecer), Y
  //   - el usuario es OWNER del campo del animal, O lo CARGÓ (detail.createdBy === userId).
  // Conservadurismo multi-tenant: el `role`/owner del contexto es del establishment ACTIVO. Si el
  // animal pertenece a OTRO campo (detail.establishmentId !== activo), el owner-flag del contexto NO
  // aplica a ese campo → en ese caso habilitamos SOLO por created_by === userId (el RPC re-valida con
  // has_role_in del campo del animal igual). Si coincide el campo activo, usamos estState.role.
  const canExit = useMemo(() => {
    if (!detail || detail.status !== 'active') return false;
    const isAuthor = userId != null && detail.createdBy != null && detail.createdBy === userId;
    const activeEstId = estState.status === 'active' ? estState.current.id : null;
    const animalInActiveEst = activeEstId != null && activeEstId === detail.establishmentId;
    const isOwnerOfActive = estState.status === 'active' && estState.role === 'owner';
    const isOwner = animalInActiveEst && isOwnerOfActive;
    return isAuthor || isOwner;
  }, [detail, userId, estState]);

  const goToBaja = useCallback(() => {
    if (!detail) return;
    router.push({
      pathname: '/animal/baja',
      params: { profileId: detail.profileId, hero: heroLabel },
    });
  }, [detail, heroLabel, router]);

  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Barra superior compacta: solo el back (el título es el HERO, abajo). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" paddingVertical="$3">
          {/* "Volver" ROBUSTO (backOr): si el stack está vacío (web-refresh / hot-reload / deep-link
              / cold-start directo en la ficha) router.back() fallaría y dejaría al usuario trabado →
              caemos a la lista de animales (de donde se llega a la ficha por tap, R1.3). */}
          <Pressable
            hitSlop={8}
            onPress={() => backOr(router, '/(tabs)/animales')}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
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
            <AnimalHero detail={detail} hadAbortion={hasAbortion(timeline)} />

            {/* Modo archivada (C3.3, R14.9): si el animal está de baja (status ≠ active), badge bajo el
                hero con el verbo + fecha de egreso ("Vendido el …"). Para un animal activo → null. */}
            <ArchivedBadge status={detail.status} exitDate={detail.exitDate} />

            {/* Link a la MADRE (R14.7): solo si el animal es un ternero con parto registrado. Tappable
                → ficha de la madre. Tolera madre archivada (status ≠ active): indicador + navega igual. */}
            {mother ? <MotherCard mother={mother} onPress={goToMother} /> : null}

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
            <CurrentStateSection timeline={timeline} sex={detail.sex} />

            {/* Historial real (C3.1): riel de eventos + CTA "Agregar evento". El CTA se OCULTA en modo
                archivada (C3.3): un animal dado de baja no recibe eventos nuevos en MVP. */}
            <HistorySection
              timeline={timeline}
              error={timelineError}
              onAddEvent={goToAddEvent}
              onRetry={() => void load()}
              archived={detail.status !== 'active'}
            />

            {/* "Dar de baja" (C3.3, R4.14): al FONDO de la ficha, discreto (terracota/outline), gated:
                solo activo + (owner del campo o autor del alta). El RPC es la barrera real (42501). */}
            {canExit ? <ExitButton onPress={goToBaja} /> : null}
          </>
        ) : null}
      </ScrollView>
    </YStack>
  );
}

// ─── Hero de identidad del animal ─────────────────────────────────────────────────────

/**
 * Hero header: el identificador HERO grande (idv → visual → caravana) + CategoryBadge (firma verde)
 * + (si tuvo aborto) el flag "Tuvo aborto" terracota + sexo con ícono en color + rodeo muted. Es la
 * "cara" de la ficha — da personalidad donde antes había un título negro pelado.
 */
function AnimalHero({ detail, hadAbortion }: { detail: AnimalDetail; hadAbortion: boolean }) {
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

      {/* Fila de chips de identidad: categoría (verde) · [flag aborto terracota] · sexo (ícono color)
          · rodeo. El flag "Tuvo aborto" (A2, marquita roja) va junto al CategoryBadge si hubo ≥1 aborto. */}
      <XStack width="100%" alignItems="center" gap="$2" flexWrap="wrap">
        <CategoryBadge label={categoryLabel} manual={detail.categoryOverride} size="md" />
        {hadAbortion ? <AbortionFlag /> : null}
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

// ─── Flag "Tuvo aborto" (A2, marquita roja — dominio Facundo §1) ──────────────────────
//
// Indicador chico TERRACOTA en el hero si el animal tuvo al menos un aborto (hasAbortion del timeline).
// Permanente: una vez que hubo un aborto, queda marcado (es historia, no estado que se limpie). Pill al
// lenguaje del CategoryBadge pero en terracota (señal médica/pérdida): como NO hay token terracota-claro
// en la paleta (igual que TimelineEvent), usamos $surface de fondo + borde y texto $terracota + el ícono
// HeartCrack. a11y por helper (View no mapea accessibilityLabel a aria-label en web → labelA11y). Cero
// hardcode: tokens + getTokenValue para el ícono lucide (cruza a API no-Tamagui).
function AbortionFlag() {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$pill"
      paddingHorizontal="$3"
      paddingVertical="$1"
      alignSelf="flex-start"
      {...labelA11y(Platform.OS, 'Tuvo aborto')}
    >
      <XStack alignItems="center" gap="$1">
        <HeartCrack size={14} color={terracota} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$terracota" numberOfLines={1}>
          Tuvo aborto
        </Text>
      </XStack>
    </View>
  );
}

// ─── Badge de modo archivada (C3.3, R14.9) ────────────────────────────────────────────
//
// Si el animal está de baja (status ≠ active), una fila bajo el hero con el ÍCono Archive + el verbo
// derivado de status+exit_date ("Vendido el {fecha}" / "Muerto el …" / "Transferido el …"). Para un
// animal activo, archivedBadgeLabel devuelve null → no se renderiza nada. La fecha puede ser null
// (datos viejos): el helper PURO ya evita el "null" literal (solo el verbo). Lenguaje terracota como
// AbortionFlag (señal de estado de salida): $surface de fondo + borde/texto/ícono $terracota (no hay
// token terracota-claro). a11y por helper (View no mapea accessibilityLabel a aria-label en web).
function ArchivedBadge({ status, exitDate }: { status: AnimalStatus; exitDate: string | null }) {
  const label = archivedBadgeLabel(status, exitDate);
  if (!label) return null;
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      alignSelf="flex-start"
      {...labelA11y(Platform.OS, label)}
    >
      <XStack alignItems="center" gap="$2">
        <Archive size={18} color={terracota} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota" numberOfLines={1}>
          {label}
        </Text>
      </XStack>
    </View>
  );
}

// ─── Card "Madre" (link a la ficha de la madre, R14.7) ────────────────────────────────

/**
 * Mapa status (≠ active) → label de archivada para el indicador (R14.7). El `exit_reason` detallado y
 * el "modo archivada" completo de la ficha son C3.3; acá solo NO hacemos dead-end e indicamos que la
 * madre no está activa. status 'active' → null (no se muestra indicador).
 */
function archivedLabel(status: AnimalStatus): string | null {
  switch (status) {
    case 'sold':
      return 'Vendida';
    case 'dead':
      return 'Muerta';
    case 'transferred':
      return 'Transferida';
    default:
      return null;
  }
}

/**
 * Card tappable "Madre" (R14.7): ícono Milk (firma RAFAQ verde) + label de la madre + su categoría;
 * si la madre está archivada (status ≠ active), un indicador chico ("Vendida"/"Muerta"/"Transferida").
 * Al tocar → ficha de la madre (tolerante a archivada, R4.15). a11y por helper (Pressable). Cero
 * hardcode (tokens). Mismo lenguaje visual que las TypeCard (borde, halo verde, chevron).
 */
function MotherCard({ mother, onPress }: { mother: MotherLink; onPress: () => void }) {
  const primary = getTokenValue('$primary', 'color');
  const faint = getTokenValue('$textFaint', 'color');
  const archived = archivedLabel(mother.status);
  // Subtítulo: categoría de la madre + (si archivada) el estado. Ej. "Vaca multípara · Vendida".
  const subtitleParts = [mother.categoryName, archived].filter(Boolean) as string[];
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : 'Madre';

  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `Ver la ficha de la madre: ${mother.label}` })}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor="$divider"
        backgroundColor="$white"
        paddingHorizontal="$4"
        paddingVertical="$3"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <View
          width="$icon"
          height="$icon"
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Milk size={22} color={primary} strokeWidth={2.5} />
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Madre
          </Text>
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
            {mother.label}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        </YStack>
        <ChevronRight size={22} color={faint} strokeWidth={2} />
      </XStack>
    </Pressable>
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
// C3.2a: la sección escala al ESTADO REPRODUCTIVO (preñez) — fila "Estado reproductivo" SOLO para
// hembras (la preñez no aplica a machos). `deriveCurrentState` es el punto de extensión (computa
// `pregnancy` del último evento determinante: tacto/birth/abortion). La transición de categoría
// (vaquillona → vaquillona_prenada) la hace el server y la refleja el CategoryBadge del hero; esta
// fila muestra el estado de preñez crudo del último tacto/parto/aborto. La observación libre NO va
// acá (solo timeline: no tiene "valor actual").
function CurrentStateSection({
  timeline,
  sex,
}: {
  timeline: TimelineItem[] | null;
  sex: 'male' | 'female';
}) {
  // `now` para el timestamp relativo de cada valor (un Date por render, determinístico acá).
  const now = new Date();
  const state: CurrentState = deriveCurrentState(timeline);

  const weightValue = state.weight
    ? `${formatKg(state.weight.kg)} kg · ${formatEventDate(state.weight.date, now, { dateOnly: true })}`
    : null;
  const scoreValue = state.conditionScore
    ? `${formatConditionScore(state.conditionScore.score)} / 5 · ${formatEventDate(state.conditionScore.date, now, { dateOnly: true })}`
    : null;

  // Estado reproductivo (solo hembras): texto del estado (humanizePregnancyState) + fecha del evento
  // determinante. Si no hay evento reproductivo que determine preñez → null → "Sin registrar".
  const pregnancyText = humanizePregnancyState(state.pregnancy);
  const pregnancyValue =
    pregnancyText && state.pregnancy
      ? `${pregnancyText} · ${formatEventDate(state.pregnancy.date, now, { dateOnly: true })}`
      : null;

  return (
    <DetailSection icon={Gauge} title="Estado actual">
      <CurrentStateRow label="Peso actual" value={weightValue} />
      <CurrentStateRow label="Condición corporal" value={scoreValue} />
      {sex === 'female' ? (
        <CurrentStateRow label="Estado reproductivo" value={pregnancyValue} />
      ) : null}
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
  archived,
}: {
  timeline: TimelineItem[] | null;
  error: string | null;
  onAddEvent: () => void;
  onRetry: () => void;
  /** Modo archivada (status ≠ active): oculta el CTA "Agregar evento" (C3.3). */
  archived: boolean;
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

      {/* CTA "Agregar evento" — oculto en modo archivada (un animal de baja no recibe eventos en MVP). */}
      {archived ? null : <AddEventButton onPress={onAddEvent} />}

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

// Botón "Dar de baja" DISCRETO al fondo de la ficha (C3.3): outline terracota (NO un primario que
// compita con "Agregar evento"). La baja es destructiva e infrecuente → fricción a propósito (Fitts
// inverso: hay que scrollear hasta el fondo). Solo navega al sheet de baja; la confirmación + el
// write viven en /animal/baja. a11y por helper (NUNCA accessibilityLabel crudo en el Pressable de
// RN-web). Cero hardcode: tokens + getTokenValue para el ícono lucide.
function ExitButton({ onPress }: { onPress: () => void }) {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <Pressable
      style={{ width: '100%' }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label: 'Dar de baja' })}
    >
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        borderRadius="$pill"
        backgroundColor="transparent"
        borderWidth={2}
        borderColor="$terracota"
        paddingHorizontal="$5"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <Archive size={18} color={terracota} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota">
          Dar de baja
        </Text>
      </XStack>
    </Pressable>
  );
}
