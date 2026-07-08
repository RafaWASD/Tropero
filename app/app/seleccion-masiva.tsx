// app/seleccion-masiva.tsx — pantalla de SELECCIÓN EXPLÍCITA de castrar / destetar (spec 10, T-UI.4 +
// T-UI.5 / R11.1, R11.5, R11.6, R11.7, R11.8, R11.9, R5.6). 🔴 MANGA-CRÍTICA: se usa en el corral,
// targets XL, una decisión clara, operable con el pulgar/guante, legible a pleno sol.
//
// Flujo (interacción LOCKEADA por Gate 0 v2 — design §3.2, NO se re-decide):
//   - Recibe por params la operación (castrate|wean) + el grupo (rodeo|lote + id).
//   - Arma candidatos (buildBulkCandidates) + selección (buildBulkSelectionState) sobre los perfiles del
//     grupo (fetchGroupSelectionProfiles, SQLite local — offline-first).
//   - Render: secciones por categoría (AnimalRow compacto + checkbox), defaults pre-tildados (R11.3/R11.4),
//     "todos/ninguno" por sección, contador vivo en header (R11.5), orden por ID (R11.9), búsqueda solo si
//     >~20 (R11.9), ⭐ resaltado terracota cuando tildado (solo castración, SIN modal — R11.6), CTA fijo
//     abajo con número vivo (disabled en 0 — R11.7), empty state.
//   - Tap CTA → bottom-sheet de confirmación (BulkConfirmSheet): desglose + ⚠ futuros toritos + aviso de
//     override con revertir (R5.6) + copy REVERSIBLE (R11.8). CONFIRMAR → bulk-operations encola las N
//     mutaciones → panel de progreso (BulkProgressPanel).
//
// Toda la lógica/services ya existen (Fase 2+3) — se REUSAN (cero re-implementación). La AUTORIZACIÓN es
// server-side (RLS re-valida cada mutación al subir, design §5); el gating de display NO es el control.
// `author_id` NUNCA en el payload de la observación (lo fuerza el server). Cero hardcode (ADR-023 §4):
// tokens; íconos lucide con getTokenValue. Voseo es-AR.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, XStack, YStack } from 'tamagui';
import { ChevronLeft, Search } from 'lucide-react-native';

import {
  AnimalRow,
  BulkConfirmSheet,
  BulkProgressPanel,
  Button,
  Card,
  FormError,
  InfoNote,
  type BulkProgressPhase,
  type BulkProgressRejection,
} from '@/components';
import { useEstablishment } from '@/contexts';
import {
  fetchGroupSelectionProfiles,
  type GroupSelectionProfile,
} from '@/services/bulk-selection-data';
import {
  applyBulkCastration,
  applyBulkWeaning,
} from '@/services/bulk-operations';
import { fetchRodeoConfigGating } from '@/services/group-data';
import { revertCategoryOverride } from '@/services/animals';
import { buildBulkCandidates, type BulkOperation } from '@/utils/bulk-candidates';
import {
  buildBulkSelectionState,
  clearOverridesInSelection,
  sectionCheckState,
  selectedCount,
  summarizeSelection,
  toggleProfile,
  toggleSection,
  type BulkSelectionState,
  type SelectionSection,
} from '@/utils/bulk-selection';
import {
  filterBySearch,
  pluralCategoryLabel,
  shouldShowSearch,
  sortByIdentifier,
} from '@/utils/selection-display';
import { formatAnimalAge } from '@/utils/animal-age';
import { backOr } from '@/utils/nav';
import { buttonA11y } from '@/utils/a11y';

// today() ISO para la fecha de la operación (destete). Local, no hardcodeado.
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resuelve la operación de los params. Default defensivo a castración (la única siempre disponible). */
function parseOperation(raw: string | undefined): BulkOperation {
  return raw === 'wean' ? 'wean' : 'castrate';
}

