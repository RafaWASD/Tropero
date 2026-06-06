// app/(tabs)/animales.tsx — pantalla "Animales" = puerta MANUAL de BUSCAR ANIMAL (spec 09 R1,
// AnimalsTabScreen). Feature CORE. La ruta vive en (tabs)/_layout.tsx.
//
// Criticidad manga 🔴 (NO negociable, design-review): BUSCAR ANIMAL se usa SÍ o SÍ en la
// manga. Buscador XL permanente, filas con target grande (≥72px), el identificador que el
// operario lee del animal POP-EA, legible a pleno sol, operable con una mano/guante.
//
// C2 (este incremento) reemplaza el MOCK del stub por DATOS REALES:
//   - Lista: fetchAnimals(establishmentId, filtros) scopeado por EstablishmentContext (R1.1).
//   - Búsqueda permanente con DEBOUNCE 250ms → searchAnimals (TAG/IDV exacto + visual fuzzy, R1.2/R5).
//   - Filtros reales (R1.5): rodeo (desde useRodeo), estado (active/sold/dead/transferred),
//     "sin caravana" (tag_electronic IS NULL).
//   - No-match (R1.4): CTA "Dar de alta este animal" → /crear-animal con el id precargado en el
//     campo apropiado (heurística R1.4 = classifyIdentifier, util pura).
//   - Tap en fila (R1.3): → ficha /animal/[id].
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id — viene del contexto activo.
// PowerSync (offline real) es C5; en C2 los services pegan a Supabase directo (swappables).
// Cero hardcode (ADR-023 §4): tokens; lo que cruza a API no-Tamagui se lee con getTokenValue.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform, Pressable, TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, Plus, Search } from 'lucide-react-native';

import { AnimalRow, Card, InfoNote, FormError } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import {
  fetchAnimals,
  searchAnimals,
  type AnimalListItem,
  type AnimalStatus,
} from '@/services/animals';
import type { Rodeo } from '@/services/rodeos';
import { classifyIdentifier, SEARCH_TERM_MAX_LENGTH } from '@/utils/animal-identifier';
import { buttonA11y } from '@/utils/a11y';

const SEARCH_DEBOUNCE_MS = 250; // R1.2

// Estados de animal para el filtro (R1.5). El default de la tab es 'active'.
const STATUS_OPTIONS: { value: AnimalStatus; label: string }[] = [
  { value: 'active', label: 'Activos' },
  { value: 'sold', label: 'Vendidos' },
  { value: 'dead', label: 'Muertos' },
  { value: 'transferred', label: 'Transferidos' },
];

// Sexo desde el list item (alimenta el glifo del AnimalRow). El AnimalRow ya tipa AnimalSex.
function rodeoCountOf(list: AnimalListItem[]): number {
  return new Set(list.map((a) => a.rodeoId)).size;
}

function formatThousands(n: number): string {
  return n.toLocaleString('es-AR');
}

// Copy contextual del empty-state cuando hay un filtro activo y 0 resultados (R1.5). Prioriza el
// filtro más específico para el mensaje: estado → sin caravana → rodeo. Voseo es-AR.
function filteredEmptyCopy(
  statusFilter: AnimalStatus,
  statusLabel: string,
  onlyNoTag: boolean,
  rodeoName: string | null,
): string {
  if (statusFilter !== 'active') {
    // "No hay animales vendidos." / "...muertos." / "...transferidos." (label ya en plural es-AR).
    return `No hay animales ${statusLabel.toLowerCase()}.`;
  }
  if (onlyNoTag) {
    return 'No hay animales sin caravana electrónica.';
  }
  if (rodeoName) {
    return `No hay animales en «${rodeoName}».`;
  }
  return 'No hay animales que coincidan con el filtro.';
}

