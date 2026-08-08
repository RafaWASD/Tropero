// CampaignStateBar — la barra de ESTADO DE CAMPAÑA de la pantalla de reportes (delta campañas congeladas,
// RCC.10.1/10.2/10.9/10.11). Va inmediatamente debajo del selector de campaña y ENCIMA de los números: es
// el marco de interpretación de todo lo que viene abajo. Nadie debería ver un 89 % sin saber antes si es
// una foto o un número vivo.
//
// Componente PRESENTACIONAL: no hace fetch ni decide nada. TODA la lógica (qué badge, qué título, qué
// aviso, qué acción) sale de `campaignStateView` (`utils/reports-format.ts`), que es pura y testeada
// (RCC.10.3) — acá no hay un solo `if` de negocio.
//
// Cero hardcode (ADR-023 §4): tokens. Copys en sentence-case, fechas es-AR (las arma la función pura).
// Anti-recorte de descendentes: `lineHeight` matcheado en TODO texto con `fontSize` (el título tiene "p"
// y "g" — "Campaña cerrada a medias").

import { Platform, Pressable } from 'react-native';
import { Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { Camera, HelpCircle, Radio } from 'lucide-react-native';

import { Button } from '../Button';
import { buttonA11y, labelA11y } from '../../utils/a11y';
import type { CampaignStateView } from '../../utils/reports-format';

export type CampaignStateBarProps = {
  /** La vista YA derivada por `campaignStateView` (pura). */
  view: CampaignStateView;
  /** Cerrar la campaña (solo si `view.primaryAction === 'close'`). */
  onClose?: () => void;
  /** Reabrir la campaña (solo si `view.primaryAction === 'reopen'`). */
  onReopen?: () => void;
  /** true mientras corre una acción de escritura → deshabilita el botón. */
  busy?: boolean;
};

/** Color del borde/acento según el tono de la vista. Un solo lugar que traduce tono → token. */
function toneColor(tone: CampaignStateView['tone']): '$terracota' | '$primary' | '$divider' {
  if (tone === 'warning') return '$terracota';
  if (tone === 'info') return '$primary';
  return '$divider';
}

export function CampaignStateBar({ view, onClose, onReopen, busy = false }: CampaignStateBarProps) {
  const closed = view.badge === 'cerrada' || view.badge === 'cerrada-a-medias';
  // `desconocido` = todavía no sabemos si es foto o número vivo: el título va ATENUADO y con un ícono que no
  // afirma ninguno de los dos estados. Sin fecha, sin aviso y sin acciones (la vista pura ya lo garantiza).
  const unknown = view.badge === 'desconocido';
  const accent = toneColor(view.tone);
  const iconColor = getTokenValue(view.tone === 'warning' ? '$terracota' : '$textMuted', 'color');

  return (
    <YStack
      testID="campaign-state-bar"
      width="100%"
      backgroundColor="$surface"
      borderRadius="$card"
      borderWidth={1}
      borderColor={accent}
      paddingHorizontal="$4"
      paddingVertical="$3"
      gap="$2"
      {...labelA11y(Platform.OS, `${view.title}${view.detail ? `. ${view.detail}` : ''}`)}
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <XStack alignItems="center" gap="$2" flex={1} minWidth={0}>
          {unknown ? (
            <HelpCircle size={18} color={iconColor} strokeWidth={2} />
          ) : closed ? (
            <Camera size={18} color={iconColor} strokeWidth={2} />
          ) : (
            <Radio size={18} color={iconColor} strokeWidth={2} />
          )}
          <Text
            testID="campaign-state-title"
            fontFamily="$body"
            fontSize="$5"
            lineHeight="$5"
            fontWeight="700"
            color={unknown ? '$textMuted' : '$textPrimary'}
            flex={1}
            minWidth={0}
          >
            {view.title}
          </Text>
        </XStack>
      </XStack>

      {view.detail ? (
        <Text
          testID="campaign-state-detail"
          fontFamily="$body"
          fontSize="$3"
          lineHeight="$3"
          fontWeight="500"
          color="$textMuted"
        >
          {view.detail}
        </Text>
      ) : null}

      {/* El aviso se renderiza SIEMPRE que exista, tenga o no permiso el usuario para actuar: "cerrada a
          medias" y "hay datos nuevos" son información del REPORTE, no acciones (RCC.10.11).
          SIN BORDE PROPIO (Gate 2.5): la tarjeta ya lleva el borde de severidad, y un recuadro con borde
          adentro de otro con borde —los dos en el mismo color— duplica la señal sin agregar información. */}
      {view.notice ? (
        <View
          testID="campaign-state-notice"
          width="100%"
          backgroundColor="$bg"
          borderRadius="$card"
          paddingHorizontal="$3"
          paddingVertical="$3"
        >
          <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="500" color="$textPrimary">
            {view.notice}
          </Text>
        </View>
      ) : null}

      {/* CERRAR es la acción que la app QUIERE (D1: cuando el ciclo termina, la sugiere) → botón. */}
      {view.primaryAction === 'close' ? (
        <Button
          testID="campaign-close-btn"
          variant="secondary"
          fullWidth
          disabled={busy}
          onPress={onClose}
        >
          Cerrar campaña
        </Button>
      ) : null}

      {/* REABRIR va en BAJA JERARQUÍA (Gate 2.5), y la asimetría con "Cerrar" es deliberada. Sobre una
          campaña cerrada la acción frecuente es LEERLA; reabrir es rara y semi-destructiva (des-congela un
          registro que ADR-032 declara inmutable). Como botón a ancho completo era el elemento interactivo
          más grande de la pantalla: la tarjeta afirmaba "esto es una foto que no se mueve" y titulaba el
          deshacer. Queda como acción de texto, alineada a la derecha, sin competir con los números — pero
          con target real: `$chipMin` (40) + `hitSlop` 8 → ≥ 56 dp de área tappable. */}
      {view.primaryAction === 'reopen' ? (
        <XStack justifyContent="flex-end" width="100%">
          <Pressable
            testID="campaign-reopen-btn"
            onPress={busy ? undefined : onReopen}
            hitSlop={8}
            {...buttonA11y(Platform.OS, { label: 'Reabrir campaña', disabled: busy })}
          >
            <XStack minHeight="$chipMin" alignItems="center" paddingHorizontal="$2">
              <Text
                fontFamily="$body"
                fontSize="$4"
                lineHeight="$5"
                fontWeight="600"
                color={busy ? '$textMuted' : '$primary'}
              >
                Reabrir campaña
              </Text>
            </XStack>
          </Pressable>
        </XStack>
      ) : null}
    </YStack>
  );
}