export default function SeleccionMasivaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupType?: string; groupId?: string; op?: string }>();
  const operation = parseOperation(params.op);
  const groupType = params.groupType === 'lote' ? 'lote' : 'rodeo';
  const groupId = typeof params.groupId === 'string' ? params.groupId : null;

  const { state: estState } = useEstablishment();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const muted = getTokenValue('$textMuted', 'color');

  // ── Estado de carga + selección ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionState, setSelectionState] = useState<BulkSelectionState | null>(null);
  const [candidates, setCandidates] = useState<GroupSelectionProfile[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  // Destete cross-rodeo (R7.2): terneros excluidos de la lista por tener su rodeo sin `destete` habilitado.
  const [excludedByRodeoConfig, setExcludedByRodeoConfig] = useState(0);

  // ── Estado del sheet + del aplicado ──────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [revertingOverride, setRevertingOverride] = useState(false);
  const [applyPhase, setApplyPhase] = useState<BulkProgressPhase | null>(null);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [rejections, setRejections] = useState<BulkProgressRejection[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Mapa profileId → candidato (para el resaltado ⭐ y las etiquetas legibles del rechazo).
  const candidateById = useMemo(() => {
    const m = new Map<string, GroupSelectionProfile>();
    for (const c of candidates) m.set(c.profileId, c);
    return m;
  }, [candidates]);

  // Carga: perfiles del grupo → candidatos → estado de selección con sus defaults (R11.3/R11.4).
  const load = useCallback(async () => {
    if (!establishmentId || !groupId) {
      setError('No se encontró el grupo.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await fetchGroupSelectionProfiles(establishmentId, { groupType, groupId });
    setLoading(false);
    if (!r.ok) {
      setError(
        r.error.kind === 'network'
          ? 'Sin conexión: no pudimos cargar los animales del grupo.'
          : 'No pudimos cargar los animales del grupo.',
      );
      return;
    }
    // Destete en lote cross-rodeo (R7.2 / D9): EXCLUIR de la lista los terneros cuyo rodeo real NO tenga
    // `destete` habilitado, contando cuántos quedaron fuera por configuración del rodeo (equivalente del
    // skip-and-report en el modelo de selección). Solo aplica a wean+lote: en un rodeo único la vista de
    // grupo ya gateó la op; en castración no hay gating (R1.5).
    //
    // ⚠ El gating de DESTETE es DISPLAY-ONLY: el server NO lo enforce-a (R7.3). `tg_sanitary_events_gating`
    // (0054) gatea solo `vaccination`/tacto/service — `weaning` quedó EXCLUIDO a propósito (decisión de
    // spec US-8, 0054). Lo único server-side acá es la RLS de AUTORIZACIÓN (has_role_in del establishment),
    // que decide quién puede escribir el evento pero NO mira el data_key `destete`. Por eso este filtro de
    // rodeo es del lado del cliente: NO hay barrera server-side que enforce-e el gating de destete.
    let weanEnabledByRodeo: ((rodeoId: string) => boolean) | undefined;
    if (operation === 'wean' && groupType === 'lote') {
      const predicate = await resolveWeanGatingPredicate(r.value.map((p) => p.rodeoId));
      // Si el gating no se pudo resolver (offline parcial), NO excluimos a ciegas (predicate undefined):
      // mostramos todos. Fail-open de DISPLAY — coherente con que el gating de destete NO se enforce-a
      // server-side (la RLS de autorización sí corre, pero no mira el data_key): no hay barrera que tape un
      // falso-positivo del display, así que ante duda mostramos (preferimos no ocultar un destete legítimo).
      weanEnabledByRodeo = predicate ?? undefined;
    }
    const built = buildBulkCandidates(operation, r.value, { rodeoWeaningEnabled: weanEnabledByRodeo });
    const candByOp = built.candidates as GroupSelectionProfile[];
    const state = buildBulkSelectionState(operation, candByOp);
    setCandidates(candByOp);
    setSelectionState(state);
    setSelected(state.selected);
    setExcludedByRodeoConfig(built.excludedByRodeoConfig);
  }, [establishmentId, groupId, groupType, operation]);

  useEffect(() => {
    void load();
  }, [load]);

  // Estado para el desglose/CTA derivado del selected vivo (NO del state.selected congelado).
  const liveState = useMemo<BulkSelectionState | null>(
    () => (selectionState ? { ...selectionState, selected } : null),
    [selectionState, selected],
  );
  const count = liveState ? selectedCount(liveState) : 0;
  const summary = useMemo(
    () => (liveState ? summarizeSelection(liveState, selected) : null),
    [liveState, selected],
  );

  const verb = operation === 'castrate' ? 'Castrar' : 'Destetar';
  const verbGerund = operation === 'castrate' ? 'Castrando' : 'Destetando';

  // Total de candidatos (para decidir si mostrar el buscador, R11.9).
  const totalCandidates = candidates.length;
  const showSearch = shouldShowSearch(totalCandidates);

  // ── Handlers de selección ──────────────────────────────────────────────────────────────
  const onToggleAnimal = useCallback((profileId: string) => {
    setSelected((prev) => toggleProfile(prev, profileId));
  }, []);

  const onToggleSectionAll = useCallback((section: SelectionSection, check: boolean) => {
    setSelected((prev) => toggleSection(prev, section, check));
  }, []);

  // ── Aplicar (CONFIRMAR del sheet) ──────────────────────────────────────────────────────
  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected.has(c.profileId)),
    [candidates, selected],
  );

  const onConfirm = useCallback(async () => {
    if (selectedCandidates.length === 0) return;
    setSheetOpen(false);
    setApplyPhase('enqueuing');
    setProgressDone(0);
    setProgressTotal(selectedCandidates.length);
    setRejections([]);
    setApplyError(null);

    const onProgress = (p: { done: number; total: number }) => {
      setProgressDone(p.done);
      setProgressTotal(p.total);
    };

    const result =
      operation === 'castrate'
        ? await applyBulkCastration(selectedCandidates, { onProgress })
        : await applyBulkWeaning(selectedCandidates, { eventDate: todayISO(), createdAt: new Date().toISOString() }, { onProgress });

    if (!result.ok) {
      setApplyError(
        result.error.kind === 'network'
          ? 'Sin conexión al preparar la operación. Probá de nuevo.'
          : 'No pudimos preparar la operación. Probá de nuevo.',
      );
      setApplyPhase('error');
      return;
    }
    // Rechazos LOCALES por animal (raros): etiqueta legible + motivo (R10.3).
    setRejections(
      result.value.rejected.map((rej) => ({
        label: labelOfProfile(candidateById.get(rej.profileId)),
        message: rej.message,
      })),
    );
    setProgressDone(result.value.enqueued);
    setApplyPhase('done');
  }, [selectedCandidates, operation, candidateById]);

  // Revertir el override de los seleccionados con category_override (R5.6, patrón C6).
  const onRevertOverrides = useCallback(async () => {
    const withOverride = selectedCandidates.filter((c) => c.categoryOverride === true);
    if (withOverride.length === 0) return;
    setRevertingOverride(true);
    // Revertimos uno por uno; sólo limpiamos en sitio los que el service ACEPTÓ (un fallo raro de write local
    // deja ese animal con su override → no mentimos su estado).
    const reverted = new Set<string>();
    for (const c of withOverride) {
      const r = await revertCategoryOverride(c.profileId);
      if (r.ok) reverted.add(c.profileId);
    }
    setRevertingOverride(false);
    setSheetOpen(false);
    // OPTIMISMO EN SITIO (fix Raf 2026-06-12): reflejamos category_override=false de los revertidos SIN re-
    // fetchear toda la lista (que blanqueaba "Cargando animales…" + reseteaba el scroll). Actualizamos tanto
    // `candidates` (fuente del candidateById + selectedCandidates) como `selectionState.sections` (fuente del
    // overrideCount del desglose → el aviso R5.6 desaparece solo). La SELECCIÓN del usuario (`selected`) se
    // PRESERVA intacta — no la tocamos. El server ya recalculó la categoría offline (LWW reconcilia al subir).
    if (reverted.size > 0) {
      setCandidates((prev) =>
        prev.map((c) => (reverted.has(c.profileId) ? { ...c, categoryOverride: false } : c)),
      );
      setSelectionState((prev) => (prev == null ? prev : clearOverridesInSelection(prev, reverted)));
    }
  }, [selectedCandidates]);

  // ── Render de la fase de PROGRESO (post-confirmar) ─────────────────────────────────────
  if (applyPhase) {
    return (
      <YStack flex={1} width="100%" backgroundColor="$bg">
        <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
          <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
              {verb}
            </Text>
          </XStack>
        </YStack>
        <BulkProgressPanel
          phase={applyPhase}
          verbGerund={verbGerund}
          done={progressDone}
          total={progressTotal}
          rejections={rejections}
          errorMessage={applyError}
          onDone={() => backOr(router, groupType === 'lote' ? '/lotes' : '/(tabs)')}
          onRetry={() => void onConfirm()}
        />
      </YStack>
    );
  }

  return (
    <YStack flex={1} width="100%" backgroundColor="$bg">
      {/* Header: back + título + contador VIVO (R11.5). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => backOr(router, groupType === 'lote' ? '/lotes' : '/(tabs)')} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {operation === 'castrate' ? 'Castrar' : 'Destetar'}
            </Text>
            <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
              {count} {count === 1 ? 'seleccionado' : 'seleccionados'}
            </Text>
          </YStack>
        </XStack>
      </YStack>

      {error ? (
        <YStack flex={1} paddingHorizontal="$4">
          <FormError message={error} />
        </YStack>
      ) : loading ? (
        <YStack flex={1} paddingHorizontal="$4">
          <InfoNote>Cargando animales…</InfoNote>
        </YStack>
      ) : candidates.length === 0 ? (
        <YStack flex={1} paddingHorizontal="$4" paddingTop="$4">
          <InfoNote>
            {operation === 'castrate'
              ? 'No hay animales para castrar en este grupo.'
              : 'No hay terneros para destetar en este grupo.'}
          </InfoNote>
        </YStack>
      ) : (
        <>
          <ScrollView
            flex={1}
            width="100%"
            contentContainerStyle={{
              paddingHorizontal: getTokenValue('$4', 'space'),
              paddingBottom: getTokenValue('$10', 'space'),
              gap: getTokenValue('$3', 'space'),
            }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Buscador (R11.9): solo si la lista supera ~20. */}
            {showSearch ? <SelectionSearchBar value={query} onChangeText={setQuery} /> : null}

            {/* Destete cross-rodeo (R7.2): cuántos terneros quedaron fuera por config de su rodeo. */}
            {excludedByRodeoConfig > 0 ? (
              <InfoNote>
                {excludedByRodeoConfig === 1
                  ? '1 ternero quedó excluido porque su rodeo no tiene el destete habilitado.'
                  : `${excludedByRodeoConfig} terneros quedaron excluidos porque su rodeo no tiene el destete habilitado.`}
              </InfoNote>
            ) : null}

            {(selectionState?.sections ?? []).map((section) => (
              <SelectionSectionBlock
                key={section.key}
                section={section}
                query={query}
                operation={operation}
                selected={selected}
                onToggleAnimal={onToggleAnimal}
                onToggleSectionAll={onToggleSectionAll}
              />
            ))}
          </ScrollView>

          {/* CTA fijo abajo (thumb-zone) con el número VIVO (R11.7), disabled en 0. */}
          <YStack
            width="100%"
            paddingHorizontal="$4"
            paddingTop="$3"
            paddingBottom={insets.bottom + getTokenValue('$3', 'space')}
            backgroundColor="$bg"
            borderTopWidth={1}
            borderTopColor="$divider"
          >
            <Button variant="primary" fullWidth disabled={count === 0} onPress={() => setSheetOpen(true)}>
              {`${verb} ${count} ${count === 1 ? 'animal' : 'animales'}`}
            </Button>
          </YStack>
        </>
      )}

      {/* Bottom-sheet de confirmación (T-UI.5). */}
      {sheetOpen && summary ? (
        <BulkConfirmSheet
          operation={operation}
          summary={summary}
          categoryLabel={(code, n) => pluralCategoryLabel(code, n, categoryNameOf(candidateById, code))}
          onConfirm={onConfirm}
          onCancel={() => setSheetOpen(false)}
          onRevertOverrides={summary.overrideCount > 0 ? onRevertOverrides : undefined}
          revertingOverride={revertingOverride}
        />
      ) : null}
    </YStack>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────────────────

/** Buscador XL de la selección (R11.9), manga-friendly (≥searchBarLg). Mismo lenguaje que Animales. */
function SelectionSearchBar({ value, onChangeText }: { value: string; onChangeText: (t: string) => void }) {
  const muted = getTokenValue('$textMuted', 'color');
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const fontSize = getTokenValue('$inputText', 'size');
  return (
    <XStack
      width="100%"
      minHeight="$searchBarLg"
      alignItems="center"
      gap="$2"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$4"
    >
      <Search size={20} color={muted} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Buscar por caravana"
        placeholderTextColor={muted}
        accessibilityLabel="Buscar animal por caravana"
        autoCorrect={false}
        style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize }}
      />
    </XStack>
  );
}

