// useGroupView — orquesta la carga de la VISTA DE GRUPO (spec 10, T-UI.1): la lista de animales activos
// + el gating de las acciones masivas, con re-carga al ENFOCAR la pantalla y al avanzar el SYNC (mismo
// patrón que la tab Animales / Inicio). Los hooks orquestan services (architecture.md); la pantalla
// (rodeo/[id] | lote/[id]) le pasa un `loader` que sabe leer SU grupo (rodeo vs lote) y consume el estado.
//
// Offline-first (spec 15): el loader lee del SQLite local; este hook solo coordina cuándo re-leer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useStatus } from '@powersync/react';

import type { AnimalListItem } from '../services/animals';
import type { GroupActionsAvailability } from '../utils/group-actions';

/** Lo que un loader de grupo devuelve: la lista activa + el gating + un eventual error es-AR. */
export type GroupViewData = {
  animals: AnimalListItem[];
  actions: GroupActionsAvailability;
};

/** Estado expuesto a la pantalla. */
export type GroupViewState = {
  animals: AnimalListItem[];
  /** Castrar siempre disponible; vacunar/destetar por gating. null mientras no cargó (la barra espera). */
  actions: GroupActionsAvailability | null;
  loading: boolean;
  error: string | null;
};

/**
 * Coordina la carga de una vista de grupo. `loader` resuelve los datos del grupo (rodeo o lote) desde el
 * SQLite local; debe devolver `{ ok, data }` o `{ ok:false, message }`. El hook re-carga al enfocar y al
 * bajar un sync nuevo (lastSyncedAt — dep primitiva, estable entre syncs → no loopea). `loader` debe ser
 * estable (useCallback en la pantalla) para no re-disparar de gusto.
 */
export function useGroupView(
  loader: (() => Promise<{ ok: true; data: GroupViewData } | { ok: false; message: string }>) | null,
): GroupViewState {
  const [animals, setAnimals] = useState<AnimalListItem[]>([]);
  const [actions, setActions] = useState<GroupActionsAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncStatus = useStatus();
  const lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0;

  // `load` distingue CARGA INICIAL (puede blanquear: setea `loading`, que desmonta la lista/barra/conteo y
  // resetea el scroll) de REFRESH SILENCIOSO (`silent: true` — NO toca `loading`: la vista queda montada, el
  // scroll se mantiene, solo se reconcilian los datos). Al VOLVER de una acción masiva (Castrar/Vacunar/
  // Destetar → navega y vuelve) el re-focus es silencioso → la lista no parpadea en blanco ni salta al tope.
  // Mismo patrón `silent` que `animal/[id].tsx`.
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const silent = opts.silent === true;
    if (!loader) {
      setError('No se encontró el grupo.');
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    const r = await loader();
    if (!silent) setLoading(false);
    if (!r.ok) {
      // En un refresh SILENCIOSO un fallo transitorio NO debe volar la vista ya montada; conservamos los
      // datos actuales y salimos sin tocar el error. En la carga inicial sí surfaceamos el error.
      if (!silent) setError(r.message);
      return;
    }
    setAnimals(r.data.animals);
    setActions(r.data.actions);
  }, [loader]);

  // La PRIMERA carga (mount) puede blanquear (no hay nada que preservar); los RE-FOCUS posteriores (volver
  // de una masiva) y los re-leídos por sync son SILENCIOSOS → refrescan en el lugar sin parpadeo. El ref se
  // resetea si cambia el `loader` (cambió el grupo/campo) → ese cambio sí vuelve a mostrar la carga inicial.
  const didInitialLoadRef = useRef(false);
  const lastLoaderRef = useRef(loader);
  if (lastLoaderRef.current !== loader) {
    lastLoaderRef.current = loader;
    didInitialLoadRef.current = false;
  }

  useFocusEffect(
    useCallback(() => {
      const silent = didInitialLoadRef.current;
      didInitialLoadRef.current = true;
      void load({ silent });
    }, [load]),
  );

  // Re-leer cuando AVANZA el sync (first-sync / download posterior): el SQLite local cambia y la lista/
  // gating deben reflejarlo sin salir/volver. Dep primitiva (ms) — estable entre syncs (no loopea). SIEMPRE
  // silencioso: es un refresh en segundo plano sobre una vista ya montada, nunca debe blanquearla.
  useEffect(() => {
    if (lastSyncedMs === 0) return;
    void load({ silent: true });
  }, [lastSyncedMs, load]);

  return { animals, actions, loading, error };
}
