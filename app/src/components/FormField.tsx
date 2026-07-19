// FormField — input de formulario canónico de RAFAQ (spec 01, T3.2 / ADR-023).
//
// Anatomía: label arriba + input pill + texto de error opcional debajo. Patrón
// canónico de la librería (igual que Button): tokens-only (cero hardcode, ADR-023
// §4), touch-target ≥ $touchMin (56px, manga-friendly aunque auth es pantalla
// mixta), y split a11y web/native como Button.tsx.
//
// El <TextInput> es de react-native (no hay primitivo Tamagui de input en la base
// v4 del proyecto). Sus props de estilo cruzan a una API no-Tamagui: los colores y
// tamaños de fuente se leen con getTokenValue('$token', grupo) → siguen
// referenciando el design system, no son literales.

import { forwardRef, type ReactNode } from 'react';
import { Platform, TextInput, type TextInputProps } from 'react-native';
import { getTokenValue, Text, YStack } from 'tamagui';

/**
 * Label de un campo de formulario. Se exporta para que un contenedor que envuelve al `FormField` con
 * una decoración lateral (hoy `PhoneField` con su chip `+54`) pueda dibujar el label a NIVEL DE GRUPO
 * —alineado con los labels hermanos del form— usando EXACTAMENTE el mismo estilo. Es el mismo criterio
 * que el resto del delta: una sola definición, no dos que puedan divergir. Si el estilo del label
 * cambia, cambia acá y los dos usos lo siguen.
 */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
      {children}
    </Text>
  );
}

export type FormFieldProps = {
  /** Label visible sobre el input. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Texto de error bajo el input; si no es null, el borde pasa a estado de error. */
  error?: string | null;
  placeholder?: string;
  /** Teclado/autocompletado. */
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  secureTextEntry?: boolean;
  editable?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  /** Tope de caracteres tipeables (delega en el maxLength nativo del TextInput). */
  maxLength?: number;
  /**
   * testID del <TextInput> (ADITIVO, opcional). RN-web lo mapea a `data-testid` → desambigua inputs con el
   * MISMO label (ej. el idv por ternero en el parto de mellizos: `calf-idv-0` / `calf-idv-1`). Sin él, el
   * comportamiento es idéntico al as-built (todos los callers previos siguen sin testID).
   */
  testID?: string;
  /**
   * Campo multilínea (ADITIVO, opcional). Default false → single-line as-built (cero cambio para los callers
   * previos). true → TextInput multiline con altura mínima mayor y alineación top (ej. comentario libre del
   * tratamiento). `numberOfLines` sugiere el alto inicial en Android.
   */
  multiline?: boolean;
  numberOfLines?: number;
  /**
   * Oculta VISUALMENTE el label (ADITIVO, opcional). Default false → as-built (cero cambio para los
   * callers previos). El `label` sigue siendo OBLIGATORIO y sigue siendo el nombre accesible del input
   * (`aria-label` en web / `accessibilityLabel` en native), así que ocultarlo no degrada a11y ni rompe
   * `getByLabel`.
   *
   * Para qué: cuando el input convive con una decoración lateral en la misma fila (el chip `+54` de
   * `PhoneField`), el label dibujado ADENTRO de la columna del input queda sangrado el ancho de la
   * decoración y se DESALINEA de los labels hermanos del formulario — y encima SALTA cuando la
   * decoración aparece/desaparece. Es la clase de bug de ADR-027 (una decoración lateral corriendo el
   * layout de algo que debería estar anclado). El contenedor dibuja el label con `FieldLabel` a nivel
   * de GRUPO y apaga el interno con esta prop.
   */
  hideLabel?: boolean;
};

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  {
    label,
    value,
    onChangeText,
    error = null,
    placeholder,
    keyboardType,
    autoCapitalize = 'none',
    autoComplete,
    textContentType,
    secureTextEntry = false,
    editable = true,
    returnKeyType,
    onSubmitEditing,
    maxLength,
    testID,
    multiline = false,
    numberOfLines,
    hideLabel = false,
  },
  ref,
) {
  // Valores que cruzan a la API no-Tamagui de <TextInput> (style/props), leídos del
  // design system con getTokenValue — no literales (ADR-023 §4).
  const textColor = getTokenValue('$textPrimary', 'color');
  // ⚠️ El placeholder va en $textFaint, NO en $textMuted (que es el color de los LABELS).
  //
  // Por qué: con $textMuted (#5C655F) el placeholder queda en 6.03:1 contra el blanco del input —
  // anormalmente oscuro para un placeholder— y contra el valor real ($textPrimary, 19.35:1) deja apenas
  // 3.2× de separación. Como además ocupa la MISMA posición que un valor, un campo vacío se lee como
  // "ya cargado": el usuario toca Continuar y se come un error de campo requerido. A pleno sol (manga)
  // es peor. Con $textFaint (#807A74, 4.24:1 contra blanco) la separación sube a 4.6× y el campo vacío
  // se distingue de un vistazo. La otra mitad del fix es semántica y vive en el copy: los placeholders
  // de ejemplo se escriben con el prefijo "Ej. " (ver PhoneField).
  //
  // Nota de accesibilidad (medida, no estimada): 4.24:1 queda apenas por debajo del 4.5:1 de WCAG AA
  // para texto normal. Se acepta a conciencia porque el placeholder es un EJEMPLO —no información: el
  // nombre accesible del campo lo da el `label`, que está SIEMPRE visible y en 6.03:1— y porque el
  // riesgo que cierra (confundir vacío con lleno y perder el dato) es operativamente peor. No hay en el
  // design system un token de placeholder dedicado; $textFaint es el más claro con legibilidad
  // razonable (ya se usaba con este mismo rol en `baston-test.tsx`). Si algún día se agrega
  // `$textPlaceholder`, este es el consumidor a migrar.
  const placeholderColor = getTokenValue('$textFaint', 'color');
  const borderColorOk = getTokenValue('$divider', 'color');
  const borderColorError = getTokenValue('$terracota', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const fontSize = getTokenValue('$inputText', 'size'); // 16
  const minHeight = getTokenValue('$touchMin', 'size'); // 56
  const radius = getTokenValue('$card', 'radius'); // 16
  const padH = getTokenValue('$4', 'space');

  const hasError = Boolean(error);

  // a11y: en web pasamos aria-* (RN-web no traduce accessibilityState a ARIA); en
  // native, accessibilityState. Mismo criterio que Button.tsx.
  const a11y =
    Platform.OS === 'web'
      ? { 'aria-label': label, 'aria-invalid': hasError }
      : { accessibilityLabel: label, accessibilityState: { disabled: !editable } };

  return (
    <YStack width="100%" gap="$2">
      {hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        secureTextEntry={secureTextEntry}
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        maxLength={maxLength}
        testID={testID}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : undefined}
        style={{
          minHeight: multiline ? minHeight * 1.6 : minHeight,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: hasError ? borderColorError : borderColorOk,
          backgroundColor: surfaceColor,
          paddingHorizontal: padH,
          // Multilínea: padding vertical + texto alineado arriba (un comentario crece hacia abajo).
          paddingVertical: multiline ? getTokenValue('$3', 'space') : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
          fontSize,
          fontFamily: 'Inter',
          color: textColor,
          opacity: editable ? 1 : 0.5,
        }}
        {...a11y}
      />
      {hasError ? (
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
          {error}
        </Text>
      ) : null}
    </YStack>
  );
});
