// useGroupView — orquesta la carga de la VISTA DE GRUPO (spec 10, T-UI.1): la lista de animales activos
// + el gating de las acciones masivas, con re-carga al ENFOCAR la pantalla y al avanzar el SYNC (mismo
// patrón que la tab Animales / Inicio). Los hooks orquestan services (architecture.md); la pantalla
// (rodeo/[id] | lote/[id]) le pasa un `loader` que sabe leer SU grupo (rodeo vs lote) y consume el estado.
//
// Offline-first (spec 15): el loader lee del SQLite local; este hook solo coordina cuándo re-leer.

import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async () => {
    if (!loader) {
      setError('No se encontró el grupo.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await loader();
    setLoading(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setAnimals(r.data.animals);
    setActions(r.data.actions);
  }, [loader]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Re-leer cuando AVANZA el sync (first-sync / download posterior): el SQLite local cambia y la lista/
  // gating deben reflejarlo sin salir/volver. Dep primitiva (ms) — estable entre syncs (no loopea).
  useEffect(() => {
    if (lastSyncedMs === 0) return;
    void load();
  }, [lastSyncedMs, load]);

  return { animals, actions, loading, error };
}
