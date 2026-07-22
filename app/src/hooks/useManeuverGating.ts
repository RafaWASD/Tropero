// useManeuverGating — combina la lógica PURA del gating de maniobras (utils/maneuver-gating.ts) con la
// capa de datos local (rodeo-config.fetchRodeoGating) para resolver, dado un rodeo, qué maniobras de la
// sesión aplican y cuáles se omiten (spec 03 M1.1, ADR-021 / R1.4/R1.5/R5.3/R5.5/R5.6/R10.3).
//
// Los hooks orquestan services (architecture.md); la lógica de decisión es PURA (testeable sin RN). Este
// hook NO renderiza: expone el estado del gating del rodeo + un resolver síncrono sobre el mapa cargado.
//
// Offline-first (R10.3): fetchRodeoGating lee del SQLite local (rodeo_data_config + field_definitions +
// system_default_fields, todo cacheado). Se re-carga al ENFOCAR (carga inicial) y ante un CAMBIO de las
// tablas de config del rodeo (spec 22, watched query `db.onChange` sobre rodeo_data_config +
// pending_rodeo_data_config), por si el owner (o un coworker) cambió la plantilla del rodeo mientras tanto.
//
// USO:
//   - Wizard (etapa 2, R1.4/R1.5): pasar el rodeo de la SESIÓN → `filter(maniobrasOfrecidas)` deja solo
//     las habilitadas en el rodeo.
//   - Carga rápida (R5.3): pasar el rodeo REAL del animal (animal_profiles.rodeo_id del perfil activo,
//     resuelto por el caller) → `resolveSession(maniobrasDeLaSesion)` decide cuáles aplican por animal.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { usePowerSync } from '@powersync/react';

import { fetchRodeoGating } from '../services/rodeo-config';
import {
  filterApplicableManeuvers,
  resolveManeuverGating,
  resolveSessionGating,
  type ManeuverGatingResult,
  type ManeuverKind,
  type RodeoDataKeyMap,
} from '../utils/maneuver-gating';
import { initialLoadingFor, shouldShowLoadingForLoad } from '../utils/maneuver-gating-load';

export type ManeuverGatingState = {
  /** El mapa data_key → {enabled, required} del rodeo. null mientras no cargó. */
  config: RodeoDataKeyMap | null;
  loading: boolean;
  /** Mensaje es-AR si la carga falló (p. ej. "Sincronizando…"); null si todo OK. */
  error: string | null;
};

export type UseManeuverGating = ManeuverGatingState & {
  /** Fuerza una recarga del gating del rodeo (p. ej. tras tocar la plantilla). */
  reload: () => void;
  /** Resuelve una maniobra contra el rodeo cargado (síncrono). Si aún no cargó → no aplica (fail-safe UI). */
  resolve: (maneuver: ManeuverKind) => ManeuverGatingResult;
  /** Resuelve un conjunto de maniobras (preserva orden). */
  resolveSession: (maneuvers: readonly ManeuverKind[]) => ManeuverGatingResult[];
  /** Separa habilitadas de omitidas en el rodeo (R1.4/R1.5 wizard, R2.3 preset). */
  filter: (maneuvers: readonly ManeuverKind[]) => { applicable: ManeuverKind[]; omitted: ManeuverKind[] };
};

const EMPTY_CONFIG: RodeoDataKeyMap = {};

/**
 * Carga y expone el gating de maniobras de un rodeo. `rodeoId` null = no hay rodeo (inerte: config null,
 * todo resuelve a "no aplica" — fail-safe del lado UI). Re-carga al enfocar y al bajar un sync nuevo.
 */
