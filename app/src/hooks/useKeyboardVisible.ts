// useKeyboardVisible — ¿el teclado del SO está visible? (feature U2, primitivo footer-fijo con CTA).
//
// El footer fijo con el CTA sube por encima del teclado (KeyboardAvoidingView) y, cuando el teclado
// está abierto, encoge su reserva de safe-area inferior (la safe-area la tapa el teclado → reservarla
// dejaría un hueco feo sobre el teclado). La DECISIÓN del padding es pura (utils/footer-action.ts
// resolveFooterPaddingBottom); este hook solo aporta el flag reactivo.
//
// Plataformas:
//   - iOS: 'keyboardWillShow'/'keyboardWillHide' → el flag cambia ANTES de la animación (footer sincronizado).
//   - Android: iOS no emite los "Will…" fiables → usamos 'keyboardDidShow'/'keyboardDidHide'.
//   - Web (react-native-web): no hay teclado virtual que tape el CTA → los eventos no disparan → queda
//     `false` (correcto: el footer usa la reserva plena, que en web cae al mínimo).

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return visible;
}
