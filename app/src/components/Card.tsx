// Card — superficie de tarjeta canónica de RAFAQ (derivada de la home, A.1 / ADR-023).
//
// Fondo bone ($surface, cálido — la única surface que NO es el bg neutro), radio
// $card (16px), padding generoso, y una sombra suave provisional (shadows.card del
// config, ver nota allí: Tamagui v4 no expone tokens de sombra, se centraliza como
// objeto de estilo). Cero hardcode (ADR-023 §4): todo via tokens / shadows del config.

import { GetProps, styled, View } from 'tamagui';
import { shadows } from '../../tamagui.config';

const CardFrame = styled(View, {
  name: 'Card',
  backgroundColor: '$surface',
  borderRadius: '$card',
  padding: '$4',
  // Sombra suave: la fuente del valor es shadows.card (config), no literales acá.
  ...shadows.card,
});

export type CardProps = GetProps<typeof CardFrame>;

export const Card = CardFrame;
