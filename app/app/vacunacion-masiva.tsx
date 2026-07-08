// app/vacunacion-masiva.tsx — pantalla de VACUNACIÓN MASIVA (spec 10, T-UI.6 / R4.1, R4.2, R4.3, R4.4,
// R10.4). 🔴 MANGA-CRÍTICA: se usa en el corral, targets XL, una decisión clara, operable con el
// pulgar/guante, legible a pleno sol.
//
// Modelo Gate 0 ORIGINAL (R4.1, "vacunación NO cambia" — NO selección por checkbox como castrar/destetar):
//   - Pre-config: producto (obligatorio). La VÍA de aplicación se ELIMINÓ (decisión de producto cerrada
//     por Raf/Facundo 2026-06-15): el producto YA implica la vía → capturarla aparte es redundante. La
//     columna `sanitary_events.route` queda DORMIDA (nullable, no se escribe; sin migración).
//   - Filtro OPCIONAL por categoría y/o sexo (default = TODOS los activos del grupo, sin filtro).
//   - Preview obligatorio (R4.2): "N eventos sobre M animales" + "K saltados (motivos)" (skip-and-report,
//     R4.3): ya-vacunados de esta fecha (idempotencia R6.3) + (lote cross-rodeo) rodeo sin `vacunacion`
//     habilitado (R7.2). El preview se RECALCULA en vivo al cambiar el filtro.
//   - Confirmación EXPLÍCITA → applyBulkVaccination (Fase 3 REUSADO) sobre `preview.toApply` (R4.4: los
//     saltados NO se encolan) → BulkProgressPanel (progreso del encolado + rechazos por animal — reuso UI-B).
//   - Re-ejecutable (R6.3/R4.4): los ya-vacunados se saltan → el preview refleja solo los nuevos.
//   - Empty state si el grupo no tiene animales activos.
//
// Toda la lógica/services ya existen (Fase 2+3) — se REUSAN (cero re-implementación de mutaciones). La
// AUTORIZACIÓN es server-side (RLS + gating capa 2 fail-closed de 0054 re-validan cada INSERT al subir);
// el gating de DISPLAY NO es el control. `author_id` no aplica a vacunación (sanitary_events). Cero
// hardcode (ADR-023 §4): tokens; íconos lucide con getTokenValue. Voseo es-AR.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronLeft, Syringe, AlertCircle } from 'lucide-react-native';

import {
  Button,
  Card,
  FormError,
  FormField,
  InfoNote,
  BulkProgressPanel,
  type BulkProgressPhase,
  type BulkProgressRejection,
} from '@/components';
import { useEstablishment } from '@/contexts';
import {
  fetchGroupSelectionProfiles,
  type GroupSelectionProfile,
} from '@/services/bulk-selection-data';
import { applyBulkVaccination, previewVaccination } from '@/services/bulk-operations';
import { fetchRodeoConfigGating } from '@/services/group-data';
import { buildBulkCandidates } from '@/utils/bulk-candidates';
import {
  deriveCategoryFilterOptions,
  type CategoryFilterOption,
  type VaccinationPreview,
} from '@/utils/vaccination-preview';
import type { AnimalSex } from '@/utils/animal-category';
import { backOr } from '@/utils/nav';
import { buttonA11y } from '@/utils/a11y';

/** today() ISO 'YYYY-MM-DD' — la fecha del evento (= la fecha de la clave idempotente). Local, no hardcode. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tope de caracteres del nombre del producto (defensivo; product_name es text en DB). */
const PRODUCT_NAME_MAX = 80;

