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
//   - authenticated + verificado       → gating de ESTABLECIMIENTO (Fase 4 / B.1.2):
//       · loading            → splash (el contexto aún carga las memberships)
//       · no_establishments  → /onboarding (wizard R6.5)
//       · choosing (≥2)      → /mis-campos (selector, landing R6.7)
//       · active (1 o fijo)  → (tabs) (home del campo activo, R6.4/R6.7)
//       · active_lost        → /campo-perdido (aviso R6.10 + re-ruteo, sin logout R7.4)
// Las rutas /maniobra, /mis-campos, /update-password, /onboarding, /crear-campo,
// /campo-perdido se mantienen accesibles.
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
import { AuthProvider, EstablishmentProvider, useAuth, useEstablishment } from '@/contexts';

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

// Rutas del gating de ESTABLECIMIENTO (Fase 4). Top-segment de cada destino.
const ONBOARDING_ROUTE = 'onboarding'; // wizard sin campos (R6.5)
const MIS_CAMPOS_ROUTE = 'mis-campos'; // selector / landing ≥2 (R6.6/R6.7)
const CREAR_CAMPO_ROUTE = 'crear-campo'; // alta de campo (R3.1) — destino navegable, NO se re-rutea desde acá
// 'editar-campo' (R3.4) es un destino navegable más en estado 'active': NO está en
// strandedOnGatingRoute, así que el gate no lo expulsa a (tabs) mientras se edita. Se registra
// en el Stack abajo; no necesita constante de re-ruteo porque nunca se re-rutea desde 'active'.
const CAMPO_PERDIDO_ROUTE = 'campo-perdido'; // aviso active_lost (R6.10)

/**
 * Gate unificado de navegación: auth (R1.3 / R7.*) + establecimiento (Fase 4: R6.4–R6.10).
 * Vive DENTRO de AuthProvider + EstablishmentProvider (usa useAuth/useEstablishment) y del
 * árbol de navegación (useSegments/useRouter). Reacciona a cambios de estado re-ruteando.
 *
 * Orden de decisión:
 *   1. auth loading                        → no re-rutea (splash).
 *   2. unauthenticated                     → /(auth)/sign-in.
 *   3. authenticated + !emailVerified      → /verify-email.
 *   4. authenticated + verificado          → delega al EstablishmentState:
 *        loading           → no re-rutea (splash; el contexto está cargando memberships).
 *        no_establishments → /onboarding (R6.5).
 *        choosing (≥2)     → /mis-campos (selector, R6.7).
 *        active            → (tabs) (home del campo activo, R6.4/R6.7).
 *        active_lost       → /campo-perdido (aviso R6.10, sin logout R7.4).
 *
 * Rutas "destino" (a las que el usuario navega explícitamente, NO se re-rutean fuera de
 * ellas mientras estén abiertas): crear-campo (alta de campo desde wizard/switch/mis-campos)
 * y mis-campos (que también es landing). Ver ALLOWED_WHEN_ACTIVE.
 */
