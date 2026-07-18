// AppleSignInButton (BASE = impl web-safe) — botón "Continuar con Apple" (spec 19, T13 / R4.3).
//
// Split base + `.native` (2 archivos, ver design §Arquitectura). Este BASE es la impl WEB: renderiza el
// botón custom armonizado (`AppleSignInButtonView`, vista pura compartida). NO importa
// `expo-apple-authentication` (R2.5) → el bundle web queda limpio. En iOS/Android Metro resuelve
// `AppleSignInButton.native.tsx` (mismo botón custom en iOS, `null` en Android).
//
// El markup vive en `AppleSignInButtonView.tsx` (DRY: base web + iOS comparten la misma vista).

import { AppleSignInButtonView, type AppleSignInButtonViewProps } from './AppleSignInButtonView';

export type AppleSignInButtonProps = AppleSignInButtonViewProps;

export function AppleSignInButton(props: AppleSignInButtonProps) {
  return <AppleSignInButtonView {...props} />;
}
