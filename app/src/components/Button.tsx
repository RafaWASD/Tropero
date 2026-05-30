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
  // Comunicar rol + estado a tecnologías de asistencia SIN filtrar props inválidas al
  // DOM. ButtonFrame es un styled(View) de Tamagui: en web (react-native-web) NO traduce
  // `accessibilityRole` ni `accessibilityState` a sus equivalentes ARIA — los pasa tal
  // cual al <div> y React tira el warning ("does not recognize the accessibilityRole/
  // accessibilityState prop on a DOM element"). Por eso separamos por plataforma:
  //   - web: `role="button"` + `aria-disabled` → atributos DOM válidos (ARIA), sin leak.
  //   - native: `accessibilityRole` / `accessibilityState` → la API RN correcta.
  const a11y =
    Platform.OS === 'web'
      ? { role: 'button' as const, 'aria-disabled': disabled }
      : { accessibilityRole: 'button' as const, accessibilityState: { disabled } };
  return (
    <ButtonFrame
      variant={variant}
      fullWidth={fullWidth}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      {...a11y}
      {...rest}
    >
      <ButtonLabel color={labelColor}>{children}</ButtonLabel>
    </ButtonFrame>
  );
}
