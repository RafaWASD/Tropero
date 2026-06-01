// a11y.ts — helpers de accesibilidad multiplataforma para props de roles/labels/estado.
//
// POR QUÉ EXISTE (bug de runtime, fix-loop C1):
//   react-native-web NO traduce `accessibilityLabel`/`accessibilityRole`/`accessibilityState`
//   a sus equivalentes ARIA cuando se spreadean sobre un Pressable/View que renderiza como un
//   <div> con props ARIA crudas ya presentes. React entonces tira el warning "does not recognize
//   the `accessibilityLabel` prop on a DOM element". En DEV (Metro/`expo start --web`) ese warning
//   monta el error-overlay/LogBox de Expo, que CUBRE la pantalla e intercepta los toques → los
//   controles "no responden al tap" (BUG 2: los toggles del wizard de rodeo). En el export de
//   PRODUCCIÓN el overlay no existe (los warnings se eliminan), así que el bug es invisible ahí —
//   por eso la suite E2E (que corre el export estático) no lo atrapaba.
//
// La regla del proyecto (ver Button.tsx) ya era: en web pasar atributos ARIA DOM-válidos
// (`role`, `aria-*`), en native las props `accessibility*` de RN. Estos helpers la centralizan
// para que ninguna pantalla vuelva a filtrar `accessibilityLabel` al DOM.
//
// Lógica PURA (sin React, sin RN): toma plataforma + datos a11y y devuelve el objeto de props
// correcto. Testeable en Node nativo. El componente spreadea el resultado sobre el elemento.

export type A11yPlatform = 'web' | 'ios' | 'android' | string;

export type SwitchA11yInput = {
  label: string;
  checked: boolean;
  /** Si NO es interactivo (required/readOnly) → aria-disabled / disabled. */
  disabled: boolean;
};

export type ButtonA11yInput = {
  label: string;
  disabled?: boolean;
  /** Estado seleccionado (cards de opción única). */
  selected?: boolean;
};

type WebSwitchProps = {
  role: 'switch';
  'aria-checked': boolean;
  'aria-disabled': boolean;
  'aria-label': string;
};
type NativeSwitchProps = {
  accessibilityRole: 'switch';
  accessibilityState: { checked: boolean; disabled: boolean };
  accessibilityLabel: string;
};

type WebButtonProps = {
  role: 'button';
  'aria-label': string;
  'aria-disabled'?: boolean;
  'aria-pressed'?: boolean;
};
type NativeButtonProps = {
  accessibilityRole: 'button';
  accessibilityLabel: string;
  accessibilityState?: { disabled?: boolean; selected?: boolean };
};

/** Props a11y de un control tipo switch (toggle), DOM-válidas en web. */
export function switchA11y(
  platform: A11yPlatform,
  input: SwitchA11yInput,
): WebSwitchProps | NativeSwitchProps {
  if (platform === 'web') {
    return {
      role: 'switch',
      'aria-checked': input.checked,
      'aria-disabled': input.disabled,
      'aria-label': input.label,
    };
  }
  return {
    accessibilityRole: 'switch',
    accessibilityState: { checked: input.checked, disabled: input.disabled },
    accessibilityLabel: input.label,
  };
}

/** Props a11y de un botón/control accionable, DOM-válidas en web. */
export function buttonA11y(
  platform: A11yPlatform,
  input: ButtonA11yInput,
): WebButtonProps | NativeButtonProps {
  if (platform === 'web') {
    const web: WebButtonProps = { role: 'button', 'aria-label': input.label };
    if (input.disabled !== undefined) web['aria-disabled'] = input.disabled;
    if (input.selected !== undefined) web['aria-pressed'] = input.selected;
    return web;
  }
  const native: NativeButtonProps = {
    accessibilityRole: 'button',
    accessibilityLabel: input.label,
  };
  if (input.disabled !== undefined || input.selected !== undefined) {
    native.accessibilityState = {};
    if (input.disabled !== undefined) native.accessibilityState.disabled = input.disabled;
    if (input.selected !== undefined) native.accessibilityState.selected = input.selected;
  }
  return native;
}
