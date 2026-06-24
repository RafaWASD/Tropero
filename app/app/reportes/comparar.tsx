// app/reportes/comparar.tsx — COMPARATIVA de dos sesiones del mismo rodeo (spec 07 Stream C, R7.4 / R7.9.5
// / T7.2 / T7.3). El usuario elige 2 sesiones (ambas del MISMO rodeo — la lista ya está scopeada al rodeo,
// R7.4.2) → tabla lado a lado con el delta por tipo de evento (R7.4.1/.3) + el delta de peso por categoría
// (R7.9.5: comparativa por SESIONES en el MVP).
//
// ONLINE-ONLY (R7.2): los conteos/pesos por sesión vienen de las RPC (`session_event_summary`,
// `rodeo_weight_by_category(rodeoId, sessionId)`). Multi-tenant: rodeoId por params (de la tab Reportes,
// scopeada por campo activo); las RPC re-validan tenant server-side. La comparativa por CAMPAÑA queda
// post-MVP (no se implementa).
//
// Cero hardcode (ADR-023 §4): tokens + componentes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { ChevronLeft, Check } from 'lucide-react-native';

import { Card } from '@/components';
import { ReportLoading, ReportOffline, ReportError, ReportEmpty, ReportDivider } from '@/components/reports';
import { useRodeoSessions, reportView } from '@/hooks/use-reports';
import {
  fetchSessionSummary,
  fetchWeightByCategory,
  type SessionEventCount,
  type WeightByCategory,
  type ReportError as ReportErr,
} from '@/services/reports';
import {
  compareSessions,
  compareWeights,
  formatCountDelta,
  formatKgAR,
  formatKgDeltaAR,
  sessionRangeLabel,
  type CompareRow,
  type WeightCompareRow,
} from '@/utils/reports-format';
import { buttonA11y } from '@/utils/a11y';

type PairData = {
  loading: boolean;
  error: ReportErr | null;
  summaryA: SessionEventCount[];
  summaryB: SessionEventCount[];
  weightA: WeightByCategory[];
  weightB: WeightByCategory[];
};

