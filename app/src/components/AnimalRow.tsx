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
//
// VARIANTE COMPACTA (spec 10 T-UI.3 / R11.9, R12.3): la misma fila, con `compact` activa una
// densidad menor (alto ≥56px = $touchMin, avatar 40px, subtítulo "categoría · edad" en vez del
// badge + rodeo) + un slot de CHECKBOX (selección masiva castrar/destetar) + el badge ⭐ "futuro
// torito" (solo positivo y oculto si la categoría ya es `toro`, R12.3). NO se redefine el componente:
// es la MISMA fila con props nuevas (la tab Animales y la lista de lote siguen con la fila grande por
// default). La edad la calcula el caller (formatAnimalAge desde animal_birth_date).

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, ChevronRight, Star, Tag } from 'lucide-react-native';

import { CategoryBadge } from './CategoryBadge';
import { labelA11y } from '../utils/a11y';
import { reproStatusLabel, type ReproStatus } from '../utils/repro-status';

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
  /** Nombre del rodeo al que pertenece. Default (no-compact): segunda línea muted. */
  rodeo: string;
  /**
   * Estado reproductivo VIGENTE single-slot (delta spec 02 aptitud, RAR.3) — chip ÚNICO en la vista NORMAL
   * (junto al badge de categoría). `{kind:'none'}` / ausente / macho-ternera → sin chip (RAR.3.2). Display-only,
   * no tappable (RAR.5.4). NO se muestra en la variante compacta (su subtítulo es "categoría · edad").
   */
  reproStatus?: ReproStatus;
  /** Foto del animal (JIT: casi siempre ausente en MVP → fallback avatar neutro). */
  photoUrl?: string;
  /** Toda la fila es tappable → abre EDIT (R1.3) o el flujo correspondiente. */
  onPress?: () => void;

  // ─── Variante COMPACTA (spec 10 T-UI.3 / R11.9) ───────────────────────────────────────
  /**
   * Densidad compacta (spec 10): fila ≥56px (vs ≥72px), subtítulo "categoría · edad" (en vez del
   * badge de categoría + rodeo), avatar más chico, SIN chip "sin caravana" ni chevron por default.
   * Es la fila de la pantalla de selección masiva (castrar/destetar) y de la lista de la vista de
   * grupo. Default: false (la tab Animales y la lista de lote siguen con la fila grande).
   */
  compact?: boolean;
  /**
   * Edad legible es-AR ("3 años" / "8 meses" / null). Solo en `compact`: se muestra como
   * "categoría · edad". null/undefined → solo la categoría. La calcula el caller (formatAnimalAge,
   * desde `animal_birth_date`, R11.9).
   */
  age?: string | null;
  /**
   * code de la categoría (ej. 'toro', 'ternero') — para la regla de display del badge ⭐ (R12.3):
   * el badge se OCULTA si la categoría ya es `toro` (el flag cumplió su ciclo). Solo se usa con
   * `futureBull`. Sin él, el ⭐ se muestra según `futureBull` sin la excepción del toro.
   */
  categoryCode?: string;
  /**
   * ⭐ futuro torito (animal_profiles.future_bull, R12.3). Muestra el badge SOLO cuando es positivo
   * (true) y la categoría NO es `toro`. false/undefined → sin badge. Display-only.
   */
  futureBull?: boolean;
  /**
   * RESALTADO de advertencia (spec 10 R11.6, solo `compact`): cuando un ⭐ futuro torito queda TILDADO en
   * la selección de castración, su fila se RESALTA en terracota (acento de "ojo con este") SIN modal —
   * la advertencia agregada va recién en el bottom-sheet. Acento = borde izquierdo terracota + fondo
   * $surface (mismo lenguaje terracota-signal del badge/AbortionFlag, sin token terracota-claro nuevo).
   * false/undefined → fila normal. La pantalla decide cuándo (futureBull && checked).
   */
  highlight?: boolean;

  // ─── Slot de checkbox (selección masiva futura — R11.9) ───────────────────────────────
  /**
   * Donde está presente, la fila lleva un CHECKBOX a la izquierda (selección masiva). undefined →
   * sin checkbox (fila de navegación normal). Cuando se define, el tap de la fila TOGGLEA la
   * selección (no navega) salvo que `onPress` también esté presente y se prefiera navegar.
   */
  checked?: boolean;
  /** Toggle del checkbox (selección masiva). Se llama al tocar la fila cuando `checked` está definido. */
  onToggle?: () => void;
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
 * ¿Mostrar el badge ⭐ "futuro torito"? (R12.3): SOLO cuando es positivo Y la categoría no es `toro`
 * (el flag cumplió su ciclo al llegar a toro). Helper exportado para testear la regla de display sin
 * montar el componente. `categoryCode` opcional: sin él no se aplica la excepción del toro.
 */