/** Una sección de categoría: header con "todos/ninguno" + las filas (AnimalRow compacto + checkbox). */
function SelectionSectionBlock({
  section,
  query,
  operation,
  selected,
  onToggleAnimal,
  onToggleSectionAll,
}: {
  section: SelectionSection;
  query: string;
  operation: BulkOperation;
  selected: ReadonlySet<string>;
  onToggleAnimal: (profileId: string) => void;
  onToggleSectionAll: (section: SelectionSection, check: boolean) => void;
}) {
  // Orden por ID (R11.9) + filtro de búsqueda (R11.9). El estado all/none/some se mide sobre la sección
  // ENTERA (no la filtrada) — "todos/ninguno" tilda toda la sección, no solo lo visible.
  const profiles = section.profiles as GroupSelectionProfile[];
  const visible = filterBySearch(sortByIdentifier(profiles), query);
  const allNone = sectionCheckState(selected, section);

  // Sección vacía tras buscar → no se muestra (evita un header huérfano).
  if (profiles.length === 0) return null;

  return (
    <YStack width="100%" gap="$2">
      <XStack width="100%" alignItems="center" justifyContent="space-between" paddingTop="$2">
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          {section.title}{' '}
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
            ({profiles.length})
          </Text>
        </Text>
        <Pressable
          onPress={() => onToggleSectionAll(section, allNone !== 'all')}
          {...buttonA11y(Platform.OS, {
            label: allNone === 'all' ? `Destildar todos los ${section.title.toLocaleLowerCase('es-AR')}` : `Tildar todos los ${section.title.toLocaleLowerCase('es-AR')}`,
          })}
        >
          <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
            {allNone === 'all' ? 'Ninguno' : 'Todos'}
          </Text>
        </Pressable>
      </XStack>

      {visible.length === 0 ? (
        <InfoNote>Sin coincidencias en esta sección.</InfoNote>
      ) : (
        <Card padding="$0" overflow="hidden">
          {visible.map((p) => {
            const checked = selected.has(p.profileId);
            // ⭐ resaltado terracota SIN modal (R11.6): solo castración + future_bull + tildado.
            const highlight = operation === 'castrate' && p.futureBull === true && checked;
            return (
              <AnimalRow
                key={p.profileId}
                compact
                idv={p.idv ?? undefined}
                apodo={p.apodo}
                rodeoUsesApodo={p.rodeoUsesApodo}
                tagElectronic={p.tagElectronic}
                category={p.categoryName || p.categoryCode}
                categoryCode={p.categoryCode}
                age={formatAnimalAge(p.animalBirthDate)}
                sex={p.rowSex}
                rodeo=""
                futureBull={p.futureBull}
                highlight={highlight}
                checked={checked}
                onToggle={() => onToggleAnimal(p.profileId)}
              />
            );
          })}
        </Card>
      )}
    </YStack>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────

/** Etiqueta legible de un animal para el reporte de rechazo (R10.3): idv → apodo → "Animal" (delta IDU). */
function labelOfProfile(p: GroupSelectionProfile | undefined): string {
  if (!p) return 'Animal';
  return p.idv ?? p.apodo ?? 'Animal';
}

/**
 * Resuelve un predicado `(rodeoId) => destete habilitado` para el destete en lote cross-rodeo (R7.2). Lee
 * el gating de cada rodeo DISTINTO de los candidatos del SQLite local (offline). Si ALGÚN rodeo no se pudo
 * resolver, devuelve null (el caller no excluye a ciegas — fail-open de DISPLAY; la authz es server-side).
 */
async function resolveWeanGatingPredicate(
  rodeoIds: readonly string[],
): Promise<((rodeoId: string) => boolean) | null> {
  const distinct = [...new Set(rodeoIds)];
  const enabledByRodeo = new Map<string, boolean>();
  for (const rodeoId of distinct) {
    // CONFIG-only (no candidate-gated): preguntamos si el rodeo TIENE `destete` habilitado, no si tiene
    // candidatos (fetchRodeoGroupActions ahora gatea por candidatos → su .wean sería la pregunta equivocada).
    const r = await fetchRodeoConfigGating(rodeoId);
    if (!r.ok) return null; // gating irresoluble → no excluir a ciegas
    enabledByRodeo.set(rodeoId, r.value.weaningEnabled);
  }
  return (rodeoId: string) => enabledByRodeo.get(rodeoId) === true;
}

/** Nombre singular del catálogo para una categoría code (fallback del desglose) — del primer candidato. */
function categoryNameOf(byId: Map<string, GroupSelectionProfile>, code: string): string {
  for (const c of byId.values()) {
    if (c.categoryCode === code) return c.categoryName || code;
  }
  return code;
}
