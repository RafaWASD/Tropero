// BulkProgressPanel — estado de PROGRESO de una operación masiva tras CONFIRMAR (spec 10, T-UI.5 /
// R10.3, R10.4). Componente PRESENTACIONAL (no hace fetch — architecture.md): la pantalla corre el
// service (bulk-operations) y le pasa la fase + los números + los rechazos.
//
// Fases:
//   - 'enqueuing' → "Generando X de N…" (el ENCOLADO local; barra de progreso).
//   - 'done'      → "N animales encolados. Se sincronizan en segundo plano." + rechazos LOCALES por
//                   animal (raros) si los hubo (R10.3). El "X de N SINCRONIZADOS" por animal lo
//                   superficia uploadData as-built (spec 15) en el indicador global de sync — NO acá
//                   (este panel reporta el ENCOLADO, que es lo que el operario espera ver de inmediato).
//   - 'error'     → algo falló ANTES de encolar (no se pudo armar el plan): mensaje es-AR + reintentar.
//
// Offline-first: encolar SIEMPRE funciona sin red; la sync ocurre después. Cero hardcode (ADR-023 §4):
// tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { CheckCircle2, AlertCircle } from 'lucide-react-native';

import { Button } from './Button';
import { Card } from './Card';

export type BulkProgressPhase = 'enqueuing' | 'done' | 'error';

export type BulkProgressRejection = { label: string; message: string };

export type BulkProgressPanelProps = {
  phase: BulkProgressPhase;
  /** Verbo es-AR de la operación ("Castrando" / "Destetando") para el título de la fase enqueuing. */
  verbGerund: string;
  /** Animales encolados hasta ahora (X). */
  done: number;
  /** Total de animales a mutar (N). */
  total: number;
  /** Rechazos LOCALES por animal (R10.3): etiqueta legible del animal + motivo. Vacío = todo encolado. */
  rejections: BulkProgressRejection[];
  /** Mensaje de error es-AR (solo phase='error'). */
  errorMessage?: string | null;
  /** "Listo" (done) → volver a la vista de grupo. */
  onDone: () => void;
  /** "Reintentar" (error) → re-disparar el aplicado. */
  onRetry?: () => void;
};

export function BulkProgressPanel({
  phase,
  verbGerund,
  done,
  total,
  rejections,
  errorMessage,
  onDone,
  onRetry,
}: BulkProgressPanelProps) {
  const primary = getTokenValue('$primary', 'color');
  const terracota = getTokenValue('$terracota', 'color');

  if (phase === 'error') {
    return (
      <YStack flex={1} width="100%" justifyContent="center" gap="$4" paddingHorizontal="$4">
        <XStack alignItems="center" gap="$2">
          <AlertCircle size={28} color={terracota} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$7" fontWeight="700" color="$textPrimary">
            No pudimos aplicar
          </Text>
        </XStack>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
          {errorMessage ?? 'Probá de nuevo en unos segundos.'}
        </Text>
        {onRetry ? (
          <Button variant="primary" fullWidth onPress={onRetry}>
            Reintentar
          </Button>
        ) : null}
      </YStack>
    );
  }

  const allEnqueued = phase === 'done';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <YStack flex={1} width="100%" justifyContent="center" gap="$5" paddingHorizontal="$4">
      <YStack gap="$3" alignItems="center">
        {allEnqueued ? (
          <CheckCircle2 size={getTokenValue('$icon', 'size')} color={primary} strokeWidth={2.5} />
        ) : null}
        <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary" textAlign="center">
          {allEnqueued
            ? `${total} ${total === 1 ? 'animal listo' : 'animales listos'}`
            : `${verbGerund} ${done} de ${total}…`}
        </Text>
        {allEnqueued ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" textAlign="center">
            Se están sincronizando en segundo plano. Podés seguir trabajando, no hace falta señal.
          </Text>
        ) : null}
      </YStack>

      {/* Barra de progreso del encolado. */}
      <View width="100%" height={getTokenValue('$progressTrack', 'size')} borderRadius="$pill" backgroundColor="$divider" overflow="hidden">
        <View width={`${allEnqueued ? 100 : pct}%`} height="100%" backgroundColor="$primary" />
      </View>

      {/* Rechazos LOCALES por animal (R10.3), si los hubo. */}
      {allEnqueued && rejections.length > 0 ? (
        <Card gap="$2">
          <XStack alignItems="center" gap="$2">
            <AlertCircle size={18} color={terracota} strokeWidth={2.5} />
            <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$terracota">
              {rejections.length === 1
                ? '1 animal no se pudo encolar'
                : `${rejections.length} animales no se pudieron encolar`}
            </Text>
          </XStack>
          <YStack gap="$1">
            {rejections.map((r) => (
              <Text key={r.label} fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
                {r.label}: {r.message}
              </Text>
            ))}
          </YStack>
        </Card>
      ) : null}

      {allEnqueued ? (
        <Button variant="primary" fullWidth onPress={onDone}>
          Listo
        </Button>
      ) : null}
    </YStack>
  );
}
