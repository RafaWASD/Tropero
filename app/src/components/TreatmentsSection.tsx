// TreatmentsSection — sección "Tratamientos" de la ficha del animal (delta spec 02 tratamientos, RTR.9).
//
// Componente PRESENTACIONAL (architecture.md: no hace fetch ni navega): la ficha ([id].tsx) le pasa los
// tratamientos (ya leídos con fetchTreatments) + los callbacks de acción. La sección:
//   - lista los tratamientos (EN CURSO primero, RTR.9.1) con su kind/producto/comentario/estado/fecha +
//     sus aplicaciones (fecha, dosis/vía, próxima dosis — vigilancia QUÉ/CUÁNTO/CADA CUÁNTO, RTR.9.2/9.3),
//   - ofrece "Iniciar tratamiento" (RTR.1.1) — solo en animal ACTIVO (canManage, RTR.1.8),
//   - por tratamiento EN CURSO: "Registrar aplicación" (RTR.2.1) + "Finalizar tratamiento" (confirmación
//     INLINE, RTR.3.1) — solo en animal activo.
//
// Los SHEETS de iniciar/aplicar se montan al ROOT de la ficha (overlay con scrim) → esta sección solo
// dispara `onOpenStart` / `onOpenApplication(treatment)`; la ficha maneja el estado del sheet + el service +
// el refresh silencioso (optimismo en sitio). "Finalizar" es inline (sin overlay) → lo maneja acá con
// `onFinalize`. Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Syringe } from 'lucide-react-native';

import { Button } from './Button';
import { Card } from './Card';
import { InfoNote } from './AuthBits';
import { buttonA11y, labelA11y } from '../utils/a11y';
import { treatmentKindLabel, treatmentRouteLabel } from '../utils/treatment-input';
import { formatDateEsAr } from '../utils/format-date-es-ar';
import type { Treatment, TreatmentApplication } from '../services/treatments';

export type TreatmentsSectionProps = {
  /** Tratamientos del animal (en curso primero — el orden lo da fetchTreatments). */
  treatments: Treatment[];
  /** ¿Se ofrecen las acciones (iniciar/aplicar/finalizar)? = animal ACTIVO (RTR.1.8). */
  canManage: boolean;
  /** Abrir el sheet "Iniciar tratamiento" (lo monta la ficha al root). */
  onOpenStart: () => void;
  /** Abrir el sheet "Registrar aplicación" para un tratamiento EN CURSO (lo monta la ficha al root). */
  onOpenApplication: (treatment: Treatment) => void;
  /** Finalizar un tratamiento (la ficha llama al service + refresca). Devuelve ok/error para el inline. */
  onFinalize: (treatmentId: string) => Promise<{ ok: boolean; error?: string }>;
};

/** Formatea una dosis en ml al display es-AR (coma decimal): 5 → "5 ml", 5.5 → "5,5 ml". */
function formatDoseMl(doseMl: number | null): string | null {
  if (doseMl == null) return null;
  const n = Number.isInteger(doseMl) ? String(doseMl) : String(doseMl).replace('.', ',');
  return `${n} ml`;
}

export function TreatmentsSection({
  treatments,
  canManage,
  onOpenStart,
  onOpenApplication,
  onFinalize,
}: TreatmentsSectionProps) {
  const primary = getTokenValue('$primary', 'color');

  // Un animal archivado SIN tratamientos no muestra la sección (nada que vigilar ni que iniciar).
  if (treatments.length === 0 && !canManage) return null;

  return (
    <Card gap="$3">
      {/* Header de sección (firma RAFAQ: greenLight + $primary, consistente con las otras DetailSection). */}
      <XStack alignItems="center" gap="$2">
        <View
          width={28}
          height={28}
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
        >
          <Syringe size={16} color={primary} strokeWidth={2.5} />
        </View>
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          Tratamientos
        </Text>
      </XStack>

      <YStack gap="$3">
        {treatments.length === 0 ? (
          <InfoNote>Este animal todavía no tiene tratamientos registrados.</InfoNote>
        ) : (
          treatments.map((t) => (
            <TreatmentCard
              key={t.id}
              treatment={t}
              canManage={canManage}
              onRegister={() => onOpenApplication(t)}
              onFinalize={onFinalize}
            />
          ))
        )}

        {/* CTA "Iniciar tratamiento" (RTR.1.1) — solo en animal ACTIVO (RTR.1.8). */}
        {canManage ? (
          <Button variant="secondary" fullWidth onPress={onOpenStart}>
            Iniciar tratamiento
          </Button>
        ) : null}
      </YStack>
    </Card>
  );
}

/** Badge de estado del tratamiento: EN CURSO (teal sanitario) / FINALIZADO (neutro). RTR.9.2. */
function TreatmentStatusBadge({ inProgress }: { inProgress: boolean }) {
  if (inProgress) {
    return (
      <View
        backgroundColor="$treatmentBg"
        borderRadius="$pill"
        paddingHorizontal="$2"
        paddingVertical="$1"
        alignSelf="flex-start"
        {...labelA11y(Platform.OS, 'En curso')}
      >
        <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="700" color="$treatmentText">
          En curso
        </Text>
      </View>
    );
  }
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$2"
      paddingVertical="$1"
      alignSelf="flex-start"
      {...labelA11y(Platform.OS, 'Finalizado')}
    >
      <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color="$textMuted">
        Finalizado
      </Text>
    </View>
  );
}

