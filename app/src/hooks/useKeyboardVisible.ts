// useKeyboardVisible — ¿el teclado del SO está visible? (feature U2, primitivo footer-fijo con CTA).
//
// El footer fijo con el CTA sube por encima del teclado (primitivo `components/KeyboardAvoidingShell`) y,
// cuando el teclado está abierto, encoge su reserva de safe-area inferior (la safe-area la tapa el teclado
// → reservarla dejaría un hueco feo sobre el teclado). La DECISIÓN del padding es pura
// (utils/footer-action.ts resolveFooterPaddingBottom); este hook solo aporta el flag reactivo.
//
// ⚠️ Este hook aporta el FLAG, nunca la ALTURA. La altura del teclado que emite RN en Android es
// incorrecta bajo edge-to-edge (`ReactRootView.java` le RESTA la barra de navegación, cálculo del mundo
// pre-edge-to-edge) — el shell la saca de `useAnimatedKeyboard` de Reanimated, que sí la corrige. El
// booleano de visibilidad sí es confiable en las dos plataformas.
//
// Plataformas:
//   - iOS: 'keyboardWillShow'/'keyboardWillHide' → el flag cambia ANTES de la animación (footer sincronizado).
//   - Android: no emite los "Will…" de forma fiable → usamos 'keyboardDidShow'/'keyboardDidHide'. Estos SÍ
//     disparan con edge-to-edge: `ReactRootView` los emite ante el cambio de VISIBILIDAD del IME
//     (`rootInsets.isVisible(ime())`), que no depende de que la ventana se encoja.
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
