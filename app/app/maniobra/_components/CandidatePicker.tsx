// app/maniobra/_components/CandidatePicker.tsx — PICKER de desambiguación manual (spec 03 M2.1-edge, R4.2).
//
// 🔴 PANTALLA DE MANGA (se usa con una mano, a pleno sol, con guantes/barro): cuando la búsqueda MANUAL
// por nombre/caravana devuelve >1 candidato (identificador duplicado), el operario elige el correcto de
// una lista de filas GRANDES tappables — NO se auto-elige el equivocado (M2.1-core dejaba el estado seguro
// `ambiguous`; esto le da la UI de selección).
//
// JERARQUÍA DE LA FILA (delta IDU — apodo reemplaza visual_id_alt):
//   - DOMINANTE: el nombre humano (apodo → idv), grande y bold — lo que el operario LEE en la oreja. Si no
//     hay ninguno, cae al tag electrónico formateado.
//   - SECUNDARIO DISTINTIVO: "rodeo · categoría" (lo que diferencia dos "0385": están en rodeos/categorías
//     distintos). Es el dato que DESAMBIGUA.
//   - CONFIRMACIÓN FINA: el tag electrónico muted (si lo tiene) — único global, la prueba definitiva.
//
// SALIDA find-or-create (R4.1): si NINGUNO es el correcto, "Ninguno · dar de alta" abre el alta con el
// texto buscado precargado (no frena la fila ni crea un duplicado).
//
// Modelado sobre el patrón as-built de bottom-sheet (ManeuverConfigSheet/BulkConfirmSheet): backdrop
// $scrim tappable que cierra + YStack anclado abajo con grip + safe-area inferior. Lista SCROLLABLE con
// el CTA "ninguno" PINNED fuera del scroll (Fitts: siempre alcanzable). Filas ≥$rowLg (manga). Cero
// hardcode (ADR-023 §4): tokens; lo que cruza a lucide vía getTokenValue. es-AR.
//
// RECORTE DE DESCENDENTES (memoria, regla dura): el título ("¿Cuál es?") + el dominante de cada fila
// ("0385j" hipotético) + el distinguidor ("Cría hembras · Vaquillona" trae j/g) llevan numberOfLines →
// lineHeight matching.

import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronRight } from 'lucide-react-native';

import { Button, CategoryBadge } from '@/components';
import { formatEidReadable } from '@/utils/eid-format';
import {
  candidateDistinguisher,
  candidateDominantId,
  type DisambiguationCandidate,
} from '@/utils/maniobra-edge';
import { buttonA11y } from '@/utils/a11y';

export type CandidatePickerProps = {
  /** El texto que el operario buscó (caravana visual duplicada) — para el subtítulo + el precargado del alta. */
  query: string;
  /** Los candidatos a desambiguar (>1). Vienen de searchAnimals, enriquecidos con lo que los distingue. */
  candidates: DisambiguationCandidate[];
  /** Elegir UN candidato → cargar sobre él (sigue el flujo normal → carga rápida). */
  onPick: (candidate: DisambiguationCandidate) => void;
  /** Ninguno es el correcto → find-or-create (alta) con el texto precargado (R4.1). */
  onCreateNew: () => void;
  /** Cerrar el picker (volver a escuchar/escanear) sin elegir. */
  onClose: () => void;
};

export function CandidatePicker({ query, candidates, onPick, onCreateNew, onClose }: CandidatePickerProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra (Pressable).
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable style={{ flex: 1, width: '100%' }} onPress={onClose} {...buttonA11y(Platform.OS, { label: 'Cerrar' })} />

      <YStack
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="candidate-picker"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Título + subtítulo: por qué hay que elegir. lineHeight matching (descendentes). El copy se adapta:
            - >1 candidato (caravana visual duplicada, R4.2): "Hay N animales… tocá el correcto".
            - 1 candidato NO-exacto (substring, fix "otra caravana"): no hay una caravana EXACTA con ese texto;
              el match es por aproximación → "No hay una caravana X exacta. ¿Es este?" → el operario confirma
              ANTES de cargar (no se auto-salta a la caravana equivocada) o da de alta el que buscaba. */}
        <YStack gap="$1">
          <Text fontFamily="$heading" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" numberOfLines={1}>
            ¿Cuál es?
          </Text>
          {candidates.length === 1 ? (
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" numberOfLines={3}>
              No hay ninguna caravana{' '}
              <Text fontWeight="700" color="$textPrimary">{query}</Text> exacta. ¿Querías este animal? Confirmá
              o dalo de alta.
            </Text>
          ) : (
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" numberOfLines={2}>
              Hay {candidates.length} animales con la caravana{' '}
              <Text fontWeight="700" color="$textPrimary">{query}</Text>. Tocá el correcto.
            </Text>
          )}
        </YStack>

        {/* Lista SCROLLABLE de candidatos (filas grandes ≥$rowLg). El CTA "ninguno" queda PINNED abajo. */}
        <ScrollView
          maxHeight={getTokenValue('$candidateListMax', 'size')}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          <YStack gap="$2">
            {candidates.map((c) => (
              <CandidateRow key={c.profileId} candidate={c} onPress={() => onPick(c)} />
            ))}
          </YStack>
        </ScrollView>

        {/* Salida find-or-create (R4.1): ninguno es el correcto → alta con el texto precargado. PINNED. */}
        <YStack gap="$3" alignItems="center">
          <Button variant="secondary" fullWidth onPress={onCreateNew}>
            Ninguno · dar de alta
          </Button>
          <Pressable onPress={onClose} {...buttonA11y(Platform.OS, { label: 'Volver al escaneo' })}>
            <View paddingHorizontal="$3" paddingVertical="$2">
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary">
                Volver
              </Text>
            </View>
          </Pressable>
        </YStack>
      </YStack>
    </View>
  );
}