export default function VacunacionMasivaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupType?: string; groupId?: string }>();
  const groupType = params.groupType === 'lote' ? 'lote' : 'rodeo';
  const groupId = typeof params.groupId === 'string' ? params.groupId : null;

  const { state: estState } = useEstablishment();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const muted = getTokenValue('$textMuted', 'color');

  // ── Carga del grupo ───────────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<GroupSelectionProfile[]>([]);
  // Predicado de gating por rodeo (lote cross-rodeo, R7.2). undefined = rodeo único / irresoluble.
  const [rodeoVaccEnabled, setRodeoVaccEnabled] = useState<((rodeoId: string) => boolean) | undefined>(
    undefined,
  );

  // ── Pre-config + filtro (R4.1) ──────────────────────────────────────────────────────────────
  const [productName, setProductName] = useState('');
  const [productTouched, setProductTouched] = useState(false);
  // Filtro opcional: categorías tildadas (vacío = todas) + sexo tildado (null = ambos).
  const [categoryFilter, setCategoryFilter] = useState<ReadonlySet<string>>(new Set());
  const [sexFilter, setSexFilter] = useState<AnimalSex | null>(null);

  // ── Preview (R4.2) ─────────────────────────────────────────────────────────────────────────
  const eventDate = useMemo(() => todayISO(), []);
  const [preview, setPreview] = useState<VaccinationPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // ── Aplicado (post-confirmar) ────────────────────────────────────────────────────────────────
  const [applyPhase, setApplyPhase] = useState<BulkProgressPhase | null>(null);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [rejections, setRejections] = useState<BulkProgressRejection[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Mapa profileId → perfil (etiquetas legibles del rechazo, R10.3).
  const profileById = useMemo(() => {
    const m = new Map<string, GroupSelectionProfile>();
    for (const p of profiles) m.set(p.profileId, p);
    return m;
  }, [profiles]);

  // Carga: perfiles activos del grupo + (lote) el gating de vacunación por rodeo real (R7.2).
  const load = useCallback(async () => {
    if (!establishmentId || !groupId) {
      setLoadError('No se encontró el grupo.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const r = await fetchGroupSelectionProfiles(establishmentId, { groupType, groupId });
    if (!r.ok) {
      setLoading(false);
      setLoadError(
        r.error.kind === 'network'
          ? 'Sin conexión: no pudimos cargar los animales del grupo.'
          : 'No pudimos cargar los animales del grupo.',
      );
      return;
    }
    // Lote cross-rodeo (R7.2): resolver `vacunacion` habilitado por rodeo real de los miembros. Si el
    // gating no resuelve (offline parcial), NO excluimos a ciegas — fail-OPEN de DISPLAY (la authz es
    // server-side: el gating capa 2 de 0054 rechaza fail-closed cada INSERT a un rodeo sin vacunación).
    let predicate: ((rodeoId: string) => boolean) | undefined;
    if (groupType === 'lote') {
      predicate = await resolveVaccGatingPredicate(r.value.map((p) => p.rodeoId));
    }
    setProfiles(r.value);
    setRodeoVaccEnabled(() => predicate);
    setLoading(false);
  }, [establishmentId, groupId, groupType]);

  useEffect(() => {
    void load();
  }, [load]);

  // Conjunto candidato (R4.1): base activos + filtro opcional categoría/sexo (buildBulkCandidates).
  const candidates = useMemo(() => {
    const filter = {
      categoryCodes: categoryFilter.size > 0 ? [...categoryFilter] : undefined,
      sex: sexFilter ?? undefined,
    };
    return buildBulkCandidates('vaccinate', profiles, { filter }).candidates as GroupSelectionProfile[];
  }, [profiles, categoryFilter, sexFilter]);

  // Opciones del filtro de categoría: derivadas de los activos del grupo (R4.1) — solo las presentes.
  const categoryOptions = useMemo<CategoryFilterOption[]>(
    () => deriveCategoryFilterOptions(profiles),
    [profiles],
  );
  // ¿El grupo tiene ambos sexos? (para ofrecer el filtro de sexo solo si tiene sentido).
  const hasMale = useMemo(() => profiles.some((p) => p.sex === 'male'), [profiles]);
  const hasFemale = useMemo(() => profiles.some((p) => p.sex === 'female'), [profiles]);
  const showSexFilter = hasMale && hasFemale;

  // Recalcular el preview en vivo cuando cambia el conjunto candidato (R4.2/R4.3): resuelve los
  // ya-vacunados localmente (idempotencia) + aplica el gating por rodeo. Encadenado a `candidates`.
  useEffect(() => {
    let cancelled = false;
    if (profiles.length === 0) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    void previewVaccination(candidates, eventDate, rodeoVaccEnabled).then((r) => {
      if (cancelled) return;
      setPreviewing(false);
      setPreview(r.ok ? r.value : null);
    });
    return () => {
      cancelled = true;
    };
  }, [candidates, eventDate, rodeoVaccEnabled, profiles.length]);

  // ── Handlers del filtro ──────────────────────────────────────────────────────────────────────
  const toggleCategory = useCallback((code: string) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const toggleSex = useCallback((sex: AnimalSex) => {
    setSexFilter((prev) => (prev === sex ? null : sex));
  }, []);

  // ── Confirmar (R4.2 confirmación explícita → R4.4 solo se encolan los toApply) ────────────────
  const productError =
    productTouched && productName.trim().length === 0 ? 'Indicá qué producto se aplica.' : null;
  const canApply = productName.trim().length > 0 && (preview?.animalsToApply ?? 0) > 0;

  const onConfirm = useCallback(async () => {
    if (!preview || preview.animalsToApply === 0 || productName.trim().length === 0) return;
    setApplyPhase('enqueuing');
    setProgressDone(0);
    setProgressTotal(preview.animalsToApply);
    setRejections([]);
    setApplyError(null);

    const onProgress = (p: { done: number; total: number }) => {
      setProgressDone(p.done);
      setProgressTotal(p.total);
    };

    // R4.4: SOLO los toApply (excluye ya-vacunados + rodeo deshabilitado) se encolan.
    const result = await applyBulkVaccination(
      preview.toApply,
      { productName: productName.trim(), eventDate },
      { onProgress },
    );

    if (!result.ok) {
      setApplyError(
        result.error.kind === 'network'
          ? 'Sin conexión al preparar la vacunación. Probá de nuevo.'
          : 'No pudimos preparar la vacunación. Probá de nuevo.',
      );
      setApplyPhase('error');
      return;
    }
    setRejections(
      result.value.rejected.map((rej) => ({
        label: labelOfProfile(profileById.get(rej.profileId)),
        message: rej.message,
      })),
    );
    setProgressDone(result.value.enqueued);
    setApplyPhase('done');
  }, [preview, productName, eventDate, profileById]);

  // ── Render: fase de PROGRESO (post-confirmar) ────────────────────────────────────────────────
  if (applyPhase) {
    return (
      <YStack flex={1} width="100%" backgroundColor="$bg">
        <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
          <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
              Vacunar
            </Text>
          </XStack>
        </YStack>
        <BulkProgressPanel
          phase={applyPhase}
          verbGerund="Vacunando"
          done={progressDone}
          total={progressTotal}
          rejections={rejections}
          errorMessage={applyError}
          onDone={() => backOr(router, groupBackPath(groupType))}
          onRetry={() => void onConfirm()}
        />
      </YStack>
    );
  }

  return (
    <YStack flex={1} width="100%" backgroundColor="$bg">
      {/* Header: back + título. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable
            hitSlop={8}
            onPress={() => backOr(router, groupBackPath(groupType))}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Vacunar
          </Text>
        </XStack>
      </YStack>

      {loadError ? (
        <YStack flex={1} paddingHorizontal="$4">
          <FormError message={loadError} />
        </YStack>
      ) : loading ? (
        <YStack flex={1} paddingHorizontal="$4">
          <InfoNote>Cargando animales…</InfoNote>
        </YStack>
      ) : profiles.length === 0 ? (
        <YStack flex={1} paddingHorizontal="$4" paddingTop="$4">
          <InfoNote>Este grupo todavía no tiene animales activos para vacunar.</InfoNote>
        </YStack>
      ) : (
        <>
          <ScrollView
            flex={1}
            width="100%"
            contentContainerStyle={{
              paddingHorizontal: getTokenValue('$4', 'space'),
              paddingBottom: getTokenValue('$10', 'space'),
              gap: getTokenValue('$4', 'space'),
            }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Pre-config: SOLO producto (obligatorio). La vía se eliminó (el producto la implica). */}
            <Card gap="$3">
              <FormField
                label="Producto"
                value={productName}
                onChangeText={(t) => {
                  setProductName(t);
                  if (!productTouched) setProductTouched(true);
                }}
                placeholder="Ej. Mancha-gangrena"
                autoCapitalize="sentences"
                error={productError}
                maxLength={PRODUCT_NAME_MAX}
              />
            </Card>

            {/* Filtro OPCIONAL por categoría y/o sexo (R4.1). Default = todos (sin filtro). */}
            <YStack width="100%" gap="$2">
              <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
                Filtrar (opcional)
              </Text>
              <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
                Sin filtro se vacuna a todo el grupo. Tocá una categoría o sexo para acotar.
              </Text>

              {categoryOptions.length > 1 ? (
                <FilterChipRow>
                  {categoryOptions.map((opt) => (
                    <FilterChip
                      key={opt.code}
                      label={`${opt.name} (${opt.count})`}
                      selected={categoryFilter.has(opt.code)}
                      onPress={() => toggleCategory(opt.code)}
                    />
                  ))}
                </FilterChipRow>
              ) : null}

              {showSexFilter ? (
                <FilterChipRow>
                  <FilterChip
                    label="Machos"
                    selected={sexFilter === 'male'}
                    onPress={() => toggleSex('male')}
                  />
                  <FilterChip
                    label="Hembras"
                    selected={sexFilter === 'female'}
                    onPress={() => toggleSex('female')}
                  />
                </FilterChipRow>
              ) : null}
            </YStack>

            {/* Preview obligatorio (R4.2) + skip-and-report (R4.3). */}
            <PreviewCard preview={preview} previewing={previewing} />
          </ScrollView>

          {/* CTA fijo abajo (thumb-zone): confirmación EXPLÍCITA. Disabled sin producto o sin animales. */}
          <YStack
            width="100%"
            paddingHorizontal="$4"
            paddingTop="$3"
            paddingBottom={insets.bottom + getTokenValue('$3', 'space')}
            backgroundColor="$bg"
            borderTopWidth={1}
            borderTopColor="$divider"
          >
            <Button variant="primary" fullWidth disabled={!canApply} onPress={() => void onConfirm()}>
              {ctaLabel(preview)}
            </Button>
          </YStack>
        </>
      )}
    </YStack>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────────────────────

/** Texto del CTA de confirmación según el preview (R4.2). Vivo: "Vacunar M animales". */
function ctaLabel(preview: VaccinationPreview | null): string {
  const m = preview?.animalsToApply ?? 0;
  if (m === 0) return 'Vacunar';
  return `Vacunar ${m} ${m === 1 ? 'animal' : 'animales'}`;
}

/** Card del PREVIEW (R4.2): "N eventos sobre M animales" + "K saltados (motivos)" (R4.3). */
function PreviewCard({
  preview,
  previewing,
}: {
  preview: VaccinationPreview | null;
  previewing: boolean;
}) {
  const primary = getTokenValue('$primary', 'color');
  const terracota = getTokenValue('$terracota', 'color');

  if (!preview) {
    return (
      <Card>
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
          {previewing ? 'Calculando…' : 'Sin animales para vacunar con este filtro.'}
        </Text>
      </Card>
    );
  }

  const { eventsToApply, animalsToApply, skipped, skippedTotal } = preview;

  return (
    <Card gap="$3">
      <XStack alignItems="center" gap="$2">
        <Syringe size={getTokenValue('$navIcon', 'size')} color={primary} strokeWidth={2.5} />
        <YStack flex={1}>
          <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary">
            {animalsToApply === 0
              ? 'Ningún animal nuevo para vacunar'
              : `${eventsToApply} ${eventsToApply === 1 ? 'evento' : 'eventos'} sobre ${animalsToApply} ${
                  animalsToApply === 1 ? 'animal' : 'animales'
                }`}
          </Text>
          {animalsToApply > 0 ? (
            <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
              Una vacunación por animal.
            </Text>
          ) : null}
        </YStack>
      </XStack>

      {/* Skip-and-report (R4.3): cuántos se saltan y por qué. */}
      {skippedTotal > 0 ? (
        <YStack
          gap="$2"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$divider"
          borderRadius="$card"
          paddingHorizontal="$3"
          paddingVertical="$3"
        >
          <XStack alignItems="center" gap="$2">
            <AlertCircle size={18} color={terracota} strokeWidth={2.5} />
            <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
              {skippedTotal === 1 ? '1 animal se saltea' : `${skippedTotal} animales se saltean`}
            </Text>
          </XStack>
          <YStack gap="$1">
            {skipped.alreadyApplied > 0 ? (
              <SkipReason
                count={skipped.alreadyApplied}
                singular="ya tiene esta vacunación cargada hoy"
                plural="ya tienen esta vacunación cargada hoy"
              />
            ) : null}
            {skipped.rodeoDisabled > 0 ? (
              <SkipReason
                count={skipped.rodeoDisabled}
                singular="su rodeo no tiene la vacunación habilitada"
                plural="su rodeo no tiene la vacunación habilitada"
              />
            ) : null}
          </YStack>
        </YStack>
      ) : null}
    </Card>
  );
}

/** Una línea del skip-report: "· N animales <motivo>". */
function SkipReason({ count, singular, plural }: { count: number; singular: string; plural: string }) {
  const dot = getTokenValue('$dot', 'size');
  return (
    <XStack alignItems="center" gap="$2">
      <View width={dot} height={dot} borderRadius="$pill" backgroundColor="$textMuted" />
      <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted" flex={1}>
        {count === 1 ? `1 animal ${singular}` : `${count} animales ${plural}`}
      </Text>
    </XStack>
  );
}

/** Fila de chips de filtro que envuelve (wrap) — manga-friendly, los chips no se cortan. */
function FilterChipRow({ children }: { children: React.ReactNode }) {
  return (
    <XStack width="100%" flexWrap="wrap" gap="$2">
      {children}
    </XStack>
  );
}

/** Chip de filtro (mismo lenguaje que la tab Animales): ≥$chipMin, pill, seleccionado = $primary. */
function FilterChip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label, selected })}>
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

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────

