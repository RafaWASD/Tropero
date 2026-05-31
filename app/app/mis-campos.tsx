// app/mis-campos.tsx — pantalla "Mis campos" (spec 01 R6.6 + R6.6.1 + R6.5 + R6.7).
//
// Ruta standalone (fuera de (tabs)) que lista todos los establecimientos donde el usuario
// tiene user_roles.active = true (EstablishmentContext → recents/state.available). Al tocar
// una card se fija como campo activo (R6.3) y se navega a su home (R6.7). Es también el
// LANDING cuando el usuario tiene ≥2 campos (RootGate manda acá).
//
// B.1.2 (Fase 4): CABLEADA a datos reales — fuera el mock data. La lista, el orden y el
// campo activo vienen del EstablishmentContext; NUNCA se hardcodea establishment_id
// (CLAUDE.md ppio 6).
//
// Composición (R6.6 / R6.6.1):
//   1. Header: título "Mis campos" + CTA "Crear campo" (pill, arriba-derecha) → /crear-campo.
//   2. Orden (R6.6.1): campo activo o último visitado PRIMERO (last_establishment_opened,
//      R6.9), resto alfabético por nombre.
//   3. Searchbar (R6.6.1): SOLO con > SEARCH_THRESHOLD (8) campos activos; sticky arriba.
//   4. CTA "pegar link de invitación" (R6.5/R6.6): ghost sutil al final — STUB Fase 5.
//   5. La card del activo muestra "● activo".
//
// STATS DE LAS CARDS = BACKLOG: el rollup por establecimiento (animalCount / rodeoCount /
// métrica hero) NO existe todavía (design.md §"Nota de arquitectura"). NO inventamos
// números: pasamos estado neutro/honesto (0 contadores + heroMetric 'empty' → CTA
// "Configurá tu rodeo"). Cuando exista el rollup, la card lee los datos reales.
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens.

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, TextInput } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Link2, Plus, Search } from 'lucide-react-native';

import { EstablishmentCard } from '@/components';
import { useEstablishment } from '@/contexts';
import { sortMyEstablishments } from '@/utils/establishment';
import type { MembershipEstablishment } from '@/services/establishments';

// Umbral de campos a partir del cual aparece el searchbar (R6.6.1: ">~8 campos").
// Heurística para el caso del veterinario (canal de adquisición), que puede acumular
// del orden de 20 campos; el dueño de pocos campos no ve el search bar.
const SEARCH_THRESHOLD = 8;

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/** Botón "Crear campo" del header (CTA secundario, pill outline) → /crear-campo (R3.1). */
function CreateFieldButton({ onPress }: { onPress: () => void }) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Crear campo" onPress={onPress}>
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
  const muted = getTokenValue('$textMuted', 'color');
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const fontSize = getTokenValue('$inputText', 'size'); // 16

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
        style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize }}
      />
    </XStack>
  );
}

/**
 * CTA secundario y sutil "pegar link de invitación" (R6.5/R6.6, "si corresponde"). Ghost
 * (sin relleno), al final de la lista. STUB Fase 5 (B.1.3): el flujo de pegar/aceptar link
 * se construye en la Fase 5; acá solo informa al tocar.
 */
function PasteInviteLink({ onPress }: { onPress: () => void }) {
  const muted = getTokenValue('$textMuted', 'color');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="¿Te invitaron a un campo? Pegá el link de invitación"
      onPress={onPress}
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
  const router = useRouter();
  const { state, recents, switchEstablishment } = useEstablishment();
  const [query, setQuery] = useState('');
  const [showInviteStub, setShowInviteStub] = useState(false);

  // Campos disponibles + id del activo, según el estado del contexto. "Mis campos" se
  // muestra tanto como landing (choosing) como navegando desde la home (active).
  const { available, activeId } = useMemo(() => {
    if (state.status === 'active') {
      return { available: state.available, activeId: state.current.id };
    }
    if (state.status === 'choosing' || state.status === 'active_lost') {
      return { available: state.available, activeId: null as string | null };
    }
    return { available: [] as MembershipEstablishment[], activeId: null as string | null };
  }, [state]);

  // "Activo o último visitado" para el orden (R6.6.1): el activo si lo hay, si no el head
  // del rastro de visitados (recents[0]) — last_establishment_opened (R6.9).
  const headId = activeId ?? recents[0]?.id ?? null;

  // Orden estable (R6.6.1): activo/último primero, resto alfabético.
  const ordered = useMemo(
    () => sortMyEstablishments(available, headId),
    [available, headId],
  );

  // El searchbar SOLO aplica con > SEARCH_THRESHOLD campos (R6.6.1).
  const showSearch = ordered.length > SEARCH_THRESHOLD;

  // Filtro en vivo por nombre, case/acento-insensitive (es-AR).
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-AR');
    if (!showSearch || q.length === 0) return ordered;
    return ordered.filter((e) => e.name.toLocaleLowerCase('es-AR').includes(q));
  }, [ordered, query, showSearch]);

  async function onSelect(id: string) {
    // Fija el campo activo (R6.3) + cambia el contexto, luego navega a su home (R6.7).
    await switchEstablishment(id);
    router.replace('/(tabs)');
  }

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
          <CreateFieldButton onPress={() => router.push('/crear-campo')} />
        </XStack>

        {/* Searchbar STICKY (R6.6.1): fuera del ScrollView, queda arriba al scrollear. */}
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
        {/* Lista de cards. */}
        <YStack width="100%" gap="$4" marginTop="$2">
          {visible.map((est) => (
            <EstablishmentCard
              key={est.id}
              name={est.name}
              role={est.role}
              isActive={est.id === activeId}
              // STATS = BACKLOG (sin rollup): contadores en 0 + métrica hero 'empty' (CTA
              // "Configurá tu rodeo"). No inventamos números. Ver design.md §rollup.
              animalCount={0}
              rodeoCount={0}
              heroMetric={{ kind: 'empty' }}
              onPress={() => void onSelect(est.id)}
            />
          ))}

          {/* Sin campos (defensa): no debería pasar acá (0 campos → onboarding), pero si
              el filtro de búsqueda no matchea, mostramos un mensaje legible. */}
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

        {/* CTA secundario "pegar link de invitación" (R6.5/R6.6) — STUB Fase 5. Se oculta
            mientras se busca (no aporta al triage de búsqueda). */}
        {query.trim().length === 0 ? (
          <YStack width="100%" marginTop="$4" gap="$2">
            <PasteInviteLink onPress={() => setShowInviteStub(true)} />
            {showInviteStub ? (
              <Text
                fontFamily="$body"
                fontSize="$3"
                fontWeight="400"
                color="$textMuted"
                textAlign="center"
              >
                La aceptación de invitaciones por link llega muy pronto.
              </Text>
            ) : null}
          </YStack>
        ) : null}
      </ScrollView>
    </YStack>
  );
}