// ─── Fila de un candidato (R4.2): caravana visual DOMINANTE + "rodeo · categoría" + tag muted ───
//
// Target ≥$rowLg (manga, una mano, Fitts). El chevron de afford de tap (patrón fila tappable Jakob) deja
// inequívoco que TOCAR carga sobre ese animal. flex={1} en el contenido + chevron de ancho fijo
// (flexShrink={0}) → el contenido no empuja ni recorta, y el Pressable entero queda tappable.
function CandidateRow({
  candidate,
  onPress,
}: {
  candidate: DisambiguationCandidate;
  onPress: () => void;
}) {
  // DOMINANTE: la caravana visual humana (visual > idv); si no hay ninguna, el tag electrónico formateado.
  const dominant = candidateDominantId(candidate);
  const heroText = dominant ?? (candidate.tagElectronic ? formatEidReadable(candidate.tagElectronic) : 'Sin identificación');
  // N° interno (idv) DESEMPATE: cuando el visual está duplicado (el caso R4.2), el idv es lo que distingue
  // dos animales que comparten caravana visual + rodeo + categoría. Solo se muestra si existe y no es ya el
  // dominante (si no hay visual, el idv ya subió a dominante → no lo repetimos).
  const tieBreakerIdv = candidate.idv && candidate.idv !== dominant ? candidate.idv : null;
  // CONFIRMACIÓN FINA: el tag electrónico muted, SOLO si la identidad dominante NO es ya el tag (si el
  // animal no tiene visual/idv, el tag ya subió a dominante → no lo repetimos abajo).
  const mutedTag = candidate.tagElectronic && dominant ? formatEidReadable(candidate.tagElectronic) : null;
  // a11y label (lee el desempate completo: dominante + N° interno + rodeo/categoría).
  const distinguisher = candidateDistinguisher(candidate);
  const chevronSize = getTokenValue('$navIcon', 'size');
  const chevronColor = getTokenValue('$textMuted', 'color');

  return (
    <Pressable
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label: `Elegir ${heroText}${distinguisher ? `, ${distinguisher}` : ''}` })}
    >
      <XStack
        minHeight="$searchBarLg"
        alignItems="center"
        gap="$3"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$divider"
        borderRadius="$card"
        paddingHorizontal="$4"
        paddingVertical="$3"
        pressStyle={{ backgroundColor: '$greenLight' }}
      >
        <YStack flex={1} gap="$2" minWidth={0}>
          {/* Caravana visual dominante (grande, bold) + N° interno DESEMPATE a la derecha (R4.2: cuando el
              visual está duplicado, el idv es lo que distingue). lineHeight matching. */}
          <XStack alignItems="baseline" justifyContent="space-between" gap="$2">
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1} letterSpacing={dominant ? 0 : 1} flexShrink={1}>
              {heroText}
            </Text>
            {tieBreakerIdv ? (
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$primary" numberOfLines={1} flexShrink={0}>
                N° {tieBreakerIdv}
              </Text>
            ) : null}
          </XStack>
          {/* Distinguidor: categoría + rodeo (lo que desambigua junto con el N°). */}
          {candidate.rodeoName || candidate.categoryName ? (
            <XStack flexWrap="wrap" alignItems="center" gap="$2">
              <CategoryBadge label={candidate.categoryName} size="sm" />
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1}>
                {candidate.rodeoName}
              </Text>
            </XStack>
          ) : null}
          {/* Tag electrónico muted (confirmación fina, único global). */}
          {mutedTag ? (
            <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="500" color="$textFaint" numberOfLines={1} letterSpacing={1}>
              {mutedTag}
            </Text>
          ) : null}
        </YStack>
        <View flexShrink={0} alignSelf="center">
          <ChevronRight size={chevronSize} color={chevronColor} strokeWidth={2} />
        </View>
      </XStack>
    </Pressable>
  );
}