/** Path de vuelta según el tipo de grupo (mismo criterio que la pantalla de selección). */
function groupBackPath(groupType: 'rodeo' | 'lote'): string {
  return groupType === 'lote' ? '/lotes' : '/(tabs)';
}

/** Etiqueta legible de un animal para el reporte de rechazo (R10.3): idv → apodo → "Animal" (delta IDU). */
function labelOfProfile(p: GroupSelectionProfile | undefined): string {
  if (!p) return 'Animal';
  return p.idv ?? p.apodo ?? 'Animal';
}

/**
 * Resuelve un predicado `(rodeoId) => vacunación habilitada` para el lote cross-rodeo (R7.2). Lee el
 * gating de cada rodeo DISTINTO de los miembros del SQLite local (offline). Si ALGÚN rodeo no se pudo
 * resolver, devuelve undefined (el caller NO excluye a ciegas — fail-open de DISPLAY; la authz es
 * server-side: el gating capa 2 de 0054 rechaza fail-closed cada INSERT a un rodeo sin vacunación).
 */
async function resolveVaccGatingPredicate(
  rodeoIds: readonly string[],
): Promise<((rodeoId: string) => boolean) | undefined> {
  const distinct = [...new Set(rodeoIds)];
  const enabledByRodeo = new Map<string, boolean>();
  for (const rodeoId of distinct) {
    // CONFIG-only (vacunación no se gatea por candidatos, pero usamos el resolver de config por consistencia
    // y para no requerir la lista del grupo que fetchRodeoGroupActions ahora necesita).
    const r = await fetchRodeoConfigGating(rodeoId);
    if (!r.ok) return undefined; // gating irresoluble → no excluir a ciegas
    enabledByRodeo.set(rodeoId, r.value.vaccinationEnabled);
  }
  return (rodeoId: string) => enabledByRodeo.get(rodeoId) === true;
}
