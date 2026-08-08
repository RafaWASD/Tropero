// CampaignCloseSheet — confirmación del CIERRE de campaña (delta campañas congeladas, RCC.10.7/10.7.a/b,
// RCC.10.6). Bottom-sheet moldeado sobre `BulkConfirmSheet` (spec 10): mismo shell (scrim + hoja anclada
// abajo + grip + `useSafeBottomInset` + CONFIRMAR/Volver), mismo tono de copy reversible.
//
// ⚠ POR QUÉ NO SE REUSA `BulkConfirmSheet` TAL CUAL (reconciliación de T64): sus props son de dominio de la
// operación masiva de animales — `operation: 'castrate' | 'wean' | …` y `summary: SelectionSummary` (total,
// desglose POR CATEGORÍA, futuros toritos, overrides). Acá no hay animales seleccionados ni categorías: hay
// una campaña, un año y una lista de lo que falta. Para reusarlo habría que inventar una `SelectionSummary`
// falsa y agregarle una operación que no es una operación masiva — degradando los dos componentes. Se copia
// la ESTRUCTURA, que es lo que el molde aporta.
//
// Componente PRESENTACIONAL: la máquina de estados (primer intento sin reconocimiento → si vuelve
// `conflict`, habilitar el reconocimiento) vive en la pantalla. Acá solo se dibuja lo que se recibe.
//
// Cero hardcode (ADR-023 §4): tokens. Copys sentence-case, voseo. `lineHeight` matcheado en todo texto con
// descendentes ("Cerrar campaña", "Cerrar igual con estos datos incompletos").

import { Platform, Pressable } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { AlertTriangle, Camera } from 'lucide-react-native';

import { Button } from '../Button';
import { Card } from '../Card';
import { campaignCloseActions, type CampaignCloseActionId } from '../../utils/reports-format';
import { useDismissKeyboardOnOpen } from '../../hooks/useDismissKeyboardOnOpen';
import { useSafeBottomInset } from '../../hooks/useSafeBottomInset';
import { buttonA11y } from '../../utils/a11y';
import type { BulkCloseResult } from '../../hooks/use-reports';

export type CampaignCloseSheetProps = {
  year: number;
  rodeoName: string;
  /** RCC.10.7.b: con el ciclo completo NO se pide la confirmación adicional (el cierre es un toque). */
  cycleComplete: boolean;
  /** Lo que falta HOY para completar el ciclo, ya en es-AR ("2 preñadas sin parir"). */
  missing: string[];
  /**
   * El server YA rechazó este cierre por ciclo incompleto (`23514` reconocible) → recién ahora se ofrece la
   * segunda acción. Nunca se ofrece de entrada: el reconocimiento se paga solo cuando hay algo que
   * reconocer (RCC.10.7.a).
   */
  acknowledgeAvailable: boolean;
  busy?: boolean;
  /** Cantidad de rodeos del campo. > 1 → se ofrece el cierre masivo (RCC.10.6). */
  rodeoCount?: number;
  /** Resultado de la última pasada del cierre masivo (para el desglose por rodeo). */
  bulkResult?: BulkCloseResult | null;
  /** Cierra ESTE rodeo. `acknowledge` viaja explícito (§7.1: sin defaults en ningún eslabón). */
  onConfirm: (acknowledge: boolean) => void;
  /** Cierra la campaña del año en TODOS los rodeos del campo, en dos pasadas (RCC.5.10.a). */
  onCloseAll?: (acknowledge: boolean) => void;
  onCancel: () => void;
};

/** `kind`/`id` → testID estable para el capture y la E2E. Un solo lugar. */
const ACTION_TEST_IDS: Record<CampaignCloseActionId, string> = {
  close: 'campaign-confirm-primary',
  'close-ack': 'campaign-confirm-ack',
  'close-all': 'campaign-confirm-bulk',
  'close-all-ack': 'campaign-confirm-bulk-ack',
  cancel: 'campaign-confirm-cancel',
};