export function useManeuverGating(rodeoId: string | null): UseManeuverGating {
  const [config, setConfig] = useState<RodeoDataKeyMap | null>(null);
  const [loading, setLoading] = useState(() => initialLoadingFor(rodeoId));
  const [error, setError] = useState<string | null>(null);

  // spec 22 (R22.10) — instancia del DB para la watched query imperativa (`db.onChange`). Mismo singleton
  // que `getPowerSync()`, provisto por el `PowerSyncProvider` que envuelve el árbol (igual que los contextos
  // de la feature 21). Reemplaza el disparador por-sync `lastSyncedMs` (proxy NO determinista, ADR-030).
  const db = usePowerSync();

  // El último request gana (evita que una carga vieja pise la nueva si el rodeo cambia rápido).
  const reqIdRef = useRef(0);

  // El rodeo para el que YA tenemos config cargado (stale-while-revalidate). Mientras coincida con `rodeoId`,
  // las recargas por focus/sync son SILENCIOSAS (no flipean `loading` → no parpadean la UI ni desmontan el
  // paso en curso de la carga rápida; ver utils/maneuver-gating-load.ts y el bug s27). null = ninguno aún.
  const loadedRodeoRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!rodeoId) {
      // Sin rodeo: nada que cargar. Reseteamos el "rodeo ya cargado" para que al elegir uno nuevo SÍ
      // mostremos loading (carga inicial), no el config stale de un rodeo anterior.
      loadedRodeoRef.current = null;
      setConfig(null);
      setLoading(false);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    // Solo mostramos loading en la carga INICIAL de ESTE rodeo. Revalidación en background del mismo rodeo
    // (focus / sync) = silenciosa: mantenemos el config previo visible (stale-while-revalidate).
    if (shouldShowLoadingForLoad(rodeoId, loadedRodeoRef.current)) setLoading(true);
    const r = await fetchRodeoGating(rodeoId);
    if (reqId !== reqIdRef.current) return; // request obsoleto: lo descartamos.
    if (!r.ok) {
      // En revalidación silenciosa de un rodeo ya cargado, un error transitorio no debe blanquear lo que ya
      // mostramos; igual surfaceamos el error (mismo `error` que antes). `loading` ya estaba false → no lo
      // tocamos en ese caso; si era la carga inicial, lo apagamos para no colgar el spinner.
      setError(r.error.message);
      setLoading(false);
      return;
    }
    loadedRodeoRef.current = rodeoId; // a partir de acá, las recargas de este rodeo son silenciosas.
    setConfig(r.value);
    setError(null);
    setLoading(false);
  }, [rodeoId]);

  // La carga inicial la dispara useFocusEffect (focus se emite también al montar). Si el rodeo cambia, `load`
  // cambia → useFocusEffect lo re-dispara. `db.onChange` NO dispara al registrarse (triggerImmediate=false por
  // default), así que la carga inicial la sigue dando ESTE efecto (R22.15) — no se duplica.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // spec 22 (R22.10/R22.11/R22.13/R22.15/R22.17) — WATCHED QUERY imperativa. Reemplaza el disparador por-sync
  // (`lastSyncedMs`, proxy NO determinista, ADR-030) por `db.onChange` sobre las tablas que respaldan la config
  // del rodeo. El onChange re-corre `load()` EXISTENTE (→ fetchRodeoGating → buildRodeoConfigQuery overlay-aware
  // → resolución del gating) SIN tocar su lógica de veredicto: solo cambia QUIÉN lo dispara (mismo patrón que
  // los contextos de la feature 21).
  //
  // OVERLAY-AWARE (R22.13) — se observan AMBAS tablas: `pending_rodeo_data_config` (overlay optimista del
  // toggle offline del owner, que dispara el feedback inmediato incluso sin red, R22.22) y `rodeo_data_config`
  // (la fila synced confirmada que baja tras el ACK cuando la descarga reengancha por (a)). Observar solo una
  // perdería uno de los dos disparos (design §4.3).
  //
  // Dep PRIMITIVA (`rodeoId` + el singleton estable `db`), NO un objeto de status (R22.17): no reintroduce el
  // loop de re-render que la feature 20 evitó. El throttle (~30 ms) del SDK coalesce la ráfaga de un checkpoint
  // (R22.18); `load` conserva stale-while-revalidate (loadedRodeoRef/reqIdRef) → un disparo del MISMO rodeo no
  // re-flipea `loading` (R22.19). `load` es useCallback([rodeoId]) estable → el efecto se re-suscribe solo si
  // cambia el rodeo (R22.15), liberando la suscripción anterior (dispose).
  useEffect(() => {
    if (!rodeoId) return;
    const dispose = db.onChange(
      { onChange: () => { void load(); } },
      { tables: ['rodeo_data_config', 'pending_rodeo_data_config'] },
    );
    return () => dispose();
  }, [rodeoId, load, db]);

  const resolve = useCallback(
    (maneuver: ManeuverKind) => resolveManeuverGating(maneuver, config ?? EMPTY_CONFIG),
    [config],
  );
  const resolveSession = useCallback(
    (maneuvers: readonly ManeuverKind[]) => resolveSessionGating(maneuvers, config ?? EMPTY_CONFIG),
    [config],
  );
  const filter = useCallback(
    (maneuvers: readonly ManeuverKind[]) => filterApplicableManeuvers(maneuvers, config ?? EMPTY_CONFIG),
    [config],
  );

  return { config, loading, error, reload: () => void load(), resolve, resolveSession, filter };
}