export function shouldShowFutureBullBadge(futureBull?: boolean, categoryCode?: string): boolean {
  if (futureBull !== true) return false;
  return categoryCode !== 'toro';
}

/**
 * Avatar del animal. Si hay `photoUrl` → foto (cover, mismo patrón backgroundImage que
 * EstablishmentCard). Si NO → fallback neutro: círculo $surface + borde $divider con el glifo de sexo
 * centrado en $textMuted. El sexo es el atributo más útil de un vistazo sin requerir color de estado
 * (recognition > recall, Nielsen #6). `compact` usa el avatar chico ($avatar=40 vs $icon=48).
 */
function AnimalAvatar({ sex, photoUrl, compact }: { sex: AnimalSex; photoUrl?: string; compact?: boolean }) {
  const size = getTokenValue(compact ? '$avatar' : '$icon', 'size'); // 40 / 48

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
 * Chip "Sin caravana" (gancho del filtro R1.5 + opciones A/B: asignar caravana a un animal cargado
 * solo con visual). Mismo patrón ícono + label que el FutureBullBadge, pero NEUTRO (estado "falta",
 * NO alerta): pill $surface + borde $divider + ícono/texto $textMuted (sin terracota ni verde). El
 * ícono `Tag` (lucide) comunica el CONCEPTO "caravana"; el label "Sin caravana" la ausencia — mismo
 * reparto ícono-concepto / texto-cualificador que el ⭐ del FutureBullBadge. Cero hardcode (ADR-023 §4).
 */
function NoTagChip() {
  const muted = getTokenValue('$textMuted', 'color');
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$2"
      paddingVertical="$1"
      flexShrink={0}
      {...labelA11y(Platform.OS, 'Sin caravana')}
    >
      <XStack alignItems="center" gap="$1">
        <Tag size={12} color={muted} strokeWidth={2} />
        <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color="$textMuted" numberOfLines={1}>
          Sin caravana
        </Text>
      </XStack>
    </View>
  );
}

/**
 * Badge ⭐ "Futuro torito" (spec 10 R12.3): pill terracota-outline (señal de "no castrar"). NO usa la
 * firma verde del CategoryBadge — es una marca de atención, no de identidad (mismo lenguaje que el
 * AbortionFlag de la ficha: $surface + borde/ícono/texto $terracota, no hay token terracota-claro). El
 * caller decide cuándo mostrarlo (shouldShowFutureBullBadge). Compacto: solo el ícono ⭐ + "Futuro torito".
 */
function FutureBullBadge() {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$pill"
      paddingHorizontal="$2"
      paddingVertical="$1"
      flexShrink={0}
      {...labelA11y(Platform.OS, 'Futuro torito')}
    >
      <XStack alignItems="center" gap="$1">
        <Star size={12} color={terracota} strokeWidth={2.5} fill={terracota} />
        <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$terracota" numberOfLines={1}>
          Futuro torito
        </Text>
      </XStack>
    </View>
  );
}

