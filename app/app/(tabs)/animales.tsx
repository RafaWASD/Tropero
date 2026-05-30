// app/(tabs)/animales.tsx — pantalla "Animales" = puerta MANUAL de BUSCAR ANIMAL
// (spec 09 R1, AnimalsTabScreen). Feature CORE. La ruta ya vive en (tabs)/_layout.tsx.
//
// Criticidad manga 🔴 (NO negociable, design-review): BUSCAR ANIMAL se usa SÍ o SÍ en la
// manga. Estándar máximo — buscador XL permanente, filas con target grande (≥72px), el
// identificador que el operario lee del animal POP-EA, legible a pleno sol, operable con una
// mano/guante. Ante duda estética vs operabilidad, gana operabilidad.
//
// Composición top→bottom (R1.1..R1.5):
//   1. Header: título "Animales" + subtítulo de conteo ("N activos · M rodeos").
//   2. Buscador permanente (R1.2): pill XL, filtra el mock localmente (includes case-insensitive).
//   3. Chips de filtro (R1.5): Rodeo ▾ / Estado ▾ (stubs visuales) + "Sin caravana" (toggle real).
//   4. Lista de AnimalRow sobre ~12 mocks variados (más reciente primero).
//   5. Estados: sin match de búsqueda (CTA "Dar de alta este animal") + establecimiento vacío (flag).
//
// Esto es FRONTEND de design-track (ADR-023, mock data), igual régimen que la home y "Mis
// campos". El motor real (find-or-create, debounce, PowerSync, scoping por EstablishmentContext)
// es de la feature 09 backend → TODO. Nunca se hardcodea establishment_id (CLAUDE.md ppio 6).
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens; lo que cruza a una API
// no-Tamagui (style del TextInput, color de íconos lucide) se lee con getTokenValue.

import { useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, TextInput } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Plus, Search } from 'lucide-react-native';

import { AnimalRow, type AnimalRowProps } from '@/components';

// Flag de estado vacío: con true la pantalla renderiza el empty state "Dá de alta tu primer
// animal" (establecimiento sin animales). Default false (lista poblada). Es un conmutador de
// preview del diseño — en producción el estado sale del rollup del establecimiento activo.
const EMPTY_STATE = false;

// ─── Mock data (pantalla real) ────────────────────────────────────────────────
// ~12 animales variados que ejercitan los estados de AnimalRow: con/sin idv, con/sin
// visualId, con/sin tagElectronic, las 6 categorías de cría, ambos sexos, 3 rodeos. Orden:
// "más reciente primero" (se renderiza tal cual; el orden real vendrá del backend). Las
// stats son MOCK; en producción salen de animal_profiles del establishment activo (R1.1)
// scopeado por EstablishmentContext — NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6).
type MockAnimal = AnimalRowProps & { id: string };

