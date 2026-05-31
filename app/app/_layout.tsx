// app/_layout.tsx — layout raíz de RAFAQ (Expo Router).
//
// Monta los providers globales del frontend (ADR-013):
//   - GestureHandlerRootView: requerido por react-native-gesture-handler en la
//     raíz para que los gestos (swipes, long-press en manga) funcionen en todo
//     el árbol.
//   - SafeAreaProvider: insets seguros (notch / home indicator).
//   - TamaguiProvider: inyecta el design system (tamagui.config.ts).
//   - AuthProvider (spec 01, T3.1): sesión Supabase Auth. El gating de navegación
//     raíz se hace según el AuthState (ver AuthGate abajo).
//
// Gating de navegación (spec 01, R1.3 / R7.* / design.md §Navegación raíz):
//   - loading                          → splash (no renderizamos rutas hasta saber)
//   - unauthenticated                  → grupo (auth): SignIn / SignUp / ForgotPassword
//   - authenticated + email NO verif.  → /verify-email (EmailVerificationGate, R1.3)
//   - authenticated + verificado       → (tabs) [PLACEHOLDER de "landing autenticado";
//                                         la Fase 4 (B.1.2) inserta el gating de
//                                         establecimiento: Mis campos / wizard / active_lost]
// Las rutas /maniobra, /mis-campos, /update-password se mantienen accesibles.
//
// Carga de fuentes (A.1): cargamos Inter de verdad (400/500/600/700).
//
// Splash nativo (fix loop sesión 21, FIX 1 — evita el flash de (tabs) en cold start):
//   RootLayout NO renderiza el árbol de navegación hasta que las FUENTES están listas
//   (devuelve null), y NO oculta el splash por su cuenta. El splash nativo se mantiene
//   visible hasta que TAMBIÉN la sesión resuelva (AuthState.status !== 'loading'): es el
//   AuthGate quien llama a SplashScreen.hideAsync(), recién DESPUÉS de re-rutear según el
//   estado. Así, al destaparse el splash, ya estamos en la ruta correcta y nunca se ve un
//   frame de (tabs) con datos mock cuando el usuario no tiene sesión.
//   Fallbacks por timeout: ~3s para las fuentes (RootLayout) y ~5s para auth (AuthGate),
//   para no quedar colgados en el splash si algo no resuelve.

import 'react-native-gesture-handler';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import config from '../tamagui.config';
import { AuthProvider, useAuth } from '@/contexts';

SplashScreen.preventAutoHideAsync().catch(() => {
  /* noop: en web/algunos targets puede no estar disponible */
});

// Grupo de rutas de auth (debe coincidir con el nombre del directorio app/(auth)).
const AUTH_GROUP = '(auth)';
const VERIFY_ROUTE = 'verify-email';
// Rutas accesibles SIN estar autenticado/verificado (no las re-ruteamos): la pantalla
// de actualizar contraseña (destino del link de reset) puede alcanzarse en medio del
// flujo de recuperación. El wiring fino es de la Fase 5 (ver update-password.tsx).
const PUBLIC_ROUTES = new Set(['update-password']);

/**
 * Enruta según el AuthState. Vive DENTRO del AuthProvider (usa useAuth) y dentro del
 * árbol de navegación (usa useSegments/useRouter). Reacciona a cambios de estado
 * (login, logout, verificación) re-ruteando con router.replace.
 */
function AuthGate() {
  const { state } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // FIX 1: el splash nativo se oculta UNA sola vez, recién cuando la sesión resolvió
  // (o por timeout de seguridad). Como AuthGate ya monta con las fuentes listas, este es
  // el último gate antes de mostrar UI. El ref evita ocultar dos veces.
  const splashHidden = useRef(false);
  const hideSplashOnce = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {
      /* noop: web/algunos targets */
    });
  }, []);

  // Fallback de seguridad: si la sesión nunca resuelve (ej. getSession colgado), no
  // dejamos la app trabada en el splash. ~5s después destapamos igual; el AuthGate
  // seguirá re-ruteando cuando el estado finalmente cambie.
  useEffect(() => {
    const timer = setTimeout(hideSplashOnce, 5000);
    return () => clearTimeout(timer);
  }, [hideSplashOnce]);

  useEffect(() => {
    if (state.status === 'loading') return;

    const top = segments[0] ?? '';
    const inAuthGroup = top === AUTH_GROUP;
    const inVerify = top === VERIFY_ROUTE;
    const inPublic = PUBLIC_ROUTES.has(top);

    if (state.status === 'unauthenticated') {
      // Sin sesión → al grupo de auth (salvo que esté en una ruta pública como reset).
      if (!inAuthGroup && !inPublic) router.replace('/(auth)/sign-in');
    } else if (!state.emailVerified) {
      // Email sin verificar → gate de verificación (R1.3). Permitimos rutas públicas
      // (recovery) por si el flujo de reset cae acá.
      if (!inVerify && !inPublic) router.replace('/verify-email');
    } else {
      // authenticated + verificado → landing autenticado. Si está en auth/verify, lo
      // sacamos hacia (tabs). (Fase 4 insertará acá el gating de establecimiento.)
      if (inAuthGroup || inVerify) router.replace('/(tabs)');
    }

    // El re-ruteo ya quedó solicitado arriba: ocultamos el splash DESPUÉS de pedir el
    // replace, en el mismo ciclo. Así, cuando el splash se destapa, ya estamos navegando
    // a la ruta correcta y no se ve el frame de (tabs) por debajo en cold start sin sesión.
    hideSplashOnce();
  }, [state, segments, router, hideSplashOnce]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="verify-email" />
      <Stack.Screen name="update-password" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="maniobra" options={{ presentation: 'modal' }} />
      {/* "Mis campos" (spec 01 R6.6): pantalla standalone, header propio. */}
      <Stack.Screen name="mis-campos" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Gate de FUENTES: hasta que cargan (o el timeout), no montamos el árbol de navegación
  // (devolvemos null y el splash nativo queda visible). NO ocultamos el splash acá: eso lo
  // hace el AuthGate cuando la sesión resuelve (FIX 1), así no se ve (tabs) antes del redirect.
  const ready = fontsLoaded || fontError != null || timedOut;

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <TamaguiProvider config={config} defaultTheme="light">
          <StatusBar style="dark" />
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </TamaguiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