export default function CompararScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ rodeoId?: string; name?: string }>();
  const rodeoId = typeof params.rodeoId === 'string' ? params.rodeoId : null;
  const rodeoName = typeof params.name === 'string' ? params.name : '';
  const muted = getTokenValue('$textMuted', 'color');

  const sessions = useRodeoSessions(rodeoId);
  const list = sessions.data ?? [];

  // Selección de las 2 sesiones (ambas del mismo rodeo, R7.4.2). idA/idB.
  const [idA, setIdA] = useState<string | null>(null);
  const [idB, setIdB] = useState<string | null>(null);

  // Datos de la pareja seleccionada (online).
  const [pair, setPair] = useState<PairData>({
    loading: false,
    error: null,
    summaryA: [],
    summaryB: [],
    weightA: [],
    weightB: [],
  });

  useEffect(() => {
    if (!rodeoId || !idA || !idB) return;
    let active = true;
    setPair((p) => ({ ...p, loading: true, error: null }));
    void Promise.all([
      fetchSessionSummary(idA),
      fetchSessionSummary(idB),
      fetchWeightByCategory(rodeoId, idA),
      fetchWeightByCategory(rodeoId, idB),
    ]).then(([sa, sb, wa, wb]) => {
      if (!active) return;
      // El primer error que aparezca define el estado de error (offline/network/etc).
      const firstErr = [sa, sb, wa, wb].find((r) => !r.ok);
      if (firstErr && !firstErr.ok) {
        setPair((p) => ({ ...p, loading: false, error: firstErr.error }));
        return;
      }
      setPair({
        loading: false,
        error: null,
        summaryA: sa.ok ? sa.value : [],
        summaryB: sb.ok ? sb.value : [],
        weightA: wa.ok ? wa.value : [],
        weightB: wb.ok ? wb.value : [],
      });
    });
    return () => {
      active = false;
    };
  }, [rodeoId, idA, idB]);

  const eventRows = useMemo<CompareRow[]>(
    () => compareSessions(pair.summaryA, pair.summaryB),
    [pair.summaryA, pair.summaryB],
  );
  const weightRows = useMemo<WeightCompareRow[]>(
    () => compareWeights(pair.weightA, pair.weightB),
    [pair.weightA, pair.weightB],
  );

  const sv = reportView(sessions);
  const bothPicked = idA !== null && idB !== null;
  const labelA = list.find((s) => s.id === idA);
  const labelB = list.find((s) => s.id === idB);

  const reloadPair = useCallback(() => {
    // Re-disparar el efecto: limpiamos y re-seteamos (toggle) la pareja para forzar el fetch.
    const a = idA;
    const b = idB;
    setIdA(null);
    setIdB(null);
    setTimeout(() => {
      setIdA(a);
      setIdB(b);
    }, 0);
  }, [idA, idB]);

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => router.back()} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
              Comparar
            </Text>
            {rodeoName ? (
              <Text numberOfLines={1} fontFamily="$body" fontSize="$2" color="$textMuted">
                {rodeoName}
              </Text>
            ) : null}
          </YStack>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$3', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {sv.showSpinner ? (
          <ReportLoading label="Cargando sesiones…" />
        ) : sv.showOffline ? (
          <ReportOffline onRetry={sessions.reload} />
        ) : sv.showError ? (
          <ReportError message={sessions.error?.message} onRetry={sessions.reload} />
        ) : list.length < 2 ? (
          <ReportEmpty
            title="Necesitás al menos 2 jornadas"
            body="Cuando este rodeo tenga dos o más jornadas, vas a poder compararlas acá."
          />
        ) : (
          <>
            {/* Selección de las 2 sesiones. */}
            <SessionPicker
              title="Primera jornada"
              list={list}
              selectedId={idA}
              disabledId={idB}
              onSelect={setIdA}
            />
            <SessionPicker
              title="Segunda jornada"
              list={list}
              selectedId={idB}
              disabledId={idA}
              onSelect={setIdB}
            />

            {/* Resultado de la comparación. */}
            {!bothPicked ? (
              <ReportEmpty title="Elegí dos jornadas" body="Seleccioná dos jornadas de arriba para compararlas." />
            ) : pair.loading ? (
              <ReportLoading label="Comparando…" />
            ) : pair.error && pair.error.kind === 'offline' ? (
              <ReportOffline onRetry={reloadPair} />
            ) : pair.error ? (
              <ReportError message={pair.error.message} onRetry={reloadPair} />
            ) : (
              <>
                <CompareHeader
                  a={labelA ? sessionRangeLabel(labelA.startedAt, labelA.endedAt) : 'A'}
                  b={labelB ? sessionRangeLabel(labelB.startedAt, labelB.endedAt) : 'B'}
                />
                <EventsCompare rows={eventRows} />
                <WeightCompare rows={weightRows} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </YStack>
  );
}

// ─── Selector de una sesión (acordeón simple) ────────────────────────────────────────────────────────

function SessionPicker({
  title,
  list,
  selectedId,
  disabledId,
  onSelect,
}: {
  title: string;
  list: { id: string; startedAt: string | null; endedAt: string | null }[];
  selectedId: string | null;
  disabledId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const primary = getTokenValue('$primary', 'color');
  const muted = getTokenValue('$textMuted', 'color');
  const selected = list.find((s) => s.id === selectedId);

  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
        {title}
      </Text>
      <Pressable onPress={() => setOpen((v) => !v)} {...buttonA11y(Platform.OS, { label: title, selected: open })}>
        <XStack
          width="100%"
          alignItems="center"
          gap="$2"
          minHeight="$chipMin"
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderRadius="$pill"
          backgroundColor={selected ? '$greenLight' : '$surface'}
          borderWidth={1}
          borderColor={selected ? '$greenLight' : '$divider'}
          pressStyle={{ opacity: 0.85 }}
        >
          <Text
            flex={1}
            minWidth={0}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$4"
            fontWeight={selected ? '600' : '400'}
            color={selected ? '$primary' : '$textMuted'}
          >
            {selected ? sessionRangeLabel(selected.startedAt, selected.endedAt) : 'Elegí una jornada'}
          </Text>
        </XStack>
      </Pressable>
      {open ? (
        <Card gap="$1" paddingVertical="$2">
          {list.map((s) => {
            const isDisabled = s.id === disabledId;
            return (
              <Pressable
                key={s.id}
                disabled={isDisabled}
                onPress={() => {
                  onSelect(s.id);
                  setOpen(false);
                }}
                {...buttonA11y(Platform.OS, {
                  label: sessionRangeLabel(s.startedAt, s.endedAt),
                  selected: s.id === selectedId,
                  disabled: isDisabled,
                })}
              >
                <XStack
                  alignItems="center"
                  gap="$2"
                  minHeight="$chipMin"
                  paddingHorizontal="$2"
                  opacity={isDisabled ? 0.4 : 1}
                  pressStyle={{ opacity: 0.6 }}
                >
                  <Text
                    flex={1}
                    minWidth={0}
                    numberOfLines={1}
                    fontFamily="$body"
                    fontSize="$4"
                    fontWeight="500"
                    color="$textPrimary"
                  >
                    {sessionRangeLabel(s.startedAt, s.endedAt)}
                    {isDisabled ? ' · ya elegida' : ''}
                  </Text>
                  {s.id === selectedId ? <Check size={20} color={primary} strokeWidth={2.5} /> : null}
                </XStack>
              </Pressable>
            );
          })}
        </Card>
      ) : null}
    </YStack>
  );
}

// ─── Cabecera A vs B ─────────────────────────────────────────────────────────────────────────────────

function CompareHeader({ a, b }: { a: string; b: string }) {
  return (
    <XStack gap="$2" alignItems="stretch">
      <YStack
        flex={1}
        minWidth={0}
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textMuted">
          A
        </Text>
        <Text numberOfLines={2} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
          {a}
        </Text>
      </YStack>
      <YStack
        flex={1}
        minWidth={0}
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textMuted">
          B
        </Text>
        <Text numberOfLines={2} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
          {b}
        </Text>
      </YStack>
    </XStack>
  );
}

// ─── Tabla de eventos (delta por tipo) ───────────────────────────────────────────────────────────────

function EventsCompare({ rows }: { rows: CompareRow[] }) {
  if (rows.length === 0) {
    return <ReportEmpty title="Sin eventos" body="Ninguna de las dos jornadas tiene eventos para comparar." />;
  }
  return (
    <Card gap="$3">
      <Text fontFamily="$body" fontSize="$4" fontWeight="700" color="$textPrimary">
        Eventos por tipo
      </Text>
      {rows.map((r, i) => (
        <YStack key={r.kind} gap="$3">
          {i > 0 ? <ReportDivider /> : null}
          <XStack alignItems="center" gap="$2">
            <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
              {r.label}
            </Text>
            <Text width={44} textAlign="right" fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
              {r.a}
            </Text>
            <Text width={44} textAlign="right" fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
              {r.b}
            </Text>
            <DeltaPill delta={r.delta} text={formatCountDelta(r.delta)} />
          </XStack>
        </YStack>
      ))}
    </Card>
  );
}

// ─── Tabla de peso por categoría (delta) ─────────────────────────────────────────────────────────────

function WeightCompare({ rows }: { rows: WeightCompareRow[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <Card gap="$3">
      <Text fontFamily="$body" fontSize="$4" fontWeight="700" color="$textPrimary">
        Peso por categoría
      </Text>
      {rows.map((r, i) => (
        <YStack key={r.categoryId} gap="$3">
          {i > 0 ? <ReportDivider /> : null}
          <XStack alignItems="center" gap="$2">
            <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
              {r.categoryName}
            </Text>
            <Text width={72} textAlign="right" numberOfLines={1} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
              {formatKgAR(r.a)}
            </Text>
            <Text width={72} textAlign="right" numberOfLines={1} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
              {formatKgAR(r.b)}
            </Text>
            <DeltaPill delta={r.delta ?? 0} text={formatKgDeltaAR(r.delta)} disabled={r.delta === null} />
          </XStack>
        </YStack>
      ))}
    </Card>
  );
}

/** Pill del delta: verde si sube, terracota si baja, neutro si 0 / sin dato. */
function DeltaPill({ delta, text, disabled = false }: { delta: number; text: string; disabled?: boolean }) {
  const color = disabled || delta === 0 ? '$textMuted' : delta > 0 ? '$primary' : '$terracota';
  return (
    <Text width={72} textAlign="right" fontFamily="$body" fontSize="$3" fontWeight="700" color={color}>
      {text}
    </Text>
  );
}