export default function AnimalesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();

  const establishmentId = estState.status === 'active' ? estState.current.id : null;
  const rodeos: Rodeo[] = rodeoState.status === 'active' ? rodeoState.available : [];

  // Texto del buscador (R1.2). El debounce dispara la búsqueda real (no en cada keypress).
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Filtros (R1.5).
  const [rodeoFilter, setRodeoFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AnimalStatus>('active');
  const [onlyNoTag, setOnlyNoTag] = useState(false);
  const [rodeoPickerOpen, setRodeoPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);

  // Datos.
  const [list, setList] = useState<AnimalListItem[]>([]);
  const [searchResults, setSearchResults] = useState<AnimalListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard de secuencia: descarta resultados de cargas viejas (cambio rápido de filtro/query).
  const listSeq = useRef(0);
  const searchSeq = useRef(0);

  const isSearching = debouncedQuery.trim().length > 0;

  // ── Debounce del buscador (R1.2, 250ms). Dep primitiva (string) → sin loop. ──
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // ── Cargar la lista (R1.1) según filtros. Deps PRIMITIVAS (ids/strings/bools) — sin objetos. ──
  const loadList = useCallback(async () => {
    if (!establishmentId) {
      setList([]);
      return;
    }
    const seq = ++listSeq.current;
    setLoading(true);
    setError(null);
    const r = await fetchAnimals(establishmentId, {
      rodeoId: rodeoFilter,
      status: statusFilter,
      noTag: onlyNoTag,
    });
    if (seq !== listSeq.current) return; // cambió el filtro mientras cargaba: descartamos.
    setLoading(false);
    if (!r.ok) {
      setError(r.error.kind === 'network' ? 'Sin conexión: no pudimos cargar los animales.' : 'No pudimos cargar los animales.');
      setList([]);
      return;
    }
    setList(r.value);
  }, [establishmentId, rodeoFilter, statusFilter, onlyNoTag]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Recargar al re-enfocar la tab (volver de crear-animal / ficha) para reflejar altas/cambios.
  useFocusEffect(
    useCallback(() => {
      void loadList();
    }, [loadList]),
  );

  // ── Ejecutar la búsqueda real cuando cambia el query debounced (R1.2/R5). ──
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!establishmentId || q.length === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    (async () => {
      const r = await searchAnimals(establishmentId, q);
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (!r.ok) {
        setSearchResults([]);
        return;
      }
      setSearchResults(r.value);
    })();
  }, [establishmentId, debouncedQuery]);

  // Conteo del header (R1.1): sale de la lista cargada (no del mock).
  const totalCount = list.length;
  const rodeoCount = useMemo(() => rodeoCountOf(list), [list]);

  // Lo que se muestra: si hay query → resultados de búsqueda; si no → la lista filtrada.
  const visible = isSearching ? searchResults : list;
  const showNoMatch = isSearching && !searching && searchResults.length === 0;

  // ¿Hay algún filtro activo? (estado distinto del default 'active', rodeo elegido, o "sin caravana").
  // Distingue el empty-state "no hay resultados PARA ESTE FILTRO" del "el campo no tiene animales".
  const hasActiveFilter = statusFilter !== 'active' || rodeoFilter !== null || onlyNoTag;

  const listEmpty = !isSearching && !loading && list.length === 0 && !error;
  // Empty contextual del filtro: hay filtro activo y 0 resultados (el campo SÍ puede tener animales).
  const showFilteredEmpty = listEmpty && hasActiveFilter;
  // Empty real del establecimiento: 0 animales SIN ningún filtro.
  const showEmptyEstablishment = listEmpty && !hasActiveFilter;

  // No-match (R1.4): el CTA "Dar de alta" abre /crear-animal con el id precargado en el campo
  // apropiado (idv si parece numérico/estructurado, visual si texto libre). Heurística pura.
  const onCreateFromNoMatch = useCallback(() => {
    const q = debouncedQuery.trim();
    const kind = classifyIdentifier(q);
    router.push({
      pathname: '/crear-animal',
      params: kind === 'idv' ? { idv: q } : { visual: q },
    });
  }, [debouncedQuery, router]);

  // CTA del empty-state: alta en blanco (sin id precargado).
  const onCreateBlank = useCallback(() => {
    router.push('/crear-animal');
  }, [router]);

  // CTA del empty contextual: limpiar todos los filtros y volver a la vista por default.
  const onClearFilters = useCallback(() => {
    setStatusFilter('active');
    setRodeoFilter(null);
    setOnlyNoTag(false);
    setStatusPickerOpen(false);
    setRodeoPickerOpen(false);
  }, []);

  const onOpenAnimal = useCallback(
    (profileId: string) => {
      router.push({ pathname: '/animal/[id]', params: { id: profileId } });
    },
    [router],
  );

  const selectedRodeoName = rodeos.find((r) => r.id === rodeoFilter)?.name ?? null;
  const selectedStatusLabel = STATUS_OPTIONS.find((s) => s.value === statusFilter)?.label ?? 'Activos';

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header fijo: título + buscador permanente + chips de filtro. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <YStack width="100%" gap="$1" paddingVertical="$3">
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Animales
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            {loading
              ? 'Cargando…'
              : `${formatThousands(totalCount)} ${selectedStatusLabel.toLowerCase()} · ${rodeoCount} ${rodeoCount === 1 ? 'rodeo' : 'rodeos'}`}
          </Text>
        </YStack>

        {/* Buscador permanente (R1.2): XL por ser 🔴 manga-crítico. */}
        <YStack width="100%" paddingBottom="$3">
          <AnimalSearchBar value={query} onChangeText={setQuery} />
        </YStack>

        {/* Chips de filtro (R1.5): rodeo / estado / sin caravana. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: getTokenValue('$2', 'space'),
            paddingBottom: getTokenValue('$3', 'space'),
          }}
        >
          {rodeos.length >= 2 ? (
            <FilterChip
              label={selectedRodeoName ? `Rodeo: ${selectedRodeoName}` : 'Rodeo ▾'}
              selected={rodeoFilter !== null}
              accessibilityLabel="Filtrar por rodeo"
              onPress={() => {
                setStatusPickerOpen(false);
                setRodeoPickerOpen((v) => !v);
              }}
            />
          ) : null}
          <FilterChip
            label={statusFilter === 'active' ? 'Estado ▾' : `Estado: ${selectedStatusLabel}`}
            selected={statusFilter !== 'active'}
            accessibilityLabel="Filtrar por estado"
            onPress={() => {
              setRodeoPickerOpen(false);
              setStatusPickerOpen((v) => !v);
            }}
          />
          <FilterChip
            label="Sin caravana"
            selected={onlyNoTag}
            accessibilityLabel="Filtrar animales sin caravana electrónica"
            onPress={() => setOnlyNoTag((v) => !v)}
          />
        </ScrollView>

        {/* Popovers de filtro (rodeo / estado). */}
        {rodeoPickerOpen ? (
          <FilterPopover
            items={[{ id: null, label: 'Todos los rodeos' }, ...rodeos.map((r) => ({ id: r.id, label: r.name }))]}
            selectedId={rodeoFilter}
            onSelect={(id) => {
              setRodeoFilter(id);
              setRodeoPickerOpen(false);
            }}
          />
        ) : null}
        {statusPickerOpen ? (
          <FilterPopover
            items={STATUS_OPTIONS.map((s) => ({ id: s.value, label: s.label }))}
            selectedId={statusFilter}
            onSelect={(id) => {
              setStatusFilter((id as AnimalStatus) ?? 'active');
              setStatusPickerOpen(false);
            }}
          />
        ) : null}
      </YStack>

      {/* Lista / estados. */}
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
        {error ? (
          <YStack paddingHorizontal="$4" paddingTop="$4">
            <FormError message={error} />
          </YStack>
        ) : showFilteredEmpty ? (
          <FilteredEmptyState label={filteredEmptyCopy(statusFilter, selectedStatusLabel, onlyNoTag, selectedRodeoName)} onClear={onClearFilters} />
        ) : showEmptyEstablishment ? (
          <EmptyEstablishmentState onPress={onCreateBlank} />
        ) : showNoMatch ? (
          <NoMatchState query={debouncedQuery.trim()} onPress={onCreateFromNoMatch} />
        ) : (
          <YStack width="100%">
            {visible.map((animal) => (
              <AnimalRow
                key={animal.profileId}
                idv={animal.idv ?? undefined}
                visualId={animal.visualIdAlt ?? undefined}
                tagElectronic={animal.tagElectronic}
                category={animal.categoryName || animal.categoryCode}
                sex={animal.sex}
                rodeo={animal.rodeoName}
                onPress={() => onOpenAnimal(animal.profileId)}
              />
            ))}
          </YStack>
        )}
      </ScrollView>
    </YStack>
  );
}

