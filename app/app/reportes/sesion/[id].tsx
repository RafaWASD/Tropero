// app/reportes/sesion/[id].tsx — DETALLE de una sesión (spec 07 Stream C, R7.3.1/.2/.5 / T7.1). Resumen de
// una jornada de maniobra: marco temporal (started/ended, R7.3.2), conteo por tipo de evento (R7.3.1),
// empty state cálido si no hubo eventos (R7.3.5).
//
// Dos fuentes (design §2.1): (a) el marco temporal + los totales de cabecera de la fila `sessions` (lectura
// LOCAL de SQLite, ya sincronizada — `getSessionById`); (b) el conteo POR TIPO de evento de la RPC online
// `session_event_summary` (tenant-scopeada, R7.13.2 incluye archivados en el histórico). El detalle por
// tipo es online (R7.2); el marco temporal es local (no requiere red — la sesión ya está en el dispositivo).
//
// Cero hardcode (ADR-023 §4): tokens + componentes.

import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { ChevronLeft, CalendarRange } from 'lucide-react-native';

import { Card } from '@/components';
import {
  ReportLoading,
  ReportOffline,
  ReportError,
  ReportEmpty,
  ReportDivider,
} from '@/components/reports';
import { useSessionSummary, reportView } from '@/hooks/use-reports';
import { getSessionById, type Session } from '@/services/sessions';
import { eventKindLabel, sessionRangeLabel } from '@/utils/reports-format';
import { buttonA11y } from '@/utils/a11y';

export default function SesionDetalleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const sessionId = typeof params.id === 'string' ? params.id : null;
  const rodeoName = typeof params.name === 'string' ? params.name : '';
  const muted = getTokenValue('$textMuted', 'color');

  // Marco temporal + totales de cabecera (lectura LOCAL — la sesión ya está sincronizada en el device).
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    void getSessionById(sessionId).then((r) => {
      if (active && r.ok) setSession(r.value);
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  // Conteo por tipo de evento (online).
  const summary = useSessionSummary(sessionId);
  const v = reportView(summary);

  // ¿Hubo algún evento? (la RPC devuelve los 7 kinds, con 0 incluido → empty si todos son 0, R7.3.5).
  const rows = summary.data ?? [];
  const totalEvents = rows.reduce((acc, r) => acc + r.eventCount, 0);
  const nonZero = rows.filter((r) => r.eventCount > 0);

  const onBack = useCallback(() => router.back(), [router]);

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={onBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
              Jornada
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
        {/* Marco temporal + totales de cabecera (R7.3.2). */}
        <Card gap="$2">
          <XStack alignItems="center" gap="$2">
            <CalendarRange size={18} color={muted} strokeWidth={2} />
            <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
              {session ? sessionRangeLabel(session.startedAt, session.endedAt) : 'Jornada'}
            </Text>
          </XStack>
          {session ? (
            <Text fontFamily="$body" fontSize="$3" color="$textMuted">
              {session.status === 'active' ? 'Abierta · ' : ''}
              {session.animalCount === 1 ? '1 animal intervenido' : `${session.animalCount} animales intervenidos`}
            </Text>
          ) : null}
        </Card>

        {/* Conteo por tipo de evento (R7.3.1) — online. */}
        {v.showSpinner ? (
          <ReportLoading label="Cargando jornada…" />
        ) : v.showOffline ? (
          <ReportOffline onRetry={summary.reload} />
        ) : v.showError ? (
          <ReportError message={summary.error?.message} onRetry={summary.reload} />
        ) : totalEvents === 0 ? (
          <ReportEmpty
            title="Todavía no hay eventos en esta jornada"
            body="Cuando cargues maniobras en esta jornada, vas a ver acá el conteo por tipo."
          />
        ) : (
          <Card gap="$3">
            <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
              {totalEvents === 1 ? '1 evento' : `${totalEvents} eventos`}
            </Text>
            {nonZero.map((r, i) => (
              <YStack key={r.kind} gap="$3">
                {i > 0 ? <ReportDivider /> : null}
                <XStack alignItems="center" justifyContent="space-between" gap="$3">
                  <YStack flex={1} minWidth={0}>
                    <Text
                      numberOfLines={1}
                      fontFamily="$body"
                      fontSize="$4"
                      fontWeight="600"
                      color="$textPrimary"
                    >
                      {eventKindLabel(r.kind)}
                    </Text>
                    <Text fontFamily="$body" fontSize="$2" color="$textMuted">
                      {r.animals === 1 ? '1 animal' : `${r.animals} animales`}
                    </Text>
                  </YStack>
                  <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary">
                    {r.eventCount}
                  </Text>
                </XStack>
              </YStack>
            ))}
          </Card>
        )}
      </ScrollView>
    </YStack>
  );
}
