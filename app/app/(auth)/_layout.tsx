// app/(auth)/_layout.tsx — stack de las pantallas de autenticación (spec 01, Fase 3).
//
// Grupo de rutas que se muestra cuando el AuthState es `unauthenticated` (el gating
// vive en el _layout raíz). Sin header nativo: cada pantalla arma el suyo (consistente
// con el resto de la app, ADR-018).

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
