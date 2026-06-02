// AnimalRow — fila de un animal en la lista de la tab "Animales" (spec 09 R1, puerta
// manual de BUSCAR ANIMAL). Patrón MP-Actividad (fila tappable alta, identificador hero
// que pop-ea) + slot de avatar estilo Cowgazer (glifo de sexo / foto JIT).
//
// Criticidad manga 🔴 (NO negociable): BUSCAR ANIMAL es feature CORE, se usa SÍ o SÍ en la
// manga. El identificador que el operario LEE del animal (caravana / IDV / visual) es el
// titular de la fila: pop-ea (bold, $6/18px, $textPrimary, alto contraste) porque es el dato
// por el que se toca la fila a pleno sol, con una mano/guante. Ante duda estética vs
// operabilidad, gana operabilidad: target grande (≥72px), texto grande, contraste AAA.
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens; lo que cruza a una API
// no-Tamagui (color del ícono lucide ChevronRight, URL de foto) se lee con getTokenValue o
// se justifica con design-lint-disable (solo para datos DINÁMICOS, ej. la URL de la foto).

import { Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { ChevronRight } from 'lucide-react-native';

import { CategoryBadge } from './CategoryBadge';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type AnimalSex = 'male' | 'female';
export type AnimalStatus = 'active' | 'sold' | 'dead' | 'transferred';

export type AnimalRowProps = {
  /** Caravana oficial / IDV (numérica/estructurada). Identificador primario si existe. */
  idv?: string;
  /** Número/texto visible pintado en el animal (`visual_id_alt`). */
  visualId?: string;
  /** Caravana electrónica. Si null/undefined → chip neutro "sin caravana" (gancho R1.5). */
  tagElectronic?: string | null;
  /** Categoría (texto, SIN color de estado): "Vaca" | "Vaquillona" | "Ternero"… */
  category: string;
  /** Sexo del animal: alimenta el glifo del avatar fallback (♀/♂). */
  sex: AnimalSex;
  /** Nombre del rodeo al que pertenece. */
  rodeo: string;
  /** Foto del animal (JIT: casi siempre ausente en MVP → fallback avatar neutro). */
  photoUrl?: string;
  /** Toda la fila es tappable → abre EDIT (R1.3) o el flujo correspondiente. */
  onPress?: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Glifo de sexo (U+2640 ♀ / U+2642 ♂) para el avatar fallback. El sexo es el atributo
// siempre-presente más útil de un vistazo y NO necesita paleta de color de estado (texto
// neutro $textMuted): recognition > recall (Nielsen #6). La foto lo reemplaza cuando exista.
const SEX_GLYPH: Record<AnimalSex, string> = {
  female: '♀', // ♀
  male: '♂', // ♂
};

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/**
 * Avatar del animal (48px, $icon). Si hay `photoUrl` → foto (cover, mismo patrón
 * backgroundImage que EstablishmentCard). Si NO → fallback neutro: círculo $surface + borde
 * $divider con el glifo de sexo centrado en $textMuted. El sexo es el atributo más útil de
 * un vistazo sin requerir color de estado (recognition > recall, Nielsen #6).
 */
function AnimalAvatar({ sex, photoUrl }: { sex: AnimalSex; photoUrl?: string }) {
  const size = getTokenValue('$icon', 'size'); // 48

  if (photoUrl) {
    return (
      <View
        width={size}
        height={size}
        borderRadius="$pill"
        overflow="hidden"
        backgroundColor="$divider"
        flexShrink={0}
      >
        <View
          width={size}
          height={size}
          // RN <Image> equivalente vía backgroundImage en web; en native se reemplaza por
          // <Image source>. Para el preview web alcanza con el background (mismo patrón que
          // el banner de EstablishmentCard).
          // design-lint-disable-next-line -- la URL de la foto del animal es dato dinámico, no un token
          style={{ backgroundImage: `url(${photoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      </View>
    );
  }

  return (
    <View
      width={size}
      height={size}
      borderRadius="$pill"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
    >
      {/* Glifo de sexo: neutro ($textMuted), grande para legibilidad a pleno sol. */}
      <Text fontFamily="$body" fontSize="$7" fontWeight="500" color="$textMuted">
        {SEX_GLYPH[sex]}
      </Text>
    </View>
  );
}

/**
 * Chip neutro outline "sin caravana": estado neutral (NO alarma de color), gancho del filtro
 * R1.5 y de las opciones A/B (asignar caravana a un animal cargado solo con visual). Mismo
 * lenguaje que el RoleBadge de EstablishmentCard: $surface + borde $divider + texto $textMuted.
 */
function NoTagChip() {
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$2"
      paddingVertical="$1"
      flexShrink={0}
    >
      <Text fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted">
        sin caravana
      </Text>
    </View>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AnimalRow({
  idv,
  visualId,
  tagElectronic,
  category,
  sex,
  rodeo,
  photoUrl,
  onPress,
}: AnimalRowProps) {
  // Color del ChevronRight (lucide, API no-Tamagui): leído del token, no hardcodeado.
  const chevronColor = getTokenValue('$textFaint', 'color');
  const chevronSize = getTokenValue('$navIcon', 'size'); // 24

  // Identificador HERO (el dato por el que el operario toca la fila): idv → visualId → "—".
  const hero = idv ?? visualId ?? '—'; // —
  // Si existen AMBOS, el hero es idv y el visualId va como secundario inline muted.
  const showSecondaryVisual = idv != null && visualId != null;

  // Estado de caravana electrónica: null/undefined → estado neutral "sin caravana".
  const hasTag = tagElectronic != null;

  // a11y: categoría + identificador legible + rodeo + (sin caravana si aplica).
  const a11yLabel = `${category}, ${idv ?? visualId ?? 'sin identificador'}, ${rodeo}${
    hasTag ? '' : ', sin caravana'
  }`;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11yLabel} onPress={onPress}>
      <XStack
        width="100%"
        // Target grande manga-friendly (Fitts): alto ≥72px ($animalRow), operable con guante.
        minHeight="$animalRow"
        alignItems="center"
        gap="$3"
        paddingHorizontal="$4"
        paddingVertical="$2"
        backgroundColor="$white"
        // Divider entre filas (borde inferior) — da la separación de la lista sin gap.
        borderBottomWidth={1}
        borderBottomColor="$divider"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        {/* Izquierda: avatar 48px (foto JIT o glifo de sexo neutro). */}
        <AnimalAvatar sex={sex} photoUrl={photoUrl} />

        {/* Centro (flex): hero + subtítulo. minWidth=0 para permitir truncado sin empujar. */}
        <YStack flex={1} minWidth={0} gap="$1">
          {/* Hero: identificador primario que POP-EA (bold, $6/18px, $textPrimary). Si hay
              ambos, el visualId va inline a la derecha como secundario muted. */}
          <XStack alignItems="baseline" gap="$2" minWidth={0}>
            <Text
              fontFamily="$body"
              fontSize="$6"
              fontWeight="700"
              color="$textPrimary"
              numberOfLines={1}
              flexShrink={1}
              minWidth={0}
            >
              {hero}
            </Text>
            {showSecondaryVisual ? (
              <Text
                fontFamily="$body"
                fontSize="$3"
                fontWeight="400"
                color="$textMuted"
                numberOfLines={1}
                flexShrink={1}
                minWidth={0}
              >
                {`· #${visualId}`}
              </Text>
            ) : null}
          </XStack>

          {/* Subtítulo: badge de categoría con COLOR (firma verde RAFAQ) + rodeo muted. Antes era
              "categoría · rodeo" en gris plano (genérico); el badge le da jerarquía e identidad. */}
          <XStack alignItems="center" gap="$2" minWidth={0}>
            <CategoryBadge label={category} size="sm" />
            <Text
              fontFamily="$body"
              fontSize="$3"
              fontWeight="400"
              color="$textMuted"
              numberOfLines={1}
              flexShrink={1}
              minWidth={0}
            >
              {rodeo}
            </Text>
          </XStack>
        </YStack>

        {/* Derecha: señal de estado. Sin tag → chip neutro "sin caravana"; con tag → chevron
            (afford de "se abre"). No encoge. */}
        <View flexShrink={0} alignItems="flex-end" justifyContent="center">
          {hasTag ? (
            <ChevronRight size={chevronSize} color={chevronColor} strokeWidth={2} />
          ) : (
            <NoTagChip />
          )}
        </View>
      </XStack>
    </Pressable>
  );
}
