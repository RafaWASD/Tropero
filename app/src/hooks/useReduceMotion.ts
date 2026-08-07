// useReduceMotion — la preferencia de accesibilidad "reducir movimiento" del sistema, como booleano.
//
// La app ya la respeta en `components/Skeleton.tsx` (`useSkeletonPulse`), donde la lógica vive INLINE
// dentro del hook del pulso. Este módulo la expone suelta para el segundo consumidor (el morph del
// indicador del bastón, 2026-08-06) en vez de copiar el bloque una tercera vez.
//
// ⚠️ COPIA DECLARADA: `useSkeletonPulse` NO se migró a este hook. No es un no-op —ese hook mezcla la
// preferencia con la cancelación del loop de reanimated, así que tocarlo es cambiar el ciclo de vida de
// una animación que ya está verificada— y queda como barrido aparte, con el mismo criterio con el que
// `connection-view.ts` declara sus tres copias de `toneColorToken`. Si aparece un TERCER consumidor,
// unificar deja de ser opcional.
//
// Defensivo igual que el original: en algún entorno de test la API puede faltar. El `?.()` guarda la
// LLAMADA pero no el `.then`, así que se resuelve a una variable y se chequea que sea un thenable antes
// de encadenar. Default `false` = animar, que es el comportamiento sensato si no se puede preguntar.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    const query = AccessibilityInfo.isReduceMotionEnabled?.();
    if (query && typeof query.then === 'function') {
      query
        .then((enabled) => {
          if (mounted) setReduceMotion(enabled);
        })
        .catch(() => {});
    }
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled: boolean) => {
      if (mounted) setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  return reduceMotion;
}