export function CampaignCloseSheet({
  year,
  rodeoName,
  cycleComplete,
  missing,
  acknowledgeAvailable,
  busy = false,
  rodeoCount = 1,
  bulkResult = null,
  onConfirm,
  onCloseAll,
  onCancel,
}: CampaignCloseSheetProps) {
  // ABRIR EL SHEET BAJA EL TECLADO (guard de clase `sheet-keyboard-dismiss-guard`): esta hoja se MONTA al
  // abrirse, así que va con el default (el flanco cerrado→abierto es el del montaje). Hoy la pantalla de
  // reportes no tiene ningún input de texto arriba, pero el invariante es de clase: el día que lo tenga —o
  // que alguien copie este sheet a una pantalla que sí lo tiene— el teclado taparía los CTAs y en web no se
  // vería (react-native-web no monta teclado virtual).
  useDismissKeyboardOnOpen();

  const bottomPad = useSafeBottomInset({ floor: getTokenValue('$6', 'space') });
  const terracota = getTokenValue('$terracota', 'color');
  const mutedColor = getTokenValue('$textMuted', 'color');
  const actions = campaignCloseActions({
    cycleComplete,
    acknowledgeAvailable,
    rodeoCount: typeof onCloseAll === 'function' ? rodeoCount : 1,
    incompleteCount: bulkResult ? bulkResult.incomplete.length : 0,
    busy,
  });

  return (
    <View
      testID="campaign-confirm-sheet"
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onCancel}
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
      >
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        <XStack alignItems="center" gap="$2">
          <Camera size={22} color={mutedColor} strokeWidth={2} />
          <Text
            fontFamily="$body"
            fontSize="$8"
            lineHeight="$8"
            fontWeight="700"
            color="$textPrimary"
            flex={1}
            minWidth={0}
          >
            Cerrar campaña
          </Text>
        </XStack>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: getTokenValue('$3', 'space') }}
        >
          <Card gap="$2">
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary">
              Vas a cerrar la campaña {year} de {rodeoName}.
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="400" color="$textMuted">
              Los números quedan congelados: dejan de moverse con cada dato nuevo.
            </Text>
            {/* Copy REVERSIBLE (mismo criterio que BulkConfirmSheet: nunca "no se puede deshacer"). */}
            <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="400" color="$textMuted">
              Podés reabrirla mientras no cierres la campaña {year + 1}.
            </Text>
          </Card>

          {/* RCC.10.7.a: con el ciclo incompleto, la hoja ENUMERA qué falta. Con el ciclo completo no
              aparece nada de esto y el cierre es UN TOQUE (RCC.10.7.b): la fricción se paga solo cuando hay
              algo que reconocer. */}
          {!cycleComplete && missing.length > 0 ? (
            <YStack
              testID="campaign-confirm-missing"
              gap="$2"
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$terracota"
              borderRadius="$card"
              paddingHorizontal="$3"
              paddingVertical="$3"
            >
              <XStack alignItems="center" gap="$2">
                <AlertTriangle size={20} color={terracota} strokeWidth={2.5} />
                <Text
                  fontFamily="$body"
                  fontSize="$4"
                  lineHeight="$4"
                  fontWeight="700"
                  color="$terracota"
                  flex={1}
                  minWidth={0}
                >
                  El ciclo de esta campaña no terminó
                </Text>
              </XStack>
              <YStack gap="$1">
                {missing.map((m) => (
                  <XStack key={m} alignItems="center" gap="$2">
                    <View
                      width={getTokenValue('$dot', 'size')}
                      height={getTokenValue('$dot', 'size')}
                      borderRadius="$pill"
                      backgroundColor="$terracota"
                    />
                    <Text
                      fontFamily="$body"
                      fontSize="$4"
                      lineHeight="$4"
                      fontWeight="600"
                      color="$textPrimary"
                    >
                      {m}
                    </Text>
                  </XStack>
                ))}
              </YStack>
              <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="400" color="$textMuted">
                Si cerrás igual, esos datos no van a entrar en el reporte de esta campaña nunca más.
              </Text>
            </YStack>
          ) : null}

          {/* Desglose del cierre masivo, cuando ya corrió una pasada (RCC.10.6: la falla parcial es visible). */}
          {bulkResult ? (
            <YStack
              testID="campaign-bulk-result"
              gap="$2"
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$divider"
              borderRadius="$card"
              paddingHorizontal="$3"
              paddingVertical="$3"
            >
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$textPrimary">
                {bulkResult.ok.length === 1
                  ? 'Se cerró 1 rodeo'
                  : `Se cerraron ${bulkResult.ok.length} rodeos`}
              </Text>
              {bulkResult.ok.map((name) => (
                <Text key={`ok-${name}`} fontFamily="$body" fontSize="$3" lineHeight="$4" color="$textMuted">
                  {name}
                </Text>
              ))}
              {bulkResult.incomplete.map((r) => (
                <Text
                  key={`inc-${r.id}`}
                  fontFamily="$body"
                  fontSize="$3"
                  lineHeight="$4"
                  fontWeight="600"
                  color="$terracota"
                >
                  {r.name}: {r.missing.join(' · ')}
                </Text>
              ))}
              {bulkResult.failed.map((r) => (
                <Text
                  key={`fail-${r.name}`}
                  fontFamily="$body"
                  fontSize="$3"
                  lineHeight="$4"
                  fontWeight="500"
                  color="$textMuted"
                >
                  {r.name}: {r.message}
                </Text>
              ))}
            </YStack>
          ) : null}
        </ScrollView>

        {/* Los controles y su PESO VISUAL salen de `campaignCloseActions` (pura y testeada): acá solo se
            mapea `kind` → variante. El invariante que eso sostiene —tras un rechazo del server no queda
            ningún control primario, y el intento que falló desaparece— no puede romperse editando este
            archivo sin poner en rojo la unit. */}
        <YStack gap="$2">
          {actions.map((a, i) => {
            const prevAck = i > 0 ? actions[i - 1].acknowledge === true : false;
            const startsAckBlock = a.acknowledge === true && !prevAck;
            const onPress = () => {
              if (a.id === 'cancel') return onCancel();
              if (a.id === 'close' || a.id === 'close-ack') return onConfirm(a.acknowledge === true);
              return onCloseAll?.(a.acknowledge === true);
            };
            return (
              <YStack
                key={a.id}
                testID={startsAckBlock ? 'campaign-confirm-ack-block' : undefined}
                gap="$2"
                marginTop={startsAckBlock ? '$2' : undefined}
                paddingTop={startsAckBlock ? '$3' : undefined}
                borderTopWidth={startsAckBlock ? 1 : undefined}
                borderTopColor={startsAckBlock ? '$divider' : undefined}
              >
                {startsAckBlock ? (
                  <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="500" color="$textMuted">
                    No se pudo cerrar con los datos que faltan. Si igual querés congelarla así, decilo
                    explícitamente:
                  </Text>
                ) : null}
                <Button
                  testID={ACTION_TEST_IDS[a.id]}
                  variant={a.kind === 'primary' ? 'primary' : 'secondary'}
                  fullWidth
                  disabled={busy}
                  onPress={onPress}
                >
                  {a.label}
                </Button>
              </YStack>
            );
          })}
        </YStack>
      </YStack>
    </View>
  );
}