// ─── Buscador permanente (R1.2) ────────────────────────────────────────────────────

function AnimalSearchBar({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (t: string) => void;
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
        placeholder="Buscar por caravana o número"
        placeholderTextColor={muted}
        accessibilityLabel="Buscar animal por caravana o número"
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={SEARCH_TERM_MAX_LENGTH}
        style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize }}
      />
    </XStack>
  );
}

// ─── Chip de filtro (R1.5) ────────────────────────────────────────────────────────

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
  // a11y por helper (web=ARIA, native=accessibility*) — NO accessibilityLabel crudo en Pressable
  // de RN-web (BUG del overlay que tapa la pantalla, lección C1).
  const a11y = buttonA11y(Platform.OS, { label: accessibilityLabel ?? label, selected });
  return (
    <Pressable onPress={onPress} {...a11y}>
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
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color={selected ? '$white' : '$textMuted'}>
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}

// ─── Popover de selección de filtro (rodeo / estado) ────────────────────────────────

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
  const checkSize = getTokenValue('$navIcon', 'size'); // 24: slot reservado en TODA fila
  return (
    <YStack paddingBottom="$3">
      <Card gap="$1" paddingVertical="$2">
        {items.map((item) => {
          const isSelected = item.id === selectedId;
          return (
          <Pressable
            key={item.id ?? '__all__'}
            onPress={() => onSelect(item.id)}
            {...buttonA11y(Platform.OS, { label: item.label, selected: isSelected })}
          >
            {/* Fila balanceada: label a la izquierda + slot de ancho FIJO para el ✓ a la derecha
                (visible solo si está seleccionado). El slot reservado en TODAS las filas garantiza
                que el ✓ no descentre el texto (FIX 3: el item seleccionado quedaba corrido). */}
            <XStack alignItems="center" gap="$2" minHeight="$chipMin" paddingHorizontal="$2" pressStyle={{ opacity: 0.6 }}>
              <Text
                flex={1}
                minWidth={0}
                numberOfLines={1}
                fontFamily="$body"
                fontSize="$4"
                fontWeight={isSelected ? '600' : '500'}
                color={isSelected ? '$primary' : '$textPrimary'}
              >
                {item.label}
              </Text>
              <View width={checkSize} alignItems="center" justifyContent="center" flexShrink={0}>
                {isSelected ? <Check size={20} color={primary} strokeWidth={2.5} /> : null}
              </View>
            </XStack>
          </Pressable>
          );
        })}
      </Card>
    </YStack>
  );
}

