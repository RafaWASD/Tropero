// observabilidad-spike.tsx — SPIKE VISUAL del fallback del RootErrorBoundary (feature 17 + 23, Gate 2.5).
//
// Pantalla 100% MOCK, alcanzable directo en web sin auth (DEV_WEB_ROUTES → el RootGate NO la rebota a
// sign-in) para la captura del design-review a 412×915. Renderiza EL MISMO `RootErrorBoundaryFallback`
// que producción (no un espejo) → la captura veta el diseño real (incl. anti-recorte de la `g` de "Algo
// salió mal"). El crash-test REAL (R2.6) vive dentro del RootErrorBoundary, gated a development/preview;
// este spike es solo el vehículo de captura (el env de captura es 'e2e', donde ese trigger está oculto).
// NO es producción.
//
// Feature 23 (US5, Gate 2.5): con `?code=<uuid>` el fallback se renderiza con el "Código de soporte" +
// Copiar (el requestId del crash) → misma vía de captura que reportes-spike/skeletons-spike usan con
// `variant`. SIN el param se comporta idéntico a antes (captura de la feature 17: solo título + Reintentar).

import { useLocalSearchParams } from 'expo-router';

import { RootErrorBoundaryFallback } from './_components/RootErrorBoundary';

export default function ObservabilidadSpikeScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  return (
    <RootErrorBoundaryFallback
      onRetry={() => {
        /* mock: la captura solo mira el fallback */
      }}
      supportCode={typeof code === 'string' && code ? code : undefined}
    />
  );
}
