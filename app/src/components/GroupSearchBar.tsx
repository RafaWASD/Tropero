// GroupSearchBar — buscador FIJO + chips de categoría/sexo de la VISTA DE GRUPO (spec 10 delta «rodeo grande»,
// T-RG.23 / RG3.1, RG3.3, RG3.9, RG3.10, RG4.4). Vive ARRIBA de la FlatList (fuera del scroller virtualizado)
// → siempre alcanzable sin scrollear miles de filas.
//
// TAP NATIVO (RG3.10, CRÍTICO): cada control (buscador, chips, filas del popover) lleva `onPress` +
// `buttonA11y`/`labelA11y` en la MISMA pieza Tamagui que tiene el `pressStyle`, SIN un `<Pressable>` de RN
// envolviendo — en nativo new-arch un Pressable externo roba el responder y `onPress` no dispara (anda solo en
// web). Es el patrón EXACTO de `FilterChip`/`FilterPopover` de la tab Animales (`animales.tsx`) y de
// `GoogleSignInButton`; acá se CLONA (no se extrae) para NO tocar la tab Animales (RG7.1, tab intacta).
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR. Recorte de descendentes:
// lineHeight matching en los Text con numberOfLines.

import { Platform, TextInput } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, Search } from 'lucide-react-native';

import { Card } from './Card';
import type { AnimalSex } from './AnimalRow';
import { SEARCH_TERM_MAX_LENGTH } from '../utils/animal-identifier';
import { buttonA11y } from '../utils/a11y';

/** Una opción de categoría del chip (code presente en el grupo + su nombre legible). */
export type GroupCategoryChipOption = { code: string; name: string };

export type GroupSearchBarProps = {
  /** Texto del buscador (controlado). */
  query: string;
  onChangeQuery: (t: string) => void;
  /** Placeholder del buscador (voseo). Default acorde a la vista de grupo. */
  searchPlaceholder?: string;
  /** Chip de categoría: code activo (null = Todas) + selector. */
  categoryCode: string | null;
  onSelectCategory: (code: string | null) => void;
  /** Opciones del chip de categoría (categorías presentes en el grupo, RG3.9). */
  categoryOptions: GroupCategoryChipOption[];
  /** Chip de sexo: sexo activo (null = Todos) + selector. */
  sex: AnimalSex | null;
  onSelectSex: (s: AnimalSex | null) => void;
  /** ¿Ofrecer el chip de sexo? (solo si el grupo tiene ambos sexos, RG3.9). */
  sexFilterAvailable: boolean;
  /** Controla qué popover está abierto (levantado al padre para cerrarlo al mutar la lista, si hiciera falta). */
  openPicker: 'category' | 'sex' | null;
  onOpenPicker: (p: 'category' | 'sex' | null) => void;
};

const SEX_LABEL: Record<AnimalSex, string> = { male: 'Machos', female: 'Hembras' };

export function GroupSearchBar({
  query,
  onChangeQuery,
  searchPlaceholder = 'Buscar por caravana o número',
  categoryCode,
  onSelectCategory,
  categoryOptions,
  sex,
  onSelectSex,
  sexFilterAvailable,
  openPicker,
  onOpenPicker,
}: GroupSearchBarProps) {
  const selectedCategoryName = categoryOptions.find((c) => c.code === categoryCode)?.name ?? null;
  const hasCategoryChip = categoryOptions.length > 0;

  return (
    <YStack width="100%" paddingHorizontal="$4">
      {/* Buscador permanente (scopeado al grupo, RG3.1). */}
      <YStack width="100%" paddingBottom="$3">
        <GroupSearchInput value={query} onChangeText={onChangeQuery} placeholder={searchPlaceholder} />
      </YStack>

      {/* Chips de filtro (RG3.3): categoría (si hay opciones) + sexo (si ambos presentes, RG3.9). */}
      {hasCategoryChip || sexFilterAvailable ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: getTokenValue('$2', 'space'),
            paddingBottom: getTokenValue('$3', 'space'),
          }}
        >
          {hasCategoryChip ? (
            <FilterChip
              label={selectedCategoryName ? `Categoría: ${selectedCategoryName}` : 'Categoría ▾'}
              selected={categoryCode !== null}
              accessibilityLabel="Filtrar por categoría"
              onPress={() => onOpenPicker(openPicker === 'category' ? null : 'category')}
            />
          ) : null}
          {sexFilterAvailable ? (
            <FilterChip
              label={sex ? `Sexo: ${SEX_LABEL[sex]}` : 'Sexo ▾'}
              selected={sex !== null}
              accessibilityLabel="Filtrar por sexo"
              onPress={() => onOpenPicker(openPicker === 'sex' ? null : 'sex')}
            />
          ) : null}
        </ScrollView>
      ) : null}

      {/* Popovers de filtro. */}
      {openPicker === 'category' ? (
        <FilterPopover
          items={[{ id: null, label: 'Todas las categorías' }, ...categoryOptions.map((c) => ({ id: c.code, label: c.name }))]}
          selectedId={categoryCode}
          onSelect={(id) => {
            onSelectCategory(id);
            onOpenPicker(null);
          }}
        />
      ) : null}
      {openPicker === 'sex' ? (
        <FilterPopover
          items={[
            { id: null, label: 'Ambos sexos' },
            { id: 'male', label: SEX_LABEL.male },
            { id: 'female', label: SEX_LABEL.female },
          ]}
          selectedId={sex}
          onSelect={(id) => {
            onSelectSex((id as AnimalSex) ?? null);
            onOpenPicker(null);
          }}
        />
      ) : null}
    </YStack>
  );
}