// ─── CTA primario (R1.4 / empty-state) ───────────────────────────────────────────────

function PrimaryCta({ label, onPress }: { label: string; onPress: () => void }) {
  const white = getTokenValue('$white', 'color');
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label })}>
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

// ─── Estado "sin match de búsqueda" (R1.4) ────────────────────────────────────────────

function NoMatchState({ query, onPress }: { query: string; onPress: () => void }) {
  return (
    <YStack width="100%" alignItems="center" gap="$4" marginTop="$8" paddingHorizontal="$4">
      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary" textAlign="center">
          No encontramos «{query}».
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" textAlign="center">
          ¿Es un animal nuevo? Cargalo en un toque.
        </Text>
      </YStack>
      <PrimaryCta label="Dar de alta este animal" onPress={onPress} />
    </YStack>
  );
}

// ─── Estado "filtro sin resultados" (R1.5: hay filtro activo + 0 resultados) ──────────

/**
 * Empty contextual del filtro: el campo PUEDE tener animales, pero ninguno coincide con el filtro
 * activo (ej. Estado=Vendidos). Distinto del empty del establecimiento ("todavía no cargaste").
 * CTA secundario para LIMPIAR el filtro (no para crear — el operario ya tiene animales).
 */
function FilteredEmptyState({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <YStack width="100%" alignItems="center" gap="$4" marginTop="$8" paddingHorizontal="$4">
      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary" textAlign="center">
          {label}
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" textAlign="center">
          Probá con otro filtro o limpialo para ver todos.
        </Text>
      </YStack>
      <SecondaryCta label="Limpiar filtro" onPress={onClear} />
    </YStack>
  );
}

// CTA secundario (outline verde) — para acciones no-primarias como "Limpiar filtro".
function SecondaryCta({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label })}>
      <XStack
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$surface"
        borderColor="$primary"
        borderWidth={1}
        borderRadius="$pill"
        paddingHorizontal="$6"
      >
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}

// ─── Estado "establecimiento vacío" (0 animales) ──────────────────────────────────────

function EmptyEstablishmentState({ onPress }: { onPress: () => void }) {
  return (
    <YStack width="100%" alignItems="center" gap="$4" marginTop="$8" paddingHorizontal="$4">
      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary" textAlign="center">
          Todavía no cargaste animales.
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" textAlign="center">
          Empezá dando de alta el primero. Después se suman solos con el bastón.
        </Text>
      </YStack>
      <PrimaryCta label="Dar de alta tu primer animal" onPress={onPress} />
    </YStack>
  );
}