/**
 * Tier visual del chip de estado reproductivo (RAR.5.1, design §5) — 3 señales semánticas (Hick):
 *   - `good`    verde: Apta / Preñada → relleno $greenLight + texto $primary (firma RAFAQ, igual que CategoryBadge).
 *   - `attn`    ámbar: Diferida / Vacía → outline $amber sobre $surface (≈5:1 AA).
 *   - `neutral` neutro: Servida sin tacto / No apta / CUT / Sin evaluar → outline $divider, texto $textMuted
 *     (igual que NoTagChip). NO reusa $cutBg/$cutText (firma amarilla del badge de CATEGORÍA CUT — evita doble
 *     amarillo en la misma fila, design §5).
 */
type ReproChipTier = 'good' | 'attn' | 'neutral';

function reproChipTier(status: ReproStatus): ReproChipTier {
  switch (status.kind) {
    case 'pregnant':
      return 'good';
    case 'empty':
      return 'attn';
    case 'fitness':
      return status.fitness === 'apta' ? 'good' : status.fitness === 'diferida' ? 'attn' : 'neutral';
    // served_untested / cut / unknown → neutro (sin info / fuera del eje productivo).
    default:
      return 'neutral';
  }
}

/**
 * Chip ÚNICO de estado reproductivo (RAR.3/RAR.5): un `View` no tappable (RAR.5.4) con el label es-AR del
 * estado (RAR.3.4). El estado se comunica por TEXTO además del color (RAR.5.2, accesibilidad/daltonismo), con
 * `lineHeight` matcheado al `fontSize` (anti-recorte de descendentes, por convención). a11y por `labelA11y`
 * (RAR.5.3 — un `View` de Tamagui no mapea accessibilityLabel a aria-label en web). `none`/label null → null
 * (macho/ternera, RAR.3.2). Cero hardcode (ADR-023 §4): solo tokens.
 */