// ─── Buscador (clon de AnimalSearchBar, RG3.1) ────────────────────────────────────────

function GroupSearchInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  const muted = getTokenValue('$textMuted', 'color');
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const fontSize = getTokenValue('$inputText', 'size'); // 16

  return (
    <XStack
      width="100%"
      minHeight="$searchBarLg"
      alignItems="center"
      gap="$3"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$4"
      paddingVertical="$2"
    >
      <Search size={22} color={muted} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={muted}
        accessibilityLabel="Buscar animal en el grupo por caravana o número"
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={SEARCH_TERM_MAX_LENGTH}
        style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize }}
      />
    </XStack>
  );
}

// ─── Chip de filtro (clon del de animales.tsx, tap nativo — RG3.10) ─────────────────────

function FilterChip({
  label,
  selected = false,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  selected?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  // a11y por helper (web=ARIA, native=accessibility*). onPress + a11y DIRECTO en el XStack (Tamagui) que
  // tiene el pressStyle: un <Pressable> de RN envolviéndolo NO dispara el tap en RN new-arch (RG3.10).
  const a11y = buttonA11y(Platform.OS, { label: accessibilityLabel ?? label, selected });
  return (
    <XStack
      alignItems="center"
      justifyContent="center"
      minHeight="$chipMin"
      paddingHorizontal="$4"
      borderRadius="$pill"
      backgroundColor={selected ? '$primary' : '$surface'}
      borderWidth={1}
      borderColor={selected ? '$primary' : '$divider'}
      pressStyle={{ opacity: 0.85 }}
      onPress={onPress}
      {...a11y}
    >
      <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color={selected ? '$white' : '$textMuted'}>
        {label}
      </Text>
    </XStack>
  );
}

// ─── Popover de selección de filtro (clon del de animales.tsx, tap nativo — RG3.10) ─────

function FilterPopover({
  items,
  selectedId,
  onSelect,
}: {
  items: { id: string | null; label: string }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const checkSize = getTokenValue('$navIcon', 'size'); // 24: slot fijo reservado en TODA fila
  return (
    <YStack paddingBottom="$3">
      <Card gap="$1" paddingVertical="$2">
        {items.map((item) => {
          const isSelected = item.id === selectedId;
          return (
            // onPress + a11y DIRECTO en el XStack con el pressStyle (patrón login): sin <Pressable> externo (RG3.10).
            <XStack
              key={item.id ?? '__all__'}
              alignItems="center"
              gap="$2"
              minHeight="$chipMin"
              paddingHorizontal="$2"
              pressStyle={{ opacity: 0.6 }}
              onPress={() => onSelect(item.id)}
              {...buttonA11y(Platform.OS, { label: item.label, selected: isSelected })}
            >
              <Text
                flex={1}
                minWidth={0}
                numberOfLines={1}
                fontFamily="$body"
                fontSize="$4"
                lineHeight="$4"
                fontWeight={isSelected ? '600' : '500'}
                color={isSelected ? '$primary' : '$textPrimary'}
              >
                {item.label}
              </Text>
              <View width={checkSize} alignItems="center" justifyContent="center" flexShrink={0}>
                {isSelected ? <Check size={20} color={primary} strokeWidth={2.5} /> : null}
              </View>
            </XStack>
          );
        })}
      </Card>
    </YStack>
  );
}
