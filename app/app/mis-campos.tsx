// app/mis-campos.tsx — pantalla "Mis campos" (spec 01 R6.6 + R6.6.1 + R6.5).
//
// Ruta standalone (fuera de (tabs)) que liste todos los establecimientos donde el
// usuario tiene user_roles.active = true. Al tocar una card se fija como campo activo
// (R6.3) y se navega a su home (R6.7) — el routing real es TODO (sub-tarea backend/
// contexto multi-tenant). Acá la pantalla REAL con MOCK DATA.
//
// Composición (R6.6 / R6.6.1):
//   1. Header: título "Mis campos" + CTA "Crear campo" (pill, arriba-derecha).
//   2. Orden (R6.6.1): campo activo o último visitado PRIMERO, resto alfabético por nombre.
//   3. Searchbar (R6.6.1): SOLO con > SEARCH_THRESHOLD (8) campos activos; sticky arriba;
//      filtra por nombre case-insensitive en vivo. Con ≤8 campos NO se renderiza.
//   4. CTA "pegar link de invitación" (R6.5/R6.6, "si corresponde"): ghost sutil, al final
//      de la lista. No compite con la lista ni con "Crear campo".
//   5. Estado del activo: la card del campo activo muestra "● activo" (lo hace el componente)
//      y queda primera por el orden.
//
// Las stats de cada card son MOCK (no hay rollup todavía). En producción el campo activo y
// el orden vienen de last_establishment_opened (R6.9) y del contexto multi-tenant; nunca se
// hardcodea establishment_id (CLAUDE.md ppio 6).
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens.

import { useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, TextInput } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Link2, Plus, Search } from 'lucide-react-native';

import {
  EstablishmentCard,
  type EstablishmentCardProps,
} from '@/components';

// Umbral de campos a partir del cual aparece el searchbar (R6.6.1: ">~8 campos").
// Heurística para el caso del veterinario (canal de adquisición), que puede acumular
// del orden de 20 campos; el dueño de pocos campos no ve el search bar.
const SEARCH_THRESHOLD = 8;

// ─── Mock data (pantalla real) ────────────────────────────────────────────────
// ~10 establecimientos con nombres variados (para verificar orden alfabético), roles
// mezclados y los 3 estados de métrica hero repartidos (preñez / cabezas / vacío→CTA) +
// alguno con ⚠. UNO marcado como activo (lastOpenedId) → queda primero por el orden.
// Las stats son MOCK; en producción vienen del rollup por establecimiento (ver backlog).
type MockEstablishment = EstablishmentCardProps & { id: string };

// El campo "activo o último visitado" (R6.6.1). En producción = last_establishment_opened
// (R6.9) leído del contexto multi-tenant; acá un mock fijo para verificar el orden.
const ACTIVE_ID = 'la-juanita';

const MOCK_ESTABLISHMENTS: MockEstablishment[] = [
  {
    id: 'la-juanita',
    name: 'La Juanita',
    role: 'owner',
    animalCount: 1240,
    rodeoCount: 3,
    // Con tacto reciente → % de preñez.
    heroMetric: { kind: 'pregnancy', percent: 92, period: "may'26" },
    attention: 'tacto pendiente',
  },
  {
    id: 'el-ombu',
    name: 'El Ombú',
    role: 'veterinarian',
    animalCount: 860,
    rodeoCount: 2,
    // Sin tacto pero con animales → cabezas + última maniobra.
    heroMetric: { kind: 'headcount', count: 860, lastManeuver: '12 may' },
  },
  {
    id: 'santa-rosa',
    name: 'Santa Rosa',
    role: 'owner',
    animalCount: 0,
    rodeoCount: 0,
    // Campo vacío (recién creado) → CTA "Configurá tu rodeo".
    heroMetric: { kind: 'empty' },
  },
  {
    id: 'don-alfredo',
    name: 'Don Alfredo',
    role: 'field_operator',
    animalCount: 2100,
    rodeoCount: 5,
    heroMetric: { kind: 'pregnancy', percent: 88, period: "abr'26" },
  },
  {
    id: 'las-acacias',
    name: 'Las Acacias',
    role: 'veterinarian',
    animalCount: 540,
    rodeoCount: 2,
    heroMetric: { kind: 'headcount', count: 540, lastManeuver: '03 may' },
    attention: 'datos sin sincronizar',
  },
  {
    id: 'bella-vista',
    name: 'Bella Vista',
    role: 'owner',
    animalCount: 1780,
    rodeoCount: 4,
    heroMetric: { kind: 'pregnancy', percent: 79, period: "abr'26" },
  },
  {
    id: 'el-triangulo',
    name: 'El Triángulo',
    role: 'field_operator',
    animalCount: 320,
    rodeoCount: 1,
    heroMetric: { kind: 'headcount', count: 320, lastManeuver: '28 abr' },
  },
  {
    id: 'la-esperanza',
    name: 'La Esperanza',
    role: 'veterinarian',
    animalCount: 0,
    rodeoCount: 0,
    // Otro campo vacío → CTA.
    heroMetric: { kind: 'empty' },
  },
  {
    id: 'monte-grande',
    name: 'Monte Grande',
    role: 'owner',
    animalCount: 2640,
    rodeoCount: 6,
    heroMetric: { kind: 'pregnancy', percent: 95, period: "may'26" },
  },
  {
    id: 'san-isidro',
    name: 'San Isidro',
    role: 'veterinarian',
    animalCount: 1120,
    rodeoCount: 3,
    heroMetric: { kind: 'headcount', count: 1120, lastManeuver: '19 may' },
  },
];

