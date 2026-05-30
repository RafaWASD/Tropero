// Button — botón pill canónico de RAFAQ (derivado de la home, A.1 / ADR-023).
//
// Variantes:
//   - primary   → relleno verde botella ($primary), texto blanco. CTA principal.
//   - secondary → outline $primary, texto $primary, fondo transparente.
//
// Alto mínimo $touchMin (56px, manga-friendly, CLAUDE.md principio 4). Forma pill
// ($pill). Tipografía Inter 600 16px. Prop `fullWidth` → ocupa todo el ancho del
// contenedor. Estados de press vía pseudo `pressStyle` de Tamagui.
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens.

import { Platform } from 'react-native';
import { GetProps, styled, Text, View } from 'tamagui';

// Contenedor pill. `variant` de Tamagui mapea a estilos por valor.
const ButtonFrame = styled(View, {
  name: 'Button',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  borderRadius: '$pill',
  minHeight: '$touchMin',
  paddingHorizontal: '$5',
  // El borde existe siempre (transparente en primary) para que primary y
  // secondary tengan el MISMO alto/ancho — el outline no desplaza el layout.
  borderWidth: 2,
  borderColor: 'transparent',

  variants: {
    variant: {
      primary: {
        backgroundColor: '$primary',
        pressStyle: { backgroundColor: '$primaryPress' },
      },
      secondary: {
        backgroundColor: 'transparent',
        borderColor: '$primary',
        pressStyle: { backgroundColor: '$surface' },
      },
    },
    fullWidth: {
      true: { alignSelf: 'stretch', width: '100%' },
      false: { alignSelf: 'flex-start' },
    },
    disabled: {
      true: { opacity: 0.5 },
    },
  } as const,

  defaultVariants: {
    variant: 'primary',
    fullWidth: false,
  },
});

const ButtonLabel = styled(Text, {
  name: 'ButtonLabel',
  fontFamily: '$body',
  fontSize: '$5', // 16px
  fontWeight: '600', // Inter SemiBold (face → 'Inter-SemiBold')
  // El color se setea según variante desde el componente (no se puede leer la
  // variante del frame acá), así que se inyecta abajo.
});

type ButtonFrameProps = GetProps<typeof ButtonFrame>;

export type ButtonProps = Omit<ButtonFrameProps, 'children'> & {
  /** Texto del botón. */
  children: string;
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
  disabled?: boolean;
};

export function Button({
  children,
  variant = 'primary',
  fullWidth = false,
  disabled = false,
  onPress,
  ...rest
}: ButtonProps) {
  const labelColor = variant === 'primary' ? '$white' : '$primary';
  // Comunicar el estado "disabled" a tecnologías de asistencia SIN filtrar un prop
  // inválido al DOM. ButtonFrame es un styled(View) de Tamagui: en web (react-native-web)
  // Tamagui mapea `accessibilityRole`→`role` pero NO traduce `accessibilityState`, que
  // se filtraría al DOM y dispara el warning de React ("does not recognize the
  // accessibilityState prop"). Por eso lo separamos por plataforma: en web usamos
  // `aria-disabled` (atributo DOM válido que RNW pasa tal cual); en native el equivalente
  // RN es `accessibilityState`.
  const a11yState =
    Platform.OS === 'web'
      ? { 'aria-disabled': disabled }
      : { accessibilityState: { disabled } };
  return (
    <ButtonFrame
      variant={variant}
      fullWidth={fullWidth}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      {...a11yState}
      {...rest}
    >
      <ButtonLabel color={labelColor}>{children}</ButtonLabel>
    </ButtonFrame>
  );
}
