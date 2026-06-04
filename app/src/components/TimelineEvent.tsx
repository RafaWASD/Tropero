// TimelineEvent — una fila del RIEL de la cronología del animal (spec 02 C3.1, R10/R14.3 / ADR-023).
//
// El componente es el deliverable (ADR-023): reusable, exportado en components/index.ts. Lo consume
// la ficha (animal/[id].tsx) para cada TimelineItem del timeline.
//
// Anatomía (patrón feed/tracking, Jakob):
//   - GUTTER izquierdo ~28px: un NODO circular (halo $greenLight, ícono lucide $primary — la firma
//     RAFAQ de C2 DetailSection) + una LÍNEA conectora 1px $divider hacia el nodo siguiente (Gestalt
//     continuidad). El último item NO dibuja la línea de abajo.
//   - CONTENIDO derecha: título ($textPrimary 600) + detalle ($textMuted) + timestamp legible
//     ($textFaint). Textos largos truncados (numberOfLines) — lección del hero clip de C2.
//
// Acento de color SOLO de la paleta canónica (ADR-023 §4, PROHIBIDO inventar hex):
//   - la mayoría: ícono $primary sobre halo $greenLight.
//   - sanitario y BAJA: $terracota (señal médica/alerta) — node con halo neutro $surface + ícono
//     $terracota (no hay halo terracota-claro en la paleta; usamos $surface para no inventar token).
//   - category_change: hito → ícono $primary (tratado distinto vía el copy, no por color extra).
//
// Cero hardcode: tokens. Íconos lucide cruzan a API no-Tamagui (prop color/size) → getTokenValue.
// a11y: la fila es DISPLAY (no accionable en C3.1; editar es C3.3) → no Pressable, no a11y label
// crudo. El texto ya es legible por lectores de pantalla.

