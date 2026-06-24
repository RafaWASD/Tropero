// app/reportes/sesiones.tsx — LISTA de sesiones de un rodeo (spec 07 Stream C, R7.3.6 / T7.1). Punto de
// entrada al "Resumen de sesión": el usuario elige una sesión → ve su detalle (reportes/sesion/[id]).
//
// ONLINE-ONLY (R7.2): la lista viene de la RPC `rodeo_sessions_list` (tenant-scopeada). Offline → estado
// claro. Multi-tenant: el `rodeoId` llega por params (de la tab Reportes, que ya scopea por campo activo);
// la RPC re-valida el tenant server-side (has_role_in).
//
// Cero hardcode (ADR-023 §4): tokens + componentes.

import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';

import { Card } from '@/components';
import { ReportLoading, ReportOffline, ReportError, ReportEmpty } from '@/components/reports';
import { useRodeoSessions, reportView } from '@/hooks/use-reports';
import { sessionRangeLabel } from '@/utils/reports-format';
import { buttonA11y } from '@/utils/a11y';

export default function SesionesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ rodeoId?: string; name?: string }>();
  const rodeoId = typeof params.rodeoId === 'string' ? params.rodeoId : null;
  const rodeoName = typeof params.name === 'string' ? params.name : '';
  const muted = getTokenValue('$textMuted', 'color');

  const sessions = useRodeoSessions(rodeoId);
  const v = reportView(sessions);

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => router.back()} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
              Sesiones
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
        {v.showSpinner ? (
          <ReportLoading label="Cargando sesiones…" />
        ) : v.showOffline ? (
          <ReportOffline onRetry={sessions.reload} />
        ) : v.showError ? (
          <ReportError message={sessions.error?.message} onRetry={sessions.reload} />
        ) : (sessions.data ?? []).length === 0 ? (
          <ReportEmpty
            title="Todavía no hay jornadas"
            body="Cuando hagas una maniobra en este rodeo, vas a poder ver el resumen de la jornada acá."
          />
        ) : (
          <Card gap="$1">
            {(sessions.data ?? []).map((s, i) => (
              <YStack key={s.id}>
                {i > 0 ? <View height={1} backgroundColor="$divider" /> : null}
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/reportes/sesion/[id]',
                      params: { id: s.id, name: rodeoName },
                    })
                  }
                  {...buttonA11y(Platform.OS, {
                    label: `Ver resumen de la jornada del ${sessionRangeLabel(s.startedAt, s.endedAt)}`,
                  })}
                >
                  <XStack alignItems="center" gap="$3" minHeight="$animalRow" pressStyle={{ opacity: 0.6 }}>
                    <YStack flex={1} minWidth={0} gap="$1">
                      <Text
                        numberOfLines={1}
                        fontFamily="$body"
                        fontSize="$4"
                        fontWeight="600"
                        color="$textPrimary"
                      >
                        {sessionRangeLabel(s.startedAt, s.endedAt)}
                      </Text>
                      <Text numberOfLines={1} fontFamily="$body" fontSize="$2" color="$textMuted">
                        {s.status === 'active' ? 'Abierta · ' : ''}
                        {s.animalCount === 1 ? '1 animal' : `${s.animalCount} animales`} ·{' '}
                        {s.eventCount === 1 ? '1 evento' : `${s.eventCount} eventos`}
                        {s.workLotLabel ? ` · ${s.workLotLabel}` : ''}
                      </Text>
                    </YStack>
                    <ChevronRight size={20} color={muted} strokeWidth={2} />
                  </XStack>
                </Pressable>
              </YStack>
            ))}
          </Card>
        )}
      </ScrollView>
    </YStack>
  );
}
