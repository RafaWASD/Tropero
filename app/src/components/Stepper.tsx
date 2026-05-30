// Stepper — riel vertical de pasos del wizard (derivado de la home, A.1 / ADR-023).
//
// Resuelve el desalineo del mockup viejo (asimetría card/plano): TODOS los círculos
// tienen el MISMO diámetro y están centrados sobre una única línea conectora
// vertical. Por paso:
//   - active → círculo relleno $primary con icono (lucide "+" para "crear").
//   - future → círculo borde $divider, fondo bone ($surface), número en gris.
// A la derecha: título (Inter 600, $textPrimary) + body (Inter 400, $textMuted)
// debajo, + un slot opcional `children` (ej. el CTA full-width del paso activo).
//
// Cero hardcode de color/spacing (ADR-023 §4): diámetros/colores/espaciados/radios
// via tokens (radio del círculo = $pill). Los únicos valores crudos son el grosor de
// la línea conectora (1px hairline, prop borderWidth/width) y el grosor de borde del
// círculo (2px): detalle de render, no color ni spacing semántico, sin token
// equivalente en la escala — el lint no los marca (no son props de color/spacing).

import { ReactNode } from 'react';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Plus } from 'lucide-react-native';

export type StepperStep = {
  /** Título del paso (a la derecha del círculo). */
  title: string;
  /** Texto descriptivo debajo del título. */
  body: string;
  /** Estado del paso: activo (relleno + icono) o futuro (borde + número). */
  state: 'active' | 'future';
  /** Contenido extra debajo del body (ej. el CTA del paso activo). */
  children?: ReactNode;
};

export type StepperProps = {
  steps: StepperStep[];
};

/**
 * Columna izquierda de un paso: el círculo centrado sobre la línea conectora.
 * La línea se dibuja como dos segmentos (arriba/abajo del círculo) para que pase
 * exactamente por el centro horizontal de TODOS los círculos.
 */
function StepRail({
  state,
  index,
  isFirst,
  isLast,
}: {
  state: 'active' | 'future';
  index: number;
  isFirst: boolean;
  isLast: boolean;
}) {
  // Color de la línea leído del token (cruza a una View con backgroundColor, que
  // sí acepta token, pero la dejamos explícita para documentar el hairline).
  const diameter = getTokenValue('$icon', 'size'); // 48
  const lineColor = '$divider';

  return (
    <YStack width={diameter} flexShrink={0} alignItems="center">
      {/* Segmento superior de la línea (oculto en el primer paso). */}
      <View
        width={1}
        flexGrow={0}
        height={isFirst ? 0 : '$3'}
        backgroundColor={isFirst ? 'transparent' : lineColor}
      />

      {/* Círculo del paso. */}
      <View
        width={diameter}
        height={diameter}
        borderRadius="$pill"
        alignItems="center"
        justifyContent="center"
        backgroundColor={state === 'active' ? '$primary' : '$surface'}
        borderWidth={state === 'active' ? 0 : 2}
        borderColor="$divider"
      >
        {state === 'active' ? (
          <Plus size={26} color={getTokenValue('$white', 'color')} strokeWidth={2.5} />
        ) : (
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textMuted">
            {index + 1}
          </Text>
        )}
      </View>

      {/* Segmento inferior de la línea (oculto en el último paso). Crece para
          conectar con el paso siguiente sin importar el alto del contenido. */}
      <View
        width={1}
        flexGrow={1}
        minHeight={isLast ? 0 : '$3'}
        backgroundColor={isLast ? 'transparent' : lineColor}
      />
    </YStack>
  );
}

export function Stepper({ steps }: StepperProps) {
  return (
    // Ancho completo: cada fila ocupa todo el ancho disponible y la columna derecha
    // (flex:1) wrappea su texto en vez de empujar overflow (Fix 1, incremento 2).
    <YStack width="100%">
      {steps.map((step, i) => {
        const isFirst = i === 0;
        const isLast = i === steps.length - 1;
        return (
          <XStack key={i} width="100%" gap="$3" alignItems="stretch">
            <StepRail state={step.state} index={i} isFirst={isFirst} isLast={isLast} />

            {/* Columna derecha: título + body + slot. paddingBottom separa del
                paso siguiente (salvo el último). minWidth:0 — en react-native-web
                los hijos flex tienen min-width:auto y NO encogen por debajo del ancho
                intrínseco de su contenido; sin esto, el body (Text largo) no wrappea,
                empuja la fila más ancha que el viewport y todo el ScrollView se estira
                → corte uniforme a la derecha (Fix overflow web). flexShrink:1 solo no
                alcanza en web. */}
            <YStack flex={1} minWidth={0} paddingTop="$3" paddingBottom={isLast ? '$2' : '$6'}>
              <Text
                fontFamily="$body"
                fontSize="$6"
                fontWeight="600"
                color="$textPrimary"
                flexShrink={1}
                minWidth={0}
              >
                {step.title}
              </Text>
              <Text
                fontFamily="$body"
                fontSize="$5"
                fontWeight="400"
                color="$textMuted"
                marginTop="$1"
                lineHeight="$6"
                flexShrink={1}
                minWidth={0}
              >
                {step.body}
              </Text>
              {step.children ? <View marginTop="$4">{step.children}</View> : null}
            </YStack>
          </XStack>
        );
      })}
    </YStack>
  );
}
