// DiagnosticErrorBoundary — DIAGNÓSTICO TEMPORAL (bring-up nativo) — QUITAR cuando se resuelva.
//
// Contexto: la app se validó siempre en WEB. En iOS (Expo SDK 56 + Hermes + New Architecture)
// crashea al arranque con una excepción JS fatal (RCTExceptionsManager → RCTFatal → SIGABRT), pero
// el `.ips` de iOS NO trae el texto del error JS → estamos ciegos. Este boundary intercepta el throw
// y lo MUESTRA EN PANTALLA (mensaje + stack, seleccionable) para poder screenshotearlo desde el iPhone.
//
// Cubre DOS clases de error:
//   1. Errores en FASE DE RENDER de cualquier hijo (incl. providers como PowerSyncProvider):
//      getDerivedStateFromError + componentDidCatch → fallback full-screen.
//   2. Errores ASYNC / de módulo que NO pasan por el render (no los ve un error boundary de React):
//      un handler GLOBAL vía ErrorUtils.setGlobalHandler los muestra con Alert + los empuja al fallback.
//
// El fallback usa SOLO primitivas de react-native (View / ScrollView / Text) — NADA de Tamagui, porque
// el error podría estar justamente en el design system. En WEB este componente es INERTE: la app arranca
// OK, nunca hay error, y renderiza los children igual (ErrorUtils no existe en web → handler no se instala).

import React from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ---------------------------------------------------------------------------------------------------
// Handler GLOBAL de errores async/módulo (fuera del ciclo de render de React).
// ErrorUtils es una API global de React Native que NO está en los tipos por defecto → acceso vía any.
// ---------------------------------------------------------------------------------------------------

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = {
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
  getGlobalHandler?: () => GlobalErrorHandler | undefined;
};

// Puente módulo → boundary: el handler global no puede setear state de React directamente, así que
// deja el error acá y, si el boundary ya está montado, lo empuja al fallback full-screen (además del Alert).
type AsyncErrorListener = (error: Error, componentStack: string | null) => void;
let asyncErrorListener: AsyncErrorListener | null = null;
let pendingAsyncError: { error: Error; componentStack: string | null } | null = null;
let globalHandlerInstalled = false;

function reportAsyncError(error: Error): void {
  if (asyncErrorListener) {
    asyncErrorListener(error, null);
  } else {
    // El boundary todavía no montó (error MUY temprano): lo guardamos y lo drena componentDidMount.
    pendingAsyncError = { error, componentStack: null };
  }
}

function installGlobalHandler(): void {
  if (globalHandlerInstalled) return;
  const errorUtils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils || typeof errorUtils.setGlobalHandler !== 'function') {
    // WEB u otros targets sin ErrorUtils → handler inerte, nada que instalar.
    return;
  }
  globalHandlerInstalled = true;
  errorUtils.setGlobalHandler((error, _isFatal) => {
    try {
      const err: Error =
        error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : String((error as { message?: unknown })?.message ?? error));
      // Alert = vía simple y confiable para VER el error async aunque no haya UI montada.
      Alert.alert('JS Error (async)', `${err.name}: ${err.message}\n\n${(err.stack ?? '').slice(0, 1500)}`);
      // Además lo empujamos al fallback full-screen (más legible / screenshoteable).
      reportAsyncError(err);
    } catch {
      // NUNCA re-crashear desde el handler global.
    }
    // NO llamamos al handler previo a propósito: el default (RCTFatal) re-crashearía la app y perderíamos
    // el mensaje en pantalla. El objetivo acá es VER el error, no propagarlo.
  });
}

// ---------------------------------------------------------------------------------------------------
// Error boundary (class component) con fallback full-screen.
// ---------------------------------------------------------------------------------------------------

interface DiagnosticErrorBoundaryProps {
  children: React.ReactNode;
}

interface DiagnosticErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

const MONOSPACE = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

export class DiagnosticErrorBoundary extends React.Component<
  DiagnosticErrorBoundaryProps,
  DiagnosticErrorBoundaryState
