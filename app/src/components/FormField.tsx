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

import { forwardRef } from 'react';
import { Platform, TextInput, type TextInputProps } from 'react-native';
import { getTokenValue, Text, YStack } from 'tamagui';

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
  },
  ref,
) {
  // Valores que cruzan a la API no-Tamagui de <TextInput> (style/props), leídos del
  // design system con getTokenValue — no literales (ADR-023 §4).
  const textColor = getTokenValue('$textPrimary', 'color');
  const placeholderColor = getTokenValue('$textMuted', 'color');
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
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
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
        style={{
          minHeight,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: hasError ? borderColorError : borderColorOk,
          backgroundColor: surfaceColor,
          paddingHorizontal: padH,
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
