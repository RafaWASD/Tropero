// app/_layout.tsx — layout raíz de RAFAQ (Expo Router).
//
// Monta los providers globales del frontend (ADR-013):
//   - GestureHandlerRootView: requerido por react-native-gesture-handler en la
//     raíz para que los gestos (swipes, long-press en manga) funcionen en todo
//     el árbol.
//   - SafeAreaProvider: insets seguros (notch / home indicator). El bottom-nav
//     los consume vía useSafeAreaInsets (ADR-023 §6).
//   - TamaguiProvider: inyecta el design system (tamagui.config.ts) a toda la app.
//
// Carga de fuentes (A.1): cargamos Inter de verdad (400/500/600/700) y mapeamos
// los módulos `Inter_NNN...` de @expo-google-fonts/inter a los NOMBRES DE FAMILIA
// que tamagui.config.ts declara en su `face` (`Inter`, `Inter-Medium`,
// `Inter-SemiBold`, `Inter-Bold`). Mantenemos el splash visible
// (preventAutoHideAsync) y NO renderizamos el árbol hasta que las fuentes están
// listas — así la primera pintura ya es Inter, no el sans-serif del sistema
// (core del "primer try", CLAUDE.md principio 4).
//
// Fallback por timeout: si la carga de fuentes se cuelga (ni resuelve ni tira
// error — pasa en web headless y podría pasar en cualquier target), a los ~3s
// renderizamos igual cayendo con gracia al sans-serif del sistema; Inter aparece
// cuando termine de cargar. Así no quedamos colgados en splash infinito.
//
// Debajo, un Stack de expo-router con el grupo (tabs) como pantalla principal y
// la ruta /maniobra como modal/stub (FAB de MODO MANIOBRAS, ADR-018).

import 'react-native-gesture-handler';
import { useCallback, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { Stack } from 'expo-router';
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

// Mantenemos el splash nativo hasta que las fuentes carguen (evita el flash de
// system-font → Inter en el primer frame). Idempotente; se ignora si ya se ocultó.
SplashScreen.preventAutoHideAsync().catch(() => {
  /* noop: en web/algunos targets puede no estar disponible */
});

export default function RootLayout() {
  // Las CLAVES de este mapa son los nombres de familia que tamagui.config.ts
  // espera en su `face` (peso → familia). expo-font registra cada .ttf bajo esa
  // clave, así que `fontFamily: 'Inter-Bold'` (que Tamagui emite para weight 700)
  // resuelve al archivo correcto.
  const [fontsLoaded, fontError] = useFonts({
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  // Fallback por timeout: si a los ~3s la carga de fuentes no resolvió (ni cargó
  // ni tiró error — cuelgue en web headless u otro target), seguimos igual.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Si las fuentes fallan en cargar (error) o la carga se cuelga (timeout), no
  // dejamos la app colgada en el splash: seguimos (cae al sans-serif del sistema)
  // en vez de pantalla negra eterna.
  const ready = fontsLoaded || fontError != null || timedOut;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {
        /* noop */
      });
    }
  }, [ready]);

  const onLayoutRootView = useCallback(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {
        /* noop */
      });
    }
  }, [ready]);

  if (!ready) {
    // Gate: no renderizamos el árbol hasta tener Inter. El splash nativo sigue
    // visible mientras tanto (preventAutoHideAsync de arriba).
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <TamaguiProvider config={config} defaultTheme="light">
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="maniobra" options={{ presentation: 'modal' }} />
          </Stack>
        </TamaguiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