> {
  constructor(props: DiagnosticErrorBoundaryProps) {
    super(props);
    this.state = { error: null, componentStack: null };
    // Instalamos el handler global lo antes posible (en la construcción del boundary raíz).
    installGlobalHandler();
  }

  static getDerivedStateFromError(error: Error): Partial<DiagnosticErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    this.setState({ error, componentStack: info?.componentStack ?? null });
  }

  componentDidMount(): void {
    // Nos suscribimos como destino de los errores async del handler global.
    asyncErrorListener = (error, componentStack) => {
      // Si ya hay un error de render en pantalla, no lo pisamos (el primero suele ser la causa raíz).
      this.setState((prev) => (prev.error ? prev : { error, componentStack }));
    };
    // Drenamos un error async que haya llegado ANTES de montar el boundary.
    if (pendingAsyncError) {
      const pending = pendingAsyncError;
      pendingAsyncError = null;
      this.setState((prev) => (prev.error ? prev : { error: pending.error, componentStack: pending.componentStack }));
    }
  }

  componentWillUnmount(): void {
    if (asyncErrorListener) asyncErrorListener = null;
  }

  render(): React.ReactNode {
    const { error, componentStack } = this.state;

    // Sin error → la app renderiza normal (caso de WEB y de cualquier arranque sano).
    if (!error) {
      return this.props.children;
    }

    const header = `${error.name ?? 'Error'}: ${error.message ?? '(sin mensaje)'}`;

    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.title} selectable>
            {'⚠️ JS ERROR (diagnóstico)'}
          </Text>

          <Text style={styles.label} selectable>
            mensaje:
          </Text>
          <Text style={styles.message} selectable>
            {header}
          </Text>

          <Text style={styles.label} selectable>
            stack:
          </Text>
          <Text style={styles.mono} selectable>
            {error.stack ?? '(sin stack)'}
          </Text>

          {componentStack ? (
            <>
              <Text style={styles.label} selectable>
                componentStack:
              </Text>
              <Text style={styles.mono} selectable>
                {componentStack}
              </Text>
            </>
          ) : null}

          <View style={styles.footerSpacer} />
        </ScrollView>
      </SafeAreaView>
    );
  }
}

// StyleSheet-less (objetos inline via constante) para no depender de nada externo — solo primitivas RN.
const styles = {
  screen: {
    flex: 1,
    backgroundColor: '#3b0d0d', // design-lint-disable-line -- pantalla de crash: no puede leer $background, el theme puede ser justamente lo que falló
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16, // design-lint-disable-line -- pantalla de crash: sin Tamagui montado no hay tokens de spacing, solo primitivas RN
    paddingBottom: 48, // design-lint-disable-line -- pantalla de crash: sin tokens de spacing; holgura para que el stack no quede pegado al borde
  },
  title: {
    color: '#ffd7d7', // design-lint-disable-line -- pantalla de crash: color literal, el theme provider puede ser lo que falló
    fontSize: 18, // design-lint-disable-line -- pantalla de crash: sin tokens tipográficos, solo primitivas RN
    fontWeight: '700' as const,
    marginBottom: 16, // design-lint-disable-line -- pantalla de crash: sin tokens de spacing, solo primitivas RN
  },
  label: {
    color: '#ff9a9a', // design-lint-disable-line -- pantalla de crash: color literal, no puede depender del design system
    fontSize: 12, // design-lint-disable-line -- pantalla de crash: sin tokens tipográficos, solo primitivas RN
    fontWeight: '700' as const,
    marginTop: 12, // design-lint-disable-line -- pantalla de crash: sin tokens de spacing, solo primitivas RN
    marginBottom: 4, // design-lint-disable-line -- pantalla de crash: sin tokens de spacing, solo primitivas RN
    fontFamily: MONOSPACE,
  },
  message: {
    color: '#ffffff', // design-lint-disable-line -- pantalla de crash: color literal, no puede depender del design system
    fontSize: 13, // design-lint-disable-line -- pantalla de crash: sin tokens tipográficos, solo primitivas RN
    fontFamily: MONOSPACE,
    lineHeight: 18, // design-lint-disable-line -- pantalla de crash: interlineado literal para que el mensaje sea legible sin tokens
  },
  mono: {
    color: '#ffe6e6', // design-lint-disable-line -- pantalla de crash: color literal, no puede depender del design system
    fontSize: 12, // design-lint-disable-line -- pantalla de crash: sin tokens tipográficos, solo primitivas RN
    fontFamily: MONOSPACE,
    lineHeight: 17, // design-lint-disable-line -- pantalla de crash: interlineado literal para el stack, sin tokens
  },
  footerSpacer: {
    height: 24,
  },
};