/** Una card de tratamiento con sus aplicaciones + (si en curso + activo) las acciones. */
function TreatmentCard({
  treatment,
  canManage,
  onRegister,
  onFinalize,
}: {
  treatment: Treatment;
  canManage: boolean;
  onRegister: () => void;
  onFinalize: (treatmentId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const showActions = canManage && treatment.inProgress;

  const doFinalize = async () => {
    setFinishing(true);
    setFinishError(null);
    const r = await onFinalize(treatment.id);
    setFinishing(false);
    if (r.ok) {
      setConfirmingFinish(false);
    } else {
      setFinishError(r.error ?? 'No pudimos finalizar el tratamiento.');
    }
  };

  return (
    <YStack
      gap="$2"
      backgroundColor="$bg"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$card"
      padding="$3"
    >
      {/* Encabezado de la card: producto (hero) + estado. */}
      <XStack alignItems="center" gap="$2" justifyContent="space-between">
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="700"
          color="$textPrimary"
          numberOfLines={1}
          flexShrink={1}
          minWidth={0}
        >
          {treatment.productName}
        </Text>
        <TreatmentStatusBadge inProgress={treatment.inProgress} />
      </XStack>

      {/* Tipo + fechas. */}
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {treatmentKindLabel(treatment.kind)} · Inicio {formatDateEsAr(treatment.startedAt)}
        {treatment.endedAt ? ` · Fin ${formatDateEsAr(treatment.endedAt)}` : ''}
      </Text>

      {/* Comentario. */}
      {treatment.notes ? (
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
          {treatment.notes}
        </Text>
      ) : null}

      {/* Aplicaciones (RTR.9.3): fecha, dosis/vía, próxima dosis. */}
      {treatment.applications.length > 0 ? (
        <YStack gap="$1" paddingTop="$1">
          <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textFaint">
            {treatment.applications.length === 1
              ? '1 aplicación'
              : `${treatment.applications.length} aplicaciones`}
          </Text>
          {treatment.applications.map((a) => (
            <ApplicationRow key={a.id} application={a} />
          ))}
        </YStack>
      ) : null}

      {/* Acciones (solo EN CURSO + activo). */}
      {showActions ? (
        <YStack gap="$2" paddingTop="$1">
          <Button variant="secondary" fullWidth onPress={onRegister}>
            Registrar aplicación
          </Button>

          {confirmingFinish ? (
            <YStack gap="$2">
              <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
                ¿Finalizar este tratamiento? El animal deja de estar en tratamiento.
              </Text>
              {finishError ? (
                <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
                  {finishError}
                </Text>
              ) : null}
              <XStack gap="$2">
                <View flex={1}>
                  <Button variant="primary" fullWidth disabled={finishing} onPress={() => void doFinalize()}>
                    {finishing ? 'Finalizando…' : 'Finalizar'}
                  </Button>
                </View>
                <View flex={1}>
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={finishing}
                    onPress={() => {
                      setConfirmingFinish(false);
                      setFinishError(null);
                    }}
                  >
                    Cancelar
                  </Button>
                </View>
              </XStack>
            </YStack>
          ) : (
            <Pressable
              onPress={() => setConfirmingFinish(true)}
              {...buttonA11y(Platform.OS, { label: 'Finalizar tratamiento' })}
            >
              <Text
                fontFamily="$body"
                fontSize="$4"
                fontWeight="600"
                color="$treatmentText"
                textAlign="center"
              >
                Finalizar tratamiento
              </Text>
            </Pressable>
          )}
        </YStack>
      ) : null}
    </YStack>
  );
}

/** Una fila de aplicación: fecha · dosis · vía + (si está) próxima dosis. RTR.9.3. */
function ApplicationRow({ application }: { application: TreatmentApplication }) {
  const dose = formatDoseMl(application.doseMl);
  const route = application.route ? treatmentRouteLabel(application.route) : null;
  const parts = [formatDateEsAr(application.eventDate), dose, route].filter(
    (p): p is string => p != null && p.length > 0,
  );
  return (
    <YStack gap="$1">
      <XStack alignItems="center" gap="$2">
        <View width={getTokenValue('$dot', 'size')} height={getTokenValue('$dot', 'size')} borderRadius="$pill" backgroundColor="$treatmentText" />
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textPrimary" flexShrink={1} minWidth={0}>
          {parts.join(' · ')}
        </Text>
      </XStack>
      {application.nextDoseDate ? (
        <Text fontFamily="$body" fontSize="$2" fontWeight="400" color="$textFaint" paddingLeft="$4">
          Próxima dosis: {formatDateEsAr(application.nextDoseDate)}
        </Text>
      ) : null}
    </YStack>
  );
}