const MOCK_ANIMALS: MockAnimal[] = [
  {
    id: 'a1',
    idv: 'ARG 0241 5567',
    visualId: '112',
    tagElectronic: '982 000123456789',
    category: 'Vaca',
    sex: 'female',
    rodeo: 'Rodeo General',
  },
  {
    id: 'a2',
    visualId: '88',
    tagElectronic: null, // sin caravana → chip neutro + gancho del filtro R1.5
    category: 'Vaquillona',
    sex: 'female',
    rodeo: 'Recría Norte',
  },
  {
    id: 'a3',
    idv: 'ARG 0241 5571',
    tagElectronic: '982 000123456790',
    category: 'Toro',
    sex: 'male',
    rodeo: 'Rodeo General',
  },
  {
    id: 'a4',
    idv: 'ARG 0241 5572',
    visualId: '205',
    tagElectronic: '982 000123456791',
    category: 'Ternero',
    sex: 'male',
    rodeo: 'Destete 2026',
  },
  {
    id: 'a5',
    visualId: 'R-14',
    tagElectronic: null, // sin caravana
    category: 'Ternera',
    sex: 'female',
    rodeo: 'Destete 2026',
  },
  {
    id: 'a6',
    idv: 'ARG 0241 5560',
    visualId: '47',
    tagElectronic: '982 000123456792',
    category: 'Vaca',
    sex: 'female',
    rodeo: 'Rodeo General',
  },
  {
    id: 'a7',
    idv: 'ARG 0241 5588',
    tagElectronic: '982 000123456793',
    category: 'Novillo',
    sex: 'male',
    rodeo: 'Recría Norte',
  },
  {
    id: 'a8',
    visualId: '301',
    tagElectronic: null, // sin caravana
    category: 'Vaquillona',
    sex: 'female',
    rodeo: 'Recría Norte',
  },
  {
    id: 'a9',
    idv: 'ARG 0241 5599',
    visualId: '12',
    tagElectronic: '982 000123456794',
    category: 'Vaca',
    sex: 'female',
    rodeo: 'Rodeo General',
  },
  {
    id: 'a10',
    idv: 'ARG 0241 5601',
    tagElectronic: '982 000123456795',
    category: 'Ternero',
    sex: 'male',
    rodeo: 'Destete 2026',
  },
  {
    id: 'a11',
    visualId: '76',
    tagElectronic: null, // sin caravana
    category: 'Ternera',
    sex: 'female',
    rodeo: 'Destete 2026',
  },
  {
    id: 'a12',
    idv: 'ARG 0241 5610',
    visualId: '159',
    tagElectronic: '982 000123456796',
    category: 'Novillo',
    sex: 'male',
    rodeo: 'Recría Norte',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Formato de miles con separador "." (es-AR): 1240 → "1.240".
function formatThousands(n: number): string {
  return n.toLocaleString('es-AR');
}

// Cantidad de rodeos distintos en el set (para el subtítulo de conteo del header).
function countRodeos(list: MockAnimal[]): number {
  return new Set(list.map((a) => a.rodeo)).size;
}

// Match simple de búsqueda (R1.2, versión preview): includes case-insensitive (es-AR) sobre
// idv / visualId / category. El motor real (match exacto TAG/IDV + fuzzy visual de R5 de spec
// 02, debounce 250ms, find-or-create) es TODO de la feature 09 backend.
function matchesQuery(a: MockAnimal, q: string): boolean {
  const haystack = [a.idv, a.visualId, a.category]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('es-AR');
  return haystack.includes(q);
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/**
 * Buscador permanente (R1.2). Más grande que el de "Mis campos" por ser 🔴 manga-crítico:
 * pill XL (alto $searchBarLg = 56), ícono Search, placeholder con los 3 identificadores. El
 * TextInput de RN cruza a una API no-Tamagui para sus estilos de texto/placeholder, así que
 * esos valores se leen con getTokenValue (siguen referenciando el token, ADR-023 §4).
 *
 * TODO(futuro): cuando aparezca una 2da pantalla con buscador idéntico, extraer un
 * `SearchField` compartido (hoy el de "Mis campos" y este son sub-componentes locales). No se
 * extrae todavía para no re-tocar mis-campos.tsx en este incremento.
 */
function AnimalSearchBar({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (t: string) => void;
}) {
  // Valores que cruzan al TextInput (API no-Tamagui): leídos del token, no hardcodeados.
  const muted = getTokenValue('$textMuted', 'color');
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const fontSize = getTokenValue('$inputText', 'size'); // 16 — body grande / inputs (= font $5)

  return (
    <XStack
      width="100%"
      // Buscador XL 🔴: alto ≥56px (touchMin) para tipear con una mano a pleno sol.
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
        placeholder="Buscar por caravana o número"
        placeholderTextColor={muted}
        accessibilityLabel="Buscar animal por caravana o número"
        autoCorrect={false}
        // Estilo del input: cruza a API no-Tamagui (RN TextInput), valores via token.
        style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize }}
      />
    </XStack>
  );
}

/**
 * Chip de filtro (R1.5). Seleccionado = $primary lleno + texto $white; sin seleccionar =
 * $surface + borde $divider + texto $textMuted. Alto ≥40px ($chipMin). El "▾" señala que el
 * filtro abre un selector (Rodeo/Estado son stubs visuales por ahora).
 */
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
    >
      <XStack
        alignItems="center"
        justifyContent="center"
        minHeight="$chipMin"
        paddingHorizontal="$4"
        borderRadius="$pill"
        backgroundColor={selected ? '$primary' : '$surface'}
        borderWidth={1}
        borderColor={selected ? '$primary' : '$divider'}
      >
        <Text
          fontFamily="$body"
          fontSize="$3"
          fontWeight="500"
          color={selected ? '$white' : '$textMuted'}
        >
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}

