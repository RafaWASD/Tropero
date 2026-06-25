// SigsaChecklistReminder — checklist recordatorio POST-EXPORT (spec 08, T14 / R13.2, R13.3, R13.4).
//
// Tras generar el archivo y dispararse la share sheet (la dispara el service, NO esta card), el
// productor todavía tiene que COMPLETAR 4 datos EN PANTALLA en SIGSA web (no van en el TXT, R5.5).
// Esta card se lo recuerda:
//   1. RENSPA del establecimiento  — si lo tiene guardado (R13.3), se prepopula con un badge; si no,
//      muestra el aviso de completarlo (el CTA a config vive en otro run = T17, acá solo el aviso).
//   2. Especie = bovinos (MVP).
//   3. Fecha de aplicación.
//   4. Motivo de la declaración (acta de vacunación aftosa / novedad de nacimiento / reinscripción RENSPA).
// + la nota del PLAZO: "dentro de los 10 días hábiles (Art. 8°, Res. 841/2025)" (R13.4).
//
// Es un recordatorio INFORMATIVO (no un form): por eso una Card inline (no un sheet con scroll/footer) —
// el design admite "Card o sheet"; la card encaja en el flujo post-export de la pantalla sin la
// complejidad del tap-through del backdrop. El título crece sin recortarse (lineHeight matcheado).
//
// Criticidad MIXTA (oficina). Cero hardcode (ADR-023 §4): tokens; íconos lucide vía getTokenValue. es-AR.

import { Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { CheckCircle2, Clock, FileCheck2 } from 'lucide-react-native';

import { Card } from '../Card';
import { animalCountLabel } from '../../utils/sigsa-display';

export type SigsaChecklistReminderProps = {
  /** RENSPA guardado del establecimiento (R13.3). null/'' → se muestra el aviso de completarlo. */
  renspa?: string | null;
  /** Nombre del archivo recién generado (confirmación de "qué compartiste"). Opcional. */
  fileName?: string;
  /** Cuántos animales se declararon en este export (confirmación). Opcional. */
  animalCount?: number;
};

/** Un ítem numerado del checklist: número en un círculo + título + (opcional) valor/badge/aviso. */
function ChecklistItem({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <XStack alignItems="flex-start" gap="$3">
      {/* Número en círculo (slot de ancho fijo → los títulos quedan alineados). */}
      <View
        width="$icon"
        height="$icon"
        borderRadius="$pill"
        backgroundColor="$greenLight"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$primary">
          {index}
        </Text>
      </View>
      <YStack flex={1} minWidth={0} gap="$1" paddingTop="$1">
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary">
          {title}
        </Text>
        {children}
      </YStack>
    </XStack>
  );
}

export function SigsaChecklistReminder({ renspa, fileName, animalCount }: SigsaChecklistReminderProps) {
  const primary = getTokenValue('$primary', 'color');
  const muted = getTokenValue('$textMuted', 'color');
  const hasRenspa = renspa != null && renspa.trim().length > 0;

  return (
    <Card gap="$4">
      {/* Encabezado: confirmación del archivo + qué falta hacer. Título con lineHeight matcheado. */}
      <YStack gap="$2">
        <XStack alignItems="center" gap="$2">
          <FileCheck2 size={getTokenValue('$navIcon', 'size')} color={primary} strokeWidth={2} />
          <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
            Archivo generado
          </Text>
        </XStack>
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
          {typeof animalCount === 'number'
            ? `Compartí el archivo (${animalCountLabel(animalCount)}) y completá estos datos en SIGSA web:`
            : 'Compartí el archivo y completá estos datos en SIGSA web:'}
        </Text>
        {fileName ? (
          <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="500" color="$textFaint" numberOfLines={1}>
            {fileName}
          </Text>
        ) : null}
      </YStack>

      <View height={1} backgroundColor="$divider" />

      {/* Los 4 datos que el productor completa en pantalla (NO van en el TXT). */}
      <YStack gap="$3">
        <ChecklistItem index={1} title="RENSPA del establecimiento">
          {hasRenspa ? (
            // Prepoblado (R13.3): badge verde con el RENSPA guardado.
            <XStack alignItems="center" gap="$1" alignSelf="flex-start">
              <CheckCircle2 size={16} color={primary} strokeWidth={2.5} />
              <View
                backgroundColor="$greenLight"
                borderRadius="$pill"
                paddingHorizontal="$2"
                paddingVertical="$1"
              >
                <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="600" color="$primary" numberOfLines={1}>
                  {renspa!.trim()}
                </Text>
              </View>
            </XStack>
          ) : (
            // Sin RENSPA guardado: aviso (el CTA a config es de otro run = T17).
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
              Cargalo en la configuración del campo para tenerlo a mano la próxima.
            </Text>
          )}
        </ChecklistItem>

        <ChecklistItem index={2} title="Especie">
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
            Bovinos.
          </Text>
        </ChecklistItem>

        <ChecklistItem index={3} title="Fecha de aplicación">
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
            La fecha en que colocaste las caravanas.
          </Text>
        </ChecklistItem>

        <ChecklistItem index={4} title="Motivo de la declaración">
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
            Acta de vacunación aftosa, novedad de nacimiento o reinscripción RENSPA.
          </Text>
        </ChecklistItem>
      </YStack>

      {/* Nota del plazo (R13.4) — destacada en una franja, con ícono de reloj. */}
      <XStack
        alignItems="flex-start"
        gap="$2"
        backgroundColor="$bg"
        borderRadius="$card"
        paddingHorizontal="$3"
        paddingVertical="$3"
      >
        <View flexShrink={0} paddingTop="$1">
          <Clock size={18} color={muted} strokeWidth={2} />
        </View>
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted">
          Recordá declararlos dentro de los 10 días hábiles de ocurrida la novedad (Art. 8°, Res. 841/2025).
        </Text>
      </XStack>
    </Card>
  );
}