function ReproStatusChip({ status }: { status: ReproStatus }) {
  const label = reproStatusLabel(status);
  if (label === null) return null; // none → sin chip (macho/ternera)
  const tier = reproChipTier(status);
  // Tokens por tier (sin hardcode): good=relleno verde; attn=outline ámbar; neutral=outline neutro.
  const bg = tier === 'good' ? '$greenLight' : '$surface';
  const textColor = tier === 'good' ? '$primary' : tier === 'attn' ? '$amber' : '$textMuted';
  const borderColor = tier === 'attn' ? '$amber' : '$divider';
  const borderWidth = tier === 'good' ? 0 : 1;
  return (
    <View
      backgroundColor={bg}
      borderWidth={borderWidth}
      borderColor={borderColor}
      borderRadius="$pill"
      paddingHorizontal="$2"
      paddingVertical="$1"
      flexShrink={0}
      {...labelA11y(Platform.OS, `Estado reproductivo: ${label}`)}
    >
      <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color={textColor} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Checkbox cuadrado de la selección masiva (R11.9): $navIcon (24px) de caja, redondeo $4, borde
 * $divider; tildado → relleno $primary + check blanco. Decorativo (el toque lo maneja la fila entera);
 * el estado a11y (selected) lo emite el Pressable de la fila. Cero hardcode (tokens + getTokenValue
 * para el ícono lucide).
 */
function RowCheckbox({ checked }: { checked: boolean }) {
  const size = getTokenValue('$navIcon', 'size'); // 24
  const white = getTokenValue('$white', 'color');
  return (
    <View
      width={size}
      height={size}
      borderRadius="$4"
      borderWidth={2}
      borderColor={checked ? '$primary' : '$divider'}
      backgroundColor={checked ? '$primary' : 'transparent'}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
    >
      {checked ? <Check size={16} color={white} strokeWidth={3} /> : null}
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
  reproStatus,
  photoUrl,
  onPress,
  compact = false,
  age,
  categoryCode,
  futureBull,
  highlight = false,
  checked,
  onToggle,
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

  // ¿La fila lleva checkbox (selección masiva)? El tap TOGGLEA en vez de navegar.
  const hasCheckbox = checked != null;
  const showStar = shouldShowFutureBullBadge(futureBull, categoryCode);
  const handlePress = hasCheckbox ? onToggle : onPress;

  // a11y: categoría + identificador legible + rodeo/edad + (sin caravana / futuro torito si aplica).
  const a11ySuffix = compact
    ? `${age ? `, ${age}` : ''}${showStar ? ', futuro torito' : ''}`
    : `, ${rodeo}${hasTag ? '' : ', sin caravana'}`;
  const a11yLabel = `${category}, ${idv ?? visualId ?? 'sin identificador'}${a11ySuffix}`;

  const a11yProps = hasCheckbox
    ? { accessibilityRole: 'checkbox' as const, accessibilityState: { checked: checked ?? false } }
    : { accessibilityRole: 'button' as const };

  return (
    <Pressable accessibilityLabel={a11yLabel} onPress={handlePress} {...a11yProps}>
      <XStack
        width="100%"
        // Target manga-friendly (Fitts): ≥72px ($animalRow) normal / ≥56px ($touchMin) compacto —
        // ambos operables con guante (R11.9 exige ≥56px en la fila compacta de selección).
        minHeight={compact ? '$touchMin' : '$animalRow'}
        alignItems="center"
        gap="$3"
        paddingHorizontal="$4"
        paddingVertical="$2"
        // Resaltado de advertencia (R11.6, ⭐ tildado): fondo $surface + acento terracota a la izquierda.
        backgroundColor={highlight ? '$surface' : '$white'}
        borderLeftWidth={highlight ? 4 : 0}
        borderLeftColor={highlight ? '$terracota' : 'transparent'}
        // Divider entre filas (borde inferior) — da la separación de la lista sin gap.
        borderBottomWidth={1}
        borderBottomColor="$divider"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        {/* Checkbox de selección (solo cuando la fila lo lleva). Va primero (zona pulgar izquierda). */}
        {hasCheckbox ? <RowCheckbox checked={checked ?? false} /> : null}

        {/* Avatar (foto JIT o glifo de sexo neutro). Compacto → 40px. */}
        <AnimalAvatar sex={sex} photoUrl={photoUrl} compact={compact} />

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

          {compact ? (
            // Subtítulo COMPACTO (R11.9): "categoría · edad" en una línea muted + badge ⭐ inline.
            <XStack alignItems="center" gap="$2" minWidth={0}>
              <Text
                fontFamily="$body"
                fontSize="$3"
                fontWeight="500"
                color="$textMuted"
                numberOfLines={1}
                flexShrink={1}
                minWidth={0}
              >
                {age ? `${category} · ${age}` : category}
              </Text>
              {showStar ? <FutureBullBadge /> : null}
            </XStack>
          ) : (
            // Subtítulo NORMAL: badge de categoría con COLOR (firma verde RAFAQ; AMARILLA si es CUT, RCUT.6.2
            // — ruta preferida con `code`) + chip de estado reproductivo (RAR.3.1, hembras) + rodeo muted. El
            // rodeo (flexShrink) trunca primero si falta ancho; los dos chips quedan completos (flexShrink 0).
            <XStack alignItems="center" gap="$2" minWidth={0}>
              <CategoryBadge label={category} code={categoryCode} size="sm" />
              {reproStatus ? <ReproStatusChip status={reproStatus} /> : null}
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
          )}
        </YStack>

        {/* Derecha: en compacto sin checkbox no hay afford de navegación extra (la categoría · edad
            ya describe la fila); con checkbox el estado lo da el check. En la fila NORMAL: sin tag →
            chip neutro "sin caravana"; con tag → chevron (afford de "se abre"). */}
        {compact ? null : (
          <View flexShrink={0} alignItems="flex-end" justifyContent="center">
            {hasTag ? (
              <ChevronRight size={chevronSize} color={chevronColor} strokeWidth={2} />
            ) : (
              <NoTagChip />
            )}
          </View>
        )}
      </XStack>
    </Pressable>
  );
}