/**
 * CTA primario "Dar de alta este animal" del estado sin-match (R1.4): entrada del find-or-create.
 * Pill lleno $primary, alto ≥$touchMin, texto $white. onPress es TODO (la pantalla CREATE de
 * R4 todavía no existe).
 */
function PrimaryCta({ label, onPress }: { label: string; onPress?: () => void }) {
  const white = getTokenValue('$white', 'color');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        backgroundColor="$primary"
        borderRadius="$pill"
        paddingHorizontal="$4"
        pressStyle={{ backgroundColor: '$primaryPress' }}
      >
        <Plus size={20} color={white} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}

/**
 * Estado "sin match de búsqueda" (R1.4): query no vacío, 0 resultados. Card amable +
 * CTA "Dar de alta este animal" → entrada al find-or-create. Que se vea cuidado: es la
 * primera impresión del flujo de alta ("el mejor en el primer try").
 */
function NoMatchState({ query }: { query: string }) {
  return (
    <YStack
      width="100%"
      alignItems="center"
      gap="$4"
      marginTop="$8"
      paddingHorizontal="$4"
    >
      <YStack alignItems="center" gap="$2">
        <Text
          fontFamily="$body"
          fontSize="$6"
          fontWeight="600"
          color="$textPrimary"
          textAlign="center"
        >
          No encontramos «{query}».
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$4"
          fontWeight="400"
          color="$textMuted"
          textAlign="center"
        >
          ¿Es un animal nuevo? Cargalo en un toque.
        </Text>
      </YStack>
      {/* TODO(feature 09): abrir AnimalCreateScreen (R4) con el identificador tipeado
          precargado (idv si parece numérico/estructurado, visual_id_alt si es texto libre,
          heurística de R1.4). La pantalla CREATE todavía no existe. */}
      <PrimaryCta label="Dar de alta este animal" onPress={() => { /* TODO: CREATE (R4) */ }} />
    </YStack>
  );
}

/**
 * Estado "establecimiento vacío" (0 animales): empty state amable + CTA "Dar de alta tu
 * primer animal". Conmutable por el flag EMPTY_STATE para previsualizar el diseño.
 */