import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import {
  Activity,
  ArrowRightLeft,
  Baby,
  Flag,
  FlaskConical,
  HeartCrack,
  Scale,
  StickyNote,
  Syringe,
  Weight,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import {
  describeCategoryChange,
  formatEventDate,
  humanizePregnancyStatus,
  humanizeReproEventType,
  humanizeRoute,
  humanizeSampleType,
  humanizeSanitaryEventType,
  humanizeServiceType,
  isDateOnlyKind,
  type TimelineItem,
} from '../utils/event-timeline';
import { formatConditionScore } from '../utils/event-input';

// Tamaño del gutter del riel (ancho de la columna del nodo). Geometría libre (no token de spacing).
const GUTTER = 28;
const NODE = 28;
const ICON = 15;

export type TimelineEventProps = {
  item: TimelineItem;
  /** ¿Es el último de la lista? Si sí, NO se dibuja la línea conectora de abajo. */
  isLast: boolean;
  /** Ahora, para el timestamp relativo. Inyectado por el caller (un Date por render de la lista). */
  now: Date;
};

type Accent = 'primary' | 'terracota';

type Presentation = {
  icon: LucideIcon;
  accent: Accent;
  title: string;
  detail: string | null;
};

/** Deriva ícono + acento + título + detalle a partir del item (es-AR voseo). */
function present(item: TimelineItem): Presentation {
  switch (item.kind) {
    case 'weight':
      return {
        icon: Weight,
        accent: 'primary',
        title: 'Pesaje',
        detail: item.weightKg != null ? `${formatKg(item.weightKg)} kg` : (item.notes ?? null),
      };
    case 'condition_score':
      return {
        icon: Activity,
        accent: 'primary',
        title: 'Condición corporal',
        detail:
          item.score != null ? `${formatConditionScore(item.score)} / 5` : (item.notes ?? null),
      };
    case 'sanitary': {
      const parts = [item.productName, humanizeRoute(item.route)].filter(Boolean) as string[];
      return {
        icon: Syringe,
        accent: 'terracota', // señal médica/alerta
        title: humanizeSanitaryEventType(item.eventType),
        detail: parts.length > 0 ? parts.join(' · ') : (item.notes ?? null),
      };
    }
    case 'reproductive': {
      // El detalle muestra lo más informativo del evento: para tacto, el resultado de preñez; para
      // servicio, el tipo (monta/IA/TE); si no hay ninguno, las notas. Tacto positivo y servicio son
      // mutuamente excluyentes por event_type, así que no compiten.
      const preg = humanizePregnancyStatus(item.pregnancyStatus);
      const svc = humanizeServiceType(item.serviceType);
      // ABORTO = pérdida de la preñez (señal médica): acento $terracota + ícono HeartCrack (corazón
      // roto = pérdida), igual que los sanitarios. El resto del reproductivo (tacto/servicio/parto) usa
      // el $primary + Baby de siempre. El título lo da humanizeReproEventType ("Aborto"/"Tacto"/…).
      const isAbortion = item.eventType === 'abortion';
      return {
        icon: isAbortion ? HeartCrack : Baby,
        accent: isAbortion ? 'terracota' : 'primary',
        title: humanizeReproEventType(item.eventType),
        detail: preg ?? svc ?? (item.notes ?? null),
      };
    }
    case 'lab_sample': {
      const parts = [humanizeSampleType(item.sampleType), item.result].filter(Boolean) as string[];
      return {
        icon: FlaskConical,
        accent: 'primary',
        title: 'Muestra',
        detail: parts.length > 0 ? parts.join(' · ') : null,
      };
    }
    case 'category_change': {
      const d = describeCategoryChange(item);
      // El ALTA (reason 'initial') NO es una transición de ida-y-vuelta → Flag (hito de inicio).
      // Las transiciones reales (auto/manual/revert) sí usan ArrowRightLeft (⇄).
      const icon = item.reason === 'initial' ? Flag : ArrowRightLeft;
      return { icon, accent: 'primary', title: d.title, detail: d.detail };
    }
    case 'observacion':
      return {
        icon: StickyNote,
        accent: 'primary',
        title: 'Observación',
        detail: item.text ?? null,
      };
    default:
      // Exhaustividad defensiva (no debería ocurrir: la unión está cerrada).
      return { icon: Scale, accent: 'primary', title: 'Evento', detail: null };
  }
}

/** Formatea kg sin decimales innecesarios ("320.00" → "320", "320.50" → "320,5"). */
function formatKg(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export function TimelineEvent({ item, isLast, now }: TimelineEventProps) {
  const { icon: Icon, accent, title, detail } = present(item);
  const iconColor = getTokenValue(accent === 'terracota' ? '$terracota' : '$primary', 'color');
  const haloColor = accent === 'terracota' ? '$surface' : '$greenLight';
  // date-only (weight/condition_score/sanitary/lab_sample/reproductive) → fecha calendario sin hora;
  // instante real (observacion/category_change) → huso local con hora si es hoy. Ver isDateOnlyKind.
  const timestamp = formatEventDate(item.eventDate, now, { dateOnly: isDateOnlyKind(item.kind) });

  return (
    <XStack width="100%" gap="$3">
      {/* Gutter del riel: nodo + línea conectora. */}
      <YStack width={GUTTER} alignItems="center">
        <View
          width={NODE}
          height={NODE}
          borderRadius="$pill"
          backgroundColor={haloColor}
          alignItems="center"
          justifyContent="center"
        >
          <Icon size={ICON} color={iconColor} strokeWidth={2.5} />
        </View>
        {/* Línea conectora hacia el nodo siguiente (Gestalt continuidad). El último no la dibuja. */}
        {!isLast ? <View width={1} flex={1} backgroundColor="$divider" marginTop="$1" /> : null}
      </YStack>

      {/* Contenido: título + detalle + timestamp. Padding inferior para separar de la fila siguiente. */}
      <YStack flex={1} minWidth={0} gap="$1" paddingBottom={isLast ? '$1' : '$4'}>
        <Text
          fontFamily="$body"
          fontSize="$5"
          fontWeight="600"
          color="$textPrimary"
          numberOfLines={1}
        >
          {title}
        </Text>
        {detail ? (
          <Text
            fontFamily="$body"
            fontSize="$4"
            fontWeight="400"
            color="$textMuted"
            numberOfLines={3}
          >
            {detail}
          </Text>
        ) : null}
        {timestamp ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textFaint">
            {timestamp}
          </Text>
        ) : null}
      </YStack>
    </XStack>
  );
}