// ─── Orden (R6.6.1) ───────────────────────────────────────────────────────────
// Campo activo o último visitado PRIMERO; el resto alfabético por nombre (es-AR,
// case/acento-insensitive para que "Á" no quede separado de "A").
function sortEstablishments(
  list: MockEstablishment[],
  activeId: string
): MockEstablishment[] {
  const rest = list
    .filter((e) => e.id !== activeId)
    .sort((a, b) => a.name.localeCompare(b.name, 'es-AR', { sensitivity: 'base' }));
  const active = list.find((e) => e.id === activeId);
  return active ? [active, ...rest] : rest;
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/** Botón "Crear campo" del header (CTA secundario, pill outline). */
function CreateFieldButton() {
  const primary = getTokenValue('$primary', 'color');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Crear campo">
      <XStack
        alignItems="center"
        gap="$1"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$primary"
        borderRadius="$pill"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <Plus size={18} color={primary} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$primary">
          Crear campo
        </Text>
      </XStack>
    </Pressable>
  );
}

/**
 * Barra de búsqueda (R6.6.1). Filtra la lista por nombre, case-insensitive, en vivo.
 * Solo se monta cuando hay > SEARCH_THRESHOLD campos (el llamador decide). El TextInput
 * de RN cruza a una API no-Tamagui para sus estilos de texto/placeholder, así que esos
 * valores se leen con getTokenValue (siguen referenciando el token, ADR-023 §4).
 */
function SearchBar({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (t: string) => void;
}) {
  // Valores que cruzan al TextInput (API no-Tamagui): se leen del token, no se hardcodean.
  const muted = getTokenValue('$textMuted', 'color');
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const fontSize = getTokenValue('$inputText', 'size'); // 16 — body grande / inputs (= font $5)

  return (
    <XStack
      width="100%"
      alignItems="center"
      gap="$2"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$4"
      paddingVertical="$2"
    >
      <Search size={20} color={muted} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Buscar campo"
        placeholderTextColor={muted}
        accessibilityLabel="Buscar campo por nombre"
        autoCorrect={false}
        // Estilo del input: cruza a API no-Tamagui (RN TextInput), valores via token.
        style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize }}
      />
    </XStack>
  );
}

/**
 * CTA secundario y sutil "pegar link de invitación" (R6.5/R6.6, "si corresponde"). Ghost
 * (sin relleno, texto $textMuted + ícono), al final de la lista. No compite con "Crear
 * campo" ni con la lista. Es la red de seguridad cuando el deep link no autoabre la app.
 */
function PasteInviteLink() {
  const muted = getTokenValue('$textMuted', 'color');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="¿Te invitaron a un campo? Pegá el link de invitación"
    >
      <XStack
        width="100%"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        paddingVertical="$3"
      >
        <Link2 size={16} color={muted} strokeWidth={2} />
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          ¿Te invitaron a un campo? Pegá el link
        </Text>
      </XStack>
    </Pressable>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function MisCamposScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  // Orden estable (R6.6.1): activo primero, resto alfabético. Se calcula una vez.
  const ordered = useMemo(
    () => sortEstablishments(MOCK_ESTABLISHMENTS, ACTIVE_ID),
    []
  );

  // El searchbar SOLO aplica con > SEARCH_THRESHOLD campos (R6.6.1).
  const showSearch = ordered.length > SEARCH_THRESHOLD;

  // Filtro en vivo por nombre, case/acento-insensitive (es-AR). Si no hay search, la
  // lista es la ordenada completa.
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-AR');
    if (!showSearch || q.length === 0) return ordered;
    return ordered.filter((e) =>
      e.name.toLocaleLowerCase('es-AR').includes(q)
    );
  }, [ordered, query, showSearch]);

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header: safe-area arriba + título "Mis campos" + CTA "Crear campo". */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack
          width="100%"
          alignItems="center"
          justifyContent="space-between"
          paddingVertical="$3"
        >
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            Mis campos
          </Text>
          <CreateFieldButton />
        </XStack>

        {/* Searchbar STICKY (R6.6.1): vive en el header fijo (fuera del ScrollView), así
            queda arriba al scrollear la lista larga. Solo con >8 campos. */}
        {showSearch ? (
          <YStack width="100%" paddingBottom="$3">
            <SearchBar value={query} onChangeText={setQuery} />
          </YStack>
        ) : null}
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: getTokenValue('$8', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Lista de cards. gap entre cards via YStack. */}
        <YStack width="100%" gap="$4" marginTop="$2">
          {visible.map((est) => (
            <EstablishmentCard
              key={est.id}
              name={est.name}
              role={est.role}
              isActive={est.id === ACTIVE_ID}
              animalCount={est.animalCount}
              rodeoCount={est.rodeoCount}
              heroMetric={est.heroMetric}
              attention={est.attention}
              imageUrl={est.imageUrl}
              onPress={() => {
                // TODO: fijar establecimiento activo (R6.3) + navegar a su home (R6.7).
                // El routing real + persistencia de last_establishment_opened (R6.9) es
                // sub-tarea del contexto multi-tenant. Acá es preview, sin routing real.
              }}
            />
          ))}

          {/* Sin resultados de búsqueda → mensaje legible (solo con search activo). */}
          {showSearch && visible.length === 0 ? (
            <Text
              fontFamily="$body"
              fontSize="$4"
              fontWeight="400"
              color="$textMuted"
              textAlign="center"
              marginTop="$4"
            >
              No hay campos que coincidan con “{query.trim()}”.
            </Text>
          ) : null}
        </YStack>

        {/* CTA secundario "pegar link de invitación" (R6.5/R6.6), al FINAL de la lista,
            sutil. Se oculta mientras se busca (no aporta al triage de búsqueda). */}
        {query.trim().length === 0 ? (
          <YStack width="100%" marginTop="$4">
            <PasteInviteLink />
          </YStack>
        ) : null}
      </ScrollView>
    </YStack>
  );
}