function EmptyEstablishmentState() {
  return (
    <YStack
      width="100%"
      alignItems="center"
      gap="$4"
      marginTop="$8"
      paddingHorizontal="$4"
    >
      <YStack alignItems="center" gap="$2">
        <Text
          fontFamily="$body"
          fontSize="$6"
          fontWeight="600"
          color="$textPrimary"
          textAlign="center"
        >
          Todavía no cargaste animales.
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$4"
          fontWeight="400"
          color="$textMuted"
          textAlign="center"
        >
          Empezá dando de alta el primero. Después se suman solos con el bastón.
        </Text>
      </YStack>
      {/* TODO(feature 09): abrir AnimalCreateScreen (R4) sin identificador precargado. */}
      <PrimaryCta label="Dar de alta tu primer animal" onPress={() => { /* TODO: CREATE (R4) */ }} />
    </YStack>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function AnimalesScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  // Filtro "sin caravana" (R1.5): toggle REAL sobre el mock (tagElectronic == null).
  const [onlyNoTag, setOnlyNoTag] = useState(false);

  // Conteo del header: sale del largo del mock (R1.1). En producción = rollup del establishment.
  const totalCount = MOCK_ANIMALS.length;
  const rodeoCount = useMemo(() => countRodeos(MOCK_ANIMALS), []);

  // Lista filtrada (preview): toggle "sin caravana" + match de búsqueda. El debounce 250ms y
  // el motor find-or-create real (R5 de spec 02) son TODO de la feature 09 backend.
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-AR');
    return MOCK_ANIMALS.filter((a) => {
      if (onlyNoTag && a.tagElectronic != null) return false;
      if (q.length > 0 && !matchesQuery(a, q)) return false;
      return true;
    });
  }, [query, onlyNoTag]);

  // Sin match de búsqueda: hay query tipeado pero 0 resultados (R1.4). El empty-state del
  // establecimiento (flag) tiene prioridad sobre esto.
  const isSearching = query.trim().length > 0;
  const showNoMatch = !EMPTY_STATE && isSearching && visible.length === 0;

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header fijo: safe-area arriba + título + buscador permanente + chips de filtro. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        {/* 1. Título + subtítulo de conteo. */}
        <YStack width="100%" gap="$1" paddingVertical="$3">
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            Animales
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            {EMPTY_STATE
              ? 'Sin animales todavía'
              : `${formatThousands(totalCount)} activos · ${rodeoCount} rodeos`}
          </Text>
        </YStack>

        {/* 2. Buscador permanente (R1.2): XL por ser 🔴 manga-crítico. */}
        <YStack width="100%" paddingBottom="$3">
          <AnimalSearchBar value={query} onChangeText={setQuery} />
        </YStack>

        {/* 3. Chips de filtro (R1.5): scroll horizontal. "Sin caravana" = toggle real;
            "Rodeo"/"Estado" = stubs visuales (abren selector cuando exista la feature 09). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: getTokenValue('$2', 'space'),
            paddingBottom: getTokenValue('$3', 'space'),
          }}
        >
          <FilterChip
            label="Rodeo ▾"
            accessibilityLabel="Filtrar por rodeo"
            onPress={() => { /* TODO(feature 09): selector de rodeo (R1.5). */ }}
          />
          <FilterChip
            label="Estado ▾"
            accessibilityLabel="Filtrar por estado"
            onPress={() => { /* TODO(feature 09): selector de estado active/sold/dead/transferred (R1.5). */ }}
          />
          <FilterChip
            label="Sin caravana"
            selected={onlyNoTag}
            accessibilityLabel="Filtrar animales sin caravana electrónica"
            onPress={() => setOnlyNoTag((v) => !v)}
          />
        </ScrollView>
      </YStack>

      {/* 4 + 5. Lista de animales / estados. */}
      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingBottom: getTokenValue('$8', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {EMPTY_STATE ? (
          // Establecimiento vacío (flag): empty state amable + CTA primario.
          <EmptyEstablishmentState />
        ) : showNoMatch ? (
          // Sin match de búsqueda (R1.4): CTA "Dar de alta este animal".
          <NoMatchState query={query.trim()} />
        ) : (
          // Lista poblada. El borde inferior de cada AnimalRow da el divider entre filas.
          <YStack width="100%">
            {visible.map((animal) => (
              <AnimalRow
                key={animal.id}
                idv={animal.idv}
                visualId={animal.visualId}
                tagElectronic={animal.tagElectronic}
                category={animal.category}
                sex={animal.sex}
                rodeo={animal.rodeo}
                photoUrl={animal.photoUrl}
                onPress={() => {
                  // TODO(feature 09): invocar find-or-create → abrir AnimalEditScreen (R5)
                  // con el animal_profile_id (R1.3). El routing real es de la feature 09.
                }}
              />
            ))}
          </YStack>
        )}
      </ScrollView>
    </YStack>
  );
}
