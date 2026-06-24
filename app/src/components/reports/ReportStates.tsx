// ReportStates — estados de alto impacto de los reportes (spec 07 Stream C — FRONTEND, design §6).
// Donde se gana o pierde la percepción de calidad: VACÍO (invita), OFFLINE (online-only → "necesitás
// conexión", claro), ERROR (accionable, con reintentar), LOADING (spinner sólo en primera carga).
//
// Cero hardcode (ADR-023 §4): tokens. Sin fetch (architecture.md: los componentes no tocan I/O).

import { ActivityIndicator, Platform, Pressable } from 'react-native';
import { Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { CloudOff, RefreshCw, Inbox } from 'lucide-react-native';

import { buttonA11y } from '../../utils/a11y';

// ─── Loading (spinner centrado, sólo en primera carga sin datos — design §4) ─────────────────────────

export function ReportLoading({ label = 'Cargando…' }: { label?: string }) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <YStack alignItems="center" justifyContent="center" paddingVertical="$6" gap="$3">
      <ActivityIndicator color={primary} />
      <Text fontFamily="$body" fontSize="$3" color="$textMuted">
        {label}
      </Text>
    </YStack>
  );
}

// ─── Estado OFFLINE (online-only, R7.2.2) ────────────────────────────────────────────────────────────

/**
 * Estado "necesitás conexión para ver reportes" (R7.2.2): mensaje accionable (no spinner infinito ni
 * stack trace). Botón "reintentar" por si la señal volvió. Ícono de nube tachada para que se lea de un
 * vistazo que es un tema de conexión, no un error de la app.
 */
export function ReportOffline({ onRetry }: { onRetry?: () => void }) {
  return (
    <ReportStateCard
      icon="offline"
      title="Necesitás conexión"
      body="Los reportes se calculan en línea. Conectate a internet y volvé a intentar."
      actionLabel={onRetry ? 'Reintentar' : undefined}
      onAction={onRetry}
    />
  );
}

// ─── Estado ERROR (accionable + reintento, R7.2.4) ───────────────────────────────────────────────────

export function ReportError({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  return (
    <ReportStateCard
      icon="error"
      title="No se pudo cargar"
      body={message && message.trim().length > 0 ? message : 'Reintentá en un momento.'}
      actionLabel={onRetry ? 'Reintentar' : undefined}
      onAction={onRetry}
    />
  );
}

// ─── Estado VACÍO (cálido, invita — R7.3.5/R7.7.4/R7.10.4/R7.11.5) ───────────────────────────────────

/**
 * Empty state cálido y específico. `tone='positive'` (alertas resueltas: "no hay dosis vencidas") usa el
 * verde de marca; el default es neutro (sin datos aún → invita). NO muestra "0" crudo ni error.
 */
export function ReportEmpty({
  title,
  body,
  tone = 'neutral',
}: {
  title: string;
  body?: string;
  tone?: 'neutral' | 'positive';
}) {
  return <ReportStateCard icon={tone === 'positive' ? 'ok' : 'empty'} title={title} body={body} tone={tone} />;
}

// ─── Card base de estado ─────────────────────────────────────────────────────────────────────────────

function ReportStateCard({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  tone = 'neutral',
}: {
  icon: 'offline' | 'error' | 'empty' | 'ok';
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'positive';
}) {
  const muted = getTokenValue('$textMuted', 'color');
  const terracota = getTokenValue('$terracota', 'color');
  const primary = getTokenValue('$primary', 'color');

  const iconColor = icon === 'error' ? terracota : icon === 'ok' ? primary : muted;

  return (
    <YStack
      width="100%"
      backgroundColor="$surface"
      borderRadius="$card"
      borderWidth={1}
      borderColor={tone === 'positive' ? '$primary' : '$divider'}
      paddingHorizontal="$4"
      paddingVertical="$5"
      alignItems="center"
      gap="$3"
    >
      <View
        width={48}
        height={48}
        borderRadius="$pill"
        backgroundColor={tone === 'positive' ? '$greenLight' : '$bg'}
        alignItems="center"
        justifyContent="center"
      >
        {icon === 'offline' ? (
          <CloudOff size={24} color={iconColor} strokeWidth={2} />
        ) : (
          <Inbox size={24} color={iconColor} strokeWidth={2} />
        )}
      </View>
      <YStack alignItems="center" gap="$1">
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="700"
          color="$textPrimary"
          textAlign="center"
        >
          {title}
        </Text>
        {body ? (
          <Text fontFamily="$body" fontSize="$3" color="$textMuted" textAlign="center">
            {body}
          </Text>
        ) : null}
      </YStack>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} {...buttonA11y(Platform.OS, { label: actionLabel })}>
          <XStack
            alignItems="center"
            gap="$2"
            minHeight="$chipMin"
            paddingHorizontal="$4"
            borderRadius="$pill"
            borderWidth={2}
            borderColor="$primary"
            pressStyle={{ backgroundColor: '$bg' }}
          >
            <RefreshCw size={18} color={primary} strokeWidth={2} />
            <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
              {actionLabel}
            </Text>
          </XStack>
        </Pressable>
      ) : null}
    </YStack>
  );
}
