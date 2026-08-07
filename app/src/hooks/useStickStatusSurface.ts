// useStickStatusSurface — el hook con el que una pantalla DECLARA que ella ya muestra el estado del
// bastón, y por lo tanto el indicador global del chrome (RMV3.5) se calla mientras esté enfocada.
//
// El store, el porqué del reclamo (en vez de una lista de rutas) y el límite del frame están
// documentados en `services/ble/stick-status-surface.ts`. Acá vive SOLO el hook de reclamo, porque es lo
// único que necesita `expo-router` — un paquete que `node:test` no puede cargar, y el store tiene que
// quedar testeable.
//
// ── POR QUÉ FOCO Y NO MONTAJE (el bug que un `useEffect` habría introducido) ────────────────────────
// Las pantallas del stack quedan MONTADAS al navegar encima, y una tab visitada queda montada el resto de
// la sesión. Con un `useEffect` de montaje, entrar UNA vez a la tab "Animales" habría dejado el reclamo
// vivo para siempre → el indicador global apagado en TODA la app, en silencio y sin que ningún test web
// lo note. Por eso el reclamo se ata al FOCO — el mismo motivo por el que `StickConnectionScreen` toma el
// scanner acotado con `useFocusEffect` y no con `useEffect` (ver la reconciliación de RMV3.1).

import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import {
  claimStickStatusSurface,
  type StickStatusSurfaceKind,
} from '@/services/ble/stick-status-surface';

/**
 * Mientras esta pantalla esté ENFOCADA (y `active`), el indicador global del chrome no se muestra.
 *
 * `active` existe porque las superficies deciden en runtime si se pintan: `BleConnectionChip` no
 * renderiza nada sin transporte instanciado. Reclamar sin pintar sería mentir — apagaría el indicador
 * global sin poner nada en su lugar. Va como argumento (y no como un `if` antes del hook) porque los
 * hooks no pueden ser condicionales.
 */
export function useStickStatusSurface(kind: StickStatusSurfaceKind, active = true): void {
  useFocusEffect(
    useCallback(() => {
      if (!active) return undefined;
      return claimStickStatusSurface(kind);
    }, [kind, active]),
  );
}