function RootGate() {
  const { state: auth } = useAuth();
  const { state: est } = useEstablishment();
  const segments = useSegments();
  const router = useRouter();

  // FIX 1 (heredado de B.1.1): el splash nativo se oculta UNA sola vez, recién cuando el
  // gating resolvió (o por timeout). El ref evita ocultar dos veces.
  const splashHidden = useRef(false);
  const hideSplashOnce = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {
      /* noop: web/algunos targets */
    });
  }, []);

  // Fallback de seguridad: si algo nunca resuelve (getSession/memberships colgados), no
  // dejamos la app trabada en el splash. ~5s después destapamos igual; el gate seguirá
  // re-ruteando cuando el estado cambie.
  useEffect(() => {
    const timer = setTimeout(hideSplashOnce, 5000);
    return () => clearTimeout(timer);
  }, [hideSplashOnce]);

  useEffect(() => {
    if (auth.status === 'loading') return;

    const top = segments[0] ?? '';
    const inAuthGroup = top === AUTH_GROUP;
    const inVerify = top === VERIFY_ROUTE;
    const inPublic = PUBLIC_ROUTES.has(top);

    if (auth.status === 'unauthenticated') {
      // Sin sesión → al grupo de auth (salvo ruta pública como reset).
      if (!inAuthGroup && !inPublic) router.replace('/(auth)/sign-in');
      hideSplashOnce();
      return;
    }

    if (!auth.emailVerified) {
      // Email sin verificar → gate de verificación (R1.3). Permitimos rutas públicas.
      if (!inVerify && !inPublic) router.replace('/verify-email');
      hideSplashOnce();
      return;
    }

    // authenticated + verificado → gating de ESTABLECIMIENTO (Fase 4).
    if (est.status === 'loading') {
      // El contexto está cargando memberships: mantenemos el splash hasta que resuelva
      // (igual que con la sesión). No re-ruteamos a ciegas para no flashear (tabs).
      return;
    }

    // Si estamos en una ruta de auth/verify y ya pasamos esos gates, hay que salir de ahí.
    const inAuthFlow = inAuthGroup || inVerify;
    // Rutas que el usuario abre explícitamente y NO deben re-rutearse mientras el estado
    // sea 'active' (si las re-ruteáramos, no podría crear un campo ni navegar el switch).
    const onCrearCampo = top === CREAR_CAMPO_ROUTE;

    if (est.status === 'no_establishments') {
      if (top !== ONBOARDING_ROUTE && !onCrearCampo) router.replace('/onboarding');
    } else if (est.status === 'choosing') {
      if (top !== MIS_CAMPOS_ROUTE && !onCrearCampo) router.replace('/mis-campos');
    } else if (est.status === 'active_lost') {
      if (top !== CAMPO_PERDIDO_ROUTE) router.replace('/campo-perdido');
    } else if (est.status === 'active') {
      // Campo activo fijado → home. Solo forzamos a (tabs) si el usuario quedó "varado"
      // en un destino del gating que ya no aplica (auth, onboarding, campo-perdido). NO
      // sacamos al usuario de (tabs), mis-campos ni crear-campo (navegación legítima).
      const strandedOnGatingRoute =
        inAuthFlow ||
        top === ONBOARDING_ROUTE ||
        top === CAMPO_PERDIDO_ROUTE;
      if (strandedOnGatingRoute) router.replace('/(tabs)');
    }

    // El re-ruteo ya quedó solicitado: ocultamos el splash en el mismo ciclo (FIX 1).
    hideSplashOnce();
  }, [auth, est, segments, router, hideSplashOnce]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="verify-email" />
      <Stack.Screen name="update-password" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="maniobra" options={{ presentation: 'modal' }} />
      {/* "Mis campos" (R6.6): pantalla standalone, header propio. */}
      <Stack.Screen name="mis-campos" />
      {/* Onboarding wizard (R6.5) — sin campos. */}
      <Stack.Screen name="onboarding" />
      {/* Alta de campo (R3.1/R3.8) — destino del wizard / switch / mis-campos. */}
      <Stack.Screen name="crear-campo" />
      {/* Edición de campo (R3.4) — destino owner-only desde "Más". */}
      <Stack.Screen name="editar-campo" />
      {/* Aviso de pérdida del campo activo (R6.10) — transitorio. */}
      <Stack.Screen name="campo-perdido" />
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
            {/* EstablishmentProvider monta siempre, pero se auto-inhabilita sin sesión
                verificada (lee user_id del AuthContext; sin user queda en 'loading' y no
                consulta). Así no remonta al pasar los gates de auth y el gating de
                establecimiento (RootGate) tiene contexto disponible. */}
            <EstablishmentProvider>
              <RootGate />
            </EstablishmentProvider>
          </AuthProvider>
        </TamaguiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
